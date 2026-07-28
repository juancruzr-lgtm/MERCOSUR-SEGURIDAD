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

// ── Lectura del vigilador (Etapa 2, parte 1) ──────────────────────────────────
// La ronda no se asigna manualmente: se resuelve desde el turno vigente en el
// servidor (RPC obtener_rondas_guardia_actual). El cliente no envía guardia_id,
// puesto_id, objetivo_id ni ronda_id; toda la identidad sale de auth.uid().

export type ContextoRondasGuardia =
  | 'ok'
  | 'sin_usuario'
  | 'sin_turno_vigente'
  | 'turno_sin_puesto'
  | 'puesto_sin_rondas'

export interface RondaGuardiaPunto {
  id: string
  orden: number
  nombre: string
  latitud: number | null
  longitud: number | null
  radio_metros: number | null
  origen_posicion: OrigenPosicion
  requiere_foto: boolean
  requiere_gps: boolean
}

export type EstadoEjecucionRonda = 'en_curso' | 'finalizada' | 'cancelada'
export type ResultadoEjecucionRonda = 'completa' | 'incompleta'
export type EstadoEjecucionPunto = 'pendiente' | 'cumplido' | 'incumplido' | 'omitido'

// Estado de un punto dentro de una ejecución. `ronda_punto_id` referencia la
// definición en ronda_puntos; el resto son valores del snapshot tomado al
// iniciar, no la configuración vigente: si el supervisor mueve o renombra un
// punto después, la ejecución conserva las reglas que regían en su momento.
export interface RondaEjecucionPuntoEstado {
  ronda_punto_id: string
  estado: EstadoEjecucionPunto
  completado_at: string | null
  // ── Añadidos en Etapa 3, fase 1 ──
  ejecucion_punto_id: string
  orden: number
  nombre: string
  requiere_foto: boolean
  requiere_gps: boolean
  latitud: number | null
  longitud: number | null
  radio_metros: number | null
}

// La fase 1 de la Etapa 3 define este contrato y lo expone mediante
// iniciarRonda() y obtenerEjecucionActual(). obtenerRondasGuardiaActual()
// continúa entregando ejecucion_actual: null hasta la Fase 5.
// El "estado" de ejecución (acá) es distinto de estado_temporal (reloj/config).
export interface RondaEjecucionActual {
  id: string
  estado: EstadoEjecucionRonda
  hora_inicio: string | null
  hora_fin: string | null
  porcentaje: number
  puntos_completados: number
  punto_actual_id: string | null
  puntos: RondaEjecucionPuntoEstado[]
  // ── Añadidos en Etapa 3, fase 1 ──
  puntos_total: number
  puede_continuar: boolean
  resultado: ResultadoEjecucionRonda | null
  ronda_base_id: string
  ronda_nombre: string
  fecha_operativa: string
  fuera_horario: boolean
}

export interface RondaGuardia {
  ronda_id: string
  ronda_nombre: string
  descripcion: string | null
  hora_inicio: string | null
  intervalo_minutos: number
  activa: boolean
  cantidad_puntos: number
  puntos: RondaGuardiaPunto[]
  // Placeholder de Etapa 3 (ejecución de rondas). Siempre `null` en Etapa 2.
  ejecucion_actual: RondaEjecucionActual | null
}

export interface RondasGuardiaActual {
  contexto: ContextoRondasGuardia
  turno_id: string | null
  objetivo_id: string | null
  objetivo_nombre: string | null
  puesto_id: string | null
  puesto_nombre: string | null
  rondas: RondaGuardia[]
}

export type EstadoTemporalRonda = 'disponible' | 'proxima' | 'fuera_horario' | 'sin_horario'

// Estado temporal de una ronda para orientar al vigilador. Función pura y
// testeable. LIMITACIÓN documentada: sin seguimiento de ejecuciones/repeticiones
// no se calcula cada ventana del día; con hora_inicio configurada la ronda es
// 'proxima' antes de esa hora y 'disponible' a partir de ella. 'fuera_horario'
// solo se produce si se provee el fin real de la cobertura (turnoFin); la RPC ya
// entrega rondas únicamente cuando el turno está vigente, por lo que en esta
// fase el panel no fuerza ese estado. 'sin_horario' cuando la ronda no tiene
// hora_inicio: se muestra igual, nunca se bloquea la visualización.
export function calcularEstadoTemporalRonda(
  horaInicio: string | null,
  ahora: Date = new Date(),
  turnoFin: Date | null = null,
): EstadoTemporalRonda {
  if (!horaInicio) return 'sin_horario'

  const [h, m] = horaInicio.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 'sin_horario'

  if (turnoFin && ahora.getTime() > turnoFin.getTime()) return 'fuera_horario'

  const inicioMinutos = h * 60 + m
  const ahoraMinutos = ahora.getHours() * 60 + ahora.getMinutes()
  return ahoraMinutos < inicioMinutos ? 'proxima' : 'disponible'
}

