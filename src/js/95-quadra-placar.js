    /* ===================================================================
       PLACAR
       =================================================================== */
    function renderMatchView() {
      const { A, B } = state.court;

      ['a', 'b'].forEach(s => {
        const t = s === 'a' ? A : B;
        document.getElementById(`team-label-${s}`).innerText = t ? `Time ${t.label}` : 'Sem time';
        const badge = document.getElementById(`team-badge-${s}`);
        badge.classList.toggle('hidden', !(t && t.streak > 0));
        badge.innerText = t && t.streak > 0 ? `👑 ${t.streak}` : '';
        document.getElementById(`roster-title-${s}`).innerText = t ? `Time ${t.label}` : `Lado ${s.toUpperCase()}`;
        document.getElementById(`btn-goal-${s}`).disabled = !t;
        document.getElementById(`btn-save-${s}`).disabled = !t;
      });
      document.getElementById('team-eyebrow-a').innerText = A && A.streak > 0 ? 'Rei da quadra' : 'Lado A';
      document.getElementById('team-eyebrow-b').innerText = A && A.streak > 0 ? 'Desafiante' : 'Lado B';
      document.getElementById('btn-finish').disabled = !(A && B);
      document.getElementById('btn-court-mode').classList.toggle('hidden', !(A && B));

      const max = Number(state.settings.maxStreak) || 0;
      document.getElementById('finish-subtitle').innerText =
        max && A && A.streak === max - 1 ? `Se o Time ${A.label} vencer, completa ${max} e os dois saem` : 'Vencedor fica · próximo da fila entra';

      document.getElementById('match-score-a').innerText = state.match.scoreA;
      document.getElementById('match-score-b').innerText = state.match.scoreB;
      document.getElementById('match-game-format').value = String(lineSize());
      document.getElementById('match-gk-mode').value = keeperMode();
      renderFixedKeepers();
      document.getElementById('match-goal-limit-rule').value = state.match.goalLimitRule || '2';

      renderCourtCta();
      renderCourtMode();
      updateTimerDisplay();
      updateTimerButton();
      renderMatchRosterText('A');
      renderMatchRosterText('B');
      renderMatchEventsLog();
    }

    /* Fixed-goalkeeper formats: who is in goal today (they never rotate). */
    function renderFixedKeepers() {
      const box = document.getElementById('fixed-keepers');
      if (!box) return;
      if (!fixedKeepers()) { box.classList.add('hidden'); return; }
      box.classList.remove('hidden');
      if (keeperFromQueue()) {
        const [a, b] = queueKeepers().map(byId);
        const lab = side => state.court[side] ? `Time ${state.court[side].label}` : `lado ${side}`;
        box.innerHTML = a
          ? `<i class="fa-solid fa-hand text-pitch"></i><span class="min-w-0"><b>No gol, os próximos da fila:</b> ${escapeHtml(a.name)} (${lab('A')})${b ? ` · ${escapeHtml(b.name)} (${lab('B')})` : ' · falta um'}<span class="block text-ink-2 font-medium">Eles não perdem o lugar na fila. Troca a cada partida.</span></span>`
          : `<i class="fa-solid fa-triangle-exclamation text-warn"></i><span class="min-w-0"><b>Ninguém na fila pra ir pro gol.</b><span class="block text-ink-2 font-medium">Com a fila vazia, cada time se vira com o próprio goleiro.</span></span>`;
        return;
      }
      const ks = fixedKeeperList();
      box.innerHTML = ks.length
        ? `<i class="fa-solid fa-hand text-pitch"></i><span class="min-w-0"><b>Goleiro${ks.length > 1 ? 's' : ''} fixo${ks.length > 1 ? 's' : ''}:</b> ${ks.map(p => escapeHtml(p.name)).join(' · ')}<span class="block text-ink-2 font-medium">Não entram na fila: ficam no gol a noite toda.</span></span>`
        : `<i class="fa-solid fa-triangle-exclamation text-warn"></i><span class="min-w-0"><b>Nenhum goleiro fixo.</b><span class="block text-ink-2 font-medium">Marque GOL em quem vai ficar no gol, na Lista.</span></span>`;
    }

    function renderCourtCta() {
      const box = document.getElementById('court-cta');
      const btn = document.getElementById('court-cta-btn');
      const { A, B } = state.court;
      const show = (title, text, label, fn) => {
        box.classList.remove('hidden');
        document.getElementById('court-cta-title').innerText = title;
        document.getElementById('court-cta-text').innerText = text;
        btn.classList.toggle('hidden', !label);
        btn.innerText = label || '';
        btn.onclick = fn || null;
      };
      if (A && B) { box.classList.add('hidden'); return; }
      if (!state.players.length) return show('Comece escolhendo as turmas', 'Depois marque quem chegou.', 'Turmas', openDatabaseModal);
      if (!presentPlayers().length) return show('Ninguém chegou ainda', 'Marque a chegada na Lista: a ordem monta os times.', 'Abrir lista', () => switchTab('ficha'));
      if (!A && !B) return show(`${state.queue.length} na fila`, 'Monte os dois primeiros times pela ordem de chegada.', 'Montar times', buildTeams);
      if (state.queue.length) return show('Falta um time', `${state.queue.length} esperando na fila.`, 'Montar', buildTeams);
      return show('Falta gente pro outro time', 'Marque mais chegadas na Lista.', 'Abrir lista', () => switchTab('ficha'));
    }

    function popScore(side) {
      [`match-score-${side.toLowerCase()}`, `cm-score-${side.toLowerCase()}`].forEach(id => {
        const el = document.getElementById(id);
        el.classList.remove('score-pop');
        void el.offsetWidth;
        el.classList.add('score-pop');
      });
    }

    /* NvN or the keeper mode changed: keepers join/leave the line, teams before kick-off resize. */
    function applyFormatChange(prefix) {
      repair();
      let added = 0;
      if (matchNotStarted()) added = topUp('A').length + topUp('B').length;
      const over = ['A', 'B'].some(s => state.court[s] && state.court[s].ids.length > teamSize());
      let msg = `${prefix}: ${formatLabel()}`;
      if (added) msg += ` · ${added} entraram da fila`;
      else if (over) msg += ' · times em quadra estão maiores, ajuste na aba Times';
      else if (['A', 'B'].some(s => state.court[s] && state.court[s].ids.length < teamSize())) msg += ' · complete os times na aba Times';
      commit(msg);
    }
    function updateGameFormat(val) {
      if (!orgOnly()) { renderAllComponents(); return; }
      state.match.lineSize = Math.min(12, Math.max(1, Number(val) || 4));
      applyFormatChange('Jogo');
    }
    function updateKeeperMode(val) {
      if (!orgOnly()) { renderAllComponents(); return; }
      state.settings.keeperMode = KEEPER_MODES[val] ? val : 'time';
      applyFormatChange('Goleiro');
    }

    function updateGoalLimitRule(val) {
      if (!orgOnly()) { renderAllComponents(); return; }
      state.match.goalLimitRule = val;
      saveState();
    }

    /* ===================================================================
       MODO QUADRA
       Full-screen landscape scoreboard. Tries real fullscreen + orientation
       lock (Android Chrome); where the browser refuses (iPhone, embedded
       pages), the CSS rotates the page while the phone is held upright.
       =================================================================== */
    let courtMode = false;
    let courtFullscreen = false;

    async function enterCourtMode() {
      const { A, B } = state.court;
      if (!(A && B)) { showToast('Monte os dois times primeiro.', 'warning'); return; }
      courtMode = true;
      const root = document.documentElement;
      root.classList.add('fs-on', 'fs-rotate');
      document.getElementById('court-mode').classList.remove('hidden');
      renderCourtMode();
      requestWakeLock();

      courtFullscreen = false;
      try {
        if (root.requestFullscreen) { await root.requestFullscreen({ navigationUI: 'hide' }); courtFullscreen = true; }
        else if (root.webkitRequestFullscreen) { root.webkitRequestFullscreen(); courtFullscreen = true; }
      } catch (e) {}
      // fs-rotate stays on: the CSS only rotates while the viewport is still
      // portrait, so it switches itself off once the phone really turns.
      try {
        if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
      } catch (e) {}
      if (!courtMode) exitCourtMode(); // closed while the browser was answering
    }

    async function exitCourtMode() {
      courtMode = false;
      document.getElementById('court-mode').classList.add('hidden');
      document.documentElement.classList.remove('fs-on', 'fs-rotate');
      try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {}
      try {
        if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen();
      } catch (e) {}
      courtFullscreen = false;
      if (!state.match.isRunning) releaseWakeLock();
    }

    // Leaving fullscreen with the system back gesture or Esc also leaves the mode.
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(evt => document.addEventListener(evt, () => {
      const fs = document.fullscreenElement || document.webkitFullscreenElement;
      if (!fs && courtMode && courtFullscreen) exitCourtMode();
    }));

    function renderCourtMode() {
      if (!courtMode) return;
      const { A, B } = state.court;
      const king = A && A.streak > 0;
      [['a', A, king ? 'Rei da quadra' : 'Lado A'], ['b', B, king ? 'Desafiante' : 'Lado B']].forEach(([s, t, role]) => {
        document.getElementById(`cm-role-${s}`).innerText = role;
        document.getElementById(`cm-label-${s}`).innerText = t ? `Time ${t.label}${t.streak > 0 ? ` · 👑 ${t.streak}` : ''}` : 'Sem time';
        document.getElementById(`cm-score-${s}`).innerText = s === 'a' ? state.match.scoreA : state.match.scoreB;
        document.getElementById(`cm-goal-${s}`).disabled = !t;
        document.getElementById(`cm-save-${s}`).disabled = !t;
      });
      document.getElementById('cm-rule').value = state.match.goalLimitRule || '2';
      document.getElementById('cm-finish').disabled = !(A && B);
      document.getElementById('cm-undo').classList.toggle('opacity-40', !state.match.events.length);
    }

    const fmtMMSS = secs => `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;

    /* Seconds actually played in the current match (duration + extra - left). */
    function playedSeconds() {
      const m = state.match;
      return Math.max(0, (m.initialSeconds || 0) + (m.addedSeconds || 0) - (m.secondsLeft || 0));
    }

    /* Changes the match length. A clock that already ran keeps what was played. */
    function setMatchDuration(seconds) {
      if (!notViewer()) return;
      const m = state.match;
      const played = playedSeconds();
      if (seconds + (m.addedSeconds || 0) < played) {
        updateTimerDisplay(); // puts the select back
        showToast(`Já foram jogados ${fmtMMSS(played)}. Escolha um tempo maior ou finalize a partida.`, 'warning');
        return;
      }
      const wasRunning = m.isRunning;
      pauseMatchTimer();
      m.initialSeconds = seconds;
      m.secondsLeft = Math.max(0, seconds + (m.addedSeconds || 0) - played);
      if (wasRunning && m.secondsLeft > 0) startMatchTimer();
      updateTimerDisplay();
      saveState();
      showToast(`Tempo total: ${seconds / 60} min`);
    }

    function addExtraTime(minutes) {
      if (!notViewer()) return;
      if (!canScore() && !isOrgHere()) return;
      const secs = minutes * 60;
      const m = state.match;
      submitLance({
        kind: 'extra',
        seconds: secs,
        time: fmtMMSS(Math.max(0, m.secondsLeft)),
        text: `⏱️ Acréscimo de ${minutes} min (total +${Math.round(((m.addedSeconds || 0) + secs) / 60)} min)`
      });
    }

    function toggleMatchTimer() {
      if (!notViewer()) return;
      unlockAudio();
      if (state.match.isRunning) pauseMatchTimer();
      else startMatchTimer();
    }

    function startMatchTimer() {
      if (state.match.isRunning) return;
      if (state.match.secondsLeft <= 0) state.match.secondsLeft = state.match.initialSeconds || 420;
      state.match.isRunning = true;
      state.match.endAt = Date.now() + state.match.secondsLeft * 1000;
      if (!state.firstKickoffAt) state.firstKickoffAt = Date.now();
      const fresh = !state.match.events.length && state.match.secondsLeft >= (state.match.initialSeconds || 420) + (state.match.addedSeconds || 0);
      saveState();
      prefetchCourtPeople();
      // The first kick-off of the day opens the live game and shows its QR code.
      if (!state.live && !state.liveAsked && v7 === true && cloudOn() && isOrgHere() && state.court.A && state.court.B) {
        state.liveAsked = true;
        cacheState();
        ensureLive(true);
      }
      if (fresh && state.court.A && state.court.B) {
        const n = state.matchHistory.length + 1;
        livePush('start', `start-${n}`, `▶️ Começou a partida ${n}: Time ${state.court.A.label} x Time ${state.court.B.label}`,
          `${state.court.A.ids.map(nameOf).map(firstName).join(', ')} x ${state.court.B.ids.map(nameOf).map(firstName).join(', ')}`.slice(0, 160));
      }
      runTicker();
      requestWakeLock();
      updateTimerButton();
    }

    function runTicker() {
      if (timerInterval) clearInterval(timerInterval);
      timerInterval = setInterval(tick, 250);
      tick();
    }

    function tick() {
      if (!state.match.isRunning || !state.match.endAt) return;
      const left = Math.max(0, Math.ceil((state.match.endAt - Date.now()) / 1000));
      if (left !== state.match.secondsLeft) {
        state.match.secondsLeft = left;
        updateTimerDisplay();
      }
      if (left <= 0) {
        pauseMatchTimer();
        playRefereeWhistle();
        buzz([300, 120, 300, 120, 500]);
        showToast('⏰ Tempo esgotado! Dê acréscimo ou finalize a partida.', 'warning');
      }
    }

    function pauseMatchTimer() {
      if (state.match.isRunning && state.match.endAt) {
        state.match.secondsLeft = Math.max(0, Math.ceil((state.match.endAt - Date.now()) / 1000));
      }
      state.match.isRunning = false;
      state.match.endAt = null;
      if (timerInterval) clearInterval(timerInterval);
      timerInterval = null;
      if (!courtMode) releaseWakeLock();
      updateTimerButton();
      updateTimerDisplay();
      saveState();
    }

    function resetMatchTimer() {
      if (!notViewer()) return;
      pauseMatchTimer();
      state.match.addedSeconds = 0;
      state.match.secondsLeft = state.match.initialSeconds || 420;
      updateTimerDisplay();
      saveState();
    }

    function updateTimerButton() {
      const cls = state.match.isRunning ? 'fa-solid fa-pause' : 'fa-solid fa-play';
      document.getElementById('icon-timer-toggle').className = cls;
      document.getElementById('home-play-icon').className = cls;
      document.getElementById('cm-play-icon').className = cls;
      updateHomeLive();
    }

    function updateTimerDisplay() {
      const m = state.match;
      const secs = Math.max(0, m.secondsLeft);
      const el = document.getElementById('timer-display');
      const box = document.getElementById('timer-box');
      el.innerHTML = digitsHtml(fmtMMSS(secs));
      document.getElementById('home-timer').innerHTML = digitsHtml(fmtMMSS(secs));
      const cm = document.getElementById('cm-timer');
      cm.innerHTML = digitsHtml(fmtMMSS(secs));
      [el, box, cm].forEach(x => {
        x.classList.toggle('timer-out', secs === 0);
        x.classList.toggle('timer-low', secs > 0 && secs <= 30);
      });
      const added = m.addedSeconds || 0;
      const badge = document.getElementById('timer-added-badge');
      badge.classList.toggle('hidden', !added);
      badge.innerText = added ? `+${Math.round(added / 60)}'` : '';
      const cmAdded = document.getElementById('cm-added');
      cmAdded.classList.toggle('hidden', !added);
      cmAdded.innerText = badge.innerText;
      document.getElementById('match-duration').value = String(m.initialSeconds);
      document.getElementById('cm-duration').value = String(m.initialSeconds);
      document.getElementById('timer-meta').innerText =
        `Tempo total ${Math.round(m.initialSeconds / 60)} min${added ? ` + ${Math.round(added / 60)} de acréscimo` : ''} · jogado ${fmtMMSS(playedSeconds())}`;
      updateHomeLive();
    }

    function checkGoalLimitEndCondition() {
      const rule = state.match.goalLimitRule;
      const a = state.match.scoreA;
      const b = state.match.scoreB;
      if (rule === 'none') return false;
      if (rule === 'diff2') return Math.abs(a - b) >= 2;
      const limit = parseInt(rule, 10);
      return a >= limit || b >= limit;
    }

    /* ===================================================================
       GOL / DEFESA
       =================================================================== */
    function sidePlayers(side) {
      const t = state.court[side];
      const roster = t ? t.ids.map(byId).filter(Boolean) : [];
      const ids = new Set(roster.map(p => p.id));
      const others = presentPlayers().filter(p => !ids.has(p.id));
      return { label: t ? t.label : '?', roster, others };
    }

    function renderPickList(container, groups, makeButton) {
      container.innerHTML = '';
      groups.forEach(g => {
        if (!g.players.length) return;
        if (g.label) {
          const tag = document.createElement('p');
          tag.className = 'section-tag';
          tag.innerText = g.label;
          container.appendChild(tag);
        }
        g.players.forEach(p => container.appendChild(makeButton(p)));
      });
      if (!container.children.length) {
        container.innerHTML = '<p class="text-[14px] text-danger">Nenhum atleta presente.</p>';
      }
    }

    function openGoalModal(side) {
      if (!canScore()) { showToast(`Anotador: ${firstName((roleHere() || {}).scorerName || 'outra pessoa')}. Só quem está anotando registra lances.`, 'warning'); return; }
      if (!state.court[side]) { showToast('Monte os times primeiro.', 'warning'); return; }
      selectedGoalSide = side;
      selectedGoalScorer = null;
      selectedGoalAssist = null;

      const { label, roster, others } = sidePlayers(side);
      document.getElementById('modal-goal-title').innerText = `Gol do Time ${label}`;

      renderPickList(document.getElementById('modal-goal-scorers-list'), [
        { label: `Time ${label}`, players: roster },
        { label: 'Outros presentes', players: others }
      ], p => {
        const btn = document.createElement('button');
        btn.className = 'pick-btn';
        btn.innerHTML = `<span class="min-w-0"><span class="block truncate">${p.isGoalkeeper ? '🧤 ' : ''}${escapeHtml(p.name)}</span><span class="block text-[11px] font-semibold text-ink-2">${p.goals || 0} gol${p.goals === 1 ? '' : 's'} hoje</span></span><i class="fa-solid fa-futbol text-pitch/60 flex-shrink-0"></i>`;
        btn.onclick = () => selectScorer(p.id);
        return btn;
      });

      goalStep('scorer');
      document.getElementById('modal-goal').classList.remove('hidden');
    }

    /* Two steps: who scored, then who passed (or "sem assistência").
       The goal is only recorded at the end of step 2. */
    function goalStep(step) {
      const assist = step === 'assist';
      document.getElementById('goal-pane-scorer').classList.toggle('hidden', assist);
      document.getElementById('goal-pane-assist').classList.toggle('hidden', !assist);
      const on = 'bg-pitch text-butter', off = 'bg-sunk text-ink-2';
      document.getElementById('goal-step-1').className = `py-2 rounded-xl text-center ${assist ? off : on}`;
      document.getElementById('goal-step-2').className = `py-2 rounded-xl text-center ${assist ? on : off}`;
      if (!assist) selectedGoalScorer = null;
    }

    function selectScorer(pId) {
      selectedGoalScorer = pId;
      const scorer = byId(pId);
      document.getElementById('goal-scorer-name').innerText = scorer ? scorer.name : '';

      // Teammates first: the passer is almost always on the scoring team.
      const team = state.court[selectedGoalSide];
      const mates = (team ? team.ids : []).filter(id => id !== pId).map(byId).filter(Boolean);
      const mateIds = new Set(mates.map(p => p.id));
      const others = presentPlayers().filter(p => p.id !== pId && !mateIds.has(p.id));
      renderPickList(document.getElementById('modal-goal-assists-list'), [
        { label: team ? `Time ${team.label}` : '', players: mates },
        { label: 'Outros presentes', players: others }
      ], p => {
        const btn = document.createElement('button');
        btn.className = 'pick-btn';
        btn.innerHTML = `<span class="min-w-0"><span class="block truncate">${escapeHtml(p.name)}</span><span class="block text-[11px] font-semibold text-ink-2">${p.assists || 0} assist. hoje</span></span><span class="text-[11px] font-extrabold text-pitch/70 flex-shrink-0">Passe</span>`;
        btn.onclick = () => confirmGoalRecord(p.id);
        return btn;
      });
      goalStep('assist');
      document.getElementById('goal-pane-assist').scrollTop = 0;
    }

    function closeGoalModal() {
      document.getElementById('modal-goal').classList.add('hidden');
    }

    function confirmGoalRecord(assistId) {
      if (!selectedGoalScorer) { showToast('Selecione quem fez o gol!', 'warning'); return; }
      selectedGoalAssist = assistId && assistId !== selectedGoalScorer ? assistId : null;
      const team = state.court[selectedGoalSide];
      if (!team) { closeGoalModal(); return; }
      closeGoalModal();
      const scorer = byId(selectedGoalScorer);
      const assist = selectedGoalAssist ? byId(selectedGoalAssist) : null;
      // v11.6.1: o lance vai para o servidor e só conta quando ele confirma (submitLance → afterLance).
      submitLance({
        kind: 'goal',
        side: selectedGoalSide,
        el: playedSeconds(),
        scorerId: scorer ? scorer.id : null,
        assistId: assist ? assist.id : null,
        time: fmtMMSS(Math.max(0, state.match.secondsLeft)),
        text: `⚽ Gol do Time ${team.label}: ${scorer ? scorer.name : '?'}${assist ? ` (passe de ${assist.name})` : ''}`
      });
    }

    /* Depois que o lance conta (confirmado pelo servidor, ou na hora quando não há servidor novo). */
    function afterLance(l) {
      if (l.kind === 'goal') return goalEffects(l);
      if (l.kind === 'save') {
        const keeper = byId(l.keeperId);
        const team = state.court[l.side];
        buzz(40);
        renderAllComponents();
        showToast(`🧤 Defesa de ${keeper ? keeper.name : '?'}!`);
        livePush('save', `save-${state.matchHistory.length + 1}-${state.match.events.length}`, `🧤 Defesa de ${keeper ? keeper.name : '?'}`, `Time ${team ? team.label : '?'} · aos ${playedClock()} · ${scoreLine()}`);
        return;
      }
      renderAllComponents();
      if (l.kind === 'extra') showToast(`+${Math.round(l.seconds / 60)} min de acréscimo`);
      else showToast('Último lance desfeito.');
    }

    function goalEffects(l) {
      const scorer = byId(l.scorerId);
      const assist = l.assistId != null ? byId(l.assistId) : null;
      const team = state.court[l.side] || { label: '?' };
      const side = l.side;
      // Announcement card and goal sound of the scorer's account, if they have them.
      const scorerUid = userIdOfPlayer(scorer);
      const announce = c => {
        const shown = showGoalCard(scorer ? scorer.name : '?', c, `Time ${team.label} · ${state.match.scoreA} × ${state.match.scoreB}`);
        if (!(c && playGoalSound(c.goalSound))) playRefereeWhistle();
        return shown;
      };
      const known = cosOfPlayer(scorer);
      if (known || !scorerUid || !cloudOn() || v7 !== true) announce(known);
      else ensurePeople([scorerUid]).then(() => announce(cosOfPlayer(scorer))).catch(() => playRefereeWhistle());
      buzz(80);
      renderAllComponents();
      popScore(side);
      livePush('goal', `goal-${state.matchHistory.length + 1}-${state.match.scoreA}-${state.match.scoreB}`,
        `⚽ GOL do Time ${team.label}! ${scoreLine()}`,
        `${scorer ? scorer.name : '?'} aos ${playedClock()}${assist ? ` · passe de ${assist.name}` : ''}`);

      if (checkGoalLimitEndCondition()) {
        showToast('🏁 Meta de gols atingida!', 'warning');
        setTimeout(() => finishMatchAndNextChallenger(true), 700);
      } else {
        showToast(`⚽ Gol de ${scorer ? scorer.name : '?'}${assist ? ` · passe de ${assist.name}` : ' · sem assistência'}`);
      }
    }

    function openSaveModal(side) {
      if (!canScore()) { showToast(`Anotador: ${firstName((roleHere() || {}).scorerName || 'outra pessoa')}. Só quem está anotando registra lances.`, 'warning'); return; }
      if (!state.court[side]) { showToast('Monte os times primeiro.', 'warning'); return; }
      selectedSaveSide = side;
      const { label, roster, others } = sidePlayers(side);
      document.getElementById('modal-save-title').innerText = `Defesa do Time ${label}`;
      const byKeeper = arr => [...arr].sort((a, b) => (b.isGoalkeeper ? 1 : 0) - (a.isGoalkeeper ? 1 : 0));

      // Line-only formats: whoever is in goal for this side comes first.
      const goalie = keeperFromQueue() ? [byId(queueKeepers()[side === 'A' ? 0 : 1])].filter(Boolean)
        : fixedKeepers() ? fixedKeeperList().filter((k, i) => i === (side === 'A' ? 0 : 1) || fixedKeeperList().length === 1) : [];
      const gIds = new Set(goalie.map(p => p.id));
      renderPickList(document.getElementById('modal-save-goalkeepers-list'), [
        ...(goalie.length ? [{ label: 'No gol', players: goalie }] : []),
        { label: `Time ${label}`, players: byKeeper(roster.filter(p => !gIds.has(p.id))) },
        { label: 'Outros presentes', players: byKeeper(others.filter(p => !gIds.has(p.id))) }
      ], p => {
        const btn = document.createElement('button');
        btn.className = 'pick-btn';
        btn.innerHTML = `<span class="truncate">${p.isGoalkeeper ? '🧤 ' : ''}${escapeHtml(p.name)}</span><span class="text-pitch text-[12px] font-bold flex-shrink-0">+1 defesa</span>`;
        btn.onclick = () => recordGoalkeeperSave(p.id);
        return btn;
      });

      document.getElementById('modal-save').classList.remove('hidden');
    }

    function closeSaveModal() {
      document.getElementById('modal-save').classList.add('hidden');
    }

    function recordGoalkeeperSave(pId) {
      closeSaveModal();
      const keeper = byId(pId);
      const team = state.court[selectedSaveSide];
      if (!keeper || !team) return;
      submitLance({
        kind: 'save',
        side: selectedSaveSide,
        el: playedSeconds(),
        keeperId: keeper.id,
        time: fmtMMSS(Math.max(0, state.match.secondsLeft)),
        text: `🧤 Defesa do Time ${team.label}: ${keeper.name}`
      });
    }

    function undoLastEvent() {
      if (!canScore()) { showToast(`Só quem está anotando desfaz lances (${firstName((roleHere() || {}).scorerName || 'anotador')}).`, 'warning'); return; }
      // Lance que ainda não foi enviado: desfazer é descartar ele.
      const last = lanceQ.length ? lanceQ[lanceQ.length - 1] : null;
      if (last && last.status === 'failed') { dropLance(last.lance.lid); showToast('Lance não enviado descartado.'); return; }
      if (lanceQ.some(x => x.status === 'wait' || x.status === 'sending')) { showToast('Espere o envio dos lances para desfazer.', 'warning'); return; }
      const ev = state.match.events[0];
      if (!ev) { showToast('Nenhum lance para desfazer.', 'warning'); return; }
      submitLance({ kind: 'undo', target: ev.lid || null });
    }

    /* ===================================================================
       FIM DE PARTIDA & ROTAÇÃO
       =================================================================== */
    function snapshotForUndo() {
      const copy = Object.assign({}, state);
      delete copy.lastFinish;
      return JSON.parse(JSON.stringify(copy));
    }

    let finishing = false;

    async function finishMatchAndNextChallenger(auto, pens) {
      if (finishing) return;
      if (!notViewer()) return;
      if (lancesPending()) { showToast('Espere os lances serem enviados antes de encerrar a partida.', 'warning'); return; }
      const { A, B } = state.court;
      if (!A || !B) { showToast('Monte os dois times antes de finalizar.', 'warning'); return; }
      // A draw with "pênaltis" in the rules: the shootout decides, then this runs again with its result.
      if (!pens && state.match.scoreA === state.match.scoreB && state.settings.drawRule === 'penaltis' && !(state.match.events.length === 0 && playedSeconds() === 0 && !auto)) {
        pauseMatchTimer();
        openShootout();
        return;
      }

      const nothingHappened = state.match.events.length === 0 && playedSeconds() === 0;
      if (!auto && nothingHappened && !(await askConfirm('Finalizar a partida sem nenhum lance registrado?', 'Finalizar'))) return;
      // The court may have changed while the dialog was open.
      if (state.court.A !== A || state.court.B !== B) return;

      finishing = true;
      try {
        pauseMatchTimer();
        const snapshot = snapshotForUndo();
        const { scoreA, scoreB } = state.match;

        const pen = pens && scoreA === scoreB ? pens : null;
        state.matchHistory.unshift(Object.assign({
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          labelA: A.label, labelB: B.label, scoreA, scoreB,
          namesA: A.ids.map(nameOf), namesB: B.ids.map(nameOf),
          played: playedSeconds(), added: state.match.addedSeconds || 0,
          events: gameEvents(A, B)
        }, pen ? { pens: { a: pen.a, b: pen.b } } : {}));
        if (pen) {
          // Each kick counts: gol for the kicker, miss for the kicker, a save for the keeper.
          pen.kicks.forEach(k => {
            const kicker = byId(k.playerId);
            if (kicker) { if (k.result === 'gol') kicker.penGoals = (kicker.penGoals || 0) + 1; else kicker.penMisses = (kicker.penMisses || 0) + 1; }
            const gk = k.result === 'defesa' && byId(k.keeperId);
            if (gk) gk.penSaves = (gk.penSaves || 0) + 1;
          });
        }
        queueLiveSettle(state.matchHistory.length, A, B, scoreA, scoreB, state.match.events);
        updateStandingsRecord(A, scoreA, scoreB, pen ? pen.a > pen.b : null);
        updateStandingsRecord(B, scoreB, scoreA, pen ? pen.b > pen.a : null);
        [...A.ids, ...B.ids].forEach(id => { const p = byId(id); if (p) p.matches = (p.matches || 0) + 1; });
        [...fixedKeeperList(), ...queueKeepers().map(byId).filter(Boolean)].forEach(p => { p.matches = (p.matches || 0) + 1; });

        const leaving = [];
        let stay = null;
        let msg;
        if (scoreA !== scoreB || pen) {
          const winner = pen ? (pen.a > pen.b ? A : B) : scoreA > scoreB ? A : B;
          const loser = winner === A ? B : A;
          const hi = pen ? `${scoreA}x${scoreB}, pên. ${Math.max(pen.a, pen.b)}` : Math.max(scoreA, scoreB);
          const lo = pen ? Math.min(pen.a, pen.b) : Math.min(scoreA, scoreB);
          winner.ids.forEach(id => { const p = byId(id); if (p) p.wins = (p.wins || 0) + 1; });
          winner.streak = (winner.streak || 0) + 1;
          leaving.push(loser);
          const max = Number(state.settings.maxStreak) || 0;
          if (max && winner.streak >= max) {
            leaving.push(winner);
            msg = `Time ${winner.label} venceu (${hi}x${lo}) e completou ${winner.streak} seguidas: os dois saem!`;
          } else {
            stay = winner;
            msg = `Time ${winner.label} venceu (${hi}x${lo}) e fica!`;
          }
        } else if (state.settings.drawRule === 'both') {
          leaving.push(B, A);
          msg = `Empate (${scoreA}x${scoreB})! Saem os dois times.`;
        } else {
          leaving.push(A);
          stay = B;
          B.streak = 0;
          msg = `Empate (${scoreA}x${scoreB})! Time ${A.label} sai, Time ${B.label} fica.`;
        }

        livePush('end', `end-${state.matchHistory.length}`,
          `🏁 Fim: Time ${A.label} ${scoreA} × ${scoreB} Time ${B.label}${pen ? ` (pên. ${pen.a} × ${pen.b})` : ''}`, msg);

        // Whoever leaves goes to the end of the line, in the order they played.
        leaving.forEach(t => state.queue.push(...t.ids));
        state.court = { A: stay, B: null };
        setupCourt(leaving);
        // A team that stayed short (someone left, or the format grew) gets topped up
        // after the challenger is formed, so the line keeps its priority.
        topUp('A');

        state.match.scoreA = 0;
        state.match.scoreB = 0;
        state.match.events = [];
        state.match.addedSeconds = 0;
        state.match.secondsLeft = state.match.initialSeconds || 420;
        state.lastFinish = snapshot;

        saveState();
        renderAllComponents();
        showToast(msg, 'success', { label: 'Desfazer', fn: undoFinish });
      } finally {
        finishing = false;
      }
    }

    /* ===================================================================
       DISPUTA DE PÊNALTIS
       5 cobranças por time, alternando (Time A começa); depois, alternadas até
       alguém errar. Acaba sozinha quando um time não alcança mais o outro.
       =================================================================== */
    let shootout = null;
    function goalieOf(side) {
      const i = side === 'A' ? 0 : 1;
      if (keeperFromQueue()) return byId(queueKeepers()[i]) || null;
      if (keeperMode() === 'fixo') { const l = fixedKeeperList(); return l[i] || (l.length === 1 ? l[0] : null); }
      if (keeperMode() === 'time') { const t = state.court[side]; return t ? t.ids.map(byId).find(p => p && p.isGoalkeeper) || null : null; }
      return null;
    }
    function openShootout() {
      const { A, B } = state.court;
      if (!A || !B) return;
      shootout = { kicks: [], ptr: { A: 0, B: 0 }, pick: null };
      renderShootout();
      document.getElementById('modal-pens').classList.remove('hidden');
    }
    function closeShootout() { document.getElementById('modal-pens').classList.add('hidden'); shootout = null; }
    const pensCount = (side, onlyGoals) => shootout.kicks.filter(k => k.side === side && (!onlyGoals || k.result === 'gol')).length;
    function pensWinner() {
      const a = pensCount('A'), b = pensCount('B'), ga = pensCount('A', true), gb = pensCount('B', true);
      if (a <= 5 && b <= 5) {
        if (ga > gb + (5 - b)) return 'A';
        if (gb > ga + (5 - a)) return 'B';
        if (a === 5 && b === 5 && ga !== gb) return ga > gb ? 'A' : 'B';
        return null;
      }
      return a === b && ga !== gb ? (ga > gb ? 'A' : 'B') : null;
    }
    const pensSide = () => pensCount('A') > pensCount('B') ? 'B' : 'A';
    function pensKicker(side) {
      const t = state.court[side];
      if (!t || !t.ids.length) return null;
      if (shootout.pick && t.ids.includes(shootout.pick)) return shootout.pick;
      return t.ids[shootout.ptr[side] % t.ids.length];
    }
    function renderShootout() {
      if (!shootout) return;
      const { A, B } = state.court;
      const win = pensWinner();
      const dots = side => {
        const ks = shootout.kicks.filter(k => k.side === side);
        const n = Math.max(5, ks.length + (win ? 0 : 1));
        return Array.from({ length: n }, (_, i) => {
          const k = ks[i];
          return `<span class="pen-dot ${k ? (k.result === 'gol' ? 'is-goal' : 'is-miss') : ''}" title="${k ? escapeHtml(nameOf(k.playerId)) : ''}">${k ? (k.result === 'gol' ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-xmark"></i>') : ''}</span>`;
        }).join('');
      };
      const row = (side, t) => `
        <div class="flex items-center gap-3 py-2">
          <span class="w-20 text-[14px] font-bold truncate">Time ${escapeHtml(t.label)}</span>
          <span class="flex-1 flex flex-wrap gap-1.5">${dots(side)}</span>
          <span class="font-serif text-[30px] leading-none text-pitch w-8 text-right">${pensCount(side, true)}</span>
        </div>`;
      document.getElementById('pens-board').innerHTML = row('A', A) + `<div class="border-t border-ink/[0.07]"></div>` + row('B', B);
      const turn = document.getElementById('pens-turn');
      const done = document.getElementById('pens-done');
      if (win) {
        turn.classList.add('hidden');
        done.classList.remove('hidden');
        const t = state.court[win];
        done.innerHTML = `
          <div class="rounded-2xl bg-butter/60 border border-butter-3 p-4 flex items-center gap-3">
            <img src="babinha/champion.webp" alt="" class="w-16 h-16 object-contain flex-shrink-0" />
            <p class="text-[15px] font-bold leading-snug">Time ${escapeHtml(t.label)} venceu nos pênaltis, ${Math.max(pensCount('A', true), pensCount('B', true))} a ${Math.min(pensCount('A', true), pensCount('B', true))}.</p>
          </div>
          <button onclick="confirmShootout()" class="btn-primary w-full h-12 text-[15px] mt-3"><i class="fa-solid fa-flag-checkered"></i> Confirmar e finalizar</button>`;
        return;
      }
      turn.classList.remove('hidden');
      done.classList.add('hidden');
      const side = pensSide();
      const t = state.court[side];
      const kicker = pensKicker(side);
      const gk = goalieOf(side === 'A' ? 'B' : 'A');
      const nth = pensCount(side) + 1;
      document.getElementById('pens-title').innerText = `Cobrança ${nth}${nth > 5 ? ' (alternadas)' : ''} · Time ${t.label}`;
      document.getElementById('pens-kickers').innerHTML = t.ids.map(id => `<button onclick="pickPenKicker(${id})" class="chip ${id === kicker ? 'is-selected' : ''}">${escapeHtml(nameOf(id))}</button>`).join('');
      document.getElementById('pens-save').innerHTML = `<i class="fa-solid fa-hand"></i> Defesa${gk ? ` de ${escapeHtml(firstName(gk.name))}` : ''}`;
      document.getElementById('pens-undo').disabled = !shootout.kicks.length;
    }
    function pickPenKicker(id) { if (shootout) { shootout.pick = id; renderShootout(); } }
    function recordPen(result) {
      if (!shootout || pensWinner()) return;
      const side = pensSide();
      const kicker = pensKicker(side);
      if (kicker == null) return;
      const gk = result === 'defesa' ? goalieOf(side === 'A' ? 'B' : 'A') : null;
      shootout.kicks.push({ side, playerId: kicker, result, keeperId: gk ? gk.id : null });
      const t = state.court[side];
      shootout.ptr[side] = (t.ids.indexOf(kicker) + 1) % Math.max(1, t.ids.length);
      shootout.pick = null;
      buzz(result === 'gol' ? [30, 40, 30] : 60);
      renderShootout();
    }
    function undoPen() {
      if (!shootout || !shootout.kicks.length) return;
      const k = shootout.kicks.pop();
      const t = state.court[k.side];
      shootout.ptr[k.side] = Math.max(0, t.ids.indexOf(k.playerId));
      renderShootout();
    }
    function confirmShootout() {
      const win = shootout && pensWinner();
      if (!win) return;
      const pens = { a: pensCount('A', true), b: pensCount('B', true), kicks: shootout.kicks.slice() };
      closeShootout();
      finishMatchAndNextChallenger(true, pens);
    }
    /* Skip the shootout this time: the usual draw rule (the king leaves). */
    function skipShootout() {
      closeShootout();
      const rule = state.settings.drawRule;
      state.settings.drawRule = 'king';
      finishMatchAndNextChallenger(true).finally(() => { state.settings.drawRule = rule; saveState(); });
    }

    async function undoFinish() {
      if (!orgOnly()) return;
      const snap = state.lastFinish;
      if (!snap) { showToast('Nada para desfazer.', 'warning'); return; }
      if (state.match.events.length && !(await askConfirm('Desfazer a última partida? Os lances do jogo atual também serão apagados.', 'Desfazer'))) return;
      if (state.match.isRunning) pauseMatchTimer();
      state = Object.assign(defaultState(), snap, { lastFinish: null });
      state.match.isRunning = false;
      state.match.endAt = null;
      repair();
      commit('Última partida desfeita.');
    }

    function updateStandingsRecord(team, goalsFor, goalsAgainst, wonPens) {
      const key = String(team.label);
      if (!state.standings[key]) {
        state.standings[key] = { matches: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, sg: 0, names: [] };
      }
      const st = state.standings[key];
      st.matches++;
      st.gf += goalsFor;
      st.ga += goalsAgainst;
      st.sg = st.gf - st.ga;
      st.names = team.ids.map(nameOf);
      // A draw decided on penalties counts as a win / loss.
      if (goalsFor > goalsAgainst || wonPens === true) st.wins++;
      else if (goalsFor === goalsAgainst && wonPens == null) st.draws++;
      else st.losses++;
    }

    function renderMatchRosterText(side) {
      const container = document.getElementById(`match-roster-${side.toLowerCase()}`);
      const t = state.court[side];
      if (!t) {
        container.innerHTML = '<span class="italic text-ink-2 text-[11px]">Sem time</span>';
        return;
      }
      container.innerHTML = t.ids.map(id => {
        const p = byId(id);
        return `
          <div class="flex items-center justify-between gap-1 py-1 border-b border-ink/[0.07]">
            <span class="font-semibold truncate min-w-0">${p && p.isGoalkeeper ? '🧤 ' : ''}${escapeHtml(nameOf(id))}</span>
            <span class="text-[11px] font-bold flex-shrink-0 tabular"><span class="text-pitch">${p ? p.goals || 0 : 0}G</span> <span class="text-ink-2">${p ? p.assists || 0 : 0}A</span></span>
          </div>`;
      }).join('') + (t.ids.length < teamSize() ? `<p class="text-[11px] text-warn pt-1">${t.ids.length}/${teamSize()} jogadores</p>` : '');
    }

    function renderMatchEventsLog() {
      const container = document.getElementById('match-events-log');
      const events = state.match.events || [];
      document.getElementById('btn-undo').classList.toggle('opacity-40', events.length === 0);
      if (events.length === 0) {
        container.innerHTML = '<p class="text-ink-2 italic text-[12px]">Nenhum lance nesta partida ainda.</p>';
        return;
      }
      container.innerHTML = events.map(ev => `
        <div class="flex items-start gap-2 py-1.5 border-b border-ink/[0.07]">
          <span class="text-[11px] font-bold leading-none text-pitch bg-butter px-1.5 py-1 rounded-md tabular flex-shrink-0">${escapeHtml(ev.time)}</span>
          <span class="leading-snug">${escapeHtml(ev.text)}</span>
        </div>`).join('');
    }

