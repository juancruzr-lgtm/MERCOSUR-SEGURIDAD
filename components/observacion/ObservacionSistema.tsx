'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { brandColors, brandTypography, semanticColors } from '@/lib/brand-theme'

// ── Paleta y helpers de estilo ────────────────────────────────────────────────

const FONT = brandTypography?.fontFamily ?? 'system-ui, sans-serif'
const C = {
  bg:      '#0a0e1a',
  card:    '#111827',
  border:  '#1e2d42',
  muted:   '#64748b',
  text:    '#e2e8f0',
  sub:     '#94a3b8',
  yellow:  brandColors.yellow  ?? '#f59e0b',
  green:   semanticColors.success ?? '#22c55e',
  red:     semanticColors.error   ?? '#ef4444',
  orange:  brandColors.orange  ?? '#f97316',
  blue:    '#3b82f6',
}

const card = (extra: Record<string, unknown> = {}): React.CSSProperties => ({
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: '20px 24px',
  ...extra,
})

const badge = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 10px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  background: color + '22',
  color,
  fontFamily: FONT,
})

function pct(n: number | null | undefined, total: number | null | undefined): string {
  if (!total || total === 0 || n == null) return '—'
  return Math.round(n / total * 100) + '%'
}

function ms(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n < 1000) return n + 'ms'
  return (n / 1000).toFixed(1) + 's'
}

function semaforo(estado: 'operativo' | 'atencion' | 'critico' | undefined): { color: string; label: string } {
  if (estado === 'critico')  return { color: C.red, label: 'CRÍTICO' }
  if (estado === 'atencion') return { color: C.orange, label: 'ATENCIÓN' }
  return { color: C.green, label: 'OPERATIVO' }
}

