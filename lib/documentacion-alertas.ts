/**
 * lib/documentacion-alertas.ts
 *
 * Etapa 6: vencimientos y alertas de documentación. Todo APAGADO por defecto;
 * lo prende Gerencia. Las reglas viven en la base
 * (supabase/migrations/20261009170000_documentacion_alertas.sql).
 */

import { supabase } from '@/lib/supabase'
import { fechaCorta } from '@/lib/documentacion'

export interface ConfigAlertas {
  activo: boolean
  dias_aviso: number
  avisar_persona: boolean
  incluir_faltantes: boolean
  actualizado_at?: string
}

export interface Vencimiento {
  documento_id: string
  empleado_id: string
  nombre: string
  apellido: string
  legajo: string | null
  tipo: string
  tipo_nombre: string
  detalle: string | null
  vence_el: string
  dias: number
  reemplazo_en_curso: boolean
}

export interface ReporteVencimientos {
  hoy: string
  dias: number
  config: ConfigAlertas
  puede_configurar: boolean
  documentos: Vencimiento[]
}

export interface AlertaPersona {
  id: number
  tipo: string
  tipo_nombre: string
  motivo: 'vencido' | 'por_vencer' | 'faltante' | 'solicitado'
  vence_el: string | null
}

const mensaje = (e: { message?: string } | null, d: string) => (e?.message ?? '').trim() || d

export async function cargarVencimientos(dias: number): Promise<{ datos: ReporteVencimientos | null; error: string | null }> {
  const { data, error } = await supabase.rpc('documentacion_vencimientos', { p_dias: dias })
  if (error) return { datos: null, error: mensaje(error, 'No se pudo cargar el reporte') }
  return { datos: data as ReporteVencimientos, error: null }
}

export async function configurarAlertas(cambios: Partial<ConfigAlertas>): Promise<string | null> {
  const { error } = await supabase.rpc('documentacion_alertas_configurar', { p: cambios })
  return error ? mensaje(error, 'No se pudo guardar') : null
}

export async function cargarMisAlertas(): Promise<AlertaPersona[]> {
  const { data, error } = await supabase.rpc('documentacion_mis_alertas')
  if (error || !data) return []
  const r = data as { activo: boolean; alertas: AlertaPersona[] }
  return r.activo ? r.alertas : []
}

export async function marcarAlertaVista(id: number): Promise<void> {
  await supabase.rpc('documentacion_alerta_vista', { p_id: id })
}

/** Texto de una alerta para la persona. */
export function textoAlerta(a: AlertaPersona): string {
  if (a.motivo === 'vencido') return `${a.tipo_nombre}: venció el ${fechaCorta(a.vence_el)}. Subí el nuevo.`
  if (a.motivo === 'por_vencer') return `${a.tipo_nombre}: vence el ${fechaCorta(a.vence_el)}.`
  if (a.motivo === 'solicitado') return `Administración te pidió: ${a.tipo_nombre}.`
  return `Falta en tu legajo: ${a.tipo_nombre}.`
}

/** "vence en 3 días", "venció hace 5 días", "vence hoy". */
export function textoDias(dias: number): string {
  if (dias === 0) return 'vence hoy'
  if (dias > 0) return `vence en ${dias} día${dias === 1 ? '' : 's'}`
  return `venció hace ${-dias} día${dias === -1 ? '' : 's'}`
}
