'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { activarNotificacionesPush } from '@/lib/push-client'
import { FILTROS_FECHA_TURNOS, MENSAJE_TURNO_SUPERPUESTO, fechasVecinasTurno, fechaActualTurno, filtroFechaTurnosIncluye, filtroFechaTurnosParaFecha, rangoFiltroFechaTurnos, sumarDiasFecha, tieneTurnoSuperpuesto } from '@/lib/turnos'
import type { FiltroFechaTurnos } from '@/lib/turnos'

type EstadoTurno = 'programado' | 'pendiente de ingreso' | 'tardanza' | 'cubierto' | 'en turno' | 'finalizado' | 'descubierto' | 'reasignado'
type EstadoTurnoPersistido = 'programado' | 'cubierto' | 'descubierto'
type TipoAlerta = 'sin entrada' | 'sin ingreso' | 'entrada registrada' | 'salida registrada' | 'turno descubierto' | 'ingreso tarde' | 'reasignado'
type TipoAlertaOperativa = 'sin_fichar' | 'tardanza' | 'fuera_radio' | 'descubierto'
type AccionIntervencion = 'comentario' | 'reasignacion' | 'marcado_descubierto' | 'confirmar_cubierto' | 'marcado_cubierto_manual' | 'alerta_revisada'
type TipoSolicitudAdmin = 'crear_objetivo' | 'baja_objetivo' | 'crear_vigilador' | 'baja_vigilador'

const ZONA_OPERATIVA = 'Rosario / General'
const JEFE_OPERATIVO = 'Aldo Monzón'
const DIRECTOR_TECNICO = 'Rodolfo Romero'

interface Turno {
  id: string
  guardia_id: string | null
  guardia_original_id?: string | null
  objetivo_id: string
  fecha: string
  hora_inicio: string
  hora_fin: string
  estado: EstadoTurnoPersistido
  tipo_evento?: string
}

interface Usuario {
  id: string
  nombre: string
  apellido: string
  legajo?: string
  email?: string
  foto_url?: string
  telefono?: string
  rol: string
  estado: string
}

interface Objetivo {
  id: string
  nombre: string
  cliente?: string
  direccion?: string
  lat?: number | null
  lng?: number | null
  radio_metros?: number | null
  estado?: string
}

interface RegistroAsistencia {
  id: string
  turno_id: string
  guardia_id: string
  hora_entrada_real?: string | null
  hora_salida_real?: string | null
  horas_trabajadas?: number | null
  latitud_ingreso?: number | string | null
  longitud_ingreso?: number | string | null
  precision_ingreso?: number | string | null
  latitud_egreso?: number | string | null
  longitud_egreso?: number | string | null
  precision_egreso?: number | string | null
  lat_entrada?: number | string | null
  lng_entrada?: number | string | null
  lat_salida?: number | string | null
  lng_salida?: number | string | null
  distancia_ingreso_metros?: number | string | null
  gps_ingreso_estado?: string | null
  distancia_egreso_metros?: number | string | null
  gps_egreso_estado?: string | null
  alerta_entrada?: string | null
  created_at?: string
}

interface SupervisorIntervencion {
  id: string
  turno_id: string
  registro_asistencia_id?: string | null
  supervisor_id: string
  supervisor_asignado_id?: string | null
  supervisor_intervino_id?: string | null
  supervisor_guardia_id?: string | null
  jefe_operativo?: string | null
  director_tecnico?: string | null
  zona?: string | null
  tipo_alerta: TipoAlertaOperativa | string
  accion: AccionIntervencion | string
  comentario?: string | null
  motivo?: string | null
  guardia_anterior_id?: string | null
  guardia_nuevo_id?: string | null
  estado_anterior?: string | null
  estado_nuevo?: string | null
  created_at: string
}

interface SupervisorGuardia {
  id: string
  supervisor_id: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  zona: string
  rol_operativo: string
  estado: string
  observacion?: string | null
  creado_por?: string | null
  created_at?: string
}

interface SolicitudAdmin {
  id: string
  solicitante_id: string
  tipo: TipoSolicitudAdmin
  entidad: string
  entidad_id?: string | null
  datos_json: Record<string, any> | null
  estado: 'pendiente' | 'aprobado' | 'rechazado'
  aprobado_por?: string | null
  fecha_aprobacion?: string | null
  comentario_admin?: string | null
  created_at: string
}

interface AccionAlertaActiva {
  turnoId: string
  tipoAlerta: TipoAlertaOperativa
  accion: AccionIntervencion
  registroId?: string | null
}

interface AlertaIntervenida {
  turno: Turno
  tipoAlerta: TipoAlertaOperativa
  intervencion: SupervisorIntervencion
}

function fechaHoy(): string {
  return fechaActualTurno()
}

function horaCorta(hora?: string | null): string {
  return hora ? hora.slice(0, 5) : '--:--'
}

function fechaHoraEnRango(fecha: string, hora: string, fechaInicio: string, horaInicio: string, horaFin: string): boolean {
  const valor = fechaHoraTurno(fecha, hora)
  const inicio = fechaHoraTurno(fechaInicio, horaInicio)
  const fin = fechaHoraTurno(fechaInicio, horaFin)

  if (!valor || !inicio || !fin) return false
  if (fin <= inicio) fin.setDate(fin.getDate() + 1)

  return valor >= inicio && valor < fin
}

function esTipoAlertaOperativa(value?: string | null): value is TipoAlertaOperativa {
  return value === 'sin_fichar' || value === 'tardanza' || value === 'fuera_radio' || value === 'descubierto'
}

function accionNormalizada(accion?: string | null): string {
  return accion === 'marcado_cubierto_manual' ? 'confirmar_cubierto' : accion || ''
}

function accionResuelveAlerta(accion?: string | null): boolean {
  return ['confirmar_cubierto', 'reasignacion', 'marcado_descubierto', 'alerta_revisada'].includes(accionNormalizada(accion))
}

function horasCortas(horas?: number | null): string {
  if (horas === null || horas === undefined) return '--'
  return `${Number(horas).toLocaleString('es-AR', { maximumFractionDigits: 2 })} h`
}

function fechaDDMMYYYY(fecha?: string | null): string {
  if (!fecha) return '—'

  const [year, month, day] = fecha.slice(0, 10).split('-')
  return year && month && day ? `${day}/${month}/${year}` : '—'
}

