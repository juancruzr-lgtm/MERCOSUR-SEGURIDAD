/**
 * lib/gps-vehiculos/posiciones.ts — reglas puras sobre posiciones de Smart Tag.
 *
 * Espeja lo que valida `gps_tag_registrar_consulta` en la base (para probarlo
 * sin base y para que la UI muestre lo mismo). Nunca genera coordenadas ni
 * horarios: sólo filtra, clasifica y resume lo que el servicio devolvió.
 */
import type { AsignacionSupervisor, AsignacionTag, ConsultaTag, PosicionTag, ReporteProveedor } from './tipos'

/** Frecuencia objetivo de consulta. */
export const INTERVALO_CONSULTA_MIN = 10
/** Tolerancia de reloj: una hora de ubicación posterior a la consulta + esto se descarta. */
export const TOLERANCIA_FUTURO_MS = 5 * 60_000

const MIN = 60_000
const HORA = 60 * MIN

// ── Validación y deduplicación ──────────────────────────────────────────────

export type MotivoDescarte = 'coordenadas_invalidas' | 'coordenadas_cero' | 'hora_invalida' | 'hora_futura'

export function motivoDescarte(r: ReporteProveedor, horaConsulta: Date): MotivoDescarte | null {
  if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng) || r.lat < -90 || r.lat > 90 || r.lng < -180 || r.lng > 180) {
    return 'coordenadas_invalidas'
  }
  if (r.lat === 0 && r.lng === 0) return 'coordenadas_cero'
  const t = Date.parse(r.horaUbicacion)
  if (!Number.isFinite(t)) return 'hora_invalida'
  if (t > horaConsulta.getTime() + TOLERANCIA_FUTURO_MS) return 'hora_futura'
  return null
}

/** Misma clave que el índice único gps_tag_posiciones_dedup_uq. */
export function claveDedup(tagId: string, horaUbicacion: string, lat: number, lng: number): string {
  return `${tagId}|${new Date(horaUbicacion).toISOString()}|${lat}|${lng}`
}

export interface ResultadoFiltrado {
  nuevas: ReporteProveedor[]
  duplicadas: number
  descartadas: { reporte: ReporteProveedor; motivo: MotivoDescarte }[]
}

/** Separa reportes válidos y nuevos de duplicados (ya guardados o repetidos en el lote) e inválidos. */
export function filtrarReportes(
  tagId: string, reportes: ReporteProveedor[], horaConsulta: Date, clavesExistentes: Set<string>,
): ResultadoFiltrado {
  const vistas = new Set(clavesExistentes)
  const out: ResultadoFiltrado = { nuevas: [], duplicadas: 0, descartadas: [] }
  for (const r of reportes) {
    const motivo = motivoDescarte(r, horaConsulta)
    if (motivo) { out.descartadas.push({ reporte: r, motivo }); continue }
    const k = claveDedup(tagId, r.horaUbicacion, r.lat, r.lng)
    if (vistas.has(k)) { out.duplicadas++; continue }
    vistas.add(k)
    out.nuevas.push(r)
  }
  return out
}

// ── Atribución histórica ────────────────────────────────────────────────────

function vigenteEn<T extends { desde: string; hasta: string | null }>(filas: T[], hora: Date): T | null {
  const t = hora.getTime()
  const candidatas = filas.filter(a => Date.parse(a.desde) <= t && (a.hasta === null || Date.parse(a.hasta) > t))
  candidatas.sort((a, b) => Date.parse(b.desde) - Date.parse(a.desde))
  return candidatas[0] ?? null
}

/** Vehículo que llevaba el tag en esa hora (no el actual). */
export function vehiculoDeTagEn(asignaciones: AsignacionTag[], tagId: string, hora: Date): string | null {
  return vigenteEn(asignaciones.filter(a => a.tag_id === tagId), hora)?.vehiculo_id ?? null
}

/** Supervisor que tenía el vehículo en esa hora (no el actual). */
export function supervisorDeVehiculoEn(asignaciones: AsignacionSupervisor[], vehiculoId: string, hora: Date): string | null {
  return vigenteEn(asignaciones.filter(a => a.vehiculo_id === vehiculoId), hora)?.supervisor_id ?? null
}

export function asignacionVigente<T extends { hasta: string | null; desde: string }>(filas: T[]): T | null {
  return filas.filter(f => f.hasta === null).sort((a, b) => Date.parse(b.desde) - Date.parse(a.desde))[0] ?? null
}

// ── Antigüedad y estado de actualización ────────────────────────────────────

export type Antiguedad = 'reciente' | 'horas' | 'antigua' | 'muy_antigua' | 'sin_posicion'

export const UMBRAL_RECIENTE_MS = 30 * MIN
export const UMBRAL_HORAS_MS = 6 * HORA
export const UMBRAL_ANTIGUA_MS = 24 * HORA

