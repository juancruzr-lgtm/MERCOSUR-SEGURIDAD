/**
 * lib/vinculacion-puestos.ts
 *
 * Bloque E (commit 2) — Sugerencia de vinculación de servicios legacy
 * (servicios_objetivo.nombre_puesto de texto libre) con puestos reales.
 *
 * Regla aprobada:
 *   · la vinculación NUNCA se decide automáticamente: siempre la confirma
 *     el administrador con el botón Vincular;
 *   · con nombre legacy: solo se sugiere el puesto cuyo nombre coincide
 *     (normalizado); varias coincidencias → el admin elige; ninguna →
 *     "Sin puesto compatible" (no se crean puestos, no se modifica nada);
 *   · sin nombre legacy: aplica la regla única de lib/puestos (un solo
 *     puesto activo → sugerencia única; varios → el admin elige).
 */

import type { PuestoActivo } from '@/lib/puestos'

export type EstadoVinculacion =
  | 'vinculado'            // el servicio ya tiene puesto_id
  | 'sugerencia_unica'     // una única coincidencia: puede vincularse con un clic
  | 'ambiguo'              // varias coincidencias: el administrador debe elegir
  | 'sin_coincidencia'     // hay puestos pero ninguno compatible con el nombre legacy
  | 'sin_puestos'          // el objetivo no tiene puestos activos

export interface SugerenciaVinculacion {
  estado: EstadoVinculacion
  /** Puesto sugerido cuando la coincidencia es única. */
  puestoSugerido: PuestoActivo | null
  /** Candidatos a mostrar cuando el administrador debe elegir. */
  candidatos: PuestoActivo[]
}

export const ETIQUETA_VINCULACION: Record<EstadoVinculacion, string> = {
  vinculado: 'Vinculado',
  sugerencia_unica: 'Coincidencia única',
  ambiguo: 'Varias coincidencias — elegir',
  sin_coincidencia: 'Sin posición operativa compatible',
  sin_puestos: 'El objetivo no tiene posiciones operativas activas',
}

const normalizar = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

export function sugerirVinculacion(
  servicio: { puesto_id?: string | null; nombre_puesto?: string | null },
  puestosDelObjetivo: PuestoActivo[],
): SugerenciaVinculacion {
  if (servicio.puesto_id) {
    return { estado: 'vinculado', puestoSugerido: null, candidatos: [] }
  }
  if (puestosDelObjetivo.length === 0) {
    return { estado: 'sin_puestos', puestoSugerido: null, candidatos: [] }
  }

  const nombre = (servicio.nombre_puesto ?? '').trim()

  if (!nombre) {
    // Sin nombre legacy: regla única de puestos del proyecto.
    if (puestosDelObjetivo.length === 1) {
      return { estado: 'sugerencia_unica', puestoSugerido: puestosDelObjetivo[0], candidatos: puestosDelObjetivo }
    }
    return { estado: 'ambiguo', puestoSugerido: null, candidatos: puestosDelObjetivo }
  }

  const objetivo = normalizar(nombre)
  const coincidencias = puestosDelObjetivo.filter(p => normalizar(p.nombre) === objetivo)

  if (coincidencias.length === 1) {
    return { estado: 'sugerencia_unica', puestoSugerido: coincidencias[0], candidatos: coincidencias }
  }
  if (coincidencias.length > 1) {
    return { estado: 'ambiguo', puestoSugerido: null, candidatos: coincidencias }
  }
  // Nombre legacy sin match (p. ej. "DIURNO A" contra "Principal"): queda
  // pendiente. No se sugiere el único puesto del objetivo: no hay información
  // suficiente para asumir que representan lo mismo.
  return { estado: 'sin_coincidencia', puestoSugerido: null, candidatos: [] }
}
