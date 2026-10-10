/* BABA · Painel de suporte.
   A separate page with its own sign-in (its session never mixes with the app's).
   Only accounts in private.staff get in; every action runs through admin_* functions
   on the server, which check the role again and write it to the log. */
(function () {
  'use strict';
  const SUPABASE_URL = 'https://gwndkwnodlfgbcpesenr.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_f-zeNQEVrZb8VIpFl_HPaA_zhhIPXFa';
  const ACCOUNT_FN = SUPABASE_URL + '/functions/v1/account';

  /* ---------- Server ---------- */
  const FAKE = window.__BABA_ADMIN_FAKE__ || null;
  let sb = null;
  if (!FAKE && window.supabase && window.supabase.createClient) {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'baba_admin_v1' }
    });
  }
  const B = FAKE || {
    async session() { const { data } = await sb.auth.getSession(); return data ? data.session : null; },
    async signIn(email, password) { const { data, error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; return data.session; },
    async signOut() { try { await sb.auth.signOut({ scope: 'local' }); } catch (e) {} },
    async rpc(name, args) { const { data, error } = await sb.rpc(name, args || {}); if (error) throw error; return data; },
    async items() { const { data, error } = await sb.from('shop_items').select('id, kind, tier, title, price').order('sort'); if (error) throw error; return data || []; },
    async fn(action, body) {
      const s = await B.session();
      const res = await fetch(ACCOUNT_FN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: 'Bearer ' + (s ? s.access_token : '') },
        body: JSON.stringify(Object.assign({ action }, body))
      });
      let data = {};
      try { data = await res.json(); } catch (e) {}
      if (!res.ok) { const err = new Error(data.error || 'server_error'); err.code = data.error; throw err; }
      return data;
    }
  };

  const ERR = {
    not_staff: 'Esta conta não é de suporte.',
    is_staff: 'Não dá pra fazer isso com uma conta de suporte.',
    not_self: 'Você não pode tirar o suporte da sua própria conta.',
    bad_delta: 'Valor de pontos inválido.',
    bad_name: 'Nome precisa ter de 1 a 60 letras.',
    weak_password: 'A senha precisa ter pelo menos 6 caracteres.',
    not_found: 'Não encontrado.',
    not_member: 'Essa pessoa não está na turma.',
    owner_must_transfer: 'Você é dono dessa turma: passe pra outra pessoa antes de sair.',
    unauthorized: 'Sua sessão expirou. Entre de novo.',
    server_error: 'O servidor falhou. Tente de novo.',
    'Invalid login credentials': 'E-mail ou senha incorretos.'
  };
  const missingFn = e => !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function|does not exist/i.test(String(e.message || '')));
  function errText(e) {
    if (!e) return 'Algo deu errado.';
    if (missingFn(e)) return 'O banco ainda não tem o painel. Rode o arquivo v8_suporte_painel.sql no Supabase.';
    const m = String(e.code && ERR[e.code] ? e.code : e.message || '');
    for (const k of Object.keys(ERR)) if (m.includes(k)) return ERR[k];
    if (/fetch|network/i.test(m)) return 'Sem conexão com o servidor.';
    return 'Algo deu errado: ' + m.slice(0, 120);
  }

  /* ---------- Small helpers ---------- */
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n || 0).toLocaleString('pt-BR');
  const pts = n => Number(n || 0) >= 999999999 ? '∞' : num(n);
  const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '-';
  const fmtDT = d => d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
  const fmtD = d => { if (!d) return '-'; const x = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T12:00:00') : new Date(d); return x.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }); };
  const dayLabel = d => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  function ago(d) {
    if (!d) return 'nunca';
    const x = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T12:00:00') : new Date(d);
    const days = Math.floor((Date.now() - x.getTime()) / 864e5);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) { if (days <= 0) return 'hoje'; if (days === 1) return 'ontem'; }
    const min = Math.floor((Date.now() - x.getTime()) / 6e4);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    if (min < 1440) return `há ${Math.floor(min / 60)} h`;
    if (days < 31) return `há ${days} dia${days > 1 ? 's' : ''}`;
    return fmtD(d);
  }
  const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
  function avatar(value, name, big) {
    const cls = 'av' + (big ? ' big' : '');
    if (typeof value === 'string' && value.startsWith('data:image/')) return `<span class="${cls}"><img src="${esc(value)}" alt="" /></span>`;
    if (value === 'photo') return `<span class="${cls}"><i class="fa-solid fa-camera"></i></span>`;
    if (value) return `<span class="${cls}" style="font-size:${big ? 30 : 17}px">${esc(value)}</span>`;
    return `<span class="${cls}">${esc(initials(name))}</span>`;
  }
  function toast(msg) {
    const t = $('toast');
    t.innerText = msg;
    t.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), 3200);
  }
  const busyBtn = (btn, on) => { if (btn) { btn.disabled = on; btn.classList.toggle('opacity-60', on); } };

  /* ---------- Modal (asks before every change) ---------- */
  let modalOk = null;
  function ask(opts) {
    $('modal-title').innerText = opts.title;
    $('modal-body').innerHTML = opts.body || '';
    $('modal-error').classList.add('hidden');
    const ok = $('modal-ok');
    ok.innerText = opts.ok || 'Confirmar';
    ok.className = (opts.danger ? 'btn bg-danger text-white rounded-full' : 'btn-primary') + ' flex-1 h-11 text-[14px]';
    ok.disabled = false;
    modalOk = async () => {
      busyBtn(ok, true);
      try {
        const msg = await opts.run();
        closeModal();
        if (msg) toast(msg);
      } catch (e) {
        $('modal-error').innerText = e && e.userMsg ? e.userMsg : errText(e);
        $('modal-error').classList.remove('hidden');
        busyBtn(ok, false);
      }
    };
    ok.onclick = modalOk;
    $('modal').classList.remove('hidden');
    const first = $('modal-body').querySelector('input, select, textarea');
    if (first) setTimeout(() => first.focus(), 30);
  }
  function closeModal() { $('modal').classList.add('hidden'); modalOk = null; }
  const userErr = msg => { const e = new Error(msg); e.userMsg = msg; return e; };

  /* ---------- Session ---------- */
  let me = null;
  async function boot() {
    let s = null;
    try { s = await B.session(); } catch (e) {}
    if (!s) return showLogin();
    try {
      const ok = await B.rpc('am_i_staff');
      if (!ok) { await B.signOut(); return showLogin(ERR.not_staff); }
    } catch (e) {
      return showLogin(errText(e));
    }
    me = { id: s.user.id, email: s.user.email };
    $('side-who').innerText = me.email;
    $('boot').classList.add('hidden');
    $('login').classList.add('hidden');
    $('shell').classList.remove('hidden');
    renderNav();
    route();
  }
  function showLogin(msg) {
    $('boot').classList.add('hidden');
    $('shell').classList.add('hidden');
    $('login').classList.remove('hidden');
    const e = $('login-error');
    e.classList.toggle('hidden', !msg);
    e.innerText = msg || '';
  }
  async function doLogin() {
    const email = $('login-email').value.trim().toLowerCase();
    const pass = $('login-pass').value;
    if (!email || !pass) return;
    busyBtn($('login-btn'), true);
    try {
      await B.signIn(email, pass);
      $('login-pass').value = '';
      await boot();
    } catch (e) {
      showLogin(errText(e));
    }
    busyBtn($('login-btn'), false);
  }
  async function doLogout() {
    await B.signOut();
    me = null;
    cache = {};
    showLogin();
  }
  function toggleTheme() {
    const dark = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('baba_admin_theme', dark ? 'dark' : 'light'); } catch (e) {}
    if (view === 'geral') drawCharts();
  }

  /* ---------- Navigation ---------- */
  const VIEWS = [
    { id: 'geral', icon: 'fa-chart-column', label: 'Visão geral', eyebrow: 'Como o BABA está indo' },
    { id: 'pessoas', icon: 'fa-users', label: 'Pessoas', eyebrow: 'Contas, pontos e acesso' },
    { id: 'turmas', icon: 'fa-people-group', label: 'Turmas', eyebrow: 'Grupos e donos' },
    { id: 'aovivo', icon: 'fa-tower-broadcast', label: 'Ao vivo', eyebrow: 'Jogos e palpites' },
    { id: 'denuncias', icon: 'fa-flag', label: 'Denúncias', eyebrow: 'Moderação do chat' },
    { id: 'avisos', icon: 'fa-bullhorn', label: 'Avisos', eyebrow: 'Recado pra todo mundo' },
    { id: 'registro', icon: 'fa-clock-rotate-left', label: 'Registro', eyebrow: 'Tudo que o suporte fez' }
  ];
  let view = 'geral';
  let cache = {};
  function renderNav() {
    const reports = cache.overview ? cache.overview.reports_open : 0;
    const html = VIEWS.map(v => `<a href="#${v.id}" class="nav${v.id === view ? ' on' : ''}" ${v.id === view ? 'aria-current="page"' : ''}><i class="fa-solid ${v.icon} w-4 text-center"></i> ${v.label}${v.id === 'denuncias' && reports ? `<span class="n">${reports}</span>` : ''}</a>`).join('');
    document.querySelectorAll('.nav-list').forEach(n => { n.innerHTML = html; });
  }
  function route() {
    if (!me) return;
    const id = (location.hash || '#geral').slice(1);
    view = VIEWS.some(v => v.id === id) ? id : 'geral';
    const v = VIEWS.find(x => x.id === view);
    $('view-title').innerText = v.label;
    $('view-eyebrow').innerText = v.eyebrow;
    $('view-tools').innerHTML = '';
    $('view').innerHTML = '<p class="muted font-semibold py-10 text-center"><i class="fa-solid fa-spinner fa-spin"></i> Carregando...</p>';
    renderNav();
    closeDrawer();
    ({ geral: viewGeral, pessoas: viewPessoas, turmas: viewTurmas, aovivo: viewAoVivo, denuncias: viewDenuncias, avisos: viewAvisos, registro: viewRegistro })[view]();
    window.scrollTo(0, 0);
  }
  function failView(e) {
    $('view').innerHTML = `<div class="card p-6 text-center"><img src="babinha/worried.webp" alt="" class="w-20 h-20 object-contain mx-auto" /><p class="font-bold mt-2">${esc(errText(e))}</p><button class="btn-outline h-10 px-4 mt-4 text-[14px]" onclick="route()"><i class="fa-solid fa-rotate-right"></i> Tentar de novo</button></div>`;
  }
  const section = (title, inner, sub) => `<section class="mb-7"><div class="flex items-baseline gap-2 mb-2.5 px-1"><h3 class="eyebrow">${title}</h3>${sub ? `<span class="text-[12px] faint">${sub}</span>` : ''}</div>${inner}</section>`;
  const kpi = (value, label, sub, tone) => `<div class="card kpi"><div class="v ${tone === 'bad' ? 'text-danger' : tone === 'warn' ? 'text-warn' : ''}">${value}</div><div class="l">${label}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;

  /* ---------- Visão geral ---------- */
  let period = 30;
  async function viewGeral() {
    $('view-tools').innerHTML = `
      <div class="seg grid-cols-3 w-[252px]" role="group" aria-label="Período">${[30, 60, 90].map(d => `<button class="seg-btn whitespace-nowrap${d === period ? ' is-selected' : ''}" aria-pressed="${d === period}" onclick="setPeriod(${d})">${d} dias</button>`).join('')}</div>
      <button class="btn-outline h-10 px-3.5 text-[13px]" onclick="route()"><i class="fa-solid fa-rotate-right"></i> Atualizar</button>`;
    try {
      const [o, series] = await Promise.all([B.rpc('admin_overview'), B.rpc('admin_series', { days: period })]);
      cache.overview = o; cache.series = series || [];
      renderNav();
      const sum = k => cache.series.reduce((a, r) => a + (r[k] || 0), 0);
      const inTurma = Math.max(0, o.users - o.no_turma);
      $('view').innerHTML =
        section('Agora', `<div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          ${kpi(num(o.users), 'Contas', `+${num(o.new_7d)} em 7 dias · +${num(o.new_30d)} em 30`)}
          ${kpi(num(o.active_1d), 'Ativos hoje', 'abriram o app hoje')}
          ${kpi(num(o.active_7d), 'Ativos em 7 dias', pct(o.active_7d, o.users) + ' das contas')}
          ${kpi(num(o.active_30d), 'Ativos em 30 dias', pct(o.active_30d, o.users) + ' das contas')}
          ${kpi(num(o.signin_7d), 'Fizeram login', 'nos últimos 7 dias')}
          ${kpi(num(o.live_now), 'Jogos ao vivo', `${num(o.live_total)} no total`)}
        </div>`) +
        section('Quem está saindo ou travando', `<div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          ${kpi(num(o.deleted_30d), 'Excluíram a conta', `em 30 dias · ${num(o.deleted_total)} no total`, o.deleted_30d ? 'bad' : '')}
          ${kpi(num(o.inactive_30d), 'Sumiram', 'sem abrir o app há 30+ dias', o.inactive_30d ? 'warn' : '')}
          ${kpi(num(o.never_accepted), 'Não aceitaram os termos', 'travaram na entrada', o.never_accepted ? 'warn' : '')}
          ${kpi(num(o.no_turma), 'Sem turma', 'ainda não entraram em grupo')}
          ${kpi(num(o.banned), 'Suspensos', 'pelo suporte', o.banned ? 'bad' : '')}
        </div>`) +
        section('Caminho de quem chega', `<div class="card p-5 space-y-4" id="funnel">${funnel([
          ['Criaram conta', o.users], ['Aceitaram os termos', o.terms_ok], ['Entraram numa turma', inTurma], ['Ativos em 30 dias', o.active_30d]
        ])}</div>`) +
        section(`Dia a dia`, `<div class="grid md:grid-cols-2 gap-3">
          ${chartCard('active', 'Pessoas ativas', `${num(Math.max(...cache.series.map(r => r.active), 0))} no melhor dia`)}
          ${chartCard('signups', 'Contas novas', `${num(sum('signups'))} no período`)}
          ${chartCard('babas', 'Babas finalizados', `${num(sum('babas'))} no período`)}
          ${chartCard('palpites', 'Palpites feitos', `${num(sum('palpites'))} no período`)}
          ${chartCard('messages', 'Mensagens no chat', `${num(sum('messages'))} no período`, true)}
        </div>`, `últimos ${period} dias · horário de Brasília`) +
        section('Uso do app', `<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          ${kpi(num(o.babas_done), 'Babas finalizados', `${num(o.babas_done_7d)} em 7 dias · ${num(o.babas_open)} em andamento`)}
          ${kpi(num(o.matches), 'Partidas jogadas', `${num(o.goals)} gols marcados`)}
          ${kpi(num(o.turmas), 'Turmas', `${num(o.turmas_active_30d)} jogaram em 30 dias`)}
          ${kpi(num(o.terms_ok), 'Termos aceitos', `${num(o.adults)} com 18+ (podem palpitar)`)}
          ${kpi(num(o.palpites), 'Palpites', `${num(o.palpites_open)} esperando resultado`)}
          ${kpi(num(o.pts_staked), 'Pontos apostados', `${num(o.pts_paid)} pagos em acertos`)}
          ${kpi(num(o.items_sold), 'Itens da lojinha', 'comprados pelos usuários')}
          ${kpi(num(o.msgs_7d), 'Mensagens', `em 7 dias · ${num(o.reports_open)} denúncia${o.reports_open === 1 ? '' : 's'} aberta${o.reports_open === 1 ? '' : 's'}`, o.reports_open ? 'warn' : '')}
        </div>`) +
        `<p class="text-[12px] faint px-1 -mt-3 mb-6">"Ativos" conta quem abriu o app desde que o painel foi ligado (versão 8). Login e contas novas usam o histórico completo.</p>`;
      drawCharts();
    } catch (e) { failView(e); }
  }
  function setPeriod(d) { period = d; route(); }
  function funnel(rows) {
    const top = rows[0][1] || 0;
    return rows.map(([label, v], i) => `
      <div>
        <div class="flex items-baseline gap-2 mb-1.5"><span class="text-[13.5px] font-bold flex-1">${label}</span><span class="text-[13.5px] font-extrabold num">${num(v)}</span><span class="text-[12px] faint w-12 num">${i ? pct(v, top) : ''}</span></div>
        <div class="funnel-bar"><i style="width:${top ? Math.max(1.5, v / top * 100) : 0}%"></i></div>
      </div>`).join('');
  }
  const chartCard = (key, title, sub, wide) => `<div class="card p-4${wide ? ' md:col-span-2' : ''}"><div class="flex items-baseline gap-2"><p class="font-bold text-[14px] flex-1">${title}</p><p class="text-[12px] muted">${sub}</p></div><div class="chart mt-3" data-key="${key}" data-title="${esc(title)}"></div></div>`;

  function niceMax(m) {
    if (m <= 4) return 4;
    const p = Math.pow(10, Math.floor(Math.log10(m)));
    for (const s of [1, 2, 2.5, 5, 10]) if (s * p >= m) return s * p;
    return 10 * p;
  }
  function drawCharts() {
    document.querySelectorAll('.chart[data-key]').forEach(el => barChart(el, cache.series || [], el.dataset.key, el.dataset.title));
  }
  /* One series per chart, thin bars rounded at the top, one axis, hover tooltip. */
  function barChart(el, rows, key, title) {
    const W = Math.max(240, el.clientWidth || 300), H = 150, padL = 30, padB = 20, padT = 6;
    const n = rows.length || 1;
    const vals = rows.map(r => Number(r[key]) || 0);
    const max = niceMax(Math.max(...vals, 0));
    const plotW = W - padL, plotH = H - padB - padT;
    const slot = plotW / n, gap = 2;
    const bw = Math.max(1, Math.min(24, slot - gap));
    const y = v => padT + plotH - v / max * plotH;
    let g = '';
    [0, max / 2, max].filter(t => Number.isInteger(t)).forEach(t => {
      g += `<line class="gridline" x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}" />`;
      g += `<text class="axis" x="${padL - 6}" y="${y(t) + 3.5}" text-anchor="end">${num(t)}</text>`;
    });
    let bars = '', hits = '';
    rows.forEach((r, i) => {
      const v = vals[i];
      const x = padL + i * slot + (slot - bw) / 2;
      if (v > 0) {
        const h = Math.max(2, v / max * plotH), top = padT + plotH - h, rr = Math.min(4, bw / 2, h);
        bars += `<path class="bar" d="M${x},${padT + plotH} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + bw - rr} Q${x + bw},${top} ${x + bw},${top + rr} V${padT + plotH} Z" data-i="${i}" />`;
      }
      hits += `<rect class="hit" x="${padL + i * slot}" y="${padT}" width="${slot}" height="${plotH}" data-i="${i}" />`;
    });
    const lbl = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i && rows[v]);
    const xl = lbl.map(i => `<text class="axis" x="${padL + i * slot + slot / 2}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${dayLabel(rows[i].day)}</text>`).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)} por dia">${g}${bars}${xl}${hits}</svg><div class="tip hidden"></div>`;
    const tip = el.querySelector('.tip'), svg = el.querySelector('svg');
    const show = i => {
      const r = rows[i];
      tip.innerHTML = `${num(vals[i])}<span>${dayLabel(r.day)} · ${esc(title.toLowerCase())}</span>`;
      tip.style.left = Math.min(W - 60, Math.max(60, padL + i * slot + slot / 2)) / W * 100 + '%';
      tip.style.top = (vals[i] > 0 ? y(vals[i]) : padT + plotH) / H * 150 + 'px';
      tip.classList.remove('hidden');
      svg.querySelectorAll('.bar').forEach(b => b.classList.toggle('dim', b.dataset.i !== String(i)));
    };
    const hide = () => { tip.classList.add('hidden'); svg.querySelectorAll('.bar').forEach(b => b.classList.remove('dim')); };
    svg.querySelectorAll('.hit').forEach(h => {
      h.addEventListener('mouseenter', () => show(+h.dataset.i));
      h.addEventListener('touchstart', () => show(+h.dataset.i), { passive: true });
    });
    svg.addEventListener('mouseleave', hide);
  }
  let resizeT = null;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (view === 'geral') drawCharts(); }, 150); });

  /* ---------- Pessoas ---------- */
  let peopleQ = '', peopleRows = [], peopleDone = false;
  async function viewPessoas() {
    $('view-tools').innerHTML = '';
    $('view').innerHTML = `
      <form class="flex gap-2 mb-4" onsubmit="event.preventDefault(); searchPeople(this.q.value)">
        <label class="sr-only" for="people-q">Buscar pessoa</label>
        <input id="people-q" name="q" class="field" placeholder="Buscar por nome ou e-mail" value="${esc(peopleQ)}" autocomplete="off" />
        <button class="btn-primary h-12 px-5 text-[14px]"><i class="fa-solid fa-magnifying-glass"></i><span class="hidden sm:inline">Buscar</span></button>
      </form>
      <div class="card-flat overflow-hidden"><div class="scroll-x" id="people-table"></div></div>
      <div class="text-center mt-4" id="people-more"></div>`;
    await loadPeople(true);
  }
  async function searchPeople(q) { peopleQ = String(q || '').trim(); await loadPeople(true); }
  async function loadPeople(reset) {
    if (reset) { peopleRows = []; peopleDone = false; }
    try {
      const rows = await B.rpc('admin_users', { search: peopleQ, lim: 50, off: peopleRows.length });
      peopleRows = peopleRows.concat(rows || []);
      peopleDone = (rows || []).length < 50;
      renderPeople();
    } catch (e) { failView(e); }
  }
  function personBadges(u) {
    const b = [];
    if (u.staff) b.push('<span class="badge b-staff"><i class="fa-solid fa-user-shield"></i> Suporte</span>');
    if (u.banned || u.ban) b.push('<span class="badge b-ban"><i class="fa-solid fa-ban"></i> Suspenso</span>');
    if (!u.terms_version) b.push('<span class="badge b-warn">Termos pendentes</span>');
    else if (u.adult || (u.age != null && u.age >= 18)) b.push('<span class="badge b-mute">18+</span>');
    return b.join(' ');
  }
  function renderPeople() {
    const box = $('people-table');
    if (!box) return;
    if (!peopleRows.length) { box.innerHTML = `<p class="empty">${peopleQ ? 'Ninguém encontrado com essa busca.' : 'Nenhuma conta ainda.'}</p>`; $('people-more').innerHTML = ''; return; }
    box.innerHTML = `<table class="t"><thead><tr><th>Pessoa</th><th>Situação</th><th>Conta desde</th><th>Última vez</th><th class="num">Turmas</th><th class="num">Pontos</th></tr></thead><tbody>
      ${peopleRows.map(u => `<tr class="click" tabindex="0" onclick="openUser('${u.id}')" onkeydown="if(event.key==='Enter')openUser('${u.id}')">
        <td><div class="flex items-center gap-2.5 min-w-[220px]">${avatar(u.avatar, u.name)}<div class="min-w-0"><p class="font-bold truncate">${esc(u.name || '(sem nome)')}</p><p class="text-[12px] muted truncate">${esc(u.email)}</p></div></div></td>
        <td><div class="flex gap-1 flex-wrap">${personBadges(u) || '<span class="faint">-</span>'}</div></td>
        <td class="whitespace-nowrap">${fmtD(u.created_at)}</td>
        <td class="whitespace-nowrap">${ago(u.last_active || u.last_sign_in_at)}</td>
        <td class="num">${num(u.turmas)}</td>
        <td class="num font-bold">${u.balance == null ? '<span class="faint">-</span>' : pts(u.balance)}</td>
      </tr>`).join('')}</tbody></table>`;
    $('people-more').innerHTML = peopleDone ? `<p class="text-[12px] faint">${num(peopleRows.length)} conta${peopleRows.length > 1 ? 's' : ''}</p>` : '<button class="btn-outline h-10 px-4 text-[13px]" onclick="loadPeople(false)">Carregar mais</button>';
  }

  /* ---------- Person detail ---------- */
  let current = null, shopItems = null;
  function openDrawer(title) {
    $('drawer-title').innerText = title;
    $('drawer-body').innerHTML = '<p class="muted font-semibold py-10 text-center"><i class="fa-solid fa-spinner fa-spin"></i> Carregando...</p>';
    $('drawer').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() { $('drawer').classList.add('hidden'); document.body.style.overflow = ''; current = null; }
  async function openUser(id) {
    openDrawer('Pessoa');
    try {
      const u = await B.rpc('admin_user', { uid: id });
      current = { kind: 'user', id, data: u };
      renderUser();
    } catch (e) { $('drawer-body').innerHTML = `<p class="empty">${esc(errText(e))}</p>`; }
  }
  async function reloadUser() { if (current && current.kind === 'user') { const u = await B.rpc('admin_user', { uid: current.id }); current.data = u; renderUser(); } }
  const fact = (label, value) => `<div class="bg-sunk/60 rounded-2xl px-3.5 py-2.5"><p class="text-[11px] font-bold uppercase tracking-wider muted">${label}</p><p class="text-[14px] font-bold mt-0.5">${value}</p></div>`;
  const actBtn = (icon, label, fn, danger) => `<button class="act${danger ? ' danger' : ''}" onclick="${fn}"><i class="fa-solid ${icon}"></i>${label}</button>`;
  const LEDGER = { 'boas-vindas': 'Boas-vindas', 'bonus-diario': 'Bônus do dia', lojinha: 'Lojinha', palpite: 'Palpite', 'palpite-certo': 'Palpite certo', 'palpite-devolvido': 'Palpite devolvido', suporte: 'Suporte', missao: 'Missão da semana' };
  const STATUS = { open: 'Esperando', won: 'Acertou', lost: 'Errou', void: 'Devolvido' };
  function renderUser() {
    const u = current.data;
    const isMe = me && u.id === me.id;
    const ban = u.ban;
    $('drawer-title').innerText = u.name || u.email;
    const list = (title, rows, empty) => `<div class="mt-6"><p class="eyebrow mb-2">${title}</p>${rows.length ? `<div class="card-flat divide-y divide-ink/[0.07] overflow-hidden">${rows.join('')}</div>` : `<p class="text-[13px] faint">${empty}</p>`}</div>`;
    $('drawer-body').innerHTML = `
      <div class="flex items-center gap-4">
        ${avatar(u.avatar, u.name, true)}
        <div class="min-w-0 flex-1">
          <p class="text-[20px] font-extrabold leading-tight truncate">${esc(u.name || '(sem nome)')}</p>
          <p class="text-[13px] muted truncate">${esc(u.email)}</p>
          <div class="flex gap-1 flex-wrap mt-1.5">${personBadges(u)}</div>
        </div>
      </div>
      ${ban ? `<div class="mt-4 rounded-2xl bg-danger/10 border border-danger/25 px-4 py-3 text-[13.5px]"><p class="font-bold text-danger"><i class="fa-solid fa-ban"></i> Suspenso ${ban.until ? 'até ' + fmtDT(ban.until) : 'sem prazo'}</p><p class="muted mt-0.5">${esc(ban.reason || 'Sem motivo escrito')} · desde ${fmtDT(ban.at)}</p></div>` : ''}
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-5">
        ${fact('Conta criada', fmtD(u.created_at))}
        ${fact('Último login', ago(u.last_sign_in_at))}
        ${fact('Última atividade', ago(u.last_active))}
        ${fact('Dias ativos (30)', num(u.active_days_30))}
        ${fact('Idade', u.age == null ? '-' : u.age + ' anos')}
        ${fact('Termos', u.terms_version ? 'v' + esc(u.terms_version) + ' · ' + fmtD(u.terms_at) : '<span class="text-warn">não aceitou</span>')}
        ${fact('Baba points', u.wallet ? pts(u.wallet.balance) : '-')}
        ${fact('Itens', num((u.items || []).length))}
        ${fact('Denúncias contra', num(u.reports_against))}
      </div>

      <div class="grid sm:grid-cols-2 gap-3 mt-6">
        <div class="card-flat overflow-hidden"><p class="eyebrow px-3.5 pt-3 pb-1">Pontos e lojinha</p>
          ${actBtn('fa-circle-plus', 'Dar pontos', 'actPoints(1)')}
          ${actBtn('fa-circle-minus', 'Tirar pontos', 'actPoints(-1)')}
          ${actBtn('fa-gift', 'Dar item da lojinha', 'actGrantItem()')}
          ${actBtn('fa-eraser', 'Zerar moldura e nome', 'actResetCos()')}
        </div>
        <div class="card-flat overflow-hidden"><p class="eyebrow px-3.5 pt-3 pb-1">Perfil</p>
          ${actBtn('fa-pen', 'Mudar o nome', 'actRename()')}
          ${actBtn('fa-image', 'Tirar a foto', 'actClearAvatar()')}
          ${actBtn('fa-copy', 'Copiar o ID da conta', `copyText('${u.id}')`)}
        </div>
        <div class="card-flat overflow-hidden"><p class="eyebrow px-3.5 pt-3 pb-1">Acesso</p>
          ${actBtn('fa-key', 'Novo código de recuperação', 'actNewCode()')}
          ${actBtn('fa-lock', 'Senha provisória', 'actTempPassword()')}
          ${u.staff ? '' : actBtn('fa-door-closed', 'Bloquear login', 'actBlock(true)')}
          ${u.staff ? '' : actBtn('fa-door-open', 'Liberar login', 'actBlock(false)')}
        </div>
        <div class="card-flat overflow-hidden"><p class="eyebrow px-3.5 pt-3 pb-1">Moderação e equipe</p>
          ${u.staff ? '' : ban ? actBtn('fa-circle-check', 'Reativar (tirar suspensão)', 'actUnban()') : actBtn('fa-ban', 'Suspender chat e palpites', 'actBan()', true)}
          ${isMe ? '<p class="act faint"><i class="fa-solid fa-user-shield"></i>Esta é a sua conta</p>' : u.staff ? actBtn('fa-user-minus', 'Tirar do suporte', 'actStaff(false)', true) : actBtn('fa-user-shield', 'Tornar suporte', 'actStaff(true)')}
          ${u.staff ? '' : actBtn('fa-trash', 'Excluir a conta', 'actDelete()', true)}
        </div>
      </div>

      ${list('Turmas', (u.turmas || []).map(t => `<button class="act" onclick="openTurma('${t.id}')"><i class="fa-solid fa-people-group"></i><span class="flex-1 min-w-0 truncate">${esc(t.name)}</span><span class="badge ${t.role === 'owner' ? 'b-staff' : t.role === 'admin' ? 'b-ok' : 'b-mute'}">${t.role === 'owner' ? 'Dono' : t.role === 'admin' ? 'Adm' : 'Membro'}</span><span class="text-[12px] faint">${num(t.members)} pessoas</span></button>`), 'Não está em nenhuma turma.')}
      ${list('Palpites recentes', (u.palpites || []).map(p => `<div class="px-3.5 py-2.5 flex items-center gap-3 text-[13.5px]"><span class="flex-1 min-w-0 truncate font-semibold">${esc(p.label)}</span><span class="faint num">x${Number(p.odd).toFixed(2).replace('.', ',')}</span><span class="num font-bold">${num(p.stake)}</span><span class="badge ${p.status === 'won' ? 'b-ok' : p.status === 'lost' ? 'b-ban' : 'b-mute'}">${STATUS[p.status] || esc(p.status)}${p.status === 'won' ? ' +' + num(p.payout) : ''}</span></div>`), 'Nenhum palpite.')}
      ${list('Extrato de pontos', (u.ledger || []).map(l => `<div class="px-3.5 py-2.5 flex items-center gap-3 text-[13.5px]"><span class="flex-1 min-w-0 truncate"><b>${esc(LEDGER[l.reason] || l.reason)}</b>${l.ref && l.reason === 'suporte' ? ' · ' + esc(l.ref) : l.ref && l.reason === 'lojinha' ? ' · ' + esc(l.ref) : ''}</span><span class="text-[12px] faint whitespace-nowrap">${fmtDT(l.created_at)}</span><span class="num font-bold ${l.delta < 0 ? 'text-danger' : 'text-leaf'}">${l.delta > 0 ? '+' : ''}${num(l.delta)}</span></div>`), 'Sem movimentação.')}
      ${list('Mensagens recentes', (u.messages || []).map(m => `<div class="px-3.5 py-2.5 text-[13.5px]"><p class="${m.deleted ? 'faint line-through' : ''}">${esc(m.body)}</p><p class="text-[11.5px] faint mt-0.5">${m.room.startsWith('live:') ? 'Chat ao vivo' : 'Chat da turma'} · ${fmtDT(m.created_at)}</p></div>`), 'Nenhuma mensagem.')}
      ${list('Babas criados', (u.babas || []).map(b => `<div class="px-3.5 py-2.5 flex items-center gap-3 text-[13.5px]"><span class="flex-1 min-w-0 truncate font-semibold">${esc(b.title || 'Baba')}</span><span class="text-[12px] faint">${fmtD(b.played_on)}</span><span class="badge ${b.finished ? 'b-ok' : 'b-warn'}">${b.finished ? num(b.matches) + ' partidas' : 'em andamento'}</span></div>`), 'Nenhum baba.')}
      <p class="text-[11.5px] faint mt-6">ID ${esc(u.id)}</p>`;
  }
  function copyText(t) {
    try { navigator.clipboard.writeText(t).then(() => toast('Copiado')); } catch (e) { toast(t); }
  }
  const field = (id, label, attrs) => `<label class="label" for="${id}">${label}</label><input id="${id}" class="field" ${attrs || ''} />`;
  const reason = `<div class="mt-3">${field('m-why', 'Motivo (fica no registro)', 'maxlength="80" placeholder="Ex.: compensação por erro no placar"')}</div>`;
  const val = id => ($(id) ? $(id).value : '').trim();

  function actPoints(sign) {
    const u = current.data;
    ask({
      title: sign > 0 ? `Dar pontos para ${u.name || u.email}` : `Tirar pontos de ${u.name || u.email}`,
      body: field('m-n', 'Quantos pontos', 'type="number" min="1" max="1000000" inputmode="numeric" placeholder="500"') + reason,
      ok: sign > 0 ? 'Dar pontos' : 'Tirar pontos',
      danger: sign < 0,
      run: async () => {
        const n = Math.floor(Number(val('m-n')));
        if (!n || n < 1 || n > 1000000) throw userErr('Digite um número entre 1 e 1.000.000.');
        const bal = await B.rpc('admin_adjust_points', { uid: u.id, delta: sign * n, why: val('m-why') || 'suporte' });
        await reloadUser();
        return `Saldo agora: ${pts(bal)} pontos`;
      }
    });
  }
  async function actGrantItem() {
    const u = current.data;
    try { if (!shopItems) shopItems = await B.items(); } catch (e) { toast(errText(e)); return; }
    const owned = new Set(u.items || []);
    const opts = shopItems.filter(i => !owned.has(i.id));
    if (!opts.length) { toast('Essa pessoa já tem todos os itens'); return; }
    ask({
      title: 'Dar item da lojinha',
      body: `<label class="label" for="m-item">Item</label><select id="m-item" class="select">${opts.map(i => `<option value="${esc(i.id)}">${esc(i.title)} · ${num(i.price)} pts</option>`).join('')}</select>`,
      ok: 'Dar item',
      run: async () => { await B.rpc('admin_grant_item', { uid: u.id, item: val('m-item') }); await reloadUser(); return 'Item entregue'; }
    });
  }
  function actResetCos() {
    const u = current.data;
    ask({ title: 'Zerar moldura e nome?', body: '<p class="text-[14px] muted">Tira a moldura e o efeito do nome que a pessoa está usando. Os itens comprados continuam com ela.</p>', ok: 'Zerar', run: async () => { await B.rpc('admin_reset_cosmetics', { uid: u.id }); await reloadUser(); return 'Visual zerado'; } });
  }
  function actRename() {
    const u = current.data;
    ask({ title: 'Mudar o nome', body: field('m-name', 'Novo nome', `maxlength="60" value="${esc(u.name || '')}"`), ok: 'Salvar nome', run: async () => { await B.rpc('admin_rename_user', { uid: u.id, new_name: val('m-name') }); await reloadUser(); return 'Nome trocado'; } });
  }
  function actClearAvatar() {
    const u = current.data;
    ask({ title: 'Tirar a foto do perfil?', body: '<p class="text-[14px] muted">A pessoa volta a aparecer com as iniciais. Use para fotos impróprias.</p>', ok: 'Tirar foto', danger: true, run: async () => { await B.rpc('admin_clear_avatar', { uid: u.id }); await reloadUser(); return 'Foto removida'; } });
  }
  function actNewCode() {
    const u = current.data;
    ask({
      title: 'Gerar novo código de recuperação?',
      body: `<p class="text-[14px] muted">O código antigo para de valer. Antes, confirme que quem pediu é mesmo o dono de <b>${esc(u.email)}</b> (ex.: mensagem vinda desse e-mail).</p>`,
      ok: 'Gerar código',
      run: async () => {
        const r = await B.fn('staff_code', { user_id: u.id });
        setTimeout(() => showSecret('Novo código de recuperação', r.code, `Passe para ${u.email}. Com ele e o e-mail, a pessoa cria uma senha nova em "Esqueci a senha".`), 50);
        return '';
      }
    });
  }
  function actTempPassword() {
    const u = current.data;
    ask({
      title: 'Definir senha provisória',
      body: `<p class="text-[14px] muted mb-3">Só depois de confirmar que é o dono de <b>${esc(u.email)}</b>. Peça para a pessoa trocar a senha no perfil depois de entrar.</p>` + field('m-pass', 'Senha provisória', 'type="text" minlength="6" autocomplete="off"'),
      ok: 'Definir senha',
      run: async () => {
        const p = val('m-pass');
        if (p.length < 6) throw userErr(ERR.weak_password);
        await B.fn('staff_password', { user_id: u.id, password: p });
        return 'Senha provisória definida';
      }
    });
  }
  function actBlock(on) {
    const u = current.data;
    ask({
      title: on ? 'Bloquear o login' : 'Liberar o login',
      body: on ? `<p class="text-[14px] muted mb-3">A pessoa não consegue entrar no app enquanto durar o bloqueio.</p><label class="label" for="m-h">Por quanto tempo</label><select id="m-h" class="select"><option value="24">1 dia</option><option value="168">7 dias</option><option value="720">30 dias</option><option value="876000">Sem prazo</option></select>` : '<p class="text-[14px] muted">A pessoa volta a conseguir entrar.</p>',
      ok: on ? 'Bloquear' : 'Liberar',
      danger: on,
      run: async () => { await B.fn('staff_block', { user_id: u.id, hours: on ? Number(val('m-h')) : 0 }); return on ? 'Login bloqueado' : 'Login liberado'; }
    });
  }
  function actBan() {
    const u = current.data;
    ask({
      title: 'Suspender chat, palpites e ao vivo',
      body: `<p class="text-[14px] muted mb-3">A pessoa continua usando o placar e as turmas, mas não manda mensagens, não palpita e não abre jogo ao vivo. Ela vê o aviso da suspensão no app.</p><label class="label" for="m-h">Por quanto tempo</label><select id="m-h" class="select"><option value="24">1 dia</option><option value="72">3 dias</option><option value="168">7 dias</option><option value="720">30 dias</option><option value="0">Sem prazo</option></select><div class="mt-3">${field('m-why', 'Motivo (a pessoa vê)', 'maxlength="200" placeholder="Ex.: ofensas no chat da turma"')}</div>`,
      ok: 'Suspender',
      danger: true,
      run: async () => { await B.rpc('admin_ban', { uid: u.id, hours: Number(val('m-h')), why: val('m-why') }); await reloadUser(); return 'Conta suspensa'; }
    });
  }
  function actUnban() {
    const u = current.data;
    ask({ title: 'Tirar a suspensão?', body: '<p class="text-[14px] muted">Chat, palpites e ao vivo voltam a funcionar na hora.</p>', ok: 'Reativar', run: async () => { await B.rpc('admin_unban', { uid: u.id }); await reloadUser(); return 'Conta reativada'; } });
  }
  function actStaff(make) {
    const u = current.data;
    ask({
      title: make ? 'Tornar esta conta suporte?' : 'Tirar do suporte?',
      body: make ? `<p class="text-[14px] muted"><b>${esc(u.email)}</b> vai ver tudo deste painel, mexer em qualquer conta e ter pontos infinitos. Só faça isso com alguém de confiança.</p>` : '<p class="text-[14px] muted">A conta perde o acesso ao painel e volta a ser uma conta normal.</p>',
      ok: make ? 'Tornar suporte' : 'Tirar do suporte',
      danger: !make,
      run: async () => { await B.rpc('admin_set_staff', { uid: u.id, make }); await reloadUser(); return make ? 'Agora é suporte' : 'Saiu do suporte'; }
    });
  }
  function actDelete() {
    const u = current.data;
    ask({
      title: 'Excluir esta conta?',
      body: `<p class="text-[14px] muted mb-3">Apaga a conta de <b>${esc(u.email)}</b> e os dados dela. As turmas em que ela é dona passam para o adm mais antigo. <b>Não dá para desfazer.</b></p>` + field('m-confirm', 'Digite EXCLUIR para confirmar', 'autocomplete="off"'),
      ok: 'Excluir conta',
      danger: true,
      run: async () => {
        if (val('m-confirm').toUpperCase() !== 'EXCLUIR') throw userErr('Digite EXCLUIR para confirmar.');
        await B.fn('staff_delete', { user_id: u.id });
        closeDrawer();
        if (view === 'pessoas') loadPeople(true);
        return 'Conta excluída';
      }
    });
  }
  function showSecret(title, code, note) {
    ask({
      title,
      body: `<div class="rounded-2xl bg-sunk px-4 py-4 text-center"><p class="code-box select-all">${esc(code)}</p></div><p class="text-[13px] muted mt-3">${esc(note)}</p>`,
      ok: 'Copiar e fechar',
      run: async () => { copyText(code); return ''; }
    });
  }

  /* ---------- Turmas ---------- */
  let turmaQ = '';
  async function viewTurmas() {
    $('view').innerHTML = `
      <form class="flex gap-2 mb-4" onsubmit="event.preventDefault(); searchTurmas(this.q.value);">
        <label class="sr-only" for="turma-q">Buscar turma</label>
        <input id="turma-q" name="q" class="field" placeholder="Buscar por nome da turma ou e-mail do dono" value="${esc(turmaQ)}" autocomplete="off" />
        <button class="btn-primary h-12 px-5 text-[14px]"><i class="fa-solid fa-magnifying-glass"></i><span class="hidden sm:inline">Buscar</span></button>
      </form>
      <div class="card-flat overflow-hidden"><div class="scroll-x" id="turma-table"></div></div>`;
    await loadTurmas();
  }
  async function loadTurmas() {
    try {
      const rows = await B.rpc('admin_turmas', { search: turmaQ });
      cache.turmas = rows || [];
      const box = $('turma-table');
      if (!box) return;
      box.innerHTML = !cache.turmas.length ? '<p class="empty">Nenhuma turma encontrada.</p>' : `<table class="t"><thead><tr><th>Turma</th><th>Dono</th><th class="num">Pessoas</th><th class="num">Jogadores</th><th class="num">Babas</th><th>Último baba</th><th>Criada</th></tr></thead><tbody>
        ${cache.turmas.map(t => `<tr class="click" tabindex="0" onclick="openTurma('${t.id}')" onkeydown="if(event.key==='Enter')openTurma('${t.id}')">
          <td><div class="flex items-center gap-2.5 min-w-[180px]">${avatar(t.icon && !String(t.icon).startsWith('data:') ? t.icon : t.icon ? 'photo' : null, t.name)}<span class="font-bold truncate">${esc(t.name)}</span>${t.staff_in ? '<span class="badge b-staff">você está</span>' : ''}</div></td>
          <td><p class="font-semibold truncate max-w-[200px]">${esc(t.owner_name || '-')}</p><p class="text-[12px] muted truncate max-w-[200px]">${esc(t.owner_email || '')}</p></td>
          <td class="num">${num(t.members)}</td><td class="num">${num(t.players)}</td><td class="num">${num(t.babas)}</td>
          <td class="whitespace-nowrap">${ago(t.last_baba)}</td><td class="whitespace-nowrap">${fmtD(t.created_at)}</td></tr>`).join('')}</tbody></table>`;
    } catch (e) { failView(e); }
  }
  async function searchTurmas(q) { turmaQ = String(q || '').trim(); await loadTurmas(); }
  function copyInvite(code) { copyText(location.origin + location.pathname.replace(/admin\.html$/, '') + '#convite=' + code); }
  async function openTurma(id) {
    openDrawer('Turma');
    try {
      if (!cache.turmas || !cache.turmas.some(t => t.id === id)) cache.turmas = await B.rpc('admin_turmas', { search: '' });
      const t = (cache.turmas || []).find(x => x.id === id);
      const members = await B.rpc('admin_turma_members', { t: id });
      current = { kind: 'turma', id, data: t, members: members || [] };
      renderTurma();
    } catch (e) { $('drawer-body').innerHTML = `<p class="empty">${esc(errText(e))}</p>`; }
  }
  function renderTurma() {
    const t = current.data || { name: 'Turma' };
    const ms = current.members;
    const inIt = ms.some(m => me && m.user_id === me.id);
    $('drawer-title').innerText = t.name;
    $('drawer-body').innerHTML = `
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
        ${fact('Pessoas', num(t.members))}${fact('Jogadores', num(t.players))}${fact('Babas', num(t.babas))}
        ${fact('Último baba', ago(t.last_baba))}${fact('Criada', fmtD(t.created_at))}${fact('Convite', esc(t.invite_code || '-'))}
      </div>
      <div class="card-flat overflow-hidden mt-5">
        ${inIt ? actBtn('fa-right-from-bracket', 'Sair da turma', 'actLeaveTurma()') : actBtn('fa-right-to-bracket', 'Entrar na turma (pra ver no app)', 'actJoinTurma()')}
        ${actBtn('fa-crown', 'Passar o dono para outra pessoa', 'actTransfer()')}
        ${t.invite_code ? actBtn('fa-link', 'Copiar link de convite', `copyInvite('${esc(t.invite_code)}')`) : ''}
      </div>
      <div class="mt-6"><p class="eyebrow mb-2">Pessoas na turma</p><div class="card-flat divide-y divide-ink/[0.07] overflow-hidden">
        ${ms.map(m => `<button class="act" onclick="openUser('${m.user_id}')">${avatar(null, m.name)}<span class="flex-1 min-w-0"><span class="block truncate">${esc(m.name || '(sem nome)')}</span><span class="block text-[12px] muted font-medium truncate">${esc(m.email || '')}</span></span><span class="badge ${m.role === 'owner' ? 'b-staff' : m.role === 'admin' ? 'b-ok' : 'b-mute'}">${m.role === 'owner' ? 'Dono' : m.role === 'admin' ? 'Adm' : 'Membro'}</span></button>`).join('')}
      </div></div>
      <p class="text-[11.5px] faint mt-6">ID ${esc(current.id)}</p>`;
  }
  async function refreshTurma() {
    cache.turmas = await B.rpc('admin_turmas', { search: turmaQ });
    current.data = cache.turmas.find(x => x.id === current.id) || current.data;
    current.members = await B.rpc('admin_turma_members', { t: current.id });
    renderTurma();
    if (view === 'turmas') loadTurmas();
  }
  function actJoinTurma() {
    ask({ title: 'Entrar nesta turma?', body: '<p class="text-[14px] muted">A conta de suporte entra como membro: aparece no app, vê jogadores, babas e o chat da turma. Saia quando terminar. Fica no registro.</p>', ok: 'Entrar', run: async () => { await B.rpc('admin_join_turma', { t: current.id }); await refreshTurma(); return 'Você entrou na turma'; } });
  }
  function actLeaveTurma() {
    ask({ title: 'Sair desta turma?', body: '', ok: 'Sair', run: async () => { await B.rpc('admin_leave_turma', { t: current.id }); await refreshTurma(); return 'Você saiu da turma'; } });
  }
  function actTransfer() {
    const opts = current.members.filter(m => m.role !== 'owner');
    if (!opts.length) { toast('Não tem outra pessoa na turma'); return; }
    ask({
      title: 'Passar o dono',
      body: `<p class="text-[14px] muted mb-3">Use quando o dono sumiu ou pediu ajuda. O dono antigo continua na turma como adm.</p><label class="label" for="m-owner">Novo dono</label><select id="m-owner" class="select">${opts.map(m => `<option value="${m.user_id}">${esc(m.name || m.email)}</option>`).join('')}</select>`,
      ok: 'Passar o dono',
      run: async () => { await B.rpc('admin_transfer_turma', { t: current.id, new_owner: val('m-owner') }); await refreshTurma(); return 'Dono trocado'; }
    });
  }

  /* ---------- Ao vivo ---------- */
  async function viewAoVivo() {
    $('view-tools').innerHTML = `<button class="btn-outline h-10 px-3.5 text-[13px]" onclick="route()"><i class="fa-solid fa-rotate-right"></i> Atualizar</button>`;
    try {
      const rows = await B.rpc('admin_lives');
      const fresh = g => g.active && Date.now() - new Date(g.updated_at).getTime() < 3 * 3600e3;
      $('view').innerHTML = !(rows || []).length ? '<div class="card"><p class="empty">Nenhum jogo ao vivo ainda.</p></div>' : `<div class="card-flat overflow-hidden"><div class="scroll-x"><table class="t"><thead><tr><th>Jogo</th><th>Organizador</th><th>Situação</th><th class="num">Palpites</th><th class="num">No chat</th><th></th></tr></thead><tbody>
        ${rows.map(g => `<tr>
          <td><p class="font-bold">${esc(g.title || 'Baba ao vivo')}</p><p class="text-[12px] muted">Código ${esc(g.code)}</p></td>
          <td>${esc(g.owner_name || '-')}</td>
          <td>${fresh(g) ? '<span class="badge b-ok"><i class="fa-solid fa-circle text-[7px]"></i> Ao vivo</span>' : g.active ? '<span class="badge b-warn">Parado</span>' : '<span class="badge b-mute">Encerrado</span>'}<p class="text-[11.5px] faint mt-1">${ago(g.updated_at)}</p></td>
          <td class="num">${num(g.open_palpites)} abertos<br><span class="faint">${num(g.total_palpites)} no total</span></td>
          <td class="num">${num(g.viewers_chat)}</td>
          <td class="whitespace-nowrap text-right"><a class="btn-soft h-9 px-3 text-[12.5px]" href="./#ao-vivo=${encodeURIComponent(g.code)}" target="_blank" rel="noopener"><i class="fa-solid fa-eye"></i> Assistir</a>
          ${g.active ? `<button class="btn-danger h-9 px-3 text-[12.5px] ml-1" onclick="actEndLive('${g.id}', ${g.open_palpites})"><i class="fa-solid fa-stop"></i> Encerrar</button>` : ''}</td>
        </tr>`).join('')}</tbody></table></div></div>
        <p class="text-[12px] faint px-1 mt-3">Encerrar devolve todos os palpites abertos (os pontos voltam pra quem palpitou).</p>`;
    } catch (e) { failView(e); }
  }
  function actEndLive(id, open) {
    ask({ title: 'Encerrar este jogo ao vivo?', body: `<p class="text-[14px] muted">${open ? `${num(open)} palpite${open > 1 ? 's' : ''} aberto${open > 1 ? 's' : ''} ${open > 1 ? 'serão devolvidos' : 'será devolvido'}.` : 'Não há palpites abertos.'} O organizador pode abrir um novo jogo depois.</p>`, ok: 'Encerrar', danger: true, run: async () => { const n = await B.rpc('admin_end_live', { live: id }); route(); return `Jogo encerrado · ${num(n)} palpites devolvidos`; } });
  }

  /* ---------- Denúncias ---------- */
  async function viewDenuncias() {
    $('view-tools').innerHTML = `<button class="btn-outline h-10 px-3.5 text-[13px]" onclick="route()"><i class="fa-solid fa-rotate-right"></i> Atualizar</button>`;
    try {
      const rows = await B.rpc('admin_reports');
      if (!(rows || []).length) {
        $('view').innerHTML = '<div class="card p-8 text-center"><img src="babinha/happy.webp" alt="" class="w-24 h-24 object-contain mx-auto" /><p class="font-bold mt-2">Nenhuma denúncia. O vestiário está em paz.</p></div>';
        return;
      }
      $('view').innerHTML = `<div class="grid md:grid-cols-2 gap-3">${rows.map(r => `
        <div class="card p-4 ${r.deleted ? 'opacity-70' : ''}">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="badge ${r.reports >= 3 ? 'b-ban' : 'b-warn'}"><i class="fa-solid fa-flag"></i> ${num(r.reports)} denúncia${r.reports > 1 ? 's' : ''}</span>
            ${r.deleted ? '<span class="badge b-mute">Apagada</span>' : '<span class="badge b-ok">Visível</span>'}
            <span class="text-[12px] faint ml-auto">${ago(r.last_report)}</span>
          </div>
          <p class="mt-3 text-[15px] font-semibold ${r.deleted && r.body === '-' ? 'faint' : ''}">${r.deleted && r.body === '-' ? '(mensagem apagada)' : '“' + esc(r.body) + '”'}</p>
          <p class="text-[12.5px] muted mt-1.5">${esc(r.author_name || '?')} · ${esc(r.author_email || '')} · ${String(r.room).startsWith('live:') ? 'chat ao vivo' : 'chat da turma'} · ${fmtDT(r.created_at)}</p>
          ${(r.reasons || []).filter(Boolean).length ? `<p class="text-[12.5px] mt-1.5"><b>Motivos:</b> ${(r.reasons || []).filter(Boolean).map(esc).join(' · ')}</p>` : ''}
          <div class="flex gap-2 flex-wrap mt-3.5">
            ${r.deleted ? (r.body !== '-' ? `<button class="btn-soft h-9 px-3 text-[12.5px]" onclick="actReport(${r.message_id}, 'restore')"><i class="fa-solid fa-rotate-left"></i> Restaurar</button>` : '') : `<button class="btn-danger h-9 px-3 text-[12.5px]" onclick="actReport(${r.message_id}, 'delete')"><i class="fa-solid fa-trash"></i> Apagar</button>`}
            <button class="btn-soft h-9 px-3 text-[12.5px]" onclick="actReport(${r.message_id}, 'dismiss')"><i class="fa-solid fa-check"></i> Descartar denúncia</button>
            <button class="btn-outline h-9 px-3 text-[12.5px]" onclick="openUser('${r.author_id}')"><i class="fa-solid fa-user"></i> Ver autor</button>
          </div>
        </div>`).join('')}</div>`;
    } catch (e) { failView(e); }
  }
  function actReport(id, act) {
    const t = { delete: ['Apagar a mensagem?', 'Some do chat para todo mundo. Não dá pra restaurar depois.', 'Apagar', true], restore: ['Restaurar a mensagem?', 'Volta a aparecer no chat.', 'Restaurar', false], dismiss: ['Descartar a denúncia?', 'A denúncia some daqui. A mensagem fica como está.', 'Descartar', false] }[act];
    ask({ title: t[0], body: `<p class="text-[14px] muted">${t[1]}</p>`, ok: t[2], danger: t[3], run: async () => { await B.rpc('admin_resolve_report', { msg: id, act }); route(); return 'Feito'; } });
  }

  /* ---------- Avisos ---------- */
  async function viewAvisos() {
    let cur = null;
    try { cur = ((await B.rpc('my_status')) || [])[0] || null; } catch (e) { return failView(e); }
    $('view').innerHTML = `
      <div class="grid lg:grid-cols-[1fr_380px] gap-4 items-start">
        <div class="card p-5">
          <label class="label" for="notice-msg">Aviso para todo mundo que abrir o app</label>
          <textarea id="notice-msg" class="field min-h-[110px]" maxlength="280" placeholder="Ex.: Hoje às 23h o app fica fora do ar por 10 minutos para manutenção." oninput="$('notice-count').innerText = this.value.length + '/280'; previewNotice()"></textarea>
          <div class="flex items-center gap-3 mt-3 flex-wrap">
            <div class="seg grid-cols-2 w-[240px]" role="radiogroup" aria-label="Tipo">
              <button type="button" class="seg-btn is-selected" data-lvl="info" onclick="setLvl('info')">Informação</button>
              <button type="button" class="seg-btn" data-lvl="warning" onclick="setLvl('warning')">Atenção</button>
            </div>
            <span id="notice-count" class="text-[12px] faint ml-auto">0/280</span>
          </div>
          <div class="flex gap-2 mt-4 flex-wrap">
            <button class="btn-primary h-11 px-5 text-[14px]" onclick="publishNotice()"><i class="fa-solid fa-bullhorn"></i> Publicar aviso</button>
            ${cur && cur.notice ? '<button class="btn-danger h-11 px-5 text-[14px]" onclick="clearNotice()"><i class="fa-solid fa-xmark"></i> Tirar o aviso atual</button>' : ''}
          </div>
          <p class="text-[12px] faint mt-3">Só um aviso fica no ar por vez: publicar um novo substitui o anterior. Cada pessoa pode fechar o aviso no app.</p>
        </div>
        <div>
          <p class="eyebrow mb-2 px-1">No ar agora</p>
          <div id="notice-now">${cur && cur.notice ? noticeCard(cur.notice, cur.notice_level) : '<div class="card"><p class="empty">Nenhum aviso no ar.</p></div>'}</div>
          <p class="eyebrow mb-2 mt-5 px-1">Prévia</p>
          <div id="notice-preview"><div class="card"><p class="empty">Escreva o aviso pra ver como fica.</p></div></div>
        </div>
      </div>`;
  }
  let noticeLvl = 'info';
  function setLvl(l) { noticeLvl = l; document.querySelectorAll('[data-lvl]').forEach(b => b.classList.toggle('is-selected', b.dataset.lvl === l)); previewNotice(); }
  const noticeCard = (msg, lvl) => `<div class="card keep-light p-3.5 flex items-start gap-3" style="background:rgb(255 252 242);color:rgb(18 48 43)">
      <span class="tile ${lvl === 'warning' ? 'bg-warn/15 text-warn' : 'bg-sage text-pitch'}"><i class="fa-solid ${lvl === 'warning' ? 'fa-triangle-exclamation' : 'fa-bullhorn'}"></i></span>
      <span class="min-w-0 flex-1"><span class="block text-[12px] font-bold uppercase tracking-wider text-ink-2">Aviso da equipe BABA</span><span class="block text-[14px] font-semibold mt-0.5 break-words">${esc(msg)}</span></span></div>`;
  function previewNotice() { const m = val('notice-msg'); $('notice-preview').innerHTML = m ? noticeCard(m, noticeLvl) : '<div class="card"><p class="empty">Escreva o aviso pra ver como fica.</p></div>'; }
  function publishNotice() {
    const m = val('notice-msg');
    if (!m) { toast('Escreva o aviso primeiro'); return; }
    ask({ title: 'Publicar este aviso?', body: noticeCard(m, noticeLvl) + '<p class="text-[13px] muted mt-3">Todo mundo vê na tela inicial do app.</p>', ok: 'Publicar', run: async () => { await B.rpc('admin_set_notice', { message: m, lvl: noticeLvl }); route(); return 'Aviso no ar'; } });
  }
  function clearNotice() {
    ask({ title: 'Tirar o aviso do ar?', body: '', ok: 'Tirar aviso', danger: true, run: async () => { await B.rpc('admin_set_notice', { message: '', lvl: 'info' }); route(); return 'Aviso retirado'; } });
  }

  /* ---------- Registro ---------- */
  const LOG = {
    pontos: 'Ajustou pontos', 'dar-item': 'Deu item', 'zerar-visual': 'Zerou o visual', renomear: 'Mudou o nome', 'tirar-foto': 'Tirou a foto',
    suspender: 'Suspendeu', reativar: 'Reativou', 'dar-suporte': 'Deu suporte', 'tirar-suporte': 'Tirou suporte', 'entrar-turma': 'Entrou na turma',
    'sair-turma': 'Saiu da turma', 'passar-turma': 'Passou o dono', 'denuncia-delete': 'Apagou mensagem', 'denuncia-restore': 'Restaurou mensagem',
    'denuncia-dismiss': 'Descartou denúncia', 'encerrar-ao-vivo': 'Encerrou ao vivo', aviso: 'Mudou o aviso', 'novo-codigo': 'Gerou código de recuperação',
    'senha-provisoria': 'Definiu senha provisória', 'bloquear-login': 'Bloqueou o login', 'liberar-login': 'Liberou o login', 'excluir-conta': 'Excluiu conta'
  };
  async function viewRegistro() {
    try {
      const rows = await B.rpc('admin_log', { lim: 300 });
      const isUser = s => /^[0-9a-f-]{36}$/i.test(String(s || ''));
      $('view').innerHTML = !(rows || []).length ? '<div class="card"><p class="empty">Nada feito pelo suporte ainda.</p></div>' : `<div class="card-flat overflow-hidden"><div class="scroll-x"><table class="t"><thead><tr><th>Quando</th><th>Quem</th><th>O que</th><th>Detalhes</th><th></th></tr></thead><tbody>
        ${rows.map(r => {
          const d = r.details || {};
          const det = Object.keys(d).map(k => `${esc(k)}: ${esc(typeof d[k] === 'object' ? JSON.stringify(d[k]) : d[k])}`).join(' · ');
          const userAct = !/turma|ao-vivo|denuncia|aviso/.test(r.action);
          return `<tr><td class="whitespace-nowrap">${fmtDT(r.at)}</td><td class="whitespace-nowrap">${esc(r.staff_name || '-')}</td><td class="font-semibold whitespace-nowrap">${esc(LOG[r.action] || r.action)}</td><td class="text-[12.5px] muted min-w-[200px]">${det || '-'}</td>
          <td class="text-right">${isUser(r.target) && userAct ? `<button class="btn-soft h-8 px-3 text-[12px]" onclick="openUser('${r.target}')">Ver pessoa</button>` : r.action.includes('turma') && isUser(r.target) ? `<button class="btn-soft h-8 px-3 text-[12px]" onclick="openTurma('${r.target}')">Ver turma</button>` : ''}</td></tr>`;
        }).join('')}</tbody></table></div></div>`;
    } catch (e) { failView(e); }
  }

  /* ---------- Keyboard ---------- */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('modal').classList.contains('hidden')) closeModal();
    else if (!$('drawer').classList.contains('hidden')) closeDrawer();
  });
  window.addEventListener('hashchange', route);

  Object.assign(window, {
    doLogin, doLogout, toggleTheme, route, setPeriod, searchPeople, loadPeople, openUser, openTurma, closeDrawer, closeModal, copyText,
    actPoints, actGrantItem, actResetCos, actRename, actClearAvatar, actNewCode, actTempPassword, actBlock, actBan, actUnban, actStaff, actDelete,
    loadTurmas, searchTurmas, copyInvite, actJoinTurma, actLeaveTurma, actTransfer, actEndLive, actReport, setLvl, previewNotice, publishNotice, clearNotice, $
  });
  boot();
})();