function fechaHoraDDMMYYYY(fecha?: string | null): string {
  if (!fecha) return '—'

  return new Date(fecha).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fechaHoraTurno(fecha: string, hora: string): Date | null {
  const [year, month, day] = fecha.slice(0, 10).split('-').map(Number)
  const [hours, minutes, seconds = 0] = hora.split(':').map(Number)

  if (![year, month, day, hours, minutes, seconds].every(Number.isFinite)) return null

  return new Date(year, month - 1, day, hours, minutes, seconds)
}

function minutosAtrasoTurno(turno: Turno, ahora = new Date()): number {
  const inicioTurno = fechaHoraTurno(turno.fecha, turno.hora_inicio)
  if (!inicioTurno) return 0

  return Math.max(0, Math.floor((ahora.getTime() - inicioTurno.getTime()) / 60000))
}

function fechaEntradaReal(turno: Turno, horaEntrada?: string | null): Date | null {
  if (!horaEntrada) return null

  const inicioTurno = fechaHoraTurno(turno.fecha, turno.hora_inicio)
  const finTurno = fechaHoraTurno(turno.fecha, turno.hora_fin)
  const entradaReal = fechaHoraTurno(turno.fecha, horaEntrada)
  if (!inicioTurno || !finTurno || !entradaReal) return null

  if (finTurno <= inicioTurno && entradaReal < inicioTurno) {
    entradaReal.setDate(entradaReal.getDate() + 1)
  }

  return entradaReal
}

function minutosTardeRegistro(turno: Turno, registro?: RegistroAsistencia): number {
  const inicioTurno = fechaHoraTurno(turno.fecha, turno.hora_inicio)
  const entradaReal = fechaEntradaReal(turno, registro?.hora_entrada_real)
  if (!inicioTurno || !entradaReal) return 0

  return Math.max(0, Math.floor((entradaReal.getTime() - inicioTurno.getTime()) / 60000))
}

function numeroGps(value: unknown): number | null {
  const numero = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(numero) ? numero : null
}

function gpsRegistro(registro: RegistroAsistencia | undefined, tipo: 'ingreso' | 'egreso') {
  if (!registro) return null

  const lat = tipo === 'ingreso'
    ? numeroGps(registro.latitud_ingreso ?? registro.lat_entrada)
    : numeroGps(registro.latitud_egreso ?? registro.lat_salida)
  const lng = tipo === 'ingreso'
    ? numeroGps(registro.longitud_ingreso ?? registro.lng_entrada)
    : numeroGps(registro.longitud_egreso ?? registro.lng_salida)
  const precision = tipo === 'ingreso'
    ? numeroGps(registro.precision_ingreso)
    : numeroGps(registro.precision_egreso)

  return lat !== null && lng !== null ? { lat, lng, precision } : null
}

function ubicacionObjetivoCompleta(objetivo?: Objetivo | null): boolean {
  return numeroGps(objetivo?.lat) !== null && numeroGps(objetivo?.lng) !== null && (numeroGps(objetivo?.radio_metros) || 0) > 0
}

function metrosTexto(valor?: unknown): string {
  const metros = numeroGps(valor)
  return metros !== null ? `${Math.round(metros).toLocaleString('es-AR')} m` : '—'
}

function estadoGpsRegistro(registro: RegistroAsistencia | undefined, tipo: 'ingreso' | 'egreso'): string | null | undefined {
  return tipo === 'ingreso' ? registro?.gps_ingreso_estado : registro?.gps_egreso_estado
}

function distanciaGpsRegistro(registro: RegistroAsistencia | undefined, tipo: 'ingreso' | 'egreso'): number | null {
  return numeroGps(tipo === 'ingreso' ? registro?.distancia_ingreso_metros : registro?.distancia_egreso_metros)
}

function resumenGps(registro: RegistroAsistencia | undefined, tipo: 'ingreso' | 'egreso'): string {
  const gps = gpsRegistro(registro, tipo)
  if (!gps) return '⚠ Sin GPS'

  const prefijo = tipo === 'ingreso' ? 'Ingreso' : 'Egreso'
  const estado = estadoGpsRegistro(registro, tipo)
  const distancia = distanciaGpsRegistro(registro, tipo)
  const precision = gps.precision !== null ? ` · Precisión ${metrosTexto(gps.precision)}` : ''

  if (estado === 'dentro_radio') return `${prefijo} GPS ✓ · Dentro del radio · ${metrosTexto(distancia)}${precision}`
  if (estado === 'fuera_radio') return `${prefijo} GPS ⚠ Fuera del radio · ${metrosTexto(distancia)}${precision}`
  if (estado === 'objetivo_sin_gps') return `${prefijo} GPS registrado · Objetivo sin ubicación`
  if (estado === 'gps_no_disponible') return '⚠ Sin GPS'

  return `${prefijo} GPS registrado${precision}`
}

export default function SupervisorMobile({ user }: any) {
  const [tab, setTab] = useState('inicio')
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [guardias, setGuardias] = useState<Usuario[]>([])
  const [supervisores, setSupervisores] = useState<Usuario[]>([])
  const [objetivos, setObjetivos] = useState<Objetivo[]>([])
  const [registros, setRegistros] = useState<RegistroAsistencia[]>([])
  const [intervenciones, setIntervenciones] = useState<SupervisorIntervencion[]>([])
  const [supervisoresGuardia, setSupervisoresGuardia] = useState<SupervisorGuardia[]>([])
  const [solicitudesAdmin, setSolicitudesAdmin] = useState<SolicitudAdmin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [asignando, setAsignando] = useState<string | null>(null)
  const [turnoRegistrosAbierto, setTurnoRegistrosAbierto] = useState<string | null>(null)
  const [nuevaPassword, setNuevaPassword] = useState('')
  const [confirmarPassword, setConfirmarPassword] = useState('')
  const [perfilMensaje, setPerfilMensaje] = useState<{ texto: string, tipo: 'ok' | 'error' } | null>(null)
  const [guardandoPassword, setGuardandoPassword] = useState(false)
  const [filtroTurnos, setFiltroTurnos] = useState<EstadoTurno | 'todos'>('todos')
  const [filtroFecha, setFiltroFecha] = useState<FiltroFechaTurnos>('hoy')
  const [modalTurno, setModalTurno] = useState(false)
  const [formTurno, setFormTurno] = useState({ objetivo_id:'', guardia_id:'', fecha: fechaHoy(), hora_inicio:'18:00', hora_fin:'06:00', tipo_evento:'normal' })
  const [guardiaEditando, setGuardiaEditando] = useState<Usuario | null>(null)
  const [objetivoEditando, setObjetivoEditando] = useState<Objetivo | null>(null)
  const [formGuardia, setFormGuardia] = useState({ email:'', telefono:'', estado:'activo', foto_url:'' })
  const [formObjetivo, setFormObjetivo] = useState({ direccion:'', lat:'', lng:'', radio_metros:'200', estado:'activo' })
  const [modalNuevoGuardia, setModalNuevoGuardia] = useState(false)
  const [modalNuevoObjetivo, setModalNuevoObjetivo] = useState(false)
  const [formNuevoGuardia, setFormNuevoGuardia] = useState({ nombre:'', apellido:'', dni:'', telefono:'', legajo:'', email:'', rol:'guardia', foto_url:'' })
  const [formNuevoObjetivo, setFormNuevoObjetivo] = useState({ nombre:'', cliente:'', direccion:'', lat:'', lng:'', radio_metros:'200' })
  const [accionAlerta, setAccionAlerta] = useState<AccionAlertaActiva | null>(null)
  const [formIntervencion, setFormIntervencion] = useState({ guardia_id:'', comentario:'', motivo:'' })
  const [mensaje, setMensaje] = useState('')
  const [activandoPush, setActivandoPush] = useState(false)

  const hoy = fechaHoy()
  const rangoFecha = rangoFiltroFechaTurnos(filtroFecha, hoy)

  const cerrarSesion = async () => {
    await supabase.auth.signOut()
    window.location.href = '/dashboard'
  }

  const activarPush = async () => {
    setActivandoPush(true)
    const resultado = await activarNotificacionesPush()
    if (resultado.ok) {
      setMensaje(resultado.message)
      setError('')
    } else {
      setError(resultado.message)
    }
    setActivandoPush(false)
  }

  const cargarDatos = async (filtro: FiltroFechaTurnos = filtroFecha) => {
    setLoading(true)
    setError('')
    const rango = rangoFiltroFechaTurnos(filtro, hoy)

    const [{ data: turnosData, error: turnosError }, { data: objetivosData, error: objetivosError }, guardiasResult, supervisoresResult, supervisoresGuardiaResult, solicitudesResult] = await Promise.all([
      supabase
        .from('turnos')
        .select('*')
        .gte('fecha', rango.desde)
        .lte('fecha', rango.hasta)
        .order('fecha', { ascending: true })
        .order('hora_inicio', { ascending: true }),
      supabase
        .from('objetivos')
        .select('id, nombre, cliente, direccion, lat, lng, radio_metros, estado')
        .order('nombre'),
      supabase
        .from('usuarios')
        .select('id, nombre, apellido, legajo, rol, estado, email, telefono, foto_url')
        .in('rol', ['guardia', 'vigilador'])
        .order('apellido'),
      supabase
        .from('usuarios')
        .select('id, nombre, apellido, legajo, rol, estado')
        .in('rol', ['supervisor', 'admin'])
        .order('apellido'),
      supabase
        .from('supervisores_guardia')
        .select('id, supervisor_id, fecha, hora_inicio, hora_fin, zona, rol_operativo, estado, observacion, creado_por, created_at')
        .gte('fecha', sumarDiasFecha(rango.desde, -1))
        .lte('fecha', rango.hasta)
        .order('fecha', { ascending: true })
        .order('hora_inicio', { ascending: true }),
      supabase
        .from('solicitudes_admin')
        .select('*')
        .eq('solicitante_id', user.id)
        .order('created_at', { ascending: false }),
    ])

    let guardiasData = guardiasResult.data
    let guardiasError = guardiasResult.error
    const supervisoresData = supervisoresResult.data
    const supervisoresError = supervisoresResult.error
    const supervisoresGuardiaData = supervisoresGuardiaResult.data
    const supervisoresGuardiaError = supervisoresGuardiaResult.error
    const solicitudesData = solicitudesResult.data
    const solicitudesError = solicitudesResult.error

    if (guardiasError?.message?.includes('usuarios.email') || guardiasError?.message?.includes('usuarios.telefono') || guardiasError?.message?.includes('usuarios.foto_url')) {
      const retry = await supabase
        .from('usuarios')
        .select('id, nombre, apellido, legajo, rol, estado')
        .in('rol', ['guardia', 'vigilador'])
        .order('apellido')

      guardiasData = retry.data
      guardiasError = retry.error
    }

    if (turnosError || objetivosError || guardiasError || supervisoresError) {
      setError(turnosError?.message || objetivosError?.message || guardiasError?.message || supervisoresError?.message || 'Error al cargar datos.')
      setLoading(false)
      return
    }

    if (supervisoresGuardiaError && !/supervisores_guardia|schema cache|does not exist/i.test(supervisoresGuardiaError.message)) {
      setError(supervisoresGuardiaError.message)
    }

    if (solicitudesError && !/solicitudes_admin|schema cache|does not exist/i.test(solicitudesError.message)) {
      setError(solicitudesError.message)
    }

    const turnosRango = (turnosData || []) as Turno[]
    setTurnos(turnosRango)
    setObjetivos((objetivosData || []) as Objetivo[])
    setGuardias((guardiasData || []) as Usuario[])
    setSupervisores((supervisoresData || []) as Usuario[])
    setSupervisoresGuardia(supervisoresGuardiaError ? [] : (supervisoresGuardiaData || []) as SupervisorGuardia[])
    setSolicitudesAdmin(solicitudesError ? [] : (solicitudesData || []) as SolicitudAdmin[])

    if (turnosRango.length === 0) {
      setRegistros([])
      setIntervenciones([])
      setLoading(false)
      return
    }

    const turnoIds = turnosRango.map(t => t.id)
    const [{ data: registrosData, error: registrosError }, { data: intervencionesData, error: intervencionesError }] = await Promise.all([
      supabase
        .from('registros_asistencia')
        .select('*')
        .in('turno_id', turnoIds),
      supabase
        .from('supervisor_intervenciones')
        .select('*')
        .in('turno_id', turnoIds)
        .order('created_at', { ascending: false }),
    ])

    if (registrosError) {
      setError(registrosError.message)
      setRegistros([])
    } else {
      setRegistros((registrosData || []) as RegistroAsistencia[])
    }

    if (intervencionesError) {
      setIntervenciones([])
      if (!/supervisor_intervenciones|schema cache|does not exist/i.test(intervencionesError.message)) {
        setError(intervencionesError.message)
      }
    } else {
      setIntervenciones((intervencionesData || []) as SupervisorIntervencion[])
    }

    setLoading(false)
  }

  const cambiarPassword = async () => {
    setPerfilMensaje(null)

    if (nuevaPassword.length < 6) {
      setPerfilMensaje({ texto: 'La contraseña debe tener al menos 6 caracteres.', tipo: 'error' })
      return
    }

    if (nuevaPassword !== confirmarPassword) {
      setPerfilMensaje({ texto: 'Las contraseñas no coinciden.', tipo: 'error' })
      return
    }

    setGuardandoPassword(true)
    const { error } = await supabase.auth.updateUser({ password: nuevaPassword })

    if (error) {
      setPerfilMensaje({ texto: error.message, tipo: 'error' })
    } else {
      setNuevaPassword('')
      setConfirmarPassword('')
      setPerfilMensaje({ texto: 'Contraseña actualizada correctamente.', tipo: 'ok' })
    }

    setGuardandoPassword(false)
  }

  useEffect(() => {
    cargarDatos(filtroFecha)
  }, [filtroFecha])

  const getObjetivo = (id: string) => objetivos.find(o => o.id === id)
  const getGuardia = (id?: string | null) => guardias.find(g => g.id === id)
  const getSupervisor = (id?: string | null) => {
    if (!id) return null
    return supervisores.find(s => s.id === id) || (user?.id === id ? user : null)
  }
  const getRegistrosTurno = (turnoId: string) => registros
    .filter(r => r.turno_id === turnoId)
    .sort((a, b) => {
      const fechaA = a.created_at ? new Date(a.created_at).getTime() : 0
      const fechaB = b.created_at ? new Date(b.created_at).getTime() : 0
      return fechaB - fechaA
    })
  const getRegistro = (turnoId: string) => getRegistrosTurno(turnoId)[0]
  const nombrePersona = (persona?: Pick<Usuario, 'nombre' | 'apellido'> | null) =>
    persona ? `${persona.apellido}, ${persona.nombre}` : '—'
  const nombreSupervisor = (id?: string | null) => {
    const supervisor = getSupervisor(id)
    return supervisor ? nombrePersona(supervisor) : 'Supervisor no encontrado'
  }
  const supervisorGuardiaAsignado = (turno: Turno) =>
    supervisoresGuardia.find(asignacion =>
      asignacion.estado !== 'inactivo' &&
      asignacion.rol_operativo === 'supervisor' &&
      asignacion.zona === ZONA_OPERATIVA &&
      fechaHoraEnRango(
        turno.fecha,
        turno.hora_inicio,
        asignacion.fecha.slice(0, 10),
        asignacion.hora_inicio,
        asignacion.hora_fin,
      )
    ) || null
  const nombreSupervisorGuardia = (turno: Turno) => {
    const asignacion = supervisorGuardiaAsignado(turno)
    return asignacion?.supervisor_id ? nombreSupervisor(asignacion.supervisor_id) : 'Sin supervisor asignado'
  }
  const intervencionesAlerta = (turnoId: string, tipoAlerta?: TipoAlertaOperativa) =>
    intervenciones
      .filter(i => i.turno_id === turnoId && (!tipoAlerta || i.tipo_alerta === tipoAlerta))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const ultimaIntervencionAlerta = (turnoId: string, tipoAlerta: TipoAlertaOperativa) =>
    intervencionesAlerta(turnoId, tipoAlerta)[0]
  const alertaIntervenida = (turnoId: string, tipoAlerta: TipoAlertaOperativa) =>
    intervencionesAlerta(turnoId, tipoAlerta).some(i => accionResuelveAlerta(i.accion))
  const turnoTieneIntervencionResolutiva = (turnoId: string) =>
    intervencionesAlerta(turnoId).some(i => accionResuelveAlerta(i.accion))
  const alertaPendiente = (turno: Turno, tipoAlerta: TipoAlertaOperativa) =>
    tipoAlerta === 'descubierto'
      ? !turnoTieneIntervencionResolutiva(turno.id)
      : !alertaIntervenida(turno.id, tipoAlerta)
  const existeAsistencia = (turno: Turno) => getRegistrosTurno(turno.id).length > 0
  const esDescubiertoOperativo = (turno: Turno) => !turno.guardia_id || turno.estado === 'descubierto'
  const esTurnoReasignado = (turno: Turno) => Boolean(
    turno.guardia_original_id &&
    turno.guardia_id &&
    turno.guardia_original_id !== turno.guardia_id
  )
  const esSinIngreso = (turno: Turno) => Boolean(
    turno.guardia_id &&
    !getRegistro(turno.id)?.hora_entrada_real &&
    turno.estado !== 'descubierto' &&
    minutosAtrasoTurno(turno) >= 15
  )
  const esTardanzaRegistrada = (turno: Turno) => {
    const registro = getRegistro(turno.id)
    if (!registro?.hora_entrada_real) return false

    return registro.alerta_entrada === 'tarde' || minutosTardeRegistro(turno, registro) > 0
  }
  const guardiaEsperadoId = (turno: Turno) => turno.guardia_original_id || turno.guardia_id || null
  const nombreGuardiaEsperado = (turno: Turno) => {
    const guardiaId = guardiaEsperadoId(turno)
    const guardia = getGuardia(guardiaId)
    return guardia ? `${guardia.apellido}, ${guardia.nombre}` : 'Sin guardia esperado'
  }
  const detalleTurnoDescubierto = (turno: Turno) => {
    if (!turno.guardia_id) return 'Sin guardia asignado'
    if (turno.estado === 'descubierto') return 'Estado descubierto'
    return 'Pasó ventana de fichaje sin asistencia'
  }

  const estadoOperativo = (turno: Turno): EstadoTurno => {
    const registro = getRegistro(turno.id)

    if (registro?.hora_salida_real) return 'finalizado'
    if (registro?.hora_entrada_real) return registro.alerta_entrada === 'tarde' ? 'tardanza' : 'en turno'
    if (esDescubiertoOperativo(turno)) return 'descubierto'
    if (esTurnoReasignado(turno)) return 'reasignado'
    if (esSinIngreso(turno)) return 'pendiente de ingreso'
    if (turno.estado === 'cubierto') return 'cubierto'
    return 'programado'
  }

  const alertaTurno = (turno: Turno): TipoAlerta => {
    const registro = getRegistro(turno.id)

    if (registro?.hora_salida_real) return 'salida registrada'
    if (registro?.hora_entrada_real) return esTardanzaRegistrada(turno) ? 'ingreso tarde' : 'entrada registrada'
    if (esDescubiertoOperativo(turno)) return 'turno descubierto'
    if (esSinIngreso(turno)) return 'sin ingreso'
    if (esTurnoReasignado(turno)) return 'reasignado'
    return 'sin entrada'
  }

  const turnosVisibles = useMemo(() => {
    if (filtroTurnos === 'todos') return turnos
    return turnos.filter(t => estadoOperativo(t) === filtroTurnos)
  }, [turnos, registros, filtroTurnos])

  const turnosPorObjetivo = useMemo(() => {
    const grupos = new Map<string, { objetivo: Objetivo, turnos: Turno[] }>()

    turnosVisibles.forEach(turno => {
      const objetivo = getObjetivo(turno.objetivo_id) || {
        id: turno.objetivo_id,
        nombre: 'Objetivo sin nombre',
      }

      if (!grupos.has(objetivo.id)) {
        grupos.set(objetivo.id, { objetivo, turnos: [] })
      }

      grupos.get(objetivo.id)?.turnos.push(turno)
    })

    return Array.from(grupos.values()).sort((a, b) => a.objetivo.nombre.localeCompare(b.objetivo.nombre))
  }, [turnosVisibles, objetivos, registros])

  const resumen = useMemo(() => ({
    total: turnos.length,
    enTurno: turnos.filter(t => estadoOperativo(t) === 'en turno').length,
    finalizados: turnos.filter(t => estadoOperativo(t) === 'finalizado').length,
    descubiertos: turnos.filter(t => estadoOperativo(t) === 'descubierto').length,
  }), [turnos, registros])

  const turnosDescubiertosOperativos = useMemo(
    () => turnos.filter(t => esDescubiertoOperativo(t)),
    [turnos, registros],
  )

  const turnosSinIngreso = useMemo(
    () => turnos.filter(t => esSinIngreso(t)),
    [turnos, registros],
  )

  const turnosConTardanzaRegistrada = useMemo(
    () => turnos.filter(t => esTardanzaRegistrada(t)),
    [turnos, registros],
  )

  const turnosConGpsFueraRadio = useMemo(
    () => turnos.filter(t => getRegistro(t.id)?.gps_ingreso_estado === 'fuera_radio'),
    [turnos, registros],
  )

  const turnosDescubiertosPendientes = useMemo(
    () => turnosDescubiertosOperativos.filter(t => alertaPendiente(t, 'descubierto')),
    [turnosDescubiertosOperativos, intervenciones],
  )

  const turnosSinIngresoPendientes = useMemo(
    () => turnosSinIngreso.filter(t => alertaPendiente(t, 'sin_fichar')),
    [turnosSinIngreso, intervenciones],
  )

  const turnosConTardanzaPendientes = useMemo(
    () => turnosConTardanzaRegistrada.filter(t => alertaPendiente(t, 'tardanza')),
    [turnosConTardanzaRegistrada, intervenciones],
  )

  const turnosConGpsFueraRadioPendientes = useMemo(
    () => turnosConGpsFueraRadio.filter(t => alertaPendiente(t, 'fuera_radio')),
    [turnosConGpsFueraRadio, intervenciones],
  )

  const totalAlertasPendientes =
    turnosDescubiertosPendientes.length +
    turnosSinIngresoPendientes.length +
    turnosConTardanzaPendientes.length +
    turnosConGpsFueraRadioPendientes.length

  const alertasIntervenidas = useMemo<AlertaIntervenida[]>(() => {
    const porAlerta = new Map<string, AlertaIntervenida>()

    intervenciones.forEach(intervencion => {
      if (!accionResuelveAlerta(intervencion.accion) || !esTipoAlertaOperativa(intervencion.tipo_alerta)) return

      const turno = turnos.find(t => t.id === intervencion.turno_id)
      if (!turno) return

      const key = `${intervencion.turno_id}-${intervencion.tipo_alerta}`
      const actual = porAlerta.get(key)
      if (!actual || new Date(intervencion.created_at).getTime() > new Date(actual.intervencion.created_at).getTime()) {
        porAlerta.set(key, { turno, tipoAlerta: intervencion.tipo_alerta, intervencion })
      }
    })

    return Array.from(porAlerta.values())
      .sort((a, b) => new Date(b.intervencion.created_at).getTime() - new Date(a.intervencion.created_at).getTime())
  }, [intervenciones, turnos])

  const guardiaTieneTurnoSuperpuesto = async (
    candidato: Pick<Turno, 'guardia_id' | 'fecha' | 'hora_inicio' | 'hora_fin'>,
    excluirTurnoId?: string,
  ): Promise<boolean | null> => {
    if (!candidato.guardia_id) return false

    const { data, error: turnosError } = await supabase
      .from('turnos')
      .select('id, guardia_id, fecha, hora_inicio, hora_fin')
      .eq('guardia_id', candidato.guardia_id)
      .in('fecha', fechasVecinasTurno(candidato.fecha))

    if (turnosError) {
      setError(turnosError.message)
      return null
    }

    return tieneTurnoSuperpuesto(data || [], candidato, excluirTurnoId)
  }

  const crearTurno = async () => {
    if (!formTurno.objetivo_id || !formTurno.fecha || !formTurno.hora_inicio || !formTurno.hora_fin) {
      setError('Completá objetivo, fecha y horarios.')
      return
    }

    setAsignando('crear-turno')
    setError('')
    setMensaje('')

    const payload = {
      objetivo_id: formTurno.objetivo_id,
      guardia_id: formTurno.guardia_id || null,
      guardia_original_id: formTurno.guardia_id || null,
      fecha: formTurno.fecha,
      hora_inicio: formTurno.hora_inicio,
      hora_fin: formTurno.hora_fin,
      estado: 'programado',
      tipo_evento: formTurno.tipo_evento,
    }

    const conflicto = payload.guardia_id ? await guardiaTieneTurnoSuperpuesto(payload) : false
    if (conflicto === null) {
      setAsignando(null)
      return
    }
    if (conflicto) {
      setError(MENSAJE_TURNO_SUPERPUESTO)
      setAsignando(null)
      return
    }

    const { error: insertError } = await supabase.from('turnos').insert(payload)

    if (insertError) {
      setError(insertError.message)
    } else {
      const filtroDestino = filtroFechaTurnosIncluye(filtroFecha, payload.fecha)
        ? filtroFecha
        : filtroFechaTurnosParaFecha(payload.fecha)

      setFiltroFecha(filtroDestino)
      await cargarDatos(filtroDestino)
      setMensaje('✓ Turno creado correctamente')
      setModalTurno(false)
      setFormTurno({ objetivo_id:'', guardia_id:'', fecha:hoy, hora_inicio:'18:00', hora_fin:'06:00', tipo_evento:'normal' })
    }

    setAsignando(null)
  }

  const repetirAyer = async () => {
    const fechaDestino = filtroFecha === 'manana' ? sumarDiasFecha(hoy, 1) : hoy
    const fechaOrigen = sumarDiasFecha(fechaDestino, -1)

    setAsignando('repetir-ayer')
    setError('')
    setMensaje('')

    const [{ data: turnosOrigen, error: origenError }, { data: turnosComparacionData, error: comparacionError }] = await Promise.all([
      supabase
        .from('turnos')
        .select('objetivo_id, guardia_id, hora_inicio, hora_fin, tipo_evento')
        .eq('fecha', fechaOrigen)
        .order('hora_inicio', { ascending: true }),
      supabase
        .from('turnos')
        .select('id, objetivo_id, guardia_id, fecha, hora_inicio, hora_fin, estado, tipo_evento')
        .in('fecha', fechasVecinasTurno(fechaDestino)),
    ])

    if (origenError || comparacionError) {
      setError(origenError?.message || comparacionError?.message || 'Error al repetir turnos.')
      setAsignando(null)
      return
    }

    const comparacion = ((turnosComparacionData || []) as Turno[]).map(turno => ({ ...turno }))
    const candidatos = (turnosOrigen || []).reduce<{ objetivo_id: string, guardia_id: string | null, guardia_original_id: string | null, fecha: string, hora_inicio: string, hora_fin: string, estado: Turno['estado'], tipo_evento: string }[]>((acumulados, turno: any) => {
      const candidato = {
        objetivo_id: turno.objetivo_id,
        guardia_id: turno.guardia_id || null,
        guardia_original_id: turno.guardia_id || null,
        fecha: fechaDestino,
        hora_inicio: turno.hora_inicio,
        hora_fin: turno.hora_fin,
        estado: (turno.guardia_id ? 'programado' : 'descubierto') as Turno['estado'],
        tipo_evento: turno.tipo_evento || 'normal',
      }

      const duplicado = comparacion.some(existente =>
        existente.fecha === fechaDestino &&
        existente.objetivo_id === candidato.objetivo_id &&
        existente.hora_inicio === candidato.hora_inicio &&
        existente.hora_fin === candidato.hora_fin
      )
      const superpuesto = candidato.guardia_id
        ? tieneTurnoSuperpuesto(comparacion, candidato)
        : false

      if (duplicado || superpuesto) return acumulados

      acumulados.push(candidato)
      comparacion.push({ id: `nuevo-${acumulados.length}`, ...candidato })
      return acumulados
    }, [])
    const omitidos = (turnosOrigen || []).length - candidatos.length

    if (candidatos.length > 0) {
      const { error: insertError } = await supabase.from('turnos').insert(candidatos)

      if (insertError) {
        setError(insertError.message)
        setAsignando(null)
        return
      }
    }

    await cargarDatos(filtroFecha)
    setFiltroTurnos('todos')
    setTab('turnos')
    setMensaje(`✓ Repetir ayer\nSe crearon ${candidatos.length}\nSe omitieron ${omitidos}`)
    setAsignando(null)
  }

  const actualizarUbicacionObjetivo = async (objetivo: Objetivo) => {
    if (!navigator.geolocation) {
      setError('GPS no disponible en este navegador.')
      return
    }

    setAsignando(`gps-${objetivo.id}`)
    setError('')

    navigator.geolocation.getCurrentPosition(async position => {
      const payload = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        radio_metros: objetivo.radio_metros || 200,
      }

      const { data, error: updateError } = await supabase.from('objetivos').update(payload).eq('id', objetivo.id).select().single()

      if (updateError) {
        setError(updateError.message)
      } else if (data) {
        setObjetivos(prev => prev.map(o => o.id === objetivo.id ? { ...o, ...data } : o))
      }

      setAsignando(null)
    }, () => {
      setError('GPS no disponible.')
      setAsignando(null)
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 })
  }

  const resetFormNuevoGuardia = () => {
    setFormNuevoGuardia({ nombre:'', apellido:'', dni:'', telefono:'', legajo:'', email:'', rol:'guardia', foto_url:'' })
  }

  const resetFormNuevoObjetivo = () => {
    setFormNuevoObjetivo({ nombre:'', cliente:'', direccion:'', lat:'', lng:'', radio_metros:'200' })
  }

  const tipoSolicitudLabel = (tipo: TipoSolicitudAdmin) => {
    const labels: Record<TipoSolicitudAdmin, string> = {
      crear_objetivo: 'Crear objetivo',
      baja_objetivo: 'Baja de objetivo',
      crear_vigilador: 'Crear vigilador',
      baja_vigilador: 'Baja de vigilador',
    }

    return labels[tipo]
  }

  const crearSolicitudAdmin = async (tipo: TipoSolicitudAdmin, entidad: string, entidadId: string | null, datos: Record<string, any>) => {
    if (!user?.id) throw new Error('Sesión de supervisor no disponible.')

    const payload = {
      solicitante_id: user.id,
      tipo,
      entidad,
      entidad_id: entidadId,
      datos_json: datos,
      estado: 'pendiente',
    }

    const { data, error: insertError } = await supabase
      .from('solicitudes_admin')
      .insert(payload)
      .select()
      .single()

    if (insertError) throw insertError

    setSolicitudesAdmin(prev => [data as SolicitudAdmin, ...prev])
    return data as SolicitudAdmin
  }

  const solicitarCrearGuardia = async () => {
    if (!formNuevoGuardia.nombre.trim() || !formNuevoGuardia.apellido.trim() || !formNuevoGuardia.legajo.trim()) {
      setError('Nombre, apellido y legajo son obligatorios.')
      return
    }

    setAsignando('solicitud-crear-guardia')
    setError('')

    try {
      await crearSolicitudAdmin('crear_vigilador', 'usuarios', null, {
        nombre: formNuevoGuardia.nombre.trim(),
        apellido: formNuevoGuardia.apellido.trim(),
        dni: formNuevoGuardia.dni.trim() || null,
        telefono: formNuevoGuardia.telefono.trim() || null,
        legajo: formNuevoGuardia.legajo.trim(),
        email: formNuevoGuardia.email.trim().toLowerCase() || null,
        rol: formNuevoGuardia.rol === 'vigilador' ? 'vigilador' : 'guardia',
        foto_url: formNuevoGuardia.foto_url.trim() || null,
      })
      setMensaje('Solicitud enviada: crear vigilador.')
      resetFormNuevoGuardia()
      setModalNuevoGuardia(false)
      setTab('solicitudes')
    } catch (solicitudError) {
      setError(solicitudError instanceof Error ? solicitudError.message : 'No se pudo crear la solicitud.')
    } finally {
      setAsignando(null)
    }
  }

  const solicitarCrearObjetivo = async () => {
    if (!formNuevoObjetivo.nombre.trim()) {
      setError('El nombre del objetivo es obligatorio.')
      return
    }

    const lat = formNuevoObjetivo.lat.trim() ? Number(formNuevoObjetivo.lat) : null
    const lng = formNuevoObjetivo.lng.trim() ? Number(formNuevoObjetivo.lng) : null
    const radio = Number(formNuevoObjetivo.radio_metros) || 200

    if ((lat !== null && !Number.isFinite(lat)) || (lng !== null && !Number.isFinite(lng))) {
      setError('Latitud y longitud deben ser números válidos.')
      return
    }

    setAsignando('solicitud-crear-objetivo')
    setError('')

    try {
      await crearSolicitudAdmin('crear_objetivo', 'objetivos', null, {
        nombre: formNuevoObjetivo.nombre.trim(),
        cliente: formNuevoObjetivo.cliente.trim() || null,
        direccion: formNuevoObjetivo.direccion.trim() || null,
        lat,
        lng,
        radio_metros: radio,
        estado: 'activo',
      })
      setMensaje('Solicitud enviada: crear objetivo.')
      resetFormNuevoObjetivo()
      setModalNuevoObjetivo(false)
      setTab('solicitudes')
    } catch (solicitudError) {
      setError(solicitudError instanceof Error ? solicitudError.message : 'No se pudo crear la solicitud.')
    } finally {
      setAsignando(null)
    }
  }

  const solicitarBajaGuardia = async (guardia: Usuario) => {
    setAsignando(`baja-guardia-${guardia.id}`)
    setError('')

    try {
      await crearSolicitudAdmin('baja_vigilador', 'usuarios', guardia.id, {
        nombre: guardia.nombre,
        apellido: guardia.apellido,
        legajo: guardia.legajo || null,
        email: guardia.email || null,
        estado_actual: guardia.estado,
      })
      setMensaje(`Solicitud enviada: baja de ${guardia.apellido}, ${guardia.nombre}.`)
      setGuardiaEditando(null)
      setTab('solicitudes')
    } catch (solicitudError) {
      setError(solicitudError instanceof Error ? solicitudError.message : 'No se pudo crear la solicitud.')
    } finally {
      setAsignando(null)
    }
  }

  const solicitarBajaObjetivo = async (objetivo: Objetivo) => {
    setAsignando(`baja-objetivo-${objetivo.id}`)
    setError('')

    try {
      await crearSolicitudAdmin('baja_objetivo', 'objetivos', objetivo.id, {
        nombre: objetivo.nombre,
        cliente: objetivo.cliente || null,
        direccion: objetivo.direccion || null,
        estado_actual: objetivo.estado || 'activo',
      })
      setMensaje(`Solicitud enviada: baja de ${objetivo.nombre}.`)
      setObjetivoEditando(null)
      setTab('solicitudes')
    } catch (solicitudError) {
      setError(solicitudError instanceof Error ? solicitudError.message : 'No se pudo crear la solicitud.')
    } finally {
      setAsignando(null)
    }
  }

  const abrirEditarGuardia = (guardia: Usuario) => {
    setError('')
    setGuardiaEditando(guardia)
    setFormGuardia({
      email: guardia.email || '',
      telefono: guardia.telefono || '',
      estado: guardia.estado || 'activo',
      foto_url: guardia.foto_url || '',
    })
  }

  const guardarGuardia = async () => {
    if (!guardiaEditando) return

    if (formGuardia.estado === 'inactivo' && guardiaEditando.estado !== 'inactivo') {
      await solicitarBajaGuardia(guardiaEditando)
      return
    }

    setAsignando(`guardia-${guardiaEditando.id}`)
    setError('')

    const payload = {
      email: formGuardia.email.trim().toLowerCase() || null,
      telefono: formGuardia.telefono.trim() || null,
      estado: formGuardia.estado,
      foto_url: formGuardia.foto_url.trim() || null,
    }

    const { data, error: updateError } = await supabase
      .from('usuarios')
      .update(payload)
      .eq('id', guardiaEditando.id)
      .in('rol', ['guardia', 'vigilador'])
      .select('id, nombre, apellido, legajo, rol, estado, email, telefono, foto_url')
      .single()

    if (updateError) {
      setError(updateError.message)
    } else if (data) {
      setGuardias(prev => prev.map(g => g.id === guardiaEditando.id ? data as Usuario : g))
      setGuardiaEditando(null)
    }

    setAsignando(null)
  }

  const abrirEditarObjetivo = (objetivo: Objetivo) => {
    setError('')
    setObjetivoEditando(objetivo)
    setFormObjetivo({
      direccion: objetivo.direccion || '',
      lat: objetivo.lat === null || objetivo.lat === undefined ? '' : String(objetivo.lat),
      lng: objetivo.lng === null || objetivo.lng === undefined ? '' : String(objetivo.lng),
      radio_metros: String(objetivo.radio_metros || 200),
      estado: objetivo.estado || 'activo',
    })
  }

  const guardarObjetivo = async () => {
    if (!objetivoEditando) return

    if (formObjetivo.estado === 'inactivo' && objetivoEditando.estado !== 'inactivo') {
      await solicitarBajaObjetivo(objetivoEditando)
      return
    }

    setAsignando(`objetivo-${objetivoEditando.id}`)
    setError('')

    const lat = formObjetivo.lat.trim() ? Number(formObjetivo.lat) : null
    const lng = formObjetivo.lng.trim() ? Number(formObjetivo.lng) : null
    const radio = Number(formObjetivo.radio_metros) || 200

    if ((lat !== null && !Number.isFinite(lat)) || (lng !== null && !Number.isFinite(lng))) {
      setError('Latitud y longitud deben ser números válidos.')
      setAsignando(null)
      return
    }

    const payload = {
      direccion: formObjetivo.direccion.trim() || null,
      lat,
      lng,
      radio_metros: radio,
      estado: formObjetivo.estado,
    }

    const { data, error: updateError } = await supabase
      .from('objetivos')
      .update(payload)
      .eq('id', objetivoEditando.id)
      .select('id, nombre, cliente, direccion, lat, lng, radio_metros, estado')
      .single()

    if (updateError) {
      setError(updateError.message)
    } else if (data) {
      setObjetivos(prev => prev.map(o => o.id === objetivoEditando.id ? data as Objetivo : o))
      setObjetivoEditando(null)
    }

    setAsignando(null)
  }

  const cambiarGuardia = async (turno: Turno, guardiaId: string) => {
    const nuevoGuardiaId = guardiaId || null
    setAsignando(turno.id)
    setError('')

    const payload: { guardia_id: string | null, guardia_original_id?: string | null, estado: EstadoTurnoPersistido } = {
      guardia_id: nuevoGuardiaId,
      estado: nuevoGuardiaId ? (turno.estado === 'descubierto' ? 'programado' : turno.estado) : 'descubierto',
    }

    if (nuevoGuardiaId) {
      payload.guardia_original_id = turno.guardia_original_id || turno.guardia_id || nuevoGuardiaId
    }

    const conflicto = nuevoGuardiaId ? await guardiaTieneTurnoSuperpuesto({
      guardia_id: nuevoGuardiaId,
      fecha: turno.fecha,
      hora_inicio: turno.hora_inicio,
      hora_fin: turno.hora_fin,
    }, turno.id) : false
    if (conflicto === null) {
      setAsignando(null)
      return
    }
    if (conflicto) {
      setError(MENSAJE_TURNO_SUPERPUESTO)
      setAsignando(null)
      return
    }

    const { error: updateError } = await supabase
      .from('turnos')
      .update(payload)
      .eq('id', turno.id)

    if (updateError) {
      setError(updateError.message)
    } else {
      setTurnos(prev => prev.map(t => t.id === turno.id ? { ...t, ...payload } : t))
    }

    setAsignando(null)
  }

  const marcarDescubierto = async (turno: Turno) => {
    setAsignando(turno.id)
    setError('')

    const payload: { guardia_id: null, guardia_original_id?: string | null, estado: EstadoTurnoPersistido } = {
      guardia_id: null,
      estado: 'descubierto',
    }

    if (!turno.guardia_original_id && turno.guardia_id) {
      payload.guardia_original_id = turno.guardia_id
    }

    const { error: updateError } = await supabase
      .from('turnos')
      .update(payload)
      .eq('id', turno.id)

    if (updateError) {
      setError(updateError.message)
    } else {
      setTurnos(prev => prev.map(t => t.id === turno.id ? { ...t, ...payload } : t))
    }

    setAsignando(null)
  }

  const abrirAccionAlerta = (
    turno: Turno,
    tipoAlerta: TipoAlertaOperativa,
    accion: AccionIntervencion,
    registro?: RegistroAsistencia,
  ) => {
    setError('')
    setMensaje('')
    setAccionAlerta({ turnoId: turno.id, tipoAlerta, accion, registroId: registro?.id || null })
    setFormIntervencion({
      guardia_id: turno.guardia_id || '',
      comentario: '',
      motivo: accion === 'confirmar_cubierto' ? 'Entrada confirmada por supervisor' : '',
    })
  }

  const cerrarAccionAlerta = () => {
    setAccionAlerta(null)
    setFormIntervencion({ guardia_id:'', comentario:'', motivo:'' })
  }

  const registrarIntervencion = async (payload: Omit<SupervisorIntervencion, 'id' | 'created_at' | 'supervisor_id'>) => {
    if (!user?.id) throw new Error('Sesión de supervisor no disponible.')

    const turno = turnos.find(t => t.id === payload.turno_id)
    const asignacionSupervisor = turno ? supervisorGuardiaAsignado(turno) : null
    const insertPayload = {
      ...payload,
      supervisor_id: user.id,
      supervisor_intervino_id: user.id,
      supervisor_asignado_id: asignacionSupervisor?.supervisor_id || null,
      supervisor_guardia_id: asignacionSupervisor?.id || null,
      jefe_operativo: JEFE_OPERATIVO,
      director_tecnico: DIRECTOR_TECNICO,
      zona: ZONA_OPERATIVA,
    }
    const { data, error: insertError } = await supabase
      .from('supervisor_intervenciones')
      .insert(insertPayload)
      .select()
      .maybeSingle()

    if (insertError) throw insertError

    const intervencion = data || {
      ...insertPayload,
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `local-${Date.now()}`,
      created_at: new Date().toISOString(),
    }

    setIntervenciones(prev => [intervencion as SupervisorIntervencion, ...prev])
  }

  const ejecutarAccionAlerta = async () => {
    if (!accionAlerta) return

    const turno = turnos.find(t => t.id === accionAlerta.turnoId)
    if (!turno) return

    const comentario = formIntervencion.comentario.trim()
    const motivo = formIntervencion.motivo.trim()
    const requiereComentario = accionAlerta.accion === 'comentario'

    if (requiereComentario && !comentario) {
      setError('Agregá un comentario para guardar la intervención.')
      return
    }

    if (accionAlerta.accion === 'reasignacion' && !formIntervencion.guardia_id) {
      setError('Seleccioná el nuevo guardia.')
      return
    }

    if (accionAlerta.accion === 'reasignacion' && formIntervencion.guardia_id === turno.guardia_id) {
      setError('Seleccioná un guardia distinto al actual.')
      return
    }

    const loadingKey = `alerta-${turno.id}-${accionAlerta.accion}`
    setAsignando(loadingKey)
    setError('')
    setMensaje('')

    try {
      const estadoAnterior = turno.estado
      let estadoNuevo: EstadoTurnoPersistido | string | null = turno.estado
      let guardiaAnteriorId: string | null = turno.guardia_id || null
      let guardiaNuevoId: string | null = turno.guardia_id || null

      if (accionAlerta.accion === 'reasignacion') {
        guardiaNuevoId = formIntervencion.guardia_id
        const conflicto = await guardiaTieneTurnoSuperpuesto({
          guardia_id: guardiaNuevoId,
          fecha: turno.fecha,
          hora_inicio: turno.hora_inicio,
          hora_fin: turno.hora_fin,
        }, turno.id)

        if (conflicto === null) {
          setAsignando(null)
          return
        }

        if (conflicto) {
          setError(MENSAJE_TURNO_SUPERPUESTO)
          setAsignando(null)
          return
        }

        estadoNuevo = turno.estado === 'descubierto' ? 'programado' : turno.estado
        const payload = {
          guardia_id: guardiaNuevoId,
          guardia_original_id: turno.guardia_original_id || turno.guardia_id || guardiaNuevoId,
          estado: estadoNuevo as EstadoTurnoPersistido,
        }
        const { error: updateError } = await supabase.from('turnos').update(payload).eq('id', turno.id)
        if (updateError) throw updateError
        setTurnos(prev => prev.map(t => t.id === turno.id ? { ...t, ...payload } : t))
      }

      if (accionAlerta.accion === 'marcado_descubierto') {
        guardiaNuevoId = null
        estadoNuevo = 'descubierto'
        const payload: { guardia_id: null, guardia_original_id?: string | null, estado: EstadoTurnoPersistido } = {
          guardia_id: null,
          estado: 'descubierto',
        }

        if (!turno.guardia_original_id && turno.guardia_id) payload.guardia_original_id = turno.guardia_id

        const { error: updateError } = await supabase.from('turnos').update(payload).eq('id', turno.id)
        if (updateError) throw updateError
        setTurnos(prev => prev.map(t => t.id === turno.id ? { ...t, ...payload } : t))
      }

      if (accionAlerta.accion === 'confirmar_cubierto') {
        estadoNuevo = 'cubierto'
        const payload = { estado: 'cubierto' as EstadoTurnoPersistido }
        const { error: updateError } = await supabase.from('turnos').update(payload).eq('id', turno.id)
        if (updateError) throw updateError
        setTurnos(prev => prev.map(t => t.id === turno.id ? { ...t, ...payload } : t))
      }

      await registrarIntervencion({
        turno_id: turno.id,
        registro_asistencia_id: accionAlerta.registroId || null,
        tipo_alerta: accionAlerta.tipoAlerta,
        accion: accionAlerta.accion,
        comentario: comentario || null,
        motivo: motivo || (accionAlerta.accion === 'confirmar_cubierto' ? 'Entrada confirmada por supervisor' : null),
        guardia_anterior_id: guardiaAnteriorId,
        guardia_nuevo_id: guardiaNuevoId,
        estado_anterior: estadoAnterior,
        estado_nuevo: estadoNuevo,
      })

      setMensaje('✓ Intervención registrada')
      cerrarAccionAlerta()
    } catch (actionError) {
      const message = actionError instanceof Error
        ? actionError.message
        : typeof actionError === 'object' && actionError && 'message' in actionError
          ? String((actionError as { message: unknown }).message)
          : 'Error al registrar intervención.'
      setError(`No se pudo guardar la intervención: ${message}`)
    } finally {
      setAsignando(null)
    }
  }

  const tabs = [
    { id: 'inicio', label: 'Inicio', icon: '🏠' },
    { id: 'turnos', label: 'Turnos', icon: '📅' },
    { id: 'guardias', label: 'Guardias', icon: '👮' },
    { id: 'objetivos', label: 'Objetivos', icon: '🏢' },
    { id: 'solicitudes', label: 'Solicitudes', icon: '📝' },
    { id: 'alertas', label: 'Alertas', icon: '⚠️' },
    { id: 'perfil', label: 'Perfil', icon: '👤' },
  ]

  const renderFiltrosFecha = () => (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, margin:'12px 0 16px' }}>
      {FILTROS_FECHA_TURNOS.map(filtro => {
        const activo = filtroFecha === filtro.id

        return (
          <button
            key={filtro.id}
            type="button"
            onClick={() => {
              setFiltroFecha(filtro.id)
              setMensaje('')
            }}
            style={{
              ...secondaryButton,
              background: activo ? '#f59e0b' : secondaryButton.background,
              color: activo ? '#111827' : secondaryButton.color,
              borderColor: activo ? '#f59e0b' : '#374151',
            }}
          >
            {filtro.label}
          </button>
        )
      })}
    </div>
  )

  const accionLabel = (accion: string) => {
    const labels: Record<string, string> = {
      comentario: 'Comentario',
      reasignacion: 'Reasignación',
      marcado_descubierto: 'Marcado descubierto',
      confirmar_cubierto: 'Confirmar cubierto',
      marcado_cubierto_manual: 'Confirmar cubierto',
      alerta_revisada: 'Alerta revisada',
    }

    return labels[accion] || accion
  }

  const renderContextoAlerta = (turno: Turno, tipoAlerta?: TipoAlertaOperativa) => {
    const asignacion = supervisorGuardiaAsignado(turno)
    const ultima = tipoAlerta ? ultimaIntervencionAlerta(turno.id, tipoAlerta) : intervencionesAlerta(turno.id)[0]
    const supervisorIntervinoId = ultima?.supervisor_intervino_id || ultima?.supervisor_id

    return (
      <div style={contextoAlertaBox}>
        <div>
          <div style={label}>Supervisor asignado</div>
          <div style={registroValue}>{nombreSupervisorGuardia(turno)}</div>
        </div>
        <div>
          <div style={label}>Jefe operativo</div>
          <div style={registroValue}>{ultima?.jefe_operativo || JEFE_OPERATIVO}</div>
        </div>
        <div>
          <div style={label}>Director técnico</div>
          <div style={registroValue}>{ultima?.director_tecnico || DIRECTOR_TECNICO}</div>
        </div>
        <div>
          <div style={label}>Supervisor que intervino</div>
          <div style={registroValue}>{supervisorIntervinoId ? nombreSupervisor(supervisorIntervinoId) : 'Sin intervención'}</div>
        </div>
        <div>
          <div style={label}>Acción realizada</div>
          <div style={registroValue}>{ultima ? accionLabel(ultima.accion) : 'Pendiente'}</div>
        </div>
        <div>
          <div style={label}>Fecha/hora intervención</div>
          <div style={registroValue}>{ultima ? fechaHoraDDMMYYYY(ultima.created_at) : '—'}</div>
        </div>
        <div style={{ gridColumn:'1 / -1' }}>
          <div style={label}>Comentario</div>
          <div style={registroValue}>{ultima?.comentario || asignacion?.observacion || '—'}</div>
        </div>
      </div>
    )
  }

  const renderHistorialAlerta = (turno: Turno, tipoAlerta: TipoAlertaOperativa) => {
    const items = intervencionesAlerta(turno.id, tipoAlerta)
    const ultima = items[0]

    return (
      <div style={intervencionesBox}>
        {ultima ? (
          <div style={{ ...muted, color: '#cbd5e1' }}>
            Intervenido por {nombreSupervisor(ultima.supervisor_intervino_id || ultima.supervisor_id)} — {fechaHoraDDMMYYYY(ultima.created_at)}
          </div>
        ) : (
          <div style={{ ...muted, color: '#f59e0b' }}>Aún no hay intervenciones guardadas.</div>
        )}
        {items.slice(0, 3).map(item => (
          <div key={item.id} style={intervencionItem}>
            <div>Supervisor asignado: {item.supervisor_asignado_id ? nombreSupervisor(item.supervisor_asignado_id) : nombreSupervisorGuardia(turno)}</div>
            <div>Supervisor que intervino: {nombreSupervisor(item.supervisor_intervino_id || item.supervisor_id)}</div>
            <div>Acción: {accionLabel(item.accion)}</div>
            {item.guardia_nuevo_id && item.guardia_nuevo_id !== item.guardia_anterior_id && (
              <div>Guardia nuevo: {nombrePersona(getGuardia(item.guardia_nuevo_id))}</div>
            )}
            {item.motivo && <div>Motivo: {item.motivo}</div>}
            {item.comentario && <div>Comentario: {item.comentario}</div>}
            <div>Fecha/hora: {fechaHoraDDMMYYYY(item.created_at)}</div>
          </div>
        ))}
      </div>
    )
  }

  const renderPanelAccion = (turno: Turno, tipoAlerta: TipoAlertaOperativa) => {
    if (!accionAlerta || accionAlerta.turnoId !== turno.id || accionAlerta.tipoAlerta !== tipoAlerta) return null

    const requiereGuardia = accionAlerta.accion === 'reasignacion'
    const requiereMotivo = accionAlerta.accion === 'confirmar_cubierto'
    const comentarioLabel = accionAlerta.accion === 'comentario' ? 'Comentario *' : 'Comentario'
    const loadingKey = `alerta-${turno.id}-${accionAlerta.accion}`

    return (
      <div style={accionPanel}>
        <div style={{ ...label, marginTop: 0 }}>Acción: {accionLabel(accionAlerta.accion)}</div>
        {error && <div style={{ ...errorBox, marginTop: 10 }}>{error}</div>}

        {requiereGuardia && (
          <>
            <label style={label}>Nuevo guardia</label>
            <select
              value={formIntervencion.guardia_id}
              onChange={e => setFormIntervencion(prev => ({ ...prev, guardia_id: e.target.value }))}
              style={select}
            >
              <option value="">Seleccionar guardia</option>
              {guardias.filter(g => g.estado === 'activo').map(g => (
                <option key={g.id} value={g.id}>{g.apellido}, {g.nombre}{g.legajo ? ` - ${g.legajo}` : ''}</option>
              ))}
            </select>
          </>
        )}

        {requiereMotivo && (
          <>
            <label style={label}>Motivo</label>
            <input
              style={input}
              value={formIntervencion.motivo}
              onChange={e => setFormIntervencion(prev => ({ ...prev, motivo: e.target.value }))}
              placeholder="Entrada confirmada por supervisor"
            />
          </>
        )}

        <label style={label}>{comentarioLabel}</label>
        <textarea
          style={textarea}
          value={formIntervencion.comentario}
          onChange={e => setFormIntervencion(prev => ({ ...prev, comentario: e.target.value }))}
          placeholder={accionAlerta.accion === 'confirmar_cubierto' ? 'Ej.: llegó' : 'Ej.: Se llamó al guardia. Informa que llega en 10 minutos.'}
        />

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          <button type="button" style={secondaryButton} onClick={cerrarAccionAlerta}>
            Cancelar
          </button>
          <button type="button" style={refreshButton} onClick={ejecutarAccionAlerta} disabled={asignando === loadingKey}>
            {asignando === loadingKey ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    )
  }

  const renderAccionesAlerta = (turno: Turno, tipoAlerta: TipoAlertaOperativa, registro?: RegistroAsistencia) => {
    const intervenida = alertaIntervenida(turno.id, tipoAlerta)
    const puedeMarcarDescubierto = turno.estado !== 'descubierto'

    return (
      <div style={alertaAccionesBox}>
        {renderContextoAlerta(turno, tipoAlerta)}
        <div style={{ display:'flex', justifyContent:'space-between', gap:8, alignItems:'center', marginBottom:8 }}>
          <div style={label}>Acciones</div>
          {intervenida && <span style={badge('finalizado')}>Intervenida</span>}
        </div>
        <div style={alertaActionGrid}>
          <button type="button" style={secondaryButton} onClick={() => abrirAccionAlerta(turno, tipoAlerta, 'confirmar_cubierto', registro)}>
            Confirmar cubierto
          </button>
          <button type="button" style={secondaryButton} onClick={() => abrirAccionAlerta(turno, tipoAlerta, 'reasignacion', registro)}>
            Reasignar
          </button>
          <button
            type="button"
            style={{ ...dangerButton, opacity: puedeMarcarDescubierto ? 1 : 0.55 }}
            disabled={!puedeMarcarDescubierto}
            onClick={() => abrirAccionAlerta(turno, tipoAlerta, 'marcado_descubierto', registro)}
          >
            Marcar descubierto
          </button>
          <button type="button" style={secondaryButton} onClick={() => abrirAccionAlerta(turno, tipoAlerta, 'comentario', registro)}>
            Comentar
          </button>
        </div>
        {renderPanelAccion(turno, tipoAlerta)}
        {renderHistorialAlerta(turno, tipoAlerta)}
      </div>
    )
  }

  const renderAlertaIntervenida = ({ turno, tipoAlerta, intervencion }: AlertaIntervenida) => {
    const objetivo = getObjetivo(turno.objetivo_id)
    const registro = getRegistro(turno.id)
    const guardia = getGuardia(registro?.guardia_id || turno.guardia_id)

    return (
      <div key={`intervenida-${turno.id}-${tipoAlerta}`} style={{ ...turnoCard, background: '#111827' }}>
        <div style={turnoTop}>
          <div>
            <div style={objetivoName}>{objetivo?.nombre || 'Objetivo sin nombre'}</div>
            <div style={muted}>{guardia ? `${guardia.apellido}, ${guardia.nombre}` : nombreGuardiaEsperado(turno)}</div>
            <div style={muted}>Horario: {horaCorta(turno.hora_inicio)} a {horaCorta(turno.hora_fin)}</div>
            <div style={muted}>Tipo de alerta: {tipoAlerta}</div>
          </div>
          <span style={badge('finalizado')}>Intervenida</span>
        </div>

        <div style={contextoAlertaBox}>
          <div>
            <div style={label}>Acción realizada</div>
            <div style={registroValue}>{accionLabel(intervencion.accion)}</div>
          </div>
          <div>
            <div style={label}>Supervisor que intervino</div>
            <div style={registroValue}>{nombreSupervisor(intervencion.supervisor_intervino_id || intervencion.supervisor_id)}</div>
          </div>
          <div>
            <div style={label}>Supervisor asignado</div>
            <div style={registroValue}>{intervencion.supervisor_asignado_id ? nombreSupervisor(intervencion.supervisor_asignado_id) : nombreSupervisorGuardia(turno)}</div>
          </div>
          <div>
            <div style={label}>Fecha/hora</div>
            <div style={registroValue}>{fechaHoraDDMMYYYY(intervencion.created_at)}</div>
          </div>
          <div>
            <div style={label}>Estado</div>
            <div style={registroValue}>Intervenida</div>
          </div>
          <div style={{ gridColumn:'1 / -1' }}>
            <div style={label}>Comentario</div>
            <div style={registroValue}>{intervencion.comentario || '—'}</div>
          </div>
        </div>

        {renderHistorialAlerta(turno, tipoAlerta)}
      </div>
    )
  }

  const renderTurno = (turno: Turno) => {
    const objetivo = getObjetivo(turno.objetivo_id)
    const guardia = getGuardia(turno.guardia_id)
    const registrosTurno = getRegistrosTurno(turno.id)
    const registro = getRegistro(turno.id)
    const estado = estadoOperativo(turno)
    const alerta = alertaTurno(turno)
    const puedeMarcarDescubierto = !registro?.hora_entrada_real && estado !== 'descubierto'
    const registrosAbiertos = turnoRegistrosAbierto === turno.id
    const gpsIngreso = resumenGps(registro, 'ingreso')
    const gpsEgreso = resumenGps(registro, 'egreso')

    return (
      <div key={turno.id} style={turnoCard}>
        <div style={turnoTop}>
          <div>
            <div style={horario}>{horaCorta(turno.hora_inicio)} a {horaCorta(turno.hora_fin)}</div>
            <div style={muted}>{guardia ? `${guardia.apellido}, ${guardia.nombre}` : 'Sin guardia asignado'}</div>
          </div>
          <span style={badge(estado)}>{estado}</span>
        </div>

        <label style={label}>Asignar guardia</label>
        <select
          value={turno.guardia_id || ''}
          onChange={e => cambiarGuardia(turno, e.target.value)}
          disabled={asignando === turno.id}
          style={select}
        >
          <option value="">Sin asignar</option>
          {guardias.filter(g => g.estado === 'activo').map(g => (
            <option key={g.id} value={g.id}>
              {g.apellido}, {g.nombre}{g.legajo ? ` - ${g.legajo}` : ''}
            </option>
          ))}
        </select>

        <div style={registroBox}>
          <div>
            <div style={label}>Fecha</div>
            <div style={registroValue}>{fechaDDMMYYYY(turno.fecha)}</div>
          </div>
          <div>
            <div style={label}>Entrada real</div>
            <div style={registroValue}>{horaCorta(registro?.hora_entrada_real)}</div>
          </div>
          <div>
            <div style={label}>Salida real</div>
            <div style={registroValue}>{horaCorta(registro?.hora_salida_real)}</div>
          </div>
          <div>
            <div style={label}>Horas</div>
            <div style={registroValue}>{horasCortas(registro?.horas_trabajadas)}</div>
          </div>
          <div>
            <div style={label}>Asistencia</div>
            <div style={{ ...registroValue, color: alerta === 'sin entrada' ? '#f59e0b' : '#10b981' }}>{alerta}</div>
          </div>
          <div>
            <div style={label}>GPS ingreso</div>
            <div style={{ ...registroValue, color: gpsIngreso.includes('Sin GPS') ? '#f59e0b' : '#10b981' }}>{gpsIngreso}</div>
          </div>
          <div>
            <div style={label}>GPS egreso</div>
            <div style={{ ...registroValue, color: gpsEgreso.includes('Sin GPS') ? '#f59e0b' : '#10b981' }}>{gpsEgreso}</div>
          </div>
        </div>

        <div style={turnoActions}>
          <button
            type="button"
            onClick={() => marcarDescubierto(turno)}
            disabled={!puedeMarcarDescubierto || asignando === turno.id}
            style={{
              ...dangerButton,
              opacity: !puedeMarcarDescubierto || asignando === turno.id ? 0.55 : 1,
              cursor: !puedeMarcarDescubierto || asignando === turno.id ? 'not-allowed' : 'pointer',
            }}
          >
            Marcar descubierto
          </button>

          <button
            type="button"
            onClick={() => setTurnoRegistrosAbierto(registrosAbiertos ? null : turno.id)}
            style={secondaryButton}
          >
            {registrosAbiertos ? 'Ocultar registros' : `Ver registros (${registrosTurno.length})`}
          </button>
        </div>

        {registrosAbiertos && (
          <div style={registrosDetalle}>
            {registrosTurno.length === 0 ? (
              <div style={muted}>Sin registros de asistencia asociados.</div>
            ) : registrosTurno.map((r, index) => {
              const registroGuardia = getGuardia(r.guardia_id)

              return (
                <div key={r.id} style={registroItem}>
                  <div style={registroItemTop}>
                    <strong>Registro {registrosTurno.length - index}</strong>
                    <span style={muted}>{fechaDDMMYYYY(turno.fecha)}</span>
                  </div>
                  <div style={muted}>{objetivo?.nombre || 'Objetivo sin nombre'}</div>
                  <div style={muted}>
                    {registroGuardia ? `${registroGuardia.apellido}, ${registroGuardia.nombre}` : 'Guardia no encontrado'}
                  </div>
                  <div style={registroLine}>
                    <span>Entrada {horaCorta(r.hora_entrada_real)}</span>
                    <span>Salida {horaCorta(r.hora_salida_real)}</span>
                    <span>{horasCortas(r.horas_trabajadas)}</span>
                  </div>
                  <div style={muted}>{resumenGps(r, 'ingreso')}</div>
                  <div style={muted}>{resumenGps(r, 'egreso')}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={container}>
      <header style={header}>
        <div>
          <div style={brand}>Supervisor Mobile</div>
          <div style={muted}>{user?.nombre} {user?.apellido}</div>
        </div>

        <button onClick={cerrarSesion} style={logoutButton}>
          Cerrar sesión
        </button>
      </header>

      <main style={main}>
        {error && <div style={errorBox}>{error}</div>}
        {mensaje && (
          <div style={{ ...errorBox, color:'#10b981', borderColor:'rgba(16,185,129,.35)', background:'rgba(16,185,129,.12)', whiteSpace:'pre-line' }}>
            {mensaje}
          </div>
        )}

        {loading ? (
          <div style={empty}>Cargando operación...</div>
        ) : (
          <>
            {tab === 'inicio' && (
              <section>
                <div style={screenTitle}>Operación</div>
                <div style={dateText}>{rangoFecha.label} · {fechaDDMMYYYY(rangoFecha.desde)}{rangoFecha.desde !== rangoFecha.hasta ? ` a ${fechaDDMMYYYY(rangoFecha.hasta)}` : ''}</div>
                {renderFiltrosFecha()}

                <div style={statsGrid}>
                  <div style={{ ...statCard, cursor:'pointer' }} onClick={() => { setFiltroTurnos('todos'); setTab('turnos') }}><strong>{resumen.total}</strong><span>Turnos</span></div>
                  <div style={{ ...statCard, cursor:'pointer' }} onClick={() => { setFiltroTurnos('en turno'); setTab('turnos') }}><strong>{resumen.enTurno}</strong><span>En turno</span></div>
                  <div style={{ ...statCard, cursor:'pointer' }} onClick={() => { setFiltroTurnos('finalizado'); setTab('turnos') }}><strong>{resumen.finalizados}</strong><span>Finalizados</span></div>
                  <div style={{ ...statCard, cursor:'pointer' }} onClick={() => { setFiltroTurnos('descubierto'); setTab('turnos') }}><strong>{resumen.descubiertos}</strong><span>Descubiertos</span></div>
                </div>

                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  <button style={refreshButton} onClick={() => cargarDatos(filtroFecha)}>Actualizar</button>
                  <button
                    style={{ ...secondaryButton, opacity: activandoPush ? 0.65 : 1 }}
                    onClick={activarPush}
                    disabled={activandoPush}
                  >
                    {activandoPush ? 'Activando...' : 'Activar notificaciones'}
                  </button>
                  <button style={secondaryButton} onClick={() => { setError(''); setMensaje(''); setModalTurno(true) }}>Crear turno</button>
                  <button
                    style={{ ...secondaryButton, gridColumn:'1 / -1', opacity: asignando === 'repetir-ayer' ? 0.65 : 1 }}
                    onClick={repetirAyer}
                    disabled={asignando === 'repetir-ayer'}
                  >
                    {asignando === 'repetir-ayer' ? 'Repitiendo...' : 'Repetir ayer'}
                  </button>
                </div>
              </section>
            )}

            {tab === 'turnos' && (
              <section>
                <div style={screenTitle}>Turnos por objetivo</div>
                <div style={dateText}>{rangoFecha.label} · {fechaDDMMYYYY(rangoFecha.desde)}{rangoFecha.desde !== rangoFecha.hasta ? ` a ${fechaDDMMYYYY(rangoFecha.hasta)}` : ''}</div>
                {renderFiltrosFecha()}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
                  <button style={refreshButton} onClick={() => cargarDatos(filtroFecha)}>Actualizar</button>
                  <button
                    style={{ ...secondaryButton, opacity: asignando === 'repetir-ayer' ? 0.65 : 1 }}
                    onClick={repetirAyer}
                    disabled={asignando === 'repetir-ayer'}
                  >
                    {asignando === 'repetir-ayer' ? 'Repitiendo...' : 'Repetir ayer'}
                  </button>
                </div>
                {filtroTurnos !== 'todos' && (
                  <div style={{ ...errorBox, color:'#f59e0b', borderColor:'rgba(245,158,11,.35)', background:'rgba(245,158,11,.12)' }}>
                    Filtro activo: {filtroTurnos}
                    <button style={{ ...secondaryButton, marginTop:10 }} onClick={() => setFiltroTurnos('todos')}>Limpiar filtro</button>
                  </div>
                )}

                {turnosPorObjetivo.length === 0 ? (
                  <div style={empty}>No hay turnos cargados para este filtro.</div>
                ) : turnosPorObjetivo.map(grupo => (
                  <div key={grupo.objetivo.id} style={card}>
                    <div style={objetivoName}>{grupo.objetivo.nombre}</div>
                    {grupo.objetivo.direccion && <div style={muted}>{grupo.objetivo.direccion}</div>}
                    <div style={{ marginTop: 12 }}>
                      {grupo.turnos.map(renderTurno)}
                    </div>
                  </div>
                ))}
              </section>
            )}

            {tab === 'guardias' && (
              <section>
                <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'center', marginBottom:12 }}>
                  <div>
                    <div style={screenTitle}>Guardias activos</div>
                    <div style={dateText}>Altas y bajas se envían a aprobación administrativa.</div>
                  </div>
                  <button style={{ ...secondaryButton, width:'auto', padding:'10px 12px' }} onClick={() => { setError(''); resetFormNuevoGuardia(); setModalNuevoGuardia(true) }}>
                    Solicitar nuevo
                  </button>
                </div>

                {guardias.filter(g => g.estado === 'activo').map(g => (
                  <div key={g.id} style={card}>
                    <div style={objetivoName}>{g.apellido}, {g.nombre}</div>
                    <div style={muted}>{g.legajo || 'Sin legajo'}</div>
                    <div style={muted}>{g.email || 'Sin email'}{g.telefono ? ` · ${g.telefono}` : ''}</div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:12 }}>
                      <button style={secondaryButton} onClick={() => abrirEditarGuardia(g)}>
                        Editar datos
                      </button>
                      <button
                        style={{ ...dangerButton, opacity: asignando === `baja-guardia-${g.id}` ? 0.65 : 1 }}
                        onClick={() => solicitarBajaGuardia(g)}
                        disabled={asignando === `baja-guardia-${g.id}`}
                      >
                        {asignando === `baja-guardia-${g.id}` ? 'Enviando...' : 'Solicitar baja'}
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            {tab === 'objetivos' && (
              <section>
                <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'center', marginBottom:12 }}>
                  <div>
                    <div style={screenTitle}>Objetivos</div>
                    <div style={dateText}>Altas y bajas se envían a aprobación administrativa.</div>
                  </div>
                  <button style={{ ...secondaryButton, width:'auto', padding:'10px 12px' }} onClick={() => { setError(''); resetFormNuevoObjetivo(); setModalNuevoObjetivo(true) }}>
                    Solicitar objetivo
                  </button>
                </div>
                {objetivos.map(objetivo => (
                  <div key={objetivo.id} style={card}>
                    <div style={objetivoName}>{objetivo.nombre}</div>
                    <div style={muted}>{objetivo.direccion || 'Sin dirección'}</div>
                    <div style={muted}>Radio {objetivo.radio_metros || 200}m · Estado {objetivo.estado || 'activo'}</div>
                    <div style={muted}>GPS {objetivo.lat ?? '—'}, {objetivo.lng ?? '—'} · {ubicacionObjetivoCompleta(objetivo) ? 'Ubicación completa' : 'Falta GPS'}</div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:12 }}>
                      <button style={secondaryButton} onClick={() => abrirEditarObjetivo(objetivo)}>
                        Editar
                      </button>
                      <button
                        style={secondaryButton}
                        onClick={() => actualizarUbicacionObjetivo(objetivo)}
                        disabled={asignando === `gps-${objetivo.id}`}
                      >
                        {asignando === `gps-${objetivo.id}` ? 'Actualizando...' : 'Actualizar ubicación'}
                      </button>
                      <button
                        style={{ ...dangerButton, gridColumn:'1 / -1', opacity: asignando === `baja-objetivo-${objetivo.id}` ? 0.65 : 1 }}
                        onClick={() => solicitarBajaObjetivo(objetivo)}
                        disabled={asignando === `baja-objetivo-${objetivo.id}` || objetivo.estado === 'inactivo'}
                      >
                        {asignando === `baja-objetivo-${objetivo.id}` ? 'Enviando...' : objetivo.estado === 'inactivo' ? 'Objetivo inactivo' : 'Solicitar baja'}
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            {tab === 'solicitudes' && (
              <section>
                <div style={screenTitle}>Mis solicitudes</div>
                <div style={dateText}>Seguimiento de altas y bajas enviadas a administración.</div>

                {solicitudesAdmin.length === 0 ? (
                  <div style={empty}>No tenés solicitudes registradas.</div>
                ) : solicitudesAdmin.map(solicitud => {
                  const datos = solicitud.datos_json || {}
                  const colorEstado: EstadoTurno = solicitud.estado === 'aprobado'
                    ? 'finalizado'
                    : solicitud.estado === 'rechazado'
                      ? 'descubierto'
                      : 'pendiente de ingreso'

                  return (
                    <div key={solicitud.id} style={card}>
                      <div style={turnoTop}>
                        <div>
                          <div style={objetivoName}>{tipoSolicitudLabel(solicitud.tipo)}</div>
                          <div style={muted}>{datos.nombre ? `${datos.apellido ? `${datos.apellido}, ` : ''}${datos.nombre}` : solicitud.entidad}</div>
                          <div style={muted}>{fechaDDMMYYYY(solicitud.created_at)}</div>
                        </div>
                        <span style={badge(colorEstado)}>{solicitud.estado}</span>
                      </div>
                      <div style={registrosDetalle}>
                        {Object.entries(datos).slice(0, 6).map(([key, value]) => (
                          <div key={key} style={registroItem}>
                            <strong>{key.replace(/_/g, ' ')}</strong>
                            <div style={muted}>{value === null || value === undefined || value === '' ? '—' : String(value)}</div>
                          </div>
                        ))}
                        {solicitud.comentario_admin && (
                          <div style={registroItem}>
                            <strong>Comentario admin</strong>
                            <div style={muted}>{solicitud.comentario_admin}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </section>
            )}

            {tab === 'alertas' && (
              <section>
                <div style={screenTitle}>Alertas de asistencia</div>
                <div style={{ ...objetivoName, marginBottom: 8 }}>Alertas pendientes</div>

                {totalAlertasPendientes === 0 && (
                  <div style={empty}>No hay alertas pendientes.</div>
                )}

                {turnosDescubiertosPendientes.length > 0 && (
                  <div style={{ ...card, borderColor: 'rgba(239,68,68,.35)', background: 'rgba(239,68,68,.08)' }}>
                    <div style={{ ...objetivoName, color: '#fca5a5' }}>Puestos sin cobertura</div>
                    <div style={muted}>{turnosDescubiertosPendientes.length} turno(s) requieren acción.</div>

                    <div style={{ marginTop: 12 }}>
                      {turnosDescubiertosPendientes.map(turno => {
                        const objetivo = getObjetivo(turno.objetivo_id)

                        return (
                          <div key={`alerta-descubierto-${turno.id}`} style={{ ...turnoCard, background: '#111827' }}>
                            <div style={turnoTop}>
                              <div>
                                <div style={objetivoName}>{objetivo?.nombre || 'Objetivo sin nombre'}</div>
                                <div style={muted}>Horario: {horaCorta(turno.hora_inicio)} a {horaCorta(turno.hora_fin)}</div>
                                <div style={muted}>Estado: {turno.estado || 'programado'}</div>
                                <div style={muted}>Guardia esperado: {nombreGuardiaEsperado(turno)}</div>
                                <div style={{ ...muted, color: '#f59e0b' }}>{detalleTurnoDescubierto(turno)}</div>
                              </div>
                              <span style={badge('descubierto')}>descubierto</span>
                            </div>
                            {renderAccionesAlerta(turno, 'descubierto')}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {turnosSinIngresoPendientes.length > 0 && (
                  <div style={{ ...card, borderColor: 'rgba(245,158,11,.35)', background: 'rgba(245,158,11,.08)' }}>
                    <div style={{ ...objetivoName, color: '#fbbf24' }}>Guardias sin fichar</div>
                    <div style={muted}>{turnosSinIngresoPendientes.length} turno(s) iniciados hace más de 15 minutos sin entrada registrada.</div>

                    <div style={{ marginTop: 12 }}>
                      {turnosSinIngresoPendientes.map(turno => {
                        const objetivo = getObjetivo(turno.objetivo_id)
                        const guardia = getGuardia(turno.guardia_id)

                        return (
                          <div key={`alerta-sin-ingreso-${turno.id}`} style={{ ...turnoCard, background: '#111827' }}>
                            <div style={turnoTop}>
                              <div>
                                <div style={objetivoName}>{guardia ? `${guardia.apellido}, ${guardia.nombre}` : 'Guardia sin asignar'}</div>
                                <div style={muted}>{objetivo?.nombre || 'Objetivo sin nombre'}</div>
                                <div style={muted}>Horario programado: {horaCorta(turno.hora_inicio)} a {horaCorta(turno.hora_fin)}</div>
                                <div style={{ ...muted, color: '#f59e0b' }}>Minutos de demora: {minutosAtrasoTurno(turno)}</div>
                                <div style={{ ...muted, color: '#f59e0b' }}>Estado: Sin ingreso</div>
                              </div>
                              <span style={alertBadge('sin ingreso')}>sin ingreso</span>
                            </div>
                            {renderAccionesAlerta(turno, 'sin_fichar')}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {turnosConTardanzaPendientes.length > 0 && (
                  <div style={{ ...card, borderColor: 'rgba(245,158,11,.35)', background: 'rgba(245,158,11,.08)' }}>
                    <div style={{ ...objetivoName, color: '#fbbf24' }}>Tardanzas registradas</div>
                    <div style={muted}>{turnosConTardanzaPendientes.length} turno(s) con entrada posterior al inicio programado.</div>

                    <div style={{ marginTop: 12 }}>
                      {turnosConTardanzaPendientes.map(turno => {
                        const objetivo = getObjetivo(turno.objetivo_id)
                        const registro = getRegistro(turno.id)
                        const guardia = getGuardia(registro?.guardia_id || turno.guardia_id)

                        return (
                          <div key={`alerta-tardanza-${turno.id}`} style={{ ...turnoCard, background: '#111827' }}>
                            <div style={turnoTop}>
                              <div>
                                <div style={objetivoName}>{guardia ? `${guardia.apellido}, ${guardia.nombre}` : 'Guardia sin asignar'}</div>
                                <div style={muted}>{objetivo?.nombre || 'Objetivo sin nombre'}</div>
                                <div style={muted}>Horario programado: {horaCorta(turno.hora_inicio)} a {horaCorta(turno.hora_fin)}</div>
                                <div style={muted}>Entrada real: {horaCorta(registro?.hora_entrada_real)}</div>
                                <div style={{ ...muted, color: '#f59e0b' }}>Minutos tarde: {minutosTardeRegistro(turno, registro)}</div>
                                <div style={{ ...muted, color: '#ef4444' }}>Estado: Tarde</div>
                              </div>
                              <span style={alertBadge('ingreso tarde')}>Tarde</span>
                            </div>
                            {renderAccionesAlerta(turno, 'tardanza', registro)}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {turnosConGpsFueraRadioPendientes.length > 0 && (
                  <div style={{ ...card, borderColor: 'rgba(239,68,68,.35)', background: 'rgba(239,68,68,.08)' }}>
                    <div style={{ ...objetivoName, color: '#fca5a5' }}>Fichajes fuera de radio</div>
                    <div style={muted}>{turnosConGpsFueraRadioPendientes.length} ingreso(s) registrados fuera del radio del objetivo.</div>

                    <div style={{ marginTop: 12 }}>
                      {turnosConGpsFueraRadioPendientes.map(turno => {
                        const objetivo = getObjetivo(turno.objetivo_id)
                        const registro = getRegistro(turno.id)
                        const guardia = getGuardia(registro?.guardia_id || turno.guardia_id)
                        const gps = gpsRegistro(registro, 'ingreso')

                        return (
                          <div key={`alerta-gps-radio-${turno.id}`} style={{ ...turnoCard, background: '#111827' }}>
                            <div style={turnoTop}>
                              <div>
                                <div style={objetivoName}>{guardia ? `${guardia.apellido}, ${guardia.nombre}` : 'Guardia sin asignar'}</div>
                                <div style={muted}>{objetivo?.nombre || 'Objetivo sin nombre'}</div>
                                <div style={muted}>Horario: {horaCorta(turno.hora_inicio)} a {horaCorta(turno.hora_fin)}</div>
                                <div style={muted}>Entrada real: {horaCorta(registro?.hora_entrada_real)}</div>
                                <div style={{ ...muted, color: '#ef4444' }}>Distancia: {metrosTexto(registro?.distancia_ingreso_metros)}</div>
                                <div style={muted}>Radio permitido: {metrosTexto(objetivo?.radio_metros)}</div>
                                <div style={muted}>Precisión GPS: {metrosTexto(gps?.precision)}</div>
                              </div>
                              <span style={badge('descubierto')}>Fuera del radio</span>
                            </div>
                            {renderAccionesAlerta(turno, 'fuera_radio', registro)}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div style={{ ...objetivoName, margin:'20px 0 8px' }}>Alertas intervenidas</div>
                {alertasIntervenidas.length === 0 ? (
                  <div style={empty}>No hay alertas intervenidas.</div>
                ) : (
                  <div style={{ ...card, borderColor:'rgba(16,185,129,.25)', background:'rgba(16,185,129,.07)' }}>
                    <div style={muted}>{alertasIntervenidas.length} alerta(s) resueltas por intervención.</div>
                    <div style={{ marginTop: 12 }}>
                      {alertasIntervenidas.map(renderAlertaIntervenida)}
                    </div>
                  </div>
                )}
              </section>
            )}

            {tab === 'perfil' && (
              <section>
                <div style={screenTitle}>Perfil</div>
                <div style={dateText}>Datos de usuario y seguridad</div>

                <div style={card}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
                    {user?.foto_url && <img src={user.foto_url} alt="" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover' }} />}
                    <div>
                      <div style={objetivoName}>{user?.nombre} {user?.apellido}</div>
                      <div style={muted}>{user?.rol} · Legajo {user?.legajo || '—'}</div>
                      <div style={muted}>{user?.email || 'Sin email cargado'}</div>
                    </div>
                  </div>

                  <div style={{ ...errorBox, color: '#f59e0b', borderColor: 'rgba(245,158,11,.35)', background: 'rgba(245,158,11,.12)' }}>
                    Por seguridad, cambie su contraseña inicial si todavía usa su DNI.
                  </div>

                  <label style={label}>Nueva contraseña</label>
                  <input
                    type="password"
                    value={nuevaPassword}
                    onChange={e => setNuevaPassword(e.target.value)}
                    style={input}
                  />

                  <label style={label}>Confirmar contraseña</label>
                  <input
                    type="password"
                    value={confirmarPassword}
                    onChange={e => setConfirmarPassword(e.target.value)}
                    style={input}
                  />

                  {perfilMensaje && (
                    <div style={{ ...errorBox, color: perfilMensaje.tipo === 'ok' ? '#10b981' : '#fca5a5', borderColor: perfilMensaje.tipo === 'ok' ? 'rgba(16,185,129,.35)' : 'rgba(239,68,68,.35)', background: perfilMensaje.tipo === 'ok' ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.12)' }}>
                      {perfilMensaje.texto}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={cambiarPassword}
                    disabled={guardandoPassword}
                    style={{ ...refreshButton, opacity: guardandoPassword ? 0.65 : 1 }}
                  >
                    {guardandoPassword ? 'Guardando...' : 'Cambiar contraseña'}
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {modalTurno && (
        <div style={modalOverlay}>
          <div style={modalCard}>
            <div style={screenTitle}>Crear turno</div>
            {error && <div style={errorBox}>{error}</div>}
            <label style={label}>Objetivo</label>
            <select style={select} value={formTurno.objetivo_id} onChange={e => setFormTurno({ ...formTurno, objetivo_id:e.target.value })}>
              <option value="">Seleccionar</option>
              {objetivos.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
            <label style={label}>Guardia</label>
            <select style={select} value={formTurno.guardia_id} onChange={e => setFormTurno({ ...formTurno, guardia_id:e.target.value })}>
              <option value="">Sin asignar</option>
              {guardias.filter(g => g.estado === 'activo').map(g => <option key={g.id} value={g.id}>{g.apellido}, {g.nombre}</option>)}
            </select>
            <label style={label}>Fecha</label>
            <input type="date" style={input} value={formTurno.fecha} onChange={e => setFormTurno({ ...formTurno, fecha:e.target.value })} />
            <label style={label}>Hora inicio</label>
            <input type="time" style={input} value={formTurno.hora_inicio} onChange={e => setFormTurno({ ...formTurno, hora_inicio:e.target.value })} />
            <label style={label}>Hora fin</label>
            <input type="time" style={input} value={formTurno.hora_fin} onChange={e => setFormTurno({ ...formTurno, hora_fin:e.target.value })} />
            <label style={label}>Tipo</label>
            <select style={select} value={formTurno.tipo_evento} onChange={e => setFormTurno({ ...formTurno, tipo_evento:e.target.value })}>
              <option value="normal">Normal</option>
              <option value="cobertura">Cobertura</option>
            </select>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <button style={secondaryButton} onClick={() => setModalTurno(false)}>Cancelar</button>
              <button style={refreshButton} onClick={crearTurno} disabled={asignando === 'crear-turno'}>{asignando === 'crear-turno' ? 'Creando...' : 'Crear turno'}</button>
            </div>
          </div>
        </div>
      )}

      {modalNuevoGuardia && (
        <div style={modalOverlay}>
          <div style={modalCard}>
            <div style={screenTitle}>Solicitar nuevo vigilador</div>
            <div style={muted}>La creación queda pendiente de aprobación administrativa.</div>
            {error && <div style={{ ...errorBox, marginTop:12 }}>{error}</div>}
            <label style={label}>Nombre *</label>
            <input style={input} value={formNuevoGuardia.nombre} onChange={e => setFormNuevoGuardia({ ...formNuevoGuardia, nombre:e.target.value })} />
            <label style={label}>Apellido *</label>
            <input style={input} value={formNuevoGuardia.apellido} onChange={e => setFormNuevoGuardia({ ...formNuevoGuardia, apellido:e.target.value })} />
            <label style={label}>Legajo *</label>
            <input style={input} value={formNuevoGuardia.legajo} onChange={e => setFormNuevoGuardia({ ...formNuevoGuardia, legajo:e.target.value })} />
            <label style={label}>DNI</label>
            <input style={input} value={formNuevoGuardia.dni} onChange={e => setFormNuevoGuardia({ ...formNuevoGuardia, dni:e.target.value })} />
            <label style={label}>Email</label>
            <input style={input} type="email" value={formNuevoGuardia.email} onChange={e => setFormNuevoGuardia({ ...formNuevoGuardia, email:e.target.value })} />
            <label style={label}>Teléfono</label>
            <input style={input} value={formNuevoGuardia.telefono} onChange={e => setFormNuevoGuardia({ ...formNuevoGuardia, telefono:e.target.value })} />
            <label style={label}>Rol operativo</label>
            <select style={select} value={formNuevoGuardia.rol} onChange={e => setFormNuevoGuardia({ ...formNuevoGuardia, rol:e.target.value })}>
              <option value="guardia">Guardia</option>
              <option value="vigilador">Vigilador</option>
            </select>
            <label style={label}>Foto URL</label>
            <input style={input} value={formNuevoGuardia.foto_url} onChange={e => setFormNuevoGuardia({ ...formNuevoGuardia, foto_url:e.target.value })} />
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <button style={secondaryButton} onClick={() => { setModalNuevoGuardia(false); resetFormNuevoGuardia() }}>Cancelar</button>
              <button style={refreshButton} onClick={solicitarCrearGuardia} disabled={asignando === 'solicitud-crear-guardia'}>
                {asignando === 'solicitud-crear-guardia' ? 'Enviando...' : 'Enviar solicitud'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalNuevoObjetivo && (
        <div style={modalOverlay}>
          <div style={modalCard}>
            <div style={screenTitle}>Solicitar nuevo objetivo</div>
            <div style={muted}>La creación queda pendiente de aprobación administrativa.</div>
            {error && <div style={{ ...errorBox, marginTop:12 }}>{error}</div>}
            <label style={label}>Nombre *</label>
            <input style={input} value={formNuevoObjetivo.nombre} onChange={e => setFormNuevoObjetivo({ ...formNuevoObjetivo, nombre:e.target.value })} />
            <label style={label}>Cliente</label>
            <input style={input} value={formNuevoObjetivo.cliente} onChange={e => setFormNuevoObjetivo({ ...formNuevoObjetivo, cliente:e.target.value })} />
            <label style={label}>Dirección</label>
            <input style={input} value={formNuevoObjetivo.direccion} onChange={e => setFormNuevoObjetivo({ ...formNuevoObjetivo, direccion:e.target.value })} />
            <label style={label}>Latitud</label>
            <input style={input} inputMode="decimal" value={formNuevoObjetivo.lat} onChange={e => setFormNuevoObjetivo({ ...formNuevoObjetivo, lat:e.target.value })} />
            <label style={label}>Longitud</label>
            <input style={input} inputMode="decimal" value={formNuevoObjetivo.lng} onChange={e => setFormNuevoObjetivo({ ...formNuevoObjetivo, lng:e.target.value })} />
            <label style={label}>Radio metros</label>
            <input style={input} type="number" min={50} value={formNuevoObjetivo.radio_metros} onChange={e => setFormNuevoObjetivo({ ...formNuevoObjetivo, radio_metros:e.target.value })} />
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <button style={secondaryButton} onClick={() => { setModalNuevoObjetivo(false); resetFormNuevoObjetivo() }}>Cancelar</button>
              <button style={refreshButton} onClick={solicitarCrearObjetivo} disabled={asignando === 'solicitud-crear-objetivo'}>
                {asignando === 'solicitud-crear-objetivo' ? 'Enviando...' : 'Enviar solicitud'}
              </button>
            </div>
          </div>
        </div>
      )}

      {guardiaEditando && (
        <div style={modalOverlay}>
          <div style={modalCard}>
            <div style={screenTitle}>Editar guardia</div>
            <div style={muted}>{guardiaEditando.apellido}, {guardiaEditando.nombre}</div>
            <label style={label}>Email</label>
            <input style={input} type="email" value={formGuardia.email} onChange={e => setFormGuardia({ ...formGuardia, email:e.target.value })} />
            <label style={label}>Teléfono</label>
            <input style={input} value={formGuardia.telefono} onChange={e => setFormGuardia({ ...formGuardia, telefono:e.target.value })} />
            <label style={label}>Estado</label>
            <select style={select} value={formGuardia.estado} onChange={e => setFormGuardia({ ...formGuardia, estado:e.target.value })}>
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
            </select>
            <label style={label}>Foto URL</label>
            <input style={input} value={formGuardia.foto_url} onChange={e => setFormGuardia({ ...formGuardia, foto_url:e.target.value })} />
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <button style={secondaryButton} onClick={() => setGuardiaEditando(null)}>Cancelar</button>
              <button style={refreshButton} onClick={guardarGuardia} disabled={asignando === `guardia-${guardiaEditando.id}`}>
                {asignando === `guardia-${guardiaEditando.id}` ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {objetivoEditando && (
        <div style={modalOverlay}>
          <div style={modalCard}>
            <div style={screenTitle}>Editar objetivo</div>
            <div style={muted}>{objetivoEditando.nombre}</div>
            <label style={label}>Dirección</label>
            <input style={input} value={formObjetivo.direccion} onChange={e => setFormObjetivo({ ...formObjetivo, direccion:e.target.value })} />
            <label style={label}>Latitud</label>
            <input style={input} inputMode="decimal" value={formObjetivo.lat} onChange={e => setFormObjetivo({ ...formObjetivo, lat:e.target.value })} />
            <label style={label}>Longitud</label>
            <input style={input} inputMode="decimal" value={formObjetivo.lng} onChange={e => setFormObjetivo({ ...formObjetivo, lng:e.target.value })} />
            <label style={label}>Radio metros</label>
            <input style={input} type="number" min={50} value={formObjetivo.radio_metros} onChange={e => setFormObjetivo({ ...formObjetivo, radio_metros:e.target.value })} />
            <label style={label}>Estado</label>
            <select style={select} value={formObjetivo.estado} onChange={e => setFormObjetivo({ ...formObjetivo, estado:e.target.value })}>
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
            </select>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <button style={secondaryButton} onClick={() => setObjetivoEditando(null)}>Cancelar</button>
              <button style={refreshButton} onClick={guardarObjetivo} disabled={asignando === `objetivo-${objetivoEditando.id}`}>
                {asignando === `objetivo-${objetivoEditando.id}` ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      <nav style={nav}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              ...navButton,
              background: tab === t.id ? 'rgba(245,158,11,.12)' : 'transparent',
              color: tab === t.id ? '#f59e0b' : '#94a3b8',
            }}
          >
            <div style={{ fontSize: 20 }}>{t.icon}</div>
            <div>{t.label}</div>
          </button>
        ))}
      </nav>
    </div>
  )
}

const container: React.CSSProperties = {
  minHeight: '100vh',
  background: '#0a0e1a',
  color: '#e2e8f0',
  paddingBottom: 72,
  fontFamily: 'Arial, sans-serif',
}

const header: React.CSSProperties = {
  padding: 20,
  borderBottom: '1px solid #1e2d42',
  background: '#111827',
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
}

const brand: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
  color: '#f59e0b',
}

const main: React.CSSProperties = {
  padding: 20,
}

const card: React.CSSProperties = {
  background: '#111827',
  border: '1px solid #1e2d42',
  borderRadius: 12,
  padding: 16,
  marginBottom: 12,
}

const turnoCard: React.CSSProperties = {
  background: '#1a2235',
  border: '1px solid #263449',
  borderRadius: 10,
  padding: 14,
  marginTop: 10,
}

const turnoTop: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  alignItems: 'flex-start',
  marginBottom: 12,
}

const objetivoName: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  color: '#f8fafc',
}

const horario: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  color: '#f59e0b',
}

const muted: React.CSSProperties = {
  fontSize: 13,
  color: '#94a3b8',
  marginTop: 4,
}

const label: React.CSSProperties = {
  display: 'block',
  fontSize: 10,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginBottom: 5,
}

const select: React.CSSProperties = {
  width: '100%',
  background: '#111827',
  color: '#e2e8f0',
  border: '1px solid #374151',
  borderRadius: 8,
  padding: '10px 12px',
  marginBottom: 12,
}

const input: React.CSSProperties = {
  width: '100%',
  background: '#111827',
  color: '#e2e8f0',
  border: '1px solid #374151',
  borderRadius: 8,
  padding: '10px 12px',
  marginBottom: 12,
}

const textarea: React.CSSProperties = {
  ...input,
  minHeight: 82,
  resize: 'vertical',
}

const modalOverlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,.72)',
  zIndex: 50,
  padding: 18,
  overflowY: 'auto',
}

const modalCard: React.CSSProperties = {
  ...card,
  maxWidth: 480,
  margin: '24px auto 96px',
}

const registroBox: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 8,
}

const registroValue: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: '#e2e8f0',
}

const turnoActions: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 8,
  marginTop: 12,
}

const alertaAccionesBox: React.CSSProperties = {
  marginTop: 12,
  borderTop: '1px solid #263449',
  paddingTop: 12,
}

const contextoAlertaBox: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 10,
  background: '#0f172a',
  border: '1px solid #263449',
  borderRadius: 10,
  padding: 12,
  marginBottom: 12,
}

const alertaActionGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 8,
}

const accionPanel: React.CSSProperties = {
  marginTop: 12,
  background: '#0f172a',
  border: '1px solid #263449',
  borderRadius: 10,
  padding: 12,
}

const intervencionesBox: React.CSSProperties = {
  marginTop: 12,
  background: 'rgba(15,23,42,.72)',
  border: '1px solid #263449',
  borderRadius: 10,
  padding: 10,
}

const intervencionItem: React.CSSProperties = {
  marginTop: 8,
  paddingTop: 8,
  borderTop: '1px solid rgba(148,163,184,.18)',
  color: '#94a3b8',
  fontSize: 12,
  lineHeight: 1.45,
}

const dangerButton: React.CSSProperties = {
  width: '100%',
  background: 'rgba(239,68,68,.14)',
  color: '#fca5a5',
  border: '1px solid rgba(239,68,68,.32)',
  borderRadius: 8,
  padding: '10px 8px',
  fontWeight: 800,
  fontSize: 12,
}

const secondaryButton: React.CSSProperties = {
  width: '100%',
  background: '#111827',
  color: '#e2e8f0',
  border: '1px solid #374151',
  borderRadius: 8,
  padding: '10px 8px',
  fontWeight: 800,
  fontSize: 12,
  cursor: 'pointer',
}

const registrosDetalle: React.CSSProperties = {
  marginTop: 12,
  borderTop: '1px solid #263449',
  paddingTop: 12,
}

const registroItem: React.CSSProperties = {
  background: '#111827',
  border: '1px solid #263449',
  borderRadius: 8,
  padding: 10,
  marginTop: 8,
}

const registroItemTop: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  color: '#f8fafc',
  fontSize: 13,
}

const registroLine: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr .8fr',
  gap: 8,
  marginTop: 8,
  fontSize: 12,
  color: '#cbd5e1',
}

const screenTitle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  color: '#f8fafc',
}

const dateText: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: 13,
  marginTop: 4,
  marginBottom: 16,
}

const statsGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 10,
  margin: '16px 0',
}

const statCard: React.CSSProperties = {
  ...card,
  marginBottom: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const refreshButton: React.CSSProperties = {
  width: '100%',
  background: '#f59e0b',
  color: '#111827',
  border: 'none',
  borderRadius: 10,
  padding: 14,
  fontWeight: 800,
}

const logoutButton: React.CSSProperties = {
  alignSelf: 'flex-start',
  background: '#dc2626',
  color: 'white',
  border: 'none',
  padding: '8px 12px',
  borderRadius: 8,
  cursor: 'pointer',
}

const errorBox: React.CSSProperties = {
  background: 'rgba(239,68,68,.12)',
  border: '1px solid rgba(239,68,68,.35)',
  color: '#fca5a5',
  borderRadius: 10,
  padding: 12,
  marginBottom: 12,
}

const empty: React.CSSProperties = {
  ...card,
  textAlign: 'center',
  color: '#94a3b8',
}

const nav: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 0,
  display: 'flex',
  background: '#111827',
  borderTop: '1px solid #1e2d42',
}

const navButton: React.CSSProperties = {
  flex: 1,
  padding: '10px 4px',
  border: 'none',
  fontSize: 12,
  cursor: 'pointer',
}

function badge(estado: EstadoTurno): React.CSSProperties {
  const colores: Record<EstadoTurno, { bg: string, color: string }> = {
    programado: { bg: 'rgba(100,116,139,.18)', color: '#cbd5e1' },
    'pendiente de ingreso': { bg: 'rgba(245,158,11,.18)', color: '#fbbf24' },
    tardanza: { bg: 'rgba(245,158,11,.18)', color: '#f59e0b' },
    cubierto: { bg: 'rgba(59,130,246,.18)', color: '#60a5fa' },
    'en turno': { bg: 'rgba(16,185,129,.18)', color: '#10b981' },
    finalizado: { bg: 'rgba(16,185,129,.18)', color: '#10b981' },
    descubierto: { bg: 'rgba(239,68,68,.18)', color: '#f87171' },
    reasignado: { bg: 'rgba(59,130,246,.18)', color: '#93c5fd' },
  }
  const c = colores[estado]

  return {
    display: 'inline-flex',
    padding: '4px 9px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 800,
    background: c.bg,
    color: c.color,
    whiteSpace: 'nowrap',
  }
}

function alertBadge(alerta: TipoAlerta): React.CSSProperties {
  const color = alerta === 'turno descubierto'
    ? '#ef4444'
    : alerta === 'sin entrada' || alerta === 'sin ingreso' || alerta === 'ingreso tarde'
      ? '#f59e0b'
      : alerta === 'reasignado'
        ? '#60a5fa'
        : '#10b981'

  return {
    display: 'inline-flex',
    padding: '4px 9px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 800,
    background: `${color}22`,
    color,
    whiteSpace: 'nowrap',
  }
}
