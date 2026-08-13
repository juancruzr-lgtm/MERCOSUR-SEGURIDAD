export type TurnoHorario = {
  id?: string | null
  guardia_id?: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  estado?: string | null
  /** Necesario para descartar los turnos de objetivos pausados. */
  objetivo_id?: string | null
}

export const MENSAJE_TURNO_SUPERPUESTO = 'El guardia ya tiene un turno asignado en ese horario.'

export const FILTROS_FECHA_TURNOS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'manana', label: 'Mañana' },
  { id: 'proximos7', label: 'Próximos 7 días' },
  { id: 'mes', label: 'Mes actual' },
] as const

export type FiltroFechaTurnos = typeof FILTROS_FECHA_TURNOS[number]['id']

const MS_DIA = 24 * 60 * 60 * 1000
const MS_MINUTO = 60 * 1000
const MINUTOS_POSTERIORES_FICHAJE = 60

const fechaLocal = (fecha: string) => {
  const [anio, mes, dia] = fecha.split('-').map(Number)
  if (!anio || !mes || !dia) return null
  return new Date(anio, mes - 1, dia)
}

const formatearFechaLocal = (fecha: Date) => {
  const anio = fecha.getFullYear()
  const mes = String(fecha.getMonth() + 1).padStart(2, '0')
  const dia = String(fecha.getDate()).padStart(2, '0')
  return `${anio}-${mes}-${dia}`
}

export const fechaActualTurno = () => formatearFechaLocal(new Date())

export const sumarDiasFecha = (fecha: string, dias: number) => {
  const base = fechaLocal(fecha)
  if (!base) return fecha

  const resultado = new Date(base)
  resultado.setDate(base.getDate() + dias)
  return formatearFechaLocal(resultado)
}

export const rangoFiltroFechaTurnos = (filtro: FiltroFechaTurnos, baseFecha = fechaActualTurno()) => {
  const base = fechaLocal(baseFecha) || new Date()

  if (filtro === 'manana') {
    const manana = sumarDiasFecha(formatearFechaLocal(base), 1)
    return { desde: manana, hasta: manana, label: 'Mañana' }
  }

  if (filtro === 'proximos7') {
    const desde = formatearFechaLocal(base)
    return { desde, hasta: sumarDiasFecha(desde, 6), label: 'Próximos 7 días' }
  }

  if (filtro === 'mes') {
    const desde = formatearFechaLocal(new Date(base.getFullYear(), base.getMonth(), 1))
    const hasta = formatearFechaLocal(new Date(base.getFullYear(), base.getMonth() + 1, 0))
    return { desde, hasta, label: 'Mes actual' }
  }

  const hoy = formatearFechaLocal(base)
  return { desde: hoy, hasta: hoy, label: 'Hoy' }
}

export const filtroFechaTurnosIncluye = (
  filtro: FiltroFechaTurnos,
  fecha: string,
  baseFecha = fechaActualTurno(),
) => {
  const rango = rangoFiltroFechaTurnos(filtro, baseFecha)
  return fecha >= rango.desde && fecha <= rango.hasta
}

export const filtroFechaTurnosParaFecha = (
  fecha: string,
  baseFecha = fechaActualTurno(),
): FiltroFechaTurnos => {
  if (filtroFechaTurnosIncluye('hoy', fecha, baseFecha)) return 'hoy'
  if (filtroFechaTurnosIncluye('manana', fecha, baseFecha)) return 'manana'
  if (filtroFechaTurnosIncluye('proximos7', fecha, baseFecha)) return 'proximos7'
  return 'mes'
}

const fechaHoraLocal = (fecha: string, hora: string) => {
  const base = fechaLocal(fecha)
  if (!base) return null

  const [horas, minutos] = hora.split(':').map(Number)
  if (!Number.isFinite(horas) || !Number.isFinite(minutos)) return null

  base.setHours(horas, minutos, 0, 0)
  return base.getTime()
}

export const rangoTurno = (turno: TurnoHorario) => {
  const inicio = fechaHoraLocal(turno.fecha, turno.hora_inicio)
  let fin = fechaHoraLocal(turno.fecha, turno.hora_fin)

  if (inicio === null || fin === null) return null
  if (fin <= inicio) fin += MS_DIA

  return { inicio, fin }
}

export function horariosSuperpuestos(turnoA: TurnoHorario, turnoB: TurnoHorario) {
  const rangoA = rangoTurno(turnoA)
  const rangoB = rangoTurno(turnoB)

  if (!rangoA || !rangoB) return false
  return rangoA.inicio < rangoB.fin && rangoB.inicio < rangoA.fin
}

/**
 * Ids de los objetivos que no están operativos. Se arma una vez y se pasa a
 * tieneTurnoSuperpuesto; evita recorrer la lista de objetivos por cada turno.
 */
export const idsObjetivosPausados = (
  objetivos?: { id: string; estado?: string | null }[] | null,
): Set<string> =>
  new Set((objetivos ?? []).filter(o => !objetivoEstaOperativo(o)).map(o => o.id))

/**
 * Comprobación previa de superposición, del lado del cliente. La autoridad es
 * asignar_vigilador_turnos en el servidor; esto sólo evita el viaje de ida.
 *
 * `objetivosPausados` descarta los turnos de objetivos fuera de operación: un
 * vigilador con un turno en un objetivo pausado NO está ocupado, porque no va a
 * ir a trabajar ahí. Mismo criterio que aplica la RPC con `o2.estado = 'activo'`.
 *
 * Requiere que los turnos traigan `objetivo_id`. Si no lo traen, no se descarta
 * ninguno: sin el dato se prefiere advertir de más antes que dejar pasar una
 * superposición real. La RPC decide igual.
 */
