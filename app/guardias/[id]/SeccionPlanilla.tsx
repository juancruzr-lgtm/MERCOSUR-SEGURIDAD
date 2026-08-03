'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { track } from '@/lib/telemetry'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface FilaPlanilla {
  fecha: string
  dia_semana: string
  hora_entrada: string | null
  hora_salida: string | null
  horas: number
  objetivo_id: string | null
  objetivo_nombre: string | null
  estado?: 'trabajado' | 'en_curso' | 'programado' | 'sin_programacion'
}

interface DatosPlanilla {
  filas: FilaPlanilla[]
  total_horas: number
  mes: string
  desde: string
  hasta: string
}

interface OpcionMes {
  valor: string
  label: string
  sublabel: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MESES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function mesActualCliente(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 7)
}

function mesAnteriorCliente(mesActual: string): string {
  const [y, m] = mesActual.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function labelMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  return `${MESES_ES[m - 1]} ${y}`
}

function formatearFecha(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function formatearHoras(h: number): string {
  if (h <= 0) return '—'
  // Enteros sin decimales, fracciones con dos decimales
  return h % 1 < 0.005 ? String(Math.round(h)) : h.toFixed(2)
}

// ── Estilos ───────────────────────────────────────────────────────────────────

const S = {
  selector: {
    display: 'flex',
    gap: 8,
    marginBottom: 20,
    flexWrap: 'wrap' as const,
  } as React.CSSProperties,
  selectorBtn: (activo: boolean): React.CSSProperties => ({
    padding: '8px 16px',
    borderRadius: 8,
    border: activo ? '1px solid #f59e0b' : '1px solid #334155',
    background: activo ? '#f59e0b18' : 'none',
    color: activo ? '#f59e0b' : '#94a3b8',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: activo ? 600 : 400,
    textAlign: 'left' as const,
  }),
  selectorSub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  } as React.CSSProperties,
  tableWrap: {
    overflowX: 'auto' as const,
    borderRadius: 10,
    border: '1px solid #1e2d42',
    marginBottom: 16,
  } as React.CSSProperties,
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 13,
    minWidth: 520,
  } as React.CSSProperties,
  th: {
    background: '#111827',
    color: '#64748b',
    fontWeight: 600,
    fontSize: 11,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    padding: '10px 14px',
    textAlign: 'left' as const,
    borderBottom: '1px solid #1e2d42',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  td: (ultimo: boolean): React.CSSProperties => ({
    padding: '10px 14px',
    borderBottom: ultimo ? 'none' : '1px solid #0f1929',
    color: '#e2e8f0',
    whiteSpace: 'nowrap' as const,
    verticalAlign: 'middle',
  }),
  tdHoras: (ultimo: boolean): React.CSSProperties => ({
    padding: '10px 14px',
    borderBottom: ultimo ? 'none' : '1px solid #0f1929',
    color: '#f59e0b',
    fontWeight: 700,
    fontFamily: 'Syne, sans-serif',
    whiteSpace: 'nowrap' as const,
  }),
  tdObjetivo: (ultimo: boolean): React.CSSProperties => ({
    padding: '10px 14px',
    borderBottom: ultimo ? 'none' : '1px solid #0f1929',
    color: '#94a3b8',
    maxWidth: 200,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  }),
  trPar: {
    background: '#0d1526',
  } as React.CSSProperties,
  trImpar: {
    background: '#111827',
  } as React.CSSProperties,
  total: {
    background: '#111827',
    border: '1px solid #1e2d42',
    borderRadius: 10,
    padding: '16px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  } as React.CSSProperties,
  totalLabel: {
    fontSize: 12,
    color: '#64748b',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    fontWeight: 600,
  } as React.CSSProperties,
  totalValue: {
    fontSize: 22,
    fontWeight: 800,
    color: '#f59e0b',
    fontFamily: 'Syne, sans-serif',
  } as React.CSSProperties,
  aclaracion: {
    fontSize: 12,
    color: '#475569',
    textAlign: 'center' as const,
    paddingTop: 4,
    paddingBottom: 8,
  } as React.CSSProperties,
  empty: {
    textAlign: 'center' as const,
    color: '#475569',
    padding: '48px 0',
    fontSize: 14,
  } as React.CSSProperties,
  cargando: {
    textAlign: 'center' as const,
    color: '#64748b',
    padding: '48px 0',
    fontSize: 14,
  } as React.CSSProperties,
  error: {
    textAlign: 'center' as const,
    color: '#ef4444',
    padding: '48px 0',
    fontSize: 14,
  } as React.CSSProperties,
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function SeccionPlanilla({ empleadoId }: { empleadoId: string }) {
  const mesActual = mesActualCliente()
  const mesAnterior = mesAnteriorCliente(mesActual)

  const opciones: OpcionMes[] = [
    { valor: mesActual,   label: labelMes(mesActual),   sublabel: 'En curso' },
    { valor: mesAnterior, label: labelMes(mesAnterior), sublabel: 'Mes anterior' },
  ]

  const [mesSeleccionado, setMesSeleccionado] = useState<string>(mesActual)
  const [datos, setDatos] = useState<DatosPlanilla | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Protección StrictMode — un evento por carga real
  const telemetriaIniciada = useRef(false)
  const cargaRegistrada = useRef(false)

  // Inicializar telemetría una sola vez
  useEffect(() => {
    if (telemetriaIniciada.current || !empleadoId) return
    telemetriaIniciada.current = true
    track('legajo_planilla_abierta', {
      screen: 'legajo_empleado',
      screen_section: 'planilla',
      category: 'guardia',
      value_json: { empleado_id: empleadoId },
    })
  }, [empleadoId])

  useEffect(() => {
    if (!empleadoId) return
    let activo = true
    cargaRegistrada.current = false

    const cargar = async () => {
      setCargando(true)
      setError(null)

      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) return

      const t0 = Date.now()
      try {
        const res = await fetch(`/api/legajo/${empleadoId}/planilla?mes=${mesSeleccionado}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const json = await res.json()

        if (!activo) return

        if (!res.ok) {
          setError(json.error ?? 'Error al cargar la planilla')
          if (!cargaRegistrada.current) {
            cargaRegistrada.current = true
            track('legajo_planilla_error', {
              screen: 'legajo_empleado',
              screen_section: 'planilla',
              category: 'guardia',
              err_message: json.error ?? 'Error desconocido',
              err_code: String(res.status),
              value_json: { empleado_id: empleadoId, mes: mesSeleccionado },
            })
          }
        } else {
          setDatos(json)
          if (!cargaRegistrada.current) {
            cargaRegistrada.current = true
            track('legajo_planilla_cargada', {
              screen: 'legajo_empleado',
              screen_section: 'planilla',
              category: 'guardia',
              duration_ms: Date.now() - t0,
              value_json: {
                empleado_id: empleadoId,
                mes: mesSeleccionado,
                filas: json.filas?.length ?? 0,
                total_horas: json.total_horas ?? 0,
              },
            })
          }
        }
      } catch (e) {
        if (!activo) return
        const msg = e instanceof Error ? e.message : 'Error de red'
        setError(msg)
        if (!cargaRegistrada.current) {
          cargaRegistrada.current = true
          track('legajo_planilla_error', {
            screen: 'legajo_empleado',
            screen_section: 'planilla',
            category: 'guardia',
            err_message: msg,
            value_json: { empleado_id: empleadoId, mes: mesSeleccionado },
          })
        }
      } finally {
        if (activo) setCargando(false)
      }
    }

    void cargar()
    return () => { activo = false }
  }, [empleadoId, mesSeleccionado])

  const cambiarMes = (mes: string) => {
    if (mes === mesSeleccionado) return
    setMesSeleccionado(mes)
    track('legajo_planilla_mes_cambiado', {
      screen: 'legajo_empleado',
      screen_section: 'planilla',
      category: 'guardia',
      value_json: { empleado_id: empleadoId, mes },
    })
  }

  return (
    <div>
      {/* Selector de período */}
      <div style={S.selector}>
        {opciones.map(op => (
          <button
            key={op.valor}
            style={S.selectorBtn(mesSeleccionado === op.valor)}
            onClick={() => cambiarMes(op.valor)}
          >
            <div>{op.label}</div>
            <div style={S.selectorSub}>{op.sublabel}</div>
          </button>
        ))}
      </div>

      {/* Estado de carga */}
      {cargando && (
        <div style={S.cargando}>Cargando planilla...</div>
      )}

      {/* Error */}
      {!cargando && error && (
        <div style={S.error}>{error}</div>
      )}

      {/* Sin datos */}
      {!cargando && !error && datos && datos.filas.length === 0 && (
        <div style={S.empty}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
          <div>No hay turnos registrados en este período.</div>
        </div>
      )}

      {/* Planilla */}
      {!cargando && !error && datos && datos.filas.length > 0 && (
        <>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Fecha</th>
                  <th style={S.th}>Día</th>
                  <th style={S.th}>Entrada</th>
                  <th style={S.th}>Salida</th>
                  <th style={S.th}>Horas</th>
                  <th style={S.th}>Objetivo</th>
                </tr>
              </thead>
              <tbody>
                {datos.filas.map((fila, i) => {
                  const ultimo = i === datos.filas.length - 1
                  const esSinProg = fila.estado === 'sin_programacion'
                  const esProgramado = fila.estado === 'programado'
                  const opacidad = esSinProg ? 0.4 : esProgramado ? 0.6 : 1
                  const estilo = { ...(i % 2 === 0 ? S.trImpar : S.trPar), opacity: opacidad }
                  return (
                    <tr key={`${fila.fecha}-${fila.hora_entrada ?? 'sp'}`} style={estilo}>
                      <td style={S.td(ultimo)}>{formatearFecha(fila.fecha)}</td>
                      <td style={{ ...S.td(ultimo), color: '#64748b' }}>{fila.dia_semana}</td>
                      <td style={S.td(ultimo)}>
                        {esSinProg
                          ? <span style={{ color: '#475569', fontSize: 11, fontStyle: 'italic' }}>SIN PROGRAMACIÓN</span>
                          : esProgramado
                            ? <span style={{ color: '#64748b', fontSize: 11 }}>{fila.hora_entrada ?? '—'}</span>
                            : fila.hora_entrada ?? '—'}
                      </td>
                      <td style={S.td(ultimo)}>
                        {esSinProg ? '—'
                          : esProgramado
                            ? <span style={{ color: '#64748b', fontSize: 11 }}>{fila.hora_salida ?? '—'}</span>
                            : fila.estado === 'en_curso'
                              ? <span style={{ color: '#f59e0b', fontSize: 11 }}>En curso</span>
                              : fila.hora_salida ?? '—'}
                      </td>
                      <td style={S.tdHoras(ultimo)}>{esSinProg || esProgramado ? '—' : formatearHoras(fila.horas)}</td>
                      <td style={S.tdObjetivo(ultimo)}>{esProgramado ? <span style={{ fontStyle: 'italic' }}>{fila.objetivo_nombre ?? '—'}</span> : (fila.objetivo_nombre ?? '—')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Total */}
          <div style={S.total}>
            <div style={S.totalLabel}>Total de horas</div>
            <div style={S.totalValue}>{formatearHoras(datos.total_horas)} hs</div>
          </div>
          <div style={S.aclaracion}>
            {datos.filas.filter(f => f.estado === 'trabajado' || f.estado === 'en_curso').length} {datos.filas.filter(f => f.estado === 'trabajado' || f.estado === 'en_curso').length === 1 ? 'día trabajado' : 'días trabajados'} ·{' '}
            {datos.filas.filter(f => f.estado === 'programado').length > 0 ? `${datos.filas.filter(f => f.estado === 'programado').length} programado(s) sin fichar · ` : ''}
            {labelMes(datos.mes)}
          </div>
        </>
      )}
    </div>
  )
}
