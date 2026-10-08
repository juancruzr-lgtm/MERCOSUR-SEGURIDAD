/**
 * lib/salidas-anticipadas-datos.ts
 *
 * Lectura y resolución de salidas anticipadas. Todo pasa por RPC: la tabla no
 * se escribe desde el cliente, y el alcance (zona del supervisor, Gerencia,
 * jefatura) lo decide la base.
 *
 * El error se DEVUELVE, nunca se confunde con "no hubo salidas": en un período
 * donde la regla rige, una lista vacía por error dejaría una salida
 * injustificada confirmada sin su tope.
 */

import { supabase } from '@/lib/supabase'
import type { EstadoResolucion, SalidaAnticipada } from '@/lib/salidas-anticipadas'

export async function cargarSalidasDelMes(
  mes: string,
): Promise<{ data: SalidaAnticipada[]; error: string | null }> {
  const { data, error } = await supabase.rpc('salidas_anticipadas_del_mes', { p_periodo: mes })
  if (error) return { data: [], error: `salidas anticipadas: ${error.message ?? String(error)}` }
  return { data: (data ?? []) as SalidaAnticipada[], error: null }
}

export async function resolverSalidas(
  ids: string[],
  estado: EstadoResolucion,
  motivoCodigo: string,
  motivo: string,
  evidencia: string | null,
): Promise<{ afectadas: number; error: string | null }> {
  const { data, error } = await supabase.rpc('resolver_salidas_anticipadas', {
    p_ids: ids,
    p_estado: estado,
    p_motivo_codigo: motivoCodigo,
    p_motivo: motivo,
    p_evidencia: evidencia,
  })
  if (error) return { afectadas: 0, error: error.message ?? String(error) }
  return { afectadas: Number(data ?? 0), error: null }
}

export interface EvaluacionPublicadaResumen {
  id: string
  empleado_id: string
  periodo: string
  indice: number | null
  nota_final: number | null
  concepto: string | null
  alcance: string | null
  cobertura: number | null
  faltas: unknown
  explicacion: string | null
  estado: string
  version: number | null
  corregida_at: string | null
  motivo_correccion: string | null
}

export async function cargarEvaluacionPublicada(
  empleadoId: string, periodo: string,
): Promise<{ data: EvaluacionPublicadaResumen | null; error: string | null }> {
  const { data, error } = await supabase
    .from('evaluaciones_mensuales')
    .select('id, empleado_id, periodo, indice, nota_final, concepto, alcance, cobertura, faltas, explicacion, estado, version, corregida_at, motivo_correccion')
    .eq('empleado_id', empleadoId)
    .eq('periodo', periodo)
    .maybeSingle()
  if (error) return { data: null, error: error.message }
  const d = data as any
  return {
    data: d ? {
      ...d,
      indice: d.indice === null ? null : Number(d.indice),
      nota_final: d.nota_final === null ? null : Number(d.nota_final),
      cobertura: d.cobertura === null ? null : Number(d.cobertura),
    } : null,
    error: null,
  }
}

export async function corregirEvaluacionPublicada(args: {
  evaluacionId: string
  notaFinal: number
  concepto: string
  faltas: unknown[]
  explicacion: string
  motivo: string
}): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await supabase.rpc('corregir_evaluacion_publicada', {
    p_evaluacion_id: args.evaluacionId,
    p_nota_final: args.notaFinal,
    p_concepto: args.concepto,
    p_faltas: args.faltas,
    p_explicacion: args.explicacion,
    p_motivo: args.motivo,
  })
  if (error) return { ok: false, error: error.message ?? String(error) }
  return { ok: true, error: null }
}
