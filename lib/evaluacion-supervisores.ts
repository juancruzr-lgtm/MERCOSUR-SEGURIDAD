/**
 * lib/evaluacion-supervisores.ts
 *
 * Evaluación de supervisores — Etapa 1 (sólo lectura).
 *
 * El cálculo vive en la base (migración 20261028120000): acá están los tipos
 * de lo que devuelven las RPC, el período por defecto, quién la ve y las tasas
 * que muestra la pantalla. Nada de esto escribe.
 *
 * Decisiones de JC (16/10/2026):
 *  · Una alerta con dos supervisores de guardia es de LOS DOS; si uno
 *    interviene, al otro le figura «intervenida por otro» y no le resta.
 *  · Los jefes de supervisores entran en el ranking como uno más.
 *  · La evaluación arranca el 08/10/2026; un período anterior es referencia.
 *  · La ven sólo Dirección Operativa y Gerencia (o delegación gerencial).
 *    NO alcanza con acceso_admin_pleno ni acceso_interfaz_admin.
 */

import { puestoDe, type SujetoAcceso } from './capacidades'
import { fechaArgentina, sumarDias } from './periodo-argentina'

/** Primer día evaluable (antes: sólo referencia, por el cierre masivo del 07/10). */
export const INICIO_EVALUACION = '2026-10-08'
/** Mismo tope que valida la base. */
export const MAX_DIAS_RANGO = 92

export interface FilaEvaluacionSupervisor {
  supervisor_id: string
  supervisor: string
  puesto: string | null
  zonas: string | null
  es_referencia: boolean
  horas_guardia: number
  jornadas_guardia: number
  supervisiones: number
  vencimientos_supervision: number
  horas_objetivo_vencidas: number
  rondas_alertas: number
  rondas_intervenidas_propias: number
  rondas_intervenidas_por_otro: number
  rondas_cerradas_sin_intervencion: number
  rondas_sin_atender: number
  mediana_min_intervencion: number | null
  reincidencias_sin_accion: number
  asistencia_avisos: number
  asistencia_acciones: number
}

export type EstadoAtencion =
  | 'intervenida_propia'
  | 'intervenida_por_otro'
  | 'cerrada_sin_intervencion'
  | 'sin_atender'

export interface AlertaRondaAtribuida {
  ronda_alerta_id: string
  origen_atribucion: string
  tipo: string
  objetivo: string | null
  vigilador: string | null
  detectada_at: string
  primera_propia_at: string | null
  minutos_a_intervenir: number | null
  estado_atencion: EstadoAtencion
  reincidente_sin_accion: boolean
}

export interface VencimientoSupervision {
  objetivo: string
  vencio_at: string
  regularizado_at: string | null
  horas_vencido: number
}

export const ETIQUETA_ESTADO_ATENCION: Record<EstadoAtencion, string> = {
  intervenida_propia: 'Intervino',
  intervenida_por_otro: 'Intervino otro',
  cerrada_sin_intervencion: 'Cerrada sin intervención',
  sin_atender: 'Sin atender',
}

export const ETIQUETA_ORIGEN: Record<string, string> = {
  aviso: 'Recibió el aviso',
  guardia_efectiva: 'De guardia',
  unico_responsable_zona: 'Único de la zona',
}

/** Espejo de `puede_evaluar_supervisores_actual()` en la base. */
export function puedeVerEvaluacionSupervisores(u: SujetoAcceso | null | undefined): boolean {
  if (!u) return false
  const puesto = puestoDe(u)
  return puesto === 'direccion_operativa' || puesto === 'gerencia' || u.acceso_gerencia_delegado === true
}

/** Período por defecto: del 1º del mes (o del 08/10/2026, si es posterior) a hoy. */
export function periodoPorDefecto(ahora: Date = new Date()): { desde: string; hasta: string } {
  const hoy = fechaArgentina(ahora)
  const primeroDelMes = `${hoy.slice(0, 7)}-01`
  const desde = primeroDelMes < INICIO_EVALUACION ? INICIO_EVALUACION : primeroDelMes
  return { desde: desde > hoy ? hoy : desde, hasta: hoy }
}

