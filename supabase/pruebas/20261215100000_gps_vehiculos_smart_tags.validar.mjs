// Uso (fuera del proyecto, en una carpeta temporal):
//   npm i @electric-sql/pglite@0.2.17 && node 20261215100000_gps_vehiculos_smart_tags.validar.mjs <ruta-al-repo>
// No se agrega PGlite a package.json: es una validación puntual, no parte de npm test.
// Valida la migración/rollback de Smart Tags contra Postgres embebido (PGlite) con stubs mínimos
// de Supabase (auth.uid(), roles, usuarios, helpers de acceso). Datos 100 % ficticios.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'

const repo = process.argv[2]
const mig = readFileSync(`${repo}/supabase/migrations/20261215100000_gps_vehiculos_smart_tags.sql`, 'utf8')
const rb = readFileSync(`${repo}/supabase/rollback/20261215100000_gps_vehiculos_smart_tags_rollback.sql`, 'utf8')
const db = new PGlite()
let ok = 0, fail = 0
const check = (cond, msg) => { if (cond) { ok++; console.log('  OK  ', msg) } else { fail++; console.log('  FAIL', msg) } }
async function esperaError(sql, params, code, msg) {
  try { await db.query(sql, params); check(false, msg + ' (no falló)') }
  catch (e) { check(!code || e.code === code, `${msg} → ${e.code} ${e.message}`) }
}
const GER = '00000000-0000-0000-0000-00000000000a', GER_AUTH = '10000000-0000-0000-0000-00000000000a'
const SUPA = '00000000-0000-0000-0000-00000000000b', SUPA_AUTH = '10000000-0000-0000-0000-00000000000b'
const SUPB = '00000000-0000-0000-0000-00000000000c'
async function como(authId, rol = 'authenticated') {
  await db.exec(`reset role; select set_config('test.uid', '${authId ?? ''}', false); set role ${rol};`)
}

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  create table public.usuarios (id uuid primary key, auth_user_id uuid, estado text, puesto_organizacional text, rol text, nombre text);
  grant select on public.usuarios to authenticated, service_role;
  insert into public.usuarios values
    ('${GER}', '${GER_AUTH}', 'activo', 'gerencia', 'admin', 'Gerencia'),
    ('${SUPA}', '${SUPA_AUTH}', 'activo', 'supervisor', 'supervisor', 'Sup A'),
    ('${SUPB}', null, 'activo', 'supervisor', 'supervisor', 'Sup B');
  create function public.acceso_habilitado_actual() returns boolean language sql stable security definer as $$ select true $$;
  create function public.puede_acceder_gerencia_actual() returns boolean language sql stable security definer as $$
    select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.puesto_organizacional = 'gerencia') $$;
  grant usage on schema public to anon, authenticated, service_role;
