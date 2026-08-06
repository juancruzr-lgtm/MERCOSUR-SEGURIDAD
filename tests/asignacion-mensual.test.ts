import { describe, expect, it } from 'vitest'
import {
  ETIQUETA_ESTADO_ASIGNACION,
  armarGrillaMensual,
  estadoAsignacion,
  esTurnoFuturo,
  fechasEnRango,
  filtrarGrillaMensual,
  planificarAsignacionFila,
  planificarAsignacionRango,
  resumenAsignacionMensual,
  turnosEnConflicto,
} from '@/lib/asignacion-mensual'
import type { TurnoGrilla } from '@/lib/asignacion-mensual'

// Grilla mensual de asignación (Bloque E). Todo puro: arma la grilla, planifica
// asignaciones (individual/rango/fila completa) y calcula el resumen — sin
// tocar Supabase. La persistencia real vive en la RPC asignar_vigilador_turnos.

const t = (over: Partial<TurnoGrilla> & Pick<TurnoGrilla, 'id' | 'fecha' | 'hora_inicio' | 'hora_fin'>): TurnoGrilla => ({
  puesto_id: 'pv1', puesto_nombre: 'Vigilador 1', guardia_id: null, guardia_nombre: null,
  guardia_habitual_id: null, estado: 'programado', tipo_evento: 'normal',
  ...over,
})

// Réplica de NSER: 3 posiciones, 07-19 x2 + 19-07 x1, todo agosto (07→31).
const turnosNSER = (): TurnoGrilla[] => {
  const fechas = fechasEnRango('2026-08-07', '2026-08-31')
  return fechas.flatMap(f => [
    t({ id: `v1-${f}`, fecha: f, hora_inicio: '07:00', hora_fin: '19:00', puesto_id: 'pv1', puesto_nombre: 'Vigilador 1' }),
    t({ id: `v2-${f}`, fecha: f, hora_inicio: '07:00', hora_fin: '19:00', puesto_id: 'pv2', puesto_nombre: 'Vigilador 2' }),
    t({ id: `v3-${f}`, fecha: f, hora_inicio: '19:00', hora_fin: '07:00', puesto_id: 'pv3', puesto_nombre: 'Vigilador 3' }),
  ])
}

describe('fechasEnRango', () => {
  it('rango completo del mes agosto (07 a 31)', () => {
    expect(fechasEnRango('2026-08-07', '2026-08-31')).toHaveLength(25)
  })
})

describe('armarGrillaMensual', () => {
  it('grilla mensual con tres posiciones (NSER)', () => {
    const g = armarGrillaMensual(turnosNSER(), '2026-08-01', '2026-08-31')
    expect(g.filas).toHaveLength(3)
    expect(g.filas.map(f => f.puesto_nombre).sort()).toEqual(['Vigilador 1', 'Vigilador 2', 'Vigilador 3'])
    expect(g.fechas).toHaveLength(31)
  })

  it('turnos programados visibles en la grilla (celda por fecha)', () => {
    const g = armarGrillaMensual(turnosNSER(), '2026-08-07', '2026-08-31')
    const filaV1 = g.filas.find(f => f.puesto_nombre === 'Vigilador 1')!
    expect(filaV1.celdas.get('2026-08-10')?.id).toBe('v1-2026-08-10')
    expect(filaV1.celdas.size).toBe(25)
  })
})

