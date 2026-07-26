import { supabase } from '@/lib/supabase'

export const RONDA_INTERVALO_MINIMO = 15
export const RONDA_INTERVALO_MAXIMO = 10080

export interface RondaBase {
  id: string
  objetivo_id: string
  nombre: string
  descripcion: string | null
  intervalo_minutos: number
  activo: boolean
  version: number
  creado_por: string | null
  actualizado_por: string | null
  created_at: string
  updated_at: string
}

export interface RondaBaseResumen extends RondaBase {
  cantidad_puntos: number
}

export interface RondaPunto {
  id: string
  ronda_base_id: string
  nombre: string
  descripcion: string | null
  orden: number
  foto_requerida: boolean
  gps_requerido: boolean
  latitud: number | null
  longitud: number | null
  precision_metros: number | null
  radio_metros: number | null
  activo: boolean
  created_at: string
  updated_at: string
}

export interface NuevaRondaBase {
  objetivo_id: string
  nombre: string
  descripcion?: string | null
  intervalo_minutos: number
  activo?: boolean
}

export interface ActualizarRondaBase {
  nombre?: string
  descripcion?: string | null
  intervalo_minutos?: number
  activo?: boolean
}

export interface NuevoRondaPunto {
  nombre: string
  descripcion?: string | null
  foto_requerida: boolean
  gps_requerido: boolean
  latitud?: number | null
  longitud?: number | null
  precision_metros?: number | null
  radio_metros?: number | null
  activo?: boolean
}

export type ActualizarRondaPunto = Partial<NuevoRondaPunto>

export type ResultadoRondas<T> =
  | { data: T; error: null }
  | { data: null; error: string }

const COLS_RONDA_BASE =
  'id, objetivo_id, nombre, descripcion, intervalo_minutos, activo, version, creado_por, actualizado_por, created_at, updated_at'
const COLS_RONDA_PUNTO =
  'id, ronda_base_id, nombre, descripcion, orden, foto_requerida, gps_requerido, latitud, longitud, precision_metros, radio_metros, activo, created_at, updated_at'

function mensajeError(error: { message?: string } | null, fallback: string): string {
  if (!error?.message) return fallback
  if (/rondas_base_objetivo_nombre_activo_unique/i.test(error.message)) {
    return 'Ya existe una ronda activa con ese nombre en el objetivo.'
  }
  if (/row-level security|permission denied/i.test(error.message)) {
    return 'No tenés permiso para administrar rondas de este objetivo.'
  }
  return error.message
}

export function validarRondaBase(
  datos: Pick<NuevaRondaBase, 'nombre' | 'intervalo_minutos'>,
): string | null {
  if (!datos.nombre.trim()) return 'El nombre de la ronda es obligatorio.'
  if (!Number.isInteger(datos.intervalo_minutos)) return 'El intervalo debe expresarse en minutos enteros.'
  if (
    datos.intervalo_minutos < RONDA_INTERVALO_MINIMO ||
    datos.intervalo_minutos > RONDA_INTERVALO_MAXIMO
  ) {
    return 'El intervalo debe estar entre 15 minutos y 7 días.'
  }
  return null
}

export function validarRondaPunto(datos: NuevoRondaPunto): string | null {
  if (!datos.nombre.trim()) return 'El nombre del punto es obligatorio.'

  const tieneLatitud = datos.latitud !== null && datos.latitud !== undefined
  const tieneLongitud = datos.longitud !== null && datos.longitud !== undefined
  if (tieneLatitud !== tieneLongitud) return 'La latitud y la longitud deben guardarse juntas.'
  if (tieneLatitud && (datos.latitud! < -90 || datos.latitud! > 90)) return 'La latitud no es válida.'
  if (tieneLongitud && (datos.longitud! < -180 || datos.longitud! > 180)) return 'La longitud no es válida.'
  if (
    datos.precision_metros !== null &&
    datos.precision_metros !== undefined &&
    datos.precision_metros < 0
  ) {
    return 'La precisión GPS no puede ser negativa.'
  }
  if (datos.radio_metros !== null && datos.radio_metros !== undefined && datos.radio_metros <= 0) {
    return 'El radio permitido debe ser mayor que cero.'
  }
  return null
}

export function presentarIntervalo(minutos: number): string {
  if (minutos % 1440 === 0) {
    const dias = minutos / 1440
    return dias === 1 ? 'Cada día' : `Cada ${dias} días`
  }
  if (minutos % 60 === 0) {
    const horas = minutos / 60
    return horas === 1 ? 'Cada hora' : `Cada ${horas} horas`
  }
  return `Cada ${minutos} minutos`
}

