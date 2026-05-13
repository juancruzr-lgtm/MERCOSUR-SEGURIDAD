// lib/permisos.ts

export type RolUsuario = 'admin' | 'supervisor' | 'guardia'

export const permisos = {
  admin: {
    crearGuardias: true,
    crearSupervisores: true,
    crearObjetivos: true,
    crearTurnos: true,
    asignarGuardias: true,
    revisarAsistencia: true,
    verReportesCompletos: true,
    configurarSistema: true,
    eliminarUsuarios: true,
    cambiarRoles: true,
    aprobarCoberturas: true,
    verAlertas: true,
  },

  supervisor: {
    crearGuardias: true,
    crearSupervisores: false,
    crearObjetivos: true,
    crearTurnos: true,
    asignarGuardias: true,
    revisarAsistencia: true,
    verReportesCompletos: false,
    configurarSistema: false,
    eliminarUsuarios: false,
    cambiarRoles: false,
    aprobarCoberturas: true,
    verAlertas: true,
  },

  guardia: {
    crearGuardias: false,
    crearSupervisores: false,
    crearObjetivos: false,
    crearTurnos: false,
    asignarGuardias: false,
    revisarAsistencia: false,
    verReportesCompletos: false,
    configurarSistema: false,
    eliminarUsuarios: false,
    cambiarRoles: false,
    aprobarCoberturas: false,
    verAlertas: false,
  },
} as const

export type AccionPermiso = keyof typeof permisos.admin

export function puede(
  rol: RolUsuario | null | undefined,
  accion: AccionPermiso
): boolean {
  if (!rol) return false
  return permisos[rol]?.[accion] === true
}
