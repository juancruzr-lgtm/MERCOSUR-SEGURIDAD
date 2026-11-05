// GET ?ambiente=homologacion|produccion — diagnóstico de la conexión con ARCA (WSFE).
//
// Sólo lectura: FEDummy, ticket WSAA, FEParamGetPtosVenta y FECompUltimoAutorizado.
// No pide CAE, no crea emisiones y no cambia ninguna llave. No requiere que la
// emisión esté habilitada: sirve justamente para verificar antes de habilitarla.
// Sólo Gerencia o Administración (facturacion_puede_actual).
import type { NextRequest } from 'next/server'
import { clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { afipConfigFacturacion, type AmbienteArca } from '@/lib/afip/config'
import { obtenerTA } from '@/lib/afip/wsaa'
import { taStoreSupabase } from '@/lib/afip/ta-store-supabase'
import { SERVICIO_WSFE, estadoServidores, puntosDeVenta, ultimoAutorizado } from '@/lib/afip/wsfe'
import { datosAmbiente, diagnosticar } from '@/lib/facturacion/diagnostico-arca'
import { storeAmbiente } from '@/lib/facturacion/ta-ambiente'
import { responder } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)
  const { data: puede, error: errPuede } = await c.usuario.rpc('facturacion_puede_actual')
  if (errPuede || puede !== true) return responder({ error: 'Sólo Gerencia o Administración' }, 403)

  const ambiente = req.nextUrl.searchParams.get('ambiente') as AmbienteArca
  if (!['produccion', 'homologacion'].includes(ambiente)) return responder({ error: 'Ambiente inválido' }, 400)
  const homo = ambiente === 'homologacion'

  const { data: conf } = await c.usuario.from('fact_config').select('valor').eq('clave', 'emision').maybeSingle()
  const cfg = (conf?.valor ?? {}) as Record<string, any>
  const credenciales = afipConfigFacturacion(ambiente)
  const { puntoVenta } = datosAmbiente(ambiente, cfg)
  const cuit = credenciales.config?.cuitRepresentada ?? ''
  let ta: Awaited<ReturnType<typeof obtenerTA>> | null = null

  const r = await diagnosticar({
    ambiente, credenciales, cfg,
    emisionRealServidor: process.env.FACTURACION_EMISION_REAL === '1',
    arca: {
      servidores: () => estadoServidores(homo),
      ticket: async () => { ta = await obtenerTA(SERVICIO_WSFE, credenciales.config!, storeAmbiente(taStoreSupabase(c.admin), homo)) },
      puntos: () => puntosDeVenta(ta!, { cuit, homo }),
      ultimo: x => ultimoAutorizado(ta!, { cuit, homo, ...x }),
    },
  })
  return responder({ ...r, punto_venta: puntoVenta, consultado_at: new Date().toISOString() })
}
