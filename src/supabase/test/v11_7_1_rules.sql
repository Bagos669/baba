-- Rule tests for v11.7.1 (correção manual dos números do atleta = lance "adjust"). Roda depois do v11_7_1_ajuste_stats.sql,
-- na cadeia do v11_6_rules (turma Quinta FC: Dono 6a1, Ana 6a2 e Beto 6a3 adms, Mel 6a4 membro). Procure por "FAIL".
\set QUIET on
reset role;
reset request.uid;
create or replace function public.q71(path text) returns text language sql as $$
  select (select state from public.babas where id = 'b7100000-0000-0000-0000-000000000001') #>> string_to_array(path, ',');
$$;
create or replace function public.q71lance(who text, l jsonb) returns jsonb language plpgsql as $$
begin
  perform set_config('request.uid', who, false);
  return public.baba_lance('b7100000-0000-0000-0000-000000000001', l);
end;
$$;
create temp table st71 as select jsonb_build_object(
  'firstKickoffAt', 1, 'selectedTeams', jsonb_build_array('f6000000-0000-0000-0000-000000000001'),
  'players', jsonb_build_array(
    jsonb_build_object('id', 1, 'name', 'Zeca', 'present', true, 'goals', 0, 'assists', 0, 'saves', 0, 'matches', 0, 'wins', 0),
    jsonb_build_object('id', 2, 'name', 'Mel', 'present', true, 'goals', 0, 'assists', 0, 'saves', 0, 'matches', 0, 'wins', 0)),
  'court', jsonb_build_object('A', jsonb_build_object('label', '1', 'ids', jsonb_build_array(1)), 'B', jsonb_build_object('label', '2', 'ids', jsonb_build_array(2))),
  'queue', '[]'::jsonb, 'matchHistory', '[]'::jsonb, 'settings', jsonb_build_object('maxStreak', 0),
  'match', jsonb_build_object('scoreA', 0, 'scoreB', 0, 'events', '[]'::jsonb, 'isRunning', true, 'secondsLeft', 400, 'addedSeconds', 0, 'initialSeconds', 420)) as s;
grant all on st71 to public;

-- Ana (adm) começa o baba e vira a anotadora; marca um gol do Zeca.
set request.uid = '00000000-0000-0000-0000-0000000006a2';
select public.baba_save('b7100000-0000-0000-0000-000000000001', (select s from st71), array['f6000000-0000-0000-0000-000000000001']::uuid[], 'Quinta FC', current_date, 0, null, null, 0);
select public.q71lance('00000000-0000-0000-0000-0000000006a2', '{"lid":"c7100000-0000-0000-0000-000000000001","kind":"goal","match_no":1,"side":"A","scorerId":1}');
select t_ok(public.q71('players,0,goals') = '1' and public.q71('match,scoreA') = '1', 'gol do Zeca contou');

-- Correção manual pela anotadora: valores finais, sem mexer no placar nem na lista de lances.
select t_ok((public.q71lance('00000000-0000-0000-0000-0000000006a2',
  '{"lid":"c7100000-0000-0000-0000-000000000002","kind":"adjust","match_no":1,"playerId":1,"goals":3,"assists":2,"saves":1}') ->> 'ok')::boolean, 'anotadora corrige os números');
select t_ok(public.q71('players,0,goals') = '3' and public.q71('players,0,assists') = '2' and public.q71('players,0,saves') = '1', 'números corrigidos no servidor');
select t_ok(public.q71('match,scoreA') = '1' and jsonb_array_length((public.q71('match,events'))::jsonb) = 1, 'placar e lances da partida não mudam');
select t_ok((select lance_seq = 2 from public.babas where id = 'b7100000-0000-0000-0000-000000000001'), 'correção conta como lance (sequência sobe)');
select t_ok((select kind = 'adjust' from public.baba_lances where id = 'c7100000-0000-0000-0000-000000000002'), 'correção fica registrada');
select t_ok((public.q71lance('00000000-0000-0000-0000-0000000006a2',
  '{"lid":"c7100000-0000-0000-0000-000000000002","kind":"adjust","playerId":1,"goals":9}') ->> 'dup')::boolean and public.q71('players,0,goals') = '3', 'mesma correção de novo não conta duas vezes');

-- Outro adm (não anotador) também corrige; membro comum não.
select t_ok((public.q71lance('00000000-0000-0000-0000-0000000006a3',
  '{"lid":"c7100000-0000-0000-0000-000000000003","kind":"adjust","match_no":7,"playerId":2,"goals":2}') ->> 'ok')::boolean
  and public.q71('players,1,goals') = '2' and public.q71('players,1,assists') = '0', 'adm corrige (partida não importa; campo ausente fica como está)');
select t_ok((select scorer_id = '00000000-0000-0000-0000-0000000006a2' from public.babas where id = 'b7100000-0000-0000-0000-000000000001'), 'corrigir não muda quem anota');
select t_err($$select public.q71lance('00000000-0000-0000-0000-0000000006a4', '{"lid":"c7100000-0000-0000-0000-000000000004","kind":"adjust","playerId":2,"goals":5}')$$,
  'not_scorer', 'membro comum não corrige');
select t_err($$select public.q71lance('00000000-0000-0000-0000-0000000006a2', '{"lid":"c7100000-0000-0000-0000-000000000005","kind":"adjust","playerId":77,"goals":5}')$$,
  'no_player', 'atleta que não está no baba');
select public.q71lance('00000000-0000-0000-0000-0000000006a2', '{"lid":"c7100000-0000-0000-0000-000000000006","kind":"adjust","playerId":2,"goals":150,"saves":-4}');
select t_ok(public.q71('players,1,goals') = '99' and public.q71('players,1,saves') = '0', 'valores ficam entre 0 e 99');

-- A gravação seguinte do celular (com números antigos) não desfaz a correção.
set request.uid = '00000000-0000-0000-0000-0000000006a2';
select public.baba_save('b7100000-0000-0000-0000-000000000001', (select s from st71), array['f6000000-0000-0000-0000-000000000001']::uuid[], 'Quinta FC', current_date,
  (select rev from public.babas where id = 'b7100000-0000-0000-0000-000000000001')::integer, null, null, (select lance_seq from public.babas where id = 'b7100000-0000-0000-0000-000000000001'));
select t_ok(public.q71('players,0,goals') = '3' and public.q71('players,1,goals') = '99', 'gravação do celular não desfaz a correção');

-- Desfazer continua desfazendo o último lance da partida (o gol), não a correção.
select t_ok((public.q71lance('00000000-0000-0000-0000-0000000006a2',
  '{"lid":"c7100000-0000-0000-0000-000000000007","kind":"undo","match_no":1,"target":"c7100000-0000-0000-0000-000000000001"}') ->> 'ok')::boolean
  and public.q71('players,0,goals') = '2' and public.q71('match,scoreA') = '0', 'desfazer tira o gol, a correção fica');
reset request.uid;
select 1 as v11_7_1_rules_done;
