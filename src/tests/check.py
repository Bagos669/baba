#!/usr/bin/env python3
"""Roda os testes do BABA e mostra só o que falhou.

Uso (da raiz do repositório, depois de `bash src/build.sh`):
  python3 src/tests/check.py            # testes de navegador (app publicado na raiz)
  python3 src/tests/check.py --sql      # + regras do banco num Postgres local
  python3 src/tests/check.py v113 sim2  # só os testes cujo nome contém esses trechos

Logs completos em /tmp/baba-check/<teste>.log. Sai com código 1 se algo falhar.
Leva ~4 min no total: rode em segundo plano e espere o arquivo /tmp/baba-check/done.
"""
import json, os, re, socket, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
LOGS = '/tmp/baba-check'
PORT = 8765

# nome, comando (relativo a src/tests), o que cobre
TESTS = [
    ('v11',      ['v11_smoke.py'],         'lista, colar lista, convidados, compromisso'),
    ('v112',     ['v112_smoke.py'],        'turmas: privacidade, ranking, troféus, desafios, campeonato'),
    ('v113',     ['v113_smoke.py'],        'navegação 3 abas + perfil na barra, configurações, local, lances, moldura'),
    ('v114',     ['v114_smoke.py'],        'palpites pré-jogo: chip, seção, bilhete, travas, adm, menor, liquidação'),
    ('v1142',    ['v1142_smoke.py'],       'avisos no celular: interruptores, registro do aparelho, toque abre lista/palpites'),
    ('tutorial', ['tutorial_test.py'],     'os 6 capítulos do tutorial e seus alvos na tela'),
    ('sim2',     ['runsim2.py', 'sim2.js'], 'simulação de babas: times, fila, rotação, stats, reload'),
]


def port_open():
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(('127.0.0.1', PORT)) == 0


def verdict(name, code, out):
    """Retorna lista de motivos de falha (vazia = passou)."""
    bad = []
    if code != 0:
        bad.append(f'saiu com código {code}')
    if 'Traceback' in out:
        bad.append('exceção Python: ' + out[out.index('Traceback'):][-600:])
    if name == 'sim2':
        m = re.search(r'^\{.*?^\}', out, re.S | re.M)
        rep = json.loads(m.group(0)) if m else None
        if not rep:
            bad.append('relatório da simulação não encontrado')
        elif rep.get('violations'):
            bad.append('violações: ' + json.dumps(rep['violations'], ensure_ascii=False)[:800])
        pe = re.search(r'page errors: (.*)', out)
        if not pe or pe.group(1).strip() != '[]':
            bad.append('erros na página: ' + (pe.group(1) if pe else '?'))
        return bad
    lines = [l for l in out.strip().splitlines() if l.startswith('{')]
    if not lines:
        bad.append('resultado JSON não encontrado')
        return bad
    try:
        rep = json.loads(lines[-1])
    except Exception:
        try:
            import ast
            rep = ast.literal_eval(lines[-1])
        except Exception:
            bad.append('resultado ilegível: ' + lines[-1][:300])
            return bad
    for k, v in rep.items():
        if (k in ('problems', 'errors', 'missing_targets') or k.startswith('errs')) and v:
            bad.append(f'{k}: ' + json.dumps(v, ensure_ascii=False)[:800])
    return bad


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    run_sql = '--sql' in sys.argv
    os.makedirs(LOGS, exist_ok=True)
    done_flag = os.path.join(LOGS, 'done')
    if os.path.exists(done_flag):
        os.remove(done_flag)
    if not os.path.exists(os.path.join(ROOT, 'app.js')):
        print('app.js não existe na raiz: rode antes `bash src/build.sh`.')
        sys.exit(2)
    server = None
    if not port_open():
        # start_new_session: o servidor não morre junto com o shell que chamou o check.
        server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--directory', ROOT],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        for _ in range(40):
            if port_open():
                break
            time.sleep(0.25)
    failed = []
    try:
        for name, cmd, what in TESTS:
            if args and not any(a == name or (a not in [n for n, _, _ in TESTS] and a in name) for a in args):
                continue
            t0 = time.time()
            try:
                r = subprocess.run([sys.executable] + cmd, cwd=HERE, capture_output=True, text=True, timeout=300)
                out, code = r.stdout + r.stderr, r.returncode
            except subprocess.TimeoutExpired as e:
                out, code = (e.stdout or b'').decode(errors='replace') if isinstance(e.stdout, bytes) else (e.stdout or ''), 'timeout'
            open(os.path.join(LOGS, name + '.log'), 'w').write(out)
            bad = verdict(name, 0 if code == 0 else code, out)
            dt = time.time() - t0
            print(f"{'ok     ' if not bad else 'FALHOU '} {name:<9} {dt:5.0f}s  {what}", flush=True)
            for b in bad:
                print('         - ' + b.replace('\n', '\n           '), flush=True)
            if bad:
                failed.append(name)
        if run_sql:
            r = subprocess.run(['bash', os.path.join(HERE, 'sql_check.sh')], capture_output=True, text=True)
            open(os.path.join(LOGS, 'sql.log'), 'w').write(r.stdout + r.stderr)
            fails = [l for l in r.stdout.splitlines() if not l.startswith('ok')]
            oks = sum(int(n) for n in re.findall(r'\((\d+) oks\)', r.stdout))
            print(f"{'ok     ' if r.returncode == 0 else 'FALHOU '} sql       {oks} regras do banco conferidas", flush=True)
            for l in fails[:30]:
                print('         ' + l, flush=True)
            if r.returncode:
                failed.append('sql')
    finally:
        if server:
            server.terminate()
    print('\nTUDO OK' if not failed else '\nFALHARAM: ' + ', '.join(failed))
    open(done_flag, 'w').write('ok' if not failed else 'fail')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
