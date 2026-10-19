# BABA · mapa do projeto

PWA de gestão de pelada (baba): lista de presença, times e fila Rei da Quadra, placar/cronômetro, stats, turmas,
ao vivo com palpites, aba Resenha (palpites pré-jogo, ranking de palpiteiros, missões e a lojinha de Baba Points). Dono: Gabriel Marini. **Responda sempre em português.**

- Site: https://bagos669.github.io/baba/ (GitHub Pages da branch `main` do repo `Bagos669/baba`)
- Banco: Supabase, projeto `gwndkwnodlfgbcpesenr`. O usuário roda os SQL à mão no SQL Editor; **nunca aplique migração sozinho**.
- Linhas citadas abaixo mudam a cada versão: procure pelo **nome** da função (grep), não pelo número.

## Pastas

```
/            site PUBLICADO (gerado pelo build). Não edite app.js, index.html, sw.js, app.css aqui.
src/js/*.js        todo o JavaScript do app, em 17 módulos (564 funções, vanilla, sem bundler). Índice abaixo
src/html/*.html    todo o HTML + CSS próprio + config do Tailwind, em 11 partes (viram index.html)
                   O build junta os arquivos de cada pasta em ordem alfabética do nome (00-, 10-, ...) por simples
                   concatenação: sem import/export. A ordem é a ordem de execução do app; não renumere sem necessidade.
src/sw.template.js service worker (o build injeta versão e precache)
src/admin.html, src/admin.src.js   painel de suporte (admin.html)
src/babinha/*.webp mascote (nomes = moods: happy, coach, siuu, tired, worried, wave, money, champion...)
src/supabase/*.sql migrações, uma por versão; src/supabase/test/*_rules.sql testes de regra
src/supabase/functions/{account,live-push}   Edge Functions
src/tests/         testes Playwright + API falsa;  src/tools/ setup das ferramentas de build
```

## Comandos

| O quê | Comando | Tempo |
|---|---|---|
| Build (gera a raiz) | `bash src/build.sh` | ~20 s (1ª vez +1 min: baixa ferramentas em /tmp/baba-tools) |
| Todos os testes de navegador | `python3 src/tests/check.py` | ~2,5 min |
| + regras do banco (Postgres local) | `python3 src/tests/check.py --sql` | +30 s |
| Só alguns | `python3 src/tests/check.py v113 sim2` | — |

O Bash tem limite de ~120 s por chamada: rode o check em segundo plano
(`python3 src/tests/check.py --sql > /tmp/check.out 2>&1 &`) e espere com
`until [ -f /tmp/baba-check/done ]; do sleep 3; done; cat /tmp/check.out`. Logs completos em `/tmp/baba-check/`.
O `--sql` precisa de `apt-get install -y postgresql-16` se o Postgres não existir.

## Fluxo de uma versão

1. Ler a spec (modelo no projeto Claude "BABA App": `claude/modelo-de-pedido.md`). Dúvida que muda o resultado → perguntar antes.
2. Código em `src/`. Se mexer no banco: novo `src/supabase/vNN_x_nome.sql` (idempotente: `if not exists`, `create or replace`,
   `drop policy if exists`) + testes em `src/supabase/test/vNN_x_rules.sql` + incluir os dois na cadeia de `src/tests/sql_check.sh`.
3. `APP_VERSION` e uma entrada nova no topo de `PATCH_NOTES` (português simples, para o usuário final) em `src/js/40-servidor-termos.js`.
4. API falsa para RPC nova: `m('nome')` em `tests/fake_api.js` + `f_nome` em `tests/fake_server.py` (decoradores `_reg/_evreg/_tmreg`).
5. Teste: smoke novo `src/tests/vNNN_smoke.py` (copie `v113_smoke.py`) e registre em `TESTS` de `check.py`.
6. `bash src/build.sh` → `python3 src/tests/check.py --sql` → olhar prints de tela das telas mudadas.
7. Commit `vX.Y.Z: resumo` e `git push origin HEAD`. Dizer ao usuário qual SQL rodar, em que ordem.

## Regras de produto (não negociáveis)

- Não remover recurso existente sem pedido explícito. Não hardcodar no frontend stats, regras ou economia: regra fica no servidor (RPC).
- Baba Points: não se compram, não se sacam, não se transferem. Na interface: "palpite"/"cotação", nunca "aposta"/"odd".
  Palpites só para adultos (`private.is_adult`).
