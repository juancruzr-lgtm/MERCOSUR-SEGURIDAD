// Corrección de un turno desde la grilla mensual, también si ya empezó.
//
// La regla vive en corregir_turno_programacion (Postgres). Este módulo solo
// traduce la evidencia que devuelve la acción 'evaluar' a lo que la grilla
// muestra y ofrece. "Figura iniciado" no es "fue trabajado": manda la evidencia.

export type ClaseEvidencia =
  | 'futuro'
  | 'iniciado_sin_fichaje'
  | 'con_evidencia'
  | 'con_ausencia'
  | 'con_entrada'
  | 'con_horas'
  | 'finalizado'
  | 'horas_revisadas'
  | 'periodo_cerrado'

export interface EvidenciaTurno {
  clase: ClaseEvidencia
  iniciado: boolean
  horario_finalizado: boolean
  puede_anular: boolean
  puede_modificar: boolean
  horas: number
  ronda_ejecuciones: number
  evidencias: number
  periodo_liquidacion: string | null
  alertas_emitidas: { push: number; whatsapp: number }
  ronda_alertas_pendientes: number
}

export const ETIQUETA_CLASE: Record<ClaseEvidencia, string> = {
  futuro: 'Programado, todavía no comenzó',
  iniciado_sin_fichaje: 'El horario comenzó, sin fichaje ni evidencia de trabajo',
  con_evidencia: 'Tiene rondas o fotos registradas',
  con_ausencia: 'Tiene una ausencia registrada',
  con_entrada: 'Tiene fichaje de entrada',
  con_horas: 'Tiene horas trabajadas o cargadas',
  finalizado: 'Finalizado con entrada y salida',
  horas_revisadas: 'Las horas ya fueron revisadas',
  periodo_cerrado: 'El período de liquidación está cerrado',
}

const CLASES = new Set<ClaseEvidencia>(Object.keys(ETIQUETA_CLASE) as ClaseEvidencia[])

export function normalizarEvidencia(v: unknown): EvidenciaTurno | null {
  if (!v || typeof v !== 'object') return null
  const e = v as Record<string, any>
  if (!CLASES.has(e.clase)) return null
  return {
    clase: e.clase,
    iniciado: Boolean(e.iniciado),
    horario_finalizado: Boolean(e.horario_finalizado),
    puede_anular: Boolean(e.puede_anular),
    puede_modificar: Boolean(e.puede_modificar),
    horas: Number(e.horas ?? 0) || 0,
    ronda_ejecuciones: Number(e.ronda_ejecuciones ?? 0) || 0,
    evidencias: Number(e.evidencias ?? 0) || 0,
    periodo_liquidacion: e.periodo_liquidacion ?? null,
    alertas_emitidas: {
      push: Number(e.alertas_emitidas?.push ?? 0) || 0,
      whatsapp: Number(e.alertas_emitidas?.whatsapp ?? 0) || 0,
    },
    ronda_alertas_pendientes: Number(e.ronda_alertas_pendientes ?? 0) || 0,
  }
}

export interface OpcionesCorreccion {
  anular: boolean
  cambiarHorario: boolean
  solicitar: boolean
  /** Por qué no se puede anular/modificar, si no se puede. */
  explicacion: string | null
}

export function opcionesCorreccion(e: EvidenciaTurno | null): OpcionesCorreccion {
  if (!e) return { anular: false, cambiarHorario: false, solicitar: false, explicacion: 'No se pudo leer la evidencia del turno.' }
  if (e.clase === 'periodo_cerrado') {
    return {
      anular: false, cambiarHorario: false, solicitar: false,
      explicacion: `El período está ${e.periodo_liquidacion ?? 'cerrado'}: corresponde el procedimiento de rectificación de liquidación.`,
    }
  }
  if (e.puede_anular) return { anular: true, cambiarHorario: e.puede_modificar, solicitar: false, explicacion: null }
  return {
    anular: false, cambiarHorario: false, solicitar: true,
    explicacion: `${ETIQUETA_CLASE[e.clase]}. No se anula ni se modifica: se pide la corrección y los registros originales se conservan.`,
  }
}

/** Resumen de lo que ya pasó con el turno, para decidir con datos. */
export function resumenEvidencia(e: EvidenciaTurno): string[] {
  const l: string[] = [ETIQUETA_CLASE[e.clase]]
  if (e.horas > 0) l.push(`${e.horas} h registradas`)
  if (e.ronda_ejecuciones > 0) l.push(`${e.ronda_ejecuciones} ronda(s) ejecutada(s)`)
  if (e.evidencias > 0) l.push(`${e.evidencias} evidencia(s)`)
  const { push, whatsapp } = e.alertas_emitidas
  if (push + whatsapp > 0) l.push(`Alertas ya emitidas: ${push} push · ${whatsapp} WhatsApp (no se deshacen; no se generan nuevas si se anula)`)
  if (e.ronda_alertas_pendientes > 0) l.push(`${e.ronda_alertas_pendientes} alerta(s) de ronda pendiente(s): cerrarlas en Revisión Operativa`)
  return l
}

/** Traduce los códigos de error del servidor a un texto para el usuario. */
export function mensajeErrorCorreccion(msg: string): string {
  if (msg.startsWith('CONCURRENCIA')) return 'El turno fue modificado por otra persona. Cerrá y volvé a abrirlo.'
  if (msg.startsWith('PERIODO_CERRADO')) return msg.replace(/^PERIODO_CERRADO:\s*/, '')
  if (msg.startsWith('REQUIERE_SOLICITUD')) return msg.replace(/^REQUIERE_SOLICITUD:\s*/, '')
  return msg
}
