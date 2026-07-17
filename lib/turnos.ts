export type TurnoHorario = {
  id?: string | null
  guardia_id?: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  estado?: string | null
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

export const tieneTurnoSuperpuesto = (
  turnos: TurnoHorario[],
  candidato: TurnoHorario,
  excluirTurnoId?: string | null,
) => {
  if (!candidato.guardia_id) return false

  return turnos.some(turno => {
    if (!turno.guardia_id || turno.guardia_id !== candidato.guardia_id) return false
    if (excluirTurnoId && turno.id === excluirTurnoId) return false
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

// Un turno está sin cobertura operativa únicamente cuando no tiene guardia asignado.
// La falta de fichaje no equivale a descubierto: un guardia asignado que no fichó
// sigue siendo cobertura asignada y debe aparecer en "Sin fichar", no en "Descubiertos".
export const turnoSinCoberturaOperativa = (turno: TurnoHorario): boolean =>
  !turno.guardia_id

export const fechasVecinasTurno = (fecha: string) => {
  const base = fechaLocal(fecha)
  if (!base) return [fecha]

  return [-1, 0, 1].map(offset => {
    const candidata = new Date(base)
    candidata.setDate(base.getDate() + offset)
    return formatearFechaLocal(candidata)
  })
}
