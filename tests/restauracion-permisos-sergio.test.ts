import { describe, expect, it } from 'vitest'
import { tieneCapacidad, alcanceDe, shellDeUsuario, esAdminPleno } from '@/lib/capacidades'

// Restauración del acceso admin pleno de Sergio Martinez (JC 20/09).
// El fix es de DATOS (puesto_organizacional = null); acá se verifica que la
// lógica de capacidades (que gobierna pantallas y APIs) devuelve el acceso
// completo con puesto=null + rol=admin, y que NO se toca a los demás.

const SERGIO_ANTES = { rol: 'admin', puesto_organizacional: 'jefe_supervisores', acceso_interfaz_admin: true }
const SERGIO_DESPUES = { rol: 'admin', puesto_organizacional: null, acceso_interfaz_admin: true }

// Capacidades que Sergio había perdido y debe recuperar.
const RECUPERA = [
  'configurar_sistema', 'gestionar_personal', 'gestionar_objetivos', 'preparar_liquidacion',
  'ver_dashboard_gerencial', 'ver_liquidacion', 'editar_liquidacion', 'exportar_visual',
  'exportar_banco', 'ver_finanzas', 'gestionar_facturacion', 'configurar_economico',
  'gestionar_usuarios_roles',
] as const

describe('Sergio ANTES (puesto=jefe_supervisores): regresión — pierde admin pleno', () => {
  it('no es admin pleno y no tiene personal/liquidación/económico', () => {
    expect(esAdminPleno(SERGIO_ANTES)).toBe(false)
    expect(tieneCapacidad(SERGIO_ANTES, 'gestionar_personal')).toBe(false)
    expect(tieneCapacidad(SERGIO_ANTES, 'preparar_liquidacion')).toBe(false)
    expect(tieneCapacidad(SERGIO_ANTES, 'ver_finanzas')).toBe(false)
    expect(tieneCapacidad(SERGIO_ANTES, 'gestionar_usuarios_roles')).toBe(false)
  })
  it('conserva shell admin (por acceso_interfaz_admin) y alcance todas', () => {
    expect(shellDeUsuario(SERGIO_ANTES)).toBe('admin')
    expect(alcanceDe(SERGIO_ANTES)).toBe('todas')
  })
})

describe('Sergio DESPUÉS (puesto=null + rol=admin): acceso pleno restaurado', () => {
  it('es admin pleno, shell admin, alcance todas', () => {
    expect(esAdminPleno(SERGIO_DESPUES)).toBe(true)
    expect(shellDeUsuario(SERGIO_DESPUES)).toBe('admin')
    expect(alcanceDe(SERGIO_DESPUES)).toBe('todas')
  })
  it('recupera TODAS las capacidades administrativas/económicas', () => {
    for (const cap of RECUPERA) {
      expect(tieneCapacidad(SERGIO_DESPUES, cap as any), `debería tener ${cap}`).toBe(true)
    }
  })
  it('conserva lo operativo (turnos/objetivos)', () => {
    expect(tieneCapacidad(SERGIO_DESPUES, 'gestionar_turnos')).toBe(true)
    expect(tieneCapacidad(SERGIO_DESPUES, 'gestionar_objetivos')).toBe(true)
  })
})

describe('El fix NO afecta a otros (es de datos, capacidades.ts sin cambios)', () => {
  it('administración (rol=admin, puesto=administracion) NO gana económico ni roles', () => {
    const admin = { rol: 'admin', puesto_organizacional: 'administracion' }
    expect(tieneCapacidad(admin, 'ver_finanzas')).toBe(false)
    expect(tieneCapacidad(admin, 'gestionar_usuarios_roles')).toBe(false)
    // lo suyo se mantiene
    expect(tieneCapacidad(admin, 'gestionar_personal')).toBe(true)
    expect(tieneCapacidad(admin, 'configurar_sistema')).toBe(true)
  })
  it('dirección operativa (rol=admin, puesto=direccion_operativa) NO gana económico', () => {
    const dirop = { rol: 'admin', puesto_organizacional: 'direccion_operativa' }
    expect(tieneCapacidad(dirop, 'ver_finanzas')).toBe(false)
    expect(tieneCapacidad(dirop, 'gestionar_personal')).toBe(false)
  })
})
