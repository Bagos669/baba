    /* ===================================================================
       ARRIVALS (LISTA)
       =================================================================== */
    function checkIn(id) {
      const p = byId(id);
      if (!p || p.present) return;
      p.present = true;
      p.arrival = ++state.arrivalSeq;
      p.arrivedAt = Date.now();
      if (!state.startedAt) state.startedAt = p.arrivedAt;
      if (isFixedKeeper(p)) return;
      if (isLateJump(p.arrivedAt)) { state.queue.unshift(id); p.jumped = true; }
      else state.queue.push(id);
    }

    /* Time ruler: someone who arrives long after the first kick-off goes to the front of the line. */
    function isLateJump(at) {
      const mins = Number(state.settings.lateAfter) || 0;
      return !!(mins && state.firstKickoffAt && at && at - state.firstKickoffAt >= mins * 60000);
    }
    const lateLabel = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} min`;

    /* Taking someone out of the waiting line = they went home (marked as not here). */
    async function removeFromQueue(id) {
      const p = byId(id);
      if (!p) return;
      if (!(await askConfirm(`Tirar ${p.name} da fila? Fica como "foi embora" na Lista. Os números de hoje continuam.`, 'Tirar da fila'))) return;
      checkOut(id);
      commit(`${p.name} saiu da fila.`);
    }

    function checkOut(id) {
      const p = byId(id);
      if (!p || !p.present) return;
      p.present = false;
      p.arrival = null;
      p.arrivedAt = null;
      p.jumped = false;
      repair();
    }

    async function togglePlayerAttendance(id) {
      const p = byId(id);
      if (!p) return;
      if (!p.present) {
        checkIn(id);
        commit(isFixedKeeper(p) ? `${p.name} chegou · goleiro fixo` : `${p.name} chegou · ${state.queue.indexOf(id) + 1}º na fila${p.jumped ? ' (régua de tempo: entrou na frente)' : ''}`);
        return;
      }
      const side = sideOf(id);
      const where = side ? `está em quadra no Time ${state.court[side].label}` : 'está na fila';
      if (!(await askConfirm(`${p.name} ${where}. Marcar que foi embora? Se voltar, entra no fim da fila.`, 'Foi embora'))) return;
      checkOut(id);
      commit(side ? `${p.name} saiu do Time ${state.court[side] ? state.court[side].label : ''}. Coloque alguém na aba Times.` : `${p.name} saiu da fila.`, side ? 'warning' : undefined);
    }

    function checkInAll() {
      const missing = state.players.filter(p => !p.present);
      if (!missing.length) { showToast('Todo mundo já chegou.'); return; }
      missing.forEach(p => checkIn(p.id));
      commit(`${missing.length} marcados na ordem da lista.`);
    }

    function renderSheetTable() {
      const tbody = document.getElementById('sheet-players-tbody');
      const present = presentPlayers().sort((a, b) => (a.arrival || 0) - (b.arrival || 0));
      // Who said they're coming shows first among those who haven't arrived.
      const ev = todaysEvent();
      const coming = p => { const r = ev && rsvpOf(ev, keyOf(p.name)); return r && r.status === 'vou' ? 0 : r && r.status === 'talvez' ? 1 : r ? 3 : 2; };
      const absent = state.players.filter(p => !p.present).map((p, i) => [p, i]).sort((a, b) => coming(a[0]) - coming(b[0]) || a[1] - b[1]).map(x => x[0]);

      document.getElementById('sheet-active-count').innerText = present.length;
      document.getElementById('sheet-waiting-count').innerText = absent.length;
      // Baba ligado à lista do dia (palpites pré-jogo).
      const link = document.getElementById('list-event-link');
      if (link) {
        const le = state.eventId && eventsCache.find(x => x.id === state.eventId);
        link.classList.toggle('hidden', !le);
        if (le) link.innerHTML = `<i class="fa-solid fa-link"></i> Baba ligado à lista de ${escapeHtml(evWhen(le))}${propCounts[le.id] ? ` · ${propCounts[le.id]} palpite${propCounts[le.id] === 1 ? '' : 's'} aberto${propCounts[le.id] === 1 ? '' : 's'}` : ''}`;
      }
      document.getElementById('btn-check-all').classList.toggle('hidden', absent.length === 0);

      if (!state.players.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-ink-2 italic">Selecione uma turma ou adicione atletas.</td></tr>';
        return;
      }

      const section = (label, n) => `<tr><td colspan="7" class="pt-3 pb-1.5 px-1.5 text-[11px] font-extrabold uppercase tracking-wider text-ink-2">${label} · ${n}</td></tr>`;
      const row = (p, sub, presentRow) => `
        <tr class="${presentRow ? '' : 'is-absent'}">
          <td class="py-1.5 px-1.5 max-w-[8.5rem]">
            <button onclick="openPlayerSheet(${p.id})" class="text-left w-full min-w-0">
              <span class="block font-bold text-ink truncate">${p.isGoalkeeper ? '🧤 ' : ''}${escapeHtml(p.name)}</span>
              <span class="block text-[11px] text-ink-2 truncate">${sub}</span>
              ${arrivalTag(p) ? `<span class="block mt-0.5">${arrivalTag(p)}</span>` : ''}
            </button>
          </td>
          <td class="py-1.5 px-0.5 text-center">
            <button onclick="togglePlayerPos(${p.id})" class="min-w-[2.3rem] py-1.5 text-[11px] font-extrabold rounded-lg ${p.isGoalkeeper ? 'bg-butter text-pitch border border-butter-3' : 'bg-sunk text-ink-2 border border-transparent'}">${p.isGoalkeeper ? 'GOL' : 'LIN'}</button>
          </td>
          <td class="py-1.5 px-0.5 text-center font-extrabold text-pitch">${p.goals || 0}</td>
          <td class="py-1.5 px-0.5 text-center font-bold text-ink-2">${p.assists || 0}</td>
          <td class="py-1.5 px-0.5 text-center font-bold text-ink-2">${p.saves || 0}</td>
          <td class="py-1.5 px-0.5 text-center font-bold text-ink-2">${p.matches || 0}</td>
          <td class="py-1.5 px-1 text-center">
            ${presentRow
              ? `<button onclick="togglePlayerAttendance(${p.id})" class="w-8 h-8 rounded-full text-[12px] bg-leaf/10 text-leaf border border-leaf/30" aria-label="Presente"><i class="fa-solid fa-check"></i></button>`
              : `<button onclick="togglePlayerAttendance(${p.id})" class="h-8 px-3 rounded-full text-[12px] font-extrabold bg-pitch text-butter">Chegou</button>`}
          </td>
        </tr>`;

      let html = '';
      if (present.length) {
        html += section('Chegaram', present.length);
        html += present.map((p, i) => {
          const side = sideOf(p.id);
          const where = side ? `em quadra · Time ${state.court[side].label}` : `fila · ${state.queue.indexOf(p.id) + 1}º`;
          return row(p, `${i + 1}º${p.arrivedAt ? ' às ' + fmtClock(p.arrivedAt) : ''} · ${where}`, true);
        }).join('');
      }
      if (absent.length) {
        html += section('Ainda não chegaram', absent.length);
        html += absent.map(p => {
          const t = turmaById(p.turmaId);
          return row(p, t ? escapeHtml(t.name) : 'Convidado', false);
        }).join('');
      }
      tbody.innerHTML = html;
    }

    /* Today's flag always changes; the saved turmas only where you can edit them. */
    function setFemaleFlag(p, female) {
      p.female = !!female;
      const t = turmaById(p.turmaId);
      if (t && canEditTurma(t)) {
        t.women = t.women || [];
        const was = t.women.some(k => sameName(k, p.name));
        t.women = t.women.filter(k => !sameName(k, p.name));
        if (female) t.women.push(p.name);
        if (was !== !!female) markTurmaDirty(t.id);
      }
    }

    function setKeeperFlag(p, isGk) {
      p.isGoalkeeper = isGk;
      state.turmas.forEach(t => {
        if (!canEditTurma(t) || !t.players.some(n => sameName(n, p.name))) return;
        const was = t.keepers.some(k => sameName(k, p.name));
        t.keepers = t.keepers.filter(k => !sameName(k, p.name));
        if (isGk) t.keepers.push(p.name);
        if (was !== isGk) markTurmaDirty(t.id);
      });
    }

    function togglePlayerPos(id) {
      const p = byId(id);
      if (!p) return;
      setKeeperFlag(p, !p.isGoalkeeper);
      commit();
    }

    /* ---- Add player ---- */
    function turmaOptionsHtml(emptyLabel) {
      const opts = state.turmas.filter(t => state.selectedTeams.includes(t.id) && canEditTurma(t));
      return `<option value="">${emptyLabel}</option>` + opts.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    }

    function openAddPlayerModal() {
      document.getElementById('input-new-player-name').value = '';
      document.querySelector('input[name="new-player-pos"][value="linha"]').checked = true;
      document.querySelector('input[name="new-player-sex"][value="m"]').checked = true;
      document.getElementById('input-new-player-turma').innerHTML = turmaOptionsHtml('Convidado (só hoje)');
      document.getElementById('input-new-player-arrived').checked = true;
      document.getElementById('modal-add-player').classList.remove('hidden');
      setTimeout(() => document.getElementById('input-new-player-name').focus(), 150);
    }

    function closeAddPlayerModal() {
      document.getElementById('modal-add-player').classList.add('hidden');
    }

    function saveNewPlayer() {
      const name = document.getElementById('input-new-player-name').value.trim().replace(/\s+/g, ' ');
      if (!name) { showToast('Digite o nome do atleta!', 'warning'); return; }
      if (state.players.some(p => sameName(p.name, name))) { showToast('Esse atleta já está na lista.', 'warning'); return; }

      const turmaId = document.getElementById('input-new-player-turma').value || null;
      const isGk = document.querySelector('input[name="new-player-pos"]:checked').value === 'goleiro';
      const female = document.querySelector('input[name="new-player-sex"]:checked').value === 'f';
      const arrived = document.getElementById('input-new-player-arrived').checked;

      const t = turmaById(turmaId);
      if (t && canEditTurma(t) && !t.players.some(n => sameName(n, name))) {
        t.players.push(name);
        markTurmaDirty(t.id);
      }

      const p = newPlayer(name, turmaId);
      p.id = nextPlayerId();
      state.players.push(p);
      setKeeperFlag(p, isGk);
      setFemaleFlag(p, female);
      if (arrived) checkIn(p.id);

      closeAddPlayerModal();
      commit(arrived ? `${name} chegou · ${state.queue.indexOf(p.id) + 1}º na fila` : `${name} adicionado à lista.`);
    }

    /* ---- Player sheet ---- */
    let editingPlayerId = null;

    function openPlayerSheet(id) {
      const p = byId(id);
      if (!p) return;
      editingPlayerId = id;
      document.getElementById('player-edit-name').value = p.name;
      document.querySelector(`input[name="player-edit-pos"][value="${p.isGoalkeeper ? 'goleiro' : 'linha'}"]`).checked = true;
      document.querySelector(`input[name="player-edit-sex"][value="${p.female ? 'f' : 'm'}"]`).checked = true;
      sheetStats = { goals: p.goals || 0, assists: p.assists || 0, saves: p.saves || 0 };
      renderSheetStats();
      document.getElementById('player-edit-leave').classList.toggle('hidden', !p.present);

      const t = turmaById(p.turmaId);
      const wrap = document.getElementById('player-edit-turma-wrap');
      wrap.classList.toggle('hidden', !!t || !state.selectedTeams.length);
      document.getElementById('player-edit-turma').innerHTML = turmaOptionsHtml('Não, só hoje (convidado)');

      const side = sideOf(id);
      const parts = [];
      parts.push(t ? `Turma ${escapeHtml(t.name)}` : 'Convidado');
      if (p.present) parts.push(side ? `em quadra no Time ${state.court[side].label}` : `${state.queue.indexOf(id) + 1}º na fila`);
      else parts.push('ainda não chegou');
      parts.push(`${p.matches || 0} jogo${p.matches === 1 ? '' : 's'} · ${p.wins || 0} vitória${p.wins === 1 ? '' : 's'}`);
      document.getElementById('player-edit-info').innerHTML = parts.join(' · ');

      // Only convidados can be deleted here; turma members are removed in the turma editor.
      document.getElementById('player-edit-delete').classList.toggle('hidden', !!t);
      document.getElementById('modal-player').classList.remove('hidden');
    }

    let sheetStats = null;
    function renderSheetStats() {
      const box = document.getElementById('player-edit-stats');
      if (!box || !sheetStats) return;
      const row = (k, label) => `
        <div class="flex items-center gap-2 bg-sunk/70 rounded-2xl px-3 py-2">
          <span class="flex-1 text-[13px] font-bold">${label}</span>
          <button type="button" onclick="bumpSheetStat('${k}', -1)" class="btn-icon !bg-card" ${sheetStats[k] ? '' : 'disabled'} aria-label="Menos ${label}"><i class="fa-solid fa-minus"></i></button>
          <span class="w-7 text-center text-[16px] font-extrabold tabular">${sheetStats[k]}</span>
          <button type="button" onclick="bumpSheetStat('${k}', 1)" class="btn-icon !bg-card" aria-label="Mais ${label}"><i class="fa-solid fa-plus"></i></button>
        </div>`;
      box.innerHTML = row('goals', 'Gols') + row('assists', 'Assistências') + row('saves', 'Defesas');
    }
    function bumpSheetStat(k, d) {
      if (!sheetStats) return;
      sheetStats[k] = Math.max(0, Math.min(99, (sheetStats[k] || 0) + d));
      renderSheetStats();
    }
    async function playerLeftFromSheet() {
      const p = byId(editingPlayerId);
      if (!p) return closePlayerSheet();
      const side = sideOf(p.id);
      if (!(await askConfirm(`${p.name} foi embora? ${side ? 'Sai do time em quadra e ' : ''}fica como "foi embora" na Lista. Os números de hoje continuam.`, 'Foi embora'))) return;
      checkOut(p.id);
      closePlayerSheet();
      commit(`${p.name} foi embora.${side && state.court[side] && state.court[side].ids.length < teamSize() && state.queue.length ? ' Complete o time na aba Times.' : ''}`);
    }

    function closePlayerSheet() {
      editingPlayerId = null;
      document.getElementById('modal-player').classList.add('hidden');
    }

    function savePlayerSheet() {
      const p = byId(editingPlayerId);
      if (!p) return closePlayerSheet();
      const name = document.getElementById('player-edit-name').value.trim().replace(/\s+/g, ' ');
      if (!name) { showToast('O nome não pode ficar vazio.', 'warning'); return; }
      if (state.players.some(x => x.id !== p.id && sameName(x.name, name))) { showToast('Já existe um atleta com esse nome.', 'warning'); return; }

      if (name !== p.name) {
        state.turmas.forEach(t => {
          if (!canEditTurma(t)) return;
          const old = t.players.find(n => sameName(n, p.name));
          if (!old) return;
          t.players = t.players.map(n => sameName(n, p.name) ? name : n);
          t.keepers = t.keepers.map(n => sameName(n, p.name) ? name : n);
          t.women = (t.women || []).map(n => sameName(n, p.name) ? name : n);
          if (t.meta && t.meta[old.toLowerCase()]) {
            t.meta[name.toLowerCase()] = t.meta[old.toLowerCase()];
            delete t.meta[old.toLowerCase()];
          }
          // Rename on the server keeps the player's account link and stats.
          if (t.cloud) enqueue({ type: 'player_rename', turmaId: t.id, oldName: old, newName: name });
          markTurmaDirty(t.id);
        });
        p.name = name;
      }
      setKeeperFlag(p, document.querySelector('input[name="player-edit-pos"]:checked').value === 'goleiro');
      setFemaleFlag(p, document.querySelector('input[name="player-edit-sex"]:checked').value === 'f');
      if (sheetStats) Object.assign(p, sheetStats);

      const newTurma = turmaById(document.getElementById('player-edit-turma').value);
      if (!p.turmaId && newTurma && canEditTurma(newTurma)) {
        if (!newTurma.players.some(n => sameName(n, p.name))) newTurma.players.push(p.name);
        if (p.isGoalkeeper && !newTurma.keepers.some(k => sameName(k, p.name))) newTurma.keepers.push(p.name);
        if (p.female && !(newTurma.women || (newTurma.women = [])).some(k => sameName(k, p.name))) newTurma.women.push(p.name);
        p.turmaId = newTurma.id;
        markTurmaDirty(newTurma.id);
      }
      closePlayerSheet();
      commit('Atleta atualizado.');
    }

    async function deletePlayerFromSheet() {
      const p = byId(editingPlayerId);
      if (!p) return closePlayerSheet();
      const msg = hasStats(p)
        ? `Excluir ${p.name}? Os gols e jogos dele de hoje somem das estatísticas.`
        : `Excluir ${p.name} da lista de hoje?`;
      if (!(await askConfirm(msg, 'Excluir'))) return;
      state.players = state.players.filter(x => x.id !== p.id);
      repair();
      closePlayerSheet();
      commit(`${p.name} excluído.`);
    }

    /* ===================================================================
       TEAMS & QUEUE (REI DA QUADRA)
       =================================================================== */
    /* Takes up to n players from the front of `queue`, keeping order.
       With keeperBalance on, a team gets at most one goalkeeper, and if it
       has none, the first goalkeeper waiting further back is pulled in
       (the last line player taken goes back to the front of the line). */
    function takeFrom(queue, n, teamHasKeeper = false) {
      const balance = state.settings.keeperBalance && keeperMode() === 'time';
      const team = [];
      const rest = [];
      let hasKeeper = teamHasKeeper;

      queue.forEach(id => {
        const p = byId(id);
        const gk = !!(p && p.isGoalkeeper);
        if (team.length < n && !(balance && gk && hasKeeper)) {
          team.push(id);
          if (gk) hasKeeper = true;
        } else {
          rest.push(id);
        }
      });

      // Short line: fill with whoever was skipped rather than leave a gap.
      while (team.length < n && rest.length) team.push(rest.shift());

      if (balance && !hasKeeper && n > 1) {
        const idx = rest.findIndex(id => { const p = byId(id); return p && p.isGoalkeeper; });
        if (idx >= 0) {
          const keeperId = rest.splice(idx, 1)[0];
          if (team.length >= n) rest.unshift(team.pop());
          team.push(keeperId);
        }
      }
      return { team, rest };
    }

    const idsKey = ids => [...ids].sort((a, b) => a - b).join(',');

    function formTeam(prevTeams, n) {
      const { team, rest } = takeFrom(state.queue, n || teamSize());
      if (!team.length) return null;
      state.queue = rest;
      // Same group of players coming straight back keeps its name.
      const prev = (prevTeams || []).find(t => idsKey(t.ids) === idsKey(team));
      return { label: prev ? prev.label : ++state.teamSeq, ids: team, streak: 0 };
    }

    function setupCourt(prevTeams) {
      const size = teamSize();
      let n = size;
      // At the very start with few people, split them evenly instead of 5 x 1.
      if (!state.court.A && !state.court.B && state.queue.length < size * 2) n = Math.ceil(state.queue.length / 2);
      if (!state.court.A) state.court.A = formTeam(prevTeams, n);
      if (!state.court.B) state.court.B = formTeam(prevTeams, n);
    }

    function buildTeams() {
      if (!presentPlayers().length) { showToast('Marque quem chegou na Lista primeiro.', 'warning'); switchTab('ficha'); return; }
      if (!state.queue.length) { showToast('Ninguém esperando na fila.', 'warning'); return; }
      setupCourt([]);
      commit(state.court.A && state.court.B ? `Times montados: Time ${state.court.A.label} x Time ${state.court.B.label}` : 'Time montado. Falta gente pro outro lado.');
    }

    /* Tops a short team up from the front of the queue. Returns who came in. */
    function topUp(side) {
      const t = state.court[side];
      if (!t) return [];
      const need = teamSize() - t.ids.length;
      if (need <= 0 || !state.queue.length) return [];
      const hasKeeper = t.ids.some(id => { const p = byId(id); return p && p.isGoalkeeper; });
      const { team, rest } = takeFrom(state.queue, need, hasKeeper);
      t.ids.push(...team);
      state.queue = rest;
      return team;
    }

    function completeTeam(side) {
      const added = topUp(side);
      if (!added.length) return;
      commit(`Time ${state.court[side].label} completo com ${added.map(nameOf).join(', ')}.`);
    }

    const matchNotStarted = () => state.match.events.length === 0 && state.match.scoreA === 0 && state.match.scoreB === 0 && !state.match.isRunning;

    async function disbandCourt() {
      if (!orgOnly()) return;
      if (!state.court.A && !state.court.B) return;
      if (!(await askConfirm('Desfazer os times em quadra? Os jogadores voltam pro início da fila na mesma ordem.', 'Desfazer times'))) return;
      const back = [...(state.court.A ? state.court.A.ids : []), ...(state.court.B ? state.court.B.ids : [])];
      state.court = { A: null, B: null };
      state.queue = [...back, ...state.queue];
      state.match.scoreA = 0;
      state.match.scoreB = 0;
      state.match.events = [];
      commit('Times desfeitos.');
    }

    function moveQueue(index, delta) {
      const j = index + delta;
      if (index < 0 || j < 0 || index >= state.queue.length || j >= state.queue.length) return;
      [state.queue[index], state.queue[j]] = [state.queue[j], state.queue[index]];
      commit();
    }

    /* Preview: which upcoming team each waiting player would be in. */
    function queueGroups() {
      const map = new Map();
      let q = [...state.queue];
      let g = 0;
      while (q.length && g < 60) {
        const { team, rest } = takeFrom(q, teamSize());
        team.forEach(id => map.set(id, g));
        q = rest;
        g++;
      }
      return map;
    }

    function renderFila() {
      document.getElementById('set-draw').value = state.settings.drawRule;
      document.getElementById('set-streak').value = String(state.settings.maxStreak || 0);
      document.getElementById('set-keeper').checked = !!state.settings.keeperBalance;
      document.getElementById('set-order').value = state.settings.queueOrder || 'chegada';
      document.getElementById('set-late').value = String(state.settings.lateAfter || 0);
      document.getElementById('set-gk-mode').value = keeperMode();
      document.getElementById('set-keeper-row').classList.toggle('hidden', keeperMode() !== 'time');

      const size = teamSize();
      const box = document.getElementById('court-manager');
      const anyCourt = state.court.A || state.court.B;

      const teamCard = side => {
        const t = state.court[side];
        const role = side === 'A' ? (t && t.streak > 0 ? `Rei da quadra · ${t.streak} vit.` : 'Lado A') : 'Lado B';
        if (!t) {
          return `
            <div class="card p-3.5 flex items-center justify-between gap-3">
              <div class="min-w-0"><span class="block text-[12px] font-semibold text-ink-2">${side === 'A' ? 'Lado A' : 'Lado B'}</span><p class="text-[14px] text-ink-2 italic">Sem time</p></div>
              ${state.queue.length ? `<button onclick="buildTeams()" class="btn-primary px-4 h-10 text-[13px] flex-shrink-0">Montar da fila</button>` : ''}
            </div>`;
        }
        const short = size - t.ids.length;
        return `
          <div class="card p-3.5">
            <div class="flex items-center justify-between gap-2 mb-2">
              <div class="min-w-0">
                <span class="block text-[12px] font-semibold text-ink-2">${role}</span>
                <p class="text-[17px] font-bold">Time ${t.label} <span class="text-[12px] font-bold ${short > 0 ? 'text-warn' : 'text-ink-2'}">${t.ids.length}/${size}</span></p>
              </div>
              ${short > 0 && state.queue.length ? `<button onclick="completeTeam('${side}')" class="btn-soft h-9 px-3.5 text-[12px] flex-shrink-0"><i class="fa-solid fa-user-plus"></i> Completar</button>` : ''}
            </div>
            <div class="space-y-1">
              ${t.ids.map(id => {
                const p = byId(id);
                return `
                  <div class="flex items-center gap-2 py-1 border-b border-ink/[0.07]">
                    <button onclick="openPlayerSheet(${id})" class="min-w-0 flex-1 text-left" aria-label="Ficha de ${escapeHtml(nameOf(id))}">
                      <span class="block text-[14px] font-bold text-ink truncate">${p && p.isGoalkeeper && !fixedKeepers() ? '🧤 ' : ''}${escapeHtml(nameOf(id))} <i class="fa-solid fa-pen text-[10px] text-ink-3 ml-0.5"></i></span>
                      <span class="block text-[11px] text-ink-2">${p ? p.matches || 0 : 0} jogo${p && p.matches === 1 ? '' : 's'} hoje${p ? ` · ${p.goals || 0} gol${p.goals === 1 ? '' : 's'}` : ''}</span>
                    </button>
                    <button onclick="openSubModal('${side}', ${id})" class="h-9 px-3 rounded-full bg-sunk text-pitch text-[12px] font-bold flex items-center gap-1.5 flex-shrink-0 active:scale-95"><i class="fa-solid fa-right-left"></i> Trocar</button>
                  </div>`;
              }).join('')}
            </div>
          </div>`;
      };

      let html = '';
      if (!anyCourt) {
        html = `
          <div class="card p-5 text-center space-y-2">
            <p class="text-[14px] font-bold text-ink">${presentPlayers().length ? `${state.queue.length} na fila, ninguém em quadra` : 'Ninguém chegou ainda'}</p>
            <p class="text-[12px] text-ink-2">${presentPlayers().length ? 'Os times saem na ordem de chegada.' : 'Marque a chegada na aba Lista.'}</p>
            ${presentPlayers().length
              ? `<button onclick="buildTeams()" class="btn-primary w-full h-12 text-[14px]">Montar times pela ordem de chegada</button>
                 <button onclick="openManualTeams()" class="btn-outline w-full h-11 text-[14px]"><i class="fa-solid fa-hand-pointer"></i> Escolher os times na mão</button>`
              : `<button onclick="switchTab('ficha')" class="btn-primary w-full h-12 text-[14px]">Abrir lista de chegada</button>`}
          </div>`;
      } else {
        html = teamCard('A') + teamCard('B') + `
          <div class="grid grid-cols-2 gap-2">
            <button onclick="openManualTeams()" class="btn-outline h-10 text-[12px]"><i class="fa-solid fa-hand-pointer"></i> Mexer nos times</button>
            <button onclick="disbandCourt()" class="btn-soft h-10 text-[12px]"><i class="fa-solid fa-rotate-left"></i> Desfazer times</button>
          </div>`;
      }
      box.innerHTML = html;

      // Queue
      document.getElementById('queue-count').innerText = state.queue.length ? `${state.queue.length} esperando` : '';
      const list = document.getElementById('queue-list');
      if (!state.queue.length) {
        list.innerHTML = `<p class="text-[12px] text-ink-2 italic">${presentPlayers().length ? 'Fila vazia: todo mundo que chegou está em quadra.' : 'Ninguém na fila.'}</p>`;
        return;
      }
      const groups = queueGroups();
      const badge = g => g === 0
        ? '<span class="text-[11px] font-extrabold text-pitch bg-butter rounded-full px-2 py-0.5">Próximo</span>'
        : `<span class="text-[11px] font-bold text-ink-2 bg-sunk rounded-full px-2 py-0.5">${g + 1}º time</span>`;

      const auto = state.settings.queueOrder === 'menos-jogos';
      const inGoal = queueKeepers();
      const gkSide = id => inGoal.indexOf(id) === 0 ? 'A' : 'B';
      list.innerHTML = (auto ? '<p class="text-[12px] text-ink-2 mb-1"><i class="fa-solid fa-arrow-down-short-wide text-pitch mr-1"></i>Ordem automática: quem jogou menos fica na frente.</p>' : '') + state.queue.map((id, i) => {
        const p = byId(id);
        const g = groups.has(id) ? groups.get(id) : 0;
        const prevG = i > 0 && groups.has(state.queue[i - 1]) ? groups.get(state.queue[i - 1]) : g;
        return `
          <div class="flex items-center gap-1.5 ${i > 0 && prevG !== g ? 'pt-2 mt-1 border-t border-ink/10' : ''}">
            <span class="w-6 text-center text-[11px] font-extrabold text-ink-3 flex-shrink-0">${i + 1}</span>
            <button onclick="openPlayerSheet(${id})" class="min-w-0 flex-1 text-left">
              <span class="block text-[14px] font-bold text-ink truncate">${p && p.isGoalkeeper && !fixedKeepers() ? '🧤 ' : ''}${escapeHtml(nameOf(id))}</span>
              <span class="block text-[11px] text-ink-2 truncate">${inGoal.includes(id) ? `<b class="text-pitch">🧤 no gol do Time ${state.court[gkSide(id)] ? state.court[gkSide(id)].label : gkSide(id)}</b> · ` : ''}${p ? p.matches || 0 : 0} jogo${p && p.matches === 1 ? '' : 's'}${p && p.arrivedAt ? ' · chegou ' + fmtClock(p.arrivedAt) : ''}${p && p.jumped ? ' · entrou na frente' : ''}</span>
            </button>
            ${badge(g)}
            ${auto ? '' : `<button onclick="moveQueue(${i}, -1)" class="btn-icon" ${i === 0 ? 'disabled' : ''} aria-label="Subir"><i class="fa-solid fa-arrow-up"></i></button>
            <button onclick="moveQueue(${i}, 1)" class="btn-icon" ${i === state.queue.length - 1 ? 'disabled' : ''} aria-label="Descer"><i class="fa-solid fa-arrow-down"></i></button>`}
            <button onclick="removeFromQueue(${id})" class="btn-icon !text-danger" aria-label="Tirar ${escapeHtml(nameOf(id))} da fila"><i class="fa-solid fa-xmark"></i></button>
          </div>`;
      }).join('');
    }

    function updateSetting(key, value) {
      state.settings[key] = value;
      commit();
    }

    /* ---- Substitution ---- */
    let subContext = null;

    function openSubModal(side, outId) {
      const t = state.court[side];
      if (!t || !t.ids.includes(outId)) return;
      subContext = { side, outId, dest: 'swap' };
      renderSubModal();
      document.getElementById('modal-sub').classList.remove('hidden');
    }

    function closeSubModal() {
      subContext = null;
      document.getElementById('modal-sub').classList.add('hidden');
    }

    function setSubDest(dest) {
      if (!subContext) return;
      subContext.dest = dest;
      renderSubModal();
    }

    function renderSubModal() {
      const { side, outId, dest } = subContext;
      const t = state.court[side];
      document.getElementById('modal-sub-title').innerText = `Sai: ${nameOf(outId)}`;
      document.getElementById('modal-sub-subtitle').innerText = `Time ${t.label} · cansou, machucou, foi embora ou troca de time`;

      const opts = [
        ['swap', 'Fica no lugar de quem entrar'],
        ['end', 'Vai pro fim da fila'],
        ['out', 'Foi embora / machucou']
      ];
      document.getElementById('modal-sub-dest').innerHTML = opts.map(([v, label]) =>
        `<button onclick="setSubDest('${v}')" class="seg-btn ${dest === v ? 'is-selected' : ''}">${label}</button>`).join('');

      const list = document.getElementById('modal-sub-list');
      const items = state.queue.map((id, i) => {
        const p = byId(id);
        return `
          <button onclick="applySub(${id})" class="pick-btn">
            <span class="min-w-0">
              <span class="block truncate">${p && p.isGoalkeeper ? '🧤 ' : ''}${escapeHtml(nameOf(id))}</span>
              <span class="block text-[11px] font-semibold text-ink-2">${i + 1}º na fila · ${p ? p.matches || 0 : 0} jogo${p && p.matches === 1 ? '' : 's'}</span>
            </span>
            <i class="fa-solid fa-right-left text-pitch/50 flex-shrink-0"></i>
          </button>`;
      }).join('');
      const otherSide = side === 'A' ? 'B' : 'A';
      const other = state.court[otherSide];
      const swaps = other ? other.ids.map(id => `
          <button onclick="swapBetweenTeams(${id})" class="pick-btn">
            <span class="min-w-0">
              <span class="block truncate">${escapeHtml(nameOf(id))}</span>
              <span class="block text-[11px] font-semibold text-ink-2">Time ${escapeHtml(other.label)} · troca de time com ${escapeHtml(firstName(nameOf(outId)))}</span>
            </span>
            <i class="fa-solid fa-arrows-rotate text-pitch/50 flex-shrink-0"></i>
          </button>`).join('') : '';
      list.innerHTML = (items || '<p class="text-[12px] text-ink-2 italic pb-1">Ninguém na fila para entrar.</p>') + `
        <button onclick="applySub(null)" class="pick-btn !text-ink-2 !font-semibold">
          <span>Ninguém entra (time fica com um a menos)</span>
        </button>` + (swaps ? `<p class="section-tag">Trocar com o outro time</p>${swaps}` : '');
    }

    /* Two players switch teams; nobody goes to the line. */
    function swapBetweenTeams(otherId) {
      if (!subContext) return;
      const { side, outId } = subContext;
      const a = state.court[side], b = state.court[side === 'A' ? 'B' : 'A'];
      const i = a ? a.ids.indexOf(outId) : -1, j = b ? b.ids.indexOf(otherId) : -1;
      if (i < 0 || j < 0) return closeSubModal();
      a.ids[i] = otherId;
      b.ids[j] = outId;
      closeSubModal();
      commit(`${nameOf(outId)} foi pro Time ${b.label} e ${nameOf(otherId)} pro Time ${a.label}.`);
    }

    /* ---- Montar os times na mão: each present player goes to A, B or the line ---- */
    let manualPick = null;
    function openManualTeams() {
      const present = presentPlayers();
      if (!present.length) { showToast('Marque quem chegou na Lista primeiro.', 'warning'); switchTab('ficha'); return; }
      manualPick = new Map();
      const { A, B } = state.court;
      present.forEach(p => manualPick.set(p.id, A && A.ids.includes(p.id) ? 'A' : B && B.ids.includes(p.id) ? 'B' : 'Q'));
      renderManualTeams();
      document.getElementById('modal-manual').classList.remove('hidden');
    }
    function closeManualTeams() { manualPick = null; document.getElementById('modal-manual').classList.add('hidden'); }
    function setManual(id, where) { if (manualPick) { manualPick.set(id, where); renderManualTeams(); } }
    function renderManualTeams() {
      const order = [...(state.court.A ? state.court.A.ids : []), ...(state.court.B ? state.court.B.ids : []), ...state.queue];
      const ids = [...manualPick.keys()].sort((x, y) => order.indexOf(x) - order.indexOf(y));
      const count = w => [...manualPick.values()].filter(v => v === w).length;
      const size = teamSize();
      document.getElementById('manual-count').innerHTML =
        `<span class="${count('A') > size ? 'text-warn' : ''}">Time A: ${count('A')}/${size}</span> · <span class="${count('B') > size ? 'text-warn' : ''}">Time B: ${count('B')}/${size}</span> · Fila: ${count('Q')}`;
      document.getElementById('manual-list').innerHTML = ids.map(id => {
        const w = manualPick.get(id);
        const b = (v, label) => `<button onclick="setManual(${id}, '${v}')" class="seg-btn !py-1.5 ${w === v ? 'is-selected' : ''}">${label}</button>`;
        const p = byId(id);
        return `
          <div class="flex items-center gap-2 py-1.5">
            <span class="min-w-0 flex-1"><span class="block text-[14px] font-bold truncate">${p && p.isGoalkeeper ? '🧤 ' : ''}${escapeHtml(nameOf(id))}</span><span class="block text-[11px] text-ink-2">${p ? p.matches || 0 : 0} jogo${p && p.matches === 1 ? '' : 's'} hoje</span></span>
            <div class="seg grid-cols-3 w-[150px] flex-shrink-0">${b('A', 'A')}${b('B', 'B')}${b('Q', 'Fila')}</div>
          </div>`;
      }).join('');
    }
    function saveManualTeams() {
      if (!manualPick) return;
      const pickA = [], pickB = [];
      const order = [...(state.court.A ? state.court.A.ids : []), ...(state.court.B ? state.court.B.ids : []), ...state.queue];
      [...manualPick.keys()].sort((x, y) => order.indexOf(x) - order.indexOf(y)).forEach(id => {
        if (manualPick.get(id) === 'A') pickA.push(id);
        else if (manualPick.get(id) === 'B') pickB.push(id);
      });
      if (!pickA.length && !pickB.length) { showToast('Coloque alguém em pelo menos um time.', 'warning'); return; }
      const prev = [state.court.A, state.court.B].filter(Boolean);
      // Whoever was on court and now goes to the line keeps the front of the line.
      const back = order.filter(id => manualPick.get(id) === 'Q' && !state.queue.includes(id));
      state.queue = [...back, ...state.queue.filter(id => manualPick.get(id) === 'Q')];
      const make = ids => {
        if (!ids.length) return null;
        const same = prev.find(t => idsKey(t.ids) === idsKey(ids));
        return same ? Object.assign({}, same, { ids }) : { label: ++state.teamSeq, ids, streak: 0 };
      };
      state.court = { A: make(pickA), B: make(pickB) };
      if (state.court.A && state.court.B && state.court.A.label === state.court.B.label) state.court.B.label = ++state.teamSeq;
      closeManualTeams();
      commit(state.court.A && state.court.B ? `Times escolhidos: Time ${state.court.A.label} x Time ${state.court.B.label}` : 'Time escolhido.');
    }

    function applySub(inId) {
      if (!subContext) return;
      const { side, outId, dest } = subContext;
      const t = state.court[side];
      const pos = t ? t.ids.indexOf(outId) : -1;
      if (pos < 0) return closeSubModal();
      const qi = inId != null ? state.queue.indexOf(inId) : -1;
      if (inId != null && qi < 0) return closeSubModal();

      if (inId != null) t.ids[pos] = inId;
      else t.ids.splice(pos, 1);

      if (dest === 'swap') {
        if (qi >= 0) state.queue[qi] = outId;
        else state.queue.unshift(outId);
      } else {
        if (qi >= 0) state.queue.splice(qi, 1);
        if (dest === 'end') state.queue.push(outId);
        else { const p = byId(outId); if (p) { p.present = false; p.arrival = null; p.arrivedAt = null; } }
      }

      const label = t.label;
      repair();
      closeSubModal();
      const outName = nameOf(outId);
      const where = dest === 'out' ? 'foi embora' : dest === 'end' ? 'foi pro fim da fila' : (qi >= 0 ? `ficou ${qi + 1}º na fila` : 'foi pro início da fila');
      commit(inId != null ? `${nameOf(inId)} entra no Time ${label}. ${outName} ${where}.` : `${outName} saiu do Time ${label} e ${where}.`);
    }

