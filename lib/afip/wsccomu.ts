// lib/afip/wsccomu.ts
//
// AFIP/ARCA — WSCCOMU (veconsumerws): Consumir Comunicaciones de la Ventanilla
// Electrónica / Domicilio Fiscal Electrónico (DFE). Prueba técnica para ver si
// las comunicaciones publicadas por AFIP (p.ej. una consulta de Relaciones
// Laborales Activas de Simplificación Registral) pueden leerse por web service y
// si traen un adjunto con la nómina.
//
// Reutiliza WSAA/TA de lib/afip/wsaa (obtenerTA) — NO duplica autenticación.
// El servicio WSAA es `veconsumerws`. Contrato: WSDL SOAP 1.2 document/literal en
// https://infraestructura.afip.gob.ar/ve-ws/services/veconsumer?wsdl
//
// Server-side (usa el TA firmado). Errores tipados (VentanillaWSFault).

import { XMLParser } from 'fast-xml-parser'
import type { AfipTA } from '@/lib/afip/wsaa'

export const SERVICIO_WSCCOMU = 'veconsumerws'

/**
 * Sistema publicador de Ventanilla Electrónica confirmado en PRODUCCIÓN para
 * Simplificación Registral (id=25, "Simplificación Registral"). Se usa sólo como
 * dato para filtrar/buscar comunicaciones; NO se infiere alta/baja acá.
 */
export const PUBLICADOR_SIMPLIFICACION_REGISTRAL = 25

const ENDPOINT = 'https://infraestructura.afip.gob.ar/ve-ws/services/veconsumer'

const NS_TYPES = 'http://ve.tecno.afip.gov.ar/domain/service/ws/types'
const NS_CORE = 'http://core.tecno.afip.gov.ar/model/ws/types'
const NS_SOAP = 'http://www.w3.org/2003/05/soap-envelope'

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false })

export interface WsccomuError {
  ok: false
  faultCode?: string
  faultMessage: string
  category?: string
}

export interface SistemaPublicador {
  id: string
  descripcion: string
  certCNs?: string
  subservicios: { nombre: string; descripcion: string }[]
}

export interface ComunicacionResumen {
  idComunicacion: string
  cuitDestinatario?: string
  fechaPublicacion?: string
  fechaVencimiento?: string
  sistemaPublicador?: string
  sistemaPublicadorDesc?: string
  estado?: string
  estadoDesc?: string
  asunto?: string
  prioridad?: string
  tieneAdjunto?: boolean
  referencia1?: string
  referencia2?: string
}

export interface AdjuntoComunicacion {
  filename?: string
  contentSize?: string
  md5?: string
  compressed?: boolean
  signed?: boolean
  encrypted?: boolean
  contentBase64?: string // contenido embebido (base64) si vino inline o por MTOM
  contentLen?: number    // bytes decodificados (para el informe)
}

export interface ComunicacionCompleta extends ComunicacionResumen {
  mensaje?: string
  tiempoDeVida?: string
  adjuntos: AdjuntoComunicacion[]
}

/** Fragmento <authRequest> con el TA firmado y la CUIT que se representa. */
function authXml(ta: AfipTA, cuitRepresentada: string): string {
  return `<authRequest>` +
    `<core:token>${ta.token}</core:token>` +
    `<core:sign>${ta.sign}</core:sign>` +
    `<core:cuitRepresentada>${cuitRepresentada.replace(/\D/g, '')}</core:cuitRepresentada>` +
    `</authRequest>`
}

/** Arma el sobre SOAP 1.2 para una operación de WSCCOMU. */
function sobre(operacion: string, cuerpoInterno: string): string {
  return `<soap:Envelope xmlns:soap="${NS_SOAP}">` +
    `<soap:Body>` +
    `<vewst:${operacion} xmlns:vewst="${NS_TYPES}" xmlns:core="${NS_CORE}">` +
    cuerpoInterno +
    `</vewst:${operacion}>` +
    `</soap:Body></soap:Envelope>`
}

/**
 * POST del sobre. AFIP responde SIEMPRE en MTOM/multipart (aun sin adjuntos), así
 * que desenvolvemos acá: devolvemos el XML raíz (SOAP) ya limpio y el mapa de
 * partes binarias (Content-ID → base64) para los adjuntos.
 */
async function postSoap(soap: string): Promise<{ xml: string; partes: Map<string, string> }> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
    body: soap,
  })
  const buf = await res.arrayBuffer()
  return separarMtom(buf, res.headers.get('content-type') || '')
}

/** Busca recursivamente el primer nodo cuya clave (sin prefijo) sea `nombre`. */
function buscar(node: any, nombre: string): any {
  if (!node || typeof node !== 'object') return null
  if (node[nombre] !== undefined) return node[nombre]
  for (const k of Object.keys(node)) {
    const found = buscar(node[k], nombre)
    if (found !== null && found !== undefined) return found
  }
  return null
}

