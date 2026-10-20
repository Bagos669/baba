# v11.6 smoke: baba compartilhado entre dono e adms (card "Baba em andamento", selo, abrir o placar, sincronização,
# última gravação vale com "Atualizado por", finalização simultânea única) e o card do baba pendente (6h, Agora não, Fechar baba).
import sys, asyncio, json, os, datetime
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read(); fake = Fake()
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/v116'
os.makedirs(OUT, exist_ok=True)
URL = 'http://localhost:8765/'
bad = []
NAMES = ['Zeca', 'Lulu', 'Tito', 'Biel', 'Nando', 'Rafa']
async def signup(pg, name, email, birth='1990-02-02'):
    await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(300)
    await pg.evaluate("authGo('signup')")
    await pg.fill('#signup-name', name); await pg.fill('#signup-email', email); await pg.fill('#signup-pass', 'segredo1')
    await pg.evaluate("doSignup()"); await pg.wait_for_timeout(300); await pg.check('#recovery-ack'); await pg.evaluate("recoveryDone()"); await pg.wait_for_timeout(1000)
    if await pg.evaluate("!document.getElementById('page-terms-gate').classList.contains('hidden')"):
        await pg.fill('#terms-birth', birth); await pg.check('#terms-ack'); await pg.evaluate("submitTerms()"); await pg.wait_for_timeout(700)
    await pg.click('#tour-next'); await pg.click('text=Pular'); await pg.wait_for_timeout(400)
    while await pg.evaluate("!document.getElementById('modal-popup').classList.contains('hidden')"):
        await pg.click('#popup-ok'); await pg.wait_for_timeout(300)
    await pg.evaluate("window.__toasts = []; const _st = showToast; showToast = (m, ...r) => { window.__toasts.push(String(m)); return _st(m, ...r); }")
