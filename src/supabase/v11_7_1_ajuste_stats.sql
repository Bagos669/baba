-- BABA v11.7.1 · Correção manual dos números do atleta (ficha do jogador)
-- Desde a v11.6.1 os gols, passes e defesas do baba em andamento vêm sempre do servidor, então a ficha do jogador
-- (Lista e Times) não pode mais mudar esses números só no celular: a próxima gravação desfazia a mudança.
-- Agora a correção é um lance do tipo "adjust" (valores finais de gols/assistências/defesas de um atleta),
-- que o servidor aplica como os outros lances. Pode corrigir: o anotador, o dono e os adms do baba.
-- Rode DEPOIS do v11_7_correcoes.sql. Não rode o v11_6_1 de novo depois deste (ele recria o baba_lance sem o "adjust").

alter table public.baba_lances drop constraint if exists baba_lances_kind_check;
alter table public.baba_lances add constraint baba_lances_kind_check check (kind in ('goal', 'save', 'extra', 'undo', 'adjust'));

-- Troca um contador (goals/assists/saves) do atleta com esse id por um valor final.
create or replace function private.set_player(st jsonb, pid text, field text, val integer) returns jsonb
language sql immutable set search_path = '' as $$
  select case when pid is null then st else jsonb_set(st, '{players}', coalesce((
    select jsonb_agg(case when p ->> 'id' = pid then jsonb_set(p, array[field], to_jsonb(greatest(0, val))) else p end order by o)
    from jsonb_array_elements(private.jarr(st -> 'players')) with ordinality x(p, o)), '[]'::jsonb)) end;
$$;

-- p_lance: { lid, kind: goal|save|extra|undo|adjust, match_no, side, scorerId, assistId, keeperId, seconds, el, time, text, target,
--            playerId, goals, assists, saves }   (adjust = correção manual dos números de um atleta, valores finais)
create or replace function public.baba_lance(p_baba uuid, p_lance jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); b public.babas; st jsonb; m jsonb; ev jsonb; kind text := p_lance ->> 'kind'; lid uuid; side text;
  mno integer; secs integer; first jsonb; ok_scorer boolean; org boolean; txt text; fld text;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  begin lid := (p_lance ->> 'lid')::uuid; exception when others then raise exception 'invalid'; end;
  if lid is null or kind is null or kind not in ('goal', 'save', 'extra', 'undo', 'adjust') then raise exception 'invalid'; end if;
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
  if kind in ('extra', 'adjust') then
    if not (ok_scorer or org) then raise exception 'not_scorer'; end if;
  elsif not ok_scorer then
    raise exception 'not_scorer';
  end if;
  if b.scorer_id is null and org and kind <> 'adjust' then
    b.scorer_id := me;
    if not (me = any (b.scorers)) then b.scorers := b.scorers || me; end if;
  end if;
  st := coalesce(b.state, '{}'::jsonb);
  mno := jsonb_array_length(private.jarr(st -> 'matchHistory')) + 1;
  -- A correção manual não depende da partida em andamento.
  if kind <> 'adjust' and coalesce((p_lance ->> 'match_no')::integer, mno) <> mno then raise exception 'stale_match'; end if;
  m := coalesce(st -> 'match', '{}'::jsonb);
  side := case when p_lance ->> 'side' = 'B' then 'B' else 'A' end;
  txt := left(coalesce(p_lance ->> 'text', ''), 200);
  if kind = 'adjust' then
    if not exists (select 1 from jsonb_array_elements(private.jarr(st -> 'players')) p where p ->> 'id' = p_lance ->> 'playerId') then
      raise exception 'no_player';
    end if;
    foreach fld in array array['goals', 'assists', 'saves'] loop
      if jsonb_typeof(p_lance -> fld) = 'number' then
        st := private.set_player(st, p_lance ->> 'playerId', fld, least(greatest(private.jint(p_lance -> fld), 0), 99));
      end if;
    end loop;
    ev := null;
  elsif kind = 'goal' then
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
  if kind = 'adjust' then
    null;  -- não entra na lista de lances da partida (o Desfazer não mexe nela)
  elsif ev is not null then
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

revoke execute on function public.baba_lance(uuid, jsonb) from public, anon;
grant execute on function public.baba_lance(uuid, jsonb) to authenticated;

select 1 as v11_7_1_done;
