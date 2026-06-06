import type { SupabaseClient } from '@supabase/supabase-js'
import { nombreEmpleado, normalizeDni, normalizeEmail, type UsuarioEmpleado } from './employee-auth'

const AUTH_PAGE_SIZE = 100
const MAX_AUTH_PAGES = 100

export const PROTECTED_AUTH_EMAILS = new Set([
  'admin@mercosur.com',
  'juancruz@mercosur.com',
  'info@mercosurseguridad.com.ar',
])

type AuthUser = {
  id: string
  email?: string | null
  identities?: unknown[] | null
  created_at?: string | null
  confirmed_at?: string | null
  email_confirmed_at?: string | null
}

type AuthIndex = {
  byId: Map<string, AuthUser>
  byEmail: Map<string, AuthUser[]>
  users: AuthUser[]
  error: string | null
}

type RepairAction =
  | 'reparado'
  | 'recreado'
  | 'creado'
  | 'vinculado'
  | 'omitido'
  | 'error'

type RepairResult = {
  usuario_id: string
  empleado: string
  email: string
  action: RepairAction
  auth_user_id_anterior?: string | null
  auth_user_id_nuevo?: string | null
  identities?: number
  duplicados_eliminados?: number
  motivo?: string
  error?: string
  user?: UsuarioEmpleado
}

export type AuthAuditReport = {
  auditados: number
  auth_users_revisados: number
  admin_api_error: string | null
  usuarios_sin_auth_user_id: Array<{ usuario_id: string, empleado: string, email: string | null }>
  auth_users_sin_identity: Array<{ auth_user_id: string, email: string | null, usuario_id?: string, empleado?: string }>
  emails_duplicados: Array<{ email: string, total: number, validos: number, invalidos: number, auth_user_ids: string[] }>
  usuarios_vinculados_auth_invalidos: Array<{ usuario_id: string, empleado: string, auth_user_id: string, email: string | null, error?: string }>
  usuarios_sin_email: Array<{ usuario_id: string, empleado: string }>
  usuarios_sin_dni: Array<{ usuario_id: string, empleado: string, email: string | null }>
}

export function authHasIdentity(user?: AuthUser | null) {
  return Array.isArray(user?.identities) && user.identities.length > 0
}

export function isProtectedEmail(email?: string | null) {
  return PROTECTED_AUTH_EMAILS.has(normalizeEmail(email))
}

function authPayload(usuario: UsuarioEmpleado, email: string, dni: string) {
  return {
    email,
    password: dni,
    email_confirm: true,
    user_metadata: {
      usuario_id: usuario.id,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      rol: usuario.rol,
    },
  }
}

function empleadoRef(usuario: UsuarioEmpleado) {
  return {
    usuario_id: usuario.id,
    empleado: nombreEmpleado(usuario),
    email: normalizeEmail(usuario.email) || null,
  }
}

async function guardarAuthUserId(
  supabaseAdmin: SupabaseClient,
  usuario: UsuarioEmpleado,
  authUserId: string,
  email: string,
) {
  return supabaseAdmin
    .from('usuarios')
    .update({ auth_user_id: authUserId, email })
    .eq('id', usuario.id)
    .select('id, nombre, apellido, dni, email, telefono, legajo, rol, estado, foto_url, auth_user_id, created_at')
    .single()
}

export async function listAuthUsersSafe(supabaseAdmin: SupabaseClient): Promise<AuthIndex> {
  const users: AuthUser[] = []

  for (let page = 1; page <= MAX_AUTH_PAGES; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE })
    if (error) {
      return {
        byId: new Map(),
        byEmail: new Map(),
        users,
        error: error.message,
      }
    }

    users.push(...((data?.users || []) as AuthUser[]))
    if (!data?.users?.length || data.users.length < AUTH_PAGE_SIZE) break
  }

  const byId = new Map<string, AuthUser>()
  const byEmail = new Map<string, AuthUser[]>()

  for (const user of users) {
    byId.set(user.id, user)
    const email = normalizeEmail(user.email)
    if (!email) continue
    byEmail.set(email, [...(byEmail.get(email) || []), user])
  }

  return { byId, byEmail, users, error: null }
}

export async function getActiveEmployeesForAuthRepair(
  supabaseAdmin: SupabaseClient,
  filters: { usuario_id?: string | null, email?: string | null } = {},
) {
  let query = supabaseAdmin
    .from('usuarios')
    .select('id, nombre, apellido, dni, email, telefono, legajo, rol, estado, foto_url, auth_user_id, created_at')
    .neq('rol', 'admin')
    .eq('estado', 'activo')
    .order('apellido')

  if (filters.usuario_id) query = query.eq('id', filters.usuario_id)
  if (filters.email) query = query.eq('email', normalizeEmail(filters.email))

  return query
}

