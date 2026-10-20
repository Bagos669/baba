    /* ===================================================================
       BABA COMPARTILHADO (v11.6)
       Depois do primeiro apito, o baba vira "em andamento" e o dono e os adms
       das turmas dele controlam pelo próprio celular. O servidor é a fonte da
       verdade: cada gravação sobe a versão (rev) do baba; os aparelhos olham a
       versão a cada poucos segundos e baixam o estado quando ela muda (vale a
       última gravação aceita). Também mostra no Início o baba que ficou aberto
       de um dia anterior, para fechar com um toque.
       =================================================================== */
    const SHARED_TICK_MS = 3000;
    const SHARED_LIST_MS = 15000;
    const SNOOZE_PREFIX = 'baba_pend_snooze_v116:';
    const SNOOZE_MS = 12 * 3600 * 1000;
    const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    let sharedBabas = [];        // babas_shared(): não finalizados que eu posso controlar
    let sharedTicking = false;
    let sharedListAt = 0;
    let finishingRemote = false;

    const myUid = () => (currentUser ? currentUser.id : null);
    const pendingUpsertFor = id => readOutbox().some(o => (o.type === 'baba_upsert' || o.type === 'baba_finish') && o.id === id);
    const isSharedRun = () => !!(state.babaId && (state.firstKickoffAt || (state.createdBy && state.createdBy !== myUid())));

    /* Resposta do servidor a uma gravação do baba (baba_save). */
    function handleSaveResult(id, res) {
      if (!res) return;
      if (res.finished) { if (state.babaId === id) onBabaFinishedRemote(id, res.finished_by, res.finished_by_name); return; }
      if (state.babaId === id && Number(res.rev) > (state.rev || 0)) { state.rev = Number(res.rev); cacheState(); }
    }

    /* Troca o baba deste aparelho pela cópia do servidor (de outro aparelho). */
    function adoptShared(row, byName) {
      if (!row || !row.state) return;
      const prevLive = state.live && state.live.id ? Object.assign({}, state.live) : null;
      const prevGames = state.babaId === row.id ? state.matchHistory.length : null;
      adoptCloudBaba({ id: row.id, state: row.state });
      state.rev = Number(row.rev) || 0;
      state.createdBy = row.created_by || state.createdBy;
      // Transmissão antiga sem dono gravado: é de quem criou o baba.
      if (state.live && state.live.id && !state.live.owner) state.live.owner = row.created_by || null;
      if (prevLive && liveMine(prevLive)) {
        if (!state.live || state.live.id !== prevLive.id) {
          // Outro organizador parou a transmissão: só este aparelho pode encerrá-la no servidor.
          enqueue({ type: 'live_end', id: prevLive.id });
        } else {
          // Partidas encerradas em outro aparelho: este (dono da transmissão) liquida os palpites ao vivo delas.
          const added = prevGames == null ? 0 : state.matchHistory.length - prevGames;
          for (let i = added - 1; i >= 0; i--) {
            const h = state.matchHistory[i];
            queueLiveSettle(state.matchHistory.length - i, null, null, h.scoreA || 0, h.scoreB || 0, h.events || []);
          }
          scheduleLivePush(true);
        }
      }
      cacheState();
      renderAllComponents();
      if (byName) showToast(`Atualizado por ${firstName(byName)}`, 'info');
    }

    /* O baba foi finalizado em outro aparelho (por um dono ou adm). */
    function onBabaFinishedRemote(id, by, name) {
      if (finishingRemote || state.babaId !== id) return;
      finishingRemote = true;
      try {
        writeOutbox(readOutbox().filter(o => !(o.type === 'baba_upsert' && o.id === id)));
        if (state.live && state.live.id && liveMine()) enqueue({ type: 'live_end', id: state.live.id });
        state.live = null;
        resetForNewDay();
        syncPool();
        cacheState();
        renderAllComponents();
        sharedBabas = sharedBabas.filter(b => b.id !== id);
        renderSharedCards();
        showToast(`Baba finalizado por ${by && by === myUid() ? 'você' : firstName(name || 'outra pessoa')}`, 'info');
        pullCloud(true);
      } finally { finishingRemote = false; }
    }

    /* A cada poucos segundos: o baba aberto mudou no servidor? */
    async function sharedTick() {
      if (sharedTicking || sharedOff || !cloudOn() || document.visibilityState !== 'visible' || navigator.onLine === false) return;
      if (!isSharedRun()) return;
      const id = state.babaId;
      if (pendingUpsertFor(id)) return;
      sharedTicking = true;
      try {
        const r = await api.babaRev(id);
        if (!r || r.gone || state.babaId !== id) return;
        if (r.finished) { onBabaFinishedRemote(id, r.finished_by, r.finished_by_name); return; }
        if (!(Number(r.rev) > (state.rev || 0))) return;
        const full = await api.babaGet(id);
        // Uma mudança feita aqui enquanto baixava ganha (vai depois e vira a última gravação).
        if (!full || state.babaId !== id || pendingUpsertFor(id)) return;
        if (full.finished) { onBabaFinishedRemote(id, null, full.finished_by_name); return; }
        adoptShared(full, full.updated_by && full.updated_by !== myUid() ? full.updated_by_name : null);
      } catch (e) {
        if (isMissingFn(e)) sharedOff = true;
      } finally { sharedTicking = false; }
    }

    /* Babas em andamento e pendentes que eu posso controlar (cards do Início e selo nas Turmas). */
    async function loadSharedBabas(force) {
      if (sharedOff || !cloudOn() || navigator.onLine === false) return;
      if (!force && Date.now() - sharedListAt < SHARED_LIST_MS - 500) return;
      sharedListAt = Date.now();
      try {
        const rows = await api.babasShared();
        sharedBabas = Array.isArray(rows) ? rows : [];
      } catch (e) {
        if (isMissingFn(e)) { sharedOff = true; sharedBabas = []; }
        return;
      }
      renderSharedCards();
      const modal = document.getElementById('modal-database');
      if (modal && !modal.classList.contains('hidden')) renderTurmaList();
    }

    const isToday = d => String(d || '').slice(0, 10) === localDate();
    /* "Baba em andamento": de hoje, já começou e não é o que está aberto neste aparelho. */
    const runningElsewhere = () => sharedBabas.filter(b => b.started && isToday(b.played_on) && b.id !== state.babaId);
    function pendingBabas() {
      if (new Date().getHours() < 6) return [];
      const today = localDate();
      return sharedBabas.filter(b => String(b.played_on || '').slice(0, 10) < today && !snoozed(b.id)).slice(0, 3);
    }
    function snoozed(id) { const t = Number(lsGet(SNOOZE_PREFIX + id) || 0); return t && Date.now() < t; }
    function dayLabel(d) {
      const [y, m, dd] = String(d).slice(0, 10).split('-').map(Number);
      const dt = new Date(y, m - 1, dd);
      return `${WEEKDAYS[dt.getDay()]} (${String(dd).padStart(2, '0')}/${String(m).padStart(2, '0')})`;
    }
    /* Selo "Em andamento" na turma (menu Turmas). */
    const sharedRunOfTurma = tid => runningElsewhere().find(b => (b.turma_ids || []).includes(tid)) || null;

    function renderSharedCards() {
      const box = document.getElementById('home-shared');
      if (!box) return;
      const run = runningElsewhere();
      const pend = pendingBabas();
      const cards = run.map(b => `
          <div class="card p-3.5 cursor-pointer active:scale-[0.99] transition" data-shared="${b.id}" onclick="openSharedBaba('${b.id}')">
            <div class="flex items-center gap-3">
              <span class="tile bg-pitch text-butter"><i class="fa-solid fa-futbol"></i></span>
              <div class="min-w-0 flex-1">
                <p class="text-[15px] text-ink leading-snug"><span class="inline-flex items-center gap-1.5 font-extrabold text-leaf"><span class="live-dot"></span>Baba em andamento:</span> <b>${escapeHtml(b.title || 'Baba')}</b>, iniciado por ${escapeHtml(b.started_by === myUid() ? 'você' : firstName(b.started_by_name || 'alguém'))}.</p>
              </div>
              <button class="btn-primary h-10 px-4 text-[13px] flex-shrink-0" onclick="event.stopPropagation(); openSharedBaba('${b.id}')">Abrir</button>
            </div>
          </div>`).concat(pend.map(b => `
          <div class="card p-3.5" data-pending="${b.id}">
            <div class="flex items-start gap-3">
              <span class="tile bg-butter text-pitch"><i class="fa-solid fa-flag-checkered"></i></span>
              <div class="min-w-0 flex-1">
                <p class="text-[15px] font-bold text-ink leading-snug">O baba de ${dayLabel(b.played_on)} ainda está aberto. Fechar agora?</p>
                <p class="text-[12px] text-ink-2 mt-0.5 truncate">${escapeHtml(b.title || 'Baba')} · ${b.matches || 0} partida${b.matches === 1 ? '' : 's'} · ${b.goals || 0} gol${b.goals === 1 ? '' : 's'}</p>
                <div class="flex gap-2 mt-2.5">
                  <button class="btn-primary h-9 px-4 text-[13px]" onclick="closePendingBaba('${b.id}')">Fechar baba</button>
                  <button class="btn-outline h-9 px-4 text-[13px]" onclick="snoozePending('${b.id}')">Agora não</button>
                </div>
              </div>
            </div>
          </div>`));
      box.innerHTML = cards.join('');
      box.classList.toggle('hidden', !cards.length);
    }

    function snoozePending(id) {
      lsSet(SNOOZE_PREFIX + id, String(Date.now() + SNOOZE_MS));
      renderSharedCards();
    }

    /* Tocar no card ou no selo: este aparelho passa a controlar aquele baba (Turmas → Placar). */
    async function openSharedBaba(id) {
      if (!cloudOn()) return;
      if (state.babaId === id) { closeDatabaseModal(); switchTab('placar'); return; }
      if (navigator.onLine === false) { showToast('Abrir o baba de outra pessoa precisa de internet.', 'warning'); return; }
      if (hasBabaContent()) {
        const ok = await askConfirm('Abrir esse baba neste aparelho? O baba que está aberto aqui continua salvo e aparece no Início para você fechar depois.', 'Abrir');
        if (!ok) return;
      }
      let full;
      try { full = await api.babaGet(id); }
      catch (e) { showToast(isNetworkError(e) ? 'Sem conexão. Tente de novo.' : 'Só o dono e os adms da turma controlam o baba.', 'warning'); return; }
      if (!full || full.finished) { showToast(full && full.finished_by_name ? `Baba finalizado por ${firstName(full.finished_by_name)}` : 'Esse baba já foi finalizado.', 'info'); loadSharedBabas(true); return; }
      pushNow();
      adoptShared(full, null);
      closeDatabaseModal();
      switchTab('placar');
      renderSharedCards();
      showToast(`Você está controlando o baba ${full.title ? 'de ' + full.title : ''}.`.replace(/\s+\./, '.'));
    }

    /* "Fechar baba" do card de baba pendente: mesmo caminho do "Começar novo baba". */
    async function closePendingBaba(id) {
      if (!cloudOn()) return;
      const info = sharedBabas.find(b => b.id === id) || {};
      if (navigator.onLine === false) { showToast('Fechar o baba precisa de internet.', 'warning'); return; }
      let full;
      try { full = await api.babaGet(id); }
      catch (e) { showToast(isNetworkError(e) ? 'Sem conexão. Tente de novo.' : 'Não consegui abrir esse baba.', 'warning'); return; }
      if (!full || full.finished) { sharedBabas = sharedBabas.filter(b => b.id !== id); renderSharedCards(); showToast('Esse baba já foi fechado.', 'info'); return; }
      const n = info.matches || 0, g = info.goals || 0;
      const msg = `Fechar o baba de ${dayLabel(full.played_on || info.played_on)}? ${n} partida${n === 1 ? '' : 's'} e ${g} gol${g === 1 ? '' : 's'} vão pro histórico da turma, com o relatório e os palpites liquidados.`
        + (info.live_match ? ' A partida em andamento será encerrada com o placar atual.' : '');
      if (!(await askConfirm(msg, 'Fechar baba'))) return;
      const isCurrent = state.babaId === id;
      let stash = null;
      if (!isCurrent) {
        pushNow();
        stash = JSON.parse(JSON.stringify(state));
        adoptCloudBaba({ id, state: full.state });
        state.rev = Number(full.rev) || 0;
        state.createdBy = full.created_by || null;
        if (state.live && state.live.id && !state.live.owner) state.live.owner = full.created_by || null;
      }
      closeOutBaba(true);
      if (stash) {
        const days = state.pastDays;
        state = stash;
        state.pastDays = days;
        if (state.match.isRunning && state.match.endAt) runTicker();
      } else {
        syncPool();
      }
      sharedBabas = sharedBabas.filter(b => b.id !== id);
      cacheState();
      renderAllComponents();
      renderSharedCards();
      showToast('Baba fechado. O relatório está no histórico da turma.');
    }

    setInterval(sharedTick, SHARED_TICK_MS);
    setInterval(() => { if (document.visibilityState === 'visible') loadSharedBabas(); }, SHARED_LIST_MS);
