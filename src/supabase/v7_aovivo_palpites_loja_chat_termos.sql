-- BABA v7: jogo ao vivo (QR), palpites com baba points, lojinha, chat e aceite dos termos.
-- Baba points não têm valor: não se compram, não se sacam, não se transferem.
-- Pode rodar mais de uma vez.

-- ============ Conta: idade e aceite dos termos (só o dono da conta lê) ============
create table if not exists public.account_private (
  user_id uuid primary key references auth.users(id) on delete cascade,
  birth_date date,
  terms_version text,
  terms_accepted_at timestamptz
);
alter table public.account_private enable row level security;
drop policy if exists account_private_select on public.account_private;
create policy account_private_select on public.account_private for select to authenticated using (user_id = (select auth.uid()));

-- Itens equipados aparecem para todo mundo; só mudam pela função equip_item.
alter table public.profiles add column if not exists cosmetics jsonb not null default '{}'::jsonb;
revoke update on public.profiles from anon, authenticated;
grant update (name, avatar, prefs) on public.profiles to authenticated;

create or replace function private.is_adult(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.account_private a where a.user_id = uid and a.birth_date is not null
                 and a.birth_date <= (now() at time zone 'America/Sao_Paulo')::date - interval '18 years');
$$;

create or replace function public.accept_terms(version text, birth date)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); cur date;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if version is null or char_length(version) > 20 then raise exception 'bad_version'; end if;
  select birth_date into cur from public.account_private where user_id = uid;
  if cur is null then
    if birth is null or birth < date '1900-01-01' or birth > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'bad_birth'; end if;
    if birth > (now() at time zone 'America/Sao_Paulo')::date - interval '16 years' then raise exception 'too_young'; end if;
  end if;
  insert into public.account_private (user_id, birth_date, terms_version, terms_accepted_at)
  values (uid, coalesce(cur, birth), version, now())
  on conflict (user_id) do update set birth_date = coalesce(public.account_private.birth_date, excluded.birth_date),
    terms_version = excluded.terms_version, terms_accepted_at = excluded.terms_accepted_at;
end;
$$;

create or replace function public.my_account()
returns table (name text, avatar text, prefs jsonb, cosmetics jsonb, terms_version text, terms_accepted_at timestamptz, has_birth boolean, adult boolean)
language sql stable security definer set search_path = '' as $$
  select p.name, p.avatar, p.prefs, p.cosmetics, a.terms_version, a.terms_accepted_at, a.birth_date is not null, private.is_adult(p.id)
  from public.profiles p left join public.account_private a on a.user_id = p.id
  where p.id = (select auth.uid());
$$;

-- ============ Baba points ============
create table if not exists public.wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  daily_on date,
  created_at timestamptz not null default now()
);
create table if not exists public.points_ledger (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,
  reason text not null,
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists points_ledger_user on public.points_ledger (user_id, id desc);
alter table public.wallets enable row level security;
alter table public.points_ledger enable row level security;
drop policy if exists wallets_select on public.wallets;
create policy wallets_select on public.wallets for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists ledger_select on public.points_ledger;
create policy ledger_select on public.points_ledger for select to authenticated using (user_id = (select auth.uid()));

-- Every change of points goes through here (and is logged).
create or replace function private.add_points(uid uuid, delta integer, why text, ref text) returns integer
language plpgsql security definer set search_path = '' as $$
declare bal integer;
begin
  insert into public.wallets (user_id, balance) values (uid, 0) on conflict (user_id) do nothing;
  update public.wallets set balance = balance + delta where user_id = uid and balance + delta >= 0 returning balance into bal;
  if bal is null then raise exception 'no_points'; end if;
  insert into public.points_ledger (user_id, delta, reason, ref) values (uid, delta, why, ref);
  return bal;
end;
$$;

-- First call gives the welcome bonus.
create or replace function public.my_wallet()
returns table (balance integer, daily_available boolean, items text[])
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.wallets w where w.user_id = uid) then
    perform private.add_points(uid, 1000, 'boas-vindas', null);
  end if;
  return query
    select w.balance, (w.daily_on is null or w.daily_on < today),
           coalesce((select array_agg(i.item_id order by i.acquired_at) from public.user_items i where i.user_id = uid), '{}')
    from public.wallets w where w.user_id = uid;
