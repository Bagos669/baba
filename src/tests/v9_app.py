# v9 in the app: watch by code, fixed-keeper formats, exclusive items, weekly missions.
import sys, asyncio, json, os, uuid, datetime as dt
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read(); fake = Fake()
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/v9shots'
os.makedirs(SHOTS, exist_ok=True)
URL = 'http://localhost:8765/'
out, bad = {}, []

async def signup(pg, name, email):
    await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(300)
    await pg.evaluate("authGo('signup')")
    await pg.fill('#signup-name', name); await pg.fill('#signup-email', email); await pg.fill('#signup-pass', 'segredo1')
    await pg.evaluate("doSignup()"); await pg.wait_for_timeout(300); await pg.check('#recovery-ack'); await pg.evaluate("recoveryDone()"); await pg.wait_for_timeout(1000)
    if await pg.evaluate("!document.getElementById('page-terms-gate').classList.contains('hidden')"):
        await pg.fill('#terms-birth', '1995-05-05'); await pg.check('#terms-ack'); await pg.evaluate("submitTerms()"); await pg.wait_for_timeout(700)
    await pg.click('#tour-next'); await pg.click('text=Pular'); await pg.wait_for_timeout(500)

async def check(pg, cond, label):
    if not await pg.evaluate(cond): bad.append(label)

