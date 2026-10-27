    /* ===================================================================
       PALPITES EM TELAS (v11.8). Com o servidor da v11.8 a seção Palpites
       vira um menu: Duelo, Destaque do dia, Total do baba e Por atleta, cada
       um numa tela curta em passos, mais "Ver meus palpites". Sem a v11.8 no
       servidor continua a lista antiga (propPalpitesHtml).
       Cotações, linhas, travas e pagamentos continuam no servidor.
       =================================================================== */
    let propNav = { view: 'home' };      // view: home | duel | leader | total | athlete | mine
    let propMine = null;                 // "Ver meus palpites": lista de my_prop_bets (null = carregando)
    let propMineOff = false;
    const DUEL_METRIC = { goals: 'Gols', assists: 'Assistências', ga: 'G+A' };
    const ATH_CRIT = [['wins', 'ou', 'Jogos ganhos'], ['goals', 'ou', 'Gols'], ['assists', 'ou', 'Assistências'], ['ga', 'ou', 'G+A'], ['goals', 'exact', 'Cravada de gols'], ['saves', 'ou', 'Defesas']];
    const LEADER_ORDER = ['goals', 'assists', 'mvp', 'saves'];

    function propGo(view, extra) {
      propNav = Object.assign({ view }, extra || {});
      if (view === 'mine') loadPropMine();
      renderPropSection();
      const el = document.getElementById('shop-palpites');
      if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' });
    }
    function propSet(k, v) { propNav[k] = v; renderPropSection(); }

    function propBackHtml(title, sub) {
      return `<div class="flex items-center gap-2 mb-3">
          <button onclick="propGo('home')" class="btn-icon !w-9 !h-9 flex-shrink-0" aria-label="Voltar para os palpites"><i class="fa-solid fa-chevron-left text-[12px]"></i></button>
          <div class="min-w-0"><p class="text-[16px] font-extrabold leading-tight">${title}</p>${sub ? `<p class="text-[12px] text-ink-2 leading-snug">${sub}</p>` : ''}</div>
        </div>`;
    }
    const propStepTag = (n, t) => `<p class="text-[12px] font-bold text-ink-2 px-1 mb-1.5 mt-3"><span class="inline-flex w-5 h-5 rounded-full bg-pitch text-butter text-[11px] items-center justify-center mr-1.5">${n}</span>${t}</p>`;
    const propSeg = (items, cur, fn) => `<div data-prop-seg class="flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">${items.map(([k, l]) =>
      `<button onclick="${fn}('${k}')" class="chip flex-shrink-0 ${k === cur ? 'is-selected' : ''}">${l}</button>`).join('')}</div>`;

    /* Atletas confirmados para escolher (o servidor manda a lista; sem ela, os dos mercados). */
    function propAthletes(data) {
      if (Array.isArray(data.athletes) && data.athletes.length) return data.athletes;
      const seen = new Map();
      (data.markets || []).filter(isPlayerMarket).forEach(m => { if (!seen.has(m.player_id)) seen.set(m.player_id, { id: m.player_id, name: m.player, keeper: m.keeper, mine: m.mine }); });
      return [...seen.values()];
    }

    /* ---------- Menu ---------- */
    function propNavHtml(data, e) {
      if (propNav.view === 'duel') return propDuelView(data);
      if (propNav.view === 'leader') return propLeaderView(data);
      if (propNav.view === 'total') return propTotalView(data);
      if (propNav.view === 'athlete') return propAthleteView(data);
      if (propNav.view === 'mine') return propMineView(data);
      const locked = propIsLocked(data);
      const ms = data.markets || [];
      const open = ms.filter(m => m.status === 'open').length;
      const chooser = propCandidates();
      const mineN = ms.filter(m => m.bet).length;
      const count = f => ms.filter(f).filter(m => m.bet).length;
      const tile = (view, icon, title, sub, n, avail) => `
        <button onclick="propGo('${view}')" data-prop-tile="${view}" class="card p-3.5 text-left flex flex-col gap-2 active:scale-[0.98] transition ${avail ? '' : 'opacity-50'}">
          <span class="flex items-center justify-between w-full"><span class="tile bg-butter text-pitch !w-9 !h-9 text-[14px]"><i class="fa-solid ${icon}"></i></span>${n ? `<span class="ev-tag bg-pitch text-butter">${n} seu${n === 1 ? '' : 's'}</span>` : ''}</span>
          <span><span class="block text-[15px] font-extrabold leading-tight">${title}</span><span class="block text-[11.5px] text-ink-2 leading-snug mt-0.5">${sub}</span></span>
        </button>`;
      return `
        <div class="flex items-end justify-between gap-3 px-1 mb-2">
          <p class="text-[13px] text-ink-2 truncate min-w-0">${escapeHtml(evTurma(e).name)} · ${escapeHtml(evWhen(e))}</p>
          <span class="ev-tag flex-shrink-0 ${locked ? 'bg-sunk text-ink-2' : 'bg-leaf/10 text-leaf'}">${locked ? 'Palpites encerrados' : `${open} aberto${open === 1 ? '' : 's'}`}</span>
        </div>
        ${chooser.length > 1 ? `<div class="flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4 pb-2">${chooser.map(c => `<button onclick="propChoose('${c.id}')" class="chip ${c.id === data.event_id ? 'is-selected' : ''}">${escapeHtml(evTurma(c).name)} · ${escapeHtml(evWhen(c))}</button>`).join('')}</div>` : ''}
        ${data.adult ? '' : '<p class="text-[12px] text-ink-2 leading-snug px-1 mb-2"><b class="text-ink">Palpitar é só para maiores de 18 anos;</b> você pode ver as cotações.</p>'}
        <div class="grid grid-cols-2 gap-2.5" id="prop-menu">
          ${tile('duel', 'fa-bolt', 'Duelo', 'Escolha 2 atletas e quem faz mais', count(m => m.kind === 'duel'), propAthletes(data).length >= 2)}
          ${tile('leader', 'fa-star', 'Destaque do dia', 'Artilheiro, Garçom, MVP e Paredão', count(m => m.kind === 'leader'), ms.some(m => m.kind === 'leader'))}
          ${tile('total', 'fa-chart-column', 'Total do baba', 'Partidas e gols no dia', count(m => m.kind === 'baba_total'), ms.some(m => m.kind === 'baba_total'))}
          ${tile('athlete', 'fa-user', 'Por atleta', 'Gols, assistências, vitórias e cravada', count(isPlayerMarket), ms.some(isPlayerMarket))}
        </div>
        <button onclick="propGo('mine')" id="prop-mine-btn" class="w-full card p-3.5 mt-2.5 flex items-center gap-3 text-left active:scale-[0.99] transition">
          <span class="tile bg-pitch text-butter !w-9 !h-9 text-[14px]"><i class="fa-solid fa-receipt"></i></span>
          <span class="flex-1 min-w-0"><span class="block text-[15px] font-extrabold">Ver meus palpites</span><span class="block text-[12px] text-ink-2">${mineN ? `${mineN} neste baba · todos os seus palpites` : 'Todos os seus palpites e resultados'}</span></span>
          <i class="fa-solid fa-chevron-right text-[12px] text-ink-3"></i>
        </button>
        <p class="text-[11.5px] text-ink-3 leading-snug px-1 mt-2.5">A cotação fica congelada na hora do palpite. Trava no horário da lista ou no primeiro apito e paga quando o baba é finalizado. Lado "quase certo" (mais de 85% de chance) fica travado.</p>
        ${data.admin ? propAdminHtml(data.event_id) : ''}`;
    }

    /* ---------- Duelo ---------- */
    function propDuelPick(id) {
      const sel = (propNav.pick || []).slice();
      const i = sel.indexOf(id);
      if (i >= 0) sel.splice(i, 1); else { if (sel.length >= 2) sel.shift(); sel.push(id); }
      propNav.pick = sel; propNav.market = null;
      renderPropSection();
    }
    function propDuelMetric(k) { propNav.metric = k; propNav.market = null; renderPropSection(); }
    async function propDuelLoad() {
      const pick = propNav.pick || [], metric = propNav.metric || 'ga';
      if (pick.length !== 2) return;
      propNav.busy = true; renderPropSection();
      try {
        const r = await api.propDuelOpen(propEventId, pick[0], pick[1], metric);
        await loadProp(true);
        propNav.market = r && r.market_id;
      } catch (e) {
        const m = String((e && e.message) || '');
        showToast(m.includes('not_confirmed') ? 'Os dois precisam estar confirmados na lista.' : m.includes('no_odds') ? 'Sem histórico para esse duelo ainda.' : propError(e), 'warning');
      }
      propNav.busy = false; renderPropSection();
    }
    function propDuelView(data) {
      const locked = propIsLocked(data);
      const aths = propAthletes(data);
      const pick = propNav.pick || [];
      const metric = propNav.metric || 'ga';
      const duels = (data.markets || []).filter(m => m.kind === 'duel');
      const cur = propNav.market && duels.find(m => m.id === propNav.market);
      const letter = id => pick[0] === id ? 'A' : pick[1] === id ? 'B' : '';
      const picker = locked ? '<div class="card p-3.5 text-[13px] text-ink-2">Os palpites desse baba já travaram.</div>' : `
        ${propStepTag(1, 'Escolha dois atletas confirmados')}
        <div class="grid grid-cols-2 gap-1.5" id="prop-duel-pick">${aths.map(a => `
          <button onclick="propDuelPick('${a.id}')" data-ath="${a.id}" class="h-11 px-3 rounded-xl border text-[13px] font-bold text-left flex items-center gap-2 transition active:scale-[0.97] ${letter(a.id) ? 'bg-pitch text-butter border-pitch' : 'bg-card border-ink/15'}">
            ${letter(a.id) ? `<span class="w-5 h-5 rounded-full bg-butter text-pitch text-[11px] font-extrabold flex items-center justify-center flex-shrink-0">${letter(a.id)}</span>` : ''}
            <span class="truncate">${escapeHtml(a.name)}${a.mine ? ' <span class="opacity-70 text-[11px]">(você)</span>' : ''}</span></button>`).join('')}</div>
        ${pick.length === 2 ? `${propStepTag(2, 'Quem faz mais...')}
          ${propSeg(Object.entries(DUEL_METRIC), metric, 'propDuelMetric')}
          ${cur ? '' : `<button onclick="propDuelLoad()" id="prop-duel-go" ${propNav.busy ? 'disabled' : ''} class="btn-primary w-full h-12 text-[14px] mt-3">${propNav.busy ? 'Calculando...' : 'Ver cotações'}</button>`}` : ''}
        ${cur ? `${propStepTag(3, 'Palpite')}${propDuelHtml(cur, data)}` : ''}`;
      const others = duels.filter(m => !cur || m.id !== cur.id);
      const list = others.length ? `
        <button onclick="propSet('showAll', ${!propNav.showAll})" class="w-full mt-4 text-[13px] font-bold text-pitch text-left px-1">Duelos já abertos (${others.length}) <i class="fa-solid fa-chevron-${propNav.showAll ? 'up' : 'down'} text-[10px]"></i></button>
        ${propNav.showAll ? `<div class="space-y-2.5 mt-2">${others.map(m => propDuelHtml(m, data)).join('')}</div>` : ''}` : '';
      return propBackHtml('Duelo', 'Quem fizer mais no critério escolhido ganha. Empate devolve.') + picker + list;
    }

    /* ---------- Destaque do dia ---------- */
    function propLeaderView(data) {
      const ls = (data.markets || []).filter(m => m.kind === 'leader').sort((a, b) => LEADER_ORDER.indexOf(a.metric) - LEADER_ORDER.indexOf(b.metric));
      if (!ls.length) return propBackHtml('Destaque do dia') + '<div class="card p-4 text-[13px] text-ink-2">O Destaque do dia abre com pelo menos 4 atletas de linha confirmados.</div>';
      const cur = ls.find(m => m.metric === propNav.metric) || ls[0];
      return propBackHtml('Destaque do dia', 'Quem lidera o baba. Empate no topo divide o pagamento.')
        + propSeg(ls.map(m => [m.metric, LEADER_TITLE[m.metric] || 'Destaque']), cur.metric, 'propLeaderTab')
        + `<div class="mt-2.5">${propLeaderHtml(cur, data)}</div>`;
    }
    function propLeaderTab(k) { propNav.metric = k; renderPropSection(); }

    /* ---------- Total do baba ---------- */
    function propTotalView(data) {
      const ts = (data.markets || []).filter(m => m.kind === 'baba_total').sort((a, b) => (a.metric === 'matches' ? 0 : 1) - (b.metric === 'matches' ? 0 : 1));
      if (!ts.length) return propBackHtml('Total do baba') + '<div class="card p-4 text-[13px] text-ink-2">O Total do baba abre quando a turma tem pelo menos 5 babas finalizados.</div>';
      const cur = ts.find(m => m.metric === propNav.metric) || ts[0];
      return propBackHtml('Total do baba', 'Mais ou Menos do baba inteiro. Escolha a linha.')
        + propSeg(ts.map(m => [m.metric, TOTAL_TITLE[m.metric]]), cur.metric, 'propTotalTab')
        + `<div class="card p-3.5 mt-2.5">${propTotalHtml(cur, data)}</div>`;
    }
    function propTotalTab(k) { propNav.metric = k; renderPropSection(); }

    /* Escada (Mais/Menos com a linha escolhida): Total do baba. */
    function propLadderHtml(m, data) {
      const ladder = m.ladder;
      const blocked = !data.adult || !!m.bet;
      let cur = m.bet ? Number(m.bet.line != null ? m.bet.line : m.line) : (propLines.has(m.id) ? propLines.get(m.id) : Number(m.line));
      let i = ladder.findIndex(x => Number(x.line) === cur); if (i < 0) i = Math.max(0, ladder.findIndex(x => Number(x.line) === Number(m.line)));
      const ent = ladder[i];
      const btn = (key, label, side) => {
        const picked = m.bet && m.bet.selection === key && Number(m.bet.line != null ? m.bet.line : m.line) === Number(ent.line);
        const off = blocked || !side.ok;
        return `<button ${off ? 'disabled' : ''} onclick="openBilhete('${m.id}', '${key}', ${ent.line})" ${side.ok ? '' : 'title="Quase certo: não paga"'} class="prop-btn h-11 rounded-xl border text-[13px] font-extrabold transition active:scale-[0.97] ${picked ? 'bg-pitch text-butter border-pitch' : 'bg-card border-ink/15 text-ink'} ${off && !picked ? 'opacity-40' : ''}">${label} ${fmtLinha(ent.line)}${side.ok ? ' · ' + fmtCot(side.odd) : ' · travado'}</button>`;
      };
      const stepper = m.bet ? '' : `
        <div class="flex items-center justify-between mb-1.5">
          <button ${i <= 0 ? 'disabled' : ''} onclick="propStepLine('${m.id}', -1)" aria-label="Linha menor" class="chip !h-8 !px-3 text-[12px] disabled:opacity-30"><i class="fa-solid fa-minus text-[10px]"></i></button>
          <span class="text-[12.5px] text-ink-2">Linha <b class="text-ink text-[14px]">${fmtLinha(ent.line)}</b></span>
          <button ${i >= ladder.length - 1 ? 'disabled' : ''} onclick="propStepLine('${m.id}', 1)" aria-label="Linha maior" class="chip !h-8 !px-3 text-[12px] disabled:opacity-30"><i class="fa-solid fa-plus text-[10px]"></i></button>
        </div>`;
      return `${stepper}<div class="grid grid-cols-2 gap-1.5">${btn('mais', 'Mais', ent.mais)}${btn('menos', 'Menos', ent.menos)}</div>`;
    }

    /* ---------- Por atleta ---------- */
    function propAthPick(id) { propNav.player = id; propNav.crit = null; renderPropSection(); }
    function propAthCrit(k) { propNav.crit = k; renderPropSection(); }
    function propAthleteView(data) {
      const ms = (data.markets || []).filter(isPlayerMarket);
      const ids = [...new Set(ms.map(m => m.player_id))];
      const aths = ids.map(id => ms.find(m => m.player_id === id)).sort((a, b) => String(a.player).localeCompare(String(b.player)));
      if (!aths.length) return propBackHtml('Por atleta') + '<div class="card p-4 text-[13px] text-ink-2">Ainda sem palpites por atleta nessa lista.</div>';
      const p = propNav.player && aths.find(a => a.player_id === propNav.player);
      if (!p) {
        return propBackHtml('Por atleta', 'Escolha o jogador.') + propStepTag(1, 'Jogador')
          + `<div class="grid grid-cols-2 gap-1.5" id="prop-ath-pick">${aths.map(a => {
              const n = ms.filter(m => m.player_id === a.player_id && m.bet).length;
              return `<button onclick="propAthPick('${a.player_id}')" data-ath="${a.player_id}" class="h-12 px-3 rounded-xl border border-ink/15 bg-card text-left flex items-center gap-2 active:scale-[0.97] transition">
                <i class="fa-solid ${a.keeper ? 'fa-hand' : 'fa-futbol'} text-pitch text-[12px] flex-shrink-0"></i>
                <span class="min-w-0 flex-1"><span class="block text-[13px] font-bold truncate">${escapeHtml(a.player)}</span>
                  <span class="block text-[10.5px] text-ink-2">${a.mine ? 'você' : a.rookie ? 'estreante' : n ? `${n} palpite${n === 1 ? '' : 's'} seu${n === 1 ? '' : 's'}` : '&nbsp;'}</span></span></button>`; }).join('')}</div>`;
      }
      const mine = ms.filter(m => m.player_id === p.player_id);
      const crits = ATH_CRIT.filter(([met, kind]) => mine.some(m => m.metric === met && m.kind === kind) && !(kind === 'exact' && p.mine));
      const ck = propNav.crit && crits.some(c => c[1] + ':' + c[0] === propNav.crit) ? propNav.crit : (crits[0] ? crits[0][1] + ':' + crits[0][0] : null);
      const m = ck && mine.find(x => x.kind + ':' + x.metric === ck);
      return propBackHtml(escapeHtml(p.player), `${p.rookie ? 'Estreante: cotação pela média da turma. ' : ''}${p.mine ? 'É você: sem "Menos" e sem cravada.' : ''}`)
        + `<button onclick="propAthPick(null)" class="text-[12.5px] font-bold text-pitch px-1 -mt-1.5 mb-1"><i class="fa-solid fa-arrows-rotate text-[10px] mr-1"></i>Trocar jogador</button>`
        + propStepTag(2, 'O que palpitar')
        + propSeg(crits.map(([met, kind, label]) => [kind + ':' + met, label]), ck, 'propAthCrit')
        + (m ? `${propStepTag(3, 'Palpite')}<div class="card p-3.5 -mt-1" data-prop-player="${p.player_id}">${propRowHtml(m, data).replace('class="mt-3"', 'class=""')}</div>` : '');
    }

    /* ---------- Ver meus palpites ---------- */
    async function loadPropMine() {
      propMine = null;
      try { propMine = (await api.myPropBets(60)) || []; propMineOff = false; }
      catch (e) { propMineOff = true; propMine = []; }
      if (propNav.view === 'mine') renderPropSection();
    }
    function propMineView(data) {
      const tag = st => st === 'won' ? ['Ganhou', 'bg-leaf/15 text-leaf'] : st === 'lost' ? ['Perdeu', 'bg-danger/10 text-danger'] : st === 'void' ? ['Devolvido', 'bg-sunk text-ink-2'] : ['Aberto', 'bg-butter text-pitch'];
      let rows = propMine;
      if (propMineOff || rows == null) {
        // Sem my_prop_bets (ou carregando): os palpites desta lista.
        rows = (data.markets || []).filter(m => m.bet).map(m => ({ label: isPlayerMarket(m) ? `${m.player} · ${propSelLabel(m, m.bet.selection, m.bet.line)} ${m.kind === 'exact' ? '' : (PROP_METRIC[m.metric] || '').toLowerCase()}`.trim() : `${propKindTitle(m)} · ${propOptLabel(m, m.bet.selection, m.bet.line)}`,
          stake: m.bet.stake, odd: m.bet.odd, status: m.bet.status, payout: m.bet.payout, turma: '', starts_at: data.starts_at }));
      }
      const tot = rows.reduce((a, r) => { a.staked += Number(r.stake) || 0; if (r.status === 'won') a.back += Number(r.payout) || 0; if (r.status === 'void') a.back += Number(r.stake) || 0; return a; }, { staked: 0, back: 0 });
      const body = propMine == null && !propMineOff ? '<p class="text-[13px] text-ink-2 py-6 text-center">Carregando seus palpites...</p>'
        : rows.length ? `<div class="card-flat overflow-hidden divide-y divide-ink/[0.07]" id="prop-mine-list">${rows.map(r => { const t = tag(r.status); return `
            <div class="flex items-center justify-between gap-3 px-4 py-2.5" data-mine-row>
              <span class="min-w-0"><span class="block text-[13.5px] font-semibold leading-snug">${escapeHtml(r.label || 'Palpite')}</span>
                <span class="block text-[11.5px] text-ink-2 truncate">${[r.turma, r.starts_at ? new Date(r.starts_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''].filter(Boolean).map(escapeHtml).join(' · ')}${r.turma || r.starts_at ? ' · ' : ''}${fmtPts(r.stake)} pts · cotação ${fmtCot(r.odd)}</span></span>
              <span class="ev-tag ${t[1]} flex-shrink-0">${t[0]}${r.status === 'won' ? ` +${fmtPts(r.payout)}` : r.status === 'open' ? ` · volta ${fmtPts(Math.floor(r.stake * r.odd))}` : ''}</span>
            </div>`; }).join('')}</div>`
        : '<div class="card p-4 text-[13px] text-ink-2">Você ainda não fez nenhum palpite.</div>';
      return propBackHtml('Meus palpites', rows.length ? `${rows.length} palpite${rows.length === 1 ? '' : 's'} · ${fmtPts(tot.staked)} pts palpitados · ${fmtPts(tot.back)} pts de volta` : '') + body;
    }
