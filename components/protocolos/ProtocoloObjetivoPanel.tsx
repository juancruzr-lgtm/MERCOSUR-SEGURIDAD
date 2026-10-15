'use client'

/**
 * components/protocolos/ProtocoloObjetivoPanel.tsx
 *
 * Protocolo del servicio, arriba de todo en la ficha del objetivo
 * (CentroOperativoObjetivo) y en el control general (ControlProtocolos).
 *
 * ── Regla (Gerencia, 15/10): la última versión guardada rige ────────────────
 * Se ve el texto que rige —lo que leen los vigiladores— completo. «Editar» y
 * «Guardar» deja el texto nuevo vigente en el acto; la versión anterior queda
 * en el historial y se puede volver a ella. No hay circuito de aprobación ni
 * registro de diferencias.
 *
 * Si todavía no rige ninguna versión (por ejemplo, la carga original de
 * Aldo), se muestra el último borrador marcado como tal, con «Que rija este
 * texto». Guardar o hacer regir un texto en la ficha de este objetivo confirma
 * que es de este objetivo.
 *
 * Quién puede cambiarlo lo decide la base (protocolo_puede_preparar:
 * Administración, Gerencia, jefatura de supervisores y dirección operativa,
 * dentro de su alcance). El resto lo lee.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { compararLineas, fechaHoraAR, separarLecturas, vistaProtocolo } from '@/lib/protocolos'
import type { AlcanceProtocolo, LecturaProtocolo, PanelObjetivo, VersionProtocolo } from '@/lib/protocolos'
import { cargarPanelObjetivo, guardarProtocolo, hacerVigente } from '@/lib/protocolos-datos'

const card: React.CSSProperties = {
  background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 16, marginBottom: 14,
}
const etiqueta: React.CSSProperties = { fontSize: 10.5, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em' }
const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#0a0e1a', border: '1px solid #1e2d42',
  color: '#e2e8f0', borderRadius: 8, padding: '8px 10px', fontSize: 13.5, fontFamily: 'inherit',
}
const boton = (tono: 'primario' | 'secundario' = 'secundario'): React.CSSProperties => ({
  border: tono === 'secundario' ? '1px solid #334155' : 'none', borderRadius: 8, padding: '7px 12px',
  fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  background: tono === 'primario' ? '#f59e0b' : 'transparent',
  color: tono === 'primario' ? '#1a1205' : '#cbd5e1',
})
const textoDoc: React.CSSProperties = {
  whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 14.5, lineHeight: 1.65, color: '#e2e8f0',
  background: '#0a0e1a', border: '1px solid #1e2d42', borderRadius: 8, padding: '14px 16px',
}
const desplegable: React.CSSProperties = {
  border: '1px solid #1e2d42', borderRadius: 8, padding: '10px 12px', marginTop: 10, background: '#0f172a',
}
const resumenDesplegable: React.CSSProperties = { cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: '#cbd5e1' }

type Mensaje = { texto: string; tipo: 'ok' | 'error' } | null

/** Rótulo corto de una versión para pestañas, historial y comparación. */
export function rotuloVersion(v: Pick<VersionProtocolo, 'numero' | 'estado' | 'aprobado_at' | 'reemplazado_at'>): string {
  if (v.estado === 'vigente') return `v${v.numero} · rige desde ${fechaHoraAR(v.aprobado_at).slice(0, 10)}`
  if (v.estado === 'reemplazado') return `v${v.numero} · rigió hasta ${fechaHoraAR(v.reemplazado_at).slice(0, 10)}`
  if (v.estado === 'descartado') return `v${v.numero} · descartada`
  return `v${v.numero} · borrador`
}

/** La versión a mostrar en un alcance: la que rige; si no hay, el último borrador. */
export function versionAMostrar(a: AlcanceProtocolo): VersionProtocolo | null {
  return a.vigente ?? a.trabajo[0] ?? null
}

