import { describe, it, expect } from 'vitest'
import {
  compararReimport, baselineDesdePlantilla, parseGridReimport, VARIABLES_REIMPORT,
  type CeldaVisual,
} from '@/lib/excel-trabajo-reimport'
import type { PlantillaLiquidacion } from '@/lib/resumen-guardia'

// Plantilla mínima (sólo importan las celdas para el baseline). Fila 7 = u1,
// fila 8 = u2. Identidad en BD, período en BE, CUIL en B, nombre en D.
function plantillaBase(): PlantillaLiquidacion {
  const celdas = [
    { ref: 'BD7', v: 'u1' }, { ref: 'BE7', v: '2026-08' }, { ref: 'B7', v: '20144945817' }, { ref: 'D7', v: 'ALMADA' },
    { ref: 'G7', v: 20 }, { ref: 'I7', v: 160 }, { ref: 'J7', v: 8 }, { ref: 'K7', v: 1 }, { ref: 'AR7', v: 0 },
    { ref: 'BD8', v: 'u2' }, { ref: 'BE8', v: '2026-08' }, { ref: 'B8', v: '20295393522' }, { ref: 'D8', v: 'ROSALES' },
    { ref: 'G8', v: 25 }, { ref: 'I8', v: 150 }, { ref: 'AH8', v: 50 },
  ]
  return { nombreHoja: 'Liquidación', ref: 'A1:BE8', celdas, columnas: [], secciones: [], estilos: { parametros: [], etiquetas: 5, encabezado: 6, titulos: [], subtotales: [], total: 8, filasDatos: [7, 8] } }
}

// Construye una grilla 0-based con una fila por empleado. Coloca cada variable
// en su índice y la identidad en BD (55) / BE (56).
function gridDe(filas: { usuarioId: string; periodo?: string; cuil?: string; nombre?: string; vals: Record<string, number> }[]): CeldaVisual[][] {
  const grid: CeldaVisual[][] = []
  // fila 0 y 1: título/encabezado ficticio (se ignoran: sin BD)
  grid.push(['VisualSueldos']); grid.push(['LEGAJO'])
  for (const f of filas) {
    const row: CeldaVisual[] = new Array(57).fill(null)
    row[1] = f.cuil ?? null; row[3] = f.nombre ?? null
    row[55] = f.usuarioId; row[56] = f.periodo ?? '2026-08'
    for (const v of VARIABLES_REIMPORT) if (f.vals[v.clave] !== undefined) row[v.idx] = f.vals[v.clave]
    grid.push(row)
  }
  return grid
}

describe('reimport del Excel de trabajo (LIQ2B)', () => {
  it('baseline y parse resuelven por usuario_id (BD), no por fila ni nombre', () => {
    const base = baselineDesdePlantilla(plantillaBase())
    expect(base.get('u1')?.valores.horas_liquidables).toBe(160)
    expect(base.get('u2')?.valores.jornadas).toBe(25)
    const grid = parseGridReimport(gridDe([{ usuarioId: 'u2', vals: { jornadas: 25 } }, { usuarioId: 'u1', vals: { horas_liquidables: 170 } }]))
    // aunque u2 vino primero en el archivo, se identifica por BD
    expect(grid.get('u1')?.valores.horas_liquidables).toBe(170)
  })

  it('marca sólo las variables que cambiaron, con MERCOSUR (operativo) vs Excel (liquidación)', () => {
    const grid = gridDe([
      { usuarioId: 'u1', cuil: '20144945817', vals: { jornadas: 20, horas_liquidables: 170, horas_nocturnas: 8, feriados: 1, adelantos: 0 } }, // sólo I cambia 160->170
      { usuarioId: 'u2', vals: { jornadas: 25, horas_liquidables: 150, adicional_hs: 50 } }, // sin cambios
    ])
    const r = compararReimport(plantillaBase(), grid)
    expect(r.diffs.length).toBe(1)
    const d = r.diffs[0]
    expect(d.usuarioId).toBe('u1')
    expect(d.clave).toBe('horas_liquidables')
    expect(d.mercosur).toBe(160)
    expect(d.excel).toBe(170)
    expect(d.diferencia).toBe(10)
    expect(d.estado).toBe('ajuste')
  })

  it('detecta un empleado del archivo que no está en el padrón', () => {
    const grid = gridDe([{ usuarioId: 'u9', vals: { jornadas: 22 } }])
    const r = compararReimport(plantillaBase(), grid)
    expect(r.fueraDePadron).toContain('u9')
    expect(r.diffs.length).toBe(0)
  })

  it('un null en el Excel donde MERCOSUR tenía número cuenta como diferencia', () => {
    const grid = gridDe([{ usuarioId: 'u1', vals: { jornadas: 20, horas_liquidables: 160, feriados: 1 } }]) // J (nocturnas) ausente => null vs 8
    const r = compararReimport(plantillaBase(), grid)
    const dn = r.diffs.find(d => d.clave === 'horas_nocturnas')
    expect(dn).toBeTruthy()
    expect(dn!.mercosur).toBe(8)
    expect(dn!.excel).toBeNull()
  })

  it('toma el período desde la columna oculta BE del archivo', () => {
    const grid = gridDe([{ usuarioId: 'u1', periodo: '2026-08', vals: { jornadas: 20 } }])
    const r = compararReimport(plantillaBase(), grid)
    expect(r.periodoDelArchivo).toBe('2026-08')
  })
})
