import { describe, expect, it } from 'vitest'
import { franjasDescubiertas, textoFranjas } from '@/lib/agenda-supervisores'

const FECHA = '2026-10-06'
const AYER = '2026-10-05'

describe('franjasDescubiertas', () => {
  it('día completo cubierto (diurna + nocturna propia + cola de la nocturna de ayer) → sin huecos', () => {
    const franjas = franjasDescubiertas([
      { fecha: AYER, hora_inicio: '19:00:00', hora_fin: '07:00:00' },  // cubre 00:00–07:00 de FECHA
      { fecha: FECHA, hora_inicio: '07:00:00', hora_fin: '19:00:00' },
      { fecha: FECHA, hora_inicio: '19:00:00', hora_fin: '07:00:00' }, // cubre 19:00–24:00 de FECHA
    ], FECHA, AYER)
    expect(franjas).toEqual([])
  })

  it('sólo guardias nocturnas (el caso real del 03/10) → el día queda descubierto', () => {
    const franjas = franjasDescubiertas([
      { fecha: AYER, hora_inicio: '19:00:00', hora_fin: '07:00:00' },
      { fecha: FECHA, hora_inicio: '19:00:00', hora_fin: '07:00:00' },
    ], FECHA, AYER)
    expect(franjas).toEqual([{ desde: 7 * 60, hasta: 19 * 60 }])
    expect(textoFranjas(franjas)).toBe('07:00–19:00')
  })

  it('sin ninguna guardia → un solo hueco de 00:00 a 24:00', () => {
    expect(franjasDescubiertas([], FECHA, AYER)).toEqual([{ desde: 0, hasta: 1440 }])
    expect(textoFranjas([{ desde: 0, hasta: 1440 }])).toBe('00:00–24:00')
  })

  it('una guardia no activa no cubre', () => {
    const franjas = franjasDescubiertas([
      { fecha: FECHA, hora_inicio: '07:00:00', hora_fin: '19:00:00', estado: 'cancelado' },
    ], FECHA, AYER)
    expect(franjas).toEqual([{ desde: 0, hasta: 1440 }])
  })

  it('la nocturna de ayer NO cubre la noche de hoy, sólo la madrugada', () => {
    const franjas = franjasDescubiertas([
      { fecha: AYER, hora_inicio: '19:00:00', hora_fin: '07:00:00' },
      { fecha: FECHA, hora_inicio: '07:00:00', hora_fin: '19:00:00' },
    ], FECHA, AYER)
    expect(franjas).toEqual([{ desde: 19 * 60, hasta: 1440 }])
  })

  it('bordes chicos (menos de 15 min) no cuentan como hueco', () => {
    const franjas = franjasDescubiertas([
      { fecha: AYER, hora_inicio: '19:00:00', hora_fin: '07:00:00' },
      { fecha: FECHA, hora_inicio: '07:10:00', hora_fin: '19:00:00' },
      { fecha: FECHA, hora_inicio: '19:00:00', hora_fin: '07:00:00' },
    ], FECHA, AYER)
    expect(franjas).toEqual([])
  })

  it('guardias solapadas no generan huecos fantasma', () => {
    const franjas = franjasDescubiertas([
      { fecha: AYER, hora_inicio: '19:00:00', hora_fin: '07:00:00' },
      { fecha: FECHA, hora_inicio: '06:00:00', hora_fin: '14:00:00' },
      { fecha: FECHA, hora_inicio: '12:00:00', hora_fin: '19:00:00' },
      { fecha: FECHA, hora_inicio: '19:00:00', hora_fin: '07:00:00' },
    ], FECHA, AYER)
    expect(franjas).toEqual([])
  })
})

import { franjasDescubiertasPorZona, textoPorZona } from '@/lib/agenda-supervisores'

describe('cobertura por zona y francos (orden JC 08/10)', () => {
  it('un franco activo NO cuenta como cobertura', () => {
    const franjas = franjasDescubiertas([
      { fecha: FECHA, hora_inicio: '07:00:00', hora_fin: '19:00:00', tipo_evento: 'franco' },
    ], FECHA, AYER)
    expect(franjas).toEqual([{ desde: 0, hasta: 1440 }])
  })

  it('una guardia de OTRA zona no cubre la zona requerida', () => {
    const huecos = franjasDescubiertasPorZona([
      { fecha: AYER, hora_inicio: '19:00:00', hora_fin: '07:00:00', zona: 'Rosario' },
      { fecha: FECHA, hora_inicio: '07:00:00', hora_fin: '19:00:00', zona: 'Rosario' },
      { fecha: FECHA, hora_inicio: '19:00:00', hora_fin: '07:00:00', zona: 'Rosario' },
    ], ['Rosario', 'Reconquista'], FECHA, AYER)
    expect(huecos).toHaveLength(1)
    expect(huecos[0].zona).toBe('Reconquista')
    expect(huecos[0].franjas).toEqual([{ desde: 0, hasta: 1440 }])
    expect(textoPorZona(huecos)).toBe('Reconquista: 00:00–24:00')
  })

  it('zona cubierta no aparece; comparación de zona insensible a mayúsculas y espacios', () => {
    const huecos = franjasDescubiertasPorZona([
      { fecha: AYER, hora_inicio: '19:00:00', hora_fin: '07:00:00', zona: ' rosario ' },
      { fecha: FECHA, hora_inicio: '07:00:00', hora_fin: '19:00:00', zona: 'ROSARIO' },
      { fecha: FECHA, hora_inicio: '19:00:00', hora_fin: '07:00:00', zona: 'Rosario' },
    ], ['Rosario'], FECHA, AYER)
    expect(huecos).toEqual([])
  })
})
