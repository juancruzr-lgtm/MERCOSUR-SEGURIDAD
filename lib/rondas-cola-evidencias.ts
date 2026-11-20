/**
 * lib/rondas-cola-evidencias.ts
 *
 * Cola persistente de "fotos de punto pendientes de sincronizar".
 *
 * Producción (nov-2026): con mala señal la foto de un punto de ronda a veces
 * llega a Storage pero su fila en `evidencias` no (o la respuesta se pierde por
 * timeout). Antes el vigilador veía un error y tenía que reintentar a mano,
 * re-subiendo la imagen entera.
 *
 * Diseño:
 *   - La FOTO ya queda en IndexedDB (lib/pendientes-camara) desde que se saca,
 *     y ahí sigue hasta que el punto se registra. Esta cola guarda sólo el
 *     pedido de sincronización (JSON chico) en localStorage.
 *   - Clave idempotente = ejecucion_punto_id. El path en Storage sale de ese id
 *     (`<ejecucion>/<punto>/punto`) y la fila es un upsert por
 *     proceso_tipo+proceso_id+tipo_evidencia: repetir nunca duplica.
 *   - Se procesa al volver la conexión (`online`), al volver la app al primer
 *     plano y al abrir la pantalla de la ronda. Backoff exponencial entre
 *     intentos; descarte a las 24 h o ante un rechazo definitivo del servidor
 *     (el punto ya no está pendiente, no es tuyo, etc.).
 *   - La cola NUNCA registra el punto: sólo vincula la evidencia. El punto se
 *     marca hecho únicamente cuando `registrar_punto_ronda` lo confirma.
 */

import { esperaBackoff } from '@/lib/red-resiliente'

export const CLAVE_COLA_EVIDENCIAS = 'mercosur.ronda_cola_evidencias.v1'
export const EDAD_MAXIMA_COLA_MS = 24 * 60 * 60 * 1000
export const MAX_ENTRADAS_COLA = 20
/** Backoff entre pasadas de la cola: 2 s, 4 s, 8 s… hasta 5 min. */
export const BACKOFF_BASE_COLA_MS = 2_000
export const BACKOFF_MAX_COLA_MS = 5 * 60 * 1000

export interface EntradaColaEvidencia {
  /** Clave idempotente: define el path en Storage y la fila de evidencia. */
  ejecucion_punto_id: string
  /** Huella de la foto guardada (para no subirla dos veces). */
  sha256: string | null
  usuario_id: string | null
  creado_ms: number
  intentos: number
  proximo_ms: number
  ultimo_error: string | null
}

export type ResultadoSincronizacion<E = unknown> =
  | { tipo: 'ok'; evidencia: E }
  | { tipo: 'transitorio'; error: string }
  | { tipo: 'definitivo'; error: string }

export interface AlmacenCola {
  leer(): EntradaColaEvidencia[]
  escribir(entradas: EntradaColaEvidencia[]): void
}

export function almacenColaEnMemoria(inicial: EntradaColaEvidencia[] = []): AlmacenCola & { _datos: () => EntradaColaEvidencia[] } {
  let datos = [...inicial]
  return {
    _datos: () => datos,
    leer: () => datos.map(e => ({ ...e })),
    escribir: e => { datos = e.map(x => ({ ...x })) },
  }
}

export function almacenColaLocal(): AlmacenCola {
  return {
    leer() {
      try {
        const t = typeof localStorage !== 'undefined' ? localStorage.getItem(CLAVE_COLA_EVIDENCIAS) : null
        const v = t ? JSON.parse(t) : []
        return Array.isArray(v) ? v.filter(esEntradaValida) : []
      } catch {
        return []
      }
    },
    escribir(entradas) {
      try {
        if (typeof localStorage === 'undefined') return
        if (entradas.length === 0) localStorage.removeItem(CLAVE_COLA_EVIDENCIAS)
        else localStorage.setItem(CLAVE_COLA_EVIDENCIAS, JSON.stringify(entradas))
      } catch { /* sin storage: la foto sigue en IndexedDB y el reintento manual funciona */ }
    },
  }
}

function esEntradaValida(e: any): e is EntradaColaEvidencia {
  return !!e && typeof e.ejecucion_punto_id === 'string' && typeof e.creado_ms === 'number'
}

let almacenPorDefecto: AlmacenCola | null = null
function almacenActual(a?: AlmacenCola): AlmacenCola {
  if (a) return a
  if (!almacenPorDefecto) almacenPorDefecto = almacenColaLocal()
  return almacenPorDefecto
}

/** Sólo para pruebas. */
export function usarAlmacenCola(a: AlmacenCola | null) {
  almacenPorDefecto = a
}

/**
 * Agrega (o actualiza) el pedido de sincronización de un punto. Idempotente:
 * una sola entrada por ejecucion_punto_id. Si la foto cambió (otra huella) se
 * reinician los intentos.
 */
