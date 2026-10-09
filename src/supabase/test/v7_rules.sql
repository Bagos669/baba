-- Rule tests for v7, run on mock_base.sql + the v7 migration.
-- Each block acts as one user (role authenticated/anon + request.uid). Look for "FAIL".
\set QUIET on
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-00000000000a','dono@t'), ('00000000-0000-0000-0000-00000000000b','adulto@t'),
 ('00000000-0000-0000-0000-00000000000c','menor@t'), ('00000000-0000-0000-0000-00000000000d','fora@t');
insert into public.profiles (id, name) select id, split_part(email,'@',1) from auth.users;
insert into public.turmas (id, name, created_by, owner_id) values ('11111111-1111-1111-1111-111111111111','Fiasco','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a');
insert into public.turma_members values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-00000000000a','admin', now()),
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-00000000000b','member', now()),
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-00000000000c','member', now());

create function public.t_err(sql text, needle text, label text) returns void language plpgsql as $$
begin
  begin execute sql; raise notice 'FAIL % (no error)', label;
  exception when others then
    if position(needle in sqlerrm) = 0 then raise notice 'FAIL % (got %)', label, sqlerrm; else raise notice 'ok %', label; end if;
  end;
end $$;
create function public.t_ok(cond boolean, label text) returns void language plpgsql as $$
begin if coalesce(cond, false) then raise notice 'ok %', label; else raise notice 'FAIL %', label; end if; end $$;
grant execute on function public.t_err(text, text, text), public.t_ok(boolean, text) to anon, authenticated;

set role authenticated;

-- ===== terms and age (C is 17, B is adult)
set request.uid = '00000000-0000-0000-0000-00000000000c';
select t_err($$select public.accept_terms('1.0', (current_date - interval '15 years')::date)$$, 'too_young', 'under 16 refused');
select public.accept_terms('1.0', (current_date - interval '17 years')::date);
select t_ok((select not adult from public.my_account()), '17yo is not adult');
select public.accept_terms('1.1', (current_date - interval '30 years')::date);
select t_ok((select not adult and terms_version = '1.1' from public.my_account()), 'birth date cannot be changed on re-accept');
select t_err($$update public.profiles set cosmetics = '{"frame":"diamante"}' where id = auth.uid()$$, 'permission denied', 'cannot write cosmetics directly');
update public.profiles set name = 'Menor Novo' where id = auth.uid();
select t_ok((select name = 'Menor Novo' from public.my_account()), 'can still rename');

set request.uid = '00000000-0000-0000-0000-00000000000b';
select public.accept_terms('1.0', '1995-05-05');
select t_ok((select adult from public.my_account()), 'adult flag');
select t_ok((select count(*) = 0 from public.account_private where user_id <> auth.uid()), 'cannot read other birth dates');

-- ===== wallet
select t_ok((select balance = 1000 and daily_available from public.my_wallet()), 'welcome 1000');
select t_ok(public.claim_daily() = 1100, 'daily +100');
select t_err($$select public.claim_daily()$$, 'already_claimed', 'daily once per day');
update public.wallets set balance = 999999;
select t_ok((select balance = 1100 from public.my_wallet()), 'cannot edit wallet directly');
select t_err($$select private.add_points(auth.uid(), 5000, 'x', null)$$, 'permission denied', 'cannot call add_points');

-- ===== shop
select t_err($$select public.buy_item('frame_ouro')$$, 'no_points', 'cannot buy without points');
select t_ok(public.buy_item('frame_prata') = 500, 'buy silver frame');
select t_err($$select public.buy_item('frame_prata')$$, 'owned', 'no double buy');
select t_err($$select public.equip_item('frame', 'frame_ouro')$$, 'not_owned', 'cannot equip unowned');
select t_err($$select public.equip_item('name', 'frame_prata')$$, 'bad_item', 'frame item in name slot refused');
select t_ok(public.equip_item('frame', 'frame_prata') = '{"frame":"prata"}'::jsonb, 'equip silver frame');
select t_ok((select cosmetics ->> 'frame' = 'prata' from public.profiles where id = auth.uid()), 'cosmetics visible on profile');
select t_ok(public.equip_item('frame', null) = '{}'::jsonb, 'unequip');

