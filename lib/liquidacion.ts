/**
 * lib/liquidacion.ts
 *
 * Lógica de dominio compartida para el cálculo de líneas de liquidación.
 * Utilizada por AppClient (reportes/exportes) y los endpoints del Legajo Digital.
 * No depende del navegador — válido en servidor y cliente.
 */

import { calcularHorasLiquidables } from '@/lib/supabase'

// ── Tipos mínimos ─────────────────────────────────────────────────────────────
// Representan únicamente los campos que esta lógica necesita.
// Son compatibles con RegistroAsistencia (AppClient) y los shapes de la API.

export interface RegistroLiquidacion {
  guardia_id?: string | null
  guardia_final_id?: string | null
  objetivo_final_id?: string | null
  hora_entrada_real?: string | null
  hora_salida_real?: string | null
  hora_entrada_final?: string | null
  hora_salida_final?: string | null
  horas_trabajadas?: number | string | null
  horas_liquidables?: number | string | null
  created_at?: string | null
}

export interface TurnoLiquidacion {
  fecha: string
  hora_inicio: string
  hora_fin: string
  objetivo_id?: string | null
}

export interface LineaLiquidacion {
  guardiaEfectivoId:  string | null
  objetivoEfectivoId: string | null
  horaEntrada:        string | null  // final ?? real
  horaSalida:         string | null  // final ?? real (null si en curso)
  horasReales:        number         // raw horas_trabajadas
  horasLiquidables:   number         // calculado con tolerancia 15 min
}

// ── Resolvedores de campo efectivo ────────────────────────────────────────────
// Regla única acordada: el campo _final prevalece sobre el original.
// Cualquier cambio aquí se propaga automáticamente a todos los consumidores.

export function effectiveGuardia(r?: RegistroLiquidacion | null): string | null {
  return r?.guardia_final_id ?? r?.guardia_id ?? null
}

export function effectiveObjetivo(
  r?: RegistroLiquidacion | null,
  turno?: TurnoLiquidacion | null,
): string | null {
  return r?.objetivo_final_id ?? turno?.objetivo_id ?? null
}

export function effectiveEntrada(r?: RegistroLiquidacion | null): string | null {
  return r?.hora_entrada_final ?? r?.hora_entrada_real ?? null
}

export function effectiveSalida(r?: RegistroLiquidacion | null): string | null {
  return r?.hora_salida_final ?? r?.hora_salida_real ?? null
}

// ── Score y selección del registro principal ──────────────────────────────────
// Prioridades (mayor a menor):
//   1. horas_liquidables almacenadas (corrección admin, saneamiento, cobertura manual)
//   2. campos _final presentes (corrección de guardia/objetivo/horario)
//   3. hora_entrada_real (fichaje GPS o manual con entrada)
//   4. hora_salida_real (fichaje completo)
//   5. horas_trabajadas (desempate numérico, capped a 24)
// Tie-break final: created_at más reciente gana.

export function scoreRegistro(r: RegistroLiquidacion): number {
  return (r.horas_liquidables != null                                  ? 100 : 0) +
         (r.hora_entrada_final != null || r.hora_salida_final != null  ?  40 : 0) +
         (r.hora_entrada_real  != null                                 ?  10 : 0) +
         (r.hora_salida_real   != null                                 ?   5 : 0) +
         Math.min(Number(r.horas_trabajadas) || 0, 24)
}

export function selectRegistroPrincipal<R extends RegistroLiquidacion>(
  registros: R[],
  guardiaId?: string | null,
): R | undefined {
  const filtrados = guardiaId != null
    ? registros.filter(r => effectiveGuardia(r) === guardiaId)
    : registros
  return [...filtrados].sort(
    (a, b) =>
      scoreRegistro(b) - scoreRegistro(a) ||
      // Si igual score, el más reciente gana
      (b.created_at || '').localeCompare(a.created_at || ''),
  )[0]
}

// ── Cálculos de horas ─────────────────────────────────────────────────────────

export function horasRealesRegistro(registro?: RegistroLiquidacion | null): number {
  return registro?.hora_entrada_real && registro?.hora_salida_real
    ? Math.max(0, Number(registro.horas_trabajadas) || 0)
    : 0
}

export function horasLiquidablesRegistro(
  turno: TurnoLiquidacion,
  registro?: RegistroLiquidacion | null,
): number {
  // Registros de saneamiento/cobertura manual tienen horas_liquidables
  // almacenadas y no tienen hora_entrada_real ni hora_salida_real.
  // Usar el valor almacenado cuando está disponible.
  if (registro?.horas_liquidables != null) {
    return Math.max(0, Number(registro.horas_liquidables) || 0)
  }
  const horaEntrada = effectiveEntrada(registro)
  const horaSalida  = effectiveSalida(registro)
  return horaEntrada && horaSalida
    ? calcularHorasLiquidables(
        turno.fecha, turno.hora_inicio, turno.hora_fin,
        horaEntrada, horaSalida,
      )
    : 0
}

// ── Línea completa de liquidación ─────────────────────────────────────────────
// Concentra toda la lógica para construir una fila de la planilla mensual.
// Fuente única que consumen AppClient (reportes/XLSX) y el endpoint Mi Planilla.

export function resolverLineaLiquidacion(
  turno: TurnoLiquidacion,
  registro?: RegistroLiquidacion | null,
): LineaLiquidacion {
  return {
    guardiaEfectivoId:  effectiveGuardia(registro),
    objetivoEfectivoId: effectiveObjetivo(registro, turno),
    horaEntrada:        effectiveEntrada(registro),
    horaSalida:         effectiveSalida(registro),
    horasReales:        horasRealesRegistro(registro),
    horasLiquidables:   horasLiquidablesRegistro(turno, registro),
  }
}
