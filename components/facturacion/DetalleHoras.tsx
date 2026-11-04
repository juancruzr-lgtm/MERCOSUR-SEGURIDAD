'use client'
// Desglose de la propuesta de horas de un objetivo y sus turnos (se despliega en
// la misma fila de Horas y de Prefacturas). Sólo muestra; la decisión sobre lo
// descubierto la guarda quien aprueba.
import { S, fecha, horas } from './comun'
import type { TratamientoDescubiertos } from '@/lib/facturacion/revision'

export default function DetalleHoras({ h, trat, alCambiarTrat }: { h: any; trat?: TratamientoDescubiertos; alCambiarTrat: (t: TratamientoDescubiertos) => void }) {
  return (
    <div>
      <div style={{ ...S.fila, gap: 18, fontSize: 13 }}>
        <span>Programadas <b>{horas(h.minutosProgramados + h.minutosCapacitacionProgramados)}</b></span>
        <span>Reales GPS <b>{horas(h.minutosReales)}</b></span>
        <span>Liquidables (Reportes) <b>{horas(h.minutosLiquidables + h.minutosCapacitacionLiquidables)}</b></span>
        <span>− Capacitación <b>{horas(h.minutosCapacitacionLiquidables)}</b></span>
        <span>Facturables <b>{horas(h.minutosCubiertos)}</b></span>
        {h.minutosSimultaneos > 0 && <span>incl. simultáneos <b>{horas(h.minutosSimultaneos)}</b></span>}
        {h.minutosSuperpuestos > 0 && <span>incl. posible relevo <b>{horas(h.minutosSuperpuestos)}</b></span>}
        {h.minutosDiurnos != null && <span>Diurnas / nocturnas <b>{horas(h.minutosDiurnos)} / {horas(h.minutosNocturnos)}</b></span>}
        {h.minutosDescubiertos > 0 && <span>Descubiertas <b>{horas(h.minutosDescubiertos)}</b>{' '}
          <select style={S.input} value={trat ?? ''} onChange={e => alCambiarTrat(e.target.value as TratamientoDescubiertos)}>
            {!trat && <option value="">decidir…</option>}
            <option value="no_facturar">no facturar</option><option value="facturar">facturar igual (con motivo en la nota)</option>
          </select></span>}
      </div>
      {h.revisar?.length > 0 && <div style={{ ...S.aviso, marginTop: 6 }}>Revisión comercial (no se descuenta nada solo): {h.revisar.map((x: any) => `${fecha(x.fecha)}: ${x.detalle}`).join(' · ')}</div>}
      <table style={{ borderCollapse: 'collapse', marginTop: 6, fontSize: 12 }}>
        <thead><tr>{['Fecha', 'Estado', 'Programado', 'Liquidable'].map(x => <th key={x} style={S.th}>{x}</th>)}</tr></thead>
        <tbody>{[...h.detalle].sort((a: any, b: any) => a.fecha.localeCompare(b.fecha)).map((d: any) => (
          <tr key={`${d.turno_id}-${d.registro_id ?? ''}`}>
            <td style={S.td}>{fecha(d.fecha)}</td><td style={S.td}>{d.estado}</td>
            <td style={S.num}>{horas(d.programados)}</td><td style={S.num}>{horas(d.cubiertos)}</td>
          </tr>))}</tbody>
      </table>
    </div>
  )
}
