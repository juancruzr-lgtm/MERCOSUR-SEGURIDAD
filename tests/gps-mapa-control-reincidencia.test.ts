import { beforeEach, describe, expect, it, vi } from 'vitest'

// Página GPS: la racha por reincidencia (ronda_punto_control_gps) NO puede
// fallar en silencio. Antes, un error de esa consulta se ignoraba y la página
// mostraba "ninguno" en todos los puntos, indistinguible de "no hay desvíos".

type Resultado = { data: any; error: { message: string } | null }
const respuestas: Record<string, Resultado> = {}

vi.mock('@/lib/supabase', () => {
  const builder = (tabla: string) => {
    const cadena: any = {}
    for (const m of ['select', 'eq', 'not', 'order', 'limit', 'in']) cadena[m] = () => cadena
    cadena.then = (ok: (r: Resultado) => unknown, mal?: (e: unknown) => unknown) =>
      Promise.resolve(respuestas[tabla] ?? { data: [], error: null }).then(ok, mal)
    return cadena
  }
  return { supabase: { from: (tabla: string) => builder(tabla) } }
})

import {
  cargarPuntosRondaGps,
  estadoControlReincidencia,
  MENSAJE_CONTROL_NO_DISPONIBLE,
  textoIncumplimientos,
} from '@/lib/gps-mapa'
import { fotoControlPedidaEnVisita, fotoEsObligatoria } from '@/lib/rondas'

const PUNTO = { id: 'p1', nombre: 'Portón', latitud: -32, longitud: -60, radio_metros: 50, gps_requerido: true, ronda_base_id: 'rb1' }

beforeEach(() => {
  for (const k of Object.keys(respuestas)) delete respuestas[k]
  respuestas.ronda_puntos = { data: [PUNTO], error: null }
  respuestas.rondas_base = { data: [{ id: 'rb1', nombre: 'Ronda A', objetivo_id: 'o1', puesto_id: null }], error: null }
})

describe('cargarPuntosRondaGps · control por reincidencia', () => {
  it('con la tabla disponible trae la racha y el pedido de foto', async () => {
    respuestas.ronda_punto_control_gps = {
      data: [{ ronda_punto_id: 'p1', incumplimientos_consecutivos: 2, foto_requerida_proxima_visita: true }],
      error: null,
    }
    const r = await cargarPuntosRondaGps(new Map([['o1', 'LA CASONA']]))
    expect(r.error).toBeNull()
    expect(r.controlReincidencia).toEqual({ disponible: true, error: null })
    expect(r.puntos[0].incumplimientosConsecutivos).toBe(2)
    expect(r.puntos[0].fotoControlProximaVisita).toBe(true)
  })

  it('sin fila para el punto la racha es 0 (ninguno), no "no disponible"', async () => {
    respuestas.ronda_punto_control_gps = { data: [], error: null }
    const r = await cargarPuntosRondaGps(new Map())
    expect(r.controlReincidencia.disponible).toBe(true)
    expect(r.puntos[0].incumplimientosConsecutivos).toBe(0)
    expect(textoIncumplimientos(r.puntos[0].incumplimientosConsecutivos)).toBe('ninguno')
  })

  it('si la consulta falla (tabla inexistente) el error queda VISIBLE y la racha en null', async () => {
    respuestas.ronda_punto_control_gps = {
      data: null,
      error: { message: 'relation "public.ronda_punto_control_gps" does not exist' },
    }
    const r = await cargarPuntosRondaGps(new Map())
    // Los puntos se siguen mostrando: el resto de la página no depende del control.
    expect(r.puntos).toHaveLength(1)
    expect(r.error).toBeNull()
    expect(r.controlReincidencia.disponible).toBe(false)
    expect(r.controlReincidencia.error).toContain('does not exist')
    expect(r.puntos[0].incumplimientosConsecutivos).toBeNull()
    expect(r.puntos[0].fotoControlProximaVisita).toBeNull()
    expect(textoIncumplimientos(r.puntos[0].incumplimientosConsecutivos)).toBe(MENSAJE_CONTROL_NO_DISPONIBLE)
  })

  it('un error de permisos tampoco se muestra como cero', async () => {
    respuestas.ronda_punto_control_gps = {
      data: [{ ronda_punto_id: 'p1', incumplimientos_consecutivos: 5, foto_requerida_proxima_visita: true }],
      error: { message: 'permission denied for table ronda_punto_control_gps' },
    }
    const r = await cargarPuntosRondaGps(new Map())
    expect(r.controlReincidencia.disponible).toBe(false)
    expect(r.puntos[0].incumplimientosConsecutivos).toBeNull()
  })
})

describe('estadoControlReincidencia / textoIncumplimientos', () => {
  it('traduce el resultado de PostgREST', () => {
    expect(estadoControlReincidencia({ error: null })).toEqual({ disponible: true, error: null })
    expect(estadoControlReincidencia(undefined)).toEqual({ disponible: true, error: null })
    expect(estadoControlReincidencia({ error: { message: '' } })).toEqual({ disponible: false, error: 'Error desconocido' })
  })

  it('el texto distingue "ninguno" de "no disponible"', () => {
    expect(MENSAJE_CONTROL_NO_DISPONIBLE).toBe('Control por reincidencia no disponible')
    expect(textoIncumplimientos(3)).toBe('3')
    expect(textoIncumplimientos(0)).toBe('ninguno')
    expect(textoIncumplimientos(null)).toBe(MENSAJE_CONTROL_NO_DISPONIBLE)
  })
})

describe('app del vigilador · la foto de control se pide, no traba', () => {
  it('se pide sólo si el snapshot la trae y el QR no está verificado', () => {
    expect(fotoControlPedidaEnVisita(true, false)).toBe(true)
    expect(fotoControlPedidaEnVisita(true, true)).toBe(false)
    expect(fotoControlPedidaEnVisita(false, false)).toBe(false)
  })

  it('la foto que bloquea sigue siendo sólo la política manual del punto', () => {
    expect(fotoEsObligatoria('opcional', false)).toBe(false)
    expect(fotoEsObligatoria('obligatoria', false)).toBe(true)
    expect(fotoEsObligatoria('solo_novedad', true)).toBe(true)
  })
})
