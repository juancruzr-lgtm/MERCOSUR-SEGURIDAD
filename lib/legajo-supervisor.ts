/**
 * lib/legajo-supervisor.ts
 *
 * Legajo operativo de supervisores — Etapa 2A (sólo lectura).
 *
 * Los datos salen de las funciones de la migración 20261030120000; acá se
 * arman los cálculos que muestra la pantalla: supervisiones dentro y fuera de
 * turno, distribución por hora del día con las horas de SERVICIO al lado,
 * franjas de servicio sin supervisiones y los tramos del recorrido que se
 * pueden dibujar como reales.
 *
 * Reglas (pedido de JC 19/10):
 *  · Nada se le reclama a un supervisor fuera de su guardia: las franjas sin
 *    actividad se buscan SOLO dentro de guardias que cubren (activas, rol
 *    supervisor, no franco ni ausencia).
 *  · Una supervisión sin guardia cargada ese día es «sin calendario», no
 *    «fuera de turno»: puede ser el calendario el que falta.
 *  · El recorrido real se dibuja sólo entre puntos GPS cercanos en el tiempo.
 *    Un hueco sin puntos se deja sin línea: no hay evidencia del trayecto.
 *  · «Actividad registrada» = puntos GPS de la app. Sin puntos no hay
 *    evidencia, que no es lo mismo que «no trabajó».
 */

import { puestoDe, type SujetoAcceso } from './capacidades'
import { puedeVerEvaluacionSupervisores } from './evaluacion-supervisores'
import { ZONA_ARGENTINA } from './periodo-argentina'

export interface GuardiaLegajo {
  guardia_id: string
  supervisor_id: string
  supervisor: string
  fecha: string
  zona: string | null
  tipo_evento: string
  estado: string
  /** Cuenta como servicio (activa, rol supervisor, no franco ni ausencia). */
  cubre: boolean
  inicio: string
  fin: string
  horas_programadas: number
  gps_desde: string | null
  gps_hasta: string | null
  gps_puntos: number
  supervisiones: number
  objetivos_visitados: number
}

export interface SupervisionLegajo {
  supervision_id: string
  supervisor_id: string
  supervisor: string
  created_at: string
  objetivo_id: string | null
  objetivo: string | null
  zona_id: string | null
  zona: string | null
  estado: string
  observaciones: string | null
  items_total: number
  items_observados: number
  novedades_items: string | null
  fotos: number
  lat: number | null
  lng: number | null
  distancia_objetivo_m: number | null
  radio_m: number | null
  /** Guardia propia que cubría ese instante; null = no estaba de servicio. */
  guardia_id: string | null
  /** Tenía alguna guardia cargada ese día o el anterior. */
  hay_guardia_cerca: boolean
}

export interface PuntoRecorrido {
  ts: string
  lat: number
  lng: number
  precision_m: number | null
  tipo_punto: string | null
  estado_movimiento: string | null
  supervision_id: string | null
}

export type SituacionTurno = 'en_turno' | 'fuera_turno' | 'sin_calendario'

export const ETIQUETA_SITUACION: Record<SituacionTurno, string> = {
  en_turno: 'En su turno',
  fuera_turno: 'Fuera de su turno',
  sin_calendario: 'Sin guardia cargada',
}

/**
 * Acceso al legajo operativo de supervisores (JC 19/10), en dos pasos:
 *  · 'si': Gerencia, Dirección Operativa o delegación gerencial (por puesto,
 *    como el ranking de la Etapa 1);
 *  · 'consultar': Jefe de supervisores o Administración. Su acceso es
 *    NOMINAL (tabla legajo_supervisores_accesos en la base): el puesto no
 *    alcanza, hay que preguntarle a la base (consultarAccesoLegajo);
 *  · 'no': cualquier otro (supervisores, vigiladores). Sin consulta.
 * La base es la que decide siempre; esto sólo evita mostrar algo que igual
 * respondería «sin permiso» y ahorra la consulta a quien no puede tenerlo.
 */
export type AccesoPorPuesto = 'si' | 'consultar' | 'no'

export function accesoLegajoPorPuesto(u: SujetoAcceso | null | undefined): AccesoPorPuesto {
  if (!u) return 'no'
  if (puedeVerEvaluacionSupervisores(u)) return 'si'
  const puesto = puestoDe(u)
  return puesto === 'jefe_supervisores' || puesto === 'administracion' ? 'consultar' : 'no'
}

/** Pregunta a la base (`puede_ver_legajo_supervisores_actual`). Ante error, no. */
export async function consultarAccesoLegajo(db: any): Promise<boolean> {
  try {
    const { data, error } = await db.rpc('puede_ver_legajo_supervisores_actual')
    return !error && data === true
  } catch {
    return false
  }
}

