-- BABA v11.5: Palpites fase 2. Duelo (G+A), Destaque do dia (Artilheiro, Garçom, Paredão), Total do baba (partidas e gols no dia),
-- ranking de palpiteiros por turma e temporada, e os troféus Pé-quente e Mãe Diná.
-- Rode DEPOIS do v11_4_2_avisos.sql. Pode rodar mais de uma vez e não apaga nada que já existe.
-- Os mercados novos seguem o mesmo ciclo da v11.4/v11.4.1: abrem com 4 confirmados, travam no horário ou no 1º apito,
-- liquidam no servidor quando os stats chegam (e de novo se os stats forem corrigidos), anulam em cancelado/72 h.
-- Valor do palpite: de 10 até o saldo, um palpite por mercado (igual à v11.4.1). Só Baba Points; no app: "palpite" e "cotação".

-- ============ Tabelas ============
-- Duelo: player_id = atleta A (o de λ maior), player2_id = atleta B. Destaque e Total não têm atleta (player_id null).
alter table public.prop_markets add column if not exists player2_id uuid references public.turma_players(id) on delete cascade;
-- Um mercado de cada (tipo, métrica) por evento quando não há atleta (o unique antigo não pega null).
create unique index if not exists prop_markets_event_kind_nop on public.prop_markets (event_id, kind, metric) where player_id is null;
-- Troféus de palpiteiro são de uma conta (não de um atleta da turma).
alter table public.turma_trophies add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists turma_trophies_user on public.turma_trophies (user_id) where user_id is not null;

-- ============ Taxas dos atletas (o mesmo λ da v11.4) ============
-- Um registro por atleta confirmado e cadastrado: n = babas no histórico (0 = estreante), λ de gols, assistências, G+A e defesas.
-- Mesma conta de private.generate_prop_markets da v11.4 (taxa ajustada com encolhimento 3 e mesmo E[J]).
create or replace function private.prop_rates(ev uuid)
returns table (pid uuid, gk boolean, n integer, lg numeric, la numeric, lga numeric, ls numeric)
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
    select coalesce(nullif(avg(w.bmatches), 0), 6) into pavg from private.prop_window(e.turma_id, venue_f) w;
    ej := 2 * coalesce(pavg, 6) * 5 / nconf;
  end if;
  ej := round(ej, 4);
  return query
    with st as (select * from private.prop_stats(e.turma_id, venue_f)),
    ath as (
      select st.pid, st.gk, count(*) filter (where st.m > 0) as n, sum(st.m * st.wt) as wm, sum(st.g * st.wt) as wg, sum(st.a * st.wt) as wa, sum(st.sv * st.wt) as wsv
      from st group by st.pid, st.gk
    ),
    grp as (
      select ath.gk, sum(ath.wg) / nullif(sum(ath.wm), 0) as tg, sum(ath.wa) / nullif(sum(ath.wm), 0) as ta, sum(ath.wsv) / nullif(sum(ath.wm), 0) as ts
      from ath group by ath.gk
    ),
    conf as (
      select distinct tp.id as pid, coalesce(tp.is_goalkeeper, false) as gk
      from public.event_rsvps rr join public.turma_players tp on tp.id = rr.turma_player_id and tp.turma_id = e.turma_id
      where rr.event_id = ev and rr.status = 'vou'
    ),
    r as (
      select c.pid, c.gk, coalesce(a.n, 0)::integer as n,
             (coalesce(a.n, 0) * case when coalesce(a.wm, 0) > 0 then a.wg / a.wm else 0 end + 3 * g.tg) / (coalesce(a.n, 0) + 3) as rg,
             (coalesce(a.n, 0) * case when coalesce(a.wm, 0) > 0 then a.wa / a.wm else 0 end + 3 * g.ta) / (coalesce(a.n, 0) + 3) as ra,
             (coalesce(a.n, 0) * case when coalesce(a.wm, 0) > 0 then a.wsv / a.wm else 0 end + 3 * g.ts) / (coalesce(a.n, 0) + 3) as rs
      from conf c left join ath a on a.pid = c.pid join grp g on g.gk = c.gk
    )
    select r.pid, r.gk, r.n, round(r.rg * ej, 4), round(r.ra * ej, 4), round((r.rg + r.ra) * ej, 4), round(r.rs * ej, 4) from r;
end;
$$;

-- ============ Matemática ============
-- Linha com vírgula ("25,5"). Antes só ia até 9,9; o Total de gols do dia passa de 10.
create or replace function private.prop_fmt(l numeric) returns text
language sql immutable set search_path = '' as $$ select replace(to_char(l, 'FM99990.0'), '.', ','); $$;

