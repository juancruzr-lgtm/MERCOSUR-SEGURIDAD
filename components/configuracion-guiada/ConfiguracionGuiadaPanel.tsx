'use client'

/**
 * Configurar objetivos (supervisores de zona, jefes, dirección y Gerencia).
 *
 *  - Por aprobar (quien aprueba protocolos): protocolos enviados desde el
 *    formulario → Aprobar (queda vigente y le llega al vigilador) o Devolver
 *    con motivo.
 *  - Rondas configuradas: activas (mapa, datos, desactivar con motivo) y las
 *    que no se pudieron validar (motivo, volver a pedir).
 *  - Objetivos por completar: "Completar protocolo" (formulario guiado →
 *    enviar a aprobación) y la marca "La ronda la crea el vigilador": al
 *    tildarla, la app se lo pide al vigilador de turno (ya esté trabajando o
 *    cuando entre); se puede destildar mientras no la haya creado.
 *
 * Todo lo que escribe pasa por RPC con permisos en el servidor
 * (migración 20261218120000; si no está aplicada, se avisa).
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { hacerVigente } from '@/lib/protocolos-datos'
import {
  armarProtocolo, ETIQUETA_ESTADO_RONDA_GUIADA, faltantesProtocolo, MOTIVOS_PROBLEMA, PREGUNTAS_PROTOCOLO,
  textoFrecuencia, type EstadoRondaGuiada, type MotivoProblema,
} from '@/lib/configuracion-guiada'

const C = { panel: '#0b1220', fondo: '#0f172a', borde: '#1e293b', texto: '#e2e8f0', sub: '#94a3b8', azul: '#2563eb', verde: '#22c55e', ambar: '#f59e0b', rojo: '#f87171' }
const card: CSSProperties = { background: C.panel, border: `1px solid ${C.borde}`, borderRadius: 10, padding: 14, marginBottom: 12, color: C.texto }
const sub: CSSProperties = { fontSize: 13, color: C.sub }
const btn: CSSProperties = { background: C.azul, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 14, cursor: 'pointer' }
const btn2: CSSProperties = { ...btn, background: C.fondo, border: `1px solid ${C.borde}`, color: C.texto }
const input: CSSProperties = { width: '100%', boxSizing: 'border-box', background: C.fondo, color: C.texto, border: `1px solid ${C.borde}`, borderRadius: 8, padding: 10, fontSize: 14, fontFamily: 'inherit' }
const item: CSSProperties = { border: `1px solid ${C.borde}`, borderRadius: 8, padding: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }

interface Objetivo { id: string; nombre?: string | null; cliente?: string | null; estado?: string | null; es_prueba?: boolean | null }
interface Version { id: string; objetivo_id: string; puesto_id: string | null; estado: string; titulo: string; texto: string; devuelto_motivo: string | null }
interface Guiada {
  id: string; objetivo_id: string; estado: EstadoRondaGuiada; distancia_metros: number | null; frecuencia_minutos: number | null
  p1_lat: number | null; p1_lng: number | null; p2_lat: number | null; p2_lng: number | null; activada_at: string | null
  motivo_revision: MotivoProblema | null; detalle_revision: string | null; capturada_por: string | null
}

export default function ConfiguracionGuiadaPanel({ objetivos, puedeAprobar, nombrePersona, onIrARondas }: {
  objetivos: Objetivo[]
  /** Jefe de supervisores, Dirección operativa, Gerencia o Administración. */
  puedeAprobar: boolean
  nombrePersona: (id: string | null) => string
  onIrARondas?: () => void
}) {
  const [versiones, setVersiones] = useState<Version[] | null>(null)
  const [conRondas, setConRondas] = useState<Set<string>>(new Set())
  const [guiadas, setGuiadas] = useState<Guiada[]>([])
  const [migracion, setMigracion] = useState(true)
  const [formulario, setFormulario] = useState<Objetivo | null>(null)
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null)
  const [motivo, setMotivo] = useState<{ id: string; tipo: 'devolver' | 'desactivar'; texto: string } | null>(null)

  const cargar = useCallback(async () => {
    const [v, r, g] = await Promise.all([
      supabase.from('protocolo_versiones').select('id, objetivo_id, puesto_id, estado, titulo, texto, devuelto_motivo').in('estado', ['vigente', 'pendiente_aprobacion', 'borrador']),
      supabase.from('rondas_base').select('objetivo_id').eq('activo', true),
      supabase.from('ronda_guiada').select('id, objetivo_id, estado, distancia_metros, frecuencia_minutos, p1_lat, p1_lng, p2_lat, p2_lng, activada_at, motivo_revision, detalle_revision, capturada_por').order('solicitada_at', { ascending: false }),
    ])
    setVersiones((v.data ?? []) as Version[])
    setConRondas(new Set((r.data ?? []).map((x: any) => x.objetivo_id)))
    setMigracion(!g.error)
    setGuiadas(g.error ? [] : (g.data ?? []) as Guiada[])
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  const nombre = (id: string) => objetivos.find(o => o.id === id)?.nombre ?? 'Objetivo'
  const aviso = (ok: boolean, texto: string) => { setMensaje({ ok, texto }); void cargar() }
  const estadoProtocolo = (id: string): { tipo: 'vigente' | 'pendiente' | 'devuelto' | 'falta'; v?: Version } => {
    const vs = (versiones ?? []).filter(v => v.objetivo_id === id)
    if (vs.some(v => v.estado === 'vigente')) return { tipo: 'vigente' }
    const p = vs.find(v => v.estado === 'pendiente_aprobacion'); if (p) return { tipo: 'pendiente', v: p }
    const d = vs.find(v => v.estado === 'borrador' && v.devuelto_motivo); if (d) return { tipo: 'devuelto', v: d }
    return { tipo: 'falta' }
  }
  const pedido = (id: string) => guiadas.find(g => g.objetivo_id === id && (g.estado === 'esperando_puntos' || g.estado === 'requiere_revision'))

  const activos = useMemo(() => objetivos.filter(o => o.estado === 'activo' && !o.es_prueba), [objetivos])
  const pendientes = useMemo(() => activos.filter(o => estadoProtocolo(o.id).tipo !== 'vigente' || !conRondas.has(o.id))
    .sort((a, b) => (a.nombre ?? '').localeCompare(b.nombre ?? '')), [activos, versiones, conRondas]) // eslint-disable-line react-hooks/exhaustive-deps
  const porAprobar = (versiones ?? []).filter(v => v.estado === 'pendiente_aprobacion')
  const configuradas = guiadas.filter(g => g.estado === 'activa' || g.estado === 'requiere_revision')

  const aprobar = async (v: Version) => {
    const vigente = (versiones ?? []).find(x => x.objetivo_id === v.objetivo_id && x.puesto_id === v.puesto_id && x.estado === 'vigente')
    const r = await hacerVigente(v.id, vigente?.id ?? null, true)
    aviso(!r.error, r.error ?? `Protocolo de ${nombre(v.objetivo_id)} aprobado. Los vigiladores lo van a ver al entrar al turno y deberán confirmar que lo leyeron.`)
  }
  const confirmarMotivo = async () => {
    if (!motivo || !motivo.texto.trim()) return
    const { error } = motivo.tipo === 'devolver'
      ? await supabase.rpc('protocolo_guiado_devolver', { p_version_id: motivo.id, p_motivo: motivo.texto.trim() })
      : await supabase.rpc('ronda_guiada_desactivar', { p_id: motivo.id, p_motivo: motivo.texto.trim() })
    setMotivo(null)
    aviso(!error, error?.message ?? (motivo.tipo === 'devolver' ? 'Protocolo devuelto al supervisor con el motivo.' : 'Listo, quedó desactivada. Lo ya registrado no se borra.'))
  }
  const marcarVigilador = async (o: Objetivo, marcar: boolean) => {
    if (marcar) {
      const { error } = await supabase.rpc('ronda_guiada_solicitar', { p_objetivo_id: o.id })
      aviso(!error, error?.message ?? `Listo: al vigilador de ${o.nombre} le va a aparecer el pedido para crear la ronda (si ya está de turno, en unos minutos).`)
    } else {
      const g = pedido(o.id)
      if (!g) return
      const { error } = await supabase.rpc('ronda_guiada_desactivar', { p_id: g.id, p_motivo: 'Pedido cancelado por supervisión' })
      aviso(!error, error?.message ?? `Se canceló el pedido de ronda para ${o.nombre}.`)
    }
  }

  if (formulario) return <FormularioProtocolo objetivo={formulario} previo={estadoProtocolo(formulario.id).v} onCerrar={t => { setFormulario(null); if (t) aviso(true, t) }} />

  const CajaMotivo = ({ id, tipo, titulo }: { id: string; tipo: 'devolver' | 'desactivar'; titulo: string }) =>
    motivo?.id === id ? (
      <div style={{ flexBasis: '100%', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input autoFocus style={{ ...input, flex: '1 1 220px' }} placeholder={titulo} value={motivo.texto} onChange={e => setMotivo({ ...motivo, texto: e.target.value })} />
        <button style={btn} disabled={!motivo.texto.trim()} onClick={confirmarMotivo}>Confirmar</button>
        <button style={btn2} onClick={() => setMotivo(null)}>Cancelar</button>
      </div>
    ) : <button style={btn2} onClick={() => setMotivo({ id, tipo, texto: '' })}>{tipo === 'devolver' ? 'Devolver' : 'Desactivar…'}</button>

  return (
    <div>
      <div style={card}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Configurar objetivos</h2>
        <div style={sub}>Cada objetivo necesita su protocolo y su ronda. El supervisor de la zona completa el protocolo y marca que la ronda la cree el vigilador; la app se lo pide al vigilador de turno.</div>
        {mensaje && <div style={{ marginTop: 8, fontSize: 14, color: mensaje.ok ? C.verde : C.rojo }}>{mensaje.texto}</div>}
        {!migracion && <div style={{ marginTop: 8, fontSize: 13, color: C.ambar }}>⚠ Falta aplicar la migración 20261218120000: por ahora no se pueden enviar protocolos ni pedir rondas desde acá.</div>}
      </div>

      {puedeAprobar && porAprobar.length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Protocolos por aprobar · {porAprobar.length}</h3>
          <div style={{ display: 'grid', gap: 10 }}>
            {porAprobar.map(v => (
              <div key={v.id} style={{ ...item, alignItems: 'stretch', flexDirection: 'column' }}>
                <div style={{ fontWeight: 600 }}>{nombre(v.objetivo_id)}</div>
                <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, background: C.fondo, borderRadius: 8, padding: 10, margin: 0, maxHeight: 220, overflow: 'auto' }}>{v.texto}</pre>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={btn} onClick={() => aprobar(v)}>Aprobar</button>
                  <CajaMotivo id={v.id} tipo="devolver" titulo="¿Qué hay que corregir?" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {configuradas.length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Rondas creadas por vigiladores</h3>
          <div style={{ display: 'grid', gap: 10 }}>
            {configuradas.map(g => (
              <div key={g.id} style={item}>
                <div style={{ flex: '1 1 260px' }}>
                  <div style={{ fontWeight: 600 }}>{nombre(g.objetivo_id)} <span style={{ fontSize: 12, color: g.estado === 'activa' ? C.verde : C.ambar }}>· {ETIQUETA_ESTADO_RONDA_GUIADA[g.estado]}</span></div>
                  {g.estado === 'activa' ? (
                    <div style={sub}>Configuró {nombrePersona(g.capturada_por)} · {g.activada_at ? new Date(g.activada_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : ''} · {g.distancia_metros} m entre puntos · {textoFrecuencia(g.frecuencia_minutos ?? 120)}
                      {g.p1_lat != null && g.p2_lat != null && <> · <a style={{ color: '#60a5fa' }} target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/${g.p1_lat},${g.p1_lng}/${g.p2_lat},${g.p2_lng}`}>ver en el mapa</a></>}</div>
                  ) : (
                    <div style={sub}>{nombrePersona(g.capturada_por)} no pudo crearla: {MOTIVOS_PROBLEMA[g.motivo_revision ?? 'otro']}{g.detalle_revision ? ` (${g.detalle_revision})` : ''}. No se activó ninguna ronda.</div>
                  )}
                </div>
                {g.estado === 'activa' && onIrARondas && <button style={btn2} onClick={onIrARondas}>Cambiar puntos o frecuencia</button>}
                {g.estado === 'requiere_revision' && <button style={btn} onClick={async () => { const { error } = await supabase.rpc('ronda_guiada_solicitar', { p_objetivo_id: g.objetivo_id }); aviso(!error, error?.message ?? 'Se le vuelve a pedir al vigilador.') }}>Volver a pedírselo al vigilador</button>}
                <CajaMotivo id={g.id} tipo="desactivar" titulo="Motivo (queda registrado)" />
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={card}>
        {versiones == null ? <div style={sub}>Cargando…</div> : pendientes.length === 0 ? <div style={{ color: C.verde }}>Todos los objetivos activos tienen protocolo y ronda.</div> : (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={sub}>{pendientes.length} objetivos por completar</div>
            {pendientes.map(o => {
              const p = estadoProtocolo(o.id), tieneR = conRondas.has(o.id), g = pedido(o.id)
              const textoP = { vigente: '✓ Protocolo', pendiente: '… Protocolo esperando aprobación', devuelto: `↩ Protocolo devuelto: ${p.v?.devuelto_motivo ?? ''}`, falta: '✗ Sin protocolo' }[p.tipo]
              return (
                <div key={o.id} style={item}>
                  <div style={{ flex: '1 1 240px' }}>
                    <div style={{ fontWeight: 600 }}>{o.nombre}</div>
                    <div style={sub}>{o.cliente ?? ''}</div>
                    <div style={{ fontSize: 13, marginTop: 2, display: 'grid', gap: 2 }}>
                      <span style={{ color: p.tipo === 'vigente' ? C.verde : C.ambar }}>{textoP}</span>
                      <span style={{ color: tieneR ? C.verde : C.ambar }}>{tieneR ? '✓ Ronda activa' : g?.estado === 'esperando_puntos' ? '… Esperando que el vigilador cree la ronda' : g?.estado === 'requiere_revision' ? '⚠ El vigilador no pudo crear la ronda' : '✗ Sin ronda'}</span>
                    </div>
                  </div>
                  {(p.tipo === 'falta' || p.tipo === 'devuelto') && <button style={migracion ? btn : { ...btn, opacity: 0.5 }} disabled={!migracion} onClick={() => setFormulario(o)}>{p.tipo === 'devuelto' ? 'Corregir protocolo' : 'Completar protocolo'}</button>}
                  {!tieneR && g?.estado !== 'requiere_revision' && (
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, cursor: migracion ? 'pointer' : 'default', opacity: migracion ? 1 : 0.5 }}>
                      <input type="checkbox" disabled={!migracion} checked={g?.estado === 'esperando_puntos'} onChange={e => marcarVigilador(o, e.target.checked)} style={{ width: 18, height: 18 }} />
                      La ronda la crea el vigilador
                    </label>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function FormularioProtocolo({ objetivo, previo, onCerrar }: { objetivo: Objetivo; previo?: Version; onCerrar: (mensaje?: string) => void }) {
  const [r, setR] = useState<Record<string, string>>({})
  const [paso, setPaso] = useState<'preguntas' | 'revisar'>('preguntas')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const faltan = faltantesProtocolo(r)
  const p = armarProtocolo(objetivo.nombre ?? 'Objetivo', r)

  const enviar = async () => {
    setGuardando(true); setError(null)
    const { error } = await supabase.rpc('protocolo_guiado_enviar', { p_objetivo_id: objetivo.id, p_titulo: p.titulo, p_texto: p.texto })
    setGuardando(false)
    if (error) setError(error.message)
    else onCerrar(`Protocolo de ${objetivo.nombre} enviado a aprobación. Lo aprueba el Jefe de supervisores, el Director técnico o Gerencia.`)
  }

  return (
    <div style={card}>
      <button style={{ ...btn2, marginBottom: 10 }} onClick={() => onCerrar()}>← Volver</button>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Protocolo de {objetivo.nombre}</h2>
      {previo?.devuelto_motivo && <div style={{ color: C.ambar, fontSize: 14, marginBottom: 8 }}>Lo devolvieron: {previo.devuelto_motivo}</div>}
      {paso === 'preguntas' ? (
        <>
          <div style={{ ...sub, marginBottom: 12 }}>Respondé con tus palabras. El protocolo se arma sólo con lo que escribas. Las marcadas con * son obligatorias.</div>
          <div style={{ display: 'grid', gap: 14 }}>
            {PREGUNTAS_PROTOCOLO.map(q => (
              <label key={q.clave} style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{q.titulo}{q.obligatoria ? ' *' : ''}</span>
                <span style={sub}>{q.ayuda}</span>
                <textarea rows={3} style={input} value={r[q.clave] ?? ''} onChange={e => setR({ ...r, [q.clave]: e.target.value })} />
              </label>
            ))}
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button style={faltan.length ? { ...btn, opacity: 0.5, cursor: 'default' } : btn} disabled={faltan.length > 0} onClick={() => setPaso('revisar')}>Revisar el protocolo</button>
            {faltan.length > 0 && <span style={sub}>Falta: {faltan.join(', ')}</span>}
          </div>
        </>
      ) : (
        <>
          <div style={{ ...sub, marginBottom: 8 }}>Así lo va a leer el vigilador cuando esté aprobado.</div>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, background: C.fondo, border: `1px solid ${C.borde}`, borderRadius: 8, padding: 12, margin: 0 }}>{p.texto}</pre>
          {error && <div style={{ color: C.rojo, marginTop: 8 }}>{error}</div>}
          <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
            <button style={btn2} onClick={() => setPaso('preguntas')}>Corregir</button>
            <button style={btn} disabled={guardando} onClick={enviar}>{guardando ? 'Enviando…' : 'Enviar a aprobación'}</button>
          </div>
        </>
      )}
    </div>
  )
}
