// Prueba de 20261110120000_liquidacion_final_borrador.sql sobre PGlite.
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

const GER = '00000000-0000-0000-0000-000000001001'
const ADM = '00000000-0000-0000-0000-000000001002'
const JEFE = '00000000-0000-0000-0000-000000001003'
const VIG = '00000000-0000-0000-0000-000000001010'
const U_FULLA = '00000000-0000-0000-0000-000000002010'
const U_PAN = '00000000-0000-0000-0000-000000002011'
const U_SINCUIL = '00000000-0000-0000-0000-000000002012'
const U_PRUEBA = '00000000-0000-0000-0000-000000002013'
const FULLA = '20285365814'
const PAN = '20441767871'

await db.exec(readFileSync(new URL('./prelude.sql', import.meta.url), 'utf8'))
await db.exec(readFileSync(MIG, 'utf8'))
ok('la migración aplica', true)

const bajas = async (cuil) => sql(`select * from liquidacion_baja where cuil = $1 order by registrada_at`, [cuil])
const finalDe = async (bajaId) => (await sql(`select * from liquidacion_final where baja_id = $1`, [bajaId]))[0]

// ── 1) Baja en la app: usuarios.estado → inactivo ────────────────────────────
await como(ADM, () => sql(`update usuarios set estado = 'inactivo' where id = $1`, [U_FULLA]))
let bf = await bajas(FULLA)
ok('baja en la app crea UNA baja (fuente app, sin fecha, persona y quién)', bf.length === 1 && bf[0].fuente === 'app' && bf[0].fecha_baja === null
  && bf[0].empleado_id === U_FULLA && bf[0].registrada_por === '00000000-0000-0000-0000-000000002002', JSON.stringify(bf[0]))
ok('toma el ingreso del legajo', String(bf[0].fecha_inicio_relacion?.toISOString?.().slice(0, 10)) === '2023-03-01')
let ff = await finalDe(bf[0].id)
ok('crea UN borrador pendiente de cálculo', ff.estado === 'pendiente_calculo' && ff.version === 0 && ff.requiere_recalculo === true)
ok('no toca acceso ni pago banco (sólo el estado que cambió la app)', (await sql(`select excluir_pago_banco from usuarios where id = $1`, [U_FULLA]))[0].excluir_pago_banco === false)
// Reactivar y volver a dar de baja: mismo dato → no duplica.
await sql(`update usuarios set estado = 'activo' where id = $1`, [U_FULLA])
await sql(`update usuarios set estado = 'inactivo' where id = $1`, [U_FULLA])
ok('volver a leer la misma baja no duplica la baja ni el borrador', (await bajas(FULLA)).length === 1 && (await sql(`select count(*)::int n from liquidacion_final`))[0].n === 1)
// Cuenta de prueba: no genera nada.
await sql(`update usuarios set estado = 'inactivo' where id = $1`, [U_PRUEBA])
ok('cuenta de prueba no genera baja', (await sql(`select count(*)::int n from liquidacion_baja where empleado_id = $1`, [U_PRUEBA]))[0].n === 0)
// Sin CUIL: clave por empleado.
await sql(`update usuarios set estado = 'inactivo' where id = $1`, [U_SINCUIL])
ok('persona sin CUIL: baja con clave emp:<id>', (await sql(`select clave_persona from liquidacion_baja where empleado_id = $1`, [U_SINCUIL]))[0]?.clave_persona === `emp:${U_SINCUIL}`)

// ── 2) Completar la fecha (Administración) → misma baja ──────────────────────
let r = await como(ADM, () => rpc('liquidacion_baja_registrar', [U_FULLA, null, '2026-09-30', 'renuncia', 'app', null]))
bf = await bajas(FULLA)
ok('registrar con fecha completa la baja existente (no crea otra)', r.nueva === false && bf.length === 1
  && bf[0].fecha_baja.toISOString().slice(0, 10) === '2026-09-30' && bf[0].causa === 'renuncia', JSON.stringify(r))
