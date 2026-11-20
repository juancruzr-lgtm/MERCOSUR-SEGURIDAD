/**
 * Cola de fotos de punto pendientes de sincronizar (F-10, nov-2026):
 * reintento con backoff, idempotencia por punto y nunca dar el punto por hecho
 * sin confirmación del servidor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/telemetry', () => ({
  track: () => {},
  getCurrentSession: () => null,
  getDeviceContext: () => ({}),
  appVersion: () => 'test',
  obtenerDeviceId: () => null,
}))

let evidenciaExistente: any = null
const rpcLlamadas: string[] = []
vi.mock('@/lib/supabase', () => {
  const builderTabla = () => {
    const b: any = {
      select: () => b, eq: () => b, limit: () => b, abortSignal: () => b,
      maybeSingle: async () => ({ data: evidenciaExistente, error: null, status: 200 }),
    }
    return b
  }
  return {
    supabase: {
      rpc: (nombre: string) => {
        rpcLlamadas.push(nombre)
        return { abortSignal: () => Promise.resolve({ data: null, error: null, status: 200 }) }
      },
      from: () => builderTabla(),
      auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } }, error: null }) },
    },
  }
})

import {
  EDAD_MAXIMA_COLA_MS,
  almacenColaEnMemoria,
  encolarEvidencia,
  entradaEnCola,
  procesarColaEvidencias,
  usarAlmacenCola,
  type EntradaColaEvidencia,
  type ResultadoSincronizacion,
} from '@/lib/rondas-cola-evidencias'
import { almacenEnMemoria, guardarFotoPendiente, usarAlmacenFotos } from '@/lib/pendientes-camara'
import { subirFotoPuntoRonda, sincronizarEvidenciaPendiente } from '@/lib/rondas'
import { errorTransitorioRegistro, registrarConReintentos } from '@/app/api/_lib/registro-evidencia'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const EVIDENCIA = { id: 'ev1', proceso_id: P1, bucket: 'ronda-evidencias', storage_path: `e/${P1}/punto`, created_at: 'x' }

function jpg(n = 1000): File {
  const b = new Uint8Array(n)
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff
  return new File([b], 'punto.jpg', { type: 'image/jpeg' })
}

function respuesta(status: number, body: any) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/** Avanza el reloj falso hasta que la promesa resuelva (hay awaits reales: sha256). */
async function avanzarHasta<T>(p: Promise<T>): Promise<T> {
  let listo = false
  let valor!: T
  void p.then(v => { listo = true; valor = v })
  // Sólo setTimeout es falso: entre pasos se cede un tick REAL para que
  // terminen las operaciones asíncronas reales (sha256, Blob.arrayBuffer).
  for (let i = 0; i < 5000 && !listo; i++) {
    await new Promise<void>(r => setImmediate(r))
    await vi.advanceTimersByTimeAsync(100)
  }
  return valor
}

let almacen: ReturnType<typeof almacenColaEnMemoria>

beforeEach(() => {
  almacen = almacenColaEnMemoria()
  usarAlmacenCola(almacen)
  usarAlmacenFotos(almacenEnMemoria())
  evidenciaExistente = null
  rpcLlamadas.length = 0
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  usarAlmacenCola(null)
  usarAlmacenFotos(undefined)
})

