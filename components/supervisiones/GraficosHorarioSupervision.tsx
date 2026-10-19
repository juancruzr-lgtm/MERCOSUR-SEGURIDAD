/**
 * components/supervisiones/GraficosHorarioSupervision.tsx
 *
 * Gráficos de supervisiones por hora del día, sin librería (como el resto de
 * la app: barras de div). Presentación pura: los números salen de
 * lib/legajo-supervisor.ts.
 *
 * Cada hora muestra las supervisiones apiladas por situación (en turno, fuera
 * de turno, sin guardia cargada) y, debajo, una franja con las horas de
 * SERVICIO programado: una hora sin barras y con franja llena es una hora de
 * guardia sin supervisiones; sin franja, no estaba de servicio y no se le
 * reclama nada.
 */

import type { FranjaHoraria } from '@/lib/legajo-supervisor'

export const COLOR_SITUACION = {
  en_turno: '#10b981',
  fuera_turno: '#f59e0b',
  sin_calendario: '#64748b',
  servicio: '#38bdf8',
} as const

const C = { texto: '#e2e8f0', tenue: '#94a3b8', apagado: '#64748b', borde: '#1e293b' }
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.tenue }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />
      {texto}
    </span>
  )
}

export function GraficoPorHora({ filas }: { filas: FranjaHoraria[] }) {
  const maxSup = Math.max(1, ...filas.map(f => f.enTurno + f.fueraTurno + f.sinCalendario))
  const maxServ = Math.max(1, ...filas.map(f => f.minutosServicio))
  const total = filas.reduce((a, f) => a + f.enTurno + f.fueraTurno + f.sinCalendario, 0)
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <Leyenda color={COLOR_SITUACION.en_turno} texto="En su turno" />
        <Leyenda color={COLOR_SITUACION.fuera_turno} texto="Fuera de su turno" />
        <Leyenda color={COLOR_SITUACION.sin_calendario} texto="Sin guardia cargada" />
        <Leyenda color={COLOR_SITUACION.servicio} texto="Horas de servicio programado" />
      </div>
      {total === 0 && <div style={{ fontSize: 12, color: C.apagado, marginBottom: 6 }}>Sin supervisiones en el período.</div>}
      <div style={{ overflowX: 'auto' }}>
        <div role="img" aria-label="Supervisiones por hora del día"
             style={{ display: 'grid', gridTemplateColumns: 'repeat(24, minmax(18px, 1fr))', gap: 3, minWidth: 480 }}>
          {filas.map(f => {
            const n = f.enTurno + f.fueraTurno + f.sinCalendario
            const alto = (v: number) => `${(v / maxSup) * 100}%`
            return (
              <div key={f.hora} title={`${String(f.hora).padStart(2, '0')} h · ${n} supervisiones (${f.enTurno} en turno, ${f.fueraTurno} fuera, ${f.sinCalendario} sin guardia cargada) · ${Math.round(f.minutosServicio / 60)} h de servicio`}
                   style={{ display: 'grid', gridTemplateRows: '120px 8px 16px', gap: 3 }}>
                <div style={{ display: 'flex', flexDirection: 'column-reverse', background: '#0b1220', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: alto(f.enTurno), background: COLOR_SITUACION.en_turno }} />
                  <div style={{ height: alto(f.fueraTurno), background: COLOR_SITUACION.fuera_turno }} />
                  <div style={{ height: alto(f.sinCalendario), background: COLOR_SITUACION.sin_calendario }} />
                </div>
                <div style={{ background: COLOR_SITUACION.servicio, opacity: f.minutosServicio > 0 ? 0.25 + 0.75 * (f.minutosServicio / maxServ) : 0.06, borderRadius: 2 }} />
                <div style={{ fontSize: 10, color: C.apagado, textAlign: 'center' }}>{String(f.hora).padStart(2, '0')}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function MatrizDiaHora({ matriz }: { matriz: number[][] }) {
  const max = Math.max(1, ...matriz.flat())
  return (
    <div style={{ overflowX: 'auto' }}>
      <div role="img" aria-label="Supervisiones por día de la semana y hora"
           style={{ display: 'grid', gridTemplateColumns: '36px repeat(24, minmax(16px, 1fr))', gap: 2, minWidth: 480 }}>
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} style={{ fontSize: 9, color: C.apagado, textAlign: 'center' }}>{h % 3 === 0 ? String(h).padStart(2, '0') : ''}</div>
        ))}
        {matriz.map((fila, d) => [
          <div key={`d${d}`} style={{ fontSize: 11, color: C.tenue }}>{DIAS[d]}</div>,
          ...fila.map((n, h) => (
            <div key={`${d}-${h}`} title={`${DIAS[d]} ${String(h).padStart(2, '0')} h · ${n}`}
                 style={{ height: 16, borderRadius: 2, background: n === 0 ? '#0b1220' : `rgba(16,185,129,${0.2 + 0.8 * (n / max)})` }} />
          )),
        ])}
      </div>
    </div>
  )
}

export function BarraPosicionTurno({ inicio, medio, final }: { inicio: number; medio: number; final: number }) {
  const total = inicio + medio + final
  if (total === 0) return <div style={{ fontSize: 12, color: C.apagado }}>Sin supervisiones dentro de turno.</div>
  const pct = (n: number) => Math.round((n / total) * 100)
  const partes: [string, number, string][] = [
    ['Primer 20 % del turno', inicio, '#a78bfa'], ['Mitad del turno', medio, '#10b981'], ['Último 20 % del turno', final, '#f97316'],
  ]
  return (
    <div>
      <div style={{ display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden', background: '#0b1220' }}>
        {partes.map(([t, n, c]) => n > 0 && <div key={t} title={`${t}: ${n}`} style={{ width: `${pct(n)}%`, background: c }} />)}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
        {partes.map(([t, n, c]) => <Leyenda key={t} color={c} texto={`${t}: ${n} (${pct(n)} %)`} />)}
      </div>
    </div>
  )
}
