/**
 * /api/credencial/leer — la IA lee la foto de la credencial que está por subir el vigilador.
 *
 *   POST { imagen: base64 (JPEG/PNG/WebP, ya comprimida en el celular) }
 *   → { lectura: LecturaCredencial } con dónde está la tarjeta (para recortar) y lo
 *     que se lee (apellido, DNI, número, emisión, vencimiento). dni_coincide compara
 *     con el DNI de quien sube.
 *
 * No guarda nada: la foto todavía no se subió. Es una ayuda para completar el
 * formulario; si falla, la app sigue sin IA. Sólo para usuarios activos con el
 * pedido de credencial abierto (credencial_mi_estado), o Administración/Gerencia.
 */
import { NextRequest, NextResponse } from 'next/server'
import { SIN_CACHE, clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { GeminiVision, MODELO_GEMINI_DEFECTO } from '@/lib/ia/gemini'
import { ErrorProveedor } from '@/lib/ia/proveedor'
import { PROMPT_CREDENCIAL, SCHEMA_CREDENCIAL, dniCoincide, interpretarLectura } from '@/lib/credencial-lectura'

export const runtime = 'nodejs'
export const maxDuration = 30
export const fetchCache = 'force-no-store'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 6 * 1024 * 1024
const responder = (cuerpo: unknown, status = 200) => NextResponse.json(cuerpo, { status, headers: SIN_CACHE })

export async function POST(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)

  // Quién puede usarla: el vigilador al que se le pide la credencial, o Administración.
  const [{ data: estado }, { data: gestiona }] = await Promise.all([
    c.usuario.rpc('credencial_mi_estado'),
    c.usuario.rpc('legajo_puede_gestionar'),
  ])
  if (!(estado as { abierto?: boolean } | null)?.abierto && gestiona !== true) return responder({ error: 'No autorizado' }, 403)

  const body = await req.json().catch(() => null) as { imagen?: string } | null
  const b64 = typeof body?.imagen === 'string' ? body.imagen.replace(/^data:[^,]+,/, '') : ''
  if (!b64) return responder({ error: 'Falta la imagen' }, 400)
  const bytes = Buffer.from(b64, 'base64')
  if (bytes.length < 1000 || bytes.length > MAX_BYTES) return responder({ error: 'La imagen no es válida' }, 400)
  const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg'
    : bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png'
    : bytes.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp' : null
  if (!mime) return responder({ error: 'Formato no admitido' }, 400)

  try {
    const r = await new GeminiVision().analizar({
      imagen: { bytes, mime }, prompt: PROMPT_CREDENCIAL, schema: SCHEMA_CREDENCIAL,
      modelo: MODELO_GEMINI_DEFECTO, timeoutMs: 20_000,
    })
    const lectura = interpretarLectura(r.json)
    if (!lectura) return responder({ error: 'No se pudo leer la credencial' }, 502)
    const { data: yo } = await c.admin.from('usuarios').select('dni').eq('auth_user_id', c.authUserId).maybeSingle()
    lectura.dni_coincide = gestiona === true ? null : dniCoincide(lectura.dni, (yo as { dni?: string } | null)?.dni)
    return responder({ lectura })
  } catch (e) {
    const msg = e instanceof ErrorProveedor ? e.message : 'Error al leer la credencial'
    return responder({ error: msg.slice(0, 200) }, 502)
  }
}
