/**
 * lib/entrega-evaluacion.ts
 *
 * Dos estados y nada más: publicado y visto.
 *
 * ── Qué significa cada uno ───────────────────────────────────────────────────
 *   publicado  la evaluación quedó a disposición del vigilador
 *   visto      el vigilador abrió efectivamente su Mi Desempeño
 *
 * No hay un tercer estado de confirmación. Pedirle a alguien que apriete
 * "confirmo que la vi" agrega un paso que la mitad no da, y deja el dato peor
 * que si se registrara solo.
 *
 * **Visto no es conformidad.** Acredita acceso. Quien quiera objetar tiene la
 * observación, que es un acto distinto y explícito.
 */

import { supabase } from '@/lib/supabase'
import type { FilaPublicada } from '@/lib/mi-desempeno'

export interface Lectura {
  evaluacion_id: string
  empleado_id: string
  periodo: string
  visto_at: string
}

export interface Observacion {
  id: string
  evaluacion_id: string
  empleado_id: string
  periodo: string
  texto: string
  estado: 'abierta' | 'respondida' | 'cerrada'
  respuesta: string | null
  respondido_at: string | null
  creado_at: string
}

/**
 * Marca visto, si corresponde.
 *
 * Silenciosa a propósito: la llama la pantalla al abrir, y el vigilador tiene
 * que poder leer su evaluación aunque este registro falle. Un error acá no es
 * motivo para no mostrarle su nota.
 *
 * La RPC valida que quien llama sea el destinatario y que esté publicada, así
 * que llamarla desde la ficha que mira un admin no inventa ningún visto.
 */
export async function registrarLectura(evaluacionId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('registrar_lectura_evaluacion', {
    p_evaluacion_id: evaluacionId,
  })
  if (error || !data) return false
  return Boolean((data as any).ok)
}

export async function observarEvaluacion(
  evaluacionId: string, texto: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('observar_evaluacion', {
    p_evaluacion_id: evaluacionId,
    p_texto: texto,
  })
  return { error: error ? error.message : null }
}

export interface EstadoEntrega {
  /** Evaluaciones publicadas del período. Es el universo. */
  publicadas: number
  vistas: number
  noVistas: number
  observacionesAbiertas: number
  /** Los nombres detrás de cada número, para poder abrir el listado. */
  idsVistas: string[]
  idsNoVistas: string[]
  idsConObservacion: string[]
}

/**
 * El estado de entrega del período.
 *
 * `noVistas` se calcula por diferencia sobre las publicadas, no contando filas
 * ausentes: quien todavía no abrió no tiene fila, y un `count` sobre una tabla
 * vacía diría cero en vez de "no la vio nadie".
 */
export function estadoDeEntrega(
  publicadas: readonly FilaPublicada[],
  lecturas: readonly Lectura[],
  observaciones: readonly Observacion[],
): EstadoEntrega {
  const conNota = publicadas.filter(f => f.estado === 'publicada')
  const vistas = new Set(lecturas.map(l => l.empleado_id))
  const abiertas = observaciones.filter(o => o.estado === 'abierta')

  const idsVistas = conNota.filter(f => vistas.has(f.empleado_id)).map(f => f.empleado_id)
  const idsNoVistas = conNota.filter(f => !vistas.has(f.empleado_id)).map(f => f.empleado_id)

  return {
    publicadas: conNota.length,
    vistas: idsVistas.length,
    noVistas: idsNoVistas.length,
    observacionesAbiertas: abiertas.length,
    idsVistas,
    idsNoVistas,
    idsConObservacion: Array.from(new Set(abiertas.map(o => o.empleado_id))),
  }
}

export async function cargarEntrega(periodo: string): Promise<{
  lecturas: Lectura[]
  observaciones: Observacion[]
}> {
  const [l, o] = await Promise.all([
    supabase.from('lecturas_evaluacion').select('*').eq('periodo', periodo),
    supabase.from('observaciones_evaluacion').select('*').eq('periodo', periodo),
  ])
  return {
    lecturas: (l.data ?? []) as Lectura[],
    observaciones: (o.data ?? []) as Observacion[],
  }
}
