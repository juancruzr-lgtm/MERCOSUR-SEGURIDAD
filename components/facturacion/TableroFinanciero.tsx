'use client'
// Tablero → Situación financiera: deuda real (sin mezclar retenciones), antigüedad por cliente, facturado vs
// cobrado mes a mes, próximos vencimientos y eCheqs en cartera. Usa los mismos datos que Cobranzas.
import { useEffect, useMemo, useState } from 'react'
import { leer } from '@/lib/facturacion/datos'
import { numeroVisible } from '@/lib/facturacion/comprobantes'
import { antiguedad, diasPromedioCobro, mesesHasta, proximosVencimientos, serieMensual, type FilaSaldo } from '@/lib/facturacion/tablero-financiero'
import { fechaArgentina } from '@/lib/periodo-argentina'
import { conVencimiento } from '@/lib/facturacion/estado-cobro'
import { cargarCondicionesPago } from '@/lib/facturacion/condiciones-pago'
import { S, fecha, pesos, useAccion } from './comun'

function Indicador({ t, v, sub, color }: { t: string; v: string; sub?: string; color?: string }) {
  return <div style={{ background: '#0a0e1a', border: '1px solid #1e293b', borderRadius: 8, padding: 12, minWidth: 170 }}>
    <div style={S.sub}>{t}</div><div style={{ fontSize: 20, fontWeight: 700, color: color ?? '#e2e8f0' }}>{v}</div>{sub && <div style={S.sub}>{sub}</div>}
  </div>
}
const millones = (c: number) => `${(c / 1e8).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`

