import { describe, it, expect } from 'vitest'
import {
  compararReimport, baselineDesdePlantilla, parseGridReimport, VARIABLES_REIMPORT,
  CLAVE_EXTRA_MENSUAL, CLAVE_SUELDO_MENSUAL,
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
function gridDe(filas: { usuarioId: string; periodo?: string; cuil?: string; nombre?: string; legajo?: string; cuenta?: string; vals: Record<string, number> }[]): CeldaVisual[][] {
  const grid: CeldaVisual[][] = []
  // fila 0 y 1: título/encabezado ficticio (se ignoran: sin BD)
  grid.push(['VisualSueldos']); grid.push(['LEGAJO'])
  for (const f of filas) {
    const row: CeldaVisual[] = new Array(59).fill(null)
    if (f.legajo !== undefined) row[0] = f.legajo
    row[1] = f.cuil ?? null
    if (f.cuenta !== undefined) row[2] = f.cuenta
    row[3] = f.nombre ?? null
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

// ── EXTRA fija (BG) + SUELDO MENSUAL (BF): variables con vigencia ────────────
// Se detectan como cualquier variable (para el preview de diffs); el ruteo a
// set_extra_mensual / set_sueldo_mensual (en vez de liquidacion_ajuste) lo hace
// el componente por la CLAVE. Acá se prueba que la diferencia se detecta bien.
describe('EXTRA fija y SUELDO MENSUAL como variables (BG/BF)', () => {
  it('un importe de EXTRA en el Excel (baseline sin BG) se marca como diff clave=extra_mensual', () => {
    const grid = gridDe([{ usuarioId: 'u1', cuil: '20144945817', vals: { jornadas: 20, horas_liquidables: 160, extra_mensual: 30000 } }])
    const r = compararReimport(plantillaBase(), grid)
    const ex = r.diffs.find(d => d.clave === CLAVE_EXTRA_MENSUAL)
    expect(ex).toBeTruthy()
    expect(ex!.mercosur).toBeNull()   // el baseline no tenía BG
    expect(ex!.excel).toBe(30000)
  })

  it('EXTRA sin cambios (ausente en ambos) no genera diff', () => {
    const grid = gridDe([{ usuarioId: 'u1', cuil: '20144945817', vals: { jornadas: 20, horas_liquidables: 160 } }])
    const r = compararReimport(plantillaBase(), grid)
    expect(r.diffs.find(d => d.clave === CLAVE_EXTRA_MENSUAL)).toBeUndefined()
    expect(r.diffs.find(d => d.clave === CLAVE_SUELDO_MENSUAL)).toBeUndefined()
  })
})

// ── IDENTIDAD (texto): legajo / CUIL / cuenta editables en el Excel ──────────
// Se guardan en `usuarios` al reimportar. Nunca se borra lo existente con vacío.
describe('identidad editable (legajo/CUIL/cuenta) → usuarios', () => {
  it('CUIL nuevo, legajo y cuenta cargados en el Excel se listan como cambios de identidad', () => {
    const grid = gridDe([{ usuarioId: 'u1', cuil: '20999999993', legajo: '1234', cuenta: '00011122233', vals: { jornadas: 20, horas_liquidables: 160 } }])
    const r = compararReimport(plantillaBase(), grid)
    const campos = r.identidad.map(i => i.campo).sort()
    expect(campos).toEqual(['cuenta', 'cuil', 'legajo_visual'])
    const cuil = r.identidad.find(i => i.campo === 'cuil')!
    expect(cuil.mercosur).toBe('20144945817')
    expect(cuil.excel).toBe('20999999993')
    expect(r.identidad.find(i => i.campo === 'legajo_visual')!.excel).toBe('1234')
  })

  it('un campo de identidad VACÍO en el Excel no se registra (no pisa lo existente)', () => {
    // u1 mantiene su CUIL; no trae legajo ni cuenta → sin cambios de identidad.
    const grid = gridDe([{ usuarioId: 'u1', cuil: '20144945817', vals: { jornadas: 20, horas_liquidables: 160 } }])
    const r = compararReimport(plantillaBase(), grid)
    expect(r.identidad.length).toBe(0)
  })

  it('CUIL sin cambios no genera diff de identidad', () => {
    const grid = gridDe([{ usuarioId: 'u1', cuil: '20144945817', legajo: 'ALMADA', vals: { jornadas: 20, horas_liquidables: 160 } }])
    const r = compararReimport(plantillaBase(), grid)
    // legajo 'ALMADA' es nuevo (baseline no tenía A) → 1 cambio; el CUIL igual, 0.
    expect(r.identidad.find(i => i.campo === 'cuil')).toBeUndefined()
    expect(r.identidad.find(i => i.campo === 'legajo_visual')?.excel).toBe('ALMADA')
  })
})

// ── Bug E: la fila de ENCABEZADO no es un empleado ───────────────────────────
// La fila 6 lleva rótulos: BD6='usuario_id', BE6='periodo'. Antes se colaba como
// empleado y periodoDelArchivo quedaba en el literal 'periodo'. Se excluye por
// centinela en ambos parsers, sin registro fantasma, y el período sale sólo de
// filas de persona con 'YYYY-MM' válido.
describe('bug E — encabezado excluido, sin registro fantasma', () => {
  const filaVacia = () => new Array(57).fill(null) as CeldaVisual[]
  const filaEncabezado = () => { const r = filaVacia(); r[55] = 'usuario_id'; r[56] = 'periodo'; r[6] = 'JORNADAS'; return r }
  const filaPersona = (uid: string, periodo: string, jornadas: number) => { const r = filaVacia(); r[55] = uid; r[56] = periodo; r[1] = '20144945817'; r[3] = 'ALMADA'; r[6] = jornadas; return r }

  it('parseGridReimport ignora la fila de encabezado (no crea usuario_id fantasma)', () => {
    const grid = [filaVacia(), filaEncabezado(), filaPersona('u1', '2026-08', 20)]
    const m = parseGridReimport(grid)
    expect(m.has('usuario_id')).toBe(false)
    expect(m.has('u1')).toBe(true)
    expect(m.size).toBe(1)
  })

  it('baselineDesdePlantilla ignora la celda de encabezado BD6=usuario_id', () => {
    const pl: PlantillaLiquidacion = {
      nombreHoja: 'L', ref: 'A1:BE8',
      celdas: [
        { ref: 'BD6', v: 'usuario_id' }, { ref: 'BE6', v: 'periodo' },
        { ref: 'BD7', v: 'u1' }, { ref: 'BE7', v: '2026-08' }, { ref: 'B7', v: '20144945817' }, { ref: 'G7', v: 20 },
      ],
      columnas: [], secciones: [], estilos: { parametros: [], etiquetas: 5, encabezado: 6, titulos: [], subtotales: [], total: 8, filasDatos: [7] },
    }
    const base = baselineDesdePlantilla(pl)
    expect(base.has('usuario_id')).toBe(false)
    expect(base.has('u1')).toBe(true)
  })

  it('periodoDelArchivo sale de la persona (2026-08), nunca del rótulo "periodo"', () => {
    const pl: PlantillaLiquidacion = {
      nombreHoja: 'L', ref: 'A1:BE8',
      celdas: [{ ref: 'BD6', v: 'usuario_id' }, { ref: 'BE6', v: 'periodo' }, { ref: 'BD7', v: 'u1' }, { ref: 'BE7', v: '2026-08' }, { ref: 'G7', v: 20 }],
      columnas: [], secciones: [], estilos: { parametros: [], etiquetas: 5, encabezado: 6, titulos: [], subtotales: [], total: 8, filasDatos: [7] },
    }
    const grid = [filaVacia(), filaEncabezado(), filaPersona('u1', '2026-08', 20)]
    const r = compararReimport(pl, grid)
    expect(r.periodoDelArchivo).toBe('2026-08')
    expect(r.fueraDePadron).not.toContain('usuario_id')
    expect(r.personasEnArchivo).toBe(1)
  })

  it('falla seguro: archivo sólo con encabezado → 0 personas y período null (no se asume nada)', () => {
    const pl: PlantillaLiquidacion = {
      nombreHoja: 'L', ref: 'A1:BE8', celdas: [{ ref: 'BD6', v: 'usuario_id' }, { ref: 'BE6', v: 'periodo' }],
      columnas: [], secciones: [], estilos: { parametros: [], etiquetas: 5, encabezado: 6, titulos: [], subtotales: [], total: 8, filasDatos: [] },
    }
    const r = compararReimport(pl, [filaVacia(), filaEncabezado()])
    expect(r.personasEnArchivo).toBe(0)
    expect(r.periodoDelArchivo).toBeNull()
  })
})
