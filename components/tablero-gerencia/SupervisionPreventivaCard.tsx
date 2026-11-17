'use client'

/**
 * Supervisión preventiva dentro del Tablero de Gerencia (sólo lectura).
 * Tres dimensiones separadas: cobertura preventiva, calidad de la visita y
 * efectividad correctiva. Una visita sin observaciones no resta.
 */

import { useMemo, useState, type CSSProperties } from 'react'
import { coberturaPreventiva, type ClasePreventiva, type CoberturaObjetivo, type SupervisionVisita, type TurnoFranja } from '@/lib/tablero-gerencia/supervision-preventiva'
import type { Caso } from '@/lib/tablero-gerencia/casos'

const C = { fondo: '#0f172a', borde: '#1e293b', texto: '#e2e8f0', sub: '#94a3b8', azul: '#2563eb', ambar: '#f59e0b', rojo: '#ef4444', verde: '#22c55e' }
const sub: CSSProperties = { fontSize: 12, color: C.sub }
const th: CSSProperties = { textAlign: 'left', fontSize: 11, color: C.sub, fontWeight: 600, padding: '6px 8px', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }
const td: CSSProperties = { fontSize: 13, color: C.texto, padding: '6px 8px', borderBottom: `1px solid ${C.borde}`, verticalAlign: 'top' }
const num: CSSProperties = { ...td, textAlign: 'right' }

const ETIQUETA_CLASE: Record<ClasePreventiva, string> = { adecuada: 'Adecuada', insuficiente: 'Insuficiente', excesiva: 'Concentrada', sin_visitas: 'Sin visitas' }
const COLOR_CLASE: Record<ClasePreventiva, string> = { adecuada: C.verde, insuficiente: C.ambar, excesiva: C.azul, sin_visitas: C.rojo }

function Tile({ titulo, valor, detalle, color, onClick, activo }: { titulo: string; valor: string | number; detalle?: string; color?: string; onClick?: () => void; activo?: boolean }) {
  return (
    <button onClick={onClick} disabled={!onClick} style={{
      textAlign: 'left', background: activo ? '#13213d' : C.fondo, border: `1px solid ${activo ? C.azul : C.borde}`, borderRadius: 8,
      padding: '10px 12px', minWidth: 150, flex: '1 1 150px', cursor: onClick ? 'pointer' : 'default', color: C.texto,
    }}>
      <div style={sub}>{titulo}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? C.texto }}>{valor}</div>
      {detalle && <div style={sub}>{detalle}</div>}
    </button>
  )
}

