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
