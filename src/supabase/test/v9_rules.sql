-- Rule tests for v9 (missions, exclusive items). Run after the v8 chain + v9. Look for "FAIL".
\set QUIET on
reset role;
-- the owner account, created after v9 ran (founder by trigger, team-only items by e-mail)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'GabrielJastim13@gmail.com');
insert into public.profiles (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Gabriel');
select t_ok((select count(*) = 6 from private.founders), 'existing accounts + new one are founders');
select t_ok((select n = 6 from private.founders where user_id = '00000000-0000-0000-0000-0000000000a1'), 'founder number follows signup order');
-- fill the 100 places, then one more account
insert into auth.users (id, email) select ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, 'u' || g || '@t' from generate_series(1, 95) g;
insert into public.profiles (id, name) select ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, 'U' || g from generate_series(1, 95) g;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b9', 'atrasado@t');
insert into public.profiles (id, name) values ('00000000-0000-0000-0000-0000000000b9', 'Atrasado');
select t_ok((select count(*) = 100 and max(n) = 100 from private.founders), 'exactly 100 founders');
select t_ok(not exists (select 1 from private.founders where user_id = '00000000-0000-0000-0000-0000000000b9'), '101st account is not a founder');
set role authenticated;

-- ===== exclusive items
set request.uid = '00000000-0000-0000-0000-0000000000a1';
select t_ok((select items @> array['frame_teal_orange', 'name_teal_orange', 'fx_frame_fogo_azul', 'fx_name_fogo_azul'] from public.my_wallet()), 'owner gets teal & orange + blue fire');
select t_ok(public.equip_item('frame', 'frame_teal_orange') ->> 'frame' = 'tealorange', 'equip teal & orange frame');
select t_ok(public.equip_item('frameShine', 'fx_frame_fogo_azul') ->> 'frameShine' = 'fogo-azul', 'equip blue fire on frame');
select t_ok(public.equip_item('nameShine', 'fx_name_fogo_azul') ->> 'nameShine' = 'fogo-azul', 'equip blue fire on name');
select t_err($$select public.equip_item('nameShine', 'fx_frame_fogo_azul')$$, 'bad_item', 'frame fire not allowed on name');

set request.uid = '00000000-0000-0000-0000-00000000000b';
select t_ok((select items @> array['fx_frame_fogo_azul', 'fx_name_fogo_azul'] and not (items && array['frame_teal_orange', 'name_teal_orange']) from public.my_wallet()), 'founder gets blue fire, not teal & orange');
select t_err($$select public.buy_item('frame_teal_orange')$$, 'exclusive', 'cannot buy team-only item');
select t_err($$select public.equip_item('frame', 'frame_teal_orange')$$, 'not_owned', 'cannot equip team-only item');

set request.uid = '00000000-0000-0000-0000-0000000000b9';
select t_ok((select not (items && array['fx_frame_fogo_azul', 'fx_name_fogo_azul', 'frame_teal_orange']) from public.my_wallet()), '101st gets no exclusives');
select t_err($$select public.buy_item('fx_frame_fogo_azul')$$, 'exclusive', 'cannot buy blue fire');
select t_err($$select public.equip_item('frameShine', 'fx_frame_fogo_azul')$$, 'not_owned', 'cannot equip blue fire');

set request.uid = '00000000-0000-0000-0000-0000000000ee';
select t_ok((select items @> array['frame_teal_orange', 'fx_name_fogo_azul'] from public.my_wallet()), 'support account has everything');

-- ===== missions
set request.uid = '00000000-0000-0000-0000-00000000000b';
select t_ok((select count(*) = 7 from public.my_missions()), 'adult sees 7 missions');
select t_ok((select bool_and(progress <= target) from public.my_missions()), 'progress capped at target');
select t_err($$select public.claim_mission('presenca')$$, 'not_done', 'cannot claim unfinished mission');
select t_err($$insert into public.mission_claims (user_id, mission_id, week) values (auth.uid(), 'presenca', current_date)$$, 'row-level security', 'cannot write claims directly');
update public.missions set reward = 1000;
select t_ok((select reward = 100 from public.my_missions() where id = 'presenca'), 'cannot change missions');
select t_err($$select public.claim_mission('nao-existe')$$, 'not_found', 'unknown mission');

set request.uid = '00000000-0000-0000-0000-00000000000c';
select t_ok((select count(*) = 6 and bool_and(id <> 'palpiteiro') from public.my_missions()), 'minor does not see the palpite mission');
select t_err($$select public.claim_mission('palpiteiro')$$, 'adult_only', 'minor cannot claim the palpite mission');

-- progress from real records: 3 active days, a baba with B linked as a player (2 matches, 3 goals)
reset role;
insert into public.user_days (user_id, day) select '00000000-0000-0000-0000-00000000000b', private.week_start() + g from generate_series(0, 2) g on conflict do nothing;
insert into public.user_days (user_id, day) values ('00000000-0000-0000-0000-00000000000b', private.week_start() - 1) on conflict do nothing;
insert into public.turma_players (id, turma_id, name, user_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Adulto', '00000000-0000-0000-0000-00000000000b');
insert into public.babas (id, created_by, turma_ids, title, finished, matches) values ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-00000000000b', array['11111111-1111-1111-1111-111111111111'::uuid], 'Quinta', true, 6);
insert into public.baba_stats (baba_id, turma_player_id, name, goals, matches) values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'Adulto', 3, 2);
set role authenticated;
set request.uid = '00000000-0000-0000-0000-00000000000b';
select t_ok((select progress = 3 from public.my_missions() where id = 'presenca'), 'days counted this week only');
select t_ok((select progress = 1 from public.my_missions() where id = 'jogar'), 'played baba counted');
select t_ok((select progress = 1 from public.my_missions() where id = 'organizar'), 'organized baba counted');
select t_ok((select progress = 3 from public.my_missions() where id = 'artilheiro'), 'goals counted');
create temp table bal0 as select balance from public.my_wallet();
select t_ok(public.claim_mission('presenca') = (select balance from bal0) + 100, 'claim presença +100');
select t_err($$select public.claim_mission('presenca')$$, 'already_claimed', 'once per week');
select public.claim_mission('jogar');
select public.claim_mission('organizar');
select public.claim_mission('artilheiro');
select t_ok((select balance = (select balance from bal0) + 650 from public.my_wallet()), 'rewards add up');
select t_ok((select count(*) = 4 from public.my_missions() where claimed), 'claimed flags');
select t_ok((select count(*) = 4 from public.points_ledger where user_id = auth.uid() and reason = 'missao'), 'ledger has missions');

-- someone else's player link doesn't count for D
set request.uid = '00000000-0000-0000-0000-00000000000d';
select t_ok((select progress = 0 from public.my_missions() where id = 'jogar'), 'other people''s babas do not count');
reset role;
