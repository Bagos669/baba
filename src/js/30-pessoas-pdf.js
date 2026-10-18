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