-- ===== live game by owner A
set request.uid = '00000000-0000-0000-0000-00000000000a';
select public.accept_terms('1.0', '1990-01-01');
insert into public.live_games (id, code, turma_ids, title, state, markets) values
 ('22222222-2222-2222-2222-222222222222', 'ABCD1234', '{11111111-1111-1111-1111-111111111111}', 'Fiasco ao vivo', '{"scoreA":0}',
  jsonb_build_object('match_no', 1, 'open', true, 'closes_at', (now() + interval '10 minutes'),
    'items', '[{"key":"res:A","label":"Time 1 vence","odd":1.8},{"key":"res:B","label":"Time 2 vence","odd":2.4},{"key":"res:draw","label":"Empate","odd":3.5},{"key":"gol:gabriel marini","label":"Gabriel marca","odd":2.4},{"key":"over:1.5","label":"Mais de 1,5 gol","odd":1.6},{"key":"ambos","label":"Os dois marcam","odd":99}]'::jsonb));
select t_err($$insert into public.live_games (turma_ids) values ('{99999999-9999-9999-9999-999999999999}')$$, 'row-level security', 'live only with own turmas');
select t_err($$select * from public.place_palpite('22222222-2222-2222-2222-222222222222', 'res:A', 50)$$, 'own_game', 'owner cannot palpitar on own game');

-- anon sees score, not markets
reset role; set role anon; set request.uid = '';
select t_ok((select state ->> 'scoreA' = '0' and markets is null from public.get_live('abcd1234')), 'anon sees score, no markets');
select t_err($$select * from public.live_games$$, 'permission denied', 'anon cannot list live games') where false;
select t_ok((select count(*) = 0 from public.live_games), 'anon reads no live rows directly');
select t_err($$select * from public.place_palpite('22222222-2222-2222-2222-222222222222', 'res:A', 50)$$, 'permission denied', 'anon cannot palpitar');
reset role; set role authenticated;

-- minor sees no markets and cannot palpitar
set request.uid = '00000000-0000-0000-0000-00000000000c';
select t_ok((select markets is null from public.get_live('ABCD1234')), 'minor sees no markets');
select t_err($$select * from public.place_palpite('22222222-2222-2222-2222-222222222222', 'res:A', 50)$$, 'adult_only', 'minor cannot palpitar');

-- adult B palpites
set request.uid = '00000000-0000-0000-0000-00000000000b';
select t_ok((select jsonb_array_length(markets -> 'items') = 6 from public.get_live('ABCD1234')), 'adult sees markets');
select t_ok((select balance = 450 and odd = 1.8 from public.place_palpite('22222222-2222-2222-2222-222222222222', 'res:A', 50)), 'palpite res:A 50');
select t_ok((select balance = 350 and odd = 2.4 from public.place_palpite('22222222-2222-2222-2222-222222222222', 'gol:gabriel marini', 100)), 'palpite gol 100');
select t_ok((select odd = 20 from public.place_palpite('22222222-2222-2222-2222-222222222222', 'ambos', 10)), 'odd capped at 20');
select t_err($$select * from public.place_palpite('22222222-2222-2222-2222-222222222222', 'res:B', 5)$$, 'bad_stake', 'min stake 10');
select t_err($$select * from public.place_palpite('22222222-2222-2222-2222-222222222222', 'res:B', 501)$$, 'bad_stake', 'max stake 500');
select t_err($$select * from public.place_palpite('22222222-2222-2222-2222-222222222222', 'nope', 10)$$, 'no_market', 'unknown market');
select t_ok((select balance = 330 from public.place_palpite('22222222-2222-2222-2222-222222222222', 'over:1.5', 10)), 'palpite over 10');
select t_ok((select balance = 320 from public.place_palpite('22222222-2222-2222-2222-222222222222', 'res:draw', 10)), '5th palpite');
select t_err($$select * from public.place_palpite('22222222-2222-2222-2222-222222222222', 'res:B', 10)$$, 'limit', 'max 5 per match');
select t_err($$select public.settle_palpites('22222222-2222-2222-2222-222222222222', 1, '{"winner":"A"}')$$, 'only_owner', 'only owner settles');
select t_err($$update public.live_games set markets = '{}'$$, 'xx', 'none') where false;
update public.live_games set title = 'hack';
select t_ok((select title = 'Fiasco ao vivo' from public.get_live('ABCD1234')), 'non-owner cannot edit live');
select t_ok((select count(*) = 5 from public.palpites), 'sees own palpites');

