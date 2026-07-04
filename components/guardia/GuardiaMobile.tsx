'use client'
import { useState, useEffect } from 'react'
import { calcAlertaEntrada, calcDistancia, supabase } from '@/lib/supabase'
import { activarNotificacionesPush } from '@/lib/push-client'

// ── TIPOS ─────────────────────────────────────────────────────
interface Turno {
  id: string
  guardia_id?: string | null
  guardia_original_id?: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  objetivo_id: string
  estado: string
}

interface Objetivo {
  id: string
  nombre: string
  direccion?: string
  lat?: number
  lng?: number
  radio_metros?: number
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

function mensajeBloqueoFichaje(turno: Turno, guardiaId: string, ahora: Date): string | null {
  if (turnoFueReasignado(turno, guardiaId)) {
    return 'Su turno fue reasignado por supervisión.'
  }

  const inicioTurno = fechaHoraTurno(turno.fecha, turno.hora_inicio)
  const finTurno = fechaFinTurno(turno)
  if (!inicioTurno || !finTurno) return 'No se pudo validar el horario del turno.'

  const desde = new Date(inicioTurno.getTime() - 30 * 60 * 1000)
  if (ahora < desde) return 'Fuera de horario de fichaje. Contacte al supervisor.'
  if (ahora > finTurno) return 'El turno ya finalizó. Contacte al supervisor.'

  return null
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

function obtenerGps(tipo: 'ingreso' | 'egreso'): Promise<GpsData | null> {
  if (tipo === 'ingreso') console.log('Solicitando GPS ingreso')

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    if (tipo === 'ingreso') console.log('GPS ingreso error')
    return Promise.resolve(null)
  }

  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      position => {
        if (tipo === 'ingreso') console.log('GPS ingreso OK')
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        })
      },
      () => {
        if (tipo === 'ingreso') console.log('GPS ingreso error')
        resolve(null)
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
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
}

