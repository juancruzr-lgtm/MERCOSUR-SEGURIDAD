import { describe, expect, it } from 'vitest'
import { demoraAlertaMinutos, etiquetaDemora } from '@/lib/rondas'

// Demora de una alerta de ronda no iniciada. Se mide contra vencimiento_at
// —el deadline con la tolerancia ya aplicada, que calcula el servidor— y no
// contra ventana_inicio: la alerta nace recién al pasar la tolerancia, así que
// contar desde el inicio previsto sumaría esos minutos de más.

const AHORA = Date.parse('2026-08-07T15:00:00Z')
const haceMinutos = (m: number) => new Date(AHORA - m * 60000).toISOString()

describe('demoraAlertaMinutos', () => {
  it('vencida hace 45 minutos', () => {
    expect(demoraAlertaMinutos(haceMinutos(45), AHORA)).toBe(45)
  })

  it('vencida hace 3 horas', () => {
    expect(demoraAlertaMinutos(haceMinutos(180), AHORA)).toBe(180)
  })

  it('recién vencida', () => {
    expect(demoraAlertaMinutos(new Date(AHORA).toISOString(), AHORA)).toBe(0)
  })

  it('todavía no venció: nunca devuelve negativo', () => {
    const enElFuturo = new Date(AHORA + 30 * 60000).toISOString()
    expect(demoraAlertaMinutos(enElFuturo, AHORA)).toBe(0)
  })

  it('fecha inválida no rompe', () => {
    expect(demoraAlertaMinutos('no-es-una-fecha', AHORA)).toBe(0)
  })

  it('no depende del huso del navegador: mismo instante, otra notación', () => {
    // 14:00Z y 11:00-03:00 son el mismo momento.
    expect(demoraAlertaMinutos('2026-08-07T14:00:00Z', AHORA))
      .toBe(demoraAlertaMinutos('2026-08-07T11:00:00-03:00', AHORA))
  })
})

describe('etiquetaDemora', () => {
  it('solo minutos', () => expect(etiquetaDemora(45)).toBe('45 min'))
  it('horas exactas', () => expect(etiquetaDemora(120)).toBe('2 h'))
  it('horas y minutos', () => expect(etiquetaDemora(80)).toBe('1 h 20 min'))
  it('recién vencida', () => expect(etiquetaDemora(0)).toBe('recién vencida'))
  it('nunca muestra negativos', () => expect(etiquetaDemora(-5)).toBe('recién vencida'))
})
