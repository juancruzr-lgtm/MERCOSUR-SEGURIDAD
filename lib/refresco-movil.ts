/**
 * lib/refresco-movil.ts
 *
 * Política ÚNICA de refresco de las pantallas móviles (vigilador, rondas,
 * protocolos). Antes cada componente tenía la suya: GuardiaMobile cada 60 s +
 * visibilitychange + focus + online; RondasGuardiaPanel otro tanto sin
 * deduplicar (al volver a la app, visibilitychange y focus llegan juntos y
 * cargaba dos veces); protocolos cada 5 min aunque la pantalla estuviera
 * apagada. Con datos móviles prepagos eso se nota.
 *
 *   · Intervalo de fondo: 3 min, sólo con la pantalla visible.
 *   · Volver a primer plano (visibilitychange/focus/pageshow): UN disparo
 *     compartido, agrupado (los eventos que llegan juntos cuentan una vez) y
 *     sólo si pasaron ≥30 s desde la última carga de ese componente.
 *   · Reconexión (`online`): dispara siempre, sin esperar los 30 s — es la
 *     que vacía colas offline.
 *   · Catálogos (objetivos/puestos): cada 30 min o cuando falta uno.
 *   · Contadores de planilla: al montar y cada 15 min.
 */

export const INTERVALO_REFRESCO_MS = 3 * 60 * 1000
export const MIN_ENTRE_CARGAS_PRIMER_PLANO_MS = 30 * 1000
export const INTERVALO_CATALOGO_MS = 30 * 60 * 1000
export const INTERVALO_PLANILLA_MS = 15 * 60 * 1000
/** Ventana en la que visibilitychange + focus + pageshow cuentan como uno. */
export const AGRUPAR_EVENTOS_MS = 400

export type MotivoPrimerPlano = 'visible' | 'online'

/** ¿Corresponde recargar por volver a primer plano? */
export function debeRecargarPorPrimerPlano(
  ahoraMs: number,
  ultimaCargaMs: number | null,
  motivo: MotivoPrimerPlano,
  minMs: number = MIN_ENTRE_CARGAS_PRIMER_PLANO_MS,
): boolean {
  if (motivo === 'online') return true
  if (ultimaCargaMs === null) return true
  return ahoraMs - ultimaCargaMs >= minMs
}

type Oyente = (motivo: MotivoPrimerPlano) => void

type EntornoEventos = {
  doc: Pick<Document, 'addEventListener' | 'removeEventListener'> & { visibilityState?: string }
  win: Pick<Window, 'addEventListener' | 'removeEventListener'>
  programar: (fn: () => void, ms: number) => unknown
  cancelar: (id: unknown) => void
}

/**
 * Disparador compartido de "volvió a primer plano". Los oyentes DOM se
 * registran una sola vez, con el primer suscriptor, y se quitan con el último.
 */
export function crearDisparadorPrimerPlano(entorno: EntornoEventos) {
  const oyentes = new Set<Oyente>()
  let pendiente: unknown = null
  let motivoPendiente: MotivoPrimerPlano = 'visible'

  const emitir = () => {
    pendiente = null
    const motivo = motivoPendiente
    motivoPendiente = 'visible'
    Array.from(oyentes).forEach(o => { try { o(motivo) } catch { /* un oyente no corta a los demás */ } })
  }

  const agendar = (motivo: MotivoPrimerPlano) => {
    if (motivo === 'online') motivoPendiente = 'online'
    if (pendiente !== null) return
    pendiente = entorno.programar(emitir, AGRUPAR_EVENTOS_MS)
  }

  const alVisible = () => {
    if (entorno.doc.visibilityState && entorno.doc.visibilityState !== 'visible') return
    agendar('visible')
  }
  const alOnline = () => agendar('online')

  const enganchar = () => {
    entorno.doc.addEventListener('visibilitychange', alVisible)
    entorno.win.addEventListener('focus', alVisible)
    entorno.win.addEventListener('pageshow', alVisible)
    entorno.win.addEventListener('online', alOnline)
  }
  const soltar = () => {
    entorno.doc.removeEventListener('visibilitychange', alVisible)
    entorno.win.removeEventListener('focus', alVisible)
    entorno.win.removeEventListener('pageshow', alVisible)
    entorno.win.removeEventListener('online', alOnline)
    if (pendiente !== null) { entorno.cancelar(pendiente); pendiente = null }
  }

  return {
    suscribir(oyente: Oyente): () => void {
      if (oyentes.size === 0) enganchar()
      oyentes.add(oyente)
      return () => {
        oyentes.delete(oyente)
        if (oyentes.size === 0) soltar()
      }
    },
    cantidad: () => oyentes.size,
  }
}

let disparadorGlobal: ReturnType<typeof crearDisparadorPrimerPlano> | null = null

/** El disparador del navegador (singleton). `null` fuera del navegador. */
export function disparadorPrimerPlano() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  if (!disparadorGlobal) {
    disparadorGlobal = crearDisparadorPrimerPlano({
      doc: document,
      win: window,
      programar: (fn, ms) => window.setTimeout(fn, ms),
      cancelar: id => window.clearTimeout(id as number),
    })
  }
  return disparadorGlobal
}

// ── Diagnóstico: última actualización conocida, para la pantalla Diagnóstico ──
let ultimaActualizacionGlobal: number | null = null
export function registrarActualizacion(ms: number = Date.now()) { ultimaActualizacionGlobal = ms }
export function ultimaActualizacion(): number | null { return ultimaActualizacionGlobal }
