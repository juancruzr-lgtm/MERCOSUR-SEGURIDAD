'use client'

// Alertas de rondas con intervención. Solo lectura + registro de intervenciones
// vía RPC (autorización por zona en el servidor). No calcula alertas: las lee de
// ronda_alertas.
//
// Sirve dos alcances con el mismo componente:
//   objetivoId = string → las alertas de ese objetivo (pestaña Alertas del legajo)
//   objetivoId = null   → las de todos los objetivos del usuario (panel principal
//                         y pestaña Rondas del supervisor)
// En alcance completo se muestra a qué objetivo pertenece cada alerta; es la
// única diferencia de render.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  listarRondaAlertasObjetivo,
  resolverRondaAlerta,
  etiquetaTipoRondaAlerta,
  etiquetaAccionRondaAlerta,
  accionRondaAlertaCierra,
  demoraAlertaMinutos,
  etiquetaDemora,
  pausarRonda,
  mensajeContextoPausa,
  ACCIONES_RONDA_ALERTA,
  mensajeContextoResolverAlerta,
  type RondaAlerta,
  type EstadoRondaAlerta,
  type AccionRondaAlerta,
} from '@/lib/rondas'
import { formatHora24, formatFechaHora } from '@/lib/formato'
import {
  cerrarAlertasPendientes, resumenPrevioRegularizacion, validarMotivoRegularizacion,
} from '@/lib/rondas'
import type { ResumenRegularizacion } from '@/lib/rondas'
import { useVigenciaCarga } from '@/lib/vigencia-carga'

interface Props {
  /** `null` = todos los objetivos del alcance del usuario. */
  objetivoId: string | null
  /** Se llama tras cada intervención y en cada carga, con las alertas vigentes. */
  onAlertas?: (alertas: RondaAlerta[]) => void
  /** Oculta los filtros y fuerza pendientes: para paneles empotrados. */
  soloPendientes?: boolean
  /** Corta el listado y avisa cuántas quedaron fuera. */
  maximo?: number
}

type Filtro = 'pendiente' | 'resuelta' | 'todas'

// Formato 24 h desde lib/formato.ts. `toLocaleString('es-AR')` sin `hour12`
// devuelve "10:45 p. m." en los runtimes con ICU reciente, que en una operación
// de turnos nocturnos es una ambigüedad cara.
function fechaHora(iso: string | null): string {
  return iso ? formatFechaHora(iso) : '—'
}
function hora(iso: string): string {
  return formatHora24(iso)
}

interface GrupoAlerta {
  key: string
  objetivo_id: string
  objetivo_nombre: string
  ronda_base_id: string
  ronda_nombre: string
  puesto_nombre: string
  alertas: RondaAlerta[]
  pendientes: number
  ultimaAlerta: RondaAlerta
  tieneIntervenciones: boolean
}

function msAlerta(iso: string): number {
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : t
}

function agruparAlertas(alertas: RondaAlerta[]): GrupoAlerta[] {
  const mapa = new Map<string, GrupoAlerta>()
  for (const a of alertas) {
    const key = `${a.objetivo_id}::${a.ronda_base_id}`
    let grupo = mapa.get(key)
    if (!grupo) {
      grupo = {
        key,
        objetivo_id: a.objetivo_id,
        objetivo_nombre: a.objetivo_nombre,
        ronda_base_id: a.ronda_base_id,
        ronda_nombre: a.ronda_nombre,
        puesto_nombre: a.puesto_nombre,
        alertas: [],
        pendientes: 0,
        ultimaAlerta: a,
        tieneIntervenciones: false,
      }
      mapa.set(key, grupo)
    }
    grupo.alertas.push(a)
    if (a.estado === 'pendiente') grupo.pendientes++
    if (a.intervenciones > 0 || a.estado === 'resuelta') grupo.tieneIntervenciones = true
    if (msAlerta(a.detectada_at) > msAlerta(grupo.ultimaAlerta.detectada_at)) {
      grupo.ultimaAlerta = a
    }
  }
  return Array.from(mapa.values()).sort((a, b) => {
    if (a.pendientes !== b.pendientes) return b.pendientes - a.pendientes
    return msAlerta(b.ultimaAlerta.detectada_at) - msAlerta(a.ultimaAlerta.detectada_at)
  })
}

