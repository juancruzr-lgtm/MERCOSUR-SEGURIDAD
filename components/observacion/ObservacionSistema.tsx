'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
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

const SIN_REGISTROS = 'No existen registros.'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

function humanizarCodigo(valor: unknown, fallback = 'Sin dato'): string {
  if (valor == null) return fallback
  const raw = String(valor).trim()
  if (!raw || raw === 'undefined' || raw === 'null' || UUID_RE.test(raw)) return fallback
  return capitalizar(raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim())
}

function nombrePantalla(valor: unknown): string {
  const raw = String(valor ?? '').trim()
  const mapa: Record<string, string> = {
    dashboard: 'Inicio',
    guardias: 'Usuarios',
    usuarios: 'Usuarios',
    objetivos: 'Objetivos',
    turnos: 'Turnos',
    asistencia: 'Asistencia',
    supervisiones: 'Supervisiones',
    novedades: 'Novedades',
    reportes: 'Reportes',
    checklists: 'Checklists',
    observacion: 'Observatorio',
    servicios_objetivo: 'Servicios por objetivo',
    turnos_base: 'Turnos base',
    zonas_operativas: 'Zonas operativas',
    revision_operativa: 'Revisión operativa',
    solicitudes_admin: 'Solicitudes',
  }
  return mapa[raw] ?? humanizarCodigo(raw, 'Pantalla no identificada')
}

function nombreCategoria(valor: unknown): string {
  const raw = String(valor ?? '').trim()
  const mapa: Record<string, string> = {
    sistema: 'Sistema',
    fichaje: 'Fichajes',
    supervision: 'Supervisiones',
    turno: 'Turnos',
    nav: 'Navegación',
    admin: 'Administración',
    error: 'Problemas',
  }
  return mapa[raw] ?? humanizarCodigo(raw, 'Sin categoría')
}

function nombreDispositivo(valor: unknown): string {
  const raw = String(valor ?? '').trim().toLowerCase()
  const mapa: Record<string, string> = {
    mobile: 'Móvil',
    desktop: 'Escritorio',
    tablet: 'Tablet',
  }
  return mapa[raw] ?? humanizarCodigo(raw, 'Sin dato')
}

function nombreRol(valor: unknown): string {
  const raw = String(valor ?? '').trim().toLowerCase()
  const mapa: Record<string, string> = {
    admin: 'Administración',
    supervisor: 'Supervisor',
    guardia: 'Guardia',
  }
  return mapa[raw] ?? humanizarCodigo(raw, 'Sin rol')
}

function nombreEvento(valor: unknown): string {
  const raw = String(valor ?? '').trim()
  const mapa: Record<string, string> = {
    gps_denied: 'Permiso de ubicación rechazado',
    gps_error: 'Problema con ubicación',
    login_success: 'Ingreso correcto',
    login_error: 'Problema al ingresar',
    asistencia_ingreso: 'Fichaje de entrada',
    asistencia_egreso: 'Fichaje de salida',
    supervision_start: 'Inicio de supervisión',
    supervision_save: 'Supervisión guardada',
  }
  return mapa[raw] ?? humanizarCodigo(raw, 'Actividad no identificada')
}

function textoProblema(item: any): string {
  if (item?.err_message) return humanizarCodigo(item.err_message, 'Problema sin detalle')
  if (item?.event_name) return nombreEvento(item.event_name)
  return 'Problema sin detalle'
}

function campoLegible(valor: unknown): string {
  const raw = String(valor ?? '').trim()
  const mapa: Record<string, string> = {
    guardia_id: 'Guardia',
    objetivo_id: 'Objetivo',
    turno_id: 'Turno',
    hora_entrada_real: 'Hora de entrada',
    hora_salida_real: 'Hora de salida',
    lat_entrada: 'Ubicación de entrada',
    lng_entrada: 'Ubicación de entrada',
    lat_salida: 'Ubicación de salida',
    lng_salida: 'Ubicación de salida',
    foto_entrada_url: 'Foto de entrada',
    foto_salida_url: 'Foto de salida',
    estado: 'Estado',
    motivo: 'Motivo',
  }
  return mapa[raw] ?? humanizarCodigo(raw, 'Dato corregido')
}

