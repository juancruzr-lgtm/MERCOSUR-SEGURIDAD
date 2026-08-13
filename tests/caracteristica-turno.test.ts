import { describe, expect, it } from 'vitest'
import {
  MOTIVO_CAPACITACION,
  caracteristicaTurno,
  esCapacitacion,
  etiquetaCaracteristica,
  notaCapacitacionExcluida,
  notaCapacitacionIncluida,
} from '@/lib/caracteristica-turno'

// La característica del turno decide qué se paga y qué se cobra: un turno de
// capacitación se le paga al vigilador pero no se le factura al objetivo. Por
// eso la planilla del vigilador y la del objetivo dan distinto sobre los mismos
// turnos, y por eso las notas de abajo tienen que aparecer donde se muestra un
// total. Sin ellas, la diferencia se lee como un error de cálculo.

describe('caracteristicaTurno', () => {
  it('normaliza NULL, vacío y valores desconocidos a normal', () => {
    expect(caracteristicaTurno(null)).toBe('normal')
    expect(caracteristicaTurno(undefined)).toBe('normal')
    expect(caracteristicaTurno('')).toBe('normal')
    // 'cobertura_urgente' era el valor legacy: ya no es válido.
    expect(caracteristicaTurno('cobertura_urgente')).toBe('normal')
  })

  it('respeta las tres características aprobadas', () => {
    expect(caracteristicaTurno('normal')).toBe('normal')
    expect(caracteristicaTurno('cobertura')).toBe('cobertura')
    expect(caracteristicaTurno('capacitacion')).toBe('capacitacion')
  })

  it('esCapacitacion solo es verdadero para capacitación', () => {
    expect(esCapacitacion('capacitacion')).toBe(true)
    expect(esCapacitacion('cobertura')).toBe(false)
    expect(esCapacitacion(null)).toBe(false)
  })

  it('etiquetaCaracteristica nunca devuelve el valor crudo', () => {
    expect(etiquetaCaracteristica('capacitacion')).toBe('Capacitación')
    expect(etiquetaCaracteristica(null)).toBe('Normal')
  })
})

describe('notas de capacitación en los totales', () => {
  it('sin horas de capacitación no hay nada que aclarar', () => {
    expect(notaCapacitacionExcluida(0, 0)).toBeNull()
    expect(notaCapacitacionIncluida(0, 0)).toBeNull()
    // Una capacitación descubierta suma 0 horas: no genera diferencia.
    expect(notaCapacitacionExcluida(0, 1)).toBeNull()
  })

  it('el total del objetivo dice qué descontó', () => {
    const nota = notaCapacitacionExcluida(12, 3)
    expect(nota).toContain('No incluye')
    expect(nota).toContain('12.00 hs')
    expect(nota).toContain('3 turnos')
    expect(nota).toContain(MOTIVO_CAPACITACION)
  })

  it('el total del vigilador dice qué sumó', () => {
    const nota = notaCapacitacionIncluida(8, 2)
    expect(nota).toContain('Incluye')
    expect(nota).not.toContain('No incluye')
    expect(nota).toContain('8.00 hs')
    expect(nota).toContain(MOTIVO_CAPACITACION)
  })

  it('singular y plural de turnos', () => {
    expect(notaCapacitacionIncluida(4, 1)).toContain('1 turno)')
    expect(notaCapacitacionIncluida(8, 2)).toContain('2 turnos)')
  })

  it('las horas se muestran con dos decimales, como el resto de los totales', () => {
    expect(notaCapacitacionExcluida(7.5, 1)).toContain('7.50 hs')
  })
})
