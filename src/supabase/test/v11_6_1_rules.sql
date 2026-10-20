-- Rule tests for v11.6.1 (anotador único e mesário). Roda depois do v11_6_1_anotador_mesario.sql, na mesma cadeia do v11_6_rules
-- (usa a turma Quinta FC e as pessoas criadas lá: Dono 6a1, Ana 6a2 e Beto 6a3 adms, Mel 6a4 membro, Fora 6a5). Procure por "FAIL".
\set QUIET on
reset role;
reset request.uid;
insert into public.turma_players (id, turma_id, name, user_id) values
  ('f6000000-0000-0000-0000-000000000102', 'f6000000-0000-0000-0000-000000000001', 'Mel', '00000000-0000-0000-0000-0000000006a4'),
  ('f6000000-0000-0000-0000-000000000103', 'f6000000-0000-0000-0000-000000000001', 'Beto', '00000000-0000-0000-0000-0000000006a3'),
  ('f6000000-0000-0000-0000-000000000104', 'f6000000-0000-0000-0000-000000000001', 'Ze Visitante', null);
insert into public.live_games (id, code, owner, turma_ids, title) values
  ('16000000-0000-0000-0000-000000000001', 'LIVE6161', '00000000-0000-0000-0000-0000000006a2', array['f6000000-0000-0000-0000-000000000001']::uuid[], 'Quinta');

create or replace function public.q61(path text) returns text language sql as $$
  select (select state from public.babas where id = 'b6100000-0000-0000-0000-000000000001') #>> string_to_array(path, ',');
$$;
create or replace function public.q61lance(who text, l jsonb) returns jsonb language plpgsql as $$
begin
  perform set_config('request.uid', who, false);
  return public.baba_lance('b6100000-0000-0000-0000-000000000001', l);
end;
$$;
-- Estado: Zeca(1) e Mel(2) no time A, Beto(3) e Visitante(4) no B; Mel e Beto presentes com conta, o Visitante sem conta.
create temp table st61 as select jsonb_build_object(
  'firstKickoffAt', 1, 'selectedTeams', jsonb_build_array('f6000000-0000-0000-0000-000000000001'),
  'players', jsonb_build_array(
    jsonb_build_object('id', 1, 'name', 'Zeca', 'turmaId', 'f6000000-0000-0000-0000-000000000001', 'present', true, 'goals', 0, 'assists', 0, 'saves', 0, 'matches', 0, 'wins', 0),
    jsonb_build_object('id', 2, 'name', 'Mel', 'turmaId', 'f6000000-0000-0000-0000-000000000001', 'present', true, 'goals', 0, 'assists', 0, 'saves', 0, 'matches', 0, 'wins', 0),
    jsonb_build_object('id', 3, 'name', 'Beto', 'turmaId', 'f6000000-0000-0000-0000-000000000001', 'present', true, 'goals', 0, 'assists', 0, 'saves', 0, 'matches', 0, 'wins', 0),
    jsonb_build_object('id', 4, 'name', 'Ze Visitante', 'turmaId', 'f6000000-0000-0000-0000-000000000001', 'present', true, 'goals', 0, 'assists', 0, 'saves', 0, 'matches', 0, 'wins', 0)),
  'court', jsonb_build_object('A', jsonb_build_object('label', '1', 'ids', jsonb_build_array(1, 2)), 'B', jsonb_build_object('label', '2', 'ids', jsonb_build_array(3, 4))),
  'queue', '[]'::jsonb, 'matchHistory', '[]'::jsonb, 'settings', jsonb_build_object('maxStreak', 0),
  'match', jsonb_build_object('scoreA', 0, 'scoreB', 0, 'events', '[]'::jsonb, 'isRunning', true, 'endAt', 1000000, 'secondsLeft', 400, 'addedSeconds', 0, 'initialSeconds', 420),
  'live', jsonb_build_object('id', '16000000-0000-0000-0000-000000000001', 'code', 'LIVE6161', 'owner', '00000000-0000-0000-0000-0000000006a2')) as s;
grant all on st61 to public;

