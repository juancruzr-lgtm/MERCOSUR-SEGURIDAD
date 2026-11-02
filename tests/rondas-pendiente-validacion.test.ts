import { describe, expect, it } from 'vitest'
import {
  COLOR_ESTADO_TECNICO, ETIQUETA_ESTADO_TECNICO, estadoTecnicoDetalleEjecucion, estadoTecnicoRonda,
  observacionesDetalleEjecucion, observacionesRonda, ordenOperativoRonda, rondaProgramadaEsIncumplida,
  type RondaProgramada,
} from '@/lib/rondas'

// Regla aprobada (nov. 2026): una foto que espera la IA no es falta. La ronda
// recorrida entera con algún punto así se muestra «Pendiente de validación»,
// distinta de cumplida y de incompleta, y no cuenta como incumplida.

const AHORA = Date.parse('2026-11-02T18:00:00.000Z')

const ronda = (over: Partial<RondaProgramada> = {}): RondaProgramada => ({
  ronda_base_id: 'rb1', ronda_nombre: 'Ronda', puesto_id: 'p1', puesto_nombre: 'Principal',
  turno_id: 't1', guardia_id: 'g1', guardia_nombre: 'PEREZ, ANA',
  ventana_inicio: '2026-11-02T09:00:00.000Z', ventana_fin: '2026-11-02T11:00:00.000Z',
  vencimiento_at: '2026-11-02T11:00:00.000Z',
  estado: 'completada', inicio_tardio: false,
  ejecucion_id: 'e1', iniciada_at: '2026-11-02T09:05:00.000Z', finalizada_at: '2026-11-02T09:30:00.000Z',
  resultado: 'completa', puntos_total: 4, puntos_cumplidos: 4, puntos_incumplidos: 0, puntos_omitidos: 0,
  cerrada_por: null, cerrada_at: null, cerrada_motivo: null, es_cierre_administrativo: false,
  alerta_id: null, alerta_tipo: null, alerta_estado: null, alerta_suspendida: false,
  alerta_motivo_vigilador: null, alerta_accion: null, alerta_comentario: null,
  alerta_resuelta_por_nombre: null, alerta_resuelta_at: null, alerta_intervenciones: 0,
  pausada: false, pausa_vigente: false, pausa_id: null, pausa_motivo: null,
  pausa_desde: null, pausa_hasta: null, pausada_por_nombre: null,
  ...over,
} as RondaProgramada)

describe('estado técnico con puntos pendientes de validación', () => {
  it('resultado pendiente_validacion del motor', () => {
    const r = ronda({ estado: 'pendiente_validacion', resultado: 'pendiente_validacion', puntos_cumplidos: 3, puntos_pendientes_validacion: 1 })
    expect(estadoTecnicoRonda(r, AHORA)).toBe('pendiente_validacion')
    expect(rondaProgramadaEsIncumplida(r)).toBe(false)
    expect(ETIQUETA_ESTADO_TECNICO.pendiente_validacion).toBe('Pendiente de validación')
    expect(COLOR_ESTADO_TECNICO.pendiente_validacion).not.toBe(COLOR_ESTADO_TECNICO.incompleta)
    expect(ordenOperativoRonda(r)).toBeGreaterThan(0)
    expect(observacionesRonda(r)).toContain('1 punto(s) pendientes de validación')
  })

  it('un punto sin evidencia válida pesa más que uno por validar', () => {
    const r = ronda({ estado: 'incompleta', resultado: 'incompleta', puntos_incumplidos: 1, puntos_pendientes_validacion: 1 })
    expect(estadoTecnicoRonda(r, AHORA)).toBe('cumplida_observada')
    expect(observacionesRonda(r)[0]).toBe('1 punto(s) sin evidencia válida')
  })

  it('abandono sigue siendo incompleta', () => {
    const r = ronda({ estado: 'incompleta', resultado: 'incompleta', puntos_omitidos: 2, puntos_pendientes_validacion: 1 })
    expect(estadoTecnicoRonda(r, AHORA)).toBe('incompleta')
  })

  it('sin el contador nuevo (migración sin aplicar) nada cambia', () => {
    expect(estadoTecnicoRonda(ronda(), AHORA)).toBe('cumplida')
  })
})

describe('detalle de ejecución', () => {
  it('pendiente de validación en el detalle', () => {
    const puntos = [{ estado: 'cumplido' as const }, { estado: 'pendiente_validacion' as const }]
    expect(estadoTecnicoDetalleEjecucion('finalizada', false, puntos)).toBe('pendiente_validacion')
    expect(observacionesDetalleEjecucion(false, puntos)).toEqual(['1 punto(s) pendientes de validación'])
  })
})
