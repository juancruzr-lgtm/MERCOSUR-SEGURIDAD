// Regresión: un error al leer el perfil NO cierra la sesión (06/11/2026).
// Antes: cualquier error (red, 500, 42501) → supabase.auth.signOut() GLOBAL → la
// persona quedaba afuera en todos sus dispositivos. Ahora sólo una sesión
// realmente inválida (local) o una baja (global) cierran la sesión, y sin perfil
// verificado tampoco se entra a la app.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  authRechazaSesion, bajaConfirmada, cierreDeSesionPara, clasificarErrorConsulta,
  perfilTrasIngreso, verificarSesion, type ResultadoSesion,
} from '@/lib/sesion-perfil'

type Resp = { data?: any; error?: any; status?: number; lanza?: boolean }
const PERFIL = { id: 'u1', nombre: 'Ana', rol: 'guardia', auth_user_id: 'a1' }

function cliente(op: {
  sesion?: { user: { id: string } } | null
  errorSesion?: any
  acceso?: Resp
  perfiles?: Resp[]
  porEmail?: Resp
  user?: Resp
} = {}) {
  const llamadas = { rpc: [] as any[], lecturas: [] as string[], updates: [] as any[], getUser: 0 }
  const perfiles = [...(op.perfiles ?? [{ data: PERFIL }])]
  const responder = (r: Resp | undefined) => {
    if (r?.lanza) throw new Error('TypeError: Failed to fetch')
    return { data: r?.data ?? null, error: r?.error ?? null, status: r?.status ?? (r?.error ? 400 : 200) }
  }
  const cli = {
    auth: {
      getSession: async () => ({ data: { session: op.sesion === undefined ? { user: { id: 'a1' } } : op.sesion }, error: op.errorSesion ?? null }),
      getUser: async () => { llamadas.getUser++; const r = op.user ?? { data: { user: { id: 'a1' } } }; return { data: r.data ?? { user: null }, error: r.error ?? null } },
    },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      llamadas.rpc.push({ fn, args })
      const r = op.acceso ?? { data: { bloqueado: false } }
      return { data: r.data ?? null, error: r.error ?? null }
    },
    from: (tabla: string) => {
      expect(tabla).toBe('usuarios')
      let campo = ''
      const q: any = {
        select: () => q,
        eq: (c: string) => { campo = c; return q },
        maybeSingle: async () => {
          llamadas.lecturas.push(campo)
          if (campo === 'email') return responder(op.porEmail ?? { data: null })
          return responder(perfiles.length > 1 ? perfiles.shift() : perfiles[0])
        },
        update: (v: any) => ({ eq: async (c: string, id: string) => { llamadas.updates.push({ v, c, id }); return { error: null } } }),
      }
      return q
    },
  }
  return { cli, llamadas }
}

const COLS = 'id, nombre'
const RED = { error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 }

