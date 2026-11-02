// Pruebas SQL de programación, hoja de ruta y su integración con la auditoría
// de octubre, sobre PGlite (Postgres en memoria, aislado). Nunca toca Supabase.
//
//   npm i --no-save @electric-sql/pglite@0.2.17
//   node scripts/test-sql-pglite.mjs [ruta-al-repo]
//
// Equivale a scripts/test-sql-programacion.sh y scripts/test-sql-hoja-ruta.sh
// (que piden psql/pg_ctl) más tests/sql/integracion_superposicion_confirmada.sql.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url))
// PGlite no trae pgcrypto; gen_random_uuid() ya es nativo desde Postgres 13.
const leer = (rel) => readFileSync(join(REPO, rel), 'utf8')
  .replace(/^\\set .*$/gm, '')
  .replace(/^create extension if not exists pgcrypto.*$/gim, '')

// Un Postgres de Supabase trae estos roles y auth.uid(); el esquema mínimo no.
const BASE = `
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

// Sección 3 de 20261121120000: función + trigger de superposición, tal cual.
const TRIGGER_SUPERPOSICION = () => {
  const src = leer('supabase/migrations/20261121120000_turnos_cobertura_liquidacion.sql')
  const ini = src.indexOf('create or replace function public._turnos_superposicion_confirmada(')
  const fin = src.indexOf('for each row execute function public.turnos_validar_superposicion();') +
    'for each row execute function public.turnos_validar_superposicion();'.length
  if (ini < 0 || fin < ini) throw new Error('No se encontró turnos_validar_superposicion en 20261121120000')
  return `alter table public.turnos add column if not exists reemplaza_turno_id uuid references public.turnos(id) on delete set null;\n`
    + src.slice(ini, fin)
}

let fallos = 0
async function suite(nombre, pasos) {
  const db = new PGlite()
  const ok = []
  try {
    await db.exec(BASE)
    for (const [etiqueta, sql, errorEsperado] of pasos) {
      try {
        await db.exec(sql, { onNotice: (n) => { if (/^OK /.test(n.message)) ok.push(n.message) } })
      } catch (e) {
        if (errorEsperado && errorEsperado.test(e.message)) {
          await db.exec('rollback').catch(() => {})
          ok.push(`OK ${etiqueta}: se niega (${e.message})`)
          continue
        }
        throw new Error(`${etiqueta}: ${e.message}`)
      }
      if (errorEsperado) throw new Error(`${etiqueta}: debía fallar y aplicó`)
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

const PROG_MIG = 'supabase/migrations/20261113110000_programacion_conflictos_correccion_turnos.sql'
const PROG_RB = 'supabase/rollback/20261113110000_programacion_conflictos_correccion_turnos_rollback.sql'
const HR_MIG = 'supabase/migrations/20261114120000_hoja_ruta_supervisores.sql'
const HR_RB = 'supabase/rollback/20261114120000_hoja_ruta_supervisores_rollback.sql'

await suite('Programación (20261113110000) + rollback', [
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

await suite('Integración: superposición (#345) + confirmación (#346) + hoja de ruta', [
  ['esquema programación', leer('tests/sql/esquema_minimo_programacion.sql')],
  ['esquema hoja de ruta', leer('tests/sql/esquema_minimo_hoja_ruta.sql')],
  ['asignar previa', ASIGNAR_PREVIA()],
  ['programación', leer(PROG_MIG)],
  ['hoja de ruta', leer(HR_MIG)],
  ['trigger de superposición', TRIGGER_SUPERPOSICION()],
  ['pruebas de integración', leer('tests/sql/integracion_superposicion_confirmada.sql')],
  ['pruebas hoja de ruta con todo aplicado', leer('tests/sql/hoja_ruta.sql')],
  // Rollback de programación con el trigger de 20261121 todavía puesto: debe negarse.
  // Rollback de programación con el trigger de 20261121 todavía puesto: debe negarse.
  ['rollback programación fuera de orden', leer(PROG_RB), /Revertir primero 20261122120000/],
  ['quitar trigger (simula rollback de 20261121)', 'drop trigger if exists turnos_validar_superposicion on public.turnos;'],
  ['rollback hoja de ruta', leer(HR_RB)],
  ['rollback programación', leer(PROG_RB)],
])

await suite('Exigibilidad de supervisiones (20261113120000, #345)', [
  ['esquema', leer('supabase/pruebas/supervision-exigibilidad/esquema_minimo.sql')],
  ['migración', leer('supabase/migrations/20261113120000_supervision_exigibilidad_servicio.sql')],
  ['pruebas', leer('supabase/pruebas/supervision-exigibilidad/pruebas.sql')],
])

console.log(fallos ? `\n${fallos} suite(s) con fallas` : '\nTodas las suites SQL pasaron')
process.exit(fallos ? 1 : 0)
