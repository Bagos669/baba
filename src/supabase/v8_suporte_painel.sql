-- BABA v8: conta de suporte (super adm) e painel de suporte.
-- Rode DEPOIS do v7. Pode rodar mais de uma vez.
-- No final do arquivo, a linha que dá o cargo de suporte à conta contatobabaapp@gmail.com:
-- crie essa conta no app ANTES de rodar este arquivo.

-- ============ Quem é suporte ============
create table if not exists private.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
create or replace function private.is_staff_uid(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select uid is not null and exists (select 1 from private.staff s where s.user_id = uid);
$$;
create or replace function public.am_i_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_staff_uid((select auth.uid()));
$$;

-- Every staff action is written down.
create table if not exists private.staff_log (
  id bigserial primary key,
  staff uuid,
  action text not null,
  target text,
  details jsonb,
  at timestamptz not null default now()
);
create or replace function private.require_staff(what text, target text, details jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if not private.is_staff_uid(uid) then raise exception 'not_staff'; end if;
  if what is not null then insert into private.staff_log (staff, action, target, details) values (uid, what, target, details); end if;
  return uid;
end;
$$;

-- ============ Atividade, saídas, suspensões, avisos ============
create table if not exists public.user_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  primary key (user_id, day)
);
alter table public.user_days enable row level security;
create or replace function public.ping_activity() returns void
language sql security definer set search_path = '' as $$
  insert into public.user_days (user_id, day)
  select (select auth.uid()), (now() at time zone 'America/Sao_Paulo')::date where (select auth.uid()) is not null
  on conflict do nothing;
$$;

create table if not exists private.account_deletions (
  id bigserial primary key,
  at timestamptz not null default now(),
  account_age_days integer,
  turmas_owned integer
);

create table if not exists private.bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text,
  until timestamptz,
  by_staff uuid,
  at timestamptz not null default now()
);
create or replace function private.is_banned(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.bans b where b.user_id = uid and (b.until is null or b.until > now()));
$$;