/** Resolución completa: puesto primero y, si hace falta, la base. */
export async function resolverAccesoLegajo(db: any, u: SujetoAcceso | null | undefined): Promise<boolean> {
  const p = accesoLegajoPorPuesto(u)
  if (p === 'si') return true
  if (p === 'no') return false
  return consultarAccesoLegajo(db)
}

export function situacionTurno(s: Pick<SupervisionLegajo, 'guardia_id' | 'hay_guardia_cerca'>): SituacionTurno {
  if (s.guardia_id) return 'en_turno'
  return s.hay_guardia_cerca ? 'fuera_turno' : 'sin_calendario'
}

// ── Hora local argentina (nunca la del proceso: Vercel corre en UTC) ─────────

const FMT_PARTES = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA_ARGENTINA, hour: '2-digit', hourCycle: 'h23', weekday: 'short',
})
const DIAS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Hora (0-23) y día (0 = lunes … 6 = domingo) en Argentina. */
export function horaYDiaArgentina(instante: string | Date): { hora: number; dia: number } {
  const partes = FMT_PARTES.formatToParts(typeof instante === 'string' ? new Date(instante) : instante)
  const hora = Number(partes.find(p => p.type === 'hour')?.value ?? 0) % 24
  const dia = DIAS.indexOf(partes.find(p => p.type === 'weekday')?.value ?? 'Mon')
  return { hora, dia: dia < 0 ? 0 : dia }
}

// ── Distribución por hora del día ────────────────────────────────────────────

export interface FranjaHoraria {
  hora: number
  enTurno: number
  fueraTurno: number
  sinCalendario: number
  /** Minutos de guardia de servicio que caen en esa hora del día, sumados en el período. */
  minutosServicio: number
}

const HORA_MS = 3_600_000

/**
 * Supervisiones por hora del día (separadas por situación) y, al lado, cuántos
 * minutos de servicio hubo en esa hora. Así una hora sin supervisiones se lee
 * distinto si estaba de guardia o no.
 */
export function distribucionHoraria(
  supervisiones: readonly SupervisionLegajo[],
  guardias: readonly GuardiaLegajo[],
): FranjaHoraria[] {
  const filas: FranjaHoraria[] = Array.from({ length: 24 }, (_, hora) => ({
    hora, enTurno: 0, fueraTurno: 0, sinCalendario: 0, minutosServicio: 0,
  }))
  for (const s of supervisiones) {
    const { hora } = horaYDiaArgentina(s.created_at)
    const sit = situacionTurno(s)
    if (sit === 'en_turno') filas[hora].enTurno++
    else if (sit === 'fuera_turno') filas[hora].fueraTurno++
    else filas[hora].sinCalendario++
  }
  for (const g of guardias) {
    if (!g.cubre) continue
    let t = new Date(g.inicio).getTime()
    const fin = new Date(g.fin).getTime()
    // Argentina tiene offset de horas enteras: el corte de hora UTC coincide
    // con el corte de hora local.
    while (t < fin) {
      const siguiente = Math.min(fin, Math.floor(t / HORA_MS) * HORA_MS + HORA_MS)
      filas[horaYDiaArgentina(new Date(t)).hora].minutosServicio += (siguiente - t) / 60_000
      t = siguiente
    }
  }
  for (const f of filas) f.minutosServicio = Math.round(f.minutosServicio)
  return filas
}

/** Supervisiones por día de la semana (filas, lunes primero) y hora (columnas). */
export function matrizDiaHora(supervisiones: readonly SupervisionLegajo[]): number[][] {
  const m = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
  for (const s of supervisiones) {
    const { hora, dia } = horaYDiaArgentina(s.created_at)
    m[dia][hora]++
  }
  return m
}

/**
 * Dónde cae cada supervisión dentro de su guardia: primer 20 %, medio o último
 * 20 %. Sirve para ver si se concentran al empezar o al terminar el turno.
 */
export function posicionEnTurno(
  supervisiones: readonly SupervisionLegajo[],
  guardias: readonly GuardiaLegajo[],
): { inicio: number; medio: number; final: number } {
  const porId = new Map(guardias.map(g => [g.guardia_id, g]))
  const r = { inicio: 0, medio: 0, final: 0 }
  for (const s of supervisiones) {
    const g = s.guardia_id ? porId.get(s.guardia_id) : undefined
    if (!g) continue
    const ini = new Date(g.inicio).getTime()
    const dur = new Date(g.fin).getTime() - ini
    if (dur <= 0) continue
    const x = (new Date(s.created_at).getTime() - ini) / dur
    if (x < 0.2) r.inicio++
    else if (x >= 0.8) r.final++
    else r.medio++
  }
  return r
}

