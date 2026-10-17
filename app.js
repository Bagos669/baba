    /* ===================================================================
       BABA - STATE

       Model (v4):
       - turmas: saved groups of names, editable, kept across days.
       - players: today's pool (from the selected turmas + convidados).
         A player is "present" once checked in; `arrival` is the check-in order.
       - court.A / court.B: the two teams on the court ({label, ids, streak}).
       - queue: present players waiting, in order. Losers go to the end.
       Invariant: every present player is in exactly one of court.A,
       court.B or queue; absent players are in none of them.
       =================================================================== */
    const STORAGE_KEY = 'baba_gestao_digital_v3';
    const STATE_VERSION = 4;
    // v10: a game is NvN, N = line players per team (1 to 12). The goalkeeper is always apart:
    // 'time' = each team brings one (team = N + 1), 'fixo' = keepers never rotate,
    // 'fila' = the next two in line keep goal, 'sem' = no goalkeeper.
    const KEEPER_MODES = { time: 'goleiro do time', fixo: 'goleiro fixo', fila: 'goleiro da fila', sem: 'sem goleiro' };
    // Old formats (before v10) → [N, keeper mode] (null = keep the chosen one).
    const OLD_FORMATS = { futsal: [4, 'time'], society: [7, 'time'], campo: [11, 'time'], futsal4: [4, null], society7: [7, null], campo11: [11, null] };

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
        lineSize: 4,
        goalLimitRule: '2',
        events: []
      };
    }

    function defaultSettings() {
      // queueOrder: 'chegada' | 'menos-jogos' · lateAfter: minutes after the first kick-off
      // from which a new arrival goes to the front of the line (0 = off) · keeperMode for the
      // line-only formats: 'fixo' (keepers never rotate) | 'fila' (the next two in line keep goal).
      return { keeperBalance: true, drawRule: 'king', maxStreak: 0, queueOrder: 'chegada', lateAfter: 0, keeperMode: 'time', venue: '' };
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
        pastDays: [],
        // Live transmission of this baba ({ id, code, palpites }) and whether the QR was offered.
        live: null,
        liveAsked: false,
        // First kick-off of the day (the time ruler for late arrivals counts from here).
        firstKickoffAt: null
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
      // Before v10 the format named the sport (futsal/society/campo); now it is NvN + a keeper mode.
      if (!(Number((parsed.match || {}).lineSize) >= 1)) {
        const [n, km] = OLD_FORMATS[(parsed.match || {}).gameFormat] || [4, 'time'];
        s.match.lineSize = n;
        if (km) s.settings.keeperMode = km;
        else if (!['fixo', 'fila'].includes(s.settings.keeperMode)) s.settings.keeperMode = 'fixo';
      }
      delete s.match.gameFormat;
      if (!KEEPER_MODES[s.settings.keeperMode]) s.settings.keeperMode = 'time';

      if (!Array.isArray(parsed.turmas)) {
        s.turmas = seedTurmas();
        (parsed.customTeams || []).forEach(t => s.turmas.push({ id: t.id, name: t.name, official: false, players: [], keepers: [] }));
      }
      delete s.customTeams;
      s.turmas.forEach(t => {
        if (!Array.isArray(t.players)) t.players = [];
        if (!Array.isArray(t.keepers)) t.keepers = [];
        if (t.women && !Array.isArray(t.women)) t.women = [];
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
        female: !!p.female,
        jumped: !!p.jumped,
        goals: p.goals || 0,
        assists: p.assists || 0,
        saves: p.saves || 0,
        matches: p.matches || 0,
        wins: p.wins || 0,
        penGoals: p.penGoals || 0,
        penMisses: p.penMisses || 0,
        penSaves: p.penSaves || 0,
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
      scheduleLivePush();
    }

    document.addEventListener('DOMContentLoaded', async () => {
      applyPrefs();
      renderPrefsUI();
      readInviteFromUrl();
      readLiveFromUrl();
      // Multipliers depend on the time left: refresh them while the clock runs.
      setInterval(() => { if (state.live && state.match.isRunning) pushLive(); }, 20000);
      setInterval(() => { if (document.visibilityState === 'visible') renderClock(); }, 15000);
      // Members see today's numbers (and the turma's new babas) without reopening the app.
      setInterval(() => { if (document.visibilityState === 'visible' && currentUser && !state.match.isRunning) pullCloud(); }, 60000);
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
      else {
        showAuth(lsGet('baba_last_email') ? 'login' : 'landing');
        // A spectator from the QR code watches without an account.
        const lc = takePendingLive();
        if (lc) openLive(lc);
      }
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
    let relinkTried = false;
    let othersOpen = [];         // babas in progress on other organizers' phones (my turmas)
    let schemaV2 = null;         // server has owners/pictures/prefs (null = not checked yet)
    let femaleCol = null;        // server keeps "jogadora" on turma players (v9.5)
    let penCol = null;           // server keeps penalty numbers (v10)
    const isMissingColumn = e => !!e && (e.code === '42703' || e.code === 'PGRST200' || e.code === 'PGRST204' || /column|schema cache/i.test(String(e.message || '')));

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
      async memberships(uid) {
        // New columns (owner, icon) arrive with a server update; read the old shape until then.
        if (schemaV2 !== false) {
          const { data, error } = await sb.from('turma_members').select('role, turma:turmas(id, name, invite_code, created_by, owner_id, icon)').eq('user_id', uid);
          if (!error) { schemaV2 = true; return data || []; }
          if (!isMissingColumn(error)) throw error;
          schemaV2 = false;
        }
        return q(sb.from('turma_members').select('role, turma:turmas(id, name, invite_code, created_by)').eq('user_id', uid));
      },
      async players(ids) {
        if (!ids.length) return [];
        // "Jogadora" arrives with a server update (v9.5); read the old shape until then.
        if (femaleCol !== false) {
          const { data, error } = await sb.from('turma_players').select('id, turma_id, name, is_goalkeeper, is_female, user_id').in('turma_id', ids).order('created_at');
          if (!error) { femaleCol = true; return data || []; }
          if (!isMissingColumn(error)) throw error;
          femaleCol = false;
        }
        return q(sb.from('turma_players').select('id, turma_id, name, is_goalkeeper, user_id').in('turma_id', ids).order('created_at'));
      },
      openBaba: uid => q(sb.from('babas').select('id, state, updated_at').eq('created_by', uid).eq('finished', false).order('updated_at', { ascending: false }).limit(1)),
      // Babas still being played in my turmas (by other organizers): "Meus números" counts them live.
      turmaOpenBabas: () => q(sb.from('babas').select('id, title, created_by, state, updated_at').eq('finished', false).gt('updated_at', new Date(Date.now() - 2 * 864e5).toISOString()).order('updated_at', { ascending: false }).limit(20)),
      async finishedBabas() {
        const run = cols => sb.from('babas').select(`id, title, played_on, matches, created_by, turma_ids, venue:state->>venue, baba_stats(${cols})`).eq('finished', true).order('played_on', { ascending: false }).limit(150);
        const base = 'name, goals, assists, saves, matches, wins, turma_player_id';
        if (penCol !== false) {
          const { data, error } = await run(base + ', pen_goals, pen_misses, pen_saves');
          if (!error) { penCol = true; return data || []; }
          if (!isMissingColumn(error)) throw error;
          penCol = false;
        }
        return q(run(base));
      },
      async profile(uid) {
        if (schemaV2 !== false) {
          const { data, error } = await sb.from('profiles').select('name, avatar, prefs').eq('id', uid).limit(1);
          if (!error) return (data || [])[0] || null;
          if (!isMissingColumn(error)) throw error;
        }
        return (await q(sb.from('profiles').select('name').eq('id', uid).limit(1)))[0] || null;
      },
      async updateProfile(uid, patch) {
        const row = {};
        if (patch.name) row.name = patch.name;
        if (schemaV2) {
          if ('avatar' in patch) row.avatar = patch.avatar;
          if (patch.prefs) row.prefs = patch.prefs;
        }
        if (Object.keys(row).length) await q(sb.from('profiles').update(row).eq('id', uid));
        if (patch.name) { try { await sb.auth.updateUser({ data: { name: patch.name } }); } catch (e) {} }
      },
      async signOutOthers() { const { error } = await sb.auth.signOut({ scope: 'others' }); if (error) throw error; },
      async roster(id) { const { data, error } = await sb.rpc('turma_roster', { t: id }); if (error) throw error; return data || []; },
      async setRole(id, member, role) { const { error } = await sb.rpc('set_member_role', { t: id, member, new_role: role }); if (error) throw error; },
      async transfer(id, member) { const { error } = await sb.rpc('transfer_turma', { t: id, member }); if (error) throw error; },
      async removeMember(id, member) { const { error } = await sb.rpc('remove_member', { t: id, member }); if (error) throw error; },
      upsertBaba: row => q(sb.from('babas').upsert(row)),
      async babaGames(id) { const r = await q(sb.from('babas').select('state').eq('id', id).limit(1)); return (r[0] && r[0].state && Array.isArray(r[0].state.games)) ? r[0].state.games : []; },
      deleteBaba: id => q(sb.from('babas').delete().eq('id', id)),
      async replaceStats(babaId, rows) {
        await q(sb.from('baba_stats').delete().eq('baba_id', babaId));
        if (!rows.length) return;
        // Penalty columns arrive with the v10 server update; send without them until then.
        const plain = rows.map(r => { const x = Object.assign({}, r); delete x.pen_goals; delete x.pen_misses; delete x.pen_saves; return x; });
        if (penCol === false) return q(sb.from('baba_stats').insert(plain));
        const { error } = await sb.from('baba_stats').insert(rows);
        if (!error) { penCol = true; return; }
        if (!isMissingColumn(error)) throw error;
        penCol = false;
        await q(sb.from('baba_stats').insert(plain));
      },
      upsertTurma: (id, name, icon) => q(sb.from('turmas').upsert(schemaV2 ? { id, name, icon: icon || null } : { id, name })),
      turmaInvite: async id => ((await q(sb.from('turmas').select('invite_code').eq('id', id).limit(1)))[0] || {}).invite_code || null,
      setInvite: (id, code) => q(sb.from('turmas').update({ invite_code: code }).eq('id', id)),
      deleteTurma: id => q(sb.from('turmas').delete().eq('id', id)),
      async leaveTurma(id, uid) {
        if (schemaV2) { const { error } = await sb.rpc('remove_member', { t: id, member: uid }); if (error) throw error; return; }
        return q(sb.from('turma_members').delete().eq('turma_id', id).eq('user_id', uid));
      },
      insertPlayers: rows => q(sb.from('turma_players').insert(rows)),
      deletePlayers: ids => q(sb.from('turma_players').delete().in('id', ids)),
      setKeeper: (id, value) => q(sb.from('turma_players').update({ is_goalkeeper: value }).eq('id', id)),
      setFemale: (id, value) => q(sb.from('turma_players').update({ is_female: value }).eq('id', id)),
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
            showToast(op.type.startsWith('turma') || op.type === 'player_rename' ? 'Só o dono ou um adm pode mudar a turma.' : 'Uma alteração não foi aceita pelo servidor.', 'warning');
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
      if (op.type === 'profile_update') return api.updateProfile(currentUser.id, op.patch || {});
      if (op.type === 'live_settle') return api.settlePalpites(op.liveId, op.matchNo, op.result);
      if (op.type === 'live_end') return api.updateLive(op.id, { active: false, markets: { open: false } });
    }

    /* Makes the server roster match the local one (names, goalkeepers). */
    async function syncTurmaNow(id) {
      const t = state.turmas.find(x => x.id === id);
      if (!t) return;
      await api.upsertTurma(t.id, t.name, t.icon);
      const rows = await api.players([t.id]);
      const local = new Map(t.players.map(n => [n.trim().toLowerCase(), n]));
      const remove = rows.filter(r => !local.has(r.name.toLowerCase())).map(r => r.id);
      if (remove.length) await api.deletePlayers(remove);
      const have = new Set(rows.map(r => r.name.toLowerCase()));
      const add = [...local.values()].filter(n => !have.has(n.toLowerCase()))
        .map(n => Object.assign({ turma_id: t.id, name: n, is_goalkeeper: t.keepers.some(k => sameName(k, n)) },
          femaleCol ? { is_female: (t.women || []).some(k => sameName(k, n)) } : {}));
      if (add.length) await api.insertPlayers(add);
      for (const r of rows) {
        if (!local.has(r.name.toLowerCase())) continue;
        const gk = t.keepers.some(k => sameName(k, r.name));
        if (gk !== !!r.is_goalkeeper) await api.setKeeper(r.id, gk);
      }
      // Refresh ids and links for this turma (and who is a "jogadora", once the server keeps it).
      const fresh = await api.players([t.id]);
      if (fresh.length && 'is_female' in fresh[0]) femaleCol = true;
      for (const r of fresh) {
        if (!('is_female' in r) || !local.has(r.name.toLowerCase())) continue;
        const f = (t.women || []).some(k => sameName(k, r.name));
        if (f !== !!r.is_female) { await api.setFemale(r.id, f); r.is_female = f; }
      }
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
      if (!canEditTurma(t)) return;
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
        row: { id, turma_ids: cloudTurmaIds(summary.turmaIds), title: summary.title, played_on: summary.date.slice(0, 10), state: { venue: summary.venue || '', games: summary.games || [] }, finished: true, matches: summary.matches },
        stats: summary.players.map(p => ({
          baba_id: id, turma_player_id: p.cloudId || null, name: p.name,
          goals: p.goals || 0, assists: p.assists || 0, saves: p.saves || 0, matches: p.matches || 0, wins: p.wins || 0,
          pen_goals: p.penGoals || 0, pen_misses: p.penMisses || 0, pen_saves: p.penSaves || 0
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
        const pendingProfile = (readOutbox().find(o => o.type === 'profile_update') || {}).patch || {};
        if (prof) {
          if (prof.name && !pendingProfile.name) currentUser.name = prof.name;
          if ('avatar' in prof && !('avatar' in pendingProfile)) currentUser.avatar = prof.avatar || null;
          adoptServerPrefs(prof.prefs);
          cacheProfile();
        }
        if (mem.some(m => m.turma && 'owner_id' in m.turma)) schemaV2 = true;
        const turmaRows = mem.filter(m => m.turma).map(m => Object.assign({}, m.turma, { role: m.turma.owner_id && m.turma.owner_id === uid ? 'owner' : m.role }));
        const players = await api.players(turmaRows.map(t => t.id));
        myPlayerIds = players.filter(p => p.user_id === uid).map(p => p.id);
        if (myPlayerIds.length && !relinkTried) { relinkTried = true; api.relinkMyStats().catch(() => {}); }

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
            women: rows.length && !('is_female' in rows[0]) ? ((state.turmas.find(t => t.id === tr.id) || {}).women || []) : rows.filter(r => r.is_female).map(r => r.name),
            meta: Object.fromEntries(rows.map(r => [r.name.toLowerCase(), { id: r.id, userId: r.user_id }]))
          };
          const local = state.turmas.find(t => t.id === tr.id);
          if (local && local.people) cloud.people = local.people;
          // Older server without pictures: keep the one chosen on this phone.
          cloud.icon = 'icon' in tr ? (tr.icon || null) : ((local && local.icon) || null);
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
        const oldGames = new Map(state.pastDays.filter(d => d.games).map(d => [d.id, d.games]));
        state.pastDays = pendingDays.concat(done.filter(d => !pendingDays.some(p => p.id === d.id)).map(d => ({
          id: d.id,
          date: `${d.played_on}T12:00:00`,
          title: d.title || 'Baba',
          matches: d.matches || 0,
          owner: d.created_by === uid,
          turmaIds: Array.isArray(d.turma_ids) ? d.turma_ids : [],
          venue: VENUES[d.venue] ? d.venue : '',
          games: oldGames.get(d.id),
          players: (d.baba_stats || []).map(s => ({ name: s.name, cloudId: s.turma_player_id, goals: s.goals, assists: s.assists, saves: s.saves, matches: s.matches, wins: s.wins,
            penGoals: s.pen_goals || 0, penMisses: s.pen_misses || 0, penSaves: s.pen_saves || 0 }))
        })));

        // Today's numbers from babas other people are running right now.
        try {
          const others = await api.turmaOpenBabas();
          othersOpen = (others || []).filter(b => b.created_by !== uid && b.state && Array.isArray(b.state.players) && !state.pastDays.some(d => d.id === b.id))
            .map(b => ({ id: b.id, players: b.state.players.filter(hasStats).map(p => Object.assign({ name: p.name, turmaId: p.turmaId }, Object.fromEntries(STAT_KEYS.map(k => [k, p[k] || 0])))) }));
        } catch (e) {}

        if (state.selectedTeams.length) syncPool();
        repair();
        cacheState();
        renderAllComponents();
        if (document.getElementById('modal-database') && !document.getElementById('modal-database').classList.contains('hidden')) renderTurmaList();
        if (editingTurmaId) renderTurmaEditor();
        setSync(readOutbox().length ? 'syncing' : 'ok');
        flushOutbox();
        loadEvents(true).then(openPendingList);
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
      let hadController = !!navigator.serviceWorker.controller;
      let reloading = false;
      const reload = () => { if (!reloading) { reloading = true; location.reload(); } };
      // A new version took over. Reload right away unless a match or a sheet is
      // open; then offer it, and reload on its own next time the app is hidden.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // The very first install only takes control; nothing to reload.
        if (!hadController) { hadController = true; return; }
        const busy = (state && state.match && state.match.isRunning) || !!document.querySelector('.overlay:not(.hidden), .page:not(.hidden), #tour:not(.hidden)');
        if (!busy) { reload(); return; }
        showToast('BABA atualizado.', 'success', { label: 'Recarregar', fn: reload });
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && !(state.match && state.match.isRunning)) reload(); });
      });
      navigator.serviceWorker.addEventListener('message', e => {
        const d = e.data || {};
        if (d.type !== 'open') return;
        const l = String(d.url || '').match(/lista=([0-9a-f-]{36})/);
        if (l && currentUser) { openEventSheet(l[1]); return; }
        const m = String(d.url || '').match(/ao-vivo=([A-Za-z0-9]{4,12})/);
        if (m && currentUser !== undefined) openLive(m[1].toUpperCase());
      });
      navigator.serviceWorker.register('sw.js').then(reg => {
        if (reg.waiting) reg.waiting.postMessage('skipWaiting');
        setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
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

    /* ===================================================================
       PREFERÊNCIAS (tema, acessibilidade, quadra)
       Saved on the phone (so the theme applies before the first paint)
       and in the profile, so a new phone picks them up.
       =================================================================== */
    const PREFS_KEY = 'baba_prefs_v1';
    const DEFAULT_PREFS = { theme: 'light', textSize: 'normal', reduceMotion: false, sound: true, vibrate: true, tutorialDone: false, tutorialChapters: [], tutorialCardHidden: false, position: '', foot: '', mainTurma: '', detailStats: false };
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

    /* ===================================================================
       SUPORTE
       =================================================================== */
    const FAQ = [
      ['Começando', 'Onde revejo o tutorial?', 'Em Configurações → Suporte → <b>Tutorial do Babinha</b>. São 6 capítulos curtos: o básico, as regras, imprevistos, ao vivo, baba points e conta. Dá pra ver em qualquer ordem.'],
      ['Começando', 'Como começo um baba?', 'Escolha a turma em <b>Início → Turmas</b> (ou crie uma), confirme e vá em <b>Lista</b> marcando quem chegou, na ordem. Depois, em <b>Times</b>, toque em Montar times.'],
      ['Começando', 'Preciso de internet na quadra?', 'Não. Tudo fica salvo no celular e vai pra nuvem quando o sinal voltar. O pontinho no seu avatar mostra: verde é sincronizado, amarelo é esperando internet.'],
      ['Começando', 'Como instalo o BABA no celular?', 'No Android, abra o site no Chrome e toque em <b>Adicionar à tela inicial</b>. No iPhone, no Safari, toque em Compartilhar → <b>Adicionar à Tela de Início</b>.'],
      ['Na quadra', 'Como a fila e os times funcionam?', 'Quem chega primeiro joga primeiro. Quem perde vai pro fim da fila e o próximo entra. No empate, você escolhe em Times se sai o rei, saem os dois ou se decide nos pênaltis.'],
      ['Na quadra', 'Como registro um gol?', 'No Placar, toque em <b>Gol</b> do lado certo, escolha quem fez e depois quem deu o passe (ou "Sem assistência").'],
      ['Na quadra', 'Errei um lance, e agora?', 'Use <b>Desfazer</b> nos lances da partida. Se já finalizou a partida, em Stats → Times e jogos tem "Desfazer última".'],
      ['Na quadra', 'Alguém se machucou. Dá pra trocar?', 'Sim. Em Times, toque no jogador em quadra e escolha quem entra. Quem sai pode ir pro começo ou fim da fila, ou sair do baba.'],
      ['Na quadra', 'Como deixo o placar em tela cheia?', 'No Placar, com os times em quadra, toque no botão de expandir ao lado do relógio. O celular vira um placar deitado pra galera ver.'],
      ['Compromisso', 'Como puxo a lista do próximo baba?', 'Dono ou adm: abra a turma e toque em <b>Puxar lista</b>. Escolha dia, hora, local e, se quiser, o número de vagas. A turma recebe o aviso no celular, um card no chat e um pop-up ao abrir o app.'],
      ['Compromisso', 'Dá pra usar a lista do WhatsApp?', 'Sim. Na lista, toque em <b>Colar lista</b> e cole o texto do grupo. O BABA lê os nomes (com número, emoji, "Não vão:", "Talvez:") e acha quem é da turma, mesmo com apelido ou sem acento. Os que não bateram você confere antes de salvar.'],
      ['Compromisso', 'O que acontece com quem miou?', 'No fim do dia o adm fecha a presença: cumpriu, miou ou justificou. Com a penalidade automática, as faltas viram aviso, depois baixa prioridade (entra na lista depois dos outros) e bloqueio (não confirma sozinho). Quando chega no limite de banir, o BABA só sugere: quem decide é o adm. Os números ficam em <b>Regras de presença</b>, dentro da turma.'],
      ['Compromisso', 'Como salvo o baba na agenda?', 'Na lista, toque em <b>Salvar na agenda</b> (abre no Calendário do iPhone, do Android ou no Outlook) ou em <b>Google Agenda</b>. O horário vai certinho pro fuso do seu celular, com lembrete 2 h antes.'],
      ['Turmas', 'O que é turma pública?', 'O adm liga em <b>Ranking, troféus e desafios</b> → Desafios → Turma pública. Ela passa a aparecer em <b>Explorar turmas</b>, mostra ranking e troféus a qualquer pessoa e pode desafiar outras turmas. Pra entrar nela, continua precisando do convite. Desligando, volta a ser privada.'],
      ['Turmas', 'Como funciona o ranking?', 'Dentro da turma, toque em <b>Ranking, troféus e desafios</b>. Escolha Última partida ou Temporada (6 meses), o número (gols, assistências, participações, vitórias, jogos ou defesas) e Top 10 ou Top 26. Só contam babas encerrados.'],
      ['Turmas', 'Como ganho troféu?', 'No fim de cada temporada de 6 meses (jan a jun e jul a dez), quem liderou cada categoria ganha o troféu na prateleira da turma, desde que a turma tenha pelo menos 3 babas na temporada. Campeonatos ganhos também viram troféu.'],
      ['Turmas', 'O que é prestígio?', 'É a pontuação da turma: babas encerrados, atletas ativos, desafios jogados e ganhos, campeonatos e troféus. O nível (Bronze, Prata, Ouro, Diamante) sobe com os pontos. Toque em “Como o prestígio é calculado” pra ver a conta.'],
      ['Turmas', 'Como desafio outra turma?', 'Com a turma pública, abra Desafios e toque em <b>Desafiar uma turma</b> (convite fechado) ou <b>Desafio aberto</b> (fica no mural de Explorar até uma turma aceitar). Depois do jogo, um adm lança o placar e o da outra turma confirma. Sem resposta em 72 h, o placar vale.'],
      ['Turmas', 'Como funciona o campeonato?', 'Em Explorar → Campeonatos, o adm de uma turma pública cria (3 a 8 turmas). As outras se inscrevem e o organizador começa: o app monta todos contra todos e vai montando a classificação (vitória 3, empate 1). Quem ficar em primeiro leva o troféu.'],
      ['Na quadra', 'Como escolho o tamanho do jogo?', 'No Placar, em <b>Jogo (na linha)</b>, de <b>1v1 a 12v12</b>. Conta só quem joga na linha; o goleiro é escolhido ao lado.'],
      ['Na quadra', 'Como funciona o goleiro?', 'No Placar (ou em Times → Regras), em <b>Goleiro</b>: <b>do time</b> (quem tem GOL marcado entra junto com o time; num 4v4 o time tem 5), <b>fixo</b> (os goleiros ficam no gol a noite toda e não entram na fila), <b>da fila</b> (os dois próximos da fila vão pro gol e não perdem o lugar, como na planilha) ou <b>sem goleiro</b>.'],
      ['Na quadra', 'Dá pra decidir o empate nos pênaltis?', 'Sim: Times → Regras → Empate → <b>Pênaltis decidem</b>. No empate abre a disputa: 5 cobranças pra cada lado, depois alternadas. Marque gol, defesa ou fora. Gols e defesas nas cobranças contam no Stats, em <b>Pênaltis</b>; o placar do jogo fica empatado.'],
      ['Na quadra', 'Como troco atletas entre os times?', 'Em Times, toque em <b>Trocar</b> ao lado de quem sai e, lá embaixo, em <b>Trocar com o outro time</b>. Ninguém vai pra fila.'],
      ['Na quadra', 'Quero montar os times do zero.', 'Em Times, toque em <b>Escolher os times na mão</b> (ou <b>Mexer nos times</b>, se já tem time em quadra) e mande cada um pro Time A, Time B ou pra fila.'],
      ['Na quadra', 'Alguém foi embora. Como tiro da fila?', 'Na aba <b>Times</b>, toque no <b>x</b> ao lado do nome na fila de espera. Se a pessoa estiver em quadra, toque no nome dela e em <b>Foi embora</b>. Os números do dia continuam.'],
      ['Na quadra', 'O que é a régua de tempo?', 'Em Times → Regras: quem chega depois do tempo escolhido (contado do primeiro jogo) entra em 1º na fila. Quem chega antes disso vai pro fim, como sempre.'],
      ['Na quadra', 'Dá pra quem jogou menos jogar antes?', 'Sim: Times → Regras → Ordem da fila → <b>Quem jogou menos</b>. A fila se arruma sozinha pelo número de jogos do dia.'],
      ['Na quadra', 'Como corrijo o gol de alguém?', 'Toque no nome da pessoa (na Lista, no time ou na fila) e ajuste gols, assistências e defesas em <b>Números de hoje</b>.'],
      ['Na quadra', 'Tem jogadora no baba. Como marco?', 'Abra a ficha dela e escolha <b>Jogadora</b>. Os destaques viram artilheira, garçonete e paredona, e a turma guarda isso pros próximos babas.'],
      ['Ao vivo', 'Como assisto um jogo pelo código?', 'Na tela de entrada do app (ou em <b>Início</b>, se já tem conta), toque em <b>Assistir um jogo ao vivo</b> e digite o código que aparece no celular de quem organiza. Não precisa de conta pra assistir.'],
      ['Ao vivo', 'O que é o Desafio 1v1?', 'No jogo ao vivo, maiores de 18 desafiam alguém direto: <b>quem vence</b> ou <b>quem faz mais gols</b> na partida. Os dois põem os mesmos pontos, quem acertar leva tudo e empate devolve. Se a pessoa não aceitar até a partida acabar, os pontos voltam.'],
      ['Ao vivo', 'De onde vêm os multiplicadores?', 'Dos números da turma: gols por partida de cada um (puxados pra média enquanto a pessoa tem poucos jogos), vitórias e o placar do momento. A porcentagem ao lado é a chance calculada. Quem quase nunca marca aparece com até x20.'],
      ['Baba points', 'O que é o card de atleta?', 'É a sua figurinha no BABA: foto, nome, codinome, título, mascote e seus números. Fica no <b>Perfil</b>, e a galera vê ao tocar em você na turma ou no chat. O fundo, o título e o mascote saem da lojinha.'],
      ['Baba points', 'Como funciona o anúncio de gol?', 'Compre um <b>Anúncio de gol</b> (e, se quiser, um <b>Som de gol</b>) na lojinha, aba Gol. Quando você marcar com o nome ligado à conta, o celular de quem organiza mostra seu cartão e toca seu som, e quem assiste ao vivo vê o cartão.'],
      ['Baba points', 'O que é a pipoca?', 'Uma zoeira de 150 pontos: abra o card de alguém da sua turma e toque em <b>Jogar pipoca</b>. Ela fica 24 h no card e na foto da pessoa. Uma por vez em cada card, até 3 por dia.'],
      ['Ao vivo', 'Como recebo os gols no celular?', 'No jogo ao vivo, toque em <b>Avisar gols</b>. Pra todos os babas das suas turmas, ligue em Configurações → <b>Avisos dos babas das minhas turmas</b>. No iPhone, os avisos só funcionam com o BABA instalado na tela de início.'],
      ['Baba points', 'Como ganho baba points?', 'No bônus do dia, nas <b>Missões da semana</b> (na Lojinha) e acertando palpites. As missões renovam toda segunda.'],
      ['Turmas e convites', 'Como chamo a galera pra turma?', 'Abra a turma e toque em <b>Convidar</b>. Mande o link no grupo: quem entrar vê a turma e o histórico, e toca no próprio nome pra ligar à conta.'],
      ['Turmas e convites', 'Qual a diferença entre dono e adm?', 'O <b>adm</b> adiciona e remove atletas, marca goleiro, convida e tira pessoas. O <b>dono</b> faz tudo isso e ainda escolhe os adms, passa a turma pra outra pessoa e é o único que pode excluir a turma.'],
      ['Turmas e convites', 'Como dou adm pra alguém?', 'O dono abre a turma → <b>Pessoas e cargos</b> → toca na pessoa → <b>Tornar adm</b>. A pessoa precisa ter entrado pelo convite.'],
      ['Turmas e convites', 'Como ligo meu nome à minha conta?', 'Abra sua turma e toque no seu nome na lista de atletas. Seus gols, assistências e vitórias de todos os babas aparecem em "Meus números".'],
      ['Turmas e convites', 'Como coloco foto na turma?', 'Dono ou adm: abra a turma e toque no quadradinho ao lado do nome. Dá pra usar uma foto ou um ícone.'],
      ['Conta e segurança', 'Esqueci minha senha.', 'Na tela de entrar, toque em <b>Esqueci minha senha</b> e use o código de recuperação que apareceu quando você criou a conta.'],
      ['Conta e segurança', 'Perdi o código de recuperação.', 'Se ainda estiver conectado em algum celular, vá em Configurações → <b>Novo código de recuperação</b>.'],
      ['Conta e segurança', 'Posso usar a digital?', 'Sim, em Configurações → Segurança → <b>Pedir digital ao abrir</b>. É uma trava daquele celular: o BABA pede a digital sempre que abrir.'],
      ['Conta e segurança', 'Usei o BABA num celular emprestado.', 'Em Configurações → Segurança → <b>Sair dos outros aparelhos</b>. Só o celular que você está usando continua conectado.'],
      ['Recordações', 'Como faço o PDF com fotos?', 'Em Configurações → <b>PDF do baba com fotos</b> (ou Stats → Times e jogos → PDF). Escolha as fotos, o título e um recado. A primeira foto vira a capa.'],
      ['Recordações', 'Onde ficam os babas antigos?', 'Em Configurações → <b>Babas anteriores</b>, ou dentro da turma em <b>Babas anteriores da turma</b>. Qualquer pessoa da turma (dono, adm ou membro) vê cada baba com os números de todo mundo, e cada um gera PDF.'],
      ['App', 'Como deixo no modo escuro?', 'Configurações → Aparência → <b>Escuro</b>. Em "Auto" o BABA segue o tema do celular.'],
      ['App', 'As letras estão pequenas.', 'Configurações → Aparência → <b>Texto maior</b>.'],
      ['App', 'Como aparece o clima no Início?', 'Toque em <b>Ver o clima</b> e permita a localização. Ela fica só no seu celular, arredondada; o clima vem do Open-Meteo e atualiza a cada 20 minutos.'],
      ['App', 'Como mando o Babinha no chat?', 'No chat, toque na carinha ao lado da mensagem: tem as figurinhas do Babinha e os emojis. Mensagem só com emoji aparece grandona.']
    ];

    function openSupport() {
      document.getElementById('faq-search').value = '';
      renderFaq('');
      renderTutorialHub();
      document.getElementById('page-support').classList.remove('hidden');
      document.getElementById('page-support').scrollTop = 0;
      pushPage('page-support');
    }
    function closeSupport() {
      document.getElementById('page-support').classList.add('hidden');
      popPage('page-support');
    }

    function renderFaq(filter) {
      const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const words = norm(filter || '').split(/\s+/).filter(Boolean);
      const hits = FAQ.filter(([cat, q, a]) => words.every(w => norm(cat + ' ' + q + ' ' + a.replace(/<[^>]+>/g, '')).includes(w)));
      const box = document.getElementById('faq-list');
      if (!hits.length) {
        box.innerHTML = `<div class="card-flat p-4 flex items-center gap-3"><img src="babinha/worried.webp" alt="" class="w-14 h-14 object-contain flex-shrink-0" /><p class="text-[14px] text-ink-2 leading-snug">Não achei nada sobre isso. Tente outra palavra, tipo <b class="text-ink">turma</b>, <b class="text-ink">gol</b> ou <b class="text-ink">senha</b>.</p></div>`;
        return;
      }
      const cats = [...new Set(hits.map(h => h[0]))];
      box.innerHTML = cats.map(cat => `
        <section>
          <p class="eyebrow mb-2 px-1">${cat}</p>
          <div class="card-flat overflow-hidden divide-y divide-ink/[0.07]">
            ${hits.filter(h => h[0] === cat).map(([, q, a]) => `
              <details class="faq-item"${words.length ? ' open' : ''}>
                <summary class="flex items-center gap-3 px-4 py-3.5 text-[15px] font-semibold">
                  <span class="flex-1">${q}</span><i class="faq-chev fa-solid fa-chevron-down text-[12px] text-ink-3 transition"></i>
                </summary>
                <p class="px-4 pb-4 -mt-1 text-[14px] text-ink-2 leading-relaxed">${a}</p>
              </details>`).join('')}
          </div>
        </section>`).join('');
    }

    /* ===================================================================
       TUTORIAL DO BABINHA (v9.5.1)
       Six short chapters. The first one ("O básico") runs on the first
       login; the others live in Suporte → Tutorial and on a home card.
       A step can spotlight a real part of the app (target) and/or play a
       small animated scene (demo) for rules that are hard to picture.
       =================================================================== */
    const TUTORIAL = [
      { id: 'basico', title: 'O básico do baba', img: 'aidentro', desc: 'Da turma ao apito final, do jeito que um baba roda.', steps: [
        { img: 'wave', tab: 'inicio', title: 'E aí! Eu sou o Babinha.', text: 'Já levei muita bicuda nesse baba, olha o band-aid. Em 10 passos te mostro como um baba roda no BABA, do começo ao fim.' },
        { img: 'aidentro', tab: 'inicio', target: '#home-mine', fallback: '#home-babinha', title: 'Tudo começa na turma', text: 'A turma é o grupo fixo do seu baba: os atletas, quem é goleiro e o histórico de todos os jogos. Crie a sua ou entre pelo link de convite que a galera mandou.' },
        { img: 'coach', tab: 'inicio', target: '#home-events', fallback: '#home-babinha', title: 'A lista do próximo baba', text: 'O adm puxa a lista na turma e todo mundo responde Vou, Talvez ou Não vou, até pelo chat. Dá pra colar a lista do WhatsApp e salvar o baba na agenda.' },
        { img: 'run', tab: 'ficha', target: '#sheet-players-tbody', fallback: '#tab-nav-ficha', title: 'Lista de chegada', text: 'No dia, marque quem chegou, na ordem em que chegou. Essa ordem vira a fila: quem chega primeiro, joga primeiro. Apareceu alguém de fora? Adicione como convidado.' },
        { img: 'coach', tab: 'fila', target: '#court-manager', title: 'Montar os times', text: 'Em Times, toque em Montar: o BABA pega os primeiros da fila e monta Time 1 x Time 2. O tamanho vem do jogo escolhido no Placar (ex.: 4v4 com goleiro do time = 5 por time). Prefere escolher? Dá pra montar na mão.' },
        { img: 'calculante', tab: 'fila', demo: 'rotacao', title: 'Rei da Quadra: quem perde sai', text: 'Quem ganha fica. Quem perde volta pro fim da fila, um por um, e os primeiros da fila entram. Assim os times vão se misturando a noite toda.' },
        { img: 'tired', tab: 'placar', target: '#placar-clock', title: 'Relógio e acréscimo', text: 'Escolha o tempo de jogo e dê play. Precisou? +1, +2 ou +3 de acréscimo. Pode apagar a tela: o relógio continua certo.' },
        { img: 'siuu', tab: 'placar', target: '#placar-sides', title: 'Gol, passe e defesa', text: 'Toque em Gol no time que marcou, escolha quem fez e quem deu o passe. Defesa do goleiro também conta. Tudo isso vira estatística.' },
        { img: 'red', tab: 'placar', target: '#btn-finish', title: 'Finalizar a partida', text: 'Acabou? Finalize: o placar vai pro histórico, o vencedor fica e o próximo time entra. Errou alguma coisa? Tem Desfazer.' },
        { img: 'champion', tab: 'inicio', title: 'Pronto pro primeiro baba!', text: 'Tem mais 5 capítulos curtinhos: regras, imprevistos, ao vivo, baba points e conta. Ficam em Configurações → Ajuda → Tutorial, e o Início te lembra.' }
      ] },
      { id: 'regras', title: 'Regras do Rei da Quadra', img: 'calculante', desc: 'Tamanho do jogo, goleiro, empate e pênaltis, fila e régua de tempo.', steps: [
        { img: 'calculante', tab: 'placar', target: '#match-game-format', title: 'Tamanho do jogo e goleiro', text: 'Escolha de 1v1 a 12v12, contando só a linha. Ao lado, o goleiro: do time (entra junto: 4v4 vira 5 por time), fixo, da fila ou sem goleiro.' },
        { img: 'coach', tab: 'fila', target: '#rules-card', title: 'Empate e vitórias seguidas', text: 'No empate, você escolhe: sai o rei, saem os dois ou pênaltis (5 cobranças pra cada lado, e os gols contam no Stats). E dá pra limitar: depois de 2 ou 3 vitórias seguidas, o time sai mesmo ganhando.' },
        { img: 'arrogante', tab: 'fila', demo: 'menosjogos', title: 'Ordem da fila', text: 'Ordem de chegada é o padrão. Em "Quem jogou menos", a fila se arruma sozinha: quem tem menos jogos no dia vai pra frente.' },
        { img: 'bike', tab: 'fila', demo: 'regua', title: 'Régua de tempo (atrasados)', text: 'Sem régua, atrasado vai pro fim. Com a régua em 1 h, por exemplo: quem chega depois de 1 h do primeiro jogo entra em 1º na fila; antes disso, vai pro fim.' },
        { img: 'wink', tab: 'fila', demo: 'goleiro', title: 'Goleiro da fila', text: 'Goleiro fixo: quem é goleiro não sai do gol nem entra na fila. Goleiro da fila: os 2 próximos da fila vão pro gol, um em cada time, e não perdem o lugar.' },
        { img: 'tired', tab: 'placar', target: '#match-goal-limit-rule', title: 'Fim de jogo por gols', text: 'Além do tempo, a partida pode acabar com 2, 3 ou 5 gols, ou com diferença de 2. Bateu a meta, o BABA finaliza sozinho.' }
      ] },
      { id: 'meio', title: 'Imprevistos no meio do baba', img: 'carretilha', desc: 'Ficha, substituição, trocas entre times, atrasados e desfazer.', steps: [
        { img: 'carretilha', tab: 'fila', target: '#court-manager', title: 'A ficha de cada um', text: 'Toque no nome de quem está no time ou na fila: muda nome, posição, jogador ou jogadora, e corrige gols, passes e defesas do dia, sem tirar ninguém do time.' },
        { img: 'run', tab: 'fila', target: '#court-manager', title: 'Substituição', text: 'Cansou ou machucou? Toque em Trocar ao lado do nome e escolha quem entra. Quem sai pode voltar pro começo ou pro fim da fila.' },
        { img: 'coach', tab: 'fila', target: '#court-manager', title: 'Mexer nos times', text: 'Time desequilibrado? No Trocar dá pra trocar dois atletas entre os times. E em Mexer nos times você manda cada um pro Time A, Time B ou pra fila.' },
        { img: 'worried', tab: 'fila', target: '#queue-card', title: 'Alguém foi embora', text: 'Na fila, toque no x ao lado do nome. Se a pessoa estava em quadra, abra a ficha e toque em Foi embora. Os números do dia continuam valendo.' },
        { img: 'bike', tab: 'ficha', target: '#tab-nav-ficha', title: 'Chegou atrasado', text: 'Marque a chegada na Lista a qualquer hora. A pessoa entra no fim da fila, ou em 1º se a régua de tempo estiver ligada e já tiver passado o tempo.' },
        { img: 'ney', tab: 'placar', target: '#btn-court-mode', title: 'Placar deitado', text: 'Com os dois times em quadra, este botão deita o celular com um placar gigante, pra galera ver de longe.' },
        { img: 'scared', tab: 'placar', target: '#btn-undo', title: 'Desfazer', text: 'Gol marcado errado? Desfaça o último lance. Finalizou sem querer? O aviso de partida finalizada tem Desfazer, e em Stats → Jogos também.' }
      ] },
      { id: 'aovivo', title: 'Ao vivo, palpites e chat', img: 'chute', desc: 'Transmitir pelo QR, assistir pelo código, palpites, desafios e chat.', steps: [
        { img: 'chute', tab: 'placar', target: '#live-pill', title: 'Transmitir o jogo', text: 'Com internet, toque em Transmitir: aparece um QR code e um código. Quem escanear ou digitar o código acompanha o placar ao vivo, mesmo sem conta.' },
        { img: 'aidentro', tab: 'inicio', target: '#home-v7', title: 'Assistir pelo código', text: 'Recebeu um código? No Início (ou na tela de entrada do app), toque em "Assistir um jogo ao vivo" e digite.' },
        { img: 'calculante', tab: 'inicio', title: 'Palpites (só 18+)', text: 'No ao vivo, quem tem conta e 18 anos ou mais palpita com baba points: quem faz gol, quem vence. O multiplicador e a chance (%) saem dos números da turma. Pontos não valem dinheiro: é brincadeira.' },
        { img: 'arrogante', tab: 'inicio', title: 'Desafio 1v1', text: 'Quer provocar o amigo? Desafie direto: quem vence ou quem faz mais gols. Os dois põem os mesmos pontos e quem acertar leva tudo. Empate devolve.' },
        { img: 'shhh', tab: 'inicio', title: 'Chat da turma e do jogo', text: 'Cada turma tem chat, e cada jogo ao vivo também, com figurinhas do Babinha na carinha ao lado da mensagem. Mensagem ofensiva? Toque no ⋯ e denuncie: com 3 denúncias ela some e o suporte fica sabendo.' }
      ] },
      { id: 'pontos', title: 'Baba points e lojinha', img: 'dancinha', desc: 'Bônus do dia, missões da semana, lojinha e exclusivos.', steps: [
        { img: 'money', tab: 'inicio', target: '#tab-nav-loja', title: 'Seus baba points', text: 'Toda conta começa com 1.000 pontos. Ganha mais no bônus do dia, nas missões da semana e acertando palpites. Não se compram e não valem dinheiro.' },
        { img: 'calculante', tab: 'inicio', title: 'Missões da semana', text: 'Na Lojinha: abrir o app 3 dias, jogar um baba, marcar gols, organizar... Cada missão vale pontos. Cumpriu? Toque em Pegar. Renova toda segunda.' },
        { img: 'dancinha', tab: 'inicio', title: 'Lojinha', text: 'Troque pontos por molduras, nomes coloridos, brilhos, títulos, codinome, mascote, fundo do card e até o anúncio e o som do seu gol. Tudo aparece no seu card de atleta.' },
        { img: 'siuu', tab: 'inicio', target: '#header-profile', title: 'Card de atleta e pipoca', text: 'Seu card fica no Perfil, e a galera abre tocando em você na turma ou no chat. No card de um amigo dá pra jogar pipoca: 150 pontos e ela fica lá 24 h.' },
        { img: 'aura', tab: 'inicio', title: 'Itens exclusivos', text: 'Alguns itens não estão à venda: a Aura de Fogo Azul é dos 100 primeiros do BABA. Ficam com o selo Fundador na lojinha.' }
      ] },
      { id: 'conta', title: 'Turma, conta e recordações', img: 'messi', desc: 'Convites e cargos, ligar seu nome, Stats, PDF, perfil e suporte.', steps: [
        { img: 'coach', tab: 'inicio', target: '#home-mine', fallback: '#home-babinha', title: 'Convite e cargos', text: 'Na turma, Convidar gera um link pro grupo. O dono escolhe os adms; adm adiciona e tira atletas, marca goleiro e convida. Só o dono exclui a turma.' },
        { img: 'wink', tab: 'inicio', target: '#home-mine', fallback: '#home-babinha', title: 'Ligue seu nome à conta', text: 'Abra a turma e toque no seu nome na lista: seus gols e jogos de todos os babas passam a ser seus, e contam nas missões da semana.' },
        { img: 'messi', tab: 'stats', target: '#tab-nav-stats', title: 'Stats e PDF', text: 'Artilharia, assistências e defesas do dia e de todos os babas. Em Jogos ficam os placares, e dá pra gerar o PDF do baba com as fotos da pelada.' },
        { img: 'shhh', tab: 'inicio', target: '#header-profile', title: 'Perfil e segurança', text: 'No perfil: foto, modo escuro, texto maior, digital e o código de recuperação. Guarde o código em segredo: é ele que salva sua conta se você esquecer a senha.' },
        { img: 'rezando', tab: 'inicio', target: '#header-profile', title: 'Deu ruim? Suporte', text: 'Configurações → Ajuda tem as dúvidas mais comuns, as notas de atualização e estes capítulos. E sempre tem o contatobabaapp@gmail.com.' }
      ] }
    ];

    /* Little animated scenes for the rules. Chips move between positions (left %, top px) frame by frame. */
    const DEMOS = {
      rotacao: { h: 114,
        deco: '<span class="dlabel" style="left:2%;top:0">Em quadra</span><span class="dlabel" style="left:62%;top:0">Fila</span><span class="dline" style="left:58%;top:4px;height:108px"></span>' +
              '<span class="dlabel" style="left:2%;top:50px;letter-spacing:.04em">x</span>',
        chips: [['a1', 'Ana', 'a'], ['a2', 'Beto', 'a'], ['a3', 'Caio', 'a'], ['b1', 'Duda', 'b'], ['b2', 'Edu', 'b'], ['b3', 'Fê', 'b'], ['q1', 'Gui', 'q'], ['q2', 'Hugo', 'q'], ['q3', 'Ivo', 'q'], ['q4', 'Jô', 'q']],
        frames: [
          { cap: 'Time 1 (amarelo) x Time 2 (verde). Deu Time 2.', pos: { a1: [2, 22], a2: [20, 22], a3: [38, 22], b1: [2, 72], b2: [20, 72], b3: [38, 72], q1: [62, 18], q2: [62, 41], q3: [62, 64], q4: [62, 87] } },
          { cap: 'Time 2 fica. Gui, Hugo e Ivo entram. Ana, Beto e Caio vão pro fim da fila, um por um.', cls: { q1: 'n', q2: 'n', q3: 'n' },
            pos: { b1: [2, 22], b2: [20, 22], b3: [38, 22], q1: [2, 72], q2: [20, 72], q3: [38, 72], q4: [62, 18], a1: [62, 41], a2: [62, 64], a3: [62, 87] } }
        ] },
      menosjogos: { h: 138,
        deco: '',
        chips: [['p1', 'Ana · 3 jogos', 'q'], ['p2', 'Bia · 1 jogo', 'q'], ['p3', 'Caio · 2 jogos', 'q'], ['p4', 'Duda · 0 jogo', 'n'], ['p5', 'Edu · 1 jogo', 'q']],
        frames: [
          { cap: 'Ordem de chegada: Ana chegou primeiro, então está na frente.', pos: { p1: [6, 4], p2: [6, 30], p3: [6, 56], p4: [6, 82], p5: [6, 108] } },
          { cap: 'Quem jogou menos: Duda (0 jogo) vai pra frente, Ana (3 jogos) pro fim.', pos: { p4: [6, 4], p2: [6, 30], p5: [6, 56], p3: [6, 82], p1: [6, 108] } }
        ] },
      regua: { h: 114,
        deco: '<span class="druler" style="left:2%;right:2%;top:26px"></span><span class="dtick" style="left:2%;top:20px"></span><span class="dtick" style="left:66%;top:20px"></span>' +
              '<span class="dlabel" style="left:0;top:0">20:00 · 1º jogo</span><span class="dlabel dlabel-hi" style="left:54%;top:0">21:00 · régua de 1 h</span>' +
              '<span class="dlabel" style="left:2%;top:68px">Fila</span>',
        chips: [['q1', 'Gui', 'q'], ['q2', 'Hugo', 'q'], ['q3', 'Ivo', 'q'], ['ana', 'Ana 20:20', 'a'], ['bia', 'Bia 21:10', 'b']],
        frames: [
          { cap: 'Ana chegou às 20:20, antes de 1 h do primeiro jogo...', hide: ['bia'], pos: { q1: [2, 88], q2: [21, 88], q3: [40, 88], ana: [22, 40], bia: [74, 40] } },
          { cap: '...então vai pro fim da fila, como sempre.', hide: ['bia'], pos: { q1: [2, 88], q2: [21, 88], q3: [40, 88], ana: [59, 88], bia: [74, 40] } },
          { cap: 'Bia chegou às 21:10, depois da régua de 1 h...', pos: { q1: [2, 88], q2: [21, 88], q3: [40, 88], ana: [59, 88], bia: [74, 40] } },
          { cap: '...e entra em 1º na fila.', pos: { bia: [2, 88], q1: [24, 88], q2: [43, 88], q3: [62, 88], ana: [81, 88] } }
        ] },
      goleiro: { h: 118,
        deco: '<span class="dgoal" style="left:1%;top:14px">GOL</span><span class="dgoal" style="right:1%;top:14px">GOL</span><span class="dlabel" style="left:2%;top:72px">Fila</span>' +
              '<span class="dlabel" style="left:28%;top:0">Time 1</span><span class="dlabel" style="left:58%;top:0">Time 2</span>',
        chips: [['a1', 'Ana', 'a'], ['a2', 'Beto', 'a'], ['b1', 'Duda', 'b'], ['b2', 'Edu', 'b'], ['g1', 'Gui', 'q'], ['g2', 'Hugo', 'q'], ['q3', 'Ivo', 'q'], ['q4', 'Jô', 'q'], ['s1', 'vaga do Gui', 'ghost'], ['s2', 'vaga do Hugo', 'ghost']],
        frames: [
          { cap: '4v4 com goleiro da fila: os 2 primeiros da fila são Gui e Hugo...', hide: ['s1', 's2'], pos: { a1: [27, 24], a2: [27, 52], b1: [57, 24], b2: [57, 52], g1: [2, 92], g2: [30, 92], q3: [60, 92], q4: [77, 92], s1: [2, 92], s2: [30, 92] } },
          { cap: '...então eles vão pro gol, um de cada lado, e o lugar deles na fila fica guardado.', cls: { g1: 'gk', g2: 'gk' }, pos: { a1: [27, 24], a2: [27, 52], b1: [57, 24], b2: [57, 52], g1: [1, 31], g2: [79, 31], q3: [60, 92], q4: [77, 92], s1: [2, 92], s2: [30, 92] } }
        ] }
    };

    let tourChapter = null;   // the chapter being shown
    let tourIndex = -1;
    let tourOnEnd = null;
    let demoTimer = null;
    const TOUR_STEPS = () => (tourChapter ? tourChapter.steps : []);

    function startTour(force, onEnd, chapterId) {
      if (!force && prefs.tutorialDone) { if (onEnd) onEnd(); return; }
      // A first-time user gets the tour; the release notes are for people coming back.
      if (!force) lsSet(NOTES_KEY, APP_VERSION);
      tourChapter = TUTORIAL.find(c => c.id === (chapterId || 'basico')) || TUTORIAL[0];
      tourOnEnd = onEnd || null;
      ['modal-database', 'modal-turma-edit', 'modal-account', 'modal-backup', 'modal-export', 'modal-popup'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
      });
      if (!document.getElementById('page-support').classList.contains('hidden')) closeSupport();
      if (!document.getElementById('page-profile').classList.contains('hidden')) closeProfile();
      if (!document.getElementById('page-settings').classList.contains('hidden')) closeSettings();
      closeShop();
      tourIndex = 0;
      document.getElementById('toast-container').innerHTML = '';
      document.getElementById('tour').classList.remove('hidden');
      document.getElementById('tour-dots').innerHTML = TOUR_STEPS().map(() => '<span class="tour-dot"></span>').join('');
      showTourStep();
      window.addEventListener('resize', placeTour);
    }
    function startChapter(id) { startTour(true, null, id); }

    function tourGo(delta) {
      const next = tourIndex + delta;
      if (next < 0) return;
      if (next >= TOUR_STEPS().length) { endTour(false); return; }
      tourIndex = next;
      showTourStep();
    }

    function showTourStep() {
      const steps = TOUR_STEPS();
      const step = steps[tourIndex];
      if (step.tab) switchTab(step.tab);
      document.getElementById('tour-img').src = `babinha/${step.img}.webp`;
      const n = TUTORIAL.indexOf(tourChapter) + 1;
      document.getElementById('tour-step').innerText = `Capítulo ${n} · ${tourChapter.title} · ${tourIndex + 1} de ${steps.length}`;
      document.getElementById('tour-title').innerText = step.title;
      document.getElementById('tour-text').innerText = step.text;
      document.querySelectorAll('#tour-dots .tour-dot').forEach((d, i) => d.classList.toggle('on', i === tourIndex));
      document.getElementById('tour-back').classList.toggle('invisible', tourIndex === 0);
      document.getElementById('tour-next').innerText = tourIndex === steps.length - 1 ? 'Bora!' : 'Próximo';
      renderDemo(step.demo);
      const el = tourTarget(step);
      if (el && el.closest('main')) el.scrollIntoView({ block: 'center', behavior: prefs.reduceMotion ? 'auto' : 'smooth' });
      setTimeout(placeTour, prefs.reduceMotion ? 30 : 380);
      placeTour();
    }

    /* Plays a demo scene: every few seconds the chips move to the next frame (and loop). */
    function renderDemo(name) {
      clearInterval(demoTimer);
      demoTimer = null;
      const box = document.getElementById('tour-demo');
      const d = name && DEMOS[name];
      if (!d) { box.classList.add('hidden'); box.innerHTML = ''; return; }
      box.classList.remove('hidden');
      box.innerHTML = `<div class="dstage" style="height:${d.h}px">${d.deco}${d.chips.map(([id, t, k]) => `<span class="dchip dchip-${k}" data-id="${id}" data-k="${k}">${escapeHtml(t)}</span>`).join('')}</div>
        <p class="dcap"></p><div class="dprog">${d.frames.map(() => '<i></i>').join('')}</div>`;
      let f = 0;
      const show = () => {
        const fr = d.frames[f];
        box.querySelectorAll('.dchip').forEach(c => {
          const p = fr.pos[c.dataset.id];
          if (p) { c.style.left = p[0] + '%'; c.style.top = p[1] + 'px'; }
          c.style.opacity = (fr.hide || []).includes(c.dataset.id) ? '0' : '1';
          c.className = `dchip dchip-${(fr.cls && fr.cls[c.dataset.id]) || c.dataset.k}`;
        });
        box.querySelector('.dcap').innerText = fr.cap;
        box.querySelectorAll('.dprog i').forEach((b, i) => b.classList.toggle('on', i === f));
      };
      show();
      demoTimer = setInterval(() => { f = (f + 1) % d.frames.length; show(); }, prefs.reduceMotion ? 4200 : 3200);
    }

    function tourTarget(step) {
      const ok = sel => {
        const el = sel && document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.width > 4 && r.height > 4 ? el : null;
      };
      return ok(step.target) || ok(step.fallback);
    }

    function placeTour() {
      if (tourIndex < 0) return;
      const step = TOUR_STEPS()[tourIndex];
      const hole = document.getElementById('tour-hole');
      const card = document.getElementById('tour-card');
      const el = tourTarget(step);
      const vh = window.innerHeight;
      if (!el) {
        Object.assign(hole.style, { left: '50%', top: '40%', width: '0px', height: '0px' });
        hole.classList.remove('is-ring');
        card.classList.add('at-bottom');
        card.classList.remove('at-top');
        return;
      }
      const r = el.getBoundingClientRect();
      const pad = 6;
      Object.assign(hole.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
      hole.classList.add('is-ring');
      const lower = r.top + r.height / 2 > vh * 0.5;
      card.classList.toggle('at-top', lower);
      card.classList.toggle('at-bottom', !lower);
    }

    function endTour(skipped) {
      document.getElementById('tour').classList.add('hidden');
      window.removeEventListener('resize', placeTour);
      clearInterval(demoTimer);
      demoTimer = null;
      const chapter = tourChapter;
      // Watched to the end (or skipped at the last step) counts as done.
      if (chapter && (!skipped || tourIndex === chapter.steps.length - 1)) markChapterDone(chapter.id);
      tourIndex = -1;
      tourChapter = null;
      switchTab('inicio');
      if (!prefs.tutorialDone) setPref('tutorialDone', true);
      if (skipped) showToast('Tutorial pausado. Os capítulos ficam em Configurações → Ajuda → Tutorial.');
      renderTutorialHub();
      renderHomeV7();
      const fn = tourOnEnd;
      tourOnEnd = null;
      if (fn) fn();
    }

    const chaptersDone = () => new Set(Array.isArray(prefs.tutorialChapters) ? prefs.tutorialChapters : []);
    function markChapterDone(id) {
      const done = chaptersDone();
      if (done.has(id)) return;
      done.add(id);
      setPref('tutorialChapters', TUTORIAL.map(c => c.id).filter(x => done.has(x)));
    }

    /* Suporte → Tutorial: one row per chapter, with a check when watched. */
    function renderTutorialHub() {
      const box = document.getElementById('tutorial-hub');
      if (!box) return;
      const done = chaptersDone();
      box.innerHTML = TUTORIAL.map((c, i) => `
        <button onclick="startChapter('${c.id}')" class="menu-row">
          <img src="babinha/${c.img}.webp" alt="" class="w-12 h-12 object-contain flex-shrink-0" />
          <span class="flex-1 min-w-0">
            <span class="block text-[12px] font-bold text-ink-2">Capítulo ${i + 1} · ${c.steps.length} passos</span>
            <span class="block">${escapeHtml(c.title)}</span>
            <span class="block text-[12px] font-medium text-ink-2 leading-snug">${escapeHtml(c.desc)}</span>
          </span>
          ${done.has(c.id) ? '<span class="w-7 h-7 rounded-full bg-leaf/15 text-leaf flex items-center justify-center flex-shrink-0" aria-label="Visto"><i class="fa-solid fa-check text-[12px]"></i></span>' : '<i class="fa-solid fa-play text-[12px] text-pitch flex-shrink-0"></i>'}
        </button>`).join('');
      const n = TUTORIAL.filter(c => done.has(c.id)).length;
      const sub = document.getElementById('tutorial-progress');
      if (sub) sub.innerText = `${n} de ${TUTORIAL.length} capítulos vistos`;
    }
    function openTutorialHub() {
      openSupport();
      setTimeout(() => { const el = document.getElementById('tutorial-section'); if (el) el.scrollIntoView({ block: 'start' }); }, 60);
    }
    function hideTutorialCard() { setPref('tutorialCardHidden', true); renderHomeV7(); }
    /* Home reminder while there are chapters left (until closed). */
    function tutorialCardHtml() {
      if (!prefs.tutorialDone || prefs.tutorialCardHidden) return '';
      const done = chaptersDone();
      const left = TUTORIAL.filter(c => !done.has(c.id));
      if (!left.length) return '';
      const next = left[0];
      return `
        <div class="card w-full p-3.5 flex items-center gap-3">
          <img src="babinha/${next.img}.webp" alt="" class="w-12 h-12 object-contain flex-shrink-0" />
          <button onclick="startChapter('${next.id}')" class="min-w-0 flex-1 text-left">
            <span class="block text-[12px] font-bold text-ink-2">Tutorial do Babinha · ${TUTORIAL.length - left.length} de ${TUTORIAL.length}</span>
            <span class="block text-[15px] font-bold leading-tight">Próximo: ${escapeHtml(next.title)}</span>
            <span class="block text-[12.5px] text-ink-2">${next.steps.length} passos · menos de 1 minuto</span>
          </button>
          <button onclick="hideTutorialCard()" class="btn-icon" aria-label="Esconder o lembrete do tutorial"><i class="fa-solid fa-xmark"></i></button>
        </div>`;
    }

    /* ===================================================================
       PESSOAS DA TURMA (dono, adms, membros)
       =================================================================== */
    const ROLE_LABEL = { owner: 'Dono', admin: 'Adm', member: 'Membro' };
    let turmaPane = 'atletas';

    function turmaTab(pane) {
      turmaPane = pane;
      document.getElementById('turma-tab-atletas').classList.toggle('is-selected', pane === 'atletas');
      document.getElementById('turma-tab-pessoas').classList.toggle('is-selected', pane === 'pessoas');
      document.getElementById('turma-pane-atletas-head').classList.toggle('hidden', pane !== 'atletas');
      document.getElementById('turma-edit-list').classList.toggle('hidden', pane !== 'atletas');
      document.getElementById('turma-people').classList.toggle('hidden', pane !== 'pessoas');
      if (pane === 'pessoas') { renderTurmaPeople(); loadTurmaPeople(editingTurmaId); }
    }

    async function loadTurmaPeople(id) {
      const t = turmaById(id);
      if (!t || !t.cloud || !cloudOn()) return;
      try {
        const rows = await api.roster(id);
        const live = turmaById(id);
        if (!live) return;
        live.people = rows.map(r => ({ id: r.user_id, name: r.name || 'Sem nome', avatar: r.avatar || null, role: r.role, player: r.player_name || null }));
        if (v7 === true) {
          await ensurePeople(live.people.map(p => p.id));
          live.people.forEach(p => { const c = peopleCache.get(p.id); if (c) p.cosmetics = c.cosmetics; });
        }
        cacheState();
        if (editingTurmaId === id && turmaPane === 'pessoas') renderTurmaPeople();
      } catch (e) {
        if (editingTurmaId === id && turmaPane === 'pessoas' && !(t.people || []).length) {
          document.getElementById('turma-people').innerHTML = `<p class="text-[14px] text-ink-2 py-2">${isNetworkError(e) ? 'Sem internet: a lista de pessoas aparece quando o sinal voltar.' : 'Não consegui carregar as pessoas agora.'}</p>`;
        }
      }
    }

    function renderTurmaPeople() {
      const t = turmaById(editingTurmaId);
      const box = document.getElementById('turma-people');
      if (!t || !box) return;
      const people = t.people || [];
      const uid = currentUser ? currentUser.id : null;
      if (!people.length) {
        box.innerHTML = '<p class="text-[14px] text-ink-2 py-2">Carregando...</p>';
        return;
      }
      const intro = t.role === 'owner'
        ? 'Toque numa pessoa pra ver o card dela, dar ou tirar adm, passar a turma ou remover.'
        : t.role === 'admin' ? 'Toque numa pessoa pra ver o card. Como adm, você pode remover membros.' : 'Toque numa pessoa pra ver o card. Quem cuida da turma: o dono e os adms.';
      box.innerHTML = `<p class="text-[12px] text-ink-2 leading-snug px-1 pb-1">${intro}</p>` + people.map(p => {
        const me = p.id === uid;
        const actionable = !me && (t.role === 'owner' || (t.role === 'admin' && p.role === 'member'));
        const badge = p.role === 'owner' ? 'bg-pitch text-butter' : p.role === 'admin' ? 'bg-butter text-pitch border border-butter-3' : 'bg-sunk text-ink-2';
        const inner = `
          ${framedAvatar(p.avatar, p.name, 'w-10 h-10 text-[13px]', p.cosmetics)}
          <span class="min-w-0 flex-1 text-left">
            <span class="block text-[14px] font-bold truncate">${styledName(p.name, p.cosmetics)}${me ? ' <span class="text-ink-2 font-semibold">(você)</span>' : ''}</span>
            <span class="block text-[12px] text-ink-2 truncate">${p.player ? `Joga como ${escapeHtml(p.player)}` : 'Ainda não ligou o nome'}</span>
          </span>
          <span class="text-[11px] font-extrabold rounded-full px-2.5 py-1 flex-shrink-0 ${badge}">${ROLE_LABEL[p.role] || 'Membro'}</span>
          ${actionable ? '<i class="fa-solid fa-ellipsis-vertical text-ink-3 w-4 text-center flex-shrink-0"></i>' : ''}`;
        return `<button onclick="openAthleteCard('${p.id}', '${t.id}')" class="w-full flex items-center gap-3 p-2 pr-3 rounded-2xl bg-card border border-ink/10 active:scale-[0.99] transition">${inner}</button>`;
      }).join('');
    }

    function openPersonActions(userId) {
      const t = turmaById(editingTurmaId);
      const p = t && (t.people || []).find(x => x.id === userId);
      if (!t || !p) return;
      const row = (fn, icon, label, sub, danger) => `
        <button onclick="${fn}" class="menu-row rounded-2xl ${danger ? '!text-danger' : ''}">
          <span class="tile w-9 h-9 rounded-xl ${danger ? 'bg-danger/10 text-danger' : 'bg-sunk text-pitch'} text-[14px]"><i class="fa-solid ${icon}"></i></span>
          <span class="flex-1 min-w-0"><span class="block">${label}</span>${sub ? `<span class="block text-[12px] font-medium text-ink-2">${sub}</span>` : ''}</span>
        </button>`;
      const arg = `'${t.id}', '${p.id}'`;
      let html = '';
      if (t.role === 'owner') {
        html += p.role === 'admin'
          ? row(`changeMemberRole(${arg}, 'member')`, 'fa-user-minus', 'Tirar adm', 'Volta a ser membro')
          : row(`changeMemberRole(${arg}, 'admin')`, 'fa-user-shield', 'Tornar adm', 'Pode mexer no elenco e convidar');
        html += row(`transferTurma(${arg})`, 'fa-crown', 'Passar a turma pra essa pessoa', 'Ela vira dona e você vira adm');
      }
      if (t.role === 'owner' || (t.role === 'admin' && p.role === 'member')) {
        html += row(`removePerson(${arg})`, 'fa-user-xmark', 'Remover da turma', 'Pode voltar se receber o convite de novo', true);
      }
      document.getElementById('account-title').innerText = p.name;
      document.getElementById('account-body').innerHTML = `
        <div class="flex items-center gap-3 mb-3">${avatarHtml(p.avatar, p.name, 'w-12 h-12 text-[15px]')}<p class="text-[13px] text-ink-2 leading-snug">${ROLE_LABEL[p.role]} da turma ${escapeHtml(t.name)}${p.player ? ` · joga como ${escapeHtml(p.player)}` : ''}</p></div>
        <div class="card-flat overflow-hidden divide-y divide-ink/[0.07]">${html}</div>`;
      document.getElementById('modal-account').classList.remove('hidden');
    }

    function roleError(e) {
      if (isNetworkError(e)) return 'Mudar cargos precisa de internet.';
      const m = String((e && e.message) || '');
      if (m.includes('only_owner')) return 'Só o dono da turma pode fazer isso.';
      if (m.includes('not_allowed')) return 'Você não tem permissão pra isso.';
      return 'Não deu certo. Tente de novo.';
    }

    async function changeMemberRole(turmaId, userId, role) {
      closeAccountSheet();
      try {
        await api.setRole(turmaId, userId, role);
        const p = ((turmaById(turmaId) || {}).people || []).find(x => x.id === userId);
        if (p) p.role = role;
        renderTurmaPeople();
        showToast(role === 'admin' ? `${p ? firstName(p.name) : 'Pessoa'} agora é adm.` : 'Adm removido.');
        loadTurmaPeople(turmaId);
      } catch (e) { showToast(roleError(e), 'warning'); }
    }

    async function transferTurma(turmaId, userId) {
      const t = turmaById(turmaId);
      const p = t && (t.people || []).find(x => x.id === userId);
      if (!t || !p) return;
      closeAccountSheet();
      if (!(await askConfirm(`Passar a turma ${t.name} para ${p.name}? Você vira adm e só a nova dona ou o novo dono pode excluir a turma.`, 'Passar a turma'))) return;
      try {
        await api.transfer(turmaId, userId);
        t.role = 'admin';
        cacheState();
        await pullCloud(true);
        renderTurmaEditor();
        showToast(`${firstName(p.name)} agora é dono da turma.`);
      } catch (e) { showToast(roleError(e), 'warning'); }
    }

    async function removePerson(turmaId, userId) {
      const t = turmaById(turmaId);
      const p = t && (t.people || []).find(x => x.id === userId);
      if (!t || !p) return;
      closeAccountSheet();
      if (!(await askConfirm(`Remover ${p.name} da turma ${t.name}? O nome dele continua na lista de atletas; só a conta sai da turma.`, 'Remover'))) return;
      try {
        await api.removeMember(turmaId, userId);
        t.people = (t.people || []).filter(x => x.id !== userId);
        Object.values(t.meta || {}).forEach(m => { if (m.userId === userId) m.userId = null; });
        cacheState();
        renderTurmaPeople();
        showToast(`${firstName(p.name)} saiu da turma.`);
      } catch (e) { showToast(roleError(e), 'warning'); }
    }

    /* ===================================================================
       PDF DO BABA (com fotos)
       =================================================================== */
    const MAX_PHOTOS = 12;
    let exportPhotos = [];        // [{ url, w, h }]
    let exportSource = null;      // null = today, or a past baba id

    function openExportSheet(pastId) {
      exportSource = pastId || null;
      const past = exportSource ? state.pastDays.find(d => d.id === exportSource) : null;
      const title = past ? past.title : babaTitle();
      const date = past ? fmtDate(past.date) : new Date().toLocaleDateString('pt-BR');
      document.getElementById('export-title').value = title === 'Baba' ? '' : title;
      document.getElementById('export-title').placeholder = `Baba de ${date}`;
      document.getElementById('export-sub').innerText = past ? `Baba de ${date} · ${past.players.length} atletas` : `Baba de hoje · ${state.matchHistory.length} partida${state.matchHistory.length === 1 ? '' : 's'}`;
      document.getElementById('export-row-games').classList.toggle('hidden', !!past && !(past.games && past.games.length));
      if (!past && !state.players.length) showToast('O baba de hoje ainda está vazio. O PDF sai só com as fotos e o recado.', 'warning');
      renderExportPhotos();
      document.getElementById('modal-export').classList.remove('hidden');
    }

    function closeExportSheet() {
      document.getElementById('modal-export').classList.add('hidden');
    }

    function renderExportPhotos() {
      const box = document.getElementById('export-photos');
      document.getElementById('export-count').innerText = exportPhotos.length ? `${exportPhotos.length} de ${MAX_PHOTOS}` : '';
      box.innerHTML = exportPhotos.map((p, i) => `
        <div class="relative aspect-square rounded-2xl overflow-hidden bg-sunk">
          <img src="${p.url}" alt="Foto ${i + 1}" class="w-full h-full object-cover" />
          ${i === 0 ? '<span class="absolute left-1.5 top-1.5 text-[10px] font-extrabold bg-butter text-pitch rounded-md px-1.5 py-0.5">CAPA</span>'
            : `<button onclick="makeCoverPhoto(${i})" class="absolute left-1.5 top-1.5 text-[10px] font-extrabold bg-black/55 text-white rounded-md px-1.5 py-0.5" aria-label="Usar como capa"><i class="fa-solid fa-star mr-0.5"></i>Capa?</button>`}
          <button onclick="removeExportPhoto(${i})" class="absolute right-1.5 top-1.5 w-7 h-7 rounded-full bg-black/55 text-white text-[12px] flex items-center justify-center" aria-label="Tirar foto"><i class="fa-solid fa-xmark"></i></button>
        </div>`).join('') + (exportPhotos.length < MAX_PHOTOS ? `
        <label class="aspect-square rounded-2xl border-2 border-dashed border-pitch/30 text-pitch flex flex-col items-center justify-center gap-1 cursor-pointer active:scale-95 transition">
          <i class="fa-solid fa-camera text-[20px]"></i><span class="text-[12px] font-bold">Adicionar</span>
          <input type="file" accept="image/*" multiple class="sr-only" onchange="addExportPhotos(this)" />
        </label>` : '');
    }

    async function addExportPhotos(input) {
      const files = Array.from(input.files || []).slice(0, MAX_PHOTOS - exportPhotos.length);
      input.value = '';
      if (!files.length) return;
      let failed = 0;
      for (const file of files) {
        try {
          const { img, done } = await loadImageFile(file);
          const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * k);
          c.height = Math.round(img.naturalHeight * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          done();
          exportPhotos.push({ url: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height });
        } catch (e) { failed++; }
      }
      renderExportPhotos();
      if (failed) showToast(`${failed} foto${failed === 1 ? '' : 's'} não abriu. Tente outra.`, 'warning');
    }

    function removeExportPhoto(i) { exportPhotos.splice(i, 1); renderExportPhotos(); }
    function makeCoverPhoto(i) { exportPhotos.unshift(exportPhotos.splice(i, 1)[0]); renderExportPhotos(); }

    /* jsPDF's built-in font speaks Latin-1 only: drop emoji and the like. */
    const pdfText = s => String(s == null ? '' : s).replace(/[^\u0000-ÿ]/g, '').replace(/\s+/g, ' ').trim();

    function imageToPng(src) {
      return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
          try {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth; c.height = img.naturalHeight;
            c.getContext('2d').drawImage(img, 0, 0);
            resolve({ url: c.toDataURL('image/png'), w: c.width, h: c.height });
          } catch (e) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = src;
      });
    }

    async function generateBabaPDF() {
      const lib = window.jspdf;
      if (!lib || !lib.jsPDF) { showToast('Gerador de PDF ainda carregando. Tente de novo.', 'warning'); return; }
      const sheetOpen = !document.getElementById('modal-export').classList.contains('hidden');
      const btn = sheetOpen ? document.getElementById('btn-export-pdf') : null;
      const past = sheetOpen && exportSource ? state.pastDays.find(d => d.id === exportSource) : null;
      const opt = id => !sheetOpen || document.getElementById(id).checked;
      const showHighlights = opt('export-opt-highlights');
      const showGames = opt('export-opt-games') && (!past || !!(past.games && past.games.length));
      const showPlayers = opt('export-opt-players');
      const note = sheetOpen ? pdfText(document.getElementById('export-note').value) : '';
      const when = past ? new Date(past.date) : new Date(state.startedAt || Date.now());
      const dateTxt = isNaN(when) ? '' : when.toLocaleDateString('pt-BR');
      const typed = sheetOpen ? pdfText(document.getElementById('export-title').value) : '';
      const base = pdfText(past ? past.title : babaTitle());
      const title = typed || (base && base !== 'Baba' ? base : `Baba de ${dateTxt}`);
      const players = past ? past.players : state.players.filter(p => p.present || hasStats(p));
      const matches = past ? (past.matches || 0) : state.matchHistory.length;
      const photos = sheetOpen ? exportPhotos.slice() : [];
      if (btn) setBusy(btn, true, 'Montando o PDF...');
      try {
        const mascot = await imageToPng('babinha/champion.webp');
        const doc = new lib.jsPDF({ unit: 'mm', format: 'a4', compress: true });
        const W = 210, H = 297, M = 14, CW = W - 2 * M;
        const GREEN = [0, 54, 49], BUTTER = [255, 237, 168], INK = [18, 48, 43], INK2 = [92, 108, 103], SUNK = [244, 236, 210];
        let y = 0;
        const ensure = need => { if (y + need > H - 16) { doc.addPage(); y = 18; } };
        const heading = text => {
          ensure(16);
          doc.setFillColor(...GREEN);
          doc.roundedRect(M, y - 5.5, CW, 8.5, 2, 2, 'F');
          doc.setTextColor(...BUTTER);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10);
          doc.text(text, M + 3, y);
          doc.setTextColor(...INK);
          y += 9;
        };
        const row = (cols, bold) => {
          ensure(7);
          doc.setFont('helvetica', bold ? 'bold' : 'normal');
          doc.setFontSize(9);
          doc.setTextColor(...(bold ? INK2 : INK));
          cols.forEach(c => {
            const txt = doc.splitTextToSize(pdfText(c.text), c.w || 200)[0] || '';
            doc.text(txt, c.x, y, c.align ? { align: c.align } : undefined);
          });
          doc.setDrawColor(226, 220, 200);
          doc.line(M, y + 2, W - M, y + 2);
          y += 6.5;
        };
        const small = text => {
          ensure(6);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(...INK2);
          doc.text(doc.splitTextToSize(pdfText(text), CW - 4)[0] || '', M + 2, y - 1.5);
          y += 3.5;
        };
        const fit = (p, maxW, maxH) => { const k = Math.min(maxW / p.w, maxH / p.h); return { w: p.w * k, h: p.h * k }; };

        // Cover band
        doc.setFillColor(...GREEN);
        doc.rect(0, 0, W, 46, 'F');
        try { doc.addImage(document.getElementById('app-logo'), 'PNG', M, 11, 24, 24); } catch (e) {}
        doc.setTextColor(...BUTTER);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(22);
        const titleLines = doc.splitTextToSize(title, CW - 32).slice(0, 2);
        doc.text(titleLines, M + 31, titleLines.length > 1 ? 19 : 23);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(232, 222, 176);
        doc.text(pdfText(`${dateTxt}${VENUES[past ? past.venue : state.settings.venue] ? '  ·  ' + VENUES[past ? past.venue : state.settings.venue] : ''}  ·  ${matches} partida${matches === 1 ? '' : 's'}  ·  ${players.length} atleta${players.length === 1 ? '' : 's'}`), M + 31, titleLines.length > 1 ? 34 : 31);
        y = 56;

        if (photos[0]) {
          const s = fit(photos[0], CW, 104);
          const x = M + (CW - s.w) / 2;
          doc.addImage(photos[0].url, 'JPEG', x, y, s.w, s.h);
          doc.setDrawColor(...GREEN);
          doc.setLineWidth(0.6);
          doc.rect(x, y, s.w, s.h);
          doc.setLineWidth(0.2);
          y += s.h + 9;
        }

        if (note) {
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(11);
          doc.setTextColor(...INK2);
          const lines = doc.splitTextToSize(`"${note}"`, CW - 8);
          ensure(lines.length * 5.2 + 6);
          doc.setFillColor(...SUNK);
          doc.roundedRect(M, y - 5, CW, lines.length * 5.2 + 5, 3, 3, 'F');
          doc.text(lines, M + 4, y + 0.5);
          y += lines.length * 5.2 + 8;
        }

        if (showHighlights) {
          const picks = [['ARTILHEIRO', 'goals', 'gol', 'gols'], ['GARÇOM', 'assists', 'assist.', 'assist.'], ['PAREDÃO', 'saves', 'defesa', 'defesas'], ['MAIS VITÓRIAS', 'wins', 'vitória', 'vitórias']]
            .map(([label, key, one, many]) => { const p = topOf(players, key); return p ? { label, name: p.name, value: p[key], unit: p[key] === 1 ? one : many } : null; })
            .filter(Boolean);
          if (picks.length) {
            heading('DESTAQUES');
            ensure(30);
            const gap = 4, tw = (CW - gap * (picks.length - 1)) / picks.length;
            picks.forEach((p, i) => {
              const x = M + i * (tw + gap);
              doc.setFillColor(...SUNK);
              doc.roundedRect(x, y - 3, tw, 26, 3, 3, 'F');
              doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...INK2);
              doc.text(p.label, x + 3.5, y + 2);
              doc.setFontSize(10); doc.setTextColor(...INK);
              doc.text(doc.splitTextToSize(pdfText(p.name), tw - 7)[0] || '', x + 3.5, y + 8.5);
              doc.setFontSize(17); doc.setTextColor(...GREEN);
              doc.text(String(p.value), x + 3.5, y + 18.5);
              doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...INK2);
              doc.text(pdfText(p.unit), x + 4.5 + doc.getStringUnitWidth(String(p.value)) * 17 * 0.3528, y + 18.5);
            });
            y += 31;
          }
        }

        if (showGames) {
          const gamesList = past ? past.games : [...state.matchHistory].reverse();
          if (!past) {
          heading('CLASSIFICAÇÃO DOS TIMES');
          const standings = sortedStandings();
          if (!standings.length) row([{ text: 'Sem partidas finalizadas.', x: M + 2 }]);
          else {
            row([{ text: 'Time', x: M + 2 }, { text: 'J', x: 120, align: 'center' }, { text: 'V', x: 135, align: 'center' }, { text: 'E', x: 150, align: 'center' }, { text: 'D', x: 165, align: 'center' }, { text: 'SG', x: 185, align: 'center' }], true);
            standings.forEach(s => {
              ensure(12);
              row([{ text: `Time ${s.team}`, x: M + 2 }, { text: s.matches, x: 120, align: 'center' }, { text: s.wins, x: 135, align: 'center' }, { text: s.draws, x: 150, align: 'center' }, { text: s.losses, x: 165, align: 'center' }, { text: (s.sg > 0 ? '+' : '') + s.sg, x: 185, align: 'center' }]);
              if (s.names && s.names.length) small(shortNames(s.names));
            });
          }
          y += 4;
          }
          heading('HISTÓRICO DE JOGOS');
          if (!gamesList.length) row([{ text: 'Nenhuma partida finalizada.', x: M + 2 }]);
          else gamesList.forEach(h => {
            ensure(12);
            row([{ text: h.timestamp, x: M + 2 }, { text: `Time ${h.labelA}   ${h.scoreA} x ${h.scoreB}   Time ${h.labelB}${h.pens ? `   (pên. ${h.pens.a} x ${h.pens.b})` : ''}`, x: 40 }]);
            if (h.namesA && h.namesA.length) small(`${shortNames(h.namesA)}  vs  ${shortNames(h.namesB)}`);
            gameLines(h).forEach(l => small('      ' + gameLineText(l)));
          });
          y += 4;
        }

        if (showPlayers) {
          heading('ATLETAS');
          const list = [...players].sort((a, b) => (b.goals || 0) - (a.goals || 0) || (b.assists || 0) - (a.assists || 0) || (b.matches || 0) - (a.matches || 0));
          if (!list.length) row([{ text: 'Nenhum atleta neste baba.', x: M + 2 }]);
          else {
            row([{ text: 'Atleta', x: M + 2 }, { text: 'Gols', x: 112, align: 'center' }, { text: 'Assist.', x: 128, align: 'center' }, { text: 'Defesas', x: 146, align: 'center' }, { text: 'Jogos', x: 164, align: 'center' }, { text: 'Vitórias', x: 184, align: 'center' }], true);
            list.forEach(p => row([
              { text: p.name + (p.isGoalkeeper ? '  (GOL)' : ''), x: M + 2, w: 88 },
              { text: p.goals || 0, x: 112, align: 'center' }, { text: p.assists || 0, x: 128, align: 'center' },
              { text: p.saves || 0, x: 146, align: 'center' }, { text: p.matches || 0, x: 164, align: 'center' },
              { text: p.wins || 0, x: 184, align: 'center' }
            ]));
          }
          y += 4;
        }

        const gallery = photos.slice(1);
        if (gallery.length) {
          doc.addPage();
          y = 20;
          heading('GALERIA');
          const gap = 6, cw = (CW - gap) / 2, ch = 78;
          gallery.forEach((p, i) => {
            const col = i % 2;
            if (col === 0) { if (i > 0) y += ch + gap; if (y + ch > H - 16) { doc.addPage(); y = 18; } }
            const s = fit(p, cw, ch);
            const x = M + col * (cw + gap) + (cw - s.w) / 2;
            doc.addImage(p.url, 'JPEG', x, y + (ch - s.h) / 2, s.w, s.h);
          });
          y += ch + 8;
        }

        // Sign-off with the mascot
        if (mascot) {
          ensure(36);
          const mh = 30, mw = mascot.w * mh / mascot.h;
          doc.addImage(mascot.url, 'PNG', M, y, mw, mh);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...GREEN);
          doc.text('Até o próximo baba!', M + mw + 5, y + 14);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...INK2);
          doc.text('Feito com o BABA, o app da sua pelada.', M + mw + 5, y + 20);
        }

        const pages = doc.getNumberOfPages();
        for (let i = 1; i <= pages; i++) {
          doc.setPage(i);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(150, 150, 140);
          doc.text(pdfText(`BABA  ·  ${title}`), M, H - 8);
          doc.text(`${i}/${pages}`, W - M, H - 8, { align: 'right' });
        }
        const slug = title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'Baba';
        const stamp = isNaN(when) ? todayStamp() : localDate(when.getTime());
        await offerFile(`BABA_${slug}_${stamp}.pdf`, doc.output('blob'), 'PDF salvo!');
        if (sheetOpen) closeExportSheet();
      } catch (e) {
        console.warn('BABA pdf', e);
        showToast('Não consegui gerar o PDF. Tente com menos fotos.', 'warning');
      } finally {
        if (btn) setBusy(btn, false);
      }
    }

    /* ===================================================================
       V7 · SERVIDOR (termos, pontos, lojinha, ao vivo, palpites, chat)
       Everything new is optional: on a server without these functions
       (v7 === false) the app simply hides the new features.
       =================================================================== */
    const TERMS_VERSION = '1.0';
    const CONTACT_EMAIL = 'contatobabaapp@gmail.com';
    let v7 = null;            // server has the v7 functions (null = not checked yet)
    let account = null;       // { termsVersion, termsAt, hasBirth, adult }
    let wallet = null;        // { balance, daily, items: Set }
    const peopleCache = new Map();

    const isMissingFn = e => !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function|does not exist/i.test(String(e.message || '')));

    async function rpc(name, args) {
      const { data, error } = await sb.rpc(name, args || {});
      if (error) throw error;
      return data;
    }

    const API7 = {
      myAccount: async () => ((await rpc('my_account')) || [])[0] || null,
      acceptTerms: (version, birth) => rpc('accept_terms', { version, birth }),
      myWallet: async () => ((await rpc('my_wallet')) || [])[0] || null,
      claimDaily: () => rpc('claim_daily'),
      shopItems: () => q(sb.from('shop_items').select('*').order('sort')),
      myMissions: async () => (await rpc('my_missions')) || [],
      claimMission: id => rpc('claim_mission', { mission: id }),
      ledger: () => q(sb.from('points_ledger').select('delta, reason, ref, created_at').order('id', { ascending: false }).limit(25)),
      buyItem: item => rpc('buy_item', { item }),
      equipItem: (slot, item) => rpc('equip_item', { slot, item }),
      async createLive(row) { const { data, error } = await sb.from('live_games').insert(row).select('id, code'); if (error) throw error; return (data || [])[0]; },
      updateLive: (id, patch) => q(sb.from('live_games').update(patch).eq('id', id)),
      liveList: () => q(sb.from('live_games').select('id, code, title, owner, updated_at').eq('active', true).order('updated_at', { ascending: false }).limit(10)),
      getLive: async code => ((await rpc('get_live', { live_code: code })) || [])[0] || null,
      placePalpite: async (live, market, stake) => ((await rpc('place_palpite', { live, market, stake })) || [])[0],
      myPalpites: liveId => q(sb.from('palpites').select('id, match_no, market, label, odd, stake, status, payout').eq('live_id', liveId).order('id', { ascending: false }).limit(30)),
      settlePalpites: (live, matchNo, result) => rpc('settle_palpites', { live, match_no: matchNo, result }),
      liveRanking: live => rpc('live_ranking', { live }),
      challengeCandidates: live => rpc('challenge_candidates', { live }),
      createChallenge: (live, opponent, kind, pickC, pickO, labelC, labelO, stake) => rpc('create_challenge', { live, opponent, kind, pick_c: pickC, pick_o: pickO, label_c: labelC, label_o: labelO, stake }),
      respondChallenge: (id, accept) => rpc('respond_challenge', { challenge: id, accept }),
      cancelChallenge: id => rpc('cancel_challenge', { challenge: id }),
      myChallenges: live => rpc('my_challenges', { live }),
      throwPipoca: target => rpc('throw_pipoca', { target }),
      events: async ids => {
        const run = cols => q(sb.from('turma_events').select(`id, turma_id, created_by, starts_at, place, note, max_players, status, created_at, closed_at, event_rsvps(${cols})`)
          .in('turma_id', ids).gte('starts_at', new Date(Date.now() - 3 * 864e5).toISOString()).order('starts_at', { ascending: true }).limit(60));
        const base = 'player_key, name, turma_player_id, user_id, status, source, outcome, created_at';
        // "invited_by" (convidado de quem) exists once v11.2 ran on the server.
        try { return await run(base + ', invited_by'); } catch (e) { if (isNetworkError(e)) throw e; return run(base); }
      },
      createEvent: (t, starts, place, note, max) => rpc('create_event', { t, starts, place, note, max_players: max }),
      updateEvent: (event, starts, place, note, max, status) => rpc('update_event', { event, starts, place, note, max_players: max, new_status: status }),
      rsvpEvent: (event, answer, player, name, inviter) => rpc('rsvp_event', Object.assign({ event, answer, player, player_name: name }, inviter ? { invited_by: inviter } : {})),
      relinkMyStats: () => rpc('relink_my_stats'),
      setPrivacy: (t, pub) => rpc('set_turma_privacy', { t, pub }),
      turmaRanking: (t, period, metric, lim) => rpc('turma_ranking', { t, period, metric, lim }),
      turmaTrophies: t => rpc('turma_trophies', { t }),
      turmaPrestige: t => rpc('turma_prestige', { t }),
      exploreTurmas: (q, lim) => rpc('explore_turmas', { q: q || null, lim }),
      createMatch: (home, kind, away, starts, place, note) => rpc('create_match', { home, kind, away, starts, place: place || null, note: note || null }),
      respondMatch: (m, accept, as_turma) => rpc('respond_match', { m, accept, as_turma }),
      cancelMatch: m => rpc('cancel_match', { m }),
      scheduleMatch: (m, starts, place) => rpc('schedule_match', { m, starts, place: place || null }),
      reportResult: (m, hg, ag) => rpc('report_result', { m, hg, ag }),
      confirmResult: (m, ok) => rpc('confirm_result', { m, ok }),
      turmaMatches: t => rpc('turma_matches', { t }),
      openMatches: () => rpc('open_matches'),
      createChampionship: (t, name, max_teams) => rpc('create_championship', { t, name, max_teams }),
      joinChampionship: (c, t) => rpc('join_championship', { c, t }),
      leaveChampionship: (c, t) => rpc('leave_championship', { c, t }),
      startChampionship: c => rpc('start_championship', { c }),
      cancelChampionship: c => rpc('cancel_championship', { c }),
      listChampionships: () => rpc('list_championships'),
      championshipDetail: c => rpc('championship_detail', { c }),
      importRsvps: (event, rows) => rpc('import_rsvps', { event, rows }),
      closeEvent: (event, outcomes) => rpc('close_event', { event, outcomes }),
      discipline: t => rpc('turma_discipline', { t }),
      turmaRules: async t => ((await q(sb.from('turma_rules').select('mode, aviso, prioridade, bloqueio, banimento, janela_dias').eq('turma_id', t).limit(1))) || [])[0] || null,
      setRules: (t, mode, aviso, prioridade, bloqueio, banimento, janela) => rpc('set_turma_rules', { t, mode, aviso, prioridade, bloqueio, banimento, janela_dias: janela }),
      addSanction: (t, key, name, kind, reason, days) => rpc('add_sanction', { t, key, player_name: name, kind, reason, days }),
      clearSanction: id => rpc('clear_sanction', { sanction: id }),
      banPlayer: (t, key, reason) => rpc('ban_player', { t, key, reason }),
      unbanPlayer: (t, key) => rpc('unban_player', { t, key }),
      setNickname: nick => rpc('set_nickname', { nick }),
      savePush: (ep, p256dh, auth, liveCode, turma) => rpc('save_push', { ep, p256dh_key: p256dh, auth_key: auth, live_code: liveCode, turma }),
      dropPush: (ep, liveCode, turma) => rpc('drop_push', { ep, live_code: liveCode, turma }),
      pushStatus: async (ep, liveCode) => ((await rpc('push_status', { ep, live_code: liveCode })) || [])[0] || null,
      chatList: (room, afterId) => q(sb.from('chat_messages').select('id, user_id, body, deleted, created_at').eq('room', room).gt('id', afterId || 0).order('id', { ascending: false }).limit(60)),
      chatSend: (room, body) => q(sb.from('chat_messages').insert({ room, body })),
      chatDelete: id => rpc('delete_message', { msg: id }),
      chatReport: (id, why) => rpc('report_message', { msg: id, why }),
      liveChat: (code, after) => rpc('live_chat', { live_code: code, after_id: after || 0 }),
      peopleCards: ids => rpc('people_cards', { ids }),
      myStatus: async () => ((await rpc('my_status')) || [])[0] || null,
      pingActivity: () => rpc('ping_activity'),
      subscribe(room, onRow) {
        try {
          const ch = sb.channel('room:' + room)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `room=eq.${room}` }, p => onRow(p.new))
            .subscribe();
          return () => { try { sb.removeChannel(ch); } catch (e) {} };
        } catch (e) { return () => {}; }
      }
    };
    // Tests can stand in for any of these with window.__BABA_FAKE_API__.
    Object.keys(API7).forEach(k => { if (!(window.__BABA_FAKE_API__ || {})[k]) api[k] = API7[k]; });

    async function refreshAccount() {
      if (!cloudOn()) return;
      try {
        const a = await api.myAccount();
        v7 = true;
        if (a) {
          account = { termsVersion: a.terms_version || null, termsAt: a.terms_accepted_at || null, hasBirth: !!a.has_birth, adult: !!a.adult };
          currentUser.cosmetics = a.cosmetics || {};
          if (a.terms_version) lsSet('baba_terms_v1:' + currentUser.id, a.terms_version);
          cacheProfile();
        }
      } catch (e) {
        if (isMissingFn(e)) v7 = false;
      }
      renderV7Bits();
      if (v7 === true) refreshStatus();
    }

    /* v8: support account, suspension and the notice from the support panel. */
    let status8 = null;
    async function refreshStatus() {
      if (!cloudOn() || !currentUser) return;
      const uid = currentUser.id;
      try {
        const s = await api.myStatus();
        if (!currentUser || currentUser.id !== uid) return;
        status8 = s ? { staff: !!s.staff, bannedUntil: s.banned_until || null, bannedReason: s.banned_reason || '', notice: s.notice || '', noticeLevel: s.notice_level || 'info' } : null;
        const today = localDate();
        if (lsGet('baba_ping_v1:' + uid) !== today) { await api.pingActivity(); lsSet('baba_ping_v1:' + uid, today); }
      } catch (e) {
        if (isMissingFn(e)) status8 = null;
      }
      const box = document.getElementById('profile-staff');
      if (box) box.classList.toggle('hidden', !(status8 && status8.staff));
      renderHomeV7();
      maybePopups();
    }
    /* ===================================================================
       POP-UPS: aviso do suporte e novidades da versão
       Shown one at a time, after the terms and the tour are out of the way.
       =================================================================== */
    const APP_VERSION = '11.3.1';
    const NOTES_KEY = 'baba_notes_seen_v1';
    const PATCH_NOTES = [
      { v: '11.3.1', date: '17/10/2026', title: 'Perfil na barra, local e lances', items: [
        'O botão do seu perfil agora fica dentro da barra de baixo, junto de Início, Turmas e Lojinha.',
        'Estatísticas detalhadas (Configurações → Seu baba): marque se o baba é no Campo, Society ou Futsal e veja jogos, gols, assistências e defesas por local, no Stats e no Perfil.',
        'O relatório do baba agora mostra cada jogo com quem fez gol, quem deu o passe, as defesas e o minuto de cada lance. Vale na tela, no PDF e na planilha.'
      ] },
      { v: '11.3', date: '17/10/2026', title: 'App reorganizado', items: [
        'Três abas embaixo: Início, Turmas e Lojinha do Babinha. Lista, Times, Placar e Stats agora ficam dentro de Turmas.',
        'Seu perfil virou o botão redondo no canto de baixo: posição, pé dominante, turma principal, estatísticas e o card pra compartilhar.',
        'A engrenagem no topo abre as Configurações: aparência, quadra, segurança, seu baba, instalação e ajuda.',
        'No Início, o Babinha reage ao que está rolando e mostra a bateria do aparelho.'
      ] },
      { v: '11.2', date: '16/10/2026', title: 'Turmas: ranking, troféus e desafios', items: [
        'Cada turma tem Ranking Top 10 e Top 26 por gols, assistências, participações, vitórias, jogos e defesas, da última partida ou da temporada de 6 meses.',
        'Prateleira de troféus: no fim de cada temporada saem artilheiro, garçom, craque, mais vitórias e paredão. Campeonatos ganhos viram troféu da turma.',
        'Prestígio: cada turma tem uma pontuação e um nível (Bronze, Prata, Ouro, Diamante), calculados pelo servidor.',
        'Turma pública ou privada: o adm escolhe. Turma pública aparece em Explorar e mostra ranking e troféus a qualquer pessoa. Entrar continua só pelo convite.',
        'Desafios entre turmas: amistoso fechado (contra uma turma que você escolhe) e amistoso aberto (fica no mural até alguém aceitar). Um lado lança o placar e o outro confirma.',
        'Campeonatos: o adm cria, as turmas públicas se inscrevem e o app monta todos contra todos, com classificação e troféu pro campeão.'
      ] },
      { v: '11.1', date: '16/10/2026', title: 'Ajustes da lista e dos convidados', items: [
        'Ao marcar o baba, a hora agora é digitada no teclado numérico (19:30), sem roda de seleção.',
        '"Avulso" virou "Convidado" em todo o app.',
        'Na lista colada, quem não está na turma pode virar convidado, ser adicionado à turma ou ser ignorado.',
        'Convidado agora diz de quem veio: ao pôr um nome na lista e ao colar a lista, você escolhe quem convidou.',
        'Corrigido: ao ligar seu nome à conta, os números antigos dessa turma que ficaram soltos passam a aparecer em "Meus números".'
      ] },
      { v: '11', date: '16/10/2026', title: 'Compromisso: a lista do baba', items: [
        'O adm puxa a lista do próximo baba (dia, hora, local e vagas): a turma recebe aviso no celular, um card no chat e um pop-up ao abrir o app.',
        'Responda Vou, Talvez ou Não vou no Início, no chat ou na lista. Com vagas, quem passar do limite vai pra lista de espera.',
        'Salve o baba na agenda do celular ou no Google Agenda com um toque.',
        'O adm cola a lista do grupo do WhatsApp e o BABA reconhece os nomes da turma, mesmo escritos diferente.',
        'Na Lista de chegada aparece quem marcou que vem; no fim, o adm fecha a presença: cumpriu, miou ou justificou.',
        'Regras de presença por turma: aviso, baixa prioridade e bloqueio automáticos por faltas (ou só manuais), e banir só com decisão do adm.'
      ] },
      { v: '10.2', date: '11/10/2026', title: 'Histórico pra turma toda', items: [
        'Babas anteriores agora têm lugar próprio: Perfil → Babas anteriores, dentro da turma e no Stats → Todos os babas.',
        'Dono, adm ou membro: todo mundo da turma abre cada baba encerrado e vê os destaques e os números de cada atleta.',
        'As notas de atualização guardam o histórico inteiro: role pra baixo pra ver tudo o que já mudou.'
      ] },
      { v: '10.1', date: '11/10/2026', title: 'Card de atleta e lojinha nova', items: [
        'Seu card de atleta, estilo figurinha: aparece no Perfil e quando alguém toca em você na turma ou no chat.',
        'Lojinha nova: títulos, codinome, mascote Babinha, fundo do card, cartão de anúncio de gol e som de gol.',
        'Marcou com o nome ligado à conta? O celular do baba anuncia seu gol com o seu cartão e o seu som, e quem assiste ao vivo vê também.',
        'Pipoca 🍿: por 150 pontos, ela fica 24 h no card de um amigo da turma.',
        'Avisos no celular: toque em Avisar gols no jogo ao vivo, ou ligue no Perfil os avisos dos babas das suas turmas (início, gols, defesas e resultado).'
      ] },
      { v: '10', date: '11/10/2026', title: 'Pênaltis, desafios e jogos de 1 a 12', items: [
        'Jogo de 1v1 até 12v12, e o goleiro do jeito da sua turma: do time, fixo, da fila ou sem goleiro.',
        'Empate pode ir pros pênaltis (Regras → Empate). Gols e defesas nas cobranças contam no Stats, com categoria própria.',
        'Times: troque dois atletas entre os times ou monte os times na mão, do zero.',
        'Desafio 1v1 no jogo ao vivo: aposte pontos direto contra alguém em quem vence ou quem faz mais gols.',
        'Os multiplicadores foram recalibrados e agora mostram a chance de cada palpite.',
        'Emotes do Babinha e emojis no chat.',
        'O Início mostra a hora e, se você deixar, o clima de onde você está.',
        'Corrigido: quem assumiu o próprio nome agora vê os números do baba que está rolando no celular do organizador.'
      ] },
      { v: '9.5.1', date: '11/10/2026', title: 'Tutorial novinho', items: [
        'O tutorial foi refeito do zero: 6 capítulos curtos com o Babinha, cobrindo o BABA inteiro.',
        'As regras mais difíceis (rodízio, régua de tempo, goleiro da fila, ordem por jogos) agora têm animação mostrando como funcionam.',
        'Os capítulos ficam em Perfil → Suporte → Tutorial, com ✓ nos que você já viu, e o Início lembra do próximo.',
        '10 poses novas do Babinha espalhadas pelo app.'
      ] },
      { v: '9.5', date: '11/10/2026', title: 'A fila do seu jeito', items: [
        'Dá pra tirar alguém da fila de espera (o "foi embora") direto na aba Times.',
        'Nova opção de ordem da fila: quem jogou menos joga antes.',
        'Régua de tempo: quem chega muito depois do primeiro jogo (30 min, 1 h ou 1h30, você escolhe) entra em 1º na fila.',
        'Goleiro da fila, como na planilha: nos formatos 4, 7 e 11, os dois próximos da fila vão pro gol sem perder o lugar.',
        'Toque no nome de quem está no time ou na fila pra editar a ficha: nome, posição, gols, passes e defesas do dia.',
        'Jogadoras no BABA: marque "Jogadora" na ficha e os títulos viram artilheira, garçonete e paredona.',
        'Avisos da equipe BABA agora aparecem assim, em pop-up.'
      ] },
      { v: '9', date: '10/10/2026', title: 'Missões e exclusivos', items: [
        'Assistir um jogo ao vivo digitando o código, na entrada do app ou no Início.',
        'Formatos Futsal 4, Society 7 e Campo 11 com goleiro à parte.',
        'Missões da semana na lojinha, valendo baba points.',
        'Itens exclusivos: Aura de Fogo Azul para os 100 primeiros do BABA.'
      ] },
      { v: '8', date: '09/10/2026', title: 'Equipe de suporte', items: [
        'Avisos da equipe BABA na tela inicial.',
        'Suporte pode ajudar com senha, código de recuperação e problemas na conta.',
        'Contas suspensas veem o motivo e até quando.'
      ] },
      { v: '7', date: '09/10/2026', title: 'Ao vivo, palpites e lojinha', items: [
        'Transmita o baba ao vivo com QR code: quem tem o link acompanha o placar, mesmo sem conta.',
        'Palpites de brincadeira com baba points, só para maiores de 18.',
        'Lojinha do Babinha com molduras, nomes coloridos e brilhos, e o bônus do dia.',
        'Chat da turma e do jogo ao vivo, com denúncia de mensagens.',
        'Termos de uso e privacidade, com aceite na primeira entrada.'
      ] },
      { v: '6', date: '09/10/2026', title: 'O Babinha chegou', items: [
        'Babinha, o mascote, no tutorial e no Suporte com as dúvidas mais comuns.',
        'Perfil completo: foto, modo escuro, texto maior, digital e código de recuperação.',
        'Dono e adms da turma, com convite por link.',
        'PDF do baba com fotos da pelada.'
      ] },
      { v: '5', date: '09/10/2026', title: 'BABA na nuvem', items: [
        'O BABA virou app de celular (dá pra instalar na tela de início) e funciona sem internet na quadra.',
        'Conta com login: turmas, elenco e histórico ficam salvos na nuvem e são compartilhados com a turma.',
        'Lista de chegada, fila do Rei da Quadra, placar com relógio e estatísticas do dia e de todos os babas.'
      ] }
    ];
    let popupsArmed = false;
    let popupOpen = false;
    let popupOnClose = null;
    function showPopup(o) {
      popupOpen = true;
      popupOnClose = o.onClose || null;
      document.getElementById('popup-img').src = `babinha/${o.img || 'wave'}.webp`;
      document.getElementById('popup-eyebrow').innerText = o.eyebrow || '';
      document.getElementById('popup-title').innerText = o.title || '';
      document.getElementById('popup-body').innerHTML = o.html || '';
      document.getElementById('popup-body').scrollTop = 0;
      document.getElementById('popup-ok').innerText = o.ok || 'Beleza';
      document.getElementById('modal-popup').classList.remove('hidden');
    }
    function closePopup() {
      document.getElementById('modal-popup').classList.add('hidden');
      popupOpen = false;
      const cb = popupOnClose;
      popupOnClose = null;
      if (cb) cb();
      setTimeout(maybePopups, 250);
    }
    const notesHtml = (list, head = list.length > 1) => list.map(n => `
      <div class="pb-3 mb-3 border-b border-ink/[0.07] last:border-0 last:mb-0 last:pb-0">
        ${head ? `<p class="text-[13px] font-extrabold">v${n.v} · ${escapeHtml(n.title)} <span class="font-semibold text-ink-3">${n.date}</span></p>` : ''}
        <ul class="mt-1.5 space-y-1.5">${n.items.map(i => `<li class="flex gap-2 text-[14px] leading-snug"><i class="fa-solid fa-futbol text-pitch text-[11px] mt-1 flex-shrink-0"></i><span>${escapeHtml(i)}</span></li>`).join('')}</ul>
      </div>`).join('');
    function maybePopups() {
      if (!popupsArmed || popupOpen || !currentUser) return;
      if (!document.getElementById('tour').classList.contains('hidden')) return;
      const st = status8 || {};
      if (st.notice && lsGet('baba_notice_seen_v1') !== st.notice) {
        return showPopup({
          img: st.noticeLevel === 'warning' ? 'worried' : 'wave',
          eyebrow: 'Aviso da equipe BABA', title: st.noticeLevel === 'warning' ? 'Atenção, galera' : 'Recado do Babinha',
          html: `<p class="text-[15px] leading-relaxed">${escapeHtml(st.notice)}</p>`, ok: 'Entendi',
          onClose: () => { lsSet('baba_notice_seen_v1', st.notice); renderHomeV7(); }
        });
      }
      const seen = lsGet(NOTES_KEY);
      if (seen !== APP_VERSION) {
        lsSet(NOTES_KEY, APP_VERSION);
        // Everything since the last version this phone saw (just the newest on a first look).
        const vnum = v => String(v || '0').split('.').map(Number).concat([0, 0, 0]).slice(0, 3);
        const newer = (a, b) => { const x = vnum(a), y = vnum(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
        const since = PATCH_NOTES.filter(n => seen && newer(n.v, seen));
        const list = since.length ? since : PATCH_NOTES.slice(0, 1);
        // The new ones on top; everything older stays below, just scroll.
        const older = PATCH_NOTES.filter(n => !list.includes(n));
        const html = notesHtml(list) + (older.length ? `
          <div class="flex items-center gap-2 my-3"><span class="h-px flex-1 bg-ink/10"></span><span class="text-[11px] font-bold uppercase tracking-wider text-ink-3">Atualizações anteriores</span><span class="h-px flex-1 bg-ink/10"></span></div>
          ${notesHtml(older, true)}` : '');
        return showPopup({ img: 'dancinha', eyebrow: `Novidades · v${APP_VERSION}`, title: PATCH_NOTES[0].title, html, ok: 'Bora pro baba' });
      }
      const list = pendingListPopup();
      if (list) return showPopup(list);
    }
    function openPatchNotes() {
      showPopup({ img: 'champion', eyebrow: 'Notas de atualização', title: 'O que mudou no BABA', html: notesHtml(PATCH_NOTES), ok: 'Fechar' });
    }

    function dismissNotice() {
      if (status8 && status8.notice) lsSet('baba_notice_seen_v1', status8.notice);
      renderHomeV7();
    }

    async function refreshWallet() {
      if (!cloudOn() || v7 !== true) return null;
      try {
        const w = await api.myWallet();
        if (w) wallet = { balance: w.balance || 0, daily: !!w.daily_available, items: new Set(w.items || []) };
      } catch (e) {}
      renderV7Bits();
      return wallet;
    }

    /* Bits of the v7 UI that depend on the server and the account. */
    function renderV7Bits() {
      const on = v7 === true && cloudOn();
      document.querySelectorAll('[data-v7]').forEach(el => el.classList.toggle('hidden', !on));
      const bal = document.getElementById('profile-points');
      if (bal) bal.innerText = wallet ? `${fmtPts(wallet.balance)} pts` : '';
      renderProfileBits();
      renderLivePill();
    }

    // The support account has endless points (999.999.999 on the server).
    const fmtPts = n => Number(n || 0) >= 999999999 ? '∞' : Number(n || 0).toLocaleString('pt-BR');

    /* ===================================================================
       TERMOS E ACEITE
       =================================================================== */
    let termsNext = null;

    function termsAcceptedHere() {
      if (!currentUser) return false;
      if (account) return account.termsVersion === TERMS_VERSION;
      return lsGet('baba_terms_v1:' + currentUser.id) === TERMS_VERSION;
    }

    /* Runs `next` once the account has accepted this version of the terms. */
    function ensureTerms(next) {
      if (v7 !== true || termsAcceptedHere()) { next(); return; }
      termsNext = next;
      document.getElementById('terms-birth-wrap').classList.toggle('hidden', !!(account && account.hasBirth));
      document.getElementById('terms-ack').checked = false;
      document.getElementById('terms-error').classList.add('hidden');
      document.getElementById('page-terms-gate').classList.remove('hidden');
      document.getElementById('page-terms-gate').scrollTop = 0;
    }

    async function submitTerms() {
      const btn = document.getElementById('btn-terms');
      const needBirth = !(account && account.hasBirth);
      const birth = document.getElementById('terms-birth').value;
      if (needBirth) {
        if (!birth) return showErr('terms-error', 'Informe sua data de nascimento.');
        const age = ageFrom(birth);
        if (age === null || age > 110) return showErr('terms-error', 'Confira a data de nascimento.');
        if (age < 16) return showErr('terms-error', 'O BABA é para quem tem 16 anos ou mais. Seu nome ainda pode estar na turma: o organizador cadastra.');
      }
      if (!document.getElementById('terms-ack').checked) return showErr('terms-error', 'Marque que leu e aceita os termos.');
      setBusy(btn, true, 'Salvando...');
      try {
        await api.acceptTerms(TERMS_VERSION, needBirth ? birth : null);
        await refreshAccount();
        lsSet('baba_terms_v1:' + currentUser.id, TERMS_VERSION);
        document.getElementById('page-terms-gate').classList.add('hidden');
        const fn = termsNext; termsNext = null;
        showToast('Tudo certo. Bom baba!');
        if (fn) fn();
      } catch (e) {
        const m = String((e && e.message) || '');
        showErr('terms-error', isNetworkError(e) ? OFFLINE_MSG : m.includes('too_young') ? 'O BABA é para quem tem 16 anos ou mais.' : m.includes('bad_birth') ? 'Confira a data de nascimento.' : 'Não consegui salvar agora. Tente de novo.');
      } finally {
        setBusy(btn, false);
      }
    }

    function ageFrom(iso) {
      const d = new Date(iso + 'T12:00:00');
      if (isNaN(d)) return null;
      const now = new Date();
      let age = now.getFullYear() - d.getFullYear();
      if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
      return age;
    }

    async function termsLogout() {
      document.getElementById('page-terms-gate').classList.add('hidden');
      termsNext = null;
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
      await api.signOut();
      currentUser = null;
      account = null; wallet = null; v7 = null; status8 = null; missionsCache = null;
      state = defaultState();
      showAuth('login');
    }

    const LEGAL = {
      termos: `
        <h3>Termos de Uso · versão ${TERMS_VERSION}</h3>
        <p>Ao criar sua conta ou continuar usando o BABA, você concorda com estes Termos, com a Política de Privacidade e com o Código de Conduta.</p>
        <h3>1. O que é o BABA</h3>
        <p>Um app gratuito para organizar peladas: lista de chegada, times, placar, estatísticas, turmas, chat, palpites de brincadeira e lojinha de itens visuais. Responsável: Contato BABA, e-mail ${CONTACT_EMAIL}.</p>
        <h3>2. Quem pode usar</h3>
        <p>Você precisa ter pelo menos 16 anos para criar uma conta. Os Palpites são só para quem tem 18 anos ou mais. Quem tem menos de 16 pode aparecer na lista de uma turma só pelo nome, cadastrado pelo organizador, sem conta própria.</p>
        <h3>3. Sua conta</h3>
        <p>Use dados verdadeiros e guarde sua senha e seu código de recuperação. Você responde pelo que é feito na sua conta e pode excluí-la a qualquer momento em Configurações → Excluir minha conta.</p>
        <h3>4. Turmas</h3>
        <p>Quem cria a turma é o dono: escolhe os adms, pode passar a turma para outra pessoa e é o único que pode excluí-la. Dono e adms cuidam do elenco, dos convites e da moderação do chat. Quem entra pelo convite vê o elenco, o histórico e as estatísticas da turma.</p>
        <h3>5. Baba points e Palpites</h3>
        <ul>
          <li>Baba points são pontos de brincadeira, sem valor em dinheiro. Não podem ser comprados, vendidos, sacados, transferidos ou trocados por dinheiro, bens ou serviços.</li>
          <li>Palpites são um passatempo: você usa pontos para palpitar no resultado de uma partida e, se acertar, recebe pontos conforme o multiplicador mostrado na hora. Não existe prêmio, caixa ou pagamento de nenhum tipo.</li>
          <li>Os multiplicadores são calculados automaticamente a partir das estatísticas e podem mudar durante o jogo. Vale o multiplicador mostrado quando você confirmou o palpite.</li>
          <li>O resultado vale como registrado pelo organizador no placar. Partida cancelada ou desfeita devolve os pontos.</li>
          <li>Pontos e itens podem ser ajustados ou zerados para corrigir erros, abusos ou mudanças no jogo, e somem quando a conta é excluída.</li>
          <li>O BABA não é e não divulga casa de apostas. Se você sente que perdeu o controle com apostas de verdade, procure ajuda no CAPS da sua cidade ou nos Jogadores Anônimos.</li>
        </ul>
        <h3>6. Lojinha</h3>
        <p>Os itens (molduras, cores de nome, brilhos) são só visuais, têm preço fixo em baba points mostrado antes da troca e não têm sorteio. A troca não tem devolução, salvo erro do app.</p>
        <h3>7. Conteúdo que você publica</h3>
        <p>Fotos, nomes, mensagens e dados de jogo que você coloca são seus, e você garante que tem direito de usá-los. Você autoriza o BABA a guardá-los e mostrá-los às pessoas da turma ou do jogo ao vivo, só para o app funcionar.</p>
        <h3>8. Jogo ao vivo e QR code</h3>
        <p>Quando o organizador transmite uma partida, quem tem o QR code ou o link vê o placar, os nomes dos jogadores em quadra e o chat do jogo, mesmo sem conta. Organizador: avise a galera antes de transmitir.</p>
        <h3>9. Moderação</h3>
        <p>Conteúdo que viole o Código de Conduta pode ser removido, e a conta pode ser suspensa ou excluída, com aviso e chance de explicação, salvo casos graves. Denuncie pelo botão Denunciar ou pelo ${CONTACT_EMAIL}.</p>
        <h3>10. Disponibilidade</h3>
        <p>O BABA é oferecido como está e pode ficar fora do ar, mudar ou ser encerrado. Avisaremos no app com antecedência sempre que possível, e você pode baixar seus dados (PDF, planilha e backup) antes.</p>
        <h3>11. Mudanças nos Termos</h3>
        <p>Quando estes Termos mudarem, o app mostra a nova versão e pede seu aceite antes de continuar.</p>
        <h3>12. Lei e foro</h3>
        <p>Valem as leis do Brasil. Fica eleito o foro do seu domicílio.</p>`,
      privacidade: `
        <h3>Política de Privacidade</h3>
        <p>O BABA coleta só o necessário para a pelada funcionar, guarda os dados no Brasil e não vende nem usa nada para anúncio.</p>
        <p><b>Quem cuida dos dados.</b> Contato BABA, controlador dos dados. Pedidos sobre seus dados: ${CONTACT_EMAIL}. Como agente de pequeno porte, o BABA não nomeia encarregado (Resolução CD/ANPD 2/2022, art. 11) e atende por esse canal.</p>
        <table>
          <tr><th>Dado</th><th>Para quê</th></tr>
          <tr><td>Nome, e-mail, senha (cifrada)</td><td>Criar e proteger sua conta</td></tr>
          <tr><td>Data de nascimento</td><td>Conferir a idade mínima e liberar os Palpites. Ninguém vê.</td></tr>
          <tr><td>Foto ou ícone do perfil e da turma</td><td>Mostrar quem é quem</td></tr>
          <tr><td>Nomes dos atletas, chegadas, gols, assistências, defesas, vitórias</td><td>Times, placar e estatísticas da turma</td></tr>
          <tr><td>Mensagens do chat e denúncias</td><td>Conversa da turma e do jogo; moderação</td></tr>
          <tr><td>Baba points, palpites e itens</td><td>Funcionar o passatempo</td></tr>
          <tr><td>Preferências e aceite destes termos</td><td>Lembrar suas escolhas e provar o aceite</td></tr>
        </table>
        <p><b>Bases legais (LGPD, art. 7º):</b> execução do contrato, cumprimento de obrigação legal e legítimo interesse da turma.</p>
        <p><b>O que fica só no seu celular.</b> As fotos que você escolhe para o PDF do baba não são enviadas a lugar nenhum. O app guarda uma cópia do baba de hoje no aparelho para funcionar sem internet.</p>
        <p><b>Com quem compartilhamos.</b> Com a Supabase, que hospeda o banco e as contas em servidores de São Paulo, e com o GitHub Pages, que entrega o site. Com mais ninguém, salvo ordem judicial ou da autoridade competente.</p>
        <p><b>Quem vê o quê.</b> O pessoal das suas turmas vê seu nome, foto, cargo, itens da lojinha, estatísticas e mensagens na turma. Quem assiste a um jogo ao vivo vê o placar, os nomes em quadra e o chat do jogo.</p>
        <p><b>Por quanto tempo.</b> Enquanto a conta existir. Ao excluir a conta, apagamos perfil, foto, pontos, palpites e itens; suas mensagens ficam como "conta excluída", e o histórico de jogos da turma continua para o grupo, sem vínculo com você.</p>
        <p><b>Seus direitos (LGPD, art. 18).</b> Confirmar e acessar seus dados, corrigir, pedir anonimização ou exclusão, portabilidade e saber com quem compartilhamos. Quase tudo dá para fazer no app; o resto, pelo ${CONTACT_EMAIL}, com resposta em até 15 dias.</p>
        <p><b>Segurança.</b> Conexão cifrada, regras de acesso por turma no banco, senha nunca guardada em texto, código de recuperação com tentativas limitadas e trava por digital opcional.</p>
        <p><b>Menores.</b> Contas só a partir de 16 anos; Palpites só a partir de 18. Não usamos dados de ninguém para perfil comercial ou publicidade.</p>`,
      conduta: `
        <h3>Código de Conduta</h3>
        <p>Pelada boa é a que todo mundo quer voltar: na quadra e no app, respeito vem antes do placar.</p>
        <p><b>Pode e deve:</b> zoar com respeito, comemorar, cobrar o rachão da cerveja, denunciar o que passar do ponto.</p>
        <p><b>Não pode, em nenhum lugar do app (chat, nomes, fotos, turmas):</b></p>
        <ul>
          <li>Racismo, homofobia, transfobia, machismo, xenofobia, intolerância religiosa ou qualquer discriminação (crime pela Lei 7.716/1989).</li>
          <li>Ameaça, assédio, perseguição, incitação à violência, ofensa à honra.</li>
          <li>Conteúdo sexual, e qualquer conteúdo sexual ou de exploração envolvendo menores (denunciado às autoridades).</li>
          <li>Foto de outra pessoa sem autorização dela, ou publicar dados pessoais de alguém.</li>
          <li>Divulgar casas de aposta, rifas, vendas, golpes, links suspeitos ou spam.</li>
          <li>Se passar por outra pessoa, criar contas para ganhar pontos ou explorar falhas do app.</li>
          <li>Incentivo a autolesão ou suicídio. Se alguém precisar de ajuda: CVV, ligue 188 (24h, gratuito).</li>
        </ul>
        <p><b>Palpites.</b> São brincadeira. Não combine resultado, não entregue jogo e não pressione ninguém por causa de palpite. Quem combina resultado perde os pontos e pode perder a conta.</p>
        <p><b>Se alguém passar do ponto:</b> 1) a mensagem ou foto é apagada pelo dono ou adm da turma, ou pelo dono do jogo ao vivo; 2) a pessoa recebe aviso e pode se explicar pelo ${CONTACT_EMAIL}; 3) reincidência ou caso grave: suspensão ou exclusão da conta. Crimes são comunicados às autoridades quando a lei manda.</p>
        <p><b>Como denunciar.</b> Toque nos três pontinhos da mensagem → Denunciar, ou escreva para ${CONTACT_EMAIL} com o print e o nome da turma.</p>`
    };

    function openTermsPage(tab) {
      showTermsTab(tab || 'termos');
      const acc = account && account.termsAt ? `Você aceitou a versão ${account.termsVersion} em ${new Date(account.termsAt).toLocaleDateString('pt-BR')}.` : '';
      document.getElementById('terms-accepted').innerText = acc;
      document.getElementById('page-terms').classList.remove('hidden');
      document.getElementById('page-terms').scrollTop = 0;
      pushPage('page-terms');
    }
    function closeTermsPage() {
      document.getElementById('page-terms').classList.add('hidden');
      popPage('page-terms');
    }
    function showTermsTab(tab) {
      document.querySelectorAll('#terms-tabs .seg-btn').forEach(b => b.classList.toggle('is-selected', b.dataset.t === tab));
      document.getElementById('terms-body').innerHTML = LEGAL[tab] || '';
    }

    /* ===================================================================
       MOLDURAS E NOMES (o que a lojinha desbloqueia)
       =================================================================== */
    const TIERS = ['bronze', 'prata', 'ouro', 'esmeralda', 'rubi', 'platina', 'diamante', 'tealorange'];
    const TIER_LABEL = { bronze: 'Bronze', prata: 'Prata', ouro: 'Ouro', esmeralda: 'Esmeralda', rubi: 'Rubi', platina: 'Platina', diamante: 'Diamante', tealorange: 'Teal & Orange' };
    // Effect on a frame or a name: true = the classic shine, 'fogo-azul' = blue fire aura.
    const fxClass = v => v === 'fogo-azul' ? 'fogo' : v ? 'shine' : '';
    const cosOf = c => (c && typeof c === 'object') ? c : {};

    function framedAvatar(value, name, cls, cos) {
      const c = cosOf(cos);
      const inner = avatarHtml(value, name, cls);
      const framed = !c.frame || !TIERS.includes(c.frame) ? inner : `<span class="fr fr-${c.frame} ${fxClass(c.frameShine)}">${inner}</span>`;
      const p = c.pipoca && c.pipoca.until && Date.parse(c.pipoca.until) > Date.now();
      return p ? `<span class="pip-wrap">${framed}<span class="pip-badge" aria-label="Pipoca">🍿</span></span>` : framed;
    }
    function styledName(name, cos, extra) {
      const c = cosOf(cos);
      const cls = c.name && TIERS.includes(c.name) ? `nm nm-${c.name} ${fxClass(c.nameShine)}` : '';
      return `<span class="${cls} ${extra || ''}">${escapeHtml(name)}</span>`;
    }
    /* Frames an element already on the page (header and profile avatars). */
    function applyFrame(wrap, cos) {
      if (!wrap) return;
      const c = cosOf(cos);
      TIERS.forEach(t => wrap.classList.remove('fr-' + t));
      const on = !!(c.frame && TIERS.includes(c.frame));
      wrap.classList.toggle('fr', on);
      wrap.classList.toggle('shine', on && fxClass(c.frameShine) === 'shine');
      wrap.classList.toggle('fogo', on && fxClass(c.frameShine) === 'fogo');
      if (on) wrap.classList.add('fr-' + c.frame);
    }
    function applyNameStyle(el, cos) {
      if (!el) return;
      const c = cosOf(cos);
      TIERS.forEach(t => el.classList.remove('nm-' + t));
      const on = !!(c.name && TIERS.includes(c.name));
      el.classList.toggle('nm', on);
      el.classList.toggle('shine', on && fxClass(c.nameShine) === 'shine');
      el.classList.toggle('fogo', on && fxClass(c.nameShine) === 'fogo');
      if (on) el.classList.add('nm-' + c.name);
    }

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
      const m = (location.hash + '&' + location.search).match(/ao-vivo=([A-Za-z0-9]{4,12})/);
      if (m) {
        try { sessionStorage.setItem('baba_pending_live', m[1].toUpperCase()); } catch (e) {}
        try { history.replaceState(null, '', location.pathname); } catch (e) {}
      }
    }
    function openPendingList() {
      let id = null;
      try { id = sessionStorage.getItem('baba_pending_list'); sessionStorage.removeItem('baba_pending_list'); } catch (e) {}
      if (id && currentUser) openEventSheet(id);
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
    function renderHomeEvents() {
      renderHomeExplore();
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
          ${me ? `<div class="grid grid-cols-3 gap-1.5 mt-3">${btn('vou', 'Vou')}${btn('talvez', 'Talvez')}${btn('nao', 'Não vou')}</div>`
            : `<p class="text-[12px] text-ink-2 mt-2.5 leading-snug">Pra responder, ligue seu nome na turma (abra a turma e toque no seu nome).</p>`}
        </div>`;
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
          const ev = { id, turma_id: turmaId, starts_at: starts.toISOString(), place };
          eventPush(ev, 'event', `📋 ${firstName(currentUser.name)} puxou a lista pra ${evWhen(ev).toLowerCase()}! Bora?`, `${(turmaById(turmaId) || {}).name || ''}${place ? ' · ' + place : ''}`);
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

    /* ===================================================================
       TURMAS (v11.2)
       Public or private turmas, ranking (last baba or season), trophy
       shelf, prestige score, challenges between turmas (closed friendly,
       open friendly on the board) and championships. Every number and rule
       comes from the server; this only draws it and sends the actions.
       =================================================================== */
    let hubOff = null;      // true = server without v11.2
    const PRES_LABEL = { bronze: 'Bronze', prata: 'Prata', ouro: 'Ouro', diamante: 'Diamante' };
    const PRES_CLS = { bronze: 'bg-[#ecd3b8] text-[#6b3f17]', prata: 'bg-[#e3e7eb] text-[#47525d]', ouro: 'bg-[#f8e394] text-[#6a5200]', diamante: 'bg-[#d3effb] text-[#0b5d7a]' };
    const METRICS = [['goals', 'Gols'], ['assists', 'Assist.'], ['part', 'Particip.'], ['wins', 'Vitórias'], ['matches', 'Jogos'], ['saves', 'Defesas']];
    const KIND_LABEL = { amistoso_fechado: 'Amistoso fechado', amistoso_aberto: 'Amistoso aberto', campeonato: 'Campeonato' };
    const TROPHY_ICON = { artilheiro: 'fa-futbol', garcom: 'fa-handshake', craque: 'fa-star', vencedor: 'fa-fire', paredao: 'fa-hand', campeonato: 'fa-trophy' };
    const hubErr = e => {
      if (isNetworkError(e)) return 'Precisa de internet.';
      const m = String((e && e.message) || '');
      const map = { not_allowed: 'Só o adm da turma pode fazer isso.', not_found: 'Isso não está mais disponível.', home_private: 'Sua turma precisa ser pública pra isso.', away_private: 'A outra turma é privada.',
        limit: 'Você já tem coisa demais em aberto. Feche ou cancele alguma.', closed: 'Isso já foi encerrado.', too_early: 'Só dá pra lançar o placar perto do horário do jogo.', bad_date: 'Data fora do prazo.',
        full: 'As vagas acabaram.', few_teams: 'Precisa de pelo menos 3 turmas pra começar.', bad_score: 'Placar inválido.', championship_match: 'Jogo de campeonato não se cancela sozinho.', bad_name: 'Dê um nome.' };
      const k = Object.keys(map).find(x => m.includes(x));
      return k ? map[k] : (isMissingFn(e) || isMissingTable(e)) ? 'Isso chega quando o servidor for atualizado.' : 'Não deu certo. Tente de novo.';
    };
    const myAdminTurmas = pub => state.turmas.filter(t => t.cloud && canEditTurma(t) && (!pub || (hubPublic.get(t.id) === true)));
    const hubPublic = new Map();     // turmaId -> is_public, learned from the server
    const tierChip = (tier, score) => `<span class="ev-tag ${PRES_CLS[tier] || PRES_CLS.bronze}"><i class="fa-solid fa-shield-halved mr-1"></i>${PRES_LABEL[tier] || 'Bronze'}${score != null ? ' · ' + fmtPts(score) : ''}</span>`;
    const turmaTile = (name, cls = 'w-10 h-10') => `<span class="tile ${cls} rounded-xl bg-pitch text-butter text-[15px] font-extrabold flex-shrink-0">${escapeHtml(String(name || '?').trim().charAt(0).toUpperCase())}</span>`;
    const mWhen = iso => iso ? evWhen({ starts_at: iso }, true) : 'A combinar';

    /* ---- Form sheet (one small dialog for the challenge, score, schedule and championship forms) ---- */
    let formState = null;
    function openForm(o) {
      formState = o;
      document.getElementById('form-title').innerText = o.title;
      document.getElementById('form-sub').innerText = o.sub || '';
      document.getElementById('form-sub').classList.toggle('hidden', !o.sub);
      document.getElementById('form-ok').innerText = o.okLabel || 'Salvar';
      document.getElementById('form-error').classList.add('hidden');
      document.getElementById('form-body').innerHTML = o.fields.map(f => {
        const id = 'ff-' + f.id;
        if (f.type === 'select') return `<label class="block"><span class="label">${escapeHtml(f.label)}</span><select id="${id}" class="select">${f.options.map(op => `<option value="${escapeHtml(op.v)}" ${String(op.v) === String(f.value) ? 'selected' : ''}>${escapeHtml(op.l)}</option>`).join('')}</select></label>`;
        if (f.type === 'time') return `<label class="block min-w-0"><span class="label">${escapeHtml(f.label)}</span><input id="${id}" type="text" inputmode="numeric" autocomplete="off" maxlength="5" placeholder="19:30" value="${escapeHtml(f.value || '')}" class="field" oninput="maskTime(this)" /></label>`;
        if (f.type === 'date') return `<label class="block min-w-0"><span class="label">${escapeHtml(f.label)}</span><input id="${id}" type="date" value="${escapeHtml(f.value || '')}" class="field" /></label>`;
        if (f.type === 'number') return `<label class="block min-w-0"><span class="label">${escapeHtml(f.label)}</span><input id="${id}" type="text" inputmode="numeric" maxlength="2" value="${escapeHtml(f.value ?? '')}" placeholder="0" class="field text-center text-[20px] font-extrabold" oninput="this.value=this.value.replace(/\\D/g,'')" /></label>`;
        return `<label class="block"><span class="label">${escapeHtml(f.label)}</span><input id="${id}" maxlength="${f.max || 120}" value="${escapeHtml(f.value || '')}" placeholder="${escapeHtml(f.placeholder || '')}" autocomplete="off" class="field" /></label>`;
      }).join('');
      // date + time sit side by side
      const b = document.getElementById('form-body');
      const d = b.querySelector('input[type=date]'), t = b.querySelector('input[inputmode=numeric][maxlength="5"]');
      if (d && t && d.closest('label').nextElementSibling === t.closest('label')) {
        const wrap = document.createElement('div'); wrap.className = 'grid grid-cols-2 gap-2';
        d.closest('label').before(wrap); wrap.appendChild(d.closest('label')); wrap.appendChild(t.closest('label'));
      }
      const nums = b.querySelectorAll('input[inputmode=numeric][maxlength="2"]');
      if (nums.length === 2) {
        const wrap = document.createElement('div'); wrap.className = 'grid grid-cols-2 gap-2';
        nums[0].closest('label').before(wrap); wrap.appendChild(nums[0].closest('label')); wrap.appendChild(nums[1].closest('label'));
      }
      document.getElementById('modal-form').classList.remove('hidden');
    }
    function closeForm() { document.getElementById('modal-form').classList.add('hidden'); formState = null; }
    async function submitForm() {
      if (!formState) return;
      const vals = {};
      formState.fields.forEach(f => { vals[f.id] = (document.getElementById('ff-' + f.id) || {}).value; });
      const btn = document.getElementById('form-ok');
      setBusy(btn, true, 'Enviando...');
      try {
        const keep = await formState.onOk(vals);
        if (keep !== false) closeForm();
      } catch (e) { showErr('form-error', (e && e.formMsg) || hubErr(e)); }
      finally { if (document.body.contains(btn)) setBusy(btn, false); }
    }
    const startsFrom = (date, time) => {
      const tm = parseTimeInput(time);
      if (!date && !String(time || '').trim()) return null;
      if (!date || !tm) { const e = new Error('form'); e.formMsg = 'Preencha o dia e a hora (ou deixe os dois em branco: a combinar).'; throw e; }
      return new Date(`${date}T${tm}:00`).toISOString();
    };

    /* ---- Hub of a turma ---- */
    let hub = null;   // { id, name, member, admin, tab, period, metric, lim, cache: {} }
    async function openTurmaHub(id, info) {
      const t = turmaById(id);
      hub = { id, name: t ? t.name : (info && info.name) || 'Turma', member: !!t, admin: !!t && t.cloud && canEditTurma(t), tab: 'rank', period: 'season', metric: 'goals', lim: 10, cache: {}, prestige: null };
      document.getElementById('modal-thub').classList.remove('hidden');
      renderHub();
      try {
        hub.prestige = await api.turmaPrestige(id);
        hubPublic.set(id, !!hub.prestige.is_public);
        hubOff = false;
      } catch (e) {
        if (isMissingFn(e) || isMissingTable(e)) hubOff = true;
        document.getElementById('thub-body').innerHTML = `<p class="text-[14px] text-ink-2 py-6 text-center">${escapeHtml(hubErr(e))}</p>`;
        return;
      }
      renderHub();
      loadHubTab();
    }
    function closeHub() { document.getElementById('modal-thub').classList.add('hidden'); hub = null; if (editingTurmaId) renderTurmaHubCard(); }
    function hubTab(tab) { if (!hub) return; hub.tab = tab; renderHub(); loadHubTab(); }
    function renderHub() {
      if (!hub) return;
      const p = hub.prestige;
      document.getElementById('thub-title').innerText = hub.name;
      const seg = (id, label) => `<button onclick="hubTab('${id}')" class="seg-btn ${hub.tab === id ? 'is-selected' : ''}">${label}</button>`;
      document.getElementById('thub-head').innerHTML = `
        <div class="flex flex-wrap items-center gap-1.5">
          ${p ? tierChip(p.tier, p.score) : ''}
          ${p ? `<span class="ev-tag bg-sunk text-ink-2"><i class="fa-solid ${p.is_public ? 'fa-earth-americas' : 'fa-lock'} mr-1"></i>${p.is_public ? 'Pública' : 'Privada'}</span>` : ''}
          ${hub.member ? '' : '<span class="ev-tag bg-sunk text-ink-2">Você não é dessa turma</span>'}
        </div>
        <div class="seg grid-cols-3">${seg('rank', 'Ranking')}${seg('trophies', 'Troféus')}${seg('matches', 'Desafios')}</div>`;
    }
    async function loadHubTab() {
      if (!hub) return;
      const h = hub, body = document.getElementById('thub-body');
      const key = h.tab === 'rank' ? `rank:${h.period}:${h.metric}:${h.lim}` : h.tab;
      if (!h.cache[key]) body.innerHTML = '<p class="text-[13px] text-ink-2 py-6 text-center">Carregando...</p>';
      try {
        if (!h.cache[key]) h.cache[key] = h.tab === 'rank' ? await api.turmaRanking(h.id, h.period, h.metric, h.lim) : h.tab === 'trophies' ? await api.turmaTrophies(h.id) : await api.turmaMatches(h.id);
      } catch (e) { if (hub === h) body.innerHTML = `<p class="text-[14px] text-ink-2 py-6 text-center">${escapeHtml(hubErr(e))}</p>`; return; }
      if (hub === h) renderHubBody();
    }
    function hubSet(field, v) { if (!hub) return; hub[field] = field === 'lim' ? +v : v; renderHubBody(); loadHubTab(); }
    function renderHubBody() {
      if (!hub) return;
      const body = document.getElementById('thub-body');
      if (hub.tab === 'rank') {
        const d = hub.cache[`rank:${hub.period}:${hub.metric}:${hub.lim}`];
        if (!d) { body.innerHTML = ''; return; }
        const medal = i => i === 0 ? 'bg-[#f3c93a] text-pitch' : i === 1 ? 'bg-[#cfd5db] text-pitch' : i === 2 ? 'bg-[#d9a273] text-pitch' : 'bg-sunk text-ink-2';
        const unit = (METRICS.find(m => m[0] === hub.metric) || [0, ''])[1].toLowerCase();
        const label = hub.period === 'last' ? (d.label ? `Última partida: ${new Date(d.label + 'T12:00:00').toLocaleDateString('pt-BR')}` : 'Ainda não teve baba encerrado') : `Temporada ${String(d.season || '').replace('-S1', ' · jan a jun').replace('-S2', ' · jul a dez')} · ${d.babas} baba${d.babas === 1 ? '' : 's'}`;
        body.innerHTML = `
          <div class="seg grid-cols-2">
            <button onclick="hubSet('period','last')" class="seg-btn ${hub.period === 'last' ? 'is-selected' : ''}">Última partida</button>
            <button onclick="hubSet('period','season')" class="seg-btn ${hub.period === 'season' ? 'is-selected' : ''}">Temporada (6 meses)</button>
          </div>
          <div class="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">${METRICS.map(m => `<button onclick="hubSet('metric','${m[0]}')" class="chip ${hub.metric === m[0] ? 'is-selected' : ''}">${m[1]}</button>`).join('')}</div>
          <div class="flex items-center justify-between gap-2"><p class="text-[12.5px] text-ink-2 leading-snug flex-1 min-w-0">${escapeHtml(label)}</p>
            <div class="seg grid-cols-2 flex-shrink-0 !w-[130px]"><button onclick="hubSet('lim',10)" class="seg-btn !py-1.5 ${hub.lim === 10 ? 'is-selected' : ''}">Top 10</button><button onclick="hubSet('lim',26)" class="seg-btn !py-1.5 ${hub.lim === 26 ? 'is-selected' : ''}">Top 26</button></div></div>
          ${d.rows.length ? `<div class="divide-y divide-ink/[0.07]">${d.rows.map((r, i) => `
            <div class="flex items-center gap-3 py-2.5">
              <span class="w-7 h-7 rounded-full ${medal(i)} text-[12px] font-extrabold flex items-center justify-center flex-shrink-0">${r.rank}</span>
              <span class="min-w-0 flex-1"><span class="block text-[14.5px] font-bold truncate">${escapeHtml(r.name)}</span><span class="block text-[11.5px] text-ink-3">${r.babas} baba${r.babas === 1 ? '' : 's'} · ${r.matches} jogo${r.matches === 1 ? '' : 's'}</span></span>
              <span class="text-right flex-shrink-0"><span class="block text-[20px] font-extrabold leading-none">${r.value}</span><span class="block text-[10.5px] font-bold text-ink-3 uppercase">${escapeHtml(unit)}</span></span>
            </div>`).join('')}</div>` : '<p class="text-[13.5px] text-ink-2 py-6 text-center">Ninguém pontuou nesse período ainda.</p>'}`;
        return;
      }
      if (hub.tab === 'trophies') {
        const d = hub.cache.trophies;
        if (!d) { body.innerHTML = ''; return; }
        const card = (kind, title, sub, big) => `<div class="rounded-2xl bg-card border border-ink/10 p-3 flex items-center gap-3"><span class="tile ${big ? 'bg-butter' : 'bg-sunk'} text-pitch flex-shrink-0"><i class="fa-solid ${TROPHY_ICON[kind] || 'fa-trophy'}"></i></span><span class="min-w-0"><span class="block text-[14px] font-bold leading-tight">${escapeHtml(title)}</span><span class="block text-[12px] text-ink-2 truncate">${sub}</span></span></div>`;
        const sName = s => String(s).replace('-S1', ' (jan a jun)').replace('-S2', ' (jul a dez)');
        const bySeason = {};
        d.atletas.forEach(a => { (bySeason[a.season] = bySeason[a.season] || []).push(a); });
        body.innerHTML = `
          <div><p class="section-tag">Troféus da turma</p>${d.turma.length ? `<div class="space-y-2 mt-1.5">${d.turma.map(x => card(x.kind, x.title, escapeHtml(sName(x.season)), true)).join('')}</div>` : '<p class="text-[13px] text-ink-2 mt-1">Ainda sem troféu de turma. Campeonatos ganhos aparecem aqui.</p>'}</div>
          ${Object.keys(bySeason).sort().reverse().map(s => `<div><p class="section-tag">Temporada ${escapeHtml(sName(s))}</p><div class="space-y-2 mt-1.5">${bySeason[s].map(a => card(a.kind, a.title, `${escapeHtml(a.name)} · ${a.value}`, false)).join('')}</div></div>`).join('')}
          ${d.atletas.length ? '' : '<p class="text-[13px] text-ink-2">Os troféus de atleta saem no fim de cada temporada de 6 meses (precisa de pelo menos 3 babas nela).</p>'}`;
        return;
      }
      const list = hub.cache.matches;
      if (!list) { body.innerHTML = ''; return; }
      const canAct = hub.admin && hubPublic.get(hub.id) === true;
      const mine = myAdminTurmas();
      body.innerHTML = `
        ${hub.admin ? (canAct ? `<div class="grid grid-cols-2 gap-2">
            <button onclick="closeHub(); openExplore('turmas', '${hub.id}')" class="btn-primary h-11 text-[13px]"><i class="fa-solid fa-user-group"></i> Desafiar uma turma</button>
            <button onclick="openMatchForm('${hub.id}', null)" class="btn-outline h-11 text-[13px]"><i class="fa-solid fa-bullhorn"></i> Desafio aberto</button>
          </div>` : '<p class="rounded-2xl bg-butter/40 border border-butter-3/60 text-[13px] p-3 leading-snug">Pra desafiar e ser desafiada, a turma precisa ser <b>pública</b>. Ligue em “Turma pública” abaixo.</p>') : ''}
        ${list.length ? `<div class="space-y-2">${list.map(m => matchCardHtml(m, mine)).join('')}</div>` : '<p class="text-[13.5px] text-ink-2 py-4 text-center">Nenhum desafio ainda.</p>'}
        ${hub.admin ? `<label class="flex items-center gap-3 rounded-2xl bg-sunk p-3 mt-1"><span class="min-w-0 flex-1"><span class="block text-[14px] font-bold">Turma pública</span><span class="block text-[12px] text-ink-2 leading-snug">Aparece em Explorar, mostra ranking e troféus a qualquer pessoa e pode desafiar e ser desafiada. Entrar continua só pelo convite.</span></span>
          <input type="checkbox" class="sr-only" ${hubPublic.get(hub.id) ? 'checked' : ''} onchange="toggleTurmaPublic(this.checked)" /><span class="switch"></span></label>` : ''}
        ${hub.prestige ? `<details class="rounded-2xl border border-ink/10 bg-card p-3"><summary class="text-[13.5px] font-bold cursor-pointer">Como o prestígio é calculado</summary>
          <div class="mt-2 space-y-1">${hub.prestige.parts.map(x => `<div class="flex justify-between text-[12.5px]"><span class="text-ink-2">${escapeHtml(x.label)} (${x.qty})</span><span class="font-bold">+${fmtPts(x.pts)}</span></div>`).join('')}</div></details>` : ''}`;
    }
    async function toggleTurmaPublic(on) {
      if (!hub || !hub.admin) return;
      const id = hub.id;
      try {
        await api.setPrivacy(id, !!on);
        hubPublic.set(id, !!on);
        if (hub && hub.prestige) hub.prestige.is_public = !!on;
        hub.cache = {};
        showToast(on ? 'Turma pública: agora ela aparece em Explorar.' : 'Turma privada de novo. Os desafios abertos foram tirados do mural.');
        renderHub(); loadHubTab();
      } catch (e) { showToast(hubErr(e), 'warning'); renderHubBody(); }
    }

    /* ---- Challenge cards and actions ---- */
    const sideAdmin = (m, mine) => ({ home: mine.some(t => t.id === m.home), away: !!m.away && mine.some(t => t.id === m.away) });
    function matchCardHtml(m, mine) {
      const adm = sideAdmin(m, mine);
      const st = m.status;
      const stTag = st === 'played' ? '<span class="ev-tag bg-leaf/10 text-leaf">Jogado</span>' : st === 'accepted' ? '<span class="ev-tag bg-butter text-pitch">Marcado</span>' : st === 'pending' ? '<span class="ev-tag bg-sunk text-ink-2">Aguardando resposta</span>' : st === 'open' ? '<span class="ev-tag bg-butter text-pitch">No mural</span>' : '';
      const score = m.home_goals != null ? `<span class="text-[20px] font-extrabold tabular-nums">${m.home_goals} x ${m.away_goals}</span>` : '<span class="text-[13px] font-extrabold text-ink-3">x</span>';
      const btn = (fn, label, cls = 'btn-outline') => `<button onclick="${fn}" class="${cls} h-10 px-3 text-[12.5px]">${label}</button>`;
      const acts = [];
      if (st === 'pending' && adm.away) acts.push(btn(`answerMatch('${m.id}', true)`, 'Aceitar', 'btn-primary'), btn(`answerMatch('${m.id}', false)`, 'Recusar'));
      if ((st === 'pending' || st === 'open') && adm.home) acts.push(btn(`cancelMatchUI('${m.id}')`, 'Cancelar'));
      if (st === 'accepted' && (adm.home || adm.away)) {
        if (m.result_status === 'none') {
          acts.push(btn(`openResultForm('${m.id}')`, 'Lançar placar', 'btn-primary'), btn(`openScheduleForm('${m.id}')`, 'Combinar horário'));
          if (!m.championship) acts.push(btn(`cancelMatchUI('${m.id}')`, 'Cancelar'));
        } else if (m.result_status === 'reported') {
          const other = m.reported_by === m.home ? adm.away : adm.home;
          if (other) acts.push(btn(`confirmMatch('${m.id}', true)`, 'Confirmar placar', 'btn-primary'), btn(`confirmMatch('${m.id}', false)`, 'Contestar'));
        }
      }
      const note = st === 'accepted' && m.result_status === 'reported' ? `<p class="text-[12px] text-ink-2 leading-snug mt-1.5">${(m.reported_by === m.home ? adm.away : adm.home) ? 'A outra turma lançou esse placar. Confere?' : 'Aguardando a outra turma confirmar. Sem resposta em 72 h, o placar vale.'}</p>` : '';
      return `
        <div class="rounded-2xl bg-card border border-ink/10 p-3">
          <div class="flex items-center gap-1.5 mb-1.5"><span class="ev-tag bg-sunk text-ink-2">${KIND_LABEL[m.kind] || ''}</span>${stTag}</div>
          <div class="flex items-center gap-2">
            <span class="min-w-0 flex-1 text-[14px] font-bold leading-tight break-words">${escapeHtml(m.home_name)}</span>
            ${score}
            <span class="min-w-0 flex-1 text-[14px] font-bold leading-tight break-words text-right">${m.away_name ? escapeHtml(m.away_name) : '<span class="text-ink-3">Quem aceitar</span>'}</span>
          </div>
          ${m.status === 'played' ? '' : `<p class="text-[12px] text-ink-2 mt-1.5"><i class="fa-regular fa-clock"></i> ${escapeHtml(mWhen(m.starts_at))}${m.place ? ` · ${escapeHtml(m.place)}` : ''}</p>`}
          ${m.note && m.status !== 'played' ? `<p class="text-[12.5px] text-ink-2 mt-1 leading-snug">${escapeHtml(m.note)}</p>` : ''}
          ${note}
          ${acts.length ? `<div class="flex flex-wrap gap-2 mt-2.5">${acts.join('')}</div>` : ''}
        </div>`;
    }
    async function refreshAfterMatch() {
      if (hub) { hub.cache = {}; loadHubTab(); }
      if (exploreState) loadExplore();
      if (champOpen) openChamp(champOpen, true);
    }
    async function answerMatch(id, ok) {
      try { await api.respondMatch(id, ok, null); showToast(ok ? 'Desafio aceito! Combinem o horário.' : 'Desafio recusado.'); refreshAfterMatch(); }
      catch (e) { showToast(hubErr(e), 'warning'); }
    }
    async function cancelMatchUI(id) {
      if (!(await askConfirm('Cancelar esse desafio?', 'Cancelar desafio'))) return;
      try { await api.cancelMatch(id); showToast('Desafio cancelado.'); refreshAfterMatch(); } catch (e) { showToast(hubErr(e), 'warning'); }
    }
    async function confirmMatch(id, ok) {
      if (!ok && !(await askConfirm('Contestar o placar? Ele é apagado e a outra turma lança de novo.', 'Contestar'))) return;
      try { const r = await api.confirmResult(id, ok); showToast(r === 'confirmed' ? 'Placar confirmado!' : 'Placar contestado. Lancem de novo.'); refreshAfterMatch(); }
      catch (e) { showToast(hubErr(e), 'warning'); }
    }
    const findMatch = id => {
      const lists = [hub && hub.cache.matches, champData && champData.matches, exploreState && exploreState.mural].filter(Boolean);
      for (const l of lists) { const m = l.find(x => x.id === id); if (m) return m; }
      return null;
    };
    function openResultForm(id) {
      const m = findMatch(id);
      if (!m) return;
      openForm({ title: 'Lançar o placar', sub: 'A outra turma confirma. Sem resposta em 72 h, o placar vale.', okLabel: 'Lançar placar',
        fields: [{ id: 'h', type: 'number', label: m.home_name, value: '' }, { id: 'a', type: 'number', label: m.away_name || 'Visitante', value: '' }],
        onOk: async v => {
          if (v.h === '' || v.a === '') { const e = new Error('form'); e.formMsg = 'Preencha os dois placares.'; throw e; }
          await api.reportResult(id, +v.h, +v.a); showToast('Placar lançado. Aguardando a outra turma.'); refreshAfterMatch();
        } });
    }
    function openScheduleForm(id) {
      const m = findMatch(id);
      if (!m) return;
      const d = m.starts_at ? new Date(m.starts_at) : null, pad = n => String(n).padStart(2, '0');
      openForm({ title: 'Combinar horário', okLabel: 'Salvar',
        fields: [{ id: 'date', type: 'date', label: 'Dia', value: d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '' }, { id: 'time', type: 'time', label: 'Hora', value: d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '' },
          { id: 'place', type: 'text', label: 'Onde', value: m.place || '', placeholder: 'Quadra, bairro' }],
        onOk: async v => { await api.scheduleMatch(id, startsFrom(v.date, v.time), (v.place || '').trim()); showToast('Horário salvo.'); refreshAfterMatch(); } });
    }
    /* Challenge: target = a turma (closed friendly) or null (open friendly on the board). */
    function openMatchForm(homeId, target) {
      const mine = myAdminTurmas().filter(t => hubPublic.get(t.id) === true);
      if (!mine.length) { showToast('Sua turma precisa ser pública pra desafiar.', 'warning'); return; }
      const home = mine.find(t => t.id === homeId) || mine[0];
      openForm({ title: target ? `Desafiar ${target.name}` : 'Desafio aberto', sub: target ? 'A turma recebe o convite e o adm aceita ou recusa.' : 'Fica no mural de Explorar até uma turma pública aceitar.', okLabel: target ? 'Enviar desafio' : 'Postar no mural',
        fields: [{ id: 'home', type: 'select', label: 'Sua turma', value: home.id, options: mine.map(t => ({ v: t.id, l: t.name })) },
          { id: 'date', type: 'date', label: 'Dia (opcional)' }, { id: 'time', type: 'time', label: 'Hora' },
          { id: 'place', type: 'text', label: 'Onde (opcional)', placeholder: 'Quadra, bairro' }, { id: 'note', type: 'text', label: 'Recado (opcional)', max: 280, placeholder: 'Ex.: 5x5, leva colete' }],
        onOk: async v => {
          await api.createMatch(v.home, target ? 'amistoso_fechado' : 'amistoso_aberto', target ? target.id : null, startsFrom(v.date, v.time), (v.place || '').trim(), (v.note || '').trim());
          showToast(target ? 'Desafio enviado!' : 'Desafio no mural!');
          refreshAfterMatch();
        } });
    }

    /* ---- Explore: turmas, board of open challenges, championships ---- */
    let exploreState = null;   // { tab, q, turmas, mural, camps, pickFor }
    let exploreTimer = null;
    function openExplore(tab, pickFor) {
      exploreState = { tab: tab || 'turmas', q: '', turmas: null, mural: null, camps: null, pickFor: pickFor || null };
      document.getElementById('modal-explore').classList.remove('hidden');
      renderExplore(); loadExplore();
    }
    function closeExplore() { document.getElementById('modal-explore').classList.add('hidden'); exploreState = null; }
    function exploreTab(tab) { exploreState.tab = tab; renderExplore(); loadExplore(); }
    function exploreSearch(v) { exploreState.q = v; clearTimeout(exploreTimer); exploreTimer = setTimeout(() => { exploreState.turmas = null; loadExplore(); }, 300); }
    async function loadExplore() {
      const s = exploreState; if (!s) return;
      try {
        if (s.tab === 'turmas') s.turmas = await api.exploreTurmas(s.q, 40);
        else if (s.tab === 'mural') s.mural = await api.openMatches();
        else s.camps = await api.listChampionships();
        hubOff = false;
        (s.turmas || []).forEach(x => hubPublic.set(x.id, !!x.is_public));
      } catch (e) { if (isMissingFn(e) || isMissingTable(e)) hubOff = true; if (exploreState === s) document.getElementById('explore-list').innerHTML = `<p class="text-[14px] text-ink-2 py-6 text-center">${escapeHtml(hubErr(e))}</p>`; return; }
      if (exploreState === s) renderExploreList();
    }
    function renderExplore() {
      const s = exploreState; if (!s) return;
      const seg = (id, l) => `<button onclick="exploreTab('${id}')" class="seg-btn ${s.tab === id ? 'is-selected' : ''}">${l}</button>`;
      document.getElementById('explore-tabs').innerHTML = `<div class="seg grid-cols-3">${seg('turmas', 'Turmas')}${seg('mural', 'Mural')}${seg('camps', 'Campeonatos')}</div>` +
        (s.tab === 'turmas' ? `<input id="explore-q" value="${escapeHtml(s.q)}" oninput="exploreSearch(this.value)" placeholder="Buscar turma pelo nome" autocomplete="off" class="field mt-2" />` : '');
      document.getElementById('explore-sub').innerText = s.pickFor ? 'Escolha a turma que você quer desafiar.' : '';
      document.getElementById('explore-sub').classList.toggle('hidden', !s.pickFor);
      renderExploreList();
    }
    function renderExploreList() {
      const s = exploreState; if (!s) return;
      const box = document.getElementById('explore-list');
      const mine = myAdminTurmas();
      const canChallenge = mine.some(t => hubPublic.get(t.id) === true);
      if (s.tab === 'turmas') {
        if (!s.turmas) { box.innerHTML = '<p class="text-[13px] text-ink-2 py-6 text-center">Carregando...</p>'; return; }
        const list = s.turmas.filter(x => !(s.pickFor && x.id === s.pickFor));
        box.innerHTML = list.length ? list.map(x => `
          <div class="rounded-2xl bg-card border border-ink/10 p-3 flex items-center gap-3">
            ${turmaTile(x.name)}
            <button onclick="${s.pickFor ? `pickChallenge('${x.id}')` : `openTurmaHub('${x.id}', { name: ${escapeHtml(JSON.stringify(x.name))} })`}" class="min-w-0 flex-1 text-left">
              <span class="block text-[14.5px] font-bold truncate">${escapeHtml(x.name)}</span>
              <span class="flex flex-wrap items-center gap-1 mt-0.5">${tierChip(x.prestige.tier, x.prestige.score)}<span class="text-[11.5px] text-ink-3">${x.members} membro${x.members === 1 ? '' : 's'}${x.member ? ' · sua turma' : ''}${x.is_public ? '' : ' · privada'}</span></span>
            </button>
            ${!s.pickFor && !x.member && x.is_public && canChallenge ? `<button onclick="pickChallenge('${x.id}')" class="btn-outline h-9 px-3 text-[12px] flex-shrink-0">Desafiar</button>` : '<i class="fa-solid fa-chevron-right text-[12px] text-ink-3"></i>'}
          </div>`).join('') : '<p class="text-[13.5px] text-ink-2 py-6 text-center">Nenhuma turma pública encontrada. Deixe a sua pública pra ela aparecer aqui.</p>';
        return;
      }
      if (s.tab === 'mural') {
        if (!s.mural) { box.innerHTML = '<p class="text-[13px] text-ink-2 py-6 text-center">Carregando...</p>'; return; }
        box.innerHTML = (s.mural.length ? s.mural.map(m => {
          const pub = mine.filter(t => hubPublic.get(t.id) === true && t.id !== m.home);
          const mineHome = m.mine;
          return `<div>${matchCardHtml(m, mine)}<div class="flex flex-wrap items-center gap-2 mt-1.5 px-1">${tierChip(m.prestige.tier, m.prestige.score)}
            ${!mineHome && mine.length ? `<button onclick="takeOpenMatch('${m.id}')" class="btn-primary h-9 px-3 text-[12.5px] ml-auto">Aceitar desafio</button>` : ''}</div></div>`;
        }).join('') : '<p class="text-[13.5px] text-ink-2 py-6 text-center">Nenhum desafio aberto agora. Poste o da sua turma pela aba Desafios.</p>');
        return;
      }
      if (!s.camps) { box.innerHTML = '<p class="text-[13px] text-ink-2 py-6 text-center">Carregando...</p>'; return; }
      const ST = { inscricoes: ['Inscrições abertas', 'bg-butter text-pitch'], andamento: ['Em andamento', 'bg-leaf/10 text-leaf'], encerrado: ['Encerrado', 'bg-sunk text-ink-2'] };
      box.innerHTML = (canChallenge ? '<button onclick="openChampForm()" class="btn-primary w-full h-11 text-[13.5px]"><i class="fa-solid fa-trophy"></i> Criar campeonato</button>' : '') +
        (s.camps.length ? s.camps.map(c => `
          <button onclick="openChamp('${c.id}')" class="w-full rounded-2xl bg-card border border-ink/10 p-3 flex items-center gap-3 text-left">
            <span class="tile bg-butter text-pitch flex-shrink-0"><i class="fa-solid fa-trophy"></i></span>
            <span class="min-w-0 flex-1"><span class="block text-[14.5px] font-bold truncate">${escapeHtml(c.name)}</span>
              <span class="flex flex-wrap items-center gap-1 mt-0.5"><span class="ev-tag ${ST[c.status][1]}">${ST[c.status][0]}</span><span class="text-[11.5px] text-ink-3">${c.teams}/${c.max_teams} turmas · de ${escapeHtml(c.organizer_name)}${c.champion_name ? ' · 🏆 ' + escapeHtml(c.champion_name) : ''}${c.mine ? ' · você está' : ''}</span></span></span>
            <i class="fa-solid fa-chevron-right text-[12px] text-ink-3"></i>
          </button>`).join('') : '<p class="text-[13.5px] text-ink-2 py-6 text-center">Nenhum campeonato ainda.</p>');
    }
    function pickChallenge(targetId) {
      const x = ((exploreState && exploreState.turmas) || []).find(t => t.id === targetId);
      if (!x) return;
      const homeId = exploreState.pickFor || (myAdminTurmas().find(t => hubPublic.get(t.id) === true) || {}).id;
      openMatchForm(homeId, { id: x.id, name: x.name });
    }
    async function takeOpenMatch(id) {
      const mine = myAdminTurmas().filter(t => hubPublic.get(t.id) === true);
      const m = ((exploreState && exploreState.mural) || []).find(x => x.id === id);
      if (!mine.length) { showToast('Sua turma precisa ser pública pra aceitar desafios.', 'warning'); return; }
      const go = async tid => { try { await api.respondMatch(id, true, tid); showToast('Desafio aceito! Combinem o horário.'); refreshAfterMatch(); } catch (e) { showToast(hubErr(e), 'warning'); } };
      if (mine.length === 1) { if (await askConfirm(`Aceitar o desafio de ${m ? m.home_name : 'essa turma'} com a ${mine[0].name}?`, 'Aceitar')) go(mine[0].id); return; }
      openForm({ title: 'Aceitar desafio', sub: m ? `Contra ${m.home_name}` : '', okLabel: 'Aceitar', fields: [{ id: 'as', type: 'select', label: 'Com qual turma?', value: mine[0].id, options: mine.map(t => ({ v: t.id, l: t.name })) }],
        onOk: async v => { await api.respondMatch(id, true, v.as); showToast('Desafio aceito! Combinem o horário.'); refreshAfterMatch(); } });
    }

    /* ---- Championships ---- */
    let champOpen = null, champData = null;
    function openChampForm() {
      const mine = myAdminTurmas().filter(t => hubPublic.get(t.id) === true);
      if (!mine.length) { showToast('Sua turma precisa ser pública pra organizar um campeonato.', 'warning'); return; }
      openForm({ title: 'Criar campeonato', sub: 'Todos contra todos, um jogo entre cada par. Vitória vale 3 pontos, empate 1.', okLabel: 'Criar campeonato',
        fields: [{ id: 'org', type: 'select', label: 'Sua turma (organizadora)', value: mine[0].id, options: mine.map(t => ({ v: t.id, l: t.name })) },
          { id: 'name', type: 'text', label: 'Nome do campeonato', max: 60, placeholder: 'Ex.: Copa da Quinta' },
          { id: 'size', type: 'select', label: 'Quantas turmas (no máximo)', value: '4', options: [3, 4, 5, 6, 7, 8].map(n => ({ v: n, l: `${n} turmas` })) }],
        onOk: async v => { const id = await api.createChampionship(v.org, (v.name || '').trim(), +v.size); showToast('Campeonato criado! As turmas já podem se inscrever.'); if (exploreState) loadExplore(); openChamp(id); } });
    }
    async function openChamp(id, silent) {
      champOpen = id;
      document.getElementById('modal-champ').classList.remove('hidden');
      if (!silent) document.getElementById('champ-body').innerHTML = '<p class="text-[13px] text-ink-2 py-6 text-center">Carregando...</p>';
      try { champData = await api.championshipDetail(id); } catch (e) { document.getElementById('champ-body').innerHTML = `<p class="text-[14px] text-ink-2 py-6 text-center">${escapeHtml(hubErr(e))}</p>`; return; }
      renderChamp();
    }
    function closeChamp() { document.getElementById('modal-champ').classList.add('hidden'); champOpen = null; champData = null; }
    function renderChamp() {
      const c = champData; if (!c) return;
      const mine = myAdminTurmas();
      const isOrg = mine.some(t => t.id === c.organizer);
      const inIds = new Set(c.teams.map(t => t.id));
      const joinable = mine.filter(t => hubPublic.get(t.id) === true && !inIds.has(t.id));
      const leavable = mine.filter(t => inIds.has(t.id) && t.id !== c.organizer);
      document.getElementById('champ-title').innerText = c.name;
      const stLabel = { inscricoes: 'Inscrições abertas', andamento: 'Em andamento', encerrado: 'Encerrado' }[c.status] || '';
      document.getElementById('champ-body').innerHTML = `
        <div class="flex flex-wrap items-center gap-1.5"><span class="ev-tag bg-butter text-pitch">${stLabel}</span><span class="ev-tag bg-sunk text-ink-2">${c.teams.length}/${c.max_teams} turmas</span>
          ${c.champion ? `<span class="ev-tag bg-[#f8e394] text-[#6a5200]">🏆 ${escapeHtml((c.teams.find(t => t.id === c.champion) || {}).name || '')}</span>` : ''}</div>
        ${c.status === 'inscricoes' ? `<div class="space-y-2">
          ${joinable.map(t => `<button onclick="champJoin('${t.id}')" class="btn-primary w-full h-11 text-[13.5px]">Inscrever ${escapeHtml(t.name)}</button>`).join('')}
          ${leavable.map(t => `<button onclick="champLeave('${t.id}')" class="btn-outline w-full h-11 text-[13px]">Tirar ${escapeHtml(t.name)}</button>`).join('')}
          ${isOrg ? `<div class="grid grid-cols-2 gap-2"><button onclick="champStart()" class="btn-primary h-11 text-[13px]" ${c.teams.length < 3 ? 'disabled' : ''}>Começar</button><button onclick="champCancel()" class="btn-outline h-11 text-[13px] !text-danger">Cancelar</button></div>${c.teams.length < 3 ? '<p class="text-[12px] text-ink-2">Precisa de pelo menos 3 turmas pra começar.</p>' : '<p class="text-[12px] text-ink-2">Ao começar, ninguém mais entra e o app monta todos os jogos.</p>'}` : ''}
        </div>` : ''}
        <div><p class="section-tag">${c.status === 'inscricoes' ? 'Turmas inscritas' : 'Classificação'}</p>
          ${c.status === 'inscricoes' ? `<div class="space-y-1.5 mt-1.5">${c.teams.map(t => `<div class="flex items-center gap-2.5 rounded-xl bg-card border border-ink/10 p-2">${turmaTile(t.name, 'w-8 h-8')}<span class="text-[14px] font-bold truncate">${escapeHtml(t.name)}</span></div>`).join('')}</div>`
          : `<div class="overflow-x-auto mt-1.5"><table class="w-full text-[12.5px]"><thead><tr class="text-ink-3 text-[10.5px] uppercase"><th class="text-left font-bold py-1">Turma</th><th>P</th><th>J</th><th>V</th><th>E</th><th>D</th><th>SG</th></tr></thead><tbody>
            ${c.table.map((r, i) => `<tr class="border-t border-ink/[0.07] text-center"><td class="text-left py-2 font-bold"><span class="text-ink-3 mr-1">${i + 1}</span>${escapeHtml(r.name)}</td><td class="font-extrabold">${r.pts}</td><td>${r.j}</td><td>${r.v}</td><td>${r.e}</td><td>${r.d}</td><td>${r.sg > 0 ? '+' : ''}${r.sg}</td></tr>`).join('')}</tbody></table></div>`}</div>
        ${c.matches.length ? `<div><p class="section-tag">Jogos</p><div class="space-y-2 mt-1.5">${c.matches.map(m => matchCardHtml(m, mine)).join('')}</div></div>` : ''}`;
    }
    async function champJoin(tid) { try { await api.joinChampionship(champOpen, tid); showToast('Turma inscrita!'); openChamp(champOpen, true); } catch (e) { showToast(hubErr(e), 'warning'); } }
    async function champLeave(tid) { try { await api.leaveChampionship(champOpen, tid); showToast('Turma retirada.'); openChamp(champOpen, true); } catch (e) { showToast(hubErr(e), 'warning'); } }
    async function champStart() {
      if (!(await askConfirm('Começar o campeonato? Ninguém mais entra e os jogos são montados agora.', 'Começar'))) return;
      try { const n = await api.startChampionship(champOpen); showToast(`Campeonato começou: ${n} jogos.`); openChamp(champOpen, true); if (exploreState) loadExplore(); } catch (e) { showToast(hubErr(e), 'warning'); }
    }
    async function champCancel() {
      if (!(await askConfirm('Cancelar o campeonato? Os jogos que faltam são cancelados.', 'Cancelar campeonato'))) return;
      try { await api.cancelChampionship(champOpen); showToast('Campeonato cancelado.'); closeChamp(); if (exploreState) loadExplore(); } catch (e) { showToast(hubErr(e), 'warning'); }
    }

    /* ---- Entry points: turma editor card and Home ---- */
    function renderTurmaHubCard() {
      const box = document.getElementById('turma-edit-hub');
      if (!box) return;
      const t = turmaById(editingTurmaId);
      if (!t || !t.cloud || hubOff === true || !cloudOn()) { box.classList.add('hidden'); box.innerHTML = ''; return; }
      box.classList.remove('hidden');
      box.innerHTML = `
        <button onclick="openTurmaHub('${t.id}')" class="w-full flex items-center gap-3 text-left">
          <span class="tile w-9 h-9 rounded-xl bg-butter text-pitch text-[14px] flex-shrink-0"><i class="fa-solid fa-ranking-star"></i></span>
          <span class="flex-1 min-w-0"><span class="block text-[14.5px] font-extrabold">Ranking, troféus e desafios</span><span class="block text-[12px] text-ink-2">Top 10 e Top 26, prestígio e jogos contra outras turmas</span></span>
          <i class="fa-solid fa-chevron-right text-[12px] text-ink-3"></i>
        </button>`;
    }
    function renderHomeExplore() {
      const box = document.getElementById('home-explore');
      if (!box) return;
      if (!cloudOn() || hubOff === true || !state.turmas.some(t => t.cloud)) { box.innerHTML = ''; return; }
      box.innerHTML = `
        <button onclick="openExplore('turmas')" class="card w-full p-3.5 flex items-center gap-3 text-left active:scale-[0.99] transition">
          <span class="tile bg-pitch text-butter flex-shrink-0"><i class="fa-solid fa-earth-americas"></i></span>
          <span class="min-w-0 flex-1"><span class="block text-[15px] font-extrabold">Explorar turmas</span><span class="block text-[12.5px] text-ink-2 leading-snug">Ranking de prestígio, desafios no mural e campeonatos</span></span>
          <i class="fa-solid fa-chevron-right text-[12px] text-ink-3"></i>
        </button>`;
    }

    /* Today's list for the turmas of the day (for "Marcou que vem" on the arrival list). */
    function todaysEvent() {
      const today = new Date().toDateString();
      return eventsCache.filter(e => e.status !== 'canceled' && state.selectedTeams.includes(e.turma_id) && new Date(e.starts_at).toDateString() === today)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] || null;
    }
    function arrivalTag(p) {
      const e = todaysEvent();
      if (!e) return '';
      const r = rsvpOf(e, keyOf(p.name));
      if (!r) return '';
      if (r.outcome) return `<span class="ev-tag ${r.outcome === 'miou' ? 'bg-danger/10 text-danger' : 'bg-leaf/10 text-leaf'}">${r.outcome === 'miou' ? 'Miou' : r.outcome === 'cumpriu' ? 'Cumpriu' : 'Justificou'}</span>`;
      if (r.status === 'vou') return `<span class="ev-tag bg-leaf/10 text-leaf">Marcou que vem</span>`;
      if (r.status === 'talvez') return '<span class="ev-tag bg-butter text-pitch">Talvez</span>';
      return '<span class="ev-tag bg-sunk text-ink-2">Disse que não vem</span>';
    }

    /* Pop-up: a list you haven't answered. */
    function pendingListPopup() {
      const e = eventsCache.filter(evUpcoming).sort((a, b) => a.starts_at.localeCompare(b.starts_at)).find(x => {
        const me = myPlayerIn(x.turma_id);
        return me && x.created_by !== currentUser.id && !rsvpOf(x, me.key) && !lsGet('baba_ev_seen_' + x.id);
      });
      if (!e) return null;
      const creator = peopleCache.get(e.created_by) || (evTurma(e).people || []).find(p => p.id === e.created_by);
      return {
        img: 'coach', eyebrow: `Lista · ${evTurma(e).name}`, title: `${creator ? firstName(creator.name) : 'O adm'} puxou a lista!`,
        html: `<p class="text-[16px] font-extrabold">${escapeHtml(evWhen(e, true))}</p>${e.place ? `<p class="text-[14px] text-ink-2">${escapeHtml(e.place)}</p>` : ''}
          <p class="text-[13px] text-ink-2 mt-1">${evLines(e).vou.length} já confirmaram${e.max_players ? ` · ${e.max_players} vagas` : ''}. Bora?</p>
          <div class="grid grid-cols-3 gap-1.5 mt-3">
            <button onclick="closePopup(); answerEvent('${e.id}', 'vou')" class="ev-ans h-12 is-on ev-vou">Vou</button>
            <button onclick="closePopup(); answerEvent('${e.id}', 'talvez')" class="ev-ans h-12">Talvez</button>
            <button onclick="closePopup(); answerEvent('${e.id}', 'nao')" class="ev-ans h-12">Não vou</button>
          </div>`,
        ok: 'Depois', onClose: () => lsSet('baba_ev_seen_' + e.id, '1')
      };
    }

    /* Chat card for ":ev:<id>:" */
    const eventIdOf = body => { const m = /^:ev:([0-9a-f-]{36}):$/.exec(String(body || '').trim()); return m ? m[1] : null; };
    function chatEventCard(id) {
      const e = eventsCache.find(x => x.id === id);
      if (!e) return `<div class="chat-bubble"><i class="fa-solid fa-clipboard-list text-pitch"></i> Lista do próximo baba ${eventsOff ? '' : '<span class="text-ink-3">(carregando...)</span>'}</div>`;
      const me = myPlayerIn(e.turma_id);
      const mine = me ? rsvpOf(e, me.key) : null;
      const L = evLines(e);
      const open = evUpcoming(e);
      return `
        <div class="ev-chat">
          <button onclick="openEventSheet('${e.id}')" class="block w-full text-left">
            <p class="text-[11px] font-extrabold uppercase tracking-wider text-pitch"><i class="fa-solid fa-clipboard-list"></i> Lista puxada</p>
            <p class="text-[15px] font-extrabold leading-tight mt-0.5">${escapeHtml(evWhen(e))}</p>
            ${e.place ? `<p class="text-[12.5px] text-ink-2 truncate">${escapeHtml(e.place)}</p>` : ''}
            <p class="text-[12.5px] font-bold mt-1">${e.status === 'canceled' ? 'Cancelada' : e.status === 'done' ? 'Presença fechada' : `${L.vou.length}${e.max_players ? `/${e.max_players}` : ''} vão${L.talvez.length ? ` · ${L.talvez.length} talvez` : ''}`}</p>
          </button>
          ${open && me ? `<div class="grid grid-cols-2 gap-1.5 mt-2">
            <button onclick="answerEvent('${e.id}', 'vou')" class="ev-ans h-9 ${mine && mine.status === 'vou' ? 'is-on ev-vou' : ''}">Vou</button>
            <button onclick="answerEvent('${e.id}', 'nao')" class="ev-ans h-9 ${mine && mine.status === 'nao' ? 'is-on ev-nao' : ''}">Não vou</button>
          </div>` : ''}
        </div>`;
    }

    /* ===================================================================
       CHAT (turma e jogo ao vivo)
       =================================================================== */
    async function ensurePeople(ids) {
      const missing = [...new Set(ids.filter(id => id && !peopleCache.has(id)))];
      if (!missing.length || !api.peopleCards) return;
      try { (await api.peopleCards(missing)).forEach(p => peopleCache.set(p.id, p)); } catch (e) {}
    }

    /* opts: { room, live: { code } | null, canModerate: () => bool, canPost: () => bool } */
    /* Chat emotes: Babinha stickers travel as ":bb:<pose>:" and show as a picture. */
    const STICKERS = ['siuu', 'aidentro', 'dancinha', 'champion', 'aura', 'ney', 'messi', 'arrogante', 'carretilha', 'bike', 'chute', 'calculante',
      'happy', 'wink', 'wave', 'run', 'side', 'coach', 'money', 'shhh', 'rezando', 'tired', 'worried', 'scared', 'red'];
    const CHAT_EMOJIS = ['⚽', '🥅', '🧤', '🔥', '💪', '👏', '🙌', '😂', '🤣', '😅', '😎', '🤩', '🥳', '😤', '😡', '😭', '😱', '🤯', '🫡', '🤝', '👊', '✌️', '🙏', '👀',
      '💯', '🏆', '🥇', '⭐', '✨', '⚡', '💥', '🎯', '🚀', '🧱', '🐐', '👑', '🍿', '🤡', '💀', '🫠', '🤌', '🤙', '👍', '👎', '❤️', '💚', '💛', '🟥'];
    const stickerOf = body => { const m = /^:bb:([a-z]+):$/.exec(String(body || '').trim()); return m && STICKERS.includes(m[1]) ? m[1] : null; };
    // Only emojis (up to 3): shown big, without the bubble.
    const bigEmoji = body => { const t = String(body || '').trim(); return t.length <= 16 && /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f|\s)+$/u.test(t) && !/^[\d#*\s]+$/.test(t) && [...t.replace(/\s/g, '')].filter(c => /\p{Extended_Pictographic}/u.test(c)).length <= 3; };
    function chatEmotePanel(tab) {
      return `
        <div class="seg grid-cols-2 mb-2">
          <button type="button" onclick="chatEmoteTab(this, 'bb')" class="seg-btn !py-1.5 ${tab === 'bb' ? 'is-selected' : ''}">Babinha</button>
          <button type="button" onclick="chatEmoteTab(this, 'em')" class="seg-btn !py-1.5 ${tab === 'em' ? 'is-selected' : ''}">Emojis</button>
        </div>
        ${tab === 'bb'
          ? `<div class="grid grid-cols-5 gap-1.5">${STICKERS.map(k => `<button type="button" onclick="chatSendSticker(this, '${k}')" class="aspect-square rounded-xl bg-card border border-ink/[0.07] p-1 active:scale-90 transition" aria-label="Babinha ${k}"><img src="babinha/${k}.webp" alt="" class="w-full h-full object-contain" loading="lazy" /></button>`).join('')}</div>`
          : `<div class="grid grid-cols-8 gap-1">${CHAT_EMOJIS.map(e => `<button type="button" onclick="chatAddEmoji(this, '${e}')" class="h-10 rounded-xl text-[22px] active:scale-90 transition">${e}</button>`).join('')}</div>`}`;
    }

    function mountChat(container, opts) {
      const msgs = new Map();
      let lastId = 0, stopRT = null, timer = null, open = null;
      container.innerHTML = `
        <div class="chat-list"><p class="text-[13px] text-ink-2 text-center py-6 chat-empty">Carregando...</p></div>
        ${opts.canPost() ? `<div class="chat-emotes hidden"></div><form class="chat-input" onsubmit="event.preventDefault();">
          <button type="button" onclick="chatToggleEmotes(this)" class="btn-icon !w-11 !h-11 !rounded-full flex-shrink-0" aria-label="Emotes"><i class="fa-solid fa-face-smile text-[16px]"></i></button>
          <input maxlength="500" class="field !py-2.5 !rounded-full" placeholder="Mensagem" enterkeyhint="send" autocomplete="off" />
          <button class="btn-primary w-11 h-11 flex-shrink-0" aria-label="Enviar"><i class="fa-solid fa-paper-plane"></i></button>
        </form>` : `<p class="chat-input text-[13px] text-ink-2 justify-center">${currentUser ? 'Aceite os termos para conversar.' : 'Entre na sua conta para conversar.'}</p>`}`;
      const list = container.querySelector('.chat-list');
      const form = container.querySelector('form');

      const render = () => {
        const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
        const rows = [...msgs.values()].sort((a, b) => a.id - b.id);
        if (!rows.length) { list.innerHTML = '<p class="text-[13px] text-ink-2 text-center py-6">Ninguém falou nada ainda. Puxa o assunto!</p>'; return; }
        let prev = null;
        list.innerHTML = rows.map(m => {
          const me = currentUser && m.user_id === currentUser.id;
          const who = peopleCache.get(m.user_id) || { name: m.name || (m.user_id ? '...' : 'Conta excluída'), avatar: m.avatar, cosmetics: m.cosmetics };
          const head = !me && (!prev || prev.user_id !== m.user_id);
          prev = m;
          const time = new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          const actions = open === m.id && !m.deleted ? `<div class="flex gap-1.5 mt-1 ${me ? 'justify-end' : ''}">
              ${!me ? `<button onclick="chatAction(this, 'report', ${m.id})" class="h-7 px-2.5 rounded-full bg-sunk text-[11px] font-bold">Denunciar</button>` : ''}
              ${me || opts.canModerate() ? `<button onclick="chatAction(this, 'delete', ${m.id})" class="h-7 px-2.5 rounded-full bg-danger/10 text-danger text-[11px] font-bold">Apagar</button>` : ''}
            </div>` : '';
          return `
            <div class="chat-msg ${me ? 'me' : ''}" data-id="${m.id}">
              ${me ? '' : `<div class="w-8 flex-shrink-0">${head ? (m.user_id ? `<button onclick="openAthleteCard('${m.user_id}')" aria-label="Card de ${escapeHtml(who.name || '')}">${framedAvatar(who.avatar, who.name, 'w-8 h-8 text-[11px]', who.cosmetics)}</button>` : framedAvatar(who.avatar, who.name, 'w-8 h-8 text-[11px]', who.cosmetics)) : ''}</div>`}
              <div class="min-w-0">
                ${head ? `<p class="chat-meta">${styledName(who.name || '?', who.cosmetics)}${titleChip(who.cosmetics, 'ml-1')}</p>` : ''}
                <div class="flex items-end gap-1 ${me ? 'flex-row-reverse' : ''}">
                  ${m.deleted ? '<div class="chat-bubble chat-del">Mensagem apagada</div>'
                    : eventIdOf(m.body) ? chatEventCard(eventIdOf(m.body))
                    : stickerOf(m.body) ? `<img src="babinha/${stickerOf(m.body)}.webp" alt="Babinha" class="chat-sticker" />`
                    : bigEmoji(m.body) ? `<div class="chat-jumbo">${escapeHtml(m.body)}</div>`
                    : `<div class="chat-bubble">${escapeHtml(m.body)}</div>`}
                  ${m.deleted ? '' : `<button onclick="chatToggle(this, ${m.id})" class="w-6 h-6 text-ink-3 text-[11px] flex-shrink-0" aria-label="Opções"><i class="fa-solid fa-ellipsis"></i></button>`}
                </div>
                <p class="text-[10px] text-ink-3 mt-0.5 ${me ? 'text-right' : ''}">${time}</p>
                ${actions}
              </div>
            </div>`;
        }).join('');
        if (nearBottom || !render.done) list.scrollTop = list.scrollHeight;
        render.done = true;
      };

      const merge = rows => {
        (rows || []).forEach(r => { msgs.set(r.id, Object.assign(msgs.get(r.id) || {}, r)); lastId = Math.max(lastId, r.id); });
      };
      const load = async (full) => {
        try {
          const rows = opts.live ? await api.liveChat(opts.live.code, full ? 0 : lastId) : await api.chatList(opts.room, full ? 0 : lastId);
          if (full) { msgs.clear(); lastId = 0; }
          merge(rows);
          if (!opts.live) await ensurePeople(rows.map(r => r.user_id));
          // A list card for a list this phone doesn't have yet: fetch the lists.
          if (rows.some(r => eventIdOf(r.body) && !eventsCache.some(e => e.id === eventIdOf(r.body)))) loadEvents(true);
          render();
        } catch (e) {
          if (!msgs.size) list.innerHTML = `<p class="text-[13px] text-ink-2 text-center py-6">${isNetworkError(e) ? 'O chat precisa de internet.' : 'Não consegui abrir o chat.'}</p>`;
        }
      };
      const send = async body => {
        await api.chatSend(opts.room, body);
        await load();
      };
      container.__chat = { reload: () => load(true), toggle: id => { open = open === id ? null : id; render(); }, send, repaint: () => render() };

      if (form) {
        const input = form.querySelector('input');
        form.addEventListener('submit', async () => {
          const body = input.value.trim();
          if (!body) return;
          input.value = '';
          try {
            await api.chatSend(opts.room, body);
            await load();
          } catch (e) {
            input.value = body;
            const m = String((e && e.message) || '');
            showToast(isNetworkError(e) ? 'Sem internet: a mensagem não foi.' : m.includes('slow_down') ? 'Calma, craque: espera uns segundinhos.' : 'Não consegui mandar a mensagem.', 'warning');
          }
        });
      }

      load(true);
      if (!opts.live && api.subscribe) stopRT = api.subscribe(opts.room, () => load());
      timer = setInterval(() => load(), opts.live ? 3000 : 8000);
      return { destroy() { clearInterval(timer); if (stopRT) stopRT(); }, reload: () => load(true) };
    }

    function chatToggle(btn, id) { const box = btn.closest('.chat-box'); if (box && box.__chat) box.__chat.toggle(id); }
    function chatToggleEmotes(btn) {
      const box = btn.closest('.chat-box');
      const panel = box && box.querySelector('.chat-emotes');
      if (!panel) return;
      const show = panel.classList.contains('hidden');
      if (show && !panel.innerHTML) panel.innerHTML = chatEmotePanel('bb');
      panel.classList.toggle('hidden', !show);
    }
    function chatEmoteTab(btn, tab) { const panel = btn.closest('.chat-emotes'); if (panel) panel.innerHTML = chatEmotePanel(tab); }
    function chatAddEmoji(btn, e) {
      const input = btn.closest('.chat-box').querySelector('.chat-input input');
      if (!input) return;
      input.value = (input.value + e).slice(0, 500);
    }
    async function chatSendSticker(btn, k) {
      const box = btn.closest('.chat-box');
      if (!box || !box.__chat) return;
      box.querySelector('.chat-emotes').classList.add('hidden');
      try { await box.__chat.send(`:bb:${k}:`); }
      catch (e) {
        const m = String((e && e.message) || '');
        showToast(isNetworkError(e) ? 'Sem internet: o Babinha não foi.' : m.includes('slow_down') ? 'Calma, craque: espera uns segundinhos.' : 'Não consegui mandar.', 'warning');
      }
    }
    async function chatAction(btn, kind, id) {
      const box = btn.closest('.chat-box');
      if (kind === 'report') {
        if (!(await askConfirm('Denunciar esta mensagem? Com 3 denúncias ela some até alguém revisar.', 'Denunciar'))) return;
        try { await api.chatReport(id, 'denuncia'); showToast('Denúncia enviada. Valeu por ajudar.'); } catch (e) { showToast('Não consegui denunciar agora.', 'warning'); }
      } else {
        if (!(await askConfirm('Apagar esta mensagem para todo mundo?', 'Apagar'))) return;
        try { await api.chatDelete(id); showToast('Mensagem apagada.'); } catch (e) { showToast('Não consegui apagar.', 'warning'); }
      }
      if (box && box.__chat) box.__chat.reload();
    }

    function mountLiveChat() {
      if (!liveView || !liveView.data) return;
      const d = liveView.data;
      if (liveView.chat) liveView.chat.destroy();
      liveView.chat = mountChat(document.getElementById('lv-chat'), {
        room: 'live:' + d.id,
        live: { code: liveView.code },
        canPost: () => !!(currentUser && termsAcceptedHere()),
        canModerate: () => !!d.is_owner
      });
    }

    /* ---- Chat da turma ---- */
    let turmaChat = null;
    function openTurmaChat(turmaId) {
      const t = turmaById(turmaId) || state.turmas.find(x => x.cloud);
      if (!t || !t.cloud) { showToast('O chat é das turmas na nuvem.', 'warning'); return; }
      if (v7 !== true) { showToast('O chat chega quando o servidor for atualizado.', 'warning'); return; }
      closeDatabaseModal();
      document.getElementById('chat-title').innerText = `Chat · ${t.name}`;
      document.getElementById('page-chat').classList.remove('hidden');
      pushPage('page-chat');
      if (turmaChat) turmaChat.destroy();
      turmaChat = mountChat(document.getElementById('chat-turma'), {
        room: 'turma:' + t.id, live: null,
        canPost: () => termsAcceptedHere(),
        canModerate: () => canEditTurma(turmaById(t.id))
      });
    }
    function closeTurmaChat() {
      if (turmaChat) { turmaChat.destroy(); turmaChat = null; }
      document.getElementById('page-chat').classList.add('hidden');
      popPage('page-chat');
    }

    /* ---- Início: ao vivo agora + pontos ---- */
    let liveListCache = [];
    async function loadLiveList() {
      if (!cloudOn() || v7 !== true) { liveListCache = []; return; }
      try {
        const rows = await api.liveList();
        const fresh = Date.now() - 3 * 3600 * 1000;
        liveListCache = (rows || []).filter(r => new Date(r.updated_at).getTime() > fresh && !(state.live && r.id === state.live.id));
      } catch (e) {}
      renderHomeV7();
    }

    /* Babinha: the mascot reacts to what is happening and says one thing at a time. */
    function homeBabinhaMood() {
      const present = presentPlayers().length;
      const { A, B } = state.court;
      const hasCourt = !!(A && B);
      const ev = typeof todaysEvent === 'function' ? todaysEvent() : null;
      const hr = new Date().getHours();
      if (hasCourt && state.match.running) {
        const d = state.match.scoreA - state.match.scoreB;
        if (!d) return ['run', 'Tá empatado! Bola rolando.'];
        return d > 0 ? ['siuu', `Time ${A.label} na frente!`] : ['siuu', `Time ${B.label} na frente!`];
      }
      if (hasCourt) return ['coach', `Time ${A.label} × Time ${B.label} esperando o apito.`];
      if (!state.players.length) return ['wave', 'Escolhe a turma em Turmas e bora montar o baba.'];
      if (!present) return ev ? ['happy', 'Tem baba hoje! Marca quem chegou na lista.'] : ['wink', 'Ninguém chegou ainda. Respira que a bola vai rolar.'];
      if (present < 4) return ['worried', `Só ${present} na quadra. Falta gente!`];
      if (hr >= 23 || hr < 5) return ['tired', 'Já é tarde, hein? Último jogo?'];
      return ['happy', `${present} na quadra. Dá pra montar os times!`];
    }
    function renderHomeBabinha() {
      const box = document.getElementById('home-babinha');
      if (!box) return;
      const [img, msg] = homeBabinhaMood();
      box.innerHTML = `<div class="flex items-center gap-3"><img src="babinha/${img}.webp" alt="" class="w-16 h-16 object-contain flex-shrink-0 babinha-bob" /><p class="flex-1 min-w-0 rounded-2xl rounded-bl-sm bg-card border border-ink/[0.07] px-3.5 py-2.5 text-[13.5px] font-semibold leading-snug">${escapeHtml(msg)}</p></div>`;
    }
    let batteryInfo = null;
    function renderBattery() {
      const box = document.getElementById('home-battery');
      if (!box) return;
      if (!batteryInfo) {
        if (navigator.getBattery && !renderBattery.asked) {
          renderBattery.asked = true;
          navigator.getBattery().then(b => { batteryInfo = b; ['levelchange', 'chargingchange'].forEach(e => b.addEventListener(e, renderBattery)); renderBattery(); }).catch(() => {});
        }
        box.innerHTML = '';
        return;
      }
      const pct = Math.round(batteryInfo.level * 100);
      const icon = batteryInfo.charging ? 'fa-bolt' : pct > 75 ? 'fa-battery-full' : pct > 40 ? 'fa-battery-half' : pct > 15 ? 'fa-battery-quarter' : 'fa-battery-empty';
      box.innerHTML = `<span class="weather-chip ${pct <= 15 && !batteryInfo.charging ? 'text-danger' : 'text-ink-2'}"><i class="fa-solid ${icon}"></i> ${pct}%</span>`;
    }

    function renderHomeV7() {
      const box = document.getElementById('home-v7');
      if (!box) return;
      const tut = tutorialCardHtml();
      if (!(v7 === true && cloudOn())) { box.innerHTML = tut ? `<section class="space-y-2.5">${tut}</section>` : ''; return; }
      const lives = liveListCache.map(l => `
        <button onclick="openLive('${escapeHtml(l.code)}')" class="card w-full p-3.5 flex items-center gap-3 text-left">
          <span class="tile bg-pitch text-butter"><span class="live-dot"></span></span>
          <span class="min-w-0 flex-1"><span class="block text-[15px] font-bold truncate">${escapeHtml(l.title || 'Baba ao vivo')}</span><span class="block text-[12.5px] text-ink-2">Ao vivo agora · toque pra assistir e palpitar</span></span>
          <i class="fa-solid fa-chevron-right text-[12px] text-ink-3"></i>
        </button>`).join('');
      const pts = wallet ? `
        <button onclick="openShop()" class="card w-full p-3.5 flex items-center gap-3 text-left">
          <img src="babinha/money.webp" alt="" class="w-11 h-11 object-contain flex-shrink-0" />
          <span class="min-w-0 flex-1"><span class="block text-[15px] font-bold">${fmtPts(wallet.balance)} baba points</span><span class="block text-[12.5px] text-ink-2">${missionsReady() ? `${missionsReady()} missão${missionsReady() > 1 ? 'ões' : ''} pronta${missionsReady() > 1 ? 's' : ''} pra resgatar` : wallet.daily ? 'Bônus do dia esperando · missões da semana' : missionsCache && missionsCache.length ? 'Missões da semana e lojinha' : 'Molduras e nomes na lojinha'}</span></span>
          ${missionsReady() ? `<span class="text-[11px] font-extrabold bg-butter text-pitch rounded-full px-2 py-1">${missionsReady()}</span>` : wallet.daily ? '<span class="text-[11px] font-extrabold bg-butter text-pitch rounded-full px-2 py-1">+100</span>' : '<i class="fa-solid fa-chevron-right text-[12px] text-ink-3"></i>'}
        </button>` : '';
      const st = status8 || {};
      const banned = st.bannedUntil ? `
        <div class="card w-full p-3.5 flex items-start gap-3 border-danger/30">
          <img src="babinha/red.webp" alt="" class="w-11 h-11 object-contain flex-shrink-0" />
          <span class="min-w-0 flex-1"><span class="block text-[15px] font-bold text-danger">Conta suspensa ${/^infinity$/i.test(String(st.bannedUntil)) || new Date(st.bannedUntil).getFullYear() > 9000 ? 'por tempo indeterminado' : 'até ' + new Date(st.bannedUntil).toLocaleString('pt-BR', Object.assign({ day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }, new Date(st.bannedUntil).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}))}</span><span class="block text-[12.5px] text-ink-2">Chat, palpites e jogo ao vivo estão bloqueados.${st.bannedReason ? ' Motivo: ' + escapeHtml(st.bannedReason) + '.' : ''} Dúvidas: ${CONTACT_EMAIL}</span></span>
        </div>` : '';
      const notice = st.notice && lsGet('baba_notice_seen_v1') !== st.notice ? `
        <div class="card w-full p-3.5 flex items-start gap-3 ${st.noticeLevel === 'warning' ? 'border-warn/40' : ''}">
          <span class="tile ${st.noticeLevel === 'warning' ? 'bg-warn/15 text-warn' : 'bg-sage text-pitch'}"><i class="fa-solid ${st.noticeLevel === 'warning' ? 'fa-triangle-exclamation' : 'fa-bullhorn'}"></i></span>
          <span class="min-w-0 flex-1"><span class="block text-[12px] font-bold uppercase tracking-wider text-ink-2">Aviso da equipe BABA</span><span class="block text-[14px] font-semibold mt-0.5">${escapeHtml(st.notice)}</span></span>
          <button onclick="dismissNotice()" class="btn-icon" aria-label="Fechar aviso"><i class="fa-solid fa-xmark"></i></button>
        </div>` : '';
      const staff = st.staff ? `
        <a href="admin.html" class="card w-full p-3.5 flex items-center gap-3 text-left">
          <span class="tile bg-pitch text-butter"><i class="fa-solid fa-user-shield"></i></span>
          <span class="min-w-0 flex-1"><span class="block text-[15px] font-bold">Painel de suporte</span><span class="block text-[12.5px] text-ink-2">Conta de suporte · tudo liberado</span></span>
          <i class="fa-solid fa-arrow-up-right-from-square text-[12px] text-ink-3"></i>
        </a>` : '';
      const watch = `
        <button onclick="openWatch()" class="card w-full p-3.5 flex items-center gap-3 text-left">
          <span class="tile bg-sage text-pitch"><i class="fa-solid fa-tower-broadcast"></i></span>
          <span class="min-w-0 flex-1"><span class="block text-[15px] font-bold">Assistir um jogo ao vivo</span><span class="block text-[12.5px] text-ink-2">Tem o código de um baba? Digite aqui</span></span>
          <i class="fa-solid fa-chevron-right text-[12px] text-ink-3"></i>
        </button>`;
      const all = banned + notice + staff + tut + lives + watch;
      box.innerHTML = all ? `<section class="space-y-2.5">${all}</section>` : '';
    }

    /* ===================================================================
       HELPERS
       =================================================================== */
    const lineSize = () => Math.min(12, Math.max(1, Number(state.match.lineSize) || 4));
    const keeperMode = () => KEEPER_MODES[state.settings.keeperMode] ? state.settings.keeperMode : 'time';
    const teamSize = () => lineSize() + (keeperMode() === 'time' ? 1 : 0);
    const formatLabel = () => `${lineSize()}v${lineSize()} · ${KEEPER_MODES[keeperMode()]}`;
    // Titles follow the player: artilheiro/artilheira, garçom/garçonete, paredão/paredona.
    const TITLES = { goals: ['Artilheiro', 'Artilheira'], assists: ['Garçom', 'Garçonete'], saves: ['Paredão', 'Paredona'] };
    const titleFor = (k, p) => TITLES[k][p && p.female ? 1 : 0];
    // Goalkeepers apart from the teams (fixed or from the line).
    const fixedKeepers = () => keeperMode() === 'fixo' || keeperMode() === 'fila';
    const keeperFromQueue = () => keeperMode() === 'fila';
    const isFixedKeeper = p => !!(p && p.isGoalkeeper && keeperMode() === 'fixo');
    // "Goleiro da fila": the first two waiting go in goal (A, B) and keep their place in line.
    const queueKeepers = () => keeperFromQueue() ? state.queue.slice(0, 2) : [];
    const fixedKeeperList = () => fixedKeepers() && !keeperFromQueue() ? state.players.filter(p => p.present && p.isGoalkeeper).sort((a, b) => (a.arrival || 0) - (b.arrival || 0)) : [];
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
        if (!p || !p.present || seen.has(id) || isFixedKeeper(p)) return false;
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
        .filter(p => p.present && !seen.has(p.id) && !isFixedKeeper(p))
        .sort((a, b) => (a.arrival || 0) - (b.arrival || 0))
        .forEach(p => { seen.add(p.id); state.queue.push(p.id); });
      // Option: whoever has played less goes first (ties keep the current order).
      if (state.settings.queueOrder === 'menos-jogos') {
        const pos = new Map(state.queue.map((id, i) => [id, i]));
        const games = id => (known.get(id) || {}).matches || 0;
        state.queue.sort((a, b) => games(a) - games(b) || pos.get(a) - pos.get(b));
      }
    }

    function buzz(pattern) {
      if (!prefs.vibrate) return;
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
      if (!prefs.sound) return;
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
      repair();
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
      renderLivePill();
      renderHomeV7();
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

    /* ===================================================================
       DIA, HORA E CLIMA (Início)
       The weather comes from Open-Meteo (free, no account) using the phone's
       location, only after the person taps to allow it. The rounded position
       stays on this phone.
       =================================================================== */
    const WEATHER_KEY = 'baba_weather_v1';
    const WMO = [
      [[0], 'Céu limpo', 'fa-sun', 'fa-moon'], [[1, 2], 'Poucas nuvens', 'fa-cloud-sun', 'fa-cloud-moon'], [[3], 'Nublado', 'fa-cloud', 'fa-cloud'],
      [[45, 48], 'Neblina', 'fa-smog', 'fa-smog'], [[51, 53, 55, 56, 57], 'Garoa', 'fa-cloud-rain', 'fa-cloud-rain'],
      [[61, 63, 65, 66, 67], 'Chuva', 'fa-cloud-showers-heavy', 'fa-cloud-showers-heavy'], [[71, 73, 75, 77, 85, 86], 'Neve', 'fa-snowflake', 'fa-snowflake'],
      [[80, 81, 82], 'Pancadas de chuva', 'fa-cloud-showers-heavy', 'fa-cloud-showers-heavy'], [[95, 96, 99], 'Trovoada', 'fa-cloud-bolt', 'fa-cloud-bolt']
    ];
    let weatherBusy = false;
    const readWeather = () => { try { return JSON.parse(lsGet(WEATHER_KEY) || 'null'); } catch (e) { return null; } };
    function renderClock() {
      const now = new Date();
      const dateTxt = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
      const el = document.getElementById('home-date');
      if (el) el.innerText = `${dateTxt.charAt(0).toUpperCase() + dateTxt.slice(1)} · ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    }
    function renderWeather() {
      const box = document.getElementById('home-weather');
      if (!box) return;
      const w = readWeather();
      if (!w || !w.lat) {
        box.innerHTML = `<button onclick="askWeather()" class="weather-chip"><i class="fa-solid fa-cloud-sun text-pitch"></i> Ver o clima</button>`;
        return;
      }
      if (w.denied) {
        box.innerHTML = `<button onclick="askWeather()" class="weather-chip text-ink-2"><i class="fa-solid fa-location-crosshairs"></i> Clima sem localização</button>`;
        return;
      }
      if (w.temp == null) { box.innerHTML = `<span class="weather-chip text-ink-2"><i class="fa-solid fa-spinner fa-spin"></i> Clima</span>`; return; }
      const row = WMO.find(r => r[0].includes(w.code)) || WMO[2];
      const rain = w.rain != null && w.rain >= 20 ? ` · <i class="fa-solid fa-umbrella text-[11px]"></i> ${w.rain}%` : '';
      box.innerHTML = `<button onclick="refreshWeather(true)" class="weather-chip" title="${escapeHtml(row[1])} · atualizado ${new Date(w.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}" aria-label="${escapeHtml(`${Math.round(w.temp)} graus, ${row[1]}`)}"><i class="fa-solid ${w.isDay === 0 ? row[3] : row[2]} text-pitch"></i> ${Math.round(w.temp)}° <span class="font-semibold text-ink-2">${escapeHtml(row[1])}${rain}</span></button>`;
    }
    function askWeather() {
      if (!navigator.geolocation) { showToast('Este celular não informa a localização.', 'warning'); return; }
      showToast('Pra mostrar o clima daí, o BABA pede sua localização. Ela fica só no celular.');
      navigator.geolocation.getCurrentPosition(pos => {
        const lat = Math.round(pos.coords.latitude * 100) / 100, lon = Math.round(pos.coords.longitude * 100) / 100;
        lsSet(WEATHER_KEY, JSON.stringify({ lat, lon, at: 0 }));
        renderWeather();
        refreshWeather(true);
      }, () => {
        lsSet(WEATHER_KEY, JSON.stringify({ lat: 1, denied: true }));
        renderWeather();
        showToast('Sem a localização não dá pra ver o clima. Dá pra liberar nas configurações do navegador.', 'warning');
      }, { maximumAge: 30 * 60000, timeout: 15000 });
    }
    async function refreshWeather(force) {
      const w = readWeather();
      if (!w || !w.lat || w.denied || weatherBusy) { if (w && w.denied && force) askWeather(); return; }
      if (!force && w.at && Date.now() - w.at < 20 * 60000) return;
      if (navigator.onLine === false) return;
      weatherBusy = true;
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${w.lat}&longitude=${w.lon}&current=temperature_2m,weather_code,is_day&hourly=precipitation_probability&forecast_hours=2&timezone=auto`;
        const res = await fetch(url);
        const d = await res.json();
        if (d && d.current) {
          const rain = d.hourly && Array.isArray(d.hourly.precipitation_probability) ? Math.max(...d.hourly.precipitation_probability.filter(x => x != null)) : null;
          lsSet(WEATHER_KEY, JSON.stringify({ lat: w.lat, lon: w.lon, at: Date.now(), temp: d.current.temperature_2m, code: d.current.weather_code, isDay: d.current.is_day, rain: isFinite(rain) ? rain : null }));
        }
      } catch (e) {}
      weatherBusy = false;
      renderWeather();
    }

    function renderHome() {
      renderClock();
      renderHomeEvents();
      renderWeather();
      renderBattery();
      refreshWeather(false);
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

      renderHomeBabinha();

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
      if (g) rows.push(row('bg-butter text-pitch', 'fa-futbol', titleFor('goals', g), escapeHtml(g.name), g.goals, g.goals === 1 ? 'gol' : 'gols'));
      if (a) rows.push(row('bg-sage text-pitch', 'fa-handshake', titleFor('assists', a), escapeHtml(a.name), a.assists, 'assist.'));
      if (s) rows.push(row('bg-sunk text-pitch', 'fa-hand', titleFor('saves', s), escapeHtml(s.name), s.saves, 'def.'));
      const last = state.matchHistory[0];
      rows.push(row('bg-pitch text-butter', 'fa-flag-checkered', 'Partidas jogadas',
        last ? `Última: Time ${last.labelA} ${last.scoreA} × ${last.scoreB} Time ${last.labelB}` : 'Nenhuma finalizada ainda', state.matchHistory.length, ''));
      if (!g && !a && !s) rows.unshift(`<div class="flex items-center gap-3 px-1"><img src="babinha/tired.webp" alt="" class="w-14 h-14 object-contain flex-shrink-0" /><p class="text-[13px] text-ink-2 leading-snug">Tá parado por aqui... Os destaques do dia (gols, passes e defesas) aparecem depois do primeiro gol.</p></div>`);
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
          ${mine.live ? '<p class="text-[12px] text-ink-2 mt-2 px-1 flex items-center gap-1.5"><span class="live-dot"></span> Inclui o baba que está rolando agora.</p>'
            : !mine.babas ? '<p class="text-[12px] text-ink-2 mt-2 px-1">Seus números entram assim que quem organiza marcar seus jogos e gols.</p>' : ''}
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
              ${avatarHtml(t.icon, t.name, '!rounded-xl w-10 h-10 text-[14px]')}
              <div class="min-w-0">
                <div class="font-bold text-[15px] truncate">${escapeHtml(t.name)}</div>
                <div class="text-[12px] text-ink-2">${t.cloud ? `${ROLE_LABEL[t.role] || 'Membro'} · ` : ''}${t.players.length} atleta${t.players.length === 1 ? '' : 's'}${t.keepers.length ? ` · ${t.keepers.length} goleiro${t.keepers.length === 1 ? '' : 's'}` : ''}</div>
              </div>
            </label>
            ${t.cloud && v7 === true ? `<button onclick="openTurmaChat('${t.id}')" class="btn-icon" aria-label="Chat da turma"><i class="fa-solid fa-comments"></i></button>` : ''}
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
        female: !!(t && (t.women || []).some(k => sameName(k, name))), jumped: false,
        goals: 0, assists: 0, saves: 0, matches: 0, wins: 0, penGoals: 0, penMisses: 0, penSaves: 0,
        present: false, arrival: null, arrivedAt: null, turmaId: turmaId || null
      };
    }

    /* Rebuilds today's pool from the selected turmas, keeping everyone's
       stats and presence. Players no longer in a selected turma stay only
       if they are convidados, already here, or already have stats today. */
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

    const canEditTurma = t => !!t && (!t.cloud || t.role === 'owner' || t.role === 'admin');
    // Before the server knew about owners, admins could delete: keep that until it says otherwise.
    const ownsTurma = t => !!t && (!t.cloud || t.role === 'owner' || (t.role === 'admin' && schemaV2 !== true));

    function createTurma() {
      const t = { id: uuid(), name: 'Nova turma', official: false, cloud: cloudOn(), role: 'owner', invite: null, players: [], keepers: [], meta: {} };
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
      turmaTab('atletas');
      if (t.cloud) loadTurmaPeople(id);
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

      document.getElementById('turma-edit-title').innerText = t.name.trim() || (admin ? 'Editar turma' : 'Turma');
      document.getElementById('turma-edit-role').innerText = !t.cloud ? 'Só neste aparelho' : t.role === 'owner' ? 'Você é o dono' : t.role === 'admin' ? 'Você é adm' : 'Você é membro';
      document.getElementById('turma-edit-addbox').classList.toggle('hidden', !admin);
      document.getElementById('turma-edit-delete').innerText = ownsTurma(t) ? 'Excluir turma' : 'Sair da turma';
      const hist = t.cloud ? state.pastDays.filter(d => (d.turmaIds || []).includes(t.id)).length : 0;
      document.getElementById('turma-edit-history').classList.toggle('hidden', !t.cloud);
      renderTurmaEvents();
      renderTurmaHubCard();
      document.getElementById('turma-edit-history-sub').innerText = hist ? `${hist} baba${hist === 1 ? '' : 's'} encerrado${hist === 1 ? '' : 's'} · todo mundo da turma vê` : 'Nenhum encerrado ainda';
      paintAvatar(document.getElementById('turma-edit-icon-img'), t.icon, t.name);
      document.getElementById('turma-edit-icon-cam').classList.toggle('hidden', !admin);
      document.getElementById('turma-tabs').classList.toggle('hidden', !t.cloud || schemaV2 === false);
      if (turmaPane === 'pessoas') renderTurmaPeople();

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
      document.getElementById('turma-edit-title').innerText = t.name.trim() || 'Editar turma';
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
      const admin = ownsTurma(t);
      const msg = admin
        ? `Excluir a turma ${t.name}${t.cloud ? ' para todo mundo' : ''}? Os atletas que já chegaram hoje continuam no baba.${t.cloud && (t.people || []).length > 1 ? ' Se quiser só sair, passe a turma pra outra pessoa em "Pessoas e cargos".' : ''}`
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
      state.match.lineSize = Math.min(12, Math.max(1, Number(val) || 4));
      applyFormatChange('Jogo');
    }
    function updateKeeperMode(val) {
      state.settings.keeperMode = KEEPER_MODES[val] ? val : 'time';
      applyFormatChange('Goleiro');
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
      if (!state.firstKickoffAt) state.firstKickoffAt = Date.now();
      const fresh = !state.match.events.length && state.match.secondsLeft >= (state.match.initialSeconds || 420) + (state.match.addedSeconds || 0);
      saveState();
      prefetchCourtPeople();
      // The first kick-off of the day opens the live game and shows its QR code.
      if (!state.live && !state.liveAsked && v7 === true && cloudOn() && state.court.A && state.court.B) {
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
        el: playedSeconds(),
        scorerId: scorer ? scorer.id : null,
        assistId: assist ? assist.id : null,
        time: fmtMMSS(Math.max(0, state.match.secondsLeft)),
        text: `⚽ Gol do Time ${team.label}: ${scorer ? scorer.name : '?'}${assist ? ` (passe de ${assist.name})` : ''}`
      });

      const side = selectedGoalSide;
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
      saveState();
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
      keeper.saves = (keeper.saves || 0) + 1;
      state.match.events.unshift({
        type: 'save',
        side: selectedSaveSide,
        el: playedSeconds(),
        keeperId: keeper.id,
        time: fmtMMSS(Math.max(0, state.match.secondsLeft)),
        text: `🧤 Defesa do Time ${team.label}: ${keeper.name}`
      });
      buzz(40);
      commit(`🧤 Defesa de ${keeper.name}!`);
      livePush('save', `save-${state.matchHistory.length + 1}-${state.match.events.length}`, `🧤 Defesa de ${keeper.name}`, `Time ${team.label} · aos ${playedClock()} · ${scoreLine()}`);
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

    async function finishMatchAndNextChallenger(auto, pens) {
      if (finishing) return;
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
              <span class="font-bold text-ink text-right">Time ${h.labelA} <b class="font-serif font-normal text-[22px] leading-none text-pitch mx-1">${h.scoreA} × ${h.scoreB}</b> Time ${h.labelB}${h.pens ? `<span class="block text-[11px] font-bold text-ink-2">pênaltis ${h.pens.a} × ${h.pens.b}</span>` : ''}</span>
            </div>
            ${(h.namesA && h.namesA.length) ? `<p class="text-[11px] text-ink-2 mt-1 leading-snug">${escapeHtml(shortNames(h.namesA))} <span class="text-ink-3">vs</span> ${escapeHtml(shortNames(h.namesB))}</p>` : ''}
            ${gameLinesHtml(h)}
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
          q(p.name), q(t ? t.name : 'Convidado'), q(p.isGoalkeeper ? 'Goleiro' : 'Linha'),
          q(p.present ? `${arrivalRank(p.id)}º ${fmtClock(p.arrivedAt)}`.trim() : ''),
          p.goals || 0, p.assists || 0, p.saves || 0, p.matches || 0, p.wins || 0,
          q(p.present ? 'Sim' : 'Nao')
        ].join(';') + '\n';
      });
      if (state.matchHistory.length) {
        csv += '\nJogo;Hora;Time A;Placar;Time B;Minuto;Lance;Jogador;Assistencia;Time\n';
        [...state.matchHistory].reverse().forEach((h, i) => {
          const ls = gameLines(h);
          const head = [i + 1, q(h.timestamp || ''), q('Time ' + h.labelA), q(`${h.scoreA} x ${h.scoreB}`), q('Time ' + h.labelB)];
          if (!ls.length) csv += head.join(';') + ';;;;;\n';
          ls.forEach(l => { csv += [...head, q(l.time), q(l.kind === 'g' ? 'Gol' : 'Defesa'), q(l.who), q(l.assist), q('Time ' + l.team)].join(';') + '\n'; });
        });
      }
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
      ['goals', 'assists', 'saves', 'total', 'wins', 'pens'].forEach(c => {
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

    const STAT_KEYS = ['goals', 'assists', 'saves', 'matches', 'wins', 'penGoals', 'penMisses', 'penSaves'];

    /* ---- Local do baba (estatísticas detalhadas) e lances de cada jogo ---- */
    const VENUES = { campo: 'Campo', society: 'Society', futsal: 'Futsal' };
    const detailOn = () => !!prefs.detailStats;
    let statsVenue = '';
    function renderVenueUI() {
      const card = document.getElementById('venue-card');
      if (!card) return;
      card.classList.toggle('hidden', !detailOn());
      document.getElementById('venue-seg').innerHTML = [['', 'Nenhum'], ...Object.entries(VENUES)].map(([k, l]) =>
        `<button onclick="setVenue('${k}')" class="seg-btn${(state.settings.venue || '') === k ? ' is-selected' : ''}">${l}</button>`).join('');
      const sv = document.getElementById('stats-venue');
      if (sv) {
        sv.classList.toggle('hidden', !detailOn() || currentStatsScope !== 'all');
        sv.innerHTML = [['', 'Todos'], ...Object.entries(VENUES)].map(([k, l]) =>
          `<button onclick="setStatsVenue('${k}')" class="seg-btn${statsVenue === k ? ' is-selected' : ''}">${l}</button>`).join('');
      }
    }
    function setVenue(v) {
      state.settings.venue = VENUES[v] ? v : '';
      commit(VENUES[v] ? `Local: ${VENUES[v]}` : 'Local do baba removido.');
      renderVenueUI();
    }
    function setStatsVenue(v) { statsVenue = VENUES[v] ? v : ''; renderStatsView(); renderVenueUI(); }
    const venueTag = v => VENUES[v] ? `<span class="inline-block text-[10.5px] font-extrabold bg-sage text-pitch rounded-md px-1.5 py-0.5 ml-1 align-middle">${VENUES[v]}</span>` : '';

    /* Goals and saves of the game that just ended, in order, with the clock time each one happened. */
    function gameEvents(A, B) {
      return state.match.events.slice().reverse().filter(e => e.type === 'goal' || e.type === 'save').map(e => {
        const team = e.side === 'A' ? A : B;
        const o = { k: e.type === 'goal' ? 'g' : 'd', l: team ? team.label : '?', t: e.el == null ? null : e.el };
        if (e.type === 'goal') { o.p = e.scorerId ? nameOf(e.scorerId) : '?'; if (e.assistId) o.a = nameOf(e.assistId); }
        else o.p = nameOf(e.keeperId);
        return o;
      });
    }
    /* [{ time, kind, text, score }] ready to print. */
    function gameLines(h) {
      let a = 0, b = 0;
      return (h.events || []).map(e => {
        if (e.k === 'g') { if (e.l === h.labelA) a++; else b++; }
        return { time: e.t == null ? '' : fmtMMSS(e.t), kind: e.k, team: e.l, who: e.p, assist: e.a || '', score: e.k === 'g' ? `${a} × ${b}` : '' };
      });
    }
    function gameLinesHtml(h) {
      const ls = gameLines(h);
      if (!ls.length) return '';
      return `<div class="mt-2 pt-2 border-t border-ink/[0.07] space-y-1">${ls.map(l => `
        <p class="text-[12px] leading-snug flex gap-1.5 items-baseline">
          <span class="w-[38px] flex-shrink-0 font-bold text-ink-3 tabular-nums">${l.time || '—'}</span>
          <span>${l.kind === 'g' ? '⚽' : '🧤'}</span>
          <span class="min-w-0"><b>${escapeHtml(l.who)}</b>${l.assist ? ` <span class="text-ink-2">· passe de ${escapeHtml(l.assist)}</span>` : ''}${l.kind === 'd' ? ' <span class="text-ink-2">· defesa</span>' : ''} <span class="text-ink-3">· Time ${escapeHtml(l.team)}${l.score ? ` · ${l.score}` : ''}</span></span>
        </p>`).join('')}</div>`;
    }
    function gameLineText(l) {
      return `${l.time || '--:--'}  ${l.kind === 'g' ? 'Gol' : 'Defesa'}: ${l.who}${l.assist ? ` (passe de ${l.assist})` : ''}  -  Time ${l.team}${l.score ? `  [${l.score.replace(' × ', 'x')}]` : ''}`;
    }
    /* Finished babas pulled from the server bring only their summary; the games load when one is opened. */
    function gamesBlockHtml(d) {
      if (!d.games) return d.matches && cloudOn() ? '<p class="text-[12px] text-ink-2 text-center">Carregando os jogos...</p>' : '';
      if (!d.games.length) return '';
      return `<div><p class="eyebrow mb-2 px-1">Jogos</p><div class="space-y-2">${d.games.map(h => `
        <div class="p-3 rounded-2xl bg-sunk/60 text-[13px]">
          <div class="flex items-center justify-between gap-2">
            <span class="text-ink-2 text-[11px] font-bold flex-shrink-0">${escapeHtml(h.timestamp || '')}${h.played ? `<span class="block font-semibold">${fmtMMSS(h.played)}</span>` : ''}</span>
            <span class="font-bold text-right">Time ${escapeHtml(h.labelA)} <b class="font-serif font-normal text-[22px] leading-none text-pitch mx-1">${h.scoreA} × ${h.scoreB}</b> Time ${escapeHtml(h.labelB)}${h.pens ? `<span class="block text-[11px] font-semibold text-ink-2">pên. ${h.pens.a} × ${h.pens.b}</span>` : ''}</span>
          </div>
          ${(h.namesA && h.namesA.length) ? `<p class="text-[11px] text-ink-2 mt-1 leading-snug">${escapeHtml(shortNames(h.namesA))} <span class="text-ink-3">vs</span> ${escapeHtml(shortNames(h.namesB))}</p>` : ''}
          ${gameLinesHtml(h)}
        </div>`).join('')}</div></div>`;
    }
    async function ensureGames(d) {
      if (!d || d.games || !cloudOn() || !isUuid(d.id)) return;
      d.games = [];
      try { d.games = await api.babaGames(d.id); } catch (e) { d.games = undefined; return; }
      if (!document.getElementById('modal-history').classList.contains('hidden') && historyView.day === d.id) renderHistory();
    }

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
        venue: state.settings.venue || '',
        games: state.matchHistory.slice().reverse(),
        players: state.players.filter(hasStats).map(p => {
          const row = { name: p.name, cloudId: playerCloudId(p) };
          if (p.female) row.female = true;
          STAT_KEYS.forEach(k => { row[k] = p[k] || 0; });
          return row;
        })
      };
    }

    /* Every past baba plus today, summed per player name. */
    function aggregatedPlayers(venue) {
      const map = new Map();
      const add = p => {
        const key = p.name.trim().toLowerCase();
        const cur = map.get(key) || Object.assign({ name: p.name }, Object.fromEntries(STAT_KEYS.map(k => [k, 0])));
        STAT_KEYS.forEach(k => { cur[k] += Number(p[k]) || 0; });
        map.set(key, cur);
      };
      state.pastDays.filter(d => !venue || d.venue === venue).forEach(d => d.players.forEach(add));
      if (!venue || state.settings.venue === venue) state.players.filter(hasStats).forEach(add);
      return [...map.values()];
    }

    function renderStatsView() {
      renderVenueUI();
      const configs = {
        goals: { title: 'Artilharia', col: 'Gols', value: p => p.goals || 0 },
        assists: { title: 'Assistências', col: 'Ast.', value: p => p.assists || 0 },
        saves: { title: 'Defesas', col: 'Def.', value: p => p.saves || 0 },
        pens: { title: 'Pênaltis convertidos', col: 'Pên.', value: p => p.penGoals || 0 },
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
        note.innerHTML = state.pastDays.length
          ? `Somando ${state.pastDays.length} baba${state.pastDays.length === 1 ? '' : 's'} anterior${state.pastDays.length === 1 ? '' : 'es'} + hoje. <button onclick="openHistory()" class="font-bold text-pitch underline underline-offset-2">Ver cada baba</button>`
          : 'Ainda não há babas anteriores. Ao tocar em "Começar novo baba", o dia vai pro histórico. Backups importados também entram aqui.';
      }
      const base = all ? aggregatedPlayers(detailOn() ? statsVenue : '') : state.players.filter(p => p.present || hasStats(p));
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
