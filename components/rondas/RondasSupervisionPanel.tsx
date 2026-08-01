'use client'

// Etapa 3.3 · B4 — Panel autocontenido de supervisión de rondas de UN objetivo.
// Vive dentro del Centro Operativo y concentra 4 secciones: Mapa, En curso,
// Historial y Configuración. Todo está filtrado por objetivoId; no mezcla
// objetivos. Reutiliza RondasEnCursoPanel (En curso) y RondasNativasPanel
// (Configuración) sin duplicarlos.
//
// Alcance de B4: contenedor + navegación + Historial funcional + estados reales
// de Mapa. NO incluye todavía: detalle completo, fotos, mapa con GPS real,
// overlay, ni el wiring final en CentroOperativoObjetivo.

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import RondasEnCursoPanel from './RondasEnCursoPanel'
import RondasNativasPanel from './RondasNativasPanel'
import RondaEjecucionDetalle from './RondaEjecucionDetalle'
import RondaAlertasPanel from './RondaAlertasPanel'
import type { PuntoMapaSupervision } from './RondaEjecucionMapa'
import {
  listarEjecucionesObjetivo,
  listarEjecucionesEnCursoObjetivo,
  listarRondasProgramadasObjetivo,
  obtenerAccesoRondasObjetivo,
  obtenerRondasPorObjetivo,
  obtenerRondaConPuntos,
  obtenerDetalleEjecucionSupervisor,
  mensajeContextoEjecucionesObjetivo,
  mensajeContextoDetalleEjecucion,
  rondaProgramadaEsIncumplida,
  estadoTecnicoRonda,
  estadoAlertaRonda,
  colorRondaProgramada,
  resumenObservacionesRonda,
  ETIQUETA_CORTA_ESTADO_TECNICO,
  type EjecucionHistorialItem,
  type EjecucionEnCurso,
  type ContextoEjecucionesObjetivo,
  type RondaBaseResumen,
  type RondaPunto,
  type DetalleEjecucionSupervisor,
  type RondaProgramada,
  type EstadoRondaProgramada,
} from '@/lib/rondas'
import { formatFechaHora } from '@/lib/formato'
import { useVigenciaCarga } from '@/lib/vigencia-carga'

// Leaflet necesita window: el mapa de supervisión se carga solo en cliente.
const RondaEjecucionMapa = dynamic(() => import('./RondaEjecucionMapa'), {
  ssr: false,
  loading: () => <div style={{ padding: 16, color: '#94a3b8', fontSize: 13 }}>Cargando mapa…</div>,
})

type Seccion = 'mapa' | 'en_curso' | 'alertas' | 'historial' | 'config'

interface Props {
  objetivoId: string
  // Pass-through opcionales para la sección Configuración (RondasNativasPanel),
  // que preservan el comportamiento actual cuando se haga el wiring en B7.
  centroObjetivo?: [number, number] | null
  onRondasDirtyChange?: (dirty: boolean) => void
}

const SECCIONES: { id: Seccion; label: string }[] = [
  { id: 'mapa',      label: 'Mapa' },
  { id: 'en_curso',  label: 'En curso' },
  { id: 'alertas',   label: 'Alertas' },
  { id: 'historial', label: 'Historial' },
  { id: 'config',    label: 'Configuración' },
]

function fechaLocal(d: Date): string {
  return d.toLocaleDateString('sv-SE')
}
function hace30dias(): string {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return fechaLocal(d)
}
// 24 h vía lib/formato.ts. El historial mezcla días, así que conserva la fecha.
function horaCorta(iso: string): string {
  return formatFechaHora(iso)
}

