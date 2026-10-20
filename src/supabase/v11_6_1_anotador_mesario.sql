-- v11.6.1 · Anotador único e mesário delegado.
-- Roda depois do v11_6_baba_compartilhado.sql. Idempotente: pode rodar de novo sem estragar nada. Não apaga dados.
--
-- Como fica:
--   * Só o anotador (babas.scorer_id) grava lances, um por vez, pelo RPC baba_lance (gol, defesa, acréscimo, desfazer).
--     Cada lance tem um id do celular: repetir o envio nunca conta duas vezes. O servidor aplica o lance no estado do baba,
--     guarda quem registrou (baba_lances.created_by) e sobe a versão (rev) e o contador de lances (lance_seq).
--   * baba_save (dono/adm/mesário) nunca grava lances: placar, lances e gols/passes/defesas da partida em andamento vêm sempre
--     do servidor. Encerrar a partida só é aceito se o celular já viu todos os lances (lance_seq igual); senão: 'stale_lances'.
--   * O mesário só mexe no cronômetro e encerra a partida (a fila anda como hoje). O resto que ele mandar é ignorado.
--   * "Assumir anotação" (baba_take_scoring) e "Passar a vez de anotar" (baba_set_mesario): só dono e adms.
--     A transmissão ao vivo passa para o novo anotador (mesmo código: quem assiste não perde nada).
--   * Gravação direta na tabela (app antigo) também não consegue mudar lances de quem não é o anotador.

alter table public.babas add column if not exists scorer_id uuid;
alter table public.babas add column if not exists mesario_id uuid;
alter table public.babas add column if not exists scorers uuid[] not null default '{}';
alter table public.babas add column if not exists lance_seq bigint not null default 0;

