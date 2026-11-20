/**
 * lib/control-preventivo.ts
 *
 * Control operativo PREVENTIVO: lo que conviene mirar ANTES de que se
 * convierta en un problema. Tres lecturas, todas para decisión humana:
 *
 *   4.1 Objetivos sin supervisión — vencidos según la frecuencia de CADA
 *       objetivo (lib/supervisiones, definición única), con responsable de
 *       zona y nivel de escalamiento: pasado 2× la frecuencia sin visita, el
 *       caso es del jefe de supervisores.
 *   4.2 Puestos sin cubrir — turnos de las próximas 48 h sin vigilador
 *       asignado o con el asignado ausente CONFIRMADO (novedades_laborales
 *       aprobada). No se mezcla con «sin fichaje»: un turno futuro no puede
 *       estar sin fichar, y un sin-fichaje no es una ausencia confirmada.
 *   4.3 Rondas incompletas — clasificación SUGERIDA (evidencia pendiente /
 *       conectividad / error GPS / incumplimiento). Nunca sanciona: ordena la
 *       revisión.
 *
 * Funciones puras: no leen la base ni envían nada. Los interruptores también
 * viven acá y nacen APAGADOS.
 */

import {
  estadoSupervision,
  exigibilidadSupervision,
  frecuenciaSupervision,
  type ContextoExigibilidad,
  type ObjetivoServicio,
} from '@/lib/supervisiones'

const MS_HORA = 3_600_000

// ── Interruptores (todo APAGADO por defecto) ─────────────────────────────────

/**
 * Tarjeta de Control preventivo en el Panel Principal. Oculta salvo
 * NEXT_PUBLIC_CONTROL_PREVENTIVO === '1'. Lectura LITERAL de process.env: Next
 * sólo la reemplaza en el bundle del navegador si aparece escrita así.
 */
export function controlPreventivoVisible(valor: string | undefined = process.env.NEXT_PUBLIC_CONTROL_PREVENTIVO): boolean {
  return valor === '1'
}

/**
 * Push de escalamiento al jefe de supervisores por supervisión vencida > 2×
 * frecuencia. Variable de SERVIDOR (no NEXT_PUBLIC): sólo la lee el cron de
 * push. Apagado salvo PUSH_ESCALAMIENTO_SUPERVISION_JEFE === '1'.
 */
export function escalamientoSupervisionJefeHabilitado(valor: string | undefined = process.env.PUSH_ESCALAMIENTO_SUPERVISION_JEFE): boolean {
  return valor === '1'
}

// ── 4.1 Objetivos sin supervisión ───────────────────────────────────────────

/** Pasadas tantas frecuencias desde la última visita, escala al jefe. */
export const FACTOR_ESCALAMIENTO_JEFE = 2

export type NivelEscalamiento = 'supervisor' | 'jefe_supervisores'

export const ETIQUETA_NIVEL: Record<NivelEscalamiento, string> = {
  supervisor: 'Supervisor de zona',
  jefe_supervisores: 'Jefe de supervisores',
}

/**
 * Nivel de escalamiento de un objetivo, o null si está vigente.
 *
 *   vigente                              → null
 *   vencido, desde la última ≤ 2× frec.  → supervisor de la zona
 *   vencido, desde la última  > 2× frec. → jefe de supervisores
 *   nunca supervisado                    → jefe de supervisores (no hay ciclo
 *                                          que esperar: ya se perdió el primero)
 */
export function nivelEscalamientoSupervision(
  ultimaIso: string | null | undefined,
  frecuenciaHoras: number,
  ahoraMs: number = Date.now(),
): NivelEscalamiento | null {
  const estado = estadoSupervision(ultimaIso, frecuenciaHoras, ahoraMs)
  if (estado === 'vigente') return null
  if (estado === 'nunca') return 'jefe_supervisores'
  const horasDesde = (ahoraMs - new Date(ultimaIso as string).getTime()) / MS_HORA
  return horasDesde > frecuenciaHoras * FACTOR_ESCALAMIENTO_JEFE ? 'jefe_supervisores' : 'supervisor'
}

