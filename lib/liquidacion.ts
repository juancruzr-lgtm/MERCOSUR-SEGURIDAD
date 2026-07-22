/**
 * lib/liquidacion.ts
 *
 * Lógica de dominio compartida para el cálculo de líneas de liquidación.
 * Utilizada por AppClient (reportes/exportes) y los endpoints del Legajo Digital.
 * No depende del navegador — válido en servidor y cliente.
 */

import { calcularHorasLiquidables } from '@/lib/supabase'

// ── Tipos mínimos ─────────────────────────────────────────────────────────────

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
  origen_cobertura?: string | null
  cierre_automatico?: boolean | null
}

export interface TurnoLiquidacion {
  fecha: string
  hora_inicio: string
  hora_fin: string
  objetivo_id?: string | null
  estado?: string | null
}

export interface LineaLiquidacion {
  guardiaEfectivoId:       string | null
  objetivoEfectivoId:      string | null
  horaEntrada:             string | null  // final ?? real
  horaSalida:              string | null  // final ?? real (null si en curso)
  horasReales:             number         // raw horas_trabajadas
  horasLiquidables:        number         // calculado con tolerancia 15 min
  horasTrabajadasOficiales: number        // alias de horasLiquidables para claridad semántica
  horasFichadasGPS:        number         // horas_trabajadas solo si hay entrada Y salida real
  tieneEntrada:            boolean        // hora_entrada_real presente
  tieneSalida:             boolean        // hora_salida_real presente
  tieneFichajeGPSCompleto: boolean        // tanto hora_entrada_real como hora_salida_real presentes
  origenRegistro:          string         // clave interna del origen
  origenEtiqueta:          string         // etiqueta legible para el usuario
  cargadoPorEmpleado:      boolean
  cargadoPorSupervisor:    boolean
  cargadoPorAdministracion: boolean
}

// ── Resolvedores de campo efectivo ────────────────────────────────────────────

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
    const salidaA = effectiveSalida(a) != null ? 1 : 0
    const salidaB = effectiveSalida(b) != null ? 1 : 0
    if (salidaB !== salidaA) return salidaB - salidaA
    const entradaA = effectiveEntrada(a) != null ? 1 : 0
    const entradaB = effectiveEntrada(b) != null ? 1 : 0
    if (entradaB !== entradaA) return entradaB - entradaA
    const hlA = Number(a.horas_liquidables) || 0
    const hlB = Number(b.horas_liquidables) || 0
    if (hlB !== hlA) return hlB - hlA
    return (a.id || '').localeCompare(b.id || '')
  })[0]
}

// ── Cálculos de horas ─────────────────────────────────────────────────────────

export function horasRealesRegistro(registro?: RegistroLiquidacion | null): number {
  return registro?.hora_entrada_real && registro?.hora_salida_real
    ? Math.max(0, Number(registro.horas_trabajadas) || 0)
    : 0
}

// Normaliza horas autorizadas (correcciones manuales) a múltiplos de 0,5.
// NO aplicar a la duración programada del turno ni a horas GPS crudas.
export function normalizarHorasOficiales(horas: number): number {
  return Math.round(horas * 2) / 2
}

// ── Período de transición ──────────────────────────────────────────────────────
// Junio y julio 2026: el estado "cubierto" es la autoridad para la liquidación.
// La ausencia de fichaje GPS no invalida la cobertura en estos meses.
export function esPeriodoTransicion(fecha: string): boolean {
  return fecha >= '2026-06-01' && fecha <= '2026-07-31'
}

export function horasProgramadasTurno(turno: TurnoLiquidacion): number {
  const [h1, m1] = turno.hora_inicio.split(':').map(Number)
  const [h2, m2] = turno.hora_fin.split(':').map(Number)
  let d = (h2 * 60 + m2) - (h1 * 60 + m1)
  if (d < 0) d += 1440
  return d / 60
}

// REGLA OFICIAL DE LIQUIDACIÓN DEL SISTEMA
// ─────────────────────────────────────────
// Las horas oficiales surgen del turno programado, no del fichaje GPS.
// El GPS es evidencia de presencia, nunca determina automáticamente horas oficiales.
//
// Prioridad (mayor a menor):
//   1. horas_liquidables guardado → valor definitivo (supervisor/admin/saneamiento/cron).
//   2. Tiempos _final autorizados → calcular desde tiempos autorizados; normalizar a 0,5h.
//   3. Fichaje GPS completo (entrada Y salida reales, sin corrección) → duración programada
//      del turno. El GPS confirma presencia; la cantidad de horas la define el turno.
//   4. Sin datos suficientes (en curso o sin fichaje) → 0.
export function horasLiquidablesRegistro(
  turno: TurnoLiquidacion,
  registro?: RegistroLiquidacion | null,
): number {
  // Path 1: valor almacenado explícito — máxima prioridad
  if (registro?.horas_liquidables != null) {
    return normalizarHorasOficiales(Math.max(0, Number(registro.horas_liquidables) || 0))
  }

  const horaEntradaFinal = registro?.hora_entrada_final ?? null
  const horaSalidaFinal  = registro?.hora_salida_final  ?? null
  const horaEntradaReal  = registro?.hora_entrada_real  ?? null
  const horaSalidaReal   = registro?.hora_salida_real   ?? null

  // Path 2: corrección/autorización explícita vía campos _final
  // Si al menos uno está presente, se usan los tiempos efectivos autorizados.
  if (horaEntradaFinal || horaSalidaFinal) {
    const entrada = horaEntradaFinal ?? horaEntradaReal
    const salida  = horaSalidaFinal  ?? horaSalidaReal
    if (!entrada || !salida) return 0
    return normalizarHorasOficiales(
      calcularHorasLiquidables(turno.fecha, turno.hora_inicio, turno.hora_fin, entrada, salida),
    )
  }

  // Path 3: fichaje GPS completo sin corrección → duración programada del turno
  // Se pasan los tiempos del propio turno como "GPS" para obtener minutosProgramados
  // (diferencia = 0 → rama dentro de tolerancia → devuelve minutosProgramados).
  if (horaEntradaReal && horaSalidaReal) {
    return calcularHorasLiquidables(
      turno.fecha, turno.hora_inicio, turno.hora_fin,
      turno.hora_inicio, turno.hora_fin,
    )
  }

  // Path 4 (transición): turno cubierto en junio/julio 2026 sin registro → horas programadas
  if (!registro && turno.estado === 'cubierto' && esPeriodoTransicion(turno.fecha)) {
    return horasProgramadasTurno(turno)
  }

  // Path 5: en curso o sin datos suficientes
  return 0
}

