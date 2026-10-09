# Walks the whole support panel against admin_fake.js; prints problems and saves screenshots.
# Needs the built site served at http://localhost:8765/ (repo root).
import sys, asyncio, json, os
from playwright.async_api import async_playwright
FAKE = open(f'{sys.path[0]}/admin_fake.js').read()
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/admin_shots'
os.makedirs(OUT, exist_ok=True)
URL = 'http://localhost:8765/admin.html'

async def run(p, vw, vh, dark, tag, full):
    b = await p.chromium.launch()
    ctx = await b.new_context(viewport={'width': vw, 'height': vh}, color_scheme='dark' if dark else 'light')
    await ctx.add_init_script(FAKE)
    pg = await ctx.new_page()
    errs, bad = [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    async def shot(name): await pg.screenshot(path=f'{OUT}/{tag}_{name}.png', full_page=False)
    async def check(cond, label):
        if not await pg.evaluate(cond): bad.append(label)
    async def confirm(): await pg.click('#modal-ok'); await pg.wait_for_timeout(250)
    async def wide():  # no horizontal page scroll
        w = await pg.evaluate('document.documentElement.scrollWidth - window.innerWidth')
        if w > 1: bad.append(f'horizontal scroll {w}px at {pg.url}')

    await pg.goto(URL, wait_until='load'); await pg.wait_for_timeout(300)
    await check("!document.getElementById('login').classList.contains('hidden')", 'login shown')
    await shot('01_login')
    # wrong password, then a non-staff account, then support
    await pg.fill('#login-email', 'contatobabaapp@gmail.com'); await pg.fill('#login-pass', 'errada'); await pg.click('#login-btn'); await pg.wait_for_timeout(300)
    await check("document.getElementById('login-error').innerText.includes('incorretos')", 'wrong password message')
    await pg.fill('#login-email', 'lucas.souza@gmail.com'); await pg.fill('#login-pass', 'senha123'); await pg.click('#login-btn'); await pg.wait_for_timeout(300)
    await check("document.getElementById('login-error').innerText.includes('não é de suporte')", 'non-staff refused')
    await check("document.getElementById('shell').classList.contains('hidden')", 'non-staff kept out')
    await pg.fill('#login-email', 'contatobabaapp@gmail.com'); await pg.fill('#login-pass', 'senha123'); await pg.click('#login-btn'); await pg.wait_for_timeout(600)
    await check("!document.getElementById('shell').classList.contains('hidden')", 'staff gets in')
    await check("document.querySelectorAll('.chart svg .bar').length > 20", 'charts drawn')
    await wide(); await shot('02_geral')
    if full:
        await pg.screenshot(path=f'{OUT}/{tag}_02_geral_full.png', full_page=True)
        # hover tooltip
        hit = pg.locator('.chart').first.locator('rect.hit').nth(25)
        await hit.hover(); await pg.wait_for_timeout(100)
        await check("!document.querySelector('.chart .tip').classList.contains('hidden')", 'tooltip on hover')
        await pg.locator('.chart').first.scroll_into_view_if_needed(); await hit.hover(); await pg.wait_for_timeout(80)
        await shot('03_tooltip')
        await pg.click('text=90 dias'); await pg.wait_for_timeout(400)
        await check("document.querySelector('.chart svg').querySelectorAll('rect.hit').length === 90", '90-day period')

    # People
    await pg.goto(URL + '#pessoas'); await pg.wait_for_timeout(400)
    await check("document.querySelectorAll('#people-table tbody tr').length === 31", 'people list')
    await wide(); await shot('04_pessoas')
    await pg.fill('#people-q', 'rafa'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(300)
    await check("document.querySelectorAll('#people-table tbody tr').length === 1", 'people search')
    await pg.click('#people-table tbody tr'); await pg.wait_for_timeout(300)
    await check("!document.getElementById('drawer').classList.contains('hidden')", 'person drawer')
    await shot('05_pessoa')
    if full:
        await pg.click('text=Dar pontos'); await pg.fill('#m-n', '250'); await pg.fill('#m-why', 'teste'); await confirm()
        await check("document.getElementById('toast').innerText.includes('Saldo agora')", 'give points')
        await pg.click('text=Tirar pontos'); await pg.fill('#m-n', '0'); await confirm()
        await check("!document.getElementById('modal-error').classList.contains('hidden')", 'zero points refused in form')
        await pg.click('#modal button:has-text("Cancelar")')
        await pg.click('text=Dar item da lojinha'); await pg.wait_for_timeout(100); await shot('06_item'); await confirm()
        await pg.click('text=Mudar o nome'); await pg.fill('#m-name', 'Rafa Lima Jr'); await confirm()
        await check("document.getElementById('drawer-title').innerText === 'Rafa Lima Jr'", 'rename shows')
        await pg.click('text=Novo código de recuperação'); await confirm(); await pg.wait_for_timeout(200)
        await check("document.querySelector('.code-box') && document.querySelector('.code-box').innerText === 'K3M9-7QPX-2WRT'", 'recovery code shown')
        await shot('07_codigo'); await pg.click('#modal button:has-text("Cancelar")')
        await pg.click('text=Senha provisória'); await pg.fill('#m-pass', '123'); await confirm()
        await check("document.getElementById('modal-error').innerText.includes('6 caracteres')", 'short password refused')
        await pg.fill('#m-pass', 'troca123'); await confirm()
        await pg.click('text=Bloquear login'); await confirm()
        await pg.click('text=Suspender chat e palpites'); await pg.fill('#m-why', 'ofensas'); await confirm()
        await check("document.querySelector('#drawer-body').innerText.includes('Suspenso')", 'ban shows')
        await pg.click('text=Reativar (tirar suspensão)'); await confirm()
        await check("!document.querySelector('#drawer-body').innerText.includes('Suspenso até')", 'unban')
        await pg.click('text=Excluir a conta'); await confirm()
        await check("document.getElementById('modal-error').innerText.includes('EXCLUIR')", 'delete needs typing')
        await pg.fill('#m-confirm', 'excluir'); await confirm()
        await check("document.getElementById('drawer').classList.contains('hidden')", 'delete closes drawer')
        # own account: no ban/delete
        await pg.fill('#people-q', 'contatobaba'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(300)
        await pg.click('#people-table tbody tr'); await pg.wait_for_timeout(300)
        await check("document.querySelector('#drawer-body').innerText.includes('Esta é a sua conta') && !document.querySelector('#drawer-body').innerText.includes('Excluir a conta')", 'own account protected')
        await check("document.querySelector('#drawer-body').innerText.includes('∞')", 'infinite points shown')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(100)

    # Turmas
    await pg.goto(URL + '#turmas'); await pg.wait_for_timeout(400)
    await check("document.querySelectorAll('#turma-table tbody tr').length === 3", 'turmas list')
    await wide(); await shot('08_turmas')
    await pg.click('#turma-table tbody tr'); await pg.wait_for_timeout(300)
    await shot('09_turma')
    if full:
        await pg.click('text=Entrar na turma'); await confirm()
        await check("document.querySelector('#drawer-body').innerText.includes('Sair da turma')", 'joined turma')
        await pg.click('text=Sair da turma'); await confirm()
        await pg.click('text=Passar o dono'); await confirm()
        await check("document.getElementById('toast').innerText.includes('Dono trocado')", 'transfer owner')
        await pg.keyboard.press('Escape')

    # Ao vivo
    await pg.goto(URL + '#aovivo'); await pg.wait_for_timeout(400)
    await wide(); await shot('10_aovivo')
    if full:
        await pg.click('button:has-text("Encerrar")'); await confirm(); await pg.wait_for_timeout(300)
        await check("![...document.querySelectorAll('#view button')].some(b => b.innerText.includes('Encerrar'))", 'live ended')

    # Denúncias
    await pg.goto(URL + '#denuncias'); await pg.wait_for_timeout(400)
    await wide(); await shot('11_denuncias')
    if full:
        await pg.click('#view button:has-text("Apagar")'); await confirm(); await pg.wait_for_timeout(300)
        await pg.click('#view button:has-text("Descartar denúncia")'); await confirm(); await pg.wait_for_timeout(300)

    # Avisos
    await pg.goto(URL + '#avisos'); await pg.wait_for_timeout(400)
    await pg.fill('#notice-msg', 'Hoje às 23h o app fica fora do ar por 10 minutos para manutenção.')
    await pg.click('[data-lvl="warning"]'); await pg.wait_for_timeout(100)
    await wide(); await shot('12_avisos')
    if full:
        await pg.click('text=Publicar aviso'); await confirm(); await pg.wait_for_timeout(300)
        await check("document.getElementById('notice-now').innerText.includes('manutenção')", 'notice published')
        await pg.click('text=Tirar o aviso atual'); await confirm(); await pg.wait_for_timeout(300)
        await check("document.getElementById('notice-now').innerText.includes('Nenhum aviso')", 'notice cleared')

    # Registro
    await pg.goto(URL + '#registro'); await pg.wait_for_timeout(400)
    await wide(); await shot('13_registro')
    if full:
        await check("document.querySelectorAll('#view tbody tr').length >= 15", 'log has every action')
        calls = await pg.evaluate('window.__adminCalls.map(c => c[0])')
        for need in ['admin_adjust_points', 'admin_grant_item', 'admin_rename_user', 'fn:staff_code', 'fn:staff_password', 'fn:staff_block', 'admin_ban', 'admin_unban', 'fn:staff_delete',
                     'admin_join_turma', 'admin_leave_turma', 'admin_transfer_turma', 'admin_end_live', 'admin_resolve_report', 'admin_set_notice']:
            if need not in calls: bad.append('never called ' + need)
    # sign out
    await pg.evaluate('doLogout()'); await pg.wait_for_timeout(200)
    await check("!document.getElementById('login').classList.contains('hidden')", 'logout')
    await b.close()
    return {'tag': tag, 'problems': bad, 'errors': errs}

async def main():
    async with async_playwright() as p:
        res = [await run(p, 1366, 860, False, 'desk', True), await run(p, 390, 844, False, 'phone', False), await run(p, 1366, 860, True, 'deskdark', False), await run(p, 390, 844, True, 'phonedark', False)]
    print(json.dumps(res, ensure_ascii=False, indent=1))
asyncio.run(main())
