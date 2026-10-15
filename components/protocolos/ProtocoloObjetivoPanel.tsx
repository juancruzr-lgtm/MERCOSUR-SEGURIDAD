'use client'

/**
 * components/protocolos/ProtocoloObjetivoPanel.tsx
 *
 * Protocolo del servicio, arriba de todo en la ficha del objetivo
 * (CentroOperativoObjetivo) y en el control general (ControlProtocolos).
 *
 * ── Qué se ve primero ────────────────────────────────────────────────────────
 * El TEXTO COMPLETO de la última versión escrita, sin botones intermedios.
 * Arriba del texto, una franja dice sin ambigüedad qué es:
 *  · Vigente: lo que hoy leen los vigiladores.
 *  · Borrador / pendiente de aprobación: todavía no lo ve el personal (y
 *    cuál es, si hay, la versión que sí ven).
 * Si hay vigente y además una versión en trabajo, se pasa de una a otra con
 * pestañas; nunca se muestran mezcladas.
 *
 * ── Editar ───────────────────────────────────────────────────────────────────
 * Desde el mismo lugar. Un borrador redactado en la app se guarda sobre sí
 * mismo. El texto original de Aldo (fuente WhatsApp) y toda versión ya
 * enviada o vigente NO se reescriben: «Editar» crea un borrador nuevo con ese
 * texto y el original queda intacto en el historial (lo exige la base). Todo
 * cambio vuelve a pasar por Gerencia antes de llegar al personal.
 *
 * ── En segundo plano ─────────────────────────────────────────────────────────
 * Lecturas del personal, historial de versiones y diferencias pendientes:
 * desplegables debajo del texto.
 *
 * ── Quién hace qué ───────────────────────────────────────────────────────────
 * Los botones salen de los permisos que devuelve la base
 * (protocolo_panel_objetivo.permisos) y cada RPC los vuelve a validar.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  COLOR_ESTADO, ETIQUETA_ESTADO, ETIQUETA_TIPO_DIFERENCIA, TIPOS_DIFERENCIA,
  accionesDeVersion, compararLineas, fechaHoraAR, fuenteDeEdicion, modoEdicion, separarLecturas, vistaProtocolo,
} from '@/lib/protocolos'
import type {
  AlcanceProtocolo, DiferenciaProtocolo, LecturaProtocolo, PanelObjetivo, TipoDiferencia, VersionProtocolo,
} from '@/lib/protocolos'
import {
  asignarResponsable, cargarPanelObjetivo, confirmarAsociacion, crearBorrador, descartarVersion,
  devolverBorrador, editarBorrador, enviarAprobacion, publicarVersion, registrarDiferencia, resolverDiferencia,
} from '@/lib/protocolos-datos'

const card: React.CSSProperties = {
  background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 16, marginBottom: 14,
}
const etiqueta: React.CSSProperties = { fontSize: 10.5, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em' }
const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#0a0e1a', border: '1px solid #1e2d42',
  color: '#e2e8f0', borderRadius: 8, padding: '8px 10px', fontSize: 13.5, fontFamily: 'inherit',
}
const boton = (tono: 'primario' | 'secundario' | 'peligro' | 'ok' = 'secundario'): React.CSSProperties => ({
  border: tono === 'secundario' ? '1px solid #334155' : 'none', borderRadius: 8, padding: '7px 12px',
  fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  background: tono === 'primario' ? '#f59e0b' : tono === 'peligro' ? '#b91c1c' : tono === 'ok' ? '#15803d' : 'transparent',
  color: tono === 'primario' ? '#1a1205' : tono === 'secundario' ? '#cbd5e1' : '#fff',
})
const pill = (color: string): React.CSSProperties => ({
  display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
  border: `1px solid ${color}`, color, whiteSpace: 'nowrap',
})
const textoDoc: React.CSSProperties = {
  whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 14.5, lineHeight: 1.65, color: '#e2e8f0',
  background: '#0a0e1a', border: '1px solid #1e2d42', borderRadius: 8, padding: '14px 16px',
}
const desplegable: React.CSSProperties = {
  border: '1px solid #1e2d42', borderRadius: 8, padding: '10px 12px', marginTop: 10, background: '#0f172a',
}
const resumenDesplegable: React.CSSProperties = { cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: '#cbd5e1' }

type Puesto = { id: string; nombre: string }
type Ejecutar = (fn: () => Promise<{ error: string | null }>, ok: string) => Promise<boolean>

// `onCargado` avisa a la ficha del objetivo cada vez que el panel se recarga,
// para que «Requiere intervención» cuente las diferencias pendientes sin pedir
// el panel dos veces ni quedar desfasado después de resolver una.
export default function ProtocoloObjetivoPanel({ objetivoId, onCargado }: { objetivoId: string; onCargado?: (panel: PanelObjetivo) => void }) {
  const [panel, setPanel] = useState<PanelObjetivo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [puestos, setPuestos] = useState<Puesto[]>([])
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null)
  const [alcanceSel, setAlcanceSel] = useState<string | null>(null)
  const [versionSel, setVersionSel] = useState<string | null>(null)
  const [verTexto, setVerTexto] = useState<Record<string, boolean>>({})
  const [nueva, setNueva] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await cargarPanelObjetivo(objetivoId)
    setCargando(false)
    if (r.error) { setError(r.error); setPanel(null); return }
    setError(null)
    setPanel(r.data)
    if (r.data) onCargado?.(r.data)
  }, [objetivoId, onCargado])

  useEffect(() => { void cargar() }, [cargar])
  useEffect(() => {
    void supabase.from('puestos').select('id, nombre').eq('objetivo_id', objetivoId).eq('activo', true)
      .order('orden').limit(200)
      .then(({ data }) => setPuestos((data ?? []) as Puesto[]))
  }, [objetivoId])

  /** Ejecuta una acción, muestra el resultado y recarga. */
  const ejecutar: Ejecutar = useCallback(async (fn, ok) => {
    const r = await fn()
    if (r.error) { setMensaje({ texto: r.error, tipo: 'error' }); return false }
    setMensaje({ texto: ok, tipo: 'ok' })
    await cargar()
    return true
  }, [cargar])

  const alcances = useMemo(() => vistaProtocolo(panel?.versiones ?? []), [panel])
  const alcance: AlcanceProtocolo | null = alcances.find(a => a.clave === alcanceSel) ?? alcances[0] ?? null
  const historial = useMemo(() => (panel?.versiones ?? []).filter(v => v.estado === 'reemplazado' || v.estado === 'descartado' || v.estado === 'borrador' || v.estado === 'pendiente_aprobacion'), [panel])
  const vigentes = useMemo(() => (panel?.versiones ?? []).filter(v => v.estado === 'vigente'), [panel])
  const pendientesDif = (panel?.diferencias ?? []).filter(d => d.estado === 'pendiente').length

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
  const p = panel.permisos

  return (
    <div style={card} id="protocolo-objetivo">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0', flex: 1 }}>📋 Protocolo del servicio</div>
        <button type="button" style={boton()} onClick={() => void cargar()}>Actualizar</button>
      </div>

      {mensaje && (
        <div role="status" style={{
          marginTop: 10, fontSize: 13, padding: '8px 10px', borderRadius: 8,
          background: mensaje.tipo === 'ok' ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)',
          color: mensaje.tipo === 'ok' ? '#4ade80' : '#f87171',
        }}>{mensaje.texto}</div>
      )}

      {alcances.length === 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13.5, color: '#94a3b8' }}>Este objetivo todavía no tiene protocolo escrito.</div>
          {p.preparar && !nueva && (
            <button type="button" style={{ ...boton('primario'), marginTop: 10 }} onClick={() => setNueva(true)}>Escribir el protocolo</button>
          )}
        </div>
      )}

      {alcances.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }} role="tablist" aria-label="Alcance del protocolo">
          {alcances.map(a => {
            const activo = a.clave === alcance?.clave
            return (
              <button
                key={a.clave} type="button" role="tab" aria-selected={activo}
                onClick={() => { setAlcanceSel(a.clave); setVersionSel(null) }}
                style={{
                  ...boton(), borderColor: activo ? '#f59e0b' : '#334155', color: activo ? '#fbbf24' : '#94a3b8',
                }}
              >
                {a.puesto_id ? `Puesto ${a.puesto_nombre ?? ''}` : 'Todo el objetivo'}
              </button>
            )
          })}
        </div>
      )}

      {alcance && (
        <DocumentoPrincipal
          key={alcance.clave}
          objetivoId={objetivoId}
          alcance={alcance}
          versionSel={versionSel}
          setVersionSel={setVersionSel}
          permisos={p}
          ejecutar={ejecutar}
          onError={texto => setMensaje({ texto, tipo: 'error' })}
          onCreado={async (id) => { setMensaje({ texto: 'Se guardó como borrador nuevo. El original queda intacto en el historial; para entregarlo al personal, enviarlo a aprobación de Gerencia.', tipo: 'ok' }); await cargar(); setVersionSel(id) }}
        />
      )}

      {/* ── En segundo plano ───────────────────────────────────────────────── */}
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

      {(historial.length > 0 || p.preparar) && (
        <details style={desplegable} open={nueva || undefined}>
          <summary style={resumenDesplegable}>Historial de versiones ({panel.versiones.length})</summary>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {p.preparar && !nueva && <button type="button" style={boton()} onClick={() => setNueva(true)}>Escribir una versión desde cero</button>}
          </div>
          {nueva && (
            <NuevaVersion
              puestos={puestos}
              onCancelar={() => setNueva(false)}
              onGuardar={async (d) => {
                const ok = await ejecutar(() => crearBorrador({ objetivoId, ...d }), 'Borrador creado. Queda sin publicar hasta que Gerencia lo apruebe.')
                if (ok) setNueva(false)
              }}
            />
          )}
          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            {panel.versiones.map(v => (
              <TarjetaVersion
                key={v.id} v={v} permisos={p}
                verTexto={!!verTexto[v.id]}
                alternarTexto={() => setVerTexto(s => ({ ...s, [v.id]: !s[v.id] }))}
                ejecutar={ejecutar}
              />
            ))}
          </div>
        </details>
      )}

      <details style={desplegable}>
        <summary style={resumenDesplegable}>Diferencias pendientes de validación ({pendientesDif})</summary>
        <Diferencias
          objetivoId={objetivoId}
          diferencias={panel.diferencias}
          versiones={panel.versiones}
          permisos={p}
          ejecutar={ejecutar}
        />
      </details>
    </div>
  )
}

