// Escalamiento por WhatsApp de un puesto que sigue descubierto.
//
// ── Esto NO es un detector ──────────────────────────────────────────────────
// El sistema ya sabe cuándo un puesto está descubierto y lo decide en un solo
// lugar: `turnoSinCoberturaOperativa` y `objetivoEstaOperativo`, en
// `lib/turnos.ts`. Las alertas push, las pantallas y el historial leen de ahí.
//
// Este módulo NO vuelve a decidirlo. Toma el hecho ya determinado y responde
// una sola pregunta: a quién hay que escribirle, y en qué nivel. WhatsApp es un
// canal de escalamiento, no una segunda fuente de verdad — si volviera a
// calcular la cobertura por su cuenta, tarde o temprano diría algo distinto de
// lo que muestra la pantalla y nadie sabría cuál creer.
//
// ── Los dos hechos que dejan un puesto sin cubrir ──────────────────────────
// El sistema distingue dos, y para el supervisor los dos significan lo mismo:
// a esta hora no hay nadie confirmado en el objetivo.
//
//   SIN ASIGNAR   el turno no tiene guardia. `turnoSinCoberturaOperativa`.
//   SIN FICHAR    hay guardia asignado y no registró su entrada.
//
// Los dos escalan. Lo que cambia es el texto: en el primero no hay vigilador
// programado que nombrar.

import { objetivoEstaOperativo, turnoSinCoberturaOperativa } from './turnos'
import type { ObjetivoOperativo, TurnoHorario } from './turnos'

/**
 * Los dos niveles, con el mismo formato de clave que usa
 * `notificaciones_enviadas`: la deduplicación existente ya es
 * (usuario_id, turno_id, tipo), que es exactamente
 * destinatario + turno + tipo de escalamiento. No hace falta una tabla nueva.
 */
export const NIVEL = {
  supervisor: 'escalamiento_wa_15',
  operativo: 'escalamiento_wa_30',
} as const

export type ClaveNivel = typeof NIVEL[keyof typeof NIVEL]

/**
 * Las ventanas, en minutos desde el inicio del turno.
 *
 * Son ventanas y no instantes porque el cron corre cada 10 minutos: un turno
 * que empieza 19:00 se evalúa 19:00, 19:10, 19:20… Con un umbral exacto de 15
 * no se evaluaría nunca. El ancho de 10 garantiza exactamente una corrida
 * dentro de cada ventana, y la deduplicación cubre el caso de que el cron se
 * ejecute dos veces.
 */
export const VENTANA_SUPERVISOR = { desde: 15, hasta: 25 }
export const VENTANA_OPERATIVA = { desde: 30, hasta: 40 }

export type MotivoDescarte =
  | 'objetivo_no_operativo'
  | 'objetivo_es_prueba'
  | 'turno_anulado'
  | 'cubierto'
  | 'fuera_de_ventana'
  | 'sin_destinatarios'

export interface TurnoEscalable extends TurnoHorario {
  id: string
  guardia_id?: string | null
  objetivo_id: string
  puesto_id?: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  estado?: string | null
}

export interface ContextoTurno {
  objetivo?: (ObjetivoOperativo & { id?: string; nombre?: string; es_prueba?: boolean | null }) | null
  /** Hay registro de entrada real para este turno. */
  tieneEntrada: boolean
  /** El turno fue reasignado y ya lo cubre otra persona. */
  reasignado?: boolean
  /** Un supervisor o admin ya intervino y dio el puesto por cubierto. */
  resueltoPorIntervencion?: boolean
  minutosDesdeInicio: number
}

export interface Decision {
  escala: boolean
  nivel?: ClaveNivel
  motivo?: MotivoDescarte
}

/**
 * ¿Sigue realmente descubierto?
 *
 * Se vuelve a preguntar en cada nivel: que estuviera descubierto a los 15 no
 * dice nada sobre los 30. Si entró un reemplazo a las 19:22, a las 19:30 no se
 * escala.
 */
export function sigueDescubierto(t: TurnoEscalable, ctx: ContextoTurno): boolean {
  if (ctx.tieneEntrada) return false
  if (ctx.reasignado) return false
  if (ctx.resueltoPorIntervencion) return false
  if (t.estado === 'cubierto') return false
  // Sin guardia asignado: el hecho lo define turnos.ts, no este módulo.
  if (turnoSinCoberturaOperativa(t)) return true
  // Con guardia asignado, sigue descubierto si no hay entrada — que es lo que
  // ya se descartó arriba.
  return Boolean(t.guardia_id)
}

