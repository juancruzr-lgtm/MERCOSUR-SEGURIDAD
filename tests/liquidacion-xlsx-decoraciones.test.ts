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
  it('escribe conditional formatting en AM (colorScale) y AS (dataBar) con los colores/límites del original', async () => {
    const buf = await escribirPlantillaLiquidacionXLSX(plantillaReal())
    const { ws } = await leerGrid(buf)
    const cfs: any[] = (ws as any).conditionalFormattings ?? []
    const flat = cfs.flatMap((c: any) => (c.rules ?? []).map((r: any) => ({ ref: c.ref, ...r })))
    const cs = flat.find(r => r.type === 'colorScale')
    const db = flat.find(r => r.type === 'dataBar')
    expect(cs, 'colorScale presente').toBeTruthy()
    expect(String(cs.ref)).toContain('AM')
    // 3 colores rojo/amarillo/verde exactos
    const argbs = (cs.color ?? []).map((c: any) => c.argb)
    expect(argbs).toEqual(['FFFF0000', 'FFFFEB84', 'FFA9D18E'])
    // límites exactos
    expect(cs.cfvo.map((v: any) => `${v.type}:${v.value}`)).toEqual(['percent:10', 'percentile:30', 'percent:40'])
    expect(db, 'dataBar presente').toBeTruthy()
    expect(String(db.ref)).toContain('AS')
    expect(db.color.argb).toBe('FFD6007B')
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

  // ETAPA 3 — sin torta PNG: sólo celdas dinámicas.
  it('ETAPA 3: no queda PNG/imagen ni media/drawings huérfanos en el ZIP', async () => {
    const pl = plantillaReal()
    const buf = await escribirPlantillaLiquidacionXLSX(pl)
    // API exceljs: sin imágenes ni media
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf)
    const ws = wb.worksheets[0]
    expect((ws.getImages?.() ?? []).length).toBe(0)
    expect(((wb as any).model?.media ?? []).length).toBe(0)
    // ZIP crudo: sin xl/media, sin xl/drawings, sin binarios de imagen
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(buf)
    const paths = Object.keys(zip.files)
    expect(paths.some(p => p.startsWith('xl/media/'))).toBe(false)
    expect(paths.some(p => p.startsWith('xl/drawings/'))).toBe(false)
    expect(paths.some(p => /\.(png|jpe?g|gif|emf)$/i.test(p))).toBe(false)
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
