// Estados de mensajes WhatsApp que llegan por webhook.
//
// La Cloud API no tiene consulta por message_id: el destino real de un envío
// (sent → delivered → read, o failed) SOLO se informa por webhook. Sin esto,
// un mensaje que Meta aceptó pero nunca entregó —por ejemplo por falta de
// método de pago, error 131042— es indistinguible de uno entregado.
//
// Este módulo sólo INTERPRETA el payload del webhook. No responde mensajes,
// no toca el escalamiento, no conoce la IA comercial. Los mensajes ENTRANTES
// de los clientes se ignoran deliberadamente: ese tráfico es de la
// automatización comercial/CV y este sistema no debe intervenir.

export interface EstadoMensaje {
  /** El wamid del mensaje al que refiere el estado. */
  id_proveedor: string
  /** sent | delivered | read | failed | deleted | warning */
  estado: string
  /** Teléfono del destinatario, como lo informa Meta. */
  destinatario: string | null
  /** Momento del estado según Meta (epoch en segundos → ISO). */
  ocurrido_at: string | null
  /** Código de error de Meta cuando el estado es failed (p. ej. 131042). */
  error_codigo: string | null
  error_detalle: string | null
}

/**
 * Extrae los estados de un payload de webhook de WhatsApp Business.
 *
 * Tolerante por diseño: un payload que no tiene la forma esperada devuelve
 * lista vacía, nunca rompe — el webhook SIEMPRE tiene que responder 200
 * rápido o Meta reintenta y termina desuscribiendo.
 */
export function extraerEstados(payload: unknown): EstadoMensaje[] {
  const estados: EstadoMensaje[] = []
  const entradas = (payload as any)?.entry
  if (!Array.isArray(entradas)) return estados

  for (const entrada of entradas) {
    const cambios = entrada?.changes
    if (!Array.isArray(cambios)) continue
    for (const cambio of cambios) {
      const statuses = cambio?.value?.statuses
      if (!Array.isArray(statuses)) continue
      for (const s of statuses) {
        if (!s?.id || !s?.status) continue
        const errores = Array.isArray(s.errors) ? s.errors : []
        const error = errores[0]
        estados.push({
          id_proveedor: String(s.id),
          estado: String(s.status),
          destinatario: s.recipient_id ? String(s.recipient_id) : null,
          ocurrido_at: s.timestamp && Number.isFinite(Number(s.timestamp))
            ? new Date(Number(s.timestamp) * 1000).toISOString()
            : null,
          error_codigo: error?.code != null ? String(error.code) : null,
          error_detalle: error
            ? [error.title, error.error_data?.details].filter(Boolean).join(' · ') || null
            : null,
        })
      }
    }
  }
  return estados
}
