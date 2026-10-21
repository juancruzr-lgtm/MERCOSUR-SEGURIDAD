// Prueba de 20261112120000 (Diferencias con ARCA con consultas de movimientos) sobre PGlite.
//   npm i --no-save @electric-sql/pglite@0.2.17
//   node supabase/pruebas/arca-consultas-acumuladas/run.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const BASE = `${REPO}/supabase/migrations/20261017120000_legajo_diferencias_arca.sql`
const MIG = `${REPO}/supabase/migrations/20261112120000_arca_consultas_acumuladas.sql`
const RB = `${REPO}/supabase/rollback/20261112120000_arca_consultas_acumuladas_rollback.sql`
const db = new PGlite()
const resultados = []
const ok = (nombre, cond, extra = '') => { resultados.push([cond ? 'OK ' : 'FALLA', nombre, extra]) }
const sql = async (texto, params) => (await db.query(texto, params)).rows
const ADM = '00000000-0000-0000-0000-000000000001'
const como = async fn => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${ADM}', false); set role authenticated;`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
const difs = () => como(() => sql(`select tipo, persona, cuil, clave, detalle from public.legajo_diferencias() order by tipo, persona`))

await db.exec(`
create role anon nologin; create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
create table public.usuarios (id uuid primary key default gen_random_uuid(), auth_user_id uuid, apellido text, nombre text, rol text, estado text,
  cuil text, dni text, es_prueba boolean default false, puesto_organizacional text, legajo_visual text);
create table public.registros_asistencia (id uuid primary key default gen_random_uuid(), guardia_id uuid, created_at timestamptz default now());
create table public.turnos (id uuid primary key default gen_random_uuid(), guardia_id uuid, fecha date);
create table public.legajo_datos_personales (empleado_id uuid primary key, fecha_ingreso date);
create function public.legajo_puede_gestionar() returns boolean language sql stable security definer as $$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.puesto_organizacional = 'administracion') $$;
insert into public.usuarios (id, auth_user_id, apellido, nombre, rol, estado, cuil, dni, puesto_organizacional) values
  ('${ADM}', '${ADM}', 'ADMIN', 'X', 'admin', 'inactivo', null, null, 'administracion'),
  ('00000000-0000-0000-0000-000000000010', null, 'SIGUE', 'TRABAJANDO', 'guardia', 'activo', '20111111112', '11111111', 'vigilador'),
  ('00000000-0000-0000-0000-000000000011', null, 'RENUNCIO', 'EN ARCA', 'guardia', 'activo', '20222222223', '22222222', 'vigilador'),
  ('00000000-0000-0000-0000-000000000012', null, 'NUNCA', 'CARGADO', 'guardia', 'activo', '20333333334', '33333333', 'vigilador'),
  ('00000000-0000-0000-0000-000000000013', null, 'BAJA', 'EN APP', 'guardia', 'inactivo', '20444444445', '44444444', 'vigilador');
insert into public.legajo_datos_personales values
  ('00000000-0000-0000-0000-000000000010', '2023-02-01'), ('00000000-0000-0000-0000-000000000011', '2024-01-01'), ('00000000-0000-0000-0000-000000000012', '2025-01-01');
`)
await db.exec(readFileSync(BASE, 'utf8'))
// 13/10: nómina (completa). 21/10: sólo movimientos (la renuncia de uno).
await sql(`insert into arca_relaciones_laborales (consulta_fecha, cuil, apellido_nombre, modalidad, fecha_inicio, fecha_fin, situacion_baja) values
  ('2026-10-13', '20111111112', 'SIGUE TRABAJANDO', 'Tiempo indeterminado', '2023-02-01', null, null),
  ('2026-10-13', '20222222223', 'RENUNCIO EN ARCA', 'Tiempo indeterminado', '2024-01-01', null, null),
  ('2026-10-13', '20444444445', 'BAJA EN APP', 'Tiempo indeterminado', '2022-01-01', null, null),
  ('2026-10-21', '20222222223', 'RENUNCIO EN ARCA', 'Tiempo indeterminado', '2024-01-01', '2026-10-20', 'Renuncia del trabajador')`)

