'use client'
// Cobranzas → Cuenta por cliente: lista de todos los clientes con su deuda total (vencida + por vencer) y lo
// que falta sólo por retenciones. Al tocar un cliente se abre su cuenta corriente.
import { useEffect, useMemo, useState } from 'react'
import { leer } from '@/lib/facturacion/datos'
import { antiguedad, type FilaSaldo } from '@/lib/facturacion/tablero-financiero'
import { estadoCobro } from '@/lib/facturacion/estado-cobro'
import { fechaArgentina } from '@/lib/periodo-argentina'
import { S, fecha, pesos, useAccion } from './comun'

export default function ClientesDeuda({ clientes, alElegir }: { clientes: any[]; alElegir: (id: string) => void }) {
  const [filas, setFilas] = useState<FilaSaldo[]>([])
  const [cobros, setCobros] = useState<any[]>([])
  const [buscar, setBuscar] = useState('')
  const [conDeuda, setConDeuda] = useState(true)
  const { ocupado, correr, Mensaje } = useAccion()
  const hoy = fechaArgentina()

  useEffect(() => { correr(async () => {
    const [s, c] = await Promise.all([
      leer('fact_v_saldos', q => q.limit(5000)),
      leer('fact_cobros', q => q.is('anulado_at', null).limit(10000), 'cliente_id, fecha'),
    ])
    setFilas(s); setCobros(c)
  }) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const lista = useMemo(() => clientes.map(c => {
    const del = filas.filter(f => f.cliente_id === c.id)
    const a = antiguedad(del, hoy)
    const abiertas = del.filter(f => ['vencida', 'parcial', 'por_vencer'].includes(estadoCobro(f, hoy).estado))
    const masVieja = Math.max(0, ...abiertas.map(f => estadoCobro(f, hoy).diasVencida))
    const ultimo = cobros.filter(x => x.cliente_id === c.id).map(x => x.fecha).sort().pop() ?? null
    return { id: c.id, nombre: c.razon_social, cuit: c.cuit, deuda: a.vencido + a.porVencer, ...a, facturas: abiertas.length, masVieja, ultimo }
  }).filter(x => (!conDeuda || x.deuda + x.retenciones > 0) && (!buscar || `${x.nombre} ${x.cuit ?? ''}`.toLowerCase().includes(buscar.toLowerCase())))
    .sort((a, b) => b.deuda - a.deuda || a.nombre.localeCompare(b.nombre)), [clientes, filas, cobros, hoy, buscar, conDeuda])

  const suma = (k: 'deuda' | 'vencido' | 'porVencer' | 'retenciones') => lista.reduce((s, x) => s + x[k], 0)

  return (
    <div>
      <div style={S.fila}>
        <h3 style={{ ...S.h3, margin: 0 }}>Deuda por cliente</h3>
        <input style={S.input} placeholder="Buscar cliente o CUIT" value={buscar} onChange={e => setBuscar(e.target.value)} />
        <label style={S.sub}><input type="checkbox" checked={conDeuda} onChange={e => setConDeuda(e.target.checked)} /> Sólo con deuda</label>
        <Mensaje />
      </div>
      <div style={{ ...S.sub, marginTop: 4 }}>Deuda = vencido + por vencer. Las retenciones (cobradas, falta el certificado) van aparte. Tocá un cliente para ver su cuenta.</div>
      <div style={{ overflow: 'auto', maxHeight: '65vh', marginTop: 8, border: '1px solid #1e293b', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Cliente', 'Deuda total', 'Vencido', 'Por vencer', 'Retenciones', 'Facturas abiertas', 'Atraso mayor', 'Último cobro'].map(h =>
            <th key={h} style={{ ...S.th, position: 'sticky', top: 0, background: '#0f1629' }}>{h}</th>)}</tr></thead>
          <tbody>
            {lista.map(x => <tr key={x.id} onClick={() => alElegir(x.id)} style={{ cursor: 'pointer' }} title="Ver cuenta corriente">
              <td style={S.td}><b>{x.nombre}</b>{x.cuit && <div style={S.sub}>{x.cuit}</div>}</td>
              <td style={{ ...S.num, fontWeight: 700 }}>{x.deuda ? pesos(x.deuda) : '—'}</td>
              <td style={{ ...S.num, color: x.vencido ? '#f87171' : undefined }}>{x.vencido ? pesos(x.vencido) : '—'}</td>
              <td style={S.num}>{x.porVencer ? pesos(x.porVencer) : '—'}</td>
              <td style={S.num}>{x.retenciones ? pesos(x.retenciones) : '—'}</td>
              <td style={S.num}>{x.facturas || '—'}</td>
              <td style={{ ...S.num, color: x.masVieja > 60 ? '#f87171' : undefined }}>{x.masVieja ? `${x.masVieja} d` : '—'}</td>
              <td style={S.td}>{fecha(x.ultimo)}</td>
            </tr>)}
            {!lista.length && !ocupado && <tr><td style={S.td} colSpan={8}>No hay clientes con esos filtros.</td></tr>}
          </tbody>
          {lista.length > 0 && <tfoot><tr>
            <td style={{ ...S.td, fontWeight: 700 }}>TOTAL ({lista.length})</td>
            {(['deuda', 'vencido', 'porVencer', 'retenciones'] as const).map(k => <td key={k} style={{ ...S.num, fontWeight: 700 }}>{pesos(suma(k))}</td>)}
            <td style={S.num}>{lista.reduce((s, x) => s + x.facturas, 0)}</td><td style={S.td} /><td style={S.td} />
          </tr></tfoot>}
        </table>
      </div>
    </div>
  )
}
