-- BABA v11.8 · Palpites abertos e por escolha
-- Rode DEPOIS do v11_7_1_ajuste_stats.sql. Pode rodar mais de uma vez e não apaga nada.
-- * Linhas abertas: todo atleta confirmado e cadastrado ganha Mais/Menos de gols, assistências, G+A e JOGOS GANHOS
--   (goleiro também: defesas) e cravada de gols, sempre que tiver chance > 0 (antes só abria com linha "equilibrada").
--   Escada de 0,5 a 10,5 por atleta. Em toda linha pelo menos um lado fica aberto: o lado com mais de 85% de chance
--   ("quase certo") fica travado, porque pagaria menos que o valor jogado. A zebra paga até 20x (valor esperado sempre < 0,9).
--   A mesma trava vale para cravada, duelo, destaque e total (qualquer opção com mais de 85% de chance: erro too_likely).
-- * Duelo por escolha: quem palpita escolhe dois atletas confirmados e o critério (gols, assistências ou G+A):
--   public.prop_duel_open cria (ou devolve) esse duelo. Empate continua devolvendo. Não dá para palpitar contra si mesmo.
-- * Destaque do dia ganha o MVP (gols + assistências + jogos ganhos), junto de Artilheiro, Garçom e Paredão.
-- * Total do baba: quem palpita escolhe a linha (partidas 0,5 a 20,5; gols 0,5 a 60,5). Cotação pelo histórico da turma.
--   Baba finalizado sem nenhuma partida anula o Total (devolve).
-- * public.my_prop_bets: "Ver meus palpites" (os meus palpites pré-jogo, do mais novo para o mais antigo).
-- Só Baba Points; no app: "palpite" e "cotação".

-- ============ Tabelas ============
-- Um atleta pode estar em vários duelos (com adversários e critérios diferentes): o unique passa a incluir o segundo atleta.
do $$ declare c record; begin
  for c in select conname from pg_constraint
           where conrelid = 'public.prop_markets'::regclass and contype = 'u'
             and pg_get_constraintdef(oid) = 'UNIQUE (event_id, player_id, kind, metric)' loop
    execute format('alter table public.prop_markets drop constraint %I', c.conname);
  end loop;
end $$;
create unique index if not exists prop_markets_uniq_v118 on public.prop_markets (event_id, player_id, player2_id, kind, metric) nulls not distinct;

-- ============ Matemática ============
-- Mais chance que isso = "quase certo": não dá para palpitar (pagaria <= 1x).
create or replace function private.prop_maxp() returns numeric language sql immutable set search_path = '' as $$ select 0.85::numeric $$;

-- Escada por atleta: 0,5 a 10,5. Em cada linha, o lado com chance <= 85% fica aberto (sempre há pelo menos um).
create or replace function private.prop_ladder(lam numeric) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare l numeric; p numeric; out jsonb := '[]'::jsonb;
begin
  if lam is null or lam <= 0 then return out; end if;
  for l in select g + 0.5 from generate_series(0, 10) g loop
    p := least(greatest(private.prop_pover(lam, l), 0), 1);
    out := out || jsonb_build_object('line', l,
      'mais', jsonb_build_object('odd', private.prop_odd(p), 'p', round(p, 4), 'ok', p <= private.prop_maxp()),
      'menos', jsonb_build_object('odd', private.prop_odd(1 - p), 'p', round(1 - p, 4), 'ok', (1 - p) <= private.prop_maxp()));
  end loop;
  return out;
end;
$$;

-- Linha sugerida (a que abre na tela): a mais equilibrada da escada, mesmo fora de 35%..65%.
create or replace function private.prop_default_line(lam numeric) returns numeric
language plpgsql immutable set search_path = '' as $$
declare l numeric; p numeric; best numeric := 0.5; bestd numeric := 9;
begin
  if lam is null or lam <= 0 then return null; end if;
  for l in select g + 0.5 from generate_series(0, 10) g loop
    p := private.prop_pover(lam, l);
    if abs(p - 0.5) < bestd then best := l; bestd := abs(p - 0.5); end if;
  end loop;
  return best;
end;
$$;

-- Opções com o "ok" (chance <= 85%).
create or replace function private.prop_mark_ok(sel jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(s || jsonb_build_object('ok', coalesce((s ->> 'p')::numeric, 0) <= private.prop_maxp()) order by o), '[]'::jsonb)
  from jsonb_array_elements(coalesce(sel, '[]'::jsonb)) with ordinality x(s, o);
$$;

-- Escada do Total do baba (partidas até 20,5; gols até 60,5), com a cotação do histórico da turma (private.total_sel).
create or replace function private.total_max(metric text) returns numeric language sql immutable set search_path = '' as $$
  select case metric when 'matches' then 20.5 else 60.5 end;
