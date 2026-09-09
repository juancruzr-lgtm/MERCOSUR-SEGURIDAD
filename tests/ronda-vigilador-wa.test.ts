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

  it('ronda suspendida por el vigilador → jamás se manda (aunque no haya pausa)', () => {
    const c = sel({ suspendidasClaves: new Set(['r1:t1']) })
    expect(c).toHaveLength(0)
    // otra ronda/turno no queda excluida por una suspensión ajena
    expect(sel({ suspendidasClaves: new Set(['otra:t1', 'r1:otro']) })).toHaveLength(1)
  })
})

describe('turno nocturno que cruza medianoche', () => {
  const TURNO_NOC: TurnoVigente = {
    id: 'tn', guardia_id: 'g1', puesto_id: 'p1', objetivo_id: 'o1',
    fecha: '2026-09-09', hora_inicio: '22:00', hora_fin: '06:00',
  }
  const RONDA_NOC: RondaBaseVig = {
    id: 'rn', puesto_id: 'p1', nombre: 'Nocturna', hora_inicio: null, intervalo_minutos: 120,
  }
  const base = {
    turnosVigentes: [TURNO_NOC], rondasBase: [RONDA_NOC], ejecuciones: [], pausas: [],
    objetivos: [OBJ_OK], avisoMin: 10,
  }

  it('la ventana 00:00–02:00 (día siguiente) dispara a las 00:10', () => {
    const c = seleccionarCandidatosRondaVigilador({ ...base, ahoraMin: minutosAbs('2026-09-10', '00:10') })
    expect(c).toHaveLength(1)
    expect(c[0].horario).toBe('00:00')
    expect(c[0].ventana_inicio_min).toBe(minutosAbs('2026-09-10', '00:00'))
  })

  it('la primera ventana 22:00–00:00 dispara a las 22:10 del día del turno', () => {
    const c = seleccionarCandidatosRondaVigilador({ ...base, ahoraMin: minutosAbs('2026-09-09', '22:10') })
    expect(c).toHaveLength(1)
    expect(c[0].horario).toBe('22:00')
  })

  it('pasado el fin del turno (06:00) ya no hay obligación', () => {
    const c = seleccionarCandidatosRondaVigilador({ ...base, ahoraMin: minutosAbs('2026-09-10', '06:30') })
    expect(c).toHaveLength(0)
  })
})

// ── Robustez del disparo respecto del reloj del cron (Issue #5) ──────────────
describe('el cron no corre exacto en el minuto +10', () => {
  // Ventana 06:00–08:00, aviso a +10 (06:10). El cron puede correr tarde: mientras
  // siga DENTRO de la ventana y sin iniciar, el refuerzo debe salir igual.
  it('cron atrasado (06:45, muy pasado el +10 pero en ventana) → sigue disparando', () => {
    const c = sel({ ahoraMin: minutosAbs('2026-09-09', '06:45') })
    expect(c).toHaveLength(1)
    expect(c[0].horario).toBe('06:00')
  })
  it('justo en el borde del cierre (08:00): la de 06:00 cerró y la de 08:00 aún no llegó a +10 → nada', () => {
    // vf es EXCLUSIVO (ahora < vf) y la nueva ventana exige +10: en el minuto
    // exacto del cambio no dispara ninguna. La de 08:00 recién dispara a las 08:10.
    expect(sel({ ahoraMin: minutosAbs('2026-09-09', '08:00') })).toHaveLength(0)
    const c = sel({ ahoraMin: minutosAbs('2026-09-09', '08:10') })
    expect(c).toHaveLength(1)
    expect(c[0].horario).toBe('08:00')
  })
  it('un minuto antes del cierre (07:59) todavía es la ventana de 06:00', () => {
    const c = sel({ ahoraMin: minutosAbs('2026-09-09', '07:59') })
    expect(c).toHaveLength(1)
    expect(c[0].horario).toBe('06:00')
  })
  it('intervalo inválido (0 o negativo) → nunca dispara', () => {
    expect(sel({ rondasBase: [{ ...RONDA, intervalo_minutos: 0 }] })).toHaveLength(0)
    expect(sel({ rondasBase: [{ ...RONDA, intervalo_minutos: -30 }] })).toHaveLength(0)
  })
})

// ── Dedup por ronda + turno + ventana (Issue #4) ─────────────────────────────
describe('deduplicación distingue por turno además de ronda+ventana', () => {
  // Dos turnos distintos, MISMO puesto, MISMA ronda anclada a hora fija: comparten
  // la ventana (misma clave_dedup por ronda+ventana), pero son turnos distintos.
  // La unicidad real del claim es (usuario_id, turno_id, tipo): por eso el
  // candidato lleva turno_id/guardia_id propios y el endpoint reclama por turno,
  // de modo que dos vigiladores distintos del mismo puesto sí reciben cada uno.
  const T1: TurnoVigente = { ...TURNO, id: 't1', guardia_id: 'g1' }
  const T2: TurnoVigente = { ...TURNO, id: 't2', guardia_id: 'g2' }
  it('dos turnos del mismo puesto/ventana → dos candidatos con turno/guardia propios', () => {
    const c = sel({ turnosVigentes: [T1, T2] })
    expect(c).toHaveLength(2)
    const porTurno = Object.fromEntries(c.map(x => [x.turno_id, x]))
    expect(porTurno['t1'].guardia_id).toBe('g1')
    expect(porTurno['t2'].guardia_id).toBe('g2')
    // misma clave_dedup por ronda+ventana (la unicidad la completa turno_id en el claim)
    expect(porTurno['t1'].clave_dedup).toBe(porTurno['t2'].clave_dedup)
  })
})
