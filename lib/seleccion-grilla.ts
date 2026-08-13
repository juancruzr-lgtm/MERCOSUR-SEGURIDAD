/**
 * lib/seleccion-grilla.ts
 *
 * Selección múltiple de turnos en la grilla del objetivo, al estilo del selector
 * de fotos del teléfono: se entra en modo selección, se arrastra el cursor por
 * las celdas y se van marcando, y al final se aplica una acción a todo lo
 * marcado de una vez.
 *
 * PURO: no consulta Supabase y no sabe nada de React. Acá viven las reglas de
 * qué se puede hacer en lote y qué queda afuera; el arrastre y el dibujo son
 * problema del componente.
 *
 * NO define reglas nuevas sobre qué turno se puede anular: eso ya lo decide
 * accionesCelda en lib/asignacion-mensual, que es la misma función que habilita
 * el menú de una celda suelta. Si un turno no se puede anular de a uno, tampoco
 * se puede en lote.
 */

import { accionesCelda } from '@/lib/asignacion-mensual'

/**
 * Tope por operación. Es el mismo que ya aplica asignar_vigilador_turnos, para
 * que las dos operaciones masivas de la grilla se comporten igual y ninguna
 * mande un lote que el servidor vaya a rechazar entero.
 */
export const TOPE_LOTE = 100

export type AccionLote = 'anular' | 'reactivar'

export interface TurnoSeleccionable {
  id: string
  guardia_id?: string | null
  estado?: string | null
  fecha: string
  hora_inicio: string
}

/** Por qué un turno marcado queda afuera de la operación. */
export type MotivoOmision = 'ya_iniciado' | 'ya_anulado' | 'vigente' | 'reemplazado' | 'sin_permiso'

export const ETIQUETA_OMISION: Record<MotivoOmision, string> = {
  ya_iniciado: 'Ya empezó o es pasado',
  ya_anulado: 'Ya estaba anulado',
  vigente: 'No está anulado',
  reemplazado: 'Reemplazado por otro turno',
  sin_permiso: 'Fuera de tu alcance',
}

export interface OmisionLote {
  id: string
  fecha: string
  motivo: MotivoOmision
}

export interface PlanLoteGrilla {
  /** Ids que efectivamente se van a procesar. */
  aplicables: string[]
  /** Marcados que quedan afuera, con el motivo. */
  omitidos: OmisionLote[]
  /** Texto corto para el botón de confirmación. */
  resumen: string
  /** null si se puede confirmar; si no, por qué no. */
  bloqueo: string | null
}

// ── Selección ────────────────────────────────────────────────────────────────

/** Marca o desmarca un turno. Devuelve un Set nuevo: no muta el anterior. */
export function alternarSeleccion(seleccion: ReadonlySet<string>, id: string): Set<string> {
  const proxima = new Set(seleccion)
  if (proxima.has(id)) proxima.delete(id)
  else proxima.add(id)
  return proxima
}

/**
 * Suma ids a la selección. Es lo que usa el arrastre: pasar el cursor por
 * encima agrega, nunca quita, para que al volver sobre lo ya pintado no se
 * borre lo que se acaba de marcar.
 */
export function agregarASeleccion(seleccion: ReadonlySet<string>, ids: string[]): Set<string> {
  const proxima = new Set(seleccion)
  for (const id of ids) proxima.add(id)
  return proxima
}

// ── Plan de la operación ─────────────────────────────────────────────────────

const pluralTurnos = (n: number) => (n === 1 ? '1 turno' : `${n} turnos`)

/**
 * Qué pasa si se confirma la acción sobre lo marcado.
 *
 * Se calcula ANTES de tocar nada para poder mostrarlo: cuántos se procesan,
 * cuántos quedan afuera y por qué. Una operación en lote que no dice qué va a
 * hacer obliga a confiar a ciegas.
 */
