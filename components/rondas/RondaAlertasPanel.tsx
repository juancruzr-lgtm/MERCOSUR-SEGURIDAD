'use client'

// Etapa 3.3 · A5 — Alertas de rondas dentro del objetivo, con intervención.
// Solo lectura + registro de intervenciones vía RPC (autorización por zona en el
// servidor). No calcula alertas: las lee de ronda_alertas.

import { useCallback, useEffect, useState } from 'react'
import {
  listarRondaAlertasObjetivo,
  resolverRondaAlerta,
  etiquetaTipoRondaAlerta,
  etiquetaAccionRondaAlerta,
  accionRondaAlertaCierra,
  ACCIONES_RONDA_ALERTA,
  mensajeContextoResolverAlerta,
  type RondaAlerta,
  type EstadoRondaAlerta,
  type AccionRondaAlerta,
} from '@/lib/rondas'
import { useVigenciaCarga } from '@/lib/vigencia-carga'

interface Props {
  objetivoId: string
}

type Filtro = 'pendiente' | 'resuelta' | 'todas'

function fechaHora(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function hora(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '--:--' : d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

export default function RondaAlertasPanel({ objetivoId }: Props) {
  const [filtro, setFiltro] = useState<Filtro>('pendiente')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sinPermiso, setSinPermiso] = useState(false)
  const [alertas, setAlertas] = useState<RondaAlerta[]>([])
  const [intervenir, setIntervenir] = useState<RondaAlerta | null>(null)

  const iniciarCarga = useVigenciaCarga()

  const cargar = useCallback(async () => {
    setCargando(true)
    const vigente = iniciarCarga()
    const estado: EstadoRondaAlerta | undefined = filtro === 'todas' ? undefined : filtro
    const { data, error: err } = await listarRondaAlertasObjetivo(objetivoId, estado)
    // Cambiar de filtro rápido dispara varias cargas: solo escribe la última.
    if (!vigente()) return
    if (err) { setError(err); setAlertas([]); setSinPermiso(false) }
    else {
      setError(null)
      setSinPermiso(data?.contexto === 'sin_permiso' || data?.contexto === 'sin_usuario')
      setAlertas(data?.alertas ?? [])
    }
    setCargando(false)
  }, [objetivoId, filtro, iniciarCarga])

  useEffect(() => { void cargar() }, [cargar])

  if (sinPermiso) {
    return <div style={S.nota}>No tenés permiso para ver las alertas de este objetivo.</div>
  }

  return (
    <div>
      <div style={S.filtros} role="tablist" aria-label="Filtro de alertas">
        {(['pendiente', 'resuelta', 'todas'] as Filtro[]).map(f => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filtro === f}
            style={{ ...S.filtroBtn, ...(filtro === f ? S.filtroBtnActivo : null) }}
            onClick={() => setFiltro(f)}
          >
            {f === 'pendiente' ? 'Pendientes' : f === 'resuelta' ? 'Resueltas' : 'Todas'}
          </button>
        ))}
        <button type="button" onClick={() => void cargar()} disabled={cargando} style={S.recargar} aria-label="Actualizar">
          {cargando ? '…' : '↻'}
        </button>
      </div>

      {cargando && <div style={S.nota}>Cargando alertas…</div>}
      {!cargando && error && <div style={S.error} role="alert">{error}</div>}
      {!cargando && !error && alertas.length === 0 && (
        <div style={S.nota}>{filtro === 'pendiente' ? 'No hay alertas pendientes.' : 'Sin alertas en este filtro.'}</div>
      )}

      {!cargando && !error && alertas.length > 0 && (
        <div style={S.lista}>
          {alertas.map(a => (
            <div key={a.id} style={S.card}>
              <div style={S.cardTop}>
                <span style={{ ...S.tipo, ...(
                  a.tipo === 'no_iniciada' ? S.tipoNoIniciada
                  : a.tipo === 'suspendida' ? S.tipoSuspendida
                  : S.tipoNoFinalizada
                ) }}>
                  {etiquetaTipoRondaAlerta(a.tipo)}
                </span>
                <span style={{ ...S.estado, ...(a.estado === 'pendiente' ? S.estadoPend : S.estadoResuelta) }}>
                  {a.estado === 'pendiente' ? 'Pendiente' : 'Resuelta'}
                </span>
              </div>

              <div style={S.ronda}>{a.ronda_nombre}</div>
              <div style={S.datos}>
                {a.puesto_nombre} · {a.guardia_nombre}
              </div>
              <div style={S.datosTenue}>
                Ventana {hora(a.ventana_inicio)}–{hora(a.ventana_fin)} · venció {fechaHora(a.vencimiento_at)}
              </div>
              {a.tipo === 'suspendida' && a.motivo_vigilador && (
                <div style={S.motivoVig}>Motivo del vigilador: {a.motivo_vigilador}</div>
              )}

              {a.estado === 'resuelta' ? (
                <div style={S.resolucion}>
                  {a.accion ? etiquetaAccionRondaAlerta(a.accion) : 'Resuelta'}
                  {a.resuelta_por_nombre ? ` · ${a.resuelta_por_nombre}` : ''}
                  {a.resuelta_at ? ` · ${fechaHora(a.resuelta_at)}` : ''}
                  {a.comentario ? <div style={S.comentario}>{a.comentario}</div> : null}
                </div>
              ) : (
                <div style={S.acciones}>
                  {a.intervenciones > 0 && <span style={S.intervCount}>{a.intervenciones} intervención(es)</span>}
                  <button type="button" style={S.intervenirBtn} onClick={() => setIntervenir(a)}>Intervenir</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {intervenir && (
        <ModalIntervencion
          alerta={intervenir}
          onCerrar={() => setIntervenir(null)}
          onHecho={() => { setIntervenir(null); void cargar() }}
        />
      )}
    </div>
  )
}

function ModalIntervencion({
  alerta, onCerrar, onHecho,
}: { alerta: RondaAlerta; onCerrar: () => void; onHecho: () => void }) {
  // Cierre administrativo solo aplica si hay ejecución asociada.
  const acciones = ACCIONES_RONDA_ALERTA.filter(
    ac => ac !== 'cierre_administrativo' || alerta.ejecucion_id !== null,
  )
  const [accion, setAccion] = useState<AccionRondaAlerta>(acciones[0])
  const [comentario, setComentario] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)

  const cierra = accionRondaAlertaCierra(accion)
  const minComentario = accion === 'cierre_administrativo' ? 10 : cierra ? 1 : 0
  const comentarioOk = comentario.trim().length >= minComentario

  const enviar = async () => {
    if (enviando || !comentarioOk) return
    setEnviando(true)
    setMensaje(null)
    try {
      const { data, error } = await resolverRondaAlerta(alerta.id, accion, comentario.trim() || undefined)
      if (error) { setMensaje(error); return }
      const msg = data ? mensajeContextoResolverAlerta(data.contexto) : 'No se pudo registrar.'
      if (msg) { setMensaje(msg); return }   // error de contexto: se queda abierto
      onHecho()                              // registrada / resuelta
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div style={S.overlay} role="dialog" aria-modal="true" aria-label="Intervenir alerta" onClick={onCerrar}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.modalHeader}>
          <div style={S.modalTitulo}>Intervenir alerta</div>
          <button type="button" onClick={onCerrar} style={S.cerrar} aria-label="Cerrar">✕</button>
        </div>

        <div style={S.modalSub}>
          {etiquetaTipoRondaAlerta(alerta.tipo)} · {alerta.ronda_nombre} · {alerta.guardia_nombre}
        </div>

        <label style={S.label} htmlFor="accion-alerta">Acción</label>
        <select
          id="accion-alerta"
          value={accion}
          onChange={e => { setAccion(e.target.value as AccionRondaAlerta); setMensaje(null) }}
          style={S.select}
          disabled={enviando}
        >
          {acciones.map(ac => <option key={ac} value={ac}>{etiquetaAccionRondaAlerta(ac)}</option>)}
        </select>

        <label style={S.label} htmlFor="comentario-alerta">
          Comentario{cierra ? ' (obligatorio)' : ' (opcional)'}
          {accion === 'cierre_administrativo' ? ' — mínimo 10 caracteres' : ''}
        </label>
        <textarea
          id="comentario-alerta"
          value={comentario}
          onChange={e => { setComentario(e.target.value); setMensaje(null) }}
          rows={3}
          style={S.textarea}
          disabled={enviando}
          placeholder={cierra ? 'Detalle de la resolución…' : 'Detalle (opcional)…'}
        />

        {cierra && (
          <div style={S.aviso}>Esta acción cierra la alerta. Se conserva la trazabilidad del incumplimiento.</div>
        )}
        {mensaje && <div style={S.error} role="alert">{mensaje}</div>}

        <div style={S.modalBotones}>
          <button type="button" style={S.btnSec} onClick={onCerrar} disabled={enviando}>Cancelar</button>
          <button
            type="button"
            style={{ ...S.btnPri, ...(enviando || !comentarioOk ? S.btnOff : null) }}
            onClick={() => void enviar()}
            disabled={enviando || !comentarioOk}
          >
            {enviando ? 'Registrando…' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  filtros: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 },
  filtroBtn: {
    border: '1px solid #1e2d42', background: '#0f172a', color: '#94a3b8',
    borderRadius: 999, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
  filtroBtnActivo: { background: '#f59e0b', color: '#111827', borderColor: '#f59e0b' },
  recargar: {
    width: 30, height: 30, borderRadius: 999, border: '1px solid #1e2d42',
    background: '#111827', color: '#e2e8f0', fontSize: 15, cursor: 'pointer', marginLeft: 'auto',
  },
  nota: { fontSize: 13, color: '#94a3b8', padding: '14px 4px' },
  error: {
    fontSize: 12, color: '#fecaca', background: '#3b1116',
    border: '1px solid #991b1b', borderRadius: 8, padding: 10, marginTop: 8,
  },
  lista: { display: 'flex', flexDirection: 'column', gap: 10 },
  card: { border: '1px solid #1e2d42', borderRadius: 12, background: '#111827', padding: 14 },
  cardTop: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 },
  tipo: { fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999 },
  tipoNoIniciada: { background: '#3b1116', color: '#fca5a5', border: '1px solid #991b1b' },
  tipoNoFinalizada: { background: '#3f2d10', color: '#fbbf24', border: '1px solid #b45309' },
  tipoSuspendida: { background: '#1e293b', color: '#93c5fd', border: '1px solid #2563eb' },
  motivoVig: { fontSize: 12, color: '#cbd5e1', marginTop: 6, lineHeight: 1.5 },
  estado: { fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999, marginLeft: 'auto' },
  estadoPend: { background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155' },
  estadoResuelta: { background: '#052e16', color: '#4ade80', border: '1px solid #166534' },
  ronda: { fontSize: 15, fontWeight: 800, color: '#f8fafc' },
  datos: { fontSize: 12, color: '#cbd5e1', marginTop: 3 },
  datosTenue: { fontSize: 11, color: '#94a3b8', marginTop: 3 },
  resolucion: { fontSize: 12, color: '#94a3b8', marginTop: 10, borderTop: '1px solid #1e2d42', paddingTop: 8 },
  comentario: { color: '#cbd5e1', marginTop: 4, lineHeight: 1.5 },
  acciones: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 },
  intervCount: { fontSize: 11, color: '#94a3b8' },
  intervenirBtn: {
    marginLeft: 'auto', border: 'none', borderRadius: 8, padding: '8px 16px',
    background: '#f59e0b', color: '#111827', fontWeight: 800, fontSize: 13, cursor: 'pointer',
  },
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(2,6,15,.74)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  modal: {
    width: '100%', maxWidth: 460, background: '#0b1220',
    border: '1px solid #1e2d42', borderRadius: 12, padding: 18,
  },
  modalHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  modalTitulo: { fontSize: 15, fontWeight: 800, color: '#f8fafc' },
  cerrar: {
    width: 32, height: 32, borderRadius: 999, border: '1px solid #1e2d42',
    background: '#111827', color: '#e2e8f0', fontSize: 14, cursor: 'pointer',
  },
  modalSub: { fontSize: 12, color: '#94a3b8', marginBottom: 12 },
  label: { display: 'block', fontSize: 12, color: '#94a3b8', margin: '10px 0 6px', fontWeight: 700 },
  select: {
    width: '100%', background: '#0f172a', color: '#e2e8f0', border: '1px solid #1e2d42',
    borderRadius: 8, padding: '9px 10px', fontSize: 13,
  },
  textarea: {
    width: '100%', background: '#0f172a', color: '#e2e8f0', border: '1px solid #1e2d42',
    borderRadius: 8, padding: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical',
  },
  aviso: { fontSize: 11, color: '#94a3b8', marginTop: 8 },
  modalBotones: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 },
  btnSec: {
    border: '1px solid #1e2d42', background: '#111827', color: '#e2e8f0',
    borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
  btnPri: {
    border: 'none', background: '#f59e0b', color: '#111827',
    borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer',
  },
  btnOff: { background: '#334155', color: '#64748b', cursor: 'not-allowed' },
}
