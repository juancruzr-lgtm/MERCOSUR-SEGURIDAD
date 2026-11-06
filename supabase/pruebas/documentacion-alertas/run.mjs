// Pruebas de las alertas de vencimiento de la documentación del legajo sobre
// PGlite: 20261009170000 (lo que está en producción) + 20261205140000 (listas
// para prender).
//
// Casos: interruptor apagado, documentos vigentes / por vencer / vencidos /
// sin vencimiento / faltantes (incluir_faltantes en false y en true),
// credenciales de habilitación, idempotencia, resolución al reemplazar,
// permisos por rol, inmutabilidad y hora de Argentina.
//
// Uso: node supabase/pruebas/documentacion-alertas/run.mjs [raíz del repo]
//   Si @electric-sql/pglite no está en node_modules, PGLITE=<ruta a dist/index.js>.
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { PGlite } = await import(process.env.PGLITE ? pathToFileURL(process.env.PGLITE).href : '@electric-sql/pglite')
const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const db = new PGlite()
process.on('unhandledRejection', e => { console.error('ERROR:', e.message, e.where ?? ''); process.exit(2) })
const resultados = []
const ok = (nombre, cond, extra = '') => { resultados.push([cond ? 'OK ' : 'FALLA', nombre, extra]) }

const AUTH = n => `00000000-0000-0000-0000-00000000${String(1000 + n).padStart(4, '0')}`
const ID = n => `00000000-0000-0000-0000-00000000${String(2000 + n).padStart(4, '0')}`
const GER = AUTH(1), ADM = AUTH(2), SUP = AUTH(3), V1 = AUTH(4), V2 = AUTH(5), V3 = AUTH(6)
const ID_GER = ID(1), ID_ADM = ID(2), ID_SUP = ID(3), ID_V1 = ID(4), ID_V2 = ID(5), ID_V3 = ID(6), ID_BAJA = ID(7), ID_PRUEBA = ID(8)

