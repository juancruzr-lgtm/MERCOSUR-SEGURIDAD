// lib/afip/constancia.ts
//
// AFIP/ARCA — Constancia de Inscripción (ws_sr_constancia_inscripcion, alcance 5).
// Módulo HERMANO de padron.ts: mismo patrón SOAP + WSAA (obtenerTA) + fast-xml-parser.
// Consulta la situación fiscal de un CUIT (cliente/proveedor): condición frente al
// IVA, impuestos, actividades y domicilio. Sirve para validar antes de facturar.
//
// Se representa a UNO MISMO (cuitRepresentada = Juan Cruz, igual que A13): el CUIT
// a validar va en idPersona; NO hace falta representar a MERCOSUR. Server-side.

import { XMLParser } from 'fast-xml-parser'
import type { AfipTA } from '@/lib/afip/wsaa'

export const SERVICIO_CONSTANCIA = 'ws_sr_constancia_inscripcion'

// El servicio de constancia se sirve en personaServiceA5 (getPersona_v2).
const ENDPOINT = {
  homo: 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5',
  prod: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5',
}

export interface ImpuestoConstancia {
  idImpuesto?: string
  descripcion?: string
  estado?: string
  periodo?: string
}

export interface ActividadConstancia {
  idActividad?: string
  descripcion?: string
  nomenclador?: string
  orden?: string
  periodo?: string
}

export interface DomicilioConstancia {
  direccion?: string
  localidad?: string
  codPostal?: string
  idProvincia?: string
  descProvincia?: string
  tipo?: string
}

// Condición frente al IVA derivada de los impuestos inscriptos.
export type CondicionIVA = 'Responsable Inscripto' | 'Monotributista' | 'Exento / No alcanzado' | 'Desconocida'

export interface Constancia {
  idPersona: string
  tipoPersona?: string           // FISICA | JURIDICA
  estadoClave?: string           // ACTIVO, etc.
  razonSocial?: string
  apellido?: string
  nombre?: string
  condicionIVA: CondicionIVA
  categoriaMonotributo?: string
  domicilioFiscal?: DomicilioConstancia
  impuestos: ImpuestoConstancia[]
  actividades: ActividadConstancia[]
  raw: any
}

export interface ResultadoConstancia {
  ok: boolean
  constancia?: Constancia
  error?: string
}

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false })

const NS = 'http://a5.soap.ws.server.puc.sr/'

/** Consulta la Constancia de Inscripción de un CUIT. `cuitRepresentada` = uno mismo. */
export async function consultarConstancia(
  idPersona: string,
  ta: AfipTA,
  opts: { cuitRepresentada: string; homo: boolean },
): Promise<ResultadoConstancia> {
  const soap = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="${NS}">` +
    `<soapenv:Header/><soapenv:Body><a5:getPersona_v2>` +
    `<token>${ta.token}</token><sign>${ta.sign}</sign>` +
    `<cuitRepresentada>${opts.cuitRepresentada.replace(/\D/g, '')}</cuitRepresentada>` +
    `<idPersona>${String(idPersona).replace(/\D/g, '')}</idPersona>` +
    `</a5:getPersona_v2></soapenv:Body></soapenv:Envelope>`

  const res = await fetch(opts.homo ? ENDPOINT.homo : ENDPOINT.prod, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""' },
    body: soap,
  })
  const txt = await res.text()

  const fault = txt.match(/<faultstring>([^<]+)<\/faultstring>/)?.[1]
  if (fault) return { ok: false, error: fault }

  try {
    const doc = parser.parse(txt)
    const persona = buscar(doc, 'persona') || buscar(doc, 'personaReturn')
    if (!persona) return { ok: false, error: 'Respuesta sin datos de persona' }
    return { ok: true, constancia: normalizar(String(idPersona).replace(/\D/g, ''), persona) }
  } catch (e: any) {
    return { ok: false, error: `No se pudo parsear la respuesta: ${e?.message || e}` }
  }
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

/** Junta TODOS los nodos con esa clave, en cualquier nivel (impuesto/actividad). */
function juntar(node: any, nombre: string, acc: any[] = []): any[] {
  if (!node || typeof node !== 'object') return acc
  for (const k of Object.keys(node)) {
    if (k === nombre) {
      const v = node[k]
      if (Array.isArray(v)) acc.push(...v); else acc.push(v)
    } else {
      juntar(node[k], nombre, acc)
    }
  }
  return acc
}

function derivarCondicionIVA(impuestos: ImpuestoConstancia[]): CondicionIVA {
  const ids = new Set(impuestos.map(i => String(i.idImpuesto)))
  if (ids.has('30')) return 'Responsable Inscripto'   // IVA
  if (ids.has('20')) return 'Monotributista'          // Monotributo
  if (impuestos.length) return 'Exento / No alcanzado'
  return 'Desconocida'
}

function normalizar(idPersona: string, p: any): Constancia {
  const impuestos: ImpuestoConstancia[] = juntar(p, 'impuesto').map((i: any) => ({
    idImpuesto: i?.idImpuesto != null ? String(i.idImpuesto) : undefined,
    descripcion: i?.descripcionImpuesto,
    estado: i?.estado,
    periodo: i?.periodo != null ? String(i.periodo) : undefined,
  }))
  const actividades: ActividadConstancia[] = juntar(p, 'actividad').map((a: any) => ({
    idActividad: a?.idActividad != null ? String(a.idActividad) : undefined,
    descripcion: a?.descripcionActividad,
    nomenclador: a?.nomenclador != null ? String(a.nomenclador) : undefined,
    orden: a?.orden != null ? String(a.orden) : undefined,
    periodo: a?.periodo != null ? String(a.periodo) : undefined,
  }))
  const dom = buscar(p, 'domicilioFiscal')
  const domicilioFiscal: DomicilioConstancia | undefined = dom ? {
    direccion: dom?.direccion,
    localidad: dom?.localidad,
    codPostal: dom?.codPostal != null ? String(dom.codPostal) : undefined,
    idProvincia: dom?.idProvincia != null ? String(dom.idProvincia) : undefined,
    descProvincia: dom?.descripcionProvincia,
    tipo: dom?.tipoDomicilio,
  } : undefined

  return {
    idPersona,
    tipoPersona: p?.tipoPersona,
    estadoClave: p?.estadoClave,
    razonSocial: p?.razonSocial,
    apellido: p?.apellido,
    nombre: p?.nombre,
    condicionIVA: derivarCondicionIVA(impuestos),
    categoriaMonotributo: buscar(p, 'categoriaMonotributo') ?? undefined,
    domicilioFiscal,
    impuestos,
    actividades,
    raw: p,
  }
}
