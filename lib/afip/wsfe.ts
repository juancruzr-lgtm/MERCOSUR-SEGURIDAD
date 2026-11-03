// lib/afip/wsfe.ts
//
// ARCA — Factura electrónica (WSFEv1): FECompUltimoAutorizado, FECAESolicitar
// y FECompConsultar. Mismo patrón que padron.ts: SOAP a mano, TA de WSAA,
// fast-xml-parser. Server-side.
//
// Reglas que este módulo hace cumplir:
//  - Un error de red, un timeout o una respuesta ilegible NO es un rechazo:
//    es 'incierta'. Antes de reintentar se consulta (FECompConsultar) con el
//    mismo tipo / punto de venta / número.
//  - Sólo 'A' con CAE y vencimiento de CAE cuenta como autorizado.
//  - Homologación y producción tienen endpoints y TA separados.

import { XMLParser } from 'fast-xml-parser'
import type { AfipTA } from '@/lib/afip/wsaa'

export const SERVICIO_WSFE = 'wsfe'

const ENDPOINT = {
  homo: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  prod: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
}
const NS = 'http://ar.gov.afip.dif.FEV1/'

/** Alícuotas de IVA (FEParamGetTiposIva). */
export const ID_IVA: Record<string, number> = { '0': 3, '10.5': 4, '21': 5, '27': 6 }

/** Condición frente al IVA del receptor (RG 5616, FEParamGetCondicionIvaReceptor). */
export const CONDICION_IVA_RECEPTOR: Record<string, number> = {
  responsable_inscripto: 1, exento: 4, consumidor_final: 5, monotributo: 6, sujeto_no_categorizado: 7,
}

export type ComprobanteWsfe = {
  tipo: number
  puntoVenta: number
  numero: number
  fecha: string // YYYY-MM-DD
  concepto: 1 | 2 | 3
  docTipo: number // 80 CUIT
  docNro: string
  condicionIvaReceptor: number
  servicioDesde?: string | null
  servicioHasta?: string | null
  vtoPago?: string | null
  netoC: number
  noGravadoC?: number
  exentoC?: number
  ivaC: number
  tributosC?: number
  totalC: number
  alicuotas: Array<{ porcentaje: string; baseC: number; importeC: number }>
  asociado?: { tipo: number; puntoVenta: number; numero: number; cuit: string; fecha?: string | null } | null
  /** Opcionales FCE (p. ej. 2101 = CBU del emisor, 27 = SCA/ADC, 22 = anulación). */
  opcionales?: Array<{ id: string; valor: string }>
}

const importe = (c: number) => (c / 100).toFixed(2)
const fecha8 = (f: string) => f.replace(/-/g, '')
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function auth(ta: AfipTA, cuit: string) {
  return `<ar:Auth><ar:Token>${esc(ta.token)}</ar:Token><ar:Sign>${esc(ta.sign)}</ar:Sign><ar:Cuit>${cuit.replace(/\D/g, '')}</ar:Cuit></ar:Auth>`
}
function sobre(cuerpo: string) {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS}"><soapenv:Header/><soapenv:Body>${cuerpo}</soapenv:Body></soapenv:Envelope>`
}