// ── Resolución de origen ──────────────────────────────────────────────────────
// Determina quién creó o autorizó el registro, usando únicamente campos
// almacenados en registros_asistencia — sin consultas adicionales.
//
// Jerarquía de detección:
//   1. origen_cobertura identifica coberturas cargadas por supervisor/admin/saneamiento.
//   2. cierre_automatico identifica cierres del cron.
//   3. Presencia de campos _final indica corrección posterior.
//   4. Default: fichaje GPS del empleado.

function resolverOrigen(registro?: RegistroLiquidacion | null): {
  origenRegistro: string
  origenEtiqueta: string
  cargadoPorEmpleado: boolean
  cargadoPorSupervisor: boolean
  cargadoPorAdministracion: boolean
} {
  const oc = registro?.origen_cobertura ?? null

  if (oc === 'saneamiento_historico_julio_2026') {
    return { origenRegistro: 'saneamiento', origenEtiqueta: 'Saneamiento histórico', cargadoPorEmpleado: false, cargadoPorSupervisor: false, cargadoPorAdministracion: false }
  }
  if (oc === 'carga_supervisor' || oc === 'confirmacion_supervisor') {
    return { origenRegistro: 'supervisor', origenEtiqueta: 'Cargado por supervisor', cargadoPorEmpleado: false, cargadoPorSupervisor: true, cargadoPorAdministracion: false }
  }
  if (oc === 'carga_admin' || oc === 'confirmacion_admin') {
    return { origenRegistro: 'administracion', origenEtiqueta: 'Cargado por administración', cargadoPorEmpleado: false, cargadoPorSupervisor: false, cargadoPorAdministracion: true }
  }
  if (registro?.cierre_automatico === true) {
    return { origenRegistro: 'cierre_automatico', origenEtiqueta: 'Cierre automático', cargadoPorEmpleado: false, cargadoPorSupervisor: false, cargadoPorAdministracion: false }
  }
  // Corrección posterior (campos _final sin origen_cobertura explícito)
  const tieneCorreccion =
    registro?.hora_entrada_final != null ||
    registro?.hora_salida_final  != null ||
    registro?.guardia_final_id   != null ||
    registro?.objetivo_final_id  != null
  if (tieneCorreccion) {
    return { origenRegistro: 'corregido', origenEtiqueta: 'Registro corregido', cargadoPorEmpleado: false, cargadoPorSupervisor: false, cargadoPorAdministracion: false }
  }
  return { origenRegistro: 'empleado', origenEtiqueta: 'Fichado por el empleado', cargadoPorEmpleado: true, cargadoPorSupervisor: false, cargadoPorAdministracion: false }
}

// ── Línea completa de liquidación ─────────────────────────────────────────────
// Fuente única para Dashboard, Reportes, Mi Planilla y exportaciones XLSX.

export function resolverLineaLiquidacion(
  turno: TurnoLiquidacion,
  registro?: RegistroLiquidacion | null,
): LineaLiquidacion {
  const tieneEntrada = registro?.hora_entrada_real != null
  const tieneSalida  = registro?.hora_salida_real  != null
  const horasLiquidables = horasLiquidablesRegistro(turno, registro)
  const origen = !registro && horasLiquidables > 0
    ? { origenRegistro: 'transicion', origenEtiqueta: 'Turno cubierto (sin fichaje)', cargadoPorEmpleado: false, cargadoPorSupervisor: false, cargadoPorAdministracion: false }
    : resolverOrigen(registro)
  return {
    guardiaEfectivoId:        effectiveGuardia(registro),
    objetivoEfectivoId:       effectiveObjetivo(registro, turno),
    horaEntrada:              effectiveEntrada(registro),
    horaSalida:               effectiveSalida(registro),
    horasReales:              horasRealesRegistro(registro),
    horasLiquidables,
    horasTrabajadasOficiales: horasLiquidables,
    horasFichadasGPS:         tieneEntrada && tieneSalida ? Math.max(0, Number(registro?.horas_trabajadas) || 0) : 0,
    tieneEntrada,
    tieneSalida,
    tieneFichajeGPSCompleto:  tieneEntrada && tieneSalida,
    ...origen,
  }
}