$$;
create or replace function private.total_ladder(t uuid, metric text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l numeric; s jsonb; pm numeric; out jsonb := '[]'::jsonb;
begin
  for l in select g + 0.5 from generate_series(0, floor(private.total_max(metric))::integer) g loop
    s := private.total_sel(t, metric, l);
    pm := ((s -> 0) ->> 'p')::numeric;
    out := out || jsonb_build_object('line', l,
      'mais', jsonb_build_object('odd', (s -> 0) -> 'odd', 'p', pm, 'ok', pm <= private.prop_maxp()),
      'menos', jsonb_build_object('odd', (s -> 1) -> 'odd', 'p', 1 - pm, 'ok', (1 - pm) <= private.prop_maxp()));
  end loop;
  return out;
end;
$$;

-- Total: linha sugerida = a mais equilibrada da escada (quem palpita pode mudar). Precisa de 5 babas finalizados na turma.
create or replace function private.total_default_line(t uuid, metric text) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare nb integer; l numeric; p numeric; best numeric; bestd numeric := 9;
begin
  select count(*) into nb from private.total_hist(t);
  if nb < 5 then return null; end if;
  for l in select g + 0.5 from generate_series(0, floor(private.total_max(metric))::integer) g loop
    p := ((private.total_sel(t, metric, l) -> 0) ->> 'p')::numeric;
    if abs(p - 0.5) < bestd then best := l; bestd := abs(p - 0.5); end if;
  end loop;
  return best;
end;
$$;
create or replace function private.gen_totals(ev uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare e public.turma_events; met text; ln numeric; got integer; n_new integer := 0;
begin
  select * into e from public.turma_events where id = ev;
  foreach met in array array['matches', 'goals'] loop
    if exists (select 1 from public.prop_markets where event_id = ev and kind = 'baba_total' and metric = met) then continue; end if;
    ln := private.total_default_line(e.turma_id, met);
    if ln is null then continue; end if;
    insert into public.prop_markets (event_id, turma_id, kind, metric, line, selections, sample_n)
    values (ev, e.turma_id, 'baba_total', met, ln, private.total_sel(e.turma_id, met, ln), (select count(*) from private.total_hist(e.turma_id)))
    on conflict do nothing;
    get diagnostics got = row_count; n_new := n_new + got;
  end loop;
  return n_new;
end;
$$;

-- ============ Histórico com vitórias ============
drop function if exists private.prop_stats(uuid, text);
create function private.prop_stats(t uuid, venue text)
returns table (pid uuid, gk boolean, bid uuid, bevent uuid, wt numeric, g numeric, a numeric, sv numeric, m numeric, w numeric)
language sql stable security definer set search_path = '' as $$
  select tp.id, coalesce(tp.is_goalkeeper, false), wi.bid, wi.bevent, wi.wt,
         sum(s.goals)::numeric, sum(s.assists)::numeric, sum(s.saves)::numeric, sum(s.matches)::numeric, sum(s.wins)::numeric
  from private.prop_window(t, venue) wi
  join public.baba_stats s on s.baba_id = wi.bid
  join public.turma_players tp on tp.turma_id = t
    and (tp.id = s.turma_player_id or (s.turma_player_id is null and lower(trim(tp.name)) = lower(trim(s.name))))
  group by tp.id, tp.is_goalkeeper, wi.bid, wi.bevent, wi.wt;
$$;

-- O mesmo λ da v11.5, mais o de jogos ganhos (lw).
drop function if exists private.prop_rates(uuid);
create function private.prop_rates(ev uuid)
returns table (pid uuid, gk boolean, n integer, lg numeric, la numeric, lga numeric, ls numeric, lw numeric)
language plpgsql stable security definer set search_path = '' as $$
declare e public.turma_events; nconf integer; ej numeric; pavg numeric; venue_f text;
begin
  select * into e from public.turma_events where id = ev;
  if e.id is null then return; end if;
  select count(*) into nconf from public.event_rsvps where event_id = ev and status = 'vou';
  if nconf < 1 then return; end if;
  select b.state ->> 'venue' into venue_f from public.babas b
   where b.event_id = ev and b.state ->> 'venue' in ('campo', 'society', 'futsal') order by b.created_at desc limit 1;
  if venue_f is not null and not coalesce((select (p.prefs ->> 'detailStats')::boolean from public.profiles p where p.id = e.created_by), false) then
    venue_f := null;
  end if;
  select avg(s.m) into ej from private.prop_stats(e.turma_id, venue_f) s
   where s.m > 0 and s.bevent is not null
     and abs((select count(*) from public.event_rsvps rr where rr.event_id = s.bevent and rr.status = 'vou') - nconf) <= 3;
  if ej is null then
    select coalesce(nullif(avg(wi.bmatches), 0), 6) into pavg from private.prop_window(e.turma_id, venue_f) wi;
    ej := 2 * coalesce(pavg, 6) * 5 / nconf;
  end if;
  ej := round(ej, 4);
  return query
    with st as (select * from private.prop_stats(e.turma_id, venue_f)),
    ath as (
      select st.pid, st.gk, count(*) filter (where st.m > 0) as n, sum(st.m * st.wt) as wm, sum(st.g * st.wt) as wg, sum(st.a * st.wt) as wa,
             sum(st.sv * st.wt) as wsv, sum(st.w * st.wt) as ww
      from st group by st.pid, st.gk
    ),
    grp as (
      select ath.gk, sum(ath.wg) / nullif(sum(ath.wm), 0) as tg, sum(ath.wa) / nullif(sum(ath.wm), 0) as ta,
             sum(ath.wsv) / nullif(sum(ath.wm), 0) as ts, sum(ath.ww) / nullif(sum(ath.wm), 0) as tw
      from ath group by ath.gk
    ),
    conf as (
      select distinct tp.id as pid, coalesce(tp.is_goalkeeper, false) as gk
      from public.event_rsvps rr join public.turma_players tp on tp.id = rr.turma_player_id and tp.turma_id = e.turma_id
      where rr.event_id = ev and rr.status = 'vou'
    ),
    r as (
      select c.pid, c.gk, coalesce(a.n, 0)::integer as n,
             (coalesce(a.n, 0) * case when coalesce(a.wm, 0) > 0 then a.wg / a.wm else 0 end + 3 * coalesce(g.tg, 0)) / (coalesce(a.n, 0) + 3) as rg,
             (coalesce(a.n, 0) * case when coalesce(a.wm, 0) > 0 then a.wa / a.wm else 0 end + 3 * coalesce(g.ta, 0)) / (coalesce(a.n, 0) + 3) as ra,
             (coalesce(a.n, 0) * case when coalesce(a.wm, 0) > 0 then a.wsv / a.wm else 0 end + 3 * coalesce(g.ts, 0)) / (coalesce(a.n, 0) + 3) as rs,
             (coalesce(a.n, 0) * case when coalesce(a.wm, 0) > 0 then a.ww / a.wm else 0 end + 3 * coalesce(g.tw, 0.5)) / (coalesce(a.n, 0) + 3) as rw
      from conf c left join ath a on a.pid = c.pid left join grp g on g.gk = c.gk
    )
    select r.pid, r.gk, r.n, round(r.rg * ej, 4), round(r.ra * ej, 4), round((r.rg + r.ra) * ej, 4), round(r.rs * ej, 4), round(r.rw * ej, 4) from r;
end;
$$;

-- Números de um atleta num baba, agora com vitórias.
drop function if exists private.prop_pstat(uuid, uuid);
create function private.prop_pstat(baba uuid, pid uuid)
returns table (g numeric, a numeric, sv numeric, mt numeric, w numeric)
language sql stable security definer set search_path = '' as $$
  select sum(s.goals)::numeric, sum(s.assists)::numeric, sum(s.saves)::numeric, sum(s.matches)::numeric, sum(s.wins)::numeric
  from public.turma_players tp join public.baba_stats s on s.baba_id = baba
   and (s.turma_player_id = tp.id or (s.turma_player_id is null and lower(trim(s.name)) = lower(trim(tp.name))))
  where tp.id = pid;
$$;

-- Valor de uma métrica a partir dos números do atleta.
create or replace function private.prop_val(metric text, g numeric, a numeric, sv numeric, w numeric) returns numeric
language sql immutable set search_path = '' as $$
  select coalesce(case metric when 'goals' then g when 'assists' then a when 'saves' then sv when 'ga' then coalesce(g, 0) + coalesce(a, 0)
                              when 'wins' then w when 'mvp' then coalesce(g, 0) + coalesce(a, 0) + coalesce(w, 0) end, 0);
$$;

-- ============ Geração (preguiçosa) ============
-- Destaque do dia: Artilheiro, Garçom e MVP com atletas de linha (mínimo 4) e Paredão com goleiros (mínimo 2).
create or replace function private.gen_leaders(ev uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare e public.turma_events; k integer; mets text[] := array['goals', 'assists', 'saves', 'mvp']; mins integer[] := array[4, 4, 2, 4];
  m public.prop_markets; cand jsonb; ncand integer; allopts jsonb; got integer; n_new integer := 0;
begin
  select * into e from public.turma_events where id = ev;
  for k in 1 .. 4 loop
    select coalesce(jsonb_agg(jsonb_build_object('key', x.pid::text,
             'lam', case mets[k] when 'goals' then x.lg when 'assists' then x.la when 'saves' then x.ls else x.lg + x.la + x.lw end) order by x.pid), '[]'::jsonb), count(*)
      into cand, ncand from private.prop_rates(ev) x where x.gk = (mets[k] = 'saves');
    select * into m from public.prop_markets where event_id = ev and kind = 'leader' and metric = mets[k] and player_id is null;
    if m.id is null then
      if ncand < mins[k] then continue; end if;
      insert into public.prop_markets (event_id, turma_id, kind, metric, selections, sample_n)
      values (ev, e.turma_id, 'leader', mets[k], private.prop_mark_ok(private.prop_leader_sel(cand)), ncand) on conflict do nothing;
      get diagnostics got = row_count; n_new := n_new + got;
    elsif m.status = 'open' and exists (select 1 from jsonb_array_elements(cand) c where not exists (select 1 from jsonb_array_elements(m.selections) s where s ->> 'key' = c ->> 'key')) then
      select jsonb_agg(jsonb_build_object('key', s ->> 'key', 'lam', (s ->> 'lam')::numeric)) || coalesce((
               select jsonb_agg(c) from jsonb_array_elements(cand) c where not exists (select 1 from jsonb_array_elements(m.selections) s2 where s2 ->> 'key' = c ->> 'key')), '[]'::jsonb)
        into allopts from jsonb_array_elements(m.selections) s;
      update public.prop_markets set selections = private.prop_mark_ok(private.prop_leader_sel(allopts)), sample_n = jsonb_array_length(allopts) where id = m.id;
    end if;
  end loop;
  return n_new;
end;
$$;

-- Por atleta: todos os confirmados cadastrados, todas as métricas com chance > 0 (linha sugerida = a mais equilibrada).
create or replace function private.generate_prop_markets(ev uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare e public.turma_events; nconf integer; n_new integer := 0; got integer; r record; rookie boolean; met text; lam numeric;
begin
  select * into e from public.turma_events where id = ev;
  if e.id is null or e.status <> 'open' or private.prop_locked(ev) then return 0; end if;
  select count(*) into nconf from public.event_rsvps where event_id = ev and status = 'vou';
  if nconf < 4 then return 0; end if;
  for r in select * from private.prop_rates(ev) loop
    rookie := r.n = 0;
    foreach met in array array['goals', 'assists', 'ga', 'wins', 'saves'] loop
      if met = 'saves' and not r.gk then continue; end if;
      lam := case met when 'goals' then r.lg when 'assists' then r.la when 'ga' then r.lga when 'wins' then r.lw else r.ls end;
      if lam is null or lam <= 0 then continue; end if;
      insert into public.prop_markets (event_id, turma_id, player_id, kind, metric, line, selections, lambda, sample_n, rookie)
      values (ev, e.turma_id, r.pid, 'ou', met, private.prop_default_line(lam), private.prop_selections('ou', lam, private.prop_default_line(lam)), lam, r.n, rookie)
      on conflict do nothing;
      get diagnostics got = row_count; n_new := n_new + got;
      if met = 'goals' then
        insert into public.prop_markets (event_id, turma_id, player_id, kind, metric, line, selections, lambda, sample_n, rookie)
        values (ev, e.turma_id, r.pid, 'exact', 'goals', null, private.prop_mark_ok(private.prop_selections('exact', lam, null)), lam, r.n, rookie) on conflict do nothing;
        get diagnostics got = row_count; n_new := n_new + got;
      end if;
    end loop;
  end loop;
  n_new := n_new + private.gen_duels(ev) + private.gen_leaders(ev) + private.gen_totals(ev);
  return n_new;
end;
$$;

-- Cravadas já abertas ganham o "ok" (chance <= 85%).
update public.prop_markets set selections = private.prop_mark_ok(selections)
 where kind in ('exact', 'leader', 'duel') and status = 'open' and exists (select 1 from jsonb_array_elements(selections) s where not s ? 'ok');

-- ============ Duelo por escolha ============
-- Quem palpita escolhe A, B e o critério. Devolve o mercado (o mesmo se esse duelo já existe, em qualquer ordem).
create or replace function public.prop_duel_open(event uuid, p_a uuid, p_b uuid, p_metric text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); e public.turma_events; ra record; rb record; la numeric; lb numeric; p numeric; mid uuid;
  a uuid; b uuid; tmp record;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into e from public.turma_events where id = event;
  if e.id is null or not private.is_member(e.turma_id) then raise exception 'not_member'; end if;
  if p_metric is null or p_metric not in ('goals', 'assists', 'ga') then raise exception 'bad_metric'; end if;
  if p_a is null or p_b is null or p_a = p_b then raise exception 'bad_pair'; end if;
  perform private.props_refresh(event);
  if e.status <> 'open' or private.prop_locked(event) then raise exception 'locked'; end if;
  -- ordem fixa: o mesmo par é sempre o mesmo duelo
  a := least(p_a, p_b); b := greatest(p_a, p_b);
  select id into mid from public.prop_markets x where x.event_id = event and x.kind = 'duel' and x.metric = p_metric
     and ((x.player_id = a and x.player2_id = b) or (x.player_id = b and x.player2_id = a)) limit 1;
  if mid is null then
    if (select count(*) from public.prop_markets x where x.event_id = event and x.kind = 'duel') >= 200 then raise exception 'too_many'; end if;
    select * into ra from private.prop_rates(event) x where x.pid = a;
    select * into rb from private.prop_rates(event) x where x.pid = b;
    if ra.pid is null or rb.pid is null then raise exception 'not_confirmed'; end if;
    la := case p_metric when 'goals' then ra.lg when 'assists' then ra.la else ra.lga end;
    lb := case p_metric when 'goals' then rb.lg when 'assists' then rb.la else rb.lga end;
    p := private.prop_duel_p(coalesce(la, 0), coalesce(lb, 0));
    if p is null then raise exception 'no_odds'; end if;
    insert into public.prop_markets (event_id, turma_id, player_id, player2_id, kind, metric, selections, lambda, sample_n)
    values (event, e.turma_id, a, b, 'duel', p_metric,
            private.prop_mark_ok(jsonb_build_array(
              jsonb_build_object('key', a::text, 'lam', la, 'odd', private.prop_odd(p), 'p', round(p, 4)),
              jsonb_build_object('key', b::text, 'lam', lb, 'odd', private.prop_odd(1 - p), 'p', round(1 - p, 4)))),
            la, 0)
    on conflict do nothing returning id into mid;
    if mid is null then
      select id into mid from public.prop_markets x where x.event_id = event and x.kind = 'duel' and x.metric = p_metric and x.player_id = a and x.player2_id = b;
    end if;
  end if;
  return jsonb_build_object('market_id', mid);
end;
$$;

-- ============ Liquidação ============
-- Por atleta (Mais/Menos com a linha de cada palpite e cravada), agora com jogos ganhos.
create or replace function private.settle_event(ev uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare bb public.babas; m public.prop_markets; pn text; st record; val numeric; absent boolean; win text; res jsonb; want text; n integer := 0; b public.prop_bets;
begin
  select * into bb from public.babas where event_id = ev and finished order by created_at desc limit 1;
  if bb.id is null then return 0; end if;
  if not exists (select 1 from public.baba_stats where baba_id = bb.id) then return 0; end if;
  for m in select * from public.prop_markets x where x.event_id = ev and x.kind in ('ou', 'exact')
           and (x.status in ('open', 'locked', 'settled') or (x.status = 'void' and x.void_reason = 'ausente')) for update loop
    select name into pn from public.turma_players where id = m.player_id;
    select sum(s.goals) as g, sum(s.assists) as a, sum(s.saves) as sv, sum(s.matches) as mt, sum(s.wins) as w into st
      from public.baba_stats s
     where s.baba_id = bb.id and (s.turma_player_id = m.player_id or (s.turma_player_id is null and lower(trim(s.name)) = lower(trim(pn))));
    absent := st.mt is null or st.mt = 0;
    if absent then
      want := 'void'; res := jsonb_build_object('void', 'ausente');
    else
      val := private.prop_val(m.metric, st.g, st.a, st.sv, st.w);
      win := case when m.kind = 'ou' then (case when val > m.line then 'mais' else 'menos' end)
                  else (case when val >= 6 then '6+' else val::integer::text end) end;
      want := 'settled'; res := jsonb_build_object('value', val::integer, 'win', win);
    end if;
    if m.status = want and m.result is not distinct from res then continue; end if;
    if m.status in ('settled', 'void') then perform private.unsettle_market(m.id); end if;
    if absent then
      update public.prop_markets set status = 'locked' where id = m.id;
      update public.prop_markets set status = 'void', void_reason = 'ausente', result = res, settled_at = now() where id = m.id;
      for b in select * from public.prop_bets where market_id = m.id and status = 'open' for update loop
        update public.prop_bets set status = 'void', payout = b.stake, settled_at = now() where id = b.id;
        perform private.add_points(b.user_id, b.stake, 'palpite-pre-devolvido', b.id::text);
      end loop;
    else
      update public.prop_markets set status = 'settled', result = res, settled_at = now() where id = m.id;
      for b in select * from public.prop_bets where market_id = m.id and status = 'open' for update loop
        if (m.kind = 'ou' and ((b.selection = 'mais' and val > coalesce(b.line, m.line)) or (b.selection = 'menos' and val < coalesce(b.line, m.line))))
           or (m.kind = 'exact' and b.selection = win) then
          update public.prop_bets set status = 'won', payout = floor(b.stake * b.odd)::integer, settled_at = now() where id = b.id;
          perform private.add_points(b.user_id, floor(b.stake * b.odd)::integer, 'palpite-pre-ganho', b.id::text);
        else
          update public.prop_bets set status = 'lost', payout = 0, settled_at = now() where id = b.id;
        end if;
      end loop;
    end if;
    n := n + 1;
  end loop;
  return n + private.settle_fase2(ev);
end;
$$;

-- Duelo (pelo critério do duelo), Destaque (com MVP) e Total (com a linha de cada palpite; baba sem partidas anula).
create or replace function private.settle_fase2(ev uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare bb public.babas; m public.prop_markets; b public.prop_bets; st record; want text; why text; res jsonb; n integer := 0;
  va numeric; vb numeric; win text; o jsonb; val numeric; top numeric; tops text[]; absent text[]; played jsonb; ntop integer; pay integer; won boolean; bl numeric;
begin
  select * into bb from public.babas where event_id = ev and finished order by created_at desc limit 1;
  if bb.id is null then return 0; end if;
  if not exists (select 1 from public.baba_stats where baba_id = bb.id) then return 0; end if;
  for m in select * from public.prop_markets x where x.event_id = ev and x.kind in ('duel', 'leader', 'baba_total')
           and (x.status in ('open', 'locked', 'settled') or (x.status = 'void' and x.void_reason in ('ausente', 'zero'))) order by x.id for update loop
    win := null; tops := '{}'; absent := '{}'; why := null; val := null;
    if m.kind = 'duel' then
      select * into st from private.prop_pstat(bb.id, m.player_id);
      if coalesce(st.mt, 0) = 0 then why := 'ausente'; else va := private.prop_val(m.metric, st.g, st.a, st.sv, st.w); end if;
      select * into st from private.prop_pstat(bb.id, m.player2_id);
      if coalesce(st.mt, 0) = 0 then why := 'ausente'; else vb := private.prop_val(m.metric, st.g, st.a, st.sv, st.w); end if;
      if why is null then
        win := case when va > vb then m.player_id::text when vb > va then m.player2_id::text end;
        res := jsonb_build_object('value', va::integer, 'value2', vb::integer, 'win', coalesce(win, 'empate'));
      end if;
    elsif m.kind = 'leader' then
      played := '[]'::jsonb;
      for o in select * from jsonb_array_elements(m.selections) loop
        select * into st from private.prop_pstat(bb.id, (o ->> 'key')::uuid);
        if coalesce(st.mt, 0) = 0 then absent := absent || (o ->> 'key');
        else played := played || jsonb_build_object('key', o ->> 'key', 'v', private.prop_val(m.metric, st.g, st.a, st.sv, st.w));
        end if;
      end loop;
      select max((p ->> 'v')::numeric) into top from jsonb_array_elements(played) p;
      if top is null or top = 0 then why := 'zero';
      else
        select array_agg(p ->> 'key' order by p ->> 'key') into tops from jsonb_array_elements(played) p where (p ->> 'v')::numeric = top;
        select coalesce(array_agg(x order by x), '{}') into absent from unnest(absent) x;
        res := jsonb_build_object('value', top::integer, 'win', to_jsonb(tops), 'absent', to_jsonb(absent));
      end if;
    else
      if coalesce(bb.matches, 0) = 0 then why := 'zero';
      else
        val := case m.metric when 'matches' then coalesce(bb.matches, 0) else coalesce((select sum(s.goals) from public.baba_stats s where s.baba_id = bb.id), 0) end;
        res := jsonb_build_object('value', val::integer);
      end if;
    end if;
    if why is not null then want := 'void'; res := jsonb_build_object('void', why); else want := 'settled'; end if;
    if m.status = want and m.result is not distinct from res then continue; end if;
    if m.status in ('settled', 'void') then perform private.unsettle_market(m.id); end if;
    if want = 'void' then
      perform private.void_market(m.id, why);
    else
      update public.prop_markets set status = 'settled', result = res, settled_at = now() where id = m.id;
      ntop := greatest(coalesce(array_length(tops, 1), 1), 1);
      for b in select * from public.prop_bets where market_id = m.id and status = 'open' for update loop
        if m.kind = 'baba_total' then
          bl := coalesce(b.line, m.line);
          win := case when val > bl then 'mais' when val < bl then 'menos' end;
        end if;
        if (m.kind in ('duel', 'baba_total') and win is null) or (m.kind = 'leader' and b.selection = any (absent)) then
          update public.prop_bets set status = 'void', payout = b.stake, settled_at = now() where id = b.id;
          perform private.add_points(b.user_id, b.stake, 'palpite-pre-devolvido', b.id::text);
          continue;
        end if;
        won := case when m.kind = 'leader' then b.selection = any (tops) else b.selection = win end;
        if won then
          pay := case when m.kind = 'leader' then floor(b.stake * b.odd / ntop)::integer else floor(b.stake * b.odd)::integer end;
          update public.prop_bets set status = 'won', payout = pay, settled_at = now() where id = b.id;
          if pay > 0 then perform private.add_points(b.user_id, pay, 'palpite-pre-ganho', b.id::text); end if;
        else
          update public.prop_bets set status = 'lost', payout = 0, settled_at = now() where id = b.id;
        end if;
      end loop;
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ============ Textos ============
create or replace function private.prop_metric_label(metric text) returns text language sql immutable set search_path = '' as $$
  select case metric when 'goals' then 'gols' when 'assists' then 'assistências' when 'ga' then 'G+A' when 'saves' then 'defesas'
                     when 'wins' then 'jogos ganhos' when 'mvp' then 'MVP' when 'matches' then 'partidas' else metric end;
$$;
create or replace function private.prop_bet_label(kind text, metric text, line numeric, selection text, pname text, p2name text, selname text) returns text
language sql immutable set search_path = '' as $$
  select case kind
    when 'ou' then coalesce(pname, '?') || ' · ' || (case selection when 'mais' then 'Mais ' else 'Menos ' end) || private.prop_fmt(line) || ' ' || private.prop_metric_label(metric)
    when 'exact' then coalesce(pname, '?') || ' · cravada: ' || (case selection when '6+' then '6 ou mais' else selection end) || ' gol' || (case when selection = '1' then '' else 's' end)
    when 'duel' then 'Duelo ' || coalesce(pname, '?') || ' x ' || coalesce(p2name, '?') || ' (' || private.prop_metric_label(metric) || ') · ' || coalesce(selname, '?')
    when 'leader' then (case metric when 'goals' then 'Artilheiro' when 'assists' then 'Garçom' when 'saves' then 'Paredão' else 'MVP' end) || ' · ' || coalesce(selname, '?')
    when 'baba_total' then (case metric when 'matches' then 'Partidas no dia' else 'Gols no dia' end) || ' · '
                           || (case selection when 'mais' then 'Mais ' else 'Menos ' end) || private.prop_fmt(line)
  end;
$$;

-- ============ RPCs ============
create or replace function public.prop_markets(event uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); e public.turma_events; adm boolean; locked boolean;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into e from public.turma_events where id = event;
  if e.id is null or not private.is_member(e.turma_id) then raise exception 'not_member'; end if;
  perform private.props_refresh(event);
  adm := private.is_admin(e.turma_id);
  locked := private.prop_locked(event) or e.status <> 'open';
  return jsonb_build_object(
    'event_id', e.id, 'turma_id', e.turma_id, 'starts_at', e.starts_at, 'locked', locked, 'admin', adm,
    'adult', private.is_adult(uid), 'v118', true,
    'confirmed', (select count(*) from public.event_rsvps where event_id = e.id and status = 'vou'),
    'athletes', coalesce((
      select jsonb_agg(jsonb_build_object('id', tp.id, 'name', tp.name, 'keeper', coalesce(tp.is_goalkeeper, false), 'mine', tp.user_id = uid) order by tp.name)
      from (select distinct rr.turma_player_id from public.event_rsvps rr where rr.event_id = e.id and rr.status = 'vou' and rr.turma_player_id is not null) c
      join public.turma_players tp on tp.id = c.turma_player_id and tp.turma_id = e.turma_id), '[]'::jsonb),
    'markets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'player_id', m.player_id, 'player', tp.name, 'keeper', coalesce(tp.is_goalkeeper, false),
        'mine', tp.user_id = uid, 'kind', m.kind, 'metric', m.metric, 'line', m.line,
        'player2_id', m.player2_id, 'player2', tp2.name, 'mine2', tp2.user_id = uid,
        'selections', case when m.kind in ('duel', 'leader') then (
            select coalesce(jsonb_agg(s || jsonb_build_object('label', coalesce(px.name, '?'), 'mine', coalesce(px.user_id = uid, false)) order by q.ord), '[]'::jsonb)
            from jsonb_array_elements(private.prop_mark_ok(m.selections)) with ordinality q(s, ord) left join public.turma_players px on px.id::text = q.s ->> 'key')
          else private.prop_mark_ok(m.selections) end,
        'ladder', case when m.kind = 'ou' then private.prop_ladder(m.lambda) when m.kind = 'baba_total' then private.total_ladder(m.turma_id, m.metric) end,
        'rookie', m.rookie, 'status', m.status, 'result', m.result, 'void_reason', m.void_reason,
        'adjusted', m.edited_by is not null, 'has_bets', exists (select 1 from public.prop_bets x where x.market_id = m.id),
        'bet', (select jsonb_build_object('selection', b.selection, 'line', coalesce(b.line, m.line), 'stake', b.stake, 'odd', b.odd, 'status', b.status, 'payout', b.payout)
                from public.prop_bets b where b.market_id = m.id and b.user_id = uid))
        order by case when m.kind in ('ou', 'exact') then 0 when m.kind = 'duel' then 1 when m.kind = 'leader' then 2 else 3 end,
                 tp.name, case m.metric when 'wins' then 0 when 'goals' then 1 when 'assists' then 2 when 'ga' then 3 when 'saves' then 4 when 'mvp' then 5 when 'matches' then 6 else 7 end, m.kind desc)
      from public.prop_markets m left join public.turma_players tp on tp.id = m.player_id left join public.turma_players tp2 on tp2.id = m.player2_id
      where m.event_id = e.id and (m.player_id is null or tp.id is not null)), '[]'::jsonb));
end;
$$;

create or replace function public.place_prop_bet(market uuid, selection text, stake integer, p_line numeric default null)
returns table (bet_id bigint, balance integer, odd numeric, payout integer)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); m public.prop_markets; e public.turma_events; sel jsonb; o numeric; bal integer; bid bigint;
  tp_user uuid; tp2_user uuid; ln numeric; lad jsonb;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into m from public.prop_markets x where x.id = market;
  if m.id is null then raise exception 'market_closed'; end if;
  select * into e from public.turma_events where id = m.event_id;
  if not private.is_member(m.turma_id) then raise exception 'not_member'; end if;
  if not private.is_adult(uid) then raise exception 'not_adult'; end if;
  perform private.props_refresh(m.event_id);
  select * into m from public.prop_markets x where x.id = market;
  if m.status = 'locked' or (m.status = 'open' and private.prop_locked(m.event_id)) then raise exception 'locked'; end if;
  if m.status <> 'open' or e.status <> 'open' then raise exception 'market_closed'; end if;
  if stake is null or stake < 10 then raise exception 'bad_stake'; end if;
  select tp.user_id into tp_user from public.turma_players tp where tp.id = m.player_id;
  select tp.user_id into tp2_user from public.turma_players tp where tp.id = m.player2_id;
  if m.kind in ('ou', 'baba_total') then
    if place_prop_bet.selection not in ('mais', 'menos') then raise exception 'bad_selection'; end if;
    ln := coalesce(p_line, m.line);
    select x into lad from jsonb_array_elements(case when m.kind = 'ou' then private.prop_ladder(m.lambda) else private.total_ladder(m.turma_id, m.metric) end) x
     where (x ->> 'line')::numeric = ln limit 1;
    if lad is null then raise exception 'bad_line'; end if;
    sel := lad -> place_prop_bet.selection;
    if m.kind = 'ou' and tp_user = uid and place_prop_bet.selection = 'menos' then raise exception 'self_under'; end if;
  elsif m.kind = 'exact' then
    ln := null;
    select x into sel from jsonb_array_elements(m.selections) x where x ->> 'key' = place_prop_bet.selection limit 1;
    if sel is null then raise exception 'bad_selection'; end if;
    if tp_user = uid and m.metric = 'goals' then raise exception 'self_exact'; end if;
  else
    -- duel / leader: a chave é o id do atleta.
    select x into sel from jsonb_array_elements(m.selections) x where x ->> 'key' = place_prop_bet.selection limit 1;
    if sel is null then raise exception 'bad_selection'; end if;
    ln := null;
    if m.kind = 'duel' and ((tp_user = uid and place_prop_bet.selection = m.player2_id::text) or (tp2_user = uid and place_prop_bet.selection = m.player_id::text)) then
      raise exception 'self_against';
    end if;
  end if;
  -- Lado/opção "quase certo" (mais de 85% de chance) não paga: travado.
  if coalesce((sel ->> 'p')::numeric, 0) > private.prop_maxp() then raise exception 'too_likely'; end if;
  if exists (select 1 from public.prop_bets b where b.market_id = market and b.user_id = uid) then raise exception 'already_bet'; end if;
  o := least(greatest(round((sel ->> 'odd')::numeric, 2), 1.05), 20);
  perform 1 from public.my_wallet();
  insert into public.prop_bets (market_id, user_id, selection, stake, odd, line) values (market, uid, place_prop_bet.selection, stake, o, ln) returning id into bid;
  bal := private.add_points(uid, -stake, 'palpite-pre', bid::text);
  return query select bid, bal, o, floor(stake * o)::integer;
end;
$$;

-- Extrato do adm (a mesma da v11.6.1) com os textos novos (critério do duelo, MVP, jogos ganhos).
create or replace function public.prop_event_bets(event uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); e public.turma_events; recs uuid[];
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into e from public.turma_events where id = event;
  if e.id is null or not private.is_admin(e.turma_id) then raise exception 'not_allowed'; end if;
  select coalesce((select array[b.created_by] || coalesce(b.scorers, '{}') from public.babas b where b.event_id = event order by b.created_at desc limit 1), array[e.created_by]) into recs;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', b.user_id, 'name', pr.name, 'player', tp.name, 'metric', m.metric, 'kind', m.kind,
        'line', coalesce(b.line, m.line), 'selection', b.selection, 'stake', b.stake, 'odd', b.odd, 'status', b.status, 'payout', b.payout,
        'recorder', b.user_id = any (recs),
        'label', case when m.kind in ('duel', 'leader', 'baba_total')
                      then private.prop_bet_label(m.kind, m.metric, coalesce(b.line, m.line), b.selection, tp.name, tp2.name, ps.name) end) order by b.created_at)
    from public.prop_bets b join public.prop_markets m on m.id = b.market_id
    left join public.turma_players tp on tp.id = m.player_id left join public.turma_players tp2 on tp2.id = m.player2_id
    left join public.turma_players ps on m.kind in ('duel', 'leader') and ps.id::text = b.selection
    left join public.profiles pr on pr.id = b.user_id
    where m.event_id = event), '[]'::jsonb);
