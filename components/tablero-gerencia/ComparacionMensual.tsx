'use client'

/**
 * Comparación de todos los meses con datos, en pocas cifras y en palabras.
 * Sólo lectura. Respeta el alcance del usuario (objetivos permitidos) y deja
 * afuera los objetivos de prueba.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { cargarHistorico, type DatosHistorico } from '@/lib/tablero-gerencia/cargar'
import { filasHistoricas, INDICADORES, resumenEnPalabras, valor, variacion, type FilaMes, type Indicador } from '@/lib/tablero-gerencia/historico'

const C = { fondo: '#0f172a', panel: '#0b1220', borde: '#1e293b', texto: '#e2e8f0', sub: '#94a3b8', azul: '#2563eb', verde: '#22c55e', rojo: '#f87171' }
const sub: CSSProperties = { fontSize: 12, color: C.sub }
const card: CSSProperties = { background: C.panel, border: `1px solid ${C.borde}`, borderRadius: 10, padding: 14, marginBottom: 12 }
const DESDE = '2026-03-01'

const nombreMes = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('es-AR', { month: 'short', year: '2-digit' })
function formato(v: number | null, f: Indicador['formato']): string {
  if (v == null) return '—'
  if (f === 'pct') return `${v.toLocaleString('es-AR')} %`
  if (f === 'pesos') return v.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
  return v.toLocaleString('es-AR', { maximumFractionDigits: 0 })
}

export default function ComparacionMensual({ objetivos, objetivosPermitidos, verEconomico, cargar = cargarHistorico }: {
  objetivos: { id: string; es_prueba?: boolean | null }[]
  objetivosPermitidos: ReadonlySet<string> | null
  verEconomico: boolean
  cargar?: typeof cargarHistorico
}) {
  const [datos, setDatos] = useState<DatosHistorico | null>(null)
  const [progreso, setProgreso] = useState('Cargando…')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    cargar(supabase, { desde: DESDE, conEconomico: verEconomico, onProgreso: t => vivo && setProgreso(t) })
      .then(d => { if (vivo) setDatos(d) })
      .catch(e => { if (vivo) setError(e?.message ?? String(e)) })
    return () => { vivo = false }
  }, [cargar, verEconomico])

  const { filas, palabras, sinFichajes } = useMemo(() => {
    if (!datos) return { filas: [] as FilaMes[], palabras: [] as string[], sinFichajes: [] as string[] }
    const prueba = new Set(objetivos.filter(o => o.es_prueba).map(o => o.id))
    const objetivoValido = (id: string | null) => !!id && !prueba.has(id) && (objetivosPermitidos === null || objetivosPermitidos.has(id))
    const ahora = new Date()
    const filas = filasHistoricas({ ahoraIso: ahora.toISOString(), ...datos, objetivoValido })
    // Mes anterior cortado al mismo momento, para comparar el mes en curso.
    const unMesAtras = new Date(ahora); unMesAtras.setMonth(unMesAtras.getMonth() - 1)
    const mesPrev = unMesAtras.toISOString().slice(0, 7)
    const corte = filasHistoricas({
      ahoraIso: unMesAtras.toISOString(), ...datos,
      turnos: datos.turnos.filter(t => t.fecha.slice(0, 7) === mesPrev),
      supervisiones: [], alertasRonda: [], facturacion: null, objetivoValido,
    }).find(f => f.mes === mesPrev) ?? null
    // Meses sin fichajes cargados (antes de usar la app) no se comparan: darían 0 horas.
    const conDatos = filas.filter(f => f.conFichaje + f.ausencias > 0)
    return { filas: conDatos, palabras: resumenEnPalabras(conDatos, corte), sinFichajes: filas.filter(f => f.turnos > 0 && f.conFichaje + f.ausencias === 0).map(f => f.mes) }
  }, [datos, objetivos, objetivosPermitidos])

  if (error) return <div style={{ ...card, color: C.rojo }}>No se pudo cargar: {error}</div>
  if (!datos) return <div style={card}><div style={sub}>{progreso}</div></div>

  const maxHoras = Math.max(1, ...filas.map(f => f.horas))
  const indicadores = INDICADORES.filter(i => i.clave !== 'facturado' || verEconomico)

  return (
    <div style={{ color: C.texto }}>
      <div style={card}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Cómo vamos, mes a mes</h3>
        {palabras.length === 0 ? <div style={sub}>Todavía no hay dos meses completos para comparar.</div>
          : <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 14 }}>{palabras.map(p => <li key={p}>{p}</li>)}</ul>}
      </div>

      <div style={card}>
        <div style={{ ...sub, marginBottom: 6 }}>Horas trabajadas por mes</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140, overflowX: 'auto' }}>
          {filas.map(f => (
            <div key={f.mes} style={{ flex: '1 0 44px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
              <div style={{ fontSize: 11, color: C.sub }}>{formato(f.horas, 'horas')}</div>
              <div title={`${f.mes}: ${f.horas} h`} style={{ width: '100%', maxWidth: 48, height: `${(f.horas / maxHoras) * 100}%`, minHeight: 2, background: f.parcial ? '#1d4ed8' : C.azul, opacity: f.parcial ? 0.6 : 1, borderRadius: 4 }} />
              <div style={{ fontSize: 11 }}>{nombreMes(f.mes)}{f.parcial ? '*' : ''}</div>
            </div>
          ))}
        </div>
        {filas.some(f => f.parcial) && <div style={{ ...sub, marginTop: 4 }}>* mes en curso, todavía incompleto</div>}
      </div>

      <div style={card}>
        <div style={{ ...sub, marginBottom: 6 }}>Comparación completa · ▲▼ contra el mes anterior (verde = mejoró, rojo = empeoró)</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', fontSize: 12, color: C.sub, padding: '6px 8px', position: 'sticky', left: 0, background: C.panel }}> </th>
                {filas.map(f => <th key={f.mes} style={{ fontSize: 12, color: C.sub, padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>{nombreMes(f.mes)}{f.parcial ? '*' : ''}</th>)}
              </tr>
            </thead>
            <tbody>
              {indicadores.map(ind => (
                <tr key={ind.clave}>
                  <td style={{ fontSize: 13, padding: '8px', borderTop: `1px solid ${C.borde}`, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: C.panel }}>{ind.titulo}</td>
                  {filas.map((f, i) => {
                    const v = valor(f, ind.clave)
                    const prev = i > 0 && !f.parcial ? valor(filas[i - 1], ind.clave) : null
                    const d = variacion(v, prev, ind)
                    return (
                      <td key={f.mes} style={{ fontSize: 13, padding: '8px', borderTop: `1px solid ${C.borde}`, textAlign: 'right', whiteSpace: 'nowrap', opacity: f.parcial ? 0.75 : 1 }}>
                        {formato(v, ind.formato)}
                        {d && d.delta !== 0 && <span style={{ marginLeft: 4, fontSize: 11, color: d.mejora ? C.verde : C.rojo }}>{d.delta > 0 ? '▲' : '▼'}{d.pct != null ? `${Math.abs(d.pct)}%` : ''}</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ ...sub, marginTop: 8, display: 'grid', gap: 2 }}>
          {filas.filter(f => f.avisos.length && !f.parcial).map(f => <div key={f.mes}>{nombreMes(f.mes)}: {f.avisos.join(' · ')}</div>)}
          {sinFichajes.length > 0 && <div>{sinFichajes.map(nombreMes).join(', ')}: hay turnos programados pero no fichajes en la app, por eso no se comparan.</div>}
          <div>"Turnos sin fichaje" incluye los que se cargaron o confirmaron a mano sin que el vigilador fichara la entrada.</div>
          <div>Sólo turnos ya terminados. Horas con la misma regla que la liquidación. "Fichajes fuera del lugar" puede incluir errores de GPS o de configuración del objetivo: no son faltas por sí solos.</div>
        </div>
      </div>
    </div>
  )
}
