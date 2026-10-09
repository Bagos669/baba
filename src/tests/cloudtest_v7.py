# v7 end to end with the fake server: live game + QR, palpites (adult, minor, guest), settlement,
# live and turma chat, lojinha, terms gate. Usage: python3 cloudtest_v7.py <screenshots dir>
import sys, asyncio, json, datetime as dt
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
OUT = sys.argv[1]; URL = 'http://localhost:8765/'
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read()
fake = Fake(); V = []
def check(c, m):
    if not c: V.append(m)
def years_ago(n): t = dt.date.today(); return t.replace(year=t.year - n).isoformat()

async def phone(b, hash='', skip_tour=True):
    ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    await ctx.expose_function('fakeCall', lambda n, t, a: fake.handle(n, t, a))
    await ctx.add_init_script(FAKE_JS)
    if skip_tour: await ctx.add_init_script("localStorage.setItem('baba_prefs_v1', JSON.stringify({tutorialDone: true}))")
    pg = await ctx.new_page(); pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    await pg.goto(URL + hash, wait_until='load'); await pg.wait_for_timeout(400)
    pg.ev = pg.evaluate
    pg.vis = lambda sel: pg.evaluate(f"(() => {{ const e = document.querySelector('{sel}'); return !!e && !e.classList.contains('hidden'); }})()")
    await pg.evaluate("window.askConfirm = async () => true")
    return ctx, pg

