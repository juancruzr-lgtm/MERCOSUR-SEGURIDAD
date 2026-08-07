'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { esTurnoNocturno } from '@/lib/turnos'
import { track } from '@/lib/telemetry'

// ── Tipos ─────────────────────────────────────────────────────────────────────

type TipoCobertura =
  | 'programado'
  | 'programado_y_cubierto'
  | 'programado_sin_asistencia'
  | 'programado_pero_reemplazado'
  | 'reasignado'
  | 'reemplazo'

interface TurnoLegajo {
  id: string
  fecha: string
  hora_inicio: string
  hora_fin: string
  estado: string
  objetivo_id: string
  objetivo_nombre: string | null
  puesto_id: string | null
  puesto_nombre: string | null
  tipo_cobertura: TipoCobertura
  /** Turno de un objetivo de prueba: se muestra igual, pero marcado. */
  objetivo_es_prueba?: boolean
}

interface RespuestaTurnos {
  proximos: TurnoLegajo[]
  historial: TurnoLegajo[]
  total: number
  rango: { desde: string; hasta: string }
}

// ── Helpers de período ────────────────────────────────────────────────────────

function mesActual(): string {
  const ahora = new Date(Date.now() - 3 * 60 * 60 * 1000) // UTC-3
  return ahora.toISOString().slice(0, 7)
}

function opcionesMes(): { value: string; label: string }[] {
  const base = mesActual()
  const [y, m] = base.split('-').map(Number)
  const opciones = []
  // 3 meses anteriores, mes actual, 2 meses siguientes
  for (let delta = -3; delta <= 2; delta++) {
    const d = new Date(y, m - 1 + delta, 1)
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
    opciones.push({ value: val, label: label.charAt(0).toUpperCase() + label.slice(1) })
  }
  return opciones
}

function formatearFecha(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function diaSemana(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const fecha = new Date(y, m - 1, d)
  return fecha.toLocaleDateString('es-AR', { weekday: 'short' })
}

function formatearHora(h: string): string {
  return h.slice(0, 5)
}

// ── Colores por estado ────────────────────────────────────────────────────────

const COLORES_ESTADO: Record<string, string> = {
  cubierto:    '#22c55e',
  programado:  '#60a5fa',
  descubierto: '#ef4444',
}

function colorEstado(estado: string): string {
  return COLORES_ESTADO[estado] ?? '#94a3b8'
}

// ── Estilos ───────────────────────────────────────────────────────────────────

const S = {
  filtros: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 8,
    marginBottom: 20,
    alignItems: 'center',
  } as React.CSSProperties,
  select: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 6,
    color: '#e2e8f0',
    fontSize: 13,
    padding: '6px 10px',
  } as React.CSSProperties,
  seccionLabel: {
    fontSize: 11,
    color: '#f59e0b',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: 10,
    marginTop: 8,
  } as React.CSSProperties,
  card: {
    background: '#111827',
    border: '1px solid #1e2d42',
    borderRadius: 8,
    padding: '14px 16px',
    marginBottom: 8,
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    gap: '4px 12px',
    alignItems: 'start',
  } as React.CSSProperties,
  fecha: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: 600,
    gridRow: '1 / 3',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    minWidth: 48,
    paddingTop: 2,
  } as React.CSSProperties,
  fechaDia: {
    fontSize: 10,
    color: '#64748b',
    textTransform: 'uppercase' as const,
  } as React.CSSProperties,
  fechaNum: {
    fontSize: 22,
    fontWeight: 700,
    color: '#e2e8f0',
    lineHeight: 1.1,
  } as React.CSSProperties,
  fechaMes: {
    fontSize: 10,
    color: '#64748b',
    textTransform: 'uppercase' as const,
  } as React.CSSProperties,
  objetivo: {
    fontSize: 14,
    fontWeight: 600,
    color: '#e2e8f0',
  } as React.CSSProperties,
  detalle: {
    fontSize: 12,
    color: '#64748b',
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap' as const,
    alignItems: 'center',
  } as React.CSSProperties,
  badge: (color: string): React.CSSProperties => ({
    display: 'inline-block',
    padding: '1px 7px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    background: color + '20',
    color,
    border: `1px solid ${color}40`,
  }),
  badgeNocturno: {
    display: 'inline-block',
    padding: '1px 6px',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    background: '#6366f120',
    color: '#818cf8',
    border: '1px solid #6366f140',
  } as React.CSSProperties,
  badgeCobertura: (color: string): React.CSSProperties => ({
    display: 'inline-block',
    padding: '1px 6px',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    background: color + '20',
    color,
    border: `1px solid ${color}40`,
  }),
  empty: {
    textAlign: 'center' as const,
    color: '#475569',
    padding: '32px 0',
    fontSize: 13,
  } as React.CSSProperties,
  resumen: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: 10,
    marginBottom: 20,
  } as React.CSSProperties,
  resumenCard: {
    background: '#111827',
    border: '1px solid #1e2d42',
    borderRadius: 8,
    padding: '12px 14px',
  } as React.CSSProperties,
  resumenLabel: {
    fontSize: 10,
    color: '#64748b',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  } as React.CSSProperties,
  resumenValor: {
    fontSize: 22,
    fontWeight: 700,
    color: '#f59e0b',
    marginTop: 2,
  } as React.CSSProperties,
  resumenSub: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  } as React.CSSProperties,
}