/** Prefijo de `notificaciones_enviadas.tipo` para el escalamiento al jefe. */
export const PREFIJO_AVISO_SUPERVISION_JEFE = 'preventivo_supervision_jefe'

/**
 * Clave de deduplicación: UNA vez por objetivo por período de vencimiento. El
 * período lo identifica la última supervisión conocida: cuando se registra una
 * nueva, la clave cambia y el próximo vencimiento puede volver a avisarse.
 */
export function claveAvisoSupervision(nivel: NivelEscalamiento, objetivoId: string, ultimaIso: string | null | undefined): string {
  const prefijo = nivel === 'jefe_supervisores' ? PREFIJO_AVISO_SUPERVISION_JEFE : 'preventivo_supervision_supervisor'
  return `${prefijo}:${objetivoId}:${ultimaIso || 'nunca'}`
}

export type ObjetivoParaControl = ObjetivoServicio & {
  nombre?: string | null
  zona_id?: string | null
  estado?: string | null
  es_prueba?: boolean | null
}

export interface ObjetivoSinSupervision {
  objetivo_id: string
  nombre: string
  zona_id: string | null
  frecuenciaHoras: number
  ultimaIso: string | null
  /** Horas desde la última visita; null si nunca se supervisó. */
  horasDesdeUltima: number | null
  /** Horas de atraso sobre la frecuencia; null si nunca se supervisó. */
  horasVencida: number | null
  nivel: NivelEscalamiento
  motivo: 'nunca' | 'vencida'
  claveDedup: string
}

/**
 * Objetivos activos, no de prueba y que EXIGEN supervisión (mismo criterio que
 * el panel y el push) cuya supervisión está vencida o nunca existió.
 * Orden: jefe primero; dentro de cada nivel, el más atrasado primero.
 */
export function objetivosSinSupervision(p: {
  objetivos: ObjetivoParaControl[]
  ultimaPorObjetivo: ReadonlyMap<string, string>
  contexto: ContextoExigibilidad
  ahoraMs?: number
}): ObjetivoSinSupervision[] {
  const ahoraMs = p.ahoraMs ?? Date.now()
  const salida: ObjetivoSinSupervision[] = []
  for (const o of p.objetivos) {
    if ((o.estado || 'activo') !== 'activo' || o.es_prueba) continue
    if (!exigibilidadSupervision(o, p.contexto, new Date(ahoraMs)).exige) continue
    const frecuenciaHoras = frecuenciaSupervision(o)
    const ultimaIso = p.ultimaPorObjetivo.get(o.id) ?? null
    const nivel = nivelEscalamientoSupervision(ultimaIso, frecuenciaHoras, ahoraMs)
    if (!nivel) continue
    const ultimaMs = ultimaIso ? new Date(ultimaIso).getTime() : NaN
    const horasDesdeUltima = Number.isFinite(ultimaMs) ? (ahoraMs - ultimaMs) / MS_HORA : null
    salida.push({
      objetivo_id: o.id,
      nombre: o.nombre || 'Objetivo sin nombre',
      zona_id: o.zona_id ?? null,
      frecuenciaHoras,
      ultimaIso,
      horasDesdeUltima,
      horasVencida: horasDesdeUltima === null ? null : horasDesdeUltima - frecuenciaHoras,
      nivel,
      motivo: horasDesdeUltima === null ? 'nunca' : 'vencida',
      claveDedup: claveAvisoSupervision(nivel, o.id, ultimaIso),
    })
  }
  const peso = (x: ObjetivoSinSupervision) => (x.horasVencida === null ? Number.POSITIVE_INFINITY : x.horasVencida)
  return salida.sort((a, b) => {
    if (a.nivel !== b.nivel) return a.nivel === 'jefe_supervisores' ? -1 : 1
    return peso(b) - peso(a)
  })
}