describe('arranque: verificarSesion', () => {
  it('sin sesión guardada → login, sin leer el perfil', async () => {
    const { cli, llamadas } = cliente({ sesion: null })
    expect(await verificarSesion(cli, COLS)).toEqual({ estado: 'sin_sesion' })
    expect(llamadas.lecturas).toEqual([])
  })

  it('token vencido y SIN RED para renovarlo: no es "sin sesión" (supabase-js la conserva) → sin verificar, sin cierre', async () => {
    const { cli } = cliente({ sesion: null, errorSesion: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } })
    const r = await verificarSesion(cli, COLS)
    expect(r.estado).toBe('sin_verificar')
    expect(cierreDeSesionPara(r)).toBeNull()
  })

  it('refresh token rechazado por Auth → sesión inválida, cierre SÓLO local', async () => {
    const { cli } = cliente({ sesion: null, errorSesion: { name: 'AuthApiError', status: 400, message: 'Invalid Refresh Token' } })
    const r = await verificarSesion(cli, COLS)
    expect(r.estado).toBe('sesion_invalida')
    expect(cierreDeSesionPara(r)).toBe('local')
  })

  it('perfil OK → entra', async () => {
    const { cli } = cliente()
    expect(await verificarSesion(cli, COLS)).toEqual({ estado: 'ok', perfil: PERFIL })
  })

  it('la consulta funcionó y NO hay perfil → sin_perfil, cierre local (no global)', async () => {
    const { cli } = cliente({ perfiles: [{ data: null }] })
    const r = await verificarSesion(cli, COLS)
    expect(r.estado).toBe('sin_perfil')
    expect(cierreDeSesionPara(r)).toBe('local')
  })

  for (const [caso, resp] of [
    ['sin señal (fetch falla)', RED],
    ['error 500 del servidor', { error: { message: 'Internal Server Error', code: '' }, status: 500 }],
    ['timeout de la base (57014)', { error: { message: 'canceling statement due to statement timeout', code: '57014' }, status: 500 }],
    ['permiso denegado 42501 (p. ej. cambio de permisos en curso)', { error: { message: 'permission denied for table usuarios', code: '42501' }, status: 403 }],
    ['error de esquema de PostgREST', { error: { message: 'Could not find the table', code: 'PGRST205' }, status: 404 }],
  ] as const) {
    it(`${caso} → sin verificar: NI cierra la sesión NI deja entrar`, async () => {
      const { cli, llamadas } = cliente({ perfiles: [resp as Resp] })
      const r = await verificarSesion(cli, COLS)
      expect(r.estado).toBe('sin_verificar')
      expect(cierreDeSesionPara(r)).toBeNull()
      expect('perfil' in r).toBe(false)
      expect(llamadas.getUser).toBe(0) // un error de red o permisos no es un problema de token
    })
  }

  it('la lectura LANZA una excepción → sin verificar', async () => {
    const { cli } = cliente({ perfiles: [{ lanza: true }] })
    expect((await verificarSesion(cli, COLS)).estado).toBe('sin_verificar')
  })

  it('401 (token vencido) + Auth confirma la sesión → reintenta UNA vez y entra', async () => {
    const { cli, llamadas } = cliente({ perfiles: [{ error: { message: 'JWT expired', code: 'PGRST301' }, status: 401 }, { data: PERFIL }] })
    expect(await verificarSesion(cli, COLS)).toEqual({ estado: 'ok', perfil: PERFIL })
    expect(llamadas.getUser).toBe(1)
    expect(llamadas.lecturas).toEqual(['auth_user_id', 'auth_user_id'])
  })

  it('401 + Auth rechaza la sesión (usuario borrado / sesión revocada) → sesión inválida, cierre local', async () => {
    const { cli } = cliente({ perfiles: [{ error: { message: 'JWT expired', code: 'PGRST301' }, status: 401 }], user: { error: { name: 'AuthApiError', status: 403, message: 'session_not_found' } } })
    const r = await verificarSesion(cli, COLS)
    expect(r.estado).toBe('sesion_invalida')
    expect(cierreDeSesionPara(r)).toBe('local')
  })

  it('401 + Auth no responde (sin red) → sin verificar, sin cierre', async () => {
    const { cli } = cliente({ perfiles: [{ error: { message: 'JWT expired', code: 'PGRST301' }, status: 401 }], user: { error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } } })
    const r = await verificarSesion(cli, COLS)
    expect(r.estado).toBe('sin_verificar')
    expect(cierreDeSesionPara(r)).toBeNull()
  })

  it('401 que persiste después de validar con Auth → sin verificar (sin bucles: un solo getUser y un solo reintento)', async () => {
    const t401 = { error: { message: 'JWT expired', code: 'PGRST301' }, status: 401 }
    const { cli, llamadas } = cliente({ perfiles: [t401, t401, t401] })
    expect((await verificarSesion(cli, COLS)).estado).toBe('sin_verificar')
    expect(llamadas.getUser).toBe(1)
    expect(llamadas.lecturas).toHaveLength(2)
  })

  it('baja laboral confirmada → bloqueado, cierre GLOBAL (decisión de seguridad), sin leer el perfil', async () => {
    const { cli, llamadas } = cliente({ acceso: { data: { bloqueado: true } } })
    const r = await verificarSesion(cli, COLS)
    expect(r.estado).toBe('bloqueado')
    expect(cierreDeSesionPara(r)).toBe('global')
    expect(llamadas.lecturas).toEqual([])
  })
})

describe('control de baja: bajaConfirmada', () => {
  it('consulta mi_acceso_estado una sola vez', async () => {
    const { cli, llamadas } = cliente()
    expect(await bajaConfirmada(cli)).toBe(false)
    expect(llamadas.rpc).toEqual([{ fn: 'mi_acceso_estado', args: undefined }])
  })
  it('ante un error no afirma una baja que no verificó (la base igual bloquea por RLS)', async () => {
    const { cli } = cliente({ acceso: { error: { code: '57014', message: 'timeout' } } })
    expect(await bajaConfirmada(cli)).toBe(false)
  })
})

