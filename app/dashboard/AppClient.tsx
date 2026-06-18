'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase, formatHoras, calcAlertaEntrada, calcAlertaSalida, calcHorasTrabajadas, calcHorasLiquidables } from '@/lib/supabase'
import type { Usuario, Objetivo, Turno, RegistroAsistencia, Novedad } from '@/lib/supabase'
import { FILTROS_FECHA_TURNOS, MENSAJE_TURNO_SUPERPUESTO, fechasVecinasTurno, fechaActualTurno, filtroFechaTurnosIncluye, filtroFechaTurnosParaFecha, rangoFiltroFechaTurnos, tieneTurnoSuperpuesto, turnoSinCoberturaOperativa } from '@/lib/turnos'
import type { FiltroFechaTurnos } from '@/lib/turnos'
import SupervisorMobile from '@/components/supervisor/SupervisorMobile'
import GuardiaMobile from '@/components/guardia/GuardiaMobile'

type TipoAlertaOperativaAdmin = 'sin_fichar' | 'tardanza' | 'fuera_radio' | 'descubierto' | 'salida_pendiente'
type AccionIntervencionAdmin = 'comentario' | 'reasignacion' | 'marcado_descubierto' | 'confirmar_cubierto' | 'marcado_cubierto_manual' | 'alerta_revisada'

const ZONA_OPERATIVA_ADMIN = 'Rosario / General'
const JEFE_OPERATIVO_ADMIN = 'Aldo Monzón'
const DIRECTOR_TECNICO_ADMIN = 'Rodolfo Romero'

const S: Record<string, React.CSSProperties> = {
  app: { display:'flex', minHeight:'100vh', background:'#0a0e1a' },
  sidebar: { width:240, background:'#111827', borderRight:'1px solid #1e2d42', display:'flex', flexDirection:'column', position:'fixed', top:0, left:0, height:'100vh', zIndex:100 },
  sidebarLogo: { padding:'24px 20px', borderBottom:'1px solid #1e2d42' },
  brand: { fontFamily:'Syne,sans-serif', fontSize:15, fontWeight:800, color:'#f59e0b', letterSpacing:0.5 },
  sub: { fontSize:10, color:'#64748b', marginTop:2, letterSpacing:1, textTransform:'uppercase' as const },
  navSection: { padding:'8px 20px 4px', fontSize:10, color:'#64748b', letterSpacing:1.5, textTransform:'uppercase' as const, fontWeight:600 },
  main: { marginLeft:240, flex:1, padding:32, minHeight:'100vh' },
  card: { background:'#111827', border:'1px solid #1e2d42', borderRadius:12, padding:20, marginBottom:20 },
  title: { fontFamily:'Syne,sans-serif', fontSize:28, fontWeight:800, marginBottom:4 },
  sub2: { color:'#64748b', fontSize:14, marginBottom:24 },
  btn: { display:'inline-flex', alignItems:'center', gap:6, padding:'9px 18px', borderRadius:8, fontSize:13, fontWeight:500, cursor:'pointer', border:'none', fontFamily:'DM Sans,sans-serif' },
  btnPrimary: { background:'#f59e0b', color:'#000' },
  btnSecondary: { background:'#1a2235', color:'#e2e8f0', border:'1px solid #1e2d42' },
  input: { width:'100%', background:'#1a2235', border:'1px solid #1e2d42', borderRadius:8, padding:'10px 14px', color:'#e2e8f0', fontSize:14, fontFamily:'DM Sans,sans-serif', outline:'none' },
  select: { width:'100%', background:'#1a2235', border:'1px solid #1e2d42', borderRadius:8, padding:'10px 14px', color:'#e2e8f0', fontSize:14, fontFamily:'DM Sans,sans-serif', outline:'none' },
  label: { display:'block', fontSize:12, color:'#64748b', marginBottom:6, fontWeight:500, textTransform:'uppercase' as const, letterSpacing:0.5 },
  table: { width:'100%', borderCollapse:'collapse' as const, fontSize:13 },
  th: { textAlign:'left' as const, padding:'10px 14px', color:'#64748b', fontSize:11, letterSpacing:1, textTransform:'uppercase' as const, fontWeight:600, borderBottom:'1px solid #1e2d42' },
  td: { padding:'12px 14px', borderBottom:'1px solid #1e2d42' },
  modalOverlay: { position:'fixed' as const, inset:0, background:'rgba(0,0,0,0.7)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:20 },
  modal: { background:'#111827', border:'1px solid #1e2d42', borderRadius:16, width:'100%', maxWidth:520, maxHeight:'90vh', overflowY:'auto' as const },
  modalHeader: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px 24px', borderBottom:'1px solid #1e2d42' },
  modalTitle: { fontFamily:'Syne,sans-serif', fontSize:18, fontWeight:700 },
  grid2: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 },
  statGrid: { display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:16, marginBottom:28 },
}

const ZONA_SUPERVISORES_GUARDIA = 'Rosario / General'
const JEFE_OPERATIVO_GUARDIA = 'Aldo Monzón'
const DIRECTOR_TECNICO_GUARDIA = 'Rodolfo Romero'

function Badge({ type, children }: { type: string, children: React.ReactNode }) {
  const colors: Record<string, string> = {
    activo:'rgba(16,185,129,.15)|#10b981', cubierto:'rgba(16,185,129,.15)|#10b981', resuelta:'rgba(16,185,129,.15)|#10b981',
    ok:'rgba(16,185,129,.15)|#10b981', inactivo:'rgba(100,116,139,.15)|#94a3b8', descubierto:'rgba(239,68,68,.15)|#ef4444',
    pendiente:'rgba(245,158,11,.15)|#f59e0b', tarde:'rgba(239,68,68,.15)|#ef4444', anticipada:'rgba(245,158,11,.15)|#f59e0b',
    posterior:'rgba(59,130,246,.15)|#60a5fa', revisada:'rgba(59,130,246,.15)|#60a5fa', urgente:'rgba(239,68,68,.15)|#ef4444',
    importante:'rgba(245,158,11,.15)|#f59e0b', normal:'rgba(59,130,246,.15)|#60a5fa', programado:'rgba(100,116,139,.15)|#94a3b8',
    advertencia:'rgba(245,158,11,.15)|#f59e0b', alerta:'rgba(239,68,68,.15)|#ef4444',
  }
  const [bg, color] = (colors[type] || 'rgba(100,116,139,.15)|#94a3b8').split('|')
  return <span style={{ display:'inline-flex', alignItems:'center', padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:600, background:bg, color }}>{children}</span>
}

function StatCard({ label, value, sub, color, icon, onClick }: any) {
  return (
    <div
      onClick={onClick}
      style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:12, padding:20, position:'relative', overflow:'hidden', cursor:onClick?'pointer':'default' }}
      title={onClick ? 'Aplicar filtro' : undefined}
    >
      <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:color }} />
      <div style={{ position:'absolute', top:16, right:16, fontSize:28, opacity:0.15 }}>{icon}</div>
      <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:1, fontWeight:600 }}>{label}</div>
      <div style={{ fontFamily:'Syne,sans-serif', fontSize:36, fontWeight:800, margin:'8px 0 4px' }}>{value}</div>
      <div style={{ fontSize:12, color:'#64748b' }}>{sub}</div>
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

function fechaEntradaRealTurno(turno: Turno, horaEntrada?: string | null): Date | null {
  if (!horaEntrada) return null

  const inicioTurno = fechaHoraTurnoLocal(turno.fecha, turno.hora_inicio)
  const finTurno = fechaHoraTurnoLocal(turno.fecha, turno.hora_fin)
  const entradaReal = fechaHoraTurnoLocal(turno.fecha, horaEntrada)
  if (!inicioTurno || !finTurno || !entradaReal) return null

  if (finTurno <= inicioTurno && entradaReal < inicioTurno) {
    entradaReal.setDate(entradaReal.getDate() + 1)
  }

  return entradaReal
}

function minutosDesdeInicioTurno(turno: Turno, ahora = new Date()): number {
  const inicioTurno = fechaHoraTurnoLocal(turno.fecha, turno.hora_inicio)
  if (!inicioTurno) return 0

  return Math.max(0, Math.floor((ahora.getTime() - inicioTurno.getTime()) / 60000))
}

function minutosTardeAsistencia(turno: Turno, registro?: RegistroAsistencia | null): number {
  const inicioTurno = fechaHoraTurnoLocal(turno.fecha, turno.hora_inicio)
  const entradaReal = fechaEntradaRealTurno(turno, registro?.hora_entrada_real)
  if (!inicioTurno || !entradaReal) return 0

  return Math.max(0, Math.floor((entradaReal.getTime() - inicioTurno.getTime()) / 60000))
}

function numeroGps(value: unknown): number | null {
  const numero = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(numero) ? numero : null
}

function gpsRegistroAsistencia(registro: RegistroAsistencia | any, tipo: 'ingreso' | 'egreso') {
  const lat = tipo === 'ingreso'
    ? numeroGps(registro?.latitud_ingreso ?? registro?.lat_entrada)
    : numeroGps(registro?.latitud_egreso ?? registro?.lat_salida)
  const lng = tipo === 'ingreso'
    ? numeroGps(registro?.longitud_ingreso ?? registro?.lng_entrada)
    : numeroGps(registro?.longitud_egreso ?? registro?.lng_salida)
  const precision = tipo === 'ingreso'
    ? numeroGps(registro?.precision_ingreso)
    : numeroGps(registro?.precision_egreso)

  return lat !== null && lng !== null ? { lat, lng, precision } : null
}

function metrosGpsTexto(valor?: unknown): string {
  const metros = numeroGps(valor)
  return metros !== null ? `${Math.round(metros).toLocaleString('es-AR')} m` : '—'
}

function estadoGpsRegistro(registro: RegistroAsistencia | any, tipo: 'ingreso' | 'egreso'): string | null | undefined {
  return tipo === 'ingreso' ? registro?.gps_ingreso_estado : registro?.gps_egreso_estado
}

function distanciaGpsRegistro(registro: RegistroAsistencia | any, tipo: 'ingreso' | 'egreso'): number | null {
  return numeroGps(tipo === 'ingreso' ? registro?.distancia_ingreso_metros : registro?.distancia_egreso_metros)
}

function coordenadasGpsTexto(registro: RegistroAsistencia | any, tipo: 'ingreso' | 'egreso'): string {
  const gps = gpsRegistroAsistencia(registro, tipo)
  if (!gps) return '—'
  return `${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)}`
}

function estadoGpsTexto(registro: RegistroAsistencia | any, tipo: 'ingreso' | 'egreso'): string {
  const estado = estadoGpsRegistro(registro, tipo)
  if (estado === 'dentro_radio') return 'Dentro del radio'
  if (estado === 'fuera_radio') return 'Fuera del radio'
  if (estado === 'objetivo_sin_gps') return 'Objetivo sin GPS'
  if (estado === 'gps_no_disponible') return 'GPS no disponible'
  return gpsRegistroAsistencia(registro, tipo) ? 'GPS registrado' : 'Sin GPS'
}

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

function esRolGuardia(rol?: string | null): boolean {
  return rol === 'guardia' || rol === 'vigilador'
}

function fechaRegistroAsistencia(registro: RegistroAsistencia | any, turno?: Turno | any): string {
  return turno?.fecha || registro.created_at?.slice(0, 10) || ''
}

function ordenRegistroAsistencia(registro: RegistroAsistencia | any, turno?: Turno | any): number {
  const fecha = fechaRegistroAsistencia(registro, turno)
  const hora = registro.hora_entrada_real || '00:00:00'
  const timestamp = fecha ? new Date(`${fecha}T${hora}`).getTime() : new Date(registro.created_at || 0).getTime()

  return Number.isNaN(timestamp) ? 0 : timestamp
}

