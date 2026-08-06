/**
 * lib/asignacion-mensual.ts
 *
 * Grilla mensual de asignación de vigiladores (Bloque E). Vive dentro de
 * "Ver programación mensual" en el legajo del objetivo: transforma los
 * turnos ya creados por la programación en filas por posición operativa y
 * columnas por día, y prepara los planes de asignación (individual, por
 * rango, por fila completa) que después ejecuta la RPC auditada
 * asignar_vigilador_turnos.
 *
 * PURO: no escribe en Supabase, no crea turnos, no asigna nada por sí solo.
 * Solo produce estructuras de datos y planes; la escritura vive en la RPC.
 */

import { horariosSuperpuestos } from '@/lib/turnos'

// ── Estados visibles ─────────────────────────────────────────────────────────
// Publicado existe como estado futuro (no funcional en este bloque): un
// turno nunca llega a él desde acá.
export type EstadoAsignacion = 'programado' | 'asignado' | 'publicado'

export const ETIQUETA_ESTADO_ASIGNACION: Record<EstadoAsignacion, string> = {
  programado: 'Programado',
  asignado: 'Asignado',
  publicado: 'Publicado',
}

export const estadoAsignacion = (t: { guardia_id?: string | null }): EstadoAsignacion =>
  t.guardia_id ? 'asignado' : 'programado'

// ── Entradas ─────────────────────────────────────────────────────────────────

export interface TurnoGrilla {
  id: string
  puesto_id: string | null
  puesto_nombre: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  guardia_id: string | null
  guardia_nombre: string | null
  guardia_habitual_id?: string | null
  estado: string
  tipo_evento?: string | null
}

export interface VigiladorGrilla {
  id: string
  nombre: string
  estado?: string | null
}

// ── Filas de la grilla (una por posición operativa observada) ────────────────

export interface FilaGrillaPosicion {
  puesto_id: string
  puesto_nombre: string
  hora_inicio: string
  hora_fin: string
  celdas: Map<string, TurnoGrilla> // fecha → turno
}

export interface GrillaMensual {
  fechas: string[]
  filas: FilaGrillaPosicion[]
}

const hora5 = (h?: string | null) => (h ?? '').slice(0, 5)
const pad2 = (n: number) => String(n).padStart(2, '0')

