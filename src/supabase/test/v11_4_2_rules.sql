-- Rule tests for v11.4.2 (avisos no celular: lista aberta, véspera sem resposta, palpites liquidados).
-- Roda depois do v11_4_2_avisos.sql. Procure por "FAIL".
\set QUIET on
reset role;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000004d1', 'admc@t'), ('00000000-0000-0000-0000-0000000004d2', 'biac@t'), ('00000000-0000-0000-0000-0000000004d3', 'caioc@t'),
  ('00000000-0000-0000-0000-0000000004d4', 'dudac@t'), ('00000000-0000-0000-0000-0000000004d5', 'elic@t'), ('00000000-0000-0000-0000-0000000004d6', 'forac@t'),
  ('00000000-0000-0000-0000-0000000004d7', 'zec@t');
-- Caio desligou "Lista aberta"; Eli desligou "Lembrete de resposta" e "Palpites liquidados". Os outros não mexeram (ligado por padrão).
insert into public.profiles (id, name, prefs) values
  ('00000000-0000-0000-0000-0000000004d1', 'Adm', '{}'), ('00000000-0000-0000-0000-0000000004d2', 'Bia', '{}'),
  ('00000000-0000-0000-0000-0000000004d3', 'Caio', '{"avisoLista": false}'), ('00000000-0000-0000-0000-0000000004d4', 'Duda', '{}'),
  ('00000000-0000-0000-0000-0000000004d5', 'Eli', '{"avisoLembrete": false, "avisoPalpites": false}'), ('00000000-0000-0000-0000-0000000004d6', 'Fora', '{}'),
  ('00000000-0000-0000-0000-0000000004d7', 'Zé', '{"avisoLista": true}');
insert into public.turmas (id, name, created_by, owner_id, invite_code) values
  ('f4000000-0000-0000-0000-000000000001', 'Avisos FC', '00000000-0000-0000-0000-0000000004d1', '00000000-0000-0000-0000-0000000004d1', 'AVISOS01');
insert into public.turma_members values
  ('f4000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004d1', 'admin', now()),
  ('f4000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004d2', 'member', now()),
  ('f4000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004d3', 'member', now()),
  ('f4000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004d4', 'member', now()),
  ('f4000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004d5', 'member', now()),
  ('f4000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004d7', 'member', now());
-- Inscrições de push: todo mundo menos a Duda (sem push). Fora não é da turma.
insert into public.push_subs (endpoint, p256dh, auth, user_id) values
  ('https://push.t/d1', 'k', 'a', '00000000-0000-0000-0000-0000000004d1'), ('https://push.t/d2', 'k', 'a', '00000000-0000-0000-0000-0000000004d2'),
  ('https://push.t/d3', 'k', 'a', '00000000-0000-0000-0000-0000000004d3'), ('https://push.t/d5', 'k', 'a', '00000000-0000-0000-0000-0000000004d5'),
  ('https://push.t/d6', 'k', 'a', '00000000-0000-0000-0000-0000000004d6'), ('https://push.t/d7', 'k', 'a', '00000000-0000-0000-0000-0000000004d7'),
  ('https://push.t/d7b', 'k', 'a', '00000000-0000-0000-0000-0000000004d7');
-- Atletas: P1..P4; o P2 é a conta da Bia, o P5 é a conta do Zé (responde pelo vínculo, não pelo user_id da resposta).
insert into public.turma_players (id, turma_id, name, user_id) values
  ('f4000000-0000-0000-0000-0000000000a1', 'f4000000-0000-0000-0000-000000000001', 'P1', null),
  ('f4000000-0000-0000-0000-0000000000a2', 'f4000000-0000-0000-0000-000000000001', 'P2', '00000000-0000-0000-0000-0000000004d2'),
  ('f4000000-0000-0000-0000-0000000000a3', 'f4000000-0000-0000-0000-000000000001', 'P3', null),
  ('f4000000-0000-0000-0000-0000000000a4', 'f4000000-0000-0000-0000-000000000001', 'P4', null),
  ('f4000000-0000-0000-0000-0000000000a5', 'f4000000-0000-0000-0000-000000000001', 'Zé Maria', '00000000-0000-0000-0000-0000000004d7');