describe('estados y resumen', () => {
  it('estadoAsignacion: sin guardia = programado, con guardia = asignado', () => {
    expect(estadoAsignacion({ guardia_id: null })).toBe('programado')
    expect(estadoAsignacion({ guardia_id: 'g1' })).toBe('asignado')
    expect(ETIQUETA_ESTADO_ASIGNACION.programado).toBe('Programado')
    expect(ETIQUETA_ESTADO_ASIGNACION.asignado).toBe('Asignado')
    expect(ETIQUETA_ESTADO_ASIGNACION.publicado).toBe('Publicado')
  })

  it('estadoAsignacion: publicado prevalece sobre asignado y sobre programado', () => {
    expect(estadoAsignacion({ guardia_id: null, publicado: true })).toBe('publicado')
    expect(estadoAsignacion({ guardia_id: 'g1', publicado: true })).toBe('publicado')
    expect(estadoAsignacion({ guardia_id: 'g1', publicado: false })).toBe('asignado')
  })

  it('resumen del mes cuenta publicados por separado de asignados', () => {
    const turnos = turnosNSER().map((x, i) => i % 5 === 0 ? { ...x, guardia_id: 'g1', publicado: true } : x)
    const r = resumenAsignacionMensual(turnos, '2026-08-07', '10:00')
    expect(r.publicados).toBeGreaterThan(0)
    expect(r.asignados).toBe(0) // los publicados no vuelven a contar como asignados
  })

  it('resumen del mes: turnos futuros con 0 asignados de entrada', () => {
    // 25 días x 3 posiciones = 75 turnos. A las 10:00 del 07/08, los dos
    // diurnos de ESE día (07:00) ya empezaron y no cuentan como futuros;
    // el nocturno del 07 (19:00) sigue siendo futuro. 75 - 2 = 73.
    const turnos = turnosNSER()
    const r = resumenAsignacionMensual(turnos, '2026-08-07', '10:00')
    expect(r.futuros).toBe(73)
    expect(r.programados).toBe(73)
    expect(r.asignados).toBe(0)
    expect(r.publicados).toBe(0)
  })

  it('resumen tras una asignación: 2 pasan a asignados sin cambiar el total futuro', () => {
    const turnos = turnosNSER().map(x =>
      ['v1-2026-08-10', 'v2-2026-08-10'].includes(x.id) ? { ...x, guardia_id: 'g1' } : x)
    const r = resumenAsignacionMensual(turnos, '2026-08-07', '10:00')
    expect(r.futuros).toBe(73)
    expect(r.asignados).toBe(2)
    expect(r.programados).toBe(71)
  })

  it('esTurnoFuturo: pasado, en curso y futuro', () => {
    expect(esTurnoFuturo({ fecha: '2026-08-05', hora_inicio: '07:00' }, '2026-08-06', '10:00')).toBe(false)
    expect(esTurnoFuturo({ fecha: '2026-08-06', hora_inicio: '07:00' }, '2026-08-06', '10:00')).toBe(false)
    expect(esTurnoFuturo({ fecha: '2026-08-06', hora_inicio: '19:00' }, '2026-08-06', '10:00')).toBe(true)
    expect(esTurnoFuturo({ fecha: '2026-08-07', hora_inicio: '07:00' }, '2026-08-06', '10:00')).toBe(true)
  })
})

describe('filtrarGrillaMensual y conflictos', () => {
  it('detecta superposición entre dos turnos del mismo guardia', () => {
    const turnos = [
      t({ id: 'a', fecha: '2026-08-10', hora_inicio: '07:00', hora_fin: '19:00', guardia_id: 'g1' }),
      t({ id: 'b', fecha: '2026-08-10', hora_inicio: '10:00', hora_fin: '22:00', puesto_id: 'pv2', guardia_id: 'g1' }),
      t({ id: 'c', fecha: '2026-08-11', hora_inicio: '07:00', hora_fin: '19:00', guardia_id: 'g1' }),
    ]
    const conf = turnosEnConflicto(turnos)
    expect(conf.has('a')).toBe(true)
    expect(conf.has('b')).toBe(true)
    expect(conf.has('c')).toBe(false)
  })

  it('filtro sin conflicto excluye los turnos conflictivos', () => {
    const turnos = [
      t({ id: 'a', fecha: '2026-08-10', hora_inicio: '07:00', hora_fin: '19:00', guardia_id: 'g1' }),
      t({ id: 'b', fecha: '2026-08-10', hora_inicio: '10:00', hora_fin: '22:00', puesto_id: 'pv2', guardia_id: 'g1' }),
    ]
    expect(filtrarGrillaMensual(turnos, { conConflicto: false })).toHaveLength(0)
    expect(filtrarGrillaMensual(turnos, { conConflicto: true })).toHaveLength(2)
  })

  it('filtros de posición, estado, guardia y rango de fechas', () => {
    const turnos = turnosNSER().map((x, i) => i % 5 === 0 ? { ...x, guardia_id: 'g1' } : x)
    expect(filtrarGrillaMensual(turnos, { puestoId: 'pv1' }).every(x => x.puesto_id === 'pv1')).toBe(true)
    expect(filtrarGrillaMensual(turnos, { estado: 'asignado' }).every(x => x.guardia_id)).toBe(true)
    expect(filtrarGrillaMensual(turnos, { guardiaId: 'g1' }).every(x => x.guardia_id === 'g1')).toBe(true)
    expect(filtrarGrillaMensual(turnos, { desde: '2026-08-20', hasta: '2026-08-20' })).toHaveLength(3)
  })
})

