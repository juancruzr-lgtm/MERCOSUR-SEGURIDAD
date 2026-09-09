import { describe, expect, it } from 'vitest'
import {
  seleccionarCandidatosRondaVigilador, minutosAbs, horaDeMinutosAbs, claveDedupRondaVig,
} from '@/lib/ronda-vigilador-wa'
import type { TurnoVigente, RondaBaseVig, ObjetivoVig } from '@/lib/ronda-vigilador-wa'

// Turno diurno 06:00–18:00, una ronda cada 120 min anclada a las 06:00.
// Ventanas: 06:00–08:00, 08:00–10:00, …
const TURNO: TurnoVigente = {
  id: 't1', guardia_id: 'g1', puesto_id: 'p1', objetivo_id: 'o1',
  fecha: '2026-09-09', hora_inicio: '06:00', hora_fin: '18:00',
}
const RONDA: RondaBaseVig = {
  id: 'r1', puesto_id: 'p1', nombre: 'Ronda perimetral', hora_inicio: '06:00', intervalo_minutos: 120,
}
const OBJ_OK: ObjetivoVig = { id: 'o1', nombre: 'DEPÓSITO', estado: 'activo', es_prueba: false }

const sel = (over: Partial<Parameters<typeof seleccionarCandidatosRondaVigilador>[0]>) =>
  seleccionarCandidatosRondaVigilador({
    ahoraMin: minutosAbs('2026-09-09', '06:10'),
    turnosVigentes: [TURNO], rondasBase: [RONDA], ejecuciones: [], pausas: [],
    objetivos: [OBJ_OK], avisoMin: 10, ...over,
  })

describe('selección del WhatsApp de refuerzo al vigilador', () => {
  it('a los +10 min sin iniciar → candidata', () => {
    const c = sel({})
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ turno_id: 't1', guardia_id: 'g1', ronda_base_id: 'r1', horario: '06:00' })
    expect(c[0].ventana_inicio_min).toBe(minutosAbs('2026-09-09', '06:00'))
  })

  it('antes de los +10 → nada', () => {
    expect(sel({ ahoraMin: minutosAbs('2026-09-09', '06:05') })).toHaveLength(0)
  })

  it('la ventana siguiente también dispara, en su horario', () => {
    const c = sel({ ahoraMin: minutosAbs('2026-09-09', '08:10') })
    expect(c).toHaveLength(1)
    expect(c[0].horario).toBe('08:00')
  })

  it('si ya inició la ronda de esa ventana → nada', () => {
    const c = sel({ ejecuciones: [{ ronda_base_id: 'r1', turno_id: 't1', iniciadaMin: minutosAbs('2026-09-09', '06:05') }] })
    expect(c).toHaveLength(0)
  })

  it('pausa que cubre el inicio de la ventana → nada', () => {
    const c = sel({ pausas: [{ ronda_base_id: 'r1', desdeMin: minutosAbs('2026-09-09', '05:00'), hastaMin: minutosAbs('2026-09-09', '12:00') }] })
    expect(c).toHaveLength(0)
  })

  it('objetivo de prueba o inactivo → nada', () => {
    expect(sel({ objetivos: [{ ...OBJ_OK, es_prueba: true }] })).toHaveLength(0)
    expect(sel({ objetivos: [{ ...OBJ_OK, estado: 'inactivo' }] })).toHaveLength(0)
  })

  it('no exige una ventana anterior a la creación de la ronda', () => {
    const c = sel({ rondaCreadaMin: { r1: minutosAbs('2026-09-09', '07:00') } })
    expect(c).toHaveLength(0) // la ventana de las 06:00 es anterior a la creación
  })

  it('sin teléfono no se decide acá: la selección es pura, el teléfono lo filtra el endpoint', () => {
    // (documental) la selección no mira teléfono; devuelve el candidato igual.
    expect(sel({}).length).toBe(1)
  })

  it('la clave de dedup liga ronda + ventana concreta', () => {
    const vi = minutosAbs('2026-09-09', '06:00')
    expect(claveDedupRondaVig('r1', vi)).toBe(`wa_ronda_pendiente:r1:${vi}`)
    expect(claveDedupRondaVig('r1', vi)).not.toBe(claveDedupRondaVig('r1', vi + 120))
  })

  it('horaDeMinutosAbs devuelve HH:MM', () => {
    expect(horaDeMinutosAbs(minutosAbs('2026-09-09', '06:00'))).toBe('06:00')
    expect(horaDeMinutosAbs(minutosAbs('2026-09-09', '23:45'))).toBe('23:45')
  })
})