create or replace function public.avc(agora text, tp text, ev text) returns table (user_id text, title text, body text) language sql security definer as $$
  select c.user_id::text, c.title, c.body from private.avisos_candidatos(agora::timestamptz) c where c.tipo = tp and c.event_id = ev::uuid order by c.user_id $$;
create or replace function public.avusers(agora text, tp text, ev text) returns text language sql security definer as $$
  select coalesce(string_agg(right(user_id, 1), ',' order by user_id), '') from public.avc(agora, tp, ev) $$;
grant execute on function public.avc(text, text, text), public.avusers(text, text, text) to authenticated;

-- 2030-06-15 é um sábado.
select t_ok(private.aviso_dia('2030-06-15 20:00-03') = 'sábado' and private.aviso_dia('2030-06-16 01:00+00') = 'sábado', 'dia da semana vem do fuso de Brasília (domingo 01:00 UTC ainda é sábado)');

-- ============ 1) Lista aberta ============
insert into public.turma_events (id, turma_id, created_by, created_at, starts_at, place) values
  ('e4000000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004d1', '2030-06-01 10:00-03', '2030-06-15 20:00-03', 'Quadra 3');
select t_ok(public.avusers('2030-06-01 10:05-03', 'lista', 'e4000000-0000-0000-0000-000000000001') = '2,5,7', 'lista aberta: Bia, Eli e Zé; não vai para quem criou (Adm), quem desligou (Caio), quem não tem push (Duda) nem quem não é da turma (Fora)');
select t_ok((select title from public.avc('2030-06-01 10:05-03', 'lista', 'e4000000-0000-0000-0000-000000000001') limit 1) = 'Lista de sábado aberta. Vai?', 'lista aberta sem confirmados: "Lista de sábado aberta. Vai?"');
select t_ok((select body from public.avc('2030-06-01 10:05-03', 'lista', 'e4000000-0000-0000-0000-000000000001') limit 1) = 'Avisos FC · Quadra 3', 'o corpo traz a turma e o local');
select t_ok(public.avusers('2030-06-01 10:31-03', 'lista', 'e4000000-0000-0000-0000-000000000001') = '', 'lista aberta só sai nos 30 minutos depois de puxar (evento velho não dispara)');
insert into public.event_rsvps (event_id, player_key, name, status) values ('e4000000-0000-0000-0000-000000000001', 'convidado', 'Convidado', 'vou');
select t_ok((select title from public.avc('2030-06-01 10:05-03', 'lista', 'e4000000-0000-0000-0000-000000000001') limit 1) = 'Lista de sábado aberta: 1 confirmado', 'com 1 confirmado: "aberta: 1 confirmado"');
insert into public.event_rsvps (event_id, player_key, name, status) values ('e4000000-0000-0000-0000-000000000001', 'outro', 'Outro', 'vou'), ('e4000000-0000-0000-0000-000000000001', 'talvez', 'Talvez', 'talvez');
select t_ok((select title from public.avc('2030-06-01 10:05-03', 'lista', 'e4000000-0000-0000-0000-000000000001') limit 1) = 'Lista de sábado aberta: 2 confirmados', 'com 2 confirmados: "aberta: 2 confirmados" (Talvez não conta)');
update public.turma_events set status = 'canceled' where id = 'e4000000-0000-0000-0000-000000000001';
select t_ok(public.avusers('2030-06-01 10:05-03', 'lista', 'e4000000-0000-0000-0000-000000000001') = '', 'lista cancelada na hora não avisa');
update public.turma_events set status = 'open' where id = 'e4000000-0000-0000-0000-000000000001';

-- ============ 2) Véspera sem resposta ============
insert into public.turma_events (id, turma_id, created_by, created_at, starts_at) values
  ('e4000000-0000-0000-0000-000000000002', 'f4000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004d1', '2030-06-01 10:00-03', '2030-06-15 20:00-03'),
  ('e4000000-0000-0000-0000-000000000003', 'f4000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004d1', '2030-06-01 10:00-03', '2030-06-15 20:00-03'),
  ('e4000000-0000-0000-0000-000000000004', 'f4000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004d1', '2030-06-14 21:00-03', '2030-06-15 20:00-03');
