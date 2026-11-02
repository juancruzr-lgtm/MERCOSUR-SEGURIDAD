// Conflictos de un vigilador entre turnos (todos los objetivos).
//
// La DETECCIÓN vive en Postgres (conflictos_turno_vigilador_core) y se repite
// en el servidor al guardar: asignar_vigilador_turnos, corregir_turno_programacion
// y /api/turnos/editar. Acá solo se lee el resultado y se redacta: no hay una
// segunda detección que pueda decir otra cosa que la base.
//
// Tipos:
//   superposicion          los horarios se pisan (fecha y hora completas)
//   continuidad_inmediata  uno empieza cuando termina el otro, en otro objetivo
//   doble_turno_dia        mismo día de inicio, sin pisarse ni tocarse

export type TipoConflicto = 'superposicion' | 'continuidad_inmediata' | 'doble_turno_dia'
export type GravedadConflicto = 'alta' | 'media' | 'baja'

export interface ConflictoTurno {
  turno_id: string
  tipo: TipoConflicto
  gravedad: GravedadConflicto
  minutos_superpuestos: number
  objetivo: string | null
  puesto: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  mismo_objetivo?: boolean
}

export interface ConsultaConflictos {
  vigilador: string
  fecha: string
  objetivo: string | null
  hora_inicio: string
  hora_fin: string
  conflictos: ConflictoTurno[]
  puede_confirmar_superposicion: boolean
}

export const ETIQUETA_TIPO_CONFLICTO: Record<TipoConflicto, string> = {
  superposicion: 'Superposición horaria',
  continuidad_inmediata: 'Continuidad inmediata en otro objetivo',
  doble_turno_dia: 'Doble turno en el día',
}

const TIPOS = new Set<TipoConflicto>(['superposicion', 'continuidad_inmediata', 'doble_turno_dia'])

const ddmm = (fecha: string | null | undefined): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha ?? '')
  return m ? `${m[3]}/${m[2]}` : ''
}

/** Lee lo que devuelve la base sin confiar en la forma: lo que no se entiende se descarta. */
export function normalizarConflictos(valor: unknown): ConflictoTurno[] {
  if (!Array.isArray(valor)) return []
  return valor
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .filter(c => TIPOS.has(c.tipo as TipoConflicto))
    .map(c => ({
      turno_id: String(c.turno_id ?? ''),
      tipo: c.tipo as TipoConflicto,
      gravedad: (c.gravedad as GravedadConflicto) ?? (c.tipo === 'superposicion' ? 'alta' : c.tipo === 'continuidad_inmediata' ? 'media' : 'baja'),
      minutos_superpuestos: Number(c.minutos_superpuestos ?? 0) || 0,
      objetivo: (c.objetivo as string | null) ?? null,
      puesto: (c.puesto as string | null) ?? null,
      fecha: String(c.fecha ?? ''),
      hora_inicio: String(c.hora_inicio ?? '').slice(0, 5),
      hora_fin: String(c.hora_fin ?? '').slice(0, 5),
      mismo_objetivo: Boolean(c.mismo_objetivo),
    }))
}

export function normalizarConsultaConflictos(valor: unknown): ConsultaConflictos | null {
  if (!valor || typeof valor !== 'object') return null
  const v = valor as Record<string, unknown>
  return {
    vigilador: String(v.vigilador ?? 'el vigilador'),
    fecha: String(v.fecha ?? ''),
    objetivo: (v.objetivo as string | null) ?? null,
    hora_inicio: String(v.hora_inicio ?? '').slice(0, 5),
    hora_fin: String(v.hora_fin ?? '').slice(0, 5),
    conflictos: normalizarConflictos(v.conflictos),
    puede_confirmar_superposicion: Boolean(v.puede_confirmar_superposicion),
  }
}

/**
 * Una línea por conflicto, con todo lo que pide la operación: vigilador,
 * fecha, objetivo y horario existentes, objetivo y horario nuevos, tipo.
 */
export function describirConflicto(
  c: ConflictoTurno,
  nuevo: { vigilador: string; objetivo: string | null; hora_inicio: string; hora_fin: string },
): string {
  const lugar = `${c.objetivo ?? 'otro objetivo'}${c.puesto ? ` (${c.puesto})` : ''}`
  const existente = `${c.hora_inicio}–${c.hora_fin} en ${lugar} el ${ddmm(c.fecha)}`
  const nuevoTxt = `${nuevo.hora_inicio}–${nuevo.hora_fin} en ${nuevo.objetivo ?? 'este objetivo'}`
  switch (c.tipo) {
    case 'superposicion':
      return `${nuevo.vigilador} ya tiene ${existente}. El nuevo turno (${nuevoTxt}) se superpone ${c.minutos_superpuestos} min.`
    case 'continuidad_inmediata':
      return `${nuevo.vigilador} termina ${existente} y el nuevo turno (${nuevoTxt}) empieza inmediatamente después, en otro objetivo: no hay tiempo de traslado.`
    default:
      return `${nuevo.vigilador} ya tiene otro turno ese día: ${existente}. Nuevo: ${nuevoTxt}.`
  }
}

export const hayConflictos = (c: ConflictoTurno[]): boolean => c.length > 0
export const haySuperposicion = (c: ConflictoTurno[]): boolean => c.some(x => x.tipo === 'superposicion')

export const MOTIVO_CONFLICTO_MIN = 5

/**
 * Qué puede hacer quien está programando ante los conflictos. No prohíbe los
 * turnos dobles: los deja confirmar con motivo. La superposición real solo la
 * confirma Administración/Gerencia (alcance 'todas'); el servidor lo vuelve a
 * exigir.
 */
export function decisionConflictos(
  conflictos: ConflictoTurno[],
  opts: { puedeConfirmarSuperposicion: boolean; confirmado: boolean; motivo: string },
): { puedeGuardar: boolean; bloqueo: string | null; requiereConfirmacion: boolean } {
  if (!hayConflictos(conflictos)) return { puedeGuardar: true, bloqueo: null, requiereConfirmacion: false }
  if (haySuperposicion(conflictos) && !opts.puedeConfirmarSuperposicion) {
    return {
      puedeGuardar: false,
      requiereConfirmacion: true,
      bloqueo: 'Hay una superposición horaria real: solo Administración o Gerencia pueden confirmarla.',
    }
  }
  if (!opts.confirmado) return { puedeGuardar: false, bloqueo: null, requiereConfirmacion: true }
  if (opts.motivo.trim().length < MOTIVO_CONFLICTO_MIN) {
    return { puedeGuardar: false, bloqueo: 'Indicá el motivo para confirmar la asignación.', requiereConfirmacion: true }
  }
  return { puedeGuardar: true, bloqueo: null, requiereConfirmacion: true }
}
