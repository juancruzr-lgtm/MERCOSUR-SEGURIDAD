import { NextRequest, NextResponse } from 'next/server'
import { repairEmployeeAuthUser } from '../_lib/auth-repair'
import { getSupabaseAdmin, resolverPerfil } from '../_lib/employee-auth'
import { tieneCapacidad, alcanceDe } from '@/lib/capacidades'

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  // gestionar_personal (Administración) crea acceso a cualquier empleado; el
  // gate OPERATIVO (supervisor/jefe) sólo alcanza cuentas guardia/vigilador,
  // espejando la whitelist de resolver_solicitud_personal_operativo.
  const acceso = await resolverPerfil(req, admin.client)
  if ('respuesta' in acceso) return acceso.respuesta
  const pleno = tieneCapacidad(acceso.perfil, 'gestionar_personal')
  const operativo = tieneCapacidad(acceso.perfil, 'gestionar_personal_operativo')
  if (!pleno && !operativo) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  try {
    const body = await req.json()
    const usuarioId = body?.usuario_id

    if (!usuarioId) return NextResponse.json({ error: 'usuario_id es obligatorio' }, { status: 400 })

    const { data: usuario, error: usuarioError } = await admin.client
      .from('usuarios')
      .select('id, nombre, apellido, dni, email, rol, estado, auth_user_id')
      .eq('id', usuarioId)
      .maybeSingle()

    if (usuarioError) return NextResponse.json({ error: usuarioError.message }, { status: 500 })
    if (!usuario) return NextResponse.json({ error: 'Empleado no encontrado' }, { status: 404 })

    if (!pleno && !['guardia', 'vigilador'].includes(usuario.rol || 'guardia')) {
      return NextResponse.json({ error: 'Solo podes crear acceso a vigiladores' }, { status: 403 })
    }

    // Alcance por ZONA (JC): el gate operativo (supervisor) sólo crea acceso a
    // vigiladores de SU alcance. COMPATIBLE CON VIGILADORES NUEVOS: si el
    // vigilador todavía no tiene turnos/zona operativa (recién creado), se
    // permite (no pertenece a otra zona); si ya tiene turnos, TODAS sus zonas
    // deben estar en las del supervisor. Jefe/alcance 'todas' → sin límite.
    if (!pleno && alcanceDe(acceso.perfil) !== 'todas') {
      const { data: sz } = await admin.client
        .from('supervisor_zonas').select('zona_id').eq('supervisor_id', acceso.perfil.id)
      const zonasSup = new Set((sz || []).map((r: any) => r.zona_id))
      const { data: ts } = await admin.client
        .from('turnos').select('objetivo_id').eq('guardia_id', usuario.id)
      const objIds = (ts || []).map((r: any) => r.objetivo_id).filter(Boolean)
      if (objIds.length) {
        const { data: objs } = await admin.client.from('objetivos').select('zona_id').in('id', objIds)
        const fueraDeAlcance = (objs || []).some((o: any) => o.zona_id && !zonasSup.has(o.zona_id))
        if (fueraDeAlcance) {
          return NextResponse.json({ error: 'Ese vigilador está fuera de tu alcance de zona' }, { status: 403 })
        }
      }
    }

    const resultado = await repairEmployeeAuthUser(admin.client, usuario)

    if (resultado.action === 'omitido') return NextResponse.json({ error: resultado.motivo }, { status: 400 })
    if (resultado.action === 'error') return NextResponse.json({ error: resultado.error }, { status: 400 })

    const message =
      resultado.action === 'creado'
        ? 'Usuario Auth creado correctamente'
      : resultado.action === 'vinculado'
        ? 'Usuario Auth vinculado correctamente'
        : resultado.action === 'recreado'
          ? 'Usuario Auth recreado correctamente'
        : 'El empleado ya tenia usuario Auth; acceso reparado correctamente'

    return NextResponse.json({
      ok: true,
      action: resultado.action,
      user: resultado.user,
      message,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno del servidor'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