// ── Documento principal ─────────────────────────────────────────────────────

function etiquetaPestaña(v: VersionProtocolo): string {
  if (v.estado === 'vigente') return `Vigente · v${v.numero} · lo que ve el vigilador`
  if (v.estado === 'pendiente_aprobacion') return `Pendiente de aprobación · v${v.numero}`
  return `Borrador · v${v.numero}`
}

// Exportado para las pruebas de pantalla.
export function DocumentoPrincipal({ objetivoId, alcance, versionSel, setVersionSel, permisos, ejecutar, onError, onCreado }: {
  objetivoId: string
  alcance: AlcanceProtocolo
  versionSel: string | null
  setVersionSel: (id: string | null) => void
  permisos: PanelObjetivo['permisos']
  ejecutar: Ejecutar
  onError: (texto: string) => void
  onCreado: (id: string) => Promise<void>
}) {
  // Pestañas: lo que está en trabajo (más reciente primero) y la vigente al final.
  const opciones = useMemo(() => {
    const lista = [...alcance.trabajo]
    if (alcance.vigente) lista.push(alcance.vigente)
    return lista
  }, [alcance])
  const v = opciones.find(o => o.id === versionSel) ?? alcance.ultima ?? opciones[0]
  const [editando, setEditando] = useState(false)
  const [titulo, setTitulo] = useState('')
  const [texto, setTexto] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [completo, setCompleto] = useState(false)
  const [compararCon, setCompararCon] = useState<string | null>(null)

  // Al cambiar de versión se cierra la edición y la comparación.
  useEffect(() => { setEditando(false); setCompararCon(null) }, [v?.id])
  if (!v) return null

  const modo = modoEdicion(v, permisos)
  const otras = opciones.filter(o => o.id !== v.id)
  const contra = otras.find(o => o.id === compararCon) ?? null
  const lineas = contra ? compararLineas(contra.texto, v.texto) : null
  const sinCambios = titulo.trim() === v.titulo && texto === v.texto

  const franja = (() => {
    if (v.estado === 'vigente') {
      return { color: '#10b981', fondo: 'rgba(16,185,129,.08)', texto: `Vigente desde el ${fechaHoraAR(v.aprobado_at)}${v.aprobado_por_nombre ? ` (aprobó ${v.aprobado_por_nombre})` : ''}. Es lo que leen los vigiladores desde la tarjeta de su turno.` }
    }
    const loQueVen = alcance.vigente
      ? `El personal sigue viendo la versión vigente (v${alcance.vigente.numero}).`
      : 'Ningún vigilador ve todavía un protocolo para este objetivo.'
    if (v.estado === 'pendiente_aprobacion') {
      return { color: '#f59e0b', fondo: 'rgba(245,158,11,.08)', texto: `Pendiente de aprobación de Gerencia: todavía no lo ve el personal. ${loQueVen}` }
    }
    return { color: '#94a3b8', fondo: 'rgba(148,163,184,.08)', texto: `Borrador: todavía no lo ve el personal. ${loQueVen} Para entregarlo, enviarlo a aprobación de Gerencia.` }
  })()

  const guardar = async () => {
    if (!modo) return
    setGuardando(true)
    if (modo === 'en_lugar') {
      const ok = await ejecutar(() => editarBorrador(v.id, titulo.trim(), texto, v.notas), 'Borrador guardado.')
      if (ok) setEditando(false)
    } else {
      const r = await crearBorrador({
        objetivoId, puestoId: v.puesto_id, titulo: titulo.trim(), texto,
        fuenteTipo: 'manual', fuenteDescripcion: fuenteDeEdicion(v), notas: null,
      })
      if (r.error || !r.data) onError(r.error ?? 'No se pudo guardar.')
      else { setEditando(false); await onCreado(r.data.id) }
    }
    setGuardando(false)
  }

  return (
    <div style={{ marginTop: 12 }}>
      {opciones.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }} role="tablist" aria-label="Versión que se muestra">
          {opciones.map(o => {
            const activo = o.id === v.id
            const color = COLOR_ESTADO[o.estado]
            return (
              <button
                key={o.id} type="button" role="tab" aria-selected={activo}
                onClick={() => setVersionSel(o.id)}
                style={{
                  borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                  background: activo ? `${color}22` : 'transparent', border: `1px solid ${activo ? color : '#334155'}`,
                  color: activo ? color : '#94a3b8',
                }}
              >
                {etiquetaPestaña(o)}
              </button>
            )
          })}
        </div>
      )}
      {alcance.trabajo.length > 1 && (
        <div style={{ fontSize: 12.5, color: '#fbbf24', marginBottom: 8 }}>
          Hay {alcance.trabajo.length} versiones en preparación para este alcance: Gerencia tiene que elegir cuál publicar.
        </div>
      )}

      <div style={{ border: `1px solid ${franja.color}`, background: franja.fondo, borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#e2e8f0', lineHeight: 1.5 }}>
        <span style={{ ...pill(franja.color), marginRight: 8 }}>{ETIQUETA_ESTADO[v.estado]}</span>
        {franja.texto}
      </div>
      {v.asociacion === 'pendiente_validacion' && (
        <div style={{ fontSize: 12.5, color: '#fbbf24', marginTop: 6 }}>
          Falta que Gerencia confirme que este texto corresponde a este objetivo.{v.asociacion_nota ? ` ${v.asociacion_nota}` : ''}
        </div>
      )}
      {v.asociacion === 'pendiente_validacion' && permisos.preparar && (
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
          Se puede editar una vez confirmado el objetivo.
        </div>
      )}
      {v.devuelto_motivo && v.estado === 'borrador' && <div style={{ fontSize: 12.5, color: '#f87171', marginTop: 6 }}>Devuelto por Gerencia: {v.devuelto_motivo}</div>}

      <div style={{ display: 'flex', gap: '4px 14px', flexWrap: 'wrap', fontSize: 12, color: '#94a3b8', margin: '10px 0 8px' }}>
        <span><strong style={{ color: '#e2e8f0' }}>v{v.numero} · {v.titulo}</strong>{v.puesto_nombre ? ` · sólo ${v.puesto_nombre}` : ''}</span>
        <span style={{ overflowWrap: 'anywhere' }}>Fuente: {v.fuente_descripcion}</span>
      </div>

      {editando ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {modo === 'version_nueva' && (
            <div style={{ fontSize: 12.5, color: '#93c5fd', lineHeight: 1.5 }}>
              {v.fuente_tipo === 'whatsapp' ? 'Este es el texto original de la fuente: no se modifica. ' : ''}
              Lo que guardes queda como un borrador nuevo; la versión v{v.numero} se conserva tal cual en el historial.
              El personal no ve el cambio hasta que Gerencia lo apruebe.
            </div>
          )}
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={etiqueta}>Título</span>
            <input id="protocolo-editar-titulo" style={input} value={titulo} onChange={e => setTitulo(e.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={etiqueta}>Texto completo</span>
            <textarea
              id="protocolo-editar-texto"
              style={{ ...input, minHeight: 360, lineHeight: 1.6, fontSize: 14 }}
              value={texto} onChange={e => setTexto(e.target.value)}
            />
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button" style={{ ...boton('primario'), opacity: !guardando && !sinCambios && titulo.trim() && texto.trim() ? 1 : 0.5 }}
              disabled={guardando || sinCambios || !titulo.trim() || !texto.trim()}
              onClick={() => void guardar()}
            >
              {guardando ? 'Guardando…' : modo === 'en_lugar' ? 'Guardar borrador' : 'Guardar como borrador nuevo'}
            </button>
            <button type="button" style={boton()} onClick={() => setEditando(false)}>Cancelar</button>
          </div>
        </div>
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
        <div style={{ position: 'relative' }}>
          <div style={{ ...textoDoc, maxHeight: completo ? 'none' : '60vh', overflowY: completo ? 'visible' : 'auto' }}>{v.texto}</div>
        </div>
      )}

      {!editando && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
          {modo && (
            <button type="button" style={boton('primario')} onClick={() => { setTitulo(v.titulo); setTexto(v.texto); setEditando(true); setCompararCon(null) }}>
              {modo === 'en_lugar' ? 'Editar borrador' : 'Editar (crea un borrador nuevo)'}
            </button>
          )}
          {!lineas && <button type="button" style={boton()} onClick={() => setCompleto(c => !c)}>{completo ? 'Ver en recuadro' : 'Ver todo sin recuadro'}</button>}
          {otras.length > 0 && (
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: '#94a3b8' }}>
              Comparar con
              <select
                id="protocolo-comparar" style={{ ...input, width: 'auto', padding: '6px 8px', fontSize: 12.5 }}
                value={compararCon ?? ''} onChange={e => setCompararCon(e.target.value || null)}
              >
                <option value="">—</option>
                {otras.map(o => <option key={o.id} value={o.id}>{etiquetaPestaña(o)}</option>)}
              </select>
            </label>
          )}
          <AccionesVersion v={v} permisos={permisos} ejecutar={ejecutar} />
        </div>
      )}
    </div>
  )
}

