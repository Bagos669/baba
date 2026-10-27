    /* ===================================================================
       VISUAL DO ATLETA (v10.1): título, codinome, mascote, card, gol e pipoca
       =================================================================== */
    const TITLE_LABEL = { fominha: 'Fominha', resenha: 'Rei da Resenha', perna: 'Perna de Pau', matador: 'Matador', camisa10: 'Camisa 10', paredao: 'Paredão', garcom: 'Garçom', xerife: 'Xerife da Zaga', rei: 'Rei da Quadra', lenda: 'Lenda do Baba' };
    const MASCOTS = ['wink', 'coach', 'dancinha', 'arrogante', 'carretilha', 'siuu', 'champion', 'aura'];
    const GOAL_CARDS = { fogo: 'Fogo', raio: 'Raio', retro: 'Fliperama', neon: 'Neon', ouro: 'Ouro', galaxia: 'Galáxia' };
    const CARD_BGS = { gramado: 'Gramado', noite: 'Jogo à Noite', 'por-do-sol': 'Pôr do Sol', retro: 'Álbum Antigo', ouro: 'Ouro', holo: 'Holográfico' };
    const GOAL_SOUNDS = { corneta: 'Corneta', sirene: 'Sirene', tambor: 'Batucada', torcida: 'Torcida', arcade: 'Fliperama' };
    const NICK_MAX = 20;
    const pipocaOf = c => { const p = cosOf(c).pipoca; return p && p.until && Date.parse(p.until) > Date.now() ? p : null; };
    const titleOf = c => TITLE_LABEL[cosOf(c).title] || '';
    const nickOf = c => { const n = cosOf(c).nick; return typeof n === 'string' ? n.slice(0, NICK_MAX) : ''; };
    function titleChip(c, cls) {
      const t = titleOf(c);
      return t ? `<span class="cos-title ${cls || ''}">${escapeHtml(t)}</span>` : '';
    }
    const pipocaLeft = p => { const h = Math.max(1, Math.ceil((Date.parse(p.until) - Date.now()) / 3600000)); return h === 1 ? 'menos de 1 h' : `${h} h`; };

    /* Same words the server refuses, so the shop can say it right away. */
    function nickProblem(v) {
      const t = String(v || '').trim().replace(/\s+/g, ' ');
      if (!t) return '';
      if (t.length < 2 || t.length > NICK_MAX) return `Use de 2 a ${NICK_MAX} letras.`;
      if (!/^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .'"-]+$/.test(t)) return 'Só letras, números, espaço e . \' " -';
      const n = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/(.)\1+/g, '$1');
      const flat = n.replace(/[^a-z]/g, '');
      const parts = ['pora', 'porra', 'caralh', 'buceta', 'boceta', 'piroc', 'puta', 'puto', 'viad', 'traveco', 'vagabund', 'vadia', 'arombad', 'arrombad', 'cuzao', 'merda', 'bosta', 'crioul', 'macaco', 'retardad', 'mongol', 'nazi', 'hitler', 'estupr', 'pedofil', 'xota', 'xoxota', 'punheta', 'foder', 'fodid'];
      const words = ['cu', 'fdp', 'pnc', 'vsf', 'tnc', 'bicha', 'corno', 'gay', 'veado', 'pica'];
      if (parts.some(w => flat.includes(w)) || words.some(w => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(n))) return 'Esse codinome não rola. Escolha outro.';
      return '';
    }

    /* Which account (if any) a player on today's list is linked to. */
    function userIdOfPlayer(p) {
      if (!p) return null;
      const key = String(p.name || '').trim().toLowerCase();
      const own = p.turmaId ? turmaById(p.turmaId) : null;
      const m = own && own.meta ? own.meta[key] : null;
      if (m && m.userId) return m.userId;
      for (const t of state.turmas) { const x = t.meta && t.meta[key]; if (x && x.userId) return x.userId; }
      return null;
    }
    const cosOfPlayer = p => { const uid = userIdOfPlayer(p); if (!uid) return null; if (currentUser && uid === currentUser.id) return currentUser.cosmetics || {}; const x = peopleCache.get(uid); return x ? x.cosmetics || {} : null; };
    function prefetchCourtPeople() {
      const ids = [...(state.court.A ? state.court.A.ids : []), ...(state.court.B ? state.court.B.ids : [])].map(id => userIdOfPlayer(byId(id))).filter(Boolean);
      if (ids.length && cloudOn() && v7 === true) ensurePeople(ids);
    }

    /* Totals for any account, from the babas this phone knows (linked names). */
    function statsForUser(uid) {
      if (currentUser && uid === currentUser.id) return myStats() || { babas: 0, goals: 0, assists: 0, saves: 0, matches: 0, wins: 0 };
      const names = new Set();
      state.turmas.forEach(t => Object.entries(t.meta || {}).forEach(([n, m]) => { if (m && m.userId === uid) names.add(n); }));
      const tot = { babas: 0, goals: 0, assists: 0, saves: 0, matches: 0, wins: 0 };
      if (!names.size) return tot;
      state.pastDays.forEach(d => {
        const rows = (d.players || []).filter(p => names.has(String(p.name || '').trim().toLowerCase()));
        if (rows.length) tot.babas++;
        rows.forEach(p => ['goals', 'assists', 'saves', 'matches', 'wins'].forEach(k => { tot[k] += Number(p[k]) || 0; }));
      });
      const today = state.players.find(p => names.has(p.name.trim().toLowerCase()) && hasStats(p));
      if (today) { tot.babas++; ['goals', 'assists', 'saves', 'matches', 'wins'].forEach(k => { tot[k] += Number(today[k]) || 0; }); }
      return tot;
    }

    /* The athlete card ("figurinha"). */
    function athleteCardHtml(person, stats, opts = {}) {
      const c = cosOf(person.cosmetics);
      const bg = CARD_BGS[c.cardBg] ? c.cardBg : 'padrao';
      const nick = nickOf(c), title = titleOf(c), pip = pipocaOf(c);
      const st = stats || {};
      const cell = (v, l) => `<div class="acard-stat"><b>${Number(v) || 0}</b><span>${l}</span></div>`;
      return `
        <div class="acard acard-${bg}${opts.small ? ' acard-sm' : ''}">
          <div class="acard-shine"></div>
          <div class="acard-top"><span class="acard-brand">BABA</span>${title ? `<span class="acard-title">${escapeHtml(title)}</span>` : ''}</div>
          <div class="acard-photo">${framedAvatar(person.avatar, person.name, 'acard-avatar', Object.assign({}, c, { pipoca: null }))}
            ${MASCOTS.includes(c.mascot) ? `<img src="babinha/${c.mascot}.webp" alt="" class="acard-mascot" />` : ''}</div>
          <div class="acard-name">${styledName(person.name || '?', c)}</div>
          <div class="acard-nick">${nick ? `“${escapeHtml(nick)}”` : '&nbsp;'}</div>
          <div class="acard-stats">${cell(st.goals, 'gols')}${cell(st.assists, 'assist.')}${cell(st.saves, 'def.')}${cell(st.matches, 'jogos')}${cell(st.wins, 'vit.')}</div>
          ${cardTrophiesHtml(opts.trophies)}
          ${pip ? `<div class="acard-pipoca" title="Pipoca de ${escapeHtml(pip.from || 'alguém')}"><span>🍿</span><small>de ${escapeHtml(firstName(pip.from || 'alguém'))}</small></div>` : ''}
        </div>`;
    }

    let acardOpen = null;   // { uid, turmaId }
    async function openAthleteCard(uid, turmaId) {
      if (!uid) return;
      acardOpen = { uid, turmaId: turmaId || null };
      renderAthleteCard();
      document.getElementById('modal-acard').classList.remove('hidden');
      if (!(currentUser && uid === currentUser.id) && cloudOn() && v7 === true) {
        peopleCache.delete(uid);
        await ensurePeople([uid]);
        if (acardOpen && acardOpen.uid === uid) renderAthleteCard();
      }
    }
    function closeAthleteCard() { document.getElementById('modal-acard').classList.add('hidden'); acardOpen = null; }
    function personFor(uid) {
      if (currentUser && uid === currentUser.id) return { id: uid, name: currentUser.name, avatar: currentUser.avatar, cosmetics: currentUser.cosmetics || {} };
      const c = peopleCache.get(uid);
      if (c) return c;
      for (const t of state.turmas) { const p = (t.people || []).find(x => x.id === uid); if (p) return p; }
      return { id: uid, name: '...', avatar: null, cosmetics: {} };
    }
    function renderAthleteCard() {
      if (!acardOpen) return;
      const { uid, turmaId } = acardOpen;
      const me = currentUser && uid === currentUser.id;
      const person = personFor(uid);
      const pip = pipocaOf(person.cosmetics);
      document.getElementById('acard-box').innerHTML = athleteCardHtml(person, statsForUser(uid), { trophies: userTrophyCache.get(uid) });
      if (!userTrophyCache.has(uid)) loadUserTrophies(uid).then(l => { if (l && acardOpen && acardOpen.uid === uid) renderAthleteCard(); });
      const t = turmaId ? turmaById(turmaId) : null;
      const tp = t && (t.people || []).find(x => x.id === uid);
      const canManage = !!(tp && !me && (t.role === 'owner' || (t.role === 'admin' && tp.role === 'member')));
      const actions = [];
      if (me) actions.push(`<button onclick="closeAthleteCard(); openShop('card')" class="btn-primary w-full h-12 text-[15px]"><i class="fa-solid fa-wand-magic-sparkles"></i> Mudar o visual</button>`);
      else if (v7 === true && cloudOn()) {
        actions.push(pip
          ? `<p class="text-[13px] text-ink-2 text-center leading-snug">🍿 ${escapeHtml(firstName(person.name || ''))} está com a pipoca de ${escapeHtml(pip.from || 'alguém')}. Some em ${pipocaLeft(pip)}.</p>`
          : `<button onclick="throwPipoca('${uid}')" class="btn-butter w-full h-12 text-[15px]">🍿 Jogar pipoca · 150 pts</button>
             <p class="text-[12px] text-ink-2 text-center leading-snug -mt-1">A pipoca fica 24 h no card de ${escapeHtml(firstName(person.name || ''))}, pra galera toda ver. Só entre gente da mesma turma.</p>`);
      }
      if (canManage) actions.push(`<button onclick="closeAthleteCard(); openPersonActions('${uid}')" class="btn-outline w-full h-11 text-[14px]"><i class="fa-solid fa-user-gear"></i> Cargo na turma</button>`);
      document.getElementById('acard-actions').innerHTML = actions.join('');
    }

    async function throwPipoca(uid) {
      const person = personFor(uid);
      if (!(await askConfirm(`Jogar pipoca no card de ${person.name}? Custa 150 baba points e fica lá por 24 h.`, '🍿 Jogar'))) return;
      try {
        await api.throwPipoca(uid);
        peopleCache.delete(uid);
        await Promise.all([refreshWallet(), ensurePeople([uid])]);
        renderAthleteCard();
        showToast(`🍿 Pipoca no card de ${firstName(person.name)}!`);
      } catch (e) {
        const m = String((e && e.message) || '');
        showToast(isNetworkError(e) ? 'Precisa de internet.' : m.includes('already') ? 'Já tem pipoca nesse card. Espera sumir.' : m.includes('limit') ? 'Máximo de 3 pipocas por dia.'
          : m.includes('not_friends') ? 'Só dá pra jogar pipoca em quem é da sua turma.' : m.includes('no_points') ? 'Faltam pontos.' : 'Não deu certo agora.', 'warning');
      }
    }

    /* ---- Anúncio de gol ---- */
    let goalCardTimer = null;
    function showGoalCard(name, c, side) {
      const g = cosOf(c);
      if (!GOAL_CARDS[g.goalCard]) return false;
      const box = document.getElementById('goal-card');
      const nick = nickOf(g);
      box.className = `goal-card gc-${g.goalCard}`;
      box.innerHTML = `
        <div class="gc-inner">
          <p class="gc-word">GOOOL!</p>
          ${MASCOTS.includes(g.mascot) ? `<img src="babinha/${g.mascot}.webp" alt="" class="gc-mascot" />` : ''}
          <p class="gc-name">${escapeHtml(name)}</p>
          ${nick ? `<p class="gc-nick">“${escapeHtml(nick)}”</p>` : ''}
          ${titleOf(g) ? `<p class="gc-title">${escapeHtml(titleOf(g))}</p>` : ''}
          ${side ? `<p class="gc-side">${escapeHtml(side)}</p>` : ''}
        </div>`;
      clearTimeout(goalCardTimer);
      goalCardTimer = setTimeout(() => box.classList.add('hidden'), 2800);
      return true;
    }

    /* ---- Sons de gol (sintetizados) ---- */
    function playGoalSound(kind) {
      if (!prefs.sound || !GOAL_SOUNDS[kind]) return false;
      try {
        unlockAudio();
        if (!audioCtx) return false;
        const ctx = audioCtx, t0 = ctx.currentTime;
        const out = ctx.createGain(); out.gain.value = 0.5; out.connect(ctx.destination);
        const tone = (type, f0, f1, at, dur, vol = 0.6) => {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = type; o.frequency.setValueAtTime(f0, t0 + at); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + at + dur);
          g.gain.setValueAtTime(0.0001, t0 + at); g.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
          o.connect(g); g.connect(out); o.start(t0 + at); o.stop(t0 + at + dur + 0.05);
        };
        const noise = (at, dur, vol, freq) => {
          const n = ctx.createBufferSource(), buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate), d = buf.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
          n.buffer = buf;
          const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 900; f.Q.value = 0.7;
          const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0 + at); g.gain.exponentialRampToValueAtTime(vol, t0 + at + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
          n.connect(f); f.connect(g); g.connect(out); n.start(t0 + at); n.stop(t0 + at + dur);
        };
        if (kind === 'corneta') { tone('sawtooth', 233, 0, 0, 0.5, 0.35); tone('sawtooth', 233, 0, 0.6, 0.9, 0.35); tone('square', 116, 0, 0, 1.5, 0.08); }
        else if (kind === 'sirene') { tone('triangle', 600, 1200, 0, 0.45); tone('triangle', 1200, 600, 0.45, 0.45); tone('triangle', 600, 1200, 0.9, 0.45); }
        else if (kind === 'tambor') { [0, 0.18, 0.36, 0.45, 0.54, 0.72, 0.9, 0.99, 1.08].forEach((at, i) => { tone('sine', i % 3 === 2 ? 180 : 110, 50, at, 0.16, 0.9); noise(at, 0.06, 0.25, 3000); }); }
        else if (kind === 'torcida') { noise(0, 2.2, 0.5, 700); noise(0.2, 1.8, 0.3, 1400); tone('sawtooth', 300, 420, 0.3, 1.2, 0.05); }
        else if (kind === 'arcade') { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone('square', f, 0, i * 0.09, 0.12, 0.25)); }
        return true;
      } catch (e) { return false; }
    }

    /* ---- Notificações push ---- */
    const VAPID_PUBLIC = 'BGgkiyAGMdsFYJVl2B_IzI_4WiOufsTU1x8Wp5ikWbp5JS_gZmFvQlGPK_Yhhwmc739wdpm-YrvXXN67MaRMI-Q';
    const LIVE_PUSH_FN = SUPABASE_URL + '/functions/v1/live-push';
    const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    function b64ToBytes(s) {
      const pad = '='.repeat((4 - s.length % 4) % 4);
      const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
      return Uint8Array.from(raw, c => c.charCodeAt(0));
    }
    async function pushSubscription(create) {
      if (!pushSupported()) throw new Error('unsupported');
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub && create) {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') throw new Error('denied');
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC) });
      }
      return sub;
    }
    const subKeys = sub => { const j = sub.toJSON(); return { endpoint: j.endpoint, p256dh: j.keys && j.keys.p256dh, auth: j.keys && j.keys.auth }; };
    function pushError(e) {
      const m = String((e && e.message) || '');
      if (m.includes('unsupported')) return isIos() && !isStandalone() ? 'No iPhone, os avisos funcionam com o BABA instalado na tela de início (Compartilhar → Adicionar à Tela de Início).' : 'Este navegador não recebe avisos.';
      if (m.includes('denied')) return 'Os avisos estão bloqueados. Libere as notificações do BABA nas configurações do navegador.';
      if (isNetworkError(e)) return 'Precisa de internet.';
      if (m.includes('no_game')) return 'Esse jogo já terminou.';
      if (isMissingFn(e)) return 'Os avisos chegam quando o servidor for atualizado.';
      return 'Não deu certo agora.';
    }

    /* Someone watching: follow this game. */
    async function toggleLiveFollow() {
      if (!liveView || !liveView.code) return;
      const btn = document.getElementById('lv-bell');
      btn.disabled = true;
      try {
        if (liveView.following) {
          const sub = await pushSubscription(false);
          if (sub) await api.dropPush(sub.endpoint, liveView.code, null);
          liveView.following = false;
          showToast('Avisos desse jogo desligados.');
        } else {
          const k = subKeys(await pushSubscription(true));
          await api.savePush(k.endpoint, k.p256dh, k.auth, liveView.code, null);
          liveView.following = true;
          showToast('Pronto! Você recebe os gols, as defesas e o resultado desse jogo.');
        }
      } catch (e) { showToast(pushError(e), 'warning'); }
      btn.disabled = false;
      renderLiveBell();
    }
    function renderLiveBell() {
      const btn = document.getElementById('lv-bell');
      if (!btn || !liveView) return;
      const on = !!liveView.following;
      btn.innerHTML = on ? '<i class="fa-solid fa-bell"></i> Avisando' : '<i class="fa-solid fa-bell"></i> Avisar gols';
      btn.classList.toggle('is-on', on);
    }
    async function loadLiveFollow() {
      if (!liveView || !pushSupported() || !api.pushStatus) return;
      try {
        const sub = await pushSubscription(false);
        if (!sub || !liveView) return;
        const r = await api.pushStatus(sub.endpoint, liveView.code);
        if (liveView) { liveView.following = !!(r && r.following); renderLiveBell(); }
      } catch (e) {}
    }

    /* A member: games of my turmas. */
    async function togglePushTurma(on) {
      const input = document.getElementById('pref-push-turma');
      try {
        if (on) {
          const k = subKeys(await pushSubscription(true));
          await api.savePush(k.endpoint, k.p256dh, k.auth, null, true);
          showToast('Pronto! Quando um baba das suas turmas for transmitido, você recebe os lances.');
        } else {
          const sub = await pushSubscription(false);
          if (sub) await api.dropPush(sub.endpoint, null, false);
        }
        lsSet('baba_push_turma_v1', on ? '1' : '0');
      } catch (e) {
        if (input) input.checked = !on;
        showToast(pushError(e), 'warning');
      }
    }
    async function renderPushPref() {
      const input = document.getElementById('pref-push-turma');
      const sub = document.getElementById('pref-push-sub');
      if (!input) return;
      renderAvisosUI();
      input.checked = lsGet('baba_push_turma_v1') === '1';
      if (!pushSupported()) { sub.innerText = isIos() && !isStandalone() ? 'No iPhone, instale o BABA na tela de início' : 'Este navegador não recebe avisos'; input.disabled = true; return; }
      input.disabled = false;
      sub.innerText = 'Início, gols, defesas e resultado, no celular';
      try {
        const s = await pushSubscription(false);
        if (!s) { input.checked = false; return; }
        const r = await api.pushStatus(s.endpoint, null);
        input.checked = !!(r && r.turma_on);
      } catch (e) {}
    }

    /* v11.4.2 · Avisos do servidor (lista aberta, lembrete de resposta, palpites liquidados): um interruptor para cada. */
    async function ensureAvisoPush(explicit) {
      try {
        const k = subKeys(await pushSubscription(true));
        await api.savePush(k.endpoint, k.p256dh, k.auth, null, null);
        if (explicit) showToast('Pronto! Os avisos chegam neste celular.');
      } catch (e) { showToast(pushError(e), 'warning'); }
      renderAvisosUI();
    }
    function setAviso(key, on) {
      setPref(key, !!on);
      if (on) ensureAvisoPush(false);
    }
    async function renderAvisosUI() {
      const box = document.getElementById('avisos-permit');
      if (!box) return;
      const msg = document.getElementById('avisos-permit-msg'), btn = document.getElementById('avisos-permit-btn');
      let has = false;
      if (!pushSupported()) {
        msg.innerText = isIos() && !isStandalone() ? 'No iPhone, instale o BABA na tela de início para receber avisos.' : 'Este navegador não recebe avisos.';
        btn.classList.add('hidden'); box.classList.remove('hidden'); return;
      }
      btn.classList.remove('hidden');
      try { has = Notification.permission === 'granted' && !!(await pushSubscription(false)); } catch (e) {}
      msg.innerText = Notification.permission === 'denied' ? 'Os avisos estão bloqueados. Libere as notificações do BABA nas configurações do navegador.' : 'Para os avisos chegarem, este celular precisa de permissão.';
      box.classList.toggle('hidden', has);
      if (Notification.permission === 'denied') btn.classList.add('hidden');
    }

    /* The organizer's phone tells the server; it pushes to everyone following. Never queued:
       a goal that arrives ten minutes late is no news. */
    function livePush(kind, key, title, body, tries = 0) {
      if (!cloudOn() || v7 !== true) return;
      if (!state.live || !state.live.id) {
        if (tries < 4) setTimeout(() => livePush(kind, key, title, body, tries + 1), 2000);
        return;
      }
      const live = state.live;
      (async () => {
        try {
          if (window.__BABA_FAKE_API__ && window.__BABA_FAKE_API__.livePush) { await api.livePush(live.id, live.code, kind, key, title, body); return; }
          const session = await api.getSession();
          if (!session) return;
          await fetch(LIVE_PUSH_FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: 'Bearer ' + session.access_token },
            body: JSON.stringify({ live_id: live.id, code: live.code, kind, key, title, body }) });
        } catch (e) {}
      })();
    }
    function playedClock() {
      const m = state.match;
      const played = Math.max(0, (m.initialSeconds || 420) + (m.addedSeconds || 0) - (m.secondsLeft || 0));
      return `${Math.floor(played / 60)}:${String(played % 60).padStart(2, '0')}`;
    }
    const scoreLine = () => { const { A, B } = state.court; return A && B ? `Time ${A.label} ${state.match.scoreA} × ${state.match.scoreB} Time ${B.label}` : ''; };

    /* ===================================================================
       LOJINHA
       =================================================================== */
    let shopItemsCache = null;
    let shopKind = 'frame';

    async function openShop(tab) {
      if (v7 !== true) { showToast('A Resenha chega quando o servidor for atualizado.', 'warning'); return; }
      const toCatalog = typeof tab === 'string' && SHOP_TABS.some(t => t[0] === tab);
      if (toCatalog) shopKind = tab;
      switchTab('loja');
      // v11.5: o catálogo fica no fim da Resenha; quem veio "mudar o visual" desce direto até a Lojinha.
      if (toCatalog) setTimeout(() => { const el = document.getElementById('shop-lojinha-title'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 350);
    }
    async function enterShop() {
      if (v7 !== true) { showToast('A Resenha chega quando o servidor for atualizado.', 'warning'); switchTab('inicio'); return; }
      renderShop();
      try {
        const [items] = await Promise.all([shopItemsCache ? Promise.resolve(shopItemsCache) : api.shopItems(), refreshWallet()]);
        shopItemsCache = items;
      } catch (e) {
        if (isNetworkError(e)) showToast('A Resenha precisa de internet.', 'warning');
      }
      renderShop();
      renderMissions();
      loadProp(true);
      if (propSub === 'rank') loadPropRank(true);
      loadMissions().then(loadLedger);
    }
    function closeShop() {
      const c = document.getElementById('tab-content-loja');
      if (c && !c.classList.contains('hidden')) switchTab('inicio');
      renderProfileBits();
    }
    function shopTab(kind) { shopKind = kind; renderShop(); }
    // Tab -> item kinds shown in it.
    const SHOP_TABS = [['frame', 'Molduras', ['frame']], ['name', 'Nomes', ['name']], ['fx', 'Brilhos', ['fx']], ['title', 'Títulos', ['nick', 'title']],
      ['mascot', 'Mascote', ['mascot']], ['card', 'Card', ['cardbg']], ['goal', 'Gol', ['goalcard', 'goalsound']]];
    const SLOT_OF_KIND = { frame: 'frame', name: 'name', title: 'title', mascot: 'mascot', goalcard: 'goalCard', cardbg: 'cardBg', goalsound: 'goalSound' };
    const slotOfItem = it => it.kind === 'fx' ? (String(it.id).startsWith('fx_frame_') ? 'frameShine' : 'nameShine') : SLOT_OF_KIND[it.kind];
    function previewGoalCard(tier) {
      const me = currentUser || {};
      showGoalCard(me.name || 'Craque', Object.assign({}, cosOf(me.cosmetics), { goalCard: tier }), 'Assim a galera vê seu gol');
    }
    function nickEditor() {
      const cur = nickOf(currentUser && currentUser.cosmetics);
      return `
        <div class="card p-3.5 col-span-2 space-y-2">
          <p class="text-[14px] font-extrabold">Seu codinome</p>
          <p class="text-[12.5px] text-ink-2 leading-snug -mt-1">Aparece entre aspas no seu card e no anúncio de gol. Até ${NICK_MAX} letras, sem ofensa.</p>
          <div class="flex gap-2">
            <input id="nick-input" maxlength="${NICK_MAX}" value="${escapeHtml(cur)}" placeholder="Ex.: Bezão, Paredão, Fominha" class="input flex-1 min-w-0" oninput="document.getElementById('nick-error').innerText = nickProblem(this.value)" />
            <button onclick="saveNick()" class="btn-primary h-12 px-4 text-[14px] flex-shrink-0">Salvar</button>
          </div>
          <p id="nick-error" class="text-[12.5px] font-semibold text-danger"></p>
        </div>`;
    }
    async function saveNick() {
      const v = document.getElementById('nick-input').value;
      const prob = nickProblem(v);
      if (prob) { document.getElementById('nick-error').innerText = prob; return; }
      try {
        const cos = await api.setNickname(v.trim().replace(/\s+/g, ' '));
        currentUser.cosmetics = cos || {};
        cacheProfile(); renderShop(); renderProfileBits();
        showToast(v.trim() ? `Agora você é “${v.trim()}”.` : 'Codinome tirado.');
      } catch (e) {
        const m = String((e && e.message) || '');
        document.getElementById('nick-error').innerText = isNetworkError(e) ? 'Precisa de internet.' : m.includes('bad_word') ? 'Esse codinome não rola. Escolha outro.' : m.includes('bad_') ? 'Só letras, números e espaço, de 2 a 20.' : 'Não deu certo agora.';
      }
    }

    function renderShop() {
      const me = currentUser || {};
      const cos = cosOf(me.cosmetics);
      paintBalance();
      const daily = document.getElementById('shop-daily');
      daily.disabled = !(wallet && wallet.daily);
      daily.innerHTML = wallet && wallet.daily ? '<i class="fa-solid fa-gift"></i> Pegar bônus do dia (+100)' : '<i class="fa-solid fa-clock"></i> Bônus de hoje já pego';
      document.getElementById('shop-preview-avatar').innerHTML = framedAvatar(me.avatar, me.name, 'w-16 h-16 text-[20px]', cos);
      document.getElementById('shop-preview-name').innerHTML = styledName(me.name || '', cos);
      document.getElementById('shop-preview-sub').innerHTML = [titleOf(cos) ? `<b class="text-pitch">${escapeHtml(titleOf(cos))}</b>` : '', nickOf(cos) ? `“${escapeHtml(nickOf(cos))}”` : ''].filter(Boolean).join(' · ') || 'Toque pra ver seu card';
      document.getElementById('shop-tabs').innerHTML = SHOP_TABS.map(([k, l]) => `<button onclick="shopTab('${k}')" class="chip flex-shrink-0 ${k === shopKind ? 'is-selected' : ''}">${l}</button>`).join('');
      const box = document.getElementById('shop-items');
      if (!shopItemsCache) { box.innerHTML = '<p class="col-span-2 text-[14px] text-ink-2 py-4 text-center">Carregando a lojinha...</p>'; return; }
      const owned = wallet ? wallet.items : new Set();
      // Team-only items show up only for whoever has them.
      const kinds = (SHOP_TABS.find(t => t[0] === shopKind) || SHOP_TABS[0])[2];
      const list = shopItemsCache.filter(it => kinds.includes(it.kind) && (it.exclusive !== 'dono' || owned.has(it.id)));
      if (!list.length) { box.innerHTML = '<p class="col-span-2 text-[14px] text-ink-2 py-4 text-center">Esses itens chegam quando o servidor for atualizado.</p>'; return; }
      const intro = { title: 'O título aparece embaixo do seu nome, no card e no chat.', mascot: 'O Babinha que te acompanha no card e no anúncio do seu gol.',
        card: 'O fundo do seu card de atleta, a figurinha que a galera vê ao tocar em você.', goal: 'Quando você marca (com o nome ligado à conta), o celular do baba anuncia seu gol com o seu cartão e toca o seu som.' }[shopKind];
      box.innerHTML = (intro ? `<p class="col-span-2 text-[12.5px] text-ink-2 leading-snug px-1 -mb-0.5">${intro}</p>` : '') + list.map(it => {
        if (it.kind === 'nick' && owned.has(it.id)) return nickEditor();
        const has = owned.has(it.id);
        const fxVal = it.tier || true;
        const isFrameFx = String(it.id).startsWith('fx_frame_');
        const slot = slotOfItem(it);
        const using = it.kind === 'fx' ? cos[slot] === fxVal : it.kind === 'nick' ? false : cos[slot] === it.tier;
        const preview = it.kind === 'title' ? `<span class="cos-title text-[13px]">${escapeHtml(TITLE_LABEL[it.tier] || it.title)}</span>`
          : it.kind === 'nick' ? `<span class="text-[17px] font-extrabold">“Codinome”</span>`
          : it.kind === 'mascot' ? `<img src="babinha/${it.tier}.webp" alt="" class="h-[64px] w-[64px] object-contain" />`
          : it.kind === 'cardbg' ? `<span class="acard-swatch acard-${it.tier}"><span>${escapeHtml(firstName(me.name) || 'Craque')}</span></span>`
          : it.kind === 'goalcard' ? `<button onclick="previewGoalCard('${it.tier}')" class="gc-swatch gc-${it.tier}">GOL!<small>ver</small></button>`
          : it.kind === 'goalsound' ? `<button onclick="playGoalSound('${it.tier}')" class="w-14 h-14 rounded-full bg-sunk text-pitch text-[20px]" aria-label="Ouvir"><i class="fa-solid fa-volume-high"></i></button>`
          : it.kind === 'frame'
          ? framedAvatar(me.avatar, me.name, 'w-14 h-14 text-[17px]', { frame: it.tier, frameShine: has ? cos.frameShine : false })
          : it.kind === 'name'
            ? `<span class="text-[19px] font-extrabold">${styledName(firstName(me.name) || 'Craque', { name: it.tier, nameShine: has ? cos.nameShine : false })}</span>`
            : isFrameFx
              ? framedAvatar(me.avatar, me.name, 'w-14 h-14 text-[17px]', { frame: cos.frame || 'ouro', frameShine: fxVal })
              : `<span class="text-[19px] font-extrabold">${styledName(firstName(me.name) || 'Craque', { name: cos.name || 'ouro', nameShine: fxVal })}</span>`;
        const afford = wallet && wallet.balance >= it.price;
        const badge = it.exclusive === 'fundador' ? '<span class="shop-badge"><i class="fa-solid fa-medal"></i> Fundador</span>'
          : it.exclusive === 'dono' ? '<span class="shop-badge"><i class="fa-solid fa-crown"></i> Exclusivo</span>' : '';
        const action = using
          ? `<button onclick="equipShopItem('${it.id}', false)" class="btn-butter w-full h-9 text-[12px]"><i class="fa-solid fa-check"></i> Usando</button>`
          : has ? `<button onclick="equipShopItem('${it.id}', true)" class="btn-primary w-full h-9 text-[12px]">Usar</button>`
            : it.exclusive ? `<p class="w-full min-h-9 flex items-center justify-center text-[11.5px] font-bold text-ink-2 leading-tight">${it.exclusive === 'fundador' ? 'Só para os 100 primeiros do BABA' : 'Exclusivo da equipe BABA'}</p>`
            : `<button onclick="buyShopItem('${it.id}')" ${afford ? '' : 'disabled'} class="btn-outline w-full h-9 text-[12px]"><i class="fa-solid fa-coins"></i> ${fmtPts(it.price)}</button>`;
        return `
          <div class="card p-3 flex flex-col items-center gap-2 text-center relative${it.exclusive ? ' shop-exclusive' : ''}">
            ${badge}
            <div class="h-[64px] flex items-center justify-center">${preview}</div>
            <p class="text-[13px] font-bold leading-tight">${escapeHtml(it.title)}</p>
            ${action}
          </div>`;
      }).join('');
    }

    async function buyShopItem(id) {
      const it = (shopItemsCache || []).find(x => x.id === id);
      if (!it || !wallet) return;
      if (!(await askConfirm(`Trocar ${fmtPts(it.price)} baba points por ${it.title}?`, 'Trocar'))) return;
      try {
        await api.buyItem(id);
        await refreshWallet();
        await equipShopItem(id, true, true);
        showToast(`${it.title} é sua!`);
        loadLedger();
      } catch (e) {
        const m = String((e && e.message) || '');
        showToast(isNetworkError(e) ? 'A lojinha precisa de internet.' : m.includes('no_points') ? 'Faltam pontos pra esse item.' : m.includes('owned') ? 'Você já tem esse item.' : m.includes('exclusive') ? 'Esse item é exclusivo: não está à venda.' : 'Não deu certo agora.', 'warning');
      }
    }

    async function equipShopItem(id, on, quiet) {
      const it = (shopItemsCache || []).find(x => x.id === id);
      if (!it) return;
      const slot = slotOfItem(it);
      if (!slot) { renderShop(); return; }
      try {
        const cos = await api.equipItem(slot, on ? id : null);
        currentUser.cosmetics = cos || {};
        cacheProfile();
        renderShop();
        renderProfileBits();
        if (!quiet) showToast(on ? 'Pronto, já está aparecendo pra galera.' : 'Item guardado.');
      } catch (e) {
        showToast(isNetworkError(e) ? 'Precisa de internet.' : 'Não deu certo agora.', 'warning');
      }
    }

    /* ===================================================================
       PALPITES PRÉ-JOGO (v11.4)
       Mais/Menos por atleta confirmado na lista e cravada de gols. Linha, cotação,
       trava e pagamento são do servidor (prop_markets, place_prop_bet...); aqui só se mostra.
       =================================================================== */
    let propEventId = null;            // lista aberta na seção Palpites (Resenha)
    let propForced = null;             // evento vindo do toque num aviso: abre mesmo que já tenha passado ou sido cancelado
    const propCache = new Map();       // eventId -> resposta de prop_markets
    let propCounts = {};               // eventId -> palpites abertos (chip do Início)
    let propCountsAt = 0;
    let propOff = null;                // true = servidor ainda sem a v11.4
    let propLoading = false;
    let propAudit = null;              // extrato do adm: { eventId, rows }
    const propMore = new Set();        // atletas com "ver mais" aberto
    let propDraft = null;              // bilhete em montagem
    const propLines = new Map();       // marketId -> linha escolhida por mim (v11.4.1)
    const PROP_METRIC = { goals: 'Gols', assists: 'Assistências', ga: 'Gols + assistências', saves: 'Defesas', wins: 'Jogos ganhos' };
    const fmtCot = n => Number(n).toFixed(2).replace('.', ',');
    const fmtLinha = n => Number(n).toFixed(1).replace('.', ',');
    const propIsLocked = d => !!d.locked || new Date(d.starts_at).getTime() <= Date.now();
    const propReady = () => cloudOn() && v7 === true && propOff !== true;

    function propSelLabel(m, key, line) {
      if (!isPlayerMarket(m)) return propOptLabel(m, key, line);   // v11.5: duelo, destaque e total
      if (m.kind === 'ou') return `${key === 'mais' ? 'Mais' : 'Menos'} ${fmtLinha(line != null ? line : m.line)}`;
      return key === '6+' ? '6 ou mais' : `${key} gol${key === '1' ? '' : 's'}`;
    }
    function propMyState(m, locked) {
      const b = m.bet;
      if (!b) return null;
      if (b.status === 'won') return ['Ganhou', 'bg-leaf/15 text-leaf'];
      if (b.status === 'lost') return ['Perdeu', 'bg-danger/10 text-danger'];
      if (b.status === 'void') return ['Devolvido', 'bg-sunk text-ink-2'];
      return locked || m.status !== 'open' ? ['Travado', 'bg-butter text-pitch'] : ['Aberto', 'bg-leaf/10 text-leaf'];
    }

    /* Início: quantos palpites abertos cada lista tem (o servidor também gera os mercados nessa leitura). */
    async function loadPropCounts(ids) {
      if (!propReady() || !ids.length || Date.now() - propCountsAt < 45000) return;
      propCountsAt = Date.now();
      try {
        const res = (await api.propOpenCounts(ids)) || {};
        const before = JSON.stringify(propCounts);
        Object.keys(res).forEach(k => { propCounts[k] = Number(res[k]) || 0; });
        if (JSON.stringify(propCounts) !== before) renderHomeEvents(true);
      } catch (e) {
        if (isMissingFn(e)) propOff = true;
      }
    }
    function propChipHtml(e) {
      const n = propCounts[e.id] || 0;
      if (!n) return '';
      return `<button onclick="event.stopPropagation(); openPalpites('${e.id}')" class="prop-chip inline-flex items-center gap-1.5 mt-2.5 h-8 px-3 rounded-full bg-butter text-pitch text-[12.5px] font-extrabold active:scale-[0.97] transition"><i class="fa-solid fa-bullseye text-[11px]"></i> ${n} palpite${n === 1 ? '' : 's'} aberto${n === 1 ? '' : 's'} <i class="fa-solid fa-chevron-right text-[9px]"></i></button>`;
    }
    function openPalpites(eventId) {
      propEventId = eventId;
      propSub = 'palpites';
      propNav = { view: 'home' };
      switchTab('loja');
      setTimeout(() => { const el = document.getElementById('shop-palpites'); if (el && !el.classList.contains('hidden')) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 350);
    }

    /* Listas que podem ter palpites: das minhas turmas, de ontem em diante, sem as canceladas. */
    function propCandidates() {
      const from = Date.now() - 3 * 864e5;
      return eventsCache.filter(e => e.status !== 'canceled' && new Date(e.starts_at).getTime() > from && turmaById(e.turma_id) && turmaById(e.turma_id).cloud)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    }
    function propPickEvent() {
      const c = propCandidates();
      if (propEventId && (c.some(e => e.id === propEventId) || (propForced === propEventId && eventsCache.some(e => e.id === propEventId)))) return propEventId;
      const withMarkets = c.find(e => (propCounts[e.id] || 0) > 0) || c.find(e => (propCache.get(e.id) || { markets: [] }).markets.length);
      const pick = withMarkets || c.find(evUpcoming) || null;
      return pick ? pick.id : null;
    }

    async function loadProp(force) {
      const box = document.getElementById('shop-palpites');
      if (!box) return;
      if (!propReady()) { box.classList.add('hidden'); return; }
      const id = propPickEvent();
      if (!id) { renderPropSection(); return; }   // sem lista: a seção fica com a sub-aba Ranking (o evento de um aviso continua guardado)
      propEventId = id;
      if (propLoading && !force) return;
      propLoading = true;
      try {
        const data = await api.propMarkets(id);
        propCache.set(id, data || { markets: [] });
        propCounts[id] = ((data || {}).markets || []).filter(m => m.status === 'open').length;
        // Pagamentos e devoluções mexem no saldo: confere de novo.
        if (((data || {}).markets || []).some(m => m.bet && m.bet.status !== 'open')) refreshWallet().then(paintBalance);
      } catch (e) {
        if (isMissingFn(e)) propOff = true;
        else if (isNetworkError(e) && !propCache.has(id)) { box.classList.remove('hidden'); box.innerHTML = '<p class="text-[13px] text-ink-2 px-1">Os palpites precisam de internet.</p>'; propLoading = false; return; }
      }
      propLoading = false;
      renderPropSection();
    }

    function renderPropSection() {
      const box = document.getElementById('shop-palpites');
      if (!box) return;
      // v11.5: a seção fica no topo da Resenha com as sub-abas Palpites e Ranking (some só sem servidor ou sem turma na nuvem).
      if (!propReady() || !propCloudTurmas().length) { box.classList.add('hidden'); return; }
      box.classList.remove('hidden');
      box.innerHTML = `
        <p class="eyebrow px-1 mb-2">Palpites</p>
        <div class="seg grid-cols-2 mb-3" id="prop-subtabs">
          <button onclick="propSubTab('palpites')" class="seg-btn ${propSub !== 'rank' ? 'is-selected' : ''}">Palpites</button>
          <button onclick="propSubTab('rank')" class="seg-btn ${propSub === 'rank' ? 'is-selected' : ''}"><i class="fa-solid fa-ranking-star mr-1"></i>Ranking</button>
        </div>
        ${propSub === 'rank' ? `<div id="prop-rank">${propRankHtml()}</div>` : `<div id="prop-palpites">${propPalpitesHtml()}</div>`}`;
    }

    function propPalpitesHtml() {
      const id = propEventId;
      const data = id && propCache.get(id);
      const e = id && eventsCache.find(x => x.id === id);
      if (!e) return '<div class="card p-4"><p class="text-[13px] text-ink-2 leading-snug">Nenhuma lista com palpites agora. Eles abrem quando a lista de um baba da sua turma chega a 4 confirmados.</p></div>';
      if (!data) return '<p class="text-[13px] text-ink-2 py-4 text-center">Carregando os palpites...</p>';
      if (!data.markets.length) {
        // Sem mercados: só um aviso (menos de 4 confirmados, por exemplo).
        return `<div class="card p-4"><p class="text-[14px] font-bold">${escapeHtml(evTurma(e).name)} · ${escapeHtml(evWhen(e))}</p>
            <p class="text-[13px] text-ink-2 mt-1 leading-snug">Os palpites abrem quando a lista chega a 4 confirmados.</p></div>`;
      }
      // v11.8: servidor novo = menu com telas curtas (Duelo, Destaque, Total, Por atleta, Meus palpites).
      if (data.v118) return propNavHtml(data, e);
      const locked = propIsLocked(data);
      const adult = !!data.adult;
      const chooser = propCandidates();
      const mine = data.markets.filter(m => m.bet);
      const byPlayer = new Map();
      data.markets.filter(isPlayerMarket).forEach(m => { if (!byPlayer.has(m.player_id)) byPlayer.set(m.player_id, []); byPlayer.get(m.player_id).push(m); });
      const open = data.markets.filter(m => m.status === 'open').length;
      const fase2 = propFase2Html(data);
      return `
        <div class="flex items-end justify-between gap-3 px-1 mb-2">
          <p class="text-[13px] text-ink-2 truncate min-w-0">${escapeHtml(evTurma(e).name)} · ${escapeHtml(evWhen(e))}</p>
          <span class="ev-tag flex-shrink-0 ${locked ? 'bg-sunk text-ink-2' : 'bg-leaf/10 text-leaf'}">${locked ? 'Palpites encerrados' : `${open} aberto${open === 1 ? '' : 's'}`}</span>
        </div>
        ${chooser.length > 1 ? `<div class="flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4 pb-2">${chooser.map(c => `<button onclick="propChoose('${c.id}')" class="chip ${c.id === id ? 'is-selected' : ''}">${escapeHtml(evTurma(c).name)} · ${escapeHtml(evWhen(c))}</button>`).join('')}</div>` : ''}
        <p class="text-[12px] text-ink-2 leading-snug px-1 mb-2.5">Escolha o palpite, o valor e confirme. A cotação fica congelada na hora do palpite. Trava no horário da lista ou no primeiro apito, e paga quando o baba é finalizado.${adult ? '' : ' <b class="text-ink">Palpitar é só para maiores de 18 anos; você pode ver as cotações.</b>'}</p>
        ${mine.length ? `<div class="card-flat overflow-hidden divide-y divide-ink/[0.07] mb-3">
          <p class="eyebrow px-4 pt-3 pb-1.5">Meus palpites</p>
          ${mine.map(m => { const st = propMyState(m, locked); return `
            <div class="flex items-center justify-between gap-3 px-4 py-2.5 text-[13.5px]">
              <span class="min-w-0"><span class="block font-semibold truncate">${escapeHtml(isPlayerMarket(m) ? `${m.player} · ${PROP_METRIC[m.metric]}` : propKindTitle(m))}</span>
                <span class="block text-[12px] text-ink-2">${escapeHtml(propSelLabel(m, m.bet.selection, m.bet.line))} · ${fmtPts(m.bet.stake)} pts · cotação ${fmtCot(m.bet.odd)}</span></span>
              <span class="ev-tag ${st[1]} flex-shrink-0">${st[0]}${m.bet.status === 'won' ? ` +${fmtPts(m.bet.payout)}` : ''}</span>
            </div>`; }).join('')}
        </div>` : ''}
        ${fase2 ? `<div class="space-y-4 mb-4">${fase2}</div>` : ''}
        ${byPlayer.size ? `${fase2 ? '<p class="section-tag px-1 mb-2">Por atleta</p>' : ''}<div class="space-y-2.5">${[...byPlayer.values()].map(ms => propPlayerHtml(ms, data)).join('')}</div>` : ''}
        ${data.admin ? propAdminHtml(id) : ''}`;
    }

    function propPlayerHtml(ms, data) {
      const p = ms[0];
      const ou = ms.filter(m => m.kind === 'ou');
      const exact = p.mine ? [] : ms.filter(m => m.kind === 'exact');   // cravada de gols em si mesmo não vale
      const more = propMore.has(p.player_id);
      // Até 3 linhas à vista (G, A e G+A; goleiro: Defesas); a cravada de gols fica em "ver mais".
      const shown = ou.slice(0, 3), hidden = ou.slice(3).concat(exact);
      const rows = shown.concat(more ? hidden : []);
      return `
        <div class="card p-3.5" data-prop-player="${p.player_id}">
          <div class="flex items-center gap-2">
            <span class="tile bg-butter text-pitch flex-shrink-0 !w-9 !h-9 text-[14px]"><i class="fa-solid ${p.keeper ? 'fa-hand' : 'fa-futbol'}"></i></span>
            <p class="text-[15px] font-extrabold leading-tight truncate min-w-0">${escapeHtml(p.player)}</p>
            ${p.rookie ? '<span class="ev-tag bg-butter text-pitch">Estreante</span>' : ''}
            ${p.mine ? '<span class="ev-tag bg-sunk text-ink-2">Você</span>' : ''}
          </div>
          ${rows.map(m => propRowHtml(m, data)).join('')}
          ${hidden.length ? `<button onclick="propToggleMore('${p.player_id}')" class="mt-2.5 text-[12.5px] font-bold text-pitch">${more ? 'ver menos' : 'ver mais'} <i class="fa-solid fa-chevron-${more ? 'up' : 'down'} text-[9px]"></i></button>` : ''}
        </div>`;
    }

    function propRowHtml(m, data) {
      const locked = propIsLocked(data) || m.status === 'locked';
      const title = m.kind === 'exact' ? 'Cravada de gols' : PROP_METRIC[m.metric];
      const tags = [m.adjusted ? '<span class="ev-tag bg-sunk text-ink-2">linha ajustada pelo adm</span>' : '', (() => { const s = propMyState(m, locked); return s ? `<span class="ev-tag ${s[1]}">${s[0]}</span>` : ''; })()].join('');
      let body;
      const sels = m.selections || [];
      if (m.status === 'void') {
        body = `<button disabled class="prop-btn w-full h-11 rounded-xl border border-ink/10 bg-sunk text-[13px] font-bold text-ink-2">${m.void_reason === 'suspenso' ? 'Suspenso pelo adm · pontos devolvidos' : 'Anulado · pontos devolvidos'}</button>`;
      } else if (m.status === 'settled') {
        const r = m.result || {};
        body = `<button disabled class="prop-btn w-full h-11 rounded-xl border border-ink/10 bg-sunk text-[13px] font-bold text-ink-2">Fez ${r.value}</button>`;
      } else if (locked || m.status !== 'open') {
        body = `<button disabled class="prop-btn w-full h-11 rounded-xl border border-ink/10 bg-sunk text-[13px] font-bold text-ink-2">Palpites encerrados</button>`;
      } else {
        const blocked = !data.adult || !!m.bet;
        const ladder = m.kind === 'ou' && Array.isArray(m.ladder) && m.ladder.length ? m.ladder : null;   // servidor v11.4.1+: o palpitador escolhe a linha
        const mk = (key, label, odd, ok, line, own) => {
          const picked = m.bet && m.bet.selection === key && (m.kind !== 'ou' || Number(m.bet.line != null ? m.bet.line : m.line) === Number(line));
          const off = blocked || own || !ok;
          return `<button ${off ? 'disabled' : ''} onclick="openBilhete('${m.id}', '${key}'${ladder ? ', ' + line : ''})" class="prop-btn h-11 rounded-xl border text-[13px] font-extrabold transition active:scale-[0.97] ${picked ? 'bg-pitch text-butter border-pitch' : 'bg-card border-ink/15 text-ink'} ${off && !picked ? 'opacity-40' : ''}" ${own ? 'title="Menos em si mesmo não vale"' : !ok ? 'title="Quase certo: não paga"' : ''}>${label}${ok ? ' · ' + fmtCot(odd) : ' · travado'}</button>`;
        };
        if (ladder) {
          let cur = m.bet ? Number(m.bet.line != null ? m.bet.line : m.line) : (propLines.has(m.id) ? propLines.get(m.id) : Number(m.line));
          let i = ladder.findIndex(x => Number(x.line) === cur); if (i < 0) i = Math.max(0, ladder.findIndex(x => Number(x.line) === Number(m.line)));
          const ent = ladder[i];
          const stepper = m.bet ? '' : `
            <div class="flex items-center justify-between mb-1.5">
              <button ${i <= 0 ? 'disabled' : ''} onclick="propStepLine('${m.id}', -1)" aria-label="Linha menor" class="chip !h-8 !px-3 text-[12px] disabled:opacity-30"><i class="fa-solid fa-minus text-[10px]"></i></button>
              <span class="text-[12.5px] text-ink-2">Linha <b class="text-ink text-[14px]">${fmtLinha(ent.line)}</b></span>
              <button ${i >= ladder.length - 1 ? 'disabled' : ''} onclick="propStepLine('${m.id}', 1)" aria-label="Linha maior" class="chip !h-8 !px-3 text-[12px] disabled:opacity-30"><i class="fa-solid fa-plus text-[10px]"></i></button>
            </div>`;
          body = `${stepper}<div class="grid grid-cols-2 gap-1.5">${mk('mais', 'Mais ' + fmtLinha(ent.line), ent.mais.odd, ent.mais.ok, ent.line, false)}${mk('menos', 'Menos ' + fmtLinha(ent.line), ent.menos.odd, ent.menos.ok, ent.line, m.mine)}</div>`;
        } else {
          const btn = s => mk(s.key, m.kind === 'ou' ? `${s.key === 'mais' ? 'Mais' : 'Menos'} ${fmtLinha(m.line)}` : (s.key === '6+' ? '6+' : s.key), s.odd, s.ok !== false, m.line, m.mine && s.key === 'menos');
          body = m.kind === 'ou' ? `<div class="grid grid-cols-2 gap-1.5">${sels.map(btn).join('')}</div>` : `<div class="grid grid-cols-4 gap-1.5">${sels.map(btn).join('')}</div>`;
        }
      }
      const adm = data.admin && (m.status === 'open' || m.status === 'locked') ? `
        <div class="flex items-center gap-1.5 mt-1.5">
          <button onclick="propSuspend('${m.id}')" class="chip !h-8 !px-3 text-[12px] !text-danger ml-auto">Suspender</button>
        </div>` : '';
      const bet = m.bet ? `<p class="text-[12px] text-ink-2 mt-1">Seu palpite: <b class="text-ink">${escapeHtml(propSelLabel(m, m.bet.selection, m.bet.line))}</b> · ${fmtPts(m.bet.stake)} pts · volta ${fmtPts(Math.floor(m.bet.stake * m.bet.odd))}</p>` : '';
      return `
        <div class="mt-3" data-market="${m.id}">
          <div class="flex items-center justify-between gap-2 mb-1"><p class="text-[12.5px] font-bold text-ink-2">${title}</p><span class="flex items-center gap-1 flex-wrap justify-end">${tags}</span></div>
          ${body}${bet}${adm}
        </div>`;
    }
    function propStepLine(id, dir) {
      const data = propCache.get(propEventId);
      const m = data && data.markets.find(x => x.id === id);
      if (!m || !Array.isArray(m.ladder)) return;
      const cur = propLines.has(id) ? propLines.get(id) : Number(m.line);
      let i = m.ladder.findIndex(x => Number(x.line) === cur); if (i < 0) i = 0;
      i = Math.max(0, Math.min(m.ladder.length - 1, i + dir));
      propLines.set(id, Number(m.ladder[i].line));
      renderPropSection();
    }

    function propAdminHtml(eventId) {
      const a = propAudit && propAudit.eventId === eventId ? propAudit.rows : null;
      return `
        <div class="mt-3">
          <button onclick="propToggleAudit('${eventId}')" class="w-full card p-3 flex items-center justify-between text-left">
            <span class="text-[13.5px] font-bold">Palpites da turma neste baba (adm)</span><i class="fa-solid fa-chevron-${a ? 'up' : 'down'} text-[11px] text-ink-3"></i>
          </button>
          ${a ? `<div class="card-flat overflow-hidden divide-y divide-ink/[0.07] mt-1.5">${a.length ? a.map(r => `
            <div class="px-4 py-2.5 text-[13px] flex items-center justify-between gap-3">
              <span class="min-w-0"><span class="block font-semibold truncate">${escapeHtml(r.name || 'Alguém')}${r.recorder ? ' <span class="ev-tag bg-butter text-pitch ml-1">registra os lances</span>' : ''}</span>
                <span class="block text-[12px] text-ink-2 truncate">${r.label ? escapeHtml(r.label) : `${escapeHtml(r.player)} · ${PROP_METRIC[r.metric]} · ${escapeHtml(r.kind === 'ou' ? (r.selection === 'mais' ? 'Mais ' : 'Menos ') + fmtLinha(r.line) : r.selection)}`} · ${fmtPts(r.stake)} pts</span></span>
              <span class="ev-tag flex-shrink-0 ${r.status === 'won' ? 'bg-leaf/15 text-leaf' : r.status === 'lost' ? 'bg-danger/10 text-danger' : 'bg-sunk text-ink-2'}">${{ open: 'aberto', won: 'ganhou', lost: 'perdeu', void: 'devolvido' }[r.status]}</span>
            </div>`).join('') : '<p class="px-4 py-3 text-[13px] text-ink-2">Ninguém palpitou ainda.</p>'}</div>` : ''}
        </div>`;
    }

    function propChoose(id) { propEventId = id; propAudit = null; propNav = { view: 'home' }; if (propCache.has(id)) renderPropSection(); loadProp(true); }
    function propToggleMore(pid) { if (propMore.has(pid)) propMore.delete(pid); else propMore.add(pid); renderPropSection(); }
    async function propToggleAudit(eventId) {
      if (propAudit && propAudit.eventId === eventId) { propAudit = null; renderPropSection(); return; }
      try { propAudit = { eventId, rows: (await api.propEventBets(eventId)) || [] }; renderPropSection(); }
      catch (e) { showToast(isNetworkError(e) ? 'Precisa de internet.' : 'Não deu certo agora.', 'warning'); }
    }

    function propError(e) {
      const m = String((e && e.message) || '');
      return isNetworkError(e) ? 'Sem internet agora.'
        : m.includes('locked') ? 'Os palpites desse baba já travaram.'
        : m.includes('market_closed') ? 'Esse palpite não está mais aberto.'
        : m.includes('self_under') ? 'Menos em si mesmo não vale.'
        : m.includes('self_exact') ? 'Cravada de gols em si mesmo não vale.'
        : m.includes('self_against') ? 'No seu duelo você só palpita em você mesmo.'
        : m.includes('bad_line') ? 'Essa linha não está disponível. Escolha outra.'
        : m.includes('bad_stake') ? 'O mínimo é 10 pontos.'
        : m.includes('no_points') ? 'Faltam pontos. Pegue o bônus do dia aqui na lojinha.'
        : m.includes('not_adult') ? 'Palpites são só para maiores de 18.'
        : m.includes('not_member') ? 'Só quem é da turma palpita.'
        : m.includes('already_bet') ? 'Você já fez um palpite nesse mercado.'
        : m.includes('has_bets') ? 'Já tem palpite nesse mercado: só dá para suspender.'
        : m.includes('not_allowed') ? 'Só o adm da turma faz isso.'
        : m.includes('too_likely') ? 'Esse lado é quase certo (mais de 85% de chance) e não paga. Escolha outra linha.'
        : m.includes('bad_metric') ? 'Escolha gols, assistências ou G+A.'
        : m.includes('bad_pair') ? 'Escolha dois atletas diferentes.'
        : 'Não deu certo agora. Tente de novo.';
    }

    /* Bilhete em folha: mercado -> valor -> confirmar. */
    function openBilhete(marketId, key, line) {
      const data = propCache.get(propEventId);
      const m = data && data.markets.find(x => x.id === marketId);
      if (!m) return;
      let odd, ln = null;
      if ((m.kind === 'ou' || m.kind === 'baba_total') && Array.isArray(m.ladder) && m.ladder.length && line != null) {
        const ent = m.ladder.find(x => Number(x.line) === Number(line));
        if (!ent || !ent[key] || !ent[key].ok) return;
        odd = Number(ent[key].odd); ln = Number(ent.line);
      } else {
        const s = (m.selections || []).find(x => x.key === key);
        if (!s) return;
        odd = Number(s.odd);
      }
      propDraft = { event: propEventId, market: m.id, key, line: ln, odd, stake: 10 };
      document.getElementById('pb-player').innerText = propKindTitle(m);
      document.getElementById('pb-label').innerText = propSelLabel(m, key, ln);
      document.getElementById('pb-odd').innerText = 'x' + fmtCot(odd);
      document.getElementById('pb-note').innerText = m.rookie && isPlayerMarket(m) ? 'Estreante: ainda sem histórico na turma, então a cotação vem da média da turma.' : propBilheteNote(m);
      document.getElementById('pb-error').classList.add('hidden');
      renderBilhete();
      document.getElementById('modal-pbilhete').classList.remove('hidden');
    }
    function closeBilhete() { document.getElementById('modal-pbilhete').classList.add('hidden'); propDraft = null; }
    function renderBilhete() {
      const d = propDraft;
      if (!d) return;
      const bal = wallet ? wallet.balance : 0;
      const can = bal >= 10;
      const r = document.getElementById('pb-range');
      document.getElementById('pb-balance').innerText = fmtPts(bal);
      document.getElementById('pb-range-box').classList.toggle('hidden', !can);
      document.getElementById('pb-empty').classList.toggle('hidden', can);
      if (can) {
        r.min = 10; r.max = bal; r.step = bal > 500 ? 10 : 5;
        if (!d.stake || d.stake > bal || d.stake < 10) d.stake = 10;
        r.value = d.stake;
        document.getElementById('pb-min').innerText = '10';
      } else d.stake = 0;
      document.getElementById('pb-stake').innerText = d.stake ? `${fmtPts(d.stake)} pts` : '';
      document.getElementById('pb-return').innerText = d.stake ? `Volta ${fmtPts(Math.floor(d.stake * d.odd))} pts` : 'Você precisa de pelo menos 10 pontos';
      document.getElementById('btn-pbilhete').disabled = !d.stake;
    }
    function propSlide(v) {
      const d = propDraft;
      if (!d) return;
      d.stake = Math.max(10, Math.round(Number(v)));
      document.getElementById('pb-stake').innerText = `${fmtPts(d.stake)} pts`;
      document.getElementById('pb-return').innerText = `Volta ${fmtPts(Math.floor(d.stake * d.odd))} pts`;
      document.getElementById('btn-pbilhete').disabled = false;
    }
    function propAll() {
      const d = propDraft;
      if (!d || !wallet || wallet.balance < 10) return;
      d.stake = wallet.balance;
      document.getElementById('pb-range').value = d.stake;
      propSlide(d.stake);
    }
    async function confirmBilhete() {
      const d = propDraft;
      if (!d || !d.stake) return;
      const btn = document.getElementById('btn-pbilhete');
      setBusy(btn, true, 'Enviando...');
      try {
        const r = await api.placePropBet(d.market, d.key, d.stake, d.line);
        if (wallet && r) { wallet.balance = r.balance; renderV7Bits(); paintBalance(); }
        closeBilhete();
        buzz([20, 30]);
        showToast(`Palpite feito! Se acertar, volta ${fmtPts(r ? r.payout : Math.floor(d.stake * d.odd))} pts.`);
        await loadProp(true);
        loadLedger();
      } catch (e) {
        const err = document.getElementById('pb-error');
        err.innerText = propError(e);
        err.classList.remove('hidden');
        if (/locked|market_closed/.test(String((e && e.message) || ''))) loadProp(true);
      } finally { setBusy(btn, false); renderBilhete(); }
    }

    /* Controle do adm: só Suspender (a linha agora é escolhida por quem palpita). */
    async function propSuspend(marketId) {
      const data = propCache.get(propEventId);
      const m = data && data.markets.find(x => x.id === marketId);
      if (!m) return;
      const what = isPlayerMarket(m) ? `${PROP_METRIC[m.metric] ? PROP_METRIC[m.metric].toLowerCase() : 'o palpite'} de ${m.player}` : propKindTitle(m);
      if (!(await askConfirm(`Suspender ${what}? O palpite é anulado e os pontos de todo mundo voltam.`, 'Suspender'))) return;
      try { await api.suspendPropMarket(marketId); await loadProp(true); showToast('Palpite suspenso e pontos devolvidos.'); if (propAudit) { propAudit = null; await propToggleAudit(propEventId); } }
      catch (e) { showToast(propError(e), 'warning'); loadProp(true); }
    }

    /* ===================================================================
       MISSÕES DA SEMANA
       Progress is counted by the server from real records (days in the app,
       babas, goals, chat, palpites); the reward is claimed once per week.
       =================================================================== */
    let missionsCache = null;   // null = not loaded / server without missions
    async function loadMissions() {
      if (!cloudOn() || v7 !== true) return null;
      try { missionsCache = await api.myMissions(); }
      catch (e) { if (isMissingFn(e)) missionsCache = null; }
      renderMissions();
      return missionsCache;
    }
    const missionsReady = () => (missionsCache || []).filter(m => !m.claimed && m.progress >= m.target).length;
    function renderMissions() {
      const box = document.getElementById('shop-missions');
      if (!box) return;
      if (!missionsCache || !missionsCache.length) { box.innerHTML = ''; box.classList.add('hidden'); return; }
      box.classList.remove('hidden');
      const end = missionsCache[0].week_end ? new Date(missionsCache[0].week_end + 'T12:00:00') : null;
      const done = missionsCache.filter(m => m.claimed).length;
      box.innerHTML = `
        <div class="flex items-end justify-between gap-3 px-1 mb-2">
          <div><p class="eyebrow">Missões da semana</p><p class="text-[12px] text-ink-2 mt-0.5">${done} de ${missionsCache.length} feitas${end ? ` · renova na segunda` : ''}</p></div>
          <img src="babinha/calculante.webp" alt="" class="w-12 h-12 object-contain -mb-1" />
        </div>
        <div class="card-flat overflow-hidden divide-y divide-ink/[0.07]">
          ${missionsCache.map(m => {
            const ready = !m.claimed && m.progress >= m.target;
            const pct = Math.round(Math.min(1, m.progress / m.target) * 100);
            return `
            <div class="px-4 py-3 flex items-center gap-3">
              <div class="min-w-0 flex-1">
                <p class="text-[14px] font-bold leading-tight ${m.claimed ? 'text-ink-2' : ''}">${escapeHtml(m.title)}</p>
                <p class="text-[12px] text-ink-2 leading-snug mt-0.5">${escapeHtml(m.description)}</p>
                <div class="flex items-center gap-2 mt-1.5">
                  <span class="flex-1 h-1.5 rounded-full bg-sunk overflow-hidden"><span class="block h-full rounded-full ${m.claimed ? 'bg-ink-3' : 'bg-pitch'}" style="width:${pct}%"></span></span>
                  <span class="text-[11px] font-bold text-ink-2 tabular">${m.progress}/${m.target}</span>
                </div>
              </div>
              ${m.claimed ? `<span class="text-[12px] font-extrabold text-leaf flex-shrink-0"><i class="fa-solid fa-check"></i> +${fmtPts(m.reward)}</span>`
                : ready ? `<button onclick="claimMissionUI('${escapeHtml(m.id)}')" class="btn-primary h-9 px-3 text-[12px] flex-shrink-0">Pegar +${fmtPts(m.reward)}</button>`
                : `<span class="text-[12px] font-extrabold text-ink-2 bg-sunk rounded-full px-2.5 py-1 flex-shrink-0">+${fmtPts(m.reward)}</span>`}
            </div>`;
          }).join('')}
        </div>`;
    }
    async function claimMissionUI(id) {
      const m = (missionsCache || []).find(x => x.id === id);
      try {
        const bal = await api.claimMission(id);
        if (wallet) wallet.balance = bal;
        if (m) m.claimed = true;
        renderMissions(); renderShop(); renderV7Bits(); renderHomeV7(); loadLedger();
        buzz([20, 40, 20]);
        showToast(`Missão cumprida! +${fmtPts(m ? m.reward : 0)} baba points`);
      } catch (e) {
        const msg = String((e && e.message) || '');
        showToast(isNetworkError(e) ? 'Precisa de internet.' : msg.includes('already') ? 'Essa missão já foi resgatada.' : msg.includes('not_done') ? 'Ainda falta um pouco pra essa.' : 'Não deu certo agora.', 'warning');
        loadMissions();
      }
    }

    async function claimDaily() {
      try {
        const bal = await api.claimDaily();
        if (wallet) { wallet.balance = bal; wallet.daily = false; }
        renderShop();
        renderV7Bits();
        showToast('+100 baba points. Volte amanhã!');
        loadLedger();
      } catch (e) {
        const m = String((e && e.message) || '');
        showToast(isNetworkError(e) ? 'Precisa de internet.' : m.includes('already') ? 'O bônus de hoje já foi pego.' : 'Não deu certo agora.', 'warning');
      }
    }

    async function loadLedger() {
      const box = document.getElementById('shop-ledger');
      try {
        const rows = await api.ledger();
        const why = r => ({ 'boas-vindas': 'Boas-vindas', 'bonus-diario': 'Bônus do dia', 'palpite': 'Palpite feito', 'palpite-certo': 'Palpite certo', 'palpite-devolvido': 'Palpite devolvido', 'palpite-pre': 'Palpite pré-jogo', 'palpite-pre-ganho': 'Palpite pré-jogo certo', 'palpite-pre-devolvido': 'Palpite pré-jogo devolvido', 'palpite-correcao': 'Correção de palpite', 'suporte': 'Ajuste do suporte' })[r.reason]
          || (r.reason === 'missao' ? 'Missão: ' + (((missionsCache || []).find(m => m.id === String(r.ref || '').split(':')[0]) || {}).title || 'da semana') : null)
          || (r.reason === 'lojinha' ? ((shopItemsCache || []).find(x => x.id === r.ref) || {}).title || 'Lojinha' : r.reason);
        box.innerHTML = rows.length ? rows.map(r => `
          <div class="flex items-center justify-between gap-3 px-4 py-2.5 text-[14px]">
            <span class="min-w-0"><span class="block font-semibold truncate">${escapeHtml(why(r))}</span><span class="block text-[11px] text-ink-3">${new Date(r.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></span>
            <span class="font-extrabold tabular ${r.delta > 0 ? 'text-leaf' : 'text-ink-2'}">${r.delta > 0 ? '+' : ''}${fmtPts(r.delta)}</span>
          </div>`).join('') : '<p class="px-4 py-3 text-[13px] text-ink-2">Nada ainda.</p>';
      } catch (e) {
        box.innerHTML = '<p class="px-4 py-3 text-[13px] text-ink-2">O extrato aparece com internet.</p>';
      }
    }