function normalizarRondasGuardia(bruto: Partial<RondasGuardiaActual> | null): RondasGuardiaActual {
  const rondas = Array.isArray(bruto?.rondas) ? (bruto!.rondas as RondaGuardia[]) : []
  return {
    contexto: (bruto?.contexto ?? 'sin_turno_vigente') as ContextoRondasGuardia,
    turno_id: bruto?.turno_id ?? null,
    objetivo_id: bruto?.objetivo_id ?? null,
    objetivo_nombre: bruto?.objetivo_nombre ?? null,
    puesto_id: bruto?.puesto_id ?? null,
    puesto_nombre: bruto?.puesto_nombre ?? null,
    rondas: rondas.map(ronda => ({
      ...ronda,
      puntos: Array.isArray(ronda.puntos)
        ? [...ronda.puntos].sort((a, b) => a.orden - b.orden)
        : [],
      // Etapa 2 y fases 1-4 de Etapa 3: null. La Fase 5 la poblará y pasa tal cual.
      ejecucion_actual: ronda.ejecucion_actual ?? null,
    })),
  }
}

export async function obtenerRondasGuardiaActual(): Promise<ResultadoRondas<RondasGuardiaActual>> {
  const { data, error } = await supabase.rpc('obtener_rondas_guardia_actual')

  if (error) {
    registrarErrorSupabase('obtener_rondas_guardia_actual', error)
    return {
      data: null,
      error: mensajeError(error, 'No se pudieron cargar las rondas del puesto.'),
    }
  }

  return { data: normalizarRondasGuardia(data as Partial<RondasGuardiaActual> | null), error: null }
}

// ── Ejecución de rondas (Etapa 3, fase 1) ─────────────────────────────────────
// Base transaccional: iniciar/recuperar una ejecución y consultar la actual.
// Todavía no hay registro de puntos, finalización, cancelación ni fotos.
//
// El cliente sólo envía `ronda_base_id`, y el servidor valida que pertenezca al
// puesto de su turno vigente. Guardia, turno, objetivo, puesto y fecha operativa
// se derivan de auth.uid(); nunca viajan desde acá.

export type ContextoIniciarRonda =
  | 'iniciada'            // se creó una ejecución nueva
  | 'recuperada'          // ya existía una en curso de este guardia y turno
  | 'sin_turno_vigente'
  | 'turno_sin_puesto'
  | 'ronda_no_disponible' // no existe, está inactiva o es de otro puesto
  | 'ronda_sin_puntos'

export type ContextoEjecucionActual =
  | 'ok'
  | 'sin_usuario'
  | 'sin_turno_vigente'
  | 'sin_ejecucion'

export interface RespuestaIniciarRonda {
  contexto: ContextoIniciarRonda
  ejecucion: RondaEjecucionActual | null
}

export interface RespuestaEjecucionActual {
  contexto: ContextoEjecucionActual
  ejecucion: RondaEjecucionActual | null
}

function normalizarEjecucion(bruto: any): RondaEjecucionActual | null {
  if (!bruto) return null
  const puntos: RondaEjecucionPuntoEstado[] = Array.isArray(bruto.puntos) ? bruto.puntos : []
  return {
    ...bruto,
    puntos: [...puntos].sort((a, b) => a.orden - b.orden),
  } as RondaEjecucionActual
}

/**
 * Inicia una ronda o devuelve la que ya está en curso.
 *
 * Idempotente: dos toques seguidos no crean dos ejecuciones. Distinguir
 * 'iniciada' de 'recuperada' sirve para el mensaje al usuario, no para el flujo.
 */
export async function iniciarRonda(
  rondaBaseId: string,
): Promise<ResultadoRondas<RespuestaIniciarRonda>> {
  const { data, error } = await supabase.rpc('iniciar_ronda', {
    p_ronda_base_id: rondaBaseId,
  })

  if (error) {
    registrarErrorSupabase('iniciar_ronda', error)
    return { data: null, error: mensajeError(error, 'No se pudo iniciar la ronda.') }
  }

  const bruto = data as any
  return {
    data: {
      contexto: (bruto?.contexto ?? 'sin_turno_vigente') as ContextoIniciarRonda,
      ejecucion: normalizarEjecucion(bruto?.ejecucion),
    },
    error: null,
  }
}

/**
 * Ejecución en curso del guardia autenticado, si existe.
 *
 * Es la fuente de verdad para recuperar el estado: la aplicación no guarda nada
 * en localStorage. Conviene llamarla al montar, al volver del segundo plano y al
 * recuperar conexión.
 *
 * Ante un reemplazo de guardia devuelve únicamente la ejecución propia: la del
 * guardia anterior sobre el mismo turno nunca se expone ni se continúa.
 */
export async function obtenerEjecucionActual(): Promise<ResultadoRondas<RespuestaEjecucionActual>> {
  const { data, error } = await supabase.rpc('obtener_ejecucion_actual')

  if (error) {
    registrarErrorSupabase('obtener_ejecucion_actual', error)
    return { data: null, error: mensajeError(error, 'No se pudo consultar la ronda en curso.') }
  }

  const bruto = data as any
  return {
    data: {
      contexto: (bruto?.contexto ?? 'sin_ejecucion') as ContextoEjecucionActual,
      ejecucion: normalizarEjecucion(bruto?.ejecucion),
    },
    error: null,
  }
}

/** Mensaje para el vigilador según por qué no se pudo iniciar. */
export function mensajeContextoIniciar(contexto: ContextoIniciarRonda): string | null {
  switch (contexto) {
    case 'iniciada':
    case 'recuperada':
      return null
    case 'sin_turno_vigente':
      return 'No tenés un turno vigente en este momento.'
    case 'turno_sin_puesto':
      return 'Tu turno vigente no tiene un puesto asignado.'
    case 'ronda_no_disponible':
      return 'Esa ronda no está disponible para tu puesto.'
    case 'ronda_sin_puntos':
      return 'La ronda no tiene puntos de control configurados.'
  }
}
