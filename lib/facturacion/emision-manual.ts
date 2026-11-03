/**
 * lib/facturacion/emision-manual.ts
 *
 * Contingencia: emitir en "Comprobantes en línea" de ARCA a partir de una
 * prefactura APROBADA y registrar después el comprobante autorizado.
 * (ARCA no ofrece un importador de facturas por archivo para emitir: la carga
 * es manual en su sitio; la app sólo muestra los datos y verifica el resultado.)
 *
 * La base vuelve a validar todo en fact_comprobante_manual_registrar; esto es
 * para mostrar los datos y avisar antes de enviar.
 */

import { TIPOS_COMPROBANTE, cuitValido, limpiarCuit } from './comprobantes'
import { formatoPesos } from './dinero'
import { alicuotaDe } from './emision-servidor'

export type PrefacturaAprobada = {
  tipo_comprobante: number | null; cuit_receptor: string | null; periodo_desde: string; periodo_hasta_excl: string
  fecha_vencimiento: string | null; texto_factura: string | null; neto_c: number | null; iva_c: number | null; total_c: number | null
  lineas: Array<{ concepto: string; cantidad: string; precio: string; importes?: { neto: number } }>
}

const CONDICION: Record<string, string> = {
  responsable_inscripto: 'IVA Responsable Inscripto', exento: 'IVA Sujeto Exento', consumidor_final: 'Consumidor Final',
  monotributo: 'Responsable Monotributo', sujeto_no_categorizado: 'Sujeto No Categorizado',
}
const dmy = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')
function menosUnDia(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10)
}

/** Pasos y valores tal como se cargan en Comprobantes en línea. */
export function datosComprobantesEnLinea(p: PrefacturaAprobada, cliente: { razon_social: string; condicion_iva: string | null }, puntoVenta: number | null) {
  const t = p.tipo_comprobante ? TIPOS_COMPROBANTE[p.tipo_comprobante] : null
  const esA = t?.letra === 'A'
  const pct = alicuotaDe(Number(p.neto_c), Number(p.iva_c))
  return [
    { paso: '1. Punto de venta y tipo', campo: 'Punto de venta', valor: puntoVenta ? String(puntoVenta) : 'el habilitado para Comprobantes en línea' },
    { paso: '1. Punto de venta y tipo', campo: 'Tipo de comprobante', valor: t?.nombre ?? '— sin definir —' },
    { paso: '2. Datos de emisión', campo: 'Conceptos a incluir', valor: 'Servicios' },
    { paso: '2. Datos de emisión', campo: 'Período facturado', valor: `${dmy(p.periodo_desde)} a ${dmy(menosUnDia(p.periodo_hasta_excl))}` },
    { paso: '2. Datos de emisión', campo: 'Vto. para el pago', valor: dmy(p.fecha_vencimiento) || '— definir —' },
    { paso: '3. Receptor', campo: 'Condición frente al IVA', valor: CONDICION[cliente.condicion_iva ?? ''] ?? '— sin cargar —' },
    { paso: '3. Receptor', campo: 'CUIT', valor: limpiarCuit(p.cuit_receptor) },
    { paso: '3. Receptor', campo: 'Razón social', valor: cliente.razon_social },
    { paso: '3. Receptor', campo: 'Condición de venta', valor: 'Cuenta corriente' },
    ...p.lineas.map((l, i) => ({ paso: '4. Operación', campo: `Línea ${i + 1}`,
      valor: `${l.concepto} · cantidad ${l.cantidad} · precio ${esA ? 'neto ' : ''}${l.precio}${esA ? ` · IVA ${pct ?? '?'} %` : ''}` })),
    { paso: '4. Operación', campo: 'Descripción (texto aprobado)', valor: p.texto_factura ?? '' },
    { paso: '5. Control antes de confirmar', campo: esA ? 'Neto / IVA / Total' : 'Total', valor: esA
      ? `${formatoPesos(Number(p.neto_c))} / ${formatoPesos(Number(p.iva_c))} / ${formatoPesos(Number(p.total_c))}` : formatoPesos(Number(p.total_c)) },
  ]
}

export type DatosManual = {
  tipo: number; punto_venta: number; numero: number; fecha: string; cuit_receptor: string
  neto_c: number; iva_c: number; total_c: number; cae: string; cae_vto: string
}

/** Las mismas reglas que la base, para avisar antes de enviar. */
export function validarRegistroManual(p: PrefacturaAprobada, d: DatosManual, hoy: string): string[] {
  const e: string[] = []
  if (d.tipo !== p.tipo_comprobante) e.push('El tipo de comprobante no es el aprobado.')
  if (limpiarCuit(d.cuit_receptor) !== limpiarCuit(p.cuit_receptor) || !cuitValido(d.cuit_receptor)) e.push('El CUIT del receptor no es el de la prefactura.')
  if (d.total_c !== p.total_c) e.push('El total no es el aprobado.')
  if (Math.abs(d.neto_c - Number(p.neto_c)) > 2 || Math.abs(d.iva_c - Number(p.iva_c)) > 2 || Math.abs(d.neto_c + d.iva_c - d.total_c) > 2) {
    e.push('Neto e IVA no coinciden con la prefactura.')
  }
  if (!Number.isInteger(d.punto_venta) || d.punto_venta < 1 || !Number.isInteger(d.numero) || d.numero < 1) e.push('Punto de venta o número inválido.')
  if (!/^\d{14}$/.test(d.cae)) e.push('El CAE tiene 14 dígitos.')
  if (!d.fecha || d.fecha > hoy) e.push('La fecha de emisión no puede ser futura.')
  if (!d.cae_vto || d.cae_vto < d.fecha) e.push('El vencimiento del CAE no puede ser anterior a la emisión.')
  return e
}
