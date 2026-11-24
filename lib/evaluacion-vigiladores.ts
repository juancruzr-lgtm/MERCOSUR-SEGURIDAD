/**
 * lib/evaluacion-vigiladores.ts
 *
 * Evaluación mensual de vigiladores por supervisor (planilla R 6.2 (3)).
 *
 * Decisiones de JC (24/11/2026):
 *   · cada mes, cada supervisor evalúa a los vigiladores de su zona;
 *   · siete criterios de 1 a 10, "como el resto de la app": el puntaje es el
 *     promedio y el concepto sale de la misma escala que la nota mensual;
 *   · el supervisor sólo ve sus evaluaciones; Administración y Gerencia, todas;
 *   · no bloquea nada y, por ahora, no mueve la nota mensual (sólo informa).
 *
 * La autorización NO se decide acá: las RPC toman la identidad de auth.uid() y
 * controlan la zona; la tabla sólo se lee, recortada por RLS.
 */

import { supabase } from '@/lib/supabase'
import { conceptoDe } from '@/lib/evaluacion-final'

export type ClaveCriterio =
  | 'asistencia_puntualidad'
  | 'pulcritud'
  | 'disposicion'
  | 'relacion_objetivo'
  | 'relacion_supervisores'
  | 'relacion_companeros'
  | 'concepto_general'

/** Las columnas de la planilla en papel, en el mismo orden. */
export const CRITERIOS: Array<{ clave: ClaveCriterio; etiqueta: string; planilla: string }> = [
  { clave: 'asistencia_puntualidad', etiqueta: 'Asistencia y puntualidad', planilla: 'ASIS. Y PUNT.' },
  { clave: 'pulcritud', etiqueta: 'Pulcritud', planilla: 'PULCR.' },
  { clave: 'disposicion', etiqueta: 'Disposición', planilla: 'DISPOC.' },
  { clave: 'relacion_objetivo', etiqueta: 'Relación con el objetivo', planilla: 'R. C/ EL OBJ.' },
  { clave: 'relacion_supervisores', etiqueta: 'Relación con los supervisores', planilla: 'R. C/ LOS SUP.' },
  { clave: 'relacion_companeros', etiqueta: 'Relación con sus compañeros', planilla: 'R. C/SUS COMP.' },
  { clave: 'concepto_general', etiqueta: 'Concepto general', planilla: 'CONCEP.' },
]

export type Criterios = Record<ClaveCriterio, number | null>

export const AYUDA_PLAN_ACCION = 'Aclarar los objetivos en los que no puede prestar servicio.'

export interface EvaluacionVigilador extends Record<ClaveCriterio, number> {
  id: string
  periodo: string
  supervisor_id: string
  vigilador_id: string
  puntaje: number
  observaciones: string | null
  plan_accion: string | null
  origen: 'campana' | 'supervision'
  created_at: string
  updated_at: string
}

export interface VigiladorAEvaluar {
  vigilador_id: string
  nombre: string | null
  apellido: string | null
  legajo: string | null
  objetivo: string | null
  evaluacion: EvaluacionVigilador | null
}

export interface ListaDelMes {
  periodo: string
  cierra: string
  /** Administración evalúa cuando quiere: la tarjeta no le insiste. */
  opcional?: boolean
  vigiladores: VigiladorAEvaluar[]
}

export function criteriosVacios(): Criterios {
  return Object.fromEntries(CRITERIOS.map(c => [c.clave, null])) as Criterios
}

export function criteriosDe(e: EvaluacionVigilador | null): Criterios {
  if (!e) return criteriosVacios()
  return Object.fromEntries(CRITERIOS.map(c => [c.clave, e[c.clave]])) as Criterios
}

/** Un criterio válido es un entero de 1 a 10. */
export function valorValido(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10
}

/** Los criterios que faltan o están fuera de escala, por etiqueta. */
export function criteriosFaltantes(c: Criterios): string[] {
  return CRITERIOS.filter(x => !valorValido(c[x.clave])).map(x => x.etiqueta)
}

/**
 * Promedio de los siete criterios con dos decimales, igual que la columna
 * `puntaje` de la base. Mientras falte alguno, no hay puntaje: un promedio de
 * cinco criterios se leería como si fuera el de siete.
 */
export function puntajeDe(c: Criterios): number | null {
  if (criteriosFaltantes(c).length > 0) return null
  const suma = CRITERIOS.reduce((acc, x) => acc + (c[x.clave] as number), 0)
  return Math.round((suma / CRITERIOS.length) * 100) / 100
}

/** "7,57", "7,5" o "7": coma decimal y sin ceros de más, como el resto de la app. */
export function formatoPuntaje(p: number): string {
  return String(Math.round(p * 100) / 100).replace('.', ',')
}

