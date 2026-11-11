/**
 * lib/facturacion/emision-guardas.ts
 *
 * Controles previos a una emisión REAL (antes de pedir CAE), para que no existan dos facturas por el
 * mismo servicio y período sin una autorización excepcional expresa de Gerencia:
 *  · la confirmación tiene que ser de Gerencia y sobre el comprobante concreto (tipo, CUIT y total);
 *  · no puede haber una factura de ARCA importada y sin conciliar del mismo cliente en el período;
 *  · no puede haber otra prefactura del mismo servicio ya emitida en un período superpuesto;
 *  · el archivo de "Mis Comprobantes" tiene que estar importado después del fin del período y hace
 *    menos de 7 días (lo emitido por fuera de la app sólo se ve así).
 * Sin acceso a datos: decide con lo que recibe. La ruta de emisión lo llama antes de preparar la emisión.
 */

import { fechaCompatible, periodoEfectivo, superpone } from './externas-arca'

export type PrefacturaAEmitir = {
  id: string; cuit_receptor: string | null; tipo_comprobante: number | null; total_c: number | null
  periodo_desde: string; periodo_hasta_excl: string
}
export type Confirmacion = { tipo?: unknown; cuit?: unknown; total_c?: unknown } | null | undefined
export type Bloqueo = { codigo: 'confirmacion' | 'posible_duplicado' | 'periodo_superpuesto' | 'importacion_vieja'; error: string; excepcionable: boolean }

const DIAS_IMPORTACION = 7

export function guardasEmisionReal(o: {
  esGerencia: boolean
  prefactura: PrefacturaAEmitir
  confirmacion: Confirmacion
  confirmoNoEmitidaFuera: boolean
  importadasSinConciliar: Array<{ tipo: number; punto_venta: number; numero: number; fecha_emision: string; doc_nro_receptor: string | null; total_c: number }>
  otrasDelServicio: Array<{ id: string; estado: string; periodo_desde: string; periodo_hasta_excl: string; conciliacion?: any }>
  ultimaImportacionAt: string | null // created_at de la última importación de Mis Comprobantes
  ahora: Date
}): Bloqueo[] {
  const p = o.prefactura
  const cuit = String(p.cuit_receptor ?? '').replace(/\D/g, '')
  const out: Bloqueo[] = []
  if (!o.esGerencia) {
    out.push({ codigo: 'confirmacion', error: 'Sólo Gerencia confirma una emisión real', excepcionable: false })
    return out
  }
  const c = o.confirmacion
  if (!c || Number(c.tipo) !== Number(p.tipo_comprobante) || String(c.cuit ?? '').replace(/\D/g, '') !== cuit || Number(c.total_c) !== Number(p.total_c) || !o.confirmoNoEmitidaFuera) {
    out.push({ codigo: 'confirmacion', error: 'Falta la confirmación de Gerencia sobre este comprobante (tipo, CUIT, total y que no se emitió por fuera de la app)', excepcionable: false })
    return out
  }
  const dup = o.importadasSinConciliar.filter(x => String(x.doc_nro_receptor ?? '').replace(/\D/g, '') === cuit && [1, 6, 201].includes(Number(x.tipo)) && fechaCompatible(x.fecha_emision, p))
  if (dup.length) {
    const d = dup[0]
    out.push({ codigo: 'posible_duplicado', excepcionable: true,
      error: `ARCA ya tiene una factura de este cliente para el período sin conciliar (tipo ${d.tipo}, ${d.punto_venta}-${d.numero}, ${d.fecha_emision}, total ${(Number(d.total_c) / 100).toFixed(2)}). Conciliala en Comprobantes antes de emitir.` })
  }
  const mio = { desde: p.periodo_desde, hastaExcl: p.periodo_hasta_excl }
  const sup = o.otrasDelServicio.filter(x => x.id !== p.id && x.estado === 'emitida' && superpone(periodoEfectivo(x), mio))
  if (sup.length) {
    const e = periodoEfectivo(sup[0])
    out.push({ codigo: 'periodo_superpuesto', excepcionable: true, error: `Este servicio ya está facturado en un período superpuesto (${e.desde} a ${e.hastaExcl}).` })
  }
  const lim = new Date(o.ahora.getTime() - DIAS_IMPORTACION * 86400000).toISOString()
  if (!o.ultimaImportacionAt || o.ultimaImportacionAt < lim || o.ultimaImportacionAt.slice(0, 10) < p.periodo_hasta_excl) {
    out.push({ codigo: 'importacion_vieja', excepcionable: true,
      error: `Antes de emitir, importá "Mis Comprobantes – Emitidos" actualizado (la última importación es ${o.ultimaImportacionAt ? o.ultimaImportacionAt.slice(0, 16).replace('T', ' ') : 'inexistente'}): así se ve lo emitido por fuera de la app.` })
  }
  return out
}
