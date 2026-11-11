'use client'
// Facturas emitidas FUERA de la app (Comprobantes en línea / Factuweb), leídas de ARCA por
// web service (sólo lectura) y emparejadas con las prefacturas del mes. Sólo lo exacto (CUIT,
// tipo, total y período) se ofrece para marcar como emitido; el resto se informa.
import { useState } from 'react'
import { api, leer, ESTADO_PREPARACION } from '@/lib/facturacion/datos'
import { emparejar, type ComprobanteArca, type Emparejamiento } from '@/lib/facturacion/externas-arca'
import { numeroVisible } from '@/lib/facturacion/comprobantes'
import { mesVencido } from '@/lib/facturacion/periodo-seguro'
import { S, fecha, pesos } from './comun'

const TIPOS = [1, 6, 201]
const ABIERTAS = ['en_preparacion', 'esperando_requisitos', 'lista_revision', 'aprobada_emitir']
const num = (c: ComprobanteArca) => numeroVisible({ tipo: c.tipo, puntoVenta: c.puntoVenta, numero: c.numero })
const est = (e: string) => ESTADO_PREPARACION[e] ?? e

export default function FacturasExternas({ alCambiar }: { alCambiar: () => void }) {
  const [mes, setMes] = useState(() => mesVencido())
  const [pvs, setPvs] = useState('1, 2, 3')
  const [estado, setEstado] = useState<string | null>(null)
  const [avisos, setAvisos] = useState<string[]>([])
  const [r, setR] = useState<Emparejamiento | null>(null)
  const [hechas, setHechas] = useState<Record<string, string>>({})
  const [ocupado, setOcupado] = useState(false)

  async function consultar() {
    setOcupado(true); setR(null); setAvisos([]); setHechas({})
    try {
      const desde = `${mes}-01`
      const lista = pvs.split(/[^\d]+/).map(Number).filter(n => Number.isInteger(n) && n > 0)
      const comps: ComprobanteArca[] = []
      const av: string[] = []
      for (const pv of lista) for (const tipo of TIPOS) {
        setEstado(`Consultando ARCA: punto de venta ${pv}, tipo ${tipo}…`)
        try {
          const x = await api<any>(`arca-externas?pv=${pv}&tipo=${tipo}&desde=${desde}`, undefined, 'GET')
          comps.push(...x.comprobantes)
          if (x.error) av.push(`PV ${pv} tipo ${tipo}: ${x.error}`)
          else if (!x.completo && x.comprobantes.length) av.push(`PV ${pv} tipo ${tipo}: se leyeron los últimos 150 números; puede haber más`)
        } catch (e: any) { av.push(`PV ${pv} tipo ${tipo}: ${e?.message ?? e}`) }
      }
      setEstado('Emparejando con las prefacturas…')
      const prefs = await leer('fact_prefacturas', q => q.eq('periodo_mes', mes).in('estado', ABIERTAS),
        'id, version, estado, cuit_receptor, tipo_comprobante, total_c, neto_c, iva_c, periodo_desde, periodo_hasta_excl, cliente:fact_clientes(razon_social)')
      setR(emparejar(prefs.map((p: any) => ({ ...p, cliente: p.cliente?.razon_social ?? null })), comps))
      setAvisos(av)
      setEstado(`ARCA devolvió ${comps.length} factura(s) desde el ${fecha(desde)}.`)
    } catch (e: any) { setEstado(`Error: ${e?.message ?? e}`) } finally { setOcupado(false) }
  }

  async function marcar(p: any, c: ComprobanteArca) {
    try {
      await api('arca-externas', { prefactura_id: p.id, version: p.version, tipo: c.tipo, punto_venta: c.puntoVenta, numero: c.numero })
      setHechas(h => ({ ...h, [p.id]: 'Marcada como emitida ✓' }))
      alCambiar()
    } catch (e: any) { setHechas(h => ({ ...h, [p.id]: `No se pudo: ${e?.message ?? e}` })) }
  }
  async function marcarTodas() {
    if (!r) return
    setOcupado(true)
    for (const x of r.coincidencias) if (!hechas[x.prefactura.id]) await marcar(x.prefactura, x.comprobante)
    setOcupado(false)
  }

  return (
    <div style={S.card}>
      <h3 style={S.h3}>Facturas emitidas fuera de la app (ARCA)</h3>
      <div style={S.sub}>Lee de ARCA las facturas de Comprobantes en línea / Factuweb (sólo consulta: no pide CAE) y las cruza con las prefacturas del mes. Sólo se marca lo que coincide exacto en CUIT, tipo, total y período.</div>
      <div style={{ ...S.fila, marginTop: 8 }}>
        <label style={S.sub}>Mes de prestación <input style={{ ...S.input, width: 160 }} type="month" value={mes} onChange={e => setMes(e.target.value)} /></label>
        <label style={S.sub}>Puntos de venta <input style={{ ...S.input, width: 90 }} value={pvs} onChange={e => setPvs(e.target.value)} /></label>
        <button style={S.btn} disabled={ocupado} onClick={consultar}>Consultar en ARCA</button>
        {estado && <span style={S.sub}>{estado}</span>}
      </div>
      {avisos.map((a, i) => <div key={i} style={{ ...S.aviso, marginTop: 6 }}>{a}</div>)}
      {r && <>
        <div style={{ ...S.fila, marginTop: 10 }}>
          <b>Coinciden exacto: {r.coincidencias.length}</b>
          {r.coincidencias.length > 0 && <button style={S.btn} disabled={ocupado} onClick={() => {
            if (confirm(`Marcar ${r.coincidencias.length} prefactura(s) como EMITIDAS con su factura de ARCA?\nLas que están "lista para revisión" se aprueban primero (la factura real tiene el mismo total).`)) marcarTodas()
          }}>Marcar todas como emitidas</button>}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6, fontSize: 13 }}>
          <thead><tr>{['Cliente', 'Prefactura', 'Factura en ARCA', 'Fecha', 'Total', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {r.coincidencias.map(({ prefactura: p, comprobante: c }) => <tr key={p.id}>
              <td style={S.td}>{p.cliente}</td><td style={S.td}>{est(p.estado)}</td>
              <td style={S.td}>{num(c)}</td><td style={S.td}>{fecha(c.fecha)}</td><td style={S.num}>{pesos(c.totalC)}</td>
              <td style={S.td}>{hechas[p.id] ?? <button style={S.btn2} disabled={ocupado} onClick={() => marcar(p, c)}>Marcar emitida</button>}</td>
            </tr>)}
            {r.diferencias.map(({ prefactura: p, comprobante: c, motivo }) => <tr key={p.id}>
              <td style={S.td}>{p.cliente}</td><td style={S.td}>{est(p.estado)}</td><td style={S.td}>{num(c)}</td><td style={S.td}>{fecha(c.fecha)}</td>
              <td style={S.num}>{pesos(c.totalC)}</td><td style={{ ...S.td, color: '#fbbf24' }}>No coincide: {motivo}</td>
            </tr>)}
            {r.ambiguas.map(({ prefactura: p, comprobantes }) => <tr key={p.id}>
              <td style={S.td}>{p.cliente}</td><td style={S.td}>{est(p.estado)}</td><td style={S.td}>{comprobantes.map(num).join(', ')}</td><td style={S.td}>—</td><td style={S.num}>—</td>
              <td style={{ ...S.td, color: '#fbbf24' }}>Varias facturas posibles: revisar a mano</td>
            </tr>)}
          </tbody>
        </table>
        {r.sinFactura.length > 0 && <div style={{ ...S.sub, marginTop: 6 }}>Prefacturas sin factura en ARCA: {r.sinFactura.map(p => p.cliente).join(' · ')}</div>}
        {r.sinPrefactura.length > 0 && <div style={{ ...S.sub, marginTop: 4 }}>Facturas de ARCA sin prefactura abierta del mes: {r.sinPrefactura.map(c => `${num(c)} (${pesos(c.totalC)})`).join(' · ')}</div>}
      </>}
    </div>
  )
}
