'use client'

/**
 * components/desempeno/EvaluacionVigiladoresAvance.tsx
 *
 * Solapa "Evaluación por supervisor" de Guardias / Empleados (JC, 24/11/2026):
 * Administración y Gerencia ven cómo va la evaluación mensual de vigiladores
 * (planilla R 6.2 (3)) — cuánto hizo cada supervisor, qué nota pone y cómo
 * evaluaron a cada vigilador los distintos supervisores.
 *
 * Gerencia además evalúa desde acá: arriba aparece la misma tarjeta y el mismo
 * formulario que usa el supervisor en el celular. Administración sólo mira.
 *
 * Sólo informa: no mueve la nota mensual ni bloquea nada.
 */

import { useCallback, useEffect, useState } from 'react'
import EvaluacionVigiladoresSupervisor from '@/components/supervisor/EvaluacionVigiladoresSupervisor'
import {
  CRITERIOS, cargarAvance, conceptoPuntaje, difiere, filasPlanilla, formatoPuntaje, gruposPorVigilador, nombreEvaluador,
  nombrePeriodo, nombreVigilador, sinEvaluar, totalesAvance,
} from '@/lib/evaluacion-vigiladores'
import type { AvanceEvaluacion, ClaveCriterio, EvaluadorAvance } from '@/lib/evaluacion-vigiladores'

const VERDE = '#10b981'
const AMBAR = '#f59e0b'
const ROJO = '#f87171'
const GRIS = '#94a3b8'

export default function EvaluacionVigiladoresAvance() {
  const [periodo, setPeriodo] = useState<string | undefined>(undefined)
  const [avance, setAvance] = useState<AvanceEvaluacion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await cargarAvance(periodo)
    setAvance(r.avance)
    setError(r.error)
    setCargando(false)
  }, [periodo])

  useEffect(() => { void cargar() }, [cargar])

  return (
    <div>
      {/* Gerencia evalúa acá; a Administración no le aparece (no tiene a quién evaluar). */}
      <EvaluacionVigiladoresSupervisor onCambio={() => { void cargar() }} />
      {error && /sin permiso/i.test(error) && (
        <div style={{ ...caja, color: GRIS }}>
          El avance de la evaluación lo ven Administración y Gerencia. Los supervisores ven sólo sus evaluaciones, desde el celular.
        </div>
      )}
      {error && !/sin permiso/i.test(error) && (
        <div style={{ ...caja, color: '#fca5a5', borderColor: 'rgba(239,68,68,.35)' }}>
          No se pudo cargar el avance: {error}
        </div>
      )}
      {cargando && !avance && <div style={{ ...caja, color: GRIS }}>Cargando…</div>}
      {avance && (
        <VistaAvanceEvaluacion avance={avance} onPeriodo={setPeriodo} onActualizar={() => { void cargar() }} />
      )}
    </div>
  )
}

// ── Pieza visual sin datos ni efectos (se prueba con renderToStaticMarkup) ────

export type VistaPlanilla = 'planilla' | 'vigilador' | 'supervisor'