ff = await finalDe(bf[0].id)
ok('el borrador queda con mes de la baja y para recalcular', ff.mes === '2026-09' && ff.requiere_recalculo === true)
ok('reintento idéntico → repetida, sin nueva confirmación',
  (await como(ADM, () => rpc('liquidacion_baja_registrar', [U_FULLA, null, '2026-09-30', 'renuncia', 'app', null]))).repetida === true
  && (await bajas(FULLA))[0].confirmaciones.length === 2)

// Permisos
ok('vigilador no registra bajas', await falla(() => como(VIG, () => rpc('liquidacion_baja_registrar', [U_PAN, null, '2026-10-03', 'renuncia', 'app', null])), /Gerencia o Administración/))
ok('jefe de supervisores no registra bajas', await falla(() => como(JEFE, () => rpc('liquidacion_baja_registrar', [U_PAN, null, '2026-10-03', 'renuncia', 'app', null])), /Gerencia o Administración/))
ok('sin usuario (service_role) no entra por la RPC pública', await falla(() => rpc('liquidacion_baja_registrar', [U_PAN, null, '2026-10-03', 'renuncia', 'app', null]), /Gerencia o Administración/))
ok('vigilador no lee las bajas', (await como(VIG, () => sql(`select count(*)::int n from liquidacion_baja`)))[0].n === 0)
ok('Administración sí las lee', (await como(ADM, () => sql(`select count(*)::int n from liquidacion_baja`)))[0].n === 2)
ok('nadie escribe directo en las tablas', await falla(() => como(GER, () => sql(`update liquidacion_final set estado = 'exportada'`)), /permission denied/))

// ── 3) ARCA: carga manual de la consulta ─────────────────────────────────────
const cargarArca = (consulta, cuil, inicio, fin, baja = null) => sql(
  `insert into arca_relaciones_laborales (consulta_fecha, cuil, apellido_nombre, fecha_inicio, fecha_fin, situacion_baja, cargado_por)
   values ($1, $2, 'PANIAGUA EDGAR IVAN', $3, $4, $5, '00000000-0000-0000-0000-000000002002') on conflict (consulta_fecha, cuil, fecha_inicio) do nothing`,
  [consulta, cuil, inicio, fin, baja])
await cargarArca('2026-09-18', PAN, '2026-08-02', null)
ok('relación vigente en ARCA no es baja', (await bajas(PAN)).length === 0)
await cargarArca('2026-10-13', PAN, '2026-08-02', '2026-10-20')
ok('fecha de fin futura (a la fecha de la consulta) no es baja', (await bajas(PAN)).length === 0)
await cargarArca('2026-10-20', PAN, '2026-08-02', '2026-10-03', 'Renuncia')
let bp = await bajas(PAN)
ok('ARCA con fin cumplido crea la baja (fuente arca, fecha de fin, inicio ARCA)', bp.length === 1 && bp[0].fuente === 'arca'
  && bp[0].fecha_baja.toISOString().slice(0, 10) === '2026-10-03' && bp[0].empleado_id === U_PAN && bp[0].registrada_por === '00000000-0000-0000-0000-000000002002', JSON.stringify(bp[0]))
await cargarArca('2026-10-20', PAN, '2026-08-02', '2026-10-03', 'Renuncia')
ok('cargar de nuevo la misma consulta no duplica', (await bajas(PAN)).length === 1 && (await bajas(PAN))[0].confirmaciones.length === 1)
await cargarArca('2026-10-19', PAN, '2026-08-02', '2026-10-03', 'Renuncia')
bp = await bajas(PAN)
ok('otra consulta con el mismo dato suma una confirmación, misma baja', bp.length === 1 && bp[0].confirmaciones.length === 2 && bp[0].discrepancia === null)
// La app confirma la misma baja con la misma fecha.
await como(ADM, () => rpc('liquidacion_baja_registrar', [U_PAN, null, '2026-10-03', 'renuncia', 'app', null]))
bp = await bajas(PAN)
ok('la app confirma la baja de ARCA sin duplicar y completa la causa', bp.length === 1 && bp[0].causa === 'renuncia' && bp[0].confirmaciones.length === 3)
// Otra fecha → discrepancia, no se pisa.
await como(ADM, () => rpc('liquidacion_baja_registrar', [U_PAN, null, '2026-10-08', 'renuncia', 'app', 'manual:otra']))
bp = await bajas(PAN)
ok('fecha distinta → discrepancia, la fecha no se pisa', bp.length === 1 && bp[0].fecha_baja.toISOString().slice(0, 10) === '2026-10-03' && /distintas/.test(bp[0].discrepancia ?? ''))
const finPan = await finalDe(bp[0].id)
// Reingreso: relación nueva posterior a la baja → baja nueva.
await cargarArca('2026-10-18', PAN, '2026-10-10', '2026-10-15')
ok('reingreso (relación nueva) con su propia baja → otra baja y otro borrador', (await bajas(PAN)).length === 2 && (await sql(`select count(*)::int n from liquidacion_final`))[0].n === 4)