create table if not exists public.app_notices (
  id bigserial primary key,
  message text not null check (char_length(message) between 1 and 280),
  level text not null default 'info' check (level in ('info', 'warning')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.app_notices enable row level security;
drop policy if exists notices_select on public.app_notices;
create policy notices_select on public.app_notices for select to anon, authenticated using (active);

-- What the app asks on start: am I staff, am I suspended, any notice.
create or replace function public.my_status()
returns table (staff boolean, banned_until timestamptz, banned_reason text, notice text, notice_level text)
language sql stable security definer set search_path = '' as $$
  select private.is_staff_uid((select auth.uid())),
         (select coalesce(b.until, 'infinity'::timestamptz) from private.bans b where b.user_id = (select auth.uid()) and (b.until is null or b.until > now())),
         (select b.reason from private.bans b where b.user_id = (select auth.uid()) and (b.until is null or b.until > now())),
         (select n.message from public.app_notices n where n.active order by n.id desc limit 1),
         (select n.level from public.app_notices n where n.active order by n.id desc limit 1);
$$;

-- ============ Suporte: pontos infinitos e lojinha liberada ============
create or replace function private.add_points(uid uuid, delta integer, why text, ref text) returns integer
language plpgsql security definer set search_path = '' as $$
declare bal integer;
begin
  insert into public.wallets (user_id, balance) values (uid, 0) on conflict (user_id) do nothing;
  if private.is_staff_uid(uid) then
    update public.wallets set balance = 999999999 where user_id = uid;
    insert into public.points_ledger (user_id, delta, reason, ref) values (uid, delta, why, ref);
    return 999999999;
  end if;
  update public.wallets set balance = balance + delta where user_id = uid and balance + delta >= 0 returning balance into bal;
  if bal is null then raise exception 'no_points'; end if;
  insert into public.points_ledger (user_id, delta, reason, ref) values (uid, delta, why, ref);
  return bal;
end;
$$;

create or replace function public.my_wallet()
returns table (balance integer, daily_available boolean, items text[])
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.wallets w where w.user_id = uid) then
    perform private.add_points(uid, 1000, 'boas-vindas', null);
  end if;
  if private.is_staff_uid(uid) then
    update public.wallets set balance = 999999999 where user_id = uid;
    insert into public.user_items (user_id, item_id) select uid, s.id from public.shop_items s on conflict do nothing;
  end if;
  return query
    select w.balance, (w.daily_on is null or w.daily_on < today),
           coalesce((select array_agg(i.item_id order by i.acquired_at) from public.user_items i where i.user_id = uid), '{}')
    from public.wallets w where w.user_id = uid;
end;
$$;

-- Suspended accounts can't chat, palpitar or open live games.
alter policy chat_insert on public.chat_messages
  with check (user_id = (select auth.uid()) and deleted = false and private.can_read_room(room)
              and exists (select 1 from public.account_private a where a.user_id = (select auth.uid()) and a.terms_accepted_at is not null)
              and not private.is_banned((select auth.uid())));
alter policy live_insert on public.live_games
  with check (owner = (select auth.uid()) and not private.is_banned((select auth.uid()))
              and not exists (select 1 from unnest(turma_ids) t(id) where not private.is_member(t.id)));

create or replace function public.place_palpite(live uuid, market text, stake integer)
returns table (palpite_id bigint, balance integer, odd numeric)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); g public.live_games; it jsonb; o numeric; mno integer; bal integer; pid bigint;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if private.is_banned(uid) then raise exception 'banned'; end if;
  if not private.is_adult(uid) then raise exception 'adult_only'; end if;
  select * into g from public.live_games where id = live;
  if g.id is null or not g.active then raise exception 'no_game'; end if;
  if g.owner = uid then raise exception 'own_game'; end if;
  if not g.palpites then raise exception 'palpites_off'; end if;
  if coalesce((g.markets ->> 'open')::boolean, false) = false then raise exception 'closed'; end if;
  if g.markets ? 'closes_at' and (g.markets ->> 'closes_at')::timestamptz < now() then raise exception 'closed'; end if;
  if stake is null or stake < 10 or stake > 500 then raise exception 'bad_stake'; end if;
  mno := (g.markets ->> 'match_no')::integer;
  select x into it from jsonb_array_elements(coalesce(g.markets -> 'items', '[]'::jsonb)) x where x ->> 'key' = market limit 1;
  if it is null then raise exception 'no_market'; end if;
  o := least(greatest(round((it ->> 'odd')::numeric, 2), 1.05), 20);
  if (select count(*) from public.palpites p where p.user_id = uid and p.live_id = live and p.match_no = mno) >= 5 then raise exception 'limit'; end if;
  perform 1 from public.my_wallet();
  bal := private.add_points(uid, -stake, 'palpite', live::text || ':' || mno);
  insert into public.palpites (live_id, match_no, user_id, market, label, odd, stake)
  values (live, mno, uid, market, left(coalesce(it ->> 'label', market), 80), o, stake) returning id into pid;
  return query select pid, bal, o;
end;
$$;

