-- Rule tests for v11.7 (corrigir/excluir baba, nome do atleta, Times fechados). Roda depois do v11_7_correcoes.sql. Procure por "FAIL".
\set QUIET on
reset role;
reset request.uid;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000007a1', 'dono7@t'), ('00000000-0000-0000-0000-0000000007a2', 'adm7@t'), ('00000000-0000-0000-0000-0000000007a3', 'membro7@t'),
  ('00000000-0000-0000-0000-0000000007a4', 'bia7@t');
insert into public.profiles (id, name) values
  ('00000000-0000-0000-0000-0000000007a1', 'Dono'), ('00000000-0000-0000-0000-0000000007a2', 'Ana'), ('00000000-0000-0000-0000-0000000007a3', 'Mel'), ('00000000-0000-0000-0000-0000000007a4', 'Bia');
insert into public.turmas (id, name, created_by, owner_id, invite_code) values
  ('f7000000-0000-0000-0000-000000000001', 'Setima FC', '00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-0000000007a1', 'SETIMA07');
insert into public.turma_members (turma_id, user_id, role) values
  ('f7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007a1', 'member'),
  ('f7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007a2', 'admin'),
  ('f7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007a3', 'member'),
  ('f7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007a4', 'member');
insert into public.turma_players (id, turma_id, name) values
  ('f7000000-0000-0000-0000-000000000101', 'f7000000-0000-0000-0000-000000000001', 'Zeca'),
  ('f7000000-0000-0000-0000-000000000102', 'f7000000-0000-0000-0000-000000000001', 'Lia');
insert into public.turma_events (id, turma_id, created_by, starts_at, place)
  values ('e7000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007a2', now() - interval '3 hours', 'Quadra');
select private.add_points('00000000-0000-0000-0000-0000000007a4', 1000, 't7', null);

-- Baba finalizado com palpite da Bia (Mais 1,5 gols do Zeca, 50 pontos a 2,0).
set request.uid = '00000000-0000-0000-0000-0000000007a2';
select public.baba_save('b7000000-0000-0000-0000-000000000001', '{"firstKickoffAt":1,"settings":{"teamsMode":"open"}}', array['f7000000-0000-0000-0000-000000000001']::uuid[], 'Setima FC', date '2026-10-16', 0, 'e7000000-0000-0000-0000-000000000001');
reset role; reset request.uid;
insert into public.prop_markets (id, event_id, turma_id, player_id, kind, metric, line, status)
  values ('a7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000101', 'ou', 'goals', 1.5, 'locked');
insert into public.prop_bets (market_id, user_id, selection, stake, odd) values ('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007a4', 'mais', 50, 2.0);
select private.add_points('00000000-0000-0000-0000-0000000007a4', -50, 'palpite-pre', '1');
set request.uid = '00000000-0000-0000-0000-0000000007a2';
select public.baba_finish('b7000000-0000-0000-0000-000000000001', '{"venue":"","games":[{"labelA":"1","labelB":"2","scoreA":2,"scoreB":2,"pens":{"a":4,"b":3}},{"labelA":"1","labelB":"3","scoreA":1,"scoreB":0}]}',
  array['f7000000-0000-0000-0000-000000000001']::uuid[], 'Setima FC', date '2026-10-16', 2, 'e7000000-0000-0000-0000-000000000001',
  '[{"turma_player_id":"f7000000-0000-0000-0000-000000000101","name":"Zeca","goals":2,"assists":0,"saves":0,"matches":2,"wins":1},{"turma_player_id":null,"name":"Lia","goals":1,"assists":1,"saves":0,"matches":2,"wins":1}]');
reset role; reset request.uid;
select t_ok((select status = 'won' from public.prop_bets where market_id = 'a7000000-0000-0000-0000-000000000001'), 'palpite liquidado como ganho (2 gols)');
select t_ok((select balance = 1050 from public.wallets where user_id = '00000000-0000-0000-0000-0000000007a4'), 'saldo 950 + 100 = 1050');

