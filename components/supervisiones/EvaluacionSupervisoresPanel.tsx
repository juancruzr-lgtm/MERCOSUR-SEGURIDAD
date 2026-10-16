'use client'

/**
 * components/supervisiones/EvaluacionSupervisoresPanel.tsx
 *
 * Evaluación de supervisores — Etapa 1 (sólo lectura). Ranking por período y
 * detalle por supervisor: alertas de ronda que le tocaron y qué pasó con cada
 * una, y objetivos de su zona que se le vencieron.
 *
 * Todo el cálculo está en la base (evaluacion_supervisores_periodo y sus
 * detalles); acá sólo se muestra. La ven Dirección Operativa y Gerencia: la
 * base lo revalida y, si no corresponde, devuelve el error y se muestra.
 *
 * Lo que todavía NO mide (etapas siguientes): si el supervisor ABRIÓ la alerta
 * («visto») y las fallas de asistencia como eventos propios. De asistencia se
 * muestran los avisos que recibió y las acciones que registró.
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ZONA_ARGENTINA } from '@/lib/periodo-argentina'
import {
  ETIQUETA_ESTADO_ATENCION, ETIQUETA_ORIGEN, INICIO_EVALUACION,
  cargarDetalleSupervisor, cargarEvaluacionSupervisores, duracionLegible, ordenarRanking,
  periodoPorDefecto, tasas, validarRango,
} from '@/lib/evaluacion-supervisores'
import type {
  AlertaRondaAtribuida, EstadoAtencion, FilaEvaluacionSupervisor, VencimientoSupervision,
} from '@/lib/evaluacion-supervisores'

const C = {
  bg: '#0f172a', borde: '#1e293b', texto: '#e2e8f0', tenue: '#94a3b8', apagado: '#64748b',
  amarillo: '#f59e0b', rojo: '#ef4444', verde: '#10b981', celeste: '#38bdf8',
}

const COLOR_ESTADO: Record<EstadoAtencion, string> = {
  intervenida_propia: C.verde,
  intervenida_por_otro: C.celeste,
  cerrada_sin_intervencion: C.amarillo,
  sin_atender: C.rojo,
}

const caja: React.CSSProperties = {
  minWidth: 0, boxSizing: 'border-box',
  background: C.bg, border: `1px solid ${C.borde}`, borderRadius: 12, padding: 14,
}
const campo: React.CSSProperties = {
  background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: C.texto,
  padding: '8px 10px', fontSize: 13, boxSizing: 'border-box', minWidth: 0,
}
const boton = (color: string): React.CSSProperties => ({
  background: `${color}22`, color, border: `1px solid ${color}66`, borderRadius: 8,
  padding: '8px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
})
const th: React.CSSProperties = {
  textAlign: 'right', padding: '8px 10px', fontSize: 11, color: C.apagado, fontWeight: 700,
  borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap',
}
const td: React.CSSProperties = {
  textAlign: 'right', padding: '8px 10px', fontSize: 13, color: C.texto,
  borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap',
}

const FMT_FECHA_HORA = new Intl.DateTimeFormat('es-AR', {
  timeZone: ZONA_ARGENTINA, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})
const fechaHora = (ts: string | null | undefined) => (ts ? FMT_FECHA_HORA.format(new Date(ts)) : '—')
const porcentaje = (n: number | null) => (n === null ? '—' : `${n}%`)
const colorTasa = (n: number | null) => (n === null ? C.apagado : n >= 70 ? C.verde : n >= 40 ? C.amarillo : C.rojo)
const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`

const TIPO_ALERTA: Record<string, string> = {
  no_iniciada: 'No iniciada', no_finalizada: 'No finalizada', suspendida: 'Suspendida',
}

export default function EvaluacionSupervisoresPanel() {
  const inicial = periodoPorDefecto()
  const [desde, setDesde] = useState(inicial.desde)
  const [hasta, setHasta] = useState(inicial.hasta)
  const [filas, setFilas] = useState<FilaEvaluacionSupervisor[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elegido, setElegido] = useState<FilaEvaluacionSupervisor | null>(null)

  const cargar = useCallback(async () => {
    const invalido = validarRango(desde, hasta)
    if (invalido) { setError(invalido); return }
    setCargando(true)
    setError(null)
    const r = await cargarEvaluacionSupervisores(supabase, desde, hasta)
    setFilas(ordenarRanking(r.data))
    setError(r.error)
    setCargando(false)
  }, [desde, hasta])

  useEffect(() => { void cargar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const referencia = desde < INICIO_EVALUACION
  const total = filas.reduce((a, f) => ({
    alertas: a.alertas + f.rondas_alertas,
    propias: a.propias + f.rondas_intervenidas_propias,
    sinAtender: a.sinAtender + f.rondas_sin_atender,
    vencimientos: a.vencimientos + f.vencimientos_supervision,
  }), { alertas: 0, propias: 0, sinAtender: 0, vencimientos: 0 })

  return (
    <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.texto }}>Evaluación de supervisores</div>
        <div style={{ fontSize: 13, color: C.tenue, marginTop: 4, lineHeight: 1.5 }}>
          Qué pasó con las alertas de ronda que le tocaron a cada supervisor y cuántos objetivos de su zona
          se le vencieron. Una alerta con dos supervisores de guardia es de los dos: si la atendió el otro,
          figura como «intervino otro». Todavía no se mide si el supervisor abrió la alerta.
        </div>
      </div>

      <div style={{ ...caja, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, color: C.tenue }}>
          Desde
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={campo} />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, color: C.tenue }}>
          Hasta
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={campo} />
        </label>
        <button type="button" onClick={() => void cargar()} style={boton(C.celeste)} disabled={cargando}>
          {cargando ? 'Calculando…' : 'Calcular'}
        </button>
      </div>

      {referencia && (
        <div style={{ ...caja, fontSize: 13, color: C.amarillo }}>
          El período empieza antes del {fechaCorta(INICIO_EVALUACION)}: es sólo referencia. La evaluación arranca
          ese día (antes hubo un cierre administrativo masivo de alertas).
        </div>
      )}
      {error && <div style={{ ...caja, fontSize: 13, color: '#fca5a5' }}>No se pudo calcular: {error}</div>}

      {!error && filas.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          {[
            ['Alertas de ronda asignadas', total.alertas, C.texto],
            ['Intervenidas por el responsable', total.propias, C.verde],
            ['Sin atender por nadie', total.sinAtender, C.rojo],
            ['Vencimientos de supervisión', total.vencimientos, C.amarillo],
          ].map(([t, n, c]) => (
            <div key={String(t)} style={caja}>
              <div style={{ fontSize: 11, color: C.apagado }}>{t}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: String(c) }}>{n}</div>
            </div>
          ))}
        </div>
      )}

      {!error && (
        <div style={{ ...caja, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>Supervisor</th>
                <th style={th} title="Horas de guardia en el calendario (sin francos ni ausencias)">Hs guardia</th>
                <th style={th}>Supervisiones</th>
                <th style={th} title="Objetivos de su zona que se le vencieron (y horas vencidas dentro del período)">Obj. vencidos</th>
                <th style={th}>Alertas</th>
                <th style={th} title="Las que intervino él sobre las que le tocaron">Intervino</th>
                <th style={th} title="Las atendió otro supervisor (no le resta)">Intervino otro</th>
                <th style={th} title="Se cerraron sin que nadie interviniera">Cerradas s/interv.</th>
                <th style={th}>Sin atender</th>
                <th style={th} title="Mediana desde que se detectó la alerta hasta su primera intervención">Tiempo a intervenir</th>
                <th style={th} title="3ª falla o más del mismo vigilador en 14 días sin llamado ni pedido de cumplimiento">Reincid. s/acción</th>
                <th style={th} title="Avisos de asistencia recibidos / acciones registradas">Asistencia</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => {
                const t = tasas(f)
                return (
                  <tr key={f.supervisor_id} onClick={() => setElegido(f)}
                      style={{ cursor: 'pointer', background: elegido?.supervisor_id === f.supervisor_id ? '#38bdf811' : 'transparent' }}>
                    <td style={{ ...td, textAlign: 'left' }}>
                      <div style={{ fontWeight: 700 }}>{f.supervisor}</div>
                      <div style={{ fontSize: 11, color: C.apagado }}>
                        {f.puesto === 'jefe_supervisores' ? 'Jefe de supervisores' : 'Supervisor'}{f.zonas ? ` · ${f.zonas}` : ''}
                      </div>
                    </td>
                    <td style={td}>{f.horas_guardia}</td>
                    <td style={td}>{f.supervisiones}</td>
                    <td style={td}>
                      {f.vencimientos_supervision}
                      {f.vencimientos_supervision > 0 && (
                        <span style={{ color: C.apagado, fontSize: 11 }}> · {Math.round(f.horas_objetivo_vencidas)} h</span>
                      )}
                    </td>
                    <td style={td}>{f.rondas_alertas}</td>
                    <td style={{ ...td, color: colorTasa(t.atencionPropia), fontWeight: 700 }}>
                      {f.rondas_intervenidas_propias} <span style={{ fontSize: 11 }}>({porcentaje(t.atencionPropia)})</span>
                    </td>
                    <td style={td}>{f.rondas_intervenidas_por_otro}</td>
                    <td style={td}>{f.rondas_cerradas_sin_intervencion}</td>
                    <td style={{ ...td, color: f.rondas_sin_atender > 0 ? C.rojo : C.texto }}>{f.rondas_sin_atender}</td>
                    <td style={td}>{duracionLegible(f.mediana_min_intervencion)}</td>
                    <td style={td}>{f.reincidencias_sin_accion}</td>
                    <td style={td}>{f.asistencia_avisos} / {f.asistencia_acciones}</td>
                  </tr>
                )
              })}
              {!cargando && filas.length === 0 && (
                <tr><td colSpan={12} style={{ ...td, textAlign: 'center', color: C.apagado }}>Sin datos para el período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {elegido && <DetalleSupervisor fila={elegido} desde={desde} hasta={hasta} onCerrar={() => setElegido(null)} />}
    </div>
  )
}

function DetalleSupervisor({ fila, desde, hasta, onCerrar }: {
  fila: FilaEvaluacionSupervisor; desde: string; hasta: string; onCerrar: () => void
}) {
  const [alertas, setAlertas] = useState<AlertaRondaAtribuida[]>([])
  const [vencimientos, setVencimientos] = useState<VencimientoSupervision[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [filtro, setFiltro] = useState<EstadoAtencion | 'todas'>('todas')

  useEffect(() => {
    let vivo = true
    setCargando(true)
    void cargarDetalleSupervisor(supabase, fila.supervisor_id, desde, hasta).then(r => {
      if (!vivo) return
      setAlertas(r.alertas)
      setVencimientos(r.vencimientos)
      setError(r.error)
      setCargando(false)
    })
    return () => { vivo = false }
  }, [fila.supervisor_id, desde, hasta])

  const visibles = filtro === 'todas' ? alertas : alertas.filter(a => a.estado_atencion === filtro)
  const cuenta = (e: EstadoAtencion) => alertas.filter(a => a.estado_atencion === e).length

  return (
    <div style={{ ...caja, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.texto }}>{fila.supervisor}</div>
        <button type="button" onClick={onCerrar} style={boton(C.apagado)}>Cerrar</button>
      </div>
      {error && <div style={{ fontSize: 13, color: '#fca5a5' }}>No se pudo cargar todo: {error}</div>}
      {cargando && <div style={{ fontSize: 13, color: C.tenue }}>Cargando…</div>}

      {!cargando && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['todas', 'sin_atender', 'cerrada_sin_intervencion', 'intervenida_por_otro', 'intervenida_propia'] as const).map(e => (
              <button key={e} type="button" onClick={() => setFiltro(e)}
                      style={{ ...boton(e === 'todas' ? C.tenue : COLOR_ESTADO[e]), padding: '4px 10px', fontSize: 12,
                               opacity: filtro === e ? 1 : 0.55 }}>
                {e === 'todas' ? `Todas (${alertas.length})` : `${ETIQUETA_ESTADO_ATENCION[e]} (${cuenta(e)})`}
              </button>
            ))}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>Detectada</th>
                  <th style={{ ...th, textAlign: 'left' }}>Objetivo</th>
                  <th style={{ ...th, textAlign: 'left' }}>Vigilador</th>
                  <th style={{ ...th, textAlign: 'left' }}>Alerta</th>
                  <th style={{ ...th, textAlign: 'left' }}>Por qué es suya</th>
                  <th style={{ ...th, textAlign: 'left' }}>Qué pasó</th>
                  <th style={th}>Intervino a los</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map(a => (
                  <tr key={a.ronda_alerta_id}>
                    <td style={{ ...td, textAlign: 'left' }}>{fechaHora(a.detectada_at)}</td>
                    <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal' }}>{a.objetivo ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal' }}>
                      {a.vigilador || '—'}
                      {a.reincidente_sin_accion && (
                        <span title="3ª falla o más en 14 días sin llamado ni pedido de cumplimiento"
                              style={{ marginLeft: 6, fontSize: 11, color: C.rojo, fontWeight: 700 }}>reincide</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'left' }}>{TIPO_ALERTA[a.tipo] ?? a.tipo}</td>
                    <td style={{ ...td, textAlign: 'left', color: C.tenue }}>{ETIQUETA_ORIGEN[a.origen_atribucion] ?? a.origen_atribucion}</td>
                    <td style={{ ...td, textAlign: 'left', color: COLOR_ESTADO[a.estado_atencion], fontWeight: 700 }}>
                      {ETIQUETA_ESTADO_ATENCION[a.estado_atencion]}
                    </td>
                    <td style={td}>{a.estado_atencion === 'intervenida_propia' ? duracionLegible(a.minutos_a_intervenir) : '—'}</td>
                  </tr>
                ))}
                {visibles.length === 0 && (
                  <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: C.apagado }}>Sin alertas.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: 14, fontWeight: 800, color: C.texto, marginTop: 6 }}>
            Objetivos que se le vencieron ({vencimientos.length})
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>Objetivo</th>
                  <th style={{ ...th, textAlign: 'left' }}>Venció</th>
                  <th style={{ ...th, textAlign: 'left' }}>Se supervisó</th>
                  <th style={th}>Horas vencido (en el período)</th>
                </tr>
              </thead>
              <tbody>
                {vencimientos.map((v, i) => (
                  <tr key={`${v.objetivo}-${v.vencio_at}-${i}`}>
                    <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal' }}>{v.objetivo}</td>
                    <td style={{ ...td, textAlign: 'left' }}>{fechaHora(v.vencio_at)}</td>
                    <td style={{ ...td, textAlign: 'left', color: v.regularizado_at ? C.texto : C.rojo }}>
                      {v.regularizado_at ? fechaHora(v.regularizado_at) : 'Sigue vencido'}
                    </td>
                    <td style={td}>{v.horas_vencido}</td>
                  </tr>
                ))}
                {vencimientos.length === 0 && (
                  <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: C.apagado }}>Ninguno.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
