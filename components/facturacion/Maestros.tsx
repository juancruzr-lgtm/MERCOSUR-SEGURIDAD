'use client'
// Clientes (CUIT + razón social), alias, contactos, contratos, tarifas con
// vigencia y órdenes de compra. Todo cambio queda en el historial.
import { Fragment, useEffect, useState } from 'react'
import { leer, rpc, MODALIDADES, REQUISITOS } from '@/lib/facturacion/datos'
import { cuitValido } from '@/lib/facturacion/comprobantes'
import { PLAZO_PAGO_POR_DEFECTO } from '@/lib/facturacion/vto-arca'
import { S, centavosDe, fecha, pesos, useAccion } from './comun'
import { DiagnosticoArca } from './DiagnosticoArca'
import { CONDICIONES_IVA, CondicionesContrato, DatosEmisor, DatosFiscalesCliente, resumenCondiciones } from './Condiciones'

const CONTRATO_VACIO = {
  nombre: '', modalidad: 'por_hora', agrupacion: 'cliente', regla_periodo: 'mes_calendario', dia_corte: '', separar_diurna_nocturna: false, superposicion: 'unir',
  // Plazo de pago: 30 días por defecto (Gerencia, 10/11/2026); se cambia si el contrato dice otro.
  franja_nocturna_desde: '', franja_nocturna_hasta: '', dias_vencimiento: String(PLAZO_PAGO_POR_DEFECTO), requisitos: [] as string[], canal_entrega: 'email',
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
      <DiagnosticoArca />
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

// Ficha en una sola columna: cada contrato con sus tarifas y objetivos debajo;
// los formularios quedan plegados y se abre uno por vez.
const CAMPO: React.CSSProperties = { ...S.input, width: '100%', boxSizing: 'border-box', minWidth: 0 }
const GRILLA: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, alignItems: 'end', marginTop: 8 }
const BLOQUE: React.CSSProperties = { border: '1px solid #1e293b', borderRadius: 8, padding: 12, marginTop: 10, background: '#0b1222' }
const FORM: React.CSSProperties = { border: '1px dashed #334155', borderRadius: 8, padding: 10, marginTop: 8 }
const CHICO: React.CSSProperties = { ...S.btn2, padding: '4px 10px', fontSize: 12 }
const TITULO: React.CSSProperties = { margin: '18px 0 4px', fontSize: 12, letterSpacing: 0.5, color: '#94a3b8' }
const TARIFA_VACIA = { contrato_id: '', objetivo_id: '', concepto: 'hora', precio: '', iva: 'sin_definir', alicuota: '21', desde: '', motivo: '' }
const VINC_VACIO = { contrato_id: '', objetivo_id: '', desde: '', hasta: '' }
const OC_VACIA = { tipo: 'orden_compra', numero: '', fecha: '', vigencia_desde: '', vigencia_hasta: '', monto: '', monto_con_iva: true, horas: '', aceptado_at: '', condiciones: '', objetivos: [] as string[] }

function Campo({ t, ancho, children }: { t: string; ancho?: boolean; children: React.ReactNode }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#64748b', ...(ancho ? { gridColumn: '1 / -1' } : {}) }}>{t}{children}</label>
}

