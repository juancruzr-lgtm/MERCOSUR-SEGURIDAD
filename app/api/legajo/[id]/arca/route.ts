/**
 * /api/legajo/[id]/arca — corroboración ARCA (Padrón A13) de UN empleado,
 * pedida desde su Legajo Digital.
 *
 *   POST → consulta el padrón para ese empleado y guarda la foto
 *          (afip_padron_snapshot). Queda registrada como una corrida de 1 con
 *          quién la pidió. No modifica nombre, apellido, CUIL ni domicilio.
 *
 * Permiso: la MISMA regla del legajo (legajo_puede_gestionar: puesto
 * Administración/Gerencia o delegación de Gerencia), evaluada en la base con
 * la sesión de quien pide. Supervisión y Dirección Operativa no acceden, aunque
 * tengan gestionar_personal o acceso_admin_pleno.
 * La lectura de la última foto es la RPC legajo_arca_de_empleado (misma regla).
 */
import { NextRequest, NextResponse } from 'next/server'
import { SIN_CACHE, clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { afipConfigDesdeEnv } from '@/lib/afip/config'
import { corroborarEmpleado } from '@/lib/afip/corroborar'

export const runtime = 'nodejs'
export const maxDuration = 30
export const fetchCache = 'force-no-store'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const responder = (cuerpo: unknown, status = 200) => NextResponse.json(cuerpo, { status, headers: SIN_CACHE })

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) return responder({ error: 'Empleado inválido' }, 400)
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)

  // Permiso evaluado por la base con la sesión del usuario (no por el menú).
  const { data: puede, error: ePuede } = await c.usuario.rpc('legajo_puede_gestionar')
  if (ePuede || puede !== true) return responder({ error: 'No autorizado' }, 403)
  const { data: yo } = await c.admin.from('usuarios').select('id').eq('auth_user_id', c.authUserId).maybeSingle()

  const cfg = afipConfigDesdeEnv()
  if (cfg.error || !cfg.config) return responder({ error: 'La conexión con ARCA no está configurada' }, 503)

  const r = await corroborarEmpleado(c.admin, cfg.config, params.id, { tipo: 'legajo', solicitadoPor: yo?.id ?? null })
  return responder(r, r.ok ? 200 : 502)
}
