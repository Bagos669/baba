# App side of v8: support account sees the panel link and endless points; everyone sees the notice; suspended accounts see why.
import sys, asyncio, json, os
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read(); fake = Fake()
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/v8shots'
os.makedirs(SHOTS, exist_ok=True)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width': 390, 'height': 844})
        await ctx.expose_function('fakeCall', lambda n, t, a: fake.handle(n, t, a)); await ctx.add_init_script(FAKE_JS)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8765/', wait_until='load'); await pg.wait_for_timeout(300)
        await pg.evaluate("authGo('signup')")
        await pg.fill('#signup-name', 'Suporte'); await pg.fill('#signup-email', 'contatobabaapp@gmail.com'); await pg.fill('#signup-pass', 'segredo1')
        await pg.evaluate("doSignup()"); await pg.wait_for_timeout(300); await pg.check('#recovery-ack'); await pg.evaluate("recoveryDone()"); await pg.wait_for_timeout(1000)
        if await pg.evaluate("!document.getElementById('page-terms-gate').classList.contains('hidden')"):
            await pg.fill('#terms-birth', '1995-05-05'); await pg.check('#terms-ack'); await pg.evaluate("submitTerms()"); await pg.wait_for_timeout(700)
        await pg.click('#tour-next'); await pg.click('text=Pular'); await pg.wait_for_timeout(300)
        home = lambda: pg.evaluate("document.getElementById('home-v7').innerText")
        out = {'plain_home_has_panel': 'Painel de suporte' in await home(), 'pinged': len(fake.pings)}
        uid = fake.users['contatobabaapp@gmail.com']['id']
        fake.staff.add(uid); fake.wallets[uid]['balance'] = 999999999
        fake.notice = {'message': 'Manutenção hoje às 23h', 'level': 'warning'}
        await pg.reload(wait_until='load'); await pg.wait_for_timeout(1500)
        h = await home()
        out['notice_popup'] = await pg.evaluate("!document.getElementById('modal-popup').classList.contains('hidden') && document.getElementById('popup-body').innerText.includes('Manutenção hoje às 23h')")
        out['staff_home'] = ['Painel de suporte' in h, '∞ baba points' in h, 'Manutenção hoje às 23h' in h]
        await pg.evaluate("localStorage.setItem('baba_notes_seen_v1', '9.5')")
        out['pinged_once_per_day'] = len(fake.pings)
        await pg.click('#popup-ok'); await pg.wait_for_timeout(300)
        await pg.screenshot(path=f'{SHOTS}/v8_home_staff.png')
        await pg.click('#header-profile'); await pg.wait_for_timeout(400)
        out['profile_panel_link'] = await pg.evaluate("!document.getElementById('profile-staff').classList.contains('hidden') && document.querySelector('#profile-staff a').getAttribute('href')")
        out['profile_points'] = await pg.evaluate("document.getElementById('profile-points').innerText")
        await pg.locator('#profile-staff').scroll_into_view_if_needed(); await pg.screenshot(path=f'{SHOTS}/v8_profile_staff.png')
        await pg.go_back(); await pg.wait_for_timeout(300)
        out['notice_dismissed'] = 'Manutenção' not in await home()
        await pg.reload(wait_until='load'); await pg.wait_for_timeout(1500)
        out['notice_stays_dismissed'] = 'Manutenção' not in await home()
        # a different account: not staff, suspended, new notice
        fake.staff.discard(uid); fake.bans[uid] = {'until': '2099-01-01T00:00:00Z', 'reason': 'ofensas no chat'}
        fake.notice = {'message': 'Nova lojinha chegando!', 'level': 'info'}
        await pg.reload(wait_until='load'); await pg.wait_for_timeout(1500)
        h = await home()
        out['banned_home'] = ['Conta suspensa' in h, 'ofensas no chat' in h, 'Nova lojinha chegando!' in h, 'Painel de suporte' not in h]
        out['profile_staff_hidden'] = await pg.evaluate("document.getElementById('profile-staff').classList.contains('hidden')")
        await pg.screenshot(path=f'{SHOTS}/v8_home_banned.png')
        # server without v8: nothing breaks
        fake.v8_enabled = False; fake.bans.clear()
        await pg.reload(wait_until='load'); await pg.wait_for_timeout(1500)
        h = await home()
        out['no_v8'] = ['Conta suspensa' not in h, 'baba points' in h]
        print(json.dumps(out, ensure_ascii=False), errs); await b.close()
asyncio.run(main())
