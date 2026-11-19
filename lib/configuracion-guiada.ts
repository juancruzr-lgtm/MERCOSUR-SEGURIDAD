/**
 * lib/configuracion-guiada.ts
 *
 * Configuración guiada de un objetivo nuevo:
 *  1. Protocolo: formulario de preguntas simples → texto del protocolo, que se
 *     guarda con el RPC existente `protocolo_guardar` (queda vigente y le llega
 *     al vigilador con el aviso de protocolo que ya existe).
 *  2. Ronda por defecto: el vigilador marca dos puntos (un extremo y el otro
 *     del puesto). Con eso se crea una ronda de 2 puntos, cada 120 min, radio
 *     25 m, que queda PROPUESTA: se avisa a supervisores y jefes y empieza a
 *     regir sola a las 24 h salvo que alguien la cambie o la rechace. La
 *     primera semana es de prueba.
 *
 * Las mismas validaciones se repiten en el servidor (migración 20261218120000).
 */

export const RONDA_GUIADA = {
  intervaloMinutos: 120,
  radioMetros: 25,
  precisionMaximaMetros: 25,
  distanciaMinimaMetros: 20,
  distanciaMaximaMetros: 300,
  /** Distancia máxima de cada punto al centro del objetivo. */
  alejamientoMaximoMetros: 500,
  horasHastaActivar: 24,
  diasDePrueba: 7,
} as const

export interface PuntoGps { lat: number; lng: number; precision: number }

