import { describe, expect, it } from 'vitest'
import {
  finProgramadoTurno,
  turnoExigible,
  turnosOperativosDelMes,
  turnosExigiblesHastaAhora,
  pendienteTurno,
  totalPendiente,
} from '@/lib/liquidacion'

// EXIGIBILIDAD
// Un turno es exigible cuando su fin programado ya pasó. Antes el corte era por
// fecha (`fecha <= hoy`), así que un turno de hoy 22:00–06:00 contaba como
// deuda al mediodía, sin haber empezado. Y la exclusión de "en curso" se hacía
// por el registro —entrada sin salida—, con lo cual un turno terminado a las
// 14:00 cuyo vigilador no fichó la salida quedaba fuera del universo, que es
// justo el caso que hay que ver.

const T = (over: any = {}) => ({
  id: 't1',
  objetivo_id: 'o1',
  fecha: '2026-08-14',
  hora_inicio: '08:00:00',
  hora_fin: '16:00:00',
  estado: 'programado',
  ...over,
}) as any

const ms = (iso: string) => Date.parse(iso)
const sinPrueba = () => false

describe('finProgramadoTurno', () => {
  it('turno de día: termina el mismo día', () => {
    expect(finProgramadoTurno(T())).toBe(ms('2026-08-14T16:00:00-03:00'))
  })

  it('turno nocturno: termina al día siguiente', () => {
    const t = T({ hora_inicio: '19:00:00', hora_fin: '07:00:00' })
    expect(finProgramadoTurno(t)).toBe(ms('2026-08-15T07:00:00-03:00'))
  })

  it('el borde 00:00–08:00 NO es nocturno: fin es mayor que inicio', () => {
    const t = T({ hora_inicio: '00:00:00', hora_fin: '08:00:00' })
    expect(finProgramadoTurno(t)).toBe(ms('2026-08-14T08:00:00-03:00'))
  })

  it('fin igual a inicio se trata como que cruza la medianoche', () => {
    const t = T({ hora_inicio: '12:00:00', hora_fin: '12:00:00' })
    expect(finProgramadoTurno(t)).toBe(ms('2026-08-15T12:00:00-03:00'))
  })
})

describe('turnoExigible', () => {
  const t = T() // 14/08 08:00–16:00

  it('antes de empezar: NO exigible', () => {
    expect(turnoExigible(t, ms('2026-08-14T07:00:00-03:00'))).toBe(false)
  })

  it('en curso: NO exigible todavía', () => {
    expect(turnoExigible(t, ms('2026-08-14T12:00:00-03:00'))).toBe(false)
  })

  it('justo en el instante del fin: todavía no', () => {
    expect(turnoExigible(t, ms('2026-08-14T16:00:00-03:00'))).toBe(false)
  })

  it('un minuto después del fin: exigible', () => {
    expect(turnoExigible(t, ms('2026-08-14T16:01:00-03:00'))).toBe(true)
  })

  it('nocturno: a las 23:00 del mismo día NO es exigible', () => {
    const n = T({ hora_inicio: '19:00:00', hora_fin: '07:00:00' })
    expect(turnoExigible(n, ms('2026-08-14T23:00:00-03:00'))).toBe(false)
  })

  it('nocturno: a las 08:00 del día siguiente SÍ', () => {
    const n = T({ hora_inicio: '19:00:00', hora_fin: '07:00:00' })
    expect(turnoExigible(n, ms('2026-08-15T08:00:00-03:00'))).toBe(true)
  })
})

