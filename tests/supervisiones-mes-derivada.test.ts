import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { supervisionesMesDesdeDetalle } from '@/lib/supervisiones-periodo'

// El panel admin pedía dos veces la tabla supervisiones: el detalle (mes
// anterior + actual) y, aparte, el mes actual con 5 columnas para el ranking.
// La segunda es un subconjunto exacto de la primera: se deriva en el cliente.

const DESDE = '2026-11-01T03:00:00.000Z'   // 01/11 00:00 ART
const HASTA = '2026-12-01T03:00:00.000Z'   // 01/12 00:00 ART

const det = (id: string, created_at: string | null, extra: Record<string, unknown> = {}) => ({
  id, objetivo_id: `o-${id}`, supervisor_id: 's1', estado: 'completa', created_at,
  objetivo: { nombre: 'X' }, respuestas: [{ resultado: 'observado' }], fotos: [], ...extra,
})

describe('supervisionesMesDesdeDetalle', () => {
  it('se queda con las del mes argentino, en el mismo orden y sólo con las 5 columnas', () => {
    const detalle = [
      det('a', '2026-11-30T23:00:00+00:00'),   // 30/11 20:00 ART — noviembre
      det('b', '2026-11-01T03:00:00+00:00'),   // borde exacto: entra
      det('c', '2026-11-01T02:59:59+00:00'),   // 31/10 23:59 ART — octubre
      det('d', '2026-10-15T12:00:00+00:00'),
      det('e', null),
    ]
    expect(supervisionesMesDesdeDetalle(detalle, DESDE, HASTA)).toEqual([
      { id: 'a', objetivo_id: 'o-a', supervisor_id: 's1', estado: 'completa', created_at: '2026-11-30T23:00:00+00:00' },
      { id: 'b', objetivo_id: 'o-b', supervisor_id: 's1', estado: 'completa', created_at: '2026-11-01T03:00:00+00:00' },
    ])
  })

  it('el límite superior es exclusivo y compara instantes, no texto', () => {
    const detalle = [
      det('x', '2026-12-01T03:00:00+00:00'),
      det('y', '2026-12-01T02:59:59.999+00:00'),
    ]
    expect(supervisionesMesDesdeDetalle(detalle, DESDE, HASTA).map(s => s.id)).toEqual(['y'])
  })

  it('incluye visitas sin ítems observados (el filtro del detalle es del embed)', () => {
    const detalle = [det('z', '2026-11-10T12:00:00Z', { respuestas: [] })]
    expect(supervisionesMesDesdeDetalle(detalle, DESDE, HASTA)).toHaveLength(1)
  })
})

describe('panel admin: una sola consulta de supervisiones del mes', () => {
  it('el loader deriva sm del detalle y sólo consulta aparte si el detalle falló', () => {
    const fuente = readFileSync(join(process.cwd(), 'app/dashboard/AppClient.tsx'), 'utf8')
    const ini = fuente.indexOf('const [g, o, t, r, n, cp, ci, s, su, z, sz] = await Promise.all([')
    expect(ini).toBeGreaterThan(0)
    const bloque = fuente.slice(ini, fuente.indexOf('setAdminDataLoaded(true)', ini))
    expect(bloque).toContain('supervisionesMesDesdeDetalle(s.data as SupervisionAdmin[], inicioMes, inicioMesSiguiente)')
    expect(bloque).toMatch(/!s\.error\s*\n?\s*\?/)
  })
})
