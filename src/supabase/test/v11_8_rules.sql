-- Rule tests for v11.8 (palpites abertos: escada 0,5 a 10,5 com lado "quase certo" travado, jogos ganhos, duelo por escolha,
-- MVP no Destaque, Total com escada, Ver meus palpites). Roda depois do v11_8_palpites_abertos.sql. Procure por "FAIL".
\set QUIET on
reset role;
reset request.uid;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000008a1', 'adm8@t'), ('00000000-0000-0000-0000-0000000008a2', 'bia8@t'), ('00000000-0000-0000-0000-0000000008a3', 'eli8@t');
insert into public.profiles (id, name) values
  ('00000000-0000-0000-0000-0000000008a1', 'Adm8'), ('00000000-0000-0000-0000-0000000008a2', 'Bia8'), ('00000000-0000-0000-0000-0000000008a3', 'Eli8');
insert into public.account_private (user_id, birth_date)
  select ('00000000-0000-0000-0000-0000000008a' || g)::uuid, current_date - interval '30 years' from generate_series(1, 3) g;
insert into public.turmas (id, name, created_by, owner_id, invite_code) values
  ('f8000000-0000-0000-0000-000000000001', 'Oito FC', '00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-0000000008a1', 'OITOFC01');
insert into public.turma_members (turma_id, user_id, role) values
  ('f8000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008a1', 'admin'),
  ('f8000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008a2', 'member'),
  ('f8000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008a3', 'member');
