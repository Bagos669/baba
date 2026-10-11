# Visual audit with a data-rich account: long names with quotes, many players, stats, cosmetics.
# Walks every area at 390 and 320 px, light and dark, and reports anything poking out of the screen.
import sys, asyncio, json, os, datetime
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read(); fake = Fake()
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/v10audit'
os.makedirs(SHOTS, exist_ok=True)
URL = 'http://localhost:8765/'
WIDTHS = [int(x) for x in (sys.argv[2] if len(sys.argv) > 2 else '390,320').split(',')]
THEMES = (sys.argv[3] if len(sys.argv) > 3 else 'light,dark').split(',')

NAMES = ['Bernardo "Bezão" Fagundes', 'Maria Eduarda Albuquerque dos Santos', 'Zé', 'João Pedro "JP" Cavalcanti', 'Lu', 'Gabriel "Capita" Marini',
         'Thiago Henrique de Oliveira Nascimento', 'Ana Clara', 'Rafa Gol', 'Kauã', 'Bia', 'Duda Lima', 'Caio Augusto "Paredão" Ribeiro', 'Edu',
         'Wellington "Tom" Sousa', 'Pedrinho', 'Marcos Vinícius', 'Léo', 'Joana "Jojô" Prado', 'Fábio Jr.', 'Igor', 'Hugo Leonardo Silva Pereira']

RICH = """async (names) => {
  const tid = crypto.randomUUID();
  await api.upsertTurma(tid, 'Os Boleiros do "Barbalho" Futebol Clube', null);
  state.turmas.push({ id: tid, name: 'Os Boleiros do "Barbalho" Futebol Clube', cloud: true, role: 'owner', invite: 'ABCD1234', players: names.slice(), keepers: [names[12], names[5]], women: [names[1], names[7], names[18]], meta: { [names[0].toLowerCase()]: { userId: currentUser.id } } });
  await syncTurmaNow(tid);
  state.selectedTeams = [tid]; syncPool();
  state.players.forEach((p, i) => { if (i < 19) checkIn(p.id); });
  state.settings.keeperMode = 'time'; state.match.lineSize = 5;
  buildTeams();
  const A = state.court.A, B = state.court.B;
  state.players.forEach((p, i) => { p.goals = (i * 7) % 5; p.assists = (i * 3) % 4; p.saves = p.isGoalkeeper ? 6 : 0; p.matches = 4 + (i % 3); p.wins = i % 4; p.penGoals = i % 2; });
  state.match.scoreA = 3; state.match.scoreB = 2;
  state.match.events = [{ type: 'goal', side: 'A', scorerId: A.ids[1], assistId: A.ids[2], time: '03:12' }, { type: 'save', side: 'B', keeperId: B.ids[0], time: '04:40' }, { type: 'goal', side: 'B', scorerId: B.ids[3], time: '05:01' }];
  state.matchHistory = [
    { timestamp: '20:41', labelA: 1, labelB: 2, scoreA: 2, scoreB: 2, pens: { a: 4, b: 3 }, winner: 'A' },
    { timestamp: '20:30', labelA: 3, labelB: 1, scoreA: 0, scoreB: 1, winner: 'B' },
    { timestamp: '20:18', labelA: 1, labelB: 4, scoreA: 5, scoreB: 4, winner: 'A' }];
  for (let d = 1; d <= 3; d++) state.pastDays.push({ id: crypto.randomUUID(), date: new Date(Date.now() - d * 7 * 864e5).toISOString(), title: 'Quinta do "Barbalho" ' + d, matches: 9, owner: true, turmaIds: [tid],
    players: names.map((n, i) => ({ name: n, turmaId: tid, goals: (i + d) % 4, assists: i % 3, saves: i === 12 ? 7 : 0, matches: 5, wins: (i + d) % 3, penGoals: 0, penMisses: 0, penSaves: 0, isGoalkeeper: i === 12 })) });
  commit();
  return tid;
}"""

