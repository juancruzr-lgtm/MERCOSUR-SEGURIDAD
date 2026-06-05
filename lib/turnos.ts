export type TurnoHorario = {
  id?: string | null
  guardia_id?: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
}

export const MENSAJE_TURNO_SUPERPUESTO = 'El guardia ya tiene un turno asignado en ese horario.'

const MS_DIA = 24 * 60 * 60 * 1000

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

const fechaHoraLocal = (fecha: string, hora: string) => {
  const base = fechaLocal(fecha)
  if (!base) return null

  const [horas, minutos] = hora.split(':').map(Number)
  if (!Number.isFinite(horas) || !Number.isFinite(minutos)) return null

  base.setHours(horas, minutos, 0, 0)
  return base.getTime()
}

const rangoTurno = (turno: TurnoHorario) => {
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

export const fechasVecinasTurno = (fecha: string) => {
  const base = fechaLocal(fecha)
  if (!base) return [fecha]

  return [-1, 0, 1].map(offset => {
    const candidata = new Date(base)
    candidata.setDate(base.getDate() + offset)
    return formatearFechaLocal(candidata)
  })
}
