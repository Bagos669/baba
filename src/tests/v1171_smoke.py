# v11.7.1 smoke: correção manual de gols/assistências/defesas na ficha do jogador (Lista e Times) fica salva.
import sys, asyncio, json, os
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read(); fake = Fake()
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/v1171'
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

async def stats(pg, name): return await pg.evaluate(f"(() => {{ const p = state.players.find(x => x.name === '{name}'); return p ? [p.goals || 0, p.assists || 0, p.saves || 0] : null; }})()")
def srv_stats(bid, name):
    for p in (fake.babas[bid].get('state') or {}).get('players') or []:
        if p.get('name') == name: return [p.get('goals') or 0, p.get('assists') or 0, p.get('saves') or 0]
async def edit_sheet(pg, name, bumps):
    await pg.evaluate(f"switchTab('ficha'); openPlayerSheet(state.players.find(p => p.name === '{name}').id)"); await pg.wait_for_timeout(250)
    for k, n in bumps:
        for _ in range(abs(n)): await pg.evaluate(f"bumpSheetStat('{k}', {1 if n > 0 else -1})")
    await pg.click('#modal-player button:has-text("Salvar")')
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
        uid = {k: fake.users[f'{k}@t.dev']['id'] for k in ('dono', 'ana')}
        fake.members[(tid, uid['ana'])] = 'admin'
        for pg in (d, a): await pg.evaluate("pullCloud(true)")
        await d.wait_for_timeout(900)
        # Dono monta o baba, dá o apito (vira o anotador) e marca um gol do Zeca.
        await d.evaluate("""(tid) => { state.selectedTeams = [tid]; syncPool();
          state.players.forEach((p, i) => { p.present = true; p.arrival = i + 1; });
          const id = n => state.players.find(p => p.name === n).id;
          state.court = { A: { label: '1', ids: [id('Zeca'), id('Mel Costa')], streak: 0 }, B: { label: '2', ids: [id('Beto Lima'), id('Lulu')], streak: 0 } };
          state.queue = [id('Nando'), id('Rafa')]; state.teamSeq = 2; state.match.lineSize = 2; state.match.goalLimitRule = 'none'; state.liveAsked = true; commit(); }""", tid)
        await d.wait_for_timeout(2500)
        bid = await d.evaluate("state.babaId")
        await d.evaluate("switchTab('placar'); toggleMatchTimer()"); await d.wait_for_timeout(2500)
        await d.evaluate("try { closeQr(); } catch (e) {}")
        await d.evaluate(GOAL, ['A', 'Zeca', None]); await d.wait_for_timeout(1500)
        if await stats(d, 'Zeca') != [1, 0, 0] or srv_stats(bid, 'Zeca') != [1, 0, 0]: bad.append('gol do Zeca: %s / %s' % (await stats(d, 'Zeca'), srv_stats(bid, 'Zeca')))

        # ---- O bug: corrigir na ficha (Lista) e a correção sumir na próxima sincronização
        await edit_sheet(d, 'Zeca', [('goals', 1), ('assists', 2), ('saves', 1)])
        await d.wait_for_timeout(1500)
        await d.evaluate("state.match.secondsLeft = Math.max(1, state.match.secondsLeft - 5); commit()")   # outra gravação qualquer do baba
        await d.wait_for_timeout(4500)                                                                   # passa pelo sharedTick (3 s)
        if await stats(d, 'Zeca') != [2, 2, 1]: bad.append('correção sumiu no celular: %s' % await stats(d, 'Zeca'))
        if srv_stats(bid, 'Zeca') != [2, 2, 1]: bad.append('correção não chegou ao servidor: %s' % srv_stats(bid, 'Zeca'))
        sc = await d.evaluate("[state.match.scoreA, state.match.scoreB, state.match.events.length]")
        if sc != [1, 0, 1]: bad.append('correção mexeu no placar/lances: %s' % sc)
        if 'Números de Zeca corrigidos.' not in await toasts(d): bad.append('aviso de correção: ' + await toasts(d))
        await d.screenshot(path=f'{OUT}/dono_corrigiu.png')
        # Recarregar a página: continua corrigido.
        await d.reload(wait_until='load'); await d.wait_for_timeout(3500)
        if await stats(d, 'Zeca') != [2, 2, 1]: bad.append('depois de recarregar: %s' % await stats(d, 'Zeca'))
        # Desfazer tira o gol, a correção fica (2 → 1 gol, assistências e defesas iguais).
        await d.evaluate("switchTab('placar'); undoLastEvent()"); await d.wait_for_timeout(300)
        if await d.evaluate("!document.getElementById('modal-confirm').classList.contains('hidden')"): await d.click('#modal-confirm-ok')
        await d.wait_for_timeout(2000)
        if await stats(d, 'Zeca') != [1, 2, 1] or srv_stats(bid, 'Zeca') != [1, 2, 1]: bad.append('desfazer depois da correção: %s / %s' % (await stats(d, 'Zeca'), srv_stats(bid, 'Zeca')))

        # ---- Ana (adm, não anota) corrige na aba Times
        await a.evaluate("loadSharedBabas(true)"); await a.wait_for_timeout(400)
        await a.evaluate(f"openSharedBaba('{bid}')"); await a.wait_for_timeout(4500)
        await a.evaluate("window.__toasts = []")
        await a.evaluate("switchTab('fila'); openPlayerSheet(state.players.find(p => p.name === 'Lulu').id)"); await a.wait_for_timeout(250)
        await a.evaluate("bumpSheetStat('saves', 1); bumpSheetStat('saves', 1)")
        await a.click('#modal-player button:has-text("Salvar")'); await a.wait_for_timeout(5000)
        if srv_stats(bid, 'Lulu') != [0, 0, 2] or await stats(a, 'Lulu') != [0, 0, 2]: bad.append('correção do adm: %s / %s' % (srv_stats(bid, 'Lulu'), await stats(a, 'Lulu')))
        if fake.babas[bid].get('scorer_id') != uid['dono']: bad.append('corrigir mudou quem anota')
        await d.wait_for_timeout(3500)
        if await stats(d, 'Lulu') != [0, 0, 2]: bad.append('correção do adm não chegou no anotador: %s' % await stats(d, 'Lulu'))

        # ---- Servidor sem a v11.7.1: aviso claro e nada fica pela metade
        fake.adjust_off = True
        await edit_sheet(d, 'Nando', [('goals', 3)]); await d.wait_for_timeout(2000)
        msg = await text(d, '#lance-status')
        if 'SQL da v11.7.1' not in msg: bad.append('aviso de servidor antigo: ' + msg.replace('\n', ' | '))
        await d.screenshot(path=f'{OUT}/servidor_antigo.png')
        await d.wait_for_timeout(4000)
        if await stats(d, 'Nando') != [0, 0, 0] or srv_stats(bid, 'Nando') != [0, 0, 0]: bad.append('servidor antigo: %s / %s' % (await stats(d, 'Nando'), srv_stats(bid, 'Nando')))
        fake.adjust_off = False
        await b.close()
        print(json.dumps({'problems': bad, 'errsD': d.errs, 'errsA': a.errs}, ensure_ascii=False))
asyncio.run(main())