export default function RondaAlertasPanel({ objetivoId, onAlertas, soloPendientes = false, maximo }: Props) {
  const [filtro, setFiltro] = useState<Filtro>('pendiente')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sinPermiso, setSinPermiso] = useState(false)
  const [alertas, setAlertas] = useState<RondaAlerta[]>([])
  const [intervenir, setIntervenir] = useState<RondaAlerta | null>(null)
  const [pausar, setPausar] = useState<RondaAlerta | null>(null)
  const [expandido, setExpandido] = useState<Set<string>>(new Set())

  // En alcance completo el objetivo no se sobreentiende: hay que decir cuál es.
  const alcanceCompleto = objetivoId === null
  const iniciarCarga = useVigenciaCarga()

  // `onAlertas` va por ref: si un consumidor pasa una arrow inline, su identidad
  // cambia en cada render y, estando en las deps de `cargar`, dispararía una
  // recarga por render. Con la ref el callback siempre es el último sin
  // participar de las dependencias.
  const onAlertasRef = useRef(onAlertas)
  useEffect(() => { onAlertasRef.current = onAlertas }, [onAlertas])

  const cargar = useCallback(async () => {
    setCargando(true)
    const vigente = iniciarCarga()
    const efectivo: Filtro = soloPendientes ? 'pendiente' : filtro
    const estado: EstadoRondaAlerta | undefined = efectivo === 'todas' ? undefined : efectivo
    const { data, error: err } = await listarRondaAlertasObjetivo(objetivoId, estado)
    // Cambiar de filtro rápido dispara varias cargas: solo escribe la última.
    if (!vigente()) return
    if (err) { setError(err); setAlertas([]); setSinPermiso(false); onAlertasRef.current?.([]) }
    else {
      setError(null)
      setSinPermiso(data?.contexto === 'sin_permiso' || data?.contexto === 'sin_usuario')
      const lista = data?.alertas ?? []
      setAlertas(lista)
      onAlertasRef.current?.(lista)
    }
    setCargando(false)
  }, [objetivoId, filtro, soloPendientes, iniciarCarga])

  useEffect(() => { void cargar() }, [cargar])

  const todosGrupos = useMemo(() => agruparAlertas(alertas), [alertas])
  const grupos = maximo != null ? todosGrupos.slice(0, maximo) : todosGrupos
  const gruposOcultos = todosGrupos.length - grupos.length

  const toggleExpandido = useCallback((key: string) => {
    setExpandido(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  if (sinPermiso) {
    return (
      <div style={S.nota}>
        {alcanceCompleto
          ? 'No tenés objetivos asignados con alertas de rondas.'
          : 'No tenés permiso para ver las alertas de este objetivo.'}
      </div>
    )
  }

  return (
    <div>
      <div style={S.filtros} role={soloPendientes ? undefined : 'tablist'} aria-label="Filtro de alertas">
        {!soloPendientes && (['pendiente', 'resuelta', 'todas'] as Filtro[]).map(f => (
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

      {/* Solo en la pantalla completa de alertas: en los resumenes embebidos
          seria una accion administrativa fuera de lugar. */}
      {!soloPendientes && (
        <RegularizarHistoricas objetivoId={objetivoId} onAplicado={() => void cargar()} />
      )}

      {cargando && <div style={S.nota}>Cargando alertas…</div>}
      {!cargando && error && <div style={S.error} role="alert">{error}</div>}
      {!cargando && !error && alertas.length === 0 && (
        <div style={S.nota}>
          {soloPendientes || filtro === 'pendiente' ? 'No hay alertas pendientes.' : 'Sin alertas en este filtro.'}
        </div>
      )}

      {!cargando && !error && grupos.length > 0 && (
        <div style={S.lista}>
          {grupos.map(g => (
            <div key={g.key} style={S.card}>
              <div style={S.cardTop}>
                <span style={{ ...S.tipo, ...(g.pendientes > 0 ? S.tipoNoIniciada : S.estadoResuelta) }}>
                  {g.pendientes > 0
                    ? `${g.pendientes} pendiente(s)`
                    : `${g.alertas.length} resuelta(s)`}
                </span>
                <span style={{ ...S.estado, ...(g.tieneIntervenciones ? S.estadoIntervenida : (g.pendientes > 0 ? S.estadoPend : S.estadoResuelta)) }}>
                  {g.tieneIntervenciones ? 'Intervenida' : (g.pendientes > 0 ? 'Sin intervención' : 'Resuelta')}
                </span>
              </div>

              {alcanceCompleto && <div style={S.objetivo}>{g.objetivo_nombre}</div>}
              <div style={S.ronda}>{g.ronda_nombre}</div>
              <div style={S.datos}>{g.puesto_nombre} · {g.ultimaAlerta.guardia_nombre}</div>
              {/* Para decidir hace falta saber a qué hora tenía que empezar y
                  cuánto hace que no empieza; con la fecha de detección sola no
                  alcanza. La demora se mide contra el vencimiento, que ya trae
                  aplicada la tolerancia configurada. */}
              <div style={S.datosTenue}>
                Prevista: {fechaHora(g.ultimaAlerta.ventana_inicio)}
                {g.pendientes > 0 && (
                  <>
                    {' · '}
                    <strong style={{ color: '#fbbf24' }}>
                      Demora {etiquetaDemora(demoraAlertaMinutos(g.ultimaAlerta.vencimiento_at))}
                    </strong>
                  </>
                )}
              </div>
              <div style={S.datosTenue}>
                Detectada: {fechaHora(g.ultimaAlerta.detectada_at)}
                {g.ultimaAlerta.accion && <> · Última acción: {etiquetaAccionRondaAlerta(g.ultimaAlerta.accion)}</>}
              </div>

              <div style={S.acciones}>
                {g.pendientes > 0 && (
                  <button type="button" style={S.intervenirBtn} onClick={() => {
                    const pendiente = g.alertas.find(a => a.estado === 'pendiente')
                    if (pendiente) setIntervenir(pendiente)
                  }}>
                    Intervenir
                  </button>
                )}
                {/* Pausar la ronda desde la propia alerta, reutilizando
                    pausar_ronda: la ronda sigue existiendo y queda registrado
                    quién la pausó, cuándo y por qué. Reanudar vive en el panel
                    de Rondas pausadas, que ya lista las activas con su id. */}
                {g.pendientes > 0 && (
                  <button type="button" style={S.detalleBtn} onClick={() => setPausar(g.ultimaAlerta)}>
                    Pausar ronda
                  </button>
                )}
                <button
                  type="button"
                  style={{ ...S.detalleBtn, marginLeft: g.pendientes > 0 ? 0 : 'auto' }}
                  onClick={() => toggleExpandido(g.key)}
                >
                  {expandido.has(g.key) ? 'Ocultar detalle' : 'Ver detalle'}
                </button>
              </div>

              {expandido.has(g.key) && (
                <div style={S.detalleContenedor}>
                  {g.alertas.map(a => (
                    <div key={a.id} style={S.detalleCard}>
                      <div style={S.cardTop}>
                        <span style={{ ...S.tipo, ...(
                          a.tipo === 'no_iniciada' ? S.tipoNoIniciada
                          : a.tipo === 'suspendida' ? S.tipoSuspendida
                          : S.tipoNoFinalizada
                        ) }}>
                          {etiquetaTipoRondaAlerta(a.tipo)}
                        </span>
                        <span style={{ ...S.estado, ...(a.estado === 'pendiente' ? (a.intervenciones > 0 ? S.estadoIntervenida : S.estadoPend) : S.estadoResuelta) }}>
                          {a.estado === 'pendiente'
                            ? (a.intervenciones > 0 ? 'Intervenida' : 'Pendiente')
                            : 'Resuelta'}
                        </span>
                      </div>
                      <div style={S.datos}>{a.guardia_nombre}</div>
                      <div style={S.datosTenue}>
                        Ventana {hora(a.ventana_inicio)}–{hora(a.ventana_fin)} · venció {fechaHora(a.vencimiento_at)}
                      </div>
                      {a.tipo === 'suspendida' && a.motivo_vigilador && (
                        <div style={S.motivoVig}>Motivo: {a.motivo_vigilador}</div>
                      )}
                      {a.estado === 'resuelta' ? (
                        <div style={S.resolucion}>
                          {a.accion ? etiquetaAccionRondaAlerta(a.accion) : 'Resuelta'}
                          {a.resuelta_por_nombre ? ` · ${a.resuelta_por_nombre}` : ''}
                          {a.resuelta_at ? ` · ${fechaHora(a.resuelta_at)}` : ''}
                          {a.comentario ? <div style={S.comentario}>{a.comentario}</div> : null}
                        </div>
                      ) : (
                        <div style={{ ...S.acciones, marginTop: 8 }}>
                          {a.intervenciones > 0 && <span style={S.intervCount}>{a.intervenciones} intervención(es)</span>}
                          <button type="button" style={S.intervenirBtn} onClick={() => setIntervenir(a)}>Intervenir</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {gruposOcultos > 0 && (
            <div style={S.nota}>
              y {gruposOcultos} ronda(s) más con alertas. Abrí Rondas para verlas todas.
            </div>
          )}
        </div>
      )}

      {intervenir && (
        <ModalIntervencion
          alerta={intervenir}
          onCerrar={() => setIntervenir(null)}
          onHecho={() => { setIntervenir(null); void cargar() }}
        />
      )}

      {pausar && (
        <ModalPausar
          alerta={pausar}
          onCerrar={() => setPausar(null)}
          onHecho={() => { setPausar(null); void cargar() }}
        />
      )}
    </div>
  )
}

/**
 * Pausar la ronda desde la alerta. Usa pausar_ronda, la misma RPC del panel de
 * Rondas pausadas: la ronda no se borra, queda una fila en ronda_pausas con
 * quién la pausó, cuándo y el motivo, y solo puede haber una pausa activa por
 * ronda. Pausar no resuelve la alerta por sí solo — eso sigue siendo una
 * decisión aparte desde Intervenir.
 */
function ModalPausar({ alerta, onCerrar, onHecho }: {
  alerta: RondaAlerta
  onCerrar: () => void
  onHecho: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // La tabla exige al menos 5 caracteres: se valida acá para no ir y volver.
  const motivoValido = motivo.trim().length >= 5

  const confirmar = async () => {
    if (!motivoValido || enviando) return
    setEnviando(true)
    setError(null)
    const { data, error: err } = await pausarRonda(alerta.ronda_base_id, motivo.trim())
    setEnviando(false)
    if (err) { setError(err); return }
    if (data && data.contexto !== 'ok') {
      setError(mensajeContextoPausa(data.contexto))
      return
    }
    onHecho()
  }

  return (
    <div style={S.overlay} onClick={() => { if (!enviando) onCerrar() }}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.modalHeader}>
          <span style={S.modalTitulo}>Pausar ronda</span>
          <button type="button" onClick={onCerrar} style={S.cerrar} aria-label="Cerrar">✕</button>
        </div>
        <div style={S.modalSub}>{alerta.ronda_nombre} · {alerta.objetivo_nombre}</div>
        <div style={{ ...S.modalSub, marginBottom: 12 }}>
          La ronda deja de exigirse mientras esté pausada, pero sigue existiendo y queda
          registrado quién la pausó y por qué. La alerta no se cierra sola: si corresponde
          darla por atendida, usá Intervenir.
        </div>

        <label style={S.label} htmlFor="motivo-pausa">Motivo *</label>
        <textarea
          id="motivo-pausa"
          value={motivo}
          onChange={e => setMotivo(e.target.value)}
          rows={3}
          placeholder="Ej.: obra en el objetivo, el recorrido no se puede hacer esta semana."
          style={S.textarea}
        />
        {!motivoValido && motivo.length > 0 && (
          <div style={S.aviso}>El motivo tiene que tener al menos 5 caracteres.</div>
        )}
        {error && <div style={S.error}>{error}</div>}

        <div style={S.modalBotones}>
          <button type="button" onClick={onCerrar} style={S.btnSec} disabled={enviando}>Cancelar</button>
          <button
            type="button"
            onClick={confirmar}
            style={!motivoValido || enviando ? S.btnOff : S.btnPri}
            disabled={!motivoValido || enviando}
          >
            {enviando ? 'Pausando…' : 'Pausar ronda'}
          </button>
        </div>
      </div>
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
        <div style={S.modalSub}>
          Ventana {hora(alerta.ventana_inicio)}–{hora(alerta.ventana_fin)} · venció {fechaHora(alerta.vencimiento_at)}
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
  estadoPend: { background: '#ef444422', color: '#ef4444', border: '1px solid #ef444455' },
  estadoIntervenida: { background: '#a3e63522', color: '#a3e635', border: '1px solid #a3e63555' },
  estadoResuelta: { background: '#a3e63522', color: '#a3e635', border: '1px solid #a3e63555' },
  objetivo: { fontSize: 11, fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
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
  detalleBtn: {
    border: '1px solid #1e2d42', background: '#0f172a', color: '#94a3b8',
    borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: 12, cursor: 'pointer',
  },
  detalleContenedor: {
    marginTop: 10, paddingTop: 10, borderTop: '1px solid #1e2d42',
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  detalleCard: {
    border: '1px solid #1e2d42', borderRadius: 8, background: '#0f172a', padding: 10,
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

// ── Regularizar alertas anteriores ───────────────────────────────────────────
//
// Cerrar en lote alertas viejas que son ciertas pero ya no son trabajo de hoy.
// Nunca borra: cada cierre pasa por resolver_ronda_alerta y queda su
// intervencion con actor, motivo y fecha. Por eso el flujo es en dos pasos —
// primero se ve a quien afecta, despues se confirma con motivo.

function RegularizarHistoricas({ objetivoId, onAplicado }: {
  objetivoId: string | null
  onAplicado: () => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [hasta, setHasta] = useState('')
  const [motivo, setMotivo] = useState('')
  const [previa, setPrevia] = useState<ResumenRegularizacion | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)

  const errorMotivo = motivo ? validarMotivoRegularizacion(motivo) : null

  const reiniciar = () => {
    setPrevia(null); setError(null); setHecho(null)
  }

  const verPrevia = async () => {
    if (!hasta) { setError('Elegí hasta qué fecha regularizar.'); return }
    setTrabajando(true); setError(null); setHecho(null)
    const r = await cerrarAlertasPendientes({ hasta, objetivoId, soloConteo: true })
    if (r.error) setError(r.error)
    else setPrevia(r.data)
    setTrabajando(false)
  }

  const aplicar = async () => {
    const problema = validarMotivoRegularizacion(motivo)
    if (problema) { setError(problema); return }
    if (!previa || previa.total === 0) return
    if (!window.confirm(
      `Se van a cerrar ${previa.total} alertas pendientes anteriores a ${hasta}. `
      + 'Quedan en el historial, no se borra ninguna. ¿Confirmás?',
    )) return

    setTrabajando(true); setError(null)
    const r = await cerrarAlertasPendientes({ hasta, motivo, objetivoId, soloConteo: false })
    if (r.error) {
      setError(r.error)
    } else {
      setHecho(`${r.data.regularizadas} alerta${r.data.regularizadas === 1 ? '' : 's'} regularizada${r.data.regularizadas === 1 ? '' : 's'}. Siguen en el historial.`)
      setPrevia(null); setMotivo('')
      onAplicado()
    }
    setTrabajando(false)
  }

  if (!abierto) {
    return (
      <div style={{ marginBottom: 10 }}>
        <button type="button" style={S.filtroBtn} onClick={() => setAbierto(true)}>
          Regularizar alertas anteriores
        </button>
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 12, padding: 12, border: '1px solid #33415577', borderRadius: 8, background: '#0f172a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: 12.5, color: '#e2e8f0' }}>Regularizar alertas anteriores</strong>
        <button type="button" style={S.filtroBtn} onClick={() => { setAbierto(false); reiniciar() }}>Cerrar</button>
      </div>

      <div style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 10 }}>
        Cierra las alertas pendientes vencidas antes de la fecha elegida. No se borra ninguna:
        quedan como resueltas, con tu nombre y el motivo, y siguen consultables en el historial.
      </div>

      <label style={{ fontSize: 11.5, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
        Hasta la fecha (sin incluirla)
      </label>
      <input
        type="date"
        value={hasta}
        onChange={e => { setHasta(e.target.value); reiniciar() }}
        style={{ ...S.filtroBtn, padding: '6px 10px', marginRight: 8 }}
      />
      <button type="button" style={S.filtroBtn} onClick={() => void verPrevia()} disabled={trabajando || !hasta}>
        {trabajando ? '…' : 'Ver qué se va a cerrar'}
      </button>

      {previa && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: '#38bdf8', marginBottom: 8 }}>
            {resumenPrevioRegularizacion(previa)}
          </div>
          {previa.total > 0 && (
            <>
              <label style={{ fontSize: 11.5, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                Motivo (queda asentado en cada alerta)
              </label>
              <textarea
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Por ejemplo: alertas previas al encendido del monitoreo automático."
                style={{ width: '100%', background: '#0b1220', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: 8, fontSize: 12 }}
              />
              {errorMotivo && <div style={{ fontSize: 11.5, color: '#f59e0b', marginTop: 4 }}>{errorMotivo}</div>}
              <button
                type="button"
                style={{ ...S.filtroBtn, ...S.filtroBtnActivo, marginTop: 8 }}
                onClick={() => void aplicar()}
                disabled={trabajando || Boolean(validarMotivoRegularizacion(motivo))}
              >
                {trabajando ? 'Regularizando…' : `Regularizar ${previa.total}`}
              </button>
            </>
          )}
        </div>
      )}

      {error && <div style={{ ...S.error, marginTop: 10 }} role="alert">{error}</div>}
      {hecho && <div style={{ fontSize: 12, color: '#10b981', marginTop: 10 }}>{hecho}</div>}
    </div>
  )
}