/** null si el rango es válido; si no, el motivo para mostrar. */
export function validarRango(desde: string, hasta: string): string | null {
  const re = /^\d{4}-\d{2}-\d{2}$/
  if (!re.test(desde) || !re.test(hasta)) return 'Elegí las dos fechas.'
  if (hasta < desde) return 'La fecha final es anterior a la inicial.'
  if (sumarDias(desde, MAX_DIAS_RANGO) < hasta) return `El rango máximo es de ${MAX_DIAS_RANGO} días.`
  return null
}

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null)

/** Tasas derivadas para la tabla. null = sin alertas (no hay qué medir). */
export function tasas(f: FilaEvaluacionSupervisor) {
  return {
    /** Las que intervino él / las que le tocaron. */
    atencionPropia: pct(f.rondas_intervenidas_propias, f.rondas_alertas),
    /** Las que intervino alguien (él u otro) / las que le tocaron. */
    atencionEquipo: pct(f.rondas_intervenidas_propias + f.rondas_intervenidas_por_otro, f.rondas_alertas),
    /** Sin atender por nadie / las que le tocaron. */
    sinAtender: pct(f.rondas_sin_atender, f.rondas_alertas),
  }
}

/**
 * Orden del ranking: mayor atención propia primero; sin alertas al final;
 * desempate por menos sin atender y por nombre. Es un orden de lectura, no
 * el score (el score ponderado es la Etapa 4).
 */
export function ordenarRanking(filas: readonly FilaEvaluacionSupervisor[]): FilaEvaluacionSupervisor[] {
  return [...filas].sort((a, b) => {
    const ta = tasas(a).atencionPropia
    const tb = tasas(b).atencionPropia
    if (ta === null && tb !== null) return 1
    if (tb === null && ta !== null) return -1
    if (ta !== null && tb !== null && ta !== tb) return tb - ta
    if (a.rondas_sin_atender !== b.rondas_sin_atender) return a.rondas_sin_atender - b.rondas_sin_atender
    return a.supervisor.localeCompare(b.supervisor, 'es')
  })
}

/** Minutos legibles: 45 min · 3 h 20 min · 2 d 4 h. */
export function duracionLegible(minutos: number | null | undefined): string {
  if (minutos === null || minutos === undefined || !Number.isFinite(Number(minutos))) return '—'
  const m = Math.max(0, Math.round(Number(minutos)))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`
}

/** PostgREST devuelve numeric como string: normaliza a number. */
function normalizarFila(r: any): FilaEvaluacionSupervisor {
  const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
  return {
    ...r,
    horas_guardia: n(r.horas_guardia),
    horas_objetivo_vencidas: n(r.horas_objetivo_vencidas),
    mediana_min_intervencion: r.mediana_min_intervencion === null || r.mediana_min_intervencion === undefined
      ? null : Number(r.mediana_min_intervencion),
  }
}

function mensaje(error: any): string {
  return error?.message ?? String(error)
}

export async function cargarEvaluacionSupervisores(
  db: any, desde: string, hasta: string,
): Promise<{ data: FilaEvaluacionSupervisor[]; error: string | null }> {
  const { data, error } = await db.rpc('evaluacion_supervisores_periodo', { p_desde: desde, p_hasta: hasta })
  if (error) return { data: [], error: mensaje(error) }
  return { data: (data ?? []).map(normalizarFila), error: null }
}

export async function cargarDetalleSupervisor(
  db: any, supervisorId: string, desde: string, hasta: string,
): Promise<{ alertas: AlertaRondaAtribuida[]; vencimientos: VencimientoSupervision[]; error: string | null }> {
  const args = { p_supervisor_id: supervisorId, p_desde: desde, p_hasta: hasta }
  const [a, v] = await Promise.all([
    db.rpc('evaluacion_supervisor_detalle_rondas', args),
    db.rpc('evaluacion_supervisor_detalle_vencimientos', args),
  ])
  const errores = [a.error && `alertas: ${mensaje(a.error)}`, v.error && `vencimientos: ${mensaje(v.error)}`].filter(Boolean)
  return {
    alertas: (a.data ?? []).map((r: any) => ({
      ...r, minutos_a_intervenir: r.minutos_a_intervenir === null ? null : Number(r.minutos_a_intervenir),
    })),
    vencimientos: (v.data ?? []).map((r: any) => ({ ...r, horas_vencido: Number(r.horas_vencido ?? 0) })),
    error: errores.length ? errores.join(' · ') : null,
  }
}
