import sys, asyncio, json
sys.path.insert(0, sys.argv[1])
from fake_server import Fake
from playwright.async_api import async_playwright
S = sys.argv[1]; URL = 'http://localhost:8765/'
FAKE_JS = open(f'{S}/fake_api.js').read()
fake = Fake(); V = []
def check(c, m):
    if not c: V.append(m)

LEGACY = None
async def phone(b, name, legacy=None, hash=''):
    ctx = await b.new_context(viewport={'width': 390, 'height': 844})
    await ctx.expose_function('fakeCall', lambda n, t, a: fake.handle(n, t, a))
    await ctx.add_init_script(FAKE_JS)
    if legacy: await ctx.add_init_script("if (!localStorage.getItem('baba_gestao_digital_v3')) localStorage.setItem('baba_gestao_digital_v3', %s);" % json.dumps(json.dumps(legacy)))
    pg = await ctx.new_page(); pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    await pg.goto(URL + hash, wait_until='load'); await pg.wait_for_timeout(300)
    pg.ev = pg.evaluate
    pg.vis = lambda sel: pg.evaluate(f"!document.querySelector('{sel}').classList.contains('hidden')")
    await pg.evaluate("window.askConfirm = async () => true")
    return ctx, pg

async def skip_tour(pg, check_msg=None):
    await pg.wait_for_timeout(400)
    shown = await pg.vis('#tour')
    if check_msg: check(shown, check_msg)
    if shown: await pg.ev("endTour(false)"); await pg.wait_for_timeout(400)
    return shown

async def settle(pg, ms=400):
    await pg.wait_for_timeout(ms)
    await pg.evaluate("flushOutbox()"); await pg.wait_for_timeout(ms)

