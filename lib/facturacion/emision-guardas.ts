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
 * Sin acceso a datos: decide con lo que recibe. La ruta de emisión lo llama antes de preparar la emisión y,
 * antes de pedir el CAE, exige que lo preparado sea lo confirmado (solicitudCoincide). Una factura real nueva
 * sólo sale desde su prefactura: por emision_id sólo se consulta (pideCaeFacturaReal).
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

/**
 * ¿El próximo paso de esta emisión pide un CAE REAL para una factura de servicio (A, B o FCE A de una
 * prefactura)? Preparada o rechazada → sí (ejecutarEmision pide número nuevo). Incierta/enviando sólo
 * consultan; las notas de crédito/débito tienen su propia aprobación.
 */
export function pideCaeFacturaReal(e: { ambiente?: string | null; tipo?: unknown; estado?: string | null; prefactura_id?: string | null }): boolean {
  return e.ambiente === 'produccion' && !!e.prefactura_id && [1, 6, 201].includes(Number(e.tipo)) && ['preparada', 'rechazada'].includes(String(e.estado))
}

/** ¿Lo que se va a mandar a ARCA (la solicitud armada al preparar) es lo que Gerencia confirmó (tipo, CUIT y total)? */
export function solicitudCoincide(e: { tipo?: unknown; solicitud?: any }, c: Confirmacion): boolean {
  const s = e.solicitud ?? {}
  return !!c && Number(c.tipo) === Number(e.tipo)
    && String(c.cuit ?? '').replace(/\D/g, '') === String(s.cuit_receptor ?? '').replace(/\D/g, '')
    && s.total_c != null && Number(c.total_c) === Number(s.total_c)
}

/** Número de comprobante como se lee en la factura: 0004-00000001. */
export const numeroComprobante = (puntoVenta: number, numero: number) => `${String(puntoVenta).padStart(4, '0')}-${String(numero).padStart(8, '0')}`

/**
 * Fecha de emisión elegida por Gerencia (p. ej. para que la factura quede en el período anterior).
 * Reglas de ARCA para servicios (concepto 2), sólo hacia atrás:
 *  · no futura (hasta hoy);
 *  · hasta 10 días antes de hoy (más atrás, ARCA la rechaza);
 *  · no anterior a la fecha del último comprobante autorizado del mismo tipo y punto de venta
 *    (la numeración y las fechas tienen que ir en orden).
 */
export const DIAS_ATRAS_EMISION = 10

const diaIso = (iso: string, mas: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + mas * 86400000).toISOString().slice(0, 10)

export function rangoFechaEmision(hoy: string, ultimaFecha?: string | null): { desde: string; hasta: string } {
  const minimo = diaIso(hoy, -DIAS_ATRAS_EMISION)
  return { desde: ultimaFecha && ultimaFecha > minimo ? ultimaFecha : minimo, hasta: hoy }
}

/** null si la fecha sirve; si no, por qué no. ultimaFecha = la del último autorizado (si se conoce). */
export function validarFechaEmision(fecha: unknown, hoy: string, ultimaFecha?: string | null): string | null {
  const f = String(fecha ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || Number.isNaN(Date.parse(`${f}T00:00:00Z`)) || new Date(`${f}T00:00:00Z`).toISOString().slice(0, 10) !== f) {
    return 'Fecha de emisión inválida (AAAA-MM-DD)'
  }
  const r = rangoFechaEmision(hoy, ultimaFecha)
  if (f > r.hasta) return `La fecha de emisión no puede ser posterior a hoy (${r.hasta})`
  if (ultimaFecha && f < ultimaFecha) return `La fecha de emisión no puede ser anterior a la del último comprobante autorizado de este tipo y punto de venta (${ultimaFecha})`
  if (f < r.desde) return `ARCA admite hasta ${DIAS_ATRAS_EMISION} días antes de hoy: la fecha más vieja posible es ${r.desde}`
  return null
}
