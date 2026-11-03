/**
 * lib/facturacion/comprobante-pdf.ts
 *
 * Representación impresa (PDF) de un comprobante ya AUTORIZADO por ARCA.
 * Se arma sólo con datos fiscales registrados (nunca recalcula importes).
 *
 *  · QR según "Especificaciones del QR incluido en las facturas electrónicas"
 *    (ARCA, versión 1 del JSON): {URL}?p={JSON en Base64}, con
 *    URL = https://www.arca.gob.ar/fe/qr/ ; tipoCodAut "E" (CAE).
 *  · Datos del emisor exigidos en el comprobante (razón social, domicilio
 *    comercial, condición frente al IVA, CUIT, Ingresos Brutos e inicio de
 *    actividades) salen de fact_config 'emisor'. Si falta alguno NO se genera:
 *    no se inventan datos fiscales.
 *  · Factura B a consumidor final: leyenda "Régimen de Transparencia Fiscal al
 *    Consumidor (Ley 27.743)" con el IVA contenido (RG 5614/2024).
 *  · Homologación: marca "SIN VALIDEZ FISCAL".
 */

import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'
import { TIPOS_COMPROBANTE } from './comprobantes'
import { formatoPesos } from './dinero'

export const URL_QR_ARCA = 'https://www.arca.gob.ar/fe/qr/'

export type DatosQr = {
  fecha: string; cuit: string; ptoVta: number; tipoCmp: number; nroCmp: number; importeC: number
  moneda?: string; ctz?: number; tipoDocRec?: number | null; nroDocRec?: string | null; codAut: string
}

/** Texto que codifica el QR (JSON v1 en Base64, orden de campos del instructivo). */
export function textoQr(d: DatosQr): string {
  const json: Record<string, unknown> = {
    ver: 1, fecha: d.fecha, cuit: Number(d.cuit), ptoVta: d.ptoVta, tipoCmp: d.tipoCmp, nroCmp: d.nroCmp,
    importe: Number((d.importeC / 100).toFixed(2)), moneda: d.moneda ?? 'PES', ctz: d.ctz ?? 1,
  }
  if (d.tipoDocRec != null && d.nroDocRec) { json.tipoDocRec = d.tipoDocRec; json.nroDocRec = Number(String(d.nroDocRec).replace(/\D/g, '')) }
  json.tipoCodAut = 'E'
  json.codAut = Number(d.codAut)
  return `${URL_QR_ARCA}?p=${Buffer.from(JSON.stringify(json), 'utf8').toString('base64')}`
}

export type Emisor = {
  razon_social: string; domicilio: string; condicion_iva: string; cuit: string; iibb: string; inicio_actividades: string; cbu_fce?: string | null
}
export const CAMPOS_EMISOR: Array<keyof Emisor> = ['razon_social', 'domicilio', 'condicion_iva', 'cuit', 'iibb', 'inicio_actividades']

export type DatosPdf = {
  ambiente: 'produccion' | 'homologacion'
  tipo: number; punto_venta: number; numero: number; fecha_emision: string
  servicio_desde?: string | null; servicio_hasta?: string | null; vto_pago?: string | null
  neto_c: number; iva_c: number; exento_c?: number; no_gravado_c?: number; tributos_c?: number; total_c: number
  cae: string; cae_vto: string
  receptor: { cuit: string; razon_social: string; condicion_iva: string | null; domicilio: string | null }
  texto: string | null
  lineas: Array<{ concepto: string; cantidad: string; precio: string; neto_c: number }>
  alicuota: string | null // '21', '10.5'… (una sola por comprobante)
  asociado?: { tipo: number; punto_venta: number; numero: number; fecha: string } | null
  condicion_venta: string
}

const CONDICION: Record<string, string> = {
  responsable_inscripto: 'IVA Responsable Inscripto', exento: 'IVA Sujeto Exento', consumidor_final: 'Consumidor Final',
  monotributo: 'Responsable Monotributo', sujeto_no_categorizado: 'Sujeto No Categorizado',
}

/** Lo que falta para poder emitir el PDF (vacío = se puede). */
export function faltantesPdf(emisor: Partial<Emisor> | null, d: Pick<DatosPdf, 'receptor' | 'cae' | 'cae_vto'>): string[] {
  const f: string[] = []
  for (const k of CAMPOS_EMISOR) if (!String(emisor?.[k] ?? '').trim()) f.push(`Emisor: ${k}`)
  if (!d.receptor.condicion_iva) f.push('Receptor: condición frente al IVA')
  if (!String(d.receptor.domicilio ?? '').trim()) f.push('Receptor: domicilio')
  if (!/^\d{14}$/.test(d.cae)) f.push('CAE')
  if (!d.cae_vto) f.push('Vencimiento del CAE')
  return f
}