-- Account deletion leaves an anonymous trace (for the "who is leaving" numbers).
create or replace function public.srv_prepare_account_deletion(uid uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare t record; heir uuid; owned integer;
begin
  select count(*) into owned from public.turmas x where x.owner_id = uid;
  insert into private.account_deletions (account_age_days, turmas_owned)
  select extract(day from now() - u.created_at)::integer, owned from auth.users u where u.id = uid;
  for t in select x.id from public.turmas x where x.owner_id = uid loop
    select user_id into heir from public.turma_members
      where turma_id = t.id and user_id <> uid
      order by case role when 'admin' then 0 else 1 end, joined_at limit 1;
    if heir is null then
      delete from public.turmas where id = t.id;
    else
      update public.turma_members set role = 'admin' where turma_id = t.id and user_id = heir;
      perform set_config('baba.owner_change', 'on', true);
      update public.turmas set owner_id = heir where id = t.id;
      perform set_config('baba.owner_change', '', true);
    end if;
  end loop;
end;
$$;

-- For the account edge function: is this user staff? (service role only)
create or replace function public.srv_is_staff(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.is_staff_uid(uid); $$;

create or replace function public.srv_staff_log(staff uuid, what text, target text, details jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into private.staff_log (staff, action, target, details) values (staff, what, target, details);
$$;

-- ============ Painel: números ============
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare today date := (now() at time zone 'America/Sao_Paulo')::date; r jsonb;
begin
  perform private.require_staff(null, null, null);
  select jsonb_build_object(
    'users', (select count(*) from auth.users),
    'new_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'new_30d', (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'active_1d', (select count(distinct user_id) from public.user_days where day = today),
    'active_7d', (select count(distinct user_id) from public.user_days where day > today - 7),
    'active_30d', (select count(distinct user_id) from public.user_days where day > today - 30),
    'signin_7d', (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
    'terms_ok', (select count(*) from public.account_private where terms_accepted_at is not null),
    'adults', (select count(*) from public.account_private a where private.is_adult(a.user_id)),
    'turmas', (select count(*) from public.turmas),
    'turmas_active_30d', (select count(distinct t) from public.babas b, unnest(b.turma_ids) t where b.updated_at > now() - interval '30 days'),
    'babas_done', (select count(*) from public.babas where finished),
    'babas_done_7d', (select count(*) from public.babas where finished and updated_at > now() - interval '7 days'),
    'babas_open', (select count(*) from public.babas where not finished),
    'matches', (select coalesce(sum(matches), 0) from public.babas where finished),
    'goals', (select coalesce(sum(goals), 0) from public.baba_stats),
    'live_now', (select count(*) from public.live_games where active and updated_at > now() - interval '3 hours'),
    'live_total', (select count(*) from public.live_games),
    'palpites', (select count(*) from public.palpites),
    'palpites_open', (select count(*) from public.palpites where status = 'open'),
    'pts_staked', (select coalesce(sum(stake), 0) from public.palpites),
    'pts_paid', (select coalesce(sum(payout), 0) from public.palpites where status = 'won'),
    'items_sold', (select count(*) from public.user_items i where not private.is_staff_uid(i.user_id)),
    'msgs_7d', (select count(*) from public.chat_messages where created_at > now() - interval '7 days'),
    'reports_open', (select count(distinct r.message_id) from public.chat_reports r join public.chat_messages m on m.id = r.message_id where not m.deleted),
    'deleted_30d', (select count(*) from private.account_deletions where at > now() - interval '30 days'),
    'deleted_total', (select count(*) from private.account_deletions),
    'inactive_30d', (select count(*) from auth.users u where u.created_at < now() - interval '30 days'
                       and not exists (select 1 from public.user_days d where d.user_id = u.id and d.day > today - 30)
                       and coalesce(u.last_sign_in_at, u.created_at) < now() - interval '30 days'),
    'never_accepted', (select count(*) from auth.users u where not exists (select 1 from public.account_private a where a.user_id = u.id and a.terms_accepted_at is not null)),
    'no_turma', (select count(*) from auth.users u where not exists (select 1 from public.turma_members m where m.user_id = u.id)),
    'banned', (select count(*) from private.bans where until is null or until > now())
  ) into r;
  return r;
end;
$$;

create or replace function public.admin_series(days integer)
returns table (day date, signups integer, active integer, babas integer, palpites integer, messages integer)
language plpgsql stable security definer set search_path = '' as $$
declare today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  perform private.require_staff(null, null, null);
  return query
    select d::date,
      (select count(*) from auth.users u where (u.created_at at time zone 'America/Sao_Paulo')::date = d)::integer,
      (select count(*) from public.user_days x where x.day = d)::integer,
      (select count(*) from public.babas b where b.finished and (b.updated_at at time zone 'America/Sao_Paulo')::date = d)::integer,
      (select count(*) from public.palpites p where (p.created_at at time zone 'America/Sao_Paulo')::date = d)::integer,
      (select count(*) from public.chat_messages m where (m.created_at at time zone 'America/Sao_Paulo')::date = d)::integer
    from generate_series(today - (least(greatest(days, 7), 90) - 1), today, interval '1 day') d
    order by 1;
end;
$$;

-- ============ Painel: pessoas ============
create or replace function public.admin_users(search text, lim integer, off integer)
returns table (id uuid, email text, name text, avatar text, cosmetics jsonb, created_at timestamptz, last_sign_in_at timestamptz,
               last_active date, turmas integer, balance integer, terms_version text, adult boolean, staff boolean, banned boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff(null, null, null);
  return query
    select u.id, u.email::text, p.name, case when p.avatar like 'data:image/%' then 'photo' else p.avatar end, coalesce(p.cosmetics, '{}'::jsonb), u.created_at, u.last_sign_in_at,
           (select max(d.day) from public.user_days d where d.user_id = u.id),
           (select count(*) from public.turma_members m where m.user_id = u.id)::integer,
           (select w.balance from public.wallets w where w.user_id = u.id),
           a.terms_version, private.is_adult(u.id), private.is_staff_uid(u.id), private.is_banned(u.id)
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.account_private a on a.user_id = u.id
    where coalesce(search, '') = '' or u.email ilike '%' || search || '%' or p.name ilike '%' || search || '%'
    order by u.created_at desc
    limit least(greatest(coalesce(lim, 50), 1), 200) offset greatest(coalesce(off, 0), 0);
end;
$$;

create or replace function public.admin_user(uid uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb; yrs integer;
begin
  perform private.require_staff(null, null, null);
  select extract(year from pg_catalog.age(a.birth_date))::integer into yrs from public.account_private a where a.user_id = uid;
  select jsonb_build_object(
    'id', u.id, 'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
    'name', p.name, 'avatar', p.avatar, 'cosmetics', coalesce(p.cosmetics, '{}'::jsonb), 'prefs', p.prefs,
    'age', yrs, 'terms_version', a.terms_version, 'terms_at', a.terms_accepted_at,
    'staff', private.is_staff_uid(u.id),
    'ban', (select jsonb_build_object('reason', b.reason, 'until', b.until, 'at', b.at) from private.bans b where b.user_id = u.id and (b.until is null or b.until > now())),
    'active_days_30', (select count(*) from public.user_days d where d.user_id = u.id and d.day > current_date - 30),
    'last_active', (select max(d.day) from public.user_days d where d.user_id = u.id),
    'turmas', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'role', case when t.owner_id = u.id then 'owner' else m.role end,
                        'members', (select count(*) from public.turma_members x where x.turma_id = t.id)) order by t.name)
               from public.turma_members m join public.turmas t on t.id = m.turma_id where m.user_id = u.id), '[]'::jsonb),
    'wallet', (select jsonb_build_object('balance', w.balance, 'daily_on', w.daily_on) from public.wallets w where w.user_id = u.id),
    'items', coalesce((select jsonb_agg(i.item_id order by i.acquired_at) from public.user_items i where i.user_id = u.id), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(x order by x.id desc) from (select l.id, l.delta, l.reason, l.ref, l.created_at from public.points_ledger l where l.user_id = u.id order by l.id desc limit 30) x), '[]'::jsonb),
    'palpites', coalesce((select jsonb_agg(x order by x.id desc) from (select p2.id, p2.label, p2.odd, p2.stake, p2.status, p2.payout, p2.created_at from public.palpites p2 where p2.user_id = u.id order by p2.id desc limit 20) x), '[]'::jsonb),
    'babas', coalesce((select jsonb_agg(x order by x.updated_at desc) from (select b.id, b.title, b.played_on, b.finished, b.matches, b.updated_at from public.babas b where b.created_by = u.id order by b.updated_at desc limit 10) x), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(x order by x.id desc) from (select c.id, c.room, c.body, c.deleted, c.created_at from public.chat_messages c where c.user_id = u.id order by c.id desc limit 15) x), '[]'::jsonb),
    'reports_against', (select count(*) from public.chat_reports r join public.chat_messages c on c.id = r.message_id where c.user_id = u.id)
  ) into r
  from auth.users u left join public.profiles p on p.id = u.id left join public.account_private a on a.user_id = u.id
  where u.id = uid;
  if r is null then raise exception 'not_found'; end if;
  return r;