`)
await db.exec(mig)
console.log('Migración aplicada sin errores')
await db.exec(`grant select, insert, update, delete on all tables in schema public to service_role;`)

// ── Gestión como Gerencia
await como(GER_AUTH)
const veh = (await db.query(`select public.gps_vehiculo_guardar(null, 'MOV-01', 'ab 123-cd') id`)).rows[0].id
const tag = (await db.query(`select public.gps_tag_guardar(null, 'HTAG prueba', 'simulado', null, 'activo', true) id`)).rows[0].id
check((await db.query(`select patente from gps_vehiculos`)).rows[0].patente === 'AB123CD', 'patente normalizada')
await esperaError(`select public.gps_tag_guardar(null, 'x', 'google_find_hub', 'aas_et/abc')`, [], '22023', 'identificador con pinta de credencial rechazado')
await db.query(`select public.gps_vehiculo_asignar_tag($1, $2)`, [veh, tag])
await db.query(`select public.gps_vehiculo_asignar_tag($1, $2)`, [veh, tag]) // idempotente
check((await db.query(`select count(*)::int n from gps_vehiculo_tag_asignaciones`)).rows[0].n === 1, 'asignar tag idempotente')
await esperaError(`select public.gps_vehiculo_asignar_supervisor($1, $2)`, [veh, GER], '22023', 'no se asigna a quien no es supervisor')
await db.query(`select public.gps_vehiculo_asignar_supervisor($1, $2)`, [veh, SUPA])
// retroceder la asignación para simular historia: A desde hace 3 h
await db.exec(`reset role; update gps_vehiculo_supervisor_asignaciones set desde = now() - interval '3 hours';
               update gps_vehiculo_tag_asignaciones set desde = now() - interval '3 hours';`)
await como(GER_AUTH)
check((await db.query(`select count(*)::int n from gps_vehiculos_accesos where accion = 'gestionar'`)).rows[0].n >= 4, 'gestión registrada en accesos')

// ── Supervisor: sin acceso
await como(SUPA_AUTH)
check((await db.query(`select count(*)::int n from gps_vehiculos`)).rows[0].n === 0, 'RLS: supervisor no ve vehículos')
check((await db.query(`select count(*)::int n from gps_tag_posiciones`)).rows[0].n === 0, 'RLS: supervisor no ve posiciones')
await esperaError(`select public.gps_vehiculo_guardar(null, 'MOV-02', 'AA000AA')`, [], '42501', 'supervisor no gestiona')
await esperaError(`insert into gps_tag_posiciones (tag_id, fuente, lat, lng, hora_ubicacion, hora_consulta) values ($1,'simulado',1,1,now(),now())`, [tag], '42501', 'navegador no inserta posiciones')
await esperaError(`select public.gps_tag_registrar_consulta($1, now(), 'ok', '[]')`, [tag], '42501', 'authenticated no ejecuta la ingesta')
await como(null, 'anon')
await esperaError(`select count(*) from gps_vehiculos`, [], '42501', 'anon sin acceso a tablas')

// ── Ingesta como servicio
await como(null, 'service_role')
const hDup = new Date(Date.now() - 2 * 3600e3).toISOString()
const pos1 = JSON.stringify([
  { lat: -34.6, lng: -58.4, hora_ubicacion: hDup, precision_m: 20 },
  { lat: -34.6, lng: -58.4, hora_ubicacion: hDup }, // duplicada en el lote
  { lat: 0, lng: 0, hora_ubicacion: new Date().toISOString() },                                // (0,0)
  { lat: 95, lng: 1, hora_ubicacion: new Date().toISOString() },                               // inválida
  { lat: -34.61, lng: -58.41, hora_ubicacion: new Date(Date.now() + 3600e3).toISOString() },   // futura
  { lat: 'x', lng: 1, hora_ubicacion: 'no' },                                                  // basura
])
let r = (await db.query(`select public.gps_tag_registrar_consulta($1, now(), 'ok', $2::jsonb, 1::smallint, 900) r`, [tag, pos1])).rows[0].r
check(r.resultado === 'nueva_posicion' && r.nuevas === 1 && r.recibidas === 6 && r.descartadas === 4, `ingesta filtra: ${JSON.stringify(r)}`)
r = (await db.query(`select public.gps_tag_registrar_consulta($1, now(), 'ok', $2::jsonb) r`, [tag, pos1])).rows[0].r
check(r.resultado === 'sin_novedad' && r.nuevas === 0, 'segunda consulta igual = sin_novedad, sin duplicar')
r = (await db.query(`select public.gps_tag_registrar_consulta($1, now(), 'ok', '[]'::jsonb) r`, [tag])).rows[0].r
check(r.resultado === 'sin_datos', 'respuesta vacía = sin_datos')
r = (await db.query(`select public.gps_tag_registrar_consulta($1, now(), 'error', '[{"lat":1,"lng":1,"hora_ubicacion":"2026-01-01T00:00:00Z"}]'::jsonb, 3::smallint, 100, 'timeout', $2) r`, [tag, 'x'.repeat(900)])).rows[0].r
check(r.resultado === 'error', 'error registrado')
check((await db.query(`select count(*)::int n from gps_tag_posiciones`)).rows[0].n === 1, 'consulta con error no guarda posiciones')
check((await db.query(`select length(error_detalle) l from gps_tag_consultas where resultado = 'error'`)).rows[0].l === 500, 'detalle de error truncado a 500')
await esperaError(`select public.gps_tag_registrar_consulta($1, now(), 'inventado')`, [tag], '22023', 'resultado inválido rechazado')

// ── Reasignación: el recorrido anterior conserva al supervisor anterior
await como(GER_AUTH)
await db.query(`select public.gps_vehiculo_asignar_supervisor($1, $2)`, [veh, SUPB])
await como(null, 'service_role')
const viejo = new Date(Date.now() - 60 * 60e3).toISOString() // detectada hace 1 h (cuando lo tenía A)
await new Promise(r => setTimeout(r, 1500)); const nuevo = new Date(Date.now() - 500).toISOString() // después de la reasignación
await db.query(`select public.gps_tag_registrar_consulta($1, now(), 'ok', $2::jsonb)`, [tag, JSON.stringify([
  { lat: -34.62, lng: -58.42, hora_ubicacion: viejo }, { lat: -34.63, lng: -58.43, hora_ubicacion: nuevo }])])
const atr = (await db.query(`select hora_ubicacion, supervisor_id, vehiculo_id from gps_tag_posiciones order by hora_ubicacion`)).rows
check(atr.at(-2).supervisor_id === SUPA && atr.at(-1).supervisor_id === SUPB, 'atribución por hora de ubicación tras reasignar')
check(atr.every(p => p.vehiculo_id === veh), 'todas atribuidas al vehículo')
check((await db.query(`select count(*)::int n from gps_vehiculo_supervisor_asignaciones where hasta is not null`)).rows[0].n === 1, 'asignación anterior cerrada, no borrada')

// ── Gerencia ve todo; registro de acceso
await como(GER_AUTH)
check((await db.query(`select count(*)::int n from gps_tag_posiciones`)).rows[0].n === 3, 'gerencia ve las posiciones')
await db.query(`select public.gps_vehiculos_registrar_acceso('ver_historial', $1, '{}')`, [veh])
check((await db.query(`select count(*)::int n from gps_vehiculos_accesos where accion = 'ver_historial'`)).rows[0].n === 1, 'acceso al historial registrado')

// ── Rollback
await db.exec(`reset role;`)
await db.exec(rb)
const quedan = (await db.query(`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'gps\\_%'`)).rows[0].n
const fns = (await db.query(`select count(*)::int n from pg_proc where proname like 'gps\\_%'`)).rows[0].n
check(quedan === 0 && fns === 0, `rollback limpio (relaciones=${quedan}, funciones=${fns})`)
check((await db.query(`select count(*)::int n from public.usuarios`)).rows[0].n === 3, 'rollback no toca usuarios')
await db.exec(mig)
check(true, 'la migración se puede volver a aplicar después del rollback')

console.log(`\nRESULTADO: ${ok} OK, ${fail} FAIL`)
process.exit(fail ? 1 : 0)
