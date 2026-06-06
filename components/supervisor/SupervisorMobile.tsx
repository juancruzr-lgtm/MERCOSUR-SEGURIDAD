'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FILTROS_FECHA_TURNOS, MENSAJE_TURNO_SUPERPUESTO, fechasVecinasTurno, fechaActualTurno, filtroFechaTurnosIncluye, filtroFechaTurnosParaFecha, rangoFiltroFechaTurnos, sumarDiasFecha, tieneTurnoSuperpuesto, turnoSinCoberturaOperativa } from '@/lib/turnos'
import type { FiltroFechaTurnos } from '@/lib/turnos'

type EstadoTurno = 'programado' | 'cubierto' | 'en turno' | 'finalizado' | 'descubierto'
type TipoAlerta = 'sin entrada' | 'entrada registrada' | 'salida registrada' | 'turno descubierto'

interface Turno {
  id: string
  guardia_id: string | null
  guardia_original_id?: string | null
  objetivo_id: string
  fecha: string
  hora_inicio: string
  hora_fin: string
  estado: 'programado' | 'cubierto' | 'descubierto'
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
  created_at?: string
}

function fechaHoy(): string {
  return fechaActualTurno()
}

function horaCorta(hora?: string | null): string {
  return hora ? hora.slice(0, 5) : '--:--'
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

function calcDistanciaMetros(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radioTierra = 6371000
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2

  return radioTierra * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function ubicacionObjetivoCompleta(objetivo?: Objetivo | null): boolean {
  return numeroGps(objetivo?.lat) !== null && numeroGps(objetivo?.lng) !== null && (numeroGps(objetivo?.radio_metros) || 0) > 0
}

function resumenGps(registro: RegistroAsistencia | undefined, objetivo: Objetivo | undefined, tipo: 'ingreso' | 'egreso'): string {
  const gps = gpsRegistro(registro, tipo)
  const etiqueta = tipo === 'ingreso' ? 'GPS ingreso' : 'GPS egreso'
  if (!gps) return `${etiqueta}: Sin GPS`

  const objetivoLat = numeroGps(objetivo?.lat)
  const objetivoLng = numeroGps(objetivo?.lng)
  const radio = numeroGps(objetivo?.radio_metros) || 0
  const precision = gps.precision !== null ? ` · Precisión ${Math.round(gps.precision)}m` : ''

  if (objetivoLat === null || objetivoLng === null || radio <= 0) {
    return `${etiqueta} OK${precision} · Objetivo sin GPS`
  }

  const distancia = Math.round(calcDistanciaMetros(gps.lat, gps.lng, objetivoLat, objetivoLng))
  const estadoRadio = distancia <= radio ? 'Dentro del radio' : 'Fuera del radio'

  return `${etiqueta} OK${precision} · ${estadoRadio} · Distancia ${distancia}m`
}

export default function SupervisorMobile({ user }: any) {
  const [tab, setTab] = useState('inicio')
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [guardias, setGuardias] = useState<Usuario[]>([])
  const [objetivos, setObjetivos] = useState<Objetivo[]>([])
  const [registros, setRegistros] = useState<RegistroAsistencia[]>([])
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
  const [mensaje, setMensaje] = useState('')

  const hoy = fechaHoy()
  const rangoFecha = rangoFiltroFechaTurnos(filtroFecha, hoy)

  const cerrarSesion = async () => {
    await supabase.auth.signOut()
    window.location.href = '/dashboard'
  }

  const cargarDatos = async (filtro: FiltroFechaTurnos = filtroFecha) => {
    setLoading(true)
    setError('')
    const rango = rangoFiltroFechaTurnos(filtro, hoy)

    const [{ data: turnosData, error: turnosError }, { data: objetivosData, error: objetivosError }, guardiasResult] = await Promise.all([
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
    ])

    let guardiasData = guardiasResult.data
    let guardiasError = guardiasResult.error

    if (guardiasError?.message?.includes('usuarios.email') || guardiasError?.message?.includes('usuarios.telefono') || guardiasError?.message?.includes('usuarios.foto_url')) {
      const retry = await supabase
        .from('usuarios')
        .select('id, nombre, apellido, legajo, rol, estado')
        .in('rol', ['guardia', 'vigilador'])
        .order('apellido')

      guardiasData = retry.data
      guardiasError = retry.error
    }

    if (turnosError || objetivosError || guardiasError) {
      setError(turnosError?.message || objetivosError?.message || guardiasError?.message || 'Error al cargar datos.')
      setLoading(false)
      return
    }

    const turnosRango = (turnosData || []) as Turno[]
    setTurnos(turnosRango)
    setObjetivos((objetivosData || []) as Objetivo[])
    setGuardias((guardiasData || []) as Usuario[])

    if (turnosRango.length === 0) {
      setRegistros([])
      setLoading(false)
      return
    }

    const { data: registrosData, error: registrosError } = await supabase
      .from('registros_asistencia')
      .select('*')
      .in('turno_id', turnosRango.map(t => t.id))

    if (registrosError) {
      setError(registrosError.message)
      setRegistros([])
    } else {
      setRegistros((registrosData || []) as RegistroAsistencia[])
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
  const getRegistrosTurno = (turnoId: string) => registros
    .filter(r => r.turno_id === turnoId)
    .sort((a, b) => {
      const fechaA = a.created_at ? new Date(a.created_at).getTime() : 0
      const fechaB = b.created_at ? new Date(b.created_at).getTime() : 0
      return fechaB - fechaA
    })
  const getRegistro = (turnoId: string) => getRegistrosTurno(turnoId)[0]
  const existeAsistencia = (turno: Turno) => getRegistrosTurno(turno.id).length > 0
  const esDescubiertoOperativo = (turno: Turno) => turnoSinCoberturaOperativa(turno, existeAsistencia(turno))
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
    if (registro?.hora_entrada_real) return 'en turno'
    if (esDescubiertoOperativo(turno)) return 'descubierto'
    if (turno.estado === 'cubierto') return 'cubierto'
    return 'programado'
  }

  const alertaTurno = (turno: Turno): TipoAlerta => {
    const registro = getRegistro(turno.id)

    if (registro?.hora_salida_real) return 'salida registrada'
    if (registro?.hora_entrada_real) return 'entrada registrada'
    if (esDescubiertoOperativo(turno)) return 'turno descubierto'
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
    const candidatos = (turnosOrigen || []).reduce<{ objetivo_id: string, guardia_id: string | null, fecha: string, hora_inicio: string, hora_fin: string, estado: Turno['estado'], tipo_evento: string }[]>((acumulados, turno: any) => {
      const candidato = {
        objetivo_id: turno.objetivo_id,
        guardia_id: turno.guardia_id || null,
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

    const payload: { guardia_id: string | null, estado: Turno['estado'] } = {
      guardia_id: nuevoGuardiaId,
      estado: nuevoGuardiaId ? (turno.estado === 'descubierto' ? 'programado' : turno.estado) : 'descubierto',
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

    const payload: { guardia_id: null, estado: Turno['estado'] } = {
      guardia_id: null,
      estado: 'descubierto',
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

  const tabs = [
    { id: 'inicio', label: 'Inicio', icon: '🏠' },
    { id: 'turnos', label: 'Turnos', icon: '📅' },
    { id: 'guardias', label: 'Guardias', icon: '👮' },
    { id: 'objetivos', label: 'Objetivos', icon: '🏢' },
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

  const renderTurno = (turno: Turno) => {
    const objetivo = getObjetivo(turno.objetivo_id)
    const guardia = getGuardia(turno.guardia_id)
    const registrosTurno = getRegistrosTurno(turno.id)
    const registro = getRegistro(turno.id)
    const estado = estadoOperativo(turno)
    const alerta = alertaTurno(turno)
    const puedeMarcarDescubierto = !registro?.hora_entrada_real && estado !== 'descubierto'
    const registrosAbiertos = turnoRegistrosAbierto === turno.id
    const gpsIngreso = resumenGps(registro, objetivo, 'ingreso')
    const gpsEgreso = resumenGps(registro, objetivo, 'egreso')

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
                  <div style={muted}>{resumenGps(r, objetivo, 'ingreso')}</div>
                  <div style={muted}>{resumenGps(r, objetivo, 'egreso')}</div>
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
                <div style={screenTitle}>Guardias activos</div>

                {guardias.filter(g => g.estado === 'activo').map(g => (
                  <div key={g.id} style={card}>
                    <div style={objetivoName}>{g.apellido}, {g.nombre}</div>
                    <div style={muted}>{g.legajo || 'Sin legajo'}</div>
                    <div style={muted}>{g.email || 'Sin email'}{g.telefono ? ` · ${g.telefono}` : ''}</div>
                    <button style={{ ...secondaryButton, marginTop:12 }} onClick={() => abrirEditarGuardia(g)}>
                      Editar datos
                    </button>
                  </div>
                ))}
              </section>
            )}

            {tab === 'objetivos' && (
              <section>
                <div style={screenTitle}>Objetivos</div>
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
                    </div>
                  </div>
                ))}
              </section>
            )}

            {tab === 'alertas' && (
              <section>
                <div style={screenTitle}>Alertas básicas</div>

                {turnosDescubiertosOperativos.length > 0 && (
                  <div style={{ ...card, borderColor: 'rgba(239,68,68,.35)', background: 'rgba(239,68,68,.08)' }}>
                    <div style={{ ...objetivoName, color: '#fca5a5' }}>Puestos sin cobertura</div>
                    <div style={muted}>{turnosDescubiertosOperativos.length} turno(s) requieren acción.</div>

                    <div style={{ marginTop: 12 }}>
                      {turnosDescubiertosOperativos.map(turno => {
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
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {turnos.length === 0 ? (
                  <div style={empty}>No hay turnos para auditar.</div>
                ) : turnos.map(turno => {
                  const objetivo = getObjetivo(turno.objetivo_id)
                  const alerta = alertaTurno(turno)

                  return (
                    <div key={turno.id} style={card}>
                      <div style={turnoTop}>
                        <div>
                          <div style={objetivoName}>{objetivo?.nombre || 'Objetivo sin nombre'}</div>
                          <div style={muted}>Horario: {horaCorta(turno.hora_inicio)} a {horaCorta(turno.hora_fin)}</div>
                          <div style={muted}>Estado: {turno.estado || 'programado'}</div>
                          <div style={muted}>Guardia esperado: {nombreGuardiaEsperado(turno)}</div>
                        </div>
                        <span style={alertBadge(alerta)}>{alerta}</span>
                      </div>
                    </div>
                  )
                })}
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
    cubierto: { bg: 'rgba(59,130,246,.18)', color: '#60a5fa' },
    'en turno': { bg: 'rgba(16,185,129,.18)', color: '#10b981' },
    finalizado: { bg: 'rgba(16,185,129,.18)', color: '#10b981' },
    descubierto: { bg: 'rgba(239,68,68,.18)', color: '#f87171' },
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
    : alerta === 'sin entrada'
      ? '#f59e0b'
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
