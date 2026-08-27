import { describe, it, expect } from 'vitest'
import {
  alertaEstaIntervenida,
  estadoCicloVidaAlerta,
  intervencionesDeOcurrencia,
  compararIntervencionesMasReciente,
  claveOcurrenciaAlerta,
  type IntervencionOperativaBase,
  type TipoAlertaOperativa,
} from '../lib/revision-operativa'

function intervencion(
  overrides: Partial<IntervencionOperativaBase> & Pick<IntervencionOperativaBase, 'accion'>
): IntervencionOperativaBase {
  return {
    id: `int-${Math.random().toString(36).slice(2, 8)}`,
    turno_id: 'turno-1',
    tipo_alerta: 'sin_fichar',
    registro_asistencia_id: null,
    created_at: new Date().toISOString(),
    secuencia_evento: null,
    ...overrides,
  }
}

describe('alertaEstaIntervenida', () => {
  it('sin intervenciones → pendiente (false)', () => {
    expect(alertaEstaIntervenida([], 'turno-1', 'sin_fichar')).toBe(false)
  })

  it('confirmar_asistencia resuelve sin_fichar', () => {
    const intervenciones = [intervencion({ accion: 'confirmar_asistencia' })]
    expect(alertaEstaIntervenida(intervenciones, 'turno-1', 'sin_fichar')).toBe(true)
  })

  it('reasignacion NO resuelve sin_fichar', () => {
    const intervenciones = [intervencion({ accion: 'reasignacion' })]
    expect(alertaEstaIntervenida(intervenciones, 'turno-1', 'sin_fichar')).toBe(false)
  })

  it('reasignacion SÍ resuelve descubierto', () => {
    const intervenciones = [intervencion({ accion: 'reasignacion', tipo_alerta: 'descubierto' })]
    expect(alertaEstaIntervenida(intervenciones, 'turno-1', 'descubierto')).toBe(true)
  })

  it('reapertura después de resolución → pendiente', () => {
    const intervenciones = [
      intervencion({ accion: 'confirmar_asistencia', created_at: '2026-08-01T10:00:00Z', secuencia_evento: 1 }),
      intervencion({ accion: 'reapertura', created_at: '2026-08-01T11:00:00Z', secuencia_evento: 2 }),
    ]
    expect(alertaEstaIntervenida(intervenciones, 'turno-1', 'sin_fichar')).toBe(false)
  })

  it('comentario después de resolución no cambia estado', () => {
    const intervenciones = [
      intervencion({ accion: 'confirmar_asistencia', created_at: '2026-08-01T10:00:00Z', secuencia_evento: 1 }),
      intervencion({ accion: 'comentario', created_at: '2026-08-01T11:00:00Z', secuencia_evento: 2 }),
    ]
    expect(alertaEstaIntervenida(intervenciones, 'turno-1', 'sin_fichar')).toBe(true)
  })

  it('alerta_revisada resuelve tardanza', () => {
    const intervenciones = [intervencion({ accion: 'alerta_revisada', tipo_alerta: 'tardanza', registro_asistencia_id: 'reg-1' })]
    expect(alertaEstaIntervenida(intervenciones, 'turno-1', 'tardanza', 'reg-1')).toBe(true)
  })

  it('alerta_revisada resuelve fuera_radio', () => {
    const intervenciones = [intervencion({ accion: 'alerta_revisada', tipo_alerta: 'fuera_radio', registro_asistencia_id: 'reg-1' })]
    expect(alertaEstaIntervenida(intervenciones, 'turno-1', 'fuera_radio', 'reg-1')).toBe(true)
  })

  it('marcado_descubierto resuelve descubierto', () => {
    const intervenciones = [intervencion({ accion: 'marcado_descubierto', tipo_alerta: 'descubierto' })]
    expect(alertaEstaIntervenida(intervenciones, 'turno-1', 'descubierto')).toBe(true)
  })
})

