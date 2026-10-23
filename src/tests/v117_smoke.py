# v11.7 smoke: Placar (3 formatos + Times abertos/fechados), Início (Começar novo baba, Iniciar esse baba),
# Babas anteriores (Editar/Excluir só dono/adm) e atletas (Ver perfil, Editar nome).
import sys, asyncio, os, datetime, json
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read(); fake = Fake()
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/v117'
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
async def confirm(pg, expr):
    await pg.evaluate(f"setTimeout(() => {{ {expr} }}, 0)"); await pg.wait_for_timeout(300)
    await pg.click('#modal-confirm-ok'); await pg.wait_for_timeout(700)
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
        du = fake.users['dono@t.dev']['id']
        fake.turmas[tid]['owner_id'] = du
        m = await ctxpg(); await signup(m, 'Mel Costa', 'mel@t.dev')
        mu = fake.users['mel@t.dev']['id']; fake.members[(tid, mu)] = 'member'
        for pg in (d, m): await pg.evaluate("pullCloud(true)")
        await d.wait_for_timeout(800)
        # compromisso de hoje
        iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        fake.f_createEvent(du, tid, iso, 'Quadra', '', None)
        for pg in (d, m): await pg.evaluate("loadEvents(true)")
        await d.wait_for_timeout(600)

        # ---------- Início
        await d.evaluate("switchTab('inicio')"); await d.wait_for_timeout(300)
        if not await vis(d, '#home-newbaba button'): bad.append('dono não vê "Começar novo baba" no Início')
        await m.evaluate("switchTab('inicio')"); await m.wait_for_timeout(300)
        if await vis(m, '#home-newbaba button'): bad.append('membro vê "Começar novo baba"')
        if 'Iniciar esse baba' in await text(m, '#home-events'): bad.append('membro vê "Iniciar esse baba"')
        ev = await text(d, '#home-events')
        if 'Iniciar esse baba' not in ev: bad.append('dono não vê "Iniciar esse baba": ' + ev.replace('\n', ' | '))
        await d.screenshot(path=f'{OUT}/inicio.png', full_page=True)
        await d.locator('#home-events button:has-text("Iniciar esse baba")').click(); await d.wait_for_timeout(800)
        s = await d.evaluate("({ sel: state.selectedTeams, ev: state.eventId, n: state.players.length })")
        if s['sel'] != [tid] or not s['ev'] or s['n'] != len(NAMES): bad.append('Iniciar esse baba não ligou turma/lista: ' + str(s))
        await d.evaluate("switchTab('inicio')"); await d.wait_for_timeout(300)
        if 'Abrir baba em andamento' not in await text(d, '#home-events'): bad.append('botão não virou "Abrir baba em andamento"')
        # evento de outro dia / cancelado não mostra o botão
        fake.f_createEvent(du, tid, (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3)).isoformat(), 'Quadra', '', None)
        await d.evaluate("loadEvents(true)"); await d.wait_for_timeout(500)
        if (await text(d, '#home-events')).count('baba em andamento') + (await text(d, '#home-events')).count('Iniciar esse baba') != 1: bad.append('evento de outro dia ganhou botão')

        # ---------- Placar
        await d.evaluate("switchTab('placar')"); await d.wait_for_timeout(300)
        if 'Quantidade de jogadores de linha' not in await text(d, '#tab-content-placar'): bad.append('rótulo "Quantidade de jogadores de linha"')
        if await d.locator('#match-game-format button').count() != 3: bad.append('não são 3 opções')
        if 'Onde é o baba' in await text(d, '#tab-content-placar'): bad.append('"Onde é o baba" ainda existe')
        await d.locator('#match-game-format button:has-text("Society")').click(); await d.wait_for_timeout(300)
        r = await d.evaluate("({ n: state.match.lineSize, v: state.settings.venue, tm: state.settings.teamsMode })")
        if r['n'] != 6 or r['v'] != 'society' or r['tm'] != 'open': bad.append('Society não gravou 6 + society + abertos: ' + str(r))
        await d.locator('#match-game-format button:has-text("Campo")').click(); await d.wait_for_timeout(200)
        if await d.evaluate("state.match.lineSize") != 10 or await d.evaluate("daySummary().venue") != 'campo': bad.append('Campo não gravou 10 + campo')
        await d.locator('#match-game-format button:has-text("Futsal")').click(); await d.wait_for_timeout(200)
        if await d.evaluate("state.match.lineSize") != 4: bad.append('Futsal não gravou 4')
        # Times fechados: o app não completa o time sozinho
        await d.evaluate("""() => { state.players.forEach((p, i) => { p.present = true; p.arrival = i + 1; }); const ids = state.players.map(p => p.id);
          state.court = { A: { label: '1', ids: ids.slice(0, 3), streak: 0 }, B: { label: '2', ids: ids.slice(3, 4), streak: 0 } }; state.queue = ids.slice(4); state.teamSeq = 2; state.match.lineSize = 2; commit(); }""")
        await d.evaluate("state.settings.keeperMode = 'sem'")
        if len(await d.evaluate("topUp('B')")) == 0: bad.append('Times abertos: o time curto deveria completar')
        await d.evaluate("""() => { const ids = state.players.map(p => p.id); state.court.B = { label: '2', ids: [ids[3]], streak: 0 }; state.queue = ids.slice(4); }""")
        await d.locator('#match-teams-seg button:has-text("Fechados")').click(); await d.wait_for_timeout(300)
        if await d.evaluate("state.settings.teamsMode") != 'closed': bad.append('Times fechados não ligou')
        if len(await d.evaluate("topUp('B')")) != 0: bad.append('Times fechados: o app completou o time sozinho')
        if len(await d.evaluate("topUp('B', true)")) == 0: bad.append('Times fechados: "Completar" na mão deveria funcionar')
        await d.screenshot(path=f'{OUT}/placar.png', full_page=True)
        await m.evaluate("switchTab('placar')")
        await m.evaluate("state.selectedTeams = [state.turmas[0].id]")
        await m.evaluate("setTeamsMode('closed')"); await m.wait_for_timeout(300)
        if await m.evaluate("state.settings.teamsMode") == 'closed': bad.append('membro conseguiu fechar os times')
        if 'dono ou um adm' not in await toasts(m): bad.append('membro sem aviso: ' + await toasts(m))
        await d.locator('#match-teams-seg button:has-text("Abertos")').click(); await d.wait_for_timeout(200)
        await d.evaluate("() => { state.settings.venue = 'society'; state.match.lineSize = 6; }")

        # ---------- Babas anteriores
        await d.evaluate("""(tid) => { closeOutBaba(false); state.selectedTeams = [tid]; syncPool();
          const a = state.players[0], b = state.players[1]; a.present = b.present = true; a.goals = 2; a.matches = 2; b.goals = 1; b.assists = 2; b.saves = 1; b.matches = 2;
          state.settings.venue = 'society';
          state.matchHistory.unshift({ timestamp: '18:00', labelA: '1', labelB: '2', scoreA: 2, scoreB: 1, namesA: [a.name], namesB: [b.name], played: 420, added: 0, events: [] });
          state.matchHistory.unshift({ timestamp: '18:10', labelA: '1', labelB: '3', scoreA: 1, scoreB: 1, namesA: [a.name], namesB: [b.name], played: 420, added: 0, events: [] });
          closeOutBaba(true); commit(); }""", tid)
        await d.wait_for_timeout(2500)
        await d.evaluate("pullCloud(true)"); await d.wait_for_timeout(1200)
        done = [x for x in fake.babas.values() if x['finished']]
        if len(done) != 1: bad.append('baba não foi finalizado no servidor: %d' % len(done))
        bid = done[0]['id'] if done else None
        await m.evaluate("pullCloud(true)"); await m.wait_for_timeout(1200)
        await d.evaluate(f"openHistory(null, '{bid}')"); await d.wait_for_timeout(900)
        h = await text(d, '#history-body')
        if 'Editar' not in h or 'Excluir' not in h: bad.append('dono não vê Editar/Excluir: ' + h.replace('\n', ' | ')[:200])
        await d.screenshot(path=f'{OUT}/baba_anterior.png')
        await m.evaluate(f"openHistory(null, '{bid}')"); await m.wait_for_timeout(900)
        hm = await text(m, '#history-body')
        if 'Editar' in hm or 'Excluir' in hm: bad.append('membro vê Editar/Excluir')
        await m.evaluate("closeHistory()")
        await d.evaluate(f"historyEditStart('{bid}')"); await d.wait_for_timeout(400)
        if 'Editar baba' not in await text(d, '#history-title'): bad.append('tela de edição não abriu')
        await d.screenshot(path=f'{OUT}/editar.png', full_page=True)
        await d.evaluate("""() => { historyEditField('date', '2026-10-10'); historyEditField('venue', 'futsal'); historyEditSet('score', 0, 'a', 3); historyEditSet('stat', 0, 'goals', 5); }""")
        await d.evaluate("historyEditSave()"); await d.wait_for_timeout(1200)
        fb = fake.babas.get(bid); st = fake.stats.get(bid, [])
        if not fb or fb['played_on'] != '2026-10-10' or fb['state'].get('venue') != 'futsal': bad.append('data/local não foram gravados no servidor')
        if not fb or fb['state']['games'][0].get('scoreA') != 3: bad.append('placar da partida não gravou: ' + str(fb and fb['state'].get('games')))
        if sorted(r['goals'] for r in st)[-1] != 5: bad.append('gols não gravaram: ' + str(st))
        dd = await d.evaluate(f"(() => {{ const x = state.pastDays.find(y => y.id === '{bid}'); return x && {{ date: x.date.slice(0, 10), venue: x.venue, top: Math.max(...x.players.map(p => p.goals)) }}; }})()")
        if dd != {'date': '2026-10-10', 'venue': 'futsal', 'top': 5}: bad.append('tela não mostra a correção: ' + str(dd))
        # membro: o servidor recusa mesmo se tentarem chamar
        r = await m.evaluate(f"api.editBaba('{bid}', '2026-01-01', null, [], []).then(() => 'ok', e => String(e.message || e))")
        if 'forbidden' not in r: bad.append('servidor deixou o membro editar: ' + r)
        r = await m.evaluate(f"api.removeBaba('{bid}').then(() => 'ok', e => String(e.message || e))")
        if 'forbidden' not in r: bad.append('servidor deixou o membro excluir: ' + r)
        # excluir
        await d.evaluate(f"openHistory(null, '{bid}')"); await d.wait_for_timeout(300)
        await d.evaluate("setTimeout(() => deletePastDay(" + repr(bid) + "), 0)"); await d.wait_for_timeout(300)
        if 'Excluir o baba de 10/10?' not in await text(d, '#modal-confirm-text') or 'não pode ser desfeito' not in await text(d, '#modal-confirm-text'):
            bad.append('confirmação sem resumo: ' + await text(d, '#modal-confirm-text'))
        await d.click('#modal-confirm-ok'); await d.wait_for_timeout(1000)
        if bid in fake.babas or bid in fake.stats: bad.append('baba não foi excluído no servidor')
        if await d.evaluate(f"state.pastDays.some(x => x.id === '{bid}')"): bad.append('baba continua em Babas anteriores')
        await d.evaluate("closeHistory()")

        # ---------- Atletas
        await d.evaluate(f"switchTab('inicio'); openTurmaEditor('{tid}')"); await d.wait_for_timeout(500)
        await d.evaluate(f"openAthleteActions('{tid}', 0)"); await d.wait_for_timeout(300)
        t = await text(d, '#aact-body')
        if 'Ver perfil' not in t or 'Editar nome' not in t: bad.append('opções do atleta (dono): ' + t.replace('\n', ' | '))
        await d.click('#aact-body button:has-text("Editar nome")'); await d.fill('#aact-name', '   '); await d.click('#aact-save'); await d.wait_for_timeout(300)
        if 'não pode ficar vazio' not in await toasts(d): bad.append('nome vazio sem mensagem')
        await d.fill('#aact-name', 'lulu'); await d.click('#aact-save'); await d.wait_for_timeout(500)
        if 'Já existe' not in await toasts(d): bad.append('nome repetido sem mensagem')
        await d.fill('#aact-name', 'Zeca Novo'); await d.click('#aact-save'); await d.wait_for_timeout(1200)
        if 'Zeca Novo' not in [p['name'] for p in fake.players.values()]: bad.append('servidor não recebeu o nome novo')
        if 'Zeca Novo' not in await text(d, '#turma-edit-list'): bad.append('lista da turma sem o nome novo')
        if await d.evaluate("currentUser.name") != 'Dono Silva': bad.append('nome da conta mudou')
        await d.screenshot(path=f'{OUT}/atletas.png')
        await d.evaluate(f"openAthleteActions('{tid}', 1)"); await d.wait_for_timeout(200)
        await d.click('#aact-body button:has-text("Ver perfil")'); await d.wait_for_timeout(500)
        if not await vis(d, '#modal-acard') or 'Lulu' not in await text(d, '#acard-box'): bad.append('Ver perfil não abriu o card de quem não tem conta')
        await d.screenshot(path=f'{OUT}/perfil_atleta.png')
        await d.evaluate("closeAthleteCard()")
        # membro: sem Editar nome; servidor recusa
        await m.evaluate(f"openTurmaEditor('{tid}')"); await m.wait_for_timeout(500)
        await m.evaluate(f"openAthleteActions('{tid}', 1)"); await m.wait_for_timeout(200)
        tm = await text(m, '#aact-body')
        if 'Editar nome' in tm or 'Ver perfil' not in tm: bad.append('opções do atleta (membro): ' + tm.replace('\n', ' | '))
        pid = next(k for k, v in fake.players.items() if v['name'] == 'Lulu')
        r = await m.evaluate(f"api.renamePlayerById('{pid}', 'Hack').then(() => 'ok', e => String(e.message || e))")
        if 'forbidden' not in r: bad.append('servidor deixou o membro renomear: ' + r)
        for n, pg in (('dono', d), ('membro', m)):
            if pg.errs: bad.append(f'erro de JS ({n}): ' + '; '.join(pg.errs[:3]))
        await b.close()
    print(json.dumps({'problems': bad}, ensure_ascii=False))
asyncio.run(main())
