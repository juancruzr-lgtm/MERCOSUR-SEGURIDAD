/**
 * /api/protocolos/controles/proponer — la IA clasifica las instrucciones de una
 * versión del protocolo y propone un control para cada una.
 *
 *   POST { version_id }
 *   → { creadas, omitidas, enviadas, corrida_id }
 *
 * Todo con la identidad de quien llama (las RPC validan que pueda preparar
 * protocolos y que el objetivo esté en su alcance):
 *  1. protocolo_instrucciones_segmentar: divide el texto si todavía no está.
 *  2. protocolo_controles_contexto: instrucciones + checklist y rondas del objetivo.
 *  3. Gemini (lib/ia/gemini.ts, sólo texto) con schema JSON.
 *  4. protocolo_registrar_corrida_ia: guarda modelo, tokens y propuestas (o el
 *     error). La base deduplica contra lo existente.
 *
 * NO aprueba ni activa nada: todo queda «propuesto». Sale de nuestra
 * infraestructura el texto de las instrucciones y los nombres de los ítems y
 * rondas del objetivo; ningún dato personal.
 */
import { NextRequest, NextResponse } from 'next/server'
import { SIN_CACHE, clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { GeminiVision, MODELO_GEMINI_DEFECTO } from '@/lib/ia/gemini'
import { ErrorProveedor, type RespuestaVision } from '@/lib/ia/proveedor'
import {
  armarPrompt, instruccionesPendientes, interpretarPropuestas, schemaPropuestas, type ContextoIA,
} from '@/lib/protocolo-controles'

export const runtime = 'nodejs'
export const maxDuration = 120
export const fetchCache = 'force-no-store'
export const dynamic = 'force-dynamic'

/** Modelo principal y respaldos si está saturado (429/5xx/timeout). */
const MODELOS: [string, number][] = [[MODELO_GEMINI_DEFECTO, 45_000], ['gemini-2.5-flash', 40_000]]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const responder = (cuerpo: unknown, status = 200) => NextResponse.json(cuerpo, { status, headers: SIN_CACHE })

export async function POST(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)

  const body = await req.json().catch(() => null) as { version_id?: string } | null
  const versionId = typeof body?.version_id === 'string' ? body.version_id.trim() : ''
  if (!UUID.test(versionId)) return responder({ error: 'Falta la versión' }, 400)

  // 1 y 2: con la identidad del usuario. Un error acá es de permiso o de datos.
  const seg = await c.usuario.rpc('protocolo_instrucciones_segmentar', { p_version_id: versionId })
  if (seg.error) return responder({ error: seg.error.message }, seg.error.code === '42501' ? 403 : 400)
  const ctxRes = await c.usuario.rpc('protocolo_controles_contexto', { p_version_id: versionId })
  if (ctxRes.error || !ctxRes.data) return responder({ error: ctxRes.error?.message ?? 'Sin contexto' }, ctxRes.error?.code === '42501' ? 403 : 400)
  const ctx = ctxRes.data as ContextoIA

  const pendientes = instruccionesPendientes(ctx)
  if (pendientes.length === 0) {
    return responder({ creadas: 0, omitidas: 0, enviadas: 0, mensaje: 'Todas las instrucciones ya tienen propuesta o son informativas' })
  }

  // 3: IA. Se prueba el siguiente modelo sólo ante errores transitorios.
  const prompt = armarPrompt(ctx, pendientes)
  let respuesta: RespuestaVision | null = null
  let modelo = MODELOS[0][0]
  let ultimo: unknown = null
  let ia: GeminiVision | null = null
  try {
    ia = new GeminiVision()
  } catch (e) {
    ultimo = e // falta la clave: se registra como corrida fallida
  }
  for (const [m, timeoutMs] of ia ? MODELOS : []) {
    modelo = m
    try {
      respuesta = await ia!.analizarTexto({ prompt, schema: schemaPropuestas(), modelo: m, timeoutMs })
      break
    } catch (e) {
      ultimo = e
      if (e instanceof ErrorProveedor && e.clase === 'permanente') break
    }
  }

  if (!respuesta) {
    const mensaje = String((ultimo as Error)?.message ?? ultimo ?? 'Error del proveedor').slice(0, 500)
    // El intento queda registrado igual (sin tokens: el proveedor no los informó).
    await c.usuario.rpc('protocolo_registrar_corrida_ia', {
      p_version_id: versionId, p_modelo: modelo, p_tokens_entrada: null, p_tokens_salida: null,
      p_propuestas: [], p_error: mensaje,
    })
    return responder({ error: `La IA no respondió: ${mensaje}` }, 502)
  }

  // 4: registrar. La base vuelve a validar cada propuesta y deduplica.
  const propuestas = interpretarPropuestas(respuesta.json, pendientes.map(i => i.id))
  const reg = await c.usuario.rpc('protocolo_registrar_corrida_ia', {
    p_version_id: versionId,
    p_modelo: respuesta.modelo,
    p_tokens_entrada: respuesta.tokensEntrada,
    p_tokens_salida: respuesta.tokensSalida,
    p_propuestas: propuestas,
    p_error: null,
  })
  if (reg.error) return responder({ error: reg.error.message }, 500)
  const r = reg.data as { corrida_id: string; creadas: number; omitidas: number }

  return responder({
    corrida_id: r.corrida_id,
    creadas: r.creadas,
    omitidas: r.omitidas,
    enviadas: pendientes.length,
    tokens_entrada: respuesta.tokensEntrada,
    tokens_salida: respuesta.tokensSalida,
  })
}
