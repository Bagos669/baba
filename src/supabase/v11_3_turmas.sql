-- BABA v11.2 (Turmas): privacidade, rankings, troféus, prestígio, desafios entre turmas e campeonatos.
-- Rode DEPOIS do v11_compromisso.sql (e do v11_2_convidados.sql). Pode rodar mais de uma vez.
-- Nada de regra fica no app: pesos do prestígio, temporadas e resultados vêm daqui.

-- ============ Privacidade ============
alter table public.turmas add column if not exists is_public boolean not null default false;

create or replace function private.can_see(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_member(t) or exists (select 1 from public.turmas x where x.id = t and x.is_public);
$$;

create or replace function public.set_turma_privacy(t uuid, pub boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin(t) then raise exception 'not_allowed'; end if;
  update public.turmas set is_public = coalesce(pub, false) where id = t;
  -- Virou privada: sai das disputas abertas e dos campeonatos que ainda não começaram.
  if not coalesce(pub, false) then
    update public.turma_matches set status = 'canceled', decided_at = now() where home = t and status in ('open', 'pending');
  end if;
end;
$$;

-- ============ Temporadas (semestres) ============
create or replace function private.season_of(d date) returns text
language sql immutable set search_path = '' as $$
  select extract(year from d)::integer::text || '-S' || case when extract(month from d) <= 6 then '1' else '2' end;
$$;
create or replace function private.season_start(s text) returns date
language sql immutable set search_path = '' as $$
  select make_date(split_part(s, '-S', 1)::integer, case split_part(s, '-S', 2) when '1' then 1 else 7 end, 1);
$$;
create or replace function private.season_end(s text) returns date
language sql immutable set search_path = '' as $$
  select (private.season_start(s) + interval '6 months')::date;
$$;

-- ============ Números dos atletas de uma turma ============
-- Só entram os atletas da turma; linhas soltas (sem id) casam pelo nome.
create or replace function private.stat_rows(t uuid, from_d date, to_d date, only_baba uuid)
returns table (pid uuid, pname text, goals integer, assists integer, saves integer, matches integer, wins integer, babas integer)
language sql stable security definer set search_path = '' as $$
  select tp.id, min(tp.name), coalesce(sum(s.goals), 0)::integer, coalesce(sum(s.assists), 0)::integer, coalesce(sum(s.saves), 0)::integer,
         coalesce(sum(s.matches), 0)::integer, coalesce(sum(s.wins), 0)::integer, count(distinct s.baba_id)::integer
  from public.baba_stats s
  join public.babas b on b.id = s.baba_id and b.finished
  join public.turma_players tp on tp.turma_id = t
    and (tp.id = s.turma_player_id or (s.turma_player_id is null and lower(trim(tp.name)) = lower(trim(s.name))))
  where t = any (b.turma_ids)
    and ((only_baba is null and b.played_on >= from_d and b.played_on < to_d) or (only_baba is not null and b.id = only_baba))
  group by tp.id;
$$;

create or replace function private.metric_of(m text, goals integer, assists integer, saves integer, matches integer, wins integer) returns integer
language sql immutable set search_path = '' as $$
  select case m when 'goals' then goals when 'assists' then assists when 'part' then goals + assists
                when 'wins' then wins when 'matches' then matches when 'saves' then saves end;
$$;

-- ============ Ranking Top 10 / Top 26 ============
-- period: 'last' (última partida da turma) ou 'season' (temporada atual, um semestre).
create or replace function public.turma_ranking(t uuid, period text, metric text, lim integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s text := private.season_of(current_date); b uuid; bd date; n integer; rows jsonb; l integer := least(greatest(coalesce(lim, 10), 1), 26);
begin
  if not private.can_see(t) then raise exception 'not_found'; end if;
  if period not in ('last', 'season') or metric not in ('goals', 'assists', 'part', 'wins', 'matches', 'saves') then raise exception 'bad_args'; end if;
  if period = 'last' then
    select x.id, x.played_on into b, bd from public.babas x where x.finished and t = any (x.turma_ids) order by x.played_on desc, x.created_at desc limit 1;
    if b is null then return jsonb_build_object('period', 'last', 'label', null, 'babas', 0, 'rows', '[]'::jsonb); end if;
    n := 1;
  else
    select count(distinct x.id) into n from public.babas x where x.finished and t = any (x.turma_ids) and x.played_on >= private.season_start(s) and x.played_on < private.season_end(s);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('rank', r.rk, 'player_id', r.pid, 'name', r.pname, 'value', r.v, 'babas', r.babas, 'matches', r.matches) order by r.rk), '[]'::jsonb) into rows
  from (
    select x.pid, x.pname, x.babas, x.matches, private.metric_of(metric, x.goals, x.assists, x.saves, x.matches, x.wins) as v,
           row_number() over (order by private.metric_of(metric, x.goals, x.assists, x.saves, x.matches, x.wins) desc, x.matches asc, x.pname) as rk
    from private.stat_rows(t, private.season_start(s), private.season_end(s), b) x
    where private.metric_of(metric, x.goals, x.assists, x.saves, x.matches, x.wins) > 0
  ) r where r.rk <= l;
  return jsonb_build_object('period', period, 'season', s, 'label', case when period = 'last' then bd::text else s end, 'babas', coalesce(n, 0), 'rows', rows);
end;
$$;

-- ============ Troféus ============
create table if not exists public.turma_trophies (
  id bigserial primary key,
  turma_id uuid not null references public.turmas(id) on delete cascade,
  scope text not null check (scope in ('atleta', 'turma')),
  kind text not null,
  title text not null,
  season text not null,
  ref text not null default '',
  player_id uuid references public.turma_players(id) on delete set null,
  player_name text,
  value integer,
  created_at timestamptz not null default now(),
  unique (turma_id, kind, season, ref)
);
alter table public.turma_trophies enable row level security;

-- Fecha as temporadas que já acabaram e dá o troféu a quem liderou cada categoria (mínimo de 3 babas na temporada).
create or replace function private.award_seasons(t uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s text; k integer; kinds text[] := array['artilheiro', 'garcom', 'craque', 'vencedor', 'paredao'];
  metrics text[] := array['goals', 'assists', 'part', 'wins', 'saves'];
  titles text[] := array['Artilheiro da temporada', 'Garçom da temporada', 'Craque da temporada', 'Mais vitórias da temporada', 'Paredão da temporada'];
  w record; nb integer;
begin
  for s in select distinct private.season_of(b.played_on) from public.babas b
           where b.finished and t = any (b.turma_ids) and b.played_on < private.season_start(private.season_of(current_date)) loop
    select count(distinct b.id) into nb from public.babas b where b.finished and t = any (b.turma_ids) and b.played_on >= private.season_start(s) and b.played_on < private.season_end(s);
    if nb < 3 then continue; end if;
    for k in 1 .. array_length(kinds, 1) loop
      select x.pid, x.pname, private.metric_of(metrics[k], x.goals, x.assists, x.saves, x.matches, x.wins) as v into w
      from private.stat_rows(t, private.season_start(s), private.season_end(s), null) x
      where private.metric_of(metrics[k], x.goals, x.assists, x.saves, x.matches, x.wins) > 0
      order by private.metric_of(metrics[k], x.goals, x.assists, x.saves, x.matches, x.wins) desc, x.matches asc, x.pname limit 1;
      if w.pid is not null then
        insert into public.turma_trophies (turma_id, scope, kind, title, season, player_id, player_name, value)
        values (t, 'atleta', kinds[k], titles[k], s, w.pid, w.pname, w.v) on conflict do nothing;
      end if;
    end loop;
  end loop;
end;
$$;

create or replace function public.turma_trophies(t uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare res jsonb;
begin
  if not private.can_see(t) then raise exception 'not_found'; end if;
  perform private.award_seasons(t);
  select jsonb_build_object(
    'atletas', coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'title', x.title, 'season', x.season, 'name', x.player_name, 'value', x.value) order by x.season desc, x.id) from public.turma_trophies x where x.turma_id = t and x.scope = 'atleta'), '[]'::jsonb),
    'turma', coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'title', x.title, 'season', x.season, 'ref', x.ref) order by x.season desc, x.id) from public.turma_trophies x where x.turma_id = t and x.scope = 'turma'), '[]'::jsonb)
  ) into res;
  return res;
