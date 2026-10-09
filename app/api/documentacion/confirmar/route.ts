/**
 * POST /api/documentacion/confirmar  { documento_id }
 *
 * Último paso de una subida del legajo. El navegador ya subió cada archivo
 * directo a Storage (a la ruta que reservó documentacion_preparar). Acá el
 * servidor:
 *   1. comprueba que el documento sea de quien llama y esté "subiendo";
 *   2. descarga cada archivo GUARDADO, reconoce su tipo real por los bytes y
 *      calcula su SHA-256;
 *   3. lo registra (documentacion_registrar_verificacion, sólo service_role):
 *      queda lo que realmente se guardó, coincida o no con lo declarado;
 *   4. confirma con la identidad de quien llama (documentacion_confirmar),
 *      que rechaza si la huella o el tipo real no coinciden o si el archivo
 *      ya estaba cargado.
 */

import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { detectarMimeDocumento } from '@/lib/documentacion-archivo'
import { SIN_CACHE, clientesDelPedido } from '../_clientes'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const BUCKET = 'legajo-documentos'
const error = (status: number, mensaje: string) => NextResponse.json({ error: mensaje }, { status, headers: SIN_CACHE })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  const cuerpo = await req.json().catch(() => null) as { documento_id?: string } | null
  const documentoId = cuerpo?.documento_id ?? ''
  if (!UUID.test(documentoId)) return error(400, 'Documento inválido')

  const c = await clientesDelPedido(req)
  if ('error' in c) return error(c.status, c.error)

  const { data: doc, error: errDoc } = await c.admin
    .from('documentacion_documentos')
    .select('id, estado, subido_por_auth, documentacion_archivos(id, ruta, mime, bytes)')
    .eq('id', documentoId)
    .maybeSingle()
  if (errDoc) return error(500, 'No se pudo leer el documento')
  // Mismo mensaje si no existe o es de otro: no se confirma lo ajeno.
  if (!doc || doc.subido_por_auth !== c.authUserId) return error(404, 'Documento inexistente')

  if (doc.estado === 'subiendo') {
    const archivos = (doc.documentacion_archivos ?? []) as { id: string; ruta: string; mime: string; bytes: number }[]
    for (const a of archivos) {
      const { data: blob, error: errDesc } = await c.admin.storage.from(BUCKET).download(a.ruta)
      if (errDesc || !blob) return error(409, 'No se terminó de subir un archivo. Probá de nuevo.')
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const mimeReal = detectarMimeDocumento(bytes) ?? 'desconocido'
      const { error: errVer } = await c.admin.rpc('documentacion_registrar_verificacion', {
        p_archivo_id: a.id, p_sha256: sha256, p_mime_real: mimeReal, p_bytes: bytes.length,
      })
      if (errVer) return error(409, errVer.message || 'No se pudo verificar el archivo')
    }
  }

  const { data, error: errConf } = await c.usuario.rpc('documentacion_confirmar', { p_documento_id: documentoId })
  if (errConf) return error(400, errConf.message || 'No se pudo guardar el documento')
  return NextResponse.json(data, { headers: SIN_CACHE })
}
