import { describe, expect, it } from 'vitest'
import { tieneCapacidad, alcanceDe, shellDeUsuario, esAdminPleno, puestoDe } from '@/lib/capacidades'

// Override individual acceso_admin_pleno (JC 20/09): Sergio conserva su puesto
// jefe_supervisores (alcance/clasificación intactos) y SUMA el acceso admin pleno.

const SERGIO_SIN_FLAG = { rol: 'admin', puesto_organizacional: 'jefe_supervisores', acceso_interfaz_admin: true }
const SERGIO_CON_FLAG = { rol: 'admin', puesto_organizacional: 'jefe_supervisores', acceso_interfaz_admin: true, acceso_admin_pleno: true }

const ADMIN = [
  'configurar_sistema', 'gestionar_personal', 'gestionar_objetivos', 'preparar_liquidacion',
  'ver_dashboard_gerencial', 'ver_liquidacion', 'editar_liquidacion', 'exportar_visual',
  'exportar_banco', 'ver_finanzas', 'gestionar_facturacion', 'configurar_economico',
  'gestionar_usuarios_roles',
] as const

describe('Sergio SIN flag (estado actual): jefe_supervisores acotado', () => {
  it('no es admin pleno ni tiene personal/liquidación/económico', () => {
    expect(esAdminPleno(SERGIO_SIN_FLAG)).toBe(false)
    expect(tieneCapacidad(SERGIO_SIN_FLAG, 'gestionar_personal')).toBe(false)
    expect(tieneCapacidad(SERGIO_SIN_FLAG, 'preparar_liquidacion')).toBe(false)
    expect(tieneCapacidad(SERGIO_SIN_FLAG, 'ver_finanzas')).toBe(false)
  })
})

describe('Sergio CON flag: acceso admin pleno, conservando el puesto', () => {
  it('CONSERVA puesto jefe_supervisores y alcance todas (clasificación intacta)', () => {
    expect(puestoDe(SERGIO_CON_FLAG)).toBe('jefe_supervisores')
    expect(alcanceDe(SERGIO_CON_FLAG)).toBe('todas')
    expect(shellDeUsuario(SERGIO_CON_FLAG)).toBe('admin')
  })
  it('gana admin pleno: todas las capacidades administrativas/económicas', () => {
    expect(esAdminPleno(SERGIO_CON_FLAG)).toBe(true)
    for (const cap of ADMIN) {
      expect(tieneCapacidad(SERGIO_CON_FLAG, cap as any), `debería tener ${cap}`).toBe(true)
    }
  })
  it('conserva lo operativo del puesto', () => {
    expect(tieneCapacidad(SERGIO_CON_FLAG, 'gestionar_turnos')).toBe(true)
    expect(tieneCapacidad(SERGIO_CON_FLAG, 'gestionar_personal_operativo')).toBe(true)
    expect(tieneCapacidad(SERGIO_CON_FLAG, 'supervisar_todas_zonas')).toBe(true)
  })
})

describe('El override NO afecta a quien no lo tiene', () => {
  it('otro jefe_supervisores SIN flag (Aldo) sigue acotado', () => {
    const aldo = { rol: 'supervisor', puesto_organizacional: 'jefe_supervisores' }
    expect(esAdminPleno(aldo)).toBe(false)
    expect(tieneCapacidad(aldo, 'gestionar_personal')).toBe(false)
    expect(tieneCapacidad(aldo, 'ver_finanzas')).toBe(false)
  })
  it('administración SIN flag no gana económico ni roles', () => {
    const admin = { rol: 'admin', puesto_organizacional: 'administracion' }
    expect(tieneCapacidad(admin, 'ver_finanzas')).toBe(false)
    expect(tieneCapacidad(admin, 'gestionar_usuarios_roles')).toBe(false)
  })
})
