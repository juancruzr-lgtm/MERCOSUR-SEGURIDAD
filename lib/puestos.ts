// ============================================================================
// Puestos operativos — regla única de asignación al crear turnos
// ============================================================================
//
// Todo alta de turno necesita resolver a qué puesto pertenece. La regla es la
// misma en las cinco rutas de creación, así que vive acá y no replicada:
//
//   exactamente 1 puesto activo -> se asigna solo, sin pedir nada al usuario
//   2 o más puestos activos     -> hay que elegir; no se guarda sin elección
//   0 puestos activos           -> no se puede crear el turno
//
// La capa de base repite la primera regla en el trigger
// `turnos_completar_puesto` (20260728100000). No es duplicación: el trigger es
// la red que cubre cargas masivas, scripts y rutas futuras, y estas funciones
// son las que permiten mostrarle algo útil a quien está cargando el turno.

import { supabase } from '@/lib/supabase'

export interface PuestoActivo {
  id: string
  objetivo_id: string
  nombre: string
  orden: number | null
}

export type CasoPuestos = 'sin_puestos' | 'unico' | 'multiple'

export interface EstadoPuestos {
  caso: CasoPuestos
  puestos: PuestoActivo[]
  /** Id del único puesto activo, o null si hay 0 o más de 1. */
  puestoUnicoId: string | null
}

export const MENSAJE_SIN_PUESTOS_ACTIVOS =
  'Este objetivo no tiene puestos activos. Creá un puesto antes de generar turnos.'

export const MENSAJE_PUESTO_REQUERIDO =
  'Este objetivo tiene más de un puesto activo: elegí a cuál corresponde el turno.'

const COLS_PUESTO = 'id, objetivo_id, nombre, orden'

const ESTADO_VACIO: EstadoPuestos = { caso: 'sin_puestos', puestos: [], puestoUnicoId: null }

/** Clasifica una lista ya cargada de puestos activos. Pura. */
export function clasificarPuestos(puestos: PuestoActivo[]): EstadoPuestos {
  if (puestos.length === 0) return ESTADO_VACIO
  if (puestos.length === 1) {
    return { caso: 'unico', puestos, puestoUnicoId: puestos[0].id }
  }
  return { caso: 'multiple', puestos, puestoUnicoId: null }
}

/** Puestos activos de un objetivo, ordenados como se muestran en pantalla. */
export async function obtenerPuestosActivos(
  objetivoId: string,
): Promise<{ data: EstadoPuestos | null; error: string | null }> {
  if (!objetivoId) return { data: ESTADO_VACIO, error: null }

  const { data, error } = await supabase
    .from('puestos')
    .select(COLS_PUESTO)
    .eq('objetivo_id', objetivoId)
    .eq('activo', true)
    .order('orden', { ascending: true, nullsFirst: false })
    .order('nombre', { ascending: true })

  if (error) return { data: null, error: 'No se pudieron cargar los puestos del objetivo.' }
  return { data: clasificarPuestos((data ?? []) as PuestoActivo[]), error: null }
}

/**
 * Puestos activos de varios objetivos en una sola consulta.
 * Para la generación mensual, que recorre muchos objetivos y no puede hacer
 * una consulta por cada uno.
 */
export async function obtenerPuestosActivosDeObjetivos(
  objetivoIds: string[],
): Promise<{ data: Map<string, EstadoPuestos> | null; error: string | null }> {
  const ids = Array.from(new Set(objetivoIds.filter(Boolean)))
  if (ids.length === 0) return { data: new Map(), error: null }

  const { data, error } = await supabase
    .from('puestos')
    .select(COLS_PUESTO)
    .in('objetivo_id', ids)
    .eq('activo', true)
    .order('orden', { ascending: true, nullsFirst: false })
    .order('nombre', { ascending: true })

  if (error) return { data: null, error: 'No se pudieron cargar los puestos de los objetivos.' }

  const porObjetivo = new Map<string, PuestoActivo[]>()
  for (const puesto of (data ?? []) as PuestoActivo[]) {
    porObjetivo.set(puesto.objetivo_id, [...(porObjetivo.get(puesto.objetivo_id) ?? []), puesto])
  }

  const resultado = new Map<string, EstadoPuestos>()
  for (const id of ids) {
    resultado.set(id, clasificarPuestos(porObjetivo.get(id) ?? []))
  }
  return { data: resultado, error: null }
}

export type ResolucionPuesto =
  | { ok: true; puesto_id: string | null }
  | { ok: false; error: string }

/**
 * Decide qué `puesto_id` mandar al crear un turno, o por qué no se puede.
 *
 * En el caso `unico` devuelve el id igual que lo haría el trigger. Mandarlo
 * explícito deja el dato visible en la auditoría del alta en lugar de aparecer
 * "de la nada" al leer la fila después.
 */
export function resolverPuestoTurno(
  estado: EstadoPuestos | null,
  puestoSeleccionado?: string | null,
): ResolucionPuesto {
  if (!estado) return { ok: false, error: 'Todavía no se cargaron los puestos del objetivo.' }

  if (estado.caso === 'sin_puestos') {
    return { ok: false, error: MENSAJE_SIN_PUESTOS_ACTIVOS }
  }

  if (estado.caso === 'unico') {
    return { ok: true, puesto_id: estado.puestoUnicoId }
  }

  const elegido = puestoSeleccionado?.trim()
  if (!elegido) return { ok: false, error: MENSAJE_PUESTO_REQUERIDO }
  if (!estado.puestos.some(p => p.id === elegido)) {
    return { ok: false, error: 'El puesto elegido no pertenece a este objetivo.' }
  }
  return { ok: true, puesto_id: elegido }
}
