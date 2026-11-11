// Facturas emitidas FUERA de la app (Comprobantes en línea / Factuweb), leídas de ARCA.
//
// GET ?pv=&tipo=&desde=AAAA-MM-DD — SÓLO LECTURA (FECompUltimoAutorizado + FECompConsultar
//   de PRODUCCIÓN): no pide CAE ni reserva números. Un punto de venta y un tipo por pedido,
//   para no pasar el tiempo máximo de la función.
// POST { prefactura_id, version, tipo, punto_venta, numero } — marca la prefactura como emitida
//   con esa factura. Los datos fiscales NO los manda el navegador: se vuelven a pedir a ARCA y
//   se comparan con la prefactura. Usa las mismas RPC que la emisión manual
//   (fact_prefactura_aprobar si estaba lista para revisión, y fact_comprobante_manual_registrar),
//   con la identidad de quien pide.
// Sólo Gerencia o Administración (facturacion_puede_actual).
import type { NextRequest } from 'next/server'
import { clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { afipConfigFacturacion } from '@/lib/afip/config'
import { obtenerTA } from '@/lib/afip/wsaa'
import { taStoreSupabase } from '@/lib/afip/ta-store-supabase'
import { SERVICIO_WSFE, consultarComprobante, ultimoAutorizado } from '@/lib/afip/wsfe'
import { comprobanteDeConsulta, recorrerPuntoVenta } from '@/lib/facturacion/externas-arca'
import { storeAmbiente } from '@/lib/facturacion/ta-ambiente'
import { errorRpc, responder } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TIPOS = [1, 6, 201] // Factura A, Factura B, FCE A

async function preparar(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return { error: responder({ error: c.error }, c.status) }
  const { data: puede, error } = await c.usuario.rpc('facturacion_puede_actual')
  if (error || puede !== true) return { error: responder({ error: 'Sólo Gerencia o Administración' }, 403) }
  const credenciales = afipConfigFacturacion('produccion')
  if (!credenciales.config) return { error: responder({ error: credenciales.error ?? 'Sin credenciales de producción' }, 409) }
  const { data: conf } = await c.usuario.from('fact_config').select('valor').eq('clave', 'emision').maybeSingle()
  const pvApp = Number((conf?.valor as any)?.punto_venta_prod) || null
  const ta = await obtenerTA(SERVICIO_WSFE, credenciales.config, storeAmbiente(taStoreSupabase(c.admin), false))
  return { c, ta, cuit: credenciales.config.cuitRepresentada, pvApp }
}

export async function GET(req: NextRequest) {
  const pv = Number(req.nextUrl.searchParams.get('pv'))
  const tipo = Number(req.nextUrl.searchParams.get('tipo'))
  const desde = String(req.nextUrl.searchParams.get('desde') ?? '')
  if (!Number.isInteger(pv) || pv < 1 || pv > 99998 || !TIPOS.includes(tipo) || !/^\d{4}-\d{2}-\d{2}$/.test(desde)) {
    return responder({ error: 'Parámetros: pv (1–99998), tipo (1, 6 o 201) y desde (AAAA-MM-DD)' }, 400)
  }
  let x: Awaited<ReturnType<typeof preparar>>
  try { x = await preparar(req) } catch (e: any) { return responder({ error: e?.message ?? String(e) }, 502) }
  if ('error' in x) return x.error
  if (x.pvApp && pv === x.pvApp) return responder({ error: `El ${pv} es el punto de venta de la app: sus facturas ya están registradas` }, 400)
  const { ta, cuit } = x
  const r = await recorrerPuntoVenta({
    ultimo: () => ultimoAutorizado(ta, { cuit, homo: false, puntoVenta: pv, tipo }),
    consultar: async numero => {
      const c = await consultarComprobante(ta, { cuit, homo: false, puntoVenta: pv, tipo, numero })
      if ('error' in c) return { error: c.error }
      if (!c.encontrado) return { encontrado: false as const }
      const comp = comprobanteDeConsulta(c.crudo, { tipo, puntoVenta: pv, numero })
      return comp ? { encontrado: true as const, comprobante: comp } : { error: `El ${pv}-${numero} no trae datos legibles` }
    },
  }, { desde, maximo: 150, paralelo: 4 })
  return responder({ pv, tipo, desde, ...r, consultado_at: new Date().toISOString() })
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}))
  const tipo = Number(b.tipo), pv = Number(b.punto_venta), numero = Number(b.numero), version = Number(b.version)
  if (!b.prefactura_id || !TIPOS.includes(tipo) || !Number.isInteger(pv) || !Number.isInteger(numero) || numero < 1 || !Number.isInteger(version)) {
    return responder({ error: 'Faltan prefactura, versión, tipo, punto de venta o número' }, 400)
  }
  let x: Awaited<ReturnType<typeof preparar>>
  try { x = await preparar(req) } catch (e: any) { return responder({ error: e?.message ?? String(e) }, 502) }
  if ('error' in x) return x.error
  const { c, ta, cuit, pvApp } = x
  if (pvApp && pv === pvApp) return responder({ error: 'Las facturas del punto de venta de la app se registran solas al emitir' }, 400)

  // Los datos fiscales salen de ARCA, no del navegador.
  const q = await consultarComprobante(ta, { cuit, homo: false, puntoVenta: pv, tipo, numero })
  if ('error' in q) return responder({ error: `ARCA: ${q.error}` }, 502)
  const comp = q.encontrado ? comprobanteDeConsulta(q.crudo, { tipo, puntoVenta: pv, numero }) : null
  if (!comp) return responder({ error: `ARCA no tiene el comprobante ${tipo} ${pv}-${numero}` }, 404)

  const { data: p } = await c.usuario.from('fact_prefacturas').select('id, version, estado, cuit_receptor, tipo_comprobante, total_c, neto_c, iva_c').eq('id', b.prefactura_id).maybeSingle()
  if (!p) return responder({ error: 'Prefactura inexistente o sin acceso' }, 404)
  if (p.version !== version) return responder({ error: 'La prefactura cambió; volvé a consultar' }, 409)
  // Mismas condiciones que exige fact_comprobante_manual_registrar, ANTES de aprobar nada.
  const distinto = [
    comp.docNro !== String(p.cuit_receptor ?? '').replace(/\D/g, '') && 'CUIT del receptor',
    comp.tipo !== p.tipo_comprobante && 'tipo de comprobante',
    comp.totalC !== Number(p.total_c) && 'total',
    (Math.abs(comp.netoC - Number(p.neto_c)) > 2 || Math.abs(comp.ivaC - Number(p.iva_c)) > 2) && 'neto o IVA',
  ].filter(Boolean)
  if (distinto.length) return responder({ error: `La factura de ARCA no coincide con la prefactura: ${distinto.join(', ')}` }, 409)
  const { data: mods } = await c.usuario.from('fact_config').select('valor').eq('clave', 'modulos').maybeSingle()
  if ((mods?.valor as any)?.emision_manual !== true) {
    return responder({ error: 'Para registrar facturas emitidas fuera de la app hay que encender el módulo "emisión manual" (fact_config.modulos)' }, 409)
  }

  let v = p.version
  if (p.estado === 'lista_revision') {
    // La factura real ya existe con estos mismos datos: se aprueba para poder registrarla.
    const { error } = await c.usuario.rpc('fact_prefactura_aprobar', { p_id: p.id, p_version: v })
    if (error) return responder({ error: errorRpc(error, 'No se pudo aprobar') }, 409)
    v += 1
  } else if (p.estado !== 'aprobada_emitir') {
    return responder({ error: `La prefactura está "${p.estado}": sólo se marcan las listas para revisión o aprobadas` }, 409)
  }
  const { data: idComp, error } = await c.usuario.rpc('fact_comprobante_manual_registrar', {
    p_prefactura_id: p.id, p_version: v,
    p_datos: { tipo, punto_venta: pv, numero, fecha: comp.fecha, cuit_receptor: comp.docNro, neto_c: comp.netoC, iva_c: comp.ivaC, total_c: comp.totalC, cae: comp.cae, cae_vto: comp.caeVto, origen: 'arca_consulta' },
  })
  if (error) return responder({ error: errorRpc(error, 'No se pudo registrar'), aprobada: p.estado === 'lista_revision' }, 409)
  return responder({ ok: true, comprobante_id: idComp, comprobante: comp })
}
