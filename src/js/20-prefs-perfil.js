    /* ===================================================================
       PREFERÊNCIAS (tema, acessibilidade, quadra)
       Saved on the phone (so the theme applies before the first paint)
       and in the profile, so a new phone picks them up.
       =================================================================== */
    const PREFS_KEY = 'baba_prefs_v1';
    const DEFAULT_PREFS = { theme: 'light', textSize: 'normal', reduceMotion: false, sound: true, vibrate: true, tutorialDone: false, tutorialChapters: [], tutorialCardHidden: false, position: '', foot: '', mainTurma: '', detailStats: false, avisoLista: true, avisoLembrete: true, avisoPalpites: true };
    const SYNCED_PREFS = Object.keys(DEFAULT_PREFS);
    let prefs = loadPrefs();
    let prefsPulledFor = null;
    let prefsPushTimer = null;

    function loadPrefs() {
      try { return Object.assign({}, DEFAULT_PREFS, JSON.parse(lsGet(PREFS_KEY) || '{}')); } catch (e) { return Object.assign({}, DEFAULT_PREFS); }
    }

    function applyPrefs() {
      const root = document.documentElement.classList;
      const dark = prefs.theme === 'dark' || (prefs.theme === 'auto' && !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches));
      root.toggle('dark', dark);
      root.toggle('text-big', prefs.textSize === 'big');
      root.toggle('reduce-motion', !!prefs.reduceMotion);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', dark ? '#0C1816' : '#FAF3DC');
    }

    function renderPrefsUI() {
      document.querySelectorAll('#pref-theme .seg-btn').forEach(b => b.classList.toggle('is-selected', b.dataset.v === prefs.theme));
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
      set('pref-text', prefs.textSize === 'big');
      set('pref-motion', prefs.reduceMotion);
      set('pref-sound', prefs.sound);
      set('pref-vibrate', prefs.vibrate);
      set('pref-detail', prefs.detailStats);
      set('pref-aviso-lista', prefs.avisoLista);
      set('pref-aviso-lembrete', prefs.avisoLembrete);
      set('pref-aviso-palpites', prefs.avisoPalpites);
      renderVenueUI();
    }

    function setPref(key, value) {
      prefs[key] = value;
      lsSet(PREFS_KEY, JSON.stringify(prefs));
      applyPrefs();
      renderPrefsUI();
      // Profile copy: a few seconds later, so flipping a switch twice sends once.
      clearTimeout(prefsPushTimer);
      prefsPushTimer = setTimeout(() => queueProfilePatch({ prefs: Object.fromEntries(SYNCED_PREFS.map(k => [k, prefs[k]])) }), 1500);
    }

    /* First pull of a session: the account's saved preferences win. */
    function adoptServerPrefs(serverPrefs) {
      if (!currentUser || prefsPulledFor === currentUser.id) return;
      prefsPulledFor = currentUser.id;
      if (!serverPrefs || typeof serverPrefs !== 'object') return;
      let changed = false;
      SYNCED_PREFS.forEach(k => {
        if (serverPrefs[k] === undefined || serverPrefs[k] === prefs[k]) return;
        // Once seen on any phone, the tutorial stays seen.
        if (k === 'tutorialDone' && prefs.tutorialDone) return;
        if (k === 'tutorialChapters') {
          const all = new Set([...(Array.isArray(prefs[k]) ? prefs[k] : []), ...(Array.isArray(serverPrefs[k]) ? serverPrefs[k] : [])]);
          const merged = TUTORIAL.map(c => c.id).filter(id => all.has(id));
          if (JSON.stringify(merged) !== JSON.stringify(prefs[k])) { prefs[k] = merged; changed = true; }
          return;
        }
        prefs[k] = serverPrefs[k];
        changed = true;
      });
      if (changed) { lsSet(PREFS_KEY, JSON.stringify(prefs)); applyPrefs(); renderPrefsUI(); }
    }

    if (window.matchMedia) {
      try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (prefs.theme === 'auto') applyPrefs(); }); } catch (e) {}
    }

    /* ===================================================================
       FOTO / ÍCONE (perfil e turma)
       A picture is an emoji, or a small JPEG kept as a data URL (a few KB).
       =================================================================== */
    const EMOJIS = ['⚽', '🥅', '🧤', '👟', '🏆', '🥇', '🔥', '⚡', '⭐', '👑', '💪', '🎯',
      '🦁', '🐐', '🦅', '🐯', '🐺', '🦈', '🐉', '🐊', '🦍', '🐂', '🐓', '🦊',
      '😎', '🤙', '🧢', '🍀', '🌪️', '🚀', '🎩', '🍕', '🥤', '🏖️', '🌵', '🎸'];
    const isPhoto = v => typeof v === 'string' && v.startsWith('data:image/');

    function avatarInner(value, name) {
      if (isPhoto(value)) return `<img src="${value}" alt="" draggable="false" />`;
      if (value) return `<span class="emo">${escapeHtml(value)}</span>`;
      return escapeHtml(initials(name));
    }
    function paintAvatar(el, value, name) {
      if (!el) return;
      el.classList.toggle('is-photo', isPhoto(value));
      el.classList.toggle('is-emoji', !!value && !isPhoto(value));
      el.innerHTML = avatarInner(value, name);
    }
    function avatarHtml(value, name, cls) {
      const kind = isPhoto(value) ? ' is-photo' : value ? ' is-emoji' : '';
      return `<span class="avatar${kind} ${cls || ''}">${avatarInner(value, name)}</span>`;
    }

    /* Center-crops a picked image to a square and shrinks it. */
    function loadImageFile(file) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => resolve({ img, done: () => URL.revokeObjectURL(url) });
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
        img.src = url;
      });
    }
    async function squareImage(file, size) {
      const { img, done } = await loadImageFile(file);
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      done();
      return c.toDataURL('image/jpeg', 0.82);
    }

    let pickerTarget = null;

    function openAvatarPicker(target) {
      if (target === 'turma') {
        const t = turmaById(editingTurmaId);
        if (!t || !canEditTurma(t)) { showToast('Só o dono ou um adm muda a foto da turma.', 'warning'); return; }
      }
      pickerTarget = target;
      const turma = target === 'turma' ? turmaById(editingTurmaId) : null;
      document.getElementById('picker-title').innerText = turma ? 'Foto da turma' : 'Sua foto';
      document.getElementById('picker-note').innerText = turma
        ? 'Todo mundo da turma vê essa foto.'
        : 'Aparece no seu perfil e para a galera das suas turmas.';
      document.getElementById('picker-emojis').innerHTML = EMOJIS.map(e =>
        `<button onclick="pickerChoose('${e}')" class="aspect-square rounded-2xl bg-card border border-ink/10 text-[24px] flex items-center justify-center active:scale-90 transition" aria-label="Usar ${e}">${e}</button>`).join('');
      const current = turma ? turma.icon : (currentUser || {}).avatar;
      paintAvatar(document.getElementById('picker-preview'), current, turma ? turma.name : (currentUser || {}).name);
      document.getElementById('picker-preview').classList.toggle('!rounded-2xl', !!turma);
      document.getElementById('picker-remove').classList.toggle('hidden', !current);
      document.getElementById('picker-file').value = '';
      document.getElementById('modal-picker').classList.remove('hidden');
    }

    function closeAvatarPicker() {
      document.getElementById('modal-picker').classList.add('hidden');
      pickerTarget = null;
    }

    async function pickerFromFile(input) {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const url = await squareImage(file, pickerTarget === 'turma' ? 256 : 192);
        pickerChoose(url);
      } catch (e) {
        showToast('Não consegui abrir essa imagem. Tente outra.', 'warning');
      }
    }

    function pickerChoose(value) {
      if (pickerTarget === 'turma') {
        const t = turmaById(editingTurmaId);
        if (t && canEditTurma(t)) {
          t.icon = value || null;
          saveState();
          markTurmaDirty(t.id);
          renderTurmaEditor();
          renderTurmaList();
        }
      } else if (currentUser) {
        currentUser.avatar = value || null;
        cacheProfile();
        queueProfilePatch({ avatar: currentUser.avatar });
        renderProfileBits();
      }
      closeAvatarPicker();
      showToast(value ? 'Foto atualizada.' : 'Foto removida.');
    }

    /* ===================================================================
       PERFIL
       =================================================================== */
    const PROFILE_PREFIX = 'baba_profile_v1:';

    function cacheProfile() {
      if (!currentUser) return;
      lsSet(PROFILE_PREFIX + currentUser.id, JSON.stringify({ name: currentUser.name, avatar: currentUser.avatar || null, cosmetics: currentUser.cosmetics || {} }));
    }
    function readCachedProfile(uid) {
      try { return JSON.parse(lsGet(PROFILE_PREFIX + uid) || 'null'); } catch (e) { return null; }
    }

    /* Profile changes ride the outbox like everything else (works offline). */
    function queueProfilePatch(patch) {
      if (!cloudOn()) return;
      const ops = readOutbox();
      const prev = ops.find(o => o.type === 'profile_update');
      const merged = Object.assign({}, prev ? prev.patch : {}, patch);
      writeOutbox(ops.filter(o => o.type !== 'profile_update'));
      enqueue({ type: 'profile_update', patch: merged });
    }

    function editProfileName() {
      document.getElementById('profile-name-view').classList.add('hidden');
      document.getElementById('profile-name-form').classList.remove('hidden');
      const input = document.getElementById('profile-name-input');
      input.value = currentUser ? currentUser.name : '';
      setTimeout(() => { input.focus(); input.select(); }, 50);
    }

    function saveProfileName() {
      const value = document.getElementById('profile-name-input').value.replace(/\s+/g, ' ').trim();
      if (!value) { showToast('Digite seu nome.', 'warning'); return; }
      document.getElementById('profile-name-view').classList.remove('hidden');
      document.getElementById('profile-name-form').classList.add('hidden');
      if (!currentUser || value === currentUser.name) return;
      if (value.length < 2) { showToast('O nome precisa de pelo menos 2 letras.', 'warning'); return; }
      currentUser.name = value.slice(0, 40);
      cacheProfile();
      queueProfilePatch({ name: currentUser.name });
      renderProfileBits();
      renderHome();
      showToast('Nome atualizado.');
    }

    async function signOutEverywhere() {
      if (!(await askConfirm('Desconectar sua conta de todos os outros celulares e navegadores? Neste aparelho você continua conectado.', 'Desconectar'))) return;
      try {
        await api.signOutOthers();
        showToast('Pronto: só este aparelho continua conectado.');
      } catch (e) {
        showToast(isNetworkError(e) ? OFFLINE_MSG : 'Não foi possível desconectar agora.', 'warning');
      }
    }

    const POSITIONS = ['Goleiro', 'Fixo/Zagueiro', 'Ala/Meia', 'Pivô/Atacante'];
    const FEET = ['Destro', 'Canhoto', 'Ambidestro'];
    function setProfilePref(key, value) {
      setPref(key, value);
      renderProfileMine();
    }
    function openProfileShop() { closeProfile(); openShop('card'); }
    function renderProfileMine() {
      const pos = document.getElementById('pf-pos');
      if (!pos) return;
      pos.innerHTML = POSITIONS.map(p => `<button onclick="setProfilePref('position', ${prefs.position === p ? "''" : `'${p}'`})" class="h-11 rounded-xl text-[13px] font-bold border ${prefs.position === p ? 'bg-pitch text-butter border-pitch' : 'bg-card text-ink border-ink/10'}">${p}</button>`).join('');
      document.getElementById('pf-foot').innerHTML = FEET.map(f => `<button onclick="setProfilePref('foot', ${prefs.foot === f ? "''" : `'${f}'`})" class="seg-btn${prefs.foot === f ? ' is-selected' : ''}">${f}</button>`).join('');
      const sel = document.getElementById('pf-turma');
      const opts = state.turmas.filter(t => t.name);
      sel.innerHTML = `<option value="">Nenhuma</option>` + opts.map(t => `<option value="${escapeHtml(t.id)}"${prefs.mainTurma === t.id ? ' selected' : ''}>${escapeHtml(t.name)}</option>`).join('');
      const mine = myStats();
      const cell = (v, l) => `<div class="card-flat p-3 text-center"><p class="font-serif text-[28px] leading-none text-pitch">${Number(v) || 0}</p><p class="text-[11px] font-semibold text-ink-2 mt-1">${l}</p></div>`;
      const m = mine || {};
      document.getElementById('pf-stats').innerHTML = cell(m.babas, 'Babas') + cell(m.matches, 'Jogos') + cell(m.goals, 'Gols') + cell(m.assists, 'Assistências') + cell(m.saves, 'Defesas') + cell(m.wins, 'Vitórias');
      const vb = document.getElementById('pf-venues');
      if (vb) vb.innerHTML = detailOn() ? Object.entries(VENUES).map(([k, l]) => {
        const v = myStats(k);
        if (!v || !(v.matches || v.goals || v.assists || v.saves)) return '';
        return `<div class="card-flat p-3"><p class="text-[12px] font-extrabold text-pitch mb-1.5">${l}</p><div class="grid grid-cols-4 text-center">${[[v.matches, 'Jogos'], [v.goals, 'Gols'], [v.assists, 'Assist.'], [v.saves, 'Defesas']].map(([n, t]) => `<div><p class="font-serif text-[22px] leading-none">${Number(n) || 0}</p><p class="text-[10.5px] font-semibold text-ink-2 mt-0.5">${t}</p></div>`).join('')}</div></div>`;
      }).join('') : '';
      const cardBox = document.getElementById('pf-card');
      if (currentUser) cardBox.innerHTML = `<button onclick="openAthleteCard(currentUser.id)" aria-label="Abrir seu card">${athleteCardHtml({ name: currentUser.name, avatar: currentUser.avatar, cosmetics: currentUser.cosmetics || {} }, mine || {}, { small: true })}</button>`;
      const box = document.getElementById('profile-mine');
      if (box) box.innerHTML = mine ? '' : '<p class="text-[12.5px] text-ink-2 text-center leading-snug">Ligue seu nome numa turma pra seus números aparecerem aqui.</p>';
    }

    async function shareMyCard() {
      if (!currentUser) return;
      const mine = myStats() || {};
      const c = cosOf(currentUser.cosmetics);
      const W = 720, H = 1000;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#003631'); g.addColorStop(1, '#0b6b5e');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffeda8'; ctx.font = 'bold 34px "Plus Jakarta Sans", sans-serif'; ctx.fillText('BABA', 50, 80);
      const title = titleOf(c);
      if (title) { ctx.font = 'bold 24px "Plus Jakarta Sans", sans-serif'; ctx.textAlign = 'right'; ctx.fillText(title, W - 50, 80); ctx.textAlign = 'left'; }
      // avatar: the photo when there is one, otherwise the initial
      const cx = W / 2, cy = 330, r = 150;
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
      let drew = false;
      if (currentUser.avatar && /^(data:|https?:|blob:)/.test(String(currentUser.avatar))) {
        try {
          const img = await new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = currentUser.avatar; });
          ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2); drew = true;
        } catch (e) {}
      }
      if (!drew) { ctx.fillStyle = '#ffeda8'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2); ctx.fillStyle = '#003631'; ctx.font = 'bold 150px "Plus Jakarta Sans", sans-serif'; ctx.textAlign = 'center'; ctx.fillText((currentUser.name || '?').trim().charAt(0).toUpperCase(), cx, cy + 52); ctx.textAlign = 'left'; }
      ctx.restore();
      ctx.lineWidth = 8; ctx.strokeStyle = '#ffeda8'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = 'bold 54px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(currentUser.name || '', cx, 570, W - 100);
      const sub = [prefs.position, prefs.foot].filter(Boolean).join(' · ');
      ctx.fillStyle = '#ffeda8'; ctx.font = '26px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(sub || ' ', cx, 615);
      const cells = [['Gols', mine.goals], ['Assist.', mine.assists], ['Defesas', mine.saves], ['Jogos', mine.matches], ['Vitórias', mine.wins]];
      const cw = (W - 100) / cells.length;
      cells.forEach(([l, v], i) => {
        const x = 50 + cw * i + cw / 2;
        ctx.fillStyle = '#fff'; ctx.font = 'bold 56px "Plus Jakarta Sans", sans-serif'; ctx.fillText(String(Number(v) || 0), x, 760);
        ctx.fillStyle = '#ffeda8'; ctx.font = '22px "Plus Jakarta Sans", sans-serif'; ctx.fillText(l, x, 800);
      });
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '22px "Plus Jakarta Sans", sans-serif'; ctx.fillText('bagos669.github.io/baba', cx, 940);
      cv.toBlob(blob => {
        if (!blob) { showToast('Não foi possível gerar a imagem.', 'warning'); return; }
        offerFile(`BABA_Card_${(currentUser.name || 'atleta').replace(/\s+/g, '_')}.png`, blob, 'Card salvo!');
      }, 'image/png');
    }

    /* Android back button closes the open page instead of leaving the app.
       One history entry ("trap") is pushed while pages are open; closing a page
       with its own button never touches history, so quick open/close sequences
       can't walk the browser out of the app. */
    const pageStack = [];
    let trapArmed = false;
    const PAGE_CLOSERS = {
      'page-profile': () => closeProfile(), 'page-settings': () => closeSettings(), 'page-support': () => closeSupport(), 'page-terms': () => closeTermsPage(),
      'page-live': () => closeLive(), 'page-chat': () => closeTurmaChat()
    };
    function armTrap() {
      if (trapArmed) return;
      try { history.pushState({ babaTrap: 1 }, ''); trapArmed = true; } catch (e) {}
    }
    function pushPage(id) {
      if (!pageStack.includes(id)) pageStack.push(id);
      armTrap();
    }
    function popPage(id) {
      const i = pageStack.lastIndexOf(id);
      if (i !== -1) pageStack.splice(i, 1);
    }
    window.addEventListener('popstate', () => {
      trapArmed = false;
      const top = pageStack[pageStack.length - 1];
      if (top) {
        (PAGE_CLOSERS[top] || (() => { document.getElementById(top).classList.add('hidden'); popPage(top); }))();
        if (pageStack.length) armTrap();
      }
    });