// ── COMPONENTE PRINCIPAL ──────────────────────────────────────
export default function GuardiaMobile({ user }: { user: any }) {
  const [turnos, setTurnos]       = useState<Turno[]>([])
  const [objetivos, setObjetivos] = useState<Objetivo[]>([])
  const [registros, setRegistros] = useState<Registro[]>([])
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

  // Cargar datos
  useEffect(() => {
    const cargar = async () => {
      setLoading(true)

const [{ data: t }, { data: o }, { data: r }] = await Promise.all([

  supabase
    .from('turnos')
    .select('*')
    .or(`guardia_id.eq.${user.id},guardia_original_id.eq.${user.id}`)
    .in('fecha', [ayer, hoy])
    .order('hora_inicio'),

  supabase
    .from('objetivos')
    .select('id, nombre, direccion, lat, lng, radio_metros'),

  supabase
    .from('registros_asistencia')
    .select('*')
    .eq('guardia_id', user.id),

])

      if (t) {
        // Sólo mostrar turnos de ayer si son nocturnos (cruzan medianoche)
        const filtrados = t.filter((turno: Turno) => {
          if (turno.fecha !== ayer) return true
          const [hI, mI] = turno.hora_inicio.split(':').map(Number)
          const [hF, mF] = turno.hora_fin.split(':').map(Number)
          return (hF * 60 + mF) <= (hI * 60 + mI)
        })
        setTurnos(filtrados)
      }
      if (o) setObjetivos(o)
      if (r) setRegistros(r)
      setLoading(false)
    }
    cargar()
  }, [user.id, hoy])

  useEffect(() => {
    const timer = window.setInterval(() => setAhora(new Date()), 30000)
    return () => window.clearInterval(timer)
  }, [])

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

  // Dar presente
  const darPresente = async (turno: Turno) => {
    const bloqueo = mensajeBloqueoFichaje(turno, user.id, new Date())
    if (bloqueo) {
      setMensaje({ texto: bloqueo, tipo: 'error' })
      setTimeout(() => setMensaje(null), 4000)
      return
    }

    if (permisoGps === 'denied' || permisoGps === 'unsupported') {
      setMensaje({ texto: 'Para registrar asistencia debe permitir ubicación', tipo: 'error' })
      setTimeout(() => setMensaje(null), 4000)
      return
    }

    setFichando(turno.id)
    setMensaje(null)

    try {
      const hora = horaActual()
      const gps = await obtenerGps('ingreso')

      if (!gps) {
        setPermisoGps(await consultarPermisoGps())
        setMensaje({ texto: 'Para registrar asistencia debe permitir ubicación', tipo: 'error' })
        setTimeout(() => setMensaje(null), 4000)
        return
      }

      const objetivo = getObjetivo(turno.objetivo_id)
      const auditoriaIngreso = calcularAuditoriaRadioGps(gps, objetivo)
      const payloadBase = {
        guardia_id: user.id,
        turno_id: turno.id,
        hora_entrada_real: hora,
        alerta_entrada: calcAlertaEntrada(turno.hora_inicio, hora, turno.hora_fin),
      }
      const payload = {
        ...payloadBase,
        distancia_ingreso_metros: auditoriaIngreso.distancia,
        gps_ingreso_estado: auditoriaIngreso.estado,
      }
      const payloadConGps = {
          ...payload,
          latitud_ingreso: gps.latitude,
          longitud_ingreso: gps.longitude,
          precision_ingreso: gps.accuracy,
        }
      const payloadConGpsLegacy = {
        ...payloadBase,
        lat_entrada: gps.latitude,
        lng_entrada: gps.longitude,
      }

      let { data, error } = await supabase
        .from('registros_asistencia')
        .insert(payloadConGps)
        .select()
        .single()

      if (error && esErrorColumnaGps(error)) {
        const retry = await supabase
          .from('registros_asistencia')
          .insert(payloadConGpsLegacy)
          .select()
          .single()

        data = retry.data
        error = retry.error
      }

      if (error || !data) {
        throw error || new Error('No se recibió el registro creado.')
      }

      setRegistros(prev => [...prev, data])
      await supabase.from('turnos').update({ estado: 'cubierto' }).eq('id', turno.id)
      setTurnos(prev => prev.map(t => t.id === turno.id ? { ...t, estado: 'cubierto' } : t))
      setMensaje({
        texto: `✓ Entrada registrada a las ${hora} · ${mensajeAuditoriaRadio(auditoriaIngreso, gps)}`,
        tipo: auditoriaIngreso.estado === 'fuera_radio' ? 'warn' : 'ok',
      })
      setTimeout(() => setMensaje(null), 4000)
    } catch (error) {
      console.error(error)

      const mensajeError =
        error instanceof Error
          ? error.message
          : typeof error === 'object' && error && 'message' in error
            ? String((error as { message: unknown }).message)
            : String(error)

      setMensaje({
        texto: mensajeError,
        tipo: 'error'
      })

      setTimeout(() => setMensaje(null), 4000)
    } finally {
      setFichando(null)
    }
  }

  // Marcar salida
  const marcarSalida = async (turno: Turno, registro: Registro) => {
    setFichando(turno.id)
    setMensaje(null)

    const hora = horaActual()
    const horas = calcHorasTrabajadas(registro.hora_entrada_real, hora)
    const gps = await obtenerGps('egreso')
    const objetivo = getObjetivo(turno.objetivo_id)
    const auditoriaEgreso = calcularAuditoriaRadioGps(gps, objetivo)
    const payloadBase = {
      hora_salida_real: hora,
      horas_trabajadas: horas,
    }
    const payload = {
      ...payloadBase,
      distancia_egreso_metros: auditoriaEgreso.distancia,
      gps_egreso_estado: auditoriaEgreso.estado,
    }
    const payloadConGps = gps
      ? {
        ...payload,
        latitud_egreso: gps.latitude,
        longitud_egreso: gps.longitude,
        precision_egreso: gps.accuracy,
      }
      : payload
    const payloadConGpsLegacy = gps
      ? {
        ...payloadBase,
        lat_salida: gps.latitude,
        lng_salida: gps.longitude,
      }
      : payloadBase

    let { error } = await supabase
      .from('registros_asistencia')
      .update(payloadConGps)
      .eq('id', registro.id)

    let gpsDisponible = Boolean(gps)

    if (error && esErrorColumnaGps(error)) {
      const retry = await supabase
        .from('registros_asistencia')
        .update(payloadConGpsLegacy)
        .eq('id', registro.id)

      error = retry.error
    }

    if (error) {
      setMensaje({ texto: 'Error al registrar salida. Intentá de nuevo.', tipo: 'error' })
    } else {
      setRegistros(prev =>
        prev.map(r => r.id === registro.id
          ? { ...r, ...payloadConGps, hora_salida_real: hora, horas_trabajadas: horas }
          : r
        )
      )
      setMensaje({
        texto: gpsDisponible && gps
          ? `✓ Salida registrada a las ${hora} — ${horas}h trabajadas · ${mensajeAuditoriaRadio(auditoriaEgreso, gps)}`
          : mensajeAuditoriaRadio(auditoriaEgreso, gps),
        tipo: auditoriaEgreso.estado === 'fuera_radio' || !gpsDisponible ? 'warn' : 'ok',
      })
    }

    setFichando(null)
    setTimeout(() => setMensaje(null), 4000)
  }

  const getObjetivo = (id: string) => objetivos.find(o => o.id === id)

  // ── RENDER ────────────────────────────────────────────────
  return (
    <div style={S.container}>

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
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 800, marginBottom: 2 }}>
            Mis Turnos
          </div>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
        </div>

        <button
          type="button"
          onClick={activarPush}
          disabled={activandoPush}
          style={{ ...S.btn, ...S.btnSalida, marginBottom: 14, opacity: activandoPush ? 0.65 : 1 }}
        >
          {activandoPush ? 'Activando...' : 'Activar notificaciones'}
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

        {/* Mensaje */}
        {mensaje && (
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

        {/* Loading */}
        {loading && (
          <div style={S.empty}>
            <div style={{ color: '#64748b' }}>Cargando turnos...</div>
          </div>
        )}

        {/* Sin turnos */}
        {!loading && turnos.length === 0 && (
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
          const cargando = fichando === turno.id
          const bloqueoFichaje = mensajeBloqueoFichaje(turno, user.id, ahora)
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
                <span style={S.badge(reg?.hora_salida_real ? 'completado' : reg ? 'presente' : turno.estado)}>
                  {reg?.hora_salida_real ? '✓ Turno completado'
                    : reg ? '● En turno'
                    : turno.estado === 'cubierto' ? '✓ Cubierto'
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
                    style={{ ...S.btn, ...(puedeDarPresente && !gpsBloqueaPresente ? S.btnPresente : S.btnDisabled), opacity: cargando ? 0.6 : 1 }}
                    onClick={() => darPresente(turno)}
                    disabled={cargando || !puedeDarPresente || gpsBloqueaPresente}>
                    {cargando ? 'Registrando...' : '✅ Dar presente'}
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
                <button style={{ ...S.btn, ...S.btnDisabled }} disabled>
                  ✓ Turno finalizado
                </button>
              )}

            </div>
          )
        })}

        {/* Cerrar sesión */}
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <button
            onClick={async () => { await supabase.auth.signOut(); window.location.reload() }}
            style={{ background: 'none', border: '1px solid #1e2d42', color: '#64748b', padding: '8px 20px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            Cerrar sesión
          </button>
        </div>

      </div>
    </div>
  )
}
