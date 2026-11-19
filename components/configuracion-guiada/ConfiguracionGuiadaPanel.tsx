'use client'

/**
 * Configurar objetivos nuevos (jefes operativos / supervisores con permiso):
 *  - Lista de objetivos activos sin protocolo y/o sin rondas.
 *  - "Completar protocolo": formulario guiado → se guarda con protocolo_guardar
 *    (ya existente) y le llega al vigilador con el aviso de protocolo.
 *  - "Pedir ronda al vigilador": el vigilador de turno marca dos puntos.
 *  - Rondas propuestas: activar ya, rechazar o cambiarla (en Rondas).
 * La parte de rondas necesita la migración 20261218120000; si no está, se avisa.
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { guardarProtocolo } from '@/lib/protocolos-datos'
import { armarProtocolo, ETIQUETA_ESTADO_RONDA_GUIADA, faltaParaActivar, faltantesProtocolo, PREGUNTAS_PROTOCOLO, RONDA_GUIADA, type EstadoRondaGuiada } from '@/lib/configuracion-guiada'

const C = { panel: '#0b1220', fondo: '#0f172a', borde: '#1e293b', texto: '#e2e8f0', sub: '#94a3b8', azul: '#2563eb', verde: '#22c55e', ambar: '#f59e0b', rojo: '#f87171' }
const card: CSSProperties = { background: C.panel, border: `1px solid ${C.borde}`, borderRadius: 10, padding: 14, marginBottom: 12, color: C.texto }
const sub: CSSProperties = { fontSize: 13, color: C.sub }
const btn: CSSProperties = { background: C.azul, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 14, cursor: 'pointer' }
const btn2: CSSProperties = { ...btn, background: C.fondo, border: `1px solid ${C.borde}`, color: C.texto }
const input: CSSProperties = { width: '100%', boxSizing: 'border-box', background: C.fondo, color: C.texto, border: `1px solid ${C.borde}`, borderRadius: 8, padding: 10, fontSize: 14, fontFamily: 'inherit' }

interface Objetivo { id: string; nombre?: string | null; cliente?: string | null; estado?: string | null; es_prueba?: boolean | null }
interface RondaGuiada {
  id: string; objetivo_id: string; estado: EstadoRondaGuiada; distancia_metros: number | null
  p1_lat: number | null; p1_lng: number | null; p2_lat: number | null; p2_lng: number | null
  activa_desde: string | null; prueba_hasta: string | null; ronda_base_id: string | null
}

export default function ConfiguracionGuiadaPanel({ objetivos, onIrARondas }: { objetivos: Objetivo[]; onIrARondas?: () => void }) {
  const [conProtocolo, setConProtocolo] = useState<Set<string> | null>(null)
  const [conRondas, setConRondas] = useState<Set<string> | null>(null)
  const [guiadas, setGuiadas] = useState<RondaGuiada[] | null>(null)
  const [migracion, setMigracion] = useState(true)
  const [formulario, setFormulario] = useState<Objetivo | null>(null)
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null)

  const cargar = useCallback(async () => {
    const [p, r, g] = await Promise.all([
      supabase.from('protocolo_versiones').select('objetivo_id').eq('estado', 'vigente'),
      supabase.from('rondas_base').select('objetivo_id').eq('activo', true),
      supabase.from('ronda_guiada').select('id, objetivo_id, estado, distancia_metros, p1_lat, p1_lng, p2_lat, p2_lng, activa_desde, prueba_hasta, ronda_base_id').order('solicitada_at', { ascending: false }),
    ])
    setConProtocolo(new Set((p.data ?? []).map((x: any) => x.objetivo_id)))
    setConRondas(new Set((r.data ?? []).map((x: any) => x.objetivo_id)))
    setMigracion(!g.error)
    setGuiadas(g.error ? [] : (g.data ?? []) as RondaGuiada[])
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  const activos = useMemo(() => objetivos.filter(o => o.estado === 'activo' && !o.es_prueba), [objetivos])
  const guiadaDe = (id: string) => guiadas?.find(g => g.objetivo_id === id && ['esperando_puntos', 'propuesta'].includes(g.estado))
  const pendientes = useMemo(() => {
    if (!conProtocolo || !conRondas) return []
    return activos.filter(o => !conProtocolo.has(o.id) || !conRondas.has(o.id))
      .sort((a, b) => Number(conProtocolo.has(a.id) || conRondas.has(a.id)) - Number(conProtocolo.has(b.id) || conRondas.has(b.id)) || (a.nombre ?? '').localeCompare(b.nombre ?? ''))
  }, [activos, conProtocolo, conRondas])
  const nombre = (id: string) => objetivos.find(o => o.id === id)?.nombre ?? 'Objetivo'

  const pedirRonda = async (o: Objetivo) => {
    const { error } = await supabase.rpc('ronda_guiada_solicitar', { p_objetivo_id: o.id })
    setMensaje(error ? { ok: false, texto: `No se pudo pedir la ronda: ${error.message}` } : { ok: true, texto: `Listo: al vigilador de turno en ${o.nombre} le va a aparecer el pedido para marcar los dos puntos.` })
    void cargar()
  }
  const decidir = async (g: RondaGuiada, accion: 'activar_ya' | 'rechazar') => {
    let motivo: string | null = null
    if (accion === 'rechazar') {
      motivo = window.prompt('¿Por qué se rechaza esta ronda?')
      if (!motivo?.trim()) return
    }
    const { error } = await supabase.rpc('ronda_guiada_decidir', { p_id: g.id, p_accion: accion, p_motivo: motivo })
    setMensaje(error ? { ok: false, texto: error.message } : { ok: true, texto: accion === 'activar_ya' ? 'Ronda activada.' : 'Ronda rechazada.' })
    void cargar()
  }

  if (formulario) return <FormularioProtocolo objetivo={formulario} onCerrar={(texto) => { setFormulario(null); if (texto) setMensaje({ ok: true, texto }); void cargar() }} />

  const propuestas = (guiadas ?? []).filter(g => g.estado === 'propuesta' || g.estado === 'esperando_puntos')
  const ahora = new Date().toISOString()

  return (
    <div>
      <div style={card}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Configurar objetivos</h2>
        <div style={sub}>Objetivos activos a los que les falta el protocolo o las rondas. Sin protocolo el vigilador no tiene instrucciones; sin rondas no hay recorridas que controlar.</div>
        {mensaje && <div style={{ marginTop: 8, fontSize: 14, color: mensaje.ok ? C.verde : C.rojo }}>{mensaje.texto}</div>}
        {!migracion && <div style={{ marginTop: 8, fontSize: 13, color: C.ambar }}>⚠ Pedir la ronda al vigilador requiere aprobar la migración 20261218120000. El protocolo ya se puede completar.</div>}
      </div>

      {propuestas.length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Rondas guiadas en curso</h3>
          <div style={{ display: 'grid', gap: 10 }}>
            {propuestas.map(g => (
              <div key={g.id} style={{ border: `1px solid ${C.borde}`, borderRadius: 8, padding: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ flex: '1 1 240px' }}>
                  <div style={{ fontWeight: 600 }}>{nombre(g.objetivo_id)}</div>
                  <div style={sub}>{ETIQUETA_ESTADO_RONDA_GUIADA[g.estado]}{g.estado === 'propuesta' && g.activa_desde ? ` · ${faltaParaActivar(g.activa_desde, ahora)}` : ''}</div>
                  {g.estado === 'propuesta' && <div style={sub}>2 puntos a {g.distancia_metros} m · cada {RONDA_GUIADA.intervaloMinutos / 60} h · primera semana de prueba{g.p1_lat != null && g.p2_lat != null && <> · <a style={{ color: '#60a5fa' }} target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/${g.p1_lat},${g.p1_lng}/${g.p2_lat},${g.p2_lng}`}>ver en el mapa</a></>}</div>}
                </div>
                {g.estado === 'propuesta' && <button style={btn} onClick={() => decidir(g, 'activar_ya')}>Activar ya</button>}
                {g.estado === 'propuesta' && onIrARondas && <button style={btn2} onClick={onIrARondas}>Cambiarla</button>}
                <button style={btn2} onClick={() => decidir(g, 'rechazar')}>Rechazar</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={card}>
        {conProtocolo == null ? <div style={sub}>Cargando…</div> : pendientes.length === 0 ? <div style={{ color: C.verde }}>Todos los objetivos activos tienen protocolo y rondas.</div> : (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={sub}>{pendientes.length} objetivos por completar</div>
            {pendientes.map(o => {
              const tieneP = conProtocolo.has(o.id), tieneR = conRondas!.has(o.id), g = guiadaDe(o.id)
              return (
                <div key={o.id} style={{ border: `1px solid ${C.borde}`, borderRadius: 8, padding: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ flex: '1 1 220px' }}>
                    <div style={{ fontWeight: 600 }}>{o.nombre}</div>
                    <div style={sub}>{o.cliente ?? ''}</div>
                    <div style={{ fontSize: 13, marginTop: 2 }}>
                      <span style={{ color: tieneP ? C.verde : C.ambar }}>{tieneP ? '✓ Protocolo' : '✗ Sin protocolo'}</span>{'  ·  '}
                      <span style={{ color: tieneR ? C.verde : C.ambar }}>{tieneR ? '✓ Rondas' : g ? '… Ronda en curso' : '✗ Sin rondas'}</span>
                    </div>
                  </div>
                  {!tieneP && <button style={btn} onClick={() => setFormulario(o)}>Completar protocolo</button>}
                  {!tieneR && !g && <button style={migracion ? btn2 : { ...btn2, opacity: 0.5, cursor: 'default' }} disabled={!migracion} onClick={() => pedirRonda(o)}>Pedir ronda al vigilador</button>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function FormularioProtocolo({ objetivo, onCerrar }: { objetivo: Objetivo; onCerrar: (mensaje?: string) => void }) {
  const [r, setR] = useState<Record<string, string>>({})
  const [paso, setPaso] = useState<'preguntas' | 'revisar'>('preguntas')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const faltan = faltantesProtocolo(r)
  const p = armarProtocolo(objetivo.nombre ?? 'Objetivo', r)

  const guardar = async () => {
    setGuardando(true); setError(null)
    const res = await guardarProtocolo({ objetivoId: objetivo.id, puestoId: null, titulo: p.titulo, texto: p.texto, baseVersionId: null, vigenteEsperada: null, confirmarObjetivo: true })
    setGuardando(false)
    if (res.error) setError(res.error)
    else onCerrar(`Protocolo de ${objetivo.nombre} guardado. Los vigiladores lo van a ver al entrar al turno y deberán confirmar que lo leyeron.`)
  }

  return (
    <div style={card}>
      <button style={{ ...btn2, marginBottom: 10 }} onClick={() => onCerrar()}>← Volver</button>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Protocolo de {objetivo.nombre}</h2>
      {paso === 'preguntas' ? (
        <>
          <div style={{ ...sub, marginBottom: 12 }}>Respondé con tus palabras. Con esto se arma el protocolo que va a leer el vigilador. Las marcadas con * son obligatorias.</div>
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
          <div style={{ ...sub, marginBottom: 8 }}>Así lo va a ver el vigilador. Si está bien, guardalo: queda vigente para este objetivo.</div>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, background: C.fondo, border: `1px solid ${C.borde}`, borderRadius: 8, padding: 12, margin: 0 }}>{p.texto}</pre>
          {error && <div style={{ color: C.rojo, marginTop: 8 }}>{error}</div>}
          <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
            <button style={btn2} onClick={() => setPaso('preguntas')}>Corregir</button>
            <button style={btn} disabled={guardando} onClick={guardar}>{guardando ? 'Guardando…' : 'Guardar protocolo'}</button>
          </div>
        </>
      )}
    </div>
  )
}
