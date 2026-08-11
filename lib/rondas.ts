import { supabase } from '@/lib/supabase'

export const RONDA_INTERVALO_MINIMO = 15
export const RONDA_INTERVALO_MAXIMO = 10080

export type OrigenPosicion = 'gps' | 'manual' | null

/**
 * Exigencia de foto por punto. Reemplaza al booleano `foto_requerida`, que
 * sobrevive como columna derivada por compatibilidad.
 *
 *   obligatoria   sin foto no se registra el punto.
 *   opcional      se puede registrar sin foto; si la saca, se guarda igual.
 *   solo_novedad  se puede registrar sin foto, salvo que el vigilador declare
 *                 una novedad: ahí la foto pasa a ser obligatoria.
 */
export type PoliticaFoto = 'obligatoria' | 'opcional' | 'solo_novedad'

export const POLITICAS_FOTO: readonly PoliticaFoto[] =
  ['obligatoria', 'opcional', 'solo_novedad'] as const

export function etiquetaPoliticaFoto(politica: PoliticaFoto): string {
  switch (politica) {
    case 'obligatoria':  return 'Foto obligatoria'
    case 'opcional':     return 'Foto opcional'
    case 'solo_novedad': return 'Foto sólo si hay novedad'
  }
}

export function ayudaPoliticaFoto(politica: PoliticaFoto): string {
  switch (politica) {
    case 'obligatoria':  return 'El vigilador no puede avanzar sin sacar la foto.'
    case 'opcional':     return 'Puede avanzar sin foto. Si la saca, queda registrada igual.'
    case 'solo_novedad': return 'Puede avanzar sin foto, salvo que marque que hay una novedad.'
  }
}

/** Única regla de "la foto bloquea". El servidor aplica exactamente la misma. */
export function fotoEsObligatoria(politica: PoliticaFoto, hayNovedad: boolean): boolean {
  return politica === 'obligatoria' || (politica === 'solo_novedad' && hayNovedad)
}

// ── Control de evidencias por reincidencia GPS ────────────────────────────────
// Tras dos incumplimientos GPS consecutivos en el mismo punto, la siguiente
// visita nace con `foto_control_gps = true` en su snapshot: una única foto de
// control, y el ciclo vuelve a cero. El contador y la decisión viven por
// completo en el servidor (registrar_punto_ronda); el cliente solo muestra la
// exigencia que el snapshot ya trae. No es una política del punto ni la
// modifica: se suma como OR a la política manual configurada.

export const MENSAJE_FOTO_CONTROL_GPS =
  'Foto obligatoria de control por reiteración de registros fuera del radio.'

/**
 * Exigencia de foto de una visita: la política manual O la foto de control por
 * reincidencia GPS. Misma composición que aplica el servidor.
 */
export function fotoEsObligatoriaEnVisita(
  politica: PoliticaFoto,
  hayNovedad: boolean,
  fotoControlGps: boolean,
): boolean {
  return fotoEsObligatoria(politica, hayNovedad) || fotoControlGps
}

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
  /** Derivada de `politica_foto` por trigger. Leer, no escribir. */
  foto_requerida: boolean
  politica_foto: PoliticaFoto
  gps_requerido: boolean
  latitud: number | null
  longitud: number | null
  precision_metros: number | null
  radio_metros: number | null
  origen_posicion: OrigenPosicion
  posicion_capturada_at: string | null
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
  politica_foto: PoliticaFoto
  /** Compatibilidad: si se omite, el servidor lo deriva de `politica_foto`. */
  foto_requerida?: boolean
  gps_requerido: boolean
  latitud?: number | null
  longitud?: number | null
  precision_metros?: number | null
  radio_metros?: number | null
  origen_posicion?: OrigenPosicion
  /** Fecha/hora real de captura de la posición (ISO). null si no hay posición. */
  posicion_capturada_at?: string | null
  activo?: boolean
}

export type ActualizarRondaPunto = Partial<NuevoRondaPunto>

/** Distancia mínima permitida entre dos puntos activos de una misma ronda (m). */
export const RONDA_PUNTO_DISTANCIA_MINIMA = 3

/** Haversine en metros (misma fórmula que rondas_distancia_metros en el server). */
export function distanciaMetros(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const r = Math.PI / 180
  const dLat = (lat2 - lat1) * r
  const dLng = (lng2 - lng1) * r
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Devuelve el punto activo cuya posición está a < RONDA_PUNTO_DISTANCIA_MINIMA, o null. */
export function puntoDuplicadoCercano(
  latitud: number,
  longitud: number,
  puntos: RondaPunto[],
  exceptoId?: string,
): RondaPunto | null {
  for (const p of puntos) {
    if (!p.activo || p.id === exceptoId) continue
    if (p.latitud === null || p.longitud === null) continue
    if (distanciaMetros(latitud, longitud, p.latitud, p.longitud) < RONDA_PUNTO_DISTANCIA_MINIMA) {
      return p
    }
  }
  return null
}

export const MENSAJE_RONDA_PUNTO_DUPLICADO =
  'Esta ubicación coincide con otro punto de la ronda. Debés trasladarte hasta el nuevo punto y volver a obtener el GPS.'

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
  'id, ronda_base_id, nombre, descripcion, orden, foto_requerida, politica_foto, gps_requerido, latitud, longitud, precision_metros, radio_metros, origen_posicion, posicion_capturada_at, activo, created_at, updated_at'
const MENSAJE_CONFIGURACION_GPS_INCOMPLETA =
  'Si el GPS es obligatorio, marcá el punto en el mapa y definí un radio válido.'

function validarConfiguracionGpsObligatoria(
  datos: Partial<Pick<NuevoRondaPunto, 'gps_requerido' | 'latitud' | 'longitud' | 'radio_metros'>>,
): string | null {
  if (!datos.gps_requerido) return null

  const tieneValor = (valor: unknown): boolean =>
    valor !== null && valor !== undefined && valor !== ''
  const radioValido =
    typeof datos.radio_metros === 'number' &&
    Number.isFinite(datos.radio_metros) &&
    datos.radio_metros > 0

  return tieneValor(datos.latitud) && tieneValor(datos.longitud) && radioValido
    ? null
    : MENSAJE_CONFIGURACION_GPS_INCOMPLETA
}

function mensajeError(error: ErrorSupabase | null, fallback: string): string {
  if (!error?.message) return fallback
  if (/ronda_punto_duplicado/i.test(error.message)) {
    return MENSAJE_RONDA_PUNTO_DUPLICADO
  }
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
  if (/politica_foto_valida/i.test(error.message)) {
    return 'La política de foto debe ser obligatoria, opcional o sólo si hay novedad.'
  }
  if (/ronda_puntos_gps_config_completa/i.test(error.message)) {
    return MENSAJE_CONFIGURACION_GPS_INCOMPLETA
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

/**
 * Cierre estándar de una llamada fallida: detalle técnico a la consola y mensaje
 * legible al usuario. Las dos mitades tienen que ir siempre juntas —un log sin
 * mensaje deja al vigilador sin saber qué pasó, y un mensaje sin log deja al
 * diagnóstico sin nada— así que se resuelven en un solo lugar.
 */
function fallaRpc<T>(contexto: string, error: ErrorSupabase, fallback: string): ResultadoRondas<T> {
  registrarErrorSupabase(contexto, error)
  return { data: null, error: mensajeError(error, fallback) }
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

  const tieneValor = (valor: unknown): boolean =>
    valor !== null && valor !== undefined && valor !== ''
  const tieneLatitud = tieneValor(datos.latitud)
  const tieneLongitud = tieneValor(datos.longitud)
  const errorConfiguracionGps = validarConfiguracionGpsObligatoria(datos)
  if (errorConfiguracionGps) return errorConfiguracionGps
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
    return fallaRpc('obtenerRondaConPuntos', error, 'No se pudo cargar la ronda.')
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
      p_foto_requerida: datos.foto_requerida ?? (datos.politica_foto === 'obligatoria'),
      p_politica_foto: datos.politica_foto,
      p_gps_requerido: datos.gps_requerido,
      p_latitud: datos.latitud ?? null,
      p_longitud: datos.longitud ?? null,
      p_precision_metros: datos.precision_metros ?? null,
      p_radio_metros: datos.radio_metros ?? null,
      p_origen_posicion: datos.origen_posicion ?? null,
      p_activo: datos.activo ?? true,
      p_posicion_capturada_at: datos.posicion_capturada_at ?? null,
    })
    .single()

  if (error) {
    return fallaRpc('agregar_ronda_punto', error, 'No se pudo agregar el punto.')
  }
  return { data: data as RondaPunto, error: null }
}

export async function actualizarPunto(
  puntoId: string,
  cambios: ActualizarRondaPunto,
): Promise<ResultadoRondas<RondaPunto>> {
  if (cambios.gps_requerido === true) {
    const errorConfiguracionGps = validarConfiguracionGpsObligatoria(cambios)
    if (errorConfiguracionGps) return { data: null, error: errorConfiguracionGps }
  }

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

// ── Etapa 2 — Configuración de rondas: lectura por puesto ─────────────────────
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
  /** Derivado: `politica_foto === 'obligatoria'`. Se conserva por compatibilidad. */
  requiere_foto: boolean
  politica_foto: PoliticaFoto
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
  // ── Añadidos en Etapa 3.1 — Backend ──
  ejecucion_punto_id: string
  orden: number
  nombre: string
  /** Derivado: `politica_foto === 'obligatoria'`. Se conserva por compatibilidad. */
  requiere_foto: boolean
  // ── Añadidos por la política de foto ──
  politica_foto: PoliticaFoto
  hay_novedad: boolean
  /**
   * La visita nació con foto de control por reincidencia GPS (snapshot del
   * servidor). Independiente de `politica_foto`: distingue la foto automática
   * de la configurada manualmente.
   */
  foto_control_gps: boolean
  requiere_gps: boolean
  latitud: number | null
  longitud: number | null
  radio_metros: number | null
}

// La Etapa 3.1 — Backend define este contrato y lo expone mediante
// iniciarRonda() y obtenerEjecucionActual(). obtenerRondasGuardiaActual()
// continúa entregando ejecucion_actual: null hasta la Etapa 3.2 — App Vigilador.
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
  // ── Añadidos en Etapa 3.1 — Backend ──
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
  // Próxima ventana exigible del turno vigente. La calcula
  // rondas_ventanas_programadas en el servidor —la misma fuente que las
  // alertas—: acá no se deriva nada. `null` cuando al turno no le queda
  // ninguna ventana por delante.
  ventana_inicio?: string | null
  ventana_fin?: string | null
  vencimiento_at?: string | null
  /** 'HH:MM' en hora Argentina, ya formateado por la RPC. */
  ventana_inicio_hhmm?: string | null
  /** La ventana está abierta en este momento: se puede arrancar ya. */
  habilitada_ahora?: boolean
  // Placeholder para Etapa 3.2 — App Vigilador. Permanece `null` en Etapa 3.1.
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

/**
 * Completa `politica_foto` cuando el servidor todavía no la manda.
 *
 * La RPC la incluye desde 20260729200000. Mientras la migración no esté aplicada
 * —o si se revierte— se deriva del booleano `requiere_foto`, que reproduce
 * exactamente lo que se mostraba antes: obligatoria u opcional, sin distinguir
 * `solo_novedad`. Así el cliente nunca queda con la política en `undefined`.
 */
function normalizarPuntoGuardia(punto: RondaGuardiaPunto): RondaGuardiaPunto {
  if (punto.politica_foto) return punto
  return { ...punto, politica_foto: punto.requiere_foto ? 'obligatoria' : 'opcional' }
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
        ? [...ronda.puntos].sort((a, b) => a.orden - b.orden).map(normalizarPuntoGuardia)
        : [],
      // Etapa 3.1: null. La Etapa 3.2 la poblará y este cliente la propagará.
      ejecucion_actual: ronda.ejecucion_actual ?? null,
    })),
  }
}

