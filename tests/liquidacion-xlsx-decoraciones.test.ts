import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import {
  construirResumenGuardia, plantillaLiquidacionResumenGuardia,
  type ParamsResumenGuardia, type TurnoResumen,
} from '@/lib/resumen-guardia'
import { escribirPlantillaLiquidacionXLSX } from '@/lib/liquidacion-xlsx'
import { compararReimport, baselineDesdePlantilla, parseGridReimport, type CeldaVisual } from '@/lib/excel-trabajo-reimport'
import type { RegistroUniverso } from '@/lib/liquidacion'

// Decoraciones recuperadas del Excel original (auditado): escala de color en AM
// (% extras), barra de datos en AS (costo/hora), bloque REC vs Extras. Lo CRÍTICO:
// no pueden romper el parser de reimportación ni la identidad de los empleados.

const OBJ = 'obj-real'
const turno = (o: Partial<TurnoResumen> & { id: string }): TurnoResumen => ({
  fecha: '2026-08-10', hora_inicio: '07:00', hora_fin: '19:00', objetivo_id: OBJ,
  estado: 'cubierto', guardia_id: 'g1', ...o,
})
const registro = (o: Partial<RegistroUniverso> & { turno_id: string }): RegistroUniverso => ({ id: `r-${o.turno_id}`, guardia_id: 'g1', ...o })
const params = (o: Partial<ParamsResumenGuardia> = {}): ParamsResumenGuardia => ({
  mes: '2026-08',
  empleados: [
    { id: 'g1', nombre: 'ESTANISLAO', apellido: 'ALMADA', cuil: '20144945817', legajoVisual: '001', rol: 'guardia' },
    { id: 'g2', nombre: 'JUAN', apellido: 'ROSALES', cuil: '20295393522', legajoVisual: '002', rol: 'guardia' },
  ],
  turnos: [], registros: [], novedades: [],
  esObjetivoPrueba: () => false, nombreObjetivo: (id) => (id === OBJ ? 'CLUB' : id ?? ''),
  ...o,
})

// dos empleados con jornadas distintas -> hay horas rec y extras
function plantillaReal() {
  const turnos: TurnoResumen[] = []
  const registros: RegistroUniverso[] = []
  for (let d = 1; d <= 22; d++) { const id = `a${d}`; turnos.push(turno({ id, fecha: `2026-08-${String(d).padStart(2, '0')}`, guardia_id: 'g1' })); registros.push(registro({ turno_id: id, guardia_id: 'g1', horas_liquidables: 12 })) }
  for (let d = 1; d <= 10; d++) { const id = `b${d}`; turnos.push(turno({ id, fecha: `2026-08-${String(d).padStart(2, '0')}`, guardia_id: 'g2' })); registros.push(registro({ turno_id: id, guardia_id: 'g2', horas_liquidables: 12 })) }
  const resumen = construirResumenGuardia(params({ turnos, registros }))
  return plantillaLiquidacionResumenGuardia(resumen)
}

async function leerGrid(buf: ArrayBuffer): Promise<{ ws: ExcelJS.Worksheet; grid: CeldaVisual[][] }> {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf)
  const ws = wb.worksheets[0]
  const grid: CeldaVisual[][] = []
  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: CeldaVisual[] = []
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      let v: any = cell.value
      if (v && typeof v === 'object' && 'result' in v) v = v.result
      if (v && typeof v === 'object' && 'richText' in v) v = v.richText.map((t: any) => t.text).join('')
      cells[col - 1] = v ?? null
    })
    grid.push(cells)
  })
  return { ws, grid }
}

