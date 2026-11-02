#!/usr/bin/env bash
# Pruebas SQL de la hoja de ruta en un Postgres LOCAL descartable (nunca Supabase).
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=$(mktemp -d); PORT=${PGPORT_TEST:-55440}
BIN=$(dirname "$(command -v pg_ctl 2>/dev/null || ls /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")
"$BIN/initdb" -D "$DIR" -U postgres >/dev/null
"$BIN/pg_ctl" -D "$DIR" -o "-p $PORT -k $DIR" -l "$DIR/log" start >/dev/null
trap '"$BIN/pg_ctl" -D "$DIR" stop >/dev/null; rm -rf "$DIR"' EXIT
P="psql -h $DIR -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q"
$P -f tests/sql/esquema_minimo_programacion.sql >/dev/null
$P -f tests/sql/esquema_minimo_hoja_ruta.sql >/dev/null
$P -f supabase/migrations/20261114120000_hoja_ruta_supervisores.sql >/dev/null
$P -f tests/sql/hoja_ruta.sql 2>&1 | grep -E 'OK|ERROR|assert'
$P -f supabase/rollback/20261114120000_hoja_ruta_supervisores_rollback.sql >/dev/null && echo "OK R - rollback aplica"
