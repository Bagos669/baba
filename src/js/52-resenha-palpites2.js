    /* ===================================================================
       RESENHA (v11.5): a aba que era a Lojinha. Palpites no topo (sub-abas
       Palpites e Ranking), depois as missões e por último a Lojinha.
       Palpites fase 2: Duelos, Destaque do dia e Total do baba. Ranking de
       palpiteiros e troféus Pé-quente / Mãe Diná no Perfil e no card.
       Regras, cotações e pagamentos são do servidor; aqui só se mostra.
       =================================================================== */
    let propSub = 'palpites';            // sub-aba da seção Palpites: 'palpites' | 'rank'
    let propRankTurma = null;            // turma escolhida no ranking
    let propRankSeason = null;           // temporada escolhida (null = atual)
    const propRankCache = new Map();     // `${turma}|${season}` -> resposta de prop_leaderboard
    let propRankLoading = false;
    let propRankOff = false;             // servidor ainda sem a v11.5
    const propLeaderAll = new Set();     // Destaques com "ver todos" aberto
    const LEADER_TITLE = { goals: 'Artilheiro', assists: 'Garçom', saves: 'Paredão' };
    const LEADER_SUB = { goals: 'Quem faz mais gols no baba', assists: 'Quem dá mais assistências no baba', saves: 'Quem faz mais defesas no baba' };
    const LEADER_ICON = { goals: 'fa-futbol', assists: 'fa-handshake', saves: 'fa-hand' };
    const TOTAL_TITLE = { matches: 'Partidas no dia', goals: 'Gols no dia' };
    const isPlayerMarket = m => m.kind === 'ou' || m.kind === 'exact';

    function paintBalance() {
      const v = wallet ? fmtPts(wallet.balance) : '...';
      ['shop-balance', 'resenha-balance'].forEach(id => { const el = document.getElementById(id); if (el) el.innerText = v; });
    }

    /* Textos dos mercados novos (meus palpites, bilhete e extrato). */
    function propOptName(m, key) {
      const s = (m.selections || []).find(x => x.key === key);
      return s && s.label ? s.label : '?';
    }
    function propKindTitle(m) {
      if (m.kind === 'duel') return `Duelo ${m.player || '?'} x ${m.player2 || '?'}`;
      if (m.kind === 'leader') return `${LEADER_TITLE[m.metric] || 'Destaque'} do dia`;
      if (m.kind === 'baba_total') return `Total do baba · ${TOTAL_TITLE[m.metric] || ''}`;
      return `${m.player} · ${m.kind === 'exact' ? 'Cravada de gols' : PROP_METRIC[m.metric]}`;
    }
    function propOptLabel(m, key, line) {
      if (m.kind === 'baba_total') return `${key === 'mais' ? 'Mais' : 'Menos'} ${fmtLinha(line != null ? line : m.line)}`;
      return propOptName(m, key);
    }
    function propBilheteNote(m) {
      if (m.kind === 'duel') return 'Vale gols + assistências no baba. Empate devolve o palpite; se um dos dois não jogar, também.';
      if (m.kind === 'leader') return 'Se der empate no topo, o pagamento é dividido entre os empatados. Atleta que não jogar: palpite devolvido.';
      if (m.kind === 'baba_total') return Number(m.line) % 1 === 0 ? 'Se der exatamente a linha, o palpite é devolvido.' : '';
      return '';
    }

    /* Botão de mercado fechado (anulado, liquidado ou travado). null = mercado aberto. */
    function propClosedHtml(m, data) {
      const locked = propIsLocked(data) || m.status === 'locked';
      const dis = t => `<button disabled class="prop-btn w-full h-11 rounded-xl border border-ink/10 bg-sunk text-[13px] font-bold text-ink-2">${t}</button>`;
      if (m.status === 'void') return dis(m.void_reason === 'suspenso' ? 'Suspenso pelo adm · pontos devolvidos'
        : m.void_reason === 'zero' ? 'Ninguém pontuou · pontos devolvidos'
        : m.void_reason === 'ausente' ? 'Alguém não jogou · pontos devolvidos' : 'Anulado · pontos devolvidos');
      if (m.status === 'settled') {
        const r = m.result || {};
        if (m.kind === 'duel') return dis(r.win === 'empate' ? `Empate ${r.value} x ${r.value2} · devolvido` : `${escapeHtml(m.player)} ${r.value} x ${r.value2} ${escapeHtml(m.player2)}`);
        if (m.kind === 'leader') return dis(`Deu ${(r.win || []).map(k => escapeHtml(propOptName(m, k))).join(', ')} (${r.value})`);
        return dis(r.win === 'empate' ? `Deu ${r.value} · devolvido` : `Deu ${r.value}`);
      }
      if (locked || m.status !== 'open') return dis('Palpites encerrados');
      return null;
    }
    function propTagsHtml(m, data) {
      const s = propMyState(m, propIsLocked(data) || m.status === 'locked');
      return [m.adjusted && m.kind === 'baba_total' ? '<span class="ev-tag bg-sunk text-ink-2">linha ajustada pelo adm</span>' : '', s ? `<span class="ev-tag ${s[1]}">${s[0]}</span>` : ''].join('');
    }
    function propBetLine(m) {
      if (!m.bet) return '';
      const st = m.bet.status;
      const back = st === 'won' ? `ganhou ${fmtPts(m.bet.payout)}` : st === 'void' ? 'devolvido' : st === 'lost' ? 'não deu' : `volta ${fmtPts(Math.floor(m.bet.stake * m.bet.odd))}${m.kind === 'leader' ? ' (dividido se empatar)' : ''}`;
      return `<p class="text-[12px] text-ink-2 mt-1.5">Seu palpite: <b class="text-ink">${escapeHtml(propOptLabel(m, m.bet.selection, m.bet.line))}</b> · ${fmtPts(m.bet.stake)} pts · ${back}</p>`;
    }
    function propSuspendHtml(m, data) {
      return data.admin && (m.status === 'open' || m.status === 'locked')
        ? `<div class="flex items-center gap-1.5 mt-1.5"><button onclick="propSuspend('${m.id}')" class="chip !h-8 !px-3 text-[12px] !text-danger ml-auto">Suspender</button></div>` : '';
    }
    function propOptBtn(m, data, key, label, odd, opts = {}) {
      const picked = m.bet && m.bet.selection === key;
      const off = !data.adult || !!m.bet || opts.block;
      return `<button ${off ? 'disabled' : ''} onclick="openBilhete('${m.id}', '${key}')" ${opts.title ? `title="${opts.title}"` : ''}
        class="prop-btn ${opts.cls || 'h-11'} rounded-xl border text-[13px] font-extrabold transition active:scale-[0.97] ${picked ? 'bg-pitch text-butter border-pitch' : 'bg-card border-ink/15 text-ink'} ${off && !picked ? 'opacity-40' : ''}">${label}</button>`;
    }

    /* Os três blocos novos. Bloco sem mercado não aparece. */
    function propFase2Html(data) {
      const ms = data.markets || [];
      const duels = ms.filter(m => m.kind === 'duel'), leaders = ms.filter(m => m.kind === 'leader'), totals = ms.filter(m => m.kind === 'baba_total');
      const block = (id, title, sub, inner) => `<div data-prop-block="${id}"><p class="section-tag px-1">${title}</p><p class="text-[12px] text-ink-2 px-1 mt-0.5 mb-2 leading-snug">${sub}</p>${inner}</div>`;
      const order = { goals: 1, assists: 2, saves: 3, matches: 1 };
      return [
        duels.length ? block('duelos', 'Duelos', 'Quem faz mais gols + assistências no baba. Empate devolve.', `<div class="space-y-2.5">${duels.map(m => propDuelHtml(m, data)).join('')}</div>`) : '',
        leaders.length ? block('destaque', 'Destaque do dia', 'Palpite em quem vai liderar o baba. Empate no topo divide o pagamento.',
          `<div class="space-y-2.5">${leaders.slice().sort((a, b) => (order[a.metric] || 9) - (order[b.metric] || 9)).map(m => propLeaderHtml(m, data)).join('')}</div>`) : '',
        totals.length ? block('total', 'Total do baba', 'Mais ou Menos do baba inteiro, pelo histórico da turma.',
          `<div class="card p-3.5 divide-y divide-ink/[0.07]">${totals.slice().sort((a, b) => (a.metric === 'matches' ? 0 : 1) - (b.metric === 'matches' ? 0 : 1)).map(m => propTotalHtml(m, data)).join('')}</div>`) : ''
      ].filter(Boolean).join('');
    }

    function propDuelHtml(m, data) {
      const closed = propClosedHtml(m, data);
      const a = (m.selections || [])[0] || {}, b = (m.selections || [])[1] || {};
      const side = (s, other) => {
        const blockMe = (m.mine && s.key === m.player2_id) || (m.mine2 && s.key === m.player_id);   // atleta do duelo não palpita no adversário
        return propOptBtn(m, data, s.key, `<span class="block truncate">${escapeHtml(s.label || '?')}${s.mine ? ' <span class="text-[10.5px] font-bold opacity-70">(você)</span>' : ''}</span><span class="block text-[12px] font-bold opacity-80">${fmtCot(s.odd)}</span>`,
          s.odd, { cls: 'h-14 px-2', block: blockMe, title: blockMe ? 'Você não palpita no seu adversário' : '' });
      };
      return `
        <div class="card p-3.5" data-market2="${m.id}" data-kind="duel">
          <div class="flex items-center justify-between gap-2 mb-2">
            <p class="text-[13px] font-extrabold truncate min-w-0"><i class="fa-solid fa-bolt text-pitch mr-1"></i>${escapeHtml(m.player || '?')} <span class="text-ink-3 font-bold">x</span> ${escapeHtml(m.player2 || '?')}</p>
            <span class="flex items-center gap-1 flex-shrink-0">${propTagsHtml(m, data)}</span>
          </div>
          ${closed || `<div class="grid grid-cols-2 gap-1.5">${side(a, b)}${side(b, a)}</div>`}
          ${propBetLine(m)}${propSuspendHtml(m, data)}
        </div>`;
    }

    function propLeaderHtml(m, data) {
      const closed = propClosedHtml(m, data);
      const sels = m.selections || [];
      const all = propLeaderAll.has(m.id);
      let shown = all ? sels : sels.slice(0, 6);
      if (!all && m.bet && !shown.some(s => s.key === m.bet.selection)) shown = shown.concat(sels.filter(s => s.key === m.bet.selection));
      const rows = shown.map(s => propOptBtn(m, data, s.key,
        `<span class="flex items-center justify-between gap-2 w-full"><span class="truncate text-left">${escapeHtml(s.label || '?')}${s.mine ? ' <span class="text-[10.5px] font-bold opacity-70">(você)</span>' : ''}</span><span class="flex-shrink-0">${fmtCot(s.odd)}</span></span>`,
        s.odd, { cls: 'h-10 px-3 w-full' })).join('');
      return `
        <div class="card p-3.5" data-market2="${m.id}" data-kind="leader">
          <div class="flex items-center gap-2 mb-2">
            <span class="tile bg-butter text-pitch flex-shrink-0 !w-9 !h-9 text-[14px]"><i class="fa-solid ${LEADER_ICON[m.metric] || 'fa-star'}"></i></span>
            <span class="min-w-0 flex-1"><span class="block text-[15px] font-extrabold leading-tight">${LEADER_TITLE[m.metric] || 'Destaque'}</span><span class="block text-[11.5px] text-ink-2">${LEADER_SUB[m.metric] || ''}</span></span>
            <span class="flex items-center gap-1 flex-shrink-0">${propTagsHtml(m, data)}</span>
          </div>
          ${closed || `<div class="space-y-1.5">${rows}</div>
          ${sels.length > 6 ? `<button onclick="propToggleLeader('${m.id}')" class="mt-2 text-[12.5px] font-bold text-pitch">${all ? 'ver menos' : `ver todos (${sels.length})`} <i class="fa-solid fa-chevron-${all ? 'up' : 'down'} text-[9px]"></i></button>` : ''}`}
          ${propBetLine(m)}${propSuspendHtml(m, data)}
        </div>`;
    }
    function propToggleLeader(id) { if (propLeaderAll.has(id)) propLeaderAll.delete(id); else propLeaderAll.add(id); renderPropSection(); }

    function propTotalHtml(m, data) {
      const closed = propClosedHtml(m, data);
      const sel = k => (m.selections || []).find(s => s.key === k) || {};
      const mv = data.admin && m.status === 'open' && !m.has_bets && !propIsLocked(data) ? `
        <div class="flex items-center gap-1.5 mt-1.5">
          <span class="text-[11.5px] text-ink-3">Linha (adm)</span>
          <button onclick="propMoveTotal('${m.id}', -0.5)" ${Number(m.line) <= 0.5 ? 'disabled' : ''} aria-label="Linha menor" class="chip !h-8 !px-3 text-[12px] disabled:opacity-30"><i class="fa-solid fa-minus text-[10px]"></i></button>
          <button onclick="propMoveTotal('${m.id}', 0.5)" aria-label="Linha maior" class="chip !h-8 !px-3 text-[12px]"><i class="fa-solid fa-plus text-[10px]"></i></button>
        </div>` : '';
      return `
        <div class="py-2.5 first:pt-0 last:pb-0" data-market2="${m.id}" data-kind="baba_total">
          <div class="flex items-center justify-between gap-2 mb-1.5"><p class="text-[13px] font-extrabold">${TOTAL_TITLE[m.metric] || ''} <span class="text-ink-2 font-bold">· linha ${fmtLinha(m.line)}</span></p><span class="flex items-center gap-1 flex-wrap justify-end">${propTagsHtml(m, data)}</span></div>
          ${closed || `<div class="grid grid-cols-2 gap-1.5">${propOptBtn(m, data, 'mais', `Mais ${fmtLinha(m.line)} · ${fmtCot(sel('mais').odd)}`, sel('mais').odd)}${propOptBtn(m, data, 'menos', `Menos ${fmtLinha(m.line)} · ${fmtCot(sel('menos').odd)}`, sel('menos').odd)}</div>`}
          ${propBetLine(m)}${mv}${propSuspendHtml(m, data)}
        </div>`;
    }
    async function propMoveTotal(id, step) {
      const data = propCache.get(propEventId);
      const m = data && data.markets.find(x => x.id === id);
      if (!m) return;
      try { await api.adjustPropLine(id, Math.round((Number(m.line) + step) * 2) / 2); await loadProp(true); }
      catch (e) { showToast(propError(e), 'warning'); loadProp(true); }
    }

    function propSubTab(t) {
      propSub = t === 'rank' ? 'rank' : 'palpites';
      renderPropSection();
      if (propSub === 'rank') loadPropRank();
    }

    /* ---------- Ranking de palpiteiros (por turma e temporada) ---------- */
    const propCloudTurmas = () => state.turmas.filter(t => t.cloud && t.name);
    function propRankTurmaId() {
      const ts = propCloudTurmas();
      if (propRankTurma && ts.some(t => t.id === propRankTurma)) return propRankTurma;
      const ev = propEventId && eventsCache.find(x => x.id === propEventId);
      const pick = (ev && ts.find(t => t.id === ev.turma_id)) || ts.find(t => t.id === prefs.mainTurma) || ts[0];
      return pick ? pick.id : null;
    }
    const seasonLabel = s => String(s || '').replace(/^(\d{4})-S1$/, '$1 · jan a jun').replace(/^(\d{4})-S2$/, '$1 · jul a dez');
    async function loadPropRank(force) {
      const t = propRankTurmaId();
      if (!t || propRankOff) { renderPropRank(); return; }
      const key = `${t}|${propRankSeason || ''}`;
      if (propRankCache.has(key) && !force) { renderPropRank(); return; }
      if (propRankLoading) return;
      propRankLoading = true; renderPropRank();
      try {
        const d = await api.propLeaderboard(t, propRankSeason);
        propRankCache.set(key, d || { rows: [], seasons: [] });
        const ids = ((d || {}).rows || []).map(r => r.user_id);
        if (ids.length && typeof ensurePeople === 'function') await ensurePeople(ids);
      } catch (e) {
        if (isMissingFn(e)) propRankOff = true;
        else propRankCache.set(key, { error: isNetworkError(e) ? 'O ranking precisa de internet.' : 'Não deu para carregar o ranking agora.' });
      }
      propRankLoading = false;
      renderPropRank();
    }
    function renderPropRank() {
      const el = document.getElementById('prop-rank');
      if (el) el.innerHTML = propRankHtml();
    }
    function propRankChoose(field, v) {
      if (field === 'turma') { propRankTurma = v; propRankSeason = null; } else propRankSeason = v || null;
      loadPropRank();
    }
    function propRankHtml() {
      if (propRankOff) return '<div class="card p-4"><p class="text-[13px] text-ink-2">O ranking chega quando o servidor for atualizado.</p></div>';
      const ts = propCloudTurmas(), t = propRankTurmaId();
      if (!t) return '<div class="card p-4"><p class="text-[13px] text-ink-2">Entre numa turma para ver o ranking de palpiteiros.</p></div>';
      const d = propRankCache.get(`${t}|${propRankSeason || ''}`);
      const turmaChips = ts.length > 1 ? `<div class="flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4 pb-2">${ts.map(x => `<button onclick="propRankChoose('turma', '${x.id}')" class="chip flex-shrink-0 ${x.id === t ? 'is-selected' : ''}">${escapeHtml(x.name)}</button>`).join('')}</div>` : '';
      if (!d) return turmaChips + '<p class="text-[13px] text-ink-2 py-6 text-center">Carregando o ranking...</p>';
      if (d.error) return turmaChips + `<p class="text-[13px] text-ink-2 py-6 text-center">${escapeHtml(d.error)}</p>`;
      const cur = d.season || d.current;
      const seasons = (d.seasons && d.seasons.length ? d.seasons : [cur]);
      const seasonChips = `<div class="flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4 pb-2">${seasons.map(s => `<button onclick="propRankChoose('season', '${escapeHtml(s)}')" class="chip flex-shrink-0 ${s === cur ? 'is-selected' : ''}">${s === d.current ? 'Temporada atual' : escapeHtml(seasonLabel(s))}</button>`).join('')}</div>`;
      const medal = i => i === 1 ? 'bg-[#f3c93a] text-pitch' : i === 2 ? 'bg-[#cfd5db] text-pitch' : i === 3 ? 'bg-[#d9a273] text-pitch' : 'bg-sunk text-ink-2';
      const pct = v => v == null ? '–' : `${Math.round(Number(v) * 100)}%`;
      const signed = v => (Number(v) > 0 ? '+' : Number(v) < 0 ? '−' : '') + fmtPts(Math.abs(Number(v) || 0));
      const me = d.me || {};
      const rows = d.rows || [];
      const avatarOf = r => {
        const p = currentUser && r.user_id === currentUser.id ? { avatar: currentUser.avatar, name: currentUser.name, cosmetics: currentUser.cosmetics } : (peopleCache.get(r.user_id) || { name: r.name });
        return framedAvatar(p.avatar, p.name || r.name, 'w-7 h-7 text-[10px] flex-shrink-0', cosOf(p.cosmetics));
      };
      const grid = 'grid grid-cols-[22px_minmax(0,1fr)_44px_36px_46px_34px] items-center gap-1';
      const table = rows.length ? `
        <div class="card-flat overflow-hidden">
          <div class="${grid} px-3 pt-2.5 pb-1.5 text-[9.5px] font-bold text-ink-3 uppercase">
            <span>#</span><span>Pessoa</span><span class="text-right">Lucro</span><span class="text-right">ROI</span><span class="text-right">Acertos</span><span class="text-right" title="Cravadas certas">Crav.</span>
          </div>
          <div class="divide-y divide-ink/[0.07]">${rows.map(r => `
            <div class="${grid} px-3 py-2 ${r.me ? 'bg-butter/40' : ''}" data-rank-row="${r.rank}">
              <span class="w-6 h-6 rounded-full ${medal(r.rank)} text-[11px] font-extrabold flex items-center justify-center">${r.rank}</span>
              <span class="flex items-center gap-1.5 min-w-0">${avatarOf(r)}<span class="text-[13px] font-bold truncate">${escapeHtml(r.name || 'Alguém')}</span></span>
              <span class="text-right text-[13px] font-extrabold tabular ${Number(r.lucro) > 0 ? 'text-leaf' : Number(r.lucro) < 0 ? 'text-danger' : ''}">${signed(r.lucro)}</span>
              <span class="text-right text-[12.5px] font-bold tabular text-ink-2">${pct(r.roi)}</span>
              <span class="text-right text-[12.5px] font-bold tabular">${r.wins}/${r.total}</span>
              <span class="text-right text-[12.5px] font-bold tabular">${r.cravadas}</span>
            </div>`).join('')}</div>
        </div>` : `<div class="card p-4"><p class="text-[13px] text-ink-2 leading-snug">Ninguém tem ${d.min || 10} palpites resolvidos nesta temporada ainda.</p></div>`;
      const meLine = me.qualified ? '' : `<p class="text-[13px] font-semibold text-ink-2 px-1 mt-2.5" data-rank-me>Você tem ${me.total || 0} de ${me.need || 10} palpites para entrar no ranking.</p>`;
      return `${turmaChips}${seasonChips}
        <p class="text-[12px] text-ink-2 leading-snug px-1 mb-2.5">Crav. = cravadas certas. Lucro = o que você recebeu menos o que palpitou. Contam os palpites pré-jogo ganhos e perdidos das listas da turma; devolvidos não contam. Desempate pelo ROI (lucro ÷ pontos palpitados).</p>
        ${table}${meLine}`;
    }

    /* ---------- Troféus de uma conta (Perfil e card) ---------- */
    const userTrophyCache = new Map();   // uid -> lista (de user_trophies)
    let trophiesOff = false;
    async function loadUserTrophies(uid, force) {
      if (!uid || trophiesOff || !cloudOn() || v7 !== true) return userTrophyCache.get(uid) || null;
      if (userTrophyCache.has(uid) && !force) return userTrophyCache.get(uid);
      try { userTrophyCache.set(uid, (await api.userTrophies(uid)) || []); }
      catch (e) { if (isMissingFn(e)) trophiesOff = true; }
      return userTrophyCache.get(uid) || null;
    }
    function trophyValueText(x) {
      const v = Number(x.value) || 0;
      if (x.kind === 'pe_quente') return `+${fmtPts(v)} pts de lucro`;
      if (x.kind === 'mae_dina') return `${v} cravada${v === 1 ? '' : 's'} certa${v === 1 ? '' : 's'}`;
      const unit = { artilheiro: 'gol', garcom: 'assistência', craque: 'G+A', vencedor: 'vitória', paredao: 'defesa' }[x.kind];
      return unit ? (unit === 'G+A' ? `${v} G+A` : `${v} ${unit}${v === 1 ? '' : 's'}`) : String(v);
    }
    function trophyCardHtml(x) {
      return `<div class="rounded-2xl bg-card border border-ink/10 p-3 flex items-center gap-3" data-trophy="${escapeHtml(x.kind)}">
        <span class="tile bg-butter text-pitch flex-shrink-0"><i class="fa-solid ${TROPHY_ICON[x.kind] || 'fa-trophy'}"></i></span>
        <span class="min-w-0"><span class="block text-[14px] font-bold leading-tight">${escapeHtml(x.title)}</span>
          <span class="block text-[12px] text-ink-2 truncate">${escapeHtml(x.turma || '')} · ${escapeHtml(seasonLabel(x.season))} · ${escapeHtml(trophyValueText(x))}</span></span>
      </div>`;
    }
    async function renderProfileTrophies() {
      const sec = document.getElementById('pf-trophies-sec'), box = document.getElementById('pf-trophies');
      if (!sec || !box || !currentUser) return;
      const paint = list => {
        if (!list) { sec.classList.add('hidden'); return; }
        sec.classList.remove('hidden');
        box.innerHTML = list.length ? list.map(trophyCardHtml).join('')
          : '<p class="text-[12.5px] text-ink-2 leading-snug px-1">Ainda sem troféu. No fim de cada temporada (jan a jun e jul a dez) saem os troféus da turma, inclusive Pé-quente e Mãe Diná para os palpiteiros.</p>';
      };
      paint(userTrophyCache.get(currentUser.id) || null);
      const before = JSON.stringify(userTrophyCache.get(currentUser.id) || null);
      paint(await loadUserTrophies(currentUser.id, true));
      if (JSON.stringify(userTrophyCache.get(currentUser.id) || null) !== before) renderProfileCard();   // a faixa de troféus do card
    }
    /* Faixa de troféus no card de atleta. */
    function cardTrophiesHtml(list) {
      if (!list || !list.length) return '';
      const kinds = [...new Set(list.map(x => x.kind))].slice(0, 5);
      return `<div class="acard-trophies">${kinds.map(k => `<i class="fa-solid ${TROPHY_ICON[k] || 'fa-trophy'}"></i>`).join('')}<span>${list.length} troféu${list.length === 1 ? '' : 's'}</span></div>`;
    }
