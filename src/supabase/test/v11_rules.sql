-- Rule tests for v11 (compromisso, presença, penalidades). Run after the v10.1 chain + v11. Look for "FAIL".
\set QUIET on
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'm1@t'), ('00000000-0000-0000-0000-0000000000f2', 'm2@t');
insert into public.profiles (id, name) values ('00000000-0000-0000-0000-0000000000f1', 'Mário'), ('00000000-0000-0000-0000-0000000000f2', 'Zeca');
insert into public.turmas (id, name, created_by, owner_id, invite_code) values ('55555555-5555-5555-5555-555555555555', 'Compromisso FC', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'COMPRO11');
insert into public.turma_members values ('55555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-00000000000a', 'admin', now()),
  ('55555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-0000000000f1', 'member', now()),
  ('55555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-0000000000f2', 'member', now());
insert into public.turma_players (id, turma_id, name, user_id) values
  ('66666666-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'Mário', '00000000-0000-0000-0000-0000000000f1'),
  ('66666666-0000-0000-0000-000000000002', '55555555-5555-5555-5555-555555555555', 'Zeca', '00000000-0000-0000-0000-0000000000f2'),
  ('66666666-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555555', 'Tonho', null);
set role authenticated;
create temp table ev (k text, id uuid);
grant all on ev to authenticated;

set request.uid = '00000000-0000-0000-0000-0000000000f1';
select t_err($$select public.create_event('55555555-5555-5555-5555-555555555555', now() + interval '2 days', 'Quadra', null, null)$$, 'not_allowed', 'member cannot pull the list');
select t_err($$select public.rsvp_event('00000000-0000-0000-0000-000000000000', 'vou', null, null)$$, 'not_found', 'unknown event');

set request.uid = '00000000-0000-0000-0000-00000000000a';
select t_err($$select public.create_event('55555555-5555-5555-5555-555555555555', now() - interval '2 days', 'x', null, null)$$, 'bad_date', 'no lists in the past');
insert into ev select 'a', public.create_event('55555555-5555-5555-5555-555555555555', now() + interval '2 days', 'Quadra do Zé', 'Leva colete', 10);
select t_ok((select count(*) = 1 from public.chat_messages where room = 'turma:55555555-5555-5555-5555-555555555555' and body = ':ev:' || (select id from ev where k = 'a') || ':'), 'card posted in the turma chat');

set request.uid = '00000000-0000-0000-0000-0000000000f1';
select t_ok(public.rsvp_event((select id from ev where k = 'a'), 'vou', null, null) = 'vou', 'member answers for himself');
select t_err(format('select public.rsvp_event(%L, ''vou'', %L, null)', (select id from ev where k = 'a'), '66666666-0000-0000-0000-000000000002'), 'not_allowed', 'member cannot answer for others');
select t_err(format('select public.rsvp_event(%L, ''vou'', null, ''Fulano'')', (select id from ev where k = 'a')), 'not_allowed', 'member cannot add names');
select t_ok((select count(*) = 1 from public.event_rsvps), 'member sees the list');

set request.uid = '00000000-0000-0000-0000-00000000000d';
select t_ok((select count(*) = 0 from public.event_rsvps) and (select count(*) = 0 from public.turma_events where turma_id = '55555555-5555-5555-5555-555555555555'), 'outsider sees nothing');
select t_err(format('select public.rsvp_event(%L, ''vou'', null, null)', (select id from ev where k = 'a')), 'not_found', 'outsider cannot answer');

set request.uid = '00000000-0000-0000-0000-00000000000a';
select t_ok(public.import_rsvps((select id from ev where k = 'a'), '[{"name":"Zeca","player_id":"66666666-0000-0000-0000-000000000002","status":"vou"},{"name":"Tonho","player_id":"66666666-0000-0000-0000-000000000003"},{"name":"Avulso do Zé","status":"talvez"},{"name":"","status":"vou"}]') = 3, 'pasted list imported');
select t_ok((select string_agg(player_key || ':' || status || ':' || source, ',' order by player_key) from public.event_rsvps) = 'avulso do zé:talvez:colado,mário:vou:app,tonho:vou:colado,zeca:vou:colado', 'rows after paste');
select t_err($$insert into public.event_rsvps (event_id, player_key, name, status) values ((select id from ev where k = 'a'), 'x', 'x', 'vou')$$, 'row-level security', 'no direct writes');

-- three games where Zeca misses
insert into ev select 'b', public.create_event('55555555-5555-5555-5555-555555555555', now() + interval '3 days', null, null, null);
insert into ev select 'c', public.create_event('55555555-5555-5555-5555-555555555555', now() + interval '4 days', null, null, null);
select public.rsvp_event((select id from ev where k = 'b'), 'vou', '66666666-0000-0000-0000-000000000002', null);
select public.rsvp_event((select id from ev where k = 'c'), 'vou', '66666666-0000-0000-0000-000000000002', null);
select t_ok((select count(*) = 1 from public.close_event((select id from ev where k = 'a'), '[{"key":"Zeca","outcome":"miou"},{"key":"mário","outcome":"cumpriu"},{"key":"tonho","outcome":"justificado"}]') x where x.player_key = 'zeca' and x.level = 'aviso'), '1 miss: aviso');
select t_ok((select x.level = 'prioridade' from public.close_event((select id from ev where k = 'b'), '[{"key":"zeca","outcome":"miou"}]') x where x.player_key = 'zeca'), '2 misses: prioridade');
select t_ok((select x.level = 'bloqueio' from public.close_event((select id from ev where k = 'c'), '[{"key":"zeca","outcome":"miou"}]') x where x.player_key = 'zeca'), '3 misses: bloqueio');
select t_ok((select misses = 3 and kept = 0 from public.turma_discipline('55555555-5555-5555-5555-555555555555') where player_key = 'zeca'), 'adm sees counts');
select t_err(format('select public.rsvp_event(%L, ''vou'', null, null)', (select id from ev where k = 'a')), 'closed', 'closed list');

insert into ev select 'd', public.create_event('55555555-5555-5555-5555-555555555555', now() + interval '5 days', null, null, null);
set request.uid = '00000000-0000-0000-0000-0000000000f2';
select t_err(format('select public.rsvp_event(%L, ''vou'', null, null)', (select id from ev where k = 'd')), 'blocked', 'blocked player cannot confirm');
select t_ok(public.rsvp_event((select id from ev where k = 'd'), 'nao', null, null) = 'nao', 'blocked player can say no');
select t_ok((select level = 'bloqueio' and misses is null from public.turma_discipline('55555555-5555-5555-5555-555555555555') where player_key = 'zeca'), 'member sees level but not counts');
select t_ok((select count(*) = 0 from public.turma_sanctions), 'member cannot read sanctions');
select t_err($$select public.set_turma_rules('55555555-5555-5555-5555-555555555555', 'off', 1, 2, 3, 4, 60)$$, 'not_allowed', 'member cannot change rules');

set request.uid = '00000000-0000-0000-0000-00000000000a';
select t_ok(public.rsvp_event((select id from ev where k = 'd'), 'vou', '66666666-0000-0000-0000-000000000002', null) = 'vou', 'adm can still put him on the list');
-- manual rules: automatic level gone, manual sanction counts
select public.set_turma_rules('55555555-5555-5555-5555-555555555555', 'manual', 1, 2, 3, 4, 60);
select t_ok((select level = 'ok' from public.turma_discipline('55555555-5555-5555-5555-555555555555') where player_key = 'zeca'), 'manual mode: no automatic level');
select public.add_sanction('55555555-5555-5555-5555-555555555555', 'Mário', 'Mário', 'prioridade', 'chegou atrasado 3x', 7);
select t_ok((select level = 'prioridade' and jsonb_array_length(sanctions) = 1 from public.turma_discipline('55555555-5555-5555-5555-555555555555') where player_key = 'mário'), 'manual sanction');
select public.clear_sanction((select id from public.turma_sanctions where player_key = 'mário'));
select t_ok((select level = 'ok' from public.turma_discipline('55555555-5555-5555-5555-555555555555') where player_key = 'mário'), 'sanction cleared');
select t_err($$select public.set_turma_rules('55555555-5555-5555-5555-555555555555', 'auto', 3, 2, 3, 4, 60)$$, 'check', 'thresholds in order');
select public.set_turma_rules('55555555-5555-5555-5555-555555555555', 'auto', 1, 2, 3, 3, 60);
-- ban is never automatic: the level says banimento, the adm decides
select t_ok((select level = 'banimento' from public.turma_discipline('55555555-5555-5555-5555-555555555555') where player_key = 'zeca'), 'reaches banimento level');
select t_ok((select count(*) = 1 from public.turma_members where turma_id = '55555555-5555-5555-5555-555555555555' and user_id = '00000000-0000-0000-0000-0000000000f2'), 'still a member until the adm bans');
select t_ok(public.ban_player('55555555-5555-5555-5555-555555555555', 'zeca', '3 faltas') = 'banned_account', 'adm bans');
select t_ok((select count(*) = 0 from public.turma_members where turma_id = '55555555-5555-5555-5555-555555555555' and user_id = '00000000-0000-0000-0000-0000000000f2'), 'banned account left the turma');
set request.uid = '00000000-0000-0000-0000-0000000000f2';
select t_err($$select * from public.join_turma('COMPRO11')$$, 'banned_from_turma', 'banned account cannot rejoin');
set request.uid = '00000000-0000-0000-0000-00000000000a';
select public.unban_player('55555555-5555-5555-5555-555555555555', 'zeca');
set request.uid = '00000000-0000-0000-0000-0000000000f2';
select t_ok((select count(*) = 1 from public.join_turma('COMPRO11')), 'unbanned can rejoin');
-- cancel
set request.uid = '00000000-0000-0000-0000-00000000000a';
select public.update_event((select id from ev where k = 'd'), null, 'Outra quadra', null, 0, 'canceled');
select t_ok((select status = 'canceled' and place = 'Outra quadra' and max_players is null from public.turma_events where id = (select id from ev where k = 'd')), 'edit and cancel');
reset role;
select t_ok(public.srv_event_claim((select id from ev where k = 'd'), '00000000-0000-0000-0000-00000000000a', 'k1') = 'ok', 'push claim for adm');
select t_ok(public.srv_event_claim((select id from ev where k = 'd'), '00000000-0000-0000-0000-0000000000f1', 'k2') = 'not_allowed', 'push claim only adm');
