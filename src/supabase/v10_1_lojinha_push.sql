-- BABA v10.1: lojinha nova (títulos, codinome, mascote, anúncio de gol, fundo do card, som de gol,
-- pipoca) e notificações push do jogo ao vivo.
-- Rode DEPOIS do v10. Pode rodar mais de uma vez.

-- ============ Itens novos ============
alter table public.shop_items drop constraint if exists shop_items_kind_check;
alter table public.shop_items add constraint shop_items_kind_check
  check (kind in ('frame', 'name', 'fx', 'title', 'nick', 'mascot', 'goalcard', 'cardbg', 'goalsound'));

insert into public.shop_items (id, kind, tier, title, price, sort) values
  -- Títulos (aparecem embaixo do nome)
  ('title_fominha', 'title', 'fominha', 'Título · Fominha', 300, 40),
  ('title_resenha', 'title', 'resenha', 'Título · Rei da Resenha', 300, 41),
  ('title_perna', 'title', 'perna', 'Título · Perna de Pau', 200, 42),
  ('title_matador', 'title', 'matador', 'Título · Matador', 400, 43),
  ('title_camisa10', 'title', 'camisa10', 'Título · Camisa 10', 400, 44),
  ('title_paredao', 'title', 'paredao', 'Título · Paredão', 400, 45),
  ('title_garcom', 'title', 'garcom', 'Título · Garçom', 400, 46),
  ('title_xerife', 'title', 'xerife', 'Título · Xerife da Zaga', 400, 47),
  ('title_rei', 'title', 'rei', 'Título · Rei da Quadra', 800, 48),
  ('title_lenda', 'title', 'lenda', 'Título · Lenda do Baba', 1500, 49),
  -- Codinome livre
  ('nick_codinome', 'nick', null, 'Codinome', 500, 50),
  -- Mascote (o Babinha que te acompanha)
  ('mascot_wink', 'mascot', 'wink', 'Babinha Piscadinha', 500, 60),
  ('mascot_coach', 'mascot', 'coach', 'Babinha Professor', 600, 61),
  ('mascot_dancinha', 'mascot', 'dancinha', 'Babinha Dancinha', 600, 62),
  ('mascot_arrogante', 'mascot', 'arrogante', 'Babinha Marrento', 700, 63),
  ('mascot_carretilha', 'mascot', 'carretilha', 'Babinha Carretilha', 900, 64),
  ('mascot_siuu', 'mascot', 'siuu', 'Babinha Comemoração', 900, 65),
  ('mascot_champion', 'mascot', 'champion', 'Babinha Campeão', 1200, 66),
  ('mascot_aura', 'mascot', 'aura', 'Babinha Aura', 1500, 67),
  -- Cartão de anúncio de gol
  ('goalcard_fogo', 'goalcard', 'fogo', 'Anúncio de gol · Fogo', 800, 70),
  ('goalcard_raio', 'goalcard', 'raio', 'Anúncio de gol · Raio', 800, 71),
  ('goalcard_retro', 'goalcard', 'retro', 'Anúncio de gol · Fliperama', 1000, 72),
  ('goalcard_neon', 'goalcard', 'neon', 'Anúncio de gol · Neon', 1000, 73),
  ('goalcard_ouro', 'goalcard', 'ouro', 'Anúncio de gol · Ouro', 1500, 74),
  ('goalcard_galaxia', 'goalcard', 'galaxia', 'Anúncio de gol · Galáxia', 2000, 75),
  -- Fundo do card de atleta
  ('cardbg_gramado', 'cardbg', 'gramado', 'Card · Gramado', 500, 80),
  ('cardbg_noite', 'cardbg', 'noite', 'Card · Jogo à Noite', 700, 81),
  ('cardbg_por-do-sol', 'cardbg', 'por-do-sol', 'Card · Pôr do Sol', 800, 82),
  ('cardbg_retro', 'cardbg', 'retro', 'Card · Álbum Antigo', 900, 83),
  ('cardbg_ouro', 'cardbg', 'ouro', 'Card · Ouro', 1800, 84),
  ('cardbg_holo', 'cardbg', 'holo', 'Card · Holográfico', 2500, 85),
  -- Som de gol (toca no celular de quem organiza quando você marca)
  ('goalsound_corneta', 'goalsound', 'corneta', 'Som de gol · Corneta', 500, 90),
  ('goalsound_sirene', 'goalsound', 'sirene', 'Som de gol · Sirene', 500, 91),
  ('goalsound_tambor', 'goalsound', 'tambor', 'Som de gol · Batucada', 600, 92),
  ('goalsound_torcida', 'goalsound', 'torcida', 'Som de gol · Torcida', 600, 93),
  ('goalsound_arcade', 'goalsound', 'arcade', 'Som de gol · Fliperama', 700, 94)