- Offline-first: toda escrita passa pela outbox (`enqueue(op)` → `flushOutbox` → `runOp`). Tipos de op: `baba_upsert, baba_finish,
  baba_delete, turma_sync, turma_delete, turma_leave, player_rename, profile_update, live_settle, live_end`.
- Mudou a forma do `state`? Ajustar `migrate()` e `defaultState()`; o teste sim2 recarrega a página e exige estado idêntico.

> v11.5: a aba `loja` se chama **Resenha** na tela (o id continua `loja`). Ordem: `#shop-palpites` (sub-abas Palpites/Ranking, `propSub`),
> `#shop-missions`, `#shop-lojinha-title` + catálogo ("Lojinha do Babinha"), extrato. Saldo: `paintBalance()` (`#shop-balance` e `#resenha-balance`).
> Duelos/Destaque/Total, ranking e troféus no Perfil/card ficam em `src/js/52-resenha-palpites2.js` (`propFase2Html`, `propDuelHtml`, `propLeaderHtml`,
> `propTotalHtml`, `propMoveTotal`, `loadPropRank`/`propRankHtml`, `loadUserTrophies`, `renderProfileTrophies`, `cardTrophiesHtml`).
> v11.4: seção `PALPITES PRÉ-JOGO (v11.4)` fica em `src/js/50-visual-loja.js` (`loadPropCounts`, `propChipHtml`, `openPalpites`, `loadProp`/`renderPropSection` em `#shop-palpites`, `openBilhete`/`confirmBilhete` em `#modal-pbilhete`, `propStepLine` (escolher linha), `propSlide`/`propAll` (barra de valor), `propSuspend` do adm).

## Módulos do JavaScript (src/js, na ordem de execução)

Cada módulo guarda funções inteiras; a ordem dos arquivos é a mesma de antes da divisão (v11.3.4). Procure a função por nome
(`grep -rn "function nomeDaFuncao" src/js`) e abra só o módulo certo. Nenhum módulo passa de ~1.200 linhas; se passar, divida num número livre.

