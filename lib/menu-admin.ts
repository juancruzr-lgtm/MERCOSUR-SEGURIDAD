// Menú lateral del shell de Administración / Gerencia.
//
// Una sola navegación con tres modos:
// - desplegado: columna fija de 240 px (escritorio, como siempre);
// - contraido: columna de íconos (escritorio, a pedido; queda guardado);
// - movil: oculto, se abre con ☰ como cajón superpuesto.
// El celular se decide con el mismo criterio que la vista Admin/Supervisor
// (detectarPantallaChicaAdmin en AppClient); la preferencia de contraído sólo
// vale en escritorio.

export const MENU_ADMIN_COLAPSADO_KEY = 'mercosur_admin_sidebar_colapsado'

export type ModoMenuAdmin = 'desplegado' | 'contraido' | 'movil'

export const ANCHO_MENU_ADMIN: Record<ModoMenuAdmin, number> = {
  desplegado: 240,
  contraido: 64,
  movil: 0,
}

// Por encima del AdminViewHeader (1000) y por debajo de los modales (1500).
export const Z_MENU_ADMIN = { boton: 1100, fondo: 1190, cajon: 1200 } as const

/** Valor guardado → contraído sí/no. Cualquier cosa rara = desplegado. */
export function normalizarColapsado(valor: string | null | undefined): boolean {
  return valor === '1' || valor === 'true'
}

export function serializarColapsado(colapsado: boolean): string {
  return colapsado ? '1' : '0'
}

export function modoMenuAdmin(pantallaChica: boolean, colapsado: boolean): ModoMenuAdmin {
  if (pantallaChica) return 'movil'
  return colapsado ? 'contraido' : 'desplegado'
}

export function leerColapsadoGuardado(): boolean {
  try { return normalizarColapsado(localStorage.getItem(MENU_ADMIN_COLAPSADO_KEY)) } catch { return false }
}

export function guardarColapsado(colapsado: boolean) {
  try { localStorage.setItem(MENU_ADMIN_COLAPSADO_KEY, serializarColapsado(colapsado)) } catch { /* sin almacenamiento */ }
}
