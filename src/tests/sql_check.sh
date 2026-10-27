#!/bin/bash
# Regras do banco num Postgres local: cria um banco limpo, aplica as migrações na ordem de produção
# e roda cada arquivo de regras logo depois da migração que ele testa.
# Uso: bash src/tests/sql_check.sh        (sai com código 1 se algum teste falhar)
# Precisa de: postgresql-16 (apt-get install -y postgresql-16). O cluster fica em /tmp/pgbaba.
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN=/usr/lib/postgresql/16/bin
DATA=/tmp/pgbaba/data
WORK=/tmp/pgbaba/sql
[ -x "$PGBIN/pg_ctl" ] || { echo "Postgres 16 não instalado: apt-get install -y postgresql-16"; exit 2; }
mkdir -p /tmp/pgbaba && chown postgres /tmp/pgbaba
if [ ! -d "$DATA" ]; then su postgres -c "$PGBIN/initdb -D $DATA -A trust" >/dev/null; fi
su postgres -c "$PGBIN/pg_ctl -D $DATA status" >/dev/null 2>&1 || su postgres -c "$PGBIN/pg_ctl -D $DATA -l /tmp/pgbaba/log -w start" >/dev/null
# postgres não lê a pasta do repositório: copia os SQL para uma pasta dele.
rm -rf "$WORK" && mkdir -p "$WORK" && cp "$HERE"/supabase/*.sql "$HERE"/supabase/test/*.sql "$WORK"/ && chown -R postgres "$WORK"
PSQL="su postgres -c"
# Cada arquivo de regras foi escrito para rodar depois da cadeia anterior (inclusive das regras anteriores,
# que criam os helpers t_ok/t_err e usuários de teste). O v11_3_rules foi escrito sobre a cadeia só com o v7_rules,
# por isso roda num segundo banco.
fail=0
run_chain() {  # $1 = banco, $2 = lista
  $PSQL "psql -q -c 'drop database if exists $1' -c 'create database $1'" 2>&1 | grep -v NOTICE
  for f in $2; do
    out=$($PSQL "cd $WORK && psql -q -v ON_ERROR_STOP=0 -d $1 -f $f.sql" 2>&1)
    # O mock_base não tem as políticas originais que o v6 apaga: esse erro é esperado.
    errs=$(echo "$out" | grep -E "ERROR|FAIL" | grep -vE 'ERROR:  policy "[a-z_]+" for table "[a-z_]+" does not exist' | head -15)
    oks=$(echo "$out" | grep -c "NOTICE:  ok")
    if [ -n "$errs" ]; then echo "FALHOU  [$1] $f"; echo "$errs" | sed 's/^/        /'; fail=1
    else case $f in *_rules) echo "ok      [$1] $f ($oks oks)";; *) echo "ok      [$1] $f";; esac; fi
  done
}
MIG="mock_base v6_dono_fotos_preferencias v7_aovivo_palpites_loja_chat_termos"
run_chain baba_check "$MIG v7_rules mock_v8 v8_suporte_painel v8_rules v9_missoes_exclusivos v9_rules v9_5_jogadoras
  v10_penaltis_desafios v10_rules v10_1_lojinha_push v10_1_rules v11_compromisso v11_rules v11_2_convidados v11_3_turmas v11_4_palpites_pre v11_4_rules v11_4_1_palpites_livres v11_4_1_rules v11_4_2_avisos v11_4_2_rules v11_5_palpites_fase2 v11_5_rules v11_6_baba_compartilhado v11_6_rules v11_6_1_anotador_mesario v11_6_1_rules v11_7_correcoes v11_7_rules v11_7_1_ajuste_stats v11_7_1_rules v11_8_palpites_abertos v11_8_rules"
run_chain baba_check2 "$MIG v7_rules mock_v8 v8_suporte_painel v9_missoes_exclusivos v9_5_jogadoras v10_penaltis_desafios
  v10_1_lojinha_push v11_compromisso v11_2_convidados v11_3_turmas v11_3_rules"
exit $fail
