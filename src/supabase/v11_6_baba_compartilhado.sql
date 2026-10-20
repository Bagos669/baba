-- v11.6 · Baba compartilhado entre dono e adms, finalização única e sugestão de fechar o baba pendente.
-- Roda depois do v11_5_palpites_fase2.sql. Idempotente: pode rodar de novo sem estragar nada. Não apaga nada.
--
-- Como fica:
--   * O baba continua inteiro em babas.state (o mesmo JSON de antes), mas agora com uma versão (rev) que sobe a cada gravação
--     e com quem gravou por último (updated_by). Os celulares olham a versão a cada poucos segundos e baixam o estado novo.
--   * Dono e adms das turmas do baba gravam pelo RPC baba_save (vale a última gravação aceita: o servidor é a fonte da verdade).
--   * baba_finish fecha o baba uma vez só: a segunda finalização (ao mesmo tempo ou depois) não regrava stats, não liquida
--     de novo e devolve quem finalizou.
--   * As políticas antigas continuam valendo para o app antigo (quem criou ainda grava direto na tabela); um gatilho sobe a versão
--     nessas gravações diretas e impede que um baba finalizado seja reaberto.

alter table public.babas add column if not exists rev bigint not null default 0;
alter table public.babas add column if not exists updated_by uuid;
alter table public.babas add column if not exists started_by uuid;
alter table public.babas add column if not exists started_at timestamptz;
alter table public.babas add column if not exists finished_by uuid;
alter table public.babas add column if not exists finished_at timestamptz;
create index if not exists babas_open_v116 on public.babas (updated_at desc) where not finished;