/** Distancia en metros (haversine). */
export function distanciaMetros(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000
  const rad = (x: number) => (x * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export type ProblemaPunto =
  | { tipo: 'sin_gps' }
  | { tipo: 'impreciso'; precision: number }
  | { tipo: 'lejos_del_objetivo'; distancia: number }
  | { tipo: 'muy_cerca'; distancia: number }
  | { tipo: 'muy_lejos'; distancia: number }

/** Valida un punto (y, si es el segundo, su distancia al primero). null = válido. */
export function validarPunto(p: PuntoGps | null, centroObjetivo: { lat: number; lng: number } | null, primero?: PuntoGps | null): ProblemaPunto | null {
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return { tipo: 'sin_gps' }
  if (!(p.precision <= RONDA_GUIADA.precisionMaximaMetros)) return { tipo: 'impreciso', precision: Math.round(p.precision) }
  if (centroObjetivo) {
    const d = distanciaMetros(p, centroObjetivo)
    if (d > RONDA_GUIADA.alejamientoMaximoMetros) return { tipo: 'lejos_del_objetivo', distancia: Math.round(d) }
  }
  if (primero) {
    const d = distanciaMetros(p, primero)
    if (d < RONDA_GUIADA.distanciaMinimaMetros) return { tipo: 'muy_cerca', distancia: Math.round(d) }
    if (d > RONDA_GUIADA.distanciaMaximaMetros) return { tipo: 'muy_lejos', distancia: Math.round(d) }
  }
  return null
}

export function textoProblema(p: ProblemaPunto): string {
  switch (p.tipo) {
    case 'sin_gps': return 'No se pudo leer la ubicación. Activá el GPS y probá de nuevo.'
    case 'impreciso': return `La ubicación es poco precisa (±${p.precision} m). Salí a un lugar abierto, esperá unos segundos y probá de nuevo.`
    case 'lejos_del_objetivo': return `Estás a ${p.distancia} m del objetivo. Tenés que marcar el punto dentro del puesto.`
    case 'muy_cerca': return `Este punto está a sólo ${p.distancia} m del primero. Caminá hasta el otro extremo del puesto.`
    case 'muy_lejos': return `Este punto está a ${p.distancia} m del primero: es demasiado. Marcá el otro extremo del puesto, no un lugar fuera de él.`
  }
}

// ── Protocolo guiado ─────────────────────────────────────────────────────────

export interface PreguntaProtocolo {
  clave: string
  titulo: string
  ayuda: string
  obligatoria: boolean
}

export const PREGUNTAS_PROTOCOLO: PreguntaProtocolo[] = [
  { clave: 'horario', titulo: 'Horario y modalidad del servicio', ayuda: 'Ej.: 24 h, lunes a viernes 8 a 20, con o sin relevo.', obligatoria: true },
  { clave: 'tareas', titulo: 'Qué tiene que hacer el vigilador', ayuda: 'Tareas del puesto: control de accesos, recorridas, cierre de portones, etc.', obligatoria: true },
  { clave: 'accesos', titulo: 'Control de accesos', ayuda: 'Quién puede entrar, cómo se registra, qué se pide a proveedores y visitas.', obligatoria: false },
  { clave: 'prohibido', titulo: 'Qué está prohibido', ayuda: 'Ej.: abandonar el puesto, recibir paquetes, dejar entrar sin autorización.', obligatoria: true },
  { clave: 'emergencias', titulo: 'Qué hacer ante una emergencia', ayuda: 'Incendio, intrusión, accidente: a quién llamar primero y qué hacer.', obligatoria: true },
  { clave: 'contactos', titulo: 'Contactos', ayuda: 'Encargado del cliente, supervisor, policía, bomberos (con teléfono).', obligatoria: true },
  { clave: 'novedades', titulo: 'Cómo informar novedades', ayuda: 'Libro de guardia, app, a quién avisar y cuándo.', obligatoria: false },
]

export function faltantesProtocolo(r: Record<string, string>): string[] {
  return PREGUNTAS_PROTOCOLO.filter(p => p.obligatoria && !(r[p.clave] ?? '').trim()).map(p => p.titulo)
}

/** Arma el texto del protocolo a partir de las respuestas (sin inventar nada). */
export function armarProtocolo(objetivoNombre: string, r: Record<string, string>): { titulo: string; texto: string } {
  const partes = PREGUNTAS_PROTOCOLO
    .filter(p => (r[p.clave] ?? '').trim())
    .map((p, i) => `${i + 1}. ${p.titulo.toUpperCase()}\n${r[p.clave].trim()}`)
  return {
    titulo: `Protocolo del puesto — ${objetivoNombre}`,
    texto: [`PROTOCOLO DEL PUESTO — ${objetivoNombre.toUpperCase()}`, '', ...partes.flatMap(p => [p, ''])].join('\n').trim(),
  }
}

// ── Estado de la ronda propuesta ─────────────────────────────────────────────

export type EstadoRondaGuiada = 'esperando_puntos' | 'propuesta' | 'activa' | 'modificada' | 'rechazada'

export const ETIQUETA_ESTADO_RONDA_GUIADA: Record<EstadoRondaGuiada, string> = {
  esperando_puntos: 'Esperando que el vigilador marque los puntos',
  propuesta: 'Propuesta: se activa sola salvo cambios',
  activa: 'Activa',
  modificada: 'Cambiada por un supervisor (la activa quien la cambió)',
  rechazada: 'Rechazada',
}

/** Texto corto del tiempo que falta para que se active sola. */
export function faltaParaActivar(activaDesdeIso: string, ahoraIso: string): string {
  const min = Math.round((Date.parse(activaDesdeIso) - Date.parse(ahoraIso)) / 60_000)
  if (min <= 0) return 'se activa en la próxima revisión'
  if (min < 60) return `se activa en ${min} min`
  return `se activa en ${Math.round(min / 60)} h`
}

// ── Aviso de ronda propuesta (plantilla para Meta) ──────────────────────────

export const PLANTILLA_RONDA_GUIADA_PROPUESTA = {
  nombre: 'ronda_guiada_propuesta',
  categoria: 'UTILITY',
  idioma: 'es_AR',
  cuerpo: [
    'Hola {{1}}. El vigilador de *{{2}}* configuró la ronda del puesto: 2 puntos a {{3}} m, cada 2 horas.',
    '',
    'Empieza a regir sola el {{4}}, salvo que la cambies o la rechaces desde la app (Configurar objetivos).',
    'La primera semana es de prueba.',
  ].join('\n'),
  boton: { tipo: 'URL', texto: 'Revisar la ronda', url: 'https://mercosur-seguridad.vercel.app/dashboard?page={{1}}' },
} as const

export function variablesRondaPropuesta(destinatario: string, objetivo: string, distancia: number, activaDesdeIso: string): string[] {
  const cuando = new Date(activaDesdeIso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const limpia = (s: string, max = 60) => { const t = s.replace(/[\n\r\t]+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t }
  return [limpia(destinatario || 'equipo', 40), limpia(objetivo), String(Math.round(distancia)), cuando]
}

export function vistaPreviaRondaPropuesta(v: string[]): string {
  return PLANTILLA_RONDA_GUIADA_PROPUESTA.cuerpo.replace(/\{\{(\d)\}\}/g, (_, n) => v[Number(n) - 1] ?? '')
}
