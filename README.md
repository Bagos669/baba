# BABA · Gestão Digital

App da pelada: placar, relógio, fila do Rei da Quadra, turmas com convite, estatísticas e PDF do baba.

- No ar: https://bagos669.github.io/baba/
- A raiz do repositório é o site publicado (gerado).
- O código-fonte fica em `src/` (`shell.html`, `app.src.js`, `babinha/`); `src/build_site.py` gera o site.
- Servidor: Supabase (contas, turmas, babas). Mudanças de banco em `src/supabase/`.
- Painel de suporte (só para a conta de suporte): https://bagos669.github.io/baba/admin.html — fonte em `src/admin.html` e `src/admin.src.js`, banco em `src/supabase/v8_suporte_painel.sql`, função de conta em `src/supabase/functions/account/`.

## Desenvolvimento

- Build: `bash src/build.sh` (monta as ferramentas em `/tmp/baba-tools` na primeira vez e gera o site na raiz).
- Testes: `python3 src/tests/check.py` (navegador) e `python3 src/tests/check.py --sql` (+ regras do banco num Postgres local).
- Mapa do código, fluxo de versão e armadilhas: `CLAUDE.md`.