-- Ana dá o primeiro apito: vira a anotadora.
set request.uid = '00000000-0000-0000-0000-0000000006a2';
select public.baba_save('b6100000-0000-0000-0000-000000000001', (select s from st61), array['f6000000-0000-0000-0000-000000000001']::uuid[], 'Quinta FC', current_date, 0, null, null, 0);
select t_ok((select scorer_id = '00000000-0000-0000-0000-0000000006a2' and scorers = array['00000000-0000-0000-0000-0000000006a2']::uuid[]
  from public.babas where id = 'b6100000-0000-0000-0000-000000000001'), 'quem iniciou é o anotador');
set request.uid = '00000000-0000-0000-0000-0000000006a3';
select t_ok((public.baba_rev('b6100000-0000-0000-0000-000000000001') ->> 'scorer_name') = 'Ana' and (public.baba_rev('b6100000-0000-0000-0000-000000000001') ->> 'my_role') = 'org',
  'outro adm vê "Anotador: Ana" e é organizador');

-- Lances da anotadora
select t_ok((public.q61lance('00000000-0000-0000-0000-0000000006a2', '{"lid":"a6100000-0000-0000-0000-000000000001","kind":"goal","match_no":1,"side":"A","scorerId":1,"assistId":2,"el":30,"time":"06:30","text":"Gol"}') ->> 'lance_seq')::integer = 1,
  'anotadora registra gol');
select t_ok(public.q61('match,scoreA') = '1' and public.q61('players,0,goals') = '1' and public.q61('players,1,assists') = '1'
  and public.q61('match,events,0,lid') = 'a6100000-0000-0000-0000-000000000001', 'gol muda placar, gols, passes e entra nos lances');
select t_ok((public.q61lance('00000000-0000-0000-0000-0000000006a2', '{"lid":"a6100000-0000-0000-0000-000000000001","kind":"goal","match_no":1,"side":"A","scorerId":1}') ->> 'dup')::boolean
  and public.q61('match,scoreA') = '1', 'o mesmo lance de novo não conta duas vezes');
select t_ok((select created_by = '00000000-0000-0000-0000-0000000006a2' from public.baba_lances where id = 'a6100000-0000-0000-0000-000000000001'), 'cada lance grava quem registrou');
select public.q61lance('00000000-0000-0000-0000-0000000006a2', '{"lid":"a6100000-0000-0000-0000-000000000002","kind":"save","match_no":1,"side":"B","keeperId":4,"el":40,"time":"06:20","text":"Defesa"}');
select t_ok(public.q61('players,3,saves') = '1', 'defesa soma para o goleiro');
select public.q61lance('00000000-0000-0000-0000-0000000006a2', '{"lid":"a6100000-0000-0000-0000-000000000003","kind":"extra","match_no":1,"seconds":60,"time":"06:00","text":"+1"}');
select t_ok(public.q61('match,addedSeconds') = '60' and public.q61('match,secondsLeft') = '460' and public.q61('match,endAt')::numeric = 1060000, 'acréscimo ajusta o relógio');
select t_err($$select public.q61lance('00000000-0000-0000-0000-0000000006a2', '{"lid":"a6100000-0000-0000-0000-000000000009","kind":"undo","match_no":1,"target":"a6100000-0000-0000-0000-000000000002"}')$$,
  'not_last', 'desfazer só o último lance');
select public.q61lance('00000000-0000-0000-0000-0000000006a2', '{"lid":"a6100000-0000-0000-0000-000000000004","kind":"undo","match_no":1,"target":"a6100000-0000-0000-0000-000000000003"}');
select public.q61lance('00000000-0000-0000-0000-0000000006a2', '{"lid":"a6100000-0000-0000-0000-000000000005","kind":"undo","match_no":1,"target":"a6100000-0000-0000-0000-000000000002"}');
select t_ok(public.q61('match,addedSeconds') = '0' and public.q61('players,3,saves') = '0' and jsonb_array_length((select state -> 'match' -> 'events' from public.babas where id = 'b6100000-0000-0000-0000-000000000001')) = 1,
  'desfazer volta o acréscimo e a defesa');
