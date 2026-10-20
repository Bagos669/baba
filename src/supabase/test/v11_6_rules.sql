-- Rule tests for v11.6 (baba compartilhado entre dono e adms, finalização única, babas pendentes).
-- Roda depois do v11_6_baba_compartilhado.sql (cadeia completa). Procure por "FAIL".
\set QUIET on
reset role;
reset request.uid;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000006a1', 'dono6@t'), ('00000000-0000-0000-0000-0000000006a2', 'adma6@t'), ('00000000-0000-0000-0000-0000000006a3', 'admb6@t'),
  ('00000000-0000-0000-0000-0000000006a4', 'membro6@t'), ('00000000-0000-0000-0000-0000000006a5', 'fora6@t'), ('00000000-0000-0000-0000-0000000006a6', 'admc6@t');
insert into public.profiles (id, name) values
  ('00000000-0000-0000-0000-0000000006a1', 'Dono'), ('00000000-0000-0000-0000-0000000006a2', 'Ana'), ('00000000-0000-0000-0000-0000000006a3', 'Beto'),
  ('00000000-0000-0000-0000-0000000006a4', 'Mel'), ('00000000-0000-0000-0000-0000000006a5', 'Fora'), ('00000000-0000-0000-0000-0000000006a6', 'Caio');
insert into public.turmas (id, name, created_by, owner_id, invite_code) values
  ('f6000000-0000-0000-0000-000000000001', 'Quinta FC', '00000000-0000-0000-0000-0000000006a1', '00000000-0000-0000-0000-0000000006a1', 'QUINTA06'),
  ('f6000000-0000-0000-0000-000000000002', 'Sexta FC', '00000000-0000-0000-0000-0000000006a6', '00000000-0000-0000-0000-0000000006a6', 'SEXTA006');
insert into public.turma_members (turma_id, user_id, role) values
  ('f6000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006a1', 'member'),
  ('f6000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006a2', 'admin'),
  ('f6000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006a3', 'admin'),
  ('f6000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006a4', 'member'),
  ('f6000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000006a6', 'member'),
  ('f6000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000006a2', 'member');
insert into public.turma_players (id, turma_id, name) values
  ('f6000000-0000-0000-0000-000000000101', 'f6000000-0000-0000-0000-000000000001', 'Zeca'),
  ('f6000000-0000-0000-0000-000000000201', 'f6000000-0000-0000-0000-000000000002', 'Lulu');

-- Ana (adm) cria o baba e ainda não começou a primeira partida.
set request.uid = '00000000-0000-0000-0000-0000000006a2';
select t_ok((public.baba_save('b6000000-0000-0000-0000-000000000001', '{"players":[],"match":{"scoreA":0,"scoreB":0}}', array['f6000000-0000-0000-0000-000000000001']::uuid[],
  'Quinta FC', current_date, 0) ->> 'rev')::integer = 1, 'baba novo começa na versão 1');
select t_ok((select started_by is null from public.babas where id = 'b6000000-0000-0000-0000-000000000001'), 'sem partida iniciada não está em andamento');
set request.uid = '00000000-0000-0000-0000-0000000006a3';
select t_ok((select (x ->> 'started')::boolean = false from jsonb_array_elements(public.babas_shared()) x where x ->> 'id' = 'b6000000-0000-0000-0000-000000000001'),
  'outro adm vê o baba como não iniciado');

-- Ana dá o primeiro apito.
set request.uid = '00000000-0000-0000-0000-0000000006a2';
select t_ok((public.baba_save('b6000000-0000-0000-0000-000000000001', '{"firstKickoffAt":1,"players":[],"match":{"scoreA":1,"scoreB":0,"isRunning":true},"court":{"A":{"label":1},"B":{"label":2}},"matchHistory":[{"scoreA":2,"scoreB":1}]}',
  array['f6000000-0000-0000-0000-000000000001']::uuid[], 'Quinta FC', current_date, 1, null, 1) ->> 'rev')::integer = 2, 'gravação sobe a versão');
select t_ok((select started_by = '00000000-0000-0000-0000-0000000006a2' from public.babas where id = 'b6000000-0000-0000-0000-000000000001'), 'o servidor grava quem iniciou');

-- Beto (adm), o dono e o adm da outra turma (quando entra no baba das duas turmas) controlam; membro e quem é de fora não.
set request.uid = '00000000-0000-0000-0000-0000000006a3';
select t_ok((select x ->> 'started_by_name' = 'Ana' and (x ->> 'goals')::integer = 4 and (x ->> 'matches')::integer = 1 and (x ->> 'live_match')::boolean
  from jsonb_array_elements(public.babas_shared()) x where x ->> 'id' = 'b6000000-0000-0000-0000-000000000001'), 'card: iniciado por Ana, 1 partida, 4 gols, partida em andamento');
