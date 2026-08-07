'use client'

// Calendario del mes para elegir días a mano.
//
// Reemplaza el par "desde / hasta" más "excluir fechas separadas por coma":
// se ven los días, se hace clic, y los que no se pueden elegir se muestran
// apagados con el motivo en el tooltip en vez de fallar recién al confirmar.
//
// Presentacional: no sabe qué se hace con la selección. Quién la usa decide
// qué días se pueden elegir (`estadoDia`) y qué hacer al confirmar.

import { ENCABEZADOS_SEMANA, fechasDeAtajo, semanasDelMes } from '@/lib/calendario-mes'
import type { PatronDias } from '@/lib/asignacion-mensual'

export interface EstadoDia {
  /** false = se ve pero no se puede tocar. */
  habilitado: boolean
  /** Por qué no se puede elegir (o cualquier aclaración). Va al tooltip. */
  nota?: string
  /** Marca visual para días que ya están resueltos (ya tienen turno, ya asignados…). */
  yaResuelto?: boolean
}

export interface SelectorDiasMesProps {
  /** 'YYYY-MM' */
  mes: string
  seleccionadas: Set<string>
  onCambio: (fechas: Set<string>) => void
  /** Estado de cada día. Por defecto todos habilitados. */
  estadoDia?: (fecha: string) => EstadoDia
}

const ATAJOS: { patron: PatronDias; etiqueta: string }[] = [
  { patron: 'todos', etiqueta: 'Todos' },
  { patron: 'lun_vie', etiqueta: 'Lun a Vie' },
  { patron: 'sab_dom', etiqueta: 'Fin de semana' },
]

const HABILITADO_POR_DEFECTO: EstadoDia = { habilitado: true }

export default function SelectorDiasMes({ mes, seleccionadas, onCambio, estadoDia }: SelectorDiasMesProps) {
  const estado = (f: string): EstadoDia => estadoDia?.(f) ?? HABILITADO_POR_DEFECTO
  const sePuedeElegir = (f: string) => estado(f).habilitado
  const semanas = semanasDelMes(mes)

  const alternar = (fecha: string) => {
    const proxima = new Set(seleccionadas)
    if (proxima.has(fecha)) proxima.delete(fecha)
    else proxima.add(fecha)
    onCambio(proxima)
  }

  const aplicarAtajo = (patron: PatronDias) => {
    onCambio(new Set(fechasDeAtajo(mes, patron, sePuedeElegir)))
  }

  const btnAtajo: React.CSSProperties = {
    background: '#0f172a', border: '1px solid #1e2d42', borderRadius: 6,
    color: '#94a3b8', fontSize: 11, padding: '4px 9px', cursor: 'pointer',
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {ATAJOS.map(a => (
          <button key={a.patron} type="button" style={btnAtajo} onClick={() => aplicarAtajo(a.patron)}>
            {a.etiqueta}
          </button>
        ))}
        <button type="button" style={btnAtajo} onClick={() => onCambio(new Set())}>Limpiar</button>
      </div>

      <div style={{ background: '#0b1220', border: '1px solid #1e2d42', borderRadius: 8, padding: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, marginBottom: 3 }}>
          {ENCABEZADOS_SEMANA.map(d => (
            <div key={d} style={{ textAlign: 'center', fontSize: 10, color: '#64748b', textTransform: 'uppercase' }}>{d}</div>
          ))}
        </div>

        {semanas.map((semana, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, marginBottom: 3 }}>
            {semana.map((fecha, j) => {
              if (!fecha) return <div key={`v${j}`} />
              const e = estado(fecha)
              const elegido = seleccionadas.has(fecha)
              return (
                <button
                  key={fecha}
                  type="button"
                  disabled={!e.habilitado}
                  title={e.nota ? `${fecha} · ${e.nota}` : fecha}
                  onClick={() => alternar(fecha)}
                  style={{
                    padding: '6px 0', borderRadius: 6, fontSize: 12, fontWeight: elegido ? 700 : 400,
                    background: elegido ? '#f2b134' : e.yaResuelto ? 'rgba(96,165,250,.1)' : '#111827',
                    color: elegido ? '#1a1206' : e.habilitado ? '#e2e8f0' : '#475569',
                    border: `1px solid ${elegido ? '#f2b134' : e.yaResuelto ? 'rgba(96,165,250,.35)' : '#1e2d42'}`,
                    cursor: e.habilitado ? 'pointer' : 'not-allowed',
                    opacity: e.habilitado ? 1 : 0.45,
                    textDecoration: !e.habilitado && e.yaResuelto ? 'line-through' : 'none',
                  }}
                >
                  {fecha.slice(8, 10)}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      <div style={{ fontSize: 12, color: seleccionadas.size > 0 ? '#e2e8f0' : '#64748b', marginTop: 8 }}>
        {seleccionadas.size === 0
          ? 'Ningún día seleccionado.'
          : `${seleccionadas.size} día${seleccionadas.size !== 1 ? 's' : ''} seleccionado${seleccionadas.size !== 1 ? 's' : ''}.`}
      </div>
    </div>
  )
}