/** Valida antes de enviar: lo que ARCA rechazaría y lo que no queremos mandar nunca. */
export function validarComprobante(c: ComprobanteWsfe): string[] {
  const e: string[] = []
  const suma = c.netoC + (c.noGravadoC ?? 0) + (c.exentoC ?? 0) + c.ivaC + (c.tributosC ?? 0)
  if (suma !== c.totalC) e.push(`El total (${c.totalC}) no es la suma de sus componentes (${suma}).`)
  const ivaAlic = c.alicuotas.reduce((a, x) => a + x.importeC, 0)
  if (ivaAlic !== c.ivaC) e.push('El IVA no coincide con la suma de alícuotas.')
  const baseAlic = c.alicuotas.reduce((a, x) => a + x.baseC, 0)
  if (c.ivaC > 0 && baseAlic !== c.netoC) e.push('La base imponible de las alícuotas no coincide con el neto.')
  for (const a of c.alicuotas) if (!(a.porcentaje in ID_IVA)) e.push(`Alícuota no contemplada: ${a.porcentaje}%`)
  if (c.concepto !== 1 && (!c.servicioDesde || !c.servicioHasta || !c.vtoPago)) e.push('Servicios: faltan período de servicio o vencimiento de pago.')
  if ([2, 3, 7, 8, 202, 203].includes(c.tipo) && !c.asociado) e.push('La nota de crédito/débito necesita el comprobante asociado.')
  if ([201, 202, 203].includes(c.tipo) && !c.opcionales?.some(o => o.id === '2101' || o.id === '22')) {
    e.push('FCE: falta el CBU del emisor (opcional 2101) o la marca de anulación (22).')
  }
  if (c.docTipo === 80 && c.docNro.replace(/\D/g, '').length !== 11) e.push('CUIT del receptor inválido.')
  if (!Number.isInteger(c.numero) || c.numero < 1) e.push('Número de comprobante inválido.')
  return e
}

export function xmlUltimoAutorizado(ta: AfipTA, cuit: string, puntoVenta: number, tipo: number): string {
  return sobre(`<ar:FECompUltimoAutorizado>${auth(ta, cuit)}<ar:PtoVta>${puntoVenta}</ar:PtoVta><ar:CbteTipo>${tipo}</ar:CbteTipo></ar:FECompUltimoAutorizado>`)
}

export function xmlConsultar(ta: AfipTA, cuit: string, puntoVenta: number, tipo: number, numero: number): string {
  return sobre(`<ar:FECompConsultar>${auth(ta, cuit)}<ar:FeCompConsReq><ar:CbteTipo>${tipo}</ar:CbteTipo><ar:CbteNro>${numero}</ar:CbteNro><ar:PtoVta>${puntoVenta}</ar:PtoVta></ar:FeCompConsReq></ar:FECompConsultar>`)
}

