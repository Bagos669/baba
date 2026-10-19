-- Rule tests for v11.4.1 (linhas livres, sem cravada em si mesmo, valor até o saldo). Roda depois do v11_4_1_palpites_livres.sql. Procure por "FAIL".
\set QUIET on
reset role;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000004b1', 'admb@t'), ('00000000-0000-0000-0000-0000000004b2', 'biab@t'), ('00000000-0000-0000-0000-0000000004b3', 'menorb@t'),
  ('00000000-0000-0000-0000-0000000004b4', 'forab@t'), ('00000000-0000-0000-0000-0000000004b5', 'elib@t'), ('00000000-0000-0000-0000-0000000004b6', 'pobreb@t');
insert into public.profiles (id, name) values
  ('00000000-0000-0000-0000-0000000004b1', 'Adm'), ('00000000-0000-0000-0000-0000000004b2', 'Bia'), ('00000000-0000-0000-0000-0000000004b3', 'Menor'),
  ('00000000-0000-0000-0000-0000000004b4', 'Fora'), ('00000000-0000-0000-0000-0000000004b5', 'Eli'), ('00000000-0000-0000-0000-0000000004b6', 'Pobre');
insert into public.account_private (user_id, birth_date) values
  ('00000000-0000-0000-0000-0000000004b1', current_date - interval '30 years'), ('00000000-0000-0000-0000-0000000004b2', current_date - interval '30 years'),
  ('00000000-0000-0000-0000-0000000004b3', current_date - interval '17 years'), ('00000000-0000-0000-0000-0000000004b4', current_date - interval '30 years'),
  ('00000000-0000-0000-0000-0000000004b5', current_date - interval '30 years'), ('00000000-0000-0000-0000-0000000004b6', current_date - interval '30 years');
insert into public.turmas (id, name, created_by, owner_id, invite_code) values
  ('f3000000-0000-0000-0000-000000000001', 'Pre FC 2', '00000000-0000-0000-0000-0000000004b1', '00000000-0000-0000-0000-0000000004b1', 'PREFC003');
insert into public.turma_members values
  ('f3000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b1', 'admin', now()),
  ('f3000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b2', 'member', now()),
  ('f3000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b3', 'member', now()),
  ('f3000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b5', 'member', now()),
  ('f3000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b6', 'member', now());