// ── 4) Corrección de la discrepancia ─────────────────────────────────────────
ok('corregir exige motivo', await falla(() => como(ADM, () => rpc('liquidacion_baja_corregir', [bp[0].id, '2026-10-08', 'renuncia', ''])), /motivo/))
await como(ADM, () => rpc('liquidacion_baja_corregir', [bp[0].id, '2026-10-03', 'renuncia', 'ARCA y la renuncia firmada dicen 03/10']))
ok('corregir limpia la discrepancia y deja historial', (await bajas(PAN))[0].discrepancia === null
  && (await sql(`select count(*)::int n from liquidacion_final_historial where final_id = $1 and accion = 'correccion'`, [finPan.id]))[0].n === 1)

// ── 5) Cálculo versionado ────────────────────────────────────────────────────
const lineasPan = [
  { codigo: '000', concepto: 'DIAS', entrada: 'CAN', cantidad: 6, importe: null, total: 0 },
  { codigo: '001', concepto: 'horas', entrada: 'IMP', cantidad: 1, importe: 244872, total: 244872 },
  { codigo: '120003', concepto: 'sac', entrada: 'CANIMP', cantidad: 1, importe: 129983.42, total: 129983.42 },
  { codigo: '208', concepto: 'vac', entrada: 'CANIMP', cantidad: 3, importe: 40812, total: 122436 },
]
const guardar = (uid, f, version, hash, ya = [], faltantes = [], pagado = 0, lineas = lineasPan) => como(uid, () => rpc('liquidacion_final_guardar_calculo',
  [f, version, hash, JSON.stringify({ ya_liquidado: ya, extras: { pagado } }), JSON.stringify(lineas), JSON.stringify(faltantes), '[]']))
let g = await guardar(ADM, finPan.id, 0, 'hash-0001', [], [{ clave: 'vacaciones_saldo', detalle: 'falta' }])
ok('primer cálculo → versión 1', g.version === 1 && g.sin_cambios === false)
ok('reintento del mismo cálculo → sin cambios (no crea versión)', (await guardar(ADM, finPan.id, 0, 'hash-0001', [], [{ clave: 'vacaciones_saldo', detalle: 'falta' }])).sin_cambios === true)
ok('cálculo sobre versión vieja → rechazado (no se pisa)', await falla(() => guardar(GER, finPan.id, 0, 'hash-0002'), /cambió/))
ok('con faltantes no pasa a lista', await falla(() => como(ADM, () => rpc('liquidacion_final_marcar_lista', [finPan.id, 1])), /faltantes/))
ok('entradas: ajuste sin motivo rechazado', await falla(() => como(ADM, () => rpc('liquidacion_final_guardar_entradas', [finPan.id, JSON.stringify({ ajustes: [{ codigo: '208', cantidad: 2, motivo: '' }] }), 1])), /motivo/))
await como(ADM, () => rpc('liquidacion_final_guardar_entradas', [finPan.id, JSON.stringify({ vacaciones: { saldoDias: 3, tomadasDias: 0 } }), 1]))
ok('entradas marcan recalcular', (await sql(`select requiere_recalculo from liquidacion_final where id = $1`, [finPan.id]))[0].requiere_recalculo === true)
ok('con cambios sin recalcular no pasa a lista', await falla(() => como(ADM, () => rpc('liquidacion_final_marcar_lista', [finPan.id, 1])), /recalcular/))
g = await guardar(ADM, finPan.id, 1, 'hash-0003')
ok('recalcular → versión 2 sin faltantes', g.version === 2)
ok('exportar sin estar lista → rechazado', await falla(() => como(ADM, () => rpc('liquidacion_final_exportar', [finPan.id, 2, 'x.xls', 'arch-0001'])), /listo/))
await como(ADM, () => rpc('liquidacion_final_marcar_lista', [finPan.id, 2]))
ok('marcar lista', (await sql(`select estado from liquidacion_final where id = $1`, [finPan.id]))[0].estado === 'lista')

