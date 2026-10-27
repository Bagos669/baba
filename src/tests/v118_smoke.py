# v11.8 smoke: Palpites em telas (Duelo por escolha, Destaque com MVP, Total com escada, Por atleta em passos com linhas abertas,
# lado quase certo travado) e "Ver meus palpites".
import sys, asyncio, json, os, datetime, re, math
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read(); fake = Fake()
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/v118'
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
    fake._v8init(); fake._evinit(); fake._pinit(); fake._tminit(); fake.v115_enabled = True; fake.v118_enabled = True
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
        def mk(kind, metric, name=None, name2=None):
            pid = pl[name]['id'] if name else None; pid2 = pl[name2]['id'] if name2 else None
            return [x for x in fake.pmk.values() if x['event_id'] == 'ev-main' and x['kind'] == kind and x['metric'] == metric and ((pid2 is None and x.get('player_id') == pid) or (pid2 is not None and {x['player_id'], x['player2_id']} == {pid, pid2}))]
        def bets(uid): return [x for x in fake.pbets if x['user'] == uid]
        async def bilhete(pg):
            await pg.wait_for_timeout(250)
            if not await vis(pg, '#modal-pbilhete'): return False
            await pg.click('#btn-pbilhete'); await pg.wait_for_timeout(1300); return True
        # ---- menu
        await a.click('#home-events .prop-chip'); await a.wait_for_timeout(1600)
        tiles = await a.evaluate("[...document.querySelectorAll('#prop-menu [data-prop-tile]')].map(x => x.dataset.propTile)")
        if tiles != ['duel', 'leader', 'total', 'athlete']: bad.append('menu: ' + str(tiles))
        if not await vis(a, '#prop-mine-btn'): bad.append('sem "Ver meus palpites"')
        if await a.locator('[data-prop-block]').count(): bad.append('menu não deveria listar os blocos (tela longa)')
        await a.screenshot(path=f'{OUT}/menu.png')

        # ---- Por atleta: jogador -> critério -> palpite (linha 10,5 aberta, lado quase certo travado)
        await a.click('[data-prop-tile="athlete"]'); await a.wait_for_timeout(300)
        await a.click(f'[data-ath="{pl["Caio"]["id"]}"]'); await a.wait_for_timeout(300)
        crits = await a.evaluate("[...document.querySelectorAll('#prop-palpites [data-prop-seg] .chip')].map(x => x.innerText.trim())")
        for c in ('Jogos ganhos', 'Gols', 'Assistências', 'G+A', 'Cravada de gols'):
            if c not in crits: bad.append('critério ausente: ' + c + ' ' + str(crits))
        await a.screenshot(path=f'{OUT}/atleta.png')
        await a.click('#prop-palpites [data-prop-seg] .chip:has-text("Gols")'); await a.wait_for_timeout(200)
        mg = mk('ou', 'goals', 'Caio')[0]
        for _ in range(12): await a.evaluate(f"propStepLine('{mg['id']}', 1)")
        await a.wait_for_timeout(200)
        btns = await a.evaluate("[...document.querySelectorAll('#prop-palpites .prop-btn')].map(x => [x.innerText.trim(), x.disabled])")
        if not any('Mais 10,5' in t and '20,00' in t and not d for t, d in btns): bad.append('Mais 10,5 aberto pagando 20: ' + str(btns))
        if not any('Menos 10,5' in t and 'travado' in t and d for t, d in btns): bad.append('Menos 10,5 travado (quase certo): ' + str(btns))
        await a.screenshot(path=f'{OUT}/atleta_linha_alta.png')
        await a.click('#prop-palpites .prop-btn:has-text("Mais 10,5")')
        if not await bilhete(a): bad.append('bilhete do atleta não abriu')
        bt = [x for x in bets(adm) if x['market'] == mg['id']]
        if not bt or bt[0]['line'] != 10.5 or bt[0]['odd'] != 20.0: bad.append('palpite na linha 10,5: ' + str(bt))
        # jogos ganhos também
        await a.click('#prop-palpites [data-prop-seg] .chip:has-text("Jogos ganhos")'); await a.wait_for_timeout(200)
        if 'Jogos ganhos' not in await text(a, '#prop-palpites') or not await a.locator('#prop-palpites .prop-btn:not([disabled])').count(): bad.append('jogos ganhos sem palpite aberto')

        # ---- o próprio atleta: sem cravada e sem Menos
        await m.evaluate("switchTab('loja'); propGo('athlete')"); await m.wait_for_timeout(1500)
        await m.evaluate(f"propAthPick('{pl['Bezão']['id']}')"); await m.wait_for_timeout(300)
        mc = await m.evaluate("[...document.querySelectorAll('#prop-palpites [data-prop-seg] .chip')].map(x => x.innerText.trim())")
        if 'Cravada de gols' in mc: bad.append('cravada em si mesmo apareceu')
        mb = await m.evaluate("[...document.querySelectorAll('#prop-palpites .prop-btn')].map(x => [x.innerText.trim(), x.disabled])")
        if not any(t.startswith('Menos') and d for t, d in mb): bad.append('Menos em si mesmo deveria estar travado: ' + str(mb))

        # ---- Duelo: dois atletas -> critério -> cotações -> palpite
        await a.evaluate("propGo('home')"); await a.wait_for_timeout(200)
        await a.click('[data-prop-tile="duel"]'); await a.wait_for_timeout(300)
        await a.click(f'#prop-duel-pick [data-ath="{pl["Caio"]["id"]}"]'); await a.click(f'#prop-duel-pick [data-ath="{pl["Duda"]["id"]}"]'); await a.wait_for_timeout(200)
        await a.click('#prop-palpites [data-prop-seg] .chip:has-text("Gols")'); await a.wait_for_timeout(200)
        await a.screenshot(path=f'{OUT}/duelo_escolha.png')
        await a.click('#prop-duel-go'); await a.wait_for_timeout(1500)
        d1 = mk('duel', 'goals', 'Caio', 'Duda')
        if len(d1) != 1: bad.append('duelo Caio x Duda (gols) não foi criado: %d' % len(d1))
        card = await text(a, '[data-kind="duel"]')
        if 'Caio' not in card or 'Duda' not in card or 'gols' not in card.lower(): bad.append('cartão do duelo: ' + card.replace('\n', ' | '))
        await a.screenshot(path=f'{OUT}/duelo_cotacoes.png')
        await a.click('[data-kind="duel"] .prop-btn >> nth=0')
        if not await bilhete(a): bad.append('bilhete do duelo não abriu')
        if not [x for x in bets(adm) if d1 and x['market'] == d1[0]['id']]: bad.append('palpite no duelo não gravou')
        # mesmo par na ordem inversa = mesmo duelo
        await a.evaluate(f"propNav.pick = ['{pl['Duda']['id']}', '{pl['Caio']['id']}']; propNav.metric = 'goals'; propNav.market = null; renderPropSection()")
        await a.click('#prop-duel-go'); await a.wait_for_timeout(1300)
        if len(mk('duel', 'goals', 'Caio', 'Duda')) != 1: bad.append('mesmo par virou outro duelo')

        # ---- Destaque: abas, MVP
        await a.evaluate("propGo('home')"); await a.click('[data-prop-tile="leader"]'); await a.wait_for_timeout(300)
        tabs = await a.evaluate("[...document.querySelectorAll('#prop-palpites [data-prop-seg] .chip')].map(x => x.innerText.trim())")
        if tabs != ['Artilheiro', 'Garçom', 'MVP', 'Paredão']: bad.append('abas do Destaque: ' + str(tabs))
        await a.click('#prop-palpites [data-prop-seg] .chip:has-text("MVP")'); await a.wait_for_timeout(200)
        if await a.locator('[data-kind="leader"]').count() != 1 or 'MVP' not in await text(a, '[data-kind="leader"]'): bad.append('Destaque mostra um de cada vez (MVP)')
        await a.click('[data-kind="leader"] .prop-btn:not([disabled]) >> nth=1')
        if not await bilhete(a): bad.append('bilhete do MVP não abriu')
        if not [x for x in bets(adm) if fake.pmk[x['market']]['kind'] == 'leader' and fake.pmk[x['market']]['metric'] == 'mvp']: bad.append('palpite no MVP não gravou')
        await a.screenshot(path=f'{OUT}/destaque_mvp.png')

        # ---- Total: Gols no dia com escada até 60,5
        await a.evaluate("propGo('home')"); await a.click('[data-prop-tile="total"]'); await a.wait_for_timeout(300)
        await a.click('#prop-palpites [data-prop-seg] .chip:has-text("Gols no dia")'); await a.wait_for_timeout(200)
        tg = mk('baba_total', 'goals')[0]
        n_lad = await a.evaluate(f"propCache.get(propEventId).markets.find(x => x.id === '{tg['id']}').ladder.length")
        if n_lad != 61: bad.append('escada do total de gols: %s' % n_lad)
        for _ in range(70): await a.evaluate(f"propStepLine('{tg['id']}', 1)")
        await a.wait_for_timeout(200)
        if 'Linha 60,5' not in (await text(a, '[data-kind="baba_total"]')).replace('\n', ' '): bad.append('total chega até 60,5: ' + (await text(a, '[data-kind="baba_total"]')).replace('\n', ' | '))
        for _ in range(30): await a.evaluate(f"propStepLine('{tg['id']}', -1)")
        await a.wait_for_timeout(200)
        await a.screenshot(path=f'{OUT}/total.png')
        await a.click('[data-kind="baba_total"] .prop-btn:not([disabled]) >> nth=0')
        if not await bilhete(a): bad.append('bilhete do total não abriu')
        tb = [x for x in bets(adm) if x['market'] == tg['id']]
        if not tb or tb[0]['line'] != 30.5: bad.append('palpite do total com a linha escolhida (30,5): ' + str(tb))

        # ---- Ver meus palpites
        await a.evaluate("propGo('home')"); await a.click('#prop-mine-btn'); await a.wait_for_timeout(1200)
        rows = await a.evaluate("[...document.querySelectorAll('#prop-mine-list [data-mine-row]')].map(x => x.innerText.replace(/\\n/g, ' '))")
        if len(rows) != len(bets(adm)) or len(rows) < 4: bad.append('meus palpites: %d linhas, %d palpites' % (len(rows), len(bets(adm))))
        joined = ' | '.join(rows)
        for t in ('Caio · Mais 10,5 gols', '(gols) · ', 'MVP ·', 'Gols no dia · Mais 30,5'):
            if t not in joined: bad.append('meus palpites sem: ' + t + ' => ' + joined[:400])
        await a.screenshot(path=f'{OUT}/meus_palpites.png')
        await a.click('#prop-palpites button[aria-label="Voltar para os palpites"]'); await a.wait_for_timeout(200)
        if not await vis(a, '#prop-menu'): bad.append('voltar não leva ao menu')
        # ---- bug dos cards repetidos: babas de ontem vazios (0 partidas, 0 gols) não viram card; com partida, vira
        ontem = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
        for k in ('vazio-1', 'vazio-2'):
            fake.babas[k] = {'id': k, 'created_by': adm, 'turma_ids': [tid], 'title': 'FutHeavenly', 'played_on': ontem, 'finished': False, 'matches': 0, 'rev': 1,
                             'state': {'players': [], 'matchHistory': [], 'match': {'scoreA': 0, 'scoreB': 0, 'events': []}}, 'updated': 99}
        fake.babas['cheio'] = {'id': 'cheio', 'created_by': adm, 'turma_ids': [tid], 'title': 'FutHeavenly', 'played_on': ontem, 'finished': False, 'matches': 2, 'rev': 1,
                               'state': {'players': [], 'firstKickoffAt': 1, 'matchHistory': [{'scoreA': 2, 'scoreB': 1}, {'scoreA': 1, 'scoreB': 0}], 'match': {'scoreA': 0, 'scoreB': 0, 'events': []}}, 'updated': 100}
        await a.evaluate("switchTab('inicio'); loadSharedBabas(true)"); await a.wait_for_timeout(1200)
        pend = await a.evaluate("[...document.querySelectorAll('#home-shared [data-pending]')].map(x => x.dataset.pending)")
        if pend != ['cheio']: bad.append('cards de baba pendente: ' + str(pend))
        await a.screenshot(path=f'{OUT}/inicio_pendente.png')
        await b.close()
        print(json.dumps({'problems': bad, 'errsA': a.errs, 'errsM': m.errs}, ensure_ascii=False))
asyncio.run(main())
