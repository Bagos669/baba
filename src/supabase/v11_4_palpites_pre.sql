-- BABA v11.4: Palpites pré-jogo (fase 1). Mais/Menos de gols, assistências, G+A e defesas, e cravada de gols,
-- por atleta confirmado na lista (turma_events). Linha, cotação, trava, liquidação e anulação vivem aqui no banco.
-- Rode DEPOIS do v11_3_turmas.sql. Pode rodar mais de uma vez e não apaga nada que já existe.
-- Só Baba Points: não se compram, não se sacam, não se transferem. No app: "palpite" e "cotação".

-- ============ Ligação lista <-> baba ============
-- Preenchida quando o baba começa a partir do evento do dia. Babas antigos ficam com null e não têm palpites.
alter table public.babas add column if not exists event_id uuid references public.turma_events(id) on delete set null;
create index if not exists babas_event on public.babas (event_id) where event_id is not null;

-- Só vale se o evento é de uma das turmas do baba e quem criou o baba é adm da turma (ou criou a lista).
-- Qualquer outro valor vira null em silêncio, para não travar a fila de envio do celular.
create or replace function private.babas_event_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.event_id is not null and not exists (
    select 1 from public.turma_events e
    where e.id = new.event_id and e.turma_id = any (new.turma_ids)
      and (e.created_by = new.created_by
           or exists (select 1 from public.turma_members m where m.turma_id = e.turma_id and m.user_id = new.created_by and m.role = 'admin'))
  ) then
    new.event_id := null;
  end if;
  return new;
end;
$$;
drop trigger if exists babas_event_guard on public.babas;
create trigger babas_event_guard before insert or update of event_id, turma_ids on public.babas
  for each row execute function private.babas_event_guard();

-- ============ Tabelas ============
create table if not exists public.prop_markets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.turma_events(id) on delete cascade,
  turma_id uuid not null references public.turmas(id) on delete cascade,
  player_id uuid references public.turma_players(id) on delete cascade,
  kind text not null check (kind in ('ou', 'exact', 'duel', 'leader', 'baba_total')),
  metric text not null,
  line numeric(4, 1),
  selections jsonb not null default '[]'::jsonb,
  lambda numeric,
  sample_n integer not null default 0,
  rookie boolean not null default false,
  status text not null default 'open' check (status in ('open', 'locked', 'settled', 'void')),
  result jsonb,
  void_reason text,
  edited_by uuid references auth.users(id) on delete set null,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  locked_at timestamptz,
  settled_at timestamptz,
  unique (event_id, player_id, kind, metric)
);
create index if not exists prop_markets_event on public.prop_markets (event_id, status);

create table if not exists public.prop_bets (
  id bigserial primary key,
  market_id uuid not null references public.prop_markets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  selection text not null,
  stake integer not null check (stake in (10, 25, 50, 100)),
  odd numeric(6, 2) not null,
  status text not null default 'open' check (status in ('open', 'won', 'lost', 'void')),
  payout integer not null default 0,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (market_id, user_id)
);
create index if not exists prop_bets_user on public.prop_bets (user_id, id desc);

-- Acesso só pelas funções abaixo (security definer): ninguém lê nem escreve as tabelas direto.
alter table public.prop_markets enable row level security;
alter table public.prop_bets enable row level security;
revoke all on public.prop_markets, public.prop_bets from anon, authenticated;
revoke all on sequence public.prop_bets_id_seq from anon, authenticated;

-- ============ Matemática (Poisson) ============
create or replace function private.prop_pmf(lam numeric, k integer) returns numeric
language sql immutable set search_path = '' as $$
  select exp(-lam) * power(lam, k) / factorial(k);
$$;

-- P(mais que L) para uma linha de meio ponto L.
create or replace function private.prop_pover(lam numeric, l numeric) returns numeric
language plpgsql immutable set search_path = '' as $$
declare s numeric := 0; x integer;
begin
  for x in 0 .. floor(l)::integer loop s := s + private.prop_pmf(lam, x); end loop;
  return 1 - s;
end;
$$;

-- Cotação = clamp(0,9 / p, 1,05, 20), duas casas (a mesma regra dos palpites ao vivo).
create or replace function private.prop_odd(p numeric) returns numeric
language sql immutable set search_path = '' as $$
  select case when p is null or p <= 0 then 20::numeric else least(greatest(round(0.9 / p, 2), 1.05), 20::numeric) end;
$$;

