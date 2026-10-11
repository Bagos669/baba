-- Rule tests for v10 (pênaltis columns, Desafio 1v1). Run after the v9 chain + v10. Look for "FAIL".
\set QUIET on
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'e1@t'), ('00000000-0000-0000-0000-0000000000e2', 'e2@t'), ('00000000-0000-0000-0000-0000000000e3', 'e3@t');
insert into public.profiles (id, name) values ('00000000-0000-0000-0000-0000000000e1', 'Ana'), ('00000000-0000-0000-0000-0000000000e2', 'Bruno'), ('00000000-0000-0000-0000-0000000000e3', 'Sem termos');
select t_ok((select count(*) = 3 from information_schema.columns where table_name = 'baba_stats' and column_name in ('pen_goals', 'pen_misses', 'pen_saves')), 'penalty columns');
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000000e1'; select public.accept_terms('1.0', '1990-01-01'); select balance from public.my_wallet();
set request.uid = '00000000-0000-0000-0000-0000000000e2'; select public.accept_terms('1.0', '1991-01-01'); select balance from public.my_wallet();

-- A (owner) streams; match 1 open
set request.uid = '00000000-0000-0000-0000-00000000000a';
insert into public.live_games (id, code, turma_ids, title, state, markets) values
 ('44444444-4444-4444-4444-444444444444', 'DESAFIO1', '{11111111-1111-1111-1111-111111111111}', 'Desafio',
  '{"A":{"label":"Time 1","names":["Gabriel Marini","Beto"],"score":0},"B":{"label":"Time 2","names":["Caio","Duda"],"score":0}}',
  jsonb_build_object('match_no', 1, 'open', true, 'closes_at', (now() + interval '10 minutes'), 'items', '[{"key":"res:A","label":"Time 1 vence","odd":1.8}]'::jsonb));

