import { describe, expect, it } from 'vitest'
import { tieneCapacidad, alcanceDe, shellDeUsuario, esAdminPleno, puestoDe } from '@/lib/capacidades'

// Override individual acceso_admin_pleno (JC 20/09): Sergio conserva su puesto
// jefe_supervisores (alcance/clasificación intactos) y SUMA el acceso admin pleno.

const SERGIO_SIN_FLAG = { rol: 'admin', puesto_organizacional: 'jefe_supervisores', acceso_interfaz_admin: true }
const SERGIO_CON_FLAG = { rol: 'admin', puesto_organizacional: 'jefe_supervisores', acceso_interfaz_admin: true, acceso_admin_pleno: true }

// Lo que el override SÍ da tras el recorte de Fase 2D (JC 21/09): roles, config y
// operación. YA NO da económico/gerencial (eso queda para Gerencia real o delegación).
const ADMIN = [
  'configurar_sistema', 'gestionar_personal', 'gestionar_objetivos', 'gestionar_usuarios_roles',
] as const
// Lo que el override NO da: liquidaciones + económico/gerencial sensible.
const LIQUIDACION = [
  'preparar_liquidacion', 'ver_liquidacion', 'editar_liquidacion', 'exportar_visual', 'exportar_banco',
  'ver_dashboard_gerencial', 'ver_finanzas', 'gestionar_facturacion', 'configurar_economico',
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
  it('gana roles/config/operación pero NO liquidación NI económico (recorte Fase 2D)', () => {
    expect(esAdminPleno(SERGIO_CON_FLAG)).toBe(true)
    for (const cap of ADMIN) {
      expect(tieneCapacidad(SERGIO_CON_FLAG, cap as any), `debería tener ${cap}`).toBe(true)
    }
    for (const cap of LIQUIDACION) {
      expect(tieneCapacidad(SERGIO_CON_FLAG, cap as any), `NO debería tener ${cap}`).toBe(false)
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
  it('administración SIN flag no gana económico ni roles-privilegiados', () => {
    const admin = { rol: 'admin', puesto_organizacional: 'administracion' }
    expect(tieneCapacidad(admin, 'ver_finanzas')).toBe(false)
    expect(tieneCapacidad(admin, 'gestionar_usuarios_roles')).toBe(false)
  })
})

// ── Delegación gerencial temporal (Fase 2D) ──────────────────────────────────
describe('Delegación gerencial: Administración con acceso_gerencia_delegado', () => {
  const ADMIN_SIN = { rol: 'admin', puesto_organizacional: 'administracion' }
  const ADMIN_DELEGADO = { rol: 'admin', puesto_organizacional: 'administracion', acceso_gerencia_delegado: true }

  it('sin delegación: liquida (por Administración) pero NO económico/dashboard/roles', () => {
    expect(tieneCapacidad(ADMIN_SIN, 'preparar_liquidacion')).toBe(true)
    expect(tieneCapacidad(ADMIN_SIN, 'ver_finanzas')).toBe(false)
    expect(tieneCapacidad(ADMIN_SIN, 'ver_dashboard_gerencial')).toBe(false)
    expect(tieneCapacidad(ADMIN_SIN, 'gestionar_usuarios_roles')).toBe(false)
  })

  it('con delegación: gana acceso gerencial COMPLETO (liquidación + económico) sin cambiar puesto', () => {
    const GERENCIAL = [
      'preparar_liquidacion', 'ver_liquidacion', 'editar_liquidacion', 'exportar_visual', 'exportar_banco',
      'ver_finanzas', 'ver_dashboard_gerencial', 'gestionar_facturacion', 'configurar_economico',
      'gestionar_usuarios_roles',
    ] as const
    for (const cap of GERENCIAL) {
      expect(tieneCapacidad(ADMIN_DELEGADO, cap as any), `debería tener ${cap}`).toBe(true)
    }
    // Clasificación y alcance intactos: sigue Administración.
    expect(puestoDe(ADMIN_DELEGADO)).toBe('administracion')
    expect(alcanceDe(ADMIN_DELEGADO)).toBe('todas')
  })
})