/** Qué corresponde hacer con este turno, ahora. */
export function decidir(t: TurnoEscalable, ctx: ContextoTurno): Decision {
  // El orden importa: primero lo que hace que el turno no sea exigible, para
  // que un objetivo de prueba nunca llegue a evaluarse siquiera.
  if (ctx.objetivo?.es_prueba) return { escala: false, motivo: 'objetivo_es_prueba' }
  if (!objetivoEstaOperativo(ctx.objetivo)) return { escala: false, motivo: 'objetivo_no_operativo' }
  if (t.estado === 'anulado' || t.estado === 'cancelado') {
    return { escala: false, motivo: 'turno_anulado' }
  }
  if (!sigueDescubierto(t, ctx)) return { escala: false, motivo: 'cubierto' }

  const m = ctx.minutosDesdeInicio
  // El nivel más alto primero: si por un atraso del cron un turno cae en las
  // dos ventanas, corresponde el escalamiento mayor.
  if (m >= VENTANA_OPERATIVA.desde && m <= VENTANA_OPERATIVA.hasta) {
    return { escala: true, nivel: NIVEL.operativo }
  }
  if (m >= VENTANA_SUPERVISOR.desde && m <= VENTANA_SUPERVISOR.hasta) {
    return { escala: true, nivel: NIVEL.supervisor }
  }
  return { escala: false, motivo: 'fuera_de_ventana' }
}

// ── El mensaje ──────────────────────────────────────────────────────────────

export interface DatosMensaje {
  objetivo: string
  puesto: string
  horario: string
  vigilador: string
  supervisor: string
}

/**
 * Las variables de la plantilla, en el orden en que Meta las numera ({{1}}…).
 *
 * Se arman acá y no en el proveedor para que el texto no dependa de qué
 * proveedor se use, y para poder verlo en el dry-run sin mandar nada.
 */
export function variablesDeMensaje(
  t: TurnoEscalable,
  d: { objetivo?: string | null; puesto?: string | null; vigilador?: string | null; supervisor?: string | null },
): DatosMensaje {
  return {
    objetivo: d.objetivo || 'Objetivo sin nombre',
    puesto: d.puesto || 'Sin puesto asignado',
    horario: `${t.hora_inicio.slice(0, 5)}–${t.hora_fin.slice(0, 5)}`,
    // Sin guardia asignado no se inventa un nombre: se dice que no hay.
    vigilador: d.vigilador || 'Sin vigilador asignado',
    supervisor: d.supervisor || 'Sin supervisor asignado',
  }
}

/** Los nombres de las plantillas Utility a aprobar en Meta. */
export const PLANTILLA: Record<ClaveNivel, string> = {
  [NIVEL.supervisor]: 'puesto_descubierto_15',
  [NIVEL.operativo]: 'puesto_descubierto_30',
}

/**
 * Las variables que se le mandan a Meta, en el orden en que la plantilla del
 * nivel las numera ({{1}}…).
 *
 * Cada plantilla recibe EXACTAMENTE las variables que su texto usa: Meta
 * rechaza el envío entero si la cantidad no coincide con la plantilla
 * aprobada. El mensaje de 15 le llega al propio supervisor responsable y no
 * lo nombra: cuatro variables. El de 30 sí nombra al supervisor del primer
 * escalamiento: cinco.
 */
export function variablesParaPlantilla(nivel: ClaveNivel, d: DatosMensaje): string[] {
  const comunes = [d.objetivo, d.puesto, d.horario, d.vigilador]
  return nivel === NIVEL.operativo ? [...comunes, d.supervisor] : comunes
}

/**
 * El texto, para el dry-run y para el registro de auditoría.
 *
 * En producción el cuerpo lo arma Meta desde la plantilla aprobada: una
 * conversación iniciada por la empresa NO puede empezar con texto libre. Esto
 * es lo que esa plantilla va a decir, con las variables ya reemplazadas.
 */
export function textoMensaje(nivel: ClaveNivel, d: DatosMensaje): string {
  const encabezado = nivel === NIVEL.supervisor
    ? 'MERCOSUR SEGURIDAD\nPuesto descubierto'
    : 'MERCOSUR SEGURIDAD\nALERTA — Puesto descubierto 30 minutos'

  const cuerpo = nivel === NIVEL.supervisor
    ? 'Han pasado 15 minutos desde el inicio y todavía no hay cobertura confirmada.\n\nRevisar el servicio.'
    : 'El servicio continúa sin cobertura confirmada 30 minutos después del inicio.\n\n'
      + `Supervisor responsable: ${d.supervisor}\n\n`
      + 'El primer escalamiento fue generado a los 15 minutos.\n\nRequiere intervención operativa.'

  return `${encabezado}\n\n`
    + `Objetivo: ${d.objetivo}\n`
    + `Puesto: ${d.puesto}\n`
    + `Turno: ${d.horario}\n`
    + `Vigilador programado: ${d.vigilador}\n\n`
    + cuerpo
}
