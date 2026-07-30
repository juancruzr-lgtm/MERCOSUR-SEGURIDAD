'use client'

// Control de Rondas — resumen ejecutivo del Dashboard Gerencial.
//
// Una fila por objetivo, con LA ronda relevante de ese objetivo: la que está en
// curso, si no la que se incumplió, si no la próxima, si no la última cumplida.
// El Dashboard responde "¿cómo viene la operación?", no "¿qué quedó pendiente?".
//
// Fuente: `listar_rondas_programadas_objetivo`, la misma RPC que alimenta el
// Historial del Centro Operativo. Devuelve una fila por ronda PROGRAMADA exista
// o no ejecución, con el estado derivado por el motor. Deliberadamente NO se usa
// la RPC de alertas: una alerta solo existe cuando algo falló, así que desde ahí
// es imposible mostrar "Cumplida", "En curso" o "Próxima".
//
// Alcance: esa RPC es por objetivo (con `p_objetivo_id` NULL responde
// `rango_invalido`), así que el alcance completo se arma acá con una llamada por
// objetivo, en tandas. Los objetivos fuera del alcance del usuario devuelven
// `sin_permiso` y simplemente no producen fila.
//
// No calcula estados ni reglas de negocio: mapea los estados del motor a las
// cuatro etiquetas operativas y ordena. Todo lo demás lo decide el servidor.

import { useCallback, useEffect, useMemo, useState } from 'react'
import RondaEjecucionDetalle from './RondaEjecucionDetalle'
import {
  listarRondasProgramadasObjetivo,
  rondaProgramadaEsIncumplida,
  etiquetaAccionRondaAlerta,
  type RondaProgramada,
} from '@/lib/rondas'
import { useVigenciaCarga } from '@/lib/vigencia-carga'

export interface ObjetivoControlRondas {
  id: string
  nombre: string
}

interface Props {
  /** Objetivos a consultar. El llamador filtra activos y de prueba. */
  objetivos: ObjetivoControlRondas[]
}

// ── Estados operativos ────────────────────────────────────────────────────────
// Las cuatro etiquetas del tablero. No son estados nuevos: son la lectura
// gerencial de los estados que ya produce el motor (`EstadoRondaProgramada`).
//
//   en_curso                              → En curso
//   no_iniciada | incompleta | tardía     → Incumplida
//   pendiente                             → Próxima
//   completada                            → Cumplida

type EstadoOperativo = 'en_curso' | 'incumplida' | 'proxima' | 'cumplida'

const ETIQUETA: Record<EstadoOperativo, string> = {
  en_curso:   'En curso',
  incumplida: 'Incumplida',
  proxima:    'Próxima',
  cumplida:   'Cumplida',
}

const ICONO: Record<EstadoOperativo, string> = {
  en_curso:   '⏳',
  incumplida: '❌',
  proxima:    '🕒',
  cumplida:   '✅',
}

function estadoOperativo(r: RondaProgramada): EstadoOperativo {
  // El orden importa: `en_curso` gana sobre "tardía" porque la ronda está
  // ocurriendo ahora, y eso es lo que el supervisor necesita ver.
  if (r.estado === 'en_curso') return 'en_curso'
  if (rondaProgramadaEsIncumplida(r)) return 'incumplida'
  if (r.estado === 'pendiente') return 'proxima'
  return 'cumplida'
}

/** Hubo acción del supervisor sobre la alerta de esta ronda. */
function fueIntervenida(r: RondaProgramada): boolean {
  return r.alerta_estado === 'resuelta' || r.alerta_intervenciones > 0
}

// ── Prioridad operativa ───────────────────────────────────────────────────────
// 1 En curso · 2 Incumplidas sin intervención · 3 Incumplidas intervenidas
// 4 Próximas · 5 Cumplidas. Dentro de cada grupo, por horario.

function prioridad(r: RondaProgramada): number {
  const estado = estadoOperativo(r)
  if (estado === 'en_curso') return 1
  if (estado === 'incumplida') return fueIntervenida(r) ? 3 : 2
  if (estado === 'proxima') return 4
  return 5
}

