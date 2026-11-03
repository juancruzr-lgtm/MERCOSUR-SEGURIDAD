'use client'
// Tablero de facturación: prestación, emisión y cobro del mes por separado.
// Cobrado y retenciones no se suman; abonos fuera del precio por hora; sin
// rentabilidad mientras no haya costos completos.
import { useEffect, useState } from 'react'
import { rpc, ESTADO_PREPARACION } from '@/lib/facturacion/datos'
import { S, pesos, useAccion } from './comun'

function Dato({ t, v, sub }: { t: string; v: string; sub?: string }) {
  return <div style={{ background: '#0a0e1a', border: '1px solid #1e293b', borderRadius: 8, padding: 12, minWidth: 170 }}>
    <div style={S.sub}>{t}</div><div style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>{v}</div>{sub && <div style={S.sub}>{sub}</div>}
  </div>
}
const h = (x: unknown) => Number(x ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 1 })

export default function Tablero({ mes }: { mes: string }) {
  const [t, setT] = useState<any>(null)
  const { correr, Mensaje } = useAccion()
  useEffect(() => { correr(async () => setT(await rpc('fact_tablero', { p_mes: mes }))) }, [mes]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!t) return <div style={S.card}><Mensaje /></div>
  const p = t.prestacion, e = t.emision, c = t.cobro, d = t.deuda

  return (
    <div>
      <div style={S.card}>
        <h3 style={S.h3}>Prestación de {mes}</h3>
        <div style={S.fila}>
          <Dato t="Horas registradas" v={h(p.horas_registradas)} />
          <Dato t="Horas aprobadas" v={h(p.horas_aprobadas)} />
          <Dato t="Aprobadas sin facturar" v={h(p.horas_pendientes_facturar)} />
          <Dato t="Turnos sin registro (h)" v={h(p.horas_sin_aprobar)} />
          <Dato t="Ajustes comerciales (neto)" v={pesos(p.ajustes_neto_c)} />
          <Dato t="Precio promedio por hora" v={t.precio_hora?.promedio_c ? pesos(t.precio_hora.promedio_c) : '—'} sub="sólo líneas de horas; sin abonos" />
        </div>
        <div style={{ ...S.sub, marginTop: 6 }}>{Object.entries(p.por_estado ?? {}).map(([k, v]) => `${ESTADO_PREPARACION[k] ?? k}: ${v}`).join(' · ')}</div>
        {t.demoras?.length > 0 && <>
          <h4 style={{ ...S.sub, marginTop: 10 }}>PENDIENTES DE FACTURAR Y MOTIVO</h4>
          {t.demoras.map((x: any) => <div key={x.prefactura_id} style={{ fontSize: 13 }}>{x.cliente}{x.objetivo ? ` · ${x.objetivo}` : ''} · {ESTADO_PREPARACION[x.estado]} · {(x.motivos ?? []).map((m: any) => m.detalle).join('; ') || x.proxima_accion || '—'}</div>)}
        </>}
      </div>
      <div style={S.card}>
        <h3 style={S.h3}>Emitido en {mes} (fecha del comprobante)</h3>
        <div style={S.fila}>
          <Dato t="Facturas neto" v={pesos(e.facturas_neto_c)} />
          <Dato t="IVA facturado" v={pesos(e.facturas_iva_c)} />
          <Dato t="Notas de crédito" v={pesos(e.nc_total_c)} sub={`neto ${pesos(e.nc_neto_c)}`} />
          <Dato t="Notas de débito" v={pesos(e.nd_total_c)} />
          <Dato t="Facturación neta" v={pesos(e.neto_facturado_c)} sub={`${e.comprobantes} comprobantes`} />
        </div>
      </div>
      <div style={S.card}>
        <h3 style={S.h3}>Cobrado en {mes}</h3>
        <div style={S.fila}>
          <Dato t="Dinero cobrado" v={pesos(c.cobrado_c)} />
          <Dato t="Retenciones con certificado" v={pesos(c.retenciones_certificadas_c)} />
          <Dato t="Retenciones estimadas" v={pesos(c.retenciones_estimadas_c)} sub="no cancelan deuda" />
          <Dato t="Ingresos que no son cobranza" v={pesos(c.ingresos_no_cobranza_c)} sub="rescates, propias, reversos" />
          <Dato t="Cobros sin aplicar" v={pesos(t.sin_aplicar.cobros_c)} sub={`${t.sin_aplicar.movimientos_sin_cobro} ingresos sin cobro · ${t.sin_aplicar.movimientos_sin_clasificar} sin clasificar`} />
        </div>
      </div>
      <div style={S.card}>
        <h3 style={S.h3}>Deuda (al día de hoy)</h3>
        <div style={S.fila}>
          <Dato t="Total" v={pesos(d.total_c)} />
          <Dato t="No vencida" v={pesos(d.no_vencido_c)} />
          <Dato t="1–30 días" v={pesos(d.d1_30_c)} />
          <Dato t="31–60 días" v={pesos(d.d31_60_c)} />
          <Dato t="61–90 días" v={pesos(d.d61_90_c)} />
          <Dato t="+90 días" v={pesos(d.mas_90_c)} />
          <Dato t="Sin cliente asociado" v={pesos(d.sin_cliente_c)} />
          <Dato t="Saldos iniciales" v={pesos(d.saldos_iniciales_c)} />
        </div>
      </div>
      <div style={{ ...S.card, overflowX: 'auto' }}>
        <h3 style={S.h3}>Por cliente</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Cliente', 'Horas aprobadas', 'Facturado neto (emisión)', 'Cobrado', 'Saldo'].map(x => <th key={x} style={S.th}>{x}</th>)}</tr></thead>
          <tbody>{(t.por_cliente ?? []).map((x: any) => <tr key={x.cliente_id}><td style={S.td}>{x.cliente}</td><td style={S.num}>{h(x.horas_aprobadas)}</td><td style={S.num}>{pesos(x.facturado_neto_c)}</td><td style={S.num}>{pesos(x.cobrado_c)}</td><td style={S.num}>{pesos(x.saldo_c)}</td></tr>)}</tbody>
        </table>
        <h3 style={{ ...S.h3, marginTop: 14 }}>Por objetivo</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Objetivo', 'Registradas', 'Aprobadas'].map(x => <th key={x} style={S.th}>{x}</th>)}</tr></thead>
          <tbody>{(t.por_objetivo ?? []).map((x: any, i: number) => <tr key={i}><td style={S.td}>{x.objetivo}</td><td style={S.num}>{h(x.horas_registradas)}</td><td style={S.num}>{h(x.horas_aprobadas)}</td></tr>)}</tbody>
        </table>
      </div>
      <div style={{ ...S.aviso }}>{t.rentabilidad?.motivo}</div>
    </div>
  )
}