describe('planificarAsignacionRango — asignación por rango', () => {
  const filaV1 = () => armarGrillaMensual(turnosNSER(), '2026-08-07', '2026-08-31').filas.find(f => f.puesto_nombre === 'Vigilador 1')!

  it('asignación por rango: todos los días', () => {
    const plan = planificarAsignacionRango({
      fila: filaV1(), desde: '2026-08-07', hasta: '2026-08-31', guardiaId: 'g1',
      patron: 'todos', fechaActual: '2026-08-07', horaActual: '00:00',
    })
    expect(plan.resumen.validos).toBe(25)
    expect(plan.turno_ids).toHaveLength(25)
  })

  it('asignación por rango: lunes a viernes', () => {
    const plan = planificarAsignacionRango({
      fila: filaV1(), desde: '2026-08-07', hasta: '2026-08-31', guardiaId: 'g1',
      patron: 'lun_vie', fechaActual: '2026-08-07', horaActual: '00:00',
    })
    // Agosto 2026: 07 es viernes, 31 es lunes. L-V entre 07 y 31 = 17 días.
    expect(plan.resumen.validos).toBe(17)
  })

  it('exclusión de fechas puntuales', () => {
    const plan = planificarAsignacionRango({
      fila: filaV1(), desde: '2026-08-07', hasta: '2026-08-12', guardiaId: 'g1',
      patron: 'todos', excluir: ['2026-08-09', '2026-08-10'],
      fechaActual: '2026-08-07', horaActual: '00:00',
    })
    expect(plan.resumen.validos).toBe(4)
    expect(plan.filas.find(f => f.fecha === '2026-08-09')?.motivo).toBe('excluido')
  })

  it('turno pasado no es asignable', () => {
    const plan = planificarAsignacionRango({
      fila: filaV1(), desde: '2026-08-07', hasta: '2026-08-10', guardiaId: 'g1',
      patron: 'todos', fechaActual: '2026-08-09', horaActual: '10:00',
    })
    const fila07 = plan.filas.find(f => f.fecha === '2026-08-07')
    expect(fila07?.estado).toBe('omitido')
    expect(fila07?.motivo).toBe('pasado_o_iniciado')
  })

  it('turno del día que ya inició no es asignable', () => {
    const plan = planificarAsignacionRango({
      fila: filaV1(), desde: '2026-08-09', hasta: '2026-08-09', guardiaId: 'g1',
      patron: 'todos', fechaActual: '2026-08-09', horaActual: '08:00', // turno empieza 07:00
    })
    expect(plan.filas[0].estado).toBe('omitido')
    expect(plan.filas[0].motivo).toBe('pasado_o_iniciado')
  })

  it('ya asignado a otro vigilador: omitido, no sobrescribe', () => {
    const filaConAsignado = armarGrillaMensual(
      turnosNSER().map(x => x.id === 'v1-2026-08-10' ? { ...x, guardia_id: 'g9' } : x),
      '2026-08-07', '2026-08-31',
    ).filas.find(f => f.puesto_nombre === 'Vigilador 1')!
    const plan = planificarAsignacionRango({
      fila: filaConAsignado, desde: '2026-08-10', hasta: '2026-08-10', guardiaId: 'g1',
      patron: 'todos', fechaActual: '2026-08-07', horaActual: '00:00',
    })
    expect(plan.filas[0].estado).toBe('omitido')
    expect(plan.filas[0].motivo).toBe('ya_asignado_otro')
    expect(plan.turno_ids).toHaveLength(0)
  })

  it('idempotencia: ya asignado al MISMO vigilador no se reenvía ni rompe el plan', () => {
    const filaConAsignado = armarGrillaMensual(
      turnosNSER().map(x => x.id === 'v1-2026-08-10' ? { ...x, guardia_id: 'g1' } : x),
      '2026-08-07', '2026-08-31',
    ).filas.find(f => f.puesto_nombre === 'Vigilador 1')!
    const plan = planificarAsignacionRango({
      fila: filaConAsignado, desde: '2026-08-07', hasta: '2026-08-12', guardiaId: 'g1',
      patron: 'todos', fechaActual: '2026-08-07', horaActual: '00:00',
    })
    const dia10 = plan.filas.find(f => f.fecha === '2026-08-10')
    expect(dia10?.estado).toBe('ya_asignado_mismo')
    expect(plan.turno_ids).not.toContain('v1-2026-08-10')
    expect(plan.resumen.ya_asignados).toBe(1)
  })

  it('conflicto detectado con otro turno ya asignado al vigilador (informativo)', () => {
    const filaV3 = armarGrillaMensual(turnosNSER(), '2026-08-07', '2026-08-31').filas.find(f => f.puesto_nombre === 'Vigilador 3')!
    const plan = planificarAsignacionRango({
      fila: filaV3, desde: '2026-08-10', hasta: '2026-08-10', guardiaId: 'g1',
      patron: 'todos', fechaActual: '2026-08-07', horaActual: '00:00',
      // g1 ya tiene un turno diurno el mismo día que se superpone con el nocturno (19-07) si empezara antes... probamos con solapamiento directo.
      turnosVigilador: [t({ id: 'otro', fecha: '2026-08-10', hora_inicio: '19:00', hora_fin: '23:00', puesto_id: 'px', guardia_id: 'g1' })],
    })
    expect(plan.resumen.conflictos).toBe(1)
    expect(plan.resumen.validos).toBe(1) // sigue siendo válido: la RPC decide en servidor
  })
})

