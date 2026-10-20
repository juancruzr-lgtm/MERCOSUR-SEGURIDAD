'use client'

/**
 * components/supervisiones/LegajoOperativoSupervisor.tsx
 *
 * Legajo operativo de UN supervisor (Etapa 2A, sólo lectura). Vive como
 * sección del legajo individual (/guardias/[id]?seccion=operativo) y se abre
 * también desde Evaluación de supervisores.
 *
 * Muestra lo que la base registra, separado del turno:
 *  · guardias programadas y la actividad GPS registrada en cada una;
 *  · supervisiones en turno, fuera de turno o sin guardia cargada;
 *  · distribución por hora con las horas de servicio al lado;
 *  · franjas de servicio sin supervisiones (sólo dentro de la guardia);
 *  · recorrido de una guardia en el mapa (sólo tramos con evidencia GPS);
 *  · objetivos visitados y lo anotado en cada supervisión.
 *
 * No califica ni descuenta nada: son indicadores para que quien evalúa lea.
 * El permiso lo decide la base (puede_ver_legajo_supervisores_actual).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { supabase } from '@/lib/supabase'
import { fechaArgentina, ZONA_ARGENTINA } from '@/lib/periodo-argentina'
import { validarRango } from '@/lib/evaluacion-supervisores'
import {
  ACLARACION_CATEGORIAS, ETIQUETA_COBERTURA, ETIQUETA_SITUACION, SITUACIONES, cargarLegajoSupervisores,
  cargarRecorridoGuardia, distribucionHoraria, franjasSinSupervision, matrizDiaHora, objetivosVisitados,
  posicionEnTurno, resumenLegajo, situacionTurno, ventanaPeriodo,
} from '@/lib/legajo-supervisor'
import type { GuardiaLegajo, PuntoRecorrido, SituacionTurno, SupervisionLegajo } from '@/lib/legajo-supervisor'
import { BarraPosicionTurno, COLOR_SITUACION, GraficoPorHora, MatrizDiaHora } from './GraficosHorarioSupervision'

const MapaRecorridoGuardia = dynamic(() => import('./MapaRecorridoGuardia'), {
  ssr: false,
  loading: () => <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>Cargando mapa…</div>,
})

const C = {
  bg: '#0f172a', borde: '#1e293b', texto: '#e2e8f0', tenue: '#94a3b8', apagado: '#64748b',
  amarillo: '#f59e0b', rojo: '#ef4444', verde: '#10b981', celeste: '#38bdf8',
}
const caja: React.CSSProperties = { minWidth: 0, boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.borde}`, borderRadius: 12, padding: 14 }
const campo: React.CSSProperties = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: C.texto, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box', minWidth: 0 }
const boton = (color: string): React.CSSProperties => ({ background: `${color}22`, color, border: `1px solid ${color}66`, borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' })
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 11, color: C.apagado, fontWeight: 700, borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 12, color: C.texto, borderBottom: `1px solid ${C.borde}`, verticalAlign: 'top' }
const titulo: React.CSSProperties = { fontSize: 14, fontWeight: 800, color: C.texto, marginBottom: 10 }

const FMT_HM = new Intl.DateTimeFormat('es-AR', { timeZone: ZONA_ARGENTINA, hour: '2-digit', minute: '2-digit', hour12: false })
const FMT_DH = new Intl.DateTimeFormat('es-AR', { timeZone: ZONA_ARGENTINA, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
const hm = (ts: string | null) => (ts ? FMT_HM.format(new Date(ts)) : '—')
const dh = (ts: string | null) => (ts ? FMT_DH.format(new Date(ts)) : '—')
const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`
const COLOR_SIT: Record<SituacionTurno, string> = {
  en_turno: COLOR_SITUACION.en_turno, cubrio_otro: COLOR_SITUACION.cubrio_otro,
  sin_programacion: COLOR_SITUACION.sin_programacion, fuera_turno: COLOR_SITUACION.fuera_turno,
}

function periodoInicial(): { desde: string; hasta: string } {
  const hoy = fechaArgentina()
  return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy }
}

function Tarjeta({ t, v, ayuda, color }: { t: string; v: string | number; ayuda?: string; color?: string }) {
  return (
    <div style={caja} title={ayuda}>
      <div style={{ fontSize: 11, color: C.apagado }}>{t}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color ?? C.texto }}>{v}</div>
      {ayuda && <div style={{ fontSize: 11, color: C.apagado, marginTop: 2 }}>{ayuda}</div>}
    </div>
  )
}

export default function LegajoOperativoSupervisor({ supervisorId }: { supervisorId: string }) {
  const inicial = periodoInicial()
  const [desde, setDesde] = useState(inicial.desde)
  const [hasta, setHasta] = useState(inicial.hasta)
  const [guardias, setGuardias] = useState<GuardiaLegajo[]>([])
  const [sups, setSups] = useState<SupervisionLegajo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [guardiaMapa, setGuardiaMapa] = useState<GuardiaLegajo | null>(null)
  const [filtroSit, setFiltroSit] = useState<SituacionTurno | 'todas'>('todas')

  const cargar = useCallback(async () => {
    const inv = validarRango(desde, hasta)
    if (inv) { setError(inv); return }
    setCargando(true)
    setError(null)
    const r = await cargarLegajoSupervisores(supabase, supervisorId, desde, hasta)
    setGuardias(r.guardias)
    setSups(r.supervisiones)
    setVentana(ventanaPeriodo(desde, hasta))
    setError(r.error)
    setGuardiaMapa(null)
    setCargando(false)
  }, [supervisorId, desde, hasta])

  useEffect(() => { void cargar() }, [supervisorId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ventana del período cargado: recorta la noche que empezó el día anterior.
  const [ventana, setVentana] = useState(() => ventanaPeriodo(inicial.desde, inicial.hasta))
  const resumen = useMemo(() => resumenLegajo(guardias, sups, ventana), [guardias, sups, ventana])
  const horas = useMemo(() => distribucionHoraria(sups, guardias, ventana), [sups, guardias, ventana])
  const matriz = useMemo(() => matrizDiaHora(sups), [sups])
  const posicion = useMemo(() => posicionEnTurno(sups, guardias), [sups, guardias])
  const objetivos = useMemo(() => objetivosVisitados(sups), [sups])
  const visibles = filtroSit === 'todas' ? sups : sups.filter(s => situacionTurno(s) === filtroSit)

  return (
    <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
      <div style={{ ...caja, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, color: C.tenue }}>
          Desde<input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={campo} />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, color: C.tenue }}>
          Hasta<input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={campo} />
        </label>
        <button type="button" onClick={() => void cargar()} style={{ ...boton(C.celeste), padding: '8px 12px', fontSize: 13 }} disabled={cargando}>
          {cargando ? 'Cargando…' : 'Ver período'}
        </button>
        <div style={{ fontSize: 12, color: C.apagado, flex: '1 1 260px' }}>
          El supervisor no ficha: la actividad registrada son los puntos GPS que envía la app durante la guardia.
          Sin puntos no hay evidencia, que no es lo mismo que «no trabajó».
        </div>
      </div>

      {error && <div style={{ ...caja, color: '#fca5a5', fontSize: 13 }}>No se pudo cargar el legajo: {error}</div>}

      {!error && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <Tarjeta t="Guardias de servicio" v={resumen.guardiasServicio} ayuda={`${resumen.horasProgramadas} h programadas`} />
            <Tarjeta t="Guardias con actividad GPS" v={`${resumen.guardiasConGps} / ${resumen.guardiasServicio}`} />
            <Tarjeta t="Supervisiones" v={resumen.supervisiones} ayuda={`${resumen.objetivosDistintos} objetivos distintos`} />
            <Tarjeta t={ETIQUETA_SITUACION.en_turno} v={resumen.enTurno}
                     ayuda={resumen.porHoraServicio === null ? undefined : `${resumen.porHoraServicio} por hora de servicio`} />
            <Tarjeta t={ETIQUETA_SITUACION.cubrio_otro} v={resumen.cubrioOtro}
                     ayuda={resumen.coberturasProbables ? `${resumen.coberturasProbables} probables a revisar` : undefined} />
            <Tarjeta t={ETIQUETA_SITUACION.sin_programacion} v={resumen.sinProgramacion} ayuda="Nadie programado en esa franja" />
            <Tarjeta t={ETIQUETA_SITUACION.fuera_turno} v={resumen.fueraTurno} ayuda="Había otro programado y activo" />
            <Tarjeta t="Con ítems observados" v={resumen.conItemsObservados} ayuda="En el checklist" />
          </div>
          <div style={{ fontSize: 12, color: C.apagado, marginTop: -6 }}>{ACLARACION_CATEGORIAS}</div>

          <div style={caja}>
            <div style={titulo}>Supervisiones por hora del día</div>
            <GraficoPorHora filas={horas} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
            <div style={caja}>
              <div style={titulo}>Por día de la semana y hora</div>
              <MatrizDiaHora matriz={matriz} />
            </div>
            <div style={caja}>
              <div style={titulo}>Dónde caen dentro del turno</div>
              <BarraPosicionTurno {...posicion} />
            </div>
          </div>

          <div style={caja}>
            <div style={titulo}>Guardias: programado y registrado</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th}>Fecha</th><th style={th}>Programado</th><th style={th}>Actividad GPS registrada</th>
                  <th style={th}>Supervisiones</th><th style={th}>Franjas de servicio sin supervisiones (≥ 2 h)</th><th style={th} />
                </tr></thead>
                <tbody>
                  {guardias.map(g => {
                    const huecos = franjasSinSupervision(g, sups, 120, new Date(), ventana)
                    return (
                      <tr key={g.guardia_id} style={{ opacity: g.cubre ? 1 : 0.55, background: guardiaMapa?.guardia_id === g.guardia_id ? '#38bdf811' : 'transparent' }}>
                        <td style={td}>{fechaCorta(g.fecha)}{g.zona ? <div style={{ color: C.apagado, fontSize: 11 }}>{g.zona}</div> : null}</td>
                        <td style={td}>
                          {hm(g.inicio)}–{hm(g.fin)}
                          {!g.cubre && <div style={{ color: C.apagado, fontSize: 11 }}>{g.tipo_evento !== 'normal' ? g.tipo_evento : g.estado} · no cuenta como servicio</div>}
                        </td>
                        <td style={td}>
                          {g.gps_puntos > 0
                            ? <>{hm(g.gps_desde)}–{hm(g.gps_hasta)} <span style={{ color: C.apagado, fontSize: 11 }}>({g.gps_puntos} puntos)</span></>
                            : <span style={{ color: C.apagado }}>Sin puntos GPS</span>}
                        </td>
                        <td style={td}>{g.supervisiones}{g.objetivos_visitados ? <span style={{ color: C.apagado, fontSize: 11 }}> · {g.objetivos_visitados} obj.</span> : null}</td>
                        <td style={td}>
                          {!g.cubre ? '—' : huecos.length === 0
                            ? <span style={{ color: C.apagado }}>Ninguna</span>
                            : huecos.map(h => <div key={h.desde} style={{ color: C.amarillo }}>{hm(h.desde)}–{hm(h.hasta)} ({Math.round(h.minutos / 6) / 10} h)</div>)}
                        </td>
                        <td style={td}>
                          {(g.gps_puntos > 0 || g.supervisiones > 0) && (
                            <button type="button" style={boton(C.celeste)} onClick={() => setGuardiaMapa(g)}>Ver recorrido</button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {!cargando && guardias.length === 0 && <tr><td colSpan={6} style={{ ...td, color: C.apagado }}>Sin guardias cargadas en el período.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {guardiaMapa && (
            <RecorridoGuardia guardia={guardiaMapa}
                              supervisiones={sups.filter(s => s.guardia_id === guardiaMapa.guardia_id)}
                              onCerrar={() => setGuardiaMapa(null)} />
          )}

          <div style={caja}>
            <div style={titulo}>Objetivos visitados ({objetivos.length}) — de menos a más visitas</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
              {objetivos.map(o => (
                <div key={o.objetivo_id} style={{ border: `1px solid ${C.borde}`, borderRadius: 8, padding: 8, fontSize: 12, color: C.texto }}>
                  <div style={{ fontWeight: 700 }}>{o.objetivo}</div>
                  <div style={{ color: C.apagado }}>{o.visitas} visita{o.visitas === 1 ? '' : 's'} · {o.enTurno} en turno · última {dh(o.ultima)}</div>
                </div>
              ))}
              {objetivos.length === 0 && <div style={{ fontSize: 12, color: C.apagado }}>Sin supervisiones.</div>}
            </div>
          </div>

          <div style={caja}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ ...titulo, marginBottom: 0 }}>Supervisiones, checklist y novedades anotadas</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(['todas', ...SITUACIONES] as const).map(f => (
                  <button key={f} type="button" onClick={() => setFiltroSit(f)}
                          style={{ ...boton(f === 'todas' ? C.tenue : COLOR_SIT[f]), opacity: filtroSit === f ? 1 : 0.55 }}>
                    {f === 'todas' ? `Todas (${sups.length})` : `${ETIQUETA_SITUACION[f]} (${sups.filter(s => situacionTurno(s) === f).length})`}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th}>Fecha y hora</th><th style={th}>Objetivo</th><th style={th}>Turno</th><th style={th}>Checklist</th>
                  <th style={th}>Distancia</th><th style={th}>Anotado</th>
                </tr></thead>
                <tbody>
                  {visibles.map(s => {
                    const sit = situacionTurno(s)
                    const fueraRadio = s.distancia_objetivo_m !== null && s.distancia_objetivo_m > (s.radio_m ?? 150)
                    return (
                      <tr key={s.supervision_id}>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{dh(s.created_at)}</td>
                        <td style={td}>{s.objetivo ?? '—'}{s.zona ? <div style={{ color: C.apagado, fontSize: 11 }}>{s.zona}</div> : null}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          <span style={{ color: COLOR_SIT[sit], fontWeight: 700 }}>{ETIQUETA_SITUACION[sit]}</span>
                          {s.cobertura && <div style={{ color: C.tenue, fontSize: 11 }}>{ETIQUETA_COBERTURA[s.cobertura]}</div>}
                          {s.programado && sit !== 'en_turno' && (
                            <div style={{ color: C.apagado, fontSize: 11 }}>Programado: {s.programado} · Hizo la visita: {s.supervisor}</div>
                          )}
                        </td>
                        <td style={td}>
                          {s.items_total ? `${s.items_total - s.items_observados}/${s.items_total} correctos` : 'Sin checklist'}
                          {s.estado !== 'ok' && <div style={{ color: s.estado === 'critico' ? C.rojo : C.amarillo, fontSize: 11 }}>{s.estado}</div>}
                          {s.fotos > 0 && <div style={{ color: C.apagado, fontSize: 11 }}>{s.fotos} foto{s.fotos === 1 ? '' : 's'}</div>}
                        </td>
                        <td style={{ ...td, color: fueraRadio ? C.amarillo : C.texto, whiteSpace: 'nowrap' }}>
                          {s.distancia_objetivo_m === null ? '—' : `${s.distancia_objetivo_m} m`}
                        </td>
                        <td style={{ ...td, minWidth: 220 }}>
                          {s.observaciones || <span style={{ color: C.apagado }}>—</span>}
                          {s.novedades_items && <div style={{ color: C.amarillo, marginTop: 2 }}>Ítems observados: {s.novedades_items}</div>}
                        </td>
                      </tr>
                    )
                  })}
                  {!cargando && visibles.length === 0 && <tr><td colSpan={6} style={{ ...td, color: C.apagado }}>Sin supervisiones.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function RecorridoGuardia({ guardia, supervisiones, onCerrar }: {
  guardia: GuardiaLegajo; supervisiones: SupervisionLegajo[]; onCerrar: () => void
}) {
  const [puntos, setPuntos] = useState<PuntoRecorrido[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vivo = true
    setCargando(true)
    void cargarRecorridoGuardia(supabase, guardia.guardia_id).then(r => {
      if (!vivo) return
      setPuntos(r.puntos)
      setError(r.error)
      setCargando(false)
    })
    return () => { vivo = false }
  }, [guardia.guardia_id])

  return (
    <div style={{ ...caja, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ ...titulo, marginBottom: 0 }}>
          Recorrido de la guardia del {fechaCorta(guardia.fecha)} · programada {hm(guardia.inicio)}–{hm(guardia.fin)}
        </div>
        <button type="button" style={boton(C.apagado)} onClick={onCerrar}>Cerrar</button>
      </div>
      {error && <div style={{ color: '#fca5a5', fontSize: 13 }}>No se pudo cargar el recorrido: {error}</div>}
      {cargando ? <div style={{ color: C.tenue, fontSize: 13 }}>Cargando…</div>
        : <MapaRecorridoGuardia puntos={puntos} supervisiones={supervisiones} />}
    </div>
  )
}
