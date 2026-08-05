'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { track } from '@/lib/telemetry'
import { etiquetaCaracteristica } from '@/lib/caracteristica-turno'
import { ETIQUETA_PRIMER_CONTROL, ETIQUETA_SALIDA_AUTOMATICA } from '@/lib/primer-control'
import type { EstadoPrimerControl } from '@/lib/primer-control'

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
  caracteristica?: 'normal' | 'cobertura' | 'capacitacion' | null
  turno_id?: string | null
  puesto_nombre?: string | null
  salida_automatica?: boolean
  estado_control?: EstadoPrimerControl | null
}

interface DatosPlanilla {
  filas: FilaPlanilla[]
  total_horas: number
  mes: string
  desde: string
  hasta: string
  es_titular?: boolean
  pendientes_revision?: number
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
  // Primer control del vigilador
  const [recargas, setRecargas] = useState(0)
  const [accionando, setAccionando] = useState<string | null>(null)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)
  const [filaSolicitud, setFilaSolicitud] = useState<FilaPlanilla | null>(null)
  const [textoSolicitud, setTextoSolicitud] = useState('')
  const [enviandoSolicitud, setEnviandoSolicitud] = useState(false)

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
  }, [empleadoId, mesSeleccionado, recargas])

  // Releer la respuesta autoritativa del servidor después de cada acción
  const recargarPlanilla = () => setRecargas(v => v + 1)

  const aceptarTurno = async (fila: FilaPlanilla) => {
    if (!fila.turno_id || accionando) return
    setAccionando(fila.turno_id)
    setErrorAccion(null)
    try {
      const { error: rpcError } = await supabase.rpc('aceptar_turno_planilla', {
        p_turno_id: fila.turno_id,
      })
      if (rpcError) throw new Error(rpcError.message)
      track('planilla_turno_aceptado', {
        screen: 'legajo_empleado',
        screen_section: 'planilla',
        category: 'guardia',
        value_json: { empleado_id: empleadoId, turno_id: fila.turno_id, salida_automatica: Boolean(fila.salida_automatica) },
      })
      recargarPlanilla()
    } catch (e) {
      setErrorAccion(e instanceof Error ? e.message : 'No se pudo registrar la aceptación')
    } finally {
      setAccionando(null)
    }
  }

  const enviarSolicitud = async () => {
    if (!filaSolicitud?.turno_id || enviandoSolicitud) return
    if (textoSolicitud.trim().length < 3) {
      setErrorAccion('Debe indicar qué desea modificar')
      return
    }
    setEnviandoSolicitud(true)
    setErrorAccion(null)
    try {
      const { error: rpcError } = await supabase.rpc('solicitar_modificacion_planilla', {
        p_turno_id: filaSolicitud.turno_id,
        p_texto: textoSolicitud.trim(),
      })
      if (rpcError) throw new Error(rpcError.message)
      track('planilla_modificacion_solicitada', {
        screen: 'legajo_empleado',
        screen_section: 'planilla',
        category: 'guardia',
        value_json: { empleado_id: empleadoId, turno_id: filaSolicitud.turno_id },
      })
      setFilaSolicitud(null)
      setTextoSolicitud('')
      recargarPlanilla()
    } catch (e) {
      setErrorAccion(e instanceof Error ? e.message : 'No se pudo enviar la solicitud')
    } finally {
      setEnviandoSolicitud(false)
    }
  }

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
                  <th style={S.th}>Puesto</th>
                  <th style={S.th}>Tipo</th>
                  <th style={S.th}>Revisión</th>
                </tr>
              </thead>
              <tbody>
                {datos.filas.map((fila, i) => {
                  const ultimo = i === datos.filas.length - 1
                  const esSinProg = fila.estado === 'sin_programacion'
                  const esProgramado = fila.estado === 'programado'
                  const opacidad = esSinProg ? 0.4 : esProgramado ? 0.6 : 1
                  const conSalidaAuto = Boolean(fila.salida_automatica)
                  const estilo = {
                    ...(i % 2 === 0 ? S.trImpar : S.trPar),
                    opacity: opacidad,
                    ...(conSalidaAuto && fila.estado_control === 'pendiente' ? { background: '#f59e0b10' } : {}),
                  }
                  const mostrarBotones = Boolean(
                    datos.es_titular &&
                    fila.estado === 'trabajado' &&
                    fila.estado_control === 'pendiente' &&
                    fila.turno_id
                  )
                  return (
                    <tr key={`${fila.fecha}-${fila.hora_entrada ?? 'sp'}-${fila.turno_id ?? i}`} style={estilo}>
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
                              : (
                                <>
                                  {fila.hora_salida ?? '—'}
                                  {conSalidaAuto && (
                                    <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#f59e0b', border: '1px solid #f59e0b55', borderRadius: 4, padding: '1px 4px', textTransform: 'uppercase' as const }} title={ETIQUETA_SALIDA_AUTOMATICA}>auto</span>
                                  )}
                                </>
                              )}
                      </td>
                      <td style={S.tdHoras(ultimo)}>{esSinProg || esProgramado ? '—' : formatearHoras(fila.horas)}</td>
                      <td style={S.tdObjetivo(ultimo)}>{esProgramado ? <span style={{ fontStyle: 'italic' }}>{fila.objetivo_nombre ?? '—'}</span> : (fila.objetivo_nombre ?? '—')}</td>
                      <td style={{ ...S.td(ultimo), color: '#94a3b8', fontSize: 12 }}>{fila.puesto_nombre ?? '—'}</td>
                      <td style={S.td(ultimo)}>
                        {esSinProg || !fila.caracteristica ? '—'
                          : fila.caracteristica === 'normal'
                            ? <span style={{ color: '#64748b', fontSize: 11 }}>{etiquetaCaracteristica(fila.caracteristica)}</span>
                            : <span style={{ color: fila.caracteristica === 'capacitacion' ? '#a78bfa' : '#38bdf8', fontSize: 11, fontWeight: 600 }}>{etiquetaCaracteristica(fila.caracteristica)}</span>}
                      </td>
                      <td style={S.td(ultimo)}>
                        {fila.estado_control == null ? '—'
                          : fila.estado_control === 'aceptado'
                            ? <span style={{ color: '#10b981', fontSize: 11, fontWeight: 600 }}>✓ {ETIQUETA_PRIMER_CONTROL.aceptado}</span>
                            : fila.estado_control === 'modificacion_solicitada'
                              ? <span style={{ color: '#f59e0b', fontSize: 11, fontWeight: 600 }}>{ETIQUETA_PRIMER_CONTROL.modificacion_solicitada}</span>
                              : mostrarBotones
                                ? (
                                  <span style={{ display: 'inline-flex', gap: 6 }}>
                                    <button
                                      style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #16653488', background: '#14532d', color: '#4ade80', fontSize: 11, fontWeight: 600, cursor: 'pointer', opacity: accionando === fila.turno_id ? 0.5 : 1 }}
                                      disabled={accionando !== null}
                                      onClick={() => aceptarTurno(fila)}
                                    >
                                      {accionando === fila.turno_id ? 'Aceptando…' : 'Aceptar'}
                                    </button>
                                    <button
                                      style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #92400e88', background: '#78350f', color: '#fbbf24', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                                      disabled={accionando !== null}
                                      onClick={() => { setFilaSolicitud(fila); setTextoSolicitud(''); setErrorAccion(null) }}
                                    >
                                      Solicitar modificación
                                    </button>
                                  </span>
                                )
                                : <span style={{ color: '#64748b', fontSize: 11 }}>{ETIQUETA_PRIMER_CONTROL.pendiente}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {errorAccion && !filaSolicitud && (
            <div style={{ color: '#ef4444', fontSize: 12, textAlign: 'center' as const, marginBottom: 8 }}>{errorAccion}</div>
          )}

          {/* Total */}
          <div style={S.total}>
            <div>
              <div style={S.totalLabel}>Total de horas</div>
              {datos.es_titular && (datos.pendientes_revision ?? 0) > 0 && (
                <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>
                  {datos.pendientes_revision} turno{(datos.pendientes_revision ?? 0) !== 1 ? 's' : ''} pendiente{(datos.pendientes_revision ?? 0) !== 1 ? 's' : ''} de revisión
                </div>
              )}
            </div>
            <div style={S.totalValue}>{formatearHoras(datos.total_horas)} hs</div>
          </div>
          <div style={S.aclaracion}>
            {datos.filas.filter(f => f.estado === 'trabajado' || f.estado === 'en_curso').length} {datos.filas.filter(f => f.estado === 'trabajado' || f.estado === 'en_curso').length === 1 ? 'día trabajado' : 'días trabajados'} ·{' '}
            {datos.filas.filter(f => f.estado === 'programado').length > 0 ? `${datos.filas.filter(f => f.estado === 'programado').length} programado(s) sin fichar · ` : ''}
            {labelMes(datos.mes)}
          </div>
        </>
      )}

      {/* Modal: Solicitar modificación */}
      {filaSolicitud && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => { if (!enviandoSolicitud) { setFilaSolicitud(null); setErrorAccion(null) } }}
        >
          <div
            style={{ background: '#1e293b', borderRadius: 12, padding: 20, width: '100%', maxWidth: 420, border: '1px solid #334155' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: '#e2e8f0' }}>Solicitar modificación</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
              {formatearFecha(filaSolicitud.fecha)} · {filaSolicitud.objetivo_nombre ?? '—'} · {filaSolicitud.hora_entrada ?? '—'}–{filaSolicitud.hora_salida ?? '—'}
              {filaSolicitud.salida_automatica ? ` · ${ETIQUETA_SALIDA_AUTOMATICA}` : ''}
            </div>
            <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>¿Qué desea modificar? *</label>
            <textarea
              value={textoSolicitud}
              onChange={e => setTextoSolicitud(e.target.value)}
              rows={4}
              placeholder="Ej.: La salida correcta fue a las 07:00."
              style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: 10, fontSize: 13, resize: 'vertical' as const, boxSizing: 'border-box' as const }}
            />
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
              La solicitud no modifica horarios ni horas: queda pendiente para revisión del supervisor.
            </div>
            {errorAccion && (
              <div style={{ color: '#ef4444', fontSize: 12, marginTop: 8 }}>{errorAccion}</div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
              <button
                style={{ padding: '10px 0', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}
                disabled={enviandoSolicitud}
                onClick={() => { setFilaSolicitud(null); setErrorAccion(null) }}
              >
                Cancelar
              </button>
              <button
                style={{ padding: '10px 0', borderRadius: 8, border: '1px solid #92400e', background: '#78350f', color: '#fbbf24', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: enviandoSolicitud || textoSolicitud.trim().length < 3 ? 0.5 : 1 }}
                disabled={enviandoSolicitud || textoSolicitud.trim().length < 3}
                onClick={enviarSolicitud}
              >
                {enviandoSolicitud ? 'Enviando…' : 'Enviar solicitud'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
