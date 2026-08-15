import { describe, expect, it } from 'vitest'
import { motivoRondaSinVentanas, ventanasRondaEnTurno } from '@/lib/rondas'

// Espejo de rondas_ventanas_programadas. Los tres primeros casos están
// verificados contra producción el 14/08/2026 llamando a la función SQL: si
// estos tests y la base dejan de coincidir, uno de los dos cambió y hay que
// mirarlo antes de tocar nada.
//
// "Primera ronda" no es una ronda suelta: es el ancla de un ciclo que se repite
// cada `intervalo` mientras el turno siga corriendo.

describe('ventanasRondaEnTurno — casos reales de producción', () => {
  it('NACION SANTA FE · nocturno 19:00–07:00 · primera 23:00 cada 60 min', () => {
    expect(ventanasRondaEnTurno(
      { hora_inicio: '19:00:00', hora_fin: '07:00:00' },
      { hora_inicio: '23:00:00', intervalo_minutos: 60 },
    )).toEqual(['23:00', '00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00'])
  })

  it('CIRSE · nocturno 22:00–06:00 · primera 22:00 cada 120 min', () => {
    expect(ventanasRondaEnTurno(
      { hora_inicio: '22:00:00', hora_fin: '06:00:00' },
      { hora_inicio: '22:00:00', intervalo_minutos: 120 },
    )).toEqual(['22:00', '00:00', '02:00', '04:00'])
  })

  it('SKATEPARK · diurno 15:00–23:00 · primera 15:15 cada 30 min', () => {
    const v = ventanasRondaEnTurno(
      { hora_inicio: '15:00:00', hora_fin: '23:00:00' },
      { hora_inicio: '15:15:00', intervalo_minutos: 30 },
    )
    expect(v).toHaveLength(16)
    expect(v[0]).toBe('15:15')
    expect(v[15]).toBe('22:45')
  })
})

describe('ventanasRondaEnTurno — bordes', () => {
  it('primera hora vacía: el ciclo arranca en el inicio del turno', () => {
    expect(ventanasRondaEnTurno(
      { hora_inicio: '08:00:00', hora_fin: '16:00:00' },
      { hora_inicio: null, intervalo_minutos: 120 },
    )).toEqual(['08:00', '10:00', '12:00', '14:00'])
  })

  it('el fin del turno corta el ciclo: no hay ventana que empiece después', () => {
    // 22:00 sería la novena, pero el turno termina 22:00 en punto.
    expect(ventanasRondaEnTurno(
      { hora_inicio: '14:00:00', hora_fin: '22:00:00' },
      { hora_inicio: '14:00:00', intervalo_minutos: 60 },
    )).toEqual(['14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'])
  })

  it('nocturno 23:00–07:00 con primera 20:00: CERO rondas', () => {
    // La base se empuja al día siguiente (20:00) y ya pasó el fin (07:00).
    // Es el caso que hoy se guarda en silencio y deja el puesto sin rondas.
    expect(ventanasRondaEnTurno(
      { hora_inicio: '23:00:00', hora_fin: '07:00:00' },
      { hora_inicio: '20:00:00', intervalo_minutos: 120 },
    )).toEqual([])
  })

  it('intervalo inválido no genera nada en lugar de colgarse', () => {
    expect(ventanasRondaEnTurno(
      { hora_inicio: '08:00:00', hora_fin: '16:00:00' },
      { hora_inicio: null, intervalo_minutos: 0 },
    )).toEqual([])
  })
})

describe('motivoRondaSinVentanas — la validación que faltaba', () => {
  const nocturno = { hora_inicio: '23:00:00', hora_fin: '07:00:00' }

  it('avisa cuando la configuración no generaría ninguna ronda', () => {
    const motivo = motivoRondaSinVentanas({ hora_inicio: '20:00:00', intervalo_minutos: 120 }, [nocturno])
    expect(motivo).toMatch(/no se generar/i)
    expect(motivo).toContain('20:00')
    expect(motivo).toContain('23:00–07:00')
  })

  it('no molesta cuando la configuración sí genera rondas', () => {
    expect(motivoRondaSinVentanas({ hora_inicio: '23:30:00', intervalo_minutos: 120 }, [nocturno])).toBeNull()
  })

  it('alcanza con que genere en alguno de los turnos del puesto', () => {
    const diurno = { hora_inicio: '08:00:00', hora_fin: '20:00:00' }
    expect(motivoRondaSinVentanas({ hora_inicio: '10:00:00', intervalo_minutos: 120 }, [nocturno, diurno])).toBeNull()
  })

  it('sin turnos de referencia no se afirma nada', () => {
    // Un puesto sin turnos todavía no permite decidir si la hora está mal.
    expect(motivoRondaSinVentanas({ hora_inicio: '20:00:00', intervalo_minutos: 120 }, [])).toBeNull()
  })
})
