import { describe, expect, it } from 'vitest'
import {
  estadoTemporalTurno, finProgramado, repartirHorasDelDia,
} from '@/lib/horas-del-dia'

// El caso real: el tablero decía "Horas trabajadas hoy 60,0" con CERO turnos
// finalizados. Eran cinco cargas manuales de 12 h sobre turnos que seguían
// corriendo. Lo que se fija acá es que esas horas se sigan contando —son
// liquidables y nadie las discute— pero en la columna que corresponde.

const T = (over: any = {}) => ({
  fecha: '2026-08-31', hora_inicio: '07:00', hora_fin: '19:00',
  estado: 'cubierto', ...over,
})

/** Carga manual: sin fichaje, con las horas ya declaradas. */
const manual = (horas = 12) => ({
  tipo_registro: 'carga_manual', horas_liquidables: horas,
  hora_entrada_real: null, hora_salida_real: null,
  hora_entrada_final: null, hora_salida_final: null,
})

const alas = (hhmm: string, fecha = '2026-08-31') => {
  const [a, m, d] = fecha.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  return new Date(a, m - 1, d, h, mi, 0, 0)
}

describe('cuándo un turno está cerrado', () => {
  it('con salida real registrada, siempre', () => {
    const r = { ...manual(), hora_salida_real: '19:05' }
    expect(estadoTemporalTurno(T(), r, alas('12:00'))).toBe('cerrado')
  })

  it('con salida corregida por Administración, también', () => {
    const r = { ...manual(), hora_salida_final: '19:00' }
    expect(estadoTemporalTurno(T(), r, alas('12:00'))).toBe('cerrado')
  })

  it('sin salida pero pasada la hora de fin: cerrado', () => {
    // Es el turno que terminó y nadie fichó. A las 23:00 ya no está en curso.
    expect(estadoTemporalTurno(T(), manual(), alas('23:00'))).toBe('cerrado')
  })

  it('sin salida y antes del fin: en curso — el caso de las 60 h', () => {
    expect(estadoTemporalTurno(T(), manual(), alas('12:00'))).toBe('en_curso')
  })

  it('justo en la hora de fin ya cuenta como cerrado', () => {
    expect(estadoTemporalTurno(T(), manual(), alas('19:00'))).toBe('cerrado')
    expect(estadoTemporalTurno(T(), manual(), alas('18:59'))).toBe('en_curso')
  })

  it('sin registro, decide el horario', () => {
    expect(estadoTemporalTurno(T(), null, alas('12:00'))).toBe('en_curso')
    expect(estadoTemporalTurno(T(), null, alas('23:00'))).toBe('cerrado')
  })
})

describe('turnos nocturnos', () => {
  const noche = T({ hora_inicio: '19:00', hora_fin: '07:00' })

  it('a las 23:00 de la misma noche sigue en curso', () => {
    // Sin tratar el nocturno, 07:00 seria "ya paso" y figuraria cerrado apenas
    // empieza: todas las noches, todos los turnos.
    expect(estadoTemporalTurno(noche, manual(), alas('23:00'))).toBe('en_curso')
  })

  it('a las 03:00 de la madrugada siguiente, todavía en curso', () => {
    expect(estadoTemporalTurno(noche, manual(), alas('03:00', '2026-09-01'))).toBe('en_curso')
  })

  it('a las 08:00 del día siguiente, cerrado', () => {
    expect(estadoTemporalTurno(noche, manual(), alas('08:00', '2026-09-01'))).toBe('cerrado')
  })

  it('el fin programado cae 12 h después del inicio', () => {
    const ini = new Date(2026, 7, 31, 19, 0).getTime()
    expect(finProgramado(noche)! - ini).toBe(12 * 60 * 60 * 1000)
  })
})

describe('datos que no se pueden leer', () => {
  it('sin horario legible se considera cerrado, no en curso', () => {
    // Preferible que una hora ya trabajada figure como cerrada a afirmar que un
    // servicio sigue corriendo sin saberlo.
    expect(finProgramado(T({ hora_fin: null }))).toBeNull()
    expect(estadoTemporalTurno(T({ hora_fin: null }), manual(), alas('12:00'))).toBe('cerrado')
  })

  it('una fecha rota tampoco rompe la tarjeta', () => {
    expect(finProgramado(T({ fecha: 'x' }))).toBeNull()
  })
})

