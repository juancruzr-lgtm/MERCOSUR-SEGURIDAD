import { describe, expect, it } from 'vitest'
import { derivarEstadoObjetivo } from '@/lib/legajo-objetivo'
import type { TurnoLegajo } from '@/lib/legajo-objetivo'

// La ficha del objetivo lista en «Requiere intervención» los mismos turnos
// descubiertos que ponen el semáforo en crítico: una sola definición.
const turno = (id: string, extra: Partial<TurnoLegajo> = {}): TurnoLegajo => ({
  id, objetivo_id: 'o1', puesto_id: 'p1', guardia_id: 'g1', guardia_original_id: null,
  fecha: '2026-10-15', hora_inicio: '06:00:00', hora_fin: '18:00:00', estado: 'programado',
  ...extra,
} as TurnoLegajo)

describe('derivarEstadoObjetivo — turnos descubiertos', () => {
  const ahora = new Date(2026, 9, 15, 10, 0)

  it('sin vigilador o marcado descubierto → turnosDescubiertos y semáforo crítico', () => {
    const e = derivarEstadoObjetivo([
      turno('a'),
      turno('b', { guardia_id: null }),
      turno('c', { estado: 'descubierto' }),
    ], [], [], ahora)
    expect(e.turnosDescubiertos.map(t => t.id)).toEqual(['b', 'c'])
    expect(e.semaforo).toBe('critico')
  })

  it('todo cubierto → lista vacía y el semáforo no queda en crítico por eso', () => {
    const e = derivarEstadoObjetivo([turno('a')], [], [], ahora)
    expect(e.turnosDescubiertos).toEqual([])
    expect(e.semaforo).not.toBe('critico')
  })
})
