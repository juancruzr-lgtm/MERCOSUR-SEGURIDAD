'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { registroTieneEntradaConfirmada } from '@/lib/turnos'
import { track, initTelemetry } from '@/lib/telemetry'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface DatosEmpleado {
  id: string
  nombre: string
  apellido: string
  legajo: string | null
  dni?: string
  email?: string
  rol: string
  estado: string
  foto_url: string | null
}

interface TurnoActual {
  id: string
  fecha: string
  hora_inicio: string
  hora_fin: string
  objetivo_nombre: string | null
  puesto_nombre: string | null
  es_activo_ahora: boolean
}

interface RegistroActual {
  hora_entrada_real: string | null
  hora_entrada_final: string | null
  tipo_registro: string | null
}

interface ProximoTurno {
  id: string
  fecha: string
  hora_inicio: string
  hora_fin: string
  objetivo_nombre: string | null
}

interface NovedadVigente {
  tipo: string
  fecha_desde: string
  fecha_hasta: string
  observacion: string | null
}

interface DatosLegajo {
  empleado: DatosEmpleado
  turno_actual: TurnoActual | null
  registro_actual: RegistroActual | null
  proximo_turno: ProximoTurno | null
  novedad_vigente: NovedadVigente | null
}

// ── Secciones de navegación ────────────────────────────────────────────────────

const SECCIONES = [
  { id: 'situacion', label: 'Situación actual' },
  { id: 'turnos', label: 'Turnos' },
  { id: 'asistencias', label: 'Asistencias' },
  { id: 'supervisiones', label: 'Supervisiones' },
  { id: 'novedades', label: 'Novedades laborales' },
  { id: 'reporte', label: 'Reporte mensual' },
  { id: 'documentacion', label: 'Documentación' },
  { id: 'historial', label: 'Historial' },
  { id: 'indicadores', label: 'Indicadores' },
] as const

type SeccionId = (typeof SECCIONES)[number]['id']

// ── Helpers de formato ────────────────────────────────────────────────────────

const TIPOS_NOVEDAD: Record<string, string> = {
  parte_medico: 'Parte médico',
  accidente: 'Accidente',
  licencia: 'Licencia',
  vacaciones: 'Vacaciones',
  falta_justificada: 'Falta justificada',
  falta_injustificada: 'Falta injustificada',
  dia_estudio: 'Día de estudio',
  suspension: 'Suspensión',
  franco: 'Franco',
  otra: 'Otra',
}

