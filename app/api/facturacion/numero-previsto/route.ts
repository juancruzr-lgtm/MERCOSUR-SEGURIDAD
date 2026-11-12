// GET ?prefactura_id= — número PREVISTO para emitir en producción la factura de una prefactura. Lo muestra
// la confirmación de Gerencia antes de emitir.
//
// Sólo lectura: ticket de WSAA y FECompUltimoAutorizado del punto de venta Web Service de producción para el
// tipo de la prefactura. No pide CAE, no prepara ni crea emisiones y no cambia ninguna llave. El número
// definitivo lo asigna ARCA al autorizar (último autorizado + 1 en ese momento).
// Sólo Gerencia o Administración (facturacion_puede_actual).
import type { NextRequest } from 'next/server'
import { clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { afipConfigFacturacion } from '@/lib/afip/config'
import { obtenerTA } from '@/lib/afip/wsaa'
import { taStoreSupabase } from '@/lib/afip/ta-store-supabase'
import { SERVICIO_WSFE, consultarComprobante, ultimoAutorizado } from '@/lib/afip/wsfe'
import { fechaEmisionSugerida, numeroComprobante, rangoFechaEmision } from '@/lib/facturacion/emision-guardas'
import { fechaArgentina } from '@/lib/periodo-argentina'
import { storeAmbiente } from '@/lib/facturacion/ta-ambiente'
import { responder } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)
  const { data: puede, error: errPuede } = await c.usuario.rpc('facturacion_puede_actual')
  if (errPuede || puede !== true) return responder({ error: 'Sólo Gerencia o Administración' }, 403)

  const id = req.nextUrl.searchParams.get('prefactura_id') ?? ''
  const [{ data: pf }, { data: conf }] = await Promise.all([
    c.usuario.from('fact_prefacturas').select('tipo_comprobante, periodo_hasta_excl').eq('id', id).maybeSingle(),
    c.usuario.from('fact_config').select('valor').eq('clave', 'emision').maybeSingle(),
  ])
  if (!pf) return responder({ error: 'Prefactura inexistente o sin acceso' }, 404)
  const tipo = Number(pf.tipo_comprobante)
  if (![1, 6, 201].includes(tipo)) return responder({ error: `Tipo de comprobante no emitible por la app: ${pf.tipo_comprobante}` }, 400)
  const puntoVenta = Number((conf?.valor as any)?.punto_venta_prod)
  if (!Number.isInteger(puntoVenta) || puntoVenta <= 0) return responder({ error: 'Falta el punto de venta Web Service de producción (fact_config.emision.punto_venta_prod)' }, 503)

  const cred = afipConfigFacturacion('produccion')
  if (!cred.config) return responder({ error: `Sin credenciales de ARCA (${cred.error})` }, 503)
  if (cred.config.homo) return responder({ error: 'El certificado de facturación no es el de producción' }, 409)
  try {
    const ta = await obtenerTA(SERVICIO_WSFE, cred.config, storeAmbiente(taStoreSupabase(c.admin), false))
    const r = await ultimoAutorizado(ta, { cuit: cred.config.cuitRepresentada, homo: false, puntoVenta, tipo })
    if ('error' in r) return responder({ error: `ARCA no informó el último número autorizado: ${r.error}` }, 502)
    const numero = r.numero + 1
    // Fecha del último autorizado: la fecha de emisión elegible no puede ser anterior (rango para el aviso).
    let ultimaFecha: string | null = null
    if (r.numero > 0) {
      const u = await consultarComprobante(ta, { cuit: cred.config.cuitRepresentada, homo: false, puntoVenta, tipo, numero: r.numero })
      if (!('error' in u) && u.encontrado) ultimaFecha = u.fecha || null
    }
    const hoy = fechaArgentina()
    const rango = rangoFechaEmision(hoy, ultimaFecha)
    // Fecha por defecto (prefactura sin fecha cargada): la más vieja que ARCA acepta, no antes del fin del período.
    // Si no se pudo saber la fecha del último autorizado, hoy (nunca se sugiere una que ARCA podría rechazar).
    const finPeriodo = (pf as any).periodo_hasta_excl ? new Date(Date.parse(`${(pf as any).periodo_hasta_excl}T00:00:00Z`) - 86400000).toISOString().slice(0, 10) : null
    const sugerida = r.numero > 0 && !ultimaFecha ? hoy : fechaEmisionSugerida(hoy, ultimaFecha, finPeriodo)
    return responder({ tipo, punto_venta: puntoVenta, ultimo_autorizado: r.numero, numero_previsto: numero,
      numero_visible: numeroComprobante(puntoVenta, numero), consultado_at: new Date().toISOString(),
      ultima_fecha: ultimaFecha, fecha_desde: rango.desde, fecha_hasta: rango.hasta, fecha_sugerida: sugerida })
  } catch (err: any) {
    return responder({ error: `No se pudo consultar a ARCA: ${err?.message ?? err}` }, 502)
  }
}
