'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

type EstadoTurno = 'programado' | 'cubierto' | 'en turno' | 'finalizado' | 'descubierto'
type TipoAlerta = 'sin entrada' | 'entrada registrada' | 'salida registrada'

interface Turno {
  id: string
  guardia_id: string | null
  objetivo_id: string
  fecha: string
  hora_inicio: string
  hora_fin: string
  estado: 'programado' | 'cubierto' | 'descubierto'
}

interface Usuario {
  id: string
  nombre: string
  apellido: string
  legajo?: string
  rol: string
  estado: string
}

interface Objetivo {
  id: string
  nombre: string
  cliente?: string
  direccion?: string
  estado?: string
}

interface RegistroAsistencia {
  id: string
  turno_id: string
  guardia_id: string
  hora_entrada_real?: string | null
  hora_salida_real?: string | null
  horas_trabajadas?: number | null
  created_at?: string
}

function fechaHoy(): string {
  return new Date().toLocaleDateString('sv-SE')
}

function horaCorta(hora?: string | null): string {
  return hora ? hora.slice(0, 5) : '--:--'
}

function horasCortas(horas?: number | null): string {
  if (horas === null || horas === undefined) return '--'
  return `${Number(horas).toLocaleString('es-AR', { maximumFractionDigits: 2 })} h`
}

