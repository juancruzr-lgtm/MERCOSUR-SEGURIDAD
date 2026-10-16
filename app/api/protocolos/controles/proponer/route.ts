/**
 * /api/protocolos/controles/proponer — la IA identifica las instrucciones de
 * una versión del protocolo y propone un control para cada una.
 *
 *   POST { version_id }
 *   → { creadas, omitidas, enviadas, identificadas?, descartadas?, corrida_id }
 *
 * Todo con la identidad de quien llama (las RPC validan que pueda preparar
 * protocolos y que el objetivo esté en su alcance):
 *  1. protocolo_controles_contexto: texto, instrucciones vigentes, checklist y
 *     rondas del objetivo, y si hace falta identificar instrucciones.
 *  2a. Si hace falta identificar: la IA lee el texto completo y devuelve cada
 *      instrucción COMPLETA como cita literal (no por renglones), con su
 *      clasificación y propuesta. La aplicación ubica cada cita en el texto
 *      original y protocolo_instrucciones_registrar verifica los rangos en la
 *      base. Las citas que no aparecen literales se descartan.
 *  2b. Si ya están identificadas: la IA clasifica y propone para las que no
 *      tienen control en curso.
 *  3. Deduplicación: además de lo que marcó la IA, se busca un ítem, ronda o
 *     punto existente parecido (palabras clave). La base vuelve a validar.
 *  4. protocolo_registrar_corrida_ia: guarda modelo, tokens y propuestas (o el
 *     error).
 *
 * NO aprueba ni activa nada: todo queda «propuesto». Sale de nuestra
 * infraestructura el texto del protocolo y los nombres de los ítems y rondas
 * del objetivo; ningún dato personal.
 */
import { NextRequest, NextResponse } from 'next/server'
import { SIN_CACHE, clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { GeminiVision, MODELO_GEMINI_DEFECTO } from '@/lib/ia/gemini'
import { ErrorProveedor, type RespuestaVision } from '@/lib/ia/proveedor'
import {
  armarPrompt, armarPromptIdentificar, completarDuplicados, instruccionesPendientes, interpretarIdentificacion,
  interpretarPropuestas, schemaIdentificar, schemaPropuestas, ubicarCitas, type ContextoIA,
} from '@/lib/protocolo-controles'

export const runtime = 'nodejs'
export const maxDuration = 120
export const fetchCache = 'force-no-store'
export const dynamic = 'force-dynamic'

/**
 * Modelo principal y respaldos si está saturado (429/5xx/timeout). El lite es
 * el que usa la revisión de fotos todos los días; gemini-2.5-flash ya no está
 * disponible para cuentas nuevas (404 desde el 16/10/2026).
 */
const MODELOS_PROTOCOLO: [string, number][] = [[MODELO_GEMINI_DEFECTO, 45_000], ['gemini-3.5-flash-lite', 30_000], ['gemini-3.8-flash', 30_000]]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const responder = (cuerpo: unknown, status = 200) => NextResponse.json(cuerpo, { status, headers: SIN_CACHE })

type Cliente = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<unknown> }

/** Pide a la IA probando el modelo siguiente sólo ante errores transitorios. */
async function pedirIA(prompt: string, schema: Record<string, unknown>): Promise<{ respuesta: RespuestaVision | null; modelo: string; error: unknown }> {
  let modelo = MODELOS_PROTOCOLO[0][0]
  let ia: GeminiVision
  try {
    ia = new GeminiVision()
  } catch (e) {
    return { respuesta: null, modelo, error: e } // falta la clave: se registra como corrida fallida
  }
  // Se informa el error de CADA modelo probado: antes quedaba sólo el último y
  // un 404 del respaldo tapaba el 503 del principal, que era la causa real.
  const errores: string[] = []
  for (const [m, timeoutMs] of MODELOS_PROTOCOLO) {
    modelo = m
    try {
      return { respuesta: await ia.analizarTexto({ prompt, schema, modelo: m, timeoutMs }), modelo: m, error: null }
    } catch (e) {
      errores.push(`${m}: ${String((e as Error)?.message ?? e).slice(0, 160)}`)
      // Un modelo inexistente (404) no corta: se prueba el siguiente. Otro error
      // permanente (clave, pedido mal armado) sí: reintentar da lo mismo.
      const noExiste = /HTTP 404/.test(String((e as Error)?.message ?? ''))
      if (e instanceof ErrorProveedor && e.clase === 'permanente' && !noExiste) break
    }
  }
  return { respuesta: null, modelo, error: errores.join(' · ') }
}

