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
  const spec = escribirHojaDePlantilla(ws, plantilla)
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer
  return spec ? inyectarGraficosTorta(buf, [spec]) : buf
}

/**
 * Libro GENERAL con todos los meses: una SOLAPA por mes (mismo formato que el
 * Excel de trabajo de cada mes). El orden lo decide quien llama (JC: el último
 * adelante). Reutiliza `escribirHojaDePlantilla` para que cada solapa salga
 * idéntica al Excel de trabajo individual.
 */
export async function escribirLibroMultiMes(
  hojas: { nombre: string; plantilla: PlantillaLiquidacion }[],
): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.calcProperties.fullCalcOnLoad = true
  const usados = new Set<string>()
  // Una spec de gráfico por hoja, EN EL ORDEN en que se agregan (así el índice i
  // coincide con xl/worksheets/sheet{i+1}.xml que escribe exceljs). null = hoja
  // sin datos (sin gráfico).
  const specs: (OrigenGrafico | null)[] = []
  for (const h of hojas) {
    // Excel: nombre de hoja ≤ 31 chars, único, sin caracteres prohibidos.
    let nombre = (h.nombre || 'Mes').replace(/[\\/?*[\]:]/g, '-').slice(0, 31)
    let i = 2
    while (usados.has(nombre)) { nombre = `${nombre.slice(0, 28)}-${i++}` }
    usados.add(nombre)
    const ws = wb.addWorksheet(nombre)
    // El nombre de hoja real puede diferir del de la plantilla (dedupe/recorte):
    // la spec debe referenciar el nombre REAL para que el <c:f> del gráfico resuelva.
    const spec = escribirHojaDePlantilla(ws, { ...h.plantilla, nombreHoja: nombre })
    specs.push(spec)
  }
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer
  return inyectarGraficosTorta(buf, specs)
}

/**
 * Escribe una plantilla YA construida en un worksheet dado (formato completo).
 * Devuelve la especificación del gráfico de torta a inyectar (OrigenGrafico), o
 * null si la hoja no tiene filas de datos. La inyección del gráfico NATIVO se
 * hace después, sobre el .xlsx ya serializado (exceljs community no escribe
 * gráficos), en `inyectarGraficosTorta`.
 */
