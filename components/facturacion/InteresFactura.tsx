'use client'
// Intereses por mora INFORMATIVOS de una factura, sólo para avisarle al cliente: la tasa, los días, los tramos y la
// marca "no cobrar". No registra intereses ni pide notas de débito; lo único que guarda es la marca "no cobrar",
// con motivo e historial (fact_interes_no_cobrar).
import { rpc } from '@/lib/facturacion/datos'
import { describirTasa } from '@/lib/facturacion/tasa-mora'
import type { InteresFactura } from '@/lib/facturacion/intereses-cobranzas'
import { S, fecha, pesos, useAccion } from './comun'

export const AMBAR = '#fbbf24'
const pct = (n: number) => `${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })} %`
const diaDe = (ts: string | null) => (ts ? new Date(ts).toLocaleDateString('es-AR') : '')

/** Celda de una lista: el interés a la fecha (tachado si no se cobra). */
export function CeldaInteres({ i, cargando }: { i: InteresFactura | null | undefined; cargando: boolean }) {
  if (cargando) return <span style={S.sub}>…</span>
  if (!i || (i.interes_c <= 0 && !i.sin_dato)) return <>—</>
  if (i.interes_c <= 0) return <span style={S.sub} title="Falta el dato de la tasa del BCRA">sin dato</span>
  if (i.noCobrar) return <span style={{ color: '#64748b', textDecoration: 'line-through' }} title={`No se cobra: ${i.noCobrar.motivo}`}>{pesos(i.interes_c)}</span>
  return <span style={{ color: AMBAR }} title={i.cerradaEl ? `Días cerrados el ${fecha(i.cerradaEl)}, día del pago` : 'Sigue sumando hasta que se pague'}>{pesos(i.interes_c)}</span>
}

/** Tramos del cálculo: cada saldo, sus días, la tasa anual equivalente y el interés. */
export function TramosInteres({ i }: { i: InteresFactura }) {
  return (
    <table style={{ borderCollapse: 'collapse' }}><tbody>
      {i.tramos.map((t, k) => <tr key={k}>
        <td style={S.td}>{fecha(t.desde)} a {fecha(t.hasta)}</td>
        <td style={S.num}>{t.dias} días</td>
        <td style={S.num}>sobre {pesos(t.saldo_c)}</td>
        <td style={S.num} title={t.coeficiente ? `coeficiente TIM ${t.coeficiente.toLocaleString('es-AR', { maximumFractionDigits: 8 })}` : undefined}>{pct(t.tna_equivalente)} anual</td>
        <td style={S.num}>{pesos(t.interes_c)}</td>
      </tr>)}
      <tr><td style={S.td} colSpan={4}>Total{i.sin_dato ? ' (hay días sin dato de la tasa del BCRA: no se cuentan)' : ''}</td><td style={S.num}><b>{pesos(i.interes_c)}</b></td></tr>
    </tbody></table>
  )
}

/** Bloque del detalle de una factura: cuánto da, con qué tasa, desde cuándo, y "no cobrar" / "volver a cobrar". */
export function DetalleInteres({ comprobanteId, i, cargando, alCambiar }: {
  comprobanteId: string; i: InteresFactura | null | undefined; cargando: boolean; alCambiar: () => void
}) {
  const { ocupado, correr, Mensaje } = useAccion()
  if (cargando) return <div style={{ ...S.sub, marginTop: 8 }}>Calculando intereses por mora…</div>
  if (!i || (i.interes_c <= 0 && !i.sin_dato && !i.noCobrar)) return null
  return (
    <div style={{ marginTop: 10 }}>
      <h4 style={S.sub}>INTERESES POR MORA · INFORMATIVO, PARA AVISARLE AL CLIENTE</h4>
      <div>
        {i.noCobrar ? <span style={{ textDecoration: 'line-through', color: '#64748b' }}>{pesos(i.interes_c)}</span> : <b style={{ color: AMBAR }}>{pesos(i.interes_c)}</b>}
        {' '}· {i.dias_mora} días de mora desde el {fecha(i.desde)}
        {i.cerradaEl ? ` · días cerrados el ${fecha(i.cerradaEl)} (día del pago)` : ' · a la fecha: sigue sumando hasta que se pague'}
      </div>
      <div style={S.sub}>Tasa: {describirTasa(i.tasa)} · {i.propia ? 'la del contrato' : 'la tasa general'}{i.graciaDias ? ` · ${i.graciaDias} días de gracia` : ''}. No se factura sola: si se cobra, va con una nota de débito aparte.</div>
      {i.tramos.length > 0 && <details style={{ marginTop: 4 }}><summary style={S.sub}>Cómo se calculó ({i.tramos.length} tramo{i.tramos.length === 1 ? '' : 's'})</summary><TramosInteres i={i} /></details>}
      {i.sin_dato && !i.tramos.length && <div style={S.sub}>Falta el dato de la tasa del BCRA para estos días.</div>}
      <div style={{ ...S.fila, marginTop: 6 }}>
        {i.noCobrar ? <>
          <span style={S.sub}>No se cobran: {i.noCobrar.motivo}{i.noCobrar.at ? ` (${diaDe(i.noCobrar.at)})` : ''}</span>
          <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => {
            await rpc('fact_interes_no_cobrar', { p_comprobante_id: comprobanteId, p_no_cobrar: false, p_motivo: null }); alCambiar()
          }, 'Sus intereses vuelven a contarse')}>Volver a cobrarlos</button>
        </> : <button style={S.btn2} disabled={ocupado} onClick={() => {
          const m = window.prompt('¿Por qué no se cobran los intereses de esta factura? Queda en el historial.')
          if (m && m.trim()) correr(async () => {
            await rpc('fact_interes_no_cobrar', { p_comprobante_id: comprobanteId, p_no_cobrar: true, p_motivo: m.trim() }); alCambiar()
          }, 'Marcada: sus intereses no se cobran')
        }}>No cobrar intereses</button>}
        <Mensaje />
      </div>
    </div>
  )
}
