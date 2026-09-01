import { describe, expect, it } from 'vitest'
import {
  estadoSupervisionObjetivo, indexarUltimaSupervision,
} from '@/lib/supervisiones'

// El caso real que motivó estos tests: el panel del tablero decía "6 objetivos
// nunca supervisados" y en la lista aparecía LAROMET FUNES 2, que había sido
// supervisado esa misma mañana. Los nunca supervisados de verdad eran 3.
//
// La causa no estaba acá: `indexarUltimaSupervision` funciona bien. Estaba en
// la CONSULTA que la alimentaba, que pedía las 1.625 supervisiones sin paginar
// y PostgREST devolvía 1.000 sin avisar. Lo que se fija en este archivo es la
// conclusión que se saca de un índice incompleto, para que quede escrito por
// qué la consulta tiene que traer todo.

const iso = (s: string) => new Date(s).toISOString()
const AHORA = new Date('2026-08-31T21:00:00-03:00').getTime()

const objetivo = (horas: number | null = 24) => ({
  id: 'o1', frecuencia_supervision_horas: horas,
})

describe('el índice toma la última, venga en el orden que venga', () => {
  it('con las filas desordenadas se queda con la más reciente', () => {
    const i = indexarUltimaSupervision([
      { objetivo_id: 'o1', created_at: iso('2026-08-10T10:00:00Z') },
      { objetivo_id: 'o1', created_at: iso('2026-08-30T17:43:00Z') },
      { objetivo_id: 'o1', created_at: iso('2026-08-01T08:00:00Z') },
    ])
    expect(i.get('o1')).toBe(iso('2026-08-30T17:43:00Z'))
  })

  it('separa por objetivo', () => {
    const i = indexarUltimaSupervision([
      { objetivo_id: 'o1', created_at: iso('2026-08-30T17:43:00Z') },
      { objetivo_id: 'o2', created_at: iso('2026-08-02T10:00:00Z') },
    ])
    expect(i.size).toBe(2)
    expect(i.get('o2')).toBe(iso('2026-08-02T10:00:00Z'))
  })

  it('descarta filas sin objetivo o sin fecha en vez de romper', () => {
    const i = indexarUltimaSupervision([
      { objetivo_id: null, created_at: iso('2026-08-30T17:43:00Z') },
      { objetivo_id: 'o1', created_at: null },
      { objetivo_id: 'o1', created_at: iso('2026-08-29T12:00:00Z') },
    ])
    expect(i.size).toBe(1)
    expect(i.get('o1')).toBe(iso('2026-08-29T12:00:00Z'))
  })
})

describe('lo que pasa cuando al índice le faltan filas', () => {
  const RECIENTE = iso('2026-08-31T14:29:00Z')

  it('con la supervisión presente, el objetivo está vigente', () => {
    const i = indexarUltimaSupervision([{ objetivo_id: 'o1', created_at: RECIENTE }])
    expect(estadoSupervisionObjetivo(objetivo(), i.get('o1') ?? null, AHORA)).toBe('vigente')
  })

  it('si esa misma fila NO llegó, el objetivo pasa a "nunca"', () => {
    // Exactamente el síntoma que se vio en producción: un objetivo supervisado
    // hoy figurando sin ninguna visita. El dato no estaba mal, estaba ausente.
    const i = indexarUltimaSupervision([])
    expect(estadoSupervisionObjetivo(objetivo(), i.get('o1') ?? null, AHORA)).toBe('nunca')
  })

  it('"nunca" y "vencido" no son lo mismo y no se confunden', () => {
    const viejo = iso('2026-08-01T10:00:00Z')
    expect(estadoSupervisionObjetivo(objetivo(24), viejo, AHORA)).toBe('vencida')
    expect(estadoSupervisionObjetivo(objetivo(24), null, AHORA)).toBe('nunca')
  })
})

describe('los objetivos que se cuentan', () => {
  it('un objetivo con frecuencia nula usa el default y sigue siendo evaluable', () => {
    // No se lo saca de la cuenta por no tener frecuencia configurada: se lo
    // mide con el default. Sacarlo lo volvería invisible.
    expect(estadoSupervisionObjetivo(objetivo(null), null, AHORA)).toBe('nunca')
  })
})