export function xmlSolicitarCae(ta: AfipTA, cuit: string, c: ComprobanteWsfe): string {
  const servicio = c.concepto !== 1
    ? `<ar:FchServDesde>${fecha8(c.servicioDesde!)}</ar:FchServDesde><ar:FchServHasta>${fecha8(c.servicioHasta!)}</ar:FchServHasta><ar:FchVtoPago>${fecha8(c.vtoPago!)}</ar:FchVtoPago>`
    : ''
  const asoc = c.asociado
    ? `<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>${c.asociado.tipo}</ar:Tipo><ar:PtoVta>${c.asociado.puntoVenta}</ar:PtoVta><ar:Nro>${c.asociado.numero}</ar:Nro><ar:Cuit>${c.asociado.cuit.replace(/\D/g, '')}</ar:Cuit>${c.asociado.fecha ? `<ar:CbteFch>${fecha8(c.asociado.fecha)}</ar:CbteFch>` : ''}</ar:CbteAsoc></ar:CbtesAsoc>`
    : ''
  const iva = c.alicuotas.length
    ? `<ar:Iva>${c.alicuotas.map(a => `<ar:AlicIva><ar:Id>${ID_IVA[a.porcentaje]}</ar:Id><ar:BaseImp>${importe(a.baseC)}</ar:BaseImp><ar:Importe>${importe(a.importeC)}</ar:Importe></ar:AlicIva>`).join('')}</ar:Iva>`
    : ''
  const opc = c.opcionales?.length
    ? `<ar:Opcionales>${c.opcionales.map(o => `<ar:Opcional><ar:Id>${esc(o.id)}</ar:Id><ar:Valor>${esc(o.valor)}</ar:Valor></ar:Opcional>`).join('')}</ar:Opcionales>`
    : ''
  return sobre(
    `<ar:FECAESolicitar>${auth(ta, cuit)}<ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${c.puntoVenta}</ar:PtoVta><ar:CbteTipo>${c.tipo}</ar:CbteTipo></ar:FeCabReq>` +
    `<ar:FeDetReq><ar:FECAEDetRequest><ar:Concepto>${c.concepto}</ar:Concepto><ar:DocTipo>${c.docTipo}</ar:DocTipo><ar:DocNro>${c.docNro.replace(/\D/g, '')}</ar:DocNro>` +
    `<ar:CbteDesde>${c.numero}</ar:CbteDesde><ar:CbteHasta>${c.numero}</ar:CbteHasta><ar:CbteFch>${fecha8(c.fecha)}</ar:CbteFch>` +
    `<ar:ImpTotal>${importe(c.totalC)}</ar:ImpTotal><ar:ImpTotConc>${importe(c.noGravadoC ?? 0)}</ar:ImpTotConc><ar:ImpNeto>${importe(c.netoC)}</ar:ImpNeto>` +
    `<ar:ImpOpEx>${importe(c.exentoC ?? 0)}</ar:ImpOpEx><ar:ImpTrib>${importe(c.tributosC ?? 0)}</ar:ImpTrib><ar:ImpIVA>${importe(c.ivaC)}</ar:ImpIVA>` +
    `${servicio}<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz><ar:CondicionIVAReceptorId>${c.condicionIvaReceptor}</ar:CondicionIVAReceptorId>` +
    `${asoc}${iva}${opc}</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq></ar:FECAESolicitar>`,
  )
}

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false })
const asArray = (x: any): any[] => (x == null ? [] : Array.isArray(x) ? x : [x])
function buscar(node: any, clave: string): any {
  if (!node || typeof node !== 'object') return undefined
  if (clave in node) return node[clave]
  for (const k of Object.keys(node)) {
    const r = buscar(node[k], clave)
    if (r !== undefined) return r
  }
  return undefined
}
const errores = (nodo: any) => asArray(buscar(nodo, 'Errors')?.Err).map((e: any) => `${e.Code}: ${e.Msg}`)
const observaciones = (nodo: any) => asArray(buscar(nodo, 'Observaciones')?.Obs).map((e: any) => `${e.Code}: ${e.Msg}`)
const iso = (f?: string) => (f && /^\d{8}$/.test(f) ? `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}` : null)

export type ResultadoCae =
  | { resultado: 'A'; cae: string; caeVto: string; fecha: string; observaciones: string[]; crudo: any }
  | { resultado: 'R'; errores: string[]; observaciones: string[]; crudo: any }
  | { resultado: 'incierta'; motivo: string; crudo: any }

/** Interpreta la respuesta de FECAESolicitar. Sin CAE claro, no hay autorización. */
export function interpretarCae(xml: string | null, httpStatus: number | null): ResultadoCae {
  if (xml == null) return { resultado: 'incierta', motivo: 'Sin respuesta de ARCA (red o timeout)', crudo: null }
  const fault = xml.match(/<faultstring>([^<]+)<\/faultstring>/)?.[1]
  let doc: any
  try { doc = parser.parse(xml) } catch (e: any) {
    return { resultado: 'incierta', motivo: `Respuesta ilegible: ${e?.message ?? e}`, crudo: xml.slice(0, 2000) }
  }
  const res = buscar(doc, 'FECAESolicitarResult')
  if (!res) return { resultado: 'incierta', motivo: fault ? `SOAP fault: ${fault}` : `Respuesta sin resultado (HTTP ${httpStatus})`, crudo: doc }
  const det = asArray(buscar(res, 'FECAEDetResponse'))[0]
  const cab = buscar(res, 'FeCabResp')
  const resultado = String(det?.Resultado ?? cab?.Resultado ?? '')
  if (resultado === 'A' && det?.CAE && iso(det?.CAEFchVto)) {
    return { resultado: 'A', cae: String(det.CAE), caeVto: iso(det.CAEFchVto)!, fecha: iso(det.CbteFch) ?? '', observaciones: observaciones(det), crudo: res }
  }
  if (resultado === 'R' || (!resultado && errores(res).length)) {
    return { resultado: 'R', errores: errores(res), observaciones: observaciones(det), crudo: res }
  }
  return { resultado: 'incierta', motivo: `Resultado no concluyente: "${resultado}"`, crudo: res }
}