select t_err($$select public.q61lance('00000000-0000-0000-0000-0000000006a2', '{"lid":"a6100000-0000-0000-0000-000000000008","kind":"goal","match_no":2,"side":"A","scorerId":1}')$$,
  'stale_match', 'lance de outra partida é recusado');

-- Outro adm (não anotador) e o membro: lances recusados, inclusive chamando o servidor direto.
select t_err($$select public.q61lance('00000000-0000-0000-0000-0000000006a3', '{"lid":"b6100000-0000-0000-0000-0000000000a1","kind":"goal","match_no":1,"side":"B","scorerId":3}')$$,
  'not_scorer', 'adm que não é o anotador não grava lance');
select t_err($$select public.q61lance('00000000-0000-0000-0000-0000000006a4', '{"lid":"b6100000-0000-0000-0000-0000000000a2","kind":"goal","match_no":1,"side":"B","scorerId":3}')$$,
  'not_scorer', 'membro não grava lance');
set request.uid = '00000000-0000-0000-0000-0000000006a3';
select t_ok((public.baba_save('b6100000-0000-0000-0000-000000000001', jsonb_set(jsonb_set((select state from public.babas where id = 'b6100000-0000-0000-0000-000000000001'),
  '{match,scoreB}', '5'), '{queue}', '[9]'), array['f6000000-0000-0000-0000-000000000001']::uuid[], 'Quinta FC', current_date, 0, null, null, 3) ->> 'merged')::boolean,
  'adm grava a fila mas o placar mandado por ele é ignorado');
select t_ok(public.q61('match,scoreB') = '0' and public.q61('queue,0') = '9', 'placar fica o do servidor e a fila muda');
select t_ok((select count(*) = 0 from public.baba_lances where created_by = '00000000-0000-0000-0000-0000000006a3'), 'nenhum lance do adm');
-- App antigo do adm (gravação direta na tabela) também não muda lances.
update public.babas set state = jsonb_set(state, '{match,scoreB}', '7') where id = 'b6100000-0000-0000-0000-000000000001';
select t_ok(public.q61('match,scoreB') = '0', 'gravação direta de quem não é o anotador não muda o placar');
-- Gravação velha (sem ter visto um lance) na mesma partida: aceita, sem perder o gol.
select public.q61lance('00000000-0000-0000-0000-0000000006a2', '{"lid":"a6100000-0000-0000-0000-000000000006","kind":"goal","match_no":1,"side":"B","scorerId":3,"el":50,"time":"05:00","text":"Gol"}');
set request.uid = '00000000-0000-0000-0000-0000000006a3';
select public.baba_save('b6100000-0000-0000-0000-000000000001', jsonb_set((select s from st61), '{queue}', '[8]'), array['f6000000-0000-0000-0000-000000000001']::uuid[], 'Quinta FC', current_date, 0, null, null, 3);
select t_ok(public.q61('match,scoreA') = '1' and public.q61('match,scoreB') = '1' and public.q61('players,2,goals') = '1' and public.q61('queue,0') = '8',
  'gravação do adm que não viu o último gol não apaga o gol');
-- Encerrar a partida sem ter visto todos os lances: recusado.
select t_err($$select public.baba_save('b6100000-0000-0000-0000-000000000001', jsonb_set(jsonb_set((select s from st61), '{matchHistory}', '[{"scoreA":1,"scoreB":0}]'), '{match,events}', '[]'),
  array['f6000000-0000-0000-0000-000000000001']::uuid[], 'Quinta FC', current_date, 1, null, null, 3)$$, 'stale_lances', 'encerrar sem ver o último lance é recusado');

-- Assumir anotação: Beto vira anotador, Ana fica só olhando; a transmissão passa para o Beto.
select t_err($$select public.q61lance('00000000-0000-0000-0000-0000000006a4', '{"lid":"b6100000-0000-0000-0000-0000000000a3","kind":"undo","match_no":1}')$$, 'not_scorer', 'membro não desfaz');
set request.uid = '00000000-0000-0000-0000-0000000006a4';
select t_err($$select public.baba_take_scoring('b6100000-0000-0000-0000-000000000001')$$, 'forbidden', 'membro não assume a anotação');
set request.uid = '00000000-0000-0000-0000-0000000006a3';
select public.baba_take_scoring('b6100000-0000-0000-0000-000000000001');
select t_ok((select scorer_id = '00000000-0000-0000-0000-0000000006a3' from public.babas where id = 'b6100000-0000-0000-0000-000000000001'), 'adm assume a anotação na hora');
select t_ok((select owner = '00000000-0000-0000-0000-0000000006a3' from public.live_games where id = '16000000-0000-0000-0000-000000000001')
  and public.q61('live,owner') = '00000000-0000-0000-0000-0000000006a3', 'a transmissão (mesmo código) segue o novo anotador');
