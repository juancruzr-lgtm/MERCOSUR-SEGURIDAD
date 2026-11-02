// Avisos de alertas de ronda a supervisores: deduplicación, topes y antigüedad.
//
// ── Por qué existe ──────────────────────────────────────────────────────────
// Octubre 2026 (auditoría, sólo lectura):
//   · 01–03/10: 34 alertas sin responsable definido ('varios responsables sin
//     guardia definida') se reintentaron cada 10 minutos —5.575 intentos— y el
//     push a los supervisores recién salió el 03/10 a las 19:02, hasta 50 h tarde.
//   · 07/10: el backlog de pendientes rompió la lectura de deduplicación (un IN
//     enorme en un solo GET) y salieron 5.753 WhatsApp a 3 supervisores.
//   La lectura de dedup del push de rondas tenía el mismo defecto: un solo IN
//   sin lotes y sin mirar el error.
//
// ── La regla ────────────────────────────────────────────────────────────────
//   1) Dedup en LOTES y FAIL-CLOSED: si una lectura falla, no se envía nada.
//   2) Una alerta se avisa UNA vez (a quien sea): la clave es por alerta.
//   3) Alertas intervenidas no se avisan (el supervisor ya está en el tema),
//      salvo el seguimiento VENCIDO, que se avisa una vez con su propia clave.
//   4) Nada viejo sale suelto: una alerta detectada hace más de N horas (2) no
//      se manda individualmente; se resume en UN aviso por supervisor y bloque.
//   5) Tope diario por supervisor: pasado el tope, lo que sigue va al resumen.
//
// Funciones puras (salvo `leerClavesEnLotes`, que recibe la consulta inyectada).

export const AVISO_RONDA_MAX_ANTIGUEDAD_MIN = 120
export const TOPE_DIARIO_AVISOS_RONDA_SUPERVISOR = 20
export const TAMANO_LOTE_DEDUP = 100
/** Horas por bloque del resumen: como mucho 4 resúmenes por supervisor y día. */
export const HORAS_BLOQUE_RESUMEN = 6

export function enLotes<T>(items: T[], tamano: number = TAMANO_LOTE_DEDUP): T[][] {
  const salida: T[][] = []
  for (let i = 0; i < items.length; i += tamano) salida.push(items.slice(i, i + tamano))
  return salida
}

export interface LecturaClaves {
  ok: boolean
  claves: Set<string>
  error: string | null
}

/**
 * Lee qué claves ya figuran como enviadas, en lotes. FAIL-CLOSED: ante el
 * primer error devuelve `ok: false` y el llamador NO debe enviar nada. Asumir
 * "no avisé ninguna" ante un error fue el loop del 07/10/2026.
 */
export async function leerClavesEnLotes(
  consultar: (lote: string[]) => PromiseLike<{ data: Array<{ tipo: string }> | null; error: { message?: string } | null }>,
  claves: string[],
  tamano: number = TAMANO_LOTE_DEDUP,
): Promise<LecturaClaves> {
  const encontradas = new Set<string>()
  const unicas = Array.from(new Set(claves))
  for (const lote of enLotes(unicas, tamano)) {
    let r: { data: Array<{ tipo: string }> | null; error: { message?: string } | null }
    try {
      r = await consultar(lote)
    } catch (e) {
      return { ok: false, claves: new Set(), error: e instanceof Error ? e.message : String(e) }
    }
    if (r.error) return { ok: false, claves: new Set(), error: r.error.message || 'error de lectura' }
    for (const fila of r.data ?? []) encontradas.add(fila.tipo)
  }
  return { ok: true, claves: encontradas, error: null }
}

/** Lo que el planificador necesita de cada alerta. */
export interface AlertaRondaAviso {
  id: string
  tipo: string
  objetivo_id: string
  detectada_at: string
  estado?: string | null
  accion?: string | null
  resultado_intervencion?: string | null
  seguimiento_hasta?: string | null
}

export function claveAvisoRonda(a: Pick<AlertaRondaAviso, 'id' | 'tipo'>): string {
  return `supervisor_ronda_${a.tipo}:${a.id}`
}
export function claveSeguimientoVencido(a: Pick<AlertaRondaAviso, 'id'>): string {
  return `supervisor_ronda_seguimiento_vencido:${a.id}`
}
/** Clave del resumen: una por supervisor, día local y bloque de 6 horas. */
export function claveResumenRonda(fechaLocal: string, horaLocal: string): string {
  const h = Number(String(horaLocal).slice(0, 2)) || 0
  return `supervisor_ronda_resumen:${fechaLocal}:${Math.floor(h / HORAS_BLOQUE_RESUMEN)}`
}
/** Prefijo común de todo aviso de ronda a supervisores (para contar el tope). */
export const PREFIJO_AVISO_RONDA = 'supervisor_ronda_'

export type MotivoOmisionRonda =
  | 'ya_avisada'
  | 'intervenida'
  | 'vieja'
  | 'tope_diario'
  | 'sin_destinatario'

export interface AvisoIndividual {
  alerta: AlertaRondaAviso
  clave: string
  usuarios: string[]
  seguimientoVencido: boolean
}

export interface PlanAvisosRonda {
  individuales: AvisoIndividual[]
  /** usuario → ids de alertas que van al resumen (viejas o pasado el tope). */
  resumen: Map<string, string[]>
  omitidas: Record<MotivoOmisionRonda, number>
}

