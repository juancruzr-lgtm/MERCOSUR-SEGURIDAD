/**
 * GET /api/legajo/historico/vista/[id] — enlace de 60 s a la copia temporal de
 * un archivo de MEGA que pidió quien llama.
 *
 * El permiso, que el pedido sea de quien llama, que esté listo y no vencido lo
 * decide la base (legajo_historico_abrir_vista, con la sesión del usuario), que
 * además registra la apertura. El bucket es privado y sin policies: sólo este
 * servidor firma. Ruta y nombre del archivo de MEGA no viajan al navegador.
 *
 * Vencimientos separados: el ENLACE sirve 60 s para iniciar la descarga; la
 * COPIA temporal se borra a los 10 minutos (lector de SRV02 y, por las dudas,
 * también acá en cada apertura).
 */

import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ipDelPedido } from '@/lib/documentacion-archivo'
import { SIN_CACHE, clientesDelPedido } from '@/app/api/documentacion/_clientes'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BUCKET = 'legajo-historico-temporal'
const SEGUNDOS = 60
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const error = (status: number, mensaje: string) => NextResponse.json({ error: mensaje }, { status, headers: SIN_CACHE })

/** Borra copias vencidas aunque el lector de SRV02 no esté andando. */
async function borrarVencidas(admin: SupabaseClient) {
  const { data } = await admin.rpc('legajo_historico_vistas_a_borrar')
  for (const v of ((data as { id: string; objeto: string }[] | null) ?? []).slice(0, 20)) {
    const { error: e } = await admin.storage.from(BUCKET).remove([v.objeto])
    if (!e) await admin.rpc('legajo_historico_vista_borrada', { p_id: v.id })
  }
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) return error(400, 'Pedido inválido')
  const c = await clientesDelPedido(req)
  if ('error' in c) return error(c.status, c.error)

  await borrarVencidas(c.admin).catch(() => undefined)

  const { data, error: eAbrir } = await c.usuario.rpc('legajo_historico_abrir_vista', {
    p_id: params.id, p_ip: ipDelPedido(req.headers), p_user_agent: req.headers.get('user-agent')?.slice(0, 400) ?? null,
  })
  if (eAbrir || !data) {
    const msg = eAbrir?.message ?? ''
    if (/Sólo Administración/.test(msg)) return error(403, 'No autorizado')
    if (/ya no está disponible/.test(msg)) return error(410, 'La copia temporal venció: pedila de nuevo')
    return error(404, 'Pedido inexistente')
  }
  const v = data as { objeto: string; mime: string }
  const { data: firmado, error: eFirma } = await c.admin.storage.from(BUCKET).createSignedUrl(v.objeto, SEGUNDOS)
  if (eFirma || !firmado?.signedUrl) return error(502, 'No se pudo abrir el archivo')
  return NextResponse.json({ url: firmado.signedUrl, mime: v.mime, vence_en: SEGUNDOS }, { headers: SIN_CACHE })
}
