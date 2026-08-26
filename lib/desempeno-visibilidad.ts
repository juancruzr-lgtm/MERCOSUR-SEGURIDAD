// Quién puede ver el indicador de desempeño.
//
// ETAPA 1 (25/08/2026): el vigilador NO tiene acceso. Ni pestaña, ni tarjeta,
// ni número, ni "datos insuficientes". El modelo todavía está en validación y
// mostrarle una evaluación a alguien es difícil de deshacer: primero hay que
// estar seguros de que es justa y estable.
//
// La arquitectura queda lista para habilitarlo, pero DESHABILITADA POR DEFECTO,
// y no se enciende sola con el tiempo. Encenderla será una decisión explícita
// después de validar varios meses, los casos de baja puntuación, los falsos
// positivos, los datos insuficientes, y de incorporar rondas, IA y puntualidad.

import { supabase } from '@/lib/supabase'

/** La clave en `app_config`. Mismo patrón que `supervisor_gps_enabled`. */
export const CLAVE_VISIBLE_VIGILADOR = 'desempeno_visible_vigilador'

/**
 * Por defecto FALSE, y a propósito: si la clave no existe, si la consulta
 * falla, o si alguien la borra, el vigilador NO ve nada. El default seguro es
 * el que no muestra.
 */
export const VISIBLE_VIGILADOR_POR_DEFECTO = false

export interface ParametrosVisibilidad {
  rol: string | null | undefined
  /** ¿Está mirando su propio indicador? */
  esPropio: boolean
  /** Valor de `app_config.desempeno_visible_vigilador`. */
  visibleParaVigilador: boolean
}

function normalizar(rol: string | null | undefined): string {
  return String(rol || '').trim().toLowerCase()
}

/**
 * Función pura: decide, no consulta.
 *
 * El ALCANCE del supervisor no se resuelve acá. Lo aplica la carga de filas
 * mediante `objetivoEnAlcance`, que es el helper que ya usa toda la app. Un
 * supervisor sólo recibe empleados de su zona, así que no hay una segunda
 * regla de autorización que pueda contradecir a la primera.
 */
export function puedeVerDesempeno(p: ParametrosVisibilidad): boolean {
  const rol = normalizar(p.rol)
  if (rol === 'admin') return true
  if (rol === 'supervisor') return true
  // Vigilador: sólo lo suyo, y sólo si Administración lo habilitó.
  //
  // Boolean() no es decorativo: si la clave de app_config no existe, el valor
  // llega undefined y esto devolvía undefined en una función que promete
  // boolean. Hoy todos los llamadores la leen en contexto booleano y el
  // comportamiento es correcto, pero un solo `=== false` en el futuro abriría
  // el acceso. Una función de permisos devuelve false, no ausencia de false.
  return Boolean(p.esPropio && p.visibleParaVigilador)
}

/** ¿Se le ofrece siquiera la pantalla? */
export function puedeAbrirDesempeno(
  rol: string | null | undefined,
  visibleParaVigilador: boolean,
): boolean {
  return puedeVerDesempeno({ rol, esPropio: true, visibleParaVigilador })
}

/**
 * Lee el flag. Cualquier problema —clave inexistente, error de red, RLS—
 * devuelve el default seguro.
 *
 * Administración y Supervisión NO dependen de esto: el cálculo y la auditoría
 * siguen funcionando con el flag apagado.
 */
export async function leerVisibleParaVigilador(): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', CLAVE_VISIBLE_VIGILADOR)
      .maybeSingle()
    if (!data || typeof data.value !== 'string') return VISIBLE_VIGILADOR_POR_DEFECTO
    return data.value.trim().toLowerCase() === 'true'
  } catch {
    return VISIBLE_VIGILADOR_POR_DEFECTO
  }
}
