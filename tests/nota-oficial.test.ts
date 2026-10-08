import { describe, expect, it } from 'vitest'
import { esOficial, relacionConCalculo } from '@/lib/nota-oficial'

// MENA, septiembre 2026, después de la corrección de Gerencia.
const menaCorregida = {
  estado: 'publicada', nota_final: 4, indice: 10, corregida_at: '2026-10-09T12:00:00Z',
  faltas: [{ clave: 'salida_anticipada_injustificada', hecho: '19 salidas…', tope: 4 }],
}

describe('la nota oficial es la publicada', () => {
  it('sólo es oficial si está publicada y tiene nota', () => {
    expect(esOficial(menaCorregida)).toBe(true)
    expect(esOficial({ ...menaCorregida, estado: 'revisada' })).toBe(false)
    expect(esOficial({ ...menaCorregida, nota_final: null })).toBe(false)
    expect(esOficial(null)).toBe(false)
  })

  it('MENA: el 10 del motor se nombra como resultado anterior al tope, no como nota', () => {
    const r = relacionConCalculo(menaCorregida, 10)
    expect(r.relacion).toBe('antes_del_tope')
    expect(r.texto).toBe('Resultado anterior al tope crítico: 10,00. No es la nota oficial: la falta crítica la limita a 4,00.')
  })

  it('si coinciden no hay segundo número', () => {
    expect(relacionConCalculo(menaCorregida, 4)).toEqual({ relacion: 'igual', texto: null })
  })

  it('si los datos cambiaron después de publicar, se dice que no es la oficial', () => {
    const r = relacionConCalculo({ estado: 'publicada', nota_final: 8, indice: 8, faltas: [] }, 7.2)
    expect(r.relacion).toBe('distinto')
    expect(r.texto).toMatch(/^Cálculo con los datos actuales: 7,20\. No es la nota oficial/)
    expect(r.texto).toMatch(/volver a congelar y publicar/)
  })

  it('una evaluación actualizada por una falta confirmada se nombra como tal', () => {
    const r = relacionConCalculo(menaCorregida, 9.5)
    expect(r.relacion).toBe('distinto')
    expect(r.texto).toMatch(/actualizada por una falta confirmada/)
  })

  it('sin cálculo no se inventa nada', () => {
    expect(relacionConCalculo(menaCorregida, null)).toEqual({ relacion: 'sin_calculo', texto: null })
  })
})