function escribirHojaDePlantilla(ws: any, plantilla: PlantillaLiquidacion): OrigenGrafico | null {
  const thin = { style: 'thin' as const, color: { argb: COLOR.linea } }
  const medium = { style: 'medium' as const, color: { argb: COLOR.lineaFuerte } }
  void thin

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

  // 3) Bloque de parámetros al INICIO de la hoja (JC 05/10): etiquetas en A1:A4 e
  // importes en B1:B4 (caja + moneda + negrita). El título se reubica a C1 y los
  // cálculos auxiliares (hora/día) a C2:D3, sin superponerse con la caja.
  for (const r of estilos.parametros) {
    const lab = ws.getCell(`A${r}`)
    lab.font = { bold: true }; lab.fill = fillOf(COLOR.paramBg)
    const val = ws.getCell(`B${r}`)
    if (val.value != null && val.value !== '') { val.numFmt = NUM_FMT.money; val.fill = fillOf(COLOR.paramBg) }
  }
  boxBorder(ws, 'A1', 'B4', medium)
  ws.getCell('C1').font = { bold: true, italic: true }          // título reubicado
  for (const r of [2, 3]) {                                      // auxiliares hora/día
    ws.getCell(`C${r}`).numFmt = NUM_FMT.hours
    ws.getCell(`C${r}`).font = { italic: true }
    ws.getCell(`D${r}`).font = { italic: true, color: { argb: COLOR.headerBg } }
  }

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

  // 7) Indicadores + semáforos (auditados del Excel original de Juan) y la FUENTE
  //    del gráfico de torta:
  //    - AM (% ex): semáforo de 5 tramos discretos, SÓLO vigiladores (Bloque 1).
  //    - AS (po hs = costo por hora): barra de datos magenta (todas las filas).
  //    - Bloque REC vs Extras (horas y %) + fuente del gráfico, debajo del total.
  //    Nada de esto toca valores/fórmulas ni la identidad oculta: el parser de
  //    reimportación lee por BD (usuario_id) e índices de columna, intactos.
  if (estilos.filasDatos.length === 0) return null

  const r0 = Math.min(...estilos.filasDatos)
  const r1 = Math.max(...estilos.filasDatos)

  // Semáforo del % de extras (AM) — SÓLO VIGILADORES (Bloque 1), 5 tramos
  // discretos (JC 05/10). AM está en escala 0-100 (la fórmula multiplica por 100)
  // con formato 0.0"%": los límites van en ESA escala (10/20/30/40), NO en 0-1.
  // Compuerta $I>0 (horas liquidables): las filas sin horas quedan SIN color.
  const vigRows = estilos.filasDatos.filter(r => r > (estilos.titulos[0] ?? 0) && r < (estilos.subtotalVigiladores || Infinity))
  if (vigRows.length > 0) {
    const v0 = Math.min(...vigRows), v1 = Math.max(...vigRows)
    const regla = (formula: string, argb: string, priority: number) => ({
      type: 'expression' as const, priority, formulae: [formula],
      style: { fill: { type: 'pattern' as const, pattern: 'solid' as const, bgColor: { argb } } },
    })
    ws.addConditionalFormatting({
      ref: `AM${v0}:AM${v1}`,
      rules: [
        regla(`AND($I${v0}>0,AM${v0}<10)`, 'FFFF0000', 11),              // < 10 %  → rojo
        regla(`AND($I${v0}>0,AM${v0}>=10,AM${v0}<20)`, 'FFFFC000', 12),  // 10–<20 %→ naranja
        regla(`AND($I${v0}>0,AM${v0}>=20,AM${v0}<30)`, 'FFFFFF00', 13),  // 20–<30 %→ amarillo
        regla(`AND($I${v0}>0,AM${v0}>=30,AM${v0}<=40)`, 'FFA9D18E', 14), // 30–40 % → verde claro
        regla(`AND($I${v0}>0,AM${v0}>40)`, 'FF00B050', 15),             // > 40 %  → verde intenso
      ],
    })
  }

  // Barra de datos del costo por hora (AS). Color magenta original.
  ws.addConditionalFormatting({
    ref: `AS${r0}:AS${r1}`,
    rules: [{
      type: 'dataBar', priority: 2,
      cfvo: [{ type: 'min' }, { type: 'max' }],
      color: { argb: 'FFD6007B' },
    } as any],
  })

  // Indicador REC vs Extras = SÓLO VIGILANCIA (BLOQUE 1). El total (AG=horas rec,
  // AL=hs extras) se toma del SUBTOTAL VIGILADORES, NO del total general (que
  // mezcla las horas artificiales de los mensualizados). Fórmulas en vivo.
  const t = estilos.subtotalVigiladores || estilos.total
  const base = estilos.total + 2
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
  put2(`AC${base}`, 'INDICADORES DEL MES (sólo vigilancia)', undefined, { bold: true })
  put2(`AC${base + 1}`, 'Horas REC Vigiladores'); put2(`AD${base + 1}`, recTotal, NUM_FMT.hours, { f: `AG${t}` })
  put2(`AC${base + 2}`, 'Horas Extras Vigiladores'); put2(`AD${base + 2}`, extTotal, NUM_FMT.hours, { f: `AL${t}` })
  put2(`AC${base + 3}`, '% REC'); put2(`AD${base + 3}`, den > 0 ? recTotal / den : 0, '0.0%', { f: `IF((AG${t}+AL${t})>0,AG${t}/(AG${t}+AL${t}),0)` })
  put2(`AC${base + 4}`, '% Extras'); put2(`AD${base + 4}`, den > 0 ? extTotal / den : 0, '0.0%', { f: `IF((AG${t}+AL${t})>0,AL${t}/(AG${t}+AL${t}),0)` })
  ws.getCell(`AC${base}`).fill = fillOf(COLOR.labelBg)

  // FUENTE del gráfico de torta (dos celdas con nombre + dos con fórmula viva,
  // vinculadas al subtotal vigiladores): al editar horas, AG/AL por fila → el
  // SUM del subtotal → estas celdas → el gráfico se actualiza. Nombres claros
  // (no "1"/"2"). El gráfico NATIVO se inyecta luego sobre el .xlsx serializado.
  const cs0 = base + 6, cs1 = base + 7
  put2(`AC${base + 5}`, 'Distribución de horas (vigiladores)', undefined, { bold: true })
  put2(`AC${cs0}`, 'Horas de recibo'); put2(`AD${cs0}`, recTotal, NUM_FMT.hours, { f: `AG${t}` })
  put2(`AC${cs1}`, 'Horas extras'); put2(`AD${cs1}`, extTotal, NUM_FMT.hours, { f: `AL${t}` })
  const q = plantilla.nombreHoja.replace(/'/g, "''")
  return {
    nombreHoja: plantilla.nombreHoja,
    catRef: `'${q}'!$AC$${cs0}:$AC$${cs1}`,
    valRef: `'${q}'!$AD$${cs0}:$AD$${cs1}`,
    catNames: ['Horas de recibo', 'Horas extras'],
    valNums: [recTotal, extTotal],
  }
}


// ── Gráfico de torta NATIVO (inyección OOXML) ──────────────────────────────
// exceljs community NO escribe gráficos. Pero un gráfico nativo de Excel es sólo
// un par de partes XML dentro del .xlsx (zip). Se inyectan acá, replicando la
// estructura EXACTA que produce Excel para un pie (auditada contra un archivo
// real guardado en Excel), para que abra SIN pedir reparación. El gráfico queda
// vinculado a celdas con fórmula (AD) → al editar horas, se actualiza solo.
export interface OrigenGrafico {
  nombreHoja: string
  /** Referencia de categorías (nombres de las porciones), p. ej. 'Hoja'!$AC$80:$AC$81 */
  catRef: string
  /** Referencia de valores (horas), p. ej. 'Hoja'!$AD$80:$AD$81 */
  valRef: string
  catNames: [string, string]
  valNums: [number, number]
}

const xmlEsc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** chartN.xml: pie de 2 porciones, azul (recibo) + rojo (extras), % y nombres. */
function chartXml(spec: OrigenGrafico): string {
  const n0 = xmlEsc(spec.catNames[0]); const n1 = xmlEsc(spec.catNames[1])
  const v0 = Number.isFinite(spec.valNums[0]) ? spec.valNums[0] : 0
  const v1 = Number.isFinite(spec.valNums[1]) ? spec.valNums[1] : 0
  const lbls = '<c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="1"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/>'
  const dPt = (idx: number, argb: string) =>
    `<c:dPt><c:idx val="${idx}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${argb}"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:lang val="es-AR"/><c:roundedCorners val="0"/><c:chart><c:title><c:tx><c:rich><a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" vert="horz" wrap="square" anchor="ctr" anchorCtr="1"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000" b="1"/></a:pPr><a:r><a:rPr lang="es-AR" sz="1000" b="1"/><a:t>Distribución de horas (vigiladores)</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:pieChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/>${dPt(0, '2E75B6')}${dPt(1, 'C00000')}<c:dLbls><c:numFmt formatCode="0.0%" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="1"/></a:pPr><a:endParaRPr lang="es-AR"/></a:p></c:txPr><c:dLblPos val="outEnd"/>${lbls}</c:dLbls><c:cat><c:strRef><c:f>${xmlEsc(spec.catRef)}</c:f><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>${n0}</c:v></c:pt><c:pt idx="1"><c:v>${n1}</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>${xmlEsc(spec.valRef)}</c:f><c:numCache><c:formatCode>#,##0.##</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>${v0}</c:v></c:pt><c:pt idx="1"><c:v>${v1}</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:dLbls>${lbls}<c:showLeaderLines val="1"/></c:dLbls><c:firstSliceAng val="0"/></c:pieChart><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea><c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`
}

/** drawingN.xml: ancla el gráfico en la parte superior (filas 1-4, cols F-L). */
function drawingXml(n: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>12</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>4</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${n + 1}" name="GraficoTorta${n}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`
}

const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const REL_DRAWING = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing'
const REL_CHART = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart'

/** Agrega (o crea) el rel de dibujo en el .rels de la hoja y devuelve su rId. */
async function agregarRelDibujo(zip: any, path: string, target: string): Promise<string> {
  const f = zip.file(path)
  if (!f) {
    zip.file(path, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${REL_DRAWING}" Target="${target}"/></Relationships>`)
    return 'rId1'
  }
  let xml = await f.async('string')
  const ids = Array.from(xml.matchAll(/Id="rId(\d+)"/g)).map(m => Number(m[1]))
  const next = 'rId' + ((ids.length ? Math.max(...ids) : 0) + 1)
  xml = xml.replace('</Relationships>', `<Relationship Id="${next}" Type="${REL_DRAWING}" Target="${target}"/></Relationships>`)
  zip.file(path, xml)
  return next
}

