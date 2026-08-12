export type TipoAlertaOperativa =
  | 'sin_fichar'
  | 'tardanza'
  | 'fuera_radio'
  | 'descubierto'
  | 'salida_pendiente'

export type AccionIntervencionOperativa =
  | 'comentario'
  | 'reasignacion'
  | 'marcado_descubierto'
  | 'confirmar_cubierto'
  | 'marcado_cubierto_manual'
  | 'alerta_revisada'
  | 'reapertura'
  | 'anulacion_cobertura'
  | 'confirmar_asistencia'

export type EstadoCicloVidaAlerta =
  | 'pendiente'
  | 'atendida_condicion_vigente'
  | 'resuelta_operativamente'
  | 'reabierta'
  | 'cerrada'

export interface TurnoDetectorOperativo {
  id: string
  objetivo_id: string
  puesto_id?: string | null
  guardia_id?: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  estado?: string | null
}

export interface RegistroDetectorOperativo {
  id: string
  turno_id: string
  guardia_id?: string | null
  tipo_registro?: string | null
  hora_entrada_real?: string | null
  hora_entrada_final?: string | null
  hora_salida_real?: string | null
  hora_salida_final?: string | null
  alerta_entrada?: string | null
  gps_ingreso_estado?: string | null
}

export interface AlertaOperativaDetectada {
  tipo_alerta: TipoAlertaOperativa
  turno_id: string
  registro_asistencia_id: string | null
  objetivo_id: string
  puesto_id: string | null
  guardia_id: string | null
  detectada_at: string
  condicion_vigente: true
}

export interface UmbralesDetectorOperativo {
  sin_fichar_minutos: number
  tardanza_minutos: number
  gps_estado_fuera_radio: string
  salida_pendiente_minutos: number
}

export const UMBRALES_ALERTAS_OPERATIVAS: UmbralesDetectorOperativo = {
  sin_fichar_minutos: 15,
  tardanza_minutos: 5,
  gps_estado_fuera_radio: 'fuera_radio',
  salida_pendiente_minutos: 15,
}

export interface IntervencionOperativaBase {
  id: string
  turno_id: string
  tipo_alerta: TipoAlertaOperativa | string
  accion: AccionIntervencionOperativa | string
  registro_asistencia_id?: string | null
  created_at: string
  secuencia_evento?: number | string | null
}

const TIPOS_CON_IDENTIDAD_DE_REGISTRO = new Set<TipoAlertaOperativa>([
  'tardanza',
  'fuera_radio',
])

const ACCIONES_RESOLUTIVAS = new Set<AccionIntervencionOperativa>([
  'reasignacion',
  'marcado_descubierto',
  'confirmar_cubierto',
  'marcado_cubierto_manual',
  'alerta_revisada',
  'confirmar_asistencia',
])

const ACCIONES_ATENCION = new Set<AccionIntervencionOperativa>([
  'reasignacion',
  'marcado_descubierto',
  'confirmar_cubierto',
  'marcado_cubierto_manual',
  'alerta_revisada',
  'confirmar_asistencia',
])

export const ESTADOS_SIN_OBLIGACION = new Set(['reemplazado', 'anulado', 'cancelado'])
const MS_MINUTO = 60_000
const MS_DIA = 24 * 60 * MS_MINUTO

// Argentina usa UTC-03:00 sin horario de verano en la operación actual. Se
// construyen instantes explícitos para que el detector no dependa de la zona
// configurada en el navegador o en el proceso que lo ejecute.
function instanteArgentina(fecha: string, hora: string) {
  const [anio, mes, dia] = fecha.slice(0, 10).split('-').map(Number)
  const [horas, minutos, segundos = 0] = hora.split(':').map(Number)
  if (![anio, mes, dia, horas, minutos, segundos].every(Number.isFinite)) return null
  return Date.UTC(anio, mes - 1, dia, horas + 3, minutos, segundos)
}

