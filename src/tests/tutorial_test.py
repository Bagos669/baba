# Walks every tutorial chapter: steps render, spotlights find their targets, demos animate, progress is kept.
import sys, asyncio, json, os
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read(); fake = Fake()
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/tutshots'
os.makedirs(SHOTS, exist_ok=True)
out, bad = {'missing_targets': []}, []

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844})
        await ctx.expose_function('fakeCall', lambda n, t, a: fake.handle(n, t, a)); await ctx.add_init_script(FAKE_JS)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        ev = pg.evaluate
        await pg.goto('http://localhost:8765/', wait_until='load'); await pg.wait_for_timeout(300)
        await ev("authGo('signup')")
        await pg.fill('#signup-name', 'Gabriel'); await pg.fill('#signup-email', 'g@t.dev'); await pg.fill('#signup-pass', 'segredo1')
        await ev("doSignup()"); await pg.wait_for_timeout(300); await pg.check('#recovery-ack'); await ev("recoveryDone()"); await pg.wait_for_timeout(1000)
        if await ev("!document.getElementById('page-terms-gate').classList.contains('hidden')"):
            await pg.fill('#terms-birth', '1995-05-05'); await pg.check('#terms-ack'); await ev("submitTerms()"); await pg.wait_for_timeout(800)
        # a baba in progress so the spotlights have something to show
        await ev("""() => { const mk = (id, name, gk) => Object.assign(newPlayer(name, null), { id, isGoalkeeper: gk, present: true, arrival: id, arrivedAt: Date.now() });
          state.players = Array.from({ length: 13 }, (_, i) => mk(i + 1, ['Ana','Beto','Caio','Duda','Edu','Fê','Gui','Hugo','Ivo','Jô','Kaká','Lia','Mel'][i], i === 4)); state.queue = state.players.map(p => p.id); state.arrivalSeq = 13;
          buildTeams(); }""")
        await pg.wait_for_timeout(300)
        chapters = await ev("TUTORIAL.map(c => ({ id: c.id, n: c.steps.length }))")
        out['chapters'] = chapters
        for ci, ch in enumerate(chapters):
            if ci > 0:
                await ev(f"startChapter('{ch['id']}')"); await pg.wait_for_timeout(500)
            else:
                await pg.wait_for_selector('#tour:not(.hidden)', timeout=5000)
            for i in range(ch['n']):
                await pg.wait_for_timeout(450)
                info = await ev("""() => { const st = TOUR_STEPS()[tourIndex]; return { label: document.getElementById('tour-step').innerText, target: st.target || null,
                   found: !!tourTarget(st), demo: st.demo || null, demoShown: !document.getElementById('tour-demo').classList.contains('hidden'),
                   img: document.getElementById('tour-img').getAttribute('src') }; }""")
                if info['target'] and not info['found']: out['missing_targets'].append(f"{ch['id']}#{i + 1} {info['target']}")
                if bool(info['demo']) != info['demoShown']: bad.append(f"demo visibility {ch['id']}#{i + 1}")
                if not info['label'].lower().startswith(f"capítulo {ci + 1}"): bad.append(f"label {info['label']}")
                if info['demo']:
                    await pg.screenshot(path=f"{SHOTS}/tut_{ch['id']}_{i + 1}_{info['demo']}_a.png")
                    await pg.wait_for_timeout(3400)
                    await pg.screenshot(path=f"{SHOTS}/tut_{ch['id']}_{i + 1}_{info['demo']}_b.png")
                elif i in (1, ch['n'] - 1) or ci == 0:
                    await pg.screenshot(path=f"{SHOTS}/tut_{ch['id']}_{i + 1}.png")
                await pg.click('#tour-next')
            await pg.wait_for_timeout(400)
            if ci == 0:
                # first run: notes are not shown after the tour; home reminds the next chapter
                await pg.wait_for_timeout(500)
                if await ev("!document.getElementById('modal-popup').classList.contains('hidden')"): await ev("closePopup()")
                if not await ev("document.getElementById('home-v7').innerText.includes('Próximo: Regras do Rei da Quadra')"): bad.append('home card shows next chapter')
                await pg.screenshot(path=f"{SHOTS}/tut_home_card.png")
        await ev("openSupport()"); await pg.wait_for_timeout(300)
        await pg.locator('#tutorial-section').scroll_into_view_if_needed(); await pg.wait_for_timeout(200)
        await pg.screenshot(path=f"{SHOTS}/tut_hub.png")
        out['progress'] = await ev("document.getElementById('tutorial-progress').innerText")
        if out['progress'] != '6 de 6 capítulos vistos': bad.append('all chapters marked')
        await ev("closeSupport()"); await pg.wait_for_timeout(200)
        if 'Tutorial do Babinha' in await ev("document.getElementById('home-v7').innerText"): bad.append('home card gone when all done')
        out['saved'] = await ev("JSON.parse(localStorage.getItem('baba_prefs_v1')).tutorialChapters")
        out['errors'] = errs
        await b.close()
    print(json.dumps({'problems': bad, **out}, ensure_ascii=False))
asyncio.run(main())
