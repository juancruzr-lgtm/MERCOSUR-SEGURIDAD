'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { calcAlertaEntrada, calcDistancia, supabase } from '@/lib/supabase'
import { activarNotificacionesPush } from '@/lib/push-client'
import { track, getDeviceContext, initTelemetry } from '@/lib/telemetry'
import RondasGuardiaPanel from '@/components/rondas/RondasGuardiaPanel'
import ResumenJornadaModal from '@/components/guardia/ResumenJornadaModal'

// ── CONSTANTES ────────────────────────────────────────────────
const INGRESO_PENDIENTE_KEY = 'mercosur_ingreso_pendiente'
const INGRESO_EXPIRACION_MS = 30 * 60 * 1000

// ── TIPOS ─────────────────────────────────────────────────────
interface Turno {
  id: string
  guardia_id?: string | null
  guardia_original_id?: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  objetivo_id: string
  puesto_id?: string | null
  estado: string
}

interface Objetivo {
  id: string
  nombre: string
  direccion?: string
  lat?: number
  lng?: number
  radio_metros?: number
  /** Objetivo pausado: el turno se conserva pero no se puede fichar el ingreso. */
  estado?: string | null
}

interface Puesto {
  id: string
  nombre: string
}

interface Registro {
  id: string
  turno_id: string
  guardia_id: string
  hora_entrada_real: string
  hora_salida_real?: string
  horas_trabajadas?: number
  latitud_ingreso?: number
  longitud_ingreso?: number
  precision_ingreso?: number
  latitud_egreso?: number
  longitud_egreso?: number
  precision_egreso?: number
  lat_entrada?: number
  lng_entrada?: number
  lat_salida?: number
  lng_salida?: number
  distancia_ingreso_metros?: number | null
  gps_ingreso_estado?: GpsEstadoRadio | string | null
  distancia_egreso_metros?: number | null
  gps_egreso_estado?: GpsEstadoRadio | string | null
}

interface GpsData {
  latitude: number
  longitude: number
  accuracy: number
}

type GpsPermissionState = 'checking' | 'granted' | 'prompt' | 'denied' | 'unsupported'
type GpsEstadoRadio = 'dentro_radio' | 'fuera_radio' | 'objetivo_sin_gps' | 'gps_no_disponible'
type IngresoFase = 'idle' | 'gps' | 'foto_libro' | 'foto_uniforme' | 'preview' | 'confirmando'

interface AuditoriaRadioGps {
  estado: GpsEstadoRadio
  distancia: number | null
  radio: number | null
}

// ── HELPERS ───────────────────────────────────────────────────
function calcHorasTrabajadas(entrada: string, salida: string): number {
  const [h1, m1] = entrada.split(':').map(Number)
  const [h2, m2] = salida.split(':').map(Number)
  let minutos = (h2 * 60 + m2) - (h1 * 60 + m1)
  if (minutos < 0) minutos += 1440
  return Math.round((minutos / 60) * 100) / 100
}

function fechaHoy(): string {
  return new Date().toLocaleDateString('sv-SE')
}

function fechaDDMMYYYY(fecha?: string | null): string {
  if (!fecha) return '—'

  const [year, month, day] = fecha.slice(0, 10).split('-')
  return year && month && day ? `${day}/${month}/${year}` : '—'
}

function fechaHoraTurno(fecha: string, hora: string): Date | null {
  const [year, month, day] = fecha.slice(0, 10).split('-').map(Number)
  const [hours, minutes, seconds = 0] = hora.split(':').map(Number)

  if (![year, month, day, hours, minutes, seconds].every(Number.isFinite)) return null

  return new Date(year, month - 1, day, hours, minutes, seconds)
}

function fechaFinTurno(turno: Turno): Date | null {
  const inicioTurno = fechaHoraTurno(turno.fecha, turno.hora_inicio)
  const finTurno = fechaHoraTurno(turno.fecha, turno.hora_fin)
  if (!inicioTurno || !finTurno) return null

  if (finTurno <= inicioTurno) {
    finTurno.setDate(finTurno.getDate() + 1)
  }

  return finTurno
}

function turnoFueReasignado(turno: Turno, guardiaId: string): boolean {
  return Boolean(
    turno.guardia_original_id &&
    turno.guardia_original_id === guardiaId &&
    turno.guardia_id &&
    turno.guardia_id !== guardiaId
  )
}

// Sólo decide sobre el INGRESO. El egreso va por otro camino a propósito: si
// pausan un objetivo con el vigilador adentro, ya fichado, tiene que poder
// registrar la salida igual. Bloquearlo lo dejaría sin cerrar el turno.
function mensajeBloqueoFichaje(
  turno: Turno,
  guardiaId: string,
  ahora: Date,
  objetivo?: { estado?: string | null } | null,
): string | null {
  if (turnoFueReasignado(turno, guardiaId)) {
    return 'Su turno fue reasignado por supervisión.'
  }

  // Objetivo pausado: el turno se conserva pero está fuera de operación. Mismo
  // criterio que el servidor (objetivos.estado = 'activo'). Sin el dato no se
  // bloquea: no dejar a nadie sin fichar por una consulta incompleta.
  if (objetivo && (objetivo.estado ?? 'activo') !== 'activo') {
    return 'Este objetivo está temporalmente fuera de servicio. Contacte al supervisor.'
  }

  const inicioTurno = fechaHoraTurno(turno.fecha, turno.hora_inicio)
  const finTurno = fechaFinTurno(turno)
  if (!inicioTurno || !finTurno) return 'No se pudo validar el horario del turno.'

  const desde = new Date(inicioTurno.getTime() - 30 * 60 * 1000)
  if (ahora < desde) return 'Fuera de horario de fichaje. Contacte al supervisor.'
  if (ahora > finTurno) return 'El turno ya finalizó. Contacte al supervisor.'

  return null
}

type EstadoTarjetaTurno =
  | 'pendiente'
  | 'cubierto'
  | 'ingreso_anticipado'
  | 'en_turno'
  | 'salida_pendiente'
  | 'completado'

// Estado que muestra la tarjeta del turno. El fichaje solo no alcanza: se puede
// dar presente hasta 30 minutos antes del inicio, y el registro queda abierto
// después del fin mientras no haya egreso. En esos dos tramos el turno no está
// vigente para el servidor, que habilita las rondas únicamente dentro de
// [hora_inicio, hora_fin); anunciar "En turno" ahí contradecía al panel de
// rondas. Se usan los mismos constructores de fecha/hora que el resto del
// componente para que el límite sea el mismo que ya valida el fichaje.
function estadoTarjetaTurno(turno: Turno, reg: Registro | undefined, ahora: Date): EstadoTarjetaTurno {
  if (reg?.hora_salida_real) return 'completado'

  if (reg) {
    const inicioTurno = fechaHoraTurno(turno.fecha, turno.hora_inicio)
    const finTurno = fechaFinTurno(turno)
    // Sin horario utilizable no se puede afirmar nada más preciso que el fichaje.
    if (!inicioTurno || !finTurno) return 'en_turno'

    if (ahora < inicioTurno) return 'ingreso_anticipado'
    if (ahora >= finTurno) return 'salida_pendiente'
    return 'en_turno'
  }

  return turno.estado === 'cubierto' ? 'cubierto' : 'pendiente'
}

async function consultarPermisoGps(): Promise<GpsPermissionState> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'unsupported'

  try {
    if (!navigator.permissions?.query) return 'prompt'

    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
    return status.state as GpsPermissionState
  } catch {
    return 'prompt'
  }
}

// Resultado enriquecido de adquisición GPS: incluye causa del fallo y tiempo de adquisición.
type GpsAcquireResult =
  | { ok: true;  data: GpsData; acq_ms: number }
  | { ok: false; reason: 'denied' | 'timeout' | 'unavailable' | 'unsupported'; acq_ms: number }

function adquirirGps(): Promise<GpsAcquireResult> {
  const t0 = Date.now()
  if (typeof navigator === 'undefined' || !navigator.geolocation)
    return Promise.resolve({ ok: false, reason: 'unsupported', acq_ms: 0 })

  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        ok: true,
        data: { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy },
        acq_ms: Date.now() - t0,
      }),
      err => {
        const reason = err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable'
        resolve({ ok: false, reason, acq_ms: Date.now() - t0 })
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  })
}

function esErrorColumnaGps(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const message = 'message' in error ? String((error as { message: unknown }).message) : ''
  const details = 'details' in error ? String((error as { details: unknown }).details) : ''
  const hint = 'hint' in error ? String((error as { hint: unknown }).hint) : ''

  return /latitud_ingreso|longitud_ingreso|precision_ingreso|latitud_egreso|longitud_egreso|precision_egreso|distancia_ingreso_metros|gps_ingreso_estado|distancia_egreso_metros|gps_egreso_estado/i
    .test(`${message} ${details} ${hint}`)
}

function numeroGps(value: unknown): number | null {
  const numero = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(numero) ? numero : null
}