-- Duelo: P(A > B) e P(B > A) com Poisson independentes de 0 a 15. O empate devolve, então vale a chance condicional.
create or replace function private.prop_duel_p(la numeric, lb numeric) returns numeric
language plpgsql immutable set search_path = '' as $$
declare a integer; b integer; pa numeric; win numeric := 0; lose numeric := 0;
begin
  if la is null or lb is null then return null; end if;
  for a in 0 .. 15 loop
    pa := private.prop_pmf(la, a);
    for b in 0 .. 15 loop
      if a > b then win := win + pa * private.prop_pmf(lb, b);
      elsif b > a then lose := lose + pa * private.prop_pmf(lb, b);
      end if;
    end loop;
  end loop;
  if win + lose <= 0 then return null; end if;
  return win / (win + lose);
end;
$$;

-- Destaque do dia: chance de cada atleta ficar no topo (empate no topo conta):
-- p_i = Σ_k P(X_i = k) · Π_{j≠i} P(X_j ≤ k), k de 0 a 15. opts = [{key, lam}]. Devolve [{key, lam, p, odd}] da maior chance para a menor.
create or replace function private.prop_leader_sel(opts jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  with o as (select x ->> 'key' as key, (x ->> 'lam')::numeric as lam from jsonb_array_elements(coalesce(opts, '[]'::jsonb)) x),
  pm as (
    select o.key, o.lam, k.k, private.prop_pmf(o.lam, k.k) as f,
           sum(private.prop_pmf(o.lam, k.k)) over (partition by o.key order by k.k) as cdf
    from o cross join generate_series(0, 15) as k(k)
  ),
  pi as (
    select a.key, a.lam,
           sum(a.f * coalesce((select exp(sum(ln(greatest(b.cdf, 1e-30)))) from pm b where b.key <> a.key and b.k = a.k), 1)) as p
    from pm a group by a.key, a.lam
  )
  select coalesce(jsonb_agg(jsonb_build_object('key', pi.key, 'lam', pi.lam, 'p', round(pi.p, 4), 'odd', private.prop_odd(pi.p)) order by pi.p desc, pi.key), '[]'::jsonb) from pi;
$$;

-- Total do baba: os últimos 10 babas finalizados da turma (todos os locais), peso 0,5^(idade/4).
create or replace function private.total_hist(t uuid)
returns table (wt numeric, matches numeric, goals numeric)
language sql stable security definer set search_path = '' as $$
  select w.wt, coalesce(w.bmatches, 0)::numeric, coalesce((select sum(s.goals) from public.baba_stats s where s.baba_id = w.bid), 0)::numeric
  from private.prop_window(t, null) w;
$$;

-- P(Mais) = (Σ w·[total > L] + 0,5) / (Σ w + 1); P(Menos) igual com [total < L]. Linha inteira (o adm moveu 0,5): o empate devolve,
-- então as duas chances são normalizadas para somar 1.
create or replace function private.total_sel(t uuid, metric text, line numeric) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare sw numeric; om numeric; ou numeric; pm numeric; pu numeric;
begin
  select coalesce(sum(h.wt), 0),
         coalesce(sum(h.wt) filter (where (case metric when 'matches' then h.matches else h.goals end) > line), 0),
         coalesce(sum(h.wt) filter (where (case metric when 'matches' then h.matches else h.goals end) < line), 0)
    into sw, om, ou from private.total_hist(t) h;
  pm := (om + 0.5) / (sw + 1); pu := (ou + 0.5) / (sw + 1);
  if pm + pu > 0 then pm := pm / (pm + pu); pu := 1 - pm; end if;
  return jsonb_build_array(
    jsonb_build_object('key', 'mais', 'label', 'Mais ' || private.prop_fmt(line), 'odd', private.prop_odd(pm), 'p', round(pm, 4)),
    jsonb_build_object('key', 'menos', 'label', 'Menos ' || private.prop_fmt(line), 'odd', private.prop_odd(pu), 'p', round(pu, 4)));
end;
$$;

-- A linha de meio ponto com P(Mais) mais perto de 50%, entre 35% e 65%. Null = não abre. Mínimo de 5 babas finalizados.
create or replace function private.total_pick_line(t uuid, metric text) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare nb integer; mx numeric; l numeric; p numeric; best numeric; bestd numeric := 9;
begin
  select count(*), max(case metric when 'matches' then h.matches else h.goals end) into nb, mx from private.total_hist(t) h;
  if nb < 5 then return null; end if;
  for l in select g + 0.5 from generate_series(0, greatest(floor(coalesce(mx, 0))::integer, 0)) g loop
    p := ((private.total_sel(t, metric, l) -> 0) ->> 'p')::numeric;
    if p >= 0.35 and p <= 0.65 and abs(p - 0.5) < bestd then best := l; bestd := abs(p - 0.5); end if;
  end loop;
  return best;
end;
$$;

-- ============ Geração (preguiçosa) ============
-- Duelos: atletas de linha cadastrados e não estreantes, ordenados por λ de G+A; pares de vizinhos com chance entre 35% e 65%.
-- Cada atleta em no máximo um duelo, no máximo 3 por evento. Quem já está num duelo não entra em outro numa leitura seguinte.
create or replace function private.gen_duels(ev uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare e public.turma_events; cnt integer; used uuid[]; r record; prev_pid uuid; prev_l numeric; p numeric; got integer; n_new integer := 0;
begin
  select * into e from public.turma_events where id = ev;
  select count(*) into cnt from public.prop_markets where event_id = ev and kind = 'duel';
  if cnt >= 3 then return 0; end if;
  select coalesce(array_agg(x), '{}') into used from (
    select player_id as x from public.prop_markets where event_id = ev and kind = 'duel'
    union select player2_id from public.prop_markets where event_id = ev and kind = 'duel') q where x is not null;
  for r in select x.pid, x.lga from private.prop_rates(ev) x where not x.gk and x.n > 0 and x.lga > 0 and not (x.pid = any (used))
           order by x.lga desc, x.pid loop
    if prev_pid is null then prev_pid := r.pid; prev_l := r.lga; continue; end if;
    p := private.prop_duel_p(prev_l, r.lga);
    if p is not null and p >= 0.35 and p <= 0.65 then
      insert into public.prop_markets (event_id, turma_id, player_id, player2_id, kind, metric, selections, lambda, sample_n)
      values (ev, e.turma_id, prev_pid, r.pid, 'duel', 'ga',
              jsonb_build_array(jsonb_build_object('key', prev_pid::text, 'lam', prev_l, 'odd', private.prop_odd(p), 'p', round(p, 4)),
                                jsonb_build_object('key', r.pid::text, 'lam', r.lga, 'odd', private.prop_odd(1 - p), 'p', round(1 - p, 4))),
              prev_l, 0)
      on conflict do nothing;
      get diagnostics got = row_count; n_new := n_new + got; cnt := cnt + got;
      if cnt >= 3 then exit; end if;
      prev_pid := null; prev_l := null;
    else
      prev_pid := r.pid; prev_l := r.lga;
    end if;
  end loop;
  return n_new;
end;
$$;

-- Destaque do dia: Artilheiro (gols) e Garçom (assistências) com os atletas de linha cadastrados (mínimo 4), Paredão (defesas)
-- com os goleiros (mínimo 2). Quem confirma depois entra nas opções enquanto o mercado está aberto (as cotações são refeitas;
-- palpite feito fica com a cotação da hora). Ninguém sai das opções: quem não jogar tem o palpite devolvido.
create or replace function private.gen_leaders(ev uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare e public.turma_events; k integer; mets text[] := array['goals', 'assists', 'saves']; mins integer[] := array[4, 4, 2];
  m public.prop_markets; cand jsonb; ncand integer; allopts jsonb; got integer; n_new integer := 0;
begin
  select * into e from public.turma_events where id = ev;
  for k in 1 .. 3 loop
    select coalesce(jsonb_agg(jsonb_build_object('key', x.pid::text, 'lam', case mets[k] when 'goals' then x.lg when 'assists' then x.la else x.ls end) order by x.pid), '[]'::jsonb), count(*)
      into cand, ncand from private.prop_rates(ev) x where x.gk = (mets[k] = 'saves');
    select * into m from public.prop_markets where event_id = ev and kind = 'leader' and metric = mets[k] and player_id is null;
    if m.id is null then
      if ncand < mins[k] then continue; end if;
      insert into public.prop_markets (event_id, turma_id, kind, metric, selections, sample_n)
      values (ev, e.turma_id, 'leader', mets[k], private.prop_leader_sel(cand), ncand) on conflict do nothing;
      get diagnostics got = row_count; n_new := n_new + got;
    elsif m.status = 'open' and exists (select 1 from jsonb_array_elements(cand) c where not exists (select 1 from jsonb_array_elements(m.selections) s where s ->> 'key' = c ->> 'key')) then
      select jsonb_agg(jsonb_build_object('key', s ->> 'key', 'lam', (s ->> 'lam')::numeric)) || coalesce((
               select jsonb_agg(c) from jsonb_array_elements(cand) c where not exists (select 1 from jsonb_array_elements(m.selections) s2 where s2 ->> 'key' = c ->> 'key')), '[]'::jsonb)
        into allopts from jsonb_array_elements(m.selections) s;
      update public.prop_markets set selections = private.prop_leader_sel(allopts), sample_n = jsonb_array_length(allopts) where id = m.id;
    end if;
  end loop;
  return n_new;
end;
$$;

-- Total do baba: Mais/Menos de partidas no dia e de gols no dia, pelo histórico da turma dona do evento.
create or replace function private.gen_totals(ev uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare e public.turma_events; met text; ln numeric; got integer; n_new integer := 0;
begin
  select * into e from public.turma_events where id = ev;
  foreach met in array array['matches', 'goals'] loop
    if exists (select 1 from public.prop_markets where event_id = ev and kind = 'baba_total' and metric = met) then continue; end if;
    ln := private.total_pick_line(e.turma_id, met);
    if ln is null then continue; end if;
    insert into public.prop_markets (event_id, turma_id, kind, metric, line, selections, sample_n)
    values (ev, e.turma_id, 'baba_total', met, ln, private.total_sel(e.turma_id, met, ln), (select count(*) from private.total_hist(e.turma_id)))
    on conflict do nothing;
    get diagnostics got = row_count; n_new := n_new + got;
  end loop;
  return n_new;
end;
$$;

-- Mesma regra de abertura da v11.4 (lista aberta, sem trava, 4+ confirmados) para todos os tipos.
-- Os mercados por atleta (Mais/Menos e cravada) são os mesmos da v11.4, com o λ de private.prop_rates.
create or replace function private.generate_prop_markets(ev uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare e public.turma_events; nconf integer; n_new integer := 0; got integer; r record; ln numeric; rookie boolean;
begin
  select * into e from public.turma_events where id = ev;
  if e.id is null or e.status <> 'open' or private.prop_locked(ev) then return 0; end if;
  select count(*) into nconf from public.event_rsvps where event_id = ev and status = 'vou';
  if nconf < 4 then return 0; end if;
  for r in select * from private.prop_rates(ev) loop
    rookie := r.n = 0;
    if not r.gk then
      ln := private.prop_pick_line(r.lg);
      if ln is not null then
        insert into public.prop_markets (event_id, turma_id, player_id, kind, metric, line, selections, lambda, sample_n, rookie)
        values (ev, e.turma_id, r.pid, 'ou', 'goals', ln, private.prop_selections('ou', r.lg, ln), r.lg, r.n, rookie) on conflict do nothing;
        get diagnostics got = row_count; n_new := n_new + got;
        insert into public.prop_markets (event_id, turma_id, player_id, kind, metric, line, selections, lambda, sample_n, rookie)
        values (ev, e.turma_id, r.pid, 'exact', 'goals', null, private.prop_selections('exact', r.lg, null), r.lg, r.n, rookie) on conflict do nothing;
        get diagnostics got = row_count; n_new := n_new + got;
      end if;
      ln := private.prop_pick_line(r.la);
      if ln is not null then
        insert into public.prop_markets (event_id, turma_id, player_id, kind, metric, line, selections, lambda, sample_n, rookie)
        values (ev, e.turma_id, r.pid, 'ou', 'assists', ln, private.prop_selections('ou', r.la, ln), r.la, r.n, rookie) on conflict do nothing;
        get diagnostics got = row_count; n_new := n_new + got;
      end if;
      ln := private.prop_pick_line(r.lga);
      if ln is not null then
        insert into public.prop_markets (event_id, turma_id, player_id, kind, metric, line, selections, lambda, sample_n, rookie)
        values (ev, e.turma_id, r.pid, 'ou', 'ga', ln, private.prop_selections('ou', r.lga, ln), r.lga, r.n, rookie) on conflict do nothing;
        get diagnostics got = row_count; n_new := n_new + got;
      end if;
    else
      ln := private.prop_pick_line(r.ls);
      if ln is not null then
        insert into public.prop_markets (event_id, turma_id, player_id, kind, metric, line, selections, lambda, sample_n, rookie)
        values (ev, e.turma_id, r.pid, 'ou', 'saves', ln, private.prop_selections('ou', r.ls, ln), r.ls, r.n, rookie) on conflict do nothing;
        get diagnostics got = row_count; n_new := n_new + got;
      end if;
    end if;
  end loop;
  n_new := n_new + private.gen_duels(ev) + private.gen_leaders(ev) + private.gen_totals(ev);
  return n_new;
end;
$$;

-- ============ Liquidação ============
-- Números de um atleta da turma num baba (casa pelo id ou, sem id, pelo nome).
create or replace function private.prop_pstat(baba uuid, pid uuid)
returns table (g numeric, a numeric, sv numeric, mt numeric)
language sql stable security definer set search_path = '' as $$
  select sum(s.goals)::numeric, sum(s.assists)::numeric, sum(s.saves)::numeric, sum(s.matches)::numeric
  from public.turma_players tp join public.baba_stats s on s.baba_id = baba
   and (s.turma_player_id = tp.id or (s.turma_player_id is null and lower(trim(s.name)) = lower(trim(tp.name))))
  where tp.id = pid;
$$;

-- Duelo, Destaque e Total. Idempotente: só mexe no mercado se o resultado mudou (correção de stats desfaz e liquida de novo).
create or replace function private.settle_fase2(ev uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare bb public.babas; m public.prop_markets; b public.prop_bets; st record; want text; why text; res jsonb; n integer := 0;
  va numeric; vb numeric; win text; o jsonb; val numeric; top numeric; tops text[]; absent text[]; played jsonb; ntop integer; pay integer; won boolean;
begin
  select * into bb from public.babas where event_id = ev and finished order by created_at desc limit 1;
  if bb.id is null then return 0; end if;
  if not exists (select 1 from public.baba_stats where baba_id = bb.id) then return 0; end if;
  for m in select * from public.prop_markets x where x.event_id = ev and x.kind in ('duel', 'leader', 'baba_total')
           and (x.status in ('open', 'locked', 'settled') or (x.status = 'void' and x.void_reason in ('ausente', 'zero'))) order by x.id for update loop
    win := null; tops := '{}'; absent := '{}'; why := null;
    if m.kind = 'duel' then
      select * into st from private.prop_pstat(bb.id, m.player_id);
      if coalesce(st.mt, 0) = 0 then why := 'ausente'; else va := coalesce(st.g, 0) + coalesce(st.a, 0); end if;
      select * into st from private.prop_pstat(bb.id, m.player2_id);
      if coalesce(st.mt, 0) = 0 then why := 'ausente'; else vb := coalesce(st.g, 0) + coalesce(st.a, 0); end if;
      if why is null then
        win := case when va > vb then m.player_id::text when vb > va then m.player2_id::text end;
        res := jsonb_build_object('value', va::integer, 'value2', vb::integer, 'win', coalesce(win, 'empate'));
      end if;
    elsif m.kind = 'leader' then
      played := '[]'::jsonb;
      for o in select * from jsonb_array_elements(m.selections) loop
        select * into st from private.prop_pstat(bb.id, (o ->> 'key')::uuid);
        if coalesce(st.mt, 0) = 0 then absent := absent || (o ->> 'key');
        else
          val := coalesce(case m.metric when 'goals' then st.g when 'assists' then st.a else st.sv end, 0);
          played := played || jsonb_build_object('key', o ->> 'key', 'v', val);
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
      val := case m.metric when 'matches' then coalesce(bb.matches, 0) else coalesce((select sum(s.goals) from public.baba_stats s where s.baba_id = bb.id), 0) end;
      win := case when val > m.line then 'mais' when val < m.line then 'menos' end;
      res := jsonb_build_object('value', val::integer, 'win', coalesce(win, 'empate'));
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

-- O mesmo settle_event da v11.4.1 (Mais/Menos com a linha de cada palpite e cravada) + os tipos novos no fim.
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
    select sum(s.goals) as g, sum(s.assists) as a, sum(s.saves) as sv, sum(s.matches) as mt into st
      from public.baba_stats s
     where s.baba_id = bb.id and (s.turma_player_id = m.player_id or (s.turma_player_id is null and lower(trim(s.name)) = lower(trim(pn))));
    absent := st.mt is null or st.mt = 0;
    if absent then
      want := 'void'; res := jsonb_build_object('void', 'ausente');
    else
      val := case m.metric when 'goals' then st.g when 'assists' then st.a when 'saves' then st.sv when 'ga' then coalesce(st.g, 0) + coalesce(st.a, 0) end;
      val := coalesce(val, 0);
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

-- ============ RPCs de palpite ============
-- Mercados do evento com o meu palpite em cada um. Duelo e Destaque trazem o nome de cada opção (label) e se a opção sou eu (mine).
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
    'adult', private.is_adult(uid),
    'confirmed', (select count(*) from public.event_rsvps where event_id = e.id and status = 'vou'),
    'markets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'player_id', m.player_id, 'player', tp.name, 'keeper', coalesce(tp.is_goalkeeper, false),
        'mine', tp.user_id = uid, 'kind', m.kind, 'metric', m.metric, 'line', m.line,
        'player2_id', m.player2_id, 'player2', tp2.name, 'mine2', tp2.user_id = uid,
        'selections', case when m.kind in ('duel', 'leader') then (
            select coalesce(jsonb_agg(s || jsonb_build_object('label', coalesce(px.name, '?'), 'mine', coalesce(px.user_id = uid, false)) order by q.ord), '[]'::jsonb)
            from jsonb_array_elements(m.selections) with ordinality q(s, ord) left join public.turma_players px on px.id::text = q.s ->> 'key')
          else m.selections end,
        'ladder', case when m.kind = 'ou' then private.prop_ladder(m.lambda) end,
        'rookie', m.rookie, 'status', m.status, 'result', m.result, 'void_reason', m.void_reason,
        'adjusted', m.edited_by is not null, 'has_bets', exists (select 1 from public.prop_bets x where x.market_id = m.id),
        'bet', (select jsonb_build_object('selection', b.selection, 'line', coalesce(b.line, m.line), 'stake', b.stake, 'odd', b.odd, 'status', b.status, 'payout', b.payout)
                from public.prop_bets b where b.market_id = m.id and b.user_id = uid))
        order by case when m.kind in ('ou', 'exact') then 0 when m.kind = 'duel' then 1 when m.kind = 'leader' then 2 else 3 end,
                 tp.name, case m.metric when 'goals' then 1 when 'assists' then 2 when 'ga' then 3 when 'saves' then 4 when 'matches' then 5 else 6 end, m.kind desc)
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
  if m.kind = 'ou' then
    if place_prop_bet.selection not in ('mais', 'menos') then raise exception 'bad_selection'; end if;
    ln := coalesce(p_line, m.line);
    select x into lad from jsonb_array_elements(private.prop_ladder(m.lambda)) x where (x ->> 'line')::numeric = ln limit 1;
    if lad is null then raise exception 'bad_line'; end if;
    sel := lad -> place_prop_bet.selection;
    if not (sel ->> 'ok')::boolean then raise exception 'bad_line'; end if;
    if tp_user = uid and place_prop_bet.selection = 'menos' then raise exception 'self_under'; end if;
  elsif m.kind = 'exact' then
    ln := null;
    select x into sel from jsonb_array_elements(m.selections) x where x ->> 'key' = place_prop_bet.selection limit 1;
    if sel is null then raise exception 'bad_selection'; end if;
    if tp_user = uid and m.metric = 'goals' then raise exception 'self_exact'; end if;
  else
    -- duel / leader: a chave é o id do atleta; baba_total: mais/menos na linha do mercado.
    select x into sel from jsonb_array_elements(m.selections) x where x ->> 'key' = place_prop_bet.selection limit 1;
    if sel is null then raise exception 'bad_selection'; end if;
    ln := case when m.kind = 'baba_total' then m.line end;
    if m.kind = 'duel' and ((tp_user = uid and place_prop_bet.selection = m.player2_id::text) or (tp2_user = uid and place_prop_bet.selection = m.player_id::text)) then
      raise exception 'self_against';
    end if;
  end if;
  if exists (select 1 from public.prop_bets b where b.market_id = market and b.user_id = uid) then raise exception 'already_bet'; end if;
  o := least(greatest(round((sel ->> 'odd')::numeric, 2), 1.05), 20);
  perform 1 from public.my_wallet();
  insert into public.prop_bets (market_id, user_id, selection, stake, odd, line) values (market, uid, place_prop_bet.selection, stake, o, ln) returning id into bid;
  bal := private.add_points(uid, -stake, 'palpite-pre', bid::text);
  return query select bid, bal, o, floor(stake * o)::integer;
end;
$$;

-- Adm: Mais/Menos por atleta continua indo para a linha vizinha (±1); Total do baba anda de 0,5 em 0,5. Só sem nenhum palpite.
-- Duelo e Destaque não têm linha: só Suspender.
create or replace function public.adjust_prop_line(market uuid, line numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); m public.prop_markets;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into m from public.prop_markets x where x.id = market for update;
  if m.id is null then raise exception 'market_closed'; end if;
  if not private.is_admin(m.turma_id) then raise exception 'not_allowed'; end if;
  perform private.props_refresh(m.event_id);
  select * into m from public.prop_markets x where x.id = market for update;
  if m.status = 'locked' then raise exception 'locked'; end if;
  if m.status <> 'open' or m.kind not in ('ou', 'baba_total') then raise exception 'market_closed'; end if;
  if exists (select 1 from public.prop_bets b where b.market_id = market) then raise exception 'has_bets'; end if;
  if m.kind = 'baba_total' then
    if line is null or line < 0.5 or line > 99.5 or line * 2 <> floor(line * 2) or abs(line - m.line) <> 0.5 then raise exception 'bad_line'; end if;
    update public.prop_markets set line = adjust_prop_line.line, selections = private.total_sel(m.turma_id, m.metric, adjust_prop_line.line),
      edited_by = uid, edited_at = now() where id = market;
  else
    if line is null or line < 0.5 or line > 5.5 or line - floor(line) <> 0.5 or abs(line - m.line) <> 1 then raise exception 'bad_line'; end if;
    update public.prop_markets set line = adjust_prop_line.line, selections = private.prop_selections('ou', m.lambda, adjust_prop_line.line),
      edited_by = uid, edited_at = now() where id = market;
  end if;
  return (select jsonb_build_object('line', x.line, 'selections', x.selections, 'adjusted', true) from public.prop_markets x where x.id = market);
end;
$$;

-- Extrato do adm: todos os palpites do evento (todos os tipos), com um texto pronto do que foi palpitado.
create or replace function public.prop_event_bets(event uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); e public.turma_events; rec uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into e from public.turma_events where id = event;
  if e.id is null or not private.is_admin(e.turma_id) then raise exception 'not_allowed'; end if;
  select coalesce((select b.created_by from public.babas b where b.event_id = event order by b.created_at desc limit 1), e.created_by) into rec;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', b.user_id, 'name', pr.name, 'player', tp.name, 'metric', m.metric, 'kind', m.kind,
        'line', coalesce(b.line, m.line), 'selection', b.selection, 'stake', b.stake, 'odd', b.odd, 'status', b.status, 'payout', b.payout,
        'recorder', b.user_id = rec,
        'label', case m.kind
          when 'duel' then 'Duelo ' || coalesce(tp.name, '?') || ' x ' || coalesce(tp2.name, '?') || ' · ' || coalesce(ps.name, '?')
          when 'leader' then (case m.metric when 'goals' then 'Artilheiro' when 'assists' then 'Garçom' else 'Paredão' end) || ' · ' || coalesce(ps.name, '?')
          when 'baba_total' then (case m.metric when 'matches' then 'Partidas no dia' else 'Gols no dia' end) || ' · '
                                 || (case b.selection when 'mais' then 'Mais ' else 'Menos ' end) || private.prop_fmt(coalesce(b.line, m.line))
          end) order by b.created_at)
    from public.prop_bets b join public.prop_markets m on m.id = b.market_id
    left join public.turma_players tp on tp.id = m.player_id left join public.turma_players tp2 on tp2.id = m.player2_id
    left join public.turma_players ps on m.kind in ('duel', 'leader') and ps.id::text = b.selection
    left join public.profiles pr on pr.id = b.user_id
    where m.event_id = event), '[]'::jsonb);
