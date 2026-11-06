/**
 * POST /api/postulaciones/<id>/leer — lectura de la solicitud manuscrita con Gemini.
 *
 *   1. Interruptor IA_SOLICITUDES_HABILITADA=1: apagado, no se envía NADA a Gemini
 *      (requisito previo: verificar facturación y condiciones de tratamiento,
 *      docs/seguridad/GEMINI-SOLICITUDES-EMPLEO.md).
 *   2. La base autoriza con la sesión del usuario y aplica límites
 *      (postulacion_preparar_lectura: quien puede editar esa postulación; 5 por
 *      solicitud, 40 por persona por día) y devuelve las rutas de las fotos.
 *   3. El servidor descarga las fotos del bucket privado y las manda a Gemini
 *      (modelo principal con respaldos) + una segunda lectura de DNI, CUIL,
 *      fecha de nacimiento y celular con otro modelo.
 *   4. Controles de formato y coherencia (lib/solicitud-lectura.ts): todo lo que
 *      no cierra pasa a "dudoso".
 *   5. Se registra la lectura (modelo, tokens, costo, resultado saneado) y se
 *      devuelve la PROPUESTA. No se escribe la postulación: la persona revisa y guarda.
 */
import { NextRequest, NextResponse } from 'next/server'
import { SIN_CACHE, clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { GeminiVision, MODELO_GEMINI_DEFECTO } from '@/lib/ia/gemini'
import { ErrorProveedor, type RespuestaVision } from '@/lib/ia/proveedor'
import {
  PROMPT_SOLICITUD, PROMPT_VERIFICACION, SCHEMA_SOLICITUD, SCHEMA_VERIFICACION,
  controlarLectura, costoEstimadoUsd, interpretarLecturaSolicitud, lecturaIaHabilitada,
} from '@/lib/solicitud-lectura'

export const runtime = 'nodejs'
export const maxDuration = 90
export const fetchCache = 'force-no-store'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MODELOS: [string, number][] = [[MODELO_GEMINI_DEFECTO, 45_000], ['gemini-2.5-flash', 40_000]]
const MODELO_VERIFICACION: [string, number] = ['gemini-3.5-flash-lite', 20_000]
const responder = (cuerpo: unknown, status = 200) => NextResponse.json(cuerpo, { status, headers: SIN_CACHE })

type Archivo = { ruta: string; mime: string; orden: number }

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!lecturaIaHabilitada()) {
    return responder({ error: 'La lectura con IA todavía no está habilitada. Completá los datos a mano.' }, 409)
  }
  if (!UUID_RE.test(params.id)) return responder({ error: 'Postulación inválida' }, 400)
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)

  const { data: prep, error: prepError } = await c.usuario.rpc('postulacion_preparar_lectura', { p_id: params.id })
  if (prepError) return responder({ error: prepError.message }, /límite|5 veces/.test(prepError.message) ? 429 : 403)
  const archivos = ((prep as { archivos?: Archivo[] } | null)?.archivos ?? []).slice(0, 4)

  const paginas: Array<{ bytes: Buffer; mime: string }> = []
  for (const a of archivos) {
    const { data, error } = await c.admin.storage.from('postulaciones').download(a.ruta)
    if (error || !data) return responder({ error: 'No se pudo abrir la foto de la solicitud' }, 502)
    paginas.push({ bytes: Buffer.from(await data.arrayBuffer()), mime: a.mime })
  }
  if (!paginas.length) return responder({ error: 'Primero cargá la foto de la solicitud' }, 400)

  const registrar = (p: { modelo: string | null; modeloVerif: string | null; tin: number | null; tout: number | null; costo: number | null; estado: string; resultado: unknown; dudosos: string[]; error: string | null }) =>
    c.usuario.rpc('postulacion_registrar_lectura', {
      p_id: params.id, p_modelo: p.modelo, p_modelo_verificacion: p.modeloVerif, p_tokens_entrada: p.tin, p_tokens_salida: p.tout,
      p_costo: p.costo, p_estado: p.estado, p_resultado: p.resultado, p_dudosos: p.dudosos, p_error: p.error,
    })

  const ia = new GeminiVision()
  const pedidoBase = { imagen: paginas[0], paginasAdicionales: paginas.slice(1) }
  let r: RespuestaVision | null = null
  let ultimo: unknown = null
  for (const [modelo, timeoutMs] of MODELOS) {
    try { r = await ia.analizar({ ...pedidoBase, prompt: PROMPT_SOLICITUD, schema: SCHEMA_SOLICITUD, modelo, timeoutMs }); break }
    catch (e) { ultimo = e; if (!(e instanceof ErrorProveedor) || e.clase !== 'transitorio') break }
  }
  if (!r) {
    const msg = (ultimo instanceof ErrorProveedor ? ultimo.message : 'Error al leer la solicitud').slice(0, 200)
    await registrar({ modelo: null, modeloVerif: null, tin: null, tout: null, costo: null, estado: 'error', resultado: null, dudosos: [], error: msg })
    return responder({ error: `${msg}. Podés completar los datos a mano.` }, 502)
  }

  const lectura = interpretarLecturaSolicitud(r.json)
  if (!lectura || !lectura.es_solicitud) {
    await registrar({ modelo: r.modelo, modeloVerif: null, tin: r.tokensEntrada, tout: r.tokensSalida, costo: costoEstimadoUsd(r.modelo, r.tokensEntrada, r.tokensSalida), estado: 'no_es_solicitud', resultado: null, dudosos: [], error: null })
    return responder({ error: 'La imagen no parece una solicitud de empleo de Mercosur Seguridad.' }, 422)
  }

  // Segunda lectura de los datos críticos. Si falla, no se bloquea: los críticos quedan dudosos.
  let verificacion: Record<string, string | null> | null = null
  let rv: RespuestaVision | null = null
  try {
    rv = await ia.analizar({ ...pedidoBase, prompt: PROMPT_VERIFICACION, schema: SCHEMA_VERIFICACION, modelo: MODELO_VERIFICACION[0], timeoutMs: MODELO_VERIFICACION[1] })
    verificacion = (rv.json && typeof rv.json === 'object') ? rv.json as Record<string, string | null> : null
  } catch { verificacion = null }

  const ctrl = controlarLectura(lectura, verificacion)
  const dudosos = verificacion ? ctrl.dudosos : Array.from(new Set([...ctrl.dudosos, 'dni', 'cuil', 'fecha_nacimiento', 'telefono']))
  const avisos = [
    ...ctrl.controles.map(x => `${x.campo.replace(/_/g, ' ')}: ${x.motivo}`),
    ...(verificacion ? [] : ['No se pudo hacer la segunda lectura: DNI, CUIL, fecha de nacimiento y celular quedan para confirmar.']),
    ...lectura.observaciones,
  ]
  const costo = (costoEstimadoUsd(r.modelo, r.tokensEntrada, r.tokensSalida) ?? 0) + (rv ? costoEstimadoUsd(rv.modelo, rv.tokensEntrada, rv.tokensSalida) ?? 0 : 0)

  await registrar({
    modelo: r.modelo, modeloVerif: rv?.modelo ?? null,
    tin: (r.tokensEntrada ?? 0) + (rv?.tokensEntrada ?? 0), tout: (r.tokensSalida ?? 0) + (rv?.tokensSalida ?? 0),
    costo: costo || null, estado: 'ok',
    resultado: { campos: lectura.campos, seleccion: lectura.seleccion },
    dudosos, error: null,
  })

  const regiones = Object.fromEntries(lectura.campos.filter(x => x.region).map(x => [x.campo, { pagina: x.pagina, caja: x.region }]))
  return responder({ valores: ctrl.valores, seleccion: lectura.seleccion, dudosos, avisos: avisos.slice(0, 12), regiones })
}