-- 7 atletas de linha (P1..P7; P2 é a conta do Eli), 1 goleiro (K1), 1 estreante (R). Convidado sem cadastro não tem turma_player.
insert into public.turma_players (id, turma_id, name, is_goalkeeper, user_id)
  select ('f3000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid, 'f3000000-0000-0000-0000-000000000001', 'P' || g, false,
         case when g = 2 then '00000000-0000-0000-0000-0000000004b5'::uuid end from generate_series(1, 7) g;
insert into public.turma_players (id, turma_id, name, is_goalkeeper) values
  ('f3000000-0000-0000-0000-0000000000b1', 'f3000000-0000-0000-0000-000000000001', 'K1', true),
  ('f3000000-0000-0000-0000-0000000000c1', 'f3000000-0000-0000-0000-000000000001', 'R', false);
-- Histórico: 10 babas finalizados. Todo mundo faz 3 gols, 1 assistência em 5 jogos; o goleiro, 6 defesas em 5 jogos. Cada baba teve 3 partidas.
create temp table hb2 (n integer, id uuid);
grant all on hb2 to public;
insert into hb2 select g, gen_random_uuid() from generate_series(1, 10) g;
insert into public.babas (id, created_by, turma_ids, title, played_on, finished, matches)
  select id, '00000000-0000-0000-0000-0000000004b1', array['f3000000-0000-0000-0000-000000000001'::uuid], 'h' || n, current_date - (n * 7), true, 3 from hb2;
insert into public.baba_stats (baba_id, turma_player_id, name, goals, assists, saves, matches, wins)
  select hb2.id, tp.id, tp.name, 3, 1, 0, 5, 2 from hb2 join public.turma_players tp on tp.turma_id = 'f3000000-0000-0000-0000-000000000001' and tp.name like 'P%';
insert into public.baba_stats (baba_id, turma_player_id, name, goals, assists, saves, matches, wins)
  select hb2.id, 'f3000000-0000-0000-0000-0000000000b1', 'K1', 0, 0, 6, 5, 2 from hb2;
-- Lista de hoje à noite: 10 confirmados (7 da turma + goleiro + estreante + 1 convidado).
create temp table evs (k text, id uuid);
grant all on evs to public;
insert into evs values ('main', gen_random_uuid()), ('few', gen_random_uuid()), ('cancel', gen_random_uuid()), ('stale', gen_random_uuid());
insert into public.turma_events (id, turma_id, created_by, starts_at, place)
  select id, 'f3000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b1', now() + interval '6 hours', k from evs;
insert into public.event_rsvps (event_id, player_key, name, turma_player_id, status)
  select (select id from evs where k = 'main'), lower(tp.name), tp.name, tp.id, 'vou' from public.turma_players tp where tp.turma_id = 'f3000000-0000-0000-0000-000000000001';
insert into public.event_rsvps (event_id, player_key, name, status) values ((select id from evs where k = 'main'), 'convidado', 'Convidado', 'vou');
-- 'few' tem só 3 confirmados
insert into public.event_rsvps (event_id, player_key, name, turma_player_id, status)
  select (select id from evs where k = 'few'), lower(name), name, id, 'vou' from public.turma_players where turma_id = 'f3000000-0000-0000-0000-000000000001' and name in ('P1', 'P3', 'K1');
-- 'cancel' e 'stale' repetem a lista principal
insert into public.event_rsvps (event_id, player_key, name, turma_player_id, status)
  select e.id, r.player_key, r.name, r.turma_player_id, r.status from evs e, public.event_rsvps r
  where e.k in ('cancel', 'stale') and r.event_id = (select id from evs where k = 'main');

create or replace function public.pm(p_ev text, p_pn text, p_metric text, p_kind text default 'ou') returns jsonb language sql security definer as $$
  select to_jsonb(m) from public.prop_markets m join public.turma_players tp on tp.id = m.player_id
  where m.event_id = (select e2.id from evs e2 where e2.k = p_ev) and tp.name = p_pn and m.metric = p_metric and m.kind = p_kind $$;
create or replace function public.pmid(p_ev text, p_pn text, p_metric text, p_kind text default 'ou') returns uuid language sql security definer as $$
  select (public.pm(p_ev, p_pn, p_metric, p_kind) ->> 'id')::uuid $$;
create or replace function public.sel_odd(m jsonb, k text) returns numeric language sql immutable as $$
  select (x ->> 'odd')::numeric from jsonb_array_elements(m -> 'selections') x where x ->> 'key' = k $$;
create or replace function public.bal(u text) returns integer language sql security definer as $$ select balance from public.wallets where user_id = u::uuid $$;
create or replace function public.evid(p_k text) returns uuid language sql security definer as $$ select e2.id from evs e2 where e2.k = p_k $$;
grant execute on function public.pm(text, text, text, text), public.pmid(text, text, text, text), public.sel_odd(jsonb, text), public.bal(text), public.evid(text) to authenticated;
-- quem ainda não pegou o bônus de boas-vindas pega agora (1000 pontos)
select private.add_points(u, 1000, 'boas-vindas', null) from unnest(array['00000000-0000-0000-0000-0000000004b1', '00000000-0000-0000-0000-0000000004b2', '00000000-0000-0000-0000-0000000004b3',
  '00000000-0000-0000-0000-0000000004b4', '00000000-0000-0000-0000-0000000004b5', '00000000-0000-0000-0000-0000000004b6']::uuid[]) u;
select private.add_points('00000000-0000-0000-0000-0000000004b6', -995, 'teste', null);

-- ---- escada de linhas ----
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000004b2';
reset role;
select t_ok(jsonb_array_length(private.prop_ladder(1.8)) = 4, 'λ 1,8: escada de 0,5 a 3,5 (4,5 e 5,5 saem por ficarem fora de 5%-85%)') ;
set role authenticated;
select t_ok(jsonb_array_length((select x -> 'ladder' from jsonb_array_elements(public.prop_markets(public.evid('main')) -> 'markets') x where x ->> 'id' = public.pmid('main', 'P1', 'goals')::text)) = 4, 'prop_markets entrega a escada do mercado');
select t_ok((select (x -> 'ladder' -> 2 -> 'mais' ->> 'odd')::numeric = 3.34 and (x -> 'ladder' -> 2 ->> 'line')::numeric = 2.5 from jsonb_array_elements(public.prop_markets(public.evid('main')) -> 'markets') x where x ->> 'id' = public.pmid('main', 'P1', 'goals')::text), 'linha 2,5: Mais paga 3,34 (calculado no servidor)');
reset role;
select t_ok(not (private.prop_ladder(1.8) -> 3 -> 'menos' ->> 'ok')::boolean and (private.prop_ladder(1.8) -> 0 -> 'mais' ->> 'ok')::boolean, 'lado quase certo (Menos 3,5) não é oferecido; Mais 0,5 é');
select t_ok(not exists (select 1 from jsonb_array_elements(private.prop_ladder(1.8)) x where (x -> 'mais' ->> 'ok')::boolean and (x -> 'mais' ->> 'odd')::numeric < 1.06), 'nenhuma cotação de graça (< 1,06) é oferecida');

-- ---- palpite na linha que o palpitador escolhe ----
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000004b2';
select t_ok((select odd from public.place_prop_bet(public.pmid('main', 'P1', 'goals'), 'mais', 200, 2.5)) = 3.34 and public.bal('00000000-0000-0000-0000-0000000004b2') = 800, 'Bia escolhe Mais 2,5 (3,34) com 200: saldo cai na hora');
select t_ok((select (x -> 'bet' ->> 'line')::numeric = 2.5 and (x -> 'bet' ->> 'odd')::numeric = 3.34 from jsonb_array_elements(public.prop_markets(public.evid('main')) -> 'markets') x where x ->> 'id' = public.pmid('main', 'P1', 'goals')::text), 'meu palpite guarda a linha e a cotação travada');
select t_err(format('select public.place_prop_bet(%L, %L, 10, 1.5)', public.pmid('main', 'P1', 'goals'), 'menos'), 'already_bet', 'segue um palpite por mercado (não dá para cobrir os dois lados)');
select t_err(format('select public.place_prop_bet(%L, %L, 10, 5.5)', public.pmid('main', 'P4', 'goals'), 'mais'), 'bad_line', 'linha fora da escada');
select t_err(format('select public.place_prop_bet(%L, %L, 10, 1.7)', public.pmid('main', 'P4', 'goals'), 'mais'), 'bad_line', 'linha que não é de meio ponto');
select t_err(format('select public.place_prop_bet(%L, %L, 10, 3.5)', public.pmid('main', 'P4', 'goals'), 'menos'), 'bad_line', 'lado quase certo não abre');
select t_err(format('select public.place_prop_bet(%L, %L, 5, 1.5)', public.pmid('main', 'P4', 'goals'), 'mais'), 'bad_stake', 'mínimo é 10');
select t_err(format('select public.place_prop_bet(%L, %L, 801, 1.5)', public.pmid('main', 'P4', 'goals'), 'mais'), 'no_points', 'mais que o saldo: sem pontos');
select t_ok(public.bal('00000000-0000-0000-0000-0000000004b2') = 800, 'palpite recusado não mexe no saldo');
select t_ok((select balance from public.place_prop_bet(public.pmid('main', 'P4', 'goals'), 'menos', 800, 1.5)) = 0, 'dá para jogar o saldo todo (800) de uma vez, sem teto de 100/300');

-- ---- cravada em si mesmo ----
set request.uid = '00000000-0000-0000-0000-0000000004b5';
select t_err(format('select public.place_prop_bet(%L, %L, 10)', public.pmid('main', 'P2', 'goals', 'exact'), '1'), 'self_exact', 'cravada de gols em si mesmo: recusada');
select t_err(format('select public.place_prop_bet(%L, %L, 10, 1.5)', public.pmid('main', 'P2', 'goals'), 'menos'), 'self_under', 'Menos em si mesmo segue recusado');
select t_ok((select bet_id from public.place_prop_bet(public.pmid('main', 'P2', 'goals'), 'mais', 10, 0.5)) is not null, 'Mais em si mesmo segue liberado');
select t_ok((select bet_id from public.place_prop_bet(public.pmid('main', 'P3', 'goals', 'exact'), '3', 50)) is not null, 'cravada nos outros segue liberada');
select t_ok((select odd from public.place_prop_bet(public.pmid('main', 'P5', 'goals'), 'mais', 10)) = 1.68, 'chamada sem linha usa a linha padrão do mercado (1,5)');
select t_ok((select bet_id from public.place_prop_bet(public.pmid('main', 'R', 'goals'), 'mais', 100, 1.5)) is not null, 'estreante: sem teto de 25');
select t_ok((select bet_id from public.place_prop_bet(public.pmid('main', 'P6', 'goals'), 'menos', 10, 2.5)) is not null, 'Menos 2,5 em outro atleta');
select t_ok((select bet_id from public.place_prop_bet(public.pmid('main', 'P7', 'goals'), 'mais', 20, 0.5)) is not null, 'Mais 0,5 (cotação baixa) para testar o reembolso');

-- ---- suspender reembolsa palpite de qualquer linha ----
set request.uid = '00000000-0000-0000-0000-0000000004b1';
select public.suspend_prop_market(public.pmid('main', 'P7', 'goals'));
reset role;
select t_ok((select count(*) = 1 from public.points_ledger where user_id = '00000000-0000-0000-0000-0000000004b5' and reason = 'palpite-pre-devolvido' and delta = 20), 'Suspender devolve os 20 pontos');
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000004b1';
select t_ok((public.prop_event_bets(public.evid('main')) -> 0 ->> 'line') is not null, 'extrato do adm mostra a linha do palpite');

-- ---- liquidação por linha escolhida ----
reset role;
insert into public.babas (id, created_by, turma_ids, title, played_on, finished, matches, state, event_id)
  values ('f3000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b1', array['f3000000-0000-0000-0000-000000000001'::uuid], 'hoje', current_date, false, 0, '{}'::jsonb, public.evid('main'));
update public.babas set finished = true, matches = 4 where id = 'f3000000-0000-0000-0000-000000000001';
-- P1 faz 3, P3 faz 3, P4 faz 2, P5 faz 0, P6 faz 2, P2 faz 0, R faz 1
insert into public.baba_stats (baba_id, turma_player_id, name, goals, assists, saves, matches, wins)
  select 'f3000000-0000-0000-0000-000000000001', id, name,
    case name when 'P1' then 3 when 'P3' then 3 when 'P4' then 2 when 'P6' then 2 when 'R' then 1 else 0 end, 0, 0, 4, 1
  from public.turma_players where turma_id = 'f3000000-0000-0000-0000-000000000001' and name in ('P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'R');
insert into public.baba_stats (baba_id, turma_player_id, name, goals, assists, saves, matches, wins)
  values ('f3000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-0000000000b1', 'K1', 0, 0, 5, 4, 1);
select t_ok((select status = 'won' and payout = 668 from public.prop_bets where market_id = public.pmid('main', 'P1', 'goals') and user_id = '00000000-0000-0000-0000-0000000004b2'), 'Mais 2,5 com 3 gols ganhou: 200 x 3,34 = 668 (a linha escolhida decide, não a padrão)');
select t_ok((select status = 'lost' and payout = 0 from public.prop_bets where market_id = public.pmid('main', 'P4', 'goals') and user_id = '00000000-0000-0000-0000-0000000004b2'), 'Menos 1,5 com 2 gols perdeu');
select t_ok((select status = 'won' and payout = 280 from public.prop_bets where market_id = public.pmid('main', 'P3', 'goals', 'exact') and user_id = '00000000-0000-0000-0000-0000000004b5'), 'cravada em 3 ganhou: 50 x 5,60 = 280');
select t_ok((select status = 'lost' from public.prop_bets where market_id = public.pmid('main', 'P5', 'goals') and user_id = '00000000-0000-0000-0000-0000000004b5'), 'Mais 1,5 com 0 gols perdeu');
select t_ok((select status = 'won' and payout = floor(10 * odd) from public.prop_bets where market_id = public.pmid('main', 'P6', 'goals') and user_id = '00000000-0000-0000-0000-0000000004b5'), 'Menos 2,5 com 2 gols ganhou');
select t_ok((select status = 'lost' from public.prop_bets where market_id = public.pmid('main', 'R', 'goals') and user_id = '00000000-0000-0000-0000-0000000004b5'), 'estreante: Mais 1,5 com 1 gol perdeu');
select t_ok((select status = 'won' from public.prop_bets where market_id = public.pmid('main', 'P2', 'goals') and user_id = '00000000-0000-0000-0000-0000000004b5') is not true, 'Mais 0,5 em si mesmo com 0 gols: perdeu');
select t_ok(public.bal('00000000-0000-0000-0000-0000000004b2') = 668, 'saldo da Bia: 0 + 668');

-- ---- correção de stats com linha escolhida: P1 passa a 2 gols (Mais 2,5 perde) ----
update public.baba_stats set goals = 2 where baba_id = 'f3000000-0000-0000-0000-000000000001' and name = 'P1';
select t_ok((select status = 'lost' and payout = 0 from public.prop_bets where market_id = public.pmid('main', 'P1', 'goals') and user_id = '00000000-0000-0000-0000-0000000004b2'), 'correção: com 2 gols o Mais 2,5 passa a perder');
select t_ok(public.bal('00000000-0000-0000-0000-0000000004b2') = 0, 'e o crédito de 668 foi revertido (saldo 0)');

-- ---- invariante ----
select t_ok(not exists (select 1 from public.wallets w where w.user_id::text like '00000000-0000-0000-0000-0000000004b%'
  and w.balance <> coalesce((select sum(l.delta) from public.points_ledger l where l.user_id = w.user_id), 0)), 'soma do extrato = saldo');