export interface AvisoSupervisionJefe {
  objetivo_id: string
  clave: string
  usuarios: string[]
  titulo: string
  cuerpo: string
}

/** "3 d 4 h" — atraso legible. */
export function horasLegibles(horas: number): string {
  const h = Math.floor(Math.max(0, horas))
  if (h < 24) return `${h} h`
  const d = Math.floor(h / 24)
  const resto = h % 24
  return resto === 0 ? `${d} d` : `${d} d ${resto} h`
}

/**
 * Arma (no envía) los avisos de escalamiento al jefe de supervisores.
 *
 * - Sólo nivel jefe: el aviso al supervisor de zona YA lo manda el cron de
 *   push (`supervisor_supervision_vencida:<ciclo>`), no se duplica.
 * - Deduplicado por clave (objetivo + período de vencimiento): lo ya enviado
 *   no se rearma, y un objetivo repetido en la entrada sale una sola vez.
 * - Sin jefes en la lista de escalamiento no se arma nada (se cuenta aparte):
 *   no se cae a "todos" para no generar un envío masivo.
 */
export function armarAvisosSupervisionJefe(p: {
  items: ObjetivoSinSupervision[]
  jefes: string[]
  yaEnviadas: ReadonlySet<string>
  zonaNombre?: (zonaId: string | null) => string
}): { avisos: AvisoSupervisionJefe[]; yaAvisados: number; sinJefe: number } {
  const jefes = Array.from(new Set(p.jefes.filter(Boolean)))
  const vistos = new Set<string>()
  const avisos: AvisoSupervisionJefe[] = []
  let yaAvisados = 0
  let sinJefe = 0
  for (const it of p.items) {
    if (it.nivel !== 'jefe_supervisores') continue
    if (vistos.has(it.claveDedup)) continue
    vistos.add(it.claveDedup)
    if (p.yaEnviadas.has(it.claveDedup)) { yaAvisados += 1; continue }
    if (jefes.length === 0) { sinJefe += 1; continue }
    const zona = p.zonaNombre ? p.zonaNombre(it.zona_id) : ''
    const detalle = it.horasDesdeUltima === null
      ? 'Sin supervisión registrada'
      : `Sin supervisión hace ${horasLegibles(it.horasDesdeUltima)} (frecuencia ${it.frecuenciaHoras} h)`
    avisos.push({
      objetivo_id: it.objetivo_id,
      clave: it.claveDedup,
      usuarios: jefes,
      titulo: 'Supervisión vencida — escalada',
      cuerpo: `Objetivo: ${it.nombre}${zona ? ` · Zona: ${zona}` : ''} · ${detalle}`,
    })
  }
  return { avisos, yaAvisados, sinJefe }
}

/** Jefes activos de la lista de escalamiento (rol_en_escalamiento). */
export function jefesDeEscalamiento(
  lista: Array<{ usuario_id: string; rol_en_escalamiento?: string | null; activo?: boolean | null }>,
): string[] {
  return Array.from(new Set(
    lista.filter(x => x.activo !== false && x.rol_en_escalamiento === 'jefe_supervisores').map(x => x.usuario_id),
  ))
}

// ── 4.2 Puestos sin cubrir ──────────────────────────────────────────────────

export const HORIZONTE_PUESTOS_HORAS = 48

/** Estados de turno que NO generan obligación de cobertura. */
const ESTADOS_SIN_SERVICIO = new Set(['anulado', 'cancelado', 'reemplazado'])

/**
 * Tipos de novedad laboral que significan "esa persona no va a estar".
 * `otra` y los ajustes NO: tratarlos como ausencia sería adivinar.
 */