/** Envío, aprobación, devolución, descarte y confirmación de objetivo. */
function AccionesVersion({ v, permisos, ejecutar }: { v: VersionProtocolo; permisos: PanelObjetivo['permisos']; ejecutar: Ejecutar }) {
  const a = accionesDeVersion(v, permisos)
  const [paso, setPaso] = useState<null | 'publicar' | 'devolver' | 'descartar' | 'asociacion'>(null)
  const [motivo, setMotivo] = useState('')
  const cerrar = () => { setPaso(null); setMotivo('') }
  if (!a.enviar && !a.confirmarAsociacion && !a.publicar && !a.devolver && !a.descartar) return null

  return (
    <>
      {a.enviar && <button type="button" style={boton()} onClick={() => void ejecutar(() => enviarAprobacion(v.id), 'Enviado a aprobación de Gerencia.')}>Enviar a aprobación</button>}
      {a.confirmarAsociacion && <button type="button" style={boton()} onClick={() => setPaso('asociacion')}>Confirmar objetivo</button>}
      {a.publicar && <button type="button" style={boton('ok')} onClick={() => setPaso('publicar')}>Publicar</button>}
      {a.devolver && <button type="button" style={boton()} onClick={() => setPaso('devolver')}>Devolver</button>}
      {a.descartar && <button type="button" style={boton('peligro')} onClick={() => setPaso('descartar')}>Descartar</button>}
      {v.estado === 'pendiente_aprobacion' && v.asociacion === 'pendiente_validacion' && permisos.publicar && (
        <div style={{ fontSize: 12, color: '#fbbf24', flexBasis: '100%' }}>Para publicar, primero confirmá que este texto corresponde a este objetivo.</div>
      )}
      {paso && (
        <div style={{ flexBasis: '100%', borderTop: '1px solid #1e2d42', paddingTop: 10, marginTop: 4, display: 'grid', gap: 8 }}>
          {paso === 'publicar' && (
            <div style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.5 }}>
              Al publicar, esta versión pasa a ser la que ven los vigiladores de este objetivo{v.puesto_nombre ? ` (puesto ${v.puesto_nombre})` : ''} y
              se les pide confirmar la lectura. La vigente anterior, si hay, queda reemplazada. No se puede deshacer ni cambiar el texto después.
            </div>
          )}
          {paso === 'asociacion' && <div style={{ fontSize: 13, color: '#e2e8f0' }}>¿Confirmás que este texto corresponde a este objetivo?</div>}
          {paso !== 'publicar' && (
            <textarea
              style={{ ...input, minHeight: 60 }} value={motivo} onChange={e => setMotivo(e.target.value)}
              placeholder={paso === 'asociacion' ? 'Nota (opcional)' : 'Motivo (obligatorio)'}
              aria-label={paso === 'asociacion' ? 'Nota' : 'Motivo'}
            />
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              style={boton(paso === 'descartar' ? 'peligro' : paso === 'publicar' ? 'ok' : 'primario')}
              disabled={(paso === 'devolver' || paso === 'descartar') && !motivo.trim()}
              onClick={async () => {
                let ok = false
                if (paso === 'publicar') ok = await ejecutar(() => publicarVersion(v.id), 'Publicado. Los vigiladores del objetivo ya lo ven.')
                if (paso === 'devolver') ok = await ejecutar(() => devolverBorrador(v.id, motivo), 'Devuelto a borrador.')
                if (paso === 'descartar') ok = await ejecutar(() => descartarVersion(v.id, motivo), 'Versión descartada (queda guardada en el historial).')
                if (paso === 'asociacion') ok = await ejecutar(() => confirmarAsociacion(v.id, motivo || null), 'Coincidencia con el objetivo confirmada.')
                if (ok) cerrar()
              }}
            >
              {paso === 'publicar' ? 'Sí, publicar' : paso === 'devolver' ? 'Devolver a borrador' : paso === 'descartar' ? 'Descartar versión' : 'Confirmar objetivo'}
            </button>
            <button type="button" style={boton()} onClick={cerrar}>Cancelar</button>
          </div>
        </div>
      )}
    </>
  )
}

