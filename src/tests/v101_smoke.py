# v10.1 smoke: new shop tabs, nickname, athlete card, pipoca, goal announcement + push calls.
import sys, asyncio, json, os, datetime
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read(); fake = Fake()
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/v101'
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
    if await pg.evaluate("!document.getElementById('modal-popup').classList.contains('hidden')"): await pg.click('#popup-ok')
async def main():
    fake._v8init()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844})
        await ctx.expose_function('fakeCall', lambda n, t, a: fake.handle(n, t, a)); await ctx.add_init_script(FAKE_JS)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        ev = lambda js, *a: pg.evaluate(js, *a)
        async def check(c, l):
            if not await ev(c): bad.append(l)
        await signup(pg, 'Bernardo "Bezão" Fagundes', 'bez@t.dev')
        uid = fake.users['bez@t.dev']['id']; fake.f_myWallet(uid); fake.wallets[uid]['balance'] = 50000
        await ev("openShop()"); await pg.wait_for_timeout(800)
        for tab, item in [('title', 'title_matador'), ('mascot', 'mascot_siuu'), ('card', 'cardbg_holo'), ('goal', 'goalcard_fogo'), ('goal', 'goalsound_tambor'), ('title', 'nick_codinome')]:
            await ev(f"shopTab('{tab}')"); await pg.wait_for_timeout(150)
            await ev(f"api.buyItem('{item}').then(refreshWallet).then(() => equipShopItem('{item}', true, true))"); await pg.wait_for_timeout(500)
            await pg.screenshot(path=f'{OUT}/shop_{tab}.png')
        await pg.fill('#nick-input', 'porra'); await pg.wait_for_timeout(100)
        await check("document.getElementById('nick-error').innerText.includes('não rola')", 'nick filter client')
        await pg.fill('#nick-input', 'Bezão'); await ev("saveNick()"); await pg.wait_for_timeout(500)
        c = fake.profiles[uid]['cosmetics']
        if not (c.get('nick') == 'Bezão' and c.get('title') == 'matador' and c.get('mascot') == 'siuu' and c.get('cardBg') == 'holo' and c.get('goalCard') == 'fogo' and c.get('goalSound') == 'tambor'): bad.append('cosmetics saved ' + json.dumps(c))
        await pg.screenshot(path=f'{OUT}/shop_nick.png')
        await ev("previewGoalCard('neon')"); await pg.wait_for_timeout(500); await pg.screenshot(path=f'{OUT}/goal_neon.png')
        await ev("document.getElementById('goal-card').classList.add('hidden')")
        await ev("closeShop(); openProfile()"); await pg.wait_for_timeout(700); await pg.screenshot(path=f'{OUT}/profile_card.png', full_page=False)
        await ev("openAthleteCard(currentUser.id)"); await pg.wait_for_timeout(400); await pg.screenshot(path=f'{OUT}/card_me.png')
        await ev("closeAthleteCard(); closeProfile()")
        # a friend in the same turma: pipoca
        other = 'friend-1'; fake.profiles[other] = {'name': 'Caio Ribeiro', 'avatar': None, 'prefs': {}, 'cosmetics': {'frame': 'ouro', 'title': 'paredao', 'cardBg': 'noite', 'mascot': 'champion'}}
        tid = await ev("""async () => { const id = crypto.randomUUID(); await api.upsertTurma(id, 'Turma X', null); state.turmas.push({ id, name: 'Turma X', cloud: true, role: 'owner', invite: null, players: ['Caio Ribeiro', 'Bernardo "Bezão" Fagundes'], keepers: [], women: [], meta: { 'caio ribeiro': { userId: 'friend-1' }, 'bernardo "bezão" fagundes': { userId: currentUser.id } } }); return id; }""")
        fake.members[(tid, other)] = 'member'
        await ev("openAthleteCard('friend-1')"); await pg.wait_for_timeout(600)
        await pg.screenshot(path=f'{OUT}/card_friend.png')
        await pg.click('#acard-actions button:has-text("pipoca")'); await pg.wait_for_timeout(200); await pg.click('#modal-confirm-ok'); await pg.wait_for_timeout(800)
        if 'pipoca' not in (fake.profiles[other].get('cosmetics') or {}): bad.append('pipoca thrown')
        await check("document.getElementById('acard-box').innerHTML.includes('acard-pipoca')", 'pipoca on card')
        await pg.screenshot(path=f'{OUT}/card_pipoca.png')
        await ev("closeAthleteCard()")
        # goal by a linked player with a goal card, while streaming
        await ev(f"""() => {{ state.selectedTeams = ['{tid}']; syncPool(); state.players.forEach(p => checkIn(p.id));
            state.players.push(...Array.from({{ length: 6 }}, (_, i) => Object.assign(newPlayer('Extra ' + i, null), {{ id: 100 + i, present: true, arrival: 100 + i }})));
            state.queue = state.players.map(p => p.id); state.match.lineSize = 4; state.settings.keeperMode = 'sem'; buildTeams(); }}""")
        lid = 'live-smoke'
        fake.lives[lid] = {'id': lid, 'owner': uid, 'code': 'SMOKE123', 'active': True, 'palpites': True, 'turma_ids': [tid], 'title': 'x', 'updated_at': datetime.datetime.now().isoformat(), 'state': {}, 'markets': {}}
        await ev("state.live = { id: 'live-smoke', code: 'SMOKE123' }; switchTab('placar'); startMatchTimer()"); await pg.wait_for_timeout(500)
        me_id = await ev("state.players.find(p => p.name.startsWith('Bernardo')).id")
        side = await ev(f"state.court.A.ids.includes({me_id}) ? 'A' : state.court.B.ids.includes({me_id}) ? 'B' : null")
        if side:
            await ev(f"openGoalModal('{side}'); selectedGoalScorer = {me_id}; confirmGoalRecord(null)"); await pg.wait_for_timeout(500)
            await check("!document.getElementById('goal-card').classList.contains('hidden') && document.getElementById('goal-card').className.includes('gc-fogo')", 'goal card on organizer phone')
            await pg.screenshot(path=f'{OUT}/goal_fogo.png')
            snap = await ev("liveSnapshot().events[0]")
            if not (snap.get('fx') and snap['fx']['goalCard'] == 'fogo' and snap['fx']['nick'] == 'Bezão'): bad.append('snapshot fx')
        else: bad.append('player on court')
        await ev("document.getElementById('goal-card').classList.add('hidden'); openSaveModal('A'); recordGoalkeeperSave(state.court.A.ids[0])"); await pg.wait_for_timeout(300)
        await ev("finishMatchAndNextChallenger(true)"); await pg.wait_for_timeout(500)
        kinds = [x['kind'] for x in getattr(fake, 'pushes', [])]
        print('pushes', json.dumps(getattr(fake, 'pushes', []), ensure_ascii=False))
        if kinds[:1] != ['start'] or 'goal' not in kinds or 'save' not in kinds or kinds[-1] != 'end': bad.append('pushes ' + ','.join(kinds))
        # chat title chip + people list
        await ev(f"openTurmaChat('{tid}')"); await pg.wait_for_timeout(500)
        fake.f_chatSend(other, 'turma:' + tid, 'boa noite')
        await ev("turmaChat.reload()"); await pg.wait_for_timeout(800)
        await check("document.querySelector('#page-chat .chat-meta .cos-title') && document.querySelector('#page-chat .pip-badge')", 'chat shows title + pipoca')
        await pg.screenshot(path=f'{OUT}/chat.png')
        await ev("closeTurmaChat()")
        print(json.dumps({'problems': bad, 'errors': errs}, ensure_ascii=False))
        await b.close()
asyncio.run(main())