describe('estadoCicloVidaAlerta', () => {
  it('sin intervenciones, condición vigente → pendiente', () => {
    expect(estadoCicloVidaAlerta({ intervenciones: [], turnoId: 'turno-1', tipo: 'sin_fichar', condicionVigente: true })).toBe('pendiente')
  })

  it('acción resolutiva con condición vigente → atendida_condicion_vigente', () => {
    const i = [intervencion({ accion: 'confirmar_asistencia' })]
    expect(estadoCicloVidaAlerta({ intervenciones: i, turnoId: 'turno-1', tipo: 'sin_fichar', condicionVigente: true })).toBe('atendida_condicion_vigente')
  })

  it('acción resolutiva sin condición vigente → resuelta_operativamente', () => {
    const i = [intervencion({ accion: 'confirmar_asistencia' })]
    expect(estadoCicloVidaAlerta({ intervenciones: i, turnoId: 'turno-1', tipo: 'sin_fichar', condicionVigente: false })).toBe('resuelta_operativamente')
  })

  it('reapertura → reabierta', () => {
    const i = [
      intervencion({ accion: 'confirmar_asistencia', created_at: '2026-08-01T10:00:00Z', secuencia_evento: 1 }),
      intervencion({ accion: 'reapertura', created_at: '2026-08-01T11:00:00Z', secuencia_evento: 2 }),
    ]
    expect(estadoCicloVidaAlerta({ intervenciones: i, turnoId: 'turno-1', tipo: 'sin_fichar', condicionVigente: true })).toBe('reabierta')
  })
})

describe('intervencionesDeOcurrencia — identidad por registro', () => {
  it('tardanza: filtra por registro_asistencia_id', () => {
    const intervenciones = [
      intervencion({ accion: 'alerta_revisada', tipo_alerta: 'tardanza', registro_asistencia_id: 'reg-1' }),
      intervencion({ accion: 'alerta_revisada', tipo_alerta: 'tardanza', registro_asistencia_id: 'reg-2' }),
    ]
    const resultado = intervencionesDeOcurrencia(intervenciones, 'turno-1', 'tardanza', 'reg-1')
    expect(resultado).toHaveLength(1)
    expect(resultado[0].registro_asistencia_id).toBe('reg-1')
  })

  it('sin_fichar: NO filtra por registro (no tiene identidad de registro)', () => {
    const intervenciones = [
      intervencion({ accion: 'confirmar_asistencia', registro_asistencia_id: 'reg-1' }),
      intervencion({ accion: 'comentario', registro_asistencia_id: null }),
    ]
    const resultado = intervencionesDeOcurrencia(intervenciones, 'turno-1', 'sin_fichar')
    expect(resultado).toHaveLength(2)
  })
})

describe('compararIntervencionesMasReciente', () => {
  it('secuencia_evento tiene prioridad sobre created_at', () => {
    const a = intervencion({ accion: 'comentario', created_at: '2026-08-01T12:00:00Z', secuencia_evento: 1 })
    const b = intervencion({ accion: 'comentario', created_at: '2026-08-01T10:00:00Z', secuencia_evento: 5 })
    expect(compararIntervencionesMasReciente(a, b)).toBeGreaterThan(0)
  })

  it('mismo timestamp: desempata por id', () => {
    const a = { id: 'aaa', turno_id: 't', tipo_alerta: 'sin_fichar', accion: 'comentario', created_at: '2026-08-01T10:00:00Z', secuencia_evento: null } as IntervencionOperativaBase
    const b = { id: 'zzz', turno_id: 't', tipo_alerta: 'sin_fichar', accion: 'comentario', created_at: '2026-08-01T10:00:00Z', secuencia_evento: null } as IntervencionOperativaBase
    const result = compararIntervencionesMasReciente(a, b)
    expect(result).not.toBe(0)
  })
})

describe('claveOcurrenciaAlerta', () => {
  it('genera clave con turno_id:tipo:identidad', () => {
    expect(claveOcurrenciaAlerta('turno-1', 'tardanza', 'reg-1')).toBe('turno-1:tardanza:reg-1')
  })

  it('tipos sin identidad de registro usan "turno" como identidad', () => {
    expect(claveOcurrenciaAlerta('turno-1', 'sin_fichar')).toBe('turno-1:sin_fichar:turno')
    expect(claveOcurrenciaAlerta('turno-1', 'descubierto')).toBe('turno-1:descubierto:turno')
  })
})