| Módulo | O que contém (banners `/* ==== */`) | Funções principais |
|---|---|---|
| `00-core` | BABA - STATE | `defaultMatch, defaultSettings, defaultState, migrate, loadState, saveState`, `STORAGE_KEY`, `STATE_VERSION` |
| `10-sync` | CONTA E NUVEM (parte 1): chamadas ao servidor, status, outbox, baba atual, pull, service worker | `api` (supabase-js; `window.__BABA_FAKE_API__` substitui), `enqueue/flushOutbox/runOp`, `syncTurmaNow`, `stateForCloud`, `enqueueFinish`, `pullCloud`, `adoptCloudBaba` |
| `11-auth-conta` | CONTA E NUVEM (parte 2): telas de login, convites, "Sou eu", dados antigos, biometria, perfil/conta na nuvem, formulários de conta | `doSignup, doLogin, enterApp, logout`, `handlePendingInvite, joinTurmaWithCode`, `claimPlayer`, `myStats`, `openProfile/closeProfile`, `openSettings/closeSettings` (página Configurações), `installApp` (PWA) |
| `20-prefs-perfil` | PREFERÊNCIAS, FOTO/ÍCONE, PERFIL | `DEFAULT_PREFS` (todas sincronizadas na conta), `setPref, renderPrefsUI, adoptServerPrefs`, `openAvatarPicker`, `renderProfileMine` (posição, pé, stats, card), `shareMyCard`, `PAGE_CLOSERS` + `pushPage/popPage` (botão voltar do Android) |
| `25-suporte-tutorial` | SUPORTE, TUTORIAL DO BABINHA | `openSupport`, FAQ, `TUTORIAL` (6 capítulos, alvos por seletor), `startTour` |
| `30-pessoas-pdf` | PESSOAS DA TURMA, PDF DO BABA | dono/adm/membro, `openPersonActions`, `openExportSheet`, `generateBabaPDF` (jsPDF) |
| `40-servidor-termos` | V7 · SERVIDOR, POP-UPS, TERMOS, MOLDURAS E NOMES | `API7` = RPCs do Supabase (termos, pontos, loja, ao vivo, palpites, chat, eventos, turmas v11.2), `PATCH_NOTES`, `APP_VERSION`, `maybePopups`, `openPatchNotes`, `applyFrame` (moldura no **wrapper** do avatar, nunca no botão), `framedAvatar`, `styledName` |
| `50-visual-loja` | VISUAL DO ATLETA, LOJINHA (aba Resenha), MISSÕES, PALPITES PRÉ-JOGO | `athleteCardHtml`, `openAthleteCard`, push do ao vivo, `openShop` → `switchTab('loja')` → `enterShop`, `renderShop`, `claimDaily` |
| `52-resenha-palpites2` | RESENHA (v11.5): Duelos, Destaque do dia, Total do baba, ranking de palpiteiros, troféus no Perfil e no card | `propFase2Html`, `propSubTab`, `loadPropRank`, `propRankHtml`, `loadUserTrophies`, `renderProfileTrophies`, `paintBalance` |
| `60-aovivo` | JOGO AO VIVO (organiza / assiste) | `playerRates`, `oddFrom` (0,9/p), `liveMarkets`, `openLive`, palpites ao vivo, duelos |
| `70-compromisso` | COMPROMISSO (v11) | eventos/lista: `openEventEdit/saveEventEdit`, `openEventSheet`, `answerEvent`, colar lista, convidados, presença |
| `80-turmas-chat` | TURMAS (v11.2), CHAT | `openTurmaHub` (ranking, troféus, prestígio), desafios, `openExplore`, campeonatos, `openForm`, `openTurmaChat`, `todaysEvent`, `renderHomeV7`, `renderHomeBabinha` (mascote contextual), `renderBattery` |
| `85-inicio-turmas-editor` | HELPERS, INÍCIO, DIA/HORA/CLIMA, TURMAS (editor) | `nameOf, byId, presentPlayers, lineSize, titleFor...`, `renderHome`, `openDatabaseModal` (turmas de hoje), `openTurmaEditor`, `syncPool` |
| `90-chegadas-times` | ARRIVALS (LISTA), TEAMS & QUEUE | `checkIn`, `buildTeams`, fila Rei da Quadra |
| `95-quadra-placar` | PLACAR, MODO QUADRA, GOL/DEFESA, FIM DE PARTIDA, PÊNALTIS | cronômetro, `playedSeconds`, `openGoalModal` → `confirmGoalRecord`, `openSaveModal` → `recordGoalkeeperSave`, `undoLastEvent` (eventos com `el` = segundos jogados), `finishMatchAndNextChallenger` (grava `matchHistory` com `events: gameEvents(A,B)`), `undoFinish`, `openShootout` |
| `96-stats-relatorio` | RESUMO & EXPORT, STATS | `renderDailyResumo` (lances por jogo), `exportBabaCSV`, `generateBabaPNGCard`, `STAT_KEYS`, `daySummary` (inclui `venue` e `games`), `VENUES`/`renderVenueUI`/`gameLines*`/`ensureGames`, `aggregatedPlayers(venue)`, `renderStatsView` |
| `99-nav-backup` | NAV & UTILS, BACKUP & IMPORT, histórico | `switchTab` (abas `inicio/turmas/loja`; `ficha/fila/placar/stats` são subabas de Turmas via `TURMA_PANES`), `startNewDay`, `openHistory/renderHistory`, `exportBackup`, `handleImportFile`, `askConfirm`, `showToast` |

Dividir mais um módulo: corte só em fronteira de função/bloco (de preferência num banner `/* ==== */`), escolha um número livre entre
os vizinhos (ex.: `65-...`) e confira com `cat src/js/*.js | node --check /dev/stdin`.

## Partes do HTML (src/html, na ordem em que aparecem no index.html)