function rangoTurnoArgentina(turno: TurnoDetectorOperativo) {
  const inicio = instanteArgentina(turno.fecha, turno.hora_inicio)
  let fin = instanteArgentina(turno.fecha, turno.hora_fin)
  if (inicio === null || fin === null) return null
  if (fin <= inicio) fin += MS_DIA
  return { inicio, fin }
}

function minutosHora(hora?: string | null) {
  if (!hora) return null
  const [horas, minutos] = hora.split(':').map(Number)
  if (!Number.isFinite(horas) || !Number.isFinite(minutos)) return null
  return horas * 60 + minutos
}

function minutosTardanza(turno: TurnoDetectorOperativo, registro: RegistroDetectorOperativo) {
  const inicio = minutosHora(turno.hora_inicio)
  const entrada = minutosHora(registro.hora_entrada_final || registro.hora_entrada_real)
  if (inicio === null || entrada === null) return 0
  let diferencia = entrada - inicio
  if (minutosHora(turno.hora_fin)! <= inicio && diferencia < -720) diferencia += 1440
  return diferencia
}

export function calcularMinutosTardanza(horaInicio: string, horaFin: string, horaEntrada: string): number {
  const inicio = minutosHora(horaInicio)
  const entrada = minutosHora(horaEntrada)
  if (inicio === null || entrada === null) return 0
  let diferencia = entrada - inicio
  const fin = minutosHora(horaFin)
  if (fin !== null && fin <= inicio && diferencia < -720) diferencia += 1440
  return Math.max(0, diferencia)
}

export function calcularMinutosTardanzaRegistro(
  turno: { hora_inicio: string; hora_fin: string },
  registro?: { hora_entrada_final?: string | null; hora_entrada_real?: string | null } | null,
): number {
  const horaEntrada = registro?.hora_entrada_final ?? registro?.hora_entrada_real
  if (!horaEntrada) return 0
  return calcularMinutosTardanza(turno.hora_inicio, turno.hora_fin, horaEntrada)
}

export function formatCuil(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 11) return raw
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
}

