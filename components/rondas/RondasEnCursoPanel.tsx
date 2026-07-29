'use client'

// Lista mínima de rondas en curso de un objetivo, con la única acción que hoy
// desbloquea la operación: cerrar una ronda que el vigilador no puede terminar.
//
// No es la vista de la Etapa 3.3. No hay historial, ni evidencias, ni detalle
// por punto, ni tiempo real. Sólo lo necesario para decidir y cerrar.

import { useCallback, useEffect, useState } from 'react'
import { btn, btnPrimary, btnSecondary } from '@/components/ui/base'
import {
  cerrarRondaBloqueada,
  listarEjecucionesEnCursoObjetivo,
  mensajeContextoCerrarRonda,
  MOTIVO_CIERRE_MIN,
  validarMotivoCierre,
  type EjecucionEnCurso,
} from '@/lib/rondas'

interface Props {
  objetivoId: string
  /** Permite al contenedor refrescar lo que dependa de las rondas tras un cierre. */
  onCierre?: () => void
  /** Abre el detalle de una ejecución sin duplicar este panel (B5, opcional). */
  onVerDetalle?: (ejecucionId: string) => void
}

function horaCorta(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function RondasEnCursoPanel({ objetivoId, onCierre, onVerDetalle }: Props) {
  const [ejecuciones, setEjecuciones] = useState<EjecucionEnCurso[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [sinPermiso, setSinPermiso] = useState(false)

  const [cerrando, setCerrando] = useState<EjecucionEnCurso | null>(null)
  const [motivo, setMotivo] = useState('')
  const [errorCierre, setErrorCierre] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data, error: err } = await listarEjecucionesEnCursoObjetivo(objetivoId)
    if (err) {
      setError(err)
      setEjecuciones([])
    } else {
      setError('')
      setSinPermiso(data?.contexto === 'sin_permiso' || data?.contexto === 'sin_usuario')
      setEjecuciones(data?.ejecuciones ?? [])
    }
    setCargando(false)
  }, [objetivoId])

  useEffect(() => { void cargar() }, [cargar])

  const confirmarCierre = async () => {
    if (!cerrando || enviando) return

    const invalido = validarMotivoCierre(motivo)
    if (invalido) {
      setErrorCierre(invalido)
      return
    }

    setEnviando(true)
    setErrorCierre('')
    try {
      const { data, error: err } = await cerrarRondaBloqueada(cerrando.id, motivo)
      if (err || !data) {
        setErrorCierre(err || 'No se pudo cerrar la ronda.')
        return
      }

      const mensaje = mensajeContextoCerrarRonda(data.contexto)
      if (mensaje) {
        setErrorCierre(mensaje)
        return
      }

      // 'cerrada' y 'ya_cerrada' son ambos éxito: el reintento de una ronda ya
      // cerrada devuelve el cierre original y no vuelve a escribir.
      const omitidos = data.ejecucion?.puntos_omitidos
      setAviso(
        data.contexto === 'ya_cerrada'
          ? `La ronda «${cerrando.ronda_nombre}» ya estaba cerrada. No se modificó nada.`
          : `Ronda «${cerrando.ronda_nombre}» cerrada`
            + (omitidos != null ? `: ${omitidos} punto(s) quedaron omitidos.` : '.'),
      )
      setCerrando(null)
      setMotivo('')
      await cargar()
      onCierre?.()
    } finally {
      setEnviando(false)
    }
  }

  if (sinPermiso) return null
  if (!cargando && !error && ejecuciones.length === 0 && !aviso) return null

  return (
    <div style={S.wrap}>
      <div style={S.titulo}>Rondas en curso</div>

      {aviso && <div style={S.aviso} role="status">{aviso}</div>}

      {cargando && <div style={S.nota}>Cargando rondas en curso…</div>}

      {!cargando && error && <div style={S.error}>{error}</div>}

      {!cargando && !error && ejecuciones.length > 0 && (
        <div style={S.lista}>
          {ejecuciones.map(e => (
            <div key={e.id} style={S.fila}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={S.filaTitulo}>
                  {e.ronda_nombre}
                  {e.turno_vencido && <span style={S.badgeVencido}>Turno vencido</span>}
                </div>
                <div style={S.filaDatos}>
                  {e.guardia_nombre} · {e.puesto_nombre} · inicio {horaCorta(e.iniciada_at)}
                  {' · '}
                  {e.puntos_total - e.puntos_pendientes}/{e.puntos_total} puntos
                </div>
              </div>
              {onVerDetalle && (
                <button
                  type="button"
                  style={{ ...btn, ...btnPrimary, flexShrink: 0 }}
                  onClick={() => onVerDetalle(e.id)}
                >
                  Ver detalle
                </button>
              )}
              <button
                type="button"
                style={{ ...btn, ...btnSecondary, flexShrink: 0 }}
                onClick={() => { setCerrando(e); setMotivo(''); setErrorCierre(''); setAviso('') }}
              >
                Cerrar ronda bloqueada
              </button>
            </div>
          ))}
        </div>
      )}

      {cerrando && (
        <div style={S.overlay} role="dialog" aria-modal="true" aria-label="Cerrar ronda bloqueada">
          <div style={S.modal}>
            <div style={S.modalTitulo}>Cerrar ronda bloqueada</div>

            <div style={S.modalTexto}>
              Vas a cerrar «{cerrando.ronda_nombre}» de {cerrando.guardia_nombre}.
              Los {cerrando.puntos_pendientes} punto(s) pendientes quedan como <strong>omitidos</strong> y
              la ronda como <strong>incompleta</strong>. Las fotos, el GPS y los puntos ya
              registrados se conservan. Esta acción no se puede deshacer.
            </div>

            <label style={S.label} htmlFor="motivo-cierre-ronda">
              Motivo (obligatorio, mínimo {MOTIVO_CIERRE_MIN} caracteres)
            </label>
            <textarea
              id="motivo-cierre-ronda"
              style={S.textarea}
              value={motivo}
              onChange={ev => { setMotivo(ev.target.value); setErrorCierre('') }}
              rows={3}
              placeholder="Ej.: porton del sector B sin llave, punto inaccesible"
              disabled={enviando}
            />

            {errorCierre && <div style={S.error}>{errorCierre}</div>}

            <div style={S.modalBotones}>
              <button
                type="button"
                style={{ ...btn, ...btnSecondary }}
                onClick={() => { setCerrando(null); setMotivo(''); setErrorCierre('') }}
                disabled={enviando}
              >
                Cancelar
              </button>
              <button
                type="button"
                style={{
                  ...btn, ...btnPrimary,
                  ...(enviando || motivo.trim().length < MOTIVO_CIERRE_MIN ? S.botonOff : null),
                }}
                onClick={() => void confirmarCierre()}
                disabled={enviando || motivo.trim().length < MOTIVO_CIERRE_MIN}
              >
                {enviando ? 'Cerrando…' : 'Confirmar cierre'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { marginTop: 16, paddingTop: 16, borderTop: '1px solid #1e2d42' },
  titulo: { fontSize: 14, fontWeight: 800, color: '#f8fafc', marginBottom: 10 },
  nota: { fontSize: 13, color: '#94a3b8' },
  error: {
    fontSize: 12, color: '#fecaca', background: '#3b1116',
    border: '1px solid #991b1b', borderRadius: 8, padding: 10, marginTop: 8,
  },
  aviso: {
    fontSize: 12, color: '#bbf7d0', background: '#052e1a',
    border: '1px solid #166534', borderRadius: 8, padding: 10, marginBottom: 10,
  },
  lista: { display: 'flex', flexDirection: 'column', gap: 8 },
  fila: {
    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    background: '#0f172a', border: '1px solid #1e2d42', borderRadius: 8, padding: '10px 12px',
  },
  filaTitulo: { fontSize: 13, fontWeight: 700, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 },
  filaDatos: { fontSize: 11, color: '#94a3b8', marginTop: 3 },
  badgeVencido: {
    fontSize: 10, fontWeight: 800, color: '#fffbeb', background: '#b45309',
    borderRadius: 999, padding: '2px 8px',
  },
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(2,6,23,.72)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  modal: {
    width: '100%', maxWidth: 460, background: '#0b1220',
    border: '1px solid #1e2d42', borderRadius: 12, padding: 18,
  },
  modalTitulo: { fontSize: 15, fontWeight: 800, color: '#f8fafc', marginBottom: 10 },
  modalTexto: { fontSize: 13, color: '#cbd5e1', lineHeight: 1.5, marginBottom: 14 },
  label: { display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 },
  textarea: {
    width: '100%', background: '#0f172a', color: '#e2e8f0',
    border: '1px solid #1e2d42', borderRadius: 8, padding: 10, fontSize: 13,
    fontFamily: 'inherit', resize: 'vertical',
  },
  modalBotones: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 },
  botonOff: { background: '#334155', color: '#64748b', borderColor: '#334155', cursor: 'not-allowed' },
}
