import re, sys, os, shutil, base64, subprocess, hashlib, json
# usage: python3 build_site.py <tools dir (vendor, fa, tw)> 
# Sources live next to this script; the site is written to the repo root.
S = sys.argv[1]
V = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(V)
OUT = f'{S}/site'
if os.path.exists(OUT): shutil.rmtree(OUT)
for d in ['vendor', 'fonts', 'icons', 'babinha']: os.makedirs(f'{OUT}/{d}')
for f in os.listdir(f'{V}/babinha'):
    if f.endswith('.webp'): shutil.copy(f'{V}/babinha/{f}', f'{OUT}/babinha/{f}')

html = open(f'{V}/shell.html').read()
js = open(f'{V}/app.src.js').read()

# --- icons from the logo
from PIL import Image
src = Image.open(f'{V}/logo/src.png').convert('RGB')
sq = src.crop((136, 132, 1856, 1852))
for size, name in [(192, 'icon-192.png'), (512, 'icon-512.png'), (180, 'apple-touch-icon.png'), (32, 'favicon-32.png')]:
    sq.resize((size, size), Image.LANCZOS).save(f'{OUT}/icons/{name}', optimize=True)
bg = Image.new('RGB', (512, 512), src.getpixel((20, 20)))
inner = src.crop((216, 212, 1776, 1772)).resize((360, 360), Image.LANCZOS)
bg.paste(inner, (76, 76)); bg.save(f'{OUT}/icons/maskable-512.png', optimize=True)

html = html.replace('<link rel="icon" type="image/png" href="LOGO_DATA_URI" />', '<link rel="icon" type="image/png" href="icons/favicon-32.png" />')
html = html.replace('<link rel="apple-touch-icon" href="LOGO_DATA_URI" />', '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png" />')
html = html.replace('--logo: url(LOGO_DATA_URI);', '--logo: url(icons/icon-192.png);')
html = html.replace('src="LOGO_DATA_URI"', 'src="icons/icon-192.png"')
assert 'LOGO_DATA_URI' not in html, 'logo placeholder left'

# --- vendor libs
shutil.copy(f'{S}/vendor/sb/package/dist/umd/supabase.js', f'{OUT}/vendor/supabase.js')
shutil.copy(f'{S}/vendor/jspdf.umd.min.js', f'{OUT}/vendor/jspdf.umd.min.js')
open(f'{OUT}/vendor/qrcode.min.js', 'w').write('/* qrcode-generator 1.4.4 · Copyright (c) 2009 Kazuhiko Arase · MIT license */\n' + open(f'{S}/vendor/qrcode.min.js').read())

# --- fonts
fonts = [
  ('Instrument Serif', 'normal', 400, 'is/package/files/instrument-serif-latin-400-normal.woff2'),
  ('Instrument Serif', 'italic', 400, 'is/package/files/instrument-serif-latin-400-italic.woff2'),
] + [('Plus Jakarta Sans', 'normal', w, f'pj/package/files/plus-jakarta-sans-latin-{w}-normal.woff2') for w in (400, 500, 600, 700, 800)]
face = ''
for fam, style, w, path in fonts:
    fn = os.path.basename(path)
    shutil.copy(f'{S}/vendor/{path}', f'{OUT}/fonts/{fn}')
    face += f'@font-face{{font-family:"{fam}";font-style:{style};font-weight:{w};font-display:swap;src:url(fonts/{fn}) format("woff2")}}\n'

# --- Font Awesome subset (font as a file)
used = set(re.findall(r'fa-([a-z0-9-]+)', html + js)) - {'solid', 'icons'}
fa = re.sub(r'/\*.*?\*/', '', open(f'{S}/fa/package/css/fontawesome.min.css').read(), flags=re.S)
cps, found = set(), set()
def keep(m):
    sels = set(re.findall(r'\.fa-([a-z0-9-]+):before', m.group(1)))
    hit = used & sels
    if hit: found.update(hit); cps.add(m.group(2)); return m.group(0)
    return ''
fa = re.sub(r'((?:\.fa-[a-z0-9-]+:before,?)+)\{content:"\\([0-9a-f]+)"\}', keep, fa)
missing = {m for m in used - found if f'.fa-{m}' not in fa and m not in {'spin','pulse','beat','fade','flip','shake','bounce','xs','sm','lg','xl','2xl','fw','border','inverse','stack'}}
assert not missing, f'missing icons: {missing}'
subprocess.run(['pyftsubset', f'{S}/fa/package/webfonts/fa-solid-900.ttf', '--unicodes=' + ','.join('U+' + c for c in sorted(cps)),
                '--flavor=woff2', f'--output-file={OUT}/fonts/fa-solid-900.woff2', '--layout-features=*', '--no-hinting'], check=True)
