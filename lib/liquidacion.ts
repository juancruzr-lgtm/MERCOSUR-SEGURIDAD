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
  id?: string | null
  guardia_id?: string | null
  guardia_final_id?: string | null
  objetivo_final_id?: string | null
  hora_entrada_real?: string | null
  hora_salida_real?: string | null
  hora_entrada_final?: string | null
  hora_salida_final?: string | null
  horas_trabajadas?: number | string | null
  horas_liquidables?: number | string | null
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
  horasFichadasGPS:   number         // horas_trabajadas solo si hay entrada Y salida real (GPS evidence)
  tieneEntrada:       boolean        // hora_entrada_real presente
  tieneSalida:        boolean        // hora_salida_real presente
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
// Prioridades primarias (mayor a menor):
//   1. horas_liquidables almacenadas   (+100) — corrección admin, saneamiento, cobertura manual
//   2. campos _final presentes         (+40)  — corrección de guardia/objetivo/horario
//   3. hora_entrada_real               (+10)  — fichaje GPS o manual con entrada
//   4. hora_salida_real                (+5)   — fichaje completo
//   5. horas_trabajadas (capped a 24)         — desempate numérico
//
// Tie-break por calidad cuando el score primario empata:
//   1. tiene salida efectiva (_final ?? real) — registro más completo
//   2. tiene entrada efectiva (_final ?? real)
//   3. horas_liquidables numéricamente mayor  — más horas = más información
//   4. id lexicográfico                       — determinístico y estable

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
  return [...filtrados].sort((a, b) => {
    const ds = scoreRegistro(b) - scoreRegistro(a)
    if (ds !== 0) return ds
    // Tie-break 1: tiene salida efectiva
    const salidaA = effectiveSalida(a) != null ? 1 : 0
    const salidaB = effectiveSalida(b) != null ? 1 : 0
    if (salidaB !== salidaA) return salidaB - salidaA
    // Tie-break 2: tiene entrada efectiva
    const entradaA = effectiveEntrada(a) != null ? 1 : 0
    const entradaB = effectiveEntrada(b) != null ? 1 : 0
    if (entradaB !== entradaA) return entradaB - entradaA
    // Tie-break 3: horas_liquidables mayor
    const hlA = Number(a.horas_liquidables) || 0
    const hlB = Number(b.horas_liquidables) || 0
    if (hlB !== hlA) return hlB - hlA
    // Tie-break 4: id lexicográfico (determinístico)
    return (a.id || '').localeCompare(b.id || '')
  })[0]
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
  const tieneEntrada = registro?.hora_entrada_real != null
  const tieneSalida  = registro?.hora_salida_real  != null
  return {
    guardiaEfectivoId:  effectiveGuardia(registro),
    objetivoEfectivoId: effectiveObjetivo(registro, turno),
    horaEntrada:        effectiveEntrada(registro),
    horaSalida:         effectiveSalida(registro),
    horasReales:        horasRealesRegistro(registro),
    horasLiquidables:   horasLiquidablesRegistro(turno, registro),
    horasFichadasGPS:   tieneEntrada && tieneSalida ? Math.max(0, Number(registro?.horas_trabajadas) || 0) : 0,
    tieneEntrada,
    tieneSalida,
  }
}
