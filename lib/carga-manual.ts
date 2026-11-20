// Carga manual de asistencia (Reportes → «Cargar asistencia manual»).
//
// La base (registrar_cobertura) decide las horas así:
//  · Turno SIN otros registros: la duración programada del turno (mismo criterio
//    que un fichaje completo: la presencia se acredita, las horas las define el turno).
//  · Turno que YA tiene un registro (relevo / segundo tramo): exige las horas del
//    tramo explícitas y controla que la suma no supere lo programado.
// El modal mandaba siempre null, así que el relevo fallaba («especificá
// p_horas_liquidables») y la pantalla mostraba unas horas distintas de las que se
// liquidaban. Esto NO cambia ninguna regla: sólo envía el dato que la base pide.

import { calcHorasTrabajadas } from './supabase'

/** Registros que cuentan para la base como cobertura previa del turno (no las ausencias). */
export function hayCoberturaPrevia(registros: Array<{ tipo_registro?: string | null }> | null | undefined): boolean {
  return (registros ?? []).some(r => r.tipo_registro !== 'ausencia')
}

/** Horas del tramo a enviar a registrar_cobertura: null en un turno vacío (decide la base). */
export function horasParaCargaManual(p: { coberturaPrevia: boolean; entrada: string; salida: string }): number | null {
  if (!p.coberturaPrevia) return null
  const h = calcHorasTrabajadas(p.entrada, p.salida)
  return h > 0 ? Math.round(h * 100) / 100 : null
}

/** Duración programada del turno en horas (cruce de medianoche incluido). */
export function duracionProgramadaHoras(horaInicio: string, horaFin: string): number {
  return calcHorasTrabajadas(String(horaInicio).slice(0, 5), String(horaFin).slice(0, 5))
}
