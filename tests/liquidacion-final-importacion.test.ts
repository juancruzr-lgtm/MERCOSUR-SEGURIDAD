import { describe, expect, it } from 'vitest'
import { conceptosDePersona } from '@/lib/liquidacion-final-datos'

// Lectura de la Planilla de Sueldos de Visual para la liquidación final
// (lo que después recibe liquidacion_final_importar_resultado). La base
// rechaza un código repetido (supabase/pruebas/liquidacion-final/
// importacion-resultado.mjs); acá se prueba qué le llega.

const ENC = ['LEGAJO', 'NOMBRE', 'CUIL', 'FEC.INGRESO', 'CTRO.CTO.', 'O.SOCIAL', 'FECHA NAC.', 'CATEGORIA']
const planilla = (conceptos: string[], filas: (string | number | null)[][]) => [
  ['MERCOSUR SEGURIDAD'], [], [],
  [...ENC, ...conceptos, 'Neto'],
  ...filas,
  ['Totales Liquidación'],
]
const persona = (legajo: string, nombre: string, cuil: string, valores: (number | null)[]) =>
  [legajo, nombre, cuil, null, null, null, null, null, ...valores, 1]

const CUIL_A = '20301112223'

describe('conceptosDePersona (resultado de Visual de una final)', () => {
  it('toma sólo los conceptos de esa persona, no los de otra fila del archivo', () => {
    const g = planilla(['120003 sac proporcional', '208  vac no goz', '101 jubilacion'], [
      persona('L1 Visual', 'UNO', CUIL_A, [150000.55, 367308, 65881.7]),
      persona('L9 Visual', 'OTRO', '27999888777', [99999, 571368, 1]),
    ])
    const r = conceptosDePersona(g as any, CUIL_A)
    expect(r.error).toBeNull()
    expect(r.conceptos.map(c => [c.codigo, c.importe])).toEqual([['120003', 150000.55], ['208', 367308], ['101', 65881.7]])
  })

  it('reconoce el CUIL con guiones o espacios', () => {
    const g = planilla(['208  vac no goz'], [persona('L1', 'UNO', '20-30111222-3', [367308])])
    expect(conceptosDePersona(g as any, CUIL_A).conceptos).toEqual([{ codigo: '208', nombre: 'vac no goz', cantidad: null, importe: 367308 }])
  })

  it('persona que no figura → error claro, sin conceptos', () => {
    const g = planilla(['208  vac no goz'], [persona('L9', 'OTRO', '27999888777', [1])])
    const r = conceptosDePersona(g as any, CUIL_A)
    expect(r.conceptos).toEqual([])
    expect(r.error).toMatch(/no trae al CUIL/)
  })

  it('el mismo código dos veces con importe (p. ej. el mensual y la final en el mismo archivo) NO se suma: pasan los dos y la base rechaza', () => {
    const g = planilla(['208  vac no goz', '120003 sac'], [
      persona('L1', 'UNO (mensual)', CUIL_A, [571368, null]),
      persona('L1', 'UNO (final)', CUIL_A, [367308, 150000.55]),
    ])
    const r = conceptosDePersona(g as any, CUIL_A)
    const de208 = r.conceptos.filter(c => c.codigo === '208')
    expect(de208.map(c => c.importe).sort()).toEqual([367308, 571368])
    // Ninguna fila trae la suma: nada se acumula en silencio.
    expect(r.conceptos.some(c => c.importe === 571368 + 367308)).toBe(false)
  })

  it('Visual repite una columna en cero junto a la que tiene importe: queda una sola línea, la que tiene importe', () => {
    const g = planilla(['212 gratif extraord', '212 gratificacion'], [persona('L1', 'UNO', CUIL_A, [52000, 0])])
    const r = conceptosDePersona(g as any, CUIL_A)
    expect(r.conceptos.filter(c => c.codigo === '212')).toEqual([expect.objectContaining({ importe: 52000 })])
  })

  it('no reconoce la planilla → error', () => {
    const r = conceptosDePersona([['cualquier cosa'], ['sin encabezado']] as any, CUIL_A)
    expect(r.error).toMatch(/No se reconoció/)
  })
})
