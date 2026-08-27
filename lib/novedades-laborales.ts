// Cómo la empresa califica un día, y qué de eso puede usar Cumplimiento.
//
// ── El flujo real, auditado ─────────────────────────────────────────────────
// Administración califica una jornada desde REPORTES. Esa pantalla escribe una
// fila en `novedades_laborales` con:
//
//   tipo          estructurado, de una lista cerrada (no texto libre)
//   fecha_desde   = fecha_hasta = el día que se está calificando
//   estado        'aprobada', en el mismo acto
//   cargado_por / aprobado_por / aprobado_at   quién y cuándo
//
// Es decir: el motivo NO es una inferencia nuestra ni una interpretación de un
// comentario. Es un valor que una persona de Administración eligió de un menú y
// aprobó con su usuario. Eso es lo que hace defendible una falta crítica.
//
// ── Lo que NO es fuente de ausencia ─────────────────────────────────────────
// `registros_asistencia.tipo_registro = 'ausencia'` existe y alimenta hoy la
// dimensión Asistencia, pero NINGUNA pantalla de la aplicación lo escribe: el
// código sólo lo lee. En agosto de 2026 hay una sola fila así en 1115 jornadas.
// Es un camino heredado.
//
// Se deja funcionando como está —sacarlo cambiaría Asistencia sin que nadie lo
// haya pedido— pero la falta CRÍTICA no se apoya en él: se apoya en lo que
// Administración eligió explícitamente.

/** La lista cerrada del menú de Reportes. */
export type TipoNovedad =
  | 'parte_medico' | 'accidente' | 'licencia' | 'vacaciones'
  | 'falta_justificada' | 'falta_injustificada' | 'dia_estudio'
  | 'suspension' | 'franco' | 'otra'

export interface NovedadLaboral {
  empleado_id: string
  tipo: string
  fecha_desde: string
  fecha_hasta: string
  estado: string
}

/**
 * Las tres respuestas posibles sobre un día, y ninguna se infiere.
 *
 *   injustificada   Administración eligió 'falta_injustificada' y está aprobada.
 *   justificada     eligió cualquier otro motivo que explica la ausencia.
 *   sin_clasificar  no hay novedad aprobada para ese día. NO significa que
 *                   faltó: significa que nadie dijo nada.
 */
export type Clasificacion = 'injustificada' | 'justificada' | 'sin_clasificar'

/**
 * Los motivos que justifican no estar. `otra` NO está: es un cajón de sastre y
 * tratarlo como justificación sería adivinar.
 *
 * `suspension` tampoco justifica en el sentido de "no le corresponde
 * penalización", pero tampoco es una falta sin aviso: es una decisión de la
 * empresa. Va como justificada porque lo que la regla crítica castiga es faltar
 * sin avisar, y una suspensión es exactamente lo contrario.
 */
const JUSTIFICAN: TipoNovedad[] = [
  'parte_medico', 'accidente', 'licencia', 'vacaciones',
  'falta_justificada', 'dia_estudio', 'suspension', 'franco',
]

/** Sólo cuenta lo aprobado. Pendiente y rechazada no afirman nada. */
export function novedadesAprobadas(novedades: NovedadLaboral[]): NovedadLaboral[] {
  return novedades.filter(n => n.estado === 'aprobada')
}

/** Comparación de fechas ISO como texto: `YYYY-MM-DD` ordena lexicográficamente. */
function cubre(n: NovedadLaboral, fecha: string): boolean {
  return n.fecha_desde <= fecha && fecha <= n.fecha_hasta
}

/**
 * Qué dijo Administración sobre ESE día de ESA persona.
 *
 * Si hay más de una novedad para el mismo día, una justificación gana sobre la
 * falta injustificada. Es deliberado y va a favor del empleado: si alguien
 * cargó primero "falta injustificada" y después "parte médico", la segunda es
 * la que corrige a la primera, y en la duda no se aplaza.
 */
export function clasificarDia(
  novedades: NovedadLaboral[], empleadoId: string, fecha: string,
): Clasificacion {
  const suyas = novedadesAprobadas(novedades)
    .filter(n => n.empleado_id === empleadoId && cubre(n, fecha))
  if (suyas.length === 0) return 'sin_clasificar'
  if (suyas.some(n => JUSTIFICAN.indexOf(n.tipo as TipoNovedad) >= 0)) return 'justificada'
  if (suyas.some(n => n.tipo === 'falta_injustificada')) return 'injustificada'
  return 'sin_clasificar'
}

/**
 * Cuántas inasistencias injustificadas confirmadas tiene en el período.
 *
 * Cuenta DÍAS, no filas: una novedad de rango largo cargada desde otro flujo
 * podría cubrir varios días, y contar filas diría "1" donde hubo cinco. Se
 * cuentan sólo los días efectivamente trabajables que se le pasen, para no
 * inventar faltas en días que no tenía turno.
 */
export function inasistenciasInjustificadas(
  novedades: NovedadLaboral[], empleadoId: string, fechasConTurno: string[],
): number {
  const unicas = Array.from(new Set(fechasConTurno))
  return unicas.filter(f => clasificarDia(novedades, empleadoId, f) === 'injustificada').length
}

/**
 * ⚠️ PENDIENTE, y a propósito.
 *
 * Un franco, una licencia o unas vacaciones aprobadas deberían sacar esa
 * jornada del denominador de TODAS las dimensiones: no se le puede exigir una
 * ronda a alguien que estaba de licencia. Hoy no lo hacen, y conectarlo cambia
 * el denominador de mucha gente a la vez.
 *
 * No se hace en este cambio porque no se pudo medir el impacto contra los datos
 * reales —la sesión de producción estaba caída— y mover el denominador a ciegas
 * es exactamente el tipo de cambio que después nadie sabe explicar.
 */
export const JORNADAS_JUSTIFICADAS_SALEN_DEL_UNIVERSO = false