/**
 * Inserta <drawing r:id=".."/> en el XML de la hoja respetando el orden del
 * esquema (CT_Worksheet): el drawing va DESPUÉS de pageSetup/pageMargins y ANTES
 * del extLst final (donde Excel lo coloca). Garantiza el namespace r.
 */
function insertarDrawing(xml: string, rid: string): string {
  let out = xml
  if (!/\sxmlns:r=/.test(out.slice(0, 400))) {
    out = out.replace(/<worksheet(\s|>)/, `<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"$1`)
  }
  const tag = `<drawing r:id="${rid}"/>`
  const ps = out.match(/<pageSetup\b[^>]*\/>/)
  if (ps) { const i = out.indexOf(ps[0]) + ps[0].length; return out.slice(0, i) + tag + out.slice(i) }
  const pm = out.match(/<pageMargins\b[^>]*\/>/)
  if (pm) { const i = out.indexOf(pm[0]) + pm[0].length; return out.slice(0, i) + tag + out.slice(i) }
  if (/<\/extLst><\/worksheet>\s*$/.test(out)) {
    const i = out.lastIndexOf('<extLst>')
    if (i >= 0) return out.slice(0, i) + tag + out.slice(i)
  }
  return out.replace('</worksheet>', `${tag}</worksheet>`)
}