solid = re.sub(r'/\*.*?\*/', '', open(f'{S}/fa/package/css/solid.min.css').read(), flags=re.S)
solid = solid.replace('src:url(../webfonts/fa-solid-900.woff2) format("woff2"),url(../webfonts/fa-solid-900.ttf) format("truetype")', 'src:url(fonts/fa-solid-900.woff2) format("woff2")')
assert 'fonts/fa-solid-900.woff2' in solid

# --- Tailwind, compiled once at build
cfg = re.search(r'<script>\s*tailwind\.config = (\{.*?\n    \})\n  </script>', html, re.S).group(1)
comp = re.search(r'<style type="text/tailwindcss">(.*?)</style>', html, re.S).group(1)
html = re.sub(r'\s*<script>\s*tailwind\.config.*?</script>', '', html, flags=re.S)
html = re.sub(r'\s*<style type="text/tailwindcss">.*?</style>', '', html, flags=re.S)
html = html.replace('/*APP_JS*/', '').replace('  <script>\n\n  </script>', '  <script src="app.js"></script>')
assert '<script src="app.js"></script>' in html
open(f'{OUT}/index.html', 'w').write(html)
open(f'{OUT}/app.js', 'w').write(js)
open(f'{S}/tw/tailwind.config.js', 'w').write("module.exports = Object.assign(" + cfg + ", { content: ['" + OUT + "/index.html', '" + OUT + "/app.js'] });")
open(f'{S}/tw/in.css', 'w').write('@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' + comp)
r = subprocess.run([f'{S}/tw/node_modules/.bin/tailwindcss', '-c', f'{S}/tw/tailwind.config.js', '-i', f'{S}/tw/in.css', '-o', f'{S}/tw/out.css', '--minify'], capture_output=True, text=True)
if r.returncode: print(r.stderr[-1500:]); sys.exit(1)
css = face + '/* Font Awesome Free 6.5.1 (subset) - fontawesome.com - Icons CC BY 4.0, Font SIL OFL 1.1, Code MIT */\n' + fa + solid + '\n' + open(f'{S}/tw/out.css').read()
open(f'{OUT}/app.css', 'w').write(css)
# Versioned URLs: the browser's own cache can never pair a new page with old code.
hv = lambda path: hashlib.sha256(open(path, 'rb').read()).hexdigest()[:10]
JS_URL, CSS_URL = f"app.js?v={hv(f'{OUT}/app.js')}", f"app.css?v={hv(f'{OUT}/app.css')}"
html = html.replace('<!--CSS_LINK-->', f'<link rel="stylesheet" href="{CSS_URL}" />')
html = html.replace('<script src="app.js"></script>', f'<script src="{JS_URL}"></script>')
open(f'{OUT}/index.html', 'w').write(html)

# --- PWA
manifest = {
  "name": "BABA · Gestão de pelada", "short_name": "BABA", "lang": "pt-BR",
  "description": "Placar, relógio, fila do Rei da Quadra e artilharia da sua pelada.",
  "start_url": "./", "scope": "./", "display": "standalone", "orientation": "any",
  "background_color": "#FAF3DC", "theme_color": "#FAF3DC",
  "icons": [
    {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
    {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png"},
    {"src": "icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}
  ]
}
open(f'{OUT}/manifest.webmanifest', 'w').write(json.dumps(manifest, ensure_ascii=False, indent=1))
files = []
for root, _, names in os.walk(OUT):
    for n in names:
        files.append(os.path.relpath(os.path.join(root, n), OUT))
files = sorted(f for f in files if f != 'sw.js')
h = hashlib.sha256()
for f in files: h.update(f.encode()); h.update(open(f'{OUT}/{f}', 'rb').read())
version = h.hexdigest()[:12]
precache = ['./'] + [{'app.js': JS_URL, 'app.css': CSS_URL}.get(f, f) for f in files if f != 'index.html' and not os.path.basename(f).startswith('.')]
sw = open(f'{V}/sw.template.js').read().replace('__VERSION__', version).replace('__PRECACHE__', json.dumps(precache))
open(f'{OUT}/sw.js', 'w').write(sw)
open(f'{OUT}/.nojekyll', 'w').write('')
total = sum(os.path.getsize(f'{OUT}/{f}') for f in files)
print('site ok', version, len(files), 'files', round(total / 1024), 'KB', 'icons', len(found))

# --- publish into the repo root (keeps .git, src, README)
for name in os.listdir(ROOT):
    if name in ('.git', 'src', 'README.md'): continue
    path = os.path.join(ROOT, name)
    shutil.rmtree(path) if os.path.isdir(path) else os.remove(path)
for name in os.listdir(OUT):
    src_p = os.path.join(OUT, name)
    (shutil.copytree if os.path.isdir(src_p) else shutil.copy)(src_p, os.path.join(ROOT, name))
print('published to', ROOT)