export async function obtenerRondasPorObjetivo(
  objetivoId: string,
): Promise<ResultadoRondas<RondaBaseResumen[]>> {
  const rondasRes = await supabase
    .from('rondas_base')
    .select(COLS_RONDA_BASE)
    .eq('objetivo_id', objetivoId)
    .order('activo', { ascending: false })
    .order('nombre', { ascending: true })

  if (rondasRes.error) {
    return { data: null, error: mensajeError(rondasRes.error, 'No se pudieron cargar las rondas.') }
  }

  const rondas = (rondasRes.data ?? []) as RondaBase[]
  if (rondas.length === 0) return { data: [], error: null }

  const puntosRes = await supabase
    .from('ronda_puntos')
    .select('id, ronda_base_id')
    .in('ronda_base_id', rondas.map(ronda => ronda.id))
    .eq('activo', true)

  if (puntosRes.error) {
    return { data: null, error: mensajeError(puntosRes.error, 'No se pudieron contar los puntos.') }
  }

  const cantidades = new Map<string, number>()
  for (const punto of (puntosRes.data ?? []) as Array<{ id: string; ronda_base_id: string }>) {
    cantidades.set(punto.ronda_base_id, (cantidades.get(punto.ronda_base_id) ?? 0) + 1)
  }

  return {
    data: rondas.map(ronda => ({
      ...ronda,
      cantidad_puntos: cantidades.get(ronda.id) ?? 0,
    })),
    error: null,
  }
}

export async function obtenerRondaConPuntos(
  rondaBaseId: string,
): Promise<ResultadoRondas<{ ronda: RondaBase; puntos: RondaPunto[] }>> {
  const [rondaRes, puntosRes] = await Promise.all([
    supabase.from('rondas_base').select(COLS_RONDA_BASE).eq('id', rondaBaseId).single(),
    supabase.from('ronda_puntos').select(COLS_RONDA_PUNTO)
      .eq('ronda_base_id', rondaBaseId)
      .order('orden', { ascending: true }),
  ])

  const error = rondaRes.error ?? puntosRes.error
  if (error) {
    return { data: null, error: mensajeError(error, 'No se pudo cargar la ronda.') }
  }

  return {
    data: {
      ronda: rondaRes.data as RondaBase,
      puntos: (puntosRes.data ?? []) as RondaPunto[],
    },
    error: null,
  }
}

export async function crearRondaBase(
  datos: NuevaRondaBase,
): Promise<ResultadoRondas<RondaBase>> {
  const errorValidacion = validarRondaBase(datos)
  if (errorValidacion) return { data: null, error: errorValidacion }

  const { data, error } = await supabase
    .from('rondas_base')
    .insert({
      objetivo_id: datos.objetivo_id,
      nombre: datos.nombre.trim(),
      descripcion: datos.descripcion?.trim() || null,
      intervalo_minutos: datos.intervalo_minutos,
      activo: datos.activo ?? true,
    })
    .select(COLS_RONDA_BASE)
    .single()

  if (error) return { data: null, error: mensajeError(error, 'No se pudo crear la ronda.') }
  return { data: data as RondaBase, error: null }
}

export async function actualizarRondaBase(
  rondaBaseId: string,
  cambios: ActualizarRondaBase,
): Promise<ResultadoRondas<RondaBase>> {
  if (cambios.nombre !== undefined && !cambios.nombre.trim()) {
    return { data: null, error: 'El nombre de la ronda es obligatorio.' }
  }
  if (
    cambios.intervalo_minutos !== undefined &&
    (
      !Number.isInteger(cambios.intervalo_minutos) ||
      cambios.intervalo_minutos < RONDA_INTERVALO_MINIMO ||
      cambios.intervalo_minutos > RONDA_INTERVALO_MAXIMO
    )
  ) {
    return { data: null, error: 'El intervalo debe estar entre 15 minutos y 7 días.' }
  }

  const payload: ActualizarRondaBase = { ...cambios }
  if (payload.nombre !== undefined) payload.nombre = payload.nombre.trim()
  if (payload.descripcion !== undefined) payload.descripcion = payload.descripcion?.trim() || null

  const { data, error } = await supabase
    .from('rondas_base')
    .update(payload)
    .eq('id', rondaBaseId)
    .select(COLS_RONDA_BASE)
    .single()

  if (error) return { data: null, error: mensajeError(error, 'No se pudo actualizar la ronda.') }
  return { data: data as RondaBase, error: null }
}

