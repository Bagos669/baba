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
      const sv = document.getElementById('stats-venue');
      if (sv) {
        sv.classList.toggle('hidden', !detailOn() || currentStatsScope !== 'all');
        sv.innerHTML = [['', 'Todos'], ...Object.entries(VENUES)].map(([k, l]) =>
          `<button onclick="setStatsVenue('${k}')" class="seg-btn${statsVenue === k ? ' is-selected' : ''}">${l}</button>`).join('');
      }
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
        eventId: state.eventId || null,
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

