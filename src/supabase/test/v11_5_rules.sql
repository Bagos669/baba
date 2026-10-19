-- Rule tests for v11.5 (Palpites fase 2: Duelo, Destaque do dia, Total do baba, ranking de palpiteiros, Pé-quente e Mãe Diná).
-- Roda depois do v11_5_palpites_fase2.sql (cadeia completa). Procure por "FAIL".
\set QUIET on
reset role;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005b1', 'adm5@t'), ('00000000-0000-0000-0000-0000000005b2', 'bia5@t'), ('00000000-0000-0000-0000-0000000005b3', 'eli5@t'),
  ('00000000-0000-0000-0000-0000000005b4', 'fora5@t'), ('00000000-0000-0000-0000-0000000005b5', 'caio5@t'), ('00000000-0000-0000-0000-0000000005b6', 'duda5@t'),
  ('00000000-0000-0000-0000-0000000005b7', 'menor5@t');
insert into public.profiles (id, name) values
  ('00000000-0000-0000-0000-0000000005b1', 'Adm'), ('00000000-0000-0000-0000-0000000005b2', 'Bia'), ('00000000-0000-0000-0000-0000000005b3', 'Eli'),
  ('00000000-0000-0000-0000-0000000005b4', 'Fora'), ('00000000-0000-0000-0000-0000000005b5', 'Caio'), ('00000000-0000-0000-0000-0000000005b6', 'Duda'),
  ('00000000-0000-0000-0000-0000000005b7', 'Menor');
insert into public.account_private (user_id, birth_date)
  select ('00000000-0000-0000-0000-0000000005b' || g)::uuid, current_date - case when g = 7 then interval '17 years' else interval '30 years' end from generate_series(1, 7) g;
insert into public.turmas (id, name, created_by, owner_id, invite_code) values
  ('f5000000-0000-0000-0000-000000000001', 'Resenha FC', '00000000-0000-0000-0000-0000000005b1', '00000000-0000-0000-0000-0000000005b1', 'RESFC001'),
  ('f5000000-0000-0000-0000-000000000002', 'Nove FC', '00000000-0000-0000-0000-0000000005b1', '00000000-0000-0000-0000-0000000005b1', 'RESFC002'),
  ('f5000000-0000-0000-0000-000000000003', 'Novata FC', '00000000-0000-0000-0000-0000000005b1', '00000000-0000-0000-0000-0000000005b1', 'RESFC003'),
  ('f5000000-0000-0000-0000-000000000004', 'Ranking FC', '00000000-0000-0000-0000-0000000005b1', '00000000-0000-0000-0000-0000000005b1', 'RESFC004');
insert into public.turma_members (turma_id, user_id, role)
  select t.id, u.id, case when u.id = '00000000-0000-0000-0000-0000000005b1' then 'admin' else 'member' end
  from public.turmas t, auth.users u
  where t.id::text like 'f5000000-%' and u.id::text like '00000000-0000-0000-0000-0000000005b%' and u.id <> '00000000-0000-0000-0000-0000000005b4';

