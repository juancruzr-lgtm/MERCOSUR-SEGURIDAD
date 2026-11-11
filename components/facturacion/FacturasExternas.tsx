'use client'
// Facturas emitidas FUERA de la app (Comprobantes en línea / Factuweb) cruzadas con las prefacturas
// del mes. ARCA no las devuelve por web service (error 11002): la fuente es el archivo de
// "Mis Comprobantes – Emitidos" importado arriba. Sólo lo exacto (CUIT, tipo, total y fecha
// compatible) se ofrece para marcar como emitido; el resto se informa, con las horas facturadas.
import { useState } from 'react'
import { api, leer, ESTADO_PREPARACION } from '@/lib/facturacion/datos'
import { emparejar, horasFacturadas, type ComprobanteExterno, type Emparejamiento } from '@/lib/facturacion/externas-arca'
import { numeroVisible } from '@/lib/facturacion/comprobantes'
import { mesVencido } from '@/lib/facturacion/periodo-seguro'
import { S, fecha, pesos } from './comun'

const ABIERTAS = ['en_preparacion', 'esperando_requisitos', 'lista_revision', 'aprobada_emitir']
const num = (c: ComprobanteExterno) => numeroVisible({ tipo: c.tipo, puntoVenta: c.puntoVenta, numero: c.numero })
const est = (e: string) => ESTADO_PREPARACION[e] ?? e
const dia = (iso: string, mas: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + mas * 86400000).toISOString().slice(0, 10)
const finDeMes = (mes: string) => { const [a, m] = mes.split('-').map(Number); return new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10) }