export interface ParametrosPlan {
  alertas: AlertaRondaAviso[]
  /** Claves ya registradas en notificaciones_enviadas (de cualquier usuario). */
  yaAvisadas: Set<string>
  /** Avisos de ronda ya enviados HOY a cada usuario. */
  avisosHoyPorUsuario: Map<string, number>
  destinatarios: (a: AlertaRondaAviso) => string[]
  ahora: number
  maxAntiguedadMin?: number
  topeDiario?: number
}

function ms(iso?: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

export function planificarAvisosRonda(p: ParametrosPlan): PlanAvisosRonda {
  const maxAnt = (p.maxAntiguedadMin ?? AVISO_RONDA_MAX_ANTIGUEDAD_MIN) * 60000
  const tope = p.topeDiario ?? TOPE_DIARIO_AVISOS_RONDA_SUPERVISOR
  const omitidas: Record<MotivoOmisionRonda, number> = {
    ya_avisada: 0, intervenida: 0, vieja: 0, tope_diario: 0, sin_destinatario: 0,
  }
  const individuales: AvisoIndividual[] = []
  const resumen = new Map<string, string[]>()
  const planificadosPorUsuario = new Map<string, number>()
  const alResumen = (u: string, id: string) => {
    const l = resumen.get(u) ?? []
    if (!l.includes(id)) l.push(id)
    resumen.set(u, l)
  }

  // Lo más reciente primero: si el tope corta, que corte lo más viejo.
  const ordenadas = [...p.alertas].sort((a, b) => (ms(b.detectada_at) ?? 0) - (ms(a.detectada_at) ?? 0))

  for (const a of ordenadas) {
    if ((a.estado ?? 'pendiente') !== 'pendiente') continue

    const enSeguimiento = a.resultado_intervencion === 'seguimiento'
    const hastaSeg = ms(a.seguimiento_hasta)
    const segVencido = enSeguimiento && hastaSeg !== null && hastaSeg <= p.ahora
    const intervenida = a.accion != null || a.resultado_intervencion != null

    if (intervenida && !segVencido) { omitidas.intervenida += 1; continue }

    const clave = segVencido ? claveSeguimientoVencido(a) : claveAvisoRonda(a)
    if (p.yaAvisadas.has(clave)) { omitidas.ya_avisada += 1; continue }

    const usuarios = Array.from(new Set(p.destinatarios(a).filter(Boolean)))
    if (usuarios.length === 0) { omitidas.sin_destinatario += 1; continue }

    // Antigüedad: desde la detección, o desde el vencimiento del seguimiento.
    const desde = segVencido ? hastaSeg : ms(a.detectada_at)
    if (desde === null || p.ahora - desde > maxAnt) {
      omitidas.vieja += 1
      for (const u of usuarios) alResumen(u, a.id)
      continue
    }

    const conCupo: string[] = []
    for (const u of usuarios) {
      const usados = (p.avisosHoyPorUsuario.get(u) ?? 0) + (planificadosPorUsuario.get(u) ?? 0)
      if (usados >= tope) { alResumen(u, a.id); continue }
      conCupo.push(u)
      planificadosPorUsuario.set(u, (planificadosPorUsuario.get(u) ?? 0) + 1)
    }
    if (conCupo.length === 0) { omitidas.tope_diario += 1; continue }
    individuales.push({ alerta: a, clave, usuarios: conCupo, seguimientoVencido: segVencido })
  }

  return { individuales, resumen, omitidas }
}

/** Texto del resumen: una sola notificación en lugar del backlog. */
export function textoResumenRonda(cantidad: number): { title: string; body: string } {
  return {
    title: 'Alertas de ronda sin intervenir',
    body: cantidad === 1
      ? 'Hay 1 alerta de ronda pendiente de hace más de 2 horas. Registrá el resultado en Rondas.'
      : `Hay ${cantidad} alertas de ronda pendientes de hace más de 2 horas. Registrá el resultado en Rondas.`,
  }
}

/** Cuenta avisos de ronda por usuario a partir de filas de notificaciones_enviadas. */
export function contarAvisosPorUsuario(filas: Array<{ usuario_id: string; tipo: string }>): Map<string, number> {
  const m = new Map<string, number>()
  for (const f of filas) {
    if (!f.tipo?.startsWith(PREFIJO_AVISO_RONDA)) continue
    // El resumen no consume cupo: es justamente la salida cuando no hay cupo.
    if (f.tipo.startsWith(`${PREFIJO_AVISO_RONDA}resumen:`)) continue
    m.set(f.usuario_id, (m.get(f.usuario_id) ?? 0) + 1)
  }
  return m
}

/**
 * Responsables con fallback: si la zona tiene varios responsables y nadie de
 * guardia ('multiples_sin_guardia') o nadie, se avisa UNA vez a la lista de
 * escalamiento (jefe de supervisores; sin jefe activo, la lista entera) en vez
 * de esperar a que alguien entre de guardia. La dedup por alerta hace que sea
 * una sola vez.
 */
export function destinatariosConFallback(
  responsables: string[],
  lista: Array<{ usuario_id: string; rol_en_escalamiento?: string | null; activo?: boolean | null }>,
): { usuarios: string[]; fallback: boolean } {
  if (responsables.length > 0) return { usuarios: responsables, fallback: false }
  const activos = lista.filter(x => x.activo !== false)
  const jefes = activos.filter(x => x.rol_en_escalamiento === 'jefe_supervisores').map(x => x.usuario_id)
  const usuarios = Array.from(new Set(jefes.length > 0 ? jefes : activos.map(x => x.usuario_id)))
  return { usuarios, fallback: usuarios.length > 0 }
}