async def signup(pg, name, email, birth):
    await pg.ev("authGo('signup')")
    await pg.fill('#signup-name', name); await pg.fill('#signup-email', email); await pg.fill('#signup-pass', 'segredo1')
    await pg.ev("doSignup()"); await pg.wait_for_timeout(300)
    await pg.check('#recovery-ack'); await pg.ev("recoveryDone()"); await pg.wait_for_timeout(700)
    gate = await pg.vis('#page-terms-gate')
    if gate:
        await pg.fill('#terms-birth', birth); await pg.check('#terms-ack'); await pg.ev("submitTerms()"); await pg.wait_for_timeout(600)
    return gate

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()

        # ===== A: organizer
        ctxA, A = await phone(b)
        gate = await signup(A, 'Gabriel Marini', 'gabriel@t.dev', '1995-05-05')
        check(gate, 'A: terms gate not shown after signup')
        check(not await A.vis('#page-terms-gate'), 'A: gate still open after accepting')
        uidA = fake.users['gabriel@t.dev']['id']
        check(fake.acct[uidA]['version'] == '1.0', 'A: terms acceptance not stored')
        await A.ev("""async () => {
          createTurma(); const t = state.turmas[0]; t.name = 'Fiasco do Gama';
          t.players = ['Gabriel Marini','Lucas Pavetits','Pedro Pontes','Arthur Grangeiro','Dede Grangeiro','Eduardo Altoe','Pedro Coelho','Rafa Pacheco','Rafael Lugon','Lani Ramos'];
          t.keepers = ['Lani Ramos']; closeTurmaEditor(); state.selectedTeams = [t.id]; syncPool(); closeDatabaseModal();
          state.players.forEach(p => checkIn(p.id)); buildTeams(); state.match.goalLimitRule = 'none'; commit(); }""")
        await A.wait_for_timeout(600); await A.ev("flushOutbox()"); await A.wait_for_timeout(500)
        tid = await A.ev("state.turmas[0].id")
        await A.ev("switchTab('placar')"); await A.wait_for_timeout(200)
        check(await A.vis('#live-pill'), 'A: live strip not shown on Placar')
        await A.ev("toggleMatchTimer()"); await A.wait_for_timeout(900)
        check(await A.vis('#modal-qr'), 'A: QR not shown on first kick-off')
        code = await A.ev("liveCode()")
        check(code and len(code) == 8, f'A: no live code ({code})')
        check(await A.ev("!!document.querySelector('#qr-img svg')"), 'A: QR image not drawn')
        await A.screenshot(path=f'{OUT}/v7_qr.png')
        await A.ev("closeQr()"); await A.wait_for_timeout(1000)
        live = next(iter(fake.lives.values()))
        items = (live.get('markets') or {}).get('items') or []
        check(len(items) >= 5 and any(i['key'].startswith('gol:') for i in items), f'A: markets missing ({len(items)})')
        check(all(1.05 <= i['odd'] <= 15 for i in items), 'A: odds out of range')
        teamA = await A.ev("state.court.A.ids.map(nameOf)")
        striker = next(n for n in teamA if n != 'Lani Ramos')
        skey = 'gol:' + striker.lower()

        # ===== B: adult spectator with account
        ctxB, B = await phone(b)
        await signup(B, 'Lucas Pavetits', 'lucas@t.dev', '1990-01-01')
        uidB = fake.users['lucas@t.dev']['id']
        await B.ev(f"openLive('{code}')"); await B.wait_for_timeout(2800)
        check(await B.vis('#page-live'), 'B: live page not open')
        check(await B.vis('#lv-palpites-box'), 'B: adult does not see palpites')
        mk_btns = await B.ev("document.querySelectorAll('#lv-markets button').length")
        check(mk_btns >= 5, f'B: markets buttons {mk_btns}')
        await B.screenshot(path=f'{OUT}/v7_live_adult.png', full_page=False)
        await B.ev("openPalpite('res:A')"); await B.wait_for_timeout(200)
        check(await B.vis('#modal-palpite'), 'B: palpite sheet not open')
        await B.screenshot(path=f'{OUT}/v7_palpite.png')
        await B.ev("setStake(50)"); await B.ev("confirmPalpite()"); await B.wait_for_timeout(600)
        await B.ev(f"openPalpite({json.dumps(skey)})"); await B.ev("setStake(100)"); await B.ev("confirmPalpite()"); await B.wait_for_timeout(600)
        check(len([p for p in fake.palps if p['user'] == uidB]) == 2, 'B: palpites not stored')
        check(fake.wallets[uidB]['balance'] == 850, f"B: balance after palpites {fake.wallets[uidB]['balance']}")
        oddA = next(p['odd'] for p in fake.palps if p['market'] == 'res:A'); oddS = next(p['odd'] for p in fake.palps if p['market'] == skey)

        # ===== C: 17 years old
        ctxC, C = await phone(b)
        await signup(C, 'Menor Teste', 'menor@t.dev', years_ago(17))
        uidC = fake.users['menor@t.dev']['id']
        await C.ev(f"openLive('{code}')"); await C.wait_for_timeout(2800)
        check(not await C.vis('#lv-palpites-box'), 'C: minor sees palpites')
        r = fake.f_placePalpite(uidC, live['id'], 'res:A', 50)
        check('err' in r and 'adult_only' in r['err']['message'], 'server: minor palpite accepted')

        # ===== E: under 16 cannot finish signup
        ctxE, E = await phone(b)
        await signup(E, 'Crianca', 'crianca@t.dev', years_ago(14))
        check(await E.vis('#page-terms-gate') and '16 anos' in await E.inner_text('#terms-error'), 'E: under 16 not blocked')
        await E.screenshot(path=f'{OUT}/v7_gate_young.png')

        # ===== D: guest from the QR link, no account
        ctxD, D = await phone(b, '#ao-vivo=' + code.lower())
        await D.wait_for_timeout(2800)
        check(await D.vis('#page-live'), 'D: guest did not land on the live game')
        check(await D.vis('#lv-guest') and not await D.vis('#lv-palpites-box'), 'D: guest sees palpites or no signup card')
        check('Time' in await D.inner_text('#lv-a'), 'D: scoreboard empty')

        # ===== goal, chat, finish, settlement
        await A.ev(f"""() => {{ const p = state.players.find(x => x.name === {json.dumps(striker)}); selectedGoalSide = 'A'; selectedGoalScorer = p.id; confirmGoalRecord(null); }}""")
        await A.wait_for_timeout(1200)
        await B.ev("""() => { const f = document.querySelector('#lv-chat form'); f.querySelector('input').value = 'Vai Time 1!'; f.dispatchEvent(new Event('submit', {cancelable: true})); }""")
        await B.wait_for_timeout(800)
        await D.wait_for_timeout(3500)
        check(await D.inner_text('#lv-sa') == '1', 'D: goal not on guest scoreboard')
        check('Vai Time 1!' in await D.inner_text('#lv-chat'), 'D: guest does not see live chat')
        check(not await D.ev("!!document.querySelector('#lv-chat form')"), 'D: guest can type in chat')
        await D.screenshot(path=f'{OUT}/v7_live_guest.png', full_page=False)
        mid = next(m['id'] for m in fake.chat if m['body'] == 'Vai Time 1!')
        r = fake.f_chatDelete(uidC, mid)
        check('err' in r, 'server: stranger deleted a message')
        await A.ev(f"openLive('{code}')"); await A.wait_for_timeout(2800)
        check(await A.ev("liveView && liveView.data && liveView.data.is_owner"), 'A: not recognized as owner')
        await A.ev(f"""() => {{ const b = document.querySelector('#lv-chat .chat-msg[data-id="{mid}"] button[aria-label="Opções"]'); b.click(); }}""")
        await A.wait_for_timeout(200)
        await A.ev("""() => { const b = [...document.querySelectorAll('#lv-chat button')].find(x => x.innerText.trim() === 'Apagar'); b.click(); }""")
        await A.wait_for_timeout(800)
        check(next(m for m in fake.chat if m['id'] == mid)['deleted'], 'A: owner could not delete in live chat')
        await A.ev("closeLive()"); await A.wait_for_timeout(200)
        await A.ev("finishMatchAndNextChallenger(true)"); await A.wait_for_timeout(500); await A.ev("flushOutbox()"); await A.wait_for_timeout(900)
        bp = [p for p in fake.palps if p['user'] == uidB]
        check(all(p['status'] == 'won' for p in bp), f"settle: {[p['status'] for p in bp]}")
        expect = 850 + int(50 * oddA) + int(100 * oddS)
        check(fake.wallets[uidB]['balance'] == expect, f"B: balance {fake.wallets[uidB]['balance']} != {expect}")
        await B.wait_for_timeout(7000)
        check('+' in await B.inner_text('#lv-mine'), 'B: won palpite not shown')
        await B.screenshot(path=f'{OUT}/v7_live_won.png', full_page=True)

        # ===== lojinha
        await B.ev("closeLive()"); await B.wait_for_timeout(200)
        await B.ev("openShop()"); await B.wait_for_timeout(700)
        check(await B.vis('#page-shop'), 'B: shop not open')
        await B.ev("claimDaily()"); await B.wait_for_timeout(400)
        check(fake.wallets[uidB]['balance'] == expect + 100, 'B: daily bonus not credited')
        await B.ev("buyShopItem('frame_prata')"); await B.wait_for_timeout(600)
        check('frame_prata' in fake.items.get(uidB, []), 'B: frame not bought')
        check((fake.profiles[uidB].get('cosmetics') or {}).get('frame') == 'prata', 'B: frame not equipped after buying')
        await B.ev("shopTab('name')"); await B.ev("buyShopItem('name_prata')"); await B.wait_for_timeout(600)
        check(await B.ev("document.getElementById('header-profile').classList.contains('fr-prata')"), 'B: header avatar has no frame')
        await B.screenshot(path=f'{OUT}/v7_shop.png', full_page=False)
        await B.ev("closeShop(); openProfile()"); await B.wait_for_timeout(400)
        check(await B.ev("document.getElementById('profile-name').classList.contains('nm-prata')"), 'B: name style not applied')
        await B.screenshot(path=f'{OUT}/v7_profile_frame.png')
        await B.ev("closeProfile()")

        # ===== turma chat (B joins the turma first)
        inv = fake.turmas[tid]['invite_code']
        await B.ev(f"joinTurmaWithCode('{inv}')"); await B.wait_for_timeout(900)
        await B.ev("closeTurmaEditor(); closeDatabaseModal()")
        await A.ev(f"openTurmaChat('{tid}')"); await A.wait_for_timeout(500)
        await A.ev("""() => { const f = document.querySelector('#chat-turma form'); f.querySelector('input').value = 'Domingo tem baba às 9h30'; f.dispatchEvent(new Event('submit', {cancelable: true})); }""")
        await A.wait_for_timeout(600)
        await B.ev(f"openTurmaChat('{tid}')"); await B.wait_for_timeout(900)
        check('Domingo tem baba' in await B.inner_text('#chat-turma'), 'B: turma chat message not seen')
        await B.ev("""() => { const f = document.querySelector('#chat-turma form'); f.querySelector('input').value = 'Tô dentro! 🔥'; f.dispatchEvent(new Event('submit', {cancelable: true})); }""")
        await B.wait_for_timeout(700)
        await B.screenshot(path=f'{OUT}/v7_turma_chat.png')
        sent = 0
        for i in range(6):
            r = fake.f_chatSend(uidB, 'turma:' + tid, f'flood {i}')
            sent += 'err' not in r
        check(sent <= 4, f'server: rate limit let {sent} through')

        # terms page
        await B.ev("closeTurmaChat(); openTermsPage('privacidade')"); await B.wait_for_timeout(300)
        check('contatobabaapp@gmail.com' in await B.inner_text('#terms-body'), 'B: contact e-mail missing in privacy text')
        await B.screenshot(path=f'{OUT}/v7_terms.png')

        print(json.dumps({'violations': V, 'errors': {n: pg.errs for n, pg in [('A', A), ('B', B), ('C', C), ('D', D), ('E', E)]}, 'calls': len(fake.calls)}, indent=1, ensure_ascii=False))
        await b.close()
asyncio.run(main())
