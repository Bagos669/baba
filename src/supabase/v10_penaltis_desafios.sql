-- BABA v10: pênaltis nas estatísticas e Desafio 1v1 de palpites.
-- Rode DEPOIS do v9.5. Pode rodar mais de uma vez.

-- ============ Pênaltis ============
alter table public.baba_stats add column if not exists pen_goals integer not null default 0;
alter table public.baba_stats add column if not exists pen_misses integer not null default 0;
alter table public.baba_stats add column if not exists pen_saves integer not null default 0;

-- ============ Desafio 1v1 ============
-- Two adults put the same amount of baba points on opposite sides of the next result.
-- The winner takes both stakes; a tie gives each one their points back. Points never become money.
create table if not exists public.challenges (
  id bigserial primary key,
  live_id uuid not null references public.live_games(id) on delete cascade,
  match_no integer not null,
  kind text not null check (kind in ('vencedor', 'gols')),
  challenger uuid not null references auth.users(id) on delete cascade,
  opponent uuid not null references auth.users(id) on delete cascade,
  stake integer not null check (stake between 10 and 500),
  pick_c text not null check (char_length(pick_c) between 1 and 60),
  pick_o text not null check (char_length(pick_o) between 1 and 60),
  label_c text not null check (char_length(label_c) between 1 and 80),
  label_o text not null check (char_length(label_o) between 1 and 80),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'canceled', 'won_c', 'won_o', 'push', 'void')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists challenges_live on public.challenges (live_id, match_no);
alter table public.challenges enable row level security;
drop policy if exists challenges_select on public.challenges;
create policy challenges_select on public.challenges for select to authenticated
  using (challenger = (select auth.uid()) or opponent = (select auth.uid()));

-- The live game is taking palpites for this match right now.
create or replace function private.live_open_for(live uuid) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare g public.live_games;
begin
  select * into g from public.live_games where id = live;
  if g.id is null or not g.active or not g.palpites then return null; end if;
  if coalesce((g.markets ->> 'open')::boolean, false) = false then return null; end if;
  if g.markets ? 'closes_at' and (g.markets ->> 'closes_at') is not null and (g.markets ->> 'closes_at')::timestamptz < now() then return null; end if;
  return (g.markets ->> 'match_no')::integer;
end;
$$;

