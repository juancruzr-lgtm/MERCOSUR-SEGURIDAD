'use client'
// Clientes (CUIT + razón social), alias, contactos, contratos, tarifas con
// vigencia y órdenes de compra. Todo cambio queda en el historial.
import { useEffect, useState } from 'react'
import { leer, rpc, MODALIDADES, REQUISITOS } from '@/lib/facturacion/datos'
import { cuitValido } from '@/lib/facturacion/comprobantes'
import { S, centavosDe, fecha, pesos, useAccion } from './comun'
import { CONDICIONES_IVA, CondicionesContrato, DatosEmisor, DatosFiscalesCliente, resumenCondiciones } from './Condiciones'

const CONTRATO_VACIO = {
  nombre: '', modalidad: 'por_hora', agrupacion: 'cliente', regla_periodo: 'mes_calendario', dia_corte: '', separar_diurna_nocturna: false, superposicion: 'unir',
  franja_nocturna_desde: '', franja_nocturna_hasta: '', dias_vencimiento: '', requisitos: [] as string[], canal_entrega: 'email',
  envio_conjunto_planilla: false, requiere_portal: false, tipo_comprobante: '', pendientes: '', vigencia_desde: '', vigencia_hasta: '', estado: 'borrador', notas: '',
}

export default function Maestros() {
  const [clientes, setClientes] = useState<any[]>([])
  const [objetivos, setObjetivos] = useState<any[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [nuevo, setNuevo] = useState({ razon_social: '', cuit: '', condicion_iva: '', domicilio: '' })
  const { ocupado, correr, Mensaje } = useAccion()

  async function cargar() {
    setClientes(await leer('fact_clientes', q => q.order('razon_social')))
    setObjetivos(await leer('objetivos', q => q.order('nombre'), 'id, nombre, cliente, estado'))
  }
  useEffect(() => { correr(cargar) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <DatosEmisor />
      <div style={S.card}>
        <h3 style={S.h3}>Clientes</h3>
        <div style={S.fila}>
          <input style={S.input} placeholder="Razón social" value={nuevo.razon_social} onChange={e => setNuevo({ ...nuevo, razon_social: e.target.value })} />
          <input style={S.input} placeholder="CUIT" value={nuevo.cuit} onChange={e => setNuevo({ ...nuevo, cuit: e.target.value })} />
          {nuevo.cuit && !cuitValido(nuevo.cuit) && <span style={S.err}>CUIT inválido</span>}
          <select style={S.input} value={nuevo.condicion_iva} onChange={e => setNuevo({ ...nuevo, condicion_iva: e.target.value })}>
            <option value="">Condición frente al IVA…</option>{Object.entries(CONDICIONES_IVA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input style={S.input} placeholder="Domicilio" value={nuevo.domicilio} onChange={e => setNuevo({ ...nuevo, domicilio: e.target.value })} />
          <button style={S.btn} disabled={ocupado || !nuevo.razon_social} onClick={() => correr(async () => {
            await rpc('fact_cliente_guardar', { p_id: null, p_datos: nuevo }); setNuevo({ razon_social: '', cuit: '', condicion_iva: '', domicilio: '' }); await cargar()
          }, 'Cliente creado')}>Agregar cliente</button>
          <Mensaje />
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
          <thead><tr>{['Razón social', 'CUIT', 'IVA', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>{clientes.map(c => (
            <tr key={c.id} style={{ background: c.id === sel ? '#111c35' : undefined }}>
              <td style={S.td}>{c.razon_social}{!c.activo && <span style={S.sub}> (inactivo)</span>}</td>
              <td style={S.td}>{c.cuit ?? <span style={S.err}>sin CUIT</span>}</td>
              <td style={S.td}>{c.condicion_iva ? CONDICIONES_IVA[c.condicion_iva] : <span style={S.err}>sin cargar</span>}</td>
              <td style={S.td}><button style={S.btn2} onClick={() => setSel(c.id === sel ? null : c.id)}>{c.id === sel ? 'Cerrar' : 'Abrir'}</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {sel && <FichaCliente cliente={clientes.find(c => c.id === sel)} objetivos={objetivos} alCambiar={() => correr(cargar)} />}
    </div>
  )
}

function FichaCliente({ cliente, objetivos, alCambiar }: { cliente: any; objetivos: any[]; alCambiar: () => void }) {
  const [d, setD] = useState<{ alias: any[]; contactos: any[]; contratos: any[]; tarifas: any[]; vinc: any[]; ocs: any[] }>({ alias: [], contactos: [], contratos: [], tarifas: [], vinc: [], ocs: [] })
  const [alias, setAlias] = useState({ alias: '', origen: 'planilla', confirmado: false })
  const [contacto, setContacto] = useState({ nombre: '', email: '', rol: 'destinatario_factura', objetivo_id: '' })
  const [k, setK] = useState<any>(CONTRATO_VACIO)
  const [kId, setKId] = useState<string | null>(null)
  const [condId, setCondId] = useState<string | null>(null)
  const [tar, setTar] = useState({ contrato_id: '', objetivo_id: '', concepto: 'hora', precio: '', iva: 'sin_definir', alicuota: '21', desde: '', motivo: '' })
  const [vinc, setVinc] = useState({ contrato_id: '', objetivo_id: '', desde: '', hasta: '' })
  const [oc, setOc] = useState({ tipo: 'orden_compra', numero: '', fecha: '', vigencia_desde: '', vigencia_hasta: '', monto: '', monto_con_iva: true, horas: '', aceptado_at: '', condiciones: '', objetivos: [] as string[] })
  const { ocupado, correr, Mensaje } = useAccion()

  async function cargar() {
    const contratos = await leer('fact_contratos', q => q.eq('cliente_id', cliente.id).order('created_at'))
    const ids = contratos.map(x => x.id)
    const [aliasL, contactos, tarifas, vincL, ocs] = await Promise.all([
      leer('fact_cliente_alias', q => q.eq('cliente_id', cliente.id).is('anulado_at', null)),
      leer('fact_contactos', q => q.eq('cliente_id', cliente.id)),
      ids.length ? leer('fact_tarifas', q => q.in('contrato_id', ids).order('vigencia_desde')) : Promise.resolve([]),
      ids.length ? leer('fact_contrato_objetivos', q => q.in('contrato_id', ids).is('anulado_at', null), '*, objetivo:objetivos(nombre)') : Promise.resolve([]),
      leer('fact_ordenes_compra', q => q.eq('cliente_id', cliente.id).order('created_at'), '*, objetivos:fact_oc_objetivos(objetivo_id), consumos:fact_oc_consumos(neto_c, total_c, anulado_at)'),
    ])
    setD({ alias: aliasL, contactos, contratos, tarifas, vinc: vincL, ocs })
  }
  useEffect(() => { correr(cargar) }, [cliente.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const hecho = async () => { await cargar(); alCambiar() }
  const nombreObj = (id: string) => objetivos.find(o => o.id === id)?.nombre ?? id

  return (
    <div style={S.card}>
      <h3 style={S.h3}>{cliente.razon_social} · {cliente.cuit ?? 'sin CUIT'}</h3>
      <Mensaje />
      <DatosFiscalesCliente key={cliente.version} cliente={cliente} alGuardar={alCambiar} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        <div>
          <h4 style={S.sub}>ALIAS (planillas, banco, documentos)</h4>
          {d.alias.map(a => <div key={a.id} style={{ ...S.fila, fontSize: 13 }}>{a.alias} <span style={S.sub}>{a.origen} · {a.confirmado ? 'confirmado' : 'SIN CONFIRMAR'}</span>
            <button style={S.btnPeligro} onClick={() => correr(async () => { await rpc('fact_alias_anular', { p_id: a.id, p_motivo: 'Anulado desde la ficha' }); await hecho() })}>×</button></div>)}
          <div style={S.fila}>
            <input style={S.input} placeholder="Alias" value={alias.alias} onChange={e => setAlias({ ...alias, alias: e.target.value })} />
            <select style={S.input} value={alias.origen} onChange={e => setAlias({ ...alias, origen: e.target.value })}>{['planilla', 'banco', 'documento', 'arca', 'otro'].map(x => <option key={x}>{x}</option>)}</select>
            <label style={S.sub}><input type="checkbox" checked={alias.confirmado} onChange={e => setAlias({ ...alias, confirmado: e.target.checked })} /> confirmado</label>
            <button style={S.btn2} onClick={() => correr(async () => { await rpc('fact_alias_guardar', { p_cliente_id: cliente.id, p_alias: alias.alias, p_origen: alias.origen, p_confirmado: alias.confirmado, p_nota: null }); setAlias({ alias: '', origen: 'planilla', confirmado: false }); await hecho() })}>Agregar</button>
          </div>
          <div style={S.sub}>Sólo los alias confirmados identifican al cliente en la conciliación.</div>

          <h4 style={{ ...S.sub, marginTop: 12 }}>CONTACTOS Y DESTINATARIOS</h4>
          {d.contactos.map(c => <div key={c.id} style={{ fontSize: 13 }}>{c.nombre} · {c.email ?? '—'} · {c.rol}{c.objetivo_id ? ` · ${nombreObj(c.objetivo_id)}` : ''}{!c.activo && ' (inactivo)'}</div>)}
          <div style={S.fila}>
            <input style={S.input} placeholder="Nombre" value={contacto.nombre} onChange={e => setContacto({ ...contacto, nombre: e.target.value })} />
            <input style={S.input} placeholder="Email" value={contacto.email} onChange={e => setContacto({ ...contacto, email: e.target.value })} />
            <select style={S.input} value={contacto.rol} onChange={e => setContacto({ ...contacto, rol: e.target.value })}>{['destinatario_factura', 'autorizado_conformidad', 'pagos', 'otro'].map(x => <option key={x}>{x}</option>)}</select>
            <select style={S.input} value={contacto.objetivo_id} onChange={e => setContacto({ ...contacto, objetivo_id: e.target.value })}>
              <option value="">Todos los objetivos</option>{d.vinc.map(v => <option key={v.objetivo_id} value={v.objetivo_id}>{v.objetivo?.nombre}</option>)}
            </select>
            <button style={S.btn2} onClick={() => correr(async () => { await rpc('fact_contacto_guardar', { p_id: null, p_datos: { ...contacto, cliente_id: cliente.id } }); setContacto({ nombre: '', email: '', rol: 'destinatario_factura', objetivo_id: '' }); await hecho() })}>Agregar</button>
          </div>
        </div>

        <div>
          <h4 style={S.sub}>CONTRATOS</h4>
          {d.contratos.map(x => (
            <div key={x.id} style={{ fontSize: 13, marginBottom: 4 }}>
              <b>{x.nombre}</b> · {MODALIDADES[x.modalidad]} · {x.agrupacion === 'objetivo' ? 'factura por objetivo' : 'factura por cliente'} · {x.regla_periodo === 'corte' ? `del ${x.dia_corte} al ${x.dia_corte - 1}` : 'mes calendario'} · {x.estado}
              {x.requisitos?.length > 0 && <span style={S.sub}> · requiere {x.requisitos.map((r: string) => REQUISITOS[r]).join(', ')}</span>}
              <button style={{ ...S.btn2, marginLeft: 6, padding: '2px 8px' }} onClick={() => { setKId(x.id); setK({ ...CONTRATO_VACIO, ...x, dia_corte: x.dia_corte ?? '', dias_vencimiento: x.dias_vencimiento ?? '', tipo_comprobante: x.tipo_comprobante ?? '', franja_nocturna_desde: x.franja_nocturna_desde ?? '', franja_nocturna_hasta: x.franja_nocturna_hasta ?? '', vigencia_desde: x.vigencia_desde ?? '', vigencia_hasta: x.vigencia_hasta ?? '', pendientes: (x.pendientes_comerciales ?? []).join('\n'), notas: x.notas ?? '' }) }}>Editar</button>
              <button style={{ ...S.btn2, marginLeft: 6, padding: '2px 8px' }} onClick={() => setCondId(condId === x.id ? null : x.id)}>Pago y mora</button>
              <div style={{ ...S.sub, color: x.pago_evento ? '#64748b' : '#fbbf24' }}>{resumenCondiciones(x)}</div>
              {condId === x.id && <CondicionesContrato key={x.version} contrato={x} alGuardar={() => { setCondId(null); hecho() }} />}
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
            <input style={S.input} placeholder="Nombre del contrato" value={k.nombre} onChange={e => setK({ ...k, nombre: e.target.value })} />
            <select style={S.input} value={k.modalidad} onChange={e => setK({ ...k, modalidad: e.target.value })}>{Object.entries(MODALIDADES).map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select>
            <select style={S.input} value={k.agrupacion} onChange={e => setK({ ...k, agrupacion: e.target.value })}><option value="cliente">Una factura por cliente</option><option value="objetivo">Una factura por objetivo</option></select>
            <select style={S.input} value={k.regla_periodo} onChange={e => setK({ ...k, regla_periodo: e.target.value })}><option value="mes_calendario">Mes calendario</option><option value="corte">Corte (día N al N-1)</option></select>
            {k.regla_periodo === 'corte' && <input style={S.input} placeholder="Día de inicio (p. ej. 26)" value={k.dia_corte} onChange={e => setK({ ...k, dia_corte: e.target.value })} />}
            <input style={S.input} placeholder="Plazo de pago (días)" value={k.dias_vencimiento} onChange={e => setK({ ...k, dias_vencimiento: e.target.value })} />
            <select style={S.input} value={k.tipo_comprobante} onChange={e => setK({ ...k, tipo_comprobante: e.target.value })}><option value="">Comprobante según IVA del cliente</option><option value="1">Factura A</option><option value="6">Factura B</option><option value="201">FCE A</option></select>
            <select style={S.input} value={k.canal_entrega} onChange={e => setK({ ...k, canal_entrega: e.target.value })}>{['email', 'portal', 'papel'].map(x => <option key={x}>{x}</option>)}</select>
            <label style={S.sub}><input type="checkbox" checked={k.separar_diurna_nocturna} onChange={e => setK({ ...k, separar_diurna_nocturna: e.target.checked })} /> Separar diurnas / nocturnas</label>
            {k.separar_diurna_nocturna && <div style={S.fila}><input style={{ ...S.input, width: 90 }} type="time" value={k.franja_nocturna_desde} onChange={e => setK({ ...k, franja_nocturna_desde: e.target.value })} /> a <input style={{ ...S.input, width: 90 }} type="time" value={k.franja_nocturna_hasta} onChange={e => setK({ ...k, franja_nocturna_hasta: e.target.value })} /><span style={S.sub}>franja CONTRACTUAL</span></div>}
            <select style={S.input} value={k.superposicion} onChange={e => setK({ ...k, superposicion: e.target.value })} title="Turnos superpuestos del mismo puesto"><option value="unir">Relevos superpuestos: facturar una vez</option><option value="sumar">Superposición: sumar (sólo si el contrato lo prevé)</option></select>
            <label style={S.sub}><input type="checkbox" checked={k.envio_conjunto_planilla} onChange={e => setK({ ...k, envio_conjunto_planilla: e.target.checked })} /> Planilla + factura juntas</label>
            <label style={S.sub}><input type="checkbox" checked={k.requiere_portal} onChange={e => setK({ ...k, requiere_portal: e.target.checked })} /> Presentar en portal tras emitir</label>
            <div style={{ gridColumn: '1 / -1', ...S.fila }}>{Object.entries(REQUISITOS).map(([r, t]) => (
              <label key={r} style={S.sub}><input type="checkbox" checked={k.requisitos.includes(r)} onChange={e => setK({ ...k, requisitos: e.target.checked ? [...k.requisitos, r] : k.requisitos.filter((x: string) => x !== r) })} /> {t}</label>
            ))}</div>
            <input style={S.input} type="date" title="Vigencia desde" value={k.vigencia_desde} onChange={e => setK({ ...k, vigencia_desde: e.target.value })} />
            <input style={S.input} type="date" title="Vigencia hasta" value={k.vigencia_hasta} onChange={e => setK({ ...k, vigencia_hasta: e.target.value })} />
            <textarea style={{ ...S.input, gridColumn: '1 / -1' }} placeholder="Definiciones comerciales pendientes (una por línea; quedan como requisito)" value={k.pendientes} onChange={e => setK({ ...k, pendientes: e.target.value })} />
            <select style={S.input} value={k.estado} onChange={e => setK({ ...k, estado: e.target.value })}>{['borrador', 'vigente', 'finalizado'].map(x => <option key={x}>{x}</option>)}</select>
            <div style={S.fila}>
              <button style={S.btn} disabled={ocupado || !k.nombre} onClick={() => correr(async () => {
                const datos = { ...k, cliente_id: cliente.id, pendientes_comerciales: String(k.pendientes).split('\n').map((s: string) => s.trim()).filter(Boolean) }
                await rpc('fact_contrato_guardar', { p_id: kId, p_datos: datos, p_version: kId ? k.version : null }); setK(CONTRATO_VACIO); setKId(null); await hecho()
              }, 'Contrato guardado')}>{kId ? 'Guardar cambios' : 'Crear contrato'}</button>
              {kId && <button style={S.btn2} onClick={() => { setK(CONTRATO_VACIO); setKId(null) }}>Cancelar</button>}
            </div>
          </div>

          <h4 style={{ ...S.sub, marginTop: 12 }}>OBJETIVOS DEL CONTRATO (con fechas de servicio)</h4>
          {d.vinc.map(v => <div key={v.id} style={{ fontSize: 13 }}>{v.objetivo?.nombre} · {d.contratos.find(x => x.id === v.contrato_id)?.nombre} · {fecha(v.desde)} a {v.hasta ? fecha(v.hasta) : 'vigente'}</div>)}
          <div style={S.fila}>
            <select style={S.input} value={vinc.contrato_id} onChange={e => setVinc({ ...vinc, contrato_id: e.target.value })}><option value="">Contrato…</option>{d.contratos.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
            <select style={S.input} value={vinc.objetivo_id} onChange={e => setVinc({ ...vinc, objetivo_id: e.target.value })}><option value="">Objetivo…</option>{objetivos.map(o => <option key={o.id} value={o.id}>{o.nombre} ({o.cliente})</option>)}</select>
            <input style={S.input} type="date" title="Inicio del servicio" value={vinc.desde} onChange={e => setVinc({ ...vinc, desde: e.target.value })} />
            <input style={S.input} type="date" title="Fin del servicio" value={vinc.hasta} onChange={e => setVinc({ ...vinc, hasta: e.target.value })} />
            <button style={S.btn2} onClick={() => correr(async () => { await rpc('fact_contrato_objetivo_vincular', { p_contrato_id: vinc.contrato_id, p_objetivo_id: vinc.objetivo_id, p_desde: vinc.desde || null, p_hasta: vinc.hasta || null }); await hecho() })}>Vincular</button>
          </div>
        </div>

        <div>
          <h4 style={S.sub}>TARIFAS (no se editan: se carga la nueva y cierra la anterior)</h4>
          {d.tarifas.map(t => <div key={t.id} style={{ fontSize: 13 }}>{t.concepto} {t.objetivo_id ? `(${nombreObj(t.objetivo_id)})` : ''}: $ {t.precio} · IVA {t.tratamiento_iva === 'sin_definir' ? <b style={{ color: '#fbbf24' }}>SIN DEFINIR</b> : `${t.tratamiento_iva} ${t.alicuota_iva}%`} · {fecha(t.vigencia_desde)} a {t.vigencia_hasta ? fecha(t.vigencia_hasta) : 'vigente'}</div>)}
          <div style={S.fila}>
            <select style={S.input} value={tar.contrato_id} onChange={e => setTar({ ...tar, contrato_id: e.target.value })}><option value="">Contrato…</option>{d.contratos.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
            <select style={S.input} value={tar.objetivo_id} onChange={e => setTar({ ...tar, objetivo_id: e.target.value })}><option value="">Todo el contrato</option>{d.vinc.map(v => <option key={v.objetivo_id} value={v.objetivo_id}>{v.objetivo?.nombre}</option>)}</select>
            <select style={S.input} value={tar.concepto} onChange={e => setTar({ ...tar, concepto: e.target.value })}>{['hora', 'hora_diurna', 'hora_nocturna', 'abono'].map(x => <option key={x}>{x}</option>)}</select>
            <input style={{ ...S.input, width: 140 }} placeholder="Precio (tal cual contrato)" value={tar.precio} onChange={e => setTar({ ...tar, precio: e.target.value })} />
            <select style={S.input} value={tar.iva} onChange={e => setTar({ ...tar, iva: e.target.value })}><option value="sin_definir">IVA: sin definir</option><option value="adicional">+ IVA</option><option value="incluido">IVA incluido</option><option value="exento">Exento</option></select>
            <select style={S.input} value={tar.alicuota} onChange={e => setTar({ ...tar, alicuota: e.target.value })}>{['21', '10.5', '27', '0'].map(x => <option key={x}>{x}</option>)}</select>
            <input style={S.input} type="date" value={tar.desde} onChange={e => setTar({ ...tar, desde: e.target.value })} />
            <input style={S.input} placeholder="Motivo / respaldo" value={tar.motivo} onChange={e => setTar({ ...tar, motivo: e.target.value })} />
            <button style={S.btn2} onClick={() => correr(async () => {
              await rpc('fact_tarifa_agregar', { p_contrato_id: tar.contrato_id, p_objetivo_id: tar.objetivo_id || null, p_concepto: tar.concepto, p_precio: tar.precio.replace(',', '.'),
                p_tratamiento_iva: tar.iva, p_alicuota: tar.alicuota, p_desde: tar.desde, p_motivo: tar.motivo }); await hecho()
            }, 'Tarifa cargada')}>Agregar tarifa</button>
          </div>

          <h4 style={{ ...S.sub, marginTop: 12 }}>ÓRDENES DE COMPRA / LICITACIONES / PRESUPUESTOS</h4>
          {d.ocs.map(o => {
            const conIva = o.monto_total_c != null
            const monto = conIva ? o.monto_total_c : o.monto_neto_c
            const consumido = (o.consumos ?? []).filter((c: any) => !c.anulado_at).reduce((a: number, c: any) => a + Number(conIva ? c.total_c : c.neto_c), 0)
            return <div key={o.id} style={{ fontSize: 13 }}>{o.tipo} {o.numero} · {fecha(o.vigencia_desde)} a {fecha(o.vigencia_hasta)} · monto {conIva ? 'con IVA' : 'neto'} {pesos(monto)} · consumido {pesos(consumido)}{monto ? ` · saldo ${pesos(Number(monto) - consumido)}` : ''}{o.horas ? ` · ${o.horas} h` : ''} · {o.objetivos?.length ? o.objetivos.map((x: any) => nombreObj(x.objetivo_id)).join(', ') : 'todos los objetivos'} · {o.estado}</div>
          })}
          <div style={S.fila}>
            <select style={S.input} value={oc.tipo} onChange={e => setOc({ ...oc, tipo: e.target.value })}>{['orden_compra', 'licitacion', 'presupuesto'].map(x => <option key={x}>{x}</option>)}</select>
            <input style={{ ...S.input, width: 110 }} placeholder="Número" value={oc.numero} onChange={e => setOc({ ...oc, numero: e.target.value })} />
            <input style={S.input} type="date" title="Vigencia desde" value={oc.vigencia_desde} onChange={e => setOc({ ...oc, vigencia_desde: e.target.value })} />
            <input style={S.input} type="date" title="Vigencia hasta" value={oc.vigencia_hasta} onChange={e => setOc({ ...oc, vigencia_hasta: e.target.value })} />
            <input style={{ ...S.input, width: 140 }} placeholder="Monto de la OC" value={oc.monto} onChange={e => setOc({ ...oc, monto: e.target.value })} />
            {oc.tipo !== 'presupuesto' && <select style={S.input} value={oc.monto_con_iva ? 'si' : 'no'} onChange={e => setOc({ ...oc, monto_con_iva: e.target.value === 'si' })}>
              <option value="si">monto con IVA</option><option value="no">monto sin IVA</option></select>}
            <input style={{ ...S.input, width: 80 }} placeholder="Horas" value={oc.horas} onChange={e => setOc({ ...oc, horas: e.target.value })} />
            {oc.tipo === 'presupuesto' && <input style={S.input} type="date" title="Aceptado el" value={oc.aceptado_at} onChange={e => setOc({ ...oc, aceptado_at: e.target.value })} />}
            <select multiple style={{ ...S.input, minWidth: 180 }} value={oc.objetivos} onChange={e => setOc({ ...oc, objetivos: Array.from(e.target.selectedOptions).map(o => o.value) })}>
              {d.vinc.map(v => <option key={v.objetivo_id} value={v.objetivo_id}>{v.objetivo?.nombre}</option>)}
            </select>
            <button style={S.btn2} onClick={() => correr(async () => {
              await rpc('fact_oc_guardar', { p_id: null, p_datos: { ...oc, cliente_id: cliente.id, ...(oc.monto_con_iva && oc.tipo !== 'presupuesto'
                ? { monto_total_c: oc.monto ? centavosDe(oc.monto) : null, monto_neto_c: null }
                : { monto_neto_c: oc.monto ? centavosDe(oc.monto) : null, monto_total_c: null }), horas: oc.horas || null }, p_objetivos: oc.objetivos, p_version: null })
              setOc({ tipo: 'orden_compra', numero: '', fecha: '', vigencia_desde: '', vigencia_hasta: '', monto: '', monto_con_iva: true, horas: '', aceptado_at: '', condiciones: '', objetivos: [] }); await hecho()
            }, 'OC guardada (una sola, aunque cubra varios objetivos)')}>Agregar</button>
          </div>
        </div>
      </div>
    </div>
  )
}
