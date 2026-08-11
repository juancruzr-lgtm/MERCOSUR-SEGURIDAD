import { describe, expect, it } from 'vitest'
import { accionRecorrida } from '@/lib/rondas'

// Qué dice y qué hace el botón principal de la tarjeta del vigilador. La
// ventana viene calculada por rondas_ventanas_programadas en el servidor: acá
// no se deriva ninguna ventana, solo se elige el texto.

describe('accionRecorrida', () => {
  it('ventana abierta: la acción principal es arrancar', () => {
    expect(accionRecorrida({ cantidad_puntos: 5, habilitada_ahora: true, ventana_inicio_hhmm: '14:00' }))
      .toEqual({ etiqueta: 'Iniciar recorrida', habilitada: true, detalle: null })
  })

  it('ventana futura: avisa la hora y no habilita', () => {
    const a = accionRecorrida({ cantidad_puntos: 5, habilitada_ahora: false, ventana_inicio_hhmm: '14:00' })
    expect(a.etiqueta).toBe('Recorrida habilitada a las 14:00')
    expect(a.habilitada).toBe(false)
  })

  it('formato de 24 horas', () => {
    expect(accionRecorrida({ cantidad_puntos: 2, habilitada_ahora: false, ventana_inicio_hhmm: '23:30' }).etiqueta)
      .toBe('Recorrida habilitada a las 23:30')
  })

  it('sin puntos no se puede recorrer, aunque la ventana esté abierta', () => {
    const a = accionRecorrida({ cantidad_puntos: 0, habilitada_ahora: true, ventana_inicio_hhmm: '14:00' })
    expect(a.habilitada).toBe(false)
    expect(a.etiqueta).toBe('Sin puntos para recorrer')
    expect(a.detalle).toBeTruthy()
  })

  it('sin ventana por delante: no queda nada por recorrer en el turno', () => {
    const a = accionRecorrida({ cantidad_puntos: 5, habilitada_ahora: false, ventana_inicio_hhmm: null })
    expect(a.habilitada).toBe(false)
    expect(a.etiqueta).toBe('Sin recorridas pendientes')
  })

  it('campos ausentes (RPC vieja) no habilitan por accidente', () => {
    expect(accionRecorrida({ cantidad_puntos: 5 } as any).habilitada).toBe(false)
  })
})
