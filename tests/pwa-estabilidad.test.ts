/**
 * Estabilidad de la PWA (auditoría oct-2026): cámara, mala conexión,
 * visibilidad, Service Worker, GPS del supervisor y compresión.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

const RAIZ = join(__dirname, '..')
const leer = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

// ── Telemetría y Supabase simulados (lib/rondas los usa) ─────────────────────
const eventos: Array<{ nombre: string; payload: any }> = []
vi.mock('@/lib/telemetry', () => ({
  track: (nombre: string, payload: any) => { eventos.push({ nombre, payload }) },
  getCurrentSession: () => null,
  getDeviceContext: () => ({}),
  appVersion: () => 'test',
  obtenerDeviceId: () => null,
}))

const rpcRespuestas: Array<any> = []
const rpcLlamadas: string[] = []
let evidenciaExistente: any = null
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
        const r = rpcRespuestas.shift() ?? { data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 }
        return { abortSignal: () => Promise.resolve(r) }
      },
      from: () => builderTabla(),
      auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } }, error: null }) },
    },
  }
})

import {
  EDAD_MAXIMA_PENDIENTE_MS, MAX_BYTES_PENDIENTES, MAX_FOTOS_PENDIENTES,
  almacenEnMemoria, borrarFlujo, borrarFotosDe, guardarFlujo, guardarFotoPendiente, leerFlujo,
  leerFotoPendiente, listarFotosPendientes, planPurga, purgarFotosPendientes, usarAlmacenFotos,
  CLAVE_RONDA_EN_CURSO,
} from '@/lib/pendientes-camara'
import {
  MAX_EVENTOS_RED_POR_SESION, crearLimitador, esFallaDeRed, esperaBackoff, registrarErrorRed,
  reintentar, senalConTimeout, sha256Hex,
} from '@/lib/red-resiliente'
import { registrarPuntoRonda, subirFotoPuntoRonda, MENSAJE_SIN_RED_RONDA } from '@/lib/rondas'
import { restauracionPunto } from '@/components/rondas/RondaGuardiaEjecucion'
import { crearDisparadorPrimerPlano, debeRecargarPorPrimerPlano } from '@/lib/refresco-movil'
import {
  estadoInicial, procesarLectura, trasRecuperacion, type EstadoMaquina, type Lectura,
} from '@/lib/supervisor-gps-maquina'
import { LADO_MINIMO_LEGIBLE, PERFIL_RESCATE, PERFILES_FOTO, prepararFotoOperativa } from '@/lib/comprimir-imagen'

// Storage del navegador simulado.
function storageFalso(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)) }, removeItem: k => { m.delete(k) },
    clear: () => m.clear(), key: i => Array.from(m.keys())[i] ?? null, get length() { return m.size },
  } as Storage
}

const jpg = (bytes: number, nombre = 'foto.jpg') =>
  new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(Math.max(0, bytes - 4)).fill(7)])], nombre, { type: 'image/jpeg' })

// ═════════════════════════════════════════════════════════════════════════════
describe('recuperación después de abrir la cámara', () => {
  beforeEach(() => {
    ;(globalThis as any).sessionStorage = storageFalso()
    ;(globalThis as any).localStorage = storageFalso()
    usarAlmacenFotos(almacenEnMemoria())
  })
  afterEach(() => usarAlmacenFotos(undefined))

  it('fichaje: el intento y la foto del libro sobreviven a que el sistema mate la pestaña', async () => {
    // 1. Antes de abrir la cámara del uniforme: intento guardado y foto del libro pendiente.
    guardarFlujo('mercosur_ingreso_pendiente', { turno_id: 't1', guardia_id: 'g1', gps: { latitude: 1 }, timestamp: 1, intento_id: 'i1' })
    expect(await guardarFotoPendiente({ flujo: 'ingreso', refId: 't1', tipo: 'libro', usuarioId: 'g1', archivo: jpg(300_000, 'libro.jpg') })).toBe(true)

    // 2. El sistema mata el proceso: sessionStorage se pierde; localStorage e IndexedDB no.
    ;(globalThis as any).sessionStorage = storageFalso()

    // 3. Arranque en frío: se restauran intento y foto.
    const intento = JSON.parse(leerFlujo('mercosur_ingreso_pendiente')!)
    expect(intento).toMatchObject({ turno_id: 't1', guardia_id: 'g1', intento_id: 'i1' })
    const libro = await leerFotoPendiente('ingreso', 't1', 'libro', 'g1')
    expect(libro).toBeInstanceOf(File)
    expect(libro!.size).toBe(300_000)
    expect(await leerFotoPendiente('ingreso', 't1', 'uniforme', 'g1')).toBeNull() // la que se estaba sacando no vuelve

    // 4. Confirmado: se borra todo.
    await borrarFotosDe('ingreso', 't1')
    borrarFlujo('mercosur_ingreso_pendiente')
    expect(await listarFotosPendientes()).toEqual([])
    expect(leerFlujo('mercosur_ingreso_pendiente')).toBeNull()
  })

  it('la foto de otra persona que usó el mismo teléfono no se restaura', async () => {
    await guardarFotoPendiente({ flujo: 'ingreso', refId: 't1', tipo: 'libro', usuarioId: 'g1', archivo: jpg(1000) })
    expect(await leerFotoPendiente('ingreso', 't1', 'libro', 'g2')).toBeNull()
  })

  it('el código de GuardiaMobile guarda antes de la cámara y restaura después', () => {
    const g = leer('components/guardia/GuardiaMobile.tsx')
    expect(g).toMatch(/guardarFlujo\(INGRESO_PENDIENTE_KEY/)
    expect(g).toMatch(/leerFlujo\(INGRESO_PENDIENTE_KEY\)/)
    expect(g).toMatch(/prepararYGuardarFoto\('libro', file/)
    expect(g).toMatch(/leerFotoPendiente\('ingreso', turno\.id, 'libro'/)
    expect(g).toMatch(/borrarFotosDe\('ingreso'/)
    const r = leer('components/rondas/RondaGuardiaEjecucion.tsx')
    expect(r).toMatch(/guardarPuntoEnCurso\(\)\s*\n\s*fotoInputRef\.current\?\.click\(\)/)
    expect(r).toMatch(/borrarFotosDe\('ronda', puntoActual\.ejecucion_punto_id\)/)
  })

  it('ronda: mismo punto → vuelve la novedad, la foto y el GPS sólo si es reciente', () => {
    const ahora = 10_000_000
    const g = { ejecucion_punto_id: 'p1', gps: { latitud: 1, longitud: 2, precision_metros: 10 }, gps_ms: ahora - 60_000, hay_novedad: true, tiene_foto: true, ts: ahora }
    expect(restauracionPunto(g, 'p1', ahora)).toEqual({ gps: g.gps, hayNovedad: true, buscarFoto: true })
    expect(restauracionPunto({ ...g, gps_ms: ahora - 5 * 60_000 }, 'p1', ahora)?.gps).toBeNull()
    expect(restauracionPunto(g, 'p2', ahora)).toBeNull() // el punto ya avanzó
    expect(CLAVE_RONDA_EN_CURSO).toMatch(/ronda/)
  })

  it('acotado: máx. fotos, máx. bytes y purga a las 24 h', async () => {
    const ahora = 50 * 3600_000
    for (let i = 0; i < MAX_FOTOS_PENDIENTES + 3; i++) {
      await guardarFotoPendiente({ flujo: 'ronda', refId: `p${i}`, tipo: 'punto', archivo: jpg(500_000) }, ahora + i)
    }
    const lista = await listarFotosPendientes()
    expect(lista.length).toBe(MAX_FOTOS_PENDIENTES)
    expect(lista[0].ref_id).toBe('p3') // se fueron las más viejas
    // Bytes: dos de 3,5 MB + una de 3 MB no entran juntas en 8 MB.
    const plan = planPurga(
      [{ clave: 'a', bytes: 3_500_000, creado_ms: 1 }, { clave: 'b', bytes: 3_500_000, creado_ms: 2 }],
      3, { clave: 'c', bytes: 3_000_000 },
    )
    expect(plan).toEqual(['a'])
    expect(3_500_000 + 3_000_000).toBeLessThanOrEqual(MAX_BYTES_PENDIENTES)
    // 24 h.
    expect(await purgarFotosPendientes(ahora + EDAD_MAXIMA_PENDIENTE_MS + 100)).toBe(MAX_FOTOS_PENDIENTES)
    expect(await listarFotosPendientes()).toEqual([])
  })

  it('sin IndexedDB no rompe: guardar devuelve false y restaurar null', async () => {
    usarAlmacenFotos(null)
    expect(await guardarFotoPendiente({ flujo: 'ingreso', refId: 't', tipo: 'libro', archivo: jpg(10) })).toBe(false)
    expect(await leerFotoPendiente('ingreso', 't', 'libro')).toBeNull()
  })

  it('el Diagnóstico muestra las fotos sin subir', () => {
    expect(leer('lib/diagnostico-dispositivo.ts')).toMatch(/listarFotosPendientes\(\)/)
    expect(leer('components/movil/DiagnosticoDispositivo.tsx')).toMatch(/Fotos sin subir/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('PWA con mala conexión', () => {
  beforeEach(() => { eventos.length = 0; rpcRespuestas.length = 0; rpcLlamadas.length = 0; evidenciaExistente = null })

  it('clasifica fallas de red y no confunde respuestas del servidor', () => {
    expect(esFallaDeRed({ message: 'TypeError: Failed to fetch' }, 0)).toBe(true)
    expect(esFallaDeRed({ name: 'AbortError', message: 'aborted' })).toBe(true)
    expect(esFallaDeRed({ message: 'permission denied for table x', code: '42501' }, 403)).toBe(false)
  })

  it('backoff exponencial con tope y jitter', () => {
    expect(esperaBackoff(0, 800, 8000, () => 1)).toBe(800)
    expect(esperaBackoff(1, 800, 8000, () => 1)).toBe(1600)
    expect(esperaBackoff(10, 800, 8000, () => 1)).toBe(8000)
    expect(esperaBackoff(0, 800, 8000, () => 0)).toBe(400)
  })

  it('reintenta sólo lo reintentable, con tope, y corta si el teléfono está offline', async () => {
    const dormir = vi.fn(async () => {})
    let n = 0
    const r = await reintentar(async () => (++n < 3 ? 'red' : 'ok'), { intentos: 3, reintentarSi: x => x === 'red', dormir })
    expect(r).toBe('ok'); expect(n).toBe(3); expect(dormir).toHaveBeenCalledTimes(2)

    n = 0
    await reintentar(async () => { n++; return 'red' }, { intentos: 3, reintentarSi: x => x === 'red', dormir })
    expect(n).toBe(3) // nunca más de 3

    n = 0
    await reintentar(async () => { n++; return 'server' }, { intentos: 3, reintentarSi: x => x === 'red', dormir })
    expect(n).toBe(1)

    const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true })
    n = 0
    await reintentar(async () => { n++; return 'red' }, { intentos: 3, reintentarSi: x => x === 'red', dormir })
    expect(n).toBe(1)
    if (nav) Object.defineProperty(globalThis, 'navigator', nav)
    else delete (globalThis as any).navigator
  })

  it('timeout: la señal se aborta y avisa que venció', async () => {
    vi.useFakeTimers()
    const s = senalConTimeout(1000)
    expect(s.signal.aborted).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(s.signal.aborted).toBe(true)
    expect(s.vencida()).toBe(true)
    vi.useRealTimers()
  })

  it('telemetría ronda_red_error acotada a 20 por sesión, con paso, onLine y effectiveType', () => {
    const emitidos: any[] = []
    const lim = crearLimitador(MAX_EVENTOS_RED_POR_SESION)
    for (let i = 0; i < 50; i++) registrarErrorRed('registrar_punto_ronda', { err_code: 'red' }, (n, p) => emitidos.push({ n, p }), lim)
    expect(emitidos.length).toBe(20)
    expect(lim.descartados()).toBe(30)
    expect(emitidos[0].n).toBe('ronda_red_error')
    expect(emitidos[0].p.value_json).toMatchObject({ paso: 'registrar_punto_ronda' })
    expect(emitidos[0].p.value_json).toHaveProperty('online')
    expect(emitidos[0].p.value_json).toHaveProperty('effective_type')
  })

  it('registrar punto: se pierde la respuesta, el reintento recibe ya_registrado y la ronda sigue', async () => {
    vi.useFakeTimers()
    rpcRespuestas.push(
      { data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 },
      { data: { contexto: 'ya_registrado', punto: { ejecucion_punto_id: 'p1', estado: 'cumplido' }, ejecucion: { id: 'e', puntos: [] } }, error: null, status: 200 },
    )
    const prom = registrarPuntoRonda('p1', null, false)
    await vi.runAllTimersAsync()
    const r = await prom
    vi.useRealTimers()
    expect(rpcLlamadas).toEqual(['registrar_punto_ronda', 'registrar_punto_ronda'])
    expect(r.error).toBeNull()
    expect(r.data?.contexto).toBe('ya_registrado')
    expect(eventos.filter(e => e.nombre === 'ronda_red_error').length).toBe(1)
  })

  it('sin red persistente: mensaje claro y como mucho 3 intentos', async () => {
    vi.useFakeTimers()
    const prom = registrarPuntoRonda('p1', null, false)
    await vi.runAllTimersAsync()
    const r = await prom
    vi.useRealTimers()
    expect(rpcLlamadas.length).toBe(3)
    expect(r.error).toBe(MENSAJE_SIN_RED_RONDA)
  })

  it('foto: si la evidencia ya llegó (misma huella sha256) no se vuelve a subir', async () => {
    const foto = jpg(2000)
    const huella = await sha256Hex(foto)
    expect(huella).toMatch(/^[0-9a-f]{64}$/)
    evidenciaExistente = { id: 'ev1', proceso_id: 'p1', bucket: 'b', storage_path: 's', created_at: 'x', contenido_sha256: huella }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const r = await subirFotoPuntoRonda('p1', foto)
    vi.unstubAllGlobals()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(r.data?.id).toBe('ev1')
  })

  it('foto: huella distinta → se sube, con AbortSignal; la caída de red se registra', async () => {
    evidenciaExistente = { id: 'ev1', contenido_sha256: 'otra' }
    const fetchMock = vi.fn(async (_u: string, init: any) => {
      expect(init.signal).toBeDefined()
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', fetchMock)
    const r = await subirFotoPuntoRonda('p1', jpg(2000))
    vi.unstubAllGlobals()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(r.error).toMatch(/conexión/)
    expect(eventos.some(e => e.nombre === 'ronda_red_error' && e.payload.err_function === 'subir_foto_punto')).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('múltiples eventos de visibilidad no duplican consultas', () => {
  it('una ráfaga de visibilitychange/focus/pageshow durante 10 vueltas = una consulta por vuelta, y ≥30 s entre cargas', () => {
    const oyentes: Record<string, Array<() => void>> = {}
    const add = (t: string, f: any) => { (oyentes[t] ||= []).push(f) }
    const rem = (t: string, f: any) => { oyentes[t] = (oyentes[t] || []).filter(x => x !== f) }
    const timers: Array<{ fn: () => void; en: number }> = []
    let reloj = 0
    const disp = crearDisparadorPrimerPlano({
      doc: { addEventListener: add, removeEventListener: rem, visibilityState: 'visible' } as any,
      win: { addEventListener: add, removeEventListener: rem } as any,
      programar: (fn, ms) => { const t = { fn, en: reloj + ms }; timers.push(t); return t },
      cancelar: t => { const i = timers.indexOf(t as any); if (i >= 0) timers.splice(i, 1) },
    })
    let consultas = 0
    let ultimaCarga: number | null = 0
    // Dos componentes (GuardiaMobile y RondasGuardiaPanel) suscriptos al mismo disparo.
    const componente = () => (motivo: any) => {
      if (debeRecargarPorPrimerPlano(reloj, ultimaCarga, motivo)) { consultas++; ultimaCarga = reloj }
    }
    const c1 = componente()
    disp.suscribir(c1)
    const avanzar = (ms: number) => {
      reloj += ms
      for (const t of [...timers].sort((a, b) => a.en - b.en)) if (t.en <= reloj) { timers.splice(timers.indexOf(t), 1); t.fn() }
    }
    for (let vuelta = 0; vuelta < 10; vuelta++) {
      avanzar(60_000)
      for (let i = 0; i < 5; i++) { oyentes.visibilitychange?.forEach(f => f()); oyentes.focus?.forEach(f => f()); oyentes.pageshow?.forEach(f => f()) }
      avanzar(500)
    }
    expect(consultas).toBe(10)
    // Volver dos veces en menos de 30 s: la segunda no consulta.
    avanzar(10_000)
    oyentes.focus?.forEach(f => f()); avanzar(500)
    expect(consultas).toBe(10)
    // Reconexión: dispara siempre.
    oyentes.online?.forEach(f => f()); avanzar(500)
    expect(consultas).toBe(11)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('actualización de Service Worker sin crecimiento ilimitado', () => {
  /** Ejecuta public/sw.js en un sandbox con caches/fetch simulados. */
  function cargarWorker(version: string, caches: Map<string, Map<string, any>>) {
    const handlers: Record<string, (e: any) => void> = {}
    const cachesApi = {
      keys: async () => Array.from(caches.keys()),
      delete: async (n: string) => caches.delete(n),
      open: async (n: string) => {
        if (!caches.has(n)) caches.set(n, new Map())
        const c = caches.get(n)!
        return {
          keys: async () => Array.from(c.keys()).map(u => ({ url: u })),
          delete: async (r: any) => c.delete(r.url),
          put: async (r: any, resp: any) => { c.set(r.url, resp) },
          add: async (u: string) => { c.set('https://app.test' + u, {}) },
        }
      },
      match: async () => undefined,
    }
    const self: any = {
      // Igual que PwaRegister: la versión va con encodeURIComponent ('+' → %2B).
      location: { href: `https://app.test/sw.js?v=${encodeURIComponent(version)}`, origin: 'https://app.test' },
      addEventListener: (t: string, f: any) => { handlers[t] = f },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
    }
    const ctx = vm.createContext({
      self, caches: cachesApi, URL, Promise,
      importScripts: () => { throw new Error('sin sw-version.js') },
      fetch: async () => ({ status: 200, type: 'basic', clone() { return this } }),
    })
    vm.runInContext(leer('public/sw.js'), ctx)
    const esperar = async (t: string, extra: any = {}) => {
      let p: Promise<any> = Promise.resolve()
      handlers[t]({ ...extra, waitUntil: (x: Promise<any>) => { p = x }, respondWith: (x: Promise<any>) => { p = x } })
      await p
      await new Promise(r => setTimeout(r, 0))
    }
    return { esperar }
  }

  it('tres deploys con 100 páginas cada uno: una sola caché y ≤ 40 entradas', async () => {
    const caches = new Map<string, Map<string, any>>()
    caches.set('mercosur-seguridad-v3', new Map([['https://app.test/vieja', {}]]))
    for (const v of ['0.1.0+aaa', '0.1.0+bbb', '0.1.0+ccc']) {
      const sw = cargarWorker(v, caches)
      await sw.esperar('install')
      await sw.esperar('activate')
      for (let i = 0; i < 100; i++) {
        await sw.esperar('fetch', { request: { method: 'GET', url: `https://app.test/pagina-${v}-${i}` } })
      }
      // Lo que nunca se cachea: chunks con hash y otros orígenes.
      await sw.esperar('fetch', { request: { method: 'GET', url: 'https://app.test/_next/static/chunks/x.js' } }).catch(() => {})
      await sw.esperar('fetch', { request: { method: 'GET', url: 'https://tile.openstreetmap.org/1/1/1.png' } }).catch(() => {})
    }
    expect(Array.from(caches.keys())).toEqual(['mercosur-seguridad-0.1.0+ccc'])
    const entradas = Array.from(caches.get('mercosur-seguridad-0.1.0+ccc')!.keys())
    expect(entradas.length).toBeLessThanOrEqual(40)
    expect(entradas).toContain('https://app.test/dashboard') // el app-shell no se recorta
    expect(entradas.some(u => u.includes('_next/static') || u.includes('openstreetmap'))).toBe(false)
  }, 30_000) // 300 fetch simulados en serie: ~5 s, al borde del límite por defecto
})

