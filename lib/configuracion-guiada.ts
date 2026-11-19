/**
 * lib/configuracion-guiada.ts
 *
 * Alta automática de protocolos y rondas (diseño aprobado por Gerencia,
 * 19/11/2026 · docs/gestion-empresarial/configuracion-guiada.md).
 *
 *  1. Protocolo: el supervisor de la zona completa un formulario guiado; el
 *     texto se arma SÓLO con lo que escribió y se envía a aprobación. Lo
 *     aprueba Jefe de supervisores, Director técnico o Gerencia
 *     (protocolo_hacer_vigente, ya existente) y le llega al vigilador.
 *  2. Ronda: el vigilador de turno marca dos extremos del puesto. Si los
 *     puntos son válidos, la ronda queda ACTIVA en ese momento (sin espera ni
 *     período de prueba). La primera ventana exigible es la siguiente ventana
 *     completa del turno: nunca se exige nada anterior a la activación.
 *  3. Aviso a Gerencia, Director técnico, Jefe de supervisores y supervisor
 *     de la zona.
 *
 * Las mismas validaciones se repiten en el servidor (migración 20261218120000).
 */

export const RONDA_GUIADA = {
  /** Frecuencia inicial si el objetivo no tiene una propia. */
  frecuenciaPorDefectoMinutos: 120,
  /** Peor precisión GPS admitida para marcar un punto. */
  precisionMaximaMetros: 30,
  /** Margen sobre el radio del objetivo para considerar un punto "dentro". */
  toleranciaAreaMetros: 25,
  /** Radio del objetivo si no tiene uno cargado. */
  radioObjetivoPorDefecto: 100,
  /** Radio mínimo de cada punto de control al crearse. */
  radioPuntoMinimoMetros: 25,
  /** Intentos fallidos de GPS antes de ofrecer pasárselo al supervisor. */
  intentosAntesDeDerivar: 3,
} as const

export interface PuntoGps { lat: number; lng: number; precision: number }
export interface ObjetivoArea { lat: number | null; lng: number | null; radio_metros: number | null }

/** Distancia en metros (haversine). */
export function distanciaMetros(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000
  const rad = (x: number) => (x * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Separación mínima para distinguir dos puntos: la suma de sus precisiones. */
export function separacionMinima(a: PuntoGps, b: PuntoGps): number {
  return Math.max(1, a.precision + b.precision)
}

/** Radio del área del objetivo para un punto: radio cargado + precisión + tolerancia. */
export function radioArea(o: ObjetivoArea, precision: number): number {
  return (o.radio_metros && o.radio_metros > 0 ? o.radio_metros : RONDA_GUIADA.radioObjetivoPorDefecto) + precision + RONDA_GUIADA.toleranciaAreaMetros
}

export type ProblemaPunto =
  | { tipo: 'sin_gps' }
  | { tipo: 'impreciso'; precision: number }
  | { tipo: 'fuera_del_objetivo'; distancia: number }
  | { tipo: 'indistinguible'; distancia: number; minimo: number }

/** Valida un punto (y, si es el segundo, que se distinga del primero). null = válido. */
export function validarPunto(p: PuntoGps | null, objetivo: ObjetivoArea | null, primero?: PuntoGps | null): ProblemaPunto | null {
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng) || !Number.isFinite(p.precision)) return { tipo: 'sin_gps' }
  if (p.precision > RONDA_GUIADA.precisionMaximaMetros) return { tipo: 'impreciso', precision: Math.round(p.precision) }
  if (objetivo && objetivo.lat != null && objetivo.lng != null) {
    const d = distanciaMetros(p, { lat: objetivo.lat, lng: objetivo.lng })
    if (d > radioArea(objetivo, p.precision)) return { tipo: 'fuera_del_objetivo', distancia: Math.round(d) }
  }
  if (primero) {
    const d = distanciaMetros(p, primero)
    const min = separacionMinima(primero, p)
    if (d <= min) return { tipo: 'indistinguible', distancia: Math.round(d), minimo: Math.round(min) }
  }
  return null
}

export function textoProblema(p: ProblemaPunto): string {
  switch (p.tipo) {
    case 'sin_gps': return 'No se pudo leer la ubicación. Activá el GPS del celular y probá de nuevo.'
    case 'impreciso': return `Tu ubicación es poco precisa (±${p.precision} m). Salí a un lugar abierto, lejos de techos y paredes, y esperá unos segundos.`
    case 'fuera_del_objetivo': return 'Este punto queda fuera del área del objetivo. Los puntos tienen que estar dentro del predio que controlás.'
    case 'indistinguible': return `Este punto está a ${p.distancia} m del primero y con esta precisión hacen falta más de ${p.minimo} m para distinguirlos. Caminá hasta el otro extremo del puesto.`
  }
}

/** Radio del punto de control: al menos 25 m, o el doble de la precisión con que se marcó. */
export function radioPunto(precision: number): number {
  return Math.max(RONDA_GUIADA.radioPuntoMinimoMetros, Math.ceil(precision * 2))
}

// ── Problemas que el vigilador puede informar ──────────────────────────────