create or replace function private.prop_fmt(l numeric) returns text
language sql immutable set search_path = '' as $$ select replace(to_char(l, 'FM0.0'), '.', ','); $$;

-- A linha de meio ponto (0,5 a 5,5) com P(Mais) mais perto de 50%, desde que fique entre 35% e 65%. Null = não abre.
create or replace function private.prop_pick_line(lam numeric) returns numeric
language plpgsql immutable set search_path = '' as $$
declare l numeric; p numeric; best numeric; bestd numeric := 9;
begin
  if lam is null or lam <= 0 then return null; end if;
  for l in select g + 0.5 from generate_series(0, 5) g loop
    p := private.prop_pover(lam, l);
    if p >= 0.35 and p <= 0.65 and abs(p - 0.5) < bestd then best := l; bestd := abs(p - 0.5); end if;
  end loop;
  return best;
end;
$$;

-- Opções do mercado. ou = Mais/Menos na linha; exact = cravada de 0 a 5 e "6 ou mais".
create or replace function private.prop_selections(kind text, lam numeric, line numeric) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare p numeric; k integer; acc numeric := 0; out jsonb := '[]'::jsonb;
begin
  if kind = 'ou' then
    p := private.prop_pover(lam, line);
    return jsonb_build_array(
      jsonb_build_object('key', 'mais', 'label', 'Mais ' || private.prop_fmt(line), 'odd', private.prop_odd(p), 'p', round(p, 4)),
      jsonb_build_object('key', 'menos', 'label', 'Menos ' || private.prop_fmt(line), 'odd', private.prop_odd(1 - p), 'p', round(1 - p, 4)));
  end if;
  for k in 0 .. 5 loop
    p := private.prop_pmf(lam, k); acc := acc + p;
    out := out || jsonb_build_object('key', k::text, 'label', k::text, 'odd', private.prop_odd(p), 'p', round(p, 4));
  end loop;
  p := 1 - acc;
  return out || jsonb_build_object('key', '6+', 'label', '6 ou mais', 'odd', private.prop_odd(p), 'p', round(p, 4));
end;
$$;

-- ============ Dados de histórico ============
-- Os últimos 10 babas finalizados da turma (0 = mais recente), com o peso 0,5^(idade/4).
-- venue: quando não é null, só entram babas desse local.
create or replace function private.prop_window(t uuid, venue text)
returns table (bid uuid, bmatches integer, bevent uuid, age integer, wt numeric)
language sql stable security definer set search_path = '' as $$
  select x.id, x.matches, x.event_id, x.age::integer, power(0.5, x.age / 4.0)::numeric
  from (select b.id, b.matches, b.event_id, b.played_on, b.created_at,
               row_number() over (order by b.played_on desc, b.created_at desc) - 1 as age
        from public.babas b
        where b.finished and t = any (b.turma_ids) and (venue is null or b.state ->> 'venue' = venue)
        order by b.played_on desc, b.created_at desc limit 10) x;
$$;

-- Números de cada atleta da turma em cada baba da janela (casa pelo id ou, sem id, pelo nome).
create or replace function private.prop_stats(t uuid, venue text)
returns table (pid uuid, gk boolean, bid uuid, bevent uuid, wt numeric, g numeric, a numeric, sv numeric, m numeric)
language sql stable security definer set search_path = '' as $$
  select tp.id, coalesce(tp.is_goalkeeper, false), w.bid, w.bevent, w.wt,
         sum(s.goals)::numeric, sum(s.assists)::numeric, sum(s.saves)::numeric, sum(s.matches)::numeric
  from private.prop_window(t, venue) w
  join public.baba_stats s on s.baba_id = w.bid
  join public.turma_players tp on tp.turma_id = t
    and (tp.id = s.turma_player_id or (s.turma_player_id is null and lower(trim(tp.name)) = lower(trim(s.name))))
  group by tp.id, tp.is_goalkeeper, w.bid, w.bevent, w.wt;
$$;

-- ============ Trava ============
-- Trava no starts_at ou no primeiro apito do baba ligado ao evento (state.firstKickoffAt, o 1º cronômetro do dia), o que vier primeiro.
-- Baba ligado já finalizado também trava.
create or replace function private.prop_locked(ev uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.turma_events e where e.id = ev and e.starts_at <= now())
      or exists (select 1 from public.babas b where b.event_id = ev and (b.finished or b.state ->> 'firstKickoffAt' is not null));
$$;

