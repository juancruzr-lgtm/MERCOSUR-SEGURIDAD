'use client'

// Secciones de historial del Legajo del Objetivo.
//
// Van aparte de CentroOperativoObjetivo por una razón de comportamiento, no de
// prolijidad: cada sección es un acordeón que consulta SOLO cuando se abre. Si
// vivieran dentro del componente padre, sus efectos correrían al montar el
// legajo y cada apertura de un objetivo dispararía cuatro consultas más que casi
// nadie mira.
//
// Ninguna sección calcula estados: los lee de columnas ya persistidas
// (`alerta_entrada`, `gps_ingreso_estado`, `estado`) o de las RPC del motor de
// rondas. El detalle siempre delega en los componentes que ya existen.

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import RondaEjecucionDetalle from '@/components/rondas/RondaEjecucionDetalle'
import {
  cargarAsistenciasObjetivo,
  cargarSupervisionesObjetivo,
  cargarNovedadesObjetivo,
  actualizarUbicacionObjetivo,
  fechaHaceDias,
  LEGAJO_DIAS_HISTORIAL,
  type AsistenciaLegajo,
  type SupervisionRecienteLegajo,
  type NovedadRecienteLegajo,
  type ObjetivoLegajo,
} from '@/lib/legajo-objetivo'
import {
  listarRondasProgramadasObjetivo,
  etiquetaEstadoRondaProgramada,
  rondaProgramadaEsIncumplida,
  type RondaProgramada,
} from '@/lib/rondas'
import { capturarGpsNuevo } from '@/lib/gps-captura'

const ObjetivoUbicacionMap = dynamic(() => import('./ObjetivoUbicacionMap'), {
  ssr: false,
  loading: () => <div style={S.nota}>Cargando mapa…</div>,
})

// ── Acordeón ──────────────────────────────────────────────────────────────────

