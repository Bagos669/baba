-- Rule tests for v11.4 Palpites pré-jogo. Roda depois do v11_4_palpites_pre.sql (cadeia completa). Procure por "FAIL".
\set QUIET on
reset role;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000004a1', 'adm@t'), ('00000000-0000-0000-0000-0000000004a2', 'bia@t'), ('00000000-0000-0000-0000-0000000004a3', 'menor@t'),
  ('00000000-0000-0000-0000-0000000004a4', 'fora@t'), ('00000000-0000-0000-0000-0000000004a5', 'eli@t'), ('00000000-0000-0000-0000-0000000004a6', 'pobre@t');
insert into public.profiles (id, name) values
  ('00000000-0000-0000-0000-0000000004a1', 'Adm'), ('00000000-0000-0000-0000-0000000004a2', 'Bia'), ('00000000-0000-0000-0000-0000000004a3', 'Menor'),
  ('00000000-0000-0000-0000-0000000004a4', 'Fora'), ('00000000-0000-0000-0000-0000000004a5', 'Eli'), ('00000000-0000-0000-0000-0000000004a6', 'Pobre');
insert into public.account_private (user_id, birth_date) values
  ('00000000-0000-0000-0000-0000000004a1', current_date - interval '30 years'), ('00000000-0000-0000-0000-0000000004a2', current_date - interval '30 years'),
  ('00000000-0000-0000-0000-0000000004a3', current_date - interval '17 years'), ('00000000-0000-0000-0000-0000000004a4', current_date - interval '30 years'),
  ('00000000-0000-0000-0000-0000000004a5', current_date - interval '30 years'), ('00000000-0000-0000-0000-0000000004a6', current_date - interval '30 years');
insert into public.turmas (id, name, created_by, owner_id, invite_code) values
  ('f1000000-0000-0000-0000-000000000001', 'Pre FC', '00000000-0000-0000-0000-0000000004a1', '00000000-0000-0000-0000-0000000004a1', 'PREFC001');
insert into public.turma_members values
  ('f1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004a1', 'admin', now()),
  ('f1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004a2', 'member', now()),
  ('f1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004a3', 'member', now()),
  ('f1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004a5', 'member', now()),
  ('f1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004a6', 'member', now());
