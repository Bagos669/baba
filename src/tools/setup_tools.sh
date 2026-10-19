#!/bin/bash
# Monta a pasta de ferramentas do build (bibliotecas, fontes, Font Awesome e Tailwind) nas versões exatas do site.
# Uso: bash src/tools/setup_tools.sh [pasta]   (padrão: /tmp/baba-tools). Precisa de npm e da internet do registro npm.
set -euo pipefail
T="${1:-/tmp/baba-tools}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$T/vendor" "$T/fa" "$T/tw"
cd "$T"
unpack() {  # $1 = pacote@versão, $2 = pasta de destino (recebe ./package)
  local tgz; tgz=$(npm pack "$1" --silent 2>/dev/null | tail -1)
  mkdir -p "$2" && rm -rf "$2/package" && tar -xzf "$tgz" -C "$2" && rm -f "$tgz"
}
unpack @supabase/supabase-js@2.117.2 vendor/sb
unpack jspdf@2.5.1 vendor/jspdf && cp vendor/jspdf/package/dist/jspdf.umd.min.js vendor/jspdf.umd.min.js
unpack @fontsource/instrument-serif@5.1.0 vendor/is
unpack @fontsource/plus-jakarta-sans@5.1.0 vendor/pj
unpack @fortawesome/fontawesome-free@6.5.1 fa
# qrcode-generator 1.4.4 já minificado: o build só acrescenta a linha de licença, então a cópia publicada sem ela é a original.
tail -n +2 "$ROOT/vendor/qrcode.min.js" > vendor/qrcode.min.js
[ -x tw/node_modules/.bin/tailwindcss ] || (cd tw && npm init -y >/dev/null && npm install tailwindcss@3.4.17 --silent >/dev/null)
{ command -v pyftsubset >/dev/null && python3 -c "import brotli" 2>/dev/null; } || pip install --break-system-packages -q fonttools brotli
echo "ferramentas prontas em $T"