-- Dono ou adm da turma t.
create or replace function private.org_of(t uuid, u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select u is not null and (
    exists (select 1 from public.turmas x where x.id = t and x.owner_id = u)
    or exists (select 1 from public.turma_members m where m.turma_id = t and m.user_id = u and m.role in ('admin', 'owner')));
$$;

-- Quem pode controlar o baba: quem criou, ou dono/adm de qualquer turma do baba (baba com duas turmas: as duas).
create or replace function private.runs_baba(created_by uuid, turma_ids uuid[], u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select u is not null and (created_by = u or exists (select 1 from unnest(coalesce(turma_ids, '{}')) t(id) where private.org_of(t.id, u)));
$$;

create or replace function private.name_of(u uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.name from public.profiles p where p.id = u), 'Alguém');
$$;

-- Versão e "em andamento" também para as gravações diretas (app antigo) e trava contra reabrir baba finalizado.
create or replace function private.babas_v116() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if old.finished then return old; end if;
    if new.rev is not distinct from old.rev then
      new.rev := coalesce(old.rev, 0) + 1;
      new.updated_by := coalesce((select auth.uid()), new.updated_by);
    end if;
  else
    if coalesce(new.rev, 0) = 0 then new.rev := 1; end if;
    new.updated_by := coalesce(new.updated_by, (select auth.uid()), new.created_by);
  end if;
  if new.started_by is null and not coalesce(new.finished, false) and nullif(new.state ->> 'firstKickoffAt', '') is not null then
    new.started_by := coalesce((select auth.uid()), new.created_by);
    new.started_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists babas_v116 on public.babas;
create trigger babas_v116 before insert or update on public.babas
  for each row execute function private.babas_v116();

-- Grava o estado do baba (o JSON inteiro). Cria o baba se ainda não existe (mesmas regras de antes: membro de todas as turmas).
-- Baba finalizado: não grava e devolve quem finalizou. Vale a última gravação; "conflict" diz que outro aparelho gravou antes.
create or replace function public.baba_save(p_id uuid, p_state jsonb, p_turma_ids uuid[], p_title text, p_played_on date,
  p_matches integer, p_event_id uuid default null, p_base_rev bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); b public.babas; ids uuid[] := coalesce(p_turma_ids, '{}'); prev bigint;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if p_id is null or p_state is null or jsonb_typeof(p_state) <> 'object' then raise exception 'invalid'; end if;
  if exists (select 1 from unnest(ids) t(id) where not private.is_member(t.id)) then raise exception 'not_member'; end if;
  select * into b from public.babas where id = p_id for update;
  if b.id is null then
    insert into public.babas (id, created_by, turma_ids, title, played_on, state, finished, matches, event_id, updated_by)
    values (p_id, me, ids, p_title, coalesce(p_played_on, current_date), p_state, false, coalesce(p_matches, 0), p_event_id, me)
    returning * into b;
    return jsonb_build_object('rev', b.rev, 'updated_by', me, 'conflict', false);
  end if;
  if b.finished then
    return jsonb_build_object('finished', true, 'rev', b.rev, 'finished_by', b.finished_by, 'finished_by_name', private.name_of(b.finished_by));
  end if;
  if not private.runs_baba(b.created_by, b.turma_ids, me) then raise exception 'forbidden'; end if;
  -- Quem não criou não pode tirar o baba das turmas que ele organiza.
  if b.created_by <> me and not private.runs_baba(b.created_by, ids, me) then ids := b.turma_ids; end if;
  prev := b.rev;
  update public.babas set state = p_state, turma_ids = ids, title = coalesce(p_title, title), played_on = coalesce(p_played_on, played_on),
    matches = coalesce(p_matches, matches), event_id = coalesce(p_event_id, event_id), rev = prev + 1, updated_by = me
  where id = p_id returning * into b;
  return jsonb_build_object('rev', b.rev, 'updated_by', me, 'conflict', p_base_rev is not null and p_base_rev < prev);
end;
$$;

-- Finaliza o baba uma vez só (relatório = baba_stats; a liquidação dos palpites sai do gatilho de baba_stats).
-- Atleta sem id ligado (ex.: da outra turma, que o adm não vê) é ligado pelo nome dentro das turmas do baba.
create or replace function public.baba_finish(p_id uuid, p_state jsonb, p_turma_ids uuid[], p_title text, p_played_on date,
  p_matches integer, p_event_id uuid default null, p_stats jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); b public.babas; ids uuid[] := coalesce(p_turma_ids, '{}');
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if p_id is null then raise exception 'invalid'; end if;
  select * into b from public.babas where id = p_id for update;
  if b.id is not null and b.finished then
    return jsonb_build_object('already', true, 'finished_by', b.finished_by, 'finished_by_name', private.name_of(b.finished_by));
  end if;
  if b.id is null then
    if exists (select 1 from unnest(ids) t(id) where not private.is_member(t.id)) then raise exception 'not_member'; end if;
    insert into public.babas (id, created_by, turma_ids, title, played_on, state, finished, matches, event_id, updated_by)
    values (p_id, me, ids, p_title, coalesce(p_played_on, current_date), coalesce(p_state, '{}'::jsonb), false, coalesce(p_matches, 0), p_event_id, me)
    returning * into b;
  elsif not private.runs_baba(b.created_by, b.turma_ids, me) then
    raise exception 'forbidden';
  end if;
  if b.created_by <> me and not private.runs_baba(b.created_by, ids, me) then ids := b.turma_ids; end if;
  if exists (select 1 from unnest(ids) t(id) where not private.is_member(t.id)) then ids := b.turma_ids; end if;
  update public.babas set finished = true, finished_by = me, finished_at = now(), state = coalesce(p_state, state), turma_ids = ids,
    title = coalesce(p_title, title), played_on = coalesce(p_played_on, played_on), matches = coalesce(p_matches, matches),
    event_id = coalesce(p_event_id, event_id), rev = b.rev + 1, updated_by = me
  where id = p_id;
  delete from public.baba_stats where baba_id = p_id;
  insert into public.baba_stats (baba_id, turma_player_id, name, goals, assists, saves, matches, wins, pen_goals, pen_misses, pen_saves)
  select p_id,
         coalesce((select tp.id from public.turma_players tp where tp.id = x.turma_player_id and tp.turma_id = any (ids)),
                  (select min(tp.id::text)::uuid from public.turma_players tp where tp.turma_id = any (ids) and lower(trim(tp.name)) = lower(trim(x.name))
                   having count(*) = 1)),
         left(trim(x.name), 60), greatest(coalesce(x.goals, 0), 0), greatest(coalesce(x.assists, 0), 0), greatest(coalesce(x.saves, 0), 0),
         greatest(coalesce(x.matches, 0), 0), greatest(coalesce(x.wins, 0), 0),
         greatest(coalesce(x.pen_goals, 0), 0), greatest(coalesce(x.pen_misses, 0), 0), greatest(coalesce(x.pen_saves, 0), 0)
  from jsonb_to_recordset(case when jsonb_typeof(p_stats) = 'array' then p_stats else '[]'::jsonb end)
    as x(turma_player_id uuid, name text, goals integer, assists integer, saves integer, matches integer, wins integer,
         pen_goals integer, pen_misses integer, pen_saves integer)
  where nullif(trim(x.name), '') is not null;
  return jsonb_build_object('ok', true, 'finished_by', me, 'finished_by_name', private.name_of(me));
end;
$$;

-- Versão atual de um baba (o celular pergunta a cada poucos segundos; só baixa o estado quando muda).
create or replace function public.baba_rev(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); b public.babas;
begin
  select * into b from public.babas where id = p_id;
  if b.id is null then return jsonb_build_object('gone', true); end if;
  if not private.runs_baba(b.created_by, b.turma_ids, me) then raise exception 'forbidden'; end if;
  return jsonb_build_object('rev', b.rev, 'updated_by', b.updated_by, 'updated_by_name', private.name_of(b.updated_by),
    'finished', b.finished, 'finished_by', b.finished_by, 'finished_by_name', case when b.finished then private.name_of(b.finished_by) end);
end;
$$;

-- O baba inteiro, para quem pode controlar.
create or replace function public.baba_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); b public.babas;
begin
  select * into b from public.babas where id = p_id;
  if b.id is null then return null; end if;
  if not private.runs_baba(b.created_by, b.turma_ids, me) then raise exception 'forbidden'; end if;
  return jsonb_build_object('id', b.id, 'state', b.state, 'rev', b.rev, 'created_by', b.created_by, 'turma_ids', to_jsonb(b.turma_ids),
    'title', b.title, 'played_on', b.played_on, 'finished', b.finished, 'updated_by', b.updated_by, 'updated_by_name', private.name_of(b.updated_by),
    'started_by', b.started_by, 'started_by_name', case when b.started_by is not null then private.name_of(b.started_by) end,
    'finished_by_name', case when b.finished then private.name_of(b.finished_by) end);