-- ============ Geração (preguiçosa) ============
-- Abre quando a lista chega a 4 confirmados (ou faltando 24 h para o starts_at, mas nunca com menos de 4 confirmados).
-- Quem confirma depois ganha mercados na próxima leitura. Convidado sem cadastro na turma não tem mercados.
create or replace function private.generate_prop_markets(ev uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare e public.turma_events; nconf integer; ej numeric; pavg numeric; venue_f text; n_new integer := 0; got integer;
  r record; lam numeric; ln numeric; rookie boolean;
begin
  select * into e from public.turma_events where id = ev;
  if e.id is null or e.status <> 'open' or private.prop_locked(ev) then return 0; end if;
  select count(*) into nconf from public.event_rsvps where event_id = ev and status = 'vou';
  if nconf < 4 then return 0; end if;

  -- "Estatísticas detalhadas" ligada (por quem criou a lista) + baba ligado com local: só babas daquele local.
  select b.state ->> 'venue' into venue_f from public.babas b
   where b.event_id = ev and b.state ->> 'venue' in ('campo', 'society', 'futsal') order by b.created_at desc limit 1;
  if venue_f is not null and not coalesce((select (p.prefs ->> 'detailStats')::boolean from public.profiles p where p.id = e.created_by), false) then
    venue_f := null;
  end if;

  -- Jogos esperados por atleta: média nos babas da janela com lista parecida (±3 confirmados).
  select avg(s.m) into ej from private.prop_stats(e.turma_id, venue_f) s
   where s.m > 0 and s.bevent is not null
     and abs((select count(*) from public.event_rsvps rr where rr.event_id = s.bevent and rr.status = 'vou') - nconf) <= 3;
  if ej is null then
    select coalesce(nullif(avg(w.bmatches), 0), 6) into pavg from private.prop_window(e.turma_id, venue_f) w;
    ej := 2 * coalesce(pavg, 6) * 5 / nconf;   -- 5 = jogadores por time (4 na linha + goleiro)
  end if;
  ej := round(ej, 4);

  for r in
    with st as (select * from private.prop_stats(e.turma_id, venue_f)),
    ath as (
      select pid, gk, count(*) filter (where m > 0) as n, sum(m * wt) as wm, sum(g * wt) as wg, sum(a * wt) as wa, sum(sv * wt) as wsv
      from st group by pid, gk
    ),
    grp as (
      select gk, sum(wg) / nullif(sum(wm), 0) as tg, sum(wa) / nullif(sum(wm), 0) as ta, sum(wsv) / nullif(sum(wm), 0) as ts
      from ath group by gk
    ),
    conf as (
      select distinct tp.id as pid, coalesce(tp.is_goalkeeper, false) as gk
      from public.event_rsvps rr join public.turma_players tp on tp.id = rr.turma_player_id and tp.turma_id = e.turma_id
      where rr.event_id = ev and rr.status = 'vou'
    )
    select c.pid, c.gk, coalesce(a.n, 0) as n,
           (coalesce(a.n, 0) * case when coalesce(a.wm, 0) > 0 then a.wg / a.wm else 0 end + 3 * g.tg) / (coalesce(a.n, 0) + 3) as rg,
           (coalesce(a.n, 0) * case when coalesce(a.wm, 0) > 0 then a.wa / a.wm else 0 end + 3 * g.ta) / (coalesce(a.n, 0) + 3) as ra,
           (coalesce(a.n, 0) * case when coalesce(a.wm, 0) > 0 then a.wsv / a.wm else 0 end + 3 * g.ts) / (coalesce(a.n, 0) + 3) as rs
    from conf c left join ath a on a.pid = c.pid join grp g on g.gk = c.gk
  loop
    rookie := r.n = 0;
    if not r.gk then
      lam := round(r.rg * ej, 4); ln := private.prop_pick_line(lam);
      if ln is not null then
        insert into public.prop_markets (event_id, turma_id, player_id, kind, metric, line, selections, lambda, sample_n, rookie)
        values (ev, e.turma_id, r.pid, 'ou', 'goals', ln, private.prop_selections('ou', lam, ln), lam, r.n, rookie) on conflict do nothing;
        get diagnostics got = row_count; n_new := n_new + got;
        insert into public.prop_markets (event_id, turma_id, player_id, kind, metric, line, selections, lambda, sample_n, rookie)
        values (ev, e.turma_id, r.pid, 'exact', 'goals', null, private.prop_selections('exact', lam, null), lam, r.n, rookie) on conflict do nothing;
        get diagnostics got = row_count; n_new := n_new + got;
      end if;
      lam := round(r.ra * ej, 4); ln := private.prop_pick_line(lam);
      if ln is not null then
        insert into public.prop_markets (event_id, turma_id, player_id, kind, metric, line, selections, lambda, sample_n, rookie)
        values (ev, e.turma_id, r.pid, 'ou', 'assists', ln, private.prop_selections('ou', lam, ln), lam, r.n, rookie) on conflict do nothing;
        get diagnostics got = row_count; n_new := n_new + got;
      end if;
      lam := round((r.rg + r.ra) * ej, 4); ln := private.prop_pick_line(lam);
      if ln is not null then
        insert into public.prop_markets (event_id, turma_id, player_id, kind, metric, line, selections, lambda, sample_n, rookie)
        values (ev, e.turma_id, r.pid, 'ou', 'ga', ln, private.prop_selections('ou', lam, ln), lam, r.n, rookie) on conflict do nothing;
        get diagnostics got = row_count; n_new := n_new + got;
      end if;
    else
      lam := round(r.rs * ej, 4); ln := private.prop_pick_line(lam);
      if ln is not null then
        insert into public.prop_markets (event_id, turma_id, player_id, kind, metric, line, selections, lambda, sample_n, rookie)
        values (ev, e.turma_id, r.pid, 'ou', 'saves', ln, private.prop_selections('ou', lam, ln), lam, r.n, rookie) on conflict do nothing;
        get diagnostics got = row_count; n_new := n_new + got;
      end if;
    end if;
  end loop;
  return n_new;
end;
$$;

-- ============ Anulação e liquidação ============
-- Anula um mercado e devolve os pontos de todos os palpites em aberto.
create or replace function private.void_market(m uuid, why text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.prop_bets;
begin
  update public.prop_markets set status = 'void', void_reason = why, settled_at = now(), result = jsonb_build_object('void', why)
   where id = m and status in ('open', 'locked');
  if not found then return; end if;
  for b in select * from public.prop_bets where market_id = m and status = 'open' for update loop
    update public.prop_bets set status = 'void', payout = b.stake, settled_at = now() where id = b.id;
    perform private.add_points(b.user_id, b.stake, 'palpite-pre-devolvido', b.id::text);
  end loop;
end;
$$;

-- Anula todos os mercados ainda não liquidados do evento (cancelado, expirado...).
create or replace function private.void_props(ev uuid, why text) returns integer
language plpgsql security definer set search_path = '' as $$
declare m uuid; n integer := 0;
begin
  for m in select id from public.prop_markets where event_id = ev and status in ('open', 'locked') loop
    perform private.void_market(m, why); n := n + 1;
  end loop;
  return n;
end;
$$;

-- Desfaz uma liquidação (correção de stats): tira os créditos e reabre os palpites.
-- Se a pessoa já gastou os pontos, tira só o que ainda tem (o saldo nunca fica negativo e o extrato continua batendo).
create or replace function private.unsettle_market(m uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.prop_bets; amt integer;
begin
  for b in select * from public.prop_bets where market_id = m and status <> 'open' for update loop
    if b.payout > 0 then
      select least(b.payout, coalesce((select w.balance from public.wallets w where w.user_id = b.user_id), 0)) into amt;
      if amt > 0 then perform private.add_points(b.user_id, -amt, 'palpite-correcao', b.id::text); end if;
    end if;
    update public.prop_bets set status = 'open', payout = 0, settled_at = null where id = b.id;
  end loop;
  update public.prop_markets set status = 'locked', result = null, void_reason = null, settled_at = null where id = m;
end;
$$;

-- Liquida (ou corrige) os mercados do evento com os baba_stats gravados no servidor. Idempotente.
create or replace function private.settle_event(ev uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare bb public.babas; m public.prop_markets; pn text; st record; val numeric; absent boolean; win text; res jsonb; want text; n integer := 0; b public.prop_bets;
begin
  select * into bb from public.babas where event_id = ev and finished order by created_at desc limit 1;
  if bb.id is null then return 0; end if;
  -- baba finalizado mas stats ainda não chegaram (o celular grava os stats logo depois): espera.
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
        if b.selection = win then
          update public.prop_bets set status = 'won', payout = floor(b.stake * b.odd)::integer, settled_at = now() where id = b.id;
          perform private.add_points(b.user_id, floor(b.stake * b.odd)::integer, 'palpite-pre-ganho', b.id::text);
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

-- Chamada quando os stats de um baba são gravados (baba_finish) ou mudam (correção).
create or replace function private.settle_props(baba uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare ev uuid;
begin
  select event_id into ev from public.babas where id = baba and finished;
  if ev is null then return 0; end if;
  return private.settle_event(ev);
end;
$$;

-- Os stats são gravados em lote logo depois do baba ser finalizado: liquida (ou corrige) ao fim do comando.
-- Se algo der errado aqui, o baba é gravado do mesmo jeito (a liquidação preguiçosa tenta de novo na próxima leitura).
create or replace function private.props_on_stats() returns trigger
language plpgsql security definer set search_path = '' as $$
declare b uuid;
begin
  for b in select distinct baba_id from new_rows where baba_id is not null loop
    begin
      perform private.settle_props(b);
    exception when others then
      raise warning 'props_on_stats: %', sqlerrm;
    end;
  end loop;
  return null;
end;
$$;
drop trigger if exists baba_stats_props_ins on public.baba_stats;
create trigger baba_stats_props_ins after insert on public.baba_stats
  referencing new table as new_rows for each statement execute function private.props_on_stats();
drop trigger if exists baba_stats_props_upd on public.baba_stats;
create trigger baba_stats_props_upd after update on public.baba_stats
  referencing new table as new_rows for each statement execute function private.props_on_stats();

-- Mantém o evento em dia: cancelado/expirado anula, trava, liquida, e gera mercados novos.
create or replace function private.props_refresh(ev uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.turma_events;
begin
  select * into e from public.turma_events where id = ev;
  if e.id is null then return; end if;
  if e.status = 'canceled' then perform private.void_props(ev, 'cancelado'); return; end if;
  if e.starts_at < now() - interval '72 hours' and not exists (select 1 from public.babas b where b.event_id = ev and b.finished) then
    perform private.void_props(ev, 'expirado');
  end if;
  update public.prop_markets set status = 'locked', locked_at = now() where event_id = ev and status = 'open' and private.prop_locked(ev);
  begin
    perform private.settle_event(ev);
  exception when others then
    raise warning 'props_refresh settle: %', sqlerrm;
  end;
  perform private.generate_prop_markets(ev);
end;
$$;

-- ============ RPCs ============
-- Mercados do evento com o meu palpite em cada um (gera, trava e liquida de forma preguiçosa).
create or replace function public.prop_markets(event uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); e public.turma_events; adm boolean; locked boolean; ranges jsonb;
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
        'mine', tp.user_id = uid, 'kind', m.kind, 'metric', m.metric, 'line', m.line, 'selections', m.selections,
        'rookie', m.rookie, 'status', m.status, 'result', m.result, 'void_reason', m.void_reason,
        'adjusted', m.edited_by is not null, 'has_bets', exists (select 1 from public.prop_bets x where x.market_id = m.id),
        'bet', (select jsonb_build_object('selection', b.selection, 'stake', b.stake, 'odd', b.odd, 'status', b.status, 'payout', b.payout)
                from public.prop_bets b where b.market_id = m.id and b.user_id = uid))
        order by tp.name, case m.metric when 'goals' then 1 when 'assists' then 2 when 'ga' then 3 else 4 end, m.kind desc)
      from public.prop_markets m join public.turma_players tp on tp.id = m.player_id
      where m.event_id = e.id), '[]'::jsonb));
end;
$$;

-- Quantos palpites (mercados) abertos cada evento tem, para o chip do Início.
create or replace function public.prop_open_counts(events uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); ev uuid; out jsonb := '{}'::jsonb; e public.turma_events;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  for ev in select distinct x from unnest(events) x loop
    select * into e from public.turma_events where id = ev;
    if e.id is null or not private.is_member(e.turma_id) then continue; end if;
    perform private.props_refresh(ev);
    out := out || jsonb_build_object(ev::text, (select count(*) from public.prop_markets m where m.event_id = ev and m.status = 'open'));
  end loop;
  return out;
end;
$$;

create or replace function public.place_prop_bet(market uuid, selection text, stake integer)
returns table (bet_id bigint, balance integer, odd numeric, payout integer)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); m public.prop_markets; e public.turma_events; sel jsonb; o numeric; bal integer; bid bigint;
  tp_user uuid; open_sum integer;
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
  if stake is null or stake not in (10, 25, 50, 100) then raise exception 'bad_stake'; end if;
  select x into sel from jsonb_array_elements(m.selections) x where x ->> 'key' = place_prop_bet.selection limit 1;
  if sel is null then raise exception 'bad_selection'; end if;
  select tp.user_id into tp_user from public.turma_players tp where tp.id = m.player_id;
  if tp_user = uid and place_prop_bet.selection = 'menos' then raise exception 'self_under'; end if;
  if m.rookie and stake > 25 then raise exception 'limit'; end if;
  if exists (select 1 from public.prop_bets b where b.market_id = market and b.user_id = uid) then raise exception 'already_bet'; end if;
  select coalesce(sum(b.stake), 0) into open_sum from public.prop_bets b join public.prop_markets pm on pm.id = b.market_id
   where b.user_id = uid and pm.event_id = m.event_id and b.status = 'open';
  if open_sum + stake > 300 then raise exception 'limit'; end if;
  o := least(greatest(round((sel ->> 'odd')::numeric, 2), 1.05), 20);
  perform 1 from public.my_wallet();
  insert into public.prop_bets (market_id, user_id, selection, stake, odd) values (market, uid, place_prop_bet.selection, stake, o) returning id into bid;
  bal := private.add_points(uid, -stake, 'palpite-pre', bid::text);
  return query select bid, bal, o, floor(stake * o)::integer;
