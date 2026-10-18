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
    const APP_VERSION = '11.3.4';
    const NOTES_KEY = 'baba_notes_seen_v1';
    const PATCH_NOTES = [
      { v: '11.3.4', date: '18/10/2026', title: 'Organização interna', items: [
        'Organização interna do código, sem mudanças visíveis.'
      ] },
      { v: '11.3.2', date: '17/10/2026', title: 'Moldura do perfil corrigida', items: [
        'A moldura e o brilho que você comprou na lojinha agora ficam só em volta da sua foto na barra de baixo, não no botão inteiro.'
      ] },
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

