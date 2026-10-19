-- BABA v11.4.2: Avisos no celular (lista aberta, véspera sem resposta, palpites liquidados).
-- Rode DEPOIS do v11_4_1_palpites_livres.sql. Pode rodar mais de uma vez e não apaga nada que já existe.
--
-- Como funciona (tudo no servidor, sem depender de alguém abrir o app):
--   1. A cada minuto o agendador (pg_cron) chama private.avisos_tick().
--   2. Se há algum aviso a mandar, o tick chama a Edge Function live-push (pg_net) com um segredo.
--   3. A função pede public.srv_avisos_pendentes(), que escolhe quem recebe e GRAVA o envio na tabela de controle
--      (private.aviso_envios, único por tipo + evento + usuário) antes de devolver os endereços. Repetir não duplica.
--   4. Criar evento e liquidar palpites não chamam nada daqui: se o envio falhar, nada trava.
--
-- Depois de rodar este arquivo, falta UMA configuração (veja o bloco "Configuração" no fim do arquivo).
-- O segredo AVISOS_SECRET fica só no painel do Supabase (Edge Functions → Secrets) e na linha de configuração abaixo.

-- ============ Tabela de controle ============
-- Um registro por aviso mandado: nunca o mesmo tipo, para o mesmo evento e a mesma pessoa, duas vezes.
create table if not exists private.aviso_envios (
  tipo text not null check (tipo in ('lista', 'vespera', 'palpites')),
  event_id uuid not null references public.turma_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (tipo, event_id, user_id)
);
create index if not exists aviso_envios_sent on private.aviso_envios (sent_at);
alter table private.aviso_envios enable row level security;

-- Endereço da Edge Function e segredo do agendador (uma linha só). Preenchida à mão, nunca por arquivo.
create table if not exists private.avisos_cfg (
  id boolean primary key default true check (id),
  url text,
  secret text
);
alter table private.avisos_cfg enable row level security;

-- ============ Ajudantes ============
-- Dia da semana no fuso de Brasília ("sábado").
create or replace function private.aviso_dia(ts timestamptz) returns text
language sql stable set search_path = '' as $$
  select (array['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'])[extract(dow from (ts at time zone 'America/Sao_Paulo'))::integer + 1]
$$;

-- Interruptor do aviso nas preferências da conta (Configurações). Sem valor salvo = ligado.
create or replace function private.aviso_on(uid uuid, k text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.prefs ->> k from public.profiles p where p.id = uid), 'true') <> 'false'
$$;

