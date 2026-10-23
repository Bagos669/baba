-- v11.7 · Correções: Times fechados, corrigir ou excluir babas anteriores, nome do atleta na turma.
-- Roda depois do v11_6_1_anotador_mesario.sql. Idempotente: pode rodar de novo sem estragar nada. Não apaga dados antigos.
--
-- Como fica:
--   * baba_edit: dono ou adm da turma corrige data, local, placar das partidas e gols/assistências/defesas de um baba já finalizado.
--     Os números recalculam sozinhos (ranking, cards, troféus leem baba_stats) e os palpites já liquidados são revertidos
--     ("palpite-correcao") e liquidados de novo com os números certos.
--   * baba_remove: dono ou adm exclui um baba finalizado. Some das estatísticas e do ranking. Palpites do baba são anulados e
--     todos recebem os pontos de volta (motivo "palpite-correcao"); o prêmio de quem ganhou é revertido (nunca deixa saldo negativo).
--   * turma_player_rename: dono ou adm muda o nome de qualquer atleta da turma (só o nome dentro da turma; a conta não muda).
--     Nome vazio ou igual ao de outro atleta da turma é recusado.
--   * "Times fechados" (state.settings.teamsMode = 'closed') só muda por dono/adm: o gatilho devolve o valor do servidor para os outros.
--   * O gatilho babas_v116 ganha uma porta para o baba_edit (baba finalizado continua fechado para qualquer outra gravação).
-- Não rode o v11_6_1 de novo depois deste arquivo (ele recria a versão antiga do gatilho).

-- ============ Permissão ============
-- Dono ou adm de alguma das turmas do baba (quem só criou o baba, sendo membro comum, não conta).
create or replace function private.org_of_any(turma_ids uuid[], u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select u is not null and exists (select 1 from unnest(coalesce(turma_ids, '{}')) t(id) where private.org_of(t.id, u));
$$;

-- ============ Gatilho do baba: porta do baba_edit ============
create or replace function private.babas_v116() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if tg_op = 'UPDATE' then
    if old.finished then
      -- Baba finalizado só muda pelo baba_edit (que liga baba.edit). Qualquer outra gravação é ignorada.
      if coalesce(current_setting('baba.edit', true), '') = '1' then
        new.finished := true;
        new.rev := coalesce(old.rev, 0) + 1;
        new.updated_by := coalesce(me, new.updated_by);
        new.updated_at := now();
        return new;
      end if;
      return old;
    end if;
    -- Gravação direta (app antigo): quem não é o anotador não muda lances.
    if coalesce(current_setting('baba.rpc', true), '') <> '1' and not coalesce(new.finished, false) and old.scorer_id is not null
       and me is distinct from old.scorer_id and new.state is distinct from old.state then
      new.state := private.guard_state(new.state, old.state, true, false, null, old.lance_seq);
    end if;
    if new.rev is not distinct from old.rev then
      new.rev := coalesce(old.rev, 0) + 1;
      new.updated_by := coalesce(me, new.updated_by);
    end if;
  else
    if coalesce(new.rev, 0) = 0 then new.rev := 1; end if;
    new.updated_by := coalesce(new.updated_by, me, new.created_by);
  end if;
  if new.started_by is null and not coalesce(new.finished, false) and nullif(new.state ->> 'firstKickoffAt', '') is not null then
    new.started_by := coalesce(me, new.created_by);
    new.started_at := now();
  end if;
  if new.scorer_id is null and new.started_by is not null and not coalesce(new.finished, false) then
    new.scorer_id := new.started_by;
    if not (new.started_by = any (coalesce(new.scorers, '{}'))) then new.scorers := coalesce(new.scorers, '{}') || new.started_by; end if;
  end if;
  if coalesce(new.finished, false) then new.mesario_id := null; end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ============ Times fechados: só dono/adm mudam ============
-- Quem não é dono/adm de nenhuma turma do baba (ex.: só criou o baba sendo membro) não consegue ligar nem desligar "Times fechados":
-- o valor que já estava no servidor volta. Baba sem turma na nuvem vale para quem criou.
create or replace function private.babas_v117() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); mode_new text; mode_old text; ok boolean;
begin
  if me is null or coalesce(new.finished, false) or jsonb_typeof(new.state -> 'settings') is distinct from 'object' then return new; end if;
  mode_new := new.state -> 'settings' ->> 'teamsMode';
  mode_old := case when tg_op = 'UPDATE' then old.state -> 'settings' ->> 'teamsMode' end;
  if mode_new is not distinct from mode_old then return new; end if;
  ok := private.org_of_any(new.turma_ids, me)
        or (coalesce(array_length(new.turma_ids, 1), 0) = 0 and new.created_by = me);
  if not ok then
    new.state := jsonb_set(new.state, '{settings}', case when mode_old is null then (new.state -> 'settings') - 'teamsMode'
                                                         else jsonb_set(new.state -> 'settings', '{teamsMode}', to_jsonb(mode_old)) end);
  end if;
  return new;
