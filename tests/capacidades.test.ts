import { describe, expect, it } from 'vitest'
import {
  capacidadesDe,
  tieneCapacidad,
  alcanceDe,
  puestoDe,
  esPuestoValido,
  PUESTOS,
  shellDeUsuario,
  esAdminPleno,
} from '@/lib/capacidades'

describe('acceso a interfaz admin (flag por usuario, sin tocar rol/puesto)', () => {
  const sergio = { rol: 'admin', puesto_organizacional: 'supervisor', acceso_interfaz_admin: true }
  it('Sergio (supervisor + flag) obtiene el SHELL admin', () => {
    expect(shellDeUsuario(sergio)).toBe('admin')
  })
  it('pero NO es admin pleno → vista limitada (sin Config/Sistema)', () => {
    expect(esAdminPleno(sergio)).toBe(false)
  })
  it('sus capacidades y alcance NO cambian (siguen de supervisor/Rosario)', () => {
    expect(alcanceDe(sergio)).toBe('zonas_asignadas')
    expect(tieneCapacidad(sergio, 'ver_liquidacion')).toBe(false)
    expect(tieneCapacidad(sergio, 'ver_finanzas')).toBe(false)
    expect(tieneCapacidad(sergio, 'gestionar_personal')).toBe(false)
    expect(tieneCapacidad(sergio, 'gestionar_usuarios_roles')).toBe(false)
    expect(tieneCapacidad(sergio, 'configurar_sistema')).toBe(false)
    expect(tieneCapacidad(sergio, 'ver_operacion')).toBe(true)
    expect(tieneCapacidad(sergio, 'gestionar_turnos')).toBe(true)
  })
  it('un supervisor SIN flag sigue en el shell supervisor', () => {
    expect(shellDeUsuario({ rol: 'admin', puesto_organizacional: 'supervisor' })).toBe('supervisor')
  })
  it('los puestos admin siguen siendo admin pleno (sin cambios)', () => {
    for (const p of ['jefe_supervisores', 'direccion_operativa', 'administracion', 'gerencia'] as const) {
      expect(shellDeUsuario({ puesto_organizacional: p })).toBe('admin')
      expect(esAdminPleno({ puesto_organizacional: p })).toBe(true)
    }
    // supervisor y vigilador NO son admin pleno
    expect(esAdminPleno({ puesto_organizacional: 'supervisor' })).toBe(false)
    expect(esAdminPleno({ puesto_organizacional: 'vigilador' })).toBe(false)
  })
})

// ROLES 1: infraestructura de capacidades. Estos tests fijan el contrato
// (paridad con el comportamiento actual mientras no haya puesto) y la semántica
// nueva cuando el puesto está seteado. Nada de esto cambia producción todavía.

describe('capacidades — compatibilidad con rol viejo (sin puesto)', () => {
  it('admin sin puesto conserva acceso total (comportamiento actual)', () => {
    const u = { rol: 'admin', puesto_organizacional: null }
    // núcleo operativo + gerencial/económico, como hoy
    for (const cap of ['ver_operacion', 'gestionar_turnos', 'supervisar_todas_zonas',
      'ver_dashboard_gerencial', 'ver_liquidacion', 'editar_liquidacion', 'ver_finanzas',
      'configurar_economico', 'gestionar_usuarios_roles'] as const) {
      expect(tieneCapacidad(u, cap)).toBe(true)
    }
    expect(alcanceDe(u)).toBe('todas')
    expect(puestoDe(u)).toBeNull()
  })

  it('supervisor sin puesto: capacidades de supervisor, alcance por zonas', () => {
    const u = { rol: 'supervisor', puesto_organizacional: null }
    expect(tieneCapacidad(u, 'supervisar_zona')).toBe(true)
    expect(tieneCapacidad(u, 'revisar_planillas')).toBe(true)
    expect(tieneCapacidad(u, 'supervisar_todas_zonas')).toBe(false)
    expect(tieneCapacidad(u, 'ver_liquidacion')).toBe(false)
    expect(alcanceDe(u)).toBe('zonas_asignadas')
  })

  it('guardia/vigilador sin puesto: sin capacidades de gestión, alcance propio', () => {
    for (const rol of ['guardia', 'vigilador']) {
      const u = { rol, puesto_organizacional: null }
      expect(capacidadesDe(u).size).toBe(0)
      expect(alcanceDe(u)).toBe('propio')
    }
  })
})