function NavItem({ id, icon, label, active, badge, onClick }: any) {
  return (
    <div onClick={() => onClick(id)} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 20px', cursor:'pointer', color:active?'#f59e0b':'#64748b', fontSize:14, transition:'all 0.15s', background:active?'rgba(245,158,11,0.08)':'transparent', borderLeft:`3px solid ${active?'#f59e0b':'transparent'}` }}>
      <span style={{ fontSize:16, width:20, textAlign:'center' }}>{icon}</span>
      {label}
      {badge > 0 && <span style={{ marginLeft:'auto', background:'#ef4444', color:'#fff', fontSize:10, fontWeight:700, borderRadius:10, padding:'1px 7px' }}>{badge}</span>}
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
      setError(err.message)
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
      setError(error.message)
    } else {
      setResetMsg('Si el email existe, se enviará un enlace de recuperación.')
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
      setError(error.message)
    } else {
      setResetMsg('Si el email existe, se enviará un enlace de ingreso.')
    }

    setMagicLoading(false)
  }

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0a0e1a' }}>
      <div style={{ width:'100%', maxWidth:400 }}>
        <div style={{ textAlign:'center', marginBottom:40 }}>
          <div style={{ fontSize:48 }}>🛡️</div>
          <div style={{ fontFamily:'Syne,sans-serif', fontSize:24, fontWeight:800, color:'#f59e0b', marginTop:12 }}>MERCOSUR SEGURIDAD</div>
          <div style={{ color:'#64748b', fontSize:13, marginTop:4 }}>Sistema de Control Operativo</div>
        </div>
        <div style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:16, padding:32 }}>
          <div style={{ fontFamily:'Syne,sans-serif', fontSize:20, fontWeight:700, marginBottom:24 }}>Iniciar sesión</div>
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
          {error && <div style={{ color:'#ef4444', fontSize:13, marginBottom:12 }}>{error}</div>}
          {resetMsg && <div style={{ color:'#10b981', fontSize:13, marginBottom:12 }}>{resetMsg}</div>}
          <button
            style={{ ...S.btn, ...S.btnPrimary, width:'100%', justifyContent:'center' }}
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
  const hoy = new Date().toLocaleDateString('sv-SE')
  const mesActual = hoy.slice(0, 7)
  const usuarios = guardias as Usuario[]
  const objetivosActivos = objetivos.filter((o: Objetivo) => o.estado === 'activo')
  const guardiasActivos = usuarios.filter((g: Usuario) => esRolGuardia(g.rol) && g.estado === 'activo')
  const turnosHoy = turnos.filter((t: Turno) => t.fecha === hoy)
  const turnoPorId = new Map<string, Turno>(turnos.map((t: Turno) => [t.id, t]))
  const registrosHoy = registros.filter((r: RegistroAsistencia) => turnoPorId.get(r.turno_id)?.fecha === hoy)
  const registrosMes = registros.filter((r: RegistroAsistencia) => turnoPorId.get(r.turno_id)?.fecha?.slice(0, 7) === mesActual)
  const existeAsistencia = (turno: Turno) =>
    registrosHoy.some((r: RegistroAsistencia) => r.turno_id === turno.id)
  const tieneEntrada = (turno: Turno) =>
    registrosHoy.some((r: RegistroAsistencia) => r.turno_id === turno.id && r.hora_entrada_real)
  const tieneSalida = (turno: Turno) =>
    registrosHoy.some((r: RegistroAsistencia) => r.turno_id === turno.id && r.hora_salida_real)
  const registroActivo = registrosHoy.filter((r: RegistroAsistencia) => r.hora_entrada_real && !r.hora_salida_real)
  const guardiasEnTurno = new Set(registroActivo.map((r: RegistroAsistencia) => r.guardia_id)).size
  const turnosCubiertos = turnosHoy.filter((t: Turno) => t.estado === 'cubierto').length
  const turnosDescubiertos = turnosHoy.filter((t: Turno) => turnoSinCoberturaOperativa(t, existeAsistencia(t)))
  const turnosSinFichar = turnosHoy.filter((t: Turno) =>
    t.guardia_id &&
    t.estado !== 'descubierto' &&
    !tieneEntrada(t) &&
    minutosDesdeInicioTurno(t) >= 15
  )
  const tardanzasRegistradas = registrosHoy.filter((r: RegistroAsistencia) => {
    const turno = turnoPorId.get(r.turno_id)
    if (!turno || !r.hora_entrada_real) return false

    return r.alerta_entrada === 'tarde' || minutosTardeAsistencia(turno, r) > 0
  })
  const fichajesFueraRadio = registrosHoy.filter((r: RegistroAsistencia) => r.gps_ingreso_estado === 'fuera_radio')
  const turnosAsistenciaPendiente = turnosHoy.filter((t: Turno) => {
    if (t.estado === 'descubierto' || !t.guardia_id) return false
    return !tieneEntrada(t) || (tieneEntrada(t) && !tieneSalida(t))
  })
  const llegadasTarde = tardanzasRegistradas.length
  const horasHoy = registrosHoy.reduce((sum: number, r: RegistroAsistencia) => sum + Math.max(0, Number(r.horas_trabajadas) || 0), 0)
  const horasMes = registrosMes.reduce((sum: number, r: RegistroAsistencia) => sum + Math.max(0, Number(r.horas_trabajadas) || 0), 0)
  const guardiasConAsistenciaMes = new Set(registrosMes.filter((r: RegistroAsistencia) => r.hora_entrada_real).map((r: RegistroAsistencia) => r.guardia_id)).size
  const turnosFinalizadosHoy = registrosHoy.filter((r: RegistroAsistencia) => r.hora_entrada_real && r.hora_salida_real).length
  const turnosEnCursoHoy = registrosHoy.filter((r: RegistroAsistencia) => r.hora_entrada_real && !r.hora_salida_real).length
  const novedadesUrgentes = novedades.filter((n: Novedad) => n.prioridad === 'urgente' && n.estado !== 'resuelta')

  const getGuardia = (id?: string | null) => usuarios.find((g: Usuario) => g.id === id)
  const getObjetivo = (id: string) => objetivos.find((o: Objetivo) => o.id === id)
  const hora = (value?: string) => value ? value.slice(0, 5) : '--:--'
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

  const metricas = [
    { label: 'Objetivos activos', value: objetivosActivos.length, sub: `${objetivos.length} objetivos cargados`, color: '#3b82f6', page:'objetivos', filtro:{ tipo:'activos', label:'Objetivos activos' } },
    { label: 'Guardias activos', value: guardiasActivos.length, sub: `${usuarios.filter((g: Usuario) => esRolGuardia(g.rol)).length} guardias cargados`, color: '#10b981', page:'guardias', filtro:{ tipo:'activos', label:'Guardias activos' } },
    { label: 'Turnos de hoy', value: turnosHoy.length, sub: hoy, color: '#f59e0b', page:'turnos', filtro:{ tipo:'hoy', label:'Turnos de hoy' } },
    { label: 'Turnos cubiertos', value: turnosCubiertos, sub: 'estado cubierto', color: '#10b981', page:'turnos', filtro:{ tipo:'cubiertos', label:'Turnos cubiertos hoy' } },
    { label: 'Turnos descubiertos', value: turnosDescubiertos.length, sub: 'sin cobertura operativa', color: '#ef4444', page:'turnos', filtro:{ tipo:'descubiertos', label:'Turnos descubiertos hoy' } },
    { label: 'Guardias en turno', value: guardiasEnTurno, sub: 'con entrada sin salida', color: '#22c55e', page:'asistencia', filtro:{ tipo:'en_turno', label:'Guardias en turno' } },
    { label: 'Horas trabajadas hoy', value: formatoHoras(horasHoy), sub: 'registros del día', color: '#38bdf8', page:'asistencia', filtro:{ tipo:'hoy', label:'Horas trabajadas hoy' } },
    { label: 'Horas trabajadas mes', value: formatoHoras(horasMes), sub: mesActual, color: '#8b5cf6', page:'reportes', filtro:{ tipo:'mes', mes:mesActual, label:`Horas trabajadas ${mesActual}` } },
    { label: 'Llegadas tarde', value: llegadasTarde, sub: 'tardanzas registradas hoy', color: '#f97316', page:'asistencia', filtro:{ tipo:'tarde', label:'Llegadas tarde hoy' } },
    { label: 'Turnos sin fichar', value: turnosSinFichar.length, sub: 'sin entrada +15 min', color: '#ef4444', page:'turnos', filtro:{ tipo:'sin_fichar', label:'Turnos sin fichar hoy' } },
  ]

  const alertBox: React.CSSProperties = {
    background:'#111827',
    border:'1px solid #1e2d42',
    borderRadius:12,
    padding:16,
  }

  const alertTitle: React.CSSProperties = {
    fontFamily:'Syne,sans-serif',
    fontSize:15,
    fontWeight:800,
    marginBottom:12,
  }

  const alertItem: React.CSSProperties = {
    padding:'12px 0',
    borderTop:'1px solid #1e2d42',
    fontSize:13,
    color:'#cbd5e1',
  }

  const emptyAlert: React.CSSProperties = {
    padding:'12px 0',
    borderTop:'1px solid #1e2d42',
    fontSize:13,
    color:'#64748b',
  }

  const renderTurnoAlert = (turno: Turno, detalle: string, filtro: any) => (
    <div key={turno.id} style={{ ...alertItem, cursor:'pointer' }} onClick={() => onNavigate?.('turnos', filtro)}>
      <strong style={{ color:'#f8fafc' }}>{nombreObjetivo(turno.objetivo_id)}</strong>
      <div style={{ color:'#94a3b8', marginTop:4 }}>
        Horario: {hora(turno.hora_inicio)} a {hora(turno.hora_fin)}
      </div>
      <div style={{ color:'#94a3b8', marginTop:4 }}>
        Estado: {turno.estado || 'programado'}
      </div>
      <div style={{ color:'#94a3b8', marginTop:4 }}>
        Guardia esperado: {nombreGuardiaEsperado(turno)}
      </div>
      <div style={{ color:'#f59e0b', marginTop:4 }}>{detalle}</div>
    </div>
  )

  const renderSinIngresoAlert = (turno: Turno) => (
    <div key={turno.id} style={{ ...alertItem, cursor:'pointer' }} onClick={() => onNavigate?.('turnos', { tipo:'sin_fichar', label:'Turnos sin fichar hoy' })}>
      <strong style={{ color:'#f8fafc' }}>{nombreGuardia(turno.guardia_id)}</strong>
      <div style={{ color:'#94a3b8', marginTop:4 }}>Objetivo: {nombreObjetivo(turno.objetivo_id)}</div>
      <div style={{ color:'#94a3b8', marginTop:4 }}>Horario programado: {hora(turno.hora_inicio)} a {hora(turno.hora_fin)}</div>
      <div style={{ color:'#f59e0b', marginTop:4 }}>Minutos de demora: {minutosDesdeInicioTurno(turno)}</div>
      <div style={{ color:'#f59e0b', marginTop:4 }}>Estado: Sin ingreso</div>
    </div>
  )

  const renderTardanzaAlert = (registro: RegistroAsistencia) => {
    const turno = turnoPorId.get(registro.turno_id)
    if (!turno) return null

    return (
      <div key={registro.id} style={{ ...alertItem, cursor:'pointer' }} onClick={() => onNavigate?.('asistencia', { tipo:'tarde', label:'Llegadas tarde hoy' })}>
        <strong style={{ color:'#f8fafc' }}>{nombreGuardia(registro.guardia_id || turno.guardia_id)}</strong>
        <div style={{ color:'#94a3b8', marginTop:4 }}>Objetivo: {nombreObjetivo(turno.objetivo_id)}</div>
        <div style={{ color:'#94a3b8', marginTop:4 }}>Horario programado: {hora(turno.hora_inicio)} a {hora(turno.hora_fin)}</div>
        <div style={{ color:'#94a3b8', marginTop:4 }}>Entrada real: {hora(registro.hora_entrada_real)}</div>
        <div style={{ color:'#f59e0b', marginTop:4 }}>Minutos tarde: {minutosTardeAsistencia(turno, registro)}</div>
        <div style={{ color:'#ef4444', marginTop:4 }}>Estado: Tarde</div>
      </div>
    )
  }

  const renderFichajeFueraRadioAlert = (registro: RegistroAsistencia) => {
    const turno = turnoPorId.get(registro.turno_id)
    if (!turno) return null

    const objetivo = getObjetivo(turno.objetivo_id)
    const gps = gpsRegistroAsistencia(registro, 'ingreso')

    return (
      <div key={registro.id} style={{ ...alertItem, cursor:'pointer' }} onClick={() => onNavigate?.('asistencia', { tipo:'gps_fuera_radio', label:'Fichajes fuera de radio' })}>
        <strong style={{ color:'#f8fafc' }}>{nombreGuardia(registro.guardia_id || turno.guardia_id)}</strong>
        <div style={{ color:'#94a3b8', marginTop:4 }}>Objetivo: {objetivo?.nombre || 'Objetivo sin nombre'}</div>
        <div style={{ color:'#94a3b8', marginTop:4 }}>Hora ingreso: {hora(registro.hora_entrada_real)}</div>
        <div style={{ color:'#ef4444', marginTop:4 }}>Distancia: {metrosGpsTexto(registro.distancia_ingreso_metros)}</div>
        <div style={{ color:'#94a3b8', marginTop:4 }}>Radio permitido: {metrosGpsTexto(objetivo?.radio_metros)}</div>
        <div style={{ color:'#94a3b8', marginTop:4 }}>Precisión GPS: {metrosGpsTexto(gps?.precision)}</div>
        <div style={{ color:'#ef4444', marginTop:4 }}>Estado: Fuera del radio</div>
      </div>
    )
  }

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
          <div key={n.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', borderRadius:10, background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)', color:'#fca5a5', marginBottom:12, fontSize:13 }}>
            🚨 <strong>NOVEDAD URGENTE</strong> — {o?.nombre}: {n.descripcion} ({g?.nombre} {g?.apellido})
          </div>
        )
      })}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:12, marginBottom:24 }}>
        {metricas.map((m) => (
          <StatCard key={m.label} label={m.label} value={m.value} sub={m.sub} color={m.color} onClick={() => onNavigate?.(m.page, m.filtro)} />
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:12, marginBottom:24 }}>
        <div style={S.card}><div style={S.label}>Mes actual</div><strong>{mesActual}</strong></div>
        <div style={S.card}><div style={S.label}>Total horas reales</div><strong>{formatoHoras(horasMes)}</strong></div>
        <div style={S.card}><div style={S.label}>Guardias con asistencia</div><strong>{guardiasConAsistenciaMes}</strong></div>
        <div style={S.card}><div style={S.label}>Turnos finalizados hoy</div><strong>{turnosFinalizadosHoy}</strong></div>
        <div style={S.card}><div style={S.label}>Turnos en curso hoy</div><strong>{turnosEnCursoHoy}</strong></div>
        <div style={S.card}><div style={S.label}>Turnos sin fichar hoy</div><strong>{turnosSinFichar.length}</strong></div>
        <div style={S.card}><div style={S.label}>Tardanzas registradas hoy</div><strong>{tardanzasRegistradas.length}</strong></div>
        <div style={S.card}><div style={S.label}>Fichajes fuera de radio</div><strong>{fichajesFueraRadio.length}</strong></div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))', gap:16 }}>
        <div style={alertBox}>
          <div style={alertTitle}>Turnos descubiertos</div>
          {turnosDescubiertos.length === 0 ? (
            <div style={emptyAlert}>No hay turnos descubiertos hoy.</div>
          ) : turnosDescubiertos.map((turno: Turno) =>
            renderTurnoAlert(turno, detalleTurnoDescubierto(turno), { tipo:'descubiertos', label:'Turnos descubiertos hoy' })
          )}
        </div>

        <div style={alertBox}>
          <div style={alertTitle}>Guardias sin fichar</div>
          {turnosSinFichar.length === 0 ? (
            <div style={emptyAlert}>No hay guardias demorados sin ingreso.</div>
          ) : turnosSinFichar.map((turno: Turno) =>
            renderSinIngresoAlert(turno)
          )}
        </div>

        <div style={alertBox}>
          <div style={alertTitle}>Tardanzas registradas</div>
          {tardanzasRegistradas.length === 0 ? (
            <div style={emptyAlert}>No hay ingresos tarde registrados hoy.</div>
          ) : tardanzasRegistradas.map((registro: RegistroAsistencia) =>
            renderTardanzaAlert(registro)
          )}
        </div>

        <div style={alertBox}>
          <div style={alertTitle}>Fichajes fuera de radio</div>
          {fichajesFueraRadio.length === 0 ? (
            <div style={emptyAlert}>No hay ingresos fuera del radio del objetivo.</div>
          ) : fichajesFueraRadio.map((registro: RegistroAsistencia) =>
            renderFichajeFueraRadioAlert(registro)
          )}
        </div>

        <div style={alertBox}>
          <div style={alertTitle}>Turnos con asistencia pendiente</div>
          {turnosAsistenciaPendiente.length === 0 ? (
            <div style={emptyAlert}>No hay asistencias pendientes hoy.</div>
          ) : turnosAsistenciaPendiente.map((turno: Turno) =>
            renderTurnoAlert(turno, tieneEntrada(turno) ? 'Entrada registrada, salida pendiente' : 'Entrada pendiente', { tipo:'pendientes_asistencia', label:'Turnos con asistencia pendiente' })
          )}
        </div>
      </div>
    </div>
  )
}