const f8 = (n: number, l: number) => String(n).padStart(l, '0')
const fechaAr = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')
const cuitG = (c: string) => { const x = c.replace(/\D/g, ''); return x.length === 11 ? `${x.slice(0, 2)}-${x.slice(2, 10)}-${x.slice(10)}` : c }

/** Reparte el total de una factura B entre las líneas (precio final), cuadrando el último centavo. */
export function importesFinalesB(lineasNeto: number[], netoTotal: number, total: number): number[] {
  if (!lineasNeto.length || netoTotal <= 0) return lineasNeto.map(() => 0)
  const out = lineasNeto.map(n => Math.round((n * total) / netoTotal))
  out[out.length - 1] += total - out.reduce((a, b) => a + b, 0)
  return out
}

export async function generarPdfComprobante(d: DatosPdf, emisor: Emisor): Promise<Uint8Array> {
  const faltan = faltantesPdf(emisor, d)
  if (faltan.length) throw new Error(`No se genera el PDF: faltan ${faltan.join(', ')}`)
  const t = TIPOS_COMPROBANTE[d.tipo]
  if (!t) throw new Error(`Tipo de comprobante no contemplado: ${d.tipo}`)
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210, M = 12
  doc.setLineWidth(0.3)

  // Encabezado: letra y código en el centro, emisor a la izquierda, comprobante a la derecha.
  doc.rect(M, M, W - 2 * M, 48)
  doc.line(W / 2, M + 16, W / 2, M + 48)
  doc.rect(W / 2 - 9, M, 18, 16)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.text(t.letra, W / 2, M + 10, { align: 'center' })
  doc.setFontSize(7); doc.text(`COD. ${f8(d.tipo, 3)}`, W / 2, M + 14, { align: 'center' })
  doc.setFontSize(9); doc.text('ORIGINAL', W - M - 2, M + 5, { align: 'right' })

  doc.setFontSize(13); doc.text(emisor.razon_social, M + 3, M + 24, { maxWidth: W / 2 - M - 6 })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  doc.text([`Domicilio comercial: ${emisor.domicilio}`, `Condición frente al IVA: ${emisor.condicion_iva}`], M + 3, M + 34, { maxWidth: W / 2 - M - 6 })

  const titulo = t.fce ? t.nombre.toUpperCase() : t.clase === 'factura' ? 'FACTURA' : t.clase === 'nota_credito' ? 'NOTA DE CRÉDITO' : 'NOTA DE DÉBITO'
  doc.setFont('helvetica', 'bold'); doc.setFontSize(t.fce ? 9 : 14); doc.text(titulo, W / 2 + 5, M + 23, { maxWidth: W / 2 - M - 8 })
  doc.setFontSize(9); doc.setFont('helvetica', 'normal')
  doc.text([
    `Punto de Venta: ${f8(d.punto_venta, 5)}    Comp. Nro: ${f8(d.numero, 8)}`,
    `Fecha de Emisión: ${fechaAr(d.fecha_emision)}`,
    `CUIT: ${cuitG(emisor.cuit)}`,
    `Ingresos Brutos: ${emisor.iibb}`,
    `Fecha de Inicio de Actividades: ${emisor.inicio_actividades}`,
  ], W / 2 + 5, M + 31)

  // Período facturado (servicios) y vencimiento para el pago informado a ARCA.
  let y = M + 52
  doc.rect(M, y, W - 2 * M, 8)
  doc.text(`Período Facturado Desde: ${fechaAr(d.servicio_desde)}   Hasta: ${fechaAr(d.servicio_hasta)}   Fecha de Vto. para el pago: ${fechaAr(d.vto_pago)}`, M + 3, y + 5.5)

  // Receptor.
  y += 10
  doc.rect(M, y, W - 2 * M, 20)
  doc.text([
    `CUIT: ${cuitG(d.receptor.cuit)}        Apellido y Nombre / Razón Social: ${d.receptor.razon_social}`,
    `Condición frente al IVA: ${CONDICION[d.receptor.condicion_iva ?? ''] ?? d.receptor.condicion_iva}`,
    `Domicilio: ${d.receptor.domicilio}`,
    `Condición de venta: ${d.condicion_venta}`,
  ], M + 3, y + 5)
  if (d.asociado) {
    y += 22
    const a = TIPOS_COMPROBANTE[d.asociado.tipo]
    doc.text(`Comprobante asociado: ${a?.nombre ?? d.asociado.tipo} ${f8(d.asociado.punto_venta, 5)}-${f8(d.asociado.numero, 8)} del ${fechaAr(d.asociado.fecha)}`, M + 3, y + 3)
    y -= 4
  }

  // Detalle.
  y += 24
  const esA = t.letra === 'A'
  doc.setFillColor(230, 230, 230); doc.rect(M, y, W - 2 * M, 7, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
  doc.text('Descripción', M + 2, y + 5); doc.text('Cantidad', 130, y + 5, { align: 'right' })
  doc.text(esA ? 'Precio unit. (neto)' : 'Precio unit.', 160, y + 5, { align: 'right' }); doc.text(esA ? 'Subtotal (neto)' : 'Subtotal', W - M - 2, y + 5, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  y += 11
  const finalesB = esA ? [] : importesFinalesB(d.lineas.map(l => l.neto_c), d.neto_c, d.total_c)
  if (d.texto?.trim()) {
    const txt = doc.splitTextToSize(d.texto.trim(), 110)
    doc.text(txt, M + 2, y); y += 4 * txt.length + 2
  }
  d.lineas.forEach((l, i) => {
    const importe = esA ? l.neto_c : finalesB[i]
    const unit = esA ? l.precio : (Number(l.cantidad) ? ((importe / 100) / Number(l.cantidad)).toFixed(2) : '')
    const txt = doc.splitTextToSize(l.concepto, 100)
    doc.text(txt, M + 2, y)
    doc.text(String(l.cantidad), 130, y, { align: 'right' })
    doc.text(unit ? formatoPesos(Math.round(Number(unit) * 100)) : '', 160, y, { align: 'right' })
    doc.text(formatoPesos(importe), W - M - 2, y, { align: 'right' })
    y += 4 * txt.length + 2
  })

  // Totales.
  y = Math.max(y + 6, 200)
  doc.rect(M, y, W - 2 * M, 30)
  const filas: Array<[string, number]> = esA
    ? [['Importe Neto Gravado', d.neto_c], [`IVA ${d.alicuota ?? ''}%`, d.iva_c], ['Importe Otros Tributos', d.tributos_c ?? 0], ['Importe Total', d.total_c]]
    : [['Subtotal', d.total_c], ['Importe Otros Tributos', d.tributos_c ?? 0], ['Importe Total', d.total_c]]
  doc.setFontSize(9)
  filas.forEach(([k, v], i) => {
    doc.setFont('helvetica', i === filas.length - 1 ? 'bold' : 'normal')
    doc.text(`${k}: `, 160, y + 6 + i * 6, { align: 'right' }); doc.text(formatoPesos(v), W - M - 2, y + 6 + i * 6, { align: 'right' })
  })
  doc.setFont('helvetica', 'normal')
  if (!esA && d.receptor.condicion_iva === 'consumidor_final') {
    doc.setFontSize(8)
    doc.text(['Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)', `IVA Contenido: ${formatoPesos(d.iva_c)}`,
      'Otros Impuestos Nacionales Indirectos: $ 0,00'], M + 3, y + 6)
  }
  if (t.fce && emisor.cbu_fce) { doc.setFontSize(8); doc.text(`CBU del emisor: ${emisor.cbu_fce}`, M + 3, y + 24) }

  // Pie: QR + CAE.
  y += 34
  const qr = await QRCode.toDataURL(textoQr({ fecha: d.fecha_emision, cuit: emisor.cuit, ptoVta: d.punto_venta, tipoCmp: d.tipo, nroCmp: d.numero,
    importeC: d.total_c, tipoDocRec: 80, nroDocRec: d.receptor.cuit, codAut: d.cae }), { errorCorrectionLevel: 'M', margin: 1, width: 300 })
  doc.addImage(qr, 'PNG', M, y, 30, 30)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('ARCA', M + 34, y + 10)
  doc.setFontSize(8); doc.text('Comprobante Autorizado', M + 34, y + 15)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6)
  doc.text('Esta Administración Federal no se responsabiliza por la veracidad de los datos ingresados en el detalle de la operación', M + 34, y + 20)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text(`CAE N°: ${d.cae}`, W - M - 2, y + 10, { align: 'right' })
  doc.text(`Fecha de Vto. de CAE: ${fechaAr(d.cae_vto)}`, W - M - 2, y + 16, { align: 'right' })

  if (d.ambiente === 'homologacion') {
    doc.setTextColor(200, 0, 0); doc.setFontSize(26)
    doc.text('HOMOLOGACIÓN — SIN VALIDEZ FISCAL', W / 2, 150, { align: 'center', angle: 30 })
    doc.setTextColor(0, 0, 0)
  }
  return new Uint8Array(doc.output('arraybuffer'))
}