describe('ingreso: perfilTrasIngreso', () => {
  const user = { id: 'a1', email: 'Ana@X.com ' }
  it('perfil OK', async () => {
    const { cli } = cliente()
    expect(await perfilTrasIngreso(cli, user, COLS)).toEqual({ estado: 'ok', perfil: PERFIL })
  })
  it('error de conexión → sin verificar; NO busca por email ni escribe el vínculo', async () => {
    const { cli, llamadas } = cliente({ perfiles: [RED as Resp] })
    expect((await perfilTrasIngreso(cli, user, COLS)).estado).toBe('sin_verificar')
    expect(llamadas.lecturas).toEqual(['auth_user_id'])
    expect(llamadas.updates).toEqual([])
  })
  it('sin fila por auth_user_id + perfil por email → vincula y entra', async () => {
    const { cli, llamadas } = cliente({ perfiles: [{ data: null }], porEmail: { data: { ...PERFIL, id: 'u9' } } })
    const r = await perfilTrasIngreso(cli, user, COLS)
    expect(r.estado).toBe('ok')
    expect(llamadas.updates).toEqual([{ v: { auth_user_id: 'a1' }, c: 'id', id: 'u9' }])
  })
  it('sin fila + error al buscar por email → sin verificar, sin escribir', async () => {
    const { cli, llamadas } = cliente({ perfiles: [{ data: null }], porEmail: RED as Resp })
    expect((await perfilTrasIngreso(cli, user, COLS)).estado).toBe('sin_verificar')
    expect(llamadas.updates).toEqual([])
  })
  it('sin fila por ningún lado → sin perfil', async () => {
    const { cli } = cliente({ perfiles: [{ data: null }], porEmail: { data: null } })
    expect((await perfilTrasIngreso(cli, user, COLS)).estado).toBe('sin_perfil')
  })
  it('baja → bloqueado', async () => {
    const { cli } = cliente({ acceso: { data: { bloqueado: true } } })
    expect((await perfilTrasIngreso(cli, user, COLS)).estado).toBe('bloqueado')
  })
})

describe('clasificación', () => {
  it('cierre por resultado: sólo baja (global) y sesión inválida / sin perfil (local)', () => {
    const tabla = (['ok', 'sin_sesion', 'bloqueado', 'sin_perfil', 'sesion_invalida', 'sin_verificar'] as ResultadoSesion['estado'][])
      .map(e => [e, cierreDeSesionPara({ estado: e })])
    expect(tabla).toEqual([['ok', null], ['sin_sesion', null], ['bloqueado', 'global'], ['sin_perfil', 'local'], ['sesion_invalida', 'local'], ['sin_verificar', null]])
  })
  it('errores de consulta', () => {
    expect(clasificarErrorConsulta({ code: 'PGRST301', message: 'JWT expired' })).toBe('token')
    expect(clasificarErrorConsulta({ code: '', message: 'x' }, 401)).toBe('token')
    expect(clasificarErrorConsulta({ code: '42501', message: 'permission denied' }, 403)).toBe('transitorio')
    expect(clasificarErrorConsulta({ code: '', message: 'TypeError: Failed to fetch' }, 0)).toBe('transitorio')
    expect(clasificarErrorConsulta({ code: '57014', message: 'timeout' }, 500)).toBe('transitorio')
  })
  it('errores de Auth', () => {
    expect(authRechazaSesion({ name: 'AuthApiError', status: 403 })).toBe(true)
    expect(authRechazaSesion({ name: 'AuthApiError', status: 401 })).toBe(true)
    expect(authRechazaSesion({ name: 'AuthSessionMissingError', status: 400 })).toBe(true)
    expect(authRechazaSesion({ name: 'AuthRetryableFetchError', status: 0 })).toBe(false)
    expect(authRechazaSesion({ name: 'AuthApiError', status: 500 })).toBe(false)
    expect(authRechazaSesion(null)).toBe(false)
  })
})

describe('el código de la app usa la verificación nueva', () => {
  const RAIZ = join(__dirname, '..')
  const login = readFileSync(join(RAIZ, 'app/dashboard/Login.tsx'), 'utf8')
  const shell = readFileSync(join(RAIZ, 'app/dashboard/AppShell.tsx'), 'utf8')
  it('en el arranque y el ingreso todo signOut lleva scope explícito (ninguno global por defecto)', () => {
    for (const src of [login, shell]) {
      const llamadas = src.match(/auth\.signOut\([^)]*\)/g) ?? []
      expect(llamadas.length).toBeGreaterThan(0)
      for (const l of llamadas) expect(l).toMatch(/scope/)
    }
  })
  it('perfilDeSesionActual ya no cierra la sesión por su cuenta ni usa .single()', () => {
    const cuerpo = login.slice(login.indexOf('export async function perfilDeSesionActual'), login.indexOf('export default function Login'))
    expect(cuerpo).toMatch(/verificarSesion\(/)
    expect(cuerpo).not.toMatch(/auth\.signOut\(/)
    expect(login).not.toMatch(/\.single\(\)/)
  })
  it('AppShell verifica la versión antes de consultar y muestra "sin verificar" en vez del login', () => {
    expect(shell).toMatch(/recargarSiHayVersionNueva\(\)/)
    expect(shell.indexOf('recargarSiHayVersionNueva()')).toBeLessThan(shell.indexOf('verificarSesion('))
    expect(shell).toMatch(/fase: 'sinVerificar'/)
    expect(shell).not.toMatch(/perfilDeSesionActual/)
  })
})
