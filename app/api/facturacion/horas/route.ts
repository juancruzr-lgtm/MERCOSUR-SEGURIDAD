// POST { accion: 'proponer' | 'aprobar', contrato_id, objetivo_id, mes, notas?, reemplazar?, tratamiento_descubiertos? }
// Las horas salen de turnos + registros de la app; el cliente nunca manda minutos.
import type { NextRequest } from 'next/server'
import { clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { esMesValido } from '@/lib/periodo-argentina'
import { aprobarHoras, proponerHoras } from '@/lib/facturacion/servidor'
import { responder } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)
  const { data: puede } = await c.usuario.rpc('facturacion_puede_actual')
  if (!puede) return responder({ error: 'Sólo Gerencia o Administración' }, 403)
  const b = await req.json().catch(() => ({}))
  if (!esMesValido(b.mes) || !b.contrato_id || !b.objetivo_id) return responder({ error: 'Faltan contrato, objetivo o mes' }, 400)
  try {
    const p = { contratoId: b.contrato_id, objetivoId: b.objetivo_id, mes: b.mes, notas: b.notas, reemplazar: !!b.reemplazar,
      tratamientoDescubiertos: b.tratamiento_descubiertos === 'facturar' ? 'facturar' as const : 'no_facturar' as const }
    if (b.accion === 'aprobar') return responder(await aprobarHoras(c.usuario, p))
    const r = await proponerHoras(c.usuario, p)
    return responder(r)
  } catch (e: any) {
    return responder({ error: e?.message ?? 'No se pudo calcular' }, 400)
  }
}