const asArray = (x: any): any[] => (x == null ? [] : Array.isArray(x) ? x : [x])

/** Extrae un fault (SOAP 1.2 o VentanillaWSFault) del XML, o null. */
function faultDe(doc: any): WsccomuError | null {
  const vf = buscar(doc, 'VentanillaWSFault')
  if (vf) return { ok: false, faultCode: vf.faultCode, faultMessage: vf.faultMessage || 'VentanillaWSFault', category: vf.category }
  const fault = buscar(doc, 'Fault')
  if (fault) {
    const reason = buscar(fault, 'Text') || buscar(fault, 'faultstring') || 'SOAP Fault'
    const code = buscar(fault, 'Value')
    return { ok: false, faultCode: typeof code === 'string' ? code : undefined, faultMessage: typeof reason === 'string' ? reason : JSON.stringify(reason) }
  }
  return null
}

/**
 * Separa un cuerpo MTOM/XOP (multipart/related): devuelve el XML raíz (SOAP) y
 * un mapa de Content-ID → contenido base64 de cada parte binaria. Trabaja a nivel
 * de bytes (latin1) para no corromper los adjuntos; el XML raíz se re-decodifica
 * como UTF-8. Si la respuesta no es multipart, `partes` queda vacío.
 */
function separarMtom(buf: ArrayBuffer, contentType: string): { xml: string; partes: Map<string, string> } {
  const partes = new Map<string, string>()
  const raw = Buffer.from(buf)
  const m = /boundary="?([^";]+)"?/i.exec(contentType || '')
  if (!/multipart/i.test(contentType || '') || !m) {
    return { xml: raw.toString('utf8'), partes }
  }
  const boundary = '--' + m[1]
  const bloques = raw.toString('latin1').split(boundary)
  let xml = ''
  for (const bloque of bloques) {
    const sep = bloque.indexOf('\r\n\r\n')
    if (sep < 0) continue
    const headers = bloque.slice(0, sep)
    const cuerpoBytes = Buffer.from(bloque.slice(sep + 4).replace(/\r\n$/, ''), 'latin1')
    if (/application\/xop\+xml|type="application\/soap/i.test(headers)) {
      if (!xml) xml = cuerpoBytes.toString('utf8')
    } else {
      const cid = /Content-ID:\s*<?([^>\r\n]+)>?/i.exec(headers)?.[1]
      if (cid) partes.set(cid.trim(), cuerpoBytes.toString('base64'))
    }
  }
  return { xml: xml || raw.toString('utf8'), partes }
}

// ---------------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------------

export async function dummy(): Promise<{ ok: true; dbserver: string; appserver: string; authserver: string } | WsccomuError> {
  const soap = `<soap:Envelope xmlns:soap="${NS_SOAP}"><soap:Body><tns:dummy xmlns:tns="http://ve.tecno.afip.gov.ar/domain/service/ws"/></soap:Body></soap:Envelope>`
  const { xml } = await postSoap(soap)
  const doc = parser.parse(xml)
  const f = faultDe(doc); if (f) return f
  const r = buscar(doc, 'DummyResult') || {}
  return { ok: true, dbserver: r.dbserver, appserver: r.appserver, authserver: r.authserver }
}

/** ETAPA 3 — qué sistemas publicadores puede consumir esta CUIT. */
export async function consultarSistemasPublicadores(
  ta: AfipTA,
  cuitRepresentada: string,
): Promise<{ ok: true; sistemas: SistemaPublicador[] } | WsccomuError> {
  const soap = sobre('consultarSistemasPublicadores', authXml(ta, cuitRepresentada))
  const { xml } = await postSoap(soap)
  const doc = parser.parse(xml)
  const f = faultDe(doc); if (f) return f
  const sistemas = asArray(buscar(doc, 'Sistema')).map((s: any) => ({
    id: String(s.id),
    descripcion: s.descripcion,
    certCNs: s.certCNs,
    subservicios: asArray(s?.subservicios?.subservicio).map((ss: any) => ({ nombre: ss.nombre, descripcion: ss.descripcion })),
  }))
  return { ok: true, sistemas }
}

