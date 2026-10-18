    /* ===================================================================
       NAV & UTILS
       =================================================================== */
    const TURMA_PANES = ['ficha', 'fila', 'placar', 'stats'];
    let lastTurmaPane = 'ficha';
    function updateTurmaPicker() {
      const el = document.getElementById('turmas-picker-name');
      if (!el) return;
      const names = (state.selectedTeams || []).map(id => (turmaById(id) || {}).name).filter(Boolean);
      el.textContent = names.length ? names.join(' + ') : 'Escolher turma';
    }
    function openTurmaHubFromPicker() {
      const t = (state.selectedTeams || []).map(turmaById).find(x => x && x.cloud) || state.turmas.find(x => x.cloud);
      if (t && typeof openTurmaHub === 'function') openTurmaHub(t.id);
      else openDatabaseModal();
    }
    function switchTab(tabName) {
      // "Resumo" now lives inside Stats, under "Times e jogos".
      if (tabName === 'resumo') { tabName = 'stats'; switchStatsView('jogos'); }
      let pane = null;
      if (TURMA_PANES.includes(tabName)) { pane = tabName; lastTurmaPane = pane; tabName = 'turmas'; }
      else if (tabName === 'turmas') pane = lastTurmaPane;
      document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
      document.querySelectorAll('.nav-tab-btn').forEach(btn => btn.classList.toggle('is-active', btn.id === `tab-nav-${tabName}`));
      const content = document.getElementById(`tab-content-${tabName}`);
      if (content) content.classList.remove('hidden');
      if (pane) {
        TURMA_PANES.forEach(n => {
          document.getElementById(`tab-content-${n}`).classList.toggle('hidden', n !== pane);
          document.getElementById(`tab-nav-${n}`).classList.toggle('is-active', n === pane);
        });
        updateTurmaPicker();
        renderVenueUI();
      }
      if (tabName === 'inicio') renderHome();
      if (tabName === 'loja') enterShop();
      window.scrollTo(0, 0);
    }

    function switchStatsView(view) {
      ['atletas', 'jogos'].forEach(v => {
        document.getElementById(`stats-view-${v}`).classList.toggle('hidden', v !== view);
        document.getElementById(`btn-view-${v}`).classList.toggle('is-selected', v === view);
      });
    }

    async function startNewDay() {
      const hasDay = state.matchHistory.length > 0 || state.players.some(hasStats);
      const msg = hasDay
        ? 'Começar um novo baba? O dia de hoje vai pro histórico (aba Stats → Todos os babas) e o placar, a fila e as chegadas são zerados. Turmas e regras ficam.'
        : 'Começar um novo baba? Placar, fila e chegadas são zerados. Turmas e regras ficam.';
      if (!(await askConfirm(msg, 'Novo baba'))) return;
      // Today's list: remember who arrived, so the adm can close it (cumpriu x miou) after the reset.
      const ev = todaysEvent();
      const evClose = ev && ev.status === 'open' && evAdmin(ev) && hasDay
        ? { eventId: ev.id, out: Object.fromEntries((ev.event_rsvps || []).filter(r => r.status === 'vou').map(r => [r.player_key, arrivedToday(r.player_key) ? 'cumpriu' : 'miou'])) } : null;
      pauseMatchTimer();
      endLiveQuiet();
      if (hasDay) {
        const summary = daySummary();
        state.pastDays.unshift(summary);
        enqueueFinish(summary);
      } else if (state.babaId) {
        enqueue({ type: 'baba_delete', id: state.babaId });
      }
      const keep = {
        turmas: state.turmas,
        selectedTeams: state.selectedTeams,
        settings: state.settings,
        players: state.players,
        pastDays: state.pastDays
      };
      const m = state.match;
      state = defaultState();
      Object.assign(state, keep);
      state.match.lineSize = m.lineSize;
      state.match.goalLimitRule = m.goalLimitRule;
      state.match.initialSeconds = m.initialSeconds;
      state.match.secondsLeft = m.initialSeconds;
      state.players.forEach(p => Object.assign(p, { goals: 0, assists: 0, saves: 0, matches: 0, wins: 0, present: false, arrival: null, arrivedAt: null, jumped: false }));
      syncPool();
      commit(hasDay ? 'Dia salvo no histórico da turma. Novo baba: marque quem chegou!' : 'Novo baba! Marque quem chegou na Lista.');
      switchTab('ficha');
      if (evClose && Object.keys(evClose.out).length) {
        closeStash = evClose;
        setTimeout(() => showPopup({ img: 'coach', eyebrow: 'Compromisso', title: 'Fechar a presença?', html: '<p class="text-[15px] leading-relaxed">A lista de hoje ainda está aberta. Já marquei quem chegou (cumpriu) e quem não apareceu (miou) pela Lista de chegada. Confere?</p>',
          ok: 'Conferir agora', onClose: () => openCloseEvent(evClose.eventId) }), 400);
      }
    }

    /* ===================================================================
       BACKUP & IMPORT
       A .json backup still moves data between peladas or keeps a copy
       outside the server. Imports merge (turmas by name, past babas by id)
       and go to the server like any other change.
       =================================================================== */
    let pendingImport = null;

    function openBackupModal() {
      pendingImport = null;
      document.getElementById('import-preview').classList.add('hidden');
      renderPastDays();
      document.getElementById('modal-backup').classList.remove('hidden');
    }

    function closeBackupModal() {
      pendingImport = null;
      document.getElementById('import-file').value = '';
      document.getElementById('modal-backup').classList.add('hidden');
    }

    const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('pt-BR'); };

    function topOf(players, key) {
      const best = [...players].sort((a, b) => (b[key] || 0) - (a[key] || 0))[0];
      return best && best[key] ? best : null;
    }

    function renderPastDays() {
      const list = document.getElementById('past-days-list');
      document.getElementById('past-days-count').innerText = state.pastDays.length ? `${state.pastDays.length} salvo${state.pastDays.length === 1 ? '' : 's'}` : '';
      if (!state.pastDays.length) {
        list.innerHTML = '<p class="text-[12px] text-ink-2 italic">Nenhum ainda. Ao tocar em "Começar novo baba", o dia atual fica guardado aqui.</p>';
        return;
      }
      list.innerHTML = state.pastDays.map(d => {
        const top = topOf(d.players, 'goals');
        return `
          <div class="flex items-center gap-2 p-2.5 rounded-2xl bg-card border border-ink/10">
            <div class="min-w-0 flex-1 cursor-pointer" onclick="closeBackupModal(); openHistory(null, '${d.id}')">
              <span class="block text-[14px] font-bold text-ink truncate">${fmtDate(d.date)} · ${escapeHtml(d.title || 'Baba')}</span>
              <span class="block text-[11px] text-ink-2 truncate">${d.matches || 0} partidas · ${d.players.length} atletas${top ? ` · ${titleFor('goals', top).toLowerCase()} ${escapeHtml(top.name)} (${top.goals})` : ''}</span>
            </div>
            <button onclick="closeBackupModal(); openExportSheet('${d.id}')" class="btn-icon" aria-label="PDF desse baba"><i class="fa-solid fa-file-pdf"></i></button>
            ${d.owner === false ? '' : `<button onclick="deletePastDay('${d.id}')" class="btn-icon !text-danger !bg-danger/10" aria-label="Apagar"><i class="fa-solid fa-xmark"></i></button>`}
          </div>`;
      }).join('');
    }

    /* ---- Babas anteriores: anyone in the turma (dono, adm or membro) sees the list and each baba ---- */
    let historyView = { turma: null, day: null };
    function openHistory(turmaId, dayId) {
      historyView = { turma: turmaId || null, day: dayId || null };
      renderHistory();
      document.getElementById('modal-history').classList.remove('hidden');
      if (cloudOn()) pullCloud(true).then(() => { if (!document.getElementById('modal-history').classList.contains('hidden')) renderHistory(); });
    }
    function closeHistory() { document.getElementById('modal-history').classList.add('hidden'); }
    function historyPdf(id) {
      closeHistory();
      if (!document.getElementById('modal-turma-edit').classList.contains('hidden')) closeTurmaEditor();
      if (typeof closeDatabaseModal === 'function') closeDatabaseModal();
      openExportSheet(id);
    }
    function historyFilter(t) { historyView.turma = t || null; historyView.day = null; renderHistory(); }
    function historyOpenDay(id) { historyView.day = id; renderHistory(); document.getElementById('history-body').scrollTop = 0; }
    const pastOfTurma = tid => state.pastDays.filter(d => !tid || (d.turmaIds || []).includes(tid));
    function renderHistory() {
      const body = document.getElementById('history-body');
      const title = document.getElementById('history-title');
      const d = historyView.day ? state.pastDays.find(x => x.id === historyView.day) : null;
      if (d) {
        title.innerText = d.title || 'Baba';
        ensureGames(d);
        const rows = [...d.players].sort((a, b) => (b.goals || 0) - (a.goals || 0) || (b.assists || 0) - (a.assists || 0) || (b.wins || 0) - (a.wins || 0) || String(a.name).localeCompare(String(b.name)));
        const best = [['goals', 'fa-futbol', 'gols'], ['assists', 'fa-handshake', 'assist.'], ['saves', 'fa-hand', 'def.']].map(([k, ic, l]) => {
          const p = topOf(d.players, k);
          return p ? `<div class="card-flat p-2.5 min-w-0"><p class="text-[11px] font-bold text-ink-2"><i class="fa-solid ${ic} text-pitch mr-1"></i>${titleFor(k, p)}</p><p class="text-[13.5px] font-extrabold truncate mt-0.5">${escapeHtml(p.name)}</p><p class="text-[12px] text-ink-2">${p[k]} ${l}</p></div>` : '';
        }).join('');
        body.innerHTML = `
          <button onclick="historyOpenDay(null)" class="text-[13px] font-bold text-pitch"><i class="fa-solid fa-chevron-left text-[11px]"></i> Todos os babas</button>
          <p class="text-[13px] text-ink-2">${fmtDate(d.date)}${venueTag(d.venue)} · ${d.matches || 0} partida${d.matches === 1 ? '' : 's'} · ${d.players.length} atleta${d.players.length === 1 ? '' : 's'}${d.owner === false ? '' : ' · você organizou'}</p>
          ${best ? `<div class="grid grid-cols-3 gap-2">${best}</div>` : ''}
          <div class="card-flat overflow-hidden">
            <table class="w-full text-[13px]">
              <thead><tr class="text-[11px] text-ink-2 font-bold"><th class="text-left py-2 pl-3">Atleta</th><th class="w-8">G</th><th class="w-8">A</th><th class="w-8">D</th><th class="w-8">J</th><th class="w-8 pr-2">V</th></tr></thead>
              <tbody>${rows.map(p => `<tr class="border-t border-ink/[0.07]"><td class="py-2 pl-3 pr-1 max-w-0 truncate font-semibold">${escapeHtml(p.name)}</td><td class="text-center font-extrabold text-pitch">${p.goals || 0}</td><td class="text-center">${p.assists || 0}</td><td class="text-center">${p.saves || 0}</td><td class="text-center">${p.matches || 0}</td><td class="text-center pr-2">${p.wins || 0}</td></tr>`).join('')}</tbody>
            </table>
          </div>
          ${gamesBlockHtml(d)}
          <div class="flex gap-2">
            <button onclick="historyPdf('${d.id}')" class="btn-outline flex-1 h-11 text-[14px]"><i class="fa-solid fa-file-pdf"></i> PDF desse baba</button>
            ${d.owner === false ? '' : `<button onclick="deletePastDay('${d.id}')" class="btn-icon !w-11 !h-11 !text-danger !bg-danger/10" aria-label="Apagar do histórico"><i class="fa-solid fa-trash-can"></i></button>`}
          </div>`;
        return;
      }
      title.innerText = 'Babas anteriores';
      const turmas = state.turmas.filter(t => state.pastDays.some(x => (x.turmaIds || []).includes(t.id)));
      const list = pastOfTurma(historyView.turma);
      const chips = turmas.length > 1 || historyView.turma ? `<div class="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
          <button onclick="historyFilter(null)" class="chip flex-shrink-0 ${historyView.turma ? '' : 'is-selected'}">Todas</button>
          ${turmas.map(t => `<button onclick="historyFilter('${t.id}')" class="chip flex-shrink-0 ${historyView.turma === t.id ? 'is-selected' : ''}">${escapeHtml(t.name)}</button>`).join('')}</div>` : '';
      body.innerHTML = chips + (list.length ? list.map(x => {
        const top = topOf(x.players, 'goals');
        return `
          <button onclick="historyOpenDay('${x.id}')" class="w-full flex items-center gap-3 p-3 rounded-2xl bg-card border border-ink/10 text-left active:scale-[0.99] transition">
            <span class="tile bg-sunk text-pitch"><i class="fa-solid fa-calendar-check"></i></span>
            <span class="min-w-0 flex-1">
              <span class="block text-[14px] font-bold truncate">${escapeHtml(x.title || 'Baba')}</span>
              <span class="block text-[12px] text-ink-2 truncate">${fmtDate(x.date)} · ${x.matches || 0} partida${x.matches === 1 ? '' : 's'} · ${x.players.length} atleta${x.players.length === 1 ? '' : 's'}${top ? ` · ${titleFor('goals', top).toLowerCase()} ${escapeHtml(top.name)} (${top.goals})` : ''}</span>
            </span>
            <i class="fa-solid fa-chevron-right text-[12px] text-ink-3"></i>
          </button>`;
      }).join('') : `<div class="card-flat p-4 flex items-center gap-3"><img src="babinha/tired.webp" alt="" class="w-14 h-14 object-contain flex-shrink-0" /><p class="text-[13.5px] text-ink-2 leading-snug">Nenhum baba encerrado ainda${historyView.turma ? ' nessa turma' : ''}. Quando quem organiza toca em "Começar novo baba", o dia fica guardado aqui pra turma toda ver.</p></div>`);
    }

    async function deletePastDay(id) {
      const d = state.pastDays.find(x => x.id === id);
      if (!d) return;
      if (d.owner === false) { showToast('Só quem organizou esse baba pode apagar.', 'warning'); return; }
      if (!(await askConfirm(`Apagar o baba de ${fmtDate(d.date)} do histórico? As estatísticas dele saem do acumulado${cloudOn() ? ' de toda a turma' : ''}.`, 'Apagar'))) return;
      state.pastDays = state.pastDays.filter(x => x.id !== id);
      if (isUuid(id)) enqueue({ type: 'baba_delete', id });
      commit('Baba apagado do histórico.');
      renderPastDays();
      if (!document.getElementById('modal-history').classList.contains('hidden')) { historyView.day = null; renderHistory(); }
    }

    function exportBackup() {
      const payload = {
        app: 'BABA',
        kind: 'backup',
        version: STATE_VERSION,
        exportedAt: new Date().toISOString(),
        state: snapshotForUndo()
      };
      offerFile(`BABA_Backup_${todayStamp()}.json`, new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'Backup salvo!');
    }

    function handleImportFile(input) {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          pendingImport = parseImport(String(reader.result || ''), file.name);
          renderImportPreview();
        } catch (e) {
          pendingImport = null;
          document.getElementById('import-preview').classList.add('hidden');
          showToast(e.message || 'Não consegui ler esse arquivo.', 'warning');
        }
        input.value = '';
      };
      reader.onerror = () => { showToast('Não consegui abrir o arquivo.', 'warning'); input.value = ''; };
      reader.readAsText(file);
    }

    function fileBaseName(filename) {
      return String(filename || 'Turma importada').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Turma importada';
    }

    function splitCsvLine(line, sep) {
      const out = [];
      let cur = '', q = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) {
          if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (c === '"') q = false;
          else cur += c;
        } else if (c === '"') q = true;
        else if (c === sep) { out.push(cur); cur = ''; }
        else cur += c;
      }
      out.push(cur);
      return out.map(s => s.trim());
    }

    /* Normalizes any accepted file into {kind, label, turmas, days, full}. */
    function parseImport(text, filename) {
      text = text.replace(/^﻿/, '');
      const trimmed = text.trim();
      if (!trimmed) throw new Error('O arquivo está vazio.');

      if (trimmed[0] === '{') {
        let obj;
        try { obj = JSON.parse(trimmed); } catch (e) { throw new Error('Esse .json não é um backup válido.'); }
        const raw = obj && obj.app === 'BABA' && obj.state ? obj.state : obj;
        if (!raw || (!Array.isArray(raw.turmas) && !Array.isArray(raw.players))) throw new Error('Esse .json não é um backup do BABA.');
        const data = migrate(raw);
        const exportedAt = obj.exportedAt || new Date().toISOString();
        const days = [...data.pastDays];
        // The file's own day (if it had games) comes in as a past baba.
        const hasDay = data.matchHistory.length || data.players.some(hasStats);
        if (hasDay) {
          days.push({
            id: 'imp_' + exportedAt,
            date: exportedAt,
            title: data.selectedTeams.map(id => (data.turmas.find(t => t.id === id) || {}).name).filter(Boolean).join(' + ') || 'Baba importado',
            matches: data.matchHistory.length,
            players: data.players.filter(hasStats).map(p => {
              const row = { name: p.name };
              STAT_KEYS.forEach(k => { row[k] = p[k] || 0; });
              return row;
            })
          });
        }
        return {
          kind: 'backup',
          label: `Backup do BABA · ${fmtDate(exportedAt)}`,
          turmas: data.turmas.map(t => ({ name: t.name, players: t.players, keepers: t.keepers })),
          days,
          todayMatches: data.matchHistory.length,
          full: data
        };
      }

      const lines = trimmed.split(/\r?\n/).filter(l => l.trim());
      const sep = lines[0].includes(';') ? ';' : (lines[0].includes(',') && /atleta/i.test(lines[0]) ? ',' : null);
      if (sep && /atleta/i.test(lines[0])) {
        const head = splitCsvLine(lines[0], sep).map(h => h.toLowerCase());
        const col = name => head.findIndex(h => h.startsWith(name));
        const ci = { name: col('atleta'), turma: col('turma'), pos: col('posi'), goals: col('gols'), assists: col('assist'), saves: col('defesa'), matches: col('jogos'), wins: col('vit') };
        const fallback = fileBaseName(filename);
        const turmaMap = new Map();
        const players = [];
        lines.slice(1).forEach(line => {
          const cells = splitCsvLine(line, sep);
          const name = (cells[ci.name] || '').trim();
          if (!name) return;
          let tName = ci.turma >= 0 ? (cells[ci.turma] || '').trim() : '';
          if (!tName || /^(avulso|convidado)/i.test(tName)) tName = fallback;
          if (!turmaMap.has(tName)) turmaMap.set(tName, { name: tName, players: [], keepers: [] });
          const t = turmaMap.get(tName);
          if (!t.players.some(n => sameName(n, name))) t.players.push(name);
          if (ci.pos >= 0 && /goleiro/i.test(cells[ci.pos] || '')) t.keepers.push(name);
          const row = { name };
          STAT_KEYS.forEach(k => { row[k] = ci[k] >= 0 ? (parseInt(cells[ci[k]], 10) || 0) : 0; });
          if (STAT_KEYS.some(k => row[k])) players.push(row);
        });
        if (!turmaMap.size) throw new Error('Não achei nenhum atleta na planilha.');
        const dateMatch = String(filename).match(/(\d{4})-(\d{2})-(\d{2})/);
        const date = dateMatch ? new Date(+dateMatch[1], +dateMatch[2] - 1, +dateMatch[3], 12).toISOString() : new Date().toISOString();
        const days = players.length ? [{
          id: 'csv_' + filename + '_' + players.reduce((n, p) => n + p.goals + p.matches, 0),
          date, title: [...turmaMap.keys()].join(' + '),
          // The sheet has no match count; the busiest player is the best lower bound.
          matches: players.reduce((n, p) => Math.max(n, p.matches), 0),
          players
        }] : [];
        return { kind: 'csv', label: `Planilha · ${filename}`, turmas: [...turmaMap.values()], days, full: null };
      }

      const names = parseNames(trimmed);
      if (!names.length) throw new Error('Não achei nomes nesse arquivo.');
      return { kind: 'names', label: `Lista de nomes · ${filename}`, turmas: [{ name: fileBaseName(filename), players: names, keepers: [] }], days: [], full: null };
    }

    function renderImportPreview() {
      const box = document.getElementById('import-preview');
      const imp = pendingImport;
      if (!imp) { box.classList.add('hidden'); return; }
      const nPlayers = imp.turmas.reduce((n, t) => n + t.players.length, 0);
      const newTurmas = imp.turmas.filter(t => !state.turmas.some(x => sameName(x.name, t.name))).length;
      const newDays = imp.days.filter(d => !state.pastDays.some(x => x.id === d.id)).length;
      const lines = [];
      lines.push(`${imp.turmas.length} turma${imp.turmas.length === 1 ? '' : 's'} (${nPlayers} atletas)${newTurmas < imp.turmas.length ? ` · ${imp.turmas.length - newTurmas} com nome igual a uma sua: os atletas são somados` : ''}`);
      if (imp.days.length) lines.push(`${imp.days.length} baba${imp.days.length === 1 ? '' : 's'} com estatísticas${newDays < imp.days.length ? ` (${imp.days.length - newDays} já importado${imp.days.length - newDays === 1 ? '' : 's'})` : ''}`);

      box.innerHTML = `
        <div>
          <p class="text-[15px] font-bold">${escapeHtml(imp.label)}</p>
          ${lines.map(l => `<p class="text-[13px] text-ink-2 leading-snug">${escapeHtml(l)}</p>`).join('')}
        </div>
        ${imp.kind === 'names' ? `
          <label class="block">
            <span class="label">Nome da turma</span>
            <input type="text" id="import-turma-name" class="field" value="${escapeHtml(imp.turmas[0].name)}" />
          </label>` : ''}
        <button onclick="applyImport('merge')" class="btn-primary w-full h-12 text-[14px]">
          ${imp.kind === 'names' ? 'Criar turma com esses nomes' : 'Juntar turmas e estatísticas'}
        </button>
        ${imp.full && !cloudOn() ? `<button onclick="applyImport('replace')" class="btn-danger w-full h-11 text-[14px]">Substituir tudo por este backup</button>` : ''}
        <button onclick="pendingImport=null; renderImportPreview()" class="w-full py-2 text-[13px] font-bold text-ink-2">Cancelar</button>`;
      box.classList.remove('hidden');
    }

    function mergeTurmas(list) {
      const res = { created: 0, updated: 0, names: 0 };
      list.forEach(t => {
        const name = String(t.name || 'Turma importada').trim();
        let ex = state.turmas.find(x => sameName(x.name, name) && canEditTurma(x));
        if (!ex) {
          ex = { id: uuid(), name, official: false, cloud: cloudOn(), role: 'owner', invite: null, players: [], keepers: [], meta: {} };
          state.turmas.push(ex);
          res.created++;
        } else {
          res.updated++;
        }
        const before = ex.players.length + '|' + ex.keepers.length;
        (t.players || []).forEach(n => {
          const nm = String(n).trim();
          if (nm && !ex.players.some(x => sameName(x, nm))) { ex.players.push(nm); res.names++; }
        });
        (t.keepers || []).forEach(n => { if (!ex.keepers.some(x => sameName(x, n))) ex.keepers.push(n); });
        if (before !== ex.players.length + '|' + ex.keepers.length || res.created) markTurmaDirty(ex.id);
        res.ids = (res.ids || []).concat(ex.id);
      });
      return res;
    }

    async function applyImport(mode) {
      const imp = pendingImport;
      if (!imp) return;

      if (mode === 'replace' && cloudOn()) return;
      if (mode === 'replace') {
        if (!(await askConfirm('Substituir TUDO deste aparelho pelo backup? Turmas, histórico e o baba de hoje daqui serão trocados pelos do arquivo.', 'Substituir'))) return;
        pauseMatchTimer();
        state = migrate(JSON.parse(JSON.stringify(imp.full)));
        state.match.isRunning = false;
        state.match.endAt = null;
        state.lastFinish = null;
        repair();
        pendingImport = null;
        commit('Backup restaurado!');
        renderImportPreview();
        renderPastDays();
        return;
      }

      if (imp.kind === 'names') {
        const input = document.getElementById('import-turma-name');
        const nm = input && input.value.trim();
        if (nm) imp.turmas[0].name = nm;
      }
      const r = mergeTurmas(imp.turmas);
      let days = 0;
      imp.days.forEach(d => {
        // Stable ids: importing the same file again doesn't duplicate babas.
        const id = cloudOn() ? uuidFromString(`${currentUser.id}|${d.id}`) : d.id;
        if (state.pastDays.some(x => x.id === id)) return;
        const day = Object.assign({}, d, { id, owner: true, turmaIds: r.ids || [] });
        state.pastDays.push(day);
        enqueueFinish(day);
        days++;
      });
      state.pastDays.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      syncPool();
      pendingImport = null;

      const parts = [];
      if (r.created) parts.push(`${r.created} turma${r.created === 1 ? '' : 's'} nova${r.created === 1 ? '' : 's'}`);
      if (r.updated) parts.push(`${r.updated} atualizada${r.updated === 1 ? '' : 's'}`);
      if (r.names) parts.push(`${r.names} atleta${r.names === 1 ? '' : 's'}`);
      if (days) parts.push(`${days} baba${days === 1 ? '' : 's'} no histórico`);
      commit(parts.length ? `Importado: ${parts.join(' · ')}` : 'Nada novo: tudo já estava aqui.');
      renderImportPreview();
      renderPastDays();
    }

    /* Throws away today's baba without saving it to the history. Turmas and history stay. */
    async function confirmResetAllData() {
      if (!(await askConfirm('Zerar o baba de hoje sem salvar no histórico? Chegadas, times, placar e estatísticas de hoje somem. Turmas e babas anteriores ficam.', 'Zerar'))) return;
      pauseMatchTimer();
      if (state.live && state.live.id) enqueue({ type: 'live_settle', liveId: state.live.id, matchNo: state.matchHistory.length + 1, result: { void: true } });
      endLiveQuiet();
      if (state.babaId) enqueue({ type: 'baba_delete', id: state.babaId });
      const keep = { turmas: state.turmas, selectedTeams: state.selectedTeams, settings: state.settings, pastDays: state.pastDays, players: state.players };
      const m = state.match;
      state = defaultState();
      Object.assign(state, keep);
      ['lineSize', 'goalLimitRule', 'initialSeconds'].forEach(k => { state.match[k] = m[k]; });
      state.match.secondsLeft = m.initialSeconds;
      state.players.forEach(p => Object.assign(p, { goals: 0, assists: 0, saves: 0, matches: 0, wins: 0, present: false, arrival: null, arrivedAt: null, jumped: false }));
      syncPool();
      commit('Baba de hoje zerado.');
    }

    let confirmResolver = null;

    function askConfirm(message, okLabel = 'Confirmar') {
      if (confirmResolver) confirmResolver(false);
      document.getElementById('modal-confirm-text').innerText = message;
      document.getElementById('modal-confirm-ok').innerText = okLabel;
      // Babinha shows the card for anything that removes or ends something.
      const harsh = /^(Excluir|Apagar|Remover|Zerar|Tirar|Desconectar|Desligar|Sair|Desfazer tudo)/i.test(okLabel);
      document.getElementById('modal-confirm-img').src = `babinha/${harsh ? 'red' : 'worried'}.webp`;
      document.getElementById('modal-confirm-ok').className = `${harsh ? 'btn-danger' : 'btn-primary'} flex-1 h-12 text-[14px]`;
      document.getElementById('modal-confirm').classList.remove('hidden');
      return new Promise(resolve => { confirmResolver = resolve; });
    }

    function resolveConfirm(answer) {
      document.getElementById('modal-confirm').classList.add('hidden');
      const r = confirmResolver;
      confirmResolver = null;
      if (r) r(answer);
    }

    function showToast(message, type = 'success', action) {
      const container = document.getElementById('toast-container');
      while (container.children.length >= 3) container.firstChild.remove();

      const toast = document.createElement('div');
      const style = type === 'warning'
        ? 'bg-[#4A3208] text-[#FFE7B0]'
        : 'bg-pitch text-butter';
      toast.className = `px-4 py-3 rounded-2xl shadow-xl text-[14px] font-semibold flex items-center gap-2.5 pointer-events-auto transition-opacity duration-200 animate-toast ${style}`;
      toast.innerHTML = `<i class="fa-solid ${type === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-check'} flex-shrink-0"></i><span class="flex-1 min-w-0">${escapeHtml(message)}</span>`;

      if (action) {
        const btn = document.createElement('button');
        btn.className = 'px-3 py-1.5 rounded-full bg-butter text-pitch text-[12px] font-extrabold flex-shrink-0';
        btn.innerText = action.label;
        btn.onclick = () => { toast.remove(); action.fn(); };
        toast.appendChild(btn);
      }

      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 250);
      }, action ? 6000 : 2600);
    }

    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
