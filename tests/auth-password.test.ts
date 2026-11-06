/**
 * Autenticación: login, cambio y recuperación de contraseña, reparación de
 * accesos (auditoría auth nov-2026).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  mensajeErrorAuth,
  mensajeErrorCambioPassword,
  validarCredencialesLogin,
  validarEmail,
  validarNuevaPassword,
} from '@/lib/auth-mensajes'
import {
  CLAVE_RECUPERACION,
  capturarEnlaceAuth,
  leerEnlaceAuth,
  limpiarRecuperacionPendiente,
  recuperacionPendientePara,
  sessionIdDe,
  tomarErrorEnlace,
} from '@/lib/auth-recuperacion'
import { repairEmployeeAuthUser } from '@/app/api/_lib/auth-repair'

const leer = (ruta: string) => readFileSync(join(__dirname, '..', ruta), 'utf8')
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('login: validación de campos', () => {
  it('rechaza email y contraseña vacíos antes de llamar a Supabase', () => {
    expect(validarCredencialesLogin('', '')).toBe('Ingresá tu email y tu contraseña.')
    expect(validarCredencialesLogin('   ', '  ')).toBe('Ingresá tu email y tu contraseña.')
  })
  it('rechaza email vacío o mal formado', () => {
    expect(validarCredencialesLogin('', '123456')).toBe('Ingresá tu email.')
    expect(validarCredencialesLogin('juan@', '123456')).toBe('El email no tiene un formato válido.')
    expect(validarEmail('juan perez@mail.com')).not.toBeNull()
  })
  it('rechaza contraseña vacía', () => {
    expect(validarCredencialesLogin('juan@mail.com', '')).toBe('Ingresá tu contraseña.')
  })
  it('acepta credenciales completas', () => {
    expect(validarCredencialesLogin(' Juan@Mail.com ', '30111222')).toBeNull()
  })
  it('el login no ofrece Magic Link (la recuperación cubre ese caso)', () => {
    const login = sinComentarios(leer('app/dashboard/Login.tsx'))
    expect(login).not.toMatch(/signInWithOtp|Magic Link/)
    expect(login).toMatch(/Olvidé mi contraseña/)
  })
  it('el login valida antes de signInWithPassword', () => {
    const login = sinComentarios(leer('app/dashboard/Login.tsx'))
    const cuerpo = login.slice(login.indexOf('const login = async'), login.indexOf('const recuperarPassword'))
    expect(cuerpo.indexOf('validarCredencialesLogin')).toBeGreaterThan(-1)
    expect(cuerpo.indexOf('validarCredencialesLogin')).toBeLessThan(cuerpo.indexOf('signInWithPassword'))
  })
})

describe('mensajes de error: claros y sin datos sensibles', () => {
  it('credenciales inválidas no distinguen si el email existe', () => {
    expect(mensajeErrorAuth({ message: 'Invalid login credentials', code: 'invalid_credentials' }, 'inicio de sesión'))
      .toBe('Email o contraseña incorrectos.')
  })
  it('límite de envíos y errores de red tienen mensaje propio', () => {
    expect(mensajeErrorAuth({ message: 'email rate limit exceeded', code: 'over_email_send_rate_limit' }, 'recuperación'))
      .toMatch(/demasiados intentos/)
    expect(mensajeErrorAuth(new TypeError('Failed to fetch'), 'inicio de sesión')).toMatch(/conexión/)
  })
  it('no expone el detalle técnico de Supabase/SMTP', () => {
    const m = mensajeErrorAuth({ message: 'Error sending recovery email: 535 smtp auth failed user=x' }, 'recuperación de contraseña')
    expect(m).not.toMatch(/535|smtp|user=/i)
    expect(mensajeErrorAuth({ message: 'pq: relation secret_table does not exist' }, 'inicio de sesión')).not.toMatch(/secret_table/)
  })
  it('cambio de contraseña: misma clave, débil, sesión vencida', () => {
    expect(mensajeErrorCambioPassword({ code: 'same_password', message: 'New password should be different from the old password.' })).toMatch(/distinta/)
    expect(mensajeErrorCambioPassword({ code: 'weak_password', message: 'Password should be at least 6 characters.' })).toMatch(/débil/)
    expect(mensajeErrorCambioPassword({ message: 'Auth session missing!' })).toMatch(/sesión venció/)
  })
})

describe('nueva contraseña: validación', () => {
  it('exige largo mínimo, coincidencia y sin espacios en los bordes', () => {
    expect(validarNuevaPassword('', '')).toBe('Ingresá la nueva contraseña.')
    expect(validarNuevaPassword('12345', '12345')).toMatch(/al menos 6/)
    expect(validarNuevaPassword('abcdef', 'abcdeg')).toBe('Las contraseñas no coinciden.')
    expect(validarNuevaPassword(' abcdef', ' abcdef')).toMatch(/espacios/)
    expect(validarNuevaPassword('Segura123', 'Segura123')).toBeNull()
  })
})

describe('recuperación: lectura del enlace', () => {
  it('detecta el enlace de recuperación (flujo implícito)', () => {
    expect(leerEnlaceAuth('#access_token=x&refresh_token=y&type=recovery', '')).toEqual({ recuperacion: true, invitacion: false, error: null })
  })
  it('un Magic Link no es recuperación', () => {
    expect(leerEnlaceAuth('#access_token=x&type=magiclink', '').recuperacion).toBe(false)
  })
  it('enlace vencido o usado: mensaje y sin recuperación', () => {
    const r = leerEnlaceAuth('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', '')
    expect(r.recuperacion).toBe(false)
    expect(r.error).toMatch(/venció o ya fue usado/)
  })
  it('error en query string también se informa', () => {
    expect(leerEnlaceAuth('', '?error=server_error&error_code=unexpected_failure').error).toMatch(/no es válido/)
  })
})

describe('recuperación: marca pendiente', () => {
  const datos = new Map<string, string>()
  beforeEach(() => {
    datos.clear()
    vi.stubGlobal('window', {
      location: { hash: '', search: '', pathname: '/dashboard' },
      history: { replaceState: vi.fn() },
      localStorage: {
        getItem: (k: string) => datos.get(k) ?? null,
        setItem: (k: string, v: string) => { datos.set(k, v) },
        removeItem: (k: string) => { datos.delete(k) },
      },
    })
  })
  afterEach(() => {
    limpiarRecuperacionPendiente()
    vi.unstubAllGlobals()
  })

  const jwt = (sid: string, n = 0) => `h.${btoa(JSON.stringify({ sub: 'a1', session_id: sid, n })).replace(/=+$/, '')}.f`
  const RECU = jwt('sesion-recu')
  const enlace = (token: string, tipo = 'recovery') => { (window as any).location.hash = `#access_token=${token}&refresh_token=r&type=${tipo}` }

  it('sessionIdDe lee el claim session_id del JWT', () => {
    expect(sessionIdDe(RECU)).toBe('sesion-recu')
    expect(sessionIdDe('basura')).toBeNull()
  })
  it('enlace válido: la sesión que abrió queda bloqueada y persiste (recargas y refrescos de token)', () => {
    enlace(RECU)
    capturarEnlaceAuth()
    expect(recuperacionPendientePara(RECU)).toBe(true)
    expect(datos.get(CLAVE_RECUPERACION)).toBe('sesion-recu')
    ;(window as any).location.hash = ''
    capturarEnlaceAuth()
    expect(recuperacionPendientePara(jwt('sesion-recu', 1))).toBe(true)
  })
  it('regresión: enlace inválido con sesión previa abierta NO convierte esa sesión en recuperación', () => {
    enlace('token-falso-que-supabase-rechaza')
    capturarEnlaceAuth()
    expect(recuperacionPendientePara(jwt('sesion-normal'))).toBe(false)
    expect(datos.has(CLAVE_RECUPERACION)).toBe(false)
  })
  it('regresión: marca vieja + login normal posterior (otra sesión) NO pide recuperación y se limpia', () => {
    enlace(RECU)
    capturarEnlaceAuth()
    expect(recuperacionPendientePara(RECU)).toBe(true)
    ;(window as any).location.hash = ''
    capturarEnlaceAuth()
    expect(recuperacionPendientePara(jwt('sesion-login-normal'))).toBe(false)
    expect(datos.has(CLAVE_RECUPERACION)).toBe(false)
  })
  it('regresión: un Magic Link limpia la recuperación pendiente', () => {
    datos.set(CLAVE_RECUPERACION, 'sesion-recu')
    enlace(jwt('sesion-magic'), 'magiclink')
    capturarEnlaceAuth()
    expect(datos.has(CLAVE_RECUPERACION)).toBe(false)
    expect(recuperacionPendientePara(jwt('sesion-magic'))).toBe(false)
  })
  it('se limpia explícitamente', () => {
    enlace(RECU)
    capturarEnlaceAuth()
    recuperacionPendientePara(RECU)
    limpiarRecuperacionPendiente()
    expect(recuperacionPendientePara(RECU)).toBe(false)
  })
  it('el error del enlace se entrega una sola vez y limpia la URL', () => {
    ;(window as any).location.hash = '#error=access_denied&error_code=otp_expired'
    capturarEnlaceAuth()
    expect(tomarErrorEnlace()).toMatch(/venció/)
    expect((window as any).history.replaceState).toHaveBeenCalledWith(null, '', '/dashboard')
    expect(tomarErrorEnlace()).toBeNull()
  })
})

describe('recuperación: el panel queda bloqueado hasta fijar la contraseña', () => {
  const shell = sinComentarios(leer('app/dashboard/AppShell.tsx'))
  it('AppShell revisa la recuperación pendiente antes de resolver el perfil', () => {
    const arranque = shell.slice(shell.indexOf('const arrancar'))
    expect(arranque.indexOf('recuperacionPendientePara(data.session.access_token)')).toBeGreaterThan(-1)
    expect(arranque.indexOf('recuperacionPendientePara(')).toBeLessThan(arranque.indexOf('perfilDeSesionActual()'))
    expect(arranque.indexOf('getSession()')).toBeLessThan(arranque.indexOf('tomarErrorEnlace()'))
    expect(shell).toMatch(/fase: 'recuperacion'/)
  })
  it('la marca sólo se limpia al guardar, al cancelar (cerrando sesión) o sin sesión', () => {
    expect(shell).toMatch(/onListo=\{\(\) => \{\s*limpiarRecuperacionPendiente\(\)/)
    const cancelar = shell.slice(shell.indexOf('const cancelarRecuperacion'), shell.indexOf('if (estado.fase'))
    expect(cancelar).toMatch(/limpiarRecuperacionPendiente\(\)/)
    expect(cancelar).toMatch(/signOut\(\)/)
  })
  it('regresión: enlace vencido con sesión abierta avisa en vez de entrar en silencio', () => {
    expect(shell).toMatch(/if \(errorEnlace\) \{ setEstado\(\{ fase: 'avisoEnlace'/)
    expect(shell).toMatch(/Tu contraseña no cambió/)
  })
  it('el enlace se lee antes de crear el cliente de Supabase', () => {
    const cliente = sinComentarios(leer('lib/supabase.ts'))
    expect(cliente.indexOf('capturarEnlaceAuth()')).toBeLessThan(cliente.indexOf('createClient('))
    expect(cliente).toMatch(/PASSWORD_RECOVERY/)
  })
})

describe('cambio de contraseña: un solo componente, sólo sobre la propia cuenta', () => {
  it('vigilador, supervisor, administración/gerencia y recuperación usan NuevaPassword', () => {
    for (const ruta of ['components/guardia/GuardiaMobile.tsx', 'components/supervisor/SupervisorMobile.tsx', 'app/dashboard/AppClient.tsx', 'app/dashboard/AppShell.tsx']) {
      const src = sinComentarios(leer(ruta))
      expect(src, ruta).toMatch(/import NuevaPassword from '@\/components\/auth\/NuevaPassword'/)
      expect(src, ruta).toMatch(/<NuevaPassword/)
      expect(src, ruta).not.toMatch(/updateUser\(\{\s*password/)
    }
  })
  it('el componente usa updateUser de la sesión, sin ids ni service_role', () => {
    const comp = sinComentarios(leer('components/auth/NuevaPassword.tsx'))
    expect(comp).toMatch(/supabase\.auth\.updateUser\(\{ password: nueva \}\)/)
    expect(comp).not.toMatch(/service_role|SERVICE_ROLE|admin\.|usuario_id|userId/)
  })
})

// ── Reparación de accesos (service_role) ─────────────────────────────────────

type Llamada = { id: string; payload: Record<string, unknown> }

function adminFalso(authUsers: any[]) {
  const updates: Llamada[] = []
  const creates: Record<string, unknown>[] = []
  const deletes: string[] = []
  const builder: any = {
    select: () => builder, eq: () => builder, update: () => builder,
    maybeSingle: async () => ({ data: { acceso_bloqueado: false }, error: null }),
    single: async () => ({ data: { id: 'u1' }, error: null }),
  }
  const client: any = {
    from: () => builder,
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: authUsers }, error: null }),
        getUserById: async (id: string) => ({ data: { user: authUsers.find(u => u.id === id) ?? null }, error: null }),
        updateUserById: async (id: string, payload: Record<string, unknown>) => { updates.push({ id, payload }); return { error: null } },
        createUser: async (payload: Record<string, unknown>) => { creates.push(payload); return { data: { user: { id: 'nuevo', email: payload.email, identities: [{ id: 'i' }] } }, error: null } },
        deleteUser: async (id: string) => { deletes.push(id); return { error: null } },
      },
    },
  }
  return { client, updates, creates, deletes }
}

const empleado = { id: 'u1', nombre: 'Ana', apellido: 'Prueba', dni: '30111222', email: 'ana.prueba@example.test', rol: 'vigilador', estado: 'activo', auth_user_id: 'a1' }
const valida = { id: 'a1', email: 'ana.prueba@example.test', identities: [{ id: 'i1' }] }

describe('reparación de accesos: nunca pisa la contraseña de una cuenta válida', () => {
  it('reparación masiva sobre cuenta válida: no envía password', async () => {
    const f = adminFalso([valida])
    const r = await repairEmployeeAuthUser(f.client, empleado as any)
    expect(r.action).toBe('reparado')
    expect(f.updates).toHaveLength(1)
    expect(f.updates[0].payload).not.toHaveProperty('password')
    expect(f.updates[0].payload).toMatchObject({ email: 'ana.prueba@example.test', email_confirm: true })
    expect(f.creates).toHaveLength(0)
  })
  it('cuenta válida encontrada por email (vínculo nuevo): tampoco envía password', async () => {
    const f = adminFalso([{ ...valida, id: 'a9' }])
    const r = await repairEmployeeAuthUser(f.client, { ...empleado, auth_user_id: null } as any)
    expect(r.action).toBe('vinculado')
    expect(f.updates[0].payload).not.toHaveProperty('password')
  })
  it('cuenta inexistente: se crea con la contraseña inicial (comportamiento autorizado)', async () => {
    const f = adminFalso([])
    const r = await repairEmployeeAuthUser(f.client, { ...empleado, auth_user_id: null } as any)
    expect(r.action).toBe('creado')
    expect(f.creates[0]).toMatchObject({ password: '30111222' })
  })
  it('cuenta inválida (sin identity): se elimina y se recrea con la contraseña inicial', async () => {
    const f = adminFalso([{ ...valida, identities: [] }])
    const r = await repairEmployeeAuthUser(f.client, empleado as any)
    expect(r.action).toBe('recreado')
    expect(f.deletes).toContain('a1')
    expect(f.creates[0]).toMatchObject({ password: '30111222' })
  })
  it('sólo el reset individual explícito vuelve la contraseña al DNI', async () => {
    const f = adminFalso([valida])
    await repairEmployeeAuthUser(f.client, empleado as any, undefined, { resetearPassword: true })
    expect(f.updates[0].payload).toMatchObject({ password: '30111222' })
  })
  it('las rutas: sólo reset-user-password pide resetear; la masiva y create-user no', () => {
    expect(sinComentarios(leer('app/api/reset-user-password/route.ts'))).toMatch(/resetearPassword: true/)
    expect(sinComentarios(leer('app/api/admin/repair-auth-users/route.ts'))).not.toMatch(/resetearPassword/)
    expect(sinComentarios(leer('app/api/create-user/route.ts'))).not.toMatch(/resetearPassword/)
  })
  it('las rutas administrativas exigen sesión con capacidad', () => {
    expect(leer('app/api/reset-user-password/route.ts')).toMatch(/requireCapacidad\(req, admin\.client, 'gestionar_personal'/)
    expect(leer('app/api/admin/repair-auth-users/route.ts')).toMatch(/requireCapacidad\(req, admin\.client, 'configurar_sistema'/)
  })
})

describe('secretos', () => {
  it('ningún archivo de cliente usa la service_role', () => {
    for (const ruta of ['lib/supabase.ts', 'components/auth/NuevaPassword.tsx', 'app/dashboard/Login.tsx', 'app/dashboard/AppShell.tsx']) {
      expect(sinComentarios(leer(ruta)), ruta).not.toMatch(/SERVICE_ROLE|service_role/)
    }
  })
})