// ═════════════════════════════════════════════════════════════════════════════
describe('GPS del supervisor con histéresis', () => {
  const OBJ = [{ id: 'o1', lat: -32.95, lng: -60.65, radio_metros: 100 }]
  // ~1 m en latitud ≈ 0.000009°
  const enMetros = (dNorte: number) => -32.95 + dNorte * 0.000009
  const correr = (lecturas: Lectura[], est: EstadoMaquina = estadoInicial()) => {
    const tipos: string[] = []
    for (const l of lecturas) {
      const r = procesarLectura(est, l, OBJ)
      est = r.estado
      tipos.push(...r.acciones.map(a => a.tipo))
    }
    return { tipos, est }
  }

  it('la entrada no se demora: una sola lectura dentro del radio alcanza (no se pierde ninguna visita)', () => {
    const borde = { lat: enMetros(90), lng: -60.65, speed: 0 }
    expect(correr([{ ...borde, ts: 0 }]).tipos).toEqual(['objetivo_enter'])
  })

  it('salir requiere dos lecturas fuera de radio + 25 m (o una muy lejos)', () => {
    const adentro = { lat: enMetros(10), lng: -60.65, speed: 0, ts: 0 }
    expect(correr([adentro, { lat: enMetros(140), lng: -60.65, speed: 1, ts: 30_000 }]).tipos).not.toContain('objetivo_exit')
    expect(correr([adentro, { lat: enMetros(140), lng: -60.65, speed: 1, ts: 30_000 }, { lat: enMetros(150), lng: -60.65, speed: 1, ts: 60_000 }]).tipos).toContain('objetivo_exit')
    expect(correr([adentro, { lat: enMetros(300), lng: -60.65, speed: 8, ts: 30_000 }]).tipos).toContain('objetivo_exit')
  })

  it('una visita real (bien adentro) entra con una sola lectura y sale al confirmar', () => {
    const { tipos } = correr([
      { lat: enMetros(500), lng: -60.65, speed: 5, ts: 0 },
      { lat: enMetros(20), lng: -60.65, speed: 0, ts: 60_000 },
      { lat: enMetros(30), lng: -60.65, speed: 0, ts: 120_000 },
      { lat: enMetros(140), lng: -60.65, speed: 1, ts: 180_000 },
      { lat: enMetros(160), lng: -60.65, speed: 1, ts: 210_000 },
    ])
    expect(tipos.filter(t => t === 'objetivo_enter').length).toBe(1)
    expect(tipos.filter(t => t === 'objetivo_exit').length).toBe(1)
  })

  it('el ruido en el borde ya no genera entradas/salidas en cadena', () => {
    // Parado a 95–130 m del centro (radio 100): antes, cada cruce era enter/exit.
    const ruido = [95, 130, 98, 128, 97, 126, 99, 125].map((d, i) => ({ lat: enMetros(d), lng: -60.65, speed: 0, ts: i * 30_000 }))
    const { tipos } = correr(ruido)
    expect(tipos.filter(t => t === 'objetivo_enter' || t === 'objetivo_exit').length).toBeLessThanOrEqual(1)
  })

  it('MOVING ⇄ STOPPED necesita dos lecturas seguidas', () => {
    const base = { lng: -60.65, lat: enMetros(1000) }
    const { tipos } = correr([
      { ...base, speed: 2, ts: 0 },
      { ...base, speed: 0, ts: 10_000 },   // una lectura parado: no cambia
      { ...base, speed: 2, ts: 20_000 },
      { ...base, speed: 0, ts: 30_000 },
      { ...base, speed: 0, ts: 40_000 },   // dos: ahora sí
    ])
    expect(tipos.filter(t => t === 'stopped').length).toBe(1)
  })

  it('volver de segundo plano adentro del objetivo no duplica la entrada', () => {
    let { est } = correr([{ lat: enMetros(10), lng: -60.65, speed: 0, ts: 0 }])
    est = trasRecuperacion(est)
    const r = procesarLectura(est, { lat: enMetros(12), lng: -60.65, speed: 0, ts: 300_000 }, OBJ)
    expect(r.acciones.map(a => a.tipo)).not.toContain('objetivo_enter')
  })

  it('watchPosition con maximumAge mayor', () => {
    expect(leer('lib/supervisor-gps.ts')).toMatch(/maximumAge: 60_000/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('compresión: rescate antes de subir el original', () => {
  const f = jpg(3_000_000)
  it('canvas falla por memoria → createImageBitmap con perfil de rescate', async () => {
    const r = await prepararFotoOperativa(f, 'libro_guardia', {
      comprimir: async () => { throw new Error('compresion_blob_fallo') },
      comprimirBitmap: async (_x, op) => { expect(op.ladoMayor).toBe(1280); return jpg(250_000) },
    })
    expect(r.via).toBe('bitmap_rescate')
    expect(r.file.size).toBe(250_000)
  })
  it('sin createImageBitmap → canvas con perfil de rescate', async () => {
    const usados: number[] = []
    const r = await prepararFotoOperativa(f, 'operativa', {
      comprimir: async (_x, op) => { usados.push(op.ladoMayor!); if (op.ladoMayor! > 1280) throw new Error('compresion_timeout'); return jpg(200_000) },
      comprimirBitmap: async () => { throw new Error('bitmap_no_disponible') },
    })
    expect(r.via).toBe('canvas_rescate')
    expect(usados).toEqual([1600, 1280])
  })
  it('todo falla → original (si es subible), con el código del primer fallo', async () => {
    const r = await prepararFotoOperativa(f, 'operativa', {
      comprimir: async () => { throw new Error('compresion_timeout') },
      comprimirBitmap: async () => { throw new Error('imagen_carga_fallo') },
    })
    expect(r.via).toBe('original')
    expect(r.error).toBe('compresion_timeout')
  })
  it('legibilidad para la IA: ningún perfil baja de 1280 px de lado mayor', () => {
    for (const p of [...Object.values(PERFILES_FOTO), PERFIL_RESCATE]) expect(p.ladoMayor).toBeGreaterThanOrEqual(LADO_MINIMO_LEGIBLE)
  })
})