// ── Tarjeta de turno ──────────────────────────────────────────────────────────

// Etiqueta y color para cada tipo de cobertura en historial
const COBERTURA_BADGE: Partial<Record<TipoCobertura, { label: string; color: string }>> = {
  programado_y_cubierto:       { label: 'cubierto',    color: '#22c55e' },
  programado_sin_asistencia:   { label: 'sin fichar',  color: '#f59e0b' },
  programado_pero_reemplazado: { label: 'reemplazado', color: '#f97316' },
  reasignado:                  { label: 'reasignado',  color: '#78716c' },
  reemplazo:                   { label: 'reemplazo',   color: '#38bdf8' },
}

function TarjetaTurno({ turno }: { turno: TurnoLegajo }) {
  const [dd, mm, yy] = formatearFecha(turno.fecha).split('/')
  const nocturno = esTurnoNocturno(turno)
  const colorE = colorEstado(turno.estado)
  const cobertura = COBERTURA_BADGE[turno.tipo_cobertura]

  // Reasignados y reemplazados se muestran con menor prominencia
  const atenuado =
    turno.tipo_cobertura === 'reasignado' ||
    turno.tipo_cobertura === 'programado_pero_reemplazado'

  return (
    <div style={{ ...S.card, opacity: atenuado ? 0.72 : 1 }}>
      {/* Columna fecha */}
      <div style={S.fecha}>
        <span style={S.fechaDia}>{diaSemana(turno.fecha)}</span>
        <span style={S.fechaNum}>{dd}</span>
        <span style={S.fechaMes}>{mm}/{yy.slice(2)}</span>
      </div>

      {/* Columna principal */}
      <div>
        <div style={S.objetivo}>
          {turno.objetivo_nombre ?? '—'}
          {turno.objetivo_es_prueba && (
            <span
              title="Objetivo de prueba: no cuenta para las horas del mes"
              style={{
                marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: .04,
                textTransform: 'uppercase', color: '#f59e0b',
                background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.35)',
                borderRadius: 4, padding: '1px 5px', verticalAlign: 'middle',
              }}
            >
              Prueba
            </span>
          )}
        </div>
        <div style={S.detalle}>
          <span>{formatearHora(turno.hora_inicio)} – {formatearHora(turno.hora_fin)}</span>
          {turno.puesto_nombre && <span>· {turno.puesto_nombre}</span>}
        </div>
      </div>

      {/* Columna badges */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
        <span style={S.badge(colorE)}>{turno.estado}</span>
        {nocturno && <span style={S.badgeNocturno}>nocturno</span>}
        {cobertura && (
          <span style={S.badgeCobertura(cobertura.color)}>{cobertura.label}</span>
        )}
      </div>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function SeccionTurnos({ empleadoId }: { empleadoId: string }) {
  const [datos, setDatos] = useState<RespuestaTurnos | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mes, setMes] = useState(mesActual)
  const [filtroEstado, setFiltroEstado] = useState('')
  const [filtroObjetivo, setFiltroObjetivo] = useState('')

  // Previene doble disparo en StrictMode
  const cargaRegistrada = useRef(false)
  const esPrimeraCarga  = useRef(true)

  const opciones = opcionesMes()

  // Objetivos únicos para el selector de filtro
  const objetivosUnicos: { id: string; nombre: string }[] = datos
    ? Array.from(
        new Map(
          [...datos.proximos, ...datos.historial]
            .filter(t => t.objetivo_id && t.objetivo_nombre)
            .map(t => [t.objetivo_id, { id: t.objetivo_id, nombre: t.objetivo_nombre! }])
        ).values()
      )
    : []

  const cargar = useCallback(async (mesCargando: string, esFiltro = false) => {
    setCargando(true)
    setError(null)
    cargaRegistrada.current = false

    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData?.session?.access_token
    if (!token) return

    const params = new URLSearchParams({ mes: mesCargando })
    if (filtroEstado)   params.set('estado', filtroEstado)
    if (filtroObjetivo) params.set('objetivo_id', filtroObjetivo)

    const t0 = Date.now()
    try {
      const res = await fetch(`/api/legajo/${empleadoId}/turnos?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()

      if (!res.ok) {
        setError(json.error ?? 'Error al cargar turnos')
        if (!cargaRegistrada.current) {
          cargaRegistrada.current = true
          track('legajo_turnos_error', {
            screen: 'legajo_empleado',
            screen_section: 'turnos',
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
          if (esFiltro) {
            track('legajo_turnos_filtro_aplicado', {
              screen: 'legajo_empleado',
              screen_section: 'turnos',
              category: 'admin',
              duration_ms: Date.now() - t0,
              value_json: {
                empleado_id: empleadoId,
                mes: mesCargando,
                estado: filtroEstado || null,
                objetivo_id: filtroObjetivo || null,
                cantidad: json.total ?? 0,
              },
            })
          } else {
            track('legajo_turnos_cargados', {
              screen: 'legajo_empleado',
              screen_section: 'turnos',
              category: 'admin',
              duration_ms: Date.now() - t0,
              value_json: {
                empleado_id: empleadoId,
                mes: mesCargando,
                cantidad: json.total ?? 0,
              },
            })
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error de red'
      setError(msg)
      if (!cargaRegistrada.current) {
        cargaRegistrada.current = true
        track('legajo_turnos_error', {
          screen: 'legajo_empleado',
          screen_section: 'turnos',
          category: 'error',
          err_message: msg,
          value_json: { empleado_id: empleadoId },
        })
      }
    } finally {
      setCargando(false)
    }
  }, [empleadoId, filtroEstado, filtroObjetivo])

  // Carga inicial al montar
  useEffect(() => {
    void cargar(mes, false)
    esPrimeraCarga.current = false
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empleadoId])

  // Re-carga cuando cambian filtros (no en la primera carga)
  useEffect(() => {
    if (esPrimeraCarga.current) return
    void cargar(mes, true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes, filtroEstado, filtroObjetivo])

  // ── Aplicar filtros en cliente sobre los datos ya cargados ─────────────────
  // (el servidor ya filtró por mes, estado, objetivo_id si se pasaron)
  // Se muestran directamente sin filtrado adicional.

  const hoy = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const proximos  = datos?.proximos  ?? []
  const historial = datos?.historial ?? []

  // Resumen
  const primerProximo   = proximos[0] ?? null
  const ultimoRealizado = historial[historial.length - 1] ?? null
  const totalProximos   = proximos.length
  const totalHistorial  = historial.filter(t => t.fecha.startsWith(mes)).length

  return (
    <div>
      {/* Resumen */}
      {!cargando && datos && (
        <div style={S.resumen}>
          <div style={S.resumenCard}>
            <div style={S.resumenLabel}>Próximos</div>
            <div style={S.resumenValor}>{totalProximos}</div>
            {primerProximo && (
              <div style={S.resumenSub}>
                Próximo: {formatearFecha(primerProximo.fecha)}
              </div>
            )}
          </div>
          <div style={S.resumenCard}>
            <div style={S.resumenLabel}>Este mes</div>
            <div style={S.resumenValor}>{totalHistorial}</div>
            {ultimoRealizado && (
              <div style={S.resumenSub}>
                Último: {formatearFecha(ultimoRealizado.fecha)}
              </div>
            )}
          </div>
          <div style={S.resumenCard}>
            <div style={S.resumenLabel}>Total período</div>
            <div style={S.resumenValor}>{datos.total}</div>
            <div style={S.resumenSub}>{datos.rango.desde} – {datos.rango.hasta}</div>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={S.filtros}>
        <select
          style={S.select}
          value={mes}
          onChange={e => setMes(e.target.value)}
          aria-label="Mes"
        >
          {opciones.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          style={S.select}
          value={filtroEstado}
          onChange={e => setFiltroEstado(e.target.value)}
          aria-label="Estado"
        >
          <option value="">Todos los estados</option>
          <option value="programado">Programado</option>
          <option value="cubierto">Cubierto</option>
          <option value="descubierto">Descubierto</option>
        </select>

        {objetivosUnicos.length > 1 && (
          <select
            style={S.select}
            value={filtroObjetivo}
            onChange={e => setFiltroObjetivo(e.target.value)}
            aria-label="Objetivo"
          >
            <option value="">Todos los objetivos</option>
            {objetivosUnicos.map(o => (
              <option key={o.id} value={o.id}>{o.nombre}</option>
            ))}
          </select>
        )}
      </div>

      {/* Estados de carga y error */}
      {cargando && (
        <div style={S.empty}>Cargando turnos...</div>
      )}

      {!cargando && error && (
        <div style={{ ...S.empty, color: '#ef4444' }}>{error}</div>
      )}

      {/* Listado */}
      {!cargando && !error && (
        <>
          {/* Próximos */}
          {proximos.length > 0 && (
            <div>
              <div style={S.seccionLabel}>Próximos turnos</div>
              {proximos.map(t => <TarjetaTurno key={t.id} turno={t} />)}
            </div>
          )}

          {/* Historial */}
          {historial.length > 0 && (
            <div>
              <div style={{ ...S.seccionLabel, marginTop: proximos.length > 0 ? 20 : 0 }}>
                Historial
              </div>
              {[...historial].reverse().map(t => <TarjetaTurno key={t.id} turno={t} />)}
            </div>
          )}

          {/* Vacío */}
          {proximos.length === 0 && historial.length === 0 && (
            <div style={S.empty}>
              {filtroEstado || filtroObjetivo
                ? 'No hay turnos para los filtros seleccionados.'
                : 'No hay turnos para el período seleccionado.'}
            </div>
          )}
        </>
      )}
    </div>
  )
}
