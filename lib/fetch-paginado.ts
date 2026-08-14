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

/**
 * `maxFilas` corta la paginación en un techo deliberado. No es lo mismo que el
 * tope de PostgREST: ese es una limitación que hay que sortear, éste es una
 * decisión —"con 10.000 eventos alcanza para el análisis"— que hay que
 * respetar. Quien lo use tiene que declarar que el resultado es parcial: para
 * eso conviene comparar contra el total real de la ventana.
 */
export async function fetchPaginado<T = any>(
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: any }>,
  filasPorPagina: number = FILAS_POR_PAGINA,
  maxFilas?: number,
): Promise<T[]> {
  const todas: T[] = []
  let desde = 0
  for (;;) {
    if (maxFilas != null && todas.length >= maxFilas) break
    // La última página se recorta para no pasarse del techo pedido.
    const pedir = maxFilas != null
      ? Math.min(filasPorPagina, maxFilas - todas.length)
      : filasPorPagina
    const { data, error } = await consulta(desde, desde + pedir - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    todas.push(...data)
    if (data.length < pedir) break
    desde += pedir
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
  maxFilas?: number,
): Promise<{ data: T[]; error: any }> {
  try {
    return { data: await fetchPaginado<T>(consulta, filasPorPagina, maxFilas), error: null }
  } catch (error) {
    return { data: [], error }
  }
}
