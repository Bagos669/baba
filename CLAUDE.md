# BABA · mapa do projeto

PWA de gestão de pelada (baba): lista de presença, times e fila Rei da Quadra, placar/cronômetro, stats, turmas,
ao vivo com palpites, lojinha de Baba Points. Dono: Gabriel Marini. **Responda sempre em português.**

- Site: https://bagos669.github.io/baba/ (GitHub Pages da branch `main` do repo `Bagos669/baba`)
- Banco: Supabase, projeto `gwndkwnodlfgbcpesenr`. O usuário roda os SQL à mão no SQL Editor; **nunca aplique migração sozinho**.
- Linhas citadas abaixo mudam a cada versão: procure pelo **nome** da função (grep), não pelo número.

## Pastas

```
/            site PUBLICADO (gerado pelo build). Não edite app.js, index.html, sw.js, app.css aqui.
src/app.src.js     todo o JavaScript do app (~9.500 linhas, ~570 funções, vanilla, sem bundler)
src/shell.html     todo o HTML + CSS próprio + config do Tailwind (vira index.html)
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
3. `APP_VERSION` e uma entrada nova no topo de `PATCH_NOTES` (português simples, para o usuário final) em app.src.js.
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

## Mapa do app.src.js (seções, na ordem do arquivo)

| Seção (banner `/* ==== */`) | Funções principais |
|---|---|
| BABA - STATE | `defaultMatch, defaultSettings, defaultState, migrate`, `STORAGE_KEY`, `STATE_VERSION` |
| CONTA E NUVEM | `api` (supabase-js; `window.__BABA_FAKE_API__` substitui), outbox `enqueue/flushOutbox/runOp`, `syncTurmaNow`, `stateForCloud`, `enqueueFinish`, `pullCloud`, `adoptCloudBaba`, `myStats` |
| PREFERÊNCIAS | `DEFAULT_PREFS` (todas sincronizadas na conta), `setPref`, `renderPrefsUI`, `adoptServerPrefs` |
| PERFIL | `openProfile/closeProfile`, `openSettings/closeSettings` (página Configurações), `renderProfileBits`, `renderProfileMine` (posição, pé, stats, card), `shareMyCard`, PWA `installApp`, `PAGE_CLOSERS` + `pushPage/popPage` (botão voltar do Android) |
| SUPORTE / TUTORIAL | FAQ, `TUTORIAL` (6 capítulos, alvos por seletor), `startTour` |
| PESSOAS DA TURMA | dono/adm/membro, `openPersonActions` |
| PDF DO BABA | `openExportSheet`, `generateBabaPDF` (jsPDF) |
| V7 · SERVIDOR | `API7` = RPCs do Supabase (termos, pontos, loja, ao vivo, palpites, chat, eventos, turmas v11.2) |
| POP-UPS | `PATCH_NOTES`, `APP_VERSION`, `maybePopups`, `openPatchNotes` |
| TERMOS / MOLDURAS / VISUAL | `applyFrame` (moldura no **wrapper** do avatar, nunca no botão), `framedAvatar`, `styledName`, `athleteCardHtml`, `openAthleteCard` |
| LOJINHA / MISSÕES | `openShop` → `switchTab('loja')` → `enterShop`, `renderShop`, `claimDaily` |
| JOGO AO VIVO (organiza / assiste) | `playerRates`, `oddFrom` (0,9/p), `liveMarkets`, `openLive`, palpites ao vivo, duelos, push |
| COMPROMISSO (v11) | eventos/lista: `openEventEdit/saveEventEdit`, `openEventSheet`, `answerEvent`, colar lista, convidados, presença, `todaysEvent` |
| TURMAS (v11.2) | `openTurmaHub` (ranking, troféus, prestígio), desafios, `openExplore`, campeonatos, `openForm` |
| CHAT | `openTurmaChat` |
| HELPERS | `nameOf, byId, presentPlayers, lineSize, titleFor...` |
| INÍCIO / CLIMA | `renderHome`, `renderHomeV7`, `renderHomeBabinha` (mascote contextual), `renderBattery`, `renderHomeEvents` |
| TURMAS (editor) / LISTA | `openDatabaseModal` (turmas de hoje), `openTurmaEditor`, `syncPool`, `checkIn` |
| TEAMS & QUEUE | `buildTeams`, fila Rei da Quadra |
| PLACAR / MODO QUADRA / GOL-DEFESA | cronômetro, `playedSeconds`, `openGoalModal` → `confirmGoalRecord`, `openSaveModal` → `recordGoalkeeperSave`, `undoLastEvent` (eventos com `el` = segundos jogados) |
| FIM DE PARTIDA | `finishMatchAndNextChallenger` (grava `matchHistory` com `events: gameEvents(A,B)`), `undoFinish` |
| PÊNALTIS | `openShootout` |
| RESUMO & EXPORT | `renderDailyResumo` (lances por jogo), `exportBabaCSV`, `generateBabaPNGCard` |
| STATS | `STAT_KEYS`, `daySummary` (inclui `venue` e `games`), `VENUES`/`renderVenueUI`/`gameLines*`/`ensureGames`, `aggregatedPlayers(venue)`, `renderStatsView`, `openHistory/renderHistory` |
| NAV & UTILS | `switchTab` (abas `inicio/turmas/loja`; `ficha/fila/placar/stats` são subabas de Turmas via `TURMA_PANES`), `startNewDay` |
| BACKUP & IMPORT | `exportBackup`, `handleImportFile` |

## shell.html

- Abas: `#tab-content-inicio | turmas | loja`; nav `#tab-nav-inicio|turmas|loja` + `#header-profile` (avatar, 4º botão da barra).
  Subabas de Turmas: `#tab-content-ficha|fila|placar|stats` (classe `turma-pane`) e botões `#tab-nav-*` (classe `sub-tab-btn`).
