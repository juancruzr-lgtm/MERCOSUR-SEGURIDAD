'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { registroTieneEntradaConfirmada } from '@/lib/turnos'
import { track, initTelemetry } from '@/lib/telemetry'
import { formatCuil } from '@/lib/revision-operativa'
import SeccionTurnos from './SeccionTurnos'
import SeccionPlanilla from './SeccionPlanilla'
import FichaCumplimiento from '@/components/cumplimiento/FichaCumplimiento'
import MiDesempeno from '@/components/desempeno/MiDesempeno'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface DatosEmpleado {
  id: string
  nombre: string
  apellido: string
  legajo: string | null
  cuil?: string | null
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
  { id: 'planilla', label: 'Mi Planilla' },
  { id: 'cumplimiento', label: 'Cumplimiento operativo' },
  { id: 'novedades', label: 'Novedades laborales' },
  { id: 'desempeno', label: 'Mi Desempeño' },
  { id: 'documentacion', label: 'Documentación' },
  { id: 'historial', label: 'Historial' },
  { id: 'indicadores', label: 'Indicadores' },
] as const

type SeccionId = (typeof SECCIONES)[number]['id']

/**
 * Sección con la que abre el legajo, tomada de `?seccion=`.
 *
 * El legajo abría siempre en "Situación actual". El cartel de Mi Planilla —
 * "Tenés N turnos sin revisar · Tocá para revisarlos"— mandaba a /guardias/{id}
 * a secas, así que el vigilador caía en una pantalla donde no hay nada para
 * aceptar y tenía que adivinar que la acción estaba detrás de otra pestaña.
 * Por eso el circuito de aceptación quedó sin uso: no es que los botones no
 * estén, es que nadie llegaba hasta ellos.
 */
function seccionInicial(valor: string | null): SeccionId {
  const existe = SECCIONES.some(s => s.id === valor)
  return existe ? (valor as SeccionId) : 'situacion'
}

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
  const searchParams = useSearchParams()
  const empleadoId = typeof params.id === 'string' ? params.id : ''

  const [datos, setDatos] = useState<DatosLegajo | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [seccion, setSeccion] = useState<SeccionId>(() => seccionInicial(searchParams.get('seccion')))
  const [rolUsuario, setRolUsuario] = useState<string | null>(null)
  // Id del usuario que MIRA, no del legajo. Lo necesita cargarFilasBandeja
  // para resolver su alcance por zona.
  const [usuarioId, setUsuarioId] = useState<string | null>(null)

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

          const rol = perfil.rol ?? 'admin'
          setRolUsuario(rol)
          setUsuarioId(perfil.id)
          void initTelemetry(perfil.id, rol as any)
          track('legajo_abierto', {
            screen: 'legajo_empleado',
            category: rol === 'admin' ? 'admin' : 'guardia',
            value_json: { empleado_id: empleadoId, rol_solicitante: rol },
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
              category: rolUsuario === 'admin' ? 'admin' : 'guardia',
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
    if (id === seccion) return
    setSeccion(id)
    track('legajo_seccion_abierta', {
      screen: 'legajo_empleado',
      screen_section: id,
      category: rolUsuario === 'admin' ? 'admin' : 'guardia',
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
  // Supervisión también usa el Cumplimiento —es un usuario interno del puntaje—
  // pero sólo ve a los empleados de sus zonas. El recorte no se decide acá: lo
  // aplica cargarFilasBandeja con el mismo objetivoEnAlcance que usa toda la app,
  // así que no hay una segunda regla de autorización que pueda contradecir a la
  // primera. Un supervisor sin zonas no ve a nadie.
  const esSupervision = esAdmin || rolUsuario === 'supervisor'

  // ── Render: encabezado ────────────────────────────────────────────────────
  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <button style={S.backBtn} onClick={() => router.push('/dashboard')}>
          {esAdmin ? '← Guardias' : '← Volver'}
        </button>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>
            {empleado.nombre} {empleado.apellido}
          </div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
            Legajo:{' '}
            <span style={{ fontWeight: 700, color: '#f59e0b', fontFamily: 'Syne, sans-serif' }}>
              {empleado.cuil ? formatCuil(empleado.cuil) : (empleado.legajo ?? '—')}
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

        {seccion === 'turnos' && (
          <SeccionTurnos empleadoId={empleadoId} />
        )}

        {seccion === 'planilla' && (
          <SeccionPlanilla empleadoId={empleadoId} />
        )}

        {/* Administracion y Supervision. El vigilador NO ve su puntaje ni sus
            incidencias: hasta validar que la evaluacion completa es justa,
            mostrarsela seria pedirle que se defienda de un numero que todavia no
            cubre su trabajo. Lo que si puede recibir son instrucciones concretas
            sobre que corregir, y eso viaja por otro lado. */}
        {seccion === 'cumplimiento' && (
          esSupervision
            ? <FichaCumplimiento empleadoId={empleadoId} esAdmin={esAdmin} usuarioId={usuarioId} />
            : <div style={S.placeholder}>Esta seccion es de uso interno de Administracion y Supervision.</div>
        )}

        {/* La evaluación mensual, como la lee la persona.
            Ocupa la pestaña que decía "Reporte mensual" y nunca mostró nada.

            No hay chequeo de rol acá a propósito: lo hace RLS. El vigilador
            sólo puede leer su propia fila y sólo publicada; Administración y
            Supervisión leen dentro de su alcance. Un `if` en el frontend sería
            una segunda regla de autorización que podría contradecir a la
            primera, y la que manda es la de la base. */}
        {seccion === 'desempeno' && (
          <MiDesempeno empleadoId={empleadoId} />
        )}

        {seccion !== 'situacion' && seccion !== 'turnos' && seccion !== 'planilla'
          && seccion !== 'cumplimiento' && seccion !== 'desempeno' && (
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
