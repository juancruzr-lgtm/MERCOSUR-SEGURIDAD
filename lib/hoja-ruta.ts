// Hoja de ruta de cierre de turno de un supervisor — formato definitivo
// (JC, 02/11/2026, versión 3: la que hoy mandan los supervisores, con hora):
//
//   Hoja de ruta del sup. Sabino Aranda
//   29/10 · Turno 07:00 a 19:00
//   07:04 PLAZA DE LAS CIENCIAS
//      Novedad: Vig blanco sin novedad
//   07:27 SRT
//
//  · Cada visita en orden cronológico y, debajo, TODAS las novedades que el
//    supervisor escribió en ese objetivo durante esa visita (observación
//    general de la supervisión y de cada ítem del checklist), con el texto
//    original completo, sin duplicar. Una visita sin novedades va sola: la
//    hoja dice sólo lo que se sabe (nada de "los demás servicios sin
//    novedad"). Sin visitas: "Sin servicios visitados durante el turno".
//  · Visitas: supervisiones del supervisor en su guardia y permanencias GPS
//    confiables. Sin GPS, la supervisión alcanza. La hora es la llegada por GPS
//    confiable o la hora registrada de la supervisión; nunca se inventa.
//  · Nada de alertas, estadísticas, pendientes ni evaluaciones.
//  · Un solo mensaje de WhatsApp. Si no entra en el límite de Meta, NO se
//    recorta ni se divide: queda pendiente por longitud y completo en la app.
//
// Módulo puro (sin base ni red), para poder probarlo.

export interface GuardiaHR {
  id: string
  supervisor_id: string
  supervisor: string
  fecha: string          // YYYY-MM-DD, día de inicio
  inicio: string         // ISO
  fin: string            // ISO
  zona: string | null
  /** Si la cubrió en reemplazo de otro supervisor (solo se muestra en la app). */
  reemplaza_a: string | null
}

export interface SupervisionHR {
  id: string
  created_at: string
  objetivo_id: string | null
  objetivo: string | null
}

export interface NovedadHR {
  /** Para no duplicar el mismo texto vinculado a dos registros. */
  clave: string
  created_at: string
  objetivo_id: string | null
  objetivo: string | null
  /** 'Supervisión' o el ítem del checklist (solo en la app). */
  origen: string
  texto: string
}

export interface PuntoHR {
  ts: string
  precision_m: number | null
  objetivo_cercano_id: string | null
  objetivo_distancia_m: number | null
}

export interface DatosHojaRuta {
  guardia: GuardiaHR
  supervisiones: SupervisionHR[]
  novedades: NovedadHR[]
  puntos: PuntoHR[]
  /** Nombre y radio de los objetivos que aparecen (supervisiones o GPS). */
  objetivos: { id: string; nombre: string; radio_metros: number | null }[]
}

export interface VisitaHR {
  objetivo_id: string
  objetivo: string
  /** Hora de la visita: llegada por GPS confiable o, si no hay, la supervisión. */
  hora: string
  /** Salida por GPS confiable (solo en la app). */
  salida: string | null
  fuente: 'supervision_y_gps' | 'supervision' | 'gps'
}

export interface EntradaHR extends VisitaHR {
  /** Novedades escritas en ese objetivo durante esta visita, en orden. */
  novedades: NovedadHR[]
}

export interface ContenidoHojaRuta {
  guardia: GuardiaHR
  recorrido: EntradaHR[]
}

export const SIN_NOVEDADES = 'Sin novedades'
export const SIN_OBJETIVOS = 'Sin servicios visitados durante el turno'
export const PRECISION_MAX_M = 150
export const RADIO_MIN_M = 150
export const MAX_SEGUNDOS_TRAMO = 300
/** Una permanencia GPS sin supervisión cuenta como visita desde estos minutos y puntos. */
export const GPS_SOLO_MIN_MINUTOS = 5
export const GPS_SOLO_MIN_PUNTOS = 3

