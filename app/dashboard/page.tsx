'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import { supabase, formatHoras, calcAlertaEntrada, calcAlertaSalida, calcHorasTrabajadas, calcDistancia } from '@/lib/supabase'
import type { Usuario, Objetivo, Turno, RegistroAsistencia, Novedad } from '@/lib/supabase'

// ── ESTILOS INLINE (misma estética del prototipo) ─────────────────────────────
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

function StatCard({ label, value, sub, color, icon }: any) {
  return (
    <div style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:12, padding:20, position:'relative', overflow:'hidden' }}>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:color }} />
      <div style={{ position:'absolute', top:16, right:16, fontSize:28, opacity:0.15 }}>{icon}</div>
      <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:1, fontWeight:600 }}>{label}</div>
      <div style={{ fontFamily:'Syne,sans-serif', fontSize:36, fontWeight:800, margin:'8px 0 4px' }}>{value}</div>
      <div style={{ fontSize:12, color:'#64748b' }}>{sub}</div>
    </div>
  )
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

// ── LOGIN ─────────────────────────────────────────────────────────────────────
function Login({ onLogin }: { onLogin: (u: any) => void }) {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const login = async () => {
    setLoading(true); setError('')
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password: pass })
    if (err) { setError('Email o contraseña incorrectos'); setLoading(false); return }
    // Obtener perfil del usuario
    const { data: perfil } = await supabase.from('usuarios').select('*').eq('auth_user_id', data.user.id).single()
    onLogin(perfil || { email, rol: 'admin', nombre: 'Admin', apellido: '' })
    setLoading(false)
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
            <input style={S.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="usuario@mercosur.com" />
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={S.label}>Contraseña</label>
            <input style={S.input} type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} />
          </div>
          {error && <div style={{ color:'#ef4444', fontSize:13, marginBottom:12 }}>{error}</div>}
          <button style={{ ...S.btn, ...S.btnPrimary, width:'100%', justifyContent:'center' }} onClick={login} disabled={loading}>
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function Dashboard({ guardias, objetivos, turnos, registros, novedades }: any) {
  const hoy = new Date().toISOString().split('T')[0]
  const turnosHoy = turnos.filter((t: Turno) => t.fecha === hoy)
  const cubiertos = turnosHoy.filter((t: Turno) => t.estado === 'cubierto').length
  const descubiertos = turnosHoy.filter((t: Turno) => t.estado === 'descubierto').length
  const alertasTarde = registros.filter((r: RegistroAsistencia) => r.alerta_entrada === 'tarde').length
  const novedadesUrgentes = novedades.filter((n: Novedad) => n.prioridad === 'urgente' && n.estado !== 'resuelta')

  return (
    <div>
      <div style={S.title}>Panel Operativo</div>
      <div style={S.sub2}>{new Date().toLocaleDateString('es-AR', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</div>

      {novedadesUrgentes.map((n: Novedad) => {
        const g = guardias.find((x: Usuario) => x.id === n.guardia_id)
        const o = objetivos.find((x: Objetivo) => x.id === n.objetivo_id)
        return (
          <div key={n.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', borderRadius:10, background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)', color:'#fca5a5', marginBottom:12, fontSize:13 }}>
            🚨 <strong>NOVEDAD URGENTE</strong> — {o?.nombre}: {n.descripcion} ({g?.nombre} {g?.apellido})
          </div>
        )
      })}

      <div style={S.statGrid}>
        <StatCard label="Guardias Activos" value={guardias.filter((g: Usuario) => g.estado === 'activo').length} sub={`de ${guardias.length} en total`} color="#10b981" icon="👮" />
        <StatCard label="Objetivos" value={objetivos.filter((o: Objetivo) => o.estado === 'activo').length} sub="activos" color="#3b82f6" icon="🏢" />
        <StatCard label="Turnos Cubiertos" value={cubiertos} sub={`hoy ${hoy}`} color="#10b981" icon="✅" />
        <StatCard label="Sin Cubrir" value={descubiertos} sub="requieren atención" color="#ef4444" icon="⚠️" />
        <StatCard label="Llegadas Tarde" value={alertasTarde} sub="hoy" color="#f59e0b" icon="⏰" />
        <StatCard label="Novedades Pendientes" value={novedades.filter((n: Novedad) => n.estado === 'pendiente').length} sub="sin revisar" color="#8b5cf6" icon="📋" />
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
        <div style={S.card}>
          <div style={{ fontFamily:'Syne,sans-serif', fontSize:15, fontWeight:700, marginBottom:16 }}>📍 Objetivos — Hoy</div>
          <table style={S.table}>
            <thead><tr><th style={S.th}>Objetivo</th><th style={S.th}>Estado</th></tr></thead>
            <tbody>
              {objetivos.map((o: Objetivo) => {
                const ts = turnosHoy.filter((t: Turno) => t.objetivo_id === o.id)
                const sinCubrir = ts.filter((t: Turno) => t.estado === 'descubierto').length
                return (
                  <tr key={o.id}>
                    <td style={S.td}><strong>{o.nombre}</strong><br /><span style={{ fontSize:11, color:'#64748b' }}>{o.cliente}</span></td>
                    <td style={S.td}>{sinCubrir > 0 ? <Badge type="descubierto">⚠ {sinCubrir} sin cubrir</Badge> : ts.length > 0 ? <Badge type="cubierto">✓ Cubierto</Badge> : <span style={{ color:'#64748b', fontSize:12 }}>Sin turnos</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div style={S.card}>
          <div style={{ fontFamily:'Syne,sans-serif', fontSize:15, fontWeight:700, marginBottom:16 }}>👮 Asistencia Reciente</div>
          <table style={S.table}>
            <thead><tr><th style={S.th}>Guardia</th><th style={S.th}>Entrada</th><th style={S.th}>Alerta</th></tr></thead>
            <tbody>
              {registros.slice(-5).reverse().map((r: RegistroAsistencia) => {
                const g = guardias.find((x: Usuario) => x.id === r.guardia_id)
                return (
                  <tr key={r.id}>
                    <td style={S.td}>{g?.nombre} {g?.apellido}</td>
                    <td style={S.td}>{r.hora_entrada_real}</td>
                    <td style={S.td}>{r.alerta_entrada ? <Badge type={r.alerta_entrada}>{r.alerta_entrada === 'tarde' ? '⏰ Tarde' : '⬆ Anticipada'}</Badge> : <Badge type="cubierto">✓ Ok</Badge>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── GUARDIAS ──────────────────────────────────────────────────────────────────
function Guardias({ guardias, setGuardias, registros }: any) {
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ nombre:'', apellido:'', dni:'', telefono:'', legajo:'', estado:'activo', rol:'guardia' })
  const [editId, setEditId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const guardar = async () => {
    setLoading(true)
    if (editId) {
      const { data } = await supabase.from('usuarios').update(form).eq('id', editId).select().single()
      if (data) setGuardias((prev: any[]) => prev.map(g => g.id === editId ? data : g))
    } else {
      const { data } = await supabase.from('usuarios').insert(form).select().single()
      if (data) setGuardias((prev: any[]) => [...prev, data])
    }
    setModal(false); setLoading(false)
  }

  const horasTotal = (gid: string) => registros.filter((r: RegistroAsistencia) => r.guardia_id === gid).reduce((s: number, r: RegistroAsistencia) => s + (r.horas_trabajadas || 0), 0)

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', marginBottom:24 }}>
        <div style={{ flex:1 }}><div style={S.title}>Guardias</div><div style={S.sub2}>{guardias.length} guardias registrados</div></div>
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => { setForm({ nombre:'', apellido:'', dni:'', telefono:'', legajo:'', estado:'activo', rol:'guardia' }); setEditId(null); setModal(true) }}>+ Nuevo Guardia</button>
      </div>
      <div style={S.card}>
        <table style={S.table}>
          <thead><tr><th style={S.th}>Legajo</th><th style={S.th}>Nombre</th><th style={S.th}>DNI</th><th style={S.th}>Teléfono</th><th style={S.th}>Estado</th><th style={S.th}>Hs. Totales</th><th style={S.th}></th></tr></thead>
          <tbody>
            {guardias.map((g: Usuario) => (
              <tr key={g.id}>
                <td style={S.td}><span style={{ fontFamily:'Syne,sans-serif', fontWeight:700, color:'#f59e0b' }}>{g.legajo}</span></td>
                <td style={S.td}><strong>{g.apellido}, {g.nombre}</strong></td>
                <td style={S.td}>{g.dni}</td>
                <td style={S.td}>{g.telefono}</td>
                <td style={S.td}><Badge type={g.estado}>{g.estado}</Badge></td>
                <td style={S.td}>{formatHoras(horasTotal(g.id))}</td>
                <td style={S.td}><button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 12px', fontSize:12 }} onClick={() => { setForm({ nombre:g.nombre, apellido:g.apellido, dni:g.dni||'', telefono:g.telefono||'', legajo:g.legajo, estado:g.estado, rol:g.rol }); setEditId(g.id); setModal(true) }}>✏ Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal && (
        <Modal title={editId ? 'Editar Guardia' : 'Nuevo Guardia'} onClose={() => setModal(false)}
          footer={<><button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => setModal(false)}>Cancelar</button><button style={{ ...S.btn, ...S.btnPrimary }} onClick={guardar} disabled={loading}>{loading ? 'Guardando...' : 'Guardar'}</button></>}>
          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}><label style={S.label}>Nombre</label><input style={S.input} value={form.nombre} onChange={e => setForm({...form, nombre:e.target.value})} /></div>
            <div style={{ marginBottom:16 }}><label style={S.label}>Apellido</label><input style={S.input} value={form.apellido} onChange={e => setForm({...form, apellido:e.target.value})} /></div>
            <div style={{ marginBottom:16 }}><label style={S.label}>DNI</label><input style={S.input} value={form.dni} onChange={e => setForm({...form, dni:e.target.value})} /></div>
            <div style={{ marginBottom:16 }}><label style={S.label}>Teléfono</label><input style={S.input} value={form.telefono} onChange={e => setForm({...form, telefono:e.target.value})} /></div>
            <div style={{ marginBottom:16 }}><label style={S.label}>Legajo</label><input style={S.input} value={form.legajo} onChange={e => setForm({...form, legajo:e.target.value})} /></div>
            <div style={{ marginBottom:16 }}><label style={S.label}>Estado</label><select style={S.select} value={form.estado} onChange={e => setForm({...form, estado:e.target.value})}><option value="activo">Activo</option><option value="inactivo">Inactivo</option></select></div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── OBJETIVOS ─────────────────────────────────────────────────────────────────
function Objetivos({ objetivos, setObjetivos, turnos }: any) {
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ nombre:'', cliente:'', direccion:'', estado:'activo', radio_metros:300 })
  const [editId, setEditId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const hoy = new Date().toISOString().split('T')[0]

  const guardar = async () => {
    setLoading(true)
    if (editId) {
      const { data } = await supabase.from('objetivos').update(form).eq('id', editId).select().single()
      if (data) setObjetivos((prev: any[]) => prev.map(o => o.id === editId ? data : o))
    } else {
      const { data } = await supabase.from('objetivos').insert(form).select().single()
      if (data) setObjetivos((prev: any[]) => [...prev, data])
    }
    setModal(false); setLoading(false)
  }

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', marginBottom:24 }}>
        <div style={{ flex:1 }}><div style={S.title}>Objetivos</div><div style={S.sub2}>{objetivos.length} objetivos registrados</div></div>
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => { setForm({ nombre:'', cliente:'', direccion:'', estado:'activo', radio_metros:300 }); setEditId(null); setModal(true) }}>+ Nuevo Objetivo</button>
      </div>
      <div style={S.card}>
        <table style={S.table}>
          <thead><tr><th style={S.th}>Objetivo</th><th style={S.th}>Cliente</th><th style={S.th}>Dirección</th><th style={S.th}>Estado</th><th style={S.th}>Hoy</th><th style={S.th}></th></tr></thead>
          <tbody>
            {objetivos.map((o: Objetivo) => {
              const ts = turnos.filter((t: Turno) => t.objetivo_id === o.id && t.fecha === hoy)
              const desc = ts.filter((t: Turno) => t.estado === 'descubierto').length
              return (
                <tr key={o.id}>
                  <td style={S.td}><strong>{o.nombre}</strong></td>
                  <td style={S.td}>{o.cliente}</td>
                  <td style={{ ...S.td, fontSize:12, color:'#64748b' }}>{o.direccion}</td>
                  <td style={S.td}><Badge type={o.estado}>{o.estado}</Badge></td>
                  <td style={S.td}>{ts.length > 0 ? desc > 0 ? <Badge type="descubierto">{desc} sin cubrir</Badge> : <Badge type="cubierto">Cubierto</Badge> : <span style={{ color:'#64748b', fontSize:12 }}>Sin turnos</span>}</td>
                  <td style={S.td}><button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 12px', fontSize:12 }} onClick={() => { setForm({ nombre:o.nombre, cliente:o.cliente, direccion:o.direccion||'', estado:o.estado, radio_metros:o.radio_metros }); setEditId(o.id); setModal(true) }}>✏ Editar</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {modal && (
        <Modal title={editId ? 'Editar Objetivo' : 'Nuevo Objetivo'} onClose={() => setModal(false)}
          footer={<><button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => setModal(false)}>Cancelar</button><button style={{ ...S.btn, ...S.btnPrimary }} onClick={guardar} disabled={loading}>{loading ? 'Guardando...' : 'Guardar'}</button></>}>
          <div style={{ marginBottom:16 }}><label style={S.label}>Nombre del Objetivo</label><input style={S.input} value={form.nombre} onChange={e => setForm({...form, nombre:e.target.value})} /></div>
          <div style={{ marginBottom:16 }}><label style={S.label}>Cliente</label><input style={S.input} value={form.cliente} onChange={e => setForm({...form, cliente:e.target.value})} /></div>
          <div style={{ marginBottom:16 }}><label style={S.label}>Dirección</label><input style={S.input} value={form.direccion} onChange={e => setForm({...form, direccion:e.target.value})} /></div>
          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}><label style={S.label}>Estado</label><select style={S.select} value={form.estado} onChange={e => setForm({...form, estado:e.target.value})}><option value="activo">Activo</option><option value="inactivo">Inactivo</option></select></div>
            <div style={{ marginBottom:16 }}><label style={S.label}>Radio GPS (metros)</label><input style={S.input} type="number" value={form.radio_metros} onChange={e => setForm({...form, radio_metros:Number(e.target.value)})} /></div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── TURNOS ────────────────────────────────────────────────────────────────────
function Turnos({ turnos, setTurnos, guardias, objetivos }: any) {
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ guardia_id:'', objetivo_id:'', fecha:new Date().toISOString().split('T')[0], hora_inicio:'06:00', hora_fin:'14:00' })
  const [filtFecha, setFiltFecha] = useState(new Date().toISOString().split('T')[0])
  const [loading, setLoading] = useState(false)

  const guardar = async () => {
    setLoading(true)
    const payload = { ...form, guardia_id: form.guardia_id || null, estado: form.guardia_id ? 'cubierto' : 'descubierto' }
    const { data } = await supabase.from('turnos').insert(payload).select().single()
    if (data) setTurnos((prev: any[]) => [...prev, data])
    setModal(false); setLoading(false)
  }

  const filtrados = turnos.filter((t: Turno) => !filtFecha || t.fecha === filtFecha)

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:24 }}>
        <div style={{ flex:1 }}><div style={S.title}>Turnos</div><div style={S.sub2}>Asignación de guardias a objetivos</div></div>
        <input type="date" style={{ ...S.input, width:'auto' }} value={filtFecha} onChange={e => setFiltFecha(e.target.value)} />
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setModal(true)}>+ Nuevo Turno</button>
      </div>
      <div style={S.card}>
        <table style={S.table}>
          <thead><tr><th style={S.th}>Fecha</th><th style={S.th}>Objetivo</th><th style={S.th}>Horario</th><th style={S.th}>Guardia</th><th style={S.th}>Estado</th></tr></thead>
          <tbody>
            {filtrados.map((t: Turno) => {
              const g = guardias.find((x: Usuario) => x.id === t.guardia_id)
              const o = objetivos.find((x: Objetivo) => x.id === t.objetivo_id)
              return (
                <tr key={t.id}>
                  <td style={S.td}>{t.fecha}</td>
                  <td style={S.td}><strong>{o?.nombre}</strong><br /><span style={{ fontSize:11, color:'#64748b' }}>{o?.cliente}</span></td>
                  <td style={S.td}><span style={{ fontFamily:'Syne,sans-serif', fontWeight:600 }}>{t.hora_inicio} → {t.hora_fin}</span></td>
                  <td style={S.td}>{g ? `${g.apellido}, ${g.nombre}` : <span style={{ color:'#ef4444' }}>Sin asignar</span>}</td>
                  <td style={S.td}><Badge type={t.estado}>{t.estado}</Badge></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtrados.length === 0 && <div style={{ textAlign:'center', padding:48, color:'#64748b' }}>📅 No hay turnos para esta fecha</div>}
      </div>
      {modal && (
        <Modal title="Nuevo Turno" onClose={() => setModal(false)}
          footer={<><button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => setModal(false)}>Cancelar</button><button style={{ ...S.btn, ...S.btnPrimary }} onClick={guardar} disabled={loading}>{loading ? 'Guardando...' : 'Guardar'}</button></>}>
          <div style={{ marginBottom:16 }}><label style={S.label}>Objetivo</label><select style={S.select} value={form.objetivo_id} onChange={e => setForm({...form, objetivo_id:e.target.value})}><option value="">Seleccionar...</option>{objetivos.map((o: Objetivo) => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
          <div style={{ marginBottom:16 }}><label style={S.label}>Guardia (opcional)</label><select style={S.select} value={form.guardia_id} onChange={e => setForm({...form, guardia_id:e.target.value})}><option value="">Sin asignar</option>{guardias.filter((g: Usuario) => g.estado === 'activo').map((g: Usuario) => <option key={g.id} value={g.id}>{g.apellido}, {g.nombre}</option>)}</select></div>
          <div style={S.grid2}>
            <div style={{ marginBottom:16 }}><label style={S.label}>Fecha</label><input type="date" style={S.input} value={form.fecha} onChange={e => setForm({...form, fecha:e.target.value})} /></div>
            <div style={{ marginBottom:16 }}><label style={S.label}>Hora inicio</label><input type="time" style={S.input} value={form.hora_inicio} onChange={e => setForm({...form, hora_inicio:e.target.value})} /></div>
            <div style={{ marginBottom:16 }}><label style={S.label}>Hora fin</label><input type="time" style={S.input} value={form.hora_fin} onChange={e => setForm({...form, hora_fin:e.target.value})} /></div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── ASISTENCIA ────────────────────────────────────────────────────────────────
function Asistencia({ registros, setRegistros, turnos, guardias, objetivos }: any) {
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ turno_id:'', hora_entrada_real:'', hora_salida_real:'', observacion:'' })
  const [loading, setLoading] = useState(false)

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
      // Actualizar estado del turno
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
      <div style={S.card}>
        <table style={S.table}>
          <thead><tr><th style={S.th}>Guardia</th><th style={S.th}>Objetivo</th><th style={S.th}>Asignado</th><th style={S.th}>Entrada Real</th><th style={S.th}>Salida Real</th><th style={S.th}>Horas</th><th style={S.th}>Alertas</th></tr></thead>
          <tbody>
            {registros.map((r: RegistroAsistencia) => {
              const g = guardias.find((x: Usuario) => x.id === r.guardia_id)
              const t = turnos.find((x: Turno) => x.id === r.turno_id)
              const o = objetivos.find((x: Objetivo) => x.id === t?.objetivo_id)
              return (
                <tr key={r.id}>
                  <td style={S.td}><strong>{g?.apellido}, {g?.nombre}</strong></td>
                  <td style={{ ...S.td, fontSize:12 }}>{o?.nombre}</td>
                  <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:600, fontSize:13 }}>{t?.hora_inicio} – {t?.hora_fin}</td>
                  <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:600 }}>{r.hora_entrada_real}</td>
                  <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:600 }}>{r.hora_salida_real || '—'}</td>
                  <td style={S.td}>{r.horas_trabajadas ? formatHoras(r.horas_trabajadas) : '—'}</td>
                  <td style={S.td}>
                    <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                      {r.alerta_entrada && <Badge type={r.alerta_entrada}>{r.alerta_entrada === 'tarde' ? '⏰ Tarde' : '⬆ Anticipada'}</Badge>}
                      {r.alerta_salida && <Badge type={r.alerta_salida}>{r.alerta_salida === 'anticipada' ? '⬇ Salida ant.' : '⏱ Posterior'}</Badge>}
                      {!r.alerta_entrada && !r.alerta_salida && <Badge type="cubierto">✓ Ok</Badge>}
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
                return <option key={t.id} value={t.id}>{t.fecha} | {o?.nombre} | {t.hora_inicio}-{t.hora_fin} | {g ? g.apellido : 'Sin guardia'}</option>
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

// ── NOVEDADES ─────────────────────────────────────────────────────────────────
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

// ── REPORTES ──────────────────────────────────────────────────────────────────
function Reportes({ registros, turnos, guardias, objetivos, novedades }: any) {
  const [tab, setTab] = useState('guardias')

  const exportCSV = (data: any[], filename: string) => {
    const keys = Object.keys(data[0])
    const rows = [keys.join(','), ...data.map(row => keys.map(k => `"${row[k]}"`).join(','))]
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = filename + '.csv'; a.click()
  }

  const reporteGuardias = guardias.map((g: Usuario) => {
    const regs = registros.filter((r: RegistroAsistencia) => r.guardia_id === g.id)
    return { Legajo: g.legajo, Apellido: g.apellido, Nombre: g.nombre, 'Días Trabajados': regs.length, 'Horas Totales': regs.reduce((s: number, r: RegistroAsistencia) => s + (r.horas_trabajadas || 0), 0).toFixed(2), Tardanzas: regs.filter((r: RegistroAsistencia) => r.alerta_entrada === 'tarde').length, 'Salidas Anticipadas': regs.filter((r: RegistroAsistencia) => r.alerta_salida === 'anticipada').length }
  })

  const reporteObjetivos = objetivos.map((o: Objetivo) => {
    const ts = turnos.filter((t: Turno) => t.objetivo_id === o.id)
    return { Objetivo: o.nombre, Cliente: o.cliente, 'Turnos Cubiertos': ts.filter((t: Turno) => t.estado === 'cubierto').length, 'Turnos Descubiertos': ts.filter((t: Turno) => t.estado === 'descubierto').length, 'Horas Cubiertas': ts.filter((t: Turno) => t.estado === 'cubierto').reduce((s: number, t: Turno) => { const [h1,m1] = t.hora_inicio.split(':').map(Number); const [h2,m2] = t.hora_fin.split(':').map(Number); let d=(h2*60+m2)-(h1*60+m1); if(d<0)d+=1440; return s+d/60 }, 0).toFixed(1) }
  })

  const tabs = [{ id:'guardias', label:'Por Guardia' }, { id:'objetivos', label:'Por Objetivo' }, { id:'novedades', label:'Novedades' }]

  return (
    <div>
      <div style={S.title}>Reportes</div>
      <div style={S.sub2}>Resúmenes y exportaciones</div>
      <div style={{ display:'flex', gap:4, background:'#1a2235', borderRadius:10, padding:4, marginBottom:24, width:'fit-content' }}>
        {tabs.map(t => <button key={t.id} style={{ padding:'8px 18px', borderRadius:8, cursor:'pointer', fontSize:13, color:tab===t.id?'#f59e0b':'#64748b', background:tab===t.id?'#111827':'transparent', border:'none', fontFamily:'DM Sans,sans-serif', fontWeight:tab===t.id?600:400 }} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {tab === 'guardias' && (
        <div style={S.card}>
          <div style={{ display:'flex', alignItems:'center', marginBottom:16 }}>
            <strong style={{ flex:1, fontFamily:'Syne,sans-serif' }}>Reporte por Guardia</strong>
            <button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 12px', fontSize:12 }} onClick={() => exportCSV(reporteGuardias, 'reporte-guardias')}>⬇ Exportar CSV</button>
          </div>
          <table style={S.table}>
            <thead><tr><th style={S.th}>Legajo</th><th style={S.th}>Guardia</th><th style={S.th}>Días Trab.</th><th style={S.th}>Horas Totales</th><th style={S.th}>Tardanzas</th><th style={S.th}>Sal. Anticipadas</th></tr></thead>
            <tbody>
              {reporteGuardias.map((g: any) => (
                <tr key={g.Legajo}>
                  <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:700, color:'#f59e0b' }}>{g.Legajo}</td>
                  <td style={S.td}><strong>{g.Apellido}, {g.Nombre}</strong></td>
                  <td style={S.td}>{g['Días Trabajados']}</td>
                  <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:700 }}>{g['Horas Totales']}h</td>
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
            <button style={{ ...S.btn, ...S.btnSecondary, padding:'6px 12px', fontSize:12 }} onClick={() => exportCSV(reporteObjetivos, 'reporte-objetivos')}>⬇ Exportar CSV</button>
          </div>
          <table style={S.table}>
            <thead><tr><th style={S.th}>Objetivo</th><th style={S.th}>Cliente</th><th style={S.th}>Cubiertos</th><th style={S.th}>Descubiertos</th><th style={S.th}>Hs. Cubiertas</th></tr></thead>
            <tbody>
              {reporteObjetivos.map((o: any) => (
                <tr key={o.Objetivo}>
                  <td style={S.td}><strong>{o.Objetivo}</strong></td>
                  <td style={S.td}>{o.Cliente}</td>
                  <td style={S.td}><Badge type="cubierto">{o['Turnos Cubiertos']}</Badge></td>
                  <td style={S.td}>{o['Turnos Descubiertos'] > 0 ? <Badge type="descubierto">{o['Turnos Descubiertos']}</Badge> : '—'}</td>
                  <td style={{ ...S.td, fontFamily:'Syne,sans-serif', fontWeight:700 }}>{o['Horas Cubiertas']}h</td>
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

// ── APP PRINCIPAL ─────────────────────────────────────────────────────────────
const NAV = [
  { section:'General', items:[{ id:'dashboard', icon:'📊', label:'Panel Principal' }] },
  { section:'Operaciones', items:[
    { id:'guardias', icon:'👮', label:'Guardias' },
    { id:'objetivos', icon:'🏢', label:'Objetivos' },
    { id:'turnos', icon:'📅', label:'Turnos' },
    { id:'asistencia', icon:'✅', label:'Asistencia' },
  ]},
  { section:'Administración', items:[
    { id:'novedades', icon:'📋', label:'Novedades' },
    { id:'reportes', icon:'📈', label:'Reportes' },
  ]},
]

export default function AppPage() {
  const [user, setUser] = useState<any>(null)
  const [page, setPage] = useState('dashboard')
  const [guardias, setGuardias] = useState<Usuario[]>([])
  const [objetivos, setObjetivos] = useState<Objetivo[]>([])
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [registros, setRegistros] = useState<RegistroAsistencia[]>([])
  const [novedades, setNovedades] = useState<Novedad[]>([])
  const [loading, setLoading] = useState(true)

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
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        supabase.from('usuarios').select('*').eq('auth_user_id', data.session.user.id).single()
          .then(({ data: perfil }) => { setUser(perfil || { nombre:'Admin', apellido:'', rol:'admin' }); cargarDatos() })
      } else setLoading(false)
    })
  }, [cargarDatos])

  if (loading && !user) return <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', color:'#64748b' }}>Cargando...</div>
  if (!user) return <Login onLogin={u => { setUser(u); cargarDatos() }} />

  const novedadesUrgentes = novedades.filter(n => n.prioridad === 'urgente' && n.estado !== 'resuelta').length

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
          <>
            {page === 'dashboard' && <Dashboard guardias={guardias} objetivos={objetivos} turnos={turnos} registros={registros} novedades={novedades} />}
            {page === 'guardias' && <Guardias guardias={guardias} setGuardias={setGuardias} registros={registros} />}
            {page === 'objetivos' && <Objetivos objetivos={objetivos} setObjetivos={setObjetivos} turnos={turnos} />}
            {page === 'turnos' && <Turnos turnos={turnos} setTurnos={setTurnos} guardias={guardias} objetivos={objetivos} />}
            {page === 'asistencia' && <Asistencia registros={registros} setRegistros={setRegistros} turnos={turnos} guardias={guardias} objetivos={objetivos} />}
            {page === 'novedades' && <Novedades novedades={novedades} setNovedades={setNovedades} guardias={guardias} objetivos={objetivos} />}
            {page === 'reportes' && <Reportes registros={registros} turnos={turnos} guardias={guardias} objetivos={objetivos} novedades={novedades} />}
          </>
        )}
      </main>
    </div>
  )
}