describe('planificarAsignacionFila — toda la fila', () => {
  it('asignación de toda una fila (todos los turnos visibles de la posición)', () => {
    const filaV2 = armarGrillaMensual(turnosNSER(), '2026-08-07', '2026-08-31').filas.find(f => f.puesto_nombre === 'Vigilador 2')!
    const plan = planificarAsignacionFila({
      fila: filaV2, guardiaId: 'g1', fechaActual: '2026-08-07', horaActual: '00:00',
    })
    expect(plan.resumen.validos).toBe(25)
  })

  it('asignación parcial: algunos válidos y otros omitidos en el mismo lote', () => {
    const conMezcla = armarGrillaMensual(
      turnosNSER().map(x => x.id === 'v1-2026-08-15' ? { ...x, guardia_id: 'g9' } : x),
      '2026-08-07', '2026-08-31',
    ).filas.find(f => f.puesto_nombre === 'Vigilador 1')!
    const plan = planificarAsignacionFila({
      fila: conMezcla, guardiaId: 'g1', fechaActual: '2026-08-07', horaActual: '00:00',
    })
    expect(plan.resumen.validos).toBe(24)
    expect(plan.resumen.omitidos).toBe(1)
    expect(plan.filas.find(f => f.fecha === '2026-08-15')?.motivo).toBe('ya_asignado_otro')
  })
})

describe('pureza', () => {
  it('no muta las entradas', () => {
    const turnos = turnosNSER()
    const congelar = (v: unknown) => { if (v && typeof v === 'object') { Object.freeze(v); Object.values(v as object).forEach(congelar) } }
    congelar(turnos)
    const antes = JSON.stringify(turnos)
    expect(() => armarGrillaMensual(turnos, '2026-08-07', '2026-08-31')).not.toThrow()
    expect(() => resumenAsignacionMensual(turnos, '2026-08-07', '10:00')).not.toThrow()
    expect(JSON.stringify(turnos)).toBe(antes)
  })
})
