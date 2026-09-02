/**
 * lib/clasificacion-dia.ts
 *
 * Clasificar día en Reportes, para CUALQUIER día del mes: con turno, sin
 * turno, con o sin fichaje. Es la herramienta de cierre mensual: antes de
 * liquidar, Administración le pone nombre a cada jornada que quedó abierta.
 *
 * ── Qué es una ausencia acá ────────────────────────────────────────────────
 * La fuente de verdad es `novedades_laborales` (tipo estructurado + estado
 * 'aprobada'), la misma fila que ya consume la falta crítica de Cumplimiento
 * (lib/novedades-laborales). NO se toca el estado del turno:
 *
 *   · 'anulado' significa "el servicio no debía existir" y saca el turno de
 *     TODO (liquidación, patrones de cobertura, dedup de Completar mes vía
 *     ESTADOS_SIN_OBLIGACION). Usarlo para una falta recrearía el hueco en la
 *     grilla y borraría la historia de que el vigilador debía presentarse.
 *   · La ausencia es lo contrario: el turno existía, el vigilador faltó. El
 *     turno queda intacto (fecha, horario, objetivo, guardia) y la novedad
 *     aprobada es la que cambia cómo se LEE: 0 h liquidables ya lo eran por
 *     no haber fichaje; lo que agrega la clasificación es que deje de figurar
 *     como "Sin fichar" pendiente y pase a decir qué pasó.
 *
 * ── Reclasificar sin duplicar ──────────────────────────────────────────────
 * clasificarDia() de lib/novedades-laborales hace que una justificación le
 * GANE a la falta injustificada cuando conviven en el mismo día (regla
 * deliberada, pro-empleado). Por eso "parte médico → falta injustificada" no
 * puede resolverse insertando otra fila: la vieja seguiría ganando. La única
 * vía correcta es ACTUALIZAR la novedad existente del día, dejando el rastro
 * (tipo anterior → nuevo, quién, cuándo) en la observación, o anularla
 * ('anulada' la saca de todos los consumidores, que filtran 'aprobada', sin
 * borrar la fila).
 *
 * Sólo se editan novedades de UN día (fecha_desde = fecha_hasta), que es lo
 * único que este flujo crea. Una novedad de rango largo cargada desde otro
 * lado no se pisa desde acá: partirla a ciegas es inventar historia.
 */

import { ETIQUETA_TURNO_SIN_OBLIGACION } from '@/lib/planilla-acciones'
import type { TipoNovedad } from '@/lib/novedades-laborales'

export const TIPOS_NOVEDAD_DIA: ReadonlyArray<{ value: TipoNovedad; label: string }> = [
  { value: 'franco', label: 'Franco' },
  { value: 'vacaciones', label: 'Vacaciones' },
  { value: 'licencia', label: 'Licencia' },
  { value: 'parte_medico', label: 'Parte médico / Enfermedad' },
  { value: 'accidente', label: 'Accidente' },
  { value: 'falta_justificada', label: 'Falta justificada' },
  { value: 'falta_injustificada', label: 'Falta injustificada' },
  { value: 'dia_estudio', label: 'Día de estudio' },
  { value: 'suspension', label: 'Suspensión' },
  { value: 'otra', label: 'Otra novedad' },
] as const

export function labelNovedadDia(tipo: string): string {
  return TIPOS_NOVEDAD_DIA.find(t => t.value === tipo)?.label || tipo
}

export interface NovedadDia {
  id?: string
  empleado_id: string
  tipo: string
  fecha_desde: string
  fecha_hasta: string
  estado: string
  observacion?: string | null
}

/** Sólo la falta injustificada es AUSENCIA a secas: faltó sin aviso ni causa. */
export const esAusencia = (tipo: string): boolean => tipo === 'falta_injustificada'

/**
 * La novedad aprobada que cubre ese día de esa persona, si hay una.
 * Si conviven varias (no debería: este flujo actualiza en vez de duplicar),
 * se prefiere la de un solo día, que es la editable desde Reportes.
 */
export function novedadDelDia(
  novedades: readonly NovedadDia[], empleadoId: string, fecha: string,
): NovedadDia | null {
  const cubren = novedades.filter(n =>
    n.estado === 'aprobada' && n.empleado_id === empleadoId &&
    n.fecha_desde <= fecha && fecha <= n.fecha_hasta)
  if (cubren.length === 0) return null
  return cubren.find(n => n.fecha_desde === n.fecha_hasta) ?? cubren[0]
}

/** Cómo se lee el día clasificado en la planilla. */
export function etiquetaDia(novedad: NovedadDia): string {
  return esAusencia(novedad.tipo)
    ? `Ausencia — ${labelNovedadDia(novedad.tipo)}`
    : labelNovedadDia(novedad.tipo)
}

