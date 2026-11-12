// POST { prefactura_id, version, ambiente } o { emision_id } (NC/ND aprobadas o reintento/consulta).
//
// Doble llave para la emisión REAL: fact_config.emision.produccion_habilitada
// en la base Y FACTURACION_EMISION_REAL=1 en el servidor. Sin las dos, sólo
// homologación. Sin certificado (AFIP_CERT_PEM/AFIP_KEY_PEM) no se llama a ARCA:
// la solicitud queda 'preparada' y se informa la dependencia.
// Una factura de servicio REAL nueva sólo sale desde su prefactura, con la confirmación de Gerencia y los
// controles de duplicado; por emision_id sólo se consulta lo ya enviado (o se emiten NC/ND aprobadas).
import type { NextRequest } from 'next/server'
import { clientesDelPedido, type Clientes } from '@/app/api/documentacion/_clientes'
import { guardasEmisionReal, pideCaeFacturaReal, solicitudCoincide, validarFechaEmision } from '@/lib/facturacion/emision-guardas'
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

const dia = (iso: string, mas: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + mas * 86400000).toISOString().slice(0, 10)

/**
 * Controles de una emisión real nueva (lib/facturacion/emision-guardas). Los que admiten excepción
 * (posible duplicado, período superpuesto, importación vieja) sólo se pasan con una excepción EXPRESA de
 * Gerencia con motivo, que queda en el historial (fact_excepcion_duplicado) antes de seguir.
 */
async function guardasProduccion(c: Clientes, b: any) {
  const [{ data: ger }, { data: pf }] = await Promise.all([
    c.usuario.rpc('puede_acceder_gerencia_actual'),
    c.usuario.from('fact_prefacturas').select('id, cliente_id, agrupacion_clave, cuit_receptor, tipo_comprobante, total_c, periodo_desde, periodo_hasta_excl').eq('id', b.prefactura_id).maybeSingle(),
  ])
  if (!pf) return responder({ error: 'Prefactura inexistente o sin acceso' }, 404)
  const [{ data: imp, error: e1 }, { data: otras, error: e2 }, { data: ult, error: e3 }] = await Promise.all([
    c.usuario.from('fact_comprobantes').select('tipo, punto_venta, numero, fecha_emision, doc_nro_receptor, total_c')
      .eq('ambiente', 'produccion').is('prefactura_id', null).in('tipo', [1, 6, 201]).eq('doc_nro_receptor', pf.cuit_receptor ?? '')
      .gte('fecha_emision', dia(pf.periodo_hasta_excl, -7)).lte('fecha_emision', dia(pf.periodo_hasta_excl, 45)).limit(20),
    // '*': con 20261212100000 trae `conciliacion` (período realmente facturado); sin ella, igual funciona.
    c.usuario.from('fact_prefacturas').select('*')
      .eq('cliente_id', pf.cliente_id).eq('agrupacion_clave', pf.agrupacion_clave).neq('estado', 'descartada').limit(100),
    c.usuario.from('fact_importaciones').select('created_at').eq('tipo', 'arca_emitidos').order('created_at', { ascending: false }).limit(1),
  ])
  // Si un control no se puede leer, no se emite (nunca se da por bueno lo que no se verificó).
  if (e1 || e2 || e3) return responder({ error: `No se pudieron verificar los controles de duplicado: ${(e1 ?? e2 ?? e3)?.message}` }, 503)
  const bloqueos = guardasEmisionReal({
    esGerencia: ger === true, prefactura: pf as any, confirmacion: b.confirmacion, confirmoNoEmitidaFuera: b.confirmo_no_emitida_fuera === true,
    importadasSinConciliar: (imp ?? []) as any[], otrasDelServicio: (otras ?? []) as any[], ultimaImportacionAt: (ult ?? [])[0]?.created_at ?? null, ahora: new Date(),
  })
  if (!bloqueos.length) return null
  const duros = bloqueos.filter(x => !x.excepcionable)
  const motivo = String(b.excepcion?.motivo ?? '').trim()
  if (duros.length || !motivo) {
    return responder({ error: bloqueos.map(x => x.error).join(' '), codigo: (duros[0] ?? bloqueos[0]).codigo, excepcionable: duros.length === 0 }, duros.length ? 400 : 409)
  }
  const { error } = await c.usuario.rpc('fact_excepcion_duplicado', { p_prefactura_id: pf.id, p_motivo: `${motivo} [${bloqueos.map(x => x.codigo).join(', ')}]` })
  if (error) return responder({ error: error.message }, 403)
  return null
}