export function interpretarUltimo(xml: string): { ok: true; numero: number } | { ok: false; error: string } {
  try {
    const doc = parser.parse(xml)
    const r = buscar(doc, 'FECompUltimoAutorizadoResult')
    const errs = errores(r)
    if (errs.length) return { ok: false, error: errs.join('; ') }
    const n = Number(r?.CbteNro)
    return Number.isInteger(n) && n >= 0 ? { ok: true, numero: n } : { ok: false, error: 'Respuesta sin número' }
  } catch (e: any) {
    return { ok: false, error: `Respuesta ilegible: ${e?.message ?? e}` }
  }
}

export type ResultadoConsulta =
  | { encontrado: true; cae: string; caeVto: string; fecha: string; totalC: number; crudo: any }
  | { encontrado: false; crudo: any }
  | { error: string }

/** FECompConsultar. Código 602 = "no existe el comprobante". Cualquier otra cosa es error (no "no existe"). */
export function interpretarConsulta(xml: string): ResultadoConsulta {
  try {
    const doc = parser.parse(xml)
    const r = buscar(doc, 'FECompConsultarResult')
    if (!r) return { error: 'Respuesta sin resultado' }
    const errs = asArray(buscar(r, 'Errors')?.Err)
    if (errs.some((e: any) => String(e.Code) === '602')) return { encontrado: false, crudo: r }
    if (errs.length) return { error: errs.map((e: any) => `${e.Code}: ${e.Msg}`).join('; ') }
    const g = buscar(r, 'ResultGet')
    if (!g?.CodAutorizacion) return { error: 'La consulta no trae CAE' }
    return {
      encontrado: true, cae: String(g.CodAutorizacion), caeVto: iso(g.FchVto) ?? '', fecha: iso(g.CbteFch) ?? '',
      totalC: Math.round(Number(g.ImpTotal) * 100), crudo: r,
    }
  } catch (e: any) {
    return { error: `Respuesta ilegible: ${e?.message ?? e}` }
  }
}

async function post(homo: boolean, accion: string, cuerpo: string, timeoutMs = 25000): Promise<{ xml: string | null; status: number | null }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(homo ? ENDPOINT.homo : ENDPOINT.prod, {
      method: 'POST', signal: ctrl.signal, cache: 'no-store',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `${NS}${accion}` },
      body: cuerpo,
    })
    return { xml: await res.text(), status: res.status }
  } catch {
    return { xml: null, status: null }
  } finally {
    clearTimeout(t)
  }
}

export async function ultimoAutorizado(ta: AfipTA, o: { cuit: string; homo: boolean; puntoVenta: number; tipo: number }) {
  const r = await post(o.homo, 'FECompUltimoAutorizado', xmlUltimoAutorizado(ta, o.cuit, o.puntoVenta, o.tipo))
  return r.xml == null ? { ok: false as const, error: 'Sin respuesta de ARCA' } : interpretarUltimo(r.xml)
}

export async function solicitarCae(ta: AfipTA, o: { cuit: string; homo: boolean }, c: ComprobanteWsfe): Promise<ResultadoCae> {
  const r = await post(o.homo, 'FECAESolicitar', xmlSolicitarCae(ta, o.cuit, c))
  return interpretarCae(r.xml, r.status)
}

export async function consultarComprobante(ta: AfipTA, o: { cuit: string; homo: boolean; puntoVenta: number; tipo: number; numero: number }): Promise<ResultadoConsulta> {
  const r = await post(o.homo, 'FECompConsultar', xmlConsultar(ta, o.cuit, o.puntoVenta, o.tipo, o.numero))
  return r.xml == null ? { error: 'Sin respuesta de ARCA' } : interpretarConsulta(r.xml)
}