describe('turnosOperativosDelMes / turnosExigiblesHastaAhora', () => {
  const base = [
    T({ id: 'ok', fecha: '2026-08-01' }),
    T({ id: 'anulado', fecha: '2026-08-01', estado: 'anulado' }),
    T({ id: 'cancelado', fecha: '2026-08-01', estado: 'cancelado' }),
    T({ id: 'reemplazado', fecha: '2026-08-01', estado: 'reemplazado' }),
    T({ id: 'prueba', fecha: '2026-08-01', objetivo_id: 'oPrueba' }),
    T({ id: 'futuro', fecha: '2026-08-31' }),
  ]
  const esPrueba = (id?: string | null) => id === 'oPrueba'
  const ahora = ms('2026-08-14T18:00:00-03:00')

  it('operativos: saca anulado, cancelado, reemplazado y objetivos de prueba', () => {
    const r = turnosOperativosDelMes(base, { esObjetivoPrueba: esPrueba })
    expect(r.map(t => t.id).sort()).toEqual(['futuro', 'ok'])
  })

  it('exigibles: además saca los que todavía no terminaron', () => {
    const r = turnosExigiblesHastaAhora(base, { esObjetivoPrueba: esPrueba, ahora })
    expect(r.map(t => t.id)).toEqual(['ok'])
  })

  it('un turno anulado que ya pasó tampoco es exigible', () => {
    const r = turnosExigiblesHastaAhora([T({ id: 'x', fecha: '2026-08-01', estado: 'anulado' })], {
      esObjetivoPrueba: sinPrueba, ahora,
    })
    expect(r).toHaveLength(0)
  })
})

// PENDIENTE POR TURNO
// Se calcula turno por turno y nunca se compensa entre turnos. Un vigilador que
// se quedó de más porque no llegó el relevo generó horas que corresponden —se
// pagan y se cobran— pero no tapan las que faltan en otro turno de otra persona.

describe('pendienteTurno', () => {
  const t = T() // 8 horas programadas

  it('sin registro: pendiente completo', () => {
    expect(pendienteTurno(t, null)).toBe(8)
  })

  it('fichaje completo: sin pendiente', () => {
    expect(pendienteTurno(t, { hora_entrada_real: '08:00:00', hora_salida_real: '16:00:00' } as any)).toBe(0)
  })

  it('horas reconocidas por debajo: pendiente es la diferencia', () => {
    expect(pendienteTurno(t, { horas_liquidables: 5 } as any)).toBe(3)
  })

  it('extensión de jornada: pendiente CERO, nunca negativo', () => {
    // Se quedó hasta las 18:00 porque no llegó el relevo: 10 h reconocidas
    // sobre 8 programadas. Las horas se conservan, el pendiente es 0.
    expect(pendienteTurno(t, { horas_liquidables: 10 } as any)).toBe(0)
  })

  it('entrada sin salida: no hay horas reconocidas, pendiente completo', () => {
    expect(pendienteTurno(t, { hora_entrada_real: '08:00:00' } as any)).toBe(8)
  })
})

describe('totalPendiente — no compensa entre turnos', () => {
  it('una extensión no tapa el faltante de otro turno', () => {
    const turnos = [
      T({ id: 'faltante' }),   // 8 h, sin registro  → 8 pendiente
      T({ id: 'extendido' }),  // 8 h, 12 reconocidas → 0 pendiente
    ]
    const regs = new Map<string, any>([['extendido', { turno_id: 'extendido', horas_liquidables: 12 }]])
    // La resta global daría 16 - 12 = 4. El criterio correcto es 8.
    expect(totalPendiente(turnos, regs)).toBe(8)
  })

  it('todo cubierto: cero', () => {
    const turnos = [T({ id: 'a' }), T({ id: 'b' })]
    const regs = new Map<string, any>([
      ['a', { turno_id: 'a', hora_entrada_real: '08:00:00', hora_salida_real: '16:00:00' }],
      ['b', { turno_id: 'b', hora_entrada_real: '08:00:00', hora_salida_real: '16:00:00' }],
    ])
    expect(totalPendiente(turnos, regs)).toBe(0)
  })

  it('la suma de los pendientes individuales es la del conjunto', () => {
    const turnos = [T({ id: 'a' }), T({ id: 'b' }), T({ id: 'c' })]
    const regs = new Map<string, any>([['b', { turno_id: 'b', horas_liquidables: 3 }]])
    const uno = turnos.reduce((s, t) => s + pendienteTurno(t, regs.get(t.id) ?? null), 0)
    expect(totalPendiente(turnos, regs)).toBe(uno)
    expect(uno).toBe(8 + 5 + 8)
  })
})