end;
$$;

create or replace function public.claim_daily() returns integer
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); today date := (now() at time zone 'America/Sao_Paulo')::date; bal integer;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  perform 1 from public.my_wallet();
  update public.wallets set daily_on = today where user_id = uid and (daily_on is null or daily_on < today);
  if not found then raise exception 'already_claimed'; end if;
  bal := private.add_points(uid, 100, 'bonus-diario', today::text);
  return bal;
end;
$$;

-- ============ Lojinha ============
create table if not exists public.shop_items (
  id text primary key,
  kind text not null check (kind in ('frame', 'name', 'fx')),
  tier text,
  title text not null,
  price integer not null check (price > 0),
  sort integer not null default 0
);
alter table public.shop_items enable row level security;
drop policy if exists shop_select on public.shop_items;
create policy shop_select on public.shop_items for select to anon, authenticated using (true);

insert into public.shop_items (id, kind, tier, title, price, sort) values
  ('frame_bronze', 'frame', 'bronze', 'Moldura Bronze', 300, 10),
  ('frame_prata', 'frame', 'prata', 'Moldura Prata', 600, 11),
  ('frame_ouro', 'frame', 'ouro', 'Moldura Ouro', 1200, 12),
  ('frame_esmeralda', 'frame', 'esmeralda', 'Moldura Esmeralda', 2000, 13),
  ('frame_rubi', 'frame', 'rubi', 'Moldura Rubi', 3000, 14),
  ('frame_platina', 'frame', 'platina', 'Moldura Platina', 4500, 15),
  ('frame_diamante', 'frame', 'diamante', 'Moldura Diamante', 6000, 16),
  ('name_bronze', 'name', 'bronze', 'Nome Bronze', 200, 20),
  ('name_prata', 'name', 'prata', 'Nome Prata', 400, 21),
  ('name_ouro', 'name', 'ouro', 'Nome Dourado', 900, 22),
  ('name_esmeralda', 'name', 'esmeralda', 'Nome Esmeralda', 1500, 23),
  ('name_rubi', 'name', 'rubi', 'Nome Rubi', 2200, 24),
  ('name_platina', 'name', 'platina', 'Nome Platina', 3200, 25),
  ('name_diamante', 'name', 'diamante', 'Nome Diamante', 4500, 26),
  ('fx_frame_shine', 'fx', null, 'Brilho na moldura', 2500, 30),
  ('fx_name_shine', 'fx', null, 'Brilho no nome', 2000, 31)
on conflict (id) do update set kind = excluded.kind, tier = excluded.tier, title = excluded.title, price = excluded.price, sort = excluded.sort;

create table if not exists public.user_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null references public.shop_items(id),
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
alter table public.user_items enable row level security;
drop policy if exists user_items_select on public.user_items;
create policy user_items_select on public.user_items for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.buy_item(item text) returns integer
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); it public.shop_items; bal integer;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into it from public.shop_items where id = item;
  if it.id is null then raise exception 'not_found'; end if;
  if exists (select 1 from public.user_items where user_id = uid and item_id = item) then raise exception 'owned'; end if;
  perform 1 from public.my_wallet();
  bal := private.add_points(uid, -it.price, 'lojinha', item);
  insert into public.user_items (user_id, item_id) values (uid, item);
  return bal;
end;
$$;

-- slot: frame | name (item null = tirar) | frameShine | nameShine (item null = desligar)
create or replace function public.equip_item(slot text, item text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); it public.shop_items; cur jsonb; want text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if slot not in ('frame', 'name', 'frameShine', 'nameShine') then raise exception 'bad_slot'; end if;
  if item is not null then
    select * into it from public.shop_items where id = item;
    want := case slot when 'frame' then 'frame' when 'name' then 'name' else 'fx' end;
    if it.id is null or it.kind <> want then raise exception 'bad_item'; end if;
    if slot = 'frameShine' and item <> 'fx_frame_shine' then raise exception 'bad_item'; end if;
    if slot = 'nameShine' and item <> 'fx_name_shine' then raise exception 'bad_item'; end if;
    if not exists (select 1 from public.user_items where user_id = uid and item_id = item) then raise exception 'not_owned'; end if;
  end if;
  select cosmetics into cur from public.profiles where id = uid;
  cur := coalesce(cur, '{}'::jsonb);
  if item is null then cur := cur - slot;
  elsif slot in ('frame', 'name') then cur := cur || jsonb_build_object(slot, it.tier);
  else cur := cur || jsonb_build_object(slot, true);
  end if;
  update public.profiles set cosmetics = cur where id = uid;
  return cur;