function fechaRegistro(fecha?: string | null): string {
  if (!fecha) return ''

  return new Date(fecha).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
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

  const hoy = fechaHoy()

  const cerrarSesion = async () => {
    await supabase.auth.signOut()
    window.location.href = '/dashboard'
  }

  const cargarDatos = async () => {
    setLoading(true)
    setError('')

    const [{ data: turnosData, error: turnosError }, { data: objetivosData, error: objetivosError }, { data: guardiasData, error: guardiasError }] = await Promise.all([
      supabase
        .from('turnos')
        .select('id, guardia_id, objetivo_id, fecha, hora_inicio, hora_fin, estado')
        .eq('fecha', hoy)
        .order('hora_inicio'),
      supabase
        .from('objetivos')
        .select('id, nombre, cliente, direccion, estado')
        .order('nombre'),
      supabase
        .from('usuarios')
        .select('id, nombre, apellido, legajo, rol, estado')
        .eq('rol', 'guardia')
        .order('apellido'),
    ])

    if (turnosError || objetivosError || guardiasError) {
      setError(turnosError?.message || objetivosError?.message || guardiasError?.message || 'Error al cargar datos.')
      setLoading(false)
      return
    }

    const turnosHoy = (turnosData || []) as Turno[]
    setTurnos(turnosHoy)
    setObjetivos((objetivosData || []) as Objetivo[])
    setGuardias((guardiasData || []) as Usuario[])

    if (turnosHoy.length === 0) {
      setRegistros([])
      setLoading(false)
      return
    }

    const { data: registrosData, error: registrosError } = await supabase
      .from('registros_asistencia')
      .select('id, turno_id, guardia_id, hora_entrada_real, hora_salida_real, horas_trabajadas, created_at')
      .in('turno_id', turnosHoy.map(t => t.id))

    if (registrosError) {
      setError(registrosError.message)
      setRegistros([])
    } else {
      setRegistros((registrosData || []) as RegistroAsistencia[])
    }

    setLoading(false)
  }

  useEffect(() => {
    cargarDatos()
  }, [])

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

  const estadoOperativo = (turno: Turno): EstadoTurno => {
    const registro = getRegistro(turno.id)

    if (registro?.hora_salida_real) return 'finalizado'
    if (registro?.hora_entrada_real) return 'en turno'
    if (!turno.guardia_id || turno.estado === 'descubierto') return 'descubierto'
    if (turno.estado === 'cubierto') return 'cubierto'
    return 'programado'
  }

  const alertaTurno = (turno: Turno): TipoAlerta => {
    const registro = getRegistro(turno.id)

    if (registro?.hora_salida_real) return 'salida registrada'
    if (registro?.hora_entrada_real) return 'entrada registrada'
    return 'sin entrada'
  }

  const turnosPorObjetivo = useMemo(() => {
    const grupos = new Map<string, { objetivo: Objetivo, turnos: Turno[] }>()

    turnos.forEach(turno => {
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
  }, [turnos, objetivos, registros])

  const resumen = useMemo(() => ({
    total: turnos.length,
    enTurno: turnos.filter(t => estadoOperativo(t) === 'en turno').length,
    finalizados: turnos.filter(t => estadoOperativo(t) === 'finalizado').length,
    descubiertos: turnos.filter(t => estadoOperativo(t) === 'descubierto').length,
  }), [turnos, registros])

  const cambiarGuardia = async (turno: Turno, guardiaId: string) => {
    const nuevoGuardiaId = guardiaId || null
    setAsignando(turno.id)
    setError('')

    const payload: { guardia_id: string | null, estado: Turno['estado'] } = {
      guardia_id: nuevoGuardiaId,
      estado: nuevoGuardiaId ? (turno.estado === 'descubierto' ? 'programado' : turno.estado) : 'descubierto',
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
    { id: 'alertas', label: 'Alertas', icon: '⚠️' },
  ]

  const renderTurno = (turno: Turno) => {
    const guardia = getGuardia(turno.guardia_id)
    const registrosTurno = getRegistrosTurno(turno.id)
    const registro = getRegistro(turno.id)
    const estado = estadoOperativo(turno)
    const alerta = alertaTurno(turno)
    const puedeMarcarDescubierto = !registro?.hora_entrada_real && estado !== 'descubierto'
    const registrosAbiertos = turnoRegistrosAbierto === turno.id

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
                    {r.created_at && <span style={muted}>{fechaRegistro(r.created_at)}</span>}
                  </div>
                  <div style={muted}>
                    {registroGuardia ? `${registroGuardia.apellido}, ${registroGuardia.nombre}` : 'Guardia no encontrado'}
                  </div>
                  <div style={registroLine}>
                    <span>Entrada {horaCorta(r.hora_entrada_real)}</span>
                    <span>Salida {horaCorta(r.hora_salida_real)}</span>
                    <span>{horasCortas(r.horas_trabajadas)}</span>
                  </div>
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

        {loading ? (
          <div style={empty}>Cargando operación...</div>
        ) : (
          <>
            {tab === 'inicio' && (
              <section>
                <div style={screenTitle}>Operación de hoy</div>
                <div style={dateText}>{new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>

                <div style={statsGrid}>
                  <div style={statCard}><strong>{resumen.total}</strong><span>Turnos</span></div>
                  <div style={statCard}><strong>{resumen.enTurno}</strong><span>En turno</span></div>
                  <div style={statCard}><strong>{resumen.finalizados}</strong><span>Finalizados</span></div>
                  <div style={statCard}><strong>{resumen.descubiertos}</strong><span>Descubiertos</span></div>
                </div>

                <button style={refreshButton} onClick={cargarDatos}>Actualizar</button>
              </section>
            )}

            {tab === 'turnos' && (
              <section>
                <div style={screenTitle}>Turnos por objetivo</div>

                {turnosPorObjetivo.length === 0 ? (
                  <div style={empty}>No hay turnos cargados para hoy.</div>
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
                  </div>
                ))}
              </section>
            )}

            {tab === 'alertas' && (
              <section>
                <div style={screenTitle}>Alertas básicas</div>

                {turnos.length === 0 ? (
                  <div style={empty}>No hay turnos para auditar.</div>
                ) : turnos.map(turno => {
                  const objetivo = getObjetivo(turno.objetivo_id)
                  const guardia = getGuardia(turno.guardia_id)
                  const alerta = alertaTurno(turno)

                  return (
                    <div key={turno.id} style={card}>
                      <div style={turnoTop}>
                        <div>
                          <div style={objetivoName}>{objetivo?.nombre || 'Objetivo sin nombre'}</div>
                          <div style={muted}>{horaCorta(turno.hora_inicio)} a {horaCorta(turno.hora_fin)} - {guardia ? `${guardia.apellido}, ${guardia.nombre}` : 'Sin guardia'}</div>
                        </div>
                        <span style={alertBadge(alerta)}>{alerta}</span>
                      </div>
                    </div>
                  )
                })}
              </section>
            )}
          </>
        )}
      </main>

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
  const color = alerta === 'sin entrada' ? '#f59e0b' : '#10b981'

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
