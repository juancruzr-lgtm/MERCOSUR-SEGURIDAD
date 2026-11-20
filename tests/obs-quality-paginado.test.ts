import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// /api/obs/quality leía 30 días de turnos sin paginar: PostgREST corta en
// 1000 filas sin error, y el chequeo "Turnos sin guardia" miraba sólo una
// parte. Lo mismo con registros y evidencias (.limit(5000) no pasa de 1000,
// así que `analisis_parcial` nunca se encendía). El cliente falso imita al
// servidor: nunca devuelve más de 1000 filas por pedido.

const TOPE = 1000
const filas: Record<string, any[]> = {
  usuarios: [], objetivos: [], supervisiones: [], novedades: [], puestos: [],
  // 1.200 turnos de los últimos días; los 150 últimos sin guardia.
  turnos: Array.from({ length: 1200 }, (_, i) => ({
    id: `t-${String(i).padStart(5, '0')}`, guardia_id: i >= 1050 ? null : 'g1', objetivo_id: 'o1',
    fecha: new Date().toISOString().slice(0, 10), hora_inicio: '08:00', hora_fin: '16:00', estado: 'programado',
  })),
  registros_asistencia: Array.from({ length: 6000 }, (_, i) => ({ id: `r-${i}`, turno_id: 't-1', hora_entrada_real: null })),
  evidencias: Array.from({ length: 2500 }, (_, i) => ({ id: `e-${i}`, proceso_id: 'x', tipo_evidencia: 'foto_entrada' })),
}
const pedidos: Array<{ tabla: string; rango: [number, number] | null }> = []

function builder(tabla: string) {
  const datos = filas[tabla] ?? []
  const p = { tabla, rango: null as [number, number] | null }
  const b: any = {
    select: () => b, gte: () => b, lte: () => b, order: () => b, limit: () => b,
    range: (d: number, h: number) => {
      p.rango = [d, h]; pedidos.push(p)
      return Promise.resolve({ data: datos.slice(d, Math.min(h, d + TOPE - 1) + 1), error: null })
    },
    then: (ok: any, ko: any) => { pedidos.push(p); return Promise.resolve({ data: datos.slice(0, TOPE), error: null }).then(ok, ko) },
  }
  return b
}

vi.mock('@/app/api/_lib/obs-auth', () => ({
  isObsAuthErr: () => false,
  requireAdmin: async () => ({ client: { from: (t: string) => builder(t) }, userId: 'u1' }),
}))

describe('GET /api/obs/quality — paginado', () => {
  it('cuenta los 150 turnos sin guardia aunque la ventana pase de 1000 filas', async () => {
    const { GET } = await import('@/app/api/obs/quality/route')
    const res = await GET(new NextRequest('http://localhost/api/obs/quality'))
    const cuerpo = await res.json()
    const sinGuardia = cuerpo.checks.find((c: any) => c.nombre.startsWith('Turnos sin guardia'))
    expect(sinGuardia.cantidad).toBe(150)

    const rangosTurnos = pedidos.filter(p => p.tabla === 'turnos').map(p => p.rango)
    expect(rangosTurnos).toEqual([[0, 999], [1000, 1999]])

    // Registros: hasta el techo de 5000 (5 páginas) y se avisa análisis parcial.
    expect(pedidos.filter(p => p.tabla === 'registros_asistencia')).toHaveLength(5)
    expect(cuerpo.analisis_parcial).toBe(true)
    expect(cuerpo.analisis_parcial_detalle).toEqual(['registros_asistencia limitado a 5000'])
    // Evidencias: 2.500 < techo, se traen todas en 3 páginas.
    expect(pedidos.filter(p => p.tabla === 'evidencias').map(p => p.rango)).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })
})