/**
 * Qué dice la columna Estado de una fila CON turno cuando el día tiene
 * clasificación. Tres cortes, en orden:
 *
 *   1. Un turno fuera del mes (Anulado/Cancelado/Reemplazado) se sigue
 *      leyendo así: el anulado real y el reemplazo NO se disfrazan de
 *      ausencia — cuentan otra historia y el titular no faltó.
 *   2. Si hubo cobertura real (fichaje u horas), manda lo trabajado: una
 *      novedad no puede tapar un día efectivamente trabajado.
 *   3. Recién entonces habla la clasificación: "Ausencia — Falta
 *      injustificada", "Parte médico", etc., en lugar de "Sin fichar" o
 *      "Descubierto", que son precisamente lo que el cierre viene a resolver.
 */
export function estadoFilaClasificada(
  estadoBase: string, novedad: NovedadDia | null, tieneCobertura: boolean,
): string {
  if (Object.values(ETIQUETA_TURNO_SIN_OBLIGACION).includes(estadoBase)) return estadoBase
  if (!novedad || tieneCobertura) return estadoBase
  return etiquetaDia(novedad)
}

export type PlanClasificacion =
  | { accion: 'crear' }
  | { accion: 'actualizar'; id: string }
  | { accion: 'bloqueada'; motivo: string }

/**
 * Crear, actualizar o no tocar. Actualizar exige novedad de un solo día;
 * un rango multi-día se administra desde donde se cargó, no partiéndolo acá.
 */
export function planGuardarClasificacion(existente: NovedadDia | null): PlanClasificacion {
  if (!existente) return { accion: 'crear' }
  if (existente.fecha_desde !== existente.fecha_hasta) {
    return {
      accion: 'bloqueada',
      motivo: `Este día está dentro de una novedad del ${existente.fecha_desde} al ${existente.fecha_hasta} (${labelNovedadDia(existente.tipo)}). Modificala desde la pantalla de Novedades: desde acá sólo se editan clasificaciones de un día.`,
    }
  }
  if (!existente.id) return { accion: 'bloqueada', motivo: 'La novedad existente no tiene id: recargá la pantalla.' }
  return { accion: 'actualizar', id: existente.id }
}

/**
 * La observación es el rastro de auditoría de la reclasificación: tipo
 * anterior → nuevo, quién y cuándo, sin perder lo que ya decía la fila.
 */
export function observacionReclasificacion(
  existente: NovedadDia, tipoNuevo: string, observacionNueva: string, quien: string, cuandoISO: string,
): string {
  const partes = [
    observacionNueva.trim() || null,
    `[Reclasificado: ${labelNovedadDia(existente.tipo)} → ${labelNovedadDia(tipoNuevo)} · ${cuandoISO.slice(0, 10)} · ${quien}]`,
    existente.observacion?.trim() || null,
  ]
  return partes.filter(Boolean).join(' | ')
}

/**
 * Cuántos días del mes quedaron clasificados, para el resumen mensual —
 * el mismo tratamiento que ya tienen los feriados: se cuentan DÍAS, no filas,
 * porque una novedad de rango cubre varios y contar filas diría "1" donde
 * hubo cinco. Sólo cuenta lo aprobado y sólo dentro del mes pedido.
 */
export function resumenClasificacionMes(
  novedades: readonly NovedadDia[], empleadoId: string, mes: string,
): { ausencias: number; justificados: number; total: number } {
  const dias = new Set<string>()
  const ausentes = new Set<string>()
  for (const n of novedades) {
    if (n.estado !== 'aprobada' || n.empleado_id !== empleadoId) continue
    const desde = n.fecha_desde > `${mes}-01` ? n.fecha_desde : `${mes}-01`
    const hasta = n.fecha_hasta < `${mes}-31` ? n.fecha_hasta : `${mes}-31`
    for (let f = desde; f <= hasta; f = sumarUnDia(f)) {
      if (!f.startsWith(mes)) continue
      dias.add(f)
      if (esAusencia(n.tipo)) ausentes.add(f)
    }
  }
  // Una justificación gana sobre la falta en el mismo día, igual que en
  // clasificarDia(): no se cuenta dos veces ni se marca ausente un día que
  // además tiene un motivo que lo explica.
  for (const n of novedades) {
    if (n.estado !== 'aprobada' || n.empleado_id !== empleadoId || esAusencia(n.tipo)) continue
    for (const f of Array.from(ausentes)) {
      if (n.fecha_desde <= f && f <= n.fecha_hasta) ausentes.delete(f)
    }
  }
  return { ausencias: ausentes.size, justificados: dias.size - ausentes.size, total: dias.size }
}

function sumarUnDia(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number)
  const siguiente = new Date(Date.UTC(y, m - 1, d + 1))
  return siguiente.toISOString().slice(0, 10)
}

/** Rastro al quitar una clasificación (la fila pasa a estado 'anulada', no se borra). */
export function observacionQuitar(existente: NovedadDia, quien: string, cuandoISO: string): string {
  const partes = [
    `[Clasificación quitada (${labelNovedadDia(existente.tipo)}) · ${cuandoISO.slice(0, 10)} · ${quien}]`,
    existente.observacion?.trim() || null,
  ]
  return partes.filter(Boolean).join(' | ')
}
