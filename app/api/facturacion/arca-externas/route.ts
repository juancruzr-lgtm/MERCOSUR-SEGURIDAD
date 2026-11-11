// Facturas emitidas FUERA de la app (Comprobantes en línea / Factuweb).
//
// ARCA NO deja leerlas por el web service de facturación: para los puntos de venta que no son
// Web Service responde 11002 ("El punto de venta no se encuentra habilitado a usar en el
// presente WS"; comprobado el 11/11/2026 con los PV 1, 2 y 3). La fuente es el archivo de
// "Mis Comprobantes – Emitidos" importado en Comprobantes (fact_comprobantes, origen ARCA).
//
// POST { prefactura_id, version, comprobante_id } — marca la prefactura como emitida con ESE
//   comprobante importado. Los importes y el CAE no los manda el navegador: se leen de la fila
//   importada y se comparan con la prefactura ANTES de aprobar nada. Usa las mismas RPC que la
//   emisión manual (fact_prefactura_aprobar si estaba lista para revisión, y
//   fact_comprobante_manual_registrar, que vincula la fila existente), con la identidad de quien pide.
// Sólo Gerencia o Administración (facturacion_puede_actual).
import type { NextRequest } from 'next/server'
import { clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { errorRpc, responder } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)
  const { data: puede, error: errPuede } = await c.usuario.rpc('facturacion_puede_actual')
  if (errPuede || puede !== true) return responder({ error: 'Sólo Gerencia o Administración' }, 403)

  const b = await req.json().catch(() => ({}))
  const version = Number(b.version)
  if (!b.prefactura_id || !b.comprobante_id || !Number.isInteger(version)) return responder({ error: 'Faltan prefactura, versión o comprobante' }, 400)

  const [{ data: k }, { data: p }, { data: mods }] = await Promise.all([
    c.usuario.from('fact_comprobantes').select('id, ambiente, tipo, punto_venta, numero, fecha_emision, doc_nro_receptor, neto_c, iva_c, total_c, cae, cae_vto, prefactura_id, origen').eq('id', b.comprobante_id).maybeSingle(),
    c.usuario.from('fact_prefacturas').select('id, version, estado, cuit_receptor, tipo_comprobante, total_c, neto_c, iva_c').eq('id', b.prefactura_id).maybeSingle(),
    c.usuario.from('fact_config').select('valor').eq('clave', 'modulos').maybeSingle(),
  ])
  if (!k || k.ambiente !== 'produccion') return responder({ error: 'Comprobante inexistente o no es de producción' }, 404)
  if (k.prefactura_id) return responder({ error: 'Ese comprobante ya está vinculado a una prefactura' }, 409)
  if (!p) return responder({ error: 'Prefactura inexistente o sin acceso' }, 404)
  if (p.version !== version) return responder({ error: 'La prefactura cambió; volvé a cruzar' }, 409)
  if (!/^\d{14}$/.test(String(k.cae ?? ''))) return responder({ error: 'El comprobante importado no tiene CAE: volver a importar el archivo de ARCA' }, 409)

  // Mismas condiciones que exige fact_comprobante_manual_registrar, ANTES de aprobar nada.
  const distinto = [
    String(k.doc_nro_receptor ?? '').replace(/\D/g, '') !== String(p.cuit_receptor ?? '').replace(/\D/g, '') && 'CUIT del receptor',
    Number(k.tipo) !== Number(p.tipo_comprobante) && 'tipo de comprobante',
    Number(k.total_c) !== Number(p.total_c) && 'total',
    (Math.abs(Number(k.neto_c) - Number(p.neto_c)) > 2 || Math.abs(Number(k.iva_c) - Number(p.iva_c)) > 2) && 'neto o IVA',
  ].filter(Boolean)
  if (distinto.length) return responder({ error: `La factura no coincide con la prefactura: ${distinto.join(', ')}` }, 409)
  if ((mods?.valor as any)?.emision_manual !== true) {
    return responder({ error: 'Para registrar facturas emitidas fuera de la app hay que encender el módulo "emisión manual" (fact_config.modulos)' }, 409)
  }

  let v = p.version
  if (p.estado === 'lista_revision') {
    // La factura real ya existe con estos mismos importes: se aprueba para poder registrarla.
    const { error } = await c.usuario.rpc('fact_prefactura_aprobar', { p_id: p.id, p_version: v })
    if (error) return responder({ error: errorRpc(error, 'No se pudo aprobar') }, 409)
    v += 1
  } else if (p.estado !== 'aprobada_emitir') {
    return responder({ error: `La prefactura está "${p.estado}": sólo se marcan las listas para revisión o aprobadas` }, 409)
  }
  // La fila importada ya existe: la RPC la vincula (no la duplica). El vencimiento del CAE no viene
  // en el archivo de ARCA y no se guarda en ese caso; sólo se valida que no sea anterior a la emisión.
  const { data: idComp, error } = await c.usuario.rpc('fact_comprobante_manual_registrar', {
    p_prefactura_id: p.id, p_version: v,
    p_datos: { tipo: Number(k.tipo), punto_venta: Number(k.punto_venta), numero: Number(k.numero), fecha: k.fecha_emision, cuit_receptor: String(k.doc_nro_receptor ?? '').replace(/\D/g, ''),
      neto_c: Number(k.neto_c), iva_c: Number(k.iva_c), total_c: Number(k.total_c), cae: String(k.cae), cae_vto: k.cae_vto ?? k.fecha_emision, origen: 'arca_importado' },
  })
  if (error) return responder({ error: errorRpc(error, 'No se pudo registrar'), aprobada: p.estado === 'lista_revision' }, 409)
  return responder({ ok: true, comprobante_id: idComp })
}