update public.turma_events set status = 'canceled' where id = 'e4000000-0000-0000-0000-000000000003';
-- A Bia respondeu pelo app (user_id), o Zé foi respondido pelo adm (só o nome/vínculo), o Caio e o Adm não responderam; o Eli desligou o lembrete.
insert into public.event_rsvps (event_id, player_key, name, turma_player_id, user_id, status) values
  ('e4000000-0000-0000-0000-000000000002', 'p2', 'P2', 'f4000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000004d2', 'nao');
insert into public.event_rsvps (event_id, player_key, name, status) values ('e4000000-0000-0000-0000-000000000002', 'zé maria', 'Zé Maria', 'talvez');
select t_ok(public.avusers('2030-06-14 20:05-03', 'vespera', 'e4000000-0000-0000-0000-000000000002') = '1,3', 'véspera: só Adm e Caio, que não responderam (Bia respondeu Não vou, Zé tem Talvez pelo nome; Eli desligou; Duda sem push; Fora de fora)');
select t_ok((select title from public.avc('2030-06-14 20:05-03', 'vespera', 'e4000000-0000-0000-0000-000000000002') limit 1) = 'Sábado tem baba amanhã e você ainda não respondeu. Vai?', 'texto da véspera');
select t_ok(public.avusers('2030-06-14 19:55-03', 'vespera', 'e4000000-0000-0000-0000-000000000002') = '', 'antes de 24 h não avisa');
select t_ok(public.avusers('2030-06-15 00:30-03', 'vespera', 'e4000000-0000-0000-0000-000000000002') = '', 'já no dia do baba o texto "amanhã" não vale: não avisa');
select t_ok(public.avusers('2030-06-15 20:30-03', 'vespera', 'e4000000-0000-0000-0000-000000000002') = '', 'baba que já começou não avisa');
select t_ok(public.avusers('2030-06-14 20:05-03', 'vespera', 'e4000000-0000-0000-0000-000000000003') = '', 'evento cancelado antes das 24 h não dispara o lembrete');
select t_ok(public.avusers('2030-06-14 21:30-03', 'vespera', 'e4000000-0000-0000-0000-000000000004') = '', 'lista criada com menos de 24 h de antecedência não dispara o lembrete');
select t_ok(public.avusers('2030-06-14 21:30-03', 'vespera', 'e4000000-0000-0000-0000-000000000002') = '1,3', 'mesma hora, lista criada com antecedência: dispara normalmente');
-- Responder depois tira da lista do lembrete.
insert into public.event_rsvps (event_id, player_key, name, user_id, status) values ('e4000000-0000-0000-0000-000000000002', 'caio', 'Caio', '00000000-0000-0000-0000-0000000004d3', 'vou');
select t_ok(public.avusers('2030-06-14 20:05-03', 'vespera', 'e4000000-0000-0000-0000-000000000002') = '1', 'quem responde antes do envio sai do lembrete');

-- ============ 3) Palpites liquidados (com o motor de verdade) ============
select private.add_points(u, 1000, 'boas-vindas', null) from unnest(array['00000000-0000-0000-0000-0000000004d2', '00000000-0000-0000-0000-0000000004d3',
  '00000000-0000-0000-0000-0000000004d5', '00000000-0000-0000-0000-0000000004d7']::uuid[]) u;
insert into public.turma_events (id, turma_id, created_by, created_at, starts_at) values
  ('e4000000-0000-0000-0000-000000000007', 'f4000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004d1', now() - interval '3 days', now() - interval '2 hours');