select t_ok((public.baba_get('b6000000-0000-0000-0000-000000000001') -> 'state' ->> 'firstKickoffAt') = '1', 'outro adm baixa o estado atual');
select t_ok((public.baba_save('b6000000-0000-0000-0000-000000000001', '{"firstKickoffAt":1,"queue":[3,2,1]}', array['f6000000-0000-0000-0000-000000000001']::uuid[],
  'Quinta FC', current_date, 1, null, 2) ->> 'rev')::integer = 3, 'outro adm grava (mesmas permissões de quem iniciou)');
select t_ok((public.baba_rev('b6000000-0000-0000-0000-000000000001') ->> 'updated_by_name') = 'Beto', 'a versão diz quem gravou por último');
set request.uid = '00000000-0000-0000-0000-0000000006a1';
select t_ok((select count(*) = 1 from jsonb_array_elements(public.babas_shared()) x where x ->> 'id' = 'b6000000-0000-0000-0000-000000000001'), 'o dono (owner_id) vê o baba');
-- Edição simultânea: Ana grava em cima da versão 2 (Beto já gravou a 3): vale a última, sem erro, e avisa o conflito.
set request.uid = '00000000-0000-0000-0000-0000000006a2';
select t_ok((public.baba_save('b6000000-0000-0000-0000-000000000001', '{"firstKickoffAt":1,"queue":[1,2,3]}', array['f6000000-0000-0000-0000-000000000001']::uuid[],
  'Quinta FC', current_date, 1, null, 2) ->> 'conflict')::boolean, 'gravação em cima de versão velha é aceita e marcada como conflito');
select t_ok((select state -> 'queue' = '[1,2,3]'::jsonb and rev = 4 from public.babas where id = 'b6000000-0000-0000-0000-000000000001'), 'vale a última gravação aceita');

set request.uid = '00000000-0000-0000-0000-0000000006a4';
select t_ok(not exists (select 1 from jsonb_array_elements(public.babas_shared()) x where x ->> 'id' = 'b6000000-0000-0000-0000-000000000001'), 'membro comum não vê o card');
select t_err($$select public.baba_save('b6000000-0000-0000-0000-000000000001', '{"queue":[]}', array['f6000000-0000-0000-0000-000000000001']::uuid[], 'x', current_date, 0)$$,
  'forbidden', 'membro comum não grava o baba');
select t_err($$select public.baba_get('b6000000-0000-0000-0000-000000000001')$$, 'forbidden', 'membro comum não abre o controle');
select t_err($$select public.baba_finish('b6000000-0000-0000-0000-000000000001', '{}', array['f6000000-0000-0000-0000-000000000001']::uuid[], 'x', current_date, 0)$$,
  'forbidden', 'membro comum não finaliza');
set request.uid = '00000000-0000-0000-0000-0000000006a5';
select t_err($$select public.baba_save('b6000000-0000-0000-0000-000000000001', '{"queue":[]}', '{}'::uuid[], 'x', current_date, 0)$$, 'forbidden', 'quem é de fora não grava');
select t_err($$select public.baba_rev('b6000000-0000-0000-0000-000000000001')$$, 'forbidden', 'quem é de fora não lê a versão');
-- Um adm não tira o baba da turma que não é dele.
set request.uid = '00000000-0000-0000-0000-0000000006a3';
select public.baba_save('b6000000-0000-0000-0000-000000000001', '{"firstKickoffAt":1}', '{}'::uuid[], 'Quinta FC', current_date, 1);
select t_ok((select turma_ids = array['f6000000-0000-0000-0000-000000000001']::uuid[] from public.babas where id = 'b6000000-0000-0000-0000-000000000001'),
  'adm não tira o baba da própria turma');

-- Baba com duas turmas: o adm da Sexta FC controla também.
set request.uid = '00000000-0000-0000-0000-0000000006a2';
select public.baba_save('b6000000-0000-0000-0000-000000000002', '{"firstKickoffAt":5}', array['f6000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000002']::uuid[],
  'Quinta FC + Sexta FC', current_date, 0);
set request.uid = '00000000-0000-0000-0000-0000000006a6';
select t_ok((select count(*) = 1 from jsonb_array_elements(public.babas_shared()) x where x ->> 'id' = 'b6000000-0000-0000-0000-000000000002'), 'dono da segunda turma vê o baba das duas turmas');
select t_ok((public.baba_rev('b6000000-0000-0000-0000-000000000002') ->> 'rev') is not null, 'dono da segunda turma controla');
set request.uid = '00000000-0000-0000-0000-0000000006a1';
select t_ok((select count(*) = 1 from jsonb_array_elements(public.babas_shared()) x where x ->> 'id' = 'b6000000-0000-0000-0000-000000000002'), 'dono da primeira turma também');

