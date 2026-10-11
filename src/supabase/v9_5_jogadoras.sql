-- BABA v9.5: jogadoras nas turmas (artilheira, garçonete, paredona).
-- Rode DEPOIS do v9. Pode rodar mais de uma vez.
alter table public.turma_players add column if not exists is_female boolean not null default false;