describe('decoraciones del Excel de trabajo (gráfico REC/Extras + semáforos)', () => {
  it('AM (% extras): 5 tramos de color SÓLO en vigiladores, con compuerta sin-horas; AS mantiene dataBar', async () => {
    const pl = plantillaReal()
    const buf = await escribirPlantillaLiquidacionXLSX(pl)
    const { ws } = await leerGrid(buf)
    const cfs: any[] = (ws as any).conditionalFormattings ?? []
    const flat = cfs.flatMap((c: any) => (c.rules ?? []).map((r: any) => ({ ref: c.ref, ...r })))
    // Semáforo de 5 tramos discretos (JC 05/10), por 'expression', en AM.
    const expr = flat.filter(r => r.type === 'expression' && String(r.ref).includes('AM'))
    expect(expr.length, '5 reglas discretas').toBe(5)
    // Rango = SÓLO filas de vigiladores (Bloque 1): no incluye supervisores/admin.
    const vig = pl.estilos.filasDatos.filter(r => r < (pl.estilos.subtotalVigiladores || Infinity))
    const v0 = Math.min(...vig), v1 = Math.max(...vig)
    for (const r of expr) expect(String(r.ref)).toBe(`AM${v0}:AM${v1}`)
    // Colores exactos de los 5 límites: rojo/naranja/amarillo/verde claro/verde intenso.
    expect(expr.map(r => r.style?.fill?.bgColor?.argb))
      .toEqual(['FFFF0000', 'FFFFC000', 'FFFFFF00', 'FFA9D18E', 'FF00B050'])
    // Compuerta "sin horas → sin color": todas las reglas condicionan a $I (horas liq.) > 0.
    for (const r of expr) expect(String(r.formulae?.[0])).toContain(`$I${v0}>0`)
    // Los límites 10/20/30/40 están en escala 0-100 (coherente con AM = *100), no en 0-1.
    expect(expr.some(r => /AM\d+<10/.test(String(r.formulae?.[0])))).toBe(true)
    expect(expr.some(r => /AM\d+>40/.test(String(r.formulae?.[0])))).toBe(true)
    // AS: barra de datos magenta intacta.
    const db = flat.find(r => r.type === 'dataBar')
    expect(db, 'dataBar presente').toBeTruthy()
    expect(String(db.ref)).toContain('AS')
    expect(db.color.argb).toBe('FFD6007B')
  })

  it('supervisores/administrativos NO llevan % extras (AM en blanco) ni color', async () => {
    // Un vigilador (g1, con horas) + un administrativo (sin AM). El rango de color
    // se limita al vigilador; la fila administrativa deja AM vacío.
    const empleados = [
      { id: 'g1', nombre: 'ESTANISLAO', apellido: 'ALMADA', cuil: '20144945817', legajoVisual: '001', rol: 'guardia' as const },
      { id: 'a1', nombre: 'ANA', apellido: 'ADMIN', cuil: '20295393522', legajoVisual: 'ADM', rol: 'admin' as const, puesto_organizacional: 'administracion' as const },
    ]
    const turnos: TurnoResumen[] = []; const registros: RegistroUniverso[] = []
    for (let d = 1; d <= 22; d++) { const id = `a${d}`; turnos.push(turno({ id, fecha: `2026-08-${String(d).padStart(2, '0')}`, guardia_id: 'g1' })); registros.push(registro({ turno_id: id, guardia_id: 'g1', horas_liquidables: 12 })) }
    const resumen = construirResumenGuardia(params({ empleados, turnos, registros }))
    const pl = plantillaLiquidacionResumenGuardia(resumen)
    const m = new Map(pl.celdas.map(c => [c.ref, c]))
    // fila del vigilador: AM con fórmula; fila del administrativo: SIN celda AM.
    const filaVig = Math.min(...pl.estilos.filasDatos.filter(r => r < pl.estilos.subtotalVigiladores))
    expect(m.get(`AM${filaVig}`)?.f, 'vigilador con % extras').toBeTruthy()
    const filaAdmin = pl.estilos.filasDatos.find(r => r > pl.estilos.subtotalVigiladores)
    if (filaAdmin) expect(m.get(`AM${filaAdmin}`), 'administrativo sin AM (en blanco)').toBeUndefined()
  })

  it('agrega el bloque REC vs Extras con horas y porcentajes reales', async () => {
    const pl = plantillaReal()
    const buf = await escribirPlantillaLiquidacionXLSX(pl)
    const { grid } = await leerGrid(buf)
    const texto = grid.flat().map(c => String(c ?? ''))
    expect(texto).toContain('INDICADORES DEL MES (sólo vigilancia)')
    expect(texto).toContain('Horas REC Vigiladores')
    expect(texto).toContain('Horas Extras Vigiladores')
    expect(texto).toContain('% REC')
    expect(texto).toContain('% Extras')
  })

  it('NO rompe la reimportación: releer el archivo escrito da 0 diferencias contra su baseline', async () => {
    const pl = plantillaReal()
    const buf = await escribirPlantillaLiquidacionXLSX(pl)
    const { grid } = await leerGrid(buf)
    const r = compararReimport(pl, grid)
    expect(r.diffs.length, 'sin diffs espurios (baseline vs sí mismo)').toBe(0)
    expect(r.fueraDePadron.length, 'ningún empleado fuera de padrón').toBe(0)
    // identidad oculta intacta tras las decoraciones: BD (usuario_id, col 55) y
    // BE (periodo, col 56) siguen en las filas de empleado.
    const filaG1 = grid.find(row => row[55] === 'g1')
    const filaG2 = grid.find(row => row[55] === 'g2')
    expect(filaG1, 'fila de g1 con identidad').toBeTruthy()
    expect(filaG2, 'fila de g2 con identidad').toBeTruthy()
    expect(filaG1![56]).toBe('2026-08')
  })

  // Bug E (causa): la fila de encabezado (BD6='usuario_id', BE6='periodo') se
  // interpretaba como empleado y periodoDelArchivo quedaba en el literal 'periodo'.
  it('END-TO-END: generar 2026-08 → releer → período 2026-08, 0 diffs, 0 fuera de padrón, sin usuario_id fantasma', async () => {
    const pl = plantillaReal() // mes '2026-08'
    const buf = await escribirPlantillaLiquidacionXLSX(pl)
    const { grid } = await leerGrid(buf)
    const r = compararReimport(pl, grid)
    expect(r.periodoDelArchivo, 'período real, no el rótulo "periodo"').toBe('2026-08')
    expect(r.diffs.length).toBe(0)
    expect(r.fueraDePadron.length).toBe(0)
    expect(r.personasEnArchivo, 'reconoce sólo empleados reales (g1, g2)').toBe(2)
    // El registro fantasma 'usuario_id' NO debe existir ni en baseline ni en subido.
    expect(baselineDesdePlantilla(pl).has('usuario_id')).toBe(false)
    expect(parseGridReimport(grid).has('usuario_id')).toBe(false)
  })

  // Gráfico de torta NATIVO (no imagen): se inyecta como partes OOXML válidas.
  it('inyecta un pie NATIVO azul/rojo, con % y nombres, vinculado a celdas (sin imágenes)', async () => {
    const pl = plantillaReal()
    const buf = await escribirPlantillaLiquidacionXLSX(pl)
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(buf)
    const paths = Object.keys(zip.files)
    // Partes del gráfico/dibujo presentes; NINGÚN binario de imagen (es nativo).
    expect(paths).toContain('xl/charts/chart1.xml')
    expect(paths).toContain('xl/drawings/drawing1.xml')
    expect(paths).toContain('xl/drawings/_rels/drawing1.xml.rels')
    expect(paths).toContain('xl/worksheets/_rels/sheet1.xml.rels')
    expect(paths.some(p => p.startsWith('xl/media/'))).toBe(false)
    expect(paths.some(p => /\.(png|jpe?g|gif|emf)$/i.test(p))).toBe(false)

    const chart = await zip.file('xl/charts/chart1.xml')!.async('string')
    expect(chart).toContain('<c:pieChart>')
    expect(chart).toContain('2E75B6')                  // porción recibo = azul
    expect(chart).toContain('C00000')                  // porción extras = rojo
    expect(chart).toContain('<c:showPercent val="1"/>') // porcentajes visibles
    expect(chart).toContain('Horas de recibo')          // nombres identificables (no "1"/"2")
    expect(chart).toContain('Horas extras')
    // Valores vinculados a las celdas AD (fórmula =AG/AL del subtotal vigiladores):
    // al editar horas se recalcula y el gráfico se actualiza.
    const base = pl.estilos.total + 2
    expect(chart).toContain(`$AD$${base + 6}:$AD$${base + 7}`)

    // El <drawing> quedó referenciado en la hoja y resuelto por rels + content-types.
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
    expect(sheet).toMatch(/<drawing r:id="rId\d+"\/>/)
    const ct = await zip.file('[Content_Types].xml')!.async('string')
    expect(ct).toContain('/xl/charts/chart1.xml')
    expect(ct).toContain('/xl/drawings/drawing1.xml')

    // Todas las partes XML nuevas deben estar BIEN FORMADAS (si no, Excel pide reparar).
    const { SaxesParser } = await import('saxes')
    for (const p of ['xl/charts/chart1.xml', 'xl/drawings/drawing1.xml', 'xl/drawings/_rels/drawing1.xml.rels', 'xl/worksheets/_rels/sheet1.xml.rels', 'xl/worksheets/sheet1.xml', '[Content_Types].xml']) {
      const xml = await zip.file(p)!.async('string')
      let err: any = null
      const parser = new SaxesParser()
      parser.on('error', (e: any) => { err = e })
      parser.write(xml).close()
      expect(err, `${p} bien formado`).toBeNull()
    }
  })

  it('el gráfico está arriba (filas 1-4) y NO tapa el encabezado (fila 6) ni los datos', async () => {
    const pl = plantillaReal()
    const buf = await escribirPlantillaLiquidacionXLSX(pl)
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(buf)
    const drawing = await zip.file('xl/drawings/drawing1.xml')!.async('string')
    // ancla desde fila 0 (1) hasta fila 4 → no alcanza la fila 6 (encabezado).
    expect(drawing).toContain('<xdr:row>0</xdr:row>')
    expect(drawing).toMatch(/<xdr:to>[\s\S]*<xdr:row>4<\/xdr:row>/)
  })

  it('ETAPA 3: quedan las 4 celdas dinámicas y %REC + %Extras = 100% (con horas)', async () => {
    const pl = plantillaReal()
    const buf = await escribirPlantillaLiquidacionXLSX(pl)
    const { grid } = await leerGrid(buf)
    const texto = grid.flat().map(c => String(c ?? ''))
    for (const et of ['Horas REC Vigiladores', 'Horas Extras Vigiladores', '% REC', '% Extras']) expect(texto).toContain(et)
    // %REC / %Extras (resultados cacheados) suman 100% (plantillaReal tiene vigiladores con horas)
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf)
    const ws = wb.worksheets[0]
    const base = pl.estilos.total + 2
    const num = (ref: string) => { const v: any = ws.getCell(ref).value; return Number((v && typeof v === 'object' && 'result' in v) ? v.result : v) }
    const pctRec = num(`AD${base + 3}`), pctExt = num(`AD${base + 4}`)
    expect(pctRec + pctExt).toBeCloseTo(1, 6)
    // y las fórmulas siguen apuntando al SUBTOTAL VIGILADORES, no al total general
    const f: any = ws.getCell(`AD${base + 1}`).value
    expect(String(f?.formula)).toBe(`AG${pl.estilos.subtotalVigiladores}`)
  })
})