| Parte | Conteúdo |
|---|---|
| `00-head` | `<head>`: meta, config do Tailwind, componentes Tailwind e todo o CSS próprio (`<style>`) |
| `10-auth` | `<body>` e `#auth-root` (login, cadastro, recuperação, demo) |
| `20-app` | `#app-root`: cabeçalho, abas, Início, Turmas (Lista, Times, Placar, Stats), Resenha (Palpites, Missões, Lojinha), barra de baixo |
| `30-quadra-toasts` | `#court-mode` (placar em tela cheia) e `#toast-container` |
| `40-paginas` | `page-profile`, `page-settings`, `page-support` |
| `50-modais-perfil` | `modal-picker` (foto), `modal-export` (PDF), `#tour` (tutorial) |
| `60-termos-live-chat` | `page-terms-gate`, `page-terms`, `page-live`, `page-chat` |
| `70-modais-aovivo-conta` | pênaltis, pop-up, assistir, QR, palpite, card de atleta, desafio 1v1, formulários de conta |
| `80-modais-turma-jogo` | turmas, editor de turma, gol, defesa, substituição, times na mão, jogador, backup |
| `90-modais-eventos` | compromisso/lista, Turmas v11.2 (explorar, hub, campeonato, formulário), babas anteriores |
| `99-confirm-scripts` | `modal-confirm` e o `<script>` do app, `</body>`, `</html>` |

O build troca `/*APP_JS*/` e o `<script>` vazio por `<script src="app.js?v=...">`; não mexa nessas linhas em `99-confirm-scripts`.

## Estrutura do HTML (regras)

- Abas: `#tab-content-inicio | turmas | loja`; nav `#tab-nav-inicio|turmas|loja` + `#header-profile` (avatar, 4º botão da barra).
  Subabas de Turmas: `#tab-content-ficha|fila|placar|stats` (classe `turma-pane`) e botões `#tab-nav-*` (classe `sub-tab-btn`).
- Páginas (`.page`, tela cheia): `page-profile`, `page-settings`, `page-support`, `page-terms`, `page-terms-gate`, `page-live`, `page-chat`.
- Modais e z-index: picker 62, explore 62, history 62, thub 63, event 63, champ/event-edit/paste/close-ev/rules 64, evmenu/evname 66,
  form 70, acard 83, palpite/duel 84, watch 85, popup 88, pens 89, confirm 90.
- Ícones: Font Awesome 6.5.1 Free **solid**. O build falha se um `fa-*` não existir.

## Banco (src/supabase)

Ordem de produção: v6 → v7 → v8 → v9 → v9_5 → v10 → v10_1 → v11_compromisso → v11_2_convidados → v11_3_turmas → v11_4_palpites_pre → v11_4_1_palpites_livres → v11_4_2_avisos → v11_5_palpites_fase2
(o arquivo `v11_3_turmas.sql` é a versão 11.2 do app; `v11_2_convidados.sql` é a 11.1; `v11_4_palpites_pre.sql` é a 11.4; `v11_4_1_palpites_livres.sql` é a 11.4.1; `v11_4_2_avisos.sql` é a 11.4.2; `v11_5_palpites_fase2.sql` é a 11.5).
- Tabelas com RLS; escrita sensível só por RPC `security definer set search_path = ''`; helpers em `private.*`
  (`is_member`, `is_adult`, `add_points`, `season_of`, `award_seasons`, `settle_stale`...).
- Pontos: `wallets` + `points_ledger` (motivo em `reason`). Palpites ao vivo: `live_games.markets` + `palpites`.
- Palpites pré-jogo (v11.4): `prop_markets` + `prop_bets` (sem acesso direto, só RPC: `prop_markets`, `prop_open_counts`, `place_prop_bet`,
  `adjust_prop_line`, `suspend_prop_market`, `prop_event_bets`). Linha/cotação (Poisson), trava, liquidação e anulação são `private.*`
  (`generate_prop_markets`, `props_refresh`, `settle_event`, `void_props`). `babas.event_id` liga o baba à lista (trigger só aceita adm da turma);
  a trava usa `babas.state->>'firstKickoffAt'`; os stats gravados em `baba_stats` disparam a liquidação/correção (trigger por comando).
- v11.4.1: quem palpita escolhe a linha (`private.prop_ladder`: 0,5 a 5,5 com cotação por lado; só lados com chance de 5% a 85%),
  `place_prop_bet(market, selection, stake, p_line)` grava `prop_bets.line`; valor de 10 até o saldo (sem tetos); cravada de gols em si mesmo
  = `self_exact`; o adm só suspende (`adjust_prop_line` ficou sem uso no app).