export function conceptoPuntaje(p: number): string {
  return conceptoDe(p)
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** '2026-11' → 'noviembre 2026'. */
export function nombrePeriodo(periodo: string): string {
  const [a, m] = periodo.split('-').map(Number)
  return MESES[m - 1] ? `${MESES[m - 1]} ${a}` : periodo
}

export function nombreVigilador(v: Pick<VigiladorAEvaluar, 'nombre' | 'apellido'>): string {
  return [v.apellido, v.nombre].filter(Boolean).join(', ') || 'Sin nombre'
}

export function avance(lista: ListaDelMes | null): { hechas: number; total: number; pendientes: number } {
  const total = lista?.vigiladores.length ?? 0
  const hechas = lista?.vigiladores.filter(v => v.evaluacion).length ?? 0
  return { hechas, total, pendientes: total - hechas }
}

// ── Datos ────────────────────────────────────────────────────────────────────

export async function cargarListaDelMes(): Promise<{ lista: ListaDelMes | null; error: string | null }> {
  const { data, error } = await supabase.rpc('evaluacion_vigiladores_mias')
  if (error) return { lista: null, error: error.message }
  return { lista: data as ListaDelMes, error: null }
}

export async function guardarEvaluacion(args: {
  vigiladorId: string
  criterios: Criterios
  observaciones: string
  planAccion: string
  origen?: 'campana' | 'supervision'
}): Promise<{ evaluacion: EvaluacionVigilador | null; error: string | null }> {
  const faltan = criteriosFaltantes(args.criterios)
  if (faltan.length > 0) return { evaluacion: null, error: `Falta calificar: ${faltan.join(', ')}` }
  const c = args.criterios
  const { data, error } = await supabase.rpc('evaluacion_vigilador_guardar', {
    p_vigilador_id: args.vigiladorId,
    p_asistencia_puntualidad: c.asistencia_puntualidad,
    p_pulcritud: c.pulcritud,
    p_disposicion: c.disposicion,
    p_relacion_objetivo: c.relacion_objetivo,
    p_relacion_supervisores: c.relacion_supervisores,
    p_relacion_companeros: c.relacion_companeros,
    p_concepto_general: c.concepto_general,
    p_observaciones: args.observaciones,
    p_plan_accion: args.planAccion,
    p_origen: args.origen ?? 'campana',
  })
  if (error) return { evaluacion: null, error: error.message }
  return { evaluacion: data as EvaluacionVigilador, error: null }
}

// ── Avance para Administración y Gerencia ────────────────────────────────────

export interface EvaluacionDeAvance extends Record<ClaveCriterio, number> {
  vigilador_id: string
  nombre: string | null
  apellido: string | null
  legajo: string | null
  puntaje: number
  observaciones: string | null
  plan_accion: string | null
  origen: 'campana' | 'supervision'
  updated_at: string
}

export interface PendienteDeAvance {
  vigilador_id: string
  nombre: string | null
  apellido: string | null
  legajo: string | null
  objetivo: string | null
}

export interface EvaluadorAvance {
  evaluador_id: string
  nombre: string | null
  apellido: string | null
  es_gerencia: boolean
  /** Administración: evalúa a quien quiera, sin un total que cumplir. */
  es_administracion?: boolean
  zonas: string[]
  /** A evaluar con la ventana de turnos de HOY (para un mes pasado, aproximado). */
  total: number
  hechas: number
  /** El promedio que pone ese evaluador (null si no evaluó a nadie). */
  promedio: number | null
  evaluaciones: EvaluacionDeAvance[]
  /** Sólo en el mes en curso. */
  pendientes: PendienteDeAvance[]
}

export interface VigiladorAvance {
  vigilador_id: string
  nombre: string | null
  apellido: string | null
  legajo: string | null
  cantidad: number
  promedio: number
  minimo: number
  maximo: number
}

export interface AvanceEvaluacion {
  periodo: string
  es_mes_actual: boolean
  periodos: string[]
  evaluadores: EvaluadorAvance[]
  vigiladores: VigiladorAvance[]
}

/** Diferencia entre la nota más alta y la más baja que recibió un vigilador. */
export const DIFERENCIA_A_MIRAR = 2

export function difiere(v: Pick<VigiladorAvance, 'cantidad' | 'minimo' | 'maximo'>): boolean {
  return v.cantidad > 1 && Number(v.maximo) - Number(v.minimo) >= DIFERENCIA_A_MIRAR
}

export function totalesAvance(a: AvanceEvaluacion | null): { hechas: number; total: number } {
  const ev = a?.evaluadores ?? []
  return {
    hechas: ev.reduce((s, e) => s + Number(e.hechas), 0),
    // Administración no tiene un total que cumplir: cuenta sólo lo que hizo.
    total: ev.reduce((s, e) => s + (e.es_administracion ? Number(e.hechas) : Math.max(Number(e.total), Number(e.hechas))), 0),
  }
}

export function nombreEvaluador(e: Pick<EvaluadorAvance, 'nombre' | 'apellido'>): string {
  return [e.apellido, e.nombre].filter(Boolean).join(', ') || 'Sin nombre'
}

export async function cargarAvance(periodo?: string): Promise<{ avance: AvanceEvaluacion | null; error: string | null }> {
  const { data, error } = await supabase.rpc('evaluacion_vigiladores_avance', { p_periodo: periodo ?? null })
  if (error) return { avance: null, error: error.message }
  return { avance: data as AvanceEvaluacion, error: null }
}
