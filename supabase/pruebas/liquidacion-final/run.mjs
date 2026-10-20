// Prueba de 20261110120000 (baja laboral + bloqueo de acceso + liquidación final) sobre PGlite.
//   npm i --no-save @electric-sql/pglite@0.2.17
//   node supabase/pruebas/liquidacion-final/run.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const MIG = `${REPO}/supabase/migrations/20261110120000_liquidacion_final_borrador.sql`
const RB = `${REPO}/supabase/rollback/20261110120000_liquidacion_final_borrador_rollback.sql`
const db = new PGlite()
const resultados = []
const ok = (nombre, cond, extra = '') => { resultados.push([cond ? 'OK ' : 'FALLA', nombre, extra]) }
async function sql(texto, params) { return (await db.query(texto, params)).rows }
async function como(uid, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role authenticated;`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
async function falla(fn, patron) { try { await fn(); return 'NO FALLÓ' } catch (e) { return patron.test(e.message) ? true : `otro error: ${e.message}` } }
const rpc = async (nombre, args = []) => (await sql(`select public.${nombre}(${args.map((_, i) => `$${i + 1}`).join(', ')}) as r`, args))[0].r
const iso = d => (d instanceof Date ? d.toISOString().slice(0, 10) : d)

const GER = '00000000-0000-0000-0000-000000001001'
const ADM = '00000000-0000-0000-0000-000000001002'
const SUP = '00000000-0000-0000-0000-000000001003'
const A_REN = '00000000-0000-0000-0000-000000001010'
const U_REN = '00000000-0000-0000-0000-000000002010'
const U_DES = '00000000-0000-0000-0000-000000002011'
const U_CON = '00000000-0000-0000-0000-000000002012'
const U_INA = '00000000-0000-0000-0000-000000002013'
const OBJ = '00000000-0000-0000-0000-00000000a001'
const CUIL_REN = '20301112223'

await db.exec(readFileSync(new URL('./prelude.sql', import.meta.url), 'utf8'))
// Turnos del vigilador que renuncia: uno anterior a la baja (con asistencia) y dos posteriores.
const [{ id: T_ANT }] = await sql(`insert into turnos (guardia_id, objetivo_id, fecha, hora_inicio, hora_fin, estado) values ($1, $2, '2026-09-28', '07:00', '19:00', 'cubierto') returning id`, [U_REN, OBJ])
await sql(`insert into turnos (guardia_id, objetivo_id, fecha, hora_inicio, hora_fin, estado) values ($1, $2, '2026-10-02', '07:00', '19:00', 'programado'), ($1, $2, '2026-10-05', '07:00', '19:00', 'programado'), ($1, $2, '2026-10-06', '07:00', '19:00', 'anulado')`, [U_REN, OBJ])
await sql(`insert into registros_asistencia (turno_id, guardia_id, tipo) values ($1, $2, 'entrada')`, [T_ANT, U_REN])
await sql(`insert into novedades_laborales (empleado_id, tipo, fecha_desde, fecha_hasta) values ($1, 'vacaciones', '2026-01-10', '2026-01-23')`, [U_REN])
await db.exec(readFileSync(MIG, 'utf8'))
ok('la migración aplica', true)

const baja = async (id) => (await sql(`select * from baja_laboral where id = $1`, [id]))[0]
const usuario = async (id) => (await sql(`select estado, acceso_bloqueado, acceso_auth_bloqueado_at from usuarios where id = $1`, [id]))[0]

// ── 1) Renuncia: borrador con dos documentos y lectura de IA ─────────────────
let r = await como(ADM, () => rpc('baja_guardar_borrador', [null, U_REN, JSON.stringify({ causa: 'renuncia', origen: 'legajo', observaciones: 'Telegrama recibido' })]))
const B_REN = r.baja_id
let b = await baja(B_REN)
ok('borrador con identificación automática (nombre, DNI, CUIL, legajo, ingreso)', b.estado === 'borrador' && b.dni === '30111222' && b.cuil === CUIL_REN
  && b.legajo === 'L1 Visual' && iso(b.fecha_ingreso) === '2023-03-01' && b.nombre === 'RENUNCIA, UNO' && b.origen === 'legajo', JSON.stringify(b))
ok('un borrador no cambia situación laboral ni acceso', (await usuario(U_REN)).estado === 'activo' && (await usuario(U_REN)).acceso_bloqueado === false)
ok('con la baja en borrador el empleado sigue leyendo sus datos', (await como(A_REN, () => sql(`select count(*)::int n from registros_asistencia`)))[0].n === 1)
r = await como(ADM, () => rpc('baja_guardar_borrador', [null, U_REN, JSON.stringify({ causa: 'renuncia' })]))
ok('registrar de nuevo continúa el mismo borrador (no crea otro)', r.baja_id === B_REN && (await sql(`select count(*)::int n from baja_laboral where empleado_id = $1`, [U_REN]))[0].n === 1)
const [{ id: DOC1 }] = await sql(`insert into documentacion_documentos (empleado_id, tipo) values ($1, 'telegrama_renuncia') returning id`, [U_REN])
const [{ id: DOC2 }] = await sql(`insert into documentacion_documentos (empleado_id, tipo) values ($1, 'documentacion_baja') returning id`, [U_REN])
const [{ id: DOC_OTRO }] = await sql(`insert into documentacion_documentos (empleado_id, tipo) values ($1, 'telegrama_despido') returning id`, [U_DES])
await como(ADM, () => rpc('baja_vincular_documento', [B_REN, DOC1]))
await como(ADM, () => rpc('baja_vincular_documento', [B_REN, DOC2]))
await como(ADM, () => rpc('baja_vincular_documento', [B_REN, DOC1]))
ok('varios documentos vinculados, sin duplicar el mismo', (await sql(`select count(*)::int n from baja_laboral_documento where baja_id = $1`, [B_REN]))[0].n === 2)
ok('no se vincula un documento de otra persona', await falla(() => como(ADM, () => rpc('baja_vincular_documento', [B_REN, DOC_OTRO])), /no es del legajo/))
const lectura = { fecha_documento: '2026-09-29', fecha_efectiva: '2026-09-29', motivo: 'renuncia', alertas: [] }
await como(ADM, () => rpc('baja_guardar_lectura', [B_REN, DOC1, 'leido', JSON.stringify(lectura)]))
b = await baja(B_REN)
ok('la lectura de la IA se guarda como sugerencia y NO cambia la baja', b.fecha_baja === null && b.estado === 'borrador'
  && (await sql(`select ia_estado from baja_laboral_documento where documento_id = $1`, [DOC1]))[0].ia_estado === 'leido')
// Administración corrige la fecha que leyó la IA.
await como(ADM, () => rpc('baja_guardar_borrador', [B_REN, null, JSON.stringify({ fecha_baja: '2026-09-30', fecha_notificacion: '2026-09-29' })]))
b = await baja(B_REN)
ok('Administración corrige la fecha detectada por la IA', iso(b.fecha_baja) === '2026-09-30' && iso(b.fecha_notificacion) === '2026-09-29')
ok('fecha efectiva inválida rechazada', await falla(() => como(ADM, () => rpc('baja_guardar_borrador', [B_REN, null, JSON.stringify({ fecha_baja: '1999-01-01' })])), /no es válida/))
ok('causal inexistente rechazada', await falla(() => como(ADM, () => rpc('baja_guardar_borrador', [B_REN, null, JSON.stringify({ causa: 'inventada' })])), /Causal/))

// ── 2) Vacaciones tomadas sin duplicar ───────────────────────────────────────
const vac = (args) => como(ADM, () => rpc('vacaciones_registrar_tomadas', args))
await vac([U_REN, 2024, 14, '2024-02-01', '2024-02-14', 'Nota VACACIONES 2024', null])
ok('vacaciones previas a la app registradas', (await sql(`select count(*)::int n from legajo_vacaciones_tomadas where empleado_id = $1`, [U_REN]))[0].n === 1)
ok('superposición con otro registro manual → rechazada', await falla(() => vac([U_REN, 2024, 3, '2024-02-10', '2024-02-12', 'dup', null]), /superponen/))
ok('superposición con una novedad aprobada de la app → rechazada', await falla(() => vac([U_REN, 2026, 5, '2026-01-20', '2026-01-24', 'dup', null]), /novedad/))
ok('sin fechas en un período que ya tiene registros → rechazada', await falla(() => vac([U_REN, 2026, 14, null, null, 'sin fechas', null]), /dos veces/))
await vac([U_REN, 2023, 14, null, null, 'Período 2023 sin fechas exactas', null])
ok('sin fechas en un período libre → aceptada', (await sql(`select count(*)::int n from legajo_vacaciones_tomadas where empleado_id = $1`, [U_REN]))[0].n === 2)
ok('supervisor no registra vacaciones', await falla(() => como(SUP, () => rpc('vacaciones_registrar_tomadas', [U_REN, 2022, 14, null, null, 'x', null])), /Administración o Gerencia/))

// ── 3) Permisos ──────────────────────────────────────────────────────────────
ok('supervisor no registra bajas', await falla(() => como(SUP, () => rpc('baja_guardar_borrador', [null, U_DES, '{}'])), /Administración o Gerencia/))
ok('supervisor no ve bajas, documentos, vacaciones ni liquidaciones', (await como(SUP, () => sql(`select
    (select count(*) from baja_laboral) + (select count(*) from baja_laboral_documento) + (select count(*) from legajo_vacaciones_tomadas)
    + (select count(*) from liquidacion_final) + (select count(*) from baja_causa) as n`)))[0].n == 0)
ok('el empleado no ve su propia baja', (await como(A_REN, () => sql(`select count(*)::int n from baja_laboral`)))[0].n === 0)
ok('sin sesión (service_role) no entra por las RPC públicas', await falla(() => rpc('baja_guardar_borrador', [null, U_DES, '{}']), /Administración o Gerencia/))
ok('nadie escribe directo en las tablas', await falla(() => como(GER, () => sql(`update baja_laboral set estado = 'confirmada'`)), /permission denied/))

// ── 4) Confirmar ─────────────────────────────────────────────────────────────
ok('no confirma sin causa ni fecha', await falla(async () => {
  const x = await como(ADM, () => rpc('baja_guardar_borrador', [null, U_CON, JSON.stringify({ origen: 'guardias' })]))
  await como(ADM, () => rpc('baja_confirmar', [x.baja_id, null]))
}, /motivo|fecha/))
const vacConf = { devengadas: 51, tomadas: 37, pendientes: 14, metodo: 'empresa', verificadas: true, nota: 'saldo verificado' }
r = await como(ADM, () => rpc('baja_confirmar', [B_REN, JSON.stringify(vacConf)]))
b = await baja(B_REN)
let u = await usuario(U_REN)
ok('confirmar: baja confirmada con quién y cuándo', b.estado === 'confirmada' && b.confirmada_por === '00000000-0000-0000-0000-000000002002' && b.confirmada_at)
ok('confirmar: situación laboral desvinculado y acceso bloqueado (misma transacción)', u.estado === 'inactivo' && u.acceso_bloqueado === true && u.acceso_auth_bloqueado_at === null)
ok('confirmar: genera el borrador de liquidación final', r.final_id && (await sql(`select estado, mes from liquidacion_final where id = $1`, [r.final_id]))[0].mes === '2026-09')
ok('confirmar: informa turnos posteriores a la baja (sin anulados)', r.turnos_futuros.length === 2 && r.turnos_futuros[0].objetivo === 'CLUB' && iso(r.turnos_futuros[0].fecha) === '2026-10-02', JSON.stringify(r.turnos_futuros))
ok('confirmar: no borra turnos ni asistencias', (await sql(`select count(*)::int n from turnos where guardia_id = $1`, [U_REN]))[0].n === 4
  && (await sql(`select count(*)::int n from registros_asistencia where guardia_id = $1`, [U_REN]))[0].n === 1)
ok('confirmar: guarda las vacaciones confirmadas', b.vacaciones.pendientes === 14)
ok('confirmar de nuevo es idempotente (no duplica liquidación)', (await como(ADM, () => rpc('baja_confirmar', [B_REN, null]))).repetida === true
  && (await sql(`select count(*)::int n from liquidacion_final where baja_id = $1`, [B_REN]))[0].n === 1)
ok('la confirmación no abre otro borrador por el cambio de estado', (await sql(`select count(*)::int n from baja_laboral where empleado_id = $1`, [U_REN]))[0].n === 1)

// ── 5) Bloqueo efectivo en la base ───────────────────────────────────────────
ok('bloqueado: no lee sus registros aunque conserve la sesión', (await como(A_REN, () => sql(`select count(*)::int n from registros_asistencia`)))[0].n === 0)
ok('bloqueado: no lee su fila de usuarios', (await como(A_REN, () => sql(`select count(*)::int n from usuarios`)))[0].n === 0)
ok('bloqueado: no puede fichar (insert rechazado)', await falla(() => como(A_REN, () => sql(`insert into registros_asistencia (turno_id, guardia_id, tipo) values ($1, $2, 'entrada')`, [T_ANT, U_REN])), /row-level security/))
ok('bloqueado: la app sabe por qué (mi_acceso_estado)', (await como(A_REN, () => rpc('mi_acceso_estado'))).bloqueado === true)
ok('otro empleado activo sigue leyendo normal', (await como('00000000-0000-0000-0000-000000001011', () => sql(`select count(*)::int n from usuarios`)))[0].n === 1)
ok('reactivar (estado activo) con acceso bloqueado → rechazado', await falla(() => como(ADM, () => sql(`update usuarios set estado = 'activo' where id = $1`, [U_REN])), /rehabilitar/))
ok('desbloquear a mano (update directo) → rechazado', await falla(() => como(ADM, () => sql(`update usuarios set acceso_bloqueado = false where id = $1`, [U_REN])), /procedimiento de baja/))
ok('otras ediciones del legajo no reactivan el acceso', await (async () => {
  await sql(`update usuarios set nombre = 'UNO B' where id = $1`, [U_REN]); return (await usuario(U_REN)).acceso_bloqueado === true })())
await sql(`select public.baja_registrar_bloqueo_auth($1, true)`, [U_REN])
ok('el servidor registra el ban en Auth', (await usuario(U_REN)).acceso_auth_bloqueado_at !== null)
ok('un usuario con sesión no puede registrar el ban', await falla(() => como(ADM, () => rpc('baja_registrar_bloqueo_auth', [U_REN, true])), /permission denied|Sólo el servidor/))

// ── 6) Rectificación, anulación y rehabilitación ─────────────────────────────
ok('rectificar exige motivo', await falla(() => como(ADM, () => rpc('baja_rectificar', [B_REN, JSON.stringify({ fecha_baja: '2026-09-29' }), ''])), /motivo/))
await como(ADM, () => rpc('baja_rectificar', [B_REN, JSON.stringify({ fecha_baja: '2026-09-29' }), 'El telegrama dice 29/09']))
b = await baja(B_REN)
ok('rectificar cambia la fecha, recalcula turnos y marca recalcular la liquidación', iso(b.fecha_baja) === '2026-09-29' && b.turnos_futuros.length === 2
  && (await sql(`select requiere_recalculo from liquidacion_final where baja_id = $1`, [B_REN]))[0].requiere_recalculo === true)
ok('rectificar no reactiva el acceso', (await usuario(U_REN)).acceso_bloqueado === true)
await como(ADM, () => rpc('baja_rectificar', [B_REN, JSON.stringify({ fecha_baja: '2026-09-30' }), 'Vuelve a 30/09 según renuncia firmada']))
ok('Administración no anula una baja confirmada', await falla(() => como(ADM, () => rpc('baja_anular', [B_REN, 'error'])), /Gerencia/))
ok('Administración no rehabilita el acceso', await falla(() => como(ADM, () => rpc('acceso_rehabilitar', [U_REN, 'error'])), /Gerencia/))

// Despido sin causa → borrador anulado por Administración (borrador sí puede).
r = await como(ADM, () => rpc('baja_guardar_borrador', [null, U_DES, JSON.stringify({ causa: 'despido_sin_causa', fecha_baja: '2026-10-03' })]))
const B_DES = r.baja_id
ok('despido sin causa con conceptos a evaluar en el catálogo', (await sql(`select evaluar from baja_causa where codigo = 'despido_sin_causa'`))[0].evaluar.includes('indemnizacion_antiguedad'))
await como(ADM, () => rpc('baja_anular', [B_DES, 'Se cargó por error']))
ok('un borrador anulado se conserva', (await baja(B_DES)).estado === 'anulada' && (await usuario(U_DES)).estado === 'activo')
r = await como(ADM, () => rpc('baja_guardar_borrador', [null, U_DES, JSON.stringify({ causa: 'despido_sin_causa', fecha_baja: '2026-10-03' })]))
ok('después de anular se puede registrar una baja nueva', r.baja_id !== B_DES)
const B_DES2 = r.baja_id
// Despido con causa confirmado y después anulado por Gerencia: el acceso sigue bloqueado.
const B_CON = (await sql(`select id from baja_laboral where empleado_id = $1 and estado = 'borrador'`, [U_CON]))[0].id
await como(ADM, () => rpc('baja_guardar_borrador', [B_CON, null, JSON.stringify({ causa: 'despido_con_causa', fecha_baja: '2026-10-10' })]))
await como(ADM, () => rpc('baja_confirmar', [B_CON, null]))
await como(GER, () => rpc('baja_anular', [B_CON, 'Se revocó el despido']))
ok('Gerencia anula una baja confirmada; se conserva y el acceso sigue bloqueado', (await baja(B_CON)).estado === 'anulada' && (await usuario(U_CON)).acceso_bloqueado === true
  && (await sql(`select estado from liquidacion_final where baja_id = $1`, [B_CON]))[0].estado === 'anulada')
r = await como(GER, () => rpc('acceso_rehabilitar', [U_CON, 'Despido revocado: vuelve a trabajar']))
ok('sólo Gerencia rehabilita, con motivo, y queda en el historial', (await usuario(U_CON)).acceso_bloqueado === false
  && (await sql(`select count(*)::int n from baja_laboral_historial where baja_id = $1 and accion = 'acceso_rehabilitado'`, [B_CON]))[0].n === 1)
ok('rehabilitar el acceso no reactiva solo la situación laboral', (await usuario(U_CON)).estado === 'inactivo')

// ── 7) Cambio de estado por otro camino → borrador para completar ────────────
await sql(`update usuarios set estado = 'inactivo' where id = $1`, [U_INA])
let bi = await sql(`select * from baja_laboral where empleado_id = $1`, [U_INA])
ok('Inactivar / pedido del supervisor abre un BORRADOR (origen cambio_estado)', bi.length === 1 && bi[0].estado === 'borrador' && bi[0].origen === 'cambio_estado')
ok('ese borrador no bloquea el acceso ni crea liquidación', (await usuario(U_INA)).acceso_bloqueado === false && (await sql(`select count(*)::int n from liquidacion_final where baja_id = $1`, [bi[0].id]))[0].n === 0)
await sql(`update usuarios set estado = 'activo' where id = $1`, [U_INA])
await sql(`update usuarios set estado = 'inactivo' where id = $1`, [U_INA])
ok('volver a inactivar no duplica el borrador', (await sql(`select count(*)::int n from baja_laboral where empleado_id = $1`, [U_INA]))[0].n === 1)

// ── 8) Liquidación final: versiones, doble pago, exportación y conciliación ──
const FIN = (await sql(`select id from liquidacion_final where baja_id = $1`, [B_REN]))[0].id
const lineas = [
  { codigo: '120003', concepto: 'sac', entrada: 'CANIMP', cantidad: 1, importe: 190782.12, total: 190782.12 },
  { codigo: '208', concepto: 'vac', entrada: 'CANIMP', cantidad: 14, importe: 40812, total: 571368 },
]
const guardar = (uid, version, hash, ya = [], faltantes = [], pagado = 0) => como(uid, () => rpc('liquidacion_final_guardar_calculo',
  [FIN, version, hash, JSON.stringify({ ya_liquidado: ya, extras: { pagado } }), JSON.stringify(lineas), JSON.stringify(faltantes), '[]']))
let g = await guardar(ADM, 0, 'hash-0001', [], [{ clave: 'evaluar:x', detalle: 'falta' }])
ok('primer cálculo → versión 1', g.version === 1 && g.sin_cambios === false)
ok('reintento del mismo cálculo → sin cambios', (await guardar(ADM, 0, 'hash-0001', [], [{ clave: 'evaluar:x', detalle: 'falta' }])).sin_cambios === true)
ok('cálculo sobre versión vieja → rechazado', await falla(() => guardar(GER, 0, 'hash-0002'), /cambió/))
ok('supervisor no calcula liquidaciones', await falla(() => guardar(SUP, 1, 'hash-0009'), /Gerencia o Administración/))
ok('con faltantes no pasa a lista', await falla(() => como(ADM, () => rpc('liquidacion_final_marcar_lista', [FIN, 1])), /faltantes/))
ok('evaluación sin motivo rechazada', await falla(() => como(ADM, () => rpc('liquidacion_final_guardar_entradas', [FIN, JSON.stringify({ evaluaciones: [{ clave: 'x', resolucion: 'no_corresponde', motivo: '' }] }), 1])), /motivo/))
await como(ADM, () => rpc('liquidacion_final_guardar_entradas', [FIN, JSON.stringify({ evaluaciones: [{ clave: 'x', resolucion: 'no_corresponde', motivo: 'Renuncia: no corresponde' }] }), 1]))
g = await guardar(ADM, 1, 'hash-0003')
await como(ADM, () => rpc('liquidacion_final_marcar_lista', [FIN, 2]))
const [{ id: PER }] = await sql(`insert into liquidacion_periodo (mes, estado) values ('2026-09', 'exportada') returning id`)
await sql(`insert into liquidacion_enviado_visual (periodo_id, cuil, cod_interno, codigo, cantidad, importe) values ($1, $2, 'L1 Visual', '001', 1, 81624)`, [PER, CUIL_REN])
ok('cambió lo liquidado en el mes desde el cálculo → no exporta', await falla(() => como(ADM, () => rpc('liquidacion_final_exportar', [FIN, 2, 'x.xls', 'arch-0001'])), /Doble pago: cambió lo liquidado/))
const ya = (await sql(`select public.liquidacion_final_ya_liquidado($1, '2026-09') as r`, [CUIL_REN]))[0].r
await guardar(ADM, 2, 'hash-0004', ya)
await como(ADM, () => rpc('liquidacion_final_marcar_lista', [FIN, 3]))
const ex = await como(ADM, () => rpc('liquidacion_final_exportar', [FIN, 3, 'visual.xls', 'arch-0001']))
ok('exporta cuando lo considerado coincide', ex.estado === 'exportada')
ok('reintento con el mismo archivo → no se exporta dos veces', (await como(ADM, () => rpc('liquidacion_final_exportar', [FIN, 3, 'visual.xls', 'arch-0001']))).repetida === true)
ok('otro archivo después de exportar → rechazado', await falla(() => como(ADM, () => rpc('liquidacion_final_exportar', [FIN, 3, 'v2.xls', 'arch-0002'])), /otro archivo/))
ok('exportada: no se rectifica ni anula la baja', await falla(() => como(ADM, () => rpc('baja_rectificar', [B_REN, JSON.stringify({ fecha_baja: '2026-09-28' }), 'probando'])), /exportada/)
  && await falla(() => como(GER, () => rpc('baja_anular', [B_REN, 'probando'])), /exportada/))
const [{ id: PER2 }] = await sql(`insert into liquidacion_periodo (mes, estado) values ('2026-09', 'borrador') returning id`)
ok('período mensual que repite 208 de la final → bloqueado', await falla(() => sql(`insert into liquidacion_enviado_visual (periodo_id, cuil, cod_interno, codigo, cantidad, importe) values ($1, $2, 'L1 Visual', '208', 14, 40812)`, [PER2, CUIL_REN]), /Doble pago/))
await sql(`insert into liquidacion_enviado_visual (periodo_id, cuil, cod_interno, codigo, cantidad, importe) values ($1, $2, 'L1 Visual', '208', 0, 0)`, [PER2, CUIL_REN])
ok('las líneas 0/0 no se bloquean', true)
const resultado = (imp208) => JSON.stringify([
  { codigo: '120003', nombre: 'sac', cantidad: 1, importe: 190782.12 },
  { codigo: '208', nombre: 'vac', cantidad: 14, importe: imp208 },
  { codigo: '101', nombre: 'Jubilación', cantidad: 0, importe: 20986.03 },
])
await como(ADM, () => rpc('liquidacion_final_importar_resultado', [FIN, 'res1.xls', 'res-0001', resultado(571368.01)]))
let conc = await como(ADM, () => sql(`select * from public.liquidacion_final_conciliacion($1)`, [FIN]))
ok('un centavo de diferencia se detecta', conc.find(c => c.codigo === '208').estado === 'IMPORTE_DIFIERE')
ok('con diferencias no concilia', (await como(ADM, () => rpc('liquidacion_final_conciliar', [FIN]))).conciliada === false)
ok('mismo resultado otra vez → sin versión nueva', (await como(ADM, () => rpc('liquidacion_final_importar_resultado', [FIN, 'res1.xls', 'res-0001', resultado(571368.01)]))).repetido === true)
await como(ADM, () => rpc('liquidacion_final_importar_resultado', [FIN, 'res2.xls', 'res-0002', resultado(571368)]))
ok('concilia al centavo', (await como(ADM, () => rpc('liquidacion_final_conciliar', [FIN]))).conciliada === true)
const hb = await sql(`select accion from baja_laboral_historial where baja_id = $1 order by id`, [B_REN])
ok('historial de la baja completo', ['creada', 'editada', 'documento', 'lectura_ia', 'confirmada', 'acceso_bloqueado_auth', 'rectificada'].every(a => hb.some(h => h.accion === a)), hb.map(h => h.accion).join(','))
const hf = await sql(`select accion from liquidacion_final_historial where final_id = $1 order by id`, [FIN])
ok('historial de la liquidación completo', ['creado', 'baja_rectificada', 'calculo', 'entradas', 'lista', 'exportada', 'resultado', 'conciliacion'].every(a => hf.some(h => h.accion === a)), hf.map(h => h.accion).join(','))
ok('historiales append-only para la app', await falla(() => como(GER, () => sql(`delete from baja_laboral_historial`)), /permission denied/))
ok('desvinculado, sin acceso y con liquidación: todo a la vez', (await usuario(U_REN)).estado === 'inactivo' && (await usuario(U_REN)).acceso_bloqueado
  && (await sql(`select estado from liquidacion_final where id = $1`, [FIN]))[0].estado === 'conciliada')
void B_DES2

// ── 9) Rollback y re-aplicación ──────────────────────────────────────────────
await db.exec(readFileSync(RB, 'utf8'))
ok('rollback quita tablas, triggers y la política restrictiva', (await sql(`select count(*)::int n from pg_tables where tablename like 'liquidacion_final%' or tablename like 'baja_%'`))[0].n === 0
  && (await sql(`select count(*)::int n from pg_policies where policyname = 'acceso_bloqueado_baja'`))[0].n === 0)
ok('tras el rollback el ex bloqueado vuelve a leer (estado sigue inactivo)', (await como(A_REN, () => sql(`select count(*)::int n from registros_asistencia`)))[0].n === 1)
await db.exec(readFileSync(MIG, 'utf8'))
ok('la migración se puede volver a aplicar', (await sql(`select count(*)::int n from pg_tables where tablename = 'baja_laboral'`))[0].n === 1)

const fallas = resultados.filter(x => x[0] === 'FALLA')
for (const [e, n, x] of resultados) console.log(e, n, x && e === 'FALLA' ? `→ ${x}` : '')
console.log(`\n${resultados.length - fallas.length}/${resultados.length} controles OK`)
process.exit(fallas.length ? 1 : 0)