function gpsRegistro(registro: Registro | undefined, tipo: 'ingreso' | 'egreso') {
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

function objetivoGps(objetivo?: Objetivo | null) {
  const lat = numeroGps(objetivo?.lat)
  const lng = numeroGps(objetivo?.lng)
  const radio = numeroGps(objetivo?.radio_metros)

  return lat !== null && lng !== null && radio !== null && radio > 0
    ? { lat, lng, radio }
    : null
}

function calcularAuditoriaRadioGps(gps: GpsData | null, objetivo?: Objetivo | null): AuditoriaRadioGps {
  if (!gps) return { estado: 'gps_no_disponible', distancia: null, radio: null }

  const destino = objetivoGps(objetivo)
  if (!destino) return { estado: 'objetivo_sin_gps', distancia: null, radio: null }

  const distancia = calcDistancia(gps.latitude, gps.longitude, destino.lat, destino.lng)

  return {
    estado: distancia <= destino.radio ? 'dentro_radio' : 'fuera_radio',
    distancia: Math.round(distancia),
    radio: destino.radio,
  }
}

function distanciaTexto(distancia?: number | null): string {
  const valor = numeroGps(distancia)
  return valor !== null ? `${Math.round(valor).toLocaleString('es-AR')} m` : '—'
}

function precisionTexto(precision?: number | null): string {
  const valor = numeroGps(precision)
  return valor !== null ? ` · Precisión ${Math.round(valor)} m` : ''
}

function mensajeAuditoriaRadio(auditoria: AuditoriaRadioGps, gps?: GpsData | null): string {
  const precision = precisionTexto(gps?.accuracy)

  if (auditoria.estado === 'dentro_radio') {
    return `GPS OK · Dentro del radio · Distancia ${distanciaTexto(auditoria.distancia)}${precision}`
  }

  if (auditoria.estado === 'fuera_radio') {
    return `GPS FUERA DEL OBJETIVO · Distancia ${distanciaTexto(auditoria.distancia)} · Radio permitido ${distanciaTexto(auditoria.radio)}${precision}`
  }

  if (auditoria.estado === 'objetivo_sin_gps') {
    return 'GPS registrado · Objetivo sin ubicación configurada'
  }

  return 'GPS no disponible, asistencia registrada sin ubicación.'
}

function estadoAuditoriaRegistro(registro: Registro | undefined, tipo: 'ingreso' | 'egreso'): GpsEstadoRadio | string | null | undefined {
  return tipo === 'ingreso' ? registro?.gps_ingreso_estado : registro?.gps_egreso_estado
}

function distanciaAuditoriaRegistro(registro: Registro | undefined, tipo: 'ingreso' | 'egreso'): number | null {
  return numeroGps(tipo === 'ingreso' ? registro?.distancia_ingreso_metros : registro?.distancia_egreso_metros)
}

function auditoriaGps(registro: Registro | undefined, tipo: 'ingreso' | 'egreso', objetivo?: Objetivo | null): string {
  const gps = gpsRegistro(registro, tipo)
  if (!gps) return '⚠ Sin GPS'

  const estado = estadoAuditoriaRegistro(registro, tipo)
  const distancia = distanciaAuditoriaRegistro(registro, tipo)
  const destino = objetivoGps(objetivo)
  const precision = precisionTexto(gps.precision)

  if (estado === 'dentro_radio') {
    return `📍 Dentro del radio · Distancia ${distanciaTexto(distancia)}${precision}`
  }

  if (estado === 'fuera_radio') {
    return `⚠ GPS fuera del objetivo · Distancia ${distanciaTexto(distancia)} · Radio ${distanciaTexto(destino?.radio)}${precision}`
  }

  if (estado === 'objetivo_sin_gps') {
    return '📍 GPS registrado · Objetivo sin ubicación configurada'
  }

  if (estado === 'gps_no_disponible') return '⚠ Sin GPS'

  return `📍 GPS registrado · Sin validación de radio${precision}`
}
// ── ESTILOS ───────────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    background: '#0a0e1a',
    fontFamily: 'DM Sans, sans-serif',
    color: '#e2e8f0',
    paddingBottom: 32,
  },
  header: {
    background: '#111827',
    borderBottom: '1px solid #1e2d42',
    padding: '16px 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    fontFamily: 'Syne, sans-serif',
    fontSize: 14,
    fontWeight: 800,
    color: '#f59e0b',
  },
  body: {
    padding: '20px 16px',
    maxWidth: 480,
    margin: '0 auto',
  },
  card: {
    background: '#111827',
    border: '1px solid #1e2d42',
    borderRadius: 14,
    padding: 20,
    marginBottom: 14,
  },
  label: {
    fontSize: 11,
    color: '#64748b',
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    fontWeight: 600,
    marginBottom: 4,
  },
  objetivo: {
    fontFamily: 'Syne, sans-serif',
    fontSize: 18,
    fontWeight: 800,
    color: '#e2e8f0',
    marginBottom: 4,
  },
  horario: {
    fontFamily: 'Syne, sans-serif',
    fontSize: 28,
    fontWeight: 800,
    color: '#f59e0b',
    marginBottom: 16,
  },
  btn: {
    width: '100%',
    padding: '16px',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    border: 'none',
    fontFamily: 'Syne, sans-serif',
    transition: 'opacity 0.15s',
  },
  btnPresente: {
    background: '#10b981',
    color: '#fff',
  },
  btnSalida: {
    background: '#f59e0b',
    color: '#000',
  },
  btnDisabled: {
    background: '#1e2d42',
    color: '#64748b',
    cursor: 'not-allowed',
  },
  input: {
    width: '100%',
    background: '#1a2235',
    border: '1px solid #1e2d42',
    borderRadius: 10,
    padding: '12px 14px',
    color: '#e2e8f0',
    fontSize: 14,
    outline: 'none',
  },
  badge: (tipo: string): React.CSSProperties => {
    const map: Record<string, { bg: string, color: string }> = {
      presente:   { bg: 'rgba(16,185,129,.15)',  color: '#10b981' },
      completado: { bg: 'rgba(16,185,129,.15)',  color: '#10b981' },
      programado: { bg: 'rgba(100,116,139,.15)', color: '#94a3b8' },
      cubierto:   { bg: 'rgba(16,185,129,.15)',  color: '#10b981' },
      en_turno:   { bg: 'rgba(16,185,129,.15)',  color: '#10b981' },
      // Ingreso registrado y salida disponible, pero el turno no está corriendo:
      // ámbar para que no se lea como "En turno".
      ingreso_anticipado: { bg: 'rgba(245,158,11,.15)', color: '#f59e0b' },
      salida_pendiente:   { bg: 'rgba(245,158,11,.15)', color: '#f59e0b' },
    }
    const c = map[tipo] || { bg: 'rgba(100,116,139,.15)', color: '#94a3b8' }
    return {
      display: 'inline-block',
      padding: '3px 10px',
      borderRadius: 20,
      fontSize: 11,
      fontWeight: 700,
      background: c.bg,
      color: c.color,
    }
  },
  row: {
    display: 'flex',
    gap: 12,
    marginBottom: 8,
  },
  col: {
    flex: 1,
    background: '#1a2235',
    borderRadius: 10,
    padding: '10px 14px',
  },
  colLabel: {
    fontSize: 10,
    color: '#64748b',
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: 4,
  },
  colValue: {
    fontFamily: 'Syne, sans-serif',
    fontSize: 16,
    fontWeight: 700,
    color: '#f59e0b',
  },
  alert: (tipo: 'ok' | 'warn' | 'error'): React.CSSProperties => ({
    padding: '12px 16px',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 500,
    marginBottom: 14,
    background: tipo === 'ok' ? 'rgba(16,185,129,.1)' : tipo === 'warn' ? 'rgba(245,158,11,.1)' : 'rgba(239,68,68,.1)',
    border: `1px solid ${tipo === 'ok' ? 'rgba(16,185,129,.3)' : tipo === 'warn' ? 'rgba(245,158,11,.3)' : 'rgba(239,68,68,.3)'}`,
    color: tipo === 'ok' ? '#10b981' : tipo === 'warn' ? '#f59e0b' : '#ef4444',
  }),
  empty: {
    textAlign: 'center' as const,
    padding: '48px 20px',
    color: '#64748b',
  },
  sinTurnos: {
    fontSize: 36,
    marginBottom: 12,
  },
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(10,14,26,0.97)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: 20,
    overflowY: 'auto' as const,
  },
  overlayCard: {
    background: '#111827',
    border: '1px solid #1e2d42',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 420,
    marginTop: 'auto' as const,
    marginBottom: 'auto' as const,
  },
  overlayTitle: {
    fontFamily: 'Syne, sans-serif',
    fontSize: 20,
    fontWeight: 800,
    color: '#e2e8f0',
    marginBottom: 12,
  } as React.CSSProperties,
  overlayStep: {
    fontSize: 11,
    color: '#64748b',
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    fontWeight: 600,
    marginBottom: 6,
  },
}

