import { describe, expect, it } from 'vitest'
import {
  EGRESO_AVISO_DESDE_MIN,
  EGRESO_AVISO_HASTA_MIN,
  debeAvisarEgresoPendiente,
  esNocturno,
  minutosDesdeFinDeTurno,
  recordatorioDeTurno,
} from '@/lib/notificaciones-push'

// Reglas de cuándo corresponde cada aviso. Ninguna de estas funciones envía
// nada ni toca la base: solo deciden.

// Turno diurno 08:00-16:00 que arranca en el minuto absoluto 1000.
const diurno = { inicioAbsMin: 1000, horaInicio: '08:00', horaFin: '16:00' }
// Turno nocturno 22:00-06:00: termina 8 h después del inicio, al día siguiente.
const nocturno = { inicioAbsMin: 1000, horaInicio: '22:00', horaFin: '06:00' }

describe('esNocturno', () => {
  it('fin posterior al inicio no es nocturno', () => expect(esNocturno('08:00', '16:00')).toBe(false))
  it('fin anterior al inicio cruza medianoche', () => expect(esNocturno('22:00', '06:00')).toBe(true))
  it('mismo horario cuenta como nocturno de 24 h', () => expect(esNocturno('08:00', '08:00')).toBe(true))
})

describe('minutosDesdeFinDeTurno', () => {
  it('turno diurno de 8 h: al minuto del cierre da 0', () => {
    expect(minutosDesdeFinDeTurno({ ...diurno, ahoraMin: 1000 + 480 })).toBe(0)
  })

  it('turno diurno: 10 minutos despues', () => {
    expect(minutosDesdeFinDeTurno({ ...diurno, ahoraMin: 1000 + 490 })).toBe(10)
  })

  it('antes del fin devuelve negativo', () => {
    expect(minutosDesdeFinDeTurno({ ...diurno, ahoraMin: 1000 + 100 })).toBe(-380)
  })

  it('NOCTURNO: 22:00-06:00 dura 8 h, no -16 h', () => {
    expect(minutosDesdeFinDeTurno({ ...nocturno, ahoraMin: 1000 + 480 })).toBe(0)
    expect(minutosDesdeFinDeTurno({ ...nocturno, ahoraMin: 1000 + 490 })).toBe(10)
  })

  it('hora invalida no rompe', () => {
    expect(minutosDesdeFinDeTurno({ ...diurno, horaFin: 'x', ahoraMin: 1 })).toBeNull()
  })
})

describe('debeAvisarEgresoPendiente', () => {
  const base = { ...diurno, tieneEntrada: true, tieneSalida: false, ahoraMin: 1000 + 480 + 10 }

  it('dentro de la ventana avisa', () => expect(debeAvisarEgresoPendiente(base)).toBe(true))

  it('antes de los 5 minutos todavia no', () => {
    expect(debeAvisarEgresoPendiente({ ...base, ahoraMin: 1000 + 480 + 4 })).toBe(false)
  })

  it('en el minuto 5 justo, si', () => {
    expect(debeAvisarEgresoPendiente({ ...base, ahoraMin: 1000 + 480 + EGRESO_AVISO_DESDE_MIN })).toBe(true)
  })

  it('en el minuto 20 justo, si', () => {
    expect(debeAvisarEgresoPendiente({ ...base, ahoraMin: 1000 + 480 + EGRESO_AVISO_HASTA_MIN })).toBe(true)
  })

  it('pasados los 20 ya no: lo toma el cierre automatico', () => {
    expect(debeAvisarEgresoPendiente({ ...base, ahoraMin: 1000 + 480 + 21 })).toBe(false)
  })

  it('antes de que termine el turno nunca', () => {
    expect(debeAvisarEgresoPendiente({ ...base, ahoraMin: 1000 + 200 })).toBe(false)
  })

  it('sin entrada no corresponde', () => {
    expect(debeAvisarEgresoPendiente({ ...base, tieneEntrada: false })).toBe(false)
  })

  it('ya marco la salida: no molestar', () => {
    expect(debeAvisarEgresoPendiente({ ...base, tieneSalida: true })).toBe(false)
  })

  it('cerrado por el sistema: no pedirle nada', () => {
    expect(debeAvisarEgresoPendiente({ ...base, cierreAutomatico: true })).toBe(false)
  })

  it('NOCTURNO dentro de la ventana avisa', () => {
    expect(debeAvisarEgresoPendiente({
      ...nocturno, tieneEntrada: true, tieneSalida: false, ahoraMin: 1000 + 480 + 10,
    })).toBe(true)
  })

  it('NOCTURNO a mitad del turno no avisa', () => {
    expect(debeAvisarEgresoPendiente({
      ...nocturno, tieneEntrada: true, tieneSalida: false, ahoraMin: 1000 + 240,
    })).toBe(false)
  })
})

describe('recordatorioDeTurno', () => {
  it('30 minutos antes', () => expect(recordatorioDeTurno(30)).toBe('30'))
  it('15 minutos antes', () => expect(recordatorioDeTurno(15)).toBe('15'))
  it('en el solape de 20 gana el de 30', () => expect(recordatorioDeTurno(20)).toBe('30'))
  it('muy lejos no corresponde', () => expect(recordatorioDeTurno(120)).toBeNull())
  it('ya empezo no corresponde', () => expect(recordatorioDeTurno(-5)).toBeNull())
})