function Tilde({ t, v, set }: { t: string; v: boolean; set: (v: boolean) => void }) {
  return <label style={{ ...S.sub, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={v} onChange={e => set(e.target.checked)} /> {t}</label>
}

function FichaCliente({ cliente, objetivos, alCambiar }: { cliente: any; objetivos: any[]; alCambiar: () => void }) {
  const [d, setD] = useState<{ alias: any[]; contactos: any[]; contratos: any[]; tarifas: any[]; vinc: any[]; ocs: any[] }>({ alias: [], contactos: [], contratos: [], tarifas: [], vinc: [], ocs: [] })
  const [alias, setAlias] = useState({ alias: '', origen: 'planilla', confirmado: false })
  const [contacto, setContacto] = useState({ nombre: '', email: '', rol: 'destinatario_factura', objetivo_id: '' })
  const [k, setK] = useState<any>(CONTRATO_VACIO)
  const [kId, setKId] = useState<string | null>(null)
  const [tar, setTar] = useState(TARIFA_VACIA)
  const [vinc, setVinc] = useState(VINC_VACIO)
  const [oc, setOc] = useState(OC_VACIA)
  const [panel, setPanel] = useState<string | null>(null)
  const [grupos, setGrupos] = useState<Record<string, string>>({})
  // Texto del renglón de cada objetivo en la factura (borrador local hasta salir del campo).
  const [textos, setTextos] = useState<Record<string, string>>({})
  const { ocupado, correr, Mensaje } = useAccion()
  const alternar = (p: string) => setPanel(panel === p ? null : p)

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
  useEffect(() => { setPanel(null); correr(cargar) }, [cliente.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const hecho = async () => { await cargar(); alCambiar() }
  const nombreObj = (id: string) => objetivos.find(o => o.id === id)?.nombre ?? id

  function editarContrato(x: any) {
    setKId(x.id)
    setK({ ...CONTRATO_VACIO, ...x, dia_corte: x.dia_corte ?? '', dias_vencimiento: x.dias_vencimiento ?? '', tipo_comprobante: x.tipo_comprobante ?? '', franja_nocturna_desde: x.franja_nocturna_desde ?? '', franja_nocturna_hasta: x.franja_nocturna_hasta ?? '', vigencia_desde: x.vigencia_desde ?? '', vigencia_hasta: x.vigencia_hasta ?? '', pendientes: (x.pendientes_comerciales ?? []).join('\n'), notas: x.notas ?? '' })
    setPanel('contrato')
  }
  function cerrarContrato() { setK(CONTRATO_VACIO); setKId(null); setPanel(null) }

  const formContrato = (
    <div style={FORM}>
      <b style={{ fontSize: 13 }}>{kId ? `Editar contrato: ${k.nombre}` : 'Nuevo contrato'}</b>
      <div style={GRILLA}>
        <Campo t="Nombre del contrato"><input style={CAMPO} value={k.nombre} onChange={e => setK({ ...k, nombre: e.target.value })} /></Campo>
        <Campo t="Modalidad"><select style={CAMPO} value={k.modalidad} onChange={e => setK({ ...k, modalidad: e.target.value })}>{Object.entries(MODALIDADES).map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select></Campo>
        <Campo t="Facturación"><select style={CAMPO} value={k.agrupacion} onChange={e => setK({ ...k, agrupacion: e.target.value })}><option value="cliente">Una factura por cliente</option><option value="objetivo">Una factura por objetivo</option></select></Campo>
        <Campo t="Período"><select style={CAMPO} value={k.regla_periodo} onChange={e => setK({ ...k, regla_periodo: e.target.value })}><option value="mes_calendario">Mes calendario</option><option value="corte">Corte (día N al N-1)</option></select></Campo>
        {k.regla_periodo === 'corte' && <Campo t="Día de inicio del corte"><input style={CAMPO} placeholder="p. ej. 26" value={k.dia_corte} onChange={e => setK({ ...k, dia_corte: e.target.value })} /></Campo>}
        <Campo t="Plazo de pago (días)"><input style={CAMPO} placeholder={`${PLAZO_PAGO_POR_DEFECTO} si no dice otro`} value={k.dias_vencimiento} onChange={e => setK({ ...k, dias_vencimiento: e.target.value })} /></Campo>
        <Campo t="Comprobante"><select style={CAMPO} value={k.tipo_comprobante} onChange={e => setK({ ...k, tipo_comprobante: e.target.value })}><option value="">Según IVA del cliente</option><option value="1">Factura A</option><option value="6">Factura B</option><option value="201">FCE A</option></select></Campo>
        <Campo t="Entrega"><select style={CAMPO} value={k.canal_entrega} onChange={e => setK({ ...k, canal_entrega: e.target.value })}>{['email', 'portal', 'papel'].map(x => <option key={x}>{x}</option>)}</select></Campo>
        <Campo t="Turnos superpuestos del mismo puesto"><select style={CAMPO} value={k.superposicion} onChange={e => setK({ ...k, superposicion: e.target.value })}><option value="unir">Facturar una vez</option><option value="sumar">Sumar (sólo si el contrato lo prevé)</option></select></Campo>
        <Campo t="Vigencia desde"><input style={CAMPO} type="date" value={k.vigencia_desde} onChange={e => setK({ ...k, vigencia_desde: e.target.value })} /></Campo>
        <Campo t="Vigencia hasta"><input style={CAMPO} type="date" value={k.vigencia_hasta} onChange={e => setK({ ...k, vigencia_hasta: e.target.value })} /></Campo>
        <Campo t="Estado"><select style={CAMPO} value={k.estado} onChange={e => setK({ ...k, estado: e.target.value })}>{['borrador', 'vigente', 'finalizado'].map(x => <option key={x}>{x}</option>)}</select></Campo>
      </div>
      <div style={{ ...S.fila, marginTop: 10, gap: 16 }}>
        <Tilde t="Separar diurnas / nocturnas" v={k.separar_diurna_nocturna} set={v => setK({ ...k, separar_diurna_nocturna: v })} />
        {k.separar_diurna_nocturna && <span style={S.fila}><span style={S.sub}>Franja nocturna contractual</span>
          <input style={{ ...S.input, width: 100 }} type="time" value={k.franja_nocturna_desde} onChange={e => setK({ ...k, franja_nocturna_desde: e.target.value })} /> a
          <input style={{ ...S.input, width: 100 }} type="time" value={k.franja_nocturna_hasta} onChange={e => setK({ ...k, franja_nocturna_hasta: e.target.value })} /></span>}
        <Tilde t="Planilla + factura juntas" v={k.envio_conjunto_planilla} set={v => setK({ ...k, envio_conjunto_planilla: v })} />
        <Tilde t="Presentar en portal tras emitir" v={k.requiere_portal} set={v => setK({ ...k, requiere_portal: v })} />
      </div>
      <div style={{ ...S.fila, marginTop: 8, gap: 16 }}><span style={S.sub}>Requiere:</span>{Object.entries(REQUISITOS).map(([r, t]) => (
        <Tilde key={r} t={t} v={k.requisitos.includes(r)} set={v => setK({ ...k, requisitos: v ? [...k.requisitos, r] : k.requisitos.filter((x: string) => x !== r) })} />
      ))}</div>
      <div style={{ ...GRILLA, gridTemplateColumns: '1fr' }}>
        <Campo t="Definiciones comerciales pendientes (una por línea)"><textarea style={{ ...CAMPO, minHeight: 70 }} value={k.pendientes} onChange={e => setK({ ...k, pendientes: e.target.value })} /></Campo>
      </div>
      <div style={{ ...S.fila, marginTop: 8 }}>
        <button style={S.btn} disabled={ocupado || !k.nombre} onClick={() => correr(async () => {
          const datos = { ...k, cliente_id: cliente.id, pendientes_comerciales: String(k.pendientes).split('\n').map((s: string) => s.trim()).filter(Boolean) }
          await rpc('fact_contrato_guardar', { p_id: kId, p_datos: datos, p_version: kId ? k.version : null }); cerrarContrato(); await hecho()
        }, 'Contrato guardado')}>{kId ? 'Guardar cambios' : 'Crear contrato'}</button>
        <button style={S.btn2} onClick={cerrarContrato}>Cancelar</button>
      </div>
    </div>
  )

  return (
    <div style={S.card}>
      <div style={{ ...S.fila, justifyContent: 'space-between' }}>
        <h3 style={{ ...S.h3, margin: 0 }}>{cliente.razon_social} <span style={S.sub}>· CUIT {cliente.cuit ?? 'sin cargar'}</span></h3>
      </div>
      <Mensaje />
      <div style={TITULO}>DATOS FISCALES</div>
      <DatosFiscalesCliente key={cliente.version} cliente={cliente} alGuardar={alCambiar} />
      {cliente.notas && <details style={{ marginTop: 6 }}><summary style={{ ...S.sub, cursor: 'pointer' }}>Notas del cliente</summary>
        <div style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'pre-wrap', marginTop: 4 }}>{String(cliente.notas).split(' | ').join('\n')}</div></details>}

      <div style={{ ...S.fila, justifyContent: 'space-between', ...TITULO }}>
        <span>CONTRATOS</span>
        {panel !== 'contrato' && <button style={CHICO} onClick={() => { setK(CONTRATO_VACIO); setKId(null); setPanel('contrato') }}>+ Nuevo contrato</button>}
      </div>
      {!d.contratos.length && <div style={S.sub}>Este cliente todavía no tiene contrato.</div>}
      {d.contratos.map(x => {
        const tarifas = d.tarifas.filter(t => t.contrato_id === x.id)
        const objs = d.vinc.filter(v => v.contrato_id === x.id)
        const pend: string[] = x.pendientes_comerciales ?? []
        return (
          <div key={x.id} style={BLOQUE}>
            <div style={{ ...S.fila, justifyContent: 'space-between' }}>
              <div style={{ fontSize: 14 }}><b>{x.nombre}</b> <span style={{ ...S.sub, color: x.estado === 'vigente' ? '#4ade80' : '#94a3b8' }}>· {x.estado}</span></div>
              <div style={S.fila}>
                <button style={CHICO} onClick={() => editarContrato(x)}>Editar</button>
                <button style={CHICO} onClick={() => alternar(`cond:${x.id}`)}>Pago y mora</button>
              </div>
            </div>
            <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 4 }}>
              {MODALIDADES[x.modalidad]} · {x.agrupacion === 'objetivo' ? 'factura por objetivo' : 'factura por cliente'} · {x.regla_periodo === 'corte' ? `del ${x.dia_corte} al ${x.dia_corte - 1}` : 'mes calendario'}
              {x.separar_diurna_nocturna && ` · nocturna ${x.franja_nocturna_desde?.slice(0, 5) ?? '?'}–${x.franja_nocturna_hasta?.slice(0, 5) ?? '?'}`}
              {x.requisitos?.length > 0 && ` · requiere ${x.requisitos.map((r: string) => REQUISITOS[r]).join(', ')}`}
            </div>
            <div style={{ ...S.sub, color: x.pago_evento ? '#64748b' : '#fbbf24', marginTop: 2 }}>{resumenCondiciones(x)}</div>
            {pend.length > 0 && <details style={{ marginTop: 6 }}><summary style={{ fontSize: 12, color: '#fbbf24', cursor: 'pointer' }}>{pend.length} pendiente(s) comercial(es)</summary>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12, color: '#fbbf24' }}>{pend.map((p, i) => <li key={i}>{p}</li>)}</ul></details>}
            {panel === `cond:${x.id}` && <div style={FORM}><CondicionesContrato key={x.version} contrato={x} alGuardar={() => { setPanel(null); hecho() }} /></div>}

            <div style={{ ...S.fila, justifyContent: 'space-between', marginTop: 12 }}>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>Tarifas <span style={S.sub}>(no se editan: la nueva cierra la anterior)</span></span>
              <button style={CHICO} onClick={() => { setTar({ ...TARIFA_VACIA, contrato_id: x.id }); alternar(`tar:${x.id}`) }}>+ Tarifa</button>
            </div>
            {tarifas.length ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
                <thead><tr>{['Concepto', 'Objetivo', 'Precio', 'IVA', 'Vigencia'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>{tarifas.map(t => (
                  <tr key={t.id} style={{ opacity: t.vigencia_hasta ? 0.55 : 1 }}>
                    <td style={S.td}>{t.concepto}</td>
                    <td style={S.td}>{t.objetivo_id ? nombreObj(t.objetivo_id) : 'todo el contrato'}</td>
                    <td style={S.num}>$ {t.precio}</td>
                    <td style={S.td}>{t.tratamiento_iva === 'sin_definir' ? <b style={{ color: '#fbbf24' }}>SIN DEFINIR</b> : `${t.tratamiento_iva} ${t.alicuota_iva}%`}</td>
                    <td style={S.td}>{fecha(t.vigencia_desde)} a {t.vigencia_hasta ? fecha(t.vigencia_hasta) : 'vigente'}</td>
                  </tr>))}</tbody>
              </table>
            ) : <div style={{ ...S.sub, color: '#fbbf24' }}>Sin tarifa cargada.</div>}
            {panel === `tar:${x.id}` && (
              <div style={FORM}>
                <div style={{ ...GRILLA, marginTop: 0 }}>
                  <Campo t="Objetivo"><select style={CAMPO} value={tar.objetivo_id} onChange={e => setTar({ ...tar, objetivo_id: e.target.value })}><option value="">Todo el contrato</option>{objs.map(v => <option key={v.objetivo_id} value={v.objetivo_id}>{v.objetivo?.nombre}</option>)}</select></Campo>
                  <Campo t="Concepto"><select style={CAMPO} value={tar.concepto} onChange={e => setTar({ ...tar, concepto: e.target.value })}>{['hora', 'hora_diurna', 'hora_nocturna', 'abono'].map(c => <option key={c}>{c}</option>)}</select></Campo>
                  <Campo t="Precio (tal cual contrato)"><input style={CAMPO} value={tar.precio} onChange={e => setTar({ ...tar, precio: e.target.value })} /></Campo>
                  <Campo t="IVA"><select style={CAMPO} value={tar.iva} onChange={e => setTar({ ...tar, iva: e.target.value as any })}><option value="sin_definir">sin definir</option><option value="adicional">+ IVA</option><option value="incluido">IVA incluido</option><option value="exento">Exento</option></select></Campo>
                  <Campo t="Alícuota %"><select style={CAMPO} value={tar.alicuota} onChange={e => setTar({ ...tar, alicuota: e.target.value })}>{['21', '10.5', '27', '0'].map(a => <option key={a}>{a}</option>)}</select></Campo>
                  <Campo t="Vigente desde"><input style={CAMPO} type="date" value={tar.desde} onChange={e => setTar({ ...tar, desde: e.target.value })} /></Campo>
                  <Campo t="Motivo / respaldo" ancho><input style={CAMPO} value={tar.motivo} onChange={e => setTar({ ...tar, motivo: e.target.value })} /></Campo>
                </div>
                <div style={{ ...S.fila, marginTop: 8 }}>
                  <button style={S.btn} disabled={ocupado || !tar.precio || !tar.desde} onClick={() => correr(async () => {
                    await rpc('fact_tarifa_agregar', { p_contrato_id: x.id, p_objetivo_id: tar.objetivo_id || null, p_concepto: tar.concepto, p_precio: tar.precio.replace(',', '.'),
                      p_tratamiento_iva: tar.iva, p_alicuota: tar.alicuota, p_desde: tar.desde, p_motivo: tar.motivo }); setTar(TARIFA_VACIA); setPanel(null); await hecho()
                  }, 'Tarifa cargada')}>Agregar tarifa</button>
                  <button style={S.btn2} onClick={() => setPanel(null)}>Cancelar</button>
                </div>
              </div>
            )}

            <div style={{ ...S.fila, justifyContent: 'space-between', marginTop: 12 }}>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>Objetivos ({objs.length})</span>
              <button style={CHICO} onClick={() => { setVinc({ ...VINC_VACIO, contrato_id: x.id }); alternar(`vinc:${x.id}`) }}>+ Objetivo</button>
            </div>
            {objs.length ? <>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
                <thead><tr>{['Objetivo', 'Servicio', 'Precio', 'Factura'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>{objs.map(v => {
                  const propias = tarifas.filter(t => t.objetivo_id === v.objetivo_id && !t.vigencia_hasta)
                  const valor = grupos[v.id] ?? v.grupo_factura ?? ''
                  const texto = textos[v.id] ?? v.texto_renglon ?? ''
                  return (
                    <Fragment key={v.id}>
                    <tr>
                      <td style={S.td}>{v.objetivo?.nombre}</td>
                      <td style={S.td}>{fecha(v.desde)} a {v.hasta ? fecha(v.hasta) : 'vigente'}</td>
                      <td style={S.td}>{propias.length ? propias.map(t => `${t.concepto} $ ${t.precio}`).join(' · ') : <span style={S.sub}>general del contrato</span>}</td>
                      <td style={S.td}>
                        <input style={{ ...S.input, width: 150, padding: '4px 8px' }} list={`grupos-${x.id}`} placeholder={x.agrupacion === 'objetivo' ? 'propia' : 'con el resto'} value={valor}
                          onChange={e => setGrupos({ ...grupos, [v.id]: e.target.value })}
                          onBlur={() => { if (valor.trim() !== (v.grupo_factura ?? '')) correr(async () => { await rpc('fact_contrato_objetivo_grupo', { p_id: v.id, p_grupo: valor }); const { [v.id]: _, ...resto } = grupos; setGrupos(resto); await hecho() }, 'Agrupación guardada: se aplica al recalcular') }} />
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={4} style={{ ...S.td, paddingTop: 0 }}>
                        <textarea style={{ ...S.input, width: '100%', minHeight: 44, boxSizing: 'border-box', fontSize: 12 }}
                          placeholder={`Texto del renglón en la factura (vacío = «Horas de vigilancia — ${v.objetivo?.nombre ?? 'objetivo'}»). Podés usar {mes}, {año} y {periodo}.`}
                          value={texto} onChange={e => setTextos({ ...textos, [v.id]: e.target.value })}
                          onBlur={() => { if (texto.trim() !== (v.texto_renglon ?? '').trim()) correr(async () => { await rpc('fact_contrato_objetivo_texto', { p_id: v.id, p_texto: texto }); const { [v.id]: _, ...resto } = textos; setTextos(resto); await hecho() }, 'Texto del renglón guardado: se aplica al recalcular') }} />
                      </td>
                    </tr>
                    </Fragment>)
                })}</tbody>
              </table>
              <datalist id={`grupos-${x.id}`}>{Array.from(new Set(objs.map(v => v.grupo_factura).filter(Boolean))).map(g => <option key={g} value={g} />)}</datalist>
              <div style={S.sub}>Factura: los objetivos con el mismo nombre (p. ej. «A») van juntos en un comprobante. Vacío = {x.agrupacion === 'objetivo' ? 'factura propia' : 'junto con los demás sin nombre'}. El precio de cada objetivo es el propio o, si no tiene, el general.</div>
            </> : <div style={{ ...S.sub, color: '#fbbf24' }}>Sin objetivos vinculados.</div>}
            {panel === `vinc:${x.id}` && (
              <div style={FORM}>
                <div style={{ ...GRILLA, marginTop: 0 }}>
                  <Campo t="Objetivo"><select style={CAMPO} value={vinc.objetivo_id} onChange={e => setVinc({ ...vinc, objetivo_id: e.target.value })}><option value="">Elegir…</option>{objetivos.map(o => <option key={o.id} value={o.id}>{o.nombre} ({o.cliente})</option>)}</select></Campo>
                  <Campo t="Inicio del servicio"><input style={CAMPO} type="date" value={vinc.desde} onChange={e => setVinc({ ...vinc, desde: e.target.value })} /></Campo>
                  <Campo t="Fin del servicio"><input style={CAMPO} type="date" value={vinc.hasta} onChange={e => setVinc({ ...vinc, hasta: e.target.value })} /></Campo>
                </div>
                <div style={{ ...S.fila, marginTop: 8 }}>
                  <button style={S.btn} disabled={ocupado || !vinc.objetivo_id} onClick={() => correr(async () => {
                    await rpc('fact_contrato_objetivo_vincular', { p_contrato_id: x.id, p_objetivo_id: vinc.objetivo_id, p_desde: vinc.desde || null, p_hasta: vinc.hasta || null }); setVinc(VINC_VACIO); setPanel(null); await hecho()
                  })}>Vincular</button>
                  <button style={S.btn2} onClick={() => setPanel(null)}>Cancelar</button>
                </div>
              </div>
            )}
          </div>
        )
      })}
      {panel === 'contrato' && formContrato}

      <div style={{ ...S.fila, justifyContent: 'space-between', ...TITULO }}>
        <span>ÓRDENES DE COMPRA / LICITACIONES / PRESUPUESTOS</span>
        <button style={CHICO} onClick={() => alternar('oc')}>+ Orden de compra</button>
      </div>
      {d.ocs.length ? (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Tipo', 'Número', 'Vigencia', 'Monto', 'Consumido', 'Saldo', 'Objetivos', 'Estado'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>{d.ocs.map(o => {
            const conIva = o.monto_total_c != null
            const monto = conIva ? o.monto_total_c : o.monto_neto_c
            const consumido = (o.consumos ?? []).filter((c: any) => !c.anulado_at).reduce((a: number, c: any) => a + Number(conIva ? c.total_c : c.neto_c), 0)
            return (
              <tr key={o.id}>
                <td style={S.td}>{o.tipo}</td><td style={S.td}>{o.numero}</td>
                <td style={S.td}>{fecha(o.vigencia_desde)} a {fecha(o.vigencia_hasta)}</td>
                <td style={S.num}>{pesos(monto)} <span style={S.sub}>{conIva ? 'c/IVA' : 'neto'}</span>{o.horas ? <div style={S.sub}>{o.horas} h</div> : null}</td>
                <td style={S.num}>{pesos(consumido)}</td>
                <td style={S.num}>{monto ? pesos(Number(monto) - consumido) : '—'}</td>
                <td style={S.td}>{o.objetivos?.length ? o.objetivos.map((x: any) => nombreObj(x.objetivo_id)).join(', ') : 'todos'}</td>
                <td style={S.td}>{o.estado}</td>
              </tr>)
          })}</tbody>
        </table>
      ) : <div style={S.sub}>Sin órdenes de compra.</div>}
      {panel === 'oc' && (
        <div style={FORM}>
          <div style={{ ...GRILLA, marginTop: 0 }}>
            <Campo t="Tipo"><select style={CAMPO} value={oc.tipo} onChange={e => setOc({ ...oc, tipo: e.target.value })}>{['orden_compra', 'licitacion', 'presupuesto'].map(x => <option key={x}>{x}</option>)}</select></Campo>
            <Campo t="Número"><input style={CAMPO} value={oc.numero} onChange={e => setOc({ ...oc, numero: e.target.value })} /></Campo>
            <Campo t="Vigencia desde"><input style={CAMPO} type="date" value={oc.vigencia_desde} onChange={e => setOc({ ...oc, vigencia_desde: e.target.value })} /></Campo>
            <Campo t="Vigencia hasta"><input style={CAMPO} type="date" value={oc.vigencia_hasta} onChange={e => setOc({ ...oc, vigencia_hasta: e.target.value })} /></Campo>
            <Campo t="Monto"><input style={CAMPO} value={oc.monto} onChange={e => setOc({ ...oc, monto: e.target.value })} /></Campo>
            {oc.tipo !== 'presupuesto' && <Campo t="El monto es"><select style={CAMPO} value={oc.monto_con_iva ? 'si' : 'no'} onChange={e => setOc({ ...oc, monto_con_iva: e.target.value === 'si' })}>
              <option value="si">con IVA</option><option value="no">sin IVA</option></select></Campo>}
            <Campo t="Horas"><input style={CAMPO} value={oc.horas} onChange={e => setOc({ ...oc, horas: e.target.value })} /></Campo>
            {oc.tipo === 'presupuesto' && <Campo t="Aceptado el"><input style={CAMPO} type="date" value={oc.aceptado_at} onChange={e => setOc({ ...oc, aceptado_at: e.target.value })} /></Campo>}
            <Campo t="Objetivos que cubre (Ctrl para varios; ninguno = todos)" ancho>
              <select multiple style={{ ...CAMPO, minHeight: 80 }} value={oc.objetivos} onChange={e => setOc({ ...oc, objetivos: Array.from(e.target.selectedOptions).map(o => o.value) })}>
                {d.vinc.map(v => <option key={v.id} value={v.objetivo_id}>{v.objetivo?.nombre}</option>)}
              </select></Campo>
          </div>
          <div style={{ ...S.fila, marginTop: 8 }}>
            <button style={S.btn} disabled={ocupado} onClick={() => correr(async () => {
              await rpc('fact_oc_guardar', { p_id: null, p_datos: { ...oc, cliente_id: cliente.id, ...(oc.monto_con_iva && oc.tipo !== 'presupuesto'
                ? { monto_total_c: oc.monto ? centavosDe(oc.monto) : null, monto_neto_c: null }
                : { monto_neto_c: oc.monto ? centavosDe(oc.monto) : null, monto_total_c: null }), horas: oc.horas || null }, p_objetivos: oc.objetivos, p_version: null })
              setOc(OC_VACIA); setPanel(null); await hecho()
            }, 'OC guardada (una sola, aunque cubra varios objetivos)')}>Guardar OC</button>
            <button style={S.btn2} onClick={() => setPanel(null)}>Cancelar</button>
          </div>
        </div>
      )}

      <div style={{ ...S.fila, justifyContent: 'space-between', ...TITULO }}>
        <span>CONTACTOS Y DESTINATARIOS</span>
        <button style={CHICO} onClick={() => alternar('contacto')}>+ Contacto</button>
      </div>
      {d.contactos.length ? d.contactos.map(c => <div key={c.id} style={{ fontSize: 13, padding: '2px 0' }}>{c.nombre} · {c.email ?? '—'} <span style={S.sub}>· {c.rol}{c.objetivo_id ? ` · ${nombreObj(c.objetivo_id)}` : ''}{!c.activo && ' (inactivo)'}</span></div>)
        : <div style={S.sub}>Sin contactos.</div>}
      {panel === 'contacto' && (
        <div style={FORM}>
          <div style={{ ...GRILLA, marginTop: 0 }}>
            <Campo t="Nombre"><input style={CAMPO} value={contacto.nombre} onChange={e => setContacto({ ...contacto, nombre: e.target.value })} /></Campo>
            <Campo t="Email"><input style={CAMPO} value={contacto.email} onChange={e => setContacto({ ...contacto, email: e.target.value })} /></Campo>
            <Campo t="Rol"><select style={CAMPO} value={contacto.rol} onChange={e => setContacto({ ...contacto, rol: e.target.value })}>{['destinatario_factura', 'autorizado_conformidad', 'pagos', 'otro'].map(x => <option key={x}>{x}</option>)}</select></Campo>
            <Campo t="Objetivo"><select style={CAMPO} value={contacto.objetivo_id} onChange={e => setContacto({ ...contacto, objetivo_id: e.target.value })}>
              <option value="">Todos los objetivos</option>{d.vinc.map(v => <option key={v.id} value={v.objetivo_id}>{v.objetivo?.nombre}</option>)}
            </select></Campo>
          </div>
          <div style={{ ...S.fila, marginTop: 8 }}>
            <button style={S.btn} disabled={ocupado || !contacto.nombre} onClick={() => correr(async () => { await rpc('fact_contacto_guardar', { p_id: null, p_datos: { ...contacto, cliente_id: cliente.id } }); setContacto({ nombre: '', email: '', rol: 'destinatario_factura', objetivo_id: '' }); setPanel(null); await hecho() })}>Agregar contacto</button>
            <button style={S.btn2} onClick={() => setPanel(null)}>Cancelar</button>
          </div>
        </div>
      )}

      <div style={{ ...S.fila, justifyContent: 'space-between', ...TITULO }}>
        <span>ALIAS <span style={S.sub}>(cómo aparece en planillas, banco y documentos; sólo los confirmados identifican al cliente)</span></span>
        <button style={CHICO} onClick={() => alternar('alias')}>+ Alias</button>
      </div>
      {d.alias.length ? <div style={{ ...S.fila, gap: 6 }}>{d.alias.map(a => (
        <span key={a.id} style={{ fontSize: 12, border: '1px solid #334155', borderRadius: 12, padding: '3px 4px 3px 10px', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          {a.alias} <span style={{ ...S.sub, color: a.confirmado ? '#64748b' : '#fbbf24' }}>{a.origen}{a.confirmado ? '' : ' · sin confirmar'}</span>
          <button title="Anular alias" style={{ ...S.btnPeligro, padding: '0 6px', fontSize: 12, borderRadius: 10 }} onClick={() => correr(async () => { await rpc('fact_alias_anular', { p_id: a.id, p_motivo: 'Anulado desde la ficha' }); await hecho() })}>×</button>
        </span>))}</div> : <div style={S.sub}>Sin alias.</div>}
      {panel === 'alias' && (
        <div style={FORM}>
          <div style={{ ...GRILLA, marginTop: 0 }}>
            <Campo t="Alias"><input style={CAMPO} value={alias.alias} onChange={e => setAlias({ ...alias, alias: e.target.value })} /></Campo>
            <Campo t="Origen"><select style={CAMPO} value={alias.origen} onChange={e => setAlias({ ...alias, origen: e.target.value })}>{['planilla', 'banco', 'documento', 'arca', 'otro'].map(x => <option key={x}>{x}</option>)}</select></Campo>
            <Tilde t="Confirmado" v={alias.confirmado} set={v => setAlias({ ...alias, confirmado: v })} />
          </div>
          <div style={{ ...S.fila, marginTop: 8 }}>
            <button style={S.btn} disabled={ocupado || !alias.alias} onClick={() => correr(async () => { await rpc('fact_alias_guardar', { p_cliente_id: cliente.id, p_alias: alias.alias, p_origen: alias.origen, p_confirmado: alias.confirmado, p_nota: null }); setAlias({ alias: '', origen: 'planilla', confirmado: false }); setPanel(null); await hecho() })}>Agregar alias</button>
            <button style={S.btn2} onClick={() => setPanel(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