end;
$$;

-- ============ Ranking de palpiteiros ============
-- Só palpites pré-jogo ganhos e perdidos, de listas da turma, na temporada (semestre) da data da lista. Devolvidos e anulados não contam.
create or replace function private.prop_season_stats(t uuid, s text)
returns table (user_id uuid, name text, total integer, wins integer, staked integer, lucro integer, roi numeric, cravadas integer)
language sql stable security definer set search_path = '' as $$
  select b.user_id, coalesce(min(pr.name), 'Alguém'), count(*)::integer, (count(*) filter (where b.status = 'won'))::integer, sum(b.stake)::integer,
         (coalesce(sum(b.payout) filter (where b.status = 'won'), 0) - sum(b.stake))::integer,
         round((coalesce(sum(b.payout) filter (where b.status = 'won'), 0) - sum(b.stake))::numeric / nullif(sum(b.stake), 0), 4),
         (count(*) filter (where b.status = 'won' and m.kind = 'exact'))::integer
  from public.prop_bets b
  join public.prop_markets m on m.id = b.market_id
  join public.turma_events e on e.id = m.event_id
  left join public.profiles pr on pr.id = b.user_id
  where m.turma_id = t and b.status in ('won', 'lost')
    and private.season_of((e.starts_at at time zone 'America/Sao_Paulo')::date) = s
  group by b.user_id;
