// Salidas anticipadas: lo que se revisa y lo que cuenta.
//
// El sistema DETECTA toda salida real anterior al fin programado —aunque sea
// por segundos y aunque esté dentro de la tolerancia administrativa de 15
// minutos— y la deja 'detectada'. Eso no tiene ningún efecto sobre la nota:
// abre una revisión. Sólo lo que una persona confirma como 'injustificada'
// (tope 4) o 'abandono' (tope 2) es una falta crítica.
//
// Este módulo es puro: tipos, motivos y conteos. La lectura vive en
// lib/salidas-anticipadas-datos.ts y la regla de la nota en
// lib/evaluacion-final.ts.

export type EstadoSalida =
  | 'detectada' | 'autorizada' | 'injustificada' | 'abandono' | 'descartada' | 'sin_efecto'

export type SituacionRelevo =
  | 'relevo_presente' | 'puesto_sin_cubrir' | 'relevo_sin_fichaje' | 'sin_relevo_programado'

export interface SalidaAnticipada {
  id: string
  registro_id: string
  turno_id: string
  empleado_id: string
  empleado: string
  objetivo_id: string | null
  objetivo: string | null
  fecha: string
  inicio_programado?: string | null
  fin_programado: string
  /** Fichaje de entrada de esa jornada. */
  entrada_registrada?: string | null
  salida_registrada: string
  segundos_antes: number
  minutos_antes: number
  estado: EstadoSalida
  motivo_codigo: string | null
  motivo: string | null
  evidencia: string | null
  resuelto_por: string | null
  resuelto_por_nombre: string | null
  resuelto_at: string | null
  situacion_relevo: SituacionRelevo
  relevo: string | null
  relevo_entrada: string | null
  puede_resolver: boolean
  puede_abandono: boolean
}

export const ETIQUETA_ESTADO_SALIDA: Record<EstadoSalida, string> = {
  detectada:     'Detectada · en revisión',
  autorizada:    'Autorizada',
  injustificada: 'Injustificada confirmada',
  abandono:      'Abandono de puesto comprobado',
  descartada:    'Descartada (error de dato)',
  sin_efecto:    'Sin efecto',
}

export const ETIQUETA_SITUACION_RELEVO: Record<SituacionRelevo, string> = {
  relevo_presente:       'El relevo ya había ingresado',
  puesto_sin_cubrir:     'El puesto quedó sin cubrir hasta que ingresó el relevo',
  relevo_sin_fichaje:    'Había relevo programado y no registró ingreso',
  sin_relevo_programado: 'Sin relevo programado: el servicio terminaba a esa hora',
}

/** Estados que una persona puede registrar. 'sin_efecto' lo pone sólo el sistema. */
export type EstadoResolucion = Exclude<EstadoSalida, 'sin_efecto'>

/**
 * Motivos por estado. Es la MISMA lista que valida `resolver_salidas_anticipadas`
 * en la base: si cambia una, cambia la otra.
 */
export const MOTIVOS_POR_ESTADO: Record<EstadoResolucion, Array<{ codigo: string; etiqueta: string }>> = {
  autorizada: [
    { codigo: 'relevo_anticipado_autorizado', etiqueta: 'Relevo anticipado autorizado por Supervisión' },
    { codigo: 'indicacion_supervision',       etiqueta: 'Indicación expresa de Supervisión o de un superior' },
    { codigo: 'indicacion_cliente',           etiqueta: 'Indicación del cliente, convalidada por Supervisión' },
    { codigo: 'emergencia',                   etiqueta: 'Emergencia' },
    { codigo: 'licencia_o_tramite',           etiqueta: 'Licencia o trámite autorizado' },
    { codigo: 'otro_autorizado',              etiqueta: 'Otra autorización expresa' },
  ],
  injustificada: [
    { codigo: 'sin_autorizacion',              etiqueta: 'Se retiró sin autorización' },
    { codigo: 'retiro_por_llegada_anticipada', etiqueta: 'Se retiró por haber llegado antes (no es autorización)' },
    { codigo: 'otro_injustificado',            etiqueta: 'Otro motivo, sin autorización' },
  ],
  abandono: [
    { codigo: 'abandono_sin_relevo', etiqueta: 'Abandonó el puesto sin relevo' },
  ],
  descartada: [
    { codigo: 'horario_mal_cargado', etiqueta: 'El horario programado estaba mal cargado' },
    { codigo: 'fichaje_erroneo',     etiqueta: 'Fichaje erróneo (no fue una salida real)' },
    { codigo: 'otro_dato',           etiqueta: 'Otro error de dato' },
  ],
  detectada: [
    { codigo: 'reapertura', etiqueta: 'Reabrir para volver a revisar' },
  ],
}

export const MOTIVO_MINIMO = 10

/** "menos de 1 min", "7 min", "1 h 12 min". */
export function textoAnticipacion(segundos: number): string {
  if (segundos < 60) return 'menos de 1 min'
  const min = Math.floor(segundos / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

export interface ConfirmadasEmpleado {
  injustificadas: number
  abandonos: number
}

/**
 * Lo que cuenta para la nota, por empleado. Sólo lo que confirmó una persona:
 * 'detectada' no cuenta nunca, aunque esté pendiente desde hace semanas.
 */
export function confirmadasPorEmpleado(
  salidas: ReadonlyArray<Pick<SalidaAnticipada, 'empleado_id' | 'estado'>>,
): Map<string, ConfirmadasEmpleado> {
  const out = new Map<string, ConfirmadasEmpleado>()
  for (const s of salidas) {
    if (s.estado !== 'injustificada' && s.estado !== 'abandono') continue
    const c = out.get(s.empleado_id) ?? { injustificadas: 0, abandonos: 0 }
    if (s.estado === 'injustificada') c.injustificadas += 1
    else c.abandonos += 1
    out.set(s.empleado_id, c)
  }
  return out
}

export interface GrupoPersona {
  empleadoId: string
  empleado: string
  objetivos: string[]
  salidas: SalidaAnticipada[]
  pendientes: number
  injustificadas: number
  abandonos: number
  autorizadas: number
}

/**
 * Agrupado por persona: son ~500 jornadas por mes pero ~40 personas, y la
 * decisión se toma mirando el patrón de cada una, no jornada por jornada.
 * Primero quien tiene pendientes, después por cantidad.
 */
export function agruparPorPersona(salidas: ReadonlyArray<SalidaAnticipada>): GrupoPersona[] {
  const m = new Map<string, GrupoPersona>()
  for (const s of salidas) {
    const g = m.get(s.empleado_id) ?? {
      empleadoId: s.empleado_id, empleado: s.empleado, objetivos: [], salidas: [],
      pendientes: 0, injustificadas: 0, abandonos: 0, autorizadas: 0,
    }
    g.salidas.push(s)
    if (s.objetivo && !g.objetivos.includes(s.objetivo)) g.objetivos.push(s.objetivo)
    if (s.estado === 'detectada') g.pendientes += 1
    if (s.estado === 'injustificada') g.injustificadas += 1
    if (s.estado === 'abandono') g.abandonos += 1
    if (s.estado === 'autorizada') g.autorizadas += 1
    m.set(s.empleado_id, g)
  }
  return Array.from(m.values()).sort((a, b) =>
    (b.pendientes > 0 ? 1 : 0) - (a.pendientes > 0 ? 1 : 0)
    || b.salidas.length - a.salidas.length
    || a.empleado.localeCompare(b.empleado))
}
