'use client'
// Bandeja de prefacturas (Gestión Económica → Facturación → Prefacturas).
// Una fila por cliente + período + agrupación, más los contratos vigentes que
// todavía no tienen prefactura en el mes ("pendiente de generar").
// Preparación (borrador → revisión → aprobada → emitida) separada de entrega y portal.
import { useEffect, useState } from 'react'
import { abrirDocumento, api, estadoVisible, leer, rpc, subirDocumento, ESTADO_ENTREGA, ESTADO_PORTAL, ESTADO_PREPARACION, MODALIDADES, TIPOS_DOC } from '@/lib/facturacion/datos'
import { datosComprobantesEnLinea, validarRegistroManual } from '@/lib/facturacion/emision-manual'
import { compararConFacturaReal, etiquetaFactura } from '@/lib/facturacion/control'
import { COLOR_ESTADO, Etiqueta, S, centavosDe, fecha, horas, pesos, useAccion } from './comun'

const ESTADOS_FILTRO: Array<[string, string]> = [
  ['pendiente_generar', 'Pendiente de generar'], ['en_preparacion', 'Borrador'], ['requiere_revision', 'Requiere revisión'],
  ['lista_aprobar', 'Lista para aprobar'], ['aprobada_emitir', 'Aprobada · pendiente de emisión'], ['emitida', 'Emitida'],
  ['esperando_requisitos', 'Bloqueada por información faltante'],
]
const COLOR_VISIBLE: Record<string, string> = { ...COLOR_ESTADO, pendiente_generar: '#334155', requiere_revision: '#b45309', lista_aprobar: '#2563eb' }

type Config = { emision: any; modulos: any }