export const TIPOS_AUSENCIA_CONFIRMADA = [
  'parte_medico', 'accidente', 'licencia', 'vacaciones', 'falta_justificada',
  'falta_injustificada', 'dia_estudio', 'suspension', 'franco',
] as const

export interface TurnoProximo {
  id: string
  objetivo_id: string
  puesto_id?: string | null
  fecha: string
  hora_inicio: string
  hora_fin?: string | null
  estado?: string | null
  guardia_id?: string | null
}

export interface NovedadAusencia {
  empleado_id: string
  tipo: string
  fecha_desde: string
  fecha_hasta: string
  estado: string
}

export type MotivoSinCubrir = 'sin_asignar' | 'ausencia_confirmada' | 'estado_descubierto'

export const ETIQUETA_MOTIVO_SIN_CUBRIR: Record<MotivoSinCubrir, string> = {
  sin_asignar: 'Sin vigilador asignado',
  ausencia_confirmada: 'Asignado con ausencia confirmada',
  estado_descubierto: 'Marcado como descubierto',
}

export interface PuestoSinCubrir {
  clave: string
  turnos_ids: string[]
  /** Cuántos turnos sin cubrir comparten objetivo, puesto y horario. */
  cantidad: number
  objetivo_id: string
  puesto_id: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string | null
  inicioMs: number
  horasParaInicio: number
  franja: 'menos_24h' | '24_48h'
  motivo: MotivoSinCubrir
  guardia_id: string | null
  novedadTipo: string | null
}

/** Instante de inicio del turno (hora argentina, UTC−3 sin horario de verano). */
export function inicioTurnoMs(fecha: string, hora: string): number {
  return Date.parse(`${fecha}T${(hora || '00:00').slice(0, 5)}:00-03:00`)
}

export function ausenciaConfirmada(
  novedades: NovedadAusencia[], empleadoId: string, fecha: string,
): NovedadAusencia | null {
  const tipos: readonly string[] = TIPOS_AUSENCIA_CONFIRMADA
  return novedades.find(n =>
    n.estado === 'aprobada'
    && n.empleado_id === empleadoId
    && n.fecha_desde <= fecha && fecha <= n.fecha_hasta
    && tipos.includes(n.tipo),
  ) ?? null
}

/**
 * Turnos que EMPIEZAN dentro del horizonte (por defecto, las próximas 48 h) y
 * no tienen quién los cubra. Los que ya empezaron quedan fuera a propósito:
 * esos son «descubierto» / «sin fichar» de Atención operativa, otra pregunta.
 *
 * Deduplicado: un turno aparece una vez aunque venga repetido, y los turnos
 * sin cubrir del mismo objetivo + puesto + horario se agrupan con `cantidad`.
 * Un turno cubierto NUNCA esconde a uno sin cubrir del mismo horario.
 */
