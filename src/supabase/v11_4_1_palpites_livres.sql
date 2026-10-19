-- v11.4.1 · Palpites pré-jogo: o palpitador escolhe a linha, a cravada em si mesmo sai e o valor vai de 10 até o saldo todo.
-- Rode DEPOIS de v11_4_palpites_pre.sql. Idempotente: pode rodar de novo.
-- * Cada mercado "ou" passa a oferecer a escada de linhas 0,5 a 5,5 (prop_ladder); a cotação de cada linha é calculada aqui no servidor.
--   A linha escolhida fica gravada no palpite (prop_bets.line) e a cotação fica travada, como antes.
--   Só entram lados com chance entre 5% e 85%: assim a cotação nunca fica "de graça" (valor esperado sempre <= 0,9 do valor jogado).
-- * Cravada de gols em si mesmo: erro self_exact. "Menos" em si mesmo continua bloqueado (self_under); "Mais" continua liberado.
-- * Valor: mínimo 10, máximo o saldo (acabaram os tetos de 100 por mercado, 300 por evento e 25 para estreante). Segue 1 palpite por mercado.
-- * O adm não precisa mais mexer na linha (adjust_prop_line continua existindo, mas o app não usa); Suspender continua.

alter table public.prop_bets add column if not exists line numeric(4, 1);
alter table public.prop_bets drop constraint if exists prop_bets_stake_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'prop_bets_stake_min' and conrelid = 'public.prop_bets'::regclass) then
    alter table public.prop_bets add constraint prop_bets_stake_min check (stake >= 10);
  end if;
end $$;

-- Escada de linhas: para cada linha de meio ponto, o lado Mais e o lado Menos com cotação e chance. ok = pode palpitar nesse lado.
create or replace function private.prop_ladder(lam numeric) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare l numeric; p numeric; out jsonb := '[]'::jsonb; okm boolean; oku boolean;
begin
  if lam is null or lam <= 0 then return out; end if;
  for l in select g + 0.5 from generate_series(0, 5) g loop
    p := private.prop_pover(lam, l);
    okm := p >= 0.05 and p <= 0.85; oku := (1 - p) >= 0.05 and (1 - p) <= 0.85;
    if okm or oku then
      out := out || jsonb_build_object('line', l,
        'mais', jsonb_build_object('odd', private.prop_odd(p), 'p', round(p, 4), 'ok', okm),
        'menos', jsonb_build_object('odd', private.prop_odd(1 - p), 'p', round(1 - p, 4), 'ok', oku));
    end if;
  end loop;
  return out;
end;
$$;

drop function if exists public.place_prop_bet(uuid, text, integer);
create or replace function public.place_prop_bet(market uuid, selection text, stake integer, p_line numeric default null)
returns table (bet_id bigint, balance integer, odd numeric, payout integer)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); m public.prop_markets; e public.turma_events; sel jsonb; o numeric; bal integer; bid bigint;
  tp_user uuid; ln numeric; lad jsonb;
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
  if m.kind = 'ou' then
    if place_prop_bet.selection not in ('mais', 'menos') then raise exception 'bad_selection'; end if;
    ln := coalesce(p_line, m.line);
    select x into lad from jsonb_array_elements(private.prop_ladder(m.lambda)) x where (x ->> 'line')::numeric = ln limit 1;
    if lad is null then raise exception 'bad_line'; end if;
    sel := lad -> place_prop_bet.selection;
    if not (sel ->> 'ok')::boolean then raise exception 'bad_line'; end if;
  else
    ln := null;
    select x into sel from jsonb_array_elements(m.selections) x where x ->> 'key' = place_prop_bet.selection limit 1;
    if sel is null then raise exception 'bad_selection'; end if;
    if tp_user = uid and m.metric = 'goals' then raise exception 'self_exact'; end if;
  end if;
  if tp_user = uid and place_prop_bet.selection = 'menos' then raise exception 'self_under'; end if;
  if exists (select 1 from public.prop_bets b where b.market_id = market and b.user_id = uid) then raise exception 'already_bet'; end if;
  o := least(greatest(round((sel ->> 'odd')::numeric, 2), 1.05), 20);
  perform 1 from public.my_wallet();
  insert into public.prop_bets (market_id, user_id, selection, stake, odd, line) values (market, uid, place_prop_bet.selection, stake, o, ln) returning id into bid;
  bal := private.add_points(uid, -stake, 'palpite-pre', bid::text);
  return query select bid, bal, o, floor(stake * o)::integer;
end;
$$;

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
  return n;
end;
$$;

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
        'ladder', case when m.kind = 'ou' then private.prop_ladder(m.lambda) end,
        'rookie', m.rookie, 'status', m.status, 'result', m.result, 'void_reason', m.void_reason,
        'adjusted', m.edited_by is not null, 'has_bets', exists (select 1 from public.prop_bets x where x.market_id = m.id),
        'bet', (select jsonb_build_object('selection', b.selection, 'line', coalesce(b.line, m.line), 'stake', b.stake, 'odd', b.odd, 'status', b.status, 'payout', b.payout)
                from public.prop_bets b where b.market_id = m.id and b.user_id = uid))
        order by tp.name, case m.metric when 'goals' then 1 when 'assists' then 2 when 'ga' then 3 else 4 end, m.kind desc)
      from public.prop_markets m join public.turma_players tp on tp.id = m.player_id
      where m.event_id = e.id), '[]'::jsonb));
end;
$$;

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
        'recorder', b.user_id = rec) order by b.created_at)
    from public.prop_bets b join public.prop_markets m on m.id = b.market_id
    join public.turma_players tp on tp.id = m.player_id left join public.profiles pr on pr.id = b.user_id
    where m.event_id = event), '[]'::jsonb);
end;
$$;

revoke execute on function private.prop_ladder(numeric), private.settle_event(uuid) from public, anon, authenticated;
revoke execute on function public.place_prop_bet(uuid, text, integer, numeric), public.prop_markets(uuid), public.prop_event_bets(uuid) from public, anon;
grant execute on function public.place_prop_bet(uuid, text, integer, numeric), public.prop_markets(uuid), public.prop_event_bets(uuid) to authenticated;