create table if not exists public.baba_lances (
  id uuid primary key,
  baba_id uuid not null references public.babas on delete cascade,
  seq bigint not null,
  match_no integer not null,
  kind text not null check (kind in ('goal', 'save', 'extra', 'undo')),
  payload jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists baba_lances_baba on public.baba_lances (baba_id, seq);
alter table public.baba_lances enable row level security;
drop policy if exists baba_lances_select on public.baba_lances;
create policy baba_lances_select on public.baba_lances for select to authenticated using (exists (select 1 from public.babas b where b.id = baba_id and private.runs_baba(b.created_by, b.turma_ids, (select auth.uid()))));
revoke insert, update, delete on public.baba_lances from anon, authenticated;

-- Babas que já estão em andamento: o anotador começa sendo quem iniciou.
update public.babas set scorer_id = started_by, scorers = array[started_by]
where not finished and scorer_id is null and started_by is not null;

-- ============ Helpers de estado (JSON do baba) ============
create or replace function private.jarr(j jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end;
$$;
create or replace function private.jint(j jsonb) returns integer
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(j) = 'number' then (j #>> '{}')::numeric::integer else 0 end;
$$;

-- Soma delta num contador (goals/assists/saves) do atleta com esse id (nunca abaixo de 0).
create or replace function private.bump_player(st jsonb, pid text, field text, delta integer) returns jsonb
language sql immutable set search_path = '' as $$
  select case when pid is null then st else jsonb_set(st, '{players}', coalesce((
    select jsonb_agg(case when p ->> 'id' = pid then jsonb_set(p, array[field], to_jsonb(greatest(0, private.jint(p -> field) + delta))) else p end order by o)
    from jsonb_array_elements(private.jarr(st -> 'players')) with ordinality x(p, o)), '[]'::jsonb)) end;
$$;

-- Contadores de lance (gols, passes, defesas) de cada atleta vêm do servidor (atleta novo começa em 0).
create or replace function private.keep_counters(inc jsonb, srv jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_set(inc, '{players}', coalesce((
    select jsonb_agg(p || jsonb_build_object(
        'goals', private.jint(s -> 'goals'), 'assists', private.jint(s -> 'assists'), 'saves', private.jint(s -> 'saves')) order by o)
    from jsonb_array_elements(private.jarr(inc -> 'players')) with ordinality x(p, o)
    left join lateral (select y from jsonb_array_elements(private.jarr(srv -> 'players')) y where y ->> 'id' = p ->> 'id' limit 1) z(s) on true
  ), '[]'::jsonb));
$$;

-- Placar e lances da partida em andamento vêm do servidor; o acréscimo dado por lance corrige o relógio de quem mandou.
create or replace function private.keep_match_lances(inc jsonb, srv jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare m jsonb := coalesce(inc -> 'match', '{}'::jsonb); s jsonb := coalesce(srv -> 'match', '{}'::jsonb); d integer;
begin
  d := private.jint(s -> 'addedSeconds') - private.jint(m -> 'addedSeconds');
  m := m || jsonb_build_object('events', private.jarr(s -> 'events'), 'scoreA', private.jint(s -> 'scoreA'), 'scoreB', private.jint(s -> 'scoreB'),
                               'addedSeconds', private.jint(s -> 'addedSeconds'));
  if d <> 0 then
    m := m || jsonb_build_object('secondsLeft', greatest(0, private.jint(m -> 'secondsLeft') + d));
    if jsonb_typeof(m -> 'endAt') = 'number' then m := m || jsonb_build_object('endAt', (m ->> 'endAt')::numeric + d * 1000); end if;
  end if;
  return jsonb_set(inc, '{match}', m);
end;
$$;

-- O que cada um pode gravar do estado do baba (fora os lances, que só o baba_lance grava).
--   org = dono/adm; scorer = é o anotador; cli_seq = lance_seq que o celular já viu (null = app antigo).
create or replace function private.guard_state(inc jsonb, srv jsonb, org boolean, scorer boolean, cli_seq bigint, srv_seq bigint) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare hin integer := jsonb_array_length(private.jarr(inc -> 'matchHistory')); hsv integer := jsonb_array_length(private.jarr(srv -> 'matchHistory'));
  fresh boolean := cli_seq is null or cli_seq >= srv_seq; out jsonb; k text; h0 jsonb;
begin
  if srv is null or srv = '{}'::jsonb then return inc; end if;
  -- App antigo (v11.6) no celular do anotador: grava como antes.
  if cli_seq is null and scorer and org then return inc; end if;
  if hin = hsv + 1 then
    -- Fim de partida: só com todos os lances vistos e com o placar que está no servidor.
    h0 := private.jarr(inc -> 'matchHistory') -> 0;
    if not fresh or private.jint(h0 -> 'scoreA') <> private.jint(srv -> 'match' -> 'scoreA') or private.jint(h0 -> 'scoreB') <> private.jint(srv -> 'match' -> 'scoreB') then
      raise exception 'stale_lances';
    end if;
  elsif hin <> hsv and (not fresh or not org) then
    raise exception 'stale_lances';
  end if;

  if not org then
    -- Mesário: cronômetro (e o primeiro apito) e encerrar a partida. O resto fica como está no servidor.
    if hin = hsv + 1 then
      out := inc;
      foreach k in array array['settings', 'selectedTeams', 'startedAt', 'eventId', 'arrivalSeq', 'live', 'liveAsked'] loop
        if srv ? k then out := jsonb_set(out, array[k], srv -> k); else out := out - k; end if;
      end loop;
      -- Presença e chegada continuam as do servidor; jogos, vitórias e pênaltis vêm do fim da partida.
      out := jsonb_set(out, '{players}', coalesce((
        select jsonb_agg(s || jsonb_build_object('matches', coalesce(p -> 'matches', s -> 'matches', '0'), 'wins', coalesce(p -> 'wins', s -> 'wins', '0'),
            'penGoals', coalesce(p -> 'penGoals', s -> 'penGoals', '0'), 'penMisses', coalesce(p -> 'penMisses', s -> 'penMisses', '0'),
            'penSaves', coalesce(p -> 'penSaves', s -> 'penSaves', '0')) order by o)
        from jsonb_array_elements(private.jarr(srv -> 'players')) with ordinality x(s, o)
        left join lateral (select y from jsonb_array_elements(private.jarr(inc -> 'players')) y where y ->> 'id' = s ->> 'id' limit 1) z(p) on true), '[]'::jsonb));
      out := jsonb_set(out, '{match}', coalesce(out -> 'match', '{}'::jsonb) || '{"events": [], "scoreA": 0, "scoreB": 0}'::jsonb);
    else
      out := jsonb_set(srv, '{match}', coalesce(srv -> 'match', '{}'::jsonb)
        || coalesce((select jsonb_object_agg(key, value) from jsonb_each(coalesce(inc -> 'match', '{}'::jsonb))
                     where key in ('isRunning', 'endAt', 'secondsLeft', 'initialSeconds')), '{}'::jsonb));
      if nullif(srv ->> 'firstKickoffAt', '') is null and nullif(inc ->> 'firstKickoffAt', '') is not null then
        out := jsonb_set(out, '{firstKickoffAt}', inc -> 'firstKickoffAt');
      end if;
      out := private.keep_match_lances(out, srv);
    end if;
  elsif hin = hsv then
    -- Mesma partida: placar e lances são do servidor. "Desfazer times" (quadra vazia, sem lances) zera a partida.
    if (jsonb_typeof(inc -> 'court' -> 'A') is distinct from 'object' or jsonb_typeof(inc -> 'court' -> 'B') is distinct from 'object')
       and jsonb_array_length(private.jarr(inc -> 'match' -> 'events')) = 0 and private.jint(inc -> 'match' -> 'scoreA') = 0 and private.jint(inc -> 'match' -> 'scoreB') = 0 then
      out := inc;
    else
      out := private.keep_match_lances(inc, srv);
    end if;
  elsif hin < hsv then
    -- "Desfazer partida" do dono/adm: volta a foto de antes do fim, inclusive os contadores.
    return inc;
  else
    out := inc;
    -- A partida nova começa sem lances.
    out := jsonb_set(out, '{match}', coalesce(out -> 'match', '{}'::jsonb) || '{"events": [], "scoreA": 0, "scoreB": 0}'::jsonb);
  end if;
  return private.keep_counters(out, srv);
end;
$$;

-- Quem vê o baba (só leitura, inclusive o mesário que já saiu): dono/adm, mesário atual e quem já foi anotador.
create or replace function private.sees_baba(created_by uuid, turma_ids uuid[], mesario uuid, scorers uuid[], u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select u is not null and (private.runs_baba(created_by, turma_ids, u) or u = mesario or u = any (coalesce(scorers, '{}')));
$$;

-- A transmissão ao vivo do baba passa para o novo anotador (mesmo código).
create or replace function private.live_follow(st jsonb, new_owner uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare lid uuid;
begin
  begin lid := nullif(st -> 'live' ->> 'id', '')::uuid; exception when others then lid := null; end;
  if lid is null or new_owner is null then return st; end if;
  update public.live_games set owner = new_owner where id = lid and active;
  return jsonb_set(st, '{live,owner}', to_jsonb(new_owner::text));
end;
$$;

-- ============ Gatilho do baba (versão, início, anotador, gravação direta) ============
create or replace function private.babas_v116() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if tg_op = 'UPDATE' then
    if old.finished then return old; end if;
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

-- ============ Gravar o baba (dono, adm e mesário) ============
drop function if exists public.baba_save(uuid, jsonb, uuid[], text, date, integer, uuid, bigint);
create or replace function public.baba_save(p_id uuid, p_state jsonb, p_turma_ids uuid[], p_title text, p_played_on date,
  p_matches integer, p_event_id uuid default null, p_base_rev bigint default null, p_lance_seq bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); b public.babas; ids uuid[] := coalesce(p_turma_ids, '{}'); prev bigint; org boolean; st jsonb;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if p_id is null or p_state is null or jsonb_typeof(p_state) <> 'object' then raise exception 'invalid'; end if;
  perform set_config('baba.rpc', '1', true);
  select * into b from public.babas where id = p_id for update;
  if b.id is null then
    if exists (select 1 from unnest(ids) t(id) where not private.is_member(t.id)) then raise exception 'not_member'; end if;
    insert into public.babas (id, created_by, turma_ids, title, played_on, state, finished, matches, event_id, updated_by)
    values (p_id, me, ids, p_title, coalesce(p_played_on, current_date), p_state, false, coalesce(p_matches, 0), p_event_id, me)
    returning * into b;
    return jsonb_build_object('rev', b.rev, 'updated_by', me, 'conflict', false, 'lance_seq', b.lance_seq, 'merged', false);
  end if;
  if b.finished then
    return jsonb_build_object('finished', true, 'rev', b.rev, 'finished_by', b.finished_by, 'finished_by_name', private.name_of(b.finished_by));
  end if;
  org := private.runs_baba(b.created_by, b.turma_ids, me);
  if not org and me is distinct from b.mesario_id then raise exception 'forbidden'; end if;
  st := private.guard_state(p_state, b.state, org, me = b.scorer_id, p_lance_seq, b.lance_seq);
  if not org then
    ids := b.turma_ids;
  else
    if exists (select 1 from unnest(ids) t(id) where not private.is_member(t.id)) then raise exception 'not_member'; end if;
    if b.created_by <> me and not private.runs_baba(b.created_by, ids, me) then ids := b.turma_ids; end if;
  end if;
  prev := b.rev;
  update public.babas set state = st, turma_ids = ids,
    title = case when org then coalesce(p_title, title) else title end, played_on = case when org then coalesce(p_played_on, played_on) else played_on end,
    matches = jsonb_array_length(private.jarr(st -> 'matchHistory')), event_id = case when org then coalesce(p_event_id, event_id) else event_id end,
    rev = prev + 1, updated_by = me
  where id = p_id returning * into b;
  return jsonb_build_object('rev', b.rev, 'updated_by', me, 'conflict', p_base_rev is not null and p_base_rev < prev, 'lance_seq', b.lance_seq,
    'merged', st is distinct from p_state);
end;
$$;

-- ============ Lances (só o anotador) ============
-- p_lance: { lid, kind: goal|save|extra|undo, match_no, side, scorerId, assistId, keeperId, seconds, el, time, text, target }
create or replace function public.baba_lance(p_baba uuid, p_lance jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); b public.babas; st jsonb; m jsonb; ev jsonb; kind text := p_lance ->> 'kind'; lid uuid; side text;
  mno integer; secs integer; first jsonb; ok_scorer boolean; org boolean; txt text;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  begin lid := (p_lance ->> 'lid')::uuid; exception when others then raise exception 'invalid'; end;
  if lid is null or kind is null or kind not in ('goal', 'save', 'extra', 'undo') then raise exception 'invalid'; end if;
  perform set_config('baba.rpc', '1', true);
  select * into b from public.babas where id = p_baba for update;
  if b.id is null then raise exception 'not_found'; end if;
  -- O mesmo lance de novo (o celular não recebeu a resposta): não conta duas vezes.
  if exists (select 1 from public.baba_lances x where x.id = lid) then
    return jsonb_build_object('dup', true, 'rev', b.rev, 'lance_seq', b.lance_seq);
  end if;
  if b.finished then raise exception 'finished'; end if;
  org := private.runs_baba(b.created_by, b.turma_ids, me);
  ok_scorer := me = b.scorer_id or (b.scorer_id is null and org);
  if kind = 'extra' then
    if not (ok_scorer or org) then raise exception 'not_scorer'; end if;
  elsif not ok_scorer then
    raise exception 'not_scorer';
  end if;
  if b.scorer_id is null and org then
    b.scorer_id := me;
    if not (me = any (b.scorers)) then b.scorers := b.scorers || me; end if;
  end if;
  st := coalesce(b.state, '{}'::jsonb);
  mno := jsonb_array_length(private.jarr(st -> 'matchHistory')) + 1;
  if coalesce((p_lance ->> 'match_no')::integer, mno) <> mno then raise exception 'stale_match'; end if;
  m := coalesce(st -> 'match', '{}'::jsonb);
  side := case when p_lance ->> 'side' = 'B' then 'B' else 'A' end;
  txt := left(coalesce(p_lance ->> 'text', ''), 200);
  if kind = 'goal' then
    if jsonb_typeof(st -> 'court' -> side) is distinct from 'object' then raise exception 'no_court'; end if;
    ev := jsonb_strip_nulls(jsonb_build_object('lid', lid::text, 'type', 'goal', 'side', side, 'el', private.jint(p_lance -> 'el'),
      'scorerId', p_lance -> 'scorerId', 'assistId', p_lance -> 'assistId', 'time', left(p_lance ->> 'time', 8), 'text', txt));
    if not ev ? 'scorerId' then ev := ev || '{"scorerId": null}'::jsonb; end if;
    if not ev ? 'assistId' then ev := ev || '{"assistId": null}'::jsonb; end if;
    m := m || jsonb_build_object('score' || side, private.jint(m -> ('score' || side)) + 1);
    st := private.bump_player(st, p_lance ->> 'scorerId', 'goals', 1);
    if (p_lance ->> 'assistId') is distinct from (p_lance ->> 'scorerId') then st := private.bump_player(st, p_lance ->> 'assistId', 'assists', 1); end if;
  elsif kind = 'save' then
    if jsonb_typeof(st -> 'court' -> side) is distinct from 'object' then raise exception 'no_court'; end if;
    ev := jsonb_build_object('lid', lid::text, 'type', 'save', 'side', side, 'el', private.jint(p_lance -> 'el'), 'keeperId', p_lance -> 'keeperId',
      'time', left(p_lance ->> 'time', 8), 'text', txt);
    st := private.bump_player(st, p_lance ->> 'keeperId', 'saves', 1);
  elsif kind = 'extra' then
    secs := least(greatest(private.jint(p_lance -> 'seconds'), 0), 1800);
    if secs <= 0 then raise exception 'invalid'; end if;
    ev := jsonb_build_object('lid', lid::text, 'type', 'extra', 'seconds', secs, 'time', left(p_lance ->> 'time', 8), 'text', txt);
    m := m || jsonb_build_object('addedSeconds', private.jint(m -> 'addedSeconds') + secs, 'secondsLeft', private.jint(m -> 'secondsLeft') + secs);
    if coalesce((m ->> 'isRunning')::boolean, false) and jsonb_typeof(m -> 'endAt') = 'number' then
      m := m || jsonb_build_object('endAt', (m ->> 'endAt')::numeric + secs * 1000);
    end if;
  else
    -- Desfazer: só o último lance da partida atual, e só se for o que o celular viu como último.
    first := private.jarr(m -> 'events') -> 0;
    if first is null then raise exception 'nothing_to_undo'; end if;
    if (first ->> 'lid') is distinct from nullif(p_lance ->> 'target', '') then raise exception 'not_last'; end if;
    if first ->> 'type' = 'goal' then
      side := case when first ->> 'side' = 'B' then 'B' else 'A' end;
      m := m || jsonb_build_object('score' || side, greatest(0, private.jint(m -> ('score' || side)) - 1));
      st := private.bump_player(st, first ->> 'scorerId', 'goals', -1);
      if (first ->> 'assistId') is distinct from (first ->> 'scorerId') then st := private.bump_player(st, first ->> 'assistId', 'assists', -1); end if;
    elsif first ->> 'type' = 'save' then
      st := private.bump_player(st, first ->> 'keeperId', 'saves', -1);
    elsif first ->> 'type' = 'extra' then
      secs := least(private.jint(first -> 'seconds'), private.jint(m -> 'addedSeconds'));
      m := m || jsonb_build_object('addedSeconds', private.jint(m -> 'addedSeconds') - secs, 'secondsLeft', greatest(0, private.jint(m -> 'secondsLeft') - secs));
      if coalesce((m ->> 'isRunning')::boolean, false) and jsonb_typeof(m -> 'endAt') = 'number' then
        m := m || jsonb_build_object('endAt', (m ->> 'endAt')::numeric - secs * 1000);
        if private.jint(m -> 'secondsLeft') = 0 then m := m || '{"isRunning": false, "endAt": null}'::jsonb; end if;
      end if;
    end if;
    ev := null;
  end if;
  if ev is not null then
    m := jsonb_set(m, '{events}', jsonb_build_array(ev) || private.jarr(m -> 'events'));
  else
    m := jsonb_set(m, '{events}', coalesce((select jsonb_agg(e order by o) from jsonb_array_elements(private.jarr(m -> 'events')) with ordinality x(e, o) where o > 1), '[]'::jsonb));
  end if;
  st := jsonb_set(st, '{match}', m);
  insert into public.baba_lances (id, baba_id, seq, match_no, kind, payload, created_by)
  values (lid, b.id, b.lance_seq + 1, mno, kind, p_lance, me);
  update public.babas set state = st, lance_seq = b.lance_seq + 1, rev = b.rev + 1, updated_by = me, scorer_id = b.scorer_id, scorers = b.scorers
  where id = b.id returning * into b;
  return jsonb_build_object('ok', true, 'rev', b.rev, 'lance_seq', b.lance_seq);
end;
$$;

-- ============ Assumir anotação / passar a vez (só dono e adms) ============
create or replace function public.baba_take_scoring(p_baba uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); b public.babas;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  perform set_config('baba.rpc', '1', true);
  select * into b from public.babas where id = p_baba for update;
  if b.id is null then raise exception 'not_found'; end if;
  if b.finished then raise exception 'finished'; end if;
  if not private.runs_baba(b.created_by, b.turma_ids, me) then raise exception 'forbidden'; end if;
  update public.babas set scorer_id = me, mesario_id = null, scorers = case when me = any (scorers) then scorers else scorers || me end,
    state = private.live_follow(state, me), rev = rev + 1, updated_by = me
  where id = p_baba returning * into b;
  return jsonb_build_object('ok', true, 'rev', b.rev, 'scorer_id', me, 'scorer_name', private.name_of(me));
end;
$$;

-- Passa a vez de anotar: para um presente com conta (membro de uma turma do baba). Dono/adm escolhido vira anotador sem ser mesário.
create or replace function public.baba_set_mesario(p_baba uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); b public.babas; org_target boolean;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  perform set_config('baba.rpc', '1', true);
  select * into b from public.babas where id = p_baba for update;
  if b.id is null then raise exception 'not_found'; end if;
  if b.finished then raise exception 'finished'; end if;
  if not private.runs_baba(b.created_by, b.turma_ids, me) then raise exception 'forbidden'; end if;
  if p_user is null or not exists (
    select 1 from jsonb_array_elements(private.jarr(b.state -> 'players')) p
    join public.turma_players tp on tp.turma_id::text = p ->> 'turmaId' and lower(trim(tp.name)) = lower(trim(p ->> 'name'))
    join public.turma_members tm on tm.turma_id = tp.turma_id and tm.user_id = tp.user_id
    where coalesce((p ->> 'present')::boolean, false) and tp.user_id = p_user and tp.turma_id = any (b.turma_ids)) then
    raise exception 'not_present';
  end if;
  org_target := private.runs_baba(b.created_by, b.turma_ids, p_user);
  update public.babas set scorer_id = p_user, mesario_id = case when org_target then null else p_user end,
    scorers = case when p_user = any (scorers) then scorers else scorers || p_user end,
    state = private.live_follow(state, p_user), rev = rev + 1, updated_by = me
  where id = p_baba returning * into b;
  return jsonb_build_object('ok', true, 'rev', b.rev, 'scorer_id', p_user, 'scorer_name', private.name_of(p_user), 'mesario', not org_target);
end;
$$;

-- ============ Leitura (com anotador, mesário e o meu papel) ============
create or replace function private.baba_roles(b public.babas, me uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('scorer_id', b.scorer_id, 'scorer_name', case when b.scorer_id is not null then private.name_of(b.scorer_id) end,
    'mesario_id', b.mesario_id, 'mesario_name', case when b.mesario_id is not null then private.name_of(b.mesario_id) end,
    'lance_seq', b.lance_seq,
    'my_role', case when private.runs_baba(b.created_by, b.turma_ids, me) then 'org' when me = b.mesario_id then 'mesario' else 'viewer' end);
$$;

create or replace function public.baba_rev(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); b public.babas;
begin
  select * into b from public.babas where id = p_id;
  if b.id is null then return jsonb_build_object('gone', true); end if;
  if not private.sees_baba(b.created_by, b.turma_ids, b.mesario_id, b.scorers, me) then raise exception 'forbidden'; end if;
  return jsonb_build_object('rev', b.rev, 'updated_by', b.updated_by, 'updated_by_name', private.name_of(b.updated_by),
    'finished', b.finished, 'finished_by', b.finished_by, 'finished_by_name', case when b.finished then private.name_of(b.finished_by) end)
    || private.baba_roles(b, me);
end;
$$;

create or replace function public.baba_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); b public.babas;
begin
  select * into b from public.babas where id = p_id;
  if b.id is null then return null; end if;
  if not private.sees_baba(b.created_by, b.turma_ids, b.mesario_id, b.scorers, me) then raise exception 'forbidden'; end if;
  return jsonb_build_object('id', b.id, 'state', b.state, 'rev', b.rev, 'created_by', b.created_by, 'turma_ids', to_jsonb(b.turma_ids),
    'title', b.title, 'played_on', b.played_on, 'finished', b.finished, 'updated_by', b.updated_by, 'updated_by_name', private.name_of(b.updated_by),
    'started_by', b.started_by, 'started_by_name', case when b.started_by is not null then private.name_of(b.started_by) end,
    'finished_by_name', case when b.finished then private.name_of(b.finished_by) end) || private.baba_roles(b, me);
end;
$$;

-- Babas que eu controlo (dono/adm) ou em que sou o mesário. O mesário não recebe o card de baba pendente (o app filtra por my_role).
create or replace function public.babas_shared() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x.updated_at desc), '[]'::jsonb) from (
    select b.id, b.title, b.played_on, b.created_by, to_jsonb(b.turma_ids) as turma_ids, b.rev, b.updated_at,
           b.started_by, case when b.started_by is not null then private.name_of(b.started_by) end as started_by_name,
           nullif(b.state ->> 'firstKickoffAt', '') is not null as started,
           coalesce(jsonb_array_length(case when jsonb_typeof(b.state -> 'matchHistory') = 'array' then b.state -> 'matchHistory' end), 0) as matches,
           coalesce((select sum(coalesce((h ->> 'scoreA')::integer, 0) + coalesce((h ->> 'scoreB')::integer, 0))
                     from jsonb_array_elements(case when jsonb_typeof(b.state -> 'matchHistory') = 'array' then b.state -> 'matchHistory' else '[]'::jsonb end) h), 0)
             + coalesce((b.state -> 'match' ->> 'scoreA')::integer, 0) + coalesce((b.state -> 'match' ->> 'scoreB')::integer, 0) as goals,
           (coalesce((b.state -> 'match' ->> 'isRunning')::boolean, false)
             or coalesce((b.state -> 'match' ->> 'scoreA')::integer, 0) + coalesce((b.state -> 'match' ->> 'scoreB')::integer, 0) > 0
             or coalesce(jsonb_array_length(case when jsonb_typeof(b.state -> 'match' -> 'events') = 'array' then b.state -> 'match' -> 'events' end), 0) > 0)
             and jsonb_typeof(b.state -> 'court' -> 'A') = 'object' and jsonb_typeof(b.state -> 'court' -> 'B') = 'object' as live_match,
           b.scorer_id, case when b.scorer_id is not null then private.name_of(b.scorer_id) end as scorer_name,
           case when private.runs_baba(b.created_by, b.turma_ids, (select auth.uid())) then 'org' else 'mesario' end as my_role
    from public.babas b
    where not b.finished and b.updated_at > now() - interval '60 days'
      and (private.runs_baba(b.created_by, b.turma_ids, (select auth.uid())) or b.mesario_id = (select auth.uid()))
    order by b.updated_at desc limit 20
  ) x;
$$;

-- ============ Extrato do adm: quem anotou (inclusive o mesário) aparece marcado ============
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

revoke execute on function public.baba_save(uuid, jsonb, uuid[], text, date, integer, uuid, bigint, bigint) from public, anon;
revoke execute on function public.baba_lance(uuid, jsonb) from public, anon;
revoke execute on function public.baba_take_scoring(uuid) from public, anon;
revoke execute on function public.baba_set_mesario(uuid, uuid) from public, anon;
grant execute on function public.baba_save(uuid, jsonb, uuid[], text, date, integer, uuid, bigint, bigint) to authenticated;
grant execute on function public.baba_lance(uuid, jsonb) to authenticated;
grant execute on function public.baba_take_scoring(uuid) to authenticated;
grant execute on function public.baba_set_mesario(uuid, uuid) to authenticated;
revoke execute on function private.sees_baba(uuid, uuid[], uuid, uuid[], uuid) from public, anon;
revoke execute on function private.live_follow(jsonb, uuid) from public, anon, authenticated;
revoke execute on function private.baba_roles(public.babas, uuid) from public, anon;
