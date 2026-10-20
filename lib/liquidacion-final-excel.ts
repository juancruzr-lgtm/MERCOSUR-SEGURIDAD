// lib/liquidacion-final-excel.ts
//
// Excel de trabajo de la LIQUIDACIÓN FINAL (borrador). Sale del mismo cálculo
// que el .xls de Visual (lib/liquidacion-final.ts): datos arriba, fórmulas en las
// líneas de 120003/208/217/212 (revisables y editables en Excel), ordinarios con
// su base, ajustes manuales con motivo y la lista de faltantes. Cada fórmula
// lleva el resultado calculado, así el archivo muestra importes sin recalcular.
// Es para revisar y COMPLETAR: se puede bajar una o todas las finales (una hoja
// por persona), cargar lo que falte y volver a subirlo (lib/liquidacion-final-lote).
// Celdas editables: B12/B13 (vacaciones), B19 (período de Visual) y, en las
// líneas, Cantidad/Importe con el motivo en la columna H. Visual se alimenta con
// el .xls que genera la app desde el mismo cálculo.

import type { ResultadoLiquidacionFinal, LineaFinal } from '@/lib/liquidacion-final'

export interface CabeceraExcelFinal {
  finalId: string
  version: number
  nombre: string
  cuil: string | null
  legajoVisual: string | null
  causa: string | null
  fuente: string | null
  visualPeriodo?: string | null
}

const FMT_MONEY = '#,##0.00'
const FMT_FECHA = 'dd/mm/yyyy'
export const FILA_ENCABEZADO = 21
/** Filas vacías antes de TOTAL para agregar conceptos a mano (código + cantidad/importe + motivo). */
export const FILAS_LIBRES = 3

const fechaUTC = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`) : null)

/** Fórmulas (con su resultado) de las líneas calculadas por la final. */
function formulasLinea(l: LineaFinal, r: number): { c?: string; d?: string; e: string } {
  if (l.detalle.ajuste) return { e: l.entrada === 'CAN' ? '0' : `ROUND(C${r}*D${r},2)` }
  switch (l.codigo) {
    case '120003': return { d: 'ROUND((B3/200*150)/365*B11,2)', e: `ROUND(C${r}*D${r},2)` }
    case '208': return { c: 'B14', d: 'B5', e: `ROUND(C${r}*D${r},2)` }
    case '217': return { d: 'ROUND(B3/365*B14,2)', e: `D${r}` }
    case '212': return l.detalle.origen === 'final' ? { d: 'ROUND(MAX(0,B15*B6-B16),2)', e: `D${r}` } : { e: `D${r}` }
    default: return { e: l.entrada === 'CAN' ? '0' : `ROUND(C${r}*D${r},2)` }
  }
}

export async function escribirExcelLiquidacionFinal(
  cab: CabeceraExcelFinal,
  res: ResultadoLiquidacionFinal,
): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.calcProperties.fullCalcOnLoad = true
  agregarHojaLiquidacionFinal(wb.addWorksheet('Liquidación final'), cab, res)
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

/** Nombre de hoja válido y único (Excel: máx. 31 caracteres, sin []:*?/\). */
export function nombreHoja(base: string, usados: Set<string>): string {
  const limpio = (base.replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Persona').slice(0, 28)
  let n = limpio, i = 2
  while (usados.has(n.toLowerCase())) n = `${limpio.slice(0, 25)} (${i++})`
  usados.add(n.toLowerCase())
  return n
}

/**
 * Excel de trabajo con TODAS las finales indicadas: una hoja «Índice» y una hoja
 * por persona con el mismo formato que el Excel individual.
 */
export async function escribirLibroLiquidacionesFinales(
  items: { cab: CabeceraExcelFinal; res: ResultadoLiquidacionFinal; estado: string; fechaBaja: string | null }[],
): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.calcProperties.fullCalcOnLoad = true
  const indice = wb.addWorksheet('Índice')
  indice.columns = [{ width: 34 }, { width: 14 }, { width: 12 }, { width: 18 }, { width: 12 }, { width: 16 }, { width: 30 }]
  ;['Persona', 'CUIL', 'Baja', 'Estado', 'Pendientes', 'Total', 'Hoja'].forEach((t, i) => { const c = indice.getCell(1, i + 1); c.value = t; c.font = { bold: true } })
  indice.getCell('I1').value = 'Completá en cada hoja lo que falte (vacaciones B12/B13, período B19, o Cantidad/Importe con motivo en H) y volvé a subir este archivo en Liquidaciones finales.'
  const usados = new Set<string>(['índice'])
  items.forEach((it, i) => {
    const hoja = nombreHoja(it.cab.nombre, usados)
    agregarHojaLiquidacionFinal(wb.addWorksheet(hoja), it.cab, it.res)
    const r = i + 2
    indice.getCell(r, 1).value = it.cab.nombre
    const cuil = indice.getCell(r, 2); cuil.value = it.cab.cuil ?? ''; cuil.numFmt = '@'
    indice.getCell(r, 3).value = it.fechaBaja ? new Date(`${it.fechaBaja}T00:00:00Z`) : null
    indice.getCell(r, 3).numFmt = FMT_FECHA
    indice.getCell(r, 4).value = it.estado
    indice.getCell(r, 5).value = it.res.faltantes.length
    indice.getCell(r, 6).value = it.res.calculo.total; indice.getCell(r, 6).numFmt = FMT_MONEY
    indice.getCell(r, 7).value = { text: hoja, hyperlink: `#'${hoja}'!A1` } as any
  })
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

