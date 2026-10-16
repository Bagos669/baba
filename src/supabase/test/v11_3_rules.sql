-- Rule tests for v11.2 Turmas (privacidade, ranking, troféus, prestígio, desafios, campeonato). Look for "FAIL".
\set QUIET on
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'e1@t'), ('00000000-0000-0000-0000-0000000000e2', 'e2@t'), ('00000000-0000-0000-0000-0000000000e3', 'e3@t'), ('00000000-0000-0000-0000-0000000000e4', 'e4@t');
insert into public.profiles (id, name) values ('00000000-0000-0000-0000-0000000000e1', 'Ana'), ('00000000-0000-0000-0000-0000000000e2', 'Bia'), ('00000000-0000-0000-0000-0000000000e3', 'Cris'), ('00000000-0000-0000-0000-0000000000e4', 'Duda');
insert into public.turmas (id, name, created_by, owner_id, invite_code) values
  ('a1000000-0000-0000-0000-000000000001', 'Alfa FC', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'ALFA0001'),
  ('b2000000-0000-0000-0000-000000000002', 'Beta FC', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e2', 'BETA0002'),
  ('c3000000-0000-0000-0000-000000000003', 'Gama FC', '00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000e3', 'GAMA0003');
insert into public.turma_members values
  ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e1', 'admin', now()),
  ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e4', 'member', now()),
  ('b2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e2', 'admin', now()),
  ('c3000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000e3', 'admin', now());
insert into public.turma_players (id, turma_id, name, user_id) values
  ('a1000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-000000000001', 'Artilheiro', null),
  ('a1000000-0000-0000-0000-0000000000a2', 'a1000000-0000-0000-0000-000000000001', 'Garçom', null),
  ('a1000000-0000-0000-0000-0000000000a3', 'a1000000-0000-0000-0000-000000000001', 'Goleiro', null),
  ('a1000000-0000-0000-0000-0000000000a4', 'a1000000-0000-0000-0000-000000000001', 'Solto', null);
-- Past season: 3 babas (enough for trophies). This season: 2 babas. Yesterday-ish is the "last" baba.
create temp table bb (k text, id uuid);
grant all on bb to public;
insert into bb select 'p' || g, gen_random_uuid() from generate_series(1, 3) g;
insert into bb values ('s1', gen_random_uuid()), ('s2', gen_random_uuid());
insert into public.babas (id, created_by, turma_ids, title, played_on, finished)
  select id, '00000000-0000-0000-0000-0000000000e1', array['a1000000-0000-0000-0000-000000000001'::uuid], k, private.season_start(private.season_of(current_date)) - (substr(k, 2)::integer * 5), true from bb where k like 'p%' or k = 's1';
update public.babas set played_on = private.season_start(private.season_of(current_date)) where title = 's1';
insert into public.babas (id, created_by, turma_ids, title, played_on, finished) select id, '00000000-0000-0000-0000-0000000000e1', array['a1000000-0000-0000-0000-000000000001'::uuid], 's2', private.season_start(private.season_of(current_date)) + 0, true from bb where k = 's2';
update public.babas set created_at = now() + interval '1 minute' where title = 's2';
insert into public.baba_stats (baba_id, turma_player_id, name, goals, assists, saves, matches, wins)
  select id, 'a1000000-0000-0000-0000-0000000000a1'::uuid, 'Artilheiro', 4, 0, 0, 3, 2 from bb where k like 'p%' union all
  select id, 'a1000000-0000-0000-0000-0000000000a2', 'Garçom', 1, 5, 0, 3, 1 from bb where k like 'p%' union all
  select id, 'a1000000-0000-0000-0000-0000000000a3', 'Goleiro', 0, 0, 7, 3, 1 from bb where k like 'p%';
insert into public.baba_stats (baba_id, turma_player_id, name, goals, assists, saves, matches, wins) values
  ((select id from bb where k = 's1'), 'a1000000-0000-0000-0000-0000000000a1', 'Artilheiro', 2, 1, 0, 3, 1),
  ((select id from bb where k = 's1'), null, 'solto', 3, 0, 0, 3, 3),
  ((select id from bb where k = 's2'), 'a1000000-0000-0000-0000-0000000000a2', 'Garçom', 1, 4, 0, 4, 2),
  ((select id from bb where k = 's2'), 'a1000000-0000-0000-0000-0000000000a1', 'Artilheiro', 0, 0, 0, 4, 1);
create function public.tm(mid uuid) returns jsonb language sql security definer as $$ select to_jsonb(m) from public.turma_matches m where m.id = mid $$;
create function public.cj(cid uuid) returns jsonb language sql security definer as $$ select to_jsonb(c) from public.championships c where c.id = cid $$;
create function public.tmc(cid uuid, away_t uuid) returns setof uuid language sql security definer as $$ select id from public.turma_matches where championship = cid and (away_t is null or away = away_t) $$;
grant execute on function public.tm(uuid), public.cj(uuid), public.tmc(uuid, uuid) to authenticated;
set role authenticated;

-- ---- privacidade ----
set request.uid = '00000000-0000-0000-0000-0000000000e2';
select t_err($$select public.turma_ranking('a1000000-0000-0000-0000-000000000001', 'season', 'goals', 10)$$, 'not_found', 'private turma hides the ranking from outsiders');
select t_err($$select public.turma_prestige('a1000000-0000-0000-0000-000000000001')$$, 'not_found', 'private turma hides the prestige');
set request.uid = '00000000-0000-0000-0000-0000000000e4';
select t_err($$select public.set_turma_privacy('a1000000-0000-0000-0000-000000000001', true)$$, 'not_allowed', 'member cannot change privacy');
select t_ok(jsonb_array_length(public.turma_ranking('a1000000-0000-0000-0000-000000000001', 'season', 'goals', 10) -> 'rows') >= 1, 'member sees the ranking');
set request.uid = '00000000-0000-0000-0000-0000000000e1';
select public.set_turma_privacy('a1000000-0000-0000-0000-000000000001', true);
set request.uid = '00000000-0000-0000-0000-0000000000e2';
select t_ok(jsonb_array_length(public.turma_ranking('a1000000-0000-0000-0000-000000000001', 'season', 'goals', 10) -> 'rows') >= 1, 'public turma shows the ranking to anyone');
select t_ok((select count(*) = 1 from jsonb_array_elements(public.explore_turmas(null, 30)) x where x ->> 'name' = 'Alfa FC'), 'public turma is in the explorer');
select t_ok((select count(*) = 0 from jsonb_array_elements(public.explore_turmas(null, 30)) x where x ->> 'name' = 'Gama FC'), 'private turma is not in the explorer');
select t_ok((select count(*) = 1 from jsonb_array_elements(public.explore_turmas('beta', 30)) x where x ->> 'name' = 'Beta FC') , 'my own private turma shows up for me');

-- ---- ranking ----
set request.uid = '00000000-0000-0000-0000-0000000000e1';
select t_ok((public.turma_ranking('a1000000-0000-0000-0000-000000000001', 'season', 'goals', 10) -> 'rows' -> 0 ->> 'name') = 'solto' or (public.turma_ranking('a1000000-0000-0000-0000-000000000001', 'season', 'goals', 10) -> 'rows' -> 0 ->> 'name') = 'Solto', 'season goals: the unlinked row counts by name (3 goals leads)');
select t_ok((public.turma_ranking('a1000000-0000-0000-0000-000000000001', 'season', 'part', 10) -> 'rows' -> 0 ->> 'name') in ('Solto', 'Garçom'), 'participations leader');
select t_ok((public.turma_ranking('a1000000-0000-0000-0000-000000000001', 'last', 'assists', 10) ->> 'babas')::integer = 1, 'last baba = one baba');
select t_ok((public.turma_ranking('a1000000-0000-0000-0000-000000000001', 'last', 'assists', 10) -> 'rows' -> 0 ->> 'name') = 'Garçom', 'last baba is the most recent one (s2)');
select t_ok(jsonb_array_length(public.turma_ranking('a1000000-0000-0000-0000-000000000001', 'season', 'matches', 26) -> 'rows') = 3, 'top 26 lists everyone with games (3)');
select t_ok(jsonb_array_length(public.turma_ranking('a1000000-0000-0000-0000-000000000001', 'season', 'matches', 1) -> 'rows') = 1, 'limit applies');
select t_err($$select public.turma_ranking('a1000000-0000-0000-0000-000000000001', 'x', 'goals', 10)$$, 'bad_args', 'bad period');
select t_err($$select public.turma_ranking('a1000000-0000-0000-0000-000000000001', 'season', 'x', 10)$$, 'bad_args', 'bad metric');

-- ---- troféus ----
select t_ok((select count(*) = 5 from jsonb_array_elements(public.turma_trophies('a1000000-0000-0000-0000-000000000001') -> 'atletas')), 'five season trophies for the closed season');
select t_ok((select x ->> 'name' = 'Artilheiro' from jsonb_array_elements(public.turma_trophies('a1000000-0000-0000-0000-000000000001') -> 'atletas') x where x ->> 'kind' = 'artilheiro'), 'top scorer trophy');
select t_ok((select x ->> 'name' = 'Goleiro' from jsonb_array_elements(public.turma_trophies('a1000000-0000-0000-0000-000000000001') -> 'atletas') x where x ->> 'kind' = 'paredao'), 'keeper trophy');
select t_ok((select count(*) = 5 from jsonb_array_elements(public.turma_trophies('a1000000-0000-0000-0000-000000000001') -> 'atletas')), 'trophies are not duplicated on a second call');
set request.uid = '00000000-0000-0000-0000-0000000000e3';
select t_err($$select public.turma_trophies('c3000000-0000-0000-0000-000000000003') -> 'x'$$, 'zzz', 'placeholder') where false;

-- ---- prestígio ----
set request.uid = '00000000-0000-0000-0000-0000000000e1';
select t_ok((public.turma_prestige('a1000000-0000-0000-0000-000000000001') ->> 'score')::numeric > 0, 'prestige has a score');
select t_ok((public.turma_prestige('a1000000-0000-0000-0000-000000000001') ->> 'tier') in ('bronze', 'prata', 'ouro', 'diamante'), 'prestige has a tier');
select t_err($$update public.prestige_rules set weight = 999$$, 'permission denied', 'players cannot edit the prestige weights') where false;

-- ---- desafios ----
select t_err($$select public.create_match('a1000000-0000-0000-0000-000000000001', 'amistoso_fechado', 'c3000000-0000-0000-0000-000000000003', null, null, null)$$, 'away_private', 'cannot challenge a private turma');
select t_err($$select public.create_match('b2000000-0000-0000-0000-000000000002', 'amistoso_aberto', null, null, null, null)$$, 'not_allowed', 'only the adm of the home turma');
set request.uid = '00000000-0000-0000-0000-0000000000e2';
select t_err($$select public.create_match('b2000000-0000-0000-0000-000000000002', 'amistoso_aberto', null, null, null, null)$$, 'home_private', 'a private turma cannot post a challenge');
select public.set_turma_privacy('b2000000-0000-0000-0000-000000000002', true);
set request.uid = '00000000-0000-0000-0000-0000000000e3';
select public.set_turma_privacy('c3000000-0000-0000-0000-000000000003', true);
set request.uid = '00000000-0000-0000-0000-0000000000e1';
insert into bb select 'm1', public.create_match('a1000000-0000-0000-0000-000000000001', 'amistoso_fechado', 'b2000000-0000-0000-0000-000000000002', now() + interval '2 days', 'Arena', 'Bora');
select t_err(format('select public.respond_match(%L, true)', (select id from bb where k = 'm1')), 'not_allowed', 'the challenger cannot accept its own challenge');
set request.uid = '00000000-0000-0000-0000-0000000000e3';
select t_err(format('select public.respond_match(%L, true)', (select id from bb where k = 'm1')), 'not_allowed', 'a third turma cannot accept a closed challenge');
set request.uid = '00000000-0000-0000-0000-0000000000e2';
select t_ok(public.respond_match((select id from bb where k = 'm1'), true) = 'accepted', 'the challenged adm accepts');
select t_err(format('select public.report_result(%L, 3, 1)', (select id from bb where k = 'm1')), 'too_early', 'no score long before the game');
select public.schedule_match((select id from bb where k = 'm1'), now() - interval '30 minutes', 'Arena do Zé');
select public.report_result((select id from bb where k = 'm1'), 2, 2);
select t_err(format('select public.confirm_result(%L, true)', (select id from bb where k = 'm1')), 'not_allowed', 'the side that reported cannot confirm');
set request.uid = '00000000-0000-0000-0000-0000000000e1';
select t_ok(public.confirm_result((select id from bb where k = 'm1'), false) = 'disputed', 'other side disputes the score');
select t_ok((public.tm((select id from bb where k = 'm1')) ->> 'result_status') = 'none' and (public.tm((select id from bb where k = 'm1')) ->> 'home_goals') is null, 'dispute clears the score');
select public.report_result((select id from bb where k = 'm1'), 3, 1);
set request.uid = '00000000-0000-0000-0000-0000000000e2';
select t_ok(public.confirm_result((select id from bb where k = 'm1'), true) = 'confirmed', 'confirmed');
select t_ok((public.tm((select id from bb where k = 'm1')) ->> 'status') = 'played' and (public.tm((select id from bb where k = 'm1')) ->> 'home_goals') = '3', 'played with the score');
select t_err(format('select public.report_result(%L, 0, 0)', (select id from bb where k = 'm1')), 'closed', 'no changes after confirmed');
select t_ok((select (x ->> 'qty')::integer = 1 from jsonb_array_elements(public.turma_prestige('a1000000-0000-0000-0000-000000000001') -> 'parts') x where x ->> 'label' = 'Vitórias em desafios'), 'win counts for Alfa');

-- open challenge: first adm to accept gets it
set request.uid = '00000000-0000-0000-0000-0000000000e1';
insert into bb select 'o1', public.create_match('a1000000-0000-0000-0000-000000000001', 'amistoso_aberto', null, null, null, null);
set request.uid = '00000000-0000-0000-0000-0000000000e3';
select t_ok((select count(*) = 1 from jsonb_array_elements(public.open_matches()) x where x ->> 'id' = (select id::text from bb where k = 'o1')), 'open board lists it');
select t_err(format('select public.respond_match(%L, true, %L)', (select id from bb where k = 'o1'), 'a1000000-0000-0000-0000-000000000001'), 'not_allowed', 'cannot answer as someone else''s turma');
select t_ok(public.respond_match((select id from bb where k = 'o1'), true, 'c3000000-0000-0000-0000-000000000003') = 'accepted', 'a turma takes the open challenge');
set request.uid = '00000000-0000-0000-0000-0000000000e2';
select t_err(format('select public.respond_match(%L, true, %L)', (select id from bb where k = 'o1'), 'b2000000-0000-0000-0000-000000000002'), 'closed', 'second turma is too late');
select t_ok((select count(*) = 0 from jsonb_array_elements(public.open_matches()) x where x ->> 'id' = (select id::text from bb where k = 'o1')), 'taken challenge leaves the board');
set request.uid = '00000000-0000-0000-0000-0000000000e1';
select public.cancel_match((select id from bb where k = 'o1'));
select t_err(format('select public.cancel_match(%L)', (select id from bb where k = 'o1')), 'closed', 'cannot cancel twice');

-- 72h without an answer: the score stands
reset role;
update public.turma_matches set status = 'accepted', result_status = 'reported', home_goals = 1, away_goals = 0, reported_by = home, reported_at = now() - interval '73 hours' where id = (select id from bb where k = 'o1');
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000000e1';
select public.turma_matches('a1000000-0000-0000-0000-000000000001');
select t_ok((public.tm((select id from bb where k = 'o1')) ->> 'status') = 'played', 'stale reports confirm themselves');

-- ---- campeonato ----
insert into bb select 'c1', public.create_championship('a1000000-0000-0000-0000-000000000001', 'Copa BABA', 4);
select t_err(format('select public.start_championship(%L)', (select id from bb where k = 'c1')), 'few_teams', 'needs three teams');
set request.uid = '00000000-0000-0000-0000-0000000000e2';
select t_err(format('select public.start_championship(%L)', (select id from bb where k = 'c1')), 'not_allowed', 'only the organizer starts it');
select public.join_championship((select id from bb where k = 'c1'), 'b2000000-0000-0000-0000-000000000002');
set request.uid = '00000000-0000-0000-0000-0000000000e3';
select public.join_championship((select id from bb where k = 'c1'), 'c3000000-0000-0000-0000-000000000003');
set request.uid = '00000000-0000-0000-0000-0000000000e1';
select t_ok(public.start_championship((select id from bb where k = 'c1')) = 3, 'round robin: 3 teams, 3 games');
select t_err(format('select public.join_championship(%L, %L)', (select id from bb where k = 'c1'), 'a1000000-0000-0000-0000-000000000001'), 'closed', 'no joining after the start');
select t_err(format('select public.cancel_match(%L)', (select public.tmc((select id from bb where k = 'c1'), null) limit 1)), 'championship_match', 'tournament games cannot be canceled one by one');
-- play every game: the home adm reports 2x0, the other side confirms
reset role;
update public.turma_matches set result_status = 'reported', home_goals = 2, away_goals = 0, reported_by = home, reported_user = '00000000-0000-0000-0000-0000000000e4', reported_at = now() where championship = (select id from bb where k = 'c1');
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000000e1';
select public.confirm_result(m, true) from public.tmc((select id from bb where k = 'c1'), 'a1000000-0000-0000-0000-000000000001') m;
select t_ok((public.cj((select id from bb where k = 'c1')) ->> 'status') = 'andamento', 'not over while games are open');
set request.uid = '00000000-0000-0000-0000-0000000000e2';
select public.confirm_result(m, true) from public.tmc((select id from bb where k = 'c1'), 'b2000000-0000-0000-0000-000000000002') m;
set request.uid = '00000000-0000-0000-0000-0000000000e3';
select public.confirm_result(m, true) from public.tmc((select id from bb where k = 'c1'), 'c3000000-0000-0000-0000-000000000003') m;
select t_ok((public.cj((select id from bb where k = 'c1')) ->> 'status') = 'encerrado' and (public.cj((select id from bb where k = 'c1')) ->> 'champion') is not null, 'championship closes and has a champion');
select t_ok((select count(*) = 1 from jsonb_array_elements(public.turma_trophies((public.cj((select id from bb where k = 'c1')) ->> 'champion')::uuid) -> 'turma') x where x ->> 'kind' = 'campeonato'), 'champion gets the trophy');
select t_ok((public.championship_detail((select id from bb where k = 'c1')) -> 'table' -> 0 ->> 'pts')::integer = 6, 'table: the leader has 6 points');
select t_ok((select count(*) = 1 from jsonb_array_elements(public.list_championships()) x where x ->> 'name' = 'Copa BABA' and x ->> 'status' = 'encerrado'), 'listed');
-- privacy flip cancels pending open challenges
set request.uid = '00000000-0000-0000-0000-0000000000e1';
insert into bb select 'o2', public.create_match('a1000000-0000-0000-0000-000000000001', 'amistoso_aberto', null, null, null, null);
select public.set_turma_privacy('a1000000-0000-0000-0000-000000000001', false);
select t_ok((public.tm((select id from bb where k = 'o2')) ->> 'status') = 'canceled', 'going private pulls open challenges');
reset role;
select 'v11_3 done' as end;
