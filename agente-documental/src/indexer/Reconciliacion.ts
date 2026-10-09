/**
 * Reconciliación de eliminados: qué rutas conocidas se marcan "no
 * disponibles" después de un escaneo. Pura (sin disco ni base) para poder
 * probarla.
 *
 * Antes (H-13): todo lo que no aparecía en el escaneo se marcaba eliminado.
 * Una carpeta que no se pudo leer, MEGA a mitad de sincronizar o la unidad
 * desmontada marcaban miles de archivos como borrados. Ahora:
 *   - las rutas de carpetas excluidas (papelera de sincronización) no se tocan;
 *   - lo que está debajo de una carpeta que no se pudo leer, o un archivo que
 *     no se pudo leer, queda protegido (no se sabe si existe);
 *   - si no se encontró NINGÚN archivo, o faltan más del umbral de los
 *     conocidos, no se marca nada y se avisa (se puede forzar a mano).
 */

export interface OpcionesReconciliacion {
  /** Carpetas (rutas relativas, con "/") que no se pudieron leer. */
  dirsIlegibles: string[]
  /** Archivos (rutas relativas) que se vieron pero no se pudieron leer. */
  archivosIlegibles: Set<string>
  /** ¿La ruta está en una carpeta excluida (papelera, etc.)? */
  excluida: (rutaRelativa: string) => boolean
  /** Proporción máxima de faltantes (0..1) antes de abortar. */
  umbralFaltantes: number
  /** Marcar aunque se supere el umbral (decisión expresa). */
  forzar?: boolean
}

export interface PlanReconciliacion {
  marcar: string[]
  protegidas: number
  excluidas: number
  /** Motivo por el que no se marca nada, o null. */
  abortada: string | null
}

export const UMBRAL_FALTANTES_POR_DEFECTO = 0.2

export function planReconciliacion(
  conocidas: string[],
  encontradas: Set<string>,
  o: OpcionesReconciliacion,
): PlanReconciliacion {
  const dirs = o.dirsIlegibles.map(d => d.replace(/\\/g, '/').replace(/\/+$/, ''))
  const bajoIlegible = (ruta: string) => dirs.some(d => d === '' || ruta === d || ruta.startsWith(d + '/'))

  let protegidas = 0
  let excluidas = 0
  let consideradas = 0
  const marcar: string[] = []

  for (const ruta of conocidas) {
    if (o.excluida(ruta)) { excluidas++; continue }
    consideradas++
    if (encontradas.has(ruta)) continue
    if (o.archivosIlegibles.has(ruta) || bajoIlegible(ruta)) { protegidas++; continue }
    marcar.push(ruta)
  }

  if (consideradas > 0 && encontradas.size === 0) {
    return { marcar: [], protegidas, excluidas, abortada: 'El escaneo no encontró ningún archivo: ¿la carpeta está desmontada o MEGA no terminó de sincronizar?' }
  }
  const proporcion = consideradas > 0 ? marcar.length / consideradas : 0
  if (!o.forzar && proporcion > o.umbralFaltantes) {
    return {
      marcar: [], protegidas, excluidas,
      abortada: `Faltan ${marcar.length} de ${consideradas} archivos conocidos (${Math.round(proporcion * 100)}%), más que el umbral de ${Math.round(o.umbralFaltantes * 100)}%. No se marcó nada como eliminado. Si es correcto, repetir con --forzar-reconciliacion.`,
    }
  }
  return { marcar, protegidas, excluidas, abortada: null }
}
