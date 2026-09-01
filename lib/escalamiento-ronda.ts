// Escalamiento por WhatsApp de rondas programadas no iniciadas.
//
// ── Esto NO es un detector ──────────────────────────────────────────────────
// El incumplimiento de una ronda lo decide `evaluar_ronda_alertas()` en la
// base, corriendo por pg_cron cada 10 minutos, y queda persistido en
// `ronda_alertas`. Esa función ya aplica TODAS las exclusiones operativas:
//
//   · objetivos `es_prueba` (filtro de alcance completo de
//     rondas_ventanas_programadas, migración 20260731110000);
//   · objetivos pausados/inactivos (20260810260000: un objetivo pausado no
//     genera obligaciones);
//   · turnos anulados y ausencias (20260827120000);
//   · rondas pausadas por CUALQUIER causa —técnica, capacitación, no aplica—
//     (20260802200000 y 20260826170000: la pausa suprime la creación de la
//     alerta, cualquiera sea su causa);
//   · rondas iniciadas (la ventana cumplida no genera alerta);
//   · alertas atendidas (pasan a estado 'resuelta').
//
// Este módulo NO reinterpreta ninguna de esas reglas: consume las alertas
// `pendiente` de tipo `no_iniciada` y responde a quién escribirle. WhatsApp es
// un canal adicional al push existente, que lee LA MISMA tabla.
//
// Las comprobaciones de `decidirRonda` sobre el objetivo son la misma defensa
// que ya aplica el escalamiento de puestos: un objetivo que pasó a prueba o se
// pausó DESPUÉS de creada la alerta no debe recibir WhatsApp aunque la fila
// siga pendiente.

import { objetivoEstaOperativo } from './turnos'
import type { ObjetivoOperativo } from './turnos'

/**
 * La clave de nivel, con el mismo formato que usa la deduplicación existente.
 * En `notificaciones_enviadas` el tipo embebe el id de la alerta —igual que el
 * push de rondas (`supervisor_ronda_no_iniciada:<id>`)— así una alerta se
 * avisa una sola vez por canal y por persona.
 */
export const NIVEL_RONDA = 'escalamiento_wa_ronda_no_iniciada'

/** El nombre de la plantilla Utility a aprobar en Meta. */
export const PLANTILLA_RONDA = 'ronda_no_iniciada'

/** Fila de ronda_alertas, con lo que el escalamiento necesita. */
export interface RondaAlertaEscalable {
  id: string
  tipo: string
  estado?: string | null
  objetivo_id: string
  puesto_id?: string | null
  turno_id?: string | null
  guardia_id?: string | null
  /** timestamptz de la ventana programada. */
  ventana_inicio?: string | null
  ventana_fin?: string | null
}

export type MotivoDescarteRonda =
  | 'tipo_no_escalable'
  | 'alerta_resuelta'
  | 'objetivo_es_prueba'
  | 'objetivo_no_operativo'

export interface DecisionRonda {
  escala: boolean
  motivo?: MotivoDescarteRonda
}

/**
 * ¿Corresponde escalar esta alerta por WhatsApp, ahora?
 *
 * Sólo `no_iniciada`: `no_finalizada` y `suspendida` ya tienen push propio y
 * no son parte de esta fase. Una alerta resuelta nunca escala aunque llegue
 * acá por una consulta sin filtrar.
 */
export function decidirRonda(
  alerta: RondaAlertaEscalable,
  ctx: { objetivo?: (ObjetivoOperativo & { es_prueba?: boolean | null }) | null },
): DecisionRonda {
  if (alerta.tipo !== 'no_iniciada') return { escala: false, motivo: 'tipo_no_escalable' }
  if ((alerta.estado ?? 'pendiente') !== 'pendiente') return { escala: false, motivo: 'alerta_resuelta' }
  if (ctx.objetivo?.es_prueba) return { escala: false, motivo: 'objetivo_es_prueba' }
  if (!objetivoEstaOperativo(ctx.objetivo)) return { escala: false, motivo: 'objetivo_no_operativo' }
  return { escala: true }
}

/**
 * La clave de deduplicación de una alerta, ligada a la ALERTA real: la misma
 * alerta no vuelve a avisarse en la próxima corrida, y una alerta distinta
 * (otra ventana, otro día) tiene otra clave y se avisa normalmente.
 */
export function claveDedupRonda(alerta: Pick<RondaAlertaEscalable, 'id'>): string {
  return `${NIVEL_RONDA}:${alerta.id}`
}

/**
 * La ventana programada como HH:MM–HH:MM en hora de la operación.
 *
 * ronda_alertas guarda timestamptz; el mensaje tiene que decir la hora local
 * del servicio, no la del servidor (que en Vercel corre en UTC).
 */
export function horarioVentana(
  inicio?: string | null,
  fin?: string | null,
  timeZone = 'America/Argentina/Buenos_Aires',
): string {
  const hora = (iso?: string | null): string | null => {
    if (!iso) return null
    const fecha = new Date(iso)
    if (Number.isNaN(fecha.getTime())) return null
    const partes = new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(fecha)
    const g = (t: string) => partes.find(p => p.type === t)?.value ?? '00'
    // Intl puede devolver la hora 24 en el límite del día.
    const hh = g('hour') === '24' ? '00' : g('hour')
    return `${hh}:${g('minute')}`
  }
  const desde = hora(inicio)
  const hasta = hora(fin)
  if (desde && hasta) return `${desde}–${hasta}`
  return desde ?? hasta ?? 'Sin horario'
}

// ── El mensaje ──────────────────────────────────────────────────────────────

export interface DatosMensajeRonda {
  objetivo: string
  ronda: string
  horario: string
  vigilador: string
}

/** Los datos del mensaje, sin inventar lo que falte. */
export function datosDeRonda(d: {
  objetivo?: string | null
  ronda?: string | null
  horario?: string | null
  vigilador?: string | null
}): DatosMensajeRonda {
  return {
    objetivo: d.objetivo || 'Objetivo sin nombre',
    ronda: d.ronda || 'Ronda sin nombre',
    horario: d.horario || 'Sin horario',
    vigilador: d.vigilador || 'Sin vigilador asignado',
  }
}

/**
 * Las variables que viajan a Meta, en el orden en que la plantilla las numera
 * ({{1}} objetivo, {{2}} ronda, {{3}} horario programado, {{4}} vigilador).
 * Meta rechaza el envío entero si la cantidad no coincide con la aprobada.
 */
export function variablesRondaParaPlantilla(d: DatosMensajeRonda): string[] {
  return [d.objetivo, d.ronda, d.horario, d.vigilador]
}

/**
 * El texto que la plantilla aprobada va a decir, para el dry-run y la
 * auditoría. El cuerpo real lo arma Meta desde la plantilla.
 */
export function textoMensajeRonda(d: DatosMensajeRonda): string {
  return 'MERCOSUR SEGURIDAD\nRonda no iniciada\n\n'
    + `Objetivo: ${d.objetivo}\n`
    + `Ronda: ${d.ronda}\n`
    + `Horario programado: ${d.horario}\n`
    + `Vigilador: ${d.vigilador}\n\n`
    + 'La ronda programada no fue iniciada dentro del horario previsto.\n\n'
    + 'Revisar el servicio.'
}
