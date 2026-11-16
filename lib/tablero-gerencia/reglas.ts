/**
 * lib/tablero-gerencia/reglas.ts
 *
 * Catálogo de reglas de detección del Tablero de Gerencia.
 *
 * - `existente`: el sistema ya detecta el hecho hoy (Revisión Operativa,
 *   ronda_alertas, salidas_anticipadas, control de supervisiones). El tablero
 *   sólo lo muestra como caso; no cambia cómo se detecta.
 * - `propuesta`: regla NUEVA. No genera casos hasta que Gerencia la apruebe
 *   (tabla gestion_reglas, estado 'aprobada'). Ver `reglasQueDetectan`.
 *
 * Ninguna regla atribuye culpa: `causaProbable` sólo distingue causas
 * técnicas, de configuración o administrativas, y deja el resto como
 * 'indeterminada' hasta que una persona revise.
 */

import type { CausaProbable, Gravedad, TipoCaso } from './casos'

export type EstadoRegla = 'existente' | 'propuesta' | 'aprobada' | 'suspendida'
export type ResponsablePorDefecto = 'supervisor_zona' | 'jefe_supervisores' | 'administracion' | 'gerencia'

export interface ReglaDeteccion {
  codigo: string
  tipo: TipoCaso
  nombre: string
  /** Qué tabla/función produce el hecho. */
  fuente: string
  criterio: string
  umbral: Record<string, number>
  gravedad: Gravedad
  plazoHoras: number
  responsable: ResponsablePorDefecto
  estado: EstadoRegla
  /** Riesgo de falso positivo conocido (auditoría). */
  riesgo: string
}