-- Turma A: P1..P7 de linha (P1 = Duda, P2 = Eli), R estreante de linha, K1 e K2 goleiros.
insert into public.turma_players (id, turma_id, name, is_goalkeeper, user_id)
  select ('f5000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid, 'f5000000-0000-0000-0000-000000000001', 'P' || g, false,
         case g when 1 then '00000000-0000-0000-0000-0000000005b6'::uuid when 2 then '00000000-0000-0000-0000-0000000005b3'::uuid end
  from generate_series(1, 7) g;
insert into public.turma_players (id, turma_id, name, is_goalkeeper) values
  ('f5000000-0000-0000-0000-0000000001b1', 'f5000000-0000-0000-0000-000000000001', 'K1', true),
  ('f5000000-0000-0000-0000-0000000001b2', 'f5000000-0000-0000-0000-000000000001', 'K2', true),
  ('f5000000-0000-0000-0000-0000000001c1', 'f5000000-0000-0000-0000-000000000001', 'R', false),
  ('f5000000-0000-0000-0000-0000000001c2', 'f5000000-0000-0000-0000-000000000001', 'P8', false);
-- Histórico de A: 10 babas. Linha: 3 gols, 2 assistências em 5 jogos. Goleiros: 4 defesas em 5 jogos.
-- Partidas no dia variam (5 a 8) e um convidado sem cadastro faz n gols (total de gols de 22 a 31).
create temp table hb5 (t uuid, n integer, id uuid);
grant all on hb5 to public;
insert into hb5 select 'f5000000-0000-0000-0000-000000000001', g, gen_random_uuid() from generate_series(1, 10) g;
insert into public.babas (id, created_by, turma_ids, title, played_on, finished, matches)
  select id, '00000000-0000-0000-0000-0000000005b1', array[t], 'h' || n, current_date - (n * 7), true, 5 + (n % 4) from hb5;
insert into public.baba_stats (baba_id, turma_player_id, name, goals, assists, saves, matches, wins)
  select hb5.id, tp.id, tp.name, 3, 2, 0, 5, 2 from hb5 join public.turma_players tp on tp.turma_id = hb5.t and tp.name ~ '^P[1-7]$';
insert into public.baba_stats (baba_id, turma_player_id, name, goals, assists, saves, matches, wins)
  select hb5.id, tp.id, tp.name, 0, 0, 4, 5, 2 from hb5 join public.turma_players tp on tp.turma_id = hb5.t and tp.is_goalkeeper;
insert into public.baba_stats (baba_id, turma_player_id, name, goals, assists, saves, matches, wins)
  select hb5.id, null, 'Convidado ' || n, n, 0, 0, 5, 2 from hb5;

-- Turma B (Nove FC): 10 babas, sempre 9 partidas e 20 gols. Turma C (Novata FC): só 4 babas finalizados.
insert into public.turma_players (id, turma_id, name, is_goalkeeper)
  select ('f5000000-0000-0000-0000-0000000002' || lpad(g::text, 2, '0'))::uuid, 'f5000000-0000-0000-0000-000000000002'::uuid, 'B' || g, g = 5 from generate_series(1, 5) g
  union all
  select ('f5000000-0000-0000-0000-0000000003' || lpad(g::text, 2, '0'))::uuid, 'f5000000-0000-0000-0000-000000000003'::uuid, 'C' || g, g = 5 from generate_series(1, 5) g;
insert into hb5 select 'f5000000-0000-0000-0000-000000000002', g, gen_random_uuid() from generate_series(1, 10) g;
insert into hb5 select 'f5000000-0000-0000-0000-000000000003', g, gen_random_uuid() from generate_series(1, 4) g;
insert into public.babas (id, created_by, turma_ids, title, played_on, finished, matches)
  select id, '00000000-0000-0000-0000-0000000005b1', array[t], 'h' || n, current_date - (n * 7), true,
         case when t = 'f5000000-0000-0000-0000-000000000002' then 9 else 5 + n end from hb5 where t <> 'f5000000-0000-0000-0000-000000000001';
insert into public.baba_stats (baba_id, turma_player_id, name, goals, assists, saves, matches, wins)
  select hb5.id, tp.id, tp.name, case when tp.is_goalkeeper then 0 else 5 end, 1, case when tp.is_goalkeeper then 6 else 0 end, 5, 2
  from hb5 join public.turma_players tp on tp.turma_id = hb5.t where hb5.t <> 'f5000000-0000-0000-0000-000000000001';

-- Listas: main e sus (Turma A, mesma lista), nove (B), novata (C). Todas hoje à noite.
create temp table ev5 (k text, id uuid);
grant all on ev5 to public;
insert into ev5 values ('main', gen_random_uuid()), ('sus', gen_random_uuid()), ('nove', gen_random_uuid()), ('novata', gen_random_uuid());
insert into public.turma_events (id, turma_id, created_by, starts_at, place)
  select id, case k when 'nove' then 'f5000000-0000-0000-0000-000000000002'::uuid when 'novata' then 'f5000000-0000-0000-0000-000000000003'::uuid
                    else 'f5000000-0000-0000-0000-000000000001'::uuid end,
         '00000000-0000-0000-0000-0000000005b1', least(now() + interval '6 hours', date_trunc('day', now()) + interval '23 hours 59 minutes'), k from ev5;
insert into public.event_rsvps (event_id, player_key, name, turma_player_id, status)
  select ev5.id, lower(tp.name), tp.name, tp.id, 'vou' from ev5 join public.turma_events e on e.id = ev5.id
  join public.turma_players tp on tp.turma_id = e.turma_id where tp.name <> 'P8';
insert into public.event_rsvps (event_id, player_key, name, status) select id, 'convidado', 'Convidado', 'vou' from ev5 where k in ('main', 'sus');

create function public.q5ev(p_k text) returns uuid language sql security definer as $$ select id from ev5 where k = p_k $$;
create function public.q5pid(p_name text) returns uuid language sql security definer as $$
  select id from public.turma_players where turma_id = 'f5000000-0000-0000-0000-000000000001' and name = p_name $$;
create function public.q5m(p_ev text, p_kind text, p_metric text) returns jsonb language sql security definer as $$
  select to_jsonb(m) from public.prop_markets m where m.event_id = public.q5ev(p_ev) and m.kind = p_kind and m.metric = p_metric and m.player_id is null $$;
create function public.q5duel(p_ev text, p_name text) returns jsonb language sql security definer as $$
  select to_jsonb(m) from public.prop_markets m where m.event_id = public.q5ev(p_ev) and m.kind = 'duel' and public.q5pid(p_name) in (m.player_id, m.player2_id) $$;
create function public.q5odd(m jsonb, k text) returns numeric language sql immutable as $$
  select (x ->> 'odd')::numeric from jsonb_array_elements(m -> 'selections') x where x ->> 'key' = k $$;
create function public.q5bet(p_market uuid, p_user text) returns jsonb language sql security definer as $$
  select to_jsonb(b) from public.prop_bets b where b.market_id = p_market and b.user_id = p_user::uuid $$;
create function public.q5kinds(p_ev text) returns jsonb language sql security definer as $$
  select jsonb_object_agg(k, n) from (select kind as k, count(*) as n from public.prop_markets where event_id = public.q5ev(p_ev) group by kind) x $$;
grant execute on function public.q5ev(text), public.q5pid(text), public.q5m(text, text, text), public.q5duel(text, text), public.q5odd(jsonb, text),
  public.q5bet(uuid, text), public.q5kinds(text) to authenticated;
select private.add_points(u.id, 1000, 'boas-vindas', null) from auth.users u where u.id::text like '00000000-0000-0000-0000-0000000005b%';

-- ---- matemática ----
select t_ok(private.prop_odd(private.prop_duel_p(2.4, 2.4)) = 1.80, 'duelo com λ iguais: chance 50%, cotação 1,80');
select t_ok(private.prop_duel_p(3, 1) > 0.65, 'duelo desigual fica fora de 35% a 65%');
select t_ok(abs((select sum((x ->> 'p')::numeric) from jsonb_array_elements(private.prop_leader_sel('[{"key":"a","lam":1},{"key":"b","lam":1}]'::jsonb)) x) - 1) < 0.5
  and (select count(*) = 2 from jsonb_array_elements(private.prop_leader_sel('[{"key":"a","lam":1},{"key":"b","lam":1}]'::jsonb)) x where (x ->> 'p')::numeric > 0.5),
  'destaque: empate no topo conta para os dois (chances somam mais que 1)');
select t_ok(((private.prop_leader_sel('[{"key":"a","lam":3},{"key":"b","lam":1},{"key":"c","lam":1}]'::jsonb) -> 0) ->> 'key') = 'a', 'destaque: maior λ vem primeiro');

-- ---- geração ----
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000005b4';
select t_err(format('select public.prop_markets(%L)', public.q5ev('main')), 'not_member', 'não membro não lê os mercados');
select t_err(format('select public.prop_leaderboard(%L, null)', 'f5000000-0000-0000-0000-000000000001'), 'not_member', 'não membro não lê o ranking');
reset role;
set request.uid = '00000000-0000-0000-0000-0000000005b2';
select public.prop_markets(public.q5ev('main'));
select t_ok((public.q5kinds('main') ->> 'duel')::integer = 3, 'três duelos no evento (7 elegíveis, máximo 3)');
select t_ok((public.q5kinds('main') ->> 'ou')::integer = 8 * 3 + 2 and (public.q5kinds('main') ->> 'exact')::integer = 8, 'mercados por atleta da v11.4 continuam iguais (26 Mais/Menos + 8 cravadas)');
select t_ok((select count(*) = 6 and count(distinct p) = 6 from (select player_id p from public.prop_markets where event_id = public.q5ev('main') and kind = 'duel'
  union all select player2_id from public.prop_markets where event_id = public.q5ev('main') and kind = 'duel') x), 'cada atleta em no máximo um duelo');
select t_ok(not exists (select 1 from public.prop_markets where event_id = public.q5ev('main') and kind = 'duel'
  and public.q5pid('R') in (player_id, player2_id)), 'estreante não entra em duelo');
select t_ok(not exists (select 1 from public.prop_markets m join public.turma_players tp on tp.id in (m.player_id, m.player2_id) where m.event_id = public.q5ev('main') and m.kind = 'duel' and tp.is_goalkeeper), 'goleiro não entra em duelo');
select t_ok(public.q5odd(public.q5duel('main', 'P1'), public.q5pid('P1')::text) = 1.80 and public.q5odd(public.q5duel('main', 'P1'), public.q5pid('P2')::text) = 1.80,
  'duelo P1 x P2 (λ de G+A iguais): 1,80 para cada lado');
select t_ok((select count(*) = 3 from public.prop_markets where event_id = public.q5ev('main') and kind = 'leader'), 'destaque: Artilheiro, Garçom e Paredão');
select t_ok(jsonb_array_length(public.q5m('main', 'leader', 'goals') -> 'selections') = 8, 'Artilheiro: os 8 atletas de linha cadastrados (com o estreante)');
select t_ok(jsonb_array_length(public.q5m('main', 'leader', 'saves') -> 'selections') = 2, 'Paredão: os 2 goleiros');
select t_ok(public.q5m('main', 'baba_total', 'matches') is not null and public.q5m('main', 'baba_total', 'goals') is not null, 'Total do baba: partidas e gols no dia');
select t_ok((select bool_and((x ->> 'p')::numeric between 0.35 and 0.65) from jsonb_array_elements((public.q5m('main', 'baba_total', 'matches') -> 'selections') || (public.q5m('main', 'baba_total', 'goals') -> 'selections')) x),
  'Total: as duas linhas ficam entre 35% e 65%');
select t_ok(((public.q5m('main', 'baba_total', 'goals') ->> 'line')::numeric - floor((public.q5m('main', 'baba_total', 'goals') ->> 'line')::numeric)) = 0.5, 'Total: linha de meio ponto');
select t_ok((public.q5m('main', 'baba_total', 'goals') -> 'selections' -> 0 ->> 'label') = 'Mais ' || replace(((public.q5m('main', 'baba_total', 'goals') ->> 'line')::numeric)::text, '.', ','), 'Total: rótulo com a linha (passa de 10)');
select t_ok((select count(*) = 1 from jsonb_array_elements(public.prop_markets(public.q5ev('main')) -> 'markets') x where x ->> 'kind' = 'duel' and x ->> 'player' = 'P1'
  and (x -> 'selections' -> 0 ->> 'label') = 'P1' and (x -> 'selections' -> 1 ->> 'label') = 'P2'), 'RPC: duelo traz o nome de cada lado');
select t_ok((select count(*) from jsonb_array_elements(public.prop_markets(public.q5ev('main')) -> 'markets') x) = 34 + 3 + 3 + 2, 'RPC lista todos os tipos (42)');
select t_ok((public.prop_open_counts(array[public.q5ev('main')]) ->> public.q5ev('main')::text)::integer = 42, 'chip do Início conta os mercados novos');
select t_ok((public.q5kinds('nove') ->> 'baba_total') is null, 'Nove FC (sempre 9 partidas e 20 gols): Total não abre');
select t_ok((public.prop_markets(public.q5ev('nove')) is not null) and (public.q5kinds('nove') ->> 'baba_total') is null, 'Nove FC: nenhuma linha entre 35% e 65%');
select t_ok((public.prop_markets(public.q5ev('novata')) is not null) and (public.q5kinds('novata') ->> 'baba_total') is null and (public.q5kinds('novata') ->> 'leader') is not null,
  'Novata FC (4 babas finalizados): Total não abre, o Destaque abre');
select t_ok((select count(*) = 2 from public.prop_markets where event_id = public.q5ev('nove') and kind = 'leader') and
  not exists (select 1 from public.prop_markets where event_id = public.q5ev('nove') and kind = 'leader' and metric = 'saves'),
  'Nove FC: 4 de linha abrem Artilheiro e Garçom; 1 goleiro não abre Paredão');
-- quem confirma depois entra nas opções do Destaque; ninguém novo entra em duelo já formado
reset role;
insert into public.event_rsvps (event_id, player_key, name, turma_player_id, status) values (public.q5ev('main'), 'p8', 'P8', public.q5pid('P8'), 'vou');
reset role;
select public.prop_markets(public.q5ev('main'));
select t_ok(jsonb_array_length(public.q5m('main', 'leader', 'goals') -> 'selections') = 9, 'confirmou depois: entrou nas opções do Artilheiro');
select t_ok((public.q5kinds('main') ->> 'duel')::integer = 3, 'continua com 3 duelos');

-- ---- adm ----
select t_err(format('select public.adjust_prop_line(%L, %s)', public.q5m('main', 'baba_total', 'goals') ->> 'id', (public.q5m('main', 'baba_total', 'goals') ->> 'line')::numeric + 0.5), 'not_allowed', 'membro não mexe na linha do Total');
select t_err(format('select public.suspend_prop_market(%L)', public.q5duel('main', 'P1') ->> 'id'), 'not_allowed', 'membro não suspende duelo');
set request.uid = '00000000-0000-0000-0000-0000000005b1';
select t_err(format('select public.adjust_prop_line(%L, 2.5)', public.q5duel('main', 'P1') ->> 'id'), 'market_closed', 'duelo não tem linha para mover');
select t_err(format('select public.adjust_prop_line(%L, 2.5)', public.q5m('main', 'leader', 'goals') ->> 'id'), 'market_closed', 'destaque não tem linha para mover');
select t_err(format('select public.adjust_prop_line(%L, %s)', public.q5m('main', 'baba_total', 'goals') ->> 'id', (public.q5m('main', 'baba_total', 'goals') ->> 'line')::numeric + 1), 'bad_line', 'Total: só passos de 0,5');
create temp table tl (line numeric);
grant all on tl to public;
insert into tl select (public.q5m('main', 'baba_total', 'goals') ->> 'line')::numeric;
select public.adjust_prop_line((public.q5m('main', 'baba_total', 'goals') ->> 'id')::uuid, (select line + 0.5 from tl));
select t_ok((public.q5m('main', 'baba_total', 'goals') ->> 'line')::numeric = (select line + 0.5 from tl) and (public.q5m('main', 'baba_total', 'goals') ->> 'edited_by') is not null,
  'Total: o adm moveu a linha 0,5 (cotação refeita no servidor)');
select public.adjust_prop_line((public.q5m('main', 'baba_total', 'goals') ->> 'id')::uuid, (select line + 1 from tl));
select t_ok((public.q5m('main', 'baba_total', 'goals') ->> 'line')::numeric = (select line + 1 from tl), 'Total: mais 0,5 (de volta a meio ponto)');
select t_ok((select bool_and((x ->> 'p')::numeric between 0 and 1) and abs(sum((x ->> 'p')::numeric) - 1) < 0.001 from jsonb_array_elements(public.q5m('main', 'baba_total', 'goals') -> 'selections') x), 'Total: Mais + Menos = 100%');

-- ---- palpites ----
set request.uid = '00000000-0000-0000-0000-0000000005b7';
select t_err(format('select public.place_prop_bet(%L, %L, 10)', public.q5duel('main', 'P1') ->> 'id', public.q5pid('P1')), 'not_adult', 'menor não palpita no duelo');
set request.uid = '00000000-0000-0000-0000-0000000005b4';
select t_err(format('select public.place_prop_bet(%L, %L, 10)', public.q5m('main', 'leader', 'goals') ->> 'id', public.q5pid('P1')), 'not_member', 'não membro não palpita');
set request.uid = '00000000-0000-0000-0000-0000000005b6';   -- Duda = P1
select t_err(format('select public.place_prop_bet(%L, %L, 10)', public.q5duel('main', 'P1') ->> 'id', public.q5pid('P2')), 'self_against', 'P1 não palpita no adversário (self_against)');
select t_ok((select odd from public.place_prop_bet((public.q5duel('main', 'P1') ->> 'id')::uuid, public.q5pid('P1')::text, 50)) = 1.80, 'P1 palpita em si mesmo no duelo');
select t_ok((select bet_id from public.place_prop_bet((public.q5m('main', 'leader', 'goals') ->> 'id')::uuid, public.q5pid('P1')::text, 10)) is not null, 'destaque: palpite em si mesmo é permitido');
select t_ok((select bet_id from public.place_prop_bet((public.q5m('main', 'leader', 'assists') ->> 'id')::uuid, public.q5pid('P3')::text, 10)) is not null, 'Duda palpita no Garçom');
select t_err(format('select public.place_prop_bet(%L, %L, 10)', public.q5m('main', 'leader', 'goals') ->> 'id', public.q5pid('P2')), 'already_bet', 'um palpite por mercado');
select t_err(format('select public.place_prop_bet(%L, %L, 10)', public.q5m('main', 'leader', 'saves') ->> 'id', public.q5pid('P1')), 'bad_selection', 'Paredão: só goleiros');
select t_err(format('select public.place_prop_bet(%L, %L, 5)', public.q5m('main', 'leader', 'saves') ->> 'id', public.q5pid('K1')), 'bad_stake', 'mínimo de 10');
select t_ok(public.bal('00000000-0000-0000-0000-0000000005b6') = 1000 - 70, 'saldo da Duda cai na hora (930)');
set request.uid = '00000000-0000-0000-0000-0000000005b3';   -- Eli = P2
select public.place_prop_bet((public.q5duel('main', 'P1') ->> 'id')::uuid, public.q5pid('P2')::text, 40);
select public.place_prop_bet((public.q5m('main', 'leader', 'goals') ->> 'id')::uuid, public.q5pid('P4')::text, 30);   -- P4 vai faltar
-- cotação 4,00 no P5 e no P7 (para o caso de empate do aceite)
reset role;
update public.prop_markets set selections = (select jsonb_agg(case when x ->> 'key' in (public.q5pid('P5')::text, public.q5pid('P7')::text) then x || '{"odd": 4.00}'::jsonb else x end)
  from jsonb_array_elements(selections) x) where id = (public.q5m('main', 'leader', 'goals') ->> 'id')::uuid;
reset role;
set request.uid = '00000000-0000-0000-0000-0000000005b2';   -- Bia
select t_ok((select odd from public.place_prop_bet((public.q5m('main', 'leader', 'goals') ->> 'id')::uuid, public.q5pid('P5')::text, 100)) = 4.00, 'Bia: 100 no P5 Artilheiro, cotação 4,00');
select public.place_prop_bet((public.q5duel('main', 'P5') ->> 'id')::uuid, public.q5pid('P5')::text, 100);
select public.place_prop_bet((public.q5duel('main', 'P3') ->> 'id')::uuid, public.q5pid('P3')::text, 20);   -- P4 vai faltar: duelo anulado
select public.place_prop_bet((public.q5m('main', 'baba_total', 'goals') ->> 'id')::uuid, 'mais', 50);
select public.place_prop_bet((public.q5m('main', 'baba_total', 'matches') ->> 'id')::uuid, 'mais', 30);
select t_ok((select line from public.prop_bets where id = (select max(id) from public.prop_bets where user_id = '00000000-0000-0000-0000-0000000005b2')) is not null, 'Total: a linha fica gravada no palpite');
set request.uid = '00000000-0000-0000-0000-0000000005b5';   -- Caio
select t_ok((select odd from public.place_prop_bet((public.q5m('main', 'leader', 'goals') ->> 'id')::uuid, public.q5pid('P7')::text, 100)) = 4.00, 'Caio: 100 no P7 Artilheiro, cotação 4,00');
select public.place_prop_bet((public.q5duel('main', 'P5') ->> 'id')::uuid, public.q5pid('P6')::text, 100);
select public.place_prop_bet((public.q5m('main', 'baba_total', 'goals') ->> 'id')::uuid, 'menos', 50);
select public.place_prop_bet((public.q5m('main', 'baba_total', 'matches') ->> 'id')::uuid, 'menos', 30);
select public.place_prop_bet((public.q5m('main', 'leader', 'saves') ->> 'id')::uuid, public.q5pid('K2')::text, 20);
set request.uid = '00000000-0000-0000-0000-0000000005b1';   -- Adm
select public.place_prop_bet((public.q5m('main', 'leader', 'saves') ->> 'id')::uuid, public.q5pid('K1')::text, 20);
select public.place_prop_bet((public.q5m('main', 'leader', 'goals') ->> 'id')::uuid, public.q5pid('P3')::text, 10);
select t_err(format('select public.adjust_prop_line(%L, %s)', public.q5m('main', 'baba_total', 'goals') ->> 'id', (select line + 1.5 from tl)), 'has_bets', 'Total com palpite: o adm não move a linha');
select t_ok((select count(*) >= 14 from jsonb_array_elements(public.prop_event_bets(public.q5ev('main'))) x), 'extrato do adm lista os palpites dos tipos novos');
select t_ok((select x ->> 'label' from jsonb_array_elements(public.prop_event_bets(public.q5ev('main'))) x where x ->> 'kind' = 'duel' and x ->> 'name' = 'Duda') = 'Duelo P1 x P2 · P1', 'extrato do adm: texto do duelo');
-- Suspender devolve tudo (Total de partidas)
select t_ok(public.suspend_prop_market((public.q5m('main', 'baba_total', 'matches') ->> 'id')::uuid) = 2, 'suspender o Total de partidas: 2 palpites devolvidos');
select t_ok((public.q5m('main', 'baba_total', 'matches') ->> 'status') = 'void' and (public.q5bet((public.q5m('main', 'baba_total', 'matches') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b2') ->> 'status') = 'void', 'Total suspenso: anulado e devolvido');
select t_ok(public.bal('00000000-0000-0000-0000-0000000005b2') = 1000 - 100 - 100 - 20 - 50, 'Bia recebeu os 30 de volta (730)');
select t_ok(public.bal('00000000-0000-0000-0000-0000000005b5') = 1000 - 100 - 100 - 50 - 20, 'Caio recebeu os 30 de volta (730)');
-- Suspender também vale para Duelo e Destaque (lista 'sus')
set request.uid = '00000000-0000-0000-0000-0000000005b2';
select public.prop_markets(public.q5ev('sus'));
select public.place_prop_bet((public.q5duel('sus', 'P1') ->> 'id')::uuid, public.q5pid('P2')::text, 10);
select public.place_prop_bet((public.q5m('sus', 'leader', 'assists') ->> 'id')::uuid, public.q5pid('P2')::text, 10);
set request.uid = '00000000-0000-0000-0000-0000000005b1';
select t_ok(public.suspend_prop_market((public.q5duel('sus', 'P1') ->> 'id')::uuid) = 1 and public.suspend_prop_market((public.q5m('sus', 'leader', 'assists') ->> 'id')::uuid) = 1, 'adm suspende duelo e destaque');
select t_ok(public.bal('00000000-0000-0000-0000-0000000005b2') = 730, 'Bia recebeu de volta os dois palpites suspensos');

-- ---- liquidação ----
-- O baba de hoje é finalizado (7 partidas) e os stats chegam. P1 e P2 empatam em G+A (2 x 2), P4 falta, P5 3 x 1 P6.
-- Artilheiro: P5 e P7 empatam com 3 gols. Garçom: ninguém dá assistência (máximo 0). Paredão: K1 5 x 2 K2.
-- O convidado faz gols suficientes para o total ficar meio gol acima da linha (Mais ganha).
reset role;
insert into public.babas (id, created_by, turma_ids, title, played_on, finished, matches, state, event_id)
  values ('f5200000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000005b1', array['f5000000-0000-0000-0000-000000000001'::uuid], 'hoje', current_date, false, 0, '{}'::jsonb, public.q5ev('main'));
update public.babas set state = '{"firstKickoffAt": 1792444800000}'::jsonb where id = 'f5200000-0000-0000-0000-000000000001';
reset role;
set request.uid = '00000000-0000-0000-0000-0000000005b2';
select t_err(format('select public.place_prop_bet(%L, %L, 10)', public.q5m('main', 'leader', 'saves') ->> 'id', public.q5pid('K1')), 'locked', 'depois do primeiro apito: travado');
reset role;
update public.babas set finished = true, matches = 7 where id = 'f5200000-0000-0000-0000-000000000001';
insert into public.baba_stats (baba_id, turma_player_id, name, goals, assists, saves, matches, wins) values
  ('f5200000-0000-0000-0000-000000000001', public.q5pid('P1'), 'P1', 2, 0, 0, 7, 3),
  ('f5200000-0000-0000-0000-000000000001', public.q5pid('P2'), 'P2', 2, 0, 0, 7, 3),
  ('f5200000-0000-0000-0000-000000000001', public.q5pid('P3'), 'P3', 0, 0, 0, 7, 3),
  ('f5200000-0000-0000-0000-000000000001', public.q5pid('P5'), 'P5', 3, 0, 0, 7, 3),
  ('f5200000-0000-0000-0000-000000000001', public.q5pid('P6'), 'P6', 1, 0, 0, 7, 3),
  ('f5200000-0000-0000-0000-000000000001', public.q5pid('P7'), 'P7', 3, 0, 0, 7, 3),
  ('f5200000-0000-0000-0000-000000000001', public.q5pid('R'), 'R', 0, 0, 0, 7, 3),
  ('f5200000-0000-0000-0000-000000000001', public.q5pid('P8'), 'P8', 0, 0, 0, 7, 3),
  ('f5200000-0000-0000-0000-000000000001', public.q5pid('K1'), 'K1', 0, 0, 5, 7, 3),
  ('f5200000-0000-0000-0000-000000000001', public.q5pid('K2'), 'K2', 0, 0, 2, 7, 3),
  ('f5200000-0000-0000-0000-000000000001', null, 'Convidado', greatest(0, ceil((public.q5m('main', 'baba_total', 'goals') ->> 'line')::numeric)::integer - 11), 0, 0, 7, 3);
select t_ok((public.q5duel('main', 'P1') ->> 'status') = 'settled' and (public.q5duel('main', 'P1') -> 'result' ->> 'win') = 'empate', 'duelo P1 x P2 empatou (2 x 2)');
select t_ok((public.q5bet((public.q5duel('main', 'P1') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b6') ->> 'status') = 'void'
  and (public.q5bet((public.q5duel('main', 'P1') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b3') ->> 'status') = 'void', 'duelo empatado: palpites devolvidos');
select t_ok((public.q5duel('main', 'P3') ->> 'status') = 'void' and (public.q5duel('main', 'P3') ->> 'void_reason') = 'ausente', 'P4 com 0 jogos: duelo anulado');
select t_ok((public.q5bet((public.q5duel('main', 'P3') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b2') ->> 'status') = 'void', 'duelo anulado: palpite devolvido');
select t_ok((public.q5bet((public.q5duel('main', 'P5') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b2') ->> 'payout')::integer = 180
  and (public.q5bet((public.q5duel('main', 'P5') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b5') ->> 'status') = 'lost', 'duelo P5 3 x 1 P6: Bia ganha 180, Caio perde');
select t_ok((public.q5m('main', 'leader', 'goals') -> 'result' -> 'win') = to_jsonb(array(select x from unnest(array[public.q5pid('P5')::text, public.q5pid('P7')::text]) x order by x)), 'Artilheiro: P5 e P7 empatados no topo');
select t_ok((public.q5bet((public.q5m('main', 'leader', 'goals') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b2') ->> 'payout')::integer = 200
  and (public.q5bet((public.q5m('main', 'leader', 'goals') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b5') ->> 'payout')::integer = 200,
  'dois empatados, cotação 4,00, palpite de 100: cada um recebe 200');
select t_ok((public.q5bet((public.q5m('main', 'leader', 'goals') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b3') ->> 'status') = 'void'
  and (public.q5bet((public.q5m('main', 'leader', 'goals') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b3') ->> 'payout')::integer = 30, 'Artilheiro: palpite no P4 (não jogou) devolvido');
select t_ok((public.q5bet((public.q5m('main', 'leader', 'goals') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b1') ->> 'status') = 'lost'
  and (public.q5bet((public.q5m('main', 'leader', 'goals') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b6') ->> 'status') = 'lost', 'Artilheiro: os outros palpites liquidados normalmente (P3 e P1 perdem)');
select t_ok((public.q5m('main', 'leader', 'assists') ->> 'status') = 'void' and (public.q5m('main', 'leader', 'assists') ->> 'void_reason') = 'zero', 'Garçom com máximo 0: anulado');
select t_ok((public.q5bet((public.q5m('main', 'leader', 'assists') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b6') ->> 'status') = 'void', 'Garçom anulado: palpite devolvido');
select t_ok((public.q5bet((public.q5m('main', 'leader', 'saves') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b1') ->> 'status') = 'won'
  and (public.q5bet((public.q5m('main', 'leader', 'saves') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b5') ->> 'status') = 'lost', 'Paredão: K1 (5 defesas) ganha');
select t_ok((public.q5m('main', 'baba_total', 'goals') -> 'result' ->> 'win') = 'mais'
  and (public.q5bet((public.q5m('main', 'baba_total', 'goals') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b2') ->> 'status') = 'won'
  and (public.q5bet((public.q5m('main', 'baba_total', 'goals') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b5') ->> 'status') = 'lost', 'Total de gols: Mais ganhou');
create temp table snap (u uuid, b integer);
grant all on snap to public;
insert into snap select user_id, balance from public.wallets where user_id::text like '00000000-0000-0000-0000-0000000005b%';

-- ---- correção depois da liquidação (três tipos) ----
-- P1 perde um gol (duelo: P2 2 x 1 P1), P7 perde um (Artilheiro: só P5); o total cai 2 (Total: Menos).
update public.baba_stats set goals = goals - 1 where baba_id = 'f5200000-0000-0000-0000-000000000001' and name in ('P1', 'P7');
select t_ok((public.q5duel('main', 'P1') -> 'result' ->> 'win') = public.q5pid('P2')::text, 'correção: duelo agora é do P2');
select t_ok((public.q5bet((public.q5duel('main', 'P1') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b3') ->> 'payout')::integer = 72
  and (public.q5bet((public.q5duel('main', 'P1') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b6') ->> 'status') = 'lost', 'correção: Eli ganha 72 no duelo, Duda perde');
select t_ok((select count(*) = 1 from public.points_ledger l join public.prop_bets b on b.id::text = l.ref where b.market_id = (public.q5duel('main', 'P1') ->> 'id')::uuid
  and l.user_id = '00000000-0000-0000-0000-0000000005b3' and l.reason = 'palpite-correcao' and l.delta = -40)
  and (select count(*) = 1 from public.points_ledger l join public.prop_bets b on b.id::text = l.ref where b.market_id = (public.q5duel('main', 'P1') ->> 'id')::uuid
  and l.user_id = '00000000-0000-0000-0000-0000000005b3' and l.reason = 'palpite-pre-ganho' and l.delta = 72), 'extrato do duelo: reverte a devolução e credita o ganho');
select t_ok((public.q5bet((public.q5m('main', 'leader', 'goals') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b2') ->> 'payout')::integer = 400
  and (public.q5bet((public.q5m('main', 'leader', 'goals') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b5') ->> 'status') = 'lost', 'correção: só o P5 artilheiro, Bia recebe 400 e Caio perde');
select t_ok((select count(*) = 1 from public.points_ledger l join public.prop_bets b on b.id::text = l.ref where b.market_id = (public.q5m('main', 'leader', 'goals') ->> 'id')::uuid
  and l.user_id = '00000000-0000-0000-0000-0000000005b5' and l.reason = 'palpite-correcao' and l.delta = -200)
  and (select count(*) = 2 from public.points_ledger l join public.prop_bets b on b.id::text = l.ref where b.market_id = (public.q5m('main', 'leader', 'goals') ->> 'id')::uuid
  and l.user_id = '00000000-0000-0000-0000-0000000005b2' and l.reason = 'palpite-pre-ganho'), 'extrato do destaque: correção e novo crédito');
select t_ok((public.q5m('main', 'baba_total', 'goals') -> 'result' ->> 'win') = 'menos'
  and (public.q5bet((public.q5m('main', 'baba_total', 'goals') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b5') ->> 'status') = 'won'
  and (public.q5bet((public.q5m('main', 'baba_total', 'goals') ->> 'id')::uuid, '00000000-0000-0000-0000-0000000005b2') ->> 'status') = 'lost', 'correção: Total de gols vira Menos');
select t_ok((select count(*) = 1 from public.points_ledger l join public.prop_bets b on b.id::text = l.ref where b.market_id = (public.q5m('main', 'baba_total', 'goals') ->> 'id')::uuid
  and l.reason = 'palpite-correcao') and (select count(*) = 2 from public.points_ledger l join public.prop_bets b on b.id::text = l.ref
  where b.market_id = (public.q5m('main', 'baba_total', 'goals') ->> 'id')::uuid and l.reason = 'palpite-pre-ganho'), 'extrato do Total: correção e novo crédito');
-- reler não liquida de novo
create temp table cc as select count(*) as n from public.points_ledger l join public.prop_bets b on b.id::text = l.ref join public.prop_markets m on m.id = b.market_id
  where m.event_id = public.q5ev('main') and l.reason = 'palpite-correcao';
grant all on cc to public;
set request.uid = '00000000-0000-0000-0000-0000000005b2';
select public.prop_markets(public.q5ev('main'));
reset role;
select t_ok((select count(*) from public.points_ledger l join public.prop_bets b on b.id::text = l.ref join public.prop_markets m on m.id = b.market_id
  where m.event_id = public.q5ev('main') and l.reason = 'palpite-correcao') = (select n from cc), 'reler os mercados não repete a correção');
-- aviso de palpites liquidados conta os mercados novos (sem aviso novo)
insert into public.push_subs (endpoint, p256dh, auth, user_id) values ('https://push.example/bia5', 'k', 'a', '00000000-0000-0000-0000-0000000005b2') on conflict do nothing;
select t_ok((select body from private.avisos_candidatos() c where c.tipo = 'palpites' and c.event_id = public.q5ev('main') and c.user_id = '00000000-0000-0000-0000-0000000005b2') is not null
  and (select title from private.avisos_candidatos() c where c.tipo = 'palpites' and c.event_id = public.q5ev('main') and c.user_id = '00000000-0000-0000-0000-0000000005b2') like 'Você acertou 2 de 3 palpites%',
  'aviso de palpites liquidados conta Duelo, Destaque e Total (2 de 3)');

-- ---- ranking de palpiteiros ----
-- Turma Ranking FC: lista desta temporada (rk), da anterior (old) e de duas atrás (old2). Palpites já resolvidos, gravados direto.
insert into public.turma_players (id, turma_id, name)
  select ('f5000000-0000-0000-0000-0000000004' || lpad(g::text, 2, '0'))::uuid, 'f5000000-0000-0000-0000-000000000004', 'J' || g from generate_series(1, 15) g;
update public.turma_players set user_id = '00000000-0000-0000-0000-0000000005b5' where id = 'f5000000-0000-0000-0000-000000000401';
insert into ev5 values ('rk', gen_random_uuid()), ('old', gen_random_uuid()), ('old2', gen_random_uuid());
insert into public.turma_events (id, turma_id, created_by, starts_at, place, status)
  select id, 'f5000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000005b1',
         case k when 'rk' then greatest(now() - interval '1 hour', private.season_start(private.season_of(current_date)) + interval '12 hours')
                when 'old' then (private.season_start(private.season_of(current_date)) - interval '30 days')::timestamptz + interval '12 hours'
                else (private.season_start(private.season_of(current_date)) - interval '7 months')::timestamptz + interval '12 hours' end, k, 'done'
  from ev5 where k in ('rk', 'old', 'old2');
create temp table rkm (ev text, n integer, id uuid);
grant all on rkm to public;
insert into rkm select k, g, gen_random_uuid() from ev5, generate_series(1, 15) g where k in ('rk', 'old', 'old2');
insert into public.prop_markets (id, event_id, turma_id, player_id, kind, metric, line, selections, status, result, settled_at)
  select rkm.id, public.q5ev(rkm.ev), 'f5000000-0000-0000-0000-000000000004', ('f5000000-0000-0000-0000-0000000004' || lpad(rkm.n::text, 2, '0'))::uuid,
         case when rkm.n <= 3 then 'exact' else 'ou' end, 'goals', case when rkm.n > 3 then 1.5 end, '[]'::jsonb, 'settled', '{}'::jsonb, now()
  from rkm;
-- (ev, usuário, mercado, stake, ganhou?, payout)
-- Caio: 10 palpites, 5 ganhos pagando 30 -> lucro 50 (ROI 50%). Adm: 11 palpites de 10, ganhos somam 160 -> lucro 50 (ROI 45%).
-- Bia: 10 palpites, 6 ganhos pagando 20 (2 cravadas) -> lucro 20. Eli: 9 resolvidos + 1 devolvido (não entra).
create temp table rkb (u text, n integer, won boolean, payout integer, st text);
grant all on rkb to public;
insert into rkb select '5b5', g, g in (1, 5, 6, 7, 8), case when g in (1, 5, 6, 7, 8) then 30 else 0 end, null from generate_series(1, 10) g;
insert into rkb select '5b1', g, g in (4, 5, 6, 7), case g when 4 then 10 when 5 then 50 else 50 end * (g in (4, 5, 6, 7))::integer, null from generate_series(1, 11) g;
insert into rkb select '5b2', g, g in (2, 3, 4, 5, 6, 7), case when g in (2, 3, 4, 5, 6, 7) then 20 else 0 end, null from generate_series(1, 10) g;
insert into rkb select '5b3', g, g between 4 and 8, case when g between 4 and 8 then 40 else 0 end, case when g = 10 then 'void' end from generate_series(1, 10) g;
insert into public.prop_bets (market_id, user_id, selection, stake, odd, status, payout, settled_at)
  select rkm.id, ('00000000-0000-0000-0000-000000000' || rkb.u)::uuid, 'mais', 10, 2,
         coalesce(rkb.st, case when rkb.won then 'won' else 'lost' end), case when rkb.st = 'void' then 10 else rkb.payout end, now()
  from rkb join rkm on rkm.n = rkb.n and rkm.ev in ('rk', 'old');
-- Duas temporadas atrás: Caio perde tudo (lucro negativo, nada de Pé-quente).
insert into public.prop_bets (market_id, user_id, selection, stake, odd, status, payout, settled_at)
  select rkm.id, '00000000-0000-0000-0000-0000000005b5', 'mais', 10, 2, 'lost', 0, now() from rkm where rkm.ev = 'old2' and rkm.n <= 10;
reset role;
set request.uid = '00000000-0000-0000-0000-0000000005b3';
select t_ok((select jsonb_agg(r ->> 'name' order by (r ->> 'rank')::integer) from jsonb_array_elements(public.prop_leaderboard('f5000000-0000-0000-0000-000000000004', null) -> 'rows') r) = '["Caio", "Adm", "Bia"]'::jsonb,
  'ranking: ordem por lucro (Caio e Adm com 50) e desempate por ROI (Caio 50% > Adm 45%)');
select t_ok((public.prop_leaderboard('f5000000-0000-0000-0000-000000000004', null) -> 'me' ->> 'total')::integer = 9
  and not (public.prop_leaderboard('f5000000-0000-0000-0000-000000000004', null) -> 'me' ->> 'qualified')::boolean, 'Eli tem 9 resolvidos (o devolvido não conta): fora do ranking');
select t_ok((select count(*) = 1 from jsonb_array_elements(public.prop_leaderboard('f5000000-0000-0000-0000-000000000004', null) -> 'rows') r where r ->> 'name' = 'Adm' and (r ->> 'total')::integer = 11), 'Adm com 11 entra');
select t_ok((select (r ->> 'lucro')::integer = 20 and (r ->> 'wins')::integer = 6 and (r ->> 'total')::integer = 10 and (r ->> 'cravadas')::integer = 2 and (r ->> 'roi')::numeric = 0.2
  from jsonb_array_elements(public.prop_leaderboard('f5000000-0000-0000-0000-000000000004', null) -> 'rows') r where r ->> 'name' = 'Bia'), 'colunas: lucro, ROI, acertos/total e cravadas certas');
select t_ok(jsonb_array_length(public.prop_leaderboard('f5000000-0000-0000-0000-000000000004', null) -> 'seasons') = 3
  and (public.prop_leaderboard('f5000000-0000-0000-0000-000000000004', null) ->> 'season') = private.season_of(current_date), 'seletor: temporada atual e as anteriores');
select t_ok((select jsonb_agg(r ->> 'name' order by (r ->> 'rank')::integer) from jsonb_array_elements(public.prop_leaderboard('f5000000-0000-0000-0000-000000000004',
  private.season_of((private.season_start(private.season_of(current_date)) - 30)::date)) -> 'rows') r) = '["Caio", "Adm", "Bia"]'::jsonb, 'ranking da temporada anterior');
select t_err(format('select public.prop_leaderboard(%L, %L)', 'f5000000-0000-0000-0000-000000000004', 'xx'), 'bad_args', 'temporada inválida');
select t_ok(jsonb_array_length(public.prop_leaderboard('f5000000-0000-0000-0000-000000000001', null) -> 'rows') = 0
  and (public.prop_leaderboard('f5000000-0000-0000-0000-000000000001', null) -> 'me' ->> 'total')::integer >= 1, 'Resenha FC: ninguém com 10 ainda; "você tem X de 10"');

-- ---- troféus ----
reset role;
select private.award_seasons('f5000000-0000-0000-0000-000000000004');
select private.award_seasons('f5000000-0000-0000-0000-000000000004');
select t_ok((select count(*) = 1 and min(user_id::text) = '00000000-0000-0000-0000-0000000005b5' and min(value) = 50 from public.turma_trophies
  where turma_id = 'f5000000-0000-0000-0000-000000000004' and kind = 'pe_quente'), 'Pé-quente da temporada anterior: Caio (lucro 50), um só mesmo rodando duas vezes');
select t_ok((select count(*) = 1 and min(user_id::text) = '00000000-0000-0000-0000-0000000005b2' and min(value) = 2 from public.turma_trophies
  where turma_id = 'f5000000-0000-0000-0000-000000000004' and kind = 'mae_dina'), 'Mãe Diná: Bia (2 cravadas certas), um só');
select t_ok(not exists (select 1 from public.turma_trophies where turma_id = 'f5000000-0000-0000-0000-000000000004' and kind = 'pe_quente'
  and season = private.season_of((private.season_start(private.season_of(current_date)) - 200)::date)), 'temporada com lucro negativo: sem Pé-quente');
select t_ok(not exists (select 1 from public.turma_trophies where turma_id = 'f5000000-0000-0000-0000-000000000004' and kind in ('pe_quente', 'mae_dina')
  and season = private.season_of(current_date)), 'temporada atual (ainda aberta): sem troféu');
select t_ok((select player_id from public.turma_trophies where turma_id = 'f5000000-0000-0000-0000-000000000004' and kind = 'pe_quente') = 'f5000000-0000-0000-0000-000000000401', 'troféu ligado ao cadastro do Caio na turma');
reset role;
set request.uid = '00000000-0000-0000-0000-0000000005b5';
select t_ok((select count(*) = 1 from jsonb_array_elements(public.user_trophies(null)) x where x ->> 'kind' = 'pe_quente' and x ->> 'turma' = 'Ranking FC'), 'Perfil do Caio: Pé-quente');
set request.uid = '00000000-0000-0000-0000-0000000005b3';
select t_ok((select count(*) = 1 from jsonb_array_elements(public.user_trophies('00000000-0000-0000-0000-0000000005b2')) x where x ->> 'kind' = 'mae_dina'), 'card da Bia (visto pelo Eli): Mãe Diná');
select t_ok((select count(*) = 2 from jsonb_array_elements(public.turma_trophies('f5000000-0000-0000-0000-000000000004') -> 'atletas') x where x ->> 'kind' in ('pe_quente', 'mae_dina')), 'prateleira da turma mostra os dois');
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000005b4';
select t_ok(jsonb_array_length(public.user_trophies('00000000-0000-0000-0000-0000000005b5')) = 0, 'quem não vê a turma não vê os troféus dela');

-- ---- invariante do saldo ----
reset role;
select t_ok(not exists (
  select 1 from public.wallets w where w.user_id::text like '00000000-0000-0000-0000-0000000005b%' and w.balance <> (select coalesce(sum(l.delta), 0) from public.points_ledger l where l.user_id = w.user_id)
), 'invariante: a soma do points_ledger é igual a wallets.balance para todo mundo');
select t_ok(not exists (select 1 from public.prop_bets b join public.prop_markets m on m.id = b.market_id where m.status in ('settled', 'void') and b.status = 'open'), 'nenhum palpite aberto em mercado encerrado');
select 'v11_5 done' as end;