-- Permissões
set request.uid = '00000000-0000-0000-0000-0000000007a3';
select t_err($$select public.baba_edit('b7000000-0000-0000-0000-000000000001', date '2026-10-15')$$, 'forbidden', 'membro comum não edita baba');
select t_err($$select public.baba_remove('b7000000-0000-0000-0000-000000000001')$$, 'forbidden', 'membro comum não exclui baba');
select t_err($$select public.turma_player_rename('f7000000-0000-0000-0000-000000000101', 'Zeca Novo')$$, 'forbidden', 'membro comum não renomeia atleta');
set request.uid = '00000000-0000-0000-0000-0000000007a2';
select t_err($$select public.baba_edit('b7000000-0000-0000-0000-000000000001', null, 'quadra')$$, 'invalid_venue', 'local inválido recusado');

-- Editar: data, local, placar, gols. 1 gol => Mais 1,5 perde e o prêmio é revertido.
set request.uid = '00000000-0000-0000-0000-0000000007a2';
select public.baba_edit('b7000000-0000-0000-0000-000000000001', date '2026-10-15', 'society', '[{"i":0,"a":3,"b":2},{"i":1,"a":1,"b":0}]',
  (select jsonb_agg(jsonb_build_object('id', id, 'goals', case when name = 'Zeca' then 1 else goals end, 'assists', assists, 'saves', saves)) from public.baba_stats where baba_id = 'b7000000-0000-0000-0000-000000000001'));