-- Finalização: a primeira vale; a segunda (simultânea ou depois) não duplica nada.
set request.uid = '00000000-0000-0000-0000-0000000006a3';
select t_ok((public.baba_finish('b6000000-0000-0000-0000-000000000001', '{"venue":"","games":[]}', array['f6000000-0000-0000-0000-000000000001']::uuid[], 'Quinta FC', current_date, 3, null,
  '[{"name":"Zeca","goals":2,"assists":1},{"name":"Visitante","goals":1}]') ->> 'ok')::boolean, 'adm finaliza o baba');
select t_ok((select finished and finished_by = '00000000-0000-0000-0000-0000000006a3' and matches = 3 from public.babas where id = 'b6000000-0000-0000-0000-000000000001'), 'servidor grava quem finalizou');
select t_ok((select count(*) = 2 from public.baba_stats where baba_id = 'b6000000-0000-0000-0000-000000000001'), 'relatório com 2 linhas');
select t_ok((select turma_player_id = 'f6000000-0000-0000-0000-000000000101' from public.baba_stats where baba_id = 'b6000000-0000-0000-0000-000000000001' and name = 'Zeca'),
  'atleta sem id é ligado pelo nome dentro das turmas do baba');
set request.uid = '00000000-0000-0000-0000-0000000006a2';
select t_ok((public.baba_finish('b6000000-0000-0000-0000-000000000001', '{}', array['f6000000-0000-0000-0000-000000000001']::uuid[], 'Quinta FC', current_date, 9, null,
  '[{"name":"Zeca","goals":9}]') ->> 'finished_by_name') = 'Beto', 'segunda finalização devolve quem finalizou');
select t_ok((select count(*) = 2 and sum(goals) = 3 from public.baba_stats where baba_id = 'b6000000-0000-0000-0000-000000000001'), 'segunda finalização não regrava o relatório');
select t_ok((select matches = 3 from public.babas where id = 'b6000000-0000-0000-0000-000000000001'), 'segunda finalização não muda o baba');
select t_ok((public.baba_save('b6000000-0000-0000-0000-000000000001', '{"queue":[]}', array['f6000000-0000-0000-0000-000000000001']::uuid[], 'x', current_date, 0) ->> 'finished')::boolean,
  'gravação depois de finalizado não reabre e avisa');
select t_ok((public.baba_rev('b6000000-0000-0000-0000-000000000001') ->> 'finished_by_name') = 'Beto', 'outros aparelhos sabem quem finalizou');
select t_ok(not exists (select 1 from jsonb_array_elements(public.babas_shared()) x where x ->> 'id' = 'b6000000-0000-0000-0000-000000000001'), 'baba finalizado some dos cards');
-- App antigo (gravação direta na tabela) não reabre baba finalizado e sobe a versão do aberto.
reset request.uid;
update public.babas set finished = false where id = 'b6000000-0000-0000-0000-000000000001';
select t_ok((select finished from public.babas where id = 'b6000000-0000-0000-0000-000000000001'), 'gravação direta não reabre baba finalizado');
update public.babas set title = 'novo' where id = 'b6000000-0000-0000-0000-000000000002';
select t_ok((select rev = 2 from public.babas where id = 'b6000000-0000-0000-0000-000000000002'), 'gravação direta também sobe a versão');

-- Baba de dias anteriores continua aparecendo para fechar (pendente) e fecha pelo mesmo caminho.
set request.uid = '00000000-0000-0000-0000-0000000006a2';
select public.baba_save('b6000000-0000-0000-0000-000000000003', '{"firstKickoffAt":7,"matchHistory":[{"scoreA":1,"scoreB":1}]}', array['f6000000-0000-0000-0000-000000000001']::uuid[],
  'Quinta FC', current_date - 4, 1);
set request.uid = '00000000-0000-0000-0000-0000000006a1';
select t_ok((select (x ->> 'played_on')::date = current_date - 4 from jsonb_array_elements(public.babas_shared()) x where x ->> 'id' = 'b6000000-0000-0000-0000-000000000003'), 'baba pendente aparece com a data dele');
select t_ok((public.baba_finish('b6000000-0000-0000-0000-000000000003', null, array['f6000000-0000-0000-0000-000000000001']::uuid[], 'Quinta FC', current_date - 4, 1) ->> 'ok')::boolean,
  'dono fecha o baba pendente');
select t_ok((select finished and played_on = current_date - 4 and state ->> 'firstKickoffAt' = '7' from public.babas where id = 'b6000000-0000-0000-0000-000000000003'), 'fechar mantém a data e o estado');
reset request.uid;
