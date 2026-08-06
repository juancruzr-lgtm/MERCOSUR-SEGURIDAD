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
import { ordenarPosiciones } from '@/lib/posiciones-operativas'
import type { PosicionOperativa, DependenciasPosicion, DependenciasEliminacion } from '@/lib/posiciones-operativas'

// Reexporta toda la lógica pura de gestión de posiciones (sin Supabase, ver
// lib/posiciones-operativas.ts) para que el resto de la app siga importando
// todo desde acá con un solo `from '@/lib/puestos'`.
export * from '@/lib/posiciones-operativas'

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

// Terminología visible: "posición operativa" (los nombres técnicos puestos/
// puesto_id se conservan en base y código por compatibilidad).
export const MENSAJE_SIN_PUESTOS_ACTIVOS =
  'Este objetivo no tiene posiciones operativas activas. Creá una posición operativa antes de generar turnos.'

export const MENSAJE_PUESTO_REQUERIDO =
  'Este objetivo tiene más de una posición operativa activa: elegí a cuál corresponde el turno.'

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

  if (error) return { data: null, error: 'No se pudieron cargar las posiciones operativas del objetivo.' }
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

  if (error) return { data: null, error: 'No se pudieron cargar las posiciones operativas de los objetivos.' }

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
  if (!estado) return { ok: false, error: 'Todavía no se cargaron las posiciones operativas del objetivo.' }

  if (estado.caso === 'sin_puestos') {
    return { ok: false, error: MENSAJE_SIN_PUESTOS_ACTIVOS }
  }

  if (estado.caso === 'unico') {
    return { ok: true, puesto_id: estado.puestoUnicoId }
  }

  const elegido = puestoSeleccionado?.trim()
  if (!elegido) return { ok: false, error: MENSAJE_PUESTO_REQUERIDO }
  if (!estado.puestos.some(p => p.id === elegido)) {
    return { ok: false, error: 'La posición operativa elegida no pertenece a este objetivo.' }
  }
  return { ok: true, puesto_id: elegido }
}

// ============================================================================
// Gestión de posiciones operativas (Bloque E) — carga y escritura contra
// Supabase. Las reglas puras (normalización, dedupe, orden, dependencias)
// viven en lib/posiciones-operativas.ts y se reexportan arriba.
// ============================================================================
//
// Toda escritura pasa por RPCs SECURITY DEFINER (crear/editar/duplicar/
// eliminar_posicion_operativa): validación en servidor, transaccional,
// auditada en `puestos_auditoria`.

// ── Carga ────────────────────────────────────────────────────────────────────

const COLS_POSICION = 'id, objetivo_id, nombre, orden, activo, observacion, created_at'

/**
 * Todas las posiciones del objetivo (activas e inactivas: los históricos no
 * se ocultan) más qué posiciones activas tienen al menos un servicio activo
 * vinculado — la base del indicador "Sin cobertura configurada".
 */
export async function cargarPosicionesOperativas(
  objetivoId: string,
): Promise<{ posiciones: PosicionOperativa[]; conCobertura: Set<string>; error: string | null }> {
  const [posicionesRes, serviciosRes] = await Promise.all([
    supabase.from('puestos').select(COLS_POSICION).eq('objetivo_id', objetivoId),
    supabase.from('servicios_objetivo').select('puesto_id').eq('objetivo_id', objetivoId).eq('activo', true),
  ])
  if (posicionesRes.error) return { posiciones: [], conCobertura: new Set(), error: posicionesRes.error.message }

  const conCobertura = new Set(
    (serviciosRes.data ?? []).map((s: any) => s.puesto_id).filter(Boolean) as string[],
  )
  return {
    posiciones: ordenarPosiciones((posicionesRes.data ?? []) as PosicionOperativa[]),
    conCobertura,
    error: null,
  }
}

/**
 * Cuenta previa (solo lectura) para el diálogo de confirmación antes de
 * desactivar: cuántos turnos futuros vigentes y servicios activos dependen de
 * la posición. La RPC vuelve a validar esto mismo en servidor.
 */
