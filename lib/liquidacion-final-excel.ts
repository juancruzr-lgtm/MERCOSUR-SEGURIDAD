// lib/liquidacion-final-excel.ts
//
// Excel de trabajo de la LIQUIDACIÓN FINAL (borrador). Sale del mismo cálculo
// que el .xls de Visual (lib/liquidacion-final.ts): datos arriba, fórmulas en las
// líneas de 120003/208/217/212 (revisables y editables en Excel), ordinarios con
// su base, ajustes manuales con motivo y la lista de faltantes. Cada fórmula
// lleva el resultado calculado, así el archivo muestra importes sin recalcular.
// Es para revisar: Visual se alimenta con el .xls que genera la app.

import type { ResultadoLiquidacionFinal, LineaFinal } from '@/lib/liquidacion-final'

export interface CabeceraExcelFinal {
  finalId: string
  version: number
  nombre: string
  cuil: string | null
  legajoVisual: string | null
  causa: string | null
  fuente: string | null
}

const FMT_MONEY = '#,##0.00'
const FMT_FECHA = 'dd/mm/yyyy'
const FILA_ENCABEZADO = 21

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
  const ws = wb.addWorksheet('Liquidación final')
  ws.columns = [
    { width: 30 }, { width: 34 }, { width: 12 }, { width: 16 }, { width: 16 }, { width: 46 }, { width: 12 }, { width: 40 },
    { width: 3 }, { width: 38, hidden: true },
  ]
  const c = res.calculo
  const set = (ref: string, v: any, numFmt?: string) => { const x = ws.getCell(ref); x.value = v; if (numFmt) x.numFmt = numFmt; return x }
  const fx = (ref: string, formula: string, result: number | Date | null, numFmt?: string) =>
    set(ref, { formula, result: result ?? undefined } as any, numFmt)

  set('A1', `Liquidación final — ${cab.nombre}`).font = { bold: true, size: 13 }
  set('D1', `CUIL ${cab.cuil ?? '—'} · Legajo Visual ${cab.legajoVisual ?? '—'}`)
  set('D2', `Borrador v${cab.version} · causa: ${cab.causa ?? 'sin dato'} · fuente: ${cab.fuente ?? '—'}`)
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
  set('A11', 'Días computables SAC'); fx('B11', 'B8-B10', c.fechas.diasSAC, '0')
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
  for (let r = 3; r <= 18; r++) ws.getCell(`A${r}`).font = { bold: true }

  // ── Líneas ──
  const enc = ['Código', 'Concepto', 'Cantidad', 'Importe a Visual', 'Total', 'Fórmula / base', 'Origen', 'Ajuste manual (motivo)']
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
    if (l.detalle.ajuste) {
      const calc = l.detalle.calculado
      set(`H${r}`, `${l.detalle.ajuste.motivo}${calc ? ` (calculado: ${calc.cantidad ?? ''} × ${calc.importe ?? ''} = ${calc.total})` : ' (línea agregada a mano)'}`)
    }
    r++
  }
  set(`A${r}`, 'TOTAL').font = { bold: true }
  fx(`E${r}`, res.lineas.length ? `SUM(E${primera}:E${r - 1})` : '0', c.total, FMT_MONEY).font = { bold: true }
  r += 2

  const lista = (titulo: string, items: string[]) => {
    set(`A${r}`, titulo).font = { bold: true }
    r++
    if (!items.length) { set(`A${r}`, '—'); r++ }
    for (const t of items) { set(`A${r}`, t); r++ }
    r++
  }
  lista('FALTANTES (bloquean marcar como lista)', res.faltantes.map(f => f.detalle))
  lista('ADVERTENCIAS Y AJUSTES', res.advertencias)
  lista('YA LIQUIDADO EN EL MES (enviado a Visual)', c.ya_liquidado.map(y => `${y.codigo}: cantidad ${y.cantidad ?? '—'} · importe ${y.importe ?? '—'}`))

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}
