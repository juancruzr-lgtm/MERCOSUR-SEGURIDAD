// Pruebas de 20261123120000_hoja_de_ruta_supervisores.sql sobre PGlite.
//   npm i --no-save @electric-sql/pglite@0.2.17
//   node supabase/pruebas/hoja-de-ruta/run.mjs [raíz del repo]
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const MIG = `${REPO}/supabase/migrations/20261123120000_hoja_de_ruta_supervisores.sql`
const RB = `${REPO}/supabase/rollback/20261123120000_hoja_de_ruta_supervisores_rollback.sql`
const db = new PGlite()
process.on('unhandledRejection', e => { console.error('ERROR:', e.message); process.exit(2) })
const resultados = []
const ok = (nombre, cond, extra = '') => { resultados.push([cond ? 'OK ' : 'FALLA', nombre, cond ? '' : extra]) }
const sql = async (t, p) => (await db.query(t, p)).rows
const uno = async (t, p) => (await sql(t, p))[0]
async function como(rol, uid, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${rol};`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
async function falla(fn, patron) {
  try { await fn(); return 'NO FALLÓ' } catch (e) { return patron.test(e.message) ? true : `otro error: ${e.message}` }
}
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const GER = id(1), GER_A = id(101), SUP = id(2), SUP_A = id(102), ALDO = id(3), RODO = id(4)

// Esqueleto mínimo de producción (columnas usadas y funciones de acceso vivas).
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls; -- como en Supabase
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
create table public.usuarios (id uuid primary key, auth_user_id uuid, rol text, puesto_organizacional text, estado text default 'activo', nombre text, apellido text, telefono text);
grant select on public.usuarios to authenticated;
create function public.puede_acceder_gerencia_actual() returns boolean language sql stable security definer as $$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' and u.puesto_organizacional = 'gerencia') $$;
grant execute on function public.puede_acceder_gerencia_actual() to authenticated;
insert into public.usuarios (id, auth_user_id, rol, puesto_organizacional, nombre, apellido, telefono) values
 ('${GER}', '${GER_A}', 'admin', 'gerencia', 'Juan Cruz', 'R', null),
 ('${SUP}', '${SUP_A}', 'supervisor', 'supervisor', 'SABINO', 'ARANDA', '3410000000'),
 ('${ALDO}', null, 'supervisor', 'jefe_supervisores', 'Aldo', 'Monzón', '3411111111'),
 ('${RODO}', null, 'admin', 'direccion_operativa', 'Rodolfo', 'Romero', '3412222222');
`)
await db.exec(readFileSync(MIG, 'utf8'))

// ── Destinatarios: los define Gerencia ──────────────────────────────────────
const guardarDest = (uid, u, d, a = true) => como('authenticated', uid, () => sql(`select public.hoja_ruta_guardar_destinatario($1, $2, $3)`, [u, d, a]))
ok('un supervisor no puede definir destinatarios', await falla(() => guardarDest(SUP_A, ALDO, 'Jefe de Supervisores'), /No autorizado/))
await guardarDest(GER_A, ALDO, 'Jefe de Supervisores')
await guardarDest(GER_A, RODO, 'Director Técnico')
ok('Gerencia carga a Aldo Monzón y Rodolfo Romero por separado', (await uno(`select count(*)::int n from hoja_ruta_destinatarios where activo`)).n === 2)
await guardarDest(GER_A, RODO, 'Director Técnico', false)
const rodo = await uno(`select activo, actualizado_por from hoja_ruta_destinatarios where usuario_id = $1`, [RODO])
ok('Gerencia lo desactiva y queda quién lo cambió', rodo.activo === false && rodo.actualizado_por === GER)
ok('el supervisor no ve la configuración (RLS)', (await como('authenticated', SUP_A, () => sql(`select * from hoja_ruta_destinatarios`))).length === 0)
ok('nadie escribe la tabla directo', await falla(() => como('authenticated', GER_A, () => sql(`insert into hoja_ruta_destinatarios (usuario_id, descripcion) values ($1, 'x x x')`, [SUP])), /permission denied/))

