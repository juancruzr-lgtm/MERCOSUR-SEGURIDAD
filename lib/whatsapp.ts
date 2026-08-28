// El canal WhatsApp, detrás de una interfaz.
//
// El detector de puestos descubiertos no sabe nada de Meta ni de Twilio: le
// pasa un destinatario y unas variables, y esto se encarga del resto. Cambiar
// de proveedor no debería obligar a tocar una sola línea del escalamiento.
//
// ── Por qué plantillas y no texto libre ─────────────────────────────────────
// WhatsApp no deja que una empresa inicie una conversación con texto libre. Si
// el usuario no escribió en las últimas 24 horas, el único mensaje que se puede
// enviar es una PLANTILLA previamente aprobada por Meta, de categoría Utility
// para avisos operativos como éste. El texto de `textoMensaje()` es lo que la
// plantilla va a decir; las variables viajan aparte y Meta las inserta.
//
// ── Lo que NO se hace, y no se va a hacer ───────────────────────────────────
// Automatizar WhatsApp Web, Selenium, emuladores o un número personal. Todo eso
// viola los términos de Meta y termina con la cuenta bloqueada — que es
// exactamente el canal que se está tratando de construir.
//
// Los GRUPOS de WhatsApp tampoco: la Cloud API no permite enviar a un grupo. El
// "grupo de supervisores y directivos" se resuelve como mensajes individuales a
// una lista configurable, que además deja auditoría por persona.

export interface DestinoWhatsApp {
  /** Sólo dígitos con país, ya normalizado. */
  telefono: string
  /** Nombre de la plantilla aprobada en Meta. */
  plantilla: string
  /** Las variables, en el orden en que la plantilla las numera. */
  variables: string[]
}

export interface ResultadoEnvio {
  ok: boolean
  /** El id que devuelve el proveedor, para poder rastrear el mensaje. */
  idProveedor?: string
  error?: string
}

export interface ProveedorWhatsApp {
  nombre: string
  /** `false` cuando falta configuración: el cron no debe intentar enviar. */
  configurado: boolean
  enviar(destino: DestinoWhatsApp): Promise<ResultadoEnvio>
}

/**
 * Todo lo que hace falta para poder enviar, y qué falta si no se puede.
 *
 * Se expone para que el dry-run diga exactamente qué está pendiente en vez de
 * un "no configurado" que no le sirve a nadie.
 */
export interface ConfiguracionMeta {
  phoneId: boolean
  token: boolean
  idioma: string
  plantillas: { quince: string; treinta: string }
  completa: boolean
  faltan: string[]
}

export function configuracionMeta(): ConfiguracionMeta {
  const token = Boolean(process.env.WHATSAPP_TOKEN)
  const phoneId = Boolean(process.env.WHATSAPP_PHONE_ID)
  const faltan: string[] = []
  if (!phoneId) faltan.push('WHATSAPP_PHONE_ID')
  if (!token) faltan.push('WHATSAPP_TOKEN')

  return {
    phoneId, token,
    // El idioma de la plantilla aprobada. Meta lo exige exacto: una plantilla
    // aprobada en es_AR no se puede enviar pidiendo es.
    idioma: process.env.WHATSAPP_IDIOMA || 'es_AR',
    plantillas: {
      quince: process.env.WHATSAPP_PLANTILLA_15 || 'puesto_descubierto_15',
      treinta: process.env.WHATSAPP_PLANTILLA_30 || 'puesto_descubierto_30',
    },
    completa: token && phoneId,
    faltan,
  }
}

/**
 * Meta WhatsApp Cloud API.
 *
 * Las credenciales salen SÓLO de variables de entorno y nunca se registran:
 * `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`. Si falta cualquiera, el proveedor
 * queda `configurado: false` y el escalamiento no intenta enviar nada — no
 * falla ruidosamente en cada corrida del cron, ni rompe el push, que es un
 * canal aparte y no depende de esto.
 */
export function proveedorMeta(): ProveedorWhatsApp {
  const token = process.env.WHATSAPP_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_ID
  const version = process.env.WHATSAPP_API_VERSION || 'v21.0'
  const idioma = configuracionMeta().idioma

  return {
    nombre: 'meta_cloud',
    configurado: Boolean(token && phoneId),
    async enviar(destino) {
      if (!token || !phoneId) {
        return { ok: false, error: 'WHATSAPP_TOKEN o WHATSAPP_PHONE_ID sin configurar' }
      }
      try {
        const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: destino.telefono,
            type: 'template',
            template: {
              name: destino.plantilla,
              language: { code: idioma },
              components: [{
                type: 'body',
                parameters: destino.variables.map(text => ({ type: 'text', text })),
              }],
            },
          }),
        })
        const json: any = await res.json().catch(() => ({}))
        if (!res.ok) {
          // El mensaje de error de Meta se guarda, el token no aparece en él.
          return { ok: false, error: json?.error?.message || `HTTP ${res.status}` }
        }
        return { ok: true, idProveedor: json?.messages?.[0]?.id }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'error de red' }
      }
    },
  }
}

/**
 * El proveedor de simulación: registra lo que habría mandado y no manda nada.
 *
 * Es el que usa el dry-run, y también el que queda activo mientras no haya
 * número ni plantillas aprobadas. Que `configurado` sea `true` es deliberado:
 * el dry-run tiene que poder correr entero.
 */
export function proveedorSimulado(registro: DestinoWhatsApp[] = []): ProveedorWhatsApp & { enviados: DestinoWhatsApp[] } {
  return {
    nombre: 'simulado',
    configurado: true,
    enviados: registro,
    async enviar(destino) {
      registro.push(destino)
      return { ok: true, idProveedor: `simulado-${registro.length}` }
    },
  }
}

/**
 * El proveedor productivo. Hoy sólo Meta; el día que haya otro, se elige acá y
 * nada más cambia.
 */
export function proveedorPorDefecto(): ProveedorWhatsApp {
  return proveedorMeta()
}