-- P1 nunca faz gol nem dá passe; P2 (Bia) a P6: 3 gols, 2 assistências, 2 vitórias em 5 jogos; K1 goleiro: 4 defesas.
insert into public.turma_players (id, turma_id, name, is_goalkeeper, user_id)
  select ('f8000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid, 'f8000000-0000-0000-0000-000000000001', 'P' || g, false,
         case g when 2 then '00000000-0000-0000-0000-0000000008a2'::uuid end
  from generate_series(1, 6) g;
insert into public.turma_players (id, turma_id, name, is_goalkeeper) values
  ('f8000000-0000-0000-0000-0000000001b1', 'f8000000-0000-0000-0000-000000000001', 'K1', true),
  ('f8000000-0000-0000-0000-0000000001c1', 'f8000000-0000-0000-0000-000000000001', 'Fora da lista', false);
create temp table hb8 (n integer, id uuid);
grant all on hb8 to public;
insert into hb8 select g, gen_random_uuid() from generate_series(1, 10) g;
insert into public.babas (id, created_by, turma_ids, title, played_on, finished, matches)
  select id, '00000000-0000-0000-0000-0000000008a1', array['f8000000-0000-0000-0000-000000000001'::uuid], 'h' || n, current_date - (n * 7), true, 8 from hb8;
insert into public.baba_stats (baba_id, turma_player_id, name, goals, assists, saves, matches, wins)
  select hb8.id, tp.id, tp.name, case when tp.name = 'P1' then 0 else 3 end, case when tp.name = 'P1' then 0 else 2 end, 0, 5, 2
  from hb8 join public.turma_players tp on tp.turma_id = 'f8000000-0000-0000-0000-000000000001' and tp.name ~ '^P[1-6]$';
insert into public.baba_stats (baba_id, turma_player_id, name, goals, assists, saves, matches, wins)
  select hb8.id, tp.id, tp.name, 0, 0, 4, 5, 2 from hb8 join public.turma_players tp on tp.id = 'f8000000-0000-0000-0000-0000000001b1';

create temp table ev8 (id uuid);
grant all on ev8 to public;
insert into ev8 values (gen_random_uuid());
insert into public.turma_events (id, turma_id, created_by, starts_at, place)
  select id, 'f8000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008a1',
         least(now() + interval '6 hours', date_trunc('day', now()) + interval '23 hours 59 minutes'), 'Quadra' from ev8;
insert into public.event_rsvps (event_id, player_key, name, turma_player_id, status)
  select ev8.id, lower(tp.name), tp.name, tp.id, 'vou' from ev8, public.turma_players tp
  where tp.turma_id = 'f8000000-0000-0000-0000-000000000001' and tp.name <> 'Fora da lista';
create function public.q8ev() returns uuid language sql security definer as $$ select id from ev8 limit 1 $$;
create function public.q8pid(p_name text) returns uuid language sql security definer as $$
  select id from public.turma_players where turma_id = 'f8000000-0000-0000-0000-000000000001' and name = p_name $$;
create function public.q8m(p_name text, p_kind text, p_metric text) returns uuid language sql security definer as $$
  select id from public.prop_markets where event_id = public.q8ev() and kind = p_kind and metric = p_metric
     and player_id is not distinct from public.q8pid(p_name) and player2_id is null $$;
create function public.q8bet(p_market uuid, p_user text) returns jsonb language sql security definer as $$
  select to_jsonb(b) from public.prop_bets b where b.market_id = p_market and b.user_id = p_user::uuid $$;
create function public.q8mev(p_ev uuid, p_kind text, p_metric text) returns uuid language sql security definer as $$
  select id from public.prop_markets where event_id = p_ev and kind = p_kind and metric = p_metric and player_id is null $$;
grant execute on function public.q8ev(), public.q8pid(text), public.q8m(text, text, text), public.q8bet(uuid, text), public.q8mev(uuid, text, text) to authenticated;
select private.add_points(u.id, 1000, 'boas-vindas', null) from auth.users u where u.id::text like '00000000-0000-0000-0000-0000000008a%';

-- ---- matemática ----
select t_ok(jsonb_array_length(private.prop_ladder(0.3)) = 11, 'escada por atleta vai de 0,5 a 10,5 (11 linhas)');
select t_ok(not exists (select 1 from jsonb_array_elements(private.prop_ladder(0.3)) x where not (x -> 'mais' ->> 'ok')::boolean and not (x -> 'menos' ->> 'ok')::boolean),
  'toda linha tem pelo menos um lado aberto');
select t_ok((select (x -> 'mais' ->> 'ok')::boolean and (x -> 'mais' ->> 'odd')::numeric = 20 and not (x -> 'menos' ->> 'ok')::boolean
  from jsonb_array_elements(private.prop_ladder(0.3)) x where (x ->> 'line')::numeric = 4.5), 'linha alta: zebra paga 20x e o lado quase certo trava');
select t_ok((select sum((x -> 'mais' ->> 'p')::numeric * least((x -> 'mais' ->> 'odd')::numeric, 20)) / count(*) <= 0.9
  from jsonb_array_elements(private.prop_ladder(1.8)) x where (x -> 'mais' ->> 'ok')::boolean), 'lado aberto nunca paga mais que o justo (valor esperado <= 0,9)');
select t_ok(private.prop_default_line(0.05) = 0.5 and private.prop_default_line(1.8) = 1.5, 'linha sugerida = a mais equilibrada');

-- ---- geração ----
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000008a3';
select t_ok((public.prop_markets(public.q8ev()) ->> 'v118')::boolean, 'servidor avisa que é a v11.8');
select t_ok(jsonb_array_length(public.prop_markets(public.q8ev()) -> 'athletes') = 7, 'lista dos 7 confirmados cadastrados para escolher no Duelo');
reset role;
select t_ok(public.q8m('P1', 'ou', 'goals') is not null and public.q8m('P1', 'exact', 'goals') is not null,
  'quem nunca marcou também tem Mais/Menos e cravada de gols');
select t_ok((select count(*) = 7 from public.prop_markets where event_id = public.q8ev() and kind = 'ou' and metric = 'wins'), 'jogos ganhos para todos (goleiro também)');
select t_ok(public.q8m('K1', 'ou', 'saves') is not null and public.q8m('K1', 'ou', 'goals') is null, 'goleiro: defesas sim, gols só com chance > 0');
select t_ok((select count(*) = 3 from public.prop_markets where event_id = public.q8ev() and kind = 'leader') and
  exists (select 1 from public.prop_markets where event_id = public.q8ev() and kind = 'leader' and metric = 'mvp'),
  'destaque: Artilheiro, Garçom e MVP (Paredão só com 2 goleiros)');
select t_ok((select count(*) = 2 from public.prop_markets where event_id = public.q8ev() and kind = 'baba_total'), 'total do baba: partidas e gols');
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000008a3';
select t_ok((select jsonb_array_length(m -> 'ladder') = 21 from jsonb_array_elements(public.prop_markets(public.q8ev()) -> 'markets') m
  where m ->> 'kind' = 'baba_total' and m ->> 'metric' = 'matches'), 'total de partidas: escada de 0,5 a 20,5');
select t_ok((select jsonb_array_length(m -> 'ladder') = 61 from jsonb_array_elements(public.prop_markets(public.q8ev()) -> 'markets') m
  where m ->> 'kind' = 'baba_total' and m ->> 'metric' = 'goals'), 'total de gols: escada de 0,5 a 60,5');

-- ---- palpites por atleta ----
select t_err(format('select public.place_prop_bet(%L, %L, 10, 2.5)', public.q8m('P1', 'ou', 'goals'), 'menos'), 'too_likely', 'lado quase certo trava');
select t_ok((select odd = 20 from public.place_prop_bet(public.q8m('P1', 'ou', 'goals'), 'mais', 10, 10.5)), 'zebra na linha 10,5 aceita, cotação 20');
select t_err(format('select public.place_prop_bet(%L, %L, 10, 11.5)', public.q8m('P3', 'ou', 'goals'), 'mais'), 'bad_line', 'linha fora da escada');
select t_err(format('select public.place_prop_bet(%L, %L, 10, 0.5)', public.q8m('P3', 'ou', 'wins'), 'mais'), 'too_likely', 'jogos ganhos: Mais 0,5 de quem ganha muito trava');
select t_ok((select odd > 1 from public.place_prop_bet(public.q8m('P3', 'ou', 'wins'), 'menos', 20, 4.5)), 'palpite em jogos ganhos (Menos 4,5)');
set request.uid = '00000000-0000-0000-0000-0000000008a2';   -- Bia = P2
select t_err(format('select public.place_prop_bet(%L, %L, 10, 5.5)', public.q8m('P2', 'ou', 'goals'), 'menos'), 'self_under', 'Menos em si mesmo continua bloqueado');
select t_err(format('select public.place_prop_bet(%L, %L, 10)', public.q8m('P2', 'exact', 'goals'), '0'), 'self_exact', 'cravada em si mesmo continua bloqueada');

-- ---- duelo por escolha ----
set request.uid = '00000000-0000-0000-0000-0000000008a3';
select t_ok((public.prop_duel_open(public.q8ev(), public.q8pid('P3'), public.q8pid('P4'), 'goals') ->> 'market_id')
          = (public.prop_duel_open(public.q8ev(), public.q8pid('P4'), public.q8pid('P3'), 'goals') ->> 'market_id'), 'mesmo par, mesmo duelo (em qualquer ordem)');
select t_ok((public.prop_duel_open(public.q8ev(), public.q8pid('P3'), public.q8pid('P4'), 'assists') ->> 'market_id')
          <> (public.prop_duel_open(public.q8ev(), public.q8pid('P3'), public.q8pid('P4'), 'goals') ->> 'market_id'), 'critério diferente, duelo diferente');
select t_ok((select odd = 1.80 from public.place_prop_bet((public.prop_duel_open(public.q8ev(), public.q8pid('P3'), public.q8pid('P4'), 'goals') ->> 'market_id')::uuid,
  public.q8pid('P3')::text, 50)), 'duelo equilibrado paga 1,80');
select t_err(format('select public.prop_duel_open(%L, %L, %L, %L)', public.q8ev(), public.q8pid('P3'), public.q8pid('P4'), 'saves'), 'bad_metric', 'critério só gols, assistências ou G+A');
select t_err(format('select public.prop_duel_open(%L, %L, %L, %L)', public.q8ev(), public.q8pid('P3'), public.q8pid('P3'), 'goals'), 'bad_pair', 'atleta contra ele mesmo não');
select t_err(format('select public.prop_duel_open(%L, %L, %L, %L)', public.q8ev(), public.q8pid('P3'), public.q8pid('Fora da lista'), 'goals'), 'not_confirmed', 'só confirmados');
select t_err(format('select public.place_prop_bet(%L, %L, 10)', public.prop_duel_open(public.q8ev(), public.q8pid('P3'), public.q8pid('P1'), 'goals') ->> 'market_id', public.q8pid('P3')),
  'too_likely', 'favorito quase certo no duelo trava');
select t_ok((select odd = 20 from public.place_prop_bet((public.prop_duel_open(public.q8ev(), public.q8pid('P3'), public.q8pid('P1'), 'goals') ->> 'market_id')::uuid,
  public.q8pid('P1')::text, 10)), 'zebra no duelo paga até 20x');
set request.uid = '00000000-0000-0000-0000-0000000008a2';   -- Bia = P2
select t_err(format('select public.place_prop_bet(%L, %L, 10)', public.prop_duel_open(public.q8ev(), public.q8pid('P2'), public.q8pid('P5'), 'ga') ->> 'market_id', public.q8pid('P5')),
  'self_against', 'não dá para palpitar contra si mesmo no duelo');

-- ---- destaque e total ----
set request.uid = '00000000-0000-0000-0000-0000000008a3';
select t_ok((select odd > 1 from public.place_prop_bet(public.q8m(null, 'leader', 'mvp'), public.q8pid('P4')::text, 30)), 'palpite no MVP');
select t_err(format('select public.place_prop_bet(%L, %L, 10, 3.5)', public.q8m(null, 'baba_total', 'matches'), 'mais'), 'too_likely', 'total: lado quase certo trava');
select t_ok((select odd > 1 from public.place_prop_bet(public.q8m(null, 'baba_total', 'matches'), 'menos', 40, 7.5)), 'total: escolhe a linha (Menos 7,5 partidas)');
select t_ok((public.q8bet(public.q8m(null, 'baba_total', 'matches'), '00000000-0000-0000-0000-0000000008a3') ->> 'line')::numeric = 7.5,
  'a linha escolhida fica no palpite');
select t_ok((select odd > 1 from public.place_prop_bet(public.q8m(null, 'baba_total', 'goals'), 'mais', 10, 45.5)), 'total de gols: linha alta aceita');

-- ---- ver meus palpites ----
select t_ok(jsonb_array_length(public.my_prop_bets(60)) = 7, 'Ver meus palpites traz os 7 palpites da Eli');
select t_ok(exists (select 1 from jsonb_array_elements(public.my_prop_bets(60)) x where x ->> 'label' = 'P1 · Mais 10,5 gols'), 'texto: Mais/Menos com linha e métrica');
select t_ok(exists (select 1 from jsonb_array_elements(public.my_prop_bets(60)) x where x ->> 'label' = 'Duelo P3 x P4 (gols) · P3'), 'texto: duelo com critério');
select t_ok(exists (select 1 from jsonb_array_elements(public.my_prop_bets(60)) x where x ->> 'label' = 'MVP · P4'), 'texto: MVP');
select t_ok(exists (select 1 from jsonb_array_elements(public.my_prop_bets(60)) x where x ->> 'label' = 'Partidas no dia · Menos 7,5'), 'texto: total com a linha escolhida');

-- ---- liquidação ----
reset role;
set request.uid = '00000000-0000-0000-0000-0000000008a1';
insert into public.babas (id, created_by, turma_ids, title, played_on, finished, matches, state, event_id)
values ('f8200000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008a1', array['f8000000-0000-0000-0000-000000000001'::uuid], 'Oito FC', current_date, true, 7,
        '{}'::jsonb, public.q8ev());
-- P3: 2 gols, 1 passe, 3 vitórias; P4: 1 gol, 2 passes, 4 vitórias (MVP 7); P1: 0; Total: 7 partidas, gols = 2+1+1+1+1+1 = 7.
insert into public.baba_stats (baba_id, turma_player_id, name, goals, assists, saves, matches, wins)
  select 'f8200000-0000-0000-0000-000000000001', tp.id, tp.name,
         case tp.name when 'P3' then 2 when 'P1' then 0 when 'K1' then 0 else 1 end,
         case tp.name when 'P3' then 1 when 'P4' then 2 else 0 end,
         case tp.name when 'K1' then 5 else 0 end, 4,
         case tp.name when 'P3' then 3 when 'P4' then 4 else 1 end
  from public.turma_players tp where tp.turma_id = 'f8000000-0000-0000-0000-000000000001' and tp.name <> 'Fora da lista';
select t_ok((public.q8bet(public.q8m('P1', 'ou', 'goals'), '00000000-0000-0000-0000-0000000008a3') ->> 'status') = 'lost', 'zebra perdeu');
select t_ok((public.q8bet(public.q8m('P3', 'ou', 'wins'), '00000000-0000-0000-0000-0000000008a3') ->> 'status') = 'won', 'Menos 4,5 jogos ganhos (3) ganhou');
select t_ok((select b.status = 'won' from public.prop_bets b join public.prop_markets m on m.id = b.market_id
  where m.event_id = public.q8ev() and m.kind = 'duel' and m.metric = 'goals' and b.selection = public.q8pid('P3')::text), 'duelo de gols: P3 (2) ganhou de P4 (1)');
select t_ok((select b.status = 'lost' from public.prop_bets b join public.prop_markets m on m.id = b.market_id
  where m.event_id = public.q8ev() and m.kind = 'duel' and b.selection = public.q8pid('P1')::text), 'zebra do duelo perdeu');
select t_ok((public.q8bet(public.q8m(null, 'leader', 'mvp'), '00000000-0000-0000-0000-0000000008a3') ->> 'status') = 'won', 'MVP = G+A+jogos ganhos (P4 com 7)');
select t_ok((public.q8bet(public.q8m(null, 'baba_total', 'matches'), '00000000-0000-0000-0000-0000000008a3') ->> 'status') = 'won', 'total de partidas pela linha do palpite (7 < 7,5)');
select t_ok((public.q8bet(public.q8m(null, 'baba_total', 'goals'), '00000000-0000-0000-0000-0000000008a3') ->> 'status') = 'lost', 'total de gols pela linha do palpite (7 < 45,5)');
select t_ok(not exists (select 1 from jsonb_array_elements(public.my_prop_bets(60)) x where x ->> 'status' = 'open'), 'meus palpites mostram o resultado');

-- ---- baba sem partidas anula o Total ----
create temp table ev8b (id uuid);
grant all on ev8b to public;
insert into ev8b values (gen_random_uuid());
insert into public.turma_events (id, turma_id, created_by, starts_at, place)
  select id, 'f8000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008a1',
         least(now() + interval '6 hours', date_trunc('day', now()) + interval '23 hours 59 minutes'), 'Quadra 2' from ev8b;
insert into public.event_rsvps (event_id, player_key, name, turma_player_id, status)
  select ev8b.id, lower(tp.name), tp.name, tp.id, 'vou' from ev8b, public.turma_players tp
  where tp.turma_id = 'f8000000-0000-0000-0000-000000000001' and tp.name <> 'Fora da lista';
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000008a3';
select public.prop_markets((select id from ev8b));
select public.place_prop_bet(public.q8mev((select id from ev8b), 'baba_total', 'matches'), 'menos', 50, 0.5);
reset role;
set request.uid = '00000000-0000-0000-0000-0000000008a1';
insert into public.babas (id, created_by, turma_ids, title, played_on, finished, matches, state, event_id)
values ('f8200000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000008a1', array['f8000000-0000-0000-0000-000000000001'::uuid], 'Oito FC', current_date, true, 0,
        '{}'::jsonb, (select id from ev8b));
insert into public.baba_stats (baba_id, turma_player_id, name, goals, assists, saves, matches, wins)
  values ('f8200000-0000-0000-0000-000000000002', public.q8pid('P3'), 'P3', 0, 0, 0, 0, 0);
select t_ok((select b.status = 'void' and b.payout = 50 from public.prop_bets b join public.prop_markets m on m.id = b.market_id
  where m.event_id = (select id from ev8b) and m.kind = 'baba_total'), 'baba finalizado sem partidas: Menos 0,5 não ganha, é devolvido');
reset request.uid;
select 1 as v11_8_rules_done;
