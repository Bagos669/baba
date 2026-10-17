# v11.3 smoke: 3-tab nav, turmas panes, loja tab, floating profile, settings.
import sys, asyncio, os
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read(); fake = Fake()
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/v113'; os.makedirs(OUT, exist_ok=True)
URL = 'http://localhost:8765/'
exec(open(f'{sys.path[0]}/v112_smoke.py').read().split('MK =')[0].split("bad = []")[1].replace('async def signup','async def signup',1)) if False else None
async def signup(pg, name, email):
    await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(300)
    await pg.evaluate("authGo('signup')")
    await pg.fill('#signup-name', name); await pg.fill('#signup-email', email); await pg.fill('#signup-pass', 'segredo1')
    await pg.evaluate("doSignup()"); await pg.wait_for_timeout(300); await pg.check('#recovery-ack'); await pg.evaluate("recoveryDone()"); await pg.wait_for_timeout(1000)
    if await pg.evaluate("!document.getElementById('page-terms-gate').classList.contains('hidden')"):
        await pg.fill('#terms-birth', '1990-02-02'); await pg.check('#terms-ack'); await pg.evaluate("submitTerms()"); await pg.wait_for_timeout(700)
    await pg.click('#tour-next'); await pg.click('text=Pular'); await pg.wait_for_timeout(400)
    while await pg.evaluate("!document.getElementById('modal-popup').classList.contains('hidden')"):
        await pg.click('#popup-ok'); await pg.wait_for_timeout(300)

async def main():
    fake._v8init(); bad = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844})
        await ctx.expose_function('fakeCall', lambda n, t, a: fake.handle(n, t, a)); await ctx.add_init_script(FAKE_JS)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await signup(pg, 'Gabriel Marini', 'adm@t.dev')
        vis = lambda sel: pg.evaluate(f"(()=>{{const e=document.querySelector('{sel}');return !!e&&!e.classList.contains('hidden')&&getComputedStyle(e).display!=='none'}})()")
        await pg.screenshot(path=f'{OUT}/inicio.png')
        if await pg.evaluate("document.querySelectorAll('nav .nav-tab-btn').length") != 3: bad.append('nav != 3')
        if await vis('#home-shortcuts'): bad.append('atalhos ainda aparecem')
        await pg.click('#tab-nav-turmas'); await pg.wait_for_timeout(300)
        if not await vis('#tab-content-ficha'): bad.append('turmas nao abre na lista')
        await pg.screenshot(path=f'{OUT}/turmas.png')
        for n in ['fila', 'placar', 'stats', 'ficha']:
            await pg.click(f'#tab-nav-{n}'); await pg.wait_for_timeout(150)
            if not await vis(f'#tab-content-{n}'): bad.append('pane ' + n)
            if await vis('#tab-content-inicio'): bad.append('inicio visivel em ' + n)
        await pg.click('#tab-nav-loja'); await pg.wait_for_timeout(600)
        if not await vis('#tab-content-loja'): bad.append('loja')
        await pg.screenshot(path=f'{OUT}/loja.png')
        await pg.click('#header-profile'); await pg.wait_for_timeout(400)
        if not await vis('#page-profile'): bad.append('perfil')
        await pg.click('#pf-pos button >> nth=0'); await pg.wait_for_timeout(200)
        if await pg.evaluate("prefs.position") != 'Goleiro': bad.append('posicao nao salvou')
        await pg.screenshot(path=f'{OUT}/perfil.png', full_page=False)
        await pg.evaluate("closeProfile()")
        await pg.click('#header-settings'); await pg.wait_for_timeout(400)
        if not await vis('#page-settings'): bad.append('settings')
        await pg.screenshot(path=f'{OUT}/config.png')
        await pg.evaluate("closeSettings()"); await pg.evaluate("switchTab('inicio')")
        await b.close()
    print({'problems': bad, 'errs': errs})
asyncio.run(main())
