import { supabase } from '@/lib/supabase'

export const RONDA_INTERVALO_MINIMO = 15
export const RONDA_INTERVALO_MAXIMO = 10080

export type OrigenPosicion = 'gps' | 'manual' | null

export interface RondaBase {
  id: string
  objetivo_id: string
  puesto_id: string
  nombre: string
  descripcion: string | null
  intervalo_minutos: number
  hora_inicio: string | null
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
  origen_posicion: OrigenPosicion
  activo: boolean
  created_at: string
  updated_at: string
}

export interface NuevaRondaBase {
  objetivo_id: string
  puesto_id: string
  nombre: string
  descripcion?: string | null
  intervalo_minutos: number
  hora_inicio?: string | null
  activo?: boolean
}

export interface ActualizarRondaBase {
  nombre?: string
  descripcion?: string | null
  intervalo_minutos?: number
  hora_inicio?: string | null
  activo?: boolean
}

export interface PuestoRonda {
  id: string
  objetivo_id: string
  nombre: string
  activo: boolean
  orden: number | null
}

export type MotivoAccesoRondas =
  | 'administrador'
  | 'supervisor_en_zona'
  | 'objetivo_sin_zona'
  | 'fuera_de_zona'
  | 'sin_permiso'

export interface AccesoRondasObjetivo {
  puede_administrar: boolean
  motivo: MotivoAccesoRondas
  cantidad_rondas: number | null
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
  origen_posicion?: OrigenPosicion
  activo?: boolean
}

export type ActualizarRondaPunto = Partial<NuevoRondaPunto>

export type ResultadoRondas<T> =
  | { data: T; error: null }
  | { data: null; error: string }

interface ErrorSupabase {
  message?: string
  code?: string
  details?: string
  hint?: string
}

const COLS_RONDA_BASE =
  'id, objetivo_id, puesto_id, nombre, descripcion, intervalo_minutos, hora_inicio, activo, version, creado_por, actualizado_por, created_at, updated_at'
const COLS_RONDA_PUNTO =
  'id, ronda_base_id, nombre, descripcion, orden, foto_requerida, gps_requerido, latitud, longitud, precision_metros, radio_metros, origen_posicion, activo, created_at, updated_at'

