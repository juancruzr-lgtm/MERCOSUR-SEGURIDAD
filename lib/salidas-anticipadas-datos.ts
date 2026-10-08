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
import type { EvaluacionOficial } from '@/lib/nota-oficial'

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
  publicado_at: string | null
  version?: number | null
  corregida_at?: string | null
  motivo_correccion?: string | null
}

export async function cargarEvaluacionPublicada(
  empleadoId: string, periodo: string,
): Promise<{ data: EvaluacionPublicadaResumen | null; error: string | null }> {
  const base = 'id, empleado_id, periodo, indice, nota_final, concepto, alcance, cobertura, faltas, explicacion, estado, publicado_at'
  let r: { data: any; error: any } = await supabase
    .from('evaluaciones_mensuales')
    .select(`${base}, version, corregida_at, motivo_correccion`)
    .eq('empleado_id', empleadoId)
    .eq('periodo', periodo)
    .maybeSingle()
  // Antes de aplicar la migración de salidas anticipadas esas tres columnas no
  // existen. La nota oficial se tiene que poder leer igual.
  if (r.error && /column/i.test(String(r.error.message))) {
    r = await supabase
      .from('evaluaciones_mensuales')
      .select(base)
      .eq('empleado_id', empleadoId)
      .eq('periodo', periodo)
      .maybeSingle()
  }
  if (r.error) return { data: null, error: r.error.message }
  const d = r.data as any
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

/**
 * Las notas oficiales (publicadas) del período, por empleado. Una consulta para
 * toda la lista; son ~65 filas por mes, lejos del tope de 1000 de PostgREST.
 */
export async function cargarNotasPublicadasDelMes(
  mes: string,
): Promise<{ data: Map<string, EvaluacionOficial>; error: string | null }> {
  const base = 'empleado_id, estado, nota_final, indice, faltas'
  let r: { data: any; error: any } = await supabase
    .from('evaluaciones_mensuales')
    .select(`${base}, corregida_at`)
    .eq('periodo', mes)
    .eq('estado', 'publicada')
  if (r.error && /column/i.test(String(r.error.message))) {
    r = await supabase.from('evaluaciones_mensuales').select(base).eq('periodo', mes).eq('estado', 'publicada')
  }
  if (r.error) return { data: new Map(), error: r.error.message }
  return {
    data: new Map((r.data ?? []).map((f: any) => [f.empleado_id, {
      ...f,
      nota_final: f.nota_final === null ? null : Number(f.nota_final),
      indice: f.indice === null ? null : Number(f.indice),
    }])),
    error: null,
  }
}

export interface CambioSalida {
  estado_anterior: string | null
  estado_nuevo: string
  motivo_codigo: string | null
  motivo: string | null
  evidencia: string | null
  segundos_antes: number | null
  actor: string
  registrado_at: string
}

/** Historial completo de una salida: detección, resoluciones y cambios. */
export async function cargarHistorialSalida(
  salidaId: string,
): Promise<{ data: CambioSalida[]; error: string | null }> {
  const { data, error } = await supabase.rpc('salida_anticipada_historial', { p_salida_id: salidaId })
  if (error) return { data: [], error: error.message ?? String(error) }
  return { data: (data ?? []) as CambioSalida[], error: null }
}