export function clasificarAntiguedad(horaUbicacion: string | null | undefined, ahora: Date): Antiguedad {
  if (!horaUbicacion) return 'sin_posicion'
  const edad = ahora.getTime() - Date.parse(horaUbicacion)
  if (edad <= UMBRAL_RECIENTE_MS) return 'reciente'
  if (edad <= UMBRAL_HORAS_MS) return 'horas'
  if (edad <= UMBRAL_ANTIGUA_MS) return 'antigua'
  return 'muy_antigua'
}

export const ETIQUETA_ANTIGUEDAD: Record<Antiguedad, string> = {
  reciente: 'Detectado hace menos de 30 min',
  horas: 'Detectado hace horas',
  antigua: 'Posición antigua (más de 6 h)',
  muy_antigua: 'Posición muy antigua (más de 24 h)',
  sin_posicion: 'Sin posición registrada',
}

export function textoEdad(desde: string | null | undefined, ahora: Date): string {
  if (!desde) return '—'
  const m = Math.max(0, Math.round((ahora.getTime() - Date.parse(desde)) / MIN))
  if (m < 1) return 'hace menos de 1 min'
  if (m < 60) return `hace ${m} min`
  const h = Math.floor(m / 60)
  if (h < 48) return `hace ${h} h ${m % 60} min`
  return `hace ${Math.floor(h / 24)} días`
}

export type EstadoActualizacion = 'sin_tag' | 'sin_consultas' | 'consulta_atrasada' | 'ultima_con_error' | 'sin_ubicacion_reciente' | 'al_dia'

export const ETIQUETA_ESTADO: Record<EstadoActualizacion, string> = {
  sin_tag: 'Sin Smart Tag asignado',
  sin_consultas: 'Todavía no se consultó',
  consulta_atrasada: 'Consultas atrasadas',
  ultima_con_error: 'Última consulta con error',
  sin_ubicacion_reciente: 'Sin ubicación reciente',
  al_dia: 'Consultas al día',
}

export function estadoActualizacion(params: {
  tieneTag: boolean
  ultimaConsulta: Pick<ConsultaTag, 'hora_consulta' | 'resultado'> | null
  ultimaHoraUbicacion: string | null
  ahora: Date
  intervaloMin?: number
}): EstadoActualizacion {
  const { tieneTag, ultimaConsulta, ultimaHoraUbicacion, ahora } = params
  const intervalo = (params.intervaloMin ?? INTERVALO_CONSULTA_MIN) * MIN
  if (!tieneTag) return 'sin_tag'
  if (!ultimaConsulta) return 'sin_consultas'
  if (ahora.getTime() - Date.parse(ultimaConsulta.hora_consulta) > 2.5 * intervalo) return 'consulta_atrasada'
  if (ultimaConsulta.resultado === 'error') return 'ultima_con_error'
  const a = clasificarAntiguedad(ultimaHoraUbicacion, ahora)
  if (a === 'antigua' || a === 'muy_antigua' || a === 'sin_posicion') return 'sin_ubicacion_reciente'
  return 'al_dia'
}

// ── Historial: conexiones APROXIMADAS ───────────────────────────────────────

/** Por encima de este hueco entre detecciones no se dibuja conexión. */
export const HUECO_MAX_CONEXION_MS = 2 * HORA

export interface TramoAproximado {
  /** Siempre true: son líneas rectas entre detecciones, no un recorrido comprobado. */
  aproximado: true
  puntos: Pick<PosicionTag, 'lat' | 'lng' | 'hora_ubicacion'>[]
}

/**
 * Agrupa posiciones (ordenadas por hora de ubicación) en tramos para unir con
 * líneas punteadas. No calcula kilómetros: el registro no es continuo.
 */
export function tramosAproximados(
  posiciones: Pick<PosicionTag, 'lat' | 'lng' | 'hora_ubicacion'>[],
  huecoMaxMs = HUECO_MAX_CONEXION_MS,
): TramoAproximado[] {
  const orden = [...posiciones].sort((a, b) => Date.parse(a.hora_ubicacion) - Date.parse(b.hora_ubicacion))
  const tramos: TramoAproximado[] = []
  let actual: TramoAproximado | null = null
  for (const p of orden) {
    const prev = actual?.puntos[actual.puntos.length - 1]
    if (!actual || !prev || Date.parse(p.hora_ubicacion) - Date.parse(prev.hora_ubicacion) > huecoMaxMs) {
      actual = { aproximado: true, puntos: [p] }
      tramos.push(actual)
    } else {
      actual.puntos.push(p)
    }
  }
  return tramos.filter(t => t.puntos.length >= 2)
}

// ── Prueba controlada de 24 h ───────────────────────────────────────────────

export type EstadoPrueba = 'sin_consultas' | 'incompleta' | 'completa_simulada' | 'completa_real'

