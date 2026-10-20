// Prueba de 20261111120000 (línea original de ARCA + arca_relaciones_para_visual) sobre PGlite.
//   npm i --no-save @electric-sql/pglite@0.2.17
//   node supabase/pruebas/arca-txt-visual/run.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const MIG = `${REPO}/supabase/migrations/20261111120000_arca_txt_para_visual.sql`
const RB = `${REPO}/supabase/rollback/20261111120000_arca_txt_para_visual_rollback.sql`
const db = new PGlite()
const resultados = []
const ok = (nombre, cond, extra = '') => { resultados.push([cond ? 'OK ' : 'FALLA', nombre, extra]) }
const sql = async (texto, params) => (await db.query(texto, params)).rows
async function como(uid, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role authenticated;`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
async function falla(fn, patron) { try { await fn(); return 'NO FALLÓ' } catch (e) { return patron.test(e.message) ? true : `otro error: ${e.message}` } }
const importar = (fecha, filas) => sql(`select public.arca_relaciones_importar($1, 'ConsRelLab.txt', $2) as r`, [fecha, JSON.stringify(filas)]).then(r => r[0].r)
const paraVisual = () => sql(`select * from public.arca_relaciones_para_visual()`)

const ADM = '00000000-0000-0000-0000-000000000001'
const SUP = '00000000-0000-0000-0000-000000000002'
const U_EV = '00000000-0000-0000-0000-000000000010'

// Esqueleto mínimo (columnas de 20261017120000 y liq2g; permiso simplificado).
await db.exec(`
create role anon nologin; create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
create table public.usuarios (id uuid primary key, auth_user_id uuid, cuil text, estado text, legajo_visual text, puesto text);
create table public.liquidacion_persona (id uuid primary key default gen_random_uuid(), cuil text unique, cod_interno text);
create function public.legajo_puede_gestionar() returns boolean language sql stable security definer as $$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' and u.puesto = 'administracion') $$;
create function public.cuil_valido(p text) returns boolean language sql immutable as $$ select coalesce(p ~ '^\\d{11}$', false) $$;
create table public.arca_relaciones_laborales (
  id bigserial primary key, consulta_fecha date not null, cuil text not null check (cuil ~ '^\\d{11}$'), apellido_nombre text not null,
  modalidad text, fecha_inicio date not null, fecha_fin date, situacion_baja text, obra_social text, archivo text,
  cargado_por uuid references public.usuarios(id) on delete set null, cargado_at timestamptz not null default now(),
  unique (consulta_fecha, cuil, fecha_inicio));
alter table public.arca_relaciones_laborales enable row level security;
insert into public.usuarios values
  ('${ADM}', '${ADM}', '20000000001', 'activo', null, 'administracion'),
  ('${SUP}', '${SUP}', '20000000002', 'activo', null, 'supervisor'),
  ('${U_EV}', null, '20-11111111-2', 'inactivo', null, 'vigilador');
insert into public.liquidacion_persona (cuil, cod_interno) values ('27333333334', '0450');
`)
// Lo cargado antes de la migración (sin línea).
await sql(`insert into arca_relaciones_laborales (consulta_fecha, cuil, apellido_nombre, modalidad, fecha_inicio, fecha_fin) values
  ('2026-09-18', '20111111112', 'PEREZ JUAN', 'Contrato Eventual', '2026-09-01', '2026-09-30'),
  ('2026-09-18', '27333333334', 'GOMEZ ANA', 'Tiempo Indeterminado', '2025-01-01', null)`)

await db.exec(readFileSync(MIG, 'utf8'))
ok('la migración aplica', true)
await db.exec(readFileSync(MIG, 'utf8'))
ok('la migración se puede volver a aplicar', true)

const L1 = '20111111112 PEREZ JUAN'.padEnd(1020, ' ')
const L1b = '20111111112 PEREZ JUAN (MES)'.padEnd(1020, ' ')
const fila = (cuil, nombre, inicio, fin, linea) => ({ cuil, nombre, modalidad: 'Contrato Eventual', inicio, fin, baja: null, obra_social: 'OS', linea })

// Volver a subir la consulta del 18/09 (ya cargada sin línea): completa la línea, no duplica.
let r = await como(ADM, () => importar('2026-09-18', [fila('20111111112', 'PEREZ JUAN', '2026-09-01', '2026-09-30', L1)]))
ok('re-subir una consulta ya cargada no cuenta filas nuevas', r.nuevas === 0 && r.total_consulta === 2, JSON.stringify(r))
ok('…pero completa la línea original que faltaba',
  (await sql(`select linea_original from arca_relaciones_laborales where consulta_fecha = '2026-09-18' and cuil = '20111111112'`))[0].linea_original === L1)
r = await como(ADM, () => importar('2026-09-18', [fila('20111111112', 'PEREZ JUAN', '2026-09-01', '2026-09-30', L1b)]))
ok('una línea ya guardada no se pisa', (await sql(`select linea_original from arca_relaciones_laborales where consulta_fecha = '2026-09-18' and cuil = '20111111112'`))[0].linea_original === L1 && r.nuevas === 0)
// Consulta nueva: cuenta como nueva y guarda la línea; sin «linea» (cliente viejo) también funciona.
r = await como(ADM, () => importar('2026-10-13', [fila('20111111112', 'PEREZ JUAN', '2026-09-01', '2026-10-15', null), fila('20444444445', 'LOPEZ EVA', '2026-10-01', '2026-10-31', '20444444445 LOPEZ EVA'.padEnd(1020, ' '))]))
ok('consulta nueva: 2 relaciones nuevas', r.nuevas === 2 && r.total_consulta === 2, JSON.stringify(r))
ok('cliente viejo (sin línea): se guarda null', (await sql(`select linea_original from arca_relaciones_laborales where consulta_fecha = '2026-10-13' and cuil = '20111111112'`))[0].linea_original === null)
ok('línea demasiado larga recortada a 2000', await como(ADM, () => importar('2026-10-14', [fila('20555555556', 'X', '2026-10-01', null, 'x'.repeat(3000))])).then(async () =>
  (await sql(`select char_length(linea_original) n from arca_relaciones_laborales where cuil = '20555555556'`))[0].n === 2000))

// Lectura para Visual.
const v = await como(ADM, paraVisual)
const perez = v.find(x => x.cuil === '20111111112')
ok('una fila por CUIL', v.length === 4 && new Set(v.map(x => x.cuil)).size === 4, JSON.stringify(v.map(x => x.cuil)))
ok('toma la relación de la consulta más nueva', perez && String(perez.consulta_fecha.toISOString?.() ?? perez.consulta_fecha).startsWith('2026-10-13'))
ok('si la consulta más nueva no tiene la línea, usa la de una anterior de la misma relación', perez?.linea_original === L1)
ok('cruza con el usuario por CUIL (aunque tenga guiones) y su estado', perez?.empleado_id === U_EV && perez?.estado_app === 'inactivo')
ok('trae el legajo de Visual (liquidacion_persona)', v.find(x => x.cuil === '27333333334')?.legajo_visual === '0450')
ok('sin legajo de Visual → null', perez?.legajo_visual === null)
ok('supervisor no puede leerla', await falla(() => como(SUP, paraVisual), /Sólo Administración o Gerencia/))
ok('supervisor no puede importar', await falla(() => como(SUP, () => importar('2026-10-13', [fila('20111111112', 'X', '2026-09-01', null, null)])), /Sólo Administración o Gerencia/))
ok('anon no tiene permiso', await falla(async () => { await db.exec('set role anon'); try { await paraVisual() } finally { await db.exec('reset role') } }, /permission denied/))

// Rollback.
await db.exec(readFileSync(RB, 'utf8'))
const cols = await sql(`select column_name from information_schema.columns where table_name = 'arca_relaciones_laborales' and column_name = 'linea_original'`)
const fn = await sql(`select count(*)::int n from pg_proc where proname = 'arca_relaciones_para_visual'`)
ok('rollback: quita la columna y la función', cols.length === 0 && fn[0].n === 0)
r = await como(ADM, () => importar('2026-10-15', [fila('20111111112', 'PEREZ JUAN', '2026-09-01', null, L1)]))
ok('rollback: importar vuelve a andar como antes (ignora la línea)', r.nuevas === 1, JSON.stringify(r))
ok('rollback: las relaciones quedan intactas', (await sql(`select count(*)::int n from arca_relaciones_laborales`))[0].n === 6)

for (const [e, n, x] of resultados) console.log(`${e} ${n}${x && e !== 'OK ' ? `  → ${x}` : ''}`)
const fallas = resultados.filter(([e]) => e !== 'OK ').length
console.log(`\n${resultados.length - fallas}/${resultados.length} OK`)
process.exit(fallas ? 1 : 0)