async function sql(texto, params) { return (await db.query(texto, params)).rows }
async function como(uid, fn, rol = 'authenticated') {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${rol};`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
async function falla(fn, patron) {
  try { await fn(); return false } catch (e) { return patron.test(e.message) ? true : (console.error('otro error:', e.message), false) }
}
const rpc = async (nombre, args = []) => {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ')
  return (await sql(`select public.${nombre}(${ph}) as r`, args))[0].r
}
const generar = () => como(null, () => rpc('documentacion_alertas_generar'), 'service_role')
const contar = async (where = 'true') => (await sql(`select count(*)::int n from documentacion_alertas where ${where}`))[0].n
const misAlertas = uid => como(uid, () => rpc('documentacion_mis_alertas'))
const verTabla = uid => como(uid, () => sql(`select empleado_id, tipo, motivo from documentacion_alertas order by id`))

// ── Carga ───────────────────────────────────────────────────────────────────
await db.exec(`set timezone = 'UTC'`) // como Supabase
await db.exec(readFileSync(new URL('./prelude.sql', import.meta.url), 'utf8'))
await db.exec(readFileSync(`${REPO}/supabase/migrations/20261009170000_documentacion_alertas.sql`, 'utf8'))
// En producción las tres tablas tienen además la restrictiva de bajas.
for (const t of ['documentacion_alertas', 'documentacion_alertas_config', 'documentacion_alertas_config_historial']) {
  await db.exec(`create policy acceso_bloqueado_baja on public.${t} as restrictive for all to authenticated using ((select public.acceso_habilitado_actual()))`)
}
const MIG = `${REPO}/supabase/migrations/20261205140000_documentacion_alertas_listas.sql`
await db.exec(readFileSync(MIG, 'utf8'))
await db.exec(readFileSync(MIG, 'utf8'))
ok('Migración idempotente (corre dos veces)', true)

// ── Datos ───────────────────────────────────────────────────────────────────
await sql(`insert into usuarios (id, auth_user_id, puesto_organizacional, rol, nombre, apellido, estado, es_prueba) values
  ('${ID_GER}', '${GER}', 'gerencia', 'admin', 'Gere', 'Ncia', 'activo', false),
  ('${ID_ADM}', '${ADM}', 'administracion', 'admin', 'Admi', 'Nistra', 'activo', false),
  ('${ID_SUP}', '${SUP}', 'supervisor', 'supervisor', 'Super', 'Visor', 'activo', false),
  ('${ID_V1}', '${V1}', 'vigilador', 'guardia', 'Uno', 'Vigilador', 'activo', false),
  ('${ID_V2}', '${V2}', 'vigilador', 'guardia', 'Dos', 'Vigilador', 'activo', false),
  ('${ID_V3}', '${V3}', null, 'guardia', 'Tres', 'Vigilador', 'activo', false),
  ('${ID_BAJA}', null, 'vigilador', 'guardia', 'De', 'Baja', 'inactivo', false),
  ('${ID_PRUEBA}', null, 'vigilador', 'guardia', 'De', 'Prueba', 'activo', true)`)
await sql(`insert into documentacion_tipos (codigo, nombre, requisito, campo_vencimiento, vigencia_meses, sensibilidad, activo) values
  ('credencial', 'Credencial', 'obligatorio', 'declarado', null, 'comun', true),
  ('antecedentes_rnr', 'Antecedentes RNR', 'obligatorio', 'calculado', 6, 'sensible', true),
  ('dni', 'DNI', 'obligatorio', 'no', null, 'comun', true),
  ('codem', 'CODEM', 'obligatorio', 'no', null, 'comun', true),
  ('cursos', 'Cursos', 'opcional', 'no', null, 'comun', true),
  ('alta_art', 'Alta ART', 'obligatorio', 'no', null, 'comun', false),
  ('actuaciones_legales', 'Actuaciones legales', 'si_corresponde', 'no', null, 'reservado_gerencia', true)`)
const doc = async (empleado, tipo, estado, vence, extra = {}) => (await sql(
  `insert into documentacion_documentos (empleado_id, tipo, sensibilidad, estado, vence_el, creado_at)
   values ($1, $2, (select sensibilidad from documentacion_tipos where codigo = $2), $3,
           case when $4::int is null then null else public.documentacion_hoy() + $4::int end, coalesce($5::timestamptz, now())) returning id`,
  [empleado, tipo, estado, vence, extra.creado ?? null]))[0].id
const credencial = async (empleado, vence, documento = null, verificada = true) => (await sql(
  `insert into habilitacion_credenciales (empleado_id, vence_el, documento_id, verificada, numero)
   values ($1, public.documentacion_hoy() + $2::int, $3, $4, 'N1') returning id`, [empleado, vence, documento, verificada]))[0].id

// V1: RNR vencido hace 10 días, DNI sin vencimiento, curso que vence en 200 días,
//     credencial informada (sin foto) que vence en 5 días, CODEM "no corresponde".
const rnrV1 = await doc(ID_V1, 'antecedentes_rnr', 'aprobado', -10)
await doc(ID_V1, 'dni', 'aprobado', null)
await doc(ID_V1, 'cursos', 'aceptado', 200)
const credV1 = await credencial(ID_V1, 5, null, false)
await sql(`insert into documentacion_situaciones (empleado_id, tipo, situacion) values ($1, 'codem', 'no_corresponde')`, [ID_V1])
// V2: RNR por vencer en 10 días; foto vieja de credencial VENCIDA pero credencial
//     ya renovada (vence en 400 días); CODEM solicitado; actuaciones (reservado) solicitado.
await doc(ID_V2, 'antecedentes_rnr', 'aprobado', 10)
const fotoViejaV2 = await doc(ID_V2, 'credencial', 'aprobado', -100)
await credencial(ID_V2, -100, fotoViejaV2)
await credencial(ID_V2, 400)
await sql(`insert into documentacion_situaciones (empleado_id, tipo, situacion) values ($1, 'codem', 'solicitado'), ($1, 'actuaciones_legales', 'solicitado')`, [ID_V2])
// V3 (sin puesto, rol guardia): foto de credencial vencida hace 3 días y SIN credencial registrada.
await doc(ID_V3, 'credencial', 'aprobado', -3)
// Vence hoy (borde): V3 RNR vence hoy → por vencer.
await doc(ID_V3, 'antecedentes_rnr', 'aprobado', 0)
// Fuera: persona de baja y persona de prueba con documentos vencidos; documento rechazado.
await doc(ID_BAJA, 'antecedentes_rnr', 'aprobado', -5)
await doc(ID_PRUEBA, 'antecedentes_rnr', 'aprobado', -5)
await doc(ID_V2, 'cursos', 'rechazado', -5)

// ── 1. Hora de Argentina ────────────────────────────────────────────────────
ok('Hora AR: 05/11 01:30 UTC es todavía 04/11 en Argentina',
  (await sql(`select ('2026-11-05 01:30:00+00'::timestamptz at time zone 'America/Argentina/Buenos_Aires')::date::text d`))[0].d === '2026-11-04')
ok('documentacion_hoy() = fecha de Argentina (no current_date UTC)',
  (await sql(`select public.documentacion_hoy() = (now() at time zone 'America/Argentina/Buenos_Aires')::date x`))[0].x === true)
ok('Ninguna función de alertas usa current_date', (await sql(`select count(*)::int n from pg_proc
  where proname in ('documentacion_alertas_generar','documentacion_vencimientos','documentacion_mis_alertas','documentacion_alerta_vigente')
    and prosrc ilike '%current_date%'`))[0].n === 0)
ok('Cron 0 11 * * * UTC = 08:00 Argentina', (await sql(`select extract(hour from ('2026-11-04 11:00:00+00'::timestamptz at time zone 'America/Argentina/Buenos_Aires'))::int h`))[0].h === 8)

// ── 2. Interruptor apagado ──────────────────────────────────────────────────
const cfg0 = (await sql(`select activo, dias_aviso, avisar_persona, incluir_faltantes from documentacion_alertas_config`))[0]
ok('Config inicial apagada (30 días, sin persona, sin faltantes)', !cfg0.activo && cfg0.dias_aviso === 30 && !cfg0.avisar_persona && !cfg0.incluir_faltantes)
const r0 = await generar()
ok('Apagado: el generador no hace nada', r0.activo === false && r0.nuevas === 0 && (await contar()) === 0)
ok('Apagado: la persona no ve nada', (await misAlertas(V1)).activo === false)

// ── 3. Quién configura ──────────────────────────────────────────────────────
ok('Administración no prende las alertas', await como(ADM, () => falla(() => rpc('documentacion_alertas_configurar', ['{"activo":true}']), /Gerencia/)))
ok('Vigilador no prende las alertas', await como(V1, () => falla(() => rpc('documentacion_alertas_configurar', ['{"activo":true}']), /Gerencia/)))
ok('Vigilador no puede correr el generador', await como(V1, () => falla(() => rpc('documentacion_alertas_generar'), /permission denied/)))
ok('anon no puede correr el generador', await como(null, () => falla(() => rpc('documentacion_alertas_generar'), /permission denied/), 'anon'))
ok('Nadie escribe la config directo', await como(GER, () => falla(() => sql(`update documentacion_alertas_config set activo = true`), /permission denied/)))
ok('Días fuera de rango: rechazado', await como(GER, () => falla(() => rpc('documentacion_alertas_configurar', ['{"activo":true,"dias_aviso":0}']), /check/)))
await como(GER, () => rpc('documentacion_alertas_configurar', ['{"activo":true,"dias_aviso":30}']))
ok('Gerencia prende: queda en el historial', (await sql(`select count(*)::int n from documentacion_alertas_config_historial`))[0].n === 1)

// ── 4. Primera corrida (sin faltantes) ──────────────────────────────────────
const r1 = await generar()
const lista = async () => (await sql(`select a.empleado_id, a.tipo, a.motivo, a.credencial_id, a.documento_id from documentacion_alertas a order by a.id`))
const tiene = (l, emp, tipo, motivo) => l.some(a => a.empleado_id === emp && a.tipo === tipo && a.motivo === motivo)
let l1 = await lista()
ok('Vencido: RNR de V1', tiene(l1, ID_V1, 'antecedentes_rnr', 'vencido'))
ok('Por vencer: RNR de V2 (10 días)', tiene(l1, ID_V2, 'antecedentes_rnr', 'por_vencer'))
ok('Vence hoy = por vencer (V3)', tiene(l1, ID_V3, 'antecedentes_rnr', 'por_vencer'))
ok('Credencial informada sin foto (V1) por vencer, con credencial_id', l1.some(a => a.empleado_id === ID_V1 && a.tipo === 'credencial' && a.motivo === 'por_vencer' && a.credencial_id === credV1 && a.documento_id === null))
ok('Credencial renovada (V2): la foto vieja vencida NO alerta', !l1.some(a => a.empleado_id === ID_V2 && a.tipo === 'credencial'))
ok('Foto de credencial sin credencial registrada (V3): vencido por el documento', tiene(l1, ID_V3, 'credencial', 'vencido'))
ok('Sin vencimiento (DNI) y vigente lejano (curso 200 días): nada', !tiene(l1, ID_V1, 'dni', 'vencido') && !l1.some(a => a.tipo === 'cursos'))
ok('Baja, prueba y rechazado: nada', !l1.some(a => [ID_BAJA, ID_PRUEBA].includes(a.empleado_id)) && !l1.some(a => a.tipo === 'cursos'))
ok('Solicitados: CODEM y reservado de V2', tiene(l1, ID_V2, 'codem', 'solicitado') && tiene(l1, ID_V2, 'actuaciones_legales', 'solicitado'))
ok('incluir_faltantes = false: ningún faltante', r1.faltantes === 0 && !l1.some(a => a.motivo === 'faltante'))
ok('Resumen de la corrida', r1.activo && r1.nuevas === 7 && r1.vencimientos === 4 && r1.credenciales === 1 && r1.solicitados === 2, JSON.stringify(r1))

// ── 5. Idempotencia ─────────────────────────────────────────────────────────
const antes = await contar()
const r2 = await generar()
ok('Segunda corrida: 0 nuevas, mismas filas', r2.nuevas === 0 && (await contar()) === antes)
ok('Claves únicas', (await sql(`select count(*)::int n from (select clave from documentacion_alertas group by clave having count(*) > 1) x`))[0].n === 0)

// ── 6. Faltantes ────────────────────────────────────────────────────────────
await como(GER, () => rpc('documentacion_alertas_configurar', ['{"incluir_faltantes":true}']))
const r3 = await generar()
let l3 = await lista()
const falt = l3.filter(a => a.motivo === 'faltante')
ok('Faltantes: V1 credencial y CODEM excluido por "no corresponde"', tiene(l3, ID_V1, 'credencial', 'faltante') && !tiene(l3, ID_V1, 'codem', 'faltante'))
ok('Faltantes: V1 no tiene DNI faltante (lo tiene)', !tiene(l3, ID_V1, 'dni', 'faltante'))
ok('Faltantes: V3 (rol guardia sin puesto) incluido', tiene(l3, ID_V3, 'dni', 'faltante'))
ok('Faltantes: sólo vigiladores activos no de prueba', !falt.some(a => [ID_GER, ID_ADM, ID_SUP, ID_BAJA, ID_PRUEBA].includes(a.empleado_id)))
ok('Faltantes: ni opcionales, ni inactivos, ni reservados', !falt.some(a => ['cursos', 'alta_art', 'actuaciones_legales'].includes(a.tipo)))
ok('Faltantes: conteo esperado (V1:1, V2:2, V3:2)', r3.faltantes === 5 && r3.nuevas === 5, JSON.stringify(r3))
ok('Faltantes: segunda corrida no duplica', (await generar()).nuevas === 0)

// ── 7. Permisos ─────────────────────────────────────────────────────────────
ok('avisar_persona = false: la persona no ve sus alertas (RPC)', (await misAlertas(V1)).activo === false)
ok('avisar_persona = false: tampoco por la tabla', (await verTabla(V1)).length === 0)
await como(GER, () => rpc('documentacion_alertas_configurar', ['{"avisar_persona":true}']))
const m1 = await misAlertas(V1)
ok('avisar_persona = true: V1 ve sus alertas', m1.activo === true && m1.alertas.length === 3, JSON.stringify(m1.alertas.map(a => a.tipo + ':' + a.motivo)))
const tV1 = await verTabla(V1)
ok('Por la tabla V1 ve sólo lo propio', tV1.length > 0 && tV1.every(a => a.empleado_id === ID_V1))
const m2 = await misAlertas(V2)
ok('V2 no ve el tipo reservado a Gerencia', !m2.alertas.some(a => a.tipo === 'actuaciones_legales') && !(await verTabla(V2)).some(a => a.tipo === 'actuaciones_legales'))
const tAdm = await verTabla(ADM), tGer = await verTabla(GER)
ok('Administración ve lo general sin reservados', tAdm.length === (await contar()) - 1 && !tAdm.some(a => a.tipo === 'actuaciones_legales'))
ok('Gerencia ve todo', tGer.length === (await contar()))
ok('Supervisor no ve alertas ajenas', (await verTabla(SUP)).length === 0)
ok('Supervisor no ve el reporte', await como(SUP, () => falla(() => rpc('documentacion_vencimientos', [30]), /Administración o Gerencia/)))
ok('Vigilador no ve el reporte', await como(V1, () => falla(() => rpc('documentacion_vencimientos', [30]), /Administración o Gerencia/)))
ok('Nadie inserta/borra alertas directo', await como(GER, () => falla(() => sql(`delete from documentacion_alertas`), /permission denied/))
  && await como(ADM, () => falla(() => sql(`insert into documentacion_alertas (empleado_id, tipo, motivo, clave) values ('${ID_V1}', 'dni', 'faltante', 'x')`), /permission denied/)))
ok('documentacion_alerta_vigente no se llama desde la app', await como(V1, () => falla(() => sql(`select public.documentacion_alerta_vigente(a) from documentacion_alertas a limit 1`), /permission denied/)))
await sql(`update usuarios set acceso_bloqueado = true where id = $1`, [ID_V1])
ok('Persona con acceso bloqueado (baja): no ve nada por la tabla', (await verTabla(V1)).length === 0)
await sql(`update usuarios set acceso_bloqueado = false where id = $1`, [ID_V1])

// Reporte
const rep = await como(ADM, () => rpc('documentacion_vencimientos', [30]))
ok('Reporte: credencial informada de V1 con origen credencial y sin verificar',
  rep.documentos.some(d => d.empleado_id === ID_V1 && d.origen === 'credencial' && d.verificada === false && d.dias === 5))
ok('Reporte: la foto vieja de V2 no aparece', !rep.documentos.some(d => d.empleado_id === ID_V2 && d.tipo === 'credencial'))
ok('Reporte: claves únicas', new Set(rep.documentos.map(d => d.clave)).size === rep.documentos.length)
ok('Reporte: hoy = fecha de Argentina', rep.hoy === (await sql(`select public.documentacion_hoy()::text d`))[0].d)
ok('Reporte: resumen de alertas vigentes', rep.alertas.vigentes === (await contar(`tipo <> 'actuaciones_legales'`)) && rep.alertas.faltante === 5, JSON.stringify(rep.alertas))
ok('Reporte: Admin no cuenta reservados, Gerencia sí', (await como(GER, () => rpc('documentacion_vencimientos', [30]))).alertas.vigentes === rep.alertas.vigentes + 1)

// ── 8. Resolución al actualizar o reemplazar ────────────────────────────────
// V1 sube RNR nuevo y se aprueba: el viejo pasa a reemplazado.
const nuevoRnr = await doc(ID_V1, 'antecedentes_rnr', 'aprobado', 180)
await sql(`update documentacion_documentos set estado = 'reemplazado', reemplazado_por = $2, reemplazado_at = now() where id = $1`, [rnrV1, nuevoRnr])
// V1: se registra la credencial renovada.
await credencial(ID_V1, 700)
// V2 sube el CODEM pedido (queda en revisión).
await doc(ID_V2, 'codem', 'pendiente_revision', null)
// V3 sube el DNI.
await doc(ID_V3, 'dni', 'pendiente_aceptacion', null)
const mV1 = await misAlertas(V1)
ok('Reemplazado el RNR: desaparece el vencido de V1', !mV1.alertas.some(a => a.tipo === 'antecedentes_rnr'))
ok('Credencial renovada: desaparece el por vencer de V1', !mV1.alertas.some(a => a.tipo === 'credencial' && a.motivo === 'por_vencer'))
ok('Faltante de credencial de V1 sigue (falta la foto)', mV1.alertas.some(a => a.tipo === 'credencial' && a.motivo === 'faltante'))
const mV2 = await misAlertas(V2)
ok('CODEM subido: desaparece el solicitado de V2', !mV2.alertas.some(a => a.tipo === 'codem'))
ok('DNI subido: desaparece el faltante de V3', !(await misAlertas(V3)).alertas.some(a => a.tipo === 'dni'))
ok('Las alertas resueltas no se borran (historia)', (await contar(`empleado_id = '${ID_V1}' and tipo = 'antecedentes_rnr'`)) === 1)
const r5 = await generar()
ok('Tras reemplazar, la corrida no vuelve a alertar lo resuelto', r5.nuevas === 0, JSON.stringify(r5))
// Un "por vencer" cuyo vencimiento ya pasó deja de mostrarse (lo cubre el "vencido").
await sql(`insert into documentacion_alertas (empleado_id, documento_id, tipo, motivo, vence_el, clave)
  select empleado_id, id, tipo, 'por_vencer', vence_el, 'prueba:viejo' from documentacion_documentos where empleado_id = $1 and tipo = 'credencial'`, [ID_V3])
ok('Por vencer ya vencido: no se muestra', (await misAlertas(V3)).alertas.filter(a => a.tipo === 'credencial').every(a => a.motivo === 'vencido'))
// Anular la credencial vigente de V2 deja como última la vieja vencida → alerta de vencido.
await sql(`update habilitacion_credenciales set anulada_at = now() where empleado_id = $1 and vence_el > public.documentacion_hoy()`, [ID_V2])
const r6 = await generar()
ok('Anulada la credencial vigente de V2: alerta por la anterior (vencida)', r6.credenciales === 1 && tiene(await lista(), ID_V2, 'credencial', 'vencido'))

// ── 9. Vista e inmutabilidad ────────────────────────────────────────────────
const unaV2 = (await misAlertas(V2)).alertas[0]
await como(V1, () => rpc('documentacion_alerta_vista', [unaV2.id]))
ok('Otro no puede marcar como vista una alerta ajena', (await sql(`select vista_at from documentacion_alertas where id = $1`, [unaV2.id]))[0].vista_at === null)
await como(V2, () => rpc('documentacion_alerta_vista', [unaV2.id]))
ok('Vista: deja de mostrarse', !(await misAlertas(V2)).alertas.some(a => a.id === unaV2.id))
ok('Vista dos veces: no falla', await como(V2, async () => { await rpc('documentacion_alerta_vista', [unaV2.id]); return true }))
ok('Una alerta no se modifica', await falla(() => sql(`update documentacion_alertas set motivo = 'faltante' where id = (select min(id) from documentacion_alertas)`), /sólo se registra cuándo se vio/))
ok('Una alerta no se borra', await falla(() => sql(`delete from documentacion_alertas where id = (select min(id) from documentacion_alertas)`), /no se borran/))

// ── 10. Apagar ──────────────────────────────────────────────────────────────
await como(GER, () => rpc('documentacion_alertas_configurar', ['{"activo":false}']))
const n = await contar()
ok('Apagado de nuevo: el generador no agrega nada', (await generar()).activo === false && (await contar()) === n)
ok('Apagado: la persona deja de ver las alertas (RPC y tabla)', (await misAlertas(V1)).activo === false && (await verTabla(V1)).length === 0)
ok('Apagado: Administración sigue con el reporte', (await como(ADM, () => rpc('documentacion_vencimientos', [30]))).documentos.length > 0)

// ── Verificación posterior (el SQL para el editor) ──────────────────────────
await db.exec(`create schema cron; create table cron.job (jobname text, schedule text, active boolean);`)
const ver = await sql(readFileSync(new URL('./verificacion-20261205140000.sql', import.meta.url), 'utf8'))
ok('verificacion-20261205140000.sql: todas las filas ok', ver.length === 10 && ver.every(f => f.ok === true), JSON.stringify(ver.filter(f => !f.ok)))

// ── Rollback ────────────────────────────────────────────────────────────────
await db.exec(readFileSync(`${REPO}/supabase/rollback/20261205140000_documentacion_alertas_listas_rollback.sql`, 'utf8'))
ok('Rollback: vuelve a la versión anterior', (await sql(`select count(*)::int n from pg_proc where proname in ('documentacion_hoy','documentacion_alerta_vigente','documentacion_alertas_aviso_persona')`))[0].n === 0
  && (await sql(`select count(*)::int n from information_schema.columns where table_name = 'documentacion_alertas' and column_name = 'credencial_id'`))[0].n === 0
  && (await sql(`select prosrc like '%current_date%' x from pg_proc where proname = 'documentacion_alertas_generar'`))[0].x === true)
await db.exec(readFileSync(MIG, 'utf8'))
ok('Re-aplicar después del rollback', (await sql(`select count(*)::int n from pg_proc where proname = 'documentacion_alerta_vigente'`))[0].n === 1)

// ── Resultado ───────────────────────────────────────────────────────────────
for (const [e, nombre, extra] of resultados) console.log(`${e} ${nombre}${extra && e !== 'OK ' ? ' — ' + extra : ''}`)
const fallas = resultados.filter(r => r[0] !== 'OK ').length
console.log(`\n${resultados.length - fallas}/${resultados.length} OK`)
process.exit(fallas ? 1 : 0)
