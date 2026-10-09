# Visual check of the v6 screens (tour, support, picker, export, dark mode) with the fake server.
import sys, asyncio, json, base64
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
OUT = sys.argv[1]; URL = 'http://localhost:8765/'
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read()
fake = Fake()

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        await ctx.expose_function('fakeCall', lambda n, t, a: fake.handle(n, t, a))
        await ctx.add_init_script(FAKE_JS)
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(300)
        await pg.evaluate("window.askConfirm = async () => true")
        await pg.evaluate("authGo('signup')")
        await pg.fill('#signup-name', 'Gabriel Marini'); await pg.fill('#signup-email', 'g@t.dev'); await pg.fill('#signup-pass', 'segredo1')
        await pg.evaluate("doSignup()"); await pg.wait_for_timeout(300)
        await pg.check('#recovery-ack'); await pg.evaluate("recoveryDone()"); await pg.wait_for_timeout(900)
        shot = lambda n: pg.screenshot(path=f'{OUT}/{n}.png')
        await shot('t1_welcome')
        await pg.evaluate("tourGo(1)"); await pg.wait_for_timeout(500); await shot('t2_profile')
        await pg.evaluate("tourGo(1)"); await pg.wait_for_timeout(500); await shot('t3_turma')
        await pg.evaluate("tourGo(1); tourGo(1); tourGo(1)"); await pg.wait_for_timeout(600); await shot('t6_clock')
        await pg.evaluate("tourGo(1); tourGo(1)"); await pg.wait_for_timeout(600); await shot('t8_finish')
        await pg.evaluate("endTour(false)"); await pg.wait_for_timeout(300)
        # some data: a turma, players, a match
        await pg.evaluate("""async () => {
          createTurma(); const t = state.turmas[0]; t.name = 'Fiasco do Gama';
          t.players = ['Gabriel Marini','Lucas Pavetits','Pedro Pontes','Arthur Grangeiro','Dedé Grangeiro','Eduardo Altoé','Pedro Coelho','Rafa Pacheco','Rafael Lugon','Lani Ramos','Lucca'];
          t.keepers = ['Lani Ramos']; closeTurmaEditor(); state.selectedTeams = [t.id]; syncPool(); closeDatabaseModal();
          state.players.forEach(p => checkIn(p.id)); buildTeams(); state.match.goalLimitRule = 'none';
          selectedGoalSide='A'; selectedGoalScorer = state.court.A.ids[1]; confirmGoalRecord(state.court.A.ids[2]);
          selectedGoalSide='A'; selectedGoalScorer = state.court.A.ids[1]; confirmGoalRecord(null);
          await finishMatchAndNextChallenger(true); commit(); document.getElementById('toast-container').innerHTML=''; }""")
        await pg.wait_for_timeout(400)
        await pg.evaluate("setPref('theme','dark'); switchTab('inicio'); window.scrollTo(0,0)"); await pg.wait_for_timeout(300)
        await pg.screenshot(path=f'{OUT}/d_home.png', full_page=True)
        await pg.evaluate("switchTab('placar')"); await pg.wait_for_timeout(300); await pg.screenshot(path=f'{OUT}/d_placar.png', full_page=True)
        await pg.evaluate("switchTab('stats')"); await pg.wait_for_timeout(300); await pg.screenshot(path=f'{OUT}/d_stats.png', full_page=True)
        await pg.evaluate("openDatabaseModal(); openTurmaEditor(state.turmas[0].id)"); await pg.wait_for_timeout(400); await shot('d_turma')
        await pg.evaluate("closeTurmaEditor(); closeDatabaseModal(); setPref('theme','light'); switchTab('inicio')")
        await pg.evaluate("openProfile()"); await pg.wait_for_timeout(400)
        await pg.evaluate("document.getElementById('toast-container').innerHTML=''")
        await pg.screenshot(path=f'{OUT}/p_profile.png', full_page=False)
        await pg.evaluate("openAvatarPicker('me')"); await pg.wait_for_timeout(300); await shot('p_picker')
        await pg.evaluate("closeAvatarPicker(); openSupport()"); await pg.wait_for_timeout(400); await shot('s_support')
        await pg.fill('#faq-search', 'adm'); await pg.evaluate("renderFaq('adm')"); await pg.wait_for_timeout(200); await shot('s_search')
        await pg.evaluate("closeSupport(); closeProfile()")
        # export sheet with generated photos
        await pg.evaluate("""() => {
          const mk = (w, h, c1, c2) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
            const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, c1); g.addColorStop(1, c2); x.fillStyle = g; x.fillRect(0, 0, w, h);
            x.fillStyle = 'rgba(255,255,255,.85)'; x.font = 'bold 90px sans-serif'; x.fillText('FOTO', 40, h / 2); return { url: c.toDataURL('image/jpeg', .8), w, h }; };
          exportPhotos = [mk(1600, 1067, '#0B4A42', '#7BE0A8'), mk(1067, 1600, '#E5BD45', '#B4412F'), mk(1600, 900, '#12302B', '#FFEDA8'), mk(1200, 1200, '#2E7D54', '#D6E7C9')];
          openExportSheet(); document.getElementById('export-note').value = 'Jogão! Valeu a todos, semana que vem tem mais.'; }""")
        await pg.wait_for_timeout(300); await shot('e_export')
        pdf = await pg.evaluate("""async () => {
          let blob = null; const orig = offerFile; offerFile = async (n, b) => { blob = b; };
          await generateBabaPDF(); offerFile = orig;
          const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]); return btoa(s); }""")
        open(f'{OUT}/baba.pdf', 'wb').write(base64.b64decode(pdf))
        print(json.dumps({'errors': errs}))
        await b.close()
asyncio.run(main())