end;
$$;

-- ============ Jogo ao vivo ============
create table if not exists public.live_games (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  baba_id uuid,
  turma_ids uuid[] not null default '{}',
  title text check (title is null or char_length(title) <= 80),
  state jsonb not null default '{}'::jsonb check (pg_column_size(state) < 200000),
  markets jsonb not null default '{}'::jsonb check (pg_column_size(markets) < 100000),
  palpites boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists live_games_owner on public.live_games (owner, active);
alter table public.live_games enable row level security;
drop policy if exists live_select on public.live_games;
create policy live_select on public.live_games for select to authenticated
  using (owner = (select auth.uid()) or private.is_member_any(turma_ids));
drop policy if exists live_insert on public.live_games;
create policy live_insert on public.live_games for insert to authenticated
  with check (owner = (select auth.uid()) and not exists (select 1 from unnest(turma_ids) t(id) where not private.is_member(t.id)));
drop policy if exists live_update on public.live_games;
create policy live_update on public.live_games for update to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()) and not exists (select 1 from unnest(turma_ids) t(id) where not private.is_member(t.id)));
drop policy if exists live_delete on public.live_games;
create policy live_delete on public.live_games for delete to authenticated using (owner = (select auth.uid()));
drop trigger if exists live_games_touch on public.live_games;
create trigger live_games_touch before update on public.live_games for each row execute function public.touch_updated_at();

-- Anyone with the code (or link) sees the scoreboard. Palpites only for adult accounts.
create or replace function public.get_live(live_code text)
returns table (id uuid, title text, state jsonb, markets jsonb, palpites boolean, active boolean, updated_at timestamptz, is_owner boolean)
language sql stable security definer set search_path = '' as $$
  select g.id, g.title, g.state,
         case when g.palpites and private.is_adult((select auth.uid())) then g.markets else null end,
         g.palpites, g.active, g.updated_at, g.owner = (select auth.uid())
  from public.live_games g where g.code = upper(live_code);
$$;

-- ============ Palpites ============
create table if not exists public.palpites (
  id bigserial primary key,
  live_id uuid not null references public.live_games(id) on delete cascade,
  match_no integer not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  market text not null,
  label text not null,
  odd numeric(6, 2) not null,
  stake integer not null check (stake between 10 and 500),
  status text not null default 'open' check (status in ('open', 'won', 'lost', 'void')),
  payout integer not null default 0,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists palpites_live on public.palpites (live_id, match_no, status);
create index if not exists palpites_user on public.palpites (user_id, id desc);
alter table public.palpites enable row level security;
drop policy if exists palpites_select on public.palpites;
create policy palpites_select on public.palpites for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.place_palpite(live uuid, market text, stake integer)
returns table (palpite_id bigint, balance integer, odd numeric)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); g public.live_games; it jsonb; o numeric; mno integer; bal integer; pid bigint;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
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

