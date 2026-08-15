import { describe, expect, it } from 'vitest'
import {
  alertaEstaIntervenida,
  efectoIntervencionOperativa,
  estadoCicloVidaAlerta,
  evaluarSinFichar,
  type IntervencionOperativaBase,
} from '@/lib/revision-operativa'

// confirmar_asistencia pasó de ser un sello a materializar la asistencia
// (migración 20260818100000: llama a registrar_cobertura con origen
// 'confirmacion_supervisor'). Estos tests fijan lo que la app afirma sobre esa
// acción, que es la parte del contrato que vive en TypeScript.
//
// La aritmética de horas NO se testea acá a propósito: la hace
// registrar_cobertura en Postgres y no hay una segunda implementación que
// pueda desincronizarse. Un test que la replicara en TS sería justamente la
// segunda fuente que este trabajo evita.

const intervencion = (over: Partial<IntervencionOperativaBase> = {}): IntervencionOperativaBase => ({
  id: 'i1',
  turno_id: 't1',
  tipo_alerta: 'sin_fichar',
  accion: 'confirmar_asistencia',
  registro_asistencia_id: null,
  created_at: '2026-08-06T23:34:00Z',
  secuencia_evento: 1,
  ...over,
})

describe('efectoIntervencionOperativa — lo que la app le promete al supervisor', () => {
  it('confirmar_asistencia dice que acredita liquidación', () => {
    const texto = efectoIntervencionOperativa('confirmar_asistencia')
    expect(texto).toMatch(/liquidaci/i)
    // El texto viejo afirmaba lo contrario y quedó desmentido por el fix.
    expect(texto).not.toMatch(/no afecta liquidaci/i)
  })

  it('y deja claro que no inventa fichaje ni GPS', () => {
    expect(efectoIntervencionOperativa('confirmar_asistencia')).toMatch(/no registra fichaje ni gps/i)
  })

  it('las acciones de seguimiento siguen sin crear asistencia', () => {
    expect(efectoIntervencionOperativa('comentario')).toMatch(/sin cambio operativo/i)
    expect(efectoIntervencionOperativa('alerta_revisada')).not.toMatch(/liquidaci/i)
    expect(efectoIntervencionOperativa('marcado_descubierto')).toMatch(/descubierto/i)
  })

  it('reasignar sigue sin acreditar fichaje', () => {
    expect(efectoIntervencionOperativa('reasignacion')).toMatch(/no acredita fichaje/i)
  })
})

describe('ciclo de vida de la alerta sin_fichar', () => {
  it('confirmar_asistencia resuelve la alerta', () => {
    expect(alertaEstaIntervenida([intervencion()], 't1', 'sin_fichar')).toBe(true)
  })

  it('un comentario sobre el mismo turno no la resuelve', () => {
    expect(alertaEstaIntervenida([intervencion({ accion: 'comentario' })], 't1', 'sin_fichar')).toBe(false)
  })

  it('reasignar tampoco: cambia al esperado, no acredita que haya entrado', () => {
    expect(alertaEstaIntervenida([intervencion({ accion: 'reasignacion' })], 't1', 'sin_fichar')).toBe(false)
  })

  it('con la asistencia ya creada, la condición deja de estar vigente', () => {
    expect(estadoCicloVidaAlerta({
      intervenciones: [intervencion()],
      turnoId: 't1',
      tipo: 'sin_fichar',
      condicionVigente: false,
    })).toBe('resuelta_operativamente')
  })
})

// La asistencia creada por el supervisor apaga la alerta por sí sola, sin
// depender de que exista una intervención registrada: evaluarSinFichar mira si
// hay entrada reconocida. Es la coherencia entre las dos mitades del arreglo.
describe('evaluarSinFichar después de confirmar asistencia', () => {
  const turno = {
    guardia_id: 'g1',
    fecha: '2026-08-06',
    hora_inicio: '23:00:00',
    hora_fin: '07:00:00',
    estado: 'cubierto',
  } as any

  it('turno nocturno en curso sin nada: alerta vigente', () => {
    expect(evaluarSinFichar(turno, {
      tieneEntrada: false,
      ahora: new Date(Date.parse('2026-08-07T02:00:00-03:00')),
    })).toBe('vigente')
  })

  it('el mismo turno una vez confirmado: ya no corresponde', () => {
    expect(evaluarSinFichar(turno, {
      tieneEntrada: true,
      ahora: new Date(Date.parse('2026-08-07T02:00:00-03:00')),
    })).toBe('no_corresponde')
  })
})
