# v11.2 smoke: privacy, hub (ranking, trophies, desafios), explore, challenges (closed + open), result confirm, championship.
import sys, asyncio, json, os, uuid
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read(); fake = Fake()
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/v112'
os.makedirs(OUT, exist_ok=True)
URL = 'http://localhost:8765/'
bad = []
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
MK = """async (a) => { const id = crypto.randomUUID(); await api.upsertTurma(id, a.name, a.code);
  state.turmas.push({ id, name: a.name, cloud: true, role: 'owner', invite: a.code, players: a.names, keepers: [], women: [], meta: {} });
  await syncTurmaNow(id); return id; }"""
async def main():
    fake._v8init()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        async def ctxpg():
            ctx = await b.new_context(viewport={'width': 390, 'height': 844})
            await ctx.expose_function('fakeCall', lambda n, t, a: fake.handle(n, t, a)); await ctx.add_init_script(FAKE_JS)
            pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.errs = errs; return pg
        a = await ctxpg(); await signup(a, 'Gabriel Marini', 'adm@t.dev')
        alfa = await a.evaluate(MK, {'name': 'Alfa FC', 'code': 'ALFA1111', 'names': ['Artur', 'Beto', 'Caio', 'Davi', 'Edu']})
        adm = fake.users['adm@t.dev']['id']
        m = await ctxpg(); await signup(m, 'Bia Beta', 'bia@t.dev')
        beta = await m.evaluate(MK, {'name': 'Beta FC', 'code': 'BETA2222', 'names': ['Bruno', 'Bia', 'Bento']})
        bia = fake.users['bia@t.dev']['id']
        c = await ctxpg(); await signup(c, 'Gil Gama', 'gil@t.dev')
        gama = await c.evaluate(MK, {'name': 'Gama FC', 'code': 'GAMA3333', 'names': ['Gil', 'Hugo']})
        # three finished babas for Alfa
        for i, d in enumerate(['2026-08-01', '2026-09-05', '2026-10-10']):
            bid = str(uuid.uuid4())
            fake.babas[bid] = {'id': bid, 'created_by': adm, 'turma_ids': [alfa], 'title': 'Baba', 'played_on': d, 'state': None, 'finished': True, 'matches': 5, 'updated': i}
            fake.stats[bid] = [{'name': 'Artur', 'goals': 3 + i, 'assists': 1, 'saves': 0, 'matches': 4, 'wins': 2, 'turma_player_id': None},
                               {'name': 'Beto', 'goals': 1, 'assists': 4, 'saves': 0, 'matches': 4, 'wins': 3, 'turma_player_id': None},
                               {'name': 'Caio', 'goals': 0, 'assists': 0, 'saves': 9, 'matches': 4, 'wins': 1, 'turma_player_id': None}]
        fake._tminit()
        fake.trophies.append({'turma_id': alfa, 'scope': 'atleta', 'kind': 'artilheiro', 'title': 'Artilheiro da temporada', 'season': '2026-S1', 'ref': '', 'name': 'Artur', 'value': 21})
        fake.trophies.append({'turma_id': alfa, 'scope': 'atleta', 'kind': 'paredao', 'title': 'Paredão da temporada', 'season': '2026-S1', 'ref': '', 'name': 'Caio', 'value': 33})
        await a.evaluate("pullCloud(true)"); await a.wait_for_timeout(900)
        await m.evaluate("pullCloud(true)"); await m.wait_for_timeout(900)
        # --- turma editor shows the card; hub opens on ranking
        await a.evaluate(f"openTurmaEditor('{alfa}')"); await a.wait_for_timeout(500)
        if await a.evaluate("document.getElementById('turma-edit-hub').classList.contains('hidden')"): bad.append('hub card hidden')
        await a.screenshot(path=f'{OUT}/editor_card.png')
        await a.evaluate(f"openTurmaHub('{alfa}')"); await a.wait_for_timeout(900)
        txt = await a.inner_text('#thub-body')
        if 'Artur' not in txt or 'Temporada' not in txt: bad.append('ranking season: ' + txt[:120])
        await a.screenshot(path=f'{OUT}/hub_rank.png')
        await a.click('#thub-body button:has-text("Última partida")'); await a.wait_for_timeout(500)
        if 'Última partida' not in await a.inner_text('#thub-body'): bad.append('last label')
        await a.click('#thub-body button:has-text("Defesas")'); await a.wait_for_timeout(500)
        t2 = await a.inner_text('#thub-body')
        if 'Caio' not in t2 or '9' not in t2: bad.append('saves ranking')
        await a.click('#thub-body button:has-text("Top 26")'); await a.wait_for_timeout(400)
        await a.click('#thub-head button:has-text("Troféus")'); await a.wait_for_timeout(500)
        t3 = await a.inner_text('#thub-body')
        if 'Artilheiro da temporada' not in t3 or 'Paredão' not in t3: bad.append('trophies: ' + t3[:100])
        await a.screenshot(path=f'{OUT}/hub_trophies.png')
        await a.click('#thub-head button:has-text("Desafios")'); await a.wait_for_timeout(500)
        t4 = await a.inner_text('#thub-body')
        if 'precisa ser' not in t4: bad.append('private turma hint')
        await a.screenshot(path=f'{OUT}/hub_private.png')
        # --- turn public
        await a.evaluate("toggleTurmaPublic(true)"); await a.wait_for_timeout(600)
        if alfa not in fake.pub: bad.append('privacy not saved')
        if 'Desafiar uma turma' not in await a.inner_text('#thub-body'): bad.append('challenge buttons after public')
        await a.screenshot(path=f'{OUT}/hub_public.png')
        # Beta public (by Bia) and Gama public (by Gabriel)
        await m.evaluate(f"openTurmaHub('{beta}')"); await m.wait_for_timeout(600); await m.evaluate("toggleTurmaPublic(true)"); await m.wait_for_timeout(500); await m.evaluate("closeHub()")
        await c.evaluate(f"openTurmaHub('{gama}')"); await c.wait_for_timeout(600); await c.evaluate("toggleTurmaPublic(true)"); await c.wait_for_timeout(500); await c.evaluate("closeHub()")
        await a.evaluate("closeHub()")
        # --- explore: Beta shows up; Gabriel challenges Beta (closed friendly)
        await a.evaluate(f"closeTurmaEditor(); openExplore('turmas')"); await a.wait_for_timeout(800)
        ex = await a.inner_text('#explore-list')
        if 'Beta FC' not in ex: bad.append('explore lists Beta: ' + ex[:100])
        await a.screenshot(path=f'{OUT}/explore.png')
        await a.evaluate(f"pickChallenge('{beta}')"); await a.wait_for_timeout(400)
        await a.select_option('#ff-home', alfa)
        await a.fill('#ff-place', 'Arena Alfa'); await a.fill('#ff-note', '5x5')
        await a.screenshot(path=f'{OUT}/match_form.png')
        await a.click('#form-ok'); await a.wait_for_timeout(700)
        ms = list(fake.tmatches.values())
        if not (len(ms) == 1 and ms[0]['kind'] == 'amistoso_fechado' and ms[0]['away'] == beta and ms[0]['status'] == 'pending'): bad.append('closed challenge not created')
        # Bia accepts from the Beta hub
        await m.evaluate(f"openTurmaHub('{beta}')"); await m.wait_for_timeout(500); await m.click('#thub-head button:has-text("Desafios")'); await m.wait_for_timeout(600)
        if 'Aceitar' not in await m.inner_text('#thub-body'): bad.append('accept button for the challenged adm')
        await m.screenshot(path=f'{OUT}/beta_challenge.png')
        await m.click('#thub-body >> text=Aceitar'); await m.wait_for_timeout(700)
        if ms[0]['status'] != 'accepted': bad.append('accept')
        # Bia reports 3x1, Gabriel confirms
        await m.evaluate(f"openResultForm('{ms[0]['id']}')"); await m.wait_for_timeout(300)
        await m.fill('#ff-h', '1'); await m.fill('#ff-a', '3'); await m.screenshot(path=f'{OUT}/result_form.png'); await m.click('#form-ok'); await m.wait_for_timeout(700)
        if ms[0]['result_status'] != 'reported': bad.append('report')
        await a.evaluate(f"openTurmaHub('{alfa}')"); await a.wait_for_timeout(500); await a.click('#thub-head button:has-text("Desafios")'); await a.wait_for_timeout(600)
        if 'Confirmar placar' not in await a.inner_text('#thub-body'): bad.append('confirm button')
        await a.screenshot(path=f'{OUT}/confirm_card.png')
        await a.click('text=Confirmar placar'); await a.wait_for_timeout(700)
        if not (ms[0]['status'] == 'played' and ms[0]['home_goals'] == 1): bad.append('confirm')
        await a.evaluate("closeHub()")
        # --- open challenge on the board, taken by Beta
        await a.evaluate(f"openMatchForm('{alfa}', null)"); await a.wait_for_timeout(300); await a.fill('#ff-note', 'Quem topa?'); await a.click('#form-ok'); await a.wait_for_timeout(700)
        open_m = [x for x in fake.tmatches.values() if x['kind'] == 'amistoso_aberto']
        if not open_m: bad.append('open challenge')
        await m.evaluate("closeHub(); openExplore('mural')"); await m.wait_for_timeout(800)
        if 'Aceitar desafio' not in await m.inner_text('#explore-list'): bad.append('mural button')
        await m.screenshot(path=f'{OUT}/mural.png')
        await m.evaluate(f"setTimeout(() => takeOpenMatch('{open_m[0]['id']}'), 0)"); await m.wait_for_timeout(400)
        await m.click('#modal-confirm-ok'); await m.wait_for_timeout(700)
        if open_m[0]['status'] != 'accepted' or open_m[0]['away'] != beta: bad.append('take open')
        # --- championship: Bia organizes, Gabriel enrolls Alfa and Gama, then starts
        await m.evaluate("closeExplore(); openExplore('camps')"); await m.wait_for_timeout(500)
        await m.evaluate("openChampForm()"); await m.wait_for_timeout(300)
        await m.fill('#ff-name', 'Copa da Quinta'); await m.select_option('#ff-size', '4'); await m.screenshot(path=f'{OUT}/champ_form.png'); await m.click('#form-ok'); await m.wait_for_timeout(800)
        if not fake.champs: bad.append('champ not created')
        cid = list(fake.champs)[0]
        await a.evaluate(f"openExplore('camps')"); await a.wait_for_timeout(700)
        if 'Copa da Quinta' not in await a.inner_text('#explore-list'): bad.append('champ listed')
        await a.evaluate(f"openChamp('{cid}')"); await a.wait_for_timeout(600)
        await a.screenshot(path=f'{OUT}/champ_join.png')
        await a.click(f'#champ-body >> text=Inscrever Alfa FC'); await a.wait_for_timeout(600)
        await c.evaluate(f"openExplore('camps'); openChamp('{cid}')"); await c.wait_for_timeout(700)
        await c.click(f'#champ-body >> text=Inscrever Gama FC'); await c.wait_for_timeout(600)
        if len(fake.champs[cid]['teams']) != 3: bad.append('enroll teams')
        await m.evaluate(f"openChamp('{cid}')"); await m.wait_for_timeout(600)
        await m.click('#champ-body >> text=Começar'); await m.wait_for_timeout(300)
        await m.click('#modal-confirm-ok'); await m.wait_for_timeout(900)
        cm = [x for x in fake.tmatches.values() if x['championship'] == cid]
        if len(cm) != 3: bad.append('fixtures ' + str(len(cm)))
        await m.screenshot(path=f'{OUT}/champ_running.png')
        page_of = {alfa: a, beta: m, gama: c}
        for x in cm:
            await page_of[x['home']].evaluate(f"api.reportResult('{x['id']}', 2, 0)")
            await page_of[x['away']].evaluate(f"api.confirmResult('{x['id']}', true)")
        await m.evaluate(f"openChamp('{cid}')"); await m.wait_for_timeout(700)
        await m.screenshot(path=f'{OUT}/champ_table.png')
        st = fake.champs[cid]['status']
        if st != 'encerrado': bad.append('championship status ' + st + ' ' + json.dumps([(x['status'], x['result_status']) for x in cm]))
        print(json.dumps({'problems': bad, 'errsA': a.errs, 'errsM': m.errs, 'errsC': c.errs}, ensure_ascii=False))
        await b.close()
asyncio.run(main())