OVERFLOW = """() => {
  const W = innerWidth, out = [];
  const clipped = el => { for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.overflowX !== 'visible' || cs.position === 'fixed' && e.classList.contains('toast')) return true; } return false; };
  const desc = el => (el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ').slice(0, 3).join('.')) + ' "' + (el.innerText || '').trim().slice(0, 30) + '"';
  document.querySelectorAll('body *').forEach(el => {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return;
    if (el.closest('.hidden, #toast-stack, .toast, [aria-hidden=true]')) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight * 3) return;
    if ((r.right > W + 1 || r.left < -1) && !clipped(el)) out.push('fora da tela: ' + desc(el) + ` (${Math.round(r.left)}..${Math.round(r.right)})`);
    if (el.tagName === "BUTTON" && !el.querySelector(".fr, img") && el.children.length < 6 && el.scrollWidth > el.clientWidth + 2 && cs.overflowX === 'visible' && !el.querySelector('.truncate')) out.push('texto vazando do botão: ' + desc(el));
  });
  if (document.documentElement.scrollWidth > W + 1) out.push('página com rolagem lateral: ' + document.documentElement.scrollWidth);
  return [...new Set(out)].slice(0, 12);
}"""

async def main():
    fake._v8init()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        report = {}
        for width in WIDTHS:
            for theme in THEMES:
                ctx = await b.new_context(viewport={'width': width, 'height': 760}, color_scheme=theme)
                await ctx.expose_function('fakeCall', lambda n, t, a: fake.handle(n, t, a)); await ctx.add_init_script(FAKE_JS)
                await ctx.route('https://api.open-meteo.com/**', lambda r: r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'},
                                body=json.dumps({'current': {'temperature_2m': 31, 'weather_code': 95, 'is_day': 0}, 'hourly': {'precipitation_probability': [80, 90]}})))
                pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
                ev = lambda js, *a: pg.evaluate(js, *a)
                tag = f'{width}{theme}'
                email = f'bezao{tag}@t.dev'
                await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(300)
                await ev(f"localStorage.setItem('baba_weather_v1', JSON.stringify({{ lat: -12.97, lon: -38.5, at: 0 }}))")
                await ev("authGo('signup')")
                await pg.fill('#signup-name', 'Bernardo "Bezão" Fagundes da Silva Albuquerque'); await pg.fill('#signup-email', email); await pg.fill('#signup-pass', 'segredo1')
                await ev("doSignup()"); await pg.wait_for_timeout(300); await pg.check('#recovery-ack'); await ev("recoveryDone()"); await pg.wait_for_timeout(1000)
                if await ev("!document.getElementById('page-terms-gate').classList.contains('hidden')"):
                    await pg.fill('#terms-birth', '1990-01-01'); await pg.check('#terms-ack'); await ev("submitTerms()"); await pg.wait_for_timeout(700)
                await pg.click('#tour-next'); await pg.click('text=Pular'); await pg.wait_for_timeout(400)
                if await ev("!document.getElementById('modal-popup').classList.contains('hidden')"): await pg.click('#popup-ok')
                uid = fake.users[email]['id']
                fake.f_myWallet(uid); fake.wallets[uid]['balance'] = 1234567
                fake.items[uid] = ['frame_diamante', 'name_ouro', 'fx_frame_shine', 'fx_name_shine']
                fake.profiles[uid]['cosmetics'] = {'frame': 'diamante', 'name': 'ouro', 'frameShine': True, 'nameShine': True}
                tid = await ev(RICH, NAMES)
                await pg.reload(wait_until='load'); await pg.wait_for_timeout(1500)
                if await ev("!document.getElementById('modal-popup').classList.contains('hidden')"): await pg.click('#popup-ok')
                lid = 'live-audit-' + tag
                fake.lives[lid] = {'id': lid, 'owner': 'someone', 'code': ('AUD' + tag.upper())[:8], 'active': True, 'palpites': True, 'turma_ids': [], 'title': 'Baba do "Barbalho" ao vivo agora mesmo',
                                   'updated_at': datetime.datetime.now().isoformat(),
                                   'state': {'v': 1, 'matchNo': 12, 'running': True, 'secondsLeft': 300, 'total': 420,
                                             'A': {'label': 'Time 11', 'names': NAMES[:5], 'score': 10, 'king': True}, 'B': {'label': 'Time 12', 'names': NAMES[5:10], 'score': 9}, 'events': [{'type': 'goal', 'side': 'A', 'time': '03:12', 'who': NAMES[0], 'assist': NAMES[1]}],
                                             'history': [{'a': 'Time 11', 'b': 'Time 9', 'sa': 2, 'sb': 2, 'pens': [5, 4]}]},
                                   'markets': {'match_no': 12, 'open': True, 'items': [{'key': 'res:A', 'label': 'Time 11 vence', 'group': 'Resultado', 'odd': 1.42, 'pct': 63}, {'key': 'res:draw', 'label': 'Empate', 'group': 'Resultado', 'odd': 6.1, 'pct': 15}, {'key': 'res:B', 'label': 'Time 12 vence', 'group': 'Resultado', 'odd': 4.1, 'pct': 22}]
                                               + [{'key': 'gol:' + n.lower(), 'label': n + ' marca', 'group': 'Quem marca', 'odd': 20 if i % 3 == 0 else 3.75, 'pct': 3 if i % 3 == 0 else 24} for i, n in enumerate(NAMES[:10])]}}
                found = {}
                async def look(name, shot=False):
                    await pg.wait_for_timeout(350)
                    probs = await ev(OVERFLOW)
                    if probs: found[name] = probs
                    if shot: await pg.screenshot(path=f'{SHOTS}/{tag}_{name}.png')
                if theme == 'dark': await ev("setPref('theme', 'dark')"); await pg.wait_for_timeout(200)
                for tab in ['inicio', 'placar', 'ficha', 'fila', 'stats']:
                    await ev(f"switchTab('{tab}')"); await look('tab_' + tab, True)
                    if tab == 'stats':
                        for c in ['assists', 'saves', 'total', 'wins', 'pens']:
                            await ev(f"switchStatsCategory('{c}')"); await look('stats_' + c)
                        await ev("switchStatsScope('all')"); await look('stats_all', True)
                await ev("switchTab('fila')")
                await ev("openSubModal('A', state.court.A.ids[1])"); await look('sub', True); await ev("closeSubModal()")
                await ev("openManualTeams()"); await look('manual', True); await ev("closeManualTeams()")
                await ev("openPlayerSheet(state.court.A.ids[1])"); await look('ficha', True); await ev("document.getElementById('modal-player').classList.add('hidden')")
                await ev("switchTab('placar')"); await ev("openGoalModal('A')"); await look('goal', True); await ev("document.getElementById('modal-goal').classList.add('hidden')")
                await ev("state.match.scoreB = 3; openShootout(); recordPen('gol'); recordPen('defesa')"); await look('pens', True); await ev("closeShootout()")
                await ev("openDatabaseModal()"); await look('turmas', True)
                await ev(f"openTurmaEditor('{tid}')"); await look('turma_editor', True)
                await ev("document.querySelectorAll('.overlay:not(.hidden), .modal:not(.hidden)').forEach(m => m.classList.add('hidden'))")
                await ev("openProfile()"); await pg.wait_for_timeout(600); await look('profile', True)
                await ev("history.back()"); await pg.wait_for_timeout(300)
                await ev("openShop()"); await pg.wait_for_timeout(800); await look('shop', True)
                await ev("history.back()"); await pg.wait_for_timeout(300)
                await ev("openSupport()"); await pg.wait_for_timeout(500); await look('support', True)
                await ev("history.back()"); await pg.wait_for_timeout(300)
                await ev(f"openLive('{fake.lives[lid]['code']}')"); await pg.wait_for_timeout(1800); await look('live', True)
                await ev("openDuel()"); await pg.wait_for_timeout(500); await look('duel', True); await ev("closeDuel()")
                await ev("openPalpite('gol:' + " + json.dumps(NAMES[0].lower()) + ")"); await look('palpite', True); await ev("closePalpite()")
                await ev("closeLive()"); await pg.wait_for_timeout(300)
                await ev("switchTab('inicio')"); await pg.evaluate("window.scrollTo(0, 99999)"); await look('inicio_bottom', True)
                report[tag] = {'problems': found, 'errors': errs}
                await ctx.close()
        await b.close()
    print(json.dumps(report, ensure_ascii=False, indent=1))
asyncio.run(main())
