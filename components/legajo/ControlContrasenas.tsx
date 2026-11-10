'use client'

/**
 * components/legajo/ControlContrasenas.tsx
 *
 * Administración / Gerencia: quién sigue entrando con la contraseña inicial (DNI)
 * y quién tiene el cambio obligatorio pendiente. Desde acá se marcan las cuentas
 * existentes POR LOTES (primero Administración y Gerencia, después el resto de
 * la estructura, después los vigiladores), sin obligar a todos a la vez.
 * Nunca se muestra ni se guarda una contraseña: "contraseña = DNI" lo calcula la
 * base en el momento (accesos_password_estado).
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'

type Fila = {
  usuario_id: string; apellido: string; nombre: string; puesto: string; tiene_cuenta: boolean; es_dni: boolean
  cambio_obligatorio: boolean; obligatorio_desde: string | null; ultimo_cambio_at: string | null; ultimo_ingreso: string | null
}
type Grupo = 'todos' | 'conduccion' | 'supervision' | 'vigiladores'

const ESTRUCTURA = ['administracion', 'gerencia', 'direccion_operativa', 'admin']
const SUPERVISION = ['supervisor', 'jefe_supervisores']
const grupoDe = (p: string): Exclude<Grupo, 'todos'> => ESTRUCTURA.includes(p) ? 'conduccion' : SUPERVISION.includes(p) ? 'supervision' : 'vigiladores'
const fecha = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : '—'
const dias = (iso: string | null) => iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : null

const tarjeta: CSSProperties = { background: '#111827', border: '1px solid #1e2d42', borderRadius: 12, padding: 14, minWidth: 0 }
const chip = (a: boolean): CSSProperties => ({ background: a ? '#1e293b' : 'transparent', color: a ? '#e2e8f0' : '#94a3b8', border: '1px solid ' + (a ? '#334155' : '#1f2937'), borderRadius: 999, padding: '7px 12px', fontWeight: a ? 800 : 600, fontSize: 13, cursor: 'pointer', minHeight: 36, whiteSpace: 'nowrap' })

export default function ControlContrasenas() {
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [grupo, setGrupo] = useState<Grupo>('conduccion')
  const [soloDni, setSoloDni] = useState(true)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setError(null)
    const { data, error: e } = await supabase.rpc('accesos_password_estado')
    if (e) { setError(e.message); return }
    setFilas((data ?? []) as Fila[])
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  const visibles = useMemo(() => (filas ?? []).filter(f =>
    f.tiene_cuenta && (grupo === 'todos' || grupoDe(f.puesto) === grupo) && (!soloDni || f.es_dni)), [filas, grupo, soloDni])
  const tot = useMemo(() => {
    const c = (filas ?? []).filter(f => f.tiene_cuenta)
    return { cuentas: c.length, dni: c.filter(f => f.es_dni).length, pendientes: c.filter(f => f.es_dni && f.cambio_obligatorio).length, personales: c.filter(f => !f.es_dni).length }
  }, [filas])

  const marcar = async (obligatorio: boolean) => {
    if (!sel.size) return
    const texto = obligatorio
      ? `¿Marcar ${sel.size} cuenta(s) con cambio de contraseña obligatorio?\n\nEn su próximo ingreso la app les va a pedir una contraseña personal. Los vigiladores la eligen dentro de su app, sin que se frene ningún fichaje.`
      : `¿Quitar el cambio obligatorio a ${sel.size} cuenta(s)?`
    if (!window.confirm(texto)) return
    setOcupado(true); setAviso(null)
    const { data, error: e } = await supabase.rpc('accesos_marcar_cambio_obligatorio', { p_usuarios: Array.from(sel), p_obligatorio: obligatorio })
    setOcupado(false)
    if (e) { setError(e.message); return }
    setAviso(`${data ?? 0} cuenta(s) actualizadas.`)
    setSel(new Set()); void cargar()
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: '#e2e8f0' }}>Contraseñas</div>
      <div style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0 12px' }}>
        La contraseña inicial es el DNI. Las cuentas nuevas y las restablecidas tienen que cambiarla en su primer ingreso.
        Las existentes se suman por lotes desde acá. Nunca se ve ni se guarda una contraseña.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 12 }}>
        {[['Cuentas activas', tot.cuentas, '#e2e8f0'], ['Con contraseña = DNI', tot.dni, '#f59e0b'], ['Cambio obligatorio pendiente', tot.pendientes, '#fca5a5'], ['Con contraseña personal', tot.personales, '#86efac']].map(([t, n, c]) => (
          <div key={String(t)} style={tarjeta}><div style={{ fontSize: 24, fontWeight: 800, color: String(c) }}>{filas ? n : '…'}</div><div style={{ fontSize: 12.5, color: '#94a3b8' }}>{t}</div></div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 8 }}>
        {([['conduccion', 'Administración, Gerencia y Dir. Operativa'], ['supervision', 'Supervisión'], ['vigiladores', 'Vigiladores'], ['todos', 'Todos']] as [Grupo, string][]).map(([g, t]) => (
          <button key={g} type="button" onClick={() => { setGrupo(g); setSel(new Set()) }} style={chip(grupo === g)}>{t}</button>
        ))}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#cbd5e1', marginBottom: 10 }}>
        <input type="checkbox" checked={soloDni} onChange={e => setSoloDni(e.target.checked)} /> Sólo los que siguen con el DNI
      </label>
      {error && <div role="alert" style={{ ...tarjeta, color: '#fca5a5', marginBottom: 10 }}>{error}</div>}
      {aviso && <div role="status" style={{ ...tarjeta, color: '#86efac', marginBottom: 10 }}>{aviso}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <button type="button" disabled={!sel.size || ocupado} onClick={() => void marcar(true)} style={{ minHeight: 42, padding: '9px 14px', borderRadius: 10, border: 'none', background: sel.size ? '#eab308' : '#334155', color: '#0a0e1a', fontWeight: 800, cursor: 'pointer' }}>
          Marcar cambio obligatorio ({sel.size})
        </button>
        <button type="button" disabled={!sel.size || ocupado} onClick={() => void marcar(false)} style={{ minHeight: 42, padding: '9px 14px', borderRadius: 10, border: '1px solid #334155', background: 'transparent', color: '#e2e8f0', fontWeight: 700, cursor: 'pointer' }}>Quitar</button>
        {visibles.length > 0 && <button type="button" onClick={() => setSel(new Set(visibles.map(f => f.usuario_id)))} style={{ minHeight: 42, padding: '9px 14px', borderRadius: 10, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}>Seleccionar los {visibles.length}</button>}
      </div>
      {!filas && !error && <div style={{ color: '#64748b', padding: 20 }}>Cargando… (la verificación tarda unos segundos)</div>}
      <div style={{ display: 'grid', gap: 6 }}>
        {visibles.map(f => (
          <label key={f.usuario_id} style={{ ...tarjeta, display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', padding: 12 }}>
            <input type="checkbox" checked={sel.has(f.usuario_id)} onChange={e => setSel(s => { const n = new Set(s); if (e.target.checked) n.add(f.usuario_id); else n.delete(f.usuario_id); return n })} style={{ width: 20, height: 20, marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: '#e2e8f0', overflowWrap: 'anywhere' }}>{f.apellido}, {f.nombre}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: !f.es_dni ? '#86efac' : f.cambio_obligatorio ? '#fca5a5' : '#f59e0b' }}>
                  {!f.es_dni ? 'Contraseña personal' : f.cambio_obligatorio ? `Cambio obligatorio · ${dias(f.obligatorio_desde) ?? 0} día(s)` : 'Contraseña = DNI'}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 3, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span>{f.puesto.replace(/_/g, ' ')}</span>
                <span>Último ingreso: {fecha(f.ultimo_ingreso)}</span>
                {f.ultimo_cambio_at && <span>Cambió la contraseña: {fecha(f.ultimo_cambio_at)}</span>}
              </div>
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}