/** Sección plegable. La carga diferida la coordina `useSeccion`, más abajo. */
function Seccion({
  titulo, resumen, abierta, onToggle, children,
}: {
  titulo: string
  resumen?: string
  abierta: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div style={S.card}>
      <button type="button" style={S.cabecera} onClick={onToggle} aria-expanded={abierta}>
        <span style={S.secTitle}>{titulo}</span>
        {resumen && <span style={S.resumen}>{resumen}</span>}
        <span style={S.chevron}>{abierta ? '▲' : '▼'}</span>
      </button>
      {abierta && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  )
}

/**
 * Estado de una sección con carga diferida.
 *
 * La consulta se dispara en la PRIMERA apertura y no se repite al plegar y
 * volver a desplegar. Es lo que evita que abrir el legajo de un objetivo cueste
 * cuatro consultas de historial que nadie pidió.
 */
function useSeccion(cargar: () => void) {
  const [abierta, setAbierta] = useState(false)
  const [cargada, setCargada] = useState(false)
  const toggle = () => {
    setAbierta(v => !v)
    if (!cargada) { setCargada(true); cargar() }
  }
  return { abierta, toggle }
}

// ── Utilidades de presentación ────────────────────────────────────────────────

function fechaHora(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function horaCorta(v: string | null): string {
  return v ? v.slice(0, 5) : '—'
}
function fechaCorta(f: string): string {
  const [a, m, d] = f.split('-')
  return d && m ? `${d}/${m}` : f
}
function hora(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '--:--' : d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

function Chip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{
      background: `${color}22`, color, border: `1px solid ${color}44`,
      borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

// ── 2.1 Ubicación ─────────────────────────────────────────────────────────────

export function SeccionUbicacion({
  objetivo, puedeEditar, onActualizado,
}: {
  objetivo: ObjetivoLegajo
  puedeEditar: boolean
  onActualizado: (o: ObjetivoLegajo) => void
}) {
  const [abierta, setAbierta] = useState(true)
  const [estado, setEstado] = useState<'idle' | 'capturando' | 'guardando'>('idle')
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [precision, setPrecision] = useState<number | null>(null)

  const tieneUbicacion = objetivo.lat !== null && objetivo.lng !== null

  const actualizar = async () => {
    setMensaje(null)
    setPrecision(null)
    setEstado('capturando')

    // Misma captura que usan los puntos de ronda: watchPosition con descarte de
    // lecturas viejas. `getCurrentPosition` a secas repite en iPhone la primera
    // lectura de la sesión y grabaría coordenadas de otro objetivo.
    const captura = capturarGpsNuevo({ onProgreso: setPrecision })
    const res = await captura.promesa

    if (!res.ok) {
      setEstado('idle')
      setMensaje(
        res.motivo === 'permiso_denegado' ? 'Permiso de ubicación denegado.'
          : res.motivo === 'sin_soporte' ? 'Este dispositivo no expone GPS.'
            : 'No se pudo obtener una lectura GPS.',
      )
      return
    }

    setEstado('guardando')
    const { objetivo: actualizado, error } = await actualizarUbicacionObjetivo(
      objetivo.id,
      res.posicion.coords.latitude,
      res.posicion.coords.longitude,
      objetivo.radio_metros || 200,
    )
    setEstado('idle')

    if (error) { setMensaje(error); return }
    if (actualizado) {
      onActualizado(actualizado)
      setMensaje(`Ubicación actualizada (precisión ${Math.round(res.posicion.coords.accuracy)} m).`)
    }
  }

  const trabajando = estado !== 'idle'

  return (
    <Seccion
      titulo="Ubicación"
      resumen={tieneUbicacion ? `radio ${objetivo.radio_metros ?? '—'} m` : 'sin GPS'}
      abierta={abierta}
      onToggle={() => setAbierta(v => !v)}
    >
      {!tieneUbicacion ? (
        <div style={S.nota}>Este objetivo todavía no tiene coordenadas cargadas.</div>
      ) : (
        <ObjetivoUbicacionMap
          lat={objetivo.lat as number}
          lng={objetivo.lng as number}
          radioMetros={objetivo.radio_metros}
          nombre={objetivo.nombre}
        />
      )}

      <div style={S.grid}>
        <Dato label="Dirección" valor={objetivo.direccion || '—'} />
        <Dato label="Latitud" valor={objetivo.lat !== null ? String(objetivo.lat) : '—'} />
        <Dato label="Longitud" valor={objetivo.lng !== null ? String(objetivo.lng) : '—'} />
        <Dato label="Radio" valor={objetivo.radio_metros !== null ? `${objetivo.radio_metros} m` : '—'} />
      </div>

      {puedeEditar && (
        <div style={{ marginTop: 12 }}>
          <button type="button" style={{ ...S.btn, opacity: trabajando ? 0.6 : 1 }} onClick={() => void actualizar()} disabled={trabajando}>
            {estado === 'capturando'
              ? `Obteniendo GPS${precision !== null ? ` (±${Math.round(precision)} m)` : ''}…`
              : estado === 'guardando' ? 'Guardando…' : '📍 Actualizar ubicación'}
          </button>
          <div style={S.aviso}>
            Toma la posición del dispositivo actual. Usalo estando en el objetivo.
          </div>
        </div>
      )}

      {mensaje && <div style={S.mensaje}>{mensaje}</div>}
    </Seccion>
  )
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div style={S.celda}>
      <span style={S.celdaLabel}>{label}</span>
      <span style={S.celdaValor}>{valor}</span>
    </div>
  )
}

// ── 2.2 Asistencias ───────────────────────────────────────────────────────────

export function SeccionAsistencias({ objetivoId, onVerTodas }: { objetivoId: string; onVerTodas?: () => void }) {
  const [items, setItems] = useState<AsistenciaLegajo[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { asistencias, error: err } = await cargarAsistenciasObjetivo(objetivoId)
    setItems(asistencias); setError(err); setCargando(false)
  }, [objetivoId])

  const { abierta, toggle } = useSeccion(() => void cargar())

  return (
    <Seccion titulo="Asistencias" resumen={`últimos ${LEGAJO_DIAS_HISTORIAL} días`} abierta={abierta} onToggle={toggle}>
      {cargando && <div style={S.nota}>Cargando asistencias…</div>}
      {!cargando && error && <div style={S.error}>{error}</div>}
      {!cargando && !error && items.length === 0 && (
        <div style={S.nota}>Sin turnos en el período.</div>
      )}
      {items.length > 0 && (
        <div style={S.scrollX}>
          <table style={S.tabla}>
            <thead>
              <tr>{['Fecha', 'Vigilador', 'Ingreso', 'Egreso', 'Estado'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {items.map(a => (
                <tr key={a.turno_id} style={S.tr}>
                  <td style={S.td}>
                    {fechaCorta(a.fecha)}
                    <div style={S.sub}>{horaCorta(a.hora_inicio)}–{horaCorta(a.hora_fin)}</div>
                  </td>
                  <td style={S.td}>{a.guardia_nombre}</td>
                  <td style={S.td}>{horaCorta(a.hora_entrada_real)}</td>
                  <td style={S.td}>{horaCorta(a.hora_salida_real)}</td>
                  <td style={{ ...S.td, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {!a.guardia_id ? <Chip color="#ef4444">Sin guardia</Chip>
                      : !a.hora_entrada_real ? <Chip color="#f59e0b">Sin fichar</Chip>
                      : !a.hora_salida_real ? <Chip color="#10b981">Pendiente salida</Chip>
                      : <Chip color="#64748b">Completado</Chip>}
                    {a.alerta_entrada === 'tarde' && <Chip color="#f59e0b">Tarde</Chip>}
                    {a.gps_ingreso_estado === 'fuera_radio' && <Chip color="#ef4444">Fuera de radio</Chip>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {onVerTodas && (
        <button type="button" style={{ ...S.btn, marginTop: 10 }} onClick={onVerTodas}>
          Ver historial de asistencias →
        </button>
      )}
    </Seccion>
  )
}

// ── 2.3 Rondas ────────────────────────────────────────────────────────────────

export function SeccionRondas({ objetivoId, onVerHistorial }: { objetivoId: string; onVerHistorial?: () => void }) {
  const [items, setItems] = useState<RondaProgramada[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data, error: err } = await listarRondasProgramadasObjetivo(
      objetivoId, fechaHaceDias(LEGAJO_DIAS_HISTORIAL), new Date().toLocaleDateString('sv-SE'),
    )
    if (err) { setError(err); setItems([]) }
    else if (data?.contexto === 'sin_permiso') { setError('No tenés permiso para ver las rondas de este objetivo.'); setItems([]) }
    else { setError(null); setItems((data?.rondas ?? []).slice(-12).reverse()) }
    setCargando(false)
  }, [objetivoId])

  const { abierta, toggle } = useSeccion(() => void cargar())

  return (
    <Seccion titulo="Rondas" resumen={`últimos ${LEGAJO_DIAS_HISTORIAL} días`} abierta={abierta} onToggle={toggle}>
      {cargando && <div style={S.nota}>Cargando rondas…</div>}
      {!cargando && error && <div style={S.error}>{error}</div>}
      {!cargando && !error && items.length === 0 && <div style={S.nota}>Sin rondas programadas en el período.</div>}

      {items.length > 0 && (
        <div style={S.scrollX}>
          <table style={S.tabla}>
            <thead>
              <tr>{['Horario', 'Estado', 'Vigilador', 'Intervención', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {items.map(r => (
                <tr key={`${r.turno_id}-${r.ronda_base_id}-${r.ventana_inicio}`} style={S.tr}>
                  <td style={S.td}>{hora(r.ventana_inicio)}<div style={S.sub}>{fechaCorta(r.ventana_inicio.slice(0, 10))}</div></td>
                  <td style={S.td}>
                    <Chip color={rondaProgramadaEsIncumplida(r) ? '#ef4444' : r.estado === 'en_curso' ? '#3b82f6' : r.estado === 'completada' ? '#10b981' : '#64748b'}>
                      {etiquetaEstadoRondaProgramada(r.estado)}
                    </Chip>
                  </td>
                  <td style={S.td}>{r.guardia_nombre}</td>
                  <td style={S.td}>
                    {r.alerta_resuelta_por_nombre
                      ? <span style={S.sub}>{r.alerta_resuelta_por_nombre}</span>
                      : r.alerta_intervenciones > 0
                        ? <span style={S.sub}>{r.alerta_intervenciones} intervención(es)</span>
                        : <span style={S.sub}>—</span>}
                  </td>
                  <td style={S.td}>
                    {/* El detalle no se reimplementa: es el mismo overlay del
                        Centro Operativo, con puntos, fotos y GPS. */}
                    {r.ejecucion_id && (
                      <button type="button" style={S.btnMini} onClick={() => setDetalle(r.ejecucion_id)}>Ver</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {onVerHistorial && (
        <button type="button" style={{ ...S.btn, marginTop: 10 }} onClick={onVerHistorial}>
          Ver historial de rondas →
        </button>
      )}

      {detalle && <RondaEjecucionDetalle ejecucionId={detalle} onCerrar={() => setDetalle(null)} />}
    </Seccion>
  )
}

// ── 2.4 y 2.5 Supervisiones (con el resumen de checklist) ─────────────────────

export function SeccionSupervisiones({ objetivoId, onVerDetalle }: { objetivoId: string; onVerDetalle?: (id: string) => void }) {
  const [items, setItems] = useState<SupervisionRecienteLegajo[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { supervisiones, error: err } = await cargarSupervisionesObjetivo(objetivoId)
    setItems(supervisiones); setError(err); setCargando(false)
  }, [objetivoId])

  const { abierta, toggle } = useSeccion(() => void cargar())

  return (
    <Seccion titulo="Supervisiones y checklists" abierta={abierta} onToggle={toggle}>
      {cargando && <div style={S.nota}>Cargando supervisiones…</div>}
      {!cargando && error && <div style={S.error}>{error}</div>}
      {!cargando && !error && items.length === 0 && <div style={S.nota}>Sin supervisiones registradas.</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(s => (
          <div key={s.id} style={S.item}>
            <div style={S.itemTop}>
              <span style={S.itemFecha}>{fechaHora(s.created_at)}</span>
              <Chip color={s.estado === 'con_observaciones' ? '#f59e0b' : s.estado === 'critica' ? '#ef4444' : '#10b981'}>
                {s.estado?.replace('_', ' ') || '—'}
              </Chip>
            </div>
            <div style={S.sub}>{s.supervisor_nombre}</div>
            {/* Checklist: no es una entidad aparte. Ejecutar un checklist ES
                registrar esta supervisión, y sus ítems son sus respuestas. */}
            {s.items_total > 0 && (
              <div style={S.sub}>
                Checklist: {s.items_correctos} correcto(s)
                {s.items_observados > 0 && ` · ${s.items_observados} observado(s)`}
                {` · ${s.items_total} ítem(s)`}
              </div>
            )}
            {s.fotos > 0 && <div style={S.sub}>📷 {s.fotos} foto(s)</div>}
            {s.observaciones && <div style={S.observacion}>{s.observaciones}</div>}
            {onVerDetalle && (
              <button type="button" style={{ ...S.btnMini, marginTop: 6 }} onClick={() => onVerDetalle(s.id)}>
                Ver detalle
              </button>
            )}
          </div>
        ))}
      </div>
    </Seccion>
  )
}

// ── 2.6 Novedades ─────────────────────────────────────────────────────────────

export function SeccionNovedades({ objetivoId, onVerTodas }: { objetivoId: string; onVerTodas?: () => void }) {
  const [items, setItems] = useState<NovedadRecienteLegajo[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { novedades, error: err } = await cargarNovedadesObjetivo(objetivoId)
    setItems(novedades); setError(err); setCargando(false)
  }, [objetivoId])

  const { abierta, toggle } = useSeccion(() => void cargar())

  return (
    <Seccion titulo="Novedades" abierta={abierta} onToggle={toggle}>
      {cargando && <div style={S.nota}>Cargando novedades…</div>}
      {!cargando && error && <div style={S.error}>{error}</div>}
      {!cargando && !error && items.length === 0 && <div style={S.nota}>Sin novedades registradas.</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(n => (
          <div
            key={n.id}
            style={{
              ...S.item,
              borderLeft: `3px solid ${n.prioridad === 'urgente' ? '#ef4444' : n.prioridad === 'importante' ? '#f59e0b' : '#3b82f6'}`,
            }}
          >
            <div style={S.itemTop}>
              <span style={S.itemFecha}>{fechaHora(n.created_at)}</span>
              <Chip color={n.estado === 'resuelta' ? '#10b981' : n.estado === 'revisada' ? '#3b82f6' : '#f59e0b'}>
                {n.estado}
              </Chip>
            </div>
            <div style={S.descripcion}>{n.descripcion}</div>
            <div style={S.sub}>{n.tipo} · {n.autor_nombre}</div>
          </div>
        ))}
      </div>

      {onVerTodas && (
        <button type="button" style={{ ...S.btn, marginTop: 10 }} onClick={onVerTodas}>
          Ver todas las novedades →
        </button>
      )}
    </Seccion>
  )
}

const S: Record<string, React.CSSProperties> = {
  card: { background: '#111827', border: '1px solid #1e2d42', borderRadius: 12, padding: 16, marginBottom: 16 },
  cabecera: {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
    border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit',
  },
  secTitle: {
    fontFamily: 'Syne,sans-serif', fontWeight: 700, fontSize: 14, color: '#e2e8f0',
    textTransform: 'uppercase', letterSpacing: 1,
  },
  resumen: { fontSize: 11, color: '#64748b' },
  chevron: { marginLeft: 'auto', color: '#64748b', fontSize: 11 },
  nota: { fontSize: 13, color: '#64748b', padding: '10px 0' },
  error: {
    fontSize: 12, color: '#fecaca', background: '#3b1116',
    border: '1px solid #991b1b', borderRadius: 8, padding: 10,
  },
  mensaje: { fontSize: 12, color: '#93c5fd', marginTop: 8 },
  aviso: { fontSize: 11, color: '#475569', marginTop: 6 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6, marginTop: 12 },
  celda: { background: '#0f172a', border: '1px solid #1a2436', borderRadius: 6, padding: '6px 8px' },
  celdaLabel: { display: 'block', fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.3 },
  celdaValor: { display: 'block', fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginTop: 1, overflowWrap: 'anywhere' },
  btn: {
    border: '1px solid #1e2d42', background: '#0f172a', color: '#e2e8f0',
    borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
  btnMini: {
    border: '1px solid #1e2d42', background: '#0f172a', color: '#e2e8f0',
    borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  // Las tablas desbordan en móvil: el scroll vive acá, no en el body.
  scrollX: { overflowX: 'auto' },
  tabla: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: {
    padding: '6px 8px', textAlign: 'left', color: '#64748b', fontWeight: 700,
    fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap',
    borderBottom: '1px solid #1e2d42',
  },
  tr: { borderBottom: '1px solid #0f172a' },
  td: { padding: '7px 8px', color: '#cbd5e1', verticalAlign: 'top', whiteSpace: 'nowrap' },
  sub: { fontSize: 10, color: '#64748b', marginTop: 2 },
  item: { background: '#0f172a', borderRadius: 8, padding: '8px 10px' },
  itemTop: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  itemFecha: { fontSize: 12, color: '#94a3b8' },
  descripcion: { fontSize: 13, color: '#e2e8f0', marginTop: 4, overflowWrap: 'anywhere' },
  observacion: {
    fontSize: 12, color: '#94a3b8', background: '#0b1220',
    borderRadius: 6, padding: '6px 10px', marginTop: 6, overflowWrap: 'anywhere',
  },
}
