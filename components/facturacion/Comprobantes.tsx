'use client'
// Comprobantes fiscales: los emitidos por la app y los importados desde ARCA
// (en revisión hasta confirmarlos). Correcciones sólo con NC/ND vinculadas.
import { useEffect, useState } from 'react'
import { api, leer, rpc } from '@/lib/facturacion/datos'
import { numeroVisible } from '@/lib/facturacion/comprobantes'
import { S, centavosDe, fecha, pesos, useAccion } from './comun'
import FacturasExternas from './FacturasExternas'

export default function Comprobantes({ usuarioId }: { usuarioId: string | null }) {
  const [comps, setComps] = useState<any[]>([])
  const [saldos, setSaldos] = useState<Record<string, number>>({})
  const [clientes, setClientes] = useState<any[]>([])
  const [imps, setImps] = useState<any[]>([])
  const [filasImp, setFilasImp] = useState<{ id: string; filas: any[] } | null>(null)
  const [notas, setNotas] = useState<any[]>([])
  const [pruebas, setPruebas] = useState<any[]>([])
  const [conciliacion, setConciliacion] = useState<any>(null)
  const [buscar, setBuscar] = useState('')
  const [asoc, setAsoc] = useState<{ id: string; cliente_id: string; asociado_id: string; motivo: string } | null>(null)
  const [nc, setNc] = useState<{ id: string; tipo: string; neto: string; iva: string; motivo: string } | null>(null)
  const { ocupado, correr, Mensaje } = useAccion()

  async function cargar() {
    const [c, s, cl, i, n, h] = await Promise.all([
      leer('fact_comprobantes', q => q.eq('ambiente', 'produccion').order('fecha_emision', { ascending: false }).limit(1000)),
      leer('fact_v_saldos', q => q.limit(5000), 'comprobante_id, saldo_c'),
      leer('fact_clientes', q => q.order('razon_social'), 'id, razon_social, cuit'),
      leer('fact_importaciones', q => q.eq('tipo', 'arca_emitidos').order('created_at', { ascending: false }).limit(20)),
      leer('fact_emisiones', q => q.not('comprobante_asociado_id', 'is', null).in('estado', ['pendiente_aprobacion', 'preparada', 'incierta', 'rechazada'])),
      // Facturas de prueba (homologación): aparte, sin saldo ni NC/ND, sólo para verlas y abrir su PDF.
      leer('fact_comprobantes', q => q.eq('ambiente', 'homologacion').order('created_at', { ascending: false }).limit(100)),
    ])
    setComps(c); setSaldos(Object.fromEntries(s.map(x => [x.comprobante_id, Number(x.saldo_c)]))); setClientes(cl); setImps(i); setNotas(n); setPruebas(h)
  }
  useEffect(() => { correr(cargar) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const nombre = (id: string | null) => clientes.find(c => c.id === id)?.razon_social ?? null
  const visibles = comps.filter(c => !buscar || `${numeroVisible({ tipo: c.tipo, puntoVenta: c.punto_venta, numero: c.numero })} ${c.receptor_nombre ?? ''} ${nombre(c.cliente_id) ?? ''}`.toLowerCase().includes(buscar.toLowerCase()))

  return (
    <div>
      <div style={S.card}>
        <h3 style={S.h3}>Importar "Mis Comprobantes – Emitidos" de ARCA</h3>
        <div style={S.fila}>
          <input type="file" accept=".csv,.zip" disabled={ocupado} onChange={e => {
            const f = e.target.files?.[0]; if (!f) return
            const form = new FormData(); form.append('archivo', f); form.append('tipo', 'arca')
            correr(async () => {
              const r = await api('importar', form); await cargar()
              if (r.duplicado) throw new Error('Ese CSV ya se importó (mismo contenido): no se duplica.')
            }, 'Importado en revisión: confirmá las filas nuevas')
            e.target.value = ''
          }} />
          <span style={S.sub}>ZIP o CSV. Copias del mismo archivo se detectan por contenido. Nada se registra hasta confirmar.</span>
          <Mensaje />
        </div>
        {imps.map(i => (
          <div key={i.id} style={{ ...S.fila, fontSize: 13, marginTop: 6 }}>
            {fecha(i.created_at)} · {i.nombre_archivo} · {i.estado} · únicos {i.resumen?.comprobantes_unicos ?? '—'} · repetidas {i.resumen?.repetidas ?? 0} · {JSON.stringify(i.resumen?.por_estado ?? {})}
            <button style={S.btn2} onClick={() => correr(async () => setFilasImp({ id: i.id, filas: await leer('fact_importacion_filas', q => q.eq('importacion_id', i.id).order('clave')) }))}>Revisar</button>
            {i.estado === 'en_revision' && <button style={S.btn2} onClick={() => correr(async () => { await rpc('fact_importacion_cerrar', { p_importacion_id: i.id, p_estado: 'confirmada' }); await cargar() })}>Cerrar revisión</button>}
          </div>
        ))}
        {filasImp && (
          <div style={{ marginTop: 8, maxHeight: 360, overflowY: 'auto' }}>
            <div style={S.fila}>
              <button style={S.btn} disabled={ocupado} onClick={() => correr(async () => {
                await rpc('fact_importacion_arca_confirmar', { p_importacion_id: filasImp.id, p_claves: filasImp.filas.filter(f => f.estado === 'nuevo').map(f => f.clave) })
                setFilasImp(null)
                // Conciliación automática: sólo lo exacto queda vinculado; el resto, pendiente de revisión.
                const r: any = await api('conciliar', {}).catch((e: any) => ({ error: e?.message ?? String(e) }))
                setConciliacion(r)
                await cargar()
              }, 'Comprobantes confirmados y conciliados')}>Confirmar todas las nuevas</button>
              <button style={S.btn2} onClick={() => setFilasImp(null)}>Cerrar</button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
              {filasImp.filas.map(f => <tr key={f.id}><td style={S.td}>{f.clave}</td><td style={S.td}>{fecha(f.datos.fecha)}</td><td style={S.td}>{f.datos.receptor_nombre} ({f.datos.doc_nro_receptor})</td>
                <td style={S.num}>{pesos(f.datos.total_c)}</td><td style={S.td}>{f.estado}{f.repeticiones > 1 ? ` (×${f.repeticiones} en el archivo)` : ''}{f.diferencias ? ` · ${JSON.stringify(f.diferencias)}` : ''}</td></tr>)}
            </tbody></table>
          </div>
        )}
      </div>

      <FacturasExternas resultado={conciliacion} alCambiar={r => { if (r) setConciliacion(r); correr(cargar) }} />

      {notas.length > 0 && <div style={S.card}>
        <h3 style={S.h3}>Notas de crédito / débito en curso</h3>
        {notas.map(n => <div key={n.id} style={{ ...S.fila, fontSize: 13 }}>
          Tipo {n.tipo} · {pesos(n.solicitud?.total_c)} · {n.alcance_nota ?? ''} · {n.motivo} · {n.estado}
          {n.estado === 'pendiente_aprobacion' && <button style={S.btn2} onClick={() => correr(async () => { await rpc('fact_nota_aprobar', { p_emision_id: n.id }); await cargar() }, 'Nota aprobada')}>Aprobar</button>}
          {n.estado === 'pendiente_aprobacion' && n.creado_por === usuarioId && <span style={S.sub}>(la pediste vos: queda registrado quién pidió y quién aprobó)</span>}
          {['preparada', 'incierta', 'rechazada'].includes(n.estado) && <button style={S.btn2} onClick={() => correr(async () => { const r = await api('emitir', { emision_id: n.id }); await cargar(); if (r.estado !== 'autorizada') throw new Error(r.motivo ?? r.error ?? r.estado) }, 'Nota autorizada')}>{n.estado === 'incierta' ? 'Consultar ARCA' : `Emitir (${n.ambiente})`}</button>}
        </div>)}
      </div>}

      <div style={{ ...S.card, overflowX: 'auto' }}>
        <div style={S.fila}><h3 style={{ ...S.h3, margin: 0 }}>Comprobantes registrados (producción)</h3>
          <input style={S.input} placeholder="Buscar" value={buscar} onChange={e => setBuscar(e.target.value)} /></div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
          <thead><tr>{['Comprobante', 'Fecha', 'Cliente', 'Neto', 'IVA', 'Total', 'Saldo', 'CAE', 'Origen', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>{visibles.map(c => {
            const esNota = [2, 3, 7, 8, 202, 203].includes(c.tipo)
            const asociado = comps.find(x => x.id === c.asociado_id)
            return (
              <tr key={c.id}>
                <td style={S.td}>{numeroVisible({ tipo: c.tipo, puntoVenta: c.punto_venta, numero: c.numero })}
                  {esNota && <div style={S.sub}>{asociado ? `→ ${numeroVisible({ tipo: asociado.tipo, puntoVenta: asociado.punto_venta, numero: asociado.numero })} (${c.alcance_nota})` : 'sin factura asociada'}</div>}</td>
                <td style={S.td}>{fecha(c.fecha_emision)}</td>
                <td style={S.td}>{nombre(c.cliente_id) ?? <span style={S.err}>{c.receptor_nombre ?? 'sin cliente'}</span>}</td>
                <td style={S.num}>{pesos(c.neto_c)}</td><td style={S.num}>{pesos(c.iva_c)}</td><td style={S.num}>{pesos(c.total_c)}</td>
                <td style={S.num}>{esNota ? '—' : pesos(saldos[c.id])}</td>
                <td style={S.td}>{c.cae ?? '—'}</td>
                <td style={S.td}>{c.origen === 'importacion_arca' ? 'ARCA (importado)' : c.origen === 'carga_manual' ? 'Carga manual' : c.origen}
                  {[1, 6, 201].includes(c.tipo) && <div style={{ fontSize: 12, color: c.prefactura_id ? '#4ade80' : '#94a3b8' }}>{c.prefactura_id ? 'Conciliado con su prefactura' : 'Registrado, sin conciliar'}</div>}</td>
                <td style={S.td}>
                  {(!c.cliente_id || (esNota && !c.asociado_id)) && <button style={S.btn2} onClick={() => setAsoc({ id: c.id, cliente_id: c.cliente_id ?? '', asociado_id: '', motivo: '' })}>Asociar</button>}
                  {c.cae && <button style={S.btn2} onClick={() => correr(async () => { const r = await api(`comprobante-pdf?id=${c.id}`, undefined, 'GET'); window.open(r.url, '_blank', 'noopener') })}>PDF</button>}
                  {!esNota && <button style={S.btn2} onClick={() => setNc({ id: c.id, tipo: String(c.tipo === 1 ? 3 : c.tipo === 6 ? 8 : 203), neto: '', iva: '', motivo: '' })}>NC/ND</button>}
                </td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>

      {pruebas.length > 0 && <div style={{ ...S.card, overflowX: 'auto' }}>
        <h3 style={{ ...S.h3, margin: 0 }}>Facturas de prueba (homologación)</h3>
        <div style={S.sub}>Sin validez fiscal: sirven para revisar los datos y el PDF. No suman saldo ni admiten NC/ND. Cada prefactura admite una sola prueba.</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
          <thead><tr>{['Comprobante', 'Fecha', 'Cliente', 'Total', 'CAE de prueba', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>{pruebas.map(c => (
            <tr key={c.id}>
              <td style={S.td}>{numeroVisible({ tipo: c.tipo, puntoVenta: c.punto_venta, numero: c.numero })}</td>
              <td style={S.td}>{fecha(c.fecha_emision)}</td>
              <td style={S.td}>{nombre(c.cliente_id) ?? c.receptor_nombre ?? '—'}</td>
              <td style={S.num}>{pesos(c.total_c)}</td>
              <td style={S.td}>{c.cae ?? '—'}</td>
              <td style={S.td}>{c.cae && <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => { const r = await api(`comprobante-pdf?id=${c.id}`, undefined, 'GET'); window.open(r.url, '_blank', 'noopener') })}>Ver PDF</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>}

      {asoc && <div style={S.card}>
        <h3 style={S.h3}>Asociar comprobante</h3>
        <div style={S.fila}>
          <select style={S.input} value={asoc.cliente_id} onChange={e => setAsoc({ ...asoc, cliente_id: e.target.value })}><option value="">Cliente…</option>{clientes.map(c => <option key={c.id} value={c.id}>{c.razon_social}</option>)}</select>
          <select style={S.input} value={asoc.asociado_id} onChange={e => setAsoc({ ...asoc, asociado_id: e.target.value })}>
            <option value="">Factura que corrige (sólo NC/ND)…</option>
            {comps.filter(x => [1, 6, 201].includes(x.tipo) && (!asoc.cliente_id || x.cliente_id === asoc.cliente_id)).map(x => <option key={x.id} value={x.id}>{numeroVisible({ tipo: x.tipo, puntoVenta: x.punto_venta, numero: x.numero })} · {pesos(x.total_c)}</option>)}
          </select>
          <input style={S.input} placeholder="Motivo" value={asoc.motivo} onChange={e => setAsoc({ ...asoc, motivo: e.target.value })} />
          <button style={S.btn} onClick={() => correr(async () => {
            await rpc('fact_comprobante_asociar', { p_id: asoc.id, p_cliente_id: asoc.cliente_id || null, p_asociado_id: asoc.asociado_id || null, p_prefactura_id: null, p_motivo: asoc.motivo || null })
            setAsoc(null); await cargar()
          }, 'Asociación registrada')}>Guardar</button>
          <button style={S.btn2} onClick={() => setAsoc(null)}>Cancelar</button>
        </div>
        <div style={S.sub}>Una vez fijada, la asociación no se cambia. El alcance (total/parcial) lo calcula la base.</div>
      </div>}

      {nc && <div style={S.card}>
        <h3 style={S.h3}>Solicitar nota de crédito / débito</h3>
        <div style={S.fila}>
          <select style={S.input} value={nc.tipo} onChange={e => setNc({ ...nc, tipo: e.target.value })}>
            {[['3', 'NC A'], ['2', 'ND A'], ['8', 'NC B'], ['7', 'ND B'], ['203', 'NC FCE A'], ['202', 'ND FCE A']].map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
          <input style={{ ...S.input, width: 140 }} placeholder="Neto" value={nc.neto} onChange={e => setNc({ ...nc, neto: e.target.value })} />
          <input style={{ ...S.input, width: 140 }} placeholder="IVA" value={nc.iva} onChange={e => setNc({ ...nc, iva: e.target.value })} />
          <input style={S.input} placeholder="Motivo (obligatorio)" value={nc.motivo} onChange={e => setNc({ ...nc, motivo: e.target.value })} />
          <button style={S.btn} onClick={() => correr(async () => {
            await rpc('fact_nota_solicitar', { p_comprobante_id: nc.id, p_tipo: Number(nc.tipo), p_neto_c: centavosDe(nc.neto), p_iva_c: centavosDe(nc.iva) ?? 0, p_motivo: nc.motivo, p_ambiente: 'produccion' })
            setNc(null); await cargar()
          }, 'Nota solicitada: queda pendiente de aprobación antes de emitir')}>Solicitar</button>
          <button style={S.btn2} onClick={() => setNc(null)}>Cancelar</button>
        </div>
      </div>}
    </div>
  )
}
