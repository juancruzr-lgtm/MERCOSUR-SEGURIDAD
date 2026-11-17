'use client'

/**
 * Un mes, en simple: pocas cifras grandes comparadas con el mes anterior y
 * "dónde mirar" (los 3 objetivos/personas que más pesan). Sólo lectura.
 */

import { useMemo, useState, type CSSProperties } from 'react'
import type { DatosHistorico } from '@/lib/tablero-gerencia/cargar'
import { filasHistoricas, rankingMes, variacion, valor, INDICADORES, type FilaMes, type Indicador } from '@/lib/tablero-gerencia/historico'

const C = { panel: '#0b1220', fondo: '#0f172a', borde: '#1e293b', texto: '#e2e8f0', sub: '#94a3b8', verde: '#22c55e', rojo: '#f87171' }
const sub: CSSProperties = { fontSize: 13, color: C.sub }
const card: CSSProperties = { background: C.panel, border: `1px solid ${C.borde}`, borderRadius: 10, padding: 14, marginBottom: 12 }
const nombreMes = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
const n = (x: number) => x.toLocaleString('es-AR', { maximumFractionDigits: 0 })

const PRINCIPALES: Indicador['clave'][] = ['horas', 'sinFichaje', 'tarde', 'supervisiones', 'facturado']

export default function ResumenDelMes({ datos, objetivos, guardias, objetivosPermitidos, verEconomico }: {
  datos: DatosHistorico
  objetivos: { id: string; nombre?: string | null; es_prueba?: boolean | null }[]
  guardias: { id: string; nombre?: string | null; apellido?: string | null }[]
  objetivosPermitidos: ReadonlySet<string> | null
  verEconomico: boolean
}) {
  const objetivoValido = useMemo(() => {
    const prueba = new Set(objetivos.filter(o => o.es_prueba).map(o => o.id))
    return (id: string | null) => !!id && !prueba.has(id) && (objetivosPermitidos === null || objetivosPermitidos.has(id))
  }, [objetivos, objetivosPermitidos])
  const ahoraIso = useMemo(() => new Date().toISOString(), [datos])
  const filas = useMemo(() => filasHistoricas({ ahoraIso, ...datos, objetivoValido }).filter(f => f.conFichaje + f.ausencias > 0), [datos, ahoraIso, objetivoValido])
  const completos = filas.filter(f => !f.parcial)
  const [mes, setMes] = useState<string>(() => completos[completos.length - 1]?.mes ?? filas[filas.length - 1]?.mes ?? '')
  const i = filas.findIndex(f => f.mes === mes)
  const actual: FilaMes | undefined = filas[i]
  const anterior: FilaMes | undefined = i > 0 ? filas[i - 1] : undefined
  const r = useMemo(() => rankingMes({ mes, ahoraIso, turnos: datos.turnos, registros: datos.registros, supervisiones: datos.supervisiones, objetivoValido }), [mes, ahoraIso, datos, objetivoValido])

  const nombreObj = (id: string) => objetivos.find(o => o.id === id)?.nombre ?? 'Objetivo'
  const nombrePer = (id: string) => { const g = guardias.find(x => x.id === id); return g ? `${g.nombre ?? ''} ${g.apellido ?? ''}`.trim() : 'Persona' }

  if (!actual) return <div style={card}><div style={sub}>No hay meses con datos para mostrar.</div></div>

  const tarjetas = INDICADORES.filter(ind => PRINCIPALES.includes(ind.clave) && (ind.clave !== 'facturado' || (verEconomico && actual.facturado != null)))

  return (
    <div style={{ color: C.texto }}>
      <div style={{ ...card, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={sub}>Mes</span>
        <select value={mes} onChange={e => setMes(e.target.value)} style={{ background: C.fondo, color: C.texto, border: `1px solid ${C.borde}`, borderRadius: 8, padding: '8px 10px', fontSize: 15 }}>
          {filas.slice().reverse().map(f => <option key={f.mes} value={f.mes}>{nombreMes(f.mes)}{f.parcial ? ' (en curso)' : ''}</option>)}
        </select>
        {actual.parcial && <span style={sub}>Mes en curso: comparado con todo el mes anterior, todavía va a subir.</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
        {tarjetas.map(ind => {
          const v = valor(actual, ind.clave)
          const d = anterior ? variacion(v, valor(anterior, ind.clave), ind) : null
          const texto = ind.formato === 'pesos' ? (v ?? 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }) : n(v ?? 0)
          return (
            <div key={ind.clave} style={{ ...card, marginBottom: 0 }}>
              <div style={sub}>{ind.titulo}</div>
              <div style={{ fontSize: 28, fontWeight: 700, margin: '4px 0' }}>{texto}</div>
              {d && anterior && !actual.parcial && (
                <div style={{ fontSize: 13, color: d.mejora == null ? C.sub : d.mejora ? C.verde : C.rojo }}>
                  {d.delta === 0 ? 'Igual que' : `${d.delta > 0 ? '▲' : '▼'} ${d.pct != null ? `${Math.abs(d.pct)} %` : n(Math.abs(d.delta))} ${d.delta > 0 ? 'más' : 'menos'} que`} {nombreMes(anterior.mes).split(' ')[0]}
                  {d.mejora != null && <span style={{ color: C.sub }}> · {d.mejora ? 'mejor' : 'peor'}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 10px', fontSize: 16 }}>Dónde mirar en {nombreMes(mes).split(' ')[0]}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          <Lista titulo="Objetivos con más turnos sin fichaje" vacio="Ninguno" items={r.objetivosSinFichaje.map(x => `${nombreObj(x.id)} — ${x.n} de ${x.de} turnos`)} />
          <Lista titulo="Personas que más llegaron tarde" vacio="Nadie" items={r.personasTarde.map(x => `${nombrePer(x.id)} — ${x.n} ${x.n === 1 ? 'vez' : 'veces'}`)} />
          <Lista titulo="Objetivos con menos visitas de supervisión" vacio="—" items={r.objetivosPocaSupervision.map(x => `${nombreObj(x.id)} — ${x.visitas} ${x.visitas === 1 ? 'visita' : 'visitas'}`)} />
        </div>
        <div style={{ ...sub, marginTop: 10, fontSize: 12 }}>Sin fichaje incluye turnos cargados a mano. Antes de concluir algo sobre una persona, conviene revisar el caso.</div>
      </div>
    </div>
  )
}

function Lista({ titulo, items, vacio }: { titulo: string; items: string[]; vacio: string }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: C.sub, marginBottom: 6 }}>{titulo}</div>
      {items.length === 0 ? <div style={{ fontSize: 14 }}>{vacio}</div>
        : <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 14 }}>{items.map(t => <li key={t}>{t}</li>)}</ol>}
    </div>
  )
}
