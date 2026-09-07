import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin, requireRole } from '../_lib/employee-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Alta y edición del empleado pasan por acá, con rol validado en servidor.
// Antes el modal escribía directo a `usuarios` con la anon key: el permiso
// vivía solo en la UI. Esconder el botón no es un permiso.
//
// Campos de liquidación (cuil, legajo_visual, cuenta_bancaria): SIEMPRE texto.
// cuenta_bancaria admite CBU de 22 dígitos y conserva ceros a la izquierda;
// convertir a número acá rompería la columna CUENTA del export de sueldos.

const CAMPOS_TEXTO_OPCIONAL = [
  'dni',
  'telefono',
  'email',
  'foto_url',
  'cuil',
  'legajo_visual',
  'cuenta_bancaria',
] as const

const ROLES_VALIDOS = ['admin', 'supervisor', 'guardia', 'vigilador']
const ESTADOS_VALIDOS = ['activo', 'inactivo']

type PayloadUsuario = Record<string, string | null>

function armarPayload(body: any, { esAlta }: { esAlta: boolean }): { payload?: PayloadUsuario, error?: string } {
  const payload: PayloadUsuario = {}

  for (const campo of ['nombre', 'apellido', 'legajo'] as const) {
    if (body[campo] !== undefined) {
      const valor = String(body[campo] ?? '').trim()
      if (!valor) return { error: `El campo ${campo} es obligatorio` }
      payload[campo] = valor
    } else if (esAlta) {
      return { error: `El campo ${campo} es obligatorio` }
    }
  }

  for (const campo of CAMPOS_TEXTO_OPCIONAL) {
    if (body[campo] !== undefined) {
      const valor = String(body[campo] ?? '').trim()
      payload[campo] = valor || null
    }
  }
  if (payload.email) payload.email = payload.email.toLowerCase()

  if (body.rol !== undefined) {
    if (!ROLES_VALIDOS.includes(body.rol)) return { error: 'Rol inválido' }
    payload.rol = body.rol
  }
  if (body.estado !== undefined) {
    if (!ESTADOS_VALIDOS.includes(body.estado)) return { error: 'Estado inválido' }
    payload.estado = body.estado
  }

  return { payload }
}

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const adminError = await requireRole(req, admin.client, ['admin'], 'Sesion de administrador requerida')
  if (adminError) return adminError

  try {
    const body = await req.json()
    const { payload, error } = armarPayload(body, { esAlta: true })
    if (error || !payload) return NextResponse.json({ error: error ?? 'Datos inválidos' }, { status: 400 })

    const { data, error: dbError } = await admin.client
      .from('usuarios')
      .insert(payload)
      .select()
      .single()

    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })
    return NextResponse.json({ ok: true, usuario: data })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno del servidor'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const adminError = await requireRole(req, admin.client, ['admin'], 'Sesion de administrador requerida')
  if (adminError) return adminError

  try {
    const body = await req.json()
    const usuarioId = body?.usuario_id
    if (!usuarioId) return NextResponse.json({ error: 'usuario_id es obligatorio' }, { status: 400 })

    const { payload, error } = armarPayload(body, { esAlta: false })
    if (error || !payload) return NextResponse.json({ error: error ?? 'Datos inválidos' }, { status: 400 })
    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ error: 'Sin campos para actualizar' }, { status: 400 })
    }

    const { data, error: dbError } = await admin.client
      .from('usuarios')
      .update(payload)
      .eq('id', usuarioId)
      .select()
      .single()

    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })
    return NextResponse.json({ ok: true, usuario: data })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno del servidor'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