// ── 6) Doble pago al exportar ────────────────────────────────────────────────
const [{ id: perOct }] = await sql(`insert into liquidacion_periodo (mes, estado) values ('2026-10', 'exportada') returning id`)
await sql(`insert into liquidacion_enviado_visual (periodo_id, cuil, cod_interno, codigo, cantidad, importe) values ($1, $2, '010 Bis', '001', 1, 81624), ($1, $2, '101', 0, 0)`.replace("'101', 0, 0", "'010 Bis', '101', 0, 0"), [perOct, PAN])
ok('cambió lo liquidado en el mes desde el cálculo → no exporta', await falla(() => como(ADM, () => rpc('liquidacion_final_exportar', [finPan.id, 2, 'x.xls', 'arch-0001'])), /Doble pago: cambió lo liquidado/))
const ya = (await sql(`select public.liquidacion_final_ya_liquidado($1, '2026-10') as r`, [PAN]))[0].r
ok('lo ya liquidado se agrega por código', ya.length === 2 && ya.find(y => y.codigo === '001').importe === 81624)
// Extras pagadas por banco después del cálculo.
const [{ id: lote }] = await sql(`insert into liquidacion_pago_lote (periodo_id, tipo, hash, total, filas) values ($1, 'extras', 'h-extras', 10000, 1) returning id`, [perOct])
await sql(`insert into liquidacion_pago_registrado (lote_id, periodo_id, tipo, usuario_id, importe) values ($1, $2, 'extras', $3, 10000)`, [lote, perOct, U_PAN])
g = await guardar(ADM, finPan.id, 2, 'hash-0004', ya, [], 0)
await como(ADM, () => rpc('liquidacion_final_marcar_lista', [finPan.id, 3]))
ok('extras pagadas cambiaron desde el cálculo → no exporta', await falla(() => como(ADM, () => rpc('liquidacion_final_exportar', [finPan.id, 3, 'x.xls', 'arch-0001'])), /extras pagadas/))
await sql(`update liquidacion_pago_lote set anulado_at = now() where id = $1`, [lote])
ok('un lote anulado no cuenta como pagado', Number((await sql(`select public.liquidacion_final_extras_pagadas($1, '2026-10') as r`, [U_PAN]))[0].r) === 0)
const ex = await como(ADM, () => rpc('liquidacion_final_exportar', [finPan.id, 3, 'visual.xls', 'arch-0001']))
ok('exporta cuando lo considerado coincide', ex.estado === 'exportada' && ex.repetida === false)
ok('reintento con el mismo archivo → repetida', (await como(ADM, () => rpc('liquidacion_final_exportar', [finPan.id, 3, 'visual.xls', 'arch-0001']))).repetida === true)
ok('otro archivo después de exportar → rechazado', await falla(() => como(ADM, () => rpc('liquidacion_final_exportar', [finPan.id, 3, 'v2.xls', 'arch-0002'])), /otro archivo/))
ok('exportada: no se recalcula ni se cambian entradas', await falla(() => guardar(ADM, finPan.id, 3, 'hash-0099'), /ya no se puede/)
  && await falla(() => como(ADM, () => rpc('liquidacion_final_guardar_entradas', [finPan.id, '{}', 3])), /ya no se puede/))
ok('exportada: no se corrige ni anula la baja', await falla(() => como(ADM, () => rpc('liquidacion_baja_corregir', [bp[0].id, '2026-10-04', 'renuncia', 'probando'])), /exportada/)
  && await falla(() => como(ADM, () => rpc('liquidacion_baja_anular', [bp[0].id, 'probando'])), /exportada/))
ok('exportar NO cambia usuarios (acceso/pago banco independientes)', (await sql(`select estado, excluir_pago_banco from usuarios where id = $1`, [U_PAN]))[0].estado === 'activo')
ok('la detección no exportó ni cerró sola nada más', (await sql(`select count(*)::int n from liquidacion_final where estado in ('exportada','conciliada')`))[0].n === 1)

