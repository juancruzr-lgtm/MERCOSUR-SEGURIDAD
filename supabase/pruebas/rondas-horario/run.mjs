// Pruebas de 20261104120000_rondas_horario_sin_exigencia.sql sobre PGlite.
// Caso real: Laromet Baigorria — turno del sábado de 22 a 10 y del domingo de
// 10 a 22; los domingos desde las 06 no se exigen rondas.
// Uso: node supabase/pruebas/rondas-horario/run.mjs [raíz del repo]
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const db = new PGlite()
process.on('unhandledRejection', e => { console.error('ERROR:', e.message, e.where ?? ''); process.exit(2) })
const resultados = []
const ok = (nombre, cond, extra = '') => { resultados.push([cond ? 'OK ' : 'FALLA', nombre, extra]) }

const AUTH = n => `00000000-0000-0000-0000-00000000${String(1000 + n).padStart(4, '0')}`
const GER = AUTH(1), ADM = AUTH(2), JEFE = AUTH(3), SUP1 = AUTH(4), SUP2 = AUTH(5), VIG = AUTH(6)
const RANDSTAD = 'ac273ff2-71f6-4de2-ae4e-c0d518795dad', CASONA = '335179ef-af0e-41e7-9a38-66a2da661f48'
const PUESTO_R = '00000000-0000-0000-0000-0000000000b3'
const VIG_ID = '00000000-0000-0000-0000-000000002006', VIG2_ID = '00000000-0000-0000-0000-000000002007'

