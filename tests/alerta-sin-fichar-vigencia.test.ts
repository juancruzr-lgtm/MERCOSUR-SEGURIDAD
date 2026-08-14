import { describe, expect, it } from 'vitest'
import {
  alertaSinFicharVigente,
  detectarAlertasOperativas,
  evaluarSinFichar,
} from '@/lib/revision-operativa'

// Una alerta operativa está pendiente sólo mientras la condición que la originó
// sigue vigente y todavía se puede intervenir. "Sin fichar" no tenía tope
// superior: un turno de ayer alertaba para siempre y el contador de demora
// crecía solo. La Vista Supervisor además no excluía turnos anulados ni
// objetivos pausados, y coincidía con Administración sólo porque el Panel
// Principal carga los turnos de hoy.
//
// Terminado el turno, el supervisor ya no puede hacer que alguien entre ayer:
// deja de ser alerta operativa y queda para Revisión de planillas.

const T = (over: any = {}) => ({
  id: 't1',
  objetivo_id: 'o1',
  guardia_id: 'g1',
  fecha: '2026-08-14',
  hora_inicio: '08:00:00',
  hora_fin: '16:00:00',
  estado: 'programado',
  ...over,
}) as any

const en = (iso: string) => new Date(Date.parse(iso))
const sinEntrada = { tieneEntrada: false }

describe('evaluarSinFichar', () => {
  it('turno en curso, más de 15 minutos sin entrada → alerta vigente', () => {
    expect(evaluarSinFichar(T(), { ...sinEntrada, ahora: en('2026-08-14T08:16:00-03:00') })).toBe('vigente')
    expect(evaluarSinFichar(T(), { ...sinEntrada, ahora: en('2026-08-14T13:00:00-03:00') })).toBe('vigente')
  })

  it('todavía dentro de los 15 minutos de tolerancia → no corresponde', () => {
    expect(evaluarSinFichar(T(), { ...sinEntrada, ahora: en('2026-08-14T08:14:00-03:00') })).toBe('no_corresponde')
  })

  it('antes de empezar → no corresponde', () => {
    expect(evaluarSinFichar(T(), { ...sinEntrada, ahora: en('2026-08-14T07:00:00-03:00') })).toBe('no_corresponde')
  })

  it('turno terminado sin entrada → vencida, ya no es alerta operativa', () => {
    expect(evaluarSinFichar(T(), { ...sinEntrada, ahora: en('2026-08-14T16:01:00-03:00') })).toBe('vencida')
    expect(alertaSinFicharVigente(T(), { ...sinEntrada, ahora: en('2026-08-14T16:01:00-03:00') })).toBe(false)
  })

  it('justo en el instante del fin ya no está vigente', () => {
    expect(evaluarSinFichar(T(), { ...sinEntrada, ahora: en('2026-08-14T16:00:00-03:00') })).toBe('vencida')
  })

  it('con entrada registrada → no corresponde, en curso o terminado', () => {
    const opts = { tieneEntrada: true }
    expect(evaluarSinFichar(T(), { ...opts, ahora: en('2026-08-14T13:00:00-03:00') })).toBe('no_corresponde')
    expect(evaluarSinFichar(T(), { ...opts, ahora: en('2026-08-14T20:00:00-03:00') })).toBe('no_corresponde')
  })

  it.each(['anulado', 'cancelado', 'reemplazado'])('turno %s → no corresponde aunque esté en curso', (estado) => {
    const t = T({ estado })
    expect(evaluarSinFichar(t, { ...sinEntrada, ahora: en('2026-08-14T13:00:00-03:00') })).toBe('no_corresponde')
    expect(alertaSinFicharVigente(t, { ...sinEntrada, ahora: en('2026-08-14T13:00:00-03:00') })).toBe(false)
  })

  it('objetivo inactivo o pausado → no corresponde', () => {
    expect(evaluarSinFichar(T(), {
      ...sinEntrada, objetivoOperativo: false, ahora: en('2026-08-14T13:00:00-03:00'),
    })).toBe('no_corresponde')
  })

  it('sin guardia asignado el problema es descubierto, no sin fichar', () => {
    expect(evaluarSinFichar(T({ guardia_id: null }), {
      ...sinEntrada, ahora: en('2026-08-14T13:00:00-03:00'),
    })).toBe('no_corresponde')
  })

  it('sin dato de objetivo se asume operativo: no silencia por las dudas', () => {
    expect(evaluarSinFichar(T(), { ...sinEntrada, ahora: en('2026-08-14T13:00:00-03:00') })).toBe('vigente')
  })
})