export default function FacturasExternas({ alCambiar }: { alCambiar: () => void }) {
  const [mes, setMes] = useState(() => mesVencido())
  const [estado, setEstado] = useState<string | null>(null)
  const [r, setR] = useState<Emparejamiento | null>(null)
  const [hechas, setHechas] = useState<Record<string, string>>({})
  const [ocupado, setOcupado] = useState(false)

  async function cruzar() {
    setOcupado(true); setR(null); setHechas({})
    try {
      const hastaExcl = finDeMes(mes)
      const [comps, prefs] = await Promise.all([
        leer('fact_comprobantes', q => q.eq('ambiente', 'produccion').is('prefactura_id', null).in('tipo', [1, 6, 201])
          .gte('fecha_emision', dia(hastaExcl, -7)).lte('fecha_emision', dia(hastaExcl, 45)).order('fecha_emision').limit(1000),
          'id, tipo, punto_venta, numero, fecha_emision, doc_nro_receptor, receptor_nombre, neto_c, iva_c, total_c, cae'),
        leer('fact_prefacturas', q => q.eq('periodo_mes', mes).in('estado', ABIERTAS),
          'id, version, estado, cuit_receptor, tipo_comprobante, total_c, neto_c, iva_c, periodo_desde, periodo_hasta_excl, lineas, cliente:fact_clientes(razon_social)'),
      ])
      const externos: ComprobanteExterno[] = comps.map((c: any) => ({
        id: c.id, tipo: Number(c.tipo), puntoVenta: Number(c.punto_venta), numero: Number(c.numero), fecha: c.fecha_emision,
        docNro: String(c.doc_nro_receptor ?? '').replace(/\D/g, ''), receptor: c.receptor_nombre ?? null,
        netoC: Number(c.neto_c), ivaC: Number(c.iva_c), totalC: Number(c.total_c), cae: c.cae ?? null,
      }))
      setR(emparejar(prefs.map((p: any) => ({ ...p, cliente: p.cliente?.razon_social ?? null })), externos))
      setEstado(`${externos.length} factura(s) importada(s) sin prefactura, emitidas entre el ${fecha(dia(hastaExcl, -7))} y el ${fecha(dia(hastaExcl, 45))}.`)
    } catch (e: any) { setEstado(`Error: ${e?.message ?? e}`) } finally { setOcupado(false) }
  }

  async function marcar(p: any, c: ComprobanteExterno) {
    try {
      await api('arca-externas', { prefactura_id: p.id, version: p.version, comprobante_id: c.id })
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
      <h3 style={S.h3}>Facturas emitidas fuera de la app</h3>
      <div style={S.sub}>Cruza las facturas importadas del archivo de ARCA (Comprobantes en línea / Factuweb; ARCA no las da por web service) con las prefacturas del mes. Sólo se marca lo que coincide exacto en CUIT, tipo y total.</div>
      <div style={{ ...S.fila, marginTop: 8 }}>
        <label style={S.sub}>Mes de prestación <input style={{ ...S.input, width: 160 }} type="month" value={mes} onChange={e => setMes(e.target.value)} /></label>
        <button style={S.btn} disabled={ocupado} onClick={cruzar}>Cruzar con lo importado</button>
        {estado && <span style={S.sub}>{estado}</span>}
      </div>
      {r && <>
        <div style={{ ...S.fila, marginTop: 10 }}>
          <b>Coinciden exacto: {r.coincidencias.length}</b>
          {r.coincidencias.length > 0 && <button style={S.btn} disabled={ocupado} onClick={() => {
            if (confirm(`Marcar ${r.coincidencias.length} prefactura(s) como EMITIDAS con su factura de ARCA?\nLas que están "en revisión" se aprueban primero (la factura real tiene el mismo total).`)) marcarTodas()
          }}>Marcar todas como emitidas</button>}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6, fontSize: 13 }}>
          <thead><tr>{['Cliente', 'Prefactura', 'Factura', 'Fecha', 'Total', 'Horas', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {r.coincidencias.map(({ prefactura: p, comprobante: c }) => <tr key={p.id}>
              <td style={S.td}>{p.cliente}</td><td style={S.td}>{est(p.estado)}</td><td style={S.td}>{num(c)}</td><td style={S.td}>{fecha(c.fecha)}</td>
              <td style={S.num}>{pesos(c.totalC)}</td><td style={S.num}>{horasFacturadas(p, c)?.reales ?? '—'}</td>
              <td style={S.td}>{hechas[p.id] ?? <button style={S.btn2} disabled={ocupado} onClick={() => marcar(p, c)}>Marcar emitida</button>}</td>
            </tr>)}
            {r.diferencias.map(({ prefactura: p, comprobante: c, motivo }) => <tr key={p.id}>
              <td style={S.td}>{p.cliente}</td><td style={S.td}>{est(p.estado)}</td><td style={S.td}>{num(c)}</td><td style={S.td}>{fecha(c.fecha)}</td>
              <td style={S.num}>{pesos(c.totalC)}</td><td style={S.num}>{horasFacturadas(p, c)?.reales ?? '—'}</td>
              <td style={{ ...S.td, color: '#fbbf24' }}>No coincide: {motivo}</td>
            </tr>)}
            {r.ambiguas.map(({ prefactura: p, comprobantes }) => <tr key={p.id}>
              <td style={S.td}>{p.cliente}</td><td style={S.td}>{est(p.estado)}</td><td style={S.td}>{comprobantes.map(num).join(', ')}</td><td style={S.td}>—</td><td style={S.num}>—</td><td style={S.num}>—</td>
              <td style={{ ...S.td, color: '#fbbf24' }}>Varias facturas posibles: revisar a mano</td>
            </tr>)}
          </tbody>
        </table>
        {r.sinFactura.length > 0 && <div style={{ ...S.sub, marginTop: 6 }}>Prefacturas sin factura importada: {r.sinFactura.map(p => p.cliente).join(' · ')}</div>}
        {r.sinPrefactura.length > 0 && <div style={{ ...S.sub, marginTop: 4 }}>Facturas importadas sin prefactura abierta del mes: {r.sinPrefactura.map(c => `${c.receptor ?? c.docNro} ${num(c)} (${pesos(c.totalC)})`).join(' · ')}</div>}
      </>}
    </div>
  )
}