$$;

create or replace function public.prop_leaderboard(t uuid, season text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); s text := coalesce(nullif(season, ''), private.season_of(current_date)); lst jsonb; me jsonb; seasons jsonb;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if t is null or not private.is_member(t) then raise exception 'not_member'; end if;
  if s !~ '^[0-9]{4}-S[12]$' then raise exception 'bad_args'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('rank', r.rk, 'user_id', r.user_id, 'name', r.name, 'lucro', r.lucro, 'roi', r.roi,
           'wins', r.wins, 'total', r.total, 'cravadas', r.cravadas, 'me', r.user_id = uid) order by r.rk), '[]'::jsonb) into lst
  from (select x.*, row_number() over (order by x.lucro desc, x.roi desc nulls last, x.name, x.user_id) as rk
        from private.prop_season_stats(t, s) x where x.total >= 10) r;
  select jsonb_build_object('total', coalesce(x.total, 0), 'qualified', coalesce(x.total, 0) >= 10, 'need', 10,
           'rank', (select (r ->> 'rank')::integer from jsonb_array_elements(lst) r where (r ->> 'me')::boolean))
    into me from (select 1) one left join private.prop_season_stats(t, s) x on x.user_id = uid;
  select jsonb_agg(z.s order by z.s desc) into seasons from (
    select private.season_of(current_date) as s
    union select private.season_of((e.starts_at at time zone 'America/Sao_Paulo')::date)
      from public.prop_bets b join public.prop_markets m on m.id = b.market_id join public.turma_events e on e.id = m.event_id
     where m.turma_id = t and b.status in ('won', 'lost')) z;
  return jsonb_build_object('turma_id', t, 'season', s, 'current', private.season_of(current_date), 'seasons', seasons, 'min', 10, 'rows', lst, 'me', me);
