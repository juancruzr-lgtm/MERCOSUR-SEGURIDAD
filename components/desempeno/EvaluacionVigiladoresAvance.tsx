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
  CRITERIOS, cargarAvance, conceptoPuntaje, difiere, formatoPuntaje, nombreEvaluador,
  nombrePeriodo, nombreVigilador, totalesAvance,
} from '@/lib/evaluacion-vigiladores'
import type { AvanceEvaluacion, EvaluadorAvance } from '@/lib/evaluacion-vigiladores'

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

export function VistaAvanceEvaluacion({ avance, onPeriodo, onActualizar, abiertoInicial = null }: {
  avance: AvanceEvaluacion
  onPeriodo: (p: string) => void
  onActualizar: () => void
  abiertoInicial?: string | null
}) {
  const [abierto, setAbierto] = useState<string | null>(abiertoInicial)
  const { hechas, total } = totalesAvance(avance)
  const supervisores = avance.evaluadores.filter(e => !e.es_gerencia && !e.es_administracion)
  const administracion = avance.evaluadores.filter(e => e.es_administracion)
  const gerencia = avance.evaluadores.filter(e => e.es_gerencia)

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

      <Seccion titulo="Por supervisor">
        {supervisores.length === 0 && <div style={{ color: GRIS, fontSize: 13 }}>No hay supervisores con zona asignada.</div>}
        {supervisores.map(e => (
          <FilaEvaluador key={e.evaluador_id} e={e} abierto={abierto === e.evaluador_id}
            onToggle={() => setAbierto(abierto === e.evaluador_id ? null : e.evaluador_id)} />
        ))}
      </Seccion>

      {gerencia.length > 0 && (
        <Seccion titulo="Gerencia">
          {gerencia.map(e => (
            <FilaEvaluador key={e.evaluador_id} e={e} abierto={abierto === e.evaluador_id}
              onToggle={() => setAbierto(abierto === e.evaluador_id ? null : e.evaluador_id)} />
          ))}
        </Seccion>
      )}

      {administracion.length > 0 && (
        <Seccion titulo="Administración">
          {administracion.map(e => (
            <FilaEvaluador key={e.evaluador_id} e={e} abierto={abierto === e.evaluador_id}
              onToggle={() => setAbierto(abierto === e.evaluador_id ? null : e.evaluador_id)} />
          ))}
        </Seccion>
      )}

      <Seccion titulo="Por vigilador">
        {avance.vigiladores.length === 0 ? (
          <div style={{ color: GRIS, fontSize: 13 }}>Todavía nadie evaluó en {nombrePeriodo(avance.periodo)}.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: GRIS, textAlign: 'left' }}>
                  <th style={th}>Vigilador</th>
                  <th style={th}>Legajo</th>
                  <th style={{ ...th, textAlign: 'center' }}>Evaluaciones</th>
                  <th style={th}>Promedio</th>
                  <th style={th}>Más baja – más alta</th>
                </tr>
              </thead>
              <tbody>
                {avance.vigiladores.map(v => (
                  <tr key={v.vigilador_id} style={{ borderTop: '1px solid #1e293b' }}>
                    <td style={td}>{nombreVigilador(v)}</td>
                    <td style={td}>{v.legajo ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'center' }}>{v.cantidad}</td>
                    <td style={td}>{formatoPuntaje(Number(v.promedio))} {conceptoPuntaje(Number(v.promedio))}</td>
                    <td style={{ ...td, color: difiere(v) ? AMBAR : '#e2e8f0' }}>
                      {v.cantidad > 1 ? `${formatoPuntaje(Number(v.minimo))} – ${formatoPuntaje(Number(v.maximo))}` : '—'}
                      {difiere(v) && <span style={{ fontWeight: 700 }}> · los supervisores no coinciden</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>
    </div>
  )
}

function FilaEvaluador({ e, abierto, onToggle }: { e: EvaluadorAvance; abierto: boolean; onToggle: () => void }) {
  const total = Math.max(Number(e.total), Number(e.hechas))
  const hechas = Number(e.hechas)
  const completo = total > 0 && hechas >= total
  const color = completo ? VERDE : hechas === 0 ? ROJO : AMBAR
  return (
    <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: '#e2e8f0' }}>{nombreEvaluador(e)}</div>
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
          <div style={{ fontSize: 13, color, fontWeight: 700 }}>{hechas} de {total}</div>
          <Barra hechas={hechas} total={total} color={color} />
          </>)}
        </div>
        <div style={{ flex: '0 1 150px', fontSize: 13, color: '#e2e8f0' }}>
          {e.promedio == null ? <span style={{ color: GRIS }}>Sin evaluaciones</span>
            : <>Pone en promedio <strong>{formatoPuntaje(Number(e.promedio))}</strong> {conceptoPuntaje(Number(e.promedio))}</>}
        </div>
        <button type="button" onClick={onToggle} style={botonChico}>{abierto ? 'Ocultar' : 'Ver detalle'}</button>
      </div>

      {abierto && (
        <div style={{ marginTop: 10, borderTop: '1px solid #1e293b', paddingTop: 10 }}>
          {e.evaluaciones.length === 0 && <div style={{ color: GRIS, fontSize: 13 }}>Todavía no evaluó a nadie este mes.</div>}
          {e.evaluaciones.map(ev => (
            <div key={ev.vigilador_id} style={{ padding: '6px 0', borderBottom: '1px solid #16213a', fontSize: 13 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', color: '#e2e8f0' }}>
                <strong style={{ flex: 1 }}>{nombreVigilador(ev)}{ev.legajo ? ` · ${ev.legajo}` : ''}</strong>
                <span style={{ color: VERDE, fontWeight: 700 }}>
                  {formatoPuntaje(Number(ev.puntaje))} {conceptoPuntaje(Number(ev.puntaje))}
                </span>
              </div>
              <div style={{ color: GRIS, fontSize: 12.5 }}>
                {CRITERIOS.map(c => `${c.planilla} ${ev[c.clave]}`).join(' · ')}
                {ev.origen === 'supervision' ? ' · en supervisión' : ''}
              </div>
              {ev.observaciones && <div style={{ color: '#cbd5e1', fontSize: 12.5 }}>Observaciones: {ev.observaciones}</div>}
              {ev.plan_accion && <div style={{ color: '#cbd5e1', fontSize: 12.5 }}>Plan de acción: {ev.plan_accion}</div>}
            </div>
          ))}
          {!e.es_administracion && e.pendientes.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12.5, color: AMBAR }}>
              Le faltan ({e.pendientes.length}): <span style={{ color: '#cbd5e1' }}>{e.pendientes.map(p => nombreVigilador(p)).join('; ')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
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
const botonChico: React.CSSProperties = {
  background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 8,
  padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
}
const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 700, fontSize: 12.5 }
const td: React.CSSProperties = { padding: '7px 8px', color: '#e2e8f0' }
