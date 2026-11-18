// GET ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD — serie diaria de la Tasa de Intereses Moratorios (TIM) del BCRA.
//
// Sólo lectura: la usa el cálculo de intereses por mora de Cobranzas, que no registra ni emite nada.
// Se pide desde el servidor (sin depender de CORS del BCRA) y se cachea 6 horas: el BCRA la publica una vez
// por día. Sólo Gerencia o Administración (facturacion_puede_actual).
import type { NextRequest } from 'next/server'
import { clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { PAGINA_BCRA, TIM_DESCRIPCION, TIM_VARIABLE, parsearSerieBcra, urlSerieBcra } from '@/lib/facturacion/serie-bcra'
import { ordenarSerie, type PuntoSerie } from '@/lib/facturacion/intereses-variables'
import { responder } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const MAX_PAGINAS = 10

export async function GET(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)
  const { data: puede, error: errPuede } = await c.usuario.rpc('facturacion_puede_actual')
  if (errPuede || puede !== true) return responder({ error: 'Sólo Gerencia o Administración' }, 403)

  const desde = req.nextUrl.searchParams.get('desde') ?? ''
  const hasta = req.nextUrl.searchParams.get('hasta') ?? ''
  if (!FECHA.test(desde) || !FECHA.test(hasta) || desde > hasta) return responder({ error: 'Fechas inválidas: desde y hasta como AAAA-MM-DD' }, 400)

  try {
    const puntos: PuntoSerie[] = []
    for (let pagina = 0, offset = 0, total = Infinity; offset < total && pagina < MAX_PAGINAS; pagina++, offset += PAGINA_BCRA) {
      const r = await fetch(urlSerieBcra(TIM_VARIABLE, desde, hasta, offset), { headers: { Accept: 'application/json' }, next: { revalidate: 21600 } } as RequestInit)
      if (!r.ok) return responder({ error: `El BCRA respondió ${r.status} al pedir la TIM` }, 502)
      const p = parsearSerieBcra(await r.json())
      puntos.push(...p.puntos)
      total = p.total
      if (!p.puntos.length) break
    }
    const serie = ordenarSerie(puntos)
    return responder({ serie, fuente: TIM_DESCRIPCION, variable: TIM_VARIABLE, ultima: serie[serie.length - 1] ?? null })
  } catch (e: any) {
    return responder({ error: `No se pudo consultar la TIM al BCRA: ${e?.message ?? e}` }, 502)
  }
}
