/**
 * /api/credencial/leer — la IA lee la foto de la credencial que está por subir el vigilador.
 *
 *   POST { imagen: base64 (JPEG/PNG/WebP, ya comprimida en el celular) }
 *   → { lectura: LecturaCredencial } con dónde está la tarjeta (para recortar) y lo
 *     que se lee (apellido, DNI, número, emisión, vencimiento). dni_coincide compara
 *     con el DNI de quien sube (o, si carga Administración, con el de empleado_id).
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
export const maxDuration = 45
export const fetchCache = 'force-no-store'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 6 * 1024 * 1024
/** Modelo principal y respaldos (el lite es el que usa la revisión de fotos). */
const MODELOS: [string, number][] = [[MODELO_GEMINI_DEFECTO, 12_000], ['gemini-3.5-flash-lite', 12_000], ['gemini-2.5-flash', 10_000]]
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

  const body = await req.json().catch(() => null) as { imagen?: string; empleado_id?: string | null } | null
  const b64 = typeof body?.imagen === 'string' ? body.imagen.replace(/^data:[^,]+,/, '') : ''
  if (!b64) return responder({ error: 'Falta la imagen' }, 400)
  const bytes = Buffer.from(b64, 'base64')
  if (bytes.length < 1000 || bytes.length > MAX_BYTES) return responder({ error: 'La imagen no es válida' }, 400)
  const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg'
    : bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png'
    : bytes.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp' : null
  if (!mime) return responder({ error: 'Formato no admitido' }, 400)

  try {
    // Si un modelo está saturado (503/429/timeout) se prueba el siguiente: la lectura es una
    // ayuda en el momento, no puede esperar a que se libere.
    const ia = new GeminiVision()
    let r: Awaited<ReturnType<GeminiVision['analizar']>> | null = null
    let ultimo: unknown = null
    for (const [modelo, timeoutMs] of MODELOS) {
      try {
        r = await ia.analizar({ imagen: { bytes, mime }, prompt: PROMPT_CREDENCIAL, schema: SCHEMA_CREDENCIAL, modelo, timeoutMs })
        break
      } catch (e) {
        ultimo = e
        if (!(e instanceof ErrorProveedor) || e.clase !== 'transitorio') break
      }
    }
    if (!r) throw ultimo
    const lectura = interpretarLectura(r.json)
    if (!lectura) return responder({ error: 'No se pudo leer la credencial' }, 502)
    // El vigilador sube la suya; Administración carga la de la persona del legajo (empleado_id).
    const otro = gestiona === true && typeof body?.empleado_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.empleado_id) ? body.empleado_id : null
    const { data: persona } = otro
      ? await c.admin.from('usuarios').select('dni').eq('id', otro).maybeSingle()
      : await c.admin.from('usuarios').select('dni').eq('auth_user_id', c.authUserId).maybeSingle()
    lectura.dni_coincide = gestiona === true && !otro ? null : dniCoincide(lectura.dni, (persona as { dni?: string } | null)?.dni)
    return responder({ lectura })
  } catch (e) {
    const msg = e instanceof ErrorProveedor ? e.message : 'Error al leer la credencial'
    return responder({ error: msg.slice(0, 200) }, 502)
  }
}