-- ============ Quem recebe o quê (sem gravar nada) ============
-- agora = parâmetro só para os testes poderem escolher o relógio.
create or replace function private.avisos_candidatos(agora timestamptz default now())
returns table (tipo text, event_id uuid, user_id uuid, title text, body text)
language sql stable security definer set search_path = '' as $$
  -- 1) Lista aberta: evento criado há pouco, para os membros da turma menos quem criou.
  select 'lista'::text, e.id, m.user_id,
         case when (select count(*) from public.event_rsvps r where r.event_id = e.id and r.status = 'vou') = 0
              then 'Lista de ' || private.aviso_dia(e.starts_at) || ' aberta. Vai?'
              else 'Lista de ' || private.aviso_dia(e.starts_at) || ' aberta: '
                   || (select count(*) from public.event_rsvps r where r.event_id = e.id and r.status = 'vou')
                   || case when (select count(*) from public.event_rsvps r where r.event_id = e.id and r.status = 'vou') = 1 then ' confirmado' else ' confirmados' end
         end,
         t.name || coalesce(' · ' || e.place, '')
  from public.turma_events e
  join public.turmas t on t.id = e.turma_id
  join public.turma_members m on m.turma_id = e.turma_id
  where e.status = 'open' and e.created_at > agora - interval '30 minutes' and e.created_at <= agora and e.starts_at > agora
    and m.user_id is distinct from e.created_by
    and private.aviso_on(m.user_id, 'avisoLista')
    and exists (select 1 from public.push_subs s where s.user_id = m.user_id)
    and not exists (select 1 from private.aviso_envios x where x.tipo = 'lista' and x.event_id = e.id and x.user_id = m.user_id)
  union all
  -- 2) Véspera: 24 h antes do baba, para quem ainda não respondeu (nem Vou, nem Talvez, nem Não vou).
  --    Não vale para lista cancelada/fechada, baba que já começou, nem lista criada com menos de 24 h de antecedência.
  --    O texto diz "amanhã": só sai enquanto ainda é a véspera (dia anterior no fuso de Brasília).
  select 'vespera'::text, e.id, m.user_id,
         upper(left(private.aviso_dia(e.starts_at), 1)) || substr(private.aviso_dia(e.starts_at), 2) || ' tem baba amanhã e você ainda não respondeu. Vai?',
         t.name || coalesce(' · ' || e.place, '')
  from public.turma_events e
  join public.turmas t on t.id = e.turma_id
  join public.turma_members m on m.turma_id = e.turma_id
  where e.status = 'open' and e.starts_at > agora and e.starts_at - interval '24 hours' <= agora
    and e.created_at <= e.starts_at - interval '24 hours'
    and (e.starts_at at time zone 'America/Sao_Paulo')::date = (agora at time zone 'America/Sao_Paulo')::date + 1
    and private.aviso_on(m.user_id, 'avisoLembrete')
    and exists (select 1 from public.push_subs s where s.user_id = m.user_id)
    and not exists (select 1 from private.aviso_envios x where x.tipo = 'vespera' and x.event_id = e.id and x.user_id = m.user_id)
    and not exists (
      select 1 from public.event_rsvps r
      where r.event_id = e.id and (
        r.user_id = m.user_id
        or exists (select 1 from public.turma_players p where p.turma_id = e.turma_id and p.user_id = m.user_id
                   and (p.id = r.turma_player_id or lower(trim(p.name)) = r.player_key))))
  union all
  -- 3) Palpites liquidados: uma vez por pessoa e evento, quando nenhum palpite dela está mais em aberto.
  --    Lucro = pagamentos recebidos - pontos apostados, só palpites ganhos e perdidos (devolvidos não entram).
  select 'palpites'::text, b.event_id, b.user_id,
         case when b.total = 0
              then 'Seus palpites do baba de ' || private.aviso_dia(e.starts_at) || ' foram devolvidos'
              else 'Você acertou ' || b.ganhos || ' de ' || b.total || case when b.total = 1 then ' palpite: ' else ' palpites: ' end
                   || case when b.lucro >= 0 then '+' || b.lucro else '−' || abs(b.lucro) end || ' pts'
         end,
         t.name || coalesce(' · ' || e.place, '')
  from (
    select pm.event_id, pb.user_id,
           count(*) filter (where pb.status = 'won') as ganhos,
           count(*) filter (where pb.status in ('won', 'lost')) as total,
           count(*) filter (where pb.status = 'open') as abertos,
           coalesce(sum(pb.payout) filter (where pb.status = 'won'), 0) - coalesce(sum(pb.stake) filter (where pb.status in ('won', 'lost')), 0) as lucro
    from public.prop_bets pb join public.prop_markets pm on pm.id = pb.market_id
    where pm.event_id in (select m2.event_id from public.prop_markets m2 where m2.settled_at > agora - interval '2 days')
    group by pm.event_id, pb.user_id
  ) b
  join public.turma_events e on e.id = b.event_id
  join public.turmas t on t.id = e.turma_id
  where b.abertos = 0
    and private.aviso_on(b.user_id, 'avisoPalpites')
    and exists (select 1 from public.push_subs s where s.user_id = b.user_id)
    and not exists (select 1 from private.aviso_envios x where x.tipo = 'palpites' and x.event_id = b.event_id and x.user_id = b.user_id)
$$;

-- ============ Escolher e gravar (só a Edge Function, com a chave de serviço) ============
-- Grava o envio ANTES de devolver os endereços: chamar de novo (retentativa, dois agendadores ao mesmo tempo)
-- não devolve de novo o mesmo aviso. Se o celular não recebeu, o aviso se perde; nunca chega duas vezes.
create or replace function public.srv_avisos_pendentes()
returns table (tipo text, event_id uuid, endpoint text, p256dh text, auth text, title text, body text)
language sql volatile security definer set search_path = '' as $$
  with c as (select * from private.avisos_candidatos() order by 2, 3 limit 500),
  ins as (
    insert into private.aviso_envios (tipo, event_id, user_id)
    select c.tipo, c.event_id, c.user_id from c
    on conflict do nothing
    returning aviso_envios.tipo, aviso_envios.event_id, aviso_envios.user_id
  )
  select c.tipo, c.event_id, s.endpoint, s.p256dh, s.auth, c.title, c.body
  from ins join c on c.tipo = ins.tipo and c.event_id = ins.event_id and c.user_id = ins.user_id
  join public.push_subs s on s.user_id = c.user_id
