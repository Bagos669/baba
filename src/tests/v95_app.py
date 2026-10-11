# v9.5: queue removal, least-played order, time ruler, goalkeepers from the line, editable ficha,
# jogadoras (titles + turma sync), notice pop-up and release notes.
import sys, asyncio, json, os, time
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read(); fake = Fake()
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/v95shots'
os.makedirs(SHOTS, exist_ok=True)
URL = 'http://localhost:8765/'
out, bad = {}, []

SETUP = """(n) => {
  const mk = (id, name, gk) => Object.assign(newPlayer(name, null), { id, isGoalkeeper: gk, present: true, arrival: id, arrivedAt: Date.now() });
  state.players = Array.from({ length: n }, (_, i) => mk(i + 1, 'P' + (i + 1), false));
  state.court = { A: null, B: null }; state.queue = state.players.map(p => p.id); state.arrivalSeq = n; state.teamSeq = 0;
  state.matchHistory = []; state.firstKickoffAt = null;
  state.settings = Object.assign(state.settings, { queueOrder: 'chegada', lateAfter: 0, keeperMode: 'fixo' });
}"""

async def main():
    fake._v8init()
    fake.notice = {'message': 'Domingo tem manutenção às 23h.', 'level': 'info'}
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844})
        await ctx.expose_function('fakeCall', lambda n, t, a: fake.handle(n, t, a)); await ctx.add_init_script(FAKE_JS)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        ev = lambda js, *a: pg.evaluate(js, *a)
        async def check(cond, label):
            if not await ev(cond): bad.append(label)

        # ---- sign up; the notice pops up after the tour (no release notes for a new account)
        await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(300)
        await ev("authGo('signup')")
        await pg.fill('#signup-name', 'Gabi'); await pg.fill('#signup-email', 'gabi@t.dev'); await pg.fill('#signup-pass', 'segredo1')
        await ev("doSignup()"); await pg.wait_for_timeout(300); await pg.check('#recovery-ack'); await ev("recoveryDone()"); await pg.wait_for_timeout(1000)
        if await ev("!document.getElementById('page-terms-gate').classList.contains('hidden')"):
            await pg.fill('#terms-birth', '1998-03-03'); await pg.check('#terms-ack'); await ev("submitTerms()"); await pg.wait_for_timeout(700)
        await check("document.getElementById('modal-popup').classList.contains('hidden')", 'no pop-up over the tour')
        await pg.click('#tour-next'); await pg.click('text=Pular'); await pg.wait_for_timeout(600)
        await check("!document.getElementById('modal-popup').classList.contains('hidden') && document.getElementById('popup-body').innerText.includes('manutenção')", 'notice pop-up after tour')
        await pg.screenshot(path=f'{SHOTS}/v95_popup_notice.png')
        await pg.click('#popup-ok'); await pg.wait_for_timeout(400)
        await check("document.getElementById('modal-popup').classList.contains('hidden')", 'new account: no release notes')
        await check("!document.getElementById('home-v7').innerText.includes('manutenção')", 'notice not repeated on home after reading')
        # returning user on an older version gets the notes once
        await ev("localStorage.setItem('baba_notes_seen_v1', '9')")
        await pg.reload(wait_until='load'); await pg.wait_for_timeout(1500)
        await check("!document.getElementById('modal-popup').classList.contains('hidden') && document.getElementById('popup-eyebrow').innerText.includes('10') && document.getElementById('popup-body').innerText.includes('Goleiro da fila')", 'release notes pop-up')
        await check("!document.getElementById('popup-body').innerText.includes('Missões da semana na lojinha')", 'only notes since last version')
        await pg.screenshot(path=f'{SHOTS}/v95_popup_notes.png')
        await pg.click('#popup-ok'); await pg.wait_for_timeout(300)
        await pg.reload(wait_until='load'); await pg.wait_for_timeout(1500)
        await check("document.getElementById('modal-popup').classList.contains('hidden')", 'notes shown only once')

        # ---- remove from the waiting line
        await ev(SETUP, 13)
        await ev("updateKeeperMode('time'); updateGameFormat(4); buildTeams(); switchTab('fila')"); await pg.wait_for_timeout(300)
        await check("state.queue.length === 3", 'queue of 3')
        await pg.click('#queue-list button[aria-label="Tirar P11 da fila"]'); await pg.wait_for_timeout(200)
        await pg.click('#modal-confirm-ok'); await pg.wait_for_timeout(300)
        await check("!state.queue.includes(11) && !byId(11).present && state.queue.length === 2", 'removed from queue')
        await pg.screenshot(path=f'{SHOTS}/v95_queue.png')

        # ---- least played first
        await ev(SETUP, 13)
        await ev("byId(1).matches = 3; byId(2).matches = 1; byId(3).matches = 0; updateSetting('queueOrder', 'menos-jogos')")
        await check("state.queue.indexOf(3) < state.queue.indexOf(2) && state.queue.indexOf(2) < state.queue.indexOf(1) && state.queue.at(-1) === 1", 'least played go first')
        await check("state.queue.slice(0, 3).join() === '3,4,5'", 'ties keep arrival order')

        # ---- time ruler
        await ev(SETUP, 13)
        await ev("updateSetting('lateAfter', 60); state.firstKickoffAt = Date.now() - 20 * 60000; state.players.push(Object.assign(newPlayer('Cedo', null), { id: 50 })); checkIn(50)")
        await check("state.queue.at(-1) === 50", '20 min late: end of line')
        await ev("state.firstKickoffAt = Date.now() - 65 * 60000; state.players.push(Object.assign(newPlayer('Tarde', null), { id: 51 })); checkIn(51); commit()")
        await check("state.queue[0] === 51 && byId(51).jumped", '65 min late: front of line')
        await ev("updateSetting('lateAfter', 0); state.players.push(Object.assign(newPlayer('Sem regua', null), { id: 52 })); checkIn(52)")
        await check("state.queue.at(-1) === 52", 'ruler off: end of line')

        # ---- goalkeepers from the line (planilha), 15 players, 4 on the line
        await ev(SETUP, 15)
        await ev("updateKeeperMode('fila'); updateGameFormat(4); buildTeams(); switchTab('placar')"); await pg.wait_for_timeout(300)
        r = await ev("({ A: state.court.A.ids.join(), B: state.court.B.ids.join(), q: state.queue.join(), gk: queueKeepers().join(), line: document.getElementById('fixed-keepers').innerText })")
        out['planilha_start'] = r
        if not (r['A'] == '1,2,3,4' and r['B'] == '5,6,7,8' and r['gk'] == '9,10' and 'P9' in r['line'] and 'P10' in r['line']): bad.append('keepers are the next two in line')
        await pg.screenshot(path=f'{SHOTS}/v95_gk_fila.png')
        await ev("state.match.scoreA = 0; state.match.scoreB = 1; finishMatchAndNextChallenger(true)"); await pg.wait_for_timeout(400)
        r = await ev("({ A: state.court.A.ids.join(), B: state.court.B.ids.join(), q: state.queue.join(), gk: queueKeepers().join(), m9: byId(9).matches, m1: byId(1).matches })")
        out['planilha_after'] = r
        # team 1 lost: its players go to the end one by one; winners stay; next 4 come in
        if not (r['A'] == '5,6,7,8' and r['B'] == '9,10,11,12' and r['q'] == '13,14,15,1,2,3,4' and r['gk'] == '13,14' and r['m9'] == 1 and r['m1'] == 1): bad.append('planilha rotation')
        await ev("updateKeeperMode('fixo')")

        # ---- edit the ficha from the team list; jogadora titles
        await ev(SETUP, 10)
        await ev("updateKeeperMode('time'); updateGameFormat(4); buildTeams(); switchTab('fila')"); await pg.wait_for_timeout(300)
        await pg.click('#court-manager button[aria-label="Ficha de P2"]'); await pg.wait_for_timeout(300)
        await check("!document.getElementById('modal-player').classList.contains('hidden')", 'ficha opens from team')
        await pg.check('input[name="player-edit-sex"][value="f"]', force=True)
        await pg.click('#player-edit-stats button[aria-label="Mais Gols"]'); await pg.click('#player-edit-stats button[aria-label="Mais Gols"]')
        await pg.click('#player-edit-stats button[aria-label="Mais Defesas"]')
        await pg.fill('#player-edit-name', 'Bia'); await pg.wait_for_timeout(100)
        await pg.screenshot(path=f'{SHOTS}/v95_ficha.png')
        await pg.click('#modal-player button:has-text("Salvar")'); await pg.wait_for_timeout(300)
        await check("byId(2).name === 'Bia' && byId(2).female && byId(2).goals === 2 && byId(2).saves === 1 && state.court.A.ids.includes(2)", 'ficha saved, still on the team')
        await ev("switchTab('inicio')"); await pg.wait_for_timeout(300)
        await check("document.getElementById('tab-content-inicio').innerText.includes('Artilheira') && document.getElementById('tab-content-inicio').innerText.includes('Paredona')", 'female titles')
        await ev("byId(3).goals = 5"); await ev("commit()"); await pg.wait_for_timeout(200)
        await check("document.getElementById('tab-content-inicio').innerText.includes('Artilheiro')", 'male title when he leads')
        # someone on the court goes home from the ficha
        await ev("openPlayerSheet(3)"); await pg.wait_for_timeout(200)
        await pg.click('#player-edit-leave'); await pg.wait_for_timeout(200); await pg.click('#modal-confirm-ok'); await pg.wait_for_timeout(300)
        await check("!byId(3).present && !state.court.A.ids.includes(3)", 'left from the ficha')

        # ---- jogadora reaches the server through the turma
        tid = await ev("""async () => {
          const id = crypto.randomUUID();
          await api.upsertTurma(id, 'Mista FC', null);
          state.turmas.push({ id, name: 'Mista FC', cloud: true, role: 'owner', invite: null, players: ['Ana', 'Beto'], keepers: [], women: [], meta: {} });
          await syncTurmaNow(id);
          const p = Object.assign(newPlayer('Ana', id), { id: 90 }); state.players.push(p);
          setFemaleFlag(p, true); await syncTurmaNow(id);
          return id; }""")
        rows = [r for r in fake.players.values() if r['turma_id'] == tid]
        out['server_female'] = {r['name']: r.get('is_female') for r in rows}
        if out['server_female'] != {'Ana': True, 'Beto': False}: bad.append('female synced to server')
        out['errors'] = errs
        await b.close()
    print(json.dumps({'problems': bad, **out}, ensure_ascii=False))
asyncio.run(main())
