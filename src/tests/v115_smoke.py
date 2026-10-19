# v11.5 smoke: aba Resenha (antiga Lojinha) com Palpites no topo, sub-abas Palpites/Ranking, blocos Duelos / Destaque do dia /
# Total do baba, bilhete de 3 toques nos tipos novos, self_against, ranking de palpiteiros e troféus no Perfil e no card.
import sys, asyncio, json, os, datetime, re, math
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read(); fake = Fake()
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/v115'
os.makedirs(OUT, exist_ok=True)
URL = 'http://localhost:8765/'
bad = []
NAMES = ['Gabriel Marini', 'Bezão', 'Caio', 'Duda', 'Thiago', 'Kauã', 'Léo', 'Igor', 'Zé Goleiro', 'Beto Goleiro']
KEEPERS = ['Zé Goleiro', 'Beto Goleiro']
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
async def text(pg, sel): return await pg.evaluate(f"(document.querySelector('{sel}')||{{}}).innerText||''")
async def main():
    fake._v8init(); fake._evinit(); fake._pinit(); fake._tminit(); fake.v115_enabled = True
    async with async_playwright() as p:
        b = await p.chromium.launch()
        async def ctxpg():
            ctx = await b.new_context(viewport={'width': 390, 'height': 844})
            await ctx.expose_function('fakeCall', lambda n, t, a: fake.handle(n, t, a)); await ctx.add_init_script(FAKE_JS)
            pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.errs = errs; return pg
        a = await ctxpg(); await signup(a, 'Gabriel Marini', 'adm@t.dev')
        tid = await a.evaluate("""async ([names, keepers]) => { const id = crypto.randomUUID(); await api.upsertTurma(id, 'FutHeavenly', 'FUTH1234');
          state.turmas.push({ id, name: 'FutHeavenly', cloud: true, role: 'owner', invite: 'FUTH1234', players: names, keepers, women: [], meta: {} });
          await syncTurmaNow(id); return id; }""", [NAMES, KEEPERS])
        adm = fake.users['adm@t.dev']['id']
        m = await ctxpg(); await signup(m, 'Bezão', 'bez@t.dev'); mem = fake.users['bez@t.dev']['id']
        fake.members[(tid, mem)] = 'member'
        pl = {x['name']: x for x in fake.players.values() if x['turma_id'] == tid}
        pl['Gabriel Marini']['user_id'] = adm; pl['Bezão']['user_id'] = mem
        # histórico: 10 babas; partidas variam (3 a 5) e um convidado faz i gols, para o Total do baba ter linha.
        # O Gabriel faz 4 gols (os outros 3): fica com o maior λ e sempre entra no 1º duelo.
        today = datetime.date.today()
        for i in range(10):
            bid = f'hist-{i}'
            fake.babas[bid] = {'id': bid, 'created_by': adm, 'turma_ids': [tid], 'title': 'h', 'played_on': (today - datetime.timedelta(days=7 * (i + 1))).isoformat(), 'finished': True, 'matches': 3 + i % 3, 'state': {}, 'updated': i}
            fake.stats[bid] = [{'baba_id': bid, 'turma_player_id': pl[n]['id'], 'name': n, 'goals': 0 if n in KEEPERS else 4 if n == 'Gabriel Marini' else 3, 'assists': 0 if n in KEEPERS else 1,
                                'saves': 6 if n in KEEPERS else 0, 'matches': 5, 'wins': 2} for n in NAMES] + [{'baba_id': bid, 'turma_player_id': None, 'name': 'Convidado', 'goals': i, 'assists': 0, 'saves': 0, 'matches': 5, 'wins': 2}]
        def mkevent(eid, starts, rsvp_names):
            fake.events[eid] = {'id': eid, 'turma_id': tid, 'created_by': adm, 'starts_at': iso(starts), 'place': 'Quadra', 'note': None, 'max_players': None, 'status': 'open', 'created_at': iso(datetime.datetime.utcnow()), 'closed_at': None}
            for n in rsvp_names:
                fake.rsvps[(eid, n.lower())] = {'player_key': n.lower(), 'name': n, 'turma_player_id': pl[n]['id'], 'user_id': pl[n].get('user_id'), 'status': 'vou', 'source': 'adm', 'outcome': None, 'invited_by': None, 'created_at': iso(datetime.datetime.utcnow())}
        tomorrow = datetime.datetime.utcnow() + datetime.timedelta(days=1)
        mkevent('ev-main', tomorrow, NAMES)
        mkevent('ev-few', tomorrow + datetime.timedelta(days=1), NAMES[:3])
        for pg in (a, m):
            await pg.evaluate("pullCloud(true)"); await pg.wait_for_timeout(900); await pg.evaluate("loadEvents(true)"); await pg.wait_for_timeout(900)
            await pg.evaluate("switchTab('inicio')"); await pg.wait_for_timeout(1500)
        # ---- aba Resenha: nome na barra, título e nada mais chamando a aba de Lojinha
        if 'Resenha' not in (await text(a, '#tab-nav-loja')) or '😜' not in (await text(a, '#tab-nav-loja')): bad.append('rótulo da aba: ' + await text(a, '#tab-nav-loja'))
        home = await text(a, '#tab-content-inicio')
        if 'Lojinha' in home: bad.append('Início ainda cita a Lojinha: ' + home[home.index('Lojinha') - 60:home.index('Lojinha') + 20])
        # ---- chip leva aos Palpites, agora na Resenha
        chips = await a.evaluate("[...document.querySelectorAll('#home-events .prop-chip')].map(c => c.innerText.trim())")
        if len(chips) != 1: bad.append('chip do Início: ' + str(chips))
        await a.click('#home-events .prop-chip'); await a.wait_for_timeout(1600)
        if not await vis(a, '#tab-content-loja') or not await vis(a, '#shop-palpites'): bad.append('chip não levou aos Palpites da Resenha')
        if (await text(a, '#tab-content-loja h2')).strip() != 'Resenha': bad.append('título da tela: ' + await text(a, '#tab-content-loja h2'))
        order = await a.evaluate("""(() => { const ids = ['shop-palpites', 'shop-missions', 'shop-lojinha-title', 'shop-items', 'shop-ledger'].map(i => document.getElementById(i));
          return ids.every(Boolean) && ids.every((el, i) => i === 0 || (ids[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)); })()""")
        if not order: bad.append('ordem da Resenha: Palpites, missões, Lojinha')
        if 'Lojinha do Babinha' not in await text(a, '#shop-lojinha-title'): bad.append('o catálogo continua se chamando Lojinha')
        sub = await a.evaluate("[...document.querySelectorAll('#prop-subtabs button')].map(x => x.innerText.trim())")
        if sub != ['Palpites', 'Ranking']: bad.append('sub-abas: ' + str(sub))
        await a.screenshot(path=f'{OUT}/resenha_topo.png')
        # ---- blocos novos
        for blk in ('duelos', 'destaque', 'total'):
            if await a.locator(f'[data-prop-block="{blk}"]').count() != 1: bad.append('bloco ausente: ' + blk)
        nduel = await a.locator('[data-kind="duel"]').count()
        if nduel != 3: bad.append('duelos: %d' % nduel)
        nlead = await a.locator('[data-kind="leader"]').count()
        if nlead != 3: bad.append('destaques (Artilheiro, Garçom, Paredão): %d' % nlead)
        if await a.locator('[data-kind="baba_total"]').count() != 2: bad.append('Total do baba: 2 linhas Mais/Menos')
        dtxt = await a.locator('[data-prop-block="duelos"]').inner_text()
        if '1,80' not in dtxt: bad.append('duelo entre atletas iguais deveria pagar 1,80: ' + dtxt[:200].replace('\n', ' | '))
        art = a.locator('[data-kind="leader"]').filter(has_text='Artilheiro')
        nshown = await art.locator('button.prop-btn').count()
        if nshown != 6 or await art.locator('button:has-text("ver todos (8)")').count() != 1: bad.append('Artilheiro: 6 à vista e "ver todos": %d' % nshown)
        await art.locator('button:has-text("ver todos")').click(); await a.wait_for_timeout(200)
        if await a.locator('[data-kind="leader"]').filter(has_text='Artilheiro').locator('button.prop-btn').count() != 8: bad.append('ver todos no Artilheiro')
        par = await a.locator('[data-kind="leader"]').filter(has_text='Paredão').inner_text()
        if 'Zé Goleiro' not in par or 'Beto Goleiro' not in par or 'Caio' in par: bad.append('Paredão: só goleiros')
        await a.locator('[data-prop-block="duelos"]').scroll_into_view_if_needed()
        await a.screenshot(path=f'{OUT}/blocos.png', full_page=False)
        await a.evaluate("document.querySelector('[data-prop-block=\"destaque\"]').scrollIntoView()"); await a.wait_for_timeout(200)
        await a.screenshot(path=f'{OUT}/destaque_total.png')
        # self_against: o duelo do Gabriel tem o botão do adversário desligado
        gd = a.locator('[data-kind="duel"]').filter(has_text='Gabriel Marini')
        if await gd.count() == 1:
            btns = gd.locator('button.prop-btn')
            states = [await btns.nth(i).is_disabled() for i in range(await btns.count())]
            names = [await btns.nth(i).inner_text() for i in range(await btns.count())]
            if sum(states) != 1 or 'Gabriel' in names[[i for i, s in enumerate(states) if s][0]]: bad.append('self_against na tela: ' + str(list(zip(names, states))))
            mk = next(x for x in fake.pmk.values() if x['kind'] == 'duel' and pl['Gabriel Marini']['id'] in (x['player_id'], x['player2_id']))
            other = mk['player2_id'] if mk['player_id'] == pl['Gabriel Marini']['id'] else mk['player_id']
            err = await a.evaluate(f"api.placePropBet('{mk['id']}', '{other}', 10).then(() => 'sem erro', e => e.message)")
            if 'self_against' not in err: bad.append('self_against no servidor: ' + err)
        else: bad.append('Gabriel deveria estar num duelo')
        # ---- 3 toques num duelo (membro): opção -> valor -> confirmar; saldo cai na hora
        await m.evaluate("switchTab('loja')"); await m.wait_for_timeout(1800)
        d1 = m.locator('[data-kind="duel"]').filter(has_not_text='Gabriel').filter(has_not_text='Bezão').first
        taps = 0
        await d1.locator('button.prop-btn').first.click(); taps += 1; await m.wait_for_timeout(300)
        if 'Duelo' not in await text(m, '#pb-player'): bad.append('bilhete do duelo: ' + await text(m, '#pb-player'))
        if 'Empate devolve' not in await text(m, '#pb-note'): bad.append('nota do duelo no bilhete')
        await m.screenshot(path=f'{OUT}/bilhete_duelo.png')
        await m.locator('#pb-range').fill('50'); taps += 1; await m.wait_for_timeout(150)
        if 'Volta 90 pts' not in await text(m, '#pb-return'): bad.append('retorno do duelo: ' + await text(m, '#pb-return'))
        await m.click('#btn-pbilhete'); taps += 1; await m.wait_for_timeout(1200)
        if taps != 3 or (await text(m, '#shop-balance')).strip() != '950' or (await text(m, '#resenha-balance')).strip() != '950': bad.append('duelo: saldo depois do palpite: ' + await text(m, '#resenha-balance'))
        # Destaque e Total também em 3 toques
        for kind, label in (('leader', 'Artilheiro'), ('baba_total', 'Gols no dia')):
            card = m.locator(f'[data-kind="{kind}"]').filter(has_text=label).first
            await card.locator('button.prop-btn').first.click(); await m.wait_for_timeout(300)
            await m.locator('#pb-range').fill('20'); await m.click('#btn-pbilhete'); await m.wait_for_timeout(1100)
        if (await text(m, '#resenha-balance')).strip() != '910': bad.append('saldo depois de 3 palpites novos: ' + await text(m, '#resenha-balance'))
        sec = await text(m, '#shop-palpites')
        if 'Artilheiro do dia' not in sec or 'Total do baba · Gols no dia' not in sec or 'Duelo ' not in sec: bad.append('meus palpites com os tipos novos: ' + sec[:500].replace('\n', ' | '))
        if await m.locator('button:has-text("Suspender")').count() != 0: bad.append('membro vê Suspender')
        await m.screenshot(path=f'{OUT}/membro_palpites.png')
        # ---- adm: move a linha do Total (sem palpite) e suspende um Destaque
        tp = a.locator('[data-kind="baba_total"]').filter(has_text='Partidas no dia')
        before = await tp.inner_text()
        await tp.locator('button[aria-label="Linha maior"]').click(); await a.wait_for_timeout(900)
        after = await a.locator('[data-kind="baba_total"]').filter(has_text='Partidas no dia').inner_text()
        if before == after or 'linha ajustada' not in after: bad.append('mover a linha do Total: ' + after.replace('\n', ' | '))
        if await a.locator('[data-kind="baba_total"]').filter(has_text='Gols no dia').locator('button[aria-label="Linha maior"]').count() != 0: bad.append('Total com palpite não deixa mover a linha')
        await a.evaluate("setTimeout(() => propSuspend(document.querySelector('[data-kind=\"leader\"]').dataset.market2), 0)"); await a.wait_for_timeout(300)
        await a.click('#modal-confirm-ok'); await a.wait_for_timeout(1200)
        if 'Suspenso pelo adm' not in await a.locator('[data-kind="leader"]').first.inner_text(): bad.append('suspender destaque')
        # ---- liquidação dos tipos novos: o baba ligado é finalizado
        bid = 'baba-hoje'
        fake.events['ev-main']['starts_at'] = iso(datetime.datetime.utcnow() - datetime.timedelta(minutes=5))
        fake.babas[bid] = {'id': bid, 'created_by': adm, 'turma_ids': [tid], 'title': 'hoje', 'played_on': today.isoformat(), 'finished': True, 'matches': 4, 'state': {}, 'event_id': 'ev-main', 'updated': 99}
        fake.stats[bid] = [{'baba_id': bid, 'turma_player_id': pl[n]['id'], 'name': n, 'goals': 1 if n not in KEEPERS else 0, 'assists': 0, 'saves': 3 if n in KEEPERS else 0, 'matches': 4, 'wins': 1} for n in NAMES]
        await m.evaluate("loadProp(true)"); await m.wait_for_timeout(1000)
        ms = await text(m, '#shop-palpites')
        if 'Empate 1 x 1' not in ms: bad.append('duelo empatado aparece como devolvido: ' + ms[:400].replace('\n', ' | '))
        if 'Devolvido' not in ms: bad.append('palpite do duelo empatado: Devolvido')
        await m.screenshot(path=f'{OUT}/liquidado.png')
        # ---- lista sem mercados: blocos não aparecem nem ficam vazios
        await m.evaluate("propChoose('ev-few')"); await m.wait_for_timeout(900)
        if await m.locator('[data-prop-block]').count() != 0: bad.append('blocos novos numa lista sem mercados')
        if '4 confirmados' not in await text(m, '#shop-palpites'): bad.append('aviso de 4 confirmados')
        # ---- Ranking: colunas, seletor de temporada e "Você tem X de 10"
        await m.click('#prop-subtabs button:has-text("Ranking")'); await m.wait_for_timeout(1200)
        rk = await text(m, '#prop-rank')
        if 'Você tem' not in rk or 'de 10 palpites para entrar no ranking' not in rk: bad.append('mensagem de quem ainda não entrou: ' + rk[:300].replace('\n', ' | '))
        if 'Temporada atual' not in rk: bad.append('seletor de temporada')
        # 12 palpites resolvidos do Gabriel e 10 do Bezão numa lista antiga (temporada atual)
        mkevent('ev-old', datetime.datetime.utcnow() - datetime.timedelta(days=1), [])
        fake.events['ev-old']['status'] = 'done'
        for i in range(12):
            mid = f'rk-{i}'
            fake.pmk[mid] = {'id': mid, 'event_id': 'ev-old', 'turma_id': tid, 'player_id': pl[NAMES[i % 8]]['id'], 'player2_id': None, 'kind': 'exact' if i < 2 else 'ou', 'metric': 'goals', 'line': 1.5, 'selections': [],
                             'lambda': 1, 'rookie': False, 'status': 'settled', 'result': {}, 'void_reason': None, 'edited_by': None}
            fake.pbets.append({'id': 1000 + i, 'market': mid, 'user': adm, 'selection': 'mais', 'line': None, 'stake': 10, 'odd': 2, 'status': 'won' if i < 7 else 'lost', 'payout': 20 if i < 7 else 0})
            if i < 10: fake.pbets.append({'id': 2000 + i, 'market': mid, 'user': mem, 'selection': 'mais', 'line': None, 'stake': 10, 'odd': 2, 'status': 'won' if i < 4 else 'lost', 'payout': 20 if i < 4 else 0})
        await m.evaluate("propRankCache.clear(); loadPropRank(true)"); await m.wait_for_timeout(1200)
        rows = await m.evaluate("[...document.querySelectorAll('#prop-rank [data-rank-row]')].map(r => r.innerText.replace(/\\s+/g, ' ').trim())")
        if len(rows) != 2 or 'Gabriel' not in rows[0] or '+20' not in rows[0] or '7/12' not in rows[0] or 'Bezão' not in rows[1] or '−' not in rows[1]: bad.append('linhas do ranking: ' + str(rows))
        head = await m.evaluate("(document.querySelector('#prop-rank .card-flat > div') || {}).innerText || ''")
        for col in ('#', 'PESSOA', 'LUCRO', 'ROI', 'ACERTOS', 'CRAV.'):
            if col not in head.upper(): bad.append('coluna do ranking: ' + col)
        if await m.locator('[data-rank-me]').count() != 0: bad.append('quem entrou não deveria ver "Você tem X de 10"')
        await m.screenshot(path=f'{OUT}/ranking.png')
        # ---- troféus: Pé-quente e Mãe Diná no Perfil e no card
        fake.trophies.append({'turma_id': tid, 'scope': 'atleta', 'kind': 'pe_quente', 'title': 'Pé-quente da temporada', 'season': '2026-S1', 'name': 'Gabriel Marini', 'value': 350, 'user_id': adm})
        fake.trophies.append({'turma_id': tid, 'scope': 'atleta', 'kind': 'mae_dina', 'title': 'Mãe Diná da temporada', 'season': '2026-S1', 'name': 'Gabriel Marini', 'value': 3, 'user_id': adm})
        await a.evaluate("openProfile()"); await a.wait_for_timeout(1200)
        tro = await text(a, '#pf-trophies')
        if not await vis(a, '#pf-trophies-sec') or 'Pé-quente da temporada' not in tro or 'Mãe Diná da temporada' not in tro or '+350 pts de lucro' not in tro: bad.append('troféus no Perfil: ' + tro.replace('\n', ' | '))
        await a.evaluate("document.getElementById('pf-trophies-sec').scrollIntoView()"); await a.wait_for_timeout(200)
        await a.screenshot(path=f'{OUT}/perfil_trofeus.png')
        if '2 troféus' not in await text(a, '#pf-card'): bad.append('faixa de troféus no card do Perfil')
        await a.evaluate("closeProfile(); openAthleteCard(currentUser.id)"); await a.wait_for_timeout(600)
        if '2 troféus' not in await text(a, '#acard-box'): bad.append('troféus no card de atleta')
        await a.screenshot(path=f'{OUT}/card.png')
        await a.evaluate("closeAthleteCard()")
        await m.evaluate(f"openAthleteCard('{adm}', '{tid}')"); await m.wait_for_timeout(900)
        if '2 troféus' not in await text(m, '#acard-box'): bad.append('o Bezão vê os troféus no card do Gabriel')
        await m.evaluate("closeAthleteCard()")
        # prateleira da turma mostra os novos com o texto certo
        await a.evaluate(f"openTurmaHub('{tid}')"); await a.wait_for_timeout(700); await a.click('#thub-head button:has-text("Troféus")'); await a.wait_for_timeout(600)
        if 'Pé-quente da temporada' not in await text(a, '#thub-body') or '3 cravadas certas' not in await text(a, '#thub-body'): bad.append('prateleira da turma: ' + (await text(a, '#thub-body'))[:200])
        await a.evaluate("closeHub()")
        # ---- tutorial e Configurações não chamam a aba de Lojinha
        tut = await a.evaluate("JSON.stringify(TUTORIAL)")
        if 'Na Lojinha' in tut or 'baba points e lojinha' in tut.lower(): bad.append('tutorial ainda chama a aba de Lojinha')
        await a.evaluate("openSettings()"); await a.wait_for_timeout(400)
        if 'Lojinha' in await text(a, '#page-settings'): bad.append('Configurações citam a Lojinha')
        await a.evaluate("closeSettings()")
        # ---- textos proibidos
        for name, pg in (('adm', a), ('membro', m)):
            for tab in ('inicio', 'loja'):
                await pg.evaluate(f"switchTab('{tab}')"); await pg.wait_for_timeout(600)
                body = await pg.evaluate("document.body.innerText")
                if re.search(r'\baposta|\bodds?\b', body, re.I): bad.append(f'palavra proibida em {name}/{tab}')
        await m.evaluate("propSubTab('palpites')"); await m.wait_for_timeout(300)
        # ---- servidor sem a v11.5 (ranking): mensagem, sem quebrar
        fake.v115_enabled = False
        await m.evaluate("propRankCache.clear(); propRankOff = false; propSubTab('rank')"); await m.wait_for_timeout(900)
        if 'quando o servidor for atualizado' not in await text(m, '#prop-rank'): bad.append('ranking sem servidor novo')
        for pg in (a, m):
            if pg.errs: bad.append('erros de página: ' + str(pg.errs[:3]))
        await b.close()
    print(json.dumps({'problems': bad}, ensure_ascii=False))
asyncio.run(main())