create or replace function private.can_challenge(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_adult(uid) and not private.is_banned(uid)
     and exists (select 1 from public.account_private a where a.user_id = uid and a.terms_accepted_at is not null);
$$;

-- People you can challenge in this live game: whoever chatted or palpitou here, and (if you are
-- in the turma) the turma's members. Only adults with the terms accepted.
create or replace function public.challenge_candidates(live uuid)
returns table (id uuid, name text, avatar text, cosmetics jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); g public.live_games;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into g from public.live_games where live_games.id = live;
  if g.id is null then raise exception 'no_game'; end if;
  return query
    select p.id, p.name, case when p.avatar like 'data:image/%' then null else p.avatar end, coalesce(p.cosmetics, '{}'::jsonb)
    from public.profiles p
    where p.id <> uid and p.id <> g.owner and private.can_challenge(p.id)
      and (exists (select 1 from public.chat_messages c where c.room = 'live:' || g.id::text and c.user_id = p.id)
        or exists (select 1 from public.palpites x where x.live_id = g.id and x.user_id = p.id)
        or (private.is_member_any(g.turma_ids) and exists (select 1 from public.turma_members m where m.user_id = p.id and m.turma_id = any(g.turma_ids))))
    order by p.name limit 100;
end;
$$;

create or replace function public.create_challenge(live uuid, opponent uuid, kind text, pick_c text, pick_o text, label_c text, label_o text, stake integer)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); g public.live_games; mno integer; cid bigint;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not private.can_challenge(uid) then raise exception 'adult_only'; end if;
  select * into g from public.live_games where id = live;
  mno := private.live_open_for(live);
  if mno is null then raise exception 'closed'; end if;
  if g.owner = uid or g.owner = opponent then raise exception 'own_game'; end if;
  if opponent = uid then raise exception 'self'; end if;
  if not private.can_challenge(opponent) then raise exception 'opponent_not_allowed'; end if;
  if kind not in ('vencedor', 'gols') then raise exception 'bad_kind'; end if;
  if kind = 'vencedor' then
    pick_c := upper(trim(pick_c)); pick_o := upper(trim(pick_o));
    if not ((pick_c = 'A' and pick_o = 'B') or (pick_c = 'B' and pick_o = 'A')) then raise exception 'bad_pick'; end if;
  else
    pick_c := left(lower(trim(pick_c)), 60); pick_o := left(lower(trim(pick_o)), 60);
    -- both have to be on the court in this match
    if not exists (select 1 from jsonb_array_elements_text(coalesce(g.state -> 'A' -> 'names', '[]'::jsonb) || coalesce(g.state -> 'B' -> 'names', '[]'::jsonb)) n where left(lower(trim(n)), 60) = pick_c)
       or not exists (select 1 from jsonb_array_elements_text(coalesce(g.state -> 'A' -> 'names', '[]'::jsonb) || coalesce(g.state -> 'B' -> 'names', '[]'::jsonb)) n where left(lower(trim(n)), 60) = pick_o) then
      raise exception 'bad_pick';
    end if;
  end if;
  if pick_c = pick_o then raise exception 'bad_pick'; end if;
  if stake is null or stake < 10 or stake > 500 then raise exception 'bad_stake'; end if;
  if (select count(*) from public.challenges c where c.challenger = uid and c.live_id = live and c.match_no = mno and c.status in ('pending', 'accepted')) >= 3 then raise exception 'limit'; end if;
  perform 1 from public.my_wallet();
  perform private.add_points(uid, -stake, 'desafio', live::text || ':' || mno);
  insert into public.challenges (live_id, match_no, kind, challenger, opponent, stake, pick_c, pick_o, label_c, label_o)
  values (live, mno, kind, uid, opponent, stake, pick_c, pick_o, left(label_c, 80), left(label_o, 80))
  returning id into cid;
  return cid;
end;
$$;

create or replace function public.respond_challenge(challenge bigint, accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); c public.challenges;
begin
  select * into c from public.challenges where id = challenge for update;
  if c.id is null or c.opponent <> uid then raise exception 'not_found'; end if;
  if c.status <> 'pending' then raise exception 'already'; end if;
  if not accept then
    update public.challenges set status = 'declined', decided_at = now() where id = c.id;
    perform private.add_points(c.challenger, c.stake, 'desafio-devolvido', c.id::text);
    return 'declined';
  end if;
  -- too late: it stays pending and comes back to the challenger when the match is settled
  if private.live_open_for(c.live_id) is distinct from c.match_no then raise exception 'closed'; end if;
  if not private.can_challenge(uid) then raise exception 'adult_only'; end if;
  perform 1 from public.my_wallet();
  perform private.add_points(uid, -c.stake, 'desafio', c.id::text);
  update public.challenges set status = 'accepted', decided_at = now() where id = c.id;
  return 'accepted';
end;
$$;

create or replace function public.cancel_challenge(challenge bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); c public.challenges;
begin
  select * into c from public.challenges where id = challenge for update;
  if c.id is null or c.challenger <> uid then raise exception 'not_found'; end if;
  if c.status <> 'pending' then raise exception 'already'; end if;
  update public.challenges set status = 'canceled', decided_at = now() where id = c.id;
  perform private.add_points(uid, c.stake, 'desafio-devolvido', c.id::text);
end;
$$;