async def main():
    fake._v7init(); fake._v9init()
    fake.lives['live-1'] = {'id': 'live-1', 'code': 'AB12CD34', 'owner': 'someone', 'title': 'Fiasco FC · Sábado', 'active': True, 'palpites': False,
                            'state': {}, 'updated_at': dt.datetime.now().isoformat(), 'turma_ids': []}
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844})
        await ctx.expose_function('fakeCall', lambda n, t, a: fake.handle(n, t, a)); await ctx.add_init_script(FAKE_JS)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))

        # ---- 1. spectator types the code on the entry screen
        await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(400)
        await pg.click('text=Assistir um jogo ao vivo com código'); await pg.wait_for_timeout(200)
        await pg.fill('#watch-code', 'ff00ff00'); await pg.click('#watch-btn'); await pg.wait_for_timeout(300)
        await check(pg, "document.getElementById('watch-error').innerText.includes('Não achei')", 'wrong code message')
        await pg.fill('#watch-code', 'ab12-cd34'); await pg.wait_for_timeout(50)
        await check(pg, "document.getElementById('watch-code').value === 'AB12CD34'", 'code input cleans itself')
        await pg.screenshot(path=f'{SHOTS}/v9_watch_modal.png')
        await pg.click('#watch-btn'); await pg.wait_for_timeout(700)
        await check(pg, "!document.getElementById('page-live').classList.contains('hidden') && document.getElementById('lv-title').innerText.includes('Fiasco')", 'opens the live game')
        await pg.evaluate('closeLive()'); await pg.wait_for_timeout(200)

        # ---- 2. owner account: exclusive items
        await signup(pg, 'Gabriel', 'gabrieljastim13@gmail.com')
        uid = fake.users['gabrieljastim13@gmail.com']['id']
        await check(pg, "document.getElementById('home-v7').innerText.includes('Assistir um jogo ao vivo')", 'home has watch card')
        fake.mprog[uid] = {'days_active': 3, 'goals': 1}
        await pg.evaluate("loadMissions().then(renderHomeV7)"); await pg.wait_for_timeout(400)
        await check(pg, "document.getElementById('home-v7').innerText.includes('1 missão pronta')", 'home shows mission ready')
        await pg.evaluate("openShop()"); await pg.wait_for_timeout(700)
        await check(pg, "document.getElementById('shop-items').innerText.includes('Teal & Orange')", 'owner sees teal frame')
        await pg.evaluate("equipShopItem('frame_teal_orange', true)"); await pg.wait_for_timeout(300)
        await pg.evaluate("equipShopItem('name_teal_orange', true)"); await pg.wait_for_timeout(300)
        await pg.evaluate("equipShopItem('fx_frame_fogo_azul', true)"); await pg.wait_for_timeout(300)
        await pg.evaluate("equipShopItem('fx_name_fogo_azul', true)"); await pg.wait_for_timeout(300)
        await check(pg, "document.getElementById('header-profile').classList.contains('fr-tealorange') && document.getElementById('header-profile').classList.contains('fogo')", 'header frame teal + fire')
        await check(pg, "!!document.querySelector('#shop-preview-name .nm-tealorange.fogo')", 'name teal + fire')
        await pg.evaluate("shopTab('fx')"); await pg.wait_for_timeout(200)
        await check(pg, "document.getElementById('shop-items').innerText.includes('Fundador')", 'fire items badged Fundador')
        await pg.evaluate("document.getElementById('page-shop').scrollTop = 0"); await pg.wait_for_timeout(500)
        await pg.screenshot(path=f'{SHOTS}/v9_shop_top.png')
        await pg.locator('#shop-tabs').scroll_into_view_if_needed(); await pg.wait_for_timeout(300)
        await pg.screenshot(path=f'{SHOTS}/v9_shop_fx.png')
        await pg.evaluate("shopTab('frame')"); await pg.wait_for_timeout(300)
        await pg.screenshot(path=f'{SHOTS}/v9_shop_frames.png')

        # ---- 3. missions
        await pg.locator('#shop-missions').scroll_into_view_if_needed(); await pg.wait_for_timeout(200)
        await pg.screenshot(path=f'{SHOTS}/v9_missions.png')
        bal0 = fake.wallets[uid]['balance']
        await pg.click('#shop-missions button:has-text("Pegar")'); await pg.wait_for_timeout(500)
        out['mission_paid'] = fake.wallets[uid]['balance'] - bal0
        await check(pg, "document.getElementById('shop-missions').innerText.includes('1 de 7 feitas')", 'mission marked done')
        await pg.wait_for_timeout(400)
        await check(pg, "document.getElementById('shop-ledger').innerText.includes('Missão: Presença garantida')", 'ledger names the mission')
        await pg.evaluate("closeShop()"); await pg.wait_for_timeout(200)

        # ---- 4. fixed goalkeepers
        await pg.evaluate("""() => {
          const mk = (id, name, gk) => Object.assign(newPlayer(name, null), { id, isGoalkeeper: gk, present: true, arrival: id, arrivedAt: Date.now() });
          state.players = [mk(1, 'Goleiro Um', true), ...Array.from({length: 9}, (_, i) => mk(i + 2, 'Linha ' + (i + 1), false)), mk(11, 'Goleiro Dois', true)];
          state.court = { A: null, B: null }; state.queue = state.players.map(p => p.id); state.arrivalSeq = 11;
          updateKeeperMode('fixo'); updateGameFormat(4); buildTeams(); switchTab('placar');
        }""")
        await pg.wait_for_timeout(400)
        res = await pg.evaluate("""() => ({ A: state.court.A.ids.length, B: state.court.B.ids.length,
          keepersOut: ![...state.court.A.ids, ...state.court.B.ids, ...state.queue].some(id => byId(id).isGoalkeeper),
          queue: state.queue.length, line: document.getElementById('fixed-keepers').innerText })""")
        out['fixed'] = res
        if not (res['A'] == 4 and res['B'] == 4 and res['keepersOut'] and res['queue'] == 1 and 'Goleiro Um' in res['line'] and 'Goleiro Dois' in res['line']): bad.append('fixed keepers teams')
        await pg.screenshot(path=f'{SHOTS}/v9_fixed_keepers.png')
        await pg.evaluate("finishMatchAndNextChallenger(true)"); await pg.wait_for_timeout(400)
        await check(pg, "byId(1).matches === 1 && byId(11).matches === 1", 'fixed keepers get the match')
        await check(pg, "state.court.A.ids.length === 4 && state.court.B.ids.length === 4 && ![...state.court.A.ids, ...state.court.B.ids].some(id => byId(id).isGoalkeeper)", 'rotation keeps keepers out')
        await pg.evaluate("updateKeeperMode('time')"); await pg.wait_for_timeout(200)
        await check(pg, "[...state.court.A.ids, ...state.court.B.ids, ...state.queue].filter(id => byId(id).isGoalkeeper).length === 2", 'back to normal: keepers rejoin')
        await check(pg, "document.getElementById('fixed-keepers').classList.contains('hidden')", 'fixed line hidden in normal format')
        await check(pg, "[...document.querySelectorAll('#match-game-format option')].map(o => o.value).join() === '1,2,3,4,5,6,7,8,9,10,11,12' && [...document.querySelectorAll('#match-gk-mode option')].map(o => o.value).join() === 'time,fixo,fila,sem'", 'format options')

        # ---- 5. a regular account (not a founder) sees no team items and can't get fire
        fake.founders = set()
        ctx2 = await b.new_context(viewport={'width': 390, 'height': 844})
        await ctx2.expose_function('fakeCall', lambda n, t, a: fake.handle(n, t, a)); await ctx2.add_init_script(FAKE_JS)
        pg2 = await ctx2.new_page(); pg2.on('pageerror', lambda e: errs.append(str(e)))
        await signup(pg2, 'Lucas', 'lucas@t.dev')
        await pg2.evaluate("openShop()"); await pg2.wait_for_timeout(700)
        await check(pg2, "!document.getElementById('shop-items').innerText.includes('Teal')", 'regular account: no team items')
        await pg2.evaluate("shopTab('fx')"); await pg2.wait_for_timeout(200)
        await check(pg2, "document.getElementById('shop-items').innerText.includes('Só para os 100 primeiros')", 'regular account: fire locked')
        await pg2.locator('#shop-tabs').scroll_into_view_if_needed(); await pg2.wait_for_timeout(300)
        await pg2.screenshot(path=f'{SHOTS}/v9_shop_locked.png')
        out['errors'] = errs
        await b.close()
    print(json.dumps({'problems': bad, **out}, ensure_ascii=False))
asyncio.run(main())
