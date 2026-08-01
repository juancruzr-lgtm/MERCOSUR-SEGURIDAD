'use client'

// Panel de RONDAS PAUSADAS — único componente visual de pausas para toda la app.
//
// Se usa en tres lugares con el mismo código:
//   · Admin  → pantalla global de Rondas (AppClient/RondasGlobal), completo.
//   · Admin  → Dashboard, en modo `compacto` (resumen + acceso).
//   · Supervisor móvil → pestaña Rondas (SupervisorMobile), completo.
//
// El alcance NO se decide acá: `listar_rondas_pausadas` ya filtra por
// `puede_administrar_rondas_objetivo`, así que un admin ve todas las pausas y
// un supervisor solo las de sus zonas. El botón Reanudar se muestra según ese
// mismo alcance: si la RPC devolvió la fila, el usuario puede intervenirla.

import { useCallback, useEffect, useState } from 'react'
import {
  listarRondasPausadas,
  reanudarRonda,
  mensajeContextoPausa,
  type RondaPausa,
} from '@/lib/rondas'
import { formatFechaHora } from '@/lib/formato'

interface Props {
  /** null = todas las pausas en alcance. Con id, solo las de ese objetivo. */
  objetivoId?: string | null
  /** Resumen sin historial ni detalle, para el Dashboard. */
  compacto?: boolean
  /** Se dispara al reanudar, para que el contenedor refresque lo suyo. */
  onCambio?: () => void
  /** Informa la cantidad de pausas VIGENTES cada vez que cambia. */
  onConteo?: (vigentes: number) => void
  /** "Ver todas" del modo compacto. */
  onVerTodas?: () => void
}

