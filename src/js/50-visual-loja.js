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
      document.getElementById('acard-box').innerHTML = athleteCardHtml(person, statsForUser(uid));
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
      if (v7 !== true) { showToast('A lojinha chega quando o servidor for atualizado.', 'warning'); return; }
      if (typeof tab === 'string' && SHOP_TABS.some(t => t[0] === tab)) shopKind = tab;
      switchTab('loja');
    }
    async function enterShop() {
      if (v7 !== true) { showToast('A lojinha chega quando o servidor for atualizado.', 'warning'); switchTab('inicio'); return; }
      renderShop();
      try {
        const [items] = await Promise.all([shopItemsCache ? Promise.resolve(shopItemsCache) : api.shopItems(), refreshWallet()]);
        shopItemsCache = items;
      } catch (e) {
        if (isNetworkError(e)) showToast('A lojinha precisa de internet.', 'warning');
      }
      renderShop();
      renderMissions();
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
      document.getElementById('shop-balance').innerText = wallet ? fmtPts(wallet.balance) : '...';
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
        const why = r => ({ 'boas-vindas': 'Boas-vindas', 'bonus-diario': 'Bônus do dia', 'palpite': 'Palpite feito', 'palpite-certo': 'Palpite certo', 'palpite-devolvido': 'Palpite devolvido', 'suporte': 'Ajuste do suporte' })[r.reason]
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

