// GET ?id=<comprobante> → enlace firmado (60 s) al PDF del comprobante autorizado.
//
// Sólo para comprobantes emitidos por la app (con CAE). La primera vez se genera
// con los datos fiscales registrados, se guarda como documento 'factura'
// vinculado al comprobante y después se devuelve siempre ese mismo archivo (no
// se regenera: el PDF guardado es la representación conservada). Los emitidos
// en Comprobantes en línea tienen el PDF de ARCA: se adjunta ése.
import type { NextRequest } from 'next/server'
import { clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { generarPdfComprobante, faltantesPdf, type Emisor } from '@/lib/facturacion/comprobante-pdf'
import { alicuotaDe } from '@/lib/facturacion/emision-servidor'
import { errorRpc, responder, sha256Hex } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'facturacion-documentos'

async function enlace(c: any, docId: string) {
  const { data: doc } = await c.usuario.from('fact_documentos').select('storage_bucket, storage_path, nombre_original').eq('id', docId).maybeSingle()
  if (!doc) return null
  const { data } = await c.admin.storage.from(doc.storage_bucket).createSignedUrl(doc.storage_path, 60, { download: doc.nombre_original })
  return data?.signedUrl ?? null
}

export async function GET(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)
  const id = req.nextUrl.searchParams.get('id') ?? ''
  // Con la identidad de quien pide: si la RLS no lo deja ver el comprobante, no hay PDF.
  const { data: comp } = await c.usuario.from('fact_comprobantes').select('*').eq('id', id).maybeSingle()
  if (!comp) return responder({ error: 'Comprobante inexistente o sin acceso' }, 404)

  const { data: vinc } = await c.usuario.from('fact_documento_vinculos').select('documento:fact_documentos(id, tipo)')
    .eq('entidad', 'comprobante').eq('entidad_id', id).is('anulado_at', null)
  const guardado = (vinc ?? []).map((v: any) => v.documento).find((d: any) => d?.tipo === 'factura')
  if (guardado) {
    const url = await enlace(c, guardado.id)
    return url ? responder({ url, generado: false }) : responder({ error: 'No se pudo abrir el archivo' }, 500)
  }
  if (comp.origen !== 'emision_app') {
    return responder({ error: 'Este comprobante no lo emitió la app: adjuntá el PDF que entrega ARCA (Comprobantes en línea / Mis Comprobantes).' }, 409)
  }

  const [{ data: cli }, { data: cfgEmisor }, { data: pref }, { data: asoc }] = await Promise.all([
    c.usuario.from('fact_clientes').select('razon_social, condicion_iva, domicilio').eq('id', comp.cliente_id ?? '').maybeSingle(),
    c.usuario.from('fact_config').select('valor').eq('clave', 'emisor').maybeSingle(),
    comp.prefactura_id ? c.usuario.from('fact_prefacturas').select('texto_factura, lineas, contrato_id').eq('id', comp.prefactura_id).maybeSingle() : Promise.resolve({ data: null }),
    comp.asociado_id ? c.usuario.from('fact_comprobantes').select('tipo, punto_venta, numero, fecha_emision').eq('id', comp.asociado_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const emisor = (cfgEmisor?.valor ?? null) as Emisor | null
  const lineas = ((pref as any)?.lineas ?? []).map((l: any) => ({ concepto: l.concepto, cantidad: String(l.cantidad), precio: String(l.precio), neto_c: Number(l.importes?.neto ?? 0) }))
  const datos = {
    ambiente: comp.ambiente, tipo: comp.tipo, punto_venta: comp.punto_venta, numero: Number(comp.numero), fecha_emision: comp.fecha_emision,
    servicio_desde: comp.servicio_desde, servicio_hasta: comp.servicio_hasta, vto_pago: comp.vto_pago,
    neto_c: Number(comp.neto_c), iva_c: Number(comp.iva_c), tributos_c: Number(comp.tributos_c ?? 0), total_c: Number(comp.total_c),
    cae: comp.cae ?? '', cae_vto: comp.cae_vto ?? '',
    receptor: { cuit: comp.doc_nro_receptor ?? '', razon_social: cli?.razon_social ?? comp.receptor_nombre ?? '', condicion_iva: cli?.condicion_iva ?? null, domicilio: cli?.domicilio ?? null },
    texto: (pref as any)?.texto_factura ?? comp.motivo ?? null,
    // NC/ND sin líneas propias: una línea con el motivo y el neto.
    lineas: lineas.length && [1, 6, 201].includes(comp.tipo) ? lineas : [{ concepto: comp.motivo ?? 'Según comprobante asociado', cantidad: '1', precio: String(Number(comp.neto_c) / 100), neto_c: Number(comp.neto_c) }],
    alicuota: alicuotaDe(Number(comp.neto_c), Number(comp.iva_c)),
    asociado: asoc ? { tipo: (asoc as any).tipo, punto_venta: (asoc as any).punto_venta, numero: Number((asoc as any).numero), fecha: (asoc as any).fecha_emision } : null,
    condicion_venta: 'Cuenta corriente',
  }
  const faltan = faltantesPdf(emisor, datos)
  if (faltan.length) return responder({ error: `Faltan datos para el PDF: ${faltan.join(', ')}. Cargarlos en la configuración del emisor o en la ficha del cliente.` }, 409)

  let bytes: Uint8Array
  try { bytes = await generarPdfComprobante(datos as any, emisor!) } catch (e: any) { return responder({ error: e?.message ?? String(e) }, 409) }
  const sha = await sha256Hex(bytes)
  const nombre = `${String(comp.tipo).padStart(3, '0')}-${String(comp.punto_venta).padStart(5, '0')}-${String(comp.numero).padStart(8, '0')}${comp.ambiente === 'homologacion' ? '-HOMOLOGACION' : ''}.pdf`
  const ruta = `comprobantes/${comp.cuit_emisor}/${nombre}`
  const up = await c.admin.storage.from(BUCKET).upload(ruta, bytes, { contentType: 'application/pdf', upsert: false })
  if (up.error && !/exists|duplicate/i.test(up.error.message)) return responder({ error: `No se pudo guardar el PDF: ${up.error.message}` }, 500)
  const { data: reg, error } = await c.usuario.rpc('fact_documento_registrar', { p_datos: {
    tipo: 'factura', storage_path: ruta, nombre_original: nombre, mime: 'application/pdf', bytes: bytes.length, sha256: sha, origen: 'generado_app', cliente_id: comp.cliente_id,
  } })
  if (error) return errorRpc(error)
  const v = await c.usuario.rpc('fact_documento_vincular', { p_documento_id: (reg as any).id, p_entidad: 'comprobante', p_entidad_id: id })
  if (v.error) return errorRpc(v.error)
  const url = await enlace(c, (reg as any).id)
  return url ? responder({ url, generado: true }) : responder({ error: 'PDF guardado, pero no se pudo abrir' }, 500)
}