end;
$$;

-- ============ Troféus ============
-- Os troféus de temporada de antes (artilheiro, garçom, craque, vencedor, paredão) + Pé-quente e Mãe Diná, no mesmo momento.
-- Pé-quente: 1º do ranking de palpiteiros (10+ palpites resolvidos), só com lucro maior que 0.
-- Mãe Diná: quem mais acertou cravadas, mínimo de 2, desempate por lucro. Um de cada por turma e temporada (rodar de novo não duplica).
create or replace function private.award_seasons(t uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s text; k integer; kinds text[] := array['artilheiro', 'garcom', 'craque', 'vencedor', 'paredao'];
  metrics text[] := array['goals', 'assists', 'part', 'wins', 'saves'];
  titles text[] := array['Artilheiro da temporada', 'Garçom da temporada', 'Craque da temporada', 'Mais vitórias da temporada', 'Paredão da temporada'];
  w record; nb integer; cur date := private.season_start(private.season_of(current_date));
begin
  for s in select distinct private.season_of(b.played_on) from public.babas b
           where b.finished and t = any (b.turma_ids) and b.played_on < cur loop
    select count(distinct b.id) into nb from public.babas b where b.finished and t = any (b.turma_ids) and b.played_on >= private.season_start(s) and b.played_on < private.season_end(s);
    if nb < 3 then continue; end if;
    for k in 1 .. array_length(kinds, 1) loop
      select x.pid, x.pname, private.metric_of(metrics[k], x.goals, x.assists, x.saves, x.matches, x.wins) as v into w
      from private.stat_rows(t, private.season_start(s), private.season_end(s), null) x
      where private.metric_of(metrics[k], x.goals, x.assists, x.saves, x.matches, x.wins) > 0
      order by private.metric_of(metrics[k], x.goals, x.assists, x.saves, x.matches, x.wins) desc, x.matches asc, x.pname limit 1;
      if w.pid is not null then
        insert into public.turma_trophies (turma_id, scope, kind, title, season, player_id, player_name, value)
        values (t, 'atleta', kinds[k], titles[k], s, w.pid, w.pname, w.v) on conflict do nothing;
      end if;
    end loop;
  end loop;
  for s in select distinct private.season_of((e.starts_at at time zone 'America/Sao_Paulo')::date)
           from public.prop_bets b join public.prop_markets m on m.id = b.market_id join public.turma_events e on e.id = m.event_id
           where m.turma_id = t and b.status in ('won', 'lost') loop
    if private.season_start(s) >= cur then continue; end if;
    select x.user_id, x.name, x.lucro as v into w from private.prop_season_stats(t, s) x
     where x.total >= 10 order by x.lucro desc, x.roi desc nulls last, x.name, x.user_id limit 1;
    if w.user_id is not null and w.v > 0 then
      insert into public.turma_trophies (turma_id, scope, kind, title, season, player_id, player_name, value, user_id)
      values (t, 'atleta', 'pe_quente', 'Pé-quente da temporada', s,
              (select tp.id from public.turma_players tp where tp.turma_id = t and tp.user_id = w.user_id limit 1), w.name, w.v, w.user_id)
      on conflict do nothing;
    end if;
    select x.user_id, x.name, x.cravadas as v into w from private.prop_season_stats(t, s) x
     where x.cravadas >= 2 order by x.cravadas desc, x.lucro desc, x.name, x.user_id limit 1;
    if w.user_id is not null then
      insert into public.turma_trophies (turma_id, scope, kind, title, season, player_id, player_name, value, user_id)
      values (t, 'atleta', 'mae_dina', 'Mãe Diná da temporada', s,
              (select tp.id from public.turma_players tp where tp.turma_id = t and tp.user_id = w.user_id limit 1), w.name, w.v, w.user_id)
      on conflict do nothing;
    end if;
  end loop;
end;
$$;

-- Troféus de uma conta (Perfil e card): os de atleta (pelo cadastro ligado à conta) e os de palpiteiro, das turmas que eu consigo ver.
create or replace function public.user_trophies(u uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); who uuid := coalesce(u, (select auth.uid())); t uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  for t in select distinct m.turma_id from public.turma_members m where m.user_id = who and private.can_see(m.turma_id) loop
    perform private.award_seasons(t);
  end loop;
  return coalesce((
    select jsonb_agg(jsonb_build_object('kind', x.kind, 'title', x.title, 'season', x.season, 'value', x.value, 'turma_id', x.turma_id, 'turma', tu.name)
             order by x.season desc, x.id)
    from public.turma_trophies x join public.turmas tu on tu.id = x.turma_id
    where x.scope = 'atleta' and private.can_see(x.turma_id)
      and (x.user_id = who or (x.user_id is null and exists (select 1 from public.turma_players tp where tp.id = x.player_id and tp.user_id = who)))), '[]'::jsonb);
end;
$$;

-- ============ Permissões ============
revoke execute on function private.prop_rates(uuid), private.prop_duel_p(numeric, numeric), private.prop_leader_sel(jsonb), private.total_hist(uuid),
  private.total_sel(uuid, text, numeric), private.total_pick_line(uuid, text), private.gen_duels(uuid), private.gen_leaders(uuid), private.gen_totals(uuid),
  private.generate_prop_markets(uuid), private.prop_pstat(uuid, uuid), private.settle_fase2(uuid), private.settle_event(uuid),
  private.prop_season_stats(uuid, text), private.award_seasons(uuid) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.prop_markets(uuid)', 'public.place_prop_bet(uuid, text, integer, numeric)', 'public.adjust_prop_line(uuid, numeric)',
    'public.prop_event_bets(uuid)', 'public.prop_leaderboard(uuid, text)', 'public.user_trophies(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
