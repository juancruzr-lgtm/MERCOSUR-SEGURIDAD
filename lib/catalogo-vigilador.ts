/**
 * lib/catalogo-vigilador.ts
 *
 * Datos de la pantalla del vigilador que casi no cambian (objetivos y puestos)
 * y columnas mínimas de sus registros de asistencia. Antes cada refresco (60 s)
 * traía TODOS los objetivos, TODOS los puestos y TODO el historial de
 * registros del vigilador con `select *`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { INTERVALO_CATALOGO_MS } from '@/lib/refresco-movil'

/**
 * Lo que la pantalla del vigilador lee de un registro: tarjeta del turno,
 * ingreso/egreso, auditoría GPS, anulación de egreso y resumen post-egreso.
 * Si se agrega una lectura nueva de `registros` en GuardiaMobile, sumar la
 * columna acá (el tipo `Registro` de esa pantalla es el contrato).
 */
export const COLUMNAS_REGISTRO_VIGILADOR = [
  'id', 'turno_id', 'guardia_id',
  'hora_entrada_real', 'hora_salida_real', 'horas_trabajadas',
  'latitud_ingreso', 'longitud_ingreso', 'precision_ingreso',
  'latitud_egreso', 'longitud_egreso', 'precision_egreso',
  'lat_entrada', 'lng_entrada', 'lat_salida', 'lng_salida',
  'distancia_ingreso_metros', 'gps_ingreso_estado',
  'distancia_egreso_metros', 'gps_egreso_estado',
].join(', ')

export const COLUMNAS_OBJETIVO_VIGILADOR = 'id, nombre, direccion, lat, lng, radio_metros, estado'

export type CatalogoTurnos<O = any, P = any> = {
  cargadoMs: number
  objetivos: O[]
  puestos: P[]
}

/** ¿Hay que (re)leer objetivos/puestos? Por antigüedad o por un id que falta. */
export function catalogoDesactualizado(
  cache: CatalogoTurnos<{ id: string }, { id: string }> | null,
  objetivoIds: Array<string | null | undefined>,
  puestoIds: Array<string | null | undefined>,
  ahoraMs: number,
  maxEdadMs: number = INTERVALO_CATALOGO_MS,
): boolean {
  if (!cache) return true
  if (ahoraMs - cache.cargadoMs >= maxEdadMs) return true
  const objetivos = new Set(cache.objetivos.map(o => o.id))
  const puestos = new Set(cache.puestos.map(p => p.id))
  if (objetivoIds.some(id => id && !objetivos.has(id))) return true
  if (puestoIds.some(id => id && !puestos.has(id))) return true
  return false
}

const unicos = (ids: Array<string | null | undefined>) =>
  Array.from(new Set(ids.filter((x): x is string => Boolean(x))))

/** Lee sólo los objetivos y puestos de los turnos dados. */
export async function leerCatalogoTurnos(
  cliente: Pick<SupabaseClient, 'from'>,
  objetivoIds: Array<string | null | undefined>,
  puestoIds: Array<string | null | undefined>,
  ahoraMs: number = Date.now(),
): Promise<{ cache: CatalogoTurnos; error: unknown | null }> {
  const objs = unicos(objetivoIds)
  const pues = unicos(puestoIds)
  const [o, p] = await Promise.all([
    objs.length === 0
      ? Promise.resolve({ data: [], error: null })
      : cliente.from('objetivos').select(COLUMNAS_OBJETIVO_VIGILADOR).in('id', objs),
    pues.length === 0
      ? Promise.resolve({ data: [], error: null })
      : cliente.from('puestos').select('id, nombre').in('id', pues),
  ])
  return {
    cache: { cargadoMs: ahoraMs, objetivos: (o.data ?? []) as any[], puestos: (p.data ?? []) as any[] },
    error: o.error || p.error || null,
  }
}
