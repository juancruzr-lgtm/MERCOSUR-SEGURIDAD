import { describe, expect, it } from 'vitest'
import {
  CALENDARIO_NACIONAL, FERIADOS_NACIONALES, diaDeCalendario,
  esDiaNoLaborableTuristico, esFeriadoNacional, feriadoDeFecha, feriadoDelTurno,
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

// ── Un día no laborable turístico NO es un feriado nacional ─────────────────
//
// La distinción que sostiene el módulo. En un feriado nacional rige el descanso
// dominical; un puente turístico es optativo para el empleador. Contarlos
// juntos inflaría "Feriados cubiertos" con días que no lo son.
//
// Los tres de 2026 salen del decreto del Ejecutivo: 23/03, 10/07 y 07/12.

describe('los días no laborables turísticos no cuentan como feriado', () => {
  const TURISTICOS_2026 = ['2026-03-23', '2026-07-10', '2026-12-07']

  it.each(TURISTICOS_2026)('%s NO es feriado nacional', fecha => {
    expect(esFeriadoNacional(fecha)).toBe(false)
    expect(feriadoDeFecha(fecha)).toBeNull()
    expect(feriadoDelTurno({ fecha })).toBeNull()
  })

  it.each(TURISTICOS_2026)('%s sí está en el calendario, como turístico', fecha => {
    const d = diaDeCalendario(fecha)
    expect(d).not.toBeNull()
    expect(d!.categoria).toBe('dia_no_laborable_turistico')
    expect(esDiaNoLaborableTuristico(fecha)).toBe(true)
  })

  it.each(TURISTICOS_2026)('un turno trabajado el %s no suma al conteo', fecha => {
    expect(cuenta(turno(fecha), 12)).toBe(false)
  })

  it('no aumentan "Feriados nacionales cubiertos"', () => {
    const r = resumirFeriados(TURISTICOS_2026.map(fecha => ({
      fecha, cuenta: cuenta(turno(fecha), 12), horas: 12,
    })))
    expect(r.feriadosCubiertos).toBe(0)
    expect(r.horas).toBe(0)
  })

  it('el feriado vecino de cada turístico SÍ cuenta: no se confunden', () => {
    // 23/03 turístico vs 24/03 Memoria · 10/07 turístico vs 09/07 Independencia
    // · 07/12 turístico vs 08/12 Inmaculada.
    expect(esFeriadoNacional('2026-03-24')).toBe(true)
    expect(esFeriadoNacional('2026-07-09')).toBe(true)
    expect(esFeriadoNacional('2026-12-08')).toBe(true)
  })

  it('ningún turístico se coló en la lista de feriados nacionales', () => {
    const fechas = FERIADOS_NACIONALES.map(f => f.fecha)
    for (const t of TURISTICOS_2026) expect(fechas).not.toContain(t)
    expect(FERIADOS_NACIONALES.every(f => f.categoria === 'feriado_nacional')).toBe(true)
  })

  it('feriadosDelMes tampoco los devuelve', () => {
    expect(feriadosDelMes('2026-03').map(f => f.fecha)).toEqual(['2026-03-24'])
    expect(feriadosDelMes('2026-07').map(f => f.fecha)).toEqual(['2026-07-09'])
    expect(feriadosDelMes('2026-12').map(f => f.fecha)).toEqual(['2026-12-08', '2026-12-25'])
  })
})

// ── El calendario 2026, contrastado con la fuente oficial ───────────────────

describe('el calendario 2026 coincide con el oficial', () => {
  const del2026 = (cat: string) =>
    CALENDARIO_NACIONAL.filter(d => d.fecha.startsWith('2026') && d.categoria === cat)

  it('son 16 feriados nacionales', () => {
    expect(del2026('feriado_nacional')).toHaveLength(16)
  })

  it('son 12 fijos y 4 trasladables', () => {
    const nac = del2026('feriado_nacional')
    expect(nac.filter(f => f.tipo === 'trasladable')).toHaveLength(4)
    expect(nac.filter(f => f.tipo === 'inamovible' || f.tipo === 'movil')).toHaveLength(12)
  })

  it('los cuatro trasladables están en su fecha corrida', () => {
    const t = del2026('feriado_nacional').filter(f => f.tipo === 'trasladable').map(f => f.fecha)
    expect(t).toEqual(['2026-06-15', '2026-08-17', '2026-10-12', '2026-11-23'])
  })

  it('Carnaval son los dos días, lunes y martes', () => {
    const carnaval = CALENDARIO_NACIONAL.filter(d => d.nombre === 'Carnaval')
    expect(carnaval.map(d => d.fecha)).toEqual(['2026-02-16', '2026-02-17'])
  })

  it('son 3 días no laborables turísticos', () => {
    expect(del2026('dia_no_laborable_turistico').map(d => d.fecha))
      .toEqual(['2026-03-23', '2026-07-10', '2026-12-07'])
  })

  it('no hay fechas repetidas entre feriados y no laborables', () => {
    const fechas = CALENDARIO_NACIONAL.map(d => d.fecha)
    expect(new Set(fechas).size).toBe(fechas.length)
  })
})
