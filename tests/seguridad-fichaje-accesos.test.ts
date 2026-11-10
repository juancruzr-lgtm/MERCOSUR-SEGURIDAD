/**
 * Seguridad (auditoría alta de vigiladores 06/11/2026):
 *  - fichaje sólo para empleados activos (migración 20261208100000 + /api/upload-evidence)
 *  - contraseña inicial = DNI con cambio obligatorio (migración 20261208100100):
 *    lo decide la base, no se guarda la contraseña, no frena fichajes.
 * Las reglas SQL se prueban con PGlite en scripts/sql-pruebas/pr1-fichaje-accesos.mjs.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { puedeFichar } from '@/lib/fichaje-habilitado'
import { validarNuevaPassword } from '@/lib/auth-mensajes'
import { marcarCambioObligatorio } from '@/app/api/_lib/acceso-password'

const leer = (ruta: string) => readFileSync(join(__dirname, '..', ruta), 'utf8')
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

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
    const sql = leer('supabase/migrations/20261208100000_fichaje_solo_activos.sql').replace(/--.*$/gm, '')
    expect(sql).not.toMatch(/\bupdate\s+public\.registros_asistencia\b/i)
    expect(sql).not.toMatch(/\bdelete\s+from\b/i)
    expect(sql).toMatch(/as restrictive for insert/i)
    expect(sql).toMatch(/as restrictive for update/i)
    expect(sql).toMatch(/as restrictive for delete/i)
    expect(sql).toMatch(/estado = 'activo'/)
  })
})

describe('contraseña inicial = DNI con cambio obligatorio', () => {
  it('la nueva contraseña no puede ser el DNI', () => {
    expect(validarNuevaPassword('30111222', '30111222', '30111222')).toBe('La contraseña no puede ser tu DNI.')
    expect(validarNuevaPassword('30.111.222', '30.111.222', '30111222')).toBe('La contraseña no puede ser tu DNI.')
    expect(validarNuevaPassword('Segura123', 'Segura123', '30111222')).toBeNull()
  })

  it('la migración no guarda contraseñas: sólo marca y eventos', () => {
    const sql = leer('supabase/migrations/20261208100100_accesos_password.sql').replace(/--.*$/gm, '')
    const tablas = sql.slice(sql.indexOf('create table if not exists public.accesos_password ('), sql.indexOf('create index'))
    expect(tablas).not.toMatch(/password\s+text|hash|encrypted/i)
    // El hash de Auth se usa sólo dentro de la comparación y nunca se devuelve.
    expect(sql).toMatch(/extensions\.crypt\(v_dni, v_hash\) = v_hash/)
    expect(sql).toMatch(/revoke all on function public\.acceso_password_es_dni\(uuid\) from public, anon, authenticated/)
  })

  it('el cambio se registra sólo si la base confirma que ya no es el DNI', () => {
    const sql = leer('supabase/migrations/20261208100100_accesos_password.sql')
    const f = sql.slice(sql.indexOf('function public.mi_acceso_registrar_cambio'), sql.indexOf('function public.accesos_marcar_cambio_obligatorio'))
    expect(f.indexOf('acceso_password_es_dni(v_id)')).toBeLessThan(f.indexOf("'cambio_realizado'"))
    expect(f).toMatch(/La contraseña sigue siendo el DNI/)
  })

  describe('marcarCambioObligatorio (servidor)', () => {
    let filas: Record<string, any[]>
    const admin = (falla?: string) => ({
      from: (t: string) => ({
        upsert: async (f: any) => { if (falla === t) return { error: { message: 'x' } }; (filas[t] ??= []).push(f); return { error: null } },
        insert: async (f: any) => { if (falla === t) return { error: { message: 'x' } }; (filas[t] ??= []).push(f); return { error: null } },
      }),
    }) as any
    beforeEach(() => { filas = {} })

    it('alta: marca obligatorio y registra "alta_con_dni" con el responsable', async () => {
      const r = await marcarCambioObligatorio(admin(), 'u1', 'alta', 'admin-1')
      expect(r.ok).toBe(true)
      expect(filas.accesos_password[0]).toMatchObject({ usuario_id: 'u1', cambio_obligatorio: true, motivo: 'alta', marcado_por: 'admin-1' })
      expect(filas.accesos_password_eventos[0]).toEqual({ usuario_id: 'u1', evento: 'alta_con_dni', actor: 'admin-1' })
    })
    it('restablecida: evento "restablecida_a_dni"', async () => {
      await marcarCambioObligatorio(admin(), 'u1', 'restablecida', 'admin-1')
      expect(filas.accesos_password_eventos[0].evento).toBe('restablecida_a_dni')
    })
    it('si no se puede marcar, se informa (no se oculta)', async () => {
      const r = await marcarCambioObligatorio(admin('accesos_password'), 'u1', 'alta', null)
      expect(r.ok).toBe(false)
    })
    it('nunca recibe ni guarda la contraseña', () => {
      expect(sinComentarios(leer('app/api/_lib/acceso-password.ts'))).not.toMatch(/\bpassword\s*:|\bdni\s*:/)
    })
  })

  it('las rutas que dejan el DNI como contraseña marcan el cambio obligatorio', () => {
    const crear = sinComentarios(leer('app/api/create-user/route.ts'))
    expect(crear).toMatch(/action === 'creado' \|\| resultado\.action === 'recreado'[\s\S]*marcarCambioObligatorio\(admin\.client, usuario\.id, 'alta'/)
    const reset = sinComentarios(leer('app/api/reset-user-password/route.ts'))
    expect(reset).toMatch(/resetearPassword: true/)
    expect(reset.indexOf('repairEmployeeAuthUser')).toBeLessThan(reset.indexOf("marcarCambioObligatorio(admin.client, usuario.id, 'restablecida'"))
    expect(reset).toMatch(/tieneCapacidad\(acceso\.perfil, 'gestionar_personal'\)/)
    expect(sinComentarios(leer('app/api/sync-employee-auth/route.ts'))).toMatch(/marcarCambioObligatorio\(admin\.client, usuario\.id, 'alta'/)
    expect(sinComentarios(leer('app/api/admin/repair-auth-users/route.ts'))).toMatch(/marcarCambioObligatorio\(admin\.client, r\.usuario_id, 'alta'/)
  })

  it('el vigilador cambia la contraseña sin que se frene ningún fichaje', () => {
    const g = sinComentarios(leer('components/guardia/GuardiaMobile.tsx'))
    expect(g).toMatch(/consultarCambioPassword\(\)\.then\(p => \{ if \(vivo && p\?\.obligatorio\) setPassModalAbierto\(true\) \}\)/)
    expect(g).toMatch(/passModalAbierto && !passPausado && !telModalAbierto && ingresoFase === 'idle' && fichando === null/)
    expect(g).toMatch(/textoCancelar="Primero tengo que fichar"/)
    // Al terminar el fichaje, el aviso vuelve.
    expect(g).toMatch(/if \(fichajeEnCursoRef\.current && !enCurso\) setPassPausado\(false\)/)
  })

  it('la estructura lo hace antes de entrar al panel; si la consulta falla no se bloquea', () => {
    const s = sinComentarios(leer('app/dashboard/AppShell.tsx'))
    expect(s).toMatch(/if \(shellDeUsuario\(perfil\) !== 'guardia'\) \{\s*const p = await consultarCambioPassword\(\)\s*if \(p\?\.obligatorio\)/)
    const lib = sinComentarios(leer('lib/acceso-password-dni.ts'))
    expect(lib).toMatch(/if \(error \|\| !data \|\| typeof data !== 'object'\) return null/)
    expect(lib).toMatch(/catch \{\s*return null/)
  })

  it('NuevaPassword registra el cambio en la base después de cambiarla', () => {
    const n = sinComentarios(leer('components/auth/NuevaPassword.tsx'))
    expect(n.indexOf('supabase.auth.updateUser')).toBeLessThan(n.indexOf('registrarCambioPassword()'))
  })

  it('ya no hay invitaciones por email ni interruptores de acceso', () => {
    const todo = ['app/api/create-user/route.ts', 'app/api/reset-user-password/route.ts', 'app/dashboard/AppClient.tsx', 'app/dashboard/AppShell.tsx'].map(leer).join('\n')
    expect(todo).not.toMatch(/ACCESO_POR_INVITACION|inviteUserByEmail|NEXT_PUBLIC_CAMBIO_PASSWORD_DNI/)
    expect(leer('app/dashboard/AppClient.tsx')).toMatch(/'Restablecer contraseña'/)
  })
})

vi.restoreAllMocks()