/** Fechas del rango [desde, hasta] inclusive, mismo objetivo/mes o no. */
export function fechasEnRango(desde: string, hasta: string): string[] {
  const [ay, am, ad] = desde.split('-').map(Number)
  const [by, bm, bd] = hasta.split('-').map(Number)
  const d0 = new Date(ay, am - 1, ad)
  const d1 = new Date(by, bm - 1, bd)
  const out: string[] = []
  for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
    out.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`)
  }
  return out
}

/**
 * Arma la grilla: una fila por (puesto_id, horario) observado en los
 * turnos, columnas por cada fecha del rango. No agrupa turnos de distinta
 * posición aunque compartan horario (dos posiciones simultáneas quedan en
 * filas separadas, igual que en la vista previa de programación).
 */
export function armarGrillaMensual(turnos: TurnoGrilla[], desde: string, hasta: string): GrillaMensual {
  const fechas = fechasEnRango(desde, hasta)
  const filasPorClave = new Map<string, FilaGrillaPosicion>()
  for (const t of turnos) {
    if (t.fecha < desde || t.fecha > hasta) continue
    const clave = `${t.puesto_id ?? ''}|${hora5(t.hora_inicio)}|${hora5(t.hora_fin)}`
    let fila = filasPorClave.get(clave)
    if (!fila) {
      fila = {
        puesto_id: t.puesto_id ?? '',
        puesto_nombre: t.puesto_nombre ?? '—',
        hora_inicio: hora5(t.hora_inicio),
        hora_fin: hora5(t.hora_fin),
        celdas: new Map(),
      }
      filasPorClave.set(clave, fila)
    }
    fila.celdas.set(t.fecha, t)
  }
  const filas = [...filasPorClave.values()].sort((a, b) =>
    a.hora_inicio.localeCompare(b.hora_inicio) || a.puesto_nombre.localeCompare(b.puesto_nombre))
  return { fechas, filas }
}

// ── Resumen del mes ──────────────────────────────────────────────────────────

export interface ResumenAsignacionMensual {
  futuros: number
  programados: number
  asignados: number
  publicados: number
}

/** Turno "futuro" = no empezó todavía (fecha/hora Argentina de referencia). */
export function esTurnoFuturo(
  t: Pick<TurnoGrilla, 'fecha' | 'hora_inicio'>,
  fechaActual: string,
  horaActual: string,
): boolean {
  if (t.fecha > fechaActual) return true
  if (t.fecha < fechaActual) return false
  return hora5(t.hora_inicio) > horaActual
}

export function resumenAsignacionMensual(
  turnos: TurnoGrilla[],
  fechaActual: string,
  horaActual: string,
): ResumenAsignacionMensual {
  const futuros = turnos.filter(t => esTurnoFuturo(t, fechaActual, horaActual))
  return {
    futuros: futuros.length,
    programados: futuros.filter(t => estadoAsignacion(t) === 'programado').length,
    asignados: futuros.filter(t => estadoAsignacion(t) === 'asignado').length,
    publicados: 0, // Publicado no es funcional en este bloque.
  }
}

// ── Filtros de la grilla ─────────────────────────────────────────────────────

export interface FiltrosGrillaMensual {
  puestoId?: string | null
  estado?: EstadoAsignacion | 'todos'
  guardiaId?: string | null
  desde?: string | null
  hasta?: string | null
  conConflicto?: boolean | null // true=solo con conflicto, false=solo sin, null/undefined=todos
}

/** Turno con conflicto: superpuesto con otro turno vigente del mismo guardia. */
export function turnosEnConflicto(turnos: TurnoGrilla[]): Set<string> {
  const conflictivos = new Set<string>()
  const porGuardia = new Map<string, TurnoGrilla[]>()
  for (const t of turnos) {
    if (!t.guardia_id) continue
    porGuardia.set(t.guardia_id, [...(porGuardia.get(t.guardia_id) ?? []), t])
  }
  for (const lista of porGuardia.values()) {
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        if (horariosSuperpuestos(lista[i], lista[j])) {
          conflictivos.add(lista[i].id)
          conflictivos.add(lista[j].id)
        }
      }
    }
  }
  return conflictivos
}

export function filtrarGrillaMensual(
  turnos: TurnoGrilla[],
  filtros: FiltrosGrillaMensual,
): TurnoGrilla[] {
  const conConflicto = turnosEnConflicto(turnos)
  return turnos.filter(t => {
    if (filtros.puestoId && t.puesto_id !== filtros.puestoId) return false
    if (filtros.estado && filtros.estado !== 'todos' && estadoAsignacion(t) !== filtros.estado) return false
    if (filtros.guardiaId && t.guardia_id !== filtros.guardiaId) return false
    if (filtros.desde && t.fecha < filtros.desde) return false
    if (filtros.hasta && t.fecha > filtros.hasta) return false
    if (filtros.conConflicto === true && !conConflicto.has(t.id)) return false
    if (filtros.conConflicto === false && conConflicto.has(t.id)) return false
    return true
  })
}

// ── Plan de asignación (individual, por rango, por fila completa) ────────────

export type PatronDias = 'todos' | 'lun_vie' | 'sab_dom' | 'seleccion'

export type MotivoOmisionPlan =
  | 'ya_asignado_otro'
  | 'pasado_o_iniciado'
  | 'fuera_de_rango'
  | 'excluido'

export const ETIQUETA_MOTIVO_OMISION: Record<MotivoOmisionPlan, string> = {
  ya_asignado_otro: 'Ya asignado a otro vigilador',
  pasado_o_iniciado: 'Turno pasado o ya iniciado',
  fuera_de_rango: 'Fuera del rango de días elegido',
  excluido: 'Fecha excluida manualmente',
}

export interface FilaPlanAsignacion {
  turno_id: string
  fecha: string
  estado: 'valido' | 'ya_asignado_mismo' | 'omitido'
  motivo: MotivoOmisionPlan | 'ya_asignado_mismo_vigilador' | null
}

export interface PlanAsignacion {
  turno_ids: string[] // solo los válidos: lo que se envía a la RPC
  filas: FilaPlanAsignacion[]
  resumen: {
    total: number
    validos: number
    ya_asignados: number
    conflictos: number
    omitidos: number
  }
}

const dow1a7 = (fecha: string): number => {
  const [a, m, d] = fecha.split('-').map(Number)
  const x = new Date(a, m - 1, d).getDay()
  return x === 0 ? 7 : x
}

const diasDelPatron = (patron: PatronDias, seleccionadas?: string[]): ((fecha: string) => boolean) => {
  if (patron === 'todos') return () => true
  if (patron === 'lun_vie') return f => dow1a7(f) <= 5
  if (patron === 'sab_dom') return f => dow1a7(f) >= 6
  const set = new Set(seleccionadas ?? [])
  return f => set.has(f)
}

/**
 * Arma el plan de una fila (misma posición/horario) para un rango de fechas
 * y un patrón de días, con exclusiones puntuales. NO llama a la RPC: es el
 * "antes de guardar" que se muestra en pantalla. `conflictos` marca filas
 * válidas que igual quedan resaltadas por posible superposición con OTROS
 * turnos ya asignados al vigilador (fuera de esta fila) — informativo, la
 * RPC vuelve a validar en servidor.
 */
export function planificarAsignacionRango(params: {
  fila: FilaGrillaPosicion
  desde: string
  hasta: string
  guardiaId: string
  patron: PatronDias
  diasSeleccionados?: string[]
  excluir?: string[]
  fechaActual: string
  horaActual: string
  turnosVigilador?: TurnoGrilla[] // otros turnos ya asignados a ese guardia, para avisar conflicto
}): PlanAsignacion {
  const { fila, desde, hasta, guardiaId, patron, diasSeleccionados, excluir, fechaActual, horaActual } = params
  const excluidas = new Set(excluir ?? [])
  const enPatron = diasDelPatron(patron, diasSeleccionados)
  const turnosVigilador = params.turnosVigilador ?? []

  const filas: FilaPlanAsignacion[] = []
  for (const [fecha, turno] of fila.celdas) {
    if (fecha < desde || fecha > hasta) continue
    if (excluidas.has(fecha)) { filas.push({ turno_id: turno.id, fecha, estado: 'omitido', motivo: 'excluido' }); continue }
    if (!enPatron(fecha)) { filas.push({ turno_id: turno.id, fecha, estado: 'omitido', motivo: 'fuera_de_rango' }); continue }
    if (!esTurnoFuturo(turno, fechaActual, horaActual)) {
      filas.push({ turno_id: turno.id, fecha, estado: 'omitido', motivo: 'pasado_o_iniciado' }); continue
    }
    if (turno.guardia_id) {
      if (turno.guardia_id === guardiaId) {
        filas.push({ turno_id: turno.id, fecha, estado: 'ya_asignado_mismo', motivo: null })
      } else {
        filas.push({ turno_id: turno.id, fecha, estado: 'omitido', motivo: 'ya_asignado_otro' })
      }
      continue
    }
    filas.push({ turno_id: turno.id, fecha, estado: 'valido', motivo: null })
  }
  filas.sort((a, b) => a.fecha.localeCompare(b.fecha))

  const conflictos = filas.filter(f => f.estado === 'valido' && turnosVigilador.some(tv =>
    horariosSuperpuestos(tv, { fecha: f.fecha, hora_inicio: fila.hora_inicio, hora_fin: fila.hora_fin }))).length

  return {
    turno_ids: filas.filter(f => f.estado === 'valido').map(f => f.turno_id),
    filas,
    resumen: {
      total: filas.length,
      validos: filas.filter(f => f.estado === 'valido').length,
      ya_asignados: filas.filter(f => f.estado === 'ya_asignado_mismo').length,
      conflictos,
      omitidos: filas.filter(f => f.estado === 'omitido').length,
    },
  }
}

/** Plan para "Asignar todos los turnos visibles de esta posición" (patrón 'todos', sin exclusiones). */
export function planificarAsignacionFila(params: {
  fila: FilaGrillaPosicion
  guardiaId: string
  fechaActual: string
  horaActual: string
  turnosVigilador?: TurnoGrilla[]
}): PlanAsignacion {
  const fechas = [...params.fila.celdas.keys()].sort()
  return planificarAsignacionRango({
    fila: params.fila,
    desde: fechas[0] ?? params.fechaActual,
    hasta: fechas[fechas.length - 1] ?? params.fechaActual,
    guardiaId: params.guardiaId,
    patron: 'todos',
    fechaActual: params.fechaActual,
    horaActual: params.horaActual,
    turnosVigilador: params.turnosVigilador,
  })
}
