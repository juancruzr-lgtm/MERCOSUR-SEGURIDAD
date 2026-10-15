/**
 * lib/tareas-turno.ts
 *
 * Tareas del turno del vigilador: tipos y reglas puras. Las tareas salen del
 * protocolo (controles aprobados con destino «tarea_turno») y las activa
 * Gerencia. No son calificación: no alimentan Mi Desempeño.
 */

export type Momento = 'ingreso' | 'durante' | 'egreso'
export type EvidenciaTarea = 'ninguna' | 'comentario' | 'foto'
export type EstadoTarea = 'hecha' | 'no_aplica' | 'no_pude'

export interface TareaDelTurno {
  definicion_id: string
  momento: Momento
  texto: string
  evidencia: EvidenciaTarea
  registro: { id: string; estado: EstadoTarea; comentario: string | null; registrado_at: string; con_foto: boolean } | null
}

export interface TurnoConTareas {
  turno_id: string
  objetivo_id: string
  tareas: TareaDelTurno[]
}

export interface DefinicionTarea {
  id: string
  momento: Momento
  texto: string
  evidencia: EvidenciaTarea
  activo: boolean
  puesto_id: string | null
  puesto_nombre: string | null
  activado_at: string
  desactivado_at: string | null
  motivo_desactivacion: string | null
  instruccion_id: string | null
}

export interface TareaParaActivar {
  control_id: string
  texto: string
  cuando: string | null
  quien: string | null
  version_estado: string
  version_numero: number
}

export interface TurnoResumen {
  turno_id: string
  fecha: string
  hora_inicio: string
  hora_fin: string
  vigilador: string | null
  aplicables: number
  hechas: number
  no_aplica: number
  no_pude: number
  pendientes: number
  motivos: { tarea: string; estado: EstadoTarea; comentario: string | null }[]
}

export interface PanelTareas {
  objetivo_id: string
  permisos: { activar: boolean }
  definiciones: DefinicionTarea[]
  para_activar: TareaParaActivar[]
  turnos: TurnoResumen[]
}

export const ETIQUETA_MOMENTO: Record<Momento, string> = {
  ingreso: 'Al ingresar',
  durante: 'Durante el turno',
  egreso: 'Al retirarse',
}

export const ETIQUETA_ESTADO_TAREA: Record<EstadoTarea, string> = {
  hecha: 'Hecha',
  no_aplica: 'No aplica',
  no_pude: 'No pude',
}

export const ETIQUETA_EVIDENCIA: Record<EvidenciaTarea, string> = {
  ninguna: 'Sin evidencia',
  comentario: 'Con comentario',
  foto: 'Con foto',
}

export const MOMENTOS: Momento[] = ['ingreso', 'durante', 'egreso']

/**
 * Momento sugerido a partir del «cuándo» que propuso la IA o validó una
 * persona. Es sólo la opción preseleccionada: Gerencia la confirma o cambia
 * al activar.
 */
export function momentoSugerido(cuando: string | null | undefined): Momento {
  const t = (cuando ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (/(ingres|tomar servicio|toma de servicio|al llegar|al entrar|apertura|al abrir|inicio del turno)/.test(t)) return 'ingreso'
  if (/(retir|cierre|al cerrar|finaliz|egreso|al salir|fin del turno|entrega de guardia)/.test(t)) return 'egreso'
  return 'durante'
}

/** Tareas de un turno agrupadas por momento, en orden. */
export function agruparPorMomento(tareas: TareaDelTurno[]): { momento: Momento; tareas: TareaDelTurno[] }[] {
  return MOMENTOS
    .map(momento => ({ momento, tareas: tareas.filter(t => t.momento === momento) }))
    .filter(g => g.tareas.length > 0)
}

/** Cuántas marcó (cualquier estado) sobre cuántas tiene. */
export function progreso(tareas: TareaDelTurno[]): { marcadas: number; total: number; falta_foto: number } {
  return {
    marcadas: tareas.filter(t => t.registro).length,
    total: tareas.length,
    falta_foto: tareas.filter(t => t.evidencia === 'foto' && t.registro?.estado === 'hecha' && !t.registro.con_foto).length,
  }
}

/** ¿Qué hace falta para registrar? Devuelve el problema o null. */
export function faltaParaRegistrar(t: Pick<TareaDelTurno, 'evidencia'>, estado: EstadoTarea, comentario: string): string | null {
  if (estado !== 'hecha' && !comentario.trim()) return 'Contá brevemente por qué.'
  if (estado === 'hecha' && t.evidencia === 'comentario' && !comentario.trim()) return 'Esta tarea pide un comentario.'
  return null
}