export interface ResumenPrueba {
  estado: EstadoPrueba
  /** true si alguna consulta vino del proveedor simulado: los números NO son de un dispositivo real. */
  incluyeSimuladas: boolean
  consultas: number
  consultasEsperadas: number
  conNuevaPosicion: number
  sinNuevaPosicion: number
  pctSinNuevaPosicion: number | null
  errores: number
  omitidasPorLimite: number
  posicionesNuevas: number
  /** Minutos entre detecciones reales distintas (hora de ubicación). */
  minutosEntreDetecciones: { mediana: number | null; maximo: number | null }
  /** Antigüedad de cada posición al ser recibida: hora_consulta − hora_ubicacion, en minutos. */
  antiguedadAlRecibirMin: { mediana: number | null; maximo: number | null }
  /** Horas (de las 24) con al menos una detección. */
  horasConDeteccion: number
  /** Mayor hueco entre consultas consecutivas, en minutos (detecta caídas del proceso). */
  mayorHuecoEntreConsultasMin: number | null
  historialUtil: boolean
}

function mediana(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const redondear = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10)

export function resumirPrueba(params: {
  consultas: Pick<ConsultaTag, 'hora_consulta' | 'resultado' | 'posiciones_nuevas' | 'proveedor'>[]
  posiciones: Pick<PosicionTag, 'hora_ubicacion' | 'hora_consulta' | 'fuente'>[]
  desde: Date
  hasta: Date
  intervaloMin?: number
}): ResumenPrueba {
  const { desde, hasta } = params
  const intervalo = params.intervaloMin ?? INTERVALO_CONSULTA_MIN
  const enRango = (iso: string) => { const t = Date.parse(iso); return t >= desde.getTime() && t < hasta.getTime() }
  const consultas = params.consultas.filter(c => enRango(c.hora_consulta))
    .sort((a, b) => Date.parse(a.hora_consulta) - Date.parse(b.hora_consulta))
  const posiciones = params.posiciones.filter(p => enRango(p.hora_consulta))
  const esperadas = Math.floor((hasta.getTime() - desde.getTime()) / (intervalo * MIN))

  const efectivas = consultas.filter(c => c.resultado !== 'omitida_limite')
  const con = efectivas.filter(c => c.resultado === 'nueva_posicion').length
  const sin = efectivas.filter(c => c.resultado === 'sin_novedad' || c.resultado === 'sin_datos').length
  const errores = efectivas.filter(c => c.resultado === 'error').length

  const horasUbic = Array.from(new Set(posiciones.map(p => Date.parse(p.hora_ubicacion)))).sort((a, b) => a - b)
  const gapsDet = horasUbic.slice(1).map((t, i) => (t - horasUbic[i]) / MIN)
  const edades = posiciones.map(p => (Date.parse(p.hora_consulta) - Date.parse(p.hora_ubicacion)) / MIN)
  const horasCon = new Set(posiciones.map(p => Math.floor((Date.parse(p.hora_ubicacion) - desde.getTime()) / HORA))
    .filter(h => h >= 0 && h < 24)).size

  const tiempos = consultas.map(c => Date.parse(c.hora_consulta))
  const bordes = [desde.getTime(), ...tiempos, hasta.getTime()]
  const gapsCons = bordes.slice(1).map((t, i) => (t - bordes[i]) / MIN)
  const mayorHueco = tiempos.length ? Math.max(...gapsCons) : null

  const incluyeSimuladas = consultas.some(c => c.proveedor === 'simulado') || posiciones.some(p => p.fuente === 'simulado')
  // "Completa" exige consultas efectivas cubriendo toda la ventana: al menos el 90 %
  // de las esperadas y ningún hueco mayor a 3 intervalos.
  const cubre = efectivas.length >= 0.9 * esperadas && mayorHueco !== null && mayorHueco <= 3 * intervalo
  const estado: EstadoPrueba = consultas.length === 0 ? 'sin_consultas'
    : !cubre ? 'incompleta'
    : incluyeSimuladas ? 'completa_simulada' : 'completa_real'

  return {
    estado,
    incluyeSimuladas,
    consultas: efectivas.length,
    consultasEsperadas: esperadas,
    conNuevaPosicion: con,
    sinNuevaPosicion: sin,
    pctSinNuevaPosicion: efectivas.length ? redondear((100 * sin) / efectivas.length) : null,
    errores,
    omitidasPorLimite: consultas.length - efectivas.length,
    posicionesNuevas: posiciones.length,
    minutosEntreDetecciones: { mediana: redondear(mediana(gapsDet)), maximo: gapsDet.length ? redondear(Math.max(...gapsDet)) : null },
    antiguedadAlRecibirMin: { mediana: redondear(mediana(edades)), maximo: edades.length ? redondear(Math.max(...edades)) : null },
    horasConDeteccion: horasCon,
    mayorHuecoEntreConsultasMin: redondear(mayorHueco),
    // Útil = al menos una detección en la mitad de las horas: permite reconstruir
    // por dónde anduvo el vehículo a grandes rasgos (no un recorrido exacto).
    historialUtil: horasCon >= 12,
  }
}
