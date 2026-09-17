// lib/afip/config.ts
//
// Configuración de AFIP/ARCA leída de variables de entorno (secretos de Vercel).
// El certificado y la clave privada viven SÓLO como env del servidor, nunca en
// el repo ni en el cliente. En Vercel el PEM se puede guardar con saltos de
// línea reales o con "\n" escapados: acá se normalizan las dos formas.

import type { AfipCreds } from '@/lib/afip/wsaa'

export interface AfipConfig extends AfipCreds {
  cuitRepresentada: string // CUIT de la empresa (MERCOSUR) que representa el cert
}

function normalizarPem(v: string | undefined): string {
  return (v || '').replace(/\\n/g, '\n').trim()
}

export function afipConfigDesdeEnv(): { config?: AfipConfig; error?: string } {
  const certPem = normalizarPem(process.env.AFIP_CERT_PEM)
  const keyPem = normalizarPem(process.env.AFIP_KEY_PEM)
  const cuitRepresentada = (process.env.AFIP_CUIT_REPRESENTADA || '').replace(/\D/g, '')
  // Producción por defecto; poner AFIP_HOMO=1 para pegarle a homologación.
  const homo = process.env.AFIP_HOMO === '1' || process.env.AFIP_HOMO === 'true'

  if (!certPem) return { error: 'Falta AFIP_CERT_PEM' }
  if (!keyPem) return { error: 'Falta AFIP_KEY_PEM' }
  if (!cuitRepresentada) return { error: 'Falta AFIP_CUIT_REPRESENTADA' }

  return { config: { certPem, keyPem, homo, cuitRepresentada } }
}
