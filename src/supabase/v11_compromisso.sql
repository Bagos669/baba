-- BABA v11: Compromisso. Lista de presença por turma (puxada pelo adm), confirmação, lista colada
-- do WhatsApp, "Marcou que vem" na chegada, cumpriu x miou, e penalidades (automáticas ou manuais).
-- Rode DEPOIS do v10.1. Pode rodar mais de uma vez.

-- ============ Compromissos (a "lista" de um dia) ============
create table if not exists public.turma_events (
  id uuid primary key default gen_random_uuid(),
  turma_id uuid not null references public.turmas(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  starts_at timestamptz not null,
  place text check (place is null or char_length(place) <= 120),
  note text check (note is null or char_length(note) <= 280),
  max_players integer check (max_players is null or max_players between 2 and 200),
  status text not null default 'open' check (status in ('open', 'canceled', 'done')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists turma_events_turma on public.turma_events (turma_id, starts_at desc);
alter table public.turma_events enable row level security;
drop policy if exists events_select on public.turma_events;
create policy events_select on public.turma_events for select to authenticated using (private.is_member(turma_id));

-- One row per name on the list. player_key = the name in lower case (the same key the turma uses).
create table if not exists public.event_rsvps (
  event_id uuid not null references public.turma_events(id) on delete cascade,
  player_key text not null check (char_length(player_key) between 1 and 60),
  name text not null check (char_length(name) between 1 and 60),
  turma_player_id uuid references public.turma_players(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  status text not null check (status in ('vou', 'talvez', 'nao')),
  source text not null default 'app' check (source in ('app', 'colado', 'adm')),
  outcome text check (outcome is null or outcome in ('cumpriu', 'miou', 'justificado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, player_key)
);
alter table public.event_rsvps enable row level security;
drop policy if exists rsvps_select on public.event_rsvps;
create policy rsvps_select on public.event_rsvps for select to authenticated
  using (exists (select 1 from public.turma_events e where e.id = event_id and private.is_member(e.turma_id)));

-- ============ Regras de presença da turma ============
-- mode: auto = the levels come from the number of "miou" in the window; manual = only what the adm
-- applies; off = nothing. Thresholds are counts of "miou" inside janela_dias.
create table if not exists public.turma_rules (
  turma_id uuid primary key references public.turmas(id) on delete cascade,
  mode text not null default 'auto' check (mode in ('auto', 'manual', 'off')),
  aviso integer not null default 1 check (aviso between 1 and 20),
  prioridade integer not null default 2 check (prioridade between 1 and 20),
  bloqueio integer not null default 3 check (bloqueio between 1 and 20),
  banimento integer not null default 4 check (banimento between 1 and 30),
  janela_dias integer not null default 60 check (janela_dias between 7 and 365),
  updated_at timestamptz not null default now(),
  check (aviso <= prioridade and prioridade <= bloqueio and bloqueio <= banimento)
);
alter table public.turma_rules enable row level security;
drop policy if exists rules_select on public.turma_rules;
create policy rules_select on public.turma_rules for select to authenticated using (private.is_member(turma_id));

-- Sanctions the adm applies by hand (and the record of bans).
create table if not exists public.turma_sanctions (
  id bigserial primary key,
  turma_id uuid not null references public.turmas(id) on delete cascade,
  player_key text not null,
  name text not null,
  kind text not null check (kind in ('aviso', 'prioridade', 'bloqueio', 'banimento')),
  reason text check (reason is null or char_length(reason) <= 200),
  until timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  cleared_at timestamptz
);
create index if not exists sanctions_turma on public.turma_sanctions (turma_id, player_key);
alter table public.turma_sanctions enable row level security;
drop policy if exists sanctions_select on public.turma_sanctions;
create policy sanctions_select on public.turma_sanctions for select to authenticated using (private.is_admin(turma_id));

-- Banned accounts can't come back with the invite.
create table if not exists public.turma_bans (
  turma_id uuid not null references public.turmas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  reason text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (turma_id, user_id)
);
alter table public.turma_bans enable row level security;
drop policy if exists bans_select on public.turma_bans;
create policy bans_select on public.turma_bans for select to authenticated using (private.is_admin(turma_id));

-- ============ Níveis ============
create or replace function private.level_rank(l text) returns integer
language sql immutable set search_path = '' as $$
  select case l when 'aviso' then 1 when 'prioridade' then 2 when 'bloqueio' then 3 when 'banimento' then 4 else 0 end;
$$;

-- Level of one name in one turma: the higher of the automatic level (if the turma uses it) and
-- the adm's active sanctions.
create or replace function private.player_level(t uuid, key text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare r public.turma_rules; misses integer; auto_l text := 'ok'; man text;
begin
  select * into r from public.turma_rules where turma_id = t;
  if r.turma_id is null then r.mode := 'auto'; r.aviso := 1; r.prioridade := 2; r.bloqueio := 3; r.banimento := 4; r.janela_dias := 60; end if;
  if r.mode = 'auto' then
    select count(*) into misses from public.event_rsvps v join public.turma_events e on e.id = v.event_id
    where e.turma_id = t and v.player_key = key and v.outcome = 'miou' and e.starts_at > now() - make_interval(days => r.janela_dias);
    auto_l := case when misses >= r.banimento then 'banimento' when misses >= r.bloqueio then 'bloqueio'
                   when misses >= r.prioridade then 'prioridade' when misses >= r.aviso then 'aviso' else 'ok' end;
  end if;
  if r.mode <> 'off' then
    select s.kind into man from public.turma_sanctions s
    where s.turma_id = t and s.player_key = key and s.cleared_at is null and (s.until is null or s.until > now())
    order by private.level_rank(s.kind) desc limit 1;
  end if;
  return case when private.level_rank(man) > private.level_rank(auto_l) then man else auto_l end;
end;
$$;

-- Everyone in the turma sees the level tags; only adms see the counts and the reasons.
create or replace function public.turma_discipline(t uuid)
returns table (player_key text, name text, level text, misses integer, kept integer, justified integer, sanctions jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare adm boolean; r public.turma_rules; win integer;
begin
  if not private.is_member(t) then raise exception 'not_member'; end if;
  adm := private.is_admin(t);
  select * into r from public.turma_rules where turma_id = t;
  win := coalesce(r.janela_dias, 60);
  return query
    with keys as (
      select lower(trim(p.name)) k, p.name n from public.turma_players p where p.turma_id = t
      union select v.player_key, max(v.name) from public.event_rsvps v join public.turma_events e on e.id = v.event_id where e.turma_id = t group by v.player_key
      union select s.player_key, max(s.name) from public.turma_sanctions s where s.turma_id = t and s.cleared_at is null group by s.player_key
    ), dedup as (select distinct on (k) k, n from keys order by k, n)
    select d.k, d.n, private.player_level(t, d.k),
      case when adm then (select count(*)::integer from public.event_rsvps v join public.turma_events e on e.id = v.event_id
        where e.turma_id = t and v.player_key = d.k and v.outcome = 'miou' and e.starts_at > now() - make_interval(days => win)) end,
      case when adm then (select count(*)::integer from public.event_rsvps v join public.turma_events e on e.id = v.event_id
        where e.turma_id = t and v.player_key = d.k and v.outcome = 'cumpriu' and e.starts_at > now() - make_interval(days => win)) end,
      case when adm then (select count(*)::integer from public.event_rsvps v join public.turma_events e on e.id = v.event_id
        where e.turma_id = t and v.player_key = d.k and v.outcome = 'justificado' and e.starts_at > now() - make_interval(days => win)) end,
      case when adm then coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'reason', s.reason, 'until', s.until, 'created_at', s.created_at) order by s.id desc)
        from public.turma_sanctions s where s.turma_id = t and s.player_key = d.k and s.cleared_at is null and (s.until is null or s.until > now())), '[]'::jsonb) end
    from dedup d;
end;
$$;

create or replace function public.set_turma_rules(t uuid, mode text, aviso integer, prioridade integer, bloqueio integer, banimento integer, janela_dias integer)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin(t) then raise exception 'not_allowed'; end if;
  insert into public.turma_rules (turma_id, mode, aviso, prioridade, bloqueio, banimento, janela_dias, updated_at)
  values (t, mode, aviso, prioridade, bloqueio, banimento, janela_dias, now())
  on conflict (turma_id) do update set mode = excluded.mode, aviso = excluded.aviso, prioridade = excluded.prioridade,
    bloqueio = excluded.bloqueio, banimento = excluded.banimento, janela_dias = excluded.janela_dias, updated_at = now();
end;
$$;

-- ============ Puxar a lista ============
create or replace function public.create_event(t uuid, starts timestamptz, place text, note text, max_players integer)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); eid uuid;
begin
  if not private.is_admin(t) then raise exception 'not_allowed'; end if;
  if starts is null or starts < now() - interval '6 hours' or starts > now() + interval '120 days' then raise exception 'bad_date'; end if;
  if (select count(*) from public.turma_events e where e.turma_id = t and e.status = 'open' and e.starts_at > now() - interval '6 hours') >= 6 then raise exception 'limit'; end if;
  insert into public.turma_events (turma_id, starts_at, place, note, max_players)
  values (t, starts, nullif(left(trim(coalesce(place, '')), 120), ''), nullif(left(trim(coalesce(note, '')), 280), ''), max_players)
  returning id into eid;
  -- The list shows up in the turma chat as a card everyone can answer from.
  begin
    insert into public.chat_messages (room, user_id, body) values ('turma:' || t::text, uid, ':ev:' || eid::text || ':');
  exception when others then null;
  end;
  return eid;
end;
$$;

create or replace function public.update_event(event uuid, starts timestamptz, place text, note text, max_players integer, new_status text)
returns void
language plpgsql security definer set search_path = '' as $$
declare e public.turma_events;
begin
  select * into e from public.turma_events where id = event;
  if e.id is null or not private.is_admin(e.turma_id) then raise exception 'not_allowed'; end if;
  if new_status is not null and new_status not in ('open', 'canceled') then raise exception 'bad_status'; end if;
  update public.turma_events set
    starts_at = coalesce(starts, starts_at),
    place = case when update_event.place is null then turma_events.place else nullif(left(trim(update_event.place), 120), '') end,
    note = case when update_event.note is null then turma_events.note else nullif(left(trim(update_event.note), 280), '') end,
    max_players = case when update_event.max_players = 0 then null else coalesce(update_event.max_players, turma_events.max_players) end,
    status = coalesce(new_status, status)
  where id = event;
end;
$$;

-- Answer the list. No player/name = yourself (the name linked to your account in that turma).
-- Answering for someone else (or adding a name) is for adms.
create or replace function public.rsvp_event(event uuid, answer text, player uuid, player_name text)
returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); e public.turma_events; p public.turma_players; adm boolean; nm text; k text; lvl text;
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
  insert into public.event_rsvps (event_id, player_key, name, turma_player_id, user_id, status, source)
  values (event, k, nm, p.id, p.user_id, answer, case when adm and p.user_id is distinct from uid then 'adm' else 'app' end)
  on conflict (event_id, player_key) do update set status = excluded.status, name = excluded.name,
    turma_player_id = coalesce(excluded.turma_player_id, event_rsvps.turma_player_id), user_id = coalesce(excluded.user_id, event_rsvps.user_id),
    source = excluded.source, updated_at = now();
  return answer;
end;
$$;

-- The adm pastes a list from the group chat: rows = [{"name": "...", "player_id": uuid|null, "status": "vou"|"talvez"|"nao"}]
create or replace function public.import_rsvps(event uuid, rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare e public.turma_events; r jsonb; p public.turma_players; nm text; st text; n integer := 0;
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
    insert into public.event_rsvps (event_id, player_key, name, turma_player_id, user_id, status, source)
    values (event, lower(trim(nm)), nm, p.id, p.user_id, st, 'colado')
    on conflict (event_id, player_key) do update set status = excluded.status,
      turma_player_id = coalesce(excluded.turma_player_id, event_rsvps.turma_player_id), user_id = coalesce(excluded.user_id, event_rsvps.user_id),
      source = 'colado', updated_at = now();
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- End of the day: who kept the promise. outcomes = [{"key": "...", "outcome": "cumpriu"|"miou"|"justificado"}]
-- Returns the names whose level went up, so the adm sees who now has a warning, block or ban suggestion.
create or replace function public.close_event(event uuid, outcomes jsonb)
returns table (player_key text, name text, before_level text, level text)
language plpgsql security definer set search_path = '' as $$
declare e public.turma_events; r jsonb; befores jsonb := '{}'::jsonb; v public.event_rsvps;
begin
  select * into e from public.turma_events where id = event;
  if e.id is null or not private.is_admin(e.turma_id) then raise exception 'not_allowed'; end if;
  if e.status = 'canceled' then raise exception 'canceled'; end if;
  if jsonb_typeof(outcomes) <> 'array' then raise exception 'bad_rows'; end if;
  for v in select * from public.event_rsvps x where x.event_id = event loop
    befores := befores || jsonb_build_object(v.player_key, private.player_level(e.turma_id, v.player_key));
  end loop;
  for r in select * from jsonb_array_elements(outcomes) loop
    if (r ->> 'outcome') in ('cumpriu', 'miou', 'justificado') then
      update public.event_rsvps x set outcome = r ->> 'outcome', updated_at = now() where x.event_id = event and x.player_key = lower(trim(r ->> 'key'));
    elsif (r ->> 'outcome') is null then
      update public.event_rsvps x set outcome = null, updated_at = now() where x.event_id = event and x.player_key = lower(trim(r ->> 'key'));
    end if;
  end loop;
  update public.turma_events set status = 'done', closed_at = now() where id = event;
  return query
    select x.player_key, x.name, befores ->> x.player_key, private.player_level(e.turma_id, x.player_key)
    from public.event_rsvps x where x.event_id = event
      and private.level_rank(private.player_level(e.turma_id, x.player_key)) > private.level_rank(befores ->> x.player_key);
end;
$$;

-- ============ Sanções manuais ============
create or replace function public.add_sanction(t uuid, key text, player_name text, kind text, reason text, days integer)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare sid bigint;
begin
  if not private.is_admin(t) then raise exception 'not_allowed'; end if;
  if kind not in ('aviso', 'prioridade', 'bloqueio') then raise exception 'bad_kind'; end if;
  insert into public.turma_sanctions (turma_id, player_key, name, kind, reason, until)
  values (t, lower(trim(key)), left(trim(coalesce(player_name, key)), 60), kind, nullif(left(trim(coalesce(reason, '')), 200), ''),
          case when days is null or days <= 0 then null else now() + make_interval(days => least(days, 365)) end)
  returning id into sid;
  return sid;
end;
$$;

create or replace function public.clear_sanction(sanction bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.turma_sanctions;
begin
  select * into s from public.turma_sanctions where id = sanction;
  if s.id is null or not private.is_admin(s.turma_id) then raise exception 'not_allowed'; end if;
  update public.turma_sanctions set cleared_at = now() where id = sanction;
end;
$$;

-- Banning always goes through an adm (never automatic): the account leaves the turma and the invite
-- stops working for it. Banning an adm needs the owner; the owner can't be banned.
create or replace function public.ban_player(t uuid, key text, reason text) returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); p public.turma_players; r text; owner uuid;
begin
  if not private.is_admin(t) then raise exception 'not_allowed'; end if;
  select * into p from public.turma_players x where x.turma_id = t and lower(trim(x.name)) = lower(trim(key)) limit 1;
  select owner_id into owner from public.turmas where id = t;
  insert into public.turma_sanctions (turma_id, player_key, name, kind, reason)
  values (t, lower(trim(key)), left(coalesce(p.name, key), 60), 'banimento', nullif(left(trim(coalesce(reason, '')), 200), ''));
  if p.user_id is not null then
    if p.user_id = owner or p.user_id = uid then raise exception 'not_allowed'; end if;
    select role into r from public.turma_members where turma_id = t and user_id = p.user_id;
    if r = 'admin' and not private.is_owner(t) then raise exception 'not_allowed'; end if;
    insert into public.turma_bans (turma_id, user_id, name, reason) values (t, p.user_id, p.name, nullif(left(trim(coalesce(reason, '')), 200), ''))
    on conflict (turma_id, user_id) do update set reason = excluded.reason, created_at = now();
    update public.turma_players set user_id = null where turma_id = t and user_id = p.user_id;
    delete from public.turma_members where turma_id = t and user_id = p.user_id;
    return 'banned_account';
  end if;
  return 'banned_name';
end;
$$;

create or replace function public.unban_player(t uuid, key text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin(t) then raise exception 'not_allowed'; end if;
  update public.turma_sanctions set cleared_at = now() where turma_id = t and player_key = lower(trim(key)) and kind = 'banimento' and cleared_at is null;
  delete from public.turma_bans b where b.turma_id = t and lower(trim(coalesce(b.name, ''))) = lower(trim(key));
end;
$$;

create or replace function public.join_turma(code text)
returns table (id uuid, name text)
language plpgsql security definer set search_path = '' as $$
declare t public.turmas;
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  select * into t from public.turmas where invite_code = upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
  if t.id is null then raise exception 'invalid_code'; end if;
  if exists (select 1 from public.turma_bans b where b.turma_id = t.id and b.user_id = (select auth.uid())) then raise exception 'banned_from_turma'; end if;
  insert into public.turma_members (turma_id, user_id, role) values (t.id, (select auth.uid()), 'member')
  on conflict (turma_id, user_id) do nothing;
  return query select t.id, t.name;
end;
$$;

-- ============ Push da lista (edge function live-push) ============
create or replace function public.srv_event_claim(event uuid, caller uuid, push_key text) returns text
language plpgsql security definer set search_path = '' as $$
declare e public.turma_events;
begin
  select * into e from public.turma_events where id = event;
  if e.id is null then return 'no_event'; end if;
  if not exists (select 1 from public.turma_members m where m.turma_id = e.turma_id and m.user_id = caller and m.role = 'admin')
     and not exists (select 1 from public.turmas x where x.id = e.turma_id and x.owner_id = caller) then return 'not_allowed'; end if;
  if (select count(*) from private.push_sent p where p.live_id = event and p.sent_at > now() - interval '1 hour') >= 10 then return 'limit'; end if;
  insert into private.push_sent (live_id, key) values (event, left(push_key, 80)) on conflict do nothing;
  if not found then return 'dup'; end if;
  return 'ok';
end;
$$;

create or replace function public.srv_event_targets(event uuid, caller uuid)
returns table (endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = '' as $$
  select distinct s.endpoint, s.p256dh, s.auth
  from public.push_subs s join public.turma_events e on e.id = event
  join public.turma_members m on m.turma_id = e.turma_id and m.user_id = s.user_id
  where s.turma_on and s.user_id <> caller;
$$;

-- ============ Permissions ============
revoke execute on function private.level_rank(text) from public, anon, authenticated;
revoke execute on function private.player_level(uuid, text) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.turma_discipline(uuid)', 'public.set_turma_rules(uuid, text, integer, integer, integer, integer, integer)',
    'public.create_event(uuid, timestamptz, text, text, integer)', 'public.update_event(uuid, timestamptz, text, text, integer, text)',
    'public.rsvp_event(uuid, text, uuid, text)', 'public.import_rsvps(uuid, jsonb)', 'public.close_event(uuid, jsonb)',
    'public.add_sanction(uuid, text, text, text, text, integer)', 'public.clear_sanction(bigint)', 'public.ban_player(uuid, text, text)',
    'public.unban_player(uuid, text)', 'public.join_turma(text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public.srv_event_claim(uuid, uuid, text)', 'public.srv_event_targets(uuid, uuid)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
