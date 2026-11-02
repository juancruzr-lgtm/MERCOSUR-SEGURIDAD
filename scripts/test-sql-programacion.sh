#!/usr/bin/env bash
# Corre las pruebas SQL de programación en un Postgres LOCAL descartable.
# Uso: scripts/test-sql-programacion.sh   (requiere psql/pg_ctl en el PATH)
# No se conecta a Supabase ni a producción.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=$(mktemp -d); PORT=${PGPORT_TEST:-55439}
BIN=$(dirname "$(command -v pg_ctl 2>/dev/null || ls /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")
"$BIN/initdb" -D "$DIR" -U postgres >/dev/null
"$BIN/pg_ctl" -D "$DIR" -o "-p $PORT -k $DIR" -l "$DIR/log" start >/dev/null
trap '"$BIN/pg_ctl" -D "$DIR" stop >/dev/null; rm -rf "$DIR"' EXIT
P="psql -h $DIR -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q"
$P -f tests/sql/esquema_minimo_programacion.sql >/dev/null
# Versión previa (producción) y después la migración, como se aplicaría.
$P -c "$(sed -n '/^CREATE OR REPLACE FUNCTION public.asignar_vigilador_turnos/,/^\$function\$;/p' supabase/migrations/20260908130000_alcance_escritura_turnos.sql)" >/dev/null
$P -f supabase/migrations/20261113110000_programacion_conflictos_correccion_turnos.sql >/dev/null
$P -f tests/sql/programacion_conflictos.sql 2>&1 | grep -E 'OK|ERROR|assert|failed' 
# El rollback también tiene que aplicar limpio.
$P -f supabase/rollback/20261113110000_programacion_conflictos_correccion_turnos_rollback.sql >/dev/null && echo "OK R - rollback aplica"