function ms(iso: string): number {
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * La ronda relevante del objetivo: la de mayor prioridad operativa.
 *
 * Empates dentro del mismo grupo: para lo que ya pasó (en curso, incumplida,
 * cumplida) interesa lo más reciente; para lo que todavía no pasó (próxima),
 * lo más inminente.
 */
function rondaRelevante(rondas: RondaProgramada[]): RondaProgramada | null {
  if (rondas.length === 0) return null
  return rondas.reduce((mejor, r) => {
    const pr = prioridad(r)
    const pm = prioridad(mejor)
    if (pr !== pm) return pr < pm ? r : mejor
    const haciaAdelante = pr === 4
    return haciaAdelante
      ? (ms(r.ventana_inicio) < ms(mejor.ventana_inicio) ? r : mejor)
      : (ms(r.ventana_inicio) > ms(mejor.ventana_inicio) ? r : mejor)
  })
}

function hora(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '--:--'
    : d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

function fechaLocal(d: Date): string {
  return d.toLocaleDateString('sv-SE')
}

/**
 * Rango consultado: ayer y hoy. Es el mínimo que cubre los tres casos.
 *
 * Semántica de la RPC (verificada en `rondas_ventanas_programadas`): filtra por
 * `turnos.fecha between p_desde and p_hasta` —la fecha del TURNO, no la de la
 * ventana— y a partir de cada turno expande sus ventanas, que en un turno
 * nocturno se extienden más allá de medianoche.
 *
 *   · Última evaluada y próxima del día → las aporta el turno de hoy.
 *   · Vigente a las 02:00 → pertenece a un turno con fecha de AYER. Con `hoy` a
 *     secas esa ronda en curso no aparecería: de ahí el día extra hacia atrás.
 *
 * No se agrega mañana a propósito. Solo aportaría la primera ronda del turno
 * siguiente, y como "Próxima" tiene más prioridad que "Cumplida", al final del
 * día desplazaría el "✅ Cumplida" de cada objetivo por un "🕒 Próxima 08:00"
 * de mañana. Para un resumen ejecutivo se pierde más de lo que se gana.
 */
function rangoConsulta(): { desde: string; hasta: string } {
  const hoy = new Date()
  const ayer = new Date()
  ayer.setDate(ayer.getDate() - 1)
  return { desde: fechaLocal(ayer), hasta: fechaLocal(hoy) }
}

/** Cómo terminó la consulta de UN objetivo. */
type Desenlace =
  | { tipo: 'ok'; id: string; rondas: RondaProgramada[] }
  | { tipo: 'sin_permiso'; id: string }
  | { tipo: 'error'; id: string; motivo: string }

/**
 * Consulta un objetivo sin poder tumbar a los demás.
 *
 * `listarRondasProgramadasObjetivo` ya devuelve `{data, error}` en vez de tirar,
 * pero el `try` cubre lo que no controla: una excepción de red o del cliente
 * antes de llegar a ese envoltorio. Sin él, un solo rechazo haría fallar el
 * `Promise.all` de la tanda y se perderían también los objetivos que sí
 * respondieron bien.
 */
async function consultarObjetivo(id: string, desde: string, hasta: string): Promise<Desenlace> {
  try {
    const { data, error } = await listarRondasProgramadasObjetivo(id, desde, hasta)
    if (error) return { tipo: 'error', id, motivo: error }
    // `sin_permiso` no es una falla: es un objetivo fuera del alcance del
    // usuario. Se distingue del error para no teñir la pantalla de rojo cuando
    // simplemente no hay nada que mostrar.
    if (data?.contexto === 'sin_permiso') return { tipo: 'sin_permiso', id }
    if (data?.contexto !== 'ok') {
      return { tipo: 'error', id, motivo: `contexto ${data?.contexto ?? 'desconocido'}` }
    }
    return { tipo: 'ok', id, rondas: data.rondas }
  } catch (e) {
    return { tipo: 'error', id, motivo: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Ejecuta en tandas concurrentes.
 *
 * Un `Promise.all` sobre todos los objetivos abriría tantas conexiones
 * simultáneas como objetivos haya. La tanda acota ese pico sin alargar de forma
 * apreciable la carga total.
 */
async function enTandas<T, R>(items: T[], tam: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const salida: R[] = []
  for (let i = 0; i < items.length; i += tam) {
    salida.push(...await Promise.all(items.slice(i, i + tam).map(fn)))
  }
  return salida
}

/**
 * El nombre del objetivo NO se guarda acá: se resuelve desde `objetivos` en cada
 * render. Guardarlo lo dejaría congelado en el valor que tenía cuando corrió la
 * carga, y un objetivo renombrado seguiría mostrando el nombre viejo hasta que
 * cambiara el conjunto de ids.
 */
interface Fila {
  objetivoId: string
  ronda: RondaProgramada
}

/** Cómo terminó el fan-out completo. Se muestra al pie del panel. */
interface Balance {
  llamadas: number
  sinPermiso: number
  sinRondas: number
  errores: number
}

const BALANCE_VACIO: Balance = { llamadas: 0, sinPermiso: 0, sinRondas: 0, errores: 0 }

export default function ControlDeRondasPanel({ objetivos }: Props) {
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filas, setFilas] = useState<Fila[]>([])
  const [balance, setBalance] = useState<Balance>(BALANCE_VACIO)
  const [detalle, setDetalle] = useState<Fila | null>(null)

  const iniciarCarga = useVigenciaCarga()

  // Los objetivos llegan como array nuevo en cada render del padre. Sin esta
  // clave estable, `cargar` cambiaría de identidad en cada render y el efecto
  // dispararía el fan-out en bucle. La clave solo cambia si cambia el CONJUNTO
  // de ids: renombrar un objetivo no vuelve a consultar nada.
  const claveObjetivos = objetivos.map(o => o.id).sort().join(',')

  const cargar = useCallback(async () => {
    const lista = claveObjetivos ? claveObjetivos.split(',') : []

    setCargando(true)
    const vigente = iniciarCarga()

    if (lista.length === 0) {
      if (!vigente()) return
      setError(null); setFilas([]); setBalance(BALANCE_VACIO); setCargando(false)
      return
    }

    const { desde, hasta } = rangoConsulta()
    // Una llamada por objetivo, en tandas concurrentes. Cada una se resuelve por
    // separado: ninguna puede abortar a las demás.
    const resultados = await enTandas(lista, 6, id => consultarObjetivo(id, desde, hasta))

    if (!vigente()) return

    const nuevas: Fila[] = []
    const nuevoBalance: Balance = { ...BALANCE_VACIO, llamadas: lista.length }

    for (const r of resultados) {
      if (r.tipo === 'sin_permiso') { nuevoBalance.sinPermiso++; continue }
      if (r.tipo === 'error') {
        nuevoBalance.errores++
        // Queda registrado para diagnóstico sin interrumpir al resto.
        console.error(`[Control de Rondas] objetivo ${r.id}: ${r.motivo}`)
        continue
      }
      const ronda = rondaRelevante(r.rondas)
      if (!ronda) { nuevoBalance.sinRondas++; continue }
      nuevas.push({ objetivoId: r.id, ronda })
    }

    nuevas.sort((a, b) => {
      const pa = prioridad(a.ronda)
      const pb = prioridad(b.ronda)
      if (pa !== pb) return pa - pb
      const ta = ms(a.ronda.ventana_inicio)
      const tb = ms(b.ronda.ventana_inicio)
      // Próximas: lo más inminente arriba. El resto: lo más reciente arriba.
      return pa === 4 ? ta - tb : tb - ta
    })

    // Solo es un error de pantalla si NINGÚN objetivo pudo consultarse. Con
    // fallos parciales se muestra lo que sí respondió y el pie informa el resto.
    setError(nuevoBalance.errores === lista.length ? 'No se pudo cargar el estado de las rondas.' : null)
    setFilas(nuevas)
    setBalance(nuevoBalance)
    setCargando(false)
  }, [claveObjetivos, iniciarCarga])

  useEffect(() => { void cargar() }, [cargar])

  const nombrePorId = useMemo(
    () => new Map(objetivos.map(o => [o.id, o.nombre])),
    [objetivos],
  )
  const nombreDe = (id: string) => nombrePorId.get(id) ?? 'Objetivo'

  const conteos = useMemo(() => {
    const c: Record<EstadoOperativo, number> = { en_curso: 0, incumplida: 0, proxima: 0, cumplida: 0 }
    for (const f of filas) c[estadoOperativo(f.ronda)]++
    return c
  }, [filas])

  return (
    <div>
      <div style={S.cabecera}>
        <div style={S.titulo}>Control de Rondas</div>
        <button type="button" onClick={() => void cargar()} disabled={cargando} style={S.recargar} aria-label="Actualizar">
          {cargando ? '…' : '↻'}
        </button>
      </div>

      {filas.length > 0 && (
        <div style={S.resumen}>
          {(['en_curso', 'incumplida', 'proxima', 'cumplida'] as EstadoOperativo[])
            .filter(e => conteos[e] > 0)
            .map(e => (
              <span key={e} style={S.resumenItem}>
                {ICONO[e]} {conteos[e]} {ETIQUETA[e].toLowerCase()}
              </span>
            ))}
        </div>
      )}

      {cargando && filas.length === 0 && <div style={S.nota}>Cargando estado de rondas…</div>}
      {!cargando && error && <div style={S.error} role="alert">{error}</div>}

      {!cargando && !error && filas.length === 0 && (
        <div style={S.nota}>
          {objetivos.length === 0
            ? 'No hay objetivos activos.'
            : balance.sinPermiso === balance.llamadas
              ? 'No tenés objetivos asignados con rondas.'
              : 'Ningún objetivo tiene rondas programadas en el período.'}
        </div>
      )}

      {filas.length > 0 && (
        <div style={S.lista}>
          {filas.map(f => (
            <FilaObjetivo
              key={f.objetivoId}
              fila={f}
              objetivoNombre={nombreDe(f.objetivoId)}
              onAbrir={() => setDetalle(f)}
            />
          ))}
        </div>
      )}

      {/* Pie de trazabilidad: qué se consultó y qué quedó afuera. Un objetivo
          omitido nunca desaparece en silencio. */}
      {!cargando && balance.llamadas > 0 && (
        <div style={S.pie}>
          {[
            `${filas.length}/${balance.llamadas} objetivo(s)`,
            balance.sinRondas > 0 ? `${balance.sinRondas} sin rondas programadas` : null,
            balance.sinPermiso > 0 ? `${balance.sinPermiso} fuera de tu alcance` : null,
            balance.errores > 0 ? `${balance.errores} no respondió` : null,
          ].filter(Boolean).join(' · ')}
        </div>
      )}

      {/* Detalle completo. Con ejecución se abre el mismo overlay del Centro
          Operativo (puntos, fotos, GPS, horarios). Sin ejecución no hay nada que
          ese overlay pueda leer, así que se muestra lo que sí existe: la
          programación y la intervención. */}
      {detalle && (
        detalle.ronda.ejecucion_id !== null
          ? <RondaEjecucionDetalle ejecucionId={detalle.ronda.ejecucion_id} onCerrar={() => setDetalle(null)} />
          : <DetalleSinEjecucion
              fila={detalle}
              objetivoNombre={nombreDe(detalle.objetivoId)}
              onCerrar={() => setDetalle(null)}
            />
      )}
    </div>
  )
}

// ── Fila ──────────────────────────────────────────────────────────────────────

function FilaObjetivo({
  fila, objetivoNombre, onAbrir,
}: { fila: Fila; objetivoNombre: string; onAbrir: () => void }) {
  const r = fila.ronda
  const estado = estadoOperativo(r)
  const intervenida = fueIntervenida(r)

  return (
    <div
      role="button"
      tabIndex={0}
      style={{ ...S.fila, ...(estado === 'incumplida' ? S.filaIncumplida : estado === 'en_curso' ? S.filaEnCurso : null) }}
      onClick={onAbrir}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAbrir() } }}
      aria-label={`${objetivoNombre}, ${ETIQUETA[estado]}. Ver detalle`}
    >
      <div style={S.objetivo}>{objetivoNombre}</div>

      <div style={S.linea}>
        <span style={S.horaTexto}>{hora(r.ventana_inicio)}</span>
        <span style={S.separador}>·</span>
        <span style={{ ...S.estadoTexto, color: COLOR[estado] }}>
          {ICONO[estado]} {ETIQUETA[estado]}
        </span>
      </div>

      <div style={S.contexto}>{r.ronda_nombre} · {r.puesto_nombre} · {r.guardia_nombre}</div>

      {/* Anexo del motor: la suspensión la declara el vigilador, no es un estado. */}
      {r.alerta_suspendida && (
        <div style={{ ...S.anexo, ...S.recorte }}>
          Suspendida por el vigilador{r.alerta_motivo_vigilador ? `: ${r.alerta_motivo_vigilador}` : ''}
        </div>
      )}

      {/* Resumen de intervención. El historial completo vive en el detalle. */}
      {estado === 'incumplida' && (
        intervenida ? <ResumenIntervencion ronda={r} /> : <div style={S.sinIntervencion}>Sin intervención</div>
      )}
    </div>
  )
}

function ResumenIntervencion({ ronda: r }: { ronda: RondaProgramada }) {
  // `resuelta_por_nombre` solo se completa cuando la acción cierra la alerta.
  // Con intervenciones abiertas (una llamada al vigilador, por ejemplo) hay
  // actividad registrada pero todavía nadie firmó el cierre: decirlo es más
  // honesto que inventar un nombre.
  if (!r.alerta_resuelta_por_nombre) {
    return (
      <div style={S.intervencion}>
        {r.alerta_intervenciones} intervención(es) registrada(s), sin cierre
      </div>
    )
  }

  const motivo = r.alerta_comentario
    ?? (r.alerta_accion ? etiquetaAccionRondaAlerta(r.alerta_accion) : null)

  return (
    <div style={S.intervencion}>
      <div style={S.recorte}>Intervino: {r.alerta_resuelta_por_nombre}</div>
      {/* El comentario es texto libre y sin tope de longitud (el modal de
          intervención solo exige un mínimo). Acá se recorta a dos líneas: el
          Dashboard es un resumen y el texto íntegro está en el detalle. */}
      {motivo && <div style={S.recorte}>Motivo: {motivo}</div>}
    </div>
  )
}

// ── Detalle de una ronda sin ejecución ────────────────────────────────────────
// No iniciada o todavía próxima: no hay puntos, ni GPS, ni fotos, porque nunca
// se ejecutó. Se muestra todo lo que sí existe.

function fechaHora(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function DetalleSinEjecucion({
  fila, objetivoNombre, onCerrar,
}: { fila: Fila; objetivoNombre: string; onCerrar: () => void }) {
  const r = fila.ronda
  const estado = estadoOperativo(r)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCerrar])

  const datos: [string, string][] = [
    ['Objetivo', objetivoNombre],
    ['Ronda', r.ronda_nombre],
    ['Puesto', r.puesto_nombre],
    ['Vigilador', r.guardia_nombre],
    ['Ventana', `${hora(r.ventana_inicio)} – ${hora(r.ventana_fin)}`],
    ['Vencimiento', fechaHora(r.vencimiento_at)],
    ['Estado', ETIQUETA[estado]],
  ]

  return (
    <div style={S.overlay} role="dialog" aria-modal="true" aria-label="Detalle de la ronda" onClick={onCerrar}>
      <div style={S.sheet} onClick={e => e.stopPropagation()}>
        <div style={S.sheetHeader}>
          <div style={S.sheetTitulo}>Detalle de la ronda</div>
          <button type="button" onClick={onCerrar} style={S.cerrar} aria-label="Cerrar detalle">✕</button>
        </div>

        <div style={S.aviso}>
          Esta ronda no tiene ejecución registrada, así que no hay puntos, GPS ni
          evidencias que mostrar. Se detalla la obligación programada.
        </div>

        <div style={S.grid}>
          {datos.map(([k, v]) => (
            <div key={k} style={S.celda}>
              <span style={S.celdaLabel}>{k}</span>
              <span style={S.celdaValor}>{v}</span>
            </div>
          ))}
        </div>

        {r.alerta_suspendida && (
          <div style={S.bloque}>
            <div style={S.bloqueTitulo}>Suspensión declarada por el vigilador</div>
            <div style={S.bloqueTexto}>{r.alerta_motivo_vigilador || 'Sin motivo declarado.'}</div>
          </div>
        )}

        <div style={S.bloque}>
          <div style={S.bloqueTitulo}>Intervención</div>
          {fueIntervenida(r) ? (
            <div style={S.bloqueTexto}>
              <div>Intervenciones registradas: {r.alerta_intervenciones}</div>
              {r.alerta_accion && <div>Acción: {etiquetaAccionRondaAlerta(r.alerta_accion)}</div>}
              {r.alerta_resuelta_por_nombre && <div>Intervino: {r.alerta_resuelta_por_nombre}</div>}
              {r.alerta_resuelta_at && <div>Fecha: {fechaHora(r.alerta_resuelta_at)}</div>}
              {r.alerta_comentario && <div>Motivo: {r.alerta_comentario}</div>}
              {!r.alerta_resuelta_por_nombre && <div>Todavía sin cierre.</div>}
            </div>
          ) : (
            <div style={S.bloqueTexto}>Sin intervención.</div>
          )}
        </div>
      </div>
    </div>
  )
}

