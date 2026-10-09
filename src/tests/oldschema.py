# The app against a server that doesn't have owners/pictures/prefs yet.
import sys, asyncio, json
sys.path.insert(0, sys.path[0])
from fake_server import Fake
from playwright.async_api import async_playwright
FAKE_JS = open(f'{sys.path[0]}/fake_api.js').read()
class Old(Fake):
    def f_memberships(self, uid, who):
        return self.ok([{'role': r, 'turma': {k: v for k, v in self.turmas[t].items() if k not in ('owner_id', 'icon')}} for (t, u), r in self.members.items() if u == uid and t in self.turmas])
    def f_profile(self, uid, who): return self.ok({'name': self.profiles[uid]['name']})
    def f_roster(self, uid, tid): return self.err('PGRST202', 'function not found')
fake = Old(); V = []
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width': 390, 'height': 844})
        await ctx.expose_function('fakeCall', lambda n, t, a: fake.handle(n, t, a))
        # The old app passes schemaV2 checks through the real api; with the fake we emulate the flag.
        await ctx.add_init_script(FAKE_JS)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8765/', wait_until='load'); await pg.wait_for_timeout(300)
        await pg.evaluate("window.askConfirm = async () => true; authGo('signup')")
        await pg.fill('#signup-name', 'Gabriel'); await pg.fill('#signup-email', 'g@t.dev'); await pg.fill('#signup-pass', 'segredo1')
        await pg.evaluate("doSignup()"); await pg.wait_for_timeout(300); await pg.check('#recovery-ack'); await pg.evaluate("recoveryDone()"); await pg.wait_for_timeout(900)
        await pg.evaluate("endTour(false); createTurma()"); await pg.wait_for_timeout(500)
        await pg.evaluate("flushOutbox()"); await pg.wait_for_timeout(500)
        tid = await pg.evaluate("state.turmas[0].id")
        fake.members[(tid, fake.users['g@t.dev']['id'])] = 'admin'
        await pg.evaluate("openAvatarPicker('turma'); pickerChoose('🐐'); pullCloud(true)"); await pg.wait_for_timeout(600)
        r = await pg.evaluate("({icon: state.turmas[0].icon, role: state.turmas[0].role, owns: ownsTurma(state.turmas[0]), v2: schemaV2})")
        print(json.dumps({'state': r, 'errors': errs}))
        await b.close()
asyncio.run(main())