export const CATALOGO_REGLAS: readonly ReglaDeteccion[] = [
  {
    codigo: 'ASI-01', tipo: 'sin_fichaje', nombre: 'Vigilador sin fichaje',
    fuente: 'turnos + registros_asistencia (lib/revision-operativa.ts evaluarSinFichar)',
    criterio: 'Turno con obligación sin registro de entrada pasados N minutos del inicio.',
    umbral: { minutos: 15 }, gravedad: 'alta', plazoHoras: 24, responsable: 'supervisor_zona',
    estado: 'existente', riesgo: 'Reasignaciones sin vincular (reemplaza_turno_id) generan falsos sin fichaje.',
  },
  {
    codigo: 'ASI-02', tipo: 'ingreso_tardio', nombre: 'Ingreso tardío',
    fuente: 'registros_asistencia.alerta_entrada = tarde (por registro_asistencia_id)',
    criterio: 'Entrada más de N minutos después del inicio programado.',
    umbral: { minutos: 5 }, gravedad: 'media', plazoHoras: 72, responsable: 'supervisor_zona',
    estado: 'existente', riesgo: 'Cambios de horario no reflejados en el turno.',
  },
  {
    codigo: 'ASI-03', tipo: 'salida_anticipada', nombre: 'Salida anticipada',
    fuente: 'salidas_anticipadas (estado detectada)',
    criterio: 'Salida registrada antes del fin programado.',
    umbral: { minutos: 15 }, gravedad: 'media', plazoHoras: 72, responsable: 'supervisor_zona',
    estado: 'existente', riesgo: '931 de 938 siguen en "detectada": muchas son relevos acordados.',
  },
  {
    codigo: 'ASI-04', tipo: 'sin_salida', nombre: 'Turno sin fichaje de salida',
    fuente: 'registros_asistencia sin hora_salida_real ni hora_salida_final',
    criterio: 'Turno terminado hace más de N minutos con entrada y sin salida.',
    umbral: { minutos: 60 }, gravedad: 'media', plazoHoras: 48, responsable: 'supervisor_zona',
    estado: 'propuesta', riesgo: 'Afecta horas: sin salida, la regla oficial liquida 0 h.',
  },
  {
    codigo: 'ASI-05', tipo: 'gps_fuera_radio', nombre: 'Fichaje fuera de radio',
    fuente: 'registros_asistencia.gps_ingreso_estado = fuera_radio',
    criterio: 'Fichaje con GPS fuera del radio del objetivo.',
    umbral: { metros: 0 }, gravedad: 'baja', plazoHoras: 72, responsable: 'supervisor_zona',
    estado: 'existente', riesgo: 'Coordenadas y radios mal cargados (auditoría oct #9). Nunca imputar conducta automáticamente.',
  },
  {
    codigo: 'COB-01', tipo: 'turno_sin_cobertura', nombre: 'Turno sin cobertura confirmada',
    fuente: 'turnos (estado descubierto) + escalamiento_whatsapp_envios',
    criterio: 'Turno con obligación vencido sin fichaje ni confirmación de cobertura.',
    umbral: { minutos: 30 }, gravedad: 'critica', plazoHoras: 4, responsable: 'jefe_supervisores',
    estado: 'existente', riesgo: 'Bajo: lo escala el WhatsApp de +15/+30 que ya funciona.',
  },
  {
    codigo: 'RON-01', tipo: 'ronda_incumplida', nombre: 'Ronda incumplida',
    fuente: 'ronda_alertas + ronda_ventanas_exigidas (foto inmutable desde 11/2026)',
    criterio: 'Ventana exigible sin ronda iniciada o finalizada.',
    umbral: {}, gravedad: 'media', plazoHoras: 24, responsable: 'supervisor_zona',
    estado: 'existente', riesgo: 'Antes de 11/2026 no hay foto de la exigencia: el historial se recalcula con la configuración actual.',
  },
  {
    codigo: 'SUP-01', tipo: 'supervision_vencida', nombre: 'Supervisión vencida',
    fuente: 'supervisiones + objetivos.frecuencia_supervision_horas (exigibilidadSupervision)',
    criterio: 'Objetivo activo exigible sin supervisión dentro de su frecuencia.',
    umbral: {}, gravedad: 'media', plazoHoras: 48, responsable: 'supervisor_zona',
    estado: 'existente', riesgo: 'LAROMET ROSARIO 2 duplicado: supervisiones no reconocidas.',
  },
  {
    codigo: 'HOR-01', tipo: 'diferencia_horas', nombre: 'Diferencia de horas a revisar',
    fuente: 'turnos + registros_asistencia (lib/liquidacion.ts)',
    criterio: 'Fichaje completo cuya duración real difiere más de N horas de la programada (se liquida la programada).',
    umbral: { horas: 1 }, gravedad: 'media', plazoHoras: 120, responsable: 'administracion',
    estado: 'propuesta', riesgo: 'Sólo revisión: no cambia horas ni liquidación.',
  },
  {
    codigo: 'HOR-02', tipo: 'diferencia_horas', nombre: 'Confirmación de asistencia sin fichaje',
    fuente: 'registros_asistencia.origen_cobertura = confirmacion_* sin hora_entrada_real',
    criterio: 'Horas liquidables cargadas por confirmación sin evidencia de fichaje.',
    umbral: {}, gravedad: 'alta', plazoHoras: 72, responsable: 'administracion',
    estado: 'propuesta', riesgo: 'Caso Eduardo Martínez / Lotuf (auditoría oct #10).',
  },
  {
    codigo: 'OBJ-01', tipo: 'objetivo_reincidente', nombre: 'Objetivo con problemas recurrentes',
    fuente: 'agregado de casos del mes',
    criterio: 'N o más casos (no descartados) del mismo objetivo en 30 días.',
    umbral: { casos: 10, dias: 30 }, gravedad: 'alta', plazoHoras: 168, responsable: 'jefe_supervisores',
    estado: 'propuesta', riesgo: 'Un punto de ronda mal configurado puede inflar un objetivo.',
  },
  {
    codigo: 'EXC-01', tipo: 'excepcion_reiterada', nombre: 'Excepciones de asistencia reiteradas',
    fuente: 'asistencia_excepciones_autorizadas',
    criterio: 'N o más excepciones autorizadas para el mismo vigilador en el mes.',
    umbral: { excepciones: 3 }, gravedad: 'media', plazoHoras: 168, responsable: 'gerencia',
    estado: 'propuesta', riesgo: 'Bajo.',
  },
  {
    codigo: 'PRG-01', tipo: 'programacion', nombre: 'Problema de programación',
    fuente: 'turnos_conflictos_confirmados + turnos (superposición, anulados trabajados)',
    criterio: 'Superposición o turno anulado con fichaje.',
    umbral: {}, gravedad: 'media', plazoHoras: 72, responsable: 'jefe_supervisores',
    estado: 'propuesta', riesgo: 'Causa administrativa: no imputar al vigilador.',
  },
  {
    codigo: 'ALR-01', tipo: 'alerta_sin_resolver', nombre: 'Caso sin resolver fuera de plazo',
    fuente: 'gestion_casos',
    criterio: 'Caso abierto con plazo vencido.',
    umbral: {}, gravedad: 'alta', plazoHoras: 24, responsable: 'gerencia',
    estado: 'propuesta', riesgo: 'Ninguno: es un control del propio circuito.',
  },
]