function Guardias({ guardias, setGuardias, filtroActivo, limpiarFiltro }: any) {
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

  const guardiasFiltrados = filtroActivo?.tipo === 'activos'
    ? guardias.filter((g: Usuario) => g.estado === 'activo')
    : guardias

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

function Objetivos({ objetivos, setObjetivos, turnos, filtroActivo, limpiarFiltro }: any) {
  const [modal, setModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [filtroKpi, setFiltroKpi] = useState('')

  const formVacio = {
    nombre: '',
    cliente: '',
    direccion: '',
    estado: 'activo',
    radio_metros: 200,
  }
  const [form, setForm] = useState(formVacio)

  const hoy = new Date().toISOString().split('T')[0]

  const turnosHoyPorObjetivo = (objetivoId: string) => {
    return turnos.filter((t: any) => t.objetivo_id === objetivoId && t.fecha === hoy)
  }

  const estadoOperativo = (objetivoId: string) => {
    const ts = turnosHoyPorObjetivo(objetivoId)
    if (ts.length === 0) return null
    const sinCubrir = ts.filter((t: any) => t.estado === 'descubierto' || !t.guardia_id).length
    const cubiertos = ts.filter((t: any) => t.estado === 'cubierto').length
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
    })
    setEditId(o.id)
    setModal(true)
  }

  const guardar = async () => {
    if (!form.nombre.trim()) return
    setLoading(true)

    const payload = {
      nombre: form.nombre.trim(),
      cliente: form.cliente.trim() || null,
      direccion: form.direccion.trim() || null,
      estado: form.estado,
      radio_metros: Number(form.radio_metros) || 200,
    }

    if (editId) {
      const { data } = await supabase
        .from('objetivos')
        .update(payload)
        .eq('id', editId)
        .select()
        .single()
      if (data) setObjetivos((prev: any[]) => prev.map(o => o.id === editId ? data : o))
    } else {
      const { data } = await supabase
        .from('objetivos')
        .insert(payload)
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

  const filtroTipo = filtroActivo?.tipo || filtroKpi
  const limpiarFiltroObjetivos = () => {
    setFiltroKpi('')
    limpiarFiltro?.()
  }

  const objetivosConTurnosHoy = objetivos.filter((o: any) => turnosHoyPorObjetivo(o.id).length > 0)
  const objetivosSinCubrirHoy = objetivos.filter((o: any) => {
    const ts = turnosHoyPorObjetivo(o.id)
    return ts.some((t: any) => t.estado === 'descubierto' || !t.guardia_id)
  })

  const filtrados = objetivos.filter((o: any) => {
    if (filtroTipo === 'activos' && o.estado !== 'activo') return false
    if (filtroTipo === 'con_turnos_hoy' && !objetivosConTurnosHoy.some((x: any) => x.id === o.id)) return false
    if (filtroTipo === 'sin_cubrir_hoy' && !objetivosSinCubrirHoy.some((x: any) => x.id === o.id)) return false
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
      <div style={{ marginBottom:16 }}>
        <input
          style={{ ...S.input, maxWidth:360 }}
          placeholder="🔍  Buscar por nombre, cliente o dirección..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
        />
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
                        <strong style={{ fontSize:14 }}>{o.nombre}</strong>
                        {o.radio_metros && (
                          <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>
                            📍 radio {o.radio_metros}m
                          </div>
                        )}
                        <div style={{ fontSize:11, color: objetivoTieneGps(o) ? '#10b981' : '#f59e0b', marginTop:2 }}>
                          {objetivoTieneGps(o) ? 'GPS completo' : 'Falta GPS'}
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
                            {o.estado === 'activo' ? '⏸' : '▶'}
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
        </Modal>
      )}
    </div>
  )
}
function Turnos({ turnos, setTurnos, guardias, objetivos, registros, filtroActivo, limpiarFiltro }: any) {
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({
    guardia_id: '',
    objetivo_id: '',
    fecha: fechaActualTurno(),
    hora_inicio: '06:00',
    hora_fin: '14:00',
  })
  const [filtroFecha, setFiltroFecha] = useState<FiltroFechaTurnos>('hoy')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')

  const guardiaTieneTurnoSuperpuesto = async (candidato: Pick<Turno, 'guardia_id' | 'fecha' | 'hora_inicio' | 'hora_fin'>): Promise<boolean | null> => {
    if (!candidato.guardia_id) return false

    const { data, error: turnosError } = await supabase
      .from('turnos')
      .select('id, guardia_id, fecha, hora_inicio, hora_fin')
      .eq('guardia_id', candidato.guardia_id)
      .in('fecha', fechasVecinasTurno(candidato.fecha))

    if (turnosError) {
      setError(turnosError.message)
      return null
    }

    return tieneTurnoSuperpuesto(data || [], candidato)
  }

  const guardar = async () => {
    if (!form.objetivo_id || !form.fecha || !form.hora_inicio || !form.hora_fin) return

    setError('')
    setMensaje('')

    const payload = {
      ...form,
      guardia_id: form.guardia_id || null,
      estado: form.guardia_id ? 'cubierto' : 'descubierto',
      tipo_evento: 'normal',
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
      setModal(false)
      setForm({
        guardia_id: '',
        objetivo_id: '',
        fecha: fechaActualTurno(),
        hora_inicio: '06:00',
        hora_fin: '14:00',
      })
    } else if (error) {
      setError(error.message)
    }

    setLoading(false)
  }

  const hoy = fechaActualTurno()
  const rangoFecha = filtroActivo ? { desde: hoy, hasta: hoy, label: filtroActivo.label } : rangoFiltroFechaTurnos(filtroFecha, hoy)
  const existeAsistencia = (turno: Turno) => registros.some((r: RegistroAsistencia) => r.turno_id === turno.id)
  const tieneEntrada = (turno: Turno) => registros.some((r: RegistroAsistencia) => r.turno_id === turno.id && r.hora_entrada_real)
  const tieneSalida = (turno: Turno) => registros.some((r: RegistroAsistencia) => r.turno_id === turno.id && r.hora_salida_real)
  const filtrados = turnos.filter((t: Turno) => {
    if (t.fecha < rangoFecha.desde || t.fecha > rangoFecha.hasta) return false
    if (filtroActivo?.tipo === 'cubiertos' && t.estado !== 'cubierto') return false
    if (filtroActivo?.tipo === 'descubiertos' && !turnoSinCoberturaOperativa(t, existeAsistencia(t))) return false
    if (filtroActivo?.tipo === 'sin_fichar' && (!t.guardia_id || tieneEntrada(t))) return false
    if (filtroActivo?.tipo === 'pendientes_asistencia' && (!t.guardia_id || (tieneEntrada(t) && tieneSalida(t)))) return false
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
          </div>
        </Modal>
      )}
    </div>
  )
}
function Asistencia({ registros, setRegistros, turnos, guardias, objetivos, filtroActivo, limpiarFiltro }: any) {
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ turno_id:'', hora_entrada_real:'', hora_salida_real:'', observacion:'' })
  const [loading, setLoading] = useState(false)
  const hoy = new Date().toLocaleDateString('sv-SE')
  const registrosFiltrados = registros.filter((r: RegistroAsistencia) => {
    const turno = turnos.find((t: Turno) => t.id === r.turno_id)
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

  const registrar = async () => {
    const turno = turnos.find((t: Turno) => t.id === form.turno_id)
    if (!turno || !form.hora_entrada_real) return
    setLoading(true)
    const alertaE = calcAlertaEntrada(turno.hora_inicio, form.hora_entrada_real)
    const alertaS = form.hora_salida_real ? calcAlertaSalida(turno.hora_fin, form.hora_salida_real) : null
    const horas = form.hora_salida_real ? calcHorasTrabajadas(form.hora_entrada_real, form.hora_salida_real) : 0
    const payload = { turno_id: turno.id, guardia_id: turno.guardia_id, hora_entrada_real: form.hora_entrada_real, hora_salida_real: form.hora_salida_real || null, horas_trabajadas: horas, alerta_entrada: alertaE, alerta_salida: alertaS, observacion: form.observacion }
    const { data } = await supabase.from('registros_asistencia').insert(payload).select().single()
    if (data) {
      setRegistros((prev: any[]) => [...prev, data])
      await supabase.from('turnos').update({ estado: 'cubierto' }).eq('id', turno.id)
    }
    setModal(false); setLoading(false)
  }

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', marginBottom:24 }}>
        <div style={{ flex:1 }}><div style={S.title}>Asistencia</div><div style={S.sub2}>Registro de entradas y salidas</div></div>
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setModal(true)}>+ Registrar</button>
      </div>
      {filtroActivo && (
        <div style={{ ...S.card, padding:12, display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ color:'#f59e0b' }}>Filtro activo: {filtroActivo.label}</span>
          <button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 10px', fontSize:12 }} onClick={limpiarFiltro}>Limpiar filtro</button>
        </div>
      )}
      <div style={{ ...S.card, overflowX:'auto' }}>
        <table style={S.table}>
          <thead><tr><th style={S.th}>Fecha</th><th style={S.th}>Guardia</th><th style={S.th}>Objetivo</th><th style={S.th}>Asignado</th><th style={S.th}>Entrada Real</th><th style={S.th}>Salida Real</th><th style={S.th}>Horas</th><th style={S.th}>GPS Ingreso</th><th style={S.th}>GPS Egreso</th><th style={S.th}>Precisión</th><th style={S.th}>Alertas</th></tr></thead>
          <tbody>
            {registrosOrdenados.map((r: RegistroAsistencia) => {
              const g = guardias.find((x: Usuario) => x.id === r.guardia_id)
              const t = turnos.find((x: Turno) => x.id === r.turno_id)
              const o = objetivos.find((x: Objetivo) => x.id === t?.objetivo_id)
              const gpsIngreso = gpsRegistroAsistencia(r, 'ingreso')
              const gpsEgreso = gpsRegistroAsistencia(r, 'egreso')
              const textoGpsIngreso = textoAuditoriaGps(r, 'ingreso')
              const textoGpsEgreso = textoAuditoriaGps(r, 'egreso')
              return (
                <tr key={r.id}>
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
                      {r.alerta_entrada && <Badge type={r.alerta_entrada}>{r.alerta_entrada === 'tarde' ? '⏰ Tarde' : '⬆ Anticipada'}</Badge>}
                      {r.alerta_salida && <Badge type={r.alerta_salida}>{r.alerta_salida === 'anticipada' ? '⬇ Salida ant.' : '⏱ Posterior'}</Badge>}
                      {r.gps_ingreso_estado === 'fuera_radio' && <Badge type="alerta">GPS fuera radio</Badge>}
                      {!r.alerta_entrada && !r.alerta_salida && r.gps_ingreso_estado !== 'fuera_radio' && <Badge type="cubierto">✓ Ok</Badge>}
                    </div>
                  </td>
                </tr>
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
    </div>
  )
}

function Novedades({ novedades, setNovedades, guardias, objetivos }: any) {
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ guardia_id:'', objetivo_id:'', tipo:'Rutina', descripcion:'', prioridad:'normal' })
  const [loading, setLoading] = useState(false)

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

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', marginBottom:24 }}>
        <div style={{ flex:1 }}><div style={S.title}>Novedades</div><div style={S.sub2}>{novedades.filter((n: Novedad) => n.estado === 'pendiente').length} pendientes</div></div>
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setModal(true)}>+ Nueva Novedad</button>
      </div>
      {novedades.map((n: Novedad) => {
        const g = guardias.find((x: Usuario) => x.id === n.guardia_id)
        const o = objetivos.find((x: Objetivo) => x.id === n.objetivo_id)
        return (
          <div key={n.id} style={{ background:'#1a2235', border:'1px solid #1e2d42', borderRadius:10, padding:16, marginBottom:12 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <Badge type={n.prioridad}>{n.prioridad.toUpperCase()}</Badge>
                <Badge type={n.estado}>{n.estado}</Badge>
                <strong style={{ fontSize:14 }}>{n.tipo}</strong>
              </div>
              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                {n.estado === 'pendiente' && <button style={{ ...S.btn, ...S.btnSecondary, padding:'5px 12px', fontSize:12 }} onClick={() => cambiarEstado(n.id, 'revisada')}>Revisada</button>}
                {n.estado === 'revisada' && <button style={{ ...S.btn, ...S.btnSecondary, padding:'5px 12px', fontSize:12 }} onClick={() => cambiarEstado(n.id, 'resuelta')}>Resuelta</button>}
                <span style={{ fontSize:11, color:'#64748b' }}>{new Date(n.created_at).toLocaleString('es-AR')}</span>
              </div>
            </div>
            <div style={{ fontSize:13, color:'#cbd5e1' }}>{n.descripcion}</div>
            <div style={{ fontSize:11, color:'#64748b', marginTop:8 }}>📍 {o?.nombre || '—'} · 👮 {g?.nombre} {g?.apellido}</div>
          </div>
        )
      })}
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

function Reportes({ registros, turnos, guardias, objetivos, novedades, filtroActivo, limpiarFiltro }: any) {
  const empleados = guardias.filter((g: Usuario) => g.rol !== 'admin')
  const [tab, setTab] = useState('planilla_empleado')
  const [mes, setMes] = useState(new Date().toLocaleDateString('sv-SE').slice(0, 7))
  const [verTodos, setVerTodos] = useState(false)
  const [empleadoId, setEmpleadoId] = useState('')
  const [objetivoId, setObjetivoId] = useState('')

  useEffect(() => {
    if (filtroActivo?.mes) setMes(filtroActivo.mes)
  }, [filtroActivo?.mes])

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
  const turnosMes = turnos
    .filter((t: Turno) => t.fecha >= desde && t.fecha < hasta)
    .sort((a: Turno, b: Turno) => `${a.fecha} ${a.hora_inicio}`.localeCompare(`${b.fecha} ${b.hora_inicio}`))
  const turnoPorId = new Map<string, Turno>(turnosMes.map((t: Turno) => [t.id, t]))
  const registrosMes = registros.filter((r: RegistroAsistencia) => Boolean(turnoPorId.get(r.turno_id)))
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
  const scoreRegistro = (r: RegistroAsistencia) =>
    (r.hora_entrada_real ? 10 : 0) + (r.hora_salida_real ? 5 : 0) + (Number(r.horas_trabajadas) || 0)
  const registroPrincipal = (turno: Turno, guardiaId?: string | null) => {
    const regs = (registrosPorTurno.get(turno.id) || []).filter((r: RegistroAsistencia) => !guardiaId || r.guardia_id === guardiaId)
    return [...regs].sort((a: RegistroAsistencia, b: RegistroAsistencia) =>
      scoreRegistro(b) - scoreRegistro(a) || (a.hora_entrada_real || '').localeCompare(b.hora_entrada_real || '')
    )[0]
  }
  const horasRealesRegistro = (registro?: RegistroAsistencia) =>
    registro?.hora_entrada_real && registro?.hora_salida_real ? Math.max(0, Number(registro.horas_trabajadas) || 0) : 0
  const horasLiquidablesRegistro = (turno: Turno, registro?: RegistroAsistencia) =>
    registro?.hora_entrada_real && registro?.hora_salida_real
      ? calcHorasLiquidables(turno.fecha, turno.hora_inicio, turno.hora_fin, registro.hora_entrada_real, registro.hora_salida_real)
      : 0
  const estadoPlanilla = (turno: Turno, registro?: RegistroAsistencia) => {
    if (turno.estado === 'descubierto' || !turno.guardia_id) return 'Descubierto'
    if (registro?.hora_entrada_real && (registro.alerta_entrada === 'tarde' || minutosTardeAsistencia(turno, registro) > 0)) return 'Tarde'
    if (registro?.hora_entrada_real && !registro.hora_salida_real) return 'En curso'
    if (registro?.hora_entrada_real && registro.hora_salida_real) return 'Cubierto'
    return pasoVentanaFichaje(turno) ? 'Sin fichar' : 'Programado'
  }
  const observacionesPlanilla = (turno: Turno, registro?: RegistroAsistencia, extra?: string | null) => {
    const obs: string[] = []
    if (turno.estado === 'descubierto' || !turno.guardia_id) obs.push('Descubierto')
    if (!registro?.hora_entrada_real && turno.guardia_id && pasoVentanaFichaje(turno)) obs.push('Sin fichar')
    if (registro?.hora_entrada_real && !registro.hora_salida_real) obs.push('En curso')
    if (registro?.alerta_entrada === 'tarde') obs.push('Llegada tarde')
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
    const tieneRegistro = (registrosPorTurno.get(t.id) || []).some((r: RegistroAsistencia) => r.guardia_id === empleadoSeleccionado.id)
    return t.guardia_id === empleadoSeleccionado.id || guardiaOriginal === empleadoSeleccionado.id || guardiaReal === empleadoSeleccionado.id || tieneRegistro
  }) : []

  const planillaEmpleado = turnosEmpleado.map((turno: Turno) => {
    const registro = empleadoSeleccionado ? registroPrincipal(turno, empleadoSeleccionado.id) : undefined
    const registroOtroGuardia = !registro ? registroPrincipal(turno) : undefined
    const objetivo = objetivos.find((o: Objetivo) => o.id === turno.objetivo_id)
    const horasReales = horasRealesRegistro(registro)
    const horasLiquidables = horasLiquidablesRegistro(turno, registro)
    const extra = registroOtroGuardia?.guardia_id && registroOtroGuardia.guardia_id !== empleadoSeleccionado?.id
      ? `Ficho otro guardia: ${nombreGuardia(registroOtroGuardia.guardia_id)}`
      : null
    const estado = estadoPlanilla(turno, registro)
    const tieneEntrada = Boolean(registro?.hora_entrada_real)

    return {
      Fecha: formatFecha(turno.fecha),
      Día: diaSemana(turno.fecha),
      Objetivo: objetivo?.nombre || '—',
      'Horario programado': formatHorarioAsignado(turno),
      'Entrada real': registro?.hora_entrada_real ? formatHoraTurno(registro.hora_entrada_real) : '—',
      'Salida real': registro?.hora_salida_real ? formatHoraTurno(registro.hora_salida_real) : '—',
      'Horas reales': mostrarHoras(horasReales),
      'Horas liquidables': mostrarHoras(horasLiquidables),
      Estado: estado,
      'Observaciones / alertas': observacionesPlanilla(turno, registro, extra),
      'GPS ingreso': coordenadasGpsTexto(registro, 'ingreso'),
      'Distancia ingreso': metrosGpsTexto(registro?.distancia_ingreso_metros),
      'Estado GPS ingreso': estadoGpsTexto(registro, 'ingreso'),
      _id: `${turno.id}-${registro?.id || 'sin-registro'}`,
      _fecha: turno.fecha,
      _horasReales: horasReales,
      _horasLiquidables: horasLiquidables,
      _tieneEntrada: tieneEntrada,
      _sinFichar: !tieneEntrada && Boolean(turno.guardia_id) && pasoVentanaFichaje(turno),
      _enCurso: Boolean(registro?.hora_entrada_real && !registro?.hora_salida_real),
      _tarde: tieneEntrada && (registro?.alerta_entrada === 'tarde' || minutosTardeAsistencia(turno, registro) > 0),
    }
  })

  const totalesEmpleado = {
    dias: new Set(planillaEmpleado.filter((row: any) => row._tieneEntrada).map((row: any) => row._fecha)).size,
    horasReales: planillaEmpleado.reduce((sum: number, row: any) => sum + row._horasReales, 0),
    horasLiquidables: planillaEmpleado.reduce((sum: number, row: any) => sum + row._horasLiquidables, 0),
    sinFichar: planillaEmpleado.filter((row: any) => row._sinFichar).length,
    enCurso: planillaEmpleado.filter((row: any) => row._enCurso).length,
    tardanzas: planillaEmpleado.filter((row: any) => row._tarde).length,
  }

  const turnosObjetivo = objetivoId ? turnosMes.filter((t: Turno) => t.objetivo_id === objetivoId) : []
  const planillaObjetivo = turnosObjetivo.map((turno: Turno) => {
    const registro = registroPrincipal(turno)
    const horasReales = horasRealesRegistro(registro)
    const horasLiquidables = horasLiquidablesRegistro(turno, registro)
    const estado = estadoPlanilla(turno, registro)
    const tieneEntrada = Boolean(registro?.hora_entrada_real)

    return {
      Fecha: formatFecha(turno.fecha),
      Día: diaSemana(turno.fecha),
      'Horario programado': formatHorarioAsignado(turno),
      'Guardia asignado': turno.guardia_id ? nombreGuardia(turno.guardia_id) : 'Sin asignar',
      'Guardia que fichó': registro?.guardia_id ? nombreGuardia(registro.guardia_id) : '—',
      'Entrada real': registro?.hora_entrada_real ? formatHoraTurno(registro.hora_entrada_real) : '—',
      'Salida real': registro?.hora_salida_real ? formatHoraTurno(registro.hora_salida_real) : '—',
      'Horas reales': mostrarHoras(horasReales),
      'Horas liquidables': mostrarHoras(horasLiquidables),
      Estado: estado,
      'Observaciones / alertas': observacionesPlanilla(turno, registro),
      'GPS ingreso': coordenadasGpsTexto(registro, 'ingreso'),
      'Distancia ingreso': metrosGpsTexto(registro?.distancia_ingreso_metros),
      'Estado GPS ingreso': estadoGpsTexto(registro, 'ingreso'),
      _id: `${turno.id}-${registro?.id || 'sin-registro'}`,
      _horasReales: horasReales,
      _horasLiquidables: horasLiquidables,
      _cubierto: Boolean(registro?.hora_entrada_real && registro?.hora_salida_real),
      _sinFichar: !tieneEntrada && Boolean(turno.guardia_id) && pasoVentanaFichaje(turno),
      _descubierto: turno.estado === 'descubierto' || !turno.guardia_id,
      _enCurso: Boolean(registro?.hora_entrada_real && !registro?.hora_salida_real),
    }
  })

  const totalesObjetivo = {
    total: planillaObjetivo.length,
    cubiertos: planillaObjetivo.filter((row: any) => row._cubierto).length,
    sinFichar: planillaObjetivo.filter((row: any) => row._sinFichar).length,
    descubiertos: planillaObjetivo.filter((row: any) => row._descubierto).length,
    enCurso: planillaObjetivo.filter((row: any) => row._enCurso).length,
    horasReales: planillaObjetivo.reduce((sum: number, row: any) => sum + row._horasReales, 0),
    horasLiquidables: planillaObjetivo.reduce((sum: number, row: any) => sum + row._horasLiquidables, 0),
  }

  const exportarPlanillaEmpleadoXLSX = async () => {
    if (!empleadoSeleccionado || planillaEmpleado.length === 0) return

    const columnas = ['Fecha', 'Día', 'Objetivo', 'Horario programado', 'Entrada real', 'Salida real', 'Horas reales', 'Horas liquidables', 'Estado', 'GPS ingreso', 'Distancia ingreso', 'Estado GPS ingreso']
    const filas = [
      ['Planilla individual por empleado'],
      [`Mes/Año: ${mesLabel}`],
      [`Empleado: ${empleadoSeleccionado.apellido}, ${empleadoSeleccionado.nombre} · Legajo: ${empleadoSeleccionado.legajo || '—'}`],
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
        row['GPS ingreso'],
        row['Distancia ingreso'],
        row['Estado GPS ingreso'],
      ]),
      [],
      ['Totales'],
      ['Días trabajados', totalesEmpleado.dias],
      ['Horas reales totales', Number(totalesEmpleado.horasReales.toFixed(2))],
      ['Horas liquidables totales', Number(totalesEmpleado.horasLiquidables.toFixed(2))],
      ['Tardanzas', totalesEmpleado.tardanzas],
      ['Turnos sin fichar', totalesEmpleado.sinFichar],
    ]
    const nombre = `empleado_${archivoParte(`${empleadoSeleccionado.apellido}_${empleadoSeleccionado.nombre}`)}_${mesArchivo()}.xlsx`

    await descargarXLSX(nombre, filas, 4, planillaEmpleado.length, [6, 7, 1])
  }

  const exportarPlanillaObjetivoXLSX = async () => {
    if (!objetivoSeleccionado || planillaObjetivo.length === 0) return

    const columnas = ['Fecha', 'Guardia', 'Horario programado', 'Entrada real', 'Salida real', 'Horas reales', 'Horas liquidables', 'Estado', 'GPS ingreso', 'Distancia ingreso', 'Estado GPS ingreso']
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
        row['Entrada real'],
        row['Salida real'],
        Number(row._horasReales.toFixed(2)),
        Number(row._horasLiquidables.toFixed(2)),
        row.Estado,
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
    ]
    const nombre = `objetivo_${archivoParte(objetivoSeleccionado.nombre)}_${mesArchivo()}.xlsx`

    await descargarXLSX(nombre, filas, 4, planillaObjetivo.length, [5, 6, 1])
  }

  const reporteGuardias = guardias
    .map((g: Usuario) => {
      const regs = registrosMes.filter((r: RegistroAsistencia) => r.guardia_id === g.id)
      const regsCerrados = regs.filter((r: RegistroAsistencia) => r.hora_salida_real)
      const dias = new Set(regs.map((r: RegistroAsistencia) => turnoPorId.get(r.turno_id)?.fecha).filter(Boolean)).size
      const horasReales = regsCerrados.reduce((s: number, r: RegistroAsistencia) => s + Math.max(0, Number(r.horas_trabajadas) || 0), 0)
      const horasLiquidables = regsCerrados.reduce((s: number, r: RegistroAsistencia) => {
        const turno = turnoPorId.get(r.turno_id)
        return turno ? s + calcHorasLiquidables(turno.fecha, turno.hora_inicio, turno.hora_fin, r.hora_entrada_real, r.hora_salida_real) : s
      }, 0)

      return {
        Legajo: g.legajo,
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
      }
    })
    .filter((g: any) => verTodos || g._registros > 0)

  const reporteObjetivos = objetivos
    .map((o: Objetivo) => {
      const ts = turnosMes.filter((t: Turno) => t.objetivo_id === o.id)
      const regs = registrosMes.filter((r: RegistroAsistencia) => turnoPorId.get(r.turno_id)?.objetivo_id === o.id)
      const regsCerrados = regs.filter((r: RegistroAsistencia) => r.hora_salida_real)
      const turnosConAsistencia = new Set(regs.map((r: RegistroAsistencia) => r.turno_id)).size
      const horasReales = regsCerrados.reduce((s: number, r: RegistroAsistencia) => s + Math.max(0, Number(r.horas_trabajadas) || 0), 0)
      const horasLiquidables = regsCerrados.reduce((s: number, r: RegistroAsistencia) => {
        const turno = turnoPorId.get(r.turno_id)
        return turno ? s + calcHorasLiquidables(turno.fecha, turno.hora_inicio, turno.hora_fin, r.hora_entrada_real, r.hora_salida_real) : s
      }, 0)
      const turnosEnCurso = regs.filter((r: RegistroAsistencia) => r.hora_entrada_real && !r.hora_salida_real).length
      const turnosSinFichar = ts.filter((t: Turno) => t.guardia_id && !regs.some((r: RegistroAsistencia) => r.turno_id === t.id && r.hora_entrada_real)).length
      const turnosDescubiertos = ts.filter((t: Turno) => t.estado === 'descubierto' || !t.guardia_id).length

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
      [`Generado: ${new Date().toLocaleString('es-AR')}`],
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
      [`Generado: ${new Date().toLocaleString('es-AR')}`],
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
  const totalBox = (label: string, value: string | number) => (
    <div style={{ background:'#1a2235', border:'1px solid #1e2d42', borderRadius:8, padding:'10px 12px' }}>
      <div style={{ fontSize:10, color:'#64748b', textTransform:'uppercase' as const, letterSpacing:1, marginBottom:4 }}>{label}</div>
      <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, color:'#e2e8f0' }}>{value}</div>
    </div>
  )
  const renderEmpty = (text: string) => <div style={{ padding:24, color:'#64748b', textAlign:'center' as const }}>{text}</div>

  return (
    <div>
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
            <button style={{ ...S.btn, ...S.btnSecondary, marginLeft:'auto' }} onClick={exportarPlanillaEmpleadoXLSX}>Exportar XLSX</button>
          </div>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:18, fontWeight:800 }}>Planilla individual por empleado</div>
            <div style={{ color:'#94a3b8', fontSize:13 }}>Empleado: <strong style={{ color:'#e2e8f0' }}>{empleadoSeleccionado ? `${empleadoSeleccionado.nombre} ${empleadoSeleccionado.apellido}` : '—'}</strong> · Legajo: <strong style={{ color:'#e2e8f0' }}>{empleadoSeleccionado?.legajo || '—'}</strong> · Mes: <strong style={{ color:'#e2e8f0' }}>{mesLabel}</strong></div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))', gap:8, marginBottom:16 }}>
            {totalBox('Días trabajados', totalesEmpleado.dias)}
            {totalBox('Horas reales', totalesEmpleado.horasReales.toFixed(2))}
            {totalBox('Horas liquidables', totalesEmpleado.horasLiquidables.toFixed(2))}
            {totalBox('Sin fichar', totalesEmpleado.sinFichar)}
            {totalBox('En curso', totalesEmpleado.enCurso)}
            {totalBox('Tardanzas', totalesEmpleado.tardanzas)}
          </div>
          <table style={S.table}>
            <thead><tr><th style={S.th}>Fecha</th><th style={S.th}>Día</th><th style={S.th}>Objetivo</th><th style={S.th}>Programado</th><th style={S.th}>Entrada</th><th style={S.th}>Salida</th><th style={S.th}>Hs reales</th><th style={S.th}>Hs liquidables</th><th style={S.th}>Estado</th><th style={S.th}>Observaciones / alertas</th><th style={S.th}>GPS ingreso</th><th style={S.th}>Distancia ingreso</th><th style={S.th}>Estado GPS ingreso</th></tr></thead>
            <tbody>
              {planillaEmpleado.map((row: any) => (
                <tr key={row._id}>
                  <td style={S.td}>{row.Fecha}</td>
                  <td style={S.td}>{row.Día}</td>
                  <td style={S.td}><strong>{row.Objetivo}</strong></td>
                  <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:700 }}>{row['Horario programado']}</td>
                  <td style={S.td}>{row['Entrada real']}</td>
                  <td style={S.td}>{row['Salida real']}</td>
                  <td style={S.td}>{row['Horas reales']}</td>
                  <td style={{ ...S.td, color:'#10b981', fontWeight:700 }}>{row['Horas liquidables']}</td>
                  <td style={S.td}><Badge type={row.Estado === 'Cubierto' ? 'cubierto' : row.Estado === 'Descubierto' ? 'descubierto' : 'pendiente'}>{row.Estado}</Badge></td>
                  <td style={{ ...S.td, minWidth:180 }}>{row['Observaciones / alertas']}</td>
                  <td style={S.td}>{row['GPS ingreso']}</td>
                  <td style={S.td}>{row['Distancia ingreso']}</td>
                  <td style={S.td}><Badge type={row['Estado GPS ingreso'] === 'Fuera del radio' ? 'alerta' : row['Estado GPS ingreso'] === 'Dentro del radio' ? 'ok' : 'pendiente'}>{row['Estado GPS ingreso']}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          {planillaEmpleado.length === 0 && renderEmpty('No hay turnos asignados o trabajados para este empleado en el mes seleccionado.')}
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
            <button style={{ ...S.btn, ...S.btnSecondary, marginLeft:'auto' }} onClick={exportarPlanillaObjetivoXLSX}>Exportar XLSX</button>
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
            {totalBox('Horas liquidables', totalesObjetivo.horasLiquidables.toFixed(2))}
          </div>
          <table style={S.table}>
            <thead><tr><th style={S.th}>Fecha</th><th style={S.th}>Día</th><th style={S.th}>Programado</th><th style={S.th}>Guardia asignado</th><th style={S.th}>Guardia que fichó</th><th style={S.th}>Entrada</th><th style={S.th}>Salida</th><th style={S.th}>Hs reales</th><th style={S.th}>Hs liquidables</th><th style={S.th}>Estado</th><th style={S.th}>Observaciones / alertas</th><th style={S.th}>GPS ingreso</th><th style={S.th}>Distancia ingreso</th><th style={S.th}>Estado GPS ingreso</th></tr></thead>
            <tbody>
              {planillaObjetivo.map((row: any) => (
                <tr key={row._id}>
                  <td style={S.td}>{row.Fecha}</td>
                  <td style={S.td}>{row.Día}</td>
                  <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:700 }}>{row['Horario programado']}</td>
                  <td style={S.td}>{row['Guardia asignado']}</td>
                  <td style={S.td}>{row['Guardia que fichó']}</td>
                  <td style={S.td}>{row['Entrada real']}</td>
                  <td style={S.td}>{row['Salida real']}</td>
                  <td style={S.td}>{row['Horas reales']}</td>
                  <td style={{ ...S.td, color:'#10b981', fontWeight:700 }}>{row['Horas liquidables']}</td>
                  <td style={S.td}><Badge type={row.Estado === 'Cubierto' ? 'cubierto' : row.Estado === 'Descubierto' ? 'descubierto' : 'pendiente'}>{row.Estado}</Badge></td>
                  <td style={{ ...S.td, minWidth:180 }}>{row['Observaciones / alertas']}</td>
                  <td style={S.td}>{row['GPS ingreso']}</td>
                  <td style={S.td}>{row['Distancia ingreso']}</td>
                  <td style={S.td}><Badge type={row['Estado GPS ingreso'] === 'Fuera del radio' ? 'alerta' : row['Estado GPS ingreso'] === 'Dentro del radio' ? 'ok' : 'pendiente'}>{row['Estado GPS ingreso']}</Badge></td>
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
    </div>
  )
}


