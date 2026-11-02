// Envío de WhatsApp a prueba de loops y de corridas simultáneas.
//
// Cada mensaje real pasa por `reclamar_envio_whatsapp` (migración
// 20261121120000) ANTES de llamar a Meta. La base decide, bajo lock, con una
// clave estable por (canal, etapa, evento, destinatario) e índice único
// (clave, intento):
//   · si ya salió, está en curso o quedó incierto (corrida cortada) → no;
//   · si la alerta ya fue intervenida o cerrada AHORA → no;
//   · si se superó el tope por destinatario/día o por evento → no;
//   · si falló antes: reintento con backoff exponencial y máximo de intentos,
//     sólo si el error es reintentable.
// Cualquier error de la RPC = NO enviar (fail-closed). Ver
// docs/auditoria-2026-10/whatsapp_causa_raiz.md.

export type EtapaWhatsApp =
  | 'escalamiento_wa_15'
  | 'escalamiento_wa_30'
  | 'escalamiento_wa_ronda_no_iniciada'
  | 'wa_ronda_pendiente_vigilador'

/** Clave estable: wa|<etapa>|<evento>|<destinatario>. */
export function claveEnvioWhatsApp(p: { etapa: EtapaWhatsApp | string; evento: string; destinatarioId: string }): string {
  if (!p.etapa || !p.evento || !p.destinatarioId) throw new Error('claveEnvioWhatsApp: faltan datos')
  return `wa|${p.etapa}|${p.evento}|${p.destinatarioId}`
}

export const eventoRonda = (alertaId: string) => `ronda_alerta:${alertaId}`
export const eventoTurno = (turnoId: string) => `turno:${turnoId}`

/**
 * ¿Vale la pena reintentar? Sólo errores transitorios (red, 5xx, límites de
 * tasa). Un número inexistente, una plantilla rechazada o un parámetro mal
 * armado no se arreglan reintentando.
 */
export function esErrorReintentable(error?: string | null): boolean {
  if (!error) return false
  if (/WHATSAPP_TOKEN|sin configurar/i.test(error)) return false
  return /rate limit|too many|throttl|temporar|timeout|timed out|ECONN|ETIMEDOUT|ENOTFOUND|fetch failed|network|error de red|HTTP 5\d\d|service unavailable|131056|130429|131000/i.test(error)
}

export interface OpcionesReclamo {
  maxIntentos?: number
  backoffMin?: number
  topeDestinatarioDia?: number | null
  topeEvento?: number | null
}

/** ok=true trae id e intento; ok=false trae motivo (NO enviar). */
export interface ResultadoReclamo { ok: boolean; id?: string; intento?: number; motivo?: string }

export const RECLAMO_POR_DEFECTO = { maxIntentos: 3, backoffMin: 10 } as const

/** Reclama el envío. `ok:false` (incluido cualquier error) ⇒ NO enviar. */
export async function reclamarEnvio(
  client: any,
  clave: string,
  fila: Record<string, unknown>,
  o: OpcionesReclamo = {},
): Promise<ResultadoReclamo> {
  try {
    const r = await client.rpc('reclamar_envio_whatsapp', {
      p_clave: clave,
      p_fila: fila,
      p_max_intentos: o.maxIntentos ?? RECLAMO_POR_DEFECTO.maxIntentos,
      p_backoff_min: o.backoffMin ?? RECLAMO_POR_DEFECTO.backoffMin,
      p_tope_destinatario_dia: o.topeDestinatarioDia ?? null,
      p_tope_evento: o.topeEvento ?? null,
    })
    if (r?.error) return { ok: false, motivo: 'error_rpc' }
    const d = r?.data
    if (d && d.ok === true && typeof d.id === 'string') return { ok: true, id: d.id, intento: Number(d.intento ?? 1) }
    return { ok: false, motivo: typeof d?.motivo === 'string' ? d.motivo : 'error_rpc' }
  } catch {
    return { ok: false, motivo: 'error_rpc' }
  }
}

/** Completa el resultado. Nunca lanza: una falla deja la fila 'reclamado' (no se reintenta). */
export async function completarEnvio(
  client: any,
  id: string,
  r: { ok: boolean; idProveedor?: string | null; error?: string | null },
): Promise<void> {
  try {
    const res = await client.rpc('completar_envio_whatsapp', {
      p_id: id,
      p_ok: r.ok,
      p_id_proveedor: r.idProveedor ?? null,
      p_error: r.error ?? null,
      p_reintentable: r.ok ? false : esErrorReintentable(r.error),
    })
    if (res?.error) console.error('[whatsapp] no se pudo completar el envío', id, res.error.message)
  } catch (e) {
    console.error('[whatsapp] no se pudo completar el envío', id, e instanceof Error ? e.message : e)
  }
}

/**
 * Presupuesto de una corrida: el 07/10 cada corrida murió a los 60 s
 * (maxDuration) en medio de los envíos. Se corta ANTES, con margen, y lo que
 * queda sale en la próxima corrida (la clave lo protege de duplicarse).
 */
export function crearPresupuestoCorrida(
  o: { maxEnvios?: number; maxMs?: number } = {},
  reloj: () => number = Date.now,
) {
  const inicio = reloj()
  const maxEnvios = o.maxEnvios ?? 40
  const maxMs = o.maxMs ?? 40000
  let envios = 0
  return {
    /** ¿Se puede intentar un envío más? */
    disponible(): boolean { return envios < maxEnvios && reloj() - inicio < maxMs },
    registrar(): void { envios += 1 },
    get envios() { return envios },
  }
}

/**
 * A quién se escala una alerta: los responsables de guardia AHORA; si no hay
 * nadie de guardia, la lista de escalamiento (jefes). Sin nadie, motivo.
 */
export function destinatariosConRespaldo(
  r: { responsables?: string[] | null; origen: string },
  fallbackJefes: string[],
): { destinatarios: string[]; origen: string; motivoSinDestinatario: string | null } {
  const propios = Array.from(new Set(r.responsables ?? []))
  if (propios.length > 0) return { destinatarios: propios, origen: r.origen, motivoSinDestinatario: null }
  const jefes = Array.from(new Set(fallbackJefes))
  if (jefes.length > 0) return { destinatarios: jefes, origen: 'fallback_jefes', motivoSinDestinatario: null }
  return {
    destinatarios: [],
    origen: r.origen,
    motivoSinDestinatario: r.origen === 'multiples_sin_guardia'
      ? 'VARIOS_RESPONSABLES_SIN_GUARDIA_DEFINIDA'
      : 'SIN_SUPERVISOR_RESPONSABLE',
  }
}