-- 4 mercados "Mais/Menos de gols": P1 (linha 0,5), P2 (0,5), P3 (1,5), P4 (0,5, vai faltar).
insert into public.prop_markets (id, event_id, turma_id, player_id, kind, metric, line, selections, lambda, status, locked_at)
  select ('c4000000-0000-0000-0000-00000000000' || n)::uuid, 'e4000000-0000-0000-0000-000000000007', 'f4000000-0000-0000-0000-000000000001',
         ('f4000000-0000-0000-0000-0000000000a' || n)::uuid, 'ou', 'goals', case when n = 3 then 1.5 else 0.5 end, '[]'::jsonb, 1.5, 'locked', now() - interval '3 hours'
  from generate_series(1, 4) n;
create or replace function public.bet(u text, m text, sel text, ln numeric, stake integer, o numeric) returns void language plpgsql security definer as $$
declare bid bigint;
begin
  insert into public.prop_bets (market_id, user_id, selection, stake, odd, line) values (m::uuid, u::uuid, sel, stake, o, ln) returning id into bid;
  perform private.add_points(u::uuid, -stake, 'palpite-pre', bid::text);
end $$;
-- Bia: Mais 0,5 no P1 (50 a 3,00), Mais 1,5 no P3 (20 a 2,15), Mais 0,5 no P2 (10, vai perder) -> 2 de 3, +113.
select public.bet('00000000-0000-0000-0000-0000000004d2', 'c4000000-0000-0000-0000-000000000001', 'mais', 0.5, 50, 3.00);
select public.bet('00000000-0000-0000-0000-0000000004d2', 'c4000000-0000-0000-0000-000000000003', 'mais', 1.5, 20, 2.15);
select public.bet('00000000-0000-0000-0000-0000000004d2', 'c4000000-0000-0000-0000-000000000002', 'mais', 0.5, 10, 2.00);
-- Caio: Menos 0,5 no P1 (40, perde) -> 0 de 1, −40.
select public.bet('00000000-0000-0000-0000-0000000004d3', 'c4000000-0000-0000-0000-000000000001', 'menos', 0.5, 40, 1.50);
-- Eli (desligou "Palpites liquidados"): Mais 0,5 no P1 (30 a 3,00).
select public.bet('00000000-0000-0000-0000-0000000004d5', 'c4000000-0000-0000-0000-000000000001', 'mais', 0.5, 30, 3.00);
-- Zé: só no P4, que vai faltar -> devolvido.
select public.bet('00000000-0000-0000-0000-0000000004d7', 'c4000000-0000-0000-0000-000000000004', 'mais', 0.5, 30, 2.00);

select t_ok(public.avusers(now()::text, 'palpites', 'e4000000-0000-0000-0000-000000000007') = '', 'antes do baba acabar ninguém é avisado dos palpites');

-- O baba termina e os stats chegam: o servidor liquida sozinho (trigger).
insert into public.babas (id, created_by, turma_ids, title, played_on, finished, matches, event_id)
  values ('b4000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000004d1', array['f4000000-0000-0000-0000-000000000001'::uuid], 'b7', current_date, true, 3, 'e4000000-0000-0000-0000-000000000007');
insert into public.baba_stats (baba_id, turma_player_id, name, goals, assists, saves, matches, wins) values
  ('b4000000-0000-0000-0000-000000000007', 'f4000000-0000-0000-0000-0000000000a1', 'P1', 2, 0, 0, 3, 1),
  ('b4000000-0000-0000-0000-000000000007', 'f4000000-0000-0000-0000-0000000000a2', 'P2', 0, 0, 0, 3, 1),
  ('b4000000-0000-0000-0000-000000000007', 'f4000000-0000-0000-0000-0000000000a3', 'P3', 2, 0, 0, 3, 1);
select t_ok((select count(*) from public.prop_markets where event_id = 'e4000000-0000-0000-0000-000000000007' and status = 'settled') = 3
        and (select count(*) from public.prop_markets where event_id = 'e4000000-0000-0000-0000-000000000007' and status = 'void') = 1, 'o servidor liquidou 3 mercados e devolveu o do atleta que faltou');

