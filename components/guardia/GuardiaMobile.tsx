'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

// ── TIPOS ─────────────────────────────────────────────────────
interface Turno {
  id: string
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
  latitud?: number
  longitud?: number
  radio_metros?: number
}

interface Registro {
  id: string
  turno_id: string
  guardia_id: string
  hora_entrada_real: string
  hora_salida_real?: string
  horas_trabajadas?: number
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

  const hoy = fechaHoy()

  // Cargar datos
  useEffect(() => {
    const cargar = async () => {
      setLoading(true)

const [{ data: t }, { data: o }, { data: r }] = await Promise.all([

  supabase
    .from('turnos')
    .select('*')
    .eq('guardia_id', user.id)
    .eq('fecha', hoy)
    .order('hora_inicio'),

  supabase
    .from('objetivos')
    .select('id, nombre, direccion, latitud, longitud, radio_metros'),

  supabase
    .from('registros_asistencia')
    .select('id, turno_id, guardia_id, hora_entrada_real, hora_salida_real, horas_trabajadas')
    .eq('guardia_id', user.id),

])

      if (t) setTurnos(t)
      if (o) setObjetivos(o)
      if (r) setRegistros(r)
      setLoading(false)
    }
    cargar()
  }, [user.id, hoy])

  // Registro de este turno
  const registroDelTurno = (turnoId: string) =>
    registros.find(r => r.turno_id === turnoId)

  // Dar presente
  const darPresente = async (turno: Turno) => {
    setFichando(turno.id)
    setMensaje(null)

    try {
      const hora = horaActual()
      const payload = {
        guardia_id: user.id,
        turno_id: turno.id,
        hora_entrada_real: hora,
      }

      const { data, error } = await supabase
        .from('registros_asistencia')
        .insert(payload)
        .select()
        .single()

      if (error || !data) {
        throw error || new Error('No se recibió el registro creado.')
      }

      setRegistros(prev => [...prev, data])
      await supabase.from('turnos').update({ estado: 'cubierto' }).eq('id', turno.id)
      setTurnos(prev => prev.map(t => t.id === turno.id ? { ...t, estado: 'cubierto' } : t))
      setMensaje({ texto: `✓ Entrada registrada a las ${hora}`, tipo: 'ok' })
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

    const { error } = await supabase
      .from('registros_asistencia')
      .update({
        hora_salida_real: hora,
        horas_trabajadas: horas,
      })
      .eq('id', registro.id)

    if (error) {
      setMensaje({ texto: 'Error al registrar salida. Intentá de nuevo.', tipo: 'error' })
    } else {
      setRegistros(prev =>
        prev.map(r => r.id === registro.id
          ? { ...r, hora_salida_real: hora, horas_trabajadas: horas }
          : r
        )
      )
      setMensaje({ texto: `✓ Salida registrada a las ${hora} — ${horas}h trabajadas`, tipo: 'ok' })
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

        {/* Mensaje */}
        {mensaje && (
          <div style={S.alert(mensaje.tipo)}>{mensaje.texto}</div>
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

          return (
            <div key={turno.id} style={S.card}>

              {/* Objetivo */}
              <div style={S.label}>Objetivo</div>
              <div style={S.objetivo}>{obj?.nombre || '—'}</div>
              {obj?.direccion && (
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>{obj.direccion}</div>
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
                <button
                  style={{ ...S.btn, ...S.btnPresente, opacity: cargando ? 0.6 : 1 }}
                  onClick={() => darPresente(turno)}
                  disabled={cargando}>
                  {cargando ? 'Registrando...' : '✅ Dar presente'}
                </button>
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
