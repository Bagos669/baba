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
      renderSharedCards();
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
                ${(() => { const sb2 = t.cloud ? sharedRunOfTurma(t.id) : null; return sb2 ? `<button type="button" data-selo="${t.id}" onclick="event.preventDefault(); event.stopPropagation(); openSharedBaba('${sb2.id}')" class="mt-0.5 inline-flex items-center gap-1.5 rounded-full bg-leaf/15 text-leaf text-[11px] font-extrabold px-2 py-0.5"><span class="live-dot"></span> Em andamento</button>` : ''; })()}
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

