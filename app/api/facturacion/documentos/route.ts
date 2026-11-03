// Documentos de facturación (OC, conformidades, presupuestos, órdenes de pago,
// certificados de retención, presentaciones). Se guarda el ORIGINAL; el hash
// detecta duplicados. El contenido es dato: nada de lo que diga se ejecuta.
//   POST multipart { archivo, tipo, cliente_id?, entidad?, entidad_id?, datos_propuestos? }
//   GET ?id=… → enlace firmado de 60 s
import type { NextRequest } from 'next/server'
import { clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { errorRpc, responder, sha256Hex } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'facturacion-documentos'
const MAX = 20 * 1024 * 1024
const TIPOS = ['orden_compra', 'conformidad', 'presupuesto', 'orden_pago', 'certificado_retencion', 'presentacion', 'planilla', 'factura', 'extracto', 'otro']
const MIME: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', csv: 'text/csv', txt: 'text/plain',
  zip: 'application/zip', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', eml: 'message/rfc822',
}

export async function POST(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)
  const { data: puede } = await c.usuario.rpc('facturacion_puede_actual')
  if (!puede) return responder({ error: 'Sólo Gerencia o Administración' }, 403)
  const form = await req.formData().catch(() => null)
  const archivo = form?.get('archivo')
  const tipo = String(form?.get('tipo') ?? '')
  if (!(archivo instanceof File)) return responder({ error: 'Falta el archivo' }, 400)
  if (!TIPOS.includes(tipo)) return responder({ error: 'Tipo de documento inválido' }, 400)
  if (archivo.size > MAX) return responder({ error: 'El archivo supera 20 MB' }, 400)
  const ext = (archivo.name.split('.').pop() ?? '').toLowerCase()
  const mime = MIME[ext]
  if (!mime) return responder({ error: `Formato no admitido (.${ext})` }, 400)
  const bytes = new Uint8Array(await archivo.arrayBuffer())
  const sha = await sha256Hex(bytes)
  // Ruta por hash: el mismo archivo cae siempre en el mismo lugar.
  const ruta = `${sha.slice(0, 2)}/${sha}.${ext}`
  const up = await c.admin.storage.from(BUCKET).upload(ruta, bytes, { contentType: mime, upsert: false })
  if (up.error && !/exists|duplicate/i.test(up.error.message)) return responder({ error: `No se pudo guardar el archivo: ${up.error.message}` }, 500)
  let propuestos: unknown = null
  try { propuestos = form?.get('datos_propuestos') ? JSON.parse(String(form.get('datos_propuestos'))) : null } catch { propuestos = null }
  const { data, error } = await c.usuario.rpc('fact_documento_registrar', { p_datos: {
    tipo, storage_path: ruta, nombre_original: archivo.name, mime, bytes: archivo.size, sha256: sha, origen: 'carga_manual',
    cliente_id: form?.get('cliente_id') || null, datos_propuestos: propuestos,
  } })
  if (error) return errorRpc(error)
  const entidad = String(form?.get('entidad') ?? ''), entidadId = String(form?.get('entidad_id') ?? '')
  if (entidad && entidadId) {
    const v = await c.usuario.rpc('fact_documento_vincular', { p_documento_id: (data as any).id, p_entidad: entidad, p_entidad_id: entidadId })
    if (v.error) return errorRpc(v.error)
  }
  return responder(data)
}

export async function GET(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)
  const id = req.nextUrl.searchParams.get('id')
  // La lectura con la identidad de quien llama decide si puede verlo (RLS).
  const { data: doc } = await c.usuario.from('fact_documentos').select('storage_bucket, storage_path, nombre_original').eq('id', id ?? '').maybeSingle()
  if (!doc) return responder({ error: 'Documento inexistente o sin acceso' }, 404)
  const { data, error } = await c.admin.storage.from(doc.storage_bucket).createSignedUrl(doc.storage_path, 60, { download: doc.nombre_original })
  if (error || !data) return responder({ error: 'No se pudo abrir el archivo' }, 500)
  return responder({ url: data.signedUrl })
}
