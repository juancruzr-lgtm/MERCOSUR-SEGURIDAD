/**
 * /api/bajas/leer-documento — la IA lee un telegrama / carta documento / acuerdo
 * adjunto a una baja (Administración / Gerencia).
 *
 *   POST { baja_id, documento_id, imagenes: base64[] (JPEG/PNG/WebP, hasta 4 páginas) }
 *   → { lectura: LecturaBaja } y queda guardada como SUGERENCIA en la baja.
 *
 * La IA no confirma la baja ni cambia ningún dato: Administración ve lo leído y
 * lo confirma o corrige. Mismo proveedor y modelos de respaldo que la lectura de
 * credenciales. Las páginas del PDF se convierten a imagen en el navegador.
 */
import { NextRequest, NextResponse } from 'next/server'
import { SIN_CACHE, clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { GeminiVision, MODELO_GEMINI_DEFECTO } from '@/lib/ia/gemini'
import { ErrorProveedor } from '@/lib/ia/proveedor'
import { PROMPT_BAJA, SCHEMA_BAJA, interpretarLecturaBaja, unirLecturas, type LecturaBaja } from '@/lib/baja-lectura'

export const runtime = 'nodejs'
export const maxDuration = 60
export const fetchCache = 'force-no-store'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 6 * 1024 * 1024
const MODELOS: [string, number][] = [[MODELO_GEMINI_DEFECTO, 15_000], ['gemini-3.5-flash-lite', 12_000], ['gemini-2.5-flash', 10_000]]
const responder = (cuerpo: unknown, status = 200) => NextResponse.json(cuerpo, { status, headers: SIN_CACHE })
const esUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s)

export async function POST(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)
  const { data: gestiona } = await c.usuario.rpc('legajo_puede_gestionar')
  if (gestiona !== true) return responder({ error: 'No autorizado' }, 403)

  const body = await req.json().catch(() => null) as { baja_id?: string; documento_id?: string; imagenes?: string[] } | null
  if (!esUuid(body?.baja_id) || !esUuid(body?.documento_id)) return responder({ error: 'Faltan la baja o el documento' }, 400)
  const imagenes = (Array.isArray(body?.imagenes) ? body!.imagenes : []).slice(0, 4)
  if (!imagenes.length) return responder({ error: 'Falta la imagen del documento' }, 400)

  // Contexto del legajo, leído con la identidad de quien pide (RLS de bajas).
  const { data: baja } = await c.usuario.from('baja_laboral').select('nombre, dni, fecha_ingreso').eq('id', body!.baja_id).maybeSingle()
  if (!baja) return responder({ error: 'Baja inexistente' }, 404)
  const contexto = { nombre: (baja as any).nombre, dni: (baja as any).dni, fechaIngreso: (baja as any).fecha_ingreso }

  const ia = new GeminiVision()
  const paginas: LecturaBaja[] = []
  try {
    for (const b64raw of imagenes) {
      const bytes = Buffer.from(String(b64raw).replace(/^data:[^,]+,/, ''), 'base64')
      if (bytes.length < 1000 || bytes.length > MAX_BYTES) return responder({ error: 'Una de las imágenes no es válida' }, 400)
      const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg'
        : bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png'
        : bytes.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp' : null
      if (!mime) return responder({ error: 'Formato no admitido' }, 400)
      let r: Awaited<ReturnType<GeminiVision['analizar']>> | null = null
      let ultimo: unknown = null
      for (const [modelo, timeoutMs] of MODELOS) {
        try { r = await ia.analizar({ imagen: { bytes, mime }, prompt: PROMPT_BAJA, schema: SCHEMA_BAJA, modelo, timeoutMs }); break }
        catch (e) { ultimo = e; if (!(e instanceof ErrorProveedor) || e.clase !== 'transitorio') break }
      }
      if (!r) throw ultimo
      const l = interpretarLecturaBaja(r.json, contexto)
      if (l) paginas.push(l)
    }
  } catch (e) {
    const msg = e instanceof ErrorProveedor ? e.message : 'Error al leer el documento'
    await c.usuario.rpc('baja_guardar_lectura', { p_baja_id: body!.baja_id, p_documento_id: body!.documento_id, p_estado: 'error', p_datos: { error: msg.slice(0, 200) } })
    return responder({ error: msg.slice(0, 200) }, 502)
  }
  const lectura = unirLecturas(paginas)
  if (!lectura) return responder({ error: 'No se pudo leer el documento' }, 502)
  const estado = lectura.legible && lectura.es_documento_laboral ? 'leido' : 'ilegible'
  const { error } = await c.usuario.rpc('baja_guardar_lectura', { p_baja_id: body!.baja_id, p_documento_id: body!.documento_id, p_estado: estado, p_datos: lectura })
  if (error) return responder({ error: error.message }, 400)
  return responder({ lectura })
}
