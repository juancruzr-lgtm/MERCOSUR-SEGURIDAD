// El lote de saneamiento de observaciones de IA, del lado del cliente.
//
// Mismo idioma que `cerrarAlertasPendientes` para las rondas: vista previa por
// defecto, aplicar exige motivo. Es a propósito — quien ya sabe cerrar el
// backlog de rondas no tiene que aprender otra cosa para éste.

import { supabase } from '@/lib/supabase'
import { MOTIVO_SANEAMIENTO_IA } from '@/lib/ia/revision'

/** Mínimo del motivo. Un "ok" no explica nada dentro de seis meses. */
export const SANEAMIENTO_MOTIVO_MINIMO = 10

export type ContextoSaneamientoIA =
  | 'vista_previa' | 'aplicado' | 'sin_usuario' | 'requiere_admin'
  | 'sin_corte' | 'motivo_requerido'

export interface ResumenSaneamientoIA {
  contexto: ContextoSaneamientoIA
  /** Instante de entrada en vigencia del criterio. Sale de ia_configuraciones. */
  corte: string | null
  total: number
  porTipo: Record<string, number>
  saneadas: number
}

export function validarMotivoSaneamiento(motivo: string): string | null {
  const limpio = motivo.trim()
  if (limpio.length === 0) return 'El motivo es obligatorio.'
  if (limpio.length < SANEAMIENTO_MOTIVO_MINIMO) {
    return `Explicá el motivo con al menos ${SANEAMIENTO_MOTIVO_MINIMO} caracteres.`
  }
  return null
}

export function mensajeContextoSaneamiento(c: ContextoSaneamientoIA): string | null {
  switch (c) {
    case 'sin_usuario':      return 'Tu sesión venció. Volvé a ingresar.'
    case 'requiere_admin':   return 'El saneamiento alcanza a todos los objetivos: sólo Administración puede aplicarlo.'
    case 'sin_corte':        return 'No hay criterio de IA activo: no se puede saber qué es "anterior".'
    case 'motivo_requerido': return `El motivo necesita al menos ${SANEAMIENTO_MOTIVO_MINIMO} caracteres.`
    default:                 return null
  }
}

/** "168 observaciones — 83 de ronda · 65 de uniforme · 20 de libro de guardia" */
export function resumenPrevioSaneamiento(r: ResumenSaneamientoIA): string {
  if (r.total === 0) return 'No quedan observaciones anteriores al criterio vigente.'
  const etiquetas: Record<string, string> = {
    punto_control: 'de ronda', uniforme: 'de uniforme', libro_guardia: 'de libro de guardia',
  }
  const detalle = Object.keys(r.porTipo)
    .sort((a, b) => r.porTipo[b] - r.porTipo[a])
    .map(t => `${r.porTipo[t]} ${etiquetas[t] ?? t}`)
    .join(' · ')
  // 'observación' pierde la tilde en plural: observaciones, no observaciónes.
  const sustantivo = r.total === 1 ? 'observación' : 'observaciones'
  return `${r.total} ${sustantivo}${detalle ? ` — ${detalle}` : ''}`
}

export async function sanearObservacionesPrevias(params: {
  motivo?: string
  soloConteo?: boolean
} = {}): Promise<{ data: ResumenSaneamientoIA | null; error: string | null }> {
  const soloConteo = params.soloConteo ?? true
  const motivo = params.motivo ?? MOTIVO_SANEAMIENTO_IA

  if (!soloConteo) {
    const err = validarMotivoSaneamiento(motivo)
    if (err) return { data: null, error: err }
  }

  const { data, error } = await supabase.rpc('ia_sanear_observaciones_previas', {
    p_motivo: motivo,
    p_corte: null,
    p_solo_conteo: soloConteo,
  })

  if (error) return { data: null, error: error.message }

  const bruto: any = data ?? {}
  const resumen: ResumenSaneamientoIA = {
    contexto: (bruto.contexto ?? 'vista_previa') as ContextoSaneamientoIA,
    corte:    bruto.corte ?? null,
    total:    Number(bruto.total ?? 0),
    porTipo:  (bruto.por_tipo ?? {}) as Record<string, number>,
    saneadas: Number(bruto.saneadas ?? 0),
  }

  const mensaje = mensajeContextoSaneamiento(resumen.contexto)
  if (mensaje) return { data: null, error: mensaje }
  return { data: resumen, error: null }
}