/** ETAPA 4 — lista de comunicaciones (paginada). */
export async function consultarComunicaciones(
  ta: AfipTA,
  cuitRepresentada: string,
  filtro: { fechaDesde: string; fechaHasta?: string; sistemaPublicadorId?: string; tieneAdjunto?: boolean; pagina?: number; resultadosPorPagina?: number } ,
): Promise<{ ok: true; pagina: number; totalPaginas: number; totalItems: number; comunicaciones: ComunicacionResumen[] } | WsccomuError> {
  const f: string[] = [`<fechaDesde>${filtro.fechaDesde}</fechaDesde>`]
  if (filtro.fechaHasta) f.push(`<fechaHasta>${filtro.fechaHasta}</fechaHasta>`)
  if (filtro.tieneAdjunto !== undefined) f.push(`<tieneAdjunto>${filtro.tieneAdjunto}</tieneAdjunto>`)
  if (filtro.sistemaPublicadorId) f.push(`<sistemaPublicadorId>${filtro.sistemaPublicadorId}</sistemaPublicadorId>`)
  f.push(`<pagina>${filtro.pagina ?? 1}</pagina>`)
  if (filtro.resultadosPorPagina) f.push(`<resultadosPorPagina>${filtro.resultadosPorPagina}</resultadosPorPagina>`)

  const soap = sobre('consultarComunicaciones', authXml(ta, cuitRepresentada) + `<filter>${f.join('')}</filter>`)
  const { xml } = await postSoap(soap)
  const doc = parser.parse(xml)
  const fault = faultDe(doc); if (fault) return fault
  const rp = buscar(doc, 'RespuestaPaginada') || {}
  const comunicaciones = asArray(buscar(rp, 'ComunicacionSimplificada')).map(mapResumen)
  return {
    ok: true,
    pagina: Number(rp.pagina || 1),
    totalPaginas: Number(rp.totalPaginas || 1),
    totalItems: Number(rp.totalItems || comunicaciones.length),
    comunicaciones,
  }
}

/** ETAPA 5 — consume una comunicación con sus adjuntos (soporta MTOM). */
export async function consumirComunicacion(
  ta: AfipTA,
  cuitRepresentada: string,
  idComunicacion: string,
  incluirAdjuntos = true,
): Promise<{ ok: true; comunicacion: ComunicacionCompleta } | WsccomuError> {
  const soap = sobre(
    'consumirComunicacion',
    authXml(ta, cuitRepresentada) + `<idComunicacion>${idComunicacion}</idComunicacion><incluirAdjuntos>${incluirAdjuntos}</incluirAdjuntos>`,
  )
  const { xml, partes } = await postSoap(soap)
  const doc = parser.parse(xml)
  const fault = faultDe(doc); if (fault) return fault

  const c = buscar(doc, 'Comunicacion') || {}
  const base = mapResumen(c)
  const adjuntos: AdjuntoComunicacion[] = asArray(buscar(c, 'adjunto')).map((a: any) => {
    // El contenido puede venir inline (base64) o por MTOM (xop:Include href="cid:...").
    let contentBase64: string | undefined
    const inline = a?.content
    if (typeof inline === 'string' && inline.length) {
      contentBase64 = inline
    } else {
      const href = buscar(a?.content, 'Include')?.['@_href'] || buscar(a, 'Include')?.['@_href']
      if (href) {
        const cid = String(href).replace(/^cid:/, '')
        contentBase64 = partes.get(cid) || partes.get(decodeURIComponent(cid))
      }
    }
    let contentLen: number | undefined
    if (contentBase64) { try { contentLen = Buffer.from(contentBase64, 'base64').length } catch {} }
    return {
      filename: a?.filename,
      contentSize: a?.contentSize != null ? String(a.contentSize) : undefined,
      md5: a?.md5,
      compressed: a?.compressed === 'true' || a?.compressed === true,
      signed: a?.signed === 'true' || a?.signed === true,
      encrypted: a?.encrypted === 'true' || a?.encrypted === true,
      contentBase64,
      contentLen,
    }
  })

  return { ok: true, comunicacion: { ...base, mensaje: c.mensaje, tiempoDeVida: c.tiempoDeVida != null ? String(c.tiempoDeVida) : undefined, adjuntos } }
}

function mapResumen(c: any): ComunicacionResumen {
  return {
    idComunicacion: String(c.idComunicacion),
    cuitDestinatario: c.cuitDestinatario != null ? String(c.cuitDestinatario) : undefined,
    fechaPublicacion: c.fechaPublicacion,
    fechaVencimiento: c.fechaVencimiento,
    sistemaPublicador: c.sistemaPublicador != null ? String(c.sistemaPublicador) : undefined,
    sistemaPublicadorDesc: c.sistemaPublicadorDesc,
    estado: c.estado != null ? String(c.estado) : undefined,
    estadoDesc: c.estadoDesc,
    asunto: c.asunto,
    prioridad: c.prioridad != null ? String(c.prioridad) : undefined,
    tieneAdjunto: c.tieneAdjunto === 'true' || c.tieneAdjunto === true,
    referencia1: c.referencia1,
    referencia2: c.referencia2,
  }
}