// ─────────────────────────────────────────────────────────────────────────────
describe('cola: estado, idempotencia y backoff', () => {
  it('encolar dos veces el mismo punto deja UNA entrada (clave = ejecucion_punto_id)', () => {
    encolarEvidencia({ ejecucionPuntoId: P1, sha256: 'a' }, 1000)
    encolarEvidencia({ ejecucionPuntoId: P1, sha256: 'a' }, 2000)
    encolarEvidencia({ ejecucionPuntoId: P2, sha256: 'b' }, 3000)
    expect(almacen._datos().filter(e => e.ejecucion_punto_id === P1)).toHaveLength(1)
    expect(almacen._datos()).toHaveLength(2)
    // Misma foto: conserva su antigüedad.
    expect(entradaEnCola(P1)?.creado_ms).toBe(1000)
  })

  it('error transitorio → sigue en cola con backoff creciente; ok → sale', async () => {
    encolarEvidencia({ ejecucionPuntoId: P1, sha256: 'a' }, 0)
    let reloj = 0
    const respuestas: ResultadoSincronizacion<string>[] = [
      { tipo: 'transitorio', error: 'Failed to fetch' },
      { tipo: 'transitorio', error: 'Failed to fetch' },
      { tipo: 'ok', evidencia: 'ev' },
    ]
    const sincronizar = vi.fn(async () => respuestas.shift()!)
    const op = { ahora: () => reloj, azar: () => 1 }

    const r1 = await procesarColaEvidencias(sincronizar, op)
    expect(r1.pendientes).toEqual([P1])
    const e1 = entradaEnCola(P1)!
    expect(e1.intentos).toBe(1)
    expect(e1.proximo_ms).toBe(2000)

    // Antes del vencimiento no se reintenta (no gasta batería ni red).
    reloj = 1500
    await procesarColaEvidencias(sincronizar, op)
    expect(sincronizar).toHaveBeenCalledTimes(1)

    reloj = 2000
    await procesarColaEvidencias(sincronizar, op)
    const e2 = entradaEnCola(P1)!
    expect(e2.intentos).toBe(2)
    expect(e2.proximo_ms - reloj).toBe(4000) // backoff exponencial

    reloj = 6000
    const r3 = await procesarColaEvidencias(sincronizar, op)
    expect(r3.sincronizadas).toEqual([{ ejecucion_punto_id: P1, evidencia: 'ev' }])
    expect(entradaEnCola(P1)).toBeNull()
  })

  it('`forzar` (volvió la red) reintenta aunque no haya vencido el backoff', async () => {
    encolarEvidencia({ ejecucionPuntoId: P1 }, 0)
    almacen.escribir(almacen.leer().map(e => ({ ...e, proximo_ms: 99_999 })))
    const sincronizar = vi.fn(async () => ({ tipo: 'ok', evidencia: 1 }) as const)
    await procesarColaEvidencias(sincronizar, { ahora: () => 10, forzar: true })
    expect(sincronizar).toHaveBeenCalledTimes(1)
  })

  it('rechazo definitivo o entrada vencida (24 h) → se descarta', async () => {
    encolarEvidencia({ ejecucionPuntoId: P1 }, 0)
    encolarEvidencia({ ejecucionPuntoId: P2 }, EDAD_MAXIMA_COLA_MS)
    const sincronizar = vi.fn(async (e: EntradaColaEvidencia) => ({ tipo: 'definitivo', error: `no ${e.ejecucion_punto_id}` }) as const)
    const r = await procesarColaEvidencias(sincronizar, { ahora: () => EDAD_MAXIMA_COLA_MS + 1 })
    expect(r.descartadas.map(d => d.motivo)).toEqual(['vencida', `no ${P2}`])
    expect(sincronizar).toHaveBeenCalledTimes(1) // la vencida ni se intenta
    expect(almacen._datos()).toHaveLength(0)
  })

  it('dos disparos simultáneos (online + visibilidad) comparten UNA pasada', async () => {
    encolarEvidencia({ ejecucionPuntoId: P1 }, 0)
    let soltar!: () => void
    const sincronizar = vi.fn(() => new Promise<ResultadoSincronizacion<number>>(r => { soltar = () => r({ tipo: 'ok', evidencia: 1 }) }))
    const a = procesarColaEvidencias(sincronizar, { ahora: () => 0 })
    const b = procesarColaEvidencias(sincronizar, { ahora: () => 0 })
    await Promise.resolve()
    soltar()
    await Promise.all([a, b])
    expect(sincronizar).toHaveBeenCalledTimes(1)
  })

  it('una excepción en la sincronización no rompe la cola: queda como transitoria', async () => {
    encolarEvidencia({ ejecucionPuntoId: P1 }, 0)
    const r = await procesarColaEvidencias(async () => { throw new Error('boom') }, { ahora: () => 0 })
    expect(r.pendientes).toEqual([P1])
    expect(entradaEnCola(P1)?.ultimo_error).toBe('boom')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('subida de la foto: nunca "hecho" sin confirmación', () => {
  it('registro_pendiente (foto en Storage, fila no) → reintenta SÓLO la vinculación y confirma', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const llamadas: Array<{ vincular: boolean }> = []
    const respuestas = [
      respuesta(503, { error: 'La foto se subió pero no pudo registrarse: TypeError: fetch failed', codigo: 'registro_pendiente' }),
      respuesta(503, { error: 'x', codigo: 'registro_pendiente' }),
      respuesta(200, { evidencia: EVIDENCIA }),
    ]
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => {
      llamadas.push({ vincular: (init.body as FormData).get('soloVincular') === '1' })
      return respuestas.shift()
    }))
    const p = subirFotoPuntoRonda(P1, jpg())
    const r = await avanzarHasta(p)
    expect(r.data?.id).toBe('ev1')
    expect(llamadas).toEqual([{ vincular: false }, { vincular: true }, { vincular: true }])
    expect(entradaEnCola(P1)).toBeNull()
    // Subir la foto no registra el punto: eso es registrar_punto_ronda.
    expect(rpcLlamadas).not.toContain('registrar_punto_ronda')
  })

  it('sin red → error con pendienteSincronizar, queda en cola y el punto NO se registra', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const r = await subirFotoPuntoRonda(P1, jpg())
    expect(r.data).toBeNull()
    expect(r.pendienteSincronizar).toBe(true)
    expect(r.error).toMatch(/conexión/)
    expect(entradaEnCola(P1)?.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(rpcLlamadas).not.toContain('registrar_punto_ronda')
  })

  it('vinculación agotada → pendiente de sincronizar (no se pierde la foto)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(503, { error: 'fetch failed', codigo: 'registro_pendiente' })))
    const p = subirFotoPuntoRonda(P1, jpg())
    const r = await avanzarHasta(p)
    expect(r.pendienteSincronizar).toBe(true)
    expect(r.error).toMatch(/pendiente de sincronizar/)
    expect(entradaEnCola(P1)).not.toBeNull()
  })

  it('rechazo del servidor (4xx) → error normal, NO se encola', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(409, { error: 'El punto ya no está pendiente' })))
    const r = await subirFotoPuntoRonda(P1, jpg())
    expect(r.error).toBe('El punto ya no está pendiente')
    expect(r.pendienteSincronizar).toBeFalsy()
    expect(entradaEnCola(P1)).toBeNull()
  })

  it('en cola con la misma foto → intenta vincular antes de re-subir', async () => {
    const foto = jpg()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await subirFotoPuntoRonda(P1, foto)
    const fetchMock = vi.fn(async (_u: string, _init: any) => respuesta(200, { evidencia: EVIDENCIA }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await subirFotoPuntoRonda(P1, foto)
    expect(r.data?.id).toBe('ev1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0][1].body as FormData).get('soloVincular')).toBe('1')
    expect(entradaEnCola(P1)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('sincronizar una entrada (idempotente)', () => {
  const entrada = (sha: string | null = null): EntradaColaEvidencia => ({
    ejecucion_punto_id: P1, sha256: sha, usuario_id: null, creado_ms: 0, intentos: 0, proximo_ms: 0, ultimo_error: null,
  })

  it('la fila ya existe con la misma huella → ok sin tocar la red', async () => {
    evidenciaExistente = { ...EVIDENCIA, contenido_sha256: 'h1' }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const r = await sincronizarEvidenciaPendiente(entrada('h1'))
    expect(r.tipo).toBe('ok')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('foto_no_encontrada → sube la copia guardada en el teléfono', async () => {
    await guardarFotoPendiente({ flujo: 'ronda', refId: P1, tipo: 'punto', archivo: jpg() })
    const cuerpos: string[] = []
    const respuestas = [
      respuesta(404, { error: 'La foto no está en el servidor', codigo: 'foto_no_encontrada' }),
      respuesta(200, { evidencia: EVIDENCIA }),
    ]
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => {
      const f = init.body as FormData
      cuerpos.push(f.get('soloVincular') === '1' ? 'vincular' : f.get('foto') ? 'foto' : '?')
      return respuestas.shift()
    }))
    const r = await sincronizarEvidenciaPendiente(entrada())
    expect(r.tipo).toBe('ok')
    expect(cuerpos).toEqual(['vincular', 'foto'])
  })

  it('foto_no_encontrada y sin copia local → definitivo (hay que sacarla de nuevo)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(404, { codigo: 'foto_no_encontrada' })))
    const r = await sincronizarEvidenciaPendiente(entrada())
    expect(r.tipo).toBe('definitivo')
  })

  it('punto ya no pendiente (409) → definitivo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(409, { error: 'El punto ya no está pendiente' })))
    const r = await sincronizarEvidenciaPendiente(entrada())
    expect(r).toEqual({ tipo: 'definitivo', error: 'El punto ya no está pendiente' })
  })

  it('sin red → transitorio (sigue en cola)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const r = await sincronizarEvidenciaPendiente(entrada())
    expect(r.tipo).toBe('transitorio')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('servidor: alta de la fila con reintentos', () => {
  it('clasifica fallas transitorias vs rechazos', () => {
    expect(errorTransitorioRegistro('TypeError: fetch failed')).toBe(true)
    expect(errorTransitorioRegistro('connect ECONNRESET')).toBe(true)
    expect(errorTransitorioRegistro('new row violates row-level security policy')).toBe(false)
    expect(errorTransitorioRegistro('El objeto no existe en Storage')).toBe(false)
  })

  it('reintenta ante "fetch failed" y se detiene al primer éxito', async () => {
    const r = [{ error: { message: 'TypeError: fetch failed' } }, { error: null, data: 1 }]
    const fn = vi.fn(async () => r.shift()!)
    const esperas: number[] = []
    const { resultado, intentos } = await registrarConReintentos(fn, [300, 900], async ms => { esperas.push(ms) })
    expect(resultado.error).toBeNull()
    expect(intentos).toBe(2)
    expect(esperas).toEqual([300])
  })

  it('no reintenta un rechazo de la base', async () => {
    const fn = vi.fn(async () => ({ error: { message: 'violates check constraint' } }))
    const { intentos } = await registrarConReintentos(fn, [300, 900], async () => {})
    expect(intentos).toBe(1)
  })
})
