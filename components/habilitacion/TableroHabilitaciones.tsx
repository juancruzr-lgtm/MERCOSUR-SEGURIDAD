'use client'

/**
 * components/habilitacion/TableroHabilitaciones.tsx
 *
 * Tablero de Administración: todos los vigiladores con su credencial, el
 * trámite, la próxima gestión y quién la tiene que hacer, ordenados por
 * urgencia. La prioridad es que nadie llegue a los 6 meses sin que la empresa
 * haya gestionado su habilitación (sólo seguimiento: no decide nada sobre
 * desvinculaciones). Cada fila abre el legajo, donde se registra la gestión.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  ETAPA, GRUPOS, RESPONSABLE, SITUACION, antiguedadTexto, cargarTablero, contarGrupos, enGrupo, etapaActual, fechaCorta,
  ordenar, responsableHabitual, responsableTexto, seisMesesTexto,
} from '@/lib/habilitacion'
import type { EtapaHabilitacion, FilaTablero, GrupoTablero, OrdenTablero, RolResponsable, Tablero } from '@/lib/habilitacion'
import { declaracionTexto } from '@/lib/credencial-pedido'

const control: React.CSSProperties = { background: '#0b1220', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '7px 8px', fontSize: 13, minWidth: 0, maxWidth: '100%' }
const LS = 'mercosur.habilitaciones.grupo'

function Fila({ f }: { f: FilaTablero }) {
  const s = SITUACION[f.codigo]
  const seis = seisMesesTexto(f)
  const resp = responsableTexto(f)
  return (
    <a href={`/guardias/${f.empleado_id}`} style={{
      display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1.6fr) minmax(0, 1fr)', gap: 10, alignItems: 'center',
      background: '#0f172a', border: '1px solid #1e2d42', borderLeft: `3px solid ${s.color}`, borderRadius: 8, padding: '9px 12px', marginBottom: 6,
      textDecoration: 'none', color: 'inherit',
    }} className="fila-habilitacion">
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: '#e2e8f0', overflowWrap: 'anywhere' }}>{f.apellido}, {f.nombre}</span>
        <span style={{ display: 'block', fontSize: 12, color: '#64748b' }}>
          {f.ingreso ? `Ingreso ${fechaCorta(f.ingreso)} · ${antiguedadTexto(f.antiguedad_dias)}` : <span style={{ color: '#fbbf24' }}>sin fecha de ingreso</span>}
          {f.objetivo ? ` · ${f.objetivo}` : ''}
        </span>
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: s.color }}>{s.icono} {f.titulo}</span>
        <span style={{ display: 'block', fontSize: 12.5, color: '#cbd5e1', overflowWrap: 'anywhere' }}>{f.detalle}</span>
        {f.foto?.estado === 'pendiente_revision' && <span style={{ display: 'block', fontSize: 12.5, color: '#fbbf24', fontWeight: 700 }}>📷 Subió la foto de la credencial: revisarla</span>}
        {!f.foto && f.declaracion && f.declaracion.respuesta !== 'tiene' && <span style={{ display: 'block', fontSize: 12.5, color: '#93c5fd', overflowWrap: 'anywhere' }}>{declaracionTexto(f.declaracion)}</span>}
      </span>
      <span style={{ minWidth: 0, fontSize: 12.5 }}>
        {resp && f.codigo !== 'vigente' && <span style={{ display: 'block', color: '#cbd5e1' }}>Le toca a: <b>{resp}</b></span>}
        {seis && <span style={{ display: 'block', color: seis.color }}>{seis.texto}</span>}
        {f.tramite?.demorado && <span style={{ display: 'block', color: '#f87171' }}>sin movimiento hace {f.tramite.dias_sin_movimiento} días</span>}
      </span>
    </a>
  )
}

function Responsables({ t, onCambio }: { t: Tablero; onCambio: () => void }) {
  const [error, setError] = useState<string | null>(null)
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 6 }}>Quién se ocupa habitualmente de cada gestión (se puede cambiar en cada trámite).</div>
      {t.catalogo.filter(c => c.responsable_rol !== 'empleado' && c.responsable_rol !== 'medicina_laboral').map(c => (
        <div key={c.codigo} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '5px 0', borderTop: '1px solid #1e293b' }}>
          <span style={{ flex: 1, minWidth: 180, fontSize: 13, color: '#e2e8f0' }}>{c.nombre}</span>
          <select style={control} value={c.responsable_usuario ?? ''} aria-label={`Responsable habitual: ${c.nombre}`}
            onChange={async e => { setError(null); const r = await responsableHabitual(c.codigo, e.target.value || null); if (r) setError(r); else onCambio() }}>
            <option value="">{RESPONSABLE[c.responsable_rol]} (sin persona fija)</option>
            {t.personas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
      ))}
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13 }}>{error}</div>}
    </div>
  )
}

export default function TableroHabilitaciones() {
  const [t, setT] = useState<Tablero | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [grupo, setGrupo] = useState<GrupoTablero>('urgentes')
  const [texto, setTexto] = useState('')
  const [etapa, setEtapa] = useState<EtapaHabilitacion | ''>('')
  const [resp, setResp] = useState<RolResponsable | ''>('')
  const [objetivo, setObjetivo] = useState('')
  const [orden, setOrden] = useState<OrdenTablero>('urgencia')
  const [verResp, setVerResp] = useState(false)
  const cargar = async () => { const r = await cargarTablero(); setT(r.datos); setError(r.error) }
  useEffect(() => { void cargar() }, [])
  useEffect(() => { try { const g = localStorage.getItem(LS); if (g && GRUPOS.some(([k]) => k === g)) setGrupo(g as GrupoTablero) } catch { /* sin almacenamiento */ } }, [])
  const elegir = (g: GrupoTablero) => { setGrupo(g); try { localStorage.setItem(LS, g) } catch { /* sin almacenamiento */ } }

  const conteo = useMemo(() => t ? contarGrupos(t.filas) : null, [t])
  const objetivos = useMemo(() => t ? Array.from(new Set(t.filas.map(f => f.objetivo).filter((x): x is string => !!x))).sort() : [], [t])
  const visibles = useMemo(() => {
    if (!t) return []
    const q = texto.trim().toLowerCase()
    return ordenar(t.filas.filter(f => enGrupo(f, grupo)
      && (!q || `${f.apellido} ${f.nombre} ${f.legajo ?? ''} ${f.cuil ?? ''}`.toLowerCase().includes(q))
      && (!etapa || etapaActual(f) === etapa)
      && (!resp || f.responsable_rol === resp)
      && (!objetivo || f.objetivo === objetivo)), orden)
  }, [t, grupo, texto, etapa, resp, objetivo, orden])

  const tarjeta = (g: GrupoTablero, color: string) => {
    const n = conteo?.[g] ?? 0
    return (
      <button key={g} type="button" onClick={() => elegir(g)} aria-pressed={grupo === g} style={{
        background: grupo === g ? '#1e293b' : '#111827', border: `1px solid ${grupo === g ? color : '#1e2d42'}`, borderRadius: 10, padding: '10px 12px',
        textAlign: 'left', cursor: 'pointer', minWidth: 0,
      }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: n ? color : '#475569' }}>{n}</div>
        <div style={{ fontSize: 12.5, color: '#cbd5e1' }}>{GRUPOS.find(([k]) => k === g)?.[1]}</div>
      </button>
    )
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', minWidth: 0 }}>
      <style>{`@media (max-width: 720px) { .fila-habilitacion { grid-template-columns: 1fr !important; gap: 4px !important; } }`}</style>
      <div style={{ fontSize: 20, fontWeight: 800, color: '#e2e8f0' }}>Credenciales y habilitaciones</div>
      <div style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0 12px', lineHeight: 1.5 }}>
        Todos los vigiladores: si tienen credencial y cuándo vence; si no, qué falta y a quién le toca. Primero lo más urgente
        (vencidas y quienes se acercan a los 6 meses sin credencial). Tocá a una persona para ver y actualizar su trámite.
        <b style={{ color: '#cbd5e1' }}> Documentación completa no es credencial:</b> sólo cuenta la credencial registrada.
      </div>
      {error && <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {!t && !error && <div style={{ color: '#64748b', padding: 24 }}>Cargando…</div>}
      {t && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(105px, 1fr))', gap: 8, marginBottom: 12 }}>
            {tarjeta('urgentes', '#ef4444')}
            {tarjeta('vencidas', '#ef4444')}
            {tarjeta('por_vencer', '#f59e0b')}
            {tarjeta('vigentes', '#22c55e')}
            {tarjeta('sin_credencial', '#fb923c')}
            {tarjeta('en_tramite', '#60a5fa')}
            {tarjeta('demorados', '#f87171')}
            {tarjeta('sin_verificar', '#94a3b8')}
            {tarjeta('sin_ingreso', '#fbbf24')}
            {tarjeta('todos', '#cbd5e1')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Buscar por apellido, legajo o CUIL" style={{ ...control, flex: '1 1 200px', padding: '8px 10px' }} />
            <select style={control} value={etapa} onChange={e => setEtapa(e.target.value as EtapaHabilitacion | '')} aria-label="Etapa del trámite">
              <option value="">Cualquier etapa</option>
              {(Object.keys(ETAPA) as EtapaHabilitacion[]).map(k => <option key={k} value={k}>{ETAPA[k]}</option>)}
            </select>
            <select style={control} value={resp} onChange={e => setResp(e.target.value as RolResponsable | '')} aria-label="Responsable">
              <option value="">Cualquier responsable</option>
              {(Object.keys(RESPONSABLE) as RolResponsable[]).map(k => <option key={k} value={k}>{RESPONSABLE[k]}</option>)}
            </select>
            {objetivos.length > 0 && (
              <select style={control} value={objetivo} onChange={e => setObjetivo(e.target.value)} aria-label="Objetivo">
                <option value="">Todos los objetivos</option>
                {objetivos.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            <select style={control} value={orden} onChange={e => setOrden(e.target.value as OrdenTablero)} aria-label="Ordenar">
              <option value="urgencia">Más urgentes primero</option>
              <option value="seis_meses">Más cerca de los 6 meses</option>
              <option value="vencimiento">Vencimiento más próximo</option>
              <option value="apellido">Apellido</option>
            </select>
          </div>
          <div style={{ fontSize: 12.5, color: '#64748b', margin: '0 2px 6px' }}>{visibles.length} de {t.filas.length} vigiladores</div>
          {visibles.length === 0 && <div style={{ background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 14, color: '#94a3b8', fontSize: 13.5 }}>No hay vigiladores en esta lista.</div>}
          {visibles.map(f => <Fila key={f.empleado_id} f={f} />)}
          <button type="button" onClick={() => setVerResp(v => !v)} style={{ background: 'none', border: 'none', color: '#93c5fd', padding: 0, marginTop: 12, fontSize: 13, cursor: 'pointer' }}>
            {verResp ? 'Ocultar responsables habituales' : 'Responsables habituales de cada gestión'}
          </button>
          {verResp && <Responsables t={t} onCambio={() => void cargar()} />}
          <div style={{ fontSize: 12, color: '#475569', marginTop: 12 }}>
            Próxima a vencer: {t.parametros.dias_por_vencer} días · aviso de 6 meses: {t.parametros.dias_aviso_6_meses} días antes ·
            trámite demorado: {t.parametros.dias_sin_movimiento} días sin movimiento ({t.parametros.dias_presentado} si ya se presentó).
          </div>
        </>
      )}
    </div>
  )
}
