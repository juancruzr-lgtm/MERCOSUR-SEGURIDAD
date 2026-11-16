// Pruebas de 20261215120000_gestion_casos_tablero.sql sobre PGlite (SIN producción).
// Usa el prelude de protocolos (roles, auth.uid, alcance_operativo_de,
// alcanza_objetivo y puede_acceder_gerencia_actual copiados de producción).
// Uso:
//   npm i --no-save @electric-sql/pglite@0.2.17
//   node supabase/pruebas/gestion-casos/run.mjs [raíz del repo]
// (PGLITE_MODULE permite apuntar a una instalación fuera del repo.)
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite')
const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const db = new PGlite()
const resultados = []
const ok = (nombre, cond, extra = '') => resultados.push([cond ? 'OK ' : 'FALLA', nombre, extra])
const sql = async (t, p) => (await db.query(t, p)).rows
async function como(uid, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role authenticated;`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
async function falla(fn) { try { await fn(); return null } catch (e) { return e.message } }

const GER = '00000000-0000-0000-0000-0000000000a1'
const SUP = '00000000-0000-0000-0000-0000000000a2'
const SUP_OTRA = '00000000-0000-0000-0000-0000000000a3'
const VIG = '00000000-0000-0000-0000-0000000000a4'
const Z1_OBJ = 'ac273ff2-71f6-4de2-ae4e-c0d518795dad' // RANDSTAD, zona 1

await db.exec(readFileSync(`${REPO}/supabase/pruebas/protocolos/prelude.sql`, 'utf8'))
await db.exec(`
create function public.acceso_habilitado_actual() returns boolean language sql stable as $$ select true $$;
grant execute on function public.acceso_habilitado_actual() to authenticated;
create table public.registros_asistencia (id uuid primary key default gen_random_uuid());
create table public.ronda_alertas (id uuid primary key default gen_random_uuid());
create table public.salidas_anticipadas (id uuid primary key default gen_random_uuid());
create table cron_job_stub (x int);
insert into public.usuarios (id, auth_user_id, puesto_organizacional, nombre) values
  (gen_random_uuid(), '${GER}', 'gerencia', 'Gerente'),
  ('10000000-0000-0000-0000-000000000002', '${SUP}', 'supervisor', 'Sup zona 1'),
  ('10000000-0000-0000-0000-000000000003', '${SUP_OTRA}', 'supervisor', 'Sup zona 2'),
  ('10000000-0000-0000-0000-000000000004', '${VIG}', 'vigilador', 'Vigilador');
insert into public.supervisor_zonas values
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000a001'),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000a002');
`)

const mig = readFileSync(`${REPO}/supabase/migrations/20261215120000_gestion_casos_tablero.sql`, 'utf8')
await db.exec(mig)
ok('migración aplica en base vacía', true)

const reglas = await sql(`select estado, count(*)::int n from public.gestion_reglas group by estado order by estado`)
ok('7 existentes y 7 propuestas, ninguna aprobada', JSON.stringify(reglas) === JSON.stringify([{ estado: 'existente', n: 7 }, { estado: 'propuesta', n: 7 }]), JSON.stringify(reglas))

const [{ id: casoId }] = await sql(`insert into public.gestion_casos (clave, regla, tipo, gravedad, objetivo_id, empleado_id, fecha_hecho, plazo_at)
  values ('ASI-01|t1', 'ASI-01', 'sin_fichaje', 'alta', $1, '10000000-0000-0000-0000-000000000004', '2026-11-10', now() + interval '1 day') returning id`, [Z1_OBJ])
const dup = await falla(() => sql(`insert into public.gestion_casos (clave, regla, tipo, gravedad, fecha_hecho) values ('ASI-01|t1','ASI-01','sin_fichaje','alta','2026-11-10')`))
ok('clave única: el mismo hecho no genera dos casos', !!dup)

const accion = (uid, args) => como(uid, async () => {
  const n = Object.keys(args)
  return (await sql(`select public.gestion_caso_accion(${n.map((k, i) => `${k} => $${i + 1}`).join(', ')}) r`, n.map(k => args[k])))[0].r
})
const op = () => crypto.randomUUID()

// Lectura por alcance
ok('supervisor de la zona ve el caso', (await como(SUP, () => sql('select id from public.gestion_casos'))).length === 1)
ok('supervisor de otra zona no lo ve', (await como(SUP_OTRA, () => sql('select id from public.gestion_casos'))).length === 0)
ok('vigilador no lo ve', (await como(VIG, () => sql('select id from public.gestion_casos'))).length === 0)
ok('nadie escribe directo', !!(await falla(() => como(GER, () => sql(`update public.gestion_casos set estado = 'verificado'`)))))

// Circuito
const o1 = op()
let r = await accion(SUP, { p_operacion_id: o1, p_caso_id: casoId, p_accion: 'revisar', p_version: 1 })
ok('revisar → en_revision', r.estado === 'en_revision' && r.version === 2, JSON.stringify(r))
r = await accion(SUP, { p_operacion_id: o1, p_caso_id: casoId, p_accion: 'revisar', p_version: 1 })
ok('misma operación es idempotente', r.duplicada === true)
r = await accion(SUP, { p_operacion_id: op(), p_caso_id: casoId, p_accion: 'asignar', p_version: 1, p_responsable_id: '10000000-0000-0000-0000-000000000002' })
ok('versión vieja → conflicto', r.ok === false && r.error === 'conflicto')
ok('fuera de alcance rechazado', /alcance/.test(await falla(() => accion(SUP_OTRA, { p_operacion_id: op(), p_caso_id: casoId, p_accion: 'revisar', p_version: 2 })) ?? ''))
ok('comunicar sin comunicación registrada rechazado', !!(await falla(() => accion(GER, { p_operacion_id: op(), p_caso_id: casoId, p_accion: 'solicitar_explicacion', p_version: 2, p_comunicacion_id: crypto.randomUUID() }))))

const [{ id: comId }] = await sql(`insert into public.gestion_comunicaciones (caso_ids, plantilla, nombre_meta, destinatario_id, telefono, texto, clave_envio, preparado_por)
  values (array[$1::uuid], 'VIG_FICHAJE_PENDIENTE', 'gestion_fichaje_pendiente_vigilador', '10000000-0000-0000-0000-000000000004', '5493415551234', 'texto', 'k1', '10000000-0000-0000-0000-000000000002') returning id`, [casoId])
r = await accion(GER, { p_operacion_id: op(), p_caso_id: casoId, p_accion: 'solicitar_explicacion', p_version: 2, p_comunicacion_id: comId })
ok('comunicar → comunicado (no resuelve)', r.estado === 'comunicado')
ok('comunicación autorizada exige autorizante', !!(await falla(() => sql(`update public.gestion_comunicaciones set estado = 'enviada' where id = $1`, [comId]))))
r = await accion(SUP, { p_operacion_id: op(), p_caso_id: casoId, p_accion: 'registrar_respuesta', p_version: 3, p_comentario: 'Estuvo, se olvidó de fichar' })
ok('respuesta → respondido', r.estado === 'respondido')
ok('resolver sin causa rechazado', !!(await falla(() => accion(SUP, { p_operacion_id: op(), p_caso_id: casoId, p_accion: 'marcar_resuelto', p_version: 4, p_comentario: 'ok listo' }))))
r = await accion(SUP, { p_operacion_id: op(), p_caso_id: casoId, p_accion: 'marcar_resuelto', p_version: 4, p_comentario: 'Asistencia acreditada', p_causa: 'conducta' })
ok('resolver → resuelto', r.estado === 'resuelto')
r = await accion(GER, { p_operacion_id: op(), p_caso_id: casoId, p_accion: 'verificar', p_version: 5, p_condicion_vigente: true })
ok('verificar con condición vigente → reabierto', r.estado === 'reabierto')
r = await accion(GER, { p_operacion_id: op(), p_caso_id: casoId, p_accion: 'marcar_resuelto', p_version: 6, p_comentario: 'Corregido el fichaje', p_causa: 'administrativa' })
r = await accion(GER, { p_operacion_id: op(), p_caso_id: casoId, p_accion: 'verificar', p_version: 7, p_condicion_vigente: false })
ok('verificar sin condición → verificado', r.estado === 'verificado')
ok('caso verificado no admite asignar', !!(await falla(() => accion(GER, { p_operacion_id: op(), p_caso_id: casoId, p_accion: 'asignar', p_version: 8, p_responsable_id: '10000000-0000-0000-0000-000000000002' }))))
const ev = await sql(`select accion from public.gestion_caso_eventos where caso_id = $1 order by created_at`, [casoId])
ok('historial append-only: 7 eventos (el intento en conflicto no deja evento)', ev.length === 7, ev.map(e => e.accion).join(','))
ok('supervisor ve el historial de su caso', (await como(SUP, () => sql('select id from public.gestion_caso_eventos'))).length === 7)

// Reglas
ok('supervisor no aprueba reglas', !!(await falla(() => como(SUP, () => sql(`select public.gestion_regla_decidir('HOR-01','aprobada','prueba')`)))))
await como(GER, () => sql(`select public.gestion_regla_decidir('HOR-01','aprobada','Aprobada por Gerencia')`))
ok('Gerencia aprueba una regla propuesta', (await sql(`select estado from public.gestion_reglas where codigo='HOR-01'`))[0].estado === 'aprobada')
ok('una regla existente no se toca por esta vía', !!(await falla(() => como(GER, () => sql(`select public.gestion_regla_decidir('ASI-01','suspendida','x y z')`)))))

// Rollback
await db.exec(readFileSync(`${REPO}/supabase/rollback/20261215120000_gestion_casos_tablero_rollback.sql`, 'utf8'))
ok('rollback deja la base sin objetos gestion_*', (await sql(`select count(*)::int n from pg_class where relname like 'gestion_%' and relkind = 'r'`))[0].n === 0)
await db.exec(mig)
ok('la migración se puede volver a aplicar después del rollback', true)

let fallas = 0
for (const [e, n, x] of resultados) { if (e !== 'OK ') fallas++; console.log(e, n, x) }
console.log(`\n${resultados.length - fallas}/${resultados.length} controles OK`)
process.exit(fallas ? 1 : 0)
