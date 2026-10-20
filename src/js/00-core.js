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
        // Lista (turma_events) a que este baba está ligado: os palpites pré-jogo da lista são liquidados com ele (v11.4).
        eventId: null,
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
        firstKickoffAt: null,
        // v11.6: versão do baba no servidor que este aparelho já tem, e quem criou o baba (dono/adm podem controlar o de outra pessoa).
        rev: 0,
        createdBy: null
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