export async function obtenerRondasGuardiaActual(): Promise<ResultadoRondas<RondasGuardiaActual>> {
  const { data, error } = await supabase.rpc('obtener_rondas_guardia_actual')

  if (error) {
    return fallaRpc('obtener_rondas_guardia_actual', error, 'No se pudieron cargar las rondas del puesto.')
  }

  return { data: normalizarRondasGuardia(data as Partial<RondasGuardiaActual> | null), error: null }
}

// ── Etapa 3.1 — Ejecución de rondas: Backend ──────────────────────────────────
// Base transaccional: iniciar/recuperar una ejecución y consultar la actual.
// Todavía no hay registro de puntos, finalización, cancelación ni fotos.
//
// El cliente sólo envía `ronda_base_id`, y el servidor valida que pertenezca al
// puesto de su turno vigente. Guardia, turno, objetivo, puesto y fecha operativa
// se derivan de auth.uid(); nunca viajan desde acá.

export type ContextoIniciarRonda =
  | 'iniciada'            // se creó una ejecución nueva
  | 'recuperada'          // ya existía una en curso de este guardia y turno
  | 'otra_ronda_en_curso' // existe otra ronda abierta; se devuelve sin mutarla
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

export type ContextoRegistrarPunto =
  | 'registrado'
  | 'ya_registrado'
  | 'sin_turno_vigente'
  | 'punto_no_disponible'
  | 'ejecucion_cerrada'
  | 'fuera_de_secuencia'
  | 'gps_invalido'
  | 'configuracion_gps_invalida'
  | 'foto_pendiente'

export interface GpsPuntoRonda {
  latitud: number
  longitud: number
  precision_metros: number | null
}

export interface VeredictoPuntoRonda {
  ejecucion_punto_id: string
  orden?: number
  estado: EstadoEjecucionPunto
  gps_ok?: boolean | null
  dentro_radio?: boolean | null
  foto_ok?: boolean | null
  hay_novedad?: boolean
  politica_foto?: PoliticaFoto
  /** La visita exigía foto de control por reincidencia GPS. */
  foto_control_gps?: boolean
  distancia_metros?: number | null
}

export interface RespuestaRegistrarPunto {
  contexto: ContextoRegistrarPunto
  punto: VeredictoPuntoRonda | null
  ejecucion: RondaEjecucionActual | null
}

export interface EvidenciaPuntoRonda {
  id: string
  proceso_id: string
  bucket: string
  storage_path: string
  created_at: string
}