select t_err($$select public.q61lance('00000000-0000-0000-0000-0000000006a2', '{"lid":"a6100000-0000-0000-0000-000000000007","kind":"goal","match_no":1,"side":"A","scorerId":1}')$$,
  'not_scorer', 'lance da anotadora anterior que chega depois é recusado');
select t_ok(public.q61('match,scoreA') = '1', 'e não muda o placar');
select public.q61lance('00000000-0000-0000-0000-0000000006a3', '{"lid":"b6100000-0000-0000-0000-0000000000b1","kind":"goal","match_no":1,"side":"A","scorerId":1,"el":60,"time":"04:00","text":"Gol"}');
select t_ok(public.q61('match,scoreA') = '2', 'novo anotador registra');

-- Passar a vez: só presente com conta; convidado sem conta não pode.
set request.uid = '00000000-0000-0000-0000-0000000006a2';
select t_err($$select public.baba_set_mesario('b6100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006a5')$$, 'not_present', 'quem não está presente não vira mesário');
select public.baba_set_mesario('b6100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006a4');
select t_ok((select scorer_id = '00000000-0000-0000-0000-0000000006a4' and mesario_id = '00000000-0000-0000-0000-0000000006a4' from public.babas where id = 'b6100000-0000-0000-0000-000000000001'),
  'Mel (presente, com conta) vira mesária e anotadora');
set request.uid = '00000000-0000-0000-0000-0000000006a4';
select t_ok((public.baba_rev('b6100000-0000-0000-0000-000000000001') ->> 'my_role') = 'mesario', 'Mel vê o papel de mesária');
select t_ok((select count(*) = 1 from jsonb_array_elements(public.babas_shared()) x where x ->> 'id' = 'b6100000-0000-0000-0000-000000000001' and x ->> 'my_role' = 'mesario'),
  'o baba aparece para a mesária (marcado como mesário)');
select public.q61lance('00000000-0000-0000-0000-0000000006a4', '{"lid":"c6100000-0000-0000-0000-000000000001","kind":"goal","match_no":1,"side":"B","scorerId":3,"assistId":4,"el":70,"time":"03:00","text":"Gol"}');
select public.q61lance('00000000-0000-0000-0000-0000000006a4', '{"lid":"c6100000-0000-0000-0000-000000000002","kind":"save","match_no":1,"side":"A","keeperId":2,"el":80,"time":"02:50","text":"Defesa"}');
select t_ok(public.q61('match,scoreB') = '2' and public.q61('players,3,assists') = '1' and public.q61('players,1,saves') = '1', 'mesária registra gol, passe e defesa');
select public.q61lance('00000000-0000-0000-0000-0000000006a4', '{"lid":"c6100000-0000-0000-0000-000000000003","kind":"undo","match_no":1,"target":"c6100000-0000-0000-0000-000000000002"}');
select t_ok(public.q61('players,1,saves') = '0', 'mesária desfaz o último lance');
-- Mesária: mexer na fila, nos presentes e nas configurações é ignorado; o cronômetro vale.
select t_ok((public.baba_save('b6100000-0000-0000-0000-000000000001',
  jsonb_set(jsonb_set(jsonb_set(jsonb_set((select state from public.babas where id = 'b6100000-0000-0000-0000-000000000001'), '{queue}', '[1,2,3]'), '{settings,maxStreak}', '9'),
    '{match,isRunning}', 'false'), '{players,0,present}', 'false'),
  '{}'::uuid[], 'x', current_date, 0, null, null, (select lance_seq from public.babas where id = 'b6100000-0000-0000-0000-000000000001')) ->> 'merged')::boolean, 'mesária grava: o que não pode é ignorado');