$$;

-- ============ O relógio ============
-- Roda a cada minuto. 1) Faz sozinho o que as outras telas fazem "quando alguém abre": devolve os palpites de lista
-- cancelada ou de baba que ninguém finalizou em 72 h (mesmas regras de private.props_refresh), para o aviso de devolução
-- não depender de alguém abrir a Lojinha. 2) Só chama a Edge Function se existe aviso a mandar.
create or replace function private.avisos_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare cfg private.avisos_cfg; ev uuid;
begin
  begin
    for ev in select distinct m.event_id from public.prop_markets m join public.turma_events e on e.id = m.event_id
              where m.status in ('open', 'locked') and e.status = 'canceled' loop
      perform private.void_props(ev, 'cancelado');
    end loop;
    for ev in select distinct m.event_id from public.prop_markets m join public.turma_events e on e.id = m.event_id
              where m.status in ('open', 'locked') and e.status <> 'canceled' and e.starts_at < now() - interval '72 hours'
                and not exists (select 1 from public.babas b where b.event_id = e.id and b.finished) loop
      perform private.void_props(ev, 'expirado');
    end loop;
    delete from private.aviso_envios where sent_at < now() - interval '120 days';
  exception when others then
    raise warning 'avisos_tick limpeza: %', sqlerrm;
  end;
  select * into cfg from private.avisos_cfg limit 1;
  if cfg.url is null or cfg.secret is null then return; end if;
  if not exists (select 1 from private.avisos_candidatos()) then return; end if;
  perform net.http_post(url := cfg.url, body := '{"modo":"avisos"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-avisos-secret', cfg.secret), timeout_milliseconds := 20000);
exception when others then
  raise warning 'avisos_tick: %', sqlerrm;
end;
$$;

-- ============ Permissões ============
revoke all on private.aviso_envios, private.avisos_cfg from public, anon, authenticated;
revoke execute on function private.aviso_dia(timestamptz), private.aviso_on(uuid, text), private.avisos_candidatos(timestamptz), private.avisos_tick()
  from public, anon, authenticated;
revoke execute on function public.srv_avisos_pendentes() from public, anon, authenticated;
grant execute on function public.srv_avisos_pendentes() to service_role;

-- ============ Agendamento (a cada minuto) ============
-- Precisa das extensões pg_cron e pg_net. Se der aviso aqui, ligue as duas em Database → Extensions e rode este arquivo de novo.
do $$
begin
  begin
    create extension if not exists pg_net;
    create extension if not exists pg_cron;
    if exists (select 1 from cron.job where jobname = 'baba-avisos') then perform cron.unschedule('baba-avisos'); end if;
    perform cron.schedule('baba-avisos', '* * * * *', 'select private.avisos_tick()');
  exception when others then
    raise notice 'Agendamento não criado (%). Ligue pg_cron e pg_net em Database → Extensions e rode este arquivo de novo.', sqlerrm;
  end;
end $$;

-- ============ Configuração (uma vez só, no SQL Editor — não salve o segredo em nenhum arquivo) ============
-- 1. Em Edge Functions → Secrets, crie AVISOS_SECRET com um texto longo e aleatório (30+ caracteres).
-- 2. Publique de novo a função live-push (arquivo src/supabase/functions/live-push/index.ts) com "Verify JWT" DESLIGADO
--    (ela confere o login sozinha; o agendador entra pelo segredo).
-- 3. Rode isto UMA vez, trocando o texto pelo MESMO valor do AVISOS_SECRET:
--
--    insert into private.avisos_cfg (id, url, secret)
--    values (true, 'https://gwndkwnodlfgbcpesenr.supabase.co/functions/v1/live-push', 'COLE_AQUI_O_MESMO_VALOR_DO_AVISOS_SECRET')
--    on conflict (id) do update set url = excluded.url, secret = excluded.secret;
--
-- Conferir se está agendado:  select jobname, schedule, active from cron.job where jobname = 'baba-avisos';
-- Pausar os avisos:           update private.avisos_cfg set secret = null;
