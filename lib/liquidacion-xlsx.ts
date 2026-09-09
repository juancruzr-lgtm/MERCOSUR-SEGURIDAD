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

  // 7) Indicadores recuperados del Excel original de Juan (auditado, no inventado):
  //    - AM (% ex): escala de color 3 pasos rojo→amarillo→verde (semáforo del % de
  //      extras). Límites y colores EXACTOS del archivo original.
  //    - AS (po hs = costo por hora = total/horas): barra de datos magenta.
  //    - Bloque REC vs Extras (horas y %) + gráfico de torta (imagen) debajo del total.
  //    Nada de esto toca valores/fórmulas ni la identidad oculta: el parser de
  //    reimportación lee por BD (usuario_id) e índices de columna, intactos.
  if (estilos.filasDatos.length > 0) {
    const r0 = Math.min(...estilos.filasDatos)
    const r1 = Math.max(...estilos.filasDatos)
    // Semáforo del % de extras (AM). cfvo/colores idénticos al original.
    ws.addConditionalFormatting({
      ref: `AM${r0}:AM${r1}`,
      rules: [{
        type: 'colorScale', priority: 1,
        cfvo: [{ type: 'percent', value: 10 }, { type: 'percentile', value: 30 }, { type: 'percent', value: 40 }],
        color: [{ argb: 'FFFF0000' }, { argb: 'FFFFEB84' }, { argb: 'FFA9D18E' }],
      } as any],
    })
    // Barra de datos del costo por hora (AS). Color magenta original.
    ws.addConditionalFormatting({
      ref: `AS${r0}:AS${r1}`,
      rules: [{
        type: 'dataBar', priority: 2,
        cfvo: [{ type: 'min' }, { type: 'max' }],
        color: { argb: 'FFD6007B' },
      } as any],
    })

    // Bloque REC vs Extras + gráfico, debajo del TOTAL GENERAL. Referencia a las
    // celdas de total (AG=horas rec, AL=hs extras) para que sea siempre en vivo.
    const t = estilos.total
    const base = t + 2
    const g = (ref: string) => plantilla.celdas.find(c => c.ref === ref)
    const recTotal = Number(g(`AG${t}`)?.v ?? 0)
    const extTotal = Number(g(`AL${t}`)?.v ?? 0)
    const den = recTotal + extTotal
    const put2 = (ref: string, v: any, fmt?: string, opts?: { bold?: boolean; f?: string }) => {
      const c = ws.getCell(ref)
      c.value = opts?.f ? ({ formula: opts.f, result: v } as any) : v
      if (fmt) c.numFmt = fmt
      if (opts?.bold) c.font = { bold: true }
    }
    put2(`AC${base}`, 'INDICADORES DEL MES', undefined, { bold: true })
    put2(`AC${base + 1}`, 'Horas REC'); put2(`AD${base + 1}`, recTotal, NUM_FMT.hours, { f: `AG${t}` })
    put2(`AC${base + 2}`, 'Horas Extras'); put2(`AD${base + 2}`, extTotal, NUM_FMT.hours, { f: `AL${t}` })
    put2(`AC${base + 3}`, '% REC'); put2(`AD${base + 3}`, den > 0 ? recTotal / den : 0, '0.0%', { f: `IF((AG${t}+AL${t})>0,AG${t}/(AG${t}+AL${t}),0)` })
    put2(`AC${base + 4}`, '% Extras'); put2(`AD${base + 4}`, den > 0 ? extTotal / den : 0, '0.0%', { f: `IF((AG${t}+AL${t})>0,AL${t}/(AG${t}+AL${t}),0)` })
    ws.getCell(`AC${base}`).fill = fillOf(COLOR.labelBg)

    // Gráfico de torta REC vs Extras como IMAGEN (exceljs community no escribe
    // gráficos nativos; se inserta PNG generado en el navegador — acompañado por
    // las celdas reales de arriba). En entornos sin canvas (tests/SSR) se omite
    // la imagen: los indicadores en celdas quedan igual.
    const b64 = pngTortaRecExtras(recTotal, extTotal)
    if (b64) {
      const imgId = wb.addImage({ base64: b64, extension: 'png' })
      ws.addImage(imgId, { tl: { col: 31, row: base - 1 }, br: { col: 38, row: base + 12 }, editAs: 'oneCell' } as any)
    }
  }

  const buf = await wb.xlsx.writeBuffer()
  return buf as ArrayBuffer
}

// Dibuja la torta REC vs Extras en un canvas y devuelve el PNG en base64 (sin
// prefijo data:). Sólo en navegador; en Node/SSR devuelve null (sin canvas) y el
// Excel sale con los indicadores en celdas pero sin la imagen. Colores = accent1
// (REC) y accent2 (Extras) del tema Office del archivo original.
function pngTortaRecExtras(rec: number, ext: number): string | null {
  if (typeof document === 'undefined') return null
  try {
    const W = 380, H = 240
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d'); if (!ctx) return null
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#1F3A5F'; ctx.font = 'bold 15px Calibri, Arial, sans-serif'
    ctx.fillText('Horas REC vs Extras', 12, 24)
    const total = rec + ext
    const cx = 110, cy = 140, rad = 82
    const colors = ['#4472C4', '#ED7D31']; const vals = [rec, ext]; const labels = ['REC', 'Extras']
    let ang = -Math.PI / 2
    if (total > 0) {
      for (let i = 0; i < 2; i++) {
        const frac = vals[i] / total; const a2 = ang + frac * 2 * Math.PI
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, rad, ang, a2); ctx.closePath()
        ctx.fillStyle = colors[i]; ctx.fill()
        const mid = (ang + a2) / 2; const lx = cx + Math.cos(mid) * rad * 0.6, ly = cy + Math.sin(mid) * rad * 0.6
        if (frac > 0.03) { ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 13px Calibri, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`${(frac * 100).toFixed(1)}%`, lx, ly) }
        ang = a2
      }
    } else {
      ctx.strokeStyle = '#9AAABF'; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 2 * Math.PI); ctx.stroke()
    }
    ctx.textAlign = 'left'; ctx.font = '12px Calibri, Arial, sans-serif'
    for (let i = 0; i < 2; i++) {
      const ly = 118 + i * 26
      ctx.fillStyle = colors[i]; ctx.fillRect(224, ly - 11, 14, 14)
      ctx.fillStyle = '#333333'; ctx.fillText(`${labels[i]}: ${Math.round(vals[i])} h`, 244, ly)
    }
    return canvas.toDataURL('image/png').split(',')[1] ?? null
  } catch { return null }
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
