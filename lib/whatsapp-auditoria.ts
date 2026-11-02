// Auditoría de WhatsApp ANTES de enviar, y topes del canal de rondas.
//
// El 07/10/2026 salieron 5.753 WhatsApp a 3 supervisores y en
// escalamiento_whatsapp_envios quedaron 26 filas: la auditoría se escribía en
// un solo insert al FINAL de la corrida, y una corrida que moría por tiempo (o
// cuyo insert fallaba) no dejaba rastro de lo que sí había mandado. La dedup
// claim-first (c67fa6d) cortó el loop; esto cierra el hueco de auditoría:
// cada envío real tiene su fila escrita ANTES de llamar a Meta, y se completa
// con el resultado después. Si la fila no se puede escribir, NO se envía.

/** Resultado provisorio mientras el envío está en curso. */
export const RESULTADO_RECLAMADO = 'reclamado'

/**
 * Inserta la fila de auditoría con resultado 'reclamado' y devuelve su id.
 * `null` = no se pudo registrar → el llamador NO debe enviar.
 */
export async function auditarAntesDeEnviar(client: any, fila: Record<string, unknown>): Promise<string | null> {
  try {
    const r = await client.from('escalamiento_whatsapp_envios')
      .insert({ ...fila, resultado: RESULTADO_RECLAMADO })
      .select('id')
      .single()
    if (r.error || !r.data?.id) return null
    return r.data.id as string
  } catch {
    return null
  }
}

/** Completa la fila con el resultado real del proveedor. Nunca lanza. */
export async function completarAuditoria(
  client: any,
  id: string,
  r: { ok: boolean; idProveedor?: string | null; error?: string | null },
): Promise<void> {
  try {
    await client.from('escalamiento_whatsapp_envios')
      .update({ resultado: r.ok ? 'enviado' : 'fallido', id_proveedor: r.idProveedor ?? null, error: r.error ?? null })
      .eq('id', id)
  } catch (e) {
    console.error('[whatsapp] no se pudo completar la auditoría', id, e instanceof Error ? e.message : e)
  }
}

// ── Topes del canal de rondas ────────────────────────────────────────────────

/** Una alerta detectada hace más de esto no se escala por WhatsApp. */
export const WA_RONDA_MAX_ANTIGUEDAD_MIN = 120
/** WhatsApp de ronda por supervisor y día (hora argentina). */
export const WA_RONDA_TOPE_DIARIO = 15

/** Inicio del día local argentino (UTC-3, sin horario de verano) en ISO. */
export function inicioDiaArgentina(fechaLocal: string): string {
  return new Date(Date.parse(`${fechaLocal}T00:00:00-03:00`)).toISOString()
}

export type MotivoDescarteWaRonda = 'intervenida' | 'vieja'

/**
 * ¿Esta alerta de ronda todavía amerita un WhatsApp? No, si el supervisor ya
 * intervino (cualquier acción o resultado) o si es vieja: un aviso de hace
 * horas no pide una acción inmediata y sólo agrega ruido (la bandeja la sigue
 * mostrando).
 */
export function descarteWaRonda(
  a: { detectada_at?: string | null; accion?: string | null; resultado_intervencion?: string | null },
  ahora: number,
  maxAntiguedadMin: number = WA_RONDA_MAX_ANTIGUEDAD_MIN,
): MotivoDescarteWaRonda | null {
  if (a.accion != null || a.resultado_intervencion != null) return 'intervenida'
  const t = a.detectada_at ? Date.parse(a.detectada_at) : NaN
  if (!Number.isFinite(t) || ahora - t > maxAntiguedadMin * 60000) return 'vieja'
  return null
}

/** Cuenta los envíos (reales o en curso) por destinatario. */
export function contarEnviosPorDestinatario(
  filas: Array<{ destinatario_id?: string | null; resultado?: string | null }>,
): Map<string, number> {
  const m = new Map<string, number>()
  for (const f of filas) {
    if (!f.destinatario_id) continue
    if (f.resultado !== 'enviado' && f.resultado !== RESULTADO_RECLAMADO) continue
    m.set(f.destinatario_id, (m.get(f.destinatario_id) ?? 0) + 1)
  }
  return m
}
