    /* ===================================================================
       BABA - STATE

       Model (v4):
       - turmas: saved groups of names, editable, kept across days.
       - players: today's pool (from the selected turmas + avulsos).
         A player is "present" once checked in; `arrival` is the check-in order.
       - court.A / court.B: the two teams on the court ({label, ids, streak}).
       - queue: present players waiting, in order. Losers go to the end.
       Invariant: every present player is in exactly one of court.A,
       court.B or queue; absent players are in none of them.
       =================================================================== */
    const STORAGE_KEY = 'baba_gestao_digital_v3';
    const STATE_VERSION = 4;
    const FORMAT_SIZES = { futsal: 5, society: 8, campo: 12 };
    const FORMAT_LABELS = { futsal: 'Futsal (5)', society: 'Society (8)', campo: 'Campo (12)' };

    const PRELOADED_DATABASES = {
      fiasco: {
        id: 'fiasco',
        name: 'Fiasco do Gama',
        players: [
          'Gabriel Marini', 'Lucas "Xampson" Pavetits', 'Pedro "Pepo" Pontes',
          'Gabriel "Arrascatetas" Portella', 'Arthur Grangeiro', 'André "Dedé" Grangeiro',
          'Eduardo Altoé', 'Pedro Coelho', 'Rafael "Rafahaaland" Pacheco',
          'Rafael Lugon', 'Lani Ramos'
        ]
      },
      robson: {
        id: 'robson',
        name: 'Robson F.C.',
        players: [
          'Olavo', 'Márcio Dias', 'Álvaro Campelo', 'Samuel', 'Matheus Martins',
          'Diego', 'Yuri', 'Rafael Boné', 'Ernesto "Chosen"', 'João "Xota" Pedro'
        ]
      },
      futheavenly: {
        id: 'futheavenly',
        name: 'FutHeavenly',
        players: [
          'João Sarkis', 'Arthur Marini', 'Daniel "Pelégda" Megda', 'Daniel "Spider" Morum',
          'Bernardo "Bezão" Fagundes', 'Daniel Gadelha', 'João Paulo "Jay" Nóbrega',
          'Lucas "Carluz" Luz', 'Vitor D\'Aça', 'Guilherme Arantes', 'Eduardo Freitas',
          'Bruno "Brunão" Soares', 'Pedro Arantes', 'Tiago Limp', 'Davi "Viri" Viriato',
          'Lucca Fagundes', 'Artur "Tutu" Fagundes', 'Heitor Varanda', 'Samuel "Sami" Manzur',
          'João Bé', 'Matheus Republicano', 'Samuel Astuti', 'Bernardo Mazão', 'Eduardo Ricart',
          'Marco "Marcola" Maciel', 'Jhonata Gabriel', 'Athos', 'Federico "Feder"',
          'Yuri Luiz', 'José Neto', 'Lucas Rocha', 'João Pedro "Shark" Fernandes', 'Rodrigo "Digão"'
        ]
      }
    };

    function defaultMatch() {
      return {
        scoreA: 0,
        scoreB: 0,
        secondsLeft: 420,
        initialSeconds: 420,   // tempo total (duração) da partida
        addedSeconds: 0,       // acréscimo dado nesta partida
        isRunning: false,
        endAt: null,
        gameFormat: 'futsal',
        goalLimitRule: '2',
        events: []
      };
    }

    function defaultSettings() {
      return { keeperBalance: true, drawRule: 'king', maxStreak: 0 };
    }

    function seedTurmas() {
      return Object.values(PRELOADED_DATABASES).map(db => ({
        id: db.id, name: db.name, official: true, players: [...db.players], keepers: []
      }));
    }

    function defaultState() {
      return {
        v: STATE_VERSION,
        turmas: [],
        babaId: null,
        startedAt: null,
        savedAt: 0,
        selectedTeams: [],
        players: [],
        court: { A: null, B: null },
        queue: [],
        teamSeq: 0,
        arrivalSeq: 0,
        settings: defaultSettings(),
        match: defaultMatch(),
        matchHistory: [],
        standings: {},
        lastFinish: null,
        // Summaries of finished babas (this device's and imported ones).
        pastDays: []
      };
    }

    let state = defaultState();
    let storageOK = true;
    let timerInterval = null;
    let selectedGoalScorer = null;
    let selectedGoalAssist = null;
    let selectedGoalSide = 'A';
    let selectedSaveSide = 'A';
    let currentStatsCategory = 'goals';
    let audioCtx = null;
    let wakeLock = null;

    /* Brings data saved by older versions (or by a newer edit) into the v4 shape. */
    function migrate(parsed) {
      const s = Object.assign(defaultState(), parsed);
      s.match = Object.assign(defaultMatch(), parsed.match || {});
      delete s.match.teamA;
      delete s.match.teamB;
      if (!Array.isArray(s.match.events)) s.match.events = [];
      s.match.addedSeconds = Number(s.match.addedSeconds) || 0;
      if (!Array.isArray(s.pastDays)) s.pastDays = [];
      s.pastDays = s.pastDays.filter(d => d && d.id && Array.isArray(d.players));
      s.settings = Object.assign(defaultSettings(), parsed.settings || {});

      if (!Array.isArray(parsed.turmas)) {
        s.turmas = seedTurmas();
        (parsed.customTeams || []).forEach(t => s.turmas.push({ id: t.id, name: t.name, official: false, players: [], keepers: [] }));
      }
      delete s.customTeams;
      s.turmas.forEach(t => {
        if (!Array.isArray(t.players)) t.players = [];
        if (!Array.isArray(t.keepers)) t.keepers = [];
      });
      s.selectedTeams = (s.selectedTeams || []).filter(id => s.turmas.some(t => t.id === id));

      if (!s.court || typeof s.court !== 'object') s.court = { A: null, B: null };
      if (!Array.isArray(s.queue)) s.queue = [];
      if (!s.standings || typeof s.standings !== 'object') s.standings = {};
      if (!Array.isArray(s.matchHistory)) s.matchHistory = [];

      const legacy = parsed.v !== STATE_VERSION;
      s.players = (s.players || []).filter(p => p && p.name).map(p => ({
        id: p.id,
        name: String(p.name),
        isGoalkeeper: !!p.isGoalkeeper,
        goals: p.goals || 0,
        assists: p.assists || 0,
        saves: p.saves || 0,
        matches: p.matches || 0,
        wins: p.wins || 0,
        present: p.present !== false,
        arrival: p.arrival || null,
        arrivedAt: p.arrivedAt || null,
        turmaId: p.turmaId !== undefined ? p.turmaId : (p.teamId || null)
      }));

      if (legacy) {
        // Old versions had no arrival order: keep the list order for whoever was present.
        s.arrivalSeq = 0;
        s.players.forEach(p => { p.arrival = p.present ? ++s.arrivalSeq : null; });
        s.queue = s.players.filter(p => p.present).map(p => p.id);
        s.court = { A: null, B: null };
        s.matchHistory = s.matchHistory.map(h => ({
          timestamp: h.timestamp,
          labelA: h.labelA != null ? h.labelA : h.teamA,
          labelB: h.labelB != null ? h.labelB : h.teamB,
          scoreA: h.scoreA, scoreB: h.scoreB,
          namesA: h.namesA || [], namesB: h.namesB || []
        }));
        const labels = Object.keys(s.standings).map(Number).filter(n => !isNaN(n));
        s.teamSeq = labels.length ? Math.max(...labels) : 0;
        s.lastFinish = null;
        s.v = STATE_VERSION;
      }

      let maxId = s.players.reduce((m, p) => Math.max(m, Number(p.id) || 0), 0);
      const usedIds = new Set();
      s.players.forEach(p => {
        if (!p.id || usedIds.has(p.id)) p.id = ++maxId;
        usedIds.add(p.id);
      });
      return s;
    }

    /* The phone keeps a copy of each account's baba (offline at the court). */
    const dataKey = () => currentUser ? CACHE_PREFIX + currentUser.id : STORAGE_KEY;

    function loadState() {
      let raw = null;
      try {
        raw = localStorage.getItem(dataKey());
      } catch (e) {
        storageOK = false;
      }
      if (!raw) { state = defaultState(); return; }
      try {
        state = migrate(JSON.parse(raw));
      } catch (e) {
        state = defaultState();
      }
      repair();
    }

    /* Writes the local copy only (used after pulling from the server). */
    function cacheState() {
      if (!currentUser) return;
      try {
        localStorage.setItem(dataKey(), JSON.stringify(state));
      } catch (e) {
        if (storageOK) {
          storageOK = false;
          showToast('Este modo de abertura não salva os dados. Abra pelo navegador.', 'warning');
        }
      }
    }

    /* Every change: local copy now, server shortly after. */
    function saveState() {
      if (!currentUser) return;
      state.savedAt = Date.now();
      cacheState();
      schedulePush();
    }

    document.addEventListener('DOMContentLoaded', async () => {
      readInviteFromUrl();
      document.addEventListener('pointerdown', unlockAudio, { passive: true });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          if (state.match.isRunning) { requestWakeLock(); tick(); }
          pullCloud();
        }
      });
      window.addEventListener('online', () => { flushOutbox(); pullCloud(true); });
      window.addEventListener('offline', () => setSync('offline'));

      document.getElementById('input-new-player-name').addEventListener('keydown', e => { if (e.key === 'Enter') saveNewPlayer(); });
      document.getElementById('player-edit-name').addEventListener('keydown', e => { if (e.key === 'Enter') savePlayerSheet(); });
      document.getElementById('turma-edit-add').addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addMembersFromInput(); }
      });

      registerServiceWorker();
      if (!api.enabled()) { showAuth('landing'); showToast('Não consegui carregar o login. Confira a internet e abra de novo.', 'warning'); return; }
      let session = null;
      try { session = await api.getSession(); } catch (e) {}
      if (session) enterWithSession(session, true);
      else showAuth(lsGet('baba_last_email') ? 'login' : 'landing');
    });

    /* ===================================================================
       CONTA E NUVEM
       Accounts and shared data live in Supabase. The app keeps a full copy
       of the current baba on the phone (works offline at the court) and
       sends changes through an outbox that retries until it reaches the
       server. Turmas and their rosters are shared with every member.
       =================================================================== */
    const SUPABASE_URL = 'https://gwndkwnodlfgbcpesenr.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_f-zeNQEVrZb8VIpFl_HPaA_zhhIPXFa';
    const ACCOUNT_FN = SUPABASE_URL + '/functions/v1/account';
    const CACHE_PREFIX = 'baba_cache_v5:';
    const OUTBOX_PREFIX = 'baba_outbox_v5:';
    const LOCK_PREFIX = 'baba_lock_v5:';
    const IMPORTED_PREFIX = 'baba_local_imported_v5:';
    const LEGACY_ACCOUNTS_KEY = 'baba_accounts_v1';
    const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    let sb = null;
    try {
      if (window.supabase && window.supabase.createClient) {
        sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'baba_auth_v5' }
        });
      }
    } catch (e) { sb = null; }

    let currentUser = null;      // { id, email, name }
    let pendingSignup = null;    // { session, code }
    let pendingLockUser = null;
    let syncing = false;
    let syncState = 'ok';        // ok | syncing | offline | error
    let retryTimer = null;
    let pushTimer = null;
    let lastPull = 0;
    let myPlayerIds = [];

    const enc = new TextEncoder();
    const cryptoOk = () => !!(window.crypto && crypto.subtle && crypto.getRandomValues);

    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

    function randBytes(n) {
      const a = new Uint8Array(n);
      if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
      else for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256);
      return a;
    }
    function b64u(buf) {
      const bytes = new Uint8Array(buf);
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function fromB64u(str) {
      let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      const bin = atob(s);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    function uuid() {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      const b = randBytes(16);
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
      const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }
    /* Same text -> same id, so importing a file twice doesn't duplicate a baba. */
    function uuidFromString(text) {
      const out = [];
      let h1 = 0x811c9dc5, h2 = 0x01000193, h3 = 0x9e3779b9, h4 = 0x85ebca6b;
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822507);
        h3 = Math.imul(h3 ^ c, 3266489909); h4 = Math.imul(h4 ^ c, 668265263);
      }
      [h1, h2, h3, h4].forEach(h => out.push(((h >>> 0).toString(16)).padStart(8, '0')));
      const hx = out.join('');
      return `${hx.slice(0, 8)}-${hx.slice(8, 12)}-5${hx.slice(13, 16)}-a${hx.slice(17, 20)}-${hx.slice(20, 32)}`;
    }
    const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
    const localDate = ms => { const d = ms ? new Date(ms) : new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

    /* ---- Server calls (one place, so tests can swap it) ---- */
    async function q(builder) {
      const { data, error } = await builder;
      if (error) throw error;
      return data || [];
    }

    async function callAccountFn(body, withAuth) {
      const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY };
      if (withAuth) {
        const session = await api.getSession();
        if (!session) return { ok: false, status: 401, body: { error: 'unauthorized' } };
        headers.Authorization = 'Bearer ' + session.access_token;
      }
      const res = await fetch(ACCOUNT_FN, { method: 'POST', headers, body: JSON.stringify(body) });
      let data = {};
      try { data = await res.json(); } catch (e) {}
      return { ok: res.ok, status: res.status, body: data };
    }

    // Tests can stand in for the server by defining window.__BABA_FAKE_API__ before load.
    const api = Object.assign({
      enabled: () => !!sb,
      signup: (name, email, password) => callAccountFn({ action: 'signup', name, email, password }),
      reset: (email, code, password) => callAccountFn({ action: 'reset', email, code, password }),
      newCode: () => callAccountFn({ action: 'new_code' }, true),
      deleteAccount: () => callAccountFn({ action: 'delete' }, true),
      async signIn(email, password) {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data.session;
      },
      async signOut() { try { await sb.auth.signOut({ scope: 'local' }); } catch (e) {} },
      async getSession() { const { data } = await sb.auth.getSession(); return data ? data.session : null; },
      async updatePassword(password) { const { error } = await sb.auth.updateUser({ password }); if (error) throw error; },
      memberships: uid => q(sb.from('turma_members').select('role, turma:turmas(id, name, invite_code, created_by)').eq('user_id', uid)),
      players: ids => ids.length ? q(sb.from('turma_players').select('id, turma_id, name, is_goalkeeper, user_id').in('turma_id', ids).order('created_at')) : Promise.resolve([]),
      openBaba: uid => q(sb.from('babas').select('id, state, updated_at').eq('created_by', uid).eq('finished', false).order('updated_at', { ascending: false }).limit(1)),
      finishedBabas: () => q(sb.from('babas').select('id, title, played_on, matches, created_by, baba_stats(name, goals, assists, saves, matches, wins, turma_player_id)').eq('finished', true).order('played_on', { ascending: false }).limit(150)),
      profile: async uid => (await q(sb.from('profiles').select('name').eq('id', uid).limit(1)))[0] || null,
      upsertBaba: row => q(sb.from('babas').upsert(row)),
      deleteBaba: id => q(sb.from('babas').delete().eq('id', id)),
      async replaceStats(babaId, rows) {
        await q(sb.from('baba_stats').delete().eq('baba_id', babaId));
        if (rows.length) await q(sb.from('baba_stats').insert(rows));
      },
      upsertTurma: (id, name) => q(sb.from('turmas').upsert({ id, name })),
      turmaInvite: async id => ((await q(sb.from('turmas').select('invite_code').eq('id', id).limit(1)))[0] || {}).invite_code || null,
      setInvite: (id, code) => q(sb.from('turmas').update({ invite_code: code }).eq('id', id)),
      deleteTurma: id => q(sb.from('turmas').delete().eq('id', id)),
      leaveTurma: (id, uid) => q(sb.from('turma_members').delete().eq('turma_id', id).eq('user_id', uid)),
      insertPlayers: rows => q(sb.from('turma_players').insert(rows)),
      deletePlayers: ids => q(sb.from('turma_players').delete().in('id', ids)),
      setKeeper: (id, value) => q(sb.from('turma_players').update({ is_goalkeeper: value }).eq('id', id)),
      renamePlayer: (turmaId, oldName, newName) => q(sb.from('turma_players').update({ name: newName }).eq('turma_id', turmaId).eq('name', oldName)),
      async join(code) { const { data, error } = await sb.rpc('join_turma', { code }); if (error) throw error; return data || []; },
      async claim(id) { const { error } = await sb.rpc('claim_player', { player: id }); if (error) throw error; },
      async unclaim(id) { const { error } = await sb.rpc('unclaim_player', { player: id }); if (error) throw error; }
    }, window.__BABA_FAKE_API__ || {});

    const cloudOn = () => !!(currentUser && api.enabled());

    function isNetworkError(e) {
      if (!e) return false;
      if (navigator.onLine === false) return true;
      const m = String(e.message || e).toLowerCase();
      return !e.code && (m.includes('fetch') || m.includes('network') || m.includes('load failed') || m.includes('timeout'));
    }

    /* ---- Sync status (the dot on the avatar) ---- */
    function setSync(s) {
      syncState = s;
      const dot = document.getElementById('sync-dot');
      if (dot) {
        dot.classList.toggle('bg-leaf', s === 'ok');
        dot.classList.toggle('bg-butter-3', s === 'syncing' || s === 'offline');
        dot.classList.toggle('bg-danger', s === 'error');
      }
      const label = document.getElementById('profile-sync');
      if (label) {
        const pending = currentUser ? readOutbox().length : 0;
        label.innerText = s === 'syncing' ? 'Sincronizando...'
          : s === 'offline' ? `Sem internet: ${pending ? pending + ' alteraç' + (pending === 1 ? 'ão' : 'ões') + ' esperando' : 'tudo salvo neste aparelho'}`
          : s === 'error' ? 'Não consegui sincronizar. Tento de novo sozinho.'
          : 'Tudo sincronizado';
      }
    }

    /* ---- Outbox ---- */
    const outboxKey = () => OUTBOX_PREFIX + (currentUser ? currentUser.id : 'none');
    function readOutbox() { try { return JSON.parse(lsGet(outboxKey()) || '[]'); } catch (e) { return []; } }
    function writeOutbox(ops) { lsSet(outboxKey(), JSON.stringify(ops)); }

    function enqueue(op) {
      if (!cloudOn()) return;
      op.uid = uuid();
      let ops = readOutbox();
      // Later writes of the same thing replace earlier ones that haven't gone out.
      if (op.type === 'baba_upsert') ops = ops.filter(o => !(o.type === 'baba_upsert' && o.id === op.id));
      if (op.type === 'baba_finish' || op.type === 'baba_delete') ops = ops.filter(o => !((o.type === 'baba_upsert' || o.type === 'baba_finish') && o.id === op.id));
      if (op.type === 'turma_sync') ops = ops.filter(o => !(o.type === 'turma_sync' && o.id === op.id));
      if (op.type === 'turma_delete' || op.type === 'turma_leave') ops = ops.filter(o => !(['turma_sync', 'player_rename'].includes(o.type) && (o.id === op.id || o.turmaId === op.id)));
      ops.push(op);
      writeOutbox(ops);
      flushOutbox();
    }

    function scheduleRetry(ms) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(flushOutbox, ms || 15000);
    }

    async function flushOutbox() {
      if (!cloudOn() || syncing) return;
      if (!readOutbox().length) { if (syncState !== 'error') setSync('ok'); return; }
      if (navigator.onLine === false) { setSync('offline'); return; }
      syncing = true;
      setSync('syncing');
      const owner = currentUser.id;
      try {
        let ops = readOutbox();
        while (ops.length && currentUser && currentUser.id === owner) {
          const op = ops[0];
          try {
            await runOp(op);
          } catch (e) {
            if (isNetworkError(e)) throw e;
            // The server refused it (permission, invalid data): drop it so the line keeps moving.
            console.warn('BABA sync dropped', op.type, e);
            showToast(op.type.startsWith('turma') || op.type === 'player_rename' ? 'Só o admin da turma pode mudar o elenco.' : 'Uma alteração não foi aceita pelo servidor.', 'warning');
          }
          writeOutbox(readOutbox().filter(o => o.uid !== op.uid));
          ops = readOutbox();
        }
        setSync('ok');
      } catch (e) {
        setSync(isNetworkError(e) ? 'offline' : 'error');
        scheduleRetry();
      } finally {
        syncing = false;
      }
    }

    async function runOp(op) {
      if (op.type === 'baba_upsert') return api.upsertBaba(op.row);
      if (op.type === 'baba_finish') {
        await api.upsertBaba(op.row);
        return api.replaceStats(op.row.id, op.stats || []);
      }
      if (op.type === 'baba_delete') return api.deleteBaba(op.id);
      if (op.type === 'turma_delete') return api.deleteTurma(op.id);
      if (op.type === 'turma_leave') return api.leaveTurma(op.id, currentUser.id);
      if (op.type === 'player_rename') return api.renamePlayer(op.turmaId, op.oldName, op.newName);
      if (op.type === 'turma_sync') return syncTurmaNow(op.id);
    }

    /* Makes the server roster match the local one (names, goalkeepers). */
    async function syncTurmaNow(id) {
      const t = state.turmas.find(x => x.id === id);
      if (!t) return;
      await api.upsertTurma(t.id, t.name);
      const rows = await api.players([t.id]);
      const local = new Map(t.players.map(n => [n.trim().toLowerCase(), n]));
      const remove = rows.filter(r => !local.has(r.name.toLowerCase())).map(r => r.id);
      if (remove.length) await api.deletePlayers(remove);
      const have = new Set(rows.map(r => r.name.toLowerCase()));
      const add = [...local.values()].filter(n => !have.has(n.toLowerCase()))
        .map(n => ({ turma_id: t.id, name: n, is_goalkeeper: t.keepers.some(k => sameName(k, n)) }));
      if (add.length) await api.insertPlayers(add);
      for (const r of rows) {
        if (!local.has(r.name.toLowerCase())) continue;
        const gk = t.keepers.some(k => sameName(k, r.name));
        if (gk !== !!r.is_goalkeeper) await api.setKeeper(r.id, gk);
      }
      // Refresh ids and links for this turma.
      const fresh = await api.players([t.id]);
      const live = state.turmas.find(x => x.id === id);
      if (live) {
        live.meta = Object.fromEntries(fresh.map(r => [r.name.toLowerCase(), { id: r.id, userId: r.user_id }]));
        if (!live.invite) live.invite = await api.turmaInvite(t.id);
        cacheState();
      }
    }

    function markTurmaDirty(id) {
      const t = turmaById(id);
      if (!t || !cloudOn()) return;
      if (t.role && t.role !== 'admin') return;
      enqueue({ type: 'turma_sync', id });
    }

    /* ---- The current baba on the server ---- */
    function hasBabaContent() {
      return state.players.some(p => p.present) || state.matchHistory.length > 0 || state.match.events.length > 0;
    }
    const cloudTurmaIds = ids => (ids || []).filter(id => isUuid(id) && state.turmas.some(t => t.id === id && t.cloud));
    function babaTitle() {
      const names = state.selectedTeams.map(id => (turmaById(id) || {}).name).filter(Boolean);
      return names.join(' + ') || 'Baba';
    }
    function stateForCloud() {
      const s = Object.assign({}, state);
      delete s.turmas;
      delete s.pastDays;
      delete s.lastFinish;
      return JSON.parse(JSON.stringify(s));
    }

    function schedulePush() {
      if (!cloudOn()) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => {
        if (!cloudOn() || !hasBabaContent()) return;
        if (!state.babaId) { state.babaId = uuid(); cacheState(); }
        enqueue({
          type: 'baba_upsert', id: state.babaId,
          row: { id: state.babaId, turma_ids: cloudTurmaIds(state.selectedTeams), title: babaTitle(), played_on: localDate(state.startedAt), state: stateForCloud(), finished: false, matches: state.matchHistory.length }
        });
      }, 1200);
    }

    function playerCloudId(p) {
      const t = turmaById(p.turmaId);
      const m = t && t.meta ? t.meta[p.name.trim().toLowerCase()] : null;
      return m ? m.id : null;
    }

    /* Called with the day's summary before the state is reset. */
    function enqueueFinish(summary) {
      if (!cloudOn()) return;
      const id = summary.id;
      enqueue({
        type: 'baba_finish', id,
        row: { id, turma_ids: cloudTurmaIds(summary.turmaIds), title: summary.title, played_on: summary.date.slice(0, 10), state: null, finished: true, matches: summary.matches },
        stats: summary.players.map(p => ({
          baba_id: id, turma_player_id: p.cloudId || null, name: p.name,
          goals: p.goals || 0, assists: p.assists || 0, saves: p.saves || 0, matches: p.matches || 0, wins: p.wins || 0
        }))
      });
    }

    /* ---- Pull everything this account can see ---- */
    async function pullCloud(force) {
      if (!cloudOn()) return;
      if (!force && Date.now() - lastPull < 20000) return;
      if (navigator.onLine === false) { setSync('offline'); return; }
      lastPull = Date.now();
      const uid = currentUser.id;
      try {
        setSync('syncing');
        const [mem, prof] = await Promise.all([api.memberships(uid), api.profile(uid)]);
        if (!currentUser || currentUser.id !== uid) return;
        if (prof && prof.name) currentUser.name = prof.name;
        const turmaRows = mem.filter(m => m.turma).map(m => Object.assign({ role: m.role }, m.turma));
        const players = await api.players(turmaRows.map(t => t.id));
        myPlayerIds = players.filter(p => p.user_id === uid).map(p => p.id);

        const ops = readOutbox();
        const pending = new Set(ops.filter(o => o.type === 'turma_sync').map(o => o.id));
        const gone = new Set(ops.filter(o => o.type === 'turma_delete' || o.type === 'turma_leave').map(o => o.id));
        const next = [];
        turmaRows.forEach(tr => {
          if (gone.has(tr.id)) return;
          const rows = players.filter(p => p.turma_id === tr.id);
          const cloud = {
            id: tr.id, name: tr.name, cloud: true, role: tr.role, invite: tr.invite_code,
            players: rows.map(r => r.name), keepers: rows.filter(r => r.is_goalkeeper).map(r => r.name),
            meta: Object.fromEntries(rows.map(r => [r.name.toLowerCase(), { id: r.id, userId: r.user_id }]))
          };
          const local = state.turmas.find(t => t.id === tr.id);
          // Local edits that haven't reached the server yet win over the server copy.
          next.push(pending.has(tr.id) && local ? Object.assign({}, local, { cloud: true, role: tr.role, invite: tr.invite_code, meta: cloud.meta }) : cloud);
        });
        state.turmas.filter(t => pending.has(t.id) && !next.some(n => n.id === t.id) && !gone.has(t.id)).forEach(t => next.push(t));
        state.turmas = next;
        state.selectedTeams = state.selectedTeams.filter(id => state.turmas.some(t => t.id === id));

        // The open baba: the newer copy wins (the phone may have been offline).
        const open = (await api.openBaba(uid))[0];
        const blocked = new Set(readOutbox().filter(o => o.type === 'baba_finish' || o.type === 'baba_delete').map(o => o.id));
        if (open && open.state && !blocked.has(open.id)) {
          const cloudSaved = open.state.savedAt || 0;
          const localIsSame = state.babaId === open.id;
          if ((!localIsSame && !hasBabaContent()) || (localIsSame && cloudSaved > (state.savedAt || 0))) {
            adoptCloudBaba(open);
          }
        }

        // History of finished babas (yours and your turmas').
        const done = await api.finishedBabas();
        const pendingDays = state.pastDays.filter(d => readOutbox().some(o => o.type === 'baba_finish' && o.id === d.id));
        state.pastDays = pendingDays.concat(done.filter(d => !pendingDays.some(p => p.id === d.id)).map(d => ({
          id: d.id,
          date: `${d.played_on}T12:00:00`,
          title: d.title || 'Baba',
          matches: d.matches || 0,
          owner: d.created_by === uid,
          players: (d.baba_stats || []).map(s => ({ name: s.name, cloudId: s.turma_player_id, goals: s.goals, assists: s.assists, saves: s.saves, matches: s.matches, wins: s.wins }))
        })));

        if (state.selectedTeams.length) syncPool();
        repair();
        cacheState();
        renderAllComponents();
        if (document.getElementById('modal-database') && !document.getElementById('modal-database').classList.contains('hidden')) renderTurmaList();
        if (editingTurmaId) renderTurmaEditor();
        setSync(readOutbox().length ? 'syncing' : 'ok');
        flushOutbox();
      } catch (e) {
        setSync(isNetworkError(e) ? 'offline' : 'error');
        if (!isNetworkError(e)) console.warn('BABA pull failed', e);
      }
    }

    function adoptCloudBaba(row) {
      const keep = { turmas: state.turmas, pastDays: state.pastDays };
      const wasRunning = state.match.isRunning;
      state = migrate(Object.assign({}, row.state, keep, { v: STATE_VERSION }));
      state.babaId = row.id;
      state.lastFinish = null;
      if (state.match.isRunning && state.match.endAt) runTicker();
      else if (wasRunning) { state.match.isRunning = false; state.match.endAt = null; }
      repair();
    }

    /* ---- Installable app (service worker) ---- */
    function registerServiceWorker() {
      if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        location.reload();
      });
      navigator.serviceWorker.register('sw.js').then(reg => {
        const offer = worker => {
          // Never swap versions in the middle of a match: ask first.
          showToast('Nova versão do BABA disponível.', 'success', { label: 'Atualizar', fn: () => worker.postMessage('skipWaiting') });
        };
        if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
          });
        });
      }).catch(() => {});
    }

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
        handlePendingInvite();
        offerLocalImport();
      });
    }

    async function logout() {
      if (!(await askConfirm('Sair da conta? O baba de hoje fica salvo e volta quando você entrar de novo.', 'Sair'))) return;
      closeProfile();
      saveState();
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
      releaseWakeLock();
      await api.signOut();
      currentUser = null;
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
      if (!t || t.role !== 'admin') return;
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
    function myStats() {
      if (!currentUser) return null;
      const linked = new Set(myPlayerIds);
      const myNamesToday = new Set();
      state.turmas.forEach(t => Object.entries(t.meta || {}).forEach(([n, m]) => { if (m.userId === currentUser.id) myNamesToday.add(n); }));
      if (!linked.size && !myNamesToday.size) return null;
      const tot = { babas: 0, goals: 0, assists: 0, saves: 0, matches: 0, wins: 0 };
      state.pastDays.forEach(d => {
        const rows = d.players.filter(p => p.cloudId && linked.has(p.cloudId));
        if (rows.length) tot.babas++;
        rows.forEach(p => STAT_KEYS.forEach(k => { tot[k] += Number(p[k]) || 0; }));
      });
      const today = state.players.find(p => myNamesToday.has(p.name.trim().toLowerCase()) && hasStats(p));
      if (today) { tot.babas++; STAT_KEYS.forEach(k => { tot[k] += Number(today[k]) || 0; }); }
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
        let dest = state.turmas.find(x => sameName(x.name, t.name) && x.role === 'admin');
        if (!dest) {
          dest = { id: uuid(), name: t.name, cloud: true, role: 'admin', invite: null, players: [], keepers: [], meta: {} };
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
      document.getElementById('header-initials').innerText = acc ? initials(acc.name) : '?';
      document.getElementById('profile-avatar').innerText = acc ? initials(acc.name) : '?';
      document.getElementById('profile-name').innerText = acc ? acc.name : '';
      document.getElementById('profile-user').innerText = acc ? acc.email || '' : '';
      document.getElementById('profile-bio-toggle').checked = !!(acc && readLock(acc.id));
    }

    async function openProfile() {
      if (!currentUser) return;
      renderProfileBits();
      setSync(syncState);
      const toggle = document.getElementById('profile-bio-toggle');
      const sub = document.getElementById('profile-bio-sub');
      const locked = !!readLock(currentUser.id);
      sub.innerText = locked ? 'O BABA pede a digital ao abrir' : 'Verificando...';
      document.getElementById('modal-profile').classList.remove('hidden');
      const avail = await bioAvailable();
      if (!locked) sub.innerText = avail ? 'Desativada' : 'Indisponível neste navegador';
      toggle.disabled = !avail && !locked;
      pullCloud();
    }

    function closeProfile() {
      document.getElementById('modal-profile').classList.add('hidden');
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
        [CACHE_PREFIX, OUTBOX_PREFIX, LOCK_PREFIX, IMPORTED_PREFIX].forEach(p => lsDel(p + uid));
        await api.signOut();
        currentUser = null;
        state = defaultState();
        closeAccountSheet();
        closeProfile();
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

    /* ===================================================================
       HELPERS
       =================================================================== */
    const teamSize = () => FORMAT_SIZES[state.match.gameFormat] || 5;
    const byId = id => state.players.find(p => p.id === id) || null;
    const nameOf = id => { const p = byId(id); return p ? p.name : '?'; };
    const presentPlayers = () => state.players.filter(p => p.present);
    const hasStats = p => !!(p.goals || p.assists || p.saves || p.matches);
    const turmaById = id => state.turmas.find(t => t.id === id) || null;
    const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
    const fmtClock = ms => ms ? new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

    function sideOf(id) {
      for (const s of ['A', 'B']) {
        const t = state.court[s];
        if (t && t.ids.includes(id)) return s;
      }
      return null;
    }

    function nextPlayerId() {
      return state.players.reduce((m, p) => Math.max(m, p.id || 0), 0) + 1;
    }

    function arrivalRank(id) {
      const ordered = presentPlayers().sort((a, b) => (a.arrival || 0) - (b.arrival || 0));
      return ordered.findIndex(p => p.id === id) + 1;
    }

    /* Restores the invariant: drops unknown/absent/duplicate ids from court
       and queue, and appends any present player who is nowhere, by arrival. */
    function repair() {
      const known = new Map(state.players.map(p => [p.id, p]));
      const seen = new Set();
      const keep = id => {
        const p = known.get(id);
        if (!p || !p.present || seen.has(id)) return false;
        seen.add(id);
        return true;
      };
      ['A', 'B'].forEach(side => {
        const t = state.court[side];
        if (!t) return;
        t.ids = (t.ids || []).filter(keep);
        if (!t.ids.length) state.court[side] = null;
      });
      state.queue = state.queue.filter(keep);
      state.players
        .filter(p => p.present && !seen.has(p.id))
        .sort((a, b) => (a.arrival || 0) - (b.arrival || 0))
        .forEach(p => { seen.add(p.id); state.queue.push(p.id); });
    }

    function buzz(pattern) {
      try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
    }

    function unlockAudio() {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        if (!audioCtx) audioCtx = new Ctx();
        if (audioCtx.state === 'suspended') audioCtx.resume();
      } catch (e) {}
    }

    function playRefereeWhistle() {
      try {
        unlockAudio();
        if (!audioCtx) return;
        const ctx = audioCtx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(2800, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(3400, ctx.currentTime + 0.1);
        osc.frequency.exponentialRampToValueAtTime(2500, ctx.currentTime + 0.4);
        gain.gain.setValueAtTime(0.6, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      } catch (e) {}
    }

    async function requestWakeLock() {
      try {
        if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
          wakeLock = await navigator.wakeLock.request('screen');
          wakeLock.addEventListener('release', () => { wakeLock = null; });
        }
      } catch (e) {}
    }

    function releaseWakeLock() {
      try { if (wakeLock) wakeLock.release(); } catch (e) {}
      wakeLock = null;
    }

    function commit(message, type) {
      saveState();
      renderAllComponents();
      if (message) showToast(message, type);
    }

    function renderAllComponents() {
      renderHome();
      renderSheetTable();
      renderMatchView();
      renderFila();
      renderStatsView();
      renderDailyResumo();
      renderProfileBits();
    }

    /* Fixed-width digit cells so the serif clock doesn't jitter as it counts. */
    function digitsHtml(str) {
      return String(str).split('').map(c => c === ':' ? '<span class="dg-c">:</span>' : `<span class="dg">${escapeHtml(c)}</span>`).join('');
    }

    /* ===================================================================
       INÍCIO
       =================================================================== */
    function greeting() {
      const h = new Date().getHours();
      return h >= 5 && h < 12 ? 'Bom dia,' : h >= 12 && h < 18 ? 'Boa tarde,' : 'Boa noite,';
    }

    /* What the court needs next, shared by the home hero and the Placar. */
    function nextCourtStep() {
      if (!state.players.length) return { text: 'Escolha as turmas de hoje.', label: 'Escolher turmas', fn: 'openDatabaseModal()' };
      if (!presentPlayers().length) return { text: 'Marque quem chegou: a ordem monta os times.', label: 'Marcar chegadas', fn: "switchTab('ficha')" };
      if (state.queue.length) return { text: `${state.queue.length} esperando na fila.`, label: 'Montar times', fn: 'buildTeams()' };
      return { text: 'Falta gente pro outro time.', label: 'Marcar chegadas', fn: "switchTab('ficha')" };
    }

    function updateHomeLive() {
      const m = state.match;
      const { A, B } = state.court;
      const hasCourt = !!(A && B);
      const label = !hasCourt ? 'Aguardando' : m.isRunning ? 'Rolando' : m.secondsLeft === 0 ? 'Fim do tempo' : playedSeconds() > 0 ? 'Pausado' : 'Pronto';
      const liveText = document.getElementById('home-live-text');
      if (!liveText) return;
      liveText.innerText = label;
      document.getElementById('cm-status').innerText = label;
      document.getElementById('cm-dot').classList.toggle('hidden', !m.isRunning);
      document.getElementById('cm-dot-idle').classList.toggle('hidden', !!m.isRunning);
      document.getElementById('home-live-dot').classList.toggle('hidden', !m.isRunning);
      document.getElementById('home-dial-sub').innerText = !hasCourt ? 'Sem times em quadra' : m.isRunning ? 'Bola rolando' : label;
      const badge = document.getElementById('home-live-badge');
      badge.classList.toggle('hidden', !m.isRunning);
      badge.classList.toggle('flex', !!m.isRunning);
    }

    function renderHome() {
      const dateTxt = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
      document.getElementById('home-date').innerText = dateTxt.charAt(0).toUpperCase() + dateTxt.slice(1);
      document.getElementById('home-hello').innerText = greeting();
      document.getElementById('home-name').innerText = (currentUser ? firstName(currentUser.name) : 'craque') + '.';

      const present = presentPlayers().length;
      const { A, B } = state.court;
      const hasCourt = !!(A && B);
      let status;
      if (!state.players.length) status = 'Escolha as turmas pra começar o baba.';
      else if (!present) status = `${state.players.length} na lista · ninguém chegou ainda.`;
      else status = `${present} chegaram · ${state.queue.length} na fila${A && A.streak > 0 ? ` · Time ${A.label} é o rei` : ''}.`;
      document.getElementById('home-status').innerText = status;

      // Hero
      document.getElementById('home-match-no').innerText = `Partida ${state.matchHistory.length + 1}`;
      document.getElementById('home-dial-top').innerText = hasCourt ? `Time ${A.label} × Time ${B.label}` : 'Sem times';
      document.getElementById('home-timer').innerHTML = digitsHtml(fmtMMSS(Math.max(0, state.match.secondsLeft)));
      ['home-btn-left', 'home-btn-right'].forEach(id => { document.getElementById(id).style.visibility = hasCourt ? 'visible' : 'hidden'; });
      const strip = document.getElementById('home-strip');
      if (hasCourt) {
        const cell = (label, value) => `<div class="py-2 text-center min-w-0"><p class="text-[10.5px] font-semibold text-butter/65">${label}</p><p class="font-serif text-[23px] leading-tight truncate px-1">${value}</p></div>`;
        strip.className = 'relative glass grid grid-cols-3 divide-x divide-white/15';
        strip.innerHTML =
          cell('Placar', `${state.match.scoreA} × ${state.match.scoreB}`) +
          cell('Na fila', state.queue.length) +
          cell('Rei', A.streak > 0 ? `Time ${A.label}` : '—');
      } else {
        const step = nextCourtStep();
        strip.className = 'relative glass flex items-center justify-between gap-3 pl-3.5 pr-2 py-2';
        strip.innerHTML = `<p class="text-[13px] font-semibold text-butter/85 leading-snug min-w-0">${escapeHtml(step.text)}</p><button onclick="${step.fn}" class="btn-butter h-10 px-4 text-[13px] flex-shrink-0">${step.label}</button>`;
      }
      updateHomeLive();

      // Shortcuts
      const missing = state.players.filter(p => !p.present).length;
      const leader = [...state.players].filter(p => p.goals).sort((a, b) => b.goals - a.goals)[0];
      const orb = (size, x, y, c1, c2, c3) => `<span class="orb" style="width:${size}px;height:${size}px;left:${x}px;top:${y}px;background:radial-gradient(circle at 32% 30%,${c1} 0%,${c2} 50%,${c3} 100%)"></span>`;
      const shortcut = (onclick, cls, orbs, title, sub) => `
        <button onclick="${onclick}" class="snap-start flex-shrink-0 w-[150px] h-[178px] rounded-[24px] relative overflow-hidden text-left p-3.5 flex flex-col justify-end active:scale-[0.97] transition ${cls}">
          ${orbs}
          <span class="relative block text-[15px] font-bold leading-tight">${title}</span>
          <span class="relative block text-[12px] font-medium opacity-75 mt-0.5 truncate">${sub}</span>
        </button>`;
      const cream = ['#FFFFFF', '#FBF5E0', '#E8DDB8'], butter = ['#FFFBEA', '#FBE59A', '#EFC955'], sage = ['#F4FAEE', '#CFE3C1', '#9EC28E'], deep = ['#2F7A6A', '#0B4A42', '#012E2A'];
      document.getElementById('home-shortcuts').innerHTML = [
        shortcut("switchTab('ficha')", 'bg-gradient-to-br from-[#EAF3E1] to-[#CFE3C1] text-ink border border-white/60',
          orb(84, 34, 18, ...cream) + orb(54, 18, 52, ...sage.map((c, i) => i ? '#8DB97C' : c)) + orb(30, 98, 30, ...butter),
          'Chegadas', missing ? `${missing} faltam chegar` : `${present} chegaram`),
        shortcut("switchTab('fila')", 'bg-gradient-to-br from-[#FFF6D3] to-[#FBE08B] text-ink border border-white/60',
          orb(84, 40, 14, ...cream) + orb(46, 22, 56, ...butter.map((c, i) => i === 2 ? '#DDA92A' : c)) + orb(32, 104, 34, ...sage),
          'Times e fila', hasCourt ? `${state.queue.length} esperando` : 'Montar times'),
        shortcut("switchTab('stats')", 'bg-gradient-to-br from-[#0B4A42] to-[#002A26] text-butter',
          orb(84, 36, 16, ...deep.map((c, i) => i === 0 ? '#3F8C7A' : c)) + orb(40, 92, 46, ...butter) + orb(26, 22, 64, ...sage),
          'Ranking', leader ? `${firstName(leader.name)} lidera` : 'Sem gols ainda'),
        shortcut('openDatabaseModal()', 'bg-card text-ink border border-ink/10',
          orb(80, 38, 16, ...butter) + orb(44, 20, 54, ...sage) + orb(28, 104, 40, ...deep),
          'Turmas', `${state.selectedTeams.length} selecionada${state.selectedTeams.length === 1 ? '' : 's'}`)
      ].join('');

      // Today
      const pool = state.players.filter(p => p.present || hasStats(p));
      const top = key => { const s = [...pool].sort((a, b) => (b[key] || 0) - (a[key] || 0))[0]; return s && s[key] ? s : null; };
      const row = (tile, icon, title, sub, value, unit) => `
        <div class="card flex items-center gap-3 p-3 pr-4">
          <span class="tile ${tile}"><i class="fa-solid ${icon}"></i></span>
          <div class="min-w-0 flex-1">
            <p class="text-[15px] font-bold truncate">${title}</p>
            <p class="text-[12.5px] text-ink-2 truncate">${sub}</p>
          </div>
          <span class="font-serif text-[30px] leading-none text-pitch">${value}</span>${unit ? `<span class="text-[11px] font-semibold text-ink-2 self-end mb-0.5 -ml-1.5">${unit}</span>` : ''}
        </div>`;
      const rows = [];
      const g = top('goals'), a = top('assists'), s = top('saves');
      if (g) rows.push(row('bg-butter text-pitch', 'fa-futbol', 'Artilheiro', escapeHtml(g.name), g.goals, g.goals === 1 ? 'gol' : 'gols'));
      if (a) rows.push(row('bg-sage text-pitch', 'fa-handshake', 'Garçom', escapeHtml(a.name), a.assists, 'assist.'));
      if (s) rows.push(row('bg-sunk text-pitch', 'fa-hand', 'Paredão', escapeHtml(s.name), s.saves, 'def.'));
      const last = state.matchHistory[0];
      rows.push(row('bg-pitch text-butter', 'fa-flag-checkered', 'Partidas jogadas',
        last ? `Última: Time ${last.labelA} ${last.scoreA} × ${last.scoreB} Time ${last.labelB}` : 'Nenhuma finalizada ainda', state.matchHistory.length, ''));
      if (!g && !a && !s) rows.unshift(`<p class="text-[13px] text-ink-2 px-1">Artilheiro, garçom e paredão aparecem aqui depois do primeiro gol.</p>`);
      document.getElementById('home-today').innerHTML = rows.join('');
      renderMine();
    }

    /* "Meus números": the signed-in player's totals across every baba. */
    function renderMine() {
      const box = document.getElementById('home-mine');
      if (!box) return;
      if (!cloudOn()) { box.innerHTML = ''; return; }
      const mine = myStats();
      if (!state.turmas.length) {
        box.innerHTML = `
          <div class="card p-4 space-y-3">
            <div>
              <p class="text-[15px] font-bold">Comece pela sua turma</p>
              <p class="text-[13px] text-ink-2 leading-snug mt-0.5">Crie a turma do seu baba ou entre numa com o código que a galera mandou.</p>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <button onclick="openDatabaseModal(); createTurma();" class="btn-primary h-11 text-[13px]"><i class="fa-solid fa-plus"></i> Criar turma</button>
              <button onclick="openJoinSheet()" class="btn-outline h-11 text-[13px]"><i class="fa-solid fa-ticket"></i> Tenho convite</button>
            </div>
          </div>`;
        return;
      }
      if (!mine) {
        box.innerHTML = `
          <button onclick="openDatabaseModal()" class="card w-full p-4 flex items-center gap-3 text-left">
            <span class="tile bg-sage text-pitch"><i class="fa-solid fa-user-check"></i></span>
            <span class="min-w-0 flex-1">
              <span class="block text-[15px] font-bold">Ligue seu nome à sua conta</span>
              <span class="block text-[13px] text-ink-2 leading-snug">Abra sua turma e toque no seu nome para ver seus números de todos os babas.</span>
            </span>
            <i class="fa-solid fa-chevron-right text-[12px] text-ink-3"></i>
          </button>`;
        return;
      }
      const cell = (v, l) => `<div class="text-center min-w-0"><p class="font-serif text-[30px] leading-none text-pitch">${v}</p><p class="text-[11px] font-semibold text-ink-2 mt-1">${l}</p></div>`;
      box.innerHTML = `
        <section>
          <p class="eyebrow">Você</p>
          <h2 class="title mt-0.5 mb-3">Meus números</h2>
          <div class="card p-4 grid grid-cols-5 gap-1">
            ${cell(mine.babas, mine.babas === 1 ? 'baba' : 'babas')}${cell(mine.matches, 'jogos')}${cell(mine.goals, 'gols')}${cell(mine.assists, 'assist.')}${cell(mine.wins, 'vitórias')}
          </div>
        </section>`;
    }

    /* ===================================================================
       TURMAS
       =================================================================== */
    function openDatabaseModal() {
      renderTurmaList();
      document.getElementById('modal-database').classList.remove('hidden');
    }

    function renderTurmaList() {
      const container = document.getElementById('db-checkboxes-container');
      const checkedNow = new Set(Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value));
      const isOpen = !document.getElementById('modal-database').classList.contains('hidden');
      if (!state.turmas.length) {
        container.innerHTML = '<p class="text-[14px] text-ink-2 p-2 leading-snug">Nenhuma turma ainda. Crie a sua ou entre numa turma com o código de convite.</p>';
        return;
      }
      container.innerHTML = state.turmas.map(t => {
        const checked = isOpen ? checkedNow.has(t.id) : state.selectedTeams.includes(t.id);
        return `
          <div class="turma-row rounded-2xl border flex items-center gap-2 pr-2 transition ${checked ? 'bg-butter/70 border-butter-3' : 'bg-card border-ink/10'}">
            <label class="flex items-center gap-3 min-w-0 flex-1 p-3 cursor-pointer">
              <input type="checkbox" value="${t.id}" ${checked ? 'checked' : ''} class="w-5 h-5 accent-[#003631] flex-shrink-0"
                onchange="const row=this.closest('.turma-row'); ['bg-butter/70','border-butter-3'].forEach(c => row.classList.toggle(c, this.checked)); ['bg-card','border-ink/10'].forEach(c => row.classList.toggle(c, !this.checked));" />
              <div class="min-w-0">
                <div class="font-bold text-[15px] truncate">${escapeHtml(t.name)}</div>
                <div class="text-[12px] text-ink-2">${t.cloud ? (t.role === 'admin' ? 'Admin · ' : 'Membro · ') : ''}${t.players.length} atleta${t.players.length === 1 ? '' : 's'}${t.keepers.length ? ` · ${t.keepers.length} goleiro${t.keepers.length === 1 ? '' : 's'}` : ''}</div>
              </div>
            </label>
            <button onclick="openTurmaEditor('${t.id}')" class="btn-icon" aria-label="Editar turma"><i class="fa-solid fa-pen"></i></button>
          </div>`;
      }).join('');
    }

    function closeDatabaseModal() {
      document.getElementById('modal-database').classList.add('hidden');
    }

    function applyDatabaseSelection() {
      const selected = Array.from(document.querySelectorAll('#db-checkboxes-container input[type="checkbox"]:checked')).map(cb => cb.value);
      state.selectedTeams = selected;
      syncPool();
      closeDatabaseModal();
      const waiting = state.players.filter(p => !p.present).length;
      commit(waiting && !presentPlayers().length ? 'Turmas prontas! Agora marque quem chegou na Lista.' : 'Turmas atualizadas!');
    }

    function newPlayer(name, turmaId) {
      const t = turmaById(turmaId);
      return {
        id: null, name, isGoalkeeper: !!(t && t.keepers.some(k => sameName(k, name))),
        goals: 0, assists: 0, saves: 0, matches: 0, wins: 0,
        present: false, arrival: null, arrivedAt: null, turmaId: turmaId || null
      };
    }

    /* Rebuilds today's pool from the selected turmas, keeping everyone's
       stats and presence. Players no longer in a selected turma stay only
       if they are avulsos, already here, or already have stats today. */
    function syncPool() {
      const wanted = [];
      const names = new Set();
      state.selectedTeams.forEach(tid => {
        const t = turmaById(tid);
        if (!t) return;
        t.players.forEach(raw => {
          const name = String(raw).trim();
          const key = name.toLowerCase();
          if (!name || names.has(key)) return;
          names.add(key);
          wanted.push({ name, turmaId: tid });
        });
      });

      const next = [];
      const used = new Set();
      wanted.forEach(w => {
        const ex = state.players.find(p => !used.has(p.id) && sameName(p.name, w.name));
        if (ex) {
          if (!ex.turmaId || !state.selectedTeams.includes(ex.turmaId)) ex.turmaId = w.turmaId;
          used.add(ex.id);
          next.push(ex);
        } else {
          next.push(newPlayer(w.name, w.turmaId));
        }
      });
      state.players.forEach(p => {
        if (used.has(p.id)) return;
        if (!p.turmaId || p.present || hasStats(p)) next.push(p);
      });

      let maxId = next.reduce((m, p) => Math.max(m, p.id || 0), 0);
      next.forEach(p => { if (!p.id) p.id = ++maxId; });
      state.players = next;
      repair();
    }

    /* ---- Turma editor ---- */
    let editingTurmaId = null;

    const canEditTurma = t => !!t && (!t.cloud || t.role === 'admin');

    function createTurma() {
      const t = { id: uuid(), name: 'Nova turma', official: false, cloud: cloudOn(), role: 'admin', invite: null, players: [], keepers: [], meta: {} };
      state.turmas.push(t);
      saveState();
      markTurmaDirty(t.id);
      if (document.getElementById('modal-database').classList.contains('hidden')) openDatabaseModal();
      else renderTurmaList();
      // A new turma starts checked for today (still needs Confirmar).
      const cb = document.querySelector(`#db-checkboxes-container input[value="${t.id}"]`);
      if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
      openTurmaEditor(t.id, true);
    }

    function openTurmaEditor(id, isNew) {
      const t = turmaById(id);
      if (!t) return;
      editingTurmaId = id;
      const nameInput = document.getElementById('turma-edit-name');
      nameInput.value = t.name;
      nameInput.readOnly = !canEditTurma(t);
      document.getElementById('turma-edit-add').value = '';
      renderTurmaEditor();
      document.getElementById('modal-turma-edit').classList.remove('hidden');
      if (isNew) setTimeout(() => { nameInput.focus(); nameInput.select(); }, 150);
    }

    function renderTurmaEditor() {
      const t = turmaById(editingTurmaId);
      if (!t) return;
      const admin = canEditTurma(t);
      const uid = currentUser ? currentUser.id : null;
      const meta = t.meta || {};
      const mine = Object.values(meta).some(m => m.userId && m.userId === uid);

      document.getElementById('turma-edit-title').innerText = admin ? 'Editar turma' : 'Turma';
      document.getElementById('turma-edit-role').innerText = !t.cloud ? 'Só neste aparelho' : admin ? 'Você é admin' : 'Você é membro';
      document.getElementById('turma-edit-addbox').classList.toggle('hidden', !admin);
      document.getElementById('turma-edit-delete').innerText = admin ? 'Excluir turma' : 'Sair da turma';

      const invite = document.getElementById('turma-edit-invite');
      invite.classList.toggle('hidden', !t.cloud);
      if (t.cloud) {
        invite.innerHTML = `
          <div class="flex items-center gap-3">
            <div class="min-w-0 flex-1">
              <p class="text-[12px] font-semibold text-ink-2">Convite da turma</p>
              <p class="font-serif text-[26px] leading-tight tracking-[0.08em] text-pitch">${t.invite ? escapeHtml(t.invite) : '········'}</p>
            </div>
            <button onclick="shareInvite('${t.id}')" class="btn-primary h-10 px-4 text-[13px] flex-shrink-0"><i class="fa-solid fa-share-nodes"></i> Convidar</button>
          </div>
          <p class="text-[12px] text-ink-2 leading-snug mt-1.5">Quem entrar pelo convite vê a turma e o histórico, e toca no próprio nome para ligar à conta.${admin ? ` <button onclick="regenerateInvite('${t.id}')" class="font-bold text-pitch underline underline-offset-2">Gerar novo código</button>` : ''}</p>`;
      }

      const linked = Object.values(meta).filter(m => m.userId).length;
      document.getElementById('turma-edit-count').innerText = `Atletas (${t.players.length})${t.cloud ? ` · ${linked} com conta` : ''}`;
      document.getElementById('turma-edit-hint').innerText = t.cloud && !mine ? 'Qual é você? Toque no seu nome para ligar à sua conta.' : (admin ? 'GOL = goleiro' : '');
      const list = document.getElementById('turma-edit-list');
      if (!t.players.length) {
        list.innerHTML = `<p class="text-[14px] text-ink-2 italic py-2">${admin ? 'Nenhum atleta ainda. Adicione acima.' : 'Nenhum atleta na turma ainda.'}</p>`;
        return;
      }
      list.innerHTML = t.players.map((name, i) => {
        const gk = t.keepers.some(k => sameName(k, name));
        const m = meta[name.toLowerCase()];
        const isMe = m && m.userId && m.userId === uid;
        const taken = m && m.userId && !isMe;
        const arg = escapeHtml(JSON.stringify(name));
        const badge = !t.cloud ? '' : isMe
          ? `<button onclick="unclaimPlayer('${t.id}', ${arg})" class="h-8 px-2.5 rounded-full bg-pitch text-butter text-[11px] font-extrabold flex-shrink-0" aria-label="Você. Toque para desfazer">Você</button>`
          : taken ? `<span class="w-8 h-8 rounded-full bg-sage text-pitch text-[11px] flex items-center justify-center flex-shrink-0" title="Tem conta" aria-label="Tem conta"><i class="fa-solid fa-user-check"></i></span>` : '';
        const label = `${gk && !admin ? '🧤 ' : ''}${escapeHtml(name)}`;
        const nameEl = t.cloud && !mine && !taken
          ? `<button onclick="confirmClaim('${t.id}', ${arg})" class="text-left text-[14px] font-bold text-ink truncate flex-1 min-w-0 underline decoration-dotted decoration-pitch/40 underline-offset-4">${label}</button>`
          : `<span class="text-[14px] font-bold text-ink truncate flex-1 min-w-0">${label}</span>`;
        return `
          <div class="flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-2xl bg-card border border-ink/10">
            <span class="text-[11px] text-ink-3 w-5 text-right flex-shrink-0">${i + 1}</span>
            ${nameEl}
            ${badge}
            ${admin ? `<button onclick="toggleTurmaKeeper(${i})" class="h-8 px-2 rounded-lg text-[11px] font-extrabold flex-shrink-0 ${gk ? 'bg-butter text-pitch border border-butter-3' : 'bg-sunk text-ink-3 border border-transparent'}">GOL</button>
            <button onclick="removeTurmaMember(${i})" class="btn-icon !text-danger !bg-danger/10" aria-label="Remover"><i class="fa-solid fa-xmark"></i></button>` : ''}
          </div>`;
      }).join('');
    }

    function parseNames(text) {
      return String(text).split(/[\n,;]+/).map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
    }

    function addMembersFromInput() {
      const t = turmaById(editingTurmaId);
      const input = document.getElementById('turma-edit-add');
      if (!t) return;
      const names = parseNames(input.value);
      if (!names.length) { showToast('Digite pelo menos um nome.', 'warning'); return; }
      let added = 0, dup = 0;
      names.forEach(n => {
        if (t.players.some(x => sameName(x, n))) { dup++; return; }
        t.players.push(n);
        added++;
      });
      input.value = '';
      input.focus();
      saveState();
      markTurmaDirty(t.id);
      renderTurmaEditor();
      if (added) showToast(`${added} atleta${added === 1 ? '' : 's'} adicionado${added === 1 ? '' : 's'}${dup ? ` · ${dup} já estava${dup === 1 ? '' : 'm'}` : ''}`);
      else showToast('Esses nomes já estão na turma.', 'warning');
    }

    async function removeTurmaMember(index) {
      const t = turmaById(editingTurmaId);
      if (!t || !t.players[index]) return;
      const name = t.players[index];
      if (!(await askConfirm(`Tirar ${name} da turma ${t.name}?`, 'Tirar'))) return;
      t.players.splice(index, 1);
      t.keepers = t.keepers.filter(k => !sameName(k, name));
      saveState();
      markTurmaDirty(t.id);
      renderTurmaEditor();
      const p = state.players.find(x => sameName(x.name, name));
      if (p && (p.present || hasStats(p)) && state.selectedTeams.includes(t.id)) {
        showToast(`${name} saiu da turma, mas continua no baba de hoje.`);
      }
    }

    function toggleTurmaKeeper(index) {
      const t = turmaById(editingTurmaId);
      if (!t || !t.players[index]) return;
      const name = t.players[index];
      const isGk = !t.keepers.some(k => sameName(k, name));
      t.keepers = t.keepers.filter(k => !sameName(k, name));
      if (isGk) t.keepers.push(name);
      const p = state.players.find(x => sameName(x.name, name));
      if (p) p.isGoalkeeper = isGk;
      saveState();
      markTurmaDirty(t.id);
      renderTurmaEditor();
    }

    function renameTurma(value) {
      const t = turmaById(editingTurmaId);
      if (!t || !canEditTurma(t)) return;
      t.name = value.replace(/\s+/g, ' ').trimStart() || '';
      saveState();
    }

    function closeTurmaEditor() {
      const t = turmaById(editingTurmaId);
      if (t && !t.name.trim()) t.name = 'Turma sem nome';
      if (t) t.name = t.name.trim();
      if (t && canEditTurma(t)) markTurmaDirty(t.id);
      editingTurmaId = null;
      document.getElementById('modal-turma-edit').classList.add('hidden');
      if (t && state.selectedTeams.includes(t.id)) syncPool();
      saveState();
      renderTurmaList();
      renderAllComponents();
    }

    async function deleteTurma() {
      const t = turmaById(editingTurmaId);
      if (!t) return;
      const admin = canEditTurma(t);
      const msg = admin
        ? `Excluir a turma ${t.name}${t.cloud ? ' para todo mundo' : ''}? Os atletas que já chegaram hoje continuam no baba.`
        : `Sair da turma ${t.name}? Você deixa de ver o elenco e o histórico dela.`;
      if (!(await askConfirm(msg, admin ? 'Excluir' : 'Sair'))) return;
      if (t.cloud) enqueue({ type: admin ? 'turma_delete' : 'turma_leave', id: t.id });
      state.turmas = state.turmas.filter(x => x.id !== t.id);
      const wasSelected = state.selectedTeams.includes(t.id);
      state.selectedTeams = state.selectedTeams.filter(id => id !== t.id);
      state.players.forEach(p => { if (p.turmaId === t.id) p.turmaId = null; });
      editingTurmaId = null;
      document.getElementById('modal-turma-edit').classList.add('hidden');
      if (wasSelected) {
        // Members who never showed up today leave the pool with their turma.
        state.players = state.players.filter(p => p.present || hasStats(p) || !t.players.some(n => sameName(n, p.name)));
        syncPool();
      }
      saveState();
      renderTurmaList();
      renderAllComponents();
      showToast(admin ? 'Turma excluída.' : 'Você saiu da turma.');
    }

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
      state.queue.push(id);
    }

    function checkOut(id) {
      const p = byId(id);
      if (!p || !p.present) return;
      p.present = false;
      p.arrival = null;
      p.arrivedAt = null;
      repair();
    }

    async function togglePlayerAttendance(id) {
      const p = byId(id);
      if (!p) return;
      if (!p.present) {
        checkIn(id);
        commit(`${p.name} chegou · ${state.queue.indexOf(id) + 1}º na fila`);
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
      const absent = state.players.filter(p => !p.present);

      document.getElementById('sheet-active-count').innerText = present.length;
      document.getElementById('sheet-waiting-count').innerText = absent.length;
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
          return row(p, t ? escapeHtml(t.name) : 'Avulso', false);
        }).join('');
      }
      tbody.innerHTML = html;
    }

    /* Today's flag always changes; the saved turmas only where you can edit them. */
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
      document.getElementById('input-new-player-turma').innerHTML = turmaOptionsHtml('Avulso (só hoje)');
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

      const t = turmaById(p.turmaId);
      const wrap = document.getElementById('player-edit-turma-wrap');
      wrap.classList.toggle('hidden', !!t || !state.selectedTeams.length);
      document.getElementById('player-edit-turma').innerHTML = turmaOptionsHtml('Não, só hoje (avulso)');

      const side = sideOf(id);
      const parts = [];
      parts.push(t ? `Turma ${escapeHtml(t.name)}` : 'Avulso');
      if (p.present) parts.push(side ? `em quadra no Time ${state.court[side].label}` : `${state.queue.indexOf(id) + 1}º na fila`);
      else parts.push('ainda não chegou');
      parts.push(`${p.matches || 0} jogo${p.matches === 1 ? '' : 's'} · ${p.wins || 0} vitória${p.wins === 1 ? '' : 's'}`);
      document.getElementById('player-edit-info').innerHTML = parts.join(' · ');

      // Only avulsos can be deleted here; turma members are removed in the turma editor.
      document.getElementById('player-edit-delete').classList.toggle('hidden', !!t);
      document.getElementById('modal-player').classList.remove('hidden');
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

      const newTurma = turmaById(document.getElementById('player-edit-turma').value);
      if (!p.turmaId && newTurma && canEditTurma(newTurma)) {
        if (!newTurma.players.some(n => sameName(n, p.name))) newTurma.players.push(p.name);
        if (p.isGoalkeeper && !newTurma.keepers.some(k => sameName(k, p.name))) newTurma.keepers.push(p.name);
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
      const balance = state.settings.keeperBalance;
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
                    <div class="min-w-0 flex-1">
                      <span class="block text-[14px] font-bold text-ink truncate">${p && p.isGoalkeeper ? '🧤 ' : ''}${escapeHtml(nameOf(id))}</span>
                      <span class="block text-[11px] text-ink-2">${p ? p.matches || 0 : 0} jogo${p && p.matches === 1 ? '' : 's'} hoje</span>
                    </div>
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
              ? `<button onclick="buildTeams()" class="btn-primary w-full h-12 text-[14px]">Montar times pela ordem de chegada</button>`
              : `<button onclick="switchTab('ficha')" class="btn-primary w-full h-12 text-[14px]">Abrir lista de chegada</button>`}
          </div>`;
      } else {
        html = teamCard('A') + teamCard('B') + `
          <button onclick="disbandCourt()" class="w-full py-2.5 text-[12px] font-bold text-ink-2 flex items-center justify-center gap-1.5"><i class="fa-solid fa-rotate-left"></i> Desfazer times e voltar pra fila</button>`;
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

      list.innerHTML = state.queue.map((id, i) => {
        const p = byId(id);
        const g = groups.has(id) ? groups.get(id) : 0;
        const prevG = i > 0 && groups.has(state.queue[i - 1]) ? groups.get(state.queue[i - 1]) : g;
        return `
          <div class="flex items-center gap-2 ${i > 0 && prevG !== g ? 'pt-2 mt-1 border-t border-ink/10' : ''}">
            <span class="w-6 text-center text-[11px] font-extrabold text-ink-3 flex-shrink-0">${i + 1}</span>
            <div class="min-w-0 flex-1">
              <span class="block text-[14px] font-bold text-ink truncate">${p && p.isGoalkeeper ? '🧤 ' : ''}${escapeHtml(nameOf(id))}</span>
              <span class="block text-[11px] text-ink-2 truncate">${p ? p.matches || 0 : 0} jogo${p && p.matches === 1 ? '' : 's'}${p && p.arrivedAt ? ' · chegou ' + fmtClock(p.arrivedAt) : ''}</span>
            </div>
            ${badge(g)}
            <button onclick="moveQueue(${i}, -1)" class="btn-icon" ${i === 0 ? 'disabled' : ''} aria-label="Subir"><i class="fa-solid fa-arrow-up"></i></button>
            <button onclick="moveQueue(${i}, 1)" class="btn-icon" ${i === state.queue.length - 1 ? 'disabled' : ''} aria-label="Descer"><i class="fa-solid fa-arrow-down"></i></button>
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
      document.getElementById('modal-sub-subtitle').innerText = `Time ${t.label} · cansou, machucou ou foi embora`;

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
      list.innerHTML = (items || '<p class="text-[12px] text-ink-2 italic pb-1">Ninguém na fila para entrar.</p>') + `
        <button onclick="applySub(null)" class="pick-btn !text-ink-2 !font-semibold">
          <span>Ninguém entra (time fica com um a menos)</span>
        </button>`;
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
      document.getElementById('match-game-format').value = state.match.gameFormat || 'futsal';
      document.getElementById('match-goal-limit-rule').value = state.match.goalLimitRule || '2';

      renderCourtCta();
      renderCourtMode();
      updateTimerDisplay();
      updateTimerButton();
      renderMatchRosterText('A');
      renderMatchRosterText('B');
      renderMatchEventsLog();
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

    function updateGameFormat(val) {
      state.match.gameFormat = val;
      // Before kickoff, the teams on court grow to the new size right away.
      let added = 0;
      if (matchNotStarted()) added = topUp('A').length + topUp('B').length;
      const over = ['A', 'B'].some(s => state.court[s] && state.court[s].ids.length > teamSize());
      let msg = `Formato: ${FORMAT_LABELS[val]}`;
      if (added) msg += ` · ${added} entraram da fila`;
      else if (over) msg += ' · times em quadra estão maiores, ajuste na aba Times';
      else if (['A', 'B'].some(s => state.court[s] && state.court[s].ids.length < teamSize())) msg += ' · complete os times na aba Times';
      commit(msg);
    }

    function updateGoalLimitRule(val) {
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
      const m = state.match;
      const secs = minutes * 60;
      m.addedSeconds = (m.addedSeconds || 0) + secs;
      m.secondsLeft = (m.secondsLeft || 0) + secs;
      if (m.isRunning && m.endAt) m.endAt += secs * 1000;
      m.events.unshift({
        type: 'extra',
        seconds: secs,
        time: fmtMMSS(Math.max(0, state.match.secondsLeft)),
        text: `⏱️ Acréscimo de ${minutes} min (total +${Math.round(m.addedSeconds / 60)} min)`
      });
      commit(`+${minutes} min de acréscimo`);
    }

    function toggleMatchTimer() {
      unlockAudio();
      if (state.match.isRunning) pauseMatchTimer();
      else startMatchTimer();
    }

    function startMatchTimer() {
      if (state.match.isRunning) return;
      if (state.match.secondsLeft <= 0) state.match.secondsLeft = state.match.initialSeconds || 420;
      state.match.isRunning = true;
      state.match.endAt = Date.now() + state.match.secondsLeft * 1000;
      saveState();
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

      if (selectedGoalSide === 'A') state.match.scoreA++;
      else state.match.scoreB++;

      const scorer = byId(selectedGoalScorer);
      if (scorer) scorer.goals = (scorer.goals || 0) + 1;
      const assist = selectedGoalAssist ? byId(selectedGoalAssist) : null;
      if (assist) assist.assists = (assist.assists || 0) + 1;

      state.match.events.unshift({
        type: 'goal',
        side: selectedGoalSide,
        scorerId: scorer ? scorer.id : null,
        assistId: assist ? assist.id : null,
        time: fmtMMSS(Math.max(0, state.match.secondsLeft)),
        text: `⚽ Gol do Time ${team.label}: ${scorer ? scorer.name : '?'}${assist ? ` (passe de ${assist.name})` : ''}`
      });

      playRefereeWhistle();
      buzz(80);
      const side = selectedGoalSide;
      saveState();
      renderAllComponents();
      popScore(side);

      if (checkGoalLimitEndCondition()) {
        showToast('🏁 Meta de gols atingida!', 'warning');
        setTimeout(() => finishMatchAndNextChallenger(true), 700);
      } else {
        showToast(`⚽ Gol de ${scorer ? scorer.name : '?'}${assist ? ` · passe de ${assist.name}` : ' · sem assistência'}`);
      }
    }

    function openSaveModal(side) {
      if (!state.court[side]) { showToast('Monte os times primeiro.', 'warning'); return; }
      selectedSaveSide = side;
      const { label, roster, others } = sidePlayers(side);
      document.getElementById('modal-save-title').innerText = `Defesa do Time ${label}`;
      const byKeeper = arr => [...arr].sort((a, b) => (b.isGoalkeeper ? 1 : 0) - (a.isGoalkeeper ? 1 : 0));

      renderPickList(document.getElementById('modal-save-goalkeepers-list'), [
        { label: `Time ${label}`, players: byKeeper(roster) },
        { label: 'Outros presentes', players: byKeeper(others) }
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
      keeper.saves = (keeper.saves || 0) + 1;
      state.match.events.unshift({
        type: 'save',
        side: selectedSaveSide,
        keeperId: keeper.id,
        time: fmtMMSS(Math.max(0, state.match.secondsLeft)),
        text: `🧤 Defesa do Time ${team.label}: ${keeper.name}`
      });
      buzz(40);
      commit(`🧤 Defesa de ${keeper.name}!`);
    }

    function undoLastEvent() {
      const ev = state.match.events[0];
      if (!ev) { showToast('Nenhum lance para desfazer.', 'warning'); return; }
      if (ev.type === 'goal') {
        if (ev.side === 'A') state.match.scoreA = Math.max(0, state.match.scoreA - 1);
        else state.match.scoreB = Math.max(0, state.match.scoreB - 1);
        const s = byId(ev.scorerId);
        if (s) s.goals = Math.max(0, (s.goals || 0) - 1);
        const a = byId(ev.assistId);
        if (a) a.assists = Math.max(0, (a.assists || 0) - 1);
      } else if (ev.type === 'save') {
        const k = byId(ev.keeperId);
        if (k) k.saves = Math.max(0, (k.saves || 0) - 1);
      } else if (ev.type === 'extra') {
        const m = state.match;
        const secs = Math.min(ev.seconds || 0, m.addedSeconds || 0);
        m.addedSeconds = (m.addedSeconds || 0) - secs;
        m.secondsLeft = Math.max(0, m.secondsLeft - secs);
        if (m.isRunning && m.endAt) m.endAt -= secs * 1000;
        if (m.isRunning && m.secondsLeft === 0) pauseMatchTimer();
      }
      state.match.events.shift();
      commit('Último lance desfeito.');
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

    async function finishMatchAndNextChallenger(auto) {
      if (finishing) return;
      const { A, B } = state.court;
      if (!A || !B) { showToast('Monte os dois times antes de finalizar.', 'warning'); return; }

      const nothingHappened = state.match.events.length === 0 && playedSeconds() === 0;
      if (!auto && nothingHappened && !(await askConfirm('Finalizar a partida sem nenhum lance registrado?', 'Finalizar'))) return;
      // The court may have changed while the dialog was open.
      if (state.court.A !== A || state.court.B !== B) return;

      finishing = true;
      try {
        pauseMatchTimer();
        const snapshot = snapshotForUndo();
        const { scoreA, scoreB } = state.match;

        state.matchHistory.unshift({
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          labelA: A.label, labelB: B.label, scoreA, scoreB,
          namesA: A.ids.map(nameOf), namesB: B.ids.map(nameOf),
          played: playedSeconds(), added: state.match.addedSeconds || 0
        });
        updateStandingsRecord(A, scoreA, scoreB);
        updateStandingsRecord(B, scoreB, scoreA);
        [...A.ids, ...B.ids].forEach(id => { const p = byId(id); if (p) p.matches = (p.matches || 0) + 1; });

        const leaving = [];
        let stay = null;
        let msg;
        if (scoreA !== scoreB) {
          const winner = scoreA > scoreB ? A : B;
          const loser = winner === A ? B : A;
          const hi = Math.max(scoreA, scoreB), lo = Math.min(scoreA, scoreB);
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

    async function undoFinish() {
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

    function updateStandingsRecord(team, goalsFor, goalsAgainst) {
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
      if (goalsFor > goalsAgainst) st.wins++;
      else if (goalsFor === goalsAgainst) st.draws++;
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

    /* ===================================================================
       RESUMO & EXPORT
       =================================================================== */
    function sortedStandings() {
      return Object.keys(state.standings)
        .map(k => Object.assign({ team: k }, state.standings[k]))
        .sort((a, b) => b.wins - a.wins || b.sg - a.sg || b.gf - a.gf || a.matches - b.matches);
    }

    /* Compact names for lists: the nickname when there is one ("Pepo"),
       otherwise the first name, plus the last-name initial if it repeats. */
    function shortNames(names) {
      const list = (names || []).map(n => {
        const nick = (n.match(/"([^"]+)"/) || [])[1];
        const parts = n.replace(/"[^"]*"/g, ' ').trim().split(/\s+/);
        return { nick, first: parts[0] || n, last: parts.length > 1 ? parts[parts.length - 1] : '' };
      });
      const base = x => x.nick || x.first;
      const count = {};
      list.forEach(x => { count[base(x)] = (count[base(x)] || 0) + 1; });
      return list.map(x => (!x.nick && count[base(x)] > 1 && x.last) ? `${x.first} ${x.last[0]}.` : base(x)).join(', ');
    }

    function renderDailyResumo() {
      const tbody = document.getElementById('daily-standings-tbody');
      const rows = sortedStandings();
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-ink-2 italic">Sem partidas finalizadas hoje.</td></tr>';
      } else {
        tbody.innerHTML = rows.map(s => `
          <tr>
            <td class="py-2 px-3 min-w-0">
              <span class="block font-bold text-ink">Time ${s.team}</span>
              <span class="block text-[11px] text-ink-2 truncate">${escapeHtml(shortNames(s.names))}</span>
            </td>
            <td class="py-2 px-1 text-center text-ink-2 font-bold">${s.matches}</td>
            <td class="py-2 px-1 text-center text-leaf font-bold">${s.wins}</td>
            <td class="py-2 px-1 text-center text-ink-2 font-bold">${s.draws}</td>
            <td class="py-2 px-1 text-center text-danger font-bold">${s.losses}</td>
            <td class="py-2 px-2 text-center font-extrabold text-pitch">${s.sg > 0 ? '+' : ''}${s.sg}</td>
          </tr>`).join('');
      }

      document.getElementById('btn-undo-finish').classList.toggle('hidden', !state.lastFinish);
      const timeline = document.getElementById('match-history-timeline');
      if (!state.matchHistory.length) {
        timeline.innerHTML = '<p class="text-ink-2 italic text-[12px]">Nenhuma partida finalizada ainda hoje.</p>';
      } else {
        timeline.innerHTML = state.matchHistory.map(h => `
          <div class="p-3 rounded-2xl bg-sunk/60 text-[13px]">
            <div class="flex items-center justify-between gap-2">
              <span class="text-ink-2 text-[11px] font-bold flex-shrink-0">${escapeHtml(h.timestamp)}${h.played ? `<span class="block font-semibold text-[11px]">${fmtMMSS(h.played)}${h.added ? ` (+${Math.round(h.added / 60)}')` : ''}</span>` : ''}</span>
              <span class="font-bold text-ink text-right">Time ${h.labelA} <b class="font-serif font-normal text-[22px] leading-none text-pitch mx-1">${h.scoreA} × ${h.scoreB}</b> Time ${h.labelB}</span>
            </div>
            ${(h.namesA && h.namesA.length) ? `<p class="text-[11px] text-ink-2 mt-1 leading-snug">${escapeHtml(shortNames(h.namesA))} <span class="text-ink-3">vs</span> ${escapeHtml(shortNames(h.namesB))}</p>` : ''}
          </div>`).join('');
      }
    }

    function todayStamp() {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function exportBabaCSV() {
      const q = s => `"${String(s).replace(/"/g, '""')}"`;
      let csv = '﻿Atleta;Turma;Posicao;Chegada;Gols;Assistencias;Defesas;Jogos;Vitorias;Presenca\n';
      state.players.forEach(p => {
        const t = turmaById(p.turmaId);
        csv += [
          q(p.name), q(t ? t.name : 'Avulso'), q(p.isGoalkeeper ? 'Goleiro' : 'Linha'),
          q(p.present ? `${arrivalRank(p.id)}º ${fmtClock(p.arrivedAt)}`.trim() : ''),
          p.goals || 0, p.assists || 0, p.saves || 0, p.matches || 0, p.wins || 0,
          q(p.present ? 'Sim' : 'Nao')
        ].join(';') + '\n';
      });
      offerFile(`BABA_Resumo_${todayStamp()}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8;' }), 'Planilha salva!');
    }

    /* Inside claude.ai the page cannot download directly: it asks the viewer through
       the downloads capability. Opened as a plain file, it falls back to a normal link. */
    let downloadsApi;
    async function getDownloads() {
      if (downloadsApi !== undefined) return downloadsApi;
      try {
        downloadsApi = (window.claude && typeof window.claude.use === 'function') ? await window.claude.use('downloads') : null;
      } catch (e) {
        downloadsApi = null;
      }
      return downloadsApi;
    }

    async function offerFile(filename, blob, okMessage) {
      const dl = await getDownloads();
      if (dl) {
        try {
          const res = await dl.save({ filename, data: blob });
          if (res && res.status === 'saved') showToast(okMessage);
        } catch (e) {
          const code = e && e.code;
          if (code === 'declined') return;
          if (code === 'rate_limited') showToast('Aguarde a confirmação anterior.', 'warning');
          else showToast('Não foi possível baixar o arquivo aqui.', 'warning');
        }
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      showToast(okMessage);
    }

    function generateBabaPDF() {
      const lib = window.jspdf;
      if (!lib || !lib.jsPDF) {
        showToast('Gerador de PDF ainda carregando. Tente de novo.', 'warning');
        return;
      }
      const doc = new lib.jsPDF({ unit: 'mm', format: 'a4' });
      const W = 210, M = 14;
      let y = 18;

      const ensure = need => { if (y + need > 285) { doc.addPage(); y = 18; } };
      const heading = text => {
        ensure(14);
        doc.setFillColor(0, 54, 49);
        doc.rect(M, y - 5, W - 2 * M, 8, 'F');
        doc.setTextColor(255, 237, 168);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(text, M + 2, y);
        doc.setTextColor(20, 20, 20);
        y += 8;
      };
      const row = (cols, bold) => {
        ensure(7);
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(9);
        cols.forEach(c => {
          const txt = doc.splitTextToSize(String(c.text), c.w || 200)[0] || '';
          doc.text(txt, c.x, y, c.align ? { align: c.align } : undefined);
        });
        doc.setDrawColor(220, 220, 220);
        doc.line(M, y + 2, W - M, y + 2);
        y += 6.5;
      };
      const note = text => {
        ensure(6);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(110, 110, 110);
        doc.text(doc.splitTextToSize(text, W - 2 * M - 4)[0] || '', M + 2, y - 1.5);
        doc.setTextColor(20, 20, 20);
        y += 3.5;
      };

      try { doc.addImage(document.getElementById('app-logo'), 'PNG', W - M - 20, 7, 20, 20); } catch (e) {}
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(0, 54, 49);
      doc.text('BABA - Resumo da Pelada', M, y);
      y += 7;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(90, 90, 90);
      doc.text(`Data: ${new Date().toLocaleDateString('pt-BR')}  ·  Formato: ${FORMAT_LABELS[state.match.gameFormat] || ''}  ·  Partidas: ${state.matchHistory.length}`, M, y);
      y += 10;

      heading('CLASSIFICAÇÃO DOS TIMES');
      const standings = sortedStandings();
      if (!standings.length) {
        row([{ text: 'Sem partidas finalizadas.', x: M + 2 }]);
      } else {
        row([
          { text: 'Time', x: M + 2 }, { text: 'J', x: 120, align: 'center' }, { text: 'V', x: 135, align: 'center' },
          { text: 'E', x: 150, align: 'center' }, { text: 'D', x: 165, align: 'center' }, { text: 'SG', x: 185, align: 'center' }
        ], true);
        standings.forEach(s => {
          row([
            { text: `Time ${s.team}`, x: M + 2 }, { text: s.matches, x: 120, align: 'center' }, { text: s.wins, x: 135, align: 'center' },
            { text: s.draws, x: 150, align: 'center' }, { text: s.losses, x: 165, align: 'center' }, { text: (s.sg > 0 ? '+' : '') + s.sg, x: 185, align: 'center' }
          ]);
          if (s.names && s.names.length) note(shortNames(s.names));
        });
      }
      y += 4;

      heading('HISTÓRICO DE JOGOS');
      if (!state.matchHistory.length) {
        row([{ text: 'Nenhuma partida finalizada.', x: M + 2 }]);
      } else {
        [...state.matchHistory].reverse().forEach(h => {
          row([
            { text: h.timestamp, x: M + 2 },
            { text: `Time ${h.labelA}   ${h.scoreA} x ${h.scoreB}   Time ${h.labelB}`, x: 40 }
          ]);
          if (h.namesA && h.namesA.length) note(`${shortNames(h.namesA)}  vs  ${shortNames(h.namesB)}`);
        });
      }
      y += 4;

      heading('ATLETAS');
      const players = [...state.players].sort((a, b) => (b.goals || 0) - (a.goals || 0) || (b.assists || 0) - (a.assists || 0) || (b.matches || 0) - (a.matches || 0));
      if (!players.length) {
        row([{ text: 'Nenhum atleta cadastrado.', x: M + 2 }]);
      } else {
        row([
          { text: 'Atleta', x: M + 2 }, { text: 'Pos', x: 104, align: 'center' }, { text: 'Gols', x: 120, align: 'center' },
          { text: 'Ast', x: 135, align: 'center' }, { text: 'Def', x: 150, align: 'center' }, { text: 'Jogos', x: 166, align: 'center' },
          { text: 'Vit', x: 184, align: 'center' }
        ], true);
        players.forEach(p => row([
          { text: p.name + (p.present ? '' : ' (ausente)'), x: M + 2, w: 82 },
          { text: p.isGoalkeeper ? 'GOL' : 'LIN', x: 104, align: 'center' },
          { text: p.goals || 0, x: 120, align: 'center' }, { text: p.assists || 0, x: 135, align: 'center' },
          { text: p.saves || 0, x: 150, align: 'center' }, { text: p.matches || 0, x: 166, align: 'center' },
          { text: p.wins || 0, x: 184, align: 'center' }
        ]));
      }

      offerFile(`BABA_Resumo_${todayStamp()}.pdf`, doc.output('blob'), 'PDF salvo!');
    }

    function generateBabaPNGCard() {
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 800;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = '#001c1a';
      ctx.fillRect(0, 0, 600, 800);
      ctx.strokeStyle = '#ffeda8';
      ctx.lineWidth = 6;
      ctx.strokeRect(20, 20, 560, 760);

      const logo = document.getElementById('app-logo');
      if (logo && logo.complete) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(40, 40, 84, 84, 16) : ctx.rect(40, 40, 84, 84);
        ctx.clip();
        ctx.drawImage(logo, 40, 40, 84, 84);
        ctx.restore();
      }
      ctx.fillStyle = '#ffeda8';
      ctx.font = 'bold 30px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('RESUMO DA PELADA', 144, 80);
      ctx.fillStyle = '#ffffff';
      ctx.font = '20px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(`${new Date().toLocaleDateString('pt-BR')} · ${state.matchHistory.length} partidas`, 144, 114);

      ctx.fillStyle = '#003631';
      ctx.fillRect(40, 150, 520, 120);
      ctx.strokeStyle = '#ffeda8';
      ctx.lineWidth = 2;
      ctx.strokeRect(40, 150, 520, 120);

      const topScorer = [...state.players].sort((a, b) => (b.goals || 0) - (a.goals || 0))[0];
      ctx.fillStyle = '#ffeda8';
      ctx.font = 'bold 22px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('👑 ARTILHEIRO DO DIA', 60, 190);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(topScorer && topScorer.goals ? `${topScorer.name} (${topScorer.goals} gols)` : '---', 60, 235, 480);

      ctx.fillStyle = '#ffeda8';
      ctx.font = 'bold 20px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('RANKING GERAL', 40, 310);

      const sorted = state.players.filter(p => hasStats(p) || p.present)
        .sort((a, b) => (b.goals || 0) - (a.goals || 0) || (b.assists || 0) - (a.assists || 0)).slice(0, 10);
      let y = 350;
      sorted.forEach((p, i) => {
        ctx.fillStyle = '#ffffff';
        ctx.font = '18px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(`${i + 1}. ${p.name}`, 40, y, 320);
        ctx.fillStyle = '#ffeda8';
        ctx.fillText(`${p.goals || 0} G | ${p.assists || 0} A`, 400, y);
        y += 35;
      });

      canvas.toBlob(blob => {
        if (!blob) { showToast('Não foi possível gerar a imagem.', 'warning'); return; }
        offerFile(`BABA_Card_${todayStamp()}.png`, blob, 'Imagem salva!');
      }, 'image/png');
    }

    /* ===================================================================
       STATS
       =================================================================== */
    function switchStatsCategory(cat) {
      currentStatsCategory = cat;
      ['goals', 'assists', 'saves', 'total', 'wins'].forEach(c => {
        const btn = document.getElementById(`btn-stats-${c}`);
        const on = c === cat;
        btn.classList.toggle('is-selected', on);
      });
      renderStatsView();
    }

    let currentStatsScope = 'today';

    function switchStatsScope(scope) {
      currentStatsScope = scope;
      document.getElementById('btn-scope-today').classList.toggle('is-selected', scope === 'today');
      document.getElementById('btn-scope-all').classList.toggle('is-selected', scope === 'all');
      renderStatsView();
    }

    const STAT_KEYS = ['goals', 'assists', 'saves', 'matches', 'wins'];

    /* Today's numbers as a compact record (what goes into the history). */
    function daySummary() {
      const names = state.selectedTeams.map(id => (turmaById(id) || {}).name).filter(Boolean);
      return {
        id: state.babaId || uuid(),
        date: new Date(state.startedAt || Date.now()).toISOString(),
        title: names.join(' + ') || 'Baba',
        matches: state.matchHistory.length,
        owner: true,
        turmaIds: [...state.selectedTeams],
        players: state.players.filter(hasStats).map(p => {
          const row = { name: p.name, cloudId: playerCloudId(p) };
          STAT_KEYS.forEach(k => { row[k] = p[k] || 0; });
          return row;
        })
      };
    }

    /* Every past baba plus today, summed per player name. */
    function aggregatedPlayers() {
      const map = new Map();
      const add = p => {
        const key = p.name.trim().toLowerCase();
        const cur = map.get(key) || { name: p.name, goals: 0, assists: 0, saves: 0, matches: 0, wins: 0 };
        STAT_KEYS.forEach(k => { cur[k] += Number(p[k]) || 0; });
        map.set(key, cur);
      };
      state.pastDays.forEach(d => d.players.forEach(add));
      state.players.filter(hasStats).forEach(add);
      return [...map.values()];
    }

    function renderStatsView() {
      const configs = {
        goals: { title: 'Artilharia', col: 'Gols', value: p => p.goals || 0 },
        assists: { title: 'Garçons (assistências)', col: 'Ast.', value: p => p.assists || 0 },
        saves: { title: 'Paredão (defesas)', col: 'Def.', value: p => p.saves || 0 },
        total: { title: 'Participações (G+A)', col: 'G+A', value: p => (p.goals || 0) + (p.assists || 0) },
        wins: { title: 'Mais vitórias', col: 'Vit.', value: p => p.wins || 0 }
      };
      const cfg = configs[currentStatsCategory];

      document.getElementById('stats-podium-title').innerHTML = `<i class="fa-solid fa-trophy text-pitch mr-1.5"></i>${cfg.title}`;
      document.getElementById('stats-col-title').innerText = cfg.col;

      const all = currentStatsScope === 'all';
      const note = document.getElementById('stats-scope-note');
      note.classList.toggle('hidden', !all);
      if (all) {
        note.innerText = state.pastDays.length
          ? `Somando ${state.pastDays.length} baba${state.pastDays.length === 1 ? '' : 's'} anterior${state.pastDays.length === 1 ? '' : 'es'} + hoje.`
          : 'Ainda não há babas anteriores. Ao tocar em "Começar novo baba", o dia vai pro histórico. Backups importados também entram aqui.';
      }
      const base = all ? aggregatedPlayers() : state.players.filter(p => p.present || hasStats(p));
      const sorted = base
        .sort((a, b) => cfg.value(b) - cfg.value(a) || (a.matches || 0) - (b.matches || 0) || a.name.localeCompare(b.name));
      const ranked = sorted.filter(p => cfg.value(p) > 0);

      // Podium positions respect ties, like the table below (1, 1, 3...).
      const podiumPos = i => ranked[i] ? ranked.findIndex(p => cfg.value(p) === cfg.value(ranked[i])) + 1 : i + 1;
      const podiumLabel = i => podiumPos(i) === 1 ? '👑 1º' : `${podiumPos(i)}º`;
      const items = [
        { player: ranked[1], height: 'h-20', bg: 'bg-sage text-pitch', label: podiumLabel(1) },
        { player: ranked[0], height: 'h-28', bg: 'bg-pitch text-butter', label: podiumLabel(0) },
        { player: ranked[2], height: 'h-16', bg: 'bg-butter text-pitch', label: podiumLabel(2) }
      ];
      document.getElementById('stats-podium-container').innerHTML = items.map(item => {
        const p = item.player;
        return `
          <div class="flex flex-col items-center justify-end text-center min-w-0">
            <div class="mb-1 w-full min-w-0">
              <div class="text-[12px] font-bold truncate">${p ? escapeHtml(firstName(p.name) === p.name ? p.name : shortNames([p.name])) : '—'}</div>
              <div class="font-serif text-[30px] leading-none text-pitch">${p ? cfg.value(p) : 0}</div>
            </div>
            <div class="${item.height} w-full rounded-t-2xl ${item.bg} flex items-center justify-center font-extrabold text-[12px]">${item.label}</div>
          </div>`;
      }).join('');

      const tbody = document.getElementById('stats-ranking-tbody');
      if (!sorted.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-ink-2 italic">Marque quem chegou para ver o ranking.</td></tr>';
        return;
      }
      // Ties share a position (1, 1, 3...).
      let lastVal = null, lastPos = 0;
      tbody.innerHTML = sorted.map((p, idx) => {
        const v = cfg.value(p);
        const pos = v === lastVal ? lastPos : idx + 1;
        lastVal = v; lastPos = pos;
        return `
          <tr>
            <td class="py-2.5 px-3 text-center font-bold ${pos <= 3 && v > 0 ? 'text-pitch' : 'text-ink-3'}">${pos}º</td>
            <td class="py-2.5 px-2 font-semibold max-w-[12rem] truncate">${escapeHtml(p.name)}</td>
            <td class="py-2 px-3 text-center font-serif text-[22px] leading-none text-pitch">${v}</td>
          </tr>`;
      }).join('');
    }

    /* ===================================================================
       NAV & UTILS
       =================================================================== */
    function switchTab(tabName) {
      // "Resumo" now lives inside Stats, under "Times e jogos".
      if (tabName === 'resumo') { tabName = 'stats'; switchStatsView('jogos'); }
      document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
      document.querySelectorAll('.nav-tab-btn').forEach(btn => btn.classList.toggle('is-active', btn.id === `tab-nav-${tabName}`));
      const content = document.getElementById(`tab-content-${tabName}`);
      if (content) content.classList.remove('hidden');
      if (tabName === 'inicio') renderHome();
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
      pauseMatchTimer();
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
      state.match.gameFormat = m.gameFormat;
      state.match.goalLimitRule = m.goalLimitRule;
      state.match.initialSeconds = m.initialSeconds;
      state.match.secondsLeft = m.initialSeconds;
      state.players.forEach(p => Object.assign(p, { goals: 0, assists: 0, saves: 0, matches: 0, wins: 0, present: false, arrival: null, arrivedAt: null }));
      syncPool();
      commit(hasDay ? 'Dia salvo no histórico da turma. Novo baba: marque quem chegou!' : 'Novo baba! Marque quem chegou na Lista.');
      switchTab('ficha');
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
            <div class="min-w-0 flex-1">
              <span class="block text-[14px] font-bold text-ink truncate">${fmtDate(d.date)} · ${escapeHtml(d.title || 'Baba')}</span>
              <span class="block text-[11px] text-ink-2 truncate">${d.matches || 0} partidas · ${d.players.length} atletas${top ? ` · artilheiro ${escapeHtml(top.name)} (${top.goals})` : ''}</span>
            </div>
            ${d.owner === false ? '' : `<button onclick="deletePastDay('${d.id}')" class="btn-icon !text-danger !bg-danger/10" aria-label="Apagar"><i class="fa-solid fa-xmark"></i></button>`}
          </div>`;
      }).join('');
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
          if (!tName || /^avulso/i.test(tName)) tName = fallback;
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
          ex = { id: uuid(), name, official: false, cloud: cloudOn(), role: 'admin', invite: null, players: [], keepers: [], meta: {} };
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
      if (state.babaId) enqueue({ type: 'baba_delete', id: state.babaId });
      const keep = { turmas: state.turmas, selectedTeams: state.selectedTeams, settings: state.settings, pastDays: state.pastDays, players: state.players };
      const m = state.match;
      state = defaultState();
      Object.assign(state, keep);
      ['gameFormat', 'goalLimitRule', 'initialSeconds'].forEach(k => { state.match[k] = m[k]; });
      state.match.secondsLeft = m.initialSeconds;
      state.players.forEach(p => Object.assign(p, { goals: 0, assists: 0, saves: 0, matches: 0, wins: 0, present: false, arrival: null, arrivedAt: null }));
      syncPool();
      commit('Baba de hoje zerado.');
    }

    let confirmResolver = null;

    function askConfirm(message, okLabel = 'Confirmar') {
      if (confirmResolver) confirmResolver(false);
      document.getElementById('modal-confirm-text').innerText = message;
      document.getElementById('modal-confirm-ok').innerText = okLabel;
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