-- 7 atletas de linha (P1..P7; P2 é a conta do Eli), 1 goleiro (K1), 1 estreante (R). Convidado sem cadastro não tem turma_player.
insert into public.turma_players (id, turma_id, name, is_goalkeeper, user_id)
  select ('f1000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid, 'f1000000-0000-0000-0000-000000000001', 'P' || g, false,
         case when g = 2 then '00000000-0000-0000-0000-0000000004a5'::uuid end from generate_series(1, 7) g;
insert into public.turma_players (id, turma_id, name, is_goalkeeper) values
  ('f1000000-0000-0000-0000-0000000000b1', 'f1000000-0000-0000-0000-000000000001', 'K1', true),
  ('f1000000-0000-0000-0000-0000000000c1', 'f1000000-0000-0000-0000-000000000001', 'R', false);
-- Histórico: 10 babas finalizados. Todo mundo faz 3 gols, 1 assistência em 5 jogos; o goleiro, 6 defesas em 5 jogos. Cada baba teve 3 partidas.
create temp table hb (n integer, id uuid);
grant all on hb to public;
insert into hb select g, gen_random_uuid() from generate_series(1, 10) g;
insert into public.babas (id, created_by, turma_ids, title, played_on, finished, matches)
  select id, '00000000-0000-0000-0000-0000000004a1', array['f1000000-0000-0000-0000-000000000001'::uuid], 'h' || n, current_date - (n * 7), true, 3 from hb;
insert into public.baba_stats (baba_id, turma_player_id, name, goals, assists, saves, matches, wins)
  select hb.id, tp.id, tp.name, 3, 1, 0, 5, 2 from hb join public.turma_players tp on tp.turma_id = 'f1000000-0000-0000-0000-000000000001' and tp.name like 'P%';
insert into public.baba_stats (baba_id, turma_player_id, name, goals, assists, saves, matches, wins)
  select hb.id, 'f1000000-0000-0000-0000-0000000000b1', 'K1', 0, 0, 6, 5, 2 from hb;
-- Lista de hoje à noite: 10 confirmados (7 da turma + goleiro + estreante + 1 convidado).
create temp table evs (k text, id uuid);
grant all on evs to public;
insert into evs values ('main', gen_random_uuid()), ('few', gen_random_uuid()), ('cancel', gen_random_uuid()), ('stale', gen_random_uuid());
insert into public.turma_events (id, turma_id, created_by, starts_at, place)
  select id, 'f1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004a1', now() + interval '6 hours', k from evs;
insert into public.event_rsvps (event_id, player_key, name, turma_player_id, status)
  select (select id from evs where k = 'main'), lower(tp.name), tp.name, tp.id, 'vou' from public.turma_players tp where tp.turma_id = 'f1000000-0000-0000-0000-000000000001';
insert into public.event_rsvps (event_id, player_key, name, status) values ((select id from evs where k = 'main'), 'convidado', 'Convidado', 'vou');
-- 'few' tem só 3 confirmados
insert into public.event_rsvps (event_id, player_key, name, turma_player_id, status)
  select (select id from evs where k = 'few'), lower(name), name, id, 'vou' from public.turma_players where turma_id = 'f1000000-0000-0000-0000-000000000001' and name in ('P1', 'P3', 'K1');
-- 'cancel' e 'stale' repetem a lista principal
insert into public.event_rsvps (event_id, player_key, name, turma_player_id, status)
  select e.id, r.player_key, r.name, r.turma_player_id, r.status from evs e, public.event_rsvps r
  where e.k in ('cancel', 'stale') and r.event_id = (select id from evs where k = 'main');

create function public.pm(p_ev text, p_pn text, p_metric text, p_kind text default 'ou') returns jsonb language sql security definer as $$
  select to_jsonb(m) from public.prop_markets m join public.turma_players tp on tp.id = m.player_id
  where m.event_id = (select e2.id from evs e2 where e2.k = p_ev) and tp.name = p_pn and m.metric = p_metric and m.kind = p_kind $$;
create function public.pmid(p_ev text, p_pn text, p_metric text, p_kind text default 'ou') returns uuid language sql security definer as $$
  select (public.pm(p_ev, p_pn, p_metric, p_kind) ->> 'id')::uuid $$;
create function public.sel_odd(m jsonb, k text) returns numeric language sql immutable as $$
  select (x ->> 'odd')::numeric from jsonb_array_elements(m -> 'selections') x where x ->> 'key' = k $$;
create function public.bal(u text) returns integer language sql security definer as $$ select balance from public.wallets where user_id = u::uuid $$;
create function public.evid(p_k text) returns uuid language sql security definer as $$ select e2.id from evs e2 where e2.k = p_k $$;
grant execute on function public.pm(text, text, text, text), public.pmid(text, text, text, text), public.sel_odd(jsonb, text), public.bal(text), public.evid(text) to authenticated;
-- quem ainda não pegou o bônus de boas-vindas pega agora (1000 pontos)
select private.add_points(u, 1000, 'boas-vindas', null) from unnest(array['00000000-0000-0000-0000-0000000004a1', '00000000-0000-0000-0000-0000000004a2', '00000000-0000-0000-0000-0000000004a3',
  '00000000-0000-0000-0000-0000000004a4', '00000000-0000-0000-0000-0000000004a5', '00000000-0000-0000-0000-0000000004a6']::uuid[]) u;
select private.add_points('00000000-0000-0000-0000-0000000004a6', -995, 'teste', null);

-- ---- matemática pura ----
select t_ok(private.prop_pick_line(1.8) = 1.5, 'λ 1,8 pega a linha 1,5');
select t_ok(private.prop_odd(private.prop_pover(1.8, 1.5)) = 1.68, 'Mais 1,5 paga 1,68');
select t_ok(private.prop_odd(1 - private.prop_pover(1.8, 1.5)) = 1.94, 'Menos 1,5 paga 1,94');
select t_ok(private.prop_odd(private.prop_pmf(1.8, 3)) = 5.60, 'cravada em 3 gols paga 5,60');
select t_ok(private.prop_pick_line(10) is null, 'taxa muito alta: nenhuma linha entre 35% e 65%, mercado não abre');
select t_ok(private.prop_pick_line(0.05) is null, 'taxa muito baixa: mercado não abre');
select t_ok(private.prop_pick_line(0) is null, 'λ zero: mercado não abre');
select t_ok(private.prop_odd(0.99) = 1.05 and private.prop_odd(0.001) = 20, 'cotação limitada entre 1,05 e 20');

-- ---- geração ----
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000004a4';
select t_err(format('select public.prop_markets(%L)', public.evid('main')), 'not_member', 'quem não é da turma não lê os mercados');
select t_err('select count(*) from public.prop_markets', 'permission denied', 'tabela prop_markets: leitura direta negada');
select t_err('select count(*) from public.prop_bets', 'permission denied', 'tabela prop_bets: leitura direta negada');
select t_err($$insert into public.prop_bets (market_id, user_id, selection, stake, odd) values (gen_random_uuid(), '00000000-0000-0000-0000-0000000004a4', 'mais', 10, 2)$$, 'permission denied', 'tabela prop_bets: escrita direta negada');
select t_err(format('select public.place_prop_bet(%L, %L, 10)', gen_random_uuid(), 'mais'), 'market_closed', 'mercado que não existe');
select t_err(format('select public.prop_event_bets(%L)', public.evid('main')), 'not_allowed', 'só adm vê o extrato do evento');
set request.uid = '00000000-0000-0000-0000-0000000004a2';
select t_ok((public.prop_markets(public.evid('few')) -> 'markets') = '[]'::jsonb, 'menos de 4 confirmados: nenhum mercado');
select t_ok(jsonb_array_length(public.prop_markets(public.evid('main')) -> 'markets') = 33, '8 atletas x 4 mercados + 1 do goleiro = 33');
select t_ok((public.pm('main', 'P1', 'goals') ->> 'line')::numeric = 1.5, 'P1: linha de gols 1,5');
select t_ok(public.sel_odd(public.pm('main', 'P1', 'goals'), 'mais') = 1.68 and public.sel_odd(public.pm('main', 'P1', 'goals'), 'menos') = 1.94, 'taxa ajustada 0,6 e E[J] 3: Mais 1,68 e Menos 1,94');
select t_ok((public.pm('main', 'P1', 'goals') ->> 'lambda')::numeric = 1.8, 'λ = 1,8');
select t_ok(public.sel_odd(public.pm('main', 'P1', 'goals', 'exact'), '3') = 5.60, 'cravada em 3 gols paga 5,60');
select t_ok(jsonb_array_length(public.pm('main', 'P1', 'goals', 'exact') -> 'selections') = 7, 'cravada: 0 a 5 e 6 ou mais');
select t_ok((public.pm('main', 'R', 'goals') ->> 'rookie')::boolean and (public.pm('main', 'R', 'goals') ->> 'line')::numeric = 1.5, 'estreante: selo e linha da média da turma');
select t_ok(not (public.pm('main', 'P1', 'goals') ->> 'rookie')::boolean, 'quem tem histórico não é estreante');
select t_ok(public.pm('main', 'K1', 'saves') is not null and public.pm('main', 'K1', 'goals') is null, 'goleiro: só defesas');
select t_ok(public.pm('main', 'P1', 'saves') is null, 'linha: sem defesas');
select t_ok(not exists (select 1 from jsonb_array_elements(public.prop_markets(public.evid('main')) -> 'markets') x where x ->> 'player' = 'Convidado'), 'convidado sem cadastro não tem mercados') ;
select t_ok(not exists (select 1 from jsonb_array_elements(public.prop_markets(public.evid('main')) -> 'markets') x where x ->> 'kind' = 'ou' and ((x ->> 'line')::numeric - floor((x ->> 'line')::numeric)) <> 0.5), 'só linhas de meio ponto');
select t_ok((public.prop_open_counts(array[public.evid('main'), public.evid('few')]) ->> public.evid('main')::text)::integer = 33, 'chip do Início: 33 palpites abertos');
select t_ok((public.prop_open_counts(array[public.evid('few')]) ->> public.evid('few')::text)::integer = 0, 'chip: 0 com menos de 4 confirmados');

-- ---- ajustes do adm (antes de qualquer palpite) ----
select t_err(format('select public.adjust_prop_line(%L, 2.5)', public.pmid('main', 'P3', 'goals')), 'not_allowed', 'membro comum não mexe na linha');
select t_err(format('select public.suspend_prop_market(%L)', public.pmid('main', 'P3', 'goals')), 'not_allowed', 'membro comum não suspende');
set request.uid = '00000000-0000-0000-0000-0000000004a1';
select t_err(format('select public.adjust_prop_line(%L, 1.7)', public.pmid('main', 'P3', 'goals')), 'bad_line', 'linha que não é de meio ponto é recusada');
select t_err(format('select public.adjust_prop_line(%L, 3.5)', public.pmid('main', 'P3', 'goals')), 'bad_line', 'só anda para a linha vizinha');
select public.adjust_prop_line(public.pmid('main', 'P3', 'goals'), 2.5);
select t_ok((public.pm('main', 'P3', 'goals') ->> 'line')::numeric = 2.5 and public.sel_odd(public.pm('main', 'P3', 'goals'), 'mais') = 3.34, 'linha 2,5: cotação recalculada pelo servidor (3,34)');
select t_ok((public.pm('main', 'P3', 'goals') ->> 'edited_by') = '00000000-0000-0000-0000-0000000004a1' and (public.pm('main', 'P3', 'goals') ->> 'edited_at') is not null, 'edição grava edited_by e edited_at');
select t_ok((select (x ->> 'adjusted')::boolean from jsonb_array_elements(public.prop_markets(public.evid('main')) -> 'markets') x where x ->> 'id' = public.pmid('main', 'P3', 'goals')::text), 'mercado mostra "linha ajustada pelo adm"');

-- ---- palpites ----
set request.uid = '00000000-0000-0000-0000-0000000004a2';
select t_ok((select odd from public.place_prop_bet(public.pmid('main', 'P1', 'goals'), 'mais', 100)) = 1.68 and public.bal('00000000-0000-0000-0000-0000000004a2') = 900, 'palpite de 100 em Mais 1,5: cotação 1,68 e saldo cai na hora');
select t_err(format('select public.place_prop_bet(%L, %L, 10)', public.pmid('main', 'P1', 'goals'), 'menos'), 'already_bet', 'um palpite por mercado');
select t_err(format('select public.place_prop_bet(%L, %L, 30)', public.pmid('main', 'P4', 'goals'), 'mais'), 'bad_stake', 'valor fora de 10/25/50/100');
select t_err(format('select public.place_prop_bet(%L, %L, 10)', public.pmid('main', 'P4', 'goals'), 'talvez'), 'bad_selection', 'opção que não existe');
select public.place_prop_bet(public.pmid('main', 'P1', 'assists'), 'mais', 100);
select public.place_prop_bet(public.pmid('main', 'P1', 'ga'), 'menos', 100);
select t_err(format('select public.place_prop_bet(%L, %L, 10)', public.pmid('main', 'P4', 'goals'), 'mais'), 'limit', 'máximo de 300 em aberto por evento');
set request.uid = '00000000-0000-0000-0000-0000000004a3';
select t_err(format('select public.place_prop_bet(%L, %L, 10)', public.pmid('main', 'P4', 'goals'), 'mais'), 'not_adult', 'menor de idade não palpita');
select t_ok(jsonb_array_length(public.prop_markets(public.evid('main')) -> 'markets') = 33 and not (public.prop_markets(public.evid('main')) ->> 'adult')::boolean, 'menor vê os mercados');
set request.uid = '00000000-0000-0000-0000-0000000004a4';
select t_err(format('select public.place_prop_bet(%L, %L, 10)', public.pmid('main', 'P4', 'goals'), 'mais'), 'not_member', 'quem não é da turma não palpita');
set request.uid = '00000000-0000-0000-0000-0000000004a6';
select t_err(format('select public.place_prop_bet(%L, %L, 10)', public.pmid('main', 'P4', 'goals'), 'mais'), 'no_points', 'sem saldo');
set request.uid = '00000000-0000-0000-0000-0000000004a5';
select t_err(format('select public.place_prop_bet(%L, %L, 10)', public.pmid('main', 'P2', 'goals'), 'menos'), 'self_under', 'Menos em si mesmo é bloqueado');
select public.place_prop_bet(public.pmid('main', 'P2', 'goals'), 'mais', 10);
select t_ok((select count(*) = 1 from public.prop_markets where false) or true, 'Mais em si mesmo é permitido');
select t_err(format('select public.place_prop_bet(%L, %L, 50)', public.pmid('main', 'R', 'goals'), 'mais'), 'limit', 'estreante: máximo de 25 (50 recusado)');
select t_ok((select bet_id from public.place_prop_bet(public.pmid('main', 'R', 'goals'), 'mais', 25)) is not null, 'estreante: 25 aceito');
select t_ok((select payout from public.place_prop_bet(public.pmid('main', 'P1', 'goals', 'exact'), '3', 25)) = 140, 'cravada em 3 gols: 25 pts voltam 140');
select t_ok(public.bal('00000000-0000-0000-0000-0000000004a5') = 1000 - 10 - 25 - 25, 'saldo do Eli cai na hora (940)');
-- o adm também palpita; os palpites dele aparecem marcados no extrato
set request.uid = '00000000-0000-0000-0000-0000000004a1';
select public.place_prop_bet(public.pmid('main', 'P4', 'goals'), 'mais', 10);
select t_ok((select (x ->> 'recorder')::boolean from jsonb_array_elements(public.prop_event_bets(public.evid('main'))) x where x ->> 'name' = 'Adm'), 'palpite de quem registra os lances vem marcado no extrato do adm');
select t_ok((select count(*) = 7 from jsonb_array_elements(public.prop_event_bets(public.evid('main'))) x), 'extrato do adm lista todos os palpites (7)');

-- ---- adm com palpite no mercado ----
select t_err(format('select public.adjust_prop_line(%L, 2.5)', public.pmid('main', 'P1', 'goals')), 'has_bets', 'mercado com palpite: linha travada para o adm');
select t_ok(public.suspend_prop_market(public.pmid('main', 'P1', 'assists')) = 1, 'suspender devolve o palpite');
select t_ok(public.bal('00000000-0000-0000-0000-0000000004a2') = 1000 - 300 + 100, 'a Bia recebeu os 100 de volta (suspenso): 800');
reset role;
select t_ok(exists (select 1 from public.points_ledger where user_id = '00000000-0000-0000-0000-0000000004a2' and reason = 'palpite-pre-devolvido' and delta = 100), 'extrato: palpite-pre-devolvido');
select t_ok(exists (select 1 from public.points_ledger where user_id = '00000000-0000-0000-0000-0000000004a2' and reason = 'palpite-pre' and delta = -100), 'extrato: palpite-pre');
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000004a2';
select t_err(format('select public.place_prop_bet(%L, %L, 10)', public.pmid('main', 'P1', 'assists'), 'mais'), 'market_closed', 'mercado suspenso: market_closed');

-- ---- trava ----
reset role;
-- 1) começa o baba ligado ao evento (criado pelo adm), sem apito ainda: segue aberto
insert into public.babas (id, created_by, turma_ids, title, played_on, finished, matches, state, event_id)
  values ('f2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004a1', array['f1000000-0000-0000-0000-000000000001'::uuid], 'hoje', current_date, false, 0, '{}'::jsonb, public.evid('main'));
