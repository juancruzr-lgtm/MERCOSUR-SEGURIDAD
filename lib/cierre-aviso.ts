// A quién le toca el aviso de cierre AHORA.
//
// El resumen sirve cuando llega al final de la guardia: antes no hay nada que
// cerrar todavía, y después ya se fue. Como cada supervisor termina a una hora
// distinta —y distinta cada día—, un horario fijo no alcanza: el cron corre
// seguido y esta función decide, en cada corrida, quién está por terminar.
//
// El fin de guardia sale de `supervisores_guardia`, que es la programación real.
// No hay nombres ni horarios escritos acá: si mañana cambia la guardia, cambia
// el aviso.

import { guardiaCubre, normalizarTextoGuardia } from '@/lib/guardias-supervisor'
import type { GuardiaOperativa } from '@/lib/responsables-operativos'

/** Cuánto antes del fin de guardia se manda el resumen. */
export const MINUTOS_ANTES_DEL_CIERRE = 30

function minutosAbsolutos(fecha: string, hora: string): number | null {
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fecha).slice(0, 10))
  const h = /^(\d{1,2}):(\d{2})/.exec(String(hora))
  if (!f || !h) return null
  const dias = Date.UTC(Number(f[1]), Number(f[2]) - 1, Number(f[3])) / 86400000
  return dias * 1440 + Number(h[1]) * 60 + Number(h[2])
}

/**
 * El fin de una guardia, en minutos absolutos. Los nocturnos terminan al día
 * siguiente, igual que en el resto del sistema.
 */
export function finDeGuardia(g: GuardiaOperativa): number | null {
  if (!g.fecha || !g.hora_inicio || !g.hora_fin) return null
  const inicio = minutosAbsolutos(String(g.fecha), String(g.hora_inicio))
  let fin = minutosAbsolutos(String(g.fecha), String(g.hora_fin))
  if (inicio === null || fin === null) return null
  if (fin <= inicio) fin += 1440
  return fin
}

export interface VentanaAviso {
  /** Fecha operativa del momento en que corre el cron, YYYY-MM-DD local. */
  fecha: string
  /** Hora local HH:MM. */
  hora: string
  /** Minutos antes del fin de guardia en que se considera "cerrando". */
  anticipacion?: number
  /**
   * Tolerancia hacia atrás. Es el intervalo del cron: si corre cada 15 minutos,
   * sin esta ventana un fin de guardia que cae entre dos corridas no le avisa a
   * nadie. Con ella, la corrida siguiente lo alcanza.
   */
  tolerancia?: number
}

/**
 * Los usuarios cuya guardia efectiva está por terminar.
 *
 * Un franco o una ausencia no cuentan como guardia (`guardiaCubre`), y una fila
 * inactiva tampoco: a quien no está trabajando no se le manda un resumen de
 * cierre.
 */
export function responsablesQueCierran(
  guardias: GuardiaOperativa[],
  v: VentanaAviso,
): string[] {
  const ahora = minutosAbsolutos(v.fecha, v.hora)
  if (ahora === null) return []
  const anticipacion = v.anticipacion ?? MINUTOS_ANTES_DEL_CIERRE
  const tolerancia = v.tolerancia ?? 0

  const ids = new Set<string>()
  for (const g of guardias) {
    if (!g.supervisor_id) continue
    if (!guardiaCubre(g)) continue
    const fin = finDeGuardia(g)
    if (fin === null) continue
    // Faltan `anticipacion` minutos o menos para terminar, y todavía no pasó
    // más de `tolerancia` desde que terminó.
    const faltan = fin - ahora
    // El >= incluye el instante exacto del fin: con > se caia justo la corrida
    // que mas importa, la de la hora en punto en que termina la guardia.
    if (faltan <= anticipacion && faltan >= -tolerancia) ids.add(g.supervisor_id)
  }
  return Array.from(ids).sort()
}

/**
 * Zonas que hoy tienen alguna guardia cargada, normalizadas.
 *
 * Sirve para lo que esta función NO puede resolver: un responsable de zona sin
 * guardia horaria —el caso de las zonas con un único asignado— no tiene "fin de
 * guardia" en ningún lado, así que el cron no puede saber cuándo avisarle.
 * Devolver las zonas cubiertas permite decirlo explícitamente en vez de
 * inventarle un horario.
 */
export function zonasConGuardiaCargada(guardias: GuardiaOperativa[], fecha: string): string[] {
  const zonas = new Set<string>()
  for (const g of guardias) {
    if (String(g.fecha ?? '').slice(0, 10) !== fecha) continue
    if (!guardiaCubre(g)) continue
    const z = normalizarTextoGuardia(g.zona ?? '')
    if (z) zonas.add(z)
  }
  return Array.from(zonas).sort()
}
