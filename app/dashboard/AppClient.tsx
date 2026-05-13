'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase, formatHoras, calcAlertaEntrada, calcAlertaSalida, calcHorasTrabajadas, calcDistancia } from '@/lib/supabase'
import type { Usuario, Objetivo, Turno, RegistroAsistencia, Novedad } from '@/lib/supabase'

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

function Login({ onLogin }: { onLogin: (u: any) => void }) {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const login = async () => {
    setLoading(true)
    setError('')

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: pass,
    })

    if (error) {
      setError('Email o contraseña incorrectos')
      setLoading(false)
      return
    }

    const { data: perfil, error: perfilError } = await supabase
      .from('usuarios')
      .select('*')
      .eq('auth_user_id', data.user.id)
      .single()

    if (perfilError || !perfil) {
      setError('Usuario sin perfil asignado')
      await supabase.auth.signOut()
      setLoading(false)
      return
    }

    onLogin(perfil)
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
          <button
            style={{ ...S.btn, ...S.btnPrimary, width:'100%', justifyContent:'center' }}
            onClick={login}
            disabled={loading}
          >
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </div>
      </div>
    </div>
  )
}

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
    const { data: turnosExistentes } = await supabase.from('turnos').select('objetivo_id, guardia_id, fecha, hora_inicio, hora_fin').gte('fecha', fechaDesde).lte('fecha', fechaHasta).eq('tipo_evento', 'normal')
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
        nuevos.push({ objetivo_id:srv.objetivo_id, guardia_id:guardiaId, guardia_original_id:guardiaId, guardia_real_id:null, fecha:fechaStr, hora_inicio:srv.turno_base.hora_inicio, hora_fin:srv.turno_base.hora_fin, estado:'programado', tipo_evento:'normal', estado_revision:'aprobado', servicio_base_id:null })
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
          {misRegistros.slice(0, 5).map((r: any) => {
            const t = turnos.find((x: any) => x.id === r.turno_id)
            const obj = objetivos.find((o: any) => o.id === t?.objetivo_id)
            return (
              <div key={r.id} style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:10, padding:14, marginBottom:8, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:'#e2e8f0' }}>{obj?.nombre || '—'}</div>
                  <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>{t?.fecha} · {r.hora_entrada_real} – {r.hora_salida_real || '…'}</div>
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
function RevisionOperativa({ guardias, objetivos, turnos, setTurnos }: any) {
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

  const pendientesAlertas = alertas.filter(a => a.estado_revision === 'pendiente_supervisor')

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
          {pendientesAlertas.length > 0 && <span style={{ marginLeft:6, background:'rgba(239,68,68,.15)', color:'#ef4444', borderRadius:10, padding:'1px 7px', fontSize:11 }}>{pendientesAlertas.length}</span>}
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
        pendientesAlertas.length === 0 ? (
          <div style={{ ...S.card, textAlign:'center', padding:48, color:'#64748b' }}>
            <div style={{ fontSize:36, marginBottom:12 }}>✅</div>
            <div>No hay alertas de asistencia pendientes</div>
          </div>
        ) : pendientesAlertas.map((r: any) => {
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
                  <div style={{ fontSize:13, color:'#64748b', marginTop:2 }}>{r.turno?.fecha} · {r.turno?.hora_inicio} → {r.turno?.hora_fin}</div>
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
        })
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
                <div style={{ fontSize:13, color:'#f59e0b', fontFamily:'Syne,sans-serif', fontWeight:600, marginTop:4 }}>{modalItem.turno?.fecha} · Entrada: {modalItem.hora_entrada_real} · Salida: {modalItem.hora_salida_real || '—'}</div>
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

  if (loading && !user) return <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', color:'#64748b' }}>Cargando...</div>
  if (!user) return <Login onLogin={u => { setUser(u); cargarDatos() }} />
  if (user.rol === 'guardia') return (
    <LayoutGuardia user={user} turnos={turnos} registros={registros} novedades={novedades} setRegistros={setRegistros} setNovedades={setNovedades} guardias={guardias} objetivos={objetivos} />
  )

  const esGuardia = user.rol === 'guardia'

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
              {page === 'dashboard' && <Dashboard guardias={guardias} objetivos={objetivos} turnos={turnos} registros={registros} novedades={novedades} />}
              {page === 'guardias' && <Guardias guardias={guardias} setGuardias={setGuardias} registros={registros} />}
              {page === 'objetivos' && <Objetivos objetivos={objetivos} setObjetivos={setObjetivos} turnos={turnos} />}
              {page === 'turnos' && <Turnos turnos={turnos} setTurnos={setTurnos} guardias={guardias} objetivos={objetivos} />}
              {page === 'asistencia' && <Asistencia registros={registros} setRegistros={setRegistros} turnos={turnos} guardias={guardias} objetivos={objetivos} />}
              {page === 'servicios_objetivo' && <ServiciosObjetivo guardias={guardias} objetivos={objetivos} />}
              {page === 'revision_operativa' && <RevisionOperativa guardias={guardias} objetivos={objetivos} turnos={turnos} setTurnos={setTurnos} />}
              {page === 'novedades' && <Novedades novedades={novedades} setNovedades={setNovedades} guardias={guardias} objetivos={objetivos} />}
              {page === 'reportes' && <Reportes registros={registros} turnos={turnos} guardias={guardias} objetivos={objetivos} novedades={novedades} />}
              {page === 'turnos_base' && <TurnosBase />}
            </>
          )
        )}
      </main>
    </div>
  )
}
