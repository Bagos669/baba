    /* ===================================================================
       JOGO AO VIVO · quem organiza
       The organizer's phone publishes the scoreboard (and the palpite
       multipliers) to live_games; anyone with the code watches it.
       =================================================================== */
    let livePushTimer = null;
    let liveCreating = false;
    const liveCode = () => (state.live && state.live.code) || '';
    const liveLink = code => `${location.protocol.startsWith('http') ? location.origin + location.pathname : 'https://bagos669.github.io/baba/'}#ao-vivo=${code}`;

    async function ensureLive(openAfter) {
      if (state.live && state.live.id) { if (openAfter) openQr(); return true; }
      if (!cloudOn() || v7 !== true || liveCreating) return false;
      if (navigator.onLine === false) { if (openAfter) showToast('Transmitir ao vivo precisa de internet.', 'warning'); return false; }
      liveCreating = true;
      try {
        const id = uuid();
        const row = { id, turma_ids: cloudTurmaIds(state.selectedTeams), title: babaTitle(), palpites: true, state: liveSnapshot(), markets: liveMarkets(true) };
        const created = await api.createLive(row);
        state.live = { id, code: (created && created.code) || '', palpites: true };
        if (!state.live.code) { const g = await api.liveList(); const mine = (g || []).find(x => x.id === id); state.live.code = mine ? mine.code : ''; }
        saveState();
        renderLivePill();
        if (openAfter !== false) openQr();
        return true;
      } catch (e) {
        if (openAfter) showToast(isNetworkError(e) ? 'Transmitir ao vivo precisa de internet.' : 'Não consegui abrir a transmissão.', 'warning');
        return false;
      } finally {
        liveCreating = false;
      }
    }

    /* Called on every saved change: the latest scoreboard goes out shortly after. */
    function scheduleLivePush(now) {
      if (!state.live || !state.live.id || !cloudOn()) return;
      clearTimeout(livePushTimer);
      livePushTimer = setTimeout(pushLive, now ? 0 : 700);
    }

    async function pushLive() {
      if (!state.live || !state.live.id || navigator.onLine === false) return;
      try {
        await api.updateLive(state.live.id, { title: babaTitle(), state: liveSnapshot(), markets: liveMarkets(state.live.palpites), palpites: !!state.live.palpites });
      } catch (e) {}
    }

    function liveSnapshot() {
      const m = state.match;
      const { A, B } = state.court;
      const team = (t, score) => t ? { label: `Time ${t.label}`, names: t.ids.map(nameOf), score, king: (t.streak || 0) > 0 } : null;
      return {
        v: 1,
        matchNo: state.matchHistory.length + 1,
        running: !!m.isRunning,
        endAt: m.isRunning ? m.endAt : null,
        secondsLeft: m.secondsLeft,
        total: (m.initialSeconds || 420) + (m.addedSeconds || 0),
        added: m.addedSeconds || 0,
        rule: m.goalLimitRule,
        A: team(A, m.scoreA),
        B: team(B, m.scoreB),
        events: m.events.slice(0, 8).map(e => {
          const out = { type: e.type, side: e.side, time: e.time,
            who: e.type === 'goal' ? nameOf(e.scorerId) : nameOf(e.playerId || e.keeperId || e.scorerId),
            assist: e.assistId ? nameOf(e.assistId) : null };
          // The scorer's announcement card (only the visual bits, never the account).
          const c = e.type === 'goal' ? cosOfPlayer(byId(e.scorerId)) : null;
          if (c && GOAL_CARDS[c.goalCard]) out.fx = { goalCard: c.goalCard, mascot: c.mascot || null, nick: nickOf(c) || null, title: c.title || null };
          return out;
        }),
        history: state.matchHistory.slice(0, 3).map(h => Object.assign({ a: `Time ${h.labelA}`, b: `Time ${h.labelB}`, sa: h.scoreA, sb: h.scoreB }, h.pens ? { pens: [h.pens.a, h.pens.b] } : {})),
        queue: state.queue.length,
        at: Date.now()
      };
    }

    /* ---- Multipliers from the stats ----
       Each player's goals per match (today + past babas, pulled toward a
       prior so one lucky day doesn't dominate) gives each team an expected
       goal rate; a quick simulation of the rest of the match (with the
       goal-limit rule and the current score) gives the probabilities. */
    function playerRates() {
      const tot = new Map();
      const add = (name, g, mt, w) => {
        const k = String(name || '').trim().toLowerCase();
        if (!k) return;
        const r = tot.get(k) || { g: 0, m: 0, w: 0 };
        r.g += Number(g) || 0; r.m += Number(mt) || 0; r.w += Number(w) || 0;
        tot.set(k, r);
      };
      state.pastDays.forEach(d => (d.players || []).forEach(p => add(p.name, p.goals, p.matches, p.wins)));
      state.players.forEach(p => add(p.name, p.goals, p.matches, p.wins));
      return tot;
    }

    /* Each player's rate is pulled toward the turma's average by 6 matches' worth of weight.
       (Checked against simulated seasons: with a weaker pull, whoever had a quiet first
       baba showed x15+ while really scoring about twice as often as that implied.) */
    const RATE_PULL = 6;
    function teamModel(team, rates) {
      let G = 0, M = 0;
      rates.forEach(r => { G += r.g; M += r.m; });
      const avg = (G + 0.25 * 12) / (M + 12);
      return team.ids.map(id => {
        const p = byId(id);
        const r = rates.get(String(p ? p.name : '').trim().toLowerCase()) || { g: 0, m: 0, w: 0 };
        const prior = p && p.isGoalkeeper ? 0.05 : avg;
        return { id, key: String(p ? p.name : '').trim().toLowerCase().slice(0, 60), name: p ? p.name : '?', gpm: (r.g + prior * RATE_PULL) / (r.m + RATE_PULL), wr: (r.w + 1) / (r.m + 2) };
      });
    }

    function simulateMatch(mA, mB, opts) {
      const avg = a => a.reduce((s, x) => s + x.wr, 0) / Math.max(1, a.length);
      const tilt = Math.sqrt(avg(mA) / avg(mB));
      const dur = opts.total / 420;
      const lA = Math.max(0.15, mA.reduce((s, p) => s + p.gpm, 0) * tilt * dur);
      const lB = Math.max(0.15, mB.reduce((s, p) => s + p.gpm, 0) / tilt * dur);
      const frac = Math.max(0, Math.min(1, opts.left / opts.total));
      const lim = opts.rule === 'none' || opts.rule === 'diff2' ? 0 : Number(opts.rule) || 0;
      const pick = (arr, sum) => { let x = Math.random() * sum; for (const p of arr) { x -= p.gpm; if (x <= 0) return p.key; } return arr[arr.length - 1].key; };
      const sumA = mA.reduce((s, p) => s + p.gpm, 0), sumB = mB.reduce((s, p) => s + p.gpm, 0);
      const N = 4000;
      const res = { A: 0, B: 0, draw: 0, over15: 0, both: 0, scorers: new Map() };
      for (let i = 0; i < N; i++) {
        let a = opts.sa, b = opts.sb;
        const scored = new Set();
        // Goals in the time left: a Poisson draw, each one to A or B by their rates.
        const lam = (lA + lB) * frac;
        let k = 0, L = Math.exp(-lam), pr = 1;
        do { k++; pr *= Math.random(); } while (pr > L && k < 40);
        k--;
        for (let g = 0; g < k; g++) {
          if (lim && (a >= lim || b >= lim)) break;
          if (opts.rule === 'diff2' && Math.abs(a - b) >= 2) break;
          if (Math.random() < lA / (lA + lB)) { a++; scored.add(pick(mA, sumA)); } else { b++; scored.add(pick(mB, sumB)); }
        }
        if (a > b) res.A++; else if (b > a) res.B++; else res.draw++;
        if (a + b > 1.5) res.over15++;
        if (a > 0 && b > 0) res.both++;
        scored.forEach(key => res.scorers.set(key, (res.scorers.get(key) || 0) + 1));
      }
      ['A', 'B', 'draw', 'over15', 'both'].forEach(k => { res[k] /= N; });
      res.scorers.forEach((v, key) => res.scorers.set(key, v / N));
      return res;
    }

    /* 10% margin over the fair price, capped at x20 (the server's limit). Below ~4.5% the cap
       makes the multiplier less than fair, which is fine: a player who almost never scores
       still shows up, just not as a jackpot. */
    const oddFrom = p => Math.min(20, Math.max(1.05, Math.round((0.9 / p) * 100) / 100));

    function liveMarkets(enabled) {
      const m = state.match;
      const { A, B } = state.court;
      const matchNo = state.matchHistory.length + 1;
      const left = m.isRunning && m.endAt ? Math.max(0, Math.round((m.endAt - Date.now()) / 1000)) : m.secondsLeft;
      if (!enabled || !A || !B || left <= 45) return { match_no: matchNo, open: false };
      const rates = playerRates();
      const mA = teamModel(A, rates), mB = teamModel(B, rates);
      const sim = simulateMatch(mA, mB, { sa: m.scoreA, sb: m.scoreB, left, total: (m.initialSeconds || 420) + (m.addedSeconds || 0), rule: m.goalLimitRule });
      const items = [];
      const push = (key, label, group, p) => { if (p >= 0.03 && p <= 0.96) items.push({ key, label, group, odd: oddFrom(p), pct: Math.round(p * 100) }); };
      push('res:A', `Time ${A.label} vence`, 'Resultado', sim.A);
      push('res:draw', 'Empate', 'Resultado', sim.draw);
      push('res:B', `Time ${B.label} vence`, 'Resultado', sim.B);
      const already = new Set(m.events.filter(e => e.type === 'goal').map(e => String(nameOf(e.scorerId)).trim().toLowerCase()));
      [...mA, ...mB].filter(p => !already.has(p.key)).forEach(p => push('gol:' + p.key, `${p.name} marca`, 'Quem marca', sim.scorers.get(p.key) || 0));
      if (m.scoreA + m.scoreB < 2) push('over:1.5', 'Saem 2 gols ou mais', 'Gols', sim.over15);
      if (!(m.scoreA > 0 && m.scoreB > 0)) push('ambos', 'Os dois times marcam', 'Gols', sim.both);
      return {
        match_no: matchNo, open: items.length > 0,
        closes_at: m.isRunning && m.endAt ? new Date(m.endAt - 45000).toISOString() : null,
        items
      };
    }

    /* Called by finishMatchAndNextChallenger with the match that just ended. */
    function queueLiveSettle(matchNo, A, B, scoreA, scoreB, events) {
      if (!state.live || !state.live.id) return;
      const scorers = [...new Set(events.filter(e => e.type === 'goal' && e.scorerId != null).map(e => String(nameOf(e.scorerId)).trim().toLowerCase().slice(0, 60)))];
      const goalsBy = {};
      events.filter(e => e.type === 'goal' && e.scorerId != null).forEach(e => { const k = String(nameOf(e.scorerId)).trim().toLowerCase().slice(0, 60); goalsBy[k] = (goalsBy[k] || 0) + 1; });
      const result = { winner: scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'draw', goalsA: scoreA, goalsB: scoreB, scorers, goalsBy };
      enqueue({ type: 'live_settle', liveId: state.live.id, matchNo, result });
    }

    /* Ends the transmission (new baba, reset, or the button). */
    function endLiveQuiet() {
      if (!state.live || !state.live.id) return;
      enqueue({ type: 'live_end', id: state.live.id });
      state.live = null;
    }

    async function stopLive() {
      if (!(await askConfirm('Parar a transmissão? Quem está assistindo vê o jogo como encerrado.', 'Parar'))) return;
      endLiveQuiet();
      saveState();
      closeQr();
      renderLivePill();
      showToast('Transmissão encerrada.');
    }

    function setLivePalpites(on) {
      if (!state.live) return;
      state.live.palpites = !!on;
      saveState();
      scheduleLivePush(true);
      showToast(on ? 'Palpites liberados neste jogo.' : 'Palpites desligados neste jogo.');
    }

    function openQr() {
      if (!state.live || !state.live.code) { ensureLive(true); return; }
      const link = liveLink(state.live.code);
      document.getElementById('qr-code').innerText = state.live.code;
      document.getElementById('qr-site').innerText = liveLink('').replace(/^https?:\/\//, '').replace(/#ao-vivo=$/, '');
      document.getElementById('qr-palpites').checked = !!state.live.palpites;
      const box = document.getElementById('qr-img');
      try {
        const qr = qrcode(0, 'M');
        qr.addData(link);
        qr.make();
        box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
        const svg = box.querySelector('svg');
        if (svg) { svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%'); }
      } catch (e) {
        box.innerHTML = `<p class="text-[13px] text-center text-ink-2">${escapeHtml(link)}</p>`;
      }
      document.getElementById('modal-qr').classList.remove('hidden');
    }
    function closeQr() { document.getElementById('modal-qr').classList.add('hidden'); }

    /* Watching by typing the code (for whoever can't scan the QR). */
    function openWatch() {
      const input = document.getElementById('watch-code');
      input.value = '';
      document.getElementById('watch-error').classList.add('hidden');
      document.getElementById('modal-watch').classList.remove('hidden');
      setTimeout(() => input.focus(), 60);
    }
    function closeWatch() { document.getElementById('modal-watch').classList.add('hidden'); }
    async function submitWatch() {
      const code = document.getElementById('watch-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const err = document.getElementById('watch-error');
      const fail = msg => { err.innerText = msg; err.classList.remove('hidden'); };
      if (code.length < 4) return fail('Digite o código inteiro.');
      const btn = document.getElementById('watch-btn');
      btn.disabled = true;
      let d = null;
      try { d = await api.getLive(code); }
      catch (e) { btn.disabled = false; return fail(isMissingFn(e) ? 'O jogo ao vivo ainda não está ligado no servidor.' : 'Sem conexão. Confira a internet e tente de novo.'); }
      btn.disabled = false;
      if (!d) return fail('Não achei um jogo com esse código. Confira com quem está organizando.');
      closeWatch();
      openLive(code);
    }

    async function shareLive() {
      const code = liveCode();
      if (!code) return;
      const text = `Acompanha o baba ao vivo no BABA: ${liveLink(code)}\nOu abra o app, toque em "Assistir um jogo ao vivo" e digite o código ${code}`;
      if (navigator.share) { try { await navigator.share({ title: 'BABA ao vivo', text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
      copyText(text, null, 'Link copiado. Manda no grupo!');
    }

    /* The "Ao vivo" strip on the Placar. */
    function renderLivePill() {
      const pill = document.getElementById('live-pill');
      if (!pill) return;
      const can = v7 === true && cloudOn();
      pill.classList.toggle('hidden', !can);
      pill.classList.toggle('flex', can);
      const on = !!(state.live && state.live.id);
      document.getElementById('live-pill-text').innerText = on ? `Ao vivo · ${state.live.code}` : 'Transmissão desligada';
      document.getElementById('live-pill-dot').classList.toggle('hidden', !on);
      document.getElementById('live-pill-btn').innerHTML = on ? '<i class="fa-solid fa-qrcode"></i> QR' : '<i class="fa-solid fa-tower-broadcast"></i> Transmitir';
      const cm = document.getElementById('cm-qr');
      if (cm) cm.classList.toggle('hidden', !on);
    }

    /* ===================================================================
       JOGO AO VIVO · quem assiste (com ou sem conta)
       =================================================================== */
    let liveView = null;   // { code, data, timers, chat, mine, rankingAt }

    function readLiveFromUrl() {
      const l = (location.hash + '&' + location.search).match(/lista=([0-9a-f-]{36})/);
      if (l) {
        try { sessionStorage.setItem('baba_pending_list', l[1]); } catch (e) {}
        try { history.replaceState(null, '', location.pathname); } catch (e) {}
      }
      const pa = (location.hash + '&' + location.search).match(/palpites=([0-9a-f-]{36})/);
      if (pa) {
        try { sessionStorage.setItem('baba_pending_palpites', pa[1]); } catch (e) {}
        try { history.replaceState(null, '', location.pathname); } catch (e) {}
      }
      const m = (location.hash + '&' + location.search).match(/ao-vivo=([A-Za-z0-9]{4,12})/);
      if (m) {
        try { sessionStorage.setItem('baba_pending_live', m[1].toUpperCase()); } catch (e) {}
        try { history.replaceState(null, '', location.pathname); } catch (e) {}
      }
    }
    /* Toque num aviso: a lista abre em Turmas → Lista; os palpites abrem na Lojinha → Palpites, no evento do aviso. */
    function openListaFromAviso(id) {
      switchTab('ficha');
      openEventSheet(id);
    }
    function openPalpitesFromAviso(id) {
      propForced = id;
      openPalpites(id);
    }
    function openPendingList() {
      let id = null;
      try { id = sessionStorage.getItem('baba_pending_list'); sessionStorage.removeItem('baba_pending_list'); } catch (e) {}
      if (id && currentUser) openListaFromAviso(id);
    }
    function openPendingPalpites() {
      let id = null;
      try { id = sessionStorage.getItem('baba_pending_palpites'); sessionStorage.removeItem('baba_pending_palpites'); } catch (e) {}
      if (id && currentUser) openPalpitesFromAviso(id);
    }
    function takePendingLive() {
      let code = null;
      try { code = sessionStorage.getItem('baba_pending_live'); sessionStorage.removeItem('baba_pending_live'); } catch (e) {}
      return code;
    }

    function openLive(code) {
      if (!code) return;
      closeLive(true);
      closeQr();
      liveView = { code: String(code).toUpperCase(), data: null, timers: [], chat: null, mine: [], rankingAt: 0 };
      document.getElementById('lv-title').innerText = 'Ao vivo';
      document.getElementById('lv-markets').innerHTML = '';
      document.getElementById('lv-mine').innerHTML = '';
      document.getElementById('page-live').classList.remove('hidden');
      document.getElementById('page-live').scrollTop = 0;
      pushPage('page-live');
      renderLiveBell();
      loadLiveFollow();
      pollLive();
      liveView.timers.push(setInterval(pollLive, 2500));
      liveView.timers.push(setInterval(tickLiveClock, 1000));
      if (currentUser && v7 === true) refreshWallet();
    }

    function closeLive(silent) {
      if (!liveView) { if (!silent) document.getElementById('page-live').classList.add('hidden'); return; }
      liveView.timers.forEach(t => clearInterval(t));
      if (liveView.chat) liveView.chat.destroy();
      liveView = null;
      document.getElementById('page-live').classList.add('hidden');
      popPage('page-live');
      if (!currentUser && document.getElementById('auth-root').classList.contains('hidden')) showAuth('landing');
    }

    function liveGoAuth(screen) {
      const code = liveView && liveView.code;
      if (code) { try { sessionStorage.setItem('baba_pending_live', code); } catch (e) {} }
      closeLive(true);
      showAuth(screen);
    }

    async function pollLive() {
      if (!liveView) return;
      const code = liveView.code;
      let d = null;
      try { d = await api.getLive(code); } catch (e) { if (!liveView.data) document.getElementById('lv-status').innerText = 'Sem conexão'; return; }
      if (!liveView || liveView.code !== code) return;
      if (!d) { renderLiveMissing(); return; }
      const first = !liveView.data;
      liveView.data = d;
      renderLive();
      if (first) mountLiveChat();
      const now = Date.now();
      if (currentUser && d.markets && now - (liveView.mineAt || 0) > 6000) { liveView.mineAt = now; loadMyPalpites(); loadMyDuels(); }
      if (now - liveView.rankingAt > 15000) { liveView.rankingAt = now; loadLiveRanking(); }
    }

    function renderLiveMissing() {
      document.getElementById('lv-title').innerText = 'Jogo não encontrado';
      document.getElementById('lv-status').innerText = 'Código inválido ou encerrado';
      document.getElementById('lv-palpites-box').classList.add('hidden');
    }

    function liveSecondsLeft(s) {
      if (!s) return 0;
      if (s.running && s.endAt) return Math.max(0, Math.round((s.endAt - Date.now()) / 1000));
      return Math.max(0, s.secondsLeft || 0);
    }
    function tickLiveClock() {
      if (!liveView || !liveView.data) return;
      const s = liveView.data.state || {};
      document.getElementById('lv-timer').innerText = s.A && s.B ? fmtMMSS(liveSecondsLeft(s)) : '--:--';
    }

    function renderLive() {
      const d = liveView.data;
      const s = d.state || {};
      document.getElementById('lv-title').innerText = d.title || 'Ao vivo';
      document.getElementById('lv-dot').classList.toggle('hidden', !(d.active && s.running));
      document.getElementById('lv-bell').classList.toggle('hidden', !!d.is_owner || !d.active);
      // A new goal by someone with an announcement card: show it here too.
      const top = (s.events || [])[0];
      const topKey = top ? `${s.matchNo}:${top.type}:${top.time}:${top.who}` : '';
      if (liveView.lastEvent !== undefined && topKey && topKey !== liveView.lastEvent && top.type === 'goal' && top.fx) showGoalCard(top.who || '?', top.fx, '');
      liveView.lastEvent = topKey;
      document.getElementById('lv-match').innerText = `Partida ${s.matchNo || 1}`;
      document.getElementById('lv-status').innerText = !d.active ? 'Encerrado' : !(s.A && s.B) ? 'Montando times' : s.running ? 'Rolando' : liveSecondsLeft(s) === 0 ? 'Fim do tempo' : 'Pausado';
      document.getElementById('lv-a').innerText = s.A ? s.A.label + (s.A.king ? ' 👑' : '') : 'Time A';
      document.getElementById('lv-b').innerText = s.B ? s.B.label : 'Time B';
      document.getElementById('lv-sa').innerText = s.A ? s.A.score : 0;
      document.getElementById('lv-sb').innerText = s.B ? s.B.score : 0;
      document.getElementById('lv-na').innerText = s.A ? s.A.names.join(', ') : '';
      document.getElementById('lv-nb').innerText = s.B ? s.B.names.join(', ') : '';
      tickLiveClock();
      const ev = (s.events || []).map(e => `
        <div class="flex items-center gap-2.5 text-[13px]"><span class="text-ink-3 tabular w-11 flex-shrink-0">${escapeHtml(e.time || '')}</span>
          <span class="min-w-0"><i class="fa-solid ${e.type === 'goal' ? 'fa-futbol text-pitch' : 'fa-hand text-ink-2'} mr-1"></i><b>${escapeHtml(e.who || '?')}</b>${e.assist ? ` <span class="text-ink-2">· passe de ${escapeHtml(e.assist)}</span>` : ''}</span></div>`).join('');
      const hist = (s.history || []).map(h => `<span class="inline-block mr-3">${escapeHtml(h.a)} ${h.sa}×${h.sb} ${escapeHtml(h.b)}${Array.isArray(h.pens) ? ` (pên. ${Number(h.pens[0]) || 0}×${Number(h.pens[1]) || 0})` : ''}</span>`).join('');
      document.getElementById('lv-events').innerHTML = (ev ? `<div class="card-flat p-3 space-y-1.5">${ev}</div>` : '') + (hist ? `<p class="text-[12px] text-ink-2 px-1">Últimas: ${hist}</p>` : '');
      document.getElementById('lv-guest').classList.toggle('hidden', !!currentUser);
      const bal = document.getElementById('lv-balance');
      bal.classList.toggle('hidden', !(currentUser && wallet));
      if (wallet) bal.querySelector('span').innerText = fmtPts(wallet.balance);
      renderLiveMarkets();
      renderDuels();
    }

    function renderLiveMarkets() {
      const d = liveView.data;
      const box = document.getElementById('lv-palpites-box');
      const mk = d.markets;
      // No palpites for: guests, minors, the organizer, or when switched off.
      if (!currentUser || !d.palpites || d.is_owner || !mk) {
        box.classList.toggle('hidden', !(currentUser && d.is_owner && d.palpites));
        if (currentUser && d.is_owner) document.getElementById('lv-markets').innerHTML = '<p class="card-flat p-3 text-[13px] text-ink-2">Você está transmitindo este jogo, então não palpita nele. A galera vê os multiplicadores aqui.</p>';
        return;
      }
      box.classList.remove('hidden');
      const closes = mk.closes_at ? Math.max(0, Math.round((new Date(mk.closes_at) - Date.now()) / 1000)) : null;
      document.getElementById('lv-closes').innerText = !mk.open ? 'Fechado' : closes !== null ? `Fecha em ${fmtMMSS(closes)}` : 'Aberto';
      if (!mk.open || !(mk.items || []).length) {
        document.getElementById('lv-markets').innerHTML = '<div class="card-flat p-3 flex items-center gap-3"><img src="babinha/tired.webp" alt="" class="w-12 h-12 object-contain flex-shrink-0" /><p class="text-[13px] text-ink-2 leading-snug">Palpites fechados agora. Abrem quando a próxima partida estiver com os times em quadra.</p></div>';
        return;
      }
      const groups = [...new Set(mk.items.map(i => i.group || 'Palpites'))];
      document.getElementById('lv-markets').innerHTML = groups.map(g => `
        <div>
          <p class="text-[12px] font-bold text-ink-2 mb-1.5 px-1">${escapeHtml(g)}</p>
          <div class="grid ${g === 'Resultado' ? 'grid-cols-3' : 'grid-cols-2'} gap-2">
            ${mk.items.filter(i => (i.group || 'Palpites') === g).map(i => `
              <button onclick="openPalpite(${escapeHtml(JSON.stringify(i.key))})" class="card-flat p-2.5 text-left active:scale-[0.97] transition min-w-0">
                <span class="block text-[12.5px] font-semibold leading-tight truncate">${escapeHtml(i.label)}</span>
                <span class="flex items-baseline justify-between gap-1 mt-0.5"><span class="font-serif text-[22px] text-pitch leading-tight">x${Number(i.odd).toFixed(2).replace('.', ',')}</span>${i.pct ? `<span class="text-[11px] font-semibold text-ink-3">${i.pct < 1 ? '<1' : i.pct}%</span>` : ''}</span>
              </button>`).join('')}
          </div>
        </div>`).join('');
    }

    async function loadMyPalpites() {
      if (!liveView || !liveView.data || !currentUser) return;
      try {
        const rows = await api.myPalpites(liveView.data.id);
        if (!liveView) return;
        liveView.mine = rows;
        const chip = r => r.status === 'won' ? `<span class="text-leaf font-extrabold">+${fmtPts(r.payout)}</span>`
          : r.status === 'lost' ? '<span class="text-ink-3 font-bold">Errou</span>'
          : r.status === 'void' ? '<span class="text-ink-2 font-bold">Devolvido</span>'
          : `<span class="text-ink-2 font-bold">${fmtPts(r.stake)} → ${fmtPts(Math.floor(r.stake * r.odd))}</span>`;
        document.getElementById('lv-mine').innerHTML = rows.length ? `
          <p class="text-[12px] font-bold text-ink-2 mb-1.5 px-1">Seus palpites</p>
          <div class="card-flat overflow-hidden divide-y divide-ink/[0.07]">${rows.slice(0, 8).map(r => `
            <div class="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
              <span class="min-w-0 truncate">P${r.match_no} · ${escapeHtml(r.label)} <span class="text-ink-3">x${Number(r.odd).toFixed(2).replace('.', ',')}</span></span>${chip(r)}
            </div>`).join('')}</div>` : '';
        if (rows.some(r => r.status !== 'open' && !(liveView.seen || new Set()).has(r.id))) {
          const fresh = rows.filter(r => r.status === 'won' && liveView.seenInit && !(liveView.seen || new Set()).has(r.id));
          if (fresh.length) { refreshWallet().then(renderLive); showToast(`Palpite certo! +${fmtPts(fresh.reduce((s, r) => s + r.payout, 0))} pontos`); }
        }
        liveView.seen = new Set(rows.filter(r => r.status !== 'open').map(r => r.id));
        liveView.seenInit = true;
      } catch (e) {}
    }

    async function loadLiveRanking() {
      if (!liveView || !liveView.data) return;
      try {
        const rows = await api.liveRanking(liveView.data.id);
        const box = document.getElementById('lv-ranking-box');
        box.classList.toggle('hidden', !rows.length);
        document.getElementById('lv-ranking').innerHTML = rows.map((r, i) => `
          <div class="flex items-center gap-3 px-3 py-2">
            <span class="w-5 text-[12px] font-bold text-ink-3 text-right">${i + 1}º</span>
            ${framedAvatar(r.avatar, r.name, 'w-8 h-8 text-[11px]', r.cosmetics)}
            <span class="flex-1 min-w-0 text-[14px] font-bold truncate">${styledName(r.name || '?', r.cosmetics)}</span>
            <span class="text-[12px] text-ink-2">${r.hits} acerto${r.hits === 1 ? '' : 's'}</span>
            <span class="text-[13px] font-extrabold ${r.net >= 0 ? 'text-leaf' : 'text-ink-2'}">${r.net >= 0 ? '+' : ''}${fmtPts(r.net)}</span>
          </div>`).join('');
      } catch (e) {}
    }

    /* ---- Fazer um palpite ---- */
    let palpiteDraft = null;
    const STAKES = [10, 25, 50, 100, 200];

    function openPalpite(key) {
      if (!liveView || !liveView.data || !liveView.data.markets) return;
      const it = (liveView.data.markets.items || []).find(i => i.key === key);
      if (!it) return;
      palpiteDraft = { key, label: it.label, odd: Number(it.odd), stake: 25 };
      document.getElementById('pp-label').innerText = it.label;
      document.getElementById('pp-odd').innerText = 'x' + palpiteDraft.odd.toFixed(2).replace('.', ',');
      document.getElementById('pp-error').classList.add('hidden');
      renderPalpiteStakes();
      document.getElementById('modal-palpite').classList.remove('hidden');
    }
    function closePalpite() { document.getElementById('modal-palpite').classList.add('hidden'); palpiteDraft = null; }
    function setStake(v) { if (palpiteDraft) { palpiteDraft.stake = v; renderPalpiteStakes(); } }
    function renderPalpiteStakes() {
      const bal = wallet ? wallet.balance : 0;
      document.getElementById('pp-stakes').innerHTML = STAKES.map(v => `
        <button onclick="setStake(${v})" ${v > bal ? 'disabled' : ''} class="h-11 rounded-xl border text-[14px] font-extrabold transition disabled:opacity-30 ${palpiteDraft.stake === v ? 'bg-pitch text-butter border-pitch' : 'bg-card border-ink/15 text-ink'}">${v}</button>`).join('');
      document.getElementById('pp-return').innerText = fmtPts(Math.floor(palpiteDraft.stake * palpiteDraft.odd));
    }

    async function confirmPalpite() {
      if (!palpiteDraft || !liveView || !liveView.data) return;
      const btn = document.getElementById('btn-palpite');
      setBusy(btn, true, 'Enviando...');
      try {
        const r = await api.placePalpite(liveView.data.id, palpiteDraft.key, palpiteDraft.stake);
        if (wallet && r) wallet.balance = r.balance;
        const shown = palpiteDraft.odd, got = r ? Number(r.odd) : shown;
        closePalpite();
        showToast(got !== shown ? `Palpite feito com x${got.toFixed(2).replace('.', ',')} (o multiplicador mudou).` : 'Palpite feito. Boa sorte!');
        liveView.mineAt = 0;
        pollLive();
      } catch (e) {
        const m = String((e && e.message) || '');
        const msg = isNetworkError(e) ? 'Sem internet agora.'
          : m.includes('closed') ? 'Os palpites dessa partida acabaram de fechar.'
          : m.includes('no_market') ? 'Esse palpite saiu do ar (o jogo mudou). Escolha outro.'
          : m.includes('no_points') ? 'Faltam pontos. Pegue o bônus do dia na lojinha.'
          : m.includes('limit') ? 'Máximo de 5 palpites por partida.'
          : m.includes('adult_only') ? 'Palpites são só para maiores de 18.'
          : m.includes('own_game') ? 'Quem transmite não palpita no próprio jogo.'
          : 'Não deu certo. Tente de novo.';
        showErr('pp-error', msg);
      } finally {
        if (document.body.contains(btn)) setBusy(btn, false);
      }
    }

    /* ---- Desafio 1v1 ----
       Two people put the same points on opposite sides; the server holds both stakes and
       pays the winner when the organizer closes the match. */
    let duelDraft = null;
    const DUEL_STATUS = {
      won: r => `<span class="text-leaf font-extrabold">+${fmtPts(r.stake * 2)}</span>`,
      lost: () => '<span class="text-ink-3 font-bold">Perdeu</span>',
      push: () => '<span class="text-ink-2 font-bold">Empate · devolvido</span>',
      void: () => '<span class="text-ink-2 font-bold">Devolvido</span>',
      declined: r => `<span class="text-ink-2 font-bold">${r.mine_is_challenger ? 'Recusado' : 'Você recusou'}</span>`,
      canceled: () => '<span class="text-ink-3 font-bold">Cancelado</span>'
    };
    const duelOutcome = r => r.status === 'won_c' ? (r.mine_is_challenger ? 'won' : 'lost') : r.status === 'won_o' ? (r.mine_is_challenger ? 'lost' : 'won') : r.status;

    function duelAllowed() {
      const d = liveView && liveView.data;
      return !!(d && currentUser && d.palpites && !d.is_owner && d.markets && !liveView.duelOff);
    }

    async function loadMyDuels() {
      if (!liveView || !liveView.data || !currentUser || liveView.duelOff) return;
      try {
        const rows = (await api.myChallenges(liveView.data.id)) || [];
        if (!liveView) return;
        const seen = liveView.duelSeen;
        if (seen) {
          const incoming = rows.filter(r => r.status === 'pending' && !r.mine_is_challenger && !seen.has(r.id + ':pending'));
          const won = rows.filter(r => duelOutcome(r) === 'won' && !seen.has(r.id + ':won'));
          if (incoming.length) { showToast(`${incoming[0].other_name} te desafiou! Veja em Desafio 1v1.`); try { navigator.vibrate && navigator.vibrate(30); } catch (e) {} }
          else if (won.length) { showToast(`Desafio ganho! +${fmtPts(won.reduce((s, r) => s + r.stake * 2, 0))} pontos`); refreshWallet().then(() => liveView && renderLive()); }
        }
        liveView.duelSeen = new Set(rows.map(r => r.id + ':' + (duelOutcome(r) === 'won' ? 'won' : r.status)));
        liveView.duels = rows;
        renderDuels();
      } catch (e) {
        if (isMissingFn(e)) { liveView.duelOff = true; renderDuels(); }
      }
    }

    function renderDuels() {
      const box = document.getElementById('lv-duel');
      if (!box) return;
      const ok = duelAllowed();
      box.classList.toggle('hidden', !ok);
      if (!ok) return;
      const open = !!(liveView.data.markets && liveView.data.markets.open);
      const btn = document.getElementById('lv-duel-btn');
      btn.disabled = !open;
      btn.innerHTML = open ? '<i class="fa-solid fa-hand-fist mr-1"></i> Desafiar alguém' : 'Abre junto com os palpites';
      // Someone who cancels before you answer doesn't need to show up on your list.
      const rows = (liveView.duels || []).filter(r => !(r.status === 'canceled' && !r.mine_is_challenger)).slice(0, 8);
      document.getElementById('lv-duels').innerHTML = rows.length ? `<div class="divide-y divide-ink/[0.07] -mx-1">${rows.map(r => {
        const o = duelOutcome(r);
        const who = escapeHtml(r.other_name || '?');
        const head = r.status === 'pending'
          ? (r.mine_is_challenger ? `Esperando <b>${who}</b> aceitar` : `<b>${who}</b> te desafiou`)
          : `Você × <b>${who}</b>`;
        const right = r.status === 'pending'
          ? (r.mine_is_challenger
              ? `<button onclick="cancelDuel(${r.id})" class="h-8 px-3 rounded-full bg-sunk text-[12px] font-bold text-ink-2">Cancelar</button>`
              : `<span class="flex gap-1.5"><button onclick="answerDuel(${r.id}, false)" class="h-8 px-3 rounded-full bg-sunk text-[12px] font-bold text-ink-2">Recusar</button><button onclick="answerDuel(${r.id}, true)" class="h-8 px-3 rounded-full bg-pitch text-butter text-[12px] font-extrabold">Aceitar</button></span>`)
          : r.status === 'accepted' ? `<span class="text-[12px] font-extrabold text-pitch">Valendo ${fmtPts(r.stake * 2)}</span>`
          : (DUEL_STATUS[o] || DUEL_STATUS.void)(r);
        return `<div class="px-1 py-2.5 flex items-center justify-between gap-3">
          <div class="min-w-0 text-[13px] leading-snug">
            <p class="truncate">P${r.match_no} · ${head} · ${fmtPts(r.stake)} pts</p>
            <p class="text-[12px] text-ink-2 truncate">Você: ${escapeHtml(r.my_label)} · ${who.split(' ')[0]}: ${escapeHtml(r.their_label)}</p>
          </div>
          <div class="flex-shrink-0">${right}</div>
        </div>`;
      }).join('')}</div>` : '';
    }

    async function openDuel() {
      if (!duelAllowed()) return;
      const s = liveView.data.state || {};
      if (!s.A || !s.B) return;
      duelDraft = { opp: null, oppName: '', kind: 'vencedor', pick: null, pickO: null, stake: 25, people: null };
      document.getElementById('duel-error').classList.add('hidden');
      document.getElementById('modal-duel').classList.remove('hidden');
      renderDuel();
      try { duelDraft.people = (await api.challengeCandidates(liveView.data.id)) || []; }
      catch (e) { duelDraft.people = []; }
      if (duelDraft) renderDuel();
    }
    function closeDuel() { document.getElementById('modal-duel').classList.add('hidden'); duelDraft = null; }

    function duelSides() {
      const s = (liveView && liveView.data && liveView.data.state) || {};
      return { A: s.A || { label: 'Time A', names: [] }, B: s.B || { label: 'Time B', names: [] } };
    }

    function renderDuel() {
      if (!duelDraft) return;
      const d = duelDraft, { A, B } = duelSides();
      const chip = (on, label, call, extra = '') => `<button onclick="${call}" class="chip ${on ? 'is-selected' : ''} ${extra}">${label}</button>`;
      const people = d.people === null
        ? '<p class="text-[13px] text-ink-2">Procurando quem está no jogo...</p>'
        : !d.people.length
          ? '<div class="card-flat p-3 flex items-center gap-3"><img src="babinha/shhh.webp" alt="" class="w-11 h-11 object-contain flex-shrink-0" /><p class="text-[13px] text-ink-2 leading-snug">Ninguém pra desafiar ainda. Aparece aqui quem mandou mensagem no chat do jogo, quem palpitou ou quem é da turma (maiores de 18).</p></div>'
          : `<div class="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">${d.people.map(p => `
              <button onclick="duelSet('opp', ${escapeHtml(JSON.stringify(p.id))})" class="flex-shrink-0 w-[76px] rounded-2xl p-2 border ${d.opp === p.id ? 'border-pitch bg-pitch/10' : 'border-ink/10 bg-card'} flex flex-col items-center gap-1">
                ${framedAvatar(p.avatar, p.name, 'w-11 h-11 text-[13px]', p.cosmetics)}
                <span class="text-[11.5px] font-bold leading-tight w-full truncate text-center">${escapeHtml(String(p.name || '?').split(' ')[0])}</span>
              </button>`).join('')}</div>`;
      const other = d.oppName ? escapeHtml(d.oppName.split(' ')[0]) : 'O outro';
      let picks = '';
      if (d.kind === 'vencedor') {
        picks = `<div><span class="label">Você aposta em</span><div class="grid grid-cols-2 gap-2">
          ${['A', 'B'].map(t => `<button onclick="duelSet('pick', '${t}')" class="h-12 rounded-xl border text-[14px] font-extrabold truncate px-2 ${d.pick === t ? 'bg-pitch text-butter border-pitch' : 'bg-card border-ink/15'}">${escapeHtml((t === 'A' ? A : B).label)} vence</button>`).join('')}
        </div>${d.pick ? `<p class="text-[12.5px] text-ink-2 mt-1.5">${other} fica com ${escapeHtml((d.pick === 'A' ? B : A).label)}. Empate devolve os pontos.</p>` : ''}</div>`;
      } else {
        const names = [...A.names, ...B.names];
        const list = (field, skip) => `<div class="flex flex-wrap gap-1.5">${names.filter(n => n !== skip).map(n => chip(d[field] === n, escapeHtml(n), `duelSet('${field}', ${escapeHtml(JSON.stringify(n))})`, 'max-w-full truncate')).join('')}</div>`;
        picks = `<div><span class="label">Seu jogador (vai fazer mais gols)</span>${list('pick', null)}</div>
          <div><span class="label">Jogador de ${other}</span>${list('pickO', d.pick)}</div>
          <p class="text-[12.5px] text-ink-2 -mt-2">Conta os gols nesta partida. Mesmo número de gols (até 0 a 0) devolve.</p>`;
      }
      const bal = wallet ? wallet.balance : 0;
      document.getElementById('duel-body').innerHTML = `
        <div><span class="label">Contra quem?</span>${people}</div>
        <div><span class="label">Sobre o quê?</span><div class="grid grid-cols-2 gap-2">
          ${[['vencedor', 'Quem vence'], ['gols', 'Quem faz mais gols']].map(([k, l]) => `<button onclick="duelSet('kind', '${k}')" class="h-11 rounded-xl border text-[13.5px] font-bold ${d.kind === k ? 'bg-ink text-paper border-ink' : 'bg-card border-ink/15'}">${l}</button>`).join('')}
        </div></div>
        ${picks}
        <div><span class="label">Quantos pontos cada um?</span><div class="grid grid-cols-5 gap-1.5">${STAKES.map(v => `
          <button onclick="duelSet('stake', ${v})" ${v > bal ? 'disabled' : ''} class="h-11 rounded-xl border text-[14px] font-extrabold transition disabled:opacity-30 ${d.stake === v ? 'bg-pitch text-butter border-pitch' : 'bg-card border-ink/15 text-ink'}">${v}</button>`).join('')}</div>
          <p class="text-[13px] text-ink-2 mt-2">Se você acertar, leva <b class="text-pitch font-serif text-[17px]">${fmtPts(d.stake * 2)}</b> pontos. Se ${d.oppName ? other + ' não aceitar' : 'ninguém aceitar'}, seus pontos voltam.</p></div>`;
      document.getElementById('btn-duel').disabled = !duelReady();
    }

    function duelReady() {
      const d = duelDraft;
      return !!(d && d.opp && d.pick && (d.kind === 'vencedor' || (d.pickO && d.pickO !== d.pick)) && wallet && wallet.balance >= d.stake);
    }

    function duelSet(field, v) {
      if (!duelDraft) return;
      const d = duelDraft;
      if (field === 'opp') { d.opp = v; const p = (d.people || []).find(x => x.id === v); d.oppName = p ? p.name : ''; }
      else if (field === 'kind') { if (d.kind !== v) { d.kind = v; d.pick = null; d.pickO = null; } }
      else if (field === 'pick') { d.pick = v; if (d.pickO === v) d.pickO = null; }
      else d[field] = v;
      document.getElementById('duel-error').classList.add('hidden');
      renderDuel();
    }

    async function sendDuel() {
      if (!duelReady() || !liveView || !liveView.data) return;
      const d = duelDraft, { A, B } = duelSides();
      let pc, po, lc, lo;
      if (d.kind === 'vencedor') {
        pc = d.pick; po = d.pick === 'A' ? 'B' : 'A';
        lc = `${(pc === 'A' ? A : B).label} vence`; lo = `${(po === 'A' ? A : B).label} vence`;
      } else {
        pc = d.pick; po = d.pickO;
        lc = `${pc} faz mais gols`; lo = `${po} faz mais gols`;
      }
      const btn = document.getElementById('btn-duel');
      setBusy(btn, true, 'Enviando...');
      try {
        await api.createChallenge(liveView.data.id, d.opp, d.kind, pc, po, lc.slice(0, 80), lo.slice(0, 80), d.stake);
        const name = d.oppName.split(' ')[0];
        closeDuel();
        showToast(`Desafio enviado. Agora é com ${name}.`);
        await refreshWallet();
        if (liveView) { renderLive(); loadMyDuels(); }
      } catch (e) {
        const m = String((e && e.message) || '');
        showErr('duel-error', isNetworkError(e) ? 'Sem internet agora.'
          : m.includes('closed') ? 'Os palpites dessa partida acabaram de fechar.'
          : m.includes('no_points') ? 'Faltam pontos. Pegue o bônus do dia na lojinha.'
          : m.includes('limit') ? 'Máximo de 3 desafios seus por partida.'
          : m.includes('opponent_not_allowed') ? 'Essa pessoa não pode receber desafios agora.'
          : m.includes('bad_pick') ? 'Esse jogador não está mais em quadra. Escolha de novo.'
          : m.includes('adult_only') ? 'Desafios são só para maiores de 18.'
          : 'Não deu certo. Tente de novo.');
      } finally {
        if (document.body.contains(btn)) { setBusy(btn, false); btn.disabled = !duelReady(); }
      }
    }

    async function answerDuel(id, accept) {
      const r = (liveView && liveView.duels || []).find(x => x.id === id);
      if (!r) return;
      if (accept && !(await askConfirm(`Aceitar o desafio de ${r.other_name}? Você põe ${fmtPts(r.stake)} pontos em "${r.my_label}". Se acertar, leva ${fmtPts(r.stake * 2)}.`, 'Aceitar'))) return;
      try {
        await api.respondChallenge(id, accept);
        showToast(accept ? 'Desafio aceito. Valendo!' : 'Desafio recusado. Os pontos voltaram pra quem desafiou.');
        await refreshWallet();
      } catch (e) {
        const m = String((e && e.message) || '');
        showToast(isNetworkError(e) ? 'Sem internet agora.' : m.includes('closed') ? 'Tarde demais: os palpites dessa partida fecharam.' : m.includes('no_points') ? 'Faltam pontos pra aceitar.' : m.includes('already') ? 'Esse desafio já foi respondido.' : 'Não deu certo. Tente de novo.');
      }
      if (liveView) { renderLive(); loadMyDuels(); }
    }

    async function cancelDuel(id) {
      try { await api.cancelChallenge(id); showToast('Desafio cancelado. Seus pontos voltaram.'); await refreshWallet(); }
      catch (e) { showToast(isNetworkError(e) ? 'Sem internet agora.' : 'Já foi respondido.'); }
      if (liveView) { renderLive(); loadMyDuels(); }
    }

