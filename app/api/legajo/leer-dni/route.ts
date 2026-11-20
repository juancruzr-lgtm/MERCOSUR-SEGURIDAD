/**
 * /api/legajo/leer-dni — la IA lee el DNI (frente y dorso) que el vigilador
 * está subiendo en "Completá tu legajo" y propone sus datos de nacimiento y
 * domicilio.
 *
 *   POST { frente: base64, dorso: base64 } (JPEG/PNG/WebP, ya comprimidas en el celular)
 *   → { lectura: LecturaDni } con dni_coincide = si el número leído es el de quien sube.
 *
 * No guarda nada: es una ayuda para completar el formulario. Si falla, la
 * pantalla sigue sin IA. Sólo el vigilador al que se le está pidiendo
 * completar el legajo (mi_legajo_pendiente) o Administración/Gerencia.
 */
import { NextRequest, NextResponse } from 'next/server'
import { SIN_CACHE, clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { GeminiVision, MODELO_GEMINI_DEFECTO } from '@/lib/ia/gemini'
import { ErrorProveedor } from '@/lib/ia/proveedor'
import { dniCoincide } from '@/lib/credencial-lectura'
import { PROMPT_DNI, SCHEMA_DNI, interpretarLecturaDni } from '@/lib/dni-lectura'

export const runtime = 'nodejs'
export const maxDuration = 45
export const fetchCache = 'force-no-store'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 6 * 1024 * 1024
const MODELOS: [string, number][] = [[MODELO_GEMINI_DEFECTO, 15_000], ['gemini-3.5-flash-lite', 12_000], ['gemini-2.5-flash', 12_000]]
const responder = (cuerpo: unknown, status = 200) => NextResponse.json(cuerpo, { status, headers: SIN_CACHE })

function imagen(b64: unknown): { bytes: Buffer; mime: string } | null {
  if (typeof b64 !== 'string') return null
  const bytes = Buffer.from(b64.replace(/^data:[^,]+,/, ''), 'base64')
  if (bytes.length < 1000 || bytes.length > MAX_BYTES) return null
  const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg'
    : bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png'
    : bytes.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp' : null
  return mime ? { bytes, mime } : null
}

export async function POST(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)

  const [{ data: pendiente }, { data: gestiona }] = await Promise.all([
    c.usuario.rpc('mi_legajo_pendiente'),
    c.usuario.rpc('legajo_puede_gestionar'),
  ])
  if (!(pendiente as { pedir?: boolean } | null)?.pedir && gestiona !== true) return responder({ error: 'No autorizado' }, 403)

  const body = await req.json().catch(() => null) as { frente?: unknown; dorso?: unknown } | null
  const frente = imagen(body?.frente)
  const dorso = imagen(body?.dorso)
  if (!frente || !dorso) return responder({ error: 'Faltan las fotos del frente y del dorso' }, 400)

  try {
    const ia = new GeminiVision()
    let r: Awaited<ReturnType<GeminiVision['analizar']>> | null = null
    let ultimo: unknown = null
    for (const [modelo, timeoutMs] of MODELOS) {
      try {
        r = await ia.analizar({ imagen: frente, paginasAdicionales: [dorso], prompt: PROMPT_DNI, schema: SCHEMA_DNI, modelo, timeoutMs })
        break
      } catch (e) {
        ultimo = e
        if (!(e instanceof ErrorProveedor) || e.clase !== 'transitorio') break
      }
    }
    if (!r) throw ultimo
    const lectura = interpretarLecturaDni(r.json)
    if (!lectura) return responder({ error: 'No se pudo leer el DNI' }, 502)
    const { data: persona } = await c.admin.from('usuarios').select('dni').eq('auth_user_id', c.authUserId).maybeSingle()
    lectura.dni_coincide = dniCoincide(lectura.dni, (persona as { dni?: string } | null)?.dni)
    return responder({ lectura })
  } catch (e) {
    const msg = e instanceof ErrorProveedor ? e.message : 'Error al leer el DNI'
    return responder({ error: msg.slice(0, 200) }, 502)
  }
}