on conflict (id) do update set kind = excluded.kind, tier = excluded.tier, title = excluded.title, price = excluded.price, sort = excluded.sort;

-- slot: frame | name | frameShine | nameShine | title | mascot | goalCard | cardBg | goalSound  (item null = tirar)
create or replace function public.equip_item(slot text, item text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); it public.shop_items; cur jsonb; want text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  want := case slot when 'frame' then 'frame' when 'name' then 'name' when 'frameShine' then 'fx' when 'nameShine' then 'fx'
    when 'title' then 'title' when 'mascot' then 'mascot' when 'goalCard' then 'goalcard' when 'cardBg' then 'cardbg' when 'goalSound' then 'goalsound' end;
  if want is null then raise exception 'bad_slot'; end if;
  if item is not null then
    select * into it from public.shop_items where id = item;
    if it.id is null or it.kind <> want then raise exception 'bad_item'; end if;
    if slot = 'frameShine' and item not like 'fx\_frame\_%' then raise exception 'bad_item'; end if;
    if slot = 'nameShine' and item not like 'fx\_name\_%' then raise exception 'bad_item'; end if;
    if not exists (select 1 from public.user_items where user_id = uid and item_id = item) then raise exception 'not_owned'; end if;
  end if;
  select cosmetics into cur from public.profiles where id = uid;
  cur := coalesce(cur, '{}'::jsonb);
  if item is null then cur := cur - slot;
  elsif want = 'fx' then cur := cur || jsonb_build_object(slot, coalesce(to_jsonb(it.tier), 'true'::jsonb));
  else cur := cur || jsonb_build_object(slot, it.tier);
  end if;
  update public.profiles set cosmetics = cur where id = uid;
  return cur;
end;
$$;

-- ============ Codinome ============
-- Letters, numbers, spaces and . ' " - only; 2 to 20 characters; no insults.
create or replace function private.bad_words(t text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare n text; w text;
begin
  n := lower(translate(t, 'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç0134@$', 'aaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuuccoieaas'));
  n := regexp_replace(n, '(.)\1+', '\1', 'g');             -- poooorra -> pora
  foreach w in array array['pora', 'porra', 'caralh', 'buceta', 'boceta', 'piroc', 'puta', 'puto', 'viad', 'traveco', 'vagabund', 'vadia',
    'arombad', 'arrombad', 'cuzao', 'merda', 'bosta', 'crioul', 'macaco', 'retardad', 'mongol', 'nazi', 'hitler', 'estupr', 'pedofil', 'xota', 'xoxota', 'punheta', 'foder', 'fodid'] loop
    if position(w in regexp_replace(n, '[^a-z]', '', 'g')) > 0 then return true; end if;
  end loop;
  foreach w in array array['cu', 'pau no cu', 'fdp', 'pnc', 'vsf', 'tnc', 'bicha', 'corno', 'gay', 'veado', 'pica'] loop
    if n ~ ('(^|[^a-z])' || w || '([^a-z]|$)') then return true; end if;
  end loop;
  return false;
end;
$$;

create or replace function public.set_nickname(nick text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); cur jsonb; v text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.user_items where user_id = uid and item_id = 'nick_codinome') then raise exception 'not_owned'; end if;
  select cosmetics into cur from public.profiles where id = uid;
  cur := coalesce(cur, '{}'::jsonb);
  v := regexp_replace(trim(coalesce(nick, '')), '\s+', ' ', 'g');
  if v = '' then cur := cur - 'nick';
  else
    if char_length(v) < 2 or char_length(v) > 20 then raise exception 'bad_length'; end if;
    if v !~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .''"-]+$' then raise exception 'bad_chars'; end if;
    if private.bad_words(v) then raise exception 'bad_word'; end if;
    cur := cur || jsonb_build_object('nick', v);
  end if;
  update public.profiles set cosmetics = cur where id = uid;
  return cur;