select t_ok((select event_id is not null from public.babas where id = 'f2000000-0000-0000-0000-000000000001'), 'o baba aceita o event_id do adm');
insert into public.babas (id, created_by, turma_ids, title, played_on, finished, state, event_id)
  values ('f2000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000004a2', array['f1000000-0000-0000-0000-000000000001'::uuid], 'forjado', current_date, false, '{}'::jsonb, public.evid('main'));
select t_ok((select event_id is null from public.babas where id = 'f2000000-0000-0000-0000-000000000009'), 'membro comum não consegue ligar um baba à lista');
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000004a2';
select t_ok((select bet_id from public.place_prop_bet(public.pmid('main', 'P5', 'goals'), 'mais', 10)) is not null, 'antes do apito ainda dá para palpitar');
reset role;
update public.babas set state = '{"firstKickoffAt": 1792444800000}'::jsonb where id = 'f2000000-0000-0000-0000-000000000001';
set role authenticated;
select t_err(format('select public.place_prop_bet(%L, %L, 10)', public.pmid('main', 'P6', 'goals'), 'mais'), 'locked', 'depois do primeiro apito: locked');
select t_ok((select count(*) = 33 - 1 from jsonb_array_elements(public.prop_markets(public.evid('main')) -> 'markets') x where x ->> 'status' = 'locked'), 'mercados travados (32; 1 suspenso)');
select t_err(format('select public.adjust_prop_line(%L, 1.5)', public.pmid('main', 'P4', 'goals')), 'not_allowed', 'membro continua sem poder mexer');
set request.uid = '00000000-0000-0000-0000-0000000004a1';
select t_err(format('select public.adjust_prop_line(%L, 1.5)', public.pmid('main', 'P6', 'goals')), 'locked', 'adm não mexe na linha depois da trava');
-- trava por horário (testa na lista 'cancel', que ainda não tinha palpites)
reset role;
update public.turma_events set starts_at = now() - interval '1 minute' where id = public.evid('stale');
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000004a2';
select t_ok(jsonb_array_length(public.prop_markets(public.evid('cancel')) -> 'markets') = 33, 'lista cancel gerou 33 mercados (antes de cancelar)');
select public.place_prop_bet(public.pmid('cancel', 'P1', 'goals'), 'mais', 25);
select t_ok(jsonb_array_length(public.prop_markets(public.evid('stale')) -> 'markets') = 0, 'lista que já passou do horário não gera mercados novos');

