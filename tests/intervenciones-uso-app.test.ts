import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({}) } }))

import { ESCALERA, evidenciaDe, motivoDe, proximoEscalon } from '@/lib/intervenciones-uso-app'

const caso = (over: any = {}) => ({
  empleadoId: 'e1', periodo: '2026-08',
  jornadas: 25, sinRegistroPropio: 5, proporcion: 20,
  severidad: 'patron', clase: 'uso_deficiente_reiterado',
  hechos: ['En 5 jornadas no quedó registro propio de tu fichaje.'],
  muestraChica: false, sinNota: false,
  ...over,
} as any)

describe('la escalera sube de a un escalon', () => {
  it('sin antecedentes se empieza por entrenar', () => {
    expect(proximoEscalon([])).toBe('entrenamiento')
  })

  it('despues de entrenar, avisar', () => {
    expect(proximoEscalon(['entrenamiento'])).toBe('aviso')
  })

  it('despues de avisar, advertir', () => {
    expect(proximoEscalon(['entrenamiento', 'aviso'])).toBe('advertencia')
  })

  it('nunca se salta de nada a advertencia', () => {
    // Por grave que sea el mes: primero hay que haber ensenado.
    expect(proximoEscalon([])).not.toBe('advertencia')
    expect(proximoEscalon(['entrenamiento'])).not.toBe('advertencia')
  })

  it('la advertencia es el ultimo escalon: no hay uno automatico mas arriba', () => {
    expect(proximoEscalon(['entrenamiento', 'aviso', 'advertencia'])).toBe('advertencia')
    expect(ESCALERA[ESCALERA.length - 1]).toBe('advertencia')
  })

  it('el antecedente de otro periodo cuenta: si no, no escalaria nunca', () => {
    expect(proximoEscalon(['aviso'])).toBe('advertencia')
  })
})

describe('el motivo lleva los numeros', () => {
  it('dice cuantas jornadas y sobre cuantas', () => {
    const m = motivoDe(caso())
    expect(m).toContain('5 de 25 jornadas')
    expect(m).toContain('2026-08')
    expect(m).toContain('20 %')
  })

  it('avisa cuando la muestra es chica', () => {
    expect(motivoDe(caso({ muestraChica: true }))).toContain('Muestra chica')
  })

  it('avisa cuando no hubo calificacion mensual', () => {
    expect(motivoDe(caso({ sinNota: true }))).toContain('Sin calificación mensual')
  })
})

describe('la evidencia se congela con la intervencion', () => {
  it('guarda los hechos del momento, no una referencia para recalcular', () => {
    const e = evidenciaDe(caso())
    expect(e.jornadas).toBe(25)
    expect(e.sinRegistroPropio).toBe(5)
    expect(e.clase).toBe('uso_deficiente_reiterado')
    expect(e.hechos).toHaveLength(1)
  })
})