export function planificarLoteGrilla(params: {
  turnos: TurnoSeleccionable[]
  seleccion: ReadonlySet<string>
  accion: AccionLote
  fechaActual: string
  horaActual: string
  puedeEscribir: boolean
  motivo?: string
}): PlanLoteGrilla {
  const { turnos, seleccion, accion, fechaActual, horaActual, puedeEscribir } = params

  const porId = new Map(turnos.map(t => [t.id, t]))
  const aplicables: string[] = []
  const omitidos: OmisionLote[] = []

  for (const id of seleccion) {
    const turno = porId.get(id)
    // Marcado pero ya no está en la grilla (cambió el mes o el filtro): se
    // ignora en silencio, no es un problema que el usuario deba resolver.
    if (!turno) continue

    const acciones = accionesCelda(turno, fechaActual, horaActual, puedeEscribir)
    const permitido = accion === 'anular' ? acciones.anular : acciones.reactivar

    if (permitido) {
      aplicables.push(id)
      continue
    }

    omitidos.push({ id, fecha: turno.fecha, motivo: motivoDeOmision(turno, accion, fechaActual, horaActual, puedeEscribir) })
  }

  // Orden estable por fecha: el listado de omitidos se lee como un calendario,
  // no en el orden arbitrario en que se fueron marcando.
  omitidos.sort((a, b) => a.fecha.localeCompare(b.fecha))

  const bloqueo = calcularBloqueo(aplicables.length, accion, params.motivo)
  const verbo = accion === 'anular' ? 'Anular' : 'Reactivar'

  return {
    aplicables,
    omitidos,
    resumen: aplicables.length === 0 ? 'Nada para aplicar' : `${verbo} ${pluralTurnos(aplicables.length)}`,
    bloqueo,
  }
}

function motivoDeOmision(
  turno: TurnoSeleccionable,
  accion: AccionLote,
  fechaActual: string,
  horaActual: string,
  puedeEscribir: boolean,
): MotivoOmision {
  if (!puedeEscribir) return 'sin_permiso'

  const acciones = accionesCelda(turno, fechaActual, horaActual, true)
  // Sin ninguna acción disponible y sin poder reactivar: el turno ya arrancó o
  // es pasado. Es el caso más común y conviene nombrarlo con precisión.
  if (!acciones.anular && !acciones.reactivar) {
    const estado = turno.estado || ''
    if (estado === 'reemplazado') return 'reemplazado'
    return 'ya_iniciado'
  }

  // Se puede lo contrario de lo que se pidió.
  return accion === 'anular' ? 'ya_anulado' : 'vigente'
}

function calcularBloqueo(cantidad: number, accion: AccionLote, motivo?: string): string | null {
  if (cantidad === 0) return 'Ninguno de los turnos marcados se puede procesar.'
  if (cantidad > TOPE_LOTE) {
    return `Son ${cantidad} turnos y el máximo por operación es ${TOPE_LOTE}. Marcá menos.`
  }
  // Anular pide motivo, igual que al anular una celda suelta. Reactivar no:
  // deshacer una anulación no destruye nada.
  if (accion === 'anular' && (motivo ?? '').trim().length < 3) {
    return 'Escribí el motivo de la anulación.'
  }
  return null
}

/** "3 turnos quedan afuera: 2 ya empezaron, 1 ya estaba anulado". */
export function resumenOmitidos(omitidos: OmisionLote[]): string | null {
  if (omitidos.length === 0) return null

  const porMotivo = new Map<MotivoOmision, number>()
  for (const o of omitidos) porMotivo.set(o.motivo, (porMotivo.get(o.motivo) ?? 0) + 1)

  const detalle = [...porMotivo.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([motivo, n]) => `${n} ${ETIQUETA_OMISION[motivo].toLowerCase()}`)
    .join(', ')

  return `${pluralTurnos(omitidos.length)} ${omitidos.length === 1 ? 'queda' : 'quedan'} afuera: ${detalle}.`
}