// ── COMPONENTE PRINCIPAL ──────────────────────────────────────
export default function GuardiaMobile({ user }: { user: any }) {
  const router = useRouter()
  const [turnos, setTurnos]       = useState<Turno[]>([])
  const [objetivos, setObjetivos] = useState<Objetivo[]>([])
  const [registros, setRegistros] = useState<Registro[]>([])
  const [puestos, setPuestos]     = useState<Puesto[]>([])
  // Resumen post-egreso (continuidad): se abre solo, apenas se registra la
  // salida. Si no se responde y se cierra la app, sigue disponible en Mi
  // Planilla — no hay otro lugar donde vivan estos datos.
  const [resumenTurnoId, setResumenTurnoId] = useState<string | null>(null)
  const [loading, setLoading]     = useState(true)
  const [fichando, setFichando]   = useState<string | null>(null)
  const [mensaje, setMensaje]     = useState<{ texto: string, tipo: 'ok' | 'warn' | 'error' } | null>(null)
  const [perfilAbierto, setPerfilAbierto] = useState(false)
  const [nuevaPassword, setNuevaPassword] = useState('')
  const [confirmarPassword, setConfirmarPassword] = useState('')
  const [perfilMensaje, setPerfilMensaje] = useState<{ texto: string, tipo: 'ok' | 'error' } | null>(null)
  const [guardandoPassword, setGuardandoPassword] = useState(false)
  const [ahora, setAhora] = useState(() => new Date())
  const [permisoGps, setPermisoGps] = useState<GpsPermissionState>('checking')
  const [activandoPush, setActivandoPush] = useState(false)
  const [ingresoFase, setIngresoFase] = useState<IngresoFase>('idle')
  const [ingresoTurno, setIngresoTurno] = useState<Turno | null>(null)
  const [ingresoGps, setIngresoGps] = useState<GpsData | null>(null)
  const [fotoLibro, setFotoLibro] = useState<{ file: File; url: string } | null>(null)
  const [fotoUniforme, setFotoUniforme] = useState<{ file: File; url: string } | null>(null)
  const inputLibroRef = useRef<HTMLInputElement>(null)
  const inputUniformeRef = useRef<HTMLInputElement>(null)
  const [ingresoRestaurado, setIngresoRestaurado] = useState(false)
  // Se incrementa al confirmar un ingreso: le pide al panel de rondas una única
  // recarga inmediata, sin agregar polling ni listeners.
  const [rondasRecarga, setRondasRecarga] = useState(0)
  const ingresoIntentoId = useRef<string | null>(null)
  const restorationAttempted = useRef(false)
  const ingresoStartTime = useRef<number | null>(null)
  const [refrescando, setRefrescando] = useState(false)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [ultimaActualizacion, setUltimaActualizacion] = useState<Date | null>(null)
  // Impide recargas superpuestas: intervalo, focus y online pueden dispararse juntos.
  const cargaEnCursoRef = useRef(false)
  // Un refresco de fondo no debe pisar el estado optimista durante un fichaje.
  const operacionEnCursoRef = useRef(false)
  // initTelemetry abre sesión y emite session_start: sólo una vez por montaje.
  const telemetriaIniciadaRef = useRef(false)

  const hoy = ahora.toLocaleDateString('sv-SE')
  const ayer = new Date(ahora.getTime() - 86400000).toLocaleDateString('sv-SE')

  const activarPush = async () => {
    setActivandoPush(true)
    try {
      const resultado = await activarNotificacionesPush()
      setMensaje({ texto: resultado.message, tipo: resultado.ok ? 'ok' : 'error' })
      setTimeout(() => setMensaje(null), 7000)
    } catch (error) {
      setMensaje({
        texto: error instanceof Error ? error.message : 'No se pudo activar notificaciones. Error desconocido.',
        tipo: 'error',
      })
    } finally {
      setActivandoPush(false)
    }
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

  // Cargar datos — reutilizable: montaje, intervalo, visibilidad, focus, online y botón manual.
  // `silencioso` = disparo automático de fondo (no muestra el spinner del botón).
  const recargarDatos = useCallback(async (opciones?: { silencioso?: boolean }) => {
    const silencioso = opciones?.silencioso === true

    // Una sola carga a la vez.
    if (cargaEnCursoRef.current) return
    // Un refresco de fondo nunca interrumpe un fichaje en curso.
    if (silencioso && operacionEnCursoRef.current) return

    cargaEnCursoRef.current = true
    if (!silencioso) setRefrescando(true)

    try {
      const [turnosRes, objetivosRes, registrosRes, puestosRes] = await Promise.all([

        supabase
          .from('turnos')
          .select('*')
          .or(`guardia_id.eq.${user.id},guardia_original_id.eq.${user.id}`)
          .in('fecha', [ayer, hoy])
          .order('hora_inicio'),

        supabase
          .from('objetivos')
          // `estado` es nuevo: sin él la pantalla no podía saber que el objetivo
          // estaba pausado y ofrecía fichar igual.
          .select('id, nombre, direccion, lat, lng, radio_metros, estado'),

        supabase
          .from('registros_asistencia')
          .select('*')
          .eq('guardia_id', user.id),

        supabase
          .from('puestos')
          .select('id, nombre'),

      ])

      // Un error deja intactos los datos previos: la pantalla nunca se vacía.
      if (turnosRes.error || objetivosRes.error || registrosRes.error || puestosRes.error) {
        console.error('Error cargando datos del guardia', {
          turnos: turnosRes.error,
          objetivos: objetivosRes.error,
          registros: registrosRes.error,
          puestos: puestosRes.error,
        })
        setErrorCarga('No se pudieron actualizar los turnos')
        return
      }

      // Sólo mostrar turnos de ayer si son nocturnos (cruzan medianoche)
      const filtrados = (turnosRes.data || []).filter((turno: Turno) => {
        if (turno.fecha !== ayer) return true
        const [hI, mI] = turno.hora_inicio.split(':').map(Number)
        const [hF, mF] = turno.hora_fin.split(':').map(Number)
        return (hF * 60 + mF) <= (hI * 60 + mI)
      })

      setTurnos(filtrados)
      setObjetivos(objetivosRes.data || [])
      setRegistros(registrosRes.data || [])
      setPuestos(puestosRes.data || [])
      setErrorCarga(null)
      setUltimaActualizacion(new Date())
    } catch (error) {
      console.error('Error cargando datos del guardia', error)
      setErrorCarga('No se pudieron actualizar los turnos')
    } finally {
      cargaEnCursoRef.current = false
      setRefrescando(false)
      setLoading(false)

      if (!telemetriaIniciadaRef.current) {
        telemetriaIniciadaRef.current = true
        void initTelemetry(user.id, user.rol ?? 'guardia')
      }
    }
  }, [user.id, user.rol, hoy, ayer])

  // ── Turnos de la planilla sin revisar ──────────────────────────────────────
  //
  // El vigilador confirma su jornada en el resumen que aparece apenas marca la
  // salida. Si lo cierra sin responder —o si nunca marcó salida y el turno lo
  // cerró el cron, en cuyo caso el resumen no llegó a aparecer— la acción
  // queda en Mi Planilla, que es justo la pantalla donde no entra.
  //
  // Este contador trae ese número acá, a la pantalla que sí mira todos los
  // días. No calcula nada nuevo: es el mismo `pendientes_revision` que ya
  // devuelve la API del legajo.
  const [pendientesPlanilla, setPendientesPlanilla] = useState(0)

  const cargarPendientesPlanilla = useCallback(async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) return
      const res = await fetch(`/api/legajo/${user.id}/planilla`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const json = await res.json()
      setPendientesPlanilla(Number(json?.pendientes_revision) || 0)
    } catch {
      // Un contador que no carga no puede romper la pantalla de fichaje:
      // se queda con el valor anterior y no muestra ningún error.
    }
  }, [user.id])

  // Se recalcula con cada refresco de la pantalla —el ↻ y los automáticos ya
  // mueven ultimaActualizacion—, así baja solo cuando el vigilador confirma.
  useEffect(() => {
    if (!ultimaActualizacion) return
    void cargarPendientesPlanilla()
  }, [cargarPendientesPlanilla, ultimaActualizacion])

  // Mantiene la bandera de "operación en curso" sin recrear recargarDatos.
  useEffect(() => {
    operacionEnCursoRef.current = ingresoFase !== 'idle' || fichando !== null
  }, [ingresoFase, fichando])

  // Carga inicial (y recarga automática al cambiar el día).
  useEffect(() => {
    void recargarDatos()
  }, [recargarDatos])

  // Refrescos automáticos: intervalo con pantalla visible, vuelta de segundo plano, focus y reconexión.
  useEffect(() => {
    const refrescarSiVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void recargarDatos({ silencioso: true })
    }

    const intervalo = window.setInterval(refrescarSiVisible, 60000)

    document.addEventListener('visibilitychange', refrescarSiVisible)
    window.addEventListener('focus', refrescarSiVisible)
    window.addEventListener('online', refrescarSiVisible)

    return () => {
      window.clearInterval(intervalo)
      document.removeEventListener('visibilitychange', refrescarSiVisible)
      window.removeEventListener('focus', refrescarSiVisible)
      window.removeEventListener('online', refrescarSiVisible)
    }
  }, [recargarDatos])

  useEffect(() => {
    const timer = window.setInterval(() => setAhora(new Date()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  // Persiste el intento de ingreso en sessionStorage mientras el supervisor
  // está en la fase de captura de fotos. No persiste File/Blob.
  useEffect(() => {
    if (!ingresoTurno || !ingresoGps) return
    if (ingresoFase === 'idle' || ingresoFase === 'gps' || ingresoFase === 'confirmando') return

    sessionStorage.setItem(INGRESO_PENDIENTE_KEY, JSON.stringify({
      turno_id: ingresoTurno.id,
      gps: ingresoGps,
      timestamp: Date.now(),
      intento_id: ingresoIntentoId.current,
    }))
  }, [ingresoFase, ingresoTurno, ingresoGps])

  // Restaura un intento de ingreso pendiente después de que los datos carguen.
  // Solo corre una vez. Verifica que no exista ya un registro para evitar duplicados.
  useEffect(() => {
    if (loading || restorationAttempted.current) return
    restorationAttempted.current = true

    const stored = sessionStorage.getItem(INGRESO_PENDIENTE_KEY)
    if (!stored) return

    let parsed: { turno_id: string; gps: GpsData; timestamp: number; intento_id: string | null }
    try {
      parsed = JSON.parse(stored)
    } catch {
      sessionStorage.removeItem(INGRESO_PENDIENTE_KEY)
      return
    }

    if (!parsed.turno_id || !parsed.gps || !parsed.timestamp) {
      sessionStorage.removeItem(INGRESO_PENDIENTE_KEY)
      return
    }

    if (Date.now() - parsed.timestamp > INGRESO_EXPIRACION_MS) {
      sessionStorage.removeItem(INGRESO_PENDIENTE_KEY)
      return
    }

    const turno = turnos.find(t => t.id === parsed.turno_id)
    if (!turno) {
      sessionStorage.removeItem(INGRESO_PENDIENTE_KEY)
      return
    }

    const registroExistente = registros.find(r => r.turno_id === parsed.turno_id && r.hora_entrada_real)
    if (registroExistente) {
      sessionStorage.removeItem(INGRESO_PENDIENTE_KEY)
      return
    }

    ingresoIntentoId.current = parsed.intento_id
    setIngresoTurno(turno)
    setIngresoGps(parsed.gps)
    setIngresoFase('foto_libro')
    setIngresoRestaurado(true)
    ingresoStartTime.current = Date.now()

    const ctx = getDeviceContext()
    track('pagina_restaurada', {
      screen: 'ingreso_flow',
      turno_id: turno.id,
      gps_lat: parsed.gps.latitude,
      gps_lng: parsed.gps.longitude,
      gps_accuracy_m: parsed.gps.accuracy,
      value_json: {
        fase: 'foto_libro',
        intento_id: parsed.intento_id,
        age_ms: Date.now() - parsed.timestamp,
        browser: ctx.browser_name,
        os: ctx.os_name,
        memory_gb: typeof navigator !== 'undefined' ? (navigator as any).deviceMemory ?? null : null,
      },
    })
    track('intento_ingreso_recuperado', {
      screen: 'ingreso_flow',
      turno_id: turno.id,
      value_json: {
        intento_id: parsed.intento_id,
        timestamp_original: parsed.timestamp,
        age_ms: Date.now() - parsed.timestamp,
      },
    })
  }, [loading, turnos, registros])

  useEffect(() => {
    let activo = true
    let permissionStatus: PermissionStatus | null = null

    const verificarPermiso = async () => {
      const estado = await consultarPermisoGps()
      if (activo) setPermisoGps(estado)
    }

    verificarPermiso()

    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      navigator.permissions.query({ name: 'geolocation' as PermissionName })
        .then(status => {
          permissionStatus = status
          if (activo) setPermisoGps(status.state as GpsPermissionState)
          status.onchange = () => {
            if (activo) setPermisoGps(status.state as GpsPermissionState)
          }
        })
        .catch(() => {
          if (activo) setPermisoGps('prompt')
        })
    }

    return () => {
      activo = false
      if (permissionStatus) permissionStatus.onchange = null
    }
  }, [])

  // Registro de este turno
  const registroDelTurno = (turnoId: string) =>
    registros.find(r => r.turno_id === turnoId)

  function horaActual(): string {
    return new Date().toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  }

  const resetIngresoFlow = () => {
    setIngresoFase('idle')
    setIngresoTurno(null)
    setIngresoGps(null)
    setFotoLibro(prev => { if (prev) URL.revokeObjectURL(prev.url); return null })
    setFotoUniforme(prev => { if (prev) URL.revokeObjectURL(prev.url); return null })
    setIngresoRestaurado(false)
    ingresoIntentoId.current = null
    ingresoStartTime.current = null
    sessionStorage.removeItem(INGRESO_PENDIENTE_KEY)
  }

  const cancelarIngreso = () => {
    track('ingreso_cancelled', {
      screen: 'ingreso_flow',
      turno_id: ingresoTurno?.id,
      duration_ms: ingresoStartTime.current ? Date.now() - ingresoStartTime.current : undefined,
      value_json: { intento_id: ingresoIntentoId.current, fase: ingresoFase },
      result: 'cancelado',
    })
    resetIngresoFlow()
  }

  // Iniciar ingreso: valida, obtiene GPS, luego abre flujo de fotos
  const iniciarIngreso = async (turno: Turno) => {
    const bloqueo = mensajeBloqueoFichaje(turno, user.id, new Date(), getObjetivo(turno.objetivo_id))
    if (bloqueo) {
      setMensaje({ texto: bloqueo, tipo: 'error' })
      setTimeout(() => setMensaje(null), 4000)
      return
    }

    // Asignar intento_id antes del GPS para vincular todos los eventos al mismo intento
    const intentoId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    ingresoIntentoId.current = intentoId
    ingresoStartTime.current = Date.now()

    setIngresoTurno(turno)
    setIngresoFase('gps')
    setMensaje(null)

    track('ingreso_started', {
      screen: 'ingreso_flow',
      turno_id: turno.id,
      value_json: { intento_id: intentoId, permiso_gps: permisoGps },
    })

    track('gps_requested', {
      screen: 'ingreso_flow',
      turno_id: turno.id,
      value_json: { intento_id: intentoId, tipo: 'ingreso' },
    })

    const gpsResult = await adquirirGps()

    if (!gpsResult.ok) {
      // GPS no disponible — modo degradado: advertencia, flujo continúa sin coordenadas.
      // Se registra gps_ingreso_estado = 'gps_no_disponible' al confirmar.
      const eventName = gpsResult.reason === 'denied' || gpsResult.reason === 'unsupported'
        ? 'gps_denied' : gpsResult.reason === 'timeout' ? 'gps_timeout' : 'gps_unavailable'
      track(eventName, {
        screen: 'ingreso_flow',
        turno_id: turno.id,
        duration_ms: gpsResult.acq_ms,
        err_code: gpsResult.reason,
        err_function: 'adquirirGps',
        value_json: { intento_id: intentoId, tipo: 'ingreso' },
      })
      const ctx = getDeviceContext()
      track('ingreso_flujo_iniciado', {
        screen: 'ingreso_flow',
        turno_id: turno.id,
        value_json: {
          intento_id: intentoId,
          gps_disponible: false,
          gps_razon: gpsResult.reason,
          browser: ctx.browser_name,
          os: ctx.os_name,
        },
      })
      setMensaje({ texto: 'GPS no disponible — podés continuar. El ingreso se registrará sin ubicación.', tipo: 'warn' })
      setTimeout(() => setMensaje(null), 5000)
    } else {
      const { data: gps, acq_ms } = gpsResult

      track('gps_success', {
        screen: 'ingreso_flow',
        turno_id: turno.id,
        gps_lat: gps.latitude,
        gps_lng: gps.longitude,
        gps_accuracy_m: gps.accuracy,
        gps_acq_ms: acq_ms,
        value_json: { intento_id: intentoId, tipo: 'ingreso' },
      })

      // Precisión baja: emitir evento pero no bloquear (negocio lo permite)
      if (gps.accuracy > 150) {
        track('gps_imprecise', {
          screen: 'ingreso_flow',
          turno_id: turno.id,
          gps_lat: gps.latitude,
          gps_lng: gps.longitude,
          gps_accuracy_m: gps.accuracy,
          value_json: { intento_id: intentoId, tipo: 'ingreso', umbral_m: 150 },
        })
      }

      setIngresoGps(gps)

      const ctx = getDeviceContext()
      track('ingreso_flujo_iniciado', {
        screen: 'ingreso_flow',
        turno_id: turno.id,
        gps_lat: gps.latitude,
        gps_lng: gps.longitude,
        gps_accuracy_m: gps.accuracy,
        gps_acq_ms: acq_ms,
        value_json: {
          intento_id: intentoId,
          gps_disponible: true,
          browser: ctx.browser_name,
          os: ctx.os_name,
          memory_gb: typeof navigator !== 'undefined' ? (navigator as any).deviceMemory ?? null : null,
        },
      })
    }

    setIngresoFase('foto_libro')
  }

  const comprimirFoto = (file: File, maxWidth = 1280, quality = 0.75): Promise<File> =>
    new Promise((resolve, reject) => {
      const TIMEOUT_MS = 8000
      let urlRevoked = false
      const url = URL.createObjectURL(file)
      const revokeUrl = () => { if (!urlRevoked) { urlRevoked = true; URL.revokeObjectURL(url) } }
      const timer = setTimeout(() => { revokeUrl(); reject(new Error('compresion_timeout')) }, TIMEOUT_MS)

      const img = new Image()
      img.onload = () => {
        revokeUrl()
        const scale = Math.min(1, maxWidth / img.width)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) { clearTimeout(timer); return reject(new Error('canvas_no_disponible')) }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(blob => {
          clearTimeout(timer)
          if (!blob) return reject(new Error('compresion_blob_fallo'))
          resolve(new File([blob], file.name, { type: 'image/jpeg' }))
        }, 'image/jpeg', quality)
      }
      img.onerror = () => { clearTimeout(timer); revokeUrl(); reject(new Error('imagen_carga_fallo')) }
      img.src = url
    })

  // Confirmar ingreso: INSERT registro → compresión → upload → UPDATE turno
  // Cada paso emite su propio evento con err_code específico para diagnóstico.
  const confirmarIngreso = async () => {
    if (!ingresoTurno || !fotoLibro || !fotoUniforme) return

    setIngresoFase('confirmando')

    const intentoId  = ingresoIntentoId.current
    const hora       = horaActual()
    const objetivo   = getObjetivo(ingresoTurno.objetivo_id)
    const auditoria  = calcularAuditoriaRadioGps(ingresoGps, objetivo)

    // ── PASO 1: Crear o reutilizar registro de asistencia ─────────────────────
    let registroId: string

    const { data: existente } = await supabase
      .from('registros_asistencia')
      .select('id')
      .eq('turno_id', ingresoTurno.id)
      .eq('guardia_id', user.id)
      .maybeSingle()

    if (existente) {
      registroId = existente.id
      track('registro_bd_existente', {
        screen: 'ingreso_flow',
        turno_id: ingresoTurno.id,
        registro_id: registroId,
        value_json: { intento_id: intentoId },
      })
    } else {
      const payloadBase = {
        guardia_id: user.id,
        turno_id: ingresoTurno.id,
        hora_entrada_real: hora,
        alerta_entrada: calcAlertaEntrada(ingresoTurno.hora_inicio, hora, ingresoTurno.hora_fin),
      }

      let { data, error } = await supabase
        .from('registros_asistencia')
        .insert({
          ...payloadBase,
          distancia_ingreso_metros: auditoria.distancia,
          gps_ingreso_estado: auditoria.estado,
          latitud_ingreso: ingresoGps?.latitude,
          longitud_ingreso: ingresoGps?.longitude,
          precision_ingreso: ingresoGps?.accuracy,
        })
        .select('id')
        .single()

      let usedLegacyGps = false
      if (error && esErrorColumnaGps(error) && ingresoGps) {
        const retry = await supabase
          .from('registros_asistencia')
          .insert({ ...payloadBase, lat_entrada: ingresoGps.latitude, lng_entrada: ingresoGps.longitude })
          .select('id')
          .single()
        data  = retry.data
        error = retry.error
        usedLegacyGps = true
      }

      if (error || !data) {
        track('ingreso_error', {
          screen: 'ingreso_flow',
          turno_id: ingresoTurno.id,
          err_code: 'bd_fallo',
          err_message: error?.message ?? 'Sin datos',
          err_function: 'crear_registro_asistencia',
          duration_ms: ingresoStartTime.current ? Date.now() - ingresoStartTime.current : undefined,
          value_json: { intento_id: intentoId },
        })
        setMensaje({ texto: 'Error al crear el registro. Intentá de nuevo.', tipo: 'error' })
        setTimeout(() => setMensaje(null), 5000)
        setIngresoFase('preview')
        return
      }

      registroId = data.id

      track('registro_bd_creado', {
        screen: 'ingreso_flow',
        turno_id: ingresoTurno.id,
        registro_id: registroId,
        gps_lat: ingresoGps?.latitude,
        gps_lng: ingresoGps?.longitude,
        gps_accuracy_m: ingresoGps?.accuracy,
        gps_status: auditoria.estado,
        gps_distance_m: auditoria.distancia ?? undefined,
        value_json: { intento_id: intentoId, legacy_gps: usedLegacyGps },
      })

      if (usedLegacyGps) {
        track('gps_legacy_fallback', {
          screen: 'ingreso_flow',
          turno_id: ingresoTurno.id,
          registro_id: registroId,
          value_json: { intento_id: intentoId, tipo: 'ingreso' },
        })
      }
    }

    // ── PASO 2: Verificar sesión (token puede haber expirado durante el flujo) ─
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData?.session?.access_token
    if (!token) {
      track('ingreso_error', {
        screen: 'ingreso_flow',
        turno_id: ingresoTurno.id,
        registro_id: registroId,
        err_code: 'token_expirado',
        err_function: 'get_session',
        duration_ms: ingresoStartTime.current ? Date.now() - ingresoStartTime.current : undefined,
        value_json: { intento_id: intentoId },
      })
      setMensaje({ texto: 'Sesión expirada. Cerrá e iniciá sesión nuevamente.', tipo: 'error' })
      setTimeout(() => setMensaje(null), 6000)
      setIngresoFase('preview')
      return
    }

    // ── PASO 3: Compresión de fotos ────────────────────────────────────────────
    let libroComprimido: File
    let uniformeComprimido: File

    const compresionStart = Date.now()
    track('compresion_iniciada', {
      screen: 'ingreso_flow',
      turno_id: ingresoTurno.id,
      registro_id: registroId,
      value_json: {
        intento_id: intentoId,
        libro_original: fotoLibro.file.size,
        uniforme_original: fotoUniforme.file.size,
      },
    })

    try {
      ;[libroComprimido, uniformeComprimido] = await Promise.all([
        comprimirFoto(fotoLibro.file),
        comprimirFoto(fotoUniforme.file),
      ])
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'compresion_desconocido'
      track('compresion_error', {
        screen: 'ingreso_flow',
        turno_id: ingresoTurno.id,
        registro_id: registroId,
        err_code: errMsg,
        err_function: 'comprimirFoto',
        duration_ms: Date.now() - compresionStart,
        value_json: { intento_id: intentoId },
      })
      track('ingreso_error', {
        screen: 'ingreso_flow',
        turno_id: ingresoTurno.id,
        registro_id: registroId,
        err_code: 'compresion_fallo',
        err_message: errMsg,
        err_function: 'comprimirFoto',
        duration_ms: ingresoStartTime.current ? Date.now() - ingresoStartTime.current : undefined,
        value_json: { intento_id: intentoId },
      })
      setMensaje({ texto: 'Error al procesar las fotos. Intentá de nuevo.', tipo: 'error' })
      setTimeout(() => setMensaje(null), 5000)
      setIngresoFase('preview')
      return
    }

    track('compresion_completada', {
      screen: 'ingreso_flow',
      turno_id: ingresoTurno.id,
      registro_id: registroId,
      duration_ms: Date.now() - compresionStart,
      value_json: {
        intento_id: intentoId,
        libro_original: fotoLibro.file.size,
        libro_comprimido: libroComprimido.size,
        uniforme_original: fotoUniforme.file.size,
        uniforme_comprimido: uniformeComprimido.size,
      },
    })

    // ── PASO 4: Upload de fotos y registro de evidencias ───────────────────────
    const formData = new FormData()
    formData.append('libro',      libroComprimido,    'libro.jpg')
    formData.append('uniforme',   uniformeComprimido, 'uniforme.jpg')
    formData.append('registroId', registroId)
    formData.append('turnoId',    ingresoTurno.id)
    formData.append('objetivoId', ingresoTurno.objetivo_id)

    const uploadStart = Date.now()
    track('upload_iniciado', {
      screen: 'ingreso_flow',
      turno_id: ingresoTurno.id,
      registro_id: registroId,
      value_json: {
        intento_id: intentoId,
        libro_size: libroComprimido.size,
        uniforme_size: uniformeComprimido.size,
      },
    })

    let uploadErrorTracked = false
    let uploadRes: Response
    try {
      uploadRes = await fetch('/api/upload-evidence', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })

      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({ error: 'Error subiendo fotos' }))
        track('ingreso_error', {
          screen: 'ingreso_flow',
          turno_id: ingresoTurno.id,
          registro_id: registroId,
          err_code: 'upload_fallo',
          err_message: err.error ?? 'HTTP error',
          err_function: 'upload_evidence',
          duration_ms: ingresoStartTime.current ? Date.now() - ingresoStartTime.current : undefined,
          value_json: { intento_id: intentoId, http_status: uploadRes.status, upload_ms: Date.now() - uploadStart },
        })
        uploadErrorTracked = true
        setMensaje({ texto: err.error || 'Error subiendo fotos. Intentá de nuevo.', tipo: 'error' })
        setTimeout(() => setMensaje(null), 5000)
        setIngresoFase('preview')
        return
      }
    } catch (err) {
      if (!uploadErrorTracked) {
        track('ingreso_error', {
          screen: 'ingreso_flow',
          turno_id: ingresoTurno.id,
          registro_id: registroId,
          err_code: 'red_fallo',
          err_message: err instanceof Error ? err.message : 'fetch error',
          err_function: 'upload_evidence',
          duration_ms: ingresoStartTime.current ? Date.now() - ingresoStartTime.current : undefined,
          value_json: { intento_id: intentoId, upload_ms: Date.now() - uploadStart },
        })
      }
      setMensaje({ texto: 'Error de red al subir fotos. Intentá de nuevo.', tipo: 'error' })
      setTimeout(() => setMensaje(null), 5000)
      setIngresoFase('preview')
      return
    }

    track('upload_completado', {
      screen: 'ingreso_flow',
      turno_id: ingresoTurno.id,
      registro_id: registroId,
      duration_ms: Date.now() - uploadStart,
      value_json: {
        intento_id: intentoId,
        libro_size: libroComprimido.size,
        uniforme_size: uniformeComprimido.size,
      },
    })

    // ── PASO 5: Actualizar estado del turno ────────────────────────────────────
    // No bloqueante: si falla, el ingreso ya está registrado igual.
    const { error: turnoError } = await supabase
      .from('turnos')
      .update({ estado: 'cubierto' })
      .eq('id', ingresoTurno.id)

    if (turnoError) {
      track('turno_actualizacion_error', {
        screen: 'ingreso_flow',
        turno_id: ingresoTurno.id,
        registro_id: registroId,
        err_message: turnoError.message,
        err_function: 'update_turno_cubierto',
        value_json: { intento_id: intentoId },
      })
    } else {
      track('turno_actualizado', {
        screen: 'ingreso_flow',
        turno_id: ingresoTurno.id,
        registro_id: registroId,
        value_json: { intento_id: intentoId },
      })
    }

    // ── PASO 6: Refrescar state local ─────────────────────────────────────────
    const { data: registroCompleto } = await supabase
      .from('registros_asistencia')
      .select('*')
      .eq('id', registroId)
      .single()

    if (registroCompleto) {
      setRegistros(prev => [...prev.filter(r => r.turno_id !== ingresoTurno!.id), registroCompleto])
    }
    setTurnos(prev => prev.map(t => t.id === ingresoTurno!.id ? { ...t, estado: 'cubierto' } : t))

    // El panel de rondas resuelve el turno vigente en el servidor y por su cuenta
    // sólo se enteraría en su próximo refresco. Se le pide una recarga acá, con el
    // ingreso ya confirmado, para que las rondas aparezcan sin esperar un minuto.
    setRondasRecarga(n => n + 1)

    track('ingreso_confirmed', {
      screen: 'ingreso_flow',
      turno_id: ingresoTurno.id,
      registro_id: registroId,
      duration_ms: ingresoStartTime.current ? Date.now() - ingresoStartTime.current : undefined,
      gps_lat: ingresoGps?.latitude,
      gps_lng: ingresoGps?.longitude,
      gps_accuracy_m: ingresoGps?.accuracy,
      gps_status: auditoria.estado,
      gps_distance_m: auditoria.distancia ?? undefined,
      result: 'exito',
      value_json: { intento_id: intentoId },
    })

    setMensaje({
      texto: `✓ Entrada registrada a las ${hora} · ${mensajeAuditoriaRadio(auditoria, ingresoGps)}`,
      tipo: auditoria.estado === 'fuera_radio' ? 'warn' : 'ok',
    })
    setTimeout(() => setMensaje(null), 5000)
    resetIngresoFlow()
  }

  // Marcar salida — instrumentado con el mismo nivel que el ingreso
  const marcarSalida = async (turno: Turno, registro: Registro) => {
    setFichando(turno.id)
    setMensaje(null)

    const egresoIntentoId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const egresoStart     = Date.now()

    track('egreso_started', {
      screen: 'egreso_flow',
      turno_id: turno.id,
      registro_id: registro.id,
      value_json: { intento_id: egresoIntentoId },
    })

    // GPS del egreso
    track('gps_requested', {
      screen: 'egreso_flow',
      turno_id: turno.id,
      value_json: { intento_id: egresoIntentoId, tipo: 'egreso' },
    })

    const hora      = horaActual()
    const horas     = calcHorasTrabajadas(registro.hora_entrada_real, hora)
    const gpsResult = await adquirirGps()

    let gps: GpsData | null = null

    if (gpsResult.ok) {
      gps = gpsResult.data
      track('gps_success', {
        screen: 'egreso_flow',
        turno_id: turno.id,
        gps_lat: gps.latitude,
        gps_lng: gps.longitude,
        gps_accuracy_m: gps.accuracy,
        gps_acq_ms: gpsResult.acq_ms,
        value_json: { intento_id: egresoIntentoId, tipo: 'egreso' },
      })
      if (gps.accuracy > 150) {
        track('gps_imprecise', {
          screen: 'egreso_flow',
          turno_id: turno.id,
          gps_accuracy_m: gps.accuracy,
          value_json: { intento_id: egresoIntentoId, tipo: 'egreso', umbral_m: 150 },
        })
      }
    } else {
      const eventName = gpsResult.reason === 'denied' || gpsResult.reason === 'unsupported'
        ? 'gps_denied' : gpsResult.reason === 'timeout' ? 'gps_timeout' : 'gps_unavailable'
      track(eventName, {
        screen: 'egreso_flow',
        turno_id: turno.id,
        duration_ms: gpsResult.acq_ms,
        err_code: gpsResult.reason,
        err_function: 'adquirirGps',
        value_json: { intento_id: egresoIntentoId, tipo: 'egreso' },
      })
      // El egreso continúa sin GPS — se registra con gps_egreso_estado: 'gps_no_disponible'
    }

    const objetivo      = getObjetivo(turno.objetivo_id)
    const auditoriaEgreso = calcularAuditoriaRadioGps(gps, objetivo)

    const payloadBase = { hora_salida_real: hora, horas_trabajadas: horas }
    const payload     = {
      ...payloadBase,
      distancia_egreso_metros: auditoriaEgreso.distancia,
      gps_egreso_estado: auditoriaEgreso.estado,
    }
    const payloadConGps = gps
      ? { ...payload, latitud_egreso: gps.latitude, longitud_egreso: gps.longitude, precision_egreso: gps.accuracy }
      : payload
    const payloadConGpsLegacy = gps
      ? { ...payloadBase, lat_salida: gps.latitude, lng_salida: gps.longitude }
      : payloadBase

    let { error: egresoError } = await supabase
      .from('registros_asistencia')
      .update(payloadConGps)
      .eq('id', registro.id)

    let usedLegacyGps = false
    if (egresoError && esErrorColumnaGps(egresoError)) {
      const retry = await supabase
        .from('registros_asistencia')
        .update(payloadConGpsLegacy)
        .eq('id', registro.id)
      egresoError  = retry.error
      usedLegacyGps = true
    }

    if (egresoError) {
      track('egreso_error', {
        screen: 'egreso_flow',
        turno_id: turno.id,
        registro_id: registro.id,
        err_code: 'bd_fallo',
        err_message: egresoError.message,
        err_function: 'update_registros_asistencia_egreso',
        duration_ms: Date.now() - egresoStart,
        value_json: { intento_id: egresoIntentoId },
      })
      setMensaje({ texto: 'Error al registrar salida. Intentá de nuevo.', tipo: 'error' })
    } else {
      if (usedLegacyGps) {
        track('gps_legacy_fallback', {
          screen: 'egreso_flow',
          turno_id: turno.id,
          registro_id: registro.id,
          value_json: { intento_id: egresoIntentoId, tipo: 'egreso' },
        })
      }
      track('egreso_confirmed', {
        screen: 'egreso_flow',
        turno_id: turno.id,
        registro_id: registro.id,
        duration_ms: Date.now() - egresoStart,
        gps_lat: gps?.latitude,
        gps_lng: gps?.longitude,
        gps_accuracy_m: gps?.accuracy,
        gps_status: auditoriaEgreso.estado,
        gps_distance_m: auditoriaEgreso.distancia ?? undefined,
        result: 'exito',
        value_json: { intento_id: egresoIntentoId },
      })
      setRegistros(prev =>
        prev.map(r => r.id === registro.id
          ? { ...r, ...payloadConGps, hora_salida_real: hora, horas_trabajadas: horas }
          : r
        )
      )
      setMensaje({
        texto: gps
          ? `✓ Salida registrada a las ${hora} — ${horas}h trabajadas · ${mensajeAuditoriaRadio(auditoriaEgreso, gps)}`
          : mensajeAuditoriaRadio(auditoriaEgreso, gps),
        tipo: auditoriaEgreso.estado === 'fuera_radio' || !gps ? 'warn' : 'ok',
      })
      // Resumen post-egreso (continuidad): aparece apenas se registra la
      // salida. Si el vigilador cierra la app sin responder, el mismo turno
      // queda disponible después en Mi Planilla.
      setResumenTurnoId(turno.id)
    }

    setFichando(null)
    setTimeout(() => setMensaje(null), 4000)
  }

  const puedeAnularEgreso = (reg: Registro): boolean => {
    if (!reg.hora_salida_real) return false
    const [h, m, s] = reg.hora_salida_real.split(':').map(Number)
    const now = new Date()
    const egreso = new Date()
    egreso.setHours(h, m, s, 0)
    const diffMs = now.getTime() - egreso.getTime()
    return diffMs >= 0 && diffMs <= 30 * 60 * 1000
  }

  const anularEgreso = async (turno: Turno, registro: Registro) => {
    setFichando(turno.id)
    setMensaje(null)
    const { error } = await supabase
      .from('registros_asistencia')
      .update({
        hora_salida_real: null,
        hora_salida_final: null,
        horas_trabajadas: null,
        alerta_salida: null,
        latitud_egreso: null,
        longitud_egreso: null,
        precision_egreso: null,
        distancia_egreso_metros: null,
        gps_egreso_estado: null,
      })
      .eq('id', registro.id)
    if (error) {
      setMensaje({ texto: 'Error al anular el egreso.', tipo: 'error' })
    } else {
      track('egreso_anulado', {
        screen: 'egreso_flow',
        turno_id: turno.id,
        registro_id: registro.id,
        value_json: { hora_salida_anulada: registro.hora_salida_real },
      })
      setRegistros(prev =>
        prev.map(r => r.id === registro.id
          ? { ...r, hora_salida_real: undefined, hora_salida_final: undefined, horas_trabajadas: undefined, alerta_salida: undefined, gps_egreso_estado: undefined }
          : r
        )
      )
      setMensaje({ texto: 'Egreso anulado. Podés registrar la salida cuando corresponda.', tipo: 'ok' })
    }
    setFichando(null)
    setTimeout(() => setMensaje(null), 5000)
  }

  const getObjetivo = (id: string) => objetivos.find(o => o.id === id)
  const getPuesto = (id?: string | null) => id ? puestos.find(p => p.id === id) : undefined

  // ── RENDER ────────────────────────────────────────────────
  return (
    <div style={S.container}>

      {/* Overlay flujo de ingreso con evidencias */}
      {ingresoFase !== 'idle' && (
        <div style={S.overlay}>
          <div style={S.overlayCard}>

            {mensaje && (
              <div style={{ ...S.alert(mensaje.tipo), marginBottom: 16 }}>{mensaje.texto}</div>
            )}

            {ingresoRestaurado && ingresoFase === 'foto_libro' && (
              <div style={{ ...S.alert('warn'), marginBottom: 12, fontSize: 13 }}>
                Tu ingreso quedó pendiente. Sacá las fotos nuevamente para confirmar.
              </div>
            )}

            {ingresoFase === 'gps' && (
              <>
                <div style={S.overlayTitle}>Obteniendo ubicación...</div>
                <div style={{ color: '#64748b', fontSize: 14 }}>Por favor aguardá un momento.</div>
              </>
            )}

            {(ingresoFase === 'foto_libro' || ingresoFase === 'foto_uniforme') && (
              <>
                <div style={S.overlayStep}>
                  {ingresoFase === 'foto_libro' ? 'Paso 1 de 2' : 'Paso 2 de 2'}
                </div>
                <div style={S.overlayTitle}>
                  {ingresoFase === 'foto_libro' ? 'Libro de guardia' : 'Uniforme'}
                </div>
                <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 24 }}>
                  {ingresoFase === 'foto_libro'
                    ? 'Tomá una foto del libro de guardia abierto en la página de hoy.'
                    : 'Tomá una foto de tu uniforme completo.'}
                </div>
                <button
                  style={{ ...S.btn, ...S.btnPresente, marginBottom: 10 }}
                  onClick={() => {
                    if (ingresoFase === 'foto_libro') {
                      track('camara_libro_abierta', { screen: 'ingreso_flow', turno_id: ingresoTurno?.id, value_json: { intento_id: ingresoIntentoId.current } })
                      inputLibroRef.current?.click()
                    } else {
                      track('camara_uniforme_abierta', { screen: 'ingreso_flow', turno_id: ingresoTurno?.id, value_json: { intento_id: ingresoIntentoId.current } })
                      inputUniformeRef.current?.click()
                    }
                  }}
                >
                  📷 Tomar foto
                </button>
                <button
                  style={{ ...S.btn, background: 'none', border: '1px solid #1e2d42', color: '#94a3b8' }}
                  onClick={cancelarIngreso}
                >
                  Cancelar
                </button>
              </>
            )}

            {ingresoFase === 'preview' && fotoLibro && fotoUniforme && (
              <>
                <div style={S.overlayTitle}>Revisá las fotos</div>
                <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...S.colLabel, marginBottom: 6 }}>Libro de guardia</div>
                    <img
                      src={fotoLibro.url}
                      alt="Libro"
                      style={{ width: '100%', borderRadius: 8, objectFit: 'cover', aspectRatio: '1' }}
                    />
                    <button
                      style={{ ...S.btn, background: 'none', border: '1px solid #1e2d42', color: '#94a3b8', marginTop: 6, padding: '8px', fontSize: 12 }}
                      onClick={() => {
                        track('photo_retaken', { screen: 'ingreso_flow', turno_id: ingresoTurno?.id, value_json: { intento_id: ingresoIntentoId.current, tipo: 'libro' } })
                        URL.revokeObjectURL(fotoLibro.url)
                        setFotoLibro(null)
                        setIngresoFase('foto_libro')
                      }}
                    >
                      Retomar
                    </button>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ ...S.colLabel, marginBottom: 6 }}>Uniforme</div>
                    <img
                      src={fotoUniforme.url}
                      alt="Uniforme"
                      style={{ width: '100%', borderRadius: 8, objectFit: 'cover', aspectRatio: '1' }}
                    />
                    <button
                      style={{ ...S.btn, background: 'none', border: '1px solid #1e2d42', color: '#94a3b8', marginTop: 6, padding: '8px', fontSize: 12 }}
                      onClick={() => {
                        track('photo_retaken', { screen: 'ingreso_flow', turno_id: ingresoTurno?.id, value_json: { intento_id: ingresoIntentoId.current, tipo: 'uniforme' } })
                        URL.revokeObjectURL(fotoUniforme.url)
                        setFotoUniforme(null)
                        setIngresoFase('foto_uniforme')
                      }}
                    >
                      Retomar
                    </button>
                  </div>
                </div>
                <button
                  style={{ ...S.btn, ...S.btnPresente, marginBottom: 10 }}
                  onClick={confirmarIngreso}
                >
                  ✓ Confirmar ingreso
                </button>
                <button
                  style={{ ...S.btn, background: 'none', border: '1px solid #1e2d42', color: '#94a3b8' }}
                  onClick={cancelarIngreso}
                >
                  Cancelar
                </button>
              </>
            )}

            {ingresoFase === 'confirmando' && (
              <>
                <div style={S.overlayTitle}>Confirmando ingreso...</div>
                <div style={{ color: '#64748b', fontSize: 14, marginBottom: 20 }}>Subiendo fotos y registrando asistencia.</div>
                <button
                  style={{ ...S.btn, background: 'none', border: '1px solid #1e2d42', color: '#64748b', fontSize: 13 }}
                  onClick={cancelarIngreso}
                >
                  Cancelar
                </button>
              </>
            )}

          </div>

          {/* File inputs ocultos para captura de cámara */}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            ref={inputLibroRef}
            onChange={e => {
              const file = e.target.files?.[0]
              if (!file) return
              track('photo_taken', {
                screen: 'ingreso_flow',
                turno_id: ingresoTurno?.id,
                value_num: file.size,
                value_json: { intento_id: ingresoIntentoId.current, tipo: 'libro', mime: file.type || 'image/jpeg' },
              })
              if (fotoLibro) URL.revokeObjectURL(fotoLibro.url)
              setFotoLibro({ file, url: URL.createObjectURL(file) })
              setIngresoFase('foto_uniforme')
              e.target.value = ''
            }}
          />
          <input
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            ref={inputUniformeRef}
            onChange={e => {
              const file = e.target.files?.[0]
              if (!file) return
              track('photo_taken', {
                screen: 'ingreso_flow',
                turno_id: ingresoTurno?.id,
                value_num: file.size,
                value_json: { intento_id: ingresoIntentoId.current, tipo: 'uniforme', mime: file.type || 'image/jpeg' },
              })
              if (fotoUniforme) URL.revokeObjectURL(fotoUniforme.url)
              setFotoUniforme({ file, url: URL.createObjectURL(file) })
              setIngresoFase('preview')
              e.target.value = ''
            }}
          />
        </div>
      )}

      {/* Header */}
      <div style={S.header}>
        <div>
          <div style={S.brand}>🛡️ MERCOSUR</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>Control Operativo</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{user.nombre} {user.apellido}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>Guardia · {user.legajo}</div>
          <button
            type="button"
            onClick={() => setPerfilAbierto(!perfilAbierto)}
            style={{ marginTop: 8, background: 'transparent', border: '1px solid #1e2d42', color: '#94a3b8', borderRadius: 8, padding: '5px 10px', fontSize: 12 }}
          >
            Perfil
          </button>
        </div>
      </div>

      <div style={S.body}>

        {/* Fecha */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 800, marginBottom: 2 }}>
              Mis Turnos
            </div>
            <div style={{ fontSize: 13, color: '#64748b' }}>
              {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
              {ultimaActualizacion
                ? `Actualizado ${ultimaActualizacion.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}`
                : 'Sin actualizar'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => { void recargarDatos() }}
            disabled={refrescando}
            style={{
              background: 'transparent',
              border: '1px solid #1e2d42',
              color: '#94a3b8',
              borderRadius: 8,
              padding: '6px 12px',
              fontSize: 12,
              cursor: refrescando ? 'not-allowed' : 'pointer',
              opacity: refrescando ? 0.6 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            {refrescando ? 'Actualizando...' : '↻ Actualizar'}
          </button>
        </div>

        <button
          type="button"
          onClick={activarPush}
          disabled={activandoPush}
          style={{ ...S.btn, ...S.btnSalida, marginBottom: 10, opacity: activandoPush ? 0.65 : 1 }}
        >
          {activandoPush ? 'Activando...' : 'Activar notificaciones'}
        </button>

        {/* Sólo aparece si hay algo que hacer: un cartel permanente en cero se
            vuelve parte del fondo y deja de leerse. */}
        {pendientesPlanilla > 0 && (
          <button
            type="button"
            onClick={() => router.push(`/guardias/${user.id}?seccion=planilla`)}
            style={{
              ...S.btn,
              background: 'rgba(245,158,11,.12)',
              border: '1px solid rgba(245,158,11,.45)',
              color: '#fbbf24',
              marginBottom: 10,
              fontSize: 14,
              lineHeight: 1.35,
            }}
          >
            Tenés {pendientesPlanilla} turno{pendientesPlanilla === 1 ? '' : 's'} sin revisar en tu planilla
            <div style={{ fontSize: 12, color: '#d97706', marginTop: 2 }}>Tocá para revisarlos</div>
          </button>
        )}

        <button
          type="button"
          onClick={() => router.push(`/guardias/${user.id}`)}
          style={{ ...S.btn, background: 'none', border: '1px solid #334155', color: '#94a3b8', marginBottom: 14, fontSize: 14 }}
        >
          Mi Legajo
        </button>

        {perfilAbierto && (
          <div style={S.card}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
              {user.foto_url && <img src={user.foto_url} alt="" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover' }} />}
              <div>
                <div style={S.objetivo}>{user.nombre} {user.apellido}</div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>{user.rol} · Legajo {user.legajo || '—'}</div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>{user.email || 'Sin email cargado'}</div>
              </div>
            </div>

            <div style={S.alert('warn')}>
              Por seguridad, cambie su contraseña inicial si todavía usa su DNI.
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={S.colLabel}>Nueva contraseña</div>
              <input type="password" style={S.input} value={nuevaPassword} onChange={e => setNuevaPassword(e.target.value)} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={S.colLabel}>Confirmar contraseña</div>
              <input type="password" style={S.input} value={confirmarPassword} onChange={e => setConfirmarPassword(e.target.value)} />
            </div>
            {perfilMensaje && <div style={S.alert(perfilMensaje.tipo)}>{perfilMensaje.texto}</div>}
            <button
              style={{ ...S.btn, ...S.btnSalida, opacity: guardandoPassword ? 0.6 : 1 }}
              onClick={cambiarPassword}
              disabled={guardandoPassword}
            >
              {guardandoPassword ? 'Guardando...' : 'Cambiar contraseña'}
            </button>
          </div>
        )}

        {/* Mensaje (solo fuera del overlay) */}
        {mensaje && ingresoFase === 'idle' && (
          <div style={S.alert(mensaje.tipo)}>{mensaje.texto}</div>
        )}

        {permisoGps === 'checking' && (
          <div style={S.alert('warn')}>Verificando permiso de ubicación...</div>
        )}

        {permisoGps === 'prompt' && (
          <div style={S.alert('warn')}>Para fichar, permití la ubicación cuando el teléfono lo solicite.</div>
        )}

        {(permisoGps === 'denied' || permisoGps === 'unsupported') && (
          <div style={S.alert('error')}>Para registrar asistencia debe permitir ubicación</div>
        )}

        {/* Error de carga: conserva los datos anteriores y ofrece reintentar */}
        {errorCarga && (
          <div style={S.alert('error')}>
            <div style={{ marginBottom: 10 }}>{errorCarga}</div>
            <button
              type="button"
              onClick={() => { void recargarDatos() }}
              disabled={refrescando}
              style={{
                background: 'transparent',
                border: '1px solid rgba(239,68,68,.4)',
                color: '#ef4444',
                borderRadius: 8,
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 600,
                cursor: refrescando ? 'not-allowed' : 'pointer',
                opacity: refrescando ? 0.6 : 1,
              }}
            >
              {refrescando ? 'Reintentando...' : 'Reintentar'}
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={S.empty}>
            <div style={{ color: '#64748b' }}>Cargando turnos...</div>
          </div>
        )}

        {/* Sin turnos — nunca se muestra si la última carga falló */}
        {!loading && !errorCarga && turnos.length === 0 && (
          <div style={S.card}>
            <div style={S.empty}>
              <div style={S.sinTurnos}>📅</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Sin turnos asignados hoy</div>
              <div style={{ fontSize: 13 }}>Consultá con tu supervisor si creés que hay un error.</div>
            </div>
          </div>
        )}

        {/* Turnos del día */}
        {!loading && turnos.map(turno => {
          const obj     = getObjetivo(turno.objetivo_id)
          const reg     = registroDelTurno(turno.id)
          const estadoTarjeta = estadoTarjetaTurno(turno, reg, ahora)
          const cargando = fichando === turno.id
          const bloqueoFichaje = mensajeBloqueoFichaje(turno, user.id, ahora, obj)
          const puedeDarPresente = !bloqueoFichaje
          const gpsBloqueaPresente = permisoGps === 'checking' || permisoGps === 'denied' || permisoGps === 'unsupported'
          const gpsIngreso = auditoriaGps(reg, 'ingreso', obj)
          const gpsEgreso = auditoriaGps(reg, 'egreso', obj)

          return (
            <div key={turno.id} style={S.card}>

              {/* Objetivo */}
              <div style={S.label}>Objetivo</div>
              <div style={S.objetivo}>{obj?.nombre || '—'}</div>
              {obj?.direccion && (
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>{obj.direccion}</div>
              )}
              {reg && (
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
                  Fecha del turno: <strong style={{ color: '#e2e8f0' }}>{fechaDDMMYYYY(turno.fecha)}</strong>
                </div>
              )}

              {/* Horario */}
              <div style={S.row}>
                <div style={S.col}>
                  <div style={S.colLabel}>Entrada</div>
                  <div style={S.colValue}>{turno.hora_inicio}</div>
                </div>
                <div style={S.col}>
                  <div style={S.colLabel}>Salida</div>
                  <div style={S.colValue}>{turno.hora_fin}</div>
                </div>
              </div>

              {/* Estado del fichaje */}
              {reg && (
                <div style={{ marginBottom: 14 }}>
                  <div style={S.row}>
                    <div style={S.col}>
                      <div style={S.colLabel}>Entrada real</div>
                      <div style={{ ...S.colValue, color: '#10b981' }}>{reg.hora_entrada_real}</div>
                    </div>
                    {reg.hora_salida_real && (
                      <div style={S.col}>
                        <div style={S.colLabel}>Salida real</div>
                        <div style={{ ...S.colValue, color: '#10b981' }}>{reg.hora_salida_real}</div>
                      </div>
                    )}
                  </div>
                  {reg.horas_trabajadas && reg.horas_trabajadas > 0 && (
                    <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                      Total: <strong style={{ color: '#f59e0b' }}>{reg.horas_trabajadas}h trabajadas</strong>
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8, lineHeight: 1.5 }}>
                    <div>GPS ingreso: <strong style={{ color: gpsIngreso.includes('Sin GPS') ? '#f59e0b' : '#10b981' }}>{gpsIngreso}</strong></div>
                    {reg.hora_salida_real && (
                      <div>GPS egreso: <strong style={{ color: gpsEgreso.includes('Sin GPS') ? '#f59e0b' : '#10b981' }}>{gpsEgreso}</strong></div>
                    )}
                  </div>
                </div>
              )}

              {/* Badge estado */}
              <div style={{ marginBottom: 14 }}>
                <span style={S.badge(estadoTarjeta)}>
                  {estadoTarjeta === 'completado' ? '✓ Turno completado'
                    : estadoTarjeta === 'salida_pendiente' ? '⏳ Turno finalizado · Salida pendiente'
                    : estadoTarjeta === 'ingreso_anticipado' ? `✓ Ingreso registrado · Comienza a las ${turno.hora_inicio.slice(0, 5)}`
                    : estadoTarjeta === 'en_turno' ? '● En turno'
                    : estadoTarjeta === 'cubierto' ? '✓ Cubierto'
                    : '○ Pendiente'}
                </span>
              </div>

              {/* Botón acción */}
              {!reg && (
                <>
                  {!puedeDarPresente && (
                    <div style={S.alert('error')}>
                      {bloqueoFichaje}
                    </div>
                  )}
                  <button
                    style={{ ...S.btn, ...(puedeDarPresente && !gpsBloqueaPresente ? S.btnPresente : S.btnDisabled), opacity: ingresoFase !== 'idle' ? 0.6 : 1 }}
                    onClick={() => iniciarIngreso(turno)}
                    disabled={ingresoFase !== 'idle' || !puedeDarPresente || gpsBloqueaPresente}>
                    {ingresoFase !== 'idle' && ingresoTurno?.id === turno.id ? 'Procesando...' : '✅ Dar presente'}
                  </button>
                </>
              )}

              {reg && !reg.hora_salida_real && (
                <button
                  style={{ ...S.btn, ...S.btnSalida, opacity: cargando ? 0.6 : 1 }}
                  onClick={() => marcarSalida(turno, reg)}
                  disabled={cargando}>
                  {cargando ? 'Registrando...' : '🏁 Marcar salida'}
                </button>
              )}

              {reg?.hora_salida_real && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button style={{ ...S.btn, ...S.btnDisabled }} disabled>
                    ✓ Turno finalizado
                  </button>
                  {puedeAnularEgreso(reg) && (
                    <button
                      style={{ ...S.btn, background: '#dc2626', color: '#fff', opacity: fichando === turno.id ? 0.6 : 1 }}
                      onClick={() => anularEgreso(turno, reg)}
                      disabled={fichando === turno.id}
                    >
                      Anular egreso
                    </button>
                  )}
                </div>
              )}

            </div>
          )
        })}

        {/* Rondas del puesto (Etapa 2 — solo lectura). Se resuelve por turno
            vigente desde el servidor; no se asigna manualmente. */}
        {!loading && (
          <RondasGuardiaPanel objetivos={objetivos} ahora={ahora} recargaSolicitada={rondasRecarga} />
        )}

        {/* Cerrar sesión */}
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <button
            onClick={async () => { await supabase.auth.signOut(); window.location.reload() }}
            style={{ background: 'none', border: '1px solid #1e2d42', color: '#64748b', padding: '8px 20px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            Cerrar sesión
          </button>
        </div>

      </div>

      {/* Resumen post-egreso (continuidad): aparece solo apenas se registra
          la salida. Reutiliza aceptar_turno_planilla / solicitar_modificacion_planilla. */}
      {resumenTurnoId && (() => {
        const turnoResumen = turnos.find(t => t.id === resumenTurnoId)
        const registroResumen = registros.find(r => r.turno_id === resumenTurnoId)
        if (!turnoResumen || !registroResumen) return null
        const objetivoResumen = getObjetivo(turnoResumen.objetivo_id)
        const puestoResumen = getPuesto(turnoResumen.puesto_id)
        return (
          <ResumenJornadaModal
            turnoId={turnoResumen.id}
            empleadoId={user.id}
            objetivoNombre={objetivoResumen?.nombre ?? null}
            puestoNombre={puestoResumen?.nombre ?? null}
            horaInicioProgramada={turnoResumen.hora_inicio?.slice(0, 5) ?? null}
            horaFinProgramada={turnoResumen.hora_fin?.slice(0, 5) ?? null}
            horaEntradaRegistrada={registroResumen.hora_entrada_real?.slice(0, 5) ?? null}
            horaSalidaRegistrada={registroResumen.hora_salida_real?.slice(0, 5) ?? null}
            horasTrabajadas={registroResumen.horas_trabajadas ?? null}
            salidaAutomatica={false}
            gpsIngresoEstado={registroResumen.gps_ingreso_estado ?? null}
            gpsEgresoEstado={registroResumen.gps_egreso_estado ?? null}
            estado="trabajado"
            estadoControlInicial="pendiente"
            permiteAceptar
            esTitular
            // Si acepta acá mismo, el contador tiene que bajar sin esperar al
            // próximo refresco: si no, el cartel lo sigue mandando a Mi Planilla
            // por un turno que acaba de confirmar.
            onCambio={() => { void cargarPendientesPlanilla() }}
            onClose={() => { setResumenTurnoId(null); void cargarPendientesPlanilla() }}
          />
        )
      })()}
    </div>
  )
}
