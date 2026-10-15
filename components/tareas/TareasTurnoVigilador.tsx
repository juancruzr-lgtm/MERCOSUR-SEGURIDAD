'use client'

/**
 * components/tareas/TareasTurnoVigilador.tsx
 *
 * Las tareas del turno, para el vigilador: agrupadas en «Al ingresar»,
 * «Durante el turno» y «Al retirarse». Cada una se marca con un toque:
 * Hecha · No aplica · No pude (estas dos piden un motivo breve). Si la tarea
 * pide foto, después de «Hecha» se saca la foto ahí mismo.
 *
 * No bloquea nada: se cierra siempre, con tareas sin marcar. Lo marcado no se
 * puede cambiar después (queda como constancia para supervisión) y no cuenta
 * para Mi Desempeño.
 */

import { useEffect, useState } from 'react'
import { mensajeErrorFoto, prepararFotoOperativa } from '@/lib/comprimir-imagen'
import { ETIQUETA_ESTADO_TAREA, ETIQUETA_MOMENTO, agruparPorMomento, faltaParaRegistrar, progreso } from '@/lib/tareas-turno'
import type { EstadoTarea, TareaDelTurno } from '@/lib/tareas-turno'
import { registrarTarea, subirFotoTarea } from '@/lib/tareas-turno-datos'

export default function TareasTurnoVigilador({ turnoId, objetivoNombre, tareas, onCerrar, onCambio }: {
  turnoId: string
  objetivoNombre: string | null
  tareas: TareaDelTurno[]
  onCerrar: () => void
  /** Recargar las tareas después de registrar o subir una foto. */
  onCambio: () => Promise<void> | void
}) {
  const p = progreso(tareas)

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', tecla)
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', tecla); document.body.style.overflow = previo }
  }, [onCerrar])

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Tareas del turno"
      style={{
        position: 'fixed', inset: 0, zIndex: 900, background: '#0a0e1a', color: '#e2e8f0', display: 'flex', flexDirection: 'column',
        paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px 12px', borderBottom: '1px solid #1e2d42', background: '#0f172a' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em' }}>Tareas del turno</div>
          <div style={{ fontSize: 16.5, fontWeight: 800, overflowWrap: 'anywhere' }}>{objetivoNombre ?? '—'}</div>
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>
            {p.marcadas} de {p.total} marcadas{p.falta_foto ? ` · falta ${p.falta_foto} foto${p.falta_foto === 1 ? '' : 's'}` : ''}
          </div>
        </div>
        <button type="button" onClick={onCerrar} aria-label="Cerrar las tareas"
          style={{ background: 'none', border: '1px solid #334155', color: '#cbd5e1', borderRadius: 8, padding: '8px 12px', fontSize: 14, cursor: 'pointer', flex: 'none' }}>
          Cerrar
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 24px', display: 'grid', gap: 16, alignContent: 'start' }}>
        {agruparPorMomento(tareas).map(g => (
          <section key={g.momento} aria-label={ETIQUETA_MOMENTO[g.momento]}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
              {ETIQUETA_MOMENTO[g.momento]}
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {g.tareas.map(t => <Tarea key={t.definicion_id} turnoId={turnoId} tarea={t} onCambio={onCambio} />)}
            </div>
          </section>
        ))}
        <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
          Lo que marcás queda registrado para tu supervisor. No cambia tu calificación.
        </div>
      </div>
    </div>
  )
}

const btn = (activo: boolean, color: string): React.CSSProperties => ({
  flex: '1 1 0', minWidth: 0, borderRadius: 8, padding: '10px 6px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${activo ? color : '#334155'}`, background: activo ? `${color}22` : 'transparent', color: activo ? color : '#cbd5e1',
})
const COLOR: Record<EstadoTarea, string> = { hecha: '#22c55e', no_aplica: '#94a3b8', no_pude: '#f59e0b' }