reset role; reset request.uid;
select t_ok((select played_on = date '2026-10-15' and state ->> 'venue' = 'society' and (state #>> '{games,0,scoreA}') = '3' and not (state -> 'games' -> 0) ? 'pens' from public.babas where id = 'b7000000-0000-0000-0000-000000000001'), 'data, local e placar mudaram; pênaltis saíram do jogo que deixou de empatar');
select t_ok((select goals = 1 from public.baba_stats where baba_id = 'b7000000-0000-0000-0000-000000000001' and name = 'Zeca'), 'gols do Zeca = 1');
select t_ok((select status = 'lost' from public.prop_bets where market_id = 'a7000000-0000-0000-0000-000000000001'), 'palpite virou perdido após a correção');
select t_ok((select balance = 950 from public.wallets where user_id = '00000000-0000-0000-0000-0000000007a4'), 'prêmio revertido: saldo 950');
select t_ok((select count(*) = 1 from public.points_ledger where reason = 'palpite-correcao' and user_id = '00000000-0000-0000-0000-0000000007a4'), 'extrato tem uma linha palpite-correcao');
select t_ok((select count(*) = 1 from public.babas where id = 'b7000000-0000-0000-0000-000000000001' and finished), 'baba continua finalizado');
-- Voltou a 2 gols: liquida de novo como ganho.
set request.uid = '00000000-0000-0000-0000-0000000007a1';
select public.baba_edit('b7000000-0000-0000-0000-000000000001', null, null, '[]',
  (select jsonb_agg(jsonb_build_object('id', id, 'goals', case when name = 'Zeca' then 2 else goals end)) from public.baba_stats where baba_id = 'b7000000-0000-0000-0000-000000000001'));
reset role; reset request.uid;
select t_ok((select status = 'won' from public.prop_bets where market_id = 'a7000000-0000-0000-0000-000000000001') and (select balance = 1050 from public.wallets where user_id = '00000000-0000-0000-0000-0000000007a4'), 'dono corrige de volta: ganhou e saldo 1050');

-- Baba finalizado continua fechado para gravação comum
set request.uid = '00000000-0000-0000-0000-0000000007a2';
update public.babas set title = 'hack' where id = 'b7000000-0000-0000-0000-000000000001';
reset role; reset request.uid;
select t_ok((select title = 'Setima FC' from public.babas where id = 'b7000000-0000-0000-0000-000000000001'), 'update comum de baba finalizado é ignorado');

-- Nome do atleta
set request.uid = '00000000-0000-0000-0000-0000000007a2';
select t_err($$select public.turma_player_rename('f7000000-0000-0000-0000-000000000101', '   ')$$, 'name_empty', 'nome vazio recusado');
select t_err($$select public.turma_player_rename('f7000000-0000-0000-0000-000000000101', ' lia ')$$, 'name_taken', 'nome repetido recusado');
select public.turma_player_rename('f7000000-0000-0000-0000-000000000102', 'Lia Souza');
reset role; reset request.uid;
select t_ok((select name = 'Lia Souza' from public.turma_players where id = 'f7000000-0000-0000-0000-000000000102'), 'atleta renomeado');
select t_ok((select turma_player_id = 'f7000000-0000-0000-0000-000000000102' and name = 'Lia Souza' from public.baba_stats where baba_id = 'b7000000-0000-0000-0000-000000000001' and goals = 1), 'stats soltas ligadas ao atleta e com o nome novo');
select t_ok((select pname = 'Lia Souza' and goals = 1 from private.stat_rows('f7000000-0000-0000-0000-000000000001', date '2000-01-01', date '2100-01-01', null) where pid = 'f7000000-0000-0000-0000-000000000102'), 'ranking da turma mostra o nome novo com os mesmos números');
select t_ok((select name = 'Dono' from public.profiles where id = '00000000-0000-0000-0000-0000000007a1'), 'conta do usuário não muda');

-- Times fechados: só dono/adm mudam
set request.uid = '00000000-0000-0000-0000-0000000007a2';
select public.baba_save('b7000000-0000-0000-0000-000000000002', '{"firstKickoffAt":1,"settings":{"teamsMode":"open"}}', array['f7000000-0000-0000-0000-000000000001']::uuid[], 'x', current_date, 0);
select public.baba_save('b7000000-0000-0000-0000-000000000002', '{"firstKickoffAt":1,"settings":{"teamsMode":"closed"}}', array['f7000000-0000-0000-0000-000000000001']::uuid[], 'x', current_date, 0);
reset role; reset request.uid;
select t_ok((select state -> 'settings' ->> 'teamsMode' = 'closed' from public.babas where id = 'b7000000-0000-0000-0000-000000000002'), 'adm liga Times fechados');
-- membro comum que criou o próprio baba não liga
set request.uid = '00000000-0000-0000-0000-0000000007a3';
select public.baba_save('b7000000-0000-0000-0000-000000000003', '{"firstKickoffAt":1,"settings":{"teamsMode":"closed"}}', array['f7000000-0000-0000-0000-000000000001']::uuid[], 'x', current_date, 0);
reset role; reset request.uid;
select t_ok((select state -> 'settings' ->> 'teamsMode' is null from public.babas where id = 'b7000000-0000-0000-0000-000000000003'), 'membro comum não consegue ligar Times fechados no servidor');

-- Excluir: palpite devolvido, saldo bate com o extrato
set request.uid = '00000000-0000-0000-0000-0000000007a2';
select public.baba_remove('b7000000-0000-0000-0000-000000000001');
select public.baba_remove('b7000000-0000-0000-0000-000000000001');
reset role; reset request.uid;
select t_ok(not exists (select 1 from public.babas where id = 'b7000000-0000-0000-0000-000000000001') and not exists (select 1 from public.baba_stats where baba_id = 'b7000000-0000-0000-0000-000000000001'), 'baba e stats excluídos (e excluir de novo não dá erro)');
select t_ok((select balance = 1000 from public.wallets where user_id = '00000000-0000-0000-0000-0000000007a4'), 'pontos devolvidos: saldo 1000');
select t_ok((select sum(delta) = 1000 from public.points_ledger where user_id = '00000000-0000-0000-0000-0000000007a4'), 'extrato soma o saldo');
select t_ok((select status = 'void' and void_reason = 'excluido' from public.prop_markets where id = 'a7000000-0000-0000-0000-000000000001') and (select status = 'void' from public.prop_bets where market_id = 'a7000000-0000-0000-0000-000000000001'), 'mercado e palpite anulados');
select t_ok(not exists (select 1 from private.stat_rows('f7000000-0000-0000-0000-000000000001', date '2000-01-01', date '2100-01-01', null) where goals > 0), 'ranking sem os números do baba excluído');
