'use client'

/**
 * components/tareas/TareasTurnoPanel.tsx
 *
 * Ficha del objetivo → Controles → «Tareas del turno».
 *  · Las tareas activas, por momento (al ingresar / durante / al retirarse),
 *    con la instrucción del protocolo de la que salen.
 *  · Lo aprobado listo para activar: Gerencia elige momento y evidencia y
 *    activa (Aldo y Administración lo ven, no lo activan).
 *  · Los últimos 7 días, turno por turno: qué se hizo, qué no y por qué,
 *    con acceso a las fotos.
 * Permisos: los decide la base (tareas_turno_panel / tareas_turno_activar).
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ETIQUETA_EVIDENCIA, ETIQUETA_ESTADO_TAREA, ETIQUETA_MOMENTO, MOMENTOS, momentoSugerido,
} from '@/lib/tareas-turno'
import type { EvidenciaTarea, Momento, PanelTareas } from '@/lib/tareas-turno'
import { activarTareas, cargarPanelTareas, desactivarTarea } from '@/lib/tareas-turno-datos'

const card: React.CSSProperties = { background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 16, marginBottom: 14 }
const sub: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#e2e8f0', margin: '14px 0 8px' }
const nota: React.CSSProperties = { fontSize: 12.5, color: '#94a3b8', lineHeight: 1.5 }
const select: React.CSSProperties = { background: '#0a0e1a', border: '1px solid #1e2d42', color: '#e2e8f0', borderRadius: 8, padding: '6px 8px', fontSize: 12.5 }
const boton = (tono: 'primario' | 'secundario' | 'peligro' = 'secundario'): React.CSSProperties => ({
  border: tono === 'secundario' ? '1px solid #334155' : 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  background: tono === 'primario' ? '#f59e0b' : tono === 'peligro' ? '#b91c1c' : 'transparent',
  color: tono === 'primario' ? '#1a1205' : tono === 'secundario' ? '#cbd5e1' : '#fff',
})

export default function TareasTurnoPanel({ objetivoId }: { objetivoId: string }) {
  const [panel, setPanel] = useState<PanelTareas | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<{ t: string; ok: boolean } | null>(null)
  const [eleccion, setEleccion] = useState<Record<string, { momento: Momento; evidencia: EvidenciaTarea; marcada: boolean }>>({})
  const [ocupado, setOcupado] = useState(false)
  const [baja, setBaja] = useState<{ id: string; motivo: string } | null>(null)

  const cargar = useCallback(async () => {
    const r = await cargarPanelTareas(objetivoId, 7)
    if (r.error) { setError(r.error); return }
    setError(null)
    setPanel(r.data)
    setEleccion(prev => {
      const n: typeof prev = {}
      for (const t of r.data?.para_activar ?? []) n[t.control_id] = prev[t.control_id] ?? { momento: momentoSugerido(t.cuando), evidencia: 'ninguna', marcada: true }
      return n
    })
  }, [objetivoId])
  useEffect(() => { void cargar() }, [cargar])

  if (error) {
    return <div style={card}><div style={{ ...nota, color: /permiso/i.test(error) ? '#94a3b8' : '#f87171' }}>
      {/permiso/i.test(error) ? 'No tenés acceso a las tareas de este objetivo.' : `No se pudieron cargar las tareas: ${error}`}
    </div></div>
  }
  if (!panel) return <div style={card}><div style={nota}>Cargando tareas…</div></div>

  const activas = panel.definiciones.filter(d => d.activo)
  const inactivas = panel.definiciones.filter(d => !d.activo)
  const marcadas = panel.para_activar.filter(t => eleccion[t.control_id]?.marcada && t.version_estado === 'vigente')

  const activar = async () => {
    setOcupado(true); setMensaje(null)
    const r = await activarTareas(objetivoId, marcadas.map(t => ({ control_id: t.control_id, momento: eleccion[t.control_id].momento, evidencia: eleccion[t.control_id].evidencia })))
    setOcupado(false)
    if (r.error) { setMensaje({ t: r.error, ok: false }); return }
    setMensaje({ t: `Activadas: ${r.data?.nuevas ?? 0} nuevas${r.data?.reutilizadas ? `, ${r.data.reutilizadas} ya existían (no se duplicaron)` : ''}. Los vigiladores las ven desde su próximo turno.`, ok: true })
    await cargar()
  }

  return (
    <div style={card}>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0' }}>Tareas del turno</div>
      <div style={nota}>
        Lo que el vigilador hace en cada turno según el protocolo. Las marca desde la tarjeta de su turno; no bloquea el fichaje ni cuenta para Mi Desempeño.
      </div>
      {mensaje && <div role="status" style={{ ...nota, marginTop: 8, color: mensaje.ok ? '#4ade80' : '#f87171' }}>{mensaje.t}</div>}

      <div style={sub}>Activas ({activas.length})</div>
      {activas.length === 0 && <div style={nota}>Todavía no hay tareas activas. Se generan desde el protocolo: la IA las propone, una persona las aprueba y Gerencia las activa.</div>}
      {MOMENTOS.map(m => {
        const deMomento = activas.filter(d => d.momento === m)
        if (deMomento.length === 0) return null
        return (
          <div key={m} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11.5, color: '#93c5fd', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>{ETIQUETA_MOMENTO[m]}</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {deMomento.map(d => (
                <div key={d.id} style={{ border: '1px solid #1e2d42', borderRadius: 8, padding: '8px 10px', background: '#0f172a', display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 220px', minWidth: 0, fontSize: 13.5, color: '#e2e8f0' }}>
                    {d.texto}
                    <div style={{ ...nota, fontSize: 11.5 }}>{ETIQUETA_EVIDENCIA[d.evidencia]}{d.puesto_nombre ? ` · sólo ${d.puesto_nombre}` : ''}</div>
                  </div>
                  {panel.permisos.activar && (baja?.id === d.id ? (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flexBasis: '100%' }}>
                      <input style={{ ...select, flex: '1 1 200px' }} placeholder="Motivo (obligatorio)" value={baja.motivo}
                        onChange={e => setBaja({ id: d.id, motivo: e.target.value })} aria-label="Motivo" />
                      <button type="button" style={boton('peligro')} disabled={!baja.motivo.trim() || ocupado}
                        onClick={async () => { setOcupado(true); const r = await desactivarTarea(d.id, baja.motivo); setOcupado(false); setBaja(null); setMensaje(r.error ? { t: r.error, ok: false } : { t: 'Tarea desactivada.', ok: true }); await cargar() }}>
                        Desactivar
                      </button>
                      <button type="button" style={boton()} onClick={() => setBaja(null)}>Cancelar</button>
                    </div>
                  ) : (
                    <button type="button" style={boton()} onClick={() => setBaja({ id: d.id, motivo: '' })}>Desactivar</button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {panel.para_activar.length > 0 && (
        <>
          <div style={sub}>Aprobadas para activar ({panel.para_activar.length})</div>
          {!panel.permisos.activar && <div style={nota}>Las activa Gerencia.</div>}
          <div style={{ display: 'grid', gap: 6 }}>
            {panel.para_activar.map(t => {
              const e = eleccion[t.control_id]
              const vigente = t.version_estado === 'vigente'
              return (
                <div key={t.control_id} style={{ border: '1px solid #1e3a8a', borderRadius: 8, padding: '8px 10px', display: 'grid', gap: 6 }}>
                  <div style={{ fontSize: 13.5, color: '#e2e8f0' }}>{t.texto}</div>
                  <div style={{ ...nota, fontSize: 11.5 }}>
                    {t.cuando ? `Cuándo (según el protocolo): ${t.cuando}` : 'El protocolo no dice cuándo.'}
                    {!vigente && ` · La versión v${t.version_numero} todavía no está publicada: se activa cuando Gerencia la publique.`}
                  </div>
                  {panel.permisos.activar && e && vigente && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <label style={{ ...nota, display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input type="checkbox" checked={e.marcada} onChange={ev => setEleccion(s => ({ ...s, [t.control_id]: { ...e, marcada: ev.target.checked } }))} />
                        Activar
                      </label>
                      <select style={select} value={e.momento} aria-label="Momento"
                        onChange={ev => setEleccion(s => ({ ...s, [t.control_id]: { ...e, momento: ev.target.value as Momento } }))}>
                        {MOMENTOS.map(m => <option key={m} value={m}>{ETIQUETA_MOMENTO[m]}</option>)}
                      </select>
                      <select style={select} value={e.evidencia} aria-label="Evidencia"
                        onChange={ev => setEleccion(s => ({ ...s, [t.control_id]: { ...e, evidencia: ev.target.value as EvidenciaTarea } }))}>
                        {(['ninguna', 'comentario', 'foto'] as EvidenciaTarea[]).map(v => <option key={v} value={v}>{ETIQUETA_EVIDENCIA[v]}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {panel.permisos.activar && (
            <button type="button" style={{ ...boton('primario'), marginTop: 10, opacity: marcadas.length && !ocupado ? 1 : 0.5 }}
              disabled={marcadas.length === 0 || ocupado} onClick={() => void activar()}>
              {ocupado ? 'Activando…' : `Activar ${marcadas.length} tarea${marcadas.length === 1 ? '' : 's'}`}
            </button>
          )}
        </>
      )}

      <div style={sub}>Últimos 7 días</div>
      {panel.turnos.length === 0 ? (
        <div style={nota}>Sin turnos con tareas en estos días.</div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {panel.turnos.map(t => (
            <details key={t.turno_id} style={{ border: '1px solid #1e2d42', borderRadius: 8, padding: '8px 10px', background: '#0f172a' }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, color: '#e2e8f0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span>{t.fecha} {t.hora_inicio?.slice(0, 5)}–{t.hora_fin?.slice(0, 5)} · {t.vigilador ?? 'sin vigilador'}</span>
                <span style={{ color: '#4ade80' }}>{t.hechas} hechas</span>
                {t.no_pude > 0 && <span style={{ color: '#fbbf24' }}>{t.no_pude} no pudo</span>}
                {t.no_aplica > 0 && <span style={{ color: '#94a3b8' }}>{t.no_aplica} no aplica</span>}
                {t.pendientes > 0 && <span style={{ color: '#f87171' }}>{t.pendientes} sin marcar</span>}
              </summary>
              {t.motivos.length === 0 ? <div style={{ ...nota, marginTop: 6 }}>Sin observaciones.</div> : (
                <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                  {t.motivos.map((m, i) => (
                    <div key={i} style={{ ...nota, color: '#cbd5e1' }}>{ETIQUETA_ESTADO_TAREA[m.estado]} · {m.tarea}: <em>{m.comentario}</em></div>
                  ))}
                </div>
              )}
            </details>
          ))}
        </div>
      )}

      {inactivas.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', ...nota }}>Desactivadas ({inactivas.length})</summary>
          {inactivas.map(d => <div key={d.id} style={{ ...nota, marginTop: 4 }}>{d.texto} · {d.motivo_desactivacion}</div>)}
        </details>
      )}
    </div>
  )
}