end;
$$;

-- ============ Pipoca ============
-- 150 points put a popcorn on a friend's card for 24 hours. Only between people of the same turma.
create table if not exists public.pipocas (
  id bigserial primary key,
  target uuid not null references auth.users(id) on delete cascade,
  thrower uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists pipocas_target on public.pipocas (target, expires_at desc);
create index if not exists pipocas_thrower on public.pipocas (thrower, created_at desc);
alter table public.pipocas enable row level security;
drop policy if exists pipocas_select on public.pipocas;
create policy pipocas_select on public.pipocas for select to authenticated using (target = (select auth.uid()) or thrower = (select auth.uid()));

create or replace function public.throw_pipoca(target uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); bal integer; who text; until timestamptz := now() + interval '24 hours';
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if target = uid then raise exception 'self'; end if;
  if private.is_banned(uid) then raise exception 'banned'; end if;
  if not exists (select 1 from public.turma_members a join public.turma_members b on b.turma_id = a.turma_id where a.user_id = uid and b.user_id = target) then raise exception 'not_friends'; end if;
  if exists (select 1 from public.pipocas p where p.target = throw_pipoca.target and p.expires_at > now()) then raise exception 'already'; end if;
  if (select count(*) from public.pipocas p where p.thrower = uid and p.created_at > now() - interval '24 hours') >= 3 then raise exception 'limit'; end if;
  perform 1 from public.my_wallet();
  bal := private.add_points(uid, -150, 'pipoca', target::text);
  insert into public.pipocas (target, thrower, expires_at) values (target, uid, until);
  select name into who from public.profiles where id = uid;
  update public.profiles set cosmetics = coalesce(cosmetics, '{}'::jsonb) || jsonb_build_object('pipoca', jsonb_build_object('until', until, 'from', left(coalesce(who, 'Alguém'), 40)))
  where id = target;
  return bal;
end;
$$;

-- ============ Notificações push ============
-- A phone's subscription (with or without an account). Live follows are per game; accounts also get
-- the games of their turmas (turma_on).
create table if not exists public.push_subs (
  endpoint text primary key check (endpoint ~ '^https://' and char_length(endpoint) < 1000),
  p256dh text not null check (char_length(p256dh) < 200),
  auth text not null check (char_length(auth) < 100),
  user_id uuid references auth.users(id) on delete cascade,
  turma_on boolean not null default false,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index if not exists push_subs_user on public.push_subs (user_id);
alter table public.push_subs enable row level security;

create table if not exists public.push_follows (
  endpoint text not null references public.push_subs(endpoint) on delete cascade on update cascade,
  live_id uuid not null references public.live_games(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (endpoint, live_id)
);
create index if not exists push_follows_live on public.push_follows (live_id);
alter table public.push_follows enable row level security;

-- What was already sent (no repeats when the organizer's phone retries) and how much.
create table if not exists private.push_sent (
  live_id uuid not null,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (live_id, key)
);

-- live_code: follow that game. turma: also get the games of my turmas (needs an account).
create or replace function public.save_push(ep text, p256dh_key text, auth_key text, live_code text, turma boolean)
returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); lid uuid;
begin
  insert into public.push_subs (endpoint, p256dh, auth, user_id, turma_on)
  values (ep, p256dh_key, auth_key, uid, coalesce(turma, false) and uid is not null)
  on conflict on constraint push_subs_pkey do update set p256dh = excluded.p256dh, auth = excluded.auth,
    user_id = coalesce(excluded.user_id, public.push_subs.user_id),
    turma_on = case when turma is null then public.push_subs.turma_on else excluded.turma_on end;
  if live_code is not null then
    select g.id into lid from public.live_games g where g.code = upper(live_code) and g.active;
    if lid is null then raise exception 'no_game'; end if;
    insert into public.push_follows (endpoint, live_id) values (ep, lid) on conflict do nothing;
  end if;
  return 'ok';
end;
$$;

-- live_code: stop following that game; turma false: stop the turma games; neither: forget this phone.
create or replace function public.drop_push(ep text, live_code text, turma boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if live_code is not null then
    delete from public.push_follows f using public.live_games g
    where f.endpoint = ep and f.live_id = g.id and g.code = upper(live_code);
  elsif turma is not null then
    update public.push_subs set turma_on = turma where push_subs.endpoint = ep;
  else
    delete from public.push_subs where push_subs.endpoint = ep;
  end if;
end;
$$;

create or replace function public.push_status(ep text, live_code text)
returns table (known boolean, turma_on boolean, following boolean)
language sql stable security definer set search_path = '' as $$
  select s.endpoint is not null, coalesce(s.turma_on, false),
         exists (select 1 from public.push_follows f join public.live_games g on g.id = f.live_id where f.endpoint = push_status.ep and g.code = upper(coalesce(live_code, '')))
  from (select 1) x left join public.push_subs s on s.endpoint = push_status.ep;
$$;

-- Only the edge function (service role) calls these two.
-- Who gets a push for this game: whoever follows it, plus members of its turmas who turned turma
-- notifications on. Never the organizer's own phones.
create or replace function public.srv_push_targets(live uuid)
returns table (endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = '' as $$
  select distinct s.endpoint, s.p256dh, s.auth
  from public.push_subs s, public.live_games g
  where g.id = live and g.active and (s.user_id is null or s.user_id <> g.owner)
    and (exists (select 1 from public.push_follows f where f.endpoint = s.endpoint and f.live_id = g.id)
      or (s.turma_on and s.user_id is not null and exists (select 1 from public.turma_members m where m.user_id = s.user_id and m.turma_id = any(g.turma_ids))));
$$;

-- Checks the caller owns the game, drops repeats and keeps it to 120 pushes an hour per game.
create or replace function public.srv_push_claim(live uuid, caller uuid, push_key text) returns text
language plpgsql security definer set search_path = '' as $$
declare g public.live_games;
begin
  select * into g from public.live_games where id = live;
  if g.id is null or not g.active then return 'no_game'; end if;
  if g.owner <> caller then return 'only_owner'; end if;
  if (select count(*) from private.push_sent p where p.live_id = live and p.sent_at > now() - interval '1 hour') >= 120 then return 'limit'; end if;
  insert into private.push_sent (live_id, key) values (live, left(push_key, 80)) on conflict do nothing;
  if not found then return 'dup'; end if;
  delete from private.push_sent where sent_at < now() - interval '2 days';
  return 'ok';
end;
$$;

create or replace function public.srv_push_gone(endpoints text[]) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subs where endpoint = any(endpoints);
$$;

-- ============ Permissions ============
revoke execute on function private.bad_words(text) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.set_nickname(text)', 'public.throw_pipoca(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public.save_push(text, text, text, text, boolean)', 'public.drop_push(text, text, boolean)', 'public.push_status(text, text)'] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  foreach f in array array['public.srv_push_targets(uuid)', 'public.srv_push_claim(uuid, uuid, text)', 'public.srv_push_gone(text[])'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
