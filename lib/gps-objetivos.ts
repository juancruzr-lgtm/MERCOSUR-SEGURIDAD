//
// Diagnóstico GPS de objetivos, del lado del cliente.
//
// Es una capa fina sobre la RPC `diagnosticar_gps_objetivo`: acá no se
// clasifica nada ni se recalcula ninguna distancia. La recomendación, la
// confianza y los umbrales viven en el servidor, que es el único que ve la
// evidencia completa.
//
// Lo único que se hace acá es traducir los estados a castellano y decidir si
// el botón "Aplicar" se muestra — con la misma regla que usó el servidor.
//

import { supabase } from '@/lib/supabase'
import {
  actualizarUbicacionObjetivo,
  type ObjetivoLegajo,
} from '@/lib/legajo-objetivo'

export type RecomendacionGpsObjetivo =
  | 'sin_datos'
  | 'datos_anomalos'
  | 'sin_cambios'
  | 'ajustar_radio'
  | 'recentrar'
  | 'recentrar_y_radio'

export type ConfianzaGps = 'sin_datos' | 'baja' | 'media' | 'alta'

export interface DiagnosticoGpsObjetivo {
  id: string
  objetivo_id: string
  firma: string
  dias_analizados: number
  marcaciones: number
  guardias_distintos: number
  dias_distintos: number
  latitud_actual: number | null
  longitud_actual: number | null
  radio_actual: number | null
  latitud_sugerida: number | null
  longitud_sugerida: number | null
  radio_sugerido: number | null
  distancia_p50: number | null
  distancia_p90: number | null
  distancia_max: number | null
  desplazamiento_metros: number | null
  recomendacion: RecomendacionGpsObjetivo
  confianza: ConfianzaGps
  created_at: string
}

export function etiquetaRecomendacionObjetivo(estado: RecomendacionGpsObjetivo): string {
  switch (estado) {
    case 'sin_cambios':       return 'Bien ubicado'
    case 'ajustar_radio':     return 'Conviene ajustar el radio'
    case 'recentrar':         return 'Conviene revisar la ubicación'
    case 'recentrar_y_radio': return 'Conviene revisar ubicación y radio'
    case 'datos_anomalos':    return 'Los fichajes están dispersos: no describen un lugar'
    case 'sin_datos':         return 'No hay evidencia suficiente para recomendar un ajuste'
  }
}

export function etiquetaConfianza(confianza: ConfianzaGps): string {
  switch (confianza) {
    case 'alta':      return 'Confianza alta'
    case 'media':     return 'Confianza media'
    case 'baja':      return 'Confianza baja'
    case 'sin_datos': return 'Sin datos'
  }
}

/**
 * ¿Se puede ofrecer Aplicar?
 *
 * Misma regla que el servidor: tiene que proponer un cambio concreto y la
 * evidencia no puede ser floja. Con confianza baja o datos anómalos se muestra
 * el diagnóstico pero no se habilita aplicar nada.
 */
export function sugerenciaObjetivoAplicable(d: DiagnosticoGpsObjetivo): boolean {
  const proponeCambio =
    d.recomendacion === 'ajustar_radio' ||
    d.recomendacion === 'recentrar' ||
    d.recomendacion === 'recentrar_y_radio'

  return (
    proponeCambio &&
    (d.confianza === 'alta' || d.confianza === 'media') &&
    d.latitud_sugerida !== null &&
    d.longitud_sugerida !== null &&
    d.radio_sugerido !== null
  )
}

/** Frase de evidencia, para que se vea sobre qué se apoya la recomendación. */
export function evidenciaTexto(d: DiagnosticoGpsObjetivo): string {
  return `${d.marcaciones} marcaciones · ${d.guardias_distintos} guardias · ` +
    `${d.dias_distintos} días · últimos ${d.dias_analizados} días`
}

/**
 * Pide el diagnóstico al servidor. Idempotente: el mismo resultado dentro de
 * 24 h devuelve la fila ya guardada en vez de crear otra.
 */
export async function diagnosticarGpsObjetivo(
  objetivoId: string,
  dias = 90,
): Promise<{ data: DiagnosticoGpsObjetivo | null; error: string | null }> {
  const { data, error } = await supabase.rpc('diagnosticar_gps_objetivo', {
    p_objetivo_id: objetivoId,
    p_dias: dias,
  })

  if (error) return { data: null, error: error.message }
  return { data: data as DiagnosticoGpsObjetivo, error: null }
}

/**
 * Aplica la sugerencia al objetivo.
 *
 * Escribe por `actualizarUbicacionObjetivo()` —la misma función que usan el
 * legajo y la corrección manual— pasándole el contexto del diagnóstico. Así la
 * auditoría distingue este cambio de uno hecho a mano: queda con
 * `origen = 'diagnostico_gps'` y la firma del análisis que lo originó.
 */
export async function aplicarSugerenciaGpsObjetivo(
  diagnostico: DiagnosticoGpsObjetivo,
): Promise<{ objetivo: ObjetivoLegajo | null; error: string | null }> {
  if (!sugerenciaObjetivoAplicable(diagnostico)) {
    return { objetivo: null, error: 'Este diagnóstico no tiene evidencia suficiente para aplicarse.' }
  }

  return actualizarUbicacionObjetivo(
    diagnostico.objetivo_id,
    diagnostico.latitud_sugerida as number,
    diagnostico.longitud_sugerida as number,
    diagnostico.radio_sugerido as number,
    { origen: 'diagnostico_gps', firma: diagnostico.firma },
  )
}