/**
 * Inyecta un gráfico de torta nativo por cada hoja con datos. `specs[i]`
 * corresponde a la hoja i (xl/worksheets/sheet{i+1}.xml, orden de alta en exceljs).
 */
export async function inyectarGraficosTorta(
  buf: ArrayBuffer,
  specs: (OrigenGrafico | null)[],
): Promise<ArrayBuffer> {
  if (!specs.some(Boolean)) return buf
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buf)
  let ct = await zip.file('[Content_Types].xml').async('string')
  const overrides: string[] = []
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]
    if (!spec) continue
    const n = i + 1
    const sheetFile = `xl/worksheets/sheet${n}.xml`
    const sf = zip.file(sheetFile)
    if (!sf) continue
    zip.file(`xl/charts/chart${n}.xml`, chartXml(spec))
    zip.file(`xl/drawings/drawing${n}.xml`, drawingXml(n))
    zip.file(`xl/drawings/_rels/drawing${n}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${REL_CHART}" Target="../charts/chart${n}.xml"/></Relationships>`)
    const rid = await agregarRelDibujo(zip, `xl/worksheets/_rels/sheet${n}.xml.rels`, `../drawings/drawing${n}.xml`)
    zip.file(sheetFile, insertarDrawing(await sf.async('string'), rid))
    overrides.push(`<Override PartName="/xl/drawings/drawing${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`)
    overrides.push(`<Override PartName="/xl/charts/chart${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`)
  }
  if (overrides.length) {
    ct = ct.replace('</Types>', `${overrides.join('')}</Types>`)
    zip.file('[Content_Types].xml', ct)
  }
  return (await zip.generateAsync({ type: 'arraybuffer' })) as ArrayBuffer
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