select t_ok(public.q61('queue,0') = '8' and public.q61('settings,maxStreak') = '0' and public.q61('players,0,present') = 'true' and public.q61('match,isRunning') = 'false',
  'fila, configuração e presença ficam; o cronômetro pausa');
select t_ok((select turma_ids = array['f6000000-0000-0000-0000-000000000001']::uuid[] and title = 'Quinta FC' from public.babas where id = 'b6100000-0000-0000-0000-000000000001'), 'mesária não muda turma nem título');
-- Mesária encerra a partida (fila anda como o celular calculou).
select t_ok((public.baba_save('b6100000-0000-0000-0000-000000000001',
  jsonb_set(jsonb_set(jsonb_set(jsonb_set((select state from public.babas where id = 'b6100000-0000-0000-0000-000000000001'),
    '{matchHistory}', '[{"scoreA":2,"scoreB":2,"labelA":"1","labelB":"2"}]'), '{match,events}', '[]'), '{queue}', '[3,4]'), '{players,0,matches}', '1'),
  '{}'::uuid[], 'x', current_date, 1, null, null, (select lance_seq from public.babas where id = 'b6100000-0000-0000-0000-000000000001')) ->> 'rev') is not null, 'mesária encerra a partida');
select t_ok(public.q61('matchHistory,0,scoreA') = '2' and public.q61('queue,0') = '3' and public.q61('players,0,matches') = '1' and public.q61('match,scoreA') = '0'
  and public.q61('players,0,goals') = '2', 'fila anda, partida nova começa zerada e os gols ficam');
select t_err($$select public.baba_finish('b6100000-0000-0000-0000-000000000001', '{}', '{}'::uuid[], 'x', current_date, 1)$$, 'forbidden', 'mesária não finaliza o baba');
select t_err($$select public.baba_take_scoring('b6100000-0000-0000-0000-000000000001')$$, 'forbidden', 'mesária não assume (já é) nem escolhe outro');
select t_err($$select public.baba_set_mesario('b6100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006a3')$$, 'forbidden', 'mesária não escolhe outro mesário');

-- Palpites: quem anotou (inclusive a mesária) aparece marcado no extrato do adm.
select t_ok((select '00000000-0000-0000-0000-0000000006a4'::uuid = any (scorers) and '00000000-0000-0000-0000-0000000006a3'::uuid = any (scorers)
  from public.babas where id = 'b6100000-0000-0000-0000-000000000001'), 'todos que anotaram ficam guardados');

-- Ana assume de volta: a mesária deixa de ser mesária, mas ainda vê o baba (só visualização) e não grava nada.
set request.uid = '00000000-0000-0000-0000-0000000006a2';
select public.baba_take_scoring('b6100000-0000-0000-0000-000000000001');
set request.uid = '00000000-0000-0000-0000-0000000006a4';
select t_ok((public.baba_rev('b6100000-0000-0000-0000-000000000001') ->> 'my_role') = 'viewer', 'ex-mesária só olha');
select t_err($$select public.baba_save('b6100000-0000-0000-0000-000000000001', '{"queue":[]}', '{}'::uuid[], 'x', current_date, 0)$$, 'forbidden', 'ex-mesária não grava');
-- Mesário deixa de existir quando o baba é finalizado.
set request.uid = '00000000-0000-0000-0000-0000000006a2';
select public.baba_set_mesario('b6100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000006a4');
select public.baba_finish('b6100000-0000-0000-0000-000000000001', '{"games":[]}', array['f6000000-0000-0000-0000-000000000001']::uuid[], 'Quinta FC', current_date, 1, null, '[]');
select t_ok((select finished and mesario_id is null from public.babas where id = 'b6100000-0000-0000-0000-000000000001'), 'finalizar o baba acaba com o mesário');
select t_err($$select public.q61lance('00000000-0000-0000-0000-0000000006a4', '{"lid":"c6100000-0000-0000-0000-000000000009","kind":"goal","match_no":2,"side":"A","scorerId":1}')$$,
  'finished', 'sem lances depois de finalizado');
reset request.uid;