end;
$$;
drop trigger if exists babas_v117 on public.babas;
create trigger babas_v117 before insert or update on public.babas
  for each row execute function private.babas_v117();

-- ============ Corrigir um baba anterior ============
-- p_played_on: nova data (null mantém). p_venue: 'campo' | 'society' | 'futsal' | '' (null mantém).
-- p_scores: [{"i": 0, "a": 2, "b": 1}] = posição da partida em state.games (0 = primeira da lista) e o placar certo.
-- p_stats:  [{"id": 123, "goals": 2, "assists": 1, "saves": 0}] = linha de baba_stats (id) e os números certos.
create or replace function public.baba_edit(p_id uuid, p_played_on date default null, p_venue text default null,
  p_scores jsonb default '[]'::jsonb, p_stats jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); b public.babas; st jsonb; r record; n integer; fixed integer := 0; a integer; c integer;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if p_id is null then raise exception 'invalid'; end if;
  select * into b from public.babas where id = p_id for update;
  if b.id is null then raise exception 'not_found'; end if;
  if not b.finished then raise exception 'not_finished'; end if;
  if not private.org_of_any(b.turma_ids, me) then raise exception 'forbidden'; end if;
  if p_venue is not null and p_venue not in ('', 'campo', 'society', 'futsal') then raise exception 'invalid_venue'; end if;
  if p_played_on is not null and (p_played_on > current_date + 1 or p_played_on < date '2000-01-01') then raise exception 'invalid_date'; end if;

  st := case when jsonb_typeof(b.state) = 'object' then b.state else '{}'::jsonb end;
  if p_venue is not null then st := jsonb_set(st, '{venue}', to_jsonb(p_venue)); end if;
  if jsonb_typeof(p_scores) = 'array' and jsonb_typeof(st -> 'games') = 'array' then
    n := jsonb_array_length(st -> 'games');
    for r in select (x ->> 'i')::integer as i, greatest(0, least(99, (x ->> 'a')::integer)) as sa, greatest(0, least(99, (x ->> 'b')::integer)) as sb
             from jsonb_array_elements(p_scores) x where x ? 'i' and x ? 'a' and x ? 'b' loop
      if r.i is null or r.i < 0 or r.i >= n then continue; end if;
      st := jsonb_set(st, array['games', r.i::text, 'scoreA'], to_jsonb(r.sa));
      st := jsonb_set(st, array['games', r.i::text, 'scoreB'], to_jsonb(r.sb));
      -- Placar deixou de ser empate: os pênaltis daquela partida não valem mais.
      if r.sa <> r.sb and (st -> 'games' -> r.i) ? 'pens' then st := jsonb_set(st, array['games', r.i::text], (st -> 'games' -> r.i) - 'pens'); end if;
      fixed := fixed + 1;
    end loop;
  end if;

  perform set_config('baba.edit', '1', true);
  update public.babas set state = st, played_on = coalesce(p_played_on, played_on) where id = p_id;
  perform set_config('baba.edit', '', true);

  -- Os stats mudam só onde o número mudou; o gatilho de baba_stats corrige a liquidação dos palpites.
  if jsonb_typeof(p_stats) = 'array' then
    update public.baba_stats s
       set goals = greatest(0, least(99, coalesce(x.goals, s.goals))), assists = greatest(0, least(99, coalesce(x.assists, s.assists))),
           saves = greatest(0, least(99, coalesce(x.saves, s.saves)))
      from jsonb_to_recordset(p_stats) as x(id bigint, goals integer, assists integer, saves integer)
     where s.id = x.id and s.baba_id = p_id
       and (s.goals, s.assists, s.saves) is distinct from (greatest(0, least(99, coalesce(x.goals, s.goals))), greatest(0, least(99, coalesce(x.assists, s.assists))),
                                                         greatest(0, least(99, coalesce(x.saves, s.saves))));
    get diagnostics c = row_count;
  end if;
  -- Idempotente: se nada mudou nos números, não mexe em nenhum palpite.
  perform private.settle_props(p_id);
  return jsonb_build_object('ok', true, 'games', fixed, 'stats', coalesce(c, 0), 'rev', (select rev from public.babas where id = p_id));