-- Bruno chats in the live room, so Ana can find him
set request.uid = '00000000-0000-0000-0000-0000000000e2';
insert into public.chat_messages (room, user_id, body) values ('live:44444444-4444-4444-4444-444444444444', auth.uid(), 'bora');
set request.uid = '00000000-0000-0000-0000-0000000000e1';
select t_ok((select bool_or(id = '00000000-0000-0000-0000-0000000000e2') from public.challenge_candidates('44444444-4444-4444-4444-444444444444')), 'chatter is a candidate');
select t_ok((select not bool_or(id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e3')) from public.challenge_candidates('44444444-4444-4444-4444-444444444444')), 'no owner, minor, self or no-terms');

-- refusals
select t_err($$select public.create_challenge('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000e1', 'vencedor', 'A', 'B', 'x', 'y', 50)$$, 'self', 'cannot challenge yourself');
select t_err($$select public.create_challenge('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-00000000000a', 'vencedor', 'A', 'B', 'x', 'y', 50)$$, 'own_game', 'cannot challenge the organizer');
select t_err($$select public.create_challenge('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-00000000000c', 'vencedor', 'A', 'B', 'x', 'y', 50)$$, 'opponent_not_allowed', 'cannot challenge a minor');
select t_err($$select public.create_challenge('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000e3', 'vencedor', 'A', 'B', 'x', 'y', 50)$$, 'opponent_not_allowed', 'cannot challenge someone without terms');
select t_err($$select public.create_challenge('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000e2', 'vencedor', 'A', 'B', 'x', 'y', 5)$$, 'bad_stake', 'stake too low');
select t_err($$select public.create_challenge('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000e2', 'vencedor', 'A', 'A', 'x', 'y', 50)$$, 'bad_pick', 'same side');
select t_err($$select public.create_challenge('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000e2', 'gols', 'gabriel marini', 'ninguem', 'x', 'y', 50)$$, 'bad_pick', 'player not on the court');
select t_err($$select public.create_challenge('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000e2', 'gols', 'Gabriel Marini', 'gabriel marini', 'x', 'y', 50)$$, 'bad_pick', 'same player');
select t_err($$select public.create_challenge('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000e2', 'placar', 'A', 'B', 'x', 'y', 50)$$, 'bad_kind', 'unknown kind');
select t_err($$insert into public.challenges (live_id, match_no, kind, challenger, opponent, stake, pick_c, pick_o, label_c, label_o) values ('44444444-4444-4444-4444-444444444444', 1, 'vencedor', auth.uid(), '00000000-0000-0000-0000-0000000000e2', 10, 'A', 'B', 'x', 'y')$$, 'row-level security', 'no direct insert');
set request.uid = '00000000-0000-0000-0000-00000000000c';
select t_err($$select public.create_challenge('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000e2', 'vencedor', 'A', 'B', 'x', 'y', 50)$$, 'adult_only', 'minor cannot challenge');

-- Ana: four challenges against Bruno (stakes are taken right away)
set request.uid = '00000000-0000-0000-0000-0000000000e1';
create temp table ids (k text, id bigint);
grant all on ids to authenticated;
insert into ids select 'venc', public.create_challenge('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000e2', 'vencedor', 'a', 'b', 'Time 1 vence', 'Time 2 vence', 100);
insert into ids select 'recusa', public.create_challenge('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000e2', 'gols', 'Gabriel Marini', 'caio', 'Gabriel Marini faz mais gols', 'Caio faz mais gols', 50);
insert into ids select 'cancela', public.create_challenge('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000e2', 'vencedor', 'B', 'A', 'x', 'y', 20);
select t_ok((select balance = 830 from public.my_wallet()), 'stakes taken (1000 - 170)');
select t_err($$select public.create_challenge('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000e2', 'vencedor', 'A', 'B', 'x', 'y', 10)$$, 'limit', 'at most 3 open challenges per match');
select public.cancel_challenge((select id from ids where k = 'cancela'));
select t_ok((select balance = 850 from public.my_wallet()), 'cancel gives the stake back');
insert into ids select 'pendente', public.create_challenge('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000e2', 'vencedor', 'B', 'A', 'x', 'y', 30);
select t_err(format('select public.respond_challenge(%s, true)', (select id from ids where k = 'venc')), 'not_found', 'challenger cannot accept own challenge');
select t_ok((select pick_c = 'A' and pick_o = 'B' from public.challenges where id = (select id from ids where k = 'venc')), 'sides stored upper-case');

set request.uid = '00000000-0000-0000-0000-0000000000e2';
select t_ok((select count(*) = 4 and count(*) filter (where status = 'pending' and not mine_is_challenger) = 3 from public.my_challenges('44444444-4444-4444-4444-444444444444')), 'Bruno sees the challenges');
select t_err(format('select public.cancel_challenge(%s)', (select id from ids where k = 'venc')), 'not_found', 'opponent cannot cancel');
select t_ok(public.respond_challenge((select id from ids where k = 'venc'), true) = 'accepted', 'accept');
select t_ok(public.respond_challenge((select id from ids where k = 'recusa'), false) = 'declined', 'decline');
select t_err(format('select public.respond_challenge(%s, true)', (select id from ids where k = 'venc')), 'already', 'cannot answer twice');
select t_ok((select balance = 900 from public.my_wallet()), 'Bruno paid his side');
-- Bruno challenges back on goals
insert into ids select 'gols', public.create_challenge('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000e1', 'gols', 'Caio', 'Gabriel Marini', 'Caio faz mais gols', 'Gabriel Marini faz mais gols', 50);
set request.uid = '00000000-0000-0000-0000-0000000000e1';
select public.respond_challenge((select id from ids where k = 'gols'), true);
select t_ok((select balance = 820 from public.my_wallet()), 'Ana: stakes 100 + 30 + 50 out, declined 50 back');
-- not visible to someone else
set request.uid = '00000000-0000-0000-0000-00000000000b';
select t_ok((select count(*) = 0 from public.challenges), 'others see no challenges');
select t_ok((select count(*) = 0 from public.my_challenges('44444444-4444-4444-4444-444444444444')), 'others: empty list');
select t_err($$select public.settle_palpites('44444444-4444-4444-4444-444444444444', 1, '{"winner":"A"}')$$, 'only_owner', 'only owner settles');

-- match 1 ends 1x2: Caio 2, Gabriel 1
set request.uid = '00000000-0000-0000-0000-00000000000a';
select public.settle_palpites('44444444-4444-4444-4444-444444444444', 1, '{"winner":"B","goalsA":1,"goalsB":2,"scorers":["gabriel marini","caio"],"goalsBy":{"gabriel marini":1,"caio":2}}');
set request.uid = '00000000-0000-0000-0000-0000000000e1';
select t_ok((select balance = 900 - 50 from public.my_wallet()), 'Ana: lost 100 + 50, pending 30 returned');
select t_ok((select status = 'void' from public.challenges where id = (select id from ids where k = 'pendente')), 'pending becomes void');
set request.uid = '00000000-0000-0000-0000-0000000000e2';
select t_ok((select balance = 900 - 50 + 200 + 100 from public.my_wallet()), 'Bruno won both');
select t_ok((select string_agg(status, ',' order by id) = 'won_o,declined,canceled,void,won_c' from public.challenges), 'statuses');
select t_ok((select sum(delta) = (select balance from public.wallets where user_id = auth.uid()) from public.points_ledger where user_id = auth.uid()), 'ledger matches balance');

-- match 2: a tie gives both stakes back; goals with nobody scoring is a tie too
set request.uid = '00000000-0000-0000-0000-00000000000a';
update public.live_games set markets = jsonb_set(markets, '{match_no}', '2') where id = '44444444-4444-4444-4444-444444444444';
set request.uid = '00000000-0000-0000-0000-0000000000e1';
insert into ids select 'empate', public.create_challenge('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000e2', 'vencedor', 'A', 'B', 'x', 'y', 40);
insert into ids select 'zero', public.create_challenge('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000e2', 'gols', 'beto', 'duda', 'x', 'y', 40);
set request.uid = '00000000-0000-0000-0000-0000000000e2';
select public.respond_challenge((select id from ids where k = 'empate'), true);
select public.respond_challenge((select id from ids where k = 'zero'), true);
set request.uid = '00000000-0000-0000-0000-00000000000a';
select public.settle_palpites('44444444-4444-4444-4444-444444444444', 2, '{"winner":"draw","goalsA":1,"goalsB":1,"scorers":["gabriel marini","caio"],"goalsBy":{"gabriel marini":1,"caio":1}}');
set request.uid = '00000000-0000-0000-0000-0000000000e1';
select t_ok((select balance = 850 from public.my_wallet()), 'push: Ana back to 850');
select t_ok((select count(*) = 2 from public.challenges where status = 'push'), 'two pushes');
-- old format result (no goalsBy): scorers list counts as one goal each
set request.uid = '00000000-0000-0000-0000-00000000000a';
update public.live_games set markets = jsonb_set(markets, '{match_no}', '3') where id = '44444444-4444-4444-4444-444444444444';
set request.uid = '00000000-0000-0000-0000-0000000000e1';
insert into ids select 'velho', public.create_challenge('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000e2', 'gols', 'beto', 'duda', 'x', 'y', 10);
set request.uid = '00000000-0000-0000-0000-0000000000e2';
select public.respond_challenge((select id from ids where k = 'velho'), true);
set request.uid = '00000000-0000-0000-0000-00000000000a';
select public.settle_palpites('44444444-4444-4444-4444-444444444444', 3, '{"winner":"A","goalsA":1,"goalsB":0,"scorers":["beto"]}');
set request.uid = '00000000-0000-0000-0000-0000000000e1';
select t_ok((select status = 'won_c' from public.challenges where id = (select id from ids where k = 'velho')), 'scorers without counts still settle');
set request.uid = '00000000-0000-0000-0000-00000000000a';

-- closed market: accepting voids the challenge and returns the stake
update public.live_games set markets = jsonb_build_object('match_no', 4, 'open', true, 'closes_at', now() + interval '5 minutes') where id = '44444444-4444-4444-4444-444444444444';
set request.uid = '00000000-0000-0000-0000-0000000000e1';
insert into ids select 'tarde', public.create_challenge('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000e2', 'vencedor', 'A', 'B', 'x', 'y', 25);
set request.uid = '00000000-0000-0000-0000-00000000000a';
update public.live_games set markets = jsonb_build_object('match_no', 4, 'open', false) where id = '44444444-4444-4444-4444-444444444444';
set request.uid = '00000000-0000-0000-0000-0000000000e2';
select t_err(format('select public.respond_challenge(%s, true)', (select id from ids where k = 'tarde')), 'closed', 'cannot accept after close');
reset role;
-- the exception rolled back the void; the next settle returns it
set role authenticated;
set request.uid = '00000000-0000-0000-0000-00000000000a';
select public.settle_palpites('44444444-4444-4444-4444-444444444444', 4, '{"void":true}');
set request.uid = '00000000-0000-0000-0000-0000000000e1';
select t_ok((select balance = 860 from public.my_wallet()), 'Ana: 850 + 10 won, closed one returned');
select t_ok((select status = 'void' from public.challenges where id = (select id from ids where k = 'tarde')), 'late challenge void');

-- support ends a game with an accepted challenge: both stakes come back
set request.uid = '00000000-0000-0000-0000-00000000000a';
update public.live_games set markets = jsonb_build_object('match_no', 5, 'open', true) where id = '44444444-4444-4444-4444-444444444444';
set request.uid = '00000000-0000-0000-0000-0000000000e1';
insert into ids select 'fim', public.create_challenge('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000e2', 'vencedor', 'A', 'B', 'x', 'y', 60);
set request.uid = '00000000-0000-0000-0000-0000000000e2';
select public.respond_challenge((select id from ids where k = 'fim'), true);
set request.uid = '00000000-0000-0000-0000-0000000000ee';
select public.admin_end_live('44444444-4444-4444-4444-444444444444');
set request.uid = '00000000-0000-0000-0000-0000000000e1';
select t_ok((select balance = 860 from public.my_wallet()), 'support end returns Ana''s stake');
set request.uid = '00000000-0000-0000-0000-0000000000e2';
select t_ok((select balance = 1140 from public.my_wallet()), 'support end returns Bruno''s stake');
select t_ok((select sum(delta) = (select balance from public.wallets where user_id = auth.uid()) from public.points_ledger where user_id = auth.uid()), 'Bruno ledger matches');
reset role;
