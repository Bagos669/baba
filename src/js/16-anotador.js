    /* ===================================================================
       ANOTADOR ÚNICO E MESÁRIO (v11.6.1)
       Só uma pessoa anota os lances por vez (o anotador). Cada lance vai
       para o servidor e só conta quando ele confirma (enviando → confirmado,
       ou falhou com "Tentar de novo"). Dono e adms podem assumir a anotação
       ou passar a vez para um presente com conta (o mesário), que anota,
       controla o relógio e encerra as partidas, mas não mexe em chegadas,
       times, fila nem configurações.
       =================================================================== */
    let babaRole = null;         // { id, scorer, scorerName, mesario, mesarioName, my: 'org'|'mesario'|'viewer' }
    let lanceOff = false;        // servidor sem baba_lance: lances voltam a ser gravados só no celular (como antes)
    let lanceQ = [];             // [{ lance, status: 'wait'|'sending'|'failed'|'refused'|'ok', msg }]
    let lancePumping = false;
    let becomingMesario = false;
    const MESARIO_SEEN = 'baba_mesario_seen_v1161:';

    const roleHere = () => (babaRole && state.babaId && babaRole.id === state.babaId ? babaRole : null);
    const isMesario = () => !!(roleHere() && roleHere().my === 'mesario');
    const isViewer = () => !!(roleHere() && roleHere().my === 'viewer');
    const isOrgHere = () => !roleHere() || roleHere().my === 'org';
    const canPushBaba = () => !isViewer();
    // Lances passam pelo servidor quando a conta está na nuvem e o servidor já tem a v11.6.1.
    const lanceMode = () => !!(cloudOn() && !sharedOff && !lanceOff);
    function canScore() {
      const r = roleHere();
      if (!lanceMode() || !r) return true;
      if (r.scorer) return r.scorer === myUid();
      return r.my === 'org';
    }
    const lanceBusy = () => lanceQ.some(x => x.status === 'sending');
    const lancesPending = () => lanceQ.some(x => x.status !== 'ok' && x.status !== 'refused');

    /* Papel deste aparelho no baba (vem do servidor junto com a versão). */
    function setBabaRole(id, r) {
      if (!r || !('my_role' in r)) return;
      const prev = babaRole && babaRole.id === id ? babaRole : null;
      babaRole = { id, scorer: r.scorer_id || null, scorerName: r.scorer_name || '', mesario: r.mesario_id || null, mesarioName: r.mesario_name || '', my: r.my_role || 'org' };
      if (prev && prev.scorer === myUid() && babaRole.scorer && babaRole.scorer !== myUid()) {
        showToast(`${firstName(babaRole.scorerName || 'Alguém')} assumiu a anotação`, 'warning');
      }
      if (babaRole.my === 'mesario' && !(prev && prev.my === 'mesario') && state.babaId === id) announceMesario(id);
      renderScorerUI();
    }

    function announceMesario(id) {
      if (lsGet(MESARIO_SEEN + id)) { showToast('Você é o mesário deste baba'); return; }
      lsSet(MESARIO_SEEN + id, '1');
      showPopup({ img: 'coach', eyebrow: 'Mesário', title: 'Você é o mesário deste baba',
        html: '<p class="text-[15px] leading-relaxed">Você anota gols, assistências e defesas, controla o cronômetro e encerra as partidas. Chegadas, times e fila continuam com o dono e os adms.</p>',
        ok: 'Abrir o placar', onClose: () => switchTab('placar') });
    }

    /* Escolheram este aparelho como mesário: abre aquele baba aqui. */
    async function becomeMesario(id) {
      if (becomingMesario || state.babaId === id) return;
      becomingMesario = true;
      try {
        if (hasBabaContent() && !(await askConfirm('Você foi escolhido como mesário de um baba. Abrir esse baba neste aparelho? O que está aberto aqui continua salvo.', 'Abrir'))) return;
        const full = await api.babaGet(id);
        if (!full || full.finished) return;
        pushNow();
        adoptShared(full, null);
      } catch (e) {
      } finally { becomingMesario = false; }
    }

    /* Só dono e adms (o mesário e quem só está olhando não mexem). */
    function orgOnly() {
      if (isMesario() || isViewer()) { showToast(isMesario() ? 'O mesário só anota, controla o relógio e encerra a partida. O resto é com o dono e os adms.' : 'Você está só olhando este baba.', 'warning'); return false; }
      return true;
    }
    function notViewer() {
      if (isViewer()) { showToast('Você está só olhando este baba.', 'warning'); return false; }
      return true;
    }

    /* Barra do anotador no Placar, botões de lance travados para quem não anota e o modo quadra. */
    function renderScorerUI() {
      const r = roleHere();
      const shared = !!(r && lanceMode() && state.firstKickoffAt);
      document.body.classList.toggle('baba-mesario', isMesario());
      document.body.classList.toggle('baba-viewer', isViewer());
      const lock = !canScore();
      ['btn-goal-a', 'btn-goal-b', 'btn-save-a', 'btn-save-b', 'btn-undo', 'cm-goal-a', 'cm-goal-b', 'cm-save-a', 'cm-save-b', 'cm-undo'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('lance-locked', lock);
      });
      const bar = document.getElementById('scorer-bar');
      const cm = document.getElementById('cm-scorer');
      if (!bar) return;
      bar.classList.toggle('hidden', !shared);
      if (cm) cm.classList.toggle('hidden', !shared || !lock);
      if (!shared) return;
      const me = myUid();
      const name = r.scorer === me ? 'você' : firstName(r.scorerName || 'alguém');
      let text, sub;
      if (isMesario()) { text = 'Você é o mesário deste baba'; sub = 'Anote os lances, controle o relógio e encerre as partidas.'; }
      else if (isViewer()) { text = `Anotador: ${name}`; sub = 'Você está só olhando este baba.'; }
      else if (r.scorer === me) { text = 'Anotador: você'; sub = 'Só você registra os lances agora.'; }
      else { text = `Anotador: ${name}`; sub = r.mesario && r.mesario === r.scorer ? 'Mesário deste baba. Os botões de lance ficam com ele.' : 'Os botões de lance ficam com quem está anotando.'; }
      document.getElementById('scorer-bar-text').innerText = text;
      document.getElementById('scorer-bar-sub').innerText = sub;
      document.getElementById('scorer-bar-icon').className = `tile w-10 h-10 rounded-xl ${r.scorer === me ? 'bg-pitch text-butter' : 'bg-sunk text-pitch'}`;
      const btns = [];
      if (r.my === 'org' && r.scorer !== me) btns.push('<button id="btn-take-scoring" onclick="takeScoring()" class="btn-primary h-9 px-3.5 text-[12.5px] whitespace-nowrap">Assumir anotação</button>');
      if (r.my === 'org') btns.push('<button id="btn-pass-scoring" onclick="openMesarioPicker()" class="btn-outline h-9 px-3.5 text-[12.5px] whitespace-nowrap">Passar a vez de anotar</button>');
      document.getElementById('scorer-bar-btns').innerHTML = btns.join('');
      if (cm) cm.innerText = `Anotador: ${name}`;
    }

    async function takeScoring() {
      if (!roleHere() || roleHere().my !== 'org') return;
      if (navigator.onLine === false) { showToast('Assumir a anotação precisa de internet.', 'warning'); return; }
      try {
        await flushOutbox();
        const r = await api.takeScoring(state.babaId);
        await refetchShared(state.babaId);
        showToast(`Você está anotando os lances${r && r.scorer_name ? '' : ''}.`);
      } catch (e) {
        showToast(isNetworkError(e) ? 'Sem conexão. Tente de novo.' : 'Não consegui assumir a anotação.', 'warning');
      }
    }

    /* Passar a vez: presentes com conta (o servidor confere de novo). */
    function openMesarioPicker() {
      if (!roleHere() || roleHere().my !== 'org') return;
      const me = myUid();
      const list = presentPlayers().map(p => ({ p, uid: userIdOfPlayer(p) })).filter(x => x.uid && x.uid !== me && x.uid !== roleHere().scorer);
      const box = document.getElementById('mesario-list');
      box.innerHTML = list.length ? list.map(x => `
          <button class="pick-btn" data-mesario="${x.uid}" onclick="chooseMesario('${x.uid}', '${escapeHtml(x.p.name).replace(/'/g, '&#39;')}')">
            <span class="truncate">${escapeHtml(x.p.name)}</span><span class="text-pitch text-[12px] font-bold flex-shrink-0">Escolher</span>
          </button>`).join('')
        : '<p class="text-[13px] text-ink-2 p-2 leading-snug">Ninguém disponível. Só quem já chegou (está na Lista) e tem conta no BABA pode ser mesário.</p>';
      document.getElementById('modal-mesario').classList.remove('hidden');
    }
    function closeMesarioPicker() { document.getElementById('modal-mesario').classList.add('hidden'); }

    async function chooseMesario(uid, name) {
      closeMesarioPicker();
      if (!(await askConfirm(`Passar a vez de anotar para ${name}? A partir de agora só ${firstName(name)} registra os lances deste baba.`, 'Passar a vez'))) return;
      try {
        await flushOutbox();
        await api.setMesario(state.babaId, uid);
        await refetchShared(state.babaId);
        showToast(`${firstName(name)} está anotando os lances.`);
      } catch (e) {
        const m = String(e.message || '');
        showToast(isNetworkError(e) ? 'Sem conexão. Tente de novo.' : /not_present/.test(m) ? 'Só quem já chegou e tem conta no BABA pode ser mesário.' : 'Não consegui passar a vez.', 'warning');
      }
    }

    /* ---- Lances ---- */
    /* Aplica no celular o mesmo que o servidor aplica (baba_lance). */
    function applyLanceLocal(l) {
      const m = state.match;
      if (l.kind === 'goal') {
        if (l.side === 'A') m.scoreA++; else m.scoreB++;
        const s = byId(l.scorerId); if (s) s.goals = (s.goals || 0) + 1;
        const a = l.assistId != null && l.assistId !== l.scorerId ? byId(l.assistId) : null; if (a) a.assists = (a.assists || 0) + 1;
        m.events.unshift({ lid: l.lid, type: 'goal', side: l.side, el: l.el, scorerId: l.scorerId, assistId: l.assistId, time: l.time, text: l.text });
      } else if (l.kind === 'save') {
        const k = byId(l.keeperId); if (k) k.saves = (k.saves || 0) + 1;
        m.events.unshift({ lid: l.lid, type: 'save', side: l.side, el: l.el, keeperId: l.keeperId, time: l.time, text: l.text });
      } else if (l.kind === 'extra') {
        m.addedSeconds = (m.addedSeconds || 0) + l.seconds;
        m.secondsLeft = (m.secondsLeft || 0) + l.seconds;
        if (m.isRunning && m.endAt) m.endAt += l.seconds * 1000;
        m.events.unshift({ lid: l.lid, type: 'extra', seconds: l.seconds, time: l.time, text: l.text });
      } else if (l.kind === 'adjust') {
        // Correção manual (ficha do jogador): valores finais, fora da lista de lances da partida.
        const p = byId(l.playerId);
        if (p) ['goals', 'assists', 'saves'].forEach(k => { if (typeof l[k] === 'number') p[k] = Math.max(0, Math.min(99, l[k])); });
      } else if (l.kind === 'undo') {
        const ev = m.events[0];
        if (!ev) return;
        if (ev.type === 'goal') {
          if (ev.side === 'A') m.scoreA = Math.max(0, m.scoreA - 1); else m.scoreB = Math.max(0, m.scoreB - 1);
          const s = byId(ev.scorerId); if (s) s.goals = Math.max(0, (s.goals || 0) - 1);
          const a = ev.assistId != null && ev.assistId !== ev.scorerId ? byId(ev.assistId) : null; if (a) a.assists = Math.max(0, (a.assists || 0) - 1);
        } else if (ev.type === 'save') {
          const k = byId(ev.keeperId); if (k) k.saves = Math.max(0, (k.saves || 0) - 1);
        } else if (ev.type === 'extra') {
          const secs = Math.min(ev.seconds || 0, m.addedSeconds || 0);
          m.addedSeconds = (m.addedSeconds || 0) - secs;
          m.secondsLeft = Math.max(0, m.secondsLeft - secs);
          if (m.isRunning && m.endAt) m.endAt -= secs * 1000;
          if (m.isRunning && m.secondsLeft === 0) pauseMatchTimer();
        }
        m.events.shift();
      }
    }

    /* Registra um lance: no servidor (só conta quando ele confirma) ou, sem servidor novo, só no celular como antes. */
    function submitLance(l) {
      l.lid = uuid();
      l.match_no = state.matchHistory.length + 1;
      if (!lanceMode()) {
        applyLanceLocal(l);
        saveState();
        afterLance(l);
        return;
      }
      lanceQ.push({ lance: l, status: 'wait', msg: '' });
      renderLanceStatus();
      pumpLances();
    }

    const LANCE_REFUSED = {
      not_scorer: () => `Recusado: ${firstName((roleHere() || {}).scorerName || 'outra pessoa')} está anotando.`,
      stale_match: () => 'Recusado: essa partida já foi encerrada.',
      not_last: () => 'Recusado: esse já não é o último lance.',
      nothing_to_undo: () => 'Recusado: não há lance para desfazer.',
      no_court: () => 'Recusado: esse time não está em quadra.',
      finished: () => 'Recusado: o baba já foi finalizado.',
      forbidden: () => 'Recusado: sem permissão.',
      no_player: () => 'Recusado: esse atleta ainda não está no baba do servidor. Tente de novo.'
    };

    async function pumpLances() {
      if (lancePumping) return;
      lancePumping = true;
      try {
        while (true) {
          const i = lanceQ.findIndex(x => x.status === 'wait' || x.status === 'failed');
          if (i < 0) break;
          const item = lanceQ[i];
          if (item.status === 'failed') break;       // a fila espera o "Tentar de novo" (a ordem dos lances importa)
          item.status = 'sending'; item.msg = '';
          renderLanceStatus();
          try {
            if (navigator.onLine === false) throw new TypeError('Failed to fetch');
            await ensureBabaOnServer();
            // Correção de um atleta recém-adicionado: a gravação com ele precisa chegar antes.
            if (item.lance.kind === 'adjust' && pendingUpsertFor(state.babaId)) await flushOutbox();
            const res = await api.lanceBaba(state.babaId, item.lance);
            await onLanceConfirmed(item.lance, res || {});
            item.status = 'ok';
            setTimeout(() => { lanceQ = lanceQ.filter(x => x !== item); renderLanceStatus(); }, 1600);
          } catch (e) {
            const code = Object.keys(LANCE_REFUSED).find(k => String(e.message || '').includes(k));
            if (item.lance.kind === 'adjust' && /invalid/.test(String(e.message || ''))) {
              // Servidor sem a v11.7.1: ainda não aceita correção manual.
              item.status = 'refused';
              item.msg = 'O servidor ainda não aceita corrigir números: falta rodar o SQL da v11.7.1.';
            } else if (isMissingFn(e)) {
              // Servidor ainda sem a v11.6.1: grava como antes, só no celular.
              lanceOff = true;
              lanceQ.filter(x => x.status !== 'ok' && x.status !== 'refused').forEach(x => { applyLanceLocal(x.lance); afterLance(x.lance); x.status = 'ok'; });
              lanceQ = [];
              saveState();
            } else if (code) {
              item.status = 'refused'; item.msg = LANCE_REFUSED[code]();
              if (code === 'not_scorer') {
                lanceQ.filter(x => x.status === 'wait').forEach(x => { x.status = 'refused'; x.msg = item.msg; });
                refetchShared(state.babaId);
              }
            } else {
              item.status = 'failed';
              item.msg = isNetworkError(e) ? 'Sem conexão' : 'Não foi enviado';
            }
          }
          renderLanceStatus();
        }
      } finally { lancePumping = false; renderLanceStatus(); }
    }

    /* O baba precisa existir no servidor antes do primeiro lance. */
    async function ensureBabaOnServer() {
      if (!state.babaId) { state.babaId = uuid(); state.createdBy = myUid(); cacheState(); }
      if (!state.rev && !pendingUpsertFor(state.babaId)) pushBabaNow();
      for (let i = 0; i < 40 && pendingUpsertFor(state.babaId) && !state.rev; i++) {
        await flushOutbox();
        if (!pendingUpsertFor(state.babaId)) break;
        if (navigator.onLine === false || syncState === 'offline') throw new TypeError('Failed to fetch');
        await new Promise(r => setTimeout(r, 250));
      }
    }

    async function onLanceConfirmed(l, res) {
      const id = state.babaId;
      const local = !res.dup && Number(res.rev) === (state.rev || 0) + 1;
      if (local) {
        applyLanceLocal(l);
        state.rev = Number(res.rev);
        state.lanceSeq = Number(res.lance_seq) || state.lanceSeq;
        cacheState();
        renderAllComponents();
        scheduleLivePush(true);
      } else {
        // Outro aparelho também mudou o baba (ou o lance já tinha chegado): pega o estado do servidor, que já tem o lance.
        const full = await api.babaGet(id);
        if (full && state.babaId === id) adoptShared(full, null);
      }
      afterLance(l);
    }

    function retryLance(lid) {
      const it = lanceQ.find(x => x.lance.lid === lid);
      if (it && it.status === 'failed') { it.status = 'wait'; it.msg = ''; }
      pumpLances();
    }
    function dropLance(lid) {
      lanceQ = lanceQ.filter(x => x.lance.lid !== lid);
      renderLanceStatus();
      pumpLances();
    }

    const lanceLabel = l => l.kind === 'adjust' ? `Correção de ${l.playerName || 'atleta'}` : l.kind === 'undo' ? 'Desfazer último lance' : l.kind === 'extra' ? `Acréscimo de ${Math.round(l.seconds / 60)} min` : (l.text || '').replace(/^\S+\s/, '');
    function renderLanceStatus() {
      const box = document.getElementById('lance-status');
      const off = document.getElementById('lance-offline');
      if (!box) return;
      const visible = lanceQ.filter(x => x.status !== 'gone');
      box.classList.toggle('hidden', !visible.length);
      box.innerHTML = visible.map(x => {
        const st = x.status === 'ok' ? '<span class="text-leaf font-extrabold flex items-center gap-1"><i class="fa-solid fa-circle-check"></i> Confirmado</span>'
          : x.status === 'sending' ? '<span class="text-ink-2 font-bold flex items-center gap-1"><i class="fa-solid fa-spinner fa-spin"></i> Enviando…</span>'
          : x.status === 'wait' ? '<span class="text-ink-2 font-bold">Na fila</span>'
          : x.status === 'failed' ? `<span class="text-danger font-extrabold">Falhou</span><button onclick="retryLance('${x.lance.lid}')" class="h-8 px-3 rounded-full bg-pitch text-butter text-[12px] font-extrabold">Tentar de novo</button><button onclick="dropLance('${x.lance.lid}')" class="w-8 h-8 rounded-full bg-sunk text-ink-2" aria-label="Descartar"><i class="fa-solid fa-xmark"></i></button>`
          : `<button onclick="dropLance('${x.lance.lid}')" class="w-8 h-8 rounded-full bg-sunk text-ink-2" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>`;
        return `<div class="card px-3 py-2 flex items-center gap-2 text-[13px]" data-lance="${x.lance.lid}" data-status="${x.status}">
            <span class="min-w-0 flex-1"><span class="block font-bold truncate">${escapeHtml(lanceLabel(x.lance))}</span>${x.msg ? `<span class="block text-[12px] text-ink-2">${escapeHtml(x.msg)}</span>` : ''}</span>
            <span class="flex items-center gap-1.5 flex-shrink-0">${st}</span>
          </div>`;
      }).join('');
      if (off) off.classList.toggle('hidden', !lanceQ.some(x => x.status === 'failed' && x.msg === 'Sem conexão') && !(navigator.onLine === false && lanceQ.some(x => x.status !== 'ok' && x.status !== 'refused')));
    }
    window.addEventListener('offline', renderLanceStatus);
    window.addEventListener('online', renderLanceStatus);
