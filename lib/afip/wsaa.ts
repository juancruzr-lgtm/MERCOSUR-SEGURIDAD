// lib/afip/wsaa.ts
//
// AFIP/ARCA — WSAA (Web Service de Autenticación y Autorización). Firma el
// "login ticket request" (TRA) como CMS/PKCS#7 con el certificado + clave de la
// empresa y obtiene el Ticket de Acceso (TA = token + sign), válido ~12 h.
//
// Server-side ÚNICAMENTE (usa la clave privada). El TA se CACHEA y se reusa hasta
// que expira: WSAA rechaza pedir uno nuevo mientras haya uno vigente
// ("El CEE ya posee un TA valido"). La firma es pura Node (node-forge), sin openssl.

import forge from 'node-forge'

export interface AfipTA {
  token: string
  sign: string
  expira: number // epoch ms
}

const ENDPOINT = {
  homo: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  prod: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
}

function isoConTz(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+00:00')
}

/** TRA: pide acceso a un servicio, con ventana de validez chica. */
function construirTRA(service: string): string {
  const now = Date.now()
  return `<?xml version="1.0" encoding="UTF-8"?>\n<loginTicketRequest version="1.0"><header>` +
    `<uniqueId>${Math.floor(now / 1000)}</uniqueId>` +
    `<generationTime>${isoConTz(now - 120000)}</generationTime>` +
    `<expirationTime>${isoConTz(now + 600000)}</expirationTime>` +
    `</header><service>${service}</service></loginTicketRequest>`
}

/** Firma el TRA como CMS PKCS#7 (contenido embebido) y lo devuelve en base64. */
function firmarTRA(tra: string, certPem: string, keyPem: string): string {
  const p7 = forge.pkcs7.createSignedData()
  p7.content = forge.util.createBuffer(tra, 'utf8')
  p7.addCertificate(certPem)
  p7.addSigner({
    key: keyPem,
    certificate: certPem,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as any },
    ],
  })
  p7.sign() // no detached: el contenido va embebido (= openssl smime -nodetach)
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes()
  return forge.util.encode64(der)
}

export interface AfipCreds { certPem: string; keyPem: string; homo: boolean }

/** Pide un TA nuevo a WSAA. Lanza si WSAA devuelve fault. */
export async function solicitarTA(service: string, creds: AfipCreds): Promise<AfipTA> {
  const cms = firmarTRA(construirTRA(service), creds.certPem, creds.keyPem)
  const soap = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">` +
    `<soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`
  const res = await fetch(creds.homo ? ENDPOINT.homo : ENDPOINT.prod, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""' },
    body: soap,
  })
  const txt = await res.text()
  const dec = txt.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  const token = dec.match(/<token>([^<]+)<\/token>/)?.[1]
  const sign = dec.match(/<sign>([^<]+)<\/sign>/)?.[1]
  const exp = dec.match(/<expirationTime>([^<]+)<\/expirationTime>/)?.[1]
  if (!token || !sign) {
    const fault = txt.match(/<faultstring>([^<]+)<\/faultstring>/)?.[1] || `HTTP ${res.status}`
    throw new Error(`WSAA (${service}): ${fault}`)
  }
  return { token, sign, expira: exp ? Date.parse(exp) : Date.now() + 11 * 3600 * 1000 }
}

/** Caché de TA (persistente entre invocaciones serverless). */
export interface TAStore {
  get(service: string): Promise<AfipTA | null>
  set(service: string, ta: AfipTA): Promise<void>
}

/**
 * Devuelve un TA vigente para el servicio: reusa el cacheado si le quedan >5 min;
 * si no, pide uno nuevo y lo guarda. Evita el error "ya posee un TA válido".
 */
export async function obtenerTA(service: string, creds: AfipCreds, store?: TAStore): Promise<AfipTA> {
  if (store) {
    const cached = await store.get(service)
    if (cached && cached.expira - Date.now() > 5 * 60 * 1000) return cached
  }
  const ta = await solicitarTA(service, creds)
  if (store) await store.set(service, ta)
  return ta
}