export function puestosSinCubrir(p: {
  turnos: TurnoProximo[]
  novedades: NovedadAusencia[]
  ahoraMs?: number
  horizonteHoras?: number
  objetivosExcluidos?: ReadonlySet<string>
}): PuestoSinCubrir[] {
  const ahoraMs = p.ahoraMs ?? Date.now()
  const limiteMs = ahoraMs + (p.horizonteHoras ?? HORIZONTE_PUESTOS_HORAS) * MS_HORA
  const vistos = new Set<string>()
  const grupos = new Map<string, PuestoSinCubrir>()

  for (const t of p.turnos) {
    if (vistos.has(t.id)) continue
    vistos.add(t.id)
    if (ESTADOS_SIN_SERVICIO.has(t.estado || '')) continue
    if (p.objetivosExcluidos?.has(t.objetivo_id)) continue
    const inicio = inicioTurnoMs(t.fecha, t.hora_inicio)
    if (!Number.isFinite(inicio) || inicio <= ahoraMs || inicio > limiteMs) continue

    let motivo: MotivoSinCubrir | null = null
    let novedadTipo: string | null = null
    if (!t.guardia_id) motivo = 'sin_asignar'
    else {
      const aus = ausenciaConfirmada(p.novedades, t.guardia_id, t.fecha)
      if (aus) { motivo = 'ausencia_confirmada'; novedadTipo = aus.tipo }
      else if (t.estado === 'descubierto') motivo = 'estado_descubierto'
    }
    if (!motivo) continue

    const hi = t.hora_inicio.slice(0, 5)
    const hf = t.hora_fin ? t.hora_fin.slice(0, 5) : null
    const clave = `${t.objetivo_id}|${t.puesto_id || ''}|${t.fecha}|${hi}|${hf || ''}|${motivo}`
    const existente = grupos.get(clave)
    if (existente) {
      existente.turnos_ids.push(t.id)
      existente.cantidad += 1
      continue
    }
    const horasParaInicio = (inicio - ahoraMs) / MS_HORA
    grupos.set(clave, {
      clave,
      turnos_ids: [t.id],
      cantidad: 1,
      objetivo_id: t.objetivo_id,
      puesto_id: t.puesto_id ?? null,
      fecha: t.fecha,
      hora_inicio: hi,
      hora_fin: hf,
      inicioMs: inicio,
      horasParaInicio,
      franja: horasParaInicio <= 24 ? 'menos_24h' : '24_48h',
      motivo,
      guardia_id: t.guardia_id ?? null,
      novedadTipo,
    })
  }
  return Array.from(grupos.values()).sort((a, b) => a.inicioMs - b.inicioMs)
}

// ── 4.3 Rondas incompletas ──────────────────────────────────────────────────

export type ClaseRonda = 'evidencia_pendiente' | 'conectividad' | 'error_gps' | 'incumplimiento'

export const ETIQUETA_CLASE_RONDA: Record<ClaseRonda, string> = {
  evidencia_pendiente: 'Evidencia pendiente de sincronizar/validar',
  conectividad: 'Problema de conectividad',
  error_gps: 'Posible error de GPS',
  incumplimiento: 'Posible incumplimiento',
}

/** Precisión (m) a partir de la cual una lectura GPS no alcanza para afirmar nada. */
export const UMBRAL_PRECISION_GPS_M = 50
/** Margen alrededor de la ronda para atribuirle un evento de red del vigilador. */
export const MARGEN_EVENTO_RED_MS = 10 * 60_000

export interface EjecucionRonda {
  id: string
  objetivo_id: string
  guardia_id: string | null
  fecha_operativa: string
  iniciada_at: string | null
  finalizada_at: string | null
  estado: string | null
  resultado: string | null
  puntos_total: number | null
  snap_ronda_nombre?: string | null
}

export interface PuntoEjecucion {
  id: string
  ronda_ejecucion_id: string
  estado: string | null
  registrado_at: string | null
  gps_ok: boolean | null
  dentro_radio: boolean | null
  foto_ok: boolean | null
  snap_foto_requerida?: boolean | null
  precision_metros: number | null
  distancia_metros: number | null
  snap_radio_metros: number | null
}

export interface EventoRed {
  user_id: string | null
  created_at: string
  ejecucion_punto_id?: string | null
}

/**
 * Un punto NO cumplido cuya lectura GPS no permite afirmar que la persona no
 * estuvo: sin GPS, con precisión peor que el umbral o que el propio radio, o
 * con el círculo de incertidumbre tocando el radio del punto.
 */
export function puntoConGpsDudoso(pt: PuntoEjecucion): boolean {
  if (pt.gps_ok === false) return true
  const prec = pt.precision_metros
  const radio = pt.snap_radio_metros ?? 0
  if (prec === null || prec === undefined) return false
  if (prec >= UMBRAL_PRECISION_GPS_M || (radio > 0 && prec >= radio)) return true
  const dist = pt.distancia_metros
  return dist !== null && dist !== undefined && radio > 0 && dist - prec <= radio
}

