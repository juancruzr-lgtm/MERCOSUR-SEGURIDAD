/**
 * lib/posiciones-operativas.ts
 *
 * Gestión de posiciones operativas (Bloque E) — alta, edición, duplicación,
 * desactivación y eliminación excepcional desde el legajo del objetivo.
 *
 * PURO, sin Supabase: mismas reglas que validan las RPCs
 * (crear/editar/duplicar/eliminar_posicion_operativa), expresadas como lógica
 * testable sin base de datos. Las funciones que sí tocan la base (carga y
 * escritura) viven en lib/puestos.ts, que reexporta todo lo de acá.
 *
 * El horario y los días de cada posición NO viven en `puestos`: pertenecen a
 * `servicios_objetivo` (una posición puede tener coberturas distintas según
 * día/horario/vigencia). Por eso el alta de posición nunca crea un servicio;
 * "Configurar cobertura" solo abre el formulario existente con el objetivo y
 * la posición ya elegidos.
 */

export interface PosicionOperativa {
  id: string
  objetivo_id: string
  nombre: string
  orden: number | null
  activo: boolean
  observacion: string | null
  created_at?: string
}

export interface DependenciasPosicion {
  turnosFuturos: number
  serviciosActivos: number
}

export interface DependenciasEliminacion {
  turnosTotal: number
  serviciosTotal: number
  auditoriaMasAllaDeCrear: number
}

/** Mismo criterio de normalización que el resto del proyecto: espacios y mayúsculas no distinguen. */
export const normalizarNombrePosicion = (nombre: string) =>
  nombre.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Ya existe una posición ACTIVA con el mismo nombre normalizado en el mismo
 * objetivo. Las inactivas no bloquean (podría reactivarse o renombrarse una
 * distinta con el mismo nombre histórico). `excluirId` es la propia posición
 * al editar, para no chocar contra sí misma.
 */
export function existeDuplicadoActivo(
  nombre: string,
  posiciones: { id: string; nombre: string; activo: boolean }[],
  excluirId?: string | null,
): boolean {
  const objetivo = normalizarNombrePosicion(nombre)
  if (!objetivo) return false
  return posiciones.some(p =>
    p.activo &&
    p.id !== excluirId &&
    normalizarNombrePosicion(p.nombre) === objetivo,
  )
}

/** Próximo orden disponible del objetivo si no se especifica uno. */
export function calcularOrdenSiguiente(posiciones: { orden: number | null }[]): number {
  const max = posiciones.reduce((m, p) => (p.orden != null && p.orden > m ? p.orden : m), 0)
  return max + 1
}

/**
 * Nombre propuesto al duplicar: si el origen termina en un número
 * ("Vigilador 3"), sugiere el siguiente libre ("Vigilador 4", saltando los ya
 * usados); si no, agrega "(copia)" y numera si hace falta. Editable por el
 * usuario antes de confirmar — nunca se aplica sin su elección.
 */
export function sugerirNombreDuplicado(
  nombreOrigen: string,
  posiciones: { nombre: string }[],
): string {
  const existentes = new Set(posiciones.map(p => normalizarNombrePosicion(p.nombre)))
  const conNumero = nombreOrigen.match(/^(.*?)(\d+)\s*$/)
  if (conNumero) {
    const prefijo = conNumero[1]
    let n = Number(conNumero[2]) + 1
    while (existentes.has(normalizarNombrePosicion(`${prefijo}${n}`))) n++
    return `${prefijo}${n}`
  }
  let candidato = `${nombreOrigen} (copia)`
  let i = 2
  while (existentes.has(normalizarNombrePosicion(candidato))) {
    candidato = `${nombreOrigen} (copia ${i})`
    i++
  }
  return candidato
}

/**
 * Preferencia de este primer bloque: administrador escribe, supervisor solo
 * lee. No ampliar permisos silenciosamente — este helper es la única fuente
 * para la UI; el servidor vuelve a validar en la RPC.
 */
export const puedeEscribirPosiciones = (rol?: string | null): boolean => rol === 'admin'

/** Orden de presentación: incluye activas e inactivas (los históricos no se ocultan). */
export function ordenarPosiciones<T extends { orden: number | null; nombre: string }>(posiciones: T[]): T[] {
  return [...posiciones].sort((a, b) => {
    if (a.orden != null && b.orden != null && a.orden !== b.orden) return a.orden - b.orden
    if (a.orden != null && b.orden == null) return -1
    if (a.orden == null && b.orden != null) return 1
    return a.nombre.localeCompare(b.nombre)
  })
}

/** Motivo exacto que bloquea la desactivación, o null si puede desactivarse. */
export function motivoBloqueoDesactivar(dep: DependenciasPosicion): string | null {
  const partes: string[] = []
  if (dep.turnosFuturos > 0) partes.push(`${dep.turnosFuturos} turno(s) futuro(s) vigente(s)`)
  if (dep.serviciosActivos > 0) partes.push(`${dep.serviciosActivos} servicio(s) activo(s) vinculado(s)`)
  if (partes.length === 0) return null
  return `No se puede desactivar: ${partes.join(' y ')}. Resolvé esas dependencias primero.`
}

/** Motivo exacto que bloquea la eliminación física, o null si puede eliminarse. */
export function motivoBloqueoEliminar(dep: DependenciasEliminacion): string | null {
  if (dep.turnosTotal > 0) return 'No se puede eliminar: la posición tiene turnos asociados. Usá Desactivar.'
  if (dep.serviciosTotal > 0) return 'No se puede eliminar: la posición tiene servicios asociados. Usá Desactivar.'
  if (dep.auditoriaMasAllaDeCrear > 0) return 'No se puede eliminar: la posición tiene historial de operaciones. Usá Desactivar.'
  return null
}

/**
 * Payload de cambios para editar_posicion_operativa: solo los campos que
 * realmente cambiaron respecto de `actual`, más el `id` (nunca se regenera).
 */
export function construirCambiosEdicion(
  actual: PosicionOperativa,
  form: { nombre: string; orden: number | null; observacion: string | null; activo: boolean },
): { id: string } & Partial<Pick<PosicionOperativa, 'nombre' | 'orden' | 'observacion' | 'activo'>> {
  const cambios: any = { id: actual.id }
  if (form.nombre.trim() !== actual.nombre) cambios.nombre = form.nombre.trim()
  if (form.orden !== actual.orden) cambios.orden = form.orden
  if ((form.observacion || null) !== (actual.observacion || null)) cambios.observacion = form.observacion || null
  if (form.activo !== actual.activo) cambios.activo = form.activo
  return cambios
}

/** Filtro para abrir Servicios por Objetivo con el objetivo y la posición ya elegidos. */
export const filtroConfigurarCobertura = (objetivoId: string, puestoId: string) =>
  ({ tipo: 'configurar_cobertura' as const, objetivoId, puestoId })