export function detectarAlertasOperativas({
  turnos,
  registros,
  objetivos,
  ahora = new Date(),
  umbrales = UMBRALES_ALERTAS_OPERATIVAS,
}: {
  turnos: TurnoDetectorOperativo[]
  registros: RegistroDetectorOperativo[]
  /**
   * Estado de los objetivos. Si se pasa, los turnos de un objetivo pausado
   * (estado <> 'activo') no generan ninguna alerta: sus turnos se conservan
   * pero quedan fuera de la operación.
   *
   * Es opcional para no romper a quien todavía no lo pase, pero omitirlo
   * significa "no sé el estado", no "están todos activos": quien tenga el dato
   * debe pasarlo. Mismo criterio que aplica el servidor en
   * rondas_ventanas_programadas y en asignar_vigilador_turnos.
   */
  objetivos?: { id: string; estado?: string | null }[]
  ahora?: Date
  umbrales?: UmbralesDetectorOperativo
}): AlertaOperativaDetectada[] {
  const objetivoPausado = new Set(
    (objetivos ?? []).filter(o => (o.estado ?? 'activo') !== 'activo').map(o => o.id),
  )
  const ahoraMs = ahora.getTime()
  const registrosPorTurno = new Map<string, RegistroDetectorOperativo[]>()
  for (const registro of registros) {
    const existentes = registrosPorTurno.get(registro.turno_id) || []
    existentes.push(registro)
    registrosPorTurno.set(registro.turno_id, existentes)
  }

  const alertas: AlertaOperativaDetectada[] = []
  const agregar = (
    turno: TurnoDetectorOperativo,
    tipo: TipoAlertaOperativa,
    detectadaMs: number,
    registro?: RegistroDetectorOperativo,
  ) => alertas.push({
    tipo_alerta: tipo,
    turno_id: turno.id,
    registro_asistencia_id: registro?.id || null,
    objetivo_id: turno.objetivo_id,
    puesto_id: turno.puesto_id || null,
    guardia_id: registro?.guardia_id || turno.guardia_id || null,
    detectada_at: new Date(detectadaMs).toISOString(),
    condicion_vigente: true,
  })

  for (const turno of turnos) {
    const rango = rangoTurnoArgentina(turno)
    if (!rango || ESTADOS_SIN_OBLIGACION.has(turno.estado || '')) continue
    // Objetivo pausado: ninguna de las cuatro alertas de este detector
    // —descubierto, sin fichar, tardanza, fuera de radio— corresponde, porque
    // las cuatro derivan de que el objetivo esté operativo.
    if (objetivoPausado.has(turno.objetivo_id)) continue
    const registrosTurno = registrosPorTurno.get(turno.id) || []
    const registrosValidos = registrosTurno.filter((registro) => registro.tipo_registro !== 'ausencia')
    const tieneEntrada = registrosValidos.some((registro) => Boolean(registro.hora_entrada_final || registro.hora_entrada_real))
    const tieneSalida = registrosValidos.some((registro) => Boolean(registro.hora_salida_final || registro.hora_salida_real))

    if (!turno.guardia_id && ahoraMs >= rango.inicio) {
      agregar(turno, 'descubierto', rango.inicio)
    } else if (
      turno.guardia_id &&
      turno.estado !== 'descubierto' &&
      !tieneEntrada &&
      ahoraMs >= rango.inicio + umbrales.sin_fichar_minutos * MS_MINUTO
    ) {
      agregar(turno, 'sin_fichar', rango.inicio + umbrales.sin_fichar_minutos * MS_MINUTO)
    }

    for (const registro of registrosValidos) {
      const entrada = registro.hora_entrada_final || registro.hora_entrada_real
      if (entrada && (registro.alerta_entrada === 'tarde' || minutosTardanza(turno, registro) > umbrales.tardanza_minutos)) {
        agregar(turno, 'tardanza', rango.inicio + umbrales.tardanza_minutos * MS_MINUTO, registro)
      }
      if (registro.gps_ingreso_estado === umbrales.gps_estado_fuera_radio) {
        agregar(turno, 'fuera_radio', rango.inicio, registro)
      }
    }

    if (turno.guardia_id && tieneEntrada && !tieneSalida && ahoraMs >= rango.fin + umbrales.salida_pendiente_minutos * MS_MINUTO) {
      const registroEntrada = registrosValidos.find((registro) => registro.hora_entrada_final || registro.hora_entrada_real)
      agregar(turno, 'salida_pendiente', rango.fin + umbrales.salida_pendiente_minutos * MS_MINUTO, registroEntrada)
    }
  }

  return alertas.sort((a, b) => a.detectada_at.localeCompare(b.detectada_at) ||
    claveOcurrenciaAlerta(a.turno_id, a.tipo_alerta, a.registro_asistencia_id)
      .localeCompare(claveOcurrenciaAlerta(b.turno_id, b.tipo_alerta, b.registro_asistencia_id)))
}

export function claveOcurrenciaAlerta(
  turnoId: string,
  tipo: TipoAlertaOperativa,
  registroAsistenciaId?: string | null
) {
  const identidadRegistro = TIPOS_CON_IDENTIDAD_DE_REGISTRO.has(tipo)
    ? registroAsistenciaId || 'sin-registro'
    : 'turno'

  return `${turnoId}:${tipo}:${identidadRegistro}`
}

export function compararIntervencionesMasReciente<
  T extends Pick<IntervencionOperativaBase, 'id' | 'created_at' | 'secuencia_evento'>
