// Pruebas SQL de programación, hoja de ruta y su integración con la auditoría
// de octubre, sobre PGlite (Postgres en memoria, aislado). Nunca toca Supabase.
//
//   npm i --no-save @electric-sql/pglite@0.2.17
//   node scripts/test-sql-pglite.mjs [ruta-al-repo]
//
// Equivale a scripts/test-sql-programacion.sh y scripts/test-sql-hoja-ruta.sh
// (que piden psql/pg_ctl) más tests/sql/integracion_superposicion_bloqueada.sql.
// Las suites propias de #345 están en supabase/pruebas/*/run.mjs.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url))
// PGlite no trae pgcrypto; gen_random_uuid() ya es nativo desde Postgres 13.
const leer = (rel) => readFileSync(join(REPO, rel), 'utf8')
  .replace(/^\\set .*$/gm, '')
  .replace(/^create extension if not exists pgcrypto.*$/gim, '')

// Un Postgres de Supabase trae estos roles; el esquema mínimo no.
const ROLES = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
`

const ASIGNAR_PREVIA = () => {
  const src = leer('supabase/migrations/20260908130000_alcance_escritura_turnos.sql')
  const ini = src.indexOf('CREATE OR REPLACE FUNCTION public.asignar_vigilador_turnos')
  const fin = src.indexOf('$function$;', src.indexOf('AS $function$', ini)) + '$function$;'.length
  return src.slice(ini, fin)
}

let fallos = 0
async function suite(nombre, pasos, { roles = true } = {}) {
  const db = new PGlite()
  const ok = []
  try {
    if (roles) await db.exec(ROLES)
    for (const [etiqueta, sql] of pasos) {
      try {
        await db.exec(sql, { onNotice: (n) => { if (/^OK /.test(n.message)) ok.push(n.message) } })
      } catch (e) {
        throw new Error(`${etiqueta}: ${e.message}`)
      }
    }
    console.log(`✔ ${nombre}`)
    for (const m of ok) console.log(`    ${m}`)
  } catch (e) {
    fallos++
    console.log(`✘ ${nombre}\n    ${e.message}`)
    for (const m of ok) console.log(`    ${m}`)
  } finally {
    await db.close()
  }
}

const PROG_MIG = 'supabase/migrations/20261125120000_programacion_conflictos_correccion_turnos.sql'
const PROG_RB = 'supabase/rollback/20261125120000_programacion_conflictos_correccion_turnos_rollback.sql'
const HR_MIG = 'supabase/migrations/20261114120000_hoja_ruta_supervisores.sql'
const HR_RB = 'supabase/rollback/20261114120000_hoja_ruta_supervisores_rollback.sql'
const TC_MIG = 'supabase/migrations/20261121120000_turnos_cobertura_liquidacion.sql'
const TC_RB = 'supabase/rollback/20261121120000_turnos_cobertura_liquidacion_rollback.sql'

await suite('Programación (20261125120000) + rollback', [
  ['esquema', leer('tests/sql/esquema_minimo_programacion.sql')],
  ['asignar previa', ASIGNAR_PREVIA()],
  ['migración', leer(PROG_MIG)],
  ['migración otra vez (idempotente)', leer(PROG_MIG)],
  ['pruebas', leer('tests/sql/programacion_conflictos.sql')],
  ['rollback', leer(PROG_RB)],
])

await suite('Hoja de ruta (20261114120000) + rollback', [
  ['esquema programación', leer('tests/sql/esquema_minimo_programacion.sql')],
  ['esquema hoja de ruta', leer('tests/sql/esquema_minimo_hoja_ruta.sql')],
  ['migración', leer(HR_MIG)],
  ['pruebas', leer('tests/sql/hoja_ruta.sql')],
  ['rollback', leer(HR_RB)],
])

// Sobre el esqueleto de producción de #345 (trae sus propios roles y auth.uid()).
await suite('Integración: superposición bloqueada (#345 trigger + #346 RPC)', [
  ['esqueleto de producción (#345)', leer('supabase/pruebas/turnos-cobertura/prelude.sql')],
  ['asignar previa', ASIGNAR_PREVIA()],
  ['20261121120000 (#345)', leer(TC_MIG)],
  ['20261125120000 (#346)', leer(PROG_MIG)],
  ['pruebas de integración', leer('tests/sql/integracion_superposicion_bloqueada.sql')],
  ['rollback 20261125120000', leer(PROG_RB)],
  ['rollback 20261121120000', leer(TC_RB)],
], { roles: false })

await suite('Exigibilidad de supervisiones (20261113120000, #345)', [
  ['esquema', leer('supabase/pruebas/supervision-exigibilidad/esquema_minimo.sql')],
  ['migración', leer('supabase/migrations/20261113120000_supervision_exigibilidad_servicio.sql')],
  ['pruebas', leer('supabase/pruebas/supervision-exigibilidad/pruebas.sql')],
])

console.log(fallos ? `\n${fallos} suite(s) con fallas` : '\nTodas las suites SQL pasaron')
process.exit(fallos ? 1 : 0)
