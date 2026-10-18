# v11 smoke: pull the list, answer (home, pop-up, chat card), paste a list, arrival tags, close (cumpriu x miou), rules, ban.
import sys, asyncio, json, os, datetime
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read(); fake = Fake()
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/v11'
os.makedirs(OUT, exist_ok=True)
URL = 'http://localhost:8765/'
bad = []
NAMES = ['Gabriel Marini', 'Bernardo "Bezão" Fagundes', 'Caio Augusto Ribeiro', 'Duda Lima', 'Thiago Henrique', 'Kauã', 'Léo', 'Igor', 'Rafa Gol', 'Pedrinho']
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
    fake._v8init()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        async def ctxpg():
            ctx = await b.new_context(viewport={'width': 390, 'height': 844})
            await ctx.expose_function('fakeCall', lambda n, t, a: fake.handle(n, t, a)); await ctx.add_init_script(FAKE_JS)
            pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.errs = errs; return pg
        a = await ctxpg(); await signup(a, 'Gabriel Marini', 'adm@t.dev')
        tid = await a.evaluate("""async (names) => { const id = crypto.randomUUID(); await api.upsertTurma(id, 'FutHeavenly', 'FUTH1234');
          state.turmas.push({ id, name: 'FutHeavenly', cloud: true, role: 'owner', invite: 'FUTH1234', players: names, keepers: [], women: [], meta: {} });
          await syncTurmaNow(id); return id; }""", NAMES)
        adm = fake.users['adm@t.dev']['id']
        m = await ctxpg(); await signup(m, 'Bezão', 'bez@t.dev')
        mem = fake.users['bez@t.dev']['id']
        fake.members[(tid, mem)] = 'member'
        for pl in fake.players.values():
            if pl['turma_id'] == tid and pl['name'].startswith('Bernardo'): pl['user_id'] = mem
            if pl['turma_id'] == tid and pl['name'] == 'Gabriel Marini': pl['user_id'] = adm
        await a.evaluate("pullCloud(true)"); await a.wait_for_timeout(1200)
        # adm pulls the list for tonight
        await a.evaluate(f"openTurmaEditor('{tid}')"); await a.wait_for_timeout(400)
        await a.screenshot(path=f'{OUT}/turma_events_empty.png')
        await a.evaluate(f"closeTurmaEditor(); openEventEdit('{tid}')"); await a.wait_for_timeout(300)
        today = datetime.datetime.now()
        # Later today (the close-presence step needs today's list), capped at 23:59 so it never rolls into tomorrow.
        when = min(today + datetime.timedelta(hours=2), today.replace(hour=23, minute=59, second=0, microsecond=0))
        await a.fill('#eve-date', when.strftime('%Y-%m-%d')); await a.fill('#eve-time', when.strftime('%H%M'))
        if await a.evaluate("document.getElementById('eve-time').type") != 'text' or ':' not in await a.evaluate("document.getElementById('eve-time').value"): bad.append('time mask')
        await a.fill('#eve-place', 'Quadra do Zé, Asa Norte'); await a.fill('#eve-max', '8'); await a.fill('#eve-note', 'Leva colete')
        await a.screenshot(path=f'{OUT}/event_edit.png')
        await a.click('#eve-save'); await a.wait_for_timeout(1200)
        ev = list(fake.events.values())[0]
        if not (ev['place'] == 'Quadra do Zé, Asa Norte' and ev['max_players'] == 8): bad.append('event saved')
        pushes = [x for x in getattr(fake, 'pushes', []) if x.get('event')]
        if not (pushes and 'puxou a lista' in pushes[0]['title']): bad.append('push on pull: ' + json.dumps(pushes, ensure_ascii=False))
        if not any(c['body'] == ':ev:' + ev['id'] + ':' for c in fake.chat): bad.append('chat card message')
        await a.screenshot(path=f'{OUT}/event_sheet_adm.png')
        # paste a list
        await a.evaluate(f"openPasteList('{ev['id']}')"); await a.wait_for_timeout(300)
        await a.fill('#paste-text', "⚽ BABA HOJE 19h ⚽\n1- Caio\n2- Duda - pago\n3- Thiago H.\n4- Kauã ✅\n5- Zé de Fora\n6- Rafa\n7- Léo\n8- Igor\n9- Pedrinho\nNão vão:\n- Gabriel")
        await a.click('text=Ler a lista'); await a.wait_for_timeout(300)
        await a.screenshot(path=f'{OUT}/paste_preview.png')
        n_unsure = await a.evaluate("pasteState.rows.filter(r => r.pick === '__guest').length")
        await a.evaluate("pasteState.rows[0].pick = 'caio augusto ribeiro'; renderPastePreview()")
        await a.click('#paste-confirm'); await a.wait_for_timeout(500)
        if (fake.rsvps and any(k == 'zé de fora' for (e, k) in fake.rsvps)): bad.append('imported guest without inviter')
        await a.evaluate("pasteState.rows.forEach(r => { if (r.name === 'Pedrinho') r.pick = '__add'; else if (r.pick === '__guest') r.inviter = 'Gabriel Marini'; }); renderPastePreview()")
        await a.screenshot(path=f'{OUT}/paste_guest_add.png')
        await a.click('#paste-confirm'); await a.wait_for_timeout(1000)
        if not any(p['name'] == 'Pedrinho' for p in fake.players.values()): bad.append('add to turma')
        if (list(fake.events.values())[0]['id'], 'zé de fora') in fake.rsvps and fake.rsvps[(list(fake.events.values())[0]['id'], 'zé de fora')].get('invited_by') != 'Gabriel Marini': bad.append('invited_by')
        # "Pôr um nome" sheet
        await a.evaluate(f"openEventSheet('{ev['id']}')"); await a.wait_for_timeout(300)
        await a.evaluate(f"addEventName('{ev['id']}')"); await a.wait_for_timeout(300)
        await a.fill('#evname-name', 'Tio do Rafa')
        await a.click('text=Pôr na lista'); await a.wait_for_timeout(300)
        if (ev['id'], 'tio do rafa') in fake.rsvps: bad.append('name saved without inviter')
        await a.select_option('#evname-inviter', 'Gabriel Marini'); await a.screenshot(path=f'{OUT}/evname.png')
        await a.click('text=Pôr na lista'); await a.wait_for_timeout(800)
        if fake.rsvps.get((ev['id'], 'tio do rafa'), {}).get('invited_by') != 'Gabriel Marini': bad.append('evname invited_by')
        await a.evaluate("closeEventSheet()")
        r = {k: v['status'] for (e, k), v in fake.rsvps.items()}
        if not (r.get('caio augusto ribeiro') == 'vou' and r.get('thiago henrique') == 'vou' and r.get('zé de fora') == 'vou' and r.get('gabriel marini') == 'nao'): bad.append('paste imported ' + json.dumps(r, ensure_ascii=False))
        await a.screenshot(path=f'{OUT}/event_after_paste.png')
        # member: pop-up for the list, answers Vou
        await m.evaluate("pullCloud(true)"); await m.wait_for_timeout(1500)
        await m.evaluate("maybePopups()"); await m.wait_for_timeout(400)
        popup = await m.evaluate("!document.getElementById('modal-popup').classList.contains('hidden') && document.getElementById('popup-body').innerText")
        await m.screenshot(path=f'{OUT}/member_popup.png')
        if not popup or 'Quadra do Zé' not in popup: bad.append('member pop-up')
        else:
            await m.click('#popup-body button:has-text("Vou")'); await m.wait_for_timeout(900)
        if fake.rsvps.get((ev['id'], 'bernardo "bezão" fagundes'), {}).get('status') != 'vou': bad.append('member answered vou')
        await m.evaluate("closePopup && document.getElementById('modal-popup').classList.add('hidden')")
        await m.evaluate("switchTab('inicio')"); await m.wait_for_timeout(300)
        await m.screenshot(path=f'{OUT}/member_home.png')
        if 'Próximos babas' not in await m.evaluate("document.getElementById('home-events').innerText"): bad.append('home card')
        # waiting list: 9 'vou' with max 8
        await m.evaluate(f"openEventSheet('{ev['id']}')"); await m.wait_for_timeout(600)
        txt = await m.evaluate("document.getElementById('ev-body').innerText")
        if 'lista de espera' not in txt.lower(): bad.append('waiting list shown: ' + txt[:400])
        await m.screenshot(path=f'{OUT}/member_event.png')
        # chat card
        await m.evaluate(f"closeEventSheet(); openTurmaChat('{tid}')"); await m.wait_for_timeout(1500)
        if not await m.evaluate("!!document.querySelector('#page-chat .ev-chat')"): bad.append('chat card rendered')
        await m.screenshot(path=f'{OUT}/member_chat.png')
        await m.evaluate("closeTurmaChat()")
        # adm: arrival list tags, then new baba -> close presence prefilled
        await a.evaluate(f"""() => {{ closeEventSheet(); state.selectedTeams = ['{tid}']; syncPool(); loadEvents(true); }}"""); await a.wait_for_timeout(800)
        await a.evaluate("['Caio Augusto Ribeiro', 'Duda Lima', 'Kauã', 'Rafa Gol', 'Léo'].forEach(n => checkIn(state.players.find(p => p.name === n).id)); buildTeams(); state.match.scoreA = 1; finishMatchAndNextChallenger(true)"); await a.wait_for_timeout(600)
        await a.evaluate("switchTab('ficha')"); await a.wait_for_timeout(300)
        tags = await a.evaluate("document.getElementById('sheet-players-tbody').innerText")
        if 'Marcou que vem' not in tags: bad.append('arrival tags')
        await a.screenshot(path=f'{OUT}/arrival_tags.png')
        await a.evaluate("setTimeout(startNewDay, 0)"); await a.wait_for_timeout(400); await a.click('#modal-confirm-ok'); await a.wait_for_timeout(1200)
        if not await a.evaluate("!document.getElementById('modal-popup').classList.contains('hidden') && document.getElementById('popup-title').innerText.includes('Fechar a presença')"): bad.append('close prompt after new baba')
        await a.click('#popup-ok'); await a.wait_for_timeout(600)
        out = await a.evaluate("closeState && closeState.out")
        if not out or out.get('caio augusto ribeiro') != 'cumpriu' or out.get('thiago henrique') != 'miou' or out.get('bernardo "bezão" fagundes') != 'miou': bad.append('close prefilled ' + json.dumps(out, ensure_ascii=False))
        await a.screenshot(path=f'{OUT}/close_event.png')
        await a.click('#close-ev-save'); await a.wait_for_timeout(1200)
        await a.screenshot(path=f'{OUT}/close_result.png')
        while await a.evaluate("!document.getElementById('modal-popup').classList.contains('hidden')"):
            await a.click('#popup-ok'); await a.wait_for_timeout(300)
        if fake.events[ev['id']]['status'] != 'done': bad.append('event done')
        # rules: 1 miss -> aviso; set bloqueio at 1 and check member blocked on a new list
        await a.evaluate(f"closeEventSheet(); openRules('{tid}')"); await a.wait_for_timeout(800)
        await a.screenshot(path=f'{OUT}/rules.png')
        if 'taxa de miou' not in await a.evaluate("document.getElementById('rules-body').innerText"): bad.append('rules counts')
        await a.fill('#rule-aviso', '1'); await a.fill('#rule-prioridade', '1'); await a.fill('#rule-bloqueio', '1'); await a.fill('#rule-banimento', '1')
        await a.click('#rules-save'); await a.wait_for_timeout(1000)
        await a.evaluate(f"closeRules(); api.createEvent('{tid}', new Date(Date.now() + 2 * 864e5).toISOString(), 'Quadra', '', null).then(() => loadEvents(true))"); await a.wait_for_timeout(800)
        await m.evaluate("loadEvents(true)"); await m.wait_for_timeout(800)
        ev2 = [e for e in fake.events.values() if e['status'] == 'open'][0]
        await m.evaluate(f"answerEvent('{ev2['id']}', 'vou')"); await m.wait_for_timeout(700)
        if (ev2['id'], 'bernardo "bezão" fagundes') in fake.rsvps: bad.append('blocked member could confirm')
        toast = await m.evaluate("document.getElementById('toast-container').innerText")
        if 'bloqueado' not in toast: bad.append('blocked toast')
        await m.screenshot(path=f'{OUT}/member_blocked.png')
        # ban suggestion -> adm bans
        await a.evaluate(f"openRules('{tid}')"); await a.wait_for_timeout(800)
        await a.evaluate(f"""() => {{ window.prompt = () => 'faltas'; }}""")
        await a.click('#rules-body button:has-text("Banir da turma") >> nth=0'); await a.wait_for_timeout(300); await a.click('#modal-confirm-ok'); await a.wait_for_timeout(900)
        if (tid, mem) in fake.members: bad.append('ban removed member')
        print(json.dumps({'problems': bad, 'unsure_after_paste': n_unsure, 'errsA': a.errs, 'errsM': m.errs}, ensure_ascii=False))
        await b.close()
asyncio.run(main())