export default function RondasSupervisionPanel({
  objetivoId,
  centroObjetivo = null,
  onRondasDirtyChange,
}: Props) {
  const [seccion, setSeccion] = useState<Seccion>('en_curso')
  const [detalleId, setDetalleId] = useState<string | null>(null)

  return (
    <div style={S.wrap}>
      <div style={S.titulo}>Rondas</div>

      <nav style={S.tabs} role="tablist" aria-label="Secciones de rondas">
        {SECCIONES.map(s => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={seccion === s.id}
            style={{ ...S.tab, ...(seccion === s.id ? S.tabActivo : null) }}
            onClick={() => setSeccion(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div style={S.contenido}>
        {seccion === 'mapa' && <SeccionMapa objetivoId={objetivoId} centroObjetivo={centroObjetivo} />}

        {seccion === 'en_curso' && (
          <>
            <div style={S.intro}>Ejecuciones abiertas de este objetivo.</div>
            <RondasEnCursoPanel objetivoId={objetivoId} onVerDetalle={setDetalleId} />
          </>
        )}

        {seccion === 'alertas' && <RondaAlertasPanel objetivoId={objetivoId} />}

        {seccion === 'historial' && <SeccionHistorial objetivoId={objetivoId} onVerDetalle={setDetalleId} />}

        {seccion === 'config' && (
          <RondasNativasPanel
            objetivoId={objetivoId}
            centroObjetivo={centroObjetivo}
            onDirtyChange={onRondasDirtyChange ?? (() => {})}
          />
        )}
      </div>

      {detalleId && (
        <RondaEjecucionDetalle ejecucionId={detalleId} onCerrar={() => setDetalleId(null)} />
      )}
    </div>
  )
}

// ── Sección Mapa (B6: puntos configurados + GPS real, solo lectura) ───────────

function SeccionMapa({ objetivoId, centroObjetivo }: { objetivoId: string; centroObjetivo: [number, number] | null }) {
  // Carga base del objetivo.
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [puedeAdmin, setPuedeAdmin] = useState(true)
  const [rondas, setRondas] = useState<RondaBaseResumen[]>([])
  const [enCurso, setEnCurso] = useState<EjecucionEnCurso[]>([])
  const [finalizadas, setFinalizadas] = useState<EjecucionHistorialItem[]>([])

  // Ronda seleccionada + sus puntos configurados.
  const [rondaId, setRondaId] = useState<string>('')
  const [cargandoPuntos, setCargandoPuntos] = useState(false)
  const [errorPuntos, setErrorPuntos] = useState<string | null>(null)
  const [configPuntos, setConfigPuntos] = useState<RondaPunto[]>([])

  // Ejecución seleccionada ('config' | ejecucionId) + su detalle B1.
  const [ejecucionSel, setEjecucionSel] = useState<string>('config')
  const [cargandoDetalle, setCargandoDetalle] = useState(false)
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<DetalleEjecucionSupervisor | null>(null)

  const [puntoSel, setPuntoSel] = useState<string | null>(null)

  // 1. Base: acceso + rondas + ejecuciones del objetivo (para el selector).
  useEffect(() => {
    let vivo = true
    setCargando(true); setError(null)
    Promise.all([
      obtenerAccesoRondasObjetivo(objetivoId),
      obtenerRondasPorObjetivo(objetivoId),
      listarEjecucionesEnCursoObjetivo(objetivoId),
      listarEjecucionesObjetivo(objetivoId, hace30dias(), fechaLocal(new Date())),
    ]).then(([acc, rns, enc, fin]) => {
      if (!vivo) return
      if (acc.error) { setError(acc.error); setCargando(false); return }
      setPuedeAdmin(acc.data?.puede_administrar ?? false)
      const lista = rns.data ?? []
      setRondas(lista)
      setEnCurso(enc.data?.contexto === 'ok' ? enc.data.ejecuciones : [])
      setFinalizadas(fin.data?.contexto === 'ok' ? fin.data.ejecuciones : [])
      setRondaId(prev => prev || (lista[0]?.id ?? ''))
      setCargando(false)
    })
    return () => { vivo = false }
  }, [objetivoId])

  // 2. Al cambiar de ronda: limpiar ejecución/punto y cargar puntos configurados.
  useEffect(() => {
    if (!rondaId) { setConfigPuntos([]); return }
    setEjecucionSel('config'); setDetalle(null); setErrorDetalle(null); setPuntoSel(null)
    let vivo = true
    setCargandoPuntos(true); setErrorPuntos(null)
    obtenerRondaConPuntos(rondaId).then(({ data, error: err }) => {
      if (!vivo) return
      if (err) { setErrorPuntos(err); setConfigPuntos([]) }
      else { setConfigPuntos((data?.puntos ?? []).filter(p => p.activo)) }
      setCargandoPuntos(false)
    })
    return () => { vivo = false }
  }, [rondaId])

  // 3. Al elegir una ejecución: cargar su detalle B1 (GPS real superpuesto).
  useEffect(() => {
    if (ejecucionSel === 'config') { setDetalle(null); setErrorDetalle(null); return }
    let vivo = true
    setCargandoDetalle(true); setErrorDetalle(null); setPuntoSel(null)
    obtenerDetalleEjecucionSupervisor(ejecucionSel).then(({ data, error: err }) => {
      if (!vivo) return
      if (err) { setErrorDetalle(err); setDetalle(null) }
      else { setDetalle(data) }
      setCargandoDetalle(false)
    })
    return () => { vivo = false }
  }, [ejecucionSel])

  // Aislamiento por ronda: en curso y finalizadas se filtran por ronda_id.
  const enCursoDeRonda = enCurso.filter(e => e.ronda_id === rondaId)
  const finalizadasDeRonda = finalizadas.filter(e => e.ronda_id === rondaId)

  const modoEjecucion = ejecucionSel !== 'config'
  const detalleOk = detalle?.contexto === 'ok'

  const puntosMapa: PuntoMapaSupervision[] = useMemo(() => {
    if (modoEjecucion && detalleOk && detalle) {
      return detalle.puntos
        .filter(p => p.config_latitud !== null && p.config_longitud !== null)
        .map(p => ({
          id: p.ejecucion_punto_id, orden: p.orden, nombre: p.nombre,
          config_lat: p.config_latitud as number, config_lng: p.config_longitud as number,
          config_radio: p.config_radio_metros,
          real_lat: p.latitud, real_lng: p.longitud, distancia: p.distancia_metros,
          dentro_radio: p.dentro_radio, gps_ok: p.gps_ok, estado: p.estado,
        }))
    }
    return configPuntos
      .filter(p => p.latitud !== null && p.longitud !== null)
      .map(p => ({
        id: p.id, orden: p.orden, nombre: p.nombre,
        config_lat: p.latitud as number, config_lng: p.longitud as number, config_radio: p.radio_metros,
        real_lat: null, real_lng: null, distancia: null, dentro_radio: null, gps_ok: null, estado: null,
      }))
  }, [modoEjecucion, detalleOk, detalle, configPuntos])

  const puntoInfo = puntosMapa.find(p => p.id === puntoSel) ?? null

  // Estados de nivel superior.
  if (cargando) return <Nota>Cargando mapa…</Nota>
  if (error) return <CajaError>{error}</CajaError>
  if (!puedeAdmin) return <Nota>No tenés permiso para ver las rondas de este objetivo.</Nota>
  if (rondas.length === 0) return <Nota>Este objetivo todavía no tiene rondas configuradas.</Nota>

  const detalleSinAcceso = modoEjecucion && !cargandoDetalle && !errorDetalle
    && detalle != null && detalle.contexto !== 'ok'

  return (
    <div>
      <div style={S.filtros}>
        <label style={S.filtroLabel}>
          Ronda
          <select value={rondaId} onChange={e => setRondaId(e.target.value)} style={S.select}>
            {rondas.map(r => (
              <option key={r.id} value={r.id}>{r.nombre}{r.activo ? '' : ' (inactiva)'}</option>
            ))}
          </select>
        </label>
        <label style={S.filtroLabel}>
          Ejecución
          <select value={ejecucionSel} onChange={e => setEjecucionSel(e.target.value)} style={S.select}>
            <option value="config">Solo configuración</option>
            {enCursoDeRonda.length > 0 && (
              <optgroup label="En curso">
                {enCursoDeRonda.map(e => (
                  <option key={e.id} value={e.id}>● {e.guardia_nombre} · {horaCorta(e.iniciada_at)}</option>
                ))}
              </optgroup>
            )}
            {finalizadasDeRonda.length > 0 && (
              <optgroup label="Finalizadas (últimos 30 días)">
                {finalizadasDeRonda.map(e => (
                  <option key={e.ejecucion_id} value={e.ejecucion_id}>
                    ✓ {e.guardia_nombre} · {horaCorta(e.iniciada_at)} · {e.resultado ?? '—'}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
      </div>

      <div style={S.leyenda}>
        <span style={S.leyendaItem}><span style={{ ...S.dot, background: '#3b82f6', borderRadius: 3 }} /> Configurado</span>
        {modoEjecucion && (
          <>
            <span style={S.leyendaItem}><span style={{ ...S.dot, background: '#22c55e' }} /> Real dentro</span>
            <span style={S.leyendaItem}><span style={{ ...S.dot, background: '#ef4444' }} /> Real fuera</span>
          </>
        )}
      </div>

      {cargandoPuntos && <Nota>Cargando puntos…</Nota>}
      {errorPuntos && <CajaError>{errorPuntos}</CajaError>}
      {errorDetalle && <CajaError>{errorDetalle}</CajaError>}
      {detalleSinAcceso && detalle && (
        <Nota>{mensajeContextoDetalleEjecucion(detalle.contexto) ?? 'No se pudo cargar la ejecución.'}</Nota>
      )}

      {!cargandoPuntos && !errorPuntos && (
        ejecucionSel === 'config' && configPuntos.length === 0 ? (
          <Nota>Esta ronda no tiene puntos configurados.</Nota>
        ) : puntosMapa.length === 0 ? (
          <Nota>Esta ronda no tiene puntos con coordenadas para ubicar en el mapa.</Nota>
        ) : (
          <>
            {cargandoDetalle && modoEjecucion && <Nota>Cargando GPS real…</Nota>}
            <RondaEjecucionMapa
              puntos={puntosMapa}
              seleccionadoId={puntoSel}
              onSeleccionar={setPuntoSel}
              centroObjetivo={centroObjetivo}
            />
            {puntoInfo && <InfoPunto punto={puntoInfo} modoEjecucion={modoEjecucion} />}
          </>
        )
      )}
    </div>
  )
}

function InfoPunto({ punto, modoEjecucion }: { punto: PuntoMapaSupervision; modoEjecucion: boolean }) {
  return (
    <div style={S.info}>
      <div style={S.infoTitulo}>#{punto.orden} · {punto.nombre}</div>
      <div style={S.infoGrid}>
        <MiniInfo label="Config" valor={`${punto.config_lat.toFixed(6)}, ${punto.config_lng.toFixed(6)}`} />
        <MiniInfo label="Radio" valor={punto.config_radio !== null ? `${punto.config_radio} m` : '—'} />
        {modoEjecucion && (
          <>
            <MiniInfo
              label="GPS real"
              valor={punto.real_lat !== null && punto.real_lng !== null
                ? `${punto.real_lat.toFixed(6)}, ${punto.real_lng.toFixed(6)}`
                : 'Sin registro'}
            />
            <MiniInfo label="Distancia" valor={punto.distancia !== null ? `${punto.distancia} m` : '—'} />
            <MiniInfo label="Dentro del radio" valor={punto.dentro_radio === null ? '—' : punto.dentro_radio ? 'Sí' : 'No'} />
            <MiniInfo label="Estado" valor={punto.estado ?? '—'} />
          </>
        )}
      </div>
    </div>
  )
}

function MiniInfo({ label, valor }: { label: string; valor: string }) {
  return (
    <div style={S.mini}>
      <span style={S.miniLabel}>{label}</span>
      <span style={S.miniValor}>{valor}</span>
    </div>
  )
}

// ── Sección Historial ─────────────────────────────────────────────────────────
// Una fila por ronda PROGRAMADA, no por ejecución: las no iniciadas aparecen
// aunque nunca hayan existido en `ronda_ejecuciones`.
//
// El estado de cada fila lo deriva el servidor de la programación y la ejecución.
// No depende de que exista una alerta: si se vaciaran las alertas, esta tabla
// mostraría exactamente lo mismo. La suspensión declarada por el vigilador se
// pinta como anotación sobre la fila, no como su estado.

type FiltroHistorial = 'todas' | 'incumplidas' | EstadoRondaProgramada

const FILTROS_HISTORIAL: { id: FiltroHistorial; label: string }[] = [
  { id: 'todas',       label: 'Todas' },
  { id: 'incumplidas', label: 'Incumplidas' },
  { id: 'no_iniciada', label: 'No iniciadas' },
  { id: 'incompleta',  label: 'Incompletas' },
  { id: 'completada',  label: 'Completadas' },
  { id: 'en_curso',    label: 'En curso' },
  { id: 'pendiente',   label: 'Pendientes' },
]

// El chip de estado sale del modelo unificado de lib/rondas.ts: mismo color y
// misma etiqueta que el Dashboard y el legajo. Sin reglas propias.
function chipEstado(r: RondaProgramada): { texto: string; style: React.CSSProperties } {
  const color = colorRondaProgramada(r)
  return {
    texto: ETIQUETA_CORTA_ESTADO_TECNICO[estadoTecnicoRonda(r)],
    style: { background: `${color}22`, color, border: `1px solid ${color}55` },
  }
}

function SeccionHistorial({ objetivoId, onVerDetalle }: { objetivoId: string; onVerDetalle: (ejecucionId: string) => void }) {
  const [desde, setDesde] = useState<string>(hace30dias)
  const [hasta, setHasta] = useState<string>(() => fechaLocal(new Date()))
  const [filtro, setFiltro] = useState<FiltroHistorial>('todas')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [contexto, setContexto] = useState<ContextoEjecucionesObjetivo>('ok')
  const [items, setItems] = useState<RondaProgramada[]>([])

  const iniciarCarga = useVigenciaCarga()

  const cargar = useCallback(async () => {
    setCargando(true)
    const vigente = iniciarCarga()
    const { data, error: err } = await listarRondasProgramadasObjetivo(objetivoId, desde, hasta)
    // Cambiar de rango rápido dispara varias cargas: solo escribe la última.
    if (!vigente()) return
    if (err) {
      setError(err); setItems([]); setContexto('ok')
    } else if (data) {
      setError(null); setContexto(data.contexto); setItems(data.rondas)
    }
    setCargando(false)
  }, [objetivoId, desde, hasta, iniciarCarga])

  useEffect(() => { void cargar() }, [cargar])

  const visibles = useMemo(() => items.filter(r => {
    if (filtro === 'todas') return true
    if (filtro === 'incumplidas') return rondaProgramadaEsIncumplida(r)
    return r.estado === filtro
  }), [items, filtro])

  const conteos = useMemo(() => ({
    total:       items.length,
    incumplidas: items.filter(rondaProgramadaEsIncumplida).length,
  }), [items])

  const sinPermiso = !cargando && !error && contexto === 'sin_permiso'

  return (
    <div>
      {!sinPermiso && (
        <>
          <div style={S.filtros}>
            <label style={S.filtroLabel}>
              Desde
              <input type="date" value={desde} max={hasta} onChange={e => setDesde(e.target.value)} style={S.fecha} />
            </label>
            <label style={S.filtroLabel}>
              Hasta
              <input type="date" value={hasta} min={desde} onChange={e => setHasta(e.target.value)} style={S.fecha} />
            </label>
            <button type="button" style={S.recargar} onClick={() => void cargar()} disabled={cargando}>
              {cargando ? '…' : '↻'}
            </button>
          </div>

          <div style={S.chipsFiltro} role="tablist" aria-label="Filtro de estado">
            {FILTROS_HISTORIAL.map(f => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filtro === f.id}
                style={{ ...S.filtroBtn, ...(filtro === f.id ? S.filtroBtnActivo : null) }}
                onClick={() => setFiltro(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </>
      )}

      {cargando && <Nota>Cargando historial…</Nota>}

      {!cargando && error && (
        <CajaError>{error}</CajaError>
      )}

      {!cargando && !error && contexto !== 'ok' && (
        <Nota>{mensajeContextoEjecucionesObjetivo(contexto) ?? 'No se pudo cargar el historial.'}</Nota>
      )}

      {!cargando && !error && contexto === 'ok' && items.length === 0 && (
        <Nota>No había rondas programadas en el período seleccionado.</Nota>
      )}

      {!cargando && !error && contexto === 'ok' && items.length > 0 && visibles.length === 0 && (
        <Nota>Ninguna ronda del período coincide con este filtro.</Nota>
      )}

      {!cargando && !error && contexto === 'ok' && visibles.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <div style={S.contador}>
            {visibles.length} de {conteos.total} ronda(s) programada(s)
            {conteos.incumplidas > 0 && ` · ${conteos.incumplidas} incumplida(s)`}
          </div>
          <table style={S.tabla}>
            <thead>
              <tr>
                {['Ronda', 'Puesto', 'Vigilador', 'Ventana', 'Estado', 'Puntos', 'Detalle'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibles.map(r => (
                <tr key={`${r.turno_id}-${r.ronda_base_id}-${r.ventana_inicio}`} style={S.tr}>
                  <td style={S.td}>
                    <div style={S.celdaFuerte}>{r.ronda_nombre}</div>
                  </td>
                  <td style={S.td}>{r.puesto_nombre}</td>
                  <td style={S.td}>{r.guardia_nombre}</td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                    {horaCorta(r.ventana_inicio)}
                    <div style={S.subCelda}>
                      {r.iniciada_at ? `inició ${horaCorta(r.iniciada_at)}` : 'sin inicio'}
                    </div>
                  </td>
                  <td style={S.td}>
                    {/* Estado técnico + observaciones + estado de alerta, en
                        campos separados: la intervención nunca reemplaza al
                        estado técnico. Colores del modelo unificado. */}
                    <span style={{ ...S.chip, ...chipEstado(r).style }} title={resumenObservacionesRonda(r) ?? undefined}>
                      {chipEstado(r).texto}
                    </span>
                    {resumenObservacionesRonda(r) && (
                      <div style={S.subCelda}>{resumenObservacionesRonda(r)}</div>
                    )}
                    {r.pausada && (
                      <div style={S.subCelda} title={r.pausa_motivo ?? undefined}>
                        {r.pausada_por_nombre ? `Pausada por ${r.pausada_por_nombre}` : 'Pausada'}
                      </div>
                    )}
                    {/* Anexo: no es el estado de la ronda, es una anotación sobre ella. */}
                    {r.alerta_suspendida && (
                      <span style={{ ...S.chip, ...S.chipInfo, marginLeft: 6 }} title={r.alerta_motivo_vigilador ?? undefined}>
                        Suspendida
                      </span>
                    )}
                    {estadoAlertaRonda(r) === 'intervenida' && (
                      <span
                        style={{ ...S.chip, ...S.chipIntervenida, marginLeft: 6 }}
                        title={[r.alerta_comentario, r.alerta_resuelta_por_nombre].filter(Boolean).join(' — ') || undefined}
                      >
                        Alerta intervenida
                      </span>
                    )}
                  </td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                    {r.ejecucion_id === null ? (
                      <span style={S.puntoOmit}>—</span>
                    ) : (
                      <>
                        <span style={S.puntoOk}>✓ {r.puntos_cumplidos}</span>
                        {' · '}
                        <span style={S.puntoBad}>✗ {r.puntos_incumplidos}</span>
                        {' · '}
                        <span style={S.puntoOmit}>⊘ {r.puntos_omitidos}</span>
                      </>
                    )}
                  </td>
                  <td style={S.td}>
                    {r.ejecucion_id === null ? (
                      <span style={S.sinDetalle}>Sin ejecución</span>
                    ) : (
                      <button type="button" style={S.verDetalle} onClick={() => onVerDetalle(r.ejecucion_id as string)}>
                        Ver
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Sub-componentes de estado reutilizables ───────────────────────────────────

function Nota({ children }: { children: React.ReactNode }) {
  return <div style={S.nota}>{children}</div>
}
function CajaError({ children }: { children: React.ReactNode }) {
  return <div style={S.error} role="alert">{children}</div>
}

const S: Record<string, React.CSSProperties> = {
  wrap: { marginTop: 8 },
  titulo: { fontSize: 15, fontWeight: 800, color: '#f8fafc', marginBottom: 10 },
  tabs: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 },
  tab: {
    border: '1px solid #1e2d42', background: '#0f172a', color: '#94a3b8',
    borderRadius: 999, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
  tabActivo: { background: '#f59e0b', color: '#111827', borderColor: '#f59e0b' },
  contenido: {},
  intro: { fontSize: 12, color: '#94a3b8', marginBottom: 8 },
  nota: { fontSize: 13, color: '#94a3b8', padding: '14px 4px' },
  error: {
    fontSize: 12, color: '#fecaca', background: '#3b1116',
    border: '1px solid #991b1b', borderRadius: 8, padding: 10, marginTop: 8,
  },
  filtros: { display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 },
  filtroLabel: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#64748b', fontWeight: 700 },
  fecha: {
    background: '#0f172a', color: '#e2e8f0', border: '1px solid #1e2d42',
    borderRadius: 8, padding: '7px 10px', fontSize: 13,
  },
  recargar: {
    width: 34, height: 34, borderRadius: 8, border: '1px solid #1e2d42',
    background: '#111827', color: '#e2e8f0', fontSize: 15, cursor: 'pointer',
  },
  contador: { fontSize: 11, color: '#64748b', marginBottom: 8 },
  tabla: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: {
    padding: '6px 10px', textAlign: 'left', color: '#64748b', fontWeight: 700,
    fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap',
    borderBottom: '1px solid #1e2d42',
  },
  tr: { borderBottom: '1px solid #0f172a' },
  td: { padding: '8px 10px', color: '#cbd5e1', verticalAlign: 'top' },
  celdaFuerte: { color: '#e2e8f0', fontWeight: 700 },
  chip: { fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap', display: 'inline-block' },
  chipOk: { background: '#052e16', color: '#4ade80', border: '1px solid #166534' },
  chipWarn: { background: '#3f2d10', color: '#fbbf24', border: '1px solid #b45309' },
  chipBad: { background: '#3b1116', color: '#fca5a5', border: '1px solid #991b1b' },
  chipInfo: { background: '#1e293b', color: '#93c5fd', border: '1px solid #2563eb' },
  chipNeutro: { background: '#0f172a', color: '#94a3b8', border: '1px solid #334155' },
  chipAdmin: { background: '#3b1116', color: '#fca5a5', border: '1px solid #991b1b' },
  // Verde lima del modelo unificado: alerta intervenida.
  chipIntervenida: { background: '#a3e63522', color: '#a3e635', border: '1px solid #a3e63555' },
  chipsFiltro: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 },
  filtroBtn: {
    border: '1px solid #1e2d42', background: '#0f172a', color: '#94a3b8',
    borderRadius: 999, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
  filtroBtnActivo: { background: '#f59e0b', color: '#111827', borderColor: '#f59e0b' },
  subCelda: { fontSize: 10, color: '#64748b', marginTop: 2 },
  sinDetalle: { fontSize: 11, color: '#475569', whiteSpace: 'nowrap' },
  puntoOk: { color: '#4ade80', fontWeight: 700 },
  puntoBad: { color: '#fca5a5', fontWeight: 700 },
  puntoOmit: { color: '#94a3b8', fontWeight: 700 },
  verDetalle: {
    border: '1px solid #1e2d42', background: '#111827', color: '#e2e8f0',
    borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  select: {
    background: '#0f172a', color: '#e2e8f0', border: '1px solid #1e2d42',
    borderRadius: 8, padding: '7px 10px', fontSize: 13, minWidth: 200, maxWidth: '100%',
  },
  leyenda: { display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', margin: '4px 2px 12px', fontSize: 12, color: '#94a3b8' },
  leyendaItem: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  dot: { display: 'inline-block', width: 12, height: 12, borderRadius: 999, border: '1px solid rgba(255,255,255,.6)' },
  info: { marginTop: 12, border: '1px solid #1e2d42', borderRadius: 10, background: '#0f172a', padding: 12 },
  infoTitulo: { fontSize: 14, fontWeight: 800, color: '#f8fafc', marginBottom: 8 },
  infoGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 },
  mini: { background: '#0b1220', border: '1px solid #1a2436', borderRadius: 6, padding: '6px 8px' },
  miniLabel: { display: 'block', fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.3 },
  miniValor: { display: 'block', fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginTop: 1 },
}
