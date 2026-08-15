/**
 * lib/observacion.ts
 *
 * Reglas y textos de la pantalla Observación del Sistema, separados de la UI
 * para poder testearlos. Implementa las decisiones de
 * docs/auditoria-metricas-telemetria.md (leer ese documento antes de tocar
 * cualquier métrica):
 *
 *   · el análisis de uso tiene un tope DELIBERADO de eventos; cuando el
 *     período real lo supera, hay que decirlo en la cara del usuario, no en
 *     un campo escondido del JSON;
 *   · el semáforo de estado se calcula SOLO con señales técnicas vivas —
 *     nada de novedades (tabla muerta desde mayo) ni de puestos descubiertos
 *     (eso es operación, no salud del software);
 *   · "posibles abandonos" es experimental mientras dependa del análisis
 *     parcial: puede entrar el inicio del fichaje y quedar afuera su
 *     confirmación;
 *   · la telemetría técnica (GPS, errores de cliente) describe DISPOSITIVOS,
 *     no desempeño de personas. Los títulos no pueden insinuar lo contrario.
 */

// ── Análisis parcial ─────────────────────────────────────────────────────────

/** true cuando la ventana real supera lo efectivamente analizado. */
export function esAnalisisParcial(analizados: number, totalVentana: number | null | undefined): boolean {
  if (totalVentana == null) return false
  return totalVentana > analizados
}

/**
 * Texto del aviso de análisis parcial, o null si el análisis fue completo.
 * "Análisis parcial: se analizaron 10.000 de 21.619 eventos del período."
 */
export function textoAnalisisParcial(analizados: number, totalVentana: number | null | undefined): string | null {
  if (!esAnalisisParcial(analizados, totalVentana)) return null
  const fmt = (n: number) => n.toLocaleString('es-AR')
  return `Análisis parcial: se analizaron ${fmt(analizados)} de ${fmt(totalVentana as number)} eventos del período. Los rankings y contadores de esta pestaña se calculan sobre esa muestra (los eventos más recientes), no sobre el total.`
}

// ── Semáforo técnico ─────────────────────────────────────────────────────────
//
// Qué lo mueve, y nada más que esto:
//   VERDE    — tasa de error del día ≤ 10% y menos de 10 errores en 48 h.
//   AMARILLO — tasa de error del día > 10% (con actividad suficiente) o
//              10 a 29 errores de aplicación en 48 h.
//   ROJO     — tasa de error del día > 20% (con actividad suficiente) o
//              30+ errores de aplicación en 48 h.
// Con menos de MIN_EVENTOS_SEMAFORO eventos en el día, la tasa no es señal
// (3 errores sobre 5 eventos no son "60% de fallas") y sólo cuentan los
// errores absolutos de 48 h.
//
// Deliberadamente NO participan: novedades (sin datos desde mayo 2026),
// puestos descubiertos ni ninguna métrica operativa — un puesto sin cubrir es
// un problema de la operación, no un software roto, y mezclarlos hacía
// ilegible el semáforo.

export const MIN_EVENTOS_SEMAFORO = 20
export const UMBRAL_TASA_ATENCION = 10
export const UMBRAL_TASA_CRITICO = 20
export const UMBRAL_ERRORES_48H_ATENCION = 10
export const UMBRAL_ERRORES_48H_CRITICO = 30

export type EstadoSemaforo = 'operativo' | 'atencion' | 'critico'

export function semaforoTecnico(params: {
  eventosHoy: number
  erroresHoy: number
  erroresRecientes48h: number
}): { estado: EstadoSemaforo; motivo: string } {
  const { eventosHoy, erroresHoy, erroresRecientes48h } = params
  const tasa = eventosHoy > 0 ? (erroresHoy / eventosHoy) * 100 : 0
  const tasaEsSenal = eventosHoy >= MIN_EVENTOS_SEMAFORO

  if (erroresRecientes48h >= UMBRAL_ERRORES_48H_CRITICO || (tasaEsSenal && tasa > UMBRAL_TASA_CRITICO)) {
    return {
      estado: 'critico',
      motivo: erroresRecientes48h >= UMBRAL_ERRORES_48H_CRITICO
        ? `${erroresRecientes48h} errores de aplicación en 48 h`
        : `Tasa de error del día ${tasa.toFixed(1)}% (umbral ${UMBRAL_TASA_CRITICO}%)`,
    }
  }

  if (erroresRecientes48h >= UMBRAL_ERRORES_48H_ATENCION || (tasaEsSenal && tasa > UMBRAL_TASA_ATENCION)) {
    return {
      estado: 'atencion',
      motivo: erroresRecientes48h >= UMBRAL_ERRORES_48H_ATENCION
        ? `${erroresRecientes48h} errores de aplicación en 48 h`
        : `Tasa de error del día ${tasa.toFixed(1)}% (umbral ${UMBRAL_TASA_ATENCION}%)`,
    }
  }

  return {
    estado: 'operativo',
    motivo: tasaEsSenal
      ? 'Errores dentro de lo normal'
      : 'Sin actividad suficiente hoy para medir tasa; sin acumulación de errores en 48 h',
  }
}

// ── Posibles abandonos (experimental) ────────────────────────────────────────

export const ETIQUETA_ABANDONOS = 'Posibles abandonos de ingreso (experimental)'

/** Nota obligatoria junto al número. Con análisis parcial, el dato NO es confiable. */
export function notaAbandonos(analisisParcial: boolean): string {
  return analisisParcial
    ? 'No confiable: el análisis es parcial y la confirmación del fichaje puede haber quedado fuera de la muestra, contando como abandono algo que se completó. No usar para evaluar personas.'
    : 'Aproximación por telemetría (inicios de fichaje sin confirmación el mismo día). No usar para evaluar personas.'
}

// ── Nombres que no confunden teléfono con empleado ───────────────────────────

/** Antes: "Acciones registradas" — un scroll contaba como "acción". */
export const ETIQUETA_EVENTOS_USO = 'Eventos de uso registrados'
export const AYUDA_EVENTOS_USO =
  'Interacciones con la aplicación registradas por telemetría (navegación, fichajes, fotos, errores). No equivalen a operaciones de negocio.'

/** Antes: "Guardias con más problemas de ubicación" — parecía conducta. */
export const TITULO_RANKING_GPS = 'Dispositivos con más incidencias de ubicación'
export const SUB_RANKING_GPS =
  'Señal técnica del teléfono: permisos, cobertura o precisión GPS. No mide desempeño del vigilador.'

/** Encabezado de la tabla de actividad por usuario (antes "Tasa de problema"). */
export const COLUMNA_ERRORES_TECNICOS = 'Errores técnicos'
export const SUB_ACTIVIDAD_USUARIO =
  'Uso de la aplicación por usuario. Los errores son técnicos (dispositivo, red, GPS): no describen desempeño operativo.'

// Una sola definición de "usuario activo" por pestaña, dicha explícitamente.
export const DEF_USUARIO_ACTIVO_USO =
  'Usuarios con al menos un evento dentro de la muestra analizada'
export const DEF_USUARIO_ACTIVO_ESTADO =
  'Usuarios que iniciaron sesión hoy'
