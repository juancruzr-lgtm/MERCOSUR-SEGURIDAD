/**
 * lib/fetch-paginado.ts
 *
 * PostgREST corta las respuestas en `db-max-rows` (1000 filas por defecto) sin
 * avisar: no devuelve error, simplemente faltan filas. Una consulta mensual de
 * turnos o de asistencia supera ese tope, así que tiene que paginar.
 *
 * No depende del navegador — válido en servidor y cliente.
 */

export const FILAS_POR_PAGINA = 1000

export async function fetchPaginado<T = any>(
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: any }>,
  filasPorPagina: number = FILAS_POR_PAGINA,
): Promise<T[]> {
  const todas: T[] = []
  let desde = 0
  for (;;) {
    const { data, error } = await consulta(desde, desde + filasPorPagina - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    todas.push(...data)
    if (data.length < filasPorPagina) break
    desde += filasPorPagina
  }
  return todas
}

/**
 * Igual que `fetchPaginado`, pero devuelve la forma `{ data, error }` de
 * supabase-js en vez de lanzar. Permite reemplazar una consulta directa dentro
 * de un `Promise.all` sin cambiar cómo el llamador maneja los errores: si esto
 * lanzara, el `Promise.all` se rechazaría entero y la pantalla quedaría
 * cargando para siempre.
 */
export async function fetchPaginadoResult<T = any>(
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: any }>,
  filasPorPagina: number = FILAS_POR_PAGINA,
): Promise<{ data: T[]; error: any }> {
  try {
    return { data: await fetchPaginado<T>(consulta, filasPorPagina), error: null }
  } catch (error) {
    return { data: [], error }
  }
}
