// lib/afip/padron.ts
//
// AFIP/ARCA — Padrón A13 (ws_sr_padron_a13). Consulta los datos de una persona
// por CUIL/CUIT usando un TA vigente de WSAA. Devuelve nombre, apellido/razón
// social, domicilio (con localidad/provincia — útil para pre-cargar el legajo y
// evitar errores del LSD) y el estado. Server-side (necesita el TA firmado).

import { XMLParser } from 'fast-xml-parser'
import type { AfipTA } from '@/lib/afip/wsaa'

export const SERVICIO_PADRON_A13 = 'ws_sr_padron_a13'

const ENDPOINT = {
  homo: 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA13',
  prod: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA13',
}

export interface DomicilioPadron {
  calle?: string
  numero?: string
  direccion?: string          // dirección completa (ej. "MENDOZA 1744")
  localidad?: string
  codigoPostal?: string
  idProvincia?: string
  descProvincia?: string      // ej. "SANTA FE"
  tipo?: string               // LEGAL/REAL, FISCAL, etc.
  estado?: string             // CONFIRMADO / NO CONFIRMADO
}

export interface PersonaPadron {
  idPersona: string
  tipoPersona?: string        // FISICA | JURIDICA
  estado?: string             // ACTIVO, etc.
  nombre?: string
  apellido?: string
  razonSocial?: string
  tipoDocumento?: string
  numeroDocumento?: string
  domicilios: DomicilioPadron[]
  raw: any
}

export interface ResultadoPadron {
  ok: boolean
  persona?: PersonaPadron
  error?: string
}

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false })

/** Consulta padrón A13 para un CUIL/CUIT. `cuitRepresentada` = la empresa. */
export async function consultarPadronA13(
  idPersona: string,
  ta: AfipTA,
  opts: { cuitRepresentada: string; homo: boolean },
): Promise<ResultadoPadron> {
  const soap = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a13="http://a13.soap.ws.server.puc.sr/">` +
    `<soapenv:Header/><soapenv:Body><a13:getPersona>` +
    `<token>${ta.token}</token><sign>${ta.sign}</sign>` +
    `<cuitRepresentada>${opts.cuitRepresentada}</cuitRepresentada>` +
    `<idPersona>${String(idPersona).replace(/\D/g, '')}</idPersona>` +
    `</a13:getPersona></soapenv:Body></soapenv:Envelope>`

  const res = await fetch(opts.homo ? ENDPOINT.homo : ENDPOINT.prod, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""' },
    body: soap,
  })
  const txt = await res.text()

  const fault = txt.match(/<faultstring>([^<]+)<\/faultstring>/)?.[1]
  if (fault) {
    // "La Clave (CUIT/CUIL) consultada es inexistente" = persona no encontrada.
    return { ok: false, error: fault }
  }

  try {
    const doc = parser.parse(txt)
    const persona = buscarPersona(doc)
    if (!persona) return { ok: false, error: 'Respuesta sin datos de persona' }
    return { ok: true, persona: normalizar(String(idPersona).replace(/\D/g, ''), persona) }
  } catch (e: any) {
    return { ok: false, error: `No se pudo parsear la respuesta: ${e?.message || e}` }
  }
}

/** Ubica el nodo `persona` dentro del sobre SOAP, sin depender del prefijo. */
function buscarPersona(node: any): any {
  if (!node || typeof node !== 'object') return null
  if (node.persona) return node.persona
  for (const k of Object.keys(node)) {
    const found = buscarPersona(node[k])
    if (found) return found
  }
  return null
}

const asArray = (x: any): any[] => (x == null ? [] : Array.isArray(x) ? x : [x])

function normalizar(idPersona: string, p: any): PersonaPadron {
  const domicilios: DomicilioPadron[] = asArray(p.domicilio).map((d: any) => ({
    calle: d?.calle,
    numero: d?.numero != null ? String(d.numero) : undefined,
    direccion: d?.direccion,
    localidad: d?.localidad,
    codigoPostal: d?.codigoPostal != null ? String(d.codigoPostal) : undefined,
    idProvincia: d?.idProvincia != null ? String(d.idProvincia) : undefined,
    descProvincia: d?.descripcionProvincia,
    tipo: d?.tipoDomicilio,
    estado: d?.estadoDomicilio,
  }))
  return {
    idPersona,
    tipoPersona: p?.tipoPersona,
    estado: p?.estadoClave,
    nombre: p?.nombre,
    apellido: p?.apellido,
    razonSocial: p?.razonSocial,
    tipoDocumento: p?.tipoDocumento,
    numeroDocumento: p?.numeroDocumento != null ? String(p.numeroDocumento) : undefined,
    domicilios,
    raw: p,
  }
}