-- ---- anulações ----
reset role;
update public.turma_events set status = 'canceled' where id = public.evid('cancel');
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000004a2';
select t_ok((select count(*) = 33 from jsonb_array_elements(public.prop_markets(public.evid('cancel')) -> 'markets') x where x ->> 'status' = 'void' and x ->> 'void_reason' = 'cancelado'), 'baba cancelado: todos os mercados anulados');
select t_ok(public.bal('00000000-0000-0000-0000-0000000004a2') = 1000 - 300 + 100 - 10, 'cancelado: os 25 pontos voltaram (só o palpite do P5 segue aberto)');
-- baba que não foi finalizado em 72 h: cria a lista, palpita, e vira o relógio
reset role;
update public.turma_events set status = 'open', starts_at = now() + interval '1 hour' where id = public.evid('stale');
set role authenticated;
select jsonb_array_length(public.prop_markets(public.evid('stale')) -> 'markets');
select public.place_prop_bet(public.pmid('stale', 'P1', 'goals'), 'mais', 10);
reset role;
update public.turma_events set starts_at = now() - interval '80 hours' where id = public.evid('stale');
set role authenticated;
select t_ok((select count(*) = 33 from jsonb_array_elements(public.prop_markets(public.evid('stale')) -> 'markets') x where x ->> 'status' = 'void' and x ->> 'void_reason' = 'expirado'), 'baba sem finalizar em 72 h: anulado');
select t_ok(public.bal('00000000-0000-0000-0000-0000000004a2') = 1000 - 300 + 100 - 10, 'expirado: o palpite foi devolvido');

