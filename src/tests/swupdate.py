import sys, asyncio, json
from playwright.async_api import async_playwright
T = sys.argv[1]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context()
        await ctx.add_init_script("window.__BABA_FAKE_API__ = { enabled: () => false };")
        pg = await ctx.new_page(); errs = []; logs = []
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: logs.append(m.text))
        await pg.goto('http://localhost:8766/', wait_until='load')
        await pg.wait_for_function("navigator.serviceWorker.controller !== null", timeout=15000)
        await pg.evaluate("navigator.serviceWorker.addEventListener('controllerchange', () => console.log('CC fired'))")
        v1 = await pg.evaluate("fetch('sw.js').then(r=>r.text()).then(t=>t.match(/VERSION = '([^']+)'/)[1])")
        open(f'{T}/index.html','a').write('<!--MARK2-->')
        open(f'{T}/app.js','a').write('\nwindow.__MARK2 = true;\n')
        sw = open(f'{T}/sw.js').read(); open(f'{T}/sw.js','w').write(sw.replace(v1, 'newversion1'))
        print('upd', await pg.evaluate("navigator.serviceWorker.getRegistration().then(r => r.update()).then(() => 'ok', e => String(e))"))
        try: await pg.wait_for_function("window.__MARK2 === true", timeout=15000)
        except Exception as e: print('no reload')
        print(json.dumps({'v1': v1, 'js_new': await pg.evaluate("window.__MARK2 === true"), 'html_new': '<!--MARK2-->' in await pg.content(), 'errors': errs, 'logs': logs[-5:]}))
        await ctx.set_offline(True); await pg.reload(wait_until='load')
        print('offline ok:', await pg.evaluate("window.__MARK2 === true && !!document.getElementById('scr-landing')"))
        await b.close()
asyncio.run(main())