function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function haceQuanto(iso: string | null | undefined): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `hace ${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `hace ${h}h`
  return `hace ${Math.floor(h / 24)}d`
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

type Tab = 'resumen' | 'telemetria' | 'uso' | 'sesiones' | 'calidad'

interface SummaryData {
  generado_en?: string
  estado_sistema?: 'operativo' | 'atencion' | 'critico'
  sesiones?: any
  eventos?: any
  operaciones?: any
  cobertura_hoy?: any
  novedades?: any
  pantallas_mas_usadas_7d?: [string, number][]
  versiones_activas_7d?: Record<string, { total: number; errores: number }>
  dispositivos_7d?: any
  errores_recientes?: any[]
  auditorias_recientes?: any[]
}

interface EventsData {
  events?: any[]
  page?: number
  limit?: number
}

interface UsageData {
  periodo_dias?: number
  resumen?: any
  pantallas_mas_usadas?: [string, number][]
  eventos_mas_frecuentes?: [string, number][]
  actividad_por_usuario?: any[]
  actividad_por_objetivo?: any[]
  supervisores_mas_activos?: any[]
  guardias_mas_errores_gps?: any[]
  supervisores_mas_intervenciones?: any[]
  admins_mas_correcciones?: any[]
  objetivos_mas_novedades?: any[]
}

interface SessionsData {
  resumen?: any
  breakdowns?: any
  sesiones?: any[]
}

interface QualityData {
  ejecutado_en?: string
  duracion_ms?: number
  resumen?: any
  checks?: any[]
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function fetchObs(path: string, params?: Record<string, string>): Promise<any> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token
  if (!token) throw new Error('Sin sesión')
  const url = new URL(`/api/obs/${path}`, window.location.origin)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || res.statusText)
  }
  return res.json()
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={card({ flex: 1, minWidth: 140 })}>
      <div style={{ fontSize: 11, color: C.muted, fontFamily: FONT, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 900, fontFamily: FONT, color: color ?? C.text, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.sub, marginTop: 4, fontFamily: FONT }}>{sub}</div>}
    </div>
  )
}

function SeccionTitulo({ titulo, sub }: { titulo: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 800, fontFamily: FONT, color: C.text }}>{titulo}</div>
      {sub && <div style={{ fontSize: 12, color: C.muted, fontFamily: FONT, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Spinner() {
  return <div style={{ color: C.muted, padding: 48, textAlign: 'center', fontFamily: FONT }}>Cargando...</div>
}

function Error({ mensaje }: { mensaje: string }) {
  return <div style={{ color: C.red, padding: 24, background: C.red + '11', borderRadius: 8, fontFamily: FONT, fontSize: 13 }}>Error: {mensaje}</div>
}

// ── Tab: RESUMEN ──────────────────────────────────────────────────────────────

function TabResumen() {
  const [data, setData]       = useState<SummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    fetchObs('summary').then(setData).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [])

  if (loading) return <Spinner />
  if (error)   return <Error mensaje={error} />
  if (!data)   return null

  const sem = semaforo(data.estado_sistema)
  const ev  = data.eventos ?? {}
  const op  = data.operaciones ?? {}
  const cob = data.cobertura_hoy ?? {}
  const nov = data.novedades ?? {}
  const ses = data.sesiones ?? {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Semáforo */}
      <div style={card({ display: 'flex', alignItems: 'center', gap: 20, padding: '16px 24px' })}>
        <div style={{ width: 18, height: 18, borderRadius: '50%', background: sem.color, boxShadow: `0 0 12px ${sem.color}` }} />
        <div>
          <div style={{ fontSize: 18, fontWeight: 900, fontFamily: FONT, color: sem.color }}>{sem.label}</div>
          <div style={{ fontSize: 12, color: C.muted, fontFamily: FONT }}>
            Generado {haceQuanto(data.generado_en)} · {new Date(data.generado_en ?? '').toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 900, fontFamily: FONT, color: C.text }}>{ses.usuarios_unicos_hoy ?? 0}</div>
            <div style={{ fontSize: 11, color: C.muted, fontFamily: FONT }}>Usuarios hoy</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 900, fontFamily: FONT, color: C.text }}>{ses.activas_hoy ?? 0}</div>
            <div style={{ fontSize: 11, color: C.muted, fontFamily: FONT }}>Sesiones activas</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 900, fontFamily: FONT, color: ev.errores_hoy > 0 ? C.red : C.green }}>{ev.errores_hoy ?? 0}</div>
            <div style={{ fontSize: 11, color: C.muted, fontFamily: FONT }}>Errores hoy</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 900, fontFamily: FONT, color: nov.urgentes_abiertas > 0 ? C.red : C.green }}>{nov.urgentes_abiertas ?? 0}</div>
            <div style={{ fontSize: 11, color: C.muted, fontFamily: FONT }}>Novedades urgentes</div>
          </div>
        </div>
      </div>

      {/* KPIs técnicos */}
      <div>
        <SeccionTitulo titulo="Telemetría — hoy" />
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <KpiCard label="Eventos registrados" value={ev.total_hoy ?? 0} sub="en os_events" />
          <KpiCard label="Tasa de error" value={ev.tasa_error_pct != null ? ev.tasa_error_pct.toFixed(1) + '%' : '—'} color={ev.tasa_error_pct > 10 ? C.red : C.green} />
          <KpiCard label="GPS éxito (7d)" value={op.gps?.tasa_exito_pct != null ? op.gps.tasa_exito_pct + '%' : '—'} color={op.gps?.tasa_exito_pct < 80 ? C.red : op.gps?.tasa_exito_pct < 90 ? C.orange : C.green} sub={`${op.gps?.exitosos_7d ?? 0} / ${op.gps?.solicitados_7d ?? 0} solicitudes`} />
          <KpiCard label="Ingreso éxito (7d)" value={op.ingresos?.tasa_exito_pct != null ? op.ingresos.tasa_exito_pct + '%' : '—'} color={op.ingresos?.tasa_exito_pct < 90 ? C.red : C.green} sub={`P50: ${ms(op.ingresos?.p50_ms)} · P95: ${ms(op.ingresos?.p95_ms)}`} />
          <KpiCard label="Supervisiones (7d)" value={op.supervisiones?.exitosas_7d ?? 0} sub={`${op.supervisiones?.abandonadas_7d ?? 0} abandonadas`} color={(op.supervisiones?.abandonadas_7d ?? 0) > 2 ? C.orange : C.green} />
        </div>
      </div>

      {/* Cobertura operativa hoy */}
      <div>
        <SeccionTitulo titulo="Cobertura operativa — hoy" />
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <KpiCard label="Turnos programados" value={cob.turnos_programados ?? 0} />
          <KpiCard label="Fichajes entrada" value={cob.fichajes_entrada ?? 0} color={C.green} />
          <KpiCard label="Descubiertos" value={cob.turnos_descubiertos ?? 0} color={cob.turnos_descubiertos > 0 ? C.red : C.green} />
          <KpiCard label="Tardanzas" value={cob.tardanzas ?? 0} color={cob.tardanzas > 3 ? C.orange : C.sub} />
          <KpiCard label="Fuera de radio" value={cob.fuera_radio ?? 0} color={cob.fuera_radio > 2 ? C.orange : C.sub} />
        </div>
      </div>

      {/* Errores recientes */}
      {(data.errores_recientes?.length ?? 0) > 0 && (
        <div>
          <SeccionTitulo titulo="Errores recientes (48 horas)" />
          <div style={{ ...card(), padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {['Hora', 'Evento', 'Código', 'Mensaje', 'Pantalla', 'Dispositivo', 'Versión'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, fontFamily: FONT }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.errores_recientes!.map((e: any, i: number) => (
                  <tr key={e.id ?? i} style={{ borderBottom: `1px solid ${C.border}22`, background: i % 2 === 0 ? 'transparent' : '#ffffff05' }}>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: C.sub, fontFamily: FONT, whiteSpace: 'nowrap' }}>{fechaCorta(e.client_ts)}</td>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: C.text, fontFamily: FONT }}>{e.event_name}</td>
                    <td style={{ padding: '8px 14px' }}><span style={badge(C.red)}>{e.err_code ?? '—'}</span></td>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: C.sub, fontFamily: FONT, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.err_message ?? '—'}</td>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: C.muted, fontFamily: FONT }}>{e.screen ?? '—'}</td>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: C.muted, fontFamily: FONT }}>{e.device_type ?? '—'}</td>
                    <td style={{ padding: '8px 14px' }}>{e.app_version ? <span style={badge(C.blue)}>{e.app_version}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pantallas más usadas */}
      {(data.pantallas_mas_usadas_7d?.length ?? 0) > 0 && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <SeccionTitulo titulo="Pantallas más usadas (7 días)" />
            <div style={card({ padding: '12px 0' })}>
              {data.pantallas_mas_usadas_7d!.slice(0, 10).map(([screen, cnt]: [string, number], i: number) => {
                const max = data.pantallas_mas_usadas_7d![0][1]
                return (
                  <div key={screen} style={{ padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ fontSize: 11, color: C.muted, width: 20, fontFamily: FONT }}>{i + 1}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontFamily: FONT, color: C.text, marginBottom: 3 }}>{screen}</div>
                      <div style={{ height: 4, borderRadius: 2, background: C.border, overflow: 'hidden' }}>
                        <div style={{ width: pct(cnt, max), height: '100%', background: C.yellow, borderRadius: 2 }} />
                      </div>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.text, fontFamily: FONT, minWidth: 40, textAlign: 'right' }}>{cnt}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Versiones activas */}
          {Object.keys(data.versiones_activas_7d ?? {}).length > 0 && (
            <div style={{ flex: 1, minWidth: 260 }}>
              <SeccionTitulo titulo="Versiones activas (7 días)" />
              <div style={card()}>
                {Object.entries(data.versiones_activas_7d!).sort((a, b) => b[1].total - a[1].total).map(([v, d]) => (
                  <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <span style={badge(C.blue)}>{v}</span>
                    <div style={{ flex: 1, fontSize: 12, color: C.sub, fontFamily: FONT }}>{d.total} eventos</div>
                    <div style={{ fontSize: 12, color: d.errores > 0 ? C.red : C.green, fontFamily: FONT }}>{d.errores} errores</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Correcciones de datos */}
      {(data.auditorias_recientes?.length ?? 0) > 0 && (
        <div>
          <SeccionTitulo titulo="Correcciones de datos recientes" sub="registros_asistencia_auditoria" />
          <div style={{ ...card(), padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {['Fecha', 'Campo', 'Valor anterior', 'Valor nuevo', 'Motivo'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, fontFamily: FONT }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.auditorias_recientes!.map((a: any, i: number) => (
                  <tr key={a.id} style={{ borderBottom: `1px solid ${C.border}22`, background: i % 2 === 0 ? 'transparent' : '#ffffff05' }}>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: C.sub, fontFamily: FONT, whiteSpace: 'nowrap' }}>{fechaCorta(a.created_at)}</td>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: C.yellow, fontFamily: FONT }}>{a.campo}</td>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: C.muted, fontFamily: FONT }}>{a.valor_anterior ?? '—'}</td>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: C.text, fontFamily: FONT }}>{a.valor_nuevo ?? '—'}</td>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: C.sub, fontFamily: FONT }}>{a.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab: TELEMETRÍA ───────────────────────────────────────────────────────────

function TabTelemetria() {
  const [data, setData]         = useState<EventsData | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [page, setPage]         = useState(0)
  const [filtros, setFiltros]   = useState({ from: '', to: '', event_name: '', category: '', only_errors: false, app_version: '', device_type: '' })

  const cargar = useCallback(() => {
    setLoading(true)
    setError(null)
    const params: Record<string, string> = { page: String(page), limit: '100' }
    if (filtros.from)        params.from         = filtros.from
    if (filtros.to)          params.to           = filtros.to
    if (filtros.event_name)  params.event_name   = filtros.event_name
    if (filtros.category)    params.category     = filtros.category
    if (filtros.only_errors) params.only_errors  = '1'
    if (filtros.app_version) params.app_version  = filtros.app_version
    if (filtros.device_type) params.device_type  = filtros.device_type
    fetchObs('events', params).then(setData).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [page, filtros])

  useEffect(() => { cargar() }, [cargar])

  const setCampo = (k: keyof typeof filtros, v: any) => setFiltros(f => ({ ...f, [k]: v }))

  const inputStyle: React.CSSProperties = { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 10px', color: C.text, fontFamily: FONT, fontSize: 12, width: '100%' }
  const labelStyle: React.CSSProperties = { fontSize: 11, color: C.muted, fontFamily: FONT, marginBottom: 4, display: 'block' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Filtros */}
      <div style={card()}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={labelStyle}>Desde</label>
            <input type="datetime-local" style={inputStyle} value={filtros.from} onChange={e => setCampo('from', e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={labelStyle}>Hasta</label>
            <input type="datetime-local" style={inputStyle} value={filtros.to} onChange={e => setCampo('to', e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={labelStyle}>Nombre de evento</label>
            <input type="text" style={inputStyle} placeholder="ej: gps_denied" value={filtros.event_name} onChange={e => setCampo('event_name', e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={labelStyle}>Categoría</label>
            <select style={inputStyle} value={filtros.category} onChange={e => setCampo('category', e.target.value)}>
              <option value="">Todas</option>
              {['sistema','fichaje','supervision','turno','nav','admin','error'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={labelStyle}>Versión</label>
            <input type="text" style={inputStyle} placeholder="ej: 0.3.1" value={filtros.app_version} onChange={e => setCampo('app_version', e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 100 }}>
            <label style={labelStyle}>Dispositivo</label>
            <select style={inputStyle} value={filtros.device_type} onChange={e => setCampo('device_type', e.target.value)}>
              <option value="">Todos</option>
              <option value="mobile">Mobile</option>
              <option value="desktop">Desktop</option>
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.text, fontFamily: FONT, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={filtros.only_errors} onChange={e => setCampo('only_errors', e.target.checked)} />
            Solo errores
          </label>
          <button onClick={() => { setPage(0); cargar() }} style={{ background: C.yellow, color: '#000', border: 'none', borderRadius: 6, padding: '8px 18px', fontWeight: 700, fontFamily: FONT, fontSize: 13, cursor: 'pointer' }}>Buscar</button>
        </div>
      </div>

      {/* Tabla de eventos */}
      {loading && <Spinner />}
      {error && <Error mensaje={error} />}
      {!loading && !error && data && (
        <>
          <div style={{ fontSize: 12, color: C.muted, fontFamily: FONT }}>{data.events?.length ?? 0} eventos mostrados</div>
          <div style={{ ...card(), padding: 0, overflow: 'hidden', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {['Fecha (cliente)', 'Evento', 'Cat.', 'Pantalla', 'Duración', 'Error', 'GPS', 'Red', 'Versión', 'Dispositivo'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, fontFamily: FONT, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data.events ?? []).map((e: any, i: number) => (
                  <tr key={e.id} style={{ borderBottom: `1px solid ${C.border}22`, background: i % 2 === 0 ? 'transparent' : '#ffffff04' }}>
                    <td style={{ padding: '7px 12px', fontSize: 11, color: C.sub, fontFamily: FONT, whiteSpace: 'nowrap' }}>{fechaCorta(e.client_ts)}</td>
                    <td style={{ padding: '7px 12px', fontSize: 12, color: e.err_code ? C.red : C.text, fontFamily: FONT, whiteSpace: 'nowrap' }}>{e.event_name}</td>
                    <td style={{ padding: '7px 12px' }}><span style={badge(e.event_category === 'error' ? C.red : C.blue)}>{e.event_category}</span></td>
                    <td style={{ padding: '7px 12px', fontSize: 11, color: C.muted, fontFamily: FONT }}>{e.screen ?? '—'}</td>
                    <td style={{ padding: '7px 12px', fontSize: 12, color: C.sub, fontFamily: FONT }}>{ms(e.duration_ms)}</td>
                    <td style={{ padding: '7px 12px', fontSize: 11, color: C.red, fontFamily: FONT, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.err_message ?? ''}>{e.err_code ?? ''}{e.err_message ? ` — ${e.err_message}` : ''}</td>
                    <td style={{ padding: '7px 12px', fontSize: 11, color: C.muted, fontFamily: FONT, whiteSpace: 'nowrap' }}>{e.gps_status ?? (e.gps_lat ? `${Number(e.gps_lat).toFixed(4)},${Number(e.gps_lng).toFixed(4)}` : '—')}</td>
                    <td style={{ padding: '7px 12px', fontSize: 11, color: C.muted, fontFamily: FONT }}>{e.network_type ?? '—'}</td>
                    <td style={{ padding: '7px 12px' }}>{e.app_version ? <span style={badge(C.blue)}>{e.app_version}</span> : '—'}</td>
                    <td style={{ padding: '7px 12px', fontSize: 11, color: C.muted, fontFamily: FONT }}>{e.device_type ?? '—'}{e.os_name ? ` / ${e.os_name}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ padding: '6px 16px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontFamily: FONT, fontSize: 12, cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.4 : 1 }}>← Anterior</button>
            <span style={{ padding: '6px 12px', fontSize: 12, color: C.muted, fontFamily: FONT }}>Página {page + 1}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={(data.events?.length ?? 0) < 100} style={{ padding: '6px 16px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontFamily: FONT, fontSize: 12, cursor: (data.events?.length ?? 0) < 100 ? 'not-allowed' : 'pointer', opacity: (data.events?.length ?? 0) < 100 ? 0.4 : 1 }}>Siguiente →</button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Tab: USO DEL SISTEMA ──────────────────────────────────────────────────────

function TabUso() {
  const [data, setData]       = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [days, setDays]       = useState('30')

  const cargar = useCallback(() => {
    setLoading(true)
    setError(null)
    fetchObs('usage', { days }).then(setData).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [days])

  useEffect(() => { cargar() }, [cargar])

  if (loading) return <Spinner />
  if (error)   return <Error mensaje={error} />
  if (!data)   return null

  const res = data.resumen ?? {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Selector de período */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 12, color: C.muted, fontFamily: FONT }}>Período:</span>
        {[7, 14, 30, 60, 90].map(d => (
          <button key={d} onClick={() => setDays(String(d))} style={{ padding: '4px 12px', background: days === String(d) ? C.yellow : C.card, color: days === String(d) ? '#000' : C.text, border: `1px solid ${days === String(d) ? C.yellow : C.border}`, borderRadius: 6, fontFamily: FONT, fontSize: 12, cursor: 'pointer', fontWeight: days === String(d) ? 700 : 400 }}>{d}d</button>
        ))}
      </div>

      {/* Resumen del período */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KpiCard label="Eventos analizados" value={(res.total_eventos_analizados ?? 0).toLocaleString()} />
        <KpiCard label="Usuarios activos" value={res.usuarios_activos_periodo ?? 0} />
        <KpiCard label="Supervisiones" value={res.supervisiones_realizadas ?? 0} color={C.green} />
        <KpiCard label="Intervenciones" value={res.intervenciones_realizadas ?? 0} color={C.orange} />
        <KpiCard label="Correcciones admin" value={res.correcciones_admin ?? 0} color={res.correcciones_admin > 20 ? C.orange : C.sub} />
        <KpiCard label="Posibles abandonos" value={res.posibles_abandonos_ingreso ?? 0} color={res.posibles_abandonos_ingreso > 5 ? C.red : C.green} sub="ingresos sin confirmar" />
      </div>

      {/* Dos columnas: pantallas + eventos más frecuentes */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <SeccionTitulo titulo="Pantallas más utilizadas" />
          <div style={card({ padding: '12px 0' })}>
            {(data.pantallas_mas_usadas ?? []).slice(0, 12).map(([screen, cnt]: [string, number], i: number) => {
              const max = (data.pantallas_mas_usadas?.[0]?.[1] ?? 1) as number
              return (
                <div key={screen} style={{ padding: '6px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 11, color: C.muted, width: 16, fontFamily: FONT }}>{i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontFamily: FONT, color: C.text, marginBottom: 3 }}>{screen}</div>
                    <div style={{ height: 3, borderRadius: 2, background: C.border }}>
                      <div style={{ width: pct(cnt, max), height: '100%', background: C.yellow, borderRadius: 2 }} />
                    </div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text, fontFamily: FONT, minWidth: 36, textAlign: 'right' }}>{cnt}</div>
                </div>
              )
            })}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <SeccionTitulo titulo="Eventos más frecuentes" />
          <div style={card({ padding: '12px 0' })}>
            {(data.eventos_mas_frecuentes ?? []).slice(0, 15).map(([ev, cnt]: [string, number], i: number) => {
              const max = (data.eventos_mas_frecuentes?.[0]?.[1] ?? 1) as number
              return (
                <div key={ev} style={{ padding: '5px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 11, color: C.muted, width: 16, fontFamily: FONT }}>{i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontFamily: FONT, color: C.sub, marginBottom: 3 }}>{ev}</div>
                    <div style={{ height: 3, borderRadius: 2, background: C.border }}>
                      <div style={{ width: pct(cnt, max), height: '100%', background: C.blue + 'aa', borderRadius: 2 }} />
                    </div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text, fontFamily: FONT, minWidth: 36, textAlign: 'right' }}>{cnt}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Actividad por usuario */}
      <div>
        <SeccionTitulo titulo="Actividad por usuario" sub="Ordenado por cantidad de eventos" />
        <div style={{ ...card(), padding: 0, overflow: 'hidden', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Usuario', 'Rol', 'Eventos', 'Errores', 'Tasa error', 'Pantallas distintas'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, fontFamily: FONT }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.actividad_por_usuario ?? []).map((u: any, i: number) => (
                <tr key={u.user_id} style={{ borderBottom: `1px solid ${C.border}22`, background: i % 2 === 0 ? 'transparent' : '#ffffff04' }}>
                  <td style={{ padding: '8px 14px', fontSize: 13, color: C.text, fontFamily: FONT }}>{u.usuario ? `${u.usuario.apellido}, ${u.usuario.nombre}` : u.user_id.slice(0, 8)}</td>
                  <td style={{ padding: '8px 14px' }}><span style={badge(C.blue)}>{u.rol}</span></td>
                  <td style={{ padding: '8px 14px', fontSize: 13, fontWeight: 700, color: C.text, fontFamily: FONT }}>{u.total_eventos}</td>
                  <td style={{ padding: '8px 14px', fontSize: 13, color: u.errores > 0 ? C.red : C.green, fontFamily: FONT }}>{u.errores}</td>
                  <td style={{ padding: '8px 14px' }}><span style={badge(u.tasa_error_pct > 10 ? C.red : u.tasa_error_pct > 5 ? C.orange : C.green)}>{u.tasa_error_pct}%</span></td>
                  <td style={{ padding: '8px 14px', fontSize: 13, color: C.sub, fontFamily: FONT }}>{u.pantallas_distintas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rankings de usuarios */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {[
          { titulo: 'Supervisores más activos', data: data.supervisores_mas_activos, key: 'supervisiones', label: 'supervisiones' },
          { titulo: 'Guardias con más errores GPS', data: data.guardias_mas_errores_gps, key: 'errores_gps', label: 'errores GPS' },
          { titulo: 'Supervisores — más intervenciones', data: data.supervisores_mas_intervenciones, key: 'intervenciones', label: 'intervenciones' },
        ].map(({ titulo, data: d, key, label }) => (
          <div key={titulo} style={{ flex: 1, minWidth: 220 }}>
            <SeccionTitulo titulo={titulo} />
            <div style={card()}>
              {(d ?? []).slice(0, 8).map((item: any, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: C.muted, width: 16 }}>{i + 1}</div>
                  <div style={{ flex: 1, fontSize: 12, color: C.text, fontFamily: FONT }}>
                    {item.usuario ? `${item.usuario.apellido ?? ''}, ${item.usuario.nombre ?? ''}` : item.user_id?.slice(0, 8) ?? '—'}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.yellow, fontFamily: FONT }}>{item[key]} <span style={{ fontWeight: 400, color: C.muted }}>{label}</span></div>
                </div>
              ))}
              {(d?.length ?? 0) === 0 && <div style={{ fontSize: 12, color: C.muted, fontFamily: FONT }}>Sin datos en este período.</div>}
            </div>
          </div>
        ))}
      </div>

      {/* Objetivos con más novedades */}
      {(data.objetivos_mas_novedades?.length ?? 0) > 0 && (
        <div>
          <SeccionTitulo titulo="Objetivos con más novedades" />
          <div style={card({ padding: '12px 0' })}>
            {data.objetivos_mas_novedades!.slice(0, 10).map((item: any, i: number) => (
              <div key={i} style={{ padding: '7px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 11, color: C.muted, width: 16 }}>{i + 1}</div>
                <div style={{ flex: 1, fontSize: 12, color: C.text, fontFamily: FONT }}>{item.objetivo?.nombre ?? 'Objetivo desconocido'}</div>
                <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT }}>{item.objetivo?.cliente}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: item.novedades > 5 ? C.red : C.orange, fontFamily: FONT }}>{item.novedades} novedades</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab: SESIONES ─────────────────────────────────────────────────────────────

function TabSesiones() {
  const [data, setData]       = useState<SessionsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [days, setDays]       = useState('7')

  const cargar = useCallback(() => {
    setLoading(true)
    setError(null)
    fetchObs('sessions', { days }).then(setData).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [days])

  useEffect(() => { cargar() }, [cargar])

  if (loading) return <Spinner />
  if (error)   return <Error mensaje={error} />
  if (!data)   return null

  const res = data.resumen ?? {}
  const bd  = data.breakdowns ?? {}

  function Breakdown({ titulo, data: d }: { titulo: string; data: Record<string, number> }) {
    const total = Object.values(d).reduce((a, b) => a + b, 0)
    const entries = Object.entries(d).sort((a, b) => b[1] - a[1])
    return (
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, fontFamily: FONT, marginBottom: 10 }}>{titulo}</div>
        {entries.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ flex: 1, fontSize: 12, color: C.text, fontFamily: FONT }}>{k}</div>
            <div style={{ height: 4, width: 80, borderRadius: 2, background: C.border }}>
              <div style={{ width: pct(v, total), height: '100%', background: C.blue, borderRadius: 2 }} />
            </div>
            <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, minWidth: 32, textAlign: 'right' }}>{v}</div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 12, color: C.muted, fontFamily: FONT }}>Período:</span>
        {[7, 14, 30].map(d => (
          <button key={d} onClick={() => setDays(String(d))} style={{ padding: '4px 12px', background: days === String(d) ? C.yellow : C.card, color: days === String(d) ? '#000' : C.text, border: `1px solid ${days === String(d) ? C.yellow : C.border}`, borderRadius: 6, fontFamily: FONT, fontSize: 12, cursor: 'pointer', fontWeight: days === String(d) ? 700 : 400 }}>{d}d</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KpiCard label="Total sesiones" value={res.total_sesiones ?? 0} />
        <KpiCard label="Sesiones activas" value={res.sesiones_activas ?? 0} color={C.green} />
        <KpiCard label="Usuarios únicos" value={res.usuarios_unicos ?? 0} />
        <KpiCard label="Duración P50" value={res.p50_duracion_s != null ? Math.round(res.p50_duracion_s / 60) + 'min' : '—'} />
        <KpiCard label="Duración P95" value={res.p95_duracion_s != null ? Math.round(res.p95_duracion_s / 60) + 'min' : '—'} />
      </div>

      <div style={card()}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: FONT, marginBottom: 16 }}>Distribución de sesiones</div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Breakdown titulo="Por rol" data={bd.por_rol ?? {}} />
          <Breakdown titulo="Por dispositivo" data={bd.por_dispositivo ?? {}} />
          <Breakdown titulo="Por OS" data={bd.por_os ?? {}} />
          <Breakdown titulo="Por browser" data={bd.por_browser ?? {}} />
          <Breakdown titulo="Por versión" data={bd.por_version ?? {}} />
        </div>
      </div>

      <div>
        <SeccionTitulo titulo="Sesiones recientes" />
        <div style={{ ...card(), padding: 0, overflow: 'hidden', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Inicio', 'Usuario', 'Rol', 'Dispositivo', 'OS', 'Browser', 'Versión', 'Duración', 'Estado'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, fontFamily: FONT, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.sesiones ?? []).map((s: any, i: number) => (
                <tr key={s.id} style={{ borderBottom: `1px solid ${C.border}22`, background: i % 2 === 0 ? 'transparent' : '#ffffff04' }}>
                  <td style={{ padding: '7px 12px', fontSize: 11, color: C.sub, fontFamily: FONT, whiteSpace: 'nowrap' }}>{fechaCorta(s.started_at)}</td>
                  <td style={{ padding: '7px 12px', fontSize: 12, color: C.text, fontFamily: FONT }}>{s.usuario ? `${s.usuario.apellido}, ${s.usuario.nombre}` : s.user_id?.slice(0, 8)}</td>
                  <td style={{ padding: '7px 12px' }}><span style={badge(C.blue)}>{s.user_rol}</span></td>
                  <td style={{ padding: '7px 12px', fontSize: 11, color: C.muted, fontFamily: FONT }}>{s.device_type ?? '—'}</td>
                  <td style={{ padding: '7px 12px', fontSize: 11, color: C.muted, fontFamily: FONT }}>{s.os_name ?? '—'}</td>
                  <td style={{ padding: '7px 12px', fontSize: 11, color: C.muted, fontFamily: FONT }}>{s.browser_name ?? '—'}</td>
                  <td style={{ padding: '7px 12px' }}>{s.app_version ? <span style={badge(C.blue)}>{s.app_version}</span> : '—'}</td>
                  <td style={{ padding: '7px 12px', fontSize: 11, color: C.muted, fontFamily: FONT }}>{s.duration_s != null ? Math.round(s.duration_s / 60) + 'min' : '—'}</td>
                  <td style={{ padding: '7px 12px' }}><span style={badge(s.ended_at ? C.muted : C.green)}>{s.ended_at ? 'Cerrada' : 'Activa'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Tab: CALIDAD DE DATOS ─────────────────────────────────────────────────────

function TabCalidad() {
  const [data, setData]       = useState<QualityData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const cargar = () => {
    setLoading(true)
    setError(null)
    fetchObs('quality').then(setData).catch(e => setError(e.message)).finally(() => setLoading(false))
  }

  const estadoColor: Record<string, string> = { ok: C.green, advertencia: C.orange, critico: C.red }
  const estadoIcon:  Record<string, string> = { ok: '✓', advertencia: '⚠', critico: '✗' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={cargar} disabled={loading} style={{ background: C.yellow, color: '#000', border: 'none', borderRadius: 6, padding: '8px 20px', fontWeight: 700, fontFamily: FONT, fontSize: 13, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Ejecutando chequeos...' : 'Ejecutar chequeos de calidad'}
        </button>
        {data?.ejecutado_en && (
          <span style={{ fontSize: 12, color: C.muted, fontFamily: FONT }}>
            Último chequeo: {fechaCorta(data.ejecutado_en)} · {data.duracion_ms}ms
          </span>
        )}
      </div>

      {error && <Error mensaje={error} />}

      {data && !loading && (
        <>
          {/* Resumen */}
          <div style={{ display: 'flex', gap: 12 }}>
            <KpiCard label="Total checks" value={data.resumen?.total_checks ?? 0} />
            <KpiCard label="Críticos" value={data.resumen?.criticos ?? 0} color={data.resumen?.criticos > 0 ? C.red : C.green} />
            <KpiCard label="Advertencias" value={data.resumen?.advertencias ?? 0} color={data.resumen?.advertencias > 0 ? C.orange : C.green} />
            <KpiCard label="OK" value={data.resumen?.ok ?? 0} color={C.green} />
          </div>

          {/* Lista de checks */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(data.checks ?? []).map((c: any) => (
              <div key={c.nombre} style={card({ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '14px 20px', borderLeft: `4px solid ${estadoColor[c.estado]}` })}>
                <div style={{ fontSize: 18, color: estadoColor[c.estado], fontWeight: 900, minWidth: 20 }}>{estadoIcon[c.estado]}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: FONT }}>{c.nombre}</div>
                  <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, marginTop: 2 }}>{c.descripcion}</div>
                  {c.ids_ejemplo?.length > 0 && (
                    <div style={{ fontSize: 11, color: C.muted, fontFamily: FONT, marginTop: 4 }}>
                      IDs de ejemplo: {c.ids_ejemplo.join(', ')}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 22, fontWeight: 900, color: estadoColor[c.estado], fontFamily: FONT }}>{c.cantidad}</div>
                  <div style={{ fontSize: 11, color: C.muted, fontFamily: FONT }}>{c.entidad}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {!data && !loading && !error && (
        <div style={card({ padding: 48, textAlign: 'center' })}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
          <div style={{ fontSize: 14, color: C.sub, fontFamily: FONT, marginBottom: 8 }}>Análisis de calidad de datos</div>
          <div style={{ fontSize: 12, color: C.muted, fontFamily: FONT }}>
            Presioná el botón para ejecutar los chequeos sobre todas las tablas operativas.
            El análisis tarda entre 2 y 10 segundos dependiendo del volumen de datos.
          </div>
        </div>
      )}
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function ObservacionSistema() {
  const [tab, setTab] = useState<Tab>('resumen')

  const tabs: { id: Tab; label: string; icono: string }[] = [
    { id: 'resumen',    label: 'Resumen',         icono: '📊' },
    { id: 'telemetria', label: 'Telemetría',       icono: '🔭' },
    { id: 'uso',        label: 'Uso del sistema',  icono: '📈' },
    { id: 'sesiones',   label: 'Sesiones',         icono: '💻' },
    { id: 'calidad',    label: 'Calidad de datos', icono: '✓' },
  ]

  return (
    <div style={{ fontFamily: FONT }}>
      {/* Encabezado */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, fontFamily: FONT, margin: 0 }}>Observación del Sistema</h1>
        <p style={{ fontSize: 13, color: C.muted, margin: '6px 0 0', fontFamily: FONT }}>
          Estado técnico · Uso operativo · Calidad de datos · Trazabilidad completa
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.border}`, marginBottom: 28, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === t.id ? `2px solid ${C.yellow}` : '2px solid transparent',
              padding: '10px 18px',
              cursor: 'pointer',
              fontFamily: FONT,
              fontSize: 13,
              fontWeight: tab === t.id ? 700 : 400,
              color: tab === t.id ? C.yellow : C.muted,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: -1,
            }}
          >
            <span>{t.icono}</span> {t.label}
          </button>
        ))}
      </div>

      {/* Contenido */}
      {tab === 'resumen'    && <TabResumen />}
      {tab === 'telemetria' && <TabTelemetria />}
      {tab === 'uso'        && <TabUso />}
      {tab === 'sesiones'   && <TabSesiones />}
      {tab === 'calidad'    && <TabCalidad />}
    </div>
  )
}