export interface FranjaSinSupervision { desde: string; hasta: string; minutos: number }

/**
 * Tramos de una guardia de servicio sin ninguna supervisión, de al menos
 * `minimoMin`. Sólo dentro de la guardia y sólo hasta `ahora` (una guardia en
 * curso no tiene «huecos» en el futuro). Una guardia que no cubre no tiene.
 */
export function franjasSinSupervision(
  guardia: GuardiaLegajo,
  supervisiones: readonly SupervisionLegajo[],
  minimoMin = 120,
  ahora: Date = new Date(),
): FranjaSinSupervision[] {
  if (!guardia.cubre) return []
  const ini = new Date(guardia.inicio).getTime()
  const fin = Math.min(new Date(guardia.fin).getTime(), ahora.getTime())
  if (fin <= ini) return []
  const marcas = supervisiones
    .filter(s => s.supervisor_id === guardia.supervisor_id)
    .map(s => new Date(s.created_at).getTime())
    .filter(t => t >= ini && t < fin)
    .sort((a, b) => a - b)
  const cortes = [ini, ...marcas, fin]
  const huecos: FranjaSinSupervision[] = []
  for (let i = 0; i < cortes.length - 1; i++) {
    const min = (cortes[i + 1] - cortes[i]) / 60_000
    if (min >= minimoMin) {
      huecos.push({ desde: new Date(cortes[i]).toISOString(), hasta: new Date(cortes[i + 1]).toISOString(), minutos: Math.round(min) })
    }
  }
  return huecos
}

export interface ObjetivoVisitado {
  objetivo_id: string
  objetivo: string
  zona: string | null
  visitas: number
  enTurno: number
  ultima: string
}

/** Objetivos visitados en el período, de menos a más visitas. */
export function objetivosVisitados(supervisiones: readonly SupervisionLegajo[]): ObjetivoVisitado[] {
  const m = new Map<string, ObjetivoVisitado>()
  for (const s of supervisiones) {
    if (!s.objetivo_id) continue
    const o = m.get(s.objetivo_id) ?? {
      objetivo_id: s.objetivo_id, objetivo: s.objetivo ?? '—', zona: s.zona, visitas: 0, enTurno: 0, ultima: s.created_at,
    }
    o.visitas++
    if (s.guardia_id) o.enTurno++
    if (s.created_at > o.ultima) o.ultima = s.created_at
    m.set(s.objetivo_id, o)
  }
  return Array.from(m.values()).sort((a, b) => a.visitas - b.visitas || a.objetivo.localeCompare(b.objetivo, 'es'))
}

// ── Recorrido ────────────────────────────────────────────────────────────────

export interface OpcionesTramos {
  /** Más de esto entre dos puntos = no se unen (no hay evidencia del trayecto). */
  maxSegundosEntrePuntos: number
  /** Velocidad implícita imposible (salto de GPS) = no se unen. */
  maxVelocidadMs: number
  /** Puntos con precisión peor que esto se muestran pero no se unen. */
  maxPrecisionM: number
}

export const TRAMOS_POR_DEFECTO: OpcionesTramos = {
  maxSegundosEntrePuntos: 300,
  maxVelocidadMs: 45,
  maxPrecisionM: 150,
}

function distanciaM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = 6_371_000
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(h))
}

/**
 * Parte los puntos GPS en tramos que se pueden dibujar como recorrido real.
 * Dos puntos consecutivos se unen sólo si están cerca en el tiempo, la
 * velocidad entre ellos es posible y ambos tienen buena precisión. Lo demás
 * queda como puntos sueltos, sin línea.
 */
export function tramosConEvidencia(
  puntos: readonly PuntoRecorrido[],
  op: OpcionesTramos = TRAMOS_POR_DEFECTO,
): { tramos: [number, number][][]; sueltos: [number, number][]; cortes: number } {
  const ord = [...puntos]
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .sort((a, b) => a.ts.localeCompare(b.ts))
  const tramos: [number, number][][] = []
  const sueltos: [number, number][] = []
  let actual: [number, number][] = []
  let cortes = 0
  const preciso = (p: PuntoRecorrido) => p.precision_m === null || p.precision_m <= op.maxPrecisionM
  const cerrar = () => {
    if (actual.length >= 2) tramos.push(actual)
    else if (actual.length === 1) sueltos.push(actual[0])
    actual = []
  }
  for (let i = 0; i < ord.length; i++) {
    const p = ord[i]
    if (!preciso(p)) { cerrar(); sueltos.push([p.lat, p.lng]); continue }
    if (actual.length > 0) {
      const prev = ord[i - 1]
      const seg = (new Date(p.ts).getTime() - new Date(prev.ts).getTime()) / 1000
      const vel = seg > 0 ? distanciaM(prev, p) / seg : Infinity
      if (!preciso(prev) || seg > op.maxSegundosEntrePuntos || vel > op.maxVelocidadMs) {
        cortes++
        cerrar()
      }
    }
    actual.push([p.lat, p.lng])
  }
  cerrar()
  return { tramos, sueltos, cortes }
}