// ── SERVICIOS OBJETIVO ────────────────────────────────────────
function ServiciosObjetivo({ guardias, objetivos }: any) {
  const [servicios, setServicios] = useState<any[]>([])
  const [turnosBase, setTurnosBase] = useState<any[]>([])
  const [modal, setModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [loadingData, setLoadingData] = useState(true)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    objetivo_id: '',
    turno_base_id: '',
    nombre_puesto: '',
    dias_semana: [1, 2, 3, 4, 5] as number[],
    guardia_habitual_id: '',
    activo: true,
  })
  const [generando, setGenerando] = useState(false)
  const [mesGenerar, setMesGenerar] = useState(() => {
    const hoy = new Date()
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  })
  const [resultadoGeneracion, setResultadoGeneracion] = useState<string | null>(null)

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
        .select(`*, objetivo:objetivos(nombre), turno_base:turnos_base(nombre, hora_inicio, hora_fin), guardia:usuarios(nombre, apellido)`)
        .order('created_at', { ascending: false }),
      supabase.from('turnos_base').select('*').eq('activo', true).order('hora_inicio'),
    ])
    if (sv) setServicios(sv)
    if (tb) setTurnosBase(tb)
    setLoadingData(false)
  }

  useEffect(() => { cargar() }, [])

  const resetForm = () => setForm({ objetivo_id:'', turno_base_id:'', nombre_puesto:'', dias_semana:[1,2,3,4,5], guardia_habitual_id:'', activo:true })
  const abrirNuevo = () => { resetForm(); setEditId(null); setModal(true) }
  const abrirEditar = (s: any) => {
    setForm({ objetivo_id:s.objetivo_id, turno_base_id:s.turno_base_id, nombre_puesto:s.nombre_puesto||'', dias_semana:s.dias_semana||[1,2,3,4,5], guardia_habitual_id:s.guardia_habitual_id||'', activo:s.activo })
    setEditId(s.id); setModal(true)
  }
  const toggleDia = (num: number) => {
    setForm(prev => ({ ...prev, dias_semana: prev.dias_semana.includes(num) ? prev.dias_semana.filter(d => d !== num) : [...prev.dias_semana, num].sort((a,b) => a-b) }))
  }
  const guardar = async () => {
    if (!form.objetivo_id || !form.turno_base_id || form.dias_semana.length === 0) return
    setLoading(true)
    const payload = { objetivo_id:form.objetivo_id, turno_base_id:form.turno_base_id, nombre_puesto:form.nombre_puesto||null, dias_semana:form.dias_semana, guardia_habitual_id:form.guardia_habitual_id||null, activo:form.activo }
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

  const generarMes = async () => {
    if (!mesGenerar) return
    setGenerando(true); setResultadoGeneracion(null)
    const [anio, mes] = mesGenerar.split('-').map(Number)
    const { data: serviciosActivos, error } = await supabase
      .from('servicios_objetivo').select('*, turno_base:turnos_base(hora_inicio, hora_fin)').eq('activo', true)
    if (error || !serviciosActivos?.length) { setResultadoGeneracion('No hay servicios activos para generar.'); setGenerando(false); return }
    const fechaDesde = `${anio}-${String(mes).padStart(2,'0')}-01`
    const ultimoDia = new Date(anio, mes, 0).getDate()
    const fechaHasta = `${anio}-${String(mes).padStart(2,'0')}-${ultimoDia}`
    const fechaConsultaDesde = fechasVecinasTurno(fechaDesde)[0]
    const fechaConsultaHasta = fechasVecinasTurno(fechaHasta)[2]
    const { data: turnosExistentes } = await supabase
      .from('turnos')
      .select('id, objetivo_id, guardia_id, fecha, hora_inicio, hora_fin')
      .gte('fecha', fechaConsultaDesde)
      .lte('fecha', fechaConsultaHasta)
      .eq('tipo_evento', 'normal')
    const existentes = new Set((turnosExistentes || []).map((t: any) => `${t.objetivo_id}|${t.guardia_id}|${t.fecha}|${t.hora_inicio}|${t.hora_fin}`))
    const nuevos: any[] = []
    for (const srv of serviciosActivos) {
      if (!srv.turno_base || !srv.dias_semana?.length || !srv.guardia_habitual_id) continue
      const guardiaId = srv.guardia_habitual_id
      for (let dia = 1; dia <= ultimoDia; dia++) {
        const fecha = new Date(anio, mes - 1, dia)
        let diaSemana = fecha.getDay(); if (diaSemana === 0) diaSemana = 7
        if (!srv.dias_semana.includes(diaSemana)) continue
        const fechaStr = `${anio}-${String(mes).padStart(2,'0')}-${String(dia).padStart(2,'0')}`
        const key = `${srv.objetivo_id}|${guardiaId}|${fechaStr}|${srv.turno_base.hora_inicio}|${srv.turno_base.hora_fin}`
        if (existentes.has(key)) continue
        const candidato = { objetivo_id:srv.objetivo_id, guardia_id:guardiaId, guardia_original_id:guardiaId, guardia_real_id:null, fecha:fechaStr, hora_inicio:srv.turno_base.hora_inicio, hora_fin:srv.turno_base.hora_fin, estado:'programado', tipo_evento:'normal', estado_revision:'aprobado', servicio_base_id:srv.id }
        if (tieneTurnoSuperpuesto([...(turnosExistentes || []), ...nuevos], candidato)) {
          setResultadoGeneracion(MENSAJE_TURNO_SUPERPUESTO)
          setGenerando(false)
          return
        }
        nuevos.push(candidato)
      }
    }
    if (nuevos.length === 0) { setResultadoGeneracion('No hay turnos nuevos para generar. Todos ya existen o no tienen guardia asignado.'); setGenerando(false); return }
    let insertados = 0
    for (let i = 0; i < nuevos.length; i += 100) {
      const { error: errInsert } = await supabase.from('turnos').insert(nuevos.slice(i, i + 100))
      if (!errInsert) insertados += Math.min(100, nuevos.length - i)
    }
    setResultadoGeneracion(`✅ Generados ${insertados} turnos para ${mesGenerar}.`)
    setGenerando(false)
  }

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', marginBottom:24 }}>
        <div style={{ flex:1 }}><div style={S.title}>Servicios por Objetivo</div><div style={S.sub2}>{servicios.length} servicios configurados</div></div>
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={abrirNuevo}>+ Nuevo Servicio</button>
      </div>

      <div style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:12, padding:20, marginBottom:20 }}>
        <div style={{ fontFamily:'Syne,sans-serif', fontSize:15, fontWeight:700, marginBottom:4 }}>📅 Generar turnos del mes</div>
        <div style={{ fontSize:13, color:'#64748b', marginBottom:16 }}>Crea automáticamente los turnos en base a los servicios activos.</div>
        <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
          <input type="month" style={{ ...S.input, width:'auto', minWidth:160 }} value={mesGenerar} onChange={e => { setMesGenerar(e.target.value); setResultadoGeneracion(null) }} />
          <button style={{ ...S.btn, ...S.btnPrimary, opacity: generando ? 0.6 : 1 }} onClick={generarMes} disabled={generando}>{generando ? '⏳ Generando...' : '⚡ Generar mes'}</button>
        </div>
        {resultadoGeneracion && (
          <div style={{ marginTop:12, padding:'10px 14px', borderRadius:8, fontSize:13, background: resultadoGeneracion.startsWith('✅') ? 'rgba(16,185,129,.1)' : 'rgba(245,158,11,.1)', border: `1px solid ${resultadoGeneracion.startsWith('✅') ? 'rgba(16,185,129,.3)' : 'rgba(245,158,11,.3)'}`, color: resultadoGeneracion.startsWith('✅') ? '#10b981' : '#f59e0b' }}>
            {resultadoGeneracion}
          </div>
        )}
      </div>

      <div style={S.card}>
        {loadingData ? (
          <div style={{ textAlign:'center', padding:48, color:'#64748b' }}>Cargando...</div>
        ) : servicios.length === 0 ? (
          <div style={{ textAlign:'center', padding:48, color:'#64748b' }}><div style={{ fontSize:40, marginBottom:12 }}>🏢</div><div>No hay servicios configurados. Creá el primero.</div></div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={S.table}>
              <thead><tr><th style={S.th}>Objetivo</th><th style={S.th}>Turno Base</th><th style={S.th}>Puesto</th><th style={S.th}>Días</th><th style={S.th}>Guardia Habitual</th><th style={S.th}>Estado</th><th style={S.th}></th></tr></thead>
              <tbody>
                {servicios.map((s: any) => (
                  <tr key={s.id}>
                    <td style={S.td}><strong>{s.objetivo?.nombre || '—'}</strong></td>
                    <td style={S.td}>
                      <div>{s.turno_base?.nombre || '—'}</div>
                      {s.turno_base && <div style={{ fontSize:11, color:'#f59e0b', fontFamily:'Syne,sans-serif', fontWeight:600 }}>{s.turno_base.hora_inicio} → {s.turno_base.hora_fin}</div>}
                    </td>
                    <td style={{ ...S.td, color:'#94a3b8', fontSize:12 }}>{s.nombre_puesto || <span style={{ color:'#374151' }}>—</span>}</td>
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
          <div style={{ marginBottom:16 }}><label style={S.label}>Nombre del puesto (opcional)</label><input style={S.input} value={form.nombre_puesto} onChange={e => setForm({...form, nombre_puesto:e.target.value})} placeholder="ej: Portería principal" /></div>
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


// ── SUPERVISORES DE GUARDIA ──────────────────────────────────
function SupervisoresGuardia({ guardias, user }: any) {
  const hoy = new Date().toLocaleDateString('sv-SE')
  const rolesOperativos = [
    { value: 'supervisor', label: 'Supervisor' },
    { value: 'jefe_operativo', label: 'Jefe operativo' },
    { value: 'director_tecnico', label: 'Director técnico' },
  ]
  const formInicial = () => ({
    supervisor_id: '',
    fecha: hoy,
    hora_inicio: '18:00',
    hora_fin: '06:00',
    zona: ZONA_SUPERVISORES_GUARDIA,
    rol_operativo: 'supervisor',
    estado: 'activo',
    observacion: '',
  })

  const [guardiasSupervisor, setGuardiasSupervisor] = useState<any[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [historialSeleccionado, setHistorialSeleccionado] = useState<any | null>(null)
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error', texto: string } | null>(null)
  const [form, setForm] = useState(formInicial)

  const supervisoresDisponibles = guardias
    .filter((g: any) => ['supervisor', 'admin'].includes(g.rol))
    .sort((a: any, b: any) => `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`))

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

  useEffect(() => { cargar() }, [])

  const nombreUsuario = (id?: string | null) => {
    const usuario = guardias.find((g: any) => g.id === id)
    return usuario ? `${usuario.apellido}, ${usuario.nombre}` : 'Sin supervisor'
  }

  const rolLabel = (rol?: string | null) => rolesOperativos.find(r => r.value === rol)?.label || rol || '—'
  const horario = (item: any) => `${formatHoraTurno(item.hora_inicio)} a ${formatHoraTurno(item.hora_fin)}`

  const abrirNuevo = () => {
    setForm(formInicial())
    setEditId(null)
    setMensaje(null)
    setModal(true)
  }

  const abrirEditar = (item: any) => {
    setForm({
      supervisor_id: item.supervisor_id || '',
      fecha: item.fecha || hoy,
      hora_inicio: formatHoraTurno(item.hora_inicio) === '—' ? '18:00' : formatHoraTurno(item.hora_inicio),
      hora_fin: formatHoraTurno(item.hora_fin) === '—' ? '06:00' : formatHoraTurno(item.hora_fin),
      zona: item.zona || ZONA_SUPERVISORES_GUARDIA,
      rol_operativo: item.rol_operativo || 'supervisor',
      estado: item.estado || 'activo',
      observacion: item.observacion || '',
    })
    setEditId(item.id)
    setMensaje(null)
    setModal(true)
  }

  const guardar = async () => {
    if (!form.fecha || !form.hora_inicio || !form.hora_fin || !form.supervisor_id) {
      setMensaje({ tipo:'error', texto:'Completá fecha, horario y supervisor asignado.' })
      return
    }

    setLoading(true)
    setMensaje(null)

    const payload: any = {
      supervisor_id: form.supervisor_id,
      fecha: form.fecha,
      hora_inicio: form.hora_inicio,
      hora_fin: form.hora_fin,
      zona: form.zona || ZONA_SUPERVISORES_GUARDIA,
      rol_operativo: form.rol_operativo,
      estado: form.estado,
      observacion: form.observacion.trim() || null,
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
      setModal(false)
      setEditId(null)
      setForm(formInicial())
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
          <div style={S.sub2}>Zona {ZONA_SUPERVISORES_GUARDIA} · Jefe operativo {JEFE_OPERATIVO_GUARDIA} · Director técnico {DIRECTOR_TECNICO_GUARDIA}</div>
        </div>
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={abrirNuevo}>+ Nueva guardia</button>
      </div>

      <div style={{ ...S.card, display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:12 }}>
        <div><div style={S.label}>Supervisores operativos</div><strong>Fulla · Aranda · Martínez</strong></div>
        <div><div style={S.label}>Zona actual</div><strong>{ZONA_SUPERVISORES_GUARDIA}</strong></div>
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
                    <td style={S.td}>{nombreUsuario(item.supervisor_id)}</td>
                    <td style={S.td}>{rolLabel(item.rol_operativo)}</td>
                    <td style={S.td}>{item.zona || ZONA_SUPERVISORES_GUARDIA}</td>
                    <td style={S.td}><Badge type={item.estado || 'activo'}>{item.estado || 'activo'}</Badge></td>
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
        <Modal title={editId ? 'Editar guardia de supervisor' : 'Nueva guardia de supervisor'} onClose={() => { setModal(false); setEditId(null); setForm(formInicial()) }}
          footer={<><button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => { setModal(false); setEditId(null); setForm(formInicial()) }}>Cancelar</button><button style={{ ...S.btn, ...S.btnPrimary }} onClick={guardar} disabled={loading}>{loading ? 'Guardando...' : 'Guardar'}</button></>}>
          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}><label style={S.label}>Fecha *</label><input type="date" style={S.input} value={form.fecha} onChange={e => setForm({...form, fecha:e.target.value})} /></div>
            <div style={{ marginBottom:16 }}><label style={S.label}>Zona</label><input style={S.input} value={form.zona} onChange={e => setForm({...form, zona:e.target.value})} /></div>
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
          <div style={{ marginBottom:8 }}>
            <label style={S.label}>Observación</label>
            <textarea style={{ ...S.input, minHeight:90, resize:'vertical' }} value={form.observacion} onChange={e => setForm({...form, observacion:e.target.value})} placeholder="Comentario operativo opcional" />
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── LAYOUT GUARDIA (mobile-first) ─────────────────────────────
function LayoutGuardia({ user, turnos, registros, novedades, setRegistros, setNovedades, guardias, objetivos }: any) {
  const [page, setPage] = useState('asistencia')
  const misTurnos = turnos.filter((t: any) => t.guardia_id === user.id)
  const misRegistros = registros.filter((r: any) => r.guardia_id === user.id)
  const misNovedades = novedades.filter((n: any) => n.guardia_id === user.id)
  const NAV_ITEMS = [{ id:'asistencia', icon:'✅', label:'Asistencia' }, { id:'novedades', icon:'📋', label:'Novedades' }]
  const estiloNav: React.CSSProperties = { position:'fixed', bottom:0, left:0, right:0, background:'#111827', borderTop:'1px solid #1e2d42', display:'flex', zIndex:100 }
  const estiloNavBtn = (active: boolean): React.CSSProperties => ({ flex:1, padding:'12px 8px', background:'none', border:'none', cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:4, color: active ? '#f59e0b' : '#64748b', borderTop: active ? '2px solid #f59e0b' : '2px solid transparent' })
  return (
    <div style={{ background:'#0a0e1a', minHeight:'100vh', paddingBottom:80 }}>
      <div style={{ background:'#111827', borderBottom:'1px solid #1e2d42', padding:'16px 20px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:22 }}>🛡️</span>
          <div>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:14, fontWeight:800, color:'#f59e0b' }}>MERCOSUR</div>
            <div style={{ fontSize:11, color:'#64748b' }}>Control Operativo</div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:13, fontWeight:500, color:'#e2e8f0' }}>{user.nombre} {user.apellido}</div>
            <div style={{ fontSize:11, color:'#64748b' }}>Guardia · {user.legajo}</div>
          </div>
          <button onClick={async () => { await supabase.auth.signOut(); window.location.reload() }} style={{ background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.3)', color:'#ef4444', borderRadius:8, padding:'6px 12px', cursor:'pointer', fontSize:12 }}>Salir</button>
        </div>
      </div>
      <div style={{ padding:'20px 16px' }}>
        {page === 'asistencia' && <AsistenciaGuardia user={user} misTurnos={misTurnos} misRegistros={misRegistros} registros={registros} setRegistros={setRegistros} guardias={guardias} objetivos={objetivos} turnos={turnos} />}
        {page === 'novedades' && <NovedadesGuardia user={user} misNovedades={misNovedades} setNovedades={setNovedades} guardias={guardias} objetivos={objetivos} />}
      </div>
      <nav style={estiloNav}>
        {NAV_ITEMS.map(item => (
          <button key={item.id} style={estiloNavBtn(page === item.id)} onClick={() => setPage(item.id)}>
            <span style={{ fontSize:20 }}>{item.icon}</span>
            <span style={{ fontSize:11, fontWeight:600 }}>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

// ── ASISTENCIA GUARDIA ─────────────────────────────────────────
function AsistenciaGuardia({ user, misTurnos, misRegistros, registros, setRegistros, guardias, objetivos, turnos }: any) {
  const [modalPresente, setModalPresente] = useState(false)
  const [modalUrgente, setModalUrgente] = useState(false)
  const [turnoSeleccionado, setTurnoSeleccionado] = useState<any>(null)
  const [horaEntrada, setHoraEntrada] = useState('')
  const [horaSalida, setHoraSalida] = useState('')
  const [observacion, setObservacion] = useState('')
  const [obsUrgente, setObsUrgente] = useState('')
  const [turnoUrgenteId, setTurnoUrgenteId] = useState('')
  const [loading, setLoading] = useState(false)
  const hoy = new Date().toISOString().split('T')[0]
  const turnosHoy = misTurnos.filter((t: any) => t.fecha === hoy)
  const registroHoy = (turnoId: string) => misRegistros.find((r: any) => r.turno_id === turnoId)
  const misRegistrosOrdenados = [...misRegistros].sort((a: any, b: any) => {
    const turnoA = turnos.find((t: any) => t.id === a.turno_id)
    const turnoB = turnos.find((t: any) => t.id === b.turno_id)

    return ordenRegistroAsistencia(b, turnoB) - ordenRegistroAsistencia(a, turnoA)
  })
  const darPresente = async () => {
    if (!turnoSeleccionado || !horaEntrada) return
    setLoading(true)
    const alertaE = calcAlertaEntrada(turnoSeleccionado.hora_inicio, horaEntrada)
    const alertaS = horaSalida ? calcAlertaSalida(turnoSeleccionado.hora_fin, horaSalida) : null
    const horas = horaSalida ? calcHorasTrabajadas(horaEntrada, horaSalida) : 0
    const { data } = await supabase.from('registros_asistencia').insert({ turno_id:turnoSeleccionado.id, guardia_id:user.id, hora_entrada_real:horaEntrada, hora_salida_real:horaSalida||null, horas_trabajadas:horas, alerta_entrada:alertaE, alerta_salida:alertaS, observacion }).select().single()
    if (data) { setRegistros((prev: any[]) => [data, ...prev]); await supabase.from('turnos').update({ estado:'cubierto' }).eq('id', turnoSeleccionado.id) }
    setModalPresente(false); setHoraEntrada(''); setHoraSalida(''); setObservacion(''); setLoading(false)
  }
  const darPresenteUrgente = async () => {
    if (!turnoUrgenteId || !horaEntrada) return
    setLoading(true)
    const turno = turnos.find((t: any) => t.id === turnoUrgenteId)
    if (!turno) { setLoading(false); return }
    const { data } = await supabase.from('registros_asistencia').insert({ turno_id:turno.id, guardia_id:user.id, hora_entrada_real:horaEntrada, hora_salida_real:horaSalida||null, horas_trabajadas:horaSalida?calcHorasTrabajadas(horaEntrada,horaSalida):0, observacion:obsUrgente }).select().single()
    if (data) { setRegistros((prev: any[]) => [data, ...prev]); await supabase.from('turnos').update({ guardia_real_id:user.id, tipo_evento:'cobertura_urgente', estado_revision:'pendiente_supervisor', observacion_guardia:obsUrgente, estado:'cubierto' }).eq('id', turno.id) }
    setModalUrgente(false); setHoraEntrada(''); setHoraSalida(''); setObsUrgente(''); setTurnoUrgenteId(''); setLoading(false)
  }
  const colorAlerta = (alerta: string | null) => {
    if (alerta === 'tarde') return { bg:'rgba(239,68,68,.1)', color:'#ef4444', texto:'⏰ Llegada tarde' }
    if (alerta === 'anticipada') return { bg:'rgba(245,158,11,.1)', color:'#f59e0b', texto:'⬇ Salida anticipada' }
    if (alerta === 'posterior') return { bg:'rgba(59,130,246,.1)', color:'#60a5fa', texto:'⏱ Salida posterior' }
    return null
  }
  const turnosDescubiertos = turnos.filter((t: any) => t.fecha === hoy && t.estado !== 'cubierto' && t.guardia_id !== user.id)
  return (
    <div>
      <div style={{ marginBottom:20 }}>
        <div style={{ fontFamily:'Syne,sans-serif', fontSize:22, fontWeight:800, marginBottom:4 }}>Mi Asistencia</div>
        <div style={{ color:'#64748b', fontSize:13 }}>{new Date().toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' })}</div>
      </div>
      <div style={{ marginBottom:24 }}>
        <div style={{ fontSize:12, color:'#64748b', textTransform:'uppercase', letterSpacing:1, fontWeight:600, marginBottom:12 }}>MIS TURNOS HOY</div>
        {turnosHoy.length === 0 ? (
          <div style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:12, padding:24, textAlign:'center', color:'#64748b' }}><div style={{ fontSize:32, marginBottom:8 }}>📅</div><div>No tenés turnos asignados para hoy</div></div>
        ) : turnosHoy.map((t: any) => {
          const reg = registroHoy(t.id)
          const obj = objetivos.find((o: any) => o.id === t.objetivo_id)
          const alertaE = reg ? colorAlerta(reg.alerta_entrada) : null
          const alertaS = reg ? colorAlerta(reg.alerta_salida) : null
          return (
            <div key={t.id} style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:12, padding:20, marginBottom:12 }}>
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:12 }}>
                <div>
                  <div style={{ fontFamily:'Syne,sans-serif', fontSize:16, fontWeight:700, color:'#e2e8f0' }}>{obj?.nombre || 'Objetivo'}</div>
                  <div style={{ fontSize:13, color:'#64748b', marginTop:2 }}>{obj?.direccion || ''}</div>
                </div>
                <Badge type={t.estado}>{t.estado}</Badge>
              </div>
              <div style={{ display:'flex', gap:16, marginBottom:16 }}>
                <div style={{ background:'#1a2235', borderRadius:8, padding:'8px 14px', flex:1, textAlign:'center' }}>
                  <div style={{ fontSize:11, color:'#64748b', marginBottom:4 }}>ENTRADA</div>
                  <div style={{ fontFamily:'Syne,sans-serif', fontSize:18, fontWeight:700, color:'#f59e0b' }}>{t.hora_inicio}</div>
                </div>
                <div style={{ background:'#1a2235', borderRadius:8, padding:'8px 14px', flex:1, textAlign:'center' }}>
                  <div style={{ fontSize:11, color:'#64748b', marginBottom:4 }}>SALIDA</div>
                  <div style={{ fontFamily:'Syne,sans-serif', fontSize:18, fontWeight:700, color:'#f59e0b' }}>{t.hora_fin}</div>
                </div>
              </div>
              {reg ? (
                <div>
                  <div style={{ background:'rgba(16,185,129,.08)', border:'1px solid rgba(16,185,129,.2)', borderRadius:8, padding:12, marginBottom:8 }}>
                    <div style={{ fontSize:12, color:'#10b981', fontWeight:600, marginBottom:6 }}>✓ Presente registrado</div>
                    <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
                      <div style={{ fontSize:13, color:'#94a3b8' }}>Entrada: <span style={{ color:'#e2e8f0', fontWeight:600 }}>{reg.hora_entrada_real}</span></div>
                      {reg.hora_salida_real && <div style={{ fontSize:13, color:'#94a3b8' }}>Salida: <span style={{ color:'#e2e8f0', fontWeight:600 }}>{reg.hora_salida_real}</span></div>}
                      {reg.horas_trabajadas > 0 && <div style={{ fontSize:13, color:'#94a3b8' }}>Horas: <span style={{ color:'#e2e8f0', fontWeight:600 }}>{formatHoras(reg.horas_trabajadas)}</span></div>}
                    </div>
                  </div>
                  {alertaE && <div style={{ background:alertaE.bg, border:`1px solid ${alertaE.color}40`, borderRadius:8, padding:'8px 12px', marginBottom:6, fontSize:12, color:alertaE.color, fontWeight:600 }}>{alertaE.texto}</div>}
                  {alertaS && <div style={{ background:alertaS.bg, border:`1px solid ${alertaS.color}40`, borderRadius:8, padding:'8px 12px', fontSize:12, color:alertaS.color, fontWeight:600 }}>{alertaS.texto}</div>}
                </div>
              ) : (
                <button style={{ ...S.btn, ...S.btnPrimary, width:'100%', justifyContent:'center', fontSize:15, padding:'12px' }}
                  onClick={() => { setTurnoSeleccionado(t); setHoraEntrada(new Date().toTimeString().slice(0,5)); setModalPresente(true) }}>
                  ✅ Dar presente
                </button>
              )}
            </div>
          )
        })}
      </div>
      {turnosDescubiertos.length > 0 && (
        <div style={{ marginBottom:24 }}>
          <div style={{ fontSize:12, color:'#64748b', textTransform:'uppercase', letterSpacing:1, fontWeight:600, marginBottom:12 }}>COBERTURA URGENTE</div>
          <div style={{ background:'rgba(245,158,11,.05)', border:'1px solid rgba(245,158,11,.2)', borderRadius:12, padding:16 }}>
            <div style={{ fontSize:13, color:'#f59e0b', marginBottom:12 }}>⚠ Hay {turnosDescubiertos.length} turno(s) sin cubrir. ¿Podés cubrir uno?</div>
            <button style={{ ...S.btn, ...S.btnSecondary, width:'100%', justifyContent:'center' }} onClick={() => { setHoraEntrada(new Date().toTimeString().slice(0,5)); setModalUrgente(true) }}>🆘 Cubrir turno urgente</button>
          </div>
        </div>
      )}
      {misRegistros.length > 0 && (
        <div>
          <div style={{ fontSize:12, color:'#64748b', textTransform:'uppercase', letterSpacing:1, fontWeight:600, marginBottom:12 }}>HISTORIAL RECIENTE</div>
          {misRegistrosOrdenados.slice(0, 5).map((r: any) => {
            const t = turnos.find((x: any) => x.id === r.turno_id)
            const obj = objetivos.find((o: any) => o.id === t?.objetivo_id)
            return (
              <div key={r.id} style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:10, padding:14, marginBottom:8, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:'#e2e8f0' }}>{obj?.nombre || '—'}</div>
                  <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>{formatFecha(fechaRegistroAsistencia(r, t))} · Entrada {r.hora_entrada_real} · Salida {r.hora_salida_real || '…'}</div>
                </div>
                <div style={{ textAlign:'right' }}>
                  {r.horas_trabajadas > 0 && <div style={{ fontFamily:'Syne,sans-serif', fontSize:14, fontWeight:700, color:'#f59e0b' }}>{formatHoras(r.horas_trabajadas)}</div>}
                  {r.alerta_entrada ? <Badge type={r.alerta_entrada}>⏰ Tarde</Badge> : <Badge type="cubierto">✓ Ok</Badge>}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {modalPresente && turnoSeleccionado && (
        <Modal title="Registrar presencia" onClose={() => { setModalPresente(false); setHoraEntrada(''); setHoraSalida(''); setObservacion('') }}
          footer={<><button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => setModalPresente(false)}>Cancelar</button><button style={{ ...S.btn, ...S.btnPrimary }} onClick={darPresente} disabled={loading || !horaEntrada}>{loading ? 'Registrando...' : 'Confirmar'}</button></>}>
          <div style={{ marginBottom:12, padding:12, background:'#1a2235', borderRadius:8 }}>
            <div style={{ fontSize:13, color:'#94a3b8' }}>Turno</div>
            <div style={{ fontSize:15, fontWeight:600, color:'#e2e8f0', marginTop:2 }}>{objetivos.find((o: any) => o.id === turnoSeleccionado.objetivo_id)?.nombre}</div>
            <div style={{ fontSize:13, color:'#f59e0b', fontFamily:'Syne,sans-serif', fontWeight:600, marginTop:4 }}>{turnoSeleccionado.hora_inicio} → {turnoSeleccionado.hora_fin}</div>
          </div>
          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}><label style={S.label}>Hora entrada *</label><input type="time" style={S.input} value={horaEntrada} onChange={e => setHoraEntrada(e.target.value)} /></div>
            <div style={{ marginBottom:16 }}><label style={S.label}>Hora salida</label><input type="time" style={S.input} value={horaSalida} onChange={e => setHoraSalida(e.target.value)} /></div>
          </div>
          <div style={{ marginBottom:8 }}><label style={S.label}>Observación (opcional)</label><textarea style={{ ...S.input, resize:'vertical' as const, minHeight:60 }} value={observacion} onChange={e => setObservacion(e.target.value)} placeholder="Novedades del turno..." /></div>
        </Modal>
      )}
      {modalUrgente && (
        <Modal title="🆘 Cobertura urgente" onClose={() => { setModalUrgente(false); setHoraEntrada(''); setHoraSalida(''); setObsUrgente(''); setTurnoUrgenteId('') }}
          footer={<><button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => setModalUrgente(false)}>Cancelar</button><button style={{ ...S.btn, ...S.btnPrimary }} onClick={darPresenteUrgente} disabled={loading || !turnoUrgenteId || !horaEntrada}>{loading ? 'Registrando...' : 'Confirmar cobertura'}</button></>}>
          <div style={{ marginBottom:12, padding:10, background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.2)', borderRadius:8, fontSize:12, color:'#f59e0b' }}>Esta cobertura quedará pendiente de revisión del supervisor.</div>
          <div style={{ marginBottom:16 }}><label style={S.label}>Turno a cubrir *</label>
            <select style={S.select} value={turnoUrgenteId} onChange={e => setTurnoUrgenteId(e.target.value)}>
              <option value="">Seleccionar turno...</option>
              {turnosDescubiertos.map((t: any) => { const obj = objetivos.find((o: any) => o.id === t.objetivo_id); return <option key={t.id} value={t.id}>{obj?.nombre} — {t.hora_inicio} a {t.hora_fin}</option> })}
            </select>
          </div>
          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}><label style={S.label}>Hora entrada *</label><input type="time" style={S.input} value={horaEntrada} onChange={e => setHoraEntrada(e.target.value)} /></div>
            <div style={{ marginBottom:16 }}><label style={S.label}>Hora salida</label><input type="time" style={S.input} value={horaSalida} onChange={e => setHoraSalida(e.target.value)} /></div>
          </div>
          <div style={{ marginBottom:8 }}><label style={S.label}>Motivo / Observación *</label><textarea style={{ ...S.input, resize:'vertical' as const, minHeight:60 }} value={obsUrgente} onChange={e => setObsUrgente(e.target.value)} placeholder="Explicá brevemente por qué cubrís este turno..." /></div>
        </Modal>
      )}
    </div>
  )
}

// ── NOVEDADES GUARDIA ──────────────────────────────────────────
function NovedadesGuardia({ user, misNovedades, setNovedades, guardias, objetivos }: any) {
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ objetivo_id:'', tipo:'Rutina', descripcion:'', prioridad:'normal' })
  const [loading, setLoading] = useState(false)
  const guardar = async () => {
    if (!form.descripcion) return
    setLoading(true)
    const { data } = await supabase.from('novedades').insert({ guardia_id:user.id, objetivo_id:form.objetivo_id||null, tipo:form.tipo, descripcion:form.descripcion, prioridad:form.prioridad, estado:'pendiente' }).select().single()
    if (data) setNovedades((prev: any[]) => [data, ...prev])
    setModal(false); setForm({ objetivo_id:'', tipo:'Rutina', descripcion:'', prioridad:'normal' }); setLoading(false)
  }
  const colorPrioridad = (p: string) => {
    if (p === 'urgente') return { border:'rgba(239,68,68,.3)', bg:'rgba(239,68,68,.05)', dot:'#ef4444' }
    if (p === 'importante') return { border:'rgba(245,158,11,.3)', bg:'rgba(245,158,11,.05)', dot:'#f59e0b' }
    return { border:'#1e2d42', bg:'#111827', dot:'#3b82f6' }
  }
  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', marginBottom:20 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:'Syne,sans-serif', fontSize:22, fontWeight:800, marginBottom:4 }}>Mis Novedades</div>
          <div style={{ color:'#64748b', fontSize:13 }}>{misNovedades.filter((n: any) => n.estado === 'pendiente').length} pendientes</div>
        </div>
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setModal(true)}>+ Nueva</button>
      </div>
      {misNovedades.length === 0 ? (
        <div style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:12, padding:32, textAlign:'center', color:'#64748b' }}><div style={{ fontSize:32, marginBottom:8 }}>📋</div><div>No tenés novedades registradas</div></div>
      ) : misNovedades.map((n: any) => {
        const obj = objetivos.find((o: any) => o.id === n.objetivo_id)
        const c = colorPrioridad(n.prioridad)
        return (
          <div key={n.id} style={{ background:c.bg, border:`1px solid ${c.border}`, borderRadius:12, padding:16, marginBottom:12 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ width:8, height:8, borderRadius:'50%', background:c.dot, flexShrink:0 }} />
                <span style={{ fontSize:13, fontWeight:600, color:'#e2e8f0' }}>{n.tipo}</span>
                <Badge type={n.prioridad}>{n.prioridad}</Badge>
              </div>
              <Badge type={n.estado}>{n.estado}</Badge>
            </div>
            <div style={{ fontSize:13, color:'#cbd5e1', lineHeight:1.5, marginBottom:8 }}>{n.descripcion}</div>
            <div style={{ fontSize:11, color:'#64748b' }}>{obj && `📍 ${obj.nombre} · `}{new Date(n.created_at).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</div>
          </div>
        )
      })}
      {modal && (
        <Modal title="Nueva novedad" onClose={() => setModal(false)}
          footer={<><button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => setModal(false)}>Cancelar</button><button style={{ ...S.btn, ...S.btnPrimary }} onClick={guardar} disabled={loading || !form.descripcion}>{loading ? 'Guardando...' : 'Guardar'}</button></>}>
          <div style={{ marginBottom:16 }}><label style={S.label}>Objetivo (opcional)</label><select style={S.select} value={form.objetivo_id} onChange={e => setForm({...form, objetivo_id:e.target.value})}><option value="">Sin objetivo específico</option>{objetivos.filter((o: any) => o.estado === 'activo').map((o: any) => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}><label style={S.label}>Tipo</label><select style={S.select} value={form.tipo} onChange={e => setForm({...form, tipo:e.target.value})}>{['Rutina','Incidente','Mantenimiento','Administrativo','Urgencia'].map(t => <option key={t}>{t}</option>)}</select></div>
            <div style={{ marginBottom:16 }}><label style={S.label}>Prioridad</label><select style={S.select} value={form.prioridad} onChange={e => setForm({...form, prioridad:e.target.value})}><option value="normal">Normal</option><option value="importante">Importante</option><option value="urgente">Urgente</option></select></div>
          </div>
          <div style={{ marginBottom:8 }}><label style={S.label}>Descripción *</label><textarea style={{ ...S.input, resize:'vertical' as const, minHeight:80 }} value={form.descripcion} onChange={e => setForm({...form, descripcion:e.target.value})} placeholder="Describí la novedad..." /></div>
        </Modal>
      )}
    </div>
  )
}


// ── REVISIÓN OPERATIVA ────────────────────────────────────────
function RevisionOperativaLegacy({ guardias, objetivos, turnos, registros, setTurnos }: any) {
  const [coberturas, setCoberturas] = useState<any[]>([])
  const [alertas, setAlertas] = useState<any[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [tab, setTab] = useState<'coberturas' | 'alertas'>('coberturas')
  const [modalItem, setModalItem] = useState<any>(null)
  const [modalTipo, setModalTipo] = useState<'cobertura' | 'alerta' | null>(null)
  const [obsSupervisor, setObsSupervisor] = useState('')
  const [loading, setLoading] = useState(false)

  const cargar = async () => {
    setLoadingData(true)

    const [{ data: cob }, { data: alt }] = await Promise.all([
      supabase
        .from('turnos')
        .select('*')
        .eq('tipo_evento', 'cobertura_urgente')
        .eq('estado_revision', 'pendiente_supervisor')
        .order('fecha', { ascending: false }),

      supabase
        .from('registros_asistencia')
        .select('*, turno:turnos(fecha, hora_inicio, hora_fin, objetivo_id)')
        .or('alerta_entrada.eq.tarde,alerta_salida.eq.anticipada,alerta_salida.eq.posterior')
        .eq('estado_revision', 'pendiente_supervisor')
        .order('created_at', { ascending: false })
        .limit(100),
    ])

    if (cob) setCoberturas(cob)
    if (alt) setAlertas(alt)
    setLoadingData(false)
  }

  useEffect(() => { cargar() }, [])

  const getNombre = (id: string | null) => {
    if (!id) return <span style={{ color:'#64748b' }}>Sin asignar</span>
    const g = guardias.find((x: any) => x.id === id)
    return g ? `${g.apellido}, ${g.nombre}` : '—'
  }

  const getObjetivo = (id: string) => {
    const o = objetivos.find((x: any) => x.id === id)
    return o?.nombre || '—'
  }

  const hoy = new Date().toLocaleDateString('sv-SE')
  const hora = (value?: string | null) => value ? value.slice(0, 5) : '--:--'
  const existeAsistencia = (turno: Turno) => registros.some((r: RegistroAsistencia) => r.turno_id === turno.id)
  const guardiaEsperadoId = (turno: Turno) => (turno as any).guardia_original_id || turno.guardia_id || null
  const detalleTurnoDescubierto = (turno: Turno) => {
    if (!turno.guardia_id) return 'Sin guardia asignado'
    if (turno.estado === 'descubierto') return 'Estado descubierto'
    return 'Pasó ventana de fichaje sin asistencia'
  }

  const abrirModal = (item: any, tipo: 'cobertura' | 'alerta') => {
    setModalItem(item)
    setModalTipo(tipo)
    setObsSupervisor('')
  }

  const resolver = async (decision: 'aprobado' | 'rechazado') => {
    if (!modalItem || !modalTipo) return
    setLoading(true)

    if (modalTipo === 'cobertura') {
      const payload = {
        estado_revision: decision,
        estado: decision === 'aprobado' ? 'cubierto' : 'descubierto',
        observacion_supervisor: obsSupervisor || null,
      }

      const { data } = await supabase
        .from('turnos')
        .update(payload)
        .eq('id', modalItem.id)
        .select()
        .single()

      if (data) {
        setCoberturas(prev => prev.filter(t => t.id !== modalItem.id))
        setTurnos((prev: any[]) => prev.map(t => t.id === modalItem.id ? { ...t, ...payload } : t))
      }
    } else {
      const payload = {
        estado_revision: decision,
        observacion_supervisor: obsSupervisor || null,
      }

      const { data } = await supabase
        .from('registros_asistencia')
        .update(payload)
        .eq('id', modalItem.id)
        .select()
        .single()

      if (data) {
        setAlertas(prev => prev.filter(a => a.id !== modalItem.id))
      }
    }

    setModalItem(null)
    setModalTipo(null)
    setObsSupervisor('')
    setLoading(false)
  }

  const CONFIG_ALERTA: Record<string, { label: string, color: string, bg: string, border: string, icon: string }> = {
    tarde:      { label:'Llegada tarde',     color:'#ef4444', bg:'rgba(239,68,68,.08)',   border:'rgba(239,68,68,.3)',   icon:'⏰' },
    anticipada: { label:'Salida anticipada', color:'#f59e0b', bg:'rgba(245,158,11,.08)',  border:'rgba(245,158,11,.3)',  icon:'⬇' },
    posterior:  { label:'Salida posterior',  color:'#60a5fa', bg:'rgba(59,130,246,.08)',  border:'rgba(59,130,246,.3)',  icon:'⏱' },
    cobertura:  { label:'Cobertura urgente', color:'#a78bfa', bg:'rgba(167,139,250,.08)', border:'rgba(167,139,250,.3)', icon:'🆘' },
  }

  const tipoAlerta = (r: any) => {
    if (r.alerta_entrada === 'tarde') return 'tarde'
    if (r.alerta_salida === 'anticipada') return 'anticipada'
    if (r.alerta_salida === 'posterior') return 'posterior'
    return 'tarde'
  }

  const pendientesAlertas = alertas
    .filter(a => a.estado_revision === 'pendiente_supervisor')
    .sort((a, b) => ordenRegistroAsistencia(b, b.turno) - ordenRegistroAsistencia(a, a.turno))

  const turnosDescubiertosOperativos = turnos
    .filter((t: Turno) => t.fecha === hoy && turnoSinCoberturaOperativa(t, existeAsistencia(t)))
    .sort((a: Turno, b: Turno) => a.hora_inicio.localeCompare(b.hora_inicio))

  const totalAlertasOperativas = pendientesAlertas.length + turnosDescubiertosOperativos.length

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding:'8px 20px', borderRadius:8, cursor:'pointer', fontSize:13, border:'none',
    fontFamily:'DM Sans,sans-serif', fontWeight: active ? 600 : 400,
    color: active ? '#f59e0b' : '#64748b', background: active ? '#111827' : 'transparent',
  })

  return (
    <div>
      <div style={{ marginBottom:24 }}>
        <div style={S.title}>Revisión Operativa</div>
        <div style={S.sub2}>Coberturas urgentes y alertas de asistencia pendientes</div>
      </div>

      <div style={{ display:'flex', gap:4, background:'#1a2235', borderRadius:10, padding:4, marginBottom:24, width:'fit-content' }}>
        <button style={tabStyle(tab === 'coberturas')} onClick={() => setTab('coberturas')}>
          🆘 Coberturas urgentes
          {coberturas.length > 0 && <span style={{ marginLeft:6, background:'rgba(167,139,250,.2)', color:'#a78bfa', borderRadius:10, padding:'1px 7px', fontSize:11 }}>{coberturas.length}</span>}
        </button>
        <button style={tabStyle(tab === 'alertas')} onClick={() => setTab('alertas')}>
          ⚠ Alertas asistencia
          {totalAlertasOperativas > 0 && <span style={{ marginLeft:6, background:'rgba(239,68,68,.15)', color:'#ef4444', borderRadius:10, padding:'1px 7px', fontSize:11 }}>{totalAlertasOperativas}</span>}
        </button>
      </div>

      {loadingData && <div style={{ textAlign:'center', padding:48, color:'#64748b' }}>Cargando...</div>}

      {!loadingData && tab === 'coberturas' && (
        coberturas.length === 0 ? (
          <div style={{ ...S.card, textAlign:'center', padding:48, color:'#64748b' }}>
            <div style={{ fontSize:36, marginBottom:12 }}>✅</div>
            <div>No hay coberturas urgentes pendientes</div>
          </div>
        ) : coberturas.map((t: any) => {
          const cfg = CONFIG_ALERTA.cobertura
          return (
            <div key={t.id} style={{ background:cfg.bg, border:`1px solid ${cfg.border}`, borderRadius:12, padding:20, marginBottom:14 }}>
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:14 }}>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                    <span style={{ fontSize:16 }}>{cfg.icon}</span>
                    <span style={{ fontFamily:'Syne,sans-serif', fontSize:15, fontWeight:700, color: cfg.color }}>{cfg.label}</span>
                  </div>
                  <div style={{ fontFamily:'Syne,sans-serif', fontSize:16, fontWeight:700, color:'#e2e8f0' }}>{getObjetivo(t.objetivo_id)}</div>
                  <div style={{ fontSize:13, color:'#64748b', marginTop:2 }}>{t.fecha} · {t.hora_inicio} → {t.hora_fin}</div>
                </div>
                <Badge type="pendiente">Pendiente</Badge>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
                <div style={{ background:'#111827', borderRadius:8, padding:'10px 14px' }}>
                  <div style={{ fontSize:11, color:'#64748b', marginBottom:3, textTransform:'uppercase' as const, letterSpacing:1 }}>Original</div>
                  <div style={{ fontSize:13, color:'#e2e8f0' }}>{getNombre(t.guardia_original_id)}</div>
                </div>
                <div style={{ background:'#111827', borderRadius:8, padding:'10px 14px', border:`1px solid ${cfg.border}` }}>
                  <div style={{ fontSize:11, color:cfg.color, marginBottom:3, textTransform:'uppercase' as const, letterSpacing:1 }}>Cubrió</div>
                  <div style={{ fontSize:13, color:'#e2e8f0' }}>{getNombre(t.guardia_real_id)}</div>
                </div>
              </div>

              {t.observacion_guardia && (
                <div style={{ background:'rgba(59,130,246,.08)', border:'1px solid rgba(59,130,246,.2)', borderRadius:8, padding:'10px 14px', marginBottom:14 }}>
                  <div style={{ fontSize:11, color:'#60a5fa', marginBottom:3, fontWeight:600 }}>OBSERVACIÓN DEL GUARDIA</div>
                  <div style={{ fontSize:13, color:'#cbd5e1' }}>{t.observacion_guardia}</div>
                </div>
              )}

              <button style={{ ...S.btn, ...S.btnSecondary, width:'100%', justifyContent:'center' }} onClick={() => abrirModal(t, 'cobertura')}>Revisar y resolver</button>
            </div>
          )
        })
      )}

      {!loadingData && tab === 'alertas' && (
        totalAlertasOperativas === 0 ? (
          <div style={{ ...S.card, textAlign:'center', padding:48, color:'#64748b' }}>
            <div style={{ fontSize:36, marginBottom:12 }}>✅</div>
            <div>No hay alertas de asistencia pendientes</div>
          </div>
        ) : (
          <>
            {turnosDescubiertosOperativos.map((t: Turno) => {
              const guardiaEsperado = guardiaEsperadoId(t)

              return (
                <div key={`turno-descubierto-${t.id}`} style={{ background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.3)', borderRadius:12, padding:20, marginBottom:14 }}>
                  <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:14 }}>
                    <div>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                        <span style={{ fontSize:16 }}>⚠</span>
                        <span style={{ fontFamily:'Syne,sans-serif', fontSize:15, fontWeight:700, color:'#ef4444' }}>Turno descubierto</span>
                      </div>
                      <div style={{ fontFamily:'Syne,sans-serif', fontSize:16, fontWeight:700, color:'#e2e8f0' }}>{getObjetivo(t.objetivo_id)}</div>
                      <div style={{ fontSize:13, color:'#64748b', marginTop:2 }}>{formatFecha(t.fecha)} · {hora(t.hora_inicio)} → {hora(t.hora_fin)}</div>
                    </div>
                    <Badge type="descubierto">Descubierto</Badge>
                  </div>

                  <div style={{ background:'#111827', borderRadius:8, padding:'10px 14px', marginBottom:14 }}>
                    <div style={{ fontSize:11, color:'#64748b', marginBottom:3, textTransform:'uppercase' as const, letterSpacing:1 }}>Guardia esperado</div>
                    <div style={{ fontSize:13, color:'#e2e8f0' }}>{guardiaEsperado ? getNombre(guardiaEsperado) : 'Sin guardia esperado'}</div>
                    <div style={{ display:'flex', gap:20, marginTop:8, flexWrap:'wrap' }}>
                      <div style={{ fontSize:12, color:'#94a3b8' }}>Estado: <span style={{ color:'#e2e8f0', fontWeight:600 }}>{t.estado || 'programado'}</span></div>
                      <div style={{ fontSize:12, color:'#f59e0b', fontWeight:600 }}>{detalleTurnoDescubierto(t)}</div>
                    </div>
                  </div>
                </div>
              )
            })}

            {pendientesAlertas.map((r: any) => {
          const tipo = tipoAlerta(r)
          const cfg = CONFIG_ALERTA[tipo]
          const obj = r.turno?.objetivo_id ? getObjetivo(r.turno.objetivo_id) : '—'
          return (
            <div key={r.id} style={{ background:cfg.bg, border:`1px solid ${cfg.border}`, borderRadius:12, padding:20, marginBottom:14 }}>
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:14 }}>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                    <span style={{ fontSize:16 }}>{cfg.icon}</span>
                    <span style={{ fontFamily:'Syne,sans-serif', fontSize:15, fontWeight:700, color:cfg.color }}>{cfg.label}</span>
                  </div>
                  <div style={{ fontFamily:'Syne,sans-serif', fontSize:16, fontWeight:700, color:'#e2e8f0' }}>{obj}</div>
                  <div style={{ fontSize:13, color:'#64748b', marginTop:2 }}>{formatFecha(fechaRegistroAsistencia(r, r.turno))} · {r.turno?.hora_inicio} → {r.turno?.hora_fin}</div>
                </div>
                <Badge type="pendiente">Pendiente</Badge>
              </div>

              <div style={{ background:'#111827', borderRadius:8, padding:'10px 14px', marginBottom:14 }}>
                <div style={{ fontSize:11, color:'#64748b', marginBottom:3, textTransform:'uppercase' as const, letterSpacing:1 }}>Guardia</div>
                <div style={{ fontSize:13, color:'#e2e8f0' }}>{getNombre(r.guardia_id)}</div>
                <div style={{ display:'flex', gap:20, marginTop:8, flexWrap:'wrap' }}>
                  {r.hora_entrada_real && <div style={{ fontSize:12, color:'#94a3b8' }}>Entrada: <span style={{ color: r.alerta_entrada === 'tarde' ? '#ef4444' : '#e2e8f0', fontWeight:600 }}>{r.hora_entrada_real}</span></div>}
                  {r.hora_salida_real && <div style={{ fontSize:12, color:'#94a3b8' }}>Salida: <span style={{ color: r.alerta_salida ? cfg.color : '#e2e8f0', fontWeight:600 }}>{r.hora_salida_real}</span></div>}
                  {r.horas_trabajadas > 0 && <div style={{ fontSize:12, color:'#94a3b8' }}>Horas: <span style={{ color:'#e2e8f0', fontWeight:600 }}>{formatHoras(r.horas_trabajadas)}</span></div>}
                </div>
              </div>

              {r.observacion && (
                <div style={{ background:'rgba(59,130,246,.08)', border:'1px solid rgba(59,130,246,.2)', borderRadius:8, padding:'10px 14px', marginBottom:14 }}>
                  <div style={{ fontSize:11, color:'#60a5fa', marginBottom:3, fontWeight:600 }}>OBSERVACIÓN DEL GUARDIA</div>
                  <div style={{ fontSize:13, color:'#cbd5e1' }}>{r.observacion}</div>
                </div>
              )}

              <button style={{ ...S.btn, ...S.btnSecondary, width:'100%', justifyContent:'center' }} onClick={() => abrirModal(r, 'alerta')}>Revisar y resolver</button>
            </div>
          )
            })}
          </>
        )
      )}

      {modalItem && modalTipo && (
        <Modal
          title={modalTipo === 'cobertura' ? 'Resolver cobertura urgente' : 'Resolver alerta de asistencia'}
          onClose={() => { setModalItem(null); setModalTipo(null); setObsSupervisor('') }}
          footer={
            <div style={{ display:'flex', gap:10, width:'100%' }}>
              <button style={{ ...S.btn, flex:1, justifyContent:'center', background:'rgba(239,68,68,.15)', color:'#ef4444', border:'1px solid rgba(239,68,68,.3)' }} onClick={() => resolver('rechazado')} disabled={loading}>{loading ? '...' : '✕ Rechazar'}</button>
              <button style={{ ...S.btn, flex:1, justifyContent:'center', background:'rgba(16,185,129,.15)', color:'#10b981', border:'1px solid rgba(16,185,129,.3)' }} onClick={() => resolver('aprobado')} disabled={loading}>{loading ? '...' : '✓ Aprobar'}</button>
            </div>
          }>
          <div style={{ marginBottom:16, padding:12, background:'#1a2235', borderRadius:8 }}>
            {modalTipo === 'cobertura' ? (
              <>
                <div style={{ fontSize:13, color:'#94a3b8' }}>Cobertura en</div>
                <div style={{ fontSize:15, fontWeight:600, color:'#e2e8f0', marginTop:2 }}>{getObjetivo(modalItem.objetivo_id)}</div>
                <div style={{ fontSize:13, color:'#f59e0b', fontFamily:'Syne,sans-serif', fontWeight:600, marginTop:4 }}>{modalItem.fecha} · {modalItem.hora_inicio} → {modalItem.hora_fin}</div>
                <div style={{ display:'flex', gap:16, marginTop:10, flexWrap:'wrap' }}>
                  <div style={{ fontSize:12, color:'#94a3b8' }}>Original: <span style={{ color:'#e2e8f0' }}>{getNombre(modalItem.guardia_original_id)}</span></div>
                  <div style={{ fontSize:12, color:'#94a3b8' }}>Cubrió: <span style={{ color:'#f59e0b' }}>{getNombre(modalItem.guardia_real_id)}</span></div>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize:13, color:'#94a3b8' }}>Alerta de</div>
                <div style={{ fontSize:15, fontWeight:600, color:'#e2e8f0', marginTop:2 }}>{getNombre(modalItem.guardia_id)}</div>
                <div style={{ fontSize:13, color:'#f59e0b', fontFamily:'Syne,sans-serif', fontWeight:600, marginTop:4 }}>{formatFecha(fechaRegistroAsistencia(modalItem, modalItem.turno))} · Entrada: {modalItem.hora_entrada_real} · Salida: {modalItem.hora_salida_real || '—'}</div>
              </>
            )}
          </div>

          <div>
            <label style={S.label}>Observación del supervisor (opcional)</label>
            <textarea style={{ ...S.input, resize:'vertical' as const, minHeight:80 }} value={obsSupervisor} onChange={e => setObsSupervisor(e.target.value)} placeholder="Motivo de aprobación o rechazo..." />
          </div>
        </Modal>
      )}
    </div>
  )
}