-- The organizer closes a match: result = {"winner":"A"|"B"|"draw","goalsA":n,"goalsB":n,"scorers":[keys]} or {"void":true}
create or replace function public.settle_palpites(live uuid, match_no integer, result jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); p public.palpites; won boolean; total integer; n integer := 0; m text;
begin
  if not exists (select 1 from public.live_games g where g.id = live and g.owner = uid) then raise exception 'only_owner'; end if;
  total := coalesce((result ->> 'goalsA')::integer, 0) + coalesce((result ->> 'goalsB')::integer, 0);
  for p in select * from public.palpites x where x.live_id = live and x.match_no = settle_palpites.match_no and x.status = 'open' for update loop
    m := p.market;
    if coalesce((result ->> 'void')::boolean, false) then
      update public.palpites set status = 'void', payout = p.stake, settled_at = now() where id = p.id;
      perform private.add_points(p.user_id, p.stake, 'palpite-devolvido', p.id::text);
    else
      won := case
        when m = 'res:A' then result ->> 'winner' = 'A'
        when m = 'res:B' then result ->> 'winner' = 'B'
        when m = 'res:draw' then result ->> 'winner' = 'draw'
        when m like 'gol:%' then coalesce(result -> 'scorers', '[]'::jsonb) ? substr(m, 5)
        when m like 'over:%' then total > substr(m, 6)::numeric
        when m = 'ambos' then coalesce((result ->> 'goalsA')::integer, 0) > 0 and coalesce((result ->> 'goalsB')::integer, 0) > 0
        else false end;
      if won then
        update public.palpites set status = 'won', payout = floor(p.stake * p.odd), settled_at = now() where id = p.id;
        perform private.add_points(p.user_id, floor(p.stake * p.odd)::integer, 'palpite-certo', p.id::text);
      else
        update public.palpites set status = 'lost', settled_at = now() where id = p.id;
      end if;
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Who did best in a live game (names only, no amounts staked)
create or replace function public.live_ranking(live uuid)
returns table (name text, avatar text, cosmetics jsonb, net integer, hits integer)
language sql stable security definer set search_path = '' as $$
  select pr.name, pr.avatar, pr.cosmetics,
         sum(case when p.status in ('won', 'void') then p.payout else 0 end - case when p.status = 'open' then 0 else p.stake end)::integer,
         count(*) filter (where p.status = 'won')::integer
  from public.palpites p join public.profiles pr on pr.id = p.user_id
  where p.live_id = live and p.status <> 'open'
    and exists (select 1 from public.live_games g where g.id = live)
  group by pr.id, pr.name, pr.avatar, pr.cosmetics
  order by 4 desc limit 10;
$$;

