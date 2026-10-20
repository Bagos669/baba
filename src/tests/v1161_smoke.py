# v11.6.1 smoke: anotador único e mesário. Quatro celulares (Dono, Ana e Beto adms, Mel membro com conta).
# Barra "Anotador: [nome]", botões travados, estados enviando/confirmado/falhou + "Tentar de novo", "Sem conexão",
# Assumir anotação (lance atrasado recusado), transmissão segue o anotador, Passar a vez (só presentes com conta),
# aviso do mesário, o que o mesário pode e não pode, mesário some ao finalizar.
import sys, asyncio, json, os
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read(); fake = Fake()
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/v1161'
os.makedirs(OUT, exist_ok=True)
URL = 'http://localhost:8765/'
bad = []
NAMES = ['Zeca', 'Lulu', 'Mel Costa', 'Beto Lima', 'Nando', 'Rafa']
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
async def locked(pg, sel): return await pg.evaluate(f"document.querySelector('{sel}').classList.contains('lance-locked')")
GOAL = "(([side, name, assist]) => { selectedGoalSide = side; selectedGoalScorer = state.players.find(p => p.name === name).id; confirmGoalRecord(assist ? state.players.find(p => p.name === assist).id : null); })"
SAVE = "(([side, name]) => { selectedSaveSide = side; recordGoalkeeperSave(state.players.find(p => p.name === name).id); })"
async def main():
    fake._v8init(); fake._evinit(); fake._pinit(); fake._tminit()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        async def ctxpg():
            ctx = await b.new_context(viewport={'width': 390, 'height': 844})
            await ctx.expose_function('fakeCall', lambda n, t, a: fake.handle(n, t, a)); await ctx.add_init_script(FAKE_JS)
            pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.errs = errs; pg.ctx = ctx; return pg
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
        for pl in fake.players.values():
            if pl['turma_id'] == tid and pl['name'] == 'Mel Costa': pl['user_id'] = uid['mel']
            if pl['turma_id'] == tid and pl['name'] == 'Beto Lima': pl['user_id'] = uid['beto']
        for pg in (d, a, bb, m): await pg.evaluate("pullCloud(true)")
        await a.wait_for_timeout(900)
        # ---- Ana monta e dá o primeiro apito: ela é a anotadora (e abre a transmissão)
        await a.evaluate("""(tid) => { state.selectedTeams = [tid]; syncPool();
          state.players.forEach((p, i) => { p.present = true; p.arrival = i + 1; });
          const id = n => state.players.find(p => p.name === n).id;
          state.court = { A: { label: '1', ids: [id('Zeca'), id('Mel Costa')], streak: 0 }, B: { label: '2', ids: [id('Beto Lima'), id('Lulu')], streak: 0 } };
          state.queue = [id('Nando'), id('Rafa')]; state.teamSeq = 2; state.match.lineSize = 2; state.match.goalLimitRule = 'none'; commit(); }""", tid)
        await a.wait_for_timeout(2500)
        bid = await a.evaluate("state.babaId")
        await a.evaluate("switchTab('placar'); toggleMatchTimer()"); await a.wait_for_timeout(2500)
        await a.evaluate("try { closeQr(); } catch (e) {}")
        lid = await a.evaluate("state.live && state.live.id")
        if not lid or lid not in fake.lives: bad.append('transmissão não abriu')
        if fake.babas[bid].get('scorer_id') != uid['ana']: bad.append('quem iniciou não virou anotador')
        await a.wait_for_timeout(3500)
        if 'Anotador: você' not in await text(a, '#scorer-bar'): bad.append('barra da Ana: ' + await text(a, '#scorer-bar'))
        # ---- Beto abre: barra "Anotador: Ana" e botões de lance travados
        await bb.evaluate(f"loadSharedBabas(true)"); await bb.wait_for_timeout(400)
        await bb.evaluate(f"openSharedBaba('{bid}')"); await bb.wait_for_timeout(4500)
        bt = await text(bb, '#scorer-bar')
        if 'Anotador: Ana' not in bt or 'Assumir anotação' not in bt or 'Passar a vez de anotar' not in bt: bad.append('barra do Beto: ' + bt.replace('\n', ' | '))
        for sel in ('#btn-goal-a', '#btn-save-b', '#btn-undo', '#cm-goal-a'):
            if not await locked(bb, sel): bad.append('botão de lance livre para quem não anota: ' + sel)
        await bb.screenshot(path=f'{OUT}/beto_anotador_ana.png')
        await bb.evaluate("openGoalModal('A')"); await bb.wait_for_timeout(200)
        if await vis(bb, '#modal-goal'): bad.append('modal de gol abriu para quem não anota')
        # ---- Ana registra gol: enviando → confirmado; chega no Beto
        await a.evaluate(GOAL, ['A', 'Zeca', 'Mel Costa'])
        st0 = await a.evaluate("lanceQ.map(x => x.status).join(',')")
        await a.wait_for_timeout(500)
        if '1' != str(fake.babas[bid]['state']['match'].get('scoreA')): bad.append('gol não chegou ao servidor')
        if 'Confirmado' not in await text(a, '#lance-status'): bad.append('sem "Confirmado": ' + await text(a, '#lance-status') + ' / ' + st0)
        await a.screenshot(path=f'{OUT}/ana_confirmado.png')
        if await a.evaluate("state.match.scoreA") != 1: bad.append('placar da Ana não mudou depois de confirmado')
        await bb.wait_for_timeout(5000)
        if await bb.evaluate("state.match.scoreA") != 1: bad.append('gol não chegou no Beto')
        # ---- sem conexão: falhou + "Sem conexão" + Tentar de novo
        await a.ctx.set_offline(True); await a.wait_for_timeout(200)
        await a.evaluate(SAVE, ['B', 'Lulu']); await a.wait_for_timeout(600)
        if 'Falhou' not in await text(a, '#lance-status') or 'Tentar de novo' not in await text(a, '#lance-status'): bad.append('lance sem internet não mostra Falhou/Tentar de novo: ' + await text(a, '#lance-status'))
        if not await vis(a, '#lance-offline') or 'Sem conexão: lances não enviados' not in await text(a, '#lance-offline'): bad.append('faixa Sem conexão')
        if any(pp.get('saves') for pp in fake.babas[bid]['state']['players']): bad.append('lance sem internet contou')
        if await a.evaluate("state.players.find(p => p.name === 'Lulu').saves") != 0: bad.append('defesa contou antes de confirmar')
        await a.screenshot(path=f'{OUT}/ana_sem_conexao.png')
        await a.ctx.set_offline(False); await a.wait_for_timeout(300)
        await a.locator('#lance-status button:has-text("Tentar de novo")').click(); await a.wait_for_timeout(900)
        if next(pp for pp in fake.babas[bid]['state']['players'] if pp['name'] == 'Lulu').get('saves') != 1: bad.append('tentar de novo não gravou a defesa')
        if await vis(a, '#lance-offline'): bad.append('faixa Sem conexão não sumiu')
        # ---- Beto assume a anotação: Ana vira só visualização; lance atrasado dela é recusado
        await bb.wait_for_timeout(4000)
        await bb.locator('#btn-take-scoring').click(); await bb.wait_for_timeout(1500)
        if fake.babas[bid].get('scorer_id') != uid['beto']: bad.append('Beto não assumiu')
        if fake.lives[lid]['owner'] != uid['beto']: bad.append('transmissão não seguiu o anotador')
        if await locked(bb, '#btn-goal-a'): bad.append('Beto continua travado depois de assumir')
        await a.wait_for_timeout(5000)
        if 'Beto assumiu a anotação' not in await toasts(a): bad.append('Ana sem aviso "Beto assumiu a anotação": ' + await toasts(a))
        if not await locked(a, '#btn-goal-a'): bad.append('Ana continua com os botões de lance')
        before = fake.babas[bid]['state']['match'].get('scoreB')
        await a.evaluate("submitLance({ kind: 'goal', side: 'B', el: 1, scorerId: state.players.find(p => p.name === 'Lulu').id, assistId: null, time: '05:00', text: '⚽ atrasado' })")
        await a.wait_for_timeout(900)
        if 'Recusado' not in await text(a, '#lance-status'): bad.append('lance atrasado não aparece como recusado: ' + await text(a, '#lance-status'))
        if fake.babas[bid]['state']['match'].get('scoreB') != before: bad.append('lance atrasado mudou o placar')
        # Beto anota; a transmissão (mesmo código) recebe o placar novo
        await bb.evaluate(GOAL, ['B', 'Beto Lima', None]); await bb.wait_for_timeout(2000)
        ls = fake.lives[lid].get('state') or {}
        if json.dumps(ls).find('"score": 1') < 0: bad.append('placar 1 x 1 não chegou na transmissão: ' + json.dumps(ls)[:300])
        # ---- Passar a vez: lista só com presentes que têm conta
        await bb.locator('#btn-pass-scoring').click(); await bb.wait_for_timeout(300)
        lst = await text(bb, '#mesario-list')
        if 'Mel Costa' not in lst or 'Zeca' in lst or 'Lulu' in lst: bad.append('lista de mesário: ' + lst.replace('\n', ' | '))
        await bb.screenshot(path=f'{OUT}/passar_a_vez.png')
        await bb.locator(f'[data-mesario="{uid["mel"]}"]').click(); await bb.wait_for_timeout(300)
        await bb.click('#modal-confirm-ok'); await bb.wait_for_timeout(1200)
        if fake.babas[bid].get('mesario_id') != uid['mel'] or fake.babas[bid].get('scorer_id') != uid['mel']: bad.append('Mel não virou mesária')
        # ---- Mel recebe o aviso e anota
        await m.evaluate("loadSharedBabas(true)"); await m.wait_for_timeout(2500)
        if await m.evaluate("state.babaId") != bid: bad.append('baba não abriu no celular da mesária')
        if 'Você é o mesário deste baba' not in await text(m, '#modal-popup'): bad.append('aviso do mesário: ' + await text(m, '#modal-popup'))
        await m.screenshot(path=f'{OUT}/mesario_aviso.png')
        await m.click('#popup-ok'); await m.wait_for_timeout(400)
        if not await vis(m, '#tab-content-placar'): bad.append('aviso do mesário não abriu o Placar')
        if 'Você é o mesário deste baba' not in await text(m, '#scorer-bar') or 'Assumir' in await text(m, '#scorer-bar') or 'Passar a vez' in await text(m, '#scorer-bar'):
            bad.append('barra da mesária: ' + await text(m, '#scorer-bar'))
        await m.evaluate(GOAL, ['A', 'Mel Costa', 'Zeca']); await m.wait_for_timeout(800)
        await m.evaluate(SAVE, ['B', 'Lulu']); await m.wait_for_timeout(800)
        sv = fake.babas[bid]['state']
        mel = next(pp for pp in sv['players'] if pp['name'] == 'Mel Costa')
        if sv['match'].get('scoreA') != 2 or mel.get('goals') != 1: bad.append('gol da mesária')
        await m.screenshot(path=f'{OUT}/mesario_placar.png')
        await m.evaluate("undoLastEvent()"); await m.wait_for_timeout(800)
        if next(pp for pp in fake.babas[bid]['state']['players'] if pp['name'] == 'Lulu').get('saves') != 1: bad.append('mesária não desfez a defesa')
        await bb.wait_for_timeout(5000)
        if await bb.evaluate("state.match.scoreA") != 2: bad.append('gol da mesária não chegou nos outros')
        if 'Anotador: Mel' not in await text(bb, '#scorer-bar'): bad.append('barra do Beto não mostra a mesária')
        # O que a mesária não pode: finalizar o baba, mexer na fila / chegadas, assumir
        await m.evaluate("setTimeout(startNewDay, 0)"); await m.wait_for_timeout(400)
        if await vis(m, '#modal-confirm'): bad.append('mesária consegue pedir para finalizar o baba'); await m.evaluate('resolveConfirm(false)')
        if fake.babas[bid]['finished']: bad.append('mesária finalizou o baba')
        if not await m.evaluate("document.body.classList.contains('baba-mesario') && getComputedStyle(document.getElementById('tab-content-fila')).pointerEvents === 'none'"): bad.append('Times/fila não travados para a mesária')
        q0 = json.dumps(fake.babas[bid]['state']['queue'])
        await m.evaluate("state.queue.reverse(); commit()"); await m.wait_for_timeout(5500)
        if json.dumps(fake.babas[bid]['state']['queue']) != q0: bad.append('mesária mudou a fila no servidor')
        if await m.evaluate("JSON.stringify(state.queue)") != q0.replace(' ', ''): bad.append('celular da mesária não voltou para a fila do servidor')
        # Mesária encerra a partida: a fila anda como hoje
        await m.evaluate("setTimeout(() => finishMatchAndNextChallenger(), 0)"); await m.wait_for_timeout(600)
        if await vis(m, '#modal-confirm'):
            bad.append('confirmação inesperada ao encerrar: ' + await text(m, '#modal-confirm-text')); await m.evaluate('resolveConfirm(true)')
        await m.wait_for_timeout(2500)
        sv = fake.babas[bid]['state']
        if len(sv.get('matchHistory') or []) != 1 or sv['match'].get('scoreA') != 0: bad.append('mesária não encerrou a partida: ' + json.dumps(sv.get('matchHistory'))[:200])
        # ---- Beto finaliza o baba: o mesário deixa de existir
        await bb.wait_for_timeout(4500)
        await bb.evaluate("setTimeout(startNewDay, 0)"); await bb.wait_for_timeout(300); await bb.click('#modal-confirm-ok'); await bb.wait_for_timeout(2000)
        if not fake.babas[bid]['finished'] or fake.babas[bid].get('mesario_id'): bad.append('finalizar não acabou com o mesário')
        await m.wait_for_timeout(5000)
        if 'Baba finalizado por Beto' not in await toasts(m): bad.append('mesária sem "Baba finalizado por Beto"')
        if await m.evaluate("document.body.classList.contains('baba-mesario')"): bad.append('celular continua como mesário depois de finalizar')
        who = {x['by'] for x in fake.lance_log}
        if who != {uid['ana'], uid['beto'], uid['mel']}: bad.append('quem registrou os lances: ' + str(who))
        for pg in (d, a, bb, m):
            if pg.errs: bad.append('erros de página: ' + str(pg.errs[:3]))
        await b.close()
    print(json.dumps({'problems': bad}, ensure_ascii=False))
asyncio.run(main())