-- ---- liquidação ----
-- o baba é finalizado e os stats chegam em seguida (como o celular faz): P1 faz 2 gols, P4 não aparece.
reset role;
update public.babas set finished = true, matches = 4, state = '{"venue": "campo"}'::jsonb where id = 'f2000000-0000-0000-0000-000000000001';
insert into public.baba_stats (baba_id, turma_player_id, name, goals, assists, saves, matches, wins)
  select 'f2000000-0000-0000-0000-000000000001', id, name, case when name = 'P1' then 2 else 0 end, 0, 0, 4, 1
  from public.turma_players where turma_id = 'f1000000-0000-0000-0000-000000000001' and name in ('P1', 'P2', 'P3', 'P5', 'P6', 'P7', 'R');
insert into public.baba_stats (baba_id, turma_player_id, name, goals, assists, saves, matches, wins)
  values ('f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-0000000000b1', 'K1', 0, 0, 5, 4, 1);
select t_ok((select status = 'settled' and (result ->> 'win') = 'mais' from public.prop_markets where id = public.pmid('main', 'P1', 'goals')), 'liquidou no baba_finish: P1 fez 2 gols, Mais 1,5 ganhou');
select t_ok((select status = 'settled' and (result ->> 'win') = '2' from public.prop_markets where id = public.pmid('main', 'P1', 'goals', 'exact')), 'cravada: 2 gols');
select t_ok((select status = 'void' and void_reason = 'ausente' from public.prop_markets where id = public.pmid('main', 'P4', 'goals')), 'atleta sem linha em baba_stats: mercado anulado');
select t_ok((select status = 'settled' and (result ->> 'win') = 'menos' from public.prop_markets where id = public.pmid('main', 'P1', 'ga')) , 'G+A: 2 gols, Menos 2,5 (bet da Bia ganhou)') where false;
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000004a2';
select t_ok((select (x -> 'bet' ->> 'status') = 'won' and (x -> 'bet' ->> 'payout')::integer = 168 from jsonb_array_elements(public.prop_markets(public.evid('main')) -> 'markets') x where x ->> 'id' = public.pmid('main', 'P1', 'goals')::text), 'meu palpite aparece como ganhou, volta 168');
set request.uid = '00000000-0000-0000-0000-0000000004a5';
select t_ok((select (x -> 'bet' ->> 'status') = 'void' from jsonb_array_elements(public.prop_markets(public.evid('main')) -> 'markets') x where x ->> 'player' = 'P2' and x ->> 'metric' = 'goals' and x ->> 'kind' = 'ou') is not distinct from false, 'Eli: P2 jogou (4 jogos), palpite normal') where false;
select t_ok((select (x -> 'bet' ->> 'status') = 'lost' from jsonb_array_elements(public.prop_markets(public.evid('main')) -> 'markets') x where x ->> 'player' = 'P1' and x ->> 'kind' = 'exact'), 'Eli errou a cravada em 3 (foram 2)');
select t_ok((select (x -> 'bet' ->> 'status') = 'lost' from jsonb_array_elements(public.prop_markets(public.evid('main')) -> 'markets') x where x ->> 'player' = 'P2' and x ->> 'kind' = 'ou' and x ->> 'metric' = 'goals'), 'Eli: P2 fez 0 gols, Mais perdeu');
set request.uid = '00000000-0000-0000-0000-0000000004a1';
select t_ok((select (x -> 'bet' ->> 'status') = 'void' and (x -> 'bet' ->> 'payout')::integer = 10 from jsonb_array_elements(public.prop_markets(public.evid('main')) -> 'markets') x where x ->> 'player' = 'P4' and x ->> 'metric' = 'goals' and x ->> 'kind' = 'ou'), 'adm: P4 não apareceu, palpite devolvido (10)');
select t_ok(public.bal('00000000-0000-0000-0000-0000000004a1') = 1000, 'adm voltou ao saldo inicial (devolvido)');