create or replace function public.my_challenges(live uuid)
returns table (id bigint, match_no integer, kind text, stake integer, status text, mine_is_challenger boolean,
               other_id uuid, other_name text, my_label text, their_label text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, c.match_no, c.kind, c.stake, c.status, c.challenger = (select auth.uid()),
         case when c.challenger = (select auth.uid()) then c.opponent else c.challenger end,
         coalesce((select p.name from public.profiles p where p.id = case when c.challenger = (select auth.uid()) then c.opponent else c.challenger end), 'Conta excluída'),
         case when c.challenger = (select auth.uid()) then c.label_c else c.label_o end,
         case when c.challenger = (select auth.uid()) then c.label_o else c.label_c end,
         c.created_at
  from public.challenges c
  where c.live_id = live and (c.challenger = (select auth.uid()) or c.opponent = (select auth.uid()))
  order by c.id desc limit 30;
$$;

-- Settles every challenge of a match (called from settle_palpites, so only the game's owner triggers it).
create or replace function private.settle_challenges(live uuid, mno integer, result jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.challenges; w text; gc integer; go integer; voided boolean := coalesce((result ->> 'void')::boolean, false);
begin
  for c in select * from public.challenges x where x.live_id = live and x.match_no = mno and x.status in ('pending', 'accepted') for update loop
    if c.status = 'pending' or voided then
      update public.challenges set status = 'void', decided_at = now() where id = c.id;
      perform private.add_points(c.challenger, c.stake, 'desafio-devolvido', c.id::text);
      if c.status = 'accepted' then perform private.add_points(c.opponent, c.stake, 'desafio-devolvido', c.id::text); end if;
      continue;
    end if;
    if c.kind = 'vencedor' then
      w := case when result ->> 'winner' = c.pick_c then 'c' when result ->> 'winner' = c.pick_o then 'o' else 'push' end;
    else
      gc := coalesce((result -> 'goalsBy' ->> c.pick_c)::integer, case when coalesce(result -> 'scorers', '[]'::jsonb) ? c.pick_c then 1 else 0 end);
      go := coalesce((result -> 'goalsBy' ->> c.pick_o)::integer, case when coalesce(result -> 'scorers', '[]'::jsonb) ? c.pick_o then 1 else 0 end);
      w := case when gc > go then 'c' when go > gc then 'o' else 'push' end;
    end if;
    if w = 'c' then
      update public.challenges set status = 'won_c', decided_at = now() where id = c.id;
      perform private.add_points(c.challenger, c.stake * 2, 'desafio-ganho', c.id::text);
    elsif w = 'o' then
      update public.challenges set status = 'won_o', decided_at = now() where id = c.id;
      perform private.add_points(c.opponent, c.stake * 2, 'desafio-ganho', c.id::text);
    else
      update public.challenges set status = 'push', decided_at = now() where id = c.id;
      perform private.add_points(c.challenger, c.stake, 'desafio-devolvido', c.id::text);
      perform private.add_points(c.opponent, c.stake, 'desafio-devolvido', c.id::text);
    end if;
  end loop;
end;
$$;

-- Same as v7, plus the challenges of the match.
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
  perform private.settle_challenges(live, settle_palpites.match_no, result);
  return n;
end;
$$;

-- Support ends a live game: palpites and challenges come back.
create or replace function public.admin_end_live(live uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare p public.palpites; n integer := 0; c public.challenges;
begin
  perform private.require_staff('encerrar-ao-vivo', live::text, null);
  for p in select * from public.palpites x where x.live_id = live and x.status = 'open' for update loop
    update public.palpites set status = 'void', payout = p.stake, settled_at = now() where id = p.id;
    perform private.add_points(p.user_id, p.stake, 'palpite-devolvido', p.id::text);
    n := n + 1;
  end loop;
  for c in select * from public.challenges x where x.live_id = live and x.status in ('pending', 'accepted') for update loop
    update public.challenges set status = 'void', decided_at = now() where id = c.id;
    perform private.add_points(c.challenger, c.stake, 'desafio-devolvido', c.id::text);
    if c.status = 'accepted' then perform private.add_points(c.opponent, c.stake, 'desafio-devolvido', c.id::text); end if;
  end loop;
  update public.live_games set active = false, markets = jsonb_build_object('open', false) where id = live;
  return n;
end;
$$;

revoke execute on function private.live_open_for(uuid) from public, anon, authenticated;
revoke execute on function private.can_challenge(uuid) from public, anon, authenticated;
revoke execute on function private.settle_challenges(uuid, integer, jsonb) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.challenge_candidates(uuid)', 'public.create_challenge(uuid, uuid, text, text, text, text, text, integer)',
    'public.respond_challenge(bigint, boolean)', 'public.cancel_challenge(bigint)', 'public.my_challenges(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
