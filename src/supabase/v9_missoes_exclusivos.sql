-- BABA v9: missões semanais (baba points) e itens exclusivos.
-- Rode DEPOIS do v8. Pode rodar mais de uma vez.

-- ============ Itens exclusivos ============
-- exclusive: null = à venda na lojinha · 'fundador' = 100 primeiros cadastrados · 'dono' = contas da equipe BABA
alter table public.shop_items add column if not exists exclusive text check (exclusive is null or exclusive in ('fundador', 'dono'));
alter table public.shop_items drop constraint if exists shop_items_price_check;
alter table public.shop_items add constraint shop_items_price_check check (price >= 0);

insert into public.shop_items (id, kind, tier, title, price, sort, exclusive) values
  ('frame_teal_orange', 'frame', 'tealorange', 'Moldura Teal & Orange Metálico', 0, 17, 'dono'),
  ('name_teal_orange', 'name', 'tealorange', 'Nome Teal & Orange Metálico', 0, 27, 'dono'),
  ('fx_frame_fogo_azul', 'fx', 'fogo-azul', 'Brilho Moldura · Aura de Fogo Azul', 0, 32, 'fundador'),
  ('fx_name_fogo_azul', 'fx', 'fogo-azul', 'Brilho Nome · Aura de Fogo Azul', 0, 33, 'fundador')
on conflict (id) do update set kind = excluded.kind, tier = excluded.tier, title = excluded.title, price = excluded.price, sort = excluded.sort, exclusive = excluded.exclusive;

-- Who gets the team-only items.
create table if not exists private.exclusive_emails (email text primary key);
insert into private.exclusive_emails (email) values ('gabrieljastim13@gmail.com'), ('contatobabaapp@gmail.com') on conflict do nothing;

-- The first 100 accounts, in signup order. The number is kept even if earlier accounts are deleted.
create table if not exists private.founders (
  user_id uuid primary key references auth.users(id) on delete cascade,
  n integer not null unique check (n between 1 and 100)
);
insert into private.founders (user_id, n)
select id, rn from (
  select u.id, row_number() over (order by u.created_at, u.id) + coalesce((select max(n) from private.founders), 0) rn
  from auth.users u where not exists (select 1 from private.founders f where f.user_id = u.id)
  order by u.created_at, u.id
) x where rn <= 100
on conflict do nothing;

create or replace function private.add_founder() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform pg_advisory_xact_lock(hashtext('baba_founders'));
    insert into private.founders (user_id, n)
    select new.id, coalesce(max(n), 0) + 1 from private.founders having coalesce(max(n), 0) < 100
    on conflict do nothing;
  exception when others then null; -- never block a signup
  end;
  return new;
end;
$$;
drop trigger if exists profiles_founder on public.profiles;
create trigger profiles_founder after insert on public.profiles for each row execute function private.add_founder();
revoke execute on function private.add_founder() from public, anon, authenticated;

-- Hands out the exclusive items an account is entitled to (called by my_wallet).
create or replace function private.grant_exclusives(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from private.founders f where f.user_id = uid) then
    insert into public.user_items (user_id, item_id) select uid, s.id from public.shop_items s where s.exclusive = 'fundador' on conflict do nothing;
  end if;
  if exists (select 1 from auth.users u join private.exclusive_emails e on e.email = lower(u.email) where u.id = uid) then
    insert into public.user_items (user_id, item_id) select uid, s.id from public.shop_items s where s.exclusive = 'dono' on conflict do nothing;
  end if;
end;
$$;
revoke execute on function private.grant_exclusives(uuid) from public, anon, authenticated;

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
  perform private.grant_exclusives(uid);
  return query
    select w.balance, (w.daily_on is null or w.daily_on < today),
           coalesce((select array_agg(i.item_id order by i.acquired_at) from public.user_items i where i.user_id = uid), '{}')
    from public.wallets w where w.user_id = uid;
end;
$$;

-- Exclusive items are never sold.
create or replace function public.buy_item(item text) returns integer
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); it public.shop_items; bal integer;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into it from public.shop_items where id = item;
  if it.id is null then raise exception 'not_found'; end if;
  if it.exclusive is not null then raise exception 'exclusive'; end if;
  if exists (select 1 from public.user_items where user_id = uid and item_id = item) then raise exception 'owned'; end if;
  perform 1 from public.my_wallet();
  bal := private.add_points(uid, -it.price, 'lojinha', item);
  insert into public.user_items (user_id, item_id) values (uid, item);
  return bal;
end;
$$;

-- Effects: frameShine / nameShine take any fx_frame_* / fx_name_* item; the value is its style (true = brilho, 'fogo-azul').
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
    if slot = 'frameShine' and item not like 'fx\_frame\_%' then raise exception 'bad_item'; end if;
    if slot = 'nameShine' and item not like 'fx\_name\_%' then raise exception 'bad_item'; end if;
    if not exists (select 1 from public.user_items where user_id = uid and item_id = item) then raise exception 'not_owned'; end if;
  end if;
  select cosmetics into cur from public.profiles where id = uid;
  cur := coalesce(cur, '{}'::jsonb);
  if item is null then cur := cur - slot;
  elsif slot in ('frame', 'name') then cur := cur || jsonb_build_object(slot, it.tier);
  else cur := cur || jsonb_build_object(slot, coalesce(to_jsonb(it.tier), 'true'::jsonb));
  end if;
  update public.profiles set cosmetics = cur where id = uid;
  return cur;
end;
$$;