export default function RondasPausadasPanel({
  objetivoId = null,
  compacto = false,
  onCambio,
  onConteo,
  onVerTodas,
}: Props) {
  const [pausas, setPausas] = useState<RondaPausa[]>([])
  const [historial, setHistorial] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<string | null>(null)
  const [reanudando, setReanudando] = useState<string | null>(null)
  const [comentario, setComentario] = useState('')
  const [confirmando, setConfirmando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    // En modo compacto nunca se pide historial: el Dashboard muestra lo vigente.
    const { data, error: err } = await listarRondasPausadas(objetivoId, !(historial && !compacto))
    if (err) { setError(err); setPausas([]) }
    else {
      setError(data?.contexto === 'ok' ? null : (mensajeContextoPausa(data?.contexto) ?? null))
      setPausas(data?.pausas ?? [])
    }
    setCargando(false)
  }, [objetivoId, historial, compacto])

  useEffect(() => { void cargar() }, [cargar])

  const vigentes = pausas.filter(p => p.vigente)

  // onConteo se notifica en efecto propio: hacerlo dentro de `cargar` dispararía
  // un setState del padre durante el render de este componente.
  useEffect(() => { onConteo?.(vigentes.length) }, [vigentes.length, onConteo])

  const reanudar = async (pausaId: string) => {
    setReanudando(pausaId)
    const { data, error: err } = await reanudarRonda(pausaId, comentario.trim() || null)
    setReanudando(null)
    if (err) { setError(err); return }
    if (data?.contexto !== 'ok') {
      setError(mensajeContextoPausa(data?.contexto) ?? 'No se pudo reanudar la ronda.')
      return
    }
    setConfirmando(null)
    setComentario('')
    setError(null)
    await cargar()
    onCambio?.()
  }

  if (compacto) {
    return (
      <div>
        <div style={S.encabezado}>
          <div style={S.titulo}>⏸ Rondas pausadas</div>
          {onVerTodas && (
            <button type="button" style={S.enlace} onClick={onVerTodas}>Ver todas</button>
          )}
        </div>
        {cargando && <div style={S.nota}>Cargando…</div>}
        {!cargando && error && <div style={S.error} role="alert">{error}</div>}
        {!cargando && !error && vigentes.length === 0 && (
          <div style={S.nota}>No hay rondas pausadas.</div>
        )}
        {!cargando && !error && vigentes.length > 0 && (
          <>
            <div style={S.contadorGrande}>{vigentes.length}</div>
            {vigentes.slice(0, 3).map(p => (
              <div key={p.id} style={S.filaCompacta}>
                <strong style={{ color: '#fde68a' }}>{p.ronda_nombre}</strong>
                {' · '}{p.objetivo_nombre}
                {' · '}pausada por {p.pausada_por_nombre}
              </div>
            ))}
            {vigentes.length > 3 && (
              <div style={S.nota}>y {vigentes.length - 3} más…</div>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={S.encabezado}>
        <div style={S.titulo}>
          ⏸ Rondas pausadas{vigentes.length > 0 ? ` (${vigentes.length})` : ''}
        </div>
        <button
          type="button"
          style={S.enlace}
          onClick={() => setHistorial(h => !h)}
        >{historial ? 'Solo activas' : 'Ver historial'}</button>
      </div>

      {cargando && <div style={S.nota}>Cargando pausas…</div>}
      {!cargando && error && <div style={S.error} role="alert">{error}</div>}

      {!cargando && !error && pausas.length === 0 && (
        <div style={S.nota}>
          {historial ? 'Sin historial de pausas en tu alcance.' : 'No hay rondas pausadas.'}
        </div>
      )}

      {!cargando && pausas.map(p => {
        const abierto = detalle === p.id
        return (
          <div key={p.id} style={p.vigente ? S.tarjetaVigente : S.tarjeta}>
            <div style={S.rondaNombre}>{p.ronda_nombre}</div>
            <div style={S.sub}>{p.objetivo_nombre} · {p.puesto_nombre}</div>
            <div style={S.motivo}>Motivo: {p.motivo}</div>
            <div style={S.sub}>
              Pausada por {p.pausada_por_nombre} · {formatFechaHora(p.pausada_at)}
            </div>
            <div style={S.sub}>
              Hasta: {p.hasta_at ? formatFechaHora(p.hasta_at) : 'sin límite (hasta reanudar)'}
            </div>

            {!p.activa && p.reactivada_at && (
              <div style={S.reanudada}>
                Reanudada {p.reactivacion_automatica
                  ? '(automática por vencimiento)'
                  : `por ${p.reactivada_por_nombre ?? '—'}`} · {formatFechaHora(p.reactivada_at)}
                {p.reactivada_comentario ? ` · ${p.reactivada_comentario}` : ''}
              </div>
            )}

            {p.activa && !p.vigente && (
              <div style={S.vencida}>
                Pausa vencida. Se normaliza sola en la próxima evaluación de alertas.
              </div>
            )}

            <div style={S.acciones}>
              <button
                type="button"
                style={S.botonSecundario}
                onClick={() => setDetalle(abierto ? null : p.id)}
                aria-expanded={abierto}
              >{abierto ? 'Ocultar detalle' : 'Ver detalle'}</button>

              {p.activa && p.vigente && confirmando !== p.id && (
                <button
                  type="button"
                  style={S.botonPrimario}
                  onClick={() => { setConfirmando(p.id); setComentario('') }}
                >Reanudar</button>
              )}
            </div>

            {abierto && (
              <div style={S.detalle}>
                <Dato label="Objetivo" valor={p.objetivo_nombre} />
                <Dato label="Puesto" valor={p.puesto_nombre} />
                <Dato label="Ronda" valor={p.ronda_nombre} />
                <Dato label="Supervisor" valor={p.pausada_por_nombre} />
                <Dato label="Pausada" valor={formatFechaHora(p.pausada_at)} />
                <Dato label="Hasta" valor={p.hasta_at ? formatFechaHora(p.hasta_at) : 'Sin límite'} />
                <Dato label="Estado" valor={p.vigente ? 'Vigente' : p.activa ? 'Vencida' : 'Reanudada'} />
                <Dato label="Motivo" valor={p.motivo} ancho />
                {p.reactivada_comentario && (
                  <Dato label="Comentario de reanudación" valor={p.reactivada_comentario} ancho />
                )}
              </div>
            )}

            {confirmando === p.id && (
              <div style={S.confirmacion}>
                <div style={S.confirmacionTexto}>
                  Al reanudar, las ventanas posteriores vuelven a evaluarse y a
                  generar alertas y recordatorios. Las ventanas cubiertas por la
                  pausa no se recuperan.
                </div>
                <textarea
                  value={comentario}
                  onChange={e => setComentario(e.target.value)}
                  placeholder="Comentario (opcional)"
                  rows={2}
                  style={S.textarea}
                />
                <div style={S.acciones}>
                  <button
                    type="button"
                    style={S.botonSecundario}
                    onClick={() => { setConfirmando(null); setComentario('') }}
                    disabled={reanudando === p.id}
                  >Cancelar</button>
                  <button
                    type="button"
                    style={{ ...S.botonPrimario, opacity: reanudando === p.id ? 0.6 : 1 }}
                    onClick={() => void reanudar(p.id)}
                    disabled={reanudando === p.id}
                  >{reanudando === p.id ? 'Reanudando…' : 'Confirmar reanudación'}</button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Dato({ label, valor, ancho }: { label: string; valor: string; ancho?: boolean }) {
  return (
    <div style={ancho ? { ...S.dato, gridColumn: '1 / -1' } : S.dato}>
      <span style={S.datoLabel}>{label}</span>
      <span style={S.datoValor}>{valor}</span>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  encabezado: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  titulo: { fontSize: 15, fontWeight: 800, color: '#f59e0b' },
  enlace: { border: 'none', background: 'none', color: '#94a3b8', fontSize: 11, cursor: 'pointer', padding: 0 },
  nota: { fontSize: 12, color: '#64748b', padding: '6px 0' },
  error: {
    fontSize: 12, color: '#fecaca', background: '#3b1116',
    border: '1px solid #991b1b', borderRadius: 8, padding: 10, marginBottom: 8,
  },
  contadorGrande: { fontSize: 26, fontWeight: 900, color: '#f59e0b', margin: '2px 0 6px' },
  filaCompacta: { fontSize: 12, color: '#cbd5e1', marginBottom: 3 },
  tarjeta: {
    background: '#0f172a', border: '1px solid #1e2d42', borderLeft: '3px solid #374151',
    borderRadius: 8, padding: '10px 12px', marginBottom: 8,
  },
  tarjetaVigente: {
    background: '#0f172a', border: '1px solid #92400e', borderLeft: '3px solid #f59e0b',
    borderRadius: 8, padding: '10px 12px', marginBottom: 8,
  },
  rondaNombre: { fontSize: 13, fontWeight: 800, color: '#f8fafc' },
  sub: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  motivo: { fontSize: 11, color: '#cbd5e1', marginTop: 4 },
  reanudada: { fontSize: 11, color: '#4ade80', marginTop: 4 },
  vencida: { fontSize: 11, color: '#fbbf24', marginTop: 4 },
  acciones: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  botonPrimario: {
    flex: 1, minWidth: 120, border: 'none', borderRadius: 6, background: '#166534',
    color: '#fff', padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
  botonSecundario: {
    flex: 1, minWidth: 100, border: '1px solid #334155', borderRadius: 6, background: 'transparent',
    color: '#cbd5e1', padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
  detalle: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6,
    marginTop: 10, paddingTop: 10, borderTop: '1px solid #1e2d42',
  },
  dato: { background: '#0b1220', border: '1px solid #1a2436', borderRadius: 6, padding: '6px 8px' },
  datoLabel: { display: 'block', fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 },
  datoValor: { display: 'block', fontSize: 12, fontWeight: 700, color: '#e2e8f0', lineHeight: 1.4 },
  confirmacion: {
    marginTop: 10, paddingTop: 10, borderTop: '1px solid #1e2d42',
  },
  confirmacionTexto: { fontSize: 11, color: '#fbbf24', marginBottom: 8, lineHeight: 1.5 },
  textarea: {
    width: '100%', background: '#0b1220', border: '1px solid #334155', borderRadius: 6,
    color: '#e2e8f0', fontSize: 12, padding: '6px 8px', fontFamily: 'inherit', resize: 'vertical',
  },
}
