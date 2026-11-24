'use client'

/**
 * components/supervisor/EvaluacionVigiladoresSupervisor.tsx
 *
 * La evaluación mensual de vigiladores en el celular del supervisor
 * (planilla R 6.2 (3), pedido de JC del 24/11/2026).
 *
 * ── Insiste sin bloquear ─────────────────────────────────────────────────────
 * Mientras queden vigiladores sin evaluar en el mes, la tarjeta queda fija en
 * Inicio y no se puede esconder. No tapa nada ni traba alertas, turnos ni
 * fichajes: mismo criterio que el Estatuto.
 *
 * ── Qué ve ───────────────────────────────────────────────────────────────────
 * Sólo los vigiladores de su zona y sólo sus propias evaluaciones (lo garantiza
 * la base). Puede corregir la del mes hasta que termine el mes.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  AYUDA_PLAN_ACCION, CRITERIOS, avance, cargarListaDelMes, conceptoPuntaje,
  criteriosDe, criteriosFaltantes, formatoPuntaje, guardarEvaluacion, nombrePeriodo,
  nombreVigilador, puntajeDe,
} from '@/lib/evaluacion-vigiladores'
import type { ClaveCriterio, Criterios, ListaDelMes, VigiladorAEvaluar } from '@/lib/evaluacion-vigiladores'

const VERDE = '#10b981'
const AMBAR = '#f59e0b'

/**
 * La usan el supervisor (Inicio de SupervisorMobile) y Gerencia (solapa de
 * avance en Administración). Con `onCambio`, quien la monta se entera de cada
 * evaluación guardada para refrescar lo suyo.
 */