-- ============ Missões semanais ============
-- Progress is always counted from the server's own records, so nobody can fake it.
create table if not exists public.missions (
  id text primary key,
  title text not null,
  description text not null,
  metric text not null check (metric in ('days_active', 'daily_bonus', 'babas_played', 'babas_organized', 'goals', 'chat', 'palpites')),
  target integer not null check (target > 0),
  reward integer not null check (reward > 0 and reward <= 1000),
  adult_only boolean not null default false,
  active boolean not null default true,
  sort integer not null default 0
);
alter table public.missions enable row level security;
drop policy if exists missions_select on public.missions;
create policy missions_select on public.missions for select to authenticated using (active);

insert into public.missions (id, title, description, metric, target, reward, adult_only, sort) values
  ('presenca', 'Presença garantida', 'Abra o BABA em 3 dias diferentes da semana', 'days_active', 3, 100, false, 10),
  ('bonus', 'Bônus em dia', 'Pegue o bônus do dia 4 vezes na semana', 'daily_bonus', 4, 100, false, 20),
  ('jogar', 'Bola rolando', 'Jogue 1 baba (com seu nome ligado à conta na turma)', 'babas_played', 1, 150, false, 30),
  ('organizar', 'Organizador da semana', 'Finalize 1 baba que você organizou', 'babas_organized', 1, 200, false, 40),
  ('artilheiro', 'Faro de gol', 'Marque 3 gols nos babas da semana', 'goals', 3, 200, false, 50),
  ('resenha', 'Resenha em dia', 'Mande 3 mensagens no chat da turma ou do jogo', 'chat', 3, 50, false, 60),
  ('palpiteiro', 'Palpiteiro', 'Faça 3 palpites em jogos ao vivo', 'palpites', 3, 80, true, 70)
on conflict (id) do update set title = excluded.title, description = excluded.description, metric = excluded.metric, target = excluded.target,
  reward = excluded.reward, adult_only = excluded.adult_only, sort = excluded.sort;

create table if not exists public.mission_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_id text not null references public.missions(id) on delete cascade,
  week date not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, mission_id, week)
);
alter table public.mission_claims enable row level security;
drop policy if exists mission_claims_select on public.mission_claims;
create policy mission_claims_select on public.mission_claims for select to authenticated using (user_id = (select auth.uid()));

-- The week starts on Monday, Brasília time.
create or replace function private.week_start() returns date
language sql stable set search_path = '' as $$
  select date_trunc('week', now() at time zone 'America/Sao_Paulo')::date;
$$;

create or replace function private.mission_progress(uid uuid, metric text, ws date) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare we date := ws + 6; n integer := 0;
begin
  if metric = 'days_active' then
    select count(*) into n from public.user_days d where d.user_id = uid and d.day between ws and we;
  elsif metric = 'daily_bonus' then
    select count(*) into n from public.points_ledger l where l.user_id = uid and l.reason = 'bonus-diario'
      and (l.created_at at time zone 'America/Sao_Paulo')::date between ws and we;
  elsif metric = 'babas_played' then
    select count(distinct b.id) into n from public.babas b
      join public.baba_stats s on s.baba_id = b.id
      join public.turma_players tp on tp.id = s.turma_player_id and tp.user_id = uid
      where b.finished and coalesce(s.matches, 0) > 0 and (b.updated_at at time zone 'America/Sao_Paulo')::date between ws and we;
  elsif metric = 'babas_organized' then
    select count(*) into n from public.babas b where b.created_by = uid and b.finished and coalesce(b.matches, 0) > 0
      and (b.updated_at at time zone 'America/Sao_Paulo')::date between ws and we;
  elsif metric = 'goals' then
    select coalesce(sum(s.goals), 0) into n from public.babas b
      join public.baba_stats s on s.baba_id = b.id
      join public.turma_players tp on tp.id = s.turma_player_id and tp.user_id = uid
      where b.finished and (b.updated_at at time zone 'America/Sao_Paulo')::date between ws and we;
  elsif metric = 'chat' then
    select count(*) into n from public.chat_messages c where c.user_id = uid and not c.deleted
      and (c.created_at at time zone 'America/Sao_Paulo')::date between ws and we;
  elsif metric = 'palpites' then
    select count(*) into n from public.palpites p where p.user_id = uid
      and (p.created_at at time zone 'America/Sao_Paulo')::date between ws and we;
  end if;
  return coalesce(n, 0);
end;
$$;
revoke execute on function private.mission_progress(uuid, text, date) from public, anon, authenticated;

create or replace function public.my_missions()
returns table (id text, title text, description text, target integer, reward integer, progress integer, claimed boolean, week_start date, week_end date)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); ws date := private.week_start(); adult boolean;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  adult := private.is_adult(uid);
  return query
    select m.id, m.title, m.description, m.target, m.reward,
           least(private.mission_progress(uid, m.metric, ws), m.target),
           exists (select 1 from public.mission_claims c where c.user_id = uid and c.mission_id = m.id and c.week = ws),
           ws, ws + 6
    from public.missions m
    where m.active and (not m.adult_only or adult)
    order by m.sort;
end;
$$;

create or replace function public.claim_mission(mission text) returns integer
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); ws date := private.week_start(); m public.missions;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into m from public.missions x where x.id = mission and x.active;
  if m.id is null then raise exception 'not_found'; end if;
  if m.adult_only and not private.is_adult(uid) then raise exception 'adult_only'; end if;
  if private.mission_progress(uid, m.metric, ws) < m.target then raise exception 'not_done'; end if;
  insert into public.mission_claims (user_id, mission_id, week) values (uid, m.id, ws) on conflict do nothing;
  if not found then raise exception 'already_claimed'; end if;
  perform 1 from public.my_wallet();
  return private.add_points(uid, m.reward, 'missao', m.id || ':' || ws::text);
end;
$$;

revoke execute on function public.my_missions() from public, anon;
revoke execute on function public.claim_mission(text) from public, anon;
grant execute on function public.my_missions() to authenticated;
grant execute on function public.claim_mission(text) to authenticated;
