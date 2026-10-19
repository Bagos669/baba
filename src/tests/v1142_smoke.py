# v11.4.2 smoke: avisos no celular. Interruptores em Configurações (padrão ligado, salvam na conta),
# ligar um interruptor registra o celular, e o toque no aviso abre a tela certa (lista em Turmas → Lista, palpites na Lojinha → Palpites).
import sys, asyncio, os, datetime
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read(); fake = Fake()
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/v1142'
os.makedirs(OUT, exist_ok=True)
URL = 'http://localhost:8765/'
bad = []
NAMES = ['Gabriel Marini', 'Bezão', 'Caio', 'Duda']
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
def iso(dt): return dt.isoformat(timespec='seconds') + 'Z'
async def vis(pg, sel): return await pg.evaluate(f"(()=>{{const e=document.querySelector('{sel}');return !!e&&!e.classList.contains('hidden')&&getComputedStyle(e).display!=='none'}})()")
async def main():
    fake._v8init(); fake._evinit()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844})
        await ctx.expose_function('fakeCall', lambda n, t, a: fake.handle(n, t, a)); await ctx.add_init_script(FAKE_JS)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await signup(pg, 'Gabriel Marini', 'adm@t.dev')
        tid = await pg.evaluate("""async (names) => { const id = crypto.randomUUID(); await api.upsertTurma(id, 'FutAvisos', 'AVIS1234');
          state.turmas.push({ id, name: 'FutAvisos', cloud: true, role: 'owner', invite: 'AVIS1234', players: names, keepers: [], women: [], meta: {} });
          await syncTurmaNow(id); return id; }""", NAMES)
        adm = fake.users['adm@t.dev']['id']
        tomorrow = datetime.datetime.utcnow() + datetime.timedelta(days=1)
        yesterday = datetime.datetime.utcnow() - datetime.timedelta(days=1)
        def mkevent(eid, starts, status='open'):
            fake.events[eid] = {'id': eid, 'turma_id': tid, 'created_by': adm, 'starts_at': iso(starts), 'place': 'Quadra', 'note': None, 'max_players': None, 'status': status,
                                'created_at': iso(datetime.datetime.utcnow()), 'closed_at': None}
        mkevent('11111111-1111-4111-8111-111111111111', tomorrow)
        mkevent('22222222-2222-4222-8222-222222222222', yesterday, 'canceled')
        await pg.evaluate("loadEvents(true)"); await pg.wait_for_timeout(900)

        # ---- Configurações: seção Avisos com 3 interruptores, todos ligados por padrão
        await pg.click('#header-settings'); await pg.wait_for_timeout(500)
        if not await vis(pg, '#settings-avisos'): bad.append('seção "Avisos no celular" não aparece')
        ids = ['pref-aviso-lista', 'pref-aviso-lembrete', 'pref-aviso-palpites']
        for i in ids:
            if not await pg.evaluate(f"document.getElementById('{i}').checked"): bad.append(f'{i} deveria vir ligado')
        txt = await pg.evaluate("document.getElementById('settings-avisos').innerText")
        for t in ['Lista aberta', 'Lembrete de resposta', 'Palpites liquidados']:
            if t not in txt: bad.append('falta o texto ' + t)
        # o interruptor antigo dos avisos de jogo continua onde estava
        if not await vis(pg, '#pref-push-turma') and await pg.evaluate("!document.getElementById('pref-push-turma')"): bad.append('interruptor dos avisos de jogo sumiu')
        await pg.screenshot(path=f'{OUT}/config_avisos.png', full_page=True)

        # ---- desligar um interruptor guarda só aquele; os outros seguem ligados; vai para a conta
        await pg.evaluate("(() => { window.pushSubscription = async () => ({ toJSON: () => ({ endpoint: 'https://push.t/aparelho', keys: { p256dh: 'k', auth: 'a' } }) }); })()")
        await pg.evaluate("(() => { Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true }); })()")
        await pg.evaluate("document.getElementById('pref-aviso-lembrete').click()"); await pg.wait_for_timeout(2500)
        pr = await pg.evaluate("({ l: prefs.avisoLista, v: prefs.avisoLembrete, p: prefs.avisoPalpites })")
        if pr != {'l': True, 'v': False, 'p': True}: bad.append('prefs depois de desligar o lembrete: ' + str(pr))
        saved = (fake.profiles.get(adm) or {}).get('prefs') or {}
        if saved.get('avisoLembrete') is not False or saved.get('avisoLista') is not True or saved.get('avisoPalpites') is not True: bad.append('prefs não foram para a conta: ' + str(saved))
        if getattr(fake, 'subs', {}) and 'https://push.t/aparelho' in fake.subs: bad.append('desligar não deveria registrar o celular')
        # ligar de novo registra o celular (sem mexer nos avisos de jogo da turma)
        await pg.evaluate("document.getElementById('pref-aviso-lembrete').click()"); await pg.wait_for_timeout(2500)
        s = (getattr(fake, 'subs', {}) or {}).get('https://push.t/aparelho')
        if not s: bad.append('ligar o interruptor deveria registrar o celular no servidor')
        elif s.get('turma'): bad.append('registrar o celular para os avisos não pode ligar os avisos de jogo da turma')
        if not await pg.evaluate("prefs.avisoLembrete"): bad.append('lembrete não religou')
        await pg.evaluate("closeSettings()"); await pg.wait_for_timeout(200)

        # ---- toque no aviso de lista: Turmas → Lista, no evento
        await pg.evaluate("switchTab('inicio')"); await pg.wait_for_timeout(300)
        await pg.evaluate("navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'open', url: 'http://localhost:8765/#lista=11111111-1111-4111-8111-111111111111' } }))")
        await pg.wait_for_timeout(1200)
        if not await vis(pg, '#tab-content-ficha'): bad.append('aviso de lista: não abriu Turmas → Lista')
        if not await vis(pg, '#modal-event'): bad.append('aviso de lista: folha da lista não abriu')
        if await pg.evaluate("eventOpen") != '11111111-1111-4111-8111-111111111111': bad.append('aviso de lista: abriu o evento errado')
        await pg.screenshot(path=f'{OUT}/toque_lista.png')
        await pg.evaluate("closeEventSheet()")

        # ---- toque no aviso de palpites: Lojinha → Palpites, no evento do aviso (mesmo cancelado/passado)
        await pg.evaluate("switchTab('inicio')"); await pg.wait_for_timeout(300)
        for eid in ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']:
            await pg.evaluate("switchTab('inicio')"); await pg.wait_for_timeout(200)
            await pg.evaluate("(id) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'open', url: 'http://localhost:8765/#palpites=' + id } }))", eid)
            await pg.wait_for_timeout(1500)
            if not await vis(pg, '#tab-content-loja'): bad.append('aviso de palpites: não abriu a Lojinha')
            if await pg.evaluate("propEventId") != eid: bad.append('aviso de palpites: evento errado ' + str(await pg.evaluate("propEventId")))
        await pg.screenshot(path=f'{OUT}/toque_palpites.png')

        # ---- app fechado: abrir pelo link do aviso (frio) cai na mesma tela
        pg2 = await ctx.new_page(); pg2.on('pageerror', lambda e: errs.append(str(e)))
        await pg2.goto(URL + '#palpites=11111111-1111-4111-8111-111111111111', wait_until='load'); await pg2.wait_for_timeout(3500)
        if not await vis(pg2, '#tab-content-loja'): bad.append('link frio de palpites: não abriu a Lojinha')
        if await pg2.evaluate("propEventId") != '11111111-1111-4111-8111-111111111111': bad.append('link frio de palpites: evento errado')
        pg3 = await ctx.new_page(); pg3.on('pageerror', lambda e: errs.append(str(e)))
        await pg3.goto(URL + '#lista=11111111-1111-4111-8111-111111111111', wait_until='load'); await pg3.wait_for_timeout(3500)
        if not await vis(pg3, '#tab-content-ficha') or await pg3.evaluate("eventOpen") != '11111111-1111-4111-8111-111111111111': bad.append('link frio de lista: não abriu Turmas → Lista no evento')
        await b.close()
    print({'problems': bad, 'errs': errs})
asyncio.run(main())