export function VistaAvanceEvaluacion({ avance, onPeriodo, onActualizar, vistaInicial = 'planilla', abiertoInicial = null }: {
  avance: AvanceEvaluacion
  onPeriodo: (p: string) => void
  onActualizar: () => void
  vistaInicial?: VistaPlanilla
  abiertoInicial?: string | null
}) {
  const [vista, setVista] = useState<VistaPlanilla>(vistaInicial)
  const [busqueda, setBusqueda] = useState('')
  const { hechas, total } = totalesAvance(avance)
  const filtro = busqueda.trim().toLowerCase()

  return (
    <div>
      <div style={{ ...caja, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <div style={{ flex: '1 1 260px' }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#e2e8f0' }}>
            Evaluación de vigiladores · {nombrePeriodo(avance.periodo)}
          </div>
          <div style={{ fontSize: 13, color: GRIS, marginTop: 4 }}>
            {hechas} de {total} evaluaciones hechas. Sólo informa: no mueve la nota mensual ni bloquea nada.
          </div>
          <Barra hechas={hechas} total={total} />
        </div>
        <label style={{ fontSize: 13, color: GRIS }}>
          Mes{' '}
          <select
            value={avance.periodo}
            onChange={e => onPeriodo(e.target.value)}
            style={{ background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '6px 8px' }}
          >
            {avance.periodos.map(p => <option key={p} value={p}>{nombrePeriodo(p)}</option>)}
          </select>
        </label>
        <button type="button" onClick={onActualizar} style={botonChico}>↻ Actualizar</button>
      </div>

      {!avance.es_mes_actual && (
        <div style={{ fontSize: 12.5, color: GRIS, margin: '-8px 0 14px' }}>
          Para un mes pasado, el total a evaluar se calcula con los turnos de hoy: es aproximado.
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        {([
          { id: 'planilla' as const, texto: 'Planilla (todas)' },
          { id: 'vigilador' as const, texto: 'Por vigilador' },
          { id: 'supervisor' as const, texto: 'Por supervisor' },
        ]).map(op => (
          <button
            key={op.id}
            type="button"
            onClick={() => setVista(op.id)}
            style={{
              ...botonChico,
              border: vista === op.id ? '1px solid #38bdf8' : '1px solid #334155',
              background: vista === op.id ? '#38bdf818' : '#1e293b',
              color: vista === op.id ? '#38bdf8' : '#e2e8f0',
            }}
          >
            {op.texto}
          </button>
        ))}
        <input
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar vigilador o supervisor…"
          style={{ flex: '1 1 200px', maxWidth: 320, background: '#0f172a', color: '#e2e8f0',
            border: '1px solid #334155', borderRadius: 8, padding: '7px 10px', fontSize: 13 }}
        />
      </div>

      {vista === 'planilla' && <Planilla avance={avance} filtro={filtro} />}
      {vista === 'vigilador' && <PorVigilador avance={avance} filtro={filtro} />}
      {vista === 'supervisor' && <PorSupervisor avance={avance} filtro={filtro} abiertoInicial={abiertoInicial} />}
    </div>
  )
}

function coincide(filtro: string, ...textos: Array<string | null | undefined>): boolean {
  if (!filtro) return true
  return textos.some(t => (t ?? '').toLowerCase().includes(filtro))
}

// ── Planilla: una fila por evaluación, como la R 6.2 en papel ────────────────

function Planilla({ avance, filtro }: { avance: AvanceEvaluacion; filtro: string }) {
  const filas = filasPlanilla(avance).filter(f =>
    coincide(filtro, nombreVigilador(f), f.legajo, f.evaluador))
  return (
    <Seccion titulo={`Planilla · ${filas.length} ${filas.length === 1 ? 'evaluación' : 'evaluaciones'}`}>
      {filas.length === 0 ? (
        <div style={{ color: GRIS, fontSize: 13 }}>
          {filtro ? 'Nada coincide con la búsqueda.' : `Todavía nadie evaluó en ${nombrePeriodo(avance.periodo)}.`}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tabla}>
            <thead>
              <tr>
                <th style={th}>Vigilador</th>
                <th style={th}>Legajo</th>
                <th style={th}>Evaluó</th>
                {CRITERIOS.map(c => <th key={c.clave} style={thNota} title={c.etiqueta}>{c.planilla}</th>)}
                <th style={thNota}>PUNTAJE</th>
                <th style={th}>Observaciones</th>
                <th style={th}>Plan de acción</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => (
                <tr key={`${f.vigilador_id}-${f.evaluador_id}`} style={filaBorde}>
                  <td style={{ ...td, fontWeight: 700 }}>{nombreVigilador(f)}</td>
                  <td style={td}>{f.legajo ?? '—'}</td>
                  <td style={td}>{f.evaluador}<div style={sub}>{f.rol_evaluador}</div></td>
                  <CeldasNotas f={f} />
                  <td style={tdTexto}>{f.observaciones ?? ''}</td>
                  <td style={tdTexto}>{f.plan_accion ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Seccion>
  )
}

// ── Por vigilador: todas sus evaluaciones, una debajo de la otra ─────────────

function PorVigilador({ avance, filtro }: { avance: AvanceEvaluacion; filtro: string }) {
  const grupos = gruposPorVigilador(avance).filter(g =>
    coincide(filtro, nombreVigilador(g), g.legajo, ...g.evaluaciones.map(e => e.evaluador)))
  const faltan = avance.es_mes_actual
    ? sinEvaluar(avance).filter(p => coincide(filtro, nombreVigilador(p), p.legajo, p.objetivo))
    : []
  return (
    <>
      <Seccion titulo={`Por vigilador · ${grupos.length} evaluados`}>
        {grupos.length === 0 && (
          <div style={{ color: GRIS, fontSize: 13 }}>
            {filtro ? 'Nada coincide con la búsqueda.' : `Todavía nadie evaluó en ${nombrePeriodo(avance.periodo)}.`}
          </div>
        )}
        {grupos.map(g => (
          <div key={g.vigilador_id} style={bloque}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'baseline', marginBottom: 6 }}>
              <div style={{ flex: '1 1 220px', fontWeight: 800, fontSize: 14.5, color: '#e2e8f0' }}>
                {nombreVigilador(g)}{g.legajo ? <span style={{ color: GRIS, fontWeight: 600 }}> · Legajo {g.legajo}</span> : null}
              </div>
              <div style={{ fontSize: 13, color: '#e2e8f0' }}>
                {g.evaluaciones.length} {g.evaluaciones.length === 1 ? 'evaluación' : 'evaluaciones'} · promedio{' '}
                <strong>{formatoPuntaje(g.promedio)}</strong> {conceptoPuntaje(g.promedio)}
              </div>
              {difiere({ cantidad: g.evaluaciones.length, minimo: g.minimo, maximo: g.maximo }) && (
                <div style={{ fontSize: 12.5, color: AMBAR, fontWeight: 700 }}>
                  Los evaluadores no coinciden ({formatoPuntaje(g.minimo)} – {formatoPuntaje(g.maximo)})
                </div>
              )}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={tabla}>
                <thead>
                  <tr>
                    <th style={th}>Evaluó</th>
                    {CRITERIOS.map(c => <th key={c.clave} style={thNota} title={c.etiqueta}>{c.planilla}</th>)}
                    <th style={thNota}>PUNTAJE</th>
                    <th style={th}>Observaciones</th>
                    <th style={th}>Plan de acción</th>
                  </tr>
                </thead>
                <tbody>
                  {g.evaluaciones.map(f => (
                    <tr key={f.evaluador_id} style={filaBorde}>
                      <td style={td}>{f.evaluador}<div style={sub}>{f.rol_evaluador}</div></td>
                      <CeldasNotas f={f} />
                      <td style={tdTexto}>{f.observaciones ?? ''}</td>
                      <td style={tdTexto}>{f.plan_accion ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </Seccion>
      {faltan.length > 0 && (
        <Seccion titulo={`Todavía nadie los evaluó · ${faltan.length}`}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {faltan.map(p => (
              <span key={p.vigilador_id} style={chip}>
                {nombreVigilador(p)}{p.objetivo ? <span style={{ color: GRIS }}> · {p.objetivo}</span> : null}
              </span>
            ))}
          </div>
        </Seccion>
      )}
    </>
  )
}

// ── Por supervisor: a quiénes evaluó y a quiénes le faltan ───────────────────

function PorSupervisor({ avance, filtro, abiertoInicial }: {
  avance: AvanceEvaluacion; filtro: string; abiertoInicial: string | null
}) {
  const [abierto, setAbierto] = useState<string | null>(abiertoInicial)
  const lista = avance.evaluadores.filter(e => coincide(filtro, nombreEvaluador(e), ...e.zonas))
  const grupos: Array<{ titulo: string; items: EvaluadorAvance[] }> = [
    { titulo: 'Supervisores', items: lista.filter(e => !e.es_gerencia && !e.es_administracion) },
    { titulo: 'Gerencia', items: lista.filter(e => e.es_gerencia) },
    { titulo: 'Administración', items: lista.filter(e => e.es_administracion) },
  ]
  return (
    <>
      {grupos.filter(g => g.items.length > 0).map(g => (
        <Seccion key={g.titulo} titulo={g.titulo}>
          {g.items.map(e => (
            <FilaEvaluador key={e.evaluador_id} e={e} abierto={abierto === e.evaluador_id}
              onToggle={() => setAbierto(abierto === e.evaluador_id ? null : e.evaluador_id)} />
          ))}
        </Seccion>
      ))}
      {lista.length === 0 && <div style={{ ...caja, color: GRIS, fontSize: 13 }}>Nada coincide con la búsqueda.</div>}
    </>
  )
}

function FilaEvaluador({ e, abierto, onToggle }: { e: EvaluadorAvance; abierto: boolean; onToggle: () => void }) {
  const total = Math.max(Number(e.total), Number(e.hechas))
  const hechas = Number(e.hechas)
  const completo = total > 0 && hechas >= total
  const color = completo ? VERDE : hechas === 0 ? ROJO : AMBAR
  const evaluaciones = [...e.evaluaciones].sort((a, b) => nombreVigilador(a).localeCompare(nombreVigilador(b), 'es'))
  return (
    <div style={bloque}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div style={{ fontWeight: 800, color: '#e2e8f0' }}>{nombreEvaluador(e)}</div>
          <div style={{ fontSize: 12.5, color: GRIS }}>
            {e.es_gerencia ? 'Gerencia · todos los vigiladores'
              : e.es_administracion ? 'Administración · evalúa cuando quiere'
              : (e.zonas.length ? e.zonas.join(', ') : 'Sin zona')}
          </div>
        </div>
        <div style={{ flex: '1 1 160px' }}>
          {e.es_administracion ? (
            <div style={{ fontSize: 13, color: VERDE, fontWeight: 700 }}>{hechas} {hechas === 1 ? 'evaluación' : 'evaluaciones'}</div>
          ) : (<>
            <div style={{ fontSize: 13, color, fontWeight: 700 }}>
              {hechas} de {total} · {e.es_gerencia ? `faltan ${total - hechas}` : (total - hechas === 1 ? 'le falta 1' : `le faltan ${total - hechas}`)}
            </div>
            <Barra hechas={hechas} total={total} color={color} />
          </>)}
        </div>
        <div style={{ flex: '0 1 170px', fontSize: 13, color: '#e2e8f0' }}>
          {e.promedio == null ? <span style={{ color: GRIS }}>Sin evaluaciones</span>
            : <>Pone en promedio <strong>{formatoPuntaje(Number(e.promedio))}</strong> {conceptoPuntaje(Number(e.promedio))}</>}
        </div>
        <button type="button" onClick={onToggle} style={botonChico}>{abierto ? 'Ocultar' : 'Ver lista'}</button>
      </div>

      {abierto && (
        <div style={{ marginTop: 12 }}>
          <div style={subtitulo}>Evaluó ({evaluaciones.length})</div>
          {evaluaciones.length === 0 ? (
            <div style={{ color: GRIS, fontSize: 13, marginBottom: 10 }}>Todavía no evaluó a nadie este mes.</div>
          ) : (
            <div style={{ overflowX: 'auto', marginBottom: 12 }}>
              <table style={tabla}>
                <thead>
                  <tr>
                    <th style={th}>Vigilador</th>
                    <th style={th}>Legajo</th>
                    {CRITERIOS.map(c => <th key={c.clave} style={thNota} title={c.etiqueta}>{c.planilla}</th>)}
                    <th style={thNota}>PUNTAJE</th>
                    <th style={th}>Observaciones</th>
                    <th style={th}>Plan de acción</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluaciones.map(ev => (
                    <tr key={ev.vigilador_id} style={filaBorde}>
                      <td style={{ ...td, fontWeight: 700 }}>
                        {nombreVigilador(ev)}
                        {ev.origen === 'supervision' && <div style={sub}>en supervisión</div>}
                      </td>
                      <td style={td}>{ev.legajo ?? '—'}</td>
                      <CeldasNotas f={ev} />
                      <td style={tdTexto}>{ev.observaciones ?? ''}</td>
                      <td style={tdTexto}>{ev.plan_accion ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!e.es_administracion && e.pendientes.length > 0 && (
            <>
              <div style={{ ...subtitulo, color: AMBAR }}>Le faltan ({e.pendientes.length})</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={tabla}>
                  <thead>
                    <tr><th style={th}>Vigilador</th><th style={th}>Legajo</th><th style={th}>Objetivo</th></tr>
                  </thead>
                  <tbody>
                    {e.pendientes.map(p => (
                      <tr key={p.vigilador_id} style={filaBorde}>
                        <td style={td}>{nombreVigilador(p)}</td>
                        <td style={td}>{p.legajo ?? '—'}</td>
                        <td style={td}>{p.objetivo ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Las siete notas + el puntaje, con color por nota. */
function CeldasNotas({ f }: { f: Record<ClaveCriterio, number> & { puntaje: number } }) {
  return (
    <>
      {CRITERIOS.map(c => (
        <td key={c.clave} style={{ ...tdNota, color: colorNota(Number(f[c.clave])) }}>{f[c.clave]}</td>
      ))}
      <td style={{ ...tdNota, fontWeight: 800, color: colorNota(Number(f.puntaje)), whiteSpace: 'nowrap' }}>
        {formatoPuntaje(Number(f.puntaje))}
        <div style={{ ...sub, color: GRIS }}>{conceptoPuntaje(Number(f.puntaje))}</div>
      </td>
    </>
  )
}

function colorNota(n: number): string {
  return n >= 8 ? VERDE : n >= 6 ? '#e2e8f0' : n >= 5 ? AMBAR : ROJO
}

function Barra({ hechas, total, color = VERDE }: { hechas: number; total: number; color?: string }) {
  const pct = total ? Math.min(100, Math.round((hechas / total) * 100)) : 0
  return (
    <div style={{ height: 6, background: '#1e293b', borderRadius: 3, marginTop: 6 }}>
      <div style={{ width: `${pct}%`, height: 6, background: color, borderRadius: 3 }} />
    </div>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={caja}>
      <div style={{ fontSize: 13, fontWeight: 800, color: GRIS, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>
        {titulo}
      </div>
      {children}
    </div>
  )
}

const caja: React.CSSProperties = {
  background: '#111827', border: '1px solid #1e2d42', borderRadius: 12, padding: 16, marginBottom: 16,
}
const bloque: React.CSSProperties = {
  background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: '10px 12px', marginBottom: 10,
}
const botonChico: React.CSSProperties = {
  background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 8,
  padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
}
const tabla: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 700, fontSize: 11.5, color: GRIS, textAlign: 'left', whiteSpace: 'nowrap' }
const thNota: React.CSSProperties = { ...th, textAlign: 'center' }
const td: React.CSSProperties = { padding: '7px 8px', color: '#e2e8f0', verticalAlign: 'top' }
const tdNota: React.CSSProperties = { ...td, textAlign: 'center', fontWeight: 700 }
const tdTexto: React.CSSProperties = { ...td, color: '#cbd5e1', fontSize: 12.5, minWidth: 160 }
const filaBorde: React.CSSProperties = { borderTop: '1px solid #1e293b' }
const sub: React.CSSProperties = { fontSize: 11.5, color: GRIS, fontWeight: 500 }
const subtitulo: React.CSSProperties = { fontSize: 12.5, fontWeight: 800, color: VERDE, margin: '4px 0 6px' }
const chip: React.CSSProperties = {
  background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '5px 9px', fontSize: 12.5, color: '#e2e8f0',
}