end;
$$;

-- ============ Excluir um baba anterior ============
create or replace function public.baba_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); b public.babas; ev uuid; other uuid; m public.prop_markets; bt public.prop_bets; amt integer; n integer := 0;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if p_id is null then raise exception 'invalid'; end if;
  select * into b from public.babas where id = p_id for update;
  if b.id is null then return jsonb_build_object('ok', true, 'gone', true); end if;
  if not b.finished then raise exception 'not_finished'; end if;
  if not private.org_of_any(b.turma_ids, me) then raise exception 'forbidden'; end if;
  ev := b.event_id;
  delete from public.baba_lances where baba_id = p_id;
  delete from public.baba_stats where baba_id = p_id;
  delete from public.babas where id = p_id;
  if ev is not null then
    select x.id into other from public.babas x where x.event_id = ev and x.finished order by x.created_at desc limit 1;
    if other is not null then
      -- A lista tem outro baba finalizado: os palpites passam a valer por ele.
      perform private.settle_event(ev);
    else
      for m in select * from public.prop_markets x where x.event_id = ev for update loop
        for bt in select * from public.prop_bets x where x.market_id = m.id and x.status <> 'void' for update loop
          if bt.status = 'won' and bt.payout > 0 then
            amt := least(bt.payout, coalesce((select w.balance from public.wallets w where w.user_id = bt.user_id), 0));
            if amt > 0 then perform private.add_points(bt.user_id, -amt, 'palpite-correcao', bt.id::text); end if;
          end if;
          perform private.add_points(bt.user_id, bt.stake, 'palpite-correcao', bt.id::text);
          update public.prop_bets set status = 'void', payout = bt.stake, settled_at = now() where id = bt.id;
          n := n + 1;
        end loop;
        if m.status <> 'void' then
          update public.prop_markets set status = 'void', void_reason = 'excluido', result = jsonb_build_object('void', 'excluido'), settled_at = now() where id = m.id;
        end if;
      end loop;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'refunded', n);
end;
$$;

-- ============ Nome do atleta na turma ============
create or replace function public.turma_player_rename(p_player uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); p public.turma_players; nm text := left(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), 60);
        oldk text; newk text;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  select * into p from public.turma_players where id = p_player for update;
  if p.id is null then raise exception 'not_found'; end if;
  if not private.org_of(p.turma_id, me) then raise exception 'forbidden'; end if;
  if nm = '' then raise exception 'name_empty'; end if;
  oldk := lower(trim(p.name)); newk := lower(nm);
  if exists (select 1 from public.turma_players x where x.turma_id = p.turma_id and x.id <> p.id and lower(trim(x.name)) = newk) then raise exception 'name_taken'; end if;
  if nm = p.name then return jsonb_build_object('ok', true, 'name', nm, 'same', true); end if;
  -- Linhas soltas de stats (sem id) casavam pelo nome antigo: liga ao atleta antes de mudar o nome.
  update public.baba_stats s set turma_player_id = p.id
    from public.babas b
   where b.id = s.baba_id and p.turma_id = any (b.turma_ids) and s.turma_player_id is null and lower(trim(s.name)) = oldk;
  update public.turma_players set name = nm where id = p.id;
  update public.baba_stats set name = left(nm, 60) where turma_player_id = p.id;
  -- Lista de presença (compromissos) e penalidades usam o nome em minúsculas como chave: acompanham o nome novo.
  update public.event_rsvps r set player_key = newk, name = nm
   where (r.turma_player_id = p.id or r.player_key = oldk)
     and exists (select 1 from public.turma_events e where e.id = r.event_id and e.turma_id = p.turma_id)
     and not exists (select 1 from public.event_rsvps o where o.event_id = r.event_id and o.player_key = newk and o.player_key <> r.player_key);
  update public.turma_sanctions set player_key = newk, name = nm where turma_id = p.turma_id and player_key = oldk;
  return jsonb_build_object('ok', true, 'name', nm);
end;
$$;

revoke execute on function private.org_of_any(uuid[], uuid) from public, anon;
revoke execute on function public.baba_edit(uuid, date, text, jsonb, jsonb) from public, anon;
revoke execute on function public.baba_remove(uuid) from public, anon;
revoke execute on function public.turma_player_rename(uuid, text) from public, anon;
grant execute on function public.baba_edit(uuid, date, text, jsonb, jsonb) to authenticated;
grant execute on function public.baba_remove(uuid) to authenticated;
grant execute on function public.turma_player_rename(uuid, text) to authenticated;
