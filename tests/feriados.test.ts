import { describe, expect, it } from 'vitest'
import {
  FERIADOS_NACIONALES, esFeriadoNacional, feriadoDeFecha, feriadoDelTurno,
  feriadosDelMes, resumirFeriados, turnoCuentaEnFeriado,
} from '@/lib/feriados'
import { ESTADOS_SIN_OBLIGACION } from '@/lib/revision-operativa'

// El feriado de un turno lo determina su FECHA DE INICIO, igual que el mes
// operativo. El turno entero pertenece a ese día y nunca se parte.

const turno = (fecha: string, estado = 'programado') => ({ fecha, estado })
const cuenta = (t: { fecha: string; estado?: string }, horas: number) =>
  turnoCuentaEnFeriado(t, horas, ESTADOS_SIN_OBLIGACION)

// ── Las fronteras que pidió el negocio ──────────────────────────────────────

describe('el cruce de medianoche no parte el turno', () => {
  it('16/08 19:00 → 17/08 07:00 NO es feriado: arrancó el 16', () => {
    expect(feriadoDelTurno(turno('2026-08-16'))).toBeNull()
    expect(cuenta(turno('2026-08-16'), 12)).toBe(false)
  })

  it('17/08 07:00 → 19:00 SÍ es feriado', () => {
    expect(feriadoDelTurno(turno('2026-08-17'))?.nombre).toContain('San Martín')
    expect(cuenta(turno('2026-08-17'), 12)).toBe(true)
  })

  it('17/08 19:00 → 18/08 07:00 SÍ es feriado, completo', () => {
    // Termina fuera del feriado y da igual: se mira la fecha de inicio.
    expect(cuenta(turno('2026-08-17'), 12)).toBe(true)
  })

  it('18/08 no es feriado aunque el turno anterior haya terminado ese día', () => {
    expect(esFeriadoNacional('2026-08-18')).toBe(false)
    expect(cuenta(turno('2026-08-18'), 12)).toBe(false)
  })
})

describe('un turno que no se prestó no cuenta', () => {
  it('anulado no cuenta, aunque tenga horas', () => {
    expect(cuenta(turno('2026-08-17', 'anulado'), 12)).toBe(false)
  })

  it('cancelado y reemplazado tampoco', () => {
    expect(cuenta(turno('2026-08-17', 'cancelado'), 12)).toBe(false)
    expect(cuenta(turno('2026-08-17', 'reemplazado'), 12)).toBe(false)
  })

  it('ausencia: cero horas reconocidas, no cuenta', () => {
    expect(cuenta(turno('2026-08-17'), 0)).toBe(false)
  })

  it('turno sin registro: cero horas, no cuenta', () => {
    expect(cuenta(turno('2026-08-17'), 0)).toBe(false)
  })

  it('cobertura anulada: la línea da cero y no cuenta', () => {
    expect(cuenta(turno('2026-08-17'), 0)).toBe(false)
  })
})

describe('el reemplazo cuenta para quien efectivamente trabajó', () => {
  it('las horas de la cobertura hacen contar el feriado', () => {
    // El turno queda a nombre de quien lo cubrió: sus horas, su feriado.
    expect(cuenta(turno('2026-08-17'), 8)).toBe(true)
  })

  it('el turno original marcado reemplazado no cuenta dos veces', () => {
    expect(cuenta(turno('2026-08-17', 'reemplazado'), 8)).toBe(false)
  })
})

// ── La fuente de feriados ───────────────────────────────────────────────────

describe('la fuente de feriados es explícita y auditable', () => {
  it('el 17 de agosto de 2026 es feriado nacional', () => {
    const f = feriadoDeFecha('2026-08-17')
    expect(f).not.toBeNull()
    expect(f!.tipo).toBe('trasladable')
  })

  it('agosto de 2026 tiene exactamente un feriado nacional', () => {
    const dias = feriadosDelMes('2026-08')
    expect(dias.map(d => d.fecha)).toEqual(['2026-08-17'])
  })

  it('no hay fechas duplicadas en la tabla', () => {
    const fechas = FERIADOS_NACIONALES.map(f => f.fecha)
    // El carnaval son dos días distintos, no una fecha repetida.
    expect(new Set(fechas).size).toBe(fechas.length)
  })

  it('todas las fechas tienen formato ISO y nombre', () => {
    for (const f of FERIADOS_NACIONALES) {
      expect(f.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(f.nombre.length).toBeGreaterThan(3)
    }
  })

  it('acepta un timestamp y usa sólo la fecha', () => {
    expect(esFeriadoNacional('2026-08-17T23:00:00')).toBe(true)
  })

  it('null, undefined y vacío no rompen', () => {
    expect(esFeriadoNacional(null)).toBe(false)
    expect(esFeriadoNacional(undefined)).toBe(false)
    expect(esFeriadoNacional('')).toBe(false)
    expect(feriadoDelTurno({ fecha: null })).toBeNull()
  })

  it('agosto no está escrito en la lógica: junio también resuelve', () => {
    expect(esFeriadoNacional('2026-06-20')).toBe(true)
    expect(esFeriadoNacional('2026-06-21')).toBe(false)
  })
})

// ── El resumen ──────────────────────────────────────────────────────────────

describe('el resumen cuenta días, no turnos', () => {
  it('dos turnos del mismo feriado son un feriado cubierto', () => {
    const r = resumirFeriados([
      { fecha: '2026-08-17', cuenta: true, horas: 8 },
      { fecha: '2026-08-17', cuenta: true, horas: 12 },
    ])
    expect(r.feriadosCubiertos).toBe(1)
    expect(r.turnos).toBe(2)
    expect(r.horas).toBe(20)
  })

  it('los que no cuentan no suman horas ni días', () => {
    const r = resumirFeriados([
      { fecha: '2026-08-17', cuenta: false, horas: 12 },
      { fecha: '2026-07-09', cuenta: true, horas: 8 },
    ])
    expect(r.feriadosCubiertos).toBe(1)
    expect(r.horas).toBe(8)
    expect(r.fechas).toEqual(['2026-07-09'])
  })

  it('sin jornadas, todo en cero', () => {
    expect(resumirFeriados([])).toEqual({ feriadosCubiertos: 0, horas: 0, turnos: 0, fechas: [] })
  })

  it('las fechas salen ordenadas', () => {
    const r = resumirFeriados([
      { fecha: '2026-12-25', cuenta: true, horas: 8 },
      { fecha: '2026-01-01', cuenta: true, horas: 8 },
    ])
    expect(r.fechas).toEqual(['2026-01-01', '2026-12-25'])
  })

  it('las horas se redondean a dos decimales', () => {
    const r = resumirFeriados([
      { fecha: '2026-08-17', cuenta: true, horas: 7.005 },
      { fecha: '2026-08-17', cuenta: true, horas: 0.005 },
    ])
    expect(r.horas).toBe(7.01)
  })
})
