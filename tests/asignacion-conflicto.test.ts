import { describe, expect, it } from 'vitest'
import {
  mensajeConflictoAsignacion,
  normalizarFilasAsignacion,
  resultadoAsignacionCelda,
} from '@/lib/asignacion-mensual'

// El conflicto lo detecta y lo arma asignar_vigilador_turnos en Postgres. Acá
// solo se prueba la redacción y la lectura del resultado: no hay una segunda
// detección de superposiciones que testear.

const completo = {
  vigilador: 'ALVAREZ, YAMIL',
  objetivo: 'Laromet ruta 34',
  puesto: 'Vigilador 2',
  fecha: '2026-08-12',
  horaInicio: '17:00',
  horaFin: '07:00',
}

describe('mensajeConflictoAsignacion', () => {
  it('arma el mensaje completo', () => {
    expect(mensajeConflictoAsignacion(completo)).toBe(
      'No se puede asignar a ALVAREZ, YAMIL. Ya tiene un turno de 17:00 a 07:00 en Laromet ruta 34 (Vigilador 2) el 12/08.',
    )
  })

  it('sin puesto no deja paréntesis vacíos', () => {
    expect(mensajeConflictoAsignacion({ ...completo, puesto: null })).toBe(
      'No se puede asignar a ALVAREZ, YAMIL. Ya tiene un turno de 17:00 a 07:00 en Laromet ruta 34 el 12/08.',
    )
  })

  it('sin fecha no deja un "el" colgando', () => {
    expect(mensajeConflictoAsignacion({ ...completo, fecha: null }))
      .toBe('No se puede asignar a ALVAREZ, YAMIL. Ya tiene un turno de 17:00 a 07:00 en Laromet ruta 34 (Vigilador 2).')
  })

  it('sin vigilador sigue siendo una frase válida', () => {
    expect(mensajeConflictoAsignacion({ ...completo, vigilador: null }))
      .toMatch(/^No se puede asignar\. Ya tiene un turno/)
  })

  it('conserva el formato de 24 horas del turno nocturno', () => {
    expect(mensajeConflictoAsignacion(completo)).toContain('de 17:00 a 07:00')
  })
})

describe('resultadoAsignacionCelda', () => {
  it('asignada es éxito', () => {
    expect(resultadoAsignacionCelda([{ turnoId: 't1', resultado: 'asignada' }]))
      .toEqual({ ok: true, error: null })
  })

  it('ya_asignada también: el reintento llegó al mismo estado buscado', () => {
    expect(resultadoAsignacionCelda([{ turnoId: 't1', resultado: 'ya_asignada' }]))
      .toEqual({ ok: true, error: null })
  })

  it('omitida con conflicto explica cuál es el turno que choca', () => {
    const r = resultadoAsignacionCelda([
      { turnoId: 't1', resultado: 'omitida', motivo: 'x', conflicto: completo },
    ])
    expect(r.ok).toBe(false)
    expect(r.error).toContain('Laromet ruta 34')
  })

  it('omitida sin conflicto cae en el motivo del servidor', () => {
    const r = resultadoAsignacionCelda([
      { turnoId: 't1', resultado: 'omitida', motivo: 'Posicion operativa inactiva' },
    ])
    expect(r).toEqual({ ok: false, error: 'Posicion operativa inactiva' })
  })

  it('sin filas no se toma como éxito: antes cerraba el modal sin asignar', () => {
    expect(resultadoAsignacionCelda([]).ok).toBe(false)
    expect(resultadoAsignacionCelda(null).ok).toBe(false)
  })
})

describe('normalizarFilasAsignacion', () => {
  it('traduce snake_case de la RPC', () => {
    const filas = normalizarFilasAsignacion([{
      turno_id: 't1', resultado: 'omitida', motivo: 'm',
      conflicto: {
        turno_id: 't2', vigilador: 'A, B', objetivo: 'O', puesto: 'P',
        fecha: '2026-08-12', hora_inicio: '17:00', hora_fin: '07:00',
      },
    }])
    expect(filas[0].turnoId).toBe('t1')
    expect(filas[0].conflicto?.horaInicio).toBe('17:00')
    expect(filas[0].conflicto?.objetivo).toBe('O')
  })

  it('conflicto ausente queda en null', () => {
    expect(normalizarFilasAsignacion([{ turno_id: 't1', resultado: 'asignada' }])[0].conflicto).toBeNull()
  })

  it('entrada no-array no rompe', () => {
    expect(normalizarFilasAsignacion(null)).toEqual([])
  })
})
