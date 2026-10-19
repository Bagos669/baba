# v11.4 smoke: palpites pré-jogo. Chip no Início, seção Palpites na Lojinha, bilhete de 3 toques, travas, adm, menor de idade,
# liquidação (ganhou/devolvido), baba ligado à lista e textos proibidos.
import sys, asyncio, json, os, datetime, re
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read(); fake = Fake()
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/v114'
os.makedirs(OUT, exist_ok=True)
URL = 'http://localhost:8765/'
bad = []
NAMES = ['Gabriel Marini', 'Bezão', 'Caio', 'Duda', 'Thiago', 'Kauã', 'Léo', 'Igor', 'Zé Goleiro']
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
def block(pg, name): return pg.locator('[data-prop-player]').filter(has_text=name)
async def vis(pg, sel): return await pg.evaluate(f"(()=>{{const e=document.querySelector('{sel}');return !!e&&!e.classList.contains('hidden')&&getComputedStyle(e).display!=='none'}})()")
async def text(pg, sel): return await pg.evaluate(f"(document.querySelector('{sel}')||{{}}).innerText||''")
async def main():
    fake._v8init(); fake._evinit()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        async def ctxpg():
            ctx = await b.new_context(viewport={'width': 390, 'height': 844})
            await ctx.expose_function('fakeCall', lambda n, t, a: fake.handle(n, t, a)); await ctx.add_init_script(FAKE_JS)
            pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.errs = errs; return pg
        a = await ctxpg(); await signup(a, 'Gabriel Marini', 'adm@t.dev')
        tid = await a.evaluate("""async (names) => { const id = crypto.randomUUID(); await api.upsertTurma(id, 'FutHeavenly', 'FUTH1234');
          state.turmas.push({ id, name: 'FutHeavenly', cloud: true, role: 'owner', invite: 'FUTH1234', players: names, keepers: ['Zé Goleiro'], women: [], meta: {} });
          await syncTurmaNow(id); return id; }""", NAMES)
        adm = fake.users['adm@t.dev']['id']
        m = await ctxpg(); await signup(m, 'Bezão', 'bez@t.dev'); mem = fake.users['bez@t.dev']['id']
        k = await ctxpg(); await signup(k, 'Menor', 'menor@t.dev'); kid = fake.users['menor@t.dev']['id']
        fake.acct[kid]['birth'] = datetime.date.today().replace(year=datetime.date.today().year - 16)
        fake.members[(tid, mem)] = 'member'; fake.members[(tid, kid)] = 'member'
        pl = {x['name']: x for x in fake.players.values() if x['turma_id'] == tid}
        pl['Gabriel Marini']['user_id'] = adm; pl['Bezão']['user_id'] = mem
        # histórico: 10 babas finalizados, 3 partidas cada; linha: 3 gols, 1 assistência em 5 jogos; goleiro: 6 defesas em 5 jogos
        today = datetime.date.today()
        for i in range(10):
            bid = f'hist-{i}'
            fake.babas[bid] = {'id': bid, 'created_by': adm, 'turma_ids': [tid], 'title': 'h', 'played_on': (today - datetime.timedelta(days=7 * (i + 1))).isoformat(), 'finished': True, 'matches': 3, 'state': {}, 'updated': i}
            fake.stats[bid] = [{'baba_id': bid, 'turma_player_id': pl[n]['id'], 'name': n, 'goals': 0 if n == 'Zé Goleiro' else 3, 'assists': 0 if n == 'Zé Goleiro' else 1,
                                'saves': 6 if n == 'Zé Goleiro' else 0, 'matches': 5, 'wins': 2} for n in NAMES]
        def mkevent(eid, starts, rsvp_names, guest=True):
            fake.events[eid] = {'id': eid, 'turma_id': tid, 'created_by': adm, 'starts_at': iso(starts), 'place': 'Quadra', 'note': None, 'max_players': None, 'status': 'open', 'created_at': iso(datetime.datetime.utcnow()), 'closed_at': None}
            for n in rsvp_names:
                fake.rsvps[(eid, n.lower())] = {'player_key': n.lower(), 'name': n, 'turma_player_id': pl[n]['id'], 'user_id': pl[n].get('user_id'), 'status': 'vou', 'source': 'adm', 'outcome': None, 'invited_by': None, 'created_at': iso(datetime.datetime.utcnow())}
            if guest: fake.rsvps[(eid, 'convidado')] = {'player_key': 'convidado', 'name': 'Convidado', 'turma_player_id': None, 'user_id': None, 'status': 'vou', 'source': 'adm', 'outcome': None, 'invited_by': 'Gabriel Marini', 'created_at': iso(datetime.datetime.utcnow())}
        tomorrow = datetime.datetime.utcnow() + datetime.timedelta(days=1)
        mkevent('ev-main', tomorrow, NAMES)                                   # 9 da turma + 1 convidado = 10 confirmados
        mkevent('ev-few', tomorrow + datetime.timedelta(days=1), NAMES[:3], guest=False)   # só 3 confirmados
        for pg in (a, m, k):
            await pg.evaluate("pullCloud(true)"); await pg.wait_for_timeout(900); await pg.evaluate("loadEvents(true)"); await pg.wait_for_timeout(900)
            await pg.evaluate("switchTab('inicio')"); await pg.wait_for_timeout(1500)
        # ---- Início: chip só na lista com 4+ confirmados
        await a.screenshot(path=f'{OUT}/inicio_chip.png')
        chips = await a.evaluate("[...document.querySelectorAll('#home-events .prop-chip')].map(c => c.innerText.trim())")
        if len(chips) != 1 or '33 palpites abertos' not in chips[0]: bad.append('chip do Início: ' + str(chips))
        cards = await a.evaluate("document.querySelectorAll('#home-events .card').length")
        if cards < 2: bad.append('esperava 2 cards de lista, vieram %s' % cards)
        # ---- chip leva à seção Palpites da Lojinha
        await a.click('#home-events .prop-chip'); await a.wait_for_timeout(1500)
        if not await vis(a, '#tab-content-loja') or not await vis(a, '#shop-palpites'): bad.append('chip não levou à seção Palpites')
        await a.screenshot(path=f'{OUT}/palpites.png')
        nblocks = await a.locator('[data-prop-player]').count()
        if nblocks != 9: bad.append('blocos de atleta: %d' % nblocks)
        g = block(a, 'Gabriel Marini')
        rows = await g.locator('[data-market]').count()
        if rows != 3: bad.append('Gabriel deveria ter 3 linhas à vista, tem %d' % rows)
        if await g.locator('button:has-text("ver mais")').count() != 0 or 'Cravada' in await g.inner_text(): bad.append('cravada de gols em si mesmo deveria sumir (Gabriel é o adm)')
        z = block(a, 'Zé Goleiro')
        if not (await z.locator('[data-market]').count() == 1 and 'Defesas' in await z.inner_text() and await z.locator('button:has-text("ver mais")').count() == 0): bad.append('goleiro: só Defesas')
        txt = await g.inner_text()
        if 'Mais 1,5 · 1,68' not in txt or 'Menos 1,5 · 1,94' not in txt: bad.append('botões Mais/Menos: ' + txt.replace('\n', ' | '))
        cv = block(a, 'Caio')
        await cv.locator('button:has-text("ver mais")').click(); await a.wait_for_timeout(200)
        if await cv.locator('button:has-text("5,60")').count() != 1 or 'Cravada de gols' not in await cv.inner_text(): bad.append('cravada de 3 gols a 5,60 em "ver mais" (nos outros atletas)')
        await cv.locator('button:has-text("ver menos")').click()
        # ---- 3 toques: mercado -> valor -> confirmar
        taps = 0
        await g.locator('[data-market]').first.locator('button:has-text("Mais 1,5")').click(); taps += 1; await a.wait_for_timeout(300)
        if '1.000' not in await text(a, '#pb-balance') and '1000' not in await text(a, '#pb-balance'): bad.append('bilhete deveria mostrar o saldo todo: ' + await text(a, '#pb-balance'))
        if await a.evaluate("[document.getElementById('pb-range').min, document.getElementById('pb-range').max].join('-')") != '10-1000': bad.append('barra deveria ir de 10 até o saldo (1000)')
        await a.screenshot(path=f'{OUT}/bilhete.png')
        await a.locator('#pb-range').fill('50'); taps += 1; await a.wait_for_timeout(150)
        if 'Volta 84 pts' not in await text(a, '#pb-return'): bad.append('retorno: ' + await text(a, '#pb-return'))
        await a.click('#btn-pbilhete'); taps += 1; await a.wait_for_timeout(1200)
        if taps != 3: bad.append('toques')
        if (await text(a, '#shop-balance')).strip() != '950': bad.append('saldo não caiu na hora: ' + await text(a, '#shop-balance'))
        sec = await text(a, '#shop-palpites')
        if 'meus palpites' not in sec.lower() or 'Aberto' not in sec or 'volta 84' not in sec: bad.append('meus palpites aberto: ' + sec[:400].replace('\n', ' | '))
        await a.screenshot(path=f'{OUT}/palpite_feito.png')
        if fake.pbets[0]['odd'] != 1.68 or fake.pbets[0]['stake'] != 50: bad.append('palpite no servidor')
        # ---- qualquer um escolhe a linha; só o adm vê Suspender
        if await a.locator('button:has-text("Suspender")').count() < 1: bad.append('adm sem Suspender')
        c = block(a, 'Caio').locator('[data-market]').first
        await c.locator('button[aria-label="Linha maior"]').click(); await a.wait_for_timeout(400)
        if 'Mais 2,5 · 3,34' not in await block(a, 'Caio').inner_text() or 'Menos 2,5 · 1,23' not in await block(a, 'Caio').inner_text(): bad.append('escolher linha 2,5: Mais 3,34 / Menos 1,23: ' + (await block(a, 'Caio').inner_text()).replace('\n', ' | '))
        await c.locator('button[aria-label="Linha maior"]').click(); await a.wait_for_timeout(200)
        if await c.locator('button[aria-label="Linha maior"]').is_enabled(): bad.append('a escada deveria acabar na linha 3,5')
        if 'Menos 3,5' not in await c.inner_text() or await c.locator('button:has-text("Menos 3,5")').is_enabled(): bad.append('Menos 3,5 (quase certo) deveria estar indisponível')
        await c.locator('button:has-text("Mais 3,5")').click(); await a.wait_for_timeout(300)
        if 'x9' not in (await text(a, '#pb-odd')).replace(',', '') and 'Mais 3,5' not in await text(a, '#pb-label'): bad.append('bilhete da linha 3,5')
        await a.locator('#pb-range').fill('100'); await a.locator('button:has-text("Tudo")').click(); await a.wait_for_timeout(150)
        if '950' not in await text(a, '#pb-stake'): bad.append('"Tudo" deveria pôr o saldo todo (950): ' + await text(a, '#pb-stake'))
        await a.evaluate("closeBilhete()")
        if await g.locator('[data-market]').first.locator('button[aria-label="Linha maior"]').count() != 0: bad.append('mercado com palpite ainda deixa mover a linha')
        # ---- membro comum: sem controles de adm; Menos em si mesmo bloqueado
        await m.evaluate("switchTab('loja')"); await m.wait_for_timeout(1800)
        if not await vis(m, '#shop-palpites'): bad.append('Bezão não vê a seção')
        if await m.locator('button:has-text("Suspender")').count() != 0 : bad.append('controles de adm aparecem para membro')
        be = block(m, 'Bezão').locator('[data-market]').first
        if not await be.locator('button:has-text("Menos")').is_disabled(): bad.append('Menos em si mesmo deveria estar desabilitado')
        await block(m, 'Duda').locator('[data-market]').first.locator('button:has-text("Menos")').click(); await m.wait_for_timeout(300)
        await m.locator('#pb-range').fill('30'); await m.click('#btn-pbilhete'); await m.wait_for_timeout(1000)
        if (await text(m, '#shop-balance')).strip() != '970': bad.append('saldo do Bezão: ' + await text(m, '#shop-balance'))
        err = await m.evaluate("(() => { let r = null; return api.placePropBet(Object.values(propCache.get(propEventId).markets).find(x => x.player === 'Bezão').id, 'menos', 10).then(() => 'sem erro', e => e.message); })()")
        if 'self_under' not in err: bad.append('self_under: ' + err)
        await m.screenshot(path=f'{OUT}/membro.png')
        # ---- menor de idade vê, mas não palpita
        await k.evaluate("switchTab('loja')"); await k.wait_for_timeout(1800)
        await k.screenshot(path=f'{OUT}/menor.png')
        if not await vis(k, '#shop-palpites'): bad.append('menor não vê os mercados')
        if not await k.locator('[data-prop-player] button.prop-btn').first.is_disabled(): bad.append('menor consegue tocar nos botões')
        if '18' not in await text(k, '#shop-palpites'): bad.append('aviso de 18 anos')
        # ---- trava: horário da lista passou
        fake.events['ev-main']['starts_at'] = iso(datetime.datetime.utcnow() - datetime.timedelta(minutes=2))
        await a.evaluate("loadProp(true)"); await a.wait_for_timeout(900)
        locked_btns = await a.locator('[data-prop-player] button:has-text("Palpites encerrados")').count()
        if locked_btns != 25: bad.append('botões "Palpites encerrados": %d' % locked_btns)
        if await a.locator('[data-prop-player] button.prop-btn:not([disabled])').count() != 0: bad.append('botões habilitados depois da trava')
        if 'Travado' not in await text(a, '#shop-palpites'): bad.append('estado Travado')
        await a.screenshot(path=f'{OUT}/travado.png')
        # ---- liquidação: o baba ligado é finalizado. Gabriel fez 2 gols; Duda não apareceu.
        bid = 'baba-hoje'
        fake.babas[bid] = {'id': bid, 'created_by': adm, 'turma_ids': [tid], 'title': 'hoje', 'played_on': today.isoformat(), 'finished': True, 'matches': 4, 'state': {}, 'event_id': 'ev-main', 'updated': 99}
        fake.stats[bid] = [{'baba_id': bid, 'turma_player_id': pl[n]['id'], 'name': n, 'goals': 2 if n == 'Gabriel Marini' else 0, 'assists': 0, 'saves': 5 if n == 'Zé Goleiro' else 0, 'matches': 4, 'wins': 1} for n in NAMES if n != 'Duda']
        await a.evaluate("loadProp(true)"); await a.wait_for_timeout(900)
        sec = await text(a, '#shop-palpites')
        if 'Ganhou +84' not in sec: bad.append('palpite ganhou +84: ' + sec[:300].replace('\n', ' | '))
        if (await text(a, '#shop-balance')).strip().replace('.', '') != '1034':
            await a.evaluate("refreshWallet()"); await a.wait_for_timeout(400)
            if (await text(a, '#shop-balance')).strip().replace('.', '') != '1034': bad.append('saldo depois de ganhar: ' + await text(a, '#shop-balance'))
        await a.screenshot(path=f'{OUT}/liquidado.png')
        await m.evaluate("loadProp(true)"); await m.wait_for_timeout(900)
        ms = await text(m, '#shop-palpites')
        if 'Devolvido' not in ms: bad.append('Bezão: palpite em atleta ausente deveria aparecer como Devolvido')
        await m.evaluate("refreshWallet()"); await m.wait_for_timeout(400)
        if (await text(m, '#shop-balance')).strip().replace('.', '') != '1000': bad.append('Bezão: pontos devolvidos: ' + await text(m, '#shop-balance'))
        await a.evaluate("loadLedger()"); await a.wait_for_timeout(500)
        if 'Palpite pré-jogo certo' not in await text(a, '#shop-ledger') or 'Palpite pré-jogo' not in await text(a, '#shop-ledger'): bad.append('extrato com os motivos novos')
        # adm vê o extrato do evento com a marca de quem registra os lances
        await a.locator('button:has-text("Palpites da turma neste baba")').click(); await a.wait_for_timeout(500)
        if 'registra os lances' not in await text(a, '#shop-palpites'): bad.append('marca "registra os lances" no extrato do adm')
        # ---- textos proibidos em todas as telas visitadas
        for name, pg in (('adm', a), ('membro', m), ('menor', k)):
            for tab in ('inicio', 'loja'):
                await pg.evaluate(f"switchTab('{tab}')"); await pg.wait_for_timeout(500)
                body = await pg.evaluate("document.body.innerText")
                if re.search(r'\baposta|\bodds?\b', body, re.I): bad.append(f'palavra proibida em {name}/{tab}')
        # ---- baba ligado à lista do dia (Turmas → Lista)
        fake.events['ev-main']['starts_at'] = iso(datetime.datetime.utcnow() - datetime.timedelta(days=2))
        late = datetime.datetime.now().replace(hour=23, minute=59, second=0, microsecond=0)
        fake.events['ev-hoje'] = {'id': 'ev-hoje', 'turma_id': tid, 'created_by': adm, 'starts_at': iso(late.astimezone(datetime.timezone.utc).replace(tzinfo=None)) if late.tzinfo else iso(datetime.datetime.utcfromtimestamp(late.timestamp())), 'place': 'Quadra', 'note': None, 'max_players': None, 'status': 'open', 'created_at': iso(datetime.datetime.utcnow()), 'closed_at': None}
        await a.evaluate("loadEvents(true)"); await a.wait_for_timeout(900)
        await a.evaluate(f"""() => {{ state.selectedTeams = ['{tid}']; syncPool(); const p = state.players.find(x => x.name === 'Caio'); p.present = true; p.arrival = 1; commit('x'); }}""")
        await a.wait_for_timeout(2500)
        sb = [x for x in fake.babas.values() if not x.get('finished') and x['created_by'] == adm]
        if not sb or sb[0].get('event_id') != 'ev-hoje': bad.append('baba não ficou ligado à lista de hoje: ' + str([x.get('event_id') for x in sb]))
        await a.evaluate("switchTab('ficha')"); await a.wait_for_timeout(500)
        if not await vis(a, '#list-event-link') or 'Baba ligado à lista' not in await text(a, '#list-event-link'): bad.append('marca do baba ligado na Lista')
        await a.screenshot(path=f'{OUT}/lista_ligada.png')
        # ---- servidor sem a v11.4: nada quebra
        fake.v114_enabled = False
        await a.evaluate("propOff = null; propCountsAt = 0; propCache.clear(); propCounts = {}; switchTab('loja')"); await a.wait_for_timeout(1500)
        if await vis(a, '#shop-palpites'): bad.append('seção deveria sumir com servidor antigo')
        for pg in (a, m, k):
            if pg.errs: bad.append('erros de página: ' + str(pg.errs[:3]))
        await b.close()
    print(json.dumps({'problems': bad}, ensure_ascii=False))
asyncio.run(main())
