/**
 * GET /api/documentacion/archivo?id=<archivo_id>&modo=ver|descargar
 *
 * Enlace temporal (60 s) a un archivo del legajo. El bucket no se lee directo:
 * no hay policy de lectura. El permiso lo decide la base
 * (documentacion_abrir, sólo service_role) con la identidad que verificó este
 * servidor, y cada apertura queda en documentacion_accesos con IP y navegador.
 * Si es la persona y el documento espera su constancia, queda además la
 * constancia de lectura (requisito para aceptar, como el Estatuto).
 *
 * Descargar es sólo para Administración y Gerencia (lo controla la base).
 */

import { NextRequest, NextResponse } from 'next/server'
import { ipDelPedido, nombreDescarga } from '@/lib/documentacion-archivo'
import { SIN_CACHE, clientesDelPedido } from '../_clientes'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BUCKET = 'legajo-documentos'
const SEGUNDOS = 60
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const error = (status: number, mensaje: string) => NextResponse.json({ error: mensaje }, { status, headers: SIN_CACHE })

export async function GET(req: NextRequest) {
  const archivoId = req.nextUrl.searchParams.get('id') ?? ''
  const modo = req.nextUrl.searchParams.get('modo') ?? 'ver'
  if (!UUID.test(archivoId)) return error(400, 'Archivo inválido')
  if (modo !== 'ver' && modo !== 'descargar') return error(400, 'Modo inválido')

  const c = await clientesDelPedido(req)
  if ('error' in c) return error(c.status, c.error)

  const { data, error: errAbrir } = await c.admin.rpc('documentacion_abrir', {
    p_auth_user_id: c.authUserId,
    p_archivo_id: archivoId,
    p_modo: modo,
    p_ip: ipDelPedido(req.headers),
    p_user_agent: req.headers.get('user-agent')?.slice(0, 400) ?? null,
  })
  if (errAbrir || !data) {
    const msg = errAbrir?.message ?? ''
    return /descarga/i.test(msg) ? error(403, msg) : error(404, 'Archivo inexistente')
  }
  const a = data as { ruta: string; mime: string; orden: number; tipo: string }

  const { data: firmado, error: errFirma } = await c.admin.storage
    .from(BUCKET)
    .createSignedUrl(a.ruta, SEGUNDOS, modo === 'descargar' ? { download: nombreDescarga(a.tipo, a.orden, a.mime) } : undefined)
  if (errFirma || !firmado?.signedUrl) return error(502, 'No se pudo abrir el archivo')

  return NextResponse.json({ url: firmado.signedUrl, mime: a.mime, vence_en: SEGUNDOS }, { headers: SIN_CACHE })
}