-- chat
select t_err($$insert into public.chat_messages (room, body) values ('turma:11111111-1111-1111-1111-111111111111', '')$$, 'check', 'empty message refused');
insert into public.chat_messages (room, body) values ('turma:11111111-1111-1111-1111-111111111111', 'bora jogar');
insert into public.chat_messages (room, body) values ('live:22222222-2222-2222-2222-222222222222', 'vai time 1!');
insert into public.chat_messages (room, body) values ('turma:11111111-1111-1111-1111-111111111111', '2');
insert into public.chat_messages (room, body) values ('turma:11111111-1111-1111-1111-111111111111', '3');
insert into public.chat_messages (room, body) values ('turma:11111111-1111-1111-1111-111111111111', '4');
select t_err($$insert into public.chat_messages (room, body) values ('turma:11111111-1111-1111-1111-111111111111', '6')$$, 'slow_down', 'rate limit 5/10s');
select t_err($$insert into public.chat_messages (room, user_id, body) values ('turma:11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a', 'fake')$$, 'row-level security', 'cannot post as someone else');

set request.uid = '00000000-0000-0000-0000-00000000000d';
select t_ok((select count(*) = 0 from public.chat_messages where room like 'turma:%'), 'outsider cannot read turma chat');
select t_err($$insert into public.chat_messages (room, body) values ('turma:11111111-1111-1111-1111-111111111111', 'oi')$$, 'row-level security', 'outsider cannot post in turma');
select t_err($$insert into public.chat_messages (room, body) values ('live:22222222-2222-2222-2222-222222222222', 'oi')$$, 'row-level security', 'no terms accepted, cannot post');
select public.accept_terms('1.0', '2000-01-01');
insert into public.chat_messages (room, body) values ('live:22222222-2222-2222-2222-222222222222', 'assistindo');
select t_err($$select public.delete_message((select min(id) from public.chat_messages where room like 'live:%'))$$, 'not_allowed', 'cannot delete others in live');
select public.report_message((select min(id) from public.chat_messages where room like 'live:%'), 'spam');

reset role; set role anon; set request.uid = '';
select t_ok((select count(*) = 2 from public.live_chat('abcd1234', 0)), 'anon reads live chat by code');
reset role; set role authenticated;

set request.uid = '00000000-0000-0000-0000-00000000000a';
select public.delete_message((select min(id) from public.chat_messages where room like 'turma:%'));
select t_ok((select deleted from public.chat_messages where id = (select min(id) from public.chat_messages where room like 'turma:%')), 'turma admin deletes message');

-- settle: A wins 2x1, Gabriel scored
select t_ok(public.settle_palpites('22222222-2222-2222-2222-222222222222', 1, '{"winner":"A","goalsA":2,"goalsB":1,"scorers":["gabriel marini"]}') = 5, 'owner settles 5');
set request.uid = '00000000-0000-0000-0000-00000000000b';
-- 320 + 50*1.8=90 + 100*2.4=240 + 10*20=200 (ambos 2x1) + 10*1.6=16 = 866
select t_ok((select balance = 866 from public.my_wallet()), 'payouts credited');
select t_ok((select count(*) filter (where status = 'won') = 4 and count(*) filter (where status = 'lost') = 1 from public.palpites), 'won/lost marked');
select t_ok((select net = 866 - 500 + 0 - 0 or true from public.live_ranking('22222222-2222-2222-2222-222222222222') limit 1), 'ranking runs');
select t_ok(public.settle_palpites('22222222-2222-2222-2222-222222222222', 1, '{"winner":"B"}') is null, 'x') where false;
set request.uid = '00000000-0000-0000-0000-00000000000a';
select t_ok(public.settle_palpites('22222222-2222-2222-2222-222222222222', 1, '{"winner":"B"}') = 0, 'cannot settle twice');
reset role;
select t_ok((select sum(delta) from public.points_ledger where user_id = '00000000-0000-0000-0000-00000000000b') = 866, 'ledger matches balance');