/** Escribe una liquidación final en una hoja (mismo formato para el individual y el lote). */
export function agregarHojaLiquidacionFinal(ws: any, cab: CabeceraExcelFinal, res: ResultadoLiquidacionFinal): void {
  ws.columns = [
    { width: 30 }, { width: 34 }, { width: 12 }, { width: 16 }, { width: 16 }, { width: 46 }, { width: 12 }, { width: 40 },
    { width: 22 }, { width: 38, hidden: true },
  ]
  const c = res.calculo
  const set = (ref: string, v: any, numFmt?: string) => { const x = ws.getCell(ref); x.value = v; if (numFmt) x.numFmt = numFmt; return x }
  const fx = (ref: string, formula: string, result: number | Date | null, numFmt?: string) =>
    set(ref, { formula, result: result ?? undefined } as any, numFmt)

  set('A1', `Liquidación final — ${cab.nombre}`).font = { bold: true, size: 13 }
  set('D1', `CUIL ${cab.cuil ?? '—'} · Legajo Visual ${cab.legajoVisual ?? '—'}`)
  set('D2', `Borrador v${cab.version} · causa: ${cab.causa ?? 'sin dato'} · origen: ${cab.fuente ?? '—'} · Visual: ${cab.visualPeriodo ?? 'período sin indicar'}`)
  set('J1', cab.finalId); set('J2', cab.version)   // identidad técnica (oculta)

  // ── Datos (B3:B18) ──
  const valorDiaFormula = Math.abs(c.bases.valorDia - c.bases.basico / 25) < 1e-6
  set('A3', 'Básico'); set('B3', c.bases.basico, FMT_MONEY)
  set('A4', 'Valor hora = básico/200'); fx('B4', 'B3/200', c.bases.basico / 200, FMT_MONEY)
  set('A5', 'Valor día (C3) = hora × 8')
  if (valorDiaFormula) fx('B5', 'B4*8', c.bases.valorDia, FMT_MONEY); else set('B5', c.bases.valorDia, FMT_MONEY)
  set('A6', 'Valor hora extra'); set('B6', c.bases.horaExtra, FMT_MONEY)
  set('A7', 'Fecha de ingreso'); set('B7', fechaUTC(c.fechas.ingreso), FMT_FECHA)
  set('A8', 'Fecha de baja'); set('B8', fechaUTC(c.fechas.baja), FMT_FECHA)
  set('A9', 'Inicio del semestre'); set('B9', fechaUTC(c.fechas.inicioSemestre), FMT_FECHA)
  set('A10', 'Inicio del cómputo SAC'); fx('B10', 'IF(B7="",B9,MAX(B7,B9))', fechaUTC(c.fechas.inicioComputo), FMT_FECHA)
  set('A11', 'Días computables SAC')
  if (c.fechas.conteo) fx('B11', c.fechas.conteo === 'inclusivo' ? 'B8-B10+1' : 'B8-B10', c.fechas.diasSAC, '0')
  else set('B11', null)   // regla sin confirmar: el 120003 queda pendiente
  if (c.fechas.variantes) set('D11', c.fechas.variantes.map(v => `${v.conteo}: ${v.dias} días = ${v.total}`).join(' · '))
  set('C11', c.fechas.regla)
  set('A12', 'Saldo de vacaciones (días)'); set('B12', c.vacaciones.saldo)
  set('A13', 'Vacaciones tomadas (días)'); set('B13', c.vacaciones.tomadas)
  set('A14', 'Vacaciones no gozadas'); fx('B14', 'B12-B13', c.vacaciones.noGozadas)
  if (c.vacaciones.nota) set('C14', c.vacaciones.nota)
  set('A15', 'Horas extra hasta la baja'); set('B15', c.extras.horas)
  set('A16', 'Extras ya pagadas por banco'); set('B16', c.extras.pagado, FMT_MONEY)
  set('A17', 'Presentismo del mes (fórmula)'); set('B17', c.presentismo.calculado, FMT_MONEY)
  if (c.presentismo.motivo) set('C17', c.presentismo.motivo)
  set('A18', 'Mes de la baja'); set('B18', c.mes ?? '—')
  set('A19', 'Período / tipo en Visual'); set('B19', c.visualPeriodo ?? null)
  set('C19', 'Editables: B12, B13, B19 y Cantidad/Importe de las líneas (con motivo en H). Filas vacías antes de TOTAL: conceptos nuevos.')
  for (let r = 3; r <= 19; r++) ws.getCell(`A${r}`).font = { bold: true }
  for (const ref of ['B12', 'B13', 'B19']) ws.getCell(ref).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7D6' } }

  // ── Líneas ──
  const enc = ['Código', 'Concepto', 'Cantidad', 'Importe a Visual', 'Total', 'Fórmula / base', 'Origen', 'Ajuste manual (motivo)', 'Tipo (Visual)']
  enc.forEach((t, i) => { const x = ws.getCell(FILA_ENCABEZADO, i + 1); x.value = t; x.font = { bold: true }; x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } } })
  let r = FILA_ENCABEZADO + 1
  const primera = r
  for (const l of res.lineas) {
    const f = formulasLinea(l, r)
    const cod = ws.getCell(`A${r}`); cod.value = l.codigo; cod.numFmt = '@'
    set(`B${r}`, l.concepto)
    if (f.c) fx(`C${r}`, f.c, l.cantidad); else set(`C${r}`, l.cantidad)
    if (f.d) fx(`D${r}`, f.d, l.importe, FMT_MONEY); else set(`D${r}`, l.importe, FMT_MONEY)
    fx(`E${r}`, f.e, l.total, FMT_MONEY)
    const base = l.detalle.base ? ' · ' + Object.entries(l.detalle.base).map(([k, v]) => `${k}: ${v}`).join(', ') : ''
    set(`F${r}`, `${l.detalle.formula}${base}${l.detalle.yaLiquidado ? ` · ya liquidado: ${l.detalle.yaLiquidado}` : ''}`)
    set(`G${r}`, l.detalle.origen)
    set(`I${r}`, l.detalle.tipo ?? '')
    if (l.detalle.ajuste) {
      const calc = l.detalle.calculado
      set(`H${r}`, `${l.detalle.ajuste.motivo}${calc ? ` (calculado: ${calc.cantidad ?? ''} × ${calc.importe ?? ''} = ${calc.total})` : ' (línea agregada a mano)'}`)
    }
    r++
  }
  // Filas libres para agregar conceptos a mano (se leen al volver a subir el archivo).
  for (let i = 0; i < FILAS_LIBRES; i++, r++) {
    ws.getCell(`A${r}`).numFmt = '@'
    fx(`E${r}`, `IF(A${r}="","",ROUND(IF(C${r}="",1,C${r})*D${r},2))`, null, FMT_MONEY)
    ws.getCell(`F${r}`).value = '(libre: código, cantidad, importe y motivo en H)'
    ws.getCell(`F${r}`).font = { italic: true, color: { argb: 'FF94A3B8' } }
  }
  set(`A${r}`, 'TOTAL').font = { bold: true }
  fx(`E${r}`, `SUM(E${primera}:E${r - 1})`, c.total, FMT_MONEY).font = { bold: true }
  r += 2

  const lista = (titulo: string, items: string[]) => {
    set(`A${r}`, titulo).font = { bold: true }
    r++
    if (!items.length) { set(`A${r}`, '—'); r++ }
    for (const t of items) { set(`A${r}`, t); r++ }
    r++
  }
  lista('FALTANTES (bloquean marcar como lista)', res.faltantes.map(f => f.detalle))
  lista('CONCEPTOS A EVALUAR POR LA CAUSAL', (c.causal?.evaluar ?? []).map(e => `${e.texto}: ${e.resolucion ?? 'SIN RESOLVER'}${e.motivo ? ' — ' + e.motivo : ''}`))
  lista('SUGERENCIAS (no incluidas; se incorporan con un ajuste)', (c.sugerencias ?? []).map(s => `${s.codigo} ${s.concepto}: ${s.total} — ${s.formula}. ${s.motivo}`))
  if (c.controlSAC) lista('CONTROL SAC (base legal según Visual)', [`Mejor remuneración imponible del semestre (${c.controlSAC.mes}): ${c.controlSAC.mejorRemuneracion} → ${c.controlSAC.totalLegal} (diferencia ${c.controlSAC.diferencia})`])
  lista('ADVERTENCIAS Y AJUSTES', res.advertencias)
  lista('YA LIQUIDADO EN EL MES (enviado a Visual)', c.ya_liquidado.map(y => `${y.codigo}: cantidad ${y.cantidad ?? '—'} · importe ${y.importe ?? '—'}`))
}
