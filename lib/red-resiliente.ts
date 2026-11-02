/**
 * lib/red-resiliente.ts
 *
 * Red de celular mala (auditoría PWA oct-2026). El flujo de rondas no tenía
 * timeout: un fetch colgado dejaba "Subiendo y validando…" para siempre, y los
 * errores de red sólo iban a console.error, así que el diagnóstico no los veía.
 *
 * Acá viven las piezas puras y chicas que usa lib/rondas:
 *   - señal con timeout (AbortController + setTimeout: AbortSignal.timeout no
 *     existe en los WebView viejos de Android);
 *   - clasificación "¿esto fue la red?" para resultados de PostgREST y fetch;
 *   - reintento acotado con backoff exponencial y jitter, SÓLO para llamadas
 *     idempotentes y SÓLO ante fallas de red (nunca ante un 4xx/5xx con cuerpo:
 *     eso es una respuesta del servidor y reintentar no la cambia);
 *   - telemetría acotada `ronda_red_error` (máx. 20 por sesión de página).
 */

import { track, type TrackPayload } from '@/lib/telemetry'

export const TIMEOUT_RPC_MS = 15_000
export const TIMEOUT_SUBIDA_MS = 45_000
export const REINTENTOS_IDEMPOTENTES = 3 // intentos totales (1 + 2 reintentos)
export const MAX_EVENTOS_RED_POR_SESION = 20

export interface SenalConTimeout {
  signal: AbortSignal
  /** Limpia el temporizador. Llamar siempre al terminar. */
  liberar: () => void
  /** true si se abortó por tiempo (no por otra causa). */
  vencida: () => boolean
}

export function senalConTimeout(ms: number): SenalConTimeout {
  const ctrl = new AbortController()
  let vencio = false
  const t = setTimeout(() => { vencio = true; ctrl.abort() }, ms)
  return {
    signal: ctrl.signal,
    liberar: () => clearTimeout(t),
    vencida: () => vencio,
  }
}

/** ¿El error de fetch/PostgREST es de red (sin respuesta del servidor)? */
export function esFallaDeRed(error: unknown, status?: number | null): boolean {
  if (status === 0) return true
  const nombre = (error as { name?: string } | null)?.name ?? ''
  const mensaje = String((error as { message?: string } | null)?.message ?? error ?? '')
  if (nombre === 'AbortError' || nombre === 'TimeoutError') return true
  return /Failed to fetch|NetworkError|Load failed|network|AbortError|aborted|timeout|FetchError/i.test(mensaje)
}

/**
 * Espera antes del reintento `intento` (0 = primer reintento): 800 ms, 1,6 s,
 * 3,2 s… con tope y jitter del 50 % para que muchos teléfonos que recuperan
 * señal juntos no golpeen el servidor en el mismo instante.
 */
export function esperaBackoff(intento: number, baseMs = 800, maxMs = 8_000, azar: () => number = Math.random): number {
  const bruto = Math.min(maxMs, baseMs * 2 ** Math.max(0, intento))
  return Math.round(bruto * (0.5 + azar() * 0.5))
}

export interface OpcionesReintento<T> {
  intentos?: number
  /** Decide sobre el resultado (no lanzado) si conviene reintentar. */
  reintentarSi: (resultado: T) => boolean
  dormir?: (ms: number) => Promise<void>
  azar?: () => number
  /** Antes de cada reintento (p. ej. telemetría). */
  alReintentar?: (intento: number, resultado: T) => void
}

const dormirReal = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/**
 * Ejecuta `fn` hasta `intentos` veces mientras `reintentarSi` diga que sí y el
 * teléfono no esté claramente offline. Devuelve el último resultado.
 * Pensado para funciones que NO lanzan (devuelven {data, error}).
 */
export async function reintentar<T>(fn: (intento: number) => Promise<T>, op: OpcionesReintento<T>): Promise<T> {
  const total = Math.max(1, op.intentos ?? REINTENTOS_IDEMPOTENTES)
  const dormir = op.dormir ?? dormirReal
  let resultado = await fn(0)
  for (let i = 1; i < total; i++) {
    if (!op.reintentarSi(resultado)) break
    // Sin red no tiene sentido gastar batería: el evento `online` refresca.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) break
    op.alReintentar?.(i, resultado)
    await dormir(esperaBackoff(i - 1, undefined, undefined, op.azar))
    resultado = await fn(i)
  }
  return resultado
}

export function contextoRed(): { online: boolean | null; effective_type: string | null } {
  if (typeof navigator === 'undefined') return { online: null, effective_type: null }
  const conn = (navigator as any).connection
  return {
    online: typeof navigator.onLine === 'boolean' ? navigator.onLine : null,
    effective_type: conn?.effectiveType ?? null,
  }
}

/** Contador simple: permite `max` emisiones y después corta. */
export function crearLimitador(max: number) {
  let emitidos = 0
  let descartados = 0
  return {
    permitir(): boolean {
      if (emitidos >= max) { descartados++; return false }
      emitidos++
      return true
    },
    emitidos: () => emitidos,
    descartados: () => descartados,
  }
}

export type PasoRondaRed =
  | 'iniciar_ronda'
  | 'obtener_ejecucion_actual'
  | 'registrar_punto_ronda'
  | 'validar_qr_punto_ronda'
  | 'subir_foto_punto'
  | 'verificar_evidencia'

const limitadorRed = crearLimitador(MAX_EVENTOS_RED_POR_SESION)

export interface DetalleErrorRed {
  err_code: string
  err_message?: string
  intento?: number
  duracion_ms?: number
  http_status?: number | null
  ejecucion_punto_id?: string | null
}

/**
 * Emite `ronda_red_error` con paso, onLine y effectiveType. Acotado a
 * MAX_EVENTOS_RED_POR_SESION por carga de página: una ráfaga de reintentos sin
 * señal no puede llenar os_events.
 */
export function registrarErrorRed(
  paso: PasoRondaRed,
  detalle: DetalleErrorRed,
  emitir: (nombre: string, payload: TrackPayload) => void = track,
  limitador = limitadorRed,
): boolean {
  if (!limitador.permitir()) return false
  const red = contextoRed()
  try {
    emitir('ronda_red_error', {
      category: 'error',
      screen: 'rondas_guardia',
      err_function: paso,
      err_code: detalle.err_code,
      err_message: detalle.err_message?.slice(0, 200),
      duration_ms: detalle.duracion_ms,
      value_json: {
        paso,
        online: red.online,
        effective_type: red.effective_type,
        intento: detalle.intento ?? 0,
        http_status: detalle.http_status ?? null,
        ejecucion_punto_id: detalle.ejecucion_punto_id ?? null,
      },
    })
  } catch { /* la telemetría nunca rompe el flujo */ }
  return true
}

/** SHA-256 hex de un Blob (mismo valor que calcula el servidor en validar-foto). */
export async function sha256Hex(blob: Blob): Promise<string | null> {
  try {
    const subtle = (globalThis.crypto as Crypto | undefined)?.subtle
    if (!subtle) return null
    const buf = await blob.arrayBuffer()
    const hash = await subtle.digest('SHA-256', buf)
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}
