-- BABA v6: dono da turma, foto/ícone da turma, foto e preferências do perfil.
-- Pode rodar mais de uma vez sem estragar nada.

alter table public.turmas add column if not exists owner_id uuid references auth.users(id) on delete set null default auth.uid();
alter table public.turmas add column if not exists icon text check (icon is null or char_length(icon) <= 200000);
alter table public.profiles add column if not exists avatar text check (avatar is null or char_length(avatar) <= 200000);
alter table public.profiles add column if not exists prefs jsonb not null default '{}'::jsonb;

update public.turmas t set owner_id = t.created_by
where t.owner_id is null and exists (select 1 from public.turma_members m where m.turma_id = t.id and m.user_id = t.created_by);

update public.turmas t set owner_id = (
  select m.user_id from public.turma_members m where m.turma_id = t.id
  order by case m.role when 'admin' then 0 else 1 end, m.joined_at limit 1)
where t.owner_id is null;

update public.turma_members m set role = 'admin' from public.turmas t where t.id = m.turma_id and t.owner_id = m.user_id;

create or replace function private.is_owner(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.turmas x where x.id = t and x.owner_id = (select auth.uid()));
$$;
revoke execute on function private.is_owner(uuid) from public, anon;
grant execute on function private.is_owner(uuid) to authenticated;

-- O dono só muda pelas funções abaixo (passar a turma, excluir conta).
create or replace function public.guard_turma_owner() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id and coalesce(current_setting('baba.owner_change', true), '') <> 'on' then
    raise exception 'owner_change_not_allowed';
  end if;
  return new;
end;
$$;
drop trigger if exists turmas_guard_owner on public.turmas;
create trigger turmas_guard_owner before update on public.turmas for each row execute function public.guard_turma_owner();

alter policy turmas_delete on public.turmas using (private.is_owner(id));
alter policy members_update on public.turma_members using (false) with check (false);
alter policy members_delete on public.turma_members using (
  (user_id = (select auth.uid()) and not private.is_owner(turma_id))
  or (role = 'member' and private.is_admin(turma_id))
  or (role = 'admin' and private.is_owner(turma_id) and user_id <> (select auth.uid()))
);

create or replace function public.handle_new_turma() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_id is null then
    perform set_config('baba.owner_change', 'on', true);
    update public.turmas set owner_id = new.created_by where id = new.id;
    perform set_config('baba.owner_change', '', true);
  end if;
  insert into public.turma_members (turma_id, user_id, role) values (new.id, new.created_by, 'admin')
  on conflict (turma_id, user_id) do update set role = 'admin';
  return new;
end;
$$;

create or replace function public.turma_roster(t uuid)
returns table (user_id uuid, name text, avatar text, role text, joined_at timestamptz, player_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_member(t) then raise exception 'not_member'; end if;
  return query
    select m.user_id, p.name, p.avatar,
           case when x.owner_id = m.user_id then 'owner' else m.role end,
           m.joined_at,
           (select tp.name from public.turma_players tp where tp.turma_id = t and tp.user_id = m.user_id limit 1)
    from public.turma_members m
    join public.turmas x on x.id = m.turma_id
    left join public.profiles p on p.id = m.user_id
    where m.turma_id = t
    order by case when x.owner_id = m.user_id then 0 when m.role = 'admin' then 1 else 2 end, m.joined_at;
end;
$$;

create or replace function public.set_member_role(t uuid, member uuid, new_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_owner(t) then raise exception 'only_owner'; end if;
  if new_role not in ('admin', 'member') then raise exception 'bad_role'; end if;
  if member = (select auth.uid()) then raise exception 'is_owner'; end if;
  update public.turma_members set role = new_role where turma_id = t and user_id = member;
  if not found then raise exception 'not_found'; end if;
end;
$$;

create or replace function public.transfer_turma(t uuid, member uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_owner(t) then raise exception 'only_owner'; end if;
  if member = (select auth.uid()) then raise exception 'is_owner'; end if;
  if not exists (select 1 from public.turma_members where turma_id = t and user_id = member) then raise exception 'not_found'; end if;
  update public.turma_members set role = 'admin' where turma_id = t and user_id = member;
  perform set_config('baba.owner_change', 'on', true);
  update public.turmas set owner_id = member where id = t;
  perform set_config('baba.owner_change', '', true);
end;
$$;

create or replace function public.remove_member(t uuid, member uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r text; owner uuid;
begin
  select owner_id into owner from public.turmas where id = t;
  select role into r from public.turma_members where turma_id = t and user_id = member;
  if r is null then raise exception 'not_found'; end if;
  if member = owner then
    if member = (select auth.uid()) then raise exception 'owner_must_transfer'; end if;
    raise exception 'not_allowed';
  end if;
  if member <> (select auth.uid()) then
    if r = 'admin' and not private.is_owner(t) then raise exception 'not_allowed'; end if;
    if not private.is_admin(t) then raise exception 'not_allowed'; end if;
  end if;
  update public.turma_players set user_id = null where turma_id = t and user_id = member;
  delete from public.turma_members where turma_id = t and user_id = member;
end;
$$;

revoke execute on function public.turma_roster(uuid) from public, anon;
revoke execute on function public.set_member_role(uuid, uuid, text) from public, anon;
revoke execute on function public.transfer_turma(uuid, uuid) from public, anon;
revoke execute on function public.remove_member(uuid, uuid) from public, anon;
revoke execute on function public.guard_turma_owner() from public, anon, authenticated;
grant execute on function public.turma_roster(uuid) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.transfer_turma(uuid, uuid) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- Excluir conta: a turma passa para o adm mais antigo (ou o membro mais antigo).
create or replace function public.srv_prepare_account_deletion(uid uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare t record; heir uuid;
begin
  for t in select x.id from public.turmas x where x.owner_id = uid loop
    select user_id into heir from public.turma_members
      where turma_id = t.id and user_id <> uid
      order by case role when 'admin' then 0 else 1 end, joined_at limit 1;
    if heir is null then
      delete from public.turmas where id = t.id;
    else
      update public.turma_members set role = 'admin' where turma_id = t.id and user_id = heir;
      perform set_config('baba.owner_change', 'on', true);
      update public.turmas set owner_id = heir where id = t.id;
      perform set_config('baba.owner_change', '', true);
    end if;
  end loop;
end;
$$;
