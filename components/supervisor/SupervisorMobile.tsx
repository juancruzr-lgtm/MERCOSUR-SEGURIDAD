'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { activarNotificacionesPush } from '@/lib/push-client'
import { FILTROS_FECHA_TURNOS, MENSAJE_TURNO_SUPERPUESTO, fechasVecinasTurno, fechaActualTurno, filtroFechaTurnosIncluye, filtroFechaTurnosParaFecha, rangoFiltroFechaTurnos, sumarDiasFecha, tieneTurnoSuperpuesto, turnoSinCoberturaEnObjetivoOperativo, idsObjetivosPausados } from '@/lib/turnos'
import type { FiltroFechaTurnos } from '@/lib/turnos'
import { formatFechaHora } from '@/lib/formato'
// Única ruta para escribir la ubicación de un objetivo: abre la vigencia en el
// historial y deja el cambio auditado. El UPDATE directo ya no está permitido.
// Con alias: este componente ya tiene una función local llamada
// `actualizarUbicacionObjetivo` (el handler del botón "usar mi ubicación").
import { actualizarUbicacionObjetivo as guardarUbicacionObjetivo } from '@/lib/legajo-objetivo'
import { initTelemetry, endSession } from '@/lib/telemetry'
import { useSupervisorGps } from '@/lib/supervisor-gps'
import { MENSAJE_SIN_PUESTOS_ACTIVOS, obtenerPuestosActivos, resolverPuestoTurno } from '@/lib/puestos'
import { CARACTERISTICAS_TURNO, ETIQUETA_CARACTERISTICA } from '@/lib/caracteristica-turno'
import type { EstadoPuestos } from '@/lib/puestos'
import BandejaPlanillas from '@/components/supervisor/BandejaPlanillas'
import CentroOperativoObjetivo from '@/components/objetivos/CentroOperativoObjetivo'
import RondaAlertasPanel from '@/components/rondas/RondaAlertasPanel'
import RondasPausadasPanel from '@/components/rondas/RondasPausadasPanel'
import ControlDeRondasPanel from '@/components/rondas/ControlDeRondasPanel'
import { resumirRondasAlcance, type RondaAlerta } from '@/lib/rondas'
import { estadoSupervision, frecuenciaSupervision, supervisionProximaAVencer } from '@/lib/supervisiones'
import { alertaEstaIntervenida, calcularMinutosTardanzaRegistro, claveOcurrenciaAlerta, compararIntervencionesMasReciente, efectoIntervencionOperativa, intervencionesDeOcurrencia } from '@/lib/revision-operativa'
import type { AccionIntervencionOperativa, TipoAlertaOperativa as TipoAlertaOperativaCompartida } from '@/lib/revision-operativa'

type EstadoTurno = 'programado' | 'pendiente de ingreso' | 'tardanza' | 'cubierto' | 'en turno' | 'finalizado' | 'descubierto' | 'reasignado'
type EstadoTurnoPersistido = 'programado' | 'cubierto' | 'descubierto'
type TipoAlerta = 'sin entrada' | 'sin ingreso' | 'entrada registrada' | 'salida registrada' | 'turno descubierto' | 'ingreso tarde' | 'reasignado'
type TipoAlertaOperativa = Exclude<TipoAlertaOperativaCompartida, 'salida_pendiente'>
type AccionIntervencion = AccionIntervencionOperativa
type TipoSolicitudAdmin = 'crear_objetivo' | 'baja_objetivo' | 'crear_vigilador' | 'baja_vigilador'

const ZONA_OPERATIVA = 'Rosario / General'
const JEFE_OPERATIVO = 'Aldo Monzón'
const DIRECTOR_TECNICO = 'Rodolfo Romero'
const GPS_PRECISION_MAX_METROS = 100

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
  checklist_plantilla_id?: string | null
  frecuencia_supervision_horas?: number | null
  zona_id?: string | null
}

interface ZonaOperativa {
  id: string
  nombre: string
  estado?: string
}

interface SupervisorZona {
  id: string
  supervisor_id: string
  zona_id: string
}

type EstadoSupervision = 'ok' | 'con_observacion' | 'critico' | 'incompleta'
type ResultadoChecklist = 'correcto' | 'observado' | 'no_aplica'

interface ChecklistPlantilla {
  id: string
  nombre: string
  descripcion?: string | null
  activo: boolean
}

interface ChecklistItem {
  id: string
  plantilla_id: string
  texto: string
  orden: number
  obligatorio: boolean
  criticidad: 'normal' | 'alta'
  foto_obligatoria: boolean
  activo: boolean
}

interface Supervision {
  id: string
  objetivo_id: string
  supervisor_id: string
  plantilla_id?: string | null
  lat: number | string
  lng: number | string
  precision_gps: number | string
  estado: EstadoSupervision
  observaciones?: string | null
  created_at: string
  objetivo?: Pick<Objetivo, 'nombre'> | null
  respuestas?: Pick<SupervisionRespuesta, 'resultado'>[]
  fotos?: Pick<SupervisionFoto, 'id' | 'storage_path'>[]
}

interface SupervisionGps {
  lat: number
  lng: number
  precision: number
}

interface SupervisionRespuesta {
  id: string
  supervision_id: string
  item_id: string
  resultado: ResultadoChecklist
  observacion?: string | null
  item?: ChecklistItem | null
}

interface SupervisionFoto {
  id: string
  supervision_id: string
  storage_path: string
  created_at?: string
  signedUrl?: string | null
  publicUrl?: string | null
  error?: string | null
}

interface Evidencia {
  id: string
  proceso_id: string
  tipo_evidencia: string
  storage_path: string
  bucket: string
  signedUrl?: string | null
}