function Tarea({ turnoId, tarea, onCambio }: { turnoId: string; tarea: TareaDelTurno; onCambio: () => Promise<void> | void }) {
  const [elegido, setElegido] = useState<EstadoTarea | null>(null)
  const [comentario, setComentario] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const r = tarea.registro

  const enviar = async (estado: EstadoTarea) => {
    const falta = faltaParaRegistrar(tarea, estado, comentario)
    if (falta) { setElegido(estado); setError(falta); return }
    setEnviando(true); setError(null)
    const res = await registrarTarea(turnoId, tarea.definicion_id, estado, comentario.trim() || null)
    setEnviando(false)
    if (res.error) { setError(navigator.onLine === false ? 'Sin conexión: probá de nuevo cuando vuelva la señal.' : res.error); return }
    await onCambio()
  }

  const subir = async (file: File | undefined) => {
    if (!file || !r) return
    setEnviando(true); setError(null)
    const prep = await prepararFotoOperativa(file, 'operativa')
    if (prep.error) { setEnviando(false); setError(mensajeErrorFoto(prep.error)); return }
    const s = await subirFotoTarea(r.id, prep.file)
    setEnviando(false)
    if (s.error) { setError(s.error); return }
    await onCambio()
  }

  return (
    <div style={{ border: `1px solid ${r ? `${COLOR[r.estado]}66` : '#1e2d42'}`, borderRadius: 10, padding: 12, background: '#0f172a' }}>
      <div style={{ fontSize: 15, lineHeight: 1.45, color: '#e2e8f0' }}>{tarea.texto}</div>

      {r ? (
        <div style={{ marginTop: 8, fontSize: 13, color: COLOR[r.estado], fontWeight: 700 }}>
          ✓ {ETIQUETA_ESTADO_TAREA[r.estado]}
          {r.comentario && <span style={{ color: '#94a3b8', fontWeight: 400 }}> · {r.comentario}</span>}
          {tarea.evidencia === 'foto' && r.estado === 'hecha' && (
            r.con_foto
              ? <span style={{ color: '#94a3b8', fontWeight: 400 }}> · foto cargada</span>
              : (
                <label style={{ display: 'block', marginTop: 8 }}>
                  <span style={{
                    display: 'inline-block', background: '#2563eb', color: '#fff', borderRadius: 8, padding: '9px 14px',
                    fontSize: 13.5, fontWeight: 700, cursor: 'pointer', opacity: enviando ? 0.6 : 1,
                  }}>
                    {enviando ? 'Subiendo…' : '📷 Sacar la foto'}
                  </span>
                  <input type="file" accept="image/*" capture="environment" disabled={enviando}
                    onChange={e => void subir(e.target.files?.[0])} style={{ display: 'none' }} />
                </label>
              )
          )}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            {(['hecha', 'no_aplica', 'no_pude'] as EstadoTarea[]).map(e => (
              <button key={e} type="button" disabled={enviando} style={btn(elegido === e, COLOR[e])}
                onClick={() => (e === 'hecha' && tarea.evidencia !== 'comentario' ? void enviar(e) : (setElegido(e), setError(null)))}>
                {ETIQUETA_ESTADO_TAREA[e]}
              </button>
            ))}
          </div>
          {elegido && (elegido !== 'hecha' || tarea.evidencia === 'comentario') && (
            <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              <textarea
                value={comentario} onChange={e => setComentario(e.target.value)} maxLength={1000}
                placeholder={elegido === 'hecha' ? 'Comentario' : '¿Por qué?'}
                aria-label="Comentario"
                style={{ width: '100%', boxSizing: 'border-box', minHeight: 60, background: '#0a0e1a', border: '1px solid #1e2d42', color: '#e2e8f0', borderRadius: 8, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit' }}
              />
              <button type="button" disabled={enviando} onClick={() => void enviar(elegido)}
                style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, padding: '10px', fontSize: 14, fontWeight: 800, cursor: 'pointer', opacity: enviando ? 0.6 : 1 }}>
                {enviando ? 'Guardando…' : `Guardar «${ETIQUETA_ESTADO_TAREA[elegido]}»`}
              </button>
            </div>
          )}
        </>
      )}
      {error && <div role="alert" style={{ color: '#f87171', fontSize: 13, marginTop: 6 }}>{error}</div>}
    </div>
  )
}