let d = await difs()
ok('antes (20261017): los que siguen trabajando aparecen como «no figura en ARCA»',
  d.filter(x => x.tipo === 'activo_sin_relacion').length === 2, JSON.stringify(d.filter(x => x.tipo === 'activo_sin_relacion').map(x => x.persona)))

await db.exec(readFileSync(MIG, 'utf8'))
ok('la migración aplica', true)
d = await difs()
const sinRel = d.filter(x => x.tipo === 'activo_sin_relacion')
ok('sólo se avisa al que ARCA informó la baja', sinRel.length === 1 && sinRel[0].cuil === '20222222223', JSON.stringify(sinRel.map(x => x.persona)))
ok('…con la baja, la consulta donde vino y una clave estable', sinRel[0]?.detalle.baja === 'Renuncia del trabajador'
  && String(sinRel[0]?.detalle.consulta).startsWith('2026-10-21') && sinRel[0]?.clave === 'sin_relacion:00000000-0000-0000-0000-000000000011:20222222223:2024-01-01')
ok('el que no aparece en la última consulta pero sí en una anterior no se marca', !d.some(x => x.persona?.startsWith('SIGUE') && x.tipo === 'activo_sin_relacion'))
ok('el que nunca apareció en una consulta no se marca', !d.some(x => x.persona?.startsWith('NUNCA') && x.tipo === 'activo_sin_relacion'))
ok('relación vigente (13/10) sin usuario activo se sigue avisando', d.some(x => x.tipo === 'relacion_sin_usuario' && x.cuil === '20444444445'))
ok('la relación con baja en ARCA no es «vigente sin usuario»', !d.some(x => x.tipo === 'relacion_sin_usuario' && x.cuil === '20222222223'))
const fin = d.find(x => x.tipo === 'contrato_con_fin')
ok('el contrato con fin toma el estado más reciente', fin?.cuil === '20222222223' && String(fin?.detalle.fin).startsWith('2026-10-20'))
// Otra consulta de movimientos que no trae a nadie de estos: nada cambia ni se reabre.
await sql(`insert into arca_relaciones_laborales (consulta_fecha, cuil, apellido_nombre, modalidad, fecha_inicio) values ('2026-10-22', '20999999990', 'OTRO ALTA', 'Eventual', '2026-10-22')`)
const d2 = await difs()
ok('una consulta nueva sin estas personas no cambia sus avisos ni sus claves',
  JSON.stringify(d2.filter(x => x.tipo === 'activo_sin_relacion').map(x => x.clave)) === JSON.stringify(sinRel.map(x => x.clave)))
const r = (await como(() => sql(`select public.legajo_diferencias_resumen() r`)))[0].r
ok('resumen: relaciones vigentes acumuladas', r.vigentes === 3 && String(r.consulta).startsWith('2026-10-22'), JSON.stringify(r))
ok('por empleado sigue andando', (await como(() => sql(`select count(*)::int n from public.legajo_diferencias('00000000-0000-0000-0000-000000000011')`)))[0].n >= 1)

await db.exec(readFileSync(RB, 'utf8'))
const d3 = await difs()
ok('rollback: vuelve a comparar contra la última consulta', d3.filter(x => x.tipo === 'activo_sin_relacion').length === 3, String(d3.filter(x => x.tipo === 'activo_sin_relacion').length))
ok('rollback: el resumen vuelve sin «vigentes»', !('vigentes' in (await como(() => sql(`select public.legajo_diferencias_resumen() r`)))[0].r))

for (const [e, n, x] of resultados) console.log(`${e} ${n}${x && e !== 'OK ' ? `  → ${x}` : ''}`)
const fallas = resultados.filter(([e]) => e !== 'OK ').length
console.log(`\n${resultados.length - fallas}/${resultados.length} OK`)
process.exit(fallas ? 1 : 0)
