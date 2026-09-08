import { describe, it, expect } from 'vitest'
import { alcanceDe, shellDeUsuario, tieneCapacidad } from '@/lib/capacidades'

// Matriz de autorización por PUESTO (TS). Espejo de la matriz SQL
// (supabase/verificacion/authz_matriz_alcance.sql). DEBE PODER / NO DEBE PODER.
// Sergio es el caso de regresión: rol='admin' pero puesto='supervisor'.

const P = {
  vigilador:           { rol: 'guardia',    puesto_organizacional: 'vigilador' },
  supervisor:          { rol: 'supervisor', puesto_organizacional: 'supervisor' },
  sergio:              { rol: 'admin',      puesto_organizacional: 'supervisor' }, // regresión
  jefe:                { rol: 'supervisor', puesto_organizacional: 'jefe_supervisores' },
  direccion_operativa: { rol: 'admin',      puesto_organizacional: 'direccion_operativa' },
  administracion:      { rol: 'admin',      puesto_organizacional: 'administracion' },
  gerencia:            { rol: 'admin',      puesto_organizacional: 'gerencia' },
}

describe('shellDeUsuario — ruteo por puesto, fail-closed', () => {
  it('vigilador → guardia', () => expect(shellDeUsuario(P.vigilador)).toBe('guardia'))
  it('supervisor → supervisor', () => expect(shellDeUsuario(P.supervisor)).toBe('supervisor'))
  it('Sergio (admin+supervisor) → supervisor, NO admin', () => expect(shellDeUsuario(P.sergio)).toBe('supervisor'))
  it('jefe_supervisores → admin', () => expect(shellDeUsuario(P.jefe)).toBe('admin'))
  it('direccion_operativa → admin', () => expect(shellDeUsuario(P.direccion_operativa)).toBe('admin'))
  it('administracion → admin', () => expect(shellDeUsuario(P.administracion)).toBe('admin'))
  it('gerencia → admin', () => expect(shellDeUsuario(P.gerencia)).toBe('admin'))
  it('rol guardia sin puesto → guardia (fallback)', () => expect(shellDeUsuario({ rol: 'guardia', puesto_organizacional: null })).toBe('guardia'))
  it('rol admin sin puesto → admin (fallback transición)', () => expect(shellDeUsuario({ rol: 'admin', puesto_organizacional: null })).toBe('admin'))
  it('FAIL-CLOSED: rol desconocido sin puesto → denegado (NO admin)', () => expect(shellDeUsuario({ rol: 'cualquiera', puesto_organizacional: null })).toBe('denegado'))
  it('FAIL-CLOSED: sin rol ni puesto → denegado', () => expect(shellDeUsuario({ rol: null, puesto_organizacional: null })).toBe('denegado'))
  it('FAIL-CLOSED: user null → denegado', () => expect(shellDeUsuario(null)).toBe('denegado'))
})

describe('alcanceDe — alcance operativo por puesto', () => {
  it('vigilador → propio', () => expect(alcanceDe(P.vigilador)).toBe('propio'))
  it('supervisor → zonas_asignadas', () => expect(alcanceDe(P.supervisor)).toBe('zonas_asignadas'))
  it('Sergio → zonas_asignadas (NO todas, pese a rol admin)', () => expect(alcanceDe(P.sergio)).toBe('zonas_asignadas'))
  it('jefe → todas', () => expect(alcanceDe(P.jefe)).toBe('todas'))
  it('direccion_operativa → todas', () => expect(alcanceDe(P.direccion_operativa)).toBe('todas'))
  it('administracion → todas', () => expect(alcanceDe(P.administracion)).toBe('todas'))
  it('gerencia → todas', () => expect(alcanceDe(P.gerencia)).toBe('todas'))
})