- Páginas (`.page`, tela cheia): `page-profile`, `page-settings`, `page-support`, `page-terms`, `page-terms-gate`, `page-live`, `page-chat`.
- Modais e z-index: picker 62, explore 62, history 62, thub 63, event 63, champ/event-edit/paste/close-ev/rules 64, evmenu/evname 66,
  form 70, acard 83, palpite/duel 84, watch 85, popup 88, pens 89, confirm 90.
- Ícones: Font Awesome 6.5.1 Free **solid**. O build falha se um `fa-*` não existir.

## Banco (src/supabase)

Ordem de produção: v6 → v7 → v8 → v9 → v9_5 → v10 → v10_1 → v11_compromisso → v11_2_convidados → v11_3_turmas
(o arquivo `v11_3_turmas.sql` é a versão 11.2 do app; `v11_2_convidados.sql` é a 11.1).
- Tabelas com RLS; escrita sensível só por RPC `security definer set search_path = ''`; helpers em `private.*`
  (`is_member`, `is_adult`, `add_points`, `season_of`, `award_seasons`, `settle_stale`...).
- Pontos: `wallets` + `points_ledger` (motivo em `reason`). Palpites ao vivo: `live_games.markets` + `palpites`.
- Pendente do usuário: segredos `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` em Edge Functions → Secrets (nunca commitar a privada).

## Testes (src/tests)

`check.py` sobe `http.server` na porta 8765 servindo a raiz e roda: v11 (lista/compromisso), v112 (turmas), v113 (navegação,
configurações, local, lances, moldura), tutorial, sim2 (simulação + reload). Os smokes usam `fake_api.js` (no navegador) +
`fake_server.py` (Python, via `expose_function('fakeCall')`). Os demais arquivos de teste são de versões antigas e não estão mantidos.

## Armadilhas conhecidas

- `const` repetido no topo do app.src.js derruba o app inteiro (tela branca): o `node --check` do build pega.
- `askConfirm` bloqueia `page.evaluate`: use `evaluate("setTimeout(fn, 0)")` e depois clique em `#modal-confirm-ok`.
- `.page` é `position: fixed`, então `offsetParent` é null: teste visibilidade com `getComputedStyle(el).display`.
- Seletores `text=...` pegam parágrafos; prefira `button:has-text("...")` ou ids.
- Depois do cadastro aparecem tutorial e pop-ups (novidades da versão): os testes fecham com `#tour-next`, `Pular`, `#popup-ok`.
- Datas em teste: nunca "hoje + 2 h" (passa da meia-noite); limite a 23:59.
- Não use `pkill -f` em cadeia no Bash (mata o próprio shell). O build apaga tudo na raiz menos `.git`, `src`, `README.md` e `CLAUDE.md`.
- Ferramentas do build ficam fora do repo (`/tmp/baba-tools`); `src/build.sh` remonta se faltarem (precisa do registro npm).