export async function cargarDependenciasPosicion(
  puestoId: string,
  fechaActual: string,
  horaActual: string,
): Promise<{ data: DependenciasPosicion | null; error: string | null }> {
  const [turnosRes, serviciosRes] = await Promise.all([
    supabase.from('turnos').select('id, fecha, hora_inicio, estado').eq('puesto_id', puestoId).neq('estado', 'reemplazado'),
    supabase.from('servicios_objetivo').select('id', { count: 'exact', head: true }).eq('puesto_id', puestoId).eq('activo', true),
  ])
  if (turnosRes.error) return { data: null, error: turnosRes.error.message }
  if (serviciosRes.error) return { data: null, error: serviciosRes.error.message }

  const turnosFuturos = (turnosRes.data ?? []).filter((t: any) =>
    t.fecha > fechaActual || (t.fecha === fechaActual && String(t.hora_inicio).slice(0, 5) > horaActual),
  ).length

  return { data: { turnosFuturos, serviciosActivos: serviciosRes.count ?? 0 }, error: null }
}

/**
 * Cuenta previa (solo lectura) para el diálogo de eliminación excepcional:
 * turnos y servicios de cualquier momento (no solo futuros) más historial de
 * auditoría más allá de la propia creación. La RPC vuelve a validar esto.
 */
export async function cargarDependenciasEliminacion(
  puestoId: string,
): Promise<{ data: DependenciasEliminacion | null; error: string | null }> {
  const [turnosRes, serviciosRes, auditoriaRes] = await Promise.all([
    supabase.from('turnos').select('id', { count: 'exact', head: true }).eq('puesto_id', puestoId),
    supabase.from('servicios_objetivo').select('id', { count: 'exact', head: true }).eq('puesto_id', puestoId),
    supabase.from('puestos_auditoria').select('id', { count: 'exact', head: true }).eq('puesto_id', puestoId).neq('accion', 'crear'),
  ])
  if (turnosRes.error) return { data: null, error: turnosRes.error.message }
  if (serviciosRes.error) return { data: null, error: serviciosRes.error.message }
  if (auditoriaRes.error) return { data: null, error: auditoriaRes.error.message }

  return {
    data: {
      turnosTotal: turnosRes.count ?? 0,
      serviciosTotal: serviciosRes.count ?? 0,
      auditoriaMasAllaDeCrear: auditoriaRes.count ?? 0,
    },
    error: null,
  }
}

// ── Escritura (RPCs auditadas) ──────────────────────────────────────────────

export async function crearPosicionOperativa(
  objetivoId: string, nombre: string, orden: number | null, observacion: string | null,
): Promise<{ data: PosicionOperativa | null; error: string | null }> {
  const { data, error } = await supabase.rpc('crear_posicion_operativa', {
    p_objetivo_id: objetivoId, p_nombre: nombre.trim(), p_orden: orden, p_observacion: observacion || null,
  })
  if (error) return { data: null, error: error.message }
  return { data: data as PosicionOperativa, error: null }
}

export async function editarPosicionOperativa(
  cambios: { id: string; nombre?: string; orden?: number | null; observacion?: string | null; activo?: boolean },
): Promise<{ data: PosicionOperativa | null; error: string | null }> {
  const { data, error } = await supabase.rpc('editar_posicion_operativa', {
    p_id: cambios.id,
    p_nombre: cambios.nombre ?? null,
    p_orden: cambios.orden === undefined ? null : cambios.orden,
    p_observacion: cambios.observacion === undefined ? null : cambios.observacion,
    p_activo: cambios.activo === undefined ? null : cambios.activo,
  })
  if (error) return { data: null, error: error.message }
  return { data: data as PosicionOperativa, error: null }
}

export async function duplicarPosicionOperativa(
  idOrigen: string, nombreNuevo: string,
): Promise<{ data: PosicionOperativa | null; error: string | null }> {
  const { data, error } = await supabase.rpc('duplicar_posicion_operativa', {
    p_id_origen: idOrigen, p_nombre_nuevo: nombreNuevo.trim(),
  })
  if (error) return { data: null, error: error.message }
  return { data: data as PosicionOperativa, error: null }
}

export async function eliminarPosicionOperativa(
  id: string, motivo: string,
): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await supabase.rpc('eliminar_posicion_operativa', { p_id: id, p_motivo: motivo || null })
  if (error) return { ok: false, error: error.message }
  return { ok: true, error: null }
}
