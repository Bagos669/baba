    /* ===================================================================
       COMPROMISSO (v11)
       An adm "puxa a lista" for a day and a place; members answer Vou /
       Talvez / Não (in the app, the chat card or the pop-up), lists pasted
       from the group chat are matched to the turma's names, the arrival
       list shows who "marcou que vem", and at the end the adm closes the
       list: cumpriu x miou. Misses lead to warnings, lower priority and a
       block (automatic, if the turma wants), and a ban suggestion that only
       an adm can carry out. Rules and levels live on the server.
       =================================================================== */
    let eventsCache = [];          // upcoming and recent lists of my turmas, each with its rsvps
    let eventsOff = null;          // true = server without v11
    let eventsAt = 0;
    const disciplineCache = new Map();   // turmaId -> { at, rows: Map(key -> row) }
    const LEVEL_LABEL = { aviso: 'Aviso', prioridade: 'Baixa prioridade', bloqueio: 'Bloqueado', banimento: 'Banimento sugerido' };
    const LEVEL_CLS = { aviso: 'bg-butter text-pitch', prioridade: 'bg-warn/15 text-warn', bloqueio: 'bg-danger/10 text-danger', banimento: 'bg-danger text-white' };
    const ANSWER_LABEL = { vou: 'Vou', talvez: 'Talvez', nao: 'Não vou' };
    const OUTCOME_LABEL = { cumpriu: 'Compromisso cumprido', miou: 'Miou', justificado: 'Justificou' };
    const keyOf = n => String(n || '').trim().toLowerCase();
    const isMissingTable = e => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /could not find the table|does not exist/i.test(String(e.message || '')));

    function evWhen(e, long) {
      const d = new Date(e.starts_at);
      const day = d.toLocaleDateString('pt-BR', long ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '');
      const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const today = new Date(); const tm = new Date(Date.now() + 864e5);
      const same = (a, b) => a.toDateString() === b.toDateString();
      const label = same(d, today) ? 'Hoje' : same(d, tm) ? 'Amanhã' : day.charAt(0).toUpperCase() + day.slice(1);
      return `${label} · ${time}`;
    }
    const evTurma = e => turmaById(e.turma_id) || { name: 'Turma' };
    const evAdmin = e => canEditTurma(turmaById(e.turma_id));
    const evUpcoming = e => e.status === 'open' && new Date(e.starts_at).getTime() > Date.now() - 4 * 3600e3;
    function myPlayerIn(turmaId) {
      const t = turmaById(turmaId);
      if (!t || !currentUser) return null;
      const hit = Object.entries(t.meta || {}).find(([, m]) => m && m.userId === currentUser.id);
      return hit ? { key: hit[0], id: hit[1].id, name: (t.players || []).find(n => keyOf(n) === hit[0]) || hit[0] } : null;
    }
    const rsvpOf = (e, key) => (e.event_rsvps || []).find(r => r.player_key === key) || null;
    function levelOf(turmaId, key) {
      const d = disciplineCache.get(turmaId);
      const r = d && d.rows.get(key);
      return r && r.level && r.level !== 'ok' ? r.level : null;
    }
    function levelTag(turmaId, key, adm) {
      let l = levelOf(turmaId, key);
      if (!l) return '';
      if (l === 'banimento' && !adm) l = 'bloqueio';   // only adms see the ban suggestion
      return `<span class="ev-tag ${LEVEL_CLS[l]}">${LEVEL_LABEL[l]}</span>`;
    }

    /* Who is in, in order: answered first, but anyone with low priority (or worse) goes after; past the max, waiting list. */
    function evLines(e) {
      const rows = e.event_rsvps || [];
      const rank = r => { const l = levelOf(e.turma_id, r.player_key); return l && ['prioridade', 'bloqueio', 'banimento'].includes(l) ? 1 : 0; };
      const vou = rows.filter(r => r.status === 'vou').sort((a, b) => rank(a) - rank(b) || String(a.created_at).localeCompare(String(b.created_at)));
      const max = e.max_players || 0;
      return {
        vou: max ? vou.slice(0, max) : vou, espera: max ? vou.slice(max) : [],
        talvez: rows.filter(r => r.status === 'talvez'), nao: rows.filter(r => r.status === 'nao'),
        semResposta: ((turmaById(e.turma_id) || {}).players || []).filter(n => !rsvpOf(e, keyOf(n)))
      };
    }

    async function loadEvents(force) {
      if (!cloudOn() || v7 !== true || eventsOff === true || !api.events) return;
      if (!force && Date.now() - eventsAt < 25000) return;
      eventsAt = Date.now();
      const ids = state.turmas.filter(t => t.cloud).map(t => t.id);
      if (!ids.length) { eventsCache = []; renderEventsEverywhere(); return; }
      try {
        eventsCache = (await api.events(ids)) || [];
        eventsOff = false;
      } catch (e) {
        if (isMissingTable(e) || isMissingFn(e)) eventsOff = true;
        return;
      }
      const turmasWithLists = [...new Set(eventsCache.map(e => e.turma_id))];
      await Promise.all([...turmasWithLists.map(t => loadDiscipline(t)), ensurePeople(eventsCache.map(e => e.created_by).filter(Boolean))]);
      renderEventsEverywhere();
      maybePopups();
    }
    async function loadDiscipline(turmaId, force) {
      const c = disciplineCache.get(turmaId);
      if (!force && c && Date.now() - c.at < 60000) return c;
      try {
        const rows = (await api.discipline(turmaId)) || [];
        const d = { at: Date.now(), rows: new Map(rows.map(r => [r.player_key, r])) };
        disciplineCache.set(turmaId, d);
        return d;
      } catch (e) { return c || null; }
    }
    function renderEventsEverywhere() {
      renderHomeEvents();
      if (document.getElementById('modal-event') && !document.getElementById('modal-event').classList.contains('hidden')) renderEventSheet();
      if (editingTurmaId) renderTurmaEvents();
      if (typeof renderSheetTable === 'function' && state.players.length) renderSheetTable();
      document.querySelectorAll('.chat-box').forEach(b => { if (b.__chat && b.__chat.repaint) b.__chat.repaint(); });
    }

    /* ---- Início: próximos babas ---- */
    function renderHomeEvents(noCounts) {
      if (!noCounts) renderHomeExplore();
      const box = document.getElementById('home-events');
      if (!box) return;
      const list = eventsCache.filter(evUpcoming).sort((a, b) => a.starts_at.localeCompare(b.starts_at)).slice(0, 3);
      if (!list.length) { box.innerHTML = ''; return; }
      box.innerHTML = `
        <section>
          <p class="eyebrow">Compromisso</p>
          <h2 class="title mt-0.5 mb-3">Próximos babas</h2>
          <div class="space-y-2.5">${list.map(eventCardHtml).join('')}</div>
        </section>`;
      if (!noCounts) loadPropCounts(list.map(e => e.id));
    }
    function eventCardHtml(e) {
      const me = myPlayerIn(e.turma_id);
      const mine = me ? rsvpOf(e, me.key) : null;
      const lines = evLines(e);
      const count = `${lines.vou.length}${e.max_players ? `/${e.max_players}` : ''} vão${lines.talvez.length ? ` · ${lines.talvez.length} talvez` : ''}${lines.espera.length ? ` · ${lines.espera.length} na espera` : ''}`;
      const btn = (a, label) => `<button onclick="event.stopPropagation(); answerEvent('${e.id}', '${a}')" class="ev-ans ${mine && mine.status === a ? 'is-on ev-' + a : ''}">${label}</button>`;
      return `
        <div class="card p-3.5 cursor-pointer active:scale-[0.99] transition" onclick="openEventSheet('${e.id}')">
          <div class="flex items-start gap-3">
            <span class="tile bg-butter text-pitch flex-shrink-0"><i class="fa-solid fa-clipboard-list"></i></span>
            <div class="min-w-0 flex-1">
              <p class="text-[15px] font-extrabold leading-tight truncate">${escapeHtml(evWhen(e))}</p>
              <p class="text-[12.5px] text-ink-2 truncate">${escapeHtml(evTurma(e).name)}${e.place ? ` · ${escapeHtml(e.place)}` : ''}</p>
              <p class="text-[12.5px] font-bold text-pitch mt-0.5">${count}</p>
            </div>
            <i class="fa-solid fa-chevron-right text-[12px] text-ink-3 mt-1"></i>
          </div>
          ${propChipHtml(e)}
          ${startEventBtnHtml(e)}
          ${me ? `<div class="grid grid-cols-3 gap-1.5 mt-3">${btn('vou', 'Vou')}${btn('talvez', 'Talvez')}${btn('nao', 'Não vou')}</div>`
            : `<p class="text-[12px] text-ink-2 mt-2.5 leading-snug">Pra responder, ligue seu nome na turma (abra a turma e toque no seu nome).</p>`}
        </div>`;
    }

    /* ---- v11.7 · Iniciar o baba direto do compromisso de hoje (só dono e adm) ---- */
    const evIsToday = e => new Date(e.starts_at).toDateString() === new Date().toDateString();
    function babaRunningFor(e) {
      if (state.selectedTeams.includes(e.turma_id) && (hasBabaContent() || state.eventId === e.id)) return { kind: 'local' };
      const sb = typeof sharedRunOfTurma === 'function' ? sharedRunOfTurma(e.turma_id) : null;
      return sb ? { kind: 'shared', id: sb.id } : null;
    }
    function startEventBtnHtml(e) {
      const t = turmaById(e.turma_id);
      if (!t || e.status === 'canceled' || !evIsToday(e) || !canEditTurma(t)) return '';
      const run = babaRunningFor(e);
      return `<button onclick="event.stopPropagation(); startBabaFromEvent('${e.id}')" class="${run ? 'btn-outline' : 'btn-primary'} w-full h-11 text-[14px] mt-3"><i class="fa-solid ${run ? 'fa-arrow-right' : 'fa-play'}"></i> ${run ? 'Abrir baba em andamento' : 'Iniciar esse baba'}</button>`;
    }
    async function startBabaFromEvent(id) {
      const e = eventsCache.find(x => x.id === id);
      if (!e) return;
      const t = turmaById(e.turma_id);
      if (!t || !canEditTurma(t)) { showToast('Só o dono ou um adm da turma inicia o baba.', 'warning'); return; }
      if (e.status === 'canceled' || !evIsToday(e)) { showToast('Esse compromisso não é de hoje ou foi cancelado.', 'warning'); return; }
      const run = babaRunningFor(e);
      if (run && run.kind === 'shared') { openSharedBaba(run.id); return; }
      if (run) { switchTab('ficha'); return; }
      if (!orgOnly()) return;
      if (hasBabaContent()) {
        if (lancesPending()) { showToast('Espere os lances serem enviados antes de trocar de baba.', 'warning'); return; }
        if (!(await askConfirm('Já tem um baba aberto neste aparelho. Ele vai pro histórico e começa o baba dessa lista. Continuar?', 'Iniciar'))) return;
        closeOutBaba(true);
      }
      state.selectedTeams = [e.turma_id];
      state.eventId = e.id;
      syncPool();
      commit(`Baba de ${evWhen(e)} começou! Marque quem chegou na Lista.`);
      switchTab('ficha');
    }

    /* ---- Responder ---- */
    async function answerEvent(id, answer, playerId, name, inviter) {
      const e = eventsCache.find(x => x.id === id);
      if (!e) return;
      try {
        await api.rsvpEvent(id, answer, playerId || null, name || null, inviter || null);
        if (!playerId && !name) lsSet('baba_ev_seen_' + id, '1');
        await loadEvents(true);
        if (!playerId && !name) {
          if (answer === 'vou') showToast('Confirmado! Quer salvar na agenda?', 'success', { label: 'Agenda', fn: () => openEventSheet(id, true) });
          else showToast(answer === 'talvez' ? 'Marcado como talvez.' : 'Beleza, avisado que não vai.');
        }
      } catch (err) {
        const m = String((err && err.message) || '');
        showToast(isNetworkError(err) ? 'Precisa de internet pra responder a lista.' : m.includes('blocked') ? 'Você está bloqueado na lista por faltas. Fale com o adm da turma.'
          : m.includes('no_player') ? 'Ligue seu nome na turma primeiro: abra a turma e toque no seu nome.' : m.includes('closed') ? 'Essa lista já fechou.' : 'Não deu certo. Tente de novo.', 'warning');
      }
    }

    /* ---- A lista (folha do compromisso) ---- */
    let eventOpen = null;
    async function openEventSheet(id, calendar) {
      eventOpen = id;
      let e = eventsCache.find(x => x.id === id);
      if (!e) { await loadEvents(true); e = eventsCache.find(x => x.id === id); }
      if (!e) { showToast('Essa lista não está mais disponível.', 'warning'); return; }
      lsSet('baba_ev_seen_' + id, '1');
      renderEventSheet(calendar);
      document.getElementById('modal-event').classList.remove('hidden');
      loadDiscipline(e.turma_id, true).then(() => { if (eventOpen === id) renderEventSheet(); });
    }
    function closeEventSheet() { document.getElementById('modal-event').classList.add('hidden'); eventOpen = null; }
    function renderEventSheet(calendar) {
      const e = eventsCache.find(x => x.id === eventOpen);
      if (!e) return;
      const adm = evAdmin(e);
      const me = myPlayerIn(e.turma_id);
      const mine = me ? rsvpOf(e, me.key) : null;
      const L = evLines(e);
      const done = e.status === 'done', canceled = e.status === 'canceled';
      document.getElementById('ev-title').innerText = evWhen(e, true);
      document.getElementById('ev-sub').innerText = [evTurma(e).name, e.place].filter(Boolean).join(' · ');
      const row = (r, i) => {
        const tag = done && r.outcome ? `<span class="ev-tag ${r.outcome === 'miou' ? 'bg-danger/10 text-danger' : r.outcome === 'cumpriu' ? 'bg-leaf/10 text-leaf' : 'bg-sunk text-ink-2'}">${OUTCOME_LABEL[r.outcome]}</span>` : '';
        const src = r.source === 'colado' ? '<span class="ev-tag bg-sunk text-ink-2">lista colada</span>' : '';
        return `
          <div class="flex items-center gap-2 py-2 ${adm && !done && !canceled ? 'cursor-pointer' : ''}" ${adm && !done && !canceled ? `onclick="eventRowMenu('${e.id}', ${escapeHtml(JSON.stringify(r.player_key))})"` : ''}>
            ${i != null ? `<span class="w-6 text-right text-[12px] font-bold text-ink-3 flex-shrink-0">${i + 1}.</span>` : ''}
            <span class="min-w-0 flex-1 text-[14px] font-semibold truncate">${escapeHtml(r.name)}${me && r.player_key === me.key ? ' <span class="text-ink-3 font-medium">(você)</span>' : ''}${r.invited_by ? ` <span class="text-ink-3 font-medium text-[12px]">· convidado de ${escapeHtml(firstName(r.invited_by))}</span>` : ''}</span>
            <span class="flex flex-wrap justify-end gap-1 flex-shrink-0">${tag}${levelTag(e.turma_id, r.player_key, adm)}${src}</span>
          </div>`;
      };
      const block = (title, arr, numbered, start = 0) => arr.length ? `
        <div><p class="section-tag">${title}${title.includes('/') ? '' : ` · ${arr.length}`}</p><div class="divide-y divide-ink/[0.07]">${arr.map((r, i) => row(r, numbered ? start + i : null)).join('')}</div></div>` : '';
      const ans = a => `<button onclick="answerEvent('${e.id}', '${a}')" class="ev-ans h-11 ${mine && mine.status === a ? 'is-on ev-' + a : ''}">${ANSWER_LABEL[a]}</button>`;
      const lvl = me ? levelOf(e.turma_id, me.key) : null;
      document.getElementById('ev-body').innerHTML = `
        ${canceled ? '<p class="rounded-2xl bg-danger/10 text-danger text-[13.5px] font-bold p-3">Essa lista foi cancelada.</p>' : ''}
        ${done ? '<p class="rounded-2xl bg-leaf/10 text-leaf text-[13.5px] font-bold p-3"><i class="fa-solid fa-flag-checkered"></i> Presença fechada pelo adm.</p>' : ''}
        ${e.note ? `<p class="text-[13.5px] text-ink-2 leading-snug">${escapeHtml(e.note)}</p>` : ''}
        ${!done && !canceled ? (me ? `<div><p class="label">E aí, ${escapeHtml(firstName(me.name))}?</p><div class="grid grid-cols-3 gap-1.5">${ans('vou')}${ans('talvez')}${ans('nao')}</div>
            ${lvl ? `<p class="text-[12.5px] mt-2 leading-snug ${lvl === 'aviso' ? 'text-ink-2' : 'text-danger'}">${lvl === 'aviso' ? 'Aviso: você tem falta registrada. Mais uma e sua prioridade na lista cai.' : lvl === 'prioridade' ? 'Por faltas, você entra depois de quem confirmou sem faltas.' : 'Por faltas, você não pode confirmar sozinho. Fale com o adm.'}</p>` : ''}</div>`
          : '<p class="text-[13px] text-ink-2">Pra responder, ligue seu nome na turma (abra a turma e toque no seu nome).</p>') : ''}
        <div class="grid grid-cols-2 gap-2 ${calendar ? 'ev-flash' : ''}">
          <button onclick="downloadEventIcs('${e.id}')" class="btn-outline h-11 text-[13px]"><i class="fa-solid fa-calendar-plus"></i> Salvar na agenda</button>
          <a href="${googleCalUrl(e)}" target="_blank" rel="noopener" class="btn-outline h-11 text-[13px] flex items-center justify-center gap-1.5"><i class="fa-solid fa-calendar-days"></i> Google Agenda</a>
        </div>
        ${block(e.max_players ? `Vão (${L.vou.length}/${e.max_players})` : 'Vão', L.vou, true)}
        ${block('Lista de espera', L.espera, true, L.vou.length)}
        ${block('Talvez', L.talvez, false)}
        ${block('Não vão', L.nao, false)}
        ${!done && L.semResposta.length ? `<div><p class="section-tag">Ainda não responderam · ${L.semResposta.length}</p><p class="text-[13px] text-ink-2 leading-relaxed">${L.semResposta.map(n => adm && !canceled ? `<button onclick="eventRowMenu('${e.id}', ${escapeHtml(JSON.stringify(keyOf(n)))})" class="underline decoration-ink/20 underline-offset-2">${escapeHtml(n)}</button>` : escapeHtml(n)).join(', ')}</p></div>` : ''}
        <button onclick="shareEventText('${e.id}')" class="btn-soft w-full h-11 text-[13px]"><i class="fa-solid fa-share-nodes"></i> Mandar a lista no grupo</button>
        ${adm && !canceled ? `<div class="card-flat p-3 space-y-2">
          <p class="text-[12px] font-extrabold uppercase tracking-wider text-ink-2">Adm</p>
          ${!done ? `<div class="grid grid-cols-2 gap-2">
            <button onclick="openPasteList('${e.id}')" class="btn-outline h-11 text-[13px]"><i class="fa-solid fa-paste"></i> Colar lista</button>
            <button onclick="addEventName('${e.id}')" class="btn-outline h-11 text-[13px]"><i class="fa-solid fa-user-plus"></i> Pôr um nome</button>
            <button onclick="openEventEdit('${e.turma_id}', '${e.id}')" class="btn-outline h-11 text-[13px]"><i class="fa-solid fa-pen"></i> Editar</button>
            <button onclick="cancelEvent('${e.id}')" class="btn-outline h-11 text-[13px] !text-danger"><i class="fa-solid fa-ban"></i> Cancelar</button>
          </div>` : ''}
          <button onclick="openCloseEvent('${e.id}')" class="btn-primary w-full h-12 text-[14px]"><i class="fa-solid fa-clipboard-check"></i> ${done ? 'Corrigir presença' : 'Fechar presença (cumpriu x miou)'}</button>
          <button onclick="openRules('${e.turma_id}')" class="w-full text-[12.5px] font-bold text-pitch py-1">Regras de presença e penalidades</button>
        </div>` : ''}`;
    }

    async function eventRowMenu(id, key) {
      const e = eventsCache.find(x => x.id === id);
      if (!e) return;
      const t = turmaById(e.turma_id);
      const r = rsvpOf(e, key);
      const name = r ? r.name : ((t.players || []).find(n => keyOf(n) === key) || key);
      const m = (t.meta || {})[key];
      const row = (fn, ic, label) => `<button onclick="${fn}" class="menu-row rounded-2xl"><span class="tile w-9 h-9 rounded-xl bg-sunk text-pitch text-[14px]"><i class="fa-solid ${ic}"></i></span><span class="flex-1">${label}</span></button>`;
      const args = a => `eventSetFor('${id}', '${a}', ${m ? `'${m.id}'` : 'null'}, ${escapeHtml(JSON.stringify(name))})`;
      document.getElementById('evmenu-title').innerText = name;
      document.getElementById('evmenu-body').innerHTML = `<div class="card-flat overflow-hidden divide-y divide-ink/[0.07]">
        ${row(args('vou'), 'fa-check', 'Vai')}${row(args('talvez'), 'fa-question', 'Talvez')}${row(args('nao'), 'fa-xmark', 'Não vai')}
        ${r ? row(args('tirar'), 'fa-eraser', 'Tirar da lista') : ''}</div>`;
      document.getElementById('modal-evmenu').classList.remove('hidden');
    }
    function closeEvMenu() { document.getElementById('modal-evmenu').classList.add('hidden'); }
    async function eventSetFor(id, answer, playerId, name) {
      closeEvMenu();
      await answerEvent(id, answer, playerId, playerId ? null : name);
    }
    /* Adm adds a name by hand. Someone from outside the turma is a "convidado" and needs to say who invited them. */
    let evNameFor = null;
    function addEventName(id) {
      const e = eventsCache.find(x => x.id === id);
      if (!e) return;
      evNameFor = id;
      document.getElementById('evname-name').value = '';
      document.getElementById('evname-inviter').innerHTML = inviterOptionsHtml(e.turma_id, '');
      document.getElementById('evname-guest').classList.remove('hidden');
      document.getElementById('evname-error').classList.add('hidden');
      document.getElementById('modal-evname').classList.remove('hidden');
      setTimeout(() => { const el = document.getElementById('evname-name'); if (el) el.focus(); }, 80);
    }
    function closeEvName() { document.getElementById('modal-evname').classList.add('hidden'); evNameFor = null; }
    /* Members of the turma, to pick who invited a convidado. */
    function inviterOptionsHtml(turmaId, sel) {
      const players = (turmaById(turmaId) || {}).players || [];
      return `<option value="">Escolha quem convidou</option>` + players.slice().sort((a, b) => a.localeCompare(b, 'pt-BR')).map(n => `<option value="${escapeHtml(n)}" ${sel === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
    }
    function evNameTyped() {
      const e = eventsCache.find(x => x.id === evNameFor);
      if (!e) return;
      const nm = document.getElementById('evname-name').value.trim();
      const isMember = !!nm && !!(turmaById(e.turma_id).meta || {})[keyOf(nm)];
      document.getElementById('evname-guest').classList.toggle('hidden', isMember);
    }
    async function saveEventName() {
      const e = eventsCache.find(x => x.id === evNameFor);
      if (!e) return;
      const name = document.getElementById('evname-name').value.trim();
      if (!name) { showErr('evname-error', 'Escreva o nome.'); return; }
      const m = (turmaById(e.turma_id).meta || {})[keyOf(name)];
      const inviter = m ? '' : document.getElementById('evname-inviter').value;
      if (!m && !inviter) { showErr('evname-error', 'Escolha quem convidou essa pessoa.'); return; }
      const id = evNameFor;
      closeEvName();
      await answerEvent(id, 'vou', m ? m.id : null, m ? null : name.slice(0, 60), inviter);
    }

    /* ---- Puxar / editar a lista ---- */
    let eventEditing = null;   // { turmaId, id }
    function openEventEdit(turmaId, id) {
      const admTurmas = state.turmas.filter(t => t.cloud && canEditTurma(t));
      if (!admTurmas.length) { showToast('Só o dono ou um adm da turma puxa a lista.', 'warning'); return; }
      const t = turmaById(turmaId) && canEditTurma(turmaById(turmaId)) ? turmaById(turmaId) : admTurmas[0];
      eventEditing = { turmaId: t.id, id: id || null };
      const e = id ? eventsCache.find(x => x.id === id) : null;
      const pad = n => String(n).padStart(2, '0');
      const d = e ? new Date(e.starts_at) : (() => { const x = new Date(); x.setDate(x.getDate() + 1); x.setHours(19, 0, 0, 0); return x; })();
      document.getElementById('eve-turma').innerHTML = admTurmas.map(x => `<option value="${x.id}" ${x.id === t.id ? 'selected' : ''}>${escapeHtml(x.name)}</option>`).join('');
      document.getElementById('eve-turma').disabled = !!id;
      document.getElementById('eve-date').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      document.getElementById('eve-time').value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      document.getElementById('eve-place').value = e ? e.place || '' : (lsGet('baba_last_place_' + t.id) || '');
      document.getElementById('eve-max').value = e && e.max_players ? e.max_players : '';
      document.getElementById('eve-note').value = e ? e.note || '' : '';
      document.getElementById('eve-title').innerText = id ? 'Editar a lista' : 'Puxar a lista';
      document.getElementById('eve-save').innerText = id ? 'Salvar' : 'Puxar a lista e avisar a turma';
      document.getElementById('eve-error').classList.add('hidden');
      closeEventSheet();
      document.getElementById('modal-event-edit').classList.remove('hidden');
    }
    /* The hour is typed (a number keyboard), not picked on the phone's wheel: "1930", "19:30" and "19" all work. */
    function maskTime(el) {
      const d = el.value.replace(/\D/g, '').slice(0, 4);
      el.value = d.length > 2 ? d.slice(0, 2) + ':' + d.slice(2) : d;
    }
    function parseTimeInput(v) {
      const d = String(v || '').replace(/\D/g, '');
      if (!d || d.length > 4) return '';
      let h, m;
      if (d.length <= 2) { h = +d; m = 0; } else { h = +d.slice(0, d.length - 2); m = +d.slice(-2); }
      if (h > 23 || m > 59) return '';
      return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }
    function closeEventEdit() { document.getElementById('modal-event-edit').classList.add('hidden'); eventEditing = null; }
    async function saveEventEdit() {
      if (!eventEditing) return;
      const turmaId = document.getElementById('eve-turma').value || eventEditing.turmaId;
      const date = document.getElementById('eve-date').value, time = parseTimeInput(document.getElementById('eve-time').value);
      // The phone's own time zone: the ISO string carries the offset, so everyone sees it in theirs.
      const starts = date && time ? new Date(`${date}T${time}:00`) : null;
      if (!starts || isNaN(starts)) { showErr('eve-error', time === '' ? 'Digite a hora, por exemplo 19:30.' : 'Escolha o dia e a hora.'); return; }
      if (!eventEditing.id && starts.getTime() < Date.now() - 3600e3) { showErr('eve-error', 'Esse horário já passou.'); return; }
      const place = document.getElementById('eve-place').value.trim();
      const maxRaw = parseInt(document.getElementById('eve-max').value, 10);
      const max = Number.isFinite(maxRaw) && maxRaw >= 2 ? Math.min(200, maxRaw) : null;
      const note = document.getElementById('eve-note').value.trim();
      const btn = document.getElementById('eve-save');
      setBusy(btn, true, 'Salvando...');
      try {
        if (eventEditing.id) {
          await api.updateEvent(eventEditing.id, starts.toISOString(), place, note, max || 0, null);
          const id = eventEditing.id;
          closeEventEdit();
          await loadEvents(true);
          openEventSheet(id);
          showToast('Lista atualizada.');
        } else {
          const id = await api.createEvent(turmaId, starts.toISOString(), place, note, max);
          if (place) lsSet('baba_last_place_' + turmaId, place);
          closeEventEdit();
          // v11.4.2: o aviso de lista aberta sai do servidor (Configurações → Avisos no celular); o push do celular de quem puxa saiu para não chegar em dobro.
          await loadEvents(true);
          openEventSheet(id);
          showToast('Lista puxada! A turma recebeu o aviso e o card no chat.');
        }
      } catch (e) {
        const m = String((e && e.message) || '');
        showErr('eve-error', isNetworkError(e) ? 'Precisa de internet.' : m.includes('not_allowed') ? 'Só o dono ou um adm da turma puxa a lista.' : m.includes('limit') ? 'Essa turma já tem listas abertas demais. Feche ou cancele uma.'
          : m.includes('bad_date') ? 'Data fora do prazo (até 120 dias pra frente).' : (isMissingFn(e) || isMissingTable(e)) ? 'A lista chega quando o servidor for atualizado.' : 'Não deu certo. Tente de novo.');
      } finally { if (document.body.contains(btn)) setBusy(btn, false); }
    }
    async function cancelEvent(id) {
      const e = eventsCache.find(x => x.id === id);
      if (!e || !(await askConfirm(`Cancelar a lista de ${evWhen(e).toLowerCase()}? Quem confirmou é avisado.`, 'Cancelar lista'))) return;
      try {
        await api.updateEvent(id, null, null, null, null, 'canceled');
        eventPush(e, 'event_cancel', `❌ Cancelado: baba de ${evWhen(e).toLowerCase()}`, `${evTurma(e).name}${e.place ? ' · ' + e.place : ''}`);
        await loadEvents(true);
        showToast('Lista cancelada.');
      } catch (err) { showToast(isNetworkError(err) ? 'Precisa de internet.' : 'Não deu certo agora.', 'warning'); }
    }
    function eventPush(e, kind, title, body) {
      (async () => {
        try {
          if (window.__BABA_FAKE_API__ && window.__BABA_FAKE_API__.livePush) { await api.livePush(null, null, kind, `${kind}-${e.id}`, title, body, e.id); return; }
          const session = await api.getSession();
          if (!session) return;
          await fetch(LIVE_PUSH_FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: 'Bearer ' + session.access_token },
            body: JSON.stringify({ event_id: e.id, kind, key: `${kind}-${e.id}`, title, body }) });
        } catch (err) {}
      })();
    }

    /* ---- Agenda do celular: um .ics (iPhone, Android, Outlook) ou o link do Google Agenda ---- */
    const icsDate = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const icsEsc = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
    function eventEnd(e) { return new Date(new Date(e.starts_at).getTime() + 2 * 3600e3); }
    function downloadEventIcs(id) {
      const e = eventsCache.find(x => x.id === id);
      if (!e) return;
      const title = `Baba · ${evTurma(e).name}`;
      const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BABA//Compromisso//PT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
        `UID:${e.id}@baba`, `DTSTAMP:${icsDate(Date.now())}`, `DTSTART:${icsDate(e.starts_at)}`, `DTEND:${icsDate(eventEnd(e))}`,
        `SUMMARY:${icsEsc(title)}`, e.place ? `LOCATION:${icsEsc(e.place)}` : '', `DESCRIPTION:${icsEsc((e.note ? e.note + '\n' : '') + 'Lista no app BABA')}`,
        'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(title)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
      offerFile(`baba-${new Date(e.starts_at).toISOString().slice(0, 10)}.ics`, new Blob([ics], { type: 'text/calendar' }), 'Abra o arquivo pra salvar na agenda.');
    }
    function googleCalUrl(e) {
      const p = new URLSearchParams({ action: 'TEMPLATE', text: `Baba · ${evTurma(e).name}`, dates: `${icsDate(e.starts_at)}/${icsDate(eventEnd(e))}`, details: (e.note ? e.note + '\n' : '') + 'Lista no app BABA', location: e.place || '' });
      return 'https://calendar.google.com/calendar/render?' + p.toString();
    }

    /* ---- Mandar a lista no grupo (texto pronto) ---- */
    function shareEventText(id) {
      const e = eventsCache.find(x => x.id === id);
      if (!e) return;
      const L = evLines(e);
      const lines = [`⚽ *Baba ${evTurma(e).name}*`, `🗓️ ${evWhen(e, true)}${e.place ? `\n📍 ${e.place}` : ''}`, ''];
      L.vou.forEach((r, i) => lines.push(`${i + 1}. ${r.name}${r.invited_by ? ` (conv. ${firstName(r.invited_by)})` : ''}`));
      if (L.espera.length) { lines.push('', '⏳ Lista de espera'); L.espera.forEach((r, i) => lines.push(`${L.vou.length + i + 1}. ${r.name}`)); }
      if (L.talvez.length) { lines.push('', '🤔 Talvez'); L.talvez.forEach(r => lines.push(`- ${r.name}`)); }
      lines.push('', 'Confirma no app BABA 👉 ' + location.origin + location.pathname);
      const text = lines.join('\n');
      if (navigator.share) { navigator.share({ text }).catch(() => {}); return; }
      copyText(text, null, 'Lista copiada. Cola no grupo!');
    }

    /* ---- Colar lista do grupo ---- */
    const normName = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    function levenshtein(a, b) {
      if (a === b) return 0;
      const v = Array.from({ length: b.length + 1 }, (_, i) => i);
      for (let i = 1; i <= a.length; i++) {
        let prev = v[0]; v[0] = i;
        for (let j = 1; j <= b.length; j++) { const cur = v[j]; v[j] = Math.min(v[j] + 1, v[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
      }
      return v[b.length];
    }
    /* Reads a list pasted from the group chat. Handles numbering (1-, 01., 1) ), bullets and emojis,
       sections ("Não vão", "Talvez", "Lista de espera"), notes after the name ("Zé - pago", "Beto (gol)"),
       and skips header lines (date, place, price, Pix, links). Falls back to commas if there are no lines. */
    function parsePastedList(text) {
      const out = [], seen = new Set();
      let section = 'vou';
      const HEAD_NAO = /^(nao (vao|vou|vai|podem)|fora|ausentes?|desfalques?|baixas?|nao confirmados?)\b/;
      const HEAD_TALVEZ = /^(talvez|duvidas?|a confirmar|incertos?)\b/;
      const HEAD_VOU = /^(confirmados?|lista|vao|presentes?|jogadores|linha|goleiros?|lista de espera|espera|reservas?|suplentes?)\b/;
      const SKIP = /(r\$|\bpix\b|https?:|www\.|\bvalor\b|\bhorario\b|\bendereco\b|\blocal\b|\bquadra\b|\bcampo\b|\bdia\b|\bdata\b|\bhoras?\b|\bobs\b|\d{1,2}[\/:h]\d{2})/;
      const add = (raw, st, marked) => {
        let s = raw.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, ' ');
        s = s.replace(/^\s*(?:\d{1,3}\s*[-–.)º°:ª]+|\d{1,3}\s+(?=\D)|[-*•·▪>]+)\s*/u, '');
        let status = st;
        const n0 = normName(s);
        if (/\b(nao vai|nao vou|desisti|saiu)\b/.test(n0) || /\(\s*fora\s*\)/i.test(s)) status = 'nao';
        else if (/\b(talvez|duvida)\b/.test(n0) || /\?\s*$/.test(s)) status = 'talvez';
        s = s.replace(/\((?:[^)]*)\)/g, ' ').replace(/\s[-–—|:]\s.*$/, ' ').replace(/\b(talvez|nao vai|nao vou|confirmado|ok|pago|pix|gol|goleiro|gk)\b/gi, ' ').replace(/[?!.,;]+$/, '');
        s = s.replace(/\s+/g, ' ').trim();
        const n = normName(s);
        if (!n || n.length < 2 || s.length > 40 || /^\d+$/.test(n)) return;
        if (!marked && n.split(' ').length > 4) return;
        if (seen.has(n)) return;
        seen.add(n);
        out.push({ name: s, status });
      };
      const lines = String(text || '').split(/\r?\n/);
      lines.forEach(line => {
        const raw = line.trim();
        if (!raw) return;
        const plain = normName(raw.replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, ''));
        // Numbers and bullets mark a list line; a leading emoji only does if the line isn't a header (date, place, price...).
        const numbered = /^\s*(?:\d{1,3}\s*[-–.)º°:ª]|[-*•·▪>]|\d\uFE0F?\u20E3)/u.test(raw);
        const emojiLed = !numbered && /^\s*[\p{Extended_Pictographic}]/u.test(raw);
        if (emojiLed && (SKIP.test(plain) || /^(baba|pelada|fut|futebol|bora|galera)\b/.test(plain))) return;
        const marked = numbered || emojiLed;
        if (!numbered && (raw.match(/,/g) || []).length >= 2) { raw.split(/[,;]/).forEach(x => add(x, section, true)); return; }
        const header = !marked && (/:\s*$/.test(raw) || plain.split(' ').length <= 4);
        if (header && HEAD_NAO.test(plain)) { section = 'nao'; return; }
        if (header && HEAD_TALVEZ.test(plain)) { section = 'talvez'; return; }
        if (header && HEAD_VOU.test(plain) && (/:\s*$/.test(raw) || plain.split(' ').length <= 3)) { section = 'vou'; return; }
        if (!marked && (SKIP.test(plain) || /^(baba|pelada|fut|futebol|bora|galera)\b/.test(plain))) return;
        if (!marked && /:\s*$/.test(raw)) return;
        if (/❌/.test(raw)) return add(raw, 'nao', true);
        add(raw, section, marked);
      });
      if (!out.length && /[,;]/.test(text || '')) String(text).split(/[,;]/).forEach(p => add(p, 'vou', true));
      return out;
    }
    /* Best player of the turma for a pasted name. Exact > nickname in quotes > first name (if only one
       has it) > close spelling. Returns { key, score } or null when unsure. */
    function matchTurmaName(name, players) {
      const n = normName(name);
      if (!n) return null;
      const scored = players.map(p => {
        const pn = normName(p);
        let s = 0;
        if (pn === n) s = 1;
        else {
          const nick = (String(p).match(/["“”']([^"“”']+)["“”']/) || [])[1];
          if (nick && normName(nick) === n) s = 0.97;
          const words = pn.split(' ');
          if (!s && words.join(' ').startsWith(n + ' ') && n.length >= 3) s = 0.86;
          if (!s && n.includes(' ') && pn.includes(n)) s = 0.88;
          const dist = levenshtein(n, pn);
          const ratio = 1 - dist / Math.max(n.length, pn.length);
          if (ratio >= 0.8) s = Math.max(s, ratio * 0.95);
          if (!s && words[0] === n.split(' ')[0] && n.split(' ')[0].length >= 3) s = 0.7;
        }
        return { key: keyOf(p), name: p, s };
      }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
      if (!scored.length) return null;
      const best = scored[0], second = scored[1];
      if (best.s < 0.75 && !(best.s >= 0.7 && !second)) return null;
      if (second && second.s >= best.s - 0.04 && best.s < 1) return null;
      return best;
    }
    let pasteState = null;   // { eventId, rows: [{ name, status, pick }] }
    function openPasteList(id) {
      pasteState = { eventId: id, rows: [] };
      document.getElementById('paste-text').value = '';
      document.getElementById('paste-preview').innerHTML = '';
      document.getElementById('paste-confirm').classList.add('hidden');
      closeEventSheet();
      eventOpen = id;
      document.getElementById('modal-paste').classList.remove('hidden');
    }
    function closePasteList() { document.getElementById('modal-paste').classList.add('hidden'); const id = pasteState && pasteState.eventId; pasteState = null; if (id) openEventSheet(id); }
    function readPastedList() {
      const e = eventsCache.find(x => x.id === (pasteState && pasteState.eventId));
      if (!e) return;
      const players = (turmaById(e.turma_id) || {}).players || [];
      const parsed = parsePastedList(document.getElementById('paste-text').value);
      if (!parsed.length) { showToast('Não achei nomes nesse texto. Cole a lista com um nome por linha.', 'warning'); return; }
      const used = new Set();
      pasteState.rows = parsed.map(r => {
        const m = matchTurmaName(r.name, players.filter(p => !used.has(keyOf(p))));
        if (m) used.add(m.key);
        return { name: r.name, status: r.status, pick: m ? m.key : '__guest', inviter: '', sure: !!m && m.s >= 0.95 };
      });
      renderPastePreview();
    }
    function renderPastePreview() {
      const e = eventsCache.find(x => x.id === pasteState.eventId);
      const players = (turmaById(e.turma_id) || {}).players || [];
      const opts = sel => `<option value="__guest" ${sel === '__guest' ? 'selected' : ''}>🎟️ Convidado (de fora da turma)</option><option value="__add" ${sel === '__add' ? 'selected' : ''}>➕ Adicionar à turma</option><option value="__skip" ${sel === '__skip' ? 'selected' : ''}>Ignorar esta linha</option>` +
        players.map(p => `<option value="${escapeHtml(keyOf(p))}" ${sel === keyOf(p) ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('');
      const matched = pasteState.rows.filter(r => !r.pick.startsWith('__')).length;
      document.getElementById('paste-preview').innerHTML = `
        <p class="text-[12.5px] text-ink-2 leading-snug">${pasteState.rows.length} nomes lidos · ${matched} reconhecidos na turma. Confira os que não bateram.</p>
        ${pasteState.rows.map((r, i) => `
          <div class="rounded-2xl border ${r.pick === '__guest' || r.pick === '__add' ? 'border-butter-3 bg-butter/30' : r.pick === '__skip' ? 'border-ink/10 opacity-60' : 'border-ink/10 bg-card'} p-2.5 space-y-1.5">
            <div class="flex items-center gap-2"><span class="text-[13.5px] font-bold flex-1 min-w-0 truncate">“${escapeHtml(r.name)}”</span>
              <select onchange="pasteSet(${i}, 'status', this.value)" class="select !h-9 !w-[104px] !text-[12.5px] flex-shrink-0">${['vou', 'talvez', 'nao'].map(s => `<option value="${s}" ${r.status === s ? 'selected' : ''}>${ANSWER_LABEL[s]}</option>`).join('')}</select></div>
            <select onchange="pasteSet(${i}, 'pick', this.value)" class="select !h-9 !text-[12.5px]">${opts(r.pick)}</select>
            ${r.pick === '__guest' ? `<label class="block"><span class="text-[11.5px] font-bold text-ink-2">Convidado de quem?</span>
              <select onchange="pasteSet(${i}, 'inviter', this.value)" class="select !h-9 !text-[12.5px] ${r.inviter ? '' : '!border-danger/50'}">${inviterOptionsHtml(e.turma_id, r.inviter)}</select></label>` : ''}
            ${r.pick === '__add' ? `<p class="text-[11.5px] text-ink-2 leading-snug">“${escapeHtml(r.name)}” entra na turma ${escapeHtml(turmaById(e.turma_id).name)} com esse nome.</p>` : ''}
          </div>`).join('')}`;
      document.getElementById('paste-confirm').classList.remove('hidden');
    }
    function pasteSet(i, field, v) { if (pasteState && pasteState.rows[i]) { pasteState.rows[i][field] = v; renderPastePreview(); } }
    async function confirmPastedList() {
      const e = eventsCache.find(x => x.id === (pasteState && pasteState.eventId));
      if (!e) return;
      const t = turmaById(e.turma_id);
      const live = pasteState.rows.filter(r => r.pick !== '__skip');
      if (live.some(r => r.pick === '__guest' && !r.inviter)) { showToast('Escolha quem convidou cada convidado (ou ignore a linha).', 'warning'); return; }
      const toAdd = live.filter(r => r.pick === '__add');
      if (toAdd.length) {
        if (!t.cloud || !canEditTurma(t)) { showToast('Só o dono ou um adm adiciona gente à turma.', 'warning'); return; }
        toAdd.forEach(r => {
          const nm = r.name.trim().slice(0, 40);
          if (!t.players.some(n => sameName(n, nm))) t.players.push(nm);
        });
        cacheState();
        try { await syncTurmaNow(t.id); } catch (err) { showToast(isNetworkError(err) ? 'Precisa de internet pra adicionar à turma.' : 'Não consegui adicionar à turma. Tente de novo.', 'warning'); return; }
      }
      const rows = live.map(r => {
        if (r.pick === '__guest') return { name: r.name.slice(0, 60), player_id: null, status: r.status, invited_by: r.inviter };
        if (r.pick === '__add') {
          const nm = (t.players || []).find(n => sameName(n, r.name.trim().slice(0, 40))) || r.name;
          const m = (t.meta || {})[keyOf(nm)];
          return { name: nm, player_id: m ? m.id : null, status: r.status };
        }
        const m = (t.meta || {})[r.pick];
        return { name: (t.players || []).find(p => keyOf(p) === r.pick) || r.name, player_id: m ? m.id : null, status: r.status };
      });
      const btn = document.getElementById('paste-confirm');
      setBusy(btn, true, 'Salvando...');
      try {
        const n = await api.importRsvps(e.id, rows);
        showToast(`${n} nome${n === 1 ? '' : 's'} na lista.`);
        await loadEvents(true);
        closePasteList();
      } catch (err) { showToast(isNetworkError(err) ? 'Precisa de internet.' : 'Não deu certo. Tente de novo.', 'warning'); }
      finally { if (document.body.contains(btn)) setBusy(btn, false); }
    }

    /* ---- Fechar presença: cumpriu x miou ---- */
    let closeState = null;   // { eventId, out: { key: outcome } }
    let closeStash = null;   // outcomes worked out right before "Começar novo baba" reset the arrival list
    function arrivedToday(key) {
      const p = state.players.find(x => keyOf(x.name) === key);
      return !!(p && (p.present || p.arrivedAt || (p.matches || 0) > 0));
    }
    function openCloseEvent(id) {
      const e = eventsCache.find(x => x.id === id);
      if (!e) return;
      const sameDay = new Date(e.starts_at).toDateString() === new Date().toDateString() || (state.startedAt && new Date(e.starts_at).toDateString() === new Date(state.startedAt).toDateString());
      const hasDay = sameDay && state.players.some(p => p.present || p.arrivedAt || p.matches);
      const stash = closeStash && closeStash.eventId === id ? closeStash : null;
      closeStash = null;
      const out = {};
      (e.event_rsvps || []).filter(r => r.status === 'vou' || r.outcome).forEach(r => {
        out[r.player_key] = r.outcome || (stash ? stash.out[r.player_key] || null : hasDay ? (arrivedToday(r.player_key) ? 'cumpriu' : 'miou') : null);
      });
      closeState = { eventId: id, out, prefilled: hasDay || !!stash };
      closeEventSheet();
      eventOpen = id;
      renderCloseEvent();
      document.getElementById('modal-close-ev').classList.remove('hidden');
    }
    function closeCloseEvent() { document.getElementById('modal-close-ev').classList.add('hidden'); const id = closeState && closeState.eventId; closeState = null; if (id) openEventSheet(id); }
    function setOutcome(key, v) { if (closeState) { closeState.out[key] = closeState.out[key] === v ? null : v; renderCloseEvent(); } }
    function renderCloseEvent() {
      const e = eventsCache.find(x => x.id === closeState.eventId);
      const rows = (e.event_rsvps || []).filter(r => r.player_key in closeState.out);
      const seg = (r, v, label, cls) => `<button onclick="setOutcome(${escapeHtml(JSON.stringify(r.player_key))}, '${v}')" class="seg-btn !py-1.5 !text-[12px] ${closeState.out[r.player_key] === v ? 'is-selected ' + cls : ''}">${label}</button>`;
      document.getElementById('close-ev-sub').innerText = `${evWhen(e, true)} · ${rows.length} confirmado${rows.length === 1 ? '' : 's'}`;
      document.getElementById('close-ev-body').innerHTML = (closeState.prefilled ? '<p class="text-[12.5px] text-ink-2 leading-snug">Já marquei pela Lista de chegada de hoje: quem chegou cumpriu, quem não chegou miou. Confira e ajuste.</p>' : '<p class="text-[12.5px] text-ink-2 leading-snug">Marque quem veio. Quem avisou com motivo pode ficar como Justificou (não conta falta).</p>') +
        (rows.length ? rows.map(r => `
          <div class="py-2">
            <p class="text-[14px] font-bold truncate mb-1.5">${escapeHtml(r.name)} ${levelTag(e.turma_id, r.player_key, true)}</p>
            <div class="seg grid-cols-3">${seg(r, 'cumpriu', 'Cumpriu', '')}${seg(r, 'miou', 'Miou', '')}${seg(r, 'justificado', 'Justificou', '')}</div>
          </div>`).join('') : '<p class="text-[13px] text-ink-2 py-3">Ninguém confirmou nessa lista.</p>');
      const missing = rows.filter(r => !closeState.out[r.player_key]).length;
      const btn = document.getElementById('close-ev-save');
      btn.disabled = missing > 0;
      btn.innerText = missing ? `Falta marcar ${missing}` : 'Fechar presença';
    }
    async function saveCloseEvent() {
      const e = eventsCache.find(x => x.id === (closeState && closeState.eventId));
      if (!e) return;
      const outcomes = Object.entries(closeState.out).map(([key, outcome]) => ({ key, outcome }));
      const btn = document.getElementById('close-ev-save');
      setBusy(btn, true, 'Salvando...');
      try {
        const up = (await api.closeEvent(e.id, outcomes)) || [];
        await loadDiscipline(e.turma_id, true);
        await loadEvents(true);
        document.getElementById('modal-close-ev').classList.add('hidden');
        closeState = null;
        const miou = outcomes.filter(o => o.outcome === 'miou').length;
        if (up.length) {
          showPopup({ img: 'red', eyebrow: 'Presença fechada', title: miou ? `${miou} miou${miou === 1 ? '' : 'ram'}` : 'Tudo certo',
            html: `<p class="text-[14px] text-ink-2 mb-2">Com as regras da turma, mudou o nível de:</p>` + up.map(u => `
              <div class="flex items-center gap-2 py-1.5"><span class="flex-1 font-bold text-[14px] truncate">${escapeHtml(u.name)}</span><span class="ev-tag ${LEVEL_CLS[u.level] || 'bg-sunk'}">${LEVEL_LABEL[u.level] || u.level}</span></div>
              ${u.level === 'banimento' ? `<button onclick="closePopup(); banFromTurma('${e.turma_id}', ${escapeHtml(JSON.stringify(u.player_key))}, ${escapeHtml(JSON.stringify(u.name))})" class="btn-outline w-full h-10 text-[13px] !text-danger mb-1">Banir ${escapeHtml(firstName(u.name))} da turma</button>` : ''}`).join(''), ok: 'Beleza' });
        } else showToast(miou ? `Presença fechada. ${miou} miou${miou === 1 ? '' : 'ram'}.` : 'Presença fechada. Todo mundo cumpriu!');
        openEventSheet(e.id);
      } catch (err) { showToast(isNetworkError(err) ? 'Precisa de internet.' : 'Não deu certo. Tente de novo.', 'warning'); }
      finally { if (document.body.contains(btn)) setBusy(btn, false); }
    }

    /* ---- Regras de presença e penalidades ---- */
    let rulesTurma = null;
    async function openRules(turmaId) {
      rulesTurma = turmaId;
      closeEventSheet();
      document.getElementById('modal-rules').classList.remove('hidden');
      document.getElementById('rules-body').innerHTML = '<p class="text-[14px] text-ink-2 py-3">Carregando...</p>';
      let r = null;
      try { r = await api.turmaRules(turmaId); } catch (e) {}
      await loadDiscipline(turmaId, true);
      if (rulesTurma !== turmaId) return;
      renderRules(r || { mode: 'auto', aviso: 1, prioridade: 2, bloqueio: 3, banimento: 4, janela_dias: 60 });
    }
    function closeRules() { document.getElementById('modal-rules').classList.add('hidden'); rulesTurma = null; }
    function renderRules(r) {
      const t = turmaById(rulesTurma);
      const adm = canEditTurma(t);
      const d = disciplineCache.get(rulesTurma);
      const rows = d ? [...d.rows.values()].filter(x => x.level !== 'ok' || (x.misses || 0) > 0 || (x.kept || 0) > 0) : [];
      rows.sort((a, b) => (b.misses || 0) - (a.misses || 0) || String(a.name).localeCompare(String(b.name)));
      const num = (id, v, label) => `<label class="block min-w-0"><span class="label">${label}</span><input id="${id}" type="number" min="1" max="30" value="${v}" class="field !h-11 text-center" ${adm ? '' : 'disabled'} /></label>`;
      document.getElementById('rules-sub').innerText = t ? t.name : '';
      document.getElementById('rules-body').innerHTML = `
        <div>
          <span class="label">Penalidade por falta (miou)</span>
          <div class="seg grid-cols-3" id="rules-mode">${[['auto', 'Automática'], ['manual', 'Só manual'], ['off', 'Desligada']].map(([v, l]) => `<button ${adm ? `onclick="rulesMode('${v}')"` : 'disabled'} data-v="${v}" class="seg-btn ${r.mode === v ? 'is-selected' : ''}">${l}</button>`).join('')}</div>
          <p class="text-[12px] text-ink-2 leading-snug mt-1.5">${r.mode === 'auto' ? 'O BABA conta as faltas e sobe o nível sozinho. Banir da turma sempre é decisão do adm.' : r.mode === 'manual' ? 'Só valem as sanções que o adm aplicar.' : 'Ninguém é penalizado.'}</p>
        </div>
        <div class="${r.mode === 'auto' ? '' : 'hidden'}" id="rules-auto">
          <p class="text-[12.5px] font-bold mb-1.5">Quantas faltas pra cada nível, nos últimos <input id="rule-janela" type="number" min="7" max="365" value="${r.janela_dias}" class="w-14 h-8 rounded-lg border border-ink/15 text-center bg-card" ${adm ? '' : 'disabled'} /> dias</p>
          <div class="grid grid-cols-4 gap-2">${num('rule-aviso', r.aviso, 'Aviso')}${num('rule-prioridade', r.prioridade, 'Prioridade')}${num('rule-bloqueio', r.bloqueio, 'Bloqueio')}${num('rule-banimento', r.banimento, 'Banir?')}</div>
          <p class="text-[12px] text-ink-2 leading-snug mt-1.5"><b>Aviso:</b> a pessoa é avisada. <b>Prioridade:</b> entra na lista depois de quem não tem falta. <b>Bloqueio:</b> não consegue confirmar sozinha. <b>Banir?:</b> o BABA sugere e o adm decide.</p>
        </div>
        ${adm ? `<button onclick="saveRules()" class="btn-primary w-full h-12 text-[14px]" id="rules-save">Salvar regras</button>` : ''}
        <div>
          <p class="section-tag">Presença da galera</p>
          ${rows.length ? `<div class="divide-y divide-ink/[0.07]">${rows.map(x => {
            const total = (x.misses || 0) + (x.kept || 0);
            const rate = total ? Math.round(100 * (x.misses || 0) / total) : 0;
            return `
            <div class="py-2.5">
              <div class="flex items-center gap-2">
                <span class="flex-1 min-w-0 text-[14px] font-bold truncate">${escapeHtml(x.name)}</span>
                ${x.level !== 'ok' ? `<span class="ev-tag ${LEVEL_CLS[x.level]}">${LEVEL_LABEL[x.level]}</span>` : ''}
              </div>
              ${x.misses != null ? `<p class="text-[12px] text-ink-2">${x.kept || 0} cumpriu · ${x.misses || 0} miou${x.justified ? ` · ${x.justified} justificou` : ''}${total ? ` · taxa de miou ${rate}%` : ''}</p>` : ''}
              ${(x.sanctions || []).map(s => `<p class="text-[12px] text-ink-2 flex items-center gap-2 mt-1"><span class="ev-tag ${LEVEL_CLS[s.kind]}">${LEVEL_LABEL[s.kind] || s.kind}</span><span class="flex-1 truncate">${escapeHtml(s.reason || 'sem motivo')}${s.until ? ` · até ${fmtDate(s.until)}` : ''}</span>${adm ? `<button onclick="clearSanction(${s.id})" class="text-pitch font-bold">Tirar</button>` : ''}</p>`).join('')}
              ${adm ? `<div class="flex gap-3 mt-1.5 text-[12.5px] font-bold"><button onclick="addSanctionFor(${escapeHtml(JSON.stringify(x.player_key))}, ${escapeHtml(JSON.stringify(x.name))})" class="text-pitch">Aplicar sanção</button>
                ${x.level === 'banimento' ? `<button onclick="banFromTurma('${rulesTurma}', ${escapeHtml(JSON.stringify(x.player_key))}, ${escapeHtml(JSON.stringify(x.name))})" class="text-danger">Banir da turma</button>` : ''}</div>` : ''}
            </div>`; }).join('')}</div>` : '<p class="text-[13px] text-ink-2">Ninguém com falta ou sanção. Quando o adm fechar a presença das listas, os números aparecem aqui.</p>'}
          ${adm ? `<button onclick="addSanctionFor(null, null)" class="btn-outline w-full h-11 text-[13px] mt-2"><i class="fa-solid fa-gavel"></i> Aplicar sanção a alguém</button>` : ''}
        </div>`;
      rulesCurrent = r;
    }
    let rulesCurrent = null;
    function rulesMode(v) { if (rulesCurrent) { rulesCurrent = Object.assign({}, rulesCurrent, readRulesForm(), { mode: v }); renderRules(rulesCurrent); } }
    function readRulesForm() {
      const n = id => { const el = document.getElementById(id); return el ? Math.max(1, parseInt(el.value, 10) || 1) : undefined; };
      return { aviso: n('rule-aviso'), prioridade: n('rule-prioridade'), bloqueio: n('rule-bloqueio'), banimento: n('rule-banimento'), janela_dias: Math.min(365, Math.max(7, n('rule-janela') || 60)) };
    }
    async function saveRules() {
      const r = Object.assign({}, rulesCurrent, readRulesForm());
      if (!(r.aviso <= r.prioridade && r.prioridade <= r.bloqueio && r.bloqueio <= r.banimento)) { showToast('Os números têm que ir subindo: aviso ≤ prioridade ≤ bloqueio ≤ banir.', 'warning'); return; }
      try {
        await api.setRules(rulesTurma, r.mode, r.aviso, r.prioridade, r.bloqueio, r.banimento, r.janela_dias);
        disciplineCache.delete(rulesTurma);
        showToast('Regras salvas.');
        openRules(rulesTurma);
        loadEvents(true);
      } catch (e) { showToast(isNetworkError(e) ? 'Precisa de internet.' : 'Não deu certo agora.', 'warning'); }
    }
    async function addSanctionFor(key, name) {
      const t = turmaById(rulesTurma);
      if (!t) return;
      if (!key) {
        const who = (prompt('Nome de quem recebe a sanção (como está na turma):') || '').trim();
        if (!who) return;
        const p = (t.players || []).find(n => keyOf(n) === keyOf(who)) || who;
        key = keyOf(p); name = p;
      }
      const kind = (prompt(`Sanção pra ${name}: digite aviso, prioridade ou bloqueio`, 'aviso') || '').trim().toLowerCase();
      if (!['aviso', 'prioridade', 'bloqueio'].includes(kind)) { if (kind) showToast('Use aviso, prioridade ou bloqueio.', 'warning'); return; }
      const reason = (prompt('Motivo (opcional):') || '').trim();
      const days = parseInt(prompt('Por quantos dias? (vazio = até o adm tirar)') || '0', 10) || 0;
      try { await api.addSanction(rulesTurma, key, name, kind, reason, days); disciplineCache.delete(rulesTurma); showToast('Sanção aplicada.'); openRules(rulesTurma); }
      catch (e) { showToast(isNetworkError(e) ? 'Precisa de internet.' : 'Não deu certo agora.', 'warning'); }
    }
    async function clearSanction(id) {
      try { await api.clearSanction(id); disciplineCache.delete(rulesTurma); showToast('Sanção tirada.'); openRules(rulesTurma); }
      catch (e) { showToast('Não deu certo agora.', 'warning'); }
    }
    async function banFromTurma(turmaId, key, name) {
      if (!(await askConfirm(`Banir ${name} da turma? A pessoa sai da turma e o convite deixa de funcionar pra ela. Dá pra desfazer depois nas regras.`, 'Banir'))) return;
      const reason = (prompt('Motivo (fica registrado pros adms):', 'Faltas na lista') || '').trim();
      try {
        const r = await api.banPlayer(turmaId, key, reason);
        disciplineCache.delete(turmaId);
        showToast(r === 'banned_account' ? `${firstName(name)} saiu da turma.` : `${firstName(name)} está banido da lista.`);
        pullCloud(true);
        if (rulesTurma) openRules(rulesTurma);
      } catch (e) {
        const m = String((e && e.message) || '');
        showToast(isNetworkError(e) ? 'Precisa de internet.' : m.includes('not_allowed') ? 'Só o dono pode banir um adm, e o dono não pode ser banido.' : 'Não deu certo agora.', 'warning');
      }
    }

    /* ---- Na turma: compromissos ---- */
    function renderTurmaEvents() {
      const box = document.getElementById('turma-edit-events');
      if (!box) return;
      const t = turmaById(editingTurmaId);
      if (!t || !t.cloud || eventsOff === true || v7 !== true) { box.innerHTML = ''; box.classList.add('hidden'); return; }
      box.classList.remove('hidden');
      const list = eventsCache.filter(e => e.turma_id === t.id && (evUpcoming(e) || (e.status === 'done' && Date.now() - new Date(e.starts_at).getTime() < 3 * 864e5)))
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      const adm = canEditTurma(t);
      box.innerHTML = `
        <div class="flex items-center justify-between gap-2 mb-2">
          <p class="text-[14px] font-extrabold">Compromisso</p>
          ${adm ? `<button onclick="openEventEdit('${t.id}')" class="btn-primary h-9 px-3 text-[12.5px]"><i class="fa-solid fa-clipboard-list"></i> Puxar lista</button>` : ''}
        </div>
        ${list.length ? `<div class="space-y-2">${list.map(e => `
          <button onclick="openEventSheet('${e.id}')" class="w-full flex items-center gap-3 p-2.5 rounded-2xl bg-card border border-ink/10 text-left">
            <span class="tile w-9 h-9 rounded-xl ${e.status === 'done' ? 'bg-leaf/10 text-leaf' : 'bg-butter text-pitch'} text-[14px]"><i class="fa-solid ${e.status === 'done' ? 'fa-clipboard-check' : 'fa-clipboard-list'}"></i></span>
            <span class="min-w-0 flex-1"><span class="block text-[14px] font-bold truncate">${escapeHtml(evWhen(e))}</span><span class="block text-[12px] text-ink-2 truncate">${evLines(e).vou.length} vão${e.place ? ` · ${escapeHtml(e.place)}` : ''}${e.status === 'done' ? ' · presença fechada' : ''}</span></span>
            <i class="fa-solid fa-chevron-right text-[12px] text-ink-3"></i>
          </button>`).join('')}</div>`
          : `<p class="text-[12.5px] text-ink-2 leading-snug">${adm ? 'Puxe a lista do próximo baba: a turma recebe o aviso e confirma pelo app.' : 'Quando o adm puxar a lista do próximo baba, ela aparece aqui e no Início.'}</p>`}
        ${adm ? `<button onclick="openRules('${t.id}')" class="w-full text-left text-[12.5px] font-bold text-pitch mt-2">Regras de presença e penalidades <i class="fa-solid fa-chevron-right text-[10px]"></i></button>` : ''}`;
    }