// Los nocturnos son el motivo por el que la Vista Supervisor carga ayer además
// de hoy. Eso tiene que seguir funcionando: la ventana de carga no cambia, lo
// que cambia es hasta cuándo la alerta está vigente.
describe('evaluarSinFichar — turnos nocturnos', () => {
  const nocturno = T({ fecha: '2026-08-13', hora_inicio: '18:00:00', hora_fin: '07:00:00' })

  it('nocturno de ayer todavía en curso hoy → sigue vigente', () => {
    expect(evaluarSinFichar(nocturno, { ...sinEntrada, ahora: en('2026-08-14T03:00:00-03:00') })).toBe('vigente')
    expect(evaluarSinFichar(nocturno, { ...sinEntrada, ahora: en('2026-08-14T06:59:00-03:00') })).toBe('vigente')
  })

  it('nocturno de ayer ya terminado hoy → vencida, sin alerta', () => {
    expect(evaluarSinFichar(nocturno, { ...sinEntrada, ahora: en('2026-08-14T07:30:00-03:00') })).toBe('vencida')
    expect(alertaSinFicharVigente(nocturno, { ...sinEntrada, ahora: en('2026-08-14T12:00:00-03:00') })).toBe(false)
  })

  it('el caso real que disparó la auditoría: 17:00–07:30 anulado, 25 h después', () => {
    // LAROMET CARCARAÑA, 13/08. Mostraba 1.522 minutos de demora.
    const t = T({ fecha: '2026-08-13', hora_inicio: '17:00:00', hora_fin: '07:30:00', estado: 'anulado' })
    expect(evaluarSinFichar(t, { ...sinEntrada, ahora: en('2026-08-14T18:22:00-03:00') })).toBe('no_corresponde')
  })
})

// El detector compartido es lo que ve el Panel Principal. Tiene que derivar de
// la misma definición que la Vista Supervisor, no de su ventana de carga.
describe('detectarAlertasOperativas — sin_fichar usa la misma vigencia', () => {
  const objetivos = [{ id: 'o1', estado: 'activo' }]
  const sinFichar = (turnos: any[], ahora: Date) =>
    detectarAlertasOperativas({ turnos, registros: [], objetivos, ahora })
      .filter(a => a.tipo_alerta === 'sin_fichar')

  it('turno en curso sin entrada: la detecta', () => {
    expect(sinFichar([T()], en('2026-08-14T13:00:00-03:00'))).toHaveLength(1)
  })

  it('el mismo turno una vez terminado: ya no', () => {
    expect(sinFichar([T()], en('2026-08-14T17:00:00-03:00'))).toHaveLength(0)
  })

  it('nocturno de ayer en curso: la detecta; terminado: no', () => {
    const n = [T({ fecha: '2026-08-13', hora_inicio: '18:00:00', hora_fin: '07:00:00' })]
    expect(sinFichar(n, en('2026-08-14T03:00:00-03:00'))).toHaveLength(1)
    expect(sinFichar(n, en('2026-08-14T09:00:00-03:00'))).toHaveLength(0)
  })

  it('turno anulado en curso: no la detecta', () => {
    expect(sinFichar([T({ estado: 'anulado' })], en('2026-08-14T13:00:00-03:00'))).toHaveLength(0)
  })

  it('objetivo pausado: no la detecta', () => {
    const a = detectarAlertasOperativas({
      turnos: [T()], registros: [],
      objetivos: [{ id: 'o1', estado: 'inactivo' }],
      ahora: en('2026-08-14T13:00:00-03:00'),
    })
    expect(a).toHaveLength(0)
  })

  it('con entrada registrada no hay sin_fichar, aunque el turno siga en curso', () => {
    const a = detectarAlertasOperativas({
      turnos: [T()],
      registros: [{ id: 'r1', turno_id: 't1', guardia_id: 'g1', tipo_registro: 'fichaje_gps', hora_entrada_real: '08:02:00' }],
      objetivos, ahora: en('2026-08-14T13:00:00-03:00'),
    })
    expect(a.filter(x => x.tipo_alerta === 'sin_fichar')).toHaveLength(0)
  })

  it('una ausencia no cuenta como entrada: la alerta sigue vigente', () => {
    const a = detectarAlertasOperativas({
      turnos: [T()],
      registros: [{ id: 'r1', turno_id: 't1', guardia_id: 'g1', tipo_registro: 'ausencia', hora_entrada_real: '08:02:00' }],
      objetivos, ahora: en('2026-08-14T13:00:00-03:00'),
    })
    expect(a.filter(x => x.tipo_alerta === 'sin_fichar')).toHaveLength(1)
  })
})