export interface ClasificacionRonda {
  ejecucion_id: string
  sugerida: ClaseRonda
  senales: {
    puntosTotal: number
    puntosRegistrados: number
    puntosFaltantes: number
    incumplidos: number
    incumplidosGpsDudoso: number
    pendientes: number
    eventosRed: number
  }
}

/**
 * Clasificación SUGERIDA de una ronda que no terminó completa. Prioridad:
 *
 *   1. evidencia_pendiente — hay puntos o resultado `pendiente_validacion`
 *      (foto en cola / sin validar): todavía no se puede juzgar.
 *   2. conectividad — faltan puntos o hay incumplidos Y el vigilador tuvo
 *      errores de red (`ronda_red_error`) durante la ronda.
 *   3. error_gps — todos los incumplidos tienen lectura GPS dudosa.
 *   4. incumplimiento — lo demás. Sigue siendo una SUGERENCIA para revisar.
 */
export function clasificarRonda(
  ej: EjecucionRonda,
  puntos: PuntoEjecucion[],
  eventos: EventoRed[],
): ClasificacionRonda {
  const propios = puntos.filter(pt => pt.ronda_ejecucion_id === ej.id)
  const idsPuntos = new Set(propios.map(pt => pt.id))
  const registrados = propios.filter(pt => pt.registrado_at).length
  const total = Math.max(ej.puntos_total ?? 0, propios.length)
  const faltantes = Math.max(0, total - registrados)
  const incumplidos = propios.filter(pt => pt.estado === 'incumplido')
  const dudosos = incumplidos.filter(puntoConGpsDudoso).length
  const pendientes = propios.filter(pt =>
    pt.estado === 'pendiente_validacion'
    || (pt.registrado_at && pt.snap_foto_requerida && pt.foto_ok === null && pt.estado !== 'cumplido'),
  ).length

  const desde = ej.iniciada_at ? new Date(ej.iniciada_at).getTime() - MARGEN_EVENTO_RED_MS : NaN
  const hastaBase = ej.finalizada_at || ej.iniciada_at
  const hasta = hastaBase ? new Date(hastaBase).getTime() + MARGEN_EVENTO_RED_MS : NaN
  const eventosRed = eventos.filter(ev => {
    if (ev.ejecucion_punto_id && idsPuntos.has(ev.ejecucion_punto_id)) return true
    if (!ej.guardia_id || ev.user_id !== ej.guardia_id) return false
    const t = new Date(ev.created_at).getTime()
    return Number.isFinite(desde) && Number.isFinite(hasta) && t >= desde && t <= hasta
  }).length

  let sugerida: ClaseRonda
  if (pendientes > 0 || ej.resultado === 'pendiente_validacion') sugerida = 'evidencia_pendiente'
  else if (eventosRed > 0 && (faltantes > 0 || incumplidos.length > 0)) sugerida = 'conectividad'
  else if (incumplidos.length > 0 && dudosos === incumplidos.length) sugerida = 'error_gps'
  else sugerida = 'incumplimiento'

  return {
    ejecucion_id: ej.id,
    sugerida,
    senales: {
      puntosTotal: total,
      puntosRegistrados: registrados,
      puntosFaltantes: faltantes,
      incumplidos: incumplidos.length,
      incumplidosGpsDudoso: dudosos,
      pendientes,
      eventosRed,
    },
  }
}

/** Rondas que piden revisión: finalizadas sin resultado `completa`. */
export function rondaRequiereRevision(ej: EjecucionRonda): boolean {
  return ej.estado === 'finalizada' && ej.resultado !== 'completa'
}

export function resumirClasificacion(cs: ClasificacionRonda[]): Record<ClaseRonda, number> {
  const r: Record<ClaseRonda, number> = { evidencia_pendiente: 0, conectividad: 0, error_gps: 0, incumplimiento: 0 }
  for (const c of cs) r[c.sugerida] += 1
  return r
}
