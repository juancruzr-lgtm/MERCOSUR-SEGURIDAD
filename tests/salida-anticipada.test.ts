import { describe, expect, it } from 'vitest'
import {
  MINUTOS_AVISO_SALIDA_ANTICIPADA, esSalidaMuyAnticipada, minutosHastaFinDeTurno,
} from '@/lib/salida-anticipada'

// El aviso antes de una salida claramente prematura. Lo que se fija acá es que
// avise donde tiene que avisar y que NO moleste donde la salida es normal: un
// aviso que salta siempre deja de leerse.

/** Un `Date` con esa hora local, para no depender de la hora en que corran los tests. */
const alas = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(2026, 7, 30, h, m, 0, 0)
  return d
}

const diurno = { hora_inicio: '07:00', hora_fin: '19:00' }
const nocturno = { hora_inicio: '19:00', hora_fin: '07:00' }

describe('turno diurno 07:00-19:00', () => {
  it('el caso real: fichar a las 08:14 avisa', () => {
    expect(minutosHastaFinDeTurno(diurno, alas('08:14'))).toBe(646)
    expect(esSalidaMuyAnticipada(diurno, alas('08:14'))).toBe(true)
  })

  it('salir a horario NO avisa', () => {
    expect(esSalidaMuyAnticipada(diurno, alas('19:00'))).toBe(false)
    expect(esSalidaMuyAnticipada(diurno, alas('18:55'))).toBe(false)
  })

  it('salir un rato antes tampoco: el relevo llega antes y es normal', () => {
    expect(esSalidaMuyAnticipada(diurno, alas('18:05'))).toBe(false)
    expect(minutosHastaFinDeTurno(diurno, alas('18:05'))).toBe(55)
  })

  it('salir con más de una hora de anticipación sí avisa', () => {
    expect(esSalidaMuyAnticipada(diurno, alas('17:30'))).toBe(true)
  })

  it('salir DESPUÉS del fin no avisa: se quedó de más, no se fue antes', () => {
    expect(minutosHastaFinDeTurno(diurno, alas('19:40'))).toBeLessThan(0)
    expect(esSalidaMuyAnticipada(diurno, alas('19:40'))).toBe(false)
  })

  it('el borde exacto de una hora no avisa', () => {
    expect(minutosHastaFinDeTurno(diurno, alas('18:00'))).toBe(MINUTOS_AVISO_SALIDA_ANTICIPADA)
    expect(esSalidaMuyAnticipada(diurno, alas('18:00'))).toBe(false)
    expect(esSalidaMuyAnticipada(diurno, alas('17:59'))).toBe(true)
  })
})

describe('turno nocturno 19:00-07:00', () => {
  it('salir a las 06:00, cerca del final, NO avisa', () => {
    // Sin tratar el nocturno, esto daría 07:00 - 06:00 con signo equivocado y
    // el aviso saltaría todas las noches.
    expect(minutosHastaFinDeTurno(nocturno, alas('06:00'))).toBe(60)
    expect(esSalidaMuyAnticipada(nocturno, alas('06:00'))).toBe(false)
  })

  it('salir a las 20:15, recién empezado, avisa', () => {
    expect(minutosHastaFinDeTurno(nocturno, alas('20:15'))).toBe(645)
    expect(esSalidaMuyAnticipada(nocturno, alas('20:15'))).toBe(true)
  })

  it('salir a las 02:00, a mitad de la madrugada, avisa', () => {
    expect(minutosHastaFinDeTurno(nocturno, alas('02:00'))).toBe(300)
    expect(esSalidaMuyAnticipada(nocturno, alas('02:00'))).toBe(true)
  })

  it('salir a horario no avisa', () => {
    expect(esSalidaMuyAnticipada(nocturno, alas('07:00'))).toBe(false)
  })
})

describe('sin datos no se molesta a nadie', () => {
  it('sin hora de fin no avisa', () => {
    expect(minutosHastaFinDeTurno({ hora_inicio: '07:00' })).toBeNull()
    expect(esSalidaMuyAnticipada({ hora_inicio: '07:00' })).toBe(false)
  })

  it('con horario ilegible tampoco', () => {
    expect(minutosHastaFinDeTurno({ hora_inicio: 'x', hora_fin: 'y' })).toBeNull()
    expect(esSalidaMuyAnticipada({ hora_fin: '' })).toBe(false)
  })

  it('acepta el formato con segundos que viene de la base', () => {
    expect(minutosHastaFinDeTurno({ hora_inicio: '07:00:00', hora_fin: '19:00:00' }, alas('08:14')))
      .toBe(646)
  })
})

describe('turnos cortos', () => {
  it('un turno de 4 horas avisa igual si se sale al principio', () => {
    const corto = { hora_inicio: '10:00', hora_fin: '14:00' }
    expect(esSalidaMuyAnticipada(corto, alas('10:20'))).toBe(true)
    expect(esSalidaMuyAnticipada(corto, alas('13:30'))).toBe(false)
  })
})
