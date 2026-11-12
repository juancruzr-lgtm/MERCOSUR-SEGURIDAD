/**
 * lib/facturacion/emision-servidor.ts
 *
 * Ciclo de emisión contra ARCA para una solicitud (fact_emisiones) ya
 * preparada y aprobada. Las llamadas a ARCA y a la base se inyectan para
 * poder probar el flujo sin red.
 *
 *   enviando (< 2 min)   → en_curso: NO se consulta ni se reenvía (la respuesta puede estar en camino)
 *   incierta / enviando colgada → FECompConsultar con el MISMO número
 *       existe → autorizada · 602 no existe → rechazada · error → sigue incierta
 *   preparada/rechazada  → primero se consultan TODOS los números ya intentados
 *       (si alguno quedó autorizado, se registra ése y no se emite otro);
 *       recién después: último autorizado + 1 → iniciar_envio → FECAESolicitar
 *       A → autorizada · R → rechazada · otra cosa → incierta
 *
 * Garantía buscada: un error de comunicación nunca produce una segunda factura fiscal.
 */

import type { ComprobanteWsfe, ResultadoCae, ResultadoConsulta } from '@/lib/afip/wsfe'
import { validarComprobante, CONDICION_IVA_RECEPTOR } from '@/lib/afip/wsfe'
import { vtoPagoParaArca } from './vto-arca'
import { validarFechaEmision } from './emision-guardas'

export const ENVIO_COLGADO_MS = 2 * 60 * 1000

export type Emision = {
  id: string
  estado: string
  ambiente: 'produccion' | 'homologacion'
  cuit_emisor: string
  tipo: number
  punto_venta: number
  numero: number | null
  numeros_intentados?: number[] | null
  ultimo_intento_at?: string | null
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
  /** Devuelve el id del comprobante registrado, o null si no se registró (no existe o no coincide). */
  consulta(id: string, r: { encontrado: boolean; numero: number; respuesta: unknown; cae?: string; caeVto?: string; fecha?: string; totalC?: number }): Promise<string | null>
}

export type ResultadoEmision =
  | { estado: 'autorizada'; numero: number; cae: string }
  | { estado: 'rechazada'; motivo: string }
  | { estado: 'incierta'; motivo: string }
  | { estado: 'en_curso'; motivo: string }
  | { estado: 'invalida'; errores: string[] }

const PORCENTAJES = ['21', '10.5', '27']

/** Alícuota única a partir de neto e IVA (las tarifas del contrato llevan una sola). */
export function alicuotaDe(netoC: number, ivaC: number): string | null {
  if (ivaC === 0) return '0'
  for (const p of PORCENTAJES) if (Math.abs(Math.round(netoC * Number(p) / 100) - ivaC) <= 1) return p
  return null
}

export function comprobanteDesdeSolicitud(e: Emision, opts: { numero: number; hoy: string; condicionIva: string; cbuFce?: string | null; plazoDias?: number | string | null; fceTransferencia?: 'SCA' | 'ADC'; fechaEmision?: string | null }): ComprobanteWsfe {
  const s = e.solicitud ?? {}
  // Fecha del comprobante: la que eligió Gerencia (ya validada) o la del día. El vencimiento se cuenta desde ella.
  const hoy = opts.fechaEmision || opts.hoy
  opts = { ...opts, hoy }
  const neto = Number(s.neto_c), iva = Number(s.iva_c), total = Number(s.total_c)
  const pct = alicuotaDe(neto, iva)
  // Si la fecha aprobada ya pasó, se informa la de emisión + el plazo del contrato (30 días si no tiene
  // otro). El comprobante guarda esta misma fecha (la toma de solicitud.arca: migración 20261210100000),
  // así el PDF coincide con ARCA.
  const vto = vtoPagoParaArca(s.vto_pago, opts.hoy, opts.plazoDias)
  // FCE A (201): CBU del emisor (2101) y forma de transferencia (27, RG 4919/2021): SCA = Sistema de
  // Circulación Abierta, la opción por defecto de ARCA; ADC = Agente de Depósito Colectivo.
  // NC/ND de FCE (202/203): marca de anulación (22).
  const opcionales = [201, 202, 203].includes(e.tipo)
    ? (e.tipo === 201
      ? [...(opts.cbuFce ? [{ id: '2101', valor: opts.cbuFce }] : []), { id: '27', valor: opts.fceTransferencia ?? 'SCA' }]
      : [{ id: '22', valor: 'N' }])
    : undefined
  return {
    tipo: e.tipo, puntoVenta: e.punto_venta, numero: opts.numero, fecha: opts.hoy, concepto: 2, docTipo: 80,
    docNro: String(s.cuit_receptor ?? ''), condicionIvaReceptor: CONDICION_IVA_RECEPTOR[opts.condicionIva] ?? 0, // 0 = sin dato: validarComprobante lo frena
    servicioDesde: s.periodo_desde ?? opts.hoy, servicioHasta: s.periodo_hasta ?? opts.hoy, vtoPago: vto,
    netoC: neto, ivaC: iva, totalC: total,
    alicuotas: pct && pct !== '0' ? [{ porcentaje: pct, baseC: neto, importeC: iva }] : pct === '0' ? [{ porcentaje: '0', baseC: neto, importeC: 0 }] : [{ porcentaje: '?', baseC: neto, importeC: iva }],
    asociado: s.asociado ? { tipo: s.asociado.tipo, puntoVenta: s.asociado.punto_venta, numero: s.asociado.numero, cuit: s.asociado.cuit, fecha: s.asociado.fecha } : null,
    opcionales,
  }
}