describe('capacidades — DEBE / NO DEBE por puesto', () => {
  it('gerencia DEBE ver económico/gerencial', () => {
    expect(tieneCapacidad(P.gerencia, 'ver_dashboard_gerencial')).toBe(true)
    expect(tieneCapacidad(P.gerencia, 'ver_liquidacion')).toBe(true)
    expect(tieneCapacidad(P.gerencia, 'ver_finanzas')).toBe(true)
  })
  it('administracion NO DEBE económico, DEBE gestión operativa', () => {
    expect(tieneCapacidad(P.administracion, 'ver_liquidacion')).toBe(false)
    expect(tieneCapacidad(P.administracion, 'ver_finanzas')).toBe(false)
    expect(tieneCapacidad(P.administracion, 'ver_dashboard_gerencial')).toBe(false)
    expect(tieneCapacidad(P.administracion, 'gestionar_turnos')).toBe(true)
  })
  it('direccion_operativa: OPERACIÓN global (turnos+objetivos+supervisión); NO personal-administrativo ni económico', () => {
    expect(tieneCapacidad(P.direccion_operativa, 'gestionar_turnos')).toBe(true)      // operativo
    expect(tieneCapacidad(P.direccion_operativa, 'gestionar_objetivos')).toBe(true)   // dimensión operativa de objetivos
    expect(tieneCapacidad(P.direccion_operativa, 'supervisar_todas_zonas')).toBe(true)
    // NO administrativo de personal ni económico (no hereda Administración):
    expect(tieneCapacidad(P.direccion_operativa, 'gestionar_personal')).toBe(false)
    expect(tieneCapacidad(P.direccion_operativa, 'ver_liquidacion')).toBe(false)
    expect(tieneCapacidad(P.direccion_operativa, 'ver_finanzas')).toBe(false)
    expect(tieneCapacidad(P.direccion_operativa, 'gestionar_usuarios_roles')).toBe(false)
  })
  it('administracion: administrativas sobre la operación; NO supervisa zonas ni económico', () => {
    expect(tieneCapacidad(P.administracion, 'gestionar_personal')).toBe(true)
    expect(tieneCapacidad(P.administracion, 'gestionar_objetivos')).toBe(true)
    expect(tieneCapacidad(P.administracion, 'gestionar_turnos')).toBe(true)
    expect(tieneCapacidad(P.administracion, 'supervisar_zona')).toBe(false)
    expect(tieneCapacidad(P.administracion, 'gestionar_usuarios_roles')).toBe(false)
  })
  it('gestionar_usuarios_roles y económico: SOLO gerencia', () => {
    for (const k of ['supervisor','sergio','jefe','direccion_operativa','administracion','vigilador'] as const) {
      expect(tieneCapacidad((P as any)[k], 'gestionar_usuarios_roles')).toBe(false)
      expect(tieneCapacidad((P as any)[k], 'ver_finanzas')).toBe(false)
    }
    expect(tieneCapacidad(P.gerencia, 'gestionar_usuarios_roles')).toBe(true)
    expect(tieneCapacidad(P.gerencia, 'ver_finanzas')).toBe(true)
  })
  it('supervisor DEBE supervisar y gestionar turnos de su zona; NO gerencial', () => {
    expect(tieneCapacidad(P.supervisor, 'supervisar_zona')).toBe(true)
    expect(tieneCapacidad(P.supervisor, 'revisar_planillas')).toBe(true)
    expect(tieneCapacidad(P.supervisor, 'gestionar_turnos')).toBe(true)   // gestiona turnos de su zona
    expect(tieneCapacidad(P.supervisor, 'supervisar_todas_zonas')).toBe(false)
    expect(tieneCapacidad(P.supervisor, 'ver_dashboard_gerencial')).toBe(false)
    expect(tieneCapacidad(P.supervisor, 'gestionar_personal')).toBe(false)  // administrativa, no la tiene
  })
  it('Sergio tiene las capacidades de supervisor (no las gerenciales), aunque legacy rol=admin', () => {
    expect(tieneCapacidad(P.sergio, 'supervisar_zona')).toBe(true)
    expect(tieneCapacidad(P.sergio, 'gestionar_turnos')).toBe(true)   // opera su zona
    expect(tieneCapacidad(P.sergio, 'ver_liquidacion')).toBe(false)
    expect(tieneCapacidad(P.sergio, 'configurar_sistema')).toBe(false)
    expect(tieneCapacidad(P.sergio, 'gestionar_usuarios_roles')).toBe(false)
  })
  it('jefe_supervisores DEBE todas las zonas, NO DEBE económico', () => {
    expect(tieneCapacidad(P.jefe, 'supervisar_todas_zonas')).toBe(true)
    expect(tieneCapacidad(P.jefe, 'ver_liquidacion')).toBe(false)
  })
  it('vigilador NO DEBE capacidades administrativas', () => {
    expect(tieneCapacidad(P.vigilador, 'ver_operacion')).toBe(false)
    expect(tieneCapacidad(P.vigilador, 'gestionar_turnos')).toBe(false)
    expect(tieneCapacidad(P.vigilador, 'supervisar_zona')).toBe(false)
  })
})
