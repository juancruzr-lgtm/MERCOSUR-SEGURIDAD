// Sección activa en la URL (F-17, auditoría funcional 19/11).
//
// /dashboard es una sola ruta: la sección que se ve vivía sólo en memoria, así
// que recargar volvía siempre a «Panel Principal» y «Atrás» del navegador
// sacaba de la app. Ahora la sección se refleja en un parámetro de la URL
// (`?page=` en Administración, el mismo que ya usaban los enlaces de WhatsApp y
// del legajo; `?tab=` en la vista Supervisor) y se restaura al recargar o al ir
// «Atrás».
//
// Regla de seguridad: la URL sólo PIDE una sección. Se abre únicamente si está
// entre las que el menú le ofrece a esa persona (mismas capacidades que el
// menú). Lo demás cae en la sección por defecto. Las pantallas siguen
// controlando su propio permiso al dibujarse: esto es una capa más, no la única.
//
// Funciones puras: se prueban sin navegador (tests/navegacion-seccion-url.test.ts).

/** Claves de sección: minúsculas, dígitos y guion bajo (como los ids del menú). */
const CLAVE_VALIDA = /^[a-z0-9_]{1,64}$/

export function normalizarClaveSeccion(valor: string | null | undefined): string | null {
  if (typeof valor !== 'string') return null
  const v = valor.trim().toLowerCase()
  return CLAVE_VALIDA.test(v) ? v : null
}

/**
 * Sección pedida en la URL. Se prueban los parámetros en orden y gana el
 * primero que traiga una clave con forma válida. No valida permisos.
 */
export function leerSeccionDeUrl(search: string, parametros: readonly string[]): string | null {
  let q: URLSearchParams
  try { q = new URLSearchParams(search) } catch { return null }
  for (const p of parametros) {
    const clave = normalizarClaveSeccion(q.get(p))
    if (clave) return clave
  }
  return null
}

export type ResultadoSeccion =
  /** Se puede mostrar. */
  | 'permitida'
  /** Su permiso se resuelve más tarde (consulta a la base): no se fuerza nada todavía. */
  | 'pendiente'
  /** No está entre las del usuario: hay que volver a la sección por defecto. */
  | 'no_permitida'

export function evaluarSeccion(
  seccion: string,
  opciones: { permitidas: ReadonlySet<string>; pendientes?: ReadonlySet<string>; porDefecto: string },
): ResultadoSeccion {
  if (seccion === opciones.porDefecto || opciones.permitidas.has(seccion)) return 'permitida'
  if (opciones.pendientes?.has(seccion)) return 'pendiente'
  return 'no_permitida'
}

/**
 * Sección con la que arrancar: la pedida si está permitida (o pendiente de
 * resolver), si no la sección por defecto.
 */
export function resolverSeccion(
  solicitada: string | null,
  opciones: { permitidas: ReadonlySet<string>; pendientes?: ReadonlySet<string>; porDefecto: string },
): string {
  if (!solicitada) return opciones.porDefecto
  return evaluarSeccion(solicitada, opciones) === 'no_permitida' ? opciones.porDefecto : solicitada
}

/**
 * URL (ruta + query) que representa una sección. La sección por defecto no
 * lleva parámetro. Los demás parámetros (filtros con los que se entró desde un
 * enlace: empleado, mes, …) y el hash no se arrastran: pertenecían a la sección
 * anterior.
 */
export function urlParaSeccion(pathname: string, parametro: string, seccion: string, porDefecto: string): string {
  if (seccion === porDefecto) return pathname
  return `${pathname}?${parametro}=${encodeURIComponent(seccion)}`
}

/**
 * Sección que representa la URL actual (la que diría un recargo), para saber
 * si hace falta escribir una entrada nueva en el historial.
 */
export function seccionQueRepresentaLaUrl(search: string, parametros: readonly string[], porDefecto: string): string {
  return leerSeccionDeUrl(search, parametros) ?? porDefecto
}
