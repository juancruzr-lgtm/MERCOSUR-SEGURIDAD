/**
 * Universo de horas reconocidas — Dashboard y Planillas comparten definición.
 *
 * Regresión que cubre: el Dashboard sumaba recorriendo registros de asistencia,
 * así que un turno sin registro no existía y ningún filtro de corte se aplicaba.
 * Planillas recorría turnos y sí filtraba. Con los mismos datos daban totales
 * distintos para la misma pregunta.
 */
import { describe, it, expect, vi } from 'vitest'

// `lib/liquidacion` arrastra `lib/supabase`, que instancia el cliente al
// importarse y necesita un WebSocket global (Node 20 no lo trae). El stub va
// antes de los imports para que el módulo cargue; ningún test usa la red.
vi.hoisted(() => {
  const g = globalThis as unknown as { WebSocket?: unknown }
  if (!g.WebSocket) g.WebSocket = class {}
})

import {
  mejorRegistroPorTurno,
  turnosReconocidosHastaCorte,
  totalHorasLiquidables,
  fechaCorteOperativa,
  type TurnoUniverso,
  type RegistroUniverso,
} from '../lib/liquidacion'

const CORTE = '2026-08-14'
const sinPrueba = () => false

function turno(id: string, fecha: string, extra: Partial<TurnoUniverso> = {}): TurnoUniverso {
  return { id, fecha, hora_inicio: '06:00:00', hora_fin: '18:00:00', estado: 'programado', ...extra }
}

function registro(turno_id: string, extra: Partial<RegistroUniverso> = {}): RegistroUniverso {
  return { id: `r-${turno_id}`, turno_id, ...extra }
}

// Fichaje GPS completo sin corrección → se reconoce la duración programada.
const fichajeCompleto = { hora_entrada_real: '06:00:00', hora_salida_real: '18:00:00' }

function total(turnos: TurnoUniverso[], registros: RegistroUniverso[]): number {
  const porId = new Map(turnos.map(t => [t.id, t]))
  const mejor = mejorRegistroPorTurno(registros, porId, sinPrueba)
  const base = turnosReconocidosHastaCorte(turnos, mejor, { hastaFecha: CORTE, esObjetivoPrueba: sinPrueba })
  return totalHorasLiquidables(base, mejor)
}

describe('universo de horas reconocidas', () => {
  it('reconoce un turno normal con fichaje completo', () => {
    expect(total([turno('t1', '2026-08-10')], [registro('t1', fichajeCompleto)])).toBe(12)
  })

  it('excluye turnos futuros', () => {
    expect(total([turno('t1', '2026-08-20')], [registro('t1', fichajeCompleto)])).toBe(0)
  })

  it('excluye turnos en curso: hay entrada pero no salida', () => {
    expect(total([turno('t1', '2026-08-10')], [registro('t1', { hora_entrada_real: '06:00:00' })])).toBe(0)
  })

  it('excluye estados sin obligación', () => {
    for (const estado of ['reemplazado', 'anulado', 'cancelado']) {
      expect(total([turno('t1', '2026-08-10', { estado })], [registro('t1', fichajeCompleto)])).toBe(0)
    }
  })

  it('un turno sin registro aporta cero, pero no rompe el recorrido', () => {
    const turnos = [turno('t1', '2026-08-10'), turno('t2', '2026-08-11')]
    expect(total(turnos, [registro('t1', fichajeCompleto)])).toBe(12)
  })

  it('no duplica cuando un turno tiene más de un registro', () => {
    const registros = [
      registro('t1', fichajeCompleto),
      { ...registro('t1', fichajeCompleto), id: 'r-t1-b' },
    ]
    expect(total([turno('t1', '2026-08-10')], registros)).toBe(12)
  })

  it('una cobertura anulada no desplaza al fichaje válido', () => {
    const registros = [
      { ...registro('t1', { horas_liquidables: 12 }), id: 'r-anulada', cobertura_anulada_at: '2026-08-10T12:00:00Z' },
      registro('t1', fichajeCompleto),
    ]
    expect(total([turno('t1', '2026-08-10')], registros)).toBe(12)
  })

  it('respeta las horas finales de una regularización', () => {
    const reg = registro('t1', { ...fichajeCompleto, hora_entrada_final: '06:00:00', hora_salida_final: '14:00:00' })
    expect(total([turno('t1', '2026-08-10')], [reg])).toBe(8)
  })

  it('respeta horas_liquidables almacenadas por encima del fichaje', () => {
    const reg = registro('t1', { ...fichajeCompleto, horas_liquidables: 10 })
    expect(total([turno('t1', '2026-08-10')], [reg])).toBe(10)
  })

  it('cuenta el turno nocturno que cruza medianoche por su duración programada', () => {
    const nocturno = turno('t1', '2026-08-10', { hora_inicio: '18:00:00', hora_fin: '06:00:00' })
    const reg = registro('t1', { hora_entrada_real: '18:00:00', hora_salida_real: '06:00:00' })
    expect(total([nocturno], [reg])).toBe(12)
  })

  it('cuenta capacitación: se paga al vigilador', () => {
    const capacitacion = turno('t1', '2026-08-10', { tipo_evento: 'capacitacion' } as Partial<TurnoUniverso>)
    expect(total([capacitacion], [registro('t1', fichajeCompleto)])).toBe(12)
  })

  it('descarta ausencias y objetivos de prueba', () => {
    const t = [turno('t1', '2026-08-10')]
    expect(total(t, [registro('t1', { ...fichajeCompleto, tipo_registro: 'ausencia' })])).toBe(0)

    const porId = new Map(t.map(x => [x.id, x]))
    const esPrueba = () => true
    const mejor = mejorRegistroPorTurno([registro('t1', fichajeCompleto)], porId, esPrueba)
    const base = turnosReconocidosHastaCorte(t, mejor, { hastaFecha: CORTE, esObjetivoPrueba: esPrueba })
    expect(totalHorasLiquidables(base, mejor)).toBe(0)
  })

  it('fechaCorteOperativa devuelve el día en curso en hora Argentina', () => {
    expect(fechaCorteOperativa(new Date('2026-08-15T02:00:00Z'))).toBe('2026-08-14')
    expect(fechaCorteOperativa(new Date('2026-08-15T04:00:00Z'))).toBe('2026-08-15')
  })
})