// ── Resumen del legajo ───────────────────────────────────────────────────────

export interface ResumenLegajo {
  guardiasServicio: number
  horasProgramadas: number
  guardiasConGps: number
  supervisiones: number
  enTurno: number
  fueraTurno: number
  sinCalendario: number
  objetivosDistintos: number
  conItemsObservados: number
  /** Supervisiones en turno por hora de servicio programada (null sin horas). */
  porHoraServicio: number | null
}

export function resumenLegajo(
  guardias: readonly GuardiaLegajo[],
  supervisiones: readonly SupervisionLegajo[],
): ResumenLegajo {
  const servicio = guardias.filter(g => g.cubre)
  const horas = servicio.reduce((a, g) => a + g.horas_programadas, 0)
  const enTurno = supervisiones.filter(s => situacionTurno(s) === 'en_turno').length
  return {
    guardiasServicio: servicio.length,
    horasProgramadas: Math.round(horas * 10) / 10,
    guardiasConGps: servicio.filter(g => g.gps_puntos > 0).length,
    supervisiones: supervisiones.length,
    enTurno,
    fueraTurno: supervisiones.filter(s => situacionTurno(s) === 'fuera_turno').length,
    sinCalendario: supervisiones.filter(s => situacionTurno(s) === 'sin_calendario').length,
    objetivosDistintos: new Set(supervisiones.map(s => s.objetivo_id).filter(Boolean)).size,
    conItemsObservados: supervisiones.filter(s => s.items_observados > 0).length,
    porHoraServicio: horas > 0 ? Math.round((enTurno / horas) * 100) / 100 : null,
  }
}

// ── Carga (el error de la base se propaga: nunca lista vacía silenciosa) ─────

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const numONull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
function mensaje(error: any): string {
  return error?.message ?? String(error)
}

export async function cargarLegajoSupervisores(
  db: any, supervisorId: string | null, desde: string, hasta: string,
): Promise<{ guardias: GuardiaLegajo[]; supervisiones: SupervisionLegajo[]; error: string | null }> {
  const args = { p_supervisor_id: supervisorId, p_desde: desde, p_hasta: hasta }
  const [g, s] = await Promise.all([
    db.rpc('legajo_supervisores_guardias', args),
    db.rpc('legajo_supervisores_supervisiones', args),
  ])
  const errores = [g.error && `guardias: ${mensaje(g.error)}`, s.error && `supervisiones: ${mensaje(s.error)}`].filter(Boolean)
  return {
    guardias: (g.data ?? []).map((r: any) => ({
      ...r, horas_programadas: num(r.horas_programadas), gps_puntos: num(r.gps_puntos),
      supervisiones: num(r.supervisiones), objetivos_visitados: num(r.objetivos_visitados),
    })),
    supervisiones: (s.data ?? []).map((r: any) => ({
      ...r, items_total: num(r.items_total), items_observados: num(r.items_observados), fotos: num(r.fotos),
      lat: numONull(r.lat), lng: numONull(r.lng), distancia_objetivo_m: numONull(r.distancia_objetivo_m),
      radio_m: numONull(r.radio_m),
    })),
    error: errores.length ? errores.join(' · ') : null,
  }
}

export async function cargarRecorridoGuardia(
  db: any, guardiaId: string,
): Promise<{ puntos: PuntoRecorrido[]; error: string | null }> {
  const { data, error } = await db.rpc('legajo_supervisor_recorrido', { p_guardia_id: guardiaId })
  if (error) return { puntos: [], error: mensaje(error) }
  return {
    puntos: (data ?? []).map((r: any) => ({
      ts: r.ts, lat: Number(r.lat), lng: Number(r.lng), precision_m: numONull(r.precision_m),
      tipo_punto: r.tipo_punto ?? null, estado_movimiento: r.estado_movimiento ?? null,
      supervision_id: r.supervision_id ?? null,
    })),
    error: null,
  }
}