end;
$$;

-- ============ Prestígio ============
create table if not exists public.prestige_rules (key text primary key, weight numeric not null, label text not null);
alter table public.prestige_rules enable row level security;
drop policy if exists prestige_rules_read on public.prestige_rules;
create policy prestige_rules_read on public.prestige_rules for select to authenticated using (true);
insert into public.prestige_rules (key, weight, label) values
  ('baba', 2, 'Babas encerrados (últimos 6 meses)'),
  ('atleta', 1, 'Atletas que jogaram (últimos 6 meses)'),
  ('desafio', 3, 'Desafios jogados'),
  ('vitoria', 10, 'Vitórias em desafios'),
  ('empate', 4, 'Empates em desafios'),
  ('titulo', 60, 'Campeonatos conquistados'),
  ('trofeu', 8, 'Troféus de atleta'),
  ('tier_prata', 100, 'Prata a partir de'),
  ('tier_ouro', 300, 'Ouro a partir de'),
  ('tier_diamante', 700, 'Diamante a partir de')
on conflict (key) do nothing;

create or replace function private.prestige_of(t uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare w jsonb; nb integer; na integer; np integer; nw integer; nd integer; nt integer; nz integer; score numeric; tier text;
begin
  select coalesce(jsonb_object_agg(key, weight), '{}'::jsonb) into w from public.prestige_rules;
  select count(*) into nb from public.babas b where b.finished and t = any (b.turma_ids) and b.played_on >= current_date - 180;
  select count(distinct x.pid) into na from private.stat_rows(t, current_date - 180, current_date + 1, null) x;
  select count(*) filter (where true),
         count(*) filter (where (m.home = t and m.home_goals > m.away_goals) or (m.away = t and m.away_goals > m.home_goals)),
         count(*) filter (where m.home_goals = m.away_goals)
    into np, nw, nd from public.turma_matches m where m.status = 'played' and (m.home = t or m.away = t);
  select count(*) into nt from public.turma_trophies x where x.turma_id = t and x.scope = 'atleta';
  select count(*) into nz from public.turma_trophies x where x.turma_id = t and x.kind = 'campeonato';
  score := nb * coalesce((w ->> 'baba')::numeric, 0) + na * coalesce((w ->> 'atleta')::numeric, 0) + np * coalesce((w ->> 'desafio')::numeric, 0)
         + nw * coalesce((w ->> 'vitoria')::numeric, 0) + nd * coalesce((w ->> 'empate')::numeric, 0)
         + nz * coalesce((w ->> 'titulo')::numeric, 0) + nt * coalesce((w ->> 'trofeu')::numeric, 0);
  tier := case when score >= coalesce((w ->> 'tier_diamante')::numeric, 1e9) then 'diamante'
               when score >= coalesce((w ->> 'tier_ouro')::numeric, 1e9) then 'ouro'
               when score >= coalesce((w ->> 'tier_prata')::numeric, 1e9) then 'prata' else 'bronze' end;
  return jsonb_build_object('score', round(score), 'tier', tier, 'parts', jsonb_build_array(
    jsonb_build_object('label', 'Babas (6 meses)', 'qty', nb, 'pts', nb * coalesce((w ->> 'baba')::numeric, 0)),
    jsonb_build_object('label', 'Atletas ativos', 'qty', na, 'pts', na * coalesce((w ->> 'atleta')::numeric, 0)),
    jsonb_build_object('label', 'Desafios jogados', 'qty', np, 'pts', np * coalesce((w ->> 'desafio')::numeric, 0)),
    jsonb_build_object('label', 'Vitórias em desafios', 'qty', nw, 'pts', nw * coalesce((w ->> 'vitoria')::numeric, 0)),
    jsonb_build_object('label', 'Empates em desafios', 'qty', nd, 'pts', nd * coalesce((w ->> 'empate')::numeric, 0)),
    jsonb_build_object('label', 'Campeonatos', 'qty', nz, 'pts', nz * coalesce((w ->> 'titulo')::numeric, 0)),
    jsonb_build_object('label', 'Troféus de atleta', 'qty', nt, 'pts', nt * coalesce((w ->> 'trofeu')::numeric, 0))));
end;
$$;

create or replace function public.turma_prestige(t uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_see(t) then raise exception 'not_found'; end if;
  return private.prestige_of(t) || jsonb_build_object('is_public', (select is_public from public.turmas where id = t));
end;
$$;

-- Vitrine: turmas públicas (e as suas) com prestígio, em ordem.
create or replace function public.explore_turmas(q text, lim integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare res jsonb; l integer := least(greatest(coalesce(lim, 30), 1), 60); needle text := nullif(lower(trim(coalesce(q, ''))), '');
begin
  select coalesce(jsonb_agg(r order by (r -> 'prestige' ->> 'score')::numeric desc, r ->> 'name'), '[]'::jsonb) into res
  from (
    select jsonb_build_object('id', x.id, 'name', x.name, 'icon', x.icon, 'is_public', x.is_public, 'member', private.is_member(x.id),
      'members', (select count(*) from public.turma_members m where m.turma_id = x.id),
      'prestige', private.prestige_of(x.id),
      'trophies', (select count(*) from public.turma_trophies z where z.turma_id = x.id),
      'last_baba', (select max(b.played_on) from public.babas b where b.finished and x.id = any (b.turma_ids))) as r
    from public.turmas x
    where (x.is_public or private.is_member(x.id)) and (needle is null or lower(x.name) like '%' || needle || '%')
    limit l
  ) z;
  return res;
end;
$$;

-- ============ Desafios entre turmas ============
create table if not exists public.championships (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 60),
  organizer uuid not null references public.turmas(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  max_teams integer not null check (max_teams between 3 and 8),
  status text not null default 'inscricoes' check (status in ('inscricoes', 'andamento', 'encerrado', 'cancelado')),
  champion uuid references public.turmas(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.championship_teams (
  championship uuid not null references public.championships(id) on delete cascade,
  turma_id uuid not null references public.turmas(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (championship, turma_id)
);
create table if not exists public.turma_matches (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('amistoso_fechado', 'amistoso_aberto', 'campeonato')),
  home uuid not null references public.turmas(id) on delete cascade,
  away uuid references public.turmas(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('open', 'pending', 'accepted', 'declined', 'canceled', 'played')),
  starts_at timestamptz,
  place text check (place is null or char_length(place) <= 120),
  note text check (note is null or char_length(note) <= 280),
  championship uuid references public.championships(id) on delete cascade,
  home_goals integer check (home_goals between 0 and 99),
  away_goals integer check (away_goals between 0 and 99),
  result_status text not null default 'none' check (result_status in ('none', 'reported', 'confirmed')),
  reported_by uuid references public.turmas(id) on delete set null,
  reported_user uuid references auth.users(id) on delete set null,
  reported_at timestamptz,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists turma_matches_home on public.turma_matches (home, status);
create index if not exists turma_matches_away on public.turma_matches (away, status);
alter table public.championships enable row level security;
alter table public.championship_teams enable row level security;
alter table public.turma_matches enable row level security;

-- O resultado que o outro lado não contestou em 72 h vale.
create or replace function private.champ_progress(c uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare ch public.championships; top uuid; nm text;
begin
  select * into ch from public.championships where id = c;
  if ch.id is null or ch.status <> 'andamento' then return; end if;
  if exists (select 1 from public.turma_matches m where m.championship = c and m.status not in ('played', 'canceled')) then return; end if;
  select s.turma_id into top from private.champ_table(c) s order by s.pts desc, s.sg desc, s.gp desc, s.name limit 1;
  update public.championships set status = 'encerrado', champion = top where id = c;
  if top is not null then
    insert into public.turma_trophies (turma_id, scope, kind, title, season, ref)
    values (top, 'turma', 'campeonato', 'Campeão: ' || ch.name, private.season_of(current_date), c::text) on conflict do nothing;
  end if;
end;
$$;

create or replace function private.champ_table(c uuid)
returns table (turma_id uuid, name text, icon text, j integer, v integer, e integer, d integer, gp integer, gc integer, sg integer, pts integer)
language sql stable security definer set search_path = '' as $$
  select t.id, t.name, t.icon,
    count(m.id)::integer,
    count(*) filter (where (m.home = t.id and m.home_goals > m.away_goals) or (m.away = t.id and m.away_goals > m.home_goals))::integer,
    count(*) filter (where m.id is not null and m.home_goals = m.away_goals)::integer,
    count(*) filter (where (m.home = t.id and m.home_goals < m.away_goals) or (m.away = t.id and m.away_goals < m.home_goals))::integer,
    coalesce(sum(case when m.home = t.id then m.home_goals else m.away_goals end), 0)::integer,
    coalesce(sum(case when m.home = t.id then m.away_goals else m.home_goals end), 0)::integer,
    coalesce(sum(case when m.home = t.id then m.home_goals - m.away_goals else m.away_goals - m.home_goals end), 0)::integer,
    (count(*) filter (where (m.home = t.id and m.home_goals > m.away_goals) or (m.away = t.id and m.away_goals > m.home_goals)) * 3
      + count(*) filter (where m.id is not null and m.home_goals = m.away_goals))::integer
  from public.championship_teams ct
  join public.turmas t on t.id = ct.turma_id
  left join public.turma_matches m on m.championship = c and m.status = 'played' and (m.home = t.id or m.away = t.id)
  where ct.championship = c
  group by t.id, t.name, t.icon;
$$;

create or replace function private.settle_stale() returns void
language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  for m in select id, championship from public.turma_matches where result_status = 'reported' and reported_at < now() - interval '72 hours' loop
    update public.turma_matches set result_status = 'confirmed', status = 'played', decided_at = now() where id = m.id;
    if m.championship is not null then perform private.champ_progress(m.championship); end if;
  end loop;
end;
$$;

-- Amistoso. fechado = contra uma turma pública escolhida; aberto = fica no mural até uma turma aceitar.
create or replace function public.create_match(home uuid, kind text, away uuid, starts timestamptz, place text, note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); mid uuid;
begin
  if not private.is_admin(home) then raise exception 'not_allowed'; end if;
  if kind not in ('amistoso_fechado', 'amistoso_aberto') then raise exception 'bad_kind'; end if;
  if not exists (select 1 from public.turmas x where x.id = home and x.is_public) then raise exception 'home_private'; end if;
  if kind = 'amistoso_fechado' then
    if away is null or away = home then raise exception 'bad_away'; end if;
    if not exists (select 1 from public.turmas x where x.id = away and x.is_public) then raise exception 'away_private'; end if;
  else
    away := null;
  end if;
  if starts is not null and (starts < now() - interval '1 hour' or starts > now() + interval '180 days') then raise exception 'bad_date'; end if;
  if (select count(*) from public.turma_matches m where m.home = create_match.home and m.status in ('open', 'pending', 'accepted') and m.championship is null) >= 5 then raise exception 'limit'; end if;
  insert into public.turma_matches (kind, home, away, created_by, status, starts_at, place, note)
  values (kind, home, away, uid, case when kind = 'amistoso_fechado' then 'pending' else 'open' end, starts,
          nullif(left(trim(coalesce(place, '')), 120), ''), nullif(left(trim(coalesce(note, '')), 280), ''))
  returning id into mid;
  return mid;
end;
$$;

-- Aceitar ou recusar. Convite fechado: o adm da turma convidada. Mural aberto: qualquer adm de turma pública (as_turma).
create or replace function public.respond_match(m uuid, accept boolean, as_turma uuid default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare x public.turma_matches;
begin
  select * into x from public.turma_matches where id = m for update;
  if x.id is null then raise exception 'not_found'; end if;
  if x.status = 'pending' then
    if not private.is_admin(x.away) then raise exception 'not_allowed'; end if;
    update public.turma_matches set status = case when accept then 'accepted' else 'declined' end, decided_at = now() where id = m;
    return case when accept then 'accepted' else 'declined' end;
  elsif x.status = 'open' then
    if not accept then raise exception 'not_allowed'; end if;
    if as_turma is null or as_turma = x.home or not private.is_admin(as_turma) then raise exception 'not_allowed'; end if;
    if not exists (select 1 from public.turmas z where z.id = as_turma and z.is_public) then raise exception 'away_private'; end if;
    update public.turma_matches set away = as_turma, status = 'accepted', decided_at = now() where id = m;
    return 'accepted';
  end if;
  raise exception 'closed';
end;
$$;

create or replace function public.cancel_match(m uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.turma_matches;
begin
  select * into x from public.turma_matches where id = m for update;
  if x.id is null then raise exception 'not_found'; end if;
  if x.championship is not null then raise exception 'championship_match'; end if;
  if not (private.is_admin(x.home) or (x.away is not null and private.is_admin(x.away))) then raise exception 'not_allowed'; end if;
  if x.status not in ('open', 'pending', 'accepted') or x.result_status <> 'none' then raise exception 'closed'; end if;
  update public.turma_matches set status = 'canceled', decided_at = now() where id = m;
end;
$$;

create or replace function public.schedule_match(m uuid, starts timestamptz, place text) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.turma_matches;
begin
  select * into x from public.turma_matches where id = m for update;
  if x.id is null then raise exception 'not_found'; end if;
  if not (private.is_admin(x.home) or (x.away is not null and private.is_admin(x.away))) then raise exception 'not_allowed'; end if;
  if x.status <> 'accepted' or x.result_status <> 'none' then raise exception 'closed'; end if;
  if starts is not null and (starts < now() - interval '1 hour' or starts > now() + interval '180 days') then raise exception 'bad_date'; end if;
  update public.turma_matches set starts_at = starts, place = nullif(left(trim(coalesce(schedule_match.place, '')), 120), '') where id = m;
end;
$$;

-- Um lado lança o placar, o outro confirma (ou contesta). Sem resposta em 72 h, o placar vale.
create or replace function public.report_result(m uuid, hg integer, ag integer) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); x public.turma_matches; side uuid;
begin
  select * into x from public.turma_matches where id = m for update;
  if x.id is null then raise exception 'not_found'; end if;
  if private.is_admin(x.home) then side := x.home; elsif x.away is not null and private.is_admin(x.away) then side := x.away; else raise exception 'not_allowed'; end if;
  if x.status <> 'accepted' or x.result_status = 'confirmed' then raise exception 'closed'; end if;
  if x.starts_at is not null and x.starts_at > now() + interval '12 hours' then raise exception 'too_early'; end if;
  if hg is null or ag is null or hg < 0 or ag < 0 or hg > 99 or ag > 99 then raise exception 'bad_score'; end if;
  update public.turma_matches set home_goals = hg, away_goals = ag, result_status = 'reported', reported_by = side, reported_user = uid, reported_at = now() where id = m;
end;
$$;

create or replace function public.confirm_result(m uuid, ok boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); x public.turma_matches; other uuid;
begin
  select * into x from public.turma_matches where id = m for update;
  if x.id is null then raise exception 'not_found'; end if;
  if x.result_status <> 'reported' then raise exception 'closed'; end if;
  other := case when x.reported_by = x.home then x.away else x.home end;
  if other is null or not private.is_admin(other) or x.reported_user = uid then raise exception 'not_allowed'; end if;
  if ok then
    update public.turma_matches set result_status = 'confirmed', status = 'played', decided_at = now() where id = m;
    if x.championship is not null then perform private.champ_progress(x.championship); end if;
    return 'confirmed';
  end if;
  update public.turma_matches set result_status = 'none', home_goals = null, away_goals = null, reported_by = null, reported_user = null, reported_at = null where id = m;
  return 'disputed';
end;
$$;

create or replace function private.match_json(mid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', x.id, 'kind', x.kind, 'status', x.status, 'starts_at', x.starts_at, 'place', x.place, 'note', x.note,
    'home', x.home, 'home_name', h.name, 'home_icon', h.icon, 'away', x.away, 'away_name', a.name, 'away_icon', a.icon,
    'home_goals', x.home_goals, 'away_goals', x.away_goals, 'result_status', x.result_status, 'reported_by', x.reported_by,
    'championship', x.championship, 'created_at', x.created_at)
  from public.turma_matches x join public.turmas h on h.id = x.home left join public.turmas a on a.id = x.away where x.id = mid;
$$;

create or replace function public.turma_matches(t uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare res jsonb;
begin
  if not private.can_see(t) then raise exception 'not_found'; end if;
  perform private.settle_stale();
  select coalesce(jsonb_agg(private.match_json(m.id) order by coalesce(m.starts_at, m.created_at) desc), '[]'::jsonb) into res
  from (select * from public.turma_matches z where (z.home = t or z.away = t) and z.status <> 'declined' and z.status <> 'canceled'
        order by coalesce(z.starts_at, z.created_at) desc limit 40) m;
  return res;
end;
$$;

-- Mural: amistosos abertos de turmas públicas.
create or replace function public.open_matches() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare res jsonb;
begin
  select coalesce(jsonb_agg(private.match_json(m.id) || jsonb_build_object('prestige', private.prestige_of(m.home), 'mine', private.is_member(m.home)) order by m.created_at desc), '[]'::jsonb) into res
  from (select z.* from public.turma_matches z join public.turmas h on h.id = z.home and h.is_public
        where z.status = 'open' and (z.starts_at is null or z.starts_at > now() - interval '1 hour') order by z.created_at desc limit 30) m;
  return res;
end;
$$;

-- ============ Campeonatos ============
create or replace function public.create_championship(t uuid, name text, max_teams integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); cid uuid;
begin
  if not private.is_admin(t) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from public.turmas x where x.id = t and x.is_public) then raise exception 'home_private'; end if;
  if max_teams is null or max_teams < 3 or max_teams > 8 then raise exception 'bad_size'; end if;
  if length(trim(coalesce(name, ''))) < 2 then raise exception 'bad_name'; end if;
  if (select count(*) from public.championships c where c.organizer = t and c.status in ('inscricoes', 'andamento')) >= 2 then raise exception 'limit'; end if;
  insert into public.championships (name, organizer, created_by, max_teams) values (left(trim(name), 60), t, uid, max_teams) returning id into cid;
  insert into public.championship_teams (championship, turma_id) values (cid, t);
  return cid;
end;
$$;

create or replace function public.join_championship(c uuid, t uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare ch public.championships;
begin
  select * into ch from public.championships where id = c for update;
  if ch.id is null then raise exception 'not_found'; end if;
  if not private.is_admin(t) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from public.turmas x where x.id = t and x.is_public) then raise exception 'away_private'; end if;
  if ch.status <> 'inscricoes' then raise exception 'closed'; end if;
  if (select count(*) from public.championship_teams z where z.championship = c) >= ch.max_teams then raise exception 'full'; end if;
  insert into public.championship_teams (championship, turma_id) values (c, t) on conflict do nothing;
end;
$$;

create or replace function public.leave_championship(c uuid, t uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare ch public.championships;
begin
  select * into ch from public.championships where id = c for update;
  if ch.id is null then raise exception 'not_found'; end if;
  if not private.is_admin(t) then raise exception 'not_allowed'; end if;
  if ch.status <> 'inscricoes' or ch.organizer = t then raise exception 'closed'; end if;
  delete from public.championship_teams where championship = c and turma_id = t;
end;
$$;

-- Começa: todos contra todos, um jogo por par. Cada confronto é combinado e lançado pelos advs das duas turmas.
create or replace function public.start_championship(c uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare ch public.championships; ts uuid[]; i integer; j integer; n integer := 0;
begin
  select * into ch from public.championships where id = c for update;
  if ch.id is null then raise exception 'not_found'; end if;
  if not private.is_admin(ch.organizer) then raise exception 'not_allowed'; end if;
  if ch.status <> 'inscricoes' then raise exception 'closed'; end if;
  select array_agg(z.turma_id order by z.joined_at) into ts from public.championship_teams z where z.championship = c;
  if coalesce(array_length(ts, 1), 0) < 3 then raise exception 'few_teams'; end if;
  for i in 1 .. array_length(ts, 1) - 1 loop
    for j in i + 1 .. array_length(ts, 1) loop
      insert into public.turma_matches (kind, home, away, created_by, status, championship) values ('campeonato', ts[i], ts[j], (select auth.uid()), 'accepted', c);
      n := n + 1;
    end loop;
  end loop;
  update public.championships set status = 'andamento' where id = c;
  return n;
end;
$$;

create or replace function public.cancel_championship(c uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare ch public.championships;
begin
  select * into ch from public.championships where id = c for update;
  if ch.id is null then raise exception 'not_found'; end if;
  if not private.is_admin(ch.organizer) then raise exception 'not_allowed'; end if;
  if ch.status not in ('inscricoes', 'andamento') then raise exception 'closed'; end if;
  update public.championships set status = 'cancelado' where id = c;
  update public.turma_matches set status = 'canceled', decided_at = now() where championship = c and status <> 'played';
end;
$$;

create or replace function public.list_championships() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare res jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'organizer', c.organizer, 'organizer_name', o.name, 'status', c.status, 'max_teams', c.max_teams,
      'teams', (select count(*) from public.championship_teams z where z.championship = c.id),
      'champion', c.champion, 'champion_name', (select x.name from public.turmas x where x.id = c.champion),
      'mine', exists (select 1 from public.championship_teams z where z.championship = c.id and private.is_member(z.turma_id)),
      'created_at', c.created_at) order by (c.status = 'inscricoes') desc, c.created_at desc), '[]'::jsonb) into res
  from (select * from public.championships where status <> 'cancelado' order by created_at desc limit 30) c join public.turmas o on o.id = c.organizer;
  return res;
end;
$$;

create or replace function public.championship_detail(c uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ch public.championships;
begin
  perform private.settle_stale();
  select * into ch from public.championships where id = c;
  if ch.id is null or ch.status = 'cancelado' then raise exception 'not_found'; end if;
  return jsonb_build_object('id', ch.id, 'name', ch.name, 'status', ch.status, 'organizer', ch.organizer, 'max_teams', ch.max_teams, 'champion', ch.champion,
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'icon', t.icon) order by z.joined_at) from public.championship_teams z join public.turmas t on t.id = z.turma_id where z.championship = c), '[]'::jsonb),
    'table', coalesce((select jsonb_agg(jsonb_build_object('turma', s.turma_id, 'name', s.name, 'icon', s.icon, 'j', s.j, 'v', s.v, 'e', s.e, 'd', s.d, 'gp', s.gp, 'gc', s.gc, 'sg', s.sg, 'pts', s.pts)
        order by s.pts desc, s.sg desc, s.gp desc, s.name) from private.champ_table(c) s), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(private.match_json(m.id) order by m.created_at, m.id) from public.turma_matches m where m.championship = c and m.status <> 'canceled'), '[]'::jsonb));
end;
$$;

-- ============ Permissões ============
revoke execute on function private.can_see(uuid), private.season_of(date), private.season_start(text), private.season_end(text),
  private.stat_rows(uuid, date, date, uuid), private.metric_of(text, integer, integer, integer, integer, integer), private.award_seasons(uuid),
  private.prestige_of(uuid), private.champ_progress(uuid), private.champ_table(uuid), private.settle_stale(), private.match_json(uuid)
  from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.set_turma_privacy(uuid, boolean)', 'public.turma_ranking(uuid, text, text, integer)', 'public.turma_trophies(uuid)', 'public.turma_prestige(uuid)',
    'public.explore_turmas(text, integer)', 'public.create_match(uuid, text, uuid, timestamptz, text, text)', 'public.respond_match(uuid, boolean, uuid)', 'public.cancel_match(uuid)',
    'public.schedule_match(uuid, timestamptz, text)', 'public.report_result(uuid, integer, integer)', 'public.confirm_result(uuid, boolean)', 'public.turma_matches(uuid)',
    'public.open_matches()', 'public.create_championship(uuid, text, integer)', 'public.join_championship(uuid, uuid)', 'public.leave_championship(uuid, uuid)',
    'public.start_championship(uuid)', 'public.cancel_championship(uuid)', 'public.list_championships()', 'public.championship_detail(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