function mensajeError(error: ErrorSupabase | null, fallback: string): string {
  if (!error?.message) return fallback
  if (error.code === '42703' && /origen_posicion/i.test(error.message)) {
    return 'No se pueden administrar los puntos porque falta aplicar la actualización de origen de posición en la base de datos.'
  }
  if (/null value in column ["']?puesto_id|rondas_base_puesto_id_not_null/i.test(error.message)) {
    return 'Seleccioná el puesto al que pertenece la ronda.'
  }
  if (/rondas_base_objetivo_nombre_activo_unique/i.test(error.message)) {
    return 'Ya existe una ronda activa con ese nombre en el objetivo.'
  }
  if (/rondas_base_puesto_nombre_activo_unique/i.test(error.message)) {
    return 'Ya existe una ronda activa con ese nombre en el puesto.'
  }
  if (/rondas_base_puesto_objetivo_fkey/i.test(error.message)) {
    return 'El puesto seleccionado no pertenece a este objetivo.'
  }
  if (/rondas_base_intervalo_valido/i.test(error.message)) {
    return 'El intervalo debe estar entre 15 minutos y 7 días.'
  }
  if (/rondas_base_nombre_no_vacio|ronda_puntos_nombre_no_vacio/i.test(error.message)) {
    return 'El nombre es obligatorio.'
  }
  if (/ronda_puntos_(latitud|longitud|coordenadas_completas)/i.test(error.message)) {
    return 'Las coordenadas no son válidas o están incompletas.'
  }
  if (/ronda_puntos_(precision|radio)_valida/i.test(error.message)) {
    return 'La precisión o el radio configurado no es válido.'
  }
  if (/foreign key|violates foreign key/i.test(error.message)) {
    return 'La operación referencia un registro inexistente o que ya no está disponible.'
  }
  if (/ronda_puntos_ronda_orden_unique|duplicate key/i.test(error.message)) {
    return 'La ronda cambió al mismo tiempo desde otro dispositivo. Recargá los puntos e intentá nuevamente.'
  }
  if (/La ronda cambio mientras se reordenaba/i.test(error.message)) {
    return 'La ronda cambió mientras la reordenabas. Se recargaron los puntos; intentá nuevamente.'
  }
  if (/row-level security|permission denied/i.test(error.message)) {
    return 'No tenés permiso para administrar rondas de este objetivo.'
  }
  return fallback
}

function registrarErrorSupabase(contexto: string, error: ErrorSupabase): void {
  console.error(`[rondas] ${contexto}`, {
    message: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
  })
}

export function validarRondaBase(
  datos: Pick<NuevaRondaBase, 'nombre' | 'intervalo_minutos' | 'puesto_id'>,
): string | null {
  if (!datos.nombre.trim()) return 'El nombre de la ronda es obligatorio.'
  if (typeof datos.puesto_id !== 'string' || !datos.puesto_id.trim()) {
    return 'El puesto de la ronda es obligatorio.'
  }
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
  if (!tieneLatitud && datos.origen_posicion) return 'Un punto sin coordenadas no puede tener origen de posición.'
  if (
    !tieneLatitud &&
    datos.precision_metros !== null &&
    datos.precision_metros !== undefined
  ) {
    return 'Un punto sin coordenadas no puede conservar precisión GPS.'
  }
  if (
    datos.origen_posicion !== undefined &&
    datos.origen_posicion !== null &&
    datos.origen_posicion !== 'gps' &&
    datos.origen_posicion !== 'manual'
  ) {
    return 'El origen de la posición no es válido.'
  }
  if (
    datos.origen_posicion === 'manual' &&
    datos.precision_metros !== null &&
    datos.precision_metros !== undefined
  ) {
    return 'Una posición corregida manualmente no conserva la precisión GPS.'
  }
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

export async function obtenerPuestosRonda(
  objetivoId: string,
): Promise<ResultadoRondas<PuestoRonda[]>> {
  const { data, error } = await supabase
    .from('puestos')
    .select('id, objetivo_id, nombre, activo, orden')
    .eq('objetivo_id', objetivoId)
    .eq('activo', true)
    .order('activo', { ascending: false })
    .order('orden', { ascending: true, nullsFirst: false })
    .order('nombre', { ascending: true })

  if (error) return { data: null, error: mensajeError(error, 'No se pudieron cargar los puestos.') }
  return { data: (data ?? []) as PuestoRonda[], error: null }
}

export async function obtenerAccesoRondasObjetivo(
  objetivoId: string,
): Promise<ResultadoRondas<AccesoRondasObjetivo>> {
  const { data, error } = await supabase
    .rpc('estado_acceso_rondas_objetivo', { p_objetivo_id: objetivoId })
    .single()

  if (error) return { data: null, error: mensajeError(error, 'No se pudo verificar el permiso de rondas.') }
  return { data: data as AccesoRondasObjetivo, error: null }
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
    registrarErrorSupabase('obtenerRondaConPuntos', error)
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
  const puestoId = datos.puesto_id.trim()

  const { data, error } = await supabase
    .from('rondas_base')
    .insert({
      objetivo_id: datos.objetivo_id,
      puesto_id: puestoId,
      nombre: datos.nombre.trim(),
      descripcion: datos.descripcion?.trim() || null,
      intervalo_minutos: datos.intervalo_minutos,
      hora_inicio: datos.hora_inicio || null,
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

  const { data, error } = await supabase
    .rpc('agregar_ronda_punto', {
      p_ronda_base_id: rondaBaseId,
      p_nombre: datos.nombre.trim(),
      p_descripcion: datos.descripcion?.trim() || '',
      p_foto_requerida: datos.foto_requerida,
      p_gps_requerido: datos.gps_requerido,
      p_latitud: datos.latitud ?? null,
      p_longitud: datos.longitud ?? null,
      p_precision_metros: datos.precision_metros ?? null,
      p_radio_metros: datos.radio_metros ?? null,
      p_origen_posicion: datos.origen_posicion ?? null,
      p_activo: datos.activo ?? true,
    })
    .single()

  if (error) {
    registrarErrorSupabase('agregar_ronda_punto', error)
    return { data: null, error: mensajeError(error, 'No se pudo agregar el punto.') }
  }
  return { data: data as RondaPunto, error: null }
}

export async function actualizarPunto(
  puntoId: string,
  cambios: ActualizarRondaPunto,
): Promise<ResultadoRondas<RondaPunto>> {
  const cambiaLatitud = Object.prototype.hasOwnProperty.call(cambios, 'latitud')
  const cambiaLongitud = Object.prototype.hasOwnProperty.call(cambios, 'longitud')
  if (cambiaLatitud !== cambiaLongitud) {
    return { data: null, error: 'La latitud y la longitud deben actualizarse juntas.' }
  }
  if (
    cambiaLatitud &&
    ((cambios.latitud === null) !== (cambios.longitud === null))
  ) {
    return { data: null, error: 'La latitud y la longitud deben guardarse juntas.' }
  }
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
  if (
    cambios.origen_posicion !== undefined &&
    cambios.origen_posicion !== null &&
    cambios.origen_posicion !== 'gps' &&
    cambios.origen_posicion !== 'manual'
  ) {
    return { data: null, error: 'El origen de la posición no es válido.' }
  }
  if (
    cambios.origen_posicion === 'manual' &&
    cambios.precision_metros !== undefined &&
    cambios.precision_metros !== null
  ) {
    return { data: null, error: 'Una posición corregida manualmente no conserva la precisión GPS.' }
  }

  const payload: ActualizarRondaPunto = { ...cambios }
  if (payload.nombre !== undefined) payload.nombre = payload.nombre.trim()
  if (payload.descripcion !== undefined) payload.descripcion = payload.descripcion?.trim() || null
  if (cambiaLatitud && payload.latitud === null && payload.longitud === null) {
    payload.origen_posicion = null
    payload.precision_metros = null
  } else if (payload.origen_posicion === 'manual') {
    payload.precision_metros = null
  }

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