describe('el reparto de las horas del día', () => {
  it('reproduce el caso real: 60 h reconocidas, 0 cerradas', () => {
    // Los cinco de ese día: 12 h cada uno, carga manual, turno corriendo.
    const pares = [
      { turno: T({ hora_inicio: '10:00', hora_fin: '22:00' }), registro: manual() },
      { turno: T({ hora_inicio: '06:00', hora_fin: '18:00' }), registro: manual() },
      { turno: T({ hora_inicio: '08:00', hora_fin: '20:00' }), registro: manual() },
      { turno: T({ hora_inicio: '08:00', hora_fin: '20:00' }), registro: manual() },
      { turno: T({ hora_inicio: '08:00', hora_fin: '20:00' }), registro: manual() },
    ]
    const h = repartirHorasDelDia(pares as any, alas('11:00'))
    expect(h.enCurso).toBe(60)
    expect(h.cerradas).toBe(0)
    expect(h.turnosEnCurso).toBe(5)
    expect(h.turnosCerrados).toBe(0)
  })

  it('la suma es EXACTAMENTE el total que se mostraba antes', () => {
    const pares = [
      { turno: T({ hora_fin: '12:00' }), registro: manual(5) },   // ya terminó
      { turno: T(), registro: manual(12) },                        // en curso
    ]
    const h = repartirHorasDelDia(pares as any, alas('14:00'))
    expect(h.cerradas).toBe(5)
    expect(h.enCurso).toBe(12)
    expect(h.total).toBe(17)
  })

  it('una carga manual sobre un turno YA TERMINADO cuenta como cerrada', () => {
    // La carga manual no es en sí "anticipada": lo es sólo si el turno sigue.
    const pares = [{ turno: T({ hora_fin: '12:00' }), registro: manual(5) }]
    expect(repartirHorasDelDia(pares as any, alas('18:00')).cerradas).toBe(5)
  })

  it('un fichaje GPS completo cuenta como cerrado aunque el turno siga', () => {
    // Se fue antes y fichó la salida: su jornada terminó.
    const gps = {
      tipo_registro: 'fichaje_gps',
      hora_entrada_real: '07:00', hora_salida_real: '11:00',
      horas_liquidables: 4,
    }
    const h = repartirHorasDelDia([{ turno: T(), registro: gps }] as any, alas('12:00'))
    expect(h.cerradas).toBe(4)
    expect(h.enCurso).toBe(0)
  })

  it('un turno abierto sin carga manual no inventa horas', () => {
    const sinNada = {
      tipo_registro: 'fichaje_gps', hora_entrada_real: '07:00',
      hora_salida_real: null, horas_liquidables: null,
    }
    const h = repartirHorasDelDia([{ turno: T(), registro: sinNada }] as any, alas('12:00'))
    expect(h.enCurso).toBe(0)
    expect(h.total).toBe(0)
    // Pero el turno existe y se cuenta: no trabajó ≠ todavía no reconocido.
    expect(h.turnosEnCurso).toBe(1)
  })

  it('una corrección final manda sobre el horario programado', () => {
    const corregido = {
      tipo_registro: 'fichaje_gps', hora_entrada_final: '07:00',
      hora_salida_final: '15:00', hora_entrada_real: '07:00', hora_salida_real: null,
    }
    const h = repartirHorasDelDia([{ turno: T(), registro: corregido }] as any, alas('16:00'))
    expect(h.turnosCerrados).toBe(1)
    expect(h.cerradas).toBe(8)
  })

  it('sin turnos, todo en cero y sin dividir por cero', () => {
    const h = repartirHorasDelDia([], alas('12:00'))
    expect(h).toEqual({ cerradas: 0, enCurso: 0, total: 0, turnosCerrados: 0, turnosEnCurso: 0 })
  })

  it('ningún turno se cuenta dos veces', () => {
    const pares = [
      { turno: T({ hora_fin: '12:00' }), registro: manual(5) },
      { turno: T(), registro: manual(12) },
    ]
    const h = repartirHorasDelDia(pares as any, alas('14:00'))
    expect(h.turnosCerrados + h.turnosEnCurso).toBe(pares.length)
  })
})