async def vis(pg, sel): return await pg.evaluate(f"(()=>{{const e=document.querySelector('{sel}');return !!e&&!e.classList.contains('hidden')&&getComputedStyle(e).display!=='none'}})()")
async def text(pg, sel): return await pg.evaluate(f"(document.querySelector('{sel}')||{{}}).innerText||''")
async def toasts(pg): return ' | '.join(await pg.evaluate("window.__toasts || []"))
async def main():
    fake._v8init(); fake._evinit(); fake._pinit(); fake._tminit()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        async def ctxpg():
            ctx = await b.new_context(viewport={'width': 390, 'height': 844})
            await ctx.expose_function('fakeCall', lambda n, t, a: fake.handle(n, t, a)); await ctx.add_init_script(FAKE_JS)
            pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.errs = errs; return pg
        d = await ctxpg(); await signup(d, 'Dono Silva', 'dono@t.dev')
        tid = await d.evaluate("""async (names) => { const id = crypto.randomUUID(); await api.upsertTurma(id, 'Quinta FC', 'QUIN1234');
          state.turmas.push({ id, name: 'Quinta FC', cloud: true, role: 'owner', invite: 'QUIN1234', players: names, keepers: [], women: [], meta: {} });
          await syncTurmaNow(id); return id; }""", NAMES)
        fake.turmas[tid]['owner_id'] = fake.users['dono@t.dev']['id']
        a = await ctxpg(); await signup(a, 'Ana Souza', 'ana@t.dev')
        bb = await ctxpg(); await signup(bb, 'Beto Lima', 'beto@t.dev')
        m = await ctxpg(); await signup(m, 'Mel Costa', 'mel@t.dev')
        uid = {k: fake.users[f'{k}@t.dev']['id'] for k in ('dono', 'ana', 'beto', 'mel')}
        fake.members[(tid, uid['ana'])] = 'admin'; fake.members[(tid, uid['beto'])] = 'admin'; fake.members[(tid, uid['mel'])] = 'member'
        for pg in (d, a, bb, m): await pg.evaluate("pullCloud(true)")
        await a.wait_for_timeout(900)
        # ---- Ana monta o baba (sem apito ainda): ninguém vê card
        await a.evaluate("""(tid) => { state.selectedTeams = [tid]; syncPool();
          state.players.forEach((p, i) => { p.present = true; p.arrival = i + 1; });
          const ids = state.players.map(p => p.id);
          state.court = { A: { label: '1', ids: ids.slice(0, 2), streak: 0 }, B: { label: '2', ids: ids.slice(2, 4), streak: 0 } };
          state.queue = ids.slice(4); state.teamSeq = 2; state.match.lineSize = 2; commit(); }""", tid)
        await a.wait_for_timeout(2500)
        bid = await a.evaluate("state.babaId")
        if not bid or bid not in fake.babas: bad.append('baba de Ana não chegou ao servidor')
        for pg in (bb, d): await pg.evaluate("loadSharedBabas(true)")
        await bb.wait_for_timeout(500)
        if await bb.locator('#home-shared [data-shared]').count(): bad.append('card antes do primeiro apito')
        # ---- primeiro apito
        await a.evaluate("switchTab('placar'); toggleMatchTimer()"); await a.wait_for_timeout(2500)
        if fake.babas[bid].get('started_by') != uid['ana']: bad.append('servidor não gravou quem iniciou')
        for pg in (bb, d, a, m): await pg.evaluate("loadSharedBabas(true); switchTab('inicio')")
        await bb.wait_for_timeout(600)
        for name, pg in (('Beto', bb), ('Dono', d)):
            t = await text(pg, '#home-shared')
            if 'Baba em andamento' not in t or 'Quinta FC, iniciado por Ana' not in t or 'Abrir' not in t: bad.append(f'card no celular de {name}: ' + t.replace('\n', ' | '))
        await bb.screenshot(path=f'{OUT}/inicio_card_andamento.png')
        if await a.locator('#home-shared [data-shared]').count(): bad.append('card aparece no celular de quem iniciou')
        if await m.locator('#home-shared [data-shared]').count() or await m.evaluate("sharedBabas.length"): bad.append('membro comum vê o card')
        await m.evaluate(f"openSharedBaba('{bid}')"); await m.wait_for_timeout(800)
        if await m.evaluate("state.babaId") == bid: bad.append('membro comum abriu o controle')
        # selo nas Turmas
        await bb.evaluate("openDatabaseModal()"); await bb.wait_for_timeout(400)
        if 'Em andamento' not in await text(bb, f'#db-checkboxes-container [data-selo="{tid}"]'): bad.append('selo Em andamento na turma')
        await bb.screenshot(path=f'{OUT}/turmas_selo.png')
        await bb.evaluate("closeDatabaseModal()")
        # ---- Beto abre pelo card: Turmas → Placar com o estado atual
        await bb.locator(f'#home-shared [data-shared="{bid}"] button:has-text("Abrir")').click(); await bb.wait_for_timeout(1200)
        if await bb.evaluate("state.babaId") != bid: bad.append('Beto não abriu o baba')
        if not await vis(bb, '#tab-content-placar'): bad.append('não abriu Turmas → Placar')
        if not await bb.evaluate("!!state.firstKickoffAt && state.match.isRunning && state.players.filter(p => p.present).length === 6"): bad.append('estado atual não veio')
        await bb.screenshot(path=f'{OUT}/beto_placar.png')
        # ---- Beto muda a fila: aparece no celular de Ana em poucos segundos, com "Atualizado por Beto"
        await bb.evaluate("state.queue.reverse(); commit()")
        want = await bb.evaluate("JSON.stringify(state.queue)")
        await a.wait_for_timeout(6000)
        if await a.evaluate("JSON.stringify(state.queue)") != want: bad.append('mudança da fila não chegou em Ana')
        if 'Atualizado por Beto' not in await toasts(a): bad.append('Ana sem aviso Atualizado por Beto: ' + await toasts(a))
        # ---- edição simultânea: vale a última gravação, ninguém vê erro, os dois terminam iguais
        await asyncio.gather(a.evaluate("state.settings.maxStreak = 2; commit()"), bb.evaluate("state.settings.maxStreak = 3; commit()"))
        await a.wait_for_timeout(8000)
        va, vb = await a.evaluate("state.settings.maxStreak"), await bb.evaluate("state.settings.maxStreak")
        if va != vb or va != fake.babas[bid]['state']['settings']['maxStreak']: bad.append(f'conflito não convergiu: Ana {va}, Beto {vb}, servidor {fake.babas[bid]["state"]["settings"]["maxStreak"]}')
        for pg in (a, bb):
            if 'não foi aceita' in await toasts(pg): bad.append('erro mostrado na edição simultânea')
        # ---- finalização simultânea: um relatório só
        # v11.6.1: gol só pelo anotador (Ana iniciou), registrado como lance
        gid = await a.evaluate("(() => { selectedGoalSide = 'A'; selectedGoalScorer = state.court.A.ids[0]; confirmGoalRecord(null); return selectedGoalScorer; })()")
        await a.wait_for_timeout(6000)
        if await bb.evaluate(f"byId({gid}).goals") != 1: bad.append('gol não sincronizou')
        fake.finished_reports = 0
        await a.evaluate("setTimeout(startNewDay, 0)"); await bb.evaluate("setTimeout(startNewDay, 0)"); await a.wait_for_timeout(400)
        await asyncio.gather(a.click('#modal-confirm-ok'), bb.click('#modal-confirm-ok'))
        await a.wait_for_timeout(6000)
        if not fake.babas[bid]['finished']: bad.append('baba não finalizou')
        if fake.finished_reports != 1: bad.append(f'finalizações gravadas: {fake.finished_reports}')
        if [r['goals'] for r in fake.stats.get(bid, [])] != [1]: bad.append('relatório (stats): ' + str(fake.stats.get(bid)))
        await d.evaluate("loadSharedBabas(true)"); await d.wait_for_timeout(500)
        if await d.locator('#home-shared [data-shared]').count(): bad.append('card não sumiu depois de finalizar')
        for pg in (a, bb):
            if await pg.evaluate("state.babaId") is not None and await pg.evaluate("state.babaId") == bid: bad.append('celular ficou com o baba finalizado')
        # ---- outro adm finaliza e o celular de quem iniciou mostra "Baba finalizado por"
        await a.evaluate("""() => { state.players.forEach((p, i) => { p.present = true; p.arrival = i + 1; });
          const ids = state.players.map(p => p.id);
          state.court = { A: { label: '1', ids: ids.slice(0, 2), streak: 0 }, B: { label: '2', ids: ids.slice(2, 4), streak: 0 } };
          state.queue = ids.slice(4); commit(); toggleMatchTimer(); }""")
        await a.wait_for_timeout(2500)
        bid2 = await a.evaluate("state.babaId")
        await bb.evaluate(f"openSharedBaba('{bid2}')"); await bb.wait_for_timeout(1200)
        await bb.evaluate("setTimeout(startNewDay, 0)"); await bb.wait_for_timeout(300); await bb.click('#modal-confirm-ok')
        await a.wait_for_timeout(6000)
        if 'Baba finalizado por Beto' not in await toasts(a): bad.append('Ana sem "Baba finalizado por Beto": ' + await toasts(a))
        if await a.evaluate("state.babaId") == bid2: bad.append('Ana ficou com o baba finalizado')
        # ---- baba pendente (de 2 dias atrás, com partida em andamento)
        old = (datetime.date.today() - datetime.timedelta(days=2))
        pid = 'pend-0001-0000-0000-000000000000'
        st = {'v': 4, 'startedAt': int(datetime.datetime.combine(old, datetime.time(19, 0)).timestamp() * 1000), 'firstKickoffAt': 1, 'selectedTeams': [tid],
              'players': [{'id': 1, 'name': 'Zeca', 'turmaId': tid, 'present': True, 'goals': 3, 'assists': 0, 'saves': 0, 'matches': 2, 'wins': 1},
                          {'id': 2, 'name': 'Lulu', 'turmaId': tid, 'present': True, 'goals': 1, 'assists': 1, 'saves': 0, 'matches': 2, 'wins': 1}],
              'court': {'A': {'label': '1', 'ids': [1], 'streak': 0}, 'B': {'label': '2', 'ids': [2], 'streak': 0}}, 'queue': [],
              'match': {'scoreA': 1, 'scoreB': 0, 'isRunning': False, 'events': []},
              'matchHistory': [{'scoreA': 2, 'scoreB': 1, 'labelA': '1', 'labelB': '2'}, {'scoreA': 0, 'scoreB': 0, 'labelA': '1', 'labelB': '2'}]}
        fake.babas[pid] = {'id': pid, 'created_by': uid['ana'], 'turma_ids': [tid], 'title': 'Quinta FC', 'played_on': old.isoformat(), 'state': st, 'finished': False,
                           'matches': 2, 'rev': 5, 'started_by': uid['ana'], 'updated': next(fake.seq)}
        for pg in (d, m): await pg.evaluate("loadSharedBabas(true)")
        await d.wait_for_timeout(500)
        early = await d.evaluate("(() => { const o = Date.prototype.getHours; Date.prototype.getHours = () => 5; renderSharedCards(); const n = document.querySelectorAll('#home-shared [data-pending]').length; Date.prototype.getHours = o; return n; })()")
        if early: bad.append('card de pendente antes das 6h')
        await d.evaluate("(() => { const o = Date.prototype.getHours; Date.prototype.getHours = () => 9; window.__oh = o; renderSharedCards(); })()")
        pt = await text(d, f'#home-shared [data-pending="{pid}"]')
        wd = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'][old.weekday()]
        if f'O baba de {wd} ({old.strftime("%d/%m")}) ainda está aberto. Fechar agora?' not in pt: bad.append('texto do pendente: ' + pt.replace('\n', ' | '))
        if 'Fechar baba' not in pt or 'Agora não' not in pt: bad.append('botões do pendente')
        await d.screenshot(path=f'{OUT}/inicio_pendente.png')
        if await m.evaluate("(() => { const o = Date.prototype.getHours; Date.prototype.getHours = () => 9; renderSharedCards(); const n = document.querySelectorAll('#home-shared [data-pending]').length; Date.prototype.getHours = o; return n; })()"):
            bad.append('membro comum vê o pendente')
        # Agora não: some por 12 h e volta depois
        await d.locator(f'[data-pending="{pid}"] button:has-text("Agora não")').click(); await d.wait_for_timeout(200)
        if await d.locator(f'[data-pending="{pid}"]').count(): bad.append('Agora não não escondeu')
        snooze = await d.evaluate(f"Number(localStorage.getItem('baba_pend_snooze_v116:{pid}')) - Date.now()")
        if not (11.9 * 3600e3 < snooze <= 12 * 3600e3): bad.append(f'Agora não esconde por {snooze} ms')
        await d.evaluate(f"localStorage.setItem('baba_pend_snooze_v116:{pid}', String(Date.now() - 1)); renderSharedCards()")
        if not await d.locator(f'[data-pending="{pid}"]').count(): bad.append('pendente não voltou depois das 12 h')
        # Fechar baba: resumo + aviso de partida em andamento, finaliza igual ao manual
        fake.finished_reports = 0
        await d.locator(f'[data-pending="{pid}"] button:has-text("Fechar baba")').click(); await d.wait_for_timeout(700)
        ct = await text(d, '#modal-confirm')
        if '2 partidas e 4 gols' not in ct or 'será encerrada com o placar atual' not in ct: bad.append('confirmação do pendente: ' + ct.replace('\n', ' | '))
        await d.screenshot(path=f'{OUT}/pendente_confirmacao.png')
        await d.click('#modal-confirm-ok'); await d.wait_for_timeout(3000)
        if not fake.babas[pid]['finished'] or fake.finished_reports != 1: bad.append('pendente não fechou')
        if sorted((r['name'], r['goals']) for r in fake.stats.get(pid, [])) != [('Lulu', 1), ('Zeca', 3)]: bad.append('relatório do pendente: ' + str(fake.stats.get(pid)))
        if fake.babas[pid]['played_on'] != old.isoformat(): bad.append('data do pendente mudou')
        if await d.locator(f'[data-pending="{pid}"]').count(): bad.append('card do pendente não sumiu')
        if await d.evaluate("state.babaId") == pid: bad.append('o dono ficou com o pendente aberto')
        await d.evaluate("(() => { Date.prototype.getHours = window.__oh; })()")
        for pg in (d, a, bb, m):
            if pg.errs: bad.append('erros de página: ' + str(pg.errs[:3]))
        await b.close()
    print(json.dumps({'problems': bad}, ensure_ascii=False))
asyncio.run(main())