async function registrarFalla(cliente: Cliente, versionId: string, modelo: string, error: unknown) {
  const mensaje = String((error as Error)?.message ?? error ?? 'Error del proveedor').slice(0, 500)
  await cliente.rpc('protocolo_registrar_corrida_ia', {
    p_version_id: versionId, p_modelo: modelo, p_tokens_entrada: null, p_tokens_salida: null,
    p_propuestas: [], p_error: mensaje,
  })
  return responder({ error: `La IA no respondió: ${mensaje}` }, 502)
}

export async function POST(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)

  const body = await req.json().catch(() => null) as { version_id?: string } | null
  const versionId = typeof body?.version_id === 'string' ? body.version_id.trim() : ''
  if (!UUID.test(versionId)) return responder({ error: 'Falta la versión' }, 400)

  // 1: con la identidad del usuario. Un error acá es de permiso o de datos.
  const ctxRes = await c.usuario.rpc('protocolo_controles_contexto', { p_version_id: versionId })
  if (ctxRes.error || !ctxRes.data) return responder({ error: ctxRes.error?.message ?? 'Sin contexto' }, ctxRes.error?.code === '42501' ? 403 : 400)
  const ctx = ctxRes.data as ContextoIA

  // 2a: identificar instrucciones completas desde el texto.
  if (ctx.requiere_identificar) {
    if (!ctx.texto) return responder({ error: 'La versión no tiene texto' }, 400)
    const { respuesta, modelo, error } = await pedirIA(armarPromptIdentificar({ ...ctx, texto: ctx.texto }), schemaIdentificar())
    if (!respuesta) return registrarFalla(c.usuario, versionId, modelo, error)

    const leidas = interpretarIdentificacion(respuesta.json)
    const ubicadas = ubicarCitas(ctx.texto, leidas.map(l => l.cita))
    if (ubicadas.length === 0) {
      return registrarFalla(c.usuario, versionId, respuesta.modelo, 'La IA no devolvió citas literales del texto')
    }
    const reg = await c.usuario.rpc('protocolo_instrucciones_registrar', {
      p_version_id: versionId,
      p_rangos: ubicadas.map(u => ({ inicio: u.inicio, fin: u.fin })),
    })
    if (reg.error) return responder({ error: reg.error.message }, reg.error.code === '42501' ? 403 : 400)
    const r = reg.data as { ya_segmentada: boolean; ids: string[] }
    if (r.ya_segmentada) return responder({ error: 'Otra persona ya identificó las instrucciones: actualizá la pantalla.' }, 409)

    const propuestas = completarDuplicados(
      ubicadas.map((u, i) => ({ ...leidas[u.indice].propuesta, instruccion_id: r.ids[i] })),
      ctx,
    )
    const corrida = await c.usuario.rpc('protocolo_registrar_corrida_ia', {
      p_version_id: versionId, p_modelo: respuesta.modelo,
      p_tokens_entrada: respuesta.tokensEntrada, p_tokens_salida: respuesta.tokensSalida,
      p_propuestas: propuestas, p_error: null,
    })
    if (corrida.error) return responder({ error: corrida.error.message }, 500)
    const k = corrida.data as { corrida_id: string; creadas: number; omitidas: number }
    return responder({
      corrida_id: k.corrida_id, creadas: k.creadas, omitidas: k.omitidas,
      identificadas: ubicadas.length, descartadas: leidas.length - ubicadas.length, enviadas: ubicadas.length,
      tokens_entrada: respuesta.tokensEntrada, tokens_salida: respuesta.tokensSalida,
    })
  }

  // 2b: instrucciones ya identificadas sin control en curso.
  const pendientes = instruccionesPendientes(ctx)
  if (pendientes.length === 0) {
    return responder({ creadas: 0, omitidas: 0, enviadas: 0, mensaje: 'Todas las instrucciones ya tienen propuesta o son informativas' })
  }
  const { respuesta, modelo, error } = await pedirIA(armarPrompt(ctx, pendientes), schemaPropuestas())
  if (!respuesta) return registrarFalla(c.usuario, versionId, modelo, error)

  // 3 y 4: deduplicar y registrar. La base vuelve a validar cada propuesta.
  const propuestas = completarDuplicados(interpretarPropuestas(respuesta.json, pendientes.map(i => i.id)), ctx)
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