export function encolarEvidencia(
  datos: { ejecucionPuntoId: string; sha256?: string | null; usuarioId?: string | null; error?: string | null },
  ahora = Date.now(),
  almacen?: AlmacenCola,
): EntradaColaEvidencia {
  const a = almacenActual(almacen)
  const entradas = a.leer()
  const previa = entradas.find(e => e.ejecucion_punto_id === datos.ejecucionPuntoId)
  const misma = previa && (previa.sha256 ?? null) === (datos.sha256 ?? null)
  const entrada: EntradaColaEvidencia = {
    ejecucion_punto_id: datos.ejecucionPuntoId,
    sha256: datos.sha256 ?? null,
    usuario_id: datos.usuarioId ?? previa?.usuario_id ?? null,
    creado_ms: misma ? previa!.creado_ms : ahora,
    intentos: misma ? previa!.intentos : 0,
    // Primer reintento automático enseguida (el componente ya reintentó en línea).
    proximo_ms: ahora,
    ultimo_error: datos.error ?? previa?.ultimo_error ?? null,
  }
  const resto = entradas.filter(e => e.ejecucion_punto_id !== datos.ejecucionPuntoId)
  // Acotada: si se pasa, salen las más viejas.
  const final = [...resto, entrada].sort((x, y) => x.creado_ms - y.creado_ms).slice(-MAX_ENTRADAS_COLA)
  a.escribir(final)
  return entrada
}

export function quitarDeCola(ejecucionPuntoId: string, almacen?: AlmacenCola): void {
  const a = almacenActual(almacen)
  const entradas = a.leer()
  const resto = entradas.filter(e => e.ejecucion_punto_id !== ejecucionPuntoId)
  if (resto.length !== entradas.length) a.escribir(resto)
}

export function entradaEnCola(ejecucionPuntoId: string, almacen?: AlmacenCola): EntradaColaEvidencia | null {
  return almacenActual(almacen).leer().find(e => e.ejecucion_punto_id === ejecucionPuntoId) ?? null
}

export function entradasEnCola(almacen?: AlmacenCola): EntradaColaEvidencia[] {
  return almacenActual(almacen).leer()
}

export interface ResumenProcesoCola<E = unknown> {
  sincronizadas: Array<{ ejecucion_punto_id: string; evidencia: E }>
  descartadas: Array<{ ejecucion_punto_id: string; motivo: string }>
  pendientes: string[]
}

let procesando: Promise<ResumenProcesoCola<any>> | null = null

/**
 * Recorre la cola y sincroniza lo que esté vencido. `sincronizar` decide qué
 * pasó con cada entrada; esta función sólo maneja estado, backoff y descarte.
 * Una sola pasada a la vez (dos disparos juntos comparten la misma promesa).
 */
export function procesarColaEvidencias<E>(
  sincronizar: (entrada: EntradaColaEvidencia) => Promise<ResultadoSincronizacion<E>>,
  opciones: { ahora?: () => number; almacen?: AlmacenCola; forzar?: boolean; azar?: () => number } = {},
): Promise<ResumenProcesoCola<E>> {
  if (procesando) return procesando as Promise<ResumenProcesoCola<E>>
  const corrida = (async (): Promise<ResumenProcesoCola<E>> => {
    const a = almacenActual(opciones.almacen)
    const reloj = opciones.ahora ?? Date.now
    const resumen: ResumenProcesoCola<E> = { sincronizadas: [], descartadas: [], pendientes: [] }
    for (const entrada of a.leer()) {
      const ahora = reloj()
      if (ahora - entrada.creado_ms > EDAD_MAXIMA_COLA_MS) {
        quitarDeCola(entrada.ejecucion_punto_id, a)
        resumen.descartadas.push({ ejecucion_punto_id: entrada.ejecucion_punto_id, motivo: 'vencida' })
        continue
      }
      if (!opciones.forzar && entrada.proximo_ms > ahora) {
        resumen.pendientes.push(entrada.ejecucion_punto_id)
        continue
      }
      let r: ResultadoSincronizacion<E>
      try {
        r = await sincronizar(entrada)
      } catch (e) {
        r = { tipo: 'transitorio', error: String((e as Error)?.message ?? e) }
      }
      if (r.tipo === 'ok') {
        quitarDeCola(entrada.ejecucion_punto_id, a)
        resumen.sincronizadas.push({ ejecucion_punto_id: entrada.ejecucion_punto_id, evidencia: r.evidencia })
      } else if (r.tipo === 'definitivo') {
        quitarDeCola(entrada.ejecucion_punto_id, a)
        resumen.descartadas.push({ ejecucion_punto_id: entrada.ejecucion_punto_id, motivo: r.error })
      } else {
        // Releer: otra pestaña/llamada pudo haberla quitado o actualizado.
        const actual = a.leer()
        const i = actual.findIndex(e => e.ejecucion_punto_id === entrada.ejecucion_punto_id)
        if (i >= 0) {
          const intentos = actual[i].intentos + 1
          actual[i] = {
            ...actual[i],
            intentos,
            ultimo_error: r.error,
            proximo_ms: reloj() + esperaBackoff(intentos - 1, BACKOFF_BASE_COLA_MS, BACKOFF_MAX_COLA_MS, opciones.azar),
          }
          a.escribir(actual)
          resumen.pendientes.push(entrada.ejecucion_punto_id)
        }
      }
    }
    return resumen
  })()
  procesando = corrida
  const limpiar = () => { if (procesando === corrida) procesando = null }
  corrida.then(limpiar, limpiar)
  return corrida
}