export async function POST(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)
  // Doble control de rol: la base lo vuelve a exigir en cada RPC (facturacion_gate).
  const { data: puede, error: errPuede } = await c.usuario.rpc('facturacion_puede_actual')
  if (errPuede || puede !== true) return responder({ error: 'Sólo Gerencia o Administración' }, 403)
  const b = await req.json().catch(() => ({}))

  let emisionId: string | null = b.emision_id ?? null
  const porEmisionId = !!emisionId
  // Fecha de emisión: la cargada en la prefactura (fecha_emision_prevista, 20261213120000) o, si no hay, hoy.
  // Rango de ARCA para servicios: hasta 10 días atrás, no futura. Que no sea anterior al último autorizado se
  // verifica contra ARCA al emitir. ('*': sin la migración la columna no existe y se emite con fecha de hoy.)
  const hoy = fechaArgentina()
  let fechaEmision: string | null = null
  if (!porEmisionId) {
    const { data: pfFecha } = await c.usuario.from('fact_prefacturas').select('*').eq('id', b.prefactura_id).maybeSingle()
    const prevista = (pfFecha as any)?.fecha_emision_prevista ?? null
    fechaEmision = b.fecha_emision ? String(b.fecha_emision) : prevista
    if (fechaEmision === hoy) fechaEmision = null
  }
  if (fechaEmision) {
    const mal = validarFechaEmision(fechaEmision, hoy)
    if (mal) return responder({ error: `${mal}. Corregí la fecha de emisión de la prefactura. No se envió nada a ARCA.`, codigo: 'fecha_emision' }, 400)
  }
  if (!emisionId) {
    if (!['produccion', 'homologacion'].includes(b.ambiente)) return responder({ error: 'Ambiente inválido' }, 400)
    // Seguro de períodos: no se emite una prefactura del mes en curso o futuro.
    const { data: pf } = await c.usuario.from('fact_prefacturas').select('periodo_mes').eq('id', b.prefactura_id).maybeSingle()
    if (pf?.periodo_mes) { const rechazo = await rechazoPorPeriodo(c.usuario, pf.periodo_mes); if (rechazo) return rechazo }
    // Emisión REAL: confirmación de Gerencia sobre este comprobante y controles de duplicado ANTES de preparar
    // nada (y por lo tanto antes de pedir CAE). Homologación no factura: no los necesita.
    if (b.ambiente === 'produccion') {
      const bloqueo = await guardasProduccion(c, b)
      if (bloqueo) return bloqueo
    }
    const { data, error } = await c.usuario.rpc('fact_emision_preparar', { p_prefactura_id: b.prefactura_id, p_version: b.version, p_ambiente: b.ambiente })
    if (error) return errorRpc(error)
    emisionId = (data as any).id
  }
  // Leer con la identidad del usuario: si no la ve, no la emite.
  const { data: e } = await c.usuario.from('fact_emisiones').select('*').eq('id', emisionId).maybeSingle()
  if (!e) return responder({ error: 'Solicitud de emisión inexistente o sin acceso' }, 404)
  if (e.estado === 'pendiente_aprobacion') return responder({ error: 'La nota todavía no está aprobada' }, 409)
  if (e.estado === 'autorizada') return responder({ estado: 'autorizada', emision_id: e.id })
  // Factura de servicio REAL cuyo próximo paso es pedir CAE (preparada o rechazada).
  if (pideCaeFacturaReal(e)) {
    // Por emision_id (p. ej. una emisión preparada con la RPC directa) se saltearían la confirmación de
    // Gerencia y los controles de duplicado: no se pide CAE. Se emite desde la prefactura.
    if (porEmisionId) {
      return responder({ estado: e.estado, emision_id: e.id, codigo: 'confirmacion', error: 'Una factura real se emite desde su prefactura, con la confirmación de Gerencia. No se envió nada a ARCA.' }, 400)
    }
    // Lo que se manda a ARCA (la solicitud armada al preparar) tiene que ser lo que Gerencia confirmó.
    if (!solicitudCoincide(e, b.confirmacion)) {
      return responder({ estado: e.estado, emision_id: e.id, codigo: 'confirmacion', error: 'Lo preparado para ARCA no coincide con lo que confirmó Gerencia (tipo, CUIT o total). No se envió nada a ARCA.' }, 409)
    }
  }

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
  // Plazo de pago del contrato: si la fecha aprobada ya pasó, se informa emisión + plazo (30 días si no tiene otro).
  const prefK: any = e.prefactura_id ? (await c.usuario.from('fact_prefacturas').select('contrato_id').eq('id', e.prefactura_id).maybeSingle()).data : null
  const kPlazo: any = prefK?.contrato_id ? (await c.usuario.from('fact_contratos').select('dias_vencimiento').eq('id', prefK.contrato_id).maybeSingle()).data : null
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
    }, { hoy, fechaEmision, condicionIva: cli?.condicion_iva ?? '', cbuFce: cbuFceDe(conf), plazoDias: kPlazo?.dias_vencimiento ?? null })
    return responder({ ...r, emision_id: e.id }, r.estado === 'invalida' ? 400 : r.estado === 'en_curso' ? 409 : 200)
  } catch (err: any) {
    // Falla al registrar el resultado: la solicitud quedó 'enviando' y la próxima vez se consulta.
    return responder({ estado: 'incierta', emision_id: e.id, error: err?.message ?? String(err) }, 502)
  }
}