function formatearFecha(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function formatearHora(hora: string): string {
  return hora.slice(0, 5)
}

function estadoAsistencia(
  turno: TurnoActual | null,
  registro: RegistroActual | null,
): { texto: string; color: string } {
  if (!turno) return { texto: '—', color: '#64748b' }
  if (!registro) return { texto: 'Sin fichar', color: '#f59e0b' }
  if (registro.tipo_registro === 'ausencia') return { texto: 'Ausencia registrada', color: '#ef4444' }
  if (registroTieneEntradaConfirmada(registro)) {
    const hora = formatearHora(registro.hora_entrada_final ?? registro.hora_entrada_real ?? '')
    return { texto: `Presente desde ${hora}`, color: '#22c55e' }
  }
  return { texto: 'Sin fichar', color: '#f59e0b' }
}

// ── Estilos base ──────────────────────────────────────────────────────────────

const S = {
  page: {
    minHeight: '100vh',
    background: '#0a0e1a',
    color: '#e2e8f0',
    fontFamily: 'system-ui, sans-serif',
  } as React.CSSProperties,
  header: {
    background: '#0f172a',
    borderBottom: '1px solid #1e2d42',
    padding: '16px 24px',
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  } as React.CSSProperties,
  backBtn: {
    background: 'none',
    border: '1px solid #334155',
    borderRadius: 6,
    color: '#94a3b8',
    cursor: 'pointer',
    padding: '6px 12px',
    fontSize: 13,
  } as React.CSSProperties,
  nav: {
    background: '#0f172a',
    borderBottom: '1px solid #1e2d42',
    display: 'flex',
    overflowX: 'auto' as const,
    gap: 0,
  } as React.CSSProperties,
  navBtn: (activa: boolean): React.CSSProperties => ({
    background: 'none',
    border: 'none',
    borderBottom: activa ? '2px solid #f59e0b' : '2px solid transparent',
    color: activa ? '#f59e0b' : '#94a3b8',
    cursor: 'pointer',
    padding: '12px 16px',
    fontSize: 13,
    fontWeight: activa ? 600 : 400,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  }),
  content: {
    maxWidth: 960,
    margin: '0 auto',
    padding: '24px 16px',
  } as React.CSSProperties,
  card: {
    background: '#111827',
    border: '1px solid #1e2d42',
    borderRadius: 10,
    padding: 20,
    marginBottom: 16,
  } as React.CSSProperties,
  label: {
    fontSize: 11,
    color: '#64748b',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: 2,
  } as React.CSSProperties,
  value: {
    fontSize: 15,
    color: '#e2e8f0',
  } as React.CSSProperties,
  badge: (color: string): React.CSSProperties => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 600,
    background: color + '22',
    color,
    border: `1px solid ${color}44`,
  }),
  placeholder: {
    textAlign: 'center' as const,
    color: '#475569',
    padding: '48px 0',
    fontSize: 14,
  } as React.CSSProperties,
  grid2: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 16,
  } as React.CSSProperties,
  campo: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  } as React.CSSProperties,
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function LegajoPage() {
  const params = useParams()
  const router = useRouter()
  const empleadoId = typeof params.id === 'string' ? params.id : ''

  const [datos, setDatos] = useState<DatosLegajo | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [seccion, setSeccion] = useState<SeccionId>('situacion')
  const [rolUsuario, setRolUsuario] = useState<string>('admin')

  // Protección contra doble disparo (StrictMode / re-render)
  const telemetriaIniciada = useRef(false)
  const cargaRegistrada = useRef(false)

  // Inicializar telemetría y disparar legajo_abierto una sola vez
  useEffect(() => {
    if (telemetriaIniciada.current || !empleadoId) return
    telemetriaIniciada.current = true

    supabase.auth.getSession().then(({ data: sessionData }) => {
      const session = sessionData?.session
      if (!session) {
        router.push('/dashboard')
        return
      }

      supabase
        .from('usuarios')
        .select('id, rol')
        .eq('auth_user_id', session.user.id)
        .single()
        .then(({ data: perfil }) => {
          if (!perfil) { router.push('/dashboard'); return }

          setRolUsuario(perfil.rol ?? 'admin')
          void initTelemetry(perfil.id, (perfil.rol ?? 'admin') as any)
          track('legajo_abierto', {
            screen: 'legajo_empleado',
            category: 'admin',
            value_json: { empleado_id: empleadoId },
          })
        })
    })
  }, [empleadoId, router])

  // Cargar datos del legajo
  useEffect(() => {
    if (!empleadoId) return
    let activo = true

    const cargar = async () => {
      setCargando(true)
      setError(null)
      cargaRegistrada.current = false

      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) { router.push('/dashboard'); return }

      const t0 = Date.now()
      try {
        const res = await fetch(`/api/legajo/${empleadoId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const json = await res.json()

        if (!activo) return

        if (!res.ok) {
          setError(json.error ?? 'Error al cargar el legajo')
          if (!cargaRegistrada.current) {
            cargaRegistrada.current = true
            track('legajo_carga_error', {
              screen: 'legajo_empleado',
              category: 'error',
              err_message: json.error ?? 'Error desconocido',
              err_code: String(res.status),
              value_json: { empleado_id: empleadoId },
            })
          }
        } else {
          setDatos(json)
          if (!cargaRegistrada.current) {
            cargaRegistrada.current = true
            track('legajo_carga_exitosa', {
              screen: 'legajo_empleado',
              category: 'admin',
              duration_ms: Date.now() - t0,
              value_json: { empleado_id: empleadoId },
            })
          }
        }
      } catch (e) {
        if (!activo) return
        const msg = e instanceof Error ? e.message : 'Error de red'
        setError(msg)
        if (!cargaRegistrada.current) {
          cargaRegistrada.current = true
          track('legajo_carga_error', {
            screen: 'legajo_empleado',
            category: 'error',
            err_message: msg,
            value_json: { empleado_id: empleadoId },
          })
        }
      } finally {
        if (activo) setCargando(false)
      }
    }

    void cargar()
    return () => { activo = false }
  }, [empleadoId, router])

  const cambiarSeccion = (id: SeccionId) => {
    setSeccion(id)
    track('legajo_seccion_abierta', {
      screen: 'legajo_empleado',
      screen_section: id,
      category: 'admin',
      value_json: { empleado_id: empleadoId },
    })
  }

  // ── Render: estados de carga y error ─────────────────────────────────────
  if (cargando) {
    return (
      <div style={S.page}>
        <div style={{ ...S.content, textAlign: 'center', paddingTop: 80, color: '#64748b' }}>
          Cargando legajo...
        </div>
      </div>
    )
  }

  if (error || !datos) {
    return (
      <div style={S.page}>
        <div style={{ ...S.content, textAlign: 'center', paddingTop: 80, color: '#ef4444' }}>
          {error ?? 'No se pudo cargar el legajo.'}
          <div style={{ marginTop: 16 }}>
            <button style={S.backBtn} onClick={() => router.push('/dashboard')}>
              Volver al dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }

  const { empleado, turno_actual, registro_actual, proximo_turno, novedad_vigente } = datos
  const asistencia = estadoAsistencia(turno_actual, registro_actual)
  const esAdmin = rolUsuario === 'admin'

  // ── Render: encabezado ────────────────────────────────────────────────────
  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <button style={S.backBtn} onClick={() => router.push('/dashboard')}>
          ← Guardias
        </button>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>
            {empleado.nombre} {empleado.apellido}
          </div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
            Legajo:{' '}
            <span style={{ fontWeight: 700, color: '#f59e0b', fontFamily: 'Syne, sans-serif' }}>
              {empleado.legajo ?? '—'}
            </span>
            {' · '}
            <span style={S.badge(empleado.estado === 'activo' ? '#22c55e' : '#ef4444')}>
              {empleado.estado}
            </span>
            {' · '}
            <span style={{ color: '#94a3b8' }}>{empleado.rol}</span>
          </div>
        </div>
      </div>

      {/* Navegación */}
      <nav style={S.nav}>
        {SECCIONES.map(s => (
          <button
            key={s.id}
            style={S.navBtn(seccion === s.id)}
            onClick={() => cambiarSeccion(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {/* Contenido */}
      <div style={S.content}>
        {seccion === 'situacion' && (
          <SeccionSituacion
            empleado={empleado}
            turnoActual={turno_actual}
            registroActual={registro_actual}
            proximoTurno={proximo_turno}
            novedadVigente={novedad_vigente}
            asistencia={asistencia}
            esAdmin={esAdmin}
          />
        )}

        {seccion !== 'situacion' && (
          <div style={S.placeholder}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
            <div>Esta sección está disponible en una próxima etapa.</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sección: Situación actual ─────────────────────────────────────────────────

function SeccionSituacion({
  empleado,
  turnoActual,
  registroActual,
  proximoTurno,
  novedadVigente,
  asistencia,
  esAdmin,
}: {
  empleado: DatosEmpleado
  turnoActual: TurnoActual | null
  registroActual: RegistroActual | null
  proximoTurno: ProximoTurno | null
  novedadVigente: NovedadVigente | null
  asistencia: { texto: string; color: string }
  esAdmin: boolean
}) {
  return (
    <>
      {/* Datos del empleado */}
      <div style={S.card}>
        <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600, marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Datos del empleado
        </div>
        <div style={S.grid2}>
          {esAdmin && empleado.dni && (
            <div style={S.campo}>
              <div style={S.label}>DNI</div>
              <div style={S.value}>{empleado.dni}</div>
            </div>
          )}
          {esAdmin && empleado.email && (
            <div style={S.campo}>
              <div style={S.label}>Email</div>
              <div style={{ ...S.value, wordBreak: 'break-all', fontSize: 13 }}>{empleado.email}</div>
            </div>
          )}
          <div style={S.campo}>
            <div style={S.label}>Rol</div>
            <div style={S.value}>{empleado.rol}</div>
          </div>
          <div style={S.campo}>
            <div style={S.label}>Estado</div>
            <div style={S.badge(empleado.estado === 'activo' ? '#22c55e' : '#ef4444')}>
              {empleado.estado}
            </div>
          </div>
        </div>
      </div>

      {/* Turno actual */}
      <div style={S.card}>
        <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600, marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Turno de hoy
        </div>
        {turnoActual ? (
          <div style={S.grid2}>
            <div style={S.campo}>
              <div style={S.label}>Objetivo</div>
              <div style={S.value}>{turnoActual.objetivo_nombre ?? '—'}</div>
            </div>
            {turnoActual.puesto_nombre && (
              <div style={S.campo}>
                <div style={S.label}>Puesto</div>
                <div style={S.value}>{turnoActual.puesto_nombre}</div>
              </div>
            )}
            <div style={S.campo}>
              <div style={S.label}>Horario</div>
              <div style={S.value}>
                {formatearHora(turnoActual.hora_inicio)} – {formatearHora(turnoActual.hora_fin)}
              </div>
            </div>
            <div style={S.campo}>
              <div style={S.label}>Estado turno</div>
              <div style={S.badge(turnoActual.es_activo_ahora ? '#22c55e' : '#64748b')}>
                {turnoActual.es_activo_ahora ? 'En curso' : 'Programado'}
              </div>
            </div>
            <div style={S.campo}>
              <div style={S.label}>Asistencia</div>
              <div style={S.badge(asistencia.color)}>{asistencia.texto}</div>
            </div>
          </div>
        ) : (
          <div style={{ color: '#64748b', fontSize: 14 }}>Sin turno asignado hoy.</div>
        )}
      </div>

      {/* Próximo turno */}
      <div style={S.card}>
        <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600, marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Próximo turno
        </div>
        {proximoTurno ? (
          <div style={S.grid2}>
            <div style={S.campo}>
              <div style={S.label}>Fecha</div>
              <div style={S.value}>{formatearFecha(proximoTurno.fecha)}</div>
            </div>
            <div style={S.campo}>
              <div style={S.label}>Horario</div>
              <div style={S.value}>
                {formatearHora(proximoTurno.hora_inicio)} – {formatearHora(proximoTurno.hora_fin)}
              </div>
            </div>
            <div style={S.campo}>
              <div style={S.label}>Objetivo</div>
              <div style={S.value}>{proximoTurno.objetivo_nombre ?? '—'}</div>
            </div>
          </div>
        ) : (
          <div style={{ color: '#64748b', fontSize: 14 }}>Sin turnos próximos programados.</div>
        )}
      </div>

      {/* Novedad vigente */}
      {novedadVigente && (
        <div style={{ ...S.card, borderColor: '#f59e0b44' }}>
          <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600, marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Novedad laboral vigente
          </div>
          <div style={S.grid2}>
            <div style={S.campo}>
              <div style={S.label}>Tipo</div>
              <div style={S.value}>{TIPOS_NOVEDAD[novedadVigente.tipo] ?? novedadVigente.tipo}</div>
            </div>
            <div style={S.campo}>
              <div style={S.label}>Período</div>
              <div style={S.value}>
                {formatearFecha(novedadVigente.fecha_desde)} – {formatearFecha(novedadVigente.fecha_hasta)}
              </div>
            </div>
            {novedadVigente.observacion && (
              <div style={{ ...S.campo, gridColumn: '1 / -1' }}>
                <div style={S.label}>Observación</div>
                <div style={{ ...S.value, color: '#94a3b8', fontSize: 14 }}>{novedadVigente.observacion}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
