import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ESTADOS_TURNO_SIN_PERSONA, esMomentoDeEnviar, fechaAnterior, personasEnTurno,
} from '@/lib/entrenador-operativo'
import type { TurnoEnCurso } from '@/lib/entrenador-operativo'

// El entrenador no le escribe a quien está de guardia. Lo que se prueba: quién
// cuenta como «en turno» a la hora del envío (lunes 10:00 por defecto).

const HOY = '2026-11-09' // lunes
const AYER = '2026-11-08'

const t = (o: Partial<TurnoEnCurso>): TurnoEnCurso => ({
  guardia_id: 'g1', fecha: HOY, hora_inicio: '07:00:00', hora_fin: '19:00:00', estado: 'programado', ...o,
})

describe('fechaAnterior', () => {
  it('resta un día, también entre meses y años', () => {
    expect(fechaAnterior('2026-11-09')).toBe('2026-11-08')
    expect(fechaAnterior('2026-11-01')).toBe('2026-10-31')
    expect(fechaAnterior('2027-01-01')).toBe('2026-12-31')
    expect(fechaAnterior('2028-03-01')).toBe('2028-02-29')
  })
})

describe('personasEnTurno', () => {
  it('turno de día de hoy: dentro entre inicio y fin, fuera en el borde final', () => {
    expect(personasEnTurno([t({})], HOY, '10:00').has('g1')).toBe(true)
    expect(personasEnTurno([t({})], HOY, '07:00').has('g1')).toBe(true)
    expect(personasEnTurno([t({})], HOY, '19:00').has('g1')).toBe(false)
    expect(personasEnTurno([t({})], HOY, '06:59').has('g1')).toBe(false)
  })

  it("un turno 'cubierto' cuenta como trabajando (antes se ignoraba)", () => {
    expect(personasEnTurno([t({ estado: 'cubierto' })], HOY, '10:00').has('g1')).toBe(true)
  })

  it('estado desconocido o NULL: ante la duda, trabajando', () => {
    expect(personasEnTurno([t({ estado: null })], HOY, '10:00').has('g1')).toBe(true)
    expect(personasEnTurno([t({ estado: 'confirmado' })], HOY, '10:00').has('g1')).toBe(true)
  })

  it('anulado, reemplazado, cancelado o descubierto: la persona no está en el puesto', () => {
    for (const estado of Array.from(ESTADOS_TURNO_SIN_PERSONA)) {
      expect(personasEnTurno([t({ estado })], HOY, '10:00').size).toBe(0)
    }
  })

  it('nocturno que empezó AYER sigue en curso hoy hasta su fin (antes no se miraba)', () => {
    const noche = t({ fecha: AYER, hora_inicio: '22:00', hora_fin: '06:00' })
    expect(personasEnTurno([noche], HOY, '05:59').has('g1')).toBe(true)
    expect(personasEnTurno([noche], HOY, '06:00').has('g1')).toBe(false)
    expect(personasEnTurno([noche], HOY, '10:00').has('g1')).toBe(false)
  })

  it('turno de 24 h de ayer 07 a 07: en curso hasta las 07 de hoy', () => {
    const h24 = t({ fecha: AYER, hora_inicio: '07:00', hora_fin: '07:00' })
    expect(personasEnTurno([h24], HOY, '06:30').has('g1')).toBe(true)
    expect(personasEnTurno([h24], HOY, '07:00').has('g1')).toBe(false)
  })

  it('turno de 12 h de ayer 22 a 10: el lunes a las 10:00 ya terminó, a las 09:59 no', () => {
    const largo = t({ fecha: AYER, hora_inicio: '22:00', hora_fin: '10:00' })
    expect(personasEnTurno([largo], HOY, '09:59').has('g1')).toBe(true)
    expect(personasEnTurno([largo], HOY, '10:00').has('g1')).toBe(false)
  })

  it('nocturno de HOY: en curso desde su inicio, no antes', () => {
    const noche = t({ hora_inicio: '22:00', hora_fin: '06:00' })
    expect(personasEnTurno([noche], HOY, '23:00').has('g1')).toBe(true)
    expect(personasEnTurno([noche], HOY, '10:00').has('g1')).toBe(false)
  })

  it('un turno de día de ayer no cuenta hoy', () => {
    expect(personasEnTurno([t({ fecha: AYER })], HOY, '10:00').size).toBe(0)
  })

  it('turnos de otras fechas, sin guardia o sin horas: se ignoran', () => {
    expect(personasEnTurno([
      t({ fecha: '2026-11-07', hora_inicio: '22:00', hora_fin: '12:00' }),
      t({ guardia_id: null }),
      t({ hora_inicio: null }),
    ], HOY, '10:00').size).toBe(0)
  })

  it('varias personas: devuelve sólo las que están dentro', () => {
    const r = personasEnTurno([
      t({ guardia_id: 'a' }),
      t({ guardia_id: 'b', hora_inicio: '14:00', hora_fin: '22:00' }),
      t({ guardia_id: 'c', fecha: AYER, hora_inicio: '19:00', hora_fin: '11:00', estado: 'cubierto' }),
    ], HOY, '10:15')
    expect(Array.from(r).sort()).toEqual(['a', 'c'])
  })

  it('con esMomentoDeEnviar: quien está en turno el lunes 10:00 no recibe', () => {
    const trabajando = personasEnTurno([t({ estado: 'cubierto' })], HOY, '10:05').has('g1')
    expect(esMomentoDeEnviar({ diaSemana: 1, horaLocal: '10:05', trabajando })).toBe(false)
    expect(esMomentoDeEnviar({ diaSemana: 1, horaLocal: '10:05', trabajando: false })).toBe(true)
  })
})

describe('ruta /api/push/entrenamiento-operativo', () => {
  const ruta = readFileSync('app/api/push/entrenamiento-operativo/route.ts', 'utf8')

  it('consulta los turnos de hoy y de ayer, sin filtrar por programado', () => {
    expect(ruta).toContain(".in('fecha', [fechaAnterior(local.fecha), local.fecha])")
    expect(ruta).not.toMatch(/\.eq\('estado', 'programado'\)/)
    expect(ruta).toContain('personasEnTurno(')
  })

  it('el cron se autentica con push_cron_secret (en minúsculas)', () => {
    expect(ruta).toContain('process.env.push_cron_secret')
  })
})