const ZONA = 'America/Argentina/Buenos_Aires'
export const hhmm = (iso: string): string =>
  new Intl.DateTimeFormat('es-AR', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
const ddmmaaaa = (fecha: string): string => { const [a, m, d] = fecha.split('-'); return `${d}/${m}/${a}` }
const ddmm = (fecha: string): string => ddmmaaaa(fecha).slice(0, 5)
const ms = (iso: string) => new Date(iso).getTime()

// ── GPS ──────────────────────────────────────────────────────────────────────

export function permanenciasGps(
  puntos: readonly PuntoHR[],
  radios: ReadonlyMap<string, number | null>,
): { objetivo_id: string; desde: string; hasta: string; puntos: number }[] {
  const ord = [...puntos].sort((a, b) => a.ts.localeCompare(b.ts))
  const res: { objetivo_id: string; desde: string; hasta: string; puntos: number }[] = []
  let actual: { objetivo_id: string; desde: string; hasta: string; puntos: number } | null = null
  for (const p of ord) {
    const id = p.objetivo_cercano_id
    const radio = Math.max(RADIO_MIN_M, (id && radios.get(id)) || 0)
    const cerca = !!id && (p.precision_m === null || p.precision_m <= PRECISION_MAX_M)
      && p.objetivo_distancia_m !== null && p.objetivo_distancia_m <= radio
    if (cerca && actual && actual.objetivo_id === id && (ms(p.ts) - ms(actual.hasta)) / 1000 <= MAX_SEGUNDOS_TRAMO) {
      actual.hasta = p.ts; actual.puntos++
      continue
    }
    if (actual) res.push(actual)
    actual = cerca ? { objetivo_id: id!, desde: p.ts, hasta: p.ts, puntos: 1 } : null
  }
  if (actual) res.push(actual)
  return res
}

// ── Recorrido ────────────────────────────────────────────────────────────────

export function armarVisitas(d: DatosHojaRuta): VisitaHR[] {
  const nombres = new Map(d.objetivos.map(o => [o.id, o.nombre] as const))
  const radios = new Map(d.objetivos.map(o => [o.id, o.radio_metros] as const))
  const estadias = permanenciasGps(d.puntos, radios)
  const usadas = new Set<number>()
  const visitas: VisitaHR[] = []

  // 1) Supervisiones (consecutivas en el mismo objetivo = una visita).
  const sups = d.supervisiones.filter(s => s.objetivo_id).sort((a, b) => a.created_at.localeCompare(b.created_at))
  for (const s of sups) {
    const ultima = visitas[visitas.length - 1]
    if (ultima && ultima.objetivo_id === s.objetivo_id) continue
    const t = ms(s.created_at)
    const i = estadias.findIndex(e => e.objetivo_id === s.objetivo_id && e.puntos >= 2
      && ms(e.desde) - 15 * 60000 <= t && t <= ms(e.hasta) + 15 * 60000)
    const est = i >= 0 ? estadias[i] : null
    if (i >= 0) usadas.add(i)
    visitas.push({
      objetivo_id: s.objetivo_id!,
      objetivo: s.objetivo ?? nombres.get(s.objetivo_id!) ?? 'Objetivo sin nombre',
      hora: est && est.desde < s.created_at ? est.desde : s.created_at,
      salida: est ? (est.hasta > s.created_at ? est.hasta : s.created_at) : null,
      fuente: est ? 'supervision_y_gps' : 'supervision',
    })
  }

  // 2) Permanencias GPS sin supervisión: visita con evidencia de GPS.
  estadias.forEach((e, i) => {
    if (usadas.has(i)) return
    if (e.puntos < GPS_SOLO_MIN_PUNTOS || ms(e.hasta) - ms(e.desde) < GPS_SOLO_MIN_MINUTOS * 60000) return
    if (!nombres.has(e.objetivo_id)) return
    // Si ya hay una visita a ese objetivo dentro de la misma hora, es la misma.
    if (visitas.some(v => v.objetivo_id === e.objetivo_id && Math.abs(ms(v.hora) - ms(e.desde)) <= 60 * 60000)) return
    visitas.push({ objetivo_id: e.objetivo_id, objetivo: nombres.get(e.objetivo_id)!, hora: e.desde, salida: e.hasta, fuente: 'gps' })
  })

  return visitas.sort((a, b) => a.hora.localeCompare(b.hora))
}

/**
 * Pone cada novedad debajo de su visita: la última visita a ese objetivo que
 * empezó antes de la novedad (o la primera, si la novedad es anterior por
 * segundos a la llegada GPS). Textual, cronológica y sin duplicar. Una novedad
 * de un objetivo sin visita (supervisión sin objetivo) genera su propia entrada
 * con la hora de la supervisión: no se pierde ninguna.
 */
export function asignarNovedades(visitas: readonly VisitaHR[], novedades: readonly NovedadHR[]): EntradaHR[] {
  const entradas: EntradaHR[] = visitas.map(v => ({ ...v, novedades: [] }))
  const vistas = new Set<string>()
  for (const n of [...novedades].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (!n.texto || n.texto.trim().length === 0 || vistas.has(n.clave)) continue
    vistas.add(n.clave)
    const mismas = entradas.filter(e => n.objetivo_id && e.objetivo_id === n.objetivo_id)
    const destino = [...mismas].reverse().find(e => e.hora <= n.created_at) ?? mismas[0]
    if (destino) { destino.novedades.push(n); continue }
    entradas.push({ objetivo_id: n.objetivo_id ?? '', objetivo: n.objetivo ?? 'Objetivo no registrado', hora: n.created_at,
      salida: null, fuente: 'supervision', novedades: [n] })
  }
  return entradas.sort((a, b) => a.hora.localeCompare(b.hora))
}

export function armarHojaRuta(d: DatosHojaRuta): ContenidoHojaRuta {
  return { guardia: d.guardia, recorrido: asignarNovedades(armarVisitas(d), d.novedades) }
}

// ── Texto ────────────────────────────────────────────────────────────────────

const turno = (g: GuardiaHR) => `${hhmm(g.inicio)} a ${hhmm(g.fin)}`

/** Texto para la app, con el formato pedido y saltos de línea reales. */
export function textoHojaRuta(c: ContenidoHojaRuta): string {
  const l: string[] = [`Hoja de ruta del sup. ${c.guardia.supervisor}${c.guardia.reemplaza_a ? ` (en reemplazo de ${c.guardia.reemplaza_a})` : ''}`]
  l.push(`${ddmm(c.guardia.fecha)} · Turno ${turno(c.guardia)}`)
  if (c.recorrido.length === 0) l.push(SIN_OBJETIVOS)
  for (const e of c.recorrido) {
    l.push(`${hhmm(e.hora)} ${e.objetivo}`)
    for (const n of e.novedades) l.push(`   Novedad: ${n.texto}`)
  }
  return l.join('\n')
}

// ── WhatsApp: UN mensaje ─────────────────────────────────────────────────────
// Para escribir primero hace falta una plantilla aprobada. Reglas de Meta:
//  · el cuerpo de la plantilla, YA con las variables reemplazadas, no puede
//    superar 1024 caracteres (si no, Meta rechaza el envío);
//  · una variable no puede tener saltos de línea, tabs ni más de 4 espacios
//    seguidos.
// Plantilla mínima: solo los rótulos pedidos y 4 variables. El recorrido va
// en {{4}} en una sola línea: cada visita "hora — objetivo: novedad" separada
// por " | ", y varias novedades del mismo objetivo separadas por " · ". Un
// salto de línea DENTRO de una novedad viaja como espacio. El texto original
// queda intacto en la app.

export const PLANTILLA_HOJA_RUTA = 'hoja_ruta_supervisor'
export const LIMITE_CUERPO_PLANTILLA = 1024
/** Cuerpo de la plantilla tal como se aprueba en Meta (42 caracteres fijos). */
export const CUERPO_PLANTILLA = 'HOJA DE RUTA\nFecha: {{1}}\nTurno: {{2}}\nSupervisor: {{3}}\n{{4}}'

const enUnaLinea = (s: string) => s.replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim()

export function variablesMensaje(c: ContenidoHojaRuta): string[] {
  const recorrido = c.recorrido.length === 0
    ? SIN_OBJETIVOS
    : c.recorrido.map(e => `${hhmm(e.hora)} — ${e.objetivo}: ${e.novedades.length === 0 ? SIN_NOVEDADES : e.novedades.map(n => enUnaLinea(n.texto)).join(' · ')}`).join(' | ')
  return [ddmmaaaa(c.guardia.fecha), turno(c.guardia), c.guardia.supervisor, recorrido].map(enUnaLinea)
}

export const renderizarPlantilla = (vars: readonly string[]): string =>
  CUERPO_PLANTILLA.replace(/\{\{(\d)\}\}/g, (_, n) => vars[Number(n) - 1] ?? '')

export interface MensajeHojaRuta {
  variables: string[]
  mensaje: string
  longitud: number
  bloqueado: 'excede_longitud' | null
}

export function mensajeWhatsApp(c: ContenidoHojaRuta, limite = LIMITE_CUERPO_PLANTILLA): MensajeHojaRuta {
  const variables = variablesMensaje(c)
  const mensaje = renderizarPlantilla(variables)
  const longitud = Array.from(mensaje).length
  return { variables, mensaje, longitud, bloqueado: longitud > limite ? 'excede_longitud' : null }
}

// ── A quién y cuántas veces ─────────────────────────────────────────────────

export type ModoHojaRuta = 'desactivado' | 'prueba' | 'automatico'
export const MAX_INTENTOS = 3

export const leerModo = (v: string | null | undefined): ModoHojaRuta =>
  v === 'prueba' || v === 'automatico' ? v : 'desactivado'

export interface EnvioPrevio { destinatario_id: string; estado: string; intento: number }

/**
 * Envíos que corresponden ahora para una hoja: a lo sumo UNO por destinatario.
 *  · enviado → nada más.
 *  · enviando / incierto → nada: pudo haber salido; no se arriesga un repetido.
 *  · error / sin_telefono → nuevo intento, hasta MAX_INTENTOS.
 * Desactivado o mensaje bloqueado por longitud: nadie. Prueba: solo el autorizado.
 */
export function planEnvios(
  modo: ModoHojaRuta,
  destinatarios: readonly string[],
  destinatarioPrueba: string | null,
  previos: readonly EnvioPrevio[],
  bloqueado: string | null = null,
): { destinatario_id: string; intento: number }[] {
  if (modo === 'desactivado' || bloqueado) return []
  const lista = modo === 'prueba' ? (destinatarioPrueba ? [destinatarioPrueba] : []) : Array.from(new Set(destinatarios))
  const res: { destinatario_id: string; intento: number }[] = []
  for (const id of lista) {
    const mios = previos.filter(p => p.destinatario_id === id)
    if (mios.some(p => ['enviado', 'enviando', 'incierto'].includes(p.estado))) continue
    const ultimo = mios.reduce((m, p) => Math.max(m, p.intento), 0)
    if (ultimo >= MAX_INTENTOS) continue
    res.push({ destinatario_id: id, intento: ultimo + 1 })
  }
  return res
}

/** La guardia terminó hace al menos el margen de cierre (y no hace demasiado). */
export function listaParaGenerar(finIso: string, ahoraMs: number, margenMin: number, ventanaHoras = 8): boolean {
  const fin = ms(finIso)
  return fin + margenMin * 60_000 <= ahoraMs && fin >= ahoraMs - ventanaHoras * 3_600_000
}

/** Supervisores con supervisiones fuera de toda guardia registrada (no se les genera hoja). */
export function actividadSinGuardia(
  supervisiones: readonly { supervisor_id: string; created_at: string }[],
  guardias: readonly { supervisor_id: string; inicio: string; fin: string }[],
): string[] {
  const sin = new Set<string>()
  for (const s of supervisiones) {
    const t = ms(s.created_at)
    if (!guardias.some(g => g.supervisor_id === s.supervisor_id && ms(g.inicio) <= t && t <= ms(g.fin))) sin.add(s.supervisor_id)
  }
  return Array.from(sin)
}