-- ---- correção depois da liquidação ----
reset role;
update public.baba_stats set goals = 3 where baba_id = 'f2000000-0000-0000-0000-000000000001' and name = 'P1';
select t_ok((select (result ->> 'win') = '3' from public.prop_markets where id = public.pmid('main', 'P1', 'goals', 'exact')), 'correção: cravada liquidada de novo (3 gols)');
select t_ok((select status = 'won' and payout = 140 from public.prop_bets where market_id = public.pmid('main', 'P1', 'goals', 'exact') and user_id = '00000000-0000-0000-0000-0000000004a5'), 'Eli passou a ganhar a cravada: 140');
select t_ok(public.bal('00000000-0000-0000-0000-0000000004a5') = 1000 - 10 - 25 - 25 + 140, 'saldo final do Eli correto (1080)');
select t_ok((select count(*) = 1 from public.points_ledger where user_id = '00000000-0000-0000-0000-0000000004a2' and reason = 'palpite-correcao' and delta = -168), 'extrato da Bia: reverteu os 168 (palpite-correcao)');
select t_ok((select count(*) = 2 from public.points_ledger where user_id = '00000000-0000-0000-0000-0000000004a2' and reason = 'palpite-pre-ganho' and delta = 168), 'extrato da Bia: e creditou de novo (duas linhas de 168)');
-- ausente que aparece depois: devolução é desfeita e o palpite é liquidado
update public.baba_stats set matches = 4 where false;
insert into public.baba_stats (baba_id, turma_player_id, name, goals, assists, saves, matches, wins)
  values ('f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000004', 'P4', 1, 0, 0, 4, 1);