end;
$$;

create or replace function public.admin_adjust_points(uid uuid, delta integer, why text) returns integer
language plpgsql security definer set search_path = '' as $$
declare bal integer;
begin
  perform private.require_staff('pontos', uid::text, jsonb_build_object('delta', delta, 'motivo', why));
  if delta is null or delta = 0 or abs(delta) > 1000000 then raise exception 'bad_delta'; end if;
  perform 1 from public.wallets where user_id = uid;
  if not found then insert into public.wallets (user_id, balance) values (uid, 0); end if;
  if delta < 0 then
    update public.wallets set balance = greatest(0, balance + delta) where user_id = uid returning balance into bal;
    insert into public.points_ledger (user_id, delta, reason, ref) values (uid, delta, 'suporte', left(why, 80));
  else
    bal := private.add_points(uid, delta, 'suporte', left(why, 80));
  end if;
  return bal;
end;
$$;

create or replace function public.admin_grant_item(uid uuid, item text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff('dar-item', uid::text, jsonb_build_object('item', item));
  if not exists (select 1 from public.shop_items where id = item) then raise exception 'not_found'; end if;
  insert into public.user_items (user_id, item_id) values (uid, item) on conflict do nothing;
end;
$$;

create or replace function public.admin_reset_cosmetics(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff('zerar-visual', uid::text, null);
  update public.profiles set cosmetics = '{}'::jsonb where id = uid;
end;
$$;

create or replace function public.admin_rename_user(uid uuid, new_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff('renomear', uid::text, jsonb_build_object('nome', new_name));
  if new_name is null or char_length(trim(new_name)) not between 1 and 60 then raise exception 'bad_name'; end if;
  update public.profiles set name = trim(new_name) where id = uid;
end;
$$;

create or replace function public.admin_clear_avatar(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff('tirar-foto', uid::text, null);
  update public.profiles set avatar = null where id = uid;
end;
$$;

create or replace function public.admin_ban(uid uuid, hours integer, why text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid;
begin
  me := private.require_staff('suspender', uid::text, jsonb_build_object('horas', hours, 'motivo', why));
  if private.is_staff_uid(uid) then raise exception 'is_staff'; end if;
  insert into private.bans (user_id, reason, until, by_staff) values (uid, left(why, 200), case when hours is null or hours <= 0 then null else now() + make_interval(hours => hours) end, me)
  on conflict (user_id) do update set reason = excluded.reason, until = excluded.until, by_staff = excluded.by_staff, at = now();
end;
$$;

create or replace function public.admin_unban(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff('reativar', uid::text, null);
  delete from private.bans where user_id = uid;
end;
$$;

create or replace function public.admin_set_staff(uid uuid, make boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid;
begin
  me := private.require_staff(case when make then 'dar-suporte' else 'tirar-suporte' end, uid::text, null);
  if not make and uid = me then raise exception 'not_self'; end if;
  if make then insert into private.staff (user_id) values (uid) on conflict do nothing;
  else delete from private.staff where user_id = uid; end if;
end;
$$;

-- ============ Painel: turmas ============
create or replace function public.admin_turmas(search text)
returns table (id uuid, name text, icon text, owner_name text, owner_email text, members integer, players integer, babas integer, last_baba timestamptz, created_at timestamptz, invite_code text, staff_in boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff(null, null, null);
  return query
    select t.id, t.name, t.icon, p.name, u.email::text,
      (select count(*) from public.turma_members m where m.turma_id = t.id)::integer,
      (select count(*) from public.turma_players x where x.turma_id = t.id)::integer,
      (select count(*) from public.babas b where t.id = any(b.turma_ids) and b.finished)::integer,
      (select max(b.updated_at) from public.babas b where t.id = any(b.turma_ids)),
      t.created_at, t.invite_code,
      exists (select 1 from public.turma_members m where m.turma_id = t.id and m.user_id = (select auth.uid()))
    from public.turmas t
    left join public.profiles p on p.id = t.owner_id
    left join auth.users u on u.id = t.owner_id
    where coalesce(search, '') = '' or t.name ilike '%' || search || '%' or u.email ilike '%' || search || '%'
    order by t.created_at desc limit 200;
end;
$$;

-- Support enters a turma as a member to see what the group sees.
create or replace function public.admin_join_turma(t uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid;
begin
  me := private.require_staff('entrar-turma', t::text, null);
  insert into public.turma_members (turma_id, user_id, role) values (t, me, 'member') on conflict do nothing;
end;
$$;

create or replace function public.admin_leave_turma(t uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid;
begin
  me := private.require_staff('sair-turma', t::text, null);
  if exists (select 1 from public.turmas x where x.id = t and x.owner_id = me) then raise exception 'owner_must_transfer'; end if;
  delete from public.turma_members where turma_id = t and user_id = me;
end;
$$;

create or replace function public.admin_transfer_turma(t uuid, new_owner uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff('passar-turma', t::text, jsonb_build_object('para', new_owner));
  if not exists (select 1 from public.turma_members where turma_id = t and user_id = new_owner) then raise exception 'not_member'; end if;
  update public.turma_members set role = 'admin' where turma_id = t and user_id = new_owner;
  perform set_config('baba.owner_change', 'on', true);
  update public.turmas set owner_id = new_owner where id = t;
  perform set_config('baba.owner_change', '', true);
end;
$$;

create or replace function public.admin_turma_members(t uuid)
returns table (user_id uuid, name text, email text, role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff(null, null, null);
  return query
    select m.user_id, p.name, u.email::text, case when x.owner_id = m.user_id then 'owner' else m.role end
    from public.turma_members m join public.turmas x on x.id = m.turma_id
    left join public.profiles p on p.id = m.user_id left join auth.users u on u.id = m.user_id
    where m.turma_id = t order by 4 desc, 2;
end;
$$;

-- ============ Painel: denúncias ============
create or replace function public.admin_reports()
returns table (message_id bigint, body text, room text, author_id uuid, author_name text, author_email text, created_at timestamptz, deleted boolean, reports integer, reasons text[], last_report timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff(null, null, null);
  return query
    select m.id, m.body, m.room, m.user_id, p.name, u.email::text, m.created_at, m.deleted,
           count(r.id)::integer, array_agg(distinct coalesce(r.reason, '')), max(r.created_at)
    from public.chat_reports r join public.chat_messages m on m.id = r.message_id
    left join public.profiles p on p.id = m.user_id left join auth.users u on u.id = m.user_id
    group by m.id, p.name, u.email order by max(r.created_at) desc limit 100;
end;
$$;

create or replace function public.admin_resolve_report(msg bigint, act text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff('denuncia-' || act, msg::text, null);
  if act = 'delete' then update public.chat_messages set deleted = true, body = '-' where id = msg;
  elsif act = 'restore' then update public.chat_messages set deleted = false where id = msg and body <> '-';
  elsif act = 'dismiss' then delete from public.chat_reports where message_id = msg;
  else raise exception 'bad_action'; end if;
end;
$$;

-- ============ Painel: ao vivo ============
create or replace function public.admin_lives()
returns table (id uuid, code text, title text, owner_name text, active boolean, palpites boolean, updated_at timestamptz, open_palpites integer, total_palpites integer, viewers_chat integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff(null, null, null);
  return query
    select g.id, g.code, g.title, p.name, g.active, g.palpites, g.updated_at,
      (select count(*) from public.palpites x where x.live_id = g.id and x.status = 'open')::integer,
      (select count(*) from public.palpites x where x.live_id = g.id)::integer,
      (select count(distinct c.user_id) from public.chat_messages c where c.room = 'live:' || g.id::text)::integer
    from public.live_games g left join public.profiles p on p.id = g.owner
    order by g.updated_at desc limit 100;
end;
$$;

-- Ends a live game and gives back every open palpite.
create or replace function public.admin_end_live(live uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare p public.palpites; n integer := 0;
begin
  perform private.require_staff('encerrar-ao-vivo', live::text, null);
  for p in select * from public.palpites x where x.live_id = live and x.status = 'open' for update loop
    update public.palpites set status = 'void', payout = p.stake, settled_at = now() where id = p.id;
    perform private.add_points(p.user_id, p.stake, 'palpite-devolvido', p.id::text);
    n := n + 1;
  end loop;
  update public.live_games set active = false, markets = jsonb_build_object('open', false) where id = live;
  return n;
end;
$$;

-- ============ Painel: avisos e registro ============
create or replace function public.admin_set_notice(message text, lvl text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff('aviso', null, jsonb_build_object('mensagem', message));
  update public.app_notices set active = false where active;
  if message is not null and char_length(trim(message)) > 0 then
    insert into public.app_notices (message, level) values (left(trim(message), 280), case when lvl = 'warning' then 'warning' else 'info' end);
  end if;
end;
$$;

create or replace function public.admin_log(lim integer)
returns table (id bigint, staff_name text, action text, target text, details jsonb, at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff(null, null, null);
  return query
    select l.id, p.name, l.action, l.target, l.details, l.at
    from private.staff_log l left join public.profiles p on p.id = l.staff
    order by l.id desc limit least(greatest(coalesce(lim, 100), 1), 500);
end;
$$;

-- ============ Permissions ============
revoke execute on function private.is_staff_uid(uuid) from public, anon, authenticated;
revoke execute on function private.require_staff(text, text, jsonb) from public, anon, authenticated;
revoke execute on function private.is_banned(uuid) from public, anon;
grant execute on function private.is_banned(uuid) to authenticated;
revoke execute on function public.srv_is_staff(uuid) from public, anon, authenticated;
revoke execute on function public.srv_staff_log(uuid, text, text, jsonb) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.am_i_staff()', 'public.ping_activity()', 'public.my_status()', 'public.admin_overview()', 'public.admin_series(integer)',
    'public.admin_users(text, integer, integer)', 'public.admin_user(uuid)', 'public.admin_adjust_points(uuid, integer, text)',
    'public.admin_grant_item(uuid, text)', 'public.admin_reset_cosmetics(uuid)', 'public.admin_rename_user(uuid, text)',
    'public.admin_clear_avatar(uuid)', 'public.admin_ban(uuid, integer, text)', 'public.admin_unban(uuid)', 'public.admin_set_staff(uuid, boolean)',
    'public.admin_turmas(text)', 'public.admin_join_turma(uuid)', 'public.admin_leave_turma(uuid)', 'public.admin_transfer_turma(uuid, uuid)',
    'public.admin_turma_members(uuid)', 'public.admin_reports()', 'public.admin_resolve_report(bigint, text)', 'public.admin_lives()',
    'public.admin_end_live(uuid)', 'public.admin_set_notice(text, text)', 'public.admin_log(integer)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ============ A conta de suporte ============
-- Gives the support role to the account with this e-mail. Create the account in the app first.
insert into private.staff (user_id)
select id from auth.users where lower(email) = 'contatobabaapp@gmail.com'
on conflict do nothing;
