import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { idSesionPunto, registraGpsEnVistaAdmin } from '@/lib/supervisor-gps'

// Corrección C (JC 19/10): Sergio registra su recorrido GPS durante sus
// guardias, igual que los demás supervisores, aunque tenga rol admin y use la
// vista de Administración.

const leer = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8')
const APP = leer('app', 'dashboard', 'AppClient.tsx')
const MOBILE = leer('components', 'supervisor', 'SupervisorMobile.tsx')
const RASTREO = leer('components', 'supervisor', 'RastreoGpsVistaAdmin.tsx')
const MIG = leer('supabase', 'migrations', '20261103120000_gps_registro_por_puesto_supervisor.sql')
const VERIF = leer('supabase', 'verificacion', 'gps_registro_por_puesto_supervisor_post_migracion.sql')

describe('quién registra GPS desde la vista de Administración', () => {
  it('Sergio (jefe de supervisores, rol admin, vista admin): sí', () => {
    expect(registraGpsEnVistaAdmin({ puesto_organizacional: 'jefe_supervisores' })).toBe(true)
  })
  it('Gerencia, Dirección y Administración: no (no son supervisores)', () => {
    for (const p of ['gerencia', 'direccion_operativa', 'administracion']) {
      expect(registraGpsEnVistaAdmin({ puesto_organizacional: p })).toBe(false)
    }
    expect(registraGpsEnVistaAdmin(null)).toBe(false)
  })
})

describe('session_id del punto (columna obligatoria)', () => {
  it('con sesión de telemetría (SupervisorMobile, todos los supervisores) se usa esa: sin cambios', () => {
    const r = { current: null as string | null }
    expect(idSesionPunto('tel-123', r)).toBe('tel-123')
    expect(r.current).toBeNull()
  })
  it('sin telemetría (vista de Administración) usa un id propio, estable dentro del recorrido', () => {
    const r = { current: null as string | null }
    const a = idSesionPunto(null, r)
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    expect(idSesionPunto(undefined, r)).toBe(a)
    r.current = null // nuevo recorrido
    expect(idSesionPunto(null, r)).not.toBe(a)
  })
})

describe('cableado: un solo GPS a la vez, el mismo para todos', () => {
  it('la vista de Administración monta el rastreo sólo para supervisores', () => {
    expect(APP).toContain("{shellApp === 'admin' && user?.id && registraGpsEnVistaAdmin(user) && <RastreoGpsVistaAdmin userId={user.id} />}")
  })
  it('la vista Supervisor (SupervisorMobile) no monta el rastreo de Administración: no se duplica', () => {
    const i = APP.indexOf("if (shellApp === 'admin' && adminMobileView === 'supervisor') {")
    const bloque = APP.slice(i, APP.indexOf('\n}', i))
    expect(bloque).toContain('<SupervisorMobile user={user} />')
    expect(bloque).not.toContain('RastreoGpsVistaAdmin')
  })
  it('es el mismo hook que usan los demás supervisores, sin cambios en SupervisorMobile', () => {
    expect(RASTREO).toContain('useSupervisorGps(userId, guardias, objetivos)')
    expect(MOBILE).toMatch(/useSupervisorGps\(\s*user\?\.id \?\? '',\s*supervisoresGuardia,\s*objetivos\s*\)/)
  })
  it('lee sólo SUS guardias (para vincular cada punto a su turno)', () => {
    expect(RASTREO).toContain(".eq('supervisor_id', userId)")
  })
})

describe('la migración', () => {
  const sentencia = MIG.slice(MIG.indexOf('begin;'), MIG.indexOf('commit;'))
  it('recrea la MISMA política de INSERT: punto propio y (rol supervisor o puesto supervisor/jefe)', () => {
    expect(sentencia).toContain('create policy "Supervisor inserta sus propios puntos GPS"')
    expect(sentencia).toContain('usuarios.id           = supervisor_route_points.supervisor_id')
    expect(sentencia).toMatch(/usuarios\.rol = 'supervisor'\s*or usuarios\.puesto_organizacional in \('supervisor', 'jefe_supervisores'\)/)
  })
  it('no toca lecturas, grants ni otras tablas', () => {
    expect(sentencia).not.toMatch(/lee todos|lee sus propios|\bgrant\b|\brevoke\b|for select/i)
    expect(sentencia.match(/on public\.\w+/g)).toEqual(['on public.supervisor_route_points', 'on public.supervisor_route_points'])
  })
  it('la verificación espera que se sume sólo Sergio y que nadie pierda el permiso', () => {
    expect(VERIF).toContain("'Se suma sólo Sergio Martínez', '69493cc2-15d6-4618-893e-4a9b1d044df8'")
    expect(VERIF).toContain("'Nadie pierde el permiso de registrar', '0'")
  })
})
