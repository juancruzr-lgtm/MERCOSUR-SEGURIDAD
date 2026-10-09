'use client'

/**
 * components/legajo/DatosPersonales.tsx
 *
 * Sección "Datos personales" del legajo (Legajo Digital, Etapa 1).
 *
 *   propio   la persona ve sus datos, completa o corrige (lo sensible queda
 *            "pendiente de validación"), confirma los datos de la planilla
 *            histórica y cambia su teléfono (circuito de siempre).
 *   Administración/Gerencia
 *            ve, corrige directo (queda registrado) y aprueba o rechaza lo que
 *            propuso la persona.
 *
 * La base decide quién puede qué (RPC + RLS); acá sólo se ofrece lo posible.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ETIQUETA_ORIGEN, GRUPOS, cambiarTelefonoPropio, cargarDatosLegajo, confirmarDatoPlanilla,
  mostrarValor, pendienteDe, proponerCambio, resolverCambio,
} from '@/lib/datos-personales'
import type { CampoLegajo, CambioDato, DatosLegajo } from '@/lib/datos-personales'
import CorroboracionArca from '@/components/legajo/CorroboracionArca'

const card: React.CSSProperties = { background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 14, marginBottom: 12, minWidth: 0, boxSizing: 'border-box' }
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#0b1220', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '10px 11px', fontSize: 15 }
const btn = (tipo: 'primario' | 'secundario' | 'peligro' | 'ok', on = true): React.CSSProperties => ({
  background: !on ? '#334155' : tipo === 'primario' ? '#f59e0b' : tipo === 'ok' ? '#16a34a' : 'transparent',
  color: !on ? '#64748b' : tipo === 'primario' ? '#1a1205' : tipo === 'ok' ? '#fff' : tipo === 'peligro' ? '#fca5a5' : '#cbd5e1',
  border: tipo === 'secundario' ? '1px solid #334155' : tipo === 'peligro' ? '1px solid rgba(239,68,68,.5)' : 'none',
  borderRadius: 8, padding: '9px 13px', fontSize: 14, fontWeight: tipo === 'primario' || tipo === 'ok' ? 800 : 600, cursor: on ? 'pointer' : 'not-allowed', minHeight: 40,
})

function Campo({ c, datos, onCambio }: { c: CampoLegajo; datos: DatosLegajo; onCambio: () => void }) {
  const valor = datos.datos?.[c.campo] ?? null
  const pend = pendienteDe(datos.cambios, c.campo)
  const [editando, setEditando] = useState(false)
  const [v, setV] = useState('')
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const puede = datos.puede_gestionar || (datos.es_propio && c.vigilador_propone)

  const guardar = async () => {
    setOcupado(true); setError(null)
    const r = await proponerCambio(datos.empleado_id, c.campo, v, motivo)
    setOcupado(false)
    if (r.error) { setError(r.error); return }
    setEditando(false)
    setAviso(r.estado === 'pendiente' ? 'Enviado: Administración lo tiene que validar.' : r.estado === 'sin_cambios' ? 'No hubo cambios.' : 'Guardado.')
    onCambio()
  }

  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid #1e293b' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>{c.etiqueta}</div>
          <div style={{ fontSize: 15, color: valor ? '#e2e8f0' : '#64748b', overflowWrap: 'anywhere' }}>{mostrarValor(c, valor)}</div>
        </div>
        {puede && !editando && !pend && (
          <button type="button" style={{ ...btn('secundario'), padding: '6px 10px', minHeight: 34, fontSize: 13 }}
            onClick={() => { setV(valor ?? ''); setMotivo(''); setEditando(true); setAviso(null) }}>
            {valor ? 'Corregir' : 'Completar'}
          </button>
        )}
      </div>
      {pend && <Pendiente c={c} p={pend} datos={datos} onCambio={onCambio} />}
      {editando && (
        <div style={{ marginTop: 8 }}>
          <input style={input} type={c.tipo === 'fecha' ? 'date' : 'text'} value={v} maxLength={120} onChange={e => setV(e.target.value)} />
          {datos.es_propio && !datos.puede_gestionar && c.requiere_validacion && (
            <input style={{ ...input, marginTop: 6, fontSize: 14 }} placeholder="Comentario (opcional)" value={motivo} maxLength={300} onChange={e => setMotivo(e.target.value)} />
          )}
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
            {datos.puede_gestionar ? 'Se guarda directo y queda registrado.' : c.requiere_validacion ? 'Administración lo va a validar antes de que cambie.' : 'Se guarda directo.'}
          </div>
          {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 6 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" style={btn('primario', !ocupado)} disabled={ocupado} onClick={() => void guardar()}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" style={btn('secundario')} onClick={() => setEditando(false)}>Cancelar</button>
          </div>
        </div>
      )}
      {aviso && <div style={{ fontSize: 12.5, color: '#86efac', marginTop: 4 }}>{aviso}</div>}
    </div>
  )
}

function Pendiente({ c, p, datos, onCambio }: { c: CampoLegajo; p: CambioDato; datos: DatosLegajo; onCambio: () => void }) {
  const [modo, setModo] = useState<null | 'rechazar' | 'corregir'>(null)
  const [t, setT] = useState(p.valor_nuevo ?? '')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hacer = async (f: () => Promise<string | null>) => { setOcupado(true); setError(null); const e = await f(); setOcupado(false); if (e) setError(e); else { setModo(null); onCambio() } }
  const dePlanilla = p.estado === 'pendiente_confirmacion'

  return (
    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: dePlanilla ? 'rgba(59,130,246,.08)' : 'rgba(245,158,11,.08)', border: `1px solid ${dePlanilla ? 'rgba(59,130,246,.35)' : 'rgba(245,158,11,.35)'}` }}>
      <div style={{ fontSize: 13, color: '#e2e8f0' }}>
        {dePlanilla
          ? <>Figura en la {ETIQUETA_ORIGEN[p.origen]}: <b>{mostrarValor(c, p.valor_nuevo)}</b>. {datos.es_propio ? '¿Es correcto?' : 'Espera que la persona lo confirme.'}</>
          : <>Propuesto por {ETIQUETA_ORIGEN[p.origen]}: <b>{mostrarValor(c, p.valor_nuevo)}</b> · pendiente de validación{p.motivo ? ` · “${p.motivo}”` : ''}</>}
      </div>
      {dePlanilla && datos.es_propio && modo === null && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button type="button" style={btn('ok', !ocupado)} disabled={ocupado} onClick={() => void hacer(() => confirmarDatoPlanilla(p.id, 'confirmar'))}>Es correcto</button>
          <button type="button" style={btn('secundario')} onClick={() => setModo('corregir')}>Corregir</button>
          <button type="button" style={btn('peligro', !ocupado)} disabled={ocupado} onClick={() => void hacer(() => confirmarDatoPlanilla(p.id, 'no_corresponde'))}>No es mío</button>
        </div>
      )}
      {modo === 'corregir' && (
        <div style={{ marginTop: 8 }}>
          <input style={input} type={c.tipo === 'fecha' ? 'date' : 'text'} value={t} onChange={e => setT(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" style={btn('primario', !ocupado)} disabled={ocupado} onClick={() => void hacer(() => confirmarDatoPlanilla(p.id, 'corregir', t))}>Enviar</button>
            <button type="button" style={btn('secundario')} onClick={() => setModo(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {!dePlanilla && datos.puede_gestionar && modo === null && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button type="button" style={btn('ok', !ocupado)} disabled={ocupado} onClick={() => void hacer(() => resolverCambio(p.id, 'aprobar'))}>Aprobar</button>
          <button type="button" style={btn('peligro')} onClick={() => { setT(''); setModo('rechazar') }}>Rechazar</button>
        </div>
      )}
      {modo === 'rechazar' && (
        <div style={{ marginTop: 8 }}>
          <input style={input} placeholder="Motivo (la persona lo va a ver)" value={t} onChange={e => setT(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" style={btn('primario', !ocupado && t.trim().length >= 3)} disabled={ocupado || t.trim().length < 3} onClick={() => void hacer(() => resolverCambio(p.id, 'rechazar', t))}>Rechazar</button>
            <button type="button" style={btn('secundario')} onClick={() => setModo(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 6 }}>{error}</div>}
    </div>
  )
}

function Telefono({ datos, onCambio }: { datos: DatosLegajo; onCambio: () => void }) {
  const [editando, setEditando] = useState(false)
  const [t, setT] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid #1e293b' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div><div style={{ fontSize: 12, color: '#64748b' }}>Teléfono propio (WhatsApp de la app)</div><div style={{ fontSize: 15, color: '#e2e8f0' }}>{datos.telefono ?? '—'}</div></div>
        {datos.es_propio && !editando && (
          <button type="button" style={{ ...btn('secundario'), padding: '6px 10px', minHeight: 34, fontSize: 13 }} onClick={() => { setT(''); setEditando(true) }}>Cambiar</button>
        )}
      </div>
      {editando && (
        <div style={{ marginTop: 8 }}>
          <input style={input} type="tel" inputMode="tel" placeholder="Ej.: 341 555 1234" value={t} onChange={e => setT(e.target.value)} />
          {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 6 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" style={btn('primario', !ocupado)} disabled={ocupado} onClick={async () => { setOcupado(true); setError(null); const e = await cambiarTelefonoPropio(t); setOcupado(false); if (e) setError(e); else { setEditando(false); onCambio() } }}>Guardar</button>
            <button type="button" style={btn('secundario')} onClick={() => setEditando(false)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function DatosPersonales({ empleadoId }: { empleadoId: string }) {
  const [datos, setDatos] = useState<DatosLegajo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [verHistorial, setVerHistorial] = useState(false)
  const cargar = useCallback(async () => { const r = await cargarDatosLegajo(empleadoId); setDatos(r.datos); setError(r.error) }, [empleadoId])
  useEffect(() => { void cargar() }, [cargar])

  const grupos = useMemo(() => {
    const g = new Map<string, CampoLegajo[]>()
    for (const c of datos?.campos ?? []) g.set(c.grupo, [...(g.get(c.grupo) ?? []), c])
    return Array.from(g.entries())
  }, [datos])

  if (error) return <div style={{ ...card, color: '#fca5a5' }}>{error}</div>
  if (!datos) return <div style={{ color: '#64748b', padding: 24, textAlign: 'center' }}>Cargando datos…</div>

  const porConfirmar = datos.cambios.filter(c => c.estado === 'pendiente_confirmacion').length
  const pendientes = datos.cambios.filter(c => c.estado === 'pendiente').length
  const resueltos = datos.cambios.filter(c => !['pendiente', 'pendiente_confirmacion'].includes(c.estado))
  const campoDe = (k: string) => datos.campos.find(c => c.campo === k)

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', minWidth: 0 }}>
      {(porConfirmar > 0 || pendientes > 0) && (
        <div style={{ ...card, borderColor: 'rgba(59,130,246,.4)' }}>
          <div style={{ fontSize: 14, color: '#e2e8f0' }}>
            {porConfirmar > 0 && <div>{datos.es_propio ? `Tenés ${porConfirmar} dato${porConfirmar > 1 ? 's' : ''} de la planilla para confirmar.` : `${porConfirmar} dato(s) de la planilla esperan que la persona los confirme.`}</div>}
            {pendientes > 0 && <div>{pendientes} cambio{pendientes > 1 ? 's' : ''} pendiente{pendientes > 1 ? 's' : ''} de validación de Administración.</div>}
          </div>
        </div>
      )}
      {grupos.map(([g, cs]) => (
        <div key={g} style={card}>
          <div style={{ fontSize: 13, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, marginBottom: 2 }}>{GRUPOS[g as CampoLegajo['grupo']]}</div>
          {g === 'emergencia' && <Telefono datos={datos} onCambio={() => void cargar()} />}
          {cs.map(c => <Campo key={c.campo} c={c} datos={datos} onCambio={() => void cargar()} />)}
        </div>
      ))}
      {!datos.es_propio && <CorroboracionArca empleadoId={empleadoId} />}
      <div style={{ ...card, padding: '10px 14px' }}>
        <button type="button" onClick={() => setVerHistorial(!verHistorial)} style={{ background: 'none', border: 'none', color: '#93c5fd', fontSize: 13.5, cursor: 'pointer', padding: 0 }}>
          {verHistorial ? 'Ocultar historial' : `Ver historial de cambios (${resueltos.length})`}
        </button>
        {verHistorial && resueltos.map(h => (
          <div key={h.id} style={{ fontSize: 12.5, color: '#94a3b8', padding: '6px 0', borderBottom: '1px solid #1e293b' }}>
            <b style={{ color: '#cbd5e1' }}>{campoDe(h.campo)?.etiqueta ?? h.campo}</b>: {mostrarValor(campoDe(h.campo)!, h.valor_anterior)} → {mostrarValor(campoDe(h.campo)!, h.valor_nuevo)}
            {' · '}{h.estado}{' · '}{ETIQUETA_ORIGEN[h.origen]}{h.revisado_por_nombre ? ` · revisó ${h.revisado_por_nombre}` : ''}
            {' · '}{new Date(h.revisado_at ?? h.creado_at).toLocaleDateString('es-AR')}{h.motivo_rechazo ? ` · motivo: ${h.motivo_rechazo}` : ''}
          </div>
        ))}
      </div>
    </div>
  )
}
