/**
 * lib/evaluacion-snapshot-guardar.ts
 *
 * Deposita en `evaluaciones_mensuales` lo que el motor ya calculó.
 *
 * Separado de `lib/evaluacion-snapshot.ts` a propósito: ese módulo es puro y se
 * testea sin base. Acá vive lo único que necesita red, que es el upsert.
 *
 * ── La regla que protege lo ya publicado ─────────────────────────────────────
 * Un upsert de PostgREST reemplaza la fila entera. Si Administración vuelve a
 * congelar un mes que ya se le mostró a la gente, el `estado` volvería a
 * 'calculada' y la evaluación desaparecería de la pantalla del vigilador sin
 * que nadie lo haya pedido. Por eso se leen primero los estados vigentes y las
 * filas ya publicadas conservan su estado y su fecha de publicación.
 */

import { supabase } from '@/lib/supabase'
import {
  filasDeSnapshot,
  type EntradaSnapshot,
  type EstadoPublicacion,
  type FilaEvaluacion,
} from '@/lib/evaluacion-snapshot'

export interface ResultadoGuardado {
  guardadas: number
  /** Cuántas ya estaban publicadas y se dejaron publicadas. */
  publicadasPreservadas: number
  filas: FilaEvaluacion[]
  error: string | null
}

interface FilaVigente {
  empleado_id: string
  estado: EstadoPublicacion
  publicado_at: string | null
  publicado_por: string | null
}

/** Lo que ya hay guardado del período, para no pisarlo a ciegas. */
export async function estadosVigentes(periodo: string): Promise<Map<string, FilaVigente>> {
  const { data, error } = await supabase
    .from('evaluaciones_mensuales')
    .select('empleado_id, estado, publicado_at, publicado_por')
    .eq('periodo', periodo)

  if (error || !data) return new Map()
  return new Map((data as FilaVigente[]).map(f => [f.empleado_id, f]))
}

/**
 * Congela el período.
 *
 * `estado` es el que reciben las filas NUEVAS. Las que ya estaban publicadas se
 * mantienen publicadas: despublicar es una decisión aparte, no un efecto
 * secundario de recalcular.
 */
export async function guardarSnapshot(
  entradas: readonly EntradaSnapshot[],
  periodo: string,
  generadoPor: string | null,
  estado: EstadoPublicacion = 'calculada',
): Promise<ResultadoGuardado> {
  const filas = filasDeSnapshot(entradas, periodo, estado)
  if (filas.length === 0) {
    return { guardadas: 0, publicadasPreservadas: 0, filas: [], error: null }
  }

  const vigentes = await estadosVigentes(periodo)
  let publicadasPreservadas = 0

  const aGuardar = filas.map(f => {
    const previo = vigentes.get(f.empleado_id)
    const yaPublicada = previo?.estado === 'publicada'
    if (yaPublicada) publicadasPreservadas += 1
    return {
      ...f,
      estado: yaPublicada ? ('publicada' as EstadoPublicacion) : f.estado,
      generado_por: generadoPor,
      generado_at: new Date().toISOString(),
      publicado_at: yaPublicada ? previo!.publicado_at : null,
      publicado_por: yaPublicada ? previo!.publicado_por : null,
    }
  })

  const { error } = await supabase
    .from('evaluaciones_mensuales')
    .upsert(aGuardar, { onConflict: 'empleado_id,periodo' })

  if (error) {
    return { guardadas: 0, publicadasPreservadas: 0, filas, error: error.message }
  }
  return { guardadas: aGuardar.length, publicadasPreservadas, filas, error: null }
}