// ── Historial ───────────────────────────────────────────────────────────────

function CabeceraVersion({ v }: { v: VersionProtocolo }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={pill(COLOR_ESTADO[v.estado])}>{ETIQUETA_ESTADO[v.estado]}</span>
        {v.asociacion === 'pendiente_validacion' && <span style={pill('#f59e0b')}>Objetivo sin confirmar</span>}
        <span style={{ fontSize: 13.5, fontWeight: 700, color: '#e2e8f0', overflowWrap: 'anywhere' }}>
          v{v.numero} · {v.titulo}{v.puesto_nombre ? ` · sólo ${v.puesto_nombre}` : ''}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '6px 14px', marginTop: 8, fontSize: 12.5, color: '#cbd5e1' }}>
        <div style={{ minWidth: 0 }}><div style={etiqueta}>Fuente</div><span style={{ overflowWrap: 'anywhere' }}>{v.fuente_descripcion}</span></div>
        {v.fuente_archivo_sha256 && <div style={{ minWidth: 0 }}><div style={etiqueta}>Hash de la fuente</div><code style={{ fontSize: 11 }}>{v.fuente_archivo_sha256.slice(0, 12)}…</code></div>}
        <div><div style={etiqueta}>Hash del texto</div><code style={{ fontSize: 11 }}>{v.texto_sha256.slice(0, 12)}…</code></div>
        {v.aprobado_at && <div><div style={etiqueta}>Aprobada</div>{fechaHoraAR(v.aprobado_at)}{v.aprobado_por_nombre ? ` · ${v.aprobado_por_nombre}` : ''}</div>}
        {v.estado === 'vigente' || v.estado === 'reemplazado'
          ? <div><div style={etiqueta}>Lecturas</div>{v.aperturas} abrieron · {v.confirmaciones} confirmaron</div>
          : <div><div style={etiqueta}>Creada</div>{fechaHoraAR(v.creado_at)}</div>}
      </div>
      {v.notas && <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 6, lineHeight: 1.5 }}>{v.notas}</div>}
      {v.motivo_descarte && <div style={{ fontSize: 12.5, color: '#f87171', marginTop: 6 }}>Descartada: {v.motivo_descarte}</div>}
    </div>
  )
}

