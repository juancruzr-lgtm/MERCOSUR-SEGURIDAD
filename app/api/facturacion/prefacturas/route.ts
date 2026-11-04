// POST { mes: 'YYYY-MM', contrato_id? } → genera o recalcula las prefacturas del mes desde horas aprobadas.
import type { NextRequest } from 'next/server'
import { clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { esMesValido } from '@/lib/periodo-argentina'
import { generarPrefacturas } from '@/lib/facturacion/servidor'
import { responder } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)
  const { data: puede } = await c.usuario.rpc('facturacion_puede_actual')
  if (!puede) return responder({ error: 'Sólo Gerencia o Administración' }, 403)
  const { mes, contrato_id } = await req.json().catch(() => ({}))
  if (!esMesValido(mes)) return responder({ error: 'Mes inválido (YYYY-MM)' }, 400)
  try {
    return responder(await generarPrefacturas(c.usuario, mes, undefined, typeof contrato_id === 'string' && contrato_id ? contrato_id : undefined))
  } catch (e: any) {
    return responder({ error: e?.message ?? 'No se pudo generar' }, 400)
  }
}
