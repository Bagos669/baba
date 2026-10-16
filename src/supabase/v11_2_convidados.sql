-- BABA v11.2 (ajustes do Compromisso): convidados e estatísticas ligadas à conta.
-- Rode DEPOIS do v11_compromisso.sql. Pode rodar mais de uma vez.

-- ============ Convidado de quem ============
alter table public.event_rsvps add column if not exists invited_by text check (invited_by is null or char_length(invited_by) <= 60);

-- rsvp_event ganha o parâmetro "invited_by" (nome de quem convidou). A versão antiga de 4 parâmetros sai.
drop function if exists public.rsvp_event(uuid, text, uuid, text);
create or replace function public.rsvp_event(event uuid, answer text, player uuid, player_name text, invited_by text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); e public.turma_events; p public.turma_players; adm boolean; nm text; k text; lvl text; inv text;
begin
  select * into e from public.turma_events where id = event;
  if e.id is null or not private.is_member(e.turma_id) then raise exception 'not_found'; end if;
  if e.status <> 'open' then raise exception 'closed'; end if;
  if e.starts_at < now() - interval '4 hours' then raise exception 'closed'; end if;
  if answer not in ('vou', 'talvez', 'nao', 'tirar') then raise exception 'bad_answer'; end if;
  adm := private.is_admin(e.turma_id);
  if player is null and player_name is null then
    select * into p from public.turma_players x where x.turma_id = e.turma_id and x.user_id = uid limit 1;
    if p.id is null then raise exception 'no_player'; end if;
  else
    if not adm then
      select * into p from public.turma_players x where x.id = player and x.turma_id = e.turma_id and x.user_id = uid;
      if p.id is null then raise exception 'not_allowed'; end if;
    elsif player is not null then
      select * into p from public.turma_players x where x.id = player and x.turma_id = e.turma_id;
      if p.id is null then raise exception 'not_found'; end if;
    end if;
  end if;
  nm := coalesce(p.name, left(trim(player_name), 60));
  if nm is null or nm = '' then raise exception 'bad_name'; end if;
  k := lower(trim(nm));
  if answer = 'tirar' then
    if not adm and p.user_id is distinct from uid then raise exception 'not_allowed'; end if;
    delete from public.event_rsvps where event_id = event and player_key = k;
    return 'tirar';
  end if;
  lvl := private.player_level(e.turma_id, k);
  if answer = 'vou' and not adm and lvl in ('bloqueio', 'banimento') then raise exception 'blocked'; end if;
  inv := case when p.id is null then nullif(left(trim(coalesce(rsvp_event.invited_by, '')), 60), '') else null end;
  insert into public.event_rsvps (event_id, player_key, name, turma_player_id, user_id, status, source, invited_by)
  values (event, k, nm, p.id, p.user_id, answer, case when adm and p.user_id is distinct from uid then 'adm' else 'app' end, inv)
  on conflict (event_id, player_key) do update set status = excluded.status, name = excluded.name,
    turma_player_id = coalesce(excluded.turma_player_id, public.event_rsvps.turma_player_id), user_id = coalesce(excluded.user_id, public.event_rsvps.user_id),
    invited_by = coalesce(excluded.invited_by, public.event_rsvps.invited_by),
    source = excluded.source, updated_at = now();
  return answer;
end;
$$;

-- import_rsvps: cada linha pode trazer "invited_by" (convidado de quem).
create or replace function public.import_rsvps(event uuid, rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare e public.turma_events; r jsonb; p public.turma_players; nm text; st text; inv text; n integer := 0;
begin
  select * into e from public.turma_events where id = event;
  if e.id is null or not private.is_admin(e.turma_id) then raise exception 'not_allowed'; end if;
  if e.status <> 'open' then raise exception 'closed'; end if;
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 200 then raise exception 'bad_rows'; end if;
  for r in select * from jsonb_array_elements(rows) loop
    p := null;
    if r ? 'player_id' and (r ->> 'player_id') is not null then
      select * into p from public.turma_players x where x.id = (r ->> 'player_id')::uuid and x.turma_id = e.turma_id;
    end if;
    nm := coalesce(p.name, left(trim(r ->> 'name'), 60));
    st := coalesce(r ->> 'status', 'vou');
    if nm is null or nm = '' or st not in ('vou', 'talvez', 'nao') then continue; end if;
    inv := case when p.id is null then nullif(left(trim(coalesce(r ->> 'invited_by', '')), 60), '') else null end;
    insert into public.event_rsvps (event_id, player_key, name, turma_player_id, user_id, status, source, invited_by)
    values (event, lower(trim(nm)), nm, p.id, p.user_id, st, 'colado', inv)
    on conflict (event_id, player_key) do update set status = excluded.status,
      turma_player_id = coalesce(excluded.turma_player_id, public.event_rsvps.turma_player_id), user_id = coalesce(excluded.user_id, public.event_rsvps.user_id),
      invited_by = coalesce(excluded.invited_by, public.event_rsvps.invited_by),
      source = 'colado', updated_at = now();
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ============ Estatísticas que não foram ligadas à conta ============
-- Quando o nome era ligado (ou o jogador era recriado) depois do baba, as linhas de stats ficavam sem o id do jogador
-- e não entravam em "Meus números". Esta função religa, pelo nome, as linhas soltas dos babas da turma ao jogador da conta.
create or replace function public.relink_my_stats() returns integer
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); n integer := 0; k integer;
begin
  if uid is null then return 0; end if;
  update public.baba_stats s set turma_player_id = tp.id
  from public.turma_players tp, public.babas b
  where tp.user_id = uid and b.id = s.baba_id and tp.turma_id = any (b.turma_ids)
    and lower(trim(s.name)) = lower(trim(tp.name))
    and (s.turma_player_id is null or not exists (select 1 from public.turma_players z where z.id = s.turma_player_id));
  get diagnostics k = row_count;
  n := n + k;
  return n;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['public.rsvp_event(uuid, text, uuid, text, text)', 'public.import_rsvps(uuid, jsonb)', 'public.relink_my_stats()'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
