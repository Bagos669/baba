# v10: NvN formats + keeper modes, pênaltis, trocas/montar times, relógio e clima, emotes no chat,
# stats do baba em andamento, multiplicadores e Desafio 1v1.
import sys, asyncio, json, os, datetime
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read(); fake = Fake()
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/v10shots'
os.makedirs(SHOTS, exist_ok=True)
URL = 'http://localhost:8765/'
out, bad = {}, []

SETUP = """(n) => {
  const mk = (id, name, gk) => Object.assign(newPlayer(name, null), { id, isGoalkeeper: gk, present: true, arrival: id, arrivedAt: Date.now() });
  state.players = Array.from({ length: n }, (_, i) => mk(i + 1, 'P' + (i + 1), false));
  state.court = { A: null, B: null }; state.queue = state.players.map(p => p.id); state.arrivalSeq = n; state.teamSeq = 0;
  state.matchHistory = []; state.firstKickoffAt = null; state.standings = {};
  state.match = defaultMatch(); state.match.goalLimitRule = 'none';
  state.settings = Object.assign(state.settings, { queueOrder: 'chegada', lateAfter: 0, keeperMode: 'time', drawRule: 'king' });
}"""

WEATHER = {'current': {'temperature_2m': 27.4, 'weather_code': 2, 'is_day': 1}, 'hourly': {'precipitation_probability': [10, 40]}}

async def signup(pg, name, email, birth='1994-04-04'):
    await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(300)
    await pg.evaluate("authGo('signup')")
    await pg.fill('#signup-name', name); await pg.fill('#signup-email', email); await pg.fill('#signup-pass', 'segredo1')
    await pg.evaluate("doSignup()"); await pg.wait_for_timeout(300); await pg.check('#recovery-ack'); await pg.evaluate("recoveryDone()"); await pg.wait_for_timeout(1000)
    if await pg.evaluate("!document.getElementById('page-terms-gate').classList.contains('hidden')"):
        await pg.fill('#terms-birth', birth); await pg.check('#terms-ack'); await pg.evaluate("submitTerms()"); await pg.wait_for_timeout(700)
    await pg.click('#tour-next'); await pg.click('text=Pular'); await pg.wait_for_timeout(500)
    if await pg.evaluate("!document.getElementById('modal-popup').classList.contains('hidden')"):
        await pg.click('#popup-ok'); await pg.wait_for_timeout(200)

