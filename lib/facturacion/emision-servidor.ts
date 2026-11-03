/**
 * lib/facturacion/emision-servidor.ts
 *
 * Ciclo de emisión contra ARCA para una solicitud (fact_emisiones) ya
 * preparada y aprobada. Las llamadas a ARCA y a la base se inyectan para
 * poder probar el flujo sin red.
 *
 *   preparada/rechazada → último autorizado + 1 → iniciar_envio → FECAESolicitar
 *       A → autorizada (alta del comprobante) · R → rechazada · otra cosa → incierta
 *   incierta/enviando → FECompConsultar con el MISMO número
 *       existe → autorizada · 602 no existe → rechazada (se puede reintentar) · error → sigue incierta
 */

import type { ComprobanteWsfe, ResultadoCae, ResultadoConsulta } from '@/lib/afip/wsfe'
import { validarComprobante, CONDICION_IVA_RECEPTOR } from '@/lib/afip/wsfe'

export type Emision = {
  id: string
  estado: string
  ambiente: 'produccion' | 'homologacion'
  cuit_emisor: string
  tipo: number
  punto_venta: number
  numero: number | null
  solicitud: any
}

export type PuertoArca = {
  ultimo(o: { puntoVenta: number; tipo: number }): Promise<{ ok: true; numero: number } | { ok: false; error: string }>
  solicitar(c: ComprobanteWsfe): Promise<ResultadoCae>
  consultar(o: { puntoVenta: number; tipo: number; numero: number }): Promise<ResultadoConsulta>
}

export type PuertoBase = {
  iniciarEnvio(id: string, numero: number, solicitudArca: unknown): Promise<void>
  resultado(id: string, r: { resultado: 'A' | 'R' | 'incierta'; respuesta: unknown; cae?: string; caeVto?: string; fecha?: string; observaciones?: string }): Promise<void>
  consulta(id: string, r: { encontrado: boolean; respuesta: unknown; cae?: string; caeVto?: string; fecha?: string; totalC?: number }): Promise<void>
}

export type ResultadoEmision =
  | { estado: 'autorizada'; numero: number; cae: string }
  | { estado: 'rechazada'; motivo: string }
  | { estado: 'incierta'; motivo: string }
  | { estado: 'invalida'; errores: string[] }

const PORCENTAJES = ['21', '10.5', '27']

/** Alícuota única a partir de neto e IVA (las tarifas del contrato llevan una sola). */
export function alicuotaDe(netoC: number, ivaC: number): string | null {
  if (ivaC === 0) return '0'
  for (const p of PORCENTAJES) if (Math.abs(Math.round(netoC * Number(p) / 100) - ivaC) <= 1) return p
  return null
}

export function comprobanteDesdeSolicitud(e: Emision, opts: { numero: number; hoy: string; condicionIva: string; cbuFce?: string | null }): ComprobanteWsfe {
  const s = e.solicitud ?? {}
  const neto = Number(s.neto_c), iva = Number(s.iva_c), total = Number(s.total_c)
  const pct = alicuotaDe(neto, iva)
  const vto = s.vto_pago && s.vto_pago >= opts.hoy ? s.vto_pago : opts.hoy
  const opcionales = [201, 202, 203].includes(e.tipo)
    ? (e.tipo === 201 ? (opts.cbuFce ? [{ id: '2101', valor: opts.cbuFce }] : []) : [{ id: '22', valor: 'N' }])
    : undefined
  return {
    tipo: e.tipo, puntoVenta: e.punto_venta, numero: opts.numero, fecha: opts.hoy, concepto: 2, docTipo: 80,
    docNro: String(s.cuit_receptor ?? ''), condicionIvaReceptor: CONDICION_IVA_RECEPTOR[opts.condicionIva] ?? 1,
    servicioDesde: s.periodo_desde ?? opts.hoy, servicioHasta: s.periodo_hasta ?? opts.hoy, vtoPago: vto,
    netoC: neto, ivaC: iva, totalC: total,
    alicuotas: pct && pct !== '0' ? [{ porcentaje: pct, baseC: neto, importeC: iva }] : pct === '0' ? [{ porcentaje: '0', baseC: neto, importeC: 0 }] : [{ porcentaje: '?', baseC: neto, importeC: iva }],
    asociado: s.asociado ? { tipo: s.asociado.tipo, puntoVenta: s.asociado.punto_venta, numero: s.asociado.numero, cuit: s.asociado.cuit, fecha: s.asociado.fecha } : null,
    opcionales,
  }
}

export async function ejecutarEmision(e: Emision, arca: PuertoArca, base: PuertoBase, opts: { hoy: string; condicionIva: string; cbuFce?: string | null }): Promise<ResultadoEmision> {
  if (e.estado === 'autorizada') return { estado: 'autorizada', numero: e.numero!, cae: '' }

  if (e.estado === 'incierta' || e.estado === 'enviando') {
    if (e.numero == null) return { estado: 'incierta', motivo: 'Emisión sin número asignado: revisar a mano' }
    const c = await arca.consultar({ puntoVenta: e.punto_venta, tipo: e.tipo, numero: e.numero })
    if ('error' in c) return { estado: 'incierta', motivo: `No se pudo consultar ARCA: ${c.error}` }
    if (c.encontrado) {
      await base.consulta(e.id, { encontrado: true, respuesta: c.crudo, cae: c.cae, caeVto: c.caeVto, fecha: c.fecha, totalC: c.totalC })
      return { estado: 'autorizada', numero: e.numero, cae: c.cae }
    }
    await base.consulta(e.id, { encontrado: false, respuesta: c.crudo })
    return { estado: 'rechazada', motivo: 'ARCA no tiene el comprobante: se puede volver a emitir.' }
  }

  if (e.estado !== 'preparada' && e.estado !== 'rechazada') return { estado: 'invalida', errores: [`La emisión está ${e.estado}`] }

  const ult = await arca.ultimo({ puntoVenta: e.punto_venta, tipo: e.tipo })
  if ("error" in ult) return { estado: 'rechazada', motivo: `No se obtuvo el último número autorizado: ${ult.error}` }
  const numero = ult.numero + 1
  const comp = comprobanteDesdeSolicitud(e, { numero, ...opts })
  const errores = validarComprobante(comp)
  if (errores.length) return { estado: 'invalida', errores }

  await base.iniciarEnvio(e.id, numero, comp)
  let r: ResultadoCae
  try {
    r = await arca.solicitar(comp)
  } catch (err: any) {
    r = { resultado: 'incierta', motivo: String(err?.message ?? err), crudo: null }
  }
  if (r.resultado === 'A') {
    await base.resultado(e.id, { resultado: 'A', respuesta: r.crudo, cae: r.cae, caeVto: r.caeVto, fecha: r.fecha || opts.hoy, observaciones: r.observaciones.join('; ') })
    return { estado: 'autorizada', numero, cae: r.cae }
  }
  if (r.resultado === 'R') {
    const motivo = [...r.errores, ...r.observaciones].join('; ') || 'Rechazado por ARCA'
    await base.resultado(e.id, { resultado: 'R', respuesta: r.crudo, observaciones: motivo })
    return { estado: 'rechazada', motivo }
  }
  await base.resultado(e.id, { resultado: 'incierta', respuesta: r.crudo, observaciones: r.motivo })
  return { estado: 'incierta', motivo: `${r.motivo}. Se consultará a ARCA antes de reintentar.` }
}