export default function TableroFinanciero({ mes, cliente }: { mes: string; cliente: string }) {
  const [filas, setFilas] = useState<FilaSaldo[]>([])
  const [cobros, setCobros] = useState<any[]>([])
  const [aps, setAps] = useState<any[]>([])
  const [clientes, setClientes] = useState<any[]>([])
  const { correr, Mensaje } = useAccion()
  const hoy = fechaArgentina()

  useEffect(() => { correr(async () => {
    const [s, c, a, cl, cond] = await Promise.all([
      leer('fact_v_saldos', q => q.limit(5000)),
      leer('fact_cobros', q => q.is('anulado_at', null).limit(10000), 'id, cliente_id, fecha, importe_c, medio, cheque_estado, cheque_fecha_pago, cheque_numero'),
      leer('fact_aplicaciones', q => q.is('revertida_at', null).not('cobro_id', 'is', null).limit(10000), 'cobro_id, comprobante_id, importe_c'),
      leer('fact_clientes', q => q.order('razon_social'), 'id, razon_social'),
      cargarCondicionesPago(),
    ])
    setFilas(conVencimiento(s, cond)); setCobros(c); setAps(a); setClientes(cl)
  }) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fs = useMemo(() => filas.filter(f => !cliente || f.cliente_id === cliente), [filas, cliente])
  const cs = useMemo(() => cobros.filter(c => !cliente || c.cliente_id === cliente), [cobros, cliente])
  const mapaCobros = useMemo(() => new Map(cobros.map(c => [c.id, c])), [cobros])
  const ag = antiguedad(fs, hoy)
  const anio = mes.slice(0, 4)
  const cobradoMes = cs.filter(c => String(c.fecha).startsWith(mes)).reduce((s, c) => s + Number(c.importe_c), 0)
  const cobradoAnio = cs.filter(c => String(c.fecha).startsWith(anio)).reduce((s, c) => s + Number(c.importe_c), 0)
  const facturadoAnio = fs.filter(f => String(f.fecha_emision).startsWith(anio)).reduce((s, f) => s + Number(f.total_c) - Number(f.nc_c), 0)
  const dias = diasPromedioCobro(fs, aps, mapaCobros)
  const cartera = cs.filter(c => c.cheque_estado === 'en_cartera')
  const serie = serieMensual(fs, cs, mesesHasta(mes, 12))
  const maxSerie = Math.max(1, ...serie.flatMap(x => [x.facturado, x.cobrado]))
  const proximos = proximosVencimientos(fs, hoy, 30)

  // Antigüedad por cliente (sólo con algo pendiente), ordenado por deuda vencida.
  const porCliente = useMemo(() => {
    const ids = Array.from(new Set(fs.map(f => f.cliente_id).filter(Boolean))) as string[]
    return ids.map(id => {
      const del = fs.filter(f => f.cliente_id === id)
      const apsCli = aps.filter(a => del.some(f => f.comprobante_id === a.comprobante_id))
      const ultimo = cobros.filter(c => c.cliente_id === id).map(c => c.fecha).sort().pop() ?? null
      return { id, nombre: clientes.find(c => c.id === id)?.razon_social ?? id, ...antiguedad(del, hoy), dias: diasPromedioCobro(del, apsCli, mapaCobros), ultimo }
    }).filter(x => x.vencido + x.porVencer + x.retenciones > 0).sort((a, b) => b.vencido - a.vencido)
  }, [fs, aps, cobros, clientes, hoy, mapaCobros])

  return (
    <div style={S.card}>
      <div style={S.fila}><h3 style={{ ...S.h3, margin: 0 }}>Situación financiera al {fecha(hoy)}</h3><Mensaje /></div>
      <div style={{ ...S.fila, marginTop: 8 }}>
        <Indicador t="Deuda vencida" v={pesos(ag.vencido)} sub="facturas sin cobro o con pago parcial" color="#f87171" />
        <Indicador t="Por vencer" v={pesos(ag.porVencer)} color="#93c5fd" />
        <Indicador t="Retenciones a certificar" v={pesos(ag.retenciones)} sub="cobradas; falta el certificado" color="#a3e635" />
        <Indicador t={`Cobrado en ${mes}`} v={pesos(cobradoMes)} sub="por fecha de cobro" color="#4ade80" />
        <Indicador t={`Cobrado en ${anio}`} v={pesos(cobradoAnio)} sub={facturadoAnio ? `${Math.round(cobradoAnio / facturadoAnio * 100)} % de lo facturado (${millones(facturadoAnio)})` : undefined} />
        <Indicador t="Días promedio de cobro" v={dias == null ? '—' : `${dias} días`} sub="de la emisión al cobro, ponderado" />
        <Indicador t="eCheqs en cartera" v={pesos(cartera.reduce((s, c) => s + Number(c.importe_c), 0))} sub={`${cartera.length} cheques por acreditar`} />
      </div>

      <h4 style={{ ...S.sub, marginTop: 14 }}>DEUDA POR ANTIGÜEDAD</h4>
      <div style={{ display: 'flex', height: 18, borderRadius: 6, overflow: 'hidden', border: '1px solid #1e293b' }}>
        {([['1–30 d', ag.d1_30, '#fbbf24'], ['31–60 d', ag.d31_60, '#f97316'], ['61–90 d', ag.d61_90, '#ef4444'], ['+90 d', ag.mas_90, '#991b1b']] as const).map(([t, v, c]) =>
          v > 0 ? <div key={t} title={`${t}: ${pesos(v)}`} style={{ width: `${(v / Math.max(1, ag.vencido)) * 100}%`, background: c }} /> : null)}
      </div>
      <div style={{ ...S.sub, marginTop: 4 }}>1–30 días {pesos(ag.d1_30)} · 31–60 {pesos(ag.d31_60)} · 61–90 {pesos(ag.d61_90)} · más de 90 {pesos(ag.mas_90)}</div>

      <div style={{ overflow: 'auto', maxHeight: '45vh', marginTop: 10, border: '1px solid #1e293b', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Cliente', 'Vencido', '1–30', '31–60', '61–90', '+90', 'Por vencer', 'Retenciones', 'Días de pago', 'Último cobro'].map(h =>
            <th key={h} style={{ ...S.th, position: 'sticky', top: 0, background: '#0f1629' }}>{h}</th>)}</tr></thead>
          <tbody>{porCliente.map(x => <tr key={x.id}>
            <td style={S.td}>{x.nombre}</td>
            <td style={{ ...S.num, color: x.vencido ? '#f87171' : undefined }}><b>{x.vencido ? pesos(x.vencido) : '—'}</b></td>
            {[x.d1_30, x.d31_60, x.d61_90, x.mas_90, x.porVencer, x.retenciones].map((v, i) => <td key={i} style={S.num}>{v ? pesos(v) : '—'}</td>)}
            <td style={S.num}>{x.dias == null ? '—' : `${x.dias} d`}</td>
            <td style={S.td}>{fecha(x.ultimo)}</td>
          </tr>)}</tbody>
        </table>
      </div>

      <h4 style={{ ...S.sub, marginTop: 14 }}>FACTURADO Y COBRADO, ÚLTIMOS 12 MESES</h4>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${serie.length}, 1fr)`, gap: 6, alignItems: 'end', height: 150, marginTop: 6 }}>
        {serie.map(x => <div key={x.mes} style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: '100%' }} title={`${x.mes} · facturado ${pesos(x.facturado)} · cobrado ${pesos(x.cobrado)}`}>
          <div style={{ flex: 1, height: `${(x.facturado / maxSerie) * 100}%`, background: '#3b82f6', borderRadius: '3px 3px 0 0', minHeight: x.facturado ? 2 : 0 }} />
          <div style={{ flex: 1, height: `${(x.cobrado / maxSerie) * 100}%`, background: '#22c55e', borderRadius: '3px 3px 0 0', minHeight: x.cobrado ? 2 : 0 }} />
        </div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${serie.length}, 1fr)`, gap: 6, marginTop: 4 }}>
        {serie.map(x => <div key={x.mes} style={{ ...S.sub, textAlign: 'center', fontSize: 11 }}>{x.mes.slice(5)}/{x.mes.slice(2, 4)}<br />{x.facturado ? `${Math.round(x.cobrado / x.facturado * 100)} %` : '—'}</div>)}
      </div>
      <div style={{ ...S.sub, marginTop: 4 }}><span style={{ color: '#3b82f6' }}>■</span> facturado (fecha de emisión) · <span style={{ color: '#22c55e' }}>■</span> cobrado (fecha de cobro) · el % es cobrado sobre facturado de ese mes</div>

      <h4 style={{ ...S.sub, marginTop: 14 }}>VENCEN EN LOS PRÓXIMOS 30 DÍAS ({pesos(proximos.reduce((s, f) => s + Number(f.saldo_c), 0))})</h4>
      {proximos.length ? proximos.map(f => <div key={f.comprobante_id} style={{ fontSize: 13 }}>
        {fecha(f.vto)} · {clientes.find(c => c.id === f.cliente_id)?.razon_social ?? '—'} · {numeroVisible({ tipo: (f as any).tipo, puntoVenta: (f as any).punto_venta, numero: Number((f as any).numero) })} · <b>{pesos(f.saldo_c)}</b>
      </div>) : <div style={S.sub}>Nada vence en los próximos 30 días.</div>}
      {cartera.length > 0 && <>
        <h4 style={{ ...S.sub, marginTop: 14 }}>eCHEQS EN CARTERA</h4>
        {cartera.sort((a, b) => String(a.cheque_fecha_pago ?? '').localeCompare(String(b.cheque_fecha_pago ?? ''))).map(c => <div key={c.id} style={{ fontSize: 13 }}>
          {fecha(c.cheque_fecha_pago)} · {clientes.find(x => x.id === c.cliente_id)?.razon_social ?? '—'} · {c.medio}{c.cheque_numero ? ` n° ${c.cheque_numero}` : ''} · <b>{pesos(c.importe_c)}</b></div>)}
      </>}
    </div>
  )
}