function normalizarEjecucion(bruto: any): RondaEjecucionActual | null {
  if (!bruto) return null
  const puntos: RondaEjecucionPuntoEstado[] = Array.isArray(bruto.puntos) ? bruto.puntos : []
  return {
    ...bruto,
    puntos: [...puntos]
      .sort((a, b) => a.orden - b.orden)
      // Un servidor sin la migración de control GPS no manda la clave: se
      // normaliza a false, que reproduce el comportamiento previo.
      .map(p => ({ ...p, foto_control_gps: (p as any).foto_control_gps ?? false })),
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
    return fallaRpc('iniciar_ronda', error, 'No se pudo iniciar la ronda.')
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
    return fallaRpc('obtener_ejecucion_actual', error, 'No se pudo consultar la ronda en curso.')
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

/**
 * Sube la foto obligatoria del punto por la ruta autenticada de servidor.
 *
 * El servidor deriva guardia, turno, ejecución y objetivo desde la sesión y
 * valida que el punto sea pendiente y pertenezca a la ejecución vigente.
 */
export async function subirFotoPuntoRonda(
  ejecucionPuntoId: string,
  foto: File,
): Promise<ResultadoRondas<EvidenciaPuntoRonda>> {
  const { data: sesionData, error: sesionError } = await supabase.auth.getSession()
  const token = sesionData.session?.access_token

  if (sesionError || !token) {
    return { data: null, error: 'Tu sesión venció. Volvé a ingresar.' }
  }

  const form = new FormData()
  form.append('ejecucionPuntoId', ejecucionPuntoId)
  form.append('foto', foto, 'punto.jpg')

  try {
    const response = await fetch('/api/rondas/evidencia', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    const body = await response.json().catch(() => null)

    if (!response.ok) {
      return {
        data: null,
        error: body?.error || 'No se pudo subir la foto del punto.',
      }
    }

    return { data: body?.evidencia as EvidenciaPuntoRonda, error: null }
  } catch {
    return { data: null, error: 'No hay conexión para subir la foto.' }
  }
}

/**
 * Registra el punto actual. El servidor controla secuencia, GPS, evidencia,
 * veredicto y finalización; el cliente sólo aporta el ID del snapshot y el GPS.
 */
export async function registrarPuntoRonda(
  ejecucionPuntoId: string,
  gps: GpsPuntoRonda | null,
  hayNovedad = false,
): Promise<ResultadoRondas<RespuestaRegistrarPunto>> {
  const { data, error } = await supabase.rpc('registrar_punto_ronda', {
    p_ejecucion_punto_id: ejecucionPuntoId,
    p_latitud: gps?.latitud ?? null,
    p_longitud: gps?.longitud ?? null,
    p_precision_metros: gps?.precision_metros ?? null,
    p_hay_novedad: hayNovedad,
  })

  if (error) {
    return fallaRpc('registrar_punto_ronda', error, 'No se pudo registrar el punto.')
  }

  const bruto = data as any
  return {
    data: {
      contexto: (bruto?.contexto ?? 'punto_no_disponible') as ContextoRegistrarPunto,
      punto: bruto?.punto ?? null,
      ejecucion: normalizarEjecucion(bruto?.ejecucion),
    },
    error: null,
  }
}

export function mensajeContextoRegistrarPunto(contexto: ContextoRegistrarPunto): string | null {
  switch (contexto) {
    case 'registrado':
    case 'ya_registrado':
      return null
    case 'sin_turno_vigente':
      return 'Tu turno ya no está vigente.'
    case 'punto_no_disponible':
      return 'Ese punto no pertenece a tu ronda vigente.'
    case 'ejecucion_cerrada':
      return 'La ronda ya está cerrada.'
    case 'fuera_de_secuencia':
      return 'Tenés que completar primero el punto actual.'
    case 'gps_invalido':
      return 'La ubicación recibida no es válida.'
    case 'configuracion_gps_invalida':
      return 'Este punto tiene una configuración GPS inválida. Contactá al supervisor.'
    case 'foto_pendiente':
      return 'Este punto requiere una foto antes de continuar.'
  }
}

/** Mensaje para el vigilador según por qué no se pudo iniciar. */
export function mensajeContextoIniciar(contexto: ContextoIniciarRonda): string | null {
  switch (contexto) {
    case 'iniciada':
    case 'recuperada':
      return null
    case 'otra_ronda_en_curso':
      return 'Ya tenés otra ronda en curso. Finalizala antes de iniciar esta.'
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

// ── Cierre administrativo de una ronda bloqueada (C3 mínimo) ──────────────────
// Superficie de supervisión, no del vigilador. Una ejecución cuyo punto actual
// es inalcanzable queda `en_curso` para siempre y bloquea al guardia por el
// resto del turno; esto es la única salida que no requiere SQL manual.
//
// El cierre deja la ejecución en `finalizada` + `incompleta`, igual que una
// ronda que el vigilador terminó con incumplidos. Lo que las distingue es
// `cerrada_por`: todo reporte de cumplimiento debe filtrar por esa columna.

/** Mínimo de caracteres del motivo. Coincide con la constraint de base. */
export const MOTIVO_CIERRE_MIN = 10

export type ContextoCerrarRonda =
  | 'cerrada'                 // se cerró ahora
  | 'ya_cerrada'              // reintento: devuelve el cierre original sin tocarlo
  | 'sin_usuario'
  | 'sin_permiso'
  | 'ejecucion_no_encontrada'
  | 'ejecucion_no_bloqueada'  // la terminó el vigilador: no se reescribe
  | 'motivo_invalido'

export type ContextoEjecucionesEnCurso = 'ok' | 'sin_usuario' | 'sin_permiso'

export interface EjecucionEnCurso {
  id: string
  ronda_id: string
  ronda_nombre: string
  guardia_nombre: string
  puesto_nombre: string
  fecha_operativa: string
  iniciada_at: string
  puntos_total: number
  puntos_pendientes: number
  /** La ventana del turno ya terminó: la ejecución está abandonada, no en progreso. */
  turno_vencido: boolean
}

export interface RespuestaEjecucionesEnCurso {
  contexto: ContextoEjecucionesEnCurso
  ejecuciones: EjecucionEnCurso[]
}

export interface CierreRondaBloqueada {
  id: string
  estado?: EstadoEjecucionRonda
  resultado?: ResultadoEjecucionRonda | null
  puntos_omitidos?: number
  puntos_conservados?: number
  cerrada_at?: string | null
  cerrada_motivo?: string | null
}

export interface RespuestaCerrarRonda {
  contexto: ContextoCerrarRonda
  ejecucion: CierreRondaBloqueada | null
}

/** Valida el motivo antes de salir a la red. Misma regla que la constraint. */
export function validarMotivoCierre(motivo: string): string | null {
  if (motivo.trim().length < MOTIVO_CIERRE_MIN) {
    return `El motivo es obligatorio y debe tener al menos ${MOTIVO_CIERRE_MIN} caracteres.`
  }
  return null
}

/** Ejecuciones en curso de un objetivo. Sólo admin y supervisor de la zona. */
export async function listarEjecucionesEnCursoObjetivo(
  objetivoId: string,
): Promise<ResultadoRondas<RespuestaEjecucionesEnCurso>> {
  const { data, error } = await supabase.rpc('listar_ejecuciones_en_curso_objetivo', {
    p_objetivo_id: objetivoId,
  })

  if (error) {
    return fallaRpc('listar_ejecuciones_en_curso_objetivo', error, 'No se pudieron cargar las rondas en curso.')
  }

  const bruto = data as any
  return {
    data: {
      contexto: (bruto?.contexto ?? 'sin_permiso') as ContextoEjecucionesEnCurso,
      ejecuciones: Array.isArray(bruto?.ejecuciones) ? bruto.ejecuciones : [],
    },
    error: null,
  }
}

/**
 * Cierra una ronda bloqueada dejando constancia de quién, cuándo y por qué.
 *
 * Idempotente: un reintento devuelve `ya_cerrada` con el cierre original, sin
 * pisar autor, hora ni motivo. Los puntos ya registrados —foto, GPS, veredicto
 * y snapshot— se conservan intactos; sólo los pendientes pasan a `omitido`.
 */
export async function cerrarRondaBloqueada(
  ejecucionId: string,
  motivo: string,
): Promise<ResultadoRondas<RespuestaCerrarRonda>> {
  const errorMotivo = validarMotivoCierre(motivo)
  if (errorMotivo) return { data: null, error: errorMotivo }

  const { data, error } = await supabase.rpc('cerrar_ronda_bloqueada', {
    p_ejecucion_id: ejecucionId,
    p_motivo: motivo.trim(),
  })

  if (error) {
    return fallaRpc('cerrar_ronda_bloqueada', error, 'No se pudo cerrar la ronda.')
  }

  const bruto = data as any
  return {
    data: {
      contexto: (bruto?.contexto ?? 'sin_permiso') as ContextoCerrarRonda,
      ejecucion: (bruto?.ejecucion ?? null) as CierreRondaBloqueada | null,
    },
    error: null,
  }
}

/** Mensaje para el supervisor. `null` cuando el cierre quedó firme. */
export function mensajeContextoCerrarRonda(contexto: ContextoCerrarRonda): string | null {
  switch (contexto) {
    case 'cerrada':
    case 'ya_cerrada':
      return null
    case 'sin_usuario':
      return 'No se pudo identificar tu usuario operativo.'
    case 'sin_permiso':
      return 'No tenés permiso para cerrar rondas de este objetivo.'
    case 'ejecucion_no_encontrada':
      return 'Esa ronda ya no existe.'
    case 'ejecucion_no_bloqueada':
      return 'Esa ronda no está en curso: la terminó el vigilador y su resultado no se modifica.'
    case 'motivo_invalido':
      return `El motivo es obligatorio y debe tener al menos ${MOTIVO_CIERRE_MIN} caracteres.`
  }
}

// ── Etapa 3.3 · B3: capa cliente de supervisión de rondas ─────────────────────
// Consume las RPC autorizadas de detalle (B1) e historial (B0′) y el endpoint de
// firma de evidencia (B2). Toda la autorización vive en el servidor; estas
// funciones solo tipan y normalizan la respuesta. No aceptan ni envían
// storage_path, ni guardia/puesto/objetivo de alcance fabricados por el cliente.

export type EstadoPuntoEjecucion = 'pendiente' | 'cumplido' | 'incumplido' | 'omitido'

// ── B1: detalle de una ejecución para supervisión ─────────────────────────────

export type ContextoDetalleEjecucion = 'ok' | 'sin_usuario' | 'no_encontrada' | 'sin_permiso'

export interface EvidenciaRefRonda {
  id: string
  tipo_evidencia: string
  bucket: string
  storage_path: string
  created_at: string
}

export interface PuntoEjecucionDetalle {
  ejecucion_punto_id: string
  ronda_punto_id: string
  orden: number
  nombre: string
  estado: EstadoPuntoEjecucion
  registrado_at: string | null
  comentario: string | null
  hay_novedad: boolean
  requiere_foto: boolean
  politica_foto: PoliticaFoto
  /** La visita nació con foto de control por reincidencia GPS. */
  foto_control_gps: boolean
  requiere_gps: boolean
  // Posición configurada al iniciar la ronda (snapshot inmutable).
  config_latitud: number | null
  config_longitud: number | null
  config_radio_metros: number | null
  // GPS real registrado por el vigilador.
  latitud: number | null
  longitud: number | null
  precision_metros: number | null
  distancia_metros: number | null
  gps_ok: boolean | null
  dentro_radio: boolean | null
  foto_ok: boolean | null
  // Referencias de evidencia (para firmar con firmarEvidenciaRonda). Sin URL.
  evidencias: EvidenciaRefRonda[]
}

export interface EjecucionDetalleSupervisor {
  id: string
  estado: EstadoEjecucionRonda
  resultado: ResultadoEjecucionRonda | null
  iniciada_at: string
  finalizada_at: string | null
  fecha_operativa: string
  iniciada_fuera_horario: boolean
  puntos_total: number
  puntos_completados: number
  porcentaje: number
  ronda_base_id: string
  ronda_nombre: string
  snap_intervalo_minutos: number
  snap_hora_inicio: string | null
  objetivo_id: string
  objetivo_nombre: string
  puesto_id: string
  puesto_nombre: string
  guardia_id: string
  guardia_nombre: string
  // Cierre administrativo: cerrada_por != null lo distingue de una ronda que el
  // vigilador terminó con incumplidos (mismo estado/resultado).
  cerrada_por: string | null
  cerrada_por_nombre: string | null
  cerrada_at: string | null
  cerrada_motivo: string | null
  es_cierre_administrativo: boolean
}

export interface DetalleEjecucionSupervisor {
  contexto: ContextoDetalleEjecucion
  ejecucion: EjecucionDetalleSupervisor | null
  puntos: PuntoEjecucionDetalle[]
}

/** Detalle completo de UNA ejecución. Solo admin/supervisor de la zona. */
export async function obtenerDetalleEjecucionSupervisor(
  ejecucionId: string,
): Promise<ResultadoRondas<DetalleEjecucionSupervisor>> {
  const { data, error } = await supabase.rpc('rondas_ejecucion_detalle_supervisor', {
    p_ejecucion_id: ejecucionId,
  })

  if (error) {
    return fallaRpc('rondas_ejecucion_detalle_supervisor', error, 'No se pudo cargar el detalle de la ronda.')
  }

  const bruto = (data ?? {}) as Partial<DetalleEjecucionSupervisor>
  return {
    data: {
      contexto: (bruto.contexto ?? 'no_encontrada') as ContextoDetalleEjecucion,
      ejecucion: (bruto.ejecucion ?? null) as EjecucionDetalleSupervisor | null,
      puntos: Array.isArray(bruto.puntos) ? (bruto.puntos as PuntoEjecucionDetalle[]) : [],
    },
    error: null,
  }
}

/** Mensaje para el supervisor según el contexto del detalle. */
export function mensajeContextoDetalleEjecucion(contexto: ContextoDetalleEjecucion): string | null {
  switch (contexto) {
    case 'ok':            return null
    case 'sin_usuario':   return 'No se pudo identificar tu usuario operativo.'
    case 'no_encontrada': return 'Esa ejecución ya no existe.'
    case 'sin_permiso':   return 'No tenés permiso para ver esta ronda.'
  }
}

// ── B0′: historial de ejecuciones finalizadas de un objetivo ──────────────────

export type ContextoEjecucionesObjetivo = 'ok' | 'sin_usuario' | 'rango_invalido' | 'sin_permiso'

export interface EjecucionHistorialItem {
  ejecucion_id: string
  ronda_id: string
  ronda_nombre: string
  puesto_id: string
  puesto_nombre: string
  guardia_id: string
  guardia_nombre: string
  estado: EstadoEjecucionRonda
  resultado: ResultadoEjecucionRonda | null
  iniciada_at: string
  finalizada_at: string | null
  puntos_total: number
  puntos_cumplidos: number
  puntos_incumplidos: number
  puntos_omitidos: number
  cerrada_por: string | null
  cerrada_at: string | null
  cerrada_motivo: string | null
  es_cierre_administrativo: boolean
}

export interface RespuestaEjecucionesObjetivo {
  contexto: ContextoEjecucionesObjetivo
  ejecuciones: EjecucionHistorialItem[]
}

/** Historial de ejecuciones FINALIZADas de un objetivo, en un rango de fechas. */
export async function listarEjecucionesObjetivo(
  objetivoId: string,
  desde: string,
  hasta: string,
): Promise<ResultadoRondas<RespuestaEjecucionesObjetivo>> {
  const { data, error } = await supabase.rpc('listar_ejecuciones_objetivo', {
    p_objetivo_id: objetivoId,
    p_desde: desde,
    p_hasta: hasta,
  })

  if (error) {
    return fallaRpc('listar_ejecuciones_objetivo', error, 'No se pudo cargar el historial de rondas.')
  }

  const bruto = (data ?? {}) as Partial<RespuestaEjecucionesObjetivo>
  return {
    data: {
      contexto: (bruto.contexto ?? 'sin_permiso') as ContextoEjecucionesObjetivo,
      ejecuciones: Array.isArray(bruto.ejecuciones)
        ? (bruto.ejecuciones as EjecucionHistorialItem[])
        : [],
    },
    error: null,
  }
}

/** Mensaje para el supervisor según el contexto del historial. */
export function mensajeContextoEjecucionesObjetivo(contexto: ContextoEjecucionesObjetivo): string | null {
  switch (contexto) {
    case 'ok':             return null
    case 'sin_usuario':    return 'No se pudo identificar tu usuario operativo.'
    case 'rango_invalido': return 'El rango de fechas no es válido.'
    case 'sin_permiso':    return 'No tenés permiso para ver el historial de este objetivo.'
  }
}

// ── Historial por ronda PROGRAMADA ────────────────────────────────────────────
// Responde "qué había que hacer y qué pasó con cada una", no "qué se ejecutó".
// Una ronda que nadie inició no tiene fila en `ronda_ejecuciones`: acá igual
// aparece, porque las filas salen de la programación.
//
// Independencia de las alertas: `estado`, `inicio_tardio` y
// `es_cierre_administrativo` se derivan de programación + ejecución. Los campos
// `alerta_*` son un anexo informativo —la suspensión declarada por el vigilador
// y las intervenciones del supervisor hoy solo se persisten ahí— y no
// condicionan qué filas existen ni en qué estado están.

export type EstadoRondaProgramada =
  | 'pendiente'    // sin ejecución, todavía en plazo
  | 'no_iniciada'  // sin ejecución y vencida
  | 'en_curso'
  | 'completada'
  | 'incompleta'
  | 'pausada'      // sin ejecución, ventana cubierta por pausa de supervisor

export const ESTADOS_RONDA_PROGRAMADA: readonly EstadoRondaProgramada[] =
  ['pendiente', 'no_iniciada', 'en_curso', 'completada', 'incompleta', 'pausada'] as const

export function etiquetaEstadoRondaProgramada(estado: EstadoRondaProgramada): string {
  switch (estado) {
    case 'pendiente':   return 'Pendiente'
    case 'no_iniciada': return 'No iniciada'
    case 'en_curso':    return 'En curso'
    case 'completada':  return 'Completada'
    case 'incompleta':  return 'Incompleta'
    case 'pausada':     return 'Pausada'
  }
}

// ═══ Modelo visual unificado de una ronda programada ═════════════════════════
//
// ÚNICA fuente de estado, etiqueta, color, ícono, orden y observaciones para
// todas las pantallas (Dashboard, pantalla global, historial, legajo, detalle).
// Ningún componente deriva nada por su cuenta: consumir estas funciones o nada.
//
// Dos ejes ORTOGONALES, nunca fundidos en una sola etiqueta:
//
//   Estado TÉCNICO   qué pasó con la obligación. Sale del motor (programación
//                    + ejecución + contadores por punto). La intervención de un
//                    supervisor jamás lo modifica.
//   Estado de ALERTA solo aplica a rondas no iniciadas —la única situación que
//                    genera alerta operativa—: pendiente (nadie la miró) o
//                    intervenida (un supervisor ya actuó).
//
// El estado técnico refina `EstadoRondaProgramada` (el crudo de la RPC) con los
// contadores que la misma fila ya trae, sin datos nuevos:
//
//   'pendiente' del motor  → proxima   si la ventana todavía no abrió
//                          → pendiente si está abierta y sin ejecución
//   'incompleta' del motor → incompleta          si hay puntos sin recorrer
//                            (omitidos o cierre administrativo): ronda
//                            abandonada a mitad de camino
//                          → cumplida_observada  si se recorrió todo pero con
//                            incumplimientos GPS: la ronda SE HIZO
//   'completada'           → cumplida_observada  si arrancó tarde
//                          → cumplida            si está limpia
//
// La foto de control por reincidencia GPS NO aparece acá a propósito: es una
// exigencia de una visita puntual, no un estado de la ronda. La ronda se
// clasifica por su resultado técnico final.

export type EstadoTecnicoRonda =
  | 'proxima'
  | 'pendiente'
  | 'en_curso'
  | 'cumplida'
  | 'cumplida_observada'
  | 'incompleta'
  | 'no_iniciada'
  | 'pausada'

export type EstadoAlertaVisual = 'sin_alerta' | 'pendiente' | 'intervenida'

export const ETIQUETA_ESTADO_TECNICO: Record<EstadoTecnicoRonda, string> = {
  proxima:            'Próxima',
  pendiente:          'Pendiente',
  en_curso:           'En curso',
  cumplida:           'Cumplida',
  cumplida_observada: 'Cumplida con observaciones',
  incompleta:         'Incompleta',
  no_iniciada:        'No iniciada',
  pausada:            'Pausada',
}

/** Versión corta para superficies compactas (tarjeta de 200 px, chips). */
export const ETIQUETA_CORTA_ESTADO_TECNICO: Record<EstadoTecnicoRonda, string> = {
  proxima:            'Próxima',
  pendiente:          'Pendiente',
  en_curso:           'En curso',
  cumplida:           'Cumplida',
  cumplida_observada: 'Cumplida c/obs.',
  incompleta:         'Incompleta',
  no_iniciada:        'No iniciada',
  pausada:            'Pausada',
}

export const ETIQUETA_ESTADO_ALERTA: Record<EstadoAlertaVisual, string> = {
  sin_alerta:  'Sin alerta',
  pendiente:   'Pendiente',
  intervenida: 'Intervenida',
}

// Paleta única. El rojo queda reservado a la alerta pendiente por ronda no
// iniciada: es lo único que exige atención inmediata. Incompleta va en naranja
// para que una ronda iniciada y abandonada no se confunda con una que nadie
// arrancó.
export const COLOR_ESTADO_TECNICO: Record<EstadoTecnicoRonda, string> = {
  proxima:            '#94a3b8',  // gris
  pendiente:          '#94a3b8',  // gris (etiqueta propia, mismo tono)
  en_curso:           '#3b82f6',  // azul
  cumplida:           '#22c55e',  // verde
  cumplida_observada: '#86efac',  // verde claro
  incompleta:         '#f97316',  // naranja
  no_iniciada:        '#ef4444',  // rojo — solo mientras la alerta esté sin intervenir
  pausada:            '#f59e0b',  // ámbar
}

/** Verde lima: alerta intervenida. Distinto del verde y del verde claro. */
export const COLOR_ALERTA_INTERVENIDA = '#a3e635'

export const ICONO_ESTADO_TECNICO: Record<EstadoTecnicoRonda, string> = {
  proxima:            '🕒',
  pendiente:          '⏳',
  en_curso:           '▶',
  cumplida:           '✅',
  cumplida_observada: '✅',
  incompleta:         '⚠️',
  no_iniciada:        '❌',
  pausada:            '⏸',
}

function msRonda(iso: string): number {
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * Estado técnico de la ronda. La separación próxima/pendiente compara contra
 * `ventana_inicio`, que es un instante absoluto (timestamptz): el huso del
 * navegador no puede correr el corte. El resto sale del estado del motor —que
 * ya comparó `now()` contra el vencimiento en el servidor— y de los contadores.
 */
export function estadoTecnicoRonda(r: RondaProgramada, ahora: number = Date.now()): EstadoTecnicoRonda {
  if (r.pausada && !r.ejecucion_id) return 'pausada'
  if (r.estado === 'pendiente') {
    return ahora < msRonda(r.ventana_inicio) ? 'proxima' : 'pendiente'
  }
  if (r.estado === 'en_curso')    return 'en_curso'
  if (r.estado === 'no_iniciada') return 'no_iniciada'

  // Ejecución finalizada. Puntos sin recorrer o cierre forzado: abandono.
  if (r.puntos_omitidos > 0 || r.es_cierre_administrativo) return 'incompleta'

  // Se recorrió todo. Lo que queda son observaciones, no abandono.
  if (r.puntos_incumplidos > 0 || r.inicio_tardio) return 'cumplida_observada'
  if (r.estado === 'completada') return 'cumplida'

  // `incompleta` sin omitidos ni incumplidos no debería existir (el motor solo
  // finaliza con cero pendientes). Si aparece, la ronda igual se ejecutó: se
  // marca observada en vez de acusar un abandono que los contadores no avalan.
  return 'cumplida_observada'
}

/**
 * Estado de la alerta operativa. Solo las rondas no iniciadas tienen alerta:
 * cualquier otra situación devuelve 'sin_alerta', incluso si la fila trae un
 * anexo de alerta de criterios históricos.
 *
 * 'intervenida' cubre tanto la alerta resuelta como la que tiene intervenciones
 * abiertas (una llamada al vigilador, por ejemplo): en ambos casos un
 * supervisor ya actuó y el rojo deja de corresponder.
 */
export function estadoAlertaRonda(r: RondaProgramada): EstadoAlertaVisual {
  if (estadoTecnicoRonda(r) !== 'no_iniciada') return 'sin_alerta'
  return (r.alerta_estado === 'resuelta' || r.alerta_intervenciones > 0)
    ? 'intervenida'
    : 'pendiente'
}

/** Color final de la ronda: la intervención tiñe de lima; el resto, su estado. */
export function colorRondaProgramada(r: RondaProgramada): string {
  return estadoAlertaRonda(r) === 'intervenida'
    ? COLOR_ALERTA_INTERVENIDA
    : COLOR_ESTADO_TECNICO[estadoTecnicoRonda(r)]
}

/**
 * Orden operativo entre rondas (menor = más arriba). Único criterio para toda
 * pantalla que liste o priorice rondas.
 */
export function ordenOperativoRonda(r: RondaProgramada): number {
  const tecnico = estadoTecnicoRonda(r)
  if (tecnico === 'no_iniciada') {
    return estadoAlertaRonda(r) === 'pendiente' ? 1 : 3
  }
  switch (tecnico) {
    case 'en_curso':           return 2
    case 'incompleta':         return 4
    case 'cumplida_observada': return 5
    case 'pendiente':          return 6
    case 'proxima':            return 7
    case 'cumplida':           return 8
    case 'pausada':            return 9
  }
}

/** Grupos cuyo empate se resuelve por lo más inminente (aún no ocurrieron). */
export function ordenRondaEsHaciaAdelante(orden: number): boolean {
  return orden === 6 || orden === 7
}

/**
 * Observaciones técnicas de una ronda finalizada, para mostrar como resumen
 * breve. Derivan solo de los contadores que la fila ya trae; lo que el motor no
 * expone (foto faltante, precisión GPS) no se inventa acá.
 *
 * Nota sobre "fuera del radio": `puntos_incumplidos` agrupa fuera-de-radio y
 * GPS obligatorio sin lectura — el motor no los separa a nivel contador. El
 * caso dominante es el desvío de radio y así se rotula; el detalle por punto
 * muestra la distinción exacta.
 */
export function observacionesRonda(r: RondaProgramada): string[] {
  const obs: string[] = []
  if (r.puntos_incumplidos > 0) {
    obs.push(`${r.puntos_incumplidos} punto(s) fuera del radio`)
  }
  if (r.puntos_omitidos > 0) {
    obs.push(`${r.puntos_omitidos} punto(s) sin recorrer`)
  }
  if (r.inicio_tardio) obs.push('Inicio tardío')
  if (r.es_cierre_administrativo) obs.push('Cierre administrativo')
  return obs
}

/** Resumen de observaciones en una línea, o null si no hay. */
export function resumenObservacionesRonda(r: RondaProgramada): string | null {
  const obs = observacionesRonda(r)
  return obs.length > 0 ? obs.join(' · ') : null
}

/**
 * Una ronda programada cuenta como incumplida (filtro del historial y conteos).
 *
 * Delega en el estado técnico: no iniciada o abandonada. Una ronda recorrida
 * con observaciones GPS ya no cuenta como incumplida — antes sí, y por eso un
 * desvío de radio se pintaba igual que una ronda que nadie hizo.
 */
export function rondaProgramadaEsIncumplida(r: RondaProgramada): boolean {
  const tecnico = estadoTecnicoRonda(r)
  return tecnico === 'no_iniciada' || tecnico === 'incompleta'
}

/**
 * Estado técnico desde el contrato del DETALLE de ejecución (que no trae la
 * ventana programada ni la alerta: solo la ejecución y sus puntos). Mismas
 * reglas que `estadoTecnicoRonda`, con una limitación documentada: el inicio
 * tardío respecto de la ventana no es derivable acá, así que una completada
 * tardía se muestra 'cumplida' en esta vista.
 */
export function estadoTecnicoDetalleEjecucion(
  estado: EstadoEjecucionRonda,
  esCierreAdministrativo: boolean,
  puntos: { estado: EstadoPuntoEjecucion }[],
): EstadoTecnicoRonda {
  if (estado === 'en_curso') return 'en_curso'
  const omitidos = puntos.filter(p => p.estado === 'omitido').length
  const incumplidos = puntos.filter(p => p.estado === 'incumplido').length
  if (omitidos > 0 || esCierreAdministrativo) return 'incompleta'
  if (incumplidos > 0) return 'cumplida_observada'
  return 'cumplida'
}

/** Observaciones del detalle de ejecución, mismas frases que el resto. */
export function observacionesDetalleEjecucion(
  esCierreAdministrativo: boolean,
  puntos: { estado: EstadoPuntoEjecucion }[],
): string[] {
  const obs: string[] = []
  const incumplidos = puntos.filter(p => p.estado === 'incumplido').length
  const omitidos = puntos.filter(p => p.estado === 'omitido').length
  if (incumplidos > 0) obs.push(`${incumplidos} punto(s) fuera del radio`)
  if (omitidos > 0) obs.push(`${omitidos} punto(s) sin recorrer`)
  if (esCierreAdministrativo) obs.push('Cierre administrativo')
  return obs
}

export interface RondaProgramada {
  // Identidad de la obligación: existe haya o no ejecución.
  ronda_base_id: string
  ronda_nombre: string
  puesto_id: string
  puesto_nombre: string
  turno_id: string
  guardia_id: string
  guardia_nombre: string
  ventana_inicio: string
  ventana_fin: string
  vencimiento_at: string

  estado: EstadoRondaProgramada
  /** Se ejecutó, pero arrancó después del vencimiento de su ventana. */
  inicio_tardio: boolean

  ejecucion_id: string | null
  iniciada_at: string | null
  finalizada_at: string | null
  resultado: ResultadoEjecucionRonda | null
  puntos_total: number | null
  puntos_cumplidos: number
  puntos_incumplidos: number
  puntos_omitidos: number
  cerrada_por: string | null
  cerrada_at: string | null
  cerrada_motivo: string | null
  es_cierre_administrativo: boolean

  // Anexo de pausa. NO condiciona el estado técnico cuando hay ejecución.
  pausada: boolean
  pausa_id: string | null
  pausa_motivo: string | null
  pausa_desde: string | null
  pausa_hasta: string | null
  pausada_por_nombre: string | null

  // Anexo informativo. Nunca deriva el estado de arriba.
  alerta_id: string | null
  alerta_tipo: TipoRondaAlerta | null
  alerta_estado: EstadoRondaAlerta | null
  alerta_suspendida: boolean | null
  alerta_motivo_vigilador: string | null
  alerta_accion: AccionRondaAlerta | null
  alerta_comentario: string | null
  alerta_resuelta_por_nombre: string | null
  alerta_resuelta_at: string | null
  alerta_intervenciones: number
}

export interface RespuestaRondasProgramadas {
  contexto: ContextoEjecucionesObjetivo
  rondas: RondaProgramada[]
}

/** Historial completo: una fila por ronda programada del objetivo en el rango. */
export async function listarRondasProgramadasObjetivo(
  objetivoId: string,
  desde: string,
  hasta: string,
): Promise<ResultadoRondas<RespuestaRondasProgramadas>> {
  const { data, error } = await supabase.rpc('listar_rondas_programadas_objetivo', {
    p_objetivo_id: objetivoId,
    p_desde: desde,
    p_hasta: hasta,
  })

  if (error) {
    return fallaRpc('listar_rondas_programadas_objetivo', error, 'No se pudo cargar el historial de rondas.')
  }

  const bruto = (data ?? {}) as Partial<RespuestaRondasProgramadas>
  return {
    data: {
      contexto: (bruto.contexto ?? 'sin_permiso') as ContextoEjecucionesObjetivo,
      rondas: Array.isArray(bruto.rondas) ? (bruto.rondas as RondaProgramada[]) : [],
    },
    error: null,
  }
}

// ── Pausa de rondas ─────────────────────────────────────────────────────────────

export type ContextoPausa =
  | 'ok'
  | 'sin_usuario'
  | 'sin_permiso'
  | 'ronda_no_encontrada'
  | 'ya_pausada'
  | 'motivo_invalido'
  | 'hasta_invalido'
  | 'pausa_no_encontrada'
  | 'ya_reactivada'

// Mensaje para el usuario. 'ok' devuelve null: no hay nada que mostrar.
export function mensajeContextoPausa(contexto: ContextoPausa | undefined): string | null {
  switch (contexto) {
    case 'ok':                  return null
    case 'sin_usuario':         return 'Tu sesión venció. Volvé a ingresar.'
    case 'sin_permiso':         return 'No tenés permiso para pausar rondas de este objetivo.'
    case 'ronda_no_encontrada': return 'No se encontró la ronda o está desactivada.'
    case 'ya_pausada':          return 'Esta ronda ya tiene una pausa activa.'
    case 'motivo_invalido':     return 'El motivo debe tener al menos 5 caracteres.'
    case 'hasta_invalido':      return 'La fecha de reactivación tiene que ser posterior a ahora.'
    case 'pausa_no_encontrada': return 'No se encontró la pausa indicada.'
    case 'ya_reactivada':       return 'Esa pausa ya fue reanudada.'
    default:                    return 'No se pudo completar la operación de pausa.'
  }
}

export interface RondaPausa {
  id: string
  ronda_base_id: string
  ronda_nombre: string
  objetivo_id: string
  objetivo_nombre: string
  puesto_id: string
  puesto_nombre: string
  pausada_por: string
  pausada_por_nombre: string
  pausada_at: string
  motivo: string
  hasta_at: string | null
  activa: boolean
  vigente: boolean
  reactivada_por: string | null
  reactivada_por_nombre: string | null
  reactivada_at: string | null
  reactivada_comentario: string | null
  reactivacion_automatica: boolean
}

export async function pausarRonda(
  rondaBaseId: string,
  motivo: string,
  hastaAt?: string | null,
): Promise<ResultadoRondas<{ contexto: ContextoPausa; pausa?: unknown; alertas_pendientes_anteriores?: number }>> {
  const params: Record<string, unknown> = {
    p_ronda_base_id: rondaBaseId,
    p_motivo: motivo,
  }
  if (hastaAt) params.p_hasta_at = hastaAt

  const { data, error } = await supabase.rpc('pausar_ronda', params)
  if (error) return fallaRpc('pausar_ronda', error, 'No se pudo pausar la ronda.')
  const bruto = (data ?? {}) as { contexto: ContextoPausa; pausa?: unknown; alertas_pendientes_anteriores?: number }
  return { data: bruto, error: null }
}

export async function reanudarRonda(
  pausaId: string,
  comentario?: string | null,
): Promise<ResultadoRondas<{ contexto: ContextoPausa; pausa?: unknown }>> {
  const params: Record<string, unknown> = { p_pausa_id: pausaId }
  if (comentario) params.p_reactivada_comentario = comentario

  const { data, error } = await supabase.rpc('reanudar_ronda', params)
  if (error) return fallaRpc('reanudar_ronda', error, 'No se pudo reanudar la ronda.')
  const bruto = (data ?? {}) as { contexto: ContextoPausa; pausa?: unknown }
  return { data: bruto, error: null }
}

export async function listarRondasPausadas(
  objetivoId?: string | null,
  soloActivas: boolean = true,
): Promise<ResultadoRondas<{ contexto: ContextoPausa; pausas: RondaPausa[] }>> {
  const params: Record<string, unknown> = { p_solo_activas: soloActivas }
  if (objetivoId) params.p_objetivo_id = objetivoId

  const { data, error } = await supabase.rpc('listar_rondas_pausadas', params)
  if (error) return fallaRpc('listar_rondas_pausadas', error, 'No se pudo cargar las pausas.')
  const bruto = (data ?? {}) as { contexto?: ContextoPausa; pausas?: RondaPausa[] }
  return {
    data: {
      contexto: (bruto.contexto ?? 'sin_permiso') as ContextoPausa,
      pausas: Array.isArray(bruto.pausas) ? bruto.pausas : [],
    },
    error: null,
  }
}

// ── B2: URL firmada efímera para ver una foto de punto ────────────────────────

export type ContextoFirmaEvidencia =
  | 'ok'
  | 'sin_usuario'
  | 'parametro_invalido'
  | 'evidencia_no_encontrada'
  | 'sin_permiso'
  | 'error_firma'

export interface FirmaEvidenciaRonda {
  contexto: ContextoFirmaEvidencia
  /** URL firmada efímera. No persistir: caduca en `expira_en_s`. */
  url: string | null
  expira_en_s: number | null
}

interface RespuestaFirmaEndpoint {
  contexto?: string
  url?: string
  expira_en_s?: number
}

/** Fallback de contexto si el cuerpo no trae uno (según status HTTP). */
function contextoDesdeStatus(status: number): ContextoFirmaEvidencia {
  switch (status) {
    case 401: return 'sin_usuario'
    case 400: return 'parametro_invalido'
    case 404: return 'evidencia_no_encontrada'
    case 403: return 'sin_permiso'
    default:  return 'error_firma'   // incluye 502 y cualquier otro
  }
}

/**
 * Pide al servidor una URL firmada de corta duración para ver la foto de un
 * punto de ronda. Envía SOLO el id de la evidencia con Authorization Bearer; el
 * storage_path lo resuelve y valida el servidor. La URL es efímera: no se cachea
 * (fetch con `cache: 'no-store'`) y el llamador no debe persistirla.
 */
export async function firmarEvidenciaRonda(
  evidenciaId: string,
): Promise<ResultadoRondas<FirmaEvidenciaRonda>> {
  const { data: sesionData, error: sesionError } = await supabase.auth.getSession()
  const token = sesionData.session?.access_token

  if (sesionError || !token) {
    return { data: { contexto: 'sin_usuario', url: null, expira_en_s: null }, error: null }
  }

  let response: Response
  try {
    response = await fetch(
      `/api/rondas/evidencia?evidencia_id=${encodeURIComponent(evidenciaId)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        // Respuesta con URL firmada efímera: nunca se cachea.
        cache: 'no-store',
      },
    )
  } catch {
    return { data: null, error: 'No hay conexión para cargar la foto.' }
  }

  const body = (await response.json().catch(() => null)) as RespuestaFirmaEndpoint | null
  // El contexto lo dicta el servidor (mismo vocabulario en 200 y en errores).
  const contexto = (body?.contexto ?? contextoDesdeStatus(response.status)) as ContextoFirmaEvidencia

  return {
    data: {
      contexto,
      url: contexto === 'ok' ? body?.url ?? null : null,
      expira_en_s: contexto === 'ok' ? body?.expira_en_s ?? null : null,
    },
    error: null,
  }
}

/** Mensaje para el supervisor según el contexto de la firma de evidencia. */
export function mensajeContextoFirmaEvidencia(contexto: ContextoFirmaEvidencia): string | null {
  switch (contexto) {
    case 'ok':                     return null
    case 'sin_usuario':            return 'Tu sesión venció. Volvé a ingresar.'
    case 'parametro_invalido':     return 'La referencia de la foto no es válida.'
    case 'evidencia_no_encontrada':return 'No se encontró la foto de ese punto.'
    case 'sin_permiso':            return 'No tenés permiso para ver esta evidencia.'
    case 'error_firma':            return 'No se pudo generar el acceso a la foto. Probá de nuevo.'
  }
}

// ── Alertas de rondas (A4: capa cliente) ──────────────────────────────────────
// Lectura y resolución de alertas persistentes. La detección y el push viven en
// el evaluador SQL y el cron; acá solo se listan y se interviene.

export type TipoRondaAlerta = 'no_iniciada' | 'no_finalizada' | 'suspendida'
export type EstadoRondaAlerta = 'pendiente' | 'resuelta'
export type AccionRondaAlerta =
  | 'llamada_vigilador'
  | 'solicitud_cumplimiento'
  | 'justificacion'
  | 'cierre_administrativo'
  | 'resuelta'

export const ACCIONES_RONDA_ALERTA: readonly AccionRondaAlerta[] =
  ['llamada_vigilador', 'solicitud_cumplimiento', 'justificacion', 'cierre_administrativo', 'resuelta'] as const

/** Acciones que cierran la alerta (y exigen comentario). */
export function accionRondaAlertaCierra(accion: AccionRondaAlerta): boolean {
  return accion === 'justificacion' || accion === 'cierre_administrativo' || accion === 'resuelta'
}
export const accionRondaAlertaRequiereComentario = accionRondaAlertaCierra

/**
 * Cuánto hace que venció la ventana de la ronda, en minutos.
 *
 * Se mide contra `vencimiento_at` —el deadline con la tolerancia ya aplicada,
 * calculado en el servidor— y no contra `ventana_inicio`: la alerta nace recién
 * cuando pasa la tolerancia, así que contar desde el inicio previsto sumaría
 * siempre esos minutos de más. Ambos son timestamptz absolutos, de modo que el
 * huso del navegador no puede correr la cuenta.
 *
 * Devuelve 0 si todavía no venció: nunca se muestra una demora negativa.
 */
export function demoraAlertaMinutos(vencimientoAt: string, ahora: number = Date.now()): number {
  const vencimiento = msRonda(vencimientoAt)
  if (!vencimiento) return 0
  return Math.max(0, Math.floor((ahora - vencimiento) / 60000))
}

/** "1 h 20 min" · "45 min" · "recién vencida". */
export function etiquetaDemora(minutos: number): string {
  if (minutos <= 0) return 'recién vencida'
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

export function etiquetaTipoRondaAlerta(tipo: TipoRondaAlerta): string {
  switch (tipo) {
    case 'no_iniciada':   return 'No iniciada'
    case 'no_finalizada': return 'Sin finalizar'
    case 'suspendida':    return 'Suspendida'
  }
}

export function etiquetaAccionRondaAlerta(accion: AccionRondaAlerta): string {
  switch (accion) {
    case 'llamada_vigilador':      return 'Llamada al vigilador'
    case 'solicitud_cumplimiento': return 'Solicitud de cumplimiento'
    case 'justificacion':          return 'Justificación'
    case 'cierre_administrativo':  return 'Cierre administrativo'
    case 'resuelta':               return 'Marcar resuelta'
  }
}

export interface RondaAlerta {
  id: string
  tipo: TipoRondaAlerta
  estado: EstadoRondaAlerta
  objetivo_id: string
  /**
   * Necesario cuando el listado mezcla objetivos (alcance completo). En las
   * respuestas por objetivo viene igual y es redundante, no ausente.
   */
  objetivo_nombre: string
  puesto_id: string
  puesto_nombre: string
  ronda_base_id: string
  ronda_nombre: string
  turno_id: string
  guardia_id: string
  guardia_nombre: string
  ejecucion_id: string | null
  ventana_inicio: string
  ventana_fin: string
  vencimiento_at: string
  detectada_at: string
  resuelta_por: string | null
  resuelta_por_nombre: string | null
  resuelta_at: string | null
  accion: AccionRondaAlerta | null
  comentario: string | null
  /** Motivo declarado por el vigilador al suspender (solo tipo 'suspendida'). */
  motivo_vigilador: string | null
  intervenciones: number
}

export type ContextoRondaAlertas = 'ok' | 'sin_usuario' | 'sin_permiso' | 'parametro_invalido'

export interface RespuestaRondaAlertas {
  contexto: ContextoRondaAlertas
  alertas: RondaAlerta[]
}

/**
 * Alertas de rondas de UN objetivo, o de todo el alcance del usuario.
 *
 * `objetivoId = null` pide el alcance completo: la misma RPC con el filtro
 * relajado, no otra consulta. El servidor resuelve qué objetivos entran (zona
 * del supervisor, o todos si es admin) y excluye los de prueba. Las alertas
 * vienen ordenadas por vencimiento: lo más atrasado primero.
 */
export async function listarRondaAlertasObjetivo(
  objetivoId: string | null,
  estado?: EstadoRondaAlerta,
): Promise<ResultadoRondas<RespuestaRondaAlertas>> {
  const { data, error } = await supabase.rpc('listar_ronda_alertas_objetivo', {
    p_objetivo_id: objetivoId,
    p_estado: estado ?? null,
  })

  if (error) {
    return fallaRpc('listar_ronda_alertas_objetivo', error, 'No se pudieron cargar las alertas de rondas.')
  }

  const bruto = (data ?? {}) as Partial<RespuestaRondaAlertas>
  return {
    data: {
      contexto: (bruto.contexto ?? 'sin_permiso') as ContextoRondaAlertas,
      alertas: Array.isArray(bruto.alertas) ? (bruto.alertas as RondaAlerta[]) : [],
    },
    error: null,
  }
}

/** Alertas de rondas de todos los objetivos del alcance del usuario. */
export function listarRondaAlertasAlcance(
  estado?: EstadoRondaAlerta,
): Promise<ResultadoRondas<RespuestaRondaAlertas>> {
  return listarRondaAlertasObjetivo(null, estado)
}

export interface ResumenRondasAlcance {
  /** Alertas pendientes: todo lo que espera intervención del supervisor. */
  pendientes: number
  /** Incumplimientos propiamente dichos: excluye las suspensiones declaradas. */
  incumplidas: number
  /** Suspensiones declaradas por el vigilador, todavía sin resolver. */
  suspendidas: number
  /** Objetivos distintos con al menos una alerta pendiente. */
  objetivosAfectados: number
}

/**
 * Indicadores de rondas del panel principal.
 *
 * Se derivan del mismo listado que alimenta el panel de pendientes, a propósito:
 * una RPC de resumen aparte sería una segunda fuente de verdad que podría
 * discrepar del detalle que el usuario ve al hacer clic.
 */
export function resumirRondasAlcance(alertas: RondaAlerta[]): ResumenRondasAlcance {
  const pendientes = alertas.filter(a => a.estado === 'pendiente')
  return {
    pendientes: pendientes.length,
    incumplidas: pendientes.filter(a => a.tipo !== 'suspendida').length,
    suspendidas: pendientes.filter(a => a.tipo === 'suspendida').length,
    objetivosAfectados: new Set(pendientes.map(a => a.objetivo_id)).size,
  }
}

export type ContextoResolverAlerta =
  | 'registrada'
  | 'resuelta'
  | 'ya_resuelta'
  | 'sin_usuario'
  | 'no_encontrada'
  | 'sin_permiso'
  | 'accion_invalida'
  | 'comentario_requerido'
  | 'cierre_no_aplicable'
  // Propagados desde cerrar_ronda_bloqueada al delegar el cierre administrativo.
  | 'motivo_invalido'
  | 'ejecucion_no_bloqueada'
  | 'ejecucion_no_encontrada'

export interface RespuestaResolverAlerta {
  contexto: ContextoResolverAlerta
  alerta_id: string | null
}

export async function resolverRondaAlerta(
  alertaId: string,
  accion: AccionRondaAlerta,
  comentario?: string,
): Promise<ResultadoRondas<RespuestaResolverAlerta>> {
  const { data, error } = await supabase.rpc('resolver_ronda_alerta', {
    p_alerta_id: alertaId,
    p_accion: accion,
    p_comentario: comentario ?? null,
  })

  if (error) {
    return fallaRpc('resolver_ronda_alerta', error, 'No se pudo registrar la intervención.')
  }

  const bruto = (data ?? {}) as Partial<RespuestaResolverAlerta>
  return {
    data: {
      contexto: (bruto.contexto ?? 'no_encontrada') as ContextoResolverAlerta,
      alerta_id: bruto.alerta_id ?? null,
    },
    error: null,
  }
}

/** Mensaje para el supervisor tras intervenir. `null` cuando fue exitoso. */
export function mensajeContextoResolverAlerta(contexto: ContextoResolverAlerta): string | null {
  switch (contexto) {
    case 'registrada':
    case 'resuelta':
      return null
    case 'ya_resuelta':          return 'La alerta ya estaba resuelta.'
    case 'sin_usuario':          return 'No se pudo identificar tu usuario operativo.'
    case 'no_encontrada':        return 'Esa alerta ya no existe.'
    case 'sin_permiso':          return 'No tenés permiso para intervenir esta alerta.'
    case 'accion_invalida':      return 'La acción no es válida.'
    case 'comentario_requerido': return 'El comentario es obligatorio para esta acción.'
    case 'cierre_no_aplicable':  return 'El cierre administrativo requiere una ejecución asociada. Usá justificación o resuelta.'
    case 'motivo_invalido':      return 'El motivo del cierre debe tener al menos 10 caracteres.'
    case 'ejecucion_no_bloqueada': return 'La ronda no está en curso: la terminó el vigilador.'
    case 'ejecucion_no_encontrada': return 'La ejecución asociada ya no existe.'
  }
}

// ── Suspender ronda (acción del vigilador) ────────────────────────────────────
// El vigilador declara que no puede realizar una ronda por una tarea, con motivo.
// Queda registrada como alerta 'suspendida' y el cron notifica al supervisor.

export type ContextoSuspenderRonda =
  | 'suspendida'
  | 'sin_turno_vigente'
  | 'motivo_invalido'
  | 'ronda_no_disponible'

export interface RespuestaSuspenderRonda {
  contexto: ContextoSuspenderRonda
  alerta_id: string | null
  ronda_nombre?: string | null
}

export async function suspenderRonda(
  rondaBaseId: string,
  motivo: string,
): Promise<ResultadoRondas<RespuestaSuspenderRonda>> {
  if (motivo.trim().length < 3) {
    return { data: null, error: 'Aclará brevemente la tarea que te impide hacer la ronda.' }
  }

  const { data, error } = await supabase.rpc('suspender_ronda', {
    p_ronda_base_id: rondaBaseId,
    p_motivo: motivo.trim(),
  })

  if (error) {
    return fallaRpc('suspender_ronda', error, 'No se pudo suspender la ronda.')
  }

  const bruto = (data ?? {}) as Partial<RespuestaSuspenderRonda>
  return {
    data: {
      contexto: (bruto.contexto ?? 'sin_turno_vigente') as ContextoSuspenderRonda,
      alerta_id: bruto.alerta_id ?? null,
      ronda_nombre: bruto.ronda_nombre ?? null,
    },
    error: null,
  }
}

export function mensajeContextoSuspenderRonda(contexto: ContextoSuspenderRonda): string | null {
  switch (contexto) {
    case 'suspendida':          return null
    case 'sin_turno_vigente':   return 'No tenés un turno vigente en este momento.'
    case 'motivo_invalido':     return 'Aclará brevemente la tarea que te impide hacer la ronda.'
    case 'ronda_no_disponible': return 'Esa ronda no corresponde a tu puesto actual.'
  }
}

// ── Acción principal de la recorrida (app del vigilador) ─────────────────────
//
// Para el vigilador iniciar una recorrida tiene que ser un toque, no un
// recorrido por tres pantallas. Esto decide qué dice y qué hace el botón
// principal de la tarjeta.
//
// NO decide si la ronda puede arrancar: eso lo resuelve iniciar_ronda() en el
// servidor, que sigue siendo la única autoridad sobre ventanas y pausas. Acá
// solo se elige el texto y si el botón está disponible, a partir de la ventana
// que ya vino calculada por rondas_ventanas_programadas.

export interface AccionRecorrida {
  /** Texto del botón o del aviso. */
  etiqueta: string
  /** false cuando todavía no corresponde arrancar o no hay nada que recorrer. */
  habilitada: boolean
  /** Motivo por el que no se puede arrancar, para mostrarlo al lado. */
  detalle: string | null
}

export function accionRecorrida(r: Pick<RondaGuardia,
  'cantidad_puntos' | 'habilitada_ahora' | 'ventana_inicio_hhmm'>): AccionRecorrida {
  if (r.cantidad_puntos === 0) {
    return {
      etiqueta: 'Sin puntos para recorrer',
      habilitada: false,
      detalle: 'Esta ronda todavía no tiene puntos cargados.',
    }
  }
  if (r.habilitada_ahora) {
    return { etiqueta: 'Iniciar recorrida', habilitada: true, detalle: null }
  }
  if (r.ventana_inicio_hhmm) {
    return {
      etiqueta: `Recorrida habilitada a las ${r.ventana_inicio_hhmm}`,
      habilitada: false,
      detalle: null,
    }
  }
  // Sin ventana por delante: al turno no le queda ninguna recorrida exigible.
  return {
    etiqueta: 'Sin recorridas pendientes',
    habilitada: false,
    detalle: 'No queda ninguna recorrida por hacer en este turno.',
  }
}
