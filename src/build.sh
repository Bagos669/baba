#!/bin/bash
# Gera o site (raiz do repositório) a partir de src/. Monta as ferramentas na primeira vez.
# Uso: bash src/build.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="${BABA_TOOLS:-/tmp/baba-tools}"
[ -x "$T/tw/node_modules/.bin/tailwindcss" ] && [ -f "$T/fa/package/css/fontawesome.min.css" ] || bash "$HERE/tools/setup_tools.sh" "$T"
python3 "$HERE/build_site.py" "$T"
node --check "$HERE/../app.js" && echo "app.js ok (node --check)"