- v11.4.2 (avisos no celular, tudo no servidor): `pg_cron` roda `private.avisos_tick()` a cada minuto → se há aviso a mandar, `pg_net` chama a Edge Function
  `live-push` com o cabeçalho `x-avisos-secret` (segredo `AVISOS_SECRET`, o mesmo valor de `private.avisos_cfg.secret`; função publicada com Verify JWT desligado).
  A função chama `srv_avisos_pendentes()`, que escolhe quem recebe (`private.avisos_candidatos(agora)`: `lista`, `vespera`, `palpites`) e GRAVA em
  `private.aviso_envios` (único por tipo + evento + usuário) antes de devolver os endereços de `push_subs`: retentativa nunca duplica, e criar evento/liquidar
  palpites não chamam nada disso (falha de envio não trava nada). Interruptores = `profiles.prefs` (`avisoLista`, `avisoLembrete`, `avisoPalpites`; sem valor = ligado),
  em Configurações → Avisos no celular (`setAviso`, `ensureAvisoPush` em `50-visual-loja.js`). O toque abre `#lista=<id>` (Turmas → Lista) ou `#palpites=<id>`
  (Lojinha → Palpites; `openListaFromAviso`/`openPalpitesFromAviso` em `60-aovivo.js`). O tick também devolve palpites de lista cancelada/expirada sem esperar alguém abrir a Lojinha.
  O aviso de cancelamento (`event_cancel`) continua saindo do celular do adm via `eventPush`; o push antigo de "puxou a lista" saiu (o servidor manda a Lista aberta).
- v11.5 (palpites fase 2): `prop_markets.kind` ganha `duel` (player_id = A, `player2_id` = B, métrica `ga`), `leader` (sem atleta; métrica goals/assists/saves;
  opções = ids dos atletas em `selections`, quem confirma depois entra enquanto aberto) e `baba_total` (sem atleta; métrica matches/goals; linha do histórico
  ponderado da turma, `private.total_sel`/`total_pick_line`). λ por atleta em `private.prop_rates(ev)` (a mesma conta da v11.4). Geração em
  `generate_prop_markets` → `gen_duels`/`gen_leaders`/`gen_totals`; liquidação em `settle_event` → `settle_fase2` (empate de duelo/total devolve,
  destaque divide o pagamento entre empatados, `void_reason` `ausente`/`zero`). Duelo: `self_against`. O adm move a linha do Total de 0,5 em 0,5
  (`adjust_prop_line`, só sem palpites). Ranking: `prop_leaderboard(t, season)` (só membros; ≥10 palpites ganhos/perdidos; `private.prop_season_stats`).
  Troféus `pe_quente`/`mae_dina` em `private.award_seasons` (com `turma_trophies.user_id`); `user_trophies(u)` alimenta Perfil e card.
- Pendente do usuário: segredos `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` em Edge Functions → Secrets (nunca commitar a privada).

## Testes (src/tests)

`check.py` sobe `http.server` na porta 8765 servindo a raiz e roda: v11 (lista/compromisso), v112 (turmas), v113 (navegação,
configurações, local, lances, moldura), v114 (palpites pré-jogo), v1142 (avisos no celular), v115 (Resenha, palpites fase 2, ranking, troféus; liga
`fake.v115_enabled`), tutorial, sim2 (simulação + reload). Os smokes usam `fake_api.js` (no navegador) +
`fake_server.py` (Python, via `expose_function('fakeCall')`). Os demais arquivos de teste são de versões antigas e não estão mantidos.

## Armadilhas conhecidas

- `const` repetido no topo de qualquer módulo de `src/js` derruba o app inteiro (tela branca): o `node --check` do build pega.
- `askConfirm` bloqueia `page.evaluate`: use `evaluate("setTimeout(fn, 0)")` e depois clique em `#modal-confirm-ok`.
- `.page` é `position: fixed`, então `offsetParent` é null: teste visibilidade com `getComputedStyle(el).display`.
- Seletores `text=...` pegam parágrafos; prefira `button:has-text("...")` ou ids.
- Depois do cadastro aparecem tutorial e pop-ups (novidades da versão): os testes fecham com `#tour-next`, `Pular`, `#popup-ok`.
- Datas em teste: nunca "hoje + 2 h" (passa da meia-noite); limite a 23:59.
- Não use `pkill -f` em cadeia no Bash (mata o próprio shell). O build apaga tudo na raiz menos `.git`, `src`, `README.md` e `CLAUDE.md`.
- Ferramentas do build ficam fora do repo (`/tmp/baba-tools`); `src/build.sh` remonta se faltarem (precisa do registro npm).
