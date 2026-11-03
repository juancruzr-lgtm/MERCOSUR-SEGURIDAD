// POST { movimiento_id? } → recalcula propuestas de conciliación (nunca aplica nada).
import type { NextRequest } from 'next/server'
import { clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { proponerConciliacion } from '@/lib/facturacion/servidor'
import { CUIT_EMPRESA, responder } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)
  const { data: puede } = await c.usuario.rpc('facturacion_puede_actual')
  if (!puede) return responder({ error: 'Sólo Gerencia o Administración' }, 403)
  const b = await req.json().catch(() => ({}))
  try {
    return responder(await proponerConciliacion(c.usuario, CUIT_EMPRESA, b.movimiento_id || undefined))
  } catch (e: any) {
    return responder({ error: e?.message ?? 'No se pudo proponer' }, 400)
  }
}