function RevisionOperativa({ guardias, objetivos, turnos, registros, setTurnos, user }: any) {
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
  const [loadingData, setLoadingData] = useState(true)
  const [tab, setTab] = useState<'pendientes' | 'intervenidas'>('pendientes')
  const [accionActiva, setAccionActiva] = useState<{ alerta: AlertaOperativaAdmin, accion: AccionIntervencionAdmin } | null>(null)
  const [formIntervencion, setFormIntervencion] = useState({ guardia_id:'', comentario:'', motivo:'' })
  const [loadingAccion, setLoadingAccion] = useState('')
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')

  const hoy = fechaActualTurno()
  const ahora = new Date()
  const usuarios = guardias as Usuario[]
  const guardiasActivos = usuarios.filter((g: Usuario) => esRolGuardia(g.rol) && g.estado === 'activo')
  const turnosHoy = (turnos as Turno[]).filter((t: Turno) => t.fecha === hoy)

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

  const fechaHoraTexto = (value?: string | null) => value
    ? new Date(value).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
    : '—'

  const getRegistrosTurno = (turnoId: string) => registros
    .filter((r: RegistroAsistencia) => r.turno_id === turnoId)
    .sort((a: RegistroAsistencia, b: RegistroAsistencia) => ordenRegistroAsistencia(b, turnos.find((t: Turno) => t.id === b.turno_id)) - ordenRegistroAsistencia(a, turnos.find((t: Turno) => t.id === a.turno_id)))

  const getRegistro = (turno: Turno) => getRegistrosTurno(turno.id)[0]
  const existeAsistencia = (turno: Turno) => getRegistrosTurno(turno.id).length > 0
  const tieneEntrada = (turno: Turno) => getRegistrosTurno(turno.id).some((r: RegistroAsistencia) => r.hora_entrada_real)
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

  const supervisorGuardiaAsignado = (turno: Turno) =>
    supervisoresGuardia.find((asignacion: any) =>
      asignacion.estado !== 'inactivo' &&
      asignacion.rol_operativo === 'supervisor' &&
      (asignacion.zona || ZONA_OPERATIVA_ADMIN) === ZONA_OPERATIVA_ADMIN &&
      fechaHoraEnRangoAdmin(
        turno.fecha,
        turno.hora_inicio,
        asignacion.fecha?.slice(0, 10),
        asignacion.hora_inicio,
        asignacion.hora_fin,
      )
    ) || null

  const accionNormalizada = (accion?: string | null) =>
    accion === 'marcado_cubierto_manual' ? 'confirmar_cubierto' : accion || ''

  const accionResuelveAlerta = (accion?: string | null) =>
    ['confirmar_cubierto', 'reasignacion', 'marcado_descubierto', 'alerta_revisada'].includes(accionNormalizada(accion))

  const intervencionesAlerta = (turnoId: string, tipo?: TipoAlertaOperativaAdmin) =>
    intervenciones
      .filter((i: any) => i.turno_id === turnoId && (!tipo || i.tipo_alerta === tipo))
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  const alertaIntervenida = (turnoId: string, tipo: TipoAlertaOperativaAdmin) =>
    intervencionesAlerta(turnoId, tipo).some((i: any) => accionResuelveAlerta(i.accion))

  const turnoTieneIntervencionResolutiva = (turnoId: string) =>
    intervencionesAlerta(turnoId).some((i: any) => accionResuelveAlerta(i.accion))

  const alertaPendiente = (alerta: AlertaOperativaAdmin) =>
    alerta.tipo === 'descubierto'
      ? !turnoTieneIntervencionResolutiva(alerta.turno.id)
      : !alertaIntervenida(alerta.turno.id, alerta.tipo)

  const accionLabel = (accion: string) => {
    const labels: Record<string, string> = {
      comentario: 'Comentario',
      reasignacion: 'Reasignación',
      marcado_descubierto: 'Marcado descubierto',
      confirmar_cubierto: 'Confirmar cubierto',
      marcado_cubierto_manual: 'Confirmar cubierto',
      alerta_revisada: 'Alerta revisada',
    }
    return labels[accion] || accion
  }

  const cargarIntervenciones = async () => {
    setLoadingData(true)
    setError('')

    const turnoIds = (turnos as Turno[]).map((t: Turno) => t.id)
    const intervencionesQuery = turnoIds.length > 0
      ? supabase
        .from('supervisor_intervenciones')
        .select('*')
        .in('turno_id', turnoIds)
        .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null } as any)

    const [{ data: intervencionesData, error: intervencionesError }, { data: guardiasSupervisorData, error: guardiasSupervisorError }] = await Promise.all([
      intervencionesQuery,
      supabase
        .from('supervisores_guardia')
        .select('*')
        .order('fecha', { ascending: false })
        .order('hora_inicio', { ascending: true }),
    ])

    if (intervencionesError) setError(intervencionesError.message)
    else setIntervenciones(intervencionesData || [])

    if (guardiasSupervisorError && !/supervisores_guardia|schema cache|does not exist/i.test(guardiasSupervisorError.message)) {
      setError(guardiasSupervisorError.message)
    } else {
      setSupervisoresGuardia(guardiasSupervisorData || [])
    }

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

  const alertasPendientes = [
    ...turnosHoy
      .filter((t: Turno) => turnoSinCoberturaOperativa(t, existeAsistencia(t)))
      .map((t: Turno) => alertaBase(t, 'descubierto', 'Puesto sin cobertura', !t.guardia_id ? 'Sin guardia asignado' : 'Pasó la ventana de fichaje sin asistencia', 'danger')),
    ...turnosHoy
      .filter((t: Turno) => t.guardia_id && t.estado !== 'descubierto' && !tieneEntrada(t) && minutosDesdeInicioTurno(t) >= 15)
      .map((t: Turno) => alertaBase(t, 'sin_fichar', 'Guardia sin fichar', `Demora: ${minutosDesdeInicioTurno(t)} minutos desde el inicio`, 'warn')),
    ...registros
      .filter((r: RegistroAsistencia) => {
        const turno = turnosHoy.find((t: Turno) => t.id === r.turno_id)
        return turno && r.hora_entrada_real && (r.alerta_entrada === 'tarde' || minutosTardeAsistencia(turno, r) > 0)
      })
      .map((r: RegistroAsistencia) => {
        const turno = turnosHoy.find((t: Turno) => t.id === r.turno_id) as Turno
        return alertaBase(turno, 'tardanza', 'Tardanza registrada', `Llegó ${minutosTardeAsistencia(turno, r)} minutos tarde`, 'warn', r)
      }),
    ...registros
      .filter((r: RegistroAsistencia) => turnosHoy.some((t: Turno) => t.id === r.turno_id) && r.gps_ingreso_estado === 'fuera_radio')
      .map((r: RegistroAsistencia) => {
        const turno = turnosHoy.find((t: Turno) => t.id === r.turno_id) as Turno
        return alertaBase(turno, 'fuera_radio', 'Fichaje fuera de radio', `Distancia: ${metrosGpsTexto(r.distancia_ingreso_metros)}`, 'danger', r)
      }),
    ...turnosHoy
      .filter((t: Turno) => t.guardia_id && tieneEntrada(t) && !tieneSalida(t) && finTurnoMasToleranciaPaso(t))
      .map((t: Turno) => alertaBase(t, 'salida_pendiente', 'Salida pendiente', 'Tiene entrada registrada y no tiene salida luego del fin del turno', 'info', getRegistro(t))),
  ]
    .filter(alertaPendiente)
    .sort((a, b) => {
      const fechaA = fechaHoraTurnoLocal(a.turno.fecha, a.turno.hora_inicio)?.getTime() || 0
      const fechaB = fechaHoraTurnoLocal(b.turno.fecha, b.turno.hora_inicio)?.getTime() || 0
      return fechaB - fechaA
    })

  const alertasIntervenidas = intervenciones
    .filter((i: any) => accionResuelveAlerta(i.accion))
    .map((i: any) => {
      const turno = turnosHoy.find((t: Turno) => t.id === i.turno_id)
      if (!turno) return null
      return {
        turno,
        tipo: i.tipo_alerta as TipoAlertaOperativaAdmin,
        intervencion: i,
      }
    })
    .filter(Boolean)
    .reduce((mapa: Map<string, any>, item: any) => {
      const key = `${item.turno.id}-${item.tipo}`
      const actual = mapa.get(key)
      if (!actual || new Date(item.intervencion.created_at).getTime() > new Date(actual.intervencion.created_at).getTime()) {
        mapa.set(key, item)
      }
      return mapa
    }, new Map<string, any>())

  const intervenidasOrdenadas = Array.from(alertasIntervenidas.values())
    .sort((a: any, b: any) => new Date(b.intervencion.created_at).getTime() - new Date(a.intervencion.created_at).getTime())

  const abrirAccion = (alerta: AlertaOperativaAdmin, accion: AccionIntervencionAdmin) => {
    setError('')
    setMensaje('')
    setAccionActiva({ alerta, accion })
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
  }

  const guardiaTieneTurnoSuperpuesto = async (turno: Turno, guardiaId: string) => {
    const { data, error: turnosError } = await supabase
      .from('turnos')
      .select('id, guardia_id, fecha, hora_inicio, hora_fin')
      .eq('guardia_id', guardiaId)
      .in('fecha', fechasVecinasTurno(turno.fecha))

    if (turnosError) throw turnosError

    return tieneTurnoSuperpuesto(data || [], {
      guardia_id: guardiaId,
      fecha: turno.fecha,
      hora_inicio: turno.hora_inicio,
      hora_fin: turno.hora_fin,
    }, turno.id)
  }

  const registrarIntervencion = async (alerta: AlertaOperativaAdmin, payload: any) => {
    if (!user?.id) throw new Error('Sesión de administrador no disponible.')

    const asignacion = supervisorGuardiaAsignado(alerta.turno)
    const insertPayload = {
      ...payload,
      turno_id: alerta.turno.id,
      registro_asistencia_id: alerta.registro?.id || null,
      tipo_alerta: alerta.tipo,
      supervisor_id: user.id,
      supervisor_intervino_id: user.id,
      supervisor_asignado_id: asignacion?.supervisor_id || null,
      supervisor_guardia_id: asignacion?.id || null,
      jefe_operativo: JEFE_OPERATIVO_ADMIN,
      director_tecnico: DIRECTOR_TECNICO_ADMIN,
      zona: ZONA_OPERATIVA_ADMIN,
    }

    const { data, error: insertError } = await supabase
      .from('supervisor_intervenciones')
      .insert(insertPayload)
      .select()
      .maybeSingle()

    if (insertError) throw insertError

    const intervencion = data || {
      ...insertPayload,
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `local-${Date.now()}`,
      created_at: new Date().toISOString(),
    }

    setIntervenciones(prev => [intervencion, ...prev])
  }

  const ejecutarAccion = async () => {
    if (!accionActiva) return

    const { alerta, accion } = accionActiva
    const turno = alerta.turno
    const comentario = formIntervencion.comentario.trim()
    const motivo = formIntervencion.motivo.trim()

    if (accion === 'comentario' && !comentario) {
      setError('Agregá un comentario para guardar la intervención.')
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

    const loadingKey = `${alerta.key}-${accion}`
    setLoadingAccion(loadingKey)
    setError('')
    setMensaje('')

    try {
      const estadoAnterior = turno.estado
      let estadoNuevo: string | null = turno.estado
      let guardiaAnteriorId: string | null = turno.guardia_id || null
      let guardiaNuevoId: string | null = turno.guardia_id || null

      if (accion === 'reasignacion') {
        guardiaNuevoId = formIntervencion.guardia_id
        const conflicto = await guardiaTieneTurnoSuperpuesto(turno, guardiaNuevoId)
        if (conflicto) throw new Error(MENSAJE_TURNO_SUPERPUESTO)

        estadoNuevo = turno.estado === 'descubierto' ? 'programado' : turno.estado
        const payload = {
          guardia_id: guardiaNuevoId,
          guardia_original_id: (turno as any).guardia_original_id || turno.guardia_id || guardiaNuevoId,
          estado: estadoNuevo,
        }
        const { error: updateError } = await supabase.from('turnos').update(payload).eq('id', turno.id)
        if (updateError) throw updateError
        setTurnos((prev: Turno[]) => prev.map(t => t.id === turno.id ? { ...t, ...payload } as Turno : t))
      }

      if (accion === 'marcado_descubierto') {
        guardiaNuevoId = null
        estadoNuevo = 'descubierto'
        const payload: any = { guardia_id: null, estado: 'descubierto' }
        if (!(turno as any).guardia_original_id && turno.guardia_id) payload.guardia_original_id = turno.guardia_id
        const { error: updateError } = await supabase.from('turnos').update(payload).eq('id', turno.id)
        if (updateError) throw updateError
        setTurnos((prev: Turno[]) => prev.map(t => t.id === turno.id ? { ...t, ...payload } as Turno : t))
      }

      if (accion === 'confirmar_cubierto') {
        estadoNuevo = 'cubierto'
        const payload = { estado: 'cubierto' }
        const { error: updateError } = await supabase.from('turnos').update(payload).eq('id', turno.id)
        if (updateError) throw updateError
        setTurnos((prev: Turno[]) => prev.map(t => t.id === turno.id ? { ...t, ...payload } as Turno : t))
      }

      await registrarIntervencion(alerta, {
        accion,
        comentario: comentario || null,
        motivo: motivo || (accion === 'confirmar_cubierto' ? 'Entrada confirmada por admin' : null),
        guardia_anterior_id: guardiaAnteriorId,
        guardia_nuevo_id: guardiaNuevoId,
        estado_anterior: estadoAnterior,
        estado_nuevo: estadoNuevo,
      })

      setMensaje('Intervención registrada')
      cerrarAccion()
      setTab(accion === 'comentario' ? 'pendientes' : 'intervenidas')
    } catch (actionError) {
      const message = actionError instanceof Error
        ? actionError.message
        : typeof actionError === 'object' && actionError && 'message' in actionError
          ? String((actionError as { message: unknown }).message)
          : 'Error al registrar intervención.'
      setError(`No se pudo guardar la intervención: ${message}`)
    } finally {
      setLoadingAccion('')
    }
  }

  const renderHistorial = (alerta: AlertaOperativaAdmin) => {
    const items = intervencionesAlerta(alerta.turno.id, alerta.tipo)

    return (
      <div style={{ background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, padding:12, marginTop:12 }}>
        {items.length === 0 ? (
          <div style={{ fontSize:12, color:'#f59e0b' }}>Aún no hay intervenciones guardadas.</div>
        ) : items.slice(0, 4).map((item: any) => (
          <div key={item.id} style={{ borderTop:'1px solid rgba(148,163,184,.16)', paddingTop:8, marginTop:8, fontSize:12, color:'#cbd5e1' }}>
            <div>Acción: <strong>{accionLabel(item.accion)}</strong></div>
            <div>Intervino: {nombreUsuario(item.supervisor_intervino_id || item.supervisor_id)}</div>
            {item.comentario && <div>Comentario: {item.comentario}</div>}
            <div>Fecha/hora: {fechaHoraTexto(item.created_at)}</div>
          </div>
        ))}
      </div>
    )
  }

  const renderContexto = (alerta: AlertaOperativaAdmin) => {
    const asignacion = supervisorGuardiaAsignado(alerta.turno)
    const ultima = intervencionesAlerta(alerta.turno.id, alerta.tipo)[0]
    const guardiaEsperadoId = (alerta.turno as any).guardia_original_id || alerta.turno.guardia_id
    const guardiaRealId = alerta.registro?.guardia_id || alerta.turno.guardia_id

    return (
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(190px, 1fr))', gap:10, background:'#111827', border:'1px solid #1e2d42', borderRadius:8, padding:12, marginTop:12 }}>
        <div><div style={S.label}>Guardia esperado</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{nombreUsuario(guardiaEsperadoId)}</div></div>
        <div><div style={S.label}>Guardia registrado</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{nombreUsuario(guardiaRealId)}</div></div>
        <div><div style={S.label}>Supervisor asignado</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{asignacion?.supervisor_id ? nombreUsuario(asignacion.supervisor_id) : 'Sin supervisor asignado'}</div></div>
        <div><div style={S.label}>Jefe operativo</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{ultima?.jefe_operativo || JEFE_OPERATIVO_ADMIN}</div></div>
        <div><div style={S.label}>Director técnico</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{ultima?.director_tecnico || DIRECTOR_TECNICO_ADMIN}</div></div>
        <div><div style={S.label}>Última acción</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{ultima ? accionLabel(ultima.accion) : 'Pendiente'}</div></div>
        <div style={{ gridColumn:'1 / -1' }}><div style={S.label}>Comentario</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{ultima?.comentario || asignacion?.observacion || '—'}</div></div>
      </div>
    )
  }

  const renderPanelAccion = (alerta: AlertaOperativaAdmin) => {
    if (!accionActiva || accionActiva.alerta.key !== alerta.key) return null

    const requiereGuardia = accionActiva.accion === 'reasignacion'
    const requiereMotivo = accionActiva.accion === 'confirmar_cubierto'
    const loadingKey = `${alerta.key}-${accionActiva.accion}`

    return (
      <div style={{ background:'#0f172a', border:'1px solid #334155', borderRadius:8, padding:14, marginTop:12 }}>
        <div style={{ ...S.label, marginBottom:8 }}>Acción: {accionLabel(accionActiva.accion)}</div>
        {error && <div style={{ background:'rgba(239,68,68,.12)', border:'1px solid rgba(239,68,68,.35)', color:'#fca5a5', borderRadius:8, padding:10, fontSize:13, marginBottom:12 }}>{error}</div>}

        {requiereGuardia && (
          <div style={{ marginBottom:12 }}>
            <label style={S.label}>Nuevo guardia</label>
            <select style={S.select} value={formIntervencion.guardia_id} onChange={e => setFormIntervencion(prev => ({ ...prev, guardia_id:e.target.value }))}>
              <option value="">Seleccionar guardia</option>
              {guardiasActivos.map((g: Usuario) => <option key={g.id} value={g.id}>{g.apellido}, {g.nombre}{g.legajo ? ` - ${g.legajo}` : ''}</option>)}
            </select>
          </div>
        )}

        {requiereMotivo && (
          <div style={{ marginBottom:12 }}>
            <label style={S.label}>Motivo</label>
            <input style={S.input} value={formIntervencion.motivo} onChange={e => setFormIntervencion(prev => ({ ...prev, motivo:e.target.value }))} />
          </div>
        )}

        <div style={{ marginBottom:12 }}>
          <label style={S.label}>{accionActiva.accion === 'comentario' ? 'Comentario *' : 'Comentario'}</label>
          <textarea
            style={{ ...S.input, minHeight:80, resize:'vertical' as const }}
            value={formIntervencion.comentario}
            onChange={e => setFormIntervencion(prev => ({ ...prev, comentario:e.target.value }))}
            placeholder={accionActiva.accion === 'confirmar_cubierto' ? 'Ej.: llegó' : 'Detalle de la intervención'}
          />
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <button type="button" style={{ ...S.btn, ...S.btnSecondary, justifyContent:'center' }} onClick={cerrarAccion}>Cancelar</button>
          <button type="button" style={{ ...S.btn, ...S.btnPrimary, justifyContent:'center' }} onClick={ejecutarAccion} disabled={loadingAccion === loadingKey}>
            {loadingAccion === loadingKey ? 'Guardando...' : 'Guardar'}
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

  const renderAlertaPendiente = (alerta: AlertaOperativaAdmin) => (
    <div key={alerta.key} style={alertaStyle(alerta.tono)}>
      <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'flex-start' }}>
        <div>
          <div style={{ fontFamily:'Syne,sans-serif', fontSize:16, fontWeight:800, color:'#e2e8f0' }}>{alerta.titulo}</div>
          <div style={{ fontSize:13, color:'#94a3b8', marginTop:4 }}>{nombreObjetivo(alerta.turno.objetivo_id)} · {formatFecha(alerta.turno.fecha)} · {hora(alerta.turno.hora_inicio)} a {hora(alerta.turno.hora_fin)}</div>
          <div style={{ fontSize:13, color:'#f59e0b', marginTop:4 }}>{alerta.detalle}</div>
          {alerta.registro?.hora_entrada_real && <div style={{ fontSize:12, color:'#cbd5e1', marginTop:4 }}>Entrada real: {hora(alerta.registro.hora_entrada_real)}</div>}
        </div>
        <Badge type="pendiente">Pendiente</Badge>
      </div>

      {renderContexto(alerta)}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:8, marginTop:12 }}>
        <button type="button" style={{ ...S.btn, ...S.btnSecondary, justifyContent:'center' }} onClick={() => abrirAccion(alerta, 'confirmar_cubierto')}>Confirmar cubierto</button>
        <button type="button" style={{ ...S.btn, ...S.btnSecondary, justifyContent:'center' }} onClick={() => abrirAccion(alerta, 'reasignacion')}>Reasignar</button>
        <button type="button" style={{ ...S.btn, justifyContent:'center', background:'rgba(239,68,68,.15)', color:'#ef4444', border:'1px solid rgba(239,68,68,.35)' }} onClick={() => abrirAccion(alerta, 'marcado_descubierto')}>Marcar descubierto</button>
        <button type="button" style={{ ...S.btn, ...S.btnSecondary, justifyContent:'center' }} onClick={() => abrirAccion(alerta, 'comentario')}>Comentar</button>
      </div>

      {renderPanelAccion(alerta)}
      {renderHistorial(alerta)}
    </div>
  )

  const renderIntervenida = (item: any) => {
    const turno = item.turno as Turno
    const intervencion = item.intervencion
    const asignacion = supervisorGuardiaAsignado(turno)

    return (
      <div key={`${turno.id}-${item.tipo}`} style={{ background:'rgba(16,185,129,.07)', border:'1px solid rgba(16,185,129,.25)', borderRadius:12, padding:18, marginBottom:14 }}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'flex-start' }}>
          <div>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:16, fontWeight:800, color:'#e2e8f0' }}>{nombreObjetivo(turno.objetivo_id)}</div>
            <div style={{ fontSize:13, color:'#94a3b8', marginTop:4 }}>{formatFecha(turno.fecha)} · {hora(turno.hora_inicio)} a {hora(turno.hora_fin)}</div>
          </div>
          <Badge type="resuelta">Intervenida</Badge>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(190px, 1fr))', gap:10, background:'#111827', border:'1px solid #1e2d42', borderRadius:8, padding:12, marginTop:12 }}>
          <div><div style={S.label}>Acción realizada</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{accionLabel(intervencion.accion)}</div></div>
          <div><div style={S.label}>Supervisor/admin que intervino</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{nombreUsuario(intervencion.supervisor_intervino_id || intervencion.supervisor_id)}</div></div>
          <div><div style={S.label}>Supervisor asignado</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{intervencion.supervisor_asignado_id ? nombreUsuario(intervencion.supervisor_asignado_id) : asignacion?.supervisor_id ? nombreUsuario(asignacion.supervisor_id) : 'Sin supervisor asignado'}</div></div>
          <div><div style={S.label}>Fecha/hora</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{fechaHoraTexto(intervencion.created_at)}</div></div>
          <div><div style={S.label}>Estado</div><div style={{ fontSize:13, color:'#10b981' }}>Intervenida</div></div>
          <div style={{ gridColumn:'1 / -1' }}><div style={S.label}>Comentario</div><div style={{ fontSize:13, color:'#e2e8f0' }}>{intervencion.comentario || '—'}</div></div>
        </div>
      </div>
    )
  }

  const gruposPendientes = [
    { tipo:'descubierto', titulo:'Puestos sin cobertura' },
    { tipo:'sin_fichar', titulo:'Guardias sin fichar' },
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

      <div style={{ display:'flex', gap:4, background:'#1a2235', borderRadius:10, padding:4, marginBottom:24, width:'fit-content' }}>
        <button style={tabStyle(tab === 'pendientes')} onClick={() => setTab('pendientes')}>
          Alertas pendientes
          {alertasPendientes.length > 0 && <span style={{ marginLeft:6, background:'rgba(239,68,68,.15)', color:'#ef4444', borderRadius:10, padding:'1px 7px', fontSize:11 }}>{alertasPendientes.length}</span>}
        </button>
        <button style={tabStyle(tab === 'intervenidas')} onClick={() => setTab('intervenidas')}>
          Alertas intervenidas
          {intervenidasOrdenadas.length > 0 && <span style={{ marginLeft:6, background:'rgba(16,185,129,.18)', color:'#10b981', borderRadius:10, padding:'1px 7px', fontSize:11 }}>{intervenidasOrdenadas.length}</span>}
        </button>
      </div>

      {loadingData && <div style={{ textAlign:'center', padding:48, color:'#64748b' }}>Cargando intervenciones...</div>}

      {!loadingData && tab === 'pendientes' && (
        alertasPendientes.length === 0 ? (
          <div style={{ ...S.card, textAlign:'center', padding:48, color:'#64748b' }}>
            <div style={{ fontSize:36, marginBottom:12 }}>✓</div>
            <div>No hay alertas operativas pendientes</div>
          </div>
        ) : gruposPendientes.map(grupo => {
          const items = alertasPendientes.filter(alerta => alerta.tipo === grupo.tipo)
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
  const [loading, setLoading] = useState(true)
  const [filtros, setFiltros] = useState<Record<string, any>>({})

  const cargarDatos = useCallback(async () => {
    setLoading(true)
    const [g, o, t, r, n] = await Promise.all([
      supabase.from('usuarios').select('*').order('apellido'),
      supabase.from('objetivos').select('*').order('nombre'),
      supabase.from('turnos').select('*').order('fecha', { ascending: false }),
      supabase.from('registros_asistencia').select('*').order('created_at', { ascending: false }),
      supabase.from('novedades').select('*').order('created_at', { ascending: false }),
    ])
    if (g.data) setGuardias(g.data)
    if (o.data) setObjetivos(o.data)
    if (t.data) setTurnos(t.data)
    if (r.data) setRegistros(r.data)
    if (n.data) setNovedades(n.data)
    setLoading(false)
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

      setUser(perfil)
      cargarDatos()
    })
  }, [cargarDatos])

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

if (!user) return <Login onLogin={u => { setUser(u); cargarDatos() }} />

if (esRolGuardia(user.rol)) {
  return <GuardiaMobile user={user} />
}

if (user.rol === 'supervisor') {
  return <SupervisorMobile user={user} />
}

const esGuardia = esRolGuardia(user.rol)

  const NAV = esGuardia ? [
    { section:'Mi turno', items:[
      { id:'asistencia', icon:'✅', label:'Mi Asistencia' },
      { id:'novedades', icon:'📋', label:'Mis Novedades' },
    ]}
  ] : [
    { section:'General', items:[{ id:'dashboard', icon:'📊', label:'Panel Principal' }] },
    { section:'Operaciones', items:[
      { id:'guardias', icon:'👮', label:'Guardias' },
      { id:'objetivos', icon:'🏢', label:'Objetivos' },
      { id:'turnos', icon:'📅', label:'Turnos' },
      { id:'asistencia', icon:'✅', label:'Asistencia' },
      { id:'turnos_base', icon:'🧱', label:'Turnos Base' },
    ]},
    { section:'Administración', items:[
      { id:'servicios_objetivo', icon:'🏢', label:'Servicios Objetivo' },
      { id:'supervisores_guardia', icon:'🧭', label:'Supervisores de Guardia' },
      { id:'revision_operativa', icon:'🛂', label:'Revisión Operativa' },
    { id:'novedades', icon:'📋', label:'Novedades' },
      { id:'reportes', icon:'📈', label:'Reportes' },
    ]},
  ]

  const novedadesUrgentes = novedades.filter(n => n.prioridad === 'urgente' && n.estado !== 'resuelta').length
  const misNovedades = novedades.filter(n => n.guardia_id === user.id)
  const misTurnos = turnos.filter(t => t.guardia_id === user.id)

  return (
    <div style={S.app}>
      <div style={S.sidebar}>
        <div style={S.sidebarLogo}>
          <div style={{ fontSize:24, marginBottom:6 }}>🛡️</div>
          <div style={S.brand}>MERCOSUR</div>
          <div style={S.sub}>Control Operativo</div>
        </div>
        <nav style={{ flex:1, padding:'16px 0', overflowY:'auto' }}>
          {NAV.map(sec => (
            <div key={sec.section}>
              <div style={S.navSection}>{sec.section}</div>
              {sec.items.map(item => <NavItem key={item.id} {...item} active={page === item.id} badge={item.id === 'novedades' ? novedadesUrgentes : 0} onClick={setPage} />)}
            </div>
          ))}
        </nav>
        <div style={{ padding:'16px 20px', borderTop:'1px solid #1e2d42' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:32, height:32, borderRadius:'50%', background:'#f59e0b', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Syne,sans-serif', fontWeight:700, fontSize:13, color:'#000' }}>{user.nombre?.[0]}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:500 }}>{user.nombre}</div>
              <div style={{ fontSize:11, color:'#64748b' }}>{user.rol}</div>
            </div>
            <button style={{ background:'none', border:'none', color:'#64748b', cursor:'pointer', fontSize:16 }} onClick={async () => { await supabase.auth.signOut(); setUser(null) }} title="Cerrar sesión">⏏</button>
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
              {page === 'guardias' && <Guardias guardias={guardias} setGuardias={setGuardias} filtroActivo={filtros.guardias} limpiarFiltro={() => limpiarFiltro('guardias')} />}
              {page === 'objetivos' && <Objetivos objetivos={objetivos} setObjetivos={setObjetivos} turnos={turnos} filtroActivo={filtros.objetivos} limpiarFiltro={() => limpiarFiltro('objetivos')} />}
              {page === 'turnos' && <Turnos turnos={turnos} setTurnos={setTurnos} guardias={guardias} objetivos={objetivos} registros={registros} filtroActivo={filtros.turnos} limpiarFiltro={() => limpiarFiltro('turnos')} />}
              {page === 'asistencia' && <Asistencia registros={registros} setRegistros={setRegistros} turnos={turnos} guardias={guardias} objetivos={objetivos} filtroActivo={filtros.asistencia} limpiarFiltro={() => limpiarFiltro('asistencia')} />}
              {page === 'servicios_objetivo' && <ServiciosObjetivo guardias={guardias} objetivos={objetivos} />}
              {page === 'supervisores_guardia' && <SupervisoresGuardia guardias={guardias} user={user} />}
              {page === 'revision_operativa' && <RevisionOperativa guardias={guardias} objetivos={objetivos} turnos={turnos} registros={registros} setTurnos={setTurnos} user={user} />}
              {page === 'novedades' && <Novedades novedades={novedades} setNovedades={setNovedades} guardias={guardias} objetivos={objetivos} />}
              {page === 'reportes' && <Reportes registros={registros} turnos={turnos} guardias={guardias} objetivos={objetivos} novedades={novedades} filtroActivo={filtros.reportes} limpiarFiltro={() => limpiarFiltro('reportes')} />}
              {page === 'turnos_base' && <TurnosBase />}
            </>
          )
        )}
      </main>
    </div>
  )
}
