'use client'
// Bandeja de prefacturación: una fila por cliente + período + agrupación.
// Preparación (en preparación → … → emitida) separada de entrega y portal.
import { useEffect, useState } from 'react'
import { abrirDocumento, api, leer, rpc, subirDocumento, ESTADO_ENTREGA, ESTADO_PORTAL, ESTADO_PREPARACION, TIPOS_DOC } from '@/lib/facturacion/datos'
import { COLOR_ESTADO, Etiqueta, S, centavosDe, fecha, horas, pesos, useAccion } from './comun'

export default function Bandeja({ mes, usuarios }: { mes: string; usuarios: Array<{ id: string; nombre: string }> }) {
  const [filas, setFilas] = useState<any[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('')
  const { ocupado, correr, Mensaje } = useAccion()

  async function cargar() {
    setFilas(await leer('fact_prefacturas', q => q.eq('periodo_mes', mes).neq('estado', 'descartada').order('created_at'),
      '*, cliente:fact_clientes(razon_social, cuit), objetivo:objetivos(nombre), contrato:fact_contratos(nombre, modalidad, requiere_portal, envio_conjunto_planilla)'))
  }
  useEffect(() => { correr(cargar) }, [mes]) // eslint-disable-line react-hooks/exhaustive-deps

  const visibles = filas.filter(f => !filtro || f.estado === filtro)
  const actual = filas.find(f => f.id === sel)

  return (
    <div>
      <div style={{ ...S.card, ...S.fila }}>
        <button style={S.btn} disabled={ocupado} onClick={() => correr(async () => {
          const r = await api('prefacturas', { mes })
          await cargar()
          if (r.errores?.length) throw new Error(`Generadas ${r.creadas}, actualizadas ${r.actualizadas}. Problemas: ${r.errores.join(' · ')}`)
        }, 'Prefacturas generadas / recalculadas desde las horas aprobadas')}>Generar / recalcular {mes}</button>
        <select style={S.input} value={filtro} onChange={e => setFiltro(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(ESTADO_PREPARACION).filter(([k]) => k !== 'descartada').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span style={S.sub}>Las horas salen de la app (aprobadas en la pestaña Horas). Las planillas externas son sólo referencia.</span>
        <Mensaje />
      </div>

      <div style={{ ...S.card, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            {['Cliente', 'Agrupación', 'Período', 'Horas aprob.', 'Neto', 'IVA', 'Total', 'Preparación', 'Entrega / portal', 'Pendiente', 'Responsable'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {visibles.map(f => (
              <tr key={f.id} onClick={() => setSel(f.id === sel ? null : f.id)} style={{ cursor: 'pointer', background: f.id === sel ? '#111c35' : undefined }}>
                <td style={S.td}>{f.cliente?.razon_social}<div style={S.sub}>{f.cliente?.cuit ?? 'sin CUIT'}</div></td>
                <td style={S.td}>{f.objetivo?.nombre ?? f.contrato?.nombre ?? '—'}</td>
                <td style={S.td}>{fecha(f.periodo_desde)} – {fecha(addDias(f.periodo_hasta_excl, -1))}</td>
                <td style={S.num}>{horas(f.minutos_aprobados)}</td>
                <td style={S.num}>{pesos(f.neto_c)}</td>
                <td style={S.num}>{pesos(f.iva_c)}</td>
                <td style={S.num}>{pesos(f.total_c)}</td>
                <td style={S.td}><Etiqueta texto={ESTADO_PREPARACION[f.estado]} color={COLOR_ESTADO[f.estado]} /></td>
                <td style={S.td}>{ESTADO_ENTREGA[f.estado_entrega]}<div style={S.sub}>{ESTADO_PORTAL[f.estado_portal]}</div></td>
                <td style={S.td}>{(f.requisitos ?? []).map((r: any, i: number) => <div key={i} style={{ color: '#fbbf24', fontSize: 12 }}>• {r.detalle}</div>)}
                  {!f.requisitos?.length && <span style={S.sub}>{f.proxima_accion ?? '—'}</span>}</td>
                <td style={S.td}>{usuarios.find(u => u.id === f.responsable_id)?.nombre ?? '—'}</td>
              </tr>
            ))}
            {!visibles.length && <tr><td style={S.td} colSpan={11}><span style={S.sub}>Sin prefacturas para {mes}. Cargá contratos vigentes, aprobá horas y generá.</span></td></tr>}
          </tbody>
        </table>
      </div>
      {actual && <Detalle p={actual} usuarios={usuarios} alCambiar={() => correr(cargar)} />}
    </div>
  )
}

function addDias(f: string, d: number) {
  const x = new Date(`${f}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10)
}

function Detalle({ p, usuarios, alCambiar }: { p: any; usuarios: Array<{ id: string; nombre: string }>; alCambiar: () => void }) {
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
      leer('fact_historial', q => q.eq('entidad', 'prefactura').eq('entidad_id', p.id).order('at', { ascending: false }).limit(20)),
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
          <div style={S.sub}>Horas registradas {horas(p.minutos_registrados)} · aprobadas {horas(p.minutos_aprobados)} · sin registro {horas(p.minutos_pendientes)}</div>
          <div style={S.sub}>Comprobante tipo {p.tipo_comprobante ?? '—'} · PV {p.punto_venta ?? '—'} · vence {fecha(p.fecha_vencimiento)}</div>

          <h4 style={{ ...S.sub, marginTop: 12 }}>TEXTO DE LA FACTURA</h4>
          <textarea style={{ ...S.input, width: '100%', minHeight: 90 }} value={texto} disabled={emitida} onChange={e => setTexto(e.target.value)} />
          {!emitida && <button style={S.btn2} disabled={ocupado || texto === (p.texto_factura ?? '')} onClick={() => correr(async () => {
            await rpc('fact_prefactura_texto', { p_id: p.id, p_texto: texto, p_version: p.version }); await hecho()
          }, p.estado === 'aprobada_emitir' ? 'Texto guardado: el cambio hizo caer la aprobación (vuelve a revisión)' : 'Texto guardado')}>Guardar texto</button>}
        </div>

        <div>
          <h4 style={S.sub}>ACCIONES</h4>
          <div style={S.fila}>
            <select style={S.input} value={p.responsable_id ?? ''} disabled title="Responsable (se asigna al generar)">
              <option value="">{usuarios.find(u => u.id === p.responsable_id)?.nombre ?? 'Sin responsable'}</option>
            </select>
            {p.estado === 'lista_revision' && <button style={S.btn} disabled={ocupado} onClick={() => correr(async () => {
              await rpc('fact_prefactura_aprobar', { p_id: p.id, p_version: p.version }); await hecho()
            }, 'Aprobada para emitir')}>Aprobar para emitir</button>}
            {p.estado === 'aprobada_emitir' && <>
              <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => {
                const r = await api('emitir', { prefactura_id: p.id, version: p.version, ambiente: 'homologacion' }); await hecho()
                if (r.estado !== 'autorizada') throw new Error(r.motivo ?? r.error ?? r.estado)
              }, 'Emitida en HOMOLOGACIÓN (prueba, no fiscal)')}>Probar en homologación</button>
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