interface RegistroAsistencia {
  id: string
  turno_id: string
  guardia_id: string
  hora_entrada_real?: string | null
  hora_salida_real?: string | null
  hora_entrada_final?: string | null
  hora_salida_final?: string | null
  horas_trabajadas?: number | null
  tipo_registro?: string | null
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
  registro?: RegistroAsistencia
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

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'] as const

function infoTurnoAlerta(turno: { fecha: string; hora_inicio: string; hora_fin: string }) {
  const [y, m, d] = turno.fecha.slice(0, 10).split('-').map(Number)
  const fechaDate = new Date(y, m - 1, d)
  const dia = DIAS_SEMANA[fechaDate.getDay()]
  const dd = String(d).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  const fechaFmt = `${dd}/${mm}/${y}`
  const esNocturno = turno.hora_fin <= turno.hora_inicio
  const fechaFinDate = esNocturno ? new Date(y, m - 1, d + 1) : fechaDate
  const dFin = String(fechaFinDate.getDate()).padStart(2, '0')
  const mFin = String(fechaFinDate.getMonth() + 1).padStart(2, '0')
  const yFin = fechaFinDate.getFullYear()
  const fechaFinFmt = `${dFin}/${mFin}/${yFin}`
  const ahora = new Date()
  const [hi, mi] = turno.hora_inicio.split(':').map(Number)
  const [hf, mf] = turno.hora_fin.split(':').map(Number)
  const inicioDate = new Date(y, m - 1, d, hi, mi)
  const finDate = new Date(fechaFinDate.getFullYear(), fechaFinDate.getMonth(), fechaFinDate.getDate(), hf, mf)
  let estadoTemporal: 'en_curso' | 'finalizado' | 'antiguo' = 'antiguo'
  if (ahora >= inicioDate && ahora <= finDate) estadoTemporal = 'en_curso'
  else if (ahora > finDate && (ahora.getTime() - finDate.getTime()) < 86400000) estadoTemporal = 'finalizado'
  return {
    linea: `Turno: ${dia} ${fechaFmt}`,
    inicio: `Inicio: ${fechaFmt} ${horaCorta(turno.hora_inicio)}`,
    fin: `Fin: ${fechaFinFmt} ${horaCorta(turno.hora_fin)}`,
    nocturno: esNocturno,
    estadoTemporal,
  }
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

  return formatFechaHora(fecha)
}

function fechaLocalISO(fecha: Date | string = new Date()): string {
  return new Date(fecha).toLocaleDateString('sv-SE')
}

function inicioDiaLocalISO(fecha: string): string {
  const [year, month, day] = fecha.split('-').map(Number)
  return new Date(year, month - 1, day, 0, 0, 0).toISOString()
}

function finDiaLocalISO(fecha: string): string {
  const [year, month, day] = fecha.split('-').map(Number)
  return new Date(year, month - 1, day + 1, 0, 0, 0).toISOString()
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


function numeroGps(value: unknown): number | null {
  const numero = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(numero) ? numero : null
}

function distanciaMetrosCoordenadas(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radioTierra = 6371000
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
    Math.sin(dLng / 2) ** 2

  return 2 * radioTierra * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function auditoriaSupervisionGps(latValue: unknown, lngValue: unknown, precisionValue: unknown, objetivo?: Objetivo | null) {
  const lat = numeroGps(latValue)
  const lng = numeroGps(lngValue)
  const precision = numeroGps(precisionValue)
  const objetivoLat = numeroGps(objetivo?.lat)
  const objetivoLng = numeroGps(objetivo?.lng)
  const radio = numeroGps(objetivo?.radio_metros)
  const distancia = lat !== null && lng !== null && objetivoLat !== null && objetivoLng !== null
    ? distanciaMetrosCoordenadas(lat, lng, objetivoLat, objetivoLng)
    : null
  const dentroRadio = distancia !== null && radio !== null && radio > 0
    ? distancia <= radio
    : null

  return {
    lat,
    lng,
    precision,
    gpsImpreciso: precision !== null && precision > GPS_PRECISION_MAX_METROS,
    objetivoLat,
    objetivoLng,
    radio,
    distancia_objetivo_metros: distancia,
    dentro_radio: dentroRadio,
  }
}

function estadoRadioSupervisionTexto(auditoria: ReturnType<typeof auditoriaSupervisionGps> | null) {
  if (!auditoria || auditoria.distancia_objetivo_metros === null) return 'Objetivo sin GPS'
  if (auditoria.dentro_radio === null) return 'Radio no configurado'
  return auditoria.dentro_radio ? 'Dentro del radio permitido' : 'Fuera del radio permitido'
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
  const [objetivoLegajoId, setObjetivoLegajoId] = useState<string | null>(null)
  // Rondas pendientes de todo el alcance. Se cargan una vez, en el panel montado
  // en Inicio, y el mismo listado alimenta el contador y la pestaña Rondas.
  const [rondaAlertas, setRondaAlertas] = useState<RondaAlerta[]>([])
  // Coordina Control de Rondas con el panel de pausadas: son hermanos y sin
  // esto la pausa recién se veía al recargar la pantalla.
  const [pausasToken, setPausasToken] = useState(0)
  // Fuerza el remontaje del panel de alertas de rondas desde el botón
  // Actualizar de Inicio: el panel trae sus propias alertas al montarse y no
  // expone una forma de recargarlo desde afuera.
  const [recargaRondas, setRecargaRondas] = useState(0)
  // Turno al que hay que llevar al supervisor desde una alerta, para que no
  // tenga que buscarlo a mano en la lista.
  const [turnoFoco, setTurnoFoco] = useState<string | null>(null)
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [guardias, setGuardias] = useState<Usuario[]>([])
  const [supervisores, setSupervisores] = useState<Usuario[]>([])
  const [objetivos, setObjetivos] = useState<Objetivo[]>([])
  // Un turno en un objetivo pausado no ocupa al vigilador: se conserva pero no
  // bloquea asignarlo en un objetivo activo. Mismo criterio que la RPC.
  const objetivosPausados = idsObjetivosPausados(objetivos)
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
  const [formTurno, setFormTurno] = useState({ objetivo_id:'', puesto_id:'', guardia_id:'', fecha: fechaHoy(), hora_inicio:'18:00', hora_fin:'06:00', tipo_evento:'normal' })
  const [estadoPuestosTurno, setEstadoPuestosTurno] = useState<EstadoPuestos | null>(null)
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
  const operacionesAlertaEnCurso = useRef<Set<string>>(new Set())
  const operacionesAlertaIds = useRef<Map<string, string>>(new Map())
  const [historialesAlertaExpandidos, setHistorialesAlertaExpandidos] = useState<Set<string>>(new Set())
  const [mensaje, setMensaje] = useState('')
  const [activandoPush, setActivandoPush] = useState(false)
  const [checklistPlantillas, setChecklistPlantillas] = useState<ChecklistPlantilla[]>([])
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([])
  const [supervisiones, setSupervisiones] = useState<Supervision[]>([])
  const [zonasOperativas, setZonasOperativas] = useState<ZonaOperativa[]>([])
  const [supervisorZonas, setSupervisorZonas] = useState<SupervisorZona[]>([])
  const [ultimaSupervisionPorObjetivo, setUltimaSupervisionPorObjetivo] = useState<Record<string, string>>({})
  const [agendaZonaFiltro, setAgendaZonaFiltro] = useState('todas')
  const [agendaEstadoFiltro, setAgendaEstadoFiltro] = useState<'todos'|'vencido'|'proximo'>('todos')
  const [supervisionObjetivoId, setSupervisionObjetivoId] = useState('')
  const [supervisionGps, setSupervisionGps] = useState<SupervisionGps | null>(null)
  const [supervisionObservaciones, setSupervisionObservaciones] = useState('')
  const [supervisionRespuestas, setSupervisionRespuestas] = useState<Record<string, { resultado: ResultadoChecklist, observacion: string }>>({})
  const [supervisionFotos, setSupervisionFotos] = useState<File[]>([])
  const [confirmarGpsImpreciso, setConfirmarGpsImpreciso] = useState(false)
  const [capturandoGps, setCapturandoGps] = useState(false)
  const [detalleSupervision, setDetalleSupervision] = useState<Supervision | null>(null)
  const [detalleRespuestas, setDetalleRespuestas] = useState<SupervisionRespuesta[]>([])
  const [detalleFotos, setDetalleFotos] = useState<SupervisionFoto[]>([])
  const [detalleLoading, setDetalleLoading] = useState(false)
  const [detalleError, setDetalleError] = useState('')
  const [evidenciasPorRegistro, setEvidenciasPorRegistro] = useState<Record<string, Evidencia[]>>({})
  const [cargandoEvidencias, setCargandoEvidencias] = useState<string | null>(null)
  const [turnoEditandoSup, setTurnoEditandoSup] = useState<Turno | null>(null)
  const [formEdicionSup, setFormEdicionSup] = useState({ guardia_id: '', hora_inicio: '', hora_fin: '', estado: 'programado' as EstadoTurnoPersistido, comentario: '' })
  const [estadoOpEdicionSup, setEstadoOpEdicionSup] = useState<'FUTURO' | 'EN_CURSO' | 'FINALIZADO' | null>(null)
  const [loadingEdicionSup, setLoadingEdicionSup] = useState(false)
  const [errorEdicionSup, setErrorEdicionSup] = useState('')
  const [solicitudesAnterioresAbiertas, setSolicitudesAnterioresAbiertas] = useState(false)
  const [crearRondaPickerAbierto, setCrearRondaPickerAbierto] = useState(false)

  const hoy = fechaHoy()
  const rangoFecha = rangoFiltroFechaTurnos(filtroFecha, hoy)

  const { notificarSupervision } = useSupervisorGps(
    user?.id ?? '',
    supervisoresGuardia,
    objetivos
  )

  const cerrarSesion = async () => {
    await endSession()
    await supabase.auth.signOut()
    window.location.href = '/dashboard'
  }

  const activarPush = async () => {
    setActivandoPush(true)
    try {
      const resultado = await activarNotificacionesPush()
      if (resultado.ok) {
        setMensaje(resultado.message)
        setError('')
      } else {
        setError(resultado.message)
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo activar notificaciones. Error desconocido.')
    } finally {
      setActivandoPush(false)
    }
  }

  const cargarDatos = async (filtro: FiltroFechaTurnos = filtroFecha) => {
    setLoading(true)
    setError('')
    const rango = rangoFiltroFechaTurnos(filtro, hoy)
    // Para "hoy", incluir también el día anterior para capturar turnos nocturnos activos
    const desdeConNocturno = filtro === 'hoy' ? sumarDiasFecha(rango.desde, -1) : rango.desde

    const [
      { data: turnosData, error: turnosError },
      { data: objetivosData, error: objetivosError },
      guardiasResult,
      supervisoresResult,
      supervisoresGuardiaResult,
      solicitudesResult,
      plantillasResult,
      itemsResult,
      supervisionesHoyResult,
      supervisionesRecientesResult,
      zonasResult,
      supervisorZonasResult,
      ultimasSupervisionesResult,
    ] = await Promise.all([
      supabase
        .from('turnos')
        .select('*')
        .gte('fecha', desdeConNocturno)
        .lte('fecha', rango.hasta)
        .order('fecha', { ascending: true })
        .order('hora_inicio', { ascending: true }),
      supabase
        .from('objetivos')
        .select('id, nombre, cliente, direccion, lat, lng, radio_metros, estado, checklist_plantilla_id, frecuencia_supervision_horas, zona_id')
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
      supabase
        .from('checklist_plantillas')
        .select('id, nombre, descripcion, activo')
        .eq('activo', true)
        .order('nombre'),
      supabase
        .from('checklist_items')
        .select('id, plantilla_id, texto, orden, obligatorio, criticidad, foto_obligatoria, activo')
        .eq('activo', true)
        .order('orden', { ascending: true }),
      supabase
        .from('supervisiones')
        .select('*, objetivo:objetivos(nombre), respuestas:supervision_respuestas(resultado), fotos:supervision_fotos(id, storage_path)')
        .eq('supervisor_id', user.id)
        .gte('created_at', inicioDiaLocalISO(hoy))
        .lt('created_at', finDiaLocalISO(hoy))
        .order('created_at', { ascending: false }),
      supabase
        .from('supervisiones')
        .select('*, objetivo:objetivos(nombre), respuestas:supervision_respuestas(resultado), fotos:supervision_fotos(id, storage_path)')
        .eq('supervisor_id', user.id)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('zonas_operativas')
        .select('id, nombre, estado')
        .order('nombre'),
      supabase
        .from('supervisor_zonas')
        .select('id, supervisor_id, zona_id')
        .eq('supervisor_id', user.id),
      // Vigencia de supervisiones: sin filtro de fecha y con límite explícito.
      // Sin el límite, PostgREST corta en 1000 y los objetivos supervisados hace
      // tiempo reaparecen como "nunca supervisado".
      supabase
        .from('supervisiones')
        .select('objetivo_id, created_at')
        .order('created_at', { ascending: false })
        .limit(5000),
    ])

    let guardiasData = guardiasResult.data
    let guardiasError = guardiasResult.error
    const supervisoresData = supervisoresResult.data
    const supervisoresError = supervisoresResult.error
    const supervisoresGuardiaData = supervisoresGuardiaResult.data
    const supervisoresGuardiaError = supervisoresGuardiaResult.error
    const solicitudesData = solicitudesResult.data
    const solicitudesError = solicitudesResult.error
    const plantillasError = plantillasResult.error
    const itemsError = itemsResult.error
    const supervisionesHoyError = supervisionesHoyResult.error
    const supervisionesRecientesError = supervisionesRecientesResult.error
    const zonasError = zonasResult.error
    const supervisorZonasError = supervisorZonasResult.error
    const ultimasSupervisionesError = ultimasSupervisionesResult.error

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

    if (plantillasError && !/checklist_plantillas|schema cache|does not exist/i.test(plantillasError.message)) {
      setError(plantillasError.message)
    }

    if (itemsError && !/checklist_items|schema cache|does not exist/i.test(itemsError.message)) {
      setError(itemsError.message)
    }

    if (supervisionesHoyError && !/supervisiones|schema cache|does not exist/i.test(supervisionesHoyError.message)) {
      setError(supervisionesHoyError.message)
    }

    if (supervisionesRecientesError && !/supervisiones|schema cache|does not exist/i.test(supervisionesRecientesError.message)) {
      setError(supervisionesRecientesError.message)
    }

    if (zonasError && !/zonas_operativas|schema cache|does not exist/i.test(zonasError.message)) {
      setError(zonasError.message)
    }

    if (supervisorZonasError && !/supervisor_zonas|schema cache|does not exist/i.test(supervisorZonasError.message)) {
      setError(supervisorZonasError.message)
    }

    if (ultimasSupervisionesError && !/supervisiones|schema cache|does not exist/i.test(ultimasSupervisionesError.message)) {
      setError(ultimasSupervisionesError.message)
    }

    const turnosRango = ((turnosData || []) as Turno[]).filter(t => {
      // Al consultar con desdeConNocturno, filtrar en memoria para que
      // solo entren turnos de ayer si son nocturnos (cruzan medianoche)
      if (filtro === 'hoy' && t.fecha === desdeConNocturno) {
        const [hI, mI] = t.hora_inicio.split(':').map(Number)
        const [hF, mF] = t.hora_fin.split(':').map(Number)
        return (hF * 60 + mF) <= (hI * 60 + mI)
      }
      return true
    })
    const supervisionesMap = new Map<string, Supervision>()
    ;[...(supervisionesHoyResult.data || []), ...(supervisionesRecientesResult.data || [])].forEach((supervision: any) => {
      supervisionesMap.set(supervision.id, supervision as Supervision)
    })

    const ultimaPorObjetivo: Record<string, string> = {}
    if (!ultimasSupervisionesError) {
      ;(ultimasSupervisionesResult.data || []).forEach((s: any) => {
        if (!ultimaPorObjetivo[s.objetivo_id]) ultimaPorObjetivo[s.objetivo_id] = s.created_at
      })
    }

    setTurnos(turnosRango)
    setObjetivos((objetivosData || []) as Objetivo[])
    setZonasOperativas(zonasError ? [] : (zonasResult.data || []) as ZonaOperativa[])
    setSupervisorZonas(supervisorZonasError ? [] : (supervisorZonasResult.data || []) as SupervisorZona[])
    setUltimaSupervisionPorObjetivo(ultimaPorObjetivo)
    setGuardias((guardiasData || []) as Usuario[])
    setSupervisores((supervisoresData || []) as Usuario[])
    setSupervisoresGuardia(supervisoresGuardiaError ? [] : (supervisoresGuardiaData || []) as SupervisorGuardia[])
    setSolicitudesAdmin(solicitudesError ? [] : (solicitudesData || []) as SolicitudAdmin[])
    setChecklistPlantillas(plantillasError ? [] : (plantillasResult.data || []) as ChecklistPlantilla[])
    setChecklistItems(itemsError ? [] : (itemsResult.data || []) as ChecklistItem[])
    setSupervisiones(
      (supervisionesHoyError && supervisionesRecientesError)
        ? []
        : Array.from(supervisionesMap.values()).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    )

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

  useEffect(() => {
    if (user?.id && user?.rol) void initTelemetry(user.id, user.rol)
  }, [])

  // Al abrir la vista, recalcular las alertas de rondas una vez para que el
  // contador de Inicio refleje el estado real y no el de la última corrida.
  useEffect(() => {
    void recalcularAlertasRondas().then(() => setRecargaRondas(v => v + 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Puestos activos del objetivo elegido en el alta de turno. Definen si el
  // puesto se asigna solo, hay que elegirlo o el alta queda bloqueada.
  useEffect(() => {
    let vigente = true
    if (!formTurno.objetivo_id) {
      setEstadoPuestosTurno(null)
      return
    }
    void obtenerPuestosActivos(formTurno.objetivo_id).then(({ data, error: errPuestos }) => {
      if (!vigente) return
      setEstadoPuestosTurno(data)
      if (errPuestos) setError(errPuestos)
    })
    return () => { vigente = false }
  }, [formTurno.objetivo_id])

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
  const intervencionesAlerta = (turnoId: string, tipoAlerta: TipoAlertaOperativa, registroId?: string | null) =>
    intervencionesDeOcurrencia(intervenciones, turnoId, tipoAlerta, registroId)
  const ultimaIntervencionAlerta = (turnoId: string, tipoAlerta: TipoAlertaOperativa, registroId?: string | null) =>
    intervencionesAlerta(turnoId, tipoAlerta, registroId)[0]
  const alertaIntervenida = (turnoId: string, tipoAlerta: TipoAlertaOperativa, registroId?: string | null) =>
    alertaEstaIntervenida(intervenciones, turnoId, tipoAlerta, registroId)
  const alertaPendiente = (turno: Turno, tipoAlerta: TipoAlertaOperativa, registroId?: string | null) =>
    !alertaIntervenida(turno.id, tipoAlerta, registroId)
  // Definición compartida con el Dashboard y el cron (lib/turnos.ts): sin guardia
  // Y con obligación de cobertura vigente. Un turno reemplazado no es descubierto.
  //
  // Se suma el estado del objetivo: un objetivo pausado conserva sus turnos pero
  // no genera obligación, así que tampoco puestos descubiertos. Mismo criterio
  // que aplica el servidor en rondas_ventanas_programadas.
  const esDescubiertoOperativo = (turno: Turno) =>
    turnoSinCoberturaEnObjetivoOperativo(turno, getObjetivo(turno.objetivo_id))
  const esTurnoReasignado = (turno: Turno) => Boolean(
    turno.guardia_original_id &&
    turno.guardia_id &&
    turno.guardia_original_id !== turno.guardia_id
  )
  const esSinIngreso = (turno: Turno) => {
    const registro = getRegistro(turno.id)
    return Boolean(
      turno.guardia_id &&
      !(registro?.hora_entrada_final || (registro?.tipo_registro !== 'ausencia' && registro?.hora_entrada_real)) &&
      minutosAtrasoTurno(turno) >= 15
    )
  }
  const esTardanzaRegistrada = (turno: Turno) => {
    const registro = getRegistro(turno.id)
    if (!registro?.hora_entrada_final && !registro?.hora_entrada_real) return false

    return calcularMinutosTardanzaRegistro(turno, registro) > 0
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
    if (registro?.hora_entrada_final || registro?.hora_entrada_real) return calcularMinutosTardanzaRegistro(turno, registro) > 0 ? 'tardanza' : 'en turno'
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

  const objetivosActivos = useMemo(() => objetivos.filter(o => (o.estado || 'activo') === 'activo'), [objetivos])
  const objetivosControlRondas = useMemo(
    () => objetivosActivos.map(o => ({ id: o.id, nombre: o.nombre || 'Objetivo sin nombre' })),
    [objetivosActivos],
  )
  const objetivoSupervision = useMemo(
    () => objetivos.find(o => o.id === supervisionObjetivoId) || null,
    [objetivos, supervisionObjetivoId],
  )
  const plantillaSupervision = useMemo(
    () => checklistPlantillas.find(p => p.id === objetivoSupervision?.checklist_plantilla_id) || null,
    [checklistPlantillas, objetivoSupervision],
  )
  const itemsSupervision = useMemo(
    () => objetivoSupervision?.checklist_plantilla_id
      ? checklistItems
          .filter(item => item.plantilla_id === objetivoSupervision.checklist_plantilla_id && item.activo)
          .sort((a, b) => (a.orden || 0) - (b.orden || 0))
      : [],
    [checklistItems, objetivoSupervision],
  )
  const supervisionesHoy = useMemo(
    () => supervisiones.filter(supervision => fechaLocalISO(supervision.created_at) === hoy),
    [supervisiones, hoy],
  )
  const resumenSupervisiones = useMemo(() => ({
    total: supervisionesHoy.length,
    observadas: supervisionesHoy.filter(s => s.estado === 'con_observacion').length,
    criticas: supervisionesHoy.filter(s => s.estado === 'critico').length,
  }), [supervisionesHoy])

  const zonasIdsAsignadas = useMemo(
    () => new Set(supervisorZonas.map(sz => sz.zona_id)),
    [supervisorZonas],
  )
  const nombreZona = (zonaId?: string | null) => zonasOperativas.find(z => z.id === zonaId)?.nombre || 'Sin zona'

  const objetivosDeMiZona = useMemo(
    () => zonasIdsAsignadas.size > 0
      ? objetivosActivos.filter(o => o.zona_id && zonasIdsAsignadas.has(o.zona_id))
      : objetivosActivos,
    [objetivosActivos, zonasIdsAsignadas],
  )

  const agendaSupervisiones = useMemo(() => {
    const ahoraMs = Date.now()
    const base = agendaZonaFiltro === 'todas'
      ? objetivosDeMiZona
      : objetivosDeMiZona.filter(o => o.zona_id === agendaZonaFiltro)

    return base.map(objetivo => {
      // Vigencia: mismo cálculo que el Dashboard y el cron (lib/supervisiones.ts).
      const frecuenciaHoras = frecuenciaSupervision(objetivo)
      const ultimaIso = ultimaSupervisionPorObjetivo[objetivo.id] || null
      const horasDesdeUltima = ultimaIso ? (ahoraMs - new Date(ultimaIso).getTime()) / 3600000 : null
      const estado = estadoSupervision(ultimaIso, frecuenciaHoras, ahoraMs)
      // 'nunca' y 'vencida' comparten carril: ambas requieren ir a supervisar.
      const estadoAgenda: 'vencido' | 'proximo' | 'al_dia' = estado !== 'vigente'
        ? 'vencido'
        : supervisionProximaAVencer(ultimaIso, frecuenciaHoras, ahoraMs)
          ? 'proximo'
          : 'al_dia'

      return {
        estado,
        objetivo,
        zona: nombreZona(objetivo.zona_id),
        ultimaIso,
        horasDesdeUltima,
        frecuenciaHoras,
        estadoAgenda,
      }
    }).sort((a, b) => {
      const ordenA = a.horasDesdeUltima === null ? Infinity : a.horasDesdeUltima - a.frecuenciaHoras
      const ordenB = b.horasDesdeUltima === null ? Infinity : b.horasDesdeUltima - b.frecuenciaHoras
      return ordenB - ordenA
    })
  }, [objetivosDeMiZona, agendaZonaFiltro, ultimaSupervisionPorObjetivo])

  const agendaResumen = useMemo(() => ({
    vencidas: agendaSupervisiones.filter(a => a.estadoAgenda === 'vencido').length,
    proximas: agendaSupervisiones.filter(a => a.estadoAgenda === 'proximo').length,
    realizadasHoy: supervisionesHoy.length,
  }), [agendaSupervisiones, supervisionesHoy])

  const irASupervisar = (objetivoId: string) => {
    setSupervisionObjetivoId(objetivoId)
    setSupervisionGps(null)
    setConfirmarGpsImpreciso(false)
    setSupervisionRespuestas({})
    setSupervisionFotos([])
    setSupervisionObservaciones('')
    setTab('supervisiones')
  }
  const observadosSupervision = (supervision: Supervision) => supervision.respuestas?.filter(r => r.resultado === 'observado').length || 0
  const fotosSupervisionCount = (supervision: Supervision) => supervision.fotos?.length || 0
  const mapsUrlSupervision = (supervision: Supervision) => `https://www.google.com/maps?q=${supervision.lat},${supervision.lng}`
  const auditoriaSupervisionActual = supervisionGps
    ? auditoriaSupervisionGps(supervisionGps.lat, supervisionGps.lng, supervisionGps.precision, objetivoSupervision)
    : null
  const auditoriaDetalleSupervision = detalleSupervision
    ? auditoriaSupervisionGps(detalleSupervision.lat, detalleSupervision.lng, detalleSupervision.precision_gps, getObjetivo(detalleSupervision.objetivo_id))
    : null
  const respuestasDetallePorItem = useMemo(
    () => new Map(detalleRespuestas.map(respuesta => [respuesta.item_id, respuesta])),
    [detalleRespuestas],
  )
  const itemsDetalleSupervision = useMemo(() => {
    const itemsMap = new Map<string, ChecklistItem>()

    if (detalleSupervision?.plantilla_id) {
      checklistItems
        .filter(item => item.plantilla_id === detalleSupervision.plantilla_id)
        .forEach(item => itemsMap.set(item.id, item))
    }

    detalleRespuestas.forEach(respuesta => {
      if (respuesta.item) itemsMap.set(respuesta.item.id, respuesta.item)
    })

    return Array.from(itemsMap.values()).sort((a, b) => (a.orden || 0) - (b.orden || 0))
  }, [checklistItems, detalleSupervision, detalleRespuestas])

  const turnosDescubiertosOperativos = useMemo(
    () => turnos.filter(t => esDescubiertoOperativo(t)),
    [turnos, registros],
  )

  const turnosSinIngreso = useMemo(
    () => turnos.filter(t => esSinIngreso(t)),
    [turnos, registros],
  )

  const ocurrenciasTardanza = useMemo(
    () => registros.flatMap(registro => {
      const turno = turnos.find(item => item.id === registro.turno_id)
      if (!turno || (!registro.hora_entrada_final && !registro.hora_entrada_real) || calcularMinutosTardanzaRegistro(turno, registro) <= 0) return []
      return [{ turno, registro }]
    }),
    [turnos, registros],
  )

  const ocurrenciasGpsFueraRadio = useMemo(
    () => registros.flatMap(registro => {
      const turno = turnos.find(item => item.id === registro.turno_id)
      return turno && registro.gps_ingreso_estado === 'fuera_radio' ? [{ turno, registro }] : []
    }),
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
    () => ocurrenciasTardanza.filter(({ turno, registro }) => alertaPendiente(turno, 'tardanza', registro.id)),
    [ocurrenciasTardanza, intervenciones],
  )

  const turnosConGpsFueraRadioPendientes = useMemo(
    () => ocurrenciasGpsFueraRadio.filter(({ turno, registro }) => alertaPendiente(turno, 'fuera_radio', registro.id)),
    [ocurrenciasGpsFueraRadio, intervenciones],
  )

  // Alertas de asistencia. Las de rondas son otra fuente (ronda_alertas, vía RPC)
  // y se cuentan aparte: mezclarlas en este total escondería el incumplimiento
  // de rondas dentro de un número que el supervisor ya lee como "asistencia".
  const totalAlertasPendientes =
    turnosDescubiertosPendientes.length +
    turnosSinIngresoPendientes.length +
    turnosConTardanzaPendientes.length +
    turnosConGpsFueraRadioPendientes.length

  const alertasIntervenidas = useMemo<AlertaIntervenida[]>(() => {
    const porAlerta = new Map<string, AlertaIntervenida>()

    intervenciones.forEach(intervencion => {
      if (intervencion.accion === 'comentario' || !esTipoAlertaOperativa(intervencion.tipo_alerta)) return

      const turno = turnos.find(t => t.id === intervencion.turno_id)
      if (!turno) return
      const registro = intervencion.registro_asistencia_id
        ? registros.find(item => item.id === intervencion.registro_asistencia_id)
        : undefined

      const key = claveOcurrenciaAlerta(intervencion.turno_id, intervencion.tipo_alerta, registro?.id || intervencion.registro_asistencia_id)
      const actual = porAlerta.get(key)
      if (!actual || compararIntervencionesMasReciente(intervencion, actual.intervencion) < 0) {
        porAlerta.set(key, { turno, tipoAlerta: intervencion.tipo_alerta, intervencion, registro })
      }
    })

    return Array.from(porAlerta.values())
      .filter(item => alertaIntervenida(item.turno.id, item.tipoAlerta, item.registro?.id || item.intervencion.registro_asistencia_id))
      .sort((a, b) => compararIntervencionesMasReciente(a.intervencion, b.intervencion))
  }, [intervenciones, turnos, registros])

  const guardiaTieneTurnoSuperpuesto = async (
    candidato: Pick<Turno, 'guardia_id' | 'fecha' | 'hora_inicio' | 'hora_fin'>,
    excluirTurnoId?: string,
  ): Promise<boolean | null> => {
    if (!candidato.guardia_id) return false

    const { data, error: turnosError } = await supabase
      .from('turnos')
      .select('id, guardia_id, fecha, hora_inicio, hora_fin, objetivo_id')
      .eq('guardia_id', candidato.guardia_id)
      .in('fecha', fechasVecinasTurno(candidato.fecha))

    if (turnosError) {
      setError(turnosError.message)
      return null
    }

    return tieneTurnoSuperpuesto(data || [], candidato, excluirTurnoId, objetivosPausados)
  }

  const crearTurno = async () => {
    if (!formTurno.objetivo_id || !formTurno.fecha || !formTurno.hora_inicio || !formTurno.hora_fin) {
      setError('Completá objetivo, fecha y horarios.')
      return
    }

    setAsignando('crear-turno')
    setError('')
    setMensaje('')

    const puesto = resolverPuestoTurno(estadoPuestosTurno, formTurno.puesto_id)
    if (!puesto.ok) {
      setError(puesto.error)
      setAsignando(null)
      return
    }

    const payload = {
      objetivo_id: formTurno.objetivo_id,
      puesto_id: puesto.puesto_id,
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
        .select('objetivo_id, puesto_id, guardia_id, hora_inicio, hora_fin, tipo_evento')
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
    const candidatos = (turnosOrigen || []).reduce<{ objetivo_id: string, puesto_id: string | null, guardia_id: string | null, guardia_original_id: string | null, fecha: string, hora_inicio: string, hora_fin: string, estado: Turno['estado'], tipo_evento: string }[]>((acumulados, turno: any) => {
      const candidato = {
        objetivo_id: turno.objetivo_id,
        // Se arrastra el puesto del turno de origen. Si viene null, el trigger
        // turnos_completar_puesto lo resuelve cuando no hay ambigüedad.
        puesto_id: turno.puesto_id ?? null,
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
        ? tieneTurnoSuperpuesto(comparacion, candidato, null, objetivosPausados)
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
      // La ubicación de un objetivo ya no se escribe con un UPDATE directo:
      // va por la ruta autoritativa, que además abre la vigencia en el
      // historial y deja el cambio auditado.
      const { objetivo: actualizado, error: updateError } = await guardarUbicacionObjetivo(
        objetivo.id,
        position.coords.latitude,
        position.coords.longitude,
        objetivo.radio_metros || 200,
      )

      if (updateError) {
        setError(updateError)
      } else if (actualizado) {
        setObjetivos(prev => prev.map(o => o.id === objetivo.id ? { ...o, ...actualizado } : o))
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
      setTab('alertas')
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
      setTab('alertas')
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
      setTab('alertas')
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
      setTab('alertas')
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

    // El formulario mezcla datos administrativos con la ubicación, pero ya no
    // se pueden guardar juntos: lat/lng/radio sólo los escribe la ruta
    // autoritativa. Se hacen en dos pasos, primero lo administrativo.
    const { data, error: updateError } = await supabase
      .from('objetivos')
      .update({
        direccion: formObjetivo.direccion.trim() || null,
        estado: formObjetivo.estado,
      })
      .eq('id', objetivoEditando.id)
      .select('*')
      .single()

    if (updateError) {
      setError(updateError.message)
      setAsignando(null)
      return
    }

    const { objetivo: conUbicacion, error: errorUbicacion } = await guardarUbicacionObjetivo(
      objetivoEditando.id, lat, lng, radio,
    )

    if (errorUbicacion) {
      setError(errorUbicacion)
      setAsignando(null)
      return
    }

    const resultado = { ...(data ?? {}), ...(conUbicacion ?? {}) }
    setObjetivos(prev => prev.map(o => o.id === objetivoEditando.id ? { ...o, ...resultado } as Objetivo : o))
    setObjetivoEditando(null)

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
      motivo: '',
    })
  }

  const cerrarAccionAlerta = () => {
    setAccionAlerta(null)
    setFormIntervencion({ guardia_id:'', comentario:'', motivo:'' })
  }

  /**
   * Recalcula las alertas de rondas antes de leerlas.
   *
   * Las alertas 'no_iniciada' no se derivan al consultar: son filas que crea
   * evaluar_ronda_alertas(), y esa función solo se invocaba desde
   * /api/push/cron, que no tiene ningún programador configurado (no hay crons
   * en vercel.json, ni pg_cron, ni workflows). O sea que en la práctica nunca
   * corría, y por eso el contador de Inicio mostraba menos rondas no iniciadas
   * de las que correspondía.
   *
   * Se llama a la misma función autoritativa —no se calcula nada en paralelo—.
   * Es idempotente: la tabla tiene un único por (ronda_base_id, turno_id,
   * ventana_inicio, tipo) y el insert hace ON CONFLICT DO UPDATE, así que
   * repetirla no duplica ni pisa intervenciones.
   *
   * Si la función no estuviera disponible, se sigue adelante y se muestran las
   * alertas que ya existan: nunca deja la pantalla sin datos.
   */
  const recalcularAlertasRondas = async () => {
    const { error } = await supabase.rpc('evaluar_ronda_alertas')
    if (error && !/evaluar_ronda_alertas|schema cache|does not exist|permission/i.test(error.message)) {
      console.error('[rondas] evaluar_ronda_alertas:', error.message)
    }
  }

  /**
   * Desde una alerta de puesto descubierto, lleva a ese mismo turno en la
   * pestaña Turnos y lo resalta. Ahí ya está el selector "Asignar guardia" con
   * el objetivo, la posición, la fecha y el horario del turno: no hace falta
   * reconstruir el contexto ni existe una segunda vía de creación.
   *
   * Se ajusta el filtro de fecha al día del turno para que la lista lo
   * contenga, incluso si el supervisor estaba mirando otro período.
   */
  const irACubrirTurno = (turno: Turno) => {
    setFiltroTurnos('todos')
    const filtroDelTurno = filtroFechaTurnosParaFecha(turno.fecha)
    if (filtroDelTurno !== filtroFecha) {
      setFiltroFecha(filtroDelTurno)
      void cargarDatos(filtroDelTurno)
    }
    setTurnoFoco(turno.id)
    setTab('turnos')
    // Tras el cambio de pestaña, acercar la tarjeta del turno.
    setTimeout(() => {
      document.getElementById(`turno-${turno.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 120)
  }

  const recargarEstadoAlerta = async (turnoId: string) => {
    const [turnoResult, registrosResult, intervencionesResult] = await Promise.all([
      supabase.from('turnos').select('*').eq('id', turnoId).single(),
      supabase.from('registros_asistencia').select('*').eq('turno_id', turnoId),
      supabase.from('supervisor_intervenciones').select('*').eq('turno_id', turnoId).order('created_at', { ascending:false }),
    ])

    if (turnoResult.error) throw turnoResult.error
    if (registrosResult.error) throw registrosResult.error
    if (intervencionesResult.error) throw intervencionesResult.error

    setTurnos(prev => prev.map(item => item.id === turnoId ? turnoResult.data as Turno : item))
    setRegistros(prev => [
      ...prev.filter(item => item.turno_id !== turnoId),
      ...((registrosResult.data || []) as RegistroAsistencia[]),
    ])
    setIntervenciones(prev => [
      ...prev.filter(item => item.turno_id !== turnoId),
      ...((intervencionesResult.data || []) as SupervisorIntervencion[]),
    ])
  }

  const ejecutarAccionAlerta = async () => {
    if (!accionAlerta) return

    const turno = turnos.find(t => t.id === accionAlerta.turnoId)
    if (!turno) return

    const comentario = formIntervencion.comentario.trim()
    const motivo = formIntervencion.motivo.trim()
    const requiereComentario = ['comentario', 'alerta_revisada', 'confirmar_asistencia'].includes(accionAlerta.accion)

    if (requiereComentario && !comentario) {
      setError('Agregá un comentario para guardar la intervención.')
      return
    }

    if (accionAlerta.accion === 'reapertura' && !motivo) {
      setError('Indicá el motivo de la reapertura.')
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
    const ocurrenciaKey = claveOcurrenciaAlerta(turno.id, accionAlerta.tipoAlerta, accionAlerta.registroId)
    if (operacionesAlertaEnCurso.current.has(ocurrenciaKey)) return
    operacionesAlertaEnCurso.current.add(ocurrenciaKey)
    setAsignando(loadingKey)
    setError('')
    setMensaje('')

    try {
      const operacionKey = JSON.stringify({
        ocurrencia: ocurrenciaKey,
        accion: accionAlerta.accion,
        comentario: comentario || null,
        motivo: motivo || null,
        guardia_nuevo_id: accionAlerta.accion === 'reasignacion' ? formIntervencion.guardia_id : null,
      })
      let operacionId = operacionesAlertaIds.current.get(operacionKey)
      if (!operacionId) {
        operacionId = crypto.randomUUID()
        operacionesAlertaIds.current.set(operacionKey, operacionId)
      }

      const { data, error: rpcError } = await supabase.rpc('registrar_intervencion_operativa', {
        p_operacion_id: operacionId,
        p_turno_id: turno.id,
        p_tipo_alerta: accionAlerta.tipoAlerta,
        p_accion: accionAlerta.accion,
        p_registro_asistencia_id: accionAlerta.registroId || null,
        p_comentario: comentario || null,
        p_motivo: motivo || null,
        p_guardia_nuevo_id: accionAlerta.accion === 'reasignacion' ? formIntervencion.guardia_id : null,
        p_confirmacion_reforzada: false,
      })
      if (rpcError) throw rpcError

      await recargarEstadoAlerta(turno.id)
      operacionesAlertaIds.current.delete(operacionKey)

      setMensaje(data?.estado === 'ya_aplicada' ? 'Operación ya aplicada. Se mostró el estado actual del servidor.' : '✓ Intervención registrada y verificada en el servidor.')
      cerrarAccionAlerta()
    } catch (actionError) {
      const message = actionError instanceof Error
        ? actionError.message
        : typeof actionError === 'object' && actionError && 'message' in actionError
          ? String((actionError as { message: unknown }).message)
          : 'Error al registrar intervención.'
      try {
        await recargarEstadoAlerta(turno.id)
      } catch {
        // La advertencia conserva la incertidumbre si la relectura tampoco responde.
      }
      setError(`No se pudo confirmar el resultado: ${message}. El servidor aplica la operación completa o no la aplica, pero ante un timeout puede haber quedado aplicada. Se intentó recargar el estado autoritativo antes de permitir otro intento.`)
    } finally {
      operacionesAlertaEnCurso.current.delete(ocurrenciaKey)
      setAsignando(null)
    }
  }

  const resetFormularioSupervision = () => {
    setSupervisionObjetivoId('')
    setSupervisionGps(null)
    setSupervisionObservaciones('')
    setSupervisionRespuestas({})
    setSupervisionFotos([])
    setConfirmarGpsImpreciso(false)
  }

  const agregarFotosSupervision = (files: FileList | null) => {
    const nuevasFotos = Array.from(files || [])
    if (nuevasFotos.length === 0) return
    setSupervisionFotos(prev => [...prev, ...nuevasFotos])
  }

  const actualizarRespuestaSupervision = (itemId: string, patch: Partial<{ resultado: ResultadoChecklist, observacion: string }>) => {
    setSupervisionRespuestas(prev => ({
      ...prev,
      [itemId]: {
        resultado: prev[itemId]?.resultado || 'correcto',
        observacion: prev[itemId]?.observacion || '',
        ...patch,
      },
    }))
  }

  const capturarGpsSupervision = async () => {
    setError('')
    setMensaje('')

    if (!navigator.geolocation) {
      setError('GPS no disponible en este dispositivo.')
      return
    }

    setCapturandoGps(true)
    navigator.geolocation.getCurrentPosition(
      position => {
        setSupervisionGps({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          precision: position.coords.accuracy,
        })
        setConfirmarGpsImpreciso(false)
        setCapturandoGps(false)
      },
      gpsError => {
        setError(gpsError.message || 'No se pudo capturar la ubicación GPS.')
        setCapturandoGps(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }

  const guardarSupervision = async () => {
    setError('')
    setMensaje('')

    if (!objetivoSupervision) {
      setError('Seleccioná un objetivo para registrar la supervisión.')
      return
    }

    if (!supervisionGps) {
      setError('GPS obligatorio: capturá la ubicación antes de guardar.')
      return
    }

    if (supervisionGps.precision > GPS_PRECISION_MAX_METROS && !confirmarGpsImpreciso) {
      setError('GPS impreciso, espere unos segundos y vuelva a intentar')
      return
    }

    const obligatoriosSinRespuesta = itemsSupervision.filter(item => item.obligatorio && !supervisionRespuestas[item.id]?.resultado)
    const requiereFotoObligatoria = itemsSupervision.some(item => item.foto_obligatoria)
    const fotosPendientes = requiereFotoObligatoria && supervisionFotos.length === 0
    const esIncompleta = obligatoriosSinRespuesta.length > 0 || fotosPendientes

    const respuestasCompletas = itemsSupervision
      .map(item => ({ item, respuesta: supervisionRespuestas[item.id] }))
      .filter(({ respuesta }) => Boolean(respuesta?.resultado))

    const hayObservado = respuestasCompletas.some(({ respuesta }) => respuesta?.resultado === 'observado')
    const hayCritico = respuestasCompletas.some(({ item, respuesta }) => respuesta?.resultado === 'observado' && item.criticidad === 'alta')

    const estadoPreliminar: EstadoSupervision = esIncompleta
      ? 'incompleta'
      : hayCritico
        ? 'critico'
        : hayObservado
          ? 'con_observacion'
          : 'ok'

    setAsignando('guardar-supervision')

    let supervisionCreadaId: string | null = null

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) throw new Error('Sesión expirada. Volvé a iniciar sesión.')

      const saveRes = await fetch('/api/save-supervision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          objetivo_id: objetivoSupervision.id,
          supervisor_id: user.id,
          plantilla_id: objetivoSupervision.checklist_plantilla_id || null,
          lat: supervisionGps.lat,
          lng: supervisionGps.lng,
          precision_gps: supervisionGps.precision,
          estado: estadoPreliminar,
          observaciones: supervisionObservaciones.trim() || null,
          respuestas: respuestasCompletas.map(({ item, respuesta }) => ({
            item_id: item.id,
            resultado: respuesta?.resultado,
            observacion: respuesta?.observacion?.trim() || null,
          })),
        }),
      })

      if (!saveRes.ok) {
        const err = await saveRes.json().catch(() => ({ error: 'Error al guardar la supervisión' }))
        throw new Error(err.error || 'Error al guardar la supervisión')
      }

      const { supervision: supervisionNueva } = await saveRes.json()
      if (!supervisionNueva) throw new Error('No se pudo crear la supervisión.')

      supervisionCreadaId = supervisionNueva.id

      const fotosRegistradas: SupervisionFoto[] = []
      let avisoFotos = ''
      let errorFotoObligatoria: Error | null = null

      for (const [index, foto] of supervisionFotos.entries()) {
        try {
          const fd = new FormData()
          fd.append('supervision_id', supervisionNueva.id)
          fd.append('index', String(index))
          fd.append('foto', foto, foto.name)

          const fotoRes = await fetch('/api/upload-supervision-photo', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: fd,
          })

          if (!fotoRes.ok) {
            const errJson = await fotoRes.json().catch(() => ({ error: 'Error al subir la foto' }))
            throw new Error(errJson.error || 'Error al subir la foto')
          }

          const { foto: fotoRegistrada } = await fotoRes.json()
          if (fotoRegistrada) fotosRegistradas.push(fotoRegistrada as SupervisionFoto)
        } catch (fotoCatchError) {
          const fotoMessage = fotoCatchError instanceof Error ? fotoCatchError.message : 'Error desconocido al subir la foto.'
          avisoFotos = `Supervisión guardada, pero no se pudo subir la foto "${foto.name}". ${fotoMessage}`
          if (!errorFotoObligatoria) {
            errorFotoObligatoria = fotoCatchError instanceof Error
              ? fotoCatchError
              : new Error(fotoMessage)
          }
        }
      }

      const faltaFotoObligatoria = requiereFotoObligatoria && fotosRegistradas.length === 0
      const estadoFinal: EstadoSupervision = (esIncompleta || faltaFotoObligatoria)
        ? 'incompleta'
        : hayCritico
          ? 'critico'
          : hayObservado
            ? 'con_observacion'
            : 'ok'

      if (estadoFinal !== estadoPreliminar) {
        await supabase.from('supervisiones').update({ estado: estadoFinal }).eq('id', supervisionNueva.id)
      }

      const supervisionParaListado = {
        ...supervisionNueva,
        estado: estadoFinal,
        respuestas: respuestasCompletas.map(({ respuesta }) => ({ resultado: respuesta?.resultado })),
        fotos: fotosRegistradas.map(foto => ({ id: foto.id, storage_path: foto.storage_path })),
      } as Supervision

      setSupervisiones(prev => [
        supervisionParaListado,
        ...prev.filter(s => s.id !== supervisionNueva.id),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))

      if (supervisionGps) {
        void notificarSupervision(supervisionNueva.id, supervisionGps.lat, supervisionGps.lng)
      }

      resetFormularioSupervision()

      const avisos: string[] = []
      if (obligatoriosSinRespuesta.length > 0) {
        avisos.push(`Ítems pendientes: ${obligatoriosSinRespuesta.map(i => i.texto).join(', ')}.`)
      }
      if (faltaFotoObligatoria) avisos.push('Foto obligatoria no adjuntada.')
      if (avisoFotos) avisos.push(avisoFotos)

      setMensaje(
        avisos.length > 0
          ? `⚠ Supervisión guardada como incompleta. ${avisos.join(' ')}`
          : `✓ Supervisión guardada con estado ${estadoFinal}.`
      )
    } catch (saveError) {
      if (supervisionCreadaId) {
        await supabase.from('supervisiones').delete().eq('id', supervisionCreadaId)
      }
      const message = saveError instanceof Error
        ? saveError.message
        : (saveError as any)?.message || (saveError as any)?.details || JSON.stringify(saveError) || 'Error al guardar la supervisión.'
      setError(`No se pudo guardar la supervisión. ${message}`)
    } finally {
      setAsignando(null)
    }
  }

  const abrirDetalleSupervision = async (supervision: Supervision) => {
    setDetalleSupervision(supervision)
    setDetalleRespuestas([])
    setDetalleFotos([])
    setDetalleError('')
    setDetalleLoading(true)

    try {
      const [respuestasResult, fotosResult] = await Promise.all([
        supabase
          .from('supervision_respuestas')
          .select('id, supervision_id, item_id, resultado, observacion, item:checklist_items(id, plantilla_id, texto, orden, obligatorio, criticidad, foto_obligatoria, activo)')
          .eq('supervision_id', supervision.id),
        supabase
          .from('supervision_fotos')
          .select('id, supervision_id, storage_path, created_at')
          .eq('supervision_id', supervision.id)
          .order('created_at', { ascending: true }),
      ])

      if (respuestasResult.error) throw respuestasResult.error
      if (fotosResult.error) throw fotosResult.error

      const fotosConUrl = await Promise.all((fotosResult.data || []).map(async (foto: SupervisionFoto) => {
        const { data, error } = await supabase.storage
          .from('supervision-fotos')
          .createSignedUrl(foto.storage_path, 60 * 60)
        const publicUrl = supabase.storage
          .from('supervision-fotos')
          .getPublicUrl(foto.storage_path).data.publicUrl

        return {
          ...foto,
          signedUrl: data?.signedUrl || null,
          publicUrl,
          error: error?.message || null,
        }
      }))

      setDetalleRespuestas((respuestasResult.data || []) as SupervisionRespuesta[])
      setDetalleFotos(fotosConUrl)
    } catch (detailError) {
      setDetalleError(detailError instanceof Error ? detailError.message : 'No se pudo cargar el detalle de la supervisión.')
    } finally {
      setDetalleLoading(false)
    }
  }

  const resumenRondas = resumirRondasAlcance(rondaAlertas)

  // Las tarjetas del resumen de Rondas llevan a los paneles que ya están más
  // abajo en la misma pantalla: no hay pantalla nueva ni segunda consulta, el
  // dato que cuenta la tarjeta es el mismo que el panel ya tiene cargado.
  const refIncumplidas = useRef<HTMLDivElement | null>(null)
  const refSuspendidas = useRef<HTMLDivElement | null>(null)
  const refObjetivos = useRef<HTMLDivElement | null>(null)
  const [focoRondas, setFocoRondas] = useState<'incumplidas' | 'suspendidas' | 'objetivos' | null>(null)

  const irAPanelRondas = (destino: 'incumplidas' | 'suspendidas' | 'objetivos') => {
    const ref = destino === 'incumplidas' ? refIncumplidas
      : destino === 'suspendidas' ? refSuspendidas
      : refObjetivos
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    // El resaltado se apaga solo: es una ayuda para ubicar la vista, no un
    // estado de la pantalla que haya que limpiar a mano.
    setFocoRondas(destino)
    window.setTimeout(() => setFocoRondas(actual => (actual === destino ? null : actual)), 1800)
  }

  const tabs = [
    { id: 'inicio', label: 'Inicio', icon: '🏠' },
    { id: 'alertas', label: 'Alertas', icon: '⚠️' },
    { id: 'supervisiones', label: 'Supervisiones', icon: '☑️' },
    { id: 'turnos', label: 'Turnos', icon: '📅' },
    { id: 'planillas', label: 'Planillas', icon: '📋' },
    { id: 'objetivos', label: 'Objetivos', icon: '🏢' },
    { id: 'guardias', label: 'Guardias', icon: '👮' },
    { id: 'rondas', label: 'Rondas', icon: '🔁' },
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
      confirmar_cubierto: 'Cobertura manual (solo administración)',
      marcado_cubierto_manual: 'Cobertura manual (solo administración)',
      alerta_revisada: 'Alerta revisada',
      confirmar_asistencia: 'Confirmar asistencia',
      reapertura: 'Reapertura',
    }

    return labels[accion] || accion
  }

  const accionEstaSeleccionada = (turno: Turno, tipoAlerta: TipoAlertaOperativa, accion: AccionIntervencion) => (
    accionAlerta?.turnoId === turno.id &&
    accionAlerta?.tipoAlerta === tipoAlerta &&
    accionAlerta?.accion === accion
  )

  const estiloBotonAccion = (accion: AccionIntervencion, activo: boolean, base: React.CSSProperties = secondaryButton): React.CSSProperties => {
    if (!activo) return base

    const estilosActivos: Partial<Record<AccionIntervencion, React.CSSProperties>> = {
      reasignacion: {
        background: 'rgba(59,130,246,.2)',
        color: '#93c5fd',
        border: '1px solid rgba(59,130,246,.75)',
        boxShadow: '0 0 0 1px rgba(59,130,246,.3), 0 0 18px rgba(59,130,246,.22)',
      },
      marcado_descubierto: {
        background: 'rgba(249,115,22,.24)',
        color: '#fdba74',
        border: '1px solid rgba(249,115,22,.8)',
        boxShadow: '0 0 0 1px rgba(249,115,22,.3), 0 0 18px rgba(249,115,22,.24)',
      },
      comentario: {
        background: 'rgba(245,158,11,.18)',
        color: '#fcd34d',
        border: '1px solid rgba(245,158,11,.72)',
        boxShadow: '0 0 0 1px rgba(245,158,11,.25), 0 0 16px rgba(245,158,11,.18)',
      },
      confirmar_asistencia: {
        background: 'rgba(16,185,129,.2)',
        color: '#6ee7b7',
        border: '1px solid rgba(16,185,129,.75)',
        boxShadow: '0 0 0 1px rgba(16,185,129,.3), 0 0 18px rgba(16,185,129,.22)',
      },
    }

    return {
      ...base,
      ...(estilosActivos[accion] || {}),
    }
  }

  const renderContextoAlerta = (turno: Turno, tipoAlerta: TipoAlertaOperativa, registroId?: string | null) => {
    const asignacion = supervisorGuardiaAsignado(turno)
    const ultima = ultimaIntervencionAlerta(turno.id, tipoAlerta, registroId)
    const supervisorIntervinoId = ultima?.supervisor_intervino_id || ultima?.supervisor_id

    return (
      <div style={contextoAlertaBox}>
        <div>
          <div style={label}>Supervisor asignado</div>
          <div style={registroValue}>{nombreSupervisorGuardia(turno)}</div>
        </div>
        {/* Jefe operativo y director técnico se siguen registrando en cada
            intervención y quedan en la auditoría; dejan de mostrarse acá porque
            son siempre los mismos en todas las alertas y no ayudan a resolver
            el problema, que es para lo que sirve esta tarjeta. */}
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

  const renderHistorialAlerta = (turno: Turno, tipoAlerta: TipoAlertaOperativa, registroId?: string | null) => {
    const items = intervencionesAlerta(turno.id, tipoAlerta, registroId)
    const ultima = items[0]
    const historialKey = claveOcurrenciaAlerta(turno.id, tipoAlerta, registroId)
    const expandido = historialesAlertaExpandidos.has(historialKey)

    return (
      <div style={intervencionesBox}>
        {ultima ? (
          <div style={{ ...muted, color: '#cbd5e1' }}>
            Intervenido por {nombreSupervisor(ultima.supervisor_intervino_id || ultima.supervisor_id)} — {fechaHoraDDMMYYYY(ultima.created_at)}
          </div>
        ) : (
          <div style={{ ...muted, color: '#f59e0b' }}>Aún no hay intervenciones guardadas.</div>
        )}
        <button type="button" style={{ ...secondaryButton, width:'100%', marginTop:10 }} onClick={() => setHistorialesAlertaExpandidos((prev) => {
          const siguiente = new Set(prev)
          if (siguiente.has(historialKey)) siguiente.delete(historialKey); else siguiente.add(historialKey)
          return siguiente
        })}>{expandido ? 'Ocultar línea de tiempo' : `Ver línea de tiempo completa (${items.length + 1})`}</button>
        {expandido && <>
          <div style={intervencionItem}>
            <div>Acción: Detección de la condición</div>
            <div>Efecto: abrió el seguimiento sin modificar turno, asistencia ni liquidación.</div>
            <div>Fecha/hora: {fechaHoraDDMMYYYY(turno.fecha)}</div>
          </div>
          {[...items].reverse().map(item => (
            <div key={item.id} style={intervencionItem}>
              <div>Supervisor asignado: {item.supervisor_asignado_id ? nombreSupervisor(item.supervisor_asignado_id) : nombreSupervisorGuardia(turno)}</div>
              <div>Supervisor que intervino: {nombreSupervisor(item.supervisor_intervino_id || item.supervisor_id)}</div>
              <div>Acción: {accionLabel(item.accion)}</div>
              {item.guardia_nuevo_id && item.guardia_nuevo_id !== item.guardia_anterior_id && (
                <div>Guardia nuevo: {nombrePersona(getGuardia(item.guardia_nuevo_id))}</div>
              )}
              {item.motivo && <div>Motivo: {item.motivo}</div>}
              {item.comentario && <div>Comentario: {item.comentario}</div>}
              <div>Efecto: {efectoIntervencionOperativa(item.accion)}</div>
              <div>Fecha/hora: {fechaHoraDDMMYYYY(item.created_at)}</div>
            </div>
          ))}
        </>}
      </div>
    )
  }

  const renderPanelAccion = (turno: Turno, tipoAlerta: TipoAlertaOperativa, registroId?: string | null) => {
    if (!accionAlerta || accionAlerta.turnoId !== turno.id || accionAlerta.tipoAlerta !== tipoAlerta || (accionAlerta.registroId || null) !== (registroId || null)) return null

    const requiereGuardia = accionAlerta.accion === 'reasignacion'
    const requiereMotivo = accionAlerta.accion === 'reapertura'
    const comentarioLabel = ['comentario', 'alerta_revisada', 'confirmar_asistencia'].includes(accionAlerta.accion) ? 'Comentario *' : 'Comentario'
    const loadingKey = `alerta-${turno.id}-${accionAlerta.accion}`

    return (
      <div style={accionPanel}>
        <div style={{ ...label, marginTop: 0 }}>Acción seleccionada: {accionLabel(accionAlerta.accion)}</div>
        {error && <div style={{ ...errorBox, marginTop: 10 }}>{error}</div>}

        {requiereGuardia && (
          <>
            <label style={label}>Nuevo guardia</label>
            <select
              value={formIntervencion.guardia_id}
              disabled={Boolean(asignando)}
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
              disabled={Boolean(asignando)}
              onChange={e => setFormIntervencion(prev => ({ ...prev, motivo: e.target.value }))}
              placeholder="Motivo obligatorio de la reapertura"
            />
          </>
        )}

        <label style={label}>{comentarioLabel}</label>
        <textarea
          style={textarea}
          value={formIntervencion.comentario}
          disabled={Boolean(asignando)}
          onChange={e => setFormIntervencion(prev => ({ ...prev, comentario: e.target.value }))}
          placeholder={accionAlerta.accion === 'confirmar_asistencia' ? 'Ej.: Verificado en el puesto a las 08:30. El guardia no tenía celular.' : 'Ej.: Se llamó al guardia. Informa que llega en 10 minutos.'}
        />

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          <button type="button" style={secondaryButton} onClick={cerrarAccionAlerta} disabled={Boolean(asignando)}>
            Cancelar
          </button>
          <button type="button" style={refreshButton} onClick={ejecutarAccionAlerta} disabled={asignando === loadingKey}>
            {asignando === loadingKey ? 'Procesando…' : 'Guardar'}
          </button>
        </div>
      </div>
    )
  }

  const renderAccionesAlerta = (turno: Turno, tipoAlerta: TipoAlertaOperativa, registro?: RegistroAsistencia) => {
    const intervenida = alertaIntervenida(turno.id, tipoAlerta, registro?.id)
    const permiteGestionCobertura = ['sin_fichar', 'descubierto'].includes(tipoAlerta)
    const ultimaNoComentario = intervencionesAlerta(turno.id, tipoAlerta, registro?.id).find(i => i.accion !== 'comentario')
    const asistenciaConfirmada = ultimaNoComentario?.accion === 'confirmar_asistencia'

    return (
      <div style={alertaAccionesBox}>
        {renderContextoAlerta(turno, tipoAlerta, registro?.id)}
        {asistenciaConfirmada && (
          <div style={{ background:'rgba(16,185,129,.1)', border:'1px solid rgba(16,185,129,.3)', borderRadius:8, padding:12, marginBottom:10 }}>
            <div style={{ color:'#6ee7b7', fontWeight:700, fontSize:14 }}>Asistencia confirmada por supervisor.</div>
            <div style={{ color:'#94a3b8', fontSize:13, marginTop:4 }}>Fichaje pendiente de regularización.</div>
          </div>
        )}
        <div style={{ display:'flex', justifyContent:'space-between', gap:8, alignItems:'center', marginBottom:8 }}>
          <div style={label}>Acciones</div>
          {intervenida && <span style={badge('finalizado')}>Intervenida</span>}
          {!intervenida && asistenciaConfirmada && <span style={{ ...badge('finalizado'), background:'rgba(16,185,129,.15)', color:'#6ee7b7' }}>Asistencia confirmada</span>}
        </div>
        <div style={alertaActionGrid}>
          {permiteGestionCobertura && <button
            type="button"
            style={estiloBotonAccion('reasignacion', accionEstaSeleccionada(turno, tipoAlerta, 'reasignacion'))}
            disabled={Boolean(asignando)}
            onClick={() => abrirAccionAlerta(turno, tipoAlerta, 'reasignacion', registro)}
          >
            Reasignar
          </button>}
          {permiteGestionCobertura && <button
            type="button"
            style={estiloBotonAccion('marcado_descubierto', accionEstaSeleccionada(turno, tipoAlerta, 'marcado_descubierto'), dangerButton)}
            disabled={Boolean(asignando)}
            onClick={() => abrirAccionAlerta(turno, tipoAlerta, 'marcado_descubierto', registro)}
          >
            Mantener descubierto
          </button>}
          {tipoAlerta === 'sin_fichar' && <button
            type="button"
            style={estiloBotonAccion('confirmar_asistencia', accionEstaSeleccionada(turno, tipoAlerta, 'confirmar_asistencia'))}
            disabled={Boolean(asignando)}
            onClick={() => abrirAccionAlerta(turno, tipoAlerta, 'confirmar_asistencia', registro)}
          >
            Confirmar asistencia
          </button>}
          {['tardanza', 'fuera_radio'].includes(tipoAlerta) && <button
            type="button"
            style={estiloBotonAccion('comentario', accionEstaSeleccionada(turno, tipoAlerta, 'alerta_revisada'))}
            disabled={Boolean(asignando)}
            onClick={() => abrirAccionAlerta(turno, tipoAlerta, 'alerta_revisada', registro)}
          >Justificar / atender</button>}
          <button
            type="button"
            style={estiloBotonAccion('comentario', accionEstaSeleccionada(turno, tipoAlerta, 'comentario'))}
            disabled={Boolean(asignando)}
            onClick={() => abrirAccionAlerta(turno, tipoAlerta, 'comentario', registro)}
          >
            Comentar
          </button>
        </div>
        {renderPanelAccion(turno, tipoAlerta, registro?.id)}
        {renderHistorialAlerta(turno, tipoAlerta, registro?.id)}
      </div>
    )
  }

  const renderAlertaIntervenida = ({ turno, tipoAlerta, intervencion, registro }: AlertaIntervenida) => {
    const objetivo = getObjetivo(turno.objetivo_id)
    const registroVisible = registro || getRegistro(turno.id)
    const guardia = getGuardia(registroVisible?.guardia_id || turno.guardia_id)

    return (
      <div key={`intervenida-${claveOcurrenciaAlerta(turno.id, tipoAlerta, registro?.id || intervencion.registro_asistencia_id)}`} style={{ ...turnoCard, background: '#111827' }}>
        <div style={turnoTop}>
          <div>
            <div style={objetivoName}>{objetivo?.nombre || 'Objetivo sin nombre'}</div>
            <div style={muted}>{guardia ? `${guardia.apellido}, ${guardia.nombre}` : nombreGuardiaEsperado(turno)}</div>
            {(() => { const info = infoTurnoAlerta(turno); return (<>
              <div style={muted}>{info.linea}</div>
              <div style={muted}>{info.inicio}</div>
              <div style={muted}>{info.fin}</div>
              {info.nocturno && <div style={{ ...muted, color: '#818cf8' }}>Nocturno</div>}
              {info.estadoTemporal === 'en_curso' && <div style={{ ...muted, color: '#10b981', fontWeight: 600 }}>En curso</div>}
              {info.estadoTemporal === 'finalizado' && <div style={{ ...muted, color: '#60a5fa' }}>Finalizado</div>}
              {info.estadoTemporal === 'antiguo' && <div style={{ ...muted, color: '#ef4444' }}>Antiguo</div>}
            </>)})()}
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

        {['confirmar_cubierto', 'marcado_cubierto_manual'].includes(intervencion.accion) && (
          <div style={{ background:'rgba(245,158,11,.12)', border:'1px solid rgba(245,158,11,.45)', color:'#fde68a', borderRadius:8, padding:12, marginTop:12, fontSize:13 }}>
            <strong>Importante:</strong> Reabrir esta alerta no elimina la cobertura ni revierte las horas liquidables. La asistencia debe corregirse por separado.
          </div>
        )}
        <button
          type="button"
          style={{ ...secondaryButton, marginTop:12 }}
          disabled={Boolean(asignando)}
          onClick={() => abrirAccionAlerta(turno, tipoAlerta, 'reapertura', registroVisible)}
        >Reabrir alerta</button>
        {renderPanelAccion(turno, tipoAlerta, registro?.id || intervencion.registro_asistencia_id)}
        {renderHistorialAlerta(turno, tipoAlerta, registro?.id || intervencion.registro_asistencia_id)}
      </div>
    )
  }

  const abrirEdicionTurno = (turno: Turno) => {
    const registrosTurno = getRegistrosTurno(turno.id)
    const tieneEntrada = registrosTurno.some(r => r.tipo_registro !== 'ausencia' && (r.hora_entrada_final || r.hora_entrada_real))
    const tieneSalida  = registrosTurno.some(r => r.hora_salida_real  != null)
    setEstadoOpEdicionSup(tieneSalida ? 'FINALIZADO' : tieneEntrada ? 'EN_CURSO' : 'FUTURO')
    setTurnoEditandoSup(turno)
    setFormEdicionSup({
      guardia_id: turno.guardia_id || '',
      hora_inicio: turno.hora_inicio,
      hora_fin: turno.hora_fin,
      estado: turno.estado,
      comentario: '',
    })
    setErrorEdicionSup('')
  }

  const cerrarEdicionTurno = () => {
    setTurnoEditandoSup(null)
    setErrorEdicionSup('')
    setEstadoOpEdicionSup(null)
  }

  const guardarEdicionTurno = async () => {
    if (!turnoEditandoSup || !estadoOpEdicionSup) return
    if (estadoOpEdicionSup === 'FINALIZADO') {
      setErrorEdicionSup('No se pueden modificar los horarios de un turno finalizado.')
      return
    }

    setErrorEdicionSup('')

    if (estadoOpEdicionSup === 'FUTURO' && formEdicionSup.guardia_id) {
      const { data, error: turnosError } = await supabase
        .from('turnos')
        .select('id, guardia_id, fecha, hora_inicio, hora_fin, objetivo_id')
        .eq('guardia_id', formEdicionSup.guardia_id)
        .in('fecha', fechasVecinasTurno(turnoEditandoSup.fecha))

      if (turnosError) { setErrorEdicionSup(turnosError.message); return }

      const candidato = {
        guardia_id: formEdicionSup.guardia_id,
        fecha: turnoEditandoSup.fecha,
        hora_inicio: formEdicionSup.hora_inicio,
        hora_fin: formEdicionSup.hora_fin,
      }
      if (tieneTurnoSuperpuesto(data || [], candidato, turnoEditandoSup.id, objetivosPausados)) {
        setErrorEdicionSup(MENSAJE_TURNO_SUPERPUESTO)
        return
      }
    }

    const cambios: Record<string, string | null> = {}
    const snapshot: Record<string, string | null> = {}

    if (estadoOpEdicionSup === 'FUTURO') {
      snapshot.guardia_id  = turnoEditandoSup.guardia_id  || null
      snapshot.objetivo_id = (turnoEditandoSup as any).objetivo_id || null
      snapshot.puesto_id   = (turnoEditandoSup as any).puesto_id   || null
      snapshot.fecha       = turnoEditandoSup.fecha
      snapshot.hora_inicio = turnoEditandoSup.hora_inicio
      snapshot.hora_fin    = turnoEditandoSup.hora_fin
      snapshot.estado      = turnoEditandoSup.estado

      const guardiaNuevo = formEdicionSup.guardia_id || null
      if ((turnoEditandoSup.guardia_id || null) !== guardiaNuevo) cambios.guardia_id = guardiaNuevo
      if (turnoEditandoSup.hora_inicio !== formEdicionSup.hora_inicio) cambios.hora_inicio = formEdicionSup.hora_inicio
      if (turnoEditandoSup.hora_fin    !== formEdicionSup.hora_fin)    cambios.hora_fin    = formEdicionSup.hora_fin
      if (turnoEditandoSup.estado      !== formEdicionSup.estado)      cambios.estado      = formEdicionSup.estado
    } else {
      snapshot.hora_fin = turnoEditandoSup.hora_fin
      snapshot.estado   = turnoEditandoSup.estado
      if (turnoEditandoSup.hora_fin !== formEdicionSup.hora_fin) cambios.hora_fin = formEdicionSup.hora_fin
      if (turnoEditandoSup.estado   !== formEdicionSup.estado)   cambios.estado   = formEdicionSup.estado
    }

    if (Object.keys(cambios).length === 0) {
      cerrarEdicionTurno()
      return
    }

    setLoadingEdicionSup(true)

    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData?.session?.access_token
    if (!token) {
      setErrorEdicionSup('Sesión expirada. Volvé a iniciar sesión.')
      setLoadingEdicionSup(false)
      return
    }

    try {
      const res = await fetch('/api/turnos/editar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ turno_id: turnoEditandoSup.id, cambios, comentario: formEdicionSup.comentario, snapshot }),
      })
      const json = await res.json()
      if (!res.ok) {
        setErrorEdicionSup(json?.error || 'Error al guardar el turno.')
        setLoadingEdicionSup(false)
        return
      }
      const turnoActualizado = json.turno ?? {}
      setTurnos(prev => prev.map(t => t.id === turnoEditandoSup.id ? { ...t, ...turnoActualizado } : t))
      setMensaje('✓ Turno actualizado correctamente')
      setLoadingEdicionSup(false)
      cerrarEdicionTurno()
    } catch {
      setErrorEdicionSup('Error de red. Verificá tu conexión y volvé a intentar.')
      setLoadingEdicionSup(false)
    }
  }

  const abrirRegistros = async (turnoId: string) => {
    const abriendo = turnoRegistrosAbierto !== turnoId
    setTurnoRegistrosAbierto(abriendo ? turnoId : null)
    if (!abriendo) return

    const registrosDelTurno = getRegistrosTurno(turnoId)
    if (registrosDelTurno.length === 0) return

    const registroIds = registrosDelTurno.map(r => r.id)
    const yaLoaded = registroIds.every(id => id in evidenciasPorRegistro)
    if (yaLoaded) return

    setCargandoEvidencias(turnoId)
    try {
      const { data, error: evError } = await supabase
        .from('evidencias')
        .select('id, proceso_id, tipo_evidencia, storage_path, bucket')
        .eq('proceso_tipo', 'ingreso')
        .in('proceso_id', registroIds)

      if (evError) throw evError

      const byRegistro: Record<string, Evidencia[]> = {}
      registroIds.forEach(id => { byRegistro[id] = [] })
      for (const ev of (data || [])) {
        if (!byRegistro[ev.proceso_id]) byRegistro[ev.proceso_id] = []
        byRegistro[ev.proceso_id].push(ev as Evidencia)
      }

      const todasEvidencias = Object.values(byRegistro).flat()
      const conUrls = await Promise.all(
        todasEvidencias.map(ev =>
          supabase.storage.from(ev.bucket).createSignedUrl(ev.storage_path, 3600)
            .then(({ data: sd }) => ({ ...ev, signedUrl: sd?.signedUrl || null }))
        )
      )

      const resultado: Record<string, Evidencia[]> = {}
      registroIds.forEach(id => { resultado[id] = [] })
      conUrls.forEach(ev => { resultado[ev.proceso_id].push(ev) })

      setEvidenciasPorRegistro(prev => ({ ...prev, ...resultado }))
    } catch (err) {
      console.error('Error cargando evidencias de ingreso:', err)
      const vacios: Record<string, Evidencia[]> = {}
      registroIds.forEach(id => { vacios[id] = [] })
      setEvidenciasPorRegistro(prev => ({ ...prev, ...vacios }))
    } finally {
      setCargandoEvidencias(null)
    }
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
      <div key={turno.id} id={`turno-${turno.id}`} style={{
        ...turnoCard,
        ...(turnoFoco === turno.id ? { border: '1px solid #f59e0b', boxShadow: '0 0 0 1px rgba(245,158,11,.35)' } : {}),
      }}>
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
            onClick={() => abrirRegistros(turno.id)}
            style={secondaryButton}
          >
            {registrosAbiertos ? 'Ocultar registros' : `Ver registros (${registrosTurno.length})`}
          </button>
        </div>

        {!registro?.hora_salida_real && (
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => abrirEdicionTurno(turno)}
              style={{ ...secondaryButton, color: '#f59e0b', borderColor: 'rgba(245,158,11,.35)' }}
            >
              Editar turno
            </button>
          </div>
        )}

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
                  {/* Evidencias de ingreso */}
                  {cargandoEvidencias === turno.id ? (
                    <div style={{ ...muted, marginTop: 6 }}>Cargando evidencias...</div>
                  ) : (() => {
                    const evs = evidenciasPorRegistro[r.id]
                    if (!evs || evs.length === 0) {
                      return <div style={{ ...muted, marginTop: 6 }}>Sin evidencias de ingreso</div>
                    }
                    return (
                      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' as const }}>
                        {evs.map(ev => (
                          <div key={ev.id} style={{ textAlign: 'center' as const }}>
                            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: 1 }}>
                              {ev.tipo_evidencia.replace('_', ' ')}
                            </div>
                            {ev.signedUrl ? (
                              <img
                                src={ev.signedUrl}
                                alt={ev.tipo_evidencia}
                                style={{ width: 72, height: 72, objectFit: 'cover' as const, borderRadius: 6, cursor: 'pointer', border: '1px solid #1e2d42' }}
                                onClick={() => window.open(ev.signedUrl!, '_blank')}
                              />
                            ) : (
                              <div style={{ width: 72, height: 72, background: '#1a2235', borderRadius: 6, border: '1px solid #1e2d42', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#64748b' }}>
                                Sin URL
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )
                  })()}
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
                <div style={{ display:'flex', alignItems:'flex-start', gap:12, flexWrap:'wrap' }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={screenTitle}>Inicio</div>
                    <div style={dateText}>Bandeja operativa · {fechaDDMMYYYY(hoy)}</div>
                  </div>
                  {/* Recarga el estado operativo sin F5 ni salir de la pantalla:
                      cargarDatos() vuelve a traer turnos, objetivos, guardias,
                      supervisiones y zonas, y el cambio de recargaRondas remonta
                      el panel de rondas, que trae sus propias alertas. */}
                  <button
                    type="button"
                    onClick={() => { void cargarDatos(); void recalcularAlertasRondas().then(() => setRecargaRondas(v => v + 1)) }}
                    disabled={loading}
                    style={{
                      background:'#1e293b', border:'1px solid #334155', borderRadius:10,
                      color: loading ? '#64748b' : '#e2e8f0', padding:'8px 14px', fontSize:13,
                      cursor: loading ? 'default' : 'pointer', minHeight:40, flex:'none',
                    }}
                  >
                    {loading ? 'Actualizando…' : '↻ Actualizar'}
                  </button>
                </div>

                <div style={statsGrid}>
                  <div style={{ ...statCard, cursor:'pointer', borderTop:`3px solid ${resumen.descubiertos > 0 ? '#ef4444' : '#334155'}` }} onClick={() => { setFiltroTurnos('descubierto'); setTab('turnos') }}>
                    <strong style={{ color: resumen.descubiertos > 0 ? '#ef4444' : '#e2e8f0' }}>{resumen.descubiertos}</strong>
                    <span>Puestos descubiertos</span>
                  </div>
                  {(() => {
                    const rondasNoIniciadas = rondaAlertas.filter(a => a.tipo === 'no_iniciada').length
                    return (
                      <div style={{ ...statCard, cursor:'pointer', borderTop:`3px solid ${rondasNoIniciadas > 0 ? '#ef4444' : '#334155'}` }} onClick={() => setTab('rondas')}>
                        <strong style={{ color: rondasNoIniciadas > 0 ? '#ef4444' : '#e2e8f0' }}>{rondasNoIniciadas}</strong>
                        <span>Rondas no iniciadas</span>
                      </div>
                    )
                  })()}
                  <div style={{ ...statCard, cursor:'pointer', borderTop:`3px solid ${agendaResumen.vencidas > 0 ? '#ef4444' : '#334155'}` }} onClick={() => { setAgendaEstadoFiltro('vencido'); setTimeout(() => document.getElementById('sec-agenda')?.scrollIntoView({ behavior:'smooth', block:'start' }), 50) }}>
                    <strong style={{ color: agendaResumen.vencidas > 0 ? '#ef4444' : '#e2e8f0' }}>{agendaResumen.vencidas}</strong>
                    <span>Supervisiones vencidas</span>
                  </div>
                  <div style={{ ...statCard, cursor:'pointer', borderTop:`3px solid ${turnosSinIngresoPendientes.length > 0 ? '#f59e0b' : '#334155'}` }} onClick={() => setTab('alertas')}>
                    <strong style={{ color: turnosSinIngresoPendientes.length > 0 ? '#f59e0b' : '#e2e8f0' }}>{turnosSinIngresoPendientes.length}</strong>
                    <span>Guardias sin fichar</span>
                  </div>
                  <div style={{ ...statCard, cursor:'pointer', borderTop:`3px solid ${turnosConTardanzaPendientes.length > 0 ? '#f59e0b' : '#334155'}` }} onClick={() => setTab('alertas')}>
                    <strong style={{ color: turnosConTardanzaPendientes.length > 0 ? '#f59e0b' : '#e2e8f0' }}>{turnosConTardanzaPendientes.length}</strong>
                    <span>Tardanzas</span>
                  </div>
                  {/* Lleva a Turnos con el período de hoy, como el resto de las
                      tarjetas: antes se veía igual pero no era accionable. */}
                  <div
                    style={{ ...statCard, cursor:'pointer', borderTop:'3px solid #334155' }}
                    onClick={() => { setFiltroTurnos('todos'); setFiltroFecha('hoy'); void cargarDatos('hoy'); setTab('turnos') }}
                  >
                    <strong>{resumen.total}</strong>
                    <span>Turnos hoy</span>
                  </div>
                </div>

                <div style={{ ...objetivoName, margin:'20px 0 8px' }}>Resumen operativo</div>
                <div style={statsGrid}>
                  <div style={{ ...statCard, cursor:'pointer' }} onClick={() => { setFiltroTurnos('en turno'); setTab('turnos') }}><strong style={{ color:'#10b981' }}>{resumen.enTurno}</strong><span>En turno</span></div>
                  <div style={{ ...statCard, borderTop:'3px solid #10b981' }}><strong style={{ color:'#10b981' }}>{agendaResumen.realizadasHoy}</strong><span>Supervisiones hoy</span></div>
                  <div style={{ ...statCard, cursor:'pointer', borderTop:`3px solid ${agendaResumen.proximas > 0 ? '#f59e0b' : '#334155'}` }} onClick={() => { setAgendaEstadoFiltro('proximo'); setTimeout(() => document.getElementById('sec-agenda')?.scrollIntoView({ behavior:'smooth', block:'start' }), 50) }}>
                    <strong style={{ color: agendaResumen.proximas > 0 ? '#f59e0b' : '#e2e8f0' }}>{agendaResumen.proximas}</strong>
                    <span>Próximas a vencer</span>
                  </div>
                  <div style={{ ...statCard, cursor:'pointer' }} onClick={() => setTab('alertas')}>
                    <strong style={{ color: totalAlertasPendientes > 0 ? '#f59e0b' : '#e2e8f0' }}>{totalAlertasPendientes}</strong>
                    <span>Alertas pendientes</span>
                  </div>
                </div>

                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:8 }}>
                  <button style={refreshButton} onClick={() => cargarDatos(filtroFecha)}>Actualizar</button>
                  <button
                    style={{ ...secondaryButton, opacity: activandoPush ? 0.65 : 1 }}
                    onClick={activarPush}
                    disabled={activandoPush}
                  >
                    {activandoPush ? 'Activando...' : 'Activar notificaciones'}
                  </button>
                </div>

                <div id="sec-agenda" style={{ ...objetivoName, margin:'24px 0 8px', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                  Agenda de supervisiones
                  {agendaEstadoFiltro !== 'todos' && (
                    <span
                      onClick={() => setAgendaEstadoFiltro('todos')}
                      style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:6, cursor:'pointer',
                        background: agendaEstadoFiltro === 'vencido' ? '#ef444422' : '#f59e0b22',
                        color:      agendaEstadoFiltro === 'vencido' ? '#ef4444'   : '#f59e0b',
                        border:    `1px solid ${agendaEstadoFiltro === 'vencido' ? '#ef4444' : '#f59e0b'}44` }}
                    >
                      {agendaEstadoFiltro === 'vencido' ? 'Vencidas' : 'Próximas'} · ✕ limpiar
                    </span>
                  )}
                </div>

                {zonasOperativas.length > 0 && (
                  <select
                    style={{ ...select, marginBottom:12 }}
                    value={agendaZonaFiltro}
                    onChange={e => setAgendaZonaFiltro(e.target.value)}
                  >
                    <option value="todas">{zonasIdsAsignadas.size > 0 ? 'Mis zonas' : 'Todas las zonas'}</option>
                    {zonasOperativas.map(z => (
                      <option key={z.id} value={z.id}>{z.nombre}</option>
                    ))}
                  </select>
                )}

                {(() => {
                  const agendaFiltrada = agendaEstadoFiltro === 'todos'
                    ? agendaSupervisiones
                    : agendaSupervisiones.filter(a => a.estadoAgenda === agendaEstadoFiltro)
                  if (agendaFiltrada.length === 0) return <div style={empty}>No hay objetivos para mostrar en la agenda.</div>
                  return agendaFiltrada.map(({ objetivo, zona, ultimaIso, horasDesdeUltima, frecuenciaHoras, estadoAgenda }) => {
                  const colorEstado = estadoAgenda === 'vencido' ? '#ef4444' : estadoAgenda === 'proximo' ? '#f59e0b' : '#10b981'
                  const etiquetaEstado = estadoAgenda === 'vencido' ? '🔴 Vencido' : estadoAgenda === 'proximo' ? '🟠 Próximo a vencer' : '🟢 Al día'

                  return (
                    <div key={objetivo.id} style={{ ...turnoCard, background:'#0f172a', borderLeft:`3px solid ${colorEstado}` }}>
                      <div style={turnoTop}>
                        <div>
                          <div style={objetivoName}>{objetivo.nombre}</div>
                          <div style={muted}>Zona: {zona}</div>
                        </div>
                        <span style={{ color:colorEstado, fontSize:12, fontWeight:700 }}>{etiquetaEstado}</span>
                      </div>
                      <div style={registroBox}>
                        <div>
                          <div style={label}>Última supervisión</div>
                          <div style={registroValue}>{ultimaIso ? fechaHoraDDMMYYYY(ultimaIso) : 'Nunca'}</div>
                        </div>
                        <div>
                          <div style={label}>Hace</div>
                          <div style={registroValue}>{horasDesdeUltima === null ? '—' : `${Math.round(horasDesdeUltima)} h`}</div>
                        </div>
                        <div>
                          <div style={label}>Frecuencia</div>
                          <div style={registroValue}>{frecuenciaHoras} h</div>
                        </div>
                      </div>
                      <button style={{ ...refreshButton, marginTop:10 }} onClick={() => irASupervisar(objetivo.id)}>
                        Supervisar
                      </button>
                    </div>
                  )
                })
                })()}
              </section>
            )}

            {tab === 'turnos' && (
              <section>
                <div style={screenTitle}>Turnos por objetivo</div>
                <button
                  style={{ ...refreshButton, minHeight: 46, marginBottom: 12, textAlign: 'center' }}
                  onClick={() => { setError(''); setMensaje(''); setModalTurno(true) }}
                >
                  Crear turno
                </button>
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
                <div style={screenTitle}>Guardias / Vigiladores</div>
                <div style={dateText}>Altas y bajas se envían a aprobación administrativa.</div>

                <div style={{ ...card, borderColor:'rgba(59,130,246,.35)', background:'rgba(59,130,246,.08)' }}>
                  <div style={objetivoName}>Solicitudes de vigiladores</div>
                  <div style={{ ...muted, marginBottom:12 }}>Crear una solicitud pendiente para que administración apruebe el alta.</div>
                  <button style={refreshButton} onClick={() => { setError(''); resetFormNuevoGuardia(); setModalNuevoGuardia(true) }}>
                    Solicitar alta de vigilador
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
                        {asignando === `baja-guardia-${g.id}` ? 'Enviando...' : 'Solicitar baja de vigilador'}
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            {tab === 'objetivos' && objetivoLegajoId && (
              <section style={{ minWidth: 0 }}>
                <CentroOperativoObjetivo
                  objetivoId={objetivoLegajoId}
                  onVolver={() => setObjetivoLegajoId(null)}
                  rolUsuario={user?.rol}
                />
              </section>
            )}

            {/* Rondas: se renderiza siempre y se oculta con CSS en vez de
                desmontarse para que el contador de Inicio tenga dato desde el
                arranque sin pedir las alertas dos veces. */}
            <section style={{ display: tab === 'rondas' ? 'block' : 'none' }}>
              <div style={screenTitle}>Rondas</div>
              <button
                style={{ ...refreshButton, minHeight: 46, marginBottom: 12, textAlign: 'center' }}
                onClick={() => setCrearRondaPickerAbierto(true)}
              >
                Crear ronda
              </button>

              <div
                ref={refObjetivos}
                style={{ ...card, marginTop: 0, marginBottom: 16, ...(focoRondas === 'objetivos' ? panelEnFoco : null) }}
              >
                <ControlDeRondasPanel
                  objetivos={objetivosControlRondas}
                  onPausaCambiada={() => setPausasToken(t => t + 1)}
                  recargarToken={pausasToken}
                />
              </div>

              <div style={statsGrid}>
                <button
                  type="button"
                  style={{ ...statCardBtn, borderTop:'3px solid #ef4444' }}
                  onClick={() => irAPanelRondas('incumplidas')}
                  aria-label={`Ver ${resumenRondas.incumplidas} rondas incumplidas`}
                >
                  <strong style={{ color:'#ef4444' }}>{resumenRondas.incumplidas}</strong>
                  <span>Incumplidas</span>
                </button>
                <button
                  type="button"
                  style={{ ...statCardBtn, borderTop:'3px solid #3b82f6' }}
                  onClick={() => irAPanelRondas('suspendidas')}
                  aria-label={`Ver ${resumenRondas.suspendidas} rondas suspendidas o pausadas`}
                >
                  <strong style={{ color:'#3b82f6' }}>{resumenRondas.suspendidas}</strong>
                  <span>Suspendidas</span>
                </button>
                <button
                  type="button"
                  style={{ ...statCardBtn, borderTop:'3px solid #f59e0b' }}
                  onClick={() => irAPanelRondas('objetivos')}
                  aria-label={`Ver los ${resumenRondas.objetivosAfectados} objetivos afectados`}
                >
                  <strong style={{ color:'#f59e0b' }}>{resumenRondas.objetivosAfectados}</strong>
                  <span>Objetivos afectados</span>
                </button>
              </div>

              <div
                ref={refSuspendidas}
                style={{ ...card, marginTop:12, ...(focoRondas === 'suspendidas' ? panelEnFoco : null) }}
              >
                <RondasPausadasPanel
                  objetivoId={null}
                  onCambio={() => setPausasToken(t => t + 1)}
                  recargarToken={pausasToken}
                />
              </div>

              <div
                ref={refIncumplidas}
                style={{ ...card, marginTop:12, ...(focoRondas === 'incumplidas' ? panelEnFoco : null) }}
              >
                <div style={{ fontSize: 15, fontWeight: 800, color: '#f8fafc', marginBottom: 10 }}>Alertas</div>
                <RondaAlertasPanel key={recargaRondas} objetivoId={null} soloPendientes onAlertas={setRondaAlertas} />
              </div>
            </section>


            {tab === 'objetivos' && !objetivoLegajoId && (
              <section>
                <div style={screenTitle}>Objetivos</div>
                <button
                  style={{ ...refreshButton, minHeight: 46, marginBottom: 12, textAlign: 'center' }}
                  onClick={() => { setError(''); resetFormNuevoObjetivo(); setModalNuevoObjetivo(true) }}
                >
                  Crear objetivo
                </button>
                <div style={dateText}>Las solicitudes de alta se envían a aprobación administrativa.</div>

                {objetivos.map(objetivo => (
                  <div key={objetivo.id} style={card}>
                    <div style={objetivoName}>{objetivo.nombre}</div>
                    <div style={muted}>{objetivo.direccion || 'Sin dirección'}</div>
                    <div style={muted}>Radio {objetivo.radio_metros || 200}m · Estado {objetivo.estado || 'activo'}</div>
                    <div style={muted}>GPS {objetivo.lat ?? '—'}, {objetivo.lng ?? '—'} · {ubicacionObjetivoCompleta(objetivo) ? 'Ubicación completa' : 'Falta GPS'}</div>
                    <button
                      type="button"
                      style={{ ...refreshButton, width:'100%', marginTop:12 }}
                      onClick={() => { setError(''); setObjetivoLegajoId(objetivo.id) }}
                    >
                      Ver legajo del objetivo
                    </button>
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
                        {asignando === `baja-objetivo-${objetivo.id}` ? 'Enviando...' : objetivo.estado === 'inactivo' ? 'Objetivo inactivo' : 'Solicitar baja de objetivo'}
                      </button>
                    </div>
                  </div>
                ))}
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
                                {(() => { const info = infoTurnoAlerta(turno); return (<>
                                  <div style={muted}>{info.linea}</div>
                                  <div style={muted}>{info.inicio}</div>
                                  <div style={muted}>{info.fin}</div>
                                  {info.nocturno && <div style={{ ...muted, color: '#818cf8' }}>Nocturno</div>}
                                  {info.estadoTemporal === 'en_curso' && <div style={{ ...muted, color: '#10b981', fontWeight: 600 }}>En curso</div>}
                                  {info.estadoTemporal === 'finalizado' && <div style={{ ...muted, color: '#60a5fa' }}>Finalizado</div>}
                                  {info.estadoTemporal === 'antiguo' && <div style={{ ...muted, color: '#ef4444' }}>Antiguo</div>}
                                </>)})()}
                                <div style={muted}>Estado: {turno.estado || 'programado'}</div>
                                <div style={muted}>Guardia esperado: {nombreGuardiaEsperado(turno)}</div>
                                <div style={{ ...muted, color: '#f59e0b' }}>{detalleTurnoDescubierto(turno)}</div>
                              </div>
                              <span style={badge('descubierto')}>descubierto</span>
                            </div>
                            {/* Lleva al mismo turno en la pestaña Turnos, donde
                                ya está el selector "Asignar guardia" con el
                                objetivo, la posición, la fecha y el horario
                                cargados. No hay una segunda vía de creación. */}
                            <button
                              type="button"
                              onClick={() => irACubrirTurno(turno)}
                              style={{ ...secondaryButton, marginTop:10, minHeight:44, background:'#1e3a8a', color:'#bfdbfe', border:'1px solid #1d4ed8' }}
                            >
                              Cubrir este turno
                            </button>
                            {renderAccionesAlerta(turno, 'descubierto')}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {turnosSinIngresoPendientes.length > 0 && (
                  <div style={{ ...card, borderColor: 'rgba(245,158,11,.35)', background: 'rgba(245,158,11,.08)' }}>
                    <div style={{ ...objetivoName, color: '#fbbf24' }}>Guardias sin fichar / Objetivos en riesgo</div>
                    <div style={muted}>{turnosSinIngresoPendientes.length} turno(s) iniciados hace más de 15 minutos sin entrada registrada.</div>

                    <div style={{ marginTop: 12 }}>
                      {turnosSinIngresoPendientes.map(turno => {
                        const objetivo = getObjetivo(turno.objetivo_id)
                        const guardia = getGuardia(turno.guardia_id)

                        return (
                          <div key={`alerta-sin-ingreso-${turno.id}`} style={{ ...turnoCard, background: '#111827' }}>
                            <div style={turnoTop}>
                              <div>
                                <div style={objetivoName}>{objetivo?.nombre || 'Objetivo sin nombre'}</div>
                                <div style={muted}>{objetivo?.direccion || 'Sin dirección registrada'}</div>
                                {(() => { const info = infoTurnoAlerta(turno); return (<>
                                  <div style={muted}>{info.linea}</div>
                                  <div style={muted}>{info.inicio}</div>
                                  <div style={muted}>{info.fin}</div>
                                  {info.nocturno && <div style={{ ...muted, color: '#818cf8' }}>Nocturno</div>}
                                  {info.estadoTemporal === 'en_curso' && <div style={{ ...muted, color: '#10b981', fontWeight: 600 }}>En curso</div>}
                                  {info.estadoTemporal === 'finalizado' && <div style={{ ...muted, color: '#60a5fa' }}>Finalizado</div>}
                                  {info.estadoTemporal === 'antiguo' && <div style={{ ...muted, color: '#ef4444' }}>Antiguo</div>}
                                </>)})()}
                                <div style={muted}>Guardia asignado: {guardia ? `${guardia.apellido}, ${guardia.nombre}` : 'Guardia sin asignar'}</div>
                                <div style={{ ...muted, color: '#f59e0b' }}>Minutos de demora: {minutosAtrasoTurno(turno)}</div>
                                <div style={{ ...muted, color: '#f59e0b' }}>Estado: Cobertura en riesgo</div>
                              </div>
                              <span style={alertBadge('objetivo en riesgo')}>objetivo en riesgo</span>
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
                      {turnosConTardanzaPendientes.map(({ turno, registro }) => {
                        const objetivo = getObjetivo(turno.objetivo_id)
                        const guardia = getGuardia(registro?.guardia_id || turno.guardia_id)

                        return (
                          <div key={`alerta-tardanza-${turno.id}-${registro.id}`} style={{ ...turnoCard, background: '#111827' }}>
                            <div style={turnoTop}>
                              <div>
                                <div style={objetivoName}>{guardia ? `${guardia.apellido}, ${guardia.nombre}` : 'Guardia sin asignar'}</div>
                                <div style={muted}>{objetivo?.nombre || 'Objetivo sin nombre'}</div>
                                {(() => { const info = infoTurnoAlerta(turno); return (<>
                                  <div style={muted}>{info.linea}</div>
                                  <div style={muted}>{info.inicio}</div>
                                  <div style={muted}>{info.fin}</div>
                                  {info.nocturno && <div style={{ ...muted, color: '#818cf8' }}>Nocturno</div>}
                                  {info.estadoTemporal === 'en_curso' && <div style={{ ...muted, color: '#10b981', fontWeight: 600 }}>En curso</div>}
                                  {info.estadoTemporal === 'finalizado' && <div style={{ ...muted, color: '#60a5fa' }}>Finalizado</div>}
                                  {info.estadoTemporal === 'antiguo' && <div style={{ ...muted, color: '#ef4444' }}>Antiguo</div>}
                                </>)})()}
                                <div style={muted}>Entrada real: {horaCorta(registro?.hora_entrada_final ?? registro?.hora_entrada_real)}</div>
                                <div style={{ ...muted, color: '#f59e0b' }}>Minutos tarde: {calcularMinutosTardanzaRegistro(turno, registro)}</div>
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
                      {turnosConGpsFueraRadioPendientes.map(({ turno, registro }) => {
                        const objetivo = getObjetivo(turno.objetivo_id)
                        const guardia = getGuardia(registro?.guardia_id || turno.guardia_id)
                        const gps = gpsRegistro(registro, 'ingreso')

                        return (
                          <div key={`alerta-gps-radio-${turno.id}-${registro.id}`} style={{ ...turnoCard, background: '#111827' }}>
                            <div style={turnoTop}>
                              <div>
                                <div style={objetivoName}>{guardia ? `${guardia.apellido}, ${guardia.nombre}` : 'Guardia sin asignar'}</div>
                                <div style={muted}>{objetivo?.nombre || 'Objetivo sin nombre'}</div>
                                {(() => { const info = infoTurnoAlerta(turno); return (<>
                                  <div style={muted}>{info.linea}</div>
                                  <div style={muted}>{info.inicio}</div>
                                  <div style={muted}>{info.fin}</div>
                                  {info.nocturno && <div style={{ ...muted, color: '#818cf8' }}>Nocturno</div>}
                                  {info.estadoTemporal === 'en_curso' && <div style={{ ...muted, color: '#10b981', fontWeight: 600 }}>En curso</div>}
                                  {info.estadoTemporal === 'finalizado' && <div style={{ ...muted, color: '#60a5fa' }}>Finalizado</div>}
                                  {info.estadoTemporal === 'antiguo' && <div style={{ ...muted, color: '#ef4444' }}>Antiguo</div>}
                                </>)})()}
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

                <div style={{ borderTop: '2px solid rgba(148,163,184,.2)', margin: '24px 0 16px' }} />
                <div style={{ ...objetivoName, margin:'0 0 8px' }}>Alertas intervenidas (resueltas)</div>
                {alertasIntervenidas.length === 0 ? (
                  <div style={empty}>No hay alertas intervenidas.</div>
                ) : (
                  <div style={{ ...card, borderColor:'rgba(16,185,129,.25)', background:'rgba(16,185,129,.07)', opacity: 0.85 }}>
                    <div style={muted}>{alertasIntervenidas.length} alerta(s) resueltas por intervención.</div>
                    <div style={{ marginTop: 12 }}>
                      {alertasIntervenidas.map(renderAlertaIntervenida)}
                    </div>
                  </div>
                )}

                <div style={{ ...objetivoName, margin:'20px 0 8px' }}>Solicitudes</div>
                <div style={muted}>Seguimiento de altas y bajas enviadas a administración.</div>
                {(() => {
                  const pendientes = solicitudesAdmin.filter(s => s.estado === 'pendiente')
                  const anteriores = solicitudesAdmin.filter(s => s.estado !== 'pendiente')
                  const anterioresVisibles = solicitudesAnterioresAbiertas ? anteriores : anteriores.slice(0, 5)

                  const renderSolicitud = (solicitud: SolicitudAdmin) => {
                    const datos = solicitud.datos_json || {}
                    const colorEstado: EstadoTurno = solicitud.estado === 'aprobado'
                      ? 'finalizado'
                      : solicitud.estado === 'rechazado'
                        ? 'descubierto'
                        : 'pendiente de ingreso'

                    return (
                      <div key={solicitud.id} style={{ ...card, marginTop:8 }}>
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
                  }

                  if (solicitudesAdmin.length === 0) {
                    return <div style={{ ...empty, marginTop:8 }}>No tenés solicitudes registradas.</div>
                  }

                  return (
                    <>
                      {pendientes.length > 0 && pendientes.map(renderSolicitud)}
                      {anteriores.length > 0 && (
                        <>
                          <div
                            style={{ ...objetivoName, margin:'16px 0 4px', fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}
                            onClick={() => setSolicitudesAnterioresAbiertas(!solicitudesAnterioresAbiertas)}
                          >
                            Solicitudes anteriores ({anteriores.length})
                            <span style={{ fontSize:11 }}>{solicitudesAnterioresAbiertas ? '▲' : '▼'}</span>
                          </div>
                          {anterioresVisibles.map(renderSolicitud)}
                          {!solicitudesAnterioresAbiertas && anteriores.length > 5 && (
                            <button
                              type="button"
                              style={{ ...secondaryButton, marginTop:8, width:'100%' }}
                              onClick={() => setSolicitudesAnterioresAbiertas(true)}
                            >
                              Ver todas ({anteriores.length})
                            </button>
                          )}
                        </>
                      )}
                    </>
                  )
                })()}
              </section>
            )}

            {tab === 'supervisiones' && (
              <section>
                <div style={screenTitle}>Supervisiones</div>
                <div style={dateText}>Control de objetivos con checklist, GPS y fotos.</div>

                <div style={statsGrid}>
                  <div style={statCard}><strong>{resumenSupervisiones.total}</strong><span>Hoy</span></div>
                  <div style={statCard}><strong>{resumenSupervisiones.observadas}</strong><span>Con observaciones</span></div>
                  <div style={statCard}><strong>{resumenSupervisiones.criticas}</strong><span>Críticas</span></div>
                  <div style={statCard}><strong>{objetivosActivos.length}</strong><span>Objetivos activos</span></div>
                </div>

                <div style={card}>
                  <div style={objetivoName}>Nueva supervisión</div>
                  <div style={muted}>Seleccioná el objetivo, capturá GPS y completá el checklist asignado.</div>

                  <label style={{ ...label, marginTop:16 }}>Objetivo activo</label>
                  <select
                    style={select}
                    value={supervisionObjetivoId}
                    onChange={e => {
                      setSupervisionObjetivoId(e.target.value)
                      setSupervisionGps(null)
                      setConfirmarGpsImpreciso(false)
                      setSupervisionRespuestas({})
                      setSupervisionFotos([])
                      setSupervisionObservaciones('')
                    }}
                  >
                    <option value="">Seleccionar objetivo...</option>
                    {objetivosActivos.map(objetivo => (
                      <option key={objetivo.id} value={objetivo.id}>{objetivo.nombre}</option>
                    ))}
                  </select>

                  {objetivoSupervision && (
                    <div style={{ ...registroBox, marginBottom:12 }}>
                      <div>
                        <div style={label}>Checklist</div>
                        <div style={registroValue}>{plantillaSupervision?.nombre || (objetivoSupervision.checklist_plantilla_id ? 'Plantilla no disponible' : 'Sin checklist asignado')}</div>
                      </div>
                      <div>
                        <div style={label}>Frecuencia</div>
                        <div style={registroValue}>{objetivoSupervision.frecuencia_supervision_horas || 24} h</div>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    style={{ ...refreshButton, opacity: capturandoGps ? 0.65 : 1, marginBottom:12 }}
                    onClick={capturarGpsSupervision}
                    disabled={capturandoGps}
                  >
                    {capturandoGps ? 'Capturando GPS...' : supervisionGps ? 'Actualizar GPS' : 'Capturar GPS'}
                  </button>

                  {supervisionGps && (
                    <div style={{ ...errorBox, color:'#10b981', borderColor:'rgba(16,185,129,.35)', background:'rgba(16,185,129,.12)' }}>
                      <div>GPS capturado · Precisión {metrosTexto(supervisionGps.precision)}</div>
                      <div style={{ marginTop:4 }}>Coordenadas {supervisionGps.lat.toFixed(6)}, {supervisionGps.lng.toFixed(6)}</div>
                      {auditoriaSupervisionActual && (
                        <>
                          <div style={{ marginTop:4 }}>Distancia al objetivo: {metrosTexto(auditoriaSupervisionActual.distancia_objetivo_metros)}</div>
                          <div style={{ marginTop:4 }}>{estadoRadioSupervisionTexto(auditoriaSupervisionActual)}</div>
                        </>
                      )}
                    </div>
                  )}

                  {auditoriaSupervisionActual?.gpsImpreciso && (
                    <div style={{ ...errorBox, color:'#f59e0b', borderColor:'rgba(245,158,11,.45)', background:'rgba(245,158,11,.12)' }}>
                      <div>GPS impreciso, espere unos segundos y vuelva a intentar</div>
                      <label style={{ display:'flex', gap:8, alignItems:'center', marginTop:10, color:'#f8fafc', fontWeight:700 }}>
                        <input
                          type="checkbox"
                          checked={confirmarGpsImpreciso}
                          onChange={e => setConfirmarGpsImpreciso(e.target.checked)}
                        />
                        Confirmar guardar igualmente con precisión mayor a {GPS_PRECISION_MAX_METROS} m
                      </label>
                    </div>
                  )}

                  {objetivoSupervision && itemsSupervision.length === 0 && (
                    <div style={{ ...empty, padding:12 }}>
                      Este objetivo no tiene ítems activos de checklist.
                    </div>
                  )}

                  {itemsSupervision.map(item => {
                    const respuesta = supervisionRespuestas[item.id]

                    return (
                      <div key={item.id} style={{ ...turnoCard, background:'#0f172a' }}>
                        <div style={turnoTop}>
                          <div>
                            <div style={objetivoName}>{item.texto}</div>
                            <div style={muted}>
                              {item.obligatorio ? 'Obligatorio' : 'Opcional'} · Criticidad {item.criticidad}{item.foto_obligatoria ? ' · Foto obligatoria' : ''}
                            </div>
                          </div>
                          <span style={supervisionBadge(item.criticidad === 'alta' ? 'critico' : 'ok')}>{item.criticidad}</span>
                        </div>

                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
                          {(['correcto', 'observado', 'no_aplica'] as ResultadoChecklist[]).map(resultado => {
                            const activo = respuesta?.resultado === resultado
                            return (
                              <button
                                key={resultado}
                                type="button"
                                onClick={() => actualizarRespuestaSupervision(item.id, { resultado })}
                                style={{
                                  ...secondaryButton,
                                  background: activo ? '#f59e0b' : secondaryButton.background,
                                  color: activo ? '#111827' : secondaryButton.color,
                                  borderColor: activo ? '#f59e0b' : '#374151',
                                }}
                              >
                                {resultado === 'correcto' ? 'Correcto' : resultado === 'observado' ? 'Observado' : 'N/A'}
                              </button>
                            )
                          })}
                        </div>

                        {respuesta?.resultado === 'observado' && (
                          <>
                            <label style={{ ...label, marginTop:12 }}>Observación del ítem</label>
                            <textarea
                              style={textarea}
                              value={respuesta.observacion}
                              onChange={e => actualizarRespuestaSupervision(item.id, { observacion: e.target.value })}
                            />
                          </>
                        )}
                      </div>
                    )
                  })}

                  <label style={label}>Observaciones generales</label>
                  <textarea
                    style={textarea}
                    value={supervisionObservaciones}
                    onChange={e => setSupervisionObservaciones(e.target.value)}
                  />

                  <label style={label}>Fotos</label>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
                    <label style={{ ...secondaryButton, margin:0, textAlign:'center' }}>
                      Tomar foto
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        capture="environment"
                        style={{ display:'none' }}
                        onChange={e => {
                          agregarFotosSupervision(e.target.files)
                          e.currentTarget.value = ''
                        }}
                      />
                    </label>
                    <label style={{ ...secondaryButton, margin:0, textAlign:'center' }}>
                      Elegir de galería
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        style={{ display:'none' }}
                        onChange={e => {
                          agregarFotosSupervision(e.target.files)
                          e.currentTarget.value = ''
                        }}
                      />
                    </label>
                  </div>
                  {supervisionFotos.length > 0 && (
                    <div style={{ ...muted, marginBottom:12 }}>
                      {supervisionFotos.length} foto(s): {supervisionFotos.map(foto => foto.name).join(', ')}
                      <button type="button" style={{ ...secondaryButton, marginTop:8, width:'100%' }} onClick={() => setSupervisionFotos([])}>
                        Quitar fotos seleccionadas
                      </button>
                    </div>
                  )}

                  {/* La acción principal va primero y sola: en pantallas angostas
                      una grilla de dos columnas dejaba "Guardar supervisión" con
                      ~115 px útiles, y como las pistas `1fr` no bajan del
                      min-content de "supervisión", el botón desbordaba la tarjeta
                      y quedaba cortado. Ahora ocupa el ancho disponible, con un
                      tope para que no se estire en pantallas grandes. */}
                  <div style={accionesSupervision}>
                    <button
                      type="button"
                      style={{ ...primaryActionButton, opacity: asignando === 'guardar-supervision' ? 0.65 : 1 }}
                      onClick={guardarSupervision}
                      disabled={asignando === 'guardar-supervision'}
                    >
                      {asignando === 'guardar-supervision' ? 'Guardando...' : 'Guardar supervisión'}
                    </button>
                    <button
                      type="button"
                      style={{ ...secondaryButton, minWidth: 0 }}
                      onClick={resetFormularioSupervision}
                    >
                      Limpiar
                    </button>
                  </div>
                </div>

                <div style={objetivoName}>Historial reciente</div>
                {supervisiones.length === 0 ? (
                  <div style={empty}>Todavía no hay supervisiones registradas.</div>
                ) : supervisiones.slice(0, 12).map(supervision => (
                  <div key={supervision.id} style={card}>
                    <div style={turnoTop}>
                      <div>
                        <div style={objetivoName}>{supervision.objetivo?.nombre || getObjetivo(supervision.objetivo_id)?.nombre || 'Objetivo sin nombre'}</div>
                        <div style={muted}>{fechaHoraDDMMYYYY(supervision.created_at)}</div>
                        <div style={muted}>GPS {Number(supervision.lat).toFixed(5)}, {Number(supervision.lng).toFixed(5)} · Precisión {metrosTexto(supervision.precision_gps)}</div>
                        {(() => {
                          const auditoria = auditoriaSupervisionGps(supervision.lat, supervision.lng, supervision.precision_gps, getObjetivo(supervision.objetivo_id))
                          return (
                            <div style={{ ...muted, color: auditoria.dentro_radio === false || auditoria.gpsImpreciso ? '#f59e0b' : muted.color }}>
                              Objetivo: {metrosTexto(auditoria.distancia_objetivo_metros)} · {estadoRadioSupervisionTexto(auditoria)}
                            </div>
                          )
                        })()}
                        <div style={muted}>{observadosSupervision(supervision)} ítem(s) observados · {fotosSupervisionCount(supervision)} foto(s)</div>
                        {supervision.observaciones && <div style={muted}>{supervision.observaciones}</div>}
                      </div>
                      <span
                        style={{ ...supervisionBadge(supervision.estado), cursor: 'pointer' }}
                        title="Ver detalle"
                        onClick={() => abrirDetalleSupervision(supervision)}
                      >{supervision.estado}</span>
                    </div>
                    <button type="button" style={secondaryButton} onClick={() => abrirDetalleSupervision(supervision)}>
                      Ver detalle
                    </button>
                  </div>
                ))}
              </section>
            )}

            {tab === 'planillas' && (
              <section>
                <BandejaPlanillas user={user} />
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

      {detalleSupervision && (
        <div style={modalOverlay}>
          <div style={modalCard}>
            <div style={screenTitle}>Detalle de supervisión</div>
            <div style={muted}>{detalleSupervision.objetivo?.nombre || getObjetivo(detalleSupervision.objetivo_id)?.nombre || 'Objetivo sin nombre'}</div>

            <div style={{ ...registroBox, margin:'16px 0' }}>
              <div>
                <div style={label}>Fecha/hora</div>
                <div style={registroValue}>{fechaHoraDDMMYYYY(detalleSupervision.created_at)}</div>
              </div>
              <div>
                <div style={label}>Estado</div>
                <span style={supervisionBadge(detalleSupervision.estado)}>{detalleSupervision.estado}</span>
              </div>
              <div>
                <div style={label}>Latitud</div>
                <div style={registroValue}>{detalleSupervision.lat}</div>
              </div>
              <div>
                <div style={label}>Longitud</div>
                <div style={registroValue}>{detalleSupervision.lng}</div>
              </div>
              <div>
                <div style={label}>Precisión GPS</div>
                <div style={registroValue}>{metrosTexto(detalleSupervision.precision_gps)}</div>
              </div>
              <div>
                <div style={label}>Distancia al objetivo</div>
                <div style={registroValue}>{metrosTexto(auditoriaDetalleSupervision?.distancia_objetivo_metros)}</div>
              </div>
              <div>
                <div style={label}>Dentro del radio</div>
                <div style={registroValue}>{auditoriaDetalleSupervision?.dentro_radio === null || auditoriaDetalleSupervision?.dentro_radio === undefined ? '—' : auditoriaDetalleSupervision.dentro_radio ? 'Sí' : 'No'}</div>
              </div>
              <div>
                <div style={label}>Radio permitido</div>
                <div style={registroValue}>{metrosTexto(auditoriaDetalleSupervision?.radio)}</div>
              </div>
              <div>
                <div style={label}>GPS impreciso</div>
                <div style={registroValue}>{auditoriaDetalleSupervision ? auditoriaDetalleSupervision.gpsImpreciso ? 'Sí' : 'No' : '—'}</div>
              </div>
            </div>

            <a
              href={mapsUrlSupervision(detalleSupervision)}
              target="_blank"
              rel="noreferrer"
              style={{ ...refreshButton, display:'block', textAlign:'center', textDecoration:'none', marginBottom:12 }}
            >
              Ver en Google Maps
            </a>

            <div style={{ marginBottom:16 }}>
              <div style={label}>Observaciones generales</div>
              <div style={{ ...muted, color:'#cbd5e1' }}>{detalleSupervision.observaciones || '—'}</div>
            </div>

            {detalleError && <div style={errorBox}>{detalleError}</div>}
            {detalleLoading ? (
              <div style={empty}>Cargando detalle...</div>
            ) : (
              <>
                <div style={{ ...objetivoName, marginBottom:8 }}>Checklist completo</div>
                {itemsDetalleSupervision.length === 0 ? (
                  <div style={empty}>Sin checklist asociado.</div>
                ) : itemsDetalleSupervision.map(item => {
                  const respuesta = respuestasDetallePorItem.get(item.id)

                  return (
                    <div key={item.id} style={{ ...turnoCard, background:'#0f172a' }}>
                      <div style={turnoTop}>
                        <div>
                          <div style={objetivoName}>{item.texto}</div>
                          <div style={muted}>
                            {item.obligatorio ? 'Obligatorio' : 'Opcional'} · Criticidad {item.criticidad}{item.foto_obligatoria ? ' · Foto obligatoria' : ''}
                          </div>
                        </div>
                        <span style={resultadoSupervisionBadge(respuesta?.resultado)}>
                          {respuesta?.resultado || 'sin respuesta'}
                        </span>
                      </div>
                      {respuesta?.observacion && <div style={{ ...muted, color:'#cbd5e1' }}>{respuesta.observacion}</div>}
                    </div>
                  )
                })}

                <div style={{ ...objetivoName, margin:'18px 0 8px' }}>Fotos adjuntas</div>
                {detalleFotos.length === 0 ? (
                  <div style={empty}>Sin fotos adjuntas.</div>
                ) : detalleFotos.map(foto => {
                  const fotoUrl = foto.signedUrl || foto.publicUrl

                  return (
                    <div key={foto.id} style={registroItem}>
                      {fotoUrl ? (
                        <>
                          <img src={fotoUrl} alt="" style={{ width:'100%', maxHeight:220, objectFit:'cover', borderRadius:8, marginBottom:8 }} />
                          <a href={fotoUrl} target="_blank" rel="noreferrer" style={{ color:'#f59e0b', fontSize:13 }}>Abrir foto</a>
                          {foto.error && <div style={{ ...muted, color:'#f59e0b' }}>{foto.error}</div>}
                        </>
                      ) : (
                        <>
                          <div style={{ ...muted, wordBreak:'break-all' }}>{foto.storage_path}</div>
                          {foto.error && <div style={{ ...muted, color:'#f59e0b' }}>{foto.error}</div>}
                        </>
                      )}
                    </div>
                  )
                })}
              </>
            )}

            <button type="button" style={{ ...secondaryButton, marginTop:12 }} onClick={() => setDetalleSupervision(null)}>
              Cerrar
            </button>
          </div>
        </div>
      )}

      {modalTurno && (
        <div style={modalOverlay}>
          <div style={modalCard}>
            <div style={screenTitle}>Crear turno</div>
            {error && <div style={errorBox}>{error}</div>}
            <label style={label}>Objetivo</label>
            <select style={select} value={formTurno.objetivo_id} onChange={e => setFormTurno({ ...formTurno, objetivo_id:e.target.value, puesto_id:'' })}>
              <option value="">Seleccionar</option>
              {objetivos.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>

            {/* El puesto se pide sólo si hay más de uno. Con uno se asigna solo. */}
            {estadoPuestosTurno?.caso === 'multiple' && (
              <>
                <label style={label}>Puesto</label>
                <select style={select} value={formTurno.puesto_id} onChange={e => setFormTurno({ ...formTurno, puesto_id:e.target.value })}>
                  <option value="">Seleccionar</option>
                  {estadoPuestosTurno.puestos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </>
            )}

            {estadoPuestosTurno?.caso === 'sin_puestos' && (
              <div style={errorBox}>{MENSAJE_SIN_PUESTOS_ACTIVOS}</div>
            )}

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
              {CARACTERISTICAS_TURNO.map(c => <option key={c} value={c}>{ETIQUETA_CARACTERISTICA[c]}</option>)}
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

      {turnoEditandoSup && (
        <div style={modalOverlay}>
          <div style={modalCard}>
            <div style={screenTitle}>Editar turno</div>
            <div style={muted}>
              {(() => {
                const obj = objetivos.find(o => o.id === turnoEditandoSup.objetivo_id)
                return obj?.nombre || 'Objetivo sin nombre'
              })()} · {turnoEditandoSup.fecha}
            </div>

            {estadoOpEdicionSup === 'EN_CURSO' && (
              <div style={{ margin: '12px 0', padding: 10, borderRadius: 8, background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.3)', color: '#f59e0b', fontSize: 13 }}>
                Este turno ya comenzó. Solo se modificará el horario programado; la asistencia real no será alterada.
              </div>
            )}

            {errorEdicionSup ? (
              <div style={{ margin: '12px 0', padding: 10, borderRadius: 8, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: '#fca5a5', fontSize: 13 }}>
                {errorEdicionSup}
              </div>
            ) : null}

            {estadoOpEdicionSup === 'FUTURO' && (
              <div>
                <label style={label}>Guardia</label>
                <select
                  style={select}
                  value={formEdicionSup.guardia_id}
                  onChange={e => setFormEdicionSup({ ...formEdicionSup, guardia_id: e.target.value })}
                >
                  <option value="">Sin asignar</option>
                  {guardias.filter(g => g.estado === 'activo').map(g => (
                    <option key={g.id} value={g.id}>{g.apellido}, {g.nombre}</option>
                  ))}
                </select>

                <label style={label}>Hora inicio</label>
                <input
                  type="time"
                  style={input}
                  value={formEdicionSup.hora_inicio}
                  onChange={e => setFormEdicionSup({ ...formEdicionSup, hora_inicio: e.target.value })}
                />
              </div>
            )}

            <label style={label}>Hora fin programada</label>
            <input
              type="time"
              style={input}
              value={formEdicionSup.hora_fin}
              onChange={e => setFormEdicionSup({ ...formEdicionSup, hora_fin: e.target.value })}
            />

            <label style={label}>Estado</label>
            <select
              style={select}
              value={formEdicionSup.estado}
              onChange={e => setFormEdicionSup({ ...formEdicionSup, estado: e.target.value as EstadoTurnoPersistido })}
            >
              <option value="programado">Programado</option>
              <option value="cubierto">Cubierto</option>
              <option value="descubierto">Descubierto</option>
            </select>

            <label style={label}>Comentario (opcional)</label>
            <input
              style={input}
              placeholder="Razón del cambio..."
              value={formEdicionSup.comentario}
              onChange={e => setFormEdicionSup({ ...formEdicionSup, comentario: e.target.value })}
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
              <button style={secondaryButton} onClick={cerrarEdicionTurno} disabled={loadingEdicionSup}>
                Cancelar
              </button>
              <button style={refreshButton} onClick={guardarEdicionTurno} disabled={loadingEdicionSup}>
                {loadingEdicionSup ? 'Guardando...' : 'Guardar cambios'}
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

      {crearRondaPickerAbierto && (
        <div style={modalOverlay}>
          <div style={modalCard}>
            <div style={screenTitle}>Crear ronda</div>
            <div style={muted}>Elegí un objetivo para abrir el editor de rondas en su legajo.</div>
            {objetivosActivos.length === 0 && (
              <div style={empty}>No hay objetivos activos.</div>
            )}
            <div style={{ maxHeight: '60vh', overflowY: 'auto', marginTop: 12 }}>
              {objetivosActivos.map(o => (
                <button
                  key={o.id}
                  style={{ ...secondaryButton, width: '100%', marginBottom: 8, textAlign: 'left', minHeight: 46 }}
                  onClick={() => {
                    setCrearRondaPickerAbierto(false)
                    setObjetivoLegajoId(o.id)
                    setTab('objetivos')
                  }}
                >
                  {o.nombre}
                </button>
              ))}
            </div>
            <button style={{ ...secondaryButton, marginTop: 12, width: '100%' }} onClick={() => setCrearRondaPickerAbierto(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      <nav style={nav}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id)
              if (t.id !== 'objetivos') setObjetivoLegajoId(null)
            }}
            style={{
              ...navButton,
              background: tab === t.id ? 'rgba(245,158,11,.12)' : 'transparent',
              color: tab === t.id ? '#f59e0b' : '#94a3b8',
            }}
          >
            <div style={{ fontSize: 16 }}>{t.icon}</div>
            <div style={{ fontSize: 10, lineHeight: 1.2 }}>{t.label}</div>
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
  paddingBottom: 'calc(93px + env(safe-area-inset-bottom, 0px))',
  // Ningún contenido puede generar scroll lateral en el shell móvil.
  overflowX: 'hidden',
  maxWidth: '100%',
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
  // Respeta el notch en horizontal sin perder los 20 px de margen base.
  paddingLeft: 'max(20px, env(safe-area-inset-left, 0px))',
  paddingRight: 'max(20px, env(safe-area-inset-right, 0px))',
  boxSizing: 'border-box',
  maxWidth: '100%',
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

// Misma tarjeta, pero como <button>: el resumen de Rondas lleva al panel que ya
// está más abajo en la pantalla. Se resetea la apariencia nativa del botón para
// que no se distinga de statCard, y se deja el cursor y el foco visibles porque
// acá sí hay algo que tocar.
const statCardBtn: React.CSSProperties = {
  ...statCard,
  appearance: 'none',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  width: '100%',
}

/** Resaltado momentáneo del panel al que se saltó desde el resumen. */
const panelEnFoco: React.CSSProperties = {
  outline: '2px solid #f59e0b',
  outlineOffset: 2,
  transition: 'outline-color 300ms ease',
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

// Acciones del formulario de supervisión, en columna: la principal arriba y a
// ancho completo, para que ningún ancho de pantalla la recorte.
const accionesSupervision: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  width: '100%',
}

// Botón de acción principal en móvil. `maxWidth` + `margin: auto` lo centran y
// evitan que se estire en pantallas anchas; `minWidth: 0` impide que el texto
// largo fuerce un ancho mínimo mayor que el contenedor, que es lo que producía
// el desborde horizontal.
const primaryActionButton: React.CSSProperties = {
  ...refreshButton,
  display: 'block',
  boxSizing: 'border-box',
  maxWidth: 420,
  minWidth: 0,
  marginLeft: 'auto',
  marginRight: 'auto',
  textAlign: 'center',
  cursor: 'pointer',
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
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  background: '#111827',
  borderTop: '1px solid #1e2d42',
  zIndex: 40,
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
}

const navButton: React.CSSProperties = {
  padding: '4px 2px',
  border: 'none',
  fontSize: 11,
  cursor: 'pointer',
  minWidth: 0,
  minHeight: 46,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
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

function supervisionBadge(estado: EstadoSupervision): React.CSSProperties {
  const colores: Record<EstadoSupervision, { bg: string, color: string }> = {
    ok: { bg: 'rgba(16,185,129,.18)', color: '#10b981' },
    con_observacion: { bg: 'rgba(245,158,11,.18)', color: '#f59e0b' },
    critico: { bg: 'rgba(239,68,68,.18)', color: '#f87171' },
    incompleta: { bg: 'rgba(148,163,184,.18)', color: '#94a3b8' },
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

function resultadoSupervisionBadge(resultado?: ResultadoChecklist): React.CSSProperties {
  const color = resultado === 'observado'
    ? '#f59e0b'
    : resultado === 'correcto'
      ? '#10b981'
      : '#94a3b8'

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
