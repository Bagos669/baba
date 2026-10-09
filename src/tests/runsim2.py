import sys, asyncio, json
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script("window.__BABA_FAKE_API__ = { enabled: () => false };")
        await pg.goto('http://localhost:8765/', wait_until='load')
        await pg.wait_for_timeout(300)
        await pg.evaluate("""() => { currentUser = { id: 'sim', name: 'Sim Teste', email: 'sim@teste.dev' };
          const _d = defaultState; defaultState = () => { const s = _d(); s.turmas = seedTurmas(); return s; }; }""")
        await pg.add_script_tag(path=sys.argv[1])
        rep = await pg.evaluate('runSims()')
        print(json.dumps(rep, indent=1, ensure_ascii=False))
        print('page errors:', errs)
        await b.close()
asyncio.run(main())
