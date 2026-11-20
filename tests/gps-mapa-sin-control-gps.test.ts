// F-16: la Página GPS no pide `ronda_punto_control_gps` (tabla de la migración 20260802, no aplicada
// en producción → 404 en cada apertura). Depende del PR #372; mientras tanto, 0 incumplimientos.
import { describe, expect, it, vi } from 'vitest'

const tablas = vi.hoisted(() => [] as string[])
vi.mock('@/lib/supabase', () => {
  const datos: Record<string, any[]> = {
    ronda_puntos: [{ id: 'p1', nombre: 'Portón', latitud: -34.6, longitud: -58.4, radio_metros: 30, gps_requerido: true, ronda_base_id: 'r1' }],
    rondas_base: [{ id: 'r1', nombre: 'Ronda 1', objetivo_id: 'o1', puesto_id: null }],
  }
  const consulta = (tabla: string): any => {
    const q: any = new Proxy({}, {
      get: (_t, prop) => prop === 'then'
        ? (ok: any) => ok({ data: datos[tabla] ?? [], error: null })
        : () => q,
    })
    return q
  }
  return { supabase: { from: (t: string) => { tablas.push(t); return consulta(t) } } }
})

describe('Página GPS sin ronda_punto_control_gps', () => {
  it('no consulta la tabla inexistente y deja los puntos con 0 incumplimientos', async () => {
    const { cargarPuntosRondaGps, CONTROL_GPS_DISPONIBLE } = await import('@/lib/gps-mapa')
    expect(CONTROL_GPS_DISPONIBLE).toBe(false)
    const r = await cargarPuntosRondaGps(new Map([['o1', 'Objetivo']]))
    expect(r.error).toBeNull()
    expect(r.puntos).toHaveLength(1)
    expect(r.puntos[0].incumplimientosConsecutivos).toBe(0)
    expect(r.puntos[0].fotoControlProximaVisita).toBe(false)
    expect(tablas).toContain('ronda_punto_diagnosticos_gps')
    expect(tablas).not.toContain('ronda_punto_control_gps')
  })
})