export async function auditAuthUsers(
  supabaseAdmin: SupabaseClient,
  filters: { usuario_id?: string | null, email?: string | null } = {},
): Promise<{ report: AuthAuditReport, users: UsuarioEmpleado[], authIndex: AuthIndex }> {
  const { data: usuarios, error: usuariosError } = await getActiveEmployeesForAuthRepair(supabaseAdmin, filters)
  if (usuariosError) throw new Error(usuariosError.message)

  const users = (usuarios || []) as UsuarioEmpleado[]
  const authIndex = await listAuthUsersSafe(supabaseAdmin)
  const report: AuthAuditReport = {
    auditados: users.length,
    auth_users_revisados: authIndex.users.length,
    admin_api_error: authIndex.error,
    usuarios_sin_auth_user_id: [],
    auth_users_sin_identity: [],
    emails_duplicados: [],
    usuarios_vinculados_auth_invalidos: [],
    usuarios_sin_email: [],
    usuarios_sin_dni: [],
  }

  for (const usuario of users) {
    const email = normalizeEmail(usuario.email)
    const dni = normalizeDni(usuario.dni)

    if (!email) report.usuarios_sin_email.push({ usuario_id: usuario.id, empleado: nombreEmpleado(usuario) })
    if (!dni) report.usuarios_sin_dni.push({ usuario_id: usuario.id, empleado: nombreEmpleado(usuario), email: email || null })
    if (!usuario.auth_user_id) report.usuarios_sin_auth_user_id.push(empleadoRef(usuario))

    if (!usuario.auth_user_id) continue

    let authUser = authIndex.byId.get(usuario.auth_user_id)
    let authError: string | undefined

    if (!authUser && authIndex.error) {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(usuario.auth_user_id)
      authUser = data?.user as AuthUser | undefined
      authError = error?.message
    }

    if (!authUser) {
      report.usuarios_vinculados_auth_invalidos.push({
        usuario_id: usuario.id,
        empleado: nombreEmpleado(usuario),
        auth_user_id: usuario.auth_user_id,
        email: email || null,
        error: authError,
      })
      continue
    }

    if (!authHasIdentity(authUser)) {
      report.auth_users_sin_identity.push({
        auth_user_id: authUser.id,
        email: normalizeEmail(authUser.email) || email || null,
        usuario_id: usuario.id,
        empleado: nombreEmpleado(usuario),
      })
    }
  }

  if (!authIndex.error) {
    for (const [email, authUsers] of authIndex.byEmail.entries()) {
      if (authUsers.length < 2) continue
      const validos = authUsers.filter(authHasIdentity)
      const invalidos = authUsers.filter(user => !authHasIdentity(user))

      report.emails_duplicados.push({
        email,
        total: authUsers.length,
        validos: validos.length,
        invalidos: invalidos.length,
        auth_user_ids: authUsers.map(user => user.id),
      })
    }

    for (const authUser of authIndex.users) {
      if (authHasIdentity(authUser)) continue
      if (report.auth_users_sin_identity.some(item => item.auth_user_id === authUser.id)) continue

      report.auth_users_sin_identity.push({
        auth_user_id: authUser.id,
        email: normalizeEmail(authUser.email) || null,
      })
    }
  }

  return { report, users, authIndex }
}

async function deleteInvalidAuthUsers(
  supabaseAdmin: SupabaseClient,
  authUsers: AuthUser[],
  keepUserId?: string | null,
) {
  let deleted = 0
  const errors: string[] = []

  for (const authUser of authUsers) {
    if (!authUser?.id) continue
    if (authUser.id === keepUserId) continue
    if (authHasIdentity(authUser)) continue
    if (isProtectedEmail(authUser.email)) {
      errors.push(`Auth protegido no eliminado: ${authUser.email}`)
      continue
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(authUser.id)
    if (error) errors.push(error.message)
    else deleted += 1
  }

  return { deleted, errors }
}

async function createFreshAuthUser(supabaseAdmin: SupabaseClient, usuario: UsuarioEmpleado, email: string, dni: string) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser(authPayload(usuario, email, dni))
  if (error || !data?.user) return { user: null as AuthUser | null, error: error?.message || 'No se pudo crear usuario Auth' }
  return { user: data.user as AuthUser, error: null }
}

