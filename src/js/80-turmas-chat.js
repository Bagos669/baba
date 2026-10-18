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

