// Estado del envío de una hoja de ruta a UN destinatario, para mostrar.
// "Enviado" (Meta lo aceptó) no es "entregado" ni "leído": se distingue.

export interface EstadoDestinatarioFila {
  hoja_id: string
  destinatario_id: string
  intentos: number
  estado_envio: string
  estado_meta: string | null
  estado_meta_at: string | null
  ultimo_error: string | null
  ultimo_intento_at: string | null
}

export function estadoDestinatario(f: EstadoDestinatarioFila | null, bloqueado?: string | null): { etiqueta: string; color: string } {
  if (!f) {
    return bloqueado === 'excede_longitud'
      ? { etiqueta: 'Pendiente por longitud: el mensaje supera el límite de WhatsApp', color: '#f59e0b' }
      : { etiqueta: 'No enviado', color: '#94a3b8' }
  }
  if (f.estado_meta === 'failed') return { etiqueta: 'Falló la entrega', color: '#f87171' }
  if (f.estado_envio === 'sin_telefono') return { etiqueta: 'Sin teléfono válido: pendiente de configuración', color: '#f59e0b' }
  if (f.estado_envio === 'incierto') return { etiqueta: 'Envío incierto: revisar antes de reenviar', color: '#f59e0b' }
  if (f.estado_envio === 'enviando') return { etiqueta: 'Enviando', color: '#94a3b8' }
  if (f.estado_envio === 'error') return { etiqueta: 'Error al enviar', color: '#f87171' }
  if (f.estado_meta === 'read') return { etiqueta: 'Leído', color: '#34d399' }
  if (f.estado_meta === 'delivered') return { etiqueta: 'Entregado', color: '#60a5fa' }
  return { etiqueta: 'Enviado (sin confirmación de entrega)', color: '#e2e8f0' }
}
