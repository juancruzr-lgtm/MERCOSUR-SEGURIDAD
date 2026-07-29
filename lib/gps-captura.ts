// Captura de una lectura GPS NUEVA, con watchPosition.
//
// iPhone/Safari responden `getCurrentPosition` repitiendo la primera lectura de
// la sesión: al crear varios puntos de ronda seguidos salían todos con las mismas
// coordenadas. La solución fue escuchar varias lecturas y quedarse con la mejor
// posterior al inicio de la captura. Este módulo es esa lógica, en un solo lugar,
// para que la creación de puntos y el registro de puntos no puedan divergir.
//
// No toca React ni estado: devuelve la promesa de la lectura ganadora y un
// `cancelar()` para cortar el watcher al desmontar o al abandonar el flujo.

const GPS_CAPTURA_MAX_MS = 15000     // tope duro de captura
const GPS_CAPTURA_MIN_MS = 3000      // no cerrar antes de ~3 s
const GPS_PRECISION_OK_M = 30        // accuracy razonable para cerrar antes
const GPS_TOLERANCIA_TS_MS = 2000    // lecturas hasta 2 s previas se toleran

export type MotivoFalloGps =
  | 'sin_soporte'
  | 'permiso_denegado'
  | 'sin_lectura'

export type ResultadoCapturaGps =
  | { ok: true; posicion: GeolocationPosition }
  | { ok: false; motivo: MotivoFalloGps }

export interface CapturaGpsEnCurso {
  promesa: Promise<ResultadoCapturaGps>
  /** Corta el watcher y el temporizador. Idempotente. */
  cancelar: () => void
}

export interface OpcionesCapturaGps {
  /**
   * Se llama con la mejor precisión conseguida hasta el momento, en metros, cada
   * vez que llega una lectura. Sirve para dar señal de avance durante la espera.
   */
  onProgreso?: (precisionMetros: number) => void
}

/**
 * Escucha posiciones hasta quedarse con la mejor lectura nueva.
 *
 * Cierra antes de tiempo si consigue una lectura posterior al inicio, con
 * precisión razonable y pasado el mínimo de espera; si no, corta al tope duro y
 * devuelve la mejor que haya. Un error de geolocalización con una lectura útil ya
 * guardada la aprovecha en lugar de fallar.
 */
export function capturarGpsNuevo(opciones: OpcionesCapturaGps = {}): CapturaGpsEnCurso {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return {
      promesa: Promise.resolve({ ok: false, motivo: 'sin_soporte' }),
      cancelar: () => {},
    }
  }

  const inicio = Date.now()
  let watchId: number | null = null
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let mejor: GeolocationPosition | null = null
  let cerrado = false

  const limpiar = () => {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId)
      watchId = null
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  let cancelar = () => { cerrado = true; limpiar() }

  const promesa = new Promise<ResultadoCapturaGps>(resolve => {
    const cerrar = (resultado: ResultadoCapturaGps) => {
      if (cerrado) return
      cerrado = true
      limpiar()
      resolve(resultado)
    }

    // Cancelar desde afuera resuelve con la mejor lectura que haya: quien cancela
    // ya dejó de esperar, pero la promesa no puede quedar colgada.
    cancelar = () => {
      limpiar()
      cerrar(mejor ? { ok: true, posicion: mejor } : { ok: false, motivo: 'sin_lectura' })
    }

    const finalizar = () => {
      cerrar(mejor ? { ok: true, posicion: mejor } : { ok: false, motivo: 'sin_lectura' })
    }

    watchId = navigator.geolocation.watchPosition(
      posicion => {
        // Descartar lecturas claramente anteriores al inicio de la captura.
        if (posicion.timestamp < inicio - GPS_TOLERANCIA_TS_MS) return

        const esPosterior = posicion.timestamp >= inicio
        if (!mejor) {
          mejor = posicion
        } else {
          const previaPosterior = mejor.timestamp >= inicio
          // Preferir una lectura posterior al inicio; a igualdad, menor accuracy.
          if (esPosterior && !previaPosterior) {
            mejor = posicion
          } else if (esPosterior === previaPosterior && posicion.coords.accuracy < mejor.coords.accuracy) {
            mejor = posicion
          }
        }

        opciones.onProgreso?.(mejor.coords.accuracy)

        // Cierre anticipado: lectura nueva, precisión razonable y mínimo de tiempo.
        const transcurrido = Date.now() - inicio
        if (
          mejor.timestamp >= inicio
          && mejor.coords.accuracy <= GPS_PRECISION_OK_M
          && transcurrido >= GPS_CAPTURA_MIN_MS
        ) {
          finalizar()
        }
      },
      fallo => {
        // Si ya hay una lectura útil, usarla; si no, informar el error.
        if (mejor) {
          finalizar()
          return
        }
        cerrar({
          ok: false,
          motivo: fallo.code === fallo.PERMISSION_DENIED ? 'permiso_denegado' : 'sin_lectura',
        })
      },
      { enableHighAccuracy: true, timeout: GPS_CAPTURA_MAX_MS, maximumAge: 0 },
    )

    timeoutId = setTimeout(finalizar, GPS_CAPTURA_MAX_MS)
  })

  return { promesa, cancelar: () => cancelar() }
}