const hace = (h: number | null) => h == null ? '—' : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} días`

export default function SupervisionPreventivaCard({ mes, objetivos, supervisiones, turnos, casos, nombre }: {
  mes: string
  objetivos: { id: string; nombre?: string | null; frecuencia_supervision_horas?: number | null }[]
  supervisiones: SupervisionVisita[]
  turnos: TurnoFranja[]
  casos: Caso[]
  nombre: (id: string) => string
}) {
  const [filtro, setFiltro] = useState<{ titulo: string; f: (o: CoberturaObjetivo) => boolean } | null>(null)
  const [verSup, setVerSup] = useState(false)

  const r = useMemo(() => {
    const [y, m] = mes.split('-').map(Number)
    const desde = new Date(Date.UTC(y, m - 1, 1, 3)).getTime()
    const finMes = new Date(Date.UTC(y, m, 1, 3)).getTime()
    const hasta = Math.min(finMes, Date.now())
    return coberturaPreventiva({
      desdeIso: new Date(desde).toISOString(),
      hastaIso: new Date(Math.max(desde, hasta)).toISOString(),
      objetivos: objetivos.map(o => ({ id: o.id, nombre: o.nombre ?? '—', frecuencia_supervision_horas: o.frecuencia_supervision_horas ?? null })),
      supervisiones,
      turnos,
      casos,
    })
  }, [mes, objetivos, supervisiones, turnos, casos])

  const t = r.totales
  const abrir = (titulo: string, f: (o: CoberturaObjetivo) => boolean) => setFiltro(v => v?.titulo === titulo ? null : { titulo, f })
  const filas = (filtro ? r.objetivos.filter(filtro.f) : r.objetivos)
    .slice().sort((a, b) => ['sin_visitas', 'insuficiente', 'excesiva', 'adecuada'].indexOf(a.clase) - ['sin_visitas', 'insuficiente', 'excesiva', 'adecuada'].indexOf(b.clase) || (a.cumplimiento ?? 0) - (b.cumplimiento ?? 0))

  return (
    <div style={{ background: '#0b1220', border: `1px solid ${C.borde}`, borderRadius: 10, padding: 14, marginBottom: 12 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 15, color: C.texto }}>Supervisión preventiva</h3>
      <div style={{ ...sub, marginBottom: 8 }}>La presencia del supervisor previene problemas: una visita sin observaciones cuenta como visita bien hecha. La frecuencia esperada es la de cada objetivo.</div>

      <div style={{ ...sub, fontWeight: 600, margin: '6px 0' }}>1 · Cobertura preventiva</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Tile titulo="Visitas del mes" valor={t.visitas} detalle={`${t.pctNocturnas ?? 0} % de noche · ${t.pctFinde ?? 0} % fin de semana`} onClick={() => abrir('Todos los objetivos', () => true)} activo={filtro?.titulo === 'Todos los objetivos'} />
        <Tile titulo="Objetivos con cobertura adecuada" valor={`${t.adecuados} de ${t.objetivosEvaluados}`} color={C.verde} onClick={() => abrir('Cobertura adecuada', o => o.clase === 'adecuada')} activo={filtro?.titulo === 'Cobertura adecuada'} />
        <Tile titulo="Supervisión insuficiente" valor={t.insuficientes + t.sinVisitas} detalle={`${t.sinVisitas} sin ninguna visita`} color={t.insuficientes + t.sinVisitas ? C.ambar : undefined} onClick={() => abrir('Supervisión insuficiente', o => o.clase === 'insuficiente' || o.clase === 'sin_visitas')} activo={filtro?.titulo === 'Supervisión insuficiente'} />
        <Tile titulo="Sin visita nocturna" valor={t.sinCoberturaNocturna} detalle="tuvieron servicio de noche" onClick={() => abrir('Sin visita nocturna', o => o.sinCoberturaNocturna)} activo={filtro?.titulo === 'Sin visita nocturna'} />
        <Tile titulo="Sin visita en fin de semana" valor={t.sinCoberturaFinde} detalle="tuvieron servicio sáb/dom" onClick={() => abrir('Sin visita en fin de semana', o => o.sinCoberturaFinde)} activo={filtro?.titulo === 'Sin visita en fin de semana'} />
        <Tile titulo="Horarios previsibles" valor={t.previsibles} detalle="visitas siempre a la misma hora" onClick={() => abrir('Horarios previsibles', o => o.previsible)} activo={filtro?.titulo === 'Horarios previsibles'} />
        <Tile titulo="Visitas concentradas" valor={t.excesivos} detalle="muy por encima de lo esperado" onClick={() => abrir('Visitas concentradas', o => o.clase === 'excesiva')} activo={filtro?.titulo === 'Visitas concentradas'} />
      </div>

      <div style={{ ...sub, fontWeight: 600, margin: '10px 0 6px' }}>2 · Calidad de la visita · 3 · Efectividad correctiva</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Tile titulo="Visitas incompletas" valor={`${t.pctIncompletas ?? 0} %`} detalle="sin completar el control" onClick={() => abrir('Con visitas incompletas', o => o.incompletas > 0)} activo={filtro?.titulo === 'Con visitas incompletas'} />
        <Tile titulo="Problemas corregidos" valor={`${r.objetivos.reduce((a, o) => a + o.corregidos, 0)} de ${r.objetivos.reduce((a, o) => a + o.problemas, 0)}`} detalle={`${r.objetivos.reduce((a, o) => a + o.verificados, 0)} verificados`} />
        <Tile titulo="Reincidencias" valor={r.objetivos.reduce((a, o) => a + o.reincidencias, 0)} detalle="casos reabiertos" onClick={() => abrir('Con reincidencias', o => o.reincidencias > 0)} activo={filtro?.titulo === 'Con reincidencias'} />
        <Tile titulo="Por supervisor" valor={r.supervisores.length} detalle={verSup ? 'ocultar detalle' : 'ver visitas por supervisor'} onClick={() => setVerSup(v => !v)} activo={verSup} />
      </div>

      {verSup && (
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Supervisor', 'Visitas', 'Objetivos', 'De noche', 'Fin de semana', 'Incompletas', 'Con observación', 'Críticas'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{r.supervisores.map(s => (
              <tr key={s.supervisorId}>
                <td style={td}>{s.supervisorId === 'sin_supervisor' ? 'Sin supervisor' : nombre(s.supervisorId)}</td>
                <td style={num}>{s.visitas}</td><td style={num}>{s.objetivos}</td><td style={num}>{s.nocturnas}</td><td style={num}>{s.finde}</td>
                <td style={num}>{s.incompletas}</td><td style={num}>{s.conObservacion}</td><td style={num}>{s.criticas}</td>
              </tr>
            ))}</tbody>
          </table>
          <div style={sub}>Las observaciones y los hallazgos críticos no son una mala nota: muestran que la visita detectó algo.</div>
        </div>
      )}

      {filtro && (
        <div style={{ overflowX: 'auto', marginTop: 10, maxHeight: 420 }}>
          <div style={{ ...sub, marginBottom: 4 }}>{filtro.titulo} · {filas.length}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Objetivo', 'Cada', 'Visitas / esperadas', 'Última', 'Mayor hueco', 'Noche', 'Finde', 'Incompl.', 'Corregidos', 'Situación'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{filas.map(o => (
              <tr key={o.objetivoId}>
                <td style={td}>{o.nombre}<div style={sub}>{Object.entries(o.porSupervisor).map(([id, n]) => `${id === 'sin_supervisor' ? 'Sin supervisor' : nombre(id)} (${n})`).join(' · ')}</div></td>
                <td style={num}>{o.frecuenciaHoras ? `${o.frecuenciaHoras} h` : '—'}</td>
                <td style={num}>{o.visitas} / {o.visitasEsperadas ?? '—'}</td>
                <td style={num}>{hace(o.horasDesdeUltima)}</td>
                <td style={num}>{o.brechaMaximaHoras == null ? '—' : hace(o.brechaMaximaHoras)}</td>
                <td style={num}>{o.servicioNocturno ? o.nocturnas : <span style={sub}>sin servicio</span>}</td>
                <td style={num}>{o.servicioFinde ? o.finde + o.feriado : <span style={sub}>sin servicio</span>}</td>
                <td style={num}>{o.incompletas}</td>
                <td style={num}>{o.corregidos}/{o.problemas}{o.reincidencias ? <div style={{ ...sub, color: C.ambar }}>{o.reincidencias} reincid.</div> : null}</td>
                <td style={td}><span style={{ color: COLOR_CLASE[o.clase], fontWeight: 600 }}>{ETIQUETA_CLASE[o.clase]}</span>{o.motivos.map(m => <div key={m} style={sub}>{m}</div>)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
