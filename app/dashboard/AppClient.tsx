'use client'
import { useEffect, useState, useCallback, useRef, Fragment, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { supabase, formatHoras, calcAlertaEntrada, calcAlertaSalida, calcHorasTrabajadas } from '@/lib/supabase'
import { effectiveGuardia, effectiveObjetivo, scoreRegistro, selectRegistroPrincipal, horasRealesRegistro, horasLiquidablesRegistro, resolverLineaLiquidacion, esPeriodoTransicion, mejorRegistroPorTurno, turnosReconocidosHastaCorte, totalHorasLiquidables, fechaCorteOperativa, turnosOperativosDelMes, turnosExigiblesHastaAhora, totalPendiente, turnoExigible, finProgramadoTurno } from '@/lib/liquidacion'
import { fetchPaginado, fetchPaginadoResult } from '@/lib/fetch-paginado'
import {
  ETIQUETA_ESTADO_REVISION, REVISION_SIN_TOCAR, claveRevision,
  construirRevisionPorClave, esPendienteDeAccion, estadoRevision,
} from '@/lib/bandeja-planillas'
import type { EstadoRevision, EstadoRevisionClave } from '@/lib/bandeja-planillas'
import type { Usuario, Objetivo, Turno, RegistroAsistencia, Novedad } from '@/lib/supabase'
import { FILTROS_FECHA_TURNOS, MENSAJE_TURNO_SUPERPUESTO, fechasVecinasTurno, fechaActualTurno, filtroFechaTurnosIncluye, filtroFechaTurnosParaFecha, rangoFiltroFechaTurnos, tieneTurnoSuperpuesto, turnoSinCoberturaOperativa, objetivoEstaOperativo, idsObjetivosPausados, registroTieneEntradaConfirmada } from '@/lib/turnos'
import type { FiltroFechaTurnos } from '@/lib/turnos'
import { formatFechaHora } from '@/lib/formato'
// Única ruta para escribir lat/lng/radio de un objetivo. `authenticated` no
// tiene privilegio de UPDATE sobre esas columnas: van sí o sí por acá.
import { actualizarUbicacionObjetivo } from '@/lib/legajo-objetivo'
// Lectura del GPS de asistencia. Vive en lib/ porque lo comparte la Página GPS:
// `registros_asistencia` tiene dos nomenclaturas de columnas y tiene que haber
// una sola función que las resuelva.
import {
  GPS_PRECISION_MAX_METROS,
  numeroGps,
  gpsRegistroAsistencia,
  metrosGpsTexto,
  estadoGpsRegistro,
  distanciaGpsRegistro,
  coordenadasGpsTexto,
  estadoGpsTexto,
  distanciaMetrosCoordenadas,
  auditoriaSupervisionGps,
} from '@/lib/gps-asistencia'
import { MENSAJE_SIN_PUESTOS_ACTIVOS, obtenerPuestosActivos, obtenerPuestosActivosDeObjetivos, resolverPuestoTurno } from '@/lib/puestos'
import type { EstadoPuestos } from '@/lib/puestos'
// Programación semanal de supervisores. La expansión de las reglas en filas
// diarias y el descarte de duplicados son puros y viven en lib/ para poder
// testearlos: la pantalla sólo consulta, muestra el conteo e inserta.
import {
  TIPOS_EVENTO_GUARDIA,
  TIPOS_SIN_COBERTURA,
  etiquetaDias,
  normalizarTextoGuardia,
  previsualizarDesdeReglas,
  previsualizarGeneracion,
  rangoDelMes,
  resumenGeneracion,
  resumenMes,
} from '@/lib/guardias-supervisor'
import type { PrevisionGeneracion, PrevisionMes, ReglaSemanal } from '@/lib/guardias-supervisor'
// LA resolución de responsables operativos (guardia efectiva → único
// responsable de zona → nadie). Compartida con SupervisorMobile y push:
// ninguna pantalla vuelve a calcular esto por su cuenta.
import { TEXTO_ORIGEN, guardiaCubreInstante, resolverResponsablesOperativos } from '@/lib/responsables-operativos'
import type { OrigenResolucion } from '@/lib/responsables-operativos'
// Clasificación de carga operativa: exclusiva / compartida (contada una vez) /
// sin supervisor. NO son horas trabajadas por el supervisor y no se reparten.
import { LEYENDA_CARGA, cargaDeSupervisor, clasificarCargaZonas } from '@/lib/carga-operativa'
import type { CargaZona } from '@/lib/carga-operativa'
import SupervisorMobile from '@/components/supervisor/SupervisorMobile'
import GuardiaMobile from '@/components/guardia/GuardiaMobile'
import ObservacionSistema from '@/components/observacion/ObservacionSistema'
import ReferenciasIAPanel from '@/components/ia/ReferenciasIAPanel'
import AnalisisIAPanel from '@/components/ia/AnalisisIAPanel'
import CentroOperativoObjetivo from '@/components/objetivos/CentroOperativoObjetivo'
import BandejaPlanillas from '@/components/supervisor/BandejaPlanillas'
import ControlDeRondasPanel from '@/components/rondas/ControlDeRondasPanel'
import RondaAlertasPanel from '@/components/rondas/RondaAlertasPanel'
import RondasPausadasPanel from '@/components/rondas/RondasPausadasPanel'
// Mismo panel de configuración que usa el legajo del objetivo. Se monta también
// en la solapa Rondas para poder editar rondas y puntos sin entrar objetivo por
// objetivo. No es un editor nuevo: es el que ya existía.
import RondasNativasPanel from '@/components/rondas/RondasNativasPanel'
import { Badge, alpha, FONT_BRAND } from '@/components/ui/base'
import { brandAssets, brandColors, brandTypography, semanticColors } from '@/lib/brand-theme'
import { indexarUltimaSupervision, objetivoSupervisionVencida } from '@/lib/supervisiones'
import {
  alertaEstaIntervenida,
  calcularMinutosTardanzaRegistro,
  claveOcurrenciaAlerta,
  ESTADOS_SIN_OBLIGACION,
  compararIntervencionesMasReciente,
  detectarAlertasOperativas,
  efectoIntervencionOperativa,
  estadoCicloVidaAlerta,
  intervencionesDeOcurrencia,
} from '@/lib/revision-operativa'
import type { AccionIntervencionOperativa, TipoAlertaOperativa } from '@/lib/revision-operativa'
import { formatCuil } from '@/lib/revision-operativa'
import { CARACTERISTICAS_TURNO, ETIQUETA_CARACTERISTICA, MOTIVO_CAPACITACION, caracteristicaTurno, esCapacitacion, etiquetaCaracteristica, notaCapacitacionExcluida, notaCapacitacionIncluida } from '@/lib/caracteristica-turno'
import { ETIQUETA_VINCULACION, sugerirVinculacion } from '@/lib/vinculacion-puestos'
import { DETALLE_COBERTURA_EQUIVALENTE, ETIQUETA_PREVISION, MENSAJE_VACANTE_COMPATIBLE, clavePrevision, coberturaEquivalenteOtraPosicion, payloadCreacionParcial, previsualizarMes, resumenConfirmacion, vacantesCompatibles } from '@/lib/programacion'
import type { EstadoPrevision, ResultadoCreacion, ResultadoPrevision } from '@/lib/programacion'
import { ETIQUETA_CLASIFICACION, ETIQUETA_COMPARACION, NOTA_ALCANCE_MOTOR, analizarCoberturaHistorica } from '@/lib/cobertura-historica'
import type { ClasificacionPatron, ResultadoCobertura } from '@/lib/cobertura-historica'

const SupervisionMap = dynamic(() => import('@/components/supervisiones/SupervisionMap'), {
  ssr: false,
  loading: () => <div style={{ height:360, display:'flex', alignItems:'center', justifyContent:'center', background:'#111827', border:'1px solid #1e2d42', borderRadius:8, color:'#94a3b8', marginBottom:20 }}>Cargando mapa...</div>,
})

const AsistenciaMap = dynamic(() => import('@/components/asistencia/AsistenciaMap'), {
  ssr: false,
  loading: () => <div style={{ height:360, display:'flex', alignItems:'center', justifyContent:'center', background:'#111827', border:'1px solid #1e2d42', borderRadius:8, color:'#94a3b8', marginBottom:20 }}>Cargando mapa...</div>,
})

const PaginaGps = dynamic(() => import('@/components/gps/PaginaGps'), {
  ssr: false,
  loading: () => <div style={{ color:'#64748b', padding:48, textAlign:'center' }}>Cargando mapa operativo…</div>,
})

interface EvidenciaAdmin {
  id: string
  proceso_id: string
  tipo_evidencia: string
  storage_path: string
  bucket: string
  signedUrl?: string | null
}

type TipoAlertaOperativaAdmin = TipoAlertaOperativa
type AccionIntervencionAdmin = AccionIntervencionOperativa
type TipoSolicitudAdmin = 'crear_objetivo' | 'baja_objetivo' | 'crear_vigilador' | 'baja_vigilador'
type EstadoSolicitudAdmin = 'pendiente' | 'aprobado' | 'rechazado'
type EstadoSupervisionAdmin = 'ok' | 'con_observacion' | 'critico'
type AdminMobileView = 'admin' | 'supervisor'
type SolicitudAdmin = {
  id: string
  solicitante_id: string
  tipo: TipoSolicitudAdmin
  entidad: string
  entidad_id?: string | null
  datos_json: Record<string, any> | null
  estado: EstadoSolicitudAdmin
  aprobado_por?: string | null
  fecha_aprobacion?: string | null
  comentario_admin?: string | null
  created_at: string
}

type ChecklistPlantillaAdmin = {
  id: string
  nombre: string
  descripcion?: string | null
  activo: boolean
  created_at?: string
  updated_at?: string
}

type ChecklistItemAdmin = {
  id: string
  plantilla_id: string
  texto: string
  orden: number
  obligatorio: boolean
  criticidad: 'normal' | 'alta'
  foto_obligatoria: boolean
  activo: boolean
  created_at?: string
}

type SupervisionAdmin = {
  id: string
  objetivo_id: string
  supervisor_id: string
  plantilla_id?: string | null
  lat: number | string
  lng: number | string
  precision_gps: number | string
  estado: EstadoSupervisionAdmin
  created_at: string
  observaciones?: string | null
  objetivo?: Pick<Objetivo, 'nombre'> | null
  supervisor?: Pick<Usuario, 'nombre' | 'apellido'> | null
  respuestas?: Pick<SupervisionRespuestaAdmin, 'resultado'>[]
  fotos?: Pick<SupervisionFotoAdmin, 'id' | 'storage_path'>[]
}

type SupervisionRankingAdmin = Pick<SupervisionAdmin, 'id' | 'objetivo_id' | 'supervisor_id' | 'estado' | 'created_at'>

type UltimaSupervisionObjetivoAdmin = {
  objetivo_id: string
  created_at: string
}

type SupervisionRespuestaAdmin = {
  id: string
  supervision_id: string
  item_id: string
  resultado: 'correcto' | 'observado' | 'no_aplica'
  observacion?: string | null
  item?: ChecklistItemAdmin | null
}

type SupervisionFotoAdmin = {
  id: string
  supervision_id: string
  storage_path: string
  created_at?: string
  signedUrl?: string | null
  publicUrl?: string | null
  error?: string | null
}

const ZONA_OPERATIVA_ADMIN = 'Rosario / General'
const JEFE_OPERATIVO_ADMIN = 'Aldo Monzón'
const DIRECTOR_TECNICO_ADMIN = 'Rodolfo Romero'
const ADMIN_MOBILE_VIEW_KEY = 'mercosur_admin_mobile_view'

// alpha() y FONT_BRAND se importan de components/ui/base para poder compartirlos
// con los componentes extraídos de este archivo.

// GPS_PRECISION_MAX_METROS y los helpers de GPS de asistencia se importan de
// lib/gps-asistencia.ts desde que los comparte la Página GPS. No redefinirlos
// acá: la tabla tiene dos nomenclaturas de columnas y una segunda lectura
// terminaría discrepando con la primera.

function detectarPantallaChicaAdmin(): boolean {
  if (typeof window === 'undefined') return false

  const mediaChica = window.matchMedia('(max-width: 900px), (pointer: coarse) and (max-width: 1100px)').matches
  const viewportChico = window.innerWidth <= 900
  const pantallaChica = window.screen?.width ? window.screen.width <= 900 : false
  const mobileUserAgent = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)

  return mediaChica || viewportChico || pantallaChica || mobileUserAgent
}

function leerPreferenciaVistaAdmin(): AdminMobileView | null {
  if (typeof window === 'undefined') return null

  const valor = window.localStorage.getItem(ADMIN_MOBILE_VIEW_KEY)
  return valor === 'admin' || valor === 'supervisor' ? valor : null
}

function guardarPreferenciaVistaAdmin(vista: AdminMobileView) {
  if (typeof window === 'undefined') return

  window.localStorage.setItem(ADMIN_MOBILE_VIEW_KEY, vista)
}

const FONT_BODY = `${brandTypography.currentBody}, sans-serif`
const FONT_DISPLAY = `${brandTypography.currentDisplay}, sans-serif`

const S: Record<string, React.CSSProperties> = {
  app: { display:'flex', minHeight:'100vh', background:brandColors.appBg, color:brandColors.text, fontFamily:FONT_BODY },
  sidebar: { width:240, background:`linear-gradient(180deg, ${brandColors.black} 0%, ${brandColors.surface} 100%)`, borderRight:`1px solid ${alpha(brandColors.yellow, 0.18)}`, boxShadow:`18px 0 48px ${alpha(brandColors.black, 0.26)}`, display:'flex', flexDirection:'column', position:'fixed', top:0, left:0, height:'100vh', zIndex:100 },
  sidebarLogo: { padding:'20px', borderBottom:`1px solid ${alpha(brandColors.yellow, 0.16)}`, background:alpha(brandColors.yellow, 0.04) },
  brand: { fontFamily:FONT_BRAND, fontSize:15, fontWeight:900, color:brandColors.yellow, letterSpacing:0.5 },
  sub: { fontSize:10, color:brandColors.text, marginTop:2, letterSpacing:1, textTransform:'uppercase' as const },
  navSection: { padding:'10px 20px 5px', fontSize:10, color:brandColors.muted, letterSpacing:1.5, textTransform:'uppercase' as const, fontWeight:800 },
  main: { marginLeft:240, flex:1, padding:32, minHeight:'100vh', background:`linear-gradient(180deg, ${alpha(brandColors.surface2, 0.42)} 0%, ${brandColors.appBg} 260px)` },
  card: { background:'#111827', border:'1px solid #1e2d42', borderRadius:12, padding:20, marginBottom:20 },
  title: { fontFamily:'Syne,sans-serif', fontSize:28, fontWeight:800, marginBottom:4 },
  sub2: { color:'#64748b', fontSize:14, marginBottom:24 },
  btn: { display:'inline-flex', alignItems:'center', gap:6, padding:'9px 18px', borderRadius:8, fontSize:13, fontWeight:800, cursor:'pointer', border:'none', fontFamily:FONT_BRAND, transition:'background .15s ease, border-color .15s ease, color .15s ease' },
  btnPrimary: { background:brandColors.yellow, color:brandColors.black, border:`1px solid ${brandColors.yellow}` },
  btnSecondary: { background:alpha(brandColors.surface2, 0.88), color:brandColors.text, border:`1px solid ${brandColors.border}` },
  input: { width:'100%', background:alpha(brandColors.surface2, 0.9), border:`1px solid ${brandColors.border}`, borderRadius:8, padding:'10px 14px', color:brandColors.text, fontSize:14, fontFamily:FONT_BODY, outline:'none' },
  select: { width:'100%', background:alpha(brandColors.surface2, 0.9), border:`1px solid ${brandColors.border}`, borderRadius:8, padding:'10px 14px', color:brandColors.text, fontSize:14, fontFamily:FONT_BODY, outline:'none' },
  label: { display:'block', fontSize:12, color:brandColors.muted, marginBottom:6, fontWeight:800, textTransform:'uppercase' as const, letterSpacing:0.5, fontFamily:FONT_BRAND },
  table: { width:'100%', borderCollapse:'collapse' as const, fontSize:13 },
  th: { textAlign:'left' as const, padding:'10px 14px', color:'#64748b', fontSize:11, letterSpacing:1, textTransform:'uppercase' as const, fontWeight:600, borderBottom:'1px solid #1e2d42' },
  td: { padding:'12px 14px', borderBottom:'1px solid #1e2d42' },
  modalOverlay: { position:'fixed' as const, inset:0, background:'rgba(0,0,0,0.7)', zIndex:1500, display:'flex', alignItems:'center', justifyContent:'center', padding:20 },
  modal: { background:'#111827', border:'1px solid #1e2d42', borderRadius:16, width:'100%', maxWidth:520, maxHeight:'90vh', overflowY:'auto' as const },
  modalHeader: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px 24px', borderBottom:'1px solid #1e2d42' },
  modalTitle: { fontFamily:'Syne,sans-serif', fontSize:18, fontWeight:700 },
  grid2: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 },
  statGrid: { display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:16, marginBottom:28 },
}

const JEFE_OPERATIVO_GUARDIA = 'Aldo Monzón'
const DIRECTOR_TECNICO_GUARDIA = 'Rodolfo Romero'


function StatCard({ label, value, sub, color, icon, onClick }: any) {
  return (
    <div
      onClick={onClick}
      style={{ background:`linear-gradient(180deg, ${alpha(brandColors.surface2, 0.96)} 0%, ${alpha(brandColors.surface, 0.98)} 100%)`, border:`1px solid ${alpha(color || brandColors.yellow, 0.34)}`, borderRadius:8, padding:20, position:'relative', overflow:'hidden', cursor:onClick?'pointer':'default', boxShadow:`0 14px 34px ${alpha(brandColors.black, 0.22)}` }}
      title={onClick ? 'Aplicar filtro' : undefined}
    >
      <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:color }} />
      <div style={{ position:'absolute', top:16, right:16, fontSize:28, opacity:0.15 }}>{icon}</div>
      <div style={{ fontSize:11, color:brandColors.muted, textTransform:'uppercase', letterSpacing:1, fontWeight:800, fontFamily:FONT_BRAND }}>{label}</div>
      <div style={{ fontFamily:FONT_BRAND, fontSize:26, fontWeight:900, margin:'8px 0 4px', color:brandColors.textStrong }}>{value}</div>
      <div style={{ fontSize:12, color:brandColors.text }}>{sub}</div>
    </div>
  )
}

function formatFecha(fecha?: string | null): string {
  if (!fecha) return '—'

  const [year, month, day] = fecha.slice(0, 10).split('-')
  return year && month && day ? `${day}/${month}/${year}` : '—'
}

function formatHoraTurno(hora?: string | null): string {
  if (!hora) return '—'

  return hora.slice(0, 5)
}

function formatSupabaseError(error: unknown, contexto: string): string {
  const err = error as { message?: unknown, details?: unknown, hint?: unknown, code?: unknown }
  const partes = [
    typeof err?.message === 'string' ? err.message : String(error),
    err?.details ? `Detalles: ${String(err.details)}` : '',
    err?.hint ? `Sugerencia: ${String(err.hint)}` : '',
    err?.code ? `Código: ${String(err.code)}` : '',
  ].filter(Boolean)

  return `${contexto}: ${partes.join(' · ')}`
}

function formatHorarioAsignado(turno?: Turno | null): string {
  if (!turno) return '—'

  const inicio = formatHoraTurno(turno.hora_inicio)
  const fin = formatHoraTurno(turno.hora_fin)

  return `${inicio} – ${fin}`
}

function fechaHoraTurnoLocal(fecha?: string | null, hora?: string | null): Date | null {
  if (!fecha || !hora) return null

  const [year, month, day] = fecha.slice(0, 10).split('-').map(Number)
  const [hours, minutes, seconds = 0] = hora.split(':').map(Number)
  if (![year, month, day, hours, minutes, seconds].every(Number.isFinite)) return null

  return new Date(year, month - 1, day, hours, minutes, seconds)
}

function minutosDesdeInicioTurno(turno: Turno, ahora = new Date()): number {
  const inicioTurno = fechaHoraTurnoLocal(turno.fecha, turno.hora_inicio)
  if (!inicioTurno) return 0

  return Math.max(0, Math.floor((ahora.getTime() - inicioTurno.getTime()) / 60000))
}

// numeroGps, gpsRegistroAsistencia, metrosGpsTexto, estadoGpsRegistro,
// distanciaGpsRegistro, coordenadasGpsTexto y estadoGpsTexto se movieron sin
// cambios a lib/gps-asistencia.ts y se importan al principio de este archivo.

function textoAuditoriaGps(registro: RegistroAsistencia | any, tipo: 'ingreso' | 'egreso'): string {
  const gps = gpsRegistroAsistencia(registro, tipo)
  if (!gps) return '⚠ Sin GPS'

  const prefijo = tipo === 'ingreso' ? 'GPS Ingreso' : 'GPS Egreso'
  const estado = estadoGpsRegistro(registro, tipo)
  const distancia = distanciaGpsRegistro(registro, tipo)

  if (estado === 'dentro_radio') return `${prefijo} ✓ · Dentro · ${metrosGpsTexto(distancia)}`
  if (estado === 'fuera_radio') return `${prefijo} ⚠ Fuera · ${metrosGpsTexto(distancia)}`
  if (estado === 'objetivo_sin_gps') return `${prefijo} registrado · Objetivo sin GPS`
  if (estado === 'gps_no_disponible') return '⚠ Sin GPS'

  return `${prefijo} registrado`
}

function textoPrecisionGps(registro: RegistroAsistencia | any): string {
  const ingreso = gpsRegistroAsistencia(registro, 'ingreso')?.precision
  const egreso = gpsRegistroAsistencia(registro, 'egreso')?.precision
  const partes = []

  if (ingreso !== null && ingreso !== undefined) partes.push(`Ingreso ${Math.round(ingreso)} m`)
  if (egreso !== null && egreso !== undefined) partes.push(`Egreso ${Math.round(egreso)} m`)

  return partes.length ? partes.join(' · ') : '⚠ Sin GPS'
}

function objetivoTieneGps(objetivo: Objetivo | any): boolean {
  return numeroGps(objetivo?.lat) !== null && numeroGps(objetivo?.lng) !== null && (numeroGps(objetivo?.radio_metros) || 0) > 0
}

// distanciaMetrosCoordenadas y auditoriaSupervisionGps también se movieron sin
// cambios a lib/gps-asistencia.ts, por el mismo motivo.

function esRolGuardia(rol?: string | null): boolean {
  return rol === 'guardia' || rol === 'vigilador'
}

const esRolAdmin = (rol?: string | null) => String(rol || '').trim().toLowerCase() === 'admin'

function fechaRegistroAsistencia(registro: RegistroAsistencia | any, turno?: Turno | any): string {
  return turno?.fecha || registro.created_at?.slice(0, 10) || ''
}

function ordenRegistroAsistencia(registro: RegistroAsistencia | any, turno?: Turno | any): number {
  const fecha = fechaRegistroAsistencia(registro, turno)
  const hora = registro.hora_entrada_real || '00:00:00'
  const timestamp = fecha ? new Date(`${fecha}T${hora}`).getTime() : new Date(registro.created_at || 0).getTime()

  return Number.isNaN(timestamp) ? 0 : timestamp
}

function minutosDesdeHora(hora?: string | null): number | null {
  if (!hora) return null

  const [hh, mm] = hora.slice(0, 5).split(':').map(Number)
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null

  return hh * 60 + mm
}

function horasProgramadasTurno(turno: Pick<Turno, 'hora_inicio' | 'hora_fin'>): number {
  const inicio = minutosDesdeHora(turno.hora_inicio)
  let fin = minutosDesdeHora(turno.hora_fin)

  if (inicio === null || fin === null) return 0
  if (fin <= inicio) fin += 24 * 60

  return Math.max(0, fin - inicio) / 60
}

// ── Utilidades de fecha Argentina (UTC-3, sin DST) ───────────────────────────
// Toda la lógica de "hoy", "este mes" y rangos de fecha usa este offset fijo.
// No dependemos de la timezone del navegador ni de toISOString() para definir
// fronteras de mes.

function fechaHoyArgentina(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** ISO 8601 del primer instante del mes en Argentina (medianoche AR = 03:00 UTC). */
function inicioMesArgISO(ref = new Date()): string {
  const argDate = new Date(ref.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 7)
  const [year, month] = argDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, 1, 3, 0, 0)).toISOString()
}

/** ISO 8601 del primer instante del mes SIGUIENTE en Argentina. */
function inicioMesSiguienteArgISO(ref = new Date()): string {
  const argDate = new Date(ref.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 7)
  const [year, month] = argDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1 + 1, 1, 3, 0, 0)).toISOString()
}

/** Mes actual en Argentina como "YYYY-MM". */
function mesActualArgentina(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 7)
}


// Alias para compatibilidad con código que aún use inicioMesLocalISO
function inicioMesLocalISO(fecha = new Date()): string {
  return inicioMesArgISO(fecha)
}
function inicioMesSiguienteLocalISO(fecha = new Date()): string {
  return inicioMesSiguienteArgISO(fecha)
}

function NavItem({ id, icon, label, active, badge, onClick }: any) {
  return (
    <div onClick={() => onClick(id)} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 20px', cursor:'pointer', color:active?brandColors.textStrong:brandColors.muted, fontSize:14, fontFamily:FONT_BRAND, fontWeight:active?800:700, transition:'all 0.15s', background:active?alpha(brandColors.yellow, 0.12):'transparent', borderLeft:`3px solid ${active?brandColors.yellow:'transparent'}` }}>
      <span style={{ fontSize:16, width:20, textAlign:'center' }}>{icon}</span>
      {label}
      {badge > 0 && <span style={{ marginLeft:'auto', background:semanticColors.error, color:brandColors.white, fontSize:10, fontWeight:800, borderRadius:10, padding:'1px 7px' }}>{badge}</span>}
    </div>
  )
}

function AdminViewSwitcher({ currentView, onChange, compact = false }: { currentView: AdminMobileView, onChange: (view: AdminMobileView) => void, compact?: boolean }) {
  const opciones: { id: AdminMobileView, label: string }[] = [
    { id: 'admin', label: '🖥 Vista Administración' },
    { id: 'supervisor', label: '📱 Vista Supervisor' },
  ]

  return (
    <div
      style={{
        display:'grid',
        gridTemplateColumns:'1fr 1fr',
        gap:4,
        width:'100%',
        background:alpha(brandColors.surface2, 0.7),
        border:`1px solid ${brandColors.border}`,
        borderRadius:10,
        padding:4,
      }}
    >
      {opciones.map(opcion => {
        const activo = currentView === opcion.id

        return (
          <button
            key={opcion.id}
            type="button"
            onClick={() => onChange(opcion.id)}
            style={{
              ...S.btn,
              justifyContent:'center',
              padding: compact ? '7px 8px' : '8px 12px',
              fontSize: compact ? 11 : 12,
              fontWeight: activo ? 800 : 600,
              background: activo ? alpha(brandColors.yellow, 0.16) : 'transparent',
              color: activo ? brandColors.yellow : brandColors.muted,
              border: activo ? `1px solid ${alpha(brandColors.yellow, 0.5)}` : '1px solid transparent',
              whiteSpace:'nowrap',
            }}
          >
            {opcion.label}
          </button>
        )
      })}
    </div>
  )
}

function AdminViewHeader({ currentView, onChange, compact = false }: { currentView: AdminMobileView, onChange: (view: AdminMobileView) => void, compact?: boolean }) {
  return (
    <div style={{ position:'fixed', top:0, left:0, right:0, zIndex:1000, background:'#111827', borderBottom:`1px solid ${alpha(brandColors.yellow, 0.24)}`, padding:compact ? '10px 12px' : '12px 20px', boxShadow:`0 12px 30px ${alpha(brandColors.black, 0.32)}` }}>
      <div style={{ maxWidth:1180, margin:'0 auto', display:'grid', gridTemplateColumns:compact ? '1fr' : 'minmax(220px, 1fr) 360px', gap:10, alignItems:'center' }}>
        <div>
          <div style={{ fontFamily:FONT_BRAND, fontWeight:900, color:brandColors.textStrong, fontSize:13 }}>Modo administrador</div>
          <div style={{ color:brandColors.muted, fontSize:11 }}>La vista cambia solo en este dispositivo.</div>
        </div>
        <AdminViewSwitcher currentView={currentView} onChange={onChange} compact={compact} />
      </div>
    </div>
  )
}

function Modal({ title, onClose, children, footer }: any) {
  return (
    <div style={S.modalOverlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.modal}>
        <div style={S.modalHeader}>
          <div style={S.modalTitle}>{title}</div>
          <button style={{ background:'none', border:'none', color:'#64748b', cursor:'pointer', fontSize:20 }} onClick={onClose}>✕</button>
        </div>
        <div style={{ padding:24 }}>{children}</div>
        {footer && <div style={{ padding:'16px 24px', borderTop:'1px solid #1e2d42', display:'flex', justifyContent:'flex-end', gap:10 }}>{footer}</div>}
      </div>
    </div>
  )
}

function Login({ onLogin }: { onLogin: (u: any) => void }) {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [resetMsg, setResetMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [magicLoading, setMagicLoading] = useState(false)

  const mensajeErrorAuth = (authError: unknown, accion: string) => {
    const raw = authError instanceof Error
      ? authError.message
      : typeof authError === 'object' && authError && 'message' in authError
        ? String((authError as { message: unknown }).message)
        : String(authError || '')

    if (/invalid login credentials/i.test(raw)) return 'Email o contraseña/DNI incorrectos.'
    if (/email not confirmed/i.test(raw)) return 'El email todavía no fue confirmado. Usá Magic Link o pedí un nuevo enlace.'
    if (/rate limit|too many requests|too many/i.test(raw)) return `Supabase limitó temporalmente los envíos de email. Esperá unos minutos y volvé a intentar. Detalle: ${raw}`
    if (/smtp|email|mail|send|provider/i.test(raw)) return `No se pudo enviar el email de ${accion}. Revisá la configuración SMTP en Supabase. Detalle: ${raw}`
    if (/redirect/i.test(raw)) return `No se pudo generar el enlace de ${accion}. Revisá las URLs permitidas en Supabase Auth. Detalle: ${raw}`

    return raw || `No se pudo completar ${accion}.`
  }

  const login = async () => {
    const emailLogin = email.trim().toLowerCase()
    const passwordLogin = pass.trim()

    setLoading(true)
    setError('')
    setResetMsg('')
    console.log('LOGIN EMAIL', emailLogin)

    const { data, error: err } = await supabase.auth.signInWithPassword({
      email: emailLogin,
      password: passwordLogin,
    })
    console.log('LOGIN ERROR', err)
    console.log('LOGIN DATA', data)

    if (err) {
      setError(mensajeErrorAuth(err, 'inicio de sesión'))
      setLoading(false)
      return
    }

    let { data: perfil, error: perfilError } = await supabase
      .from('usuarios')
      .select('*')
      .eq('auth_user_id', data.user.id)
      .maybeSingle()

    if ((!perfil || perfilError) && data.user.email) {
      const fallback = await supabase
        .from('usuarios')
        .select('*')
        .eq('email', data.user.email.trim().toLowerCase())
        .maybeSingle()

      if (fallback.data) {
        perfil = fallback.data
        perfilError = null
        await supabase
          .from('usuarios')
          .update({ auth_user_id: data.user.id })
          .eq('id', fallback.data.id)
      }
    }

    if (perfilError || !perfil) {
      setError(perfilError?.message || 'Usuario sin perfil asignado')
      await supabase.auth.signOut()
      setLoading(false)
      return
    }

    onLogin(perfil)
    setLoading(false)
  }

  const recuperarPassword = async () => {
    setError('')
    setResetMsg('')
    const emailNormalizado = email.trim().toLowerCase()

    if (!emailNormalizado) {
      setError('Ingresá tu email para recuperar la contraseña')
      return
    }

    setResetLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(emailNormalizado, {
      redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/dashboard` : undefined,
    })

    if (error) {
      setError(mensajeErrorAuth(error, 'recuperación de contraseña'))
    } else {
      setResetMsg('Si el email existe y SMTP está configurado en Supabase, se enviará un enlace de recuperación.')
    }

    setResetLoading(false)
  }

  const enviarMagicLink = async () => {
    setError('')
    setResetMsg('')
    const emailNormalizado = email.trim().toLowerCase()

    if (!emailNormalizado) {
      setError('Ingresá tu email para enviar el enlace de ingreso')
      return
    }

    setMagicLoading(true)
    const { error } = await supabase.auth.signInWithOtp({
      email: emailNormalizado,
      options: {
        emailRedirectTo: typeof window !== 'undefined' ? `${window.location.origin}/dashboard` : undefined,
      },
    })

    if (error) {
      setError(mensajeErrorAuth(error, 'Magic Link'))
    } else {
      setResetMsg('Si el email existe y SMTP está configurado en Supabase, se enviará un enlace de ingreso.')
    }

    setMagicLoading(false)
  }

  return (
    <div style={{
      minHeight:'100vh',
      display:'flex',
      alignItems:'center',
      justifyContent:'center',
      padding:24,
      background:`
        radial-gradient(circle at 18% 18%, ${alpha(brandColors.yellow, 0.18)}, transparent 30%),
        radial-gradient(circle at 82% 8%, ${alpha(brandColors.red, 0.16)}, transparent 26%),
        linear-gradient(135deg, ${brandColors.black} 0%, ${brandColors.appBg} 54%, ${brandColors.carbon} 100%)
      `,
      fontFamily:FONT_BRAND,
    }}>
      <div style={{ width:'100%', maxWidth:420 }}>
        <div style={{ textAlign:'center', marginBottom:30 }}>
          <img
            src={brandAssets.logoFondoOscuro}
            alt="Mercosur Seguridad"
            style={{ width:'min(280px, 78vw)', height:'auto', objectFit:'contain', filter:`drop-shadow(0 18px 34px ${alpha(brandColors.black, 0.5)})` }}
          />
          <div style={{ color:brandColors.text, fontSize:13, marginTop:12, letterSpacing:0.6 }}>Sistema de Control Operativo</div>
        </div>
        <div style={{
          background:alpha(brandColors.surface, 0.94),
          border:`1px solid ${alpha(brandColors.yellow, 0.26)}`,
          borderRadius:16,
          padding:32,
          boxShadow:`0 24px 80px ${alpha(brandColors.black, 0.45)}`,
          backdropFilter:'blur(12px)',
        }}>
          <div style={{ fontFamily:FONT_BRAND, fontSize:20, fontWeight:800, marginBottom:24, color:brandColors.textStrong }}>Iniciar sesión</div>
          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Email</label>
            <input
              style={S.input}
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="usuario@mercosur.com"
            />
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Contraseña</label>
            <input
              style={S.input}
              type="password"
              value={pass}
              onChange={e => setPass(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && login()}
            />
          </div>
          {error && <div style={{ color:semanticColors.error, fontSize:13, marginBottom:12 }}>{error}</div>}
          {resetMsg && <div style={{ color:semanticColors.success, fontSize:13, marginBottom:12 }}>{resetMsg}</div>}
          <button
            style={{ ...S.btn, background:brandColors.yellow, color:brandColors.black, width:'100%', justifyContent:'center', fontFamily:FONT_BRAND, fontWeight:800 }}
            onClick={login}
            disabled={loading}
          >
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
          <button
            style={{ ...S.btn, ...S.btnSecondary, width:'100%', justifyContent:'center', marginTop:10 }}
            onClick={recuperarPassword}
            disabled={resetLoading}
          >
            {resetLoading ? 'Enviando...' : 'Olvidé mi contraseña'}
          </button>
          <button
            style={{ ...S.btn, ...S.btnSecondary, width:'100%', justifyContent:'center', marginTop:10 }}
            onClick={enviarMagicLink}
            disabled={magicLoading}
          >
            {magicLoading ? 'Enviando...' : 'Magic Link'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Dashboard({ guardias, objetivos, turnos, registros, novedades, onNavigate }: any) {
  const hoy = fechaHoyArgentina()
  const mesActual = hoy.slice(0, 7)
  // Coordina Control de Rondas con el resumen de pausadas: son hermanos y sin
  // esto la pausa recién se veía al recargar la página.
  const [pausasToken, setPausasToken] = useState(0)
  // Intervenciones del día, para no seguir pidiendo atención sobre algo que el
  // supervisor ya atendió. Misma consulta que hace Revisión Operativa; acá sólo
  // se leen para filtrar.
  const [intervencionesHoy, setIntervencionesHoy] = useState<any[]>([])
  const usuarios = guardias as Usuario[]
  const objetivosActivos = objetivos.filter((o: Objetivo) => o.estado === 'activo')
  // Alcance del Control de Rondas. Los objetivos de prueba se excluyen acá igual
  // que los excluye el servidor en el resto de las consultas de alcance completo.
  const objetivosControlRondas = objetivosActivos
    .filter((o: Objetivo) => !o.es_prueba)
    .map((o: Objetivo) => ({ id: o.id, nombre: o.nombre || 'Objetivo sin nombre' }))
  const guardiasActivos = usuarios.filter((g: Usuario) => esRolGuardia(g.rol) && g.estado === 'activo')
  const turnosHoy = turnos.filter((t: Turno) => t.fecha === hoy)
  const turnoPorId = new Map<string, Turno>(turnos.map((t: Turno) => [t.id, t]))
  const objetivoPorId = new Map<string, Objetivo>(objetivos.map((o: Objetivo) => [o.id, o]))
  const registrosHoy = registros.filter((r: RegistroAsistencia) => turnoPorId.get(r.turno_id)?.fecha === hoy)
  const registrosMes = registros.filter((r: RegistroAsistencia) => turnoPorId.get(r.turno_id)?.fecha?.slice(0, 7) === mesActual)
  const tieneEntradaConfirmada = (turno: Turno) =>
    registrosHoy.some((r: RegistroAsistencia) => r.turno_id === turno.id && registroTieneEntradaConfirmada(r))
  const tieneSalida = (turno: Turno) =>
    registrosHoy.some((r: RegistroAsistencia) => r.turno_id === turno.id && r.hora_salida_real)
  const registroActivo = registrosHoy.filter((r: RegistroAsistencia) => r.hora_entrada_real && !r.hora_salida_real)
  const guardiasEnTurno = new Set(registroActivo.map((r: RegistroAsistencia) => r.guardia_id)).size
  // Atención operativa. Dos filtros que antes faltaban acá y que Revisión
  // Operativa sí aplicaba, así que el panel mostraba más de lo que había para
  // hacer:
  //   · `objetivos` — un objetivo pausado conserva sus turnos pero no genera
  //     obligación, así que tampoco alertas;
  //   · `alertaEstaIntervenida` — lo que el supervisor ya atendió deja de pedir
  //     atención. Es la misma función que usa Revisión Operativa: una sola
  //     definición de "intervenida", no dos.
  const idsTurnosHoy = turnosHoy.map((t: Turno) => t.id).join(',')
  useEffect(() => {
    let vigente = true
    const ids = idsTurnosHoy ? idsTurnosHoy.split(',') : []
    if (ids.length === 0) { setIntervencionesHoy([]); return }
    supabase
      .from('supervisor_intervenciones')
      .select('*')
      .in('turno_id', ids)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (vigente) setIntervencionesHoy(data || []) })
    return () => { vigente = false }
  }, [idsTurnosHoy])

  const alertasOperativasHoy = detectarAlertasOperativas({
    turnos: turnosHoy,
    registros: registrosHoy,
    objetivos,
  }).filter(a => !alertaEstaIntervenida(intervencionesHoy, a.turno_id, a.tipo_alerta, a.registro_asistencia_id))
  const idsTurnosDescubiertos = new Set(alertasOperativasHoy.filter(a => a.tipo_alerta === 'descubierto').map(a => a.turno_id))
  const idsTurnosSinFichar = new Set(alertasOperativasHoy.filter(a => a.tipo_alerta === 'sin_fichar').map(a => a.turno_id))
  const idsRegistrosTardanza = new Set(alertasOperativasHoy.filter(a => a.tipo_alerta === 'tardanza').map(a => a.registro_asistencia_id))
  const idsRegistrosFueraRadio = new Set(alertasOperativasHoy.filter(a => a.tipo_alerta === 'fuera_radio').map(a => a.registro_asistencia_id))
  const turnosDescubiertos = turnosHoy.filter((t: Turno) => idsTurnosDescubiertos.has(t.id))
  const turnosSinFichar = turnosHoy.filter((t: Turno) => idsTurnosSinFichar.has(t.id))
  const tardanzasRegistradas = registrosHoy.filter((r: RegistroAsistencia) => idsRegistrosTardanza.has(r.id))
  const fichajesFueraRadio = registrosHoy.filter((r: RegistroAsistencia) => idsRegistrosFueraRadio.has(r.id))
  const turnosAsistenciaPendiente = turnosHoy.filter((t: Turno) => {
    if (!t.guardia_id) return false
    return !tieneEntradaConfirmada(t) || (tieneEntradaConfirmada(t) && !tieneSalida(t))
  })

  // ── Cálculo de horas: función auxiliar reutilizable ──────────────────────────
  // Agrupa registros por turno, selecciona el principal, suma horas_liquidables.
  // Excluye: tipo_registro='ausencia', objetivos es_prueba=true.
  // Retorna { horasLiquidables, horasGPS } ambos deduplicados por turno.
  function sumarHorasPorTurnos(
    regs: RegistroAsistencia[],
    tPorId: Map<string, Turno>,
  ): { horasLiquidables: number; horasGPS: number } {
    const mejorPorTurno = new Map<string, RegistroAsistencia>()
    for (const r of regs) {
      if (r.tipo_registro === 'ausencia') continue
      const turno = tPorId.get(r.turno_id)
      if (!turno) continue
      if (objetivoPorId.get(turno.objetivo_id)?.es_prueba) continue
      const actual = mejorPorTurno.get(r.turno_id)
      if (!actual || scoreRegistro(r) > scoreRegistro(actual)) {
        mejorPorTurno.set(r.turno_id, r)
      }
    }
    let horasLiquidables = 0
    let horasGPS = 0
    for (const [turnoId, r] of mejorPorTurno) {
      const t = tPorId.get(turnoId)
      if (t) {
        const linea = resolverLineaLiquidacion(t, r)
        horasLiquidables += linea.horasLiquidables
        horasGPS += linea.horasFichadasGPS
      }
    }
    return { horasLiquidables, horasGPS }
  }

  const { horasLiquidables: horasHoy } = sumarHorasPorTurnos(registrosHoy, turnoPorId)
  const { horasGPS: horasGPSMes } = sumarHorasPorTurnos(registrosMes, turnoPorId)

  // "Horas trabajadas mes" responde la misma pregunta que "Horas liquidables
  // hasta hoy" de Planillas, así que sale del mismo universo: se recorren
  // turnos —no registros—, y se excluyen futuros, en curso y sin obligación.
  // Recorrer registros contaba de menos: un turno sin registro no existía, y
  // ningún filtro de corte se aplicaba.
  const esObjetivoPrueba = (objetivoId?: string | null) =>
    Boolean(objetivoPorId.get(objetivoId || '')?.es_prueba)
  const turnosMesDashboard = turnos.filter((t: Turno) => t.fecha?.slice(0, 7) === mesActual)
  const mejorRegistroMes = mejorRegistroPorTurno(registrosMes, turnoPorId, esObjetivoPrueba)
  const turnosReconocidosMes = turnosReconocidosHastaCorte(turnosMesDashboard, mejorRegistroMes, {
    hastaFecha: hoy,
    esObjetivoPrueba,
  })
  const horasMes = totalHorasLiquidables(turnosReconocidosMes, mejorRegistroMes)
  // Total programado del mes completo, con la misma definición que la tarjeta
  // homónima de Reportes: mes entero, sin anulados/cancelados/reemplazados ni
  // objetivos de prueba. Es el techo contra el que se leen las horas
  // trabajadas: sin él, 2.881 hs no dice si vamos bien o mal.
  const turnosOperativosMesDashboard = turnosOperativosDelMes(turnosMesDashboard, { esObjetivoPrueba })
  const horasProgramadasMesDashboard = turnosOperativosMesDashboard
    .reduce((s: number, t: Turno) => s + horasProgramadasTurno(t), 0)
  // Lo que queda por delante del mes: turnos cuyo horario todavía no terminó.
  // Es la pregunta operativa —"¿qué me falta cubrir?"— y por eso se mide en
  // horas y no en turnos: un turno de 12 horas sin vigilador no pesa lo mismo
  // que uno de 4.
  const ahoraDashboard = Date.now()
  const turnosRestantesMes = turnosOperativosMesDashboard
    .filter((t: Turno) => !turnoExigible(t, ahoraDashboard))
  const hsRestantesMes = turnosRestantesMes
    .reduce((s: number, t: Turno) => s + horasProgramadasTurno(t), 0)
  const hsRestantesConVigilador = turnosRestantesMes
    .filter((t: Turno) => Boolean(t.guardia_id))
    .reduce((s: number, t: Turno) => s + horasProgramadasTurno(t), 0)
  const hsRestantesSinVigilador = hsRestantesMes - hsRestantesConVigilador
  const guardiasConAsistenciaMes = new Set(registrosMes.filter((r: RegistroAsistencia) => r.hora_entrada_real).map((r: RegistroAsistencia) => r.guardia_id)).size
  const turnosFinalizadosHoy = registrosHoy.filter((r: RegistroAsistencia) => r.hora_entrada_real && r.hora_salida_real).length
  const novedadesUrgentes = novedades.filter((n: Novedad) => n.prioridad === 'urgente' && n.estado !== 'resuelta')

  const getGuardia = (id?: string | null) => usuarios.find((g: Usuario) => g.id === id)
  const getObjetivo = (id: string) => objetivos.find((o: Objetivo) => o.id === id)
  const hora = (value?: string) => value ? value.slice(0, 5) : '--:--'
  const DIAS_SEMANA_ADMIN = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'] as const
  const infoTurnoAlerta = (turno: { fecha: string; hora_inicio: string; hora_fin: string }) => {
    const [y, mo, d] = turno.fecha.slice(0, 10).split('-').map(Number)
    const fechaDate = new Date(y, mo - 1, d)
    const dia = DIAS_SEMANA_ADMIN[fechaDate.getDay()]
    const dd = String(d).padStart(2, '0')
    const mm = String(mo).padStart(2, '0')
    const fechaFmt = `${dd}/${mm}/${y}`
    const esNocturno = turno.hora_fin <= turno.hora_inicio
    const fechaFinDate = esNocturno ? new Date(y, mo - 1, d + 1) : fechaDate
    const dFin = String(fechaFinDate.getDate()).padStart(2, '0')
    const mFin = String(fechaFinDate.getMonth() + 1).padStart(2, '0')
    const yFin = fechaFinDate.getFullYear()
    const fechaFinFmt = `${dFin}/${mFin}/${yFin}`
    return {
      linea: `Turno: ${dia} ${fechaFmt}`,
      inicio: `Inicio: ${fechaFmt} ${hora(turno.hora_inicio)}`,
      fin: `Fin: ${fechaFinFmt} ${hora(turno.hora_fin)}`,
      nocturno: esNocturno,
    }
  }
  const nombreGuardia = (id?: string | null) => {
    const guardia = getGuardia(id)
    return guardia ? `${guardia.apellido}, ${guardia.nombre}` : 'Sin guardia'
  }
  const guardiaEsperadoId = (turno: Turno) => (turno as any).guardia_original_id || turno.guardia_id || null
  const nombreGuardiaEsperado = (turno: Turno) => {
    const guardiaId = guardiaEsperadoId(turno)
    return guardiaId ? nombreGuardia(guardiaId) : 'Sin guardia esperado'
  }
  const nombreObjetivo = (id: string) => getObjetivo(id)?.nombre || 'Objetivo sin nombre'
  const formatoHoras = (value: number) =>
    `${value.toLocaleString('es-AR', { maximumFractionDigits: 2 })} h`
  const detalleTurnoDescubierto = (turno: Turno) => {
    if (!turno.guardia_id) return 'Sin guardia asignado'
    if (turno.estado === 'descubierto') return 'Estado descubierto'
    return 'Pasó ventana de fichaje sin asistencia'
  }

  // Indicadores de contexto: describen la operación, no reclaman una acción.
  // Todo lo que exige atención vive arriba, en los paneles, con su contador en
  // el título — por eso acá ya no están "Turnos descubiertos", "Llegadas tarde"
  // ni "Turnos sin fichar": cada uno tenía KPI, tarjeta de resumen Y panel, los
  // tres alimentados por la misma variable.
  const metricas = [
    { label: 'Objetivos activos', value: objetivosActivos.length, sub: `${objetivos.length} objetivos cargados`, color: semanticColors.info, page:'objetivos', filtro:{ tipo:'activos', label:'Objetivos activos' } },
    { label: 'Guardias activos', value: guardiasActivos.length, sub: `${usuarios.filter((g: Usuario) => esRolGuardia(g.rol)).length} guardias cargados`, color: semanticColors.success, page:'guardias', filtro:{ tipo:'activos', label:'Guardias activos' } },
    { label: 'Turnos de hoy', value: turnosHoy.length, sub: hoy, color: brandColors.yellow, page:'turnos', filtro:{ tipo:'hoy', label:'Turnos de hoy' } },
    { label: 'Guardias en turno', value: guardiasEnTurno, sub: 'con entrada sin salida', color: semanticColors.success, page:'asistencia', filtro:{ tipo:'en_turno', label:'Guardias en turno' } },
    { label: 'Turnos finalizados hoy', value: turnosFinalizadosHoy, sub: 'con entrada y salida', color: semanticColors.info, page:'asistencia', filtro:{ tipo:'hoy', label:'Turnos finalizados hoy' } },
    { label: 'Horas trabajadas hoy', value: formatoHoras(horasHoy), sub: 'liquidables del día', color: semanticColors.info, page:'asistencia', filtro:{ tipo:'hoy', label:'Horas trabajadas hoy' } },
    { label: 'Horas programadas mes', value: formatoHoras(horasProgramadasMesDashboard), sub: `mes completo · ${mesActual}`, color: semanticColors.info, page:'reportes', filtro:{ tipo:'mes', mes:mesActual, label:`Horas programadas ${mesActual}` } },
    { label: 'Horas trabajadas mes', value: formatoHoras(horasMes), sub: `liquidables · ${mesActual}`, color: brandColors.orange, page:'reportes', filtro:{ tipo:'mes', mes:mesActual, label:`Horas trabajadas ${mesActual}` } },
    // Antes existía además "Total horas reales", que mostraba `horasMes` — el
    // mismo valor que la tarjeta de arriba — bajo un rótulo que prometía horas
    // reales. Las reales son estas, las de fichaje GPS.
    { label: 'Horas programadas restantes', value: formatoHoras(hsRestantesMes), sub: `${formatoHoras(hsRestantesConVigilador)} con vigilador · ${formatoHoras(hsRestantesSinVigilador)} sin asignar`, color: semanticColors.info, page:'turnos', filtro:{ tipo:'mes', mes:mesActual, label:`Turnos restantes ${mesActual}` } },
    { label: 'Guardias con asistencia', value: guardiasConAsistenciaMes, sub: mesActual, color: semanticColors.success, page:'asistencia', filtro:{ tipo:'mes', label:'Guardias con asistencia' } },
  ]

  const alertBox: React.CSSProperties = {
    background:alpha(brandColors.surface, 0.92),
    border:`1px solid ${alpha(brandColors.yellow, 0.16)}`,
    borderRadius:8,
    padding:16,
    boxShadow:`0 14px 34px ${alpha(brandColors.black, 0.16)}`,
  }

  const alertTitle: React.CSSProperties = {
    fontFamily:FONT_BRAND,
    fontSize:15,
    fontWeight:900,
    marginBottom:12,
    color:brandColors.textStrong,
  }

  const alertItem: React.CSSProperties = {
    padding:'12px 0',
    borderTop:`1px solid ${brandColors.border}`,
    fontSize:13,
    color:brandColors.text,
  }

  const emptyAlert: React.CSSProperties = {
    padding:'12px 0',
    borderTop:`1px solid ${brandColors.border}`,
    fontSize:13,
    color:brandColors.muted,
  }

  const renderTurnoAlert = (turno: Turno, detalle: string, filtro: any, destino = 'turnos') => {
    const info = infoTurnoAlerta(turno)
    return (
    <div key={turno.id} style={{ ...alertItem, cursor:'pointer' }} onClick={() => onNavigate?.(destino, filtro)}>
      <strong style={{ color:'#f8fafc' }}>{nombreObjetivo(turno.objetivo_id)}</strong>
      <div style={{ color:'#94a3b8', marginTop:4 }}>{info.linea}</div>
      <div style={{ color:'#94a3b8', marginTop:4 }}>{info.inicio}</div>
      <div style={{ color:'#94a3b8', marginTop:4 }}>{info.fin}</div>
      {info.nocturno && <div style={{ color:'#818cf8', marginTop:4 }}>Nocturno</div>}
      <div style={{ color:'#94a3b8', marginTop:4 }}>
        Estado: {turno.estado || 'programado'}
      </div>
      <div style={{ color:'#94a3b8', marginTop:4 }}>
        Guardia esperado: {nombreGuardiaEsperado(turno)}
      </div>
      <div style={{ color:'#f59e0b', marginTop:4 }}>{detalle}</div>
    </div>
  )}

  const renderSinIngresoAlert = (turno: Turno) => {
    const info = infoTurnoAlerta(turno)
    return (
    <div key={turno.id} style={{ ...alertItem, cursor:'pointer' }} onClick={() => onNavigate?.('revision_operativa', { tipo:'sin_fichar', ids:turnosSinFichar.map(item => item.id), label:'Guardias sin fichar / objetivos en riesgo' })}>
      <strong style={{ color:'#f8fafc' }}>{nombreGuardia(turno.guardia_id)}</strong>
      <div style={{ color:'#94a3b8', marginTop:4 }}>Objetivo: {nombreObjetivo(turno.objetivo_id)}</div>
      <div style={{ color:'#94a3b8', marginTop:4 }}>{info.linea}</div>
      <div style={{ color:'#94a3b8', marginTop:4 }}>{info.inicio}</div>
      <div style={{ color:'#94a3b8', marginTop:4 }}>{info.fin}</div>
      {info.nocturno && <div style={{ color:'#818cf8', marginTop:4 }}>Nocturno</div>}
      <div style={{ color:'#f59e0b', marginTop:4 }}>Minutos de demora: {minutosDesdeInicioTurno(turno)}</div>
      <div style={{ color:'#f59e0b', marginTop:4 }}>Estado: Sin ingreso</div>
    </div>
  )}

  const renderTardanzaAlert = (registro: RegistroAsistencia) => {
    const turno = turnoPorId.get(registro.turno_id)
    if (!turno) return null

    const info = infoTurnoAlerta(turno)
    return (
      <div key={registro.id} style={{ ...alertItem, cursor:'pointer' }} onClick={() => onNavigate?.('revision_operativa', { tipo:'tardanza', ids:tardanzasRegistradas.map(item => item.id), label:'Tardanzas registradas' })}>
        <strong style={{ color:'#f8fafc' }}>{nombreGuardia(registro.guardia_id || turno.guardia_id)}</strong>
        <div style={{ color:'#94a3b8', marginTop:4 }}>Objetivo: {nombreObjetivo(turno.objetivo_id)}</div>
        <div style={{ color:'#94a3b8', marginTop:4 }}>{info.linea}</div>
        <div style={{ color:'#94a3b8', marginTop:4 }}>{info.inicio}</div>
        <div style={{ color:'#94a3b8', marginTop:4 }}>{info.fin}</div>
        {info.nocturno && <div style={{ color:'#818cf8', marginTop:4 }}>Nocturno</div>}
        <div style={{ color:'#94a3b8', marginTop:4 }}>Entrada real: {hora(registro.hora_entrada_final ?? registro.hora_entrada_real)}</div>
        <div style={{ color:'#f59e0b', marginTop:4 }}>Minutos tarde: {calcularMinutosTardanzaRegistro(turno, registro)}</div>
        <div style={{ color:'#ef4444', marginTop:4 }}>Estado: Tarde</div>
      </div>
    )
  }

  const renderFichajeFueraRadioAlert = (registro: RegistroAsistencia) => {
    const turno = turnoPorId.get(registro.turno_id)
    if (!turno) return null

    const objetivo = getObjetivo(turno.objetivo_id)
    const gps = gpsRegistroAsistencia(registro, 'ingreso')

    const info = infoTurnoAlerta(turno)
    return (
      <div key={registro.id} style={{ ...alertItem, cursor:'pointer' }} onClick={() => onNavigate?.('revision_operativa', { tipo:'fuera_radio', ids:fichajesFueraRadio.map(item => item.id), label:'Fichajes fuera de radio' })}>
        <strong style={{ color:'#f8fafc' }}>{nombreGuardia(registro.guardia_id || turno.guardia_id)}</strong>
        <div style={{ color:'#94a3b8', marginTop:4 }}>Objetivo: {objetivo?.nombre || 'Objetivo sin nombre'}</div>
        <div style={{ color:'#94a3b8', marginTop:4 }}>{info.linea}</div>
        <div style={{ color:'#94a3b8', marginTop:4 }}>{info.inicio}</div>
        <div style={{ color:'#94a3b8', marginTop:4 }}>{info.fin}</div>
        {info.nocturno && <div style={{ color:'#818cf8', marginTop:4 }}>Nocturno</div>}
        <div style={{ color:'#94a3b8', marginTop:4 }}>Hora ingreso: {hora(registro.hora_entrada_real)}</div>
        <div style={{ color:'#ef4444', marginTop:4 }}>Distancia: {metrosGpsTexto(registro.distancia_ingreso_metros)}</div>
        <div style={{ color:'#94a3b8', marginTop:4 }}>Radio permitido: {metrosGpsTexto(objetivo?.radio_metros)}</div>
        <div style={{ color:'#94a3b8', marginTop:4 }}>Precisión GPS: {metrosGpsTexto(gps?.precision)}</div>
        <div style={{ color:'#ef4444', marginTop:4 }}>Estado: Fuera del radio</div>
      </div>
    )
  }

  // Paneles de atención. Cada uno lleva su contador en el título: ese es el
  // único lugar donde ese número aparece en toda la pantalla.
  const panelesAtencion: { titulo: string; items: any[]; vacio: string; render: (x: any) => React.ReactNode }[] = [
    {
      titulo: 'Turnos descubiertos',
      items: turnosDescubiertos,
      vacio: 'No hay turnos descubiertos hoy.',
      render: (turno: Turno) => renderTurnoAlert(turno, detalleTurnoDescubierto(turno), { tipo:'descubierto', ids:turnosDescubiertos.map(item => item.id), label:'Puestos sin cobertura' }, 'revision_operativa'),
    },
    {
      titulo: 'Guardias sin fichar',
      items: turnosSinFichar,
      vacio: 'No hay guardias demorados sin ingreso.',
      render: (turno: Turno) => renderSinIngresoAlert(turno),
    },
    {
      titulo: 'Tardanzas registradas',
      items: tardanzasRegistradas,
      vacio: 'No hay ingresos tarde registrados hoy.',
      render: (registro: RegistroAsistencia) => renderTardanzaAlert(registro),
    },
    {
      titulo: 'Fichajes fuera de radio',
      items: fichajesFueraRadio,
      vacio: 'No hay ingresos fuera del radio del objetivo.',
      render: (registro: RegistroAsistencia) => renderFichajeFueraRadioAlert(registro),
    },
    {
      titulo: 'Turnos con asistencia pendiente',
      items: turnosAsistenciaPendiente,
      vacio: 'No hay asistencias pendientes hoy.',
      render: (turno: Turno) => renderTurnoAlert(turno, tieneEntradaConfirmada(turno) ? 'Entrada registrada, salida pendiente' : 'Entrada pendiente', { tipo:'pendientes_asistencia', label:'Turnos con asistencia pendiente' }),
    },
  ]

  const seccionTitulo: React.CSSProperties = {
    fontFamily:FONT_BRAND,
    fontSize:12,
    fontWeight:900,
    letterSpacing:1.4,
    textTransform:'uppercase',
    color:brandColors.muted,
    margin:'0 0 12px',
  }

  const contadorPanel = (n: number): React.CSSProperties => ({
    display:'inline-block',
    marginLeft:8,
    padding:'1px 9px',
    borderRadius:999,
    fontSize:12,
    fontWeight:900,
    background: n > 0 ? alpha(semanticColors.error, 0.16) : alpha(brandColors.muted, 0.12),
    color: n > 0 ? semanticColors.error : brandColors.muted,
    border: `1px solid ${n > 0 ? alpha(semanticColors.error, 0.4) : 'transparent'}`,
  })

  return (
    <div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:12, alignItems:'flex-end', justifyContent:'space-between', marginBottom:24 }}>
        <div>
          <div style={S.title}>Dashboard Gerencial</div>
          <div style={S.sub2}>Actualizado al cargar pantalla - {new Date().toLocaleDateString('es-AR', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</div>
        </div>
        <Badge type="activo">Solo lectura</Badge>
      </div>

      {novedadesUrgentes.map((n: Novedad) => {
        const g = guardias.find((x: Usuario) => x.id === n.guardia_id)
        const o = objetivos.find((x: Objetivo) => x.id === n.objetivo_id)
        return (
          <div key={n.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', borderRadius:8, background:alpha(semanticColors.error, 0.12), border:`1px solid ${alpha(semanticColors.error, 0.34)}`, color:brandColors.textStrong, marginBottom:12, fontSize:13 }}>
            🚨 <strong>NOVEDAD URGENTE</strong> — {o?.nombre}: {n.descripcion} ({g?.nombre} {g?.apellido})
          </div>
        )
      })}

      {/* ── 1. INDICADORES ───────────────────────────────────────────────────
          Van pegados al título: son la lectura de un vistazo de la operación. */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:12, marginBottom:28 }}>
        {metricas.map((m) => (
          <StatCard key={m.label} label={m.label} value={m.value} sub={m.sub} color={m.color} onClick={() => onNavigate?.(m.page, m.filtro)} />
        ))}
      </div>

      {/* ── 2. CONTROL DE RONDAS ─────────────────────────────────────────────
          Estado operativo por objetivo, no una lista de pendientes: una tarjeta
          por objetivo con su ronda relevante, en un carril horizontal para que
          el panel no crezca en alto con la cantidad de objetivos. */}
      <div style={{ ...alertBox, marginBottom:16 }}>
        <ControlDeRondasPanel
          objetivos={objetivosControlRondas}
          onVerTodas={() => onNavigate?.('rondas')}
          onPausaCambiada={() => setPausasToken(t => t + 1)}
          recargarToken={pausasToken}
        />
      </div>

      {/* Pausas vigentes, visibles sin salir del Dashboard. El detalle y el
          botón Reanudar están en la pantalla de Rondas. */}
      <div style={{ ...alertBox, marginBottom:28 }}>
        <RondasPausadasPanel
          objetivoId={null}
          compacto
          onVerTodas={() => onNavigate?.('rondas')}
          recargarToken={pausasToken}
        />
      </div>

      {/* ── 3. ATENCIÓN OPERATIVA ────────────────────────────────────────── */}
      <div style={seccionTitulo}>Atención operativa</div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))', gap:16 }}>
        {panelesAtencion.map(panel => (
          <div key={panel.titulo} style={alertBox}>
            <div style={alertTitle}>
              {panel.titulo}
              <span style={contadorPanel(panel.items.length)}>{panel.items.length}</span>
            </div>
            {panel.items.length === 0
              ? <div style={emptyAlert}>{panel.vacio}</div>
              : panel.items.map(panel.render)}
          </div>
        ))}
      </div>

    </div>
  )
}

/**
 * Pantalla completa de rondas — destino de "Ver todas" del panel del Dashboard.
 *
 * Dos secciones. Primero el ESTADO por objetivo (mismo componente del
 * Dashboard, sin nada nuevo): sin él, la pantalla quedaba en blanco apenas no
 * había alertas, cuando el usuario venía justamente a ver cómo están las
 * rondas. Después las ALERTAS en alcance completo, con sus filtros y su flujo
 * de intervención (`RondaAlertasPanel`, el mismo de la pestaña Rondas del
 * supervisor en móvil).
 */
function RondasGlobal({ objetivos }: { objetivos: Objetivo[] }) {
  const objetivosPanel = objetivos
    .filter((o: Objetivo) => o.estado === 'activo' && !o.es_prueba)
    .map((o: Objetivo) => ({ id: o.id, nombre: o.nombre || 'Objetivo sin nombre' }))

  // Control de Rondas y Rondas pausadas son hermanos: pausar en uno no
  // refrescaba al otro y la pausa recién aparecía al recargar la página.
  const [pausasToken, setPausasToken] = useState(0)
  const refrescarPausas = () => setPausasToken(t => t + 1)
  const [objetivoConfig, setObjetivoConfig] = useState('')

  return (
    <div>
      <div style={{ marginBottom:20 }}>
        <div style={S.title}>Rondas</div>
        <div style={S.sub2}>
          Estado y alertas de rondas de todos tus objetivos. El historial
          completo de cada uno está en el legajo del objetivo.
        </div>
      </div>
      <div style={{ background:alpha(brandColors.surface, 0.92), border:`1px solid ${brandColors.border}`, borderRadius:8, padding:16, marginBottom:16 }}>
        <ControlDeRondasPanel
          objetivos={objetivosPanel}
          onPausaCambiada={refrescarPausas}
          recargarToken={pausasToken}
        />
      </div>
      {/* Pausas en alcance completo. Mismo componente que ve el supervisor en
          móvil: el administrador no depende de entrar a "Vista Supervisor". */}
      <div style={{ background:alpha(brandColors.surface, 0.92), border:`1px solid ${brandColors.border}`, borderRadius:8, padding:16, marginBottom:16 }}>
        <RondasPausadasPanel
          objetivoId={null}
          onCambio={refrescarPausas}
          recargarToken={pausasToken}
        />
      </div>
      {/* Configuración de rondas y puntos, sin salir de esta solapa. Monta el
          MISMO panel que el legajo del objetivo —lista, Administrar, editor de
          puntos—: no hay un segundo editor ni otra tabla. Lo único que agrega
          acá es elegir de qué objetivo, porque esta pantalla es transversal. */}
      <div style={{ background:alpha(brandColors.surface, 0.92), border:`1px solid ${brandColors.border}`, borderRadius:8, padding:16, marginBottom:16 }}>
        <div style={{ fontSize:15, fontWeight:800, color:brandColors.textStrong, marginBottom:10 }}>Configuración de rondas y puntos</div>
        <select
          value={objetivoConfig}
          onChange={e => setObjetivoConfig(e.target.value)}
          style={{ background:'#0f172a', border:`1px solid ${brandColors.border}`, borderRadius:8, color:'#e2e8f0', padding:'8px 10px', fontSize:13, marginBottom:12, minWidth:260 }}
        >
          <option value="">Elegí un objetivo…</option>
          {objetivosPanel.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
        </select>
        {objetivoConfig
          ? <RondasNativasPanel objetivoId={objetivoConfig} onDirtyChange={() => {}} />
          : <div style={{ fontSize:13, color:'#94a3b8' }}>Elegí un objetivo para ver y editar sus rondas y puntos.</div>}
      </div>
      <div style={{ background:alpha(brandColors.surface, 0.92), border:`1px solid ${brandColors.border}`, borderRadius:8, padding:16 }}>
        <div style={{ fontSize:15, fontWeight:800, color:brandColors.textStrong, marginBottom:10 }}>Alertas</div>
        <RondaAlertasPanel objetivoId={null} />
      </div>
    </div>
  )
}

function Guardias({ guardias, setGuardias, filtroActivo, limpiarFiltro, esAdmin }: any) {
  const router = useRouter()
  const [modal, setModal] = useState(false)
  const formVacio = { nombre:'', apellido:'', dni:'', telefono:'', legajo:'', email:'', estado:'activo', rol:'guardia', foto_url:'' }
  const [form, setForm] = useState(formVacio)
  const [editId, setEditId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [accionLoading, setAccionLoading] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error', texto: string } | null>(null)

  const abrirNuevo = () => {
    setForm(formVacio)
    setEditId(null)
    setMensaje(null)
    setModal(true)
  }

  const abrirEdicion = (g: Usuario) => {
    setForm({
      nombre: g.nombre || '',
      apellido: g.apellido || '',
      dni: g.dni || '',
      telefono: g.telefono || '',
      legajo: g.legajo || '',
      email: g.email || '',
      estado: g.estado || 'activo',
      rol: g.rol || 'guardia',
      foto_url: g.foto_url || '',
    })
    setEditId(g.id)
    setMensaje(null)
    setModal(true)
  }

  const headersAdmin = async () => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    if (!token) throw new Error('Sesión de administrador requerida')

    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    }
  }

  useEffect(() => {
    let activo = true

    const sincronizarEmailsAuth = async () => {
      try {
        const res = await fetch('/api/sync-auth-emails', {
          method: 'POST',
          headers: await headersAdmin(),
        })
        const data = await res.json()

        if (res.ok && activo && Array.isArray(data.users)) {
          const actualizados = new Map(data.users.map((u: Usuario) => [u.id, u]))
          setGuardias((prev: Usuario[]) => prev.map(g => actualizados.get(g.id) || g))
        }
      } catch {
        // La grilla sigue operativa aunque la sincronización técnica no responda.
      }
    }

    sincronizarEmailsAuth()

    return () => {
      activo = false
    }
  }, [])

  const guardar = async () => {
    setMensaje(null)

    if (!form.nombre.trim()) { setMensaje({ tipo:'error', texto:'El nombre es obligatorio' }); return }
    if (!form.apellido.trim()) { setMensaje({ tipo:'error', texto:'El apellido es obligatorio' }); return }
    if (!form.legajo.trim()) { setMensaje({ tipo:'error', texto:'El legajo es obligatorio' }); return }

    setLoading(true)
    const payload = {
      nombre: form.nombre.trim(),
      apellido: form.apellido.trim(),
      dni: form.dni.trim() || null,
      telefono: form.telefono.trim() || null,
      legajo: form.legajo.trim(),
      email: form.email.trim().toLowerCase() || null,
      estado: form.estado,
      rol: form.rol,
      foto_url: form.foto_url.trim() || null,
    }

    if (editId) {
      const original = guardias.find((g: Usuario) => g.id === editId)

      if (original?.auth_user_id && !payload.email) {
        setMensaje({ tipo:'error', texto:'Un empleado con acceso Auth requiere email.' })
        setLoading(false)
        return
      }

      if (original?.auth_user_id && payload.email && payload.email !== (original.email || '').toLowerCase()) {
        const res = await fetch('/api/update-user-email', {
          method: 'POST',
          headers: await headersAdmin(),
          body: JSON.stringify({ usuario_id: editId, email: payload.email }),
        })
        const sync = await res.json()
        if (!res.ok) {
          setMensaje({ tipo:'error', texto:sync.error || 'No se pudo sincronizar el email con Auth' })
          setLoading(false)
          return
        }
      }

      const { data, error } = await supabase.from('usuarios').update(payload).eq('id', editId).select().single()
      if (error) {
        setMensaje({ tipo:'error', texto:error.message })
      } else if (data) {
        setGuardias((prev: any[]) => prev.map(g => g.id === editId ? data : g))
        setModal(false)
      }
    } else {
      const { data, error } = await supabase.from('usuarios').insert(payload).select().single()
      if (error) {
        setMensaje({ tipo:'error', texto:error.message })
      } else if (data) {
        setGuardias((prev: any[]) => [...prev, data])
        setModal(false)
      }
    }
    setLoading(false)
  }

  const activarInactivar = async (g: Usuario) => {
    const nuevoEstado = g.estado === 'activo' ? 'inactivo' : 'activo'
    setAccionLoading(`estado-${g.id}`)
    setMensaje(null)

    const { data, error } = await supabase
      .from('usuarios')
      .update({ estado: nuevoEstado })
      .eq('id', g.id)
      .select()
      .single()

    if (error) {
      setMensaje({ tipo:'error', texto:error.message })
    } else if (data) {
      setGuardias((prev: any[]) => prev.map(x => x.id === g.id ? data : x))
      setMensaje({ tipo:'ok', texto:`Empleado ${nuevoEstado === 'activo' ? 'activado' : 'inactivado'} correctamente` })
    }

    setAccionLoading(null)
  }

  const crearAuth = async (g: Usuario) => {
    setAccionLoading(`auth-${g.id}`)
    setMensaje(null)

    try {
      const res = await fetch('/api/create-user', {
        method: 'POST',
        headers: await headersAdmin(),
        body: JSON.stringify({ usuario_id: g.id }),
      })
      const data = await res.json()

      if (!res.ok) {
        setMensaje({ tipo:'error', texto:data.error || 'No se pudo crear el usuario Auth' })
      } else {
        setGuardias((prev: any[]) => prev.map(x => x.id === g.id ? data.user : x))
        setMensaje({ tipo:'ok', texto:`✓ ${data.message || 'Usuario Auth creado correctamente'}` })
      }
    } catch (error) {
      setMensaje({ tipo:'error', texto:error instanceof Error ? error.message : 'Error de conexión' })
    }

    setAccionLoading(null)
  }

  const resetPassword = async (g: Usuario) => {
    setAccionLoading(`reset-${g.id}`)
    setMensaje(null)

    try {
      const res = await fetch('/api/reset-user-password', {
        method: 'POST',
        headers: await headersAdmin(),
        body: JSON.stringify({ usuario_id: g.id }),
      })
      const data = await res.json()

      if (!res.ok) {
        setMensaje({ tipo:'error', texto:data.error || 'No se pudo resetear la contraseña' })
      } else {
        if (data.user) setGuardias((prev: any[]) => prev.map(x => x.id === g.id ? data.user : x))
        setMensaje({ tipo:'ok', texto:`✓ ${data.message || 'Contraseña reseteada al DNI'}` })
      }
    } catch (error) {
      setMensaje({ tipo:'error', texto:error instanceof Error ? error.message : 'Error de conexión' })
    }

    setAccionLoading(null)
  }

  const sincronizarAccesos = async () => {
    setAccionLoading('sync-auth')
    setMensaje(null)

    try {
      const res = await fetch('/api/sync-employee-auth', {
        method: 'POST',
        headers: await headersAdmin(),
      })
      const data = await res.json()

      if (!res.ok) {
        setMensaje({ tipo:'error', texto:data.error || 'No se pudieron sincronizar los accesos empleados' })
      } else {
        if (Array.isArray(data.users)) setGuardias(data.users)

        const errores = data.errores?.length
          ? ` Errores: ${data.errores.map((e: any) => `${e.empleado}: ${e.error}`).slice(0, 3).join(' | ')}`
          : ''
        const omitidos = data.omitidos?.length
          ? ` Omitidos: ${data.omitidos.slice(0, 3).map((o: any) => `${o.empleado}: ${o.motivo}`).join(' | ')}`
          : ''

        setMensaje({ tipo:'ok', texto:`${data.message || 'Accesos empleados sincronizados.'}${omitidos}${errores}` })
      }
    } catch (error) {
      setMensaje({ tipo:'error', texto:error instanceof Error ? error.message : 'Error de conexión' })
    }

    setAccionLoading(null)
  }

  const repararAccesosAuth = async () => {
    setAccionLoading('repair-auth')
    setMensaje(null)

    try {
      const auditRes = await fetch('/api/admin/repair-auth-users', {
        method: 'POST',
        headers: await headersAdmin(),
        body: JSON.stringify({ repair_all: true }),
      })
      const auditData = await auditRes.json()

      if (!auditRes.ok && !auditData.report) {
        setMensaje({ tipo:'error', texto:auditData.error || 'No se pudo auditar Auth' })
        setAccionLoading(null)
        return
      }

      const report = auditData.report || {}
      const confirmado = window.confirm(
        `Auditoria Auth: ${report.auditados || 0} empleados activos. Sin Auth: ${report.usuarios_sin_auth_user_id?.length || 0}. Sin identity: ${report.auth_users_sin_identity?.length || 0}. Duplicados: ${report.emails_duplicados?.length || 0}. La reparacion puede eliminar Auth users invalidos y recrearlos con password DNI. Continuar?`
      )

      if (!confirmado) {
        setMensaje({ tipo:'ok', texto:'Auditoria Auth completada. No se ejecuto reparacion.' })
        setAccionLoading(null)
        return
      }

      const res = await fetch('/api/admin/repair-auth-users', {
        method: 'POST',
        headers: await headersAdmin(),
        body: JSON.stringify({ repair_all: true, confirm: true }),
      })
      const data = await res.json()

      if (!res.ok) {
        setMensaje({ tipo:'error', texto:data.error || 'No se pudieron reparar los accesos Auth' })
      } else {
        if (Array.isArray(data.users)) setGuardias(data.users)
        const s = data.summary || {}
        const errores = Array.isArray(data.results)
          ? data.results
              .filter((r: any) => r.action === 'error')
              .slice(0, 3)
              .map((r: any) => `${r.empleado}: ${r.error}`)
              .join(' | ')
          : ''

        setMensaje({
          tipo: s.errores ? 'error' : 'ok',
          texto: `Reparacion Auth: auditados ${s.auditados || 0}, reparados ${s.reparados || 0}, recreados ${s.recreados || 0}, vinculados ${s.vinculados || 0}, omitidos ${s.omitidos || 0}, errores ${s.errores || 0}.${errores ? ` ${errores}` : ''}`,
        })
      }
    } catch (error) {
      setMensaje({ tipo:'error', texto:error instanceof Error ? error.message : 'Error de conexión' })
    }

    setAccionLoading(null)
  }

  const idsFiltroGuardias = new Set((filtroActivo?.ids ?? []) as string[])
  const guardiasFiltrados = guardias.filter((g: Usuario) => {
    if (idsFiltroGuardias.size > 0) return idsFiltroGuardias.has(g.id)
    if (filtroActivo?.tipo === 'activos') return g.estado === 'activo'
    return true
  })

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', marginBottom:24 }}>
        <div style={{ flex:1 }}>
          <div style={S.title}>Guardias / Empleados</div>
          <div style={S.sub2}>{guardias.length} empleados registrados</div>
        </div>

        <div style={{ display:'flex', gap:10, flexWrap:'wrap', justifyContent:'flex-end' }}>
          <button
            style={{ ...S.btn, ...S.btnSecondary, opacity: accionLoading === 'sync-auth' ? 0.65 : 1 }}
            onClick={sincronizarAccesos}
            disabled={accionLoading === 'sync-auth'}
          >
            {accionLoading === 'sync-auth' ? 'Sincronizando...' : 'Sincronizar accesos empleados'}
          </button>

          <button
            style={{ ...S.btn, ...S.btnSecondary, opacity: accionLoading === 'repair-auth' ? 0.65 : 1 }}
            onClick={repararAccesosAuth}
            disabled={accionLoading === 'repair-auth'}
          >
            {accionLoading === 'repair-auth' ? 'Reparando...' : 'Reparar accesos Auth'}
          </button>

          <button
            style={{ ...S.btn, ...S.btnPrimary }}
            onClick={abrirNuevo}
          >
            + Nuevo empleado
          </button>
        </div>
      </div>

      {mensaje && (
        <div style={{ ...S.card, color: mensaje.tipo === 'ok' ? '#10b981' : '#ef4444', padding:14 }}>
          {mensaje.texto}
        </div>
      )}

      {filtroActivo && (
        <div style={{ ...S.card, padding:12, display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ color:'#f59e0b' }}>Filtro activo: {filtroActivo.label}</span>
          <button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 10px', fontSize:12 }} onClick={limpiarFiltro}>Limpiar filtro</button>
        </div>
      )}

      <div style={S.card}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Nombre</th>
              <th style={S.th}>Apellido</th>
              <th style={S.th}>DNI</th>
              <th style={S.th}>Legajo</th>
              <th style={S.th}>Email</th>
              <th style={S.th}>Rol</th>
              <th style={S.th}>Estado</th>
              <th style={S.th}>Acceso</th>
              <th style={S.th}>Acciones</th>
            </tr>
          </thead>

          <tbody>
            {guardiasFiltrados.map((g: Usuario) => (
              <tr key={g.id}>
                <td style={S.td}>
                  <strong>{g.nombre}</strong>
                </td>

                <td style={S.td}>{g.apellido}</td>
                <td style={S.td}>{g.dni || '—'}</td>
                <td style={S.td}>
                  <span style={{ fontFamily:'Syne,sans-serif', fontWeight:700, color:'#f59e0b' }}>
                    {g.legajo || '—'}
                  </span>
                </td>
                <td style={{ ...S.td, maxWidth:180, wordBreak:'break-word' }}>{g.email || '—'}</td>
                <td style={S.td}>{g.rol}</td>

                <td style={S.td}>
                  <Badge type={g.estado}>{g.estado}</Badge>
                </td>

                <td style={S.td}>{g.auth_user_id ? 'Sí' : 'No'}</td>

                <td style={S.td}>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                    {esAdmin && (
                      <button
                        style={{ ...S.btn, ...S.btnSecondary, padding:'6px 10px', fontSize:12 }}
                        onClick={() => router.push(`/guardias/${g.id}`)}
                      >
                        Ver legajo
                      </button>
                    )}
                    <button
                      style={{ ...S.btn, ...S.btnSecondary, padding:'6px 10px', fontSize:12 }}
                      onClick={() => abrirEdicion(g)}
                    >
                      Editar
                    </button>
                    <button
                      style={{ ...S.btn, ...S.btnSecondary, padding:'6px 10px', fontSize:12 }}
                      onClick={() => activarInactivar(g)}
                      disabled={accionLoading === `estado-${g.id}`}
                    >
                      {g.estado === 'activo' ? 'Inactivar' : 'Activar'}
                    </button>
                    {!g.auth_user_id && (
                      <button
                        style={{ ...S.btn, ...S.btnPrimary, padding:'6px 10px', fontSize:12 }}
                        onClick={() => crearAuth(g)}
                        disabled={accionLoading === `auth-${g.id}`}
                      >
                        {accionLoading === `auth-${g.id}` ? 'Creando acceso...' : 'Crear acceso'}
                      </button>
                    )}
                    {g.auth_user_id && (
                      <button
                        style={{ ...S.btn, ...S.btnSecondary, padding:'6px 10px', fontSize:12, opacity: accionLoading === `reset-${g.id}` ? 0.65 : 1 }}
                        onClick={() => resetPassword(g)}
                        disabled={accionLoading === `reset-${g.id}`}
                      >
                        {accionLoading === `reset-${g.id}` ? 'Reseteando...' : 'Reset DNI'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal
          title={editId ? 'Editar empleado' : 'Nuevo empleado'}
          onClose={() => setModal(false)}
          footer={
            <>
              <button
                style={{ ...S.btn, ...S.btnSecondary }}
                onClick={() => setModal(false)}
              >
                Cancelar
              </button>

              <button
                style={{ ...S.btn, ...S.btnPrimary }}
                onClick={guardar}
                disabled={loading}
              >
                {loading ? 'Guardando...' : 'Guardar'}
              </button>
            </>
          }
        >
          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Nombre</label>
              <input style={S.input} value={form.nombre} onChange={e => setForm({...form, nombre:e.target.value})} />
            </div>

            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Apellido</label>
              <input style={S.input} value={form.apellido} onChange={e => setForm({...form, apellido:e.target.value})} />
            </div>

            <div style={{ marginBottom:16 }}>
              <label style={S.label}>DNI</label>
              <input style={S.input} value={form.dni} onChange={e => setForm({...form, dni:e.target.value})} />
            </div>

            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Email</label>
              <input style={S.input} type="email" value={form.email} onChange={e => setForm({...form, email:e.target.value})} />
            </div>

            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Teléfono</label>
              <input style={S.input} value={form.telefono} onChange={e => setForm({...form, telefono:e.target.value})} />
            </div>

            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Legajo</label>
              <input style={S.input} value={form.legajo} onChange={e => setForm({...form, legajo:e.target.value})} />
            </div>

            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Rol</label>
              <select style={S.select} value={form.rol} onChange={e => setForm({...form, rol:e.target.value})}>
                <option value="guardia">Guardia</option>
                <option value="vigilador">Vigilador</option>
                <option value="supervisor">Supervisor</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Estado</label>
              <select style={S.select} value={form.estado} onChange={e => setForm({...form, estado:e.target.value})}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </div>

            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Foto URL</label>
              <input style={S.input} value={form.foto_url} onChange={e => setForm({...form, foto_url:e.target.value})} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function SupervisionesAdmin({
  supervisiones,
  objetivos,
  guardias,
  checklistItems = [],
  turnos = [],
  zonasOperativas = [],
  supervisorZonas = [],
  novedades = [],
  supervisionesMesOperativas = [],
  ultimasSupervisionesObjetivos = [],
  filtroInicial = null,
}: any) {
  const hoy = new Date().toLocaleDateString('sv-SE')
  const mesActual = hoy.slice(0, 7)
  const [detalleSupervision, setDetalleSupervision] = useState<SupervisionAdmin | null>(null)
  const [detalleRespuestas, setDetalleRespuestas] = useState<SupervisionRespuestaAdmin[]>([])
  const [detalleFotos, setDetalleFotos] = useState<SupervisionFotoAdmin[]>([])
  const [detalleLoading, setDetalleLoading] = useState(false)
  const [detalleError, setDetalleError] = useState('')
  const [vistaSupervisiones, setVistaSupervisiones] = useState<'resumen' | 'mapa'>('resumen')
  const [mapaFiltros, setMapaFiltros] = useState({
    desde: hoy,
    hasta: hoy,
    supervisor_id: 'todos',
    objetivo_id: 'todos',
    estado: 'todos',
    ocultarImpreciso: false,
    soloFueraRadio: false,
  })
  const [filtroTabla, setFiltroTabla] = useState<{ tipo: string; label: string; supervisor_id?: string; objetivo_id?: string; ids?: string[] } | null>(null)
  const tablaRef = useRef<HTMLDivElement>(null)

  // Guardias efectivas del mes para clasificar la carga operativa. Se piden
  // desde un día antes hasta un día después del mes: los nocturnos entrantes
  // y los turnos que terminan pasadas las 07:00 del primer día siguiente
  // necesitan la guardia vecina (las "2 h fantasma" de la auditoría de agosto
  // salieron de no hacerlo). Si la tabla no existe todavía, la carga queda
  // vacía y la pantalla lo dice, sin romperse.
  const [guardiasCargaMes, setGuardiasCargaMes] = useState<any[]>([])
  useEffect(() => {
    let vigente = true
    const offsetDia = (fecha: string, dias: number) => {
      const [anio, mes, dia] = fecha.split('-').map(Number)
      return new Date(anio, mes - 1, dia + dias).toLocaleDateString('sv-SE')
    }
    const rango = rangoDelMes(mesActual)
    ;(async () => {
      const { data, error } = await supabase
        .from('supervisores_guardia')
        .select('supervisor_id, zona, fecha, hora_inicio, hora_fin, estado, tipo_evento, rol_operativo')
        .gte('fecha', offsetDia(rango.desde, -1))
        .lte('fecha', offsetDia(rango.hasta, 1))
      if (!vigente) return
      if (error) {
        if (!/supervisores_guardia|tipo_evento|schema cache|does not exist|column/i.test(error.message)) {
          console.error('[supervisiones] guardias para carga:', error.message)
        }
        setGuardiasCargaMes([])
        return
      }
      setGuardiasCargaMes(data || [])
    })()
    return () => { vigente = false }
  }, [mesActual])
  const ahora = new Date()
  const fechaLocal = (fecha?: string | null) => fecha ? new Date(fecha).toLocaleDateString('sv-SE') : ''
  const fechaHora = (fecha?: string | null) => fecha ? formatFechaHora(fecha) : '—'
  const mapasUrl = (supervision: SupervisionAdmin) => `https://www.google.com/maps?q=${supervision.lat},${supervision.lng}`
  const observados = (supervision: SupervisionAdmin) => supervision.respuestas?.filter(r => r.resultado === 'observado').length || 0
  const fotosCount = (supervision: SupervisionAdmin) => supervision.fotos?.length || 0
  const nombreObjetivo = (id?: string | null) =>
    supervisiones.find((s: SupervisionAdmin) => s.objetivo_id === id)?.objetivo?.nombre ||
    objetivos.find((o: Objetivo) => o.id === id)?.nombre ||
    'Objetivo sin nombre'
  const nombreSupervisor = (id?: string | null) => {
    const desdeSupervision = supervisiones.find((s: SupervisionAdmin) => s.supervisor_id === id)?.supervisor
    const desdeUsuarios = guardias.find((g: Usuario) => g.id === id)
    const usuario = desdeSupervision || desdeUsuarios
    return usuario ? `${usuario.apellido}, ${usuario.nombre}` : 'Supervisor sin nombre'
  }
  const objetivoDeSupervision = (supervision: SupervisionAdmin) =>
    objetivos.find((objetivo: Objetivo) => objetivo.id === supervision.objetivo_id) || null
  const auditoriaMapa = (supervision: SupervisionAdmin) =>
    auditoriaSupervisionGps(supervision, objetivoDeSupervision(supervision))

  const supervisionesHoy = supervisiones.filter((s: SupervisionAdmin) => fechaLocal(s.created_at) === hoy)
  const porSupervisor = Array.from(supervisionesHoy.reduce((map: Map<string, any>, supervision: SupervisionAdmin) => {
    const item = map.get(supervision.supervisor_id) || { supervisor_id:supervision.supervisor_id, total:0, observadas:0, criticas:0 }
    item.total += 1
    if (supervision.estado === 'con_observacion') item.observadas += 1
    if (supervision.estado === 'critico') item.criticas += 1
    map.set(supervision.supervisor_id, item)
    return map
  }, new Map()).values()).sort((a: any, b: any) => b.total - a.total)

  const porObjetivo = Array.from(supervisiones.reduce((map: Map<string, any>, supervision: SupervisionAdmin) => {
    const item = map.get(supervision.objetivo_id) || { objetivo_id:supervision.objetivo_id, total:0, observadas:0, criticas:0, ultima:null as SupervisionAdmin | null }
    item.total += 1
    if (supervision.estado === 'con_observacion') item.observadas += 1
    if (supervision.estado === 'critico') item.criticas += 1
    if (!item.ultima || new Date(supervision.created_at).getTime() > new Date(item.ultima.created_at).getTime()) item.ultima = supervision
    map.set(supervision.objetivo_id, item)
    return map
  }, new Map()).values()).sort((a: any, b: any) => b.total - a.total)

  // Vigencia de supervisiones: una sola fuente y un solo cálculo.
  //
  // `supervisiones` viene recortado a las 500 más recientes para poder mostrar
  // el detalle completo (respuestas, fotos, supervisor). Usarlo para decidir
  // vigencia hacía que un objetivo supervisado hace tiempo saliera del recorte
  // y reapareciera como "nunca supervisado" — y como el recorte se llena a
  // medida que avanza el mes, el efecto parecía un reinicio mensual.
  // `ultimasSupervisionesObjetivos` trae solo (objetivo_id, created_at) sin
  // recorte por fecha: es la fuente correcta para vigencia.
  const ultimaIsoPorObjetivo = indexarUltimaSupervision(
    (ultimasSupervisionesObjetivos || []).length > 0 ? ultimasSupervisionesObjetivos : supervisiones,
  )

  const objetivosSinSupervision = objetivos
    .filter((objetivo: Objetivo) => objetivo.estado === 'activo')
    .filter((objetivo: Objetivo) =>
      objetivoSupervisionVencida(objetivo, ultimaIsoPorObjetivo.get(objetivo.id) ?? null, ahora.getTime()),
    )
  const ultimasSupervisiones = [...supervisiones]
    .sort((a: SupervisionAdmin, b: SupervisionAdmin) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 30)
  const supervisoresMapa = Array.from(guardias.reduce((map: Map<string, Usuario>, usuario: Usuario) => {
    if (usuario.rol === 'supervisor' && usuario.estado === 'activo') map.set(usuario.id, usuario)
    return map
  }, new Map()))
  const objetivosActivosMapa = objetivos.filter((objetivo: Objetivo) => objetivo.estado === 'activo')
  const supervisionesFiltradasMapa = supervisiones
    .filter((supervision: SupervisionAdmin) => {
      const fecha = fechaLocal(supervision.created_at)
      if (mapaFiltros.desde && fecha < mapaFiltros.desde) return false
      if (mapaFiltros.hasta && fecha > mapaFiltros.hasta) return false
      if (mapaFiltros.supervisor_id !== 'todos' && supervision.supervisor_id !== mapaFiltros.supervisor_id) return false
      if (mapaFiltros.objetivo_id !== 'todos' && supervision.objetivo_id !== mapaFiltros.objetivo_id) return false
      if (mapaFiltros.estado !== 'todos' && supervision.estado !== mapaFiltros.estado) return false
      const auditoria = auditoriaMapa(supervision)
      if (mapaFiltros.ocultarImpreciso && auditoria.gpsImpreciso) return false
      if (mapaFiltros.soloFueraRadio && auditoria.dentro_radio !== false) return false
      return Number.isFinite(Number(supervision.lat)) && Number.isFinite(Number(supervision.lng))
    })
    .sort((a: SupervisionAdmin, b: SupervisionAdmin) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const objetivosMapa = Array.from(supervisionesFiltradasMapa.reduce((map: Map<string, Objetivo>, supervision: SupervisionAdmin) => {
    const objetivo = objetivoDeSupervision(supervision)
    if (objetivo && numeroGps(objetivo.lat) !== null && numeroGps(objetivo.lng) !== null) map.set(objetivo.id, objetivo)
    return map
  }, new Map()).values())
  const supervisionesMapaLeaflet = supervisionesFiltradasMapa.map((supervision: SupervisionAdmin) => ({
    id: supervision.id,
    lat: Number(supervision.lat),
    lng: Number(supervision.lng),
    created_at: supervision.created_at,
    estado: supervision.estado,
    precision_gps: supervision.precision_gps,
    objetivoNombre: supervision.objetivo?.nombre || nombreObjetivo(supervision.objetivo_id),
    supervisorNombre: supervision.supervisor ? `${supervision.supervisor.apellido}, ${supervision.supervisor.nombre}` : nombreSupervisor(supervision.supervisor_id),
    googleMapsUrl: mapasUrl(supervision),
    auditoria: auditoriaMapa(supervision),
  }))
  const objetivosMapaLeaflet = objetivosMapa.map((objetivo: Objetivo) => ({
    id: objetivo.id,
    nombre: objetivo.nombre,
    lat: Number(objetivo.lat),
    lng: Number(objetivo.lng),
    radio_metros: numeroGps(objetivo.radio_metros),
  }))
  const mostrarRecorridoMapa = mapaFiltros.supervisor_id !== 'todos'
  const recorridoGoogleMapsUrl = mostrarRecorridoMapa && supervisionesMapaLeaflet.length > 1
    ? `https://www.google.com/maps/dir/${[...supervisionesMapaLeaflet]
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map(supervision => `${supervision.lat},${supervision.lng}`)
        .join('/')}`
    : null
  const colorSupervisorMapa = (supervisorId?: string | null) => {
    const nombre = nombreSupervisor(supervisorId).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    if (nombre.includes('aranda')) return '#f59e0b'
    if (nombre.includes('martinez')) return '#60a5fa'
    if (nombre.includes('fulla')) return '#10b981'
    return '#a78bfa'
  }
  const estadoMapaCounts = {
    ok: supervisionesFiltradasMapa.filter((s: SupervisionAdmin) => s.estado === 'ok').length,
    con_observacion: supervisionesFiltradasMapa.filter((s: SupervisionAdmin) => s.estado === 'con_observacion').length,
    critico: supervisionesFiltradasMapa.filter((s: SupervisionAdmin) => s.estado === 'critico').length,
  }
  const auditoriaMapaCounts = {
    dentro: supervisionesFiltradasMapa.filter((s: SupervisionAdmin) => auditoriaMapa(s).dentro_radio === true).length,
    fuera: supervisionesFiltradasMapa.filter((s: SupervisionAdmin) => auditoriaMapa(s).dentro_radio === false).length,
    impreciso: supervisionesFiltradasMapa.filter((s: SupervisionAdmin) => auditoriaMapa(s).gpsImpreciso).length,
  }
  const supervisionesMuyAlejadas = supervisionesFiltradasMapa.filter((supervision: SupervisionAdmin) => {
    const auditoria = auditoriaMapa(supervision)
    const umbral = Math.max((auditoria.radio || 0) * 5, 1000)
    return auditoria.distancia_objetivo_metros !== null && auditoria.distancia_objetivo_metros > umbral
  })
  const resumenMapaSupervisor = Array.from(supervisionesFiltradasMapa.reduce((map: Map<string, number>, supervision: SupervisionAdmin) => {
    map.set(supervision.supervisor_id, (map.get(supervision.supervisor_id) || 0) + 1)
    return map
  }, new Map()).entries())
  const resumenMapaObjetivo = Array.from(supervisionesFiltradasMapa.reduce((map: Map<string, number>, supervision: SupervisionAdmin) => {
    map.set(supervision.objetivo_id, (map.get(supervision.objetivo_id) || 0) + 1)
    return map
  }, new Map()).entries()).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const primerPuntoMapa = supervisionesFiltradasMapa[0]
  const ultimoPuntoMapa = supervisionesFiltradasMapa[supervisionesFiltradasMapa.length - 1]
  const respuestasPorItem = new Map(detalleRespuestas.map(respuesta => [respuesta.item_id, respuesta]))
  const itemsDetalleMap = new Map<string, ChecklistItemAdmin>()

  if (detalleSupervision?.plantilla_id) {
    checklistItems
      .filter((item: ChecklistItemAdmin) => item.plantilla_id === detalleSupervision.plantilla_id)
      .forEach((item: ChecklistItemAdmin) => itemsDetalleMap.set(item.id, item))
  }

  detalleRespuestas.forEach(respuesta => {
    if (respuesta.item) itemsDetalleMap.set(respuesta.item.id, respuesta.item)
  })

  const itemsDetalle = Array.from(itemsDetalleMap.values()).sort((a, b) => (a.orden || 0) - (b.orden || 0))
  const auditoriaDetalleAdmin = detalleSupervision ? auditoriaMapa(detalleSupervision) : null
  const zonasPorId = new Map((zonasOperativas || []).map((zona: any) => [zona.id, zona]))
  const supervisoresAsignadosIds = new Set((supervisorZonas || []).map((asignacion: any) => asignacion.supervisor_id).filter(Boolean))
  const supervisoresRanking = (guardias || [])
    .filter((usuario: Usuario) =>
      usuario.estado === 'activo' &&
      (usuario.rol === 'supervisor' || (esRolAdmin(usuario.rol) && supervisoresAsignadosIds.has(usuario.id)))
    )
    .sort((a: Usuario, b: Usuario) => `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`))
  const objetivosActivosRanking = (objetivos || []).filter((objetivo: Objetivo) => objetivo.estado === 'activo')
  const objetivosActivosSinZona = objetivosActivosRanking.filter((objetivo: Objetivo) => !objetivo.zona_id)
  const turnosMesRanking = (turnos || []).filter((turno: Turno) => turno.fecha?.slice(0, 7) === mesActual)
  const novedadesMesRanking = (novedades || []).filter((novedad: Novedad) => novedad.created_at?.slice(0, 7) === mesActual)
  const supervisionesMesRanking = ((supervisionesMesOperativas || []).length > 0 ? supervisionesMesOperativas : supervisiones)
    .filter((supervision: SupervisionRankingAdmin) => supervision.created_at?.slice(0, 7) === mesActual)
  // Mismo índice y mismo cálculo que `objetivosSinSupervision`: antes el ranking
  // leía otra fuente y podía contradecir al panel sobre el mismo objetivo.
  const objetivoVencidoRanking = (objetivo: Objetivo) =>
    objetivoSupervisionVencida(objetivo, ultimaIsoPorObjetivo.get(objetivo.id) ?? null, ahora.getTime())

  const usuarioActivoGuardia = (id?: string | null) => {
    if (!id) return null
    const usuario = (guardias || []).find((guardia: Usuario) => guardia.id === id)
    return usuario && usuario.estado === 'activo' && esRolGuardia(usuario.rol) ? usuario : null
  }

  // ── Carga operativa por zona: exclusiva / compartida / sin supervisor ─────
  //
  // Reemplaza el reparto por cabeza que vivía acá. La carga se clasifica por
  // franja de guardia real (lib/carga-operativa): lo que cubre uno solo es
  // exclusivo, lo que cubren varios a la vez es COMPARTIDO y cuenta una sola
  // vez en el total de la zona — no se divide 50/50 ni por cantidad, porque
  // esta métrica es carga de servicios bajo supervisión, no horas trabajadas
  // por la persona. Mismos filtros de validez que antes: sin anulados,
  // cancelados ni reemplazados (lo aplica el lib) y sin objetivos de prueba.
  const cargasPorZona = clasificarCargaZonas({
    turnos: turnosMesRanking,
    objetivos: objetivosActivosRanking,
    guardias: guardiasCargaMes,
    supervisorZonas: supervisorZonas || [],
    zonas: zonasOperativas || [],
    usuarios: guardias || [],
  })

  const rankingSupervisores = supervisoresRanking.map((supervisor: Usuario) => {
    const asignaciones = (supervisorZonas || []).filter((asignacion: any) => asignacion.supervisor_id === supervisor.id)
    const zonaIds = new Set(asignaciones.map((asignacion: any) => asignacion.zona_id).filter(Boolean))
    const zonas = Array.from(zonaIds).map((zonaId: any) => zonasPorId.get(zonaId)).filter(Boolean)
    const objetivosAsignados = objetivosActivosRanking.filter((objetivo: Objetivo) => objetivo.zona_id && zonaIds.has(objetivo.zona_id))
    const objetivoIds = new Set(objetivosAsignados.map((objetivo: Objetivo) => objetivo.id))
    const turnosObjetivosMes = turnosMesRanking.filter((turno: Turno) => objetivoIds.has(turno.objetivo_id))
    const vigiladoresIds = new Set<string>()

    turnosObjetivosMes.forEach((turno: Turno) => {
      ;[turno.guardia_id, (turno as any).guardia_real_id, (turno as any).guardia_original_id].forEach(id => {
        const usuario = usuarioActivoGuardia(id)
        if (usuario) vigiladoresIds.add(usuario.id)
      })
    })

    const novedadesObjetivosMes = novedadesMesRanking.filter((novedad: Novedad) => objetivoIds.has(novedad.objetivo_id))

    return {
      supervisor,
      zonas,
      zonasSinResolver: asignaciones.length - zonas.length,
      objetivos: objetivosAsignados.length,
      vigiladores: vigiladoresIds.size,
      // Su carga: exclusiva por un lado y compartida por el otro, rotulada.
      // Nunca se suman en un solo número.
      carga: cargaDeSupervisor(cargasPorZona, supervisor.id, zonaIds as Set<string>),
      supervisionesMes: supervisionesMesRanking.filter((supervision: SupervisionRankingAdmin) =>
        supervision.supervisor_id === supervisor.id && objetivoIds.has(supervision.objetivo_id)
      ).length,
      vencidas: objetivosAsignados.filter(objetivoVencidoRanking).length,
      alertas: novedadesObjetivosMes.filter((novedad: Novedad) => novedad.prioridad === 'urgente' || novedad.estado !== 'resuelta').length,
      resueltas: novedadesObjetivosMes.filter((novedad: Novedad) => novedad.estado === 'resuelta').length,
    }
  }).sort((a: any, b: any) =>
    // El orden ya no usa la carga: las horas de zona no miden desempeño.
    // Desempata lo que sí es trabajo real: las supervisiones hechas en el mes.
    b.objetivos - a.objetivos ||
    b.supervisionesMes - a.supervisionesMes ||
    nombreSupervisor(a.supervisor.id).localeCompare(nombreSupervisor(b.supervisor.id))
  )
  const aplicarFiltro = (filtro: { tipo: string; label: string; supervisor_id?: string; objetivo_id?: string; ids?: string[] }) => {
    setFiltroTabla(filtro)
    setTimeout(() => tablaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }

  useEffect(() => {
    if (!filtroInicial) return
    setVistaSupervisiones('resumen')
    setFiltroTabla(filtroInicial)
    setTimeout(() => tablaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }, [filtroInicial])

  const supervisionesTabla: SupervisionAdmin[] = (() => {
    const base = [...supervisiones].sort((a: SupervisionAdmin, b: SupervisionAdmin) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    const idsFiltroSupervisiones = new Set((filtroTabla?.ids ?? []) as string[])
    if (idsFiltroSupervisiones.size > 0) return base.filter((s: SupervisionAdmin) => idsFiltroSupervisiones.has(s.id))
    if (!filtroTabla) return base.slice(0, 30)
    if (filtroTabla.tipo === 'hoy') return base.filter((s: SupervisionAdmin) => fechaLocal(s.created_at) === hoy)
    if (filtroTabla.tipo === 'con_observacion') return base.filter((s: SupervisionAdmin) => s.estado === 'con_observacion')
    if (filtroTabla.tipo === 'critico') return base.filter((s: SupervisionAdmin) => s.estado === 'critico')
    if (filtroTabla.tipo === 'supervisor') return base.filter((s: SupervisionAdmin) => s.supervisor_id === filtroTabla.supervisor_id)
    if (filtroTabla.tipo === 'supervisor_hoy') return base.filter((s: SupervisionAdmin) => s.supervisor_id === filtroTabla.supervisor_id && fechaLocal(s.created_at) === hoy)
    if (filtroTabla.tipo === 'objetivo') return base.filter((s: SupervisionAdmin) => s.objetivo_id === filtroTabla.objetivo_id)
    if (filtroTabla.tipo === 'objetivos_vencidos') {
      const idsVencidos = new Set(objetivosSinSupervision.map((o: Objetivo) => o.id))
      return base.filter((s: SupervisionAdmin) => idsVencidos.has(s.objetivo_id))
    }
    if (filtroTabla.tipo === 'vencidas_supervisor') {
      const asignaciones = (supervisorZonas || []).filter((a: any) => a.supervisor_id === filtroTabla.supervisor_id)
      const zonaIds = new Set(asignaciones.map((a: any) => a.zona_id).filter(Boolean))
      const idsVencidas = new Set(objetivosActivosRanking.filter((o: Objetivo) => o.zona_id && zonaIds.has(o.zona_id) && objetivoVencidoRanking(o)).map((o: Objetivo) => o.id))
      return base.filter((s: SupervisionAdmin) => idsVencidas.has(s.objetivo_id))
    }
    return base.slice(0, 30)
  })()

  const horasRankingTexto = (horas: number) => `${horas.toLocaleString('es-AR', { maximumFractionDigits: 1 })} h`

  const abrirDetalle = async (supervision: SupervisionAdmin) => {
    setDetalleSupervision(supervision)
    setDetalleRespuestas([])
    setDetalleFotos([])
    setDetalleError('')
    setDetalleLoading(true)

    try {
      const [respuestasResult, fotosResult] = await Promise.all([
        supabase
          .from('supervision_respuestas')
          .select('id, supervision_id, item_id, resultado, observacion, item:checklist_items(id, plantilla_id, texto, orden, obligatorio, criticidad, foto_obligatoria, activo)')
          .eq('supervision_id', supervision.id),
        supabase
          .from('supervision_fotos')
          .select('id, supervision_id, storage_path, created_at')
          .eq('supervision_id', supervision.id)
          .order('created_at', { ascending: true }),
      ])

      if (respuestasResult.error) throw respuestasResult.error
      if (fotosResult.error) throw fotosResult.error

      const fotosConUrl = await Promise.all((fotosResult.data || []).map(async (foto: SupervisionFotoAdmin) => {
        const { data, error } = await supabase.storage
          .from('supervision-fotos')
          .createSignedUrl(foto.storage_path, 60 * 60)
        const publicUrl = supabase.storage
          .from('supervision-fotos')
          .getPublicUrl(foto.storage_path).data.publicUrl

        return {
          ...foto,
          signedUrl: data?.signedUrl || null,
          publicUrl,
          error: error?.message || null,
        }
      }))

      setDetalleRespuestas((respuestasResult.data || []) as SupervisionRespuestaAdmin[])
      setDetalleFotos(fotosConUrl)
    } catch (error) {
      setDetalleError(error instanceof Error ? error.message : 'No se pudo cargar el detalle de la supervisión.')
    } finally {
      setDetalleLoading(false)
    }
  }

  return (
    <div>
      <div style={{ marginBottom:24 }}>
        <div style={S.title}>Supervisiones</div>
        <div style={S.sub2}>Contadores diarios y vencimientos por frecuencia configurada.</div>
      </div>

      <div style={{ display:'inline-flex', gap:4, background:'#1a2235', borderRadius:10, padding:4, marginBottom:20 }}>
        {(['resumen', 'mapa'] as const).map(vista => (
          <button
            key={vista}
            type="button"
            onClick={() => setVistaSupervisiones(vista)}
            style={{
              ...S.btn,
              padding:'8px 18px',
              background:vistaSupervisiones === vista ? brandColors.yellow : 'transparent',
              color:vistaSupervisiones === vista ? brandColors.black : brandColors.text,
              border:'none',
            }}
          >
            {vista === 'resumen' ? 'Resumen' : 'Mapa'}
          </button>
        ))}
      </div>

      {vistaSupervisiones === 'mapa' ? (
        <div>
          <div style={{ ...S.card, marginBottom:20 }}>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))', gap:12 }}>
              <div>
                <label style={S.label}>Fecha desde</label>
                <input type="date" style={S.input} value={mapaFiltros.desde} onChange={e => setMapaFiltros({ ...mapaFiltros, desde:e.target.value })} />
              </div>
              <div>
                <label style={S.label}>Fecha hasta</label>
                <input type="date" style={S.input} value={mapaFiltros.hasta} onChange={e => setMapaFiltros({ ...mapaFiltros, hasta:e.target.value })} />
              </div>
              <div>
                <label style={S.label}>Supervisor</label>
                <select style={S.select} value={mapaFiltros.supervisor_id} onChange={e => setMapaFiltros({ ...mapaFiltros, supervisor_id:e.target.value })}>
                  <option value="todos">Todos</option>
                  {supervisoresMapa.map(([id, supervisor]: [string, Usuario]) => (
                    <option key={id} value={id}>{supervisor.apellido}, {supervisor.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={S.label}>Objetivo</label>
                <select style={S.select} value={mapaFiltros.objetivo_id} onChange={e => setMapaFiltros({ ...mapaFiltros, objetivo_id:e.target.value })}>
                  <option value="todos">Todos</option>
                  {objetivosActivosMapa.map((objetivo: Objetivo) => (
                    <option key={objetivo.id} value={objetivo.id}>{objetivo.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={S.label}>Estado</label>
                <select style={S.select} value={mapaFiltros.estado} onChange={e => setMapaFiltros({ ...mapaFiltros, estado:e.target.value })}>
                  <option value="todos">Todos</option>
                  <option value="ok">ok</option>
                  <option value="con_observacion">con_observacion</option>
                  <option value="critico">critico</option>
                </select>
              </div>
              <label style={{ display:'flex', gap:8, alignItems:'center', color:'#cbd5e1', fontSize:13, fontWeight:800, paddingTop:24 }}>
                <input
                  type="checkbox"
                  checked={mapaFiltros.ocultarImpreciso}
                  onChange={e => setMapaFiltros({ ...mapaFiltros, ocultarImpreciso:e.target.checked })}
                />
                Ocultar GPS impreciso
              </label>
              <label style={{ display:'flex', gap:8, alignItems:'center', color:'#cbd5e1', fontSize:13, fontWeight:800, paddingTop:24 }}>
                <input
                  type="checkbox"
                  checked={mapaFiltros.soloFueraRadio}
                  onChange={e => setMapaFiltros({ ...mapaFiltros, soloFueraRadio:e.target.checked })}
                />
                Mostrar solo fuera de radio
              </label>
            </div>
          </div>

          {supervisionesMuyAlejadas.length > 0 && (
            <div style={{ ...S.card, borderColor:'rgba(245,158,11,.42)', background:'rgba(245,158,11,.10)', color:'#fbbf24' }}>
              Hay {supervisionesMuyAlejadas.length} supervisión(es) muy alejadas del objetivo. Revisá precisión GPS, coordenadas guardadas del objetivo y el link de Google Maps del detalle.
            </div>
          )}

          <SupervisionMap
            supervisiones={supervisionesMapaLeaflet}
            objetivos={objetivosMapaLeaflet}
            mostrarRecorrido={mostrarRecorridoMapa}
            recorridoGoogleMapsUrl={recorridoGoogleMapsUrl}
            abrirDetalle={(supervisionId: string) => {
              const supervision = supervisionesFiltradasMapa.find((item: SupervisionAdmin) => item.id === supervisionId)
              if (supervision) abrirDetalle(supervision)
            }}
          />

          <div style={S.statGrid}>
            <StatCard label="Filtradas" value={supervisionesFiltradasMapa.length} sub="Supervisiones con GPS" color={semanticColors.info} />
            <StatCard label="Dentro radio" value={auditoriaMapaCounts.dentro} sub="Según objetivo" color={semanticColors.success} />
            <StatCard label="Fuera radio" value={auditoriaMapaCounts.fuera} sub="Revisar ubicación" color={semanticColors.error} />
            <StatCard label="GPS impreciso" value={auditoriaMapaCounts.impreciso} sub={`Más de ${GPS_PRECISION_MAX_METROS} m`} color={semanticColors.warning} />
            <StatCard label="ok" value={estadoMapaCounts.ok} sub="Sin observación crítica" color={semanticColors.success} />
            <StatCard label="Observación" value={estadoMapaCounts.con_observacion} sub="Con observación" color={semanticColors.warning} />
            <StatCard label="Críticas" value={estadoMapaCounts.critico} sub="Estado crítico" color={semanticColors.error} />
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))', gap:20 }}>
            <div style={S.card}>
              <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, marginBottom:12 }}>Supervisiones por supervisor</div>
              {resumenMapaSupervisor.length === 0 ? <div style={{ color:'#64748b', fontSize:13 }}>Sin datos.</div> : resumenMapaSupervisor.map(([supervisorId, total]) => (
                <div key={supervisorId} style={{ display:'flex', justifyContent:'space-between', gap:10, borderTop:'1px solid #1e2d42', padding:'10px 0' }}>
                  <span>{nombreSupervisor(supervisorId)}</span>
                  <Badge type="ok">{total}</Badge>
                </div>
              ))}
            </div>

            <div style={S.card}>
              <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, marginBottom:12 }}>Supervisiones por objetivo</div>
              {resumenMapaObjetivo.length === 0 ? <div style={{ color:'#64748b', fontSize:13 }}>Sin datos.</div> : resumenMapaObjetivo.map(([objetivoId, total]) => (
                <div key={objetivoId} style={{ display:'flex', justifyContent:'space-between', gap:10, borderTop:'1px solid #1e2d42', padding:'10px 0' }}>
                  <span>{nombreObjetivo(objetivoId)}</span>
                  <Badge type="ok">{total}</Badge>
                </div>
              ))}
            </div>

            <div style={S.card}>
              <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, marginBottom:12 }}>Recorrido cronológico</div>
              <div style={{ color:'#94a3b8', fontSize:13, marginBottom:10 }}>
                Primer punto: {primerPuntoMapa ? fechaHora(primerPuntoMapa.created_at) : '—'} · Último punto: {ultimoPuntoMapa ? fechaHora(ultimoPuntoMapa.created_at) : '—'}
              </div>
              {supervisionesFiltradasMapa.length === 0 ? <div style={{ color:'#64748b', fontSize:13 }}>Sin puntos en el rango.</div> : supervisionesFiltradasMapa.map((supervision: SupervisionAdmin, index: number) => (
                <div key={supervision.id} style={{ display:'grid', gridTemplateColumns:'34px 1fr auto', gap:10, alignItems:'center', borderTop:'1px solid #1e2d42', padding:'10px 0' }}>
                  <span style={{ width:26, height:26, borderRadius:'50%', display:'inline-flex', alignItems:'center', justifyContent:'center', background:colorSupervisorMapa(supervision.supervisor_id), color:'#111827', fontWeight:900 }}>{index + 1}</span>
                  <div>
                    <div style={{ fontWeight:800 }}>{nombreObjetivo(supervision.objetivo_id)}</div>
                    <div style={{ color:'#94a3b8', fontSize:12 }}>{fechaHora(supervision.created_at)} · {nombreSupervisor(supervision.supervisor_id)}</div>
                  </div>
                  <button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 10px', fontSize:12 }} onClick={() => abrirDetalle(supervision)}>
                    Detalle
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
      <div style={S.card}>
        <div style={{ display:'flex', flexWrap:'wrap', justifyContent:'space-between', gap:12, alignItems:'flex-start', marginBottom:14 }}>
          <div>
            <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800 }}>Ranking operativo de supervisores</div>
            <div style={{ color:'#64748b', fontSize:13 }}>Mes actual {mesActual}. Horas programadas, sin costos ni facturación.</div>
          </div>
          <Badge type="activo">{rankingSupervisores.length} supervisor(es)</Badge>
        </div>

        {objetivosActivosSinZona.length > 0 && (
          <div style={{ background:'rgba(245,158,11,.1)', border:'1px solid rgba(245,158,11,.25)', color:'#fbbf24', borderRadius:8, padding:10, fontSize:12, marginBottom:12 }}>
            {objetivosActivosSinZona.length} objetivo(s) activo(s) sin zona quedan excluidos del ranking.
          </div>
        )}

        {cargasPorZona.size > 0 && (
          <div style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:8, padding:14, marginBottom:14 }}>
            <div style={{ fontFamily:'Syne,sans-serif', fontWeight:700, marginBottom:4 }}>Carga operativa por zona</div>
            <div style={{ color:'#64748b', fontSize:12, marginBottom:10 }}>{LEYENDA_CARGA}</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))', gap:14 }}>
              {Array.from(cargasPorZona.values())
                .sort((a: CargaZona, b: CargaZona) => b.totalHoras - a.totalHoras)
                .map((carga: CargaZona) => (
                  <div key={carga.zonaId} style={{ borderTop:'2px solid #1e2d42', paddingTop:8 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', fontWeight:800, marginBottom:6 }}>
                      <span>{(zonasPorId.get(carga.zonaId) as any)?.nombre || 'Zona'}</span>
                      <span style={{ fontFamily:'Syne,sans-serif' }}>{horasRankingTexto(carga.totalHoras)}</span>
                    </div>
                    {Object.entries(carga.exclusivas)
                      .sort(([, a]: any, [, b]: any) => b - a)
                      .map(([supervisorId, horas]: any) => (
                        <div key={supervisorId} style={{ display:'flex', justifyContent:'space-between', fontSize:13, padding:'3px 0' }}>
                          <span style={{ color:'#94a3b8' }}>Exclusiva {nombreSupervisor(supervisorId)}</span>
                          <span>{horasRankingTexto(horas)}</span>
                        </div>
                      ))}
                    {carga.compartidas.map(compartida => (
                      <div key={compartida.supervisorIds.join('|')} style={{ display:'flex', justifyContent:'space-between', fontSize:13, padding:'3px 0' }}>
                        <span style={{ color:'#f59e0b' }}>Compartida {compartida.supervisorIds.map(id => nombreSupervisor(id).split(',')[0]).join(' + ')}</span>
                        <span>{horasRankingTexto(compartida.horas)}</span>
                      </div>
                    ))}
                    {carga.sinSupervisor > 0 && (
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, padding:'3px 0', color:'#ef4444' }}>
                        <span>Sin supervisor</span>
                        <span>{horasRankingTexto(carga.sinSupervisor)}</span>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}

        {rankingSupervisores.length === 0 ? (
          <div style={{ color:'#64748b', fontSize:13 }}>No hay supervisores activos con zonas asignadas.</div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Supervisor</th>
                  <th style={S.th}>Zonas</th>
                  <th style={S.th}>Objetivos</th>
                  <th style={S.th}>Vigiladores</th>
                  <th style={S.th} title={LEYENDA_CARGA}>Carga operativa</th>
                  <th style={S.th}>Supervisiones mes</th>
                  <th style={S.th}>Vencidas</th>
                </tr>
              </thead>
              <tbody>
                {rankingSupervisores.map((item: any) => (
                  <tr
                    key={item.supervisor.id}
                    style={{ cursor:'pointer' }}
                    title="Ver supervisiones de este supervisor"
                    onClick={() => aplicarFiltro({ tipo: 'supervisor', label: nombreSupervisor(item.supervisor.id), supervisor_id: item.supervisor.id })}
                  >
                    <td style={S.td}>
                      <strong>{nombreSupervisor(item.supervisor.id)}</strong>
                      {(item.alertas > 0 || item.resueltas > 0) && (
                        <div style={{ color:'#94a3b8', fontSize:12, marginTop:3 }}>
                          Alertas {item.alertas} · resueltas {item.resueltas}
                        </div>
                      )}
                    </td>
                    <td style={S.td}>
                      <div style={{ fontWeight:800 }}>{item.zonas.length}</div>
                      <div style={{ color:'#94a3b8', fontSize:12, maxWidth:220 }}>
                        {item.zonas.length > 0
                          ? item.zonas.map((zona: any) => zona.nombre).join(', ')
                          : item.zonasSinResolver > 0 ? 'Zona no encontrada' : 'Sin zonas'}
                      </div>
                    </td>
                    <td style={S.td}>{item.objetivos}</td>
                    <td style={S.td}>{item.vigiladores}</td>
                    <td style={S.td}>
                      <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800 }}>
                        {item.carga.exclusiva > 0 ? horasRankingTexto(item.carga.exclusiva) : '—'}
                        <span style={{ color:'#64748b', fontSize:11, fontWeight:400 }}> exclusiva</span>
                      </div>
                      {item.carga.compartidas.map((compartida: any) => (
                        <div key={compartida.supervisorIds.join('|')} style={{ color:'#94a3b8', fontSize:12, marginTop:3 }}>
                          + compartida c/ {compartida.supervisorIds.filter((id: string) => id !== item.supervisor.id).map((id: string) => nombreSupervisor(id).split(',')[0]).join(', ')}: {horasRankingTexto(compartida.horas)}
                        </div>
                      ))}
                    </td>
                    <td style={S.td}>{item.supervisionesMes}</td>
                    <td style={S.td} onClick={e => { e.stopPropagation(); aplicarFiltro({ tipo: 'vencidas_supervisor', label: `Vencidas · ${nombreSupervisor(item.supervisor.id)}`, supervisor_id: item.supervisor.id }) }} title="Ver supervisiones vencidas de este supervisor">
                      <Badge type={item.vencidas > 0 ? 'advertencia' : 'ok'}>{item.vencidas}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={S.statGrid}>
        <StatCard label="Supervisiones hoy" value={supervisionesHoy.length} sub="Registros propios de la fecha local" color={semanticColors.info} onClick={() => aplicarFiltro({ tipo: 'hoy', label: 'Supervisiones hoy' })} />
        <StatCard label="Con observación" value={supervisionesHoy.filter((s: SupervisionAdmin) => s.estado === 'con_observacion').length} sub="Observadas hoy" color={semanticColors.warning} onClick={() => aplicarFiltro({ tipo: 'con_observacion', label: 'Con observación' })} />
        <StatCard label="Críticas" value={supervisionesHoy.filter((s: SupervisionAdmin) => s.estado === 'critico').length} sub="Críticas hoy" color={semanticColors.error} onClick={() => aplicarFiltro({ tipo: 'critico', label: 'Críticas' })} />
        <StatCard label="Objetivos vencidos" value={objetivosSinSupervision.length} sub="Sin supervisión según frecuencia" color={brandColors.yellow} onClick={() => aplicarFiltro({ tipo: 'objetivos_vencidos', label: 'Objetivos vencidos' })} />
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))', gap:20 }}>
        <div style={S.card}>
          <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, marginBottom:12 }}>Por supervisor hoy</div>
          {porSupervisor.length === 0 ? (
            <div style={{ color:'#64748b', fontSize:13 }}>Sin supervisiones registradas hoy.</div>
          ) : porSupervisor.map((item: any) => (
            <div
              key={item.supervisor_id}
              style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:12, padding:'10px 0', borderTop:'1px solid #1e2d42', cursor:'pointer' }}
              title="Ver supervisiones de hoy de este supervisor"
              onClick={() => aplicarFiltro({ tipo: 'supervisor_hoy', label: `Hoy · ${nombreSupervisor(item.supervisor_id)}`, supervisor_id: item.supervisor_id })}
            >
              <div>
                <div style={{ fontWeight:800 }}>{nombreSupervisor(item.supervisor_id)}</div>
                <div style={{ color:'#94a3b8', fontSize:12 }}>{item.observadas} observadas · {item.criticas} críticas</div>
              </div>
              <Badge type={item.criticas > 0 ? 'urgente' : item.observadas > 0 ? 'advertencia' : 'ok'}>{item.total}</Badge>
            </div>
          ))}
        </div>

        <div style={S.card}>
          <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, marginBottom:12 }}>Por objetivo</div>
          {porObjetivo.length === 0 ? (
            <div style={{ color:'#64748b', fontSize:13 }}>Sin historial de supervisiones.</div>
          ) : porObjetivo.slice(0, 12).map((item: any) => (
            <div
              key={item.objetivo_id}
              style={{ padding:'10px 0', borderTop:'1px solid #1e2d42', cursor:'pointer' }}
              title="Ver supervisiones de este objetivo"
              onClick={() => aplicarFiltro({ tipo: 'objetivo', label: nombreObjetivo(item.objetivo_id), objetivo_id: item.objetivo_id })}
            >
              <div style={{ display:'flex', justifyContent:'space-between', gap:10 }}>
                <div style={{ fontWeight:800 }}>{nombreObjetivo(item.objetivo_id)}</div>
                <Badge type={item.criticas > 0 ? 'urgente' : item.observadas > 0 ? 'advertencia' : 'ok'}>{item.total}</Badge>
              </div>
              <div style={{ color:'#94a3b8', fontSize:12, marginTop:4 }}>
                Última {fechaHora(item.ultima?.created_at)} · {item.observadas} observadas · {item.criticas} críticas
              </div>
            </div>
          ))}
        </div>

        <div style={S.card}>
          <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, marginBottom:12 }}>Objetivos sin supervisión vigente</div>
          {objetivosSinSupervision.length === 0 ? (
            <div style={{ color:'#64748b', fontSize:13 }}>Todos los objetivos activos están dentro de frecuencia.</div>
          ) : objetivosSinSupervision.map((objetivo: Objetivo) => {
            const ultima = ultimaIsoPorObjetivo.get(objetivo.id)
            return (
              <div
                key={objetivo.id}
                style={{ padding:'10px 0', borderTop:'1px solid #1e2d42', cursor:'pointer' }}
                title="Ver historial de supervisiones de este objetivo"
                onClick={() => aplicarFiltro({ tipo: 'objetivo', label: `Historial: ${objetivo.nombre}`, objetivo_id: objetivo.id })}
              >
                <div style={{ display:'flex', justifyContent:'space-between', gap:10 }}>
                  <div style={{ fontWeight:800 }}>{objetivo.nombre}</div>
                  <Badge type="advertencia">{objetivo.frecuencia_supervision_horas || 24} h</Badge>
                </div>
                <div style={{ color:'#94a3b8', fontSize:12, marginTop:4 }}>
                  Última supervisión: {ultima ? fechaHora(ultima.created_at) : 'sin registros'}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div ref={tablaRef} style={S.card}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'center', marginBottom:12 }}>
          <div>
            <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800 }}>
              {filtroTabla ? `Filtro: ${filtroTabla.label}` : 'Últimas supervisiones'}
            </div>
            <div style={{ color:'#64748b', fontSize:13 }}>
              {filtroTabla
                ? `${supervisionesTabla.length} resultado(s) para este filtro`
                : `${supervisionesTabla.length} registro(s) recientes`}
            </div>
          </div>
          {filtroTabla && (
            <button
              style={{ ...S.btn, ...S.btnSecondary, padding:'6px 14px', fontSize:12 }}
              onClick={() => setFiltroTabla(null)}
            >
              Quitar filtro
            </button>
          )}
        </div>

        {supervisionesTabla.length === 0 ? (
          <div style={{ color:'#64748b', fontSize:13 }}>Sin supervisiones para este filtro.</div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Fecha/hora</th>
                  <th style={S.th}>Objetivo</th>
                  <th style={S.th}>Supervisor</th>
                  <th style={S.th}>Estado</th>
                  <th style={S.th}>Observaciones</th>
                  <th style={S.th}>Ítems observados</th>
                  <th style={S.th}>Fotos</th>
                  <th style={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {supervisionesTabla.map((supervision: SupervisionAdmin) => (
                  <tr key={supervision.id}>
                    <td style={S.td}>{fechaHora(supervision.created_at)}</td>
                    <td style={S.td}>{supervision.objetivo?.nombre || nombreObjetivo(supervision.objetivo_id)}</td>
                    <td style={S.td}>{supervision.supervisor ? `${supervision.supervisor.apellido}, ${supervision.supervisor.nombre}` : nombreSupervisor(supervision.supervisor_id)}</td>
                    <td style={S.td}><Badge type={supervision.estado === 'critico' ? 'urgente' : supervision.estado === 'con_observacion' ? 'advertencia' : 'ok'}>{supervision.estado}</Badge></td>
                    <td style={{ ...S.td, color:'#94a3b8', maxWidth:260 }}>{supervision.observaciones || '—'}</td>
                    <td style={S.td}>{observados(supervision)}</td>
                    <td style={S.td}>{fotosCount(supervision)}</td>
                    <td style={S.td}>
                      <button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 10px', fontSize:12 }} onClick={() => abrirDetalle(supervision)}>
                        Ver detalle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
        </>
      )}

      {detalleSupervision && (
        <Modal title="Detalle de supervisión" onClose={() => setDetalleSupervision(null)}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:12, marginBottom:16 }}>
            <div><label style={S.label}>Objetivo</label><div>{detalleSupervision.objetivo?.nombre || nombreObjetivo(detalleSupervision.objetivo_id)}</div></div>
            <div><label style={S.label}>Supervisor</label><div>{detalleSupervision.supervisor ? `${detalleSupervision.supervisor.apellido}, ${detalleSupervision.supervisor.nombre}` : nombreSupervisor(detalleSupervision.supervisor_id)}</div></div>
            <div><label style={S.label}>Fecha/hora</label><div>{fechaHora(detalleSupervision.created_at)}</div></div>
            <div><label style={S.label}>Estado</label><Badge type={detalleSupervision.estado === 'critico' ? 'urgente' : detalleSupervision.estado === 'con_observacion' ? 'advertencia' : 'ok'}>{detalleSupervision.estado}</Badge></div>
          </div>

          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Observaciones generales</label>
            <div style={{ color:'#cbd5e1' }}>{detalleSupervision.observaciones || '—'}</div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:12, marginBottom:16 }}>
            <div><label style={S.label}>Latitud</label><div>{detalleSupervision.lat}</div></div>
            <div><label style={S.label}>Longitud</label><div>{detalleSupervision.lng}</div></div>
            <div><label style={S.label}>Precisión GPS</label><div>{metrosGpsTexto(detalleSupervision.precision_gps)}</div></div>
            <div><label style={S.label}>Distancia al objetivo</label><div>{metrosGpsTexto(auditoriaDetalleAdmin?.distancia_objetivo_metros)}</div></div>
            <div><label style={S.label}>Dentro del radio</label><div>{auditoriaDetalleAdmin?.dentro_radio === null || auditoriaDetalleAdmin?.dentro_radio === undefined ? '—' : auditoriaDetalleAdmin.dentro_radio ? 'Sí' : 'No'}</div></div>
            <div><label style={S.label}>Radio permitido</label><div>{metrosGpsTexto(auditoriaDetalleAdmin?.radio)}</div></div>
            <div><label style={S.label}>GPS impreciso</label><div>{auditoriaDetalleAdmin ? auditoriaDetalleAdmin.gpsImpreciso ? 'Sí' : 'No' : '—'}</div></div>
          </div>

          <a href={mapasUrl(detalleSupervision)} target="_blank" rel="noreferrer" style={{ ...S.btn, ...S.btnPrimary, textDecoration:'none', marginBottom:16 }}>
            Ver en Google Maps
          </a>

          {detalleError && <div style={{ ...S.card, padding:12, color:'#fca5a5', borderColor:'rgba(239,68,68,.35)' }}>{detalleError}</div>}
          {detalleLoading && <div style={{ color:'#64748b', padding:'12px 0' }}>Cargando detalle...</div>}

          {!detalleLoading && (
            <>
              <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, margin:'18px 0 10px' }}>Checklist completo</div>
              {itemsDetalle.length === 0 ? (
                <div style={{ color:'#64748b', fontSize:13 }}>Sin checklist asociado.</div>
              ) : itemsDetalle.map(item => {
                const respuesta = respuestasPorItem.get(item.id)
                return (
                  <div key={item.id} style={{ borderTop:'1px solid #1e2d42', padding:'10px 0' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', gap:10 }}>
                      <div style={{ fontWeight:800 }}>{item.texto}</div>
                      <Badge type={respuesta?.resultado === 'observado' ? 'advertencia' : respuesta?.resultado === 'correcto' ? 'ok' : 'programado'}>{respuesta?.resultado || 'sin respuesta'}</Badge>
                    </div>
                    <div style={{ color:'#94a3b8', fontSize:12, marginTop:4 }}>
                      {item.obligatorio ? 'Obligatorio' : 'Opcional'} · Criticidad {item.criticidad}{item.foto_obligatoria ? ' · Foto obligatoria' : ''}
                    </div>
                    {respuesta?.observacion && <div style={{ color:'#cbd5e1', fontSize:13, marginTop:6 }}>{respuesta.observacion}</div>}
                  </div>
                )
              })}

              <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, margin:'18px 0 10px' }}>Fotos adjuntas</div>
              {detalleFotos.length === 0 ? (
                <div style={{ color:'#64748b', fontSize:13 }}>Sin fotos adjuntas.</div>
              ) : (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))', gap:12 }}>
                  {detalleFotos.map(foto => {
                    const fotoUrl = foto.signedUrl || foto.publicUrl

                    return (
                      <div key={foto.id} style={{ border:'1px solid #1e2d42', borderRadius:8, padding:8, background:'#0f172a' }}>
                        {fotoUrl ? (
                          <>
                            <img src={fotoUrl} alt="" style={{ width:'100%', aspectRatio:'1', objectFit:'cover', borderRadius:6, marginBottom:8 }} />
                            <a href={fotoUrl} target="_blank" rel="noreferrer" style={{ color:'#f59e0b', fontSize:12 }}>Abrir foto</a>
                            {foto.error && <div style={{ color:'#f59e0b', fontSize:12, marginTop:6 }}>{foto.error}</div>}
                          </>
                        ) : (
                          <>
                            <div style={{ color:'#94a3b8', fontSize:12, wordBreak:'break-all' }}>{foto.storage_path}</div>
                            {foto.error && <div style={{ color:'#f59e0b', fontSize:12, marginTop:6 }}>{foto.error}</div>}
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </Modal>
      )}
    </div>
  )
}

function ChecklistsAdmin({ plantillas, setPlantillas, items, setItems }: any) {
  const [plantillaSeleccionadaId, setPlantillaSeleccionadaId] = useState('')
  const [plantillaForm, setPlantillaForm] = useState({ nombre:'', descripcion:'' })
  const [itemForm, setItemForm] = useState({ texto:'', obligatorio:true, criticidad:'normal', foto_obligatoria:false })
  const [loading, setLoading] = useState('')
  const [mensaje, setMensaje] = useState<{ tipo:'ok' | 'error', texto:string } | null>(null)

  useEffect(() => {
    if (!plantillaSeleccionadaId && plantillas.length > 0) {
      setPlantillaSeleccionadaId(plantillas[0].id)
      return
    }

    if (plantillaSeleccionadaId && !plantillas.some((p: ChecklistPlantillaAdmin) => p.id === plantillaSeleccionadaId)) {
      setPlantillaSeleccionadaId(plantillas[0]?.id || '')
    }
  }, [plantillas, plantillaSeleccionadaId])

  const plantillaSeleccionada = plantillas.find((p: ChecklistPlantillaAdmin) => p.id === plantillaSeleccionadaId)
  const itemsPlantilla = items
    .filter((item: ChecklistItemAdmin) => item.plantilla_id === plantillaSeleccionadaId)
    .sort((a: ChecklistItemAdmin, b: ChecklistItemAdmin) => (a.orden || 0) - (b.orden || 0))

  const guardarPlantilla = async () => {
    if (!plantillaForm.nombre.trim()) return
    setLoading('plantilla')
    setMensaje(null)

    const { data, error } = await supabase
      .from('checklist_plantillas')
      .insert({
        nombre: plantillaForm.nombre.trim(),
        descripcion: plantillaForm.descripcion.trim() || null,
        activo: true,
      })
      .select()
      .single()

    if (error) {
      setMensaje({ tipo:'error', texto:error.message })
    } else if (data) {
      setPlantillas((prev: ChecklistPlantillaAdmin[]) => [...prev, data])
      setPlantillaSeleccionadaId(data.id)
      setPlantillaForm({ nombre:'', descripcion:'' })
      setMensaje({ tipo:'ok', texto:'Plantilla creada.' })
    }

    setLoading('')
  }

  const actualizarPlantilla = async (plantilla: ChecklistPlantillaAdmin, patch: Partial<ChecklistPlantillaAdmin>) => {
    setLoading(`plantilla-${plantilla.id}`)
    setMensaje(null)

    const { data, error } = await supabase
      .from('checklist_plantillas')
      .update(patch)
      .eq('id', plantilla.id)
      .select()
      .single()

    if (error) {
      setMensaje({ tipo:'error', texto:error.message })
    } else if (data) {
      setPlantillas((prev: ChecklistPlantillaAdmin[]) => prev.map(p => p.id === plantilla.id ? data : p))
    }

    setLoading('')
  }

  const guardarItem = async () => {
    if (!plantillaSeleccionadaId || !itemForm.texto.trim()) return
    setLoading('item')
    setMensaje(null)

    const ordenSiguiente = itemsPlantilla.reduce((max: number, item: ChecklistItemAdmin) => Math.max(max, item.orden || 0), 0) + 10
    const { data, error } = await supabase
      .from('checklist_items')
      .insert({
        plantilla_id: plantillaSeleccionadaId,
        texto: itemForm.texto.trim(),
        orden: ordenSiguiente,
        obligatorio: itemForm.obligatorio,
        criticidad: itemForm.criticidad,
        foto_obligatoria: itemForm.foto_obligatoria,
        activo: true,
      })
      .select()
      .single()

    if (error) {
      setMensaje({ tipo:'error', texto:error.message })
    } else if (data) {
      setItems((prev: ChecklistItemAdmin[]) => [...prev, data])
      setItemForm({ texto:'', obligatorio:true, criticidad:'normal', foto_obligatoria:false })
      setMensaje({ tipo:'ok', texto:'Ítem agregado.' })
    }

    setLoading('')
  }

  const actualizarItem = async (item: ChecklistItemAdmin, patch: Partial<ChecklistItemAdmin>) => {
    setLoading(`item-${item.id}`)
    setMensaje(null)

    const { data, error } = await supabase
      .from('checklist_items')
      .update(patch)
      .eq('id', item.id)
      .select()
      .single()

    if (error) {
      setMensaje({ tipo:'error', texto:error.message })
    } else if (data) {
      setItems((prev: ChecklistItemAdmin[]) => prev.map(i => i.id === item.id ? data : i))
    }

    setLoading('')
  }

  const editarTextoItem = async (item: ChecklistItemAdmin) => {
    const texto = window.prompt('Texto del ítem', item.texto)
    if (!texto || !texto.trim() || texto.trim() === item.texto) return
    await actualizarItem(item, { texto:texto.trim() })
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', gap:16, alignItems:'flex-start', marginBottom:24 }}>
        <div>
          <div style={S.title}>Checklists de supervisión</div>
          <div style={S.sub2}>Plantillas, ítems y reglas de fotos para objetivos.</div>
        </div>
      </div>

      {mensaje && (
        <div style={{ ...S.card, padding:12, color:mensaje.tipo === 'ok' ? '#86efac' : '#fca5a5', borderColor:mensaje.tipo === 'ok' ? 'rgba(16,185,129,.35)' : 'rgba(239,68,68,.35)' }}>
          {mensaje.texto}
        </div>
      )}

      <div style={{ ...S.card, marginBottom:20 }}>
        <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, marginBottom:12 }}>Nueva plantilla</div>
        <div style={S.grid2}>
          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Nombre</label>
            <input style={S.input} value={plantillaForm.nombre} onChange={e => setPlantillaForm({ ...plantillaForm, nombre:e.target.value })} />
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Descripción</label>
            <input style={S.input} value={plantillaForm.descripcion} onChange={e => setPlantillaForm({ ...plantillaForm, descripcion:e.target.value })} />
          </div>
        </div>
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={guardarPlantilla} disabled={loading === 'plantilla' || !plantillaForm.nombre.trim()}>
          {loading === 'plantilla' ? 'Creando...' : 'Crear plantilla'}
        </button>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'minmax(260px, .75fr) minmax(360px, 1.25fr)', gap:20 }}>
        <div style={S.card}>
          <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, marginBottom:12 }}>Plantillas</div>
          {plantillas.length === 0 ? (
            <div style={{ color:'#64748b', fontSize:13 }}>No hay plantillas creadas.</div>
          ) : plantillas.map((plantilla: ChecklistPlantillaAdmin) => (
            <div key={plantilla.id} style={{ border:'1px solid #1e2d42', borderRadius:8, padding:12, marginBottom:10, background:plantilla.id === plantillaSeleccionadaId ? 'rgba(245,158,11,.08)' : '#0f172a' }}>
              <button
                type="button"
                onClick={() => setPlantillaSeleccionadaId(plantilla.id)}
                style={{ background:'transparent', border:'none', color:'#e2e8f0', fontWeight:800, cursor:'pointer', padding:0, textAlign:'left' }}
              >
                {plantilla.nombre}
              </button>
              {plantilla.descripcion && <div style={{ color:'#94a3b8', fontSize:12, marginTop:4 }}>{plantilla.descripcion}</div>}
              <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:10 }}>
                <Badge type={plantilla.activo ? 'activo' : 'inactivo'}>{plantilla.activo ? 'activo' : 'inactivo'}</Badge>
                <button
                  style={{ ...S.btn, ...S.btnSecondary, padding:'5px 10px', fontSize:12 }}
                  onClick={() => actualizarPlantilla(plantilla, { activo:!plantilla.activo })}
                  disabled={loading === `plantilla-${plantilla.id}`}
                >
                  {plantilla.activo ? 'Desactivar' : 'Activar'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div style={S.card}>
          <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'center', marginBottom:12 }}>
            <div>
              <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800 }}>{plantillaSeleccionada?.nombre || 'Seleccioná una plantilla'}</div>
              <div style={{ color:'#64748b', fontSize:13 }}>{itemsPlantilla.length} ítem(s)</div>
            </div>
          </div>

          {plantillaSeleccionada && (
            <>
              <div style={{ border:'1px solid #1e2d42', borderRadius:8, padding:12, marginBottom:16, background:'#0f172a' }}>
                <label style={S.label}>Nuevo ítem</label>
                <input style={S.input} value={itemForm.texto} onChange={e => setItemForm({ ...itemForm, texto:e.target.value })} />
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, alignItems:'center' }}>
                  <label style={{ display:'flex', gap:8, alignItems:'center', fontSize:13, color:'#cbd5e1' }}>
                    <input type="checkbox" checked={itemForm.obligatorio} onChange={e => setItemForm({ ...itemForm, obligatorio:e.target.checked })} />
                    Obligatorio
                  </label>
                  <label style={{ display:'flex', gap:8, alignItems:'center', fontSize:13, color:'#cbd5e1' }}>
                    <input type="checkbox" checked={itemForm.foto_obligatoria} onChange={e => setItemForm({ ...itemForm, foto_obligatoria:e.target.checked })} />
                    Foto obligatoria
                  </label>
                  <select style={{ ...S.select, marginBottom:0 }} value={itemForm.criticidad} onChange={e => setItemForm({ ...itemForm, criticidad:e.target.value })}>
                    <option value="normal">Normal</option>
                    <option value="alta">Alta</option>
                  </select>
                </div>
                <button style={{ ...S.btn, ...S.btnPrimary, marginTop:12 }} onClick={guardarItem} disabled={loading === 'item' || !itemForm.texto.trim()}>
                  {loading === 'item' ? 'Agregando...' : 'Agregar ítem'}
                </button>
              </div>

              {itemsPlantilla.length === 0 ? (
                <div style={{ color:'#64748b', fontSize:13 }}>Esta plantilla todavía no tiene ítems.</div>
              ) : itemsPlantilla.map((item: ChecklistItemAdmin) => (
                <div key={item.id} style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:12, borderTop:'1px solid #1e2d42', padding:'12px 0', opacity:item.activo ? 1 : 0.55 }}>
                  <div>
                    <div style={{ fontWeight:800, color:'#e2e8f0' }}>{item.texto}</div>
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:6 }}>
                      <Badge type={item.criticidad === 'alta' ? 'urgente' : 'normal'}>{item.criticidad}</Badge>
                      <Badge type={item.obligatorio ? 'activo' : 'programado'}>{item.obligatorio ? 'obligatorio' : 'opcional'}</Badge>
                      {item.foto_obligatoria && <Badge type="advertencia">foto obligatoria</Badge>}
                      {!item.activo && <Badge type="inactivo">inactivo</Badge>}
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap', justifyContent:'flex-end' }}>
                    <button style={{ ...S.btn, ...S.btnSecondary, padding:'5px 9px', fontSize:12 }} onClick={() => actualizarItem(item, { orden:(item.orden || 0) - 15 })}>↑</button>
                    <button style={{ ...S.btn, ...S.btnSecondary, padding:'5px 9px', fontSize:12 }} onClick={() => actualizarItem(item, { orden:(item.orden || 0) + 15 })}>↓</button>
                    <button style={{ ...S.btn, ...S.btnSecondary, padding:'5px 9px', fontSize:12 }} onClick={() => editarTextoItem(item)}>Texto</button>
                    <button style={{ ...S.btn, ...S.btnSecondary, padding:'5px 9px', fontSize:12 }} onClick={() => actualizarItem(item, { obligatorio:!item.obligatorio })}>{item.obligatorio ? 'Opcional' : 'Obligatorio'}</button>
                    <button style={{ ...S.btn, ...S.btnSecondary, padding:'5px 9px', fontSize:12 }} onClick={() => actualizarItem(item, { criticidad:item.criticidad === 'alta' ? 'normal' : 'alta' })}>{item.criticidad === 'alta' ? 'Normal' : 'Alta'}</button>
                    <button style={{ ...S.btn, ...S.btnSecondary, padding:'5px 9px', fontSize:12 }} onClick={() => actualizarItem(item, { foto_obligatoria:!item.foto_obligatoria })}>{item.foto_obligatoria ? 'Sin foto' : 'Foto req.'}</button>
                    <button style={{ ...S.btn, ...S.btnSecondary, padding:'5px 9px', fontSize:12 }} onClick={() => actualizarItem(item, { activo:!item.activo })}>{item.activo ? 'Desactivar' : 'Activar'}</button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}


function Objetivos({ objetivos, setObjetivos, turnos, checklistPlantillas = [], zonasOperativas = [], filtroActivo, limpiarFiltro, guardias = [], registros = [], supervisiones = [], novedades = [], user, onNavigate }: any) {
  const [objetivoSeleccionadoId, setObjetivoSeleccionadoId] = useState<string | null>(null)
  const [modal, setModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [estadoFiltro, setEstadoFiltro] = useState('activo')
  const [zonaFiltro, setZonaFiltro] = useState('todas')
  const [filtroKpi, setFiltroKpi] = useState('')
  const [confirmarBorrado, setConfirmarBorrado] = useState<any>(null)
  const [verificandoBorrado, setVerificandoBorrado] = useState(false)
  const [borrando, setBorrando] = useState(false)
  const [bloqueoBorrado, setBloqueoBorrado] = useState<string | null>(null)

  const formVacio = {
    nombre: '',
    cliente: '',
    direccion: '',
    estado: 'activo',
    radio_metros: 200,
    checklist_plantilla_id: '',
    frecuencia_supervision_horas: 24,
    zona_id: '',
    tipo_ubicacion: 'fijo',
  }
  const [form, setForm] = useState(formVacio)

  const hoy = new Date().toISOString().split('T')[0]

  const turnosHoyPorObjetivo = (objetivoId: string) => {
    return turnos.filter((t: any) => t.objetivo_id === objetivoId && t.fecha === hoy)
  }

  // Un objetivo pausado conserva sus turnos pero no genera obligación: no
  // corresponde marcarle "sin cubrir". Mismo criterio que el resto del sistema.
  const objetivoOperativoPorId = (objetivoId: string) =>
    objetivoEstaOperativo(objetivos.find((o: any) => o.id === objetivoId))

  const estadoOperativo = (objetivoId: string) => {
    const ts = turnosHoyPorObjetivo(objetivoId)
    if (ts.length === 0) return null
    const operativo = objetivoOperativoPorId(objetivoId)
    const sinCubrir = operativo ? ts.filter((t: any) => turnoSinCoberturaOperativa(t)).length : 0
    const cubiertos = ts.filter((t: any) => t.estado === 'cubierto' && t.guardia_id).length
    return { total: ts.length, cubiertos, sinCubrir }
  }

  const abrirNuevo = () => {
    setForm(formVacio)
    setEditId(null)
    setModal(true)
  }

  const abrirEditar = (o: any) => {
    setForm({
      nombre: o.nombre || '',
      cliente: o.cliente || '',
      direccion: o.direccion || '',
      estado: o.estado || 'activo',
      radio_metros: o.radio_metros || 200,
      checklist_plantilla_id: o.checklist_plantilla_id || '',
      frecuencia_supervision_horas: o.frecuencia_supervision_horas || 24,
      zona_id: o.zona_id || '',
      tipo_ubicacion: o.tipo_ubicacion || 'fijo',
    })
    setEditId(o.id)
    setModal(true)
  }

  // TODO: al crear un objetivo nuevo debe crearse también su puesto inicial, o
  // existir una pantalla explícita para hacerlo. Hoy la aplicación no garantiza
  // esa creación y puede dejar objetivos sin puestos.
  //
  // Contexto: los puestos existentes se crearon una única vez por el backfill de
  // 20260706_puestos.sql. Ninguna ruta de la aplicación inserta en `puestos`, así
  // que todo objetivo dado de alta después nace sin ninguno. El 2026-07-28 eso
  // había dejado 6 objetivos activos sin puesto y 153 turnos sin `puesto_id`, y
  // hubo que resolverlo por SQL. Un objetivo sin puestos no admite turnos desde
  // la interfaz (ver lib/puestos.ts) ni puede tener rondas.
  const guardar = async () => {
    if (!form.nombre.trim()) return
    setLoading(true)

    const radioNuevo = Number(form.radio_metros) || 200

    const payload = {
      nombre: form.nombre.trim(),
      cliente: form.cliente.trim() || null,
      direccion: form.direccion.trim() || null,
      estado: form.estado,
      checklist_plantilla_id: form.checklist_plantilla_id || null,
      frecuencia_supervision_horas: Math.max(1, Number(form.frecuencia_supervision_horas) || 24),
      zona_id: form.zona_id || null,
      tipo_ubicacion: form.tipo_ubicacion === 'movil' ? 'movil' : 'fijo',
    }

    if (editId) {
      // El radio ya no viaja en este payload: es una columna GPS y sólo la
      // escribe establecer_ubicacion_objetivo(), que además abre la vigencia
      // en el historial. Se guarda primero lo administrativo y después, si el
      // radio cambió y el objetivo tiene ubicación, se llama a la ruta.
      const { data } = await supabase
        .from('objetivos')
        .update(payload)
        .eq('id', editId)
        .select()
        .single()
      if (data) setObjetivos((prev: any[]) => prev.map(o => o.id === editId ? data : o))

      const anterior = (objetivos as any[]).find(o => o.id === editId)
      const radioCambio = anterior && Number(anterior.radio_metros) !== radioNuevo
      const tieneUbicacion = anterior
        && typeof anterior.lat === 'number' && typeof anterior.lng === 'number'

      if (radioCambio && tieneUbicacion) {
        const { objetivo: conRadio, error: errorRadio } = await actualizarUbicacionObjetivo(
          editId, anterior.lat, anterior.lng, radioNuevo,
        )
        if (errorRadio) {
          alert(`Los datos se guardaron, pero el radio no: ${errorRadio}`)
        } else if (conRadio) {
          setObjetivos((prev: any[]) => prev.map(o => o.id === editId ? { ...o, ...conRadio } : o))
        }
      } else if (radioCambio && !tieneUbicacion) {
        alert('El radio no se guardó: primero hay que cargarle una ubicación al objetivo.')
      }
    } else {
      // El alta sigue siendo un INSERT normal, con su radio. El trigger
      // trg_objetivos_vigencia_alta abre la primera vigencia solo.
      const { data } = await supabase
        .from('objetivos')
        .insert({ ...payload, radio_metros: radioNuevo })
        .select()
        .single()
      if (data) setObjetivos((prev: any[]) => [...prev, data])
    }

    setModal(false)
    setEditId(null)
    setForm(formVacio)
    setLoading(false)
  }

  const toggleEstado = async (o: any) => {
    const nuevoEstado = o.estado === 'activo' ? 'inactivo' : 'activo'
    const { data } = await supabase
      .from('objetivos')
      .update({ estado: nuevoEstado })
      .eq('id', o.id)
      .select()
      .single()
    if (data) setObjetivos((prev: any[]) => prev.map(x => x.id === o.id ? data : x))
  }

  const abrirConfirmarBorrado = async (o: any) => {
    setBloqueoBorrado(null)
    setConfirmarBorrado(o)
    setVerificandoBorrado(true)

    const [turnosRel, supervisionesRel, novedadesRel, serviciosRel, rondasRel] = await Promise.all([
      supabase.from('turnos').select('id', { count: 'exact', head: true }).eq('objetivo_id', o.id),
      supabase.from('supervisiones').select('id', { count: 'exact', head: true }).eq('objetivo_id', o.id),
      supabase.from('novedades').select('id', { count: 'exact', head: true }).eq('objetivo_id', o.id),
      supabase.from('servicios_objetivo').select('id', { count: 'exact', head: true }).eq('objetivo_id', o.id),
      supabase.from('rondas_base').select('id', { count: 'exact', head: true }).eq('objetivo_id', o.id),
    ])

    const motivos: string[] = []
    if ((turnosRel.count || 0) > 0) motivos.push(`${turnosRel.count} turno(s)`)
    if ((supervisionesRel.count || 0) > 0) motivos.push(`${supervisionesRel.count} supervisión(es)`)
    if ((novedadesRel.count || 0) > 0) motivos.push(`${novedadesRel.count} novedad(es)`)
    if ((serviciosRel.count || 0) > 0) motivos.push(`${serviciosRel.count} servicio(s) programado(s)`)
    if ((rondasRel.count || 0) > 0) motivos.push(`${rondasRel.count} ronda(s) configurada(s)`)

    if (rondasRel.error) {
      setBloqueoBorrado('No se pudo verificar si el objetivo tiene rondas configuradas. Por seguridad, el borrado definitivo permanece bloqueado.')
    } else if ((rondasRel.count || 0) > 0) {
      setBloqueoBorrado('El objetivo no puede eliminarse porque tiene rondas configuradas. Desactive o reasigne primero esas rondas.')
    } else if (motivos.length > 0) {
      setBloqueoBorrado(`Este objetivo tiene historial (${motivos.join(', ')}) y no se puede borrar definitivamente. Solo se permite la baja lógica.`)
    }

    setVerificandoBorrado(false)
  }

  const confirmarBorradoFisico = async () => {
    if (!confirmarBorrado || bloqueoBorrado) return
    setBorrando(true)
    const { error } = await supabase.from('objetivos').delete().eq('id', confirmarBorrado.id)
    setBorrando(false)

    if (error) {
      setBloqueoBorrado(`No se pudo borrar: ${error.message}`)
      return
    }

    setObjetivos((prev: any[]) => prev.filter(x => x.id !== confirmarBorrado.id))
    setConfirmarBorrado(null)
  }

  const filtroTipo = filtroActivo?.tipo || filtroKpi
  const idsFiltroObjetivos = new Set((filtroActivo?.ids ?? []) as string[])
  const limpiarFiltroObjetivos = () => {
    setFiltroKpi('')
    limpiarFiltro?.()
  }

  const objetivosConTurnosHoy = objetivos.filter((o: any) => turnosHoyPorObjetivo(o.id).length > 0)
  const objetivosSinCubrirHoy = objetivos.filter((o: any) => {
    if (!objetivoEstaOperativo(o)) return false
    const ts = turnosHoyPorObjetivo(o.id)
    return ts.some((t: any) => turnoSinCoberturaOperativa(t))
  })

  const filtrados = objetivos.filter((o: any) => {
    if (idsFiltroObjetivos.size > 0 && !idsFiltroObjetivos.has(o.id)) return false
    if (filtroTipo === 'activos' && o.estado !== 'activo') return false
    if (filtroTipo === 'con_turnos_hoy' && !objetivosConTurnosHoy.some((x: any) => x.id === o.id)) return false
    if (filtroTipo === 'sin_cubrir_hoy' && !objetivosSinCubrirHoy.some((x: any) => x.id === o.id)) return false
    if (estadoFiltro === 'activo' && o.estado !== 'activo') return false
    if (estadoFiltro === 'inactivo' && o.estado === 'activo') return false
    if (zonaFiltro !== 'todas' && (o.zona_id || '') !== zonaFiltro) return false
    if (!busqueda.trim()) return true
    const q = busqueda.toLowerCase()
    return (
      o.nombre?.toLowerCase().includes(q) ||
      o.cliente?.toLowerCase().includes(q) ||
      o.direccion?.toLowerCase().includes(q)
    )
  })

  const activos = objetivos.filter((o: any) => o.estado === 'activo').length
  const inactivos = objetivos.filter((o: any) => o.estado !== 'activo').length

  // El legajo se alimenta solo desde lib/legajo-objetivo por objetivo_id; ya no
  // recibe los arrays globales del panel.
  if (objetivoSeleccionadoId) {
    return (
      <CentroOperativoObjetivo
        objetivoId={objetivoSeleccionadoId}
        onVolver={() => setObjetivoSeleccionadoId(null)}
        onNavigate={onNavigate}
        esAdmin={user?.rol === 'admin'}
        rolUsuario={user?.rol}
      />
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', marginBottom:24 }}>
        <div style={{ flex:1 }}>
          <div style={S.title}>Objetivos</div>
          <div style={S.sub2}>
            {activos} activos · {inactivos} inactivos
          </div>
        </div>
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={abrirNuevo}>
          + Nuevo Objetivo
        </button>
      </div>

      {/* Stats rápidas */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:12, marginBottom:20 }}>
        <div onClick={() => setFiltroKpi('')} style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:10, padding:'14px 16px', cursor:'pointer' }}>
          <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:1, marginBottom:6 }}>Total</div>
          <div style={{ fontFamily:'Syne,sans-serif', fontSize:28, fontWeight:800 }}>{objetivos.length}</div>
        </div>
        <div onClick={() => setFiltroKpi('activos')} style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:10, padding:'14px 16px', borderTop:'3px solid #10b981', cursor:'pointer' }}>
          <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:1, marginBottom:6 }}>Activos</div>
          <div style={{ fontFamily:'Syne,sans-serif', fontSize:28, fontWeight:800, color:'#10b981' }}>{activos}</div>
        </div>
        <div onClick={() => setFiltroKpi('con_turnos_hoy')} style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:10, padding:'14px 16px', borderTop:'3px solid #f59e0b', cursor:'pointer' }}>
          <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:1, marginBottom:6 }}>Con turnos hoy</div>
          <div style={{ fontFamily:'Syne,sans-serif', fontSize:28, fontWeight:800, color:'#f59e0b' }}>
            {objetivosConTurnosHoy.length}
          </div>
        </div>
        <div onClick={() => setFiltroKpi('sin_cubrir_hoy')} style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:10, padding:'14px 16px', borderTop:'3px solid #ef4444', cursor:'pointer' }}>
          <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:1, marginBottom:6 }}>Sin cubrir hoy</div>
          <div style={{ fontFamily:'Syne,sans-serif', fontSize:28, fontWeight:800, color:'#ef4444' }}>
            {objetivosSinCubrirHoy.length}
          </div>
        </div>
      </div>

      {filtroTipo && (
        <div style={{ ...S.card, padding:12, display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ color:'#f59e0b' }}>Filtro activo: {filtroActivo?.label || filtroTipo}</span>
          <button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 10px', fontSize:12 }} onClick={limpiarFiltroObjetivos}>Limpiar filtro</button>
        </div>
      )}

      {/* Buscador */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', marginBottom:16 }}>
        <input
          style={{ ...S.input, maxWidth:360, marginBottom:0 }}
          placeholder="🔍  Buscar por nombre, cliente o dirección..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
        />
        <select
          style={{ ...S.select, maxWidth:180, marginBottom:0 }}
          value={estadoFiltro}
          onChange={e => setEstadoFiltro(e.target.value)}
        >
          <option value="todos">Todos</option>
          <option value="activo">Activos</option>
          <option value="inactivo">Inactivos</option>
        </select>
        <select
          style={{ ...S.select, maxWidth:200, marginBottom:0 }}
          value={zonaFiltro}
          onChange={e => setZonaFiltro(e.target.value)}
        >
          <option value="todas">Todas las zonas</option>
          {zonasOperativas.map((z: any) => (
            <option key={z.id} value={z.id}>{z.nombre}</option>
          ))}
        </select>
      </div>

      {/* Tabla */}
      <div style={S.card}>
        {filtrados.length === 0 ? (
          <div style={{ textAlign:'center', padding:48, color:'#64748b' }}>
            <div style={{ fontSize:36, marginBottom:12 }}>🏢</div>
                          <div>{busqueda || filtroTipo ? 'Sin resultados para el filtro aplicado.' : 'No hay objetivos cargados.'}</div>
          </div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Objetivo</th>
                  <th style={S.th}>Cliente</th>
                  <th style={S.th}>Dirección</th>
                  <th style={S.th}>Estado</th>
                  <th style={S.th}>Hoy</th>
                  <th style={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((o: any) => {
                  const op = estadoOperativo(o.id)
                  return (
                    <tr key={o.id} style={{ opacity: o.estado === 'inactivo' ? 0.5 : 1 }}>

                      {/* Nombre */}
                      <td style={S.td}>
                        <strong
                          style={{ fontSize:14, cursor:'pointer', color:'#60a5fa', textDecoration:'underline' }}
                          onClick={() => setObjetivoSeleccionadoId(o.id)}
                          title="Ver Centro Operativo"
                        >{o.nombre}</strong>
                        {o.radio_metros && (
                          <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>
                            📍 radio {o.radio_metros}m
                          </div>
                        )}
                        <div style={{ fontSize:11, color: objetivoTieneGps(o) ? '#10b981' : '#f59e0b', marginTop:2 }}>
                          {objetivoTieneGps(o) ? 'GPS completo' : 'Falta GPS'}
                        </div>
                        <div style={{ fontSize:11, color:o.checklist_plantilla_id ? '#60a5fa' : '#64748b', marginTop:2 }}>
                          {o.checklist_plantilla_id
                            ? `Checklist · cada ${o.frecuencia_supervision_horas || 24} h`
                            : 'Sin checklist asignado'}
                        </div>
                        <div style={{ fontSize:11, color: o.zona_id ? '#a78bfa' : '#64748b', marginTop:2 }}>
                          🗺️ {zonasOperativas.find((z: any) => z.id === o.zona_id)?.nombre || 'Sin zona'}
                        </div>
                      </td>

                      {/* Cliente */}
                      <td style={{ ...S.td, color:'#94a3b8', fontSize:13 }}>
                        {o.cliente || <span style={{ color:'#374151' }}>—</span>}
                      </td>

                      {/* Dirección */}
                      <td style={{ ...S.td, color:'#94a3b8', fontSize:13, maxWidth:200 }}>
                        {o.direccion || <span style={{ color:'#374151' }}>—</span>}
                      </td>

                      {/* Estado */}
                      <td style={S.td}>
                        <Badge type={o.estado}>{o.estado}</Badge>
                      </td>

                      {/* Turnos hoy */}
                      <td style={S.td}>
                        {op === null ? (
                          <span style={{ fontSize:12, color:'#374151' }}>Sin turnos</span>
                        ) : (
                          <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                            <Badge type="programado">{op.total} turnos</Badge>
                            <Badge type="cubierto">{op.cubiertos} cubiertos</Badge>
                            {op.sinCubrir > 0 && <Badge type="descubierto">{op.sinCubrir} sin cubrir</Badge>}
                          </div>
                        )}
                      </td>

                      {/* Acciones */}
                      <td style={S.td}>
                        <div style={{ display:'flex', gap:6 }}>
                          <button
                            style={{ ...S.btn, ...S.btnSecondary, padding:'6px 12px', fontSize:12 }}
                            onClick={() => abrirEditar(o)}
                          >
                            ✏ Editar
                          </button>
                          <button
                            style={{
                              ...S.btn,
                              padding:'6px 12px',
                              fontSize:12,
                              background: o.estado === 'activo' ? 'rgba(239,68,68,.1)' : 'rgba(16,185,129,.1)',
                              color: o.estado === 'activo' ? '#ef4444' : '#10b981',
                              border: `1px solid ${o.estado === 'activo' ? 'rgba(239,68,68,.3)' : 'rgba(16,185,129,.3)'}`,
                            }}
                            onClick={() => toggleEstado(o)}
                          >
                            {o.estado === 'activo' ? '⏸ Dar de baja' : '▶ Reactivar'}
                          </button>
                          <button
                            style={{ ...S.btn, padding:'6px 12px', fontSize:12, background:'rgba(239,68,68,.1)', color:'#ef4444', border:'1px solid rgba(239,68,68,.3)' }}
                            onClick={() => abrirConfirmarBorrado(o)}
                          >
                            🗑 Borrar definitivamente
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal crear/editar */}
      {modal && (
        <Modal
          title={editId ? 'Editar Objetivo' : 'Nuevo Objetivo'}
          onClose={() => { setModal(false); setEditId(null); setForm(formVacio) }}
          footer={
            <>
              <button
                style={{ ...S.btn, ...S.btnSecondary }}
                onClick={() => { setModal(false); setEditId(null); setForm(formVacio) }}
              >
                Cancelar
              </button>
              <button
                style={{ ...S.btn, ...S.btnPrimary }}
                onClick={guardar}
                disabled={loading || !form.nombre.trim()}
              >
                {loading ? 'Guardando...' : editId ? 'Guardar cambios' : 'Crear objetivo'}
              </button>
            </>
          }
        >
          {/* Nombre */}
          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Nombre *</label>
            <input
              style={S.input}
              placeholder="Ej: Banco Nación Rosario"
              value={form.nombre}
              onChange={e => setForm({ ...form, nombre:e.target.value })}
            />
          </div>

          {/* Cliente */}
          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Cliente</label>
            <input
              style={S.input}
              placeholder="Ej: Banco de la Nación Argentina"
              value={form.cliente}
              onChange={e => setForm({ ...form, cliente:e.target.value })}
            />
          </div>

          {/* Dirección */}
          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Dirección</label>
            <input
              style={S.input}
              placeholder="Ej: Córdoba 1234, Rosario"
              value={form.direccion}
              onChange={e => setForm({ ...form, direccion:e.target.value })}
            />
          </div>

          {/* Radio y estado en grid */}
          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Radio GPS (metros)</label>
              <input
                style={S.input}
                type="number"
                min={50}
                max={2000}
                placeholder="200"
                value={form.radio_metros}
                onChange={e => setForm({ ...form, radio_metros: Number(e.target.value) })}
              />
            </div>

            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Estado</label>
              <select
                style={S.select}
                value={form.estado}
                onChange={e => setForm({ ...form, estado:e.target.value })}
              >
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </div>
          </div>

          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Checklist de supervisión</label>
              <select
                style={S.select}
                value={form.checklist_plantilla_id}
                onChange={e => setForm({ ...form, checklist_plantilla_id:e.target.value })}
              >
                <option value="">Sin checklist</option>
                {checklistPlantillas.map((plantilla: ChecklistPlantillaAdmin) => (
                  <option key={plantilla.id} value={plantilla.id}>{plantilla.nombre}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Frecuencia supervisión (horas)</label>
              <input
                style={S.input}
                type="number"
                min={1}
                max={720}
                value={form.frecuencia_supervision_horas}
                onChange={e => setForm({ ...form, frecuencia_supervision_horas:Number(e.target.value) })}
              />
            </div>

            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Zona operativa</label>
              <select
                style={S.select}
                value={form.zona_id}
                onChange={e => setForm({ ...form, zona_id:e.target.value })}
              >
                <option value="">Sin zona</option>
                {zonasOperativas.map((z: any) => (
                  <option key={z.id} value={z.id}>{z.nombre}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Puesto móvil. Estaba sólo en Página GPS, donde nadie lo encontraba
              y donde además se lee como un detalle de mapa. Acá queda junto al
              resto de lo que define el servicio, que es lo que realmente es:
              cambia qué evidencia se le exige al vigilador. */}
          <div style={{ marginBottom:16 }}>
            <label style={{ ...S.label, display:'flex', alignItems:'flex-start', gap:10, cursor:'pointer' }}>
              <input
                type="checkbox"
                checked={form.tipo_ubicacion === 'movil'}
                onChange={e => setForm({ ...form, tipo_ubicacion: e.target.checked ? 'movil' : 'fijo' })}
                style={{ marginTop:2, width:16, height:16, cursor:'pointer', flexShrink:0 }}
              />
              <span>
                Servicio móvil o eventual (sin garita fija)
                <span style={{ display:'block', fontWeight:400, fontSize:12, opacity:.7, marginTop:4, lineHeight:1.5 }}>
                  Máquinas que se trasladan a diario, o servicios de pocos días que cambian de
                  dirección. Al no haber garita no hay libro de actas: la IA deja de pedirlo y
                  esos ingresos dejan de figurar como incompletos. Además, los fichajes lejos de
                  la coordenada cargada dejan de leerse como error de ubicación, porque en estos
                  servicios la ubicación cambia de verdad.
                </span>
              </span>
            </label>
          </div>
        </Modal>
      )}

      {confirmarBorrado && (
        <Modal title="Borrar objetivo definitivamente" onClose={() => { setConfirmarBorrado(null); setBloqueoBorrado(null) }}>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontWeight:800, marginBottom:8 }}>{confirmarBorrado.nombre}</div>
            {verificandoBorrado ? (
              <div style={{ color:'#64748b' }}>Verificando historial relacionado...</div>
            ) : bloqueoBorrado ? (
              <div style={{ color:'#f87171', background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.3)', borderRadius:8, padding:12 }}>
                {bloqueoBorrado}
              </div>
            ) : (
              <div style={{ color:'#10b981' }}>
                Este objetivo no tiene historial ni rondas configuradas. Se puede borrar definitivamente. Esta acción no se puede deshacer.
              </div>
            )}
          </div>
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
            <button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => { setConfirmarBorrado(null); setBloqueoBorrado(null) }}>
              Cancelar
            </button>
            <button
              style={{ ...S.btn, background:'#ef4444', color:'#fff' }}
              onClick={confirmarBorradoFisico}
              disabled={verificandoBorrado || Boolean(bloqueoBorrado) || borrando}
            >
              {borrando ? 'Borrando...' : 'Borrar definitivamente'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
function Turnos({ turnos, setTurnos, guardias, objetivos, registros, filtroActivo, limpiarFiltro, user }: any) {
  // Un turno en un objetivo pausado no ocupa al vigilador: se conserva pero no
  // bloquea asignarlo en un objetivo activo. Mismo criterio que la RPC.
  const objetivosPausados = idsObjetivosPausados(objetivos)
  // Refresca al entrar a la pantalla: el estado (incluida la publicación de
  // programación, hecha desde el legajo del objetivo) puede haber cambiado
  // desde que se cargaron los datos globales al iniciar sesión. Sin esto no
  // se vería "sin F5" al navegar acá después de publicar.
  useEffect(() => {
    let vigente = true
    const desdeStr = `${mesActualArgentina()}-01`
    const hastaISO = inicioMesSiguienteArgISO()
    const hastaStr = hastaISO.slice(0, 10)
    void supabase.from('turnos').select('*').gte('fecha', desdeStr).lt('fecha', hastaStr).order('fecha', { ascending: false })
      .then(({ data }) => { if (vigente && data) setTurnos(data) })
    return () => { vigente = false }
  }, [])

  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({
    guardia_id: '',
    objetivo_id: '',
    puesto_id: '',
    fecha: fechaActualTurno(),
    hora_inicio: '06:00',
    hora_fin: '14:00',
    tipo_evento: 'normal',
  })
  const [filtroFecha, setFiltroFecha] = useState<FiltroFechaTurnos>('hoy')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [estadoPuestos, setEstadoPuestos] = useState<EstadoPuestos | null>(null)
  // Prevención de duplicados: vacantes programadas compatibles detectadas al
  // crear un turno manual. Advertencia con opciones, nunca bloqueo.
  const [vacantesAlta, setVacantesAlta] = useState<any[] | null>(null)
  const [equivalentesAlta, setEquivalentesAlta] = useState(0)
  const [vacanteElegida, setVacanteElegida] = useState('')
  const [asignandoVacante, setAsignandoVacante] = useState(false)

  // El objetivo elegido define si el puesto se asigna solo, hay que elegirlo o
  // no se puede crear el turno. Regla única en lib/puestos.ts.
  useEffect(() => {
    let vigente = true
    if (!form.objetivo_id) {
      setEstadoPuestos(null)
      return
    }
    void obtenerPuestosActivos(form.objetivo_id).then(({ data, error: errPuestos }) => {
      if (!vigente) return
      setEstadoPuestos(data)
      setForm(actual => (actual.puesto_id ? { ...actual, puesto_id: '' } : actual))
      if (errPuestos) setError(errPuestos)
    })
    return () => { vigente = false }
  }, [form.objetivo_id])

  const [turnoEditando, setTurnoEditando] = useState<Turno | null>(null)
  const [formEdicion, setFormEdicion] = useState({
    guardia_id: '',
    hora_inicio: '',
    hora_fin: '',
    estado: 'programado' as Turno['estado'],
    comentario: '',
  })
  const [errorEdicion, setErrorEdicion] = useState('')
  const [loadingEdicion, setLoadingEdicion] = useState(false)
  const [estadoOperativoEdicion, setEstadoOperativoEdicion] = useState<'FUTURO' | 'EN_CURSO' | 'FINALIZADO' | null>(null)
  const [cargandoEstadoEdicion, setCargandoEstadoEdicion] = useState(false)

  const abrirEdicion = async (turno: Turno) => {
    setTurnoEditando(turno)
    setFormEdicion({
      guardia_id: turno.guardia_id || '',
      hora_inicio: turno.hora_inicio,
      hora_fin: turno.hora_fin,
      estado: turno.estado,
      comentario: '',
    })
    setErrorEdicion('')
    setEstadoOperativoEdicion(null)
    setCargandoEstadoEdicion(true)
    try {
      const { data: registros } = await supabase
        .from('registros_asistencia')
        .select('id, hora_entrada_real, hora_salida_real, hora_entrada_final, tipo_registro')
        .eq('turno_id', turno.id)
      const tieneEntrada = (registros ?? []).some((r: any) => registroTieneEntradaConfirmada(r))
      const tieneSalida  = (registros ?? []).some((r: any) => r.hora_salida_real  != null)
      setEstadoOperativoEdicion(tieneSalida ? 'FINALIZADO' : tieneEntrada ? 'EN_CURSO' : 'FUTURO')
    } catch {
      setEstadoOperativoEdicion('FUTURO')
    } finally {
      setCargandoEstadoEdicion(false)
    }
  }

  const cerrarEdicion = () => {
    setTurnoEditando(null)
    setErrorEdicion('')
    setEstadoOperativoEdicion(null)
  }

  const guardarEdicion = async () => {
    if (!turnoEditando) return
    if (!user?.id) {
      setErrorEdicion('Sesión no disponible.')
      return
    }
    if (cargandoEstadoEdicion || estadoOperativoEdicion === null) {
      setErrorEdicion('Verificando estado del turno, esperá un momento.')
      return
    }
    if (estadoOperativoEdicion === 'FINALIZADO') {
      setErrorEdicion('No se pueden modificar los horarios de un turno finalizado.')
      return
    }

    setErrorEdicion('')

    const guardiaNuevoId = formEdicion.guardia_id || null

    // Verificar solapamiento solo cuando el turno es FUTURO y se cambia el guardia o los horarios
    if (estadoOperativoEdicion === 'FUTURO' && guardiaNuevoId) {
      const { data, error: turnosError } = await supabase
        .from('turnos')
        .select('id, guardia_id, fecha, hora_inicio, hora_fin, objetivo_id')
        .eq('guardia_id', guardiaNuevoId)
        .in('fecha', fechasVecinasTurno(turnoEditando.fecha))

      if (turnosError) {
        setErrorEdicion(turnosError.message)
        return
      }

      const candidato = {
        guardia_id: guardiaNuevoId,
        fecha: turnoEditando.fecha,
        hora_inicio: formEdicion.hora_inicio,
        hora_fin: formEdicion.hora_fin,
      }
      if (tieneTurnoSuperpuesto(data || [], candidato, turnoEditando.id, objetivosPausados)) {
        setErrorEdicion(MENSAJE_TURNO_SUPERPUESTO)
        return
      }
    }

    // Construir cambios según estado operativo
    const cambios: Record<string, string | null> = {}
    // Snapshot: siempre incluye todos los campos editables para detectar
    // modificaciones concurrentes aunque el usuario no haya tocado ese campo.
    const snapshot: Record<string, string | null> = {}

    if (estadoOperativoEdicion === 'FUTURO') {
      // Snapshot completo de todos los campos editables en FUTURO
      snapshot.guardia_id  = (turnoEditando as any).guardia_id   || null
      snapshot.objetivo_id = (turnoEditando as any).objetivo_id  || null
      snapshot.puesto_id   = (turnoEditando as any).puesto_id    || null
      snapshot.fecha       = (turnoEditando as any).fecha        || null
      snapshot.hora_inicio = turnoEditando.hora_inicio
      snapshot.hora_fin    = turnoEditando.hora_fin
      snapshot.estado      = turnoEditando.estado

      if ((turnoEditando.guardia_id || null) !== guardiaNuevoId) {
        cambios.guardia_id = guardiaNuevoId
      }
      if (turnoEditando.hora_inicio !== formEdicion.hora_inicio) {
        cambios.hora_inicio = formEdicion.hora_inicio
      }
      if (turnoEditando.hora_fin !== formEdicion.hora_fin) {
        cambios.hora_fin = formEdicion.hora_fin
      }
      if (turnoEditando.estado !== formEdicion.estado) {
        cambios.estado = formEdicion.estado
      }
    } else {
      // EN_CURSO: solo hora_fin y estado; snapshot solo de esos dos
      snapshot.hora_fin = turnoEditando.hora_fin
      snapshot.estado   = turnoEditando.estado

      if (turnoEditando.hora_fin !== formEdicion.hora_fin) {
        cambios.hora_fin = formEdicion.hora_fin
      }
      if (turnoEditando.estado !== formEdicion.estado) {
        cambios.estado = formEdicion.estado
      }
    }

    if (Object.keys(cambios).length === 0) {
      cerrarEdicion()
      return
    }

    setLoadingEdicion(true)

    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData?.session?.access_token
    if (!token) {
      setErrorEdicion('Sesión expirada. Volvé a iniciar sesión.')
      setLoadingEdicion(false)
      return
    }

    let json: any
    try {
      const res = await fetch('/api/turnos/editar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ turno_id: turnoEditando.id, cambios, comentario: formEdicion.comentario, snapshot }),
      })
      json = await res.json()
      if (!res.ok) {
        setErrorEdicion(json?.error || 'Error al guardar el turno.')
        setLoadingEdicion(false)
        return
      }
    } catch (err) {
      setErrorEdicion('Error de red. Verificá tu conexión y volvé a intentar.')
      setLoadingEdicion(false)
      return
    }

    const turnoActualizado = json.turno ?? {}
    setTurnos((prev: Turno[]) => prev.map(t => t.id === turnoEditando.id ? { ...t, ...turnoActualizado } as Turno : t))
    setMensaje('✓ Turno actualizado correctamente')
    setLoadingEdicion(false)
    cerrarEdicion()
  }

  const guardiaTieneTurnoSuperpuesto = async (candidato: Pick<Turno, 'guardia_id' | 'fecha' | 'hora_inicio' | 'hora_fin'>): Promise<boolean | null> => {
    if (!candidato.guardia_id) return false

    const { data, error: turnosError } = await supabase
      .from('turnos')
      .select('id, guardia_id, fecha, hora_inicio, hora_fin, objetivo_id')
      .eq('guardia_id', candidato.guardia_id)
      .in('fecha', fechasVecinasTurno(candidato.fecha))

    if (turnosError) {
      setError(turnosError.message)
      return null
    }

    return tieneTurnoSuperpuesto(data || [], candidato, null, objetivosPausados)
  }

  // Asignar el guardia del formulario sobre una vacante ya programada, por el
  // flujo auditado (/api/turnos/editar), en lugar de crear un turno duplicado.
  const asignarSobreVacante = async () => {
    if (!vacanteElegida || !form.guardia_id || asignandoVacante) return
    setAsignandoVacante(true)
    setError('')
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData?.session?.access_token
    if (!token) { setError('Sesión expirada. Volvé a iniciar sesión.'); setAsignandoVacante(false); return }
    try {
      const res = await fetch('/api/turnos/editar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          turno_id: vacanteElegida,
          cambios: { guardia_id: form.guardia_id, estado: 'programado' },
          comentario: 'Asignación sobre vacante programada desde el alta manual',
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json?.error || 'No se pudo asignar sobre la vacante.'); setAsignandoVacante(false); return }
    } catch {
      setError('Error de red. Verificá tu conexión y volvé a intentar.')
      setAsignandoVacante(false)
      return
    }
    const { data: turnosActualizados } = await supabase
      .from('turnos').select('*')
      .order('fecha', { ascending: false }).order('hora_inicio', { ascending: true })
    if (turnosActualizados) setTurnos(turnosActualizados)
    setMensaje('✓ Vigilador asignado sobre la vacante programada')
    setAsignandoVacante(false)
    setVacantesAlta(null)
    setModal(false)
    setForm({ guardia_id: '', objetivo_id: '', fecha: fechaActualTurno(), hora_inicio: '06:00', hora_fin: '14:00', tipo_evento: 'normal' })
  }

  const guardar = async (omitirAvisoVacantes = false) => {
    if (!form.objetivo_id || !form.fecha || !form.hora_inicio || !form.hora_fin) return

    setError('')
    setMensaje('')

    const puesto = resolverPuestoTurno(estadoPuestos, form.puesto_id)
    if (!puesto.ok) {
      setError(puesto.error)
      return
    }

    // Antes de crear: si el objetivo ya tiene una posición programada SIN
    // vigilador que se superpone con este horario, ofrecer asignar sobre esa
    // vacante en lugar de duplicar la cobertura. Advertencia, nunca bloqueo:
    // "Crear de todos modos" sigue disponible (pueden ser posiciones
    // simultáneas legítimas).
    if (!omitirAvisoVacantes) {
      const { data: delObjetivo } = await supabase
        .from('turnos')
        .select('id, objetivo_id, puesto_id, guardia_id, fecha, hora_inicio, hora_fin, estado, tipo_evento')
        .eq('objetivo_id', form.objetivo_id)
        .in('fecha', fechasVecinasTurno(form.fecha))
      const candidatoAlta = { objetivo_id: form.objetivo_id, puesto_id: puesto.puesto_id, fecha: form.fecha, hora_inicio: form.hora_inicio, hora_fin: form.hora_fin }
      const vacantes = vacantesCompatibles(delObjetivo ?? [], candidatoAlta)
      if (vacantes.length > 0) {
        setVacantesAlta(vacantes)
        setEquivalentesAlta(coberturaEquivalenteOtraPosicion(delObjetivo ?? [], candidatoAlta).length)
        setVacanteElegida(vacantes[0].id)
        return
      }
    }

    const { puesto_id: _descartado, ...camposForm } = form
    const payload = {
      ...camposForm,
      puesto_id: puesto.puesto_id,
      guardia_id: form.guardia_id || null,
      estado: form.guardia_id ? 'programado' : 'descubierto',
      tipo_evento: caracteristicaTurno(form.tipo_evento),
      estado_revision: 'aprobado',
    }

    const conflicto = payload.guardia_id ? await guardiaTieneTurnoSuperpuesto(payload) : false
    if (conflicto === null) return
    if (conflicto) {
      setError(MENSAJE_TURNO_SUPERPUESTO)
      return
    }

    setLoading(true)

    const { data, error } = await supabase
      .from('turnos')
      .insert(payload)
      .select()
      .single()

    if (!error && data) {
      const filtroDestino = filtroFechaTurnosIncluye(filtroFecha, payload.fecha)
        ? filtroFecha
        : filtroFechaTurnosParaFecha(payload.fecha)
      const { data: turnosActualizados, error: refreshError } = await supabase
        .from('turnos')
        .select('*')
        .order('fecha', { ascending: false })
        .order('hora_inicio', { ascending: true })

      if (turnosActualizados) setTurnos(turnosActualizados)
      if (refreshError) setError(`Turno creado, pero no se pudo refrescar la lista: ${refreshError.message}`)

      setFiltroFecha(filtroDestino)
      setMensaje('✓ Turno creado correctamente')
      setVacantesAlta(null)
      setModal(false)
      setForm({
        guardia_id: '',
        objetivo_id: '',
        fecha: fechaActualTurno(),
        hora_inicio: '06:00',
        hora_fin: '14:00',
        tipo_evento: 'normal',
      })
    } else if (error) {
      setError(error.message)
    }

    setLoading(false)
  }

  const hoy = fechaHoyArgentina()
  const idsFiltroTurnos = new Set((filtroActivo?.ids ?? []) as string[])
  const rangoFecha = filtroActivo
    ? { desde: filtroActivo.desde || hoy, hasta: filtroActivo.hasta || hoy, label: filtroActivo.label }
    : rangoFiltroFechaTurnos(filtroFecha, hoy)
  const tieneEntradaConfirmadaTurnos = (turno: Turno) =>
    registros.some((r: RegistroAsistencia) => r.turno_id === turno.id && registroTieneEntradaConfirmada(r))
  const tieneSalida = (turno: Turno) => registros.some((r: RegistroAsistencia) => r.turno_id === turno.id && r.hora_salida_real)
  const filtrados = turnos.filter((t: Turno) => {
    if (idsFiltroTurnos.size > 0) return idsFiltroTurnos.has(t.id)
    if (t.fecha < rangoFecha.desde || t.fecha > rangoFecha.hasta) return false
    if (filtroActivo?.tipo === 'descubiertos' && !turnoSinCoberturaOperativa(t)) return false
    if (filtroActivo?.tipo === 'sin_fichar' && (!t.guardia_id || tieneEntradaConfirmadaTurnos(t))) return false
    if (filtroActivo?.tipo === 'pendientes_asistencia' && (!t.guardia_id || (tieneEntradaConfirmadaTurnos(t) && tieneSalida(t)))) return false
    return true
  })

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:24 }}>
        <div style={{ flex:1 }}>
          <div style={S.title}>Turnos</div>
          <div style={S.sub2}>Asignación de guardias a objetivos</div>
        </div>

        <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'flex-end' }}>
          {FILTROS_FECHA_TURNOS.map(filtro => {
            const activo = !filtroActivo && filtroFecha === filtro.id

            return (
              <button
                key={filtro.id}
                type="button"
                disabled={Boolean(filtroActivo)}
                onClick={() => {
                  setFiltroFecha(filtro.id)
                  setMensaje('')
                }}
                style={{
                  ...S.btn,
                  ...(activo ? S.btnPrimary : S.btnSecondary),
                  padding:'8px 12px',
                  opacity: filtroActivo ? 0.55 : 1,
                }}
              >
                {filtro.label}
              </button>
            )
          })}
        </div>

        <button
          style={{ ...S.btn, ...S.btnPrimary }}
          onClick={() => { setError(''); setMensaje(''); setModal(true) }}
        >
          + Nuevo Turno
        </button>
      </div>

      {filtroActivo && (
        <div style={{ ...S.card, padding:12, display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ color:'#f59e0b' }}>Filtro activo: {filtroActivo.label}</span>
          <button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 10px', fontSize:12 }} onClick={limpiarFiltro}>Limpiar filtro</button>
        </div>
      )}

      {mensaje && (
        <div style={{ ...S.card, padding:12, color:'#10b981', borderColor:'rgba(16,185,129,.35)' }}>
          {mensaje}
        </div>
      )}

      {error && (
        <div style={{ ...S.card, padding:12, color:'#f59e0b', borderColor:'rgba(245,158,11,.35)' }}>
          {error}
        </div>
      )}

      <div style={S.card}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Fecha</th>
              <th style={S.th}>Objetivo</th>
              <th style={S.th}>Horario</th>
              <th style={S.th}>Guardia</th>
              <th style={S.th}>Estado</th>
              <th style={S.th}></th>
            </tr>
          </thead>

          <tbody>
            {filtrados.map((t: Turno) => {
              const g = guardias.find((x: Usuario) => x.id === t.guardia_id)
              const o = objetivos.find((x: Objetivo) => x.id === t.objetivo_id)

              return (
                <tr key={t.id}>
                  <td style={S.td}>{formatFecha(t.fecha)}</td>

                  <td style={S.td}>
                    <strong>{o?.nombre}</strong>
                    <br />
                    <span style={{ fontSize:11, color:'#64748b' }}>
                      {o?.cliente}
                    </span>
                  </td>

                  <td style={S.td}>
                    <span style={{ fontFamily:'Syne,sans-serif', fontWeight:600 }}>
                      {formatHorarioAsignado(t)}
                    </span>
                  </td>

                  <td style={S.td}>
                    {g ? `${g.apellido}, ${g.nombre}` : (
                      <span style={{ color:'#ef4444' }}>Sin asignar</span>
                    )}
                  </td>

                  <td style={S.td}>
                    <Badge type={t.estado}>{t.estado}</Badge>
                  </td>

                  <td style={S.td}>
                    <button
                      style={{ ...S.btn, ...S.btnSecondary, padding:'6px 10px', fontSize:12 }}
                      onClick={() => abrirEdicion(t)}
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {filtrados.length === 0 && (
          <div style={{ textAlign:'center', padding:48, color:'#64748b' }}>
            📅 No hay turnos para este filtro
          </div>
        )}
      </div>

      {modal && (
        <Modal
          title="Nuevo Turno"
          onClose={() => { setModal(false); setVacantesAlta(null) }}
          footer={
            <>
              <button
                style={{ ...S.btn, ...S.btnSecondary }}
                onClick={() => { setModal(false); setVacantesAlta(null) }}
              >
                Cancelar
              </button>

              <button
                style={{ ...S.btn, ...S.btnPrimary }}
                onClick={() => guardar()}
                disabled={loading || estadoPuestos?.caso === 'sin_puestos' || Boolean(vacantesAlta?.length)}
              >
                {loading ? 'Creando...' : 'Crear turno'}
              </button>
            </>
          }
        >
          {error && (
            <div style={{ marginBottom:16, padding:12, borderRadius:8, background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.3)', color:'#f59e0b', fontSize:13 }}>
              {error}
            </div>
          )}

          {vacantesAlta && vacantesAlta.length > 0 && (
            <div style={{ marginBottom:16, padding:12, borderRadius:8, background:'rgba(96,165,250,.08)', border:'1px solid rgba(96,165,250,.35)' }}>
              <div style={{ color:'#60a5fa', fontSize:13, fontWeight:700, marginBottom:6 }}>{MENSAJE_VACANTE_COMPATIBLE}</div>
              {vacantesAlta.length > 1 ? (
                <select style={{ ...S.select, marginBottom:8 }} value={vacanteElegida} onChange={e => setVacanteElegida(e.target.value)}>
                  {vacantesAlta.map((v: any) => (
                    <option key={v.id} value={v.id}>{v.fecha} · {String(v.hora_inicio).slice(0,5)}–{String(v.hora_fin).slice(0,5)}</option>
                  ))}
                </select>
              ) : (
                <div style={{ fontSize:12, color:'#e2e8f0', marginBottom:8 }}>
                  Vacante: {vacantesAlta[0].fecha} · {String(vacantesAlta[0].hora_inicio).slice(0,5)}–{String(vacantesAlta[0].hora_fin).slice(0,5)}
                </div>
              )}
              {equivalentesAlta > 0 && (
                <div style={{ fontSize:11, color:'#94a3b8', marginBottom:8 }}>{DETALLE_COBERTURA_EQUIVALENTE}: {equivalentesAlta} turno(s) del mismo horario en otra posición.</div>
              )}
              {!form.guardia_id && (
                <div style={{ fontSize:11, color:'#f59e0b', marginBottom:8 }}>Para asignar sobre la vacante, elegí primero el guardia.</div>
              )}
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                <button style={{ ...S.btn, ...S.btnPrimary, padding:'6px 12px', fontSize:12, opacity: !form.guardia_id || asignandoVacante ? 0.5 : 1 }} disabled={!form.guardia_id || asignandoVacante} onClick={asignarSobreVacante}>
                  {asignandoVacante ? 'Asignando…' : 'Asignar sobre turno existente'}
                </button>
                <button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 12px', fontSize:12 }} onClick={() => { setVacantesAlta(null); void guardar(true) }}>
                  Crear de todos modos
                </button>
                <button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 12px', fontSize:12 }} onClick={() => setVacantesAlta(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Objetivo</label>
            <select
              style={S.select}
              value={form.objetivo_id}
              onChange={e => setForm({ ...form, objetivo_id:e.target.value })}
            >
              <option value="">Seleccionar...</option>
              {objetivos.map((o: Objetivo) => (
                <option key={o.id} value={o.id}>
                  {o.nombre}
                </option>
              ))}
            </select>
          </div>

          {/* Puesto: sólo se pide cuando hay más de uno. Con uno solo se asigna
              automáticamente y con ninguno se bloquea el alta. */}
          {estadoPuestos?.caso === 'multiple' && (
            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Posición operativa</label>
              <select
                style={S.select}
                value={form.puesto_id}
                onChange={e => setForm({ ...form, puesto_id:e.target.value })}
              >
                <option value="">Seleccionar...</option>
                {estadoPuestos.puestos.map(p => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </select>
            </div>
          )}

          {estadoPuestos?.caso === 'sin_puestos' && (
            <div style={{ marginBottom:16, padding:12, borderRadius:8, background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.3)', color:'#fca5a5', fontSize:13 }}>
              {MENSAJE_SIN_PUESTOS_ACTIVOS}
            </div>
          )}

          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Guardia</label>
            <select
              style={S.select}
              value={form.guardia_id}
              onChange={e => setForm({ ...form, guardia_id:e.target.value })}
            >
              <option value="">Sin asignar</option>
              {guardias
                .filter((g: Usuario) => g.estado === 'activo')
                .map((g: Usuario) => (
                  <option key={g.id} value={g.id}>
                    {g.apellido}, {g.nombre}
                  </option>
                ))}
            </select>
          </div>

          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Fecha</label>
              <input
                type="date"
                style={S.input}
                value={form.fecha}
                onChange={e => setForm({ ...form, fecha:e.target.value })}
              />
            </div>

            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Hora inicio</label>
              <input
                type="time"
                style={S.input}
                value={form.hora_inicio}
                onChange={e => setForm({ ...form, hora_inicio:e.target.value })}
              />
            </div>

            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Hora fin</label>
              <input
                type="time"
                style={S.input}
                value={form.hora_fin}
                onChange={e => setForm({ ...form, hora_fin:e.target.value })}
              />
            </div>

            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Característica</label>
              <select
                style={S.select}
                value={form.tipo_evento}
                onChange={e => setForm({ ...form, tipo_evento:e.target.value })}
              >
                {CARACTERISTICAS_TURNO.map(c => <option key={c} value={c}>{ETIQUETA_CARACTERISTICA[c]}</option>)}
              </select>
            </div>
          </div>
        </Modal>
      )}

      {turnoEditando && (
        <Modal
          title="Editar Turno"
          onClose={cerrarEdicion}
          footer={
            <>
              <button
                style={{ ...S.btn, ...S.btnSecondary }}
                onClick={cerrarEdicion}
              >
                Cancelar
              </button>

              <button
                style={{ ...S.btn, ...S.btnPrimary }}
                onClick={guardarEdicion}
                disabled={loadingEdicion || cargandoEstadoEdicion || estadoOperativoEdicion === 'FINALIZADO'}
              >
                {loadingEdicion ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </>
          }
        >
          {/* Banner de estado operativo */}
          {cargandoEstadoEdicion && (
            <div style={{ marginBottom:12, padding:10, borderRadius:8, background:'rgba(100,116,139,.08)', border:'1px solid rgba(100,116,139,.2)', color:'#64748b', fontSize:13 }}>
              Verificando estado del turno…
            </div>
          )}
          {!cargandoEstadoEdicion && estadoOperativoEdicion === 'EN_CURSO' && (
            <div style={{ marginBottom:12, padding:10, borderRadius:8, background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.3)', color:'#b45309', fontSize:13 }}>
              <strong>Turno en curso</strong> — La guardia ya fichó su ingreso. Solo se puede modificar la hora de fin y el estado. El registro de asistencia no se altera.
            </div>
          )}
          {!cargandoEstadoEdicion && estadoOperativoEdicion === 'FINALIZADO' && (
            <div style={{ marginBottom:12, padding:10, borderRadius:8, background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.3)', color:'#b91c1c', fontSize:13 }}>
              <strong>Turno finalizado</strong> — No se pueden modificar los horarios. Para corregir datos reales usá "Corregir registro".
            </div>
          )}

          {errorEdicion && (
            <div style={{ marginBottom:16, padding:12, borderRadius:8, background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.3)', color:'#f59e0b', fontSize:13 }}>
              {errorEdicion}
            </div>
          )}

          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Guardia</label>
            <select
              style={{ ...S.select, ...(estadoOperativoEdicion !== 'FUTURO' ? { opacity:0.5, pointerEvents:'none' } : {}) }}
              value={formEdicion.guardia_id}
              onChange={e => setFormEdicion({ ...formEdicion, guardia_id:e.target.value })}
              disabled={estadoOperativoEdicion !== 'FUTURO'}
            >
              <option value="">Sin asignar</option>
              {guardias
                .filter((g: Usuario) => g.estado === 'activo')
                .map((g: Usuario) => (
                  <option key={g.id} value={g.id}>
                    {g.apellido}, {g.nombre}
                  </option>
                ))}
            </select>
          </div>

          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Hora inicio</label>
              <input
                type="time"
                style={{ ...S.input, ...(estadoOperativoEdicion !== 'FUTURO' ? { opacity:0.5, pointerEvents:'none' } : {}) }}
                value={formEdicion.hora_inicio}
                onChange={e => setFormEdicion({ ...formEdicion, hora_inicio:e.target.value })}
                disabled={estadoOperativoEdicion !== 'FUTURO'}
              />
            </div>

            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Hora fin</label>
              <input
                type="time"
                style={{ ...S.input, ...(estadoOperativoEdicion === 'FINALIZADO' ? { opacity:0.5, pointerEvents:'none' } : {}) }}
                value={formEdicion.hora_fin}
                onChange={e => setFormEdicion({ ...formEdicion, hora_fin:e.target.value })}
                disabled={estadoOperativoEdicion === 'FINALIZADO'}
              />
            </div>
          </div>

          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Estado</label>
            <select
              style={{ ...S.select, ...(estadoOperativoEdicion === 'FINALIZADO' ? { opacity:0.5, pointerEvents:'none' } : {}) }}
              value={formEdicion.estado}
              onChange={e => setFormEdicion({ ...formEdicion, estado:e.target.value as Turno['estado'] })}
              disabled={estadoOperativoEdicion === 'FINALIZADO'}
            >
              <option value="programado">Programado</option>
              <option value="cubierto">Cubierto</option>
              <option value="descubierto">Descubierto</option>
            </select>
          </div>

          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Comentario (opcional)</label>
            <textarea
              style={{ ...S.input, minHeight:80, resize:'vertical' }}
              value={formEdicion.comentario}
              onChange={e => setFormEdicion({ ...formEdicion, comentario:e.target.value })}
            />
          </div>
        </Modal>
      )}
    </div>
  )
}
const MOTIVOS_CARGA_MANUAL = [
  'Sin internet',
  'Celular roto',
  'Olvido de fichaje',
  'Cambio de guardia',
  'Error operativo',
  'Otro',
]

function CargarAsistenciaManualModal({ turno, onClose, guardias, user, setRegistros, setTurnos }: any) {
  const [form, setForm] = useState({
    guardia_id: turno?.guardia_id || '',
    hora_entrada: '',
    hora_salida: '',
    motivo: '',
    observacion: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (!turno) return null

  const empleados = (guardias || []).filter((g: Usuario) => g.rol !== 'admin')

  const guardar = async () => {
    if (!form.guardia_id) { setError('Seleccioná un guardia.'); return }
    if (!form.hora_entrada) { setError('La hora de entrada es obligatoria.'); return }
    if (!form.hora_salida) { setError('La hora de salida es obligatoria.'); return }
    if (!form.motivo) { setError('El motivo es obligatorio.'); return }
    setError(null)
    setLoading(true)
    try {
      const origenCobertura = user?.rol === 'admin' ? 'carga_admin' : 'carga_supervisor'
      const comentario = [form.motivo, form.observacion].filter(Boolean).join(' — ') || null
      const { data: registroId, error: rpcError } = await supabase.rpc('registrar_cobertura', {
        p_turno_id:          turno.id,
        p_guardia_id:        form.guardia_id,
        p_origen:            origenCobertura,
        p_hora_entrada:      form.hora_entrada || null,
        p_hora_salida:       form.hora_salida  || null,
        p_horas_liquidables: null,
        p_comentario:        comentario,
      })
      if (rpcError) { setError(rpcError.message); setLoading(false); return }

      // Fetch del registro completo para actualizar el estado local
      const { data: registro } = await supabase
        .from('registros_asistencia')
        .select('*')
        .eq('id', registroId)
        .single()
      if (registro) setRegistros((prev: RegistroAsistencia[]) => [...prev, registro as RegistroAsistencia])
      setTurnos((prev: Turno[]) => prev.map(t => t.id === turno.id ? { ...t, estado: 'cubierto' } as Turno : t))
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Error inesperado.')
    }
    setLoading(false)
  }

  return (
    <Modal title="Cargar asistencia manual" onClose={onClose}>
      <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
        <div style={{ background:'#1e2d42', border:'1px solid #f59e0b44', borderRadius:8, padding:'10px 14px', fontSize:12, color:'#f59e0b' }}>
          Este registro se marcará como <strong>carga manual</strong>. No simula un fichaje GPS. Quedará auditado con motivo y responsable.
        </div>

        <div>
          <label style={S.label}>Guardia <span style={{ color:'#ef4444' }}>*</span></label>
          <select style={S.select} value={form.guardia_id} onChange={e => setForm(f => ({ ...f, guardia_id: e.target.value }))}>
            <option value="">— Seleccioná guardia —</option>
            {empleados.map((g: Usuario) => (
              <option key={g.id} value={g.id}>{g.apellido}, {g.nombre} · {g.legajo || 'sin legajo'}</option>
            ))}
          </select>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div>
            <label style={S.label}>Hora entrada <span style={{ color:'#ef4444' }}>*</span></label>
            <input type="time" style={S.input} value={form.hora_entrada} onChange={e => setForm(f => ({ ...f, hora_entrada: e.target.value }))} />
          </div>
          <div>
            <label style={S.label}>Hora salida <span style={{ color:'#ef4444' }}>*</span></label>
            <input type="time" style={S.input} value={form.hora_salida} onChange={e => setForm(f => ({ ...f, hora_salida: e.target.value }))} />
          </div>
        </div>

        {form.hora_entrada && form.hora_salida && (
          <div style={{ fontSize:13, color:'#94a3b8' }}>
            Horas a liquidar: <strong style={{ color:'#10b981' }}>{calcHorasTrabajadas(form.hora_entrada, form.hora_salida).toFixed(2)} hs</strong>
          </div>
        )}

        <div>
          <label style={S.label}>Motivo <span style={{ color:'#ef4444' }}>*</span></label>
          <select style={S.select} value={form.motivo} onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))}>
            <option value="">— Seleccioná motivo —</option>
            {MOTIVOS_CARGA_MANUAL.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div>
          <label style={S.label}>Observación</label>
          <textarea
            style={{ ...S.input, minHeight:64, resize:'vertical' as const }}
            value={form.observacion}
            onChange={e => setForm(f => ({ ...f, observacion: e.target.value }))}
            placeholder="Detalles adicionales (opcional)"
          />
        </div>

        {error && <div style={{ color:'#ef4444', fontSize:13 }}>{error}</div>}

        <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button style={{ ...S.btn, ...S.btnSecondary }} onClick={onClose} disabled={loading}>Cancelar</button>
          <button style={{ ...S.btn, ...S.btnPrimary }} onClick={guardar} disabled={loading}>
            {loading ? 'Guardando...' : 'Guardar carga manual'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function AgregarRegistroReporteModal({ onClose, guardias, objetivos, turnos, user, setRegistros, setTurnos, contextoEmpleadoId, contextoObjetivoId }: any) {
  const empleados = (guardias || []).filter((g: Usuario) => g.rol !== 'admin')
  const hoy = new Date().toLocaleDateString('sv-SE')
  // Origen de auditoría según el contexto desde el que se abrió el modal
  const origenAuditoria = contextoEmpleadoId ? 'reporte_empleado' : 'reporte_objetivo'

  const [form, setForm] = useState({
    fecha: hoy,
    objetivo_id: contextoObjetivoId || (objetivos[0]?.id || ''),
    guardia_id: contextoEmpleadoId || (empleados[0]?.id || ''),
    hora_inicio: '',
    hora_fin: '',
    hora_entrada: '',
    hora_salida: '',
    comentario: '',
  })
  const [advertenciaDuplicado, setAdvertenciaDuplicado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const set = (k: string, v: string) => {
    setForm(f => ({ ...f, [k]: v }))
    setAdvertenciaDuplicado(false)
  }

  const ejecutarGuardado = async () => {
    setError(null)
    setLoading(true)
    try {
      // 0. Resolver el puesto antes de crear nada. Si el objetivo no tiene
      //    puestos activos, el turno no puede crearse. Ver lib/puestos.ts.
      const { data: puestosObjetivo, error: errPuestos } = await obtenerPuestosActivos(form.objetivo_id)
      if (errPuestos) { setError(errPuestos); setLoading(false); return }
      const puesto = resolverPuestoTurno(puestosObjetivo, null)
      if (!puesto.ok && puestosObjetivo?.caso === 'sin_puestos') {
        setError(puesto.error); setLoading(false); return
      }

      // 1. Buscar turno existente
      const { data: turnosExistentes } = await supabase
        .from('turnos')
        .select('id')
        .eq('fecha', form.fecha)
        .eq('objetivo_id', form.objetivo_id)
        .eq('guardia_id', form.guardia_id)
        .eq('hora_inicio', form.hora_inicio)
        .eq('hora_fin', form.hora_fin)

      // 2. Obtener o crear turno
      let turnoId: string
      if (turnosExistentes && turnosExistentes.length > 0) {
        turnoId = turnosExistentes[0].id
      } else {
        const { data: nuevoTurno, error: turnoErr } = await supabase
          .from('turnos')
          .insert({
            fecha: form.fecha,
            objetivo_id: form.objetivo_id,
            puesto_id: puesto.ok ? puesto.puesto_id : null,
            guardia_id: form.guardia_id,
            hora_inicio: form.hora_inicio,
            hora_fin: form.hora_fin,
            estado: 'programado',
            origen: 'reporte',
          })
          .select()
          .single()
        if (turnoErr || !nuevoTurno) { setError(turnoErr?.message || 'Error al crear turno.'); setLoading(false); return }
        turnoId = nuevoTurno.id
        setTurnos((prev: Turno[]) => [...prev, nuevoTurno])

        const usuarioActual = user?.id
          ? user
          : (await supabase.from('usuarios').select('id').eq('auth_user_id', (await supabase.auth.getUser()).data.user?.id || '').single()).data
        if (usuarioActual?.id) {
          await supabase.from('turnos_auditoria').insert({
            turno_id: turnoId,
            modificado_por: usuarioActual.id,
            campo: 'creacion',
            valor_anterior: null,
            valor_nuevo: `reporte/${origenAuditoria}`,
            motivo: `Creado desde Reportes (${origenAuditoria}) — ${form.comentario || 'sin comentario'}`,
          })
        }
      }

      // 3. Crear registro de asistencia via RPC transaccional
      const origenCobertura = user?.rol === 'admin' ? 'carga_admin' : 'carga_supervisor'
      const { data: registroId, error: rpcError } = await supabase.rpc('registrar_cobertura', {
        p_turno_id:          turnoId,
        p_guardia_id:        form.guardia_id,
        p_origen:            origenCobertura,
        p_hora_entrada:      form.hora_entrada || null,
        p_hora_salida:       form.hora_salida  || null,
        p_horas_liquidables: null,
        p_comentario:        form.comentario || `Registro desde ${origenAuditoria}`,
      })
      if (rpcError) { setError(rpcError.message); setLoading(false); return }

      const { data: registro } = await supabase
        .from('registros_asistencia')
        .select('*')
        .eq('id', registroId)
        .single()
      if (registro) setRegistros((prev: RegistroAsistencia[]) => [...prev, registro as RegistroAsistencia])
      setTurnos((prev: Turno[]) => prev.map(t => t.id === turnoId ? { ...t, estado: 'cubierto' } as Turno : t))
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Error inesperado.')
    }
    setLoading(false)
  }

  const guardar = async () => {
    if (!form.fecha || !form.objetivo_id || !form.guardia_id || !form.hora_inicio || !form.hora_fin) {
      setError('Completá fecha, objetivo, guardia y horario.'); return
    }
    if (!form.hora_entrada) { setError('La hora de entrada es obligatoria.'); return }
    if (!form.hora_salida) { setError('La hora de salida es obligatoria.'); return }
    setError(null)
    setLoading(true)

    // Verificar duplicado antes de guardar
    const { data: turnosExistentes } = await supabase
      .from('turnos')
      .select('id')
      .eq('fecha', form.fecha)
      .eq('objetivo_id', form.objetivo_id)
      .eq('guardia_id', form.guardia_id)
      .eq('hora_inicio', form.hora_inicio)
      .eq('hora_fin', form.hora_fin)
    setLoading(false)

    if (turnosExistentes && turnosExistentes.length > 0) {
      // Mostrar aviso y esperar confirmación explícita del usuario
      setAdvertenciaDuplicado(true)
      return
    }

    // Sin duplicado: guardar directo
    await ejecutarGuardado()
  }

  return (
    <Modal title="Agregar registro desde Reporte" onClose={onClose}>
      <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
        <div style={{ background:'#1e2d42', border:'1px solid #3b82f644', borderRadius:8, padding:'10px 14px', fontSize:12, color:'#93c5fd' }}>
          Registrá un turno histórico no fichado. Se creará un turno si no existe, y un registro marcado como <strong>carga manual desde reporte</strong>. Queda auditado.
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div>
            <label style={S.label}>Fecha <span style={{ color:'#ef4444' }}>*</span></label>
            <input type="date" style={S.input} value={form.fecha} onChange={e => set('fecha', e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Objetivo <span style={{ color:'#ef4444' }}>*</span></label>
            {contextoObjetivoId ? (
              <div style={{ ...S.input, color:'#94a3b8', cursor:'default' }}>{objetivos.find((o: Objetivo) => o.id === form.objetivo_id)?.nombre || '—'}</div>
            ) : (
              <select style={S.select} value={form.objetivo_id} onChange={e => set('objetivo_id', e.target.value)}>
                <option value="">— Seleccioná —</option>
                {objetivos.map((o: Objetivo) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </select>
            )}
          </div>
        </div>

        <div>
          <label style={S.label}>Guardia <span style={{ color:'#ef4444' }}>*</span></label>
          {contextoEmpleadoId ? (
            <div style={{ ...S.input, color:'#94a3b8', cursor:'default' }}>
              {(() => { const g = empleados.find((e: Usuario) => e.id === form.guardia_id); return g ? `${g.apellido}, ${g.nombre} · ${g.legajo || 'sin legajo'}` : '—' })()}
            </div>
          ) : (
            <select style={S.select} value={form.guardia_id} onChange={e => set('guardia_id', e.target.value)}>
              <option value="">— Seleccioná guardia —</option>
              {empleados.map((g: Usuario) => <option key={g.id} value={g.id}>{g.apellido}, {g.nombre} · {g.legajo || 'sin legajo'}</option>)}
            </select>
          )}
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div>
            <label style={S.label}>Inicio turno programado <span style={{ color:'#ef4444' }}>*</span></label>
            <input type="time" style={S.input} value={form.hora_inicio} onChange={e => set('hora_inicio', e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Fin turno programado <span style={{ color:'#ef4444' }}>*</span></label>
            <input type="time" style={S.input} value={form.hora_fin} onChange={e => set('hora_fin', e.target.value)} />
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div>
            <label style={S.label}>Hora entrada real <span style={{ color:'#ef4444' }}>*</span></label>
            <input type="time" style={S.input} value={form.hora_entrada} onChange={e => set('hora_entrada', e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Hora salida real <span style={{ color:'#ef4444' }}>*</span></label>
            <input type="time" style={S.input} value={form.hora_salida} onChange={e => set('hora_salida', e.target.value)} />
          </div>
        </div>

        {form.hora_entrada && form.hora_salida && (
          <div style={{ fontSize:13, color:'#94a3b8' }}>
            Horas a liquidar: <strong style={{ color:'#10b981' }}>{calcHorasTrabajadas(form.hora_entrada, form.hora_salida).toFixed(2)} hs</strong>
          </div>
        )}

        <div>
          <label style={S.label}>Comentario</label>
          <textarea
            style={{ ...S.input, minHeight:64, resize:'vertical' as const }}
            value={form.comentario}
            onChange={e => set('comentario', e.target.value)}
            placeholder="Motivo u observación (opcional)"
          />
        </div>

        {advertenciaDuplicado && (
          <div style={{ background:'#451a03', border:'1px solid #f59e0b', borderRadius:8, padding:'14px' }}>
            <div style={{ color:'#fbbf24', fontSize:13, fontWeight:600, marginBottom:10 }}>
              ⚠️ Ya existe un registro muy similar para ese guardia, objetivo, fecha y horario.
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button style={{ ...S.btn, ...S.btnSecondary, flex:1 }} onClick={onClose} disabled={loading}>Cancelar</button>
              <button style={{ ...S.btn, background:'#f59e0b', color:'#000', flex:1 }} onClick={ejecutarGuardado} disabled={loading}>
                {loading ? 'Guardando...' : 'Agregar igualmente'}
              </button>
            </div>
          </div>
        )}

        {error && <div style={{ color:'#ef4444', fontSize:13 }}>{error}</div>}

        {!advertenciaDuplicado && (
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
            <button style={{ ...S.btn, ...S.btnSecondary }} onClick={onClose} disabled={loading}>Cancelar</button>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={guardar} disabled={loading}>
              {loading ? 'Verificando...' : 'Agregar registro'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

function CorregirRegistroModal({ registro, onClose, turnos, guardias, objetivos, user, setRegistros }: any) {
  const [formCorreccion, setFormCorreccion] = useState({
    guardia_final_id: '',
    objetivo_final_id: '',
    hora_entrada_final: '',
    hora_salida_final: '',
    comentario_final: '',
  })
  const [errorEdicion, setErrorEdicion] = useState('')
  const [loadingEdicion, setLoadingEdicion] = useState(false)

  useEffect(() => {
    if (!registro) return
    const turno = turnos.find((t: Turno) => t.id === registro.turno_id)
    setFormCorreccion({
      guardia_final_id: registro.guardia_final_id || registro.guardia_id || '',
      objetivo_final_id: registro.objetivo_final_id || turno?.objetivo_id || '',
      hora_entrada_final: registro.hora_entrada_final || registro.hora_entrada_real || '',
      hora_salida_final: registro.hora_salida_final || registro.hora_salida_real || '',
      comentario_final: registro.comentario_final || '',
    })
    setErrorEdicion('')
  }, [registro])

  if (!registro) return null

  const compararYGuardar = async (payload: {
    guardia_final_id: string | null
    objetivo_final_id: string | null
    hora_entrada_final: string | null
    hora_salida_final: string | null
    comentario_final: string | null
  }, comentarioAuditoria: string | null) => {
    setErrorEdicion('')

    // Detectar si hay cambios reales antes de llamar a la RPC.
    // La comparación definitiva (y la auditoría) ocurre dentro de PostgreSQL;
    // este chequeo del lado del cliente solo evita llamadas innecesarias.
    const campos: (keyof typeof payload)[] = [
      'guardia_final_id', 'objetivo_final_id',
      'hora_entrada_final', 'hora_salida_final', 'comentario_final',
    ]
    const hayCambios = campos.some(campo =>
      (registro[campo] ?? null) !== payload[campo]
    )
    if (!hayCambios) {
      onClose()
      return
    }

    setLoadingEdicion(true)

    // La RPC obtiene auth.uid() internamente y construye la auditoría
    // comparando valores reales de la DB. No se envían identidad ni
    // auditoría fabricada desde React.
    const { error: rpcError } = await supabase.rpc('corregir_registro_asistencia', {
      p_registro_id: registro.id,
      p_payload:     payload,
      p_comentario:  comentarioAuditoria,
    })

    if (rpcError) {
      setErrorEdicion(rpcError.message)
      setLoadingEdicion(false)
      return
    }

    const { data: updated } = await supabase.from('registros_asistencia').select('*').eq('id', registro.id).single()
    setRegistros((prev: RegistroAsistencia[]) => prev.map(r => r.id === registro.id ? (updated ?? { ...r, ...payload }) as RegistroAsistencia : r))
    setLoadingEdicion(false)
    onClose()
  }

  const guardarCorreccion = async () => {
    const payload = {
      guardia_final_id: formCorreccion.guardia_final_id || null,
      objetivo_final_id: formCorreccion.objetivo_final_id || null,
      hora_entrada_final: formCorreccion.hora_entrada_final || null,
      hora_salida_final: formCorreccion.hora_salida_final || null,
      comentario_final: formCorreccion.comentario_final.trim() || null,
    }
    await compararYGuardar(payload, formCorreccion.comentario_final.trim() || null)
  }

  const restablecerDatosFinales = async () => {
    if (!window.confirm('¿Restablecer los datos originales? Se eliminará la corrección actual.')) return
    await compararYGuardar({
      guardia_final_id: null,
      objetivo_final_id: null,
      hora_entrada_final: null,
      hora_salida_final: null,
      comentario_final: null,
    }, null)
  }

  const turnoOriginal = turnos.find((t: Turno) => t.id === registro.turno_id)
  const guardiaOriginal = guardias.find((x: Usuario) => x.id === registro.guardia_id)
  const objetivoOriginal = objetivos.find((x: Objetivo) => x.id === turnoOriginal?.objetivo_id)
  const guardiaFinalPreview = guardias.find((x: Usuario) => x.id === formCorreccion.guardia_final_id)
  const objetivoFinalPreview = objetivos.find((x: Objetivo) => x.id === formCorreccion.objetivo_final_id)
  const horasFinales = formCorreccion.hora_entrada_final && formCorreccion.hora_salida_final
    ? calcHorasTrabajadas(formCorreccion.hora_entrada_final, formCorreccion.hora_salida_final)
    : 0

  return (
    <Modal
      title={
        <div>
          <div>Corregir registro</div>
          <div style={{ fontSize:12, fontWeight:400, color:'#94a3b8', marginTop:4 }}>
            Los datos originales son la evidencia. Los datos corregidos son los que utilizará Mercosur para reportes y liquidación.
          </div>
        </div>
      }
      onClose={onClose}
      footer={
        <>
          <button
            style={{ ...S.btn, ...S.btnSecondary }}
            onClick={restablecerDatosFinales}
            disabled={loadingEdicion}
          >
            ↺ Restablecer datos originales
          </button>
          <button
            style={{ ...S.btn, ...S.btnSecondary }}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            style={{ ...S.btn, ...S.btnPrimary }}
            onClick={guardarCorreccion}
            disabled={loadingEdicion}
          >
            {loadingEdicion ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </>
      }
    >
      {errorEdicion && (
        <div style={{ marginBottom:16, padding:12, borderRadius:8, background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.3)', color:'#f59e0b', fontSize:13 }}>
          {errorEdicion}
        </div>
      )}

      <div style={{ marginBottom:16, padding:16, borderRadius:8, background:'rgba(148,163,184,.06)', border:'1px solid rgba(148,163,184,.2)' }}>
        <div style={{ fontFamily:'Syne,sans-serif', fontWeight:700, fontSize:13, marginBottom:12, color:'#94a3b8' }}>REGISTRO ORIGINAL</div>
        <div style={S.grid2}>
          <div><div style={{ ...S.label, marginBottom:2 }}>Vigilador original</div><div style={{ fontSize:14 }}>{guardiaOriginal ? `${guardiaOriginal.apellido}, ${guardiaOriginal.nombre}` : '—'}</div></div>
          <div><div style={{ ...S.label, marginBottom:2 }}>Objetivo original</div><div style={{ fontSize:14 }}>{objetivoOriginal?.nombre || '—'}</div></div>
          <div><div style={{ ...S.label, marginBottom:2 }}>Hora ingreso GPS</div><div style={{ fontSize:14 }}>{registro.hora_entrada_real || '—'}</div></div>
          <div><div style={{ ...S.label, marginBottom:2 }}>Hora egreso GPS</div><div style={{ fontSize:14 }}>{registro.hora_salida_real || '—'}</div></div>
          <div><div style={{ ...S.label, marginBottom:2 }}>Tipo de registro</div><div style={{ fontSize:14 }}>{registro.tipo_registro || '—'}</div></div>
          <div><div style={{ ...S.label, marginBottom:2 }}>Estado GPS</div><div style={{ fontSize:14 }}>{textoAuditoriaGps(registro, 'ingreso')}</div></div>
        </div>
      </div>

      <div style={{ marginBottom:16, padding:16, borderRadius:8, background:'rgba(99,102,241,.06)', border:'1px solid rgba(99,102,241,.2)' }}>
        <div style={{ fontFamily:'Syne,sans-serif', fontWeight:700, fontSize:13, marginBottom:12, color:'#a5b4fc' }}>DATOS CORREGIDOS</div>

        <div style={{ marginBottom:16 }}>
          <label style={S.label}>Vigilador</label>
          <select
            style={S.select}
            value={formCorreccion.guardia_final_id}
            onChange={e => setFormCorreccion({ ...formCorreccion, guardia_final_id:e.target.value })}
          >
            {guardias.map((g: Usuario) => (
              <option key={g.id} value={g.id}>{g.apellido}, {g.nombre}</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom:16 }}>
          <label style={S.label}>Objetivo</label>
          <select
            style={S.select}
            value={formCorreccion.objetivo_final_id}
            onChange={e => setFormCorreccion({ ...formCorreccion, objetivo_final_id:e.target.value })}
          >
            {objetivos.map((o: Objetivo) => (
              <option key={o.id} value={o.id}>{o.nombre}</option>
            ))}
          </select>
        </div>

        <div style={S.grid2}>
          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Hora ingreso</label>
            <input
              type="time"
              style={S.input}
              value={formCorreccion.hora_entrada_final}
              onChange={e => setFormCorreccion({ ...formCorreccion, hora_entrada_final:e.target.value })}
            />
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Hora egreso</label>
            <input
              type="time"
              style={S.input}
              value={formCorreccion.hora_salida_final}
              onChange={e => setFormCorreccion({ ...formCorreccion, hora_salida_final:e.target.value })}
            />
          </div>
        </div>

        <div style={{ marginBottom:0 }}>
          <label style={S.label}>Comentario</label>
          <textarea
            style={{ ...S.input, minHeight:80, resize:'vertical' }}
            value={formCorreccion.comentario_final}
            onChange={e => setFormCorreccion({ ...formCorreccion, comentario_final:e.target.value })}
          />
        </div>
      </div>

      <div style={{ padding:16, borderRadius:8, background:'rgba(34,197,94,.06)', border:'1px solid rgba(34,197,94,.2)' }}>
        <div style={{ fontFamily:'Syne,sans-serif', fontWeight:700, fontSize:13, marginBottom:12, color:'#86efac' }}>RESULTADO FINAL</div>
        <div style={S.grid2}>
          <div><div style={{ ...S.label, marginBottom:2 }}>Vigilador</div><div style={{ fontSize:14 }}>{guardiaFinalPreview ? `${guardiaFinalPreview.apellido}, ${guardiaFinalPreview.nombre}` : '—'}</div></div>
          <div><div style={{ ...S.label, marginBottom:2 }}>Objetivo</div><div style={{ fontSize:14 }}>{objetivoFinalPreview?.nombre || '—'}</div></div>
          <div><div style={{ ...S.label, marginBottom:2 }}>Horario</div><div style={{ fontSize:14 }}>{formCorreccion.hora_entrada_final || '—'} a {formCorreccion.hora_salida_final || '—'}</div></div>
          <div><div style={{ ...S.label, marginBottom:2 }}>Horas calculadas</div><div style={{ fontSize:14 }}>{horasFinales ? formatHoras(horasFinales) : '—'}</div></div>
        </div>
      </div>
    </Modal>
  )
}

function Asistencia({ registros, setRegistros, turnos, setTurnos, guardias, objetivos, supervisiones, filtroActivo, limpiarFiltro, user, esAdmin }: any) {
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ turno_id:'', hora_entrada_real:'', hora_salida_real:'', observacion:'' })
  const [loading, setLoading] = useState(false)
  const hoy = new Date().toLocaleDateString('sv-SE')

  const [registroEditando, setRegistroEditando] = useState<RegistroAsistencia | null>(null)

  const abrirCorreccion = (registro: RegistroAsistencia) => {
    setRegistroEditando(registro)
  }

  const cerrarEdicion = () => {
    setRegistroEditando(null)
  }

  const [registroAnulando, setRegistroAnulando] = useState<RegistroAsistencia | null>(null)
  const [motivoAnulacion, setMotivoAnulacion] = useState('')
  const [anulando, setAnulando] = useState(false)

  const anularRegistroManual = async () => {
    if (!registroAnulando || !motivoAnulacion.trim()) return
    setAnulando(true)
    try {
      const { error } = await supabase.rpc('anular_registro_manual', {
        p_registro_id: registroAnulando.id,
        p_motivo: motivoAnulacion.trim(),
      })
      if (error) throw error
      setRegistros((prev: RegistroAsistencia[]) =>
        prev.filter((r: RegistroAsistencia) => r.id !== registroAnulando.id)
      )
      setRegistroAnulando(null)
      setMotivoAnulacion('')
    } catch (e: any) {
      alert(e.message || 'Error al anular')
    } finally {
      setAnulando(false)
    }
  }

  const [registroEditandoManual, setRegistroEditandoManual] = useState<RegistroAsistencia | null>(null)
  const [formEditManual, setFormEditManual] = useState({ fecha: '', objetivo_id: '', hora_inicio: '', hora_fin: '', motivo: '' })
  const [editandoManual, setEditandoManual] = useState(false)

  const abrirEdicionManual = (reg: RegistroAsistencia) => {
    const turno = turnos.find((t: Turno) => t.id === reg.turno_id)
    setRegistroEditandoManual(reg)
    setFormEditManual({
      fecha: turno?.fecha || '',
      objetivo_id: (reg as any).objetivo_final_id ?? turno?.objetivo_id ?? '',
      hora_inicio: turno?.hora_inicio?.slice(0, 5) || '',
      hora_fin: turno?.hora_fin?.slice(0, 5) || '',
      motivo: '',
    })
  }

  const guardarEdicionManual = async () => {
    if (!registroEditandoManual || !formEditManual.motivo.trim()) return
    setEditandoManual(true)
    const turno = turnos.find((t: Turno) => t.id === registroEditandoManual.turno_id)
    if (!turno) { setEditandoManual(false); return }
    try {
      const cambioFecha = formEditManual.fecha !== turno.fecha
      const cambioHorario = formEditManual.hora_inicio !== turno.hora_inicio?.slice(0, 5) || formEditManual.hora_fin !== turno.hora_fin?.slice(0, 5)
      const cambioObjetivo = formEditManual.objetivo_id !== ((registroEditandoManual as any).objetivo_final_id ?? turno.objetivo_id)

      if (!cambioFecha && !cambioHorario && !cambioObjetivo) {
        setRegistroEditandoManual(null)
        return
      }

      const { data, error } = await supabase.rpc('corregir_turno_manual_operativo', {
        p_operacion_id: crypto.randomUUID(),
        p_registro_id: registroEditandoManual.id,
        p_fecha: cambioFecha ? formEditManual.fecha : null,
        p_hora_inicio: cambioHorario ? formEditManual.hora_inicio + ':00' : null,
        p_hora_fin: cambioHorario ? formEditManual.hora_fin + ':00' : null,
        p_objetivo_id: cambioObjetivo ? formEditManual.objetivo_id : null,
        p_motivo: formEditManual.motivo.trim(),
      })
      if (error) throw error

      const resultado = data as { turno: { id: string; fecha: string; hora_inicio: string; hora_fin: string; objetivo_id: string }; registro: { id: string; horas_liquidables: number } }
      setTurnos((prev: Turno[]) => prev.map((t: Turno) => t.id === turno.id ? { ...t, fecha: resultado.turno.fecha, hora_inicio: resultado.turno.hora_inicio, hora_fin: resultado.turno.hora_fin, objetivo_id: resultado.turno.objetivo_id } : t))
      setRegistros((prev: RegistroAsistencia[]) =>
        prev.map((r: RegistroAsistencia) => r.id === registroEditandoManual.id ? { ...r, horas_liquidables: resultado.registro.horas_liquidables, objetivo_final_id: cambioObjetivo ? formEditManual.objetivo_id : (r as any).objetivo_final_id } : r)
      )
      setRegistroEditandoManual(null)
    } catch (e: any) {
      alert(e.message || 'Error al guardar')
    } finally {
      setEditandoManual(false)
    }
  }

  const [verEvidencias, setVerEvidencias] = useState<string | null>(null)
  const [evidenciasPorRegistro, setEvidenciasPorRegistro] = useState<Record<string, EvidenciaAdmin[]>>({})
  const [cargandoEvidencias, setCargandoEvidencias] = useState<string | null>(null)

  // CGO – Centro Geográfico Operativo
  const [mostrarMapa, setMostrarMapa] = useState(false)
  const [capasActivas, setCapasActivas] = useState<Set<string>>(new Set(['ingresos', 'objetivos']))
  const [registroSeleccionado, setRegistroSeleccionado] = useState<string | null>(null)
  const [cgoModo, setCgoModo] = useState<'dia' | 'vigilador' | 'objetivo'>('dia')
  const [cgoFechaDia, setCgoFechaDia] = useState<string>(hoy)
  const [cgoVigiladorId, setCgoVigiladorId] = useState<string>('')
  const [cgoObjetivoId, setCgoObjetivoId] = useState<string>('')
  const [cgoFechaDesde, setCgoFechaDesde] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() - 6); return d.toLocaleDateString('sv-SE')
  })
  const [cgoFechaHasta, setCgoFechaHasta] = useState<string>(hoy)

  const toggleCapa = (capa: string) =>
    setCapasActivas(prev => {
      const next = new Set(prev)
      next.has(capa) ? next.delete(capa) : next.add(capa)
      return next
    })

  const verFotosRegistro = async (registroId: string) => {
    if (verEvidencias === registroId) { setVerEvidencias(null); return }
    setVerEvidencias(registroId)
    if (registroId in evidenciasPorRegistro) return

    setCargandoEvidencias(registroId)
    try {
      const { data, error: evError } = await supabase
        .from('evidencias')
        .select('id, proceso_id, tipo_evidencia, storage_path, bucket')
        .eq('proceso_tipo', 'ingreso')
        .eq('proceso_id', registroId)

      if (evError) throw evError

      const evs = (data || []) as EvidenciaAdmin[]
      const conUrls = await Promise.all(
        evs.map(ev =>
          supabase.storage.from(ev.bucket).createSignedUrl(ev.storage_path, 3600)
            .then(({ data: sd }) => ({ ...ev, signedUrl: sd?.signedUrl || null }))
        )
      )
      setEvidenciasPorRegistro(prev => ({ ...prev, [registroId]: conUrls }))
    } catch {
      setEvidenciasPorRegistro(prev => ({ ...prev, [registroId]: [] }))
    } finally {
      setCargandoEvidencias(null)
    }
  }

  const idsFiltroAsistencia = new Set((filtroActivo?.ids ?? []) as string[])
  const registrosFiltrados = registros.filter((r: RegistroAsistencia) => {
    const turno = turnos.find((t: Turno) => t.id === r.turno_id)
    if (idsFiltroAsistencia.size > 0) return idsFiltroAsistencia.has(r.id)
    if (filtroActivo?.tipo === 'hoy' && turno?.fecha !== hoy) return false
    if (filtroActivo?.tipo === 'en_turno' && (!r.hora_entrada_real || r.hora_salida_real)) return false
    if (filtroActivo?.tipo === 'tarde' && (turno?.fecha !== hoy || r.alerta_entrada !== 'tarde')) return false
    if (filtroActivo?.tipo === 'gps_fuera_radio' && (turno?.fecha !== hoy || r.gps_ingreso_estado !== 'fuera_radio')) return false
    return true
  })
  const registrosOrdenados = [...registrosFiltrados].sort((a: RegistroAsistencia, b: RegistroAsistencia) => {
    const turnoA = turnos.find((t: Turno) => t.id === a.turno_id)
    const turnoB = turnos.find((t: Turno) => t.id === b.turno_id)

    return ordenRegistroAsistencia(b, turnoB) - ordenRegistroAsistencia(a, turnoA)
  })

  const CGO_LIMIT = 150

  // Registros filtrados por modo CGO (desde el universo completo)
  const registrosCGO = useMemo<RegistroAsistencia[]>(() => {
    if (!mostrarMapa) return []
    const todos = registros as RegistroAsistencia[]
    if (cgoModo === 'dia') {
      return todos.filter(r => {
        const t = turnos.find((x: Turno) => x.id === r.turno_id)
        return t?.fecha === cgoFechaDia
      })
    }
    if (cgoModo === 'vigilador') {
      if (!cgoVigiladorId) return []
      return todos.filter(r => {
        const t = turnos.find((x: Turno) => x.id === r.turno_id)
        return r.guardia_id === cgoVigiladorId && t?.fecha && t.fecha >= cgoFechaDesde && t.fecha <= cgoFechaHasta
      })
    }
    if (cgoModo === 'objetivo') {
      if (!cgoObjetivoId) return []
      return todos.filter(r => {
        const t = turnos.find((x: Turno) => x.id === r.turno_id)
        return t?.objetivo_id === cgoObjetivoId && t?.fecha && t.fecha >= cgoFechaDesde && t.fecha <= cgoFechaHasta
      })
    }
    return []
  }, [mostrarMapa, cgoModo, cgoFechaDia, cgoVigiladorId, cgoObjetivoId, cgoFechaDesde, cgoFechaHasta, registros, turnos])

  const registrosCGOOrdenados = useMemo(() =>
    [...registrosCGO].sort((a: RegistroAsistencia, b: RegistroAsistencia) => {
      const tA = turnos.find((x: Turno) => x.id === a.turno_id)
      const tB = turnos.find((x: Turno) => x.id === b.turno_id)
      return ordenRegistroAsistencia(b, tB) - ordenRegistroAsistencia(a, tA)
    })
  , [registrosCGO, turnos])

  // Límite solo en modo día (sin entidad específica); vigilador/objetivo usan todos
  const registrosParaMapa = cgoModo === 'dia'
    ? registrosCGOOrdenados.slice(0, CGO_LIMIT)
    : registrosCGOOrdenados
  const mapaTrunco = cgoModo === 'dia' && registrosCGOOrdenados.length > CGO_LIMIT

  // La tabla muestra el mismo conjunto que el mapa cuando está visible
  const registrosParaTabla = mostrarMapa ? registrosCGOOrdenados : registrosOrdenados

  // Validar rango de fechas (máx 30 días para vigilador/objetivo)
  const diasRango = useMemo(() => {
    if (!cgoFechaDesde || !cgoFechaHasta) return 0
    return Math.round((new Date(cgoFechaHasta).getTime() - new Date(cgoFechaDesde).getTime()) / 86400000)
  }, [cgoFechaDesde, cgoFechaHasta])
  const rangoExcesivo = diasRango > 30

  const markersAsistencia = useMemo(() => {
    const result: any[] = []
    for (const r of registrosParaMapa) {
      const g = guardias.find((x: Usuario) => x.id === r.guardia_id)
      const t = turnos.find((x: Turno) => x.id === r.turno_id)
      const o = objetivos.find((x: Objetivo) => x.id === t?.objetivo_id)
      const empleado = g ? `${g.apellido}, ${g.nombre}` : '—'
      const objNombre = o?.nombre || '—'
      const fecha = formatFecha(fechaRegistroAsistencia(r, t))
      const tipoRegistroTexto = r.tipo_registro === 'fichaje_gps' ? 'Fichaje GPS'
        : r.tipo_registro === 'presente_manual' ? 'Presente manual'
        : r.tipo_registro === 'ausencia' ? 'Ausencia'
        : r.tipo_registro === 'reemplazo' ? 'Reemplazo'
        : r.tipo_registro || '—'

      const gpsIng = gpsRegistroAsistencia(r, 'ingreso')
      if (gpsIng) {
        const prec = typeof r.precision_ingreso === 'number' ? r.precision_ingreso : null
        const esManual = r.tipo_registro === 'presente_manual' || r.tipo_registro === 'ausencia' || r.tipo_registro === 'reemplazo'
        const esImpreciso = prec !== null && prec > GPS_PRECISION_MAX_METROS
        const color = esManual ? '#eab308' : esImpreciso ? '#f97316'
          : r.gps_ingreso_estado === 'fuera_radio' ? '#ef4444'
          : r.gps_ingreso_estado === 'dentro_radio' ? '#22c55e' : '#94a3b8'
        result.push({ id:`${r.id}-ing`, tipo:'ingreso', lat:gpsIng.lat, lng:gpsIng.lng, color, label:(empleado.charAt(0)+(empleado.split(' ')[1]?.[0]||'')).toUpperCase(), empleado, objetivo:objNombre, fecha, hora:r.hora_entrada_real||'—', distancia:metrosGpsTexto(r.distancia_ingreso_metros), precision:prec!==null?`${Math.round(prec)} m`:'—', estado:estadoGpsTexto(r,'ingreso'), tipoRegistro:tipoRegistroTexto, registroId:r.id, googleMapsUrl:`https://maps.google.com/?q=${gpsIng.lat},${gpsIng.lng}` })
      }
      const gpsEgr = gpsRegistroAsistencia(r, 'egreso')
      if (gpsEgr) {
        const prec = typeof r.precision_egreso === 'number' ? r.precision_egreso : null
        const esManual = r.tipo_registro === 'presente_manual' || r.tipo_registro === 'ausencia' || r.tipo_registro === 'reemplazo'
        const esImpreciso = prec !== null && prec > GPS_PRECISION_MAX_METROS
        const color = esManual ? '#eab308' : esImpreciso ? '#f97316'
          : r.gps_egreso_estado === 'fuera_radio' ? '#ef4444'
          : r.gps_egreso_estado === 'dentro_radio' ? '#22c55e' : '#94a3b8'
        result.push({ id:`${r.id}-egr`, tipo:'egreso', lat:gpsEgr.lat, lng:gpsEgr.lng, color, label:(empleado.charAt(0)+(empleado.split(' ')[1]?.[0]||'')).toUpperCase(), empleado, objetivo:objNombre, fecha, hora:r.hora_salida_real||'—', distancia:metrosGpsTexto(r.distancia_egreso_metros), precision:prec!==null?`${Math.round(prec)} m`:'—', estado:estadoGpsTexto(r,'egreso'), tipoRegistro:tipoRegistroTexto, registroId:r.id, googleMapsUrl:`https://maps.google.com/?q=${gpsEgr.lat},${gpsEgr.lng}` })
      }
    }
    return result
  }, [registrosParaMapa, guardias, turnos, objetivos])

  const objetivosCGO = useMemo(() => {
    const todos = (objetivos as Objetivo[])
      .filter(o => typeof o.lat === 'number' && typeof o.lng === 'number')
      .map(o => ({ id:o.id, nombre:o.nombre, lat:o.lat as number, lng:o.lng as number, radio_metros:o.radio_metros }))
    if (!mostrarMapa) return todos
    if (cgoModo === 'objetivo' && cgoObjetivoId) return todos.filter(o => o.id === cgoObjetivoId)
    const objIds = new Set(registrosParaMapa.map((r: RegistroAsistencia) => {
      const t = turnos.find((x: Turno) => x.id === r.turno_id)
      return t?.objetivo_id
    }).filter(Boolean))
    return objIds.size > 0 ? todos.filter(o => objIds.has(o.id)) : todos
  }, [objetivos, mostrarMapa, cgoModo, cgoObjetivoId, registrosParaMapa, turnos])

  const supervisionesCGO = useMemo(() => {
    if (!supervisiones?.length) return []
    let filtradas = supervisiones as any[]
    if (mostrarMapa) {
      if (cgoModo === 'dia') {
        filtradas = filtradas.filter((s: any) => s.created_at?.slice(0, 10) === cgoFechaDia)
      } else if (cgoModo === 'vigilador') {
        const objIds = new Set(registrosCGOOrdenados.map((r: RegistroAsistencia) => {
          const t = turnos.find((x: Turno) => x.id === r.turno_id)
          return t?.objetivo_id
        }).filter(Boolean))
        filtradas = filtradas.filter((s: any) => objIds.has(s.objetivo_id) && s.created_at?.slice(0,10) >= cgoFechaDesde && s.created_at?.slice(0,10) <= cgoFechaHasta)
      } else if (cgoModo === 'objetivo') {
        filtradas = filtradas.filter((s: any) => s.objetivo_id === cgoObjetivoId && s.created_at?.slice(0,10) >= cgoFechaDesde && s.created_at?.slice(0,10) <= cgoFechaHasta)
      }
    }
    return filtradas.map((s: any) => {
      const lat = typeof s.lat === 'number' ? s.lat : parseFloat(s.lat)
      const lng = typeof s.lng === 'number' ? s.lng : parseFloat(s.lng)
      const prec = typeof s.precision_gps === 'number' ? s.precision_gps : parseFloat(s.precision_gps)
      if (!isFinite(lat) || !isFinite(lng)) return null
      const objMatching = (objetivos as Objetivo[]).find(o => o.id === s.objetivo_id)
      const auditoria = objMatching ? auditoriaSupervisionGps(s, objMatching) : null
      const supervisor = s.supervisor ? `${s.supervisor.apellido||''}, ${s.supervisor.nombre||''}`.trim().replace(/^,\s*/,'') : '—'
      return { id:s.id, lat, lng, supervisor, objetivo:s.objetivo?.nombre||objMatching?.nombre||'—', fecha:formatFechaHora(s.created_at), estado:s.estado||'—', distancia:auditoria?metrosGpsTexto(auditoria.distancia_objetivo_metros):'—', precision:isFinite(prec)?`${Math.round(prec)} m`:'—', dentroRadio:auditoria?auditoria.dentro_radio:null, gpsImpreciso:auditoria?auditoria.gpsImpreciso:(isFinite(prec)&&prec>GPS_PRECISION_MAX_METROS), googleMapsUrl:`https://maps.google.com/?q=${lat},${lng}` }
    }).filter(Boolean)
  }, [supervisiones, objetivos, mostrarMapa, cgoModo, cgoFechaDia, cgoVigiladorId, cgoObjetivoId, cgoFechaDesde, cgoFechaHasta, registrosCGOOrdenados, turnos])

  const onMarkerClick = (registroId: string) => {
    setRegistroSeleccionado(registroId)
    setTimeout(() => {
      const el = document.getElementById(`cgo-row-${registroId}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
  }

  const registrar = async () => {
    const turno = turnos.find((t: Turno) => t.id === form.turno_id)
    if (!turno || !form.hora_entrada_real) return
    setLoading(true)
    if (!turno.guardia_id) {
      setLoading(false)
      return
    }
    const origenCobertura = user?.rol === 'admin' ? 'carga_admin' : 'carga_supervisor'
    const { data: registroId, error: rpcError } = await supabase.rpc('registrar_cobertura', {
      p_turno_id:          turno.id,
      p_guardia_id:        turno.guardia_id,
      p_origen:            origenCobertura,
      p_hora_entrada:      form.hora_entrada_real || null,
      p_hora_salida:       form.hora_salida_real  || null,
      p_horas_liquidables: null,
      p_comentario:        form.observacion || null,
    })
    if (!rpcError && registroId) {
      const { data } = await supabase.from('registros_asistencia').select('*').eq('id', registroId).single()
      if (data) setRegistros((prev: any[]) => [...prev, data])
      setTurnos((prev: Turno[]) => prev.map(t => t.id === turno.id ? { ...t, estado: 'cubierto' } as Turno : t))
    }
    setModal(false); setLoading(false)
  }

  // ── Horas del mes por origen ───────────────────────────────────────────────
  //
  // De dónde salieron las horas reconocidas: fichaje GPS del vigilador, carga
  // de supervisor, de administración, cierre automático o corrección. Es la
  // pregunta de esta pantalla —quién registró qué— y no la de Reportes, que
  // mira cuánto se paga. Las horas GPS son las realmente fichadas, distintas
  // de las liquidables: entrar diez minutos antes suma acá y no allá.
  const mesAsistencia = fechaCorteOperativa().slice(0, 7)
  const turnoPorIdAsistencia = new Map<string, Turno>((turnos || []).map((t: Turno) => [t.id, t]))
  const objetivoPruebaAsistencia = (objetivoId?: string | null) =>
    Boolean((objetivos || []).find((o: Objetivo) => o.id === objetivoId)?.es_prueba)
  const registrosMesAsistencia = (registros || []).filter((r: RegistroAsistencia) =>
    turnoPorIdAsistencia.get(r.turno_id)?.fecha?.slice(0, 7) === mesAsistencia)
  const mejorPorTurnoAsistencia = mejorRegistroPorTurno(
    registrosMesAsistencia, turnoPorIdAsistencia, objetivoPruebaAsistencia,
  )
  const resumenOrigenMes = (() => {
    let horasGPS = 0
    const porOrigen = new Map<string, { horas: number; registros: number }>()
    for (const [turnoId, reg] of Array.from(mejorPorTurnoAsistencia.entries())) {
      const turno = turnoPorIdAsistencia.get(turnoId)
      if (!turno) continue
      const linea = resolverLineaLiquidacion(turno, reg)
      horasGPS += linea.horasFichadasGPS
      const previo = porOrigen.get(linea.origenEtiqueta) ?? { horas: 0, registros: 0 }
      porOrigen.set(linea.origenEtiqueta, {
        horas: previo.horas + linea.horasLiquidables,
        registros: previo.registros + 1,
      })
    }
    return {
      horasGPS,
      origenes: Array.from(porOrigen.entries())
        .map(([etiqueta, v]) => ({ etiqueta, ...v }))
        .sort((a, b) => b.horas - a.horas),
    }
  })()

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', marginBottom:24 }}>
        <div style={{ flex:1 }}><div style={S.title}>Asistencia</div><div style={S.sub2}>Registro de entradas y salidas</div></div>
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setModal(true)}>+ Registrar</button>
        <button style={{ ...S.btn, ...S.btnSecondary, marginLeft:8 }} onClick={() => setMostrarMapa(v => !v)}>
          {mostrarMapa ? 'Ocultar mapa' : '🗺 Mapa CGO'}
        </button>
      </div>
      {filtroActivo && (
        <div style={{ ...S.card, padding:12, display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ color:'#f59e0b' }}>Filtro activo: {filtroActivo.label}</span>
          <button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 10px', fontSize:12 }} onClick={limpiarFiltro}>Limpiar filtro</button>
        </div>
      )}

      {resumenOrigenMes.origenes.length > 0 && (
        <div style={{ ...S.card, marginBottom:20, background:'#0f172a', border:'1px solid #1e2d42' }}>
          <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase' as const, letterSpacing:1, marginBottom:10 }}>
            Horas del mes por origen — {mesAsistencia}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(170px, 1fr))', gap:12 }}>
            <div style={{ background:'#1a2235', borderRadius:8, padding:'12px 16px', borderLeft:'3px solid #38bdf8' }}>
              <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase' as const, letterSpacing:1, marginBottom:4 }}>Horas fichadas GPS</div>
              <div style={{ fontFamily:'Syne,sans-serif', fontSize:22, fontWeight:800, color:'#38bdf8' }}>{resumenOrigenMes.horasGPS.toFixed(2)} hs</div>
              <div style={{ fontSize:11, color:'#475569', marginTop:2 }}>Tiempo realmente fichado, no lo liquidable.</div>
            </div>
            {resumenOrigenMes.origenes.map(o => (
              <div key={o.etiqueta} style={{ background:'#1a2235', borderRadius:8, padding:'12px 16px', borderLeft:'3px solid #475569' }}>
                <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase' as const, letterSpacing:1, marginBottom:4 }}>{o.etiqueta}</div>
                <div style={{ fontFamily:'Syne,sans-serif', fontSize:20, fontWeight:800, color:'#e2e8f0' }}>{o.horas.toFixed(2)} hs</div>
                <div style={{ fontSize:11, color:'#475569', marginTop:2 }}>{o.registros} registro{o.registros !== 1 ? 's' : ''}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {mostrarMapa && (
        <div style={{ marginBottom:20 }}>
          {/* Selector de modo */}
          <div style={{ display:'flex', gap:0, marginBottom:14, border:'1px solid #1e2d42', borderRadius:8, overflow:'hidden', width:'fit-content' }}>
            {(['dia','vigilador','objetivo'] as const).map((m, i) => (
              <button key={m}
                style={{ ...S.btn, ...(cgoModo===m ? S.btnPrimary : {}), borderRadius:0, border:'none', borderRight:i<2?'1px solid #1e2d42':'none', padding:'7px 18px', fontSize:12, background:cgoModo===m?undefined:'#0d1424' }}
                onClick={() => { setCgoModo(m); setRegistroSeleccionado(null) }}
              >
                {m==='dia'?'Por día':m==='vigilador'?'Por vigilador':'Por objetivo'}
              </button>
            ))}
          </div>

          {/* Controles por modo */}
          <div style={{ display:'flex', gap:12, flexWrap:'wrap' as const, alignItems:'center', marginBottom:12 }}>
            {cgoModo === 'dia' && (
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <label style={{ ...S.label, marginBottom:0, fontSize:12 }}>Fecha</label>
                <input type="date" style={{ ...S.input, padding:'5px 10px', fontSize:12, width:'auto' }} value={cgoFechaDia} max={hoy} onChange={e => { setCgoFechaDia(e.target.value); setRegistroSeleccionado(null) }} />
              </div>
            )}
            {(cgoModo === 'vigilador' || cgoModo === 'objetivo') && (<>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <label style={{ ...S.label, marginBottom:0, fontSize:12 }}>Desde</label>
                <input type="date" style={{ ...S.input, padding:'5px 10px', fontSize:12, width:'auto' }} value={cgoFechaDesde} max={hoy} onChange={e => { setCgoFechaDesde(e.target.value); setRegistroSeleccionado(null) }} />
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <label style={{ ...S.label, marginBottom:0, fontSize:12 }}>Hasta</label>
                <input type="date" style={{ ...S.input, padding:'5px 10px', fontSize:12, width:'auto' }} value={cgoFechaHasta} max={hoy} onChange={e => { setCgoFechaHasta(e.target.value); setRegistroSeleccionado(null) }} />
              </div>
            </>)}
            {cgoModo === 'vigilador' && (
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <label style={{ ...S.label, marginBottom:0, fontSize:12 }}>Vigilador</label>
                <select style={{ ...S.select, padding:'5px 10px', fontSize:12 }} value={cgoVigiladorId} onChange={e => { setCgoVigiladorId(e.target.value); setRegistroSeleccionado(null) }}>
                  <option value="">Seleccionar...</option>
                  {([...guardias] as Usuario[]).sort((a, b) => a.apellido.localeCompare(b.apellido)).map((g: Usuario) => (
                    <option key={g.id} value={g.id}>{g.apellido}, {g.nombre}</option>
                  ))}
                </select>
              </div>
            )}
            {cgoModo === 'objetivo' && (
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <label style={{ ...S.label, marginBottom:0, fontSize:12 }}>Objetivo</label>
                <select style={{ ...S.select, padding:'5px 10px', fontSize:12 }} value={cgoObjetivoId} onChange={e => { setCgoObjetivoId(e.target.value); setRegistroSeleccionado(null) }}>
                  <option value="">Seleccionar...</option>
                  {([...objetivos] as Objetivo[]).sort((a, b) => a.nombre.localeCompare(b.nombre)).map((o: Objetivo) => (
                    <option key={o.id} value={o.id}>{o.nombre}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Advertencia rango excesivo */}
          {rangoExcesivo && cgoModo !== 'dia' && (
            <div style={{ marginBottom:8, padding:'6px 12px', background:'#1a2235', border:'1px solid #ef4444', borderRadius:6, color:'#ef4444', fontSize:12 }}>
              El rango supera 30 días ({diasRango} días). Reducí el período para mayor rendimiento.
            </div>
          )}

          {/* Info: cantidad + período + filtro */}
          <div style={{ marginBottom:10, padding:'6px 12px', background:'#0f1c2e', border:'1px solid #1e3a5f', borderRadius:6, fontSize:12, color:'#94a3b8' }}>
            {registrosCGOOrdenados.length === 0
              ? (cgoModo==='dia' ? `Sin registros para el ${formatFecha(cgoFechaDia)}.` : !cgoVigiladorId && cgoModo==='vigilador' ? 'Seleccioná un vigilador.' : !cgoObjetivoId && cgoModo==='objetivo' ? 'Seleccioná un objetivo.' : 'Sin registros para el filtro seleccionado.')
              : <>
                  <strong style={{ color:'#e2e8f0' }}>{registrosCGOOrdenados.length} registro{registrosCGOOrdenados.length!==1?'s':''}</strong>
                  {' · '}
                  {cgoModo==='dia' ? `Día: ${formatFecha(cgoFechaDia)}` : `Período: ${formatFecha(cgoFechaDesde)} – ${formatFecha(cgoFechaHasta)}`}
                  {cgoModo==='vigilador' && cgoVigiladorId && (() => { const g=(guardias as Usuario[]).find(x=>x.id===cgoVigiladorId); return g?` · Vigilador: ${g.apellido}, ${g.nombre}`:''; })()}
                  {cgoModo==='objetivo' && cgoObjetivoId && (() => { const o=(objetivos as Objetivo[]).find(x=>x.id===cgoObjetivoId); return o?` · Objetivo: ${o.nombre}`:''; })()}
                  {mapaTrunco && <span style={{ color:'#f59e0b' }}>{` · Mapa: primeros ${CGO_LIMIT}`}</span>}
                </>
            }
          </div>

          {/* Capas */}
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' as const, marginBottom:12 }}>
            {(['ingresos','egresos','objetivos','supervisiones'] as const).map(capa => (
              <button key={capa}
                style={{ ...S.btn, ...(capasActivas.has(capa) ? S.btnPrimary : S.btnSecondary), padding:'5px 12px', fontSize:12 }}
                onClick={() => toggleCapa(capa)}
              >
                {capa.charAt(0).toUpperCase() + capa.slice(1)}
              </button>
            ))}
          </div>

          <AsistenciaMap
            markers={markersAsistencia}
            objetivos={objetivosCGO}
            supervisiones={supervisionesCGO}
            capasActivas={capasActivas}
            registroSeleccionado={registroSeleccionado}
            onMarkerClick={onMarkerClick}
          />

          {/* Leyenda */}
          <div style={{ display:'flex', flexWrap:'wrap' as const, gap:12, marginTop:10, fontSize:11, color:'#64748b' }}>
            <span><span style={{ display:'inline-block', width:10, height:10, borderRadius:'50%', background:'#22c55e', marginRight:4 }}/>Ingreso dentro radio</span>
            <span><span style={{ display:'inline-block', width:10, height:10, borderRadius:'50%', background:'#ef4444', marginRight:4 }}/>Fuera de radio</span>
            <span><span style={{ display:'inline-block', width:10, height:10, borderRadius:'50%', background:'#f97316', marginRight:4 }}/>GPS impreciso</span>
            <span><span style={{ display:'inline-block', width:10, height:10, borderRadius:'50%', background:'#eab308', marginRight:4 }}/>Manual</span>
            <span><span style={{ display:'inline-block', width:10, height:10, borderRadius:'50%', background:'#94a3b8', marginRight:4 }}/>Sin estado</span>
            <span><span style={{ display:'inline-block', width:10, height:10, borderRadius:2, background:'#2563eb', marginRight:4 }}/>Objetivo</span>
            <span><span style={{ display:'inline-block', width:10, height:10, borderRadius:'50%', background:'#38bdf8', marginRight:4 }}/>Supervisión dentro</span>
          </div>
        </div>
      )}
      <div style={{ ...S.card, overflowX:'auto' }}>
        <table style={S.table}>
          <thead><tr><th style={S.th}>Fecha</th><th style={S.th}>Guardia</th><th style={S.th}>Objetivo</th><th style={S.th}>Asignado</th><th style={S.th}>Entrada Real</th><th style={S.th}>Salida Real</th><th style={S.th}>Horas</th><th style={S.th}>GPS Ingreso</th><th style={S.th}>GPS Egreso</th><th style={S.th}>Precisión</th><th style={S.th}>Alertas</th><th style={S.th}>Fotos</th>{esAdmin && <th style={S.th}></th>}</tr></thead>
          <tbody>
            {registrosParaTabla.map((r: RegistroAsistencia) => {
              const g = guardias.find((x: Usuario) => x.id === r.guardia_id)
              const t = turnos.find((x: Turno) => x.id === r.turno_id)
              const o = objetivos.find((x: Objetivo) => x.id === t?.objetivo_id)
              const gpsIngreso = gpsRegistroAsistencia(r, 'ingreso')
              const gpsEgreso = gpsRegistroAsistencia(r, 'egreso')
              const textoGpsIngreso = textoAuditoriaGps(r, 'ingreso')
              const textoGpsEgreso = textoAuditoriaGps(r, 'egreso')
              const expandido = verEvidencias === r.id
              const evs = evidenciasPorRegistro[r.id]
              const estaSeleccionado = registroSeleccionado === r.id
              return (
                <Fragment key={r.id}>
                  <tr
                    id={`cgo-row-${r.id}`}
                    style={estaSeleccionado ? { background:'rgba(56,189,248,.08)', outline:'2px solid #38bdf8', outlineOffset:'-2px' } : undefined}
                    onClick={() => { if (mostrarMapa) { setRegistroSeleccionado(r.id); window.scrollTo({ top:0, behavior:'smooth' }) } }}
                  >
                    <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:600, fontSize:13 }}>{formatFecha(fechaRegistroAsistencia(r, t))}</td>
                    <td style={S.td}><strong>{g?.apellido}, {g?.nombre}</strong></td>
                    <td style={{ ...S.td, fontSize:12 }}>{o?.nombre || '—'}</td>
                    <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:600, fontSize:13 }}>{formatHorarioAsignado(t)}</td>
                    <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:600 }}>{r.hora_entrada_real}</td>
                    <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:600 }}>{r.hora_salida_real || '—'}</td>
                    <td style={S.td}>{r.horas_trabajadas ? formatHoras(r.horas_trabajadas) : '—'}</td>
                    <td style={{ ...S.td, fontSize:12 }}>
                      <Badge type={r.gps_ingreso_estado === 'fuera_radio' ? 'alerta' : gpsIngreso ? 'ok' : 'pendiente'}>{textoGpsIngreso}</Badge>
                    </td>
                    <td style={{ ...S.td, fontSize:12 }}>
                      <Badge type={r.gps_egreso_estado === 'fuera_radio' ? 'alerta' : gpsEgreso ? 'ok' : 'pendiente'}>{textoGpsEgreso}</Badge>
                    </td>
                    <td style={{ ...S.td, fontSize:12, color:'#94a3b8' }}>{textoPrecisionGps(r)}</td>
                    <td style={S.td}>
                      <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                        {r.tipo_registro === 'carga_manual' && <Badge type="pendiente">Carga manual</Badge>}
                        {r.tipo_registro !== 'carga_manual' && r.alerta_entrada && <Badge type={r.alerta_entrada}>{r.alerta_entrada === 'tarde' ? '⏰ Tarde' : '⬆ Anticipada'}</Badge>}
                        {r.tipo_registro !== 'carga_manual' && r.alerta_salida && <Badge type={r.alerta_salida}>{r.alerta_salida === 'anticipada' ? '⬇ Salida ant.' : '⏱ Posterior'}</Badge>}
                        {r.tipo_registro !== 'carga_manual' && r.gps_ingreso_estado === 'fuera_radio' && <Badge type="alerta">GPS fuera radio</Badge>}
                        {r.tipo_registro !== 'carga_manual' && !r.alerta_entrada && !r.alerta_salida && r.gps_ingreso_estado !== 'fuera_radio' && <Badge type="cubierto">✓ Ok</Badge>}
                      </div>
                    </td>
                    <td style={S.td}>
                      <button
                        style={{ ...S.btn, ...S.btnSecondary, padding:'4px 8px', fontSize:11 }}
                        onClick={() => verFotosRegistro(r.id)}
                      >
                        {cargandoEvidencias === r.id ? '...' : expandido ? 'Ocultar' : 'Ver fotos'}
                      </button>
                    </td>
                    {esAdmin && (
                      <td style={S.td}>
                        <div style={{ display:'flex', gap:4 }}>
                          <button
                            style={{ ...S.btn, ...S.btnSecondary, padding:'6px 10px', fontSize:12 }}
                            onClick={() => abrirCorreccion(r)}
                          >
                            Corregir
                          </button>
                          {r.tipo_registro === 'carga_manual' && !(r as any).registro_anulado_at && (
                            <button
                              style={{ ...S.btn, padding:'6px 10px', fontSize:12, background:'#7f1d1d', color:'#fca5a5', border:'1px solid #991b1b' }}
                              onClick={() => { setRegistroAnulando(r); setMotivoAnulacion('') }}
                            >
                              Anular
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                  {expandido && (
                    <tr>
                      <td colSpan={esAdmin ? 13 : 12} style={{ padding:'12px 20px', background:'#0d1424', borderBottom:'1px solid #1e2d42' }}>
                        {cargandoEvidencias === r.id ? (
                          <span style={{ color:'#64748b', fontSize:12 }}>Cargando fotos...</span>
                        ) : !evs || evs.length === 0 ? (
                          <span style={{ color:'#64748b', fontSize:12 }}>Sin evidencias de ingreso</span>
                        ) : (
                          <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
                            {evs.map(ev => (
                              <div key={ev.id} style={{ textAlign:'center' as const }}>
                                <div style={{ fontSize:10, color:'#64748b', marginBottom:4, textTransform:'uppercase' as const, letterSpacing:1 }}>
                                  {ev.tipo_evidencia.replace('_', ' ')}
                                </div>
                                {ev.signedUrl ? (
                                  <img
                                    src={ev.signedUrl}
                                    alt={ev.tipo_evidencia}
                                    style={{ width:80, height:80, objectFit:'cover' as const, borderRadius:6, cursor:'pointer', border:'1px solid #1e2d42' }}
                                    onClick={() => window.open(ev.signedUrl!, '_blank')}
                                  />
                                ) : (
                                  <div style={{ width:80, height:80, background:'#1a2235', borderRadius:6, border:'1px solid #1e2d42', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, color:'#64748b' }}>
                                    Sin URL
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {modal && (
        <Modal title="Registrar Asistencia" onClose={() => setModal(false)}
          footer={<><button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => setModal(false)}>Cancelar</button><button style={{ ...S.btn, ...S.btnPrimary }} onClick={registrar} disabled={loading}>{loading ? 'Registrando...' : 'Registrar'}</button></>}>
          <div style={{ marginBottom:16 }}><label style={S.label}>Turno</label>
            <select style={S.select} value={form.turno_id} onChange={e => setForm({...form, turno_id:e.target.value})}>
              <option value="">Seleccionar turno...</option>
              {turnos.map((t: Turno) => {
                const g = guardias.find((x: Usuario) => x.id === t.guardia_id)
                const o = objetivos.find((x: Objetivo) => x.id === t.objetivo_id)
                return <option key={t.id} value={t.id}>{formatFecha(t.fecha)} | {o?.nombre} | {formatHorarioAsignado(t)} | {g ? g.apellido : 'Sin guardia'}</option>
              })}
            </select>
          </div>
          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}><label style={S.label}>Hora de entrada</label><input type="time" style={S.input} value={form.hora_entrada_real} onChange={e => setForm({...form, hora_entrada_real:e.target.value})} /></div>
            <div style={{ marginBottom:16 }}><label style={S.label}>Hora de salida</label><input type="time" style={S.input} value={form.hora_salida_real} onChange={e => setForm({...form, hora_salida_real:e.target.value})} /></div>
          </div>
          <div style={{ marginBottom:16 }}><label style={S.label}>Observación</label><textarea style={{ ...S.input, resize:'vertical', minHeight:80 }} value={form.observacion} onChange={e => setForm({...form, observacion:e.target.value})} /></div>
        </Modal>
      )}

      {registroEditando && (
        <CorregirRegistroModal
          registro={registroEditando}
          onClose={cerrarEdicion}
          turnos={turnos}
          guardias={guardias}
          objetivos={objetivos}
          user={user}
          setRegistros={setRegistros}
        />
      )}

      {registroAnulando && (
        <Modal title="Anular registro manual" onClose={() => setRegistroAnulando(null)}>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>
            Esta acción anulará lógicamente el registro de carga manual. Las horas liquidables pasarán a 0. La operación queda registrada en auditoría.
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={S.label}>Motivo de anulación *</label>
            <textarea
              style={{ ...S.input, resize: 'vertical', minHeight: 80 }}
              value={motivoAnulacion}
              onChange={e => setMotivoAnulacion(e.target.value)}
              placeholder="Ingrese el motivo de la anulación..."
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => setRegistroAnulando(null)}>Cancelar</button>
            <button
              style={{ ...S.btn, background: '#991b1b', color: '#fca5a5', border: '1px solid #7f1d1d', opacity: !motivoAnulacion.trim() || anulando ? 0.5 : 1 }}
              disabled={!motivoAnulacion.trim() || anulando}
              onClick={anularRegistroManual}
            >
              {anulando ? 'Anulando...' : 'Confirmar anulación'}
            </button>
          </div>
        </Modal>
      )}

      {registroEditandoManual && (
        <Modal title="Editar registro manual" onClose={() => setRegistroEditandoManual(null)}>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>
            Corrección de registro de carga manual. Los cambios quedan registrados en auditoría.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={S.label}>Fecha *</label>
              <input type="date" style={S.input} value={formEditManual.fecha} onChange={e => setFormEditManual({ ...formEditManual, fecha: e.target.value })} />
            </div>
            <div>
              <label style={S.label}>Objetivo</label>
              <select style={S.select} value={formEditManual.objetivo_id} onChange={e => setFormEditManual({ ...formEditManual, objetivo_id: e.target.value })}>
                <option value="">— Sin objetivo —</option>
                {objetivos.map((o: Objetivo) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={S.label}>Hora inicio</label>
              <input type="time" style={S.input} value={formEditManual.hora_inicio} onChange={e => setFormEditManual({ ...formEditManual, hora_inicio: e.target.value })} />
            </div>
            <div>
              <label style={S.label}>Hora fin</label>
              <input type="time" style={S.input} value={formEditManual.hora_fin} onChange={e => setFormEditManual({ ...formEditManual, hora_fin: e.target.value })} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={S.label}>Motivo de corrección *</label>
            <textarea
              style={{ ...S.input, resize: 'vertical', minHeight: 80 }}
              value={formEditManual.motivo}
              onChange={e => setFormEditManual({ ...formEditManual, motivo: e.target.value })}
              placeholder="Ingrese el motivo de la corrección..."
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => setRegistroEditandoManual(null)}>Cancelar</button>
            <button
              style={{ ...S.btn, ...S.btnPrimary, opacity: !formEditManual.motivo.trim() || !formEditManual.fecha || editandoManual ? 0.5 : 1 }}
              disabled={!formEditManual.motivo.trim() || !formEditManual.fecha || editandoManual}
              onClick={guardarEdicionManual}
            >
              {editandoManual ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Novedades({ novedades, setNovedades, guardias, objetivos, filtroActivo, limpiarFiltro }: any) {
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ guardia_id:'', objetivo_id:'', tipo:'Rutina', descripcion:'', prioridad:'normal' })
  const [loading, setLoading] = useState(false)
  const mesActual = new Date().toLocaleDateString('sv-SE').slice(0, 7)
  const [mesSeleccionado, setMesSeleccionado] = useState(mesActual)
  const [estadoFiltro, setEstadoFiltro] = useState('todos')
  const [prioridadFiltro, setPrioridadFiltro] = useState('todas')

  const guardar = async () => {
    setLoading(true)
    const { data } = await supabase.from('novedades').insert({ ...form, guardia_id: form.guardia_id || null, objetivo_id: form.objetivo_id || null, estado:'pendiente' }).select().single()
    if (data) setNovedades((prev: any[]) => [...prev, data])
    setModal(false); setLoading(false)
  }

  const cambiarEstado = async (id: string, estado: string) => {
    await supabase.from('novedades').update({ estado }).eq('id', id)
    setNovedades((prev: any[]) => prev.map((n: Novedad) => n.id === id ? { ...n, estado } : n))
  }

  const mesNovedad = (novedad: Novedad) => {
    const fecha = new Date(novedad.created_at)
    if (Number.isNaN(fecha.getTime())) return novedad.created_at?.slice(0, 7) || mesActual

    return fecha.toLocaleDateString('sv-SE').slice(0, 7)
  }

  const labelMes = (mes: string) => {
    const [anio, numeroMes] = mes.split('-').map(Number)
    if (!anio || !numeroMes) return mes

    const texto = new Date(anio, numeroMes - 1, 1).toLocaleDateString('es-AR', { month:'long', year:'numeric' })
    return texto.charAt(0).toUpperCase() + texto.slice(1)
  }

  const ordenarNovedades = (items: Novedad[]) =>
    [...items].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  const filtrarNovedades = (items: Novedad[]) =>
    ordenarNovedades(items.filter((n: Novedad) =>
      (estadoFiltro === 'todos' || n.estado === estadoFiltro) &&
      (prioridadFiltro === 'todas' || n.prioridad === prioridadFiltro)
    ))

  const idsFiltroNovedades = new Set((filtroActivo?.ids ?? []) as string[])
  const novedadesDelMes = novedades.filter((n: Novedad) => mesNovedad(n) === mesSeleccionado)
  const novedadesBase = idsFiltroNovedades.size > 0
    ? novedades.filter((n: Novedad) => idsFiltroNovedades.has(n.id))
    : novedadesDelMes
  const novedadesVisibles = filtrarNovedades(novedadesBase)
  const pendientesMesActual = novedades
    .filter((n: Novedad) => mesNovedad(n) === mesActual && n.estado === 'pendiente')
    .length
  const mesesHistoricos = Array.from(new Set(novedades.map((n: Novedad) => mesNovedad(n))))
    .filter((mes: string) => mes < mesActual)
    .sort((a: string, b: string) => b.localeCompare(a))
  const cantidadMes = (mes: string) => novedades.filter((n: Novedad) => mesNovedad(n) === mes).length

  const renderNovedad = (n: Novedad) => {
    const g = guardias.find((x: Usuario) => x.id === n.guardia_id)
    const o = objetivos.find((x: Objetivo) => x.id === n.objetivo_id)

    return (
      <div key={n.id} style={{ background:'#1a2235', border:'1px solid #1e2d42', borderRadius:10, padding:16, marginBottom:12 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginBottom:8 }}>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <Badge type={n.prioridad}>{n.prioridad.toUpperCase()}</Badge>
            <Badge type={n.estado}>{n.estado}</Badge>
            <strong style={{ fontSize:14 }}>{n.tipo}</strong>
          </div>
          <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap', justifyContent:'flex-end' }}>
            {n.estado === 'pendiente' && <button style={{ ...S.btn, ...S.btnSecondary, padding:'5px 12px', fontSize:12 }} onClick={() => cambiarEstado(n.id, 'revisada')}>Revisada</button>}
            {n.estado === 'revisada' && <button style={{ ...S.btn, ...S.btnSecondary, padding:'5px 12px', fontSize:12 }} onClick={() => cambiarEstado(n.id, 'resuelta')}>Resuelta</button>}
            <span style={{ fontSize:11, color:'#64748b' }}>{formatFechaHora(n.created_at)}</span>
          </div>
        </div>
        <div style={{ fontSize:13, color:'#cbd5e1' }}>{n.descripcion}</div>
        <div style={{ fontSize:11, color:'#64748b', marginTop:8 }}>📍 {o?.nombre || '—'} · 👮 {g?.nombre} {g?.apellido}</div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', marginBottom:24 }}>
        <div style={{ flex:1 }}><div style={S.title}>Novedades</div><div style={S.sub2}>{pendientesMesActual} pendientes en {labelMes(mesActual)}</div></div>
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setModal(true)}>+ Nueva Novedad</button>
      </div>

      {filtroActivo && (
        <div style={{ ...S.card, padding:12, display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ color:'#f59e0b' }}>Filtro activo: {filtroActivo.label}</span>
          <button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 10px', fontSize:12 }} onClick={limpiarFiltro}>Limpiar filtro</button>
        </div>
      )}

      <div style={{ ...S.card, display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:12 }}>
        <div>
          <label style={S.label}>Mes</label>
          <input type="month" style={S.input} value={mesSeleccionado} onChange={e => setMesSeleccionado(e.target.value || mesActual)} />
        </div>
        <div>
          <label style={S.label}>Estado</label>
          <select style={S.select} value={estadoFiltro} onChange={e => setEstadoFiltro(e.target.value)}>
            <option value="todos">Todos</option>
            <option value="pendiente">Pendientes</option>
            <option value="revisada">Revisadas</option>
            <option value="resuelta">Resueltas</option>
          </select>
        </div>
        <div>
          <label style={S.label}>Prioridad</label>
          <select style={S.select} value={prioridadFiltro} onChange={e => setPrioridadFiltro(e.target.value)}>
            <option value="todas">Todas</option>
            <option value="normal">Normal</option>
            <option value="importante">Importante</option>
            <option value="urgente">Urgente</option>
          </select>
        </div>
      </div>

      <div style={S.card}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'center', marginBottom:16 }}>
          <div>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:18, fontWeight:800 }}>{labelMes(mesSeleccionado)}</div>
            <div style={{ fontSize:13, color:'#64748b' }}>
              {novedadesVisibles.length} de {novedadesDelMes.length} novedades
            </div>
          </div>
          {mesSeleccionado === mesActual ? <Badge type="activo">Mes actual</Badge> : <Badge type="revisada">Histórico abierto</Badge>}
        </div>

        {novedadesVisibles.length === 0 ? (
          <div style={{ textAlign:'center', padding:32, color:'#64748b' }}>No hay novedades para los filtros seleccionados.</div>
        ) : novedadesVisibles.map(renderNovedad)}
      </div>

      <div style={S.card}>
        <div style={{ fontFamily:'Syne,sans-serif', fontSize:18, fontWeight:800, marginBottom:12 }}>Meses anteriores</div>
        {mesesHistoricos.length === 0 ? (
          <div style={{ color:'#64748b', fontSize:13 }}>No hay novedades históricas cargadas.</div>
        ) : (
          <div style={{ display:'grid', gap:8 }}>
            {mesesHistoricos.map((mes: string) => (
              <button
                key={mes}
                type="button"
                onClick={() => setMesSeleccionado(mes)}
                style={{
                  ...S.btn,
                  ...S.btnSecondary,
                  justifyContent:'space-between',
                  width:'100%',
                  borderColor: mesSeleccionado === mes ? '#f59e0b' : '#1e2d42',
                }}
              >
                <span>{labelMes(mes)} — {cantidadMes(mes)} novedades</span>
                <span style={{ color: mesSeleccionado === mes ? '#f59e0b' : '#64748b' }}>{mesSeleccionado === mes ? 'Abierto' : 'Abrir'}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {modal && (
        <Modal title="Nueva Novedad" onClose={() => setModal(false)}
          footer={<><button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => setModal(false)}>Cancelar</button><button style={{ ...S.btn, ...S.btnPrimary }} onClick={guardar} disabled={loading}>{loading ? 'Guardando...' : 'Guardar'}</button></>}>
          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}><label style={S.label}>Guardia</label><select style={S.select} value={form.guardia_id} onChange={e => setForm({...form, guardia_id:e.target.value})}><option value="">Seleccionar...</option>{guardias.map((g: Usuario) => <option key={g.id} value={g.id}>{g.apellido}, {g.nombre}</option>)}</select></div>
            <div style={{ marginBottom:16 }}><label style={S.label}>Objetivo</label><select style={S.select} value={form.objetivo_id} onChange={e => setForm({...form, objetivo_id:e.target.value})}><option value="">Seleccionar...</option>{objetivos.map((o: Objetivo) => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
            <div style={{ marginBottom:16 }}><label style={S.label}>Tipo</label><select style={S.select} value={form.tipo} onChange={e => setForm({...form, tipo:e.target.value})}>{['Rutina','Incidente','Mantenimiento','Administrativo','Urgencia'].map(t => <option key={t}>{t}</option>)}</select></div>
            <div style={{ marginBottom:16 }}><label style={S.label}>Prioridad</label><select style={S.select} value={form.prioridad} onChange={e => setForm({...form, prioridad:e.target.value})}><option value="normal">Normal</option><option value="importante">Importante</option><option value="urgente">Urgente</option></select></div>
          </div>
          <div style={{ marginBottom:16 }}><label style={S.label}>Descripción</label><textarea style={{ ...S.input, resize:'vertical', minHeight:80 }} value={form.descripcion} onChange={e => setForm({...form, descripcion:e.target.value})} /></div>
        </Modal>
      )}
    </div>
  )
}

function Reportes({ registros, setRegistros, turnos, setTurnos, guardias, objetivos, novedades, filtroActivo, limpiarFiltro, user }: any) {
  const [registroCorrigiendo, setRegistroCorrigiendo] = useState<RegistroAsistencia | null>(null)
  const [turnoParaCargaManual, setTurnoParaCargaManual] = useState<Turno | null>(null)
  const [agregarRegistroContexto, setAgregarRegistroContexto] = useState<{ empleadoId?: string; objetivoId?: string } | null>(null)
  const empleados = guardias.filter((g: Usuario) => g.rol !== 'admin')
  const [tab, setTab] = useState('planilla_empleado')
  const [mes, setMes] = useState(mesActualArgentina())
  const [verTodos, setVerTodos] = useState(false)
  const [empleadoId, setEmpleadoId] = useState('')
  const [objetivoId, setObjetivoId] = useState('')

  const [turnosReportes, setTurnosReportes] = useState<Turno[]>([])
  const [registrosReportes, setRegistrosReportes] = useState<RegistroAsistencia[]>([])
  const [novedadesLaborales, setNovedadesLaborales] = useState<any[]>([])

  // ── Editar turno ──────────────────────────────────────────────────
  const [turnoEditando, setTurnoEditando] = useState<Turno | null>(null)
  const [formEditTurno, setFormEditTurno] = useState({ fecha: '', hora_inicio: '', hora_fin: '', comentario: '' })
  const [editandoTurno, setEditandoTurno] = useState(false)
  const [mostrarDiferencias, setMostrarDiferencias] = useState(false)
  // Estado de revisión por turno+empleado, de la misma fuente que la bandeja.
  const [revisionMes, setRevisionMes] = useState<Map<string, EstadoRevisionClave>>(new Map())
  // La lista de diferencias arranca en lo que todavía pide acción; el resto
  // sigue accesible, con su estado a la vista.
  const [difSoloPendientes, setDifSoloPendientes] = useState(true)

  const headersAdmin = async () => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new Error('Sesión de administrador requerida')
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  }

  const abrirEdicionTurno = (turnoId: string) => {
    const turno = turnos.find((t: Turno) => t.id === turnoId)
    if (!turno) return
    setTurnoEditando(turno)
    setFormEditTurno({
      fecha: turno.fecha,
      hora_inicio: turno.hora_inicio?.slice(0, 5) || '',
      hora_fin: turno.hora_fin?.slice(0, 5) || '',
      comentario: '',
    })
  }

  const guardarEdicionTurno = async () => {
    if (!turnoEditando || !formEditTurno.comentario.trim()) return
    setEditandoTurno(true)
    try {
      const cambios: Record<string, string | null> = {}
      const snapshot: Record<string, string | null> = {}
      if (formEditTurno.fecha !== turnoEditando.fecha) {
        cambios.fecha = formEditTurno.fecha
        snapshot.fecha = turnoEditando.fecha
      }
      if (formEditTurno.hora_inicio !== turnoEditando.hora_inicio?.slice(0, 5)) {
        cambios.hora_inicio = formEditTurno.hora_inicio + ':00'
        snapshot.hora_inicio = turnoEditando.hora_inicio
      }
      if (formEditTurno.hora_fin !== turnoEditando.hora_fin?.slice(0, 5)) {
        cambios.hora_fin = formEditTurno.hora_fin + ':00'
        snapshot.hora_fin = turnoEditando.hora_fin
      }
      if (Object.keys(cambios).length === 0) { setTurnoEditando(null); return }
      const headers = await headersAdmin()
      const res = await fetch('/api/turnos/editar', {
        method: 'POST',
        headers,
        body: JSON.stringify({ turno_id: turnoEditando.id, cambios, comentario: formEditTurno.comentario.trim(), snapshot }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al editar turno')
      if (result.turno) {
        setTurnos((prev: Turno[]) => prev.map((t: Turno) => t.id === turnoEditando.id ? { ...t, ...result.turno } : t))
      }
      setTurnoEditando(null)
    } catch (e: any) {
      alert(e.message || 'Error al editar turno')
    } finally {
      setEditandoTurno(false)
    }
  }

  // ── Anular turno ──────────────────────────────────────────────────
  const [turnoAnulando, setTurnoAnulando] = useState<Turno | null>(null)
  const [motivoAnulacionTurno, setMotivoAnulacionTurno] = useState('')
  const [anulandoTurno, setAnulandoTurno] = useState(false)

  const anularTurno = async () => {
    if (!turnoAnulando || !motivoAnulacionTurno.trim()) return
    setAnulandoTurno(true)
    try {
      const headers = await headersAdmin()
      const res = await fetch('/api/turnos/editar', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          turno_id: turnoAnulando.id,
          cambios: { estado: 'anulado' },
          comentario: `Anulación: ${motivoAnulacionTurno.trim()}`,
          snapshot: { estado: turnoAnulando.estado },
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Error al anular turno')
      setTurnos((prev: Turno[]) => prev.map((t: Turno) => t.id === turnoAnulando.id ? { ...t, estado: 'anulado' } : t))
      setTurnoAnulando(null)
      setMotivoAnulacionTurno('')
    } catch (e: any) {
      alert(e.message || 'Error al anular turno')
    } finally {
      setAnulandoTurno(false)
    }
  }

  // ── Clasificar día sin programación ─────────────────────────────────
  const [clasificandoDia, setClasificandoDia] = useState<{ fecha: string; empleadoId: string } | null>(null)
  const [tipoNovedadDia, setTipoNovedadDia] = useState('franco')
  const [observacionNovedadDia, setObservacionNovedadDia] = useState('')
  const [guardandoNovedad, setGuardandoNovedad] = useState(false)

  const TIPOS_NOVEDAD = [
    { value: 'franco', label: 'Franco' },
    { value: 'vacaciones', label: 'Vacaciones' },
    { value: 'licencia', label: 'Licencia' },
    { value: 'parte_medico', label: 'Parte médico / Enfermedad' },
    { value: 'accidente', label: 'Accidente' },
    { value: 'falta_justificada', label: 'Falta justificada' },
    { value: 'falta_injustificada', label: 'Falta injustificada' },
    { value: 'dia_estudio', label: 'Día de estudio' },
    { value: 'suspension', label: 'Suspensión' },
    { value: 'otra', label: 'Otra novedad' },
  ] as const

  const guardarClasificacionDia = async () => {
    if (!clasificandoDia) return
    setGuardandoNovedad(true)
    try {
      const { data, error } = await supabase.from('novedades_laborales').insert({
        empleado_id: clasificandoDia.empleadoId,
        tipo: tipoNovedadDia,
        fecha_desde: clasificandoDia.fecha,
        fecha_hasta: clasificandoDia.fecha,
        observacion: observacionNovedadDia.trim() || null,
        cargado_por: user?.id,
        estado: 'aprobada',
        aprobado_por: user?.id,
        aprobado_at: new Date().toISOString(),
      }).select().single()
      if (error) throw error
      if (data) setNovedadesLaborales((prev: any[]) => [...prev, data])
      setClasificandoDia(null)
      setObservacionNovedadDia('')
    } catch (e: any) {
      alert(e.message || 'Error al clasificar día')
    } finally {
      setGuardandoNovedad(false)
    }
  }

  useEffect(() => {
    if (filtroActivo?.mes) setMes(filtroActivo.mes)
  }, [filtroActivo?.mes])

  useEffect(() => {
    const [y, m] = mes.split('-').map(Number)
    const desdeStr = `${mes}-01`
    const ultimoDia = new Date(y, m, 0).getDate()
    const hastaStr = `${mes}-${String(ultimoDia).padStart(2, '0')}`
    const fetchAll = (table: string, select: string, apply: (q: any) => any) =>
      fetchPaginado((desde, hasta) => apply(supabase.from(table).select(select)).range(desde, hasta))
    // Aceptaciones, solicitudes y revisiones son la misma fuente que consume
    // Revisión de planillas. Sin ellas, Diferencias no puede distinguir un turno
    // ya resuelto de uno intacto: los mostraba iguales.
    Promise.all([
      fetchAll('turnos', '*', q => q.gte('fecha', desdeStr).lte('fecha', hastaStr).order('fecha', { ascending: true }).order('id')),
      fetchAll('registros_asistencia', '*,turno:turnos!inner(fecha)', q => q.gte('turno.fecha', desdeStr).lte('turno.fecha', hastaStr).order('created_at', { ascending: false }).order('id')),
      supabase.from('novedades_laborales').select('*').eq('estado', 'aprobada').lte('fecha_desde', hastaStr).gte('fecha_hasta', desdeStr),
      fetchAll('aceptaciones_planilla', 'turno_id, empleado_id, turno:turnos!inner(fecha)', q => q.gte('turno.fecha', desdeStr).lte('turno.fecha', hastaStr).order('turno_id')),
      fetchAll('solicitudes_modificacion_planilla', 'id, turno_id, empleado_id, estado, created_at, turno:turnos!inner(fecha)', q => q.gte('turno.fecha', desdeStr).lte('turno.fecha', hastaStr).order('created_at', { ascending: false }).order('id')),
      fetchAll('revisiones_planilla', 'turno_id, empleado_id, accion, turno:turnos!inner(fecha)', q => q.gte('turno.fecha', desdeStr).lte('turno.fecha', hastaStr).order('turno_id')),
    ]).then(([turnos, registros, nl, acept, soli, revi]) => {
      setTurnosReportes(turnos)
      setRegistrosReportes(registros)
      setNovedadesLaborales(nl.data ?? [])
      setRevisionMes(construirRevisionPorClave(acept, soli, revi))
    })
  }, [mes])

  useEffect(() => {
    if (!empleadoId && empleados.length > 0) setEmpleadoId(empleados[0].id)
  }, [empleadoId, empleados])

  useEffect(() => {
    if (!objetivoId && objetivos.length > 0) setObjetivoId(objetivos[0].id)
  }, [objetivoId, objetivos])

  const descargarXLSX = async (nombreArchivo: string, filas: any[][], headerRowIndex: number, dataRows: number, horasCols: number[]) => {
    const XLSX = await import('xlsx')
    const workbook = XLSX.utils.book_new()
    const worksheet = XLSX.utils.aoa_to_sheet(filas)
    const colCount = Math.max(...filas.map(row => row.length))
    const lastRow = filas.length - 1

    worksheet['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, colCount - 1) } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(0, colCount - 1) } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: Math.max(0, colCount - 1) } },
    ]
    worksheet['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: headerRowIndex, c: 0 },
        e: { r: Math.max(headerRowIndex, headerRowIndex + dataRows), c: Math.max(0, colCount - 1) },
      }),
    }
    ;(worksheet as any)['!freeze'] = { xSplit: 0, ySplit: headerRowIndex + 1 }
    worksheet['!cols'] = Array.from({ length: colCount }, (_, colIndex) => {
      const width = filas.reduce((max, row) => Math.max(max, String(row[colIndex] ?? '').length), 10)
      return { wch: Math.min(Math.max(width + 2, 12), 42) }
    })

    for (let colIndex = 0; colIndex < colCount; colIndex++) {
      const headerRef = XLSX.utils.encode_cell({ r: headerRowIndex, c: colIndex })
      if (worksheet[headerRef]) {
        worksheet[headerRef].s = {
          font: { bold: true, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: '1F2937' } },
          alignment: { horizontal: 'center' },
        }
      }
    }

    for (let rowIndex = headerRowIndex + 1; rowIndex <= lastRow; rowIndex++) {
      horasCols.forEach(colIndex => {
        const ref = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })
        if (worksheet[ref] && typeof worksheet[ref].v === 'number') worksheet[ref].z = '0.00'
      })
    }

    ;[0, 1, 2].forEach(rowIndex => {
      const ref = XLSX.utils.encode_cell({ r: rowIndex, c: 0 })
      if (worksheet[ref]) {
        worksheet[ref].s = {
          font: { bold: rowIndex === 0, sz: rowIndex === 0 ? 16 : 12 },
          alignment: { horizontal: 'left' },
        }
      }
    })

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Planilla')
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: true })
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = nombreArchivo.endsWith('.xlsx') ? nombreArchivo : `${nombreArchivo}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const slug = (value?: string | null) =>
    (value || 'sin-dato').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sin-dato'
  const archivoParte = (value?: string | null) => slug(value).replace(/-/g, '_')
  const mesArchivo = () => {
    const [year, month] = mes.split('-').map(Number)
    const nombreMes = new Date(year, month - 1, 1).toLocaleDateString('es-AR', { month:'long' })
    return `${archivoParte(nombreMes)}_${year}`
  }
  const filtrosReporte = () => {
    const filtros = [`Mes operativo: ${mesLabel}`]
    if (tab === 'guardias' || tab === 'objetivos') filtros.push(verTodos ? 'Incluye registros sin actividad' : 'Solo registros con actividad')
    if (filtroActivo?.label) filtros.push(`Filtro activo: ${filtroActivo.label}`)
    return `Filtros: ${filtros.join(' · ')}`
  }

  const desde = `${mes}-01`
  const hasta = (() => {
    const [year, month] = mes.split('-').map(Number)
    const next = new Date(year, month, 1)
    return next.toLocaleDateString('sv-SE')
  })()
  const mesLabel = (() => {
    const [year, month] = mes.split('-').map(Number)
    return new Date(year, month - 1, 1).toLocaleDateString('es-AR', { month:'long', year:'numeric' })
  })()
  const turnosMes = [...turnosReportes]
    .sort((a: Turno, b: Turno) => `${a.fecha} ${a.hora_inicio}`.localeCompare(`${b.fecha} ${b.hora_inicio}`))
  const turnoPorId = new Map<string, Turno>(turnosMes.map((t: Turno) => [t.id, t]))
  const objetivoPorIdPlanilla = new Map<string, Objetivo>(objetivos.map((o: Objetivo) => [o.id, o]))
  const registrosMes = registrosReportes.filter((r: RegistroAsistencia) => Boolean(turnoPorId.get(r.turno_id)))
  const registrosPorTurno = new Map<string, RegistroAsistencia[]>()
  registrosMes.forEach((r: RegistroAsistencia) => {
    registrosPorTurno.set(r.turno_id, [...(registrosPorTurno.get(r.turno_id) || []), r])
  })

  const empleadoSeleccionado = empleados.find((g: Usuario) => g.id === empleadoId)
  const objetivoSeleccionado = objetivos.find((o: Objetivo) => o.id === objetivoId)
  const nombreGuardia = (id?: string | null) => {
    const guardia = guardias.find((g: Usuario) => g.id === id)
    return guardia ? `${guardia.apellido}, ${guardia.nombre}` : 'Sin guardia'
  }
  const nombreObjetivo = (id?: string | null) => objetivos.find((o: Objetivo) => o.id === id)?.nombre || 'Sin objetivo'
  const diaSemana = (fecha?: string | null) => {
    if (!fecha) return '—'
    const [year, month, day] = fecha.slice(0, 10).split('-').map(Number)
    const dia = new Date(year, month - 1, day).toLocaleDateString('es-AR', { weekday:'long' })
    return dia.charAt(0).toUpperCase() + dia.slice(1)
  }
  const fechaHoraMs = (fecha?: string | null, hora?: string | null) => {
    if (!fecha || !hora) return null
    const [year, month, day] = fecha.slice(0, 10).split('-').map(Number)
    const [hours, minutes] = hora.split(':').map(Number)
    if (!year || !month || !day || !Number.isFinite(hours) || !Number.isFinite(minutes)) return null
    return new Date(year, month - 1, day, hours, minutes).getTime()
  }
  const pasoVentanaFichaje = (turno: Turno) => {
    const inicio = fechaHoraMs(turno.fecha, turno.hora_inicio)
    return inicio === null ? false : Date.now() > inicio + 60 * 60000
  }
  const registroPrincipal = (turno: Turno, guardiaId?: string | null) =>
    selectRegistroPrincipal(registrosPorTurno.get(turno.id) || [], guardiaId)
  const estadoPlanilla = (turno: Turno, registro?: RegistroAsistencia) => {
    if (!turno.guardia_id) return 'Descubierto'
    if (!registro || !registroTieneEntradaConfirmada(registro)) return pasoVentanaFichaje(turno) ? 'Sin fichar' : 'Programado'
    if (registro.tipo_registro === 'carga_manual') return 'Manual'
    const horaEntrada = registro.hora_entrada_final ?? registro.hora_entrada_real
    if (horaEntrada && calcularMinutosTardanzaRegistro(turno, registro) > 0) return 'Tarde'
    if (horaEntrada && !(registro.hora_salida_final ?? registro.hora_salida_real)) return 'En curso'
    return 'Cubierto'
  }
  const observacionesPlanilla = (turno: Turno, registro?: RegistroAsistencia, extra?: string | null) => {
    const obs: string[] = []
    if (!turno.guardia_id) obs.push('Descubierto')
    if (registro?.tipo_registro === 'carga_manual') obs.push((registro as any)?.origen === 'reporte' ? 'Carga manual (desde reporte)' : 'Carga manual')
    if (turno.guardia_id && !registroTieneEntradaConfirmada(registro ?? {}) && pasoVentanaFichaje(turno)) obs.push('Sin fichar')
    if (registro?.hora_entrada_real && !registro.hora_salida_real) obs.push('En curso')
    if (turno && registro && calcularMinutosTardanzaRegistro(turno, registro) > 0) obs.push('Llegada tarde')
    if (registro?.alerta_entrada === 'anticipada') obs.push('Entrada anticipada')
    if (registro?.alerta_salida === 'anticipada') obs.push('Salida anticipada')
    if (registro?.alerta_salida === 'posterior') obs.push('Salida posterior')
    if (registro?.gps_ingreso_estado === 'fuera_radio') obs.push('GPS fuera del radio')
    if (registro?.observacion) obs.push(registro.observacion)
    if (extra) obs.push(extra)
    return obs.length ? obs.join(' | ') : '—'
  }
  const mostrarHoras = (value: number) => value > 0 ? value.toFixed(2) : '—'

  const turnosEmpleado = empleadoSeleccionado ? turnosMes.filter((t: Turno) => {
    const guardiaOriginal = (t as any).guardia_original_id
    const guardiaReal = (t as any).guardia_real_id
    const tieneRegistro = (registrosPorTurno.get(t.id) || []).some((r: RegistroAsistencia) => effectiveGuardia(r) === empleadoSeleccionado.id)
    return t.guardia_id === empleadoSeleccionado.id || guardiaOriginal === empleadoSeleccionado.id || guardiaReal === empleadoSeleccionado.id || tieneRegistro
  }) : []

  const planillaEmpleado = turnosEmpleado.map((turno: Turno) => {
    const registro = empleadoSeleccionado ? registroPrincipal(turno, empleadoSeleccionado.id) : undefined
    const registroOtroGuardia = !registro ? registroPrincipal(turno) : undefined
    const { horasReales, horasLiquidables, horaEntrada: horaEntradaMostrar, horaSalida: horaSalidaMostrar, objetivoEfectivoId, origenEtiqueta: origenEtiquetaEmpleado } = resolverLineaLiquidacion(turno, registro)
    const objetivo = objetivos.find((o: Objetivo) => o.id === objetivoEfectivoId)
    const guardiaOtro = registroOtroGuardia ? effectiveGuardia(registroOtroGuardia) : null
    const extra = guardiaOtro && guardiaOtro !== empleadoSeleccionado?.id
      ? `Ficho otro guardia: ${nombreGuardia(guardiaOtro)}`
      : null
    const estado = estadoPlanilla(turno, registro)
    const tieneEntrada = registro ? registroTieneEntradaConfirmada(registro) : false

    return {
      Fecha: formatFecha(turno.fecha),
      Día: diaSemana(turno.fecha),
      Objetivo: objetivo?.nombre || '—',
      'Horario programado': formatHorarioAsignado(turno),
      'Entrada real': horaEntradaMostrar ? formatHoraTurno(horaEntradaMostrar) : '—',
      'Salida real': horaSalidaMostrar ? formatHoraTurno(horaSalidaMostrar) : '—',
      'Horas reales': mostrarHoras(horasReales),
      'Horas liquidables': mostrarHoras(horasLiquidables),
      Característica: etiquetaCaracteristica(turno.tipo_evento),
      Estado: estado,
      'Observaciones / alertas': observacionesPlanilla(turno, registro, extra),
      'GPS ingreso': coordenadasGpsTexto(registro, 'ingreso'),
      'Distancia ingreso': metrosGpsTexto(registro?.distancia_ingreso_metros),
      'Estado GPS ingreso': estadoGpsTexto(registro, 'ingreso'),
      Origen: origenEtiquetaEmpleado,
      _id: `${turno.id}-${registro?.id || 'sin-registro'}`,
      _turno_id: turno.id,
      _registro: registro || null,
      _fecha: turno.fecha,
      _horasReales: horasReales,
      _horasLiquidables: horasLiquidables,
      // Al vigilador SÍ se le pagan: suman en su total. Se marcan igual, porque
      // su planilla y la del objetivo van a dar distinto sobre los mismos turnos.
      _capacitacion: esCapacitacion(turno.tipo_evento),
      _tieneEntrada: tieneEntrada,
      _tieneCobertura: tieneEntrada || horasLiquidables > 0,
      _sinFichar: !tieneEntrada && horasLiquidables === 0 && Boolean(turno.guardia_id) && pasoVentanaFichaje(turno),
      _enCurso: Boolean(registro?.hora_entrada_real && !registro?.hora_salida_real),
      _tarde: tieneEntrada && calcularMinutosTardanzaRegistro(turno, registro) > 0,
      _estadoCalendario: 'trabajado' as string,
    }
  })

  // Calendario completo: agregar días sin turno
  if (empleadoSeleccionado) {
    const [aY, aM] = mes.split('-').map(Number)
    const ultimoDiaMes = new Date(aY, aM, 0).getDate()
    const fechasConTurno = new Set(planillaEmpleado.map((row: any) => row._fecha))

    const novedadesEmpleado = novedadesLaborales.filter((n: any) => n.empleado_id === empleadoSeleccionado.id)
    const novedadParaFecha = (fechaStr: string): any | null => {
      return novedadesEmpleado.find((n: any) => n.fecha_desde <= fechaStr && n.fecha_hasta >= fechaStr) ?? null
    }
    const labelNovedad = (tipo: string): string => {
      const labels: Record<string, string> = {
        franco: 'Franco',
        vacaciones: 'Vacaciones',
        licencia: 'Licencia',
        parte_medico: 'Parte médico',
        accidente: 'Accidente',
        falta_justificada: 'Falta justificada',
        falta_injustificada: 'Falta injustificada',
        dia_estudio: 'Día de estudio',
        suspension: 'Suspensión',
        otra: 'Otra novedad',
      }
      return labels[tipo] || tipo
    }

    for (let d = 1; d <= ultimoDiaMes; d++) {
      const fechaStr = `${mes}-${String(d).padStart(2, '0')}`
      if (fechasConTurno.has(fechaStr)) continue

      const novedad = novedadParaFecha(fechaStr)
      const estadoCal = novedad ? 'novedad' : 'sin_programacion'
      const estadoLabel = novedad ? labelNovedad(novedad.tipo) : 'Sin programación'

      planillaEmpleado.push({
        Fecha: formatFecha(fechaStr),
        Día: diaSemana(fechaStr),
        Objetivo: '—',
        'Horario programado': '—',
        'Entrada real': '—',
        'Salida real': '—',
        'Horas reales': '—',
        'Horas liquidables': '—',
        Característica: '—',
        Estado: estadoLabel,
        'Observaciones / alertas': novedad?.observacion || '—',
        'GPS ingreso': '—',
        'Distancia ingreso': '—',
        'Estado GPS ingreso': '—',
        Origen: '',
        _id: `cal-${fechaStr}`,
        _turno_id: null,
        _registro: null,
        _fecha: fechaStr,
        _horasReales: 0,
        _horasLiquidables: 0,
        _tieneEntrada: false,
        _tieneCobertura: false,
        _sinFichar: false,
        _enCurso: false,
        _tarde: false,
        _estadoCalendario: estadoCal,
      })
    }

    planillaEmpleado.sort((a: any, b: any) => {
      const fa = a._fecha || ''
      const fb = b._fecha || ''
      return fa.localeCompare(fb)
    })
  }

  const capacitacionEmpleado = planillaEmpleado
    .filter((row: any) => row._capacitacion)
    .reduce((acc: { horas: number; turnos: number }, row: any) => (
      { horas: acc.horas + (row._horasLiquidables || 0), turnos: acc.turnos + 1 }
    ), { horas: 0, turnos: 0 })

  const totalesEmpleado = {
    dias: new Set(planillaEmpleado.filter((row: any) => row._tieneCobertura).map((row: any) => row._fecha)).size,
    horasReales: planillaEmpleado.reduce((sum: number, row: any) => sum + row._horasReales, 0),
    // Al vigilador se le paga todo lo que trabajó, capacitación incluida.
    horasLiquidables: planillaEmpleado.reduce((sum: number, row: any) => sum + row._horasLiquidables, 0),
    horasCapacitacion: capacitacionEmpleado.horas,
    turnosCapacitacion: capacitacionEmpleado.turnos,
    sinFichar: planillaEmpleado.filter((row: any) => row._sinFichar).length,
    enCurso: planillaEmpleado.filter((row: any) => row._enCurso).length,
    tardanzas: planillaEmpleado.filter((row: any) => row._tarde).length,
  }

  // Planilla por objetivo: una fila por registro (no por turno).
  // Si dos guardias cubrieron el mismo turno, aparecen dos filas.
  // Los turnos sin registro (descubiertos / sin fichar) agregan una fila vacía.
  const registrosObjetivo = objetivoId
    ? registrosMes.filter((r: RegistroAsistencia) =>
        (r.objetivo_final_id ?? turnoPorId.get(r.turno_id)?.objetivo_id) === objetivoId)
    : []
  const turnosConRegistroObj = new Set(registrosObjetivo.map((r: RegistroAsistencia) => r.turno_id))
  const turnosSinRegistroObj = objetivoId
    ? turnosMes.filter((t: Turno) => t.objetivo_id === objetivoId && !turnosConRegistroObj.has(t.id))
    : []

  const filasConRegistro = registrosObjetivo.map((registro: RegistroAsistencia) => {
    const turno = turnoPorId.get(registro.turno_id)
    if (!turno) return null
    const { horasReales, horasLiquidables, horaEntrada: horaEntradaMostrar, horaSalida: horaSalidaMostrar, origenEtiqueta: origenEtiquetaObj } = resolverLineaLiquidacion(turno, registro)
    const estado = estadoPlanilla(turno, registro)
    const guardiaQueFicho = effectiveGuardia(registro)
    return {
      Fecha: formatFecha(turno.fecha),
      Día: diaSemana(turno.fecha),
      'Horario programado': formatHorarioAsignado(turno),
      'Guardia asignado': turno.guardia_id ? nombreGuardia(turno.guardia_id) : 'Sin asignar',
      'Guardia que fichó': guardiaQueFicho ? nombreGuardia(guardiaQueFicho) : '—',
      'Entrada efectiva': horaEntradaMostrar ? formatHoraTurno(horaEntradaMostrar) : '—',
      'Salida efectiva': horaSalidaMostrar ? formatHoraTurno(horaSalidaMostrar) : '—',
      'Horas reales': mostrarHoras(horasReales),
      'Horas liquidables': mostrarHoras(horasLiquidables),
      Característica: etiquetaCaracteristica(turno.tipo_evento),
      Origen: origenEtiquetaObj,
      Estado: estado,
      'Observaciones / alertas': observacionesPlanilla(turno, registro),
      'GPS ingreso': coordenadasGpsTexto(registro, 'ingreso'),
      'Distancia ingreso': metrosGpsTexto(registro?.distancia_ingreso_metros),
      'Estado GPS ingreso': estadoGpsTexto(registro, 'ingreso'),
      _id: `${turno.id}-${registro.id}`,
      _turno_id: turno.id,
      _registro: registro,
      _fecha: turno.fecha,
      _horaInicio: turno.hora_inicio,
      _horasReales: horasReales,
      _horasLiquidables: horasLiquidables,
      _capacitacion: esCapacitacion(turno.tipo_evento),
      _cubierto: Boolean(registro.hora_entrada_real && (registro.hora_salida_final ?? registro.hora_salida_real)),
      _sinFichar: false,
      _descubierto: false,
      _enCurso: Boolean(registro.hora_entrada_real && !(registro.hora_salida_final ?? registro.hora_salida_real)),
    }
  }).filter(Boolean) as any[]

  const filasVacias = turnosSinRegistroObj.map((turno: Turno) => {
    const esTransicion = turno.estado === 'cubierto' && esPeriodoTransicion(turno.fecha)
    const horasLiquidables = esTransicion ? horasProgramadasTurno(turno) : 0
    const estado = esTransicion ? 'Cubierto' : estadoPlanilla(turno, undefined)
    return {
      Fecha: formatFecha(turno.fecha),
      Día: diaSemana(turno.fecha),
      'Horario programado': formatHorarioAsignado(turno),
      'Guardia asignado': turno.guardia_id ? nombreGuardia(turno.guardia_id) : 'Sin asignar',
      'Guardia que fichó': '—',
      'Entrada efectiva': '—',
      'Salida efectiva': '—',
      'Horas reales': '—',
      'Horas liquidables': esTransicion ? mostrarHoras(horasLiquidables) : '—',
      Característica: etiquetaCaracteristica(turno.tipo_evento),
      Estado: estado,
      'Observaciones / alertas': esTransicion ? 'Turno cubierto (período de transición)' : observacionesPlanilla(turno, undefined),
      'GPS ingreso': '—',
      'Distancia ingreso': '—',
      'Estado GPS ingreso': '—',
      Origen: esTransicion ? 'Turno cubierto (sin fichaje)' : '—',
      _id: `${turno.id}-sin-registro`,
      _turno_id: turno.id,
      _registro: null,
      _fecha: turno.fecha,
      _horaInicio: turno.hora_inicio,
      _horasReales: 0,
      _horasLiquidables: horasLiquidables,
      _capacitacion: esCapacitacion(turno.tipo_evento),
      _cubierto: esTransicion,
      _sinFichar: !esTransicion && Boolean(turno.guardia_id) && pasoVentanaFichaje(turno),
      // Un objetivo pausado no genera obligacion de cobertura: no hay puesto
      // descubierto que marcar en la planilla.
      _descubierto: !esTransicion && turnoSinCoberturaOperativa(turno)
        && objetivoEstaOperativo(objetivoPorIdPlanilla.get(turno.objetivo_id)),
      _enCurso: false,
    }
  })

  const planillaObjetivo = [...filasConRegistro, ...filasVacias]
    .sort((a: any, b: any) =>
      a._fecha.localeCompare(b._fecha) || a._horaInicio.localeCompare(b._horaInicio))

  // Para totales de horas: deduplicar por turno antes de sumar
  const registrosObjetivoDedup = (() => {
    const porTurno = new Map<string, RegistroAsistencia[]>()
    for (const r of registrosObjetivo) {
      const arr = porTurno.get(r.turno_id) ?? []
      arr.push(r)
      porTurno.set(r.turno_id, arr)
    }
    // Case 4: un turno puede tener varios guardias (A + B) → un principal por (turno, guardia)
    const result: RegistroAsistencia[] = []
    for (const rs of porTurno.values()) {
      const porGuardia = new Map<string, RegistroAsistencia[]>()
      for (const r of rs) {
        const gId = effectiveGuardia(r) ?? '__'
        const arr = porGuardia.get(gId) ?? []
        arr.push(r)
        porGuardia.set(gId, arr)
      }
      for (const gRegs of porGuardia.values()) {
        const p = selectRegistroPrincipal(gRegs)
        if (p) result.push(p)
      }
    }
    return result
  })()

  // Lo que se descontó del total del objetivo. Se cuenta por turno —no por
  // fila— porque un mismo turno puede aparecer dos veces si lo cubrieron dos
  // vigiladores, y no son dos capacitaciones.
  const capacitacionObjetivo = (() => {
    const turnos = new Set<string>()
    let horas = 0
    for (const row of planillaObjetivo as any[]) {
      if (!row._capacitacion) continue
      turnos.add(row._turno_id)
      horas += row._horasLiquidables || 0
    }
    return { horas, turnos: turnos.size }
  })()

  const totalesObjetivo = {
    total: new Set(planillaObjetivo.map((row: any) => row._turno_id)).size,
    cubiertos: planillaObjetivo.filter((row: any) => row._cubierto).length,
    sinFichar: planillaObjetivo.filter((row: any) => row._sinFichar).length,
    descubiertos: planillaObjetivo.filter((row: any) => row._descubierto).length,
    enCurso: planillaObjetivo.filter((row: any) => row._enCurso).length,
    horasReales: registrosObjetivoDedup.reduce((sum: number, r: RegistroAsistencia) => sum + Math.max(0, Number(r.horas_trabajadas) || 0), 0),
    // Capacitación: se paga al vigilador pero no se cobra al objetivo
    horasLiquidables: planillaObjetivo.reduce((sum: number, row: any) => row._capacitacion ? sum : sum + (row._horasLiquidables || 0), 0),
    horasCapacitacion: capacitacionObjetivo.horas,
    turnosCapacitacion: capacitacionObjetivo.turnos,
  }

  // Totales globales del mes. El universo lo define `lib/liquidacion`, el mismo
  // que usa el Dashboard para "Horas trabajadas mes": deduplicado por turno,
  // sin ausencias ni objetivos es_prueba, y con las coberturas manuales y el
  // saneamiento incluidos (traen horas_liquidables aunque no tengan GPS).
  const _esObjetivoPruebaReportes = (objetivoId?: string | null) =>
    Boolean(objetivos.find((o: Objetivo) => o.id === objetivoId)?.es_prueba)
  const _mejorRegistroPorTurnoReportes = mejorRegistroPorTurno(
    registrosMes,
    turnoPorId,
    _esObjetivoPruebaReportes,
  )
  const hoyISO = fechaCorteOperativa()
  const turnosBaseMes = turnosReconocidosHastaCorte(turnosMes, _mejorRegistroPorTurnoReportes, {
    hastaFecha: hoyISO,
    esObjetivoPrueba: _esObjetivoPruebaReportes,
  })
  // ── Las cinco métricas del mes ─────────────────────────────────────────────
  //
  // Son CINCO conceptos distintos y no hay que forzarlos a cerrar entre sí.
  // En particular, NO vale que reconocidas + pendiente = exigibles: las
  // reconocidas incluyen horas de turnos que todavía no terminaron y
  // extensiones reales por encima de lo programado. La única reconciliación
  // exacta es la del pendiente, turno por turno sobre el universo exigible.

  // 1. Todo lo operativamente válido del mes, esté asignado o no.
  const turnosOperativosMes = turnosOperativosDelMes(turnosMes, {
    esObjetivoPrueba: _esObjetivoPruebaReportes,
  })
  const totalHsProgramadasMesCompleto = turnosOperativosMes
    .reduce((s: number, t: Turno) => s + horasProgramadasTurno(t), 0)

  // 2. De eso, lo que ya tiene vigilador. Es una métrica de PROGRAMACIÓN, no de
  //    asistencia: un turno futuro con vigilador asignado cuenta.
  const turnosAsignadosMes = turnosOperativosMes.filter((t: Turno) => Boolean(t.guardia_id))
  const totalHsAsignadasMes = turnosAsignadosMes
    .reduce((s: number, t: Turno) => s + horasProgramadasTurno(t), 0)
  const totalHsSinAsignar = totalHsProgramadasMesCompleto - totalHsAsignadasMes

  // 3. Lo que ya terminó: el universo sobre el que se puede reclamar.
  const turnosExigibles = turnosExigiblesHastaAhora(turnosMes, {
    esObjetivoPrueba: _esObjetivoPruebaReportes,
  })
  const totalHsExigibles = turnosExigibles
    .reduce((s: number, t: Turno) => s + horasProgramadasTurno(t), 0)

  // 4. Horas de trabajo efectivamente reconocidas. Va sobre el universo
  //    autoritativo de siempre —el mismo que usa el Panel Principal— y NO sobre
  //    el exigible: si alguien fichó salida a las 15:00 de un turno que termina
  //    a las 16:00, esas horas ya están reconocidas y tienen que contarse.
  //    Atarlo al universo exigible hacía que las dos pantallas mostraran
  //    números distintos para el mismo concepto.
  const totalHsLiquidablesMes = totalHorasLiquidables(turnosBaseMes, _mejorRegistroPorTurnoReportes)

  // 5. Pendiente turno por turno, sin compensar entre turnos. Es lo único que
  //    reconcilia exacto con el detalle.
  const totalHsPendiente = totalPendiente(turnosExigibles, _mejorRegistroPorTurnoReportes)

  // Lo que queda por delante, para leer la tarjeta de exigibles en contexto.
  const ahoraMs = Date.now()
  const hsNoExigiblesAun = turnosOperativosMes
    .filter((t: Turno) => !turnoExigible(t, ahoraMs))
    .reduce((s: number, t: Turno) => s + horasProgramadasTurno(t), 0)

  // Capacitación del mes COMPLETO: es carga pagable y por eso entra en el
  // total, pero no se le factura al objetivo. Va identificada aparte en la
  // tarjeta para que nadie la sume a lo cobrable.
  const capacitacionMesCompleto = turnosOperativosMes.reduce(
    (acc: { horas: number; turnos: number }, t: Turno) => {
      if (!esCapacitacion(t.tipo_evento)) return acc
      return { horas: acc.horas + horasProgramadasTurno(t), turnos: acc.turnos + 1 }
    },
    { horas: 0, turnos: 0 },
  )

  // La misma capacitación, pero sólo la ya reconocida: es la que explica por
  // qué el total liquidable y lo facturable al objetivo no coinciden.
  // Capacitación ya reconocida: mismo universo que la tarjeta de reconocidas.
  const capacitacionMes = turnosBaseMes.reduce(
    (acc: { horas: number; turnos: number }, t: Turno) => {
      if (!esCapacitacion(t.tipo_evento)) return acc
      const reg = _mejorRegistroPorTurnoReportes.get(t.id) ?? null
      return {
        horas: acc.horas + resolverLineaLiquidacion(t, reg).horasLiquidables,
        turnos: acc.turnos + 1,
      }
    },
    { horas: 0, turnos: 0 },
  )

  const diferenciasMes = turnosExigibles
    .map((t: Turno) => {
      const reg = _mejorRegistroPorTurnoReportes.get(t.id) ?? null
      const linea = resolverLineaLiquidacion(t, reg)
      const hsProg = horasProgramadasTurno(t)
      const hsLiq = linea.horasLiquidables
      const diff = hsLiq - hsProg
      // Lo que aporta a la tarjeta. Nunca negativo: un turno extendido —el
      // vigilador se quedó porque no llegó el relevo— genera horas que
      // corresponden, pero no compensan las que faltan en otro turno.
      const pendienteHs = Math.max(hsProg - hsLiq, 0)
      if (Math.abs(diff) < 0.01) return null
      let motivo = ''
      if (!reg) motivo = esPeriodoTransicion(t.fecha) ? 'Turno cubierto sin fichaje (transición)' : 'Sin registro de asistencia'
      else if (reg.cobertura_anulada_at) motivo = 'Cobertura anulada'
      else if (linea.origenRegistro === 'saneamiento') motivo = 'Saneamiento histórico'
      else if (linea.origenRegistro === 'corregido') motivo = 'Horario corregido manualmente'
      else if (linea.origenRegistro === 'supervisor') motivo = 'Carga de supervisor'
      else if (linea.origenRegistro === 'administracion') motivo = 'Carga de administración'
      else if (linea.origenRegistro === 'cierre_automatico') motivo = 'Cierre automático'
      else if (reg.horas_liquidables != null) motivo = 'Horas liquidables ajustadas'
      else if (reg.hora_entrada_final || reg.hora_salida_final) motivo = 'Tiempos corregidos'
      else motivo = 'Requiere revisión'
      // Una diferencia de horas dice QUÉ pasó; el estado de revisión dice si
      // alguien todavía tiene que hacer algo. Son dos preguntas distintas y
      // antes acá sólo se respondía la primera: un turno ya revisado o derivado
      // se veía igual que uno intacto.
      const empleadoId = effectiveGuardia(reg) ?? t.guardia_id
      const revision = (empleadoId ? revisionMes.get(claveRevision(t.id, empleadoId)) : null) ?? REVISION_SIN_TOCAR
      const estado = estadoRevision(revision)
      return {
        turno: t,
        registro: reg,
        linea,
        hsProg,
        hsLiq,
        diff,
        pendienteHs,
        motivo,
        estado,
        pendiente: esPendienteDeAccion(estado),
        observaciones: revision.observaciones,
        guardiaId: t.guardia_id,
        objetivoId: t.objetivo_id,
      }
    })
    .filter(Boolean) as Array<{
      turno: Turno; registro: any; linea: any;
      hsProg: number; hsLiq: number; diff: number; pendienteHs: number; motivo: string;
      estado: EstadoRevision; pendiente: boolean; observaciones: number;
      guardiaId: string | null; objetivoId: string | null;
    }>

  // Los que EXPLICAN la tarjeta: los que aportan horas al pendiente. Es el
  // filtro con el que abre el detalle, para que lo que se ve sume exactamente
  // lo que dice la tarjeta. Un turno extendido tiene diferencia pero aporta
  // cero, así que no explica nada: se ve apagando el filtro.
  const diferenciasQueExplican = diferenciasMes.filter(d => d.pendienteHs > 0)
  const diferenciasVisibles = difSoloPendientes ? diferenciasQueExplican : diferenciasMes
  // Cuántas de esas todavía esperan una acción humana (estado de revisión).
  const diferenciasPendientes = diferenciasQueExplican.filter(d => d.pendiente)

  const exportarPlanillaEmpleadoXLSX = async () => {
    if (!empleadoSeleccionado || planillaEmpleado.length === 0) return

    const columnas = ['Fecha', 'Día', 'Objetivo', 'Horario programado', 'Entrada real', 'Salida real', 'Horas reales', 'Horas liquidables', 'Estado', 'Origen', 'GPS ingreso', 'Distancia ingreso', 'Estado GPS ingreso']
    const filas = [
      ['Planilla individual por empleado'],
      [`Mes/Año: ${mesLabel}`],
      [`Empleado: ${empleadoSeleccionado.apellido}, ${empleadoSeleccionado.nombre} · Legajo: ${empleadoSeleccionado.cuil ? formatCuil(empleadoSeleccionado.cuil) : (empleadoSeleccionado.legajo || '—')}`],
      [],
      columnas,
      ...planillaEmpleado.map((row: any) => [
        row.Fecha,
        row.Día,
        row.Objetivo,
        row['Horario programado'],
        row['Entrada real'],
        row['Salida real'],
        Number(row._horasReales.toFixed(2)),
        Number(row._horasLiquidables.toFixed(2)),
        row.Estado,
        row.Origen,
        row['GPS ingreso'],
        row['Distancia ingreso'],
        row['Estado GPS ingreso'],
      ]),
      [],
      ['Totales'],
      ['Días trabajados', totalesEmpleado.dias],
      ['Horas reales totales', Number(totalesEmpleado.horasReales.toFixed(2))],
      ['Horas liquidables totales', Number(totalesEmpleado.horasLiquidables.toFixed(2))],
      // La misma aclaración que en pantalla: el Excel viaja solo y tiene que
      // explicar por qué este total no coincide con el de la planilla del objetivo.
      ...(notaCapacitacionIncluida(totalesEmpleado.horasCapacitacion, totalesEmpleado.turnosCapacitacion)
        ? [
            ['Horas de capacitación', Number(totalesEmpleado.horasCapacitacion.toFixed(2))],
            [notaCapacitacionIncluida(totalesEmpleado.horasCapacitacion, totalesEmpleado.turnosCapacitacion)],
          ]
        : []),
      ['Tardanzas', totalesEmpleado.tardanzas],
      ['Turnos sin fichar', totalesEmpleado.sinFichar],
    ]
    const nombre = `empleado_${archivoParte(`${empleadoSeleccionado.apellido}_${empleadoSeleccionado.nombre}`)}_${mesArchivo()}.xlsx`

    await descargarXLSX(nombre, filas, 4, planillaEmpleado.length, [6, 7, 1, 9])
  }

  const exportarPlanillaObjetivoXLSX = async () => {
    if (!objetivoSeleccionado || planillaObjetivo.length === 0) return

    const columnas = ['Fecha', 'Guardia', 'Horario programado', 'Entrada efectiva', 'Salida efectiva', 'Horas reales', 'Horas liquidables', 'Estado', 'Origen', 'GPS ingreso', 'Distancia ingreso', 'Estado GPS ingreso']
    const filas = [
      ['Planilla mensual por objetivo'],
      [`Mes/Año: ${mesLabel}`],
      [`Objetivo: ${objetivoSeleccionado.nombre}`],
      [],
      columnas,
      ...planillaObjetivo.map((row: any) => [
        row.Fecha,
        row['Guardia que fichó'] !== '—' ? row['Guardia que fichó'] : row['Guardia asignado'],
        row['Horario programado'],
        row['Entrada efectiva'],
        row['Salida efectiva'],
        Number(row._horasReales.toFixed(2)),
        Number(row._horasLiquidables.toFixed(2)),
        row.Estado,
        row.Origen,
        row['GPS ingreso'],
        row['Distancia ingreso'],
        row['Estado GPS ingreso'],
      ]),
      [],
      ['Totales'],
      ['Turnos totales', totalesObjetivo.total],
      ['Turnos cubiertos', totalesObjetivo.cubiertos],
      ['Turnos descubiertos', totalesObjetivo.descubiertos],
      ['Horas reales totales', Number(totalesObjetivo.horasReales.toFixed(2))],
      ['Horas liquidables totales', Number(totalesObjetivo.horasLiquidables.toFixed(2))],
      // Este Excel es el que puede terminar frente al cliente: si la columna
      // "Horas liquidables" suma más que el total, tiene que decir por qué.
      ...(notaCapacitacionExcluida(totalesObjetivo.horasCapacitacion, totalesObjetivo.turnosCapacitacion)
        ? [
            ['Horas de capacitación (no facturables)', Number(totalesObjetivo.horasCapacitacion.toFixed(2))],
            [notaCapacitacionExcluida(totalesObjetivo.horasCapacitacion, totalesObjetivo.turnosCapacitacion)],
          ]
        : []),
    ]
    const nombre = `objetivo_${archivoParte(objetivoSeleccionado.nombre)}_${mesArchivo()}.xlsx`

    await descargarXLSX(nombre, filas, 4, planillaObjetivo.length, [5, 6, 1, 8])
  }

  // Turnos que tienen algún registro de asistencia (de cualquier guardia)
  const turnosConCualquierRegistro = new Set(registrosMes.map((r: RegistroAsistencia) => r.turno_id))

  const reporteGuardias = guardias
    .map((g: Usuario) => {
      const regs = registrosMes.filter((r: RegistroAsistencia) => effectiveGuardia(r) === g.id)
      // Dedup: un registro principal por turno para sumar horas sin duplicar
      const porTurnoG = new Map<string, RegistroAsistencia[]>()
      for (const r of regs) {
        const arr = porTurnoG.get(r.turno_id) ?? []
        arr.push(r)
        porTurnoG.set(r.turno_id, arr)
      }
      const principalesG = [...porTurnoG.values()]
        .map(rs => selectRegistroPrincipal(rs, g.id))
        .filter(Boolean) as RegistroAsistencia[]

      // Transición jun/jul 2026: turnos cubiertos del mes sin ningún registro de asistencia
      // (de cualquier guardia — si existe un registro, la jerarquía admin > supervisor > registro aplica)
      const turnosFallback = turnosMes.filter((t: Turno) =>
        t.guardia_id === g.id &&
        t.estado === 'cubierto' &&
        esPeriodoTransicion(t.fecha) &&
        !turnosConCualquierRegistro.has(t.id)
      )

      const diasConRegistro = new Set(principalesG.map((r) => turnoPorId.get(r.turno_id)?.fecha).filter(Boolean))
      const dias = new Set([...diasConRegistro, ...turnosFallback.map((t: Turno) => t.fecha)]).size

      const horasReales = principalesG.reduce((s: number, r: RegistroAsistencia) => s + Math.max(0, Number(r.horas_trabajadas) || 0), 0)

      const horasLiquidablesConRegistro = principalesG.reduce((s: number, r: RegistroAsistencia) => {
        const turno = turnoPorId.get(r.turno_id)
        return turno ? s + horasLiquidablesRegistro(turno, r) : s
      }, 0)
      const horasLiquidablesFallback = turnosFallback.reduce((s: number, t: Turno) => s + horasProgramadasTurno(t), 0)
      const horasLiquidables = horasLiquidablesConRegistro + horasLiquidablesFallback

      return {
        Legajo: g.cuil ? formatCuil(g.cuil) : (g.legajo || '—'),
        Apellido: g.apellido,
        Nombre: g.nombre,
        'Días Trabajados': dias,
        'Horas Totales': horasReales.toFixed(2),
        'Horas Reales': horasReales.toFixed(2),
        'Horas Liquidables': horasLiquidables.toFixed(2),
        'En Curso': regs.filter((r: RegistroAsistencia) => r.hora_entrada_real && !r.hora_salida_real).length,
        Tardanzas: regs.filter((r: RegistroAsistencia) => r.alerta_entrada === 'tarde').length,
        'Salidas Anticipadas': regs.filter((r: RegistroAsistencia) => r.alerta_salida === 'anticipada').length,
        _registros: regs.length,
        _fallback: turnosFallback.length,
      }
    })
    .filter((g: any) => verTodos || g._registros > 0 || g._fallback > 0)

  const reporteObjetivos = objetivos
    .map((o: Objetivo) => {
      const ts = turnosMes.filter((t: Turno) => t.objetivo_id === o.id)
      const regs = registrosMes.filter((r: RegistroAsistencia) => (r.objetivo_final_id ?? turnoPorId.get(r.turno_id)?.objetivo_id) === o.id)
      // Dedup: un registro principal por turno; incluye coberturas sin hora_salida
      const porTurnoO = new Map<string, RegistroAsistencia[]>()
      for (const r of regs) {
        const arr = porTurnoO.get(r.turno_id) ?? []
        arr.push(r)
        porTurnoO.set(r.turno_id, arr)
      }
      // Case 4: un turno puede tener varios guardias (A + B) → un principal por (turno, guardia)
      const principalesO: RegistroAsistencia[] = []
      for (const rs of porTurnoO.values()) {
        const porGuardiaO = new Map<string, RegistroAsistencia[]>()
        for (const r of rs) {
          const gId = effectiveGuardia(r) ?? '__'
          const arr = porGuardiaO.get(gId) ?? []
          arr.push(r)
          porGuardiaO.set(gId, arr)
        }
        for (const gRegs of porGuardiaO.values()) {
          const p = selectRegistroPrincipal(gRegs)
          if (p) principalesO.push(p)
        }
      }
      const turnosConAsistencia = principalesO.length
      const horasReales = principalesO.reduce((s: number, r: RegistroAsistencia) => s + Math.max(0, Number(r.horas_trabajadas) || 0), 0)
      // Capacitación: se paga al vigilador pero no se cobra al objetivo
      const horasLiquidablesConReg = principalesO.reduce((s: number, r: RegistroAsistencia) => {
        const turno = turnoPorId.get(r.turno_id)
        if (!turno || esCapacitacion(turno.tipo_evento)) return s
        return s + horasLiquidablesRegistro(turno, r)
      }, 0)
      const turnosSinRegObj = ts.filter((t: Turno) => !porTurnoO.has(t.id))
      const horasLiquidablesSinReg = turnosSinRegObj.reduce((s: number, t: Turno) =>
        esCapacitacion(t.tipo_evento) ? s : s + resolverLineaLiquidacion(t, null).horasLiquidables, 0)
      const horasLiquidables = horasLiquidablesConReg + horasLiquidablesSinReg
      const turnosEnCurso = regs.filter((r: RegistroAsistencia) => r.hora_entrada_real && !r.hora_salida_real).length
      const turnosSinFichar = ts.filter((t: Turno) => t.guardia_id && !regs.some((r: RegistroAsistencia) => r.turno_id === t.id && r.hora_entrada_real)).length
      // Mismo criterio que el resto: un objetivo pausado no acumula descubiertos.
      const turnosDescubiertos = objetivoEstaOperativo(o)
        ? ts.filter((t: Turno) => turnoSinCoberturaOperativa(t)).length
        : 0

      return {
        Objetivo: o.nombre,
        Cliente: o.cliente,
        'Turnos con Asistencia': turnosConAsistencia,
        'Horas Reales Cubiertas': horasReales.toFixed(2),
        'Horas Liquidables': horasLiquidables.toFixed(2),
        'Turnos en Curso': turnosEnCurso,
        'Turnos sin Fichar': turnosSinFichar,
        'Turnos Descubiertos': turnosDescubiertos,
        _actividad: ts.length + regs.length,
      }
    })
    .filter((o: any) => verTodos || o._actividad > 0)

  const exportarResumenGuardiasXLSX = async () => {
    if (reporteGuardias.length === 0) return

    const filasGuardias = reporteGuardias.map((row: any) => [
      row.Legajo || '—',
      `${row.Apellido || ''}, ${row.Nombre || ''}`.trim(),
      Number(row['Días Trabajados']) || 0,
      Number(row['Horas Reales']) || 0,
      Number(row['Horas Liquidables']) || 0,
      Number(row['En Curso']) || 0,
      Number(row.Tardanzas) || 0,
      Number(row['Salidas Anticipadas']) || 0,
    ])
    const totales = {
      guardias: filasGuardias.length,
      dias: filasGuardias.reduce((sum: number, row: any[]) => sum + row[2], 0),
      horasReales: filasGuardias.reduce((sum: number, row: any[]) => sum + row[3], 0),
      horasLiquidables: filasGuardias.reduce((sum: number, row: any[]) => sum + row[4], 0),
      enCurso: filasGuardias.reduce((sum: number, row: any[]) => sum + row[5], 0),
      tardanzas: filasGuardias.reduce((sum: number, row: any[]) => sum + row[6], 0),
      salidasAnticipadas: filasGuardias.reduce((sum: number, row: any[]) => sum + row[7], 0),
    }
    const filas = [
      ['Resumen guardias'],
      [`Generado: ${formatFechaHora(new Date())}`],
      [filtrosReporte()],
      [],
      ['Legajo', 'Guardia', 'Días trabajados', 'Horas reales', 'Horas liquidables', 'En curso', 'Tardanzas', 'Salidas anticipadas'],
      ...filasGuardias,
      [],
      ['Totales'],
      ['Guardias', totales.guardias],
      ['Días trabajados', totales.dias],
      ['Horas reales totales', Number(totales.horasReales.toFixed(2))],
      ['Horas liquidables totales', Number(totales.horasLiquidables.toFixed(2))],
      ['Turnos en curso', totales.enCurso],
      ['Tardanzas', totales.tardanzas],
      ['Salidas anticipadas', totales.salidasAnticipadas],
    ]

    await descargarXLSX(`resumen_guardias_${mesArchivo()}.xlsx`, filas, 4, filasGuardias.length, [3, 4, 1])
  }

  const exportarResumenObjetivosXLSX = async () => {
    if (reporteObjetivos.length === 0) return

    const filasObjetivos = reporteObjetivos.map((row: any) => [
      row.Objetivo || '—',
      row.Cliente || '—',
      Number(row['Turnos con Asistencia']) || 0,
      Number(row['Horas Reales Cubiertas']) || 0,
      Number(row['Horas Liquidables']) || 0,
      Number(row['Turnos en Curso']) || 0,
      Number(row['Turnos sin Fichar']) || 0,
      Number(row['Turnos Descubiertos']) || 0,
    ])
    const totales = {
      objetivos: filasObjetivos.length,
      conAsistencia: filasObjetivos.reduce((sum: number, row: any[]) => sum + row[2], 0),
      horasReales: filasObjetivos.reduce((sum: number, row: any[]) => sum + row[3], 0),
      horasLiquidables: filasObjetivos.reduce((sum: number, row: any[]) => sum + row[4], 0),
      enCurso: filasObjetivos.reduce((sum: number, row: any[]) => sum + row[5], 0),
      sinFichar: filasObjetivos.reduce((sum: number, row: any[]) => sum + row[6], 0),
      descubiertos: filasObjetivos.reduce((sum: number, row: any[]) => sum + row[7], 0),
    }
    const filas = [
      ['Resumen objetivos'],
      [`Generado: ${formatFechaHora(new Date())}`],
      [filtrosReporte()],
      [],
      ['Objetivo', 'Cliente', 'Turnos con asistencia', 'Horas reales', 'Horas liquidables', 'Turnos en curso', 'Turnos sin fichar', 'Turnos descubiertos'],
      ...filasObjetivos,
      [],
      ['Totales'],
      ['Objetivos', totales.objetivos],
      ['Turnos con asistencia', totales.conAsistencia],
      ['Horas reales totales', Number(totales.horasReales.toFixed(2))],
      ['Horas liquidables totales', Number(totales.horasLiquidables.toFixed(2))],
      ['Turnos en curso', totales.enCurso],
      ['Turnos sin fichar', totales.sinFichar],
      ['Turnos descubiertos', totales.descubiertos],
    ]

    await descargarXLSX(`resumen_objetivos_${mesArchivo()}.xlsx`, filas, 4, filasObjetivos.length, [3, 4, 1])
  }

  const tabs = [
    { id:'planilla_empleado', label:'Planilla empleado' },
    { id:'planilla_objetivo', label:'Planilla objetivo' },
    { id:'guardias', label:'Resumen guardias' },
    { id:'objetivos', label:'Resumen objetivos' },
    { id:'novedades', label:'Novedades' },
  ]
  // `nota` explica de dónde sale una diferencia en el total (hoy: capacitaciones).
  // Va en violeta, el mismo color con el que la columna Caract. marca capacitación.
  const totalBox = (label: string, value: string | number, nota?: string | null) => (
    <div style={{ background:'#1a2235', border:'1px solid #1e2d42', borderRadius:8, padding:'10px 12px' }}>
      <div style={{ fontSize:10, color:'#64748b', textTransform:'uppercase' as const, letterSpacing:1, marginBottom:4 }}>{label}</div>
      <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, color:'#e2e8f0' }}>{value}</div>
      {nota && <div style={{ fontSize:10, color:'#a78bfa', marginTop:4, lineHeight:1.35 }}>{nota}</div>}
    </div>
  )
  const renderEmpty = (text: string) => <div style={{ padding:24, color:'#64748b', textAlign:'center' as const }}>{text}</div>

  return (
    <div>
      {agregarRegistroContexto !== null && (
        <AgregarRegistroReporteModal
          onClose={() => setAgregarRegistroContexto(null)}
          guardias={guardias}
          objetivos={objetivos}
          turnos={turnosReportes}
          user={user}
          setRegistros={setRegistrosReportes}
          setTurnos={setTurnosReportes}
          contextoEmpleadoId={agregarRegistroContexto.empleadoId}
          contextoObjetivoId={agregarRegistroContexto.objetivoId}
        />
      )}
      <div style={S.title}>Reportes</div>
      <div style={S.sub2}>Planillas mensuales y exportaciones · Mes seleccionado: {mesLabel}</div>
      {filtroActivo && (
        <div style={{ ...S.card, padding:12, display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ color:'#f59e0b' }}>Filtro activo: {filtroActivo.label}</span>
          <button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 10px', fontSize:12 }} onClick={limpiarFiltro}>Limpiar filtro</button>
        </div>
      )}
      <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap', marginBottom:16 }}>
        <label style={S.label}>Mes operativo</label>
        <input type="month" style={{ ...S.input, width:'auto' }} value={mes} onChange={e => setMes(e.target.value)} />
        {(tab === 'guardias' || tab === 'objetivos') && (
          <label style={{ display:'flex', gap:8, alignItems:'center', color:'#94a3b8', fontSize:13 }}>
            <input type="checkbox" checked={verTodos} onChange={e => setVerTodos(e.target.checked)} />
            Ver todos
          </label>
        )}
      </div>
      {/* Bloque de totales del mes */}
      <div style={{ ...S.card, marginBottom:16, background:'#0f172a', border:'1px solid #1e2d42' }}>
        <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase' as const, letterSpacing:1, marginBottom:10 }}>Resumen del mes — {mesLabel}</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(190px, 1fr))', gap:12 }}>
          <div style={{ background:'#1a2235', borderRadius:8, padding:'12px 16px', borderLeft:'3px solid #64748b' }}>
            <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase' as const, letterSpacing:1, marginBottom:4 }}>Total programado del mes</div>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:22, fontWeight:800, color:'#e2e8f0' }}>{totalHsProgramadasMesCompleto.toFixed(2)} hs</div>
            <div style={{ fontSize:11, color:'#475569', marginTop:2 }}>Todos los turnos programados del mes, estén o no asignados.</div>
            {capacitacionMesCompleto.horas > 0 && (
              <div style={{ fontSize:11, color:'#a78bfa', marginTop:4, lineHeight:1.35 }}>
                Incluye {capacitacionMesCompleto.horas.toFixed(2)} hs de capacitación ({capacitacionMesCompleto.turnos} turno{capacitacionMesCompleto.turnos !== 1 ? 's' : ''}): {MOTIVO_CAPACITACION}.
              </div>
            )}
          </div>
          {/* Métrica de PROGRAMACIÓN, no de asistencia: un turno futuro con
              vigilador asignado cuenta acá. */}
          <div style={{ background:'#1a2235', borderRadius:8, padding:'12px 16px', borderLeft:'3px solid #8b5cf6' }}>
            <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase' as const, letterSpacing:1, marginBottom:4 }}>Total asignado del mes</div>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:22, fontWeight:800, color:'#a78bfa' }}>{totalHsAsignadasMes.toFixed(2)} hs</div>
            <div style={{ fontSize:11, color:'#475569', marginTop:2 }}>Turnos del mes que ya tienen vigilador asignado.</div>
            {totalHsSinAsignar > 0.005 && (
              <div style={{ fontSize:11, color:'#f59e0b', marginTop:4 }}>Sin asignar: {totalHsSinAsignar.toFixed(2)} hs</div>
            )}
          </div>
          <div style={{ background:'#1a2235', borderRadius:8, padding:'12px 16px', borderLeft:'3px solid #3b82f6' }}>
            <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase' as const, letterSpacing:1, marginBottom:4 }}>Programadas exigibles hasta ahora</div>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:22, fontWeight:800, color:'#3b82f6' }}>{totalHsExigibles.toFixed(2)} hs</div>
            <div style={{ fontSize:11, color:'#475569', marginTop:2 }}>Turnos cuyo horario ya terminó.</div>
            {hsNoExigiblesAun > 0.005 && (
              <div style={{ fontSize:10.5, color:'#475569', marginTop:3, lineHeight:1.35 }}>
                Faltan {hsNoExigiblesAun.toFixed(2)} hs de turnos en curso o que aún no empezaron.
              </div>
            )}
          </div>
          <div style={{ background:'#1a2235', borderRadius:8, padding:'12px 16px', borderLeft:'3px solid #10b981' }}>
            <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase' as const, letterSpacing:1, marginBottom:4 }}>Horas reconocidas hasta ahora</div>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:22, fontWeight:800, color:'#10b981' }}>{totalHsLiquidablesMes.toFixed(2)} hs</div>
            <div style={{ fontSize:11, color:'#475569', marginTop:2 }}>Horas trabajadas reconocidas por vigilador, supervisor o administrador.</div>
            {notaCapacitacionIncluida(capacitacionMes.horas, capacitacionMes.turnos) && (
              <div style={{ fontSize:11, color:'#a78bfa', marginTop:4, lineHeight:1.35 }}>
                {notaCapacitacionIncluida(capacitacionMes.horas, capacitacionMes.turnos)}
              </div>
            )}
          </div>
          <div
            style={{ background:'#1a2235', borderRadius:8, padding:'12px 16px', borderLeft:'3px solid #f59e0b', cursor:'pointer', transition:'background .15s' }}
            // Abre siempre filtrada: lo que se ve tiene que sumar lo que dice
            // la tarjeta, sin que haya que tocar nada.
            onClick={() => { setDifSoloPendientes(true); setMostrarDiferencias(true) }}
            title="Ver los turnos que explican el pendiente"
          >
            <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase' as const, letterSpacing:1, marginBottom:4 }}>Diferencia pendiente {diferenciasPendientes.length > 0 && <span style={{ color:'#f59e0b' }}>({diferenciasPendientes.length} pendiente{diferenciasPendientes.length !== 1 ? 's' : ''})</span>}</div>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:22, fontWeight:800, color: totalHsPendiente > 0 ? '#ef4444' : '#10b981' }}>
              {totalHsPendiente.toFixed(2)} hs
            </div>
            <div style={{ fontSize:11, color:'#475569', marginTop:2 }}>Horas de turnos terminados que todavía faltan reconocer.</div>
          </div>
        </div>
      </div>

      <div style={{ display:'flex', gap:4, background:'#1a2235', borderRadius:10, padding:4, marginBottom:24, width:'fit-content', flexWrap:'wrap' }}>
        {tabs.map(t => <button key={t.id} style={{ padding:'8px 18px', borderRadius:8, cursor:'pointer', fontSize:13, color:tab===t.id?'#f59e0b':'#64748b', background:tab===t.id?'#111827':'transparent', border:'none', fontFamily:'DM Sans,sans-serif', fontWeight:tab===t.id?600:400 }} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>

      {tab === 'planilla_empleado' && (
        <div style={{ ...S.card, overflowX:'auto', background:'#0f172a' }}>
          <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end', marginBottom:18 }}>
            <div style={{ minWidth:260 }}>
              <label style={S.label}>Empleado</label>
              <select style={S.select} value={empleadoId} onChange={e => setEmpleadoId(e.target.value)}>
                {empleados.map((g: Usuario) => <option key={g.id} value={g.id}>{g.apellido}, {g.nombre} · {g.legajo || 'sin legajo'}</option>)}
              </select>
            </div>
            <div style={{ display:'flex', gap:8, marginLeft:'auto' }}>
              <button style={{ ...S.btn, background:'#14532d', color:'#4ade80', border:'1px solid #166534' }} onClick={() => setAgregarRegistroContexto({ empleadoId: empleadoId })}>➕ Agregar registro</button>
              <button style={{ ...S.btn, ...S.btnSecondary }} onClick={exportarPlanillaEmpleadoXLSX}>Exportar XLSX</button>
            </div>
          </div>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:18, fontWeight:800 }}>Planilla individual por empleado</div>
            <div style={{ color:'#94a3b8', fontSize:13 }}>Empleado: <strong style={{ color:'#e2e8f0' }}>{empleadoSeleccionado ? `${empleadoSeleccionado.nombre} ${empleadoSeleccionado.apellido}` : '—'}</strong> · Legajo: <strong style={{ color:'#e2e8f0' }}>{empleadoSeleccionado?.cuil ? formatCuil(empleadoSeleccionado.cuil) : (empleadoSeleccionado?.legajo || '—')}</strong>{empleadoSeleccionado?.cuil && empleadoSeleccionado?.legajo ? <span style={{ color:'#64748b' }}> (int: {empleadoSeleccionado.legajo})</span> : null} · Mes: <strong style={{ color:'#e2e8f0' }}>{mesLabel}</strong></div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))', gap:8, marginBottom:16 }}>
            {totalBox('Días trabajados', totalesEmpleado.dias)}
            {totalBox('Horas reales', totalesEmpleado.horasReales.toFixed(2))}
            {totalBox('Horas liquidables', totalesEmpleado.horasLiquidables.toFixed(2),
              notaCapacitacionIncluida(totalesEmpleado.horasCapacitacion, totalesEmpleado.turnosCapacitacion))}
            {totalBox('Sin fichar', totalesEmpleado.sinFichar)}
            {totalBox('En curso', totalesEmpleado.enCurso)}
            {totalBox('Tardanzas', totalesEmpleado.tardanzas)}
          </div>
          <table style={S.table}>
            <thead><tr><th style={S.th}>Fecha</th><th style={S.th}>Día</th><th style={S.th}>Objetivo</th><th style={S.th}>Programado</th><th style={S.th}>Entrada</th><th style={S.th}>Salida</th><th style={S.th}>Hs reales</th><th style={S.th}>Hs liquidables</th><th style={S.th}>Caract.</th><th style={S.th}>Estado</th><th style={S.th}>Origen</th><th style={S.th}>Observaciones / alertas</th><th style={S.th}>GPS ingreso</th><th style={S.th}>Distancia ingreso</th><th style={S.th}>Estado GPS ingreso</th><th style={S.th}></th></tr></thead>
            <tbody>
              {planillaEmpleado.map((row: any) => {
                const esCal = row._estadoCalendario === 'sin_programacion' || row._estadoCalendario === 'novedad'
                const opacidadFila = row._estadoCalendario === 'sin_programacion' ? 0.4 : row._estadoCalendario === 'novedad' ? 0.65 : 1
                const badgeType = row.Estado === 'Cubierto' ? 'cubierto' : row.Estado === 'Manual' ? 'ok' : row.Estado === 'Descubierto' ? 'descubierto' : row._estadoCalendario === 'novedad' ? 'pendiente' : row._estadoCalendario === 'sin_programacion' ? 'pendiente' : 'pendiente'
                return (
                <tr key={row._id} style={{ opacity: opacidadFila }}>
                  <td style={S.td}>{row.Fecha}</td>
                  <td style={S.td}>{row.Día}</td>
                  <td style={S.td}><strong>{esCal ? (row._estadoCalendario === 'novedad' ? '' : '') : ''}{row.Objetivo}</strong></td>
                  <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:700 }}>{row['Horario programado']}</td>
                  <td style={S.td}>{row['Entrada real']}</td>
                  <td style={S.td}>{row['Salida real']}</td>
                  <td style={S.td}>{row['Horas reales']}</td>
                  <td style={{ ...S.td, color:'#10b981', fontWeight:700 }}>{row['Horas liquidables']}</td>
                  <td style={{ ...S.td, fontSize:11, color: row.Característica === ETIQUETA_CARACTERISTICA.capacitacion ? '#a78bfa' : row.Característica === ETIQUETA_CARACTERISTICA.cobertura ? '#38bdf8' : '#64748b' }}>{row.Característica}</td>
                  <td style={S.td}><Badge type={badgeType}>{row.Estado}</Badge></td>
                  <td style={{ ...S.td, fontSize:11, color:'#94a3b8', minWidth:140 }}>{row.Origen}</td>
                  <td style={{ ...S.td, minWidth:180 }}>{row['Observaciones / alertas']}</td>
                  <td style={S.td}>{row['GPS ingreso']}</td>
                  <td style={S.td}>{row['Distancia ingreso']}</td>
                  <td style={S.td}>{!esCal ? <Badge type={row['Estado GPS ingreso'] === 'Fuera del radio' ? 'alerta' : row['Estado GPS ingreso'] === 'Dentro del radio' ? 'ok' : 'pendiente'}>{row['Estado GPS ingreso']}</Badge> : '—'}</td>
                  <td style={S.td}>
                    {row._registro && (
                      <div style={{ display:'flex', gap:4 }}>
                        <button
                          style={{ ...S.btn, ...S.btnSecondary, padding:'6px 10px', fontSize:12 }}
                          onClick={() => setRegistroCorrigiendo(row._registro)}
                        >
                          Corregir
                        </button>
                        {row._registro.tipo_registro === 'carga_manual' && !row._registro.registro_anulado_at && (
                          <button
                            style={{ ...S.btn, padding:'6px 10px', fontSize:12, background:'#1e40af', color:'#93c5fd', border:'1px solid #1d4ed8' }}
                            onClick={() => abrirEdicionManual(row._registro)}
                          >
                            Editar
                          </button>
                        )}
                        {row._registro.tipo_registro === 'carga_manual' && !row._registro.registro_anulado_at && (
                          <button
                            style={{ ...S.btn, padding:'6px 10px', fontSize:12, background:'#7f1d1d', color:'#fca5a5', border:'1px solid #991b1b' }}
                            onClick={() => { setRegistroAnulando(row._registro); setMotivoAnulacion('') }}
                          >
                            Anular
                          </button>
                        )}
                      </div>
                    )}
                    {!row._registro && row._sinFichar && (
                      <button
                        style={{ ...S.btn, background:'#78350f', color:'#fbbf24', border:'1px solid #92400e', padding:'6px 10px', fontSize:12 }}
                        onClick={() => setTurnoParaCargaManual(turnosMes.find((t: Turno) => t.id === row._turno_id) || null)}
                      >
                        Cargar manual
                      </button>
                    )}
                    {row._turno_id && row.Estado !== 'Anulado' && (
                      <div style={{ display:'flex', gap:4, marginTop: row._registro || row._sinFichar ? 4 : 0 }}>
                        <button
                          style={{ ...S.btn, ...S.btnSecondary, padding:'4px 8px', fontSize:11 }}
                          onClick={() => abrirEdicionTurno(row._turno_id)}
                        >
                          Editar turno
                        </button>
                        <button
                          style={{ ...S.btn, padding:'4px 8px', fontSize:11, background:'#450a0a', color:'#fca5a5', border:'1px solid #7f1d1d' }}
                          onClick={() => { const t = turnos.find((t: Turno) => t.id === row._turno_id); if (t) { setTurnoAnulando(t); setMotivoAnulacionTurno('') } }}
                        >
                          Anular turno
                        </button>
                      </div>
                    )}
                    {row._estadoCalendario === 'sin_programacion' && empleadoSeleccionado && (
                      <button
                        style={{ ...S.btn, padding:'4px 8px', fontSize:11, background:'#1e3a5f', color:'#93c5fd', border:'1px solid #1e40af' }}
                        onClick={() => { setClasificandoDia({ fecha: row._fecha, empleadoId: empleadoSeleccionado.id }); setTipoNovedadDia('franco'); setObservacionNovedadDia('') }}
                      >
                        Clasificar día
                      </button>
                    )}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
          {planillaEmpleado.length === 0 && renderEmpty('No hay datos para este empleado en el mes seleccionado.')}
        </div>
      )}

      {tab === 'planilla_objetivo' && (
        <div style={{ ...S.card, overflowX:'auto', background:'#0f172a' }}>
          <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end', marginBottom:18 }}>
            <div style={{ minWidth:280 }}>
              <label style={S.label}>Objetivo</label>
              <select style={S.select} value={objetivoId} onChange={e => setObjetivoId(e.target.value)}>
                {objetivos.map((o: Objetivo) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </select>
            </div>
            <div style={{ display:'flex', gap:8, marginLeft:'auto' }}>
              <button style={{ ...S.btn, background:'#14532d', color:'#4ade80', border:'1px solid #166534' }} onClick={() => setAgregarRegistroContexto({ objetivoId: objetivoId })}>➕ Agregar registro</button>
              <button style={{ ...S.btn, ...S.btnSecondary }} onClick={exportarPlanillaObjetivoXLSX}>Exportar XLSX</button>
            </div>
          </div>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:18, fontWeight:800 }}>Planilla mensual por objetivo</div>
            <div style={{ color:'#94a3b8', fontSize:13 }}>Objetivo: <strong style={{ color:'#e2e8f0' }}>{objetivoSeleccionado?.nombre || '—'}</strong> · Mes: <strong style={{ color:'#e2e8f0' }}>{mesLabel}</strong></div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))', gap:8, marginBottom:16 }}>
            {totalBox('Turnos del mes', totalesObjetivo.total)}
            {totalBox('Cubiertos', totalesObjetivo.cubiertos)}
            {totalBox('Sin fichar', totalesObjetivo.sinFichar)}
            {totalBox('Descubiertos', totalesObjetivo.descubiertos)}
            {totalBox('En curso', totalesObjetivo.enCurso)}
            {totalBox('Horas reales', totalesObjetivo.horasReales.toFixed(2))}
            {totalBox('Horas liquidables', totalesObjetivo.horasLiquidables.toFixed(2),
              notaCapacitacionExcluida(totalesObjetivo.horasCapacitacion, totalesObjetivo.turnosCapacitacion))}
          </div>
          <table style={S.table}>
            <thead><tr><th style={S.th}>Fecha</th><th style={S.th}>Día</th><th style={S.th}>Programado</th><th style={S.th}>Guardia asignado</th><th style={S.th}>Guardia que fichó</th><th style={S.th}>Entrada</th><th style={S.th}>Salida</th><th style={S.th}>Hs reales</th><th style={S.th}>Hs liquidables</th><th style={S.th}>Caract.</th><th style={S.th}>Estado</th><th style={S.th}>Origen</th><th style={S.th}>Observaciones / alertas</th><th style={S.th}>GPS ingreso</th><th style={S.th}>Distancia ingreso</th><th style={S.th}>Estado GPS ingreso</th><th style={S.th}></th></tr></thead>
            <tbody>
              {planillaObjetivo.map((row: any) => (
                <tr key={row._id}>
                  <td style={S.td}>{row.Fecha}</td>
                  <td style={S.td}>{row.Día}</td>
                  <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:700 }}>{row['Horario programado']}</td>
                  <td style={S.td}>{row['Guardia asignado']}</td>
                  <td style={S.td}>{row['Guardia que fichó']}</td>
                  <td style={S.td}>{row['Entrada efectiva']}</td>
                  <td style={S.td}>{row['Salida efectiva']}</td>
                  <td style={S.td}>{row['Horas reales']}</td>
                  {/* En violeta las horas que NO entran en el total del objetivo:
                      si no, la columna parece sumar más de lo que dice el total. */}
                  <td
                    style={{ ...S.td, color: row._capacitacion ? '#a78bfa' : '#10b981', fontWeight:700 }}
                    title={row._capacitacion ? `Capacitación: ${MOTIVO_CAPACITACION}` : undefined}
                  >{row['Horas liquidables']}</td>
                  <td style={{ ...S.td, fontSize:11, color: row._capacitacion ? '#a78bfa' : row.Característica === ETIQUETA_CARACTERISTICA.cobertura ? '#38bdf8' : '#64748b' }}>{row.Característica}{row._capacitacion ? ' · no se cobra' : ''}</td>
                  <td style={S.td}><Badge type={row.Estado === 'Cubierto' ? 'cubierto' : row.Estado === 'Manual' ? 'ok' : row.Estado === 'Descubierto' ? 'descubierto' : 'pendiente'}>{row.Estado}</Badge></td>
                  <td style={{ ...S.td, fontSize:11, color:'#94a3b8', minWidth:140 }}>{row.Origen}</td>
                  <td style={{ ...S.td, minWidth:180 }}>{row['Observaciones / alertas']}</td>
                  <td style={S.td}>{row['GPS ingreso']}</td>
                  <td style={S.td}>{row['Distancia ingreso']}</td>
                  <td style={S.td}><Badge type={row['Estado GPS ingreso'] === 'Fuera del radio' ? 'alerta' : row['Estado GPS ingreso'] === 'Dentro del radio' ? 'ok' : 'pendiente'}>{row['Estado GPS ingreso']}</Badge></td>
                  <td style={S.td}>
                    {row._registro && (
                      <button
                        style={{ ...S.btn, ...S.btnSecondary, padding:'6px 10px', fontSize:12 }}
                        onClick={() => setRegistroCorrigiendo(row._registro)}
                      >
                        Corregir
                      </button>
                    )}
                    {!row._registro && row._sinFichar && (
                      <button
                        style={{ ...S.btn, background:'#78350f', color:'#fbbf24', border:'1px solid #92400e', padding:'6px 10px', fontSize:12 }}
                        onClick={() => setTurnoParaCargaManual(turnosMes.find((t: Turno) => t.id === row._turno_id) || null)}
                      >
                        Cargar manual
                      </button>
                    )}
                    {row._turno_id && row.Estado !== 'Anulado' && (
                      <div style={{ display:'flex', gap:4, marginTop: row._registro || row._sinFichar ? 4 : 0 }}>
                        <button
                          style={{ ...S.btn, ...S.btnSecondary, padding:'4px 8px', fontSize:11 }}
                          onClick={() => abrirEdicionTurno(row._turno_id)}
                        >
                          Editar turno
                        </button>
                        <button
                          style={{ ...S.btn, padding:'4px 8px', fontSize:11, background:'#450a0a', color:'#fca5a5', border:'1px solid #7f1d1d' }}
                          onClick={() => { const t = turnos.find((t: Turno) => t.id === row._turno_id); if (t) { setTurnoAnulando(t); setMotivoAnulacionTurno('') } }}
                        >
                          Anular turno
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {planillaObjetivo.length === 0 && renderEmpty('No hay turnos para este objetivo en el mes seleccionado.')}
        </div>
      )}

      {tab === 'guardias' && (
        <div style={S.card}>
          <div style={{ display:'flex', alignItems:'center', marginBottom:16 }}>
            <strong style={{ flex:1, fontFamily:'Syne,sans-serif' }}>Reporte por Guardia</strong>
            <button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 12px', fontSize:12 }} onClick={exportarResumenGuardiasXLSX}>Exportar XLSX</button>
          </div>
          <table style={S.table}>
            <thead><tr><th style={S.th}>Legajo</th><th style={S.th}>Guardia</th><th style={S.th}>Días Trab.</th><th style={S.th}>Horas Reales</th><th style={S.th}>Horas Liquidables</th><th style={S.th}>En Curso</th><th style={S.th}>Tardanzas</th><th style={S.th}>Sal. Anticipadas</th></tr></thead>
            <tbody>
              {reporteGuardias.map((g: any) => (
                <tr key={g.Legajo}>
                  <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:700, color:'#f59e0b' }}>{g.Legajo}</td>
                  <td style={S.td}><strong>{g.Apellido}, {g.Nombre}</strong></td>
                  <td style={S.td}>{g['Días Trabajados']}</td>
                  <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:700 }}>{g['Horas Reales']}h</td>
                  <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:700, color:'#10b981' }}>{g['Horas Liquidables']}h</td>
                  <td style={S.td}>{g['En Curso'] > 0 ? <Badge type="pendiente">{g['En Curso']}</Badge> : '—'}</td>
                  <td style={S.td}>{g.Tardanzas > 0 ? <Badge type="tarde">{g.Tardanzas}</Badge> : '—'}</td>
                  <td style={S.td}>{g['Salidas Anticipadas'] > 0 ? <Badge type="anticipada">{g['Salidas Anticipadas']}</Badge> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'objetivos' && (
        <div style={S.card}>
          <div style={{ display:'flex', alignItems:'center', marginBottom:16 }}>
            <strong style={{ flex:1, fontFamily:'Syne,sans-serif' }}>Reporte por Objetivo</strong>
            <button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 12px', fontSize:12 }} onClick={exportarResumenObjetivosXLSX}>Exportar XLSX</button>
          </div>
          <table style={S.table}>
            <thead><tr><th style={S.th}>Objetivo</th><th style={S.th}>Cliente</th><th style={S.th}>Con Asistencia</th><th style={S.th}>Horas Reales</th><th style={S.th}>Horas Liquidables</th><th style={S.th}>En Curso</th><th style={S.th}>Sin Fichar</th><th style={S.th}>Descubiertos</th></tr></thead>
            <tbody>
              {reporteObjetivos.map((o: any) => (
                <tr key={o.Objetivo}>
                  <td style={S.td}><strong>{o.Objetivo}</strong></td>
                  <td style={S.td}>{o.Cliente}</td>
                  <td style={S.td}><Badge type="cubierto">{o['Turnos con Asistencia']}</Badge></td>
                  <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:700 }}>{o['Horas Reales Cubiertas']}h</td>
                  <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:700, color:'#10b981' }}>{o['Horas Liquidables']}h</td>
                  <td style={S.td}>{o['Turnos en Curso'] > 0 ? <Badge type="pendiente">{o['Turnos en Curso']}</Badge> : '—'}</td>
                  <td style={S.td}>{o['Turnos sin Fichar'] > 0 ? <Badge type="pendiente">{o['Turnos sin Fichar']}</Badge> : '—'}</td>
                  <td style={S.td}>{o['Turnos Descubiertos'] > 0 ? <Badge type="descubierto">{o['Turnos Descubiertos']}</Badge> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'novedades' && (
        <div style={S.card}>
          <table style={S.table}>
            <thead><tr><th style={S.th}>Fecha</th><th style={S.th}>Objetivo</th><th style={S.th}>Guardia</th><th style={S.th}>Tipo</th><th style={S.th}>Prioridad</th><th style={S.th}>Estado</th></tr></thead>
            <tbody>
              {novedades.map((n: Novedad) => {
                const g = guardias.find((x: Usuario) => x.id === n.guardia_id)
                const o = objetivos.find((x: Objetivo) => x.id === n.objetivo_id)
                return (
                  <tr key={n.id}>
                    <td style={{ ...S.td, fontSize:12 }}>{new Date(n.created_at).toLocaleDateString('es-AR')}</td>
                    <td style={S.td}>{o?.nombre}</td>
                    <td style={S.td}>{g?.apellido}, {g?.nombre}</td>
                    <td style={S.td}>{n.tipo}</td>
                    <td style={S.td}><Badge type={n.prioridad}>{n.prioridad}</Badge></td>
                    <td style={S.td}><Badge type={n.estado}>{n.estado}</Badge></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {mostrarDiferencias && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.75)', zIndex:9999, display:'flex', alignItems:'flex-start', justifyContent:'center', paddingTop:40, overflowY:'auto' }} onClick={() => setMostrarDiferencias(false)}>
          <div style={{ background:'#0f172a', borderRadius:12, padding:24, width:'100%', maxWidth:960, border:'1px solid #1e2d42', marginBottom:40 }} onClick={e => e.stopPropagation()}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <div>
                <div style={{ fontSize:20, fontWeight:700, fontFamily:'Syne,sans-serif' }}>Diferencias del mes</div>
                <div style={{ fontSize:13, color:'#94a3b8', marginTop:2 }}>
                  {mesLabel} — {diferenciasQueExplican.length} turno{diferenciasQueExplican.length !== 1 ? 's' : ''} explica{diferenciasQueExplican.length === 1 ? '' : 'n'} el pendiente
                  {diferenciasPendientes.length > 0 && `, ${diferenciasPendientes.length} sin resolver`}
                  {diferenciasMes.length > diferenciasQueExplican.length &&
                    ` · ${diferenciasMes.length - diferenciasQueExplican.length} con extensión de jornada`}
                </div>
              </div>
              <button style={{ background:'transparent', border:'none', color:'#64748b', fontSize:22, cursor:'pointer', padding:'4px 8px' }} onClick={() => setMostrarDiferencias(false)}>✕</button>
            </div>
            {/* El filtro por defecto deja sólo lo que explica la tarjeta. Las
                extensiones de jornada tienen diferencia pero aportan cero, así
                que no explican nada: se ven apagando el filtro, con sus horas
                completas y sin marca de error. */}
            <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:12, flexWrap:'wrap' }}>
              <button
                onClick={() => setDifSoloPendientes(v => !v)}
                style={{
                  ...S.btn, fontSize:12, padding:'5px 10px',
                  border: difSoloPendientes ? '1px solid #f59e0b' : '1px solid #334155',
                  background: difSoloPendientes ? '#f59e0b18' : '#1e293b',
                  color: difSoloPendientes ? '#f59e0b' : '#e2e8f0',
                }}
              >
                {difSoloPendientes ? '✓ ' : ''}Solo lo que explica la diferencia ({diferenciasQueExplican.length})
              </button>
              <span style={{ fontSize:12, color:'#64748b' }}>
                {difSoloPendientes
                  ? `${diferenciasMes.length - diferenciasQueExplican.length} turno${diferenciasMes.length - diferenciasQueExplican.length !== 1 ? 's' : ''} con extensión de jornada oculto${diferenciasMes.length - diferenciasQueExplican.length !== 1 ? 's' : ''}`
                  : 'Mostrando también las extensiones de jornada, que no suman al pendiente'}
              </span>
            </div>
            {diferenciasVisibles.length === 0 ? (
              <div style={{ padding:32, textAlign:'center' as const, color:'#64748b' }}>
                {diferenciasMes.length === 0
                  ? 'No hay diferencias en los turnos ya exigibles de este mes.'
                  : 'Ningún turno genera pendiente: las diferencias que quedan son extensiones de jornada.'}
              </div>
            ) : (
              <div style={{ overflowX:'auto' }}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Fecha</th>
                      <th style={S.th}>Guardia</th>
                      <th style={S.th}>Objetivo</th>
                      <th style={S.th}>Ingreso Prog.</th>
                      <th style={S.th}>Egreso Prog.</th>
                      <th style={{ ...S.th, textAlign:'right' as const }}>Hs Prog.</th>
                      <th style={{ ...S.th, textAlign:'right' as const }}>Hs Liq.</th>
                      <th style={{ ...S.th, textAlign:'right' as const }}>Dif.</th>
                      {/* Lo que este turno aporta a la tarjeta. Una extensión
                          legítima aporta 0: no compensa a otro turno. */}
                      <th style={{ ...S.th, textAlign:'right' as const }}>Pendiente</th>
                      <th style={S.th}>Motivo</th>
                      <th style={S.th}>Estado</th>
                      <th style={S.th}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diferenciasVisibles.map(d => {
                      const guardiaNombre = d.guardiaId ? (() => { const g = guardias.find((g: Usuario) => g.id === d.guardiaId); return g ? `${g.apellido}, ${g.nombre}` : '—' })() : '—'
                      const objetivoNombre = d.objetivoId ? (objetivos.find((o: Objetivo) => o.id === d.objetivoId)?.nombre || '—') : '—'
                      return (
                        <tr key={d.turno.id}>
                          <td style={S.td}>{formatFecha(d.turno.fecha)}</td>
                          <td style={{ ...S.td, cursor: d.guardiaId ? 'pointer' : 'default', color: d.guardiaId ? '#38bdf8' : undefined }} onClick={() => {
                            if (!d.guardiaId) return
                            setEmpleadoId(d.guardiaId)
                            setTab('planilla_empleado')
                            setMostrarDiferencias(false)
                          }}>{guardiaNombre}</td>
                          <td style={{ ...S.td, cursor: d.objetivoId ? 'pointer' : 'default', color: d.objetivoId ? '#38bdf8' : undefined }} onClick={() => {
                            if (!d.objetivoId) return
                            setObjetivoId(d.objetivoId)
                            setTab('planilla_objetivo')
                            setMostrarDiferencias(false)
                          }}>{objetivoNombre}</td>
                          <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:700, fontVariantNumeric:'tabular-nums' }}>{formatHoraTurno(d.turno.hora_inicio)}</td>
                          <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:700, fontVariantNumeric:'tabular-nums' }}>{formatHoraTurno(d.turno.hora_fin)}</td>
                          <td style={{ ...S.td, textAlign:'right' as const, fontVariantNumeric:'tabular-nums' }}>{d.hsProg.toFixed(2)}</td>
                          <td style={{ ...S.td, textAlign:'right' as const, fontVariantNumeric:'tabular-nums', color:'#10b981', fontWeight:700 }}>{d.hsLiq.toFixed(2)}</td>
                          <td style={{ ...S.td, textAlign:'right' as const, fontVariantNumeric:'tabular-nums', fontWeight:700, color: d.diff < 0 ? '#ef4444' : '#10b981' }}>
                            {d.diff >= 0 ? '+' : ''}{d.diff.toFixed(2)}
                          </td>
                          <td
                            style={{ ...S.td, textAlign:'right' as const, fontVariantNumeric:'tabular-nums', fontWeight:700, color: d.pendienteHs > 0 ? '#ef4444' : '#64748b' }}
                            title={d.pendienteHs === 0 ? 'Horas reconocidas por encima de lo programado: no compensan otros turnos' : undefined}
                          >
                            {d.pendienteHs.toFixed(2)}
                          </td>
                          <td style={{ ...S.td, fontSize:12, color:'#94a3b8' }}>{d.motivo}</td>
                          <td style={{ ...S.td, fontSize:12 }}>
                            <span style={{ color: d.pendiente ? '#f59e0b' : '#10b981' }}>
                              {ETIQUETA_ESTADO_REVISION[d.estado]}
                            </span>
                            {d.observaciones > 0 && (
                              <span style={{ color:'#64748b', marginLeft:6 }}>· {d.observaciones} obs.</span>
                            )}
                          </td>
                          <td style={S.td}>
                            <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                              <button style={{ ...S.btn, fontSize:11, padding:'3px 8px', background:'#1e293b', color:'#94a3b8', border:'1px solid #334155' }} onClick={() => { abrirEdicionTurno(d.turno.id); setMostrarDiferencias(false) }}>Editar turno</button>
                              {d.registro && (
                                <button style={{ ...S.btn, fontSize:11, padding:'3px 8px', background:'#1e293b', color:'#94a3b8', border:'1px solid #334155' }} onClick={() => { setRegistroCorrigiendo(d.registro); setMostrarDiferencias(false) }}>Corregir registro</button>
                              )}
                              {!d.registro && d.turno.guardia_id && (
                                <button style={{ ...S.btn, fontSize:11, padding:'3px 8px', background:'#14532d', color:'#4ade80', border:'1px solid #166534' }} onClick={() => { setTurnoParaCargaManual(d.turno); setMostrarDiferencias(false) }}>Cargar asistencia</button>
                              )}
                              <button style={{ ...S.btn, fontSize:11, padding:'3px 8px', background:'#7f1d1d', color:'#fca5a5', border:'1px solid #991b1b' }} onClick={() => { setTurnoAnulando(d.turno); setMostrarDiferencias(false) }}>Anular</button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {/* Reconciliación explícita contra la tarjeta. Si el filtro
                    "solo lo pendiente" está activo se muestran menos filas, y
                    entonces la suma no tiene por qué dar el total: se avisa. */}
                {(() => {
                  const sumaPendiente = diferenciasVisibles.reduce((s, d) => s + d.pendienteHs, 0)
                  const cierra = Math.abs(sumaPendiente - totalHsPendiente) < 0.005
                  return (
                    <div style={{ marginTop:12, padding:'8px 12px', background:'#1a2235', borderRadius:8, display:'flex', gap:16, fontSize:12, color:'#94a3b8', flexWrap:'wrap', alignItems:'center' }}>
                      <span>Suma de pendientes: <strong style={{ color:'#ef4444', fontVariantNumeric:'tabular-nums' }}>{sumaPendiente.toFixed(2)} hs</strong></span>
                      <span style={{ color: cierra ? '#10b981' : '#f59e0b' }}>
                        {cierra
                          ? '✓ coincide con la tarjeta'
                          : `la tarjeta suma ${totalHsPendiente.toFixed(2)} hs sobre todos los turnos exigibles`}
                      </span>
                      <span>{diferenciasVisibles.filter(d => d.pendienteHs > 0).length} con pendiente · {diferenciasVisibles.filter(d => d.diff > 0).length} con extensión de jornada</span>
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {registroCorrigiendo && (
        <CorregirRegistroModal
          registro={registroCorrigiendo}
          onClose={() => setRegistroCorrigiendo(null)}
          turnos={turnosReportes}
          guardias={guardias}
          objetivos={objetivos}
          user={user}
          setRegistros={setRegistrosReportes}
        />
      )}

      {turnoParaCargaManual && (
        <CargarAsistenciaManualModal
          turno={turnoParaCargaManual}
          onClose={() => setTurnoParaCargaManual(null)}
          guardias={guardias}
          user={user}
          setRegistros={setRegistrosReportes}
          setTurnos={setTurnosReportes}
        />
      )}

      {turnoEditando && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={() => setTurnoEditando(null)}>
          <div style={{ background:'#1e293b', borderRadius:12, padding:24, width:'100%', maxWidth:420, border:'1px solid #334155' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:18, fontWeight:700, marginBottom:16 }}>Editar turno</div>
            <div style={{ display:'grid', gap:12 }}>
              <div>
                <label style={{ display:'block', fontSize:12, color:'#94a3b8', marginBottom:4 }}>Fecha</label>
                <input type="date" value={formEditTurno.fecha} onChange={e => setFormEditTurno(p => ({ ...p, fecha: e.target.value }))} style={{ ...S.input, width:'100%' }} />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                <div>
                  <label style={{ display:'block', fontSize:12, color:'#94a3b8', marginBottom:4 }}>Hora inicio</label>
                  <input type="time" value={formEditTurno.hora_inicio} onChange={e => setFormEditTurno(p => ({ ...p, hora_inicio: e.target.value }))} style={{ ...S.input, width:'100%' }} />
                </div>
                <div>
                  <label style={{ display:'block', fontSize:12, color:'#94a3b8', marginBottom:4 }}>Hora fin</label>
                  <input type="time" value={formEditTurno.hora_fin} onChange={e => setFormEditTurno(p => ({ ...p, hora_fin: e.target.value }))} style={{ ...S.input, width:'100%' }} />
                </div>
              </div>
              <div>
                <label style={{ display:'block', fontSize:12, color:'#94a3b8', marginBottom:4 }}>Motivo del cambio (obligatorio)</label>
                <textarea value={formEditTurno.comentario} onChange={e => setFormEditTurno(p => ({ ...p, comentario: e.target.value }))} style={{ ...S.input, width:'100%', minHeight:60, resize:'vertical' }} placeholder="Describí el motivo del cambio..." />
              </div>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:16 }}>
              <button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => setTurnoEditando(null)}>Cancelar</button>
              <button style={{ ...S.btn, ...S.btnPrimary }} disabled={editandoTurno || !formEditTurno.comentario.trim()} onClick={guardarEdicionTurno}>
                {editandoTurno ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {clasificandoDia && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={() => setClasificandoDia(null)}>
          <div style={{ background:'#1e293b', borderRadius:12, padding:24, width:'100%', maxWidth:380, border:'1px solid #334155' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:18, fontWeight:700, marginBottom:4 }}>Clasificar día</div>
            <div style={{ fontSize:13, color:'#94a3b8', marginBottom:16 }}>{clasificandoDia.fecha}</div>
            <div style={{ display:'grid', gap:12 }}>
              <div>
                <label style={{ display:'block', fontSize:12, color:'#94a3b8', marginBottom:4 }}>Tipo de novedad</label>
                <select value={tipoNovedadDia} onChange={e => setTipoNovedadDia(e.target.value)} style={{ ...S.input, width:'100%' }}>
                  {TIPOS_NOVEDAD.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display:'block', fontSize:12, color:'#94a3b8', marginBottom:4 }}>Observación (opcional)</label>
                <textarea value={observacionNovedadDia} onChange={e => setObservacionNovedadDia(e.target.value)} style={{ ...S.input, width:'100%', minHeight:50, resize:'vertical' }} placeholder="Detalle adicional..." />
              </div>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:16 }}>
              <button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => setClasificandoDia(null)}>Cancelar</button>
              <button style={{ ...S.btn, ...S.btnPrimary }} disabled={guardandoNovedad} onClick={guardarClasificacionDia}>
                {guardandoNovedad ? 'Guardando...' : 'Clasificar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {turnoAnulando && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={() => setTurnoAnulando(null)}>
          <div style={{ background:'#1e293b', borderRadius:12, padding:24, width:'100%', maxWidth:420, border:'1px solid #334155' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:18, fontWeight:700, marginBottom:8, color:'#fca5a5' }}>Anular turno</div>
            <div style={{ fontSize:13, color:'#94a3b8', marginBottom:16 }}>
              {turnoAnulando.fecha} &middot; {turnoAnulando.hora_inicio?.slice(0,5)}–{turnoAnulando.hora_fin?.slice(0,5)}
              {(() => { const r = registros.find((r: RegistroAsistencia) => r.turno_id === turnoAnulando.id); return r ? ' — Este turno tiene fichajes registrados.' : '' })()}
            </div>
            <div>
              <label style={{ display:'block', fontSize:12, color:'#94a3b8', marginBottom:4 }}>Motivo de anulación (obligatorio)</label>
              <textarea value={motivoAnulacionTurno} onChange={e => setMotivoAnulacionTurno(e.target.value)} style={{ ...S.input, width:'100%', minHeight:60, resize:'vertical' }} placeholder="Describí por qué se anula este turno..." />
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:16 }}>
              <button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => setTurnoAnulando(null)}>Cancelar</button>
              <button style={{ ...S.btn, background:'#7f1d1d', color:'#fca5a5', border:'1px solid #991b1b' }} disabled={anulandoTurno || !motivoAnulacionTurno.trim()} onClick={anularTurno}>
                {anulandoTurno ? 'Anulando...' : 'Confirmar anulación'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ── ZONAS OPERATIVAS ─────────────────────────────────────────
function ZonasOperativas({ guardias, objetivos, zonas, setZonas, supervisorZonas, setSupervisorZonas }: any) {
  const [form, setForm] = useState({ nombre: '', descripcion: '' })
  const [editId, setEditId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error', texto: string } | null>(null)
  const [zonaSeleccionadaId, setZonaSeleccionadaId] = useState<string>('')
  const [supervisorParaAsignar, setSupervisorParaAsignar] = useState('')

  useEffect(() => {
    if (!zonaSeleccionadaId && zonas.length > 0) setZonaSeleccionadaId(zonas[0].id)
    if (zonaSeleccionadaId && !zonas.some((z: any) => z.id === zonaSeleccionadaId)) {
      setZonaSeleccionadaId(zonas[0]?.id || '')
    }
  }, [zonas, zonaSeleccionadaId])

  const supervisores = guardias.filter((g: Usuario) => g.rol === 'supervisor' && g.estado === 'activo')

  const resetForm = () => { setForm({ nombre: '', descripcion: '' }); setEditId(null) }

  const guardarZona = async () => {
    if (!form.nombre.trim()) return
    setLoading(true)
    setMensaje(null)

    const payload = { nombre: form.nombre.trim(), descripcion: form.descripcion.trim() || null }
    const query = editId
      ? supabase.from('zonas_operativas').update(payload).eq('id', editId)
      : supabase.from('zonas_operativas').insert(payload)
    const { data, error } = await query.select().single()

    if (error) {
      setMensaje({ tipo: 'error', texto: error.message })
    } else if (data) {
      setZonas((prev: any[]) => editId ? prev.map(z => z.id === editId ? data : z) : [...prev, data].sort((a, b) => a.nombre.localeCompare(b.nombre)))
      if (!editId) setZonaSeleccionadaId(data.id)
      resetForm()
    }
    setLoading(false)
  }

  const editarZona = (z: any) => {
    setForm({ nombre: z.nombre, descripcion: z.descripcion || '' })
    setEditId(z.id)
  }

  const toggleEstadoZona = async (z: any) => {
    const nuevoEstado = z.estado === 'activo' ? 'inactivo' : 'activo'
    const { data } = await supabase.from('zonas_operativas').update({ estado: nuevoEstado }).eq('id', z.id).select().single()
    if (data) setZonas((prev: any[]) => prev.map(x => x.id === z.id ? data : x))
  }

  const asignarSupervisor = async () => {
    if (!zonaSeleccionadaId || !supervisorParaAsignar) return
    const yaAsignado = supervisorZonas.some((sz: any) => sz.zona_id === zonaSeleccionadaId && sz.supervisor_id === supervisorParaAsignar)
    if (yaAsignado) return

    const { data, error } = await supabase
      .from('supervisor_zonas')
      .insert({ zona_id: zonaSeleccionadaId, supervisor_id: supervisorParaAsignar })
      .select()
      .single()

    if (error) {
      setMensaje({ tipo: 'error', texto: error.message })
      return
    }
    if (data) {
      setSupervisorZonas((prev: any[]) => [...prev, data])
      setSupervisorParaAsignar('')
    }
  }

  const quitarSupervisor = async (id: string) => {
    const { error } = await supabase.from('supervisor_zonas').delete().eq('id', id)
    if (!error) setSupervisorZonas((prev: any[]) => prev.filter((sz: any) => sz.id !== id))
  }

  const zonaSeleccionada = zonas.find((z: any) => z.id === zonaSeleccionadaId)
  const supervisoresDeZona = supervisorZonas.filter((sz: any) => sz.zona_id === zonaSeleccionadaId)
  const objetivosDeZona = objetivos.filter((o: any) => o.zona_id === zonaSeleccionadaId)
  const nombreUsuario = (id: string) => {
    const u = guardias.find((g: Usuario) => g.id === id)
    return u ? `${u.apellido}, ${u.nombre}` : 'Usuario no encontrado'
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={S.title}>Zonas operativas</div>
        <div style={S.sub2}>{zonas.length} zona(s) configurada(s). La asignación de objetivos a una zona se hace desde Objetivos.</div>
      </div>

      {mensaje && (
        <div style={{ ...S.card, padding: 12, marginBottom: 16, color: mensaje.tipo === 'ok' ? '#10b981' : '#f87171', borderColor: mensaje.tipo === 'ok' ? 'rgba(16,185,129,.35)' : 'rgba(239,68,68,.35)' }}>
          {mensaje.texto}
        </div>
      )}

      <div style={S.grid2}>
        <div style={S.card}>
          <div style={{ fontFamily: 'Syne,sans-serif', fontWeight: 800, marginBottom: 12 }}>{editId ? 'Editar zona' : 'Nueva zona'}</div>
          <label style={S.label}>Nombre</label>
          <input style={S.input} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Ej.: Zona Rosario" />
          <label style={S.label}>Descripción (opcional)</label>
          <input style={S.input} value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} placeholder="Notas internas" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={guardarZona} disabled={loading || !form.nombre.trim()}>
              {editId ? 'Guardar cambios' : '+ Crear zona'}
            </button>
            {editId && <button style={{ ...S.btn, ...S.btnSecondary }} onClick={resetForm}>Cancelar</button>}
          </div>

          <div style={{ marginTop: 20, borderTop: '1px solid #1e2d42', paddingTop: 16 }}>
            {zonas.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 13 }}>No hay zonas creadas todavía.</div>
            ) : zonas.map((z: any) => (
              <div key={z.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #1e2d42' }}>
                <div style={{ cursor: 'pointer', flex: 1 }} onClick={() => setZonaSeleccionadaId(z.id)}>
                  <span style={{ fontWeight: zonaSeleccionadaId === z.id ? 800 : 400, color: zonaSeleccionadaId === z.id ? brandColors.yellow : undefined }}>{z.nombre}</span>
                  {z.estado !== 'activo' && <Badge type="inactivo">inactivo</Badge>}
                </div>
                <button style={{ ...S.btn, ...S.btnSecondary, padding: '4px 8px', fontSize: 11 }} onClick={() => editarZona(z)}>✏</button>
                <button style={{ ...S.btn, ...S.btnSecondary, padding: '4px 8px', fontSize: 11 }} onClick={() => toggleEstadoZona(z)}>
                  {z.estado === 'activo' ? '⏸' : '▶'}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div style={S.card}>
          {!zonaSeleccionada ? (
            <div style={{ color: '#64748b' }}>Seleccioná o creá una zona para administrar supervisores y ver sus objetivos.</div>
          ) : (
            <>
              <div style={{ fontFamily: 'Syne,sans-serif', fontWeight: 800, marginBottom: 4 }}>{zonaSeleccionada.nombre}</div>
              <div style={{ color: '#64748b', fontSize: 13, marginBottom: 16 }}>{zonaSeleccionada.descripcion || 'Sin descripción'}</div>

              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>Supervisores asignados</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <select style={S.select} value={supervisorParaAsignar} onChange={e => setSupervisorParaAsignar(e.target.value)}>
                  <option value="">Seleccionar supervisor...</option>
                  {supervisores.map((s: Usuario) => (
                    <option key={s.id} value={s.id}>{s.apellido}, {s.nombre}</option>
                  ))}
                </select>
                <button style={{ ...S.btn, ...S.btnPrimary }} onClick={asignarSupervisor} disabled={!supervisorParaAsignar}>Asignar</button>
              </div>
              {supervisoresDeZona.length === 0 ? (
                <div style={{ color: '#64748b', fontSize: 13, marginBottom: 20 }}>Sin supervisores asignados a esta zona.</div>
              ) : (
                <div style={{ marginBottom: 20 }}>
                  {supervisoresDeZona.map((sz: any) => (
                    <div key={sz.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #1e2d42' }}>
                      <span>{nombreUsuario(sz.supervisor_id)}</span>
                      <button style={{ ...S.btn, ...S.btnSecondary, padding: '4px 10px', fontSize: 11 }} onClick={() => quitarSupervisor(sz.id)}>Quitar</button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>Objetivos en esta zona</div>
              {objetivosDeZona.length === 0 ? (
                <div style={{ color: '#64748b', fontSize: 13 }}>Sin objetivos asignados. Asignalos desde la pantalla Objetivos.</div>
              ) : (
                objetivosDeZona.map((o: any) => (
                  <div key={o.id} style={{ padding: '8px 0', borderBottom: '1px solid #1e2d42' }}>{o.nombre}</div>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── SERVICIOS OBJETIVO ────────────────────────────────────────
function ServiciosObjetivo({ guardias, objetivos, filtroActivo, limpiarFiltro }: any) {
  const [servicios, setServicios] = useState<any[]>([])
  const [turnosBase, setTurnosBase] = useState<any[]>([])
  const [modal, setModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [loadingData, setLoadingData] = useState(true)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    objetivo_id: '',
    turno_base_id: '',
    puesto_id: '',
    // Solo compatibilidad: se conserva el valor legacy al editar, no se edita.
    nombre_puesto: '',
    dias_semana: [1, 2, 3, 4, 5] as number[],
    guardia_habitual_id: '',
    activo: true,
  })
  const [puestosForm, setPuestosForm] = useState<EstadoPuestos | null>(null)
  const [errorForm, setErrorForm] = useState('')
  // Regularización de servicios legacy → puestos reales (Bloque E, commit 2)
  const [puestosReg, setPuestosReg] = useState<Map<string, EstadoPuestos> | null>(null)
  const [mostrarReg, setMostrarReg] = useState(false)
  const [vinculando, setVinculando] = useState<string | null>(null)
  const [seleccionVinculo, setSeleccionVinculo] = useState<Record<string, string>>({})
  const [msgVinculo, setMsgVinculo] = useState('')
  const [generando, setGenerando] = useState(false)
  const [mesGenerar, setMesGenerar] = useState(() => {
    const hoy = new Date()
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  })
  const [resultadoGeneracion, setResultadoGeneracion] = useState<string | null>(null)
  // Vista previa mensual (Bloque E, commit 3): la vista no inserta nada.
  const [prevision, setPrevision] = useState<ResultadoPrevision | null>(null)
  // Creación parcial (commit 4): selección de filas válidas + confirmación
  // explícita. La escritura vive solo en la RPC crear_turnos_programacion_parcial.
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [faseCreacion, setFaseCreacion] = useState<'seleccion' | 'confirmar' | 'creando' | 'resultado'>('seleccion')
  const [resultadoCreacion, setResultadoCreacion] = useState<ResultadoCreacion | null>(null)
  const [errorCreacion, setErrorCreacion] = useState('')
  // Motor de cobertura histórica: analiza julio 2026 y muestra propuestas.
  // Solo lectura; no crea turnos, no modifica servicios.
  const [cobertura, setCobertura] = useState<ResultadoCobertura | null>(null)
  const [analizandoCobertura, setAnalizandoCobertura] = useState(false)
  const [errorCobertura, setErrorCobertura] = useState('')

  const MES_ANALISIS = { anio: 2026, mes: 7, desde: '2026-07-01', hasta: '2026-07-31' }

  const analizarCobertura = async () => {
    if (analizandoCobertura) return
    setAnalizandoCobertura(true)
    setErrorCobertura('')
    const { data: turnosJulio, error } = await supabase
      .from('turnos')
      .select('id, objetivo_id, puesto_id, guardia_id, fecha, hora_inicio, hora_fin, estado, tipo_evento')
      .gte('fecha', MES_ANALISIS.desde)
      .lte('fecha', MES_ANALISIS.hasta)
      .limit(5000)
    if (error) {
      setErrorCobertura(error.message)
      setAnalizandoCobertura(false)
      return
    }
    setCobertura(analizarCoberturaHistorica({
      anio: MES_ANALISIS.anio,
      mes: MES_ANALISIS.mes,
      turnos: turnosJulio ?? [],
      objetivos,
      servicios,
    }))
    setAnalizandoCobertura(false)
  }

  const DIAS = [
    { num:1, label:'Lun' }, { num:2, label:'Mar' }, { num:3, label:'Mié' },
    { num:4, label:'Jue' }, { num:5, label:'Vie' }, { num:6, label:'Sáb' },
    { num:7, label:'Dom' },
  ]

  const cargar = async () => {
    setLoadingData(true)
    const [{ data: sv }, { data: tb }] = await Promise.all([
      supabase
        .from('servicios_objetivo')
        .select(`*, objetivo:objetivos(nombre), turno_base:turnos_base(nombre, hora_inicio, hora_fin), guardia:usuarios(nombre, apellido), puesto:puestos(nombre)`)
        .order('created_at', { ascending: false }),
      supabase.from('turnos_base').select('*').eq('activo', true).order('hora_inicio'),
    ])
    if (sv) setServicios(sv)
    if (tb) setTurnosBase(tb)
    if (sv?.length) {
      const { data: mapa } = await obtenerPuestosActivosDeObjetivos(sv.map((s: any) => s.objetivo_id))
      setPuestosReg(mapa)
    }
    setLoadingData(false)
  }

  // La vinculación la confirma siempre el administrador; la RPC audita
  // usuario, servicio, puesto elegido y valor anterior en una transacción.
  const vincularPuesto = async (servicioId: string, puestoId: string) => {
    if (!puestoId || vinculando) return
    setVinculando(servicioId)
    setMsgVinculo('')
    const { error } = await supabase.rpc('vincular_servicio_puesto', {
      p_servicio_id: servicioId,
      p_puesto_id: puestoId,
    })
    if (error) setMsgVinculo(error.message)
    else await cargar()
    setVinculando(null)
  }

  useEffect(() => { cargar() }, [])

  // "Configurar cobertura" desde el legajo del objetivo (Bloque E): abre este
  // mismo formulario con el objetivo y la posición ya elegidos. No crea el
  // servicio automáticamente — solo lo deja listo para que el admin lo cargue.
  useEffect(() => {
    if (!filtroActivo || filtroActivo.tipo !== 'configurar_cobertura') return
    setForm({ objetivo_id: filtroActivo.objetivoId, turno_base_id:'', puesto_id: filtroActivo.puestoId || '', nombre_puesto:'', dias_semana:[1,2,3,4,5], guardia_habitual_id:'', activo:true })
    setErrorForm('')
    setEditId(null)
    setModal(true)
    limpiarFiltro?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroActivo])

  const resetForm = () => { setForm({ objetivo_id:'', turno_base_id:'', puesto_id:'', nombre_puesto:'', dias_semana:[1,2,3,4,5], guardia_habitual_id:'', activo:true }); setErrorForm('') }
  const abrirNuevo = () => { resetForm(); setEditId(null); setModal(true) }
  const abrirEditar = (s: any) => {
    setForm({ objetivo_id:s.objetivo_id, turno_base_id:s.turno_base_id, puesto_id:s.puesto_id||'', nombre_puesto:s.nombre_puesto||'', dias_semana:s.dias_semana||[1,2,3,4,5], guardia_habitual_id:s.guardia_habitual_id||'', activo:s.activo })
    setErrorForm(''); setEditId(s.id); setModal(true)
  }

  // Puestos reales del objetivo elegido. Toda lógica nueva usa puesto_id;
  // nombre_puesto queda solo como dato legacy visible.
  useEffect(() => {
    let vigente = true
    if (!form.objetivo_id) { setPuestosForm(null); return }
    obtenerPuestosActivos(form.objetivo_id).then(({ data }) => {
      if (!vigente) return
      setPuestosForm(data)
      if (data?.caso === 'unico') {
        setForm(prev => ({ ...prev, puesto_id: data.puestoUnicoId || '' }))
      } else if (data && !data.puestos.some(p => p.id === form.puesto_id)) {
        setForm(prev => ({ ...prev, puesto_id: '' }))
      }
    })
    return () => { vigente = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.objetivo_id])
  const toggleDia = (num: number) => {
    setForm(prev => ({ ...prev, dias_semana: prev.dias_semana.includes(num) ? prev.dias_semana.filter(d => d !== num) : [...prev.dias_semana, num].sort((a,b) => a-b) }))
  }
  const guardar = async () => {
    if (!form.objetivo_id || !form.turno_base_id || form.dias_semana.length === 0) return
    const puesto = resolverPuestoTurno(puestosForm, form.puesto_id)
    if (!puesto.ok) { setErrorForm(puesto.error); return }
    setErrorForm('')
    setLoading(true)
    const payload = { objetivo_id:form.objetivo_id, turno_base_id:form.turno_base_id, puesto_id:puesto.puesto_id, nombre_puesto:form.nombre_puesto||null, dias_semana:form.dias_semana, guardia_habitual_id:form.guardia_habitual_id||null, activo:form.activo }
    const query = editId ? supabase.from('servicios_objetivo').update(payload).eq('id', editId) : supabase.from('servicios_objetivo').insert(payload)
    const { data } = await query.select('*, objetivo:objetivos(nombre), turno_base:turnos_base(nombre,hora_inicio,hora_fin), guardia:usuarios(nombre,apellido)').single()
    if (data) setServicios(prev => editId ? prev.map(s => s.id === editId ? data : s) : [data, ...prev])
    setModal(false); setLoading(false); setEditId(null); resetForm()
  }
  const toggleActivo = async (id: string, activo: boolean) => {
    await supabase.from('servicios_objetivo').update({ activo: !activo }).eq('id', id)
    setServicios(prev => prev.map(s => s.id === id ? { ...s, activo: !activo } : s))
  }
  const diasLabel = (dias: number[]) => {
    if (!dias?.length) return '—'
    const sorted = [...dias].sort((a,b) => a-b)
    if (JSON.stringify(sorted) === JSON.stringify([1,2,3,4,5])) return 'Lun–Vie'
    if (JSON.stringify(sorted) === JSON.stringify([1,2,3,4,5,6,7])) return 'Todos'
    if (JSON.stringify(sorted) === JSON.stringify([6,7])) return 'Fin de semana'
    return sorted.map(d => DIAS.find(x => x.num === d)?.label || '').join(', ')
  }

  // Vista previa (Bloque E, commit 3): junta los datos autoritativos del
  // servidor y arma la vista con el helper puro previsualizarMes. También se
  // reutiliza tras crear turnos, para refrescar sin F5.
  const armarPrevision = async (): Promise<ResultadoPrevision | null> => {
    const [anio, mes] = mesGenerar.split('-').map(Number)
    const { data: serviciosActivos, error } = await supabase
      .from('servicios_objetivo')
      .select('*, turno_base:turnos_base(nombre, hora_inicio, hora_fin, activo), guardia:usuarios(nombre, apellido), puesto:puestos(nombre)')
      .eq('activo', true)
    if (error || !serviciosActivos?.length) { setResultadoGeneracion('No hay servicios activos para previsualizar.'); return null }

    const fechaDesde = `${anio}-${String(mes).padStart(2,'0')}-01`
    const ultimoDia = new Date(anio, mes, 0).getDate()
    const fechaHasta = `${anio}-${String(mes).padStart(2,'0')}-${ultimoDia}`
    // Un día a cada lado para que los nocturnos vecinos al mes cuenten en la
    // deduplicación y en las superposiciones del guardia sugerido.
    const fechaConsultaDesde = fechasVecinasTurno(fechaDesde)[0]
    const fechaConsultaHasta = fechasVecinasTurno(fechaHasta)[2]
    const [{ data: turnosExistentes, error: errTurnos }, { data: puestosPorObjetivo, error: errPuestos }] = await Promise.all([
      supabase
        .from('turnos')
        .select('id, objetivo_id, puesto_id, guardia_id, servicio_base_id, fecha, hora_inicio, hora_fin, estado, tipo_evento')
        .gte('fecha', fechaConsultaDesde)
        .lte('fecha', fechaConsultaHasta),
      obtenerPuestosActivosDeObjetivos(serviciosActivos.map((s: any) => s.objetivo_id)),
    ])
    if (errTurnos || errPuestos || !puestosPorObjetivo) {
      setResultadoGeneracion(errPuestos || 'No se pudieron cargar los datos para la vista previa.')
      return null
    }

    const ahora = new Date()
    return previsualizarMes({
      anio,
      mes,
      servicios: serviciosActivos,
      objetivos,
      puestosPorObjetivo,
      turnosExistentes: turnosExistentes ?? [],
      // Bloqueo de creación retroactiva: los días pasados (y el de hoy si el
      // turno ya comenzó) quedan visibles pero no seleccionables.
      fechaActual: fechaActualTurno(),
      horaActual: `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`,
    })
  }

  const generarMes = async () => {
    if (!mesGenerar) return
    setGenerando(true); setResultadoGeneracion(null); setPrevision(null)
    const r = await armarPrevision()
    if (r) {
      setPrevision(r)
      // Por defecto quedan seleccionadas todas las válidas; la cantidad se
      // muestra antes de confirmar y la creación exige confirmación aparte.
      setSeleccion(new Set(r.filas.filter(f => f.estado === 'valido').map(clavePrevision)))
      setFaseCreacion('seleccion')
      setResultadoCreacion(null)
      setErrorCreacion('')
    }
    setGenerando(false)
  }

  const cerrarPrevision = () => {
    setPrevision(null)
    setFaseCreacion('seleccion')
    setResultadoCreacion(null)
    setErrorCreacion('')
  }

  const toggleSeleccion = (clave: string) => {
    if (faseCreacion !== 'seleccion') return
    setSeleccion(prev => {
      const proxima = new Set(prev)
      if (proxima.has(clave)) proxima.delete(clave)
      else proxima.add(clave)
      return proxima
    })
  }

  // Confirmación → RPC. La RPC revalida cada fila en servidor, deduplica sin
  // depender del guardia, omite las inválidas sin abortar el lote y audita la
  // operación completa (idempotente por operacion_id).
  const crearSeleccionados = async () => {
    if (!prevision || faseCreacion === 'creando') return
    const filasPayload = payloadCreacionParcial(prevision.filas, seleccion)
    if (filasPayload.length === 0) return
    setFaseCreacion('creando')
    setErrorCreacion('')
    const { data, error } = await supabase.rpc('crear_turnos_programacion_parcial', {
      p_operacion_id: crypto.randomUUID(),
      p_mes: prevision.mes,
      p_filas: filasPayload,
    })
    if (error) {
      setErrorCreacion(error.message)
      setFaseCreacion('confirmar')
      return
    }
    setResultadoCreacion(data as ResultadoCreacion)
    // Releer del servidor: las filas creadas pasan a "Ya existe" sin F5.
    const refresco = await armarPrevision()
    if (refresco) {
      setPrevision(refresco)
      setSeleccion(new Set(refresco.filas.filter(f => f.estado === 'valido').map(clavePrevision)))
    }
    setFaseCreacion('resultado')
  }

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', marginBottom:24 }}>
        <div style={{ flex:1 }}><div style={S.title}>Servicios por Objetivo</div><div style={S.sub2}>{servicios.length} servicios configurados</div></div>
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={abrirNuevo}>+ Nuevo Servicio</button>
      </div>

      <div style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:12, padding:20, marginBottom:20 }}>
        <div style={{ fontFamily:'Syne,sans-serif', fontSize:15, fontWeight:700, marginBottom:4 }}>📅 Generar turnos del mes</div>
        <div style={{ fontSize:13, color:'#64748b', marginBottom:16 }}>Muestra la vista previa del mes en base a los servicios activos. En esta etapa no se crea ningún turno.</div>
        <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
          <input type="month" style={{ ...S.input, width:'auto', minWidth:160 }} value={mesGenerar} onChange={e => { setMesGenerar(e.target.value); setResultadoGeneracion(null) }} />
          <button style={{ ...S.btn, ...S.btnPrimary, opacity: generando ? 0.6 : 1 }} onClick={generarMes} disabled={generando}>{generando ? '⏳ Preparando vista previa...' : '⚡ Generar mes'}</button>
          <button style={{ ...S.btn, ...S.btnSecondary, opacity: analizandoCobertura ? 0.6 : 1 }} onClick={analizarCobertura} disabled={analizandoCobertura}>{analizandoCobertura ? '⏳ Analizando…' : '📊 Analizar cobertura de julio'}</button>
        </div>
        {errorCobertura && <div style={{ marginTop:10, color:'#ef4444', fontSize:12 }}>{errorCobertura}</div>}
        {resultadoGeneracion && (
          <div style={{ marginTop:12, padding:'10px 14px', borderRadius:8, fontSize:13, background: resultadoGeneracion.startsWith('✅') ? 'rgba(16,185,129,.1)' : 'rgba(245,158,11,.1)', border: `1px solid ${resultadoGeneracion.startsWith('✅') ? 'rgba(16,185,129,.3)' : 'rgba(245,158,11,.3)'}`, color: resultadoGeneracion.startsWith('✅') ? '#10b981' : '#f59e0b' }}>
            {resultadoGeneracion}
          </div>
        )}
      </div>

      {prevision && (() => {
        const seleccionadas = payloadCreacionParcial(prevision.filas, seleccion).length
        const confirmacion = resumenConfirmacion(prevision.filas, seleccion)
        return (
        <Modal title={`Vista previa — ${prevision.mes}`} onClose={cerrarPrevision}
          footer={<>
            <button style={{ ...S.btn, ...S.btnSecondary }} onClick={cerrarPrevision}>Cerrar</button>
            {faseCreacion === 'seleccion' && prevision.resumen.validos > 0 && (
              <button
                style={{ ...S.btn, ...S.btnPrimary, opacity: seleccionadas === 0 ? 0.5 : 1 }}
                disabled={seleccionadas === 0}
                onClick={() => setFaseCreacion('confirmar')}
              >
                Crear turnos seleccionados ({seleccionadas})
              </button>
            )}
          </>}>
          <div style={{ fontSize:13, color:'#64748b', marginBottom:14 }}>
            La vista previa no modifica nada: los turnos seleccionados se crean recién al confirmar. Las filas no válidas son de solo lectura.
          </div>

          {faseCreacion === 'confirmar' && (
            <div style={{ background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.35)', borderRadius:8, padding:'12px 16px', marginBottom:16 }}>
              <div style={{ fontSize:14, fontWeight:700, color:'#f59e0b', marginBottom:8 }}>Confirmar creación — {prevision.mes}</div>
              <div style={{ fontSize:13, color:'#e2e8f0', marginBottom:4 }}>Se crearán <strong>{confirmacion.cantidad}</strong> turnos en <strong>{confirmacion.objetivos.length}</strong> objetivo{confirmacion.objetivos.length !== 1 ? 's' : ''} ({confirmacion.objetivos.join(', ')}) sobre <strong>{confirmacion.puestos}</strong> posici{confirmacion.puestos !== 1 ? 'ones' : 'ón'} operativa{confirmacion.puestos !== 1 ? 's' : ''}.</div>
              <div style={{ fontSize:12, color:'#f59e0b', marginBottom:4 }}>Los turnos se crean sin vigilador asignado: el supervisor lo asigna después.</div>
              <div style={{ fontSize:12, color:'#94a3b8', marginBottom:10 }}>Los turnos ya existentes y los conflictos no serán modificados.</div>
              {errorCreacion && <div style={{ fontSize:12, color:'#ef4444', marginBottom:10 }}>{errorCreacion}</div>}
              <div style={{ display:'flex', gap:10 }}>
                <button style={{ ...S.btn, ...S.btnSecondary, padding:'8px 14px' }} onClick={() => setFaseCreacion('seleccion')}>Volver</button>
                <button style={{ ...S.btn, ...S.btnPrimary, padding:'8px 14px' }} onClick={crearSeleccionados}>Confirmar creación</button>
              </div>
            </div>
          )}

          {faseCreacion === 'creando' && (
            <div style={{ background:'rgba(96,165,250,.08)', border:'1px solid rgba(96,165,250,.3)', borderRadius:8, padding:'12px 16px', marginBottom:16, color:'#60a5fa', fontSize:13 }}>
              ⏳ Creando turnos seleccionados…
            </div>
          )}

          {faseCreacion === 'resultado' && resultadoCreacion && (
            <div style={{ background:'rgba(16,185,129,.07)', border:'1px solid rgba(16,185,129,.3)', borderRadius:8, padding:'12px 16px', marginBottom:16 }}>
              <div style={{ fontSize:14, fontWeight:700, color:'#10b981', marginBottom:6 }}>
                ✅ {resultadoCreacion.creadas} turno{resultadoCreacion.creadas !== 1 ? 's' : ''} creado{resultadoCreacion.creadas !== 1 ? 's' : ''} · {resultadoCreacion.ya_existentes} ya existía{resultadoCreacion.ya_existentes !== 1 ? 'n' : ''} · {resultadoCreacion.omitidas} omitida{resultadoCreacion.omitidas !== 1 ? 's' : ''}
                {resultadoCreacion.repetida ? ' · (operación ya ejecutada: se muestra el resultado guardado)' : ''}
              </div>
              {resultadoCreacion.filas.filter(f => f.resultado !== 'creada').map((f, i) => (
                <div key={`${f.servicio_id}|${f.fecha}|${i}`} style={{ fontSize:12, color:'#94a3b8' }}>
                  · {f.fecha}: {f.resultado === 'ya_existe' ? 'ya existía' : 'omitida'}{f.motivo ? ` — ${f.motivo}` : ''}
                </div>
              ))}
              {resultadoCreacion.turnos_creados.length > 0 && (
                <div style={{ fontSize:11, color:'#64748b', marginTop:6 }}>IDs creados: {resultadoCreacion.turnos_creados.join(', ')}</div>
              )}
              <div style={{ fontSize:12, color:'#64748b', marginTop:6 }}>La tabla de abajo ya está releída del servidor: las filas creadas figuran como "Ya existe".</div>
            </div>
          )}

          <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:16 }}>
            {[
              { label:'Total esperado', valor: prevision.resumen.total_esperado, color:'#e2e8f0' },
              { label: ETIQUETA_PREVISION.valido, valor: prevision.resumen.validos, color:'#10b981' },
              { label: ETIQUETA_PREVISION.ya_existe, valor: prevision.resumen.existentes, color:'#60a5fa' },
              { label:'Conflictos', valor: prevision.resumen.conflictos, color:'#ef4444' },
              { label:'Fechas pasadas', valor: prevision.resumen.fechas_pasadas, color:'#94a3b8' },
              { label:'Servicios excluidos', valor: prevision.resumen.servicios_excluidos, color:'#f59e0b' },
              { label:'Sin posición operativa', valor: prevision.resumen.servicios_sin_puesto, color:'#f59e0b' },
            ].map(chip => (
              <div key={chip.label} style={{ background:'#0b1220', border:'1px solid #1e2d42', borderRadius:8, padding:'8px 14px', textAlign:'center' }}>
                <div style={{ fontFamily:'Syne,sans-serif', fontSize:18, fontWeight:700, color:chip.color }}>{chip.valor}</div>
                <div style={{ fontSize:11, color:'#64748b' }}>{chip.label}</div>
              </div>
            ))}
          </div>

          {prevision.advertencias.length > 0 && (
            <div style={{ background:'rgba(245,158,11,.07)', border:'1px solid rgba(245,158,11,.3)', borderRadius:8, padding:'10px 14px', marginBottom:16 }}>
              <div style={{ fontSize:13, fontWeight:700, color:'#f59e0b', marginBottom:6 }}>Servicios que no pueden previsualizarse</div>
              {prevision.advertencias.map(a => (
                <div key={a.servicio_id} style={{ fontSize:12, color:'#e2e8f0', marginBottom:2 }}>
                  · <strong>{a.objetivo_nombre}</strong>{a.turno_base_nombre ? ` — ${a.turno_base_nombre}` : ''}: <span style={{ color:'#f59e0b' }}>{a.detalle}</span>
                </div>
              ))}
            </div>
          )}

          {prevision.filas.length === 0 ? (
            <div style={{ textAlign:'center', padding:24, color:'#64748b' }}>Ningún servicio habilitado genera fechas en este mes.</div>
          ) : (
            <>
            {prevision.resumen.validos > 0 && faseCreacion === 'seleccion' && (
              <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:10 }}>
                <button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 12px', fontSize:12 }}
                  onClick={() => setSeleccion(new Set(prevision.filas.filter(f => f.estado === 'valido').map(clavePrevision)))}>
                  Seleccionar todas las válidas
                </button>
                <button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 12px', fontSize:12 }}
                  onClick={() => setSeleccion(new Set())}>
                  Desmarcar todas
                </button>
                <span style={{ fontSize:13, color:'#e2e8f0' }}>Se crearán <strong style={{ color:'#10b981' }}>{seleccionadas}</strong> de {prevision.resumen.validos} filas válidas.</span>
              </div>
            )}
            <div style={{ overflowX:'auto', maxHeight:420, overflowY:'auto' }}>
              <table style={S.table}>
                <thead><tr><th style={S.th}>Crear</th><th style={S.th}>Fecha</th><th style={S.th}>Día</th><th style={S.th}>Objetivo</th><th style={S.th}>Posición operativa</th><th style={S.th}>Turno base</th><th style={S.th}>Horario</th><th style={S.th}>Guardia sugerido</th><th style={S.th}>Caract.</th><th style={S.th}>Estado</th><th style={S.th}>Detalle</th></tr></thead>
                <tbody>
                  {prevision.filas.map((f, i) => {
                    const colorEstado: Record<EstadoPrevision, string> = {
                      valido:'#10b981', ya_existe:'#60a5fa', conflicto_horario:'#ef4444',
                      fecha_pasada:'#94a3b8', sin_puesto:'#f59e0b', turno_base_inactivo:'#f59e0b',
                      objetivo_inactivo:'#94a3b8', objetivo_prueba:'#94a3b8', config_invalida:'#f59e0b',
                    }
                    const clave = clavePrevision(f)
                    return (
                      <tr key={`${clave}|${i}`}>
                        <td style={S.td}>
                          {f.estado === 'valido' ? (
                            <input
                              type="checkbox"
                              checked={seleccion.has(clave)}
                              disabled={faseCreacion !== 'seleccion'}
                              onChange={() => toggleSeleccion(clave)}
                            />
                          ) : null}
                        </td>
                        <td style={S.td}>{f.fecha}</td>
                        <td style={S.td}>{f.dia_semana}</td>
                        <td style={S.td}><strong>{f.objetivo_nombre}</strong></td>
                        <td style={S.td}>{f.puesto_nombre || '—'}</td>
                        <td style={S.td}>{f.turno_base_nombre}</td>
                        <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontSize:12 }}>{f.hora_inicio} → {f.hora_fin}</td>
                        <td style={S.td}>{f.guardia_sugerido_nombre || <span style={{ color:'#64748b' }}>Sin guardia sugerido</span>}</td>
                        <td style={S.td}>{f.caracteristica}</td>
                        <td style={{ ...S.td, color: colorEstado[f.estado], fontSize:12, whiteSpace:'nowrap' }}>{ETIQUETA_PREVISION[f.estado]}</td>
                        <td style={{ ...S.td, fontSize:12, color:'#94a3b8' }}>{f.detalle || ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
        </Modal>
        )
      })()}

      {cobertura && (() => {
        const colorClasif: Record<ClasificacionPatron, string> = {
          fuerte:'#10b981', probable:'#60a5fa', revision:'#f59e0b', excepcion:'#94a3b8',
          cambio_esquema:'#f59e0b', sin_informacion:'#64748b',
        }
        return (
        <Modal title={`Cobertura histórica — ${cobertura.mes}`} onClose={() => setCobertura(null)}
          footer={<button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => setCobertura(null)}>Cerrar</button>}>
          <div style={{ fontSize:13, color:'#64748b', marginBottom:14 }}>
            {NOTA_ALCANCE_MOTOR} Los días sin registros se tratan como datos no registrados, no como ausencia de servicio. No crea turnos ni modifica servicios.
          </div>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:16 }}>
            {[
              { label:'Objetivos analizados', valor: cobertura.resumen.objetivos_analizados, color:'#e2e8f0' },
              { label:'Con patrón claro', valor: cobertura.resumen.con_patron_fuerte, color:'#10b981' },
              { label:'Con patrón probable', valor: cobertura.resumen.con_patron_probable, color:'#60a5fa' },
              { label:'Requieren revisión', valor: cobertura.resumen.requieren_revision, color:'#f59e0b' },
              { label:'Sin datos suficientes', valor: cobertura.resumen.sin_informacion, color:'#64748b' },
            ].map(chip => (
              <div key={chip.label} style={{ background:'#0b1220', border:'1px solid #1e2d42', borderRadius:8, padding:'8px 14px', textAlign:'center' }}>
                <div style={{ fontFamily:'Syne,sans-serif', fontSize:18, fontWeight:700, color:chip.color }}>{chip.valor}</div>
                <div style={{ fontSize:11, color:'#64748b' }}>{chip.label}</div>
              </div>
            ))}
          </div>
          <div style={{ maxHeight:460, overflowY:'auto', display:'flex', flexDirection:'column', gap:14 }}>
            {cobertura.objetivos.map(obj => (
              <div key={obj.objetivo_id} style={{ background:'#0b1220', border:'1px solid #1e2d42', borderRadius:10, padding:14 }}>
                <div style={{ fontFamily:'Syne,sans-serif', fontSize:14, fontWeight:700, marginBottom:8 }}>{obj.objetivo_nombre}</div>
                <div style={{ overflowX:'auto' }}>
                  <table style={S.table}>
                    <thead><tr><th style={S.th}>Días</th><th style={S.th}>Horario</th><th style={S.th}>Posiciones</th><th style={S.th}>Observado</th><th style={S.th}>%</th><th style={S.th}>Clasificación</th><th style={S.th}>vs. configuración</th></tr></thead>
                    <tbody>
                      {obj.patrones.map((p, i) => (
                        <tr key={i}>
                          <td style={S.td}>{p.etiqueta_dias}</td>
                          <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontSize:12 }}>{p.hora_inicio}–{p.hora_fin}{p.nocturno ? ' 🌙' : ''}</td>
                          <td style={{ ...S.td, textAlign:'center' }}>{p.posiciones}</td>
                          <td style={S.td}>{p.dias_cumplidos} de {p.dias_observados} días</td>
                          <td style={S.td}>{p.porcentaje}%</td>
                          <td style={{ ...S.td, color: colorClasif[p.clasificacion], fontSize:12, whiteSpace:'nowrap' }}>{ETIQUETA_CLASIFICACION[p.clasificacion]}</td>
                          <td style={{ ...S.td, fontSize:12, color: p.comparacion === 'coincide' ? '#10b981' : '#f59e0b' }}>{p.comparacion ? ETIQUETA_COMPARACION[p.comparacion] : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {obj.patrones.some(p => p.excepciones.length > 0) && (
                  <div style={{ fontSize:11, color:'#94a3b8', marginTop:8 }}>
                    Excepciones: {obj.patrones.flatMap(p => p.excepciones).slice(0, 6).join(' · ')}
                  </div>
                )}
                {obj.advertencias.length > 0 && (
                  <div style={{ fontSize:11, color:'#f59e0b', marginTop:6 }}>⚠ {obj.advertencias.join(' · ')}</div>
                )}
                {obj.configuracion_adicional.length > 0 && (
                  <div style={{ fontSize:11, color:'#64748b', marginTop:6 }}>Configuración adicional: {obj.configuracion_adicional.join(' · ')}</div>
                )}
              </div>
            ))}
          </div>
        </Modal>
        )
      })()}

      {(() => {
        // Regularización: servicios sin puesto real vinculado.
        const pendientesReg = servicios.filter((s: any) => !s.puesto_id)
        if (pendientesReg.length === 0) return null
        return (
          <div style={{ background:'#111827', border:'1px solid #92400e55', borderRadius:12, padding:20, marginBottom:20 }}>
            <div style={{ display:'flex', alignItems:'center', gap:12, cursor:'pointer' }} onClick={() => setMostrarReg(v => !v)}>
              <div style={{ flex:1 }}>
                <div style={{ fontFamily:'Syne,sans-serif', fontSize:15, fontWeight:700 }}>🧩 Regularización de posiciones operativas <span style={{ color:'#f59e0b' }}>({pendientesReg.length} servicio{pendientesReg.length !== 1 ? 's' : ''} sin posición operativa)</span></div>
                <div style={{ fontSize:13, color:'#64748b' }}>Vinculá cada servicio con su posición operativa real. Nada se decide automáticamente y no se crean posiciones.</div>
              </div>
              <span style={{ color:'#64748b' }}>{mostrarReg ? '▲' : '▼'}</span>
            </div>
            {mostrarReg && (
              <div style={{ marginTop:14, overflowX:'auto' }}>
                {msgVinculo && <div style={{ color:'#ef4444', fontSize:12, marginBottom:8 }}>{msgVinculo}</div>}
                <table style={S.table}>
                  <thead><tr><th style={S.th}>Objetivo</th><th style={S.th}>Turno base</th><th style={S.th}>Nombre histórico</th><th style={S.th}>Posición sugerida</th><th style={S.th}>Estado</th><th style={S.th}></th></tr></thead>
                  <tbody>
                    {pendientesReg.map((s: any) => {
                      const puestos = puestosReg?.get(s.objetivo_id)?.puestos ?? []
                      const sug = sugerirVinculacion(s, puestos)
                      const elegido = seleccionVinculo[s.id] ?? sug.puestoSugerido?.id ?? ''
                      return (
                        <tr key={s.id}>
                          <td style={S.td}><strong>{s.objetivo?.nombre || '—'}</strong></td>
                          <td style={S.td}>{s.turno_base ? `${s.turno_base.nombre} (${s.turno_base.hora_inicio}–${s.turno_base.hora_fin})` : '—'}</td>
                          <td style={{ ...S.td, color:'#f59e0b', fontSize:12 }}>{s.nombre_puesto || <span style={{ color:'#64748b' }}>sin nombre</span>}</td>
                          <td style={S.td}>
                            {sug.estado === 'sugerencia_unica' && <span style={{ color:'#10b981' }}>{sug.puestoSugerido?.nombre}</span>}
                            {/* Sin coincidencia de nombre: nada se sugiere; el
                                administrador elige manualmente entre las
                                posiciones activas del objetivo. */}
                            {(sug.estado === 'ambiguo' || sug.estado === 'sin_coincidencia') && sug.candidatos.length > 0 && (
                              <select style={{ ...S.select, width:'auto', minWidth:150 }} value={elegido} onChange={e => setSeleccionVinculo(prev => ({ ...prev, [s.id]: e.target.value }))}>
                                <option value="">Elegir posición...</option>
                                {sug.candidatos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                              </select>
                            )}
                            {(sug.estado === 'sin_puestos' || (sug.estado === 'sin_coincidencia' && sug.candidatos.length === 0)) && <span style={{ color:'#64748b' }}>—</span>}
                          </td>
                          <td style={{ ...S.td, fontSize:12, color: sug.estado === 'sugerencia_unica' ? '#10b981' : sug.estado === 'ambiguo' ? '#f59e0b' : '#94a3b8' }}>{ETIQUETA_VINCULACION[sug.estado]}</td>
                          <td style={S.td}>
                            {(sug.estado === 'sugerencia_unica' || sug.estado === 'ambiguo' || (sug.estado === 'sin_coincidencia' && sug.candidatos.length > 0)) && (
                              <button
                                style={{ ...S.btn, ...S.btnPrimary, padding:'6px 12px', fontSize:12, opacity: vinculando === s.id || !elegido ? 0.5 : 1 }}
                                disabled={vinculando !== null || !elegido}
                                onClick={() => vincularPuesto(s.id, elegido)}
                              >
                                {vinculando === s.id ? 'Vinculando…' : 'Vincular'}
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })()}

      <div style={S.card}>
        {loadingData ? (
          <div style={{ textAlign:'center', padding:48, color:'#64748b' }}>Cargando...</div>
        ) : servicios.length === 0 ? (
          <div style={{ textAlign:'center', padding:48, color:'#64748b' }}><div style={{ fontSize:40, marginBottom:12 }}>🏢</div><div>No hay servicios configurados. Creá el primero.</div></div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={S.table}>
              <thead><tr><th style={S.th}>Objetivo</th><th style={S.th}>Turno Base</th><th style={S.th}>Posición operativa</th><th style={S.th}>Días</th><th style={S.th}>Guardia Habitual</th><th style={S.th}>Estado</th><th style={S.th}></th></tr></thead>
              <tbody>
                {servicios.map((s: any) => (
                  <tr key={s.id}>
                    <td style={S.td}><strong>{s.objetivo?.nombre || '—'}</strong></td>
                    <td style={S.td}>
                      <div>{s.turno_base?.nombre || '—'}</div>
                      {s.turno_base && <div style={{ fontSize:11, color:'#f59e0b', fontFamily:'Syne,sans-serif', fontWeight:600 }}>{s.turno_base.hora_inicio} → {s.turno_base.hora_fin}</div>}
                    </td>
                    <td style={{ ...S.td, color:'#94a3b8', fontSize:12 }}>
                      {s.puesto?.nombre
                        ? <span style={{ color:'#e2e8f0' }}>{s.puesto.nombre}</span>
                        : s.nombre_puesto
                          ? <span title="Texto legacy sin vincular a una posición operativa real">{s.nombre_puesto} <span style={{ color:'#f59e0b', fontSize:10 }}>(texto)</span></span>
                          : <span style={{ color:'#374151' }}>—</span>}
                    </td>
                    <td style={S.td}>{diasLabel(s.dias_semana)}</td>
                    <td style={S.td}>{s.guardia ? `${s.guardia.apellido}, ${s.guardia.nombre}` : <span style={{ color:'#64748b' }}>Sin asignar</span>}</td>
                    <td style={S.td}><Badge type={s.activo ? 'activo' : 'inactivo'}>{s.activo ? 'Activo' : 'Inactivo'}</Badge></td>
                    <td style={S.td}>
                      <div style={{ display:'flex', gap:6 }}>
                        <button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 12px', fontSize:12 }} onClick={() => abrirEditar(s)}>✏ Editar</button>
                        <button onClick={() => toggleActivo(s.id, s.activo)} style={{ ...S.btn, padding:'6px 12px', fontSize:12, background: s.activo ? 'rgba(239,68,68,.1)' : 'rgba(16,185,129,.1)', color: s.activo ? '#ef4444' : '#10b981', border: `1px solid ${s.activo ? 'rgba(239,68,68,.3)' : 'rgba(16,185,129,.3)'}` }}>{s.activo ? '⏸' : '▶'}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <Modal title={editId ? 'Editar Servicio' : 'Nuevo Servicio'} onClose={() => { setModal(false); setEditId(null); resetForm() }}
          footer={<><button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => { setModal(false); setEditId(null); resetForm() }}>Cancelar</button><button style={{ ...S.btn, ...S.btnPrimary }} onClick={guardar} disabled={loading}>{loading ? 'Guardando...' : 'Guardar'}</button></>}>
          <div style={{ marginBottom:16 }}><label style={S.label}>Objetivo *</label><select style={S.select} value={form.objetivo_id} onChange={e => setForm({...form, objetivo_id:e.target.value})}><option value="">Seleccionar objetivo...</option>{objetivos.filter((o: any) => o.estado === 'activo').map((o: any) => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
          <div style={{ marginBottom:16 }}><label style={S.label}>Turno Base *</label><select style={S.select} value={form.turno_base_id} onChange={e => setForm({...form, turno_base_id:e.target.value})}><option value="">Seleccionar turno...</option>{turnosBase.map((tb: any) => <option key={tb.id} value={tb.id}>{tb.nombre} ({tb.hora_inicio} → {tb.hora_fin})</option>)}</select></div>
          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Posición operativa *</label>
            {!form.objetivo_id ? (
              <div style={{ fontSize:12, color:'#64748b', marginTop:6 }}>Elegí primero el objetivo.</div>
            ) : puestosForm === null ? (
              <div style={{ fontSize:12, color:'#64748b', marginTop:6 }}>Cargando posiciones operativas…</div>
            ) : puestosForm.caso === 'sin_puestos' ? (
              <div style={{ fontSize:12, color:'#ef4444', marginTop:6 }}>{MENSAJE_SIN_PUESTOS_ACTIVOS}</div>
            ) : (
              <select style={S.select} value={form.puesto_id} onChange={e => setForm({...form, puesto_id:e.target.value})}>
                <option value="">Seleccionar posición operativa...</option>
                {puestosForm.puestos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            )}
            {form.nombre_puesto && !form.puesto_id && (
              <div style={{ fontSize:11, color:'#f59e0b', marginTop:6 }}>Texto anterior sin vincular: “{form.nombre_puesto}”. Elegí la posición operativa real que corresponde.</div>
            )}
            {errorForm && <div style={{ fontSize:12, color:'#ef4444', marginTop:6 }}>{errorForm}</div>}
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Días de la semana *</label>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:6 }}>
              {DIAS.map(d => { const sel = form.dias_semana.includes(d.num); return <button key={d.num} onClick={() => toggleDia(d.num)} style={{ padding:'8px 14px', borderRadius:8, fontSize:13, cursor:'pointer', fontWeight:600, border: sel ? '1px solid #f59e0b' : '1px solid #1e2d42', background: sel ? 'rgba(245,158,11,0.15)' : '#1a2235', color: sel ? '#f59e0b' : '#64748b' }}>{d.label}</button> })}
            </div>
            {form.dias_semana.length === 0 && <div style={{ color:'#ef4444', fontSize:12, marginTop:6 }}>Seleccioná al menos un día</div>}
          </div>
          <div style={{ marginBottom:16 }}><label style={S.label}>Guardia habitual (opcional)</label><select style={S.select} value={form.guardia_habitual_id} onChange={e => setForm({...form, guardia_habitual_id:e.target.value})}><option value="">Sin asignar</option>{guardias.filter((g: any) => g.estado === 'activo').map((g: any) => <option key={g.id} value={g.id}>{g.apellido}, {g.nombre}</option>)}</select></div>
          <div style={{ marginBottom:8 }}><label style={S.label}>Estado</label><select style={S.select} value={form.activo ? 'true' : 'false'} onChange={e => setForm({...form, activo: e.target.value === 'true'})}><option value="true">Activo</option><option value="false">Inactivo</option></select></div>
        </Modal>
      )}
    </div>
  )
}


// ── SOLICITUDES ADMINISTRATIVAS ───────────────────────────────
function SolicitudesAdmin({ user, guardias, setGuardias, objetivos, setObjetivos }: any) {
  const [solicitudes, setSolicitudes] = useState<SolicitudAdmin[]>([])
  const [loading, setLoading] = useState(true)
  const [accionLoading, setAccionLoading] = useState<string | null>(null)
  const [comentarios, setComentarios] = useState<Record<string, string>>({})
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error', texto: string } | null>(null)

  const cargar = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('solicitudes_admin')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      setMensaje({ tipo:'error', texto:error.message })
      setSolicitudes([])
    } else {
      setSolicitudes((data || []) as SolicitudAdmin[])
    }

    setLoading(false)
  }

  useEffect(() => { cargar() }, [])

  const tipoLabel = (tipo: TipoSolicitudAdmin) => {
    const labels: Record<TipoSolicitudAdmin, string> = {
      crear_objetivo: 'Crear objetivo',
      baja_objetivo: 'Baja de objetivo',
      crear_vigilador: 'Crear vigilador',
      baja_vigilador: 'Baja de vigilador',
    }

    return labels[tipo]
  }

  const nombreUsuario = (id?: string | null) => {
    if (!id) return '—'
    const usuario = guardias.find((g: Usuario) => g.id === id)
    return usuario ? `${usuario.apellido}, ${usuario.nombre}` : 'Usuario no encontrado'
  }

  const valorDetalle = (value: unknown) => {
    if (value === null || value === undefined || value === '') return '—'
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  const crearObjetivoDesdeSolicitud = async (datos: Record<string, any>) => {
    const lat = datos.lat === null || datos.lat === undefined || datos.lat === '' ? null : Number(datos.lat)
    const lng = datos.lng === null || datos.lng === undefined || datos.lng === '' ? null : Number(datos.lng)

    if (!String(datos.nombre || '').trim()) throw new Error('La solicitud no tiene nombre de objetivo.')
    if ((lat !== null && !Number.isFinite(lat)) || (lng !== null && !Number.isFinite(lng))) throw new Error('La solicitud tiene GPS inválido.')

    const payload = {
      nombre: String(datos.nombre).trim(),
      cliente: String(datos.cliente || '').trim() || null,
      direccion: String(datos.direccion || '').trim() || null,
      lat,
      lng,
      radio_metros: Number(datos.radio_metros) || 200,
      estado: 'activo',
    }

    const { data, error } = await supabase.from('objetivos').insert(payload).select().single()
    if (error) throw error
    if (data) setObjetivos((prev: Objetivo[]) => [...prev, data])
    return data?.id || null
  }

  const crearGuardiaDesdeSolicitud = async (datos: Record<string, any>) => {
    const rol = datos.rol === 'vigilador' ? 'vigilador' : 'guardia'

    if (!String(datos.nombre || '').trim()) throw new Error('La solicitud no tiene nombre.')
    if (!String(datos.apellido || '').trim()) throw new Error('La solicitud no tiene apellido.')
    if (!String(datos.legajo || '').trim()) throw new Error('La solicitud no tiene legajo.')

    const payload = {
      nombre: String(datos.nombre).trim(),
      apellido: String(datos.apellido).trim(),
      dni: String(datos.dni || '').trim() || null,
      telefono: String(datos.telefono || '').trim() || null,
      legajo: String(datos.legajo).trim(),
      email: String(datos.email || '').trim().toLowerCase() || null,
      estado: 'activo',
      rol,
      foto_url: String(datos.foto_url || '').trim() || null,
    }

    const { data, error } = await supabase.from('usuarios').insert(payload).select().single()
    if (error) throw error
    if (data) setGuardias((prev: Usuario[]) => [...prev, data])
    return data?.id || null
  }

  const inactivarObjetivo = async (id?: string | null) => {
    if (!id) throw new Error('La solicitud no tiene objetivo asociado.')

    const { data, error } = await supabase
      .from('objetivos')
      .update({ estado:'inactivo' })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    if (data) setObjetivos((prev: Objetivo[]) => prev.map(o => o.id === id ? data : o))
  }

  const inactivarGuardia = async (id?: string | null) => {
    if (!id) throw new Error('La solicitud no tiene vigilador asociado.')

    const { data, error } = await supabase
      .from('usuarios')
      .update({ estado:'inactivo' })
      .eq('id', id)
      .in('rol', ['guardia', 'vigilador'])
      .select()
      .single()

    if (error) throw error
    if (data) setGuardias((prev: Usuario[]) => prev.map(g => g.id === id ? data : g))
  }

  const cerrarSolicitud = async (solicitud: SolicitudAdmin, estado: EstadoSolicitudAdmin, entidadId?: string | null) => {
    const cierre: any = {
      estado,
      aprobado_por: user.id,
      fecha_aprobacion: new Date().toISOString(),
      comentario_admin: comentarios[solicitud.id]?.trim() || null,
    }

    if (entidadId) cierre.entidad_id = entidadId

    const { data, error } = await supabase
      .from('solicitudes_admin')
      .update(cierre)
      .eq('id', solicitud.id)
      .select()
      .single()

    if (error) throw error
    if (data) setSolicitudes(prev => prev.map(item => item.id === solicitud.id ? data as SolicitudAdmin : item))
  }

  const aprobar = async (solicitud: SolicitudAdmin) => {
    const datos = solicitud.datos_json || {}
    setAccionLoading(`aprobar-${solicitud.id}`)
    setMensaje(null)

    try {
      let entidadId = solicitud.entidad_id || null

      if (solicitud.tipo === 'crear_objetivo') entidadId = await crearObjetivoDesdeSolicitud(datos)
      if (solicitud.tipo === 'baja_objetivo') await inactivarObjetivo(solicitud.entidad_id)
      if (solicitud.tipo === 'crear_vigilador') entidadId = await crearGuardiaDesdeSolicitud(datos)
      if (solicitud.tipo === 'baja_vigilador') await inactivarGuardia(solicitud.entidad_id)

      await cerrarSolicitud(solicitud, 'aprobado', entidadId)
      setMensaje({ tipo:'ok', texto:'Solicitud aprobada correctamente.' })
    } catch (error) {
      setMensaje({ tipo:'error', texto:error instanceof Error ? error.message : 'No se pudo aprobar la solicitud.' })
    } finally {
      setAccionLoading(null)
    }
  }

  const rechazar = async (solicitud: SolicitudAdmin) => {
    setAccionLoading(`rechazar-${solicitud.id}`)
    setMensaje(null)

    try {
      await cerrarSolicitud(solicitud, 'rechazado')
      setMensaje({ tipo:'ok', texto:'Solicitud rechazada.' })
    } catch (error) {
      setMensaje({ tipo:'error', texto:error instanceof Error ? error.message : 'No se pudo rechazar la solicitud.' })
    } finally {
      setAccionLoading(null)
    }
  }

  const renderSolicitud = (solicitud: SolicitudAdmin, resoluble: boolean) => {
    const datos = solicitud.datos_json || {}
    const detalles = Object.entries(datos).slice(0, 8)

    return (
      <div key={solicitud.id} style={S.card}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'flex-start', marginBottom:14 }}>
          <div>
            <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, color:'#e2e8f0' }}>{tipoLabel(solicitud.tipo)}</div>
            <div style={{ color:'#64748b', fontSize:13, marginTop:4 }}>Solicitante: {nombreUsuario(solicitud.solicitante_id)}</div>
            <div style={{ color:'#64748b', fontSize:13 }}>{formatFecha(solicitud.created_at)}</div>
          </div>
          <Badge type={solicitud.estado}>{solicitud.estado}</Badge>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:10, marginBottom:14 }}>
          {detalles.map(([key, value]) => (
            <div key={key} style={{ background:'#1a2235', border:'1px solid #1e2d42', borderRadius:8, padding:10 }}>
              <div style={{ ...S.label, marginBottom:4 }}>{key.replace(/_/g, ' ')}</div>
              <div style={{ color:'#e2e8f0', fontSize:13 }}>{valorDetalle(value)}</div>
            </div>
          ))}
        </div>

        {solicitud.comentario_admin && (
          <div style={{ background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, padding:10, color:'#cbd5e1', fontSize:13, marginBottom:12 }}>
            Comentario admin: {solicitud.comentario_admin}
          </div>
        )}

        {resoluble && (
          <>
            <label style={S.label}>Comentario administrativo</label>
            <textarea
              style={{ ...S.input, resize:'vertical', minHeight:68, marginBottom:12 }}
              value={comentarios[solicitud.id] || ''}
              onChange={e => setComentarios(prev => ({ ...prev, [solicitud.id]: e.target.value }))}
              placeholder="Motivo o aclaración para el historial..."
            />
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button
                style={{ ...S.btn, background:'rgba(239,68,68,.14)', color:'#fca5a5', border:'1px solid rgba(239,68,68,.35)' }}
                onClick={() => rechazar(solicitud)}
                disabled={accionLoading === `rechazar-${solicitud.id}` || accionLoading === `aprobar-${solicitud.id}`}
              >
                {accionLoading === `rechazar-${solicitud.id}` ? 'Rechazando...' : 'Rechazar'}
              </button>
              <button
                style={{ ...S.btn, background:'rgba(16,185,129,.16)', color:'#86efac', border:'1px solid rgba(16,185,129,.35)' }}
                onClick={() => aprobar(solicitud)}
                disabled={accionLoading === `rechazar-${solicitud.id}` || accionLoading === `aprobar-${solicitud.id}`}
              >
                {accionLoading === `aprobar-${solicitud.id}` ? 'Aprobando...' : 'Aprobar'}
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  const pendientes = solicitudes.filter(s => s.estado === 'pendiente')
  const historial = solicitudes.filter(s => s.estado !== 'pendiente')

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', gap:16, alignItems:'flex-end', marginBottom:24 }}>
        <div>
          <div style={S.title}>Solicitudes Admin</div>
          <div style={S.sub2}>Altas y bajas solicitadas por supervisores.</div>
        </div>
        <button style={{ ...S.btn, ...S.btnSecondary }} onClick={cargar} disabled={loading}>
          {loading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      {mensaje && (
        <div style={{ background: mensaje.tipo === 'ok' ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.12)', border:`1px solid ${mensaje.tipo === 'ok' ? 'rgba(16,185,129,.35)' : 'rgba(239,68,68,.35)'}`, color: mensaje.tipo === 'ok' ? '#86efac' : '#fca5a5', borderRadius:8, padding:12, marginBottom:16 }}>
          {mensaje.texto}
        </div>
      )}

      <div style={S.statGrid}>
        <div style={S.card}><div style={S.label}>Pendientes</div><strong>{pendientes.length}</strong></div>
        <div style={S.card}><div style={S.label}>Aprobadas</div><strong>{solicitudes.filter(s => s.estado === 'aprobado').length}</strong></div>
        <div style={S.card}><div style={S.label}>Rechazadas</div><strong>{solicitudes.filter(s => s.estado === 'rechazado').length}</strong></div>
      </div>

      <section style={{ marginBottom:28 }}>
        <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, marginBottom:12 }}>Pendientes</div>
        {loading ? (
          <div style={{ ...S.card, color:'#64748b', textAlign:'center' }}>Cargando solicitudes...</div>
        ) : pendientes.length === 0 ? (
          <div style={{ ...S.card, color:'#64748b', textAlign:'center' }}>No hay solicitudes pendientes.</div>
        ) : pendientes.map(s => renderSolicitud(s, true))}
      </section>

      <section>
        <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, marginBottom:12 }}>Historial</div>
        {historial.length === 0 ? (
          <div style={{ ...S.card, color:'#64748b', textAlign:'center' }}>No hay historial de solicitudes.</div>
        ) : historial.map(s => renderSolicitud(s, false))}
      </section>
    </div>
  )
}


// ── SUPERVISORES DE GUARDIA ──────────────────────────────────
function SupervisoresGuardia({ guardias, user, zonas = [] }: any) {
  const hoy = new Date().toLocaleDateString('sv-SE')
  const rolesOperativos = [
    { value: 'supervisor', label: 'Supervisor' },
    { value: 'jefe_operativo', label: 'Jefe operativo' },
    { value: 'director_tecnico', label: 'Director técnico' },
  ]
  const DIAS_GUARDIA = [
    { num:1, label:'Lun' }, { num:2, label:'Mar' }, { num:3, label:'Mié' },
    { num:4, label:'Jue' }, { num:5, label:'Vie' }, { num:6, label:'Sáb' },
    { num:7, label:'Dom' },
  ]
  // La zona ya no tiene default: antes venía fija en 'Rosario / General', que no
  // es el nombre de ninguna zona de zonas_operativas, así que toda guardia
  // cargada con el default quedaba invisible para la búsqueda del supervisor de
  // guardia (compara contra zonas_operativas.nombre). Ahora se elige del catálogo.
  const formInicial = () => ({
    supervisor_id: '',
    fecha: hoy,
    hora_inicio: '18:00',
    hora_fin: '06:00',
    zona: '',
    rol_operativo: 'supervisor',
    estado: 'activo',
    tipo_evento: 'normal',
    observacion: '',
  })

  const formGeneracionInicial = () => ({
    supervisor_id: '',
    zona: '',
    desde: hoy,
    hasta: hoy,
    dias_semana: [1, 2, 3, 4, 5] as number[],
    hora_inicio: '18:00',
    hora_fin: '06:00',
    rol_operativo: 'supervisor',
    estado: 'activo',
    observacion: '',
  })

  const formReglaInicial = () => ({
    supervisor_id: '',
    zona_id: '',
    dias_semana: [1, 2, 3, 4, 5] as number[],
    hora_inicio: '07:00',
    hora_fin: '19:00',
    rol_operativo: 'supervisor',
    observacion: '',
    activo: true,
    vigencia_desde: '',
    vigencia_hasta: '',
  })

  const [guardiasSupervisor, setGuardiasSupervisor] = useState<any[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  // Fila que se está editando, para saber qué cambió respecto de lo generado.
  const [editOriginal, setEditOriginal] = useState<any | null>(null)
  const [historialSeleccionado, setHistorialSeleccionado] = useState<any | null>(null)
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error', texto: string } | null>(null)
  const [form, setForm] = useState(formInicial)
  const [modalGenerar, setModalGenerar] = useState(false)
  const [formGen, setFormGen] = useState(formGeneracionInicial)
  const [prevision, setPrevision] = useState<PrevisionGeneracion | null>(null)
  const [previsionLoading, setPrevisionLoading] = useState(false)
  const [generando, setGenerando] = useState(false)

  // Programación semanal
  const [reglas, setReglas] = useState<any[]>([])
  const [reglasDisponibles, setReglasDisponibles] = useState(true)
  const [modalRegla, setModalRegla] = useState(false)
  const [editReglaId, setEditReglaId] = useState<string | null>(null)
  const [formRegla, setFormRegla] = useState(formReglaInicial)
  const [modalMes, setModalMes] = useState(false)
  const [mesGenerar, setMesGenerar] = useState(hoy.slice(0, 7))
  const [previsionMes, setPrevisionMes] = useState<PrevisionMes | null>(null)
  const [previsionMesLoading, setPrevisionMesLoading] = useState(false)
  const [generandoMes, setGenerandoMes] = useState(false)

  const supervisoresDisponibles = guardias
    .filter((g: any) => ['supervisor', 'admin'].includes(g.rol))
    .sort((a: any, b: any) => `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`))

  const zonasActivas = (zonas as any[]).filter(z => (z.estado || 'activo') !== 'inactivo')

  /**
   * Opciones del select de zona. Se agrega la zona ya cargada en la fila cuando
   * no está en el catálogo (texto libre viejo o zona inactivada): editar una
   * guardia no puede cambiarle la zona en silencio.
   */
  const opcionesZona = (zonaActual: string) => {
    const nombres = zonasActivas.map(z => z.nombre)
    const actual = (zonaActual || '').trim()
    if (actual && !nombres.some(n => normalizarTextoGuardia(n) === normalizarTextoGuardia(actual))) {
      return [...nombres, actual]
    }
    return nombres
  }

  const cargar = async () => {
    setLoadingData(true)
    const { data, error } = await supabase
      .from('supervisores_guardia')
      .select('*')
      .order('fecha', { ascending: false })
      .order('hora_inicio', { ascending: true })

    if (error) {
      setMensaje({ tipo:'error', texto:error.message })
    } else {
      setGuardiasSupervisor(data || [])
    }

    setLoadingData(false)
  }

  // Las reglas semanales son una capa nueva: si todavía no se corrió la
  // migración, la pantalla sigue funcionando como antes en vez de romperse.
  const cargarReglas = async () => {
    const { data, error } = await supabase
      .from('supervisor_guardia_reglas')
      .select('*')
      .order('created_at', { ascending: true })

    if (error) {
      if (/supervisor_guardia_reglas|schema cache|does not exist/i.test(error.message)) {
        setReglasDisponibles(false)
        return
      }
      setMensaje({ tipo:'error', texto:error.message })
      return
    }

    setReglasDisponibles(true)
    setReglas(data || [])
  }

  useEffect(() => { cargar(); cargarReglas() }, [])

  const nombreUsuario = (id?: string | null) => {
    const usuario = guardias.find((g: any) => g.id === id)
    return usuario ? `${usuario.apellido}, ${usuario.nombre}` : 'Sin supervisor'
  }

  const nombreZona = (zonaId?: string | null) =>
    (zonas as any[]).find(z => z.id === zonaId)?.nombre || ''

  const rolLabel = (rol?: string | null) => rolesOperativos.find(r => r.value === rol)?.label || rol || '—'
  const horario = (item: any) => `${formatHoraTurno(item.hora_inicio)} a ${formatHoraTurno(item.hora_fin)}`

  const abrirNuevo = () => {
    setForm(formInicial())
    setEditId(null)
    setEditOriginal(null)
    setMensaje(null)
    setModal(true)
  }

  const cerrarModalGuardia = () => {
    setModal(false)
    setEditId(null)
    setEditOriginal(null)
    setForm(formInicial())
  }

  const abrirEditar = (item: any) => {
    setForm({
      supervisor_id: item.supervisor_id || '',
      fecha: item.fecha || hoy,
      hora_inicio: formatHoraTurno(item.hora_inicio) === '—' ? '18:00' : formatHoraTurno(item.hora_inicio),
      hora_fin: formatHoraTurno(item.hora_fin) === '—' ? '06:00' : formatHoraTurno(item.hora_fin),
      zona: item.zona || '',
      rol_operativo: item.rol_operativo || 'supervisor',
      estado: item.estado || 'activo',
      tipo_evento: item.tipo_evento || 'normal',
      observacion: item.observacion || '',
    })
    setEditOriginal(item)
    setEditId(item.id)
    setMensaje(null)
    setModal(true)
  }

  const guardar = async () => {
    if (!form.fecha || !form.hora_inicio || !form.hora_fin || !form.supervisor_id) {
      setMensaje({ tipo:'error', texto:'Completá fecha, horario y supervisor asignado.' })
      return
    }

    if (!form.zona.trim()) {
      setMensaje({ tipo:'error', texto:'Elegí la zona operativa: sin zona la guardia no se encuentra desde los objetivos.' })
      return
    }

    setLoading(true)
    setMensaje(null)

    const payload: any = {
      supervisor_id: form.supervisor_id,
      fecha: form.fecha,
      hora_inicio: form.hora_inicio,
      hora_fin: form.hora_fin,
      zona: form.zona.trim(),
      rol_operativo: form.rol_operativo,
      estado: form.estado,
      observacion: form.observacion.trim() || null,
    }

    // Las excepciones son columnas de la migración de programación semanal. Si
    // todavía no se corrió, la pantalla guarda como guardaba antes en lugar de
    // fallar por una columna que no existe.
    if (reglasDisponibles) {
      payload.tipo_evento = form.tipo_evento

      // Reemplazo: si a una guardia ya cargada se le cambia el supervisor,
      // queda registrado a quién está cubriendo. Sólo se escribe la primera
      // vez, para que un segundo cambio no borre al titular original.
      if (editId && editOriginal?.supervisor_id && editOriginal.supervisor_id !== form.supervisor_id && !editOriginal.supervisor_original_id) {
        payload.supervisor_original_id = editOriginal.supervisor_id
      }
    }

    if (!editId) payload.creado_por = user?.id || null

    const query = editId
      ? supabase.from('supervisores_guardia').update(payload).eq('id', editId)
      : supabase.from('supervisores_guardia').insert(payload)

    const { data, error } = await query.select('*').single()

    if (error) {
      setMensaje({ tipo:'error', texto:error.message })
    } else if (data) {
      setGuardiasSupervisor(prev => editId ? prev.map(item => item.id === editId ? data : item) : [data, ...prev])
      setMensaje({ tipo:'ok', texto: editId ? 'Guardia actualizada.' : 'Guardia de supervisor creada.' })
      cerrarModalGuardia()
    }

    setLoading(false)
  }

  const cambiarEstado = async (item: any) => {
    const nuevoEstado = item.estado === 'inactivo' ? 'activo' : 'inactivo'
    const { data, error } = await supabase
      .from('supervisores_guardia')
      .update({ estado: nuevoEstado })
      .eq('id', item.id)
      .select('*')
      .single()

    if (error) {
      setMensaje({ tipo:'error', texto:error.message })
      return
    }

    if (data) {
      setGuardiasSupervisor(prev => prev.map(row => row.id === item.id ? data : row))
      setMensaje({ tipo:'ok', texto: nuevoEstado === 'inactivo' ? 'Guardia inactivada.' : 'Guardia reactivada.' })
    }
  }

  // ── Generación por rango ──────────────────────────────────────────────────
  //
  // Cargar día por día una zona completa era inviable. Acá se elige supervisor,
  // zona, rango, días de la semana y horario; se cuenta cuántas filas salen y
  // recién después se inserta. La expansión y el descarte de duplicados los
  // hace lib/guardias-supervisor: esta parte sólo consulta y escribe.

  const abrirGenerar = () => {
    setFormGen(formGeneracionInicial())
    setPrevision(null)
    setMensaje(null)
    setModalGenerar(true)
  }

  const cerrarGenerar = () => {
    setModalGenerar(false)
    setFormGen(formGeneracionInicial())
    setPrevision(null)
  }

  // Cualquier cambio invalida el conteo: no se inserta contra una vista previa
  // que ya no corresponde a lo que muestra el formulario.
  const editarGen = (patch: any) => {
    setFormGen(prev => ({ ...prev, ...patch }))
    setPrevision(null)
  }

  const toggleDiaGen = (num: number) => {
    setFormGen(prev => ({
      ...prev,
      dias_semana: prev.dias_semana.includes(num)
        ? prev.dias_semana.filter(d => d !== num)
        : [...prev.dias_semana, num].sort((a, b) => a - b),
    }))
    setPrevision(null)
  }

  const previsualizar = async () => {
    setMensaje(null)

    // Primero la validación pura: si el formulario está mal, no se consulta.
    const soloValidacion = previsualizarGeneracion(formGen, [])
    if (soloValidacion.errores.length) {
      setPrevision(soloValidacion)
      return
    }

    setPrevisionLoading(true)

    // Las guardias ya cargadas de ese supervisor dentro del rango. Se traen
    // todas, incluidas las inactivas: una fila idéntica inactivada sigue siendo
    // la misma carga, duplicarla no la reactiva.
    const { data, error } = await supabase
      .from('supervisores_guardia')
      .select('supervisor_id,zona,fecha,hora_inicio,hora_fin')
      .eq('supervisor_id', formGen.supervisor_id)
      .gte('fecha', formGen.desde)
      .lte('fecha', formGen.hasta)

    if (error) {
      setMensaje({ tipo:'error', texto:error.message })
      setPrevisionLoading(false)
      return
    }

    setPrevision(previsualizarGeneracion(formGen, data || []))
    setPrevisionLoading(false)
  }

  const generar = async () => {
    if (!prevision || prevision.errores.length || prevision.aCrear.length === 0) return

    setGenerando(true)
    setMensaje(null)

    const payload = prevision.aCrear.map(fila => ({ ...fila, creado_por: user?.id || null }))
    const { error } = await supabase.from('supervisores_guardia').insert(payload)

    if (error) {
      setMensaje({ tipo:'error', texto:error.message })
      setGenerando(false)
      return
    }

    const creadas = prevision.aCrear.length
    const omitidas = prevision.duplicadas.length
    setGenerando(false)
    cerrarGenerar()
    await cargar()
    setMensaje({
      tipo:'ok',
      texto: `Se crearon ${creadas} guardia(s)${omitidas ? ` · ${omitidas} ya existían y se omitieron` : ''}.`,
    })
  }

  // ── Programación semanal ──────────────────────────────────────────────────
  //
  // La regla es la plantilla; el calendario efectivo sigue siendo
  // supervisores_guardia. Un franco, un reemplazo o un cambio de horario se
  // cargan sobre la guardia del día y NO vuelven hacia la regla.

  const reglasSemanales = (): ReglaSemanal[] => reglas.map(r => ({
    id: r.id,
    supervisor_id: r.supervisor_id,
    zona_id: r.zona_id,
    zona_nombre: nombreZona(r.zona_id),
    dias_semana: r.dias_semana || [],
    hora_inicio: r.hora_inicio,
    hora_fin: r.hora_fin,
    rol_operativo: r.rol_operativo,
    observacion: r.observacion,
    activo: r.activo,
    vigencia_desde: r.vigencia_desde,
    vigencia_hasta: r.vigencia_hasta,
  }))

  const abrirNuevaRegla = () => {
    setFormRegla(formReglaInicial())
    setEditReglaId(null)
    setMensaje(null)
    setModalRegla(true)
  }

  const abrirEditarRegla = (r: any) => {
    setFormRegla({
      supervisor_id: r.supervisor_id || '',
      zona_id: r.zona_id || '',
      dias_semana: r.dias_semana || [],
      hora_inicio: formatHoraTurno(r.hora_inicio) === '—' ? '07:00' : formatHoraTurno(r.hora_inicio),
      hora_fin: formatHoraTurno(r.hora_fin) === '—' ? '19:00' : formatHoraTurno(r.hora_fin),
      rol_operativo: r.rol_operativo || 'supervisor',
      observacion: r.observacion || '',
      activo: r.activo !== false,
      vigencia_desde: r.vigencia_desde || '',
      vigencia_hasta: r.vigencia_hasta || '',
    })
    setEditReglaId(r.id)
    setMensaje(null)
    setModalRegla(true)
  }

  const toggleDiaRegla = (num: number) => {
    setFormRegla(prev => ({
      ...prev,
      dias_semana: prev.dias_semana.includes(num)
        ? prev.dias_semana.filter(d => d !== num)
        : [...prev.dias_semana, num].sort((a, b) => a - b),
    }))
  }

  const guardarRegla = async () => {
    if (!formRegla.supervisor_id || !formRegla.zona_id || !formRegla.dias_semana.length || !formRegla.hora_inicio || !formRegla.hora_fin) {
      setMensaje({ tipo:'error', texto:'Completá supervisor, zona, días y horario.' })
      return
    }

    if (formRegla.vigencia_desde && formRegla.vigencia_hasta && formRegla.vigencia_hasta < formRegla.vigencia_desde) {
      setMensaje({ tipo:'error', texto:'La vigencia "hasta" no puede ser anterior a la vigencia "desde".' })
      return
    }

    setLoading(true)
    setMensaje(null)

    const payload: any = {
      supervisor_id: formRegla.supervisor_id,
      zona_id: formRegla.zona_id,
      dias_semana: formRegla.dias_semana,
      hora_inicio: formRegla.hora_inicio,
      hora_fin: formRegla.hora_fin,
      rol_operativo: formRegla.rol_operativo,
      observacion: formRegla.observacion.trim() || null,
      activo: formRegla.activo,
      vigencia_desde: formRegla.vigencia_desde || null,
      vigencia_hasta: formRegla.vigencia_hasta || null,
    }

    if (!editReglaId) payload.creado_por = user?.id || null

    const query = editReglaId
      ? supabase.from('supervisor_guardia_reglas').update(payload).eq('id', editReglaId)
      : supabase.from('supervisor_guardia_reglas').insert(payload)

    const { data, error } = await query.select('*').single()

    if (error) {
      setMensaje({ tipo:'error', texto:error.message })
    } else if (data) {
      setReglas(prev => editReglaId ? prev.map(r => r.id === editReglaId ? data : r) : [...prev, data])
      setMensaje({ tipo:'ok', texto: editReglaId ? 'Regla actualizada.' : 'Regla semanal creada.' })
      setModalRegla(false)
      setEditReglaId(null)
      setFormRegla(formReglaInicial())
    }

    setLoading(false)
  }

  // Desactivar una regla no borra las guardias que ya generó: deja de producir
  // filas nuevas de acá en adelante. El calendario ya publicado se corrige día
  // por día, que es donde vive la excepción.
  const toggleRegla = async (r: any) => {
    const { data, error } = await supabase
      .from('supervisor_guardia_reglas')
      .update({ activo: !(r.activo !== false) })
      .eq('id', r.id)
      .select('*')
      .single()

    if (error) {
      setMensaje({ tipo:'error', texto:error.message })
      return
    }

    if (data) {
      setReglas(prev => prev.map(x => x.id === r.id ? data : x))
      setPrevisionMes(null)
    }
  }

  const abrirGenerarMes = () => {
    setMesGenerar(hoy.slice(0, 7))
    setPrevisionMes(null)
    setMensaje(null)
    setModalMes(true)
  }

  const previsualizarMesGuardias = async () => {
    setMensaje(null)
    setPrevisionMesLoading(true)

    const rango = rangoDelMes(mesGenerar)

    // Se traen TODAS las guardias del mes, de cualquier supervisor: la
    // deduplicación necesita ver también lo cargado a mano.
    const { data, error } = await supabase
      .from('supervisores_guardia')
      .select('supervisor_id,zona,fecha,hora_inicio,hora_fin,regla_id')
      .gte('fecha', rango.desde)
      .lte('fecha', rango.hasta)

    if (error) {
      setMensaje({ tipo:'error', texto:error.message })
      setPrevisionMesLoading(false)
      return
    }

    setPrevisionMes(previsualizarDesdeReglas(reglasSemanales(), rango, data || []))
    setPrevisionMesLoading(false)
  }

  const generarMes = async () => {
    if (!previsionMes || previsionMes.errores.length || previsionMes.aCrear.length === 0) return

    setGenerandoMes(true)
    setMensaje(null)

    const payload = previsionMes.aCrear.map(fila => ({ ...fila, creado_por: user?.id || null }))
    const { error } = await supabase.from('supervisores_guardia').insert(payload)

    if (error) {
      setMensaje({ tipo:'error', texto:error.message })
      setGenerandoMes(false)
      return
    }

    const creadas = previsionMes.aCrear.length
    setGenerandoMes(false)
    setModalMes(false)
    setPrevisionMes(null)
    await cargar()
    setMensaje({ tipo:'ok', texto:`Se generaron ${creadas} guardia(s) para ${mesGenerar}.` })
  }

  const zonasConGuardias = guardiasSupervisor
    .map(item => (item.zona || '').trim())
    .filter((zona, i, todas) => zona && todas.indexOf(zona) === i)

  const historial = historialSeleccionado
    ? guardiasSupervisor
      .filter(item => item.supervisor_id === historialSeleccionado.supervisor_id)
      .sort((a, b) => `${b.fecha} ${b.hora_inicio}`.localeCompare(`${a.fecha} ${a.hora_inicio}`))
    : []

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', marginBottom:24 }}>
        <div style={{ flex:1 }}>
          <div style={S.title}>Supervisores de guardia</div>
          <div style={S.sub2}>Jefe operativo {JEFE_OPERATIVO_GUARDIA} · Director técnico {DIRECTOR_TECNICO_GUARDIA}</div>
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          {reglasDisponibles && <button style={{ ...S.btn, ...S.btnSecondary }} onClick={abrirGenerarMes}>🗓️ Generar mes</button>}
          <button style={{ ...S.btn, ...S.btnSecondary }} onClick={abrirGenerar}>📅 Generar por rango</button>
          <button style={{ ...S.btn, ...S.btnPrimary }} onClick={abrirNuevo}>+ Nueva guardia</button>
        </div>
      </div>

      {reglasDisponibles && (
        <div style={S.card}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
            <div>
              <div style={{ fontFamily:'Syne,sans-serif', fontWeight:700 }}>Programación semanal</div>
              <div style={{ fontSize:13, color:'#64748b' }}>
                La plantilla. Genera las guardias del calendario; los francos, reemplazos y cambios se cargan sobre el día, no acá.
              </div>
            </div>
            <button style={{ ...S.btn, ...S.btnSecondary }} onClick={abrirNuevaRegla}>+ Nueva regla</button>
          </div>

          {reglas.length === 0 ? (
            <div style={{ textAlign:'center', padding:28, color:'#64748b' }}>
              No hay reglas cargadas. Una regla es un bloque horario con sus días: un supervisor puede tener varias.
            </div>
          ) : (
            <div style={{ overflowX:'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Supervisor</th>
                    <th style={S.th}>Zona</th>
                    <th style={S.th}>Días</th>
                    <th style={S.th}>Horario</th>
                    <th style={S.th}>Vigencia</th>
                    <th style={S.th}>Estado</th>
                    <th style={S.th}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {reglas.map(r => (
                    <tr key={r.id}>
                      <td style={S.td}>{nombreUsuario(r.supervisor_id)}</td>
                      <td style={S.td}>{nombreZona(r.zona_id) || <span style={{ color:'#ef4444' }}>Zona borrada</span>}</td>
                      <td style={S.td}>{etiquetaDias(r.dias_semana || [])}</td>
                      <td style={S.td}>
                        {formatHoraTurno(r.hora_inicio)} a {formatHoraTurno(r.hora_fin)}
                        {formatHoraTurno(r.hora_fin) <= formatHoraTurno(r.hora_inicio) && (
                          <span style={{ color:'#64748b', fontSize:12 }}> · nocturno</span>
                        )}
                      </td>
                      <td style={{ ...S.td, color:'#94a3b8', fontSize:13 }}>
                        {r.vigencia_desde || r.vigencia_hasta
                          ? `${r.vigencia_desde ? formatFecha(r.vigencia_desde) : 'sin inicio'} → ${r.vigencia_hasta ? formatFecha(r.vigencia_hasta) : 'sin fin'}`
                          : 'Permanente'}
                      </td>
                      <td style={S.td}><Badge type={r.activo !== false ? 'activo' : 'inactivo'}>{r.activo !== false ? 'activa' : 'inactiva'}</Badge></td>
                      <td style={S.td}>
                        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                          <button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 10px', fontSize:12 }} onClick={() => abrirEditarRegla(r)}>Editar</button>
                          <button
                            style={{ ...S.btn, padding:'6px 10px', fontSize:12, background: r.activo !== false ? 'rgba(239,68,68,.1)' : 'rgba(16,185,129,.1)', color: r.activo !== false ? '#ef4444' : '#10b981', border:`1px solid ${r.activo !== false ? 'rgba(239,68,68,.3)' : 'rgba(16,185,129,.3)'}` }}
                            onClick={() => toggleRegla(r)}
                          >
                            {r.activo !== false ? 'Desactivar' : 'Activar'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div style={{ ...S.card, display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:12 }}>
        <div><div style={S.label}>Guardias cargadas</div><strong>{guardiasSupervisor.length}</strong></div>
        <div>
          <div style={S.label}>Zonas con guardias</div>
          <strong>{zonasConGuardias.length ? zonasConGuardias.join(' · ') : 'Ninguna'}</strong>
        </div>
        <div><div style={S.label}>Regla de intervención</div><strong>Cualquier supervisor logueado puede intervenir</strong></div>
      </div>

      {mensaje && (
        <div style={{ ...S.card, borderColor: mensaje.tipo === 'ok' ? 'rgba(16,185,129,.35)' : 'rgba(239,68,68,.35)', color: mensaje.tipo === 'ok' ? '#10b981' : '#ef4444', padding:14 }}>
          {mensaje.texto}
        </div>
      )}

      <div style={S.card}>
        {loadingData ? (
          <div style={{ textAlign:'center', padding:48, color:'#64748b' }}>Cargando...</div>
        ) : guardiasSupervisor.length === 0 ? (
          <div style={{ textAlign:'center', padding:48, color:'#64748b' }}>No hay guardias de supervisor creadas.</div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Fecha</th>
                  <th style={S.th}>Horario</th>
                  <th style={S.th}>Supervisor asignado</th>
                  <th style={S.th}>Rol operativo</th>
                  <th style={S.th}>Zona</th>
                  <th style={S.th}>Estado</th>
                  <th style={S.th}>Observación</th>
                  <th style={S.th}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {guardiasSupervisor.map(item => (
                  <tr key={item.id}>
                    <td style={S.td}>{formatFecha(item.fecha)}</td>
                    <td style={S.td}>{horario(item)}</td>
                    <td style={S.td}>
                      {nombreUsuario(item.supervisor_id)}
                      {item.supervisor_original_id && (
                        <div style={{ fontSize:12, color:'#f59e0b' }}>cubre a {nombreUsuario(item.supervisor_original_id)}</div>
                      )}
                    </td>
                    <td style={S.td}>{rolLabel(item.rol_operativo)}</td>
                    <td style={S.td}>{item.zona || <span style={{ color:'#ef4444' }}>Sin zona</span>}</td>
                    <td style={S.td}>
                      <Badge type={item.estado || 'activo'}>{item.estado || 'activo'}</Badge>
                      {item.tipo_evento && item.tipo_evento !== 'normal' && (
                        <div style={{ fontSize:12, marginTop:4, color: TIPOS_SIN_COBERTURA.has(item.tipo_evento) ? '#ef4444' : '#f59e0b' }}>
                          {TIPOS_EVENTO_GUARDIA.find(t => t.value === item.tipo_evento)?.label || item.tipo_evento}
                        </div>
                      )}
                    </td>
                    <td style={{ ...S.td, color:'#94a3b8', minWidth:180 }}>{item.observacion || '—'}</td>
                    <td style={S.td}>
                      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                        <button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 10px', fontSize:12 }} onClick={() => abrirEditar(item)}>Editar</button>
                        <button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 10px', fontSize:12 }} onClick={() => setHistorialSeleccionado(item)}>Historial</button>
                        <button
                          style={{ ...S.btn, padding:'6px 10px', fontSize:12, background: item.estado === 'inactivo' ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)', color: item.estado === 'inactivo' ? '#10b981' : '#ef4444', border:`1px solid ${item.estado === 'inactivo' ? 'rgba(16,185,129,.3)' : 'rgba(239,68,68,.3)'}` }}
                          onClick={() => cambiarEstado(item)}
                        >
                          {item.estado === 'inactivo' ? 'Reactivar' : 'Inactivar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {historialSeleccionado && (
        <div style={S.card}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
            <div>
              <div style={{ fontFamily:'Syne,sans-serif', fontWeight:700 }}>Historial de {nombreUsuario(historialSeleccionado.supervisor_id)}</div>
              <div style={{ fontSize:13, color:'#64748b' }}>{historial.length} guardia(s) registradas</div>
            </div>
            <button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => setHistorialSeleccionado(null)}>Cerrar</button>
          </div>
          {historial.map(item => (
            <div key={`historial-${item.id}`} style={{ display:'grid', gridTemplateColumns:'140px 140px 1fr 120px', gap:12, padding:'10px 0', borderTop:'1px solid #1e2d42', fontSize:13 }}>
              <span>{formatFecha(item.fecha)}</span>
              <span>{horario(item)}</span>
              <span>{item.observacion || 'Sin observación'}</span>
              <Badge type={item.estado || 'activo'}>{item.estado || 'activo'}</Badge>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <Modal title={editId ? 'Editar guardia de supervisor' : 'Nueva guardia de supervisor'} onClose={cerrarModalGuardia}
          footer={<><button style={{ ...S.btn, ...S.btnSecondary }} onClick={cerrarModalGuardia}>Cancelar</button><button style={{ ...S.btn, ...S.btnPrimary }} onClick={guardar} disabled={loading}>{loading ? 'Guardando...' : 'Guardar'}</button></>}>
          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}><label style={S.label}>Fecha *</label><input type="date" style={S.input} value={form.fecha} onChange={e => setForm({...form, fecha:e.target.value})} /></div>
            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Zona operativa *</label>
              <select style={S.select} value={form.zona} onChange={e => setForm({...form, zona:e.target.value})}>
                <option value="">Seleccionar zona...</option>
                {opcionesZona(form.zona).map(nombre => <option key={nombre} value={nombre}>{nombre}</option>)}
              </select>
            </div>
          </div>
          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}><label style={S.label}>Hora inicio *</label><input type="time" style={S.input} value={form.hora_inicio} onChange={e => setForm({...form, hora_inicio:e.target.value})} /></div>
            <div style={{ marginBottom:16 }}><label style={S.label}>Hora fin *</label><input type="time" style={S.input} value={form.hora_fin} onChange={e => setForm({...form, hora_fin:e.target.value})} /></div>
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Supervisor asignado *</label>
            <select style={S.select} value={form.supervisor_id} onChange={e => setForm({...form, supervisor_id:e.target.value})}>
              <option value="">Seleccionar supervisor...</option>
              {supervisoresDisponibles.filter((s: any) => s.estado === 'activo' || s.id === form.supervisor_id).map((s: any) => (
                <option key={s.id} value={s.id}>{s.apellido}, {s.nombre}</option>
              ))}
            </select>
          </div>
          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Rol operativo</label>
              <select style={S.select} value={form.rol_operativo} onChange={e => setForm({...form, rol_operativo:e.target.value})}>
                {rolesOperativos.map(rol => <option key={rol.value} value={rol.value}>{rol.label}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Estado</label>
              <select style={S.select} value={form.estado} onChange={e => setForm({...form, estado:e.target.value})}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </div>
          </div>
          {reglasDisponibles && (
            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Excepción del día</label>
              <select style={S.select} value={form.tipo_evento} onChange={e => setForm({...form, tipo_evento:e.target.value})}>
                {TIPOS_EVENTO_GUARDIA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <div style={{ fontSize:12, color:'#64748b', marginTop:6 }}>
                Franco y ausencia significan que ese día no hay cobertura. La excepción es sólo de este día: no modifica la programación semanal.
              </div>
            </div>
          )}

          {editOriginal?.regla_id && (
            <div style={{ marginBottom:16, fontSize:12, color:'#64748b' }}>
              Generada desde la programación semanal. Editarla no cambia la regla, y regenerar el mes no vuelve a crear este día.
            </div>
          )}

          {editOriginal?.supervisor_original_id && (
            <div style={{ marginBottom:16, fontSize:12, color:'#f59e0b' }}>
              Cubre a {nombreUsuario(editOriginal.supervisor_original_id)}
            </div>
          )}

          <div style={{ marginBottom:8 }}>
            <label style={S.label}>Observación</label>
            <textarea style={{ ...S.input, minHeight:90, resize:'vertical' }} value={form.observacion} onChange={e => setForm({...form, observacion:e.target.value})} placeholder="Comentario operativo opcional" />
          </div>
        </Modal>
      )}

      {modalGenerar && (
        <Modal
          title="Generar guardias por rango"
          onClose={cerrarGenerar}
          footer={
            <>
              <button style={{ ...S.btn, ...S.btnSecondary }} onClick={cerrarGenerar}>Cancelar</button>
              {prevision && !prevision.errores.length && prevision.aCrear.length > 0 ? (
                <button style={{ ...S.btn, ...S.btnPrimary }} onClick={generar} disabled={generando}>
                  {generando ? 'Creando...' : `Crear ${prevision.aCrear.length} guardia(s)`}
                </button>
              ) : (
                <button style={{ ...S.btn, ...S.btnPrimary }} onClick={previsualizar} disabled={previsionLoading}>
                  {previsionLoading ? 'Calculando...' : 'Ver cuántas se crean'}
                </button>
              )}
            </>
          }
        >
          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Supervisor asignado *</label>
            <select style={S.select} value={formGen.supervisor_id} onChange={e => editarGen({ supervisor_id:e.target.value })}>
              <option value="">Seleccionar supervisor...</option>
              {supervisoresDisponibles.filter((s: any) => s.estado === 'activo').map((s: any) => (
                <option key={s.id} value={s.id}>{s.apellido}, {s.nombre}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Zona operativa *</label>
            <select style={S.select} value={formGen.zona} onChange={e => editarGen({ zona:e.target.value })}>
              <option value="">Seleccionar zona...</option>
              {zonasActivas.map((z: any) => <option key={z.id} value={z.nombre}>{z.nombre}</option>)}
            </select>
          </div>

          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}><label style={S.label}>Desde *</label><input type="date" style={S.input} value={formGen.desde} onChange={e => editarGen({ desde:e.target.value })} /></div>
            <div style={{ marginBottom:16 }}><label style={S.label}>Hasta *</label><input type="date" style={S.input} value={formGen.hasta} onChange={e => editarGen({ hasta:e.target.value })} /></div>
          </div>

          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Días de la semana *</label>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:6 }}>
              {DIAS_GUARDIA.map(d => {
                const sel = formGen.dias_semana.includes(d.num)
                return (
                  <button
                    key={d.num}
                    onClick={() => toggleDiaGen(d.num)}
                    style={{ padding:'8px 14px', borderRadius:8, fontSize:13, cursor:'pointer', fontWeight:600, border: sel ? '1px solid #f59e0b' : '1px solid #1e2d42', background: sel ? 'rgba(245,158,11,0.15)' : '#1a2235', color: sel ? '#f59e0b' : '#64748b' }}
                  >
                    {d.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}><label style={S.label}>Hora inicio *</label><input type="time" style={S.input} value={formGen.hora_inicio} onChange={e => editarGen({ hora_inicio:e.target.value })} /></div>
            <div style={{ marginBottom:16 }}><label style={S.label}>Hora fin *</label><input type="time" style={S.input} value={formGen.hora_fin} onChange={e => editarGen({ hora_fin:e.target.value })} /></div>
          </div>

          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Rol operativo</label>
              <select style={S.select} value={formGen.rol_operativo} onChange={e => editarGen({ rol_operativo:e.target.value })}>
                {rolesOperativos.map(rol => <option key={rol.value} value={rol.value}>{rol.label}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Estado</label>
              <select style={S.select} value={formGen.estado} onChange={e => editarGen({ estado:e.target.value })}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Observación</label>
            <textarea style={{ ...S.input, minHeight:70, resize:'vertical' }} value={formGen.observacion} onChange={e => editarGen({ observacion:e.target.value })} placeholder="Se repite en todas las guardias generadas" />
          </div>

          {prevision && (
            <div style={{
              padding:14,
              borderRadius:8,
              border:`1px solid ${prevision.errores.length ? 'rgba(239,68,68,.35)' : 'rgba(16,185,129,.35)'}`,
              background: prevision.errores.length ? 'rgba(239,68,68,.08)' : 'rgba(16,185,129,.08)',
              color: prevision.errores.length ? '#ef4444' : '#10b981',
              fontSize:13,
            }}>
              <div style={{ fontWeight:600 }}>{resumenGeneracion(prevision)}</div>
              {!prevision.errores.length && prevision.aCrear.length > 0 && (
                <div style={{ color:'#94a3b8', marginTop:6 }}>
                  Del {formatFecha(prevision.aCrear[0].fecha)} al {formatFecha(prevision.aCrear[prevision.aCrear.length - 1].fecha)} · {formGen.hora_inicio} a {formGen.hora_fin}
                </div>
              )}
              {prevision.duplicadas.length > 0 && (
                <div style={{ color:'#94a3b8', marginTop:6 }}>
                  Ya cargadas: {prevision.duplicadas.slice(0, 8).map(f => formatFecha(f)).join(', ')}{prevision.duplicadas.length > 8 ? ` y ${prevision.duplicadas.length - 8} más` : ''}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {modalRegla && (
        <Modal
          title={editReglaId ? 'Editar regla semanal' : 'Nueva regla semanal'}
          onClose={() => { setModalRegla(false); setEditReglaId(null); setFormRegla(formReglaInicial()) }}
          footer={
            <>
              <button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => { setModalRegla(false); setEditReglaId(null); setFormRegla(formReglaInicial()) }}>Cancelar</button>
              <button style={{ ...S.btn, ...S.btnPrimary }} onClick={guardarRegla} disabled={loading}>{loading ? 'Guardando...' : 'Guardar regla'}</button>
            </>
          }
        >
          <div style={{ marginBottom:16, fontSize:12, color:'#64748b' }}>
            Una regla es un bloque horario con sus días. Un supervisor con horarios distintos según el día lleva varias reglas
            (por ejemplo: dom a jue 07-19, viernes 07-13, y viernes 19-07 como nocturno aparte).
          </div>

          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Supervisor *</label>
            <select style={S.select} value={formRegla.supervisor_id} onChange={e => setFormRegla({...formRegla, supervisor_id:e.target.value})}>
              <option value="">Seleccionar supervisor...</option>
              {supervisoresDisponibles.filter((s: any) => s.estado === 'activo' || s.id === formRegla.supervisor_id).map((s: any) => (
                <option key={s.id} value={s.id}>{s.apellido}, {s.nombre}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Zona operativa *</label>
            <select style={S.select} value={formRegla.zona_id} onChange={e => setFormRegla({...formRegla, zona_id:e.target.value})}>
              <option value="">Seleccionar zona...</option>
              {zonasActivas.map((z: any) => <option key={z.id} value={z.id}>{z.nombre}</option>)}
            </select>
          </div>

          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Días de la semana *</label>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:6 }}>
              {DIAS_GUARDIA.map(d => {
                const sel = formRegla.dias_semana.includes(d.num)
                return (
                  <button
                    key={d.num}
                    onClick={() => toggleDiaRegla(d.num)}
                    style={{ padding:'8px 14px', borderRadius:8, fontSize:13, cursor:'pointer', fontWeight:600, border: sel ? '1px solid #f59e0b' : '1px solid #1e2d42', background: sel ? 'rgba(245,158,11,0.15)' : '#1a2235', color: sel ? '#f59e0b' : '#64748b' }}
                  >
                    {d.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}><label style={S.label}>Hora inicio *</label><input type="time" style={S.input} value={formRegla.hora_inicio} onChange={e => setFormRegla({...formRegla, hora_inicio:e.target.value})} /></div>
            <div style={{ marginBottom:16 }}><label style={S.label}>Hora fin *</label><input type="time" style={S.input} value={formRegla.hora_fin} onChange={e => setFormRegla({...formRegla, hora_fin:e.target.value})} /></div>
          </div>

          {formRegla.hora_fin <= formRegla.hora_inicio && (
            <div style={{ marginBottom:16, fontSize:12, color:'#f59e0b' }}>
              Horario nocturno: la guardia se genera con la fecha del día de inicio.
            </div>
          )}

          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}><label style={S.label}>Vigencia desde</label><input type="date" style={S.input} value={formRegla.vigencia_desde} onChange={e => setFormRegla({...formRegla, vigencia_desde:e.target.value})} /></div>
            <div style={{ marginBottom:16 }}><label style={S.label}>Vigencia hasta</label><input type="date" style={S.input} value={formRegla.vigencia_hasta} onChange={e => setFormRegla({...formRegla, vigencia_hasta:e.target.value})} /></div>
          </div>
          <div style={{ marginTop:-8, marginBottom:16, fontSize:12, color:'#64748b' }}>
            Opcional. Sirve para cambiar la programación sin borrar la regla anterior ni reescribir lo ya generado.
          </div>

          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Rol operativo</label>
              <select style={S.select} value={formRegla.rol_operativo} onChange={e => setFormRegla({...formRegla, rol_operativo:e.target.value})}>
                {rolesOperativos.map(rol => <option key={rol.value} value={rol.value}>{rol.label}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Estado</label>
              <select style={S.select} value={formRegla.activo ? 'activo' : 'inactivo'} onChange={e => setFormRegla({...formRegla, activo: e.target.value === 'activo'})}>
                <option value="activo">Activa</option>
                <option value="inactivo">Inactiva</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom:8 }}>
            <label style={S.label}>Observación</label>
            <textarea style={{ ...S.input, minHeight:70, resize:'vertical' }} value={formRegla.observacion} onChange={e => setFormRegla({...formRegla, observacion:e.target.value})} placeholder="Se copia en cada guardia generada" />
          </div>
        </Modal>
      )}

      {modalMes && (
        <Modal
          title="Generar mes desde la programación semanal"
          onClose={() => { setModalMes(false); setPrevisionMes(null) }}
          footer={
            <>
              <button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => { setModalMes(false); setPrevisionMes(null) }}>Cancelar</button>
              {previsionMes && !previsionMes.errores.length && previsionMes.aCrear.length > 0 ? (
                <button style={{ ...S.btn, ...S.btnPrimary }} onClick={generarMes} disabled={generandoMes}>
                  {generandoMes ? 'Generando...' : `Generar ${previsionMes.aCrear.length} guardia(s)`}
                </button>
              ) : (
                <button style={{ ...S.btn, ...S.btnPrimary }} onClick={previsualizarMesGuardias} disabled={previsionMesLoading}>
                  {previsionMesLoading ? 'Calculando...' : 'Ver qué se va a crear'}
                </button>
              )}
            </>
          }
        >
          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Mes *</label>
            <input type="month" style={S.input} value={mesGenerar} onChange={e => { setMesGenerar(e.target.value); setPrevisionMes(null) }} />
          </div>

          <div style={{ marginBottom:16, fontSize:12, color:'#64748b' }}>
            Se expanden todas las reglas activas. Lo que ya está cargado no se toca: ni las guardias generadas antes, ni las
            editadas, ni las cargadas a mano. Volver a generar el mismo mes es seguro.
          </div>

          {previsionMes && (
            <div style={{
              padding:14,
              borderRadius:8,
              border:`1px solid ${previsionMes.errores.length ? 'rgba(239,68,68,.35)' : 'rgba(16,185,129,.35)'}`,
              background: previsionMes.errores.length ? 'rgba(239,68,68,.08)' : 'rgba(16,185,129,.08)',
              color: previsionMes.errores.length ? '#ef4444' : '#10b981',
              fontSize:13,
            }}>
              <div style={{ fontWeight:600, marginBottom:8 }}>{resumenMes(previsionMes)}</div>
              {previsionMes.porRegla.map(item => (
                <div key={item.regla.id} style={{ color:'#94a3b8', paddingTop:6, borderTop:'1px solid #1e2d42' }}>
                  {nombreUsuario(item.regla.supervisor_id)} · {etiquetaDias(item.regla.dias_semana)} · {item.regla.hora_inicio?.slice(0,5)} a {item.regla.hora_fin?.slice(0,5)}
                  {' → '}
                  {item.omitida
                    ? <span style={{ color:'#64748b' }}>{item.omitida}</span>
                    : <strong style={{ color:'#10b981' }}>{item.aCrear.length} guardia(s)</strong>}
                  {!item.omitida && item.duplicadas.length > 0 && (
                    <span style={{ color:'#64748b' }}> · {item.duplicadas.length} ya estaban</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}

function CerrarTurnoModal({ turno, registros, guardias, objetivos, onClose, onSuccess }: {
  turno: Turno
  registros: RegistroAsistencia[]
  guardias: Usuario[]
  objetivos: Objetivo[]
  onClose: () => void
  onSuccess: (turnoId: string, revisadoPor: string) => void
}) {
  type Tramo = { id: string; guardia_id: string; hora_inicio: string; hora_fin: string }

  const turnoRegs = registros.filter(r => r.turno_id === turno.id && r.hora_entrada_real)
  const guardiasActivos = guardias.filter((g: Usuario) => esRolGuardia(g.rol) && g.estado === 'activo')

  const tramosIniciales = (): Tramo[] => {
    if (turnoRegs.length > 0) {
      return turnoRegs.map(r => ({
        id: crypto.randomUUID(),
        guardia_id: effectiveGuardia(r) ?? '',
        hora_inicio: ((r.hora_entrada_final ?? r.hora_entrada_real) ?? '').slice(0, 5),
        hora_fin:    ((r.hora_salida_final  ?? r.hora_salida_real)  ?? '').slice(0, 5),
      }))
    }
    return [{
      id: crypto.randomUUID(),
      guardia_id: turno.guardia_id ?? '',
      hora_inicio: turno.hora_inicio.slice(0, 5),
      hora_fin:    turno.hora_fin.slice(0, 5),
    }]
  }

  const [tramos, setTramos] = useState<Tramo[]>(tramosIniciales)
  const [comentario, setComentario] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')

  const calcHorasTramo = (hi: string, hf: string): number => {
    if (!hi || !hf) return 0
    const [hh, mm]   = hi.split(':').map(Number)
    const [hh2, mm2] = hf.split(':').map(Number)
    let min = (hh2 * 60 + mm2) - (hh * 60 + mm)
    if (min <= 0) min += 1440
    return Number((min / 60).toFixed(2))
  }

  const totalHoras = tramos.reduce((s, t) => s + calcHorasTramo(t.hora_inicio, t.hora_fin), 0)

  const agregarTramo = () =>
    setTramos(prev => [...prev, { id: crypto.randomUUID(), guardia_id: '', hora_inicio: '', hora_fin: '' }])

  const quitarTramo = (id: string) => setTramos(prev => prev.filter(t => t.id !== id))

  const updateTramo = (id: string, field: string, value: string) =>
    setTramos(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t))

  const validar = (): string | null => {
    for (const t of tramos) {
      if (!t.guardia_id) return 'Seleccioná un guardia para cada tramo.'
      if (!t.hora_inicio || !t.hora_fin) return 'Ingresá hora de inicio y fin en cada tramo.'
      if (t.hora_inicio === t.hora_fin) return 'La hora de inicio y fin no pueden ser iguales.'
    }
    return null
  }

  const aprobar = async () => {
    const err = validar()
    if (err) { setError(err); return }
    setLoading(true)
    setError('')
    try {
      const { error: rpcError } = await supabase.rpc('cerrar_turno', {
        p_turno_id:   turno.id,
        p_tramos:     tramos.map(t => ({ guardia_id: t.guardia_id, hora_inicio: t.hora_inicio, hora_fin: t.hora_fin })),
        p_comentario: comentario || null,
      })
      if (rpcError) throw rpcError
      const { data: usuarioData } = await supabase.auth.getUser()
      onSuccess(turno.id, usuarioData?.user?.id ?? '')
    } catch (e: any) {
      setError(e?.message || 'Error al cerrar el turno.')
    } finally {
      setLoading(false)
    }
  }

  const nombreGuardia = (id?: string | null) => {
    if (!id) return 'Sin asignar'
    const g = guardias.find((u: Usuario) => u.id === id)
    return g ? `${g.apellido}, ${g.nombre}` : 'Usuario no encontrado'
  }

  const objetivo = objetivos.find((o: Objetivo) => o.id === turno.objetivo_id)

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.75)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ background:'#0f172a', border:'1px solid #1e2d42', borderRadius:16, padding:24, width:'100%', maxWidth:660, maxHeight:'90vh', overflowY:'auto' }}>

        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <div style={{ fontFamily:'Syne,sans-serif', fontSize:20, fontWeight:800, color:'#e2e8f0' }}>Cierre de turno</div>
          <button type="button" onClick={onClose} style={{ background:'none', border:'none', color:'#64748b', cursor:'pointer', fontSize:22, lineHeight:1 }}>✕</button>
        </div>

        {/* Info del turno */}
        <div style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:10, padding:12, marginBottom:16,
          display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px,1fr))', gap:8 }}>
          <div><div style={S.label}>Objetivo</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{objetivo?.nombre ?? '—'}</div></div>
          <div><div style={S.label}>Fecha</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{formatFecha(turno.fecha)}</div></div>
          <div><div style={S.label}>Horario programado</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{turno.hora_inicio.slice(0,5)} – {turno.hora_fin.slice(0,5)}</div></div>
          <div><div style={S.label}>Guardia programado</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{nombreGuardia(turno.guardia_id)}</div></div>
        </div>

        {/* Fichajes GPS */}
        {turnoRegs.length > 0 && (
          <div style={{ marginBottom:16 }}>
            <div style={{ ...S.label, marginBottom:6 }}>Fichajes GPS (solo lectura)</div>
            {turnoRegs.map(r => (
              <div key={r.id} style={{ background:'#0a1628', border:'1px solid #1e2d42', borderRadius:8, padding:'8px 12px', marginBottom:6,
                fontSize:12, color:'#94a3b8', display:'flex', gap:16, flexWrap:'wrap' as const }}>
                <span><strong style={{ color:'#cbd5e1' }}>{nombreGuardia(effectiveGuardia(r))}</strong></span>
                <span>Entrada: <strong>{r.hora_entrada_real?.slice(0,5) ?? '—'}</strong></span>
                <span>Salida: <strong>{r.hora_salida_real?.slice(0,5) ?? 'en curso'}</strong></span>
                {r.gps_ingreso_estado === 'fuera_radio' && <span style={{ color:'#f87171' }}>⚠ fuera de radio</span>}
              </div>
            ))}
          </div>
        )}

        {/* Tramos a aprobar */}
        <div style={{ marginBottom:8 }}>
          <div style={{ ...S.label, marginBottom:8 }}>Cobertura a aprobar</div>
          {tramos.map((tramo) => {
            const h = calcHorasTramo(tramo.hora_inicio, tramo.hora_fin)
            return (
              <div key={tramo.id} style={{ display:'grid', gridTemplateColumns:'1fr 110px 110px 52px auto', gap:6, marginBottom:8, alignItems:'center' }}>
                <select style={{ ...S.select, fontSize:12 }} value={tramo.guardia_id}
                  onChange={e => updateTramo(tramo.id, 'guardia_id', e.target.value)}>
                  <option value="">Guardia…</option>
                  {guardiasActivos.map((g: Usuario) => (
                    <option key={g.id} value={g.id}>{g.apellido}, {g.nombre}</option>
                  ))}
                </select>
                <input type="time" style={{ ...S.input, fontSize:12 }} value={tramo.hora_inicio}
                  onChange={e => updateTramo(tramo.id, 'hora_inicio', e.target.value)} />
                <input type="time" style={{ ...S.input, fontSize:12 }} value={tramo.hora_fin}
                  onChange={e => updateTramo(tramo.id, 'hora_fin', e.target.value)} />
                <div style={{ fontSize:12, color:'#94a3b8', textAlign:'right' as const }}>{h > 0 ? `${h}h` : '—'}</div>
                {tramos.length > 1 ? (
                  <button type="button" onClick={() => quitarTramo(tramo.id)}
                    style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer', fontSize:16, padding:0 }}>✕</button>
                ) : <div />}
              </div>
            )
          })}
          <button type="button" onClick={agregarTramo}
            style={{ ...S.btn, ...S.btnSecondary, marginTop:4, fontSize:12, padding:'6px 14px' }}>
            + Agregar tramo
          </button>
        </div>

        {/* Total */}
        <div style={{ textAlign:'right' as const, marginBottom:16, fontSize:14, color:'#e2e8f0', paddingRight:64 }}>
          Total aprobado: <strong style={{ color:'#10b981' }}>{totalHoras.toFixed(2)} h</strong>
        </div>

        {/* Comentario */}
        <div style={{ marginBottom:16 }}>
          <label style={S.label}>Comentario (opcional)</label>
          <textarea style={{ ...S.input, minHeight:56, resize:'vertical' as const }}
            value={comentario} onChange={e => setComentario(e.target.value)}
            placeholder="Ej.: Relevo parcial confirmado con cliente" />
        </div>

        {error && (
          <div style={{ background:'rgba(239,68,68,.12)', border:'1px solid rgba(239,68,68,.35)', color:'#fca5a5',
            borderRadius:8, padding:10, fontSize:13, marginBottom:12 }}>{error}</div>
        )}

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <button type="button" style={{ ...S.btn, ...S.btnSecondary, justifyContent:'center' }} onClick={onClose}>Cancelar</button>
          <button type="button" style={{ ...S.btn, ...S.btnPrimary, justifyContent:'center' }} onClick={aprobar} disabled={loading}>
            {loading ? 'Aprobando...' : 'Aprobar turno'}
          </button>
        </div>

      </div>
    </div>
  )
}

function RevisionOperativa({ guardias, objetivos, turnos, registros, setTurnos, setRegistros, user, supervisorZonas = [], zonasOperativas = [], filtroActivo, limpiarFiltro }: any) {
  type AlertaOperativaAdmin = {
    key: string
    tipo: TipoAlertaOperativaAdmin
    titulo: string
    detalle: string
    turno: Turno
    registro?: RegistroAsistencia
    tono: 'warn' | 'danger' | 'info'
  }

  const [intervenciones, setIntervenciones] = useState<any[]>([])
  const [supervisoresGuardia, setSupervisoresGuardia] = useState<any[]>([])
  const [puestosRevision, setPuestosRevision] = useState<any[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [tab, setTab] = useState<'pendientes' | 'intervenidas' | 'asistencias_confirmadas' | 'cierre'>('pendientes')
  const [accionActiva, setAccionActiva] = useState<{ alerta: AlertaOperativaAdmin, accion: AccionIntervencionAdmin, intervencionOrigen?: any } | null>(null)
  const [formIntervencion, setFormIntervencion] = useState({ guardia_id:'', comentario:'', motivo:'' })
  const [loadingAccion, setLoadingAccion] = useState('')
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [turnoParaCerrar, setTurnoParaCerrar] = useState<Turno | null>(null)
  const operacionesEnCurso = useRef<Set<string>>(new Set())
  const operacionesIds = useRef<Map<string, string>>(new Map())
  const [confirmacionManualAceptada, setConfirmacionManualAceptada] = useState(false)
  const [historialesExpandidos, setHistorialesExpandidos] = useState<Set<string>>(new Set())

  const hoy = fechaHoyArgentina()
  const ahora = new Date()
  const usuarios = guardias as Usuario[]
  const guardiasActivos = usuarios.filter((g: Usuario) => esRolGuardia(g.rol) && g.estado === 'activo')

  // Etapa 5: filtrado por zona del supervisor
  const esAdmin = esRolAdmin(user?.rol)
  const misZonaIds = new Set<string>(
    esAdmin
      ? []
      : (supervisorZonas as any[])
          .filter((sz: any) => sz.supervisor_id === user?.id)
          .map((sz: any) => sz.zona_id as string)
  )
  const turnosHoyAll = (turnos as Turno[]).filter((t: Turno) => t.fecha === hoy)
  const turnosHoy = (esAdmin || misZonaIds.size === 0)
    ? turnosHoyAll
    : turnosHoyAll.filter((t: Turno) => {
        const obj = (objetivos as Objetivo[]).find((o: Objetivo) => o.id === t.objetivo_id)
        return obj?.zona_id ? misZonaIds.has(obj.zona_id) : false
      })

  const nombreUsuario = (id?: string | null) => {
    if (!id) return 'Sin asignar'
    const usuario = usuarios.find((u: Usuario) => u.id === id) || (user?.id === id ? user : null)
    return usuario ? `${usuario.apellido}, ${usuario.nombre}` : 'Usuario no encontrado'
  }

  const nombreObjetivo = (id?: string | null) => {
    const objetivo = objetivos.find((o: Objetivo) => o.id === id)
    return objetivo?.nombre || 'Objetivo sin nombre'
  }

  const hora = (value?: string | null) => value ? value.slice(0, 5) : '--:--'

  const duracionProgramada = (turno: Turno) => {
    const inicio = fechaHoraTurnoLocal(turno.fecha, turno.hora_inicio)
    const fin = fechaHoraTurnoLocal(turno.fecha, turno.hora_fin)
    if (!inicio || !fin) return 'No disponible'
    if (fin <= inicio) fin.setDate(fin.getDate() + 1)
    const horas = (fin.getTime() - inicio.getTime()) / 3600000
    return `${horas.toLocaleString('es-AR', { maximumFractionDigits:2 })} h`
  }

  const nombrePuesto = (turno: Turno) =>
    puestosRevision.find((puesto: any) => puesto.id === (turno as any).puesto_id)?.nombre || 'Sin puesto informado'

  const fechaHoraTexto = (value?: string | null) => value
    ? formatFechaHora(value)
    : '—'

  const getRegistrosTurno = (turnoId: string) => registros
    .filter((r: RegistroAsistencia) => r.turno_id === turnoId)
    .sort((a: RegistroAsistencia, b: RegistroAsistencia) => ordenRegistroAsistencia(b, turnos.find((t: Turno) => t.id === b.turno_id)) - ordenRegistroAsistencia(a, turnos.find((t: Turno) => t.id === a.turno_id)))

  const getRegistro = (turno: Turno) => getRegistrosTurno(turno.id)[0]
  const tieneEntrada = (turno: Turno) => getRegistrosTurno(turno.id).some((r: RegistroAsistencia) => registroTieneEntradaConfirmada(r))
  const tieneSalida = (turno: Turno) => getRegistrosTurno(turno.id).some((r: RegistroAsistencia) => r.hora_salida_real)

  const finTurnoMasToleranciaPaso = (turno: Turno) => {
    const inicio = fechaHoraTurnoLocal(turno.fecha, turno.hora_inicio)
    const fin = fechaHoraTurnoLocal(turno.fecha, turno.hora_fin)
    if (!inicio || !fin) return false
    if (fin <= inicio) fin.setDate(fin.getDate() + 1)
    return ahora.getTime() - fin.getTime() >= 15 * 60000
  }

  const fechaHoraEnRangoAdmin = (fecha: string, horaInicioTurno: string, fechaInicio: string, horaInicio: string, horaFin: string) => {
    const valor = fechaHoraTurnoLocal(fecha, horaInicioTurno)
    const inicio = fechaHoraTurnoLocal(fechaInicio, horaInicio)
    const fin = fechaHoraTurnoLocal(fechaInicio, horaFin)
    if (!valor || !inicio || !fin) return false
    if (fin <= inicio) fin.setDate(fin.getDate() + 1)
    return valor >= inicio && valor < fin
  }

  const normalizarOperativo = (value?: string | null) =>
    (value || '').trim().toLowerCase()

  const fechaConOffset = (fecha?: string | null, dias = 0) => {
    const base = fechaHoraTurnoLocal(fecha, '00:00:00')
    if (!base) return ''
    base.setDate(base.getDate() + dias)
    return base.toLocaleDateString('sv-SE')
  }

  const fechasSupervisoresGuardia = Array.from(new Set(
    turnosHoy
      .flatMap((t: Turno) => [t.fecha?.slice(0, 10), fechaConOffset(t.fecha, -1)])
      .filter((fecha): fecha is string => Boolean(fecha))
  ))

  const tipoAlertaLabel = (tipo: TipoAlertaOperativaAdmin) => {
    const labels: Record<TipoAlertaOperativaAdmin, string> = {
      descubierto: 'Puesto sin cobertura',
      sin_fichar: 'Guardia sin fichar / Objetivo en riesgo',
      tardanza: 'Tardanza registrada',
      fuera_radio: 'Fichaje fuera de radio',
      salida_pendiente: 'Salida pendiente',
    }
    return labels[tipo]
  }

  // Responsables operativos del turno, con LA resolución compartida
  // (lib/responsables-operativos): guardia efectiva que cubre el instante →
  // responsable único de supervisor_zonas → nadie, sin elegir arbitrariamente.
  // Puede devolver varios (Rosario diurno: Sabino + Sergio) y se muestran
  // todos. El rol del usuario no filtra: la responsabilidad sale de la
  // asignación.
  const supervisorGuardiaAsignado = (turno: Turno): {
    supervisor_id: string | null
    supervisor_ids: string[]
    origen: OrigenResolucion
    observacion: string | null
  } | null => {
    const objetivo = (objetivos as any[]).find(o => o.id === turno.objetivo_id)
    const resolucion = resolverResponsablesOperativos({
      zonaId: objetivo?.zona_id ?? null,
      fecha: turno.fecha,
      hora: String(turno.hora_inicio).slice(0, 5),
      guardias: supervisoresGuardia,
      supervisorZonas,
      zonas: zonasOperativas,
      usuarios: guardias,
    })

    if (resolucion.responsables.length === 0 && resolucion.origen === 'sin_zona') return null

    // La observación viaja sólo cuando viene de una guardia concreta.
    const filaGuardia = resolucion.origen === 'guardia_efectiva'
      ? supervisoresGuardia.find((g: any) =>
          resolucion.responsables.includes(g.supervisor_id) &&
          guardiaCubreInstante(g, turno.fecha, String(turno.hora_inicio).slice(0, 5)) &&
          g.observacion)
      : null

    return {
      supervisor_id: resolucion.responsables[0] || null,
      supervisor_ids: resolucion.responsables,
      origen: resolucion.origen,
      observacion: filaGuardia?.observacion || null,
    }
  }

  // Nombres de TODOS los responsables, o el motivo si no hay ninguno.
  const nombresResponsables = (asignacion: ReturnType<typeof supervisorGuardiaAsignado>) => {
    if (!asignacion) return TEXTO_ORIGEN.sin_zona
    if (asignacion.supervisor_ids.length > 0) {
      return asignacion.supervisor_ids.map(id => nombreUsuario(id)).join(' + ')
    }
    return TEXTO_ORIGEN[asignacion.origen]
  }

  const intervencionesAlerta = (alerta: Pick<AlertaOperativaAdmin, 'turno' | 'tipo' | 'registro'>) =>
    intervencionesDeOcurrencia(
      intervenciones,
      alerta.turno.id,
      alerta.tipo,
      alerta.registro?.id
    )

  const estadoAlerta = (alerta: AlertaOperativaAdmin, condicionVigente = true) => estadoCicloVidaAlerta({
    intervenciones,
    turnoId: alerta.turno.id,
    tipo: alerta.tipo,
    registroAsistenciaId: alerta.registro?.id,
    condicionVigente,
  })

  const accionLabel = (accion: string) => {
    const labels: Record<string, string> = {
      comentario: 'Comentario',
      reasignacion: 'Reasignación',
      marcado_descubierto: 'Marcado descubierto',
      confirmar_cubierto: 'Confirmar cubierto',
      marcado_cubierto_manual: 'Confirmar cubierto',
      alerta_revisada: 'Alerta revisada',
      confirmar_asistencia: 'Confirmar asistencia',
      reapertura: 'Reapertura',
      anulacion_cobertura: 'Anulación de cobertura manual',
    }
    return labels[accion] || accion
  }

  const accionEstaSeleccionada = (alerta: AlertaOperativaAdmin, accion: AccionIntervencionAdmin) => (
    accionActiva?.alerta.key === alerta.key &&
    accionActiva?.accion === accion
  )

  const estiloBotonAccion = (accion: AccionIntervencionAdmin, activo: boolean, base?: React.CSSProperties): React.CSSProperties => {
    const baseStyle = base || { ...S.btn, ...S.btnSecondary, justifyContent:'center' }
    if (!activo) return baseStyle

    const estilosActivos: Partial<Record<AccionIntervencionAdmin, React.CSSProperties>> = {
      confirmar_cubierto: {
        background: 'rgba(16,185,129,.2)',
        color: '#6ee7b7',
        border: '1px solid rgba(16,185,129,.75)',
        boxShadow: '0 0 0 1px rgba(16,185,129,.3), 0 0 18px rgba(16,185,129,.22)',
      },
      reasignacion: {
        background: 'rgba(59,130,246,.2)',
        color: '#93c5fd',
        border: '1px solid rgba(59,130,246,.75)',
        boxShadow: '0 0 0 1px rgba(59,130,246,.3), 0 0 18px rgba(59,130,246,.22)',
      },
      marcado_descubierto: {
        background: 'rgba(249,115,22,.24)',
        color: '#fdba74',
        border: '1px solid rgba(249,115,22,.8)',
        boxShadow: '0 0 0 1px rgba(249,115,22,.3), 0 0 18px rgba(249,115,22,.24)',
      },
      comentario: {
        background: 'rgba(245,158,11,.18)',
        color: '#fcd34d',
        border: '1px solid rgba(245,158,11,.72)',
        boxShadow: '0 0 0 1px rgba(245,158,11,.25), 0 0 16px rgba(245,158,11,.18)',
      },
    }

    return {
      ...baseStyle,
      ...(estilosActivos[accion] || {}),
    }
  }

  const cargarIntervenciones = async () => {
    setLoadingData(true)
    setError('')

    const turnoIds = turnosHoy.map((t: Turno) => t.id)
    const intervencionesQuery = turnoIds.length > 0
      ? supabase
        .from('supervisor_intervenciones')
        .select('*')
        .in('turno_id', turnoIds)
        .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null } as any)
    const supervisoresGuardiaQuery = fechasSupervisoresGuardia.length > 0
      ? supabase
        .from('supervisores_guardia')
        .select('*')
        .in('fecha', fechasSupervisoresGuardia)
        .order('fecha', { ascending: false })
        .order('hora_inicio', { ascending: true })
      : Promise.resolve({ data: [], error: null } as any)
    const puestoIds = Array.from(new Set(turnosHoy.map((turno: Turno) => (turno as any).puesto_id).filter(Boolean))) as string[]
    const puestosQuery = puestoIds.length > 0
      ? supabase.from('puestos').select('id,nombre').in('id', puestoIds)
      : Promise.resolve({ data: [], error: null } as any)

    const [{ data: intervencionesData, error: intervencionesError }, { data: guardiasSupervisorData, error: guardiasSupervisorError }, { data: puestosData, error: puestosError }] = await Promise.all([
      intervencionesQuery,
      supervisoresGuardiaQuery,
      puestosQuery,
    ])

    const erroresCarga: string[] = []

    if (intervencionesError) {
      erroresCarga.push(formatSupabaseError(intervencionesError, 'Consulta supervisor_intervenciones para turnos de hoy'))
      setIntervenciones([])
    } else {
      setIntervenciones(intervencionesData || [])
    }

    if (guardiasSupervisorError && !/supervisores_guardia|schema cache|does not exist/i.test(guardiasSupervisorError.message)) {
      erroresCarga.push(formatSupabaseError(guardiasSupervisorError, 'Consulta supervisores_guardia por fecha y horario'))
      setSupervisoresGuardia([])
    } else {
      setSupervisoresGuardia(guardiasSupervisorData || [])
    }

    if (puestosError) {
      erroresCarga.push(formatSupabaseError(puestosError, 'Consulta de puestos para revisión operativa'))
      setPuestosRevision([])
    } else {
      setPuestosRevision(puestosData || [])
    }

    if (erroresCarga.length > 0) setError(erroresCarga.join(' | '))
    setLoadingData(false)
  }

  useEffect(() => {
    cargarIntervenciones()
  }, [turnos.length])

  const alertaBase = (turno: Turno, tipo: TipoAlertaOperativaAdmin, titulo: string, detalle: string, tono: AlertaOperativaAdmin['tono'], registro?: RegistroAsistencia): AlertaOperativaAdmin => ({
    key: `${tipo}-${turno.id}-${registro?.id || 'turno'}`,
    tipo,
    titulo,
    detalle,
    turno,
    registro,
    tono,
  })

  // `objetivos` va siempre: un objetivo pausado conserva sus turnos pero no
  // genera obligación, así que ninguna de sus alertas corresponde. Sin este
  // argumento el detector no puede saberlo y las emite igual.
  const deteccionesOperativas = detectarAlertasOperativas({ turnos: turnosHoy, registros, objetivos })
  const alertasPendientes = deteccionesOperativas
    .map((deteccion) => {
      const turno = turnosHoy.find((item: Turno) => item.id === deteccion.turno_id)
      if (!turno) return null
      const registro = deteccion.registro_asistencia_id
        ? registros.find((item: RegistroAsistencia) => item.id === deteccion.registro_asistencia_id)
        : undefined
      const configuracion: Record<TipoAlertaOperativaAdmin, { titulo: string, detalle: string, tono: AlertaOperativaAdmin['tono'] }> = {
        descubierto: { titulo:'Puesto sin cobertura', detalle:'Sin guardia asignado', tono:'danger' },
        sin_fichar: { titulo:'Guardia sin fichar / Objetivo en riesgo', detalle:`Cobertura en riesgo: ${minutosDesdeInicioTurno(turno)} minutos desde el inicio sin entrada registrada`, tono:'warn' },
        tardanza: { titulo:'Tardanza registrada', detalle:`Llegó ${registro ? calcularMinutosTardanzaRegistro(turno, registro) : 0} minutos tarde`, tono:'warn' },
        fuera_radio: { titulo:'Fichaje fuera de radio', detalle:`Distancia: ${metrosGpsTexto(registro?.distancia_ingreso_metros)}`, tono:'danger' },
        salida_pendiente: { titulo:'Salida pendiente', detalle:'Tiene entrada registrada y no tiene salida luego del fin del turno', tono:'info' },
      }
      const cfg = configuracion[deteccion.tipo_alerta]
      return alertaBase(turno, deteccion.tipo_alerta, cfg.titulo, cfg.detalle, cfg.tono, registro)
    })
    .filter((alerta): alerta is AlertaOperativaAdmin => Boolean(alerta))
    // Una alerta con intervención resolutiva ya registrada no es "pendiente",
    // aunque el detector la siga marcando como condición vigente (p. ej.
    // tardanza/fuera_radio son hechos fijos que nunca dejan de detectarse).
    .filter((alerta) => !alertaEstaIntervenida(intervenciones, alerta.turno.id, alerta.tipo, alerta.registro?.id))
    .sort((a, b) => {
      const fechaA = fechaHoraTurnoLocal(a.turno.fecha, a.turno.hora_inicio)?.getTime() || 0
      const fechaB = fechaHoraTurnoLocal(b.turno.fecha, b.turno.hora_inicio)?.getTime() || 0
      return fechaB - fechaA
    })
  const idsFiltroRevision = new Set((filtroActivo?.ids || []) as string[])
  const alertasPendientesVisibles = filtroActivo?.tipo
    ? alertasPendientes.filter((alerta) =>
        alerta.tipo === filtroActivo.tipo &&
        (idsFiltroRevision.size === 0 || idsFiltroRevision.has(alerta.registro?.id || alerta.turno.id))
      )
    : alertasPendientes

  useEffect(() => {
    if (filtroActivo?.tipo) setTab('pendientes')
  }, [filtroActivo?.tipo])

  const alertasIntervenidas = intervenciones
    .filter((i: any) => i.accion !== 'comentario')
    .reduce((mapa: Map<string, any>, intervencion: any) => {
      const turno = turnosHoy.find((t: Turno) => t.id === intervencion.turno_id)
      const tipo = intervencion.tipo_alerta as TipoAlertaOperativaAdmin
      if (!turno || !['sin_fichar', 'tardanza', 'fuera_radio', 'descubierto', 'salida_pendiente'].includes(tipo)) return mapa
      const registro = intervencion.registro_asistencia_id
        ? registros.find((r: RegistroAsistencia) => r.id === intervencion.registro_asistencia_id)
        : undefined
      const key = claveOcurrenciaAlerta(turno.id, tipo, registro?.id || intervencion.registro_asistencia_id)
      const actual = mapa.get(key)
      if (!actual || compararIntervencionesMasReciente(intervencion, actual.intervencion) < 0) {
        mapa.set(key, { turno, tipo, registro, intervencion })
      }
      return mapa
    }, new Map<string, any>())

  Array.from(alertasIntervenidas.entries()).forEach(([key, item]: [string, any]) => {
    // Misma condición usada para sacar una alerta de "Pendientes": si tiene
    // intervención resolutiva vigente (no reabierta), pertenece a esta pestaña,
    // sin importar si el detector sigue encontrando la condición original.
    const intervenida = alertaEstaIntervenida(intervenciones, item.turno.id, item.tipo, item.registro?.id)
    if (!intervenida) {
      alertasIntervenidas.delete(key)
    }
  })

  const intervenidasOrdenadas = Array.from(alertasIntervenidas.values())
    .sort((a: any, b: any) => compararIntervencionesMasReciente(a.intervencion, b.intervencion))

  const asistenciasConfirmadas = intervenciones
    .filter((i: any) => i.accion === 'confirmar_asistencia')
    .reduce((mapa: Map<string, any>, intervencion: any) => {
      const turno = turnosHoy.find((t: Turno) => t.id === intervencion.turno_id)
      if (!turno) return mapa
      const key = `${turno.id}-${intervencion.registro_asistencia_id || 'sin'}`
      if (mapa.has(key)) return mapa
      const registro = intervencion.registro_asistencia_id
        ? registros.find((r: RegistroAsistencia) => r.id === intervencion.registro_asistencia_id)
        : undefined
      const tieneRegistroManual = registros.some((r: RegistroAsistencia) =>
        r.turno_id === turno.id &&
        r.tipo_registro === 'carga_manual' &&
        !(r as any).registro_anulado_at
      )
      if (tieneRegistroManual) return mapa
      const intervencionesPosteriores = intervenciones.filter((i2: any) =>
        i2.turno_id === turno.id &&
        ['reapertura', 'anulacion_cobertura'].includes(i2.accion) &&
        new Date(i2.created_at) > new Date(intervencion.created_at)
      )
      if (intervencionesPosteriores.length > 0) return mapa
      const guardiaObj = usuarios.find((g: Usuario) => g.id === turno.guardia_id)
      const objetivoObj = objetivos.find((o: Objetivo) => o.id === turno.objetivo_id)
      const supervisorObj = usuarios.find((g: Usuario) => g.id === intervencion.supervisor_id)
      const puestoObj = puestosRevision.find((p: any) => p.id === (turno as any).puesto_id)
      mapa.set(key, {
        turno,
        registro,
        intervencion,
        guardia: guardiaObj,
        objetivo: objetivoObj,
        supervisor: supervisorObj,
        puesto: puestoObj,
      })
      return mapa
    }, new Map<string, any>())

  const asistenciasConfirmadasLista = Array.from(asistenciasConfirmadas.values())
    .sort((a: any, b: any) => (b.intervencion.created_at || '').localeCompare(a.intervencion.created_at || ''))

  const abrirAccion = (alerta: AlertaOperativaAdmin, accion: AccionIntervencionAdmin, intervencionOrigen?: any) => {
    setError('')
    setMensaje('')
    setAccionActiva({ alerta, accion, intervencionOrigen })
    setConfirmacionManualAceptada(false)
    setFormIntervencion({
      guardia_id: alerta.turno.guardia_id || '',
      comentario: '',
      motivo: accion === 'confirmar_cubierto' ? 'Entrada confirmada por admin' : '',
    })
  }

  const cerrarAccion = () => {
    setAccionActiva(null)
    setFormIntervencion({ guardia_id:'', comentario:'', motivo:'' })
    setError('')
    setConfirmacionManualAceptada(false)
  }

  const recargarEstadoServidor = async (turnoId: string) => {
    const [turnoResult, registrosResult, intervencionesResult] = await Promise.all([
      supabase.from('turnos').select('*').eq('id', turnoId).single(),
      supabase.from('registros_asistencia').select('*').eq('turno_id', turnoId),
      supabase.from('supervisor_intervenciones').select('*').eq('turno_id', turnoId).order('created_at', { ascending:false }),
    ])

    if (turnoResult.error) throw turnoResult.error
    if (registrosResult.error) throw registrosResult.error
    if (intervencionesResult.error) throw intervencionesResult.error

    setTurnos((prev: Turno[]) => prev.map((item) => item.id === turnoId ? turnoResult.data as Turno : item))
    setRegistros((prev: RegistroAsistencia[]) => [
      ...prev.filter((item) => item.turno_id !== turnoId),
      ...((registrosResult.data || []) as RegistroAsistencia[]),
    ])
    setIntervenciones((prev) => [
      ...prev.filter((item: any) => item.turno_id !== turnoId),
      ...(intervencionesResult.data || []),
    ])
  }

  const ejecutarAccion = async () => {
    if (!accionActiva) return

    const { alerta, accion } = accionActiva
    const turno = alerta.turno
    const comentario = formIntervencion.comentario.trim()
    const motivo = formIntervencion.motivo.trim()

    if (['comentario', 'alerta_revisada'].includes(accion) && !comentario) {
      setError('Agregá un comentario para guardar la intervención.')
      return
    }

    if (['reapertura', 'anulacion_cobertura'].includes(accion) && !motivo) {
      setError(accion === 'reapertura' ? 'Indicá el motivo de la reapertura.' : 'Indicá el motivo de la anulación de cobertura.')
      return
    }

    if (accion === 'reasignacion' && !formIntervencion.guardia_id) {
      setError('Seleccioná el nuevo guardia.')
      return
    }

    if (accion === 'reasignacion' && formIntervencion.guardia_id === turno.guardia_id) {
      setError('Seleccioná un guardia distinto al actual.')
      return
    }

    if (accion === 'confirmar_cubierto' && !confirmacionManualAceptada) {
      setError('Confirmá expresamente que comprendés el impacto operativo y liquidable.')
      return
    }

    const loadingKey = `${alerta.key}-${accion}`
    if (operacionesEnCurso.current.has(alerta.key)) return
    operacionesEnCurso.current.add(alerta.key)
    setLoadingAccion(loadingKey)
    setError('')
    setMensaje('')

    try {
      const operacionKey = JSON.stringify({
        alerta: alerta.key,
        accion,
        comentario: comentario || null,
        motivo: motivo || null,
        guardia_nuevo_id: accion === 'reasignacion' ? formIntervencion.guardia_id : null,
        confirmacion_reforzada: accion === 'confirmar_cubierto' && confirmacionManualAceptada,
        intervencion_origen_id: accionActiva.intervencionOrigen?.id || null,
      })
      let operacionId = operacionesIds.current.get(operacionKey)
      if (!operacionId) {
        operacionId = crypto.randomUUID()
        operacionesIds.current.set(operacionKey, operacionId)
      }

      const { data, error: rpcError } = accion === 'anulacion_cobertura'
        ? await supabase.rpc('anular_cobertura_manual_operativa', {
            p_operacion_id: operacionId,
            p_intervencion_origen_id: accionActiva.intervencionOrigen?.id,
            p_motivo: motivo,
          })
        : await supabase.rpc('registrar_intervencion_operativa', {
            p_operacion_id: operacionId,
            p_turno_id: turno.id,
            p_tipo_alerta: alerta.tipo,
            p_accion: accion,
            p_registro_asistencia_id: alerta.registro?.id || null,
            p_comentario: comentario || null,
            p_motivo: motivo || null,
            p_guardia_nuevo_id: accion === 'reasignacion' ? formIntervencion.guardia_id : null,
            p_confirmacion_reforzada: accion === 'confirmar_cubierto' && confirmacionManualAceptada,
          })
      if (rpcError) throw rpcError

      await recargarEstadoServidor(turno.id)
      operacionesIds.current.delete(operacionKey)

      setMensaje(data?.estado === 'ya_aplicada' ? 'Operación ya aplicada. Se mostró el estado actual del servidor.' : 'Intervención registrada y verificada en el servidor.')
      cerrarAccion()
      setTab(['comentario', 'reapertura', 'anulacion_cobertura'].includes(accion) ? 'pendientes' : 'intervenidas')
    } catch (actionError) {
      try {
        await recargarEstadoServidor(turno.id)
      } catch {
        // Se conserva la advertencia de incertidumbre si la relectura tampoco responde.
      }
      const advertenciaImpacto = ['confirmar_cubierto', 'anulacion_cobertura'].includes(accion)
        ? ' Verificá la asistencia y las horas liquidables antes de repetir.'
        : ''
      setError(`No se pudo confirmar el resultado. ${formatSupabaseError(actionError, 'Operación de intervención')} El servidor aplica la operación completa o no la aplica, pero ante un timeout puede haber quedado aplicada. Se intentó recargar el estado autoritativo.${advertenciaImpacto}`)
    } finally {
      operacionesEnCurso.current.delete(alerta.key)
      setLoadingAccion('')
    }
  }

  const renderHistorial = (alerta: AlertaOperativaAdmin) => {
    const items = [...intervencionesAlerta(alerta)].reverse()
    const expandido = historialesExpandidos.has(alerta.key)
    const deteccion = deteccionesOperativas.find((item) =>
      claveOcurrenciaAlerta(item.turno_id, item.tipo_alerta, item.registro_asistencia_id) ===
      claveOcurrenciaAlerta(alerta.turno.id, alerta.tipo, alerta.registro?.id)
    )

    return (
      <div style={{ background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, padding:12, marginTop:12 }}>
        <button type="button" style={{ ...S.btn, ...S.btnSecondary, width:'100%', justifyContent:'center' }} onClick={() => setHistorialesExpandidos((prev) => {
          const siguiente = new Set(prev)
          if (siguiente.has(alerta.key)) siguiente.delete(alerta.key); else siguiente.add(alerta.key)
          return siguiente
        })}>{expandido ? 'Ocultar línea de tiempo' : `Ver línea de tiempo completa (${items.length + 1})`}</button>
        {expandido && <div>
          <div style={{ borderTop:'1px solid rgba(148,163,184,.16)', paddingTop:8, marginTop:8, fontSize:12, color:'#cbd5e1' }}>
            <div>Acción: <strong>Detección de la condición</strong></div>
            <div>Efecto: se abrió el seguimiento; no modificó turno, asistencia ni liquidación.</div>
            <div>Fecha/hora: {fechaHoraTexto(deteccion?.detectada_at || alerta.registro?.created_at || fechaHoraTurnoLocal(alerta.turno.fecha, alerta.turno.hora_inicio)?.toISOString())}</div>
          </div>
          {items.map((item: any) => (
            <div key={item.id} style={{ borderTop:'1px solid rgba(148,163,184,.16)', paddingTop:8, marginTop:8, fontSize:12, color:'#cbd5e1' }}>
              <div>Acción: <strong>{accionLabel(item.accion)}</strong></div>
              <div>Intervino: {nombreUsuario(item.supervisor_intervino_id || item.supervisor_id)}</div>
              {item.comentario && <div>Comentario: {item.comentario}</div>}
              {item.motivo && <div>Motivo: {item.motivo}</div>}
              <div>Efecto: {efectoIntervencionOperativa(item.accion)}</div>
              <div>Fecha/hora: {fechaHoraTexto(item.created_at)}</div>
            </div>
          ))}
        </div>}
      </div>
    )
  }

  const renderContexto = (alerta: AlertaOperativaAdmin) => {
    const asignacion = supervisorGuardiaAsignado(alerta.turno)
    const ultima = intervencionesAlerta(alerta)[0]
    const ciclo = estadoAlerta(alerta, true)
    const estadoVisible = {
      pendiente: 'Pendiente',
      atendida_condicion_vigente: 'Atendida · condición vigente',
      resuelta_operativamente: 'Resuelta operativamente',
      reabierta: 'Reabierta',
      cerrada: 'Cerrada',
    }[ciclo]
    const objetivo = objetivos.find((o: Objetivo) => o.id === alerta.turno.objetivo_id)
    const minutosDemora = alerta.tipo === 'sin_fichar' ? minutosDesdeInicioTurno(alerta.turno) : null

    return (
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(190px, 1fr))', gap:10, background:'#111827', border:'1px solid #1e2d42', borderRadius:8, padding:12, marginTop:12 }}>
        <div><div style={S.label}>Objetivo</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{nombreObjetivo(alerta.turno.objetivo_id)}</div></div>
        <div><div style={S.label}>Dirección</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{objetivo?.direccion || 'Sin dirección registrada'}</div></div>
        <div><div style={S.label}>Horario</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{hora(alerta.turno.hora_inicio)} a {hora(alerta.turno.hora_fin)}</div></div>
        <div><div style={S.label}>Tipo de alerta</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{tipoAlertaLabel(alerta.tipo)}</div></div>
        <div><div style={S.label}>Guardia asignado</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{nombreUsuario(alerta.turno.guardia_id)}</div></div>
        {minutosDemora !== null && <div><div style={S.label}>Minutos de demora</div><div style={{ fontSize:13, color:'#f59e0b' }}>{minutosDemora}</div></div>}
        <div><div style={S.label}>Supervisor asignado</div><div style={{ fontSize:13, color: asignacion?.supervisor_ids.length ? '#e2e8f0' : '#f59e0b' }}>{nombresResponsables(asignacion)}</div></div>
        <div><div style={S.label}>Estado</div><div style={{ fontSize:13, color: ciclo === 'resuelta_operativamente' ? '#10b981' : '#f59e0b' }}>{estadoVisible}</div></div>
        <div><div style={S.label}>Jefe operativo</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{ultima?.jefe_operativo || JEFE_OPERATIVO_ADMIN}</div></div>
        <div><div style={S.label}>Director técnico</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{ultima?.director_tecnico || DIRECTOR_TECNICO_ADMIN}</div></div>
        <div><div style={S.label}>Última acción</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{ultima ? accionLabel(ultima.accion) : 'Pendiente'}</div></div>
        <div><div style={S.label}>Fecha última acción</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{ultima ? fechaHoraTexto(ultima.created_at) : '—'}</div></div>
        <div style={{ gridColumn:'1 / -1' }}><div style={S.label}>Comentario</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{ultima?.comentario || asignacion?.observacion || '—'}</div></div>
      </div>
    )
  }

  const renderPanelAccion = (alerta: AlertaOperativaAdmin) => {
    if (!accionActiva || accionActiva.alerta.key !== alerta.key) return null

    const requiereGuardia = accionActiva.accion === 'reasignacion'
    const requiereMotivo = ['confirmar_cubierto', 'reapertura', 'anulacion_cobertura'].includes(accionActiva.accion)
    const loadingKey = `${alerta.key}-${accionActiva.accion}`

    return (
      <div style={{ background:'#0f172a', border:'1px solid #334155', borderRadius:8, padding:14, marginTop:12 }}>
        <div style={{ ...S.label, marginBottom:8 }}>Acción seleccionada: {accionLabel(accionActiva.accion)}</div>
        {error && <div style={{ background:'rgba(239,68,68,.12)', border:'1px solid rgba(239,68,68,.35)', color:'#fca5a5', borderRadius:8, padding:10, fontSize:13, marginBottom:12 }}>{error}</div>}

        {requiereGuardia && (
          <div style={{ marginBottom:12 }}>
            <label style={S.label}>Nuevo guardia</label>
            <select style={S.select} value={formIntervencion.guardia_id} disabled={Boolean(loadingAccion)} onChange={e => setFormIntervencion(prev => ({ ...prev, guardia_id:e.target.value }))}>
              <option value="">Seleccionar guardia</option>
              {guardiasActivos.map((g: Usuario) => <option key={g.id} value={g.id}>{g.apellido}, {g.nombre}{g.legajo ? ` - ${g.legajo}` : ''}</option>)}
            </select>
          </div>
        )}

        {requiereMotivo && (
          <div style={{ marginBottom:12 }}>
            <label style={S.label}>Motivo</label>
            <input style={S.input} value={formIntervencion.motivo} disabled={Boolean(loadingAccion)} onChange={e => setFormIntervencion(prev => ({ ...prev, motivo:e.target.value }))} />
          </div>
        )}

        {accionActiva.accion === 'confirmar_cubierto' && (
          <div style={{ background:'rgba(239,68,68,.12)', border:'1px solid rgba(239,68,68,.45)', color:'#fecaca', borderRadius:8, padding:12, marginBottom:12, fontSize:13 }}>
            <div style={{ fontWeight:800, marginBottom:8 }}>Esta acción generará una asistencia manual y puede asignar horas liquidables por la duración programada del turno, aun sin horario real de entrada o salida.</div>
            <div>Objetivo: {nombreObjetivo(alerta.turno.objetivo_id)}</div>
            <div>Puesto: {nombrePuesto(alerta.turno)}</div>
            <div>Guardia: {nombreUsuario(alerta.turno.guardia_id)}</div>
            <div>Fecha: {formatFecha(alerta.turno.fecha)}</div>
            <div>Horario: {hora(alerta.turno.hora_inicio)} a {hora(alerta.turno.hora_fin)}</div>
            <div>Duración programada: {duracionProgramada(alerta.turno)}</div>
            <label style={{ display:'flex', gap:8, alignItems:'flex-start', marginTop:10, cursor:'pointer' }}>
              <input type="checkbox" checked={confirmacionManualAceptada} disabled={Boolean(loadingAccion)} onChange={(event) => setConfirmacionManualAceptada(event.target.checked)} />
              <span>Confirmo que verifiqué objetivo, puesto, guardia, fecha, horario y duración; comprendo que no acredita un fichaje real y que impacta la liquidación.</span>
            </label>
          </div>
        )}

        {accionActiva.accion === 'anulacion_cobertura' && (
          <div style={{ background:'rgba(239,68,68,.12)', border:'1px solid rgba(239,68,68,.45)', color:'#fecaca', borderRadius:8, padding:12, marginBottom:12, fontSize:13 }}>
            <strong>Impacto:</strong> la asistencia original se conserva, pero queda invalidada para liquidación y sus horas liquidables pasan a cero. La intervención y toda la auditoría permanecen visibles.
          </div>
        )}

        <div style={{ marginBottom:12 }}>
          <label style={S.label}>{['comentario', 'alerta_revisada'].includes(accionActiva.accion) ? 'Comentario *' : 'Comentario'}</label>
          <textarea
            style={{ ...S.input, minHeight:80, resize:'vertical' as const }}
            value={formIntervencion.comentario}
            disabled={Boolean(loadingAccion)}
            onChange={e => setFormIntervencion(prev => ({ ...prev, comentario:e.target.value }))}
            placeholder={accionActiva.accion === 'confirmar_cubierto' ? 'Detalle de la verificación manual realizada' : 'Detalle de la intervención'}
          />
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <button type="button" style={{ ...S.btn, ...S.btnSecondary, justifyContent:'center' }} onClick={cerrarAccion} disabled={Boolean(loadingAccion)}>Cancelar</button>
          <button type="button" style={{ ...S.btn, ...S.btnPrimary, justifyContent:'center' }} onClick={ejecutarAccion} disabled={loadingAccion === loadingKey}>
            {loadingAccion === loadingKey ? 'Procesando…' : accionActiva.accion === 'confirmar_cubierto' ? 'Registrar asistencia manual (impacta liquidación)' : 'Guardar'}
          </button>
        </div>
      </div>
    )
  }

  const alertaStyle = (tono: AlertaOperativaAdmin['tono']): React.CSSProperties => {
    const cfg = {
      danger: { border:'rgba(239,68,68,.35)', bg:'rgba(239,68,68,.08)', color:'#f87171' },
      warn: { border:'rgba(245,158,11,.35)', bg:'rgba(245,158,11,.08)', color:'#fbbf24' },
      info: { border:'rgba(59,130,246,.35)', bg:'rgba(59,130,246,.08)', color:'#93c5fd' },
    }[tono]

    return { background:cfg.bg, border:`1px solid ${cfg.border}`, borderRadius:12, padding:18, marginBottom:14 }
  }

  const renderAlertaPendiente = (alerta: AlertaOperativaAdmin) => {
    const objetivo = objetivos.find((o: Objetivo) => o.id === alerta.turno.objetivo_id)
    const coberturaOrigen = intervencionesAlerta(alerta).find((evento: any) =>
      ['confirmar_cubierto', 'marcado_cubierto_manual'].includes(evento.accion)
    )
    const registroCoberturaId = coberturaOrigen?.resultado_json?.registro_cobertura_id
    const registroCobertura = registroCoberturaId
      ? registros.find((registro: RegistroAsistencia) => registro.id === registroCoberturaId)
      : undefined
    const coberturaManualVigente = Boolean(coberturaOrigen && registroCobertura && !registroCobertura.cobertura_anulada_at)

    return (
      <div key={alerta.key} style={alertaStyle(alerta.tono)}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'flex-start' }}>
          <div>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:16, fontWeight:800, color:'#e2e8f0' }}>{alerta.titulo}</div>
            <div style={{ fontSize:13, color:'#94a3b8', marginTop:4 }}>{nombreObjetivo(alerta.turno.objetivo_id)} · {formatFecha(alerta.turno.fecha)} · {hora(alerta.turno.hora_inicio)} a {hora(alerta.turno.hora_fin)}</div>
            <div style={{ fontSize:13, color:'#94a3b8', marginTop:4 }}>Dirección: {objetivo?.direccion || 'Sin dirección registrada'}</div>
            <div style={{ fontSize:13, color:'#f59e0b', marginTop:4 }}>{alerta.detalle}</div>
            {alerta.registro?.hora_entrada_real && <div style={{ fontSize:12, color:'#cbd5e1', marginTop:4 }}>Entrada real: {hora(alerta.registro.hora_entrada_real)}</div>}
          </div>
          <Badge type="pendiente">Pendiente</Badge>
        </div>

        {renderContexto(alerta)}

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:8, marginTop:12 }}>
          {['sin_fichar', 'descubierto'].includes(alerta.tipo) && <button
            type="button"
            style={estiloBotonAccion('reasignacion', accionEstaSeleccionada(alerta, 'reasignacion'))}
            disabled={Boolean(loadingAccion)}
            onClick={() => abrirAccion(alerta, 'reasignacion')}
          >Reasignar</button>}
          {['sin_fichar', 'descubierto'].includes(alerta.tipo) && <button
            type="button"
            style={estiloBotonAccion(
              'marcado_descubierto',
              accionEstaSeleccionada(alerta, 'marcado_descubierto'),
              { ...S.btn, justifyContent:'center', background:'rgba(239,68,68,.15)', color:'#ef4444', border:'1px solid rgba(239,68,68,.35)' },
            )}
            disabled={Boolean(loadingAccion)}
            onClick={() => abrirAccion(alerta, 'marcado_descubierto')}
          >Mantener descubierto</button>}
          {alerta.tipo === 'sin_fichar' && !coberturaManualVigente && <button
            type="button"
            style={{
              ...estiloBotonAccion('confirmar_cubierto', accionEstaSeleccionada(alerta, 'confirmar_cubierto')),
              opacity: alerta.turno.guardia_id ? 1 : 0.55,
            }}
            disabled={Boolean(loadingAccion) || !alerta.turno.guardia_id}
            title={alerta.turno.guardia_id ? undefined : 'Sin guardia asignado: reasigná primero'}
            onClick={() => abrirAccion(alerta, 'confirmar_cubierto')}
          >Registrar asistencia manual (impacta liquidación)</button>}
          {esAdmin && coberturaManualVigente && <button
            type="button"
            style={{ ...S.btn, justifyContent:'center', background:'rgba(239,68,68,.15)', color:'#fecaca', border:'1px solid rgba(239,68,68,.45)' }}
            disabled={Boolean(loadingAccion)}
            onClick={() => abrirAccion(alerta, 'anulacion_cobertura', coberturaOrigen)}
          >Anular cobertura manual</button>}
          {['tardanza', 'fuera_radio'].includes(alerta.tipo) && <button
            type="button"
            style={estiloBotonAccion('comentario', accionEstaSeleccionada(alerta, 'alerta_revisada'))}
            disabled={Boolean(loadingAccion)}
            onClick={() => abrirAccion(alerta, 'alerta_revisada')}
          >Justificar / atender</button>}
          <button
            type="button"
            style={estiloBotonAccion('comentario', accionEstaSeleccionada(alerta, 'comentario'))}
            disabled={Boolean(loadingAccion)}
            onClick={() => abrirAccion(alerta, 'comentario')}
          >
            Comentar
          </button>
        </div>

        {renderPanelAccion(alerta)}
        {renderHistorial(alerta)}
      </div>
    )
  }

  const renderIntervenida = (item: any) => {
    const turno = item.turno as Turno
    const intervencion = item.intervencion
    const asignacion = supervisorGuardiaAsignado(turno)
    const alerta: AlertaOperativaAdmin = alertaBase(
      turno,
      item.tipo,
      tipoAlertaLabel(item.tipo),
      'Alerta intervenida',
      'info',
      item.registro
    )
    const coberturaOrigen = intervencionesAlerta(alerta).find((evento: any) =>
      ['confirmar_cubierto', 'marcado_cubierto_manual'].includes(evento.accion)
    )
    const registroCoberturaId = coberturaOrigen?.resultado_json?.registro_cobertura_id
    const registroCobertura = registroCoberturaId
      ? registros.find((registro: RegistroAsistencia) => registro.id === registroCoberturaId)
      : undefined
    const puedeAnularCobertura = esAdmin && coberturaOrigen && registroCobertura && !registroCobertura.cobertura_anulada_at

    return (
      <div key={claveOcurrenciaAlerta(turno.id, item.tipo, item.registro?.id || intervencion.registro_asistencia_id)} style={{ background:'rgba(16,185,129,.07)', border:'1px solid rgba(16,185,129,.25)', borderRadius:12, padding:18, marginBottom:14 }}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'flex-start' }}>
          <div>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:16, fontWeight:800, color:'#e2e8f0' }}>{nombreObjetivo(turno.objetivo_id)}</div>
            <div style={{ fontSize:13, color:'#94a3b8', marginTop:4 }}>{formatFecha(turno.fecha)} · {hora(turno.hora_inicio)} a {hora(turno.hora_fin)}</div>
          </div>
          <Badge type="resuelta">Intervenida</Badge>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(190px, 1fr))', gap:10, background:'#111827', border:'1px solid #1e2d42', borderRadius:8, padding:12, marginTop:12 }}>
          <div><div style={S.label}>Tipo de alerta</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{tipoAlertaLabel(item.tipo)}</div></div>
          <div><div style={S.label}>Guardia asignado</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{nombreUsuario(turno.guardia_id)}</div></div>
          <div><div style={S.label}>Acción realizada</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{accionLabel(intervencion.accion)}</div></div>
          <div><div style={S.label}>Supervisor/admin que intervino</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{nombreUsuario(intervencion.supervisor_intervino_id || intervencion.supervisor_id)}</div></div>
          <div><div style={S.label}>Supervisor asignado</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{intervencion.supervisor_asignado_id ? nombreUsuario(intervencion.supervisor_asignado_id) : nombresResponsables(asignacion)}</div></div>
          <div><div style={S.label}>Fecha/hora</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{fechaHoraTexto(intervencion.created_at)}</div></div>
          <div><div style={S.label}>Estado</div><div style={{ fontSize:13, color:'#10b981' }}>Intervenida</div></div>
          <div style={{ gridColumn:'1 / -1' }}><div style={S.label}>Comentario</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{intervencion.comentario || '—'}</div></div>
          {intervencion.motivo && <div style={{ gridColumn:'1 / -1' }}><div style={S.label}>Motivo</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{intervencion.motivo}</div></div>}
        </div>
        {coberturaOrigen && (
          <div style={{ background:'rgba(245,158,11,.12)', border:'1px solid rgba(245,158,11,.45)', color:'#fde68a', borderRadius:8, padding:12, marginTop:12, fontSize:13 }}>
            <strong>Importante:</strong> Reabrir esta alerta no elimina la cobertura ni revierte las horas liquidables. La asistencia debe corregirse por separado.
          </div>
        )}
        <button
          type="button"
          style={{ ...S.btn, ...S.btnSecondary, justifyContent:'center', marginTop:12 }}
          disabled={Boolean(loadingAccion)}
          onClick={() => abrirAccion(alerta, 'reapertura')}
        >Reabrir alerta</button>
        {puedeAnularCobertura && <button
          type="button"
          style={{ ...S.btn, justifyContent:'center', marginTop:12, marginLeft:8, background:'rgba(239,68,68,.15)', color:'#fecaca', border:'1px solid rgba(239,68,68,.45)' }}
          disabled={Boolean(loadingAccion)}
          onClick={() => abrirAccion(alerta, 'anulacion_cobertura', coberturaOrigen)}
        >Anular cobertura manual</button>}
        {registroCobertura?.cobertura_anulada_at && (
          <div style={{ color:'#fca5a5', fontSize:13, marginTop:12 }}>Cobertura anulada para liquidación el {fechaHoraTexto(registroCobertura.cobertura_anulada_at)}.</div>
        )}
        {renderPanelAccion(alerta)}
        {renderHistorial(alerta)}
      </div>
    )
  }

  const gruposPendientes = [
    { tipo:'descubierto', titulo:'Puestos sin cobertura' },
    { tipo:'sin_fichar', titulo:'Guardias sin fichar / objetivos en riesgo' },
    { tipo:'tardanza', titulo:'Tardanzas registradas' },
    { tipo:'fuera_radio', titulo:'Fichajes fuera de radio' },
    { tipo:'salida_pendiente', titulo:'Salidas pendientes' },
  ]

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding:'8px 20px', borderRadius:8, cursor:'pointer', fontSize:13, border:'none',
    fontFamily:'DM Sans,sans-serif', fontWeight: active ? 700 : 500,
    color: active ? '#111827' : '#94a3b8', background: active ? '#f59e0b' : 'transparent',
  })

  return (
    <div>
      <div style={{ marginBottom:24 }}>
        <div style={S.title}>Revisión Operativa</div>
        <div style={S.sub2}>Alertas operativas intervenibles desde Admin</div>
      </div>

      {mensaje && <div style={{ background:'rgba(16,185,129,.12)', border:'1px solid rgba(16,185,129,.35)', color:'#86efac', borderRadius:8, padding:12, marginBottom:16 }}>{mensaje}</div>}
      {error && !accionActiva && <div style={{ background:'rgba(239,68,68,.12)', border:'1px solid rgba(239,68,68,.35)', color:'#fca5a5', borderRadius:8, padding:12, marginBottom:16 }}>{error}</div>}
      {filtroActivo && <div style={{ ...S.card, padding:12, marginBottom:16, display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
        <span style={{ color:'#f59e0b' }}>Filtro activo: {filtroActivo.label}</span>
        <button type="button" style={{ ...S.btn, ...S.btnSecondary }} onClick={limpiarFiltro}>Quitar filtro</button>
      </div>}

      {/* Una ronda pausada NO genera alerta: sin este bloque, la ausencia de
          alertas acá es indistinguible de una ronda cumplida. */}
      <div style={{ background:alpha(brandColors.surface, 0.92), border:`1px solid ${brandColors.border}`, borderRadius:8, padding:16, marginBottom:24 }}>
        <RondasPausadasPanel objetivoId={null} />
      </div>

      {/* Cierre de turno modal */}
      {turnoParaCerrar && (
        <CerrarTurnoModal
          turno={turnoParaCerrar}
          registros={registros}
          guardias={guardias}
          objetivos={objetivos}
          onClose={() => setTurnoParaCerrar(null)}
          onSuccess={(turnoId, _uid) => {
            setTurnos((prev: Turno[]) => prev.map((t: Turno) =>
              t.id === turnoId ? { ...t, revisado_at: new Date().toISOString(), estado: 'cubierto' as const } : t
            ))
            setTurnoParaCerrar(null)
            setMensaje('Turno cerrado correctamente.')
          }}
        />
      )}

      {/* Turnos listos para cierre */}
      {(() => {
        const turnosCierre = turnosHoy.filter((t: Turno) => {
          const ended = finTurnoMasToleranciaPaso(t)
          const tieneRegs = registros.some((r: RegistroAsistencia) => r.turno_id === t.id)
          return ended || tieneRegs
        })

        return (
          <div style={{ display:'flex', gap:4, background:'#1a2235', borderRadius:10, padding:4, marginBottom:24, width:'fit-content', flexWrap:'wrap' as const }}>
            <button style={tabStyle(tab === 'pendientes')} onClick={() => setTab('pendientes')}>
              Alertas pendientes ({alertasPendientesVisibles.length})
            </button>
            <button style={tabStyle(tab === 'intervenidas')} onClick={() => setTab('intervenidas')}>
              Alertas intervenidas ({intervenidasOrdenadas.length})
            </button>
            <button style={tabStyle(tab === 'asistencias_confirmadas')} onClick={() => setTab('asistencias_confirmadas')}>
              Asist. confirmadas ({asistenciasConfirmadasLista.length})
            </button>
            <button style={tabStyle(tab === 'cierre')} onClick={() => setTab('cierre')}>
              Cierre de turnos ({turnosCierre.length})
            </button>
          </div>
        )
      })()}

      {loadingData && <div style={{ textAlign:'center', padding:48, color:'#64748b' }}>Cargando intervenciones...</div>}

      {!loadingData && tab === 'pendientes' && (
        alertasPendientesVisibles.length === 0 ? (
          <div style={{ ...S.card, textAlign:'center', padding:48, color:'#64748b' }}>
            <div style={{ fontSize:36, marginBottom:12 }}>✓</div>
            <div>No hay alertas operativas pendientes</div>
          </div>
        ) : gruposPendientes.map(grupo => {
          const items = alertasPendientesVisibles.filter(alerta => alerta.tipo === grupo.tipo)
          if (items.length === 0) return null

          return (
            <section key={grupo.tipo} style={{ marginBottom:22 }}>
              <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, color:'#e2e8f0', marginBottom:10 }}>{grupo.titulo} · {items.length}</div>
              {items.map(renderAlertaPendiente)}
            </section>
          )
        })
      )}

      {!loadingData && tab === 'intervenidas' && (
        intervenidasOrdenadas.length === 0 ? (
          <div style={{ ...S.card, textAlign:'center', padding:48, color:'#64748b' }}>
            <div style={{ fontSize:36, marginBottom:12 }}>✓</div>
            <div>No hay alertas intervenidas para hoy</div>
          </div>
        ) : intervenidasOrdenadas.map(renderIntervenida)
      )}

      {!loadingData && tab === 'asistencias_confirmadas' && (
        asistenciasConfirmadasLista.length === 0 ? (
          <div style={{ ...S.card, textAlign:'center', padding:48, color:'#64748b' }}>
            <div style={{ fontSize:36, marginBottom:12 }}>✓</div>
            <div>No hay asistencias confirmadas pendientes de regularización</div>
          </div>
        ) : (
          <div>
            <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, color:'#e2e8f0', marginBottom:10 }}>
              Asistencias confirmadas pendientes de regularización · {asistenciasConfirmadasLista.length}
            </div>
            <div style={{ overflowX:'auto' }}>
              <table style={{ ...S.table, minWidth: 900 }}>
                <thead>
                  <tr>
                    <th style={S.th}>Empleado</th>
                    <th style={S.th}>CUIL / Legajo</th>
                    <th style={S.th}>Objetivo</th>
                    <th style={S.th}>Puesto</th>
                    <th style={S.th}>Fecha turno</th>
                    <th style={S.th}>Horario</th>
                    <th style={S.th}>Supervisor</th>
                    <th style={S.th}>Confirmado</th>
                    <th style={S.th}>Comentario</th>
                    <th style={S.th}>Estado</th>
                    <th style={S.th}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {asistenciasConfirmadasLista.map((item: any) => {
                    const g = item.guardia
                    const cuil = g?.cuil ? formatCuil(g.cuil) : null
                    return (
                      <tr key={`ac-${item.turno.id}-${item.intervencion.id}`}>
                        <td style={S.td}><strong>{g ? `${g.apellido}, ${g.nombre}` : '—'}</strong></td>
                        <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:700, color:'#f59e0b' }}>
                          {cuil || g?.legajo || '—'}
                          {cuil && g?.legajo ? <div style={{ fontSize:10, color:'#64748b', fontWeight:400 }}>Int: {g.legajo}</div> : null}
                        </td>
                        <td style={S.td}>{item.objetivo?.nombre || '—'}</td>
                        <td style={S.td}>{item.puesto?.nombre || '—'}</td>
                        <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:600 }}>{formatFecha(item.turno.fecha)}</td>
                        <td style={S.td}>{formatHorarioAsignado(item.turno)}</td>
                        <td style={S.td}>{item.supervisor ? `${item.supervisor.apellido}, ${item.supervisor.nombre}` : '—'}</td>
                        <td style={{ ...S.td, fontSize:12 }}>{item.intervencion.created_at ? formatFechaHora(item.intervencion.created_at) : '—'}</td>
                        <td style={{ ...S.td, fontSize:12, maxWidth:200 }}>{item.intervencion.comentario || '—'}</td>
                        <td style={S.td}><Badge type="pendiente">Pend. regularización</Badge></td>
                        <td style={S.td}>
                          <div style={{ display:'flex', gap:4, flexDirection:'column' }}>
                            <button
                              style={{ ...S.btn, background:'#14532d', color:'#4ade80', border:'1px solid #166534', padding:'5px 10px', fontSize:11 }}
                              onClick={() => {
                                const alerta = alertaBase(item.turno, 'sin_fichar', '', '', 'warn', item.registro)
                                abrirAccion(alerta, 'confirmar_cubierto')
                              }}
                            >Cargar asistencia manual</button>
                            <button
                              style={{ ...S.btn, background:'rgba(239,68,68,.15)', color:'#fca5a5', border:'1px solid rgba(239,68,68,.35)', padding:'5px 10px', fontSize:11 }}
                              onClick={() => {
                                const alerta = alertaBase(item.turno, 'sin_fichar', '', '', 'warn', item.registro)
                                abrirAccion(alerta, 'reapertura')
                              }}
                            >Rechazar / reabrir</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {tab === 'cierre' && (() => {
        const turnosCierre = turnosHoy
          .filter((t: Turno) => finTurnoMasToleranciaPaso(t) || registros.some((r: RegistroAsistencia) => r.turno_id === t.id))
          .sort((a: Turno, b: Turno) => a.hora_inicio.localeCompare(b.hora_inicio))

        if (turnosCierre.length === 0) {
          return (
            <div style={{ ...S.card, textAlign:'center', padding:48, color:'#64748b' }}>
              <div style={{ fontSize:36, marginBottom:12 }}>✓</div>
              <div>No hay turnos disponibles para cierre</div>
            </div>
          )
        }

        return (
          <div>
            {turnosCierre.map((t: Turno) => {
              const regs = registros.filter((r: RegistroAsistencia) => r.turno_id === t.id)
              const yaRevisado = !!(t as any).revisado_at
              const objetivo = (objetivos as Objetivo[]).find((o: Objetivo) => o.id === t.objetivo_id)

              return (
                <div key={t.id} style={{
                  background: yaRevisado ? 'rgba(16,185,129,.06)' : '#111827',
                  border: `1px solid ${yaRevisado ? 'rgba(16,185,129,.28)' : '#1e2d42'}`,
                  borderRadius:12, padding:16, marginBottom:12,
                }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, flexWrap:'wrap' as const }}>
                    <div>
                      <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, color:'#e2e8f0', fontSize:15 }}>
                        {objetivo?.nombre ?? 'Objetivo sin nombre'}
                      </div>
                      <div style={{ fontSize:13, color:'#94a3b8', marginTop:4 }}>
                        {formatFecha(t.fecha)} · {t.hora_inicio.slice(0,5)} – {t.hora_fin.slice(0,5)}
                        {t.guardia_id ? ` · ${nombreUsuario(t.guardia_id)}` : ' · Sin guardia asignado'}
                      </div>
                      {regs.length > 0 && (
                        <div style={{ fontSize:12, color:'#64748b', marginTop:4 }}>
                          {regs.filter((r: RegistroAsistencia) => r.hora_entrada_real).length} fichaje(s) GPS registrado(s)
                        </div>
                      )}
                    </div>
                    <div style={{ display:'flex', gap:8, alignItems:'center', flexShrink:0 }}>
                      {yaRevisado
                        ? <Badge type="resuelta">Revisado</Badge>
                        : <Badge type="pendiente">Pendiente</Badge>
                      }
                      <button
                        type="button"
                        style={{ ...S.btn, ...S.btnPrimary, padding:'6px 16px', fontSize:13 }}
                        onClick={() => setTurnoParaCerrar(t)}
                      >
                        {yaRevisado ? 'Re-cerrar' : 'Cerrar turno'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })()}
    </div>
  )
}
// ============================================================
// COMPONENTE: TurnosBase
// UBICACIÓN: Pegarlo en AppClient.tsx ANTES de la función AppPage
//
// PASO 1: Agregar al menú admin:
//   { id: 'turnos_base', icon: '🧱', label: 'Turnos Base' }
//
// PASO 2: Agregar al render admin:
//   {page === 'turnos_base' && <TurnosBase />}
//
// ============================================================

function TurnosBase() {
  const [turnos, setTurnos] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editando, setEditando] = useState<any>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const formVacio = {
    nombre: '',
    hora_inicio: '',
    hora_fin: '',
    descripcion: '',
    activo: true,
  }

  const [form, setForm] = useState(formVacio)

  const cargar = async () => {
    setLoading(true)

    const { data, error } = await supabase
      .from('turnos_base')
      .select('*')
      .order('created_at', { ascending: true })

    if (!error) setTurnos(data || [])

    setLoading(false)
  }

  useEffect(() => {
    cargar()
  }, [])

  const abrirNuevo = () => {
    setEditando(null)
    setForm(formVacio)
    setError('')
    setShowForm(true)
  }

  const abrirEditar = (t: any) => {
    setEditando(t)

    setForm({
      nombre: t.nombre,
      hora_inicio: t.hora_inicio?.slice(0, 5) ?? '',
      hora_fin: t.hora_fin?.slice(0, 5) ?? '',
      descripcion: t.descripcion ?? '',
      activo: t.activo,
    })

    setError('')
    setShowForm(true)
  }

  const cancelar = () => {
    setShowForm(false)
    setEditando(null)
    setForm(formVacio)
    setError('')
  }

  const guardar = async () => {
    if (!form.nombre.trim()) {
      setError('El nombre es obligatorio.')
      return
    }

    if (!form.hora_inicio) {
      setError('La hora de inicio es obligatoria.')
      return
    }

    if (!form.hora_fin) {
      setError('La hora de fin es obligatoria.')
      return
    }

    if (form.hora_inicio === form.hora_fin) {
      setError('La hora inicio y fin no pueden ser iguales.')
      return
    }

    setGuardando(true)
    setError('')

    const payload = {
      nombre: form.nombre.trim(),
      hora_inicio: form.hora_inicio + ':00',
      hora_fin: form.hora_fin + ':00',
      descripcion: form.descripcion.trim() || null,
      activo: form.activo,
    }

    let err

    if (editando) {
      ;({ error: err } = await supabase
        .from('turnos_base')
        .update(payload)
        .eq('id', editando.id))
    } else {
      ;({ error: err } = await supabase
        .from('turnos_base')
        .insert(payload))
    }

    if (err) {
      setError('Error al guardar: ' + err.message)
    } else {
      await cargar()
      cancelar()
    }

    setGuardando(false)
  }

  const toggleActivo = async (t: any) => {
    await supabase
      .from('turnos_base')
      .update({ activo: !t.activo })
      .eq('id', t.id)

    await cargar()
  }

  // ── estilos ────────────────────────────────────────────────

  const s = {
    container: {
      padding: '24px',
      color: '#f5f5f5',
    } as React.CSSProperties,

    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '24px',
    } as React.CSSProperties,

    title: {
      fontSize: '22px',
      fontWeight: 700,
      color: '#f97316',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    } as React.CSSProperties,

    btnPrimary: {
      background: '#f97316',
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      padding: '8px 18px',
      fontWeight: 600,
      fontSize: '14px',
      cursor: 'pointer',
    } as React.CSSProperties,

    btnSecondary: {
      background: 'transparent',
      color: '#9ca3af',
      border: '1px solid #374151',
      borderRadius: '8px',
      padding: '8px 18px',
      fontWeight: 600,
      fontSize: '14px',
      cursor: 'pointer',
    } as React.CSSProperties,

    btnToggleOn: {
      background: '#16a34a22',
      color: '#4ade80',
      border: '1px solid #16a34a55',
      borderRadius: '6px',
      padding: '4px 12px',
      fontSize: '12px',
      cursor: 'pointer',
      fontWeight: 600,
    } as React.CSSProperties,

    btnToggleOff: {
      background: '#6b728022',
      color: '#9ca3af',
      border: '1px solid #37415155',
      borderRadius: '6px',
      padding: '4px 12px',
      fontSize: '12px',
      cursor: 'pointer',
      fontWeight: 600,
    } as React.CSSProperties,

    btnEdit: {
      background: 'transparent',
      color: '#f97316',
      border: '1px solid #f9731644',
      borderRadius: '6px',
      padding: '4px 12px',
      fontSize: '12px',
      cursor: 'pointer',
      fontWeight: 600,
    } as React.CSSProperties,

    table: {
      width: '100%',
      borderCollapse: 'collapse' as const,
    },

    th: {
      textAlign: 'left' as const,
      padding: '10px 14px',
      fontSize: '12px',
      fontWeight: 600,
      color: '#6b7280',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.05em',
      borderBottom: '1px solid #1f2937',
    },

    td: {
      padding: '12px 14px',
      fontSize: '14px',
      borderBottom: '1px solid #1f293766',
      verticalAlign: 'middle' as const,
    },

    card: {
      background: '#111827',
      borderRadius: '12px',
      border: '1px solid #1f2937',
      overflow: 'hidden',
    } as React.CSSProperties,

    overlay: {
      position: 'fixed' as const,
      inset: 0,
      background: '#000000aa',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 50,
    },

    modal: {
      background: '#1f2937',
      borderRadius: '16px',
      padding: '28px',
      width: '100%',
      maxWidth: '480px',
      border: '1px solid #374151',
    } as React.CSSProperties,

    label: {
      display: 'block',
      fontSize: '12px',
      fontWeight: 600,
      color: '#9ca3af',
      marginBottom: '6px',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.05em',
    },

    input: {
      width: '100%',
      background: '#111827',
      border: '1px solid #374151',
      borderRadius: '8px',
      padding: '10px 12px',
      color: '#f5f5f5',
      fontSize: '14px',
      boxSizing: 'border-box' as const,
      marginBottom: '16px',
    },

    horaBadge: {
      background: '#f9731620',
      color: '#f97316',
      borderRadius: '6px',
      padding: '3px 10px',
      fontSize: '13px',
      fontWeight: 600,
      display: 'inline-block',
    },
  }

  return (
    <div style={s.container}>

      {/* Header */}

      <div style={s.header}>
        <div style={s.title}>
          🧱 Turnos Base
        </div>

        <button
          style={s.btnPrimary}
          onClick={abrirNuevo}
        >
          + Nuevo turno base
        </button>
      </div>

      {/* Tabla */}

      <div style={s.card}>

        {loading ? (

          <div style={{
            padding: '32px',
            textAlign: 'center',
            color: '#6b7280'
          }}>
            Cargando...
          </div>

        ) : turnos.length === 0 ? (

          <div style={{
            padding: '32px',
            textAlign: 'center',
            color: '#6b7280'
          }}>
            No hay turnos base creados todavía.
          </div>

        ) : (

          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Nombre</th>
                <th style={s.th}>Horario</th>
                <th style={s.th}>Descripción</th>
                <th style={s.th}>Estado</th>
                <th style={s.th}>Acciones</th>
              </tr>
            </thead>

            <tbody>
              {turnos.map((t) => (

                <tr
                  key={t.id}
                  style={{
                    opacity: t.activo ? 1 : 0.5
                  }}
                >

                  <td style={{
                    ...s.td,
                    fontWeight: 600,
                    color: '#f5f5f5'
                  }}>
                    {t.nombre}
                  </td>

                  <td style={s.td}>
                    <span style={s.horaBadge}>
                      {t.hora_inicio
                        ? t.hora_inicio.slice(0,5)
                        : '--:--'}
                      {' → '}
                      {t.hora_fin
                        ? t.hora_fin.slice(0,5)
                        : '--:--'}
                    </span>
                  </td>

                  <td style={{
                    ...s.td,
                    color: '#9ca3af',
                    fontSize: '13px'
                  }}>
                    {t.descripcion || '—'}
                  </td>

                  <td style={s.td}>
                    <button
                      style={
                        t.activo
                          ? s.btnToggleOn
                          : s.btnToggleOff
                      }
                      onClick={() => toggleActivo(t)}
                    >
                      {t.activo
                        ? '✓ Activo'
                        : '✗ Inactivo'}
                    </button>
                  </td>

                  <td style={s.td}>
                    <button
                      style={s.btnEdit}
                      onClick={() => abrirEditar(t)}
                    >
                      ✏️ Editar
                    </button>
                  </td>

                </tr>

              ))}
            </tbody>
          </table>

        )}

      </div>

      {/* Modal */}

      {showForm && (

        <div style={s.overlay}>

          <div style={s.modal}>

            <h3 style={{
              margin: '0 0 20px',
              color: '#f97316',
              fontWeight: 700,
              fontSize: '18px'
            }}>
              {editando
                ? '✏️ Editar turno base'
                : '🧱 Nuevo turno base'}
            </h3>

            <label style={s.label}>
              Nombre *
            </label>

            <input
              style={s.input}
              placeholder="Ej: Diurno 08-20"
              value={form.nombre}
              onChange={e =>
                setForm({
                  ...form,
                  nombre: e.target.value
                })
              }
            />

            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '12px'
            }}>

              <div>
                <label style={s.label}>
                  Hora inicio *
                </label>

                <input
                  type="time"
                  style={s.input}
                  value={form.hora_inicio}
                  onChange={e =>
                    setForm({
                      ...form,
                      hora_inicio: e.target.value
                    })
                  }
                />
              </div>

              <div>
                <label style={s.label}>
                  Hora fin *
                </label>

                <input
                  type="time"
                  style={s.input}
                  value={form.hora_fin}
                  onChange={e =>
                    setForm({
                      ...form,
                      hora_fin: e.target.value
                    })
                  }
                />
              </div>

            </div>

            <label style={s.label}>
              Descripción
            </label>

            <input
              style={s.input}
              placeholder="Ej: Turno nocturno de 12 horas"
              value={form.descripcion}
              onChange={e =>
                setForm({
                  ...form,
                  descripcion: e.target.value
                })
              }
            />

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginBottom: '20px'
            }}>

              <input
                type="checkbox"
                id="activo"
                checked={form.activo}
                onChange={e =>
                  setForm({
                    ...form,
                    activo: e.target.checked
                  })
                }
                style={{
                  width: '16px',
                  height: '16px',
                  accentColor: '#f97316'
                }}
              />

              <label
                htmlFor="activo"
                style={{
                  color: '#d1d5db',
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                Activo
              </label>

            </div>

            {error && (

              <div style={{
                background: '#7f1d1d33',
                border: '1px solid #ef444455',
                color: '#fca5a5',
                borderRadius: '8px',
                padding: '10px 14px',
                fontSize: '13px',
                marginBottom: '16px',
              }}>
                {error}
              </div>

            )}

            <div style={{
              display: 'flex',
              gap: '10px',
              justifyContent: 'flex-end'
            }}>

              <button
                style={s.btnSecondary}
                onClick={cancelar}
                disabled={guardando}
              >
                Cancelar
              </button>

              <button
                style={s.btnPrimary}
                onClick={guardar}
                disabled={guardando}
              >
                {guardando
                  ? 'Guardando...'
                  : editando
                    ? 'Guardar cambios'
                    : 'Crear turno base'}
              </button>

            </div>

          </div>

        </div>

      )}

    </div>
  )
}
export default function AppPage() {
  const [user, setUser] = useState<any>(null)
  const [page, setPage] = useState('dashboard')
  const [guardias, setGuardias] = useState<Usuario[]>([])
  const [objetivos, setObjetivos] = useState<Objetivo[]>([])
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [registros, setRegistros] = useState<RegistroAsistencia[]>([])
  const [novedades, setNovedades] = useState<Novedad[]>([])
  const [checklistPlantillas, setChecklistPlantillas] = useState<ChecklistPlantillaAdmin[]>([])
  const [checklistItems, setChecklistItems] = useState<ChecklistItemAdmin[]>([])
  const [supervisionesAdmin, setSupervisionesAdmin] = useState<SupervisionAdmin[]>([])
  const [supervisionesMesAdmin, setSupervisionesMesAdmin] = useState<SupervisionRankingAdmin[]>([])
  const [ultimasSupervisionesObjetivosAdmin, setUltimasSupervisionesObjetivosAdmin] = useState<UltimaSupervisionObjetivoAdmin[]>([])
  const [zonasOperativas, setZonasOperativas] = useState<any[]>([])
  const [supervisorZonas, setSupervisorZonas] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filtros, setFiltros] = useState<Record<string, any>>({})

  // Entrada por URL: permite linkear a una sección con filtros ya puestos, por
  // ejemplo desde la planilla del guardia hacia la bandeja de revisión filtrada
  // por esa persona y ese mes. Se lee una sola vez, al montar.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const destino = q.get('page')
    if (destino !== 'revision_planillas') return
    setPage(destino)
    setFiltros(prev => ({
      ...prev,
      revision_planillas: {
        empleadoId: q.get('empleado') || null,
        mes: q.get('mes') || undefined,
      },
    }))
  }, [])
  const [adminMobileView, setAdminMobileView] = useState<AdminMobileView>('admin')
  const [esPantallaChicaAdmin, setEsPantallaChicaAdmin] = useState(false)
  const [adminDataLoaded, setAdminDataLoaded] = useState(false)

  const cargarDatosAdmin = useCallback(async () => {
    setLoading(true)
    const ahora = new Date()
    const inicioMes = inicioMesArgISO(ahora)
    const inicioMesSiguiente = inicioMesSiguienteArgISO(ahora)
    const mesActual = mesActualArgentina()
    const [fdY, fdM] = mesActual.split('-').map(Number)
    const desdeStr = `${mesActual}-01`
    const hastaISO = new Date(Date.UTC(fdY, fdM, 1, 3, 0, 0)).toISOString()
    const hastaStr = hastaISO.slice(0, 10)
    const [g, o, t, r, n, cp, ci, s, sm, su, z, sz] = await Promise.all([
      supabase.from('usuarios').select('*').order('apellido'),
      supabase.from('objetivos').select('*').order('nombre'),
      // Turnos y asistencia del mes se paginan: superan las 1000 filas que
      // PostgREST devuelve como máximo, y el recorte es silencioso. Sin paginar,
      // `order('fecha', desc)` dejaba afuera los primeros días del mes.
      fetchPaginadoResult<Turno>((desde, hasta) =>
        supabase.from('turnos').select('*').gte('fecha', desdeStr).lt('fecha', hastaStr).order('fecha', { ascending: false }).order('id').range(desde, hasta),
      ),
      // El filtro va por la fecha del turno, no por `created_at` del registro:
      // una cobertura precargada o una regularización posterior pertenecen al
      // mes que trabajaron, no al mes en que se cargaron.
      fetchPaginadoResult<RegistroAsistencia>((desde, hasta) =>
        supabase.from('registros_asistencia').select('*,turno:turnos!inner(fecha)').gte('turno.fecha', desdeStr).lt('turno.fecha', hastaStr).order('created_at', { ascending: false }).order('id').range(desde, hasta),
      ),
      supabase.from('novedades').select('*').order('created_at', { ascending: false }),
      supabase.from('checklist_plantillas').select('*').order('nombre'),
      supabase.from('checklist_items').select('*').order('orden', { ascending: true }),
      supabase
        .from('supervisiones')
        .select('*, objetivo:objetivos(nombre), supervisor:usuarios(nombre, apellido), respuestas:supervision_respuestas(resultado), fotos:supervision_fotos(id, storage_path)')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('supervisiones')
        .select('id, objetivo_id, supervisor_id, estado, created_at')
        .gte('created_at', inicioMes)
        .lt('created_at', inicioMesSiguiente)
        .order('created_at', { ascending: false }),
      // Última supervisión por objetivo. El .limit(5000) no servía: PostgREST
      // corta en 1000 igual, sin avisar, y con 1.253 supervisiones se perdían
      // 253 — objetivos que figuraban "sin supervisar nunca" por truncamiento.
      // El orden secundario por id hace estable la paginación: sin desempate,
      // dos filas con el mismo created_at pueden repetirse o saltearse entre
      // páginas.
      // `id` va en el select aunque no se use: se ordena por él, y no depender
      // de que PostgREST acepte ordenar por una columna no seleccionada evita
      // un modo de falla feo — si la consulta fallara, esto devuelve data: []
      // y todos los objetivos pasarían a decir "Nunca supervisado".
      fetchPaginadoResult((desde, hasta) =>
        supabase
          .from('supervisiones')
          .select('id, objetivo_id, created_at')
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(desde, hasta)),
      supabase.from('zonas_operativas').select('*').order('nombre'),
      supabase.from('supervisor_zonas').select('*'),
    ])
    if (g.data) setGuardias(g.data)
    if (o.data) setObjetivos(o.data)
    if (t.data) setTurnos(t.data)
    if (r.data) setRegistros(r.data)
    if (n.data) setNovedades(n.data)
    if (cp.data) setChecklistPlantillas(cp.data)
    if (ci.data) setChecklistItems(ci.data)
    if (s.data) setSupervisionesAdmin(s.data)
    if (sm.data) setSupervisionesMesAdmin(sm.data as SupervisionRankingAdmin[])
    if (su.data) setUltimasSupervisionesObjetivosAdmin(su.data as UltimaSupervisionObjetivoAdmin[])
    if (z.data) setZonasOperativas(z.data)
    if (sz.data) setSupervisorZonas(sz.data)
    setAdminDataLoaded(true)
    setLoading(false)
  }, [])

  const cargarSesionPorRol = useCallback(async (perfil: Usuario) => {
    if (esRolAdmin(perfil.rol)) {
      const pantallaChica = detectarPantallaChicaAdmin()
      const preferencia = leerPreferenciaVistaAdmin()
      const vistaInicial: AdminMobileView = preferencia === 'supervisor'
        ? 'supervisor'
        : pantallaChica
          ? (preferencia || 'supervisor')
          : 'admin'

      setEsPantallaChicaAdmin(pantallaChica)
      setAdminMobileView(vistaInicial)
      setUser(perfil)

      if (vistaInicial === 'admin') {
        await cargarDatosAdmin()
      } else {
        setLoading(false)
      }
      return
    }

    setUser(perfil)
    setLoading(false)
  }, [cargarDatosAdmin])

  const seleccionarVistaAdmin = useCallback((vista: AdminMobileView) => {
    if (!esRolAdmin(user?.rol)) return

    guardarPreferenciaVistaAdmin(vista)
    setAdminMobileView(vista)

    if (vista === 'admin') {
      if (!adminDataLoaded) {
        void cargarDatosAdmin()
      } else {
        setLoading(false)
      }
      return
    }

    setLoading(false)
  }, [adminDataLoaded, cargarDatosAdmin, user?.rol])

  useEffect(() => {
    const actualizarPantalla = () => setEsPantallaChicaAdmin(detectarPantallaChicaAdmin())

    actualizarPantalla()
    window.addEventListener('resize', actualizarPantalla)
    return () => window.removeEventListener('resize', actualizarPantalla)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        setLoading(false)
        return
      }

      const { data: perfil, error } = await supabase
        .from('usuarios')
        .select('*')
        .eq('auth_user_id', data.session.user.id)
        .single()

      if (error || !perfil) {
        await supabase.auth.signOut()
        setUser(null)
        setLoading(false)
        return
      }

      await cargarSesionPorRol(perfil)
    })
  }, [cargarSesionPorRol])

  const navegarConFiltro = (destino: string, filtro: any) => {
    setFiltros(prev => ({ ...prev, [destino]: filtro }))
    setPage(destino)
  }

  const limpiarFiltro = (destino: string) => {
    setFiltros(prev => {
      const next = { ...prev }
      delete next[destino]
      return next
    })
  }

if (loading && !user) return <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', color:'#64748b' }}>Cargando...</div>

if (!user) return <Login onLogin={u => { void cargarSesionPorRol(u) }} />

if (esRolGuardia(user.rol)) {
  return <GuardiaMobile user={user} />
}

if (user.rol === 'supervisor') {
  return <SupervisorMobile user={user} />
}

const adminShellPaddingTop = esPantallaChicaAdmin ? 106 : 76

if (esRolAdmin(user.rol) && adminMobileView === 'supervisor') {
  return (
    <div style={{ minHeight:'100vh', background:'#0a0e1a', paddingTop:adminShellPaddingTop }}>
      <AdminViewHeader currentView={adminMobileView} onChange={seleccionarVistaAdmin} compact={esPantallaChicaAdmin} />
      <SupervisorMobile user={user} />
    </div>
  )
}

const esGuardia = esRolGuardia(user.rol)

  const NAV = esGuardia ? [
    { section:'Mi turno', items:[
      { id:'asistencia', icon:'✅', label:'Mi Asistencia' },
      { id:'novedades', icon:'📋', label:'Mis Novedades' },
    ]}
  ] : [
    { section:'GENERAL', items:[{ id:'dashboard', icon:'📊', label:'Panel Principal' }] },
    { section:'OPERACIONES', items:[
      { id:'guardias', icon:'👮', label:'Guardias' },
      { id:'objetivos', icon:'🏢', label:'Objetivos' },
      { id:'turnos', icon:'📅', label:'Turnos' },
      { id:'asistencia', icon:'✅', label:'Asistencia' },
      { id:'rondas', icon:'🔁', label:'Rondas' },
      { id:'pagina_gps', icon:'📍', label:'Página GPS' },
    ]},
    { section:'ADMINISTRACIÓN', items:[
      { id:'revision_operativa', icon:'🛂', label:'Revisión Operativa' },
      { id:'revision_fotos_ia', icon:'🤖', label:'Revisión de fotos IA' },
      { id:'revision_planillas', icon:'📑', label:'Revisión de planillas' },
      { id:'supervisiones', icon:'☑️', label:'Supervisiones' },
      { id:'novedades', icon:'📋', label:'Novedades' },
      { id:'reportes', icon:'📈', label:'Reportes' },
      { id:'supervisores_guardia', icon:'🔔', label:'Supervisores de Guardia' },
      { id:'solicitudes_admin', icon:'📝', label:'Solicitudes Admin' },
    ]},
    { section:'CONFIGURACIÓN', items:[
      { id:'servicios_objetivo', icon:'📅', label:'Programación' },
      { id:'checklists', icon:'☑️', label:'Checklists' },
      { id:'turnos_base', icon:'⏰', label:'Turnos Base' },
      { id:'zonas_operativas', icon:'🗺️', label:'Zonas operativas' },
      { id:'referencias_ia', icon:'🖼️', label:'Referencias IA' },
    ]},
    { section:'SISTEMA', items:[
      { id:'observacion', icon:'🔭', label:'Observación del Sistema' },
    ]},
  ]

  const novedadesUrgentes = novedades.filter(n => n.prioridad === 'urgente' && n.estado !== 'resuelta').length
  const misNovedades = novedades.filter(n => n.guardia_id === user.id)
  const misTurnos = turnos.filter(t => t.guardia_id === user.id)

  return (
    <>
      {esRolAdmin(user.rol) && <AdminViewHeader currentView={adminMobileView} onChange={seleccionarVistaAdmin} compact={esPantallaChicaAdmin} />}
      <div style={{ ...S.app, paddingTop:esRolAdmin(user.rol) ? adminShellPaddingTop : 0 }}>
      <div style={S.sidebar}>
        <div style={S.sidebarLogo}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <img src={brandAssets.isotipo} alt="" style={{ width:38, height:38, objectFit:'contain' }} />
            <div>
              <div style={S.brand}>MERCOSUR</div>
              <div style={S.sub}>Control Operativo</div>
            </div>
          </div>
        </div>
        <nav style={{ flex:1, padding:'16px 0', overflowY:'auto' }}>
          {NAV.map(sec => (
            <div key={sec.section}>
              <div style={S.navSection}>{sec.section}</div>
              {sec.items.map(item => <NavItem key={item.id} {...item} active={page === item.id} badge={item.id === 'novedades' ? novedadesUrgentes : 0} onClick={setPage} />)}
            </div>
          ))}
        </nav>
        <div style={{ padding:'16px 20px', borderTop:`1px solid ${alpha(brandColors.yellow, 0.16)}`, background:alpha(brandColors.black, 0.22) }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:32, height:32, borderRadius:'50%', background:brandColors.yellow, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:FONT_BRAND, fontWeight:900, fontSize:13, color:brandColors.black }}>{user.nombre?.[0]}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:800, fontFamily:FONT_BRAND }}>{user.nombre}</div>
              <div style={{ fontSize:11, color:brandColors.muted }}>{user.rol}</div>
            </div>
            <button style={{ background:'none', border:'none', color:brandColors.muted, cursor:'pointer', fontSize:16 }} onClick={async () => { await supabase.auth.signOut(); setUser(null) }} title="Cerrar sesión">⏏</button>
          </div>
        </div>
      </div>
      <main style={S.main}>
        {loading ? <div style={{ color:'#64748b', padding:48, textAlign:'center' }}>Cargando datos...</div> : (
          esGuardia ? (
            <>
              {page === 'asistencia' && <Asistencia registros={registros} setRegistros={setRegistros} turnos={misTurnos} guardias={guardias} objetivos={objetivos} />}
              {page === 'novedades' && <Novedades novedades={misNovedades} setNovedades={setNovedades} guardias={guardias} objetivos={objetivos} />}
            </>
          ) : (
            <>
              {page === 'dashboard' && <Dashboard guardias={guardias} objetivos={objetivos} turnos={turnos} registros={registros} novedades={novedades} onNavigate={navegarConFiltro} />}
              {page === 'guardias' && <Guardias guardias={guardias} setGuardias={setGuardias} filtroActivo={filtros.guardias} limpiarFiltro={() => limpiarFiltro('guardias')} esAdmin={esRolAdmin(user?.rol)} />}
              {page === 'objetivos' && <Objetivos objetivos={objetivos} setObjetivos={setObjetivos} turnos={turnos} checklistPlantillas={checklistPlantillas} zonasOperativas={zonasOperativas} filtroActivo={filtros.objetivos} limpiarFiltro={() => limpiarFiltro('objetivos')} guardias={guardias} registros={registros} supervisiones={supervisionesAdmin} novedades={novedades} user={user} onNavigate={navegarConFiltro} />}
              {page === 'turnos' && <Turnos turnos={turnos} setTurnos={setTurnos} guardias={guardias} objetivos={objetivos} registros={registros} filtroActivo={filtros.turnos} limpiarFiltro={() => limpiarFiltro('turnos')} user={user} />}
              {page === 'asistencia' && <Asistencia registros={registros} setRegistros={setRegistros} turnos={turnos} setTurnos={setTurnos} guardias={guardias} objetivos={objetivos} supervisiones={supervisionesAdmin} filtroActivo={filtros.asistencia} limpiarFiltro={() => limpiarFiltro('asistencia')} user={user} esAdmin />}
              {page === 'rondas' && <RondasGlobal objetivos={objetivos} />}
              {/* Vista transversal de GPS. Recibe los mismos datos ya cargados
                  que consume Asistencia: no repite ninguna consulta de evidencia. */}
              {page === 'pagina_gps' && (
                <PaginaGps
                  objetivos={objetivos}
                  registros={registros}
                  turnos={turnos}
                  guardias={guardias}
                  supervisiones={supervisionesAdmin}
                  onObjetivoActualizado={(actualizado: any) =>
                    setObjetivos((prev: any[]) => prev.map(o => o.id === actualizado.id ? { ...o, ...actualizado } : o))
                  }
                />
              )}
              {page === 'servicios_objetivo' && <ServiciosObjetivo guardias={guardias} objetivos={objetivos} filtroActivo={filtros.servicios_objetivo} limpiarFiltro={() => limpiarFiltro('servicios_objetivo')} />}
              {page === 'zonas_operativas' && <ZonasOperativas guardias={guardias} objetivos={objetivos} zonas={zonasOperativas} setZonas={setZonasOperativas} supervisorZonas={supervisorZonas} setSupervisorZonas={setSupervisorZonas} />}
              {page === 'supervisores_guardia' && <SupervisoresGuardia guardias={guardias} user={user} zonas={zonasOperativas} />}
              {page === 'solicitudes_admin' && <SolicitudesAdmin user={user} guardias={guardias} setGuardias={setGuardias} objetivos={objetivos} setObjetivos={setObjetivos} />}
              {page === 'revision_operativa' && <RevisionOperativa guardias={guardias} objetivos={objetivos} turnos={turnos} registros={registros} setTurnos={setTurnos} setRegistros={setRegistros} user={user} supervisorZonas={supervisorZonas} zonasOperativas={zonasOperativas} filtroActivo={filtros.revision_operativa} limpiarFiltro={() => limpiarFiltro('revision_operativa')} />}
              {/* La MISMA bandeja que ve el supervisor: mismo componente, no una copia.
                  Desde acá con alcance de administración (todos los objetivos) y en
                  densidad cómoda; el filtro por vigilador llega desde la planilla del guardia. */}
              {page === 'revision_planillas' && (
                <BandejaPlanillas
                  user={user}
                  esAdmin
                  densidad="comoda"
                  empleadoInicial={filtros.revision_planillas?.empleadoId ?? null}
                  mesInicial={filtros.revision_planillas?.mes}
                  // "Modificar turno" abre el editor de turnos que ya existe:
                  // corregir la programación es otro circuito y por eso no
                  // genera ninguna ausencia.
                  onNavigate={(pagina, f) => navegarConFiltro(pagina, f)}
                />
              )}
              {page === 'supervisiones' && (
                <SupervisionesAdmin
                  supervisiones={supervisionesAdmin}
                  objetivos={objetivos}
                  guardias={guardias}
                  checklistItems={checklistItems}
                  turnos={turnos}
                  zonasOperativas={zonasOperativas}
                  supervisorZonas={supervisorZonas}
                  novedades={novedades}
                  supervisionesMesOperativas={supervisionesMesAdmin}
                  ultimasSupervisionesObjetivos={ultimasSupervisionesObjetivosAdmin}
                  filtroInicial={filtros.supervisiones}
                />
              )}
              {page === 'novedades' && <Novedades novedades={novedades} setNovedades={setNovedades} guardias={guardias} objetivos={objetivos} filtroActivo={filtros.novedades} limpiarFiltro={() => limpiarFiltro('novedades')} />}
              {page === 'reportes' && <Reportes registros={registros} setRegistros={setRegistros} turnos={turnos} setTurnos={setTurnos} guardias={guardias} objetivos={objetivos} novedades={novedades} filtroActivo={filtros.reportes} limpiarFiltro={() => limpiarFiltro('reportes')} user={user} />}
              {page === 'checklists' && <ChecklistsAdmin plantillas={checklistPlantillas} setPlantillas={setChecklistPlantillas} items={checklistItems} setItems={setChecklistItems} />}
              {page === 'turnos_base' && <TurnosBase />}
              {page === 'observacion' && <ObservacionSistema onNavigate={navegarConFiltro} />}
              {page === 'referencias_ia' && <ReferenciasIAPanel user={user} />}
              {page === 'revision_fotos_ia' && <AnalisisIAPanel user={user} objetivos={objetivos} guardias={guardias} />}
            </>
          )
        )}
      </main>
    </div>
    </>
  )
}
