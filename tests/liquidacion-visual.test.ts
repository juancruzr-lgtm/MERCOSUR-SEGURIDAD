import { describe, it, expect } from 'vitest'
import { parsearPlanillaVisual, categoriaSugerida, type CeldaVisual } from '@/lib/liquidacion-visual'

// Grilla que refleja la estructura REAL de "Planilla de Sueldos" de Visual
// (validada contra planilla agosto/jjjjj): filas de título, encabezado en fila 4
// con fijas + pares [concepto | Cant.] + totales al final.
function grillaBase(): CeldaVisual[][] {
  return [
    ['MERCOSUR SEGURIDAD SRL', ' - Planilla de Sueldos'],
    ['Fecha de Emisión: 08/09/2026'],
    [],
    ['LEGAJO', 'NOMBRE', 'CUIL', 'FEC.INGRESO', 'CTRO.CTO.', 'O.SOCIAL', 'FECHA NAC.', 'CATEGORIA',
      '000 DIAS TRABAJADAS', 'Cant.', '050 dif', 'Cant.', '977 EXPEDIENTE ALIMENTOS', 'Cant.',
      'Imponible', 'No Imponible', 'Descuentos', 'Asignaciones', 'Neto'],
    // ALMADA con valores (días=20, 050 dif=100, 977 embargo=5000)
    ['ALMADA', 'ALMADA  ESTANISLAO', '20144945817', '01/02/2023', '', 'OS', '', 'CAT',
      20, 20, 100, 0, 5000, 1, 900000, 0, 5000, 0, 895000],
    // Empleado TODO en cero → no debe generar líneas
    ['CERO', 'CERO  PERSONA', '20999999999', '', '', '', '', '',
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    // Fila de pie sin CUIL ni legajo → se ignora
    [null, 'TOTALES', null],
  ]
}

describe('parsearPlanillaVisual', () => {
  it('detecta encabezado, conceptos por código y excluye columnas de totales', () => {
    const p = parsearPlanillaVisual(grillaBase())
    expect(p.filaEncabezado).toBe(3)
    expect(p.conceptos.map(c => c.codigo)).toEqual(['000', '050', '977'])
    // los totales (Imponible..Neto) NO son conceptos
    expect(p.conceptos.some(c => /imponible|neto|descuentos|asignaciones/i.test(c.nombre))).toBe(false)
  })

  it('sólo importa conceptos con importe o cantidad != 0 (ALMADA sí, CERO no)', () => {
    const p = parsearPlanillaVisual(grillaBase())
    const cuils = new Set(p.lineas.map(l => l.cuil))
    expect(cuils.has('20144945817')).toBe(true)
    expect(cuils.has('20999999999')).toBe(false) // todo en cero => sin líneas
    const alm = p.lineas.filter(l => l.cuil === '20144945817')
    expect(alm.map(l => l.codigo).sort()).toEqual(['000', '050', '977'])
    const dif = alm.find(l => l.codigo === '050')
    expect(dif?.importe).toBe(100)
  })

  it('CUIL se normaliza a 11 dígitos; captura totales por empleado', () => {
    const p = parsearPlanillaVisual(grillaBase())
    expect(p.lineas.every(l => /^\d{11}$/.test(l.cuil!))).toBe(true)
    const t = p.totales.find(x => x.cuil === '20144945817')
    expect(t?.neto).toBe(895000)
    expect(t?.imponible).toBe(900000)
  })

  it('ignora la fila de pie sin CUIL ni legajo', () => {
    const p = parsearPlanillaVisual(grillaBase())
    expect(p.totales.some(t => t.cuil === null)).toBe(false)
    expect(p.totales.length).toBe(2) // ALMADA + CERO (la de pie no)
  })

  it('categoriaSugerida: 050 dif = base_auxiliar; embargo/aliment = descuento; presentismo = asignacion', () => {
    expect(categoriaSugerida('050', 'dif')).toBe('base_auxiliar')
    expect(categoriaSugerida('000', 'DIAS TRABAJADAS')).toBe('base_auxiliar')
    expect(categoriaSugerida('977', 'EXPEDIENTE ALIMENTOS')).toBe('descuento')
    expect(categoriaSugerida('993', 'embargo')).toBe('descuento')
    expect(categoriaSugerida('204', 'presentismo')).toBe('asignacion')
  })

  it('grilla sin encabezado válido → advertencia, sin líneas', () => {
    const p = parsearPlanillaVisual([['algo'], ['otra cosa']])
    expect(p.filaEncabezado).toBe(-1)
    expect(p.lineas).toEqual([])
    expect(p.advertencias.length).toBeGreaterThan(0)
  })
})
