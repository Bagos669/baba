-- Extra pieces of the real project the v8 panel reads (not needed by the v7 tests).
reset role;
alter table auth.users add column if not exists created_at timestamptz default now();
alter table auth.users add column if not exists last_sign_in_at timestamptz;
alter table public.turmas add column if not exists created_at timestamptz default now();
create table if not exists public.turma_players (id uuid primary key default gen_random_uuid(), turma_id uuid references public.turmas on delete cascade, name text, is_goalkeeper boolean default false, user_id uuid, created_at timestamptz default now());
create table if not exists public.babas (id uuid primary key default gen_random_uuid(), created_by uuid, turma_ids uuid[] default '{}', title text, played_on date default current_date, state jsonb, finished boolean default false, matches integer default 0, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists public.baba_stats (id bigserial primary key, baba_id uuid references public.babas on delete cascade, turma_player_id uuid, name text, goals integer default 0, assists integer default 0, saves integer default 0, matches integer default 0, wins integer default 0);