select t_ok(public.avusers(now()::text, 'palpites', 'e4000000-0000-0000-0000-000000000007') = '2,3,7', 'palpites: Bia, Caio e Zé são avisados; Eli desligou o aviso');
select t_ok((select title from public.avc(now()::text, 'palpites', 'e4000000-0000-0000-0000-000000000007') where user_id::text like '%d2') = 'Você acertou 2 de 3 palpites: +113 pts', 'Bia: "Você acertou 2 de 3 palpites: +113 pts"');
select t_ok((select sum(delta) from public.points_ledger where user_id = '00000000-0000-0000-0000-0000000004d2' and reason in ('palpite-pre', 'palpite-pre-ganho')) = 113, 'os +113 batem com o extrato da Bia');
select t_ok((select title from public.avc(now()::text, 'palpites', 'e4000000-0000-0000-0000-000000000007') where user_id::text like '%d3') = 'Você acertou 0 de 1 palpite: −40 pts', 'Caio: lucro negativo sai como "−40 pts"');
select t_ok((select title from public.avc(now()::text, 'palpites', 'e4000000-0000-0000-0000-000000000007') where user_id::text like '%d7') = 'Seus palpites do baba de ' || private.aviso_dia(now() - interval '2 hours') || ' foram devolvidos', 'Zé: todos os palpites devolvidos -> mensagem de devolução');
select t_ok((select sum(delta) from public.points_ledger where user_id = '00000000-0000-0000-0000-0000000004d7' and reason like 'palpite-pre%') = 0, 'e a devolução do Zé fecha em zero no extrato');

-- ============ Gravar o envio: duas rodadas seguidas não duplicam ============
create temp table env1 as select tipo, event_id, endpoint from public.srv_avisos_pendentes();
select t_ok((select count(*) from env1 where tipo = 'palpites' and event_id = 'e4000000-0000-0000-0000-000000000007') = 4, 'srv_avisos_pendentes devolve os endereços: Bia, Caio, Zé (2 aparelhos)');
select t_ok((select count(*) from private.aviso_envios where tipo = 'palpites' and event_id = 'e4000000-0000-0000-0000-000000000007') = 3, 'ficou um registro de controle por pessoa (não por aparelho)');
select t_ok((select count(*) from public.srv_avisos_pendentes() where event_id = 'e4000000-0000-0000-0000-000000000007') = 0, 'rodar de novo não devolve nada (sem duplicidade)');
-- Corrigir um gol depois da liquidação: Bia passa a perder o P1 e Caio passa a ganhar, mas ninguém é avisado de novo.
update public.baba_stats set goals = 0 where baba_id = 'b4000000-0000-0000-0000-000000000007' and name = 'P1';
select t_ok((select status from public.prop_bets where user_id = '00000000-0000-0000-0000-0000000004d3' and market_id = 'c4000000-0000-0000-0000-000000000001') = 'won', 'a correção de stats refez a liquidação (Caio agora ganha)');
select t_ok(public.avusers(now()::text, 'palpites', 'e4000000-0000-0000-0000-000000000007') = '' and (select count(*) from public.srv_avisos_pendentes() where event_id = 'e4000000-0000-0000-0000-000000000007') = 0, 'correção de gol não gera um segundo aviso');

-- A lista aberta também grava e não repete (evento criado agora, pelo caminho de verdade).
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000004d1';
create temp table novo (id uuid);
grant all on novo to public;
insert into novo select public.create_event('f4000000-0000-0000-0000-000000000001', now() + interval '3 days', 'Praça', null, null);
reset role;
select t_ok((select count(*) from public.srv_avisos_pendentes() where tipo = 'lista' and event_id = (select id from novo)) = 4, 'evento criado agora: Bia, Eli e Zé (2 aparelhos) recebem; Adm, Caio, Duda e Fora não');
select t_ok((select count(*) from public.srv_avisos_pendentes() where event_id = (select id from novo)) = 0, 'segunda rodada: nada de novo');
select t_ok((select count(*) from private.aviso_envios where tipo = 'lista' and event_id = (select id from novo)) = 3, 'controle: 3 pessoas avisadas da lista nova');

