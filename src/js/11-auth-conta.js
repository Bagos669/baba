    /* ---- Auth screens ---- */
    let landingTimer = null;

    function showAuth(screen) {
      document.getElementById('app-root').classList.add('hidden');
      document.getElementById('auth-root').classList.remove('hidden');
      authGo(screen);
    }

    function authGo(name) {
      document.querySelectorAll('.auth-screen').forEach(s => s.classList.add('hidden'));
      document.getElementById('scr-' + name).classList.remove('hidden');
      document.getElementById('auth-root').scrollTop = 0;
      document.querySelectorAll('#auth-root [id$="-error"]').forEach(e => e.classList.add('hidden'));
      if (name === 'landing') startLandingDemo(); else stopLandingDemo();
      if (name === 'login') {
        const u = document.getElementById('login-email');
        if (!u.value) u.value = lsGet('baba_last_email') || '';
        document.getElementById('login-pass').value = '';
      }
      if (name === 'forgot') {
        document.getElementById('forgot-email').value = document.getElementById('login-email').value || lsGet('baba_last_email') || '';
        document.getElementById('forgot-code').value = '';
        document.getElementById('forgot-pass').value = '';
      }
      if (name === 'lock' && pendingLockUser) {
        document.getElementById('lock-name').innerText = firstName(pendingLockUser.name) + '.';
      }
    }

    /* The landing's sample clock ticks down, the one moving thing on the page. */
    function startLandingDemo() {
      stopLandingDemo();
      let secs = 252;
      const el = document.getElementById('landing-timer');
      el.innerHTML = digitsHtml(fmtMMSS(secs));
      landingTimer = setInterval(() => {
        secs = secs <= 0 ? 420 : secs - 1;
        el.innerHTML = digitsHtml(fmtMMSS(secs));
      }, 1000);
    }
    function stopLandingDemo() {
      if (landingTimer) clearInterval(landingTimer);
      landingTimer = null;
    }

    function showErr(id, msg) {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerText = msg;
      el.classList.toggle('hidden', !msg);
    }

    function setBusy(btn, busy, label) {
      if (!btn) return;
      if (busy) {
        btn.dataset.label = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${label || 'Aguarde...'}`;
        btn.disabled = true;
      } else {
        if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
        btn.disabled = false;
      }
    }

    function togglePass(inputId, btn) {
      const input = document.getElementById(inputId);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
      btn.setAttribute('aria-label', show ? 'Esconder senha' : 'Mostrar senha');
    }

    const OFFLINE_MSG = 'Sem conexão com o servidor. Confira a internet e tente de novo.';
    function accountError(code) {
      return ({
        name_required: 'Digite seu nome.',
        invalid_email: 'Esse e-mail não parece válido.',
        weak_password: 'A senha precisa ter pelo menos 6 caracteres.',
        email_taken: 'Já existe uma conta com esse e-mail. Entre com ela ou use "Esqueci minha senha".',
        invalid_code: 'E-mail ou código de recuperação incorretos.',
        locked: 'Muitas tentativas erradas. Espere 15 minutos e tente de novo.',
        unauthorized: 'Sua sessão expirou. Entre de novo.'
      })[code] || 'Algo deu errado no servidor. Tente de novo.';
    }
    function signInError(e) {
      if (isNetworkError(e)) return OFFLINE_MSG;
      const m = String(e && (e.code || e.message) || '').toLowerCase();
      if (m.includes('invalid')) return 'E-mail ou senha incorretos.';
      return 'Não foi possível entrar. Tente de novo.';
    }

    async function doSignup() {
      const name = document.getElementById('signup-name').value.trim().replace(/\s+/g, ' ');
      const email = document.getElementById('signup-email').value.trim().toLowerCase();
      const pass = document.getElementById('signup-pass').value;
      if (!name) return showErr('signup-error', 'Digite seu nome.');
      if (!validEmail(email)) return showErr('signup-error', 'Digite um e-mail válido.');
      if (pass.length < 6) return showErr('signup-error', 'A senha precisa ter pelo menos 6 caracteres.');
      if (!api.enabled()) return showErr('signup-error', OFFLINE_MSG);
      showErr('signup-error', '');
      const btn = document.getElementById('btn-signup');
      setBusy(btn, true, 'Criando conta...');
      try {
        const res = await api.signup(name, email, pass);
        if (!res.ok) return showErr('signup-error', accountError(res.body.error));
        const session = await api.signIn(email, pass);
        lsSet('baba_last_email', email);
        pendingSignup = { session, code: res.body.code };
        document.getElementById('recovery-code').value = res.body.code;
        document.getElementById('recovery-ack').checked = false;
        document.getElementById('btn-recovery-done').disabled = true;
        ['signup-name', 'signup-email', 'signup-pass'].forEach(id => { document.getElementById(id).value = ''; });
        authGo('recovery');
      } catch (e) {
        showErr('signup-error', isNetworkError(e) ? OFFLINE_MSG : 'Não foi possível criar a conta.');
      } finally {
        setBusy(btn, false);
      }
    }

    async function recoveryDone() {
      if (!pendingSignup) return showAuth('login');
      if (await bioAvailable()) {
        showErr('bio-offer-error', '');
        authGo('bio');
      } else {
        finishSignup();
      }
    }

    async function bioOfferAccept() {
      if (!pendingSignup) return;
      const btn = document.getElementById('btn-bio-accept');
      setBusy(btn, true, 'Encoste o dedo...');
      try {
        const u = pendingSignup.session.user;
        const credId = await registerBio({ id: u.id, email: u.email, name: (u.user_metadata || {}).name || u.email });
        lsSet(LOCK_PREFIX + u.id, JSON.stringify({ credId }));
        finishSignup('Digital ativada: o BABA vai pedir a digital ao abrir.');
      } catch (e) {
        showErr('bio-offer-error', bioErrorMessage(e));
      } finally {
        setBusy(btn, false);
      }
    }

    function finishSignup(extra) {
      const p = pendingSignup;
      pendingSignup = null;
      if (!p) return showAuth('login');
      enterWithSession(p.session, false);
      showToast(extra || `Conta criada. Bem-vindo, ${firstName(currentUser ? currentUser.name : '')}!`);
    }

    async function doLogin() {
      const email = document.getElementById('login-email').value.trim().toLowerCase();
      const pass = document.getElementById('login-pass').value;
      if (!validEmail(email)) return showErr('login-error', 'Digite o e-mail da sua conta.');
      if (!pass) return showErr('login-error', 'Digite a senha.');
      if (!api.enabled()) return showErr('login-error', OFFLINE_MSG);
      const btn = document.getElementById('btn-login');
      setBusy(btn, true, 'Entrando...');
      try {
        const session = await api.signIn(email, pass);
        lsSet('baba_last_email', email);
        enterWithSession(session, false);
      } catch (e) {
        document.getElementById('login-pass').select();
        showErr('login-error', signInError(e));
      } finally {
        setBusy(btn, false);
      }
    }

    async function doForgot() {
      const email = document.getElementById('forgot-email').value.trim().toLowerCase();
      const code = document.getElementById('forgot-code').value;
      const pass = document.getElementById('forgot-pass').value;
      if (!validEmail(email)) return showErr('forgot-error', 'Digite o e-mail da sua conta.');
      if (normCode(code).length !== 12) return showErr('forgot-error', 'O código tem 12 letras e números, no formato XXXX-XXXX-XXXX.');
      if (pass.length < 6) return showErr('forgot-error', 'A nova senha precisa ter pelo menos 6 caracteres.');
      const btn = document.getElementById('btn-forgot');
      setBusy(btn, true, 'Salvando...');
      try {
        const res = await api.reset(email, code, pass);
        if (!res.ok) return showErr('forgot-error', accountError(res.body.error));
        const session = await api.signIn(email, pass);
        lsSet('baba_last_email', email);
        enterWithSession(session, false);
        showToast('Senha alterada. Bem-vindo de volta!');
      } catch (e) {
        showErr('forgot-error', isNetworkError(e) ? OFFLINE_MSG : 'Não foi possível trocar a senha.');
      } finally {
        setBusy(btn, false);
      }
    }

    const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    function userFromSession(session) {
      const u = session.user;
      return { id: u.id, email: u.email, name: ((u.user_metadata || {}).name || (u.email || '').split('@')[0] || 'Craque') };
    }

    function readLock(uid) { try { return JSON.parse(lsGet(LOCK_PREFIX + uid) || 'null'); } catch (e) { return null; } }

    function enterWithSession(session, checkLock) {
      const user = userFromSession(session);
      const lock = readLock(user.id);
      if (checkLock && lock && lock.credId) {
        pendingLockUser = Object.assign(user, { credId: lock.credId });
        showAuth('lock');
        return;
      }
      enterApp(user);
    }

    async function unlockWithBio() {
      if (!pendingLockUser) return;
      const btn = document.getElementById('btn-unlock');
      setBusy(btn, true, 'Encoste o dedo...');
      try {
        await verifyBio(pendingLockUser);
        const u = pendingLockUser;
        pendingLockUser = null;
        enterApp({ id: u.id, email: u.email, name: u.name });
      } catch (e) {
        showErr('lock-error', bioErrorMessage(e));
      } finally {
        setBusy(btn, false);
      }
    }

    async function lockUseOtherAccount() {
      pendingLockUser = null;
      await api.signOut();
      showAuth('login');
    }

    function enterApp(user) {
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
      const cached = readCachedProfile(user.id);
      if (cached) { if (cached.name) user.name = cached.name; user.avatar = cached.avatar || null; user.cosmetics = cached.cosmetics || {}; }
      currentUser = user;
      lastPull = 0;
      loadState();
      if (state.match.isRunning && state.match.endAt) runTicker();
      else { state.match.isRunning = false; state.match.endAt = null; }
      stopLandingDemo();
      document.getElementById('auth-root').classList.add('hidden');
      document.getElementById('app-root').classList.remove('hidden');
      renderAllComponents();
      switchTab('inicio');
      setSync(readOutbox().length ? 'syncing' : 'ok');
      pullCloud(true).then(() => {
        if (!currentUser || currentUser.id !== user.id) return;
        refreshAccount().then(() => {
          if (!currentUser || currentUser.id !== user.id) return;
          refreshWallet().then(renderHomeV7);
          loadMissions().then(renderHomeV7);
          loadLiveList();
          // Terms first, then (first time) the Babinha tour, then invites, old data and a pending live game.
          ensureTerms(() => startTour(false, () => {
            popupsArmed = true;
            maybePopups();
            handlePendingInvite();
            offerLocalImport();
            const lc = takePendingLive();
            if (lc) openLive(lc);
            // Toque num aviso de palpites com o app fechado: a Resenha só abre depois de o servidor responder (v7 conhecido).
            else openPendingPalpites();
          }));
        });
      });
    }

    async function logout() {
      if (!(await askConfirm('Sair da conta? O baba de hoje fica salvo e volta quando você entrar de novo.', 'Sair'))) return;
      closeProfile(); closeSettings();
      saveState();
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
      releaseWakeLock();
      await api.signOut();
      currentUser = null;
      prefsPulledFor = null;
      account = null; wallet = null; v7 = null; liveListCache = []; status8 = null; missionsCache = null; popupsArmed = false; othersOpen = [];
      { const ps = document.getElementById('profile-staff'); if (ps) ps.classList.add('hidden'); }
      state = defaultState();
      showAuth('login');
    }

    /* ---- Invites ---- */
    function readInviteFromUrl() {
      const m = (location.hash + '&' + location.search).match(/convite=([A-Za-z0-9-]{4,12})/);
      if (m) {
        try { sessionStorage.setItem('baba_pending_invite', m[1]); } catch (e) {}
        try { history.replaceState(null, '', location.pathname); } catch (e) {}
      }
    }

    async function handlePendingInvite() {
      let code = null;
      try { code = sessionStorage.getItem('baba_pending_invite'); sessionStorage.removeItem('baba_pending_invite'); } catch (e) {}
      if (code) joinTurmaWithCode(code);
    }

    async function joinTurmaWithCode(code) {
      if (!cloudOn()) { showToast('Entrar numa turma precisa de internet.', 'warning'); return false; }
      try {
        const rows = await api.join(code);
        const t = rows[0];
        await pullCloud(true);
        showToast(t ? `Você entrou na turma ${t.name}. Toque no seu nome para ligar à sua conta.` : 'Você entrou na turma.');
        if (t) { openDatabaseModal(); openTurmaEditor(t.id); }
        return true;
      } catch (e) {
        showToast(isNetworkError(e) ? OFFLINE_MSG : 'Código de convite inválido.', 'warning');
        return false;
      }
    }

    function inviteLink(code) {
      const base = location.protocol.startsWith('http') ? location.origin + location.pathname : 'https://baba.app/';
      return `${base}#convite=${code}`;
    }

    async function shareInvite(turmaId) {
      const t = turmaById(turmaId);
      if (!t) return;
      if (!t.invite) { showToast('A turma ainda está sincronizando. Tente em alguns segundos.', 'warning'); return; }
      const link = inviteLink(t.invite);
      const text = `Entra na turma ${t.name} no BABA: ${link}\nOu use o código ${t.invite}.`;
      if (navigator.share) {
        try { await navigator.share({ title: 'BABA', text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
      }
      copyText(text, null, 'Convite copiado. Cole no grupo da turma.');
    }

    async function regenerateInvite(turmaId) {
      const t = turmaById(turmaId);
      if (!t || !canEditTurma(t)) return;
      if (!(await askConfirm('Gerar um código novo? O link antigo para de funcionar, quem já entrou continua na turma.', 'Gerar novo'))) return;
      const bytes = randBytes(8);
      let code = '';
      for (let i = 0; i < 8; i++) code += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
      try {
        await api.setInvite(t.id, code);
        t.invite = code;
        cacheState();
        renderTurmaEditor();
        showToast('Código novo gerado.');
      } catch (e) {
        showToast(isNetworkError(e) ? OFFLINE_MSG : 'Não foi possível gerar o código.', 'warning');
      }
    }

    function openJoinSheet() {
      document.getElementById('account-title').innerText = 'Entrar com convite';
      document.getElementById('account-body').innerHTML = `
        <form class="space-y-3.5" onsubmit="event.preventDefault(); submitJoin();" novalidate>
          <p class="text-[14px] text-ink-2 leading-snug">Peça o código ou o link para alguém da turma. O código tem 8 letras e números.</p>
          <label class="block">
            <span class="label">Código da turma</span>
            <input id="join-code" class="field uppercase tracking-[0.14em]" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="EX: 8EFE8C78" />
          </label>
          <p id="account-error" class="hidden text-[13px] font-semibold text-danger"></p>
          <button id="btn-account" class="btn-primary w-full py-3.5 text-[15px]">Entrar na turma</button>
        </form>`;
      document.getElementById('modal-account').classList.remove('hidden');
      setTimeout(() => { const f = document.getElementById('join-code'); if (f) f.focus(); }, 200);
    }

    async function submitJoin() {
      const code = normCode(document.getElementById('join-code').value);
      if (code.length < 6) return showErr('account-error', 'Digite o código completo.');
      const btn = document.getElementById('btn-account');
      setBusy(btn, true, 'Entrando...');
      closeAccountSheet();
      await joinTurmaWithCode(code);
    }

    /* ---- "Sou eu" ---- */
    async function claimPlayer(turmaId, name) {
      const t = turmaById(turmaId);
      const m = t && t.meta ? t.meta[name.toLowerCase()] : null;
      if (!m) { showToast('Esse nome ainda está sincronizando. Tente em alguns segundos.', 'warning'); return; }
      try {
        await api.claim(m.id);
        // Old stats saved under this name without the id get tied to the account (needs v11.2 on the server).
        api.relinkMyStats().then(() => pullCloud(true)).catch(() => {});
        Object.values(t.meta).forEach(x => { if (x.userId === currentUser.id) x.userId = null; });
        m.userId = currentUser.id;
        myPlayerIds = myPlayerIds.filter(id => !Object.values(t.meta).some(x => x.id === id)).concat(m.id);
        cacheState();
        renderTurmaEditor();
        renderHome();
        showToast(`Pronto: você é ${name} na turma ${t.name}.`);
      } catch (e) {
        showToast(isNetworkError(e) ? OFFLINE_MSG : 'Esse nome já está ligado a outra pessoa.', 'warning');
      }
    }

    async function confirmClaim(turmaId, name) {
      if (!(await askConfirm(`Você é ${name}? Seus gols, assistências e vitórias dessa turma vão aparecer em "Meus números".`, 'Sou eu'))) return;
      claimPlayer(turmaId, name);
    }

    async function unclaimPlayer(turmaId, name) {
      if (!(await askConfirm(`Desligar ${name} da sua conta?`, 'Desligar'))) return;
      const t = turmaById(turmaId);
      const m = t && t.meta ? t.meta[name.toLowerCase()] : null;
      if (!m) return;
      try {
        await api.unclaim(m.id);
        m.userId = null;
        myPlayerIds = myPlayerIds.filter(id => id !== m.id);
        cacheState();
        renderTurmaEditor();
        renderHome();
        showToast('Vínculo desfeito.');
      } catch (e) {
        showToast(isNetworkError(e) ? OFFLINE_MSG : 'Não foi possível desfazer o vínculo.', 'warning');
      }
    }

    /* Totals for the player linked to this account, across every baba it can see. */
    function myStats(venue) {
      if (!currentUser) return null;
      const linked = new Set(myPlayerIds);
      const myNamesToday = new Set();
      state.turmas.forEach(t => Object.entries(t.meta || {}).forEach(([n, m]) => { if (m.userId === currentUser.id) myNamesToday.add(n); }));
      if (!linked.size && !myNamesToday.size) return null;
      const tot = { babas: 0 };
      STAT_KEYS.forEach(k => { tot[k] = 0; });
      // Rows saved without the player's id (the name was linked later, or the player was recreated) still count when
      // the name is mine in one of that baba's turmas.
      const known = new Set();
      const myNameIn = {};
      state.turmas.forEach(t => Object.entries(t.meta || {}).forEach(([n, m]) => { known.add(m.id); if (m.userId === currentUser.id) myNameIn[t.id] = n; }));
      state.pastDays.filter(d => !venue || d.venue === venue).forEach(d => {
        const rows = d.players.filter(p => (p.cloudId && linked.has(p.cloudId))
          || ((!p.cloudId || !known.has(p.cloudId)) && (d.turmaIds || []).some(tid => myNameIn[tid] && myNameIn[tid] === String(p.name).trim().toLowerCase())));
        if (rows.length) tot.babas++;
        rows.forEach(p => STAT_KEYS.forEach(k => { tot[k] += Number(p[k]) || 0; }));
      });
      const today = (!venue || state.settings.venue === venue) && state.players.find(p => myNamesToday.has(p.name.trim().toLowerCase()) && hasStats(p));
      if (today) { tot.babas++; STAT_KEYS.forEach(k => { tot[k] += Number(today[k]) || 0; }); }
      // A baba someone else is organizing right now, where my name is linked.
      (venue ? [] : othersOpen).forEach(b => {
        const row = b.players.find(p => { const t = turmaById(p.turmaId); const m = t && t.meta ? t.meta[String(p.name).trim().toLowerCase()] : null; return m && m.userId === currentUser.id; });
        if (row) { tot.babas++; tot.live = true; STAT_KEYS.forEach(k => { tot[k] += Number(row[k]) || 0; }); }
      });
      return tot;
    }

    /* ---- Bring the pre-cloud data from this phone ---- */
    function findLocalData() {
      const out = [];
      const add = (key, label) => {
        const raw = lsGet(key);
        if (!raw) return;
        try {
          const s = migrate(JSON.parse(raw));
          const custom = s.turmas.filter(t => t.players.length);
          const days = s.pastDays.length + (s.matchHistory.length ? 1 : 0);
          if (!s.players.length && !days && !custom.length) return;
          out.push({ key, label, state: s, players: s.players.length, days, turmas: custom.length });
        } catch (e) {}
      };
      add(STORAGE_KEY, 'Dados salvos neste aparelho');
      try {
        const accs = (JSON.parse(lsGet(LEGACY_ACCOUNTS_KEY) || '{}').accounts) || [];
        accs.forEach(a => add(`${STORAGE_KEY}:${a.id}`, `Conta local de ${a.name}`));
      } catch (e) {}
      return out;
    }

    function offerLocalImport(force) {
      if (!cloudOn()) return;
      if (!force && lsGet(IMPORTED_PREFIX + currentUser.id)) return;
      const items = findLocalData();
      if (!items.length) { if (force) showToast('Não há dados antigos neste aparelho.'); return; }
      window.__localImports = items;
      document.getElementById('account-title').innerText = 'Trazer seu baba pra nuvem';
      document.getElementById('account-body').innerHTML = `
        <div class="space-y-3">
          <p class="text-[14px] text-ink-2 leading-snug">Encontrei dados do BABA de antes das contas na nuvem. Escolha o que trazer: turmas, histórico e o baba em andamento vão pra sua conta.</p>
          ${items.map((it, i) => `
            <div class="card-flat p-3.5 flex items-center gap-3">
              <div class="min-w-0 flex-1">
                <p class="text-[15px] font-bold truncate">${escapeHtml(it.label)}</p>
                <p class="text-[12px] text-ink-2">${it.turmas} turma${it.turmas === 1 ? '' : 's'} · ${it.players} atletas hoje · ${it.days} baba${it.days === 1 ? '' : 's'}</p>
              </div>
              <button onclick="importLocalData(${i})" class="btn-primary h-10 px-4 text-[13px] flex-shrink-0">Trazer</button>
            </div>`).join('')}
          <button onclick="lsSet(IMPORTED_PREFIX + currentUser.id, '1'); closeAccountSheet();" class="btn-outline w-full h-12 text-[14px]">Agora não</button>
        </div>`;
      document.getElementById('modal-account').classList.remove('hidden');
    }

    function importLocalData(index) {
      const it = (window.__localImports || [])[index];
      if (!it || !cloudOn()) return;
      const src = it.state;
      const idMap = {};
      // Turmas: same name merges into yours, otherwise a new turma you administer.
      src.turmas.filter(t => t.players.length).forEach(t => {
        let dest = state.turmas.find(x => sameName(x.name, t.name) && canEditTurma(x));
        if (!dest) {
          dest = { id: uuid(), name: t.name, cloud: true, role: 'owner', invite: null, players: [], keepers: [], meta: {} };
          state.turmas.push(dest);
        }
        t.players.forEach(n => { if (!dest.players.some(x => sameName(x, n))) dest.players.push(n); });
        t.keepers.forEach(n => { if (!dest.keepers.some(x => sameName(x, n))) dest.keepers.push(n); });
        idMap[t.id] = dest.id;
        markTurmaDirty(dest.id);
      });
      const mapped = ids => (ids || []).map(id => idMap[id]).filter(Boolean);
      const allIds = Object.values(idMap);
      // Finished babas.
      (src.pastDays || []).forEach(d => {
        const id = uuidFromString(`${currentUser.id}|${d.id}`);
        if (state.pastDays.some(x => x.id === id)) return;
        const summary = { id, date: d.date, title: d.title || 'Baba', matches: d.matches || 0, owner: true, turmaIds: allIds,
          players: (d.players || []).map(p => Object.assign({}, p, { cloudId: null })) };
        state.pastDays.push(summary);
        enqueueFinish(summary);
      });
      // The baba in progress becomes your current one, if you don't have one going.
      if ((src.players.some(p => p.present) || src.matchHistory.length) && !hasBabaContent()) {
        const keep = { turmas: state.turmas, pastDays: state.pastDays };
        state = migrate(Object.assign({}, src, keep, { v: STATE_VERSION }));
        state.selectedTeams = mapped(src.selectedTeams);
        state.players.forEach(p => { p.turmaId = idMap[p.turmaId] || null; });
        state.babaId = null;
        state.match.isRunning = false;
        state.match.endAt = null;
      }
      state.pastDays.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      lsSet(IMPORTED_PREFIX + currentUser.id, '1');
      closeAccountSheet();
      commit('Dados trazidos. Vou sincronizar com a nuvem.');
    }

    /* ---- Fingerprint (WebAuthn) as an app lock on this phone ---- */
    const bioSupported = () => !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create && cryptoOk());

    async function bioAvailable() {
      if (!bioSupported()) return false;
      try {
        const fp = document.featurePolicy;
        if (fp && fp.allowsFeature && !fp.allowsFeature('publickey-credentials-get')) return false;
        if (PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
          return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        }
      } catch (e) {}
      return false;
    }

    async function registerBio(user) {
      if (!bioSupported()) throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge: randBytes(32),
          rp: { name: 'BABA' },
          user: { id: enc.encode(user.id.slice(0, 64)), name: user.email || user.name, displayName: user.name },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
          timeout: 60000,
          attestation: 'none'
        }
      });
      if (!cred) throw Object.assign(new Error('cancelled'), { name: 'NotAllowedError' });
      return b64u(cred.rawId);
    }

    async function verifyBio(user) {
      if (!user || !user.credId) throw Object.assign(new Error('none'), { name: 'NotSupportedError' });
      const challenge = randBytes(32);
      const res = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{ type: 'public-key', id: fromB64u(user.credId) }],
          userVerification: 'required',
          timeout: 60000
        }
      });
      if (!res || b64u(res.rawId) !== user.credId) throw Object.assign(new Error('mismatch'), { name: 'SecurityError' });
      const client = JSON.parse(new TextDecoder().decode(res.response.clientDataJSON));
      if (client.type !== 'webauthn.get' || client.challenge !== b64u(challenge)) throw Object.assign(new Error('challenge'), { name: 'SecurityError' });
      const flags = new Uint8Array(res.response.authenticatorData)[32];
      if (!(flags & 0x04)) throw Object.assign(new Error('no uv'), { name: 'SecurityError' });
      return true;
    }

    function bioErrorMessage(e) {
      const n = e && e.name;
      if (n === 'NotAllowedError') return 'Leitura cancelada, ou a digital não é permitida aqui.';
      if (n === 'SecurityError') return 'A digital não é permitida nesta visualização.';
      if (n === 'InvalidStateError') return 'Essa digital já está cadastrada neste aparelho.';
      if (n === 'NotSupportedError') return 'Este navegador não tem leitor de digital disponível.';
      return 'Não foi possível usar a digital.';
    }

    /* ---- Profile ---- */
    function firstName(name) {
      return String(name || '').replace(/"[^"]*"/g, ' ').trim().split(/\s+/)[0] || '';
    }
    function initials(name) {
      const parts = String(name || '').replace(/"[^"]*"/g, ' ').trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return '?';
      return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    }

    function renderProfileBits() {
      const acc = currentUser;
      paintAvatar(document.getElementById('header-avatar'), acc ? acc.avatar : null, acc ? acc.name : '');
      paintAvatar(document.getElementById('profile-avatar'), acc ? acc.avatar : null, acc ? acc.name : '');
      document.getElementById('profile-name').innerText = acc ? acc.name : '';
      applyFrame(document.getElementById('header-avatar-wrap'), acc && acc.cosmetics);
      applyFrame(document.getElementById('profile-avatar-wrap'), acc && acc.cosmetics);
      applyNameStyle(document.getElementById('profile-name'), acc && acc.cosmetics);
      document.getElementById('profile-user').innerText = acc ? acc.email || '' : '';
      document.getElementById('profile-bio-toggle').checked = !!(acc && readLock(acc.id));
    }

    async function openProfile() {
      if (!currentUser) return;
      renderProfileBits();
      renderPrefsUI();
      renderProfileMine();
      setSync(syncState);
      document.getElementById('profile-name-view').classList.remove('hidden');
      document.getElementById('profile-name-form').classList.add('hidden');
      const page = document.getElementById('page-profile');
      page.classList.remove('hidden');
      page.scrollTop = 0;
      pushPage('page-profile');
      pullCloud();
    }

    function closeProfile() {
      document.getElementById('page-profile').classList.add('hidden');
      popPage('page-profile');
    }

    let installPromptEvt = null;
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPromptEvt = e; renderPwaStatus(); });
    window.addEventListener('appinstalled', () => { installPromptEvt = null; renderPwaStatus(); });
    function renderPwaStatus() {
      const st = document.getElementById('settings-pwa-status'), btn = document.getElementById('settings-pwa-btn');
      if (!st || !btn) return;
      if (isStandalone()) { st.textContent = 'Instalado: aberto como aplicativo'; btn.classList.add('hidden'); return; }
      st.textContent = installPromptEvt ? 'Ainda no navegador' : isIos() ? 'No iPhone: Compartilhar → Adicionar à Tela de Início' : 'Ainda no navegador';
      btn.classList.toggle('hidden', !installPromptEvt && !isIos());
    }
    async function installApp() {
      if (installPromptEvt) {
        installPromptEvt.prompt();
        try { await installPromptEvt.userChoice; } catch (e) {}
        installPromptEvt = null;
        renderPwaStatus();
      } else if (isIos()) {
        showToast('Toque em Compartilhar e depois em "Adicionar à Tela de Início".');
      }
    }

    async function openSettings() {
      if (!currentUser) return;
      renderPrefsUI();
      renderPushPref();
      renderPwaStatus();
      const v = document.getElementById('settings-version');
      if (v) v.textContent = 'v' + APP_VERSION;
      const page = document.getElementById('page-settings');
      page.classList.remove('hidden');
      page.scrollTop = 0;
      pushPage('page-settings');
      const toggle = document.getElementById('profile-bio-toggle');
      const sub = document.getElementById('profile-bio-sub');
      const locked = !!readLock(currentUser.id);
      sub.innerText = locked ? 'O BABA pede a digital ao abrir' : 'Verificando...';
      const avail = await bioAvailable();
      if (!locked) sub.innerText = avail ? 'Desativada' : 'Indisponível neste navegador';
      toggle.disabled = !avail && !locked;
    }
    function closeSettings() {
      document.getElementById('page-settings').classList.add('hidden');
      popPage('page-settings');
    }

    async function toggleBio(input) {
      if (!currentUser) return;
      const locked = !!readLock(currentUser.id);
      if (locked) {
        input.checked = true;
        if (!(await askConfirm('Parar de pedir a digital ao abrir o BABA neste aparelho?', 'Desativar'))) return;
        lsDel(LOCK_PREFIX + currentUser.id);
        showToast('Digital desativada.');
      } else {
        input.checked = false;
        try {
          const credId = await registerBio(currentUser);
          lsSet(LOCK_PREFIX + currentUser.id, JSON.stringify({ credId }));
          showToast('Digital ativada: o BABA vai pedir a digital ao abrir.');
        } catch (e) {
          showToast(bioErrorMessage(e), 'warning');
        }
      }
      renderProfileBits();
      document.getElementById('profile-bio-sub').innerText = readLock(currentUser.id) ? 'O BABA pede a digital ao abrir' : 'Desativada';
    }

    /* ---- Account forms ---- */
    function passwordField(id, label, auto, placeholder) {
      return `
        <label class="block">
          <span class="label">${label}</span>
          <span class="relative block">
            <input id="${id}" type="password" class="field pr-12" autocomplete="${auto}" placeholder="${placeholder || ''}" />
            <button type="button" onclick="togglePass('${id}', this)" class="absolute right-1.5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl text-ink-2 flex items-center justify-center" aria-label="Mostrar senha"><i class="fa-solid fa-eye"></i></button>
          </span>
        </label>`;
    }

    function openAccountSheet(kind) {
      if (!currentUser) return;
      const title = document.getElementById('account-title');
      const body = document.getElementById('account-body');
      if (kind === 'password') {
        title.innerText = 'Trocar senha';
        body.innerHTML = `
          <form class="space-y-3.5" onsubmit="event.preventDefault(); doChangePassword();" novalidate>
            ${passwordField('acc-old', 'Senha atual', 'current-password')}
            ${passwordField('acc-new', 'Nova senha', 'new-password', 'Mínimo de 6 caracteres')}
            <p id="account-error" class="hidden text-[13px] font-semibold text-danger"></p>
            <button id="btn-account" class="btn-primary w-full py-3.5 text-[15px]">Salvar nova senha</button>
          </form>`;
      } else if (kind === 'recovery') {
        title.innerText = 'Novo código de recuperação';
        body.innerHTML = `
          <form class="space-y-3.5" onsubmit="event.preventDefault(); doNewRecovery();" novalidate>
            <p class="text-[14px] text-ink-2 leading-snug">O código antigo para de valer. Confirme sua senha para gerar outro.</p>
            ${passwordField('acc-old', 'Senha', 'current-password')}
            <p id="account-error" class="hidden text-[13px] font-semibold text-danger"></p>
            <button id="btn-account" class="btn-primary w-full py-3.5 text-[15px]">Gerar novo código</button>
          </form>`;
      } else if (kind === 'delete') {
        title.innerText = 'Excluir conta';
        body.innerHTML = `
          <form class="space-y-3.5" onsubmit="event.preventDefault(); doDeleteAccount();" novalidate>
            <p class="text-[14px] text-ink-2 leading-snug">Apaga a conta <b class="text-ink">${escapeHtml(currentUser.email || '')}</b>. As turmas que você administra passam para outra pessoa da turma, e o histórico dos babas continua para o grupo.</p>
            ${passwordField('acc-old', 'Senha', 'current-password')}
            <p id="account-error" class="hidden text-[13px] font-semibold text-danger"></p>
            <button id="btn-account" class="btn-danger w-full py-3.5 text-[15px]">Excluir conta</button>
          </form>`;
      }
      document.getElementById('modal-account').classList.remove('hidden');
      setTimeout(() => { const f = document.getElementById('acc-old'); if (f) f.focus(); }, 200);
    }

    function closeAccountSheet() {
      document.getElementById('modal-account').classList.add('hidden');
      document.getElementById('account-body').innerHTML = '';
    }

    /* Account changes need internet and the current password. */
    async function confirmCurrentPassword() {
      const old = document.getElementById('acc-old').value;
      if (!old) { showErr('account-error', 'Digite sua senha.'); return false; }
      try {
        await api.signIn(currentUser.email, old);
        return true;
      } catch (e) {
        showErr('account-error', isNetworkError(e) ? OFFLINE_MSG : 'Senha incorreta.');
        return false;
      }
    }

    async function doChangePassword() {
      const btn = document.getElementById('btn-account');
      const next = document.getElementById('acc-new').value;
      if (next.length < 6) return showErr('account-error', 'A nova senha precisa ter pelo menos 6 caracteres.');
      setBusy(btn, true, 'Salvando...');
      try {
        if (!(await confirmCurrentPassword())) return;
        await api.updatePassword(next);
        closeAccountSheet();
        showToast('Senha alterada.');
      } catch (e) {
        showErr('account-error', isNetworkError(e) ? OFFLINE_MSG : 'Não foi possível trocar a senha.');
      } finally {
        if (document.body.contains(btn)) setBusy(btn, false);
      }
    }

    async function doNewRecovery() {
      const btn = document.getElementById('btn-account');
      setBusy(btn, true, 'Gerando...');
      try {
        if (!(await confirmCurrentPassword())) return;
        const res = await api.newCode();
        if (!res.ok) return showErr('account-error', accountError(res.body.error));
        const code = res.body.code;
        document.getElementById('account-body').innerHTML = `
          <div class="space-y-3.5">
            <p class="text-[14px] text-ink-2 leading-snug">Este é o novo código. Ele só aparece agora: tire um print ou anote.</p>
            <div class="card p-4">
              <input id="acc-code" readonly value="${escapeHtml(code)}" class="w-full bg-transparent text-center font-serif text-[36px] tracking-[0.06em] text-pitch outline-none select-all" aria-label="Código de recuperação" />
              <button onclick="copyText(document.getElementById('acc-code').value, document.getElementById('acc-code'))" class="btn-soft w-full h-11 text-[14px] mt-2"><i class="fa-solid fa-copy"></i> Copiar código</button>
            </div>
            <button onclick="closeAccountSheet()" class="btn-primary w-full py-3.5 text-[15px]">Pronto</button>
          </div>`;
      } catch (e) {
        showErr('account-error', isNetworkError(e) ? OFFLINE_MSG : 'Não foi possível gerar o código.');
      } finally {
        if (document.body.contains(btn)) setBusy(btn, false);
      }
    }

    async function doDeleteAccount() {
      const btn = document.getElementById('btn-account');
      setBusy(btn, true, 'Excluindo...');
      try {
        if (!(await confirmCurrentPassword())) return;
        const res = await api.deleteAccount();
        if (!res.ok) return showErr('account-error', accountError(res.body.error));
        const uid = currentUser.id;
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
        [CACHE_PREFIX, OUTBOX_PREFIX, LOCK_PREFIX, IMPORTED_PREFIX, PROFILE_PREFIX].forEach(p => lsDel(p + uid));
        await api.signOut();
        currentUser = null;
        state = defaultState();
        closeAccountSheet();
        closeProfile(); closeSettings();
        showAuth('landing');
        showToast('Conta excluída.');
      } catch (e) {
        showErr('account-error', isNetworkError(e) ? OFFLINE_MSG : 'Não foi possível excluir a conta.');
      } finally {
        if (document.body.contains(btn)) setBusy(btn, false);
      }
    }

    async function copyText(text, inputEl, okMsg) {
      const ok = okMsg || 'Código copiado.';
      try {
        await navigator.clipboard.writeText(text);
        showToast(ok);
        return;
      } catch (e) {}
      if (inputEl) {
        inputEl.focus();
        inputEl.select();
        try {
          if (document.execCommand('copy')) { showToast(ok); return; }
        } catch (e) {}
      }
      showToast('Não consegui copiar sozinho. Selecione e copie.', 'warning');
    }