export async function ejecutarEmision(e: Emision, arca: PuertoArca, base: PuertoBase, opts: { hoy: string; condicionIva: string; cbuFce?: string | null; plazoDias?: number | string | null; ahoraMs?: number; fechaEmision?: string | null }): Promise<ResultadoEmision> {
  if (e.estado === 'autorizada') return { estado: 'autorizada', numero: e.numero!, cae: '' }

  const ahora = opts.ahoraMs ?? Date.now()
  if (e.estado === 'enviando' && e.ultimo_intento_at && ahora - Date.parse(e.ultimo_intento_at) < ENVIO_COLGADO_MS) {
    return { estado: 'en_curso', motivo: 'Hay un envío a ARCA en curso: esperar su respuesta.' }
  }

  const total = Number(e.solicitud?.total_c)
  /** Consulta un número ya enviado. 'autorizada' si quedó; 'no_existe'; o 'incierta' si no se puede saber. */
  const verificar = async (numero: number): Promise<ResultadoEmision | 'no_existe'> => {
    const c = await arca.consultar({ puntoVenta: e.punto_venta, tipo: e.tipo, numero })
    if ('error' in c) return { estado: 'incierta', motivo: `No se pudo consultar ARCA (N° ${numero}): ${c.error}` }
    if (!c.encontrado) return 'no_existe'
    const id = await base.consulta(e.id, { encontrado: true, numero, respuesta: c.crudo, cae: c.cae, caeVto: c.caeVto, fecha: c.fecha, totalC: c.totalC })
    if (!id || c.totalC !== total) return { estado: 'incierta', motivo: `ARCA tiene el N° ${numero} con otros datos: revisar a mano.` }
    return { estado: 'autorizada', numero, cae: c.cae }
  }

  if (e.estado === 'incierta' || e.estado === 'enviando') {
    if (e.numero == null) return { estado: 'incierta', motivo: 'Emisión sin número asignado: revisar a mano' }
    const v = await verificar(e.numero)
    if (v !== 'no_existe') return v
    await base.consulta(e.id, { encontrado: false, numero: e.numero, respuesta: null })
    return { estado: 'rechazada', motivo: 'ARCA no tiene el comprobante: se puede volver a emitir.' }
  }

  if (e.estado !== 'preparada' && e.estado !== 'rechazada') return { estado: 'invalida', errores: [`La emisión está ${e.estado}`] }

  // Antes de pedir un número nuevo, cualquier número intentado antes puede haber
  // quedado autorizado (ARCA respondió tarde o el rechazo fue de otra cosa).
  for (const n of Array.from(new Set((e.numeros_intentados ?? []).map(Number)))) {
    const v = await verificar(Number(n))
    if (v !== 'no_existe') return v
  }

  const ult = await arca.ultimo({ puntoVenta: e.punto_venta, tipo: e.tipo })
  if ("error" in ult) return { estado: 'rechazada', motivo: `No se obtuvo el último número autorizado: ${ult.error}` }
  const numero = ult.numero + 1
  // Fecha elegida (anterior a hoy): ARCA exige que no sea anterior a la del último autorizado del mismo
  // tipo y punto de venta. Se verifica ANTES de tomar el número, con la fecha real de ese comprobante.
  const fechaEmision = opts.fechaEmision && opts.fechaEmision !== opts.hoy ? opts.fechaEmision : null
  if (fechaEmision) {
    let ultimaFecha: string | null = null
    if (ult.numero > 0) {
      const c = await arca.consultar({ puntoVenta: e.punto_venta, tipo: e.tipo, numero: ult.numero })
      if ('error' in c || !c.encontrado || !c.fecha) return { estado: 'invalida', errores: [`No se pudo verificar la fecha del último comprobante autorizado (N° ${ult.numero}): se emite con fecha de hoy o se reintenta`] }
      ultimaFecha = c.fecha
    }
    const malFecha = validarFechaEmision(fechaEmision, opts.hoy, ultimaFecha)
    if (malFecha) return { estado: 'invalida', errores: [malFecha] }
  }
  const comp = comprobanteDesdeSolicitud(e, { numero, hoy: opts.hoy, condicionIva: opts.condicionIva, cbuFce: opts.cbuFce, plazoDias: opts.plazoDias, fechaEmision })
  const errores = validarComprobante(comp)
  if (errores.length) return { estado: 'invalida', errores }

  try {
    // Toma la solicitud con bloqueo de fila: un segundo pedido simultáneo falla acá, antes de llamar a ARCA.
    await base.iniciarEnvio(e.id, numero, comp)
  } catch (err: any) {
    return { estado: 'en_curso', motivo: `Otro pedido tomó esta emisión: ${err?.message ?? err}` }
  }
  let r: ResultadoCae
  try {
    r = await arca.solicitar(comp)
  } catch (err: any) {
    r = { resultado: 'incierta', motivo: String(err?.message ?? err), crudo: null }
  }
  if (r.resultado === 'A') {
    await base.resultado(e.id, { resultado: 'A', respuesta: r.crudo, cae: r.cae, caeVto: r.caeVto, fecha: r.fecha || comp.fecha, observaciones: r.observaciones.join('; ') })
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
