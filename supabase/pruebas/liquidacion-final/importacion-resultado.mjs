// Importación del resultado de Visual de las liquidaciones finales, con datos
// representativos de producción (04/11/2026: 22 finales, 15 exportadas, 0
// resultados importados) y foco en que una final NUNCA se sume dos veces con la
// liquidación mensual.
//
//   node supabase/pruebas/liquidacion-final/importacion-resultado.mjs [raíz del repo]
//
// Casos (anonimizados, con la forma de los de producción):
//   A — baja 15/10 con el mensual de octubre YA exportado con su 000 (días):
//       la final lleva 120003 / 208 / 217 / 212 (como la final de octubre que
//       comparte CUIL con el mensual en producción).
//   B — baja 20/10 que no salió en el mensual: la final lleva 000 (CAN), 001,
//       120003 y 208.
//   C — baja 25/10: se usa para archivos mal armados (concepto repetido,
//       código vacío) y para el lote con el mismo archivo.
//   D — baja 28/10 con la final calculada y lista pero NO exportada.
// Corre sobre la base mínima de ./prelude.sql + 20261110120000. Sólo PGlite.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const MIG = `${REPO}/supabase/migrations/20261110120000_liquidacion_final_borrador.sql`
const db = new PGlite()
process.on('unhandledRejection', e => { console.error('ERROR:', e.message); process.exit(2) })
const resultados = []
const ok = (nombre, cond, extra = '') => { resultados.push([cond ? 'OK ' : 'FALLA', nombre, extra]) }
async function sql(texto, params) { return (await db.query(texto, params)).rows }
async function como(uid, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role authenticated;`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
async function falla(fn, patron) { try { await fn(); return 'NO FALLÓ' } catch (e) { return patron.test(e.message) ? true : `otro error: ${e.message}` } }
const rpc = async (nombre, args = []) => (await sql(`select public.${nombre}(${args.map((_, i) => `$${i + 1}`).join(', ')}) as r`, args))[0].r

const ADM = '00000000-0000-0000-0000-000000001002'
const GER = '00000000-0000-0000-0000-000000001001'
const SUP = '00000000-0000-0000-0000-000000001003'
const VIG = '00000000-0000-0000-0000-000000001010'
const U = { A: '00000000-0000-0000-0000-000000002010', B: '00000000-0000-0000-0000-000000002011', C: '00000000-0000-0000-0000-000000002012', D: '00000000-0000-0000-0000-000000002013' }
const CUIL = { A: '20301112223', B: '20302223334', C: '20303334445', D: '20304445556' }

await db.exec(readFileSync(new URL('./prelude.sql', import.meta.url), 'utf8'))
await db.exec(readFileSync(MIG, 'utf8'))

// ── Mensual de octubre exportado (antes de las finales), con A adentro ───────
const [{ id: PER_OCT }] = await sql(`insert into liquidacion_periodo (mes, estado) values ('2026-10', 'exportada') returning id`)
await sql(`insert into liquidacion_enviado_visual (periodo_id, cuil, cod_interno, codigo, cantidad, importe) values
  ($1, $2, 'L1 Visual', '000', 15, 15),
  ($1, '27999888777', 'L9 Visual', '001', 1, 612180),
  ($1, '27999888777', 'L9 Visual', '208', 14, 571368)`, [PER_OCT, CUIL.A])

// ── Bajas confirmadas → finales ──────────────────────────────────────────────
const bajas = { A: ['renuncia', '2026-10-15'], B: ['renuncia', '2026-10-20'], C: ['renuncia', '2026-10-25'], D: ['renuncia', '2026-10-28'] }
const FIN = {}
for (const [k, [causa, fecha]] of Object.entries(bajas)) {
  const r = await como(ADM, () => rpc('baja_guardar_borrador', [null, U[k], JSON.stringify({ causa, fecha_baja: fecha, origen: 'legajo' })]))
  const c = await como(ADM, () => rpc('baja_confirmar', [r.baja_id, JSON.stringify({ devengadas: 14, tomadas: 5, pendientes: 9, metodo: 'empresa', verificadas: true, nota: 'prueba' })]))
  FIN[k] = c.final_id
}
ok('cuatro bajas confirmadas generan cuatro finales de octubre', Object.values(FIN).every(Boolean)
  && (await sql(`select count(*)::int n from liquidacion_final where mes = '2026-10'`))[0].n === 4)

const LINEAS = {
  A: [
    { codigo: '120003', concepto: 'SAC proporcional', entrada: 'CANIMP', cantidad: 1, importe: 150000.55, total: 150000.55 },
    { codigo: '208', concepto: 'Vacaciones no gozadas', entrada: 'CANIMP', cantidad: 9, importe: 40812, total: 367308 },
    { codigo: '217', concepto: 'SAC s/ vacaciones', entrada: 'IMP', cantidad: 1, importe: 30608.99, total: 30608.99 },
    { codigo: '212', concepto: 'Gratificación extraordinaria', entrada: 'CANIMP', cantidad: 1, importe: 52000, total: 52000 },
  ],
  B: [
    { codigo: '000', concepto: 'Días trabajados', entrada: 'CAN', cantidad: 12, importe: 0, total: 0 },
    { codigo: '001', concepto: 'Básico', entrada: 'CANIMP', cantidad: 1, importe: 489744, total: 489744 },
    { codigo: '120003', concepto: 'SAC proporcional', entrada: 'CANIMP', cantidad: 1, importe: 98500.1, total: 98500.1 },
    { codigo: '208', concepto: 'Vacaciones no gozadas', entrada: 'CANIMP', cantidad: 9, importe: 40812, total: 367308 },
  ],
  C: [
    { codigo: '120003', concepto: 'SAC proporcional', entrada: 'CANIMP', cantidad: 1, importe: 120000, total: 120000 },
    { codigo: '208', concepto: 'Vacaciones no gozadas', entrada: 'CANIMP', cantidad: 9, importe: 40812, total: 367308 },
  ],
  D: [
    { codigo: '120003', concepto: 'SAC proporcional', entrada: 'CANIMP', cantidad: 1, importe: 130000, total: 130000 },
  ],
}
for (const k of ['A', 'B', 'C', 'D']) {
  const ya = (await sql(`select public.liquidacion_final_ya_liquidado($1, '2026-10') as r`, [CUIL[k]]))[0].r
  await como(ADM, () => rpc('liquidacion_final_guardar_calculo', [FIN[k], 0, `calc-${k}-0001`,
    JSON.stringify({ ya_liquidado: ya, extras: { pagado: 0 } }), JSON.stringify(LINEAS[k]), '[]', '[]']))
  await como(ADM, () => rpc('liquidacion_final_marcar_lista', [FIN[k], 1]))
  if (k !== 'D') await como(ADM, () => rpc('liquidacion_final_exportar', [FIN[k], 1, `finales-oct-${k}.xls`, `export-${k}-0001`]))
}
const estados = Object.fromEntries((await sql(`select id, estado from liquidacion_final`)).map(r => [r.id, r.estado]))
ok('A, B y C exportadas; D lista sin exportar', estados[FIN.A] === 'exportada' && estados[FIN.B] === 'exportada' && estados[FIN.C] === 'exportada' && estados[FIN.D] === 'lista', JSON.stringify(estados))
ok('A guardó lo que ya había salido en el mensual (000 de octubre)', JSON.stringify((await sql(`select calculo->'ya_liquidado' as y from liquidacion_final where id = $1`, [FIN.A]))[0].y) === JSON.stringify([{ codigo: '000', importe: 15, cantidad: 15 }]))

// ── Lo mensual NO puede repetir lo de una final exportada ────────────────────
const [{ id: PER_OCT2 }] = await sql(`insert into liquidacion_periodo (mes, estado) values ('2026-10', 'borrador') returning id`)
const [{ id: PER_NOV }] = await sql(`insert into liquidacion_periodo (mes, estado) values ('2026-11', 'borrador') returning id`)
const enviar = (per, cuil, codigo, cant, imp) => sql(`insert into liquidacion_enviado_visual (periodo_id, cuil, cod_interno, codigo, cantidad, importe) values ($1, $2, 'x', $3, $4, $5)`, [per, cuil, codigo, cant, imp])
ok('mensual de octubre con el 208 de A → bloqueado (doble pago)', await falla(() => enviar(PER_OCT2, CUIL.A, '208', 9, 367308), /Doble pago/))
ok('mensual de octubre con el 212 de A → bloqueado', await falla(() => enviar(PER_OCT2, CUIL.A, '212', 1, 52000), /Doble pago/))
ok('mensual de octubre con el 001 de B (CUIL con guiones) → bloqueado', await falla(() => enviar(PER_OCT2, '20-30222333-4', '001', 1, 489744), /Doble pago/))
await enviar(PER_OCT2, CUIL.A, '001', 1, 100)
ok('un concepto que la final de A NO lleva (001) sí puede ir en el mensual', true)
await enviar(PER_OCT2, CUIL.B, '000', 12, 12)
ok('el 000 de B (total 0 en la final) no se bloquea: los días no son plata', true)
await enviar(PER_NOV, CUIL.A, '208', 9, 367308)
ok('el mismo código en OTRO mes no se bloquea', true)
await enviar(PER_OCT2, CUIL.D, '120003', 1, 130000)
ok('D (lista, no exportada) todavía no bloquea el mensual', true)

// Huella de todo lo mensual: la importación de finales no lo puede tocar.
const huellaMensual = async () => (await sql(`select md5(coalesce(string_agg(e::text, '|' order by e.id), '')) h from liquidacion_enviado_visual e`))[0].h
  + (await sql(`select md5(coalesce(string_agg(p::text, '|' order by p.id), '')) h from liquidacion_periodo p`))[0].h
const mensualAntes = await huellaMensual()

// ── A: resultado de Visual correcto (con lo que Visual calcula solo) ─────────
const conc = async (k) => como(ADM, () => sql(`select * from public.liquidacion_final_conciliacion($1) order by codigo`, [FIN[k]]))
const imp = (k, archivo, hash, conceptos) => como(ADM, () => rpc('liquidacion_final_importar_resultado', [FIN[k], archivo, hash, JSON.stringify(conceptos)]))
const DESCUENTOS = [
  { codigo: '101', nombre: 'Jubilación 11%', cantidad: 0, importe: 65881.7 },
  { codigo: '103', nombre: 'Ley 19032 3%', cantidad: 0, importe: 17967.74 },
  { codigo: '105', nombre: 'Obra social 3%', cantidad: 0, importe: 17967.74 },
]
const resA = [
  { codigo: '120003', nombre: 'S.A.C. PROPORCIONAL', cantidad: 1, importe: 150000.55 },
  { codigo: '208', nombre: 'VACACIONES NO GOZADAS', cantidad: 9, importe: 367308 },
  { codigo: '217', nombre: 'SAC S/VAC NO GOZADAS', cantidad: 1, importe: 30608.99 },
  { codigo: '212', nombre: 'GRATIFICACION EXTRAORDINARIA', cantidad: 1, importe: 52000 },
  ...DESCUENTOS,
]
let r = await imp('A', 'Planilla finales oct.xls', 'visual-oct-0001', resA)
ok('A: primer resultado → versión 1', r.version === 1 && r.repetido === false, JSON.stringify(r))
let c = await conc('A')
ok('A: los 4 conceptos de la final coinciden al centavo', ['120003', '208', '212', '217'].every(cod => c.find(x => x.codigo === cod)?.estado === 'SIN_DIFERENCIA'), JSON.stringify(c))
ok('A: lo que calcula Visual (101/103/105) se informa sin conciliar', ['101', '103', '105'].every(cod => c.find(x => x.codigo === cod)?.estado === 'CALCULADO_POR_VISUAL'))
ok('A: el 000 del mensual NO aparece en la conciliación de la final', !c.some(x => x.codigo === '000'))
ok('A: concilia', (await como(ADM, () => rpc('liquidacion_final_conciliar', [FIN.A]))).conciliada === true)
ok('A conciliada: el mismo archivo otra vez → «repetido», sin versión nueva', (await imp('A', 'Planilla finales oct.xls', 'visual-oct-0001', resA)).repetido === true
  && (await sql(`select count(*)::int n from liquidacion_final_resultado where final_id = $1`, [FIN.A]))[0].n === 1)
ok('A conciliada: otro archivo → rechazado', await falla(() => imp('A', 'otra.xls', 'visual-oct-0099', resA), /exportada y no conciliada/))

// ── B: primero suben la planilla del MENSUAL por error, después la buena ─────
const planillaMensualB = [
  { codigo: '000', nombre: 'DIAS TRABAJADOS', cantidad: 12, importe: 12 },
  { codigo: '001', nombre: 'BASICO', cantidad: 1, importe: 489744 },
  { codigo: '204', nombre: 'PRESENTISMO', cantidad: 1, importe: 61218 },
  ...DESCUENTOS,
]
r = await imp('B', 'Planilla octubre MENSUAL.xls', 'visual-mensual-oct', planillaMensualB)
c = await conc('B')
ok('B con la planilla equivocada: faltan 120003 y 208 en el resultado', ['120003', '208'].every(cod => c.find(x => x.codigo === cod)?.estado === 'FALTANTE_EN_RESULTADO'), JSON.stringify(c))
ok('B con la planilla equivocada: el 204 del mensual queda como «calculado por Visual», no se suma a la final', c.find(x => x.codigo === '204')?.estado === 'CALCULADO_POR_VISUAL')
ok('B con la planilla equivocada: NO concilia', (await como(ADM, () => rpc('liquidacion_final_conciliar', [FIN.B]))).conciliada === false)
const resB = (dias000) => [
  { codigo: '000', nombre: 'DIAS TRABAJADOS', cantidad: dias000, importe: dias000 }, // Visual repite los días en el importe
  { codigo: '001', nombre: 'BASICO', cantidad: 1, importe: 489744 },
  { codigo: '120003', nombre: 'S.A.C. PROPORCIONAL', cantidad: 1, importe: 98500.1 },
  { codigo: '208', nombre: 'VACACIONES NO GOZADAS', cantidad: 9, importe: 367308 },
  ...DESCUENTOS,
]
await imp('B', 'Planilla finales oct v2.xls', 'visual-oct-b-0002', resB(11))
c = await conc('B')
ok('B: 000 (CAN) con un día menos → CANTIDAD_DIFIERE (se concilia por cantidad, no por importe)', c.find(x => x.codigo === '000')?.estado === 'CANTIDAD_DIFIERE', JSON.stringify(c.find(x => x.codigo === '000')))
r = await imp('B', 'Planilla finales oct v3.xls', 'visual-oct-b-0003', resB(12))
c = await conc('B')
ok('B: tercera versión, sólo la última vigente', r.version === 3
  && (await sql(`select count(*)::int n from liquidacion_final_resultado where final_id = $1 and vigente`, [FIN.B]))[0].n === 1
  && (await sql(`select count(*)::int n from liquidacion_final_resultado where final_id = $1`, [FIN.B]))[0].n === 3)
ok('B: la conciliación usa la versión vigente (000 por cantidad: 12 = 12)', c.find(x => x.codigo === '000')?.estado === 'SIN_DIFERENCIA'
  && c.filter(x => x.entrada).every(x => x.estado === 'SIN_DIFERENCIA'), JSON.stringify(c))
ok('B: concilia', (await como(ADM, () => rpc('liquidacion_final_conciliar', [FIN.B]))).conciliada === true)

// ── C: archivos mal armados no dejan nada a medias ───────────────────────────
const resultadosC = async () => (await sql(`select count(*)::int n from liquidacion_final_resultado where final_id = $1`, [FIN.C]))[0].n
ok('C: el mensual y la final mezclados (208 dos veces con importe) → rechazado, no se suman', await falla(() => imp('C', 'mezcla.xls', 'visual-mezcla-0001', [
  { codigo: '208', nombre: 'VAC (mensual)', cantidad: 14, importe: 571368 },
  { codigo: '208', nombre: 'VAC (final)', cantidad: 9, importe: 367308 },
  { codigo: '120003', nombre: 'SAC', cantidad: 1, importe: 120000 },
]), /concepto repetido/))
ok('C: el rechazo no dejó versión ni conceptos', (await resultadosC()) === 0 && (await sql(`select count(*)::int n from liquidacion_final_resultado_concepto`))[0].n === resA.length + planillaMensualB.length + 2 * resB(0).length)
ok('C: un concepto sin código → rechazado sin dejar nada a medias', await falla(() => imp('C', 'sin-codigo.xls', 'visual-sincod-0001', [
  { codigo: '120003', nombre: 'SAC', cantidad: 1, importe: 120000 },
  { codigo: '', nombre: '???', cantidad: 1, importe: 5 },
]), /sin código/) && (await resultadosC()) === 0)
ok('C: sin conceptos → rechazado', await falla(() => imp('C', 'vacio.xls', 'visual-vacio-0001', []), /no trae conceptos/))
ok('C: hash corto → rechazado', await falla(() => imp('C', 'x.xls', 'abc', resA), /Hash/))
// Lote: el MISMO archivo de Visual sirve para varias finales (hash único por final).
r = await imp('C', 'Planilla finales oct.xls', 'visual-oct-0001', [
  { codigo: '120003', nombre: 'S.A.C. PROPORCIONAL', cantidad: 1, importe: 120000 },
  { codigo: '208', nombre: 'VACACIONES NO GOZADAS', cantidad: 9, importe: 367308 },
  ...DESCUENTOS,
])
ok('C: el mismo archivo del lote (mismo hash que A) se importa para C como su versión 1', r.version === 1 && r.repetido === false)

// ── D: lista pero no exportada ───────────────────────────────────────────────
ok('D (no exportada) → no se reimporta resultado', await falla(() => imp('D', 'd.xls', 'visual-d-0001', [{ codigo: '120003', nombre: 'SAC', cantidad: 1, importe: 130000 }]), /exportada/))

// ── Permisos ─────────────────────────────────────────────────────────────────
ok('supervisor no importa resultados', await falla(() => como(SUP, () => rpc('liquidacion_final_importar_resultado', [FIN.C, 'x.xls', 'visual-sup-0001', JSON.stringify(resA)])), /Gerencia o Administración/))
ok('supervisor no lee resultados ni conceptos', (await como(SUP, () => sql(`select (select count(*) from liquidacion_final_resultado) + (select count(*) from liquidacion_final_resultado_concepto) as n`)))[0].n == 0)
ok('supervisor: la conciliación no le devuelve filas', (await como(SUP, () => sql(`select count(*)::int n from public.liquidacion_final_conciliacion($1)`, [FIN.A])))[0].n === 0)
ok('el vigilador dado de baja no lee nada de su final', (await como(VIG, () => sql(`select (select count(*) from liquidacion_final) + (select count(*) from liquidacion_final_resultado) as n`)))[0].n == 0)
ok('nadie escribe directo en los resultados', await falla(() => como(GER, () => sql(`insert into liquidacion_final_resultado (final_id, version, hash) values ($1, 9, 'directo-0001')`, [FIN.C])), /permission denied/))
ok('anon no ejecuta la importación', await falla(async () => {
  await db.exec(`set role anon`)
  try { await rpc('liquidacion_final_importar_resultado', [FIN.C, 'x.xls', 'visual-anon-0001', JSON.stringify(resA)]) } finally { await db.exec('reset role') }
}, /permission denied/))

// ── Nada se suma dos veces con el mensual ────────────────────────────────────
ok('importar resultados de finales NO tocó nada del mensual (enviado a Visual ni períodos)', (await huellaMensual()) === mensualAntes)
const dobles = await sql(`
  select f.id, l.codigo from liquidacion_final f
    join baja_laboral b on b.id = f.baja_id
    join liquidacion_final_linea l on l.final_id = f.id and l.total <> 0
    join liquidacion_periodo p on p.mes = f.mes and p.estado <> 'anulado'
    join liquidacion_enviado_visual e on e.periodo_id = p.id and e.codigo = l.codigo
         and regexp_replace(coalesce(e.cuil, ''), '\\D', '', 'g') = b.cuil
         and (coalesce(e.importe, 0) <> 0 or coalesce(e.cantidad, 0) <> 0)
   where f.estado in ('exportada', 'conciliada')`)
ok('ningún concepto con importe está a la vez en una final exportada y en el mensual del mismo mes', dobles.length === 0, JSON.stringify(dobles))
const hist = await sql(`select final_id, count(*)::int n from liquidacion_final_historial where accion = 'resultado' group by 1`)
const nHist = Object.fromEntries(hist.map(h => [h.final_id, h.n]))
ok('historial: una entrada «resultado» por importación real (los repetidos y rechazados no cuentan)', nHist[FIN.A] === 1 && nHist[FIN.B] === 3 && nHist[FIN.C] === 1 && !nHist[FIN.D], JSON.stringify(nHist))
ok('cada resultado guarda exactamente los conceptos del archivo (no suma los de otras versiones)', (await sql(`
  select r.version, count(c.*)::int n from liquidacion_final_resultado r join liquidacion_final_resultado_concepto c on c.resultado_id = r.id
   where r.final_id = $1 group by r.version order by r.version`, [FIN.B])).map(x => x.n).join(',') === [planillaMensualB.length, resB(0).length, resB(0).length].join(','))

const fallas = resultados.filter(x => x[0] === 'FALLA')
for (const [e, n, x] of resultados) console.log(e, n, x && e === 'FALLA' ? `→ ${x}` : '')
console.log(`\n${resultados.length - fallas.length}/${resultados.length} controles OK`)
process.exit(fallas.length ? 1 : 0)