export default function Bandeja({ mes, usuarios, config }: { mes: string; usuarios: Array<{ id: string; nombre: string }>; config: Config }) {
  const [filas, setFilas] = useState<any[]>([])
  const [sinGenerar, setSinGenerar] = useState<any[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('')
  const { ocupado, correr, Mensaje } = useAccion()

  async function cargar() {
    const [pref, contratos] = await Promise.all([
      leer('fact_prefacturas', q => q.eq('periodo_mes', mes).neq('estado', 'descartada').order('created_at'),
        '*, cliente:fact_clientes(razon_social, cuit, condicion_iva), objetivo:objetivos(nombre), oc:fact_ordenes_compra(numero, tipo), contrato:fact_contratos(nombre, modalidad, requiere_portal, envio_conjunto_planilla, requisitos)'),
      leer('fact_contratos', q => q.eq('estado', 'vigente'), 'id, nombre, modalidad, cliente:fact_clientes(razon_social, cuit)'),
    ])
    setFilas(pref)
    setSinGenerar(contratos.filter(k => !pref.some(p => p.contrato_id === k.id)))
  }
  useEffect(() => { correr(cargar) }, [mes]) // eslint-disable-line react-hooks/exhaustive-deps

  const visibles = filas.filter(f => !filtro || estadoVisible(f).clave === filtro || f.estado === filtro)
  const actual = filas.find(f => f.id === sel)
  const tarifa = (f: any) => {
    const ls = (f.lineas ?? []) as any[]
    return ls.length ? ls.map(l => `${l.concepto}: ${l.precio}`).join(' · ') : '—'
  }

  // Un paso: toma las horas de la app (lo mismo que se liquida) para los objetivos
  // que todavía no tienen horas aprobadas en el mes, y genera horas × precio.
  async function calcularDesdeLaApp() {
    const [vinc, aprob] = await Promise.all([
      leer('fact_contrato_objetivos', q => q.is('anulado_at', null), 'contrato_id, objetivo_id, objetivo:objetivos(nombre), contrato:fact_contratos(estado)'),
      leer('fact_horas_aprobaciones', q => q.eq('estado', 'aprobada').order('aprobado_at', { ascending: false }).limit(1000)),
    ])
    const problemas: string[] = []
    for (const v of vinc.filter(x => x.contrato?.estado === 'vigente')) {
      // Mismo criterio que la pestaña Horas: lo ya aprobado (o revisado a mano) no se toca.
      if (aprob.some(a => a.objetivo_id === v.objetivo_id && a.contrato_id === v.contrato_id
        && a.periodo_desde.slice(0, 7) <= mes && a.periodo_hasta_excl.slice(0, 7) >= mes)) continue
      try { await api('horas', { accion: 'aprobar', contrato_id: v.contrato_id, objetivo_id: v.objetivo_id, mes, tratamiento_descubiertos: 'no_facturar' }) }
      catch (e: any) { problemas.push(`${v.objetivo?.nombre}: ${e?.message}`) }
    }
    const r = await api('prefacturas', { mes })
    await cargar()
    const errores = [...problemas, ...(r.errores ?? [])]
    if (errores.length) throw new Error(`Calculadas ${r.creadas + r.actualizadas}. Revisar: ${errores.join(' · ')}`)
  }

  return (
    <div>
      <div style={{ ...S.card, ...S.fila }}>
        <button style={S.btn} disabled={ocupado} onClick={() => correr(calcularDesdeLaApp, 'Prefacturas calculadas: horas de la app × precio del contrato')}>Calcular {mes} con las horas de la app</button>
        <button style={S.btn2} disabled={ocupado || !filas.length} onClick={() => correr(() => exportarExcel(mes, visibles), 'Excel descargado')}>Descargar Excel</button>
        <select style={S.input} value={filtro} onChange={e => setFiltro(e.target.value)}>
          <option value="">Todos los estados</option>
          {ESTADOS_FILTRO.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span style={S.sub}>Horas = las mismas que se liquidan (programado cubierto + lo aceptado por el supervisor). Recalcular no pisa el texto editado.</span>
        <Mensaje />
      </div>

      <div style={{ ...S.card, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            {['Cliente', 'Objetivo / agrupación', 'Período', 'Modalidad', 'Hs program.', 'Hs cubiertas', 'Hs facturables', 'Tarifa', 'Neto', 'IVA', 'Total', 'OC', 'Pendiente / documentación', 'Estado', 'Responsable'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {visibles.map(f => {
              const ev = estadoVisible(f)
              return (
                <tr key={f.id} onClick={() => setSel(f.id === sel ? null : f.id)} style={{ cursor: 'pointer', background: f.id === sel ? '#111c35' : undefined }}>
                  <td style={S.td}>{f.cliente?.razon_social}<div style={S.sub}>{f.cliente?.cuit ?? 'sin CUIT'}</div></td>
                  <td style={S.td}>{f.objetivo?.nombre ?? f.contrato?.nombre ?? '—'}</td>
                  <td style={S.td}>{fecha(f.periodo_desde)} – {fecha(addDias(f.periodo_hasta_excl, -1))}</td>
                  <td style={S.td}>{MODALIDADES[f.contrato?.modalidad] ?? '—'}</td>
                  <td style={S.num}>{horas(f.minutos_programados)}</td>
                  <td style={S.num}>{horas(f.minutos_cubiertos)}</td>
                  <td style={S.num}>{horas(f.minutos_aprobados)}{f.minutos_descubiertos ? <div style={S.sub}>descub. {horas(f.minutos_descubiertos)}</div> : null}</td>
                  <td style={S.td}><span style={{ fontSize: 12 }}>{tarifa(f)}</span></td>
                  <td style={S.num}>{pesos(f.neto_c)}</td>
                  <td style={S.num}>{pesos(f.iva_c)}</td>
                  <td style={S.num}>{pesos(f.total_c)}</td>
                  <td style={S.td}>{f.oc?.numero ?? '—'}</td>
                  <td style={S.td}>{(f.requisitos ?? []).map((r: any, i: number) => <div key={i} style={{ color: '#fbbf24', fontSize: 12 }}>• {r.detalle}</div>)}
                    {!f.requisitos?.length && <span style={S.sub}>{f.proxima_accion ?? '—'}</span>}
                    <div style={S.sub}>{ESTADO_ENTREGA[f.estado_entrega]}{f.estado_portal !== 'no_requiere' ? ` · ${ESTADO_PORTAL[f.estado_portal]}` : ''}</div></td>
                  <td style={S.td}><Etiqueta texto={ev.texto} color={COLOR_VISIBLE[ev.clave]} /></td>
                  <td style={S.td}>{usuarios.find(u => u.id === f.responsable_id)?.nombre ?? '—'}</td>
                </tr>
              )
            })}
            {(!filtro || filtro === 'pendiente_generar') && sinGenerar.map(k => (
              <tr key={`k-${k.id}`}>
                <td style={S.td}>{k.cliente?.razon_social}<div style={S.sub}>{k.cliente?.cuit ?? 'sin CUIT'}</div></td>
                <td style={S.td}>{k.nombre}</td><td style={S.td}>{mes}</td><td style={S.td}>{MODALIDADES[k.modalidad]}</td>
                <td style={S.td} colSpan={9}><span style={S.sub}>Sin prefactura en el mes: usar “Generar / recalcular”. Si no se genera, revisar objetivos vinculados y horas aprobadas.</span></td>
                <td style={S.td}><Etiqueta texto="Pendiente de generar" color={COLOR_VISIBLE.pendiente_generar} /></td><td style={S.td}>—</td>
              </tr>
            ))}
            {!visibles.length && !sinGenerar.length && <tr><td style={S.td} colSpan={15}><span style={S.sub}>Sin contratos vigentes ni prefacturas para {mes}.</span></td></tr>}
          </tbody>
        </table>
      </div>
      {actual && <Detalle p={actual} usuarios={usuarios} config={config} alCambiar={() => correr(cargar)} />}
    </div>
  )
}

const LETRA: Record<number, string> = { 1: 'A', 6: 'B', 201: 'FCE A' }

/** Prefacturas del mes en Excel: una fila por renglón (horas × precio), con totales por prefactura. */
async function exportarExcel(mes: string, filas: any[]) {
  const XLSX: any = await import('xlsx')
  const $ = (c: unknown) => (c == null ? null : Number(c) / 100)
  const rows: any[][] = [['Cliente', 'CUIT', 'Factura', 'Objetivo', 'Período', 'Concepto', 'Cantidad (h)', 'Precio', 'Neto', 'IVA', 'Total', 'Estado', 'Pendiente', 'Texto de la factura']]
  for (const f of filas) {
    const base = [f.cliente?.razon_social ?? '', f.cliente?.cuit ?? '', LETRA[f.tipo_comprobante] ?? '', f.objetivo?.nombre ?? f.contrato?.nombre ?? '',
      `${fecha(f.periodo_desde)} – ${fecha(addDias(f.periodo_hasta_excl, -1))}`]
    const pend = (f.requisitos ?? []).map((r: any) => r.detalle).join(' · ')
    const lineas = (f.lineas ?? []) as any[]
    if (!lineas.length) rows.push([...base, '', null, null, null, null, null, estadoVisible(f).texto, pend, f.texto_factura ?? ''])
    lineas.forEach((l, i) => rows.push([...base, l.concepto, Number(l.cantidad), Number(l.precio), $(l.importes?.neto), $(l.importes?.iva), $(l.importes?.total),
      i === 0 ? estadoVisible(f).texto : '', i === 0 ? pend : '', i === 0 ? f.texto_factura ?? '' : '']))
    if (lineas.length > 1) rows.push([...base, 'TOTAL', null, null, $(f.neto_c), $(f.iva_c), $(f.total_c), '', '', ''])
  }
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [34, 13, 8, 24, 24, 16, 12, 12, 15, 14, 15, 26, 40, 50].map(w => ({ wch: w }))
  for (let r = 1; r < rows.length; r++) for (const c of [7, 8, 9, 10]) {
    const ref = XLSX.utils.encode_cell({ r, c }); if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = '#,##0.00'
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `Prefacturas ${mes}`)
  XLSX.writeFile(wb, `prefacturas_${mes}.xlsx`)
}

/**
 * Control funcional contra la factura emitida por el circuito de siempre
 * (importada del CSV de ARCA). Sólo compara; si coincide, se puede registrar
 * esa factura contra la prefactura con "Emitir manualmente".
 */
function ControlFacturaReal({ p }: { p: any }) {
  const [abierto, setAbierto] = useState(false)
  const [reales, setReales] = useState<any[]>([])
  const [sel, setSel] = useState('')
  const { correr, Mensaje } = useAccion()
  useEffect(() => {
    if (!abierto || !p.cuit_receptor) return
    correr(async () => setReales(await leer('fact_comprobantes', q => q.eq('ambiente', 'produccion').eq('doc_nro_receptor', p.cuit_receptor)
      .in('tipo', [1, 6, 201]).gte('fecha_emision', p.periodo_desde).order('fecha_emision').limit(20))))
  }, [abierto]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!abierto) return <button style={{ ...S.btn2, marginTop: 6 }} onClick={() => setAbierto(true)}>Comparar con la factura real</button>
  const c = reales.find(x => x.id === sel)
  const r = c ? compararConFacturaReal(p, { ...c, neto_c: Number(c.neto_c), iva_c: Number(c.iva_c), total_c: Number(c.total_c), numero: Number(c.numero) }) : null
  return (
    <div style={{ border: '1px solid #334155', borderRadius: 8, padding: 10, marginTop: 6 }}>
      <div style={S.fila}>
        <select style={S.input} value={sel} onChange={e => setSel(e.target.value)}>
          <option value="">{reales.length ? 'Factura real del cliente…' : 'No hay facturas importadas de este CUIT desde el inicio del período (importar el CSV de ARCA)'}</option>
          {reales.map(x => <option key={x.id} value={x.id}>{etiquetaFactura({ ...x, numero: Number(x.numero) })} · {fecha(x.fecha_emision)} · {pesos(x.total_c)}{x.prefactura_id ? ' · ya vinculada' : ''}</option>)}
        </select>
        <button style={S.btn2} onClick={() => setAbierto(false)}>Cerrar</button>
        <Mensaje />
      </div>
      {r && <>
        <table style={{ borderCollapse: 'collapse', marginTop: 6 }}><tbody>
          <tr><th style={S.th}></th><th style={S.th}>App</th><th style={S.th}>Factura real</th><th style={S.th}>Diferencia</th></tr>
          {r.filas.map(f => <tr key={f.campo}><td style={S.td}>{f.campo}</td><td style={S.num}>{f.app}</td><td style={S.num}>{f.real}</td>
            <td style={{ ...S.td, color: f.coincide ? '#4ade80' : '#f87171' }}>{f.coincide ? 'coincide' : f.diferencia ?? 'distinto'}</td></tr>)}
        </tbody></table>
        <div style={{ ...S.sub, marginTop: 4 }}>{r.registrable
          ? 'Coincide. Si esa factura corresponde a esta prestación, registrala con “Emitir manualmente” (queda vinculada y no se factura dos veces).'
          : 'No coincide: revisar horas, tarifa o IVA antes de aprobar. Para el control, anotar la diferencia y descartar la prefactura con el motivo.'}</div>
      </>}
    </div>
  )
}

/** Quién preparó, modificó y aprobó; versión e importe aprobados; si la aprobación cayó. */
function Trazabilidad({ p, historial, usuarios }: { p: any; historial: any[]; usuarios: Array<{ id: string; nombre: string }> }) {
  const n = (id?: string | null) => usuarios.find(u => u.id === id)?.nombre ?? (id ? 'otro usuario' : '—')
  const aprob = historial.find(h => h.accion === 'aprobada')
  const caidas = historial.filter(h => h.accion === 'aprobacion_caida').length
  return (
    <div style={{ ...S.sub, marginTop: 6, lineHeight: 1.6 }}>
      Preparó {n(p.creado_por)} · última modificación {n(p.actualizado_por)} {fecha(p.updated_at)} · versión {p.version}
      {p.aprobada_at && <div style={{ color: '#4ade80' }}>Aprobada por {n(p.aprobada_por)} el {new Date(p.aprobada_at).toLocaleString('es-AR')}{aprob?.datos?.total_c != null ? ` por ${pesos(aprob.datos.total_c)}` : ''}</div>}
      {caidas > 0 && <div style={{ color: '#fbbf24' }}>La aprobación cayó {caidas} vez/veces por cambios posteriores (queda en el historial).</div>}
    </div>
  )
}

/**
 * Contingencia: emitir en Comprobantes en línea con estos datos y registrar el
 * comprobante autorizado. Desde el registro, la API no puede emitir otro.
 */
function EmisionManual({ p, alHecho }: { p: any; alHecho: () => Promise<void> }) {
  const [abierto, setAbierto] = useState(false)
  const [pv, setPv] = useState<number | null>(null)
  const [d, setD] = useState({ punto_venta: '', numero: '', fecha: '', neto: '', iva: '', total: '', cae: '', cae_vto: '' })
  const { ocupado, correr, Mensaje } = useAccion()
  useEffect(() => {
    if (!abierto) return
    correr(async () => setPv((await leer('fact_config', q => q.eq('clave', 'emision')))[0]?.valor?.punto_venta ?? null))
    setD(x => ({ ...x, neto: String(Number(p.neto_c) / 100), iva: String(Number(p.iva_c) / 100), total: String(Number(p.total_c) / 100) }))
  }, [abierto]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!abierto) return <button style={{ ...S.btn2, marginTop: 8 }} onClick={() => setAbierto(true)}>Emitir manualmente en ARCA (contingencia)</button>

  const datos = {
    tipo: p.tipo_comprobante, punto_venta: Number(d.punto_venta), numero: Number(d.numero), fecha: d.fecha, cuit_receptor: p.cuit_receptor ?? '',
    neto_c: centavosDe(d.neto) ?? 0, iva_c: centavosDe(d.iva) ?? 0, total_c: centavosDe(d.total) ?? 0, cae: d.cae.trim(), cae_vto: d.cae_vto,
  }
  const hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
  const errores = d.numero ? validarRegistroManual(p, datos, hoy) : []
  return (
    <div style={{ border: '1px solid #334155', borderRadius: 8, padding: 10, marginTop: 8 }}>
      <h4 style={S.sub}>1. CARGAR EN “COMPROBANTES EN LÍNEA” DE ARCA CON ESTOS DATOS</h4>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
        {datosComprobantesEnLinea(p, { razon_social: p.cliente?.razon_social ?? '', condicion_iva: p.cliente?.condicion_iva ?? null }, pv).map((x, i) => (
          <tr key={i}><td style={{ ...S.td, color: '#64748b' }}>{x.paso}</td><td style={S.td}>{x.campo}</td><td style={{ ...S.td, whiteSpace: 'pre-wrap' }}>{x.valor}</td></tr>
        ))}
      </tbody></table>
      <h4 style={{ ...S.sub, marginTop: 10 }}>2. REGISTRAR EL COMPROBANTE QUE AUTORIZÓ ARCA</h4>
      <div style={S.fila}>
        <input style={{ ...S.input, width: 80 }} placeholder="PV" value={d.punto_venta} onChange={e => setD({ ...d, punto_venta: e.target.value })} />
        <input style={{ ...S.input, width: 110 }} placeholder="Número" value={d.numero} onChange={e => setD({ ...d, numero: e.target.value })} />
        <input style={S.input} type="date" title="Fecha de emisión" value={d.fecha} onChange={e => setD({ ...d, fecha: e.target.value })} />
        <input style={{ ...S.input, width: 130 }} placeholder="Neto" value={d.neto} onChange={e => setD({ ...d, neto: e.target.value })} />
        <input style={{ ...S.input, width: 120 }} placeholder="IVA" value={d.iva} onChange={e => setD({ ...d, iva: e.target.value })} />
        <input style={{ ...S.input, width: 130 }} placeholder="Total" value={d.total} onChange={e => setD({ ...d, total: e.target.value })} />
        <input style={{ ...S.input, width: 160 }} placeholder="CAE (14 dígitos)" value={d.cae} onChange={e => setD({ ...d, cae: e.target.value })} />
        <input style={S.input} type="date" title="Vencimiento del CAE" value={d.cae_vto} onChange={e => setD({ ...d, cae_vto: e.target.value })} />
      </div>
      {errores.map((e, i) => <div key={i} style={S.err}>• {e}</div>)}
      <div style={{ ...S.fila, marginTop: 6 }}>
        <button style={S.btn} disabled={ocupado || !d.numero || errores.length > 0} onClick={() => {
          if (!confirm(`Registrar ${datos.punto_venta}-${datos.numero} (CAE ${datos.cae}) como la factura de esta prefactura? Después no se podrá emitir otra por la API.`)) return
          correr(async () => {
            await rpc('fact_comprobante_manual_registrar', { p_prefactura_id: p.id, p_version: p.version, p_datos: datos }); await alHecho()
          }, 'Comprobante registrado y vinculado: la prefactura quedó emitida')
        }}>Registrar comprobante autorizado</button>
        <button style={S.btn2} onClick={() => setAbierto(false)}>Cerrar</button>
        <span style={S.sub}>Se verifica tipo, CUIT, importes y CAE contra lo aprobado. Adjuntá el PDF de ARCA en Documentos del comprobante.</span>
        <Mensaje />
      </div>
    </div>
  )
}

function addDias(f: string, d: number) {
  const x = new Date(`${f}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10)
}

function Detalle({ p, usuarios, config, alCambiar }: { p: any; usuarios: Array<{ id: string; nombre: string }>; config: Config; alCambiar: () => void }) {
  const [texto, setTexto] = useState(p.texto_factura ?? '')
  const [extra, setExtra] = useState<{ ajustes: any[]; envios: any[]; conformidades: any[]; contactos: any[]; docs: any[]; emisiones: any[]; historial: any[] }>({ ajustes: [], envios: [], conformidades: [], contactos: [], docs: [], emisiones: [], historial: [] })
  const [aj, setAj] = useState({ descripcion: '', importe: '', motivo: '' })
  const [env, setEnv] = useState({ tipo: 'planilla', version_planilla: '', destinatarios: '', enviado_por: '', enviado_at: '' })
  const [conf, setConf] = useState({ tipo: 'conformidad', contacto_id: '', version_planilla: '', texto: '' })
  const [portal, setPortal] = useState({ estado: 'presentada', numero_tramite: '', notas: '' })
  const [motivo, setMotivo] = useState('')
  const { ocupado, correr, Mensaje } = useAccion()

  async function cargarExtra() {
    const [ajustes, envios, conformidades, contactos, vinc, emisiones, historial] = await Promise.all([
      leer('fact_ajustes', q => q.eq('prefactura_id', p.id).order('created_at')),
      leer('fact_envios', q => q.eq('prefactura_id', p.id).order('enviado_at')),
      leer('fact_conformidades', q => q.eq('prefactura_id', p.id).order('recibido_at')),
      leer('fact_contactos', q => q.eq('cliente_id', p.cliente_id).eq('activo', true)),
      leer('fact_documento_vinculos', q => q.eq('entidad', 'prefactura').eq('entidad_id', p.id).is('anulado_at', null), 'id, documento:fact_documentos(id, tipo, nombre_original, created_at)'),
      leer('fact_emisiones', q => q.eq('prefactura_id', p.id).order('created_at')),
      leer('fact_historial', q => q.eq('entidad', 'prefactura').eq('entidad_id', p.id).order('at', { ascending: false }).limit(100)),
    ])
    setExtra({ ajustes, envios, conformidades, contactos, docs: vinc, emisiones, historial })
  }
  useEffect(() => { setTexto(p.texto_factura ?? ''); correr(cargarExtra) }, [p.id, p.version]) // eslint-disable-line react-hooks/exhaustive-deps

  const hecho = async () => { await cargarExtra(); alCambiar() }
  const emitida = p.estado === 'emitida'

  return (
    <div style={S.card}>
      <h3 style={S.h3}>{p.cliente?.razon_social} · {p.objetivo?.nombre ?? p.contrato?.nombre} · {p.periodo_mes}</h3>
      <Mensaje />
      {(p.avisos ?? []).map((a: string, i: number) => <div key={i} style={{ ...S.aviso, marginBottom: 6 }}>{a}</div>)}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div>
          <h4 style={S.sub}>CÁLCULO</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
            {(p.lineas ?? []).map((l: any, i: number) => (
              <tr key={i}><td style={S.td}>{l.concepto}</td><td style={S.num}>{l.cantidad} × {l.precio}</td><td style={S.num}>{pesos(l.importes?.neto)}</td></tr>
            ))}
            <tr><td style={S.td}><b>Neto / IVA / Total</b></td><td style={S.num}>{pesos(p.neto_c)} + {pesos(p.iva_c)}</td><td style={S.num}><b>{pesos(p.total_c)}</b></td></tr>
          </tbody></table>
          <div style={S.sub}>Horas programadas {horas(p.minutos_programados)} · cubiertas {horas(p.minutos_cubiertos)} · aprobadas para facturar {horas(p.minutos_aprobados)} · descubiertas no facturadas {horas(p.minutos_descubiertos)}</div>
          <div style={S.sub}>Comprobante tipo {p.tipo_comprobante ?? '—'} · PV {p.punto_venta ?? 'el de la configuración'} · vto. de pago informado a ARCA {fecha(p.fecha_vencimiento)} (el vencimiento comercial sale del contrato)</div>
          <Trazabilidad p={p} historial={extra.historial} usuarios={usuarios} />
          <ControlFacturaReal p={p} />

          <h4 style={{ ...S.sub, marginTop: 12 }}>TEXTO DE LA FACTURA</h4>
          <textarea style={{ ...S.input, width: '100%', minHeight: 90 }} value={texto} disabled={emitida} onChange={e => setTexto(e.target.value)} />
          {!emitida && <button style={S.btn2} disabled={ocupado || texto === (p.texto_factura ?? '')} onClick={() => correr(async () => {
            await rpc('fact_prefactura_texto', { p_id: p.id, p_texto: texto, p_version: p.version }); await hecho()
          }, p.estado === 'aprobada_emitir' ? 'Texto guardado: el cambio hizo caer la aprobación (vuelve a revisión)' : 'Texto guardado')}>Guardar texto</button>}
          {extra.historial.some(h => h.accion === 'texto') && <details style={{ marginTop: 6 }}><summary style={S.sub}>Versiones anteriores del texto</summary>
            {extra.historial.filter(h => h.accion === 'texto').map(h => <div key={h.id} style={{ fontSize: 12, borderTop: '1px solid #1e293b', padding: '4px 0' }}>
              <span style={S.sub}>{new Date(h.at).toLocaleString('es-AR')} · {usuarios.find(u => u.id === h.por)?.nombre ?? ''}</span>
              <div style={{ whiteSpace: 'pre-wrap' }}>{h.datos?.texto}</div>
              {!emitida && <button style={{ ...S.btn2, padding: '2px 8px' }} onClick={() => setTexto(h.datos?.texto ?? '')}>Usar este texto</button>}
            </div>)}
          </details>}
        </div>

        <div>
          <h4 style={S.sub}>ACCIONES</h4>
          <div style={S.fila}>
            <select style={S.input} value={p.responsable_id ?? ''} disabled title="Responsable (se asigna al generar)">
              <option value="">{usuarios.find(u => u.id === p.responsable_id)?.nombre ?? 'Sin responsable'}</option>
            </select>
            {p.estado === 'lista_revision' && <button style={S.btn} disabled={ocupado} onClick={() => correr(async () => {
              await rpc('fact_prefactura_aprobar', { p_id: p.id, p_version: p.version }); await hecho()
            }, 'Prefactura aprobada (queda registrada la versión y el importe)')}>Aprobar</button>}
            {p.estado === 'aprobada_emitir' && config.emision.homologacion_habilitada && <>
              <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => {
                const r = await api('emitir', { prefactura_id: p.id, version: p.version, ambiente: 'homologacion' }); await hecho()
                if (r.estado !== 'autorizada') throw new Error(r.motivo ?? r.error ?? r.estado)
              }, 'Emitida en HOMOLOGACIÓN (prueba, no fiscal)')}>Probar en homologación</button>
            </>}
            {p.estado === 'aprobada_emitir' && config.emision.produccion_habilitada && <>
              <button style={S.btn} disabled={ocupado} onClick={() => {
                if (!confirm(`Emitir comprobante REAL en ARCA por ${pesos(p.total_c)} a ${p.cliente?.razon_social}?`)) return
                correr(async () => {
                  const r = await api('emitir', { prefactura_id: p.id, version: p.version, ambiente: 'produccion' }); await hecho()
                  if (r.estado !== 'autorizada') throw new Error(r.motivo ?? r.error ?? r.estado)
                }, 'Comprobante autorizado por ARCA')
              }}>Emitir en ARCA</button>
            </>}
            {extra.emisiones.filter(e => e.estado === 'incierta' || e.estado === 'enviando').map(e => (
              <button key={e.id} style={S.btn2} disabled={ocupado} onClick={() => correr(async () => { await api('emitir', { emision_id: e.id }); await hecho() }, 'Consulta realizada')}>
                Consultar ARCA (respuesta incierta {e.ambiente})</button>
            ))}
          </div>
          {!emitida && <div style={{ ...S.fila, marginTop: 8 }}>
            <input style={{ ...S.input, flex: 1 }} placeholder="Motivo (para descartar)" value={motivo} onChange={e => setMotivo(e.target.value)} />
            {['en_preparacion', 'esperando_requisitos', 'lista_revision'].filter(x => x !== p.estado).map(x => (
              <button key={x} style={S.btn2} disabled={ocupado} onClick={() => correr(async () => {
                await rpc('fact_prefactura_estado', { p_id: p.id, p_estado: x, p_version: p.version, p_motivo: motivo || null }); await hecho()
              })}>→ {ESTADO_PREPARACION[x]}</button>
            ))}
            {p.estado !== 'aprobada_emitir' && <button style={S.btnPeligro} disabled={ocupado} onClick={() => correr(async () => {
              await rpc('fact_prefactura_estado', { p_id: p.id, p_estado: 'descartada', p_version: p.version, p_motivo: motivo }); await hecho()
            })}>Descartar</button>}
          </div>}
          {extra.emisiones.length > 0 && <div style={{ marginTop: 8 }}>
            {extra.emisiones.map(e => <div key={e.id} style={S.sub}>Emisión {e.ambiente} · {e.estado}{e.numero ? ` · N° ${e.numero}` : ''}{e.observaciones ? ` · ${e.observaciones}` : ''}</div>)}
          </div>}
          {p.estado === 'aprobada_emitir' && config.modulos.emision_manual && <EmisionManual p={p} alHecho={hecho} />}
          {p.estado === 'aprobada_emitir' && !config.emision.produccion_habilitada && !config.modulos.emision_manual && <div style={{ ...S.sub, marginTop: 6 }}>Aprobada. La emisión (ARCA o manual) todavía no está habilitada: la factura se emite por el circuito actual.</div>}

          <h4 style={{ ...S.sub, marginTop: 12 }}>AJUSTES COMERCIALES (con motivo y responsable)</h4>
          {extra.ajustes.map(a => (
            <div key={a.id} style={{ ...S.fila, fontSize: 13 }}>
              <span>{a.descripcion}: {pesos(a.importe_neto_c)} — {a.motivo}</span>
              <span style={S.sub}>{a.anulado_at ? 'anulado' : a.aprobado_at ? 'aprobado' : 'sin aprobar'}</span>
              {!a.aprobado_at && !a.anulado_at && !emitida && <>
                <button style={S.btn2} onClick={() => correr(async () => { await rpc('fact_ajuste_resolver', { p_id: a.id, p_aprobar: true }); await api('prefacturas', { mes: p.periodo_mes }); await hecho() })}>Aprobar</button>
                <button style={S.btnPeligro} onClick={() => correr(async () => { await rpc('fact_ajuste_resolver', { p_id: a.id, p_aprobar: false, p_motivo: 'Anulado en revisión' }); await hecho() })}>Anular</button>
              </>}
            </div>
          ))}
          {!emitida && <div style={S.fila}>
            <input style={S.input} placeholder="Descripción" value={aj.descripcion} onChange={e => setAj({ ...aj, descripcion: e.target.value })} />
            <input style={{ ...S.input, width: 120 }} placeholder="Neto (±)" value={aj.importe} onChange={e => setAj({ ...aj, importe: e.target.value })} />
            <input style={S.input} placeholder="Motivo" value={aj.motivo} onChange={e => setAj({ ...aj, motivo: e.target.value })} />
            <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => {
              const c = centavosDe(aj.importe); if (!c) throw new Error('Importe inválido')
              await rpc('fact_ajuste_agregar', { p_prefactura_id: p.id, p_descripcion: aj.descripcion, p_importe_neto_c: c, p_motivo: aj.motivo })
              setAj({ descripcion: '', importe: '', motivo: '' }); await hecho()
            }, 'Ajuste cargado: queda sin aprobar')}>Agregar ajuste</button>
          </div>}
        </div>

        <div>
          <h4 style={S.sub}>ENVÍOS (registro de lo enviado; la app no envía correos)</h4>
          {extra.envios.map(e => <div key={e.id} style={{ fontSize: 13 }}>{fecha(e.enviado_at)} · {e.tipo} {e.version_planilla ? `v${e.version_planilla}` : ''} · {usuarios.find(u => u.id === e.enviado_por)?.nombre ?? '—'} → {e.destinatarios.join(', ')}</div>)}
          <div style={S.fila}>
            <select style={S.input} value={env.tipo} onChange={e => setEnv({ ...env, tipo: e.target.value })}>
              {['planilla', 'factura', 'factura_y_planilla', 'documentacion'].map(x => <option key={x}>{x}</option>)}
            </select>
            <input style={{ ...S.input, width: 90 }} placeholder="Versión" value={env.version_planilla} onChange={e => setEnv({ ...env, version_planilla: e.target.value })} />
            <select style={S.input} value={env.enviado_por} onChange={e => setEnv({ ...env, enviado_por: e.target.value })}>
              <option value="">Enviado por (yo)</option>
              {usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
            <input style={S.input} placeholder="Destinatarios (coma)" value={env.destinatarios} onChange={e => setEnv({ ...env, destinatarios: e.target.value })} />
            <input style={S.input} type="date" value={env.enviado_at} onChange={e => setEnv({ ...env, enviado_at: e.target.value })} />
            <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => {
              await rpc('fact_envio_registrar', { p_prefactura_id: p.id, p_datos: { ...env, destinatarios: env.destinatarios.split(',').map(s => s.trim()).filter(Boolean),
                enviado_at: env.enviado_at ? `${env.enviado_at}T12:00:00-03:00` : null } })
              await hecho()
            }, 'Envío registrado')}>Registrar envío</button>
          </div>

          <h4 style={{ ...S.sub, marginTop: 12 }}>CONFORMIDAD / CORRECCIONES DEL CLIENTE</h4>
          {extra.conformidades.map(c => <div key={c.id} style={{ fontSize: 13 }}>{fecha(c.recibido_at)} · {c.tipo} · v{c.version_planilla ?? '—'} · {extra.contactos.find(x => x.id === c.contacto_id)?.nombre ?? '—'}{c.texto ? ` · “${c.texto}”` : ''}</div>)}
          <div style={S.fila}>
            <select style={S.input} value={conf.tipo} onChange={e => setConf({ ...conf, tipo: e.target.value })}><option>conformidad</option><option>correcciones</option></select>
            <select style={S.input} value={conf.contacto_id} onChange={e => setConf({ ...conf, contacto_id: e.target.value })}>
              <option value="">Contacto…</option>
              {extra.contactos.map(c => <option key={c.id} value={c.id}>{c.nombre} ({c.rol === 'autorizado_conformidad' ? 'autorizado' : c.rol})</option>)}
            </select>
            <input style={{ ...S.input, width: 90 }} placeholder="Versión" value={conf.version_planilla} onChange={e => setConf({ ...conf, version_planilla: e.target.value })} />
            <input style={S.input} placeholder="Texto recibido" value={conf.texto} onChange={e => setConf({ ...conf, texto: e.target.value })} />
            <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => {
              await rpc('fact_conformidad_registrar', { p_prefactura_id: p.id, p_datos: conf }); await api('prefacturas', { mes: p.periodo_mes }); await hecho()
            }, 'Registrado')}>Registrar</button>
          </div>
          <div style={S.sub}>Un “OK” sólo vale como conformidad con contacto autorizado y versión de la planilla.</div>

          {(p.contrato?.requiere_portal || p.estado_portal !== 'no_requiere') && emitida && <>
            <h4 style={{ ...S.sub, marginTop: 12 }}>PRESENTACIÓN EN PORTAL</h4>
            <div style={S.fila}>
              <select style={S.input} value={portal.estado} onChange={e => setPortal({ ...portal, estado: e.target.value })}>{['presentada', 'observada', 'aceptada', 'rechazada'].map(x => <option key={x}>{x}</option>)}</select>
              <input style={S.input} placeholder="N° trámite" value={portal.numero_tramite} onChange={e => setPortal({ ...portal, numero_tramite: e.target.value })} />
              <input style={S.input} placeholder="Notas" value={portal.notas} onChange={e => setPortal({ ...portal, notas: e.target.value })} />
              <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => { await rpc('fact_portal_registrar', { p_prefactura_id: p.id, p_datos: portal }); await hecho() }, 'Presentación registrada')}>Registrar</button>
            </div>
          </>}

          <h4 style={{ ...S.sub, marginTop: 12 }}>DOCUMENTOS DE RESPALDO</h4>
          {extra.docs.map(v => <div key={v.id} style={{ fontSize: 13 }}><a href="#" onClick={e => { e.preventDefault(); correr(() => abrirDocumento(v.documento.id)) }} style={{ color: '#93c5fd' }}>{TIPOS_DOC[v.documento.tipo]} · {v.documento.nombre_original}</a></div>)}
          <SubirDoc alSubir={async (f, tipo) => { const r = await subirDocumento(f, tipo, { cliente_id: p.cliente_id, entidad: 'prefactura', entidad_id: p.id }); await hecho(); return r }} />
        </div>
      </div>

      <details style={{ marginTop: 12 }}><summary style={S.sub}>Historial</summary>
        {extra.historial.map(h => <div key={h.id} style={S.sub}>{new Date(h.at).toLocaleString('es-AR')} · {h.accion} · {usuarios.find(u => u.id === h.por)?.nombre ?? ''}</div>)}
      </details>
    </div>
  )
}

export function SubirDoc({ alSubir, tipoInicial = 'conformidad' }: { alSubir: (f: File, tipo: string) => Promise<{ duplicado: boolean }>; tipoInicial?: string }) {
  const [tipo, setTipo] = useState(tipoInicial)
  const { ocupado, correr, Mensaje, setMsg } = useAccion()
  return (
    <div style={S.fila}>
      <select style={S.input} value={tipo} onChange={e => setTipo(e.target.value)}>{Object.entries(TIPOS_DOC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <input type="file" disabled={ocupado} onChange={e => {
        const f = e.target.files?.[0]; if (!f) return
        correr(async () => { const r = await alSubir(f, tipo); setMsg({ tipo: 'ok', texto: r.duplicado ? 'Ese archivo ya estaba cargado: se usó el existente' : 'Documento cargado' }) })
        e.target.value = ''
      }} />
      <Mensaje />
    </div>
  )
}