end;
$$;

-- "Ver meus palpites": os meus palpites pré-jogo (todas as listas), do mais novo para o mais antigo.
create or replace function public.my_prop_bets(lim integer default 60) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  return coalesce((
    select jsonb_agg(x.j order by x.created_at desc) from (
      select b.created_at, jsonb_build_object('id', b.id, 'event_id', m.event_id, 'starts_at', e.starts_at, 'turma', t.name,
        'kind', m.kind, 'metric', m.metric, 'line', coalesce(b.line, m.line), 'selection', b.selection,
        'label', private.prop_bet_label(m.kind, m.metric, coalesce(b.line, m.line), b.selection, tp.name, tp2.name, ps.name),
        'stake', b.stake, 'odd', b.odd, 'status', b.status, 'payout', b.payout, 'market_status', m.status,
        'result', m.result, 'created_at', b.created_at) as j
      from public.prop_bets b join public.prop_markets m on m.id = b.market_id
      join public.turma_events e on e.id = m.event_id left join public.turmas t on t.id = m.turma_id
      left join public.turma_players tp on tp.id = m.player_id left join public.turma_players tp2 on tp2.id = m.player2_id
      left join public.turma_players ps on m.kind in ('duel', 'leader') and ps.id::text = b.selection
      where b.user_id = uid
      order by b.created_at desc limit least(greatest(coalesce(lim, 60), 1), 200)) x), '[]'::jsonb);
end;
$$;

revoke execute on function private.prop_ladder(numeric), private.prop_default_line(numeric), private.prop_mark_ok(jsonb), private.total_ladder(uuid, text),
  private.total_default_line(uuid, text), private.gen_totals(uuid),
  private.prop_stats(uuid, text), private.prop_rates(uuid), private.prop_pstat(uuid, uuid), private.prop_val(text, numeric, numeric, numeric, numeric),
  private.gen_leaders(uuid), private.generate_prop_markets(uuid), private.settle_event(uuid), private.settle_fase2(uuid),
  private.prop_bet_label(text, text, numeric, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.prop_duel_open(uuid, uuid, uuid, text), public.my_prop_bets(integer), public.prop_markets(uuid),
  public.place_prop_bet(uuid, text, integer, numeric), public.prop_event_bets(uuid) from public, anon;
grant execute on function public.prop_duel_open(uuid, uuid, uuid, text), public.my_prop_bets(integer), public.prop_markets(uuid),
  public.place_prop_bet(uuid, text, integer, numeric), public.prop_event_bets(uuid) to authenticated;

select 1 as v11_8_done;