export default function EvaluacionVigiladoresSupervisor({ onCambio }: { onCambio?: () => void } = {}) {
  const [lista, setLista] = useState<ListaDelMes | null>(null)
  const [abierta, setAbierta] = useState(false)
  const [elegido, setElegido] = useState<VigiladorAEvaluar | null>(null)

  const cargar = useCallback(async () => {
    const { lista: l, error } = await cargarListaDelMes()
    // Ante un error no se muestra nada: no se le pide algo que quizás ya hizo.
    setLista(error ? null : l)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  useEffect(() => {
    const alVolver = () => { if (document.visibilityState === 'visible') void cargar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [cargar])

  if (!lista || lista.vigiladores.length === 0) return null

  return (
    <>
      <TarjetaEvaluacionVigiladores lista={lista} onAbrir={() => setAbierta(true)} />
      {abierta && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Evaluación de vigiladores"
          style={{
            position: 'fixed', inset: 0, zIndex: 998, background: '#0b1220',
            overflowY: 'auto', padding: '14px 14px 40px', color: '#e2e8f0',
          }}
        >
          <div style={{ maxWidth: 520, margin: '0 auto' }}>
            {elegido ? (
              <FormularioEvaluacion
                periodo={lista.periodo}
                vigilador={elegido}
                onVolver={() => setElegido(null)}
                onGuardado={async () => { setElegido(null); await cargar(); onCambio?.() }}
              />
            ) : (
              <ListaEvaluacion lista={lista} onElegir={setElegido} onCerrar={() => setAbierta(false)} />
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ── Piezas visuales sin datos ni efectos (se prueban con renderToStaticMarkup) ──

export function TarjetaEvaluacionVigiladores({ lista, onAbrir }: {
  lista: ListaDelMes
  onAbrir: () => void
}) {
  const { hechas, total, pendientes } = avance(lista)
  const completa = pendientes === 0
  const color = completa ? VERDE : AMBAR
  return (
    <section
      aria-label="Evaluación mensual de vigiladores"
      style={{
        background: completa ? 'rgba(16,185,129,.06)' : 'rgba(245,158,11,.08)',
        border: `1px solid ${completa ? 'rgba(16,185,129,.35)' : 'rgba(245,158,11,.45)'}`,
        borderLeft: `4px solid ${color}`, borderRadius: 10, padding: '14px 14px 12px',
        marginBottom: 12, color: '#e2e8f0',
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 14.5, color, marginBottom: 4 }}>
        {completa
          ? `Evaluación de ${nombrePeriodo(lista.periodo)}: completa`
          : pendientes === 1
            ? `Te falta evaluar 1 vigilador de ${nombrePeriodo(lista.periodo)}`
            : `Te faltan evaluar ${pendientes} vigiladores de ${nombrePeriodo(lista.periodo)}`}
      </div>
      <div style={{ fontSize: 13, color: '#cbd5e1' }}>
        {hechas} de {total} hechas · se puede corregir hasta el {fechaCorta(lista.cierra)}
      </div>
      <div style={{ height: 6, background: '#1e293b', borderRadius: 3, margin: '10px 0' }}>
        <div style={{ width: `${total ? Math.round((hechas / total) * 100) : 0}%`, height: 6, background: color, borderRadius: 3 }} />
      </div>
      <button
        type="button"
        onClick={onAbrir}
        style={{
          width: '100%', background: completa ? 'transparent' : AMBAR,
          color: completa ? VERDE : '#1a1205', border: completa ? `1px solid ${VERDE}` : 'none',
          borderRadius: 8, padding: '10px 12px', fontSize: 14, fontWeight: 800, cursor: 'pointer',
        }}
      >
        {completa ? 'Ver o corregir' : 'Evaluar'}
      </button>
    </section>
  )
}

export function ListaEvaluacion({ lista, onElegir, onCerrar }: {
  lista: ListaDelMes
  onElegir: (v: VigiladorAEvaluar) => void
  onCerrar: () => void
}) {
  const { hechas, total } = avance(lista)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <div style={{ flex: 1, fontSize: 18, fontWeight: 800 }}>Evaluación de {nombrePeriodo(lista.periodo)}</div>
        <button type="button" onClick={onCerrar} style={botonSecundario}>Cerrar</button>
      </div>
      <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>
        {hechas} de {total} hechas. Sólo ves tus evaluaciones.
      </div>
      {lista.vigiladores.map(v => (
        <button
          key={v.vigilador_id}
          type="button"
          onClick={() => onElegir(v)}
          style={{
            display: 'flex', width: '100%', textAlign: 'left', alignItems: 'center', gap: 10,
            background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10,
            padding: '10px 12px', marginBottom: 8, color: '#e2e8f0', cursor: 'pointer',
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>{nombreVigilador(v)}</span>
            <span style={{ display: 'block', fontSize: 12.5, color: '#94a3b8' }}>
              {[v.legajo ? `Legajo ${v.legajo}` : null, v.objetivo].filter(Boolean).join(' · ')}
            </span>
          </span>
          {v.evaluacion ? (
            <span style={{ fontSize: 13, color: VERDE, fontWeight: 700, whiteSpace: 'nowrap' }}>
              {formatoPuntaje(v.evaluacion.puntaje)} {conceptoPuntaje(v.evaluacion.puntaje)}
            </span>
          ) : (
            <span style={{ fontSize: 13, color: AMBAR, fontWeight: 700 }}>Evaluar ›</span>
          )}
        </button>
      ))}
    </div>
  )
}

function FormularioEvaluacion({ periodo, vigilador, onVolver, onGuardado }: {
  periodo: string
  vigilador: VigiladorAEvaluar
  onVolver: () => void
  onGuardado: () => Promise<void>
}) {
  const [criterios, setCriterios] = useState<Criterios>(() => criteriosDe(vigilador.evaluacion))
  const [observaciones, setObservaciones] = useState(vigilador.evaluacion?.observaciones ?? '')
  const [planAccion, setPlanAccion] = useState(vigilador.evaluacion?.plan_accion ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const guardar = async () => {
    const faltan = criteriosFaltantes(criterios)
    if (faltan.length > 0) { setError(`Falta calificar: ${faltan.join(', ')}`); return }
    setGuardando(true)
    setError(null)
    const r = await guardarEvaluacion({ vigiladorId: vigilador.vigilador_id, criterios, observaciones, planAccion })
    setGuardando(false)
    if (r.error) { setError(r.error); return }
    await onGuardado()
  }

  return (
    <VistaFormularioEvaluacion
      periodo={periodo}
      vigilador={vigilador}
      criterios={criterios}
      observaciones={observaciones}
      planAccion={planAccion}
      guardando={guardando}
      error={error}
      onCriterio={(clave, valor) => { setCriterios(c => ({ ...c, [clave]: valor })); setError(null) }}
      onObservaciones={setObservaciones}
      onPlanAccion={setPlanAccion}
      onGuardar={() => { void guardar() }}
      onVolver={onVolver}
    />
  )
}

export function VistaFormularioEvaluacion(p: {
  periodo: string
  vigilador: VigiladorAEvaluar
  criterios: Criterios
  observaciones: string
  planAccion: string
  guardando: boolean
  error: string | null
  onCriterio: (clave: ClaveCriterio, valor: number) => void
  onObservaciones: (v: string) => void
  onPlanAccion: (v: string) => void
  onGuardar: () => void
  onVolver: () => void
}) {
  const puntaje = puntajeDe(p.criterios)
  return (
    <div>
      <button type="button" onClick={p.onVolver} style={{ ...botonSecundario, marginBottom: 10 }}>‹ Volver a la lista</button>
      <div style={{ fontSize: 18, fontWeight: 800 }}>{nombreVigilador(p.vigilador)}</div>
      <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 14 }}>
        {nombrePeriodo(p.periodo)}{p.vigilador.objetivo ? ` · ${p.vigilador.objetivo}` : ''} · de 1 a 10
      </div>

      {CRITERIOS.map(c => (
        <fieldset key={c.clave} style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
          <legend style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 6, color: '#e2e8f0' }}>{c.etiqueta}</legend>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 4 }}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map(n => {
              const activo = p.criterios[c.clave] === n
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={activo}
                  aria-label={`${c.etiqueta}: ${n}`}
                  onClick={() => p.onCriterio(c.clave, n)}
                  style={{
                    padding: '8px 0', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    background: activo ? '#38bdf8' : '#0f172a',
                    color: activo ? '#04202e' : '#cbd5e1',
                    border: `1px solid ${activo ? '#38bdf8' : '#1e293b'}`,
                  }}
                >
                  {n}
                </button>
              )
            })}
          </div>
        </fieldset>
      ))}

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        borderTop: '1px solid #1e293b', paddingTop: 10, margin: '4px 0 12px',
      }}>
        <span style={{ color: '#94a3b8', fontSize: 13.5 }}>Puntaje (promedio)</span>
        <span style={{ fontSize: 20, fontWeight: 800 }}>
          {puntaje === null ? '—' : `${formatoPuntaje(puntaje)} ${conceptoPuntaje(puntaje)}`}
        </span>
      </div>

      <label style={etiquetaTexto}>
        Observaciones
        <textarea value={p.observaciones} maxLength={2000} rows={3}
          onChange={e => p.onObservaciones(e.target.value)} style={campoTexto} />
      </label>
      <label style={etiquetaTexto}>
        Plan de acción / seguimiento
        <textarea value={p.planAccion} maxLength={2000} rows={3} placeholder={AYUDA_PLAN_ACCION}
          onChange={e => p.onPlanAccion(e.target.value)} style={campoTexto} />
      </label>

      {p.error && <div role="alert" style={{ color: '#f87171', fontSize: 13, margin: '4px 0 8px' }}>{p.error}</div>}

      <button
        type="button"
        onClick={p.onGuardar}
        disabled={p.guardando}
        style={{
          width: '100%', background: '#38bdf8', color: '#04202e', border: 'none', borderRadius: 8,
          padding: '12px', fontSize: 15, fontWeight: 800, cursor: 'pointer', opacity: p.guardando ? 0.6 : 1,
        }}
      >
        {p.guardando ? 'Guardando…' : p.vigilador.evaluacion ? 'Guardar corrección' : 'Guardar evaluación'}
      </button>
    </div>
  )
}

function fechaCorta(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

const botonSecundario: React.CSSProperties = {
  background: 'transparent', color: '#cbd5e1', border: '1px solid #334155',
  borderRadius: 8, padding: '6px 10px', fontSize: 13, cursor: 'pointer',
}

const etiquetaTexto: React.CSSProperties = {
  display: 'block', fontSize: 13.5, fontWeight: 700, color: '#e2e8f0', marginBottom: 10,
}

const campoTexto: React.CSSProperties = {
  display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 6,
  background: '#0f172a', color: '#e2e8f0', border: '1px solid #1e293b', borderRadius: 8,
  padding: 8, fontSize: 14, fontFamily: 'inherit', fontWeight: 400,
}
