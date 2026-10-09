# The v7 app against a server without the v7 functions: nothing new shows, nothing breaks.
import sys, asyncio, json
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read()
fake = Fake(); fake._v7init(); fake.v7_enabled = False
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width': 390, 'height': 844})
        await ctx.expose_function('fakeCall', lambda n, t, a: fake.handle(n, t, a)); await ctx.add_init_script(FAKE_JS)
        await ctx.add_init_script("localStorage.setItem('baba_prefs_v1', JSON.stringify({tutorialDone: true}))")
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8765/', wait_until='load'); await pg.wait_for_timeout(300)
        await pg.evaluate("window.askConfirm = async () => true; authGo('signup')")
        await pg.fill('#signup-name', 'Gabriel'); await pg.fill('#signup-email', 'g@t.dev'); await pg.fill('#signup-pass', 'segredo1')
        await pg.evaluate("doSignup()"); await pg.wait_for_timeout(300); await pg.check('#recovery-ack'); await pg.evaluate("recoveryDone()"); await pg.wait_for_timeout(900)
        r = await pg.evaluate("""async () => { createTurma(); const t = state.turmas[0]; t.players = ['A','B','C','D','E','F','G','H','I','J']; closeTurmaEditor();
            state.selectedTeams = [t.id]; syncPool(); closeDatabaseModal(); state.players.forEach(p => checkIn(p.id)); buildTeams(); commit(); switchTab('placar'); toggleMatchTimer();
            await new Promise(r => setTimeout(r, 800));
            const vis = id => { const e = document.getElementById(id); return !!e && !e.classList.contains('hidden'); };
            return { v7, gate: vis('page-terms-gate'), pill: vis('live-pill'), qr: vis('modal-qr'), live: state.live, app: vis('app-root'), shopRow: !document.querySelector('[data-v7]').classList.contains('hidden') }; }""")
        print(json.dumps({'state': r, 'errors': errs}))
        await b.close()
asyncio.run(main())