export const tieneTurnoSuperpuesto = (
  turnos: TurnoHorario[],
  candidato: TurnoHorario,
  excluirTurnoId?: string | null,
  objetivosPausados?: Set<string> | null,
) => {
  if (!candidato.guardia_id) return false

  return turnos.some(turno => {
    if (!turno.guardia_id || turno.guardia_id !== candidato.guardia_id) return false
    if (excluirTurnoId && turno.id === excluirTurnoId) return false
    if (objetivosPausados && turno.objetivo_id && objetivosPausados.has(turno.objetivo_id)) return false
    return horariosSuperpuestos(turno, candidato)
  })
}

// Devuelve true si el turno está activo en el instante dado.
// Maneja turnos nocturnos (hora_fin <= hora_inicio → cruza medianoche).
export const turnoEsActivo = (turno: TurnoHorario, ahora = new Date()): boolean => {
  const rango = rangoTurno(turno)
  if (!rango) return false
  const ts = ahora.getTime()
  return ts >= rango.inicio && ts <= rango.fin
}

// Devuelve true si el turno es nocturno (hora_fin <= hora_inicio → cruza medianoche).
// Misma regla que el filtro inline de GuardiaMobile y SupervisorMobile.
export const esTurnoNocturno = (turno: { hora_inicio: string; hora_fin: string }): boolean => {
  const [hI, mI] = turno.hora_inicio.split(':').map(Number)
  const [hF, mF] = turno.hora_fin.split(':').map(Number)
  return (hF * 60 + mF) <= (hI * 60 + mI)
}

export const pasoVentanaFichaje = (turno: TurnoHorario, ahora = new Date()) => {
  const inicio = fechaHoraLocal(turno.fecha, turno.hora_inicio)
  if (inicio === null) return false

  return ahora.getTime() > inicio + MINUTOS_POSTERIORES_FICHAJE * MS_MINUTO
}

// Tipo mínimo que representa un registro de asistencia con los campos necesarios
// para determinar si hay una entrada confirmada (fichaje original o corrección final).
export type RegistroEntrada = {
  tipo_registro?: string | null
  hora_entrada_real?: string | null
  hora_entrada_final?: string | null
}

// Devuelve true si el registro representa una entrada efectivamente confirmada.
// Excluye ausencias. Considera tanto fichaje original como corrección del supervisor.
export const registroTieneEntradaConfirmada = (r: RegistroEntrada): boolean =>
  r.tipo_registro !== 'ausencia' && !!(r.hora_entrada_final || r.hora_entrada_real)

// Estados que cierran el turno sin que quede puesto a cubrir. Un turno en
// alguno de estos estados queda con guardia_id en null por diseño: la cobertura
// se resolvió en otro lado (otro turno lo reemplaza) o dejó de corresponder.
// Contarlos como descubiertos genera alertas de un puesto que ya está resuelto.
export const ESTADOS_TURNO_SIN_OBLIGACION_COBERTURA = ['reemplazado', 'anulado', 'cancelado'] as const

export const turnoTieneObligacionDeCobertura = (turno: TurnoHorario): boolean =>
  !ESTADOS_TURNO_SIN_OBLIGACION_COBERTURA.includes(
    (turno.estado ?? '') as typeof ESTADOS_TURNO_SIN_OBLIGACION_COBERTURA[number],
  )

// Un turno está sin cobertura operativa cuando no tiene guardia asignado Y
// además todavía debía cubrirse.
//
// La falta de fichaje no equivale a descubierto: un guardia asignado que no fichó
// sigue siendo cobertura asignada y debe aparecer en "Sin fichar", no en "Descubiertos".
// Un turno reemplazado tampoco lo es: quedó sin guardia justamente porque la
// cobertura pasó a otro turno.
export const turnoSinCoberturaOperativa = (turno: TurnoHorario): boolean =>
  !turno.guardia_id && turnoTieneObligacionDeCobertura(turno)

// ── Objetivo pausado ─────────────────────────────────────────────────────────
//
// Pausar o suspender un objetivo es, en la base, `objetivos.estado = 'inactivo'`:
// el CHECK sólo admite 'activo' e 'inactivo', no hay un estado "pausado" aparte.
// Este es el ÚNICO criterio de objetivo operativo; el espejo SQL es
// `o.estado = 'activo'` en rondas_ventanas_programadas y en
// asignar_vigilador_turnos. No agregar una segunda noción en otro lado.
//
// Mientras está pausado, sus turnos se conservan en la base pero no generan
// obligaciones: ni cobertura, ni ronda, ni conflicto de asignación.
export interface ObjetivoOperativo {
  estado?: string | null
}

/**
 * Sin dato de objetivo se asume operativo: quien no puede resolverlo no debe
 * silenciar alertas por las dudas. El filtro se aplica donde el objetivo se
 * conoce, y ahí sí es taxativo.
 */
export const objetivoEstaOperativo = (objetivo?: ObjetivoOperativo | null): boolean =>
  (objetivo?.estado ?? 'activo') === 'activo'

/**
 * Obligación de cobertura completa: el turno la tiene Y el objetivo está
 * operativo. Es lo que decide si un turno sin guardia es un puesto descubierto
 * de verdad o un turno guardado de un objetivo pausado.
 */
export const turnoSinCoberturaEnObjetivoOperativo = (
  turno: TurnoHorario,
  objetivo?: ObjetivoOperativo | null,
): boolean => objetivoEstaOperativo(objetivo) && turnoSinCoberturaOperativa(turno)

export const fechasVecinasTurno = (fecha: string) => {
  const base = fechaLocal(fecha)
  if (!base) return [fecha]

  return [-1, 0, 1].map(offset => {
    const candidata = new Date(base)
    candidata.setDate(base.getDate() + offset)
    return formatearFechaLocal(candidata)
  })
}
