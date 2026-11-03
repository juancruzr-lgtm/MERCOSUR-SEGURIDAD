'use client'
// Control gerencial: prestación (mes del servicio), emisión (fecha fiscal) y
// cobro (fecha del cobro), por empresa, cliente u objetivo. Las horas son las
// FACTURABLES aprobadas (no las liquidables). Cobrado y retenciones no se
// suman; abonos fuera del precio por hora; sin rentabilidad hasta tener costos.
// Todo número sale de la base: si no hay datos, se muestra vacío, no un ejemplo.
import { useEffect, useState } from 'react'
import { leer, rpc, ESTADO_PREPARACION } from '@/lib/facturacion/datos'
import { S, pesos, useAccion } from './comun'

function Dato({ t, v, sub }: { t: string; v: string; sub?: string }) {
  return <div style={{ background: '#0a0e1a', border: '1px solid #1e293b', borderRadius: 8, padding: 12, minWidth: 170 }}>
    <div style={S.sub}>{t}</div><div style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>{v}</div>{sub && <div style={S.sub}>{sub}</div>}
  </div>
}
const h = (x: unknown) => Number(x ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 1 })
const mesMas = (m: string, n: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7) }
function variacion(actual: number, previo: number) {
  if (!previo) return actual ? 'sin dato previo' : '—'
  const p = ((actual - previo) / Math.abs(previo)) * 100
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)} %`
}

export default function Tablero({ mes }: { mes: string }) {
  const [t, setT] = useState<any>(null)
  const [serie, setSerie] = useState<any[]>([])
  const [cliente, setCliente] = useState('')
  const [objetivo, setObjetivo] = useState('')
  const [clientes, setClientes] = useState<any[]>([])
  const [objetivos, setObjetivos] = useState<any[]>([])
  const { correr, Mensaje } = useAccion()

  useEffect(() => { correr(async () => {
    setClientes(await leer('fact_clientes', q => q.eq('activo', true).order('razon_social'), 'id, razon_social'))
    setObjetivos(await leer('fact_contrato_objetivos', q => q.is('anulado_at', null), 'objetivo_id, objetivo:objetivos(nombre), contrato:fact_contratos(cliente_id)'))
  }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { correr(async () => {
    const f = { p_cliente_id: cliente || null, p_objetivo_id: objetivo || null }
    setT(await rpc('fact_tablero', { p_mes: mes, p_hoy: null, ...f }))
    setSerie(await rpc('fact_tablero_serie', { p_desde: mesMas(mes, -12), p_hasta: mes, ...f }))
  }) }, [mes, cliente, objetivo]) // eslint-disable-line react-hooks/exhaustive-deps

  const objsDelCliente = objetivos.filter(o => !cliente || o.contrato?.cliente_id === cliente)
  const filtros = (
    <div style={{ ...S.card, ...S.fila }}>
      <select style={S.input} value={cliente} onChange={e => { setCliente(e.target.value); setObjetivo('') }}>
        <option value="">Toda la empresa</option>{clientes.map(c => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
      </select>
      <select style={S.input} value={objetivo} onChange={e => setObjetivo(e.target.value)}>
        <option value="">Todos los objetivos</option>
        {Array.from(new Map(objsDelCliente.map(o => [o.objetivo_id, o])).values()).map(o => <option key={o.objetivo_id} value={o.objetivo_id}>{o.objetivo?.nombre}</option>)}
      </select>
      {objetivo && <span style={S.sub}>Por objetivo, los importes son exactos sólo cuando la factura es por objetivo.</span>}
      <Mensaje />
    </div>
  )
  if (!t) return <div>{filtros}</div>
  const hs = t.horas, p = t.prestacion, e = t.emision, c = t.cobro, d = t.deuda
  const previo = serie.find(x => x.mes === mesMas(mes, -1)), anioAnt = serie.find(x => x.mes === mesMas(mes, -12)), actual = serie.find(x => x.mes === mes)

  return (
    <div>
      {filtros}
      <div style={S.card}>
        <h3 style={S.h3}>Prestación de {mes} — horas facturables</h3>
        <div style={S.fila}>
          <Dato t="Programadas" v={h(hs.programadas)} />
          <Dato t="Cubiertas" v={h(hs.cubiertas)} sub={Number(hs.superpuestas) ? `${h(hs.superpuestas)} h de relevos superpuestos contadas una vez` : undefined} />
          <Dato t="Descubiertas" v={h(hs.descubiertas)} />
          <Dato t="Aprobadas para facturar" v={h(hs.aprobadas)} />
          <Dato t="Facturadas" v={h(hs.facturadas)} />
          <Dato t="Pendientes de facturar" v={h(hs.pendientes_facturar)} sub={Number(hs.aprobadas_sin_prefactura) ? `${h(hs.aprobadas_sin_prefactura)} h sin prefactura` : undefined} />
        </div>
        <div style={{ ...S.fila, marginTop: 8 }}>
          <Dato t="Neto prefacturado" v={pesos(p.neto_prefacturado_c)} sub={`emitido ${pesos(p.neto_emitido_c)}`} />
          <Dato t="Ajustes comerciales (neto)" v={pesos(p.ajustes_neto_c)} />
          <Dato t="Precio promedio por hora" v={t.precio_hora?.promedio_c ? pesos(t.precio_hora.promedio_c) : '—'}
            sub={`${t.precio_hora?.diurna_c ? `diurna ${pesos(t.precio_hora.diurna_c)} · ` : ''}${t.precio_hora?.nocturna_c ? `nocturna ${pesos(t.precio_hora.nocturna_c)} · ` : ''}sólo horas emitidas, sin abonos`} />
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
          <Dato t="Facturación neta" v={pesos(e.neto_facturado_c)} sub={`total ${pesos(e.total_facturado_c)} · ${e.comprobantes} comprobantes`} />
        </div>
      </div>
      <div style={S.card}>
        <h3 style={S.h3}>Cobrado en {mes}</h3>
        <div style={S.fila}>
          <Dato t="Dinero cobrado (banco)" v={pesos(c.cobrado_c)} />
          <Dato t="Retenciones con certificado" v={pesos(c.retenciones_certificadas_c)} sub="cancelan deuda, no son ingreso bancario" />
          <Dato t="Retenciones estimadas" v={pesos(c.retenciones_estimadas_c)} sub="no cancelan deuda" />
          {c.ingresos_no_cobranza_c != null && <Dato t="Ingresos que no son cobranza" v={pesos(c.ingresos_no_cobranza_c)} sub="rescates, propias, reversos, impuestos" />}
          <Dato t="Cobros sin aplicar" v={pesos(t.sin_aplicar.cobros_c)} sub={`${t.sin_aplicar.movimientos_sin_cobro} ingresos sin cobro · ${t.sin_aplicar.movimientos_sin_clasificar} sin clasificar`} />
        </div>
      </div>
      <div style={S.card}>
        <h3 style={S.h3}>Deuda (al día de hoy)</h3>
        <div style={S.fila}>
          <Dato t="Saldo pendiente" v={pesos(d.total_c)} />
          <Dato t="Vencida" v={pesos(d.vencido_c)} />
          <Dato t="No vencida" v={pesos(d.no_vencido_c)} />
          <Dato t="1–30 días" v={pesos(d.d1_30_c)} />
          <Dato t="31–60 días" v={pesos(d.d31_60_c)} />
          <Dato t="61–90 días" v={pesos(d.d61_90_c)} />
          <Dato t="+90 días" v={pesos(d.mas_90_c)} />
          <Dato t="Sin cliente asociado" v={pesos(d.sin_cliente_c)} />
          <Dato t="Saldos iniciales" v={pesos(d.saldos_iniciales_c)} />
          <Dato t="NC sin factura asociada" v={pesos(d.nc_sin_asociar_c)} sub="crédito a resolver" />
        </div>
      </div>

      <div style={{ ...S.card, overflowX: 'auto' }}>
        <h3 style={S.h3}>Comparaciones</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Concepto', mes, mesMas(mes, -1), 'vs mes anterior', mesMas(mes, -12), 'vs año anterior'].map(x => <th key={x} style={S.th}>{x}</th>)}</tr></thead>
          <tbody>{actual && ([
            ['Horas cubiertas', (x: any) => Number(x?.horas?.cubiertas ?? 0), h],
            ['Horas facturadas', (x: any) => Number(x?.horas?.facturadas ?? 0), h],
            ['Facturación neta (emisión)', (x: any) => Number(x?.montos?.neto_facturado_c ?? 0), pesos],
            ['Cobrado banco', (x: any) => Number(x?.montos?.cobrado_c ?? 0), pesos],
            ['Retenciones', (x: any) => Number(x?.montos?.retenciones_certificadas_c ?? 0), pesos],
          ] as Array<[string, (x: any) => number, (n: number) => string]>).map(([nombre, f, fmt]) => (
            <tr key={nombre}><td style={S.td}>{nombre}</td><td style={S.num}>{fmt(f(actual))}</td><td style={S.num}>{fmt(f(previo))}</td>
              <td style={S.num}>{variacion(f(actual), f(previo))}</td><td style={S.num}>{fmt(f(anioAnt))}</td><td style={S.num}>{variacion(f(actual), f(anioAnt))}</td></tr>
          ))}</tbody>
        </table>
        <h3 style={{ ...S.h3, marginTop: 14 }}>Evolución (12 meses)</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Mes', 'H. cubiertas', 'H. facturadas', 'Neto emitido', 'NC', 'Cobrado', 'Retenciones'].map(x => <th key={x} style={S.th}>{x}</th>)}</tr></thead>
          <tbody>{serie.map(x => <tr key={x.mes}><td style={S.td}>{x.mes}</td><td style={S.num}>{h(x.horas.cubiertas)}</td><td style={S.num}>{h(x.horas.facturadas)}</td>
            <td style={S.num}>{pesos(x.montos.neto_facturado_c)}</td><td style={S.num}>{pesos(x.montos.nc_total_c)}</td><td style={S.num}>{pesos(x.montos.cobrado_c)}</td><td style={S.num}>{pesos(x.montos.retenciones_certificadas_c)}</td></tr>)}</tbody>
        </table>
      </div>

      <div style={{ ...S.card, overflowX: 'auto' }}>
        <h3 style={S.h3}>Por cliente</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Cliente', 'H. cubiertas', 'H. facturadas', 'Neto emitido', 'Cobrado', 'Saldo', 'Vencido'].map(x => <th key={x} style={S.th}>{x}</th>)}</tr></thead>
          <tbody>{(t.por_cliente ?? []).map((x: any) => <tr key={x.cliente_id}><td style={S.td}>{x.cliente}</td><td style={S.num}>{h(x.horas.cubiertas)}</td><td style={S.num}>{h(x.horas.facturadas)}</td>
            <td style={S.num}>{pesos(x.montos.neto_facturado_c)}</td><td style={S.num}>{pesos(x.montos.cobrado_c)}</td><td style={S.num}>{pesos(x.saldo_c)}</td><td style={S.num}>{pesos(x.vencido_c)}</td></tr>)}</tbody>
        </table>
        <h3 style={{ ...S.h3, marginTop: 14 }}>Por objetivo</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Objetivo', 'Programadas', 'Cubiertas', 'Descubiertas', 'Aprobadas', 'Facturado'].map(x => <th key={x} style={S.th}>{x}</th>)}</tr></thead>
          <tbody>{(t.por_objetivo ?? []).map((x: any, i: number) => <tr key={i}><td style={S.td}>{x.objetivo}</td><td style={S.num}>{h(x.horas_programadas)}</td><td style={S.num}>{h(x.horas_cubiertas)}</td>
            <td style={S.num}>{h(x.horas_descubiertas)}</td><td style={S.num}>{h(x.horas_aprobadas)}</td><td style={S.td}>{x.facturada ? 'sí' : 'no'}</td></tr>)}</tbody>
        </table>
      </div>
      <div style={{ ...S.aviso }}>{t.rentabilidad?.motivo}</div>
    </div>
  )
}