const COLOR: Record<EstadoOperativo, string> = {
  en_curso:   '#93c5fd',
  incumplida: '#fca5a5',
  proxima:    '#94a3b8',
  cumplida:   '#4ade80',
}

const S: Record<string, React.CSSProperties> = {
  cabecera: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 },
  titulo: { fontSize: 15, fontWeight: 800, color: '#f8fafc' },
  recargar: {
    width: 30, height: 30, borderRadius: 999, border: '1px solid #1e2d42',
    background: '#111827', color: '#e2e8f0', fontSize: 15, cursor: 'pointer', marginLeft: 'auto',
  },
  resumen: { display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12, fontSize: 12, color: '#94a3b8' },
  resumenItem: { whiteSpace: 'nowrap' },
  nota: { fontSize: 13, color: '#94a3b8', padding: '14px 4px' },
  pie: { fontSize: 11, color: '#64748b', marginTop: 10 },
  error: {
    fontSize: 12, color: '#fecaca', background: '#3b1116',
    border: '1px solid #991b1b', borderRadius: 8, padding: 10, marginTop: 8,
  },
  lista: { display: 'flex', flexDirection: 'column', gap: 8 },
  fila: {
    border: '1px solid #1e2d42', borderLeft: '3px solid #334155', borderRadius: 10,
    background: '#111827', padding: '12px 14px', cursor: 'pointer',
  },
  filaIncumplida: { borderLeftColor: '#ef4444' },
  filaEnCurso: { borderLeftColor: '#3b82f6' },
  objetivo: {
    fontSize: 13, fontWeight: 800, color: '#f8fafc',
    textTransform: 'uppercase', letterSpacing: 0.6,
    // Un nombre largo sin espacios no puede empujar el ancho de la tarjeta.
    overflowWrap: 'anywhere',
  },
  // Recorte a dos líneas para el texto libre (comentarios de intervención y
  // motivos del vigilador), que no tiene tope de longitud en origen.
  recorte: {
    display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
    overflow: 'hidden', overflowWrap: 'anywhere',
  } as React.CSSProperties,
  linea: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  horaTexto: { fontSize: 14, fontWeight: 800, color: '#e2e8f0' },
  separador: { color: '#475569' },
  estadoTexto: { fontSize: 13, fontWeight: 800 },
  contexto: { fontSize: 11, color: '#64748b', marginTop: 4 },
  anexo: { fontSize: 12, color: '#93c5fd', marginTop: 6, lineHeight: 1.5 },
  intervencion: { fontSize: 12, color: '#cbd5e1', marginTop: 8, lineHeight: 1.6 },
  sinIntervencion: { fontSize: 12, color: '#f59e0b', marginTop: 8, fontWeight: 700 },
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(2,6,15,.74)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  sheet: {
    width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto',
    background: '#0b1220', border: '1px solid #1e2d42', borderRadius: 12, padding: 18,
  },
  sheetHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sheetTitulo: { fontSize: 15, fontWeight: 800, color: '#f8fafc' },
  cerrar: {
    width: 32, height: 32, borderRadius: 999, border: '1px solid #1e2d42',
    background: '#111827', color: '#e2e8f0', fontSize: 14, cursor: 'pointer',
  },
  aviso: { fontSize: 12, color: '#94a3b8', lineHeight: 1.5, marginBottom: 12 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 6 },
  celda: { background: '#0f172a', border: '1px solid #1a2436', borderRadius: 6, padding: '6px 8px' },
  celdaLabel: { display: 'block', fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.3 },
  celdaValor: { display: 'block', fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginTop: 1 },
  bloque: { marginTop: 12, borderTop: '1px solid #1e2d42', paddingTop: 10 },
  bloqueTitulo: { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 },
  bloqueTexto: { fontSize: 12, color: '#cbd5e1', marginTop: 6, lineHeight: 1.6 },
}