export const MOTIVOS_PROBLEMA = {
  cerrado: 'Está cerrado con llave',
  no_puede_dejar_puesto: 'No puedo dejar el ingreso solo',
  peligro_obra: 'Es peligroso o está en obra',
  gps: 'El GPS no da una ubicación precisa',
  otro: 'Otro motivo',
} as const
export type MotivoProblema = keyof typeof MOTIVOS_PROBLEMA

// ── Protocolo guiado ─────────────────────────────────────────────────────────

export interface PreguntaProtocolo { clave: string; titulo: string; ayuda: string; obligatoria: boolean }

export const PREGUNTAS_PROTOCOLO: PreguntaProtocolo[] = [
  { clave: 'horario', titulo: 'Horarios y características del servicio', ayuda: 'Turnos, días, relevos, cuántos puestos.', obligatoria: true },
  { clave: 'accesos', titulo: 'Accesos y sectores a controlar', ayuda: 'Portones, playa de camiones, perímetro, sectores sensibles.', obligatoria: true },
  { clave: 'obligaciones', titulo: 'Obligaciones del vigilador', ayuda: 'Lo que tiene que hacer en el turno.', obligatoria: true },
  { clave: 'prohibido', titulo: 'Restricciones y prohibiciones', ayuda: 'Lo que no puede hacer bajo ningún motivo.', obligatoria: true },
  { clave: 'emergencias', titulo: 'Procedimientos ante novedades y emergencias', ayuda: 'Qué hacer primero y a quién avisar.', obligatoria: true },
  { clave: 'contactos', titulo: 'Contactos y teléfonos importantes', ayuda: 'Con nombre y número.', obligatoria: true },
  { clave: 'cliente', titulo: 'Instrucciones particulares del cliente', ayuda: 'Pedidos especiales del cliente (si hay).', obligatoria: false },
]

export function faltantesProtocolo(r: Record<string, string>): string[] {
  return PREGUNTAS_PROTOCOLO.filter(p => p.obligatoria && !(r[p.clave] ?? '').trim()).map(p => p.titulo)
}

/** Arma el texto del protocolo SÓLO con lo respondido (no agrega instrucciones). */
export function armarProtocolo(objetivoNombre: string, r: Record<string, string>): { titulo: string; texto: string } {
  const partes = PREGUNTAS_PROTOCOLO
    .filter(p => (r[p.clave] ?? '').trim())
    .map((p, i) => `${i + 1}. ${p.titulo.toUpperCase()}\n${r[p.clave].trim()}`)
  return {
    titulo: `Protocolo del puesto — ${objetivoNombre}`,
    texto: [`PROTOCOLO DEL PUESTO — ${objetivoNombre.toUpperCase()}`, '', ...partes.flatMap(p => [p, ''])].join('\n').trim(),
  }
}

// ── Estados ──────────────────────────────────────────────────────────────────

export type EstadoRondaGuiada = 'esperando_puntos' | 'activa' | 'requiere_revision' | 'desactivada'

export const ETIQUETA_ESTADO_RONDA_GUIADA: Record<EstadoRondaGuiada, string> = {
  esperando_puntos: 'Esperando que el vigilador marque los puntos',
  activa: 'Activa',
  requiere_revision: 'Requiere revisión de supervisión',
  desactivada: 'Desactivada',
}

export function textoFrecuencia(minutos: number): string {
  if (minutos % 60 === 0) return minutos === 60 ? 'cada 1 hora' : `cada ${minutos / 60} horas`
  return `cada ${Math.floor(minutos / 60) ? `${Math.floor(minutos / 60)} h ` : ''}${minutos % 60} min`
}

// ── Avisos (plantillas aprobadas en Meta el 19/11/2026) ─────────────────────

const limpia = (s: string, max = 60) => { const t = s.replace(/[\n\r\t]+/g, ' ').replace(/ {4,}/g, '   ').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t }

export const PLANTILLA_RONDA_CONFIGURADA = {
  nombre: 'ronda_configurada_activa',
  cuerpo: [
    'Hola {{1}}. Se configuró una ronda nueva y ya está funcionando.',
    '',
    'Objetivo: {{2}}',
    'Configuró: {{3}} (vigilador)',
    'Fecha y hora: {{4}}',
    'Distancia entre puntos: {{5}} m',
    'Frecuencia: {{6}}',
    'Estado: RONDA ACTIVA',
    '',
    'Podés ver el mapa y, si tenés permiso, cambiar los puntos o la frecuencia desde el botón.',
  ].join('\n'),
  /** Sufijo del botón dinámico `…/dashboard?page={{1}}`. */
  boton: 'rondas',
} as const

export function variablesRondaConfigurada(p: { destinatario: string; objetivo: string; vigilador: string; activadaIso: string; distancia: number; frecuenciaMin: number }): string[] {
  const cuando = new Date(p.activadaIso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '')
  return [limpia(p.destinatario || 'equipo', 40), limpia(p.objetivo), limpia(p.vigilador || 'vigilador', 60), cuando, String(Math.round(p.distancia)), textoFrecuencia(p.frecuenciaMin)]
}

export function vistaPrevia(cuerpo: string, v: string[]): string {
  return cuerpo.replace(/\{\{(\d)\}\}/g, (_, n) => v[Number(n) - 1] ?? '')
}