async def signup(pg, name, email, pw):
    await pg.ev("authGo('signup')")
    await pg.fill('#signup-name', name); await pg.fill('#signup-email', email); await pg.fill('#signup-pass', pw)
    await pg.ev("doSignup()"); await pg.wait_for_timeout(300)
    if not await pg.vis('#scr-recovery'): return None
    code = await pg.input_value('#recovery-code')
    await pg.check('#recovery-ack'); await pg.ev("recoveryDone()"); await pg.wait_for_timeout(500)
    return code

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        # Legacy data on Gabriel's phone: built with the old local app logic
        ctx0 = await b.new_context(); pg0 = await ctx0.new_page()
        await pg0.add_init_script("window.__BABA_FAKE_API__ = { enabled: () => false };")
        await pg0.goto(URL, wait_until='load')
        legacy = await pg0.evaluate("""async () => { window.askConfirm = async () => true; currentUser = {id:'x', name:'x'};
          let s = defaultState(); s.turmas = seedTurmas(); state = s; state.selectedTeams = ['fiasco']; syncPool();
          state.players.slice(0, 10).forEach(p => checkIn(p.id)); buildTeams(); state.match.goalLimitRule = 'none';
          selectedGoalSide='A'; selectedGoalScorer = state.court.A.ids[1]; confirmGoalRecord(state.court.A.ids[2]);
          await finishMatchAndNextChallenger(true);
          state.pastDays = [{ id: 'd_old1', date: '2026-10-02T12:00:00.000Z', title: 'Fiasco do Gama', matches: 7, players: [{ name: 'Gabriel Marini', goals: 4, assists: 1, saves: 0, matches: 7, wins: 5 }, { name: 'Lucas "Xampson" Pavetits', goals: 2, assists: 3, saves: 0, matches: 6, wins: 3 }] }];
          return JSON.parse(JSON.stringify(state)); }""")
        await ctx0.close()

        # ===== Phone A: organizer =====
        ctxA, A = await phone(b, 'A', legacy)
        check(await A.vis('#scr-landing'), 'A: landing not first')
        await signup(A, 'Gabriel', 'bad-email', '123456')
        check('e-mail válido' in await A.inner_text('#signup-error'), 'A: bad email accepted')
        codeA = await signup(A, 'Gabriel Marini', 'gabriel@teste.dev', 'segredo1')
        check(codeA and len(codeA) == 14, 'A: recovery code missing')
        check(await A.vis('#app-root'), 'A: app not open after signup')
        await skip_tour(A, 'A: tutorial not shown on first entry')
        await A.wait_for_timeout(300); await settle(A)
        check((fake.profiles[fake.users['gabriel@teste.dev']['id']].get('prefs') or {}).get('tutorialDone') is True, 'A: tutorialDone not saved to profile')
        check(await A.vis('#modal-account') and 'nuvem' in await A.inner_text('#account-title'), 'A: local import not offered')
        await A.ev("importLocalData(0)"); await settle(A, 600); await settle(A, 600)
        names = sorted(t['name'] for t in fake.turmas.values())
        check(names == ['Fiasco do Gama', 'FutHeavenly', 'Robson F.C.'], f'A: turmas on server {names}')
        fiasco = next(t for t in fake.turmas.values() if t['name'] == 'Fiasco do Gama')
        check(sum(1 for p in fake.players.values() if p['turma_id'] == fiasco['id']) == 11, 'A: fiasco roster not on server')
        check(any(b_['finished'] and b_['title'] == 'Fiasco do Gama' for b_ in fake.babas.values()), 'A: old baba not archived on server')
        check(await A.ev("presentPlayers().length === 10 && state.matchHistory.length === 1"), 'A: current baba not brought over')
        check(await A.ev("state.selectedTeams.length === 1 && isUuid(state.selectedTeams[0])"), 'A: selected turma not remapped')
        await A.ev("saveState()"); await A.wait_for_timeout(1500); await settle(A)
        openb = [b_ for b_ in fake.babas.values() if not b_['finished']]
        check(len(openb) == 1 and openb[0]['state'] and len(openb[0]['state']['matchHistory']) == 1, 'A: live baba not pushed')
        check(await A.ev("readOutbox().length") == 0, 'A: outbox not empty')
        invite = await A.ev("state.turmas.find(t => t.name === 'Fiasco do Gama').invite")
        check(invite == fiasco['invite_code'], f'A: invite not known locally ({invite})')

        # ===== Phone B: player joins by link =====
        ctxB, B = await phone(b, 'B', None, '#convite=' + invite.lower())
        check(await B.vis('#scr-landing'), 'B: landing not first')
        await signup(B, 'Lucas Pavetits', 'lucas@teste.dev', 'bola1234')
        await skip_tour(B, 'B: tutorial not shown'); await B.wait_for_timeout(600)
        tid = fiasco['id']
        check(fake.members.get((tid, fake.users['lucas@teste.dev']['id'])) == 'member', 'B: did not join by link')
        check(await B.vis('#modal-turma-edit'), 'B: turma not opened after join')
        check('Sair da turma' in await B.inner_text('#turma-edit-delete'), 'B: member sees delete instead of leave')
        check(await B.ev("document.getElementById('turma-edit-addbox').classList.contains('hidden')"), 'B: member can add players')
        await B.ev("claimPlayer(%s, 'Lucas \"Xampson\" Pavetits')" % json.dumps(tid)); await B.wait_for_timeout(300)
        lucasP = next(p for p in fake.players.values() if p['name'] == 'Lucas "Xampson" Pavetits')
        check(lucasP['user_id'] == fake.users['lucas@teste.dev']['id'], 'B: claim not saved')
        check('Você' in await B.inner_text('#turma-edit-list'), 'B: claimed row not marked')
        # a member's local roster edit must not reach the server
        await B.ev("closeTurmaEditor(); closeDatabaseModal(); const t = state.turmas[0]; t.players.push('Intruso'); markTurmaDirty(t.id);")
        await settle(B)
        check(not any(p['name'] == 'Intruso' for p in fake.players.values()), 'B: member changed roster')
        await B.ev("pullCloud(true)"); await B.wait_for_timeout(400)

        # ===== Profile: name, picture, theme =====
        uidA = fake.users['gabriel@teste.dev']['id']; uidB = fake.users['lucas@teste.dev']['id']
        await A.ev("openProfile()"); await A.wait_for_timeout(300)
        check(await A.vis('#page-profile'), 'A: profile page not open')
        await A.ev("editProfileName()"); await A.fill('#profile-name-input', 'Gabriel Marini Jr'); await A.ev("saveProfileName()")
        await A.ev("openAvatarPicker('me')"); await A.ev("pickerChoose('🦁')")
        await A.ev("setPref('theme', 'dark')"); await A.wait_for_timeout(1800); await settle(A)
        pA = fake.profiles[uidA]
        check(pA['name'] == 'Gabriel Marini Jr' and pA['avatar'] == '🦁', f'A: profile not saved {pA}')
        check((pA.get('prefs') or {}).get('theme') == 'dark', 'A: theme not saved to profile')
        check(await A.ev("document.documentElement.classList.contains('dark')"), 'A: dark class missing')
        check('🦁' in await A.inner_text('#header-avatar'), 'A: header avatar not updated')
        await A.screenshot(path=f'{S}/c_profile_dark.png', full_page=False)
        await A.ev("setPref('theme', 'light'); closeProfile()")

        # ===== Turma: icon, people, roles =====
        await A.ev("openDatabaseModal(); openTurmaEditor(%s)" % json.dumps(tid)); await A.wait_for_timeout(300)
        check('dono' in await A.inner_text('#turma-edit-role'), 'A: not shown as owner')
        await A.ev("openAvatarPicker('turma')"); await A.ev("pickerChoose('🐐')"); await A.wait_for_timeout(300); await settle(A)
        check(fake.turmas[tid].get('icon') == '🐐', 'A: turma icon not saved')
        await A.ev("turmaTab('pessoas')"); await A.wait_for_timeout(500)
        people = await A.inner_text('#turma-people')
        check('Lucas Pavetits' in people and 'Membro' in people and 'Dono' in people, f'A: people list wrong: {people[:200]}')
        await A.ev("changeMemberRole(%s, %s, 'admin')" % (json.dumps(tid), json.dumps(uidB))); await A.wait_for_timeout(400)
        check(fake.members.get((tid, uidB)) == 'admin', 'A: promote failed')
        await B.ev("pullCloud(true)"); await B.wait_for_timeout(400)
        check(await B.ev("canEditTurma(turmaById(%s)) && !ownsTurma(turmaById(%s))" % (json.dumps(tid), json.dumps(tid))), 'B: admin rights wrong')
        await B.ev("openDatabaseModal(); openTurmaEditor(%s)" % json.dumps(tid)); await B.wait_for_timeout(300)
        check(not await B.ev("document.getElementById('turma-edit-addbox').classList.contains('hidden')"), 'B: admin cannot add players')
        check('Sair da turma' in await B.inner_text('#turma-edit-delete'), 'B: admin can delete turma')
        r = fake.f_setRole(uidB, tid, uidA, 'member')
        check('err' in r, 'server: admin changed the owner role')
        await B.ev("closeTurmaEditor(); closeDatabaseModal()")
        await A.ev("transferTurma(%s, %s)" % (json.dumps(tid), json.dumps(uidB))); await A.wait_for_timeout(600)
        check(fake.turmas[tid]['owner_id'] == uidB, 'A: transfer failed')
        check(await A.ev("turmaById(%s).role" % json.dumps(tid)) == 'admin', 'A: still owner locally after transfer')
        await B.ev("pullCloud(true)"); await B.wait_for_timeout(400)
        check(await B.ev("ownsTurma(turmaById(%s))" % json.dumps(tid)), 'B: not owner after transfer')
        await B.ev("transferTurma(%s, %s)" % (json.dumps(tid), json.dumps(uidA))); await B.wait_for_timeout(600)
        await B.ev("changeMemberRole(%s, %s, 'member')" % (json.dumps(tid), json.dumps(uidB))) ; await B.wait_for_timeout(300)
        check(fake.turmas[tid]['owner_id'] == uidA, 'B: transfer back failed')
        await A.ev("pullCloud(true)"); await A.wait_for_timeout(400)
        await A.ev("changeMemberRole(%s, %s, 'member')" % (json.dumps(tid), json.dumps(uidB))); await A.wait_for_timeout(400)
        check(fake.members.get((tid, uidB)) == 'member', 'A: demote failed')
        await A.ev("closeTurmaEditor(); closeDatabaseModal()")
        await B.ev("pullCloud(true)"); await B.wait_for_timeout(400)

        # ===== A plays, goes offline mid-match, comes back, closes the day =====
        await A.ev("pullCloud(true)"); await A.wait_for_timeout(500)
        check(await A.ev("state.turmas.find(t => t.name === 'Fiasco do Gama').meta['lucas \"xampson\" pavetits'].userId !== null"), 'A: does not see Lucas link')
        fake.offline = True
        await A.ev("""() => { const lucas = state.players.find(p => p.name.startsWith('Lucas')); const side = sideOf(lucas.id);
            if (!side) { checkIn(lucas.id); } selectedGoalSide = sideOf(lucas.id) || 'A'; selectedGoalScorer = lucas.id; confirmGoalRecord(null); }""")
        await A.wait_for_timeout(1600); await settle(A)
        check(await A.ev("syncState") == 'offline', 'A: offline not detected')
        check(await A.ev("readOutbox().length") >= 1, 'A: change not kept in outbox while offline')
        fake.offline = False
        await settle(A, 500)
        check(await A.ev("readOutbox().length") == 0, 'A: outbox not flushed after reconnect')
        await A.ev("startNewDay()"); await A.wait_for_timeout(300); await settle(A, 600)
        fin = [b_ for b_ in fake.babas.values() if b_['finished']]
        check(len(fin) == 2, f'A: finished babas on server {len(fin)}')
        latest = next(b_ for b_ in fin if b_['title'] == 'Fiasco do Gama' and b_['id'] in fake.stats and any(s['turma_player_id'] for s in fake.stats[b_['id']]))
        lucas_row = next(s for s in fake.stats[latest['id']] if s['name'].startswith('Lucas'))
        check(lucas_row['turma_player_id'] == lucasP['id'] and lucas_row['goals'] >= 1, 'A: stats not linked to roster player')
        check(not any(not b_['finished'] for b_ in fake.babas.values()), 'A: open baba left after new day')

        # ===== B sees personal numbers =====
        await B.ev("pullCloud(true)"); await B.wait_for_timeout(500)
        mine = await B.ev("myStats()")
        check(mine and mine['goals'] >= 1 and mine['babas'] == 1, f'B: my stats {mine}')
        check('Meus números' in await B.inner_text('#home-mine'), 'B: home card missing')
        check(await B.ev("state.pastDays.length") == 2, 'B: history not visible to member')
        check(await B.ev("state.pastDays.every(d => d.owner === false)"), 'B: member can delete organizer babas')

        # ===== Reload keeps session; forgot password; account deletion =====
        await A.reload(wait_until='load'); await A.wait_for_timeout(600)
        check(await A.vis('#app-root'), 'A: session lost on reload')
        check(not await A.vis('#tour'), 'A: tutorial shown again after reload')
        check('🦁' in await A.inner_text('#header-avatar'), 'A: avatar lost on reload')
        await B.ev("logout()"); await B.wait_for_timeout(200)
        check(await B.vis('#scr-login') and await B.input_value('#login-email') == 'lucas@teste.dev', 'B: login not prefilled')
        await B.ev("authGo('forgot')"); await B.fill('#forgot-code', 'AAAA-BBBB-CCCC'); await B.fill('#forgot-pass', 'nova1234')
        await B.ev("doForgot()"); await B.wait_for_timeout(200)
        check('incorretos' in await B.inner_text('#forgot-error'), 'B: wrong code accepted')
        lucas_code = fake.users['lucas@teste.dev']['code']
        await B.fill('#forgot-code', lucas_code.lower().replace('-', ' ')); await B.ev("doForgot()"); await B.wait_for_timeout(500)
        check(await B.vis('#app-root'), 'B: right code rejected')
        await B.ev("logout()"); await B.wait_for_timeout(200)
        await B.fill('#login-pass', 'bola1234'); await B.ev("doLogin()"); await B.wait_for_timeout(200)
        check('incorretos' in await B.inner_text('#login-error'), 'B: old password still works')
        await B.fill('#login-pass', 'nova1234'); await B.ev("doLogin()"); await B.wait_for_timeout(500)
        check(await B.vis('#app-root'), 'B: new password rejected')
        await B.ev("openProfile(); openAccountSheet('delete')"); await B.fill('#acc-old', 'nova1234'); await B.ev("doDeleteAccount()"); await B.wait_for_timeout(500)
        check('lucas@teste.dev' not in fake.users, 'B: account not deleted')
        check(await B.vis('#scr-landing'), 'B: not on landing after delete')
        check(lucasP['user_id'] is None, 'B: link not cleared on delete')
        check(fake.members.get((tid, fake.users['gabriel@teste.dev']['id'])) == 'admin' and fake.turmas[tid]['owner_id'] == uidA, 'A: lost ownership')

        # ===== Screenshots =====
        await A.ev("switchTab('inicio'); document.getElementById('toast-container').innerHTML=''"); await A.wait_for_timeout(300)
        await A.screenshot(path=f'{S}/c_home.png', full_page=True)
        await A.ev("openDatabaseModal(); openTurmaEditor(state.turmas.find(t => t.name === 'Fiasco do Gama').id)"); await A.wait_for_timeout(400)
        await A.screenshot(path=f'{S}/c_turma.png')
        print(json.dumps({'violations': V, 'errorsA': A.errs, 'errorsB': B.errs, 'server_calls': len(fake.calls)}, indent=1, ensure_ascii=False))
        await b.close()
asyncio.run(main())