// Circuito mensual: no puede volver a mandar un código de la final del mismo mes.
const [{ id: perOct2 }] = await sql(`insert into liquidacion_periodo (mes, estado) values ('2026-10', 'borrador') returning id`)
ok('período mensual que repite 208 de la final → bloqueado', await falla(() => sql(`insert into liquidacion_enviado_visual (periodo_id, cuil, cod_interno, codigo, cantidad, importe) values ($1, $2, '010 Bis', '208', 3, 40812)`, [perOct2, PAN]), /Doble pago/))
await sql(`insert into liquidacion_enviado_visual (periodo_id, cuil, cod_interno, codigo, cantidad, importe) values ($1, $2, '010 Bis', '208', 0, 0)`, [perOct2, PAN])
ok('las líneas 0/0 (Visual calcula) no se bloquean', true)
await sql(`insert into liquidacion_enviado_visual (periodo_id, cuil, cod_interno, codigo, cantidad, importe) values ($1, $2, 'FULLA w', '208', 14, 40812)`, [perOct2, FULLA])
ok('otra persona sin final exportada no se bloquea', true)

// ── 7) Resultado de Visual y conciliación al centavo ─────────────────────────
const resultado = (imp208) => JSON.stringify([
  { codigo: '000', nombre: 'DIAS', cantidad: 6, importe: 6 },
  { codigo: '001', nombre: 'horas', cantidad: 1, importe: 244872 },
  { codigo: '120003', nombre: 'sac', cantidad: 1, importe: 129983.42 },
  { codigo: '208', nombre: 'vac', cantidad: 3, importe: imp208 },
  { codigo: '101', nombre: 'Jubilación', cantidad: 0, importe: 41234.1 },
])
ok('resultado con un concepto repetido → rechazado', await falla(() => como(ADM, () => rpc('liquidacion_final_importar_resultado',
  [finPan.id, 'r.xls', 'res-dup1', JSON.stringify([{ codigo: '208', importe: 1 }, { codigo: '208', importe: 2 }])])), /repetido/))
let ir = await como(ADM, () => rpc('liquidacion_final_importar_resultado', [finPan.id, 'res1.xls', 'res-0001', resultado(122436.01)]))
ok('importa el resultado (versión 1)', ir.version === 1 && ir.repetido === false)
ok('mismo archivo otra vez → repetido, sin versión nueva', (await como(ADM, () => rpc('liquidacion_final_importar_resultado', [finPan.id, 'res1.xls', 'res-0001', resultado(122436.01)]))).repetido === true
  && (await sql(`select count(*)::int n from liquidacion_final_resultado where final_id = $1`, [finPan.id]))[0].n === 1)
let conc = await como(ADM, () => sql(`select * from public.liquidacion_final_conciliacion($1) order by codigo`, [finPan.id]))
ok('un centavo de diferencia se detecta', conc.find(c => c.codigo === '208').estado === 'IMPORTE_DIFIERE', JSON.stringify(conc))
ok('lo que calcula Visual se informa sin conciliar', conc.find(c => c.codigo === '101').estado === 'CALCULADO_POR_VISUAL')
ok('000 compara cantidad, no importe (Visual repite los días en el importe)', conc.find(c => c.codigo === '000').estado === 'SIN_DIFERENCIA', JSON.stringify(conc.find(c => c.codigo === '000')))
let cr = await como(ADM, () => rpc('liquidacion_final_conciliar', [finPan.id]))
ok('con diferencias no concilia', cr.conciliada === false && cr.diferencias >= 1, JSON.stringify(cr))
ir = await como(ADM, () => rpc('liquidacion_final_importar_resultado', [finPan.id, 'res2.xls', 'res-0002', JSON.stringify(JSON.parse(resultado(122436)))]))
ok('resultado corregido → versión 2 vigente, la 1 se conserva', ir.version === 2
  && (await sql(`select count(*)::int n from liquidacion_final_resultado where final_id = $1 and not vigente`, [finPan.id]))[0].n === 1)
