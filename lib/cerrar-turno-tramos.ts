// «Cerrar turno» (CerrarTurnoModal): qué se precarga y qué se advierte antes de aprobar.
//
// SÓLO interfaz. No calcula horas nuevas ni cambia reglas: las horas de cada tramo las
// sigue calculando la función de la base cerrar_turno, y las «horas actuales» que se
// muestran salen de horasLiquidablesRegistro (la misma de Liquidación), sólo para leer.
//
// Regla vigente de cerrar_turno (sin cambios): el registro de un vigilador que NO figura
// en los tramos queda con horas_liquidables = 0 (la evidencia del fichaje se conserva).
// Por eso, antes de aprobar se avisa quién perdería horas y se pide confirmación expresa.

import { effectiveGuardia, horasLiquidablesRegistro, type RegistroLiquidacion, type TurnoLiquidacion } from './liquidacion'

export type RegistroTurno = RegistroLiquidacion & {
  id: string
  turno_id: string
  tipo_registro?: string | null
  registro_anulado_at?: string | null
}

export type TramoCierre = {
  id: string
  guardia_id: string
  hora_inicio: string
  hora_fin: string
  /** El registro de origen no tiene horario: el usuario debe completarlo o quitar el tramo. */
  sinHorario?: boolean
  /** Horas reconocidas hoy del registro de origen (referencia, no se envían). */
  horasReferencia?: number
}

const hhmm = (v?: string | null) => (v ? String(v).slice(0, 5) : '')

/** Registros vigentes del turno: no ausencias ni anulados. Con horario o con horas reconocidas. */
export function registrosVigentesTurno<R extends RegistroTurno>(turno: TurnoLiquidacion & { id: string }, registros: R[]): R[] {
  return registros.filter(r =>
    r.turno_id === turno.id &&
    r.tipo_registro !== 'ausencia' &&
    !r.registro_anulado_at &&
    r.cobertura_anulada_at == null &&
    (r.hora_entrada_real != null || r.hora_entrada_final != null || horasLiquidablesRegistro(turno, r) > 0))
}

/** Tramos con que abre la ventana: uno por registro vigente; sin registros, el turno programado. */
export function tramosInicialesCierre(
  turno: TurnoLiquidacion & { id: string; guardia_id?: string | null },
  registros: RegistroTurno[],
  nuevoId: () => string,
): TramoCierre[] {
  const vigentes = registrosVigentesTurno(turno, registros)
  if (vigentes.length > 0) {
    return vigentes.map(r => {
      const inicio = hhmm(r.hora_entrada_final ?? r.hora_entrada_real)
      const fin = hhmm(r.hora_salida_final ?? r.hora_salida_real)
      const sinHorario = !inicio && !fin
      return {
        id: nuevoId(),
        guardia_id: effectiveGuardia(r) ?? '',
        hora_inicio: inicio,
        hora_fin: fin,
        ...(sinHorario ? { sinHorario: true, horasReferencia: horasLiquidablesRegistro(turno, r) } : {}),
      }
    })
  }
  return [{ id: nuevoId(), guardia_id: turno.guardia_id ?? '', hora_inicio: hhmm(turno.hora_inicio), hora_fin: hhmm(turno.hora_fin) }]
}

/** Vigiladores con horas reconocidas que quedarían en 0 por no figurar en los tramos. */
export function omitidosQueQuedanEnCero(
  turno: TurnoLiquidacion & { id: string },
  registros: RegistroTurno[],
  tramos: Array<{ guardia_id: string }>,
): Array<{ guardia_id: string; horas: number }> {
  const incluidos = new Set(tramos.map(t => t.guardia_id).filter(Boolean))
  const porGuardia = new Map<string, number>()
  for (const r of registrosVigentesTurno(turno, registros)) {
    const g = effectiveGuardia(r)
    if (!g || incluidos.has(g)) continue
    const h = horasLiquidablesRegistro(turno, r)
    if (h > 0) porGuardia.set(g, (porGuardia.get(g) ?? 0) + h)
  }
  return Array.from(porGuardia, ([guardia_id, horas]) => ({ guardia_id, horas }))
}
