/**
 * lib/estatuto-original.ts
 *
 * Dónde vive el Word ORIGINAL del Estatuto y quién puede bajarlo.
 *
 * ── Por qué no está en /public ───────────────────────────────────────────────
 * Decisión de Gerencia (08/10/2026): el vigilador lee el Estatuto en la app
 * (texto completo, cómodo en el celular) y lo acepta, pero no se le ofrece el
 * archivo editable. Administración y Gerencia sí conservan el original.
 *
 * Ocultar el botón no alcanza: todo lo que está en /public se sirve a
 * cualquiera que tenga la dirección, sin sesión. Por eso el .doc vive en
 * `privado/` (fuera de lo que Next sirve como estático) y sólo sale por
 * /api/estatuto/original, que verifica la sesión y el permiso en la BASE con la
 * misma regla que ya protege los borradores del Estatuto:
 * puede_gestionar_personal_actual() OR puede_acceder_gerencia_actual().
 *
 * La copia PDF (no editable) sigue en /public y la puede abrir cualquiera que
 * lea el Estatuto.
 */

/** Carpeta del repo con los originales. Fuera de /public a propósito. */
export const CARPETA_ORIGINALES = 'privado/estatuto'

/** Ruta de la API que sirve el original de una versión. */
export function urlOriginal(identificador: string): string {
  return `/api/estatuto/original?version=${encodeURIComponent(identificador)}`
}

/**
 * Ruta relativa del .doc de una versión. `null` si el identificador no es un
 * número de versión válido: nunca se arma una ruta con texto arbitrario
 * (evita `../` y cualquier otro intento de salir de la carpeta).
 */
export function rutaOriginal(identificador: string | null | undefined): string | null {
  if (!identificador || !/^[1-9][0-9]{0,3}$/.test(identificador)) return null
  return `${CARPETA_ORIGINALES}/v${identificador}/estatuto-interno.doc`
}

/** Nombre con el que se descarga. Sin fecha, como pidió Gerencia. */
export function nombreDescarga(identificador: string): string {
  return identificador === '1' ? 'estatuto-interno.doc' : `estatuto-interno-v${identificador}.doc`
}