function TarjetaVersion({ v, permisos, verTexto, alternarTexto, ejecutar }: {
  v: VersionProtocolo
  permisos: PanelObjetivo['permisos']
  verTexto: boolean
  alternarTexto: () => void
  ejecutar: Ejecutar
}) {
  return (
    <div style={{ border: '1px solid #1e2d42', borderRadius: 8, padding: 12, background: '#0b1220', minWidth: 0 }}>
      <CabeceraVersion v={v} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
        <button type="button" style={boton()} onClick={alternarTexto}>{verTexto ? 'Ocultar texto' : 'Ver texto'}</button>
        <AccionesVersion v={v} permisos={permisos} ejecutar={ejecutar} />
      </div>
      {verTexto && <div style={{ marginTop: 10 }}><div style={{ ...textoDoc, maxHeight: 420, overflowY: 'auto' }}>{v.texto}</div></div>}
    </div>
  )
}

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

function NuevaVersion({ puestos, onCancelar, onGuardar }: {
  puestos: Puesto[]
  onCancelar: () => void
  onGuardar: (d: { puestoId: string | null; titulo: string; texto: string; fuenteTipo: 'documento' | 'manual'; fuenteDescripcion: string; notas: string | null }) => Promise<void>
}) {
  const [puestoId, setPuestoId] = useState('')
  const [titulo, setTitulo] = useState('')
  const [texto, setTexto] = useState('')
  const [fuenteTipo, setFuenteTipo] = useState<'documento' | 'manual'>('documento')
  const [fuente, setFuente] = useState('')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const valido = titulo.trim() && texto.trim() && fuente.trim()
  return (
    <div style={{ border: '1px solid #78350f', borderRadius: 8, padding: 12, marginTop: 12, display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: '#fbbf24' }}>Nueva versión (queda como borrador)</div>
      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
        Pegá el texto completo tal como lo entregó Operaciones. No se resume ni se completa: lo que se publica es esto, palabra por palabra.
      </div>
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={etiqueta}>Alcance</span>
        <select id="proto-puesto" style={input} value={puestoId} onChange={e => setPuestoId(e.target.value)}>
          <option value="">Todo el objetivo</option>
          {puestos.map(p => <option key={p.id} value={p.id}>Sólo el puesto {p.nombre}</option>)}
        </select>
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={etiqueta}>Título</span>
        <input id="proto-titulo" style={input} value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ej.: Funciones y procedimientos" />
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={etiqueta}>Texto completo</span>
        <textarea id="proto-texto" style={{ ...input, minHeight: 220 }} value={texto} onChange={e => setTexto(e.target.value)} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 8 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={etiqueta}>Tipo de fuente</span>
          <select id="proto-fuente-tipo" style={input} value={fuenteTipo} onChange={e => setFuenteTipo(e.target.value as 'documento' | 'manual')}>
            <option value="documento">Documento</option>
            <option value="manual">Redactado en la app</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={etiqueta}>De dónde sale</span>
          <input id="proto-fuente" style={input} value={fuente} onChange={e => setFuente(e.target.value)} placeholder="Ej.: Instructivo de Aldo Monzón, 20/10/2026" />
        </label>
      </div>
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={etiqueta}>Notas internas (opcional)</span>
        <input id="proto-notas" style={input} value={notas} onChange={e => setNotas(e.target.value)} />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button" style={{ ...boton('primario'), opacity: valido && !guardando ? 1 : 0.5 }} disabled={!valido || guardando}
          onClick={async () => {
            setGuardando(true)
            await onGuardar({ puestoId: puestoId || null, titulo: titulo.trim(), texto, fuenteTipo, fuenteDescripcion: fuente.trim(), notas: notas.trim() || null })
            setGuardando(false)
          }}
        >
          {guardando ? 'Guardando…' : 'Guardar borrador'}
        </button>
        <button type="button" style={boton()} onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}

// ── Diferencias ─────────────────────────────────────────────────────────────

function Diferencias({ objetivoId, diferencias, versiones, permisos, ejecutar }: {
  objetivoId: string
  diferencias: DiferenciaProtocolo[]
  versiones: VersionProtocolo[]
  permisos: PanelObjetivo['permisos']
  ejecutar: Ejecutar
}) {
  const pendientes = diferencias.filter(d => d.estado === 'pendiente')
  const resueltas = diferencias.filter(d => d.estado === 'resuelta')
  const [nueva, setNueva] = useState(false)
  const [tipo, setTipo] = useState<TipoDiferencia>('otro')
  const [versionId, setVersionId] = useState('')
  const [origen, setOrigen] = useState('')
  const [referencia, setReferencia] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [responsable, setResponsable] = useState('')

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ flex: 1, fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
          Lo que no coincide entre el protocolo, otros documentos y la configuración de la app. Registrar o resolver una diferencia no cambia rondas, alertas ni horarios.
        </span>
        {permisos.registrar_diferencias && !nueva && <button type="button" style={boton()} onClick={() => setNueva(true)}>Registrar diferencia</button>}
      </div>

      {nueva && (
        <div style={{ border: '1px solid #1e3a8a', borderRadius: 8, padding: 12, display: 'grid', gap: 8, marginBottom: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={etiqueta}>Tipo</span>
              <select id="dif-tipo" style={input} value={tipo} onChange={e => setTipo(e.target.value as TipoDiferencia)}>
                {TIPOS_DIFERENCIA.map(t => <option key={t} value={t}>{ETIQUETA_TIPO_DIFERENCIA[t]}</option>)}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={etiqueta}>Versión (opcional)</span>
              <select id="dif-version" style={input} value={versionId} onChange={e => setVersionId(e.target.value)}>
                <option value="">—</option>
                {versiones.map(v => <option key={v.id} value={v.id}>v{v.numero} · {ETIQUETA_ESTADO[v.estado]}</option>)}
              </select>
            </label>
          </div>
          <input id="dif-origen" style={input} value={origen} onChange={e => setOrigen(e.target.value)} placeholder="Documento o configuración de origen (obligatorio)" aria-label="Origen" />
          <textarea id="dif-referencia" style={{ ...input, minHeight: 50 }} value={referencia} onChange={e => setReferencia(e.target.value)} placeholder="Texto o referencia original, citado tal cual" aria-label="Referencia original" />
          <textarea id="dif-descripcion" style={{ ...input, minHeight: 60 }} value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="Qué no coincide (obligatorio)" aria-label="Descripción" />
          <input id="dif-responsable" style={input} value={responsable} onChange={e => setResponsable(e.target.value)} placeholder="Responsable (opcional)" aria-label="Responsable" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button" style={boton('primario')} disabled={!origen.trim() || !descripcion.trim()}
              onClick={async () => {
                const ok = await ejecutar(() => registrarDiferencia({
                  objetivoId, versionId: versionId || null, tipo, origen: origen.trim(),
                  referenciaOriginal: referencia.trim() || null, descripcion: descripcion.trim(), responsable: responsable.trim() || null,
                }), 'Diferencia registrada.')
                if (ok) { setNueva(false); setOrigen(''); setReferencia(''); setDescripcion(''); setResponsable('') }
              }}
            >
              Registrar
            </button>
            <button type="button" style={boton()} onClick={() => setNueva(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {pendientes.length === 0 && <div style={{ fontSize: 13, color: '#64748b' }}>No hay diferencias pendientes.</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {pendientes.map(d => <TarjetaDiferencia key={d.id} d={d} permisos={permisos} ejecutar={ejecutar} />)}
      </div>
      {resueltas.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12.5, color: '#93c5fd' }}>Resueltas ({resueltas.length})</summary>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {resueltas.map(d => <TarjetaDiferencia key={d.id} d={d} permisos={permisos} ejecutar={ejecutar} />)}
          </div>
        </details>
      )}
    </div>
  )
}

function TarjetaDiferencia({ d, permisos, ejecutar }: {
  d: DiferenciaProtocolo
  permisos: PanelObjetivo['permisos']
  ejecutar: Ejecutar
}) {
  const [paso, setPaso] = useState<null | 'responsable' | 'resolver'>(null)
  const [valor, setValor] = useState('')
  return (
    <div style={{ border: '1px solid #1e2d42', borderRadius: 8, padding: 10, background: '#0b1220', minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={pill(d.estado === 'pendiente' ? '#f59e0b' : '#10b981')}>{d.estado === 'pendiente' ? 'Pendiente' : 'Resuelta'}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#e2e8f0' }}>{ETIQUETA_TIPO_DIFERENCIA[d.tipo]}</span>
        {d.registro_origen === 'auditoria_20261014' && <span style={{ fontSize: 11, color: '#64748b' }}>Auditoría 14/10/2026</span>}
      </div>
      <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 6, lineHeight: 1.5 }}>{d.descripcion}</div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, overflowWrap: 'anywhere' }}>Origen: {d.origen}</div>
      {d.referencia_original && (
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, fontStyle: 'italic', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          «{d.referencia_original}»
        </div>
      )}
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Responsable: {d.responsable ?? 'sin asignar'}</div>
      {d.estado === 'resuelta' && (
        <div style={{ fontSize: 12.5, color: '#4ade80', marginTop: 6 }}>
          Resolución: {d.resolucion} · {fechaHoraAR(d.resuelta_at)}{d.resuelta_por_nombre ? ` · ${d.resuelta_por_nombre}` : ''}
        </div>
      )}
      {d.estado === 'pendiente' && (permisos.preparar || permisos.publicar) && !paso && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {permisos.preparar && <button type="button" style={boton()} onClick={() => { setValor(d.responsable ?? ''); setPaso('responsable') }}>Asignar responsable</button>}
          {permisos.publicar && <button type="button" style={boton('ok')} onClick={() => { setValor(''); setPaso('resolver') }}>Resolver</button>}
        </div>
      )}
      {paso && (
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          {paso === 'resolver'
            ? <textarea style={{ ...input, minHeight: 60 }} value={valor} onChange={e => setValor(e.target.value)} placeholder="Qué se decidió (obligatorio)" aria-label="Resolución" />
            : <input style={input} value={valor} onChange={e => setValor(e.target.value)} placeholder="Nombre del responsable" aria-label="Responsable" />}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button" style={boton(paso === 'resolver' ? 'ok' : 'primario')} disabled={paso === 'resolver' && !valor.trim()}
              onClick={async () => {
                const ok = paso === 'resolver'
                  ? await ejecutar(() => resolverDiferencia(d.id, valor), 'Diferencia resuelta.')
                  : await ejecutar(() => asignarResponsable(d.id, valor), 'Responsable asignado.')
                if (ok) setPaso(null)
              }}
            >
              {paso === 'resolver' ? 'Marcar resuelta' : 'Guardar'}
            </button>
            <button type="button" style={boton()} onClick={() => setPaso(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
