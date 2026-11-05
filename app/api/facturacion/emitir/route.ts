// POST { prefactura_id, version, ambiente } o { emision_id } (NC/ND aprobadas o reintento/consulta).
//
// Doble llave para la emisión REAL: fact_config.emision.produccion_habilitada
// en la base Y FACTURACION_EMISION_REAL=1 en el servidor. Sin las dos, sólo
// homologación. Sin certificado (AFIP_CERT_PEM/AFIP_KEY_PEM) no se llama a ARCA:
// la solicitud queda 'preparada' y se informa la dependencia.
import type { NextRequest } from 'next/server'
import { clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { afipConfigFacturacion } from '@/lib/afip/config'
import { obtenerTA } from '@/lib/afip/wsaa'
import { taStoreSupabase } from '@/lib/afip/ta-store-supabase'
import { SERVICIO_WSFE, consultarComprobante, solicitarCae, ultimoAutorizado } from '@/lib/afip/wsfe'
import { ejecutarEmision, type Emision } from '@/lib/facturacion/emision-servidor'
import { cbuFceDe, storeAmbiente } from '@/lib/facturacion/ta-ambiente'
import { fechaArgentina } from '@/lib/periodo-argentina'
import { errorRpc, rechazoPorPeriodo, responder } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)
  // Doble control de rol: la base lo vuelve a exigir en cada RPC (facturacion_gate).
  const { data: puede, error: errPuede } = await c.usuario.rpc('facturacion_puede_actual')
  if (errPuede || puede !== true) return responder({ error: 'Sólo Gerencia o Administración' }, 403)
  const b = await req.json().catch(() => ({}))

  let emisionId: string | null = b.emision_id ?? null
  if (!emisionId) {
    if (!['produccion', 'homologacion'].includes(b.ambiente)) return responder({ error: 'Ambiente inválido' }, 400)
    // Seguro de períodos: no se emite una prefactura del mes en curso o futuro.
    const { data: pf } = await c.usuario.from('fact_prefacturas').select('periodo_mes').eq('id', b.prefactura_id).maybeSingle()
    if (pf?.periodo_mes) { const rechazo = await rechazoPorPeriodo(c.usuario, pf.periodo_mes); if (rechazo) return rechazo }
    const { data, error } = await c.usuario.rpc('fact_emision_preparar', { p_prefactura_id: b.prefactura_id, p_version: b.version, p_ambiente: b.ambiente })
    if (error) return errorRpc(error)
    emisionId = (data as any).id
  }
  // Leer con la identidad del usuario: si no la ve, no la emite.
  const { data: e } = await c.usuario.from('fact_emisiones').select('*').eq('id', emisionId).maybeSingle()
  if (!e) return responder({ error: 'Solicitud de emisión inexistente o sin acceso' }, 404)
  if (e.estado === 'pendiente_aprobacion') return responder({ error: 'La nota todavía no está aprobada' }, 409)
  if (e.estado === 'autorizada') return responder({ estado: 'autorizada', emision_id: e.id })

  const homo = e.ambiente === 'homologacion'
  if (!homo && process.env.FACTURACION_EMISION_REAL !== '1') {
    return responder({ estado: e.estado, emision_id: e.id, error: 'La emisión real está deshabilitada en el servidor (FACTURACION_EMISION_REAL).' }, 403)
  }
  // Credenciales propias de cada ambiente: homologación nunca usa el certificado productivo.
  const cfg = afipConfigFacturacion(homo ? 'homologacion' : 'produccion')
  if (!cfg.config) {
    return responder({ estado: e.estado, emision_id: e.id, error: `Sin credenciales de ARCA (${cfg.error}). La solicitud quedó preparada y no se envió nada.` }, 503)
  }
  if (cfg.config.homo !== homo) return responder({ estado: e.estado, emision_id: e.id, error: 'El certificado no corresponde al ambiente de la solicitud.' }, 409)
  if (cfg.config.cuitRepresentada !== e.cuit_emisor) return responder({ error: 'El certificado no corresponde al CUIT emisor' }, 409)

  const [{ data: cli }, { data: conf }] = await Promise.all([
    c.usuario.from('fact_clientes').select('condicion_iva').eq('id', e.solicitud?.cliente_id ?? '').maybeSingle(),
    c.usuario.from('fact_config').select('clave, valor').in('clave', ['emision', 'emisor']),
  ])
  let ta
  try {
    ta = await obtenerTA(SERVICIO_WSFE, cfg.config, storeAmbiente(taStoreSupabase(c.admin), homo))
  } catch (err: any) {
    return responder({ estado: e.estado, emision_id: e.id, error: `No se obtuvo el ticket de acceso de ARCA: ${err?.message ?? err}` }, 502)
  }
  const o = { cuit: e.cuit_emisor, homo }
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await c.admin.rpc(fn, args)
    if (error) throw new Error(error.message)
    return data as string | null
  }
  try {
    const r = await ejecutarEmision(e as Emision, {
      ultimo: x => ultimoAutorizado(ta, { ...o, ...x }),
      solicitar: comp => solicitarCae(ta, o, comp),
      consultar: x => consultarComprobante(ta, { ...o, ...x }),
    }, {
      iniciarEnvio: async (id, numero, sol) => { await rpc('fact_emision_iniciar_envio', { p_emision_id: id, p_numero: numero, p_solicitud_arca: sol }) },
      resultado: async (id, x) => { await rpc('fact_emision_resultado', { p_emision_id: id, p_resultado: x.resultado, p_respuesta: x.respuesta ?? {},
        p_cae: x.cae ?? null, p_cae_vto: x.caeVto ?? null, p_fecha: x.fecha ?? null, p_observaciones: x.observaciones ?? null }) },
      consulta: (id, x) => rpc('fact_emision_consulta', { p_emision_id: id, p_encontrado: x.encontrado, p_respuesta: x.respuesta ?? {},
        p_cae: x.cae ?? null, p_cae_vto: x.caeVto ?? null, p_fecha: x.fecha ?? null, p_total_c: x.totalC ?? null, p_numero: x.numero }),
    }, { hoy: fechaArgentina(), condicionIva: cli?.condicion_iva ?? '', cbuFce: cbuFceDe(conf) })
    return responder({ ...r, emision_id: e.id }, r.estado === 'invalida' ? 400 : r.estado === 'en_curso' ? 409 : 200)
  } catch (err: any) {
    // Falla al registrar el resultado: la solicitud quedó 'enviando' y la próxima vez se consulta.
    return responder({ estado: 'incierta', emision_id: e.id, error: err?.message ?? String(err) }, 502)
  }
}
