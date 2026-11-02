// Hoja de ruta del supervisor: un WhatsApp al terminar cada turno, con las
// visitas en orden y la novedad de cada objetivo tal como se cargó.
//
// Formato aprobado (exacto, sin agregados):
//
//   HOJA DE RUTA
//   Fecha: [fecha]
//   Turno: [hora inicio] a [hora fin]
//   Supervisor: [nombre]
//
//   [hora de visita] — [objetivo]
//   [novedad textual completa de ese objetivo]
//
// - Visitas = supervisiones cargadas por el supervisor dentro del turno, en orden
//   cronológico. La novedad es `supervisiones.observaciones` sin resumir,
//   interpretar ni modificar.
// - Sin indicadores, alertas, estadísticas, pendientes ni PDF. No se mezcla con
//   los avisos de puestos descubiertos ni de rondas.
// - Un solo mensaje por destinatario y por turno. Si supera el límite de
//   WhatsApp NO se recorta: queda registrado como excedido (pendiente de decidir
//   cómo se entrega).
//
// Librería pura: el envío lo hace app/api/push/hoja-de-ruta (apagado por flag).

const TZ = 'America/Argentina/Buenos_Aires'

/** Límite de un mensaje de texto de WhatsApp (Cloud API). */
export const LIMITE_TEXTO_WHATSAPP = 4096

export interface GuardiaSupervisor {
  id: string
  supervisor_id: string
  fecha: string // YYYY-MM-DD, día de inicio
  hora_inicio: string
  hora_fin: string
  estado?: string | null
  tipo_evento?: string | null
}

export interface VisitaSupervision {
  id: string
  objetivo_id: string
  supervisor_id: string
  created_at: string
  observaciones: string | null
}

export interface TurnoSupervisor {
  /** Clave estable del turno: un mensaje por (clave, destinatario). */
  clave: string
  supervisorId: string
  fecha: string
  horaInicio: string
  horaFin: string
  desde: Date
  hasta: Date
  guardiaIds: string[]
}

export type ModoHojaDeRuta = 'apagado' | 'dry-run' | 'activo'

/** HOJA_DE_RUTA_WHATSAPP: 'activo' envía, 'dry-run' sólo arma; cualquier otro valor = apagado. */
export function modoHojaDeRuta(valor: string | undefined = process.env.HOJA_DE_RUTA_WHATSAPP): ModoHojaDeRuta {
  if (valor === 'activo') return 'activo'
  if (valor === 'dry-run') return 'dry-run'
  return 'apagado'
}

const hhmm = (h: string) => h.slice(0, 5)

/** Offset de Argentina para ese instante, derivado con Intl (no del reloj del proceso). */
function offsetMin(d: Date): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(d)
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(p.find(x => x.type === 'timeZoneName')?.value || '')
  if (!m) return -180
  const signo = m[1] === '-' ? -1 : 1
  return signo * (Number(m[2]) * 60 + Number(m[3] || 0))
}

/** Fecha + hora local de Argentina → instante. */
export function instanteLocal(fecha: string, hora: string): Date {
  const base = Date.parse(`${fecha}T${hhmm(hora)}:00Z`)
  return new Date(base - offsetMin(new Date(base)) * 60_000)
}

function partesLocales(d: Date) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const g = (t: string) => p.find(x => x.type === t)?.value ?? '00'
  return { fecha: `${g('year')}-${g('month')}-${g('day')}`, hora: `${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}` }
}

const guardiaCubre = (g: GuardiaSupervisor) =>
  (g.estado ?? 'activo') === 'activo' && !['franco', 'ausencia'].includes(g.tipo_evento ?? 'normal')

/**
 * Turnos de supervisor a partir de las filas de guardia. Un supervisor con
 * varias zonas en el mismo horario tiene varias filas pero UN turno: se agrupan
 * por (supervisor, inicio, fin). Un turno nocturno termina al día siguiente y
 * pertenece al día de inicio.
 */
export function turnosDeSupervisor(guardias: GuardiaSupervisor[]): TurnoSupervisor[] {
  const porClave = new Map<string, TurnoSupervisor>()
  for (const g of guardias) {
    if (!guardiaCubre(g)) continue
    const desde = instanteLocal(g.fecha, g.hora_inicio)
    let hasta = instanteLocal(g.fecha, g.hora_fin)
    if (hasta.getTime() <= desde.getTime()) hasta = new Date(hasta.getTime() + 86_400_000)
    const clave = `sup:${g.supervisor_id}|${desde.toISOString()}|${hasta.toISOString()}`
    const t = porClave.get(clave)
    if (t) t.guardiaIds.push(g.id)
    else porClave.set(clave, {
      clave, supervisorId: g.supervisor_id, fecha: g.fecha, horaInicio: hhmm(g.hora_inicio), horaFin: hhmm(g.hora_fin),
      desde, hasta, guardiaIds: [g.id],
    })
  }
  return Array.from(porClave.values()).sort((a, b) => a.desde.getTime() - b.desde.getTime())
}

/** Turnos que ya terminaron, dentro de la ventana de recuperación (no se manda nada viejo). */
export function turnosTerminados(turnos: TurnoSupervisor[], ahora: Date, ventanaHoras = 6): TurnoSupervisor[] {
  const limite = ahora.getTime() - ventanaHoras * 3_600_000
  return turnos.filter(t => t.hasta.getTime() <= ahora.getTime() && t.hasta.getTime() > limite)
}

/** Supervisiones del supervisor dentro del turno, en orden cronológico. */
export function visitasDelTurno(turno: TurnoSupervisor, visitas: VisitaSupervision[]): VisitaSupervision[] {
  return visitas
    .filter(v => v.supervisor_id === turno.supervisorId)
    .filter(v => {
      const t = Date.parse(v.created_at)
      return t >= turno.desde.getTime() && t <= turno.hasta.getTime()
    })
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))
}

const fechaDMY = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`

export function construirMensajeHojaDeRuta(p: {
  turno: TurnoSupervisor
  supervisorNombre: string
  visitas: VisitaSupervision[]
  nombreObjetivo: (id: string) => string
}): string {
  const lineas = [
    'HOJA DE RUTA',
    `Fecha: ${fechaDMY(p.turno.fecha)}`,
    `Turno: ${p.turno.horaInicio} a ${p.turno.horaFin}`,
    `Supervisor: ${p.supervisorNombre}`,
  ]
  for (const v of visitasDelTurno(p.turno, p.visitas)) {
    lineas.push('', `${partesLocales(new Date(v.created_at)).hora} — ${p.nombreObjetivo(v.objetivo_id)}`)
    // Textual: sin recortar ni normalizar. Sólo se omite si no se cargó nada.
    if (v.observaciones != null && v.observaciones.trim() !== '') lineas.push(v.observaciones)
  }
  return lineas.join('\n')
}

export function excedeLimite(mensaje: string, limite = LIMITE_TEXTO_WHATSAPP): boolean {
  return Array.from(mensaje).length > limite
}
