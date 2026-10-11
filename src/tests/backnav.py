import sys, asyncio, json
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read(); fake = Fake()
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width': 390, 'height': 844})
        await ctx.expose_function('fakeCall', lambda n, t, a: fake.handle(n, t, a)); await ctx.add_init_script(FAKE_JS)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8765/', wait_until='load'); await pg.wait_for_timeout(300)
        await pg.evaluate("authGo('signup')")
        await pg.fill('#signup-name', 'Gabriel'); await pg.fill('#signup-email', 'g@t.dev'); await pg.fill('#signup-pass', 'segredo1')
        await pg.evaluate("doSignup()"); await pg.wait_for_timeout(300); await pg.check('#recovery-ack'); await pg.evaluate("recoveryDone()"); await pg.wait_for_timeout(900)
        await pg.wait_for_timeout(400)
        if await pg.evaluate("!document.getElementById('page-terms-gate').classList.contains('hidden')"):
            await pg.fill('#terms-birth', '1995-05-05'); await pg.check('#terms-ack'); await pg.evaluate("submitTerms()"); await pg.wait_for_timeout(700)
        await pg.click('#tour-next'); await pg.click('text=Pular'); await pg.wait_for_timeout(300)
        vis = lambda i: pg.evaluate(f"!document.getElementById('{i}').classList.contains('hidden')")
        out = {}
        await pg.click('#header-profile'); await pg.wait_for_timeout(300)
        await pg.click('#page-profile button[aria-label="Ajuda"]'); await pg.wait_for_timeout(300)
        out['both_open'] = [await vis('page-profile'), await vis('page-support')]
        await pg.go_back(); await pg.wait_for_timeout(300)
        out['after_back1'] = [await vis('page-profile'), await vis('page-support')]
        await pg.go_back(); await pg.wait_for_timeout(300)
        out['after_back2'] = [await vis('page-profile'), await vis('page-support'), pg.url, await vis('app-root')]
        await pg.click('#header-profile'); await pg.wait_for_timeout(300)
        await pg.click('#page-profile button[aria-label="Ajuda"]'); await pg.wait_for_timeout(300)
        await pg.click('#tutorial-hub button >> nth=1'); await pg.wait_for_timeout(600)
        out['tour_from_support'] = [await vis('page-profile'), await vis('page-support'), await vis('tour')]
        await pg.evaluate("endTour(false)"); await pg.wait_for_timeout(200)
        await pg.click('#header-profile'); await pg.wait_for_timeout(300)
        await pg.click('#page-profile button[aria-label="Voltar"]'); await pg.wait_for_timeout(300)
        out['closed_by_button'] = await vis('page-profile')
        out['history_len'] = await pg.evaluate('history.length')
        print(json.dumps(out), errs); await b.close()
asyncio.run(main())
