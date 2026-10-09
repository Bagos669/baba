// In-memory stand-in for the support panel's server (rules mirror v8_suporte_painel.sql).
(function () {
  const STAFF = '00000000-0000-0000-0000-0000000000ee';
  const now = Date.now();
  const iso = ms => new Date(ms).toISOString();
  const day = n => { const d = new Date(now - n * 864e5); return d.toISOString().slice(0, 10); };
  const NAMES = ['Gabriel Marini', 'Lucas Souza', 'Pedro Henrique', 'Rafa Lima', 'João Vitor', 'Caio Alves', 'Bruno Dias', 'Mateus Rocha', 'Thiago Reis', 'Felipe Nunes',
    'André Costa', 'Diego Melo', 'Igor Santos', 'Leo Barros', 'Vini Gomes', 'Davi Pinto', 'Enzo Ramos', 'Gui Teixeira', 'Hugo Freitas', 'Ivan Moura',
    'Julio Cesar', 'Kaique Lopes', 'Marcos Paulo', 'Nando Silva', 'Otávio Prado', 'Paulo Vitor', 'Renan Cruz', 'Samuel Brito', 'Tiago Leal', 'Wesley Dutra'];
  const users = [{ id: STAFF, email: 'contatobabaapp@gmail.com', name: 'Suporte BABA', avatar: '🛟', created_at: iso(now - 2 * 864e5), last_sign_in_at: iso(now - 3e5), last_active: day(0), turmas: 0, balance: 999999999, terms_version: '1.0', adult: true, staff: true, banned: false, age: 30 }];
  NAMES.forEach((n, i) => users.push({
    id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`, email: n.toLowerCase().replace(/[^a-z]+/g, '.') + '@gmail.com', name: n,
    avatar: i % 7 === 0 ? 'photo' : i % 5 === 0 ? '⚽' : null, created_at: iso(now - (i * 3 + 1) * 864e5), last_sign_in_at: iso(now - (i % 9) * 864e5 - 3600e3),
    last_active: i % 6 === 5 ? day(40) : day(i % 9), turmas: i % 4 === 3 ? 0 : 1 + (i % 2), balance: 1000 + i * 37, terms_version: i % 11 === 10 ? null : '1.0',
    adult: i % 8 !== 7, staff: false, banned: i === 12, age: i % 8 === 7 ? 17 : 20 + i
  }));
  const ban = { '00000000-0000-0000-0000-000000000013': { reason: 'xingou no chat', until: iso(now + 2 * 864e5), at: iso(now - 864e5) } };
  const items = [['frame_bronze', 'frame', 'bronze', 'Moldura Bronze', 300], ['frame_prata', 'frame', 'prata', 'Moldura Prata', 500], ['frame_ouro', 'frame', 'ouro', 'Moldura Ouro', 900],
    ['frame_diamante', 'frame', 'diamante', 'Moldura Diamante', 4000], ['name_ouro', 'name', 'ouro', 'Nome Ouro', 900], ['fx_frame_shine', 'fx', null, 'Brilho na moldura', 600]]
    .map(([id, kind, tier, title, price]) => ({ id, kind, tier, title, price }));
  const owned = { '00000000-0000-0000-0000-000000000001': ['frame_bronze', 'frame_prata'] };
  const turmas = [
    { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Fiasco FC', icon: '🔥', owner_id: users[1].id, members: 14, players: 22, babas: 31, last_baba: iso(now - 864e5), created_at: iso(now - 80 * 864e5), invite_code: 'FIAS-CO22', staff_in: false },
    { id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Pelada de Quinta', icon: null, owner_id: users[4].id, members: 9, players: 15, babas: 12, last_baba: iso(now - 6 * 864e5), created_at: iso(now - 50 * 864e5), invite_code: 'QUIN-TA99', staff_in: false },
    { id: 'aaaaaaaa-0000-0000-0000-000000000003', name: 'Os Cansados', icon: 'data:image/png;base64,xx', owner_id: users[9].id, members: 4, players: 8, babas: 0, last_baba: null, created_at: iso(now - 10 * 864e5), invite_code: 'CANS-ADO1', staff_in: false }
  ];
  const tmembers = {};
  turmas.forEach((t, k) => { tmembers[t.id] = users.slice(1 + k * 3, 1 + k * 3 + 5).map((u, j) => ({ user_id: u.id, name: u.name, email: u.email, role: u.id === t.owner_id ? 'owner' : j === 1 ? 'admin' : 'member' })); });
  const lives = [
    { id: 'bbbbbbbb-0000-0000-0000-000000000001', code: 'K7P2QX', title: 'Fiasco FC · Quinta', owner_name: users[1].name, active: true, palpites: true, updated_at: iso(now - 6e4), open_palpites: 7, total_palpites: 23, viewers_chat: 9 },
    { id: 'bbbbbbbb-0000-0000-0000-000000000002', code: 'ZZ81MM', title: 'Pelada de Quinta', owner_name: users[4].name, active: false, palpites: true, updated_at: iso(now - 3 * 864e5), open_palpites: 0, total_palpites: 41, viewers_chat: 12 }
  ];
  const reports = [
    { message_id: 501, body: 'vocês são muito ruins, larguem o futebol', room: 'turma:' + turmas[0].id, author_id: users[6].id, author_name: users[6].name, author_email: users[6].email, created_at: iso(now - 7200e3), deleted: false, reports: 2, reasons: ['ofensa', ''], last_report: iso(now - 3600e3) },
    { message_id: 502, body: 'compre seguidores em www.spam.example', room: 'live:' + lives[0].id, author_id: users[20].id, author_name: users[20].name, author_email: users[20].email, created_at: iso(now - 864e5), deleted: true, reports: 3, reasons: ['spam'], last_report: iso(now - 80000e3) }
  ];
  const log = [{ id: 1, staff_name: 'Suporte BABA', action: 'pontos', target: users[2].id, details: { delta: 500, motivo: 'erro no placar' }, at: iso(now - 864e5) }];
  let notice = null;
  const calls = [];
  window.__adminCalls = calls;
  let logId = 2;
  const addLog = (action, target, details) => log.unshift({ id: logId++, staff_name: 'Suporte BABA', action, target, details, at: iso(Date.now()) });
  const err = code => { const e = new Error(code); e.code = 'P0001'; return e; };
  const U = id => { const u = users.find(x => x.id === id); if (!u) throw err('not_found'); return u; };

  const RPC = {
    am_i_staff: () => window.__adminSession && window.__adminSession.user.id === STAFF,
    my_status: () => [{ staff: true, banned_until: null, banned_reason: null, notice: notice && notice.message, notice_level: notice && notice.level }],
    admin_overview: () => ({
      users: users.length, new_7d: 3, new_30d: 11, active_1d: 6, active_7d: 19, active_30d: 26, signin_7d: 21, terms_ok: users.filter(u => u.terms_version).length,
      adults: 26, turmas: turmas.length, turmas_active_30d: 2, babas_done: 43, babas_done_7d: 5, babas_open: 2, matches: 388, goals: 1204, live_now: 1, live_total: 2,
      palpites: 64, palpites_open: 7, pts_staked: 9120, pts_paid: 7340, items_sold: 18, msgs_7d: 211, reports_open: reports.filter(r => !r.deleted).length,
      deleted_30d: 2, deleted_total: 3, inactive_30d: 5, never_accepted: users.filter(u => !u.terms_version).length, no_turma: users.filter(u => !u.turmas).length, banned: Object.keys(ban).length
    }),
    admin_series: ({ days }) => Array.from({ length: days }, (_, k) => {
      const i = days - 1 - k, w = new Date(now - i * 864e5).getDay();
      const base = Math.max(0, Math.round((days - i) / days * 14 + (w === 4 ? 9 : w === 6 ? 7 : 0) + (k * 7 % 5)));
      return { day: day(i), signups: (k * 13) % 4 === 0 ? 2 : (k % 3), active: base, babas: w === 4 || w === 6 ? 1 + (k % 2) : 0, palpites: w === 4 ? 6 + (k % 5) : (k % 4 === 0 ? 1 : 0), messages: base * 2 + (k % 7) };
    }),
    admin_users: ({ search, lim, off }) => {
      const q = String(search || '').toLowerCase();
      return users.filter(u => !q || u.email.includes(q) || u.name.toLowerCase().includes(q)).slice(off, off + lim)
        .map(u => Object.assign({}, u, { banned: !!ban[u.id], cosmetics: {} }));
    },
    admin_user: ({ uid }) => {
      const u = U(uid);
      return Object.assign({}, u, {
        avatar: u.avatar === 'photo' ? 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#2e7d54"/></svg>') : u.avatar,
        terms_at: u.terms_version ? u.created_at : null, ban: ban[uid] || null, active_days_30: 12, cosmetics: {},
        turmas: turmas.filter(t => (tmembers[t.id] || []).some(m => m.user_id === uid)).map(t => ({ id: t.id, name: t.name, role: tmembers[t.id].find(m => m.user_id === uid).role, members: t.members })),
        wallet: { balance: u.balance, daily_on: day(0) }, items: (owned[uid] || []).slice(),
        ledger: [{ id: 3, delta: -50, reason: 'palpite', ref: 'x', created_at: iso(now - 3600e3) }, { id: 2, delta: 100, reason: 'bonus-diario', ref: day(0), created_at: iso(now - 7200e3) }, { id: 1, delta: 1000, reason: 'boas-vindas', ref: null, created_at: u.created_at }],
        palpites: [{ id: 9, label: 'Gabriel Marini faz gol', odd: 2.4, stake: 50, status: 'won', payout: 120, created_at: iso(now - 864e5) }, { id: 8, label: 'Time A vence', odd: 1.8, stake: 30, status: 'lost', payout: 0, created_at: iso(now - 2 * 864e5) }],
        babas: [{ id: 'c1', title: 'Quinta no society', played_on: day(1), finished: true, matches: 9, updated_at: iso(now - 864e5) }],
        messages: [{ id: 1, room: 'turma:x', body: 'bora sexta?', deleted: false, created_at: iso(now - 5e6) }],
        reports_against: reports.filter(r => r.author_id === uid).length
      });
    },
    admin_adjust_points: ({ uid, delta, why }) => { const u = U(uid); if (!delta) throw err('bad_delta'); u.balance = Math.max(0, u.balance + delta); addLog('pontos', uid, { delta, motivo: why }); return u.balance; },
    admin_grant_item: ({ uid, item }) => { (owned[uid] = owned[uid] || []).push(item); addLog('dar-item', uid, { item }); },
    admin_reset_cosmetics: ({ uid }) => { addLog('zerar-visual', uid, null); },
    admin_rename_user: ({ uid, new_name }) => { if (!new_name || new_name.length > 60) throw err('bad_name'); U(uid).name = new_name; addLog('renomear', uid, { nome: new_name }); },
    admin_clear_avatar: ({ uid }) => { U(uid).avatar = null; addLog('tirar-foto', uid, null); },
    admin_ban: ({ uid, hours, why }) => { if (U(uid).staff) throw err('is_staff'); ban[uid] = { reason: why, until: hours ? iso(Date.now() + hours * 3600e3) : null, at: iso(Date.now()) }; addLog('suspender', uid, { horas: hours, motivo: why }); },
    admin_unban: ({ uid }) => { delete ban[uid]; addLog('reativar', uid, null); },
    admin_set_staff: ({ uid, make }) => { if (!make && uid === STAFF) throw err('not_self'); U(uid).staff = make; addLog(make ? 'dar-suporte' : 'tirar-suporte', uid, null); },
    admin_turmas: ({ search }) => { const q = String(search || '').toLowerCase(); return turmas.filter(t => !q || t.name.toLowerCase().includes(q)).map(t => { const o = users.find(u => u.id === t.owner_id) || {}; return Object.assign({}, t, { owner_name: o.name || null, owner_email: o.email || null, staff_in: (tmembers[t.id] || []).some(m => m.user_id === STAFF) }); }); },
    admin_turma_members: ({ t }) => tmembers[t] || [],
    admin_join_turma: ({ t }) => { tmembers[t].push({ user_id: STAFF, name: 'Suporte BABA', email: users[0].email, role: 'member' }); addLog('entrar-turma', t, null); },
    admin_leave_turma: ({ t }) => { tmembers[t] = tmembers[t].filter(m => m.user_id !== STAFF); addLog('sair-turma', t, null); },
    admin_transfer_turma: ({ t, new_owner }) => { const tt = turmas.find(x => x.id === t); tmembers[t].forEach(m => { if (m.user_id === tt.owner_id) m.role = 'admin'; if (m.user_id === new_owner) m.role = 'owner'; }); tt.owner_id = new_owner; addLog('passar-turma', t, { para: new_owner }); },
    admin_lives: () => lives,
    admin_end_live: ({ live }) => { const g = lives.find(x => x.id === live); const n = g.open_palpites; g.active = false; g.open_palpites = 0; addLog('encerrar-ao-vivo', live, null); return n; },
    admin_reports: () => reports,
    admin_resolve_report: ({ msg, act }) => { const r = reports.find(x => x.message_id === msg); if (act === 'delete') { r.deleted = true; r.body = '-'; } else if (act === 'restore') r.deleted = false; else reports.splice(reports.indexOf(r), 1); addLog('denuncia-' + act, String(msg), null); },
    admin_set_notice: ({ message, lvl }) => { notice = message ? { message, level: lvl } : null; addLog('aviso', null, { mensagem: message }); },
    admin_log: () => log
  };
  window.__BABA_ADMIN_FAKE__ = {
    async session() { return window.__adminSession || null; },
    async signIn(email, password) {
      await new Promise(r => setTimeout(r, 120));
      const u = users.find(x => x.email === email);
      if (!u || password !== 'senha123') { const e = new Error('Invalid login credentials'); throw e; }
      window.__adminSession = { access_token: 't', user: { id: u.id, email: u.email } };
      return window.__adminSession;
    },
    async signOut() { window.__adminSession = null; },
    async rpc(name, args) {
      calls.push([name, args || {}]);
      await new Promise(r => setTimeout(r, 40));
      if (name !== 'am_i_staff' && !(window.__adminSession && window.__adminSession.user.id === STAFF)) throw err('not_staff');
      if (!RPC[name]) { const e = new Error('Could not find the function public.' + name); e.code = 'PGRST202'; throw e; }
      return RPC[name](args || {});
    },
    async items() { return items; },
    async fn(action, body) {
      calls.push(['fn:' + action, body]);
      await new Promise(r => setTimeout(r, 60));
      const u = U(body.user_id);
      if (action === 'staff_code') { addLog('novo-codigo', u.id, null); return { ok: true, code: 'K3M9-7QPX-2WRT' }; }
      if (action === 'staff_password') { addLog('senha-provisoria', u.id, null); return { ok: true }; }
      if (action === 'staff_block') { if (u.staff) { const e = new Error('is_staff'); e.code = 'is_staff'; throw e; } addLog(body.hours ? 'bloquear-login' : 'liberar-login', u.id, { horas: body.hours }); return { ok: true }; }
      if (action === 'staff_delete') { users.splice(users.indexOf(u), 1); addLog('excluir-conta', u.id, { email: u.email }); return { ok: true }; }
      throw new Error('unknown_action');
    }
  };
})();