describe('capacidades — puesto canónico manda sobre el rol viejo', () => {
  it('Sergio (rol admin heredado + puesto supervisor): capacidades de supervisor, NO gerenciales', () => {
    const sergio = { rol: 'admin', puesto_organizacional: 'supervisor' }
    expect(tieneCapacidad(sergio, 'supervisar_zona')).toBe(true)
    expect(alcanceDe(sergio)).toBe('zonas_asignadas') // Rosario, vía supervisor_zonas
    // ya NO hereda lo gerencial/económico por ser admin técnico
    expect(tieneCapacidad(sergio, 'ver_liquidacion')).toBe(false)
    expect(tieneCapacidad(sergio, 'ver_dashboard_gerencial')).toBe(false)
    expect(tieneCapacidad(sergio, 'supervisar_todas_zonas')).toBe(false)
  })

  it('Aldo (jefe_supervisores): supervisar_todas_zonas + alcance todas, sin económico', () => {
    const aldo = { rol: 'supervisor', puesto_organizacional: 'jefe_supervisores' }
    expect(tieneCapacidad(aldo, 'supervisar_todas_zonas')).toBe(true)
    expect(alcanceDe(aldo)).toBe('todas')
    expect(tieneCapacidad(aldo, 'ver_liquidacion')).toBe(false)
  })

  it('Rodolfo (direccion_operativa): operación global sin acceso económico', () => {
    const rodolfo = { rol: 'admin', puesto_organizacional: 'direccion_operativa' }
    expect(tieneCapacidad(rodolfo, 'supervisar_todas_zonas')).toBe(true)
    expect(tieneCapacidad(rodolfo, 'gestionar_turnos')).toBe(true)
    expect(tieneCapacidad(rodolfo, 'ver_desempeno')).toBe(true)
    expect(alcanceDe(rodolfo)).toBe('todas')
    // económico/gerencial fuera (decisión de Juan)
    for (const cap of ['ver_liquidacion', 'editar_liquidacion', 'ver_finanzas',
      'gestionar_facturacion', 'configurar_economico', 'ver_dashboard_gerencial'] as const) {
      expect(tieneCapacidad(rodolfo, cap)).toBe(false)
    }
  })

  it('administracion: rama administrativa/operativa, SIN gerencial/económico', () => {
    const admin = { rol: 'admin', puesto_organizacional: 'administracion' }
    expect(tieneCapacidad(admin, 'ver_operacion')).toBe(true)
    expect(tieneCapacidad(admin, 'gestionar_personal')).toBe(true)
    for (const cap of ['ver_liquidacion', 'editar_liquidacion', 'ver_finanzas',
      'gestionar_facturacion', 'configurar_economico', 'ver_dashboard_gerencial'] as const) {
      expect(tieneCapacidad(admin, cap)).toBe(false)
    }
  })

  it('gerencia: acceso total incluido económico/sensible', () => {
    const g = { rol: 'admin', puesto_organizacional: 'gerencia' }
    for (const cap of ['ver_liquidacion', 'editar_liquidacion', 'exportar_visual', 'exportar_banco',
      'ver_finanzas', 'gestionar_facturacion', 'configurar_economico', 'ver_dashboard_gerencial',
      'gestionar_usuarios_roles', 'supervisar_todas_zonas'] as const) {
      expect(tieneCapacidad(g, cap)).toBe(true)
    }
    expect(alcanceDe(g)).toBe('todas')
  })
})

describe('capacidades — utilidades', () => {
  it('esPuestoValido acepta sólo los 6 puestos', () => {
    for (const p of PUESTOS) expect(esPuestoValido(p)).toBe(true)
    for (const x of ['admin', 'jefe', '', null, undefined, 'Gerencia']) expect(esPuestoValido(x)).toBe(false)
  })

  it('puesto inválido en la columna se ignora → cae al fallback por rol', () => {
    const u = { rol: 'supervisor', puesto_organizacional: 'basura' }
    expect(puestoDe(u)).toBeNull()
    expect(alcanceDe(u)).toBe('zonas_asignadas') // fallback supervisor
  })
})
