// POST { mes: 'YYYY-MM', contrato_id? } → genera o recalcula las prefacturas del mes desde horas aprobadas.
//
// Seguro de períodos: el mes en curso o futuro se rechaza (salvo excepción gerencial), y cada
// recálculo queda registrado como operación (fact_operaciones): no se puede lanzar otro
// equivalente sobre el mismo período mientras sigue, y el resultado se consulta después aunque el
// navegador haya dejado de esperar.
import type { NextRequest } from 'next/server'
import { clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { esMesValido } from '@/lib/periodo-argentina'
import { generarPrefacturas } from '@/lib/facturacion/servidor'
import { errorRpc, faltaFuncion, rechazoPorPeriodo, responder } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// El recálculo del mes tarda ~70 s con 18 contratos.
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)
  const { data: puede } = await c.usuario.rpc('facturacion_puede_actual')
  if (!puede) return responder({ error: 'Sólo Gerencia o Administración' }, 403)
  const { mes, contrato_id } = await req.json().catch(() => ({}))
  if (!esMesValido(mes)) return responder({ error: 'Mes inválido (YYYY-MM)' }, 400)
  const contratoId = typeof contrato_id === 'string' && contrato_id ? contrato_id : undefined

  const rechazo = await rechazoPorPeriodo(c.usuario, mes)
  if (rechazo) return rechazo

  // Operación en curso: una sola por período (o por contrato del período).
  let operacionId: string | null = null
  const op = await c.usuario.rpc('fact_operacion_iniciar', { p_tipo: contratoId ? 'recalculo_contrato' : 'recalculo_mes', p_mes: mes, p_contrato_id: contratoId ?? null })
  if (op.error) {
    if (op.error.code === '55P03') return responder({ error: op.error.message, codigo: 'operacion_en_curso', mes }, 409)
    if (!faltaFuncion(op.error, 'fact_operacion_iniciar')) return errorRpc(op.error)
  } else operacionId = op.data as string

  try {
    const r = await generarPrefacturas(c.usuario, mes, undefined, contratoId)
    if (operacionId) await c.usuario.rpc('fact_operacion_terminar', { p_id: operacionId, p_estado: 'terminada', p_resultado: r })
    return responder({ ...r, operacion_id: operacionId })
  } catch (e: any) {
    if (operacionId) await c.usuario.rpc('fact_operacion_terminar', { p_id: operacionId, p_estado: 'fallida', p_resultado: { error: e?.message ?? String(e) } })
    return responder({ error: e?.message ?? 'No se pudo generar', operacion_id: operacionId }, 400)
  }
}