conc = await como(ADM, () => sql(`select * from public.liquidacion_final_conciliacion($1)`, [finPan.id]))
ok('todo al centavo', conc.every(c => ['SIN_DIFERENCIA', 'CALCULADO_POR_VISUAL'].includes(c.estado)), JSON.stringify(conc))
cr = await como(ADM, () => rpc('liquidacion_final_conciliar', [finPan.id]))
ok('concilia', cr.conciliada === true)
ok('conciliar de nuevo es idempotente', (await como(ADM, () => rpc('liquidacion_final_conciliar', [finPan.id]))).repetida === true)
ok('no se importan resultados sobre una conciliada', await falla(() => como(ADM, () => rpc('liquidacion_final_importar_resultado', [finPan.id, 'r3.xls', 'res-0003', resultado(1)])), /exportada y no conciliada/))
const hist = await sql(`select accion from liquidacion_final_historial where final_id = $1 order by id`, [finPan.id])
ok('historial completo y en orden', ['creado', 'confirmacion', 'correccion', 'calculo', 'entradas', 'lista', 'exportada', 'resultado', 'conciliacion'].every(a => hist.some(h => h.accion === a)), hist.map(h => h.accion).join(','))
ok('historial append-only para la app', await falla(() => como(GER, () => sql(`delete from liquidacion_final_historial`)), /permission denied/))

// ── 8) Anular una baja registrada por error ──────────────────────────────────
const bSin = (await sql(`select id from liquidacion_baja where empleado_id = $1`, [U_SINCUIL]))[0].id
await como(GER, () => rpc('liquidacion_baja_anular', [bSin, 'baja cargada por error']))
ok('anular conserva el registro y anula el borrador', (await sql(`select b.estado be, f.estado fe from liquidacion_baja b join liquidacion_final f on f.baja_id = b.id where b.id = $1`, [bSin]))[0].fe === 'anulada')
await sql(`update usuarios set estado = 'activo' where id = $1`, [U_SINCUIL])
await sql(`update usuarios set estado = 'inactivo' where id = $1`, [U_SINCUIL])
ok('después de anular, una baja nueva genera un borrador nuevo', (await sql(`select count(*)::int n from liquidacion_baja where empleado_id = $1 and estado = 'confirmada'`, [U_SINCUIL]))[0].n === 1)

// ── 9) Un error en la detección no impide dar la baja en la app ──────────────
await sql(`alter table liquidacion_baja add constraint t_rompe check (nombre <> 'PANIAGUA EDGAR IVAN' or fuente <> 'app' or fecha_baja is not null)`).catch(() => {})
await sql(`update usuarios set estado = 'inactivo' where id = $1`, [U_PAN])
ok('la baja en la app se guarda aunque falle la detección', (await sql(`select estado from usuarios where id = $1`, [U_PAN]))[0].estado === 'inactivo')
await sql(`alter table liquidacion_baja drop constraint if exists t_rompe`)

// ── 10) Rollback y re-aplicación ─────────────────────────────────────────────
await db.exec(readFileSync(RB, 'utf8'))
ok('rollback borra todo lo nuevo', (await sql(`select count(*)::int n from pg_tables where tablename like 'liquidacion_final%' or tablename = 'liquidacion_baja'`))[0].n === 0
  && (await sql(`select count(*)::int n from pg_trigger where tgname like 'trg_liquidacion_final%'`))[0].n === 0)
await sql(`update usuarios set estado = 'activo' where id = $1`, [U_FULLA])
await sql(`update usuarios set estado = 'inactivo' where id = $1`, [U_FULLA])
ok('tras el rollback la baja en la app sigue funcionando', (await sql(`select estado from usuarios where id = $1`, [U_FULLA]))[0].estado === 'inactivo')
await db.exec(readFileSync(MIG, 'utf8'))
ok('la migración se puede volver a aplicar', (await sql(`select count(*)::int n from pg_tables where tablename = 'liquidacion_final'`))[0].n === 1)

const fallas = resultados.filter(x => x[0] === 'FALLA')
for (const [e, n, x] of resultados) console.log(e, n, x && e === 'FALLA' ? `→ ${x}` : '')
console.log(`\n${resultados.length - fallas.length}/${resultados.length} controles OK`)
process.exit(fallas.length ? 1 : 0)