-- ============ O relógio (tick) ============
-- Cancelar a lista devolve os palpites sozinho, sem ninguém abrir a Lojinha, e a pessoa é avisada.
insert into public.turma_events (id, turma_id, created_by, created_at, starts_at) values
  ('e4000000-0000-0000-0000-000000000008', 'f4000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004d1', now() - interval '1 day', now() + interval '10 hours');
insert into public.prop_markets (id, event_id, turma_id, player_id, kind, metric, line, selections, lambda, status)
  values ('c4000000-0000-0000-0000-000000000011', 'e4000000-0000-0000-0000-000000000008', 'f4000000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-0000000000a1', 'ou', 'goals', 0.5, '[]'::jsonb, 1.5, 'open');
select public.bet('00000000-0000-0000-0000-0000000004d2', 'c4000000-0000-0000-0000-000000000011', 'mais', 0.5, 25, 2.00);
update public.turma_events set status = 'canceled' where id = 'e4000000-0000-0000-0000-000000000008';
select private.avisos_tick();
select t_ok((select status from public.prop_bets where market_id = 'c4000000-0000-0000-0000-000000000011') = 'void', 'tick: lista cancelada devolve o palpite sozinha');
select t_ok(public.avusers(now()::text, 'palpites', 'e4000000-0000-0000-0000-000000000008') = '2', 'e a Bia é avisada da devolução');
select t_ok((select title from public.avc(now()::text, 'palpites', 'e4000000-0000-0000-0000-000000000008')) like 'Seus palpites do baba de % foram devolvidos', 'texto de devolução (baba cancelado)');

-- Só chama a Edge Function quando existe aviso a mandar e a configuração está preenchida.
create schema if not exists net;
create table public.net_calls (url text, body jsonb, headers jsonb);
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000) returns bigint
language sql as $$ insert into public.net_calls values (url, body, headers) returning 1::bigint $$;
select t_ok((select count(*) from public.net_calls) = 0, 'tick sem configuração não chama ninguém');
select private.avisos_tick();
select t_ok((select count(*) from public.net_calls) = 0, 'tick sem configuração (pendente ou não) não chama a função');
insert into private.avisos_cfg (id, url, secret) values (true, 'https://x.supabase.co/functions/v1/live-push', 'segredo-de-teste');
select private.avisos_tick();
select t_ok((select count(*) from public.net_calls) = 1 and (select headers ->> 'x-avisos-secret' from public.net_calls) = 'segredo-de-teste', 'com configuração e aviso pendente: chama a Edge Function com o segredo no cabeçalho');
select count(*) from public.srv_avisos_pendentes();
delete from public.net_calls;
select private.avisos_tick();
select t_ok((select count(*) from public.net_calls) = 0, 'sem aviso pendente o tick não chama a função');
update private.avisos_cfg set secret = null;
insert into public.turma_events (id, turma_id, created_by, created_at, starts_at)
  values ('e4000000-0000-0000-0000-000000000009', 'f4000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004d1', now(), now() + interval '4 days');
select private.avisos_tick();
select t_ok((select count(*) from public.net_calls) = 0, 'secret apagado = avisos pausados');

-- ============ Permissões ============
set role authenticated;
set request.uid = '00000000-0000-0000-0000-0000000004d2';
select t_err($$select * from public.srv_avisos_pendentes()$$, 'permission denied', 'só a chave de serviço chama srv_avisos_pendentes');
select t_err($$select * from private.aviso_envios$$, 'permission denied', 'ninguém lê a tabela de controle');
select t_err($$select * from private.avisos_cfg$$, 'permission denied', 'ninguém lê a configuração do segredo');
select t_err($$select private.avisos_tick()$$, 'permission denied', 'ninguém chama o relógio');
set role anon;
select t_err($$select * from public.srv_avisos_pendentes()$$, 'permission denied', 'anônimo também não');
reset role;
select t_ok(has_function_privilege('service_role', 'public.srv_avisos_pendentes()', 'execute'), 'service_role pode chamar');
-- Criar evento e liquidar continuam funcionando sem nenhuma configuração de aviso (nada daqui roda dentro deles).
select t_ok((select count(*) from private.aviso_envios) > 0, 'controle preenchido');