/** Reglas que hoy pueden crear casos: las existentes y las aprobadas por Gerencia. */
export function reglasQueDetectan(
  catalogo: readonly ReglaDeteccion[],
  aprobadas: ReadonlySet<string>,
  suspendidas: ReadonlySet<string> = new Set(),
): ReglaDeteccion[] {
  return catalogo.filter(r =>
    !suspendidas.has(r.codigo) && (r.estado === 'existente' || r.estado === 'aprobada' || aprobadas.has(r.codigo)),
  )
}

export interface SenalesCausa {
  gpsEstado?: string | null          // dentro_radio | fuera_radio | gps_no_disponible | objetivo_sin_gps
  precisionMetros?: number | null
  radioObjetivoMetros?: number | null
  objetivoSinCoordenadas?: boolean
  turnoAnuladoOReemplazado?: boolean
  cambioProgramacionPosterior?: boolean
  puntoConGpsCuestionado?: boolean   // punto de ronda con diagnóstico GPS pendiente
}

/**
 * Causa probable SIN atribuir conducta. Devuelve 'indeterminada' cuando no hay
 * una explicación técnica/administrativa; la conducta la decide una persona.
 */
export function causaProbable(s: SenalesCausa): CausaProbable {
  if (s.turnoAnuladoOReemplazado || s.cambioProgramacionPosterior) return 'administrativa'
  if (s.objetivoSinCoordenadas || s.gpsEstado === 'objetivo_sin_gps') return 'configuracion'
  if (s.puntoConGpsCuestionado) return 'configuracion'
  if (s.radioObjetivoMetros != null && s.radioObjetivoMetros > 0 && s.radioObjetivoMetros < 30) return 'configuracion'
  if (s.gpsEstado === 'gps_no_disponible') return 'tecnica_gps'
  if (s.gpsEstado === 'fuera_radio' && s.precisionMetros != null && s.radioObjetivoMetros != null
      && s.precisionMetros > s.radioObjetivoMetros) return 'tecnica_gps'
  return 'indeterminada'
}

const ORDEN: Gravedad[] = ['baja', 'media', 'alta', 'critica']

/** Sube un escalón por reincidencia (3+ en el mes) y no supera 'critica'. */
export function gravedadEfectiva(base: Gravedad, casosPreviosMes: number, causa: CausaProbable): Gravedad {
  // Una causa técnica/configuración/administrativa no agrava por reincidencia de la persona.
  if (causa !== 'indeterminada' && causa !== 'conducta') return base
  const i = ORDEN.indexOf(base) + (casosPreviosMes >= 3 ? 1 : 0)
  return ORDEN[Math.min(i, ORDEN.length - 1)]
}

/** Clave natural del caso: misma regla + mismo hecho = un solo caso. */
export function claveCaso(regla: string, ref: { registroId?: string | null; turnoId?: string | null; alertaId?: string | null; objetivoId?: string | null; periodo?: string | null; empleadoId?: string | null }): string {
  // Tardanza y GPS se identifican por registro_asistencia_id (AGENTS.md).
  const id = ref.alertaId ?? ref.registroId ?? ref.turnoId
    ?? [ref.objetivoId, ref.empleadoId, ref.periodo].filter(Boolean).join(':')
  return `${regla}|${id}`
}

export function plazoDesde(detectadoIso: string, plazoHoras: number): string {
  return new Date(Date.parse(detectadoIso) + plazoHoras * 3_600_000).toISOString()
}
