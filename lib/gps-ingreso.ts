/**
 * lib/gps-ingreso.ts
 *
 * GPS del ingreso EN SEGUNDO PLANO (F-11, nov-2026).
 *
 * Telemetría de 14 días (89 ingresos confirmados): total p50 ≈ 46 s. El GPS
 * bloqueaba la pantalla "Obteniendo ubicación…" antes de las fotos: p50 1,7 s,
 * promedio 4,3 s y 10 s clavados cuando vence (31 % de los intentos). Decisión
 * vigente de Gerencia: el GPS sólo informa, no traba ni castiga.
 *
 * Ahora la captura arranca al tocar "Ingresar" y corre mientras el vigilador
 * saca las fotos (p50 ≈ 36 s), con un tope más largo porque ya no bloquea. Al
 * confirmar se espera, como mucho, un tope CORTO; si no llegó, el ingreso se
 * registra sin ubicación (mismo camino y mismas advertencias que antes cuando
 * el GPS fallaba). El mecanismo de escritura del fichaje no cambia.
 */

/** Tope de la captura cuando corre en segundo plano (antes 10 s bloqueantes). */
export const GPS_INGRESO_TIMEOUT_MS = 30_000
/** Máximo que "Confirmar" espera a un GPS que todavía no llegó. */
export const TOPE_ESPERA_GPS_CONFIRMAR_MS = 3_000

export interface GpsEnSegundoPlano<R> {
  /** Intento de ingreso al que pertenece (para descartar resultados viejos). */
  intentoId: string | null
  promesa: Promise<R>
  /** Resultado si ya llegó; null si sigue en curso. */
  resultado: () => R | null
  /** Espera el resultado hasta `maxMs`; null si no llegó a tiempo. Nunca lanza. */
  esperar: (maxMs: number) => Promise<R | null>
}

/**
 * Lanza `adquirir` sin esperarla. `adquirir` no debería lanzar (adquirirGps
 * resuelve siempre); si lo hace, se trata como "sin resultado".
 */
export function lanzarGpsEnSegundoPlano<R>(
  adquirir: () => Promise<R>,
  intentoId: string | null,
  temporizador: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
  cancelarTemporizador: (t: unknown) => void = t => clearTimeout(t as ReturnType<typeof setTimeout>),
): GpsEnSegundoPlano<R> {
  let listo = false
  let valor: R | null = null
  const promesa = (async () => {
    const r = await adquirir()
    valor = r
    listo = true
    return r
  })()
  // Una falla inesperada no puede quedar como rechazo sin manejar.
  promesa.catch(() => { listo = true })

  return {
    intentoId,
    promesa,
    resultado: () => (listo ? valor : null),
    esperar: (maxMs: number) => {
      if (listo) return Promise.resolve(valor)
      return new Promise<R | null>(resolve => {
        const t = temporizador(() => resolve(null), Math.max(0, maxMs))
        promesa.then(
          r => { cancelarTemporizador(t); resolve(r) },
          () => { cancelarTemporizador(t); resolve(null) },
        )
      })
    },
  }
}