export default function ProtocoloObjetivoPanel({ objetivoId }: { objetivoId: string }) {
  const [panel, setPanel] = useState<PanelObjetivo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [mensaje, setMensaje] = useState<Mensaje>(null)
  const [alcanceSel, setAlcanceSel] = useState<string | null>(null)
  const [escribiendo, setEscribiendo] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await cargarPanelObjetivo(objetivoId)
    setCargando(false)
    if (r.error) { setError(r.error); setPanel(null); return }
    setError(null)
    setPanel(r.data)
  }, [objetivoId])

  useEffect(() => { void cargar() }, [cargar])

  const alcances = useMemo(() => vistaProtocolo(panel?.versiones ?? []), [panel])
  const alcance = alcances.find(a => a.clave === alcanceSel) ?? alcances[0] ?? null
  const vigentes = useMemo(() => (panel?.versiones ?? []).filter(v => v.estado === 'vigente'), [panel])

  if (cargando && !panel) return <div style={card} id="protocolo-objetivo"><div style={{ color: '#64748b', fontSize: 13 }}>Cargando protocolo…</div></div>
  if (error) {
    return (
      <div style={card} id="protocolo-objetivo">
        <div style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0', marginBottom: 6 }}>📋 Protocolo del servicio</div>
        <div style={{ color: /permiso/i.test(error) ? '#94a3b8' : '#f87171', fontSize: 13 }}>
          {/permiso/i.test(error) ? 'No tenés acceso al protocolo de este objetivo.' : `No se pudo cargar: ${error}`}
        </div>
      </div>
    )
  }
  if (!panel) return null
  const puedeCambiar = panel.permisos.preparar

  const alGuardar = async (texto: string) => { setMensaje({ texto, tipo: 'ok' }); await cargar() }

  return (
    <div style={card} id="protocolo-objetivo">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0', flex: 1 }}>📋 Protocolo del servicio</div>
      </div>

      {mensaje && (
        <div role="status" style={{
          marginTop: 10, fontSize: 13, padding: '8px 10px', borderRadius: 8,
          background: mensaje.tipo === 'ok' ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)',
          color: mensaje.tipo === 'ok' ? '#4ade80' : '#f87171',
        }}>{mensaje.texto}</div>
      )}

      {alcances.length === 0 && (
        !escribiendo ? (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13.5, color: '#94a3b8' }}>Este objetivo todavía no tiene protocolo escrito.</div>
            {puedeCambiar && <button type="button" style={{ ...boton('primario'), marginTop: 10 }} onClick={() => setEscribiendo(true)}>Escribir el protocolo</button>}
          </div>
        ) : (
          <Editor
            objetivoId={objetivoId} base={null}
            onCancelar={() => setEscribiendo(false)}
            onError={t => setMensaje({ texto: t, tipo: 'error' })}
            onGuardado={async () => { setEscribiendo(false); await alGuardar('Guardado: es lo que leen los vigiladores desde ahora.') }}
          />
        )
      )}

      {alcances.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }} role="tablist" aria-label="Alcance del protocolo">
          {alcances.map(a => {
            const activo = a.clave === alcance?.clave
            return (
              <button key={a.clave} type="button" role="tab" aria-selected={activo}
                onClick={() => setAlcanceSel(a.clave)}
                style={{ ...boton(), borderColor: activo ? '#f59e0b' : '#334155', color: activo ? '#fbbf24' : '#94a3b8' }}>
                {a.puesto_id ? `Puesto ${a.puesto_nombre ?? ''}` : 'Todo el objetivo'}
              </button>
            )
          })}
        </div>
      )}

      {alcance && (
        <Documento
          key={alcance.clave}
          objetivoId={objetivoId}
          alcance={alcance}
          versiones={panel.versiones.filter(v => (v.puesto_id ?? 'objetivo') === alcance.clave)}
          puedeCambiar={puedeCambiar}
          onError={t => setMensaje({ texto: t, tipo: 'error' })}
          onGuardado={alGuardar}
        />
      )}

      {vigentes.length > 0 && (
        <details style={desplegable}>
          <summary style={resumenDesplegable}>Lecturas del personal</summary>
          {vigentes.map(v => (
            <div key={v.id} style={{ marginTop: 8 }}>
              {vigentes.length > 1 && <div style={{ fontSize: 12.5, color: '#94a3b8' }}>v{v.numero}{v.puesto_nombre ? ` · ${v.puesto_nombre}` : ' · todo el objetivo'}</div>}
              <Lecturas lecturas={panel.lecturas} versionId={v.id} />
            </div>
          ))}
        </details>
      )}
    </div>
  )
}