-- ============ Chat (turma e jogo ao vivo) ============
create table if not exists public.chat_messages (
  id bigserial primary key,
  room text not null check (room ~ '^(turma|live):[0-9a-f-]{36}$'),
  user_id uuid references auth.users(id) on delete set null default auth.uid(),
  body text not null check (char_length(body) between 1 and 500),
  deleted boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists chat_room on public.chat_messages (room, id desc);
alter table public.chat_messages enable row level security;

create or replace function private.can_read_room(r text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare k text := split_part(r, ':', 1); rid uuid := split_part(r, ':', 2)::uuid;
begin
  if k = 'turma' then return private.is_member(rid); end if;
  if k = 'live' then return exists (select 1 from public.live_games g where g.id = rid); end if;
  return false;
end;
$$;

drop policy if exists chat_select on public.chat_messages;
create policy chat_select on public.chat_messages for select to authenticated using (private.can_read_room(room));
drop policy if exists chat_insert on public.chat_messages;
create policy chat_insert on public.chat_messages for insert to authenticated
  with check (user_id = (select auth.uid()) and deleted = false and private.can_read_room(room)
              and exists (select 1 from public.account_private a where a.user_id = (select auth.uid()) and a.terms_accepted_at is not null));

-- At most 5 messages in 10 seconds per person.
create or replace function private.chat_rate_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.chat_messages m where m.user_id = new.user_id and m.created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'slow_down';
  end if;
  return new;
end;
$$;
drop trigger if exists chat_rate on public.chat_messages;
create trigger chat_rate before insert on public.chat_messages for each row execute function private.chat_rate_limit();

create or replace function public.delete_message(msg bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.chat_messages; uid uuid := (select auth.uid()); k text; rid uuid;
begin
  select * into m from public.chat_messages where id = msg;
  if m.id is null then raise exception 'not_found'; end if;
  k := split_part(m.room, ':', 1); rid := split_part(m.room, ':', 2)::uuid;
  if not (m.user_id = uid
          or (k = 'turma' and private.is_admin(rid))
          or (k = 'live' and exists (select 1 from public.live_games g where g.id = rid and g.owner = uid))) then
    raise exception 'not_allowed';
  end if;
  update public.chat_messages set deleted = true, body = '-' where id = msg;
end;
$$;

create table if not exists public.chat_reports (
  id bigserial primary key,
  message_id bigint not null references public.chat_messages(id) on delete cascade,
  reporter uuid not null references auth.users(id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  unique (message_id, reporter)
);
alter table public.chat_reports enable row level security;

-- Three different people reporting hides the message until someone reviews it.
create or replace function public.report_message(msg bigint, why text) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.chat_messages; uid uuid := (select auth.uid());
begin
  select * into m from public.chat_messages where id = msg;
  if m.id is null or not private.can_read_room(m.room) then raise exception 'not_found'; end if;
  insert into public.chat_reports (message_id, reporter, reason) values (msg, uid, left(why, 200)) on conflict do nothing;
  if (select count(*) from public.chat_reports r where r.message_id = msg) >= 3 then
    update public.chat_messages set deleted = true where id = msg;
  end if;
end;
$$;

-- Live chat for people watching by code (no account needed to read).
create or replace function public.live_chat(live_code text, after_id bigint)
returns table (id bigint, user_id uuid, name text, avatar text, cosmetics jsonb, body text, deleted boolean, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.id, m.user_id, coalesce(p.name, 'Conta excluída'), p.avatar, coalesce(p.cosmetics, '{}'::jsonb),
         case when m.deleted then '' else m.body end, m.deleted, m.created_at
  from public.live_games g
  join public.chat_messages m on m.room = 'live:' || g.id::text
  left join public.profiles p on p.id = m.user_id
  where g.code = upper(live_code) and m.id > coalesce(after_id, 0)
  order by m.id desc limit 60;
$$;

-- Names, pictures and items of the people in a chat.
create or replace function public.people_cards(ids uuid[])
returns table (id uuid, name text, avatar text, cosmetics jsonb)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name, p.avatar, p.cosmetics from public.profiles p where p.id = any(ids[1:200]);
$$;

-- ============ Realtime ============
do $$ begin
  begin alter publication supabase_realtime add table public.chat_messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.live_games; exception when duplicate_object then null; end;
end $$;

-- ============ Permissions ============
revoke execute on function private.is_adult(uuid) from public, anon;
revoke execute on function private.add_points(uuid, integer, text, text) from public, anon, authenticated;
revoke execute on function private.can_read_room(text) from public, anon;
grant execute on function private.is_adult(uuid) to authenticated;
grant execute on function private.can_read_room(text) to authenticated;

revoke execute on function public.accept_terms(text, date) from public, anon;
revoke execute on function public.my_account() from public, anon;
revoke execute on function public.my_wallet() from public, anon;
revoke execute on function public.claim_daily() from public, anon;
revoke execute on function public.buy_item(text) from public, anon;
revoke execute on function public.equip_item(text, text) from public, anon;
revoke execute on function public.place_palpite(uuid, text, integer) from public, anon;
revoke execute on function public.settle_palpites(uuid, integer, jsonb) from public, anon;
revoke execute on function public.live_ranking(uuid) from public;
revoke execute on function public.delete_message(bigint) from public, anon;
revoke execute on function public.report_message(bigint, text) from public, anon;
revoke execute on function public.people_cards(uuid[]) from public, anon;
grant execute on function public.accept_terms(text, date) to authenticated;
grant execute on function public.my_account() to authenticated;
grant execute on function public.my_wallet() to authenticated;
grant execute on function public.claim_daily() to authenticated;
grant execute on function public.buy_item(text) to authenticated;
grant execute on function public.equip_item(text, text) to authenticated;
grant execute on function public.place_palpite(uuid, text, integer) to authenticated;
grant execute on function public.settle_palpites(uuid, integer, jsonb) to authenticated;
grant execute on function public.live_ranking(uuid) to anon, authenticated;
grant execute on function public.delete_message(bigint) to authenticated;
grant execute on function public.report_message(bigint, text) to authenticated;
grant execute on function public.people_cards(uuid[]) to authenticated;
grant execute on function public.get_live(text) to anon, authenticated;
grant execute on function public.live_chat(text, bigint) to anon, authenticated;