>(a: T, b: T) {
  const secuenciaA = a.secuencia_evento == null ? null : Number(a.secuencia_evento)
  const secuenciaB = b.secuencia_evento == null ? null : Number(b.secuencia_evento)
  if (secuenciaA !== null && secuenciaB !== null && secuenciaA !== secuenciaB) {
    return secuenciaB - secuenciaA
  }
  const diferenciaFecha = new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  return diferenciaFecha || b.id.localeCompare(a.id)
}

export function intervencionesDeOcurrencia<T extends IntervencionOperativaBase>(
  intervenciones: T[],
  turnoId: string,
  tipo: TipoAlertaOperativa,
  registroAsistenciaId?: string | null
) {
  return intervenciones
    .filter((intervencion) => {
      if (intervencion.turno_id !== turnoId || intervencion.tipo_alerta !== tipo) {
        return false
      }

      if (!TIPOS_CON_IDENTIDAD_DE_REGISTRO.has(tipo)) return true
      return intervencion.registro_asistencia_id === registroAsistenciaId
    })
    .sort(compararIntervencionesMasReciente)
}

export function alertaEstaIntervenida<T extends IntervencionOperativaBase>(
  intervenciones: T[],
  turnoId: string,
  tipo: TipoAlertaOperativa,
  registroAsistenciaId?: string | null
) {
  const ultima = intervencionesDeOcurrencia(
    intervenciones,
    turnoId,
    tipo,
    registroAsistenciaId
  ).find((intervencion) => intervencion.accion !== 'comentario')

  // Reasignar un turno sin fichaje cambia al guardia esperado, pero no acredita
  // que el reemplazo haya ingresado. Mientras el detector siga encontrando la
  // falta de entrada, la alerta debe permanecer pendiente.
  if (tipo === 'sin_fichar' && ultima?.accion === 'reasignacion') return false

  return Boolean(ultima && ultima.accion !== 'reapertura' && ACCIONES_RESOLUTIVAS.has(
    ultima.accion as AccionIntervencionOperativa
  ))
}

export function estadoCicloVidaAlerta<T extends IntervencionOperativaBase>({
  intervenciones,
  turnoId,
  tipo,
  registroAsistenciaId,
  condicionVigente,
}: {
  intervenciones: T[]
  turnoId: string
  tipo: TipoAlertaOperativa
  registroAsistenciaId?: string | null
  condicionVigente: boolean
}): EstadoCicloVidaAlerta {
  const ultima = intervencionesDeOcurrencia(
    intervenciones,
    turnoId,
    tipo,
    registroAsistenciaId,
  ).find((intervencion) => intervencion.accion !== 'comentario')

  if (ultima?.accion === 'cierre') return 'cerrada'
  if (ultima?.accion === 'reapertura') return 'reabierta'
  if (!condicionVigente) return 'resuelta_operativamente'
  if (ultima && ACCIONES_ATENCION.has(ultima.accion as AccionIntervencionOperativa)) {
    return 'atendida_condicion_vigente'
  }
  return 'pendiente'
}

export function efectoIntervencionOperativa(accion: string) {
  const efectos: Record<string, string> = {
    comentario: 'Sin cambio operativo; agrega trazabilidad.',
    reasignacion: 'Cambia el guardia asignado; no acredita fichaje.',
    marcado_descubierto: 'Quita la asignación y mantiene el puesto descubierto.',
    confirmar_cubierto: 'Crea asistencia manual y asigna horas liquidables programadas.',
    marcado_cubierto_manual: 'Creó asistencia manual con impacto liquidable.',
    alerta_revisada: 'Registra atención o justificación; la condición original puede seguir vigente.',
    reapertura: 'Reabre el seguimiento; no revierte turno, asistencia ni liquidación.',
    anulacion_cobertura: 'Invalida la cobertura manual para liquidación sin borrar historial.',
    confirmar_asistencia: 'El supervisor confirmó asistencia del vigilador. No acredita fichaje ni afecta liquidación.',
    cierre: 'Cierra administrativamente la alerta.',
  }
  return efectos[accion] || 'Evento registrado sin efecto estructurado conocido.'
}