export function cambiarEstadoRonda(
  rondaBaseId: string,
  activo: boolean,
): Promise<ResultadoRondas<RondaBase>> {
  return actualizarRondaBase(rondaBaseId, { activo })
}

export async function agregarPunto(
  rondaBaseId: string,
  datos: NuevoRondaPunto,
): Promise<ResultadoRondas<RondaPunto>> {
  const errorValidacion = validarRondaPunto(datos)
  if (errorValidacion) return { data: null, error: errorValidacion }

  const ordenRes = await supabase
    .from('ronda_puntos')
    .select('orden')
    .eq('ronda_base_id', rondaBaseId)
    .order('orden', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (ordenRes.error) {
    return { data: null, error: mensajeError(ordenRes.error, 'No se pudo calcular el orden del punto.') }
  }

  const proximoOrden = ((ordenRes.data as { orden: number } | null)?.orden ?? 0) + 1
  if (proximoOrden > 10000) return { data: null, error: 'La ronda alcanzó el máximo de puntos permitido.' }

  const { data, error } = await supabase
    .from('ronda_puntos')
    .insert({
      ronda_base_id: rondaBaseId,
      nombre: datos.nombre.trim(),
      descripcion: datos.descripcion?.trim() || null,
      orden: proximoOrden,
      foto_requerida: datos.foto_requerida,
      gps_requerido: datos.gps_requerido,
      latitud: datos.latitud ?? null,
      longitud: datos.longitud ?? null,
      precision_metros: datos.precision_metros ?? null,
      radio_metros: datos.radio_metros ?? null,
      activo: datos.activo ?? true,
    })
    .select(COLS_RONDA_PUNTO)
    .single()

  if (error) return { data: null, error: mensajeError(error, 'No se pudo agregar el punto.') }
  return { data: data as RondaPunto, error: null }
}

export async function actualizarPunto(
  puntoId: string,
  cambios: ActualizarRondaPunto,
): Promise<ResultadoRondas<RondaPunto>> {
  if (cambios.nombre !== undefined && !cambios.nombre.trim()) {
    return { data: null, error: 'El nombre del punto es obligatorio.' }
  }
  if (cambios.latitud !== undefined && cambios.latitud !== null && (cambios.latitud < -90 || cambios.latitud > 90)) {
    return { data: null, error: 'La latitud no es válida.' }
  }
  if (cambios.longitud !== undefined && cambios.longitud !== null && (cambios.longitud < -180 || cambios.longitud > 180)) {
    return { data: null, error: 'La longitud no es válida.' }
  }
  if (cambios.precision_metros !== undefined && cambios.precision_metros !== null && cambios.precision_metros < 0) {
    return { data: null, error: 'La precisión GPS no puede ser negativa.' }
  }
  if (cambios.radio_metros !== undefined && cambios.radio_metros !== null && cambios.radio_metros <= 0) {
    return { data: null, error: 'El radio permitido debe ser mayor que cero.' }
  }

  const payload: ActualizarRondaPunto = { ...cambios }
  if (payload.nombre !== undefined) payload.nombre = payload.nombre.trim()
  if (payload.descripcion !== undefined) payload.descripcion = payload.descripcion?.trim() || null

  const { data, error } = await supabase
    .from('ronda_puntos')
    .update(payload)
    .eq('id', puntoId)
    .select(COLS_RONDA_PUNTO)
    .single()

  if (error) return { data: null, error: mensajeError(error, 'No se pudo actualizar el punto.') }
  return { data: data as RondaPunto, error: null }
}

export function desactivarPunto(
  puntoId: string,
): Promise<ResultadoRondas<RondaPunto>> {
  return actualizarPunto(puntoId, { activo: false })
}

export async function reordenarPuntos(
  rondaBaseId: string,
  puntoIds: string[],
): Promise<ResultadoRondas<true>> {
  if (new Set(puntoIds).size !== puntoIds.length) {
    return { data: null, error: 'La lista contiene puntos duplicados.' }
  }

  const { error } = await supabase.rpc('reordenar_ronda_puntos', {
    p_ronda_base_id: rondaBaseId,
    p_punto_ids: puntoIds,
  })

  if (error) return { data: null, error: mensajeError(error, 'No se pudieron reordenar los puntos.') }
  return { data: true, error: null }
}
