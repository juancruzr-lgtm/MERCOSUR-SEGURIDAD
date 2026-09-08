import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin, resolverPerfil } from '../_lib/employee-auth'
import { tieneCapacidad } from '@/lib/capacidades'

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

type PayloadUsuario = Record<string, string | boolean | null>

function armarPayload(
  body: any,
  { esAlta, puedeRol, puedeEconomico }: { esAlta: boolean; puedeRol: boolean; puedeEconomico: boolean },
): { payload?: PayloadUsuario, error?: string } {
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
    // cuenta_bancaria es ECONÓMICO (columna CUENTA del export de sueldos): sólo
    // lo escribe quien tiene capacidad económica (gerencia). Administración
    // gestiona el resto del personal, no lo bancario/salarial (ROLES 4).
    if (campo === 'cuenta_bancaria' && !puedeEconomico) continue
    if (body[campo] !== undefined) {
      const valor = String(body[campo] ?? '').trim()
      payload[campo] = valor || null
    }
  }
  if (typeof payload.email === 'string') payload.email = payload.email.toLowerCase()

  // Asignar/cambiar rol es sensible (gestión de usuarios/roles = gerencia): sin
  // esa capacidad el campo se ignora (no se escala rol desde Administración).
  if (body.rol !== undefined && puedeRol) {
    if (!ROLES_VALIDOS.includes(body.rol)) return { error: 'Rol inválido' }
    payload.rol = body.rol
  }
  if (body.estado !== undefined) {
    if (!ESTADOS_VALIDOS.includes(body.estado)) return { error: 'Estado inválido' }
    payload.estado = body.estado
  }
  // Cuenta de prueba: booleano; si la columna aún no existe en la base, el
  // caller no debe mandarlo (la UI manda false por defecto y el update falla
  // recién ahí, con mensaje claro de Postgres).
  if (body.es_prueba !== undefined) payload.es_prueba = Boolean(body.es_prueba)

  return { payload }
}

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const acceso = await resolverPerfil(req, admin.client)
  if ('respuesta' in acceso) return acceso.respuesta
  const { perfil } = acceso
  if (!tieneCapacidad(perfil, 'gestionar_personal')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  const puedeRol = tieneCapacidad(perfil, 'gestionar_usuarios_roles')
  const puedeEconomico = tieneCapacidad(perfil, 'ver_finanzas')

  try {
    const body = await req.json()
    const { payload, error } = armarPayload(body, { esAlta: true, puedeRol, puedeEconomico })
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

  const acceso = await resolverPerfil(req, admin.client)
  if ('respuesta' in acceso) return acceso.respuesta
  const { perfil } = acceso
  if (!tieneCapacidad(perfil, 'gestionar_personal')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  const puedeRol = tieneCapacidad(perfil, 'gestionar_usuarios_roles')
  const puedeEconomico = tieneCapacidad(perfil, 'ver_finanzas')

  try {
    const body = await req.json()
    const usuarioId = body?.usuario_id
    if (!usuarioId) return NextResponse.json({ error: 'usuario_id es obligatorio' }, { status: 400 })

    const { payload, error } = armarPayload(body, { esAlta: false, puedeRol, puedeEconomico })
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