end;
$$;

-- Babas não finalizados que eu posso controlar (cards "Baba em andamento" e "ainda está aberto", selo nas turmas).
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
             and jsonb_typeof(b.state -> 'court' -> 'A') = 'object' and jsonb_typeof(b.state -> 'court' -> 'B') = 'object' as live_match
    from public.babas b
    where not b.finished and b.updated_at > now() - interval '60 days'
      and private.runs_baba(b.created_by, b.turma_ids, (select auth.uid()))
    order by b.updated_at desc limit 20
  ) x;
$$;

revoke execute on function public.baba_save(uuid, jsonb, uuid[], text, date, integer, uuid, bigint) from public, anon;
revoke execute on function public.baba_finish(uuid, jsonb, uuid[], text, date, integer, uuid, jsonb) from public, anon;
revoke execute on function public.baba_rev(uuid) from public, anon;
revoke execute on function public.baba_get(uuid) from public, anon;
revoke execute on function public.babas_shared() from public, anon;
grant execute on function public.baba_save(uuid, jsonb, uuid[], text, date, integer, uuid, bigint) to authenticated;
grant execute on function public.baba_finish(uuid, jsonb, uuid[], text, date, integer, uuid, jsonb) to authenticated;
grant execute on function public.baba_rev(uuid) to authenticated;
grant execute on function public.baba_get(uuid) to authenticated;
grant execute on function public.babas_shared() to authenticated;
revoke execute on function private.org_of(uuid, uuid) from public, anon;
revoke execute on function private.runs_baba(uuid, uuid[], uuid) from public, anon;
revoke execute on function private.name_of(uuid) from public, anon;