end;
$$;

-- Adm move a linha para a linha de meio ponto vizinha (1,5 <-> 2,5; sempre x,5 para nunca haver empate).
-- A cotação é recalculada aqui; o adm nunca digita cotação. Só enquanto o mercado não tem nenhum palpite.
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
  if m.status <> 'open' or m.kind <> 'ou' then raise exception 'market_closed'; end if;
  if exists (select 1 from public.prop_bets b where b.market_id = market) then raise exception 'has_bets'; end if;
  if line is null or line < 0.5 or line > 5.5 or line - floor(line) <> 0.5 or abs(line - m.line) <> 1 then raise exception 'bad_line'; end if;
  update public.prop_markets set line = adjust_prop_line.line, selections = private.prop_selections('ou', m.lambda, adjust_prop_line.line),
    edited_by = uid, edited_at = now() where id = market;
  return (select jsonb_build_object('line', x.line, 'selections', x.selections, 'adjusted', true) from public.prop_markets x where x.id = market);
end;
$$;

-- Adm suspende um mercado (com ou sem palpites): anula e devolve tudo.
create or replace function public.suspend_prop_market(market uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); m public.prop_markets; n integer;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into m from public.prop_markets x where x.id = market for update;
  if m.id is null then raise exception 'market_closed'; end if;
  if not private.is_admin(m.turma_id) then raise exception 'not_allowed'; end if;
  if m.status not in ('open', 'locked') then raise exception 'market_closed'; end if;
  select count(*) into n from public.prop_bets where market_id = market and status = 'open';
  perform private.void_market(market, 'suspenso');
  update public.prop_markets set edited_by = uid, edited_at = now() where id = market;
  return n;