function valorLegible(valor: unknown): string {
  if (valor == null || valor === '') return 'Sin dato'
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No'
  const raw = String(valor).trim()
  if (UUID_RE.test(raw)) return 'Referencia interna'
  if (/^https?:\/\//i.test(raw)) return 'Archivo adjunto'
  return humanizarCodigo(raw, 'Sin dato')
}

function areaOperativa(entidad: string): string {
  const mapa: Record<string, string> = {
    usuarios: 'Usuarios',
    objetivos: 'Objetivos',
    turnos: 'Turnos',
    registros_asistencia: 'Fichajes',
    evidencias: 'Fichajes',
    supervisiones: 'Supervisiones',
    novedades: 'Novedades',
  }
  return mapa[entidad] ?? 'Registros'
}

function accionOperativa(entidad: string): string {
  return `Ver ${areaOperativa(entidad).toLowerCase()}`
}


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
type ObservatorioNavigate = (destino: string, filtro?: Record<string, any>) => void

type TelemetriaFiltros = {
  from: string
  to: string
  event_name: string
  category: string
  status: string
  app_version: string
  device_type: string
}

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

function fechaInput(fecha: Date): string {
  const yyyy = fecha.getFullYear()
  const mm = String(fecha.getMonth() + 1).padStart(2, '0')
  const dd = String(fecha.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function fechaHaceDias(dias: number): string {
  const fecha = new Date()
  fecha.setDate(fecha.getDate() - dias)
  return fechaInput(fecha)
}

function filtrosTelemetriaDefault(): TelemetriaFiltros {
  return {
    from: fechaHaceDias(7),
    to: '',
    event_name: '',
    category: '',
    status: '',
    app_version: '',
    device_type: '',
  }
}

function slugArchivo(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function textoVisible(root: HTMLElement | null): string {
  return (root?.innerText || '').replace(/\n{3,}/g, '\n\n').trim()
}

function tablasVisibles(root: HTMLElement | null): string[][][] {
  if (!root) return []
  return Array.from(root.querySelectorAll('table')).map(table =>
    Array.from(table.querySelectorAll('tr')).map(row =>
      Array.from(row.querySelectorAll('th,td')).map(cell => (cell.textContent || '').trim())
    ).filter(row => row.some(Boolean))
  ).filter(rows => rows.length > 0)
}

function textoPdfSeguro(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?')
}

function escaparPdf(texto: string): string {
  return texto.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function lineasPdf(texto: string, max = 92): string[] {
  const salida: string[] = []
  textoPdfSeguro(texto).split(/\r?\n/).forEach(parrafo => {
    const palabras = parrafo.split(/\s+/).filter(Boolean)
    if (palabras.length === 0) {
      salida.push('')
      return
    }

    let actual = ''
    palabras.forEach(palabraOriginal => {
      let palabra = palabraOriginal
      while (palabra.length > max) {
        if (actual) {
          salida.push(actual)
          actual = ''
        }
        salida.push(palabra.slice(0, max))
        palabra = palabra.slice(max)
      }
      const candidata = actual ? `${actual} ${palabra}` : palabra
      if (candidata.length > max && actual) {
        salida.push(actual)
        actual = palabra
      } else {
        actual = candidata
      }
    })
    if (actual) salida.push(actual)
  })
  return salida
}

function crearPdfTexto(titulo: string, texto: string): Blob {
  const pageWidth = 595
  const pageHeight = 842
  const margin = 40
  const leading = 13
  const lineas = lineasPdf(`${titulo}\n\n${texto}`)
  const lineasPorPagina = Math.max(1, Math.floor((pageHeight - margin * 2) / leading))
  const paginas: string[][] = []

  for (let i = 0; i < lineas.length; i += lineasPorPagina) {
    paginas.push(lineas.slice(i, i + lineasPorPagina))
  }
  if (paginas.length === 0) paginas.push([''])

  const pageIds = paginas.map((_, i) => 3 + i * 2)
  const contentIds = paginas.map((_, i) => 4 + i * 2)
  const fontId = 3 + paginas.length * 2
  const objetos: Array<{ id: number; body: string }> = [
    { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { id: 2, body: `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${paginas.length} >>` },
  ]

  paginas.forEach((pagina, index) => {
    const contenido = [
      'BT',
      '/F1 10 Tf',
      `${margin} ${pageHeight - margin} Td`,
      `${leading} TL`,
      ...pagina.map(linea => `(${escaparPdf(linea)}) Tj T*`),
      'ET',
    ].join('\n')

    objetos.push({
      id: pageIds[index],
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`,
    })
    objetos.push({
      id: contentIds[index],
      body: `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`,
    })
  })

  objetos.push({ id: fontId, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' })
  objetos.sort((a, b) => a.id - b.id)

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = [0]
  objetos.forEach(obj => {
    offsets[obj.id] = pdf.length
    pdf += `${obj.id} 0 obj\n${obj.body}\nendobj\n`
  })

  const xrefOffset = pdf.length
  pdf += `xref\n0 ${fontId + 1}\n0000000000 65535 f \n`
  for (let id = 1; id <= fontId; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${fontId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

  return new Blob([pdf], { type: 'application/pdf' })
}

function descargarBlob(nombre: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = nombre
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
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

function Error({ mensaje: _mensaje }: { mensaje: string }) {
  return <div style={{ color: C.red, padding: 24, background: C.red + '11', borderRadius: 8, fontFamily: FONT, fontSize: 13 }}>No se pudo cargar la información. Intentá nuevamente.</div>
}

function EmptyState({ mensaje = SIN_REGISTROS }: { mensaje?: string }) {
  return <div style={card({ padding: 28, textAlign: 'center', color: C.muted, fontFamily: FONT, fontSize: 13 })}>{mensaje}</div>
}

function ReportActions({ targetRef, titulo }: { targetRef: React.RefObject<HTMLDivElement>; titulo: string }) {
  const [msg, setMsg] = useState('')
  const buttonStyle: React.CSSProperties = {
    background: C.card,
    color: C.text,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: '7px 12px',
    fontFamily: FONT,
    fontSize: 12,
    cursor: 'pointer',
  }

  const notify = (texto: string) => {
    setMsg(texto)
    window.setTimeout(() => setMsg(''), 2500)
  }

  const copiar = async () => {
    const texto = textoVisible(targetRef.current)
    if (!texto) return notify('No hay contenido para copiar.')
    await navigator.clipboard.writeText(texto)
    notify('Informe copiado.')
  }

  const imprimir = () => {
    window.print()
  }

  const descargarPdf = async () => {
    const texto = textoVisible(targetRef.current)
    if (!texto) return notify('No hay contenido para exportar.')
    descargarBlob(`${slugArchivo(titulo)}.pdf`, crearPdfTexto(titulo, texto))
    notify('PDF generado.')
  }
  const descargarExcel = async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const texto = textoVisible(targetRef.current)
    const rows = texto.split('\n').filter(Boolean).map(linea => [linea])
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows.length ? rows : [[SIN_REGISTROS]]), 'Vista actual')

    tablasVisibles(targetRef.current).forEach((rowsTabla, index) => {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rowsTabla), `Tabla ${index + 1}`.slice(0, 31))
    })

    XLSX.writeFile(wb, `${slugArchivo(titulo)}.xlsx`)
    notify('Excel generado.')
  }
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <button type="button" onClick={descargarPdf} style={{ ...buttonStyle, background: C.yellow, color: '#000', borderColor: C.yellow, fontWeight: 700 }}>Descargar PDF</button>
      <button type="button" onClick={descargarExcel} style={buttonStyle}>Descargar Excel</button>
      <button type="button" onClick={copiar} style={buttonStyle}>Copiar</button>
      <button type="button" onClick={imprimir} style={buttonStyle}>Imprimir</button>
      {msg && <span style={{ fontSize: 12, color: C.green, fontFamily: FONT }}>{msg}</span>}
    </div>
  )
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
          <KpiCard label="Acciones registradas" value={ev.total_hoy ?? 0} />
          <KpiCard label="Tasa de error" value={ev.tasa_error_pct != null ? ev.tasa_error_pct.toFixed(1) + '%' : '—'} color={ev.tasa_error_pct > 10 ? C.red : C.green} />
          <KpiCard label="GPS éxito (7d)" value={op.gps?.tasa_exito_pct != null ? op.gps.tasa_exito_pct + '%' : '—'} color={op.gps?.tasa_exito_pct < 80 ? C.red : op.gps?.tasa_exito_pct < 90 ? C.orange : C.green} sub={`${op.gps?.exitosos_7d ?? 0} / ${op.gps?.solicitados_7d ?? 0} solicitudes`} />
          <KpiCard label="Ingreso éxito (7d)" value={op.ingresos?.tasa_exito_pct != null ? op.ingresos.tasa_exito_pct + '%' : '—'} color={op.ingresos?.tasa_exito_pct < 90 ? C.red : C.green} sub={`Habitual: ${ms(op.ingresos?.p50_ms)} · Alto: ${ms(op.ingresos?.p95_ms)}`} />
          <KpiCard label="Egreso éxito (7d)" value={op.egresos?.tasa_exito_pct != null ? op.egresos.tasa_exito_pct + '%' : '—'} color={op.egresos?.tasa_exito_pct != null && op.egresos.tasa_exito_pct < 90 ? C.red : C.green} sub={`Habitual: ${ms(op.egresos?.p50_ms)} · ${op.egresos?.anulados_7d ?? 0} anulados`} />
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
                  {['Hora', 'Actividad', 'Problema', 'Pantalla', 'Dispositivo', 'Versión'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, fontFamily: FONT }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.errores_recientes!.map((e: any, i: number) => (
                  <tr key={e.id ?? i} style={{ borderBottom: `1px solid ${C.border}22`, background: i % 2 === 0 ? 'transparent' : '#ffffff05' }}>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: C.sub, fontFamily: FONT, whiteSpace: 'nowrap' }}>{fechaCorta(e.client_ts)}</td>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: C.text, fontFamily: FONT }}>{nombreEvento(e.event_name)}</td>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: C.sub, fontFamily: FONT, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{textoProblema(e)}</td>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: C.muted, fontFamily: FONT }}>{nombrePantalla(e.screen)}</td>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: C.muted, fontFamily: FONT }}>{nombreDispositivo(e.device_type)}</td>
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
                      <div style={{ fontSize: 12, fontFamily: FONT, color: C.text, marginBottom: 3 }}>{nombrePantalla(screen)}</div>
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
          <SeccionTitulo titulo="Correcciones de datos recientes" />
          <div style={{ ...card(), padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {['Fecha', 'Dato corregido', 'Valor anterior', 'Valor nuevo', 'Motivo'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, fontFamily: FONT }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.auditorias_recientes!.map((a: any, i: number) => (
                  <tr key={a.id} style={{ borderBottom: `1px solid ${C.border}22`, background: i % 2 === 0 ? 'transparent' : '#ffffff05' }}>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: C.sub, fontFamily: FONT, whiteSpace: 'nowrap' }}>{fechaCorta(a.created_at)}</td>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: C.yellow, fontFamily: FONT }}>{campoLegible(a.campo)}</td>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: C.muted, fontFamily: FONT }}>{valorLegible(a.valor_anterior)}</td>
                    <td style={{ padding: '8px 14px', fontSize: 12, color: C.text, fontFamily: FONT }}>{valorLegible(a.valor_nuevo)}</td>
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
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [page, setPage]         = useState(0)
  const [filtros, setFiltros]   = useState<TelemetriaFiltros>(() => filtrosTelemetriaDefault())

  const cargar = useCallback(() => {
    setLoading(true)
    setError(null)
    const params: Record<string, string> = { page: String(page), limit: '100' }
    if (filtros.from)        params.from         = filtros.from
    if (filtros.to)          params.to           = filtros.to
    if (filtros.event_name)  params.event_name   = filtros.event_name
    if (filtros.category)    params.category     = filtros.category
    if (filtros.status === 'errores') params.only_errors = '1'
    if (filtros.app_version) params.app_version  = filtros.app_version
    if (filtros.device_type) params.device_type  = filtros.device_type
    fetchObs('events', params).then(setData).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [page, filtros])

  useEffect(() => { cargar() }, [cargar])

  const setCampo = (k: keyof TelemetriaFiltros, v: string) => {
    setPage(0)
    setFiltros(f => ({ ...f, [k]: v }))
  }

  const limpiarFiltros = () => {
    setPage(0)
    setFiltros(filtrosTelemetriaDefault())
  }

  const inputStyle: React.CSSProperties = { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 10px', color: C.text, fontFamily: FONT, fontSize: 12, width: '100%' }
  const labelStyle: React.CSSProperties = { fontSize: 11, color: C.muted, fontFamily: FONT, marginBottom: 4, display: 'block' }
  const eventos = data?.events ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={card()}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={labelStyle}>Desde</label>
            <input type="date" style={inputStyle} value={filtros.from} onChange={e => setCampo('from', e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={labelStyle}>Hasta</label>
            <input type="date" style={inputStyle} value={filtros.to} onChange={e => setCampo('to', e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={labelStyle}>Agentes</label>
            <div style={{ ...inputStyle, color: C.sub }}>Todos</div>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={labelStyle}>Actividad</label>
            <input type="text" style={inputStyle} placeholder="Todas" value={filtros.event_name} onChange={e => setCampo('event_name', e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={labelStyle}>Área</label>
            <select style={inputStyle} value={filtros.category} onChange={e => setCampo('category', e.target.value)}>
              <option value="">Todas</option>
              {['sistema','fichaje','supervision','turno','nav','admin','error'].map(c => <option key={c} value={c}>{nombreCategoria(c)}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={labelStyle}>Versión</label>
            <input type="text" style={inputStyle} placeholder="Todas" value={filtros.app_version} onChange={e => setCampo('app_version', e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={labelStyle}>Estado</label>
            <select style={inputStyle} value={filtros.status} onChange={e => setCampo('status', e.target.value)}>
              <option value="">Todos</option>
              <option value="errores">Solo problemas</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 100 }}>
            <label style={labelStyle}>Dispositivo</label>
            <select style={inputStyle} value={filtros.device_type} onChange={e => setCampo('device_type', e.target.value)}>
              <option value="">Todos</option>
              <option value="mobile">Móvil</option>
              <option value="desktop">Escritorio</option>
            </select>
          </div>
          <button onClick={limpiarFiltros} style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 18px', fontWeight: 700, fontFamily: FONT, fontSize: 13, cursor: 'pointer' }}>Restablecer</button>
        </div>
        <div style={{ fontSize: 11, color: C.muted, fontFamily: FONT, marginTop: 10 }}>
          Filtro inicial: últimos 7 días · todos los agentes · todas las versiones · todos los estados.
        </div>
      </div>

      {loading && <Spinner />}
      {error && <Error mensaje={error} />}
      {!loading && !error && data && (
        <>
          <div style={{ fontSize: 12, color: C.muted, fontFamily: FONT }}>{eventos.length} registros mostrados</div>
          {eventos.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <div style={{ ...card(), padding: 0, overflow: 'hidden', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      {['Fecha', 'Actividad', 'Área', 'Pantalla', 'Duración', 'Problema', 'Ubicación', 'Conexión', 'Versión', 'Dispositivo'].map(h => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, fontFamily: FONT, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {eventos.map((e: any, i: number) => (
                      <tr key={e.id ?? i} style={{ borderBottom: `1px solid ${C.border}22`, background: i % 2 === 0 ? 'transparent' : '#ffffff04' }}>
                        <td style={{ padding: '7px 12px', fontSize: 11, color: C.sub, fontFamily: FONT, whiteSpace: 'nowrap' }}>{fechaCorta(e.client_ts)}</td>
                        <td style={{ padding: '7px 12px', fontSize: 12, color: e.err_code ? C.red : C.text, fontFamily: FONT, whiteSpace: 'nowrap' }}>{nombreEvento(e.event_name)}</td>
                        <td style={{ padding: '7px 12px' }}><span style={badge(e.event_category === 'error' ? C.red : C.blue)}>{nombreCategoria(e.event_category)}</span></td>
                        <td style={{ padding: '7px 12px', fontSize: 11, color: C.muted, fontFamily: FONT }}>{nombrePantalla(e.screen)}</td>
                        <td style={{ padding: '7px 12px', fontSize: 12, color: C.sub, fontFamily: FONT }}>{ms(e.duration_ms)}</td>
                        <td style={{ padding: '7px 12px', fontSize: 11, color: e.err_code || e.err_message ? C.red : C.green, fontFamily: FONT, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.err_code || e.err_message ? textoProblema(e) : 'Sin problemas'}</td>
                        <td style={{ padding: '7px 12px', fontSize: 11, color: C.muted, fontFamily: FONT, whiteSpace: 'nowrap' }}>{e.gps_status || e.gps_lat ? 'Disponible' : 'No informado'}</td>
                        <td style={{ padding: '7px 12px', fontSize: 11, color: C.muted, fontFamily: FONT }}>{humanizarCodigo(e.network_type, 'No informado')}</td>
                        <td style={{ padding: '7px 12px' }}>{e.app_version ? <span style={badge(C.blue)}>{e.app_version}</span> : '—'}</td>
                        <td style={{ padding: '7px 12px', fontSize: 11, color: C.muted, fontFamily: FONT }}>{nombreDispositivo(e.device_type)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ padding: '6px 16px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontFamily: FONT, fontSize: 12, cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.4 : 1 }}>← Anterior</button>
                <span style={{ padding: '6px 12px', fontSize: 12, color: C.muted, fontFamily: FONT }}>Página {page + 1}</span>
                <button onClick={() => setPage(p => p + 1)} disabled={eventos.length < 100} style={{ padding: '6px 16px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontFamily: FONT, fontSize: 12, cursor: eventos.length < 100 ? 'not-allowed' : 'pointer', opacity: eventos.length < 100 ? 0.4 : 1 }}>Siguiente →</button>
              </div>
            </>
          )}
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
  if (!data)   return <EmptyState />

  const res = data.resumen ?? {}
  const pantallas = data.pantallas_mas_usadas ?? []
  const eventos = data.eventos_mas_frecuentes ?? []
  const actividadUsuarios = data.actividad_por_usuario ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 12, color: C.muted, fontFamily: FONT }}>Período:</span>
        {[7, 14, 30, 60, 90].map(d => (
          <button key={d} onClick={() => setDays(String(d))} style={{ padding: '4px 12px', background: days === String(d) ? C.yellow : C.card, color: days === String(d) ? '#000' : C.text, border: `1px solid ${days === String(d) ? C.yellow : C.border}`, borderRadius: 6, fontFamily: FONT, fontSize: 12, cursor: 'pointer', fontWeight: days === String(d) ? 700 : 400 }}>{d}d</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KpiCard label="Acciones analizadas" value={(res.total_eventos_analizados ?? 0).toLocaleString()} />
        <KpiCard label="Usuarios activos" value={res.usuarios_activos_periodo ?? 0} />
        <KpiCard label="Supervisiones" value={res.supervisiones_realizadas ?? 0} color={C.green} />
        <KpiCard label="Intervenciones" value={res.intervenciones_realizadas ?? 0} color={C.orange} />
        <KpiCard label="Correcciones admin" value={res.correcciones_admin ?? 0} color={res.correcciones_admin > 20 ? C.orange : C.sub} />
        <KpiCard label="Posibles abandonos" value={res.posibles_abandonos_ingreso ?? 0} color={res.posibles_abandonos_ingreso > 5 ? C.red : C.green} sub="ingresos sin confirmar" />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <SeccionTitulo titulo="Pantallas más utilizadas" />
          <div style={card({ padding: pantallas.length ? '12px 0' : 20 })}>
            {pantallas.length === 0 ? <div style={{ fontSize: 12, color: C.muted, fontFamily: FONT }}>{SIN_REGISTROS}</div> : pantallas.slice(0, 12).map(([screen, cnt]: [string, number], i: number) => {
              const max = (pantallas[0]?.[1] ?? 1) as number
              return (
                <div key={screen} style={{ padding: '6px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 11, color: C.muted, width: 16, fontFamily: FONT }}>{i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontFamily: FONT, color: C.text, marginBottom: 3 }}>{nombrePantalla(screen)}</div>
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
          <SeccionTitulo titulo="Actividades más frecuentes" />
          <div style={card({ padding: eventos.length ? '12px 0' : 20 })}>
            {eventos.length === 0 ? <div style={{ fontSize: 12, color: C.muted, fontFamily: FONT }}>{SIN_REGISTROS}</div> : eventos.slice(0, 15).map(([ev, cnt]: [string, number], i: number) => {
              const max = (eventos[0]?.[1] ?? 1) as number
              return (
                <div key={ev} style={{ padding: '5px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 11, color: C.muted, width: 16, fontFamily: FONT }}>{i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontFamily: FONT, color: C.sub, marginBottom: 3 }}>{nombreEvento(ev)}</div>
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

      <div>
        <SeccionTitulo titulo="Actividad por usuario" sub="Ordenado por cantidad de acciones" />
        {actividadUsuarios.length === 0 ? <EmptyState /> : (
          <div style={{ ...card(), padding: 0, overflow: 'hidden', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {['Usuario', 'Rol', 'Acciones', 'Problemas', 'Tasa de problema', 'Pantallas usadas'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, fontFamily: FONT }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {actividadUsuarios.map((u: any, i: number) => (
                  <tr key={u.user_id ?? i} style={{ borderBottom: `1px solid ${C.border}22`, background: i % 2 === 0 ? 'transparent' : '#ffffff04' }}>
                    <td style={{ padding: '8px 14px', fontSize: 13, color: C.text, fontFamily: FONT }}>{u.usuario ? `${u.usuario.apellido}, ${u.usuario.nombre}` : 'Usuario desconocido'}</td>
                    <td style={{ padding: '8px 14px' }}><span style={badge(C.blue)}>{nombreRol(u.rol)}</span></td>
                    <td style={{ padding: '8px 14px', fontSize: 13, fontWeight: 700, color: C.text, fontFamily: FONT }}>{u.total_eventos}</td>
                    <td style={{ padding: '8px 14px', fontSize: 13, color: u.errores > 0 ? C.red : C.green, fontFamily: FONT }}>{u.errores}</td>
                    <td style={{ padding: '8px 14px' }}><span style={badge(u.tasa_error_pct > 10 ? C.red : u.tasa_error_pct > 5 ? C.orange : C.green)}>{u.tasa_error_pct}%</span></td>
                    <td style={{ padding: '8px 14px', fontSize: 13, color: C.sub, fontFamily: FONT }}>{u.pantallas_distintas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {[
          { titulo: 'Supervisores más activos', data: data.supervisores_mas_activos, key: 'supervisiones', label: 'supervisiones' },
          { titulo: 'Guardias con más problemas de ubicación', data: data.guardias_mas_errores_gps, key: 'errores_gps', label: 'problemas' },
          { titulo: 'Supervisores con más intervenciones', data: data.supervisores_mas_intervenciones, key: 'intervenciones', label: 'intervenciones' },
        ].map(({ titulo, data: d, key, label }) => (
          <div key={titulo} style={{ flex: 1, minWidth: 220 }}>
            <SeccionTitulo titulo={titulo} />
            <div style={card()}>
              {(d ?? []).slice(0, 8).map((item: any, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: C.muted, width: 16 }}>{i + 1}</div>
                  <div style={{ flex: 1, fontSize: 12, color: C.text, fontFamily: FONT }}>
                    {item.usuario ? `${item.usuario.apellido ?? ''}, ${item.usuario.nombre ?? ''}` : 'Usuario desconocido'}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.yellow, fontFamily: FONT }}>{item[key]} <span style={{ fontWeight: 400, color: C.muted }}>{label}</span></div>
                </div>
              ))}
              {(d?.length ?? 0) === 0 && <div style={{ fontSize: 12, color: C.muted, fontFamily: FONT }}>{SIN_REGISTROS}</div>}
            </div>
          </div>
        ))}
      </div>

      {(data.objetivos_mas_novedades?.length ?? 0) > 0 && (
        <div>
          <SeccionTitulo titulo="Objetivos con más novedades" />
          <div style={card({ padding: '12px 0' })}>
            {data.objetivos_mas_novedades!.slice(0, 10).map((item: any, i: number) => (
              <div key={i} style={{ padding: '7px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 11, color: C.muted, width: 16 }}>{i + 1}</div>
                <div style={{ flex: 1, fontSize: 12, color: C.text, fontFamily: FONT }}>{item.objetivo?.nombre ?? 'Objetivo desconocido'}</div>
                <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT }}>{item.objetivo?.cliente ?? ''}</div>
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
  if (!data)   return <EmptyState />

  const res = data.resumen ?? {}
  const bd  = data.breakdowns ?? {}
  const sesiones = data.sesiones ?? []

  function Breakdown({ titulo, data: d }: { titulo: string; data: Record<string, number> }) {
    const total = Object.values(d).reduce((a, b) => a + b, 0)
    const entries = Object.entries(d).sort((a, b) => b[1] - a[1])
    return (
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, fontFamily: FONT, marginBottom: 10 }}>{titulo}</div>
        {entries.length === 0 ? <div style={{ fontSize: 12, color: C.muted, fontFamily: FONT }}>{SIN_REGISTROS}</div> : entries.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ flex: 1, fontSize: 12, color: C.text, fontFamily: FONT }}>{titulo === 'Por rol' ? nombreRol(k) : titulo === 'Por dispositivo' ? nombreDispositivo(k) : humanizarCodigo(k, 'Sin dato')}</div>
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
        <KpiCard label="Duración habitual" value={res.p50_duracion_s != null ? Math.round(res.p50_duracion_s / 60) + 'min' : '—'} />
        <KpiCard label="Duración alta" value={res.p95_duracion_s != null ? Math.round(res.p95_duracion_s / 60) + 'min' : '—'} />
      </div>

      <div style={card()}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: FONT, marginBottom: 16 }}>Distribución de sesiones</div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Breakdown titulo="Por rol" data={bd.por_rol ?? {}} />
          <Breakdown titulo="Por dispositivo" data={bd.por_dispositivo ?? {}} />
          <Breakdown titulo="Por sistema" data={bd.por_os ?? {}} />
          <Breakdown titulo="Por navegador" data={bd.por_browser ?? {}} />
          <Breakdown titulo="Por versión" data={bd.por_version ?? {}} />
        </div>
      </div>

      <div>
        <SeccionTitulo titulo="Sesiones recientes" />
        {sesiones.length === 0 ? <EmptyState /> : (
          <div style={{ ...card(), padding: 0, overflow: 'hidden', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {['Inicio', 'Usuario', 'Rol', 'Dispositivo', 'Versión', 'Duración', 'Estado'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, fontFamily: FONT, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sesiones.map((s: any, i: number) => (
                  <tr key={s.id ?? i} style={{ borderBottom: `1px solid ${C.border}22`, background: i % 2 === 0 ? 'transparent' : '#ffffff04' }}>
                    <td style={{ padding: '7px 12px', fontSize: 11, color: C.sub, fontFamily: FONT, whiteSpace: 'nowrap' }}>{fechaCorta(s.started_at)}</td>
                    <td style={{ padding: '7px 12px', fontSize: 12, color: C.text, fontFamily: FONT }}>{s.usuario ? `${s.usuario.apellido}, ${s.usuario.nombre}` : 'Usuario desconocido'}</td>
                    <td style={{ padding: '7px 12px' }}><span style={badge(C.blue)}>{nombreRol(s.user_rol)}</span></td>
                    <td style={{ padding: '7px 12px', fontSize: 11, color: C.muted, fontFamily: FONT }}>{nombreDispositivo(s.device_type)}</td>
                    <td style={{ padding: '7px 12px' }}>{s.app_version ? <span style={badge(C.blue)}>{s.app_version}</span> : '—'}</td>
                    <td style={{ padding: '7px 12px', fontSize: 11, color: C.muted, fontFamily: FONT }}>{s.duration_s != null ? Math.round(s.duration_s / 60) + 'min' : '—'}</td>
                    <td style={{ padding: '7px 12px' }}><span style={badge(s.ended_at ? C.muted : C.green)}>{s.ended_at ? 'Cerrada' : 'Activa'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
// ── Tab: CALIDAD DE DATOS ─────────────────────────────────────────────────────

function TabCalidad({ onNavigate }: { onNavigate?: ObservatorioNavigate }) {
  const [data, setData]       = useState<QualityData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const cargar = useCallback(() => {
    setLoading(true)
    setError(null)
    fetchObs('quality').then(setData).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const estadoColor: Record<string, string> = { ok: C.green, advertencia: C.orange, critico: C.red }
  const estadoIcon:  Record<string, string> = { ok: '✓', advertencia: '⚠', critico: '✗' }
  const destinoPorEntidad: Record<string, string> = {
    usuarios: 'guardias',
    objetivos: 'objetivos',
    turnos: 'turnos',
    registros_asistencia: 'asistencia',
    evidencias: 'asistencia',
    supervisiones: 'supervisiones',
    novedades: 'novedades',
  }

  const navegarCheck = (check: any) => {
    const destino = destinoPorEntidad[check.entidad]
    if (!destino || !onNavigate || check.cantidad === 0) return
    onNavigate(destino, {
      tipo: 'calidad_datos',
      label: check.nombre,
      ids: check.ids_afectados ?? check.ids_ejemplo ?? [],
    })
  }

  const checks = data?.checks ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={cargar} disabled={loading} style={{ background: C.yellow, color: '#000', border: 'none', borderRadius: 6, padding: '8px 20px', fontWeight: 700, fontFamily: FONT, fontSize: 13, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Revisando datos...' : 'Actualizar revisión'}
        </button>
        {data?.ejecutado_en && (
          <span style={{ fontSize: 12, color: C.muted, fontFamily: FONT }}>
            Actualizado: {fechaCorta(data.ejecutado_en)}
          </span>
        )}
      </div>

      {loading && <Spinner />}
      {error && <Error mensaje={error} />}

      {data && !loading && !error && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <KpiCard label="Controles realizados" value={data.resumen?.total_checks ?? 0} />
            <KpiCard label="Críticos" value={data.resumen?.criticos ?? 0} color={data.resumen?.criticos > 0 ? C.red : C.green} />
            <KpiCard label="Advertencias" value={data.resumen?.advertencias ?? 0} color={data.resumen?.advertencias > 0 ? C.orange : C.green} />
            <KpiCard label="Sin problemas" value={data.resumen?.ok ?? 0} color={C.green} />
          </div>

          {checks.length === 0 ? <EmptyState /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {checks.map((c: any) => (
                <div key={c.nombre} style={card({ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '14px 20px', borderLeft: `4px solid ${estadoColor[c.estado]}` })}>
                  <div style={{ fontSize: 18, color: estadoColor[c.estado], fontWeight: 900, minWidth: 20 }}>{estadoIcon[c.estado]}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: FONT }}>{c.nombre}</div>
                    <div style={{ fontSize: 12, color: C.sub, fontFamily: FONT, marginTop: 2 }}>{c.descripcion}</div>
                    {c.ejemplos?.length > 0 && (
                      <div style={{ fontSize: 11, color: C.muted, fontFamily: FONT, marginTop: 4 }}>
                        Ejemplos: {c.ejemplos.join(' · ')}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: estadoColor[c.estado], fontFamily: FONT }}>{c.cantidad}</div>
                    <div style={{ fontSize: 11, color: C.muted, fontFamily: FONT }}>{areaOperativa(c.entidad)}</div>
                    <button
                      type="button"
                      onClick={() => navegarCheck(c)}
                      disabled={!onNavigate || c.cantidad === 0}
                      style={{
                        background: c.cantidad > 0 ? C.yellow : C.card,
                        color: c.cantidad > 0 ? '#000' : C.muted,
                        border: `1px solid ${c.cantidad > 0 ? C.yellow : C.border}`,
                        borderRadius: 6,
                        padding: '6px 12px',
                        fontFamily: FONT,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: !onNavigate || c.cantidad === 0 ? 'not-allowed' : 'pointer',
                        opacity: !onNavigate || c.cantidad === 0 ? 0.55 : 1,
                      }}
                    >
                      {accionOperativa(c.entidad)}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!data && !loading && !error && <EmptyState />}
    </div>
  )
}
// ── Componente principal ──────────────────────────────────────────────────────

export default function ObservacionSistema({ onNavigate }: { onNavigate?: ObservatorioNavigate }) {
  const [tab, setTab] = useState<Tab>('resumen')
  const informeRef = useRef<HTMLDivElement>(null)

  const tabs: { id: Tab; label: string; icono: string }[] = [
    { id: 'resumen',    label: 'Resumen',         icono: '📊' },
    { id: 'telemetria', label: 'Telemetría',       icono: '🔭' },
    { id: 'uso',        label: 'Uso del sistema',  icono: '📈' },
    { id: 'sesiones',   label: 'Sesiones',         icono: '💻' },
    { id: 'calidad',    label: 'Calidad de datos', icono: '✓' },
  ]
  const tabActiva = tabs.find(t => t.id === tab)

  return (
    <div style={{ fontFamily: FONT }}>
      {/* Encabezado */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, fontFamily: FONT, margin: 0 }}>Observación del Sistema</h1>
          <p style={{ fontSize: 13, color: C.muted, margin: '6px 0 0', fontFamily: FONT }}>
            Estado del sistema · Uso operativo · Calidad de datos · Trazabilidad
          </p>
        </div>
        <ReportActions targetRef={informeRef} titulo={`Observatorio - ${tabActiva?.label ?? 'Informe'}`} />
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
      <style>{`@media print { body * { visibility: hidden !important; } [data-observatorio-print], [data-observatorio-print] * { visibility: visible !important; } [data-observatorio-print] { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; background: white !important; color: black !important; } }`}</style>
      <div ref={informeRef} data-observatorio-print="true">
        {tab === 'resumen'    && <TabResumen />}
        {tab === 'telemetria' && <TabTelemetria />}
        {tab === 'uso'        && <TabUso />}
        {tab === 'sesiones'   && <TabSesiones />}
        {tab === 'calidad'    && <TabCalidad onNavigate={onNavigate} />}
      </div>
    </div>
  )
}