async function sql(texto, params) { return (await db.query(texto, params)).rows }
async function como(uid, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role authenticated;`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
async function falla(fn, patron) {
  try { await fn(); return 'NO FALLÓ' } catch (e) { return patron.test(e.message) ? true : `otro error: ${e.message}` }
}
const rpc = async (nombre, args = []) => {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ')
  return (await sql(`select public.${nombre}(${ph}) as r`, args))[0].r
}

// ── Esqueleto ───────────────────────────────────────────────────────────────
await db.exec(readFileSync(new URL('../protocolos/prelude.sql', import.meta.url), 'utf8'))
await db.exec(readFileSync(`${REPO}/supabase/migrations/20261022120000_protocolos_objetivo.sql`, 'utf8'))
await db.exec(`
create table public.app_config (key text primary key, value text);
create table public.registros_asistencia (id uuid primary key default gen_random_uuid(), turno_id uuid, tipo_registro text);
create table public.rondas_base (
  id uuid primary key default gen_random_uuid(), objetivo_id uuid not null references public.objetivos(id),
  puesto_id uuid references public.puestos(id), nombre text not null, descripcion text,
  intervalo_minutos integer not null, hora_inicio time, activo boolean not null default true,
  created_at timestamptz not null default now());
create table public.ronda_puntos (id uuid primary key default gen_random_uuid(), ronda_base_id uuid not null references public.rondas_base(id), nombre text not null, orden integer not null default 1, activo boolean not null default true);
CREATE OR REPLACE FUNCTION public.puede_administrar_rondas_objetivo(p_objetivo_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $f$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' and public.alcanza_objetivo(u.id, p_objetivo_id)) $f$;
-- Como en producción, authenticated lee rondas_base (la policy de la tabla nueva la consulta).
grant select on public.rondas_base to authenticated;
insert into public.puestos (id, objetivo_id, nombre) values ('00000000-0000-0000-0000-0000000000b4', '335179ef-af0e-41e7-9a38-66a2da661f48', 'Guardia');
`)
// La función tal como está hoy en producción.
await db.exec(readFileSync(`${REPO}/supabase/migrations/20260827120000_rondas_ausencia_no_exige.sql`, 'utf8'))

const RONDA = (await sql(`insert into rondas_base (objetivo_id, puesto_id, nombre, intervalo_minutos, created_at)
  values ($1, $2, 'Laromet baigorria', 120, '2026-01-01') returning id`, [RANDSTAD, PUESTO_R]))[0].id
const RONDA_CAS = (await sql(`insert into rondas_base (objetivo_id, puesto_id, nombre, intervalo_minutos, created_at)
  values ($1, '00000000-0000-0000-0000-0000000000b4', 'Perímetro', 120, '2026-01-01') returning id`, [CASONA]))[0].id
await sql(`insert into ronda_puntos (ronda_base_id, nombre) values ($1, 'Garita'), ($2, 'Portón')`, [RONDA, RONDA_CAS])
// Sábado 24/10/2026 22-10 (Ramos), domingo 25/10 10-22 (Silva), y un domingo en La Casona.
await sql(`insert into turnos (guardia_id, objetivo_id, puesto_id, fecha, hora_inicio, hora_fin) values
  ($1, $2, $3, '2026-10-24', '22:00', '10:00'),
  ($4, $2, $3, '2026-10-25', '10:00', '22:00'),
  ($4, $5, '00000000-0000-0000-0000-0000000000b4', '2026-10-25', '10:00', '22:00')`, [VIG_ID, RANDSTAD, PUESTO_R, VIG2_ID, CASONA])

const ventanas = async (obj) => (await sql(`select to_char(ventana_inicio at time zone 'America/Argentina/Buenos_Aires', 'Dy HH24:MI') v
  from rondas_ventanas_programadas($1, '2026-10-23', '2026-10-26') order by ventana_inicio`, [obj])).map(r => r.v)
const antesR = await ventanas(RANDSTAD), antesC = await ventanas(CASONA)
const turnosAntes = JSON.stringify(await sql('select * from turnos order by id'))
const todoAntes = JSON.stringify(await sql(`select * from rondas_ventanas_programadas(null, '2026-10-01', '2026-10-31') order by turno_id, indice`))
ok('Antes: el sábado pide 22, 00, 02, 04, 06 y 08; el domingo de día otras 6', antesR.length === 12 && antesR.includes('Sun 06:00') && antesR.includes('Sun 08:00'), antesR.join(','))

// ── Migración ───────────────────────────────────────────────────────────────
const MIG = `${REPO}/supabase/migrations/20261104120000_rondas_horario_sin_exigencia.sql`
await db.exec(readFileSync(MIG, 'utf8'))
await db.exec(readFileSync(MIG, 'utf8'))
ok('Migración idempotente (corre dos veces)', true)
ok('Sin horarios cargados la función devuelve exactamente lo mismo', JSON.stringify(await sql(`select * from rondas_ventanas_programadas(null, '2026-10-01', '2026-10-31') order by turno_id, indice`)) === todoAntes)
ok('Grants: authenticated sólo SELECT, anon nada', (await sql(`select count(*)::int n from information_schema.role_table_grants
  where table_name = 'ronda_horarios_sin_exigencia' and grantee in ('anon','authenticated') and privilege_type <> 'SELECT'`))[0].n === 0)
ok('La función de ventanas sigue sin EXECUTE para authenticated', (await sql(`select has_function_privilege('authenticated', 'public.rondas_ventanas_programadas(uuid,date,date)', 'EXECUTE') x`))[0].x === false)

// ── Quién carga ─────────────────────────────────────────────────────────────
const cargar = (args) => rpc('ronda_horario_sin_exigencia_agregar', args)
const DOM = [RONDA, 7, '06:00', '22:00', 'Domingo: portería en el ingreso, sin rondas (aclaración de Operaciones 19/10/2026)']
await como(VIG, async () => { ok('Vigilador: no carga', await falla(() => cargar(DOM), /permiso/)) })
await como(SUP1, async () => {
  ok('Supervisor de la zona: no carga (afecta la evaluación)', await falla(() => cargar(DOM), /permiso/))
})
await como(null, async () => { ok('Sin sesión: no carga', await falla(() => cargar(DOM), /permiso/)) })
let hId
await como(JEFE, async () => {
  ok('Sin motivo: rechazado', await falla(() => cargar([RONDA, 7, '06:00', '22:00', '  ']), /motivo/))
  ok('Horario al revés: rechazado', await falla(() => cargar([RONDA, 7, '22:00', '06:00', 'x']), /terminar despues/))
  ok('Día inválido: rechazado', await falla(() => cargar([RONDA, 0, '06:00', '22:00', 'x']), /Dia invalido/))
  const r = await cargar(DOM)
  hId = r.id
  ok('Jefe de supervisores: carga domingo 06 a 22', r.ok === true)
  ok('Superpuesto el mismo día: rechazado', await falla(() => cargar([RONDA, 7, '20:00', '23:00', 'x']), /superpone/))
})

// ── Efecto ──────────────────────────────────────────────────────────────────
const despuesR = await ventanas(RANDSTAD)
ok('Sábado a la noche: siguen 22, 00, 02 y 04', JSON.stringify(despuesR) === JSON.stringify(['Sat 22:00', 'Sun 00:00', 'Sun 02:00', 'Sun 04:00']), despuesR.join(','))
ok('Domingo desde las 06: no se exige ninguna ronda (ni del sábado ni del turno de día)', despuesR.every(v => !/^Sun (0[6-9]|1[0-9]|2[01])/.test(v)))
ok('Otro objetivo (La Casona) no cambia', JSON.stringify(await ventanas(CASONA)) === JSON.stringify(antesC))
ok('Los turnos no cambian', JSON.stringify(await sql('select * from turnos order by id')) === turnosAntes)

// ── Ver ─────────────────────────────────────────────────────────────────────
await como(SUP1, async () => { ok('Supervisor de la zona: ve el horario', (await sql(`select count(*)::int n from ronda_horarios_sin_exigencia`))[0].n === 1) })
await como(SUP2, async () => { ok('Supervisor de otra zona: no lo ve', (await sql(`select count(*)::int n from ronda_horarios_sin_exigencia`))[0].n === 0) })
await como(VIG, async () => { ok('Vigilador: no lo ve', (await sql(`select count(*)::int n from ronda_horarios_sin_exigencia`))[0].n === 0) })

// ── Integridad ──────────────────────────────────────────────────────────────
ok('No se edita', await falla(() => sql(`update ronda_horarios_sin_exigencia set hasta = '23:00' where id = $1`, [hId]), /no se edita/))
ok('No se borra', await falla(() => sql(`delete from ronda_horarios_sin_exigencia where id = $1`, [hId]), /no se borran/))
ok('TRUNCATE rechazado', await falla(() => sql(`truncate ronda_horarios_sin_exigencia`), /inmutables/))
ok('Escritura directa como usuario: rechazada', await como(GER, () => falla(() => sql(`insert into ronda_horarios_sin_exigencia (ronda_base_id, dia_semana, desde, hasta, motivo) values ($1, 1, '00:00', '01:00', 'x')`, [RONDA]), /permission denied/)))

// ── Dar de baja ─────────────────────────────────────────────────────────────
await como(ADM, async () => {
  ok('Baja sin motivo: rechazada', await falla(() => rpc('ronda_horario_sin_exigencia_quitar', [hId, '']), /motivo/))
  ok('Administración: da de baja con motivo', (await rpc('ronda_horario_sin_exigencia_quitar', [hId, 'Prueba de baja'])).ok === true)
  ok('Baja dos veces: idempotente', (await rpc('ronda_horario_sin_exigencia_quitar', [hId, 'otra'])).ya_estaba === true)
})
ok('Dado de baja: vuelven a exigirse las ventanas', JSON.stringify(await ventanas(RANDSTAD)) === JSON.stringify(antesR))
ok('Dado de baja: no se modifica', await falla(() => sql(`update ronda_horarios_sin_exigencia set motivo_baja = 'x' where id = $1`, [hId]), /dado de baja/))
await como(GER, async () => { await cargar(DOM) })
ok('Se puede volver a cargar después de una baja', (await ventanas(RANDSTAD)).length === 4)

// ── Rollback ────────────────────────────────────────────────────────────────
await db.exec(readFileSync(`${REPO}/supabase/rollback/20261104120000_rondas_horario_sin_exigencia_rollback.sql`, 'utf8'))
ok('Rollback: la función vuelve a la de hoy (mismas ventanas que antes)', JSON.stringify(await sql(`select * from rondas_ventanas_programadas(null, '2026-10-01', '2026-10-31') order by turno_id, indice`)) === todoAntes)
ok('Rollback: sin tabla ni funciones nuevas', (await sql(`select (select count(*) from pg_class where relname = 'ronda_horarios_sin_exigencia')::int t,
  (select count(*) from pg_proc where proname like 'ronda_horario%')::int f`))[0].t === 0)
await db.exec(readFileSync(MIG, 'utf8'))
ok('Reaplicar después del rollback', JSON.stringify(await sql(`select * from rondas_ventanas_programadas(null, '2026-10-01', '2026-10-31') order by turno_id, indice`)) === todoAntes)

for (const [r, n, e] of resultados) console.log(`${r} ${n}${e && r !== 'OK ' ? '  → ' + e : ''}`)
const fallas = resultados.filter(r => r[0] !== 'OK ').length
console.log(`\n${resultados.length - fallas}/${resultados.length} controles OK`)
process.exit(fallas ? 1 : 0)