// ── Documento: lo que rige, editar, comparar e historial ────────────────────

// Exportado para las pruebas de pantalla.
export function Documento({ objetivoId, alcance, versiones, puedeCambiar, onError, onGuardado }: {
  objetivoId: string
  alcance: AlcanceProtocolo
  versiones: VersionProtocolo[]
  puedeCambiar: boolean
  onError: (texto: string) => void
  onGuardado: (texto: string) => Promise<void>
}) {
  // Sin vigente y con varios borradores (Rapsodia), se elige cuál mirar.
  const [verId, setVerId] = useState<string | null>(null)
  const v = alcance.vigente ?? alcance.trabajo.find(t => t.id === verId) ?? versionAMostrar(alcance)
  const [editando, setEditando] = useState(false)
  const [completo, setCompleto] = useState(false)
  const [compararCon, setCompararCon] = useState<string | null>(null)
  const [verTexto, setVerTexto] = useState<Record<string, boolean>>({})
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => { setEditando(false); setCompararCon(null) }, [v?.id])
  if (!v) return null

  const otras = versiones.filter(o => o.id !== v.id && o.estado !== 'descartado')
  const contra = otras.find(o => o.id === compararCon) ?? null
  const lineas = contra ? compararLineas(contra.texto, v.texto) : null
  const rige = v.estado === 'vigente'
  const pendientes = alcance.vigente ? alcance.trabajo : []

  const hacerRegir = async (id: string) => {
    setOcupado(true)
    const r = await hacerVigente(id)
    setOcupado(false)
    if (r.error) onError(r.error)
    else await onGuardado('Listo: es lo que leen los vigiladores desde ahora.')
  }
  const volverA = async (o: VersionProtocolo) => {
    setOcupado(true)
    const r = await guardarProtocolo({ objetivoId, puestoId: o.puesto_id, titulo: o.titulo, texto: o.texto, baseVersionId: o.id })
    setOcupado(false)
    if (r.error) onError(r.error)
    else await onGuardado(`Volvió a regir el texto de la v${o.numero} (guardado como versión nueva).`)
  }

  return (
    <div style={{ marginTop: 12 }}>
      {!alcance.vigente && alcance.trabajo.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }} role="tablist" aria-label="Borradores">
          {alcance.trabajo.map(t => (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === v.id} onClick={() => setVerId(t.id)}
              style={{ ...boton(), borderColor: t.id === v.id ? '#f59e0b' : '#334155', color: t.id === v.id ? '#fbbf24' : '#94a3b8' }}>
              {rotuloVersion(t)}
            </button>
          ))}
        </div>
      )}

      <div style={{
        border: `1px solid ${rige ? '#10b981' : '#64748b'}`, background: rige ? 'rgba(16,185,129,.08)' : 'rgba(148,163,184,.08)',
        borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#e2e8f0', lineHeight: 1.5,
      }}>
        {rige
          ? <>Rige desde el {fechaHoraAR(v.aprobado_at)}{v.aprobado_por_nombre ? ` (lo dejó ${v.aprobado_por_nombre})` : ''}. Es lo que leen los vigiladores.</>
          : <>Borrador: todavía no rige ninguna versión y los vigiladores no ven nada.{alcance.trabajo.length > 1 ? ' Hay más de un borrador: elegí cuál rige.' : ''}</>}
      </div>

      <div style={{ display: 'flex', gap: '4px 14px', flexWrap: 'wrap', fontSize: 12, color: '#94a3b8', margin: '10px 0 8px' }}>
        <span><strong style={{ color: '#e2e8f0' }}>v{v.numero} · {v.titulo}</strong>{v.puesto_nombre ? ` · sólo ${v.puesto_nombre}` : ''}</span>
        <span style={{ overflowWrap: 'anywhere' }}>Fuente: {v.fuente_descripcion}</span>
      </div>

      {editando ? (
        <Editor objetivoId={objetivoId} base={v}
          onCancelar={() => setEditando(false)} onError={onError}
          onGuardado={async () => { setEditando(false); await onGuardado('Guardado: es lo que leen los vigiladores desde ahora. La versión anterior quedó en el historial.') }} />
      ) : lineas ? (
        <div style={{ ...textoDoc, padding: 0, overflow: 'hidden' }} aria-label={`Cambios entre v${contra!.numero} y v${v.numero}`}>
          {lineas.map((l, i) => (
            <div key={i} style={{
              padding: '1px 16px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
              background: l.tipo === 'agregada' ? 'rgba(16,185,129,.14)' : l.tipo === 'quitada' ? 'rgba(239,68,68,.14)' : 'transparent',
              color: l.tipo === 'quitada' ? '#fca5a5' : l.tipo === 'agregada' ? '#86efac' : '#cbd5e1',
              textDecoration: l.tipo === 'quitada' ? 'line-through' : 'none',
            }}>
              <span aria-hidden style={{ display: 'inline-block', width: 14, color: '#64748b' }}>{l.tipo === 'agregada' ? '+' : l.tipo === 'quitada' ? '−' : ''}</span>
              {l.texto || ' '}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ ...textoDoc, maxHeight: completo ? 'none' : '60vh', overflowY: completo ? 'visible' : 'auto' }}>{v.texto}</div>
      )}

      {!editando && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
          {puedeCambiar && <button type="button" style={boton('primario')} onClick={() => { setEditando(true); setCompararCon(null) }}>Editar</button>}
          {puedeCambiar && !rige && (
            <button type="button" style={boton()} disabled={ocupado} onClick={() => void hacerRegir(v.id)}>
              {ocupado ? 'Guardando…' : 'Que rija este texto'}
            </button>
          )}
          {!lineas && <button type="button" style={boton()} onClick={() => setCompleto(c => !c)}>{completo ? 'Ver en recuadro' : 'Ver todo sin recuadro'}</button>}
          {otras.length > 0 && (
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: '#94a3b8' }}>
              Comparar con
              <select id="protocolo-comparar" style={{ ...input, width: 'auto', padding: '6px 8px', fontSize: 12.5 }}
                value={compararCon ?? ''} onChange={e => setCompararCon(e.target.value || null)}>
                <option value="">—</option>
                {otras.map(o => <option key={o.id} value={o.id}>{rotuloVersion(o)}</option>)}
              </select>
            </label>
          )}
        </div>
      )}

      {pendientes.length > 0 && (
        <div style={{ fontSize: 12.5, color: '#fbbf24', marginTop: 8 }}>
          {pendientes.length === 1 ? 'Hay un borrador que no rige' : `Hay ${pendientes.length} borradores que no rigen`}: está en el historial por si se quiere usar.
        </div>
      )}

      {versiones.length > 1 && (
        <details style={desplegable}>
          <summary style={resumenDesplegable}>Historial de versiones ({versiones.length})</summary>
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            {[...versiones].sort((a, b) => b.numero - a.numero).map(o => (
              <div key={o.id} style={{ border: '1px solid #1e2d42', borderRadius: 8, padding: 10, background: '#0b1220', minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: o.estado === 'vigente' ? '#4ade80' : '#e2e8f0' }}>{rotuloVersion(o)}</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2, overflowWrap: 'anywhere' }}>{o.fuente_descripcion}</div>
                {(o.estado === 'vigente' || o.estado === 'reemplazado') && (
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{o.aperturas} abrieron · {o.confirmaciones} confirmaron la lectura</div>
                )}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  <button type="button" style={boton()} onClick={() => setVerTexto(s => ({ ...s, [o.id]: !s[o.id] }))}>{verTexto[o.id] ? 'Ocultar texto' : 'Ver texto'}</button>
                  {puedeCambiar && o.estado !== 'vigente' && o.estado !== 'descartado' && (
                    <button type="button" style={boton()} disabled={ocupado}
                      onClick={() => void (o.estado === 'reemplazado' ? volverA(o) : hacerRegir(o.id))}>
                      {o.estado === 'reemplazado' ? 'Volver a esta versión' : 'Que rija este texto'}
                    </button>
                  )}
                </div>
                {verTexto[o.id] && <div style={{ ...textoDoc, marginTop: 8, maxHeight: 360, overflowY: 'auto' }}>{o.texto}</div>}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

// ── Editor: guardar = rige ──────────────────────────────────────────────────

function Editor({ objetivoId, base, onCancelar, onError, onGuardado }: {
  objetivoId: string
  base: VersionProtocolo | null
  onCancelar: () => void
  onError: (texto: string) => void
  onGuardado: () => Promise<void>
}) {
  const [titulo, setTitulo] = useState(base?.titulo ?? 'Funciones y procedimientos')
  const [texto, setTexto] = useState(base?.texto ?? '')
  const [guardando, setGuardando] = useState(false)
  const sinCambios = base ? titulo.trim() === base.titulo && texto === base.texto : false
  const valido = titulo.trim() && texto.trim() && !sinCambios

  const guardar = async () => {
    setGuardando(true)
    const r = await guardarProtocolo({
      objetivoId, puestoId: base ? base.puesto_id : null,
      titulo: titulo.trim(), texto, baseVersionId: base?.id ?? null,
    })
    setGuardando(false)
    if (r.error) onError(r.error)
    else await onGuardado()
  }

  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
      <div style={{ fontSize: 12.5, color: '#93c5fd', lineHeight: 1.5 }}>
        Al guardar, este texto es lo que leen los vigiladores desde ese momento (se les pide confirmar la lectura de nuevo).
        {base ? ' La versión actual queda en el historial.' : ''}
      </div>
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={etiqueta}>Título</span>
        <input id="protocolo-editar-titulo" style={input} value={titulo} onChange={e => setTitulo(e.target.value)} />
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={etiqueta}>Texto completo</span>
        <textarea id="protocolo-editar-texto" style={{ ...input, minHeight: 360, lineHeight: 1.6, fontSize: 14 }}
          value={texto} onChange={e => setTexto(e.target.value)} />
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={{ ...boton('primario'), opacity: valido && !guardando ? 1 : 0.5 }} disabled={!valido || guardando} onClick={() => void guardar()}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <button type="button" style={boton()} onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}

// ── Lecturas ────────────────────────────────────────────────────────────────

function Lecturas({ lecturas, versionId }: { lecturas: LecturaProtocolo[]; versionId: string }) {
  const { confirmaron, abrieronSinConfirmar, sinAbrir } = separarLecturas(lecturas, versionId)
  const total = confirmaron.length + abrieronSinConfirmar.length + sinAbrir.length
  const fila = (l: LecturaProtocolo, detalle: string) => (
    <div key={l.empleado_id} style={{ fontSize: 12.5, color: '#cbd5e1', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <a href={`/guardias/${l.empleado_id}`} style={{ color: '#e2e8f0', fontWeight: 600 }}>{l.apellido}, {l.nombre}</a>
      <span style={{ color: '#64748b' }}>{detalle}</span>
    </div>
  )
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 6 }}>
        Vigiladores con turnos en los últimos 30 días o los próximos 7: <strong style={{ color: '#e2e8f0' }}>{total}</strong> ·
        confirmaron <strong style={{ color: '#4ade80' }}>{confirmaron.length}</strong> ·
        faltan <strong style={{ color: '#fbbf24' }}>{abrieronSinConfirmar.length + sinAbrir.length}</strong>
      </div>
      {total > 0 && (
        <div style={{ display: 'grid', gap: 4 }}>
          {sinAbrir.map(l => fila(l, `sin abrir · último turno ${l.ultimo_turno ?? '—'}`))}
          {abrieronSinConfirmar.map(l => fila(l, `abrió ${fechaHoraAR(l.abierto_at)} · sin confirmar`))}
          {confirmaron.map(l => fila(l, `confirmó ${fechaHoraAR(l.confirmado_at)}`))}
        </div>
      )}
    </div>
  )
}
