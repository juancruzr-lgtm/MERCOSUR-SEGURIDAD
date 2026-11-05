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

export type AmbienteArca = 'produccion' | 'homologacion'

/**
 * Credenciales de FACTURACIÓN (WSFE), separadas por ambiente. No toca
 * afipConfigDesdeEnv (Padrón A13 y legajo siguen igual).
 *  - produccion:   AFIP_CERT_PEM / AFIP_KEY_PEM / AFIP_CUIT_REPRESENTADA (certificado productivo
 *                  existente). Se rechaza si AFIP_HOMO está encendido: ese certificado no es de producción.
 *  - homologacion: AFIP_HOMO_CERT_PEM / AFIP_HOMO_KEY_PEM / AFIP_HOMO_CUIT_REPRESENTADA. Nunca cae
 *                  al certificado productivo.
 */
export function afipConfigFacturacion(ambiente: AmbienteArca, env: Record<string, string | undefined> = process.env): { config?: AfipConfig; error?: string } {
  if (ambiente === 'produccion') {
    if (env.AFIP_HOMO === '1' || env.AFIP_HOMO === 'true') return { error: 'AFIP_HOMO está encendido: el certificado general no es de producción' }
    const certPem = normalizarPem(env.AFIP_CERT_PEM)
    const keyPem = normalizarPem(env.AFIP_KEY_PEM)
    // El mismo certificado sirve al Padrón A13 (que representa a AFIP_CUIT_REPRESENTADA, hoy la
    // persona titular del certificado) y a la factura, que se emite por la SRL. Para no tocar el
    // A13, facturación puede representar a otro CUIT con AFIP_FACT_CUIT_REPRESENTADA.
    const cuitRepresentada = (env.AFIP_FACT_CUIT_REPRESENTADA || env.AFIP_CUIT_REPRESENTADA || '').replace(/\D/g, '')
    if (!certPem) return { error: 'Falta AFIP_CERT_PEM' }
    if (!keyPem) return { error: 'Falta AFIP_KEY_PEM' }
    if (!cuitRepresentada) return { error: 'Falta AFIP_FACT_CUIT_REPRESENTADA (o AFIP_CUIT_REPRESENTADA)' }
    return { config: { certPem, keyPem, homo: false, cuitRepresentada } }
  }
  if (ambiente === 'homologacion') {
    const certPem = normalizarPem(env.AFIP_HOMO_CERT_PEM)
    const keyPem = normalizarPem(env.AFIP_HOMO_KEY_PEM)
    const cuitRepresentada = (env.AFIP_HOMO_CUIT_REPRESENTADA || '').replace(/\D/g, '')
    if (!certPem) return { error: 'Falta AFIP_HOMO_CERT_PEM' }
    if (!keyPem) return { error: 'Falta AFIP_HOMO_KEY_PEM' }
    if (!cuitRepresentada) return { error: 'Falta AFIP_HOMO_CUIT_REPRESENTADA' }
    if (certPem === normalizarPem(env.AFIP_CERT_PEM)) return { error: 'El certificado de homologación es el mismo que el productivo' }
    return { config: { certPem, keyPem, homo: true, cuitRepresentada } }
  }
  return { error: 'Ambiente inválido' }
}