async def main():
    fake._v8init()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        async def newctx():
            ctx = await b.new_context(viewport={'width': 390, 'height': 844}, geolocation={'latitude': -12.9714, 'longitude': -38.5014}, permissions=['geolocation'])
            await ctx.expose_function('fakeCall', lambda n, t, a: fake.handle(n, t, a)); await ctx.add_init_script(FAKE_JS)
            async def meteo(route):
                out['weather_url'] = route.request.url
                await route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=json.dumps(WEATHER))
            await ctx.route('https://api.open-meteo.com/**', meteo)
            return ctx
        ctx = await newctx()
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        ev = lambda js, *a: pg.evaluate(js, *a)
        async def check(cond, label, page=None):
            if not await (page or pg).evaluate(cond): bad.append(label)

        await signup(pg, 'Ana Souza', 'ana@t.dev')

        # ---- home: date + time, weather after allowing location
        await check("/\\d{2}:\\d{2}/.test(document.getElementById('home-date').innerText)", 'clock on home')
        await check("document.getElementById('home-weather').innerText.includes('Ver o clima')", 'weather asks first')
        await ev("askWeather()"); await pg.wait_for_timeout(1200)
        await check("document.getElementById('home-weather').innerText.includes('27°') && document.getElementById('home-weather').innerText.includes('Poucas nuvens') && document.getElementById('home-weather').innerText.includes('40%')", 'weather shown')
        if 'latitude=-12.97' not in out.get('weather_url', '') or 'longitude=-38.5' not in out.get('weather_url', ''): bad.append('location rounded to 2 decimals')
        await check("!JSON.stringify(localStorage).includes('-12.9714')", 'exact location not stored')
        await pg.screenshot(path=f'{SHOTS}/v10_home.png')

        # ---- old formats migrate to NvN + keeper mode
        mig = await ev("""() => ['futsal', 'society', 'campo', 'futsal4', 'society7', 'campo11', undefined].map(f => {
            const s = migrate({ match: f ? { gameFormat: f } : {}, settings: { keeperMode: f === 'society7' ? 'fila' : 'fixo' } });
            return [s.match.lineSize, s.settings.keeperMode, 'gameFormat' in s.match].join(':'); })""")
        out['migrate'] = mig
        if mig != ['4:time:false', '7:time:false', '11:time:false', '4:fixo:false', '7:fila:false', '11:fixo:false', '4:time:false']: bad.append('format migration')
        # 1v1 without keepers, then 12v12
        await ev(SETUP, 6)
        await ev("updateKeeperMode('sem'); updateGameFormat(1); buildTeams(); switchTab('placar')"); await pg.wait_for_timeout(200)
        await check("state.court.A.ids.length === 1 && state.court.B.ids.length === 1 && state.queue.length === 4", '1v1 teams')
        await check("document.getElementById('match-game-format').value === '1' && document.getElementById('match-gk-mode').value === 'sem'", 'selects show 1v1 sem goleiro')
        await ev(SETUP, 30)
        await ev("updateKeeperMode('time'); updateGameFormat(12); buildTeams()"); await pg.wait_for_timeout(200)
        await check("state.court.A.ids.length === 13 && state.court.B.ids.length === 13", '12v12 + goleiro do time = 13')
        await check("formatLabel().includes('12')", 'format label')

        # ---- penalties on a draw
        await ev(SETUP, 10)
        await ev("byId(1).isGoalkeeper = true; byId(6).isGoalkeeper = true; updateKeeperMode('time'); updateGameFormat(4); updateSetting('drawRule', 'penaltis'); buildTeams(); switchTab('placar')"); await pg.wait_for_timeout(200)
        teams = await ev("({ A: state.court.A.ids.slice(), B: state.court.B.ids.slice(), la: state.court.A.label, lb: state.court.B.label })")
        await ev("state.match.scoreA = 1; state.match.scoreB = 1; state.match.events = [{ type: 'goal', side: 'A', scorerId: state.court.A.ids[1], time: '01:00' }, { type: 'goal', side: 'B', scorerId: state.court.B.ids[1], time: '02:00' }]")
        await ev("finishMatchAndNextChallenger(true)"); await pg.wait_for_timeout(300)
        await check("!document.getElementById('modal-pens').classList.contains('hidden')", 'shootout opens on draw')
        await pg.click('#pens-kickers button >> nth=2')   # someone other than the first picks the first kick
        for r in ['gol', 'defesa', 'gol', 'defesa', 'gol', 'defesa']:
            await ev(f"recordPen('{r}')"); await pg.wait_for_timeout(60)
        await pg.screenshot(path=f'{SHOTS}/v10_pens.png')
        await check("!document.getElementById('pens-done').classList.contains('hidden') && document.getElementById('pens-done').innerText.includes('3 a 0')", 'shootout decided 3x0')
        await pg.click('#pens-done button'); await pg.wait_for_timeout(400)
        r = await ev("""() => ({ pens: state.matchHistory[0].pens, A: state.court.A && state.court.A.label, pg: state.players.reduce((s, p) => s + (p.penGoals || 0), 0),
            pm: state.players.reduce((s, p) => s + (p.penMisses || 0), 0), ps: state.players.reduce((s, p) => s + (p.penSaves || 0), 0),
            first: byId(""" + str(teams['A'][2]) + """).penGoals, st: state.standings })""")
        out['pens'] = {k: r[k] for k in ('pens', 'A', 'pg', 'pm', 'ps', 'first')}
        if not (r['pens'] and r['pens']['a'] == 3 and r['pens']['b'] == 0 and r['A'] == teams['la'] and r['pg'] == 3 and r['pm'] == 3 and r['ps'] == 3 and r['first'] == 1): bad.append('penalties recorded')
        await ev("switchTab('stats'); switchStatsCategory('pens')"); await pg.wait_for_timeout(200)
        await check("document.getElementById('tab-content-stats').innerText.includes('Pênaltis')", 'stats: pênaltis category')
        await pg.screenshot(path=f'{SHOTS}/v10_stats_pens.png')
        await check("document.getElementById('match-history-timeline').innerText.toLowerCase().includes('pênaltis 3 × 0')", 'timeline shows the shootout')
        await check("liveSnapshot().history[0].pens.join() === '3,0'", 'watchers get the shootout')
        # skip button: usual rule
        await ev("updateSetting('drawRule', 'penaltis'); state.match.scoreA = 0; state.match.scoreB = 0; state.match.events = [{ type: 'save', side: 'A', keeperId: 1, time: '00:10' }]")
        await ev("finishMatchAndNextChallenger(true)"); await pg.wait_for_timeout(200)
        await ev("skipShootout()"); await pg.wait_for_timeout(400)
        await check("state.matchHistory.length === 2 && !state.matchHistory[0].pens && state.settings.drawRule === 'penaltis'", 'skip shootout keeps the rule')
        await ev("updateSetting('drawRule', 'king')")

        # ---- swap players between teams and pick teams by hand
        await ev(SETUP, 12)
        await ev("updateKeeperMode('sem'); updateGameFormat(5); buildTeams(); switchTab('fila')"); await pg.wait_for_timeout(200)
        a0, b0 = await ev("[state.court.A.ids[0], state.court.B.ids[0]]")
        await ev(f"openSubModal('A', {a0})"); await pg.wait_for_timeout(200)
        await check("document.getElementById('modal-sub').innerText.toLowerCase().includes('trocar com o outro time')", 'swap section in sub modal')
        await pg.screenshot(path=f'{SHOTS}/v10_swap.png')
        await ev(f"swapBetweenTeams({b0})"); await pg.wait_for_timeout(200)
        await check(f"state.court.A.ids[0] === {b0} && state.court.B.ids[0] === {a0} && state.queue.length === 2", 'swapped, queue untouched')
        await ev("openManualTeams()"); await pg.wait_for_timeout(200)
        await check("!document.getElementById('modal-manual').classList.contains('hidden') && document.getElementById('manual-count').innerText.includes('Time A: 5/5')", 'manual picker opens with current teams')
        await ev("state.players.forEach(p => setManual(p.id, p.id <= 4 ? 'A' : p.id <= 8 ? 'B' : 'Q'))")
        await pg.screenshot(path=f'{SHOTS}/v10_manual.png')
        await ev("saveManualTeams()"); await pg.wait_for_timeout(200)
        await check("[...state.court.A.ids].sort().join() === '1,2,3,4' && [...state.court.B.ids].sort().join() === '5,6,7,8' && state.queue.length === 4 && state.queue.every(id => id > 8)", 'manual teams saved')

        # ---- stats from a baba in progress on someone else's phone
        r = await ev("""() => {
          const tid = 'turma-x'; state.turmas.push({ id: tid, name: 'X', cloud: true, role: 'member', players: ['Ana Souza'], keepers: [], women: [], meta: { 'ana souza': { userId: currentUser.id } } });
          othersOpen = [{ id: 'b-open', title: 'Quinta', players: [{ name: 'Ana Souza', turmaId: tid, goals: 2, assists: 1, saves: 0, matches: 3, wins: 2 }] }];
          const t = myStats(); state.turmas = state.turmas.filter(x => x.id !== tid); othersOpen = []; return t; }""")
        out['live_stats'] = r
        if not (r and r['goals'] == 2 and r['matches'] == 3 and r.get('live')): bad.append('stats from open baba')
        if 'turmaOpenBabas' not in fake.calls: bad.append('pulls open babas of my turmas')

        # ---- multipliers: chance shown, x20 at most, odds follow the chance
        await ev(SETUP, 10)
        await ev("updateKeeperMode('time'); updateGameFormat(4); buildTeams(); byId(2).goals = 6; byId(2).matches = 6; byId(2).wins = 3; state.players.filter(p => p.id !== 2).forEach(p => { p.matches = 6; p.wins = 3; p.goals = 1; })")
        mk = await ev("liveMarkets(true)")
        items = mk['items']
        out['markets'] = [(i['label'], i['odd'], i['pct']) for i in items][:6]
        if not items or not all(1.05 <= i['odd'] <= 20 and 1 <= i['pct'] <= 96 for i in items): bad.append('odds within limits with chance')
        if not all(abs(i['odd'] - min(20, 0.9 / (i['pct'] / 100))) / i['odd'] < 0.15 for i in items if i['odd'] < 20): bad.append('odd follows chance')
        star = next((i for i in items if i['key'] == 'gol:p2'), None)
        others = [i for i in items if i['key'].startswith('gol:') and i['key'] != 'gol:p2']
        if not star or not others or star['odd'] >= min(o['odd'] for o in others): bad.append('top scorer has the lowest scorer odd')
        res = await ev("""() => { state.live = { id: 'L1', code: 'X' }; const q = []; const old = enqueue; enqueue = op => q.push(op);
            queueLiveSettle(1, state.court.A, state.court.B, 2, 1, [{ type: 'goal', scorerId: 2 }, { type: 'goal', scorerId: 2 }, { type: 'goal', scorerId: 7 }]);
            enqueue = old; state.live = null; return q[0].result; }""")
        if res.get('goalsBy') != {'p2': 2, 'p7': 1} or res.get('scorers') != ['p2', 'p7']: bad.append('settle sends goals per player')

        # ---- chat emotes (turma chat)
        tid = await ev("""async () => { const id = crypto.randomUUID(); await api.upsertTurma(id, 'Emotes FC', null);
            state.turmas.push({ id, name: 'Emotes FC', cloud: true, role: 'owner', invite: null, players: [], keepers: [], women: [], meta: {} }); return id; }""")
        await ev(f"openTurmaChat('{tid}')"); await pg.wait_for_timeout(800)
        box = '#page-chat .chat-box'
        if await pg.locator(box).count():
            await pg.click(f'{box} button[aria-label="Emotes"]'); await pg.wait_for_timeout(200)
            await check(f"!document.querySelector('{box} .chat-emotes').classList.contains('hidden') && document.querySelectorAll('{box} .chat-emotes img').length >= 20", 'sticker panel')
            await pg.screenshot(path=f'{SHOTS}/v10_emotes.png')
            await pg.click(f'{box} .chat-emotes button[aria-label="Babinha siuu"]'); await pg.wait_for_timeout(900)
            await check(f"!!document.querySelector('{box} img.chat-sticker[src*=\"siuu\"]')", 'sticker message renders')
            await pg.fill(f'{box} .chat-input input', '⚽🔥'); await pg.press(f'{box} .chat-input input', 'Enter'); await pg.wait_for_timeout(900)
            await check(f"!!document.querySelector('{box} .chat-jumbo')", 'emoji-only message is big')
            await pg.screenshot(path=f'{SHOTS}/v10_chat.png')
        else: bad.append('turma chat present')
        out['chat_bodies'] = [m['body'] for m in fake.chat][-2:]
        await ev("closeTurmaChat()"); await pg.wait_for_timeout(200)

        # ---- Desafio 1v1: Ana challenges Bruno in a game someone else streams
        ctx2 = await newctx()
        pg2 = await ctx2.new_page(); pg2.on('pageerror', lambda e: errs.append('B ' + str(e)))
        await signup(pg2, 'Bruno Lima', 'bruno@t.dev')
        ana = fake.users['ana@t.dev']['id']; bruno = fake.users['bruno@t.dev']['id']
        owner = 'owner-' + ana[:8]; fake.profiles[owner] = {'name': 'Dono', 'avatar': None, 'prefs': {}}
        lid = 'live-duel-1'
        fake.lives[lid] = {'id': lid, 'owner': owner, 'code': 'DUEL1234', 'active': True, 'palpites': True, 'turma_ids': [], 'title': 'Baba de quinta',
                           'updated_at': datetime.datetime.now().isoformat(),
                           'state': {'v': 1, 'matchNo': 1, 'running': True, 'secondsLeft': 300, 'total': 420,
                                     'A': {'label': 'Time 1', 'names': ['Gabriel "Gabi" Marini', 'Beto'], 'score': 0}, 'B': {'label': 'Time 2', 'names': ['Caio', 'Duda'], 'score': 0}, 'events': [], 'history': []},
                           'markets': {'match_no': 1, 'open': True, 'items': [{'key': 'res:A', 'label': 'Time 1 vence', 'group': 'Resultado', 'odd': 1.9, 'pct': 47}]}}
        fake.f_chatSend(bruno, 'live:' + lid, 'bora')
        await ev("openLive('DUEL1234')"); await pg.wait_for_timeout(1500)
        await check("!document.getElementById('lv-duel').classList.contains('hidden') && !document.getElementById('lv-duel-btn').disabled", 'duel box for adults')
        await check("document.getElementById('lv-markets').innerText.includes('47%')", 'chance shown on the market')
        await pg.click('#lv-duel-btn'); await pg.wait_for_timeout(500)
        await check("document.getElementById('btn-duel').disabled", 'send disabled before choosing')
        await pg.click('#duel-body button:has-text("Bruno")'); await pg.wait_for_timeout(100)
        await pg.click('#duel-body button:has-text("Quem faz mais gols")'); await pg.wait_for_timeout(100)
        await pg.click('#duel-body >> text=Gabriel "Gabi" Marini >> nth=0'); await pg.wait_for_timeout(100)
        await pg.click('#duel-body >> text=Caio >> nth=-1'); await pg.wait_for_timeout(100)
        await pg.click('#duel-body button:has-text("50")'); await pg.wait_for_timeout(100)
        await pg.screenshot(path=f'{SHOTS}/v10_duel_new.png')
        await check("!document.getElementById('btn-duel').disabled && document.getElementById('duel-body').innerText.includes('100')", 'ready: wins 100')
        await pg.click('#btn-duel'); await pg.wait_for_timeout(800)
        ch = fake.chals[-1] if getattr(fake, 'chals', None) else None
        out['chal'] = ch and {k: ch[k] for k in ('kind', 'pc', 'po', 'lc', 'lo', 'stake', 'status')}
        if not (ch and ch['kind'] == 'gols' and ch['pc'] == 'gabriel "gabi" marini' and ch['po'] == 'caio' and ch['stake'] == 50 and ch['status'] == 'pending'): bad.append('challenge created')
        if fake.wallets[ana]['balance'] != 950: bad.append('stake taken from Ana')
        await pg.wait_for_timeout(6500)
        await check("document.getElementById('lv-duels').innerText.includes('Esperando')", 'Ana sees it waiting')
        # a second one on the winner, then cancel it
        await pg.click('#lv-duel-btn'); await pg.wait_for_timeout(500)
        await pg.click('#duel-body button:has-text("Bruno")'); await pg.click('#duel-body button:has-text("Time 2 vence")'); await pg.click('#btn-duel'); await pg.wait_for_timeout(800)
        if fake.chals[-1]['pc'] != 'B' or fake.chals[-1]['lo'] != 'Time 1 vence': bad.append('winner challenge sides')
        await ev("loadMyDuels()"); await pg.wait_for_timeout(400)
        await pg.click('#lv-duels button:has-text("Cancelar") >> nth=0'); await pg.wait_for_timeout(600)
        if fake.chals[-1]['status'] != 'canceled' or fake.wallets[ana]['balance'] != 950: bad.append('cancel returns stake')
        await pg.screenshot(path=f'{SHOTS}/v10_duel_list_a.png')

        # Bruno accepts
        await pg2.evaluate("openLive('DUEL1234')"); await pg2.wait_for_timeout(1800)
        await check("document.getElementById('lv-duels').innerText.includes('te desafiou') && document.getElementById('lv-duels').innerText.includes('Caio faz mais gols')", 'Bruno sees the challenge', pg2)
        await pg2.screenshot(path=f'{SHOTS}/v10_duel_incoming.png')
        await pg2.click('#lv-duels button:has-text("Aceitar")'); await pg2.wait_for_timeout(300)
        await pg2.click('#modal-confirm-ok'); await pg2.wait_for_timeout(800)
        if fake.chals[0]['status'] != 'accepted' or fake.wallets[bruno]['balance'] != 950: bad.append('Bruno accepted')
        await check("document.getElementById('lv-duels').innerText.includes('Valendo 100')", 'shows what is at stake', pg2)
        # match ends: Caio 2, Gabriel 1 -> Bruno wins
        fake.f_settlePalpites(owner, lid, 1, {'winner': 'B', 'goalsA': 1, 'goalsB': 2, 'scorers': ['gabriel "gabi" marini', 'caio'], 'goalsBy': {'gabriel "gabi" marini': 1, 'caio': 2}})
        if fake.wallets[bruno]['balance'] != 1050 or fake.wallets[ana]['balance'] != 950: bad.append('winner paid')
        await pg2.wait_for_timeout(6800)
        await check("document.getElementById('lv-duels').innerText.includes('+100')", 'Bruno sees the win', pg2)
        await pg2.screenshot(path=f'{SHOTS}/v10_duel_won.png')
        await pg.wait_for_timeout(500); await ev("loadMyDuels()"); await pg.wait_for_timeout(500)
        await check("document.getElementById('lv-duels').innerText.includes('Perdeu')", 'Ana sees the loss')
        # minors and the organizer never see it
        fake.acct[bruno]['birth'] = datetime.date.today().replace(year=datetime.date.today().year - 17)
        await pg2.wait_for_timeout(3000)
        await check("document.getElementById('lv-duel').classList.contains('hidden')", 'minor: no duel box', pg2)
        # server without v10: box hides itself
        fake.v10_enabled = False
        await ev("liveView.duelOff = false; loadMyDuels()"); await pg.wait_for_timeout(600)
        await check("document.getElementById('lv-duel').classList.contains('hidden')", 'no v10 on server: hidden')
        fake.v10_enabled = True

        # dark mode look at the live page
        await pg.emulate_media(color_scheme='dark'); await ev("document.documentElement.classList.add('dark')"); await pg.wait_for_timeout(300)
        await pg.screenshot(path=f'{SHOTS}/v10_live_dark.png', full_page=False)
        out['errors'] = errs
        await b.close()
    print(json.dumps({'problems': bad, **out}, ensure_ascii=False))
asyncio.run(main())