export async function repairEmployeeAuthUser(
  supabaseAdmin: SupabaseClient,
  usuario: UsuarioEmpleado,
  authIndex?: AuthIndex,
): Promise<RepairResult> {
  const email = normalizeEmail(usuario.email)
  const dni = normalizeDni(usuario.dni)
  const base = {
    usuario_id: usuario.id,
    empleado: nombreEmpleado(usuario),
    email,
    auth_user_id_anterior: usuario.auth_user_id || null,
  }

  if (isProtectedEmail(email)) return { ...base, action: 'omitido', motivo: 'Email protegido: no se modifica' }
  if (!email) return { ...base, action: 'omitido', motivo: 'Falta email real' }
  if (!dni) return { ...base, action: 'omitido', motivo: 'Falta DNI' }
  if (dni.length < 6) return { ...base, action: 'omitido', motivo: 'DNI con menos de 6 caracteres' }

  let localIndex = authIndex
  if (!localIndex) localIndex = await listAuthUsersSafe(supabaseAdmin)

  const candidates = localIndex.byEmail.get(email) || []
  let linkedAuth = usuario.auth_user_id ? localIndex.byId.get(usuario.auth_user_id) : undefined
  let linkedLookupError: string | null = null

  if (usuario.auth_user_id && !linkedAuth) {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(usuario.auth_user_id)
    linkedAuth = data?.user as AuthUser | undefined
    linkedLookupError = error?.message || null
  }

  const validCandidates = candidates.filter(authHasIdentity)
  const invalidCandidates = candidates.filter(user => !authHasIdentity(user))
  const linkedHasIdentity = authHasIdentity(linkedAuth)

  if (validCandidates.length > 1 && !validCandidates.some(user => user.id === usuario.auth_user_id)) {
    return { ...base, action: 'error', error: 'Existen duplicados con identity valida; requiere revision manual' }
  }

  const preferredValid = linkedHasIdentity
    ? linkedAuth
    : validCandidates.find(user => user.id === usuario.auth_user_id) || validCandidates[0]

  if (preferredValid) {
    const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(
      preferredValid.id,
      authPayload(usuario, email, dni),
    )

    if (updateAuthError) return { ...base, action: 'error', error: updateAuthError.message }

    const cleanup = await deleteInvalidAuthUsers(supabaseAdmin, invalidCandidates, preferredValid.id)
    if (cleanup.errors.length) return { ...base, action: 'error', error: cleanup.errors.join(' | ') }

    const { data: actualizado, error: updateUsuarioError } = await guardarAuthUserId(
      supabaseAdmin,
      usuario,
      preferredValid.id,
      email,
    )

    if (updateUsuarioError) return { ...base, action: 'error', error: updateUsuarioError.message }

    return {
      ...base,
      action: usuario.auth_user_id === preferredValid.id ? 'reparado' : 'vinculado',
      auth_user_id_nuevo: preferredValid.id,
      identities: preferredValid.identities?.length || 0,
      duplicados_eliminados: cleanup.deleted,
      user: actualizado,
    }
  }

  const invalidLinked = linkedAuth && !linkedHasIdentity ? [linkedAuth] : []
  const invalidsToDelete = [...invalidCandidates, ...invalidLinked].filter((authUser, index, all) =>
    authUser?.id && all.findIndex(item => item?.id === authUser.id) === index
  )

  const cleanup = await deleteInvalidAuthUsers(supabaseAdmin, invalidsToDelete)
  if (cleanup.errors.length) return { ...base, action: 'error', error: cleanup.errors.join(' | ') }

  if (usuario.auth_user_id && !linkedAuth && linkedLookupError) {
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(usuario.auth_user_id)
    if (deleteError) {
      return {
        ...base,
        action: 'error',
        error: `${linkedLookupError}. No se pudo eliminar Auth invalido: ${deleteError.message}`,
      }
    }
  }

  const created = await createFreshAuthUser(supabaseAdmin, usuario, email, dni)
  if (created.error || !created.user) return { ...base, action: 'error', error: created.error || 'No se pudo crear usuario Auth' }

  const { data: actualizado, error: updateUsuarioError } = await guardarAuthUserId(
    supabaseAdmin,
    usuario,
    created.user.id,
    email,
  )

  if (updateUsuarioError) return { ...base, action: 'error', error: updateUsuarioError.message }

  return {
    ...base,
    action: usuario.auth_user_id || cleanup.deleted > 0 ? 'recreado' : 'creado',
    auth_user_id_nuevo: created.user.id,
    identities: created.user.identities?.length || 0,
    duplicados_eliminados: cleanup.deleted,
    user: actualizado,
  }
}

export function summarizeRepairs(results: RepairResult[]) {
  return {
    auditados: results.length,
    reparados: results.filter(result => result.action === 'reparado').length,
    recreados: results.filter(result => result.action === 'recreado').length,
    creados: results.filter(result => result.action === 'creado').length,
    vinculados: results.filter(result => result.action === 'vinculado').length,
    omitidos: results.filter(result => result.action === 'omitido').length,
    errores: results.filter(result => result.action === 'error').length,
    duplicados_eliminados: results.reduce((total, result) => total + (result.duplicados_eliminados || 0), 0),
  }
}
