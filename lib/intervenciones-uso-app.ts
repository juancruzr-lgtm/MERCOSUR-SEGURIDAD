/**
 * lib/intervenciones-uso-app.ts
 *
 * La escalera de intervenciones por uso de la aplicación.
 *
 * ── Qué decide el sistema y qué decide una persona ───────────────────────────
 * El sistema propone el próximo escalón mirando lo que ya se hizo con esa
 * persona, y guarda la evidencia del momento. Nada más. No escala solo, no
 * sanciona y no manda nada: cada fila la crea alguien que miró el caso.
 *
 * Una advertencia disparada automáticamente convertiría un problema de registro
 * en una medida disciplinaria sin que nadie hubiera decidido nada, que es
 * exactamente lo que no se quiere.
 */

import { supabase } from '@/lib/supabase'
import type { AdopcionEmpleado } from '@/lib/adopcion-app'

export type TipoIntervencion = 'entrenamiento' | 'aviso' | 'advertencia'

export const ETIQUETA_INTERVENCION: Record<TipoIntervencion, string> = {
  entrenamiento: 'Entrenamiento',
  aviso: 'Aviso',
  advertencia: 'Advertencia',
}

/** El orden de la escalera. Se sube de a un escalón. */
export const ESCALERA: TipoIntervencion[] = ['entrenamiento', 'aviso', 'advertencia']

export interface Intervencion {
  id?: string
  empleado_id: string
  periodo: string
  tipo: TipoIntervencion
  motivo: string
  evidencia: unknown
  responsable_id: string | null
  estado?: 'abierta' | 'cerrada'
  observacion?: string | null
  creado_at?: string
}

/**
 * Qué corresponde proponer ahora.
 *
 * Se mira el antecedente completo de la persona, no sólo el mes: alguien a
 * quien ya se le avisó en julio no vuelve a empezar por entrenamiento en
 * agosto, porque entonces la escalera no escalaría nunca.
 *
 * Nunca salta escalones. De no tener nada a "advertencia" no se llega de una,
 * por más grave que sea el mes: primero hay que haber enseñado.
 */
export function proximoEscalon(previas: readonly TipoIntervencion[]): TipoIntervencion {
  if (previas.includes('advertencia')) return 'advertencia'
  if (previas.includes('aviso')) return 'advertencia'
  if (previas.includes('entrenamiento')) return 'aviso'
  return 'entrenamiento'
}

/**
 * El motivo, redactado con los hechos.
 *
 * Un motivo escrito a mano se olvida de los números; sin números la
 * intervención no se puede sostener seis meses después.
 */
export function motivoDe(a: AdopcionEmpleado): string {
  return `${a.sinRegistroPropio} de ${a.jornadas} jornadas del período ${a.periodo} `
    + `sin registro propio de fichaje (${a.proporcion ?? 0} %).`
    + (a.muestraChica ? ' Muestra chica: pocas jornadas trabajadas.' : '')
    + (a.sinNota ? ' Sin calificación mensual por muestra insuficiente.' : '')
}

/** La foto de los hechos, para que la intervención no dependa de recalcular. */
export function evidenciaDe(a: AdopcionEmpleado) {
  return {
    jornadas: a.jornadas,
    sinRegistroPropio: a.sinRegistroPropio,
    proporcion: a.proporcion,
    severidad: a.severidad,
    clase: a.clase,
    muestraChica: a.muestraChica,
    sinNota: a.sinNota,
    hechos: a.hechos,
  }
}

export async function intervencionesDe(
  periodo: string,
): Promise<Map<string, Intervencion[]>> {
  const { data, error } = await supabase
    .from('intervenciones_uso_app')
    .select('*')
    .order('creado_at', { ascending: true })

  const out = new Map<string, Intervencion[]>()
  if (error || !data) return out
  for (const i of data as Intervencion[]) {
    if (!out.has(i.empleado_id)) out.set(i.empleado_id, [])
    out.get(i.empleado_id)!.push(i)
  }
  return out
}

export async function registrarIntervencion(
  a: AdopcionEmpleado,
  tipo: TipoIntervencion,
  responsableId: string | null,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('intervenciones_uso_app').insert({
    empleado_id: a.empleadoId,
    periodo: a.periodo,
    tipo,
    motivo: motivoDe(a),
    evidencia: evidenciaDe(a),
    responsable_id: responsableId,
  })
  return { error: error ? error.message : null }
}