// ── Reclamo atómico: un solo mensaje por (turno, destinatario) ─────────────
const fila = (dest, extra = {}) => ({
  clave_turno: `sup:${SUP}|2026-10-29T10:00:00.000Z|2026-10-29T22:00:00.000Z`, supervisor_id: SUP, guardia_ids: [id(900)],
  turno_desde: '2026-10-29T10:00:00Z', turno_hasta: '2026-10-29T22:00:00Z', destinatario_id: dest, telefono: '5493411111111',
  mensaje: 'HOJA DE RUTA\nFecha: 29/10/2026', caracteres: 30, resultado: 'reclamado', ...extra,
})
const reclamar = f => como('service_role', null, () => uno(`select public.reclamar_hoja_ruta_envio($1::jsonb) r`, [JSON.stringify(f)]))
ok('el cliente (authenticated) no puede reclamar envíos', await falla(() => como('authenticated', GER_A, () => sql(`select public.reclamar_hoja_ruta_envio('{}'::jsonb)`)), /permission denied/))
const r1 = (await reclamar(fila(ALDO))).r
const r2 = (await reclamar(fila(ALDO))).r
ok('primer reclamo ok; el segundo (otra corrida) no envía', r1.ok === true && r2.ok === false && r2.motivo === 'ya_reclamado', JSON.stringify([r1, r2]))
const [ca, cb] = await Promise.all([reclamar(fila(RODO)), reclamar(fila(RODO))])
ok('dos corridas simultáneas: sólo una reclama', [ca.r.ok, cb.r.ok].filter(Boolean).length === 1, JSON.stringify([ca, cb]))
ok('hay exactamente una fila por destinatario y turno', (await uno(`select count(*)::int n from hoja_ruta_envios`)).n === 2)

const completar = (i, okk, err = null, fv = false) => como('service_role', null, () => uno(`select public.completar_hoja_ruta_envio($1, $2, $3, $4, $5) c`, [i, okk, okk ? 'wamid.1' : null, err, fv]))
ok('completar marca enviado', (await completar(r1.id, true)).c === true && (await uno(`select resultado from hoja_ruta_envios where id = $1`, [r1.id])).resultado === 'enviado')
ok('completar es idempotente (no pisa un resultado ya cerrado)', (await completar(r1.id, false, 'x')).c === false && (await uno(`select resultado from hoja_ruta_envios where id = $1`, [r1.id])).resultado === 'enviado')
const idR = (ca.r.ok ? ca.r : cb.r).id
await completar(idR, false, 'Re-engagement message (131047)', true)
ok('fuera de la ventana de 24 h queda registrado como tal y no se reintenta', (await uno(`select resultado from hoja_ruta_envios where id = $1`, [idR])).resultado === 'fuera_de_ventana'
  && (await reclamar(fila(RODO))).r.motivo === 'ya_reclamado')

// ── Excede el límite: se registra, no se envía, no se recorta ─────────────
const largo = 'x'.repeat(5000)
const rx = (await reclamar(fila(SUP, { clave_turno: 'sup:otro', mensaje: largo, caracteres: 5000, resultado: 'excede_limite' }))).r
const fx = await uno(`select resultado, length(mensaje)::int l, completado_at from hoja_ruta_envios where id = $1`, [rx.id])
ok('excede_limite: no habilita envío, guarda el mensaje completo', rx.ok === false && rx.motivo === 'excede_limite' && fx.resultado === 'excede_limite' && fx.l === 5000 && fx.completado_at, JSON.stringify(fx))
ok('un resultado inventado se rechaza', (await reclamar(fila(SUP, { clave_turno: 'sup:otro2', resultado: 'enviado' }))).r.motivo === 'resultado_invalido')

// ── Rollback ───────────────────────────────────────────────────────────────
const antes = (await uno(`select count(*)::int n from hoja_ruta_envios`)).n
await db.exec(readFileSync(RB, 'utf8'))
ok('rollback quita las funciones y conserva el registro',
  (await uno(`select count(*)::int n from pg_proc where proname in ('reclamar_hoja_ruta_envio','completar_hoja_ruta_envio','hoja_ruta_guardar_destinatario')`)).n === 0
  && (await uno(`select count(*)::int n from hoja_ruta_envios`)).n === antes)
await db.exec(readFileSync(MIG, 'utf8'))
ok('reaplicar después del rollback funciona (idempotente)', (await reclamar(fila(SUP, { clave_turno: 'sup:re' }))).r.ok === true)

for (const [estado, nombre, extra] of resultados) console.log(`${estado} ${nombre}${extra ? `\n      ${extra}` : ''}`)
const fallas = resultados.filter(r => r[0] === 'FALLA').length
console.log(`\n${resultados.length - fallas}/${resultados.length} controles OK`)
process.exit(fallas ? 1 : 0)
