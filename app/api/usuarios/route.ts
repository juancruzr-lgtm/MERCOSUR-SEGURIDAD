import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin, resolverPerfil } from '../_lib/employee-auth'
import { tieneCapacidad, esGerenciaReal } from '@/lib/capacidades'
import { afipConfigDesdeEnv } from '@/lib/afip/config'
import { corroborarEmpleado, esperarConTope } from '@/lib/afip/corroborar'
import { sinCuentaBancaria } from '@/lib/usuarios-columnas'
import { protegerVaciadoReservado } from '@/lib/usuarios-edicion'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Corroboración ARCA al incorporar al empleado (reemplaza a la corrida diaria).
 * Acotada en tiempo y sin efecto sobre el alta: si ARCA no responde, el alta
 * igual queda hecha y se corrobora después desde el legajo.
 */
async function corroborarAlAlta(admin: Parameters<typeof corroborarEmpleado>[0], usuarioId: string, solicitadoPor: string) {
  const cfg = afipConfigDesdeEnv()
  if (cfg.error || !cfg.config) return
  await esperarConTope(corroborarEmpleado(admin, cfg.config, usuarioId, { tipo: 'alta', solicitadoPor }), 8000)
}

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
// Puestos NORMALES que Administración puede asignar. 'gerencia' es privilegiado y
// queda reservado a Gerencia real (se valida aparte).
const PUESTOS_NORMALES = ['vigilador', 'supervisor', 'jefe_supervisores', 'direccion_operativa', 'administracion']
const ESTADOS_VALIDOS = ['activo', 'inactivo']

type PayloadUsuario = Record<string, string | boolean | null>

function armarPayload(
  body: any,
  { esAlta, puedeRolPrivilegiado, puedeEconomico, esGerReal }:
    { esAlta: boolean; puedeRolPrivilegiado: boolean; puedeEconomico: boolean; esGerReal: boolean },
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

  // Rol/puesto NORMALES: Administración puede gestionarlos (entra por
  // gestionar_personal). PRIVILEGIADO reservado a Gerencia real: rol 'admin' y
  // puesto 'gerencia' (anti-escalada; el trigger no aplica bajo service_role).
  if (body.rol !== undefined) {
    if (!ROLES_VALIDOS.includes(body.rol)) return { error: 'Rol inválido' }
    if (body.rol === 'admin' && !puedeRolPrivilegiado) {
      return { error: 'Sólo Gerencia puede asignar el rol admin' }
    }
    payload.rol = body.rol
  }
  if (body.puesto_organizacional !== undefined && body.puesto_organizacional !== null && body.puesto_organizacional !== '') {
    const puesto = String(body.puesto_organizacional)
    if (puesto === 'gerencia') {
      if (!esGerReal) return { error: 'Sólo Gerencia puede asignar el puesto gerencia' }
    } else if (!PUESTOS_NORMALES.includes(puesto)) {
      return { error: 'Puesto inválido' }
    }
    payload.puesto_organizacional = puesto
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
  const puedeRolPrivilegiado = tieneCapacidad(perfil, 'gestionar_usuarios_roles')
  const puedeEconomico = tieneCapacidad(perfil, 'ver_finanzas')
  const esGerReal = esGerenciaReal(perfil)

  try {
    const body = await req.json()
    const { payload, error } = armarPayload(body, { esAlta: true, puedeRolPrivilegiado, puedeEconomico, esGerReal })
    if (error || !payload) return NextResponse.json({ error: error ?? 'Datos inválidos' }, { status: 400 })

    const { data, error: dbError } = await admin.client
      .from('usuarios')
      .insert(payload)
      .select()
      .single()

    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })
    if (data?.id && String(data.cuil ?? '').replace(/\D/g, '').length === 11) await corroborarAlAlta(admin.client, data.id, perfil.id)
    // El CBU sólo vuelve a quien tiene capacidad económica (auditoría 05/11, V2).
    return NextResponse.json({ ok: true, usuario: puedeEconomico ? data : sinCuentaBancaria(data) })
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
  const puedeRolPrivilegiado = tieneCapacidad(perfil, 'gestionar_usuarios_roles')
  const puedeEconomico = tieneCapacidad(perfil, 'ver_finanzas')
  const esGerReal = esGerenciaReal(perfil)

  try {
    const body = await req.json()
    const usuarioId = body?.usuario_id
    if (!usuarioId) return NextResponse.json({ error: 'usuario_id es obligatorio' }, { status: 400 })

    const armado = armarPayload(body, { esAlta: false, puedeRolPrivilegiado, puedeEconomico, esGerReal })
    if (armado.error || !armado.payload) return NextResponse.json({ error: armado.error ?? 'Datos inválidos' }, { status: 400 })
    if (Object.keys(armado.payload).length === 0) {
      return NextResponse.json({ error: 'Sin campos para actualizar' }, { status: 400 })
    }

    // Defensa en el servidor (05/11/2026): un CBU, CUIL o legajo de Visual con
    // valor NO se vacía salvo que el cliente lo confirme (confirmar_vaciar).
    // Así un formulario armado con una fila incompleta no borra datos reales.
    const { data: actual, error: actualError } = await admin.client
      .from('usuarios').select('cuenta_bancaria, cuil, legajo_visual').eq('id', usuarioId).maybeSingle()
    if (actualError) return NextResponse.json({ error: actualError.message }, { status: 500 })
    if (!actual) return NextResponse.json({ error: 'Empleado inexistente' }, { status: 404 })
    const { payload, protegidos } = protegerVaciadoReservado(armado.payload, actual as unknown as Record<string, unknown>, body?.confirmar_vaciar)

    const consulta = Object.keys(payload).length === 0
      ? admin.client.from('usuarios').select().eq('id', usuarioId).single()
      : admin.client.from('usuarios').update(payload).eq('id', usuarioId).select().single()
    const { data, error: dbError } = await consulta

    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })
    // El CBU sólo vuelve a quien tiene capacidad económica (auditoría 05/11, V2).
    return NextResponse.json({ ok: true, usuario: puedeEconomico ? data : sinCuentaBancaria(data), campos_protegidos: protegidos })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno del servidor'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