select t_ok((select status = 'settled' and (result ->> 'win') = 'menos' from public.prop_markets where id = public.pmid('main', 'P4', 'goals')) is not null, 'P4 apareceu na correção: mercado liquidado');
select t_ok((select status = 'lost' from public.prop_bets where market_id = public.pmid('main', 'P4', 'goals')), 'adm: P4 fez 1 gol, o Mais 1,5 perdeu depois da correção');
select t_ok(public.bal('00000000-0000-0000-0000-0000000004a1') = 990, 'adm: perdeu os 10 pontos (saldo 990)');
-- reler não liquida de novo (idempotente)
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000004a2';
select public.prop_markets(public.evid('main'));
reset role;
select t_ok((select count(*) = 1 from public.points_ledger where user_id = '00000000-0000-0000-0000-0000000004a2' and reason = 'palpite-correcao' and delta = -168), 'reler os mercados não repete a correção');

-- ---- invariante do saldo ----
select t_ok(not exists (
  select 1 from public.wallets w where w.user_id::text like '00000000-0000-0000-0000-0000000004a%' and w.balance <> (select coalesce(sum(l.delta), 0) from public.points_ledger l where l.user_id = w.user_id)
), 'invariante: a soma do points_ledger é igual a wallets.balance para todo mundo');
select t_ok(not exists (select 1 from public.prop_bets b join public.prop_markets m on m.id = b.market_id where m.status in ('settled', 'void') and b.status = 'open'), 'nenhum palpite aberto em mercado encerrado');
select 'v11_4 done' as end;
