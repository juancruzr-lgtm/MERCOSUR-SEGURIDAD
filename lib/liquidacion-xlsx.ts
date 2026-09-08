/**
 * lib/liquidacion-xlsx.ts
 *
 * Escritor del XLSX de liquidación a partir de una PlantillaLiquidacion
 * (lib/resumen-guardia). Usa exceljs porque la versión community de SheetJS no
 * escribe bordes/rellenos/fuentes. Este módulo SÓLO da formato visual: no
 * calcula nada, no cambia fórmulas ni valores — la semántica y los códigos de
 * Visual Sueldos vienen intactos desde la plantilla.
 *
 * Prioridad (pedido de Juan): legibilidad + posibilidad de copiar/arrastrar
 * fórmulas ($ absolutas ya vienen en la plantilla) + compatibilidad con el
 * proceso real (identidad oculta usuario_id/período para el futuro reimport).
 */
import type { PlantillaLiquidacion, FmtColumna } from '@/lib/resumen-guardia'

// Formatos numéricos por categoría. 'text' no se aplica a nivel columna (dejaría
// los números del bloque de parámetros como texto): esas celdas se formatean
// puntualmente.
const NUM_FMT: Record<Exclude<FmtColumna, 'text'>, string> = {
  money: '"$"#,##0.00',
  hours: '#,##0.##',
  int: '#,##0',
  pct: '0.0"%"',
}

// Paleta sobria y neutra (no es marca de nadie).
const COLOR = {
  headerBg: 'FF1F3A5F', headerFg: 'FFFFFFFF',
  labelBg: 'FFEDEFF2',
  tituloBg: 'FF2E5A88', tituloFg: 'FFFFFFFF',
  subtotalBg: 'FFDDE6F0',
  totalBg: 'FFC9D6E5',
  paramBg: 'FFF3F6FA',
  linea: 'FF9AAABF',
  lineaFuerte: 'FF1F3A5F',
}

function colLetterToNum(col: string): number {
  let n = 0
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

/**
 * Devuelve el .xlsx (bytes) de la plantilla ya formateada. La pantalla se
 * encarga de la descarga (Blob) o, en tests, de escribirlo a disco.
 */
export async function escribirPlantillaLiquidacionXLSX(
  plantilla: PlantillaLiquidacion,
): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  // Recalcular al abrir: así los resultados cacheados (incluidos los 0, p. ej.
  // AL=MAX(0,…) de mensualizados) se refrescan en Excel/LibreOffice al abrir.
  wb.calcProperties.fullCalcOnLoad = true
  const ws = wb.addWorksheet(plantilla.nombreHoja)

  // 1) Columnas: ancho, oculto y formato numérico.
  for (const c of plantilla.columnas) {
    const col = ws.getColumn(colLetterToNum(c.col))
    col.width = c.width
    if (c.hidden) col.hidden = true
    if (c.numFmt && c.numFmt !== 'text') col.numFmt = NUM_FMT[c.numFmt]
  }

  // 2) Celdas: valores y fórmulas. La fórmula lleva el resultado calculado para
  // que el archivo muestre importes aunque el visor no recalcule al abrir.
  for (const cell of plantilla.celdas) {
    const xc = ws.getCell(cell.ref)
    if (cell.f !== undefined) xc.value = { formula: cell.f, result: cell.v as number }
    else if (cell.v !== undefined) xc.value = cell.v
  }

  const visibles = plantilla.columnas.filter(c => !c.hidden).map(c => c.col)
  const primeraCol = visibles[0]
  const ultimaCol = visibles[visibles.length - 1]
  const { estilos } = plantilla

  const thin = { style: 'thin' as const, color: { argb: COLOR.linea } }
  const medium = { style: 'medium' as const, color: { argb: COLOR.lineaFuerte } }

  // 3) Bloque de parámetros (D1:E4 + F1/F2/G1/G2): caja + moneda + negrita.
  for (const r of estilos.parametros) {
    ws.getCell(`D${r}`).font = { bold: true }
    for (const col of ['E', 'F']) {
      const c = ws.getCell(`${col}${r}`)
      if (c.value != null && c.value !== '') { c.numFmt = NUM_FMT.money; c.fill = fillOf(COLOR.paramBg) }
    }
    ws.getCell(`D${r}`).fill = fillOf(COLOR.paramBg)
  }
  boxBorder(ws, 'D1', 'F4', medium)
  ws.getCell('A1').font = { bold: true, italic: true }

  // 4) Fila de etiquetas (5) y encabezado (6).
  for (const col of visibles) {
    const et = ws.getCell(`${col}${estilos.etiquetas}`)
    et.fill = fillOf(COLOR.labelBg); et.font = { italic: true, size: 9 }
    et.alignment = { horizontal: 'center' }
    const hd = ws.getCell(`${col}${estilos.encabezado}`)
    hd.fill = fillOf(COLOR.headerBg); hd.font = { bold: true, color: { argb: COLOR.headerFg } }
    hd.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    hd.border = { ...hd.border, bottom: medium }
  }

  // 5) Bandas: títulos de bloque, subtotales y total.
  const bandFill = (r: number, bg: string, opts: { top?: boolean; bottom?: boolean } = {}) => {
    for (const col of visibles) {
      const c = ws.getCell(`${col}${r}`)
      c.fill = fillOf(bg); c.font = { bold: true }
      const b: any = { ...c.border }
      if (opts.top) b.top = medium
      if (opts.bottom) b.bottom = medium
      if (opts.top || opts.bottom) c.border = b
    }
  }
  for (const r of estilos.titulos) bandFill(r, COLOR.tituloBg)
  for (const r of estilos.titulos) for (const col of visibles) ws.getCell(`${col}${r}`).font = { bold: true, color: { argb: COLOR.tituloFg } }
  for (const r of estilos.subtotales) bandFill(r, COLOR.subtotalBg, { top: true })
  bandFill(estilos.total, COLOR.totalBg, { top: true, bottom: true })

  // 6) Separadores verticales entre secciones (borde izquierdo) + marco exterior.
  const filasConBorde = [estilos.etiquetas, estilos.encabezado, ...estilos.filasDatos, ...estilos.subtotales, ...estilos.titulos, estilos.total]
  for (const r of filasConBorde) {
    for (const col of plantilla.secciones) {
      const c = ws.getCell(`${col}${r}`)
      c.border = { ...c.border, left: medium }
    }
    // marco exterior derecho
    const cr = ws.getCell(`${ultimaCol}${r}`)
    cr.border = { ...cr.border, right: medium }
    const cl = ws.getCell(`${primeraCol}${r}`)
    cl.border = { ...cl.border, left: medium }
  }

  ws.views = [{ state: 'frozen', xSplit: 4, ySplit: 6 }] // fija nombre + encabezado

  const buf = await wb.xlsx.writeBuffer()
  return buf as ArrayBuffer
}

function fillOf(argb: string) {
  return { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } }
}

function boxBorder(ws: any, from: string, to: string, side: any) {
  const m1 = from.match(/^([A-Z]+)(\d+)$/)!
  const m2 = to.match(/^([A-Z]+)(\d+)$/)!
  const c1 = colLetterToNum(m1[1]); const c2 = colLetterToNum(m2[1])
  const r1 = Number(m1[2]); const r2 = Number(m2[2])
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const cell = ws.getCell(r, c)
      const b: any = { ...cell.border }
      if (r === r1) b.top = side
      if (r === r2) b.bottom = side
      if (c === c1) b.left = side
      if (c === c2) b.right = side
      cell.border = b
    }
  }
}