end;
$$;

-- Extrato do adm: todos os palpites do evento, com marca em quem registra os lances.
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
        'line', m.line, 'selection', b.selection, 'stake', b.stake, 'odd', b.odd, 'status', b.status, 'payout', b.payout,
        'recorder', b.user_id = rec) order by b.created_at)
    from public.prop_bets b join public.prop_markets m on m.id = b.market_id
    join public.turma_players tp on tp.id = m.player_id left join public.profiles pr on pr.id = b.user_id
    where m.event_id = event), '[]'::jsonb);
end;
$$;

-- ============ Permissões ============
revoke execute on function private.babas_event_guard(), private.prop_pmf(numeric, integer), private.prop_pover(numeric, numeric), private.prop_odd(numeric),
  private.prop_fmt(numeric), private.prop_pick_line(numeric), private.prop_selections(text, numeric, numeric), private.prop_window(uuid, text),
  private.prop_stats(uuid, text), private.prop_locked(uuid), private.generate_prop_markets(uuid), private.void_market(uuid, text),
  private.void_props(uuid, text), private.unsettle_market(uuid), private.settle_event(uuid), private.settle_props(uuid), private.props_on_stats(),
  private.props_refresh(uuid) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.prop_markets(uuid)', 'public.prop_open_counts(uuid[])', 'public.place_prop_bet(uuid, text, integer)',
    'public.adjust_prop_line(uuid, numeric)', 'public.suspend_prop_market(uuid)', 'public.prop_event_bets(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
