/**
 * Seguridad (auditoría alta de vigiladores 06/11/2026):
 *  - fichaje sólo para empleados activos (migración 20261208100000 + /api/upload-evidence)
 *  - acceso por invitación en lugar de contraseña = DNI
 *  - cambio obligatorio/sugerido cuando se ingresa con el DNI
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { puedeFichar } from '@/lib/fichaje-habilitado'
import {
  CLAVE_PASSWORD_DNI,
  exigenciaCambioDni,
  limpiarPasswordDni,
  marcarPasswordDni,
  passwordDniPendientePara,
  passwordEsDni,
  politicaCambioDni,
  posponerPasswordDni,
} from '@/lib/acceso-password-dni'
import { leerEnlaceAuth } from '@/lib/auth-recuperacion'
import { validarNuevaPassword } from '@/lib/auth-mensajes'
import { accesoPorInvitacion } from '@/app/api/_lib/acceso-modo'
import { invitarEmpleado, urlRetornoAcceso } from '@/app/api/_lib/acceso-invitacion'

const leer = (ruta: string) => readFileSync(join(__dirname, '..', ruta), 'utf8')

// JWT falso con session_id (sólo el payload importa para sessionIdDe).
const token = (sid: string) => `x.${btoa(JSON.stringify({ session_id: sid }))}.y`

describe('fichaje: sólo empleados activos', () => {
  it('activo sin bloqueo puede; inactivo, bloqueado o sin perfil no', () => {
    expect(puedeFichar({ estado: 'activo', acceso_bloqueado: false })).toBe(true)
    expect(puedeFichar({ estado: 'activo' })).toBe(true)
    expect(puedeFichar({ estado: 'inactivo', acceso_bloqueado: false })).toBe(false)
    expect(puedeFichar({ estado: 'activo', acceso_bloqueado: true })).toBe(false)
    expect(puedeFichar(null)).toBe(false)
  })

  it('/api/upload-evidence corta antes de subir fotos si el legajo no está activo', () => {
    const ruta = leer('app/api/upload-evidence/route.ts')
    expect(ruta).toMatch(/select\('id, rol, estado, acceso_bloqueado'\)/)
    expect(ruta.indexOf('puedeFichar(usuario)')).toBeGreaterThan(-1)
    expect(ruta.indexOf('puedeFichar(usuario)')).toBeLessThan(ruta.indexOf('storage'))
  })

  it('la migración sólo agrega permisos: no modifica filas de fichajes', () => {
    const sql = leer('supabase/migrations/20261208100000_fichaje_solo_activos.sql')
      .replace(/--.*$/gm, '')
    expect(sql).not.toMatch(/\bupdate\s+public\.registros_asistencia\b/i)
    expect(sql).not.toMatch(/\bdelete\s+from\b/i)
    expect(sql).toMatch(/as restrictive for insert/i)
    expect(sql).toMatch(/as restrictive for update/i)
    expect(sql).toMatch(/as restrictive for delete/i)
    expect(sql).toMatch(/estado = 'activo'/)
  })
})

describe('contraseña inicial = DNI', () => {
  it('detecta el DNI con o sin puntos y espacios', () => {
    expect(passwordEsDni('30111222', '30111222')).toBe(true)
    expect(passwordEsDni('30.111.222', '30111222')).toBe(true)
    expect(passwordEsDni(' 30111222 ', '30111222')).toBe(true)
    expect(passwordEsDni('Segura123', '30111222')).toBe(false)
    expect(passwordEsDni('3011122', '30111222')).toBe(false)
    expect(passwordEsDni('', '30111222')).toBe(false)
    expect(passwordEsDni('12345', '12345')).toBe(false) // DNI inválido: no se marca
  })

  it('política por variable: apagada por defecto', () => {
    expect(politicaCambioDni(undefined)).toBe('off')
    expect(politicaCambioDni('cualquiera')).toBe('off')
    expect(politicaCambioDni('ESTRUCTURA')).toBe('estructura')
    expect(politicaCambioDni('todos')).toBe('todos')
  })

  it('estructura obligatoria; vigilador sólo con "todos" y posponible', () => {
    expect(exigenciaCambioDni('off', 'admin')).toBe('no')
    expect(exigenciaCambioDni('estructura', 'admin')).toBe('obligatorio')
    expect(exigenciaCambioDni('estructura', 'supervisor')).toBe('obligatorio')
    expect(exigenciaCambioDni('estructura', 'guardia')).toBe('no')
    expect(exigenciaCambioDni('todos', 'guardia')).toBe('sugerido')
    expect(exigenciaCambioDni('todos', 'denegado')).toBe('no')
  })

  it('la nueva contraseña no puede ser el DNI', () => {
    expect(validarNuevaPassword('30111222', '30111222', '30111222')).toBe('La contraseña no puede ser tu DNI.')
    expect(validarNuevaPassword('30.111.222', '30.111.222', '30111222')).toBe('La contraseña no puede ser tu DNI.')
    expect(validarNuevaPassword('Segura123', 'Segura123', '30111222')).toBeNull()
    expect(validarNuevaPassword('30111222', '30111222')).toBeNull() // sin DNI conocido no se compara
  })

  describe('marca de sesión', () => {
    const datos = new Map<string, string>()
    const sessionStorage = {
      getItem: (k: string) => datos.get(k) ?? null,
      setItem: (k: string, v: string) => { datos.set(k, v) },
      removeItem: (k: string) => { datos.delete(k) },
    }
    beforeEach(() => {
      datos.clear()
      vi.stubGlobal('window', { sessionStorage })
      limpiarPasswordDni()
    })
    afterEach(() => { vi.unstubAllGlobals() })

    it('sólo aplica a la MISMA sesión que entró con el DNI', () => {
      marcarPasswordDni(token('s1'))
      expect(sessionStorage.getItem(CLAVE_PASSWORD_DNI)).toBe('s1')
      expect(passwordDniPendientePara(token('s1'), 'obligatorio')).toBe(true)
      expect(passwordDniPendientePara(token('s2'), 'obligatorio')).toBe(false)
      expect(passwordDniPendientePara(token('s1'), 'no')).toBe(false)
    })

    it('"Ahora no" sólo vale para el vigilador (sugerido), no para la estructura', () => {
      marcarPasswordDni(token('s1'))
      posponerPasswordDni()
      expect(passwordDniPendientePara(token('s1'), 'sugerido')).toBe(false)
      expect(passwordDniPendientePara(token('s1'), 'obligatorio')).toBe(true)
    })

    it('al cambiarla se limpia todo', () => {
      marcarPasswordDni(token('s1'))
      limpiarPasswordDni()
      expect(passwordDniPendientePara(token('s1'), 'obligatorio')).toBe(false)
    })

    it('la contraseña nunca se guarda en el navegador', () => {
      marcarPasswordDni(token('s1'))
      const todo = JSON.stringify(Array.from(datos.entries()))
      expect(todo).not.toMatch(/30111222/)
    })
  })

  it('el login marca la sesión sin guardar la contraseña', () => {
    const login = leer('app/dashboard/Login.tsx')
    expect(login).toMatch(/passwordEsDni\(passwordLogin/)
    expect(login).toMatch(/marcarPasswordDni\(data\.session\?\.access_token\)/)
  })
})

describe('enlace de invitación', () => {
  it('type=invite abre la pantalla de crear contraseña', () => {
    expect(leerEnlaceAuth('#access_token=x&refresh_token=y&type=invite', '')).toEqual({ recuperacion: true, invitacion: true, error: null })
  })
  it('invitación vencida: error y sin sesión de recuperación', () => {
    const r = leerEnlaceAuth('#error=access_denied&error_code=otp_expired&type=invite', '')
    expect(r.recuperacion).toBe(false)
    expect(r.invitacion).toBe(false)
    expect(r.error).toMatch(/venció/)
  })
})

// ── Cliente Supabase simulado para invitarEmpleado ──────────────────────────
type Fila = Record<string, any>
function supabaseFalso(opts: {
  usuarios: Fila[]
  authUsers?: Fila[]
  inviteError?: string
  resetError?: string
}) {
  const registros: Fila[] = []
  const invitaciones: string[] = []
  const enlaces: string[] = []
  const authUsers = [...(opts.authUsers ?? [])]
  const usuarios = opts.usuarios.map(u => ({ ...u }))

  const from = (tabla: string) => {
    if (tabla === 'accesos_invitaciones') {
      return { insert: async (fila: Fila) => { registros.push(fila); return { error: null } } }
    }
    if (tabla !== 'usuarios') throw new Error(`tabla inesperada ${tabla}`)
    const filtros: Array<(u: Fila) => boolean> = []
    const q: any = {
      select: () => q,
      eq: (c: string, v: any) => { filtros.push(u => u[c] === v); return q },
      neq: (c: string, v: any) => { filtros.push(u => u[c] !== v); return q },
      limit: async () => ({ data: usuarios.filter(u => filtros.every(f => f(u))), error: null }),
      maybeSingle: async () => ({ data: usuarios.find(u => filtros.every(f => f(u))) ?? null, error: null }),
      update: (cambios: Fila) => ({
        eq: async (c: string, v: any) => {
          usuarios.filter(u => u[c] === v).forEach(u => Object.assign(u, cambios))
          return { error: null }
        },
      }),
    }
    return q
  }

  const client: any = {
    from,
    auth: {
      resetPasswordForEmail: async (email: string) => {
        if (opts.resetError) return { error: { message: opts.resetError } }
        enlaces.push(email); return { error: null }
      },
      admin: {
        listUsers: async () => ({ data: { users: authUsers }, error: null }),
        inviteUserByEmail: async (email: string) => {
          if (opts.inviteError) return { data: null, error: { message: opts.inviteError } }
          if (authUsers.some(a => a.email === email)) return { data: null, error: { message: 'A user with this email address has already been registered' } }
          const user = { id: `auth-${authUsers.length + 1}`, email }
          authUsers.push(user); invitaciones.push(email)
          return { data: { user }, error: null }
        },
      },
    },
  }
  return { client, registros, invitaciones, enlaces, usuarios, authUsers }
}

const OP = { redirectTo: 'https://app.test/dashboard', actorId: 'admin-1', origen: 'administracion' as const }
const nuevo = { id: 'u1', nombre: 'Prueba', apellido: 'Ficticio', dni: '30111222', email: 'prueba.ficticio@example.com', rol: 'guardia', estado: 'activo', auth_user_id: null }

describe('invitarEmpleado', () => {
  it('cuenta nueva: invita (sin contraseña), vincula y registra', async () => {
    const f = supabaseFalso({ usuarios: [{ ...nuevo, acceso_bloqueado: false }] })
    const r = await invitarEmpleado(f.client, nuevo, OP)
    expect(r.action).toBe('invitado')
    expect(f.invitaciones).toEqual(['prueba.ficticio@example.com'])
    expect(f.usuarios[0].auth_user_id).toBe('auth-1')
    expect(f.registros).toHaveLength(1)
    expect(f.registros[0]).toMatchObject({ usuario_id: 'u1', tipo: 'invitacion', resultado: 'enviado', enviado_por: 'admin-1' })
  })

  it('reintento después de una invitación ya enviada: no duplica la cuenta, manda enlace', async () => {
    const f = supabaseFalso({ usuarios: [{ ...nuevo, acceso_bloqueado: false }], authUsers: [{ id: 'auth-9', email: nuevo.email }] })
    const r = await invitarEmpleado(f.client, nuevo, OP)
    expect(r.action).toBe('enlace_enviado')
    expect(f.invitaciones).toHaveLength(0)
    expect(f.authUsers).toHaveLength(1)
    expect(f.usuarios[0].auth_user_id).toBe('auth-9')
  })

  it('cuenta existente vinculada: enlace para crear contraseña (no toca la actual)', async () => {
    const vinculado = { ...nuevo, auth_user_id: 'auth-5' }
    const f = supabaseFalso({ usuarios: [{ ...vinculado, acceso_bloqueado: false }] })
    const r = await invitarEmpleado(f.client, vinculado, OP)
    expect(r.action).toBe('enlace_enviado')
    expect(f.enlaces).toEqual([nuevo.email])
  })

  it('email repetido en otro empleado: no envía', async () => {
    const f = supabaseFalso({ usuarios: [{ ...nuevo, acceso_bloqueado: false }, { id: 'u2', email: nuevo.email, estado: 'activo' }] })
    const r = await invitarEmpleado(f.client, nuevo, OP)
    expect(r).toEqual({ action: 'omitido', motivo: 'omitido: ese email ya lo usa otro empleado' })
    expect(f.invitaciones).toHaveLength(0)
    expect(f.registros[0]).toMatchObject({ resultado: 'omitido' })
  })

  it('inactivo o sin email válido: no envía', async () => {
    const inactivo = { ...nuevo, estado: 'inactivo' }
    const f1 = supabaseFalso({ usuarios: [inactivo] })
    expect((await invitarEmpleado(f1.client, inactivo, OP)).action).toBe('omitido')
    const sinMail = { ...nuevo, email: 'no-es-un-mail' }
    const f2 = supabaseFalso({ usuarios: [{ ...sinMail, acceso_bloqueado: false }] })
    expect((await invitarEmpleado(f2.client, sinMail, OP)).action).toBe('omitido')
    expect(f1.invitaciones.length + f2.invitaciones.length).toBe(0)
  })

  it('falla el SMTP: queda registrado el error y no se vincula nada', async () => {
    const f = supabaseFalso({ usuarios: [{ ...nuevo, acceso_bloqueado: false }], inviteError: 'Error sending invite email' })
    const r = await invitarEmpleado(f.client, nuevo, OP)
    expect(r.action).toBe('error')
    expect(f.usuarios[0].auth_user_id).toBeNull()
    expect(f.registros[0]).toMatchObject({ tipo: 'invitacion', resultado: 'error' })
  })
})

describe('interruptor ACCESO_POR_INVITACION', () => {
  const original = process.env.NEXT_PUBLIC_SITE_URL
  afterEach(() => { process.env.NEXT_PUBLIC_SITE_URL = original })

  it('apagado salvo "1"', () => {
    expect(accesoPorInvitacion(undefined)).toBe(false)
    expect(accesoPorInvitacion('true')).toBe(false)
    expect(accesoPorInvitacion('1')).toBe(true)
  })

  it('las rutas respetan el interruptor', () => {
    expect(leer('app/api/acceso/invitar/route.ts')).toMatch(/if \(!accesoPorInvitacion\(\)\)[\s\S]*status: 409/)
    expect(leer('app/api/reset-user-password/route.ts')).toMatch(/if \(accesoPorInvitacion\(\)\)[\s\S]*status: 409/)
    const crear = leer('app/api/create-user/route.ts')
    expect(crear).toMatch(/if \(accesoPorInvitacion\(\)\) \{\s*if \(!pleno\)/)
  })

  it('con el interruptor, ninguna cuenta nueva recibe el DNI como contraseña', () => {
    expect(leer('app/api/_lib/employee-auth.ts')).toMatch(/const conPassword = !options\.conservarPassword && !accesoPorInvitacion\(\)/)
    expect(leer('app/api/_lib/employee-auth.ts')).toMatch(/createUser\(authPayload\(usuario, email, dni, conPassword\)\)/)
    expect(leer('app/api/_lib/auth-repair.ts')).toMatch(/createUser\(authPayload\(usuario, email, dni, !accesoPorInvitacion\(\)\)\)/)
  })

  it('la URL de retorno usa el dominio configurado', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.mercosur.test/'
    expect(urlRetornoAcceso('http://otro')).toBe('https://app.mercosur.test/dashboard')
  })
})

vi.restoreAllMocks()
