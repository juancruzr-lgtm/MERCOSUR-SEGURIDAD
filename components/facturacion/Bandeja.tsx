'use client'
// Prefacturas (Gestión Económica → Facturación → Prefacturas).
// Una fila por comprobante del mes (un objetivo o un grupo, según Clientes y
// contratos) con las horas propuestas de Reportes al lado: Aceptar · Nota · Ver
// turnos en la misma fila, y "Aceptar todos" para lo que no tiene nada que mirar.
// Diferencias, falta de tarifa o inconsistencias quedan marcadas y no entran en
// "Aceptar todos". Preparación (borrador → revisión → aprobada → emitida) separada de entrega y portal.
import { Fragment, useEffect, useState } from 'react'
import { abrirDocumento, api, avisosVigentes, estadoVisible, leer, rpc, subirDocumento, ESTADO_ENTREGA, ESTADO_PORTAL, ESTADO_PREPARACION, MODALIDADES, TIPOS_DOC } from '@/lib/facturacion/datos'
import { datosComprobantesEnLinea, validarRegistroManual } from '@/lib/facturacion/emision-manual'
import { compararConFacturaReal, etiquetaFactura } from '@/lib/facturacion/control'
import { agruparObjetivos, tarifasParaObjetivo } from '@/lib/facturacion/prefacturacion'
import { numeroVisible } from '@/lib/facturacion/comprobantes'
import {
  aprobacionDelMes, elegibleParaAceptarTodos, filaPendiente, filasExcel, minutosPropuestos, motivosRevision, nombreComprobante, objetivoAlDia, objetivosParaAceptar, propuestaDeFila, sinHoras,
  type FilaRevision, type TratamientoDescubiertos,
} from '@/lib/facturacion/revision'
import { COLOR_ESTADO, Etiqueta, S, centavosDe, fecha, horas, pesos, useAccion } from './comun'
import DetalleHoras from './DetalleHoras'
import CambiosHoras from './CambiosHoras'
import { recalcular, useOperacion, type Periodo } from './periodo'
import { nombreDelMes } from '@/lib/facturacion/periodo-seguro'
import { fechaArgentina, rangoFechasMes } from '@/lib/periodo-argentina'
import { plazoPagoDias, vtoPagoParaArca } from '@/lib/facturacion/vto-arca'

const ESTADOS_FILTRO: Array<[string, string]> = [
  ['para_revisar', 'Para revisar'], ['sin_aceptar', 'Horas sin aceptar'],
  ['pendiente_generar', 'Pendiente de generar'], ['en_preparacion', 'Borrador'], ['requiere_revision', 'Requiere revisión'],
  ['lista_aprobar', 'Lista para aprobar'], ['aprobada_emitir', 'Aprobada · pendiente de emisión'], ['emitida', 'Emitida'],
  ['esperando_requisitos', 'Bloqueada por información faltante'],
]
const COLOR_VISIBLE: Record<string, string> = { ...COLOR_ESTADO, pendiente_generar: '#334155', requiere_revision: '#b45309', lista_aprobar: '#2563eb' }
const CHICO: React.CSSProperties = { ...S.btn2, padding: '3px 9px', fontSize: 12 }

type Config = { emision: any; modulos: any }
type Base = Omit<FilaRevision, 'objetivos' | 'prefactura'> & {
  prefactura: any | null
  /** Sin prefactura viva pero con una descartada del período: ese período no se factura (p. ej. servicio no prestado). */
  descartada?: { id: string; version: number } | null
  clave: string; contratoId: string; contrato: { id: string; regla_periodo?: string | null; dia_corte?: number | null }; cliente: any; nombre: string; incluye: string[]; huerfana: boolean
  objetivos: Array<{ objetivoId: string; nombre: string }>
}
const claveObj = (contratoId: string, objetivoId: string) => `${contratoId}:${objetivoId}`

/** Factura real (emitida fuera de la app) con la que se concilió la prefactura y la diferencia con lo calculado. */
function Conciliacion({ c }: { c: any }) {
  const nro = numeroVisible({ tipo: Number(c.tipo), puntoVenta: Number(c.punto_venta), numero: Number(c.numero) })
  const hs = c.horas_facturadas != null && c.horas_app != null && Number(c.horas_facturadas) !== Number(c.horas_app)
    ? ` · ${c.horas_facturadas} h facturadas (la app calculó ${c.horas_app} h)` : ''
  return (
    <div style={{ fontSize: 12, marginTop: 2 }}>
      <div style={{ color: '#4ade80' }}>Conciliada con {nro} del {fecha(c.fecha)} (ARCA)</div>
      {c.estado_diferencia === 'pendiente' && <div style={{ color: '#fbbf24' }}>
        Diferencia pendiente: facturado {pesos(c.total_c)}{c.total_app_c != null ? `, la app calculó ${pesos(c.total_app_c)}` : ' (la app no tiene total para comparar)'}{hs}</div>}
      {c.estado_diferencia === 'explicada' && <div style={S.sub}>Diferencia explicada: {c.motivo}{hs}</div>}
      {c.estado_diferencia === 'resuelta' && <div style={S.sub}>Diferencia resuelta: {c.motivo}</div>}
    </div>
  )
}

export default function Bandeja({ mes, usuarios, config, periodo }: { mes: string; usuarios: Array<{ id: string; nombre: string }>; config: Config; periodo: Periodo }) {
  // Seguro de períodos: en el mes en curso o futuro se consulta, pero no se acepta, recalcula ni aprueba.
  const { operacion, recargarOperacion } = useOperacion(mes)
  const [esperando, setEsperando] = useState<string | null>(null)
  const enCurso = operacion?.estado === 'en_curso' || Boolean(esperando)
  const escribir = periodo.habilitado && !enCurso
  const porQue = !periodo.habilitado ? periodo.motivo ?? 'Período protegido' : enCurso ? 'Hay un recálculo en curso de este período' : undefined
  const [base, setBase] = useState<Base[]>([])
  const [props, setProps] = useState<Record<string, { propuesta: any; error: string | null }>>({})
  const [aprob, setAprob] = useState<any[]>([])
  const [trat, setTrat] = useState<Record<string, TratamientoDescubiertos>>({})
  const [notas, setNotas] = useState<Record<string, string>>({})
  const [verNota, setVerNota] = useState<string | null>(null)
  const [verTurnos, setVerTurnos] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('')
  const [calculando, setCalculando] = useState(false)
  const { ocupado, correr, Mensaje } = useAccion()

  async function cargar(conPropuestas = true) {
    const { desde: inicioMes, ultimoDia: finMes } = rangoFechasMes(mes)
    const [pref, contratos, vincs, tarifas, aps, desc] = await Promise.all([
      leer('fact_prefacturas', q => q.eq('periodo_mes', mes).neq('estado', 'descartada').order('created_at'),
        '*, cliente:fact_clientes(razon_social, cuit, condicion_iva), objetivo:objetivos(nombre), oc:fact_ordenes_compra(numero, tipo), contrato:fact_contratos(nombre, modalidad, agrupacion, requiere_portal, envio_conjunto_planilla, requisitos, dias_vencimiento)'),
      leer('fact_contratos', q => q.eq('estado', 'vigente'), 'id, nombre, modalidad, agrupacion, separar_diurna_nocturna, regla_periodo, dia_corte, cliente:fact_clientes(razon_social, cuit)'),
      leer('fact_contrato_objetivos', q => q.is('anulado_at', null), '*, objetivo:objetivos(nombre)'),
      leer('fact_tarifas', q => q.lte('vigencia_desde', finMes).or(`vigencia_hasta.is.null,vigencia_hasta.gte.${inicioMes}`).order('vigencia_desde', { ascending: false })),
      leer('fact_horas_aprobaciones', q => q.eq('estado', 'aprobada').order('aprobado_at', { ascending: false }).limit(1000)),
      leer('fact_prefacturas', q => q.eq('periodo_mes', mes).eq('estado', 'descartada').order('updated_at', { ascending: false }), 'id, version, contrato_id, agrupacion_clave'),
    ])
    const rs: Base[] = []
    for (const k of contratos) {
      const vs = vincs.filter(v => v.contrato_id === k.id && (!v.hasta || v.hasta >= inicioMes) && (!v.desde || v.desde <= finMes))
      for (const g of agruparObjetivos<any>(k, vs)) {
        const nombres = g.objs.map((v: any) => v.objetivo?.nombre ?? v.objetivo_id)
        const viva = pref.find(p => p.contrato_id === k.id && p.agrupacion_clave === g.clave) ?? null
        rs.push({
          clave: `${k.id}|${g.clave}`, contratoId: k.id, contrato: k, cliente: k.cliente, modalidad: k.modalidad, separarDiurnaNocturna: Boolean(k.separar_diurna_nocturna),
          tarifas: tarifas.filter(t => t.contrato_id === k.id), prefactura: viva,
          descartada: viva ? null : desc.find(d => d.contrato_id === k.id && d.agrupacion_clave === g.clave) ?? null,
          nombre: g.objs.length === 1 ? nombres[0] : g.grupo ?? k.nombre, incluye: g.objs.length > 1 ? nombres : [], huerfana: false,
          objetivos: g.objs.map((v: any) => ({ objetivoId: v.objetivo_id, nombre: v.objetivo?.nombre ?? v.objetivo_id })),
        })
      }
    }
    // Prefacturas vivas que ya no corresponden a la agrupación actual (p. ej. tras reagrupar): se muestran para descartarlas.
    for (const p of pref) if (!rs.some(r => r.prefactura === p)) rs.push({
      clave: `pref|${p.id}`, contratoId: p.contrato_id, contrato: { id: p.contrato_id }, cliente: p.cliente, modalidad: p.contrato?.modalidad ?? 'por_hora', separarDiurnaNocturna: false,
      tarifas: [], prefactura: p, nombre: nombreComprobante(p), incluye: [], huerfana: true, objetivos: [],
    })
    rs.sort((a, b) => `${a.cliente?.razon_social} ${a.nombre}`.localeCompare(`${b.cliente?.razon_social} ${b.nombre}`))
    setBase(rs)
    setAprob(aps)
    if (!conPropuestas) return
    // Propuestas de Reportes de cada objetivo con horas, de a 4 para no saturar el servidor.
    const pendientes = rs.filter(r => !sinHoras(r)).flatMap(r => r.objetivos.map(o => ({ contratoId: r.contratoId, objetivoId: o.objetivoId })))
    setProps({})
    setCalculando(true)
    const acum: Record<string, { propuesta: any; error: string | null }> = {}
    let i = 0
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (i < pendientes.length) {
        const x = pendientes[i++]
        try { acum[claveObj(x.contratoId, x.objetivoId)] = { propuesta: await api('horas', { accion: 'proponer', contrato_id: x.contratoId, objetivo_id: x.objetivoId, mes }), error: null } }
        catch (e: any) { acum[claveObj(x.contratoId, x.objetivoId)] = { propuesta: null, error: e?.message ?? 'No se pudo calcular' } }
        setProps({ ...acum })
      }
    }))
    setCalculando(false)
  }
  useEffect(() => { correr(() => cargar()) }, [mes]) // eslint-disable-line react-hooks/exhaustive-deps

  const aprobadaDe = (contrato: Base['contrato'], objetivoId: string) => aprobacionDelMes(aprob, contrato, objetivoId, mes)
  const filas = base.map(b => ({
    ...b, objetivos: b.objetivos.map(o => {
      const k = claveObj(b.contratoId, o.objetivoId)
      return { ...o, propuesta: props[k]?.propuesta ?? null, error: props[k]?.error ?? null, aprobada: aprobadaDe(b.contrato, o.objetivoId), tratamiento: trat[k] }
    }),
  }))
  type Fila = (typeof filas)[number]

  async function aceptar(f: Fila) {
    for (const o of objetivosParaAceptar(f)) {
      await api('horas', { accion: 'aprobar', contrato_id: f.contratoId, objetivo_id: o.objetivoId, mes, reemplazar: Boolean(o.aprobada),
        tratamiento_descubiertos: o.tratamiento ?? 'no_facturar', notas: notas[f.clave] ?? '' })
    }
  }

  const motivos = new Map(filas.map(f => [f.clave, f.huerfana ? ['Ya no corresponde a la agrupación actual: abrila y descartala'] : motivosRevision(f)]))
  const elegibles = filas.filter(f => !f.huerfana && elegibleParaAceptarTodos(f))
  const visibles = filas.filter(f => {
    if (!filtro) return true
    if (filtro === 'para_revisar') return (motivos.get(f.clave) ?? []).length > 0
    if (filtro === 'sin_aceptar') return filaPendiente(f)
    return estadoVisible(f.prefactura).clave === filtro || f.prefactura?.estado === filtro
  })
  const actual = filas.find(f => f.prefactura?.id === sel)?.prefactura
  const precio = (f: Fila) => {
    const ls = (f.prefactura?.lineas ?? []) as any[]
    if (ls.length) return ls.filter(l => l.tarifaId).map(l => `${l.concepto}: $ ${l.precio}`)
    const ids = f.objetivos.length ? f.objetivos.map(o => o.objetivoId) : [null]
    return Array.from(new Set(ids.flatMap(id => tarifasParaObjetivo(f.tarifas, id).map(t => `${t.concepto}: $ ${t.precio}`))))
  }

  return (
    <div>
      <div style={{ ...S.card, ...S.fila }}>
        <button style={S.btn} disabled={ocupado || calculando || !elegibles.length || !escribir} title={porQue} onClick={() => {
          if (!confirm(`ACEPTAR TODOS — ${nombreDelMes(mes)}\n\nSe aceptan las horas de ${elegibles.length} comprobante(s) sin nada para revisar y después se recalculan las prefacturas del período.\nLo ya aceptado y lo marcado para revisar no se toca.\n\n¿Continuar?`)) return
          correr(async () => {
            const errores: string[] = []
            for (const f of elegibles) { try { await aceptar(f) } catch (e: any) { errores.push(`${f.cliente?.razon_social} · ${f.nombre}: ${e?.message}`) } }
            const r = await recalcular(mes, undefined, setEsperando)
            await cargar(false); await recargarOperacion()
            const todos = [...errores, ...(r.errores ?? [])]
            if (todos.length) throw new Error(`Revisar: ${todos.join(' · ')}`)
          }, 'Horas aceptadas y prefacturas recalculadas')
        }}>{calculando ? 'Calculando propuestas…' : `Aceptar todos (${elegibles.length})`}</button>
        <button style={S.btn2} disabled={ocupado || !escribir} title={porQue} onClick={() => {
          const n = base.filter(b => !b.huerfana).length
          const aviso = operacion?.estado === 'sin_confirmar' ? `\n\nATENCIÓN: el recálculo anterior (${new Date(operacion.iniciada_at).toLocaleString('es-AR')}) quedó SIN CONFIRMAR. Revisá la lista antes de lanzarlo otra vez.` : ''
          if (!confirm(`RECALCULAR PRECIOS — ${nombreDelMes(mes)}\n\nSe recalculan ${n} prefactura(s) del período con las horas aceptadas y las tarifas vigentes. Las aprobadas para emitir y las emitidas no se tocan.\nPuede tardar más de un minuto.${aviso}\n\n¿Continuar?`)) return
          correr(async () => {
            const r = await recalcular(mes, undefined, setEsperando); await cargar(false); await recargarOperacion()
            if (r.errores?.length) throw new Error(`Revisar: ${r.errores.join(' · ')}`)
          }, 'Prefacturas recalculadas')
        }}>Recalcular precios</button>
        <button style={S.btn2} disabled={ocupado || !visibles.some(f => f.prefactura)} onClick={() => correr(() => exportarExcel(mes, visibles.filter(f => f.prefactura).map(f => ({ ...f.prefactura, grupo: f.incluye.length ? f.nombre : null }))), 'Excel descargado')}>Descargar Excel</button>
        <select style={S.input} value={filtro} onChange={e => setFiltro(e.target.value)}>
          <option value="">Todos</option>
          {ESTADOS_FILTRO.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span style={S.sub}>Horas de Reportes (sin capacitación). Lo marcado en amarillo se revisa antes de aceptar.</span>
        <Mensaje />
      </div>
      {!periodo.habilitado && <div style={{ ...S.card, borderColor: '#b91c1c', color: '#fecaca' }}>{periodo.motivo}</div>}
      {(esperando || operacion?.estado === 'en_curso') && <div style={{ ...S.card, borderColor: '#2563eb', color: '#bfdbfe' }}>
        ⏳ {esperando ?? `Recálculo de ${nombreDelMes(mes)} en curso desde ${new Date(operacion!.iniciada_at).toLocaleTimeString('es-AR')}: no se puede lanzar otro hasta que termine.`}
      </div>}
      {!esperando && operacion?.estado === 'sin_confirmar' && <div style={{ ...S.card, borderColor: '#b45309', color: '#fde68a' }}>
        El último recálculo de {nombreDelMes(mes)} ({new Date(operacion.iniciada_at).toLocaleString('es-AR')}) quedó sin confirmar: no se sabe si terminó. Revisá la lista antes de volver a lanzarlo.
      </div>}

      <div style={{ ...S.card, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Cliente', 'Factura o grupo', 'Horas propuestas', '', 'Precio', 'Importe', 'Estado', 'Acción'].map((h, i) => <th key={i} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {visibles.map(f => {
              const prop = propuestaDeFila(f), mot = motivos.get(f.clave) ?? [], p = f.prefactura
              const alDia = f.objetivos.length > 0 && f.objetivos.every(objetivoAlDia)
              const reemplaza = f.objetivos.some(o => o.aprobada && !objetivoAlDia(o))
              const bloqueada = p && ['aprobada_emitir', 'emitida'].includes(p.estado)
              const aprobadas = f.objetivos.reduce((a, o) => a + (o.aprobada?.minutos_aprobados ?? 0), 0)
              const ev = estadoVisible(p)
              return (
                <Fragment key={f.clave}>
                  <tr style={{ background: verTurnos === f.clave || sel === p?.id ? '#111c35' : undefined }}>
                    <td style={S.td}>{f.cliente?.razon_social}<div style={S.sub}>{f.cliente?.cuit ?? 'sin CUIT'}</div></td>
                    <td style={S.td}>{f.nombre}{f.incluye.length > 0 && <div style={S.sub}>{f.incluye.join(' + ')}</div>}</td>
                    <td style={S.num}>{sinHoras(f) ? <span style={S.sub}>abono</span> : f.huerfana ? '—' : prop == null ? <span style={S.sub}>{f.objetivos.some(o => o.error) ? 'error' : '…'}</span> : <b>{horas(prop)} h</b>}
                      {aprobadas > 0 && <div style={{ fontSize: 12, color: alDia ? '#4ade80' : '#fbbf24' }}>aceptadas {horas(aprobadas)} h</div>}</td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                      {!sinHoras(f) && !f.huerfana && <>
                        <button style={alDia ? CHICO : { ...S.btn, padding: '3px 10px', fontSize: 12 }} disabled={ocupado || prop == null || alDia || Boolean(bloqueada) || !escribir} title={porQue} onClick={() => {
                          if (mot.length && !confirm(`Antes de aceptar, revisá:\n• ${mot.join('\n• ')}\n\n¿Aceptar igual?`)) return
                          if (reemplaza && !confirm('Ya hay horas aceptadas: ¿reemplazarlas por la propuesta actual?')) return
                          correr(async () => {
                            await aceptar(f)
                            const r = await recalcular(mes, f.contratoId, setEsperando)
                            await cargar(false)
                            if (r.errores?.length) throw new Error(`Revisar: ${r.errores.join(' · ')}`)
                          }, 'Horas aceptadas')
                        }}>{alDia ? 'Aceptado ✓' : reemplaza ? 'Reemplazar' : 'Aceptar'}</button>{' '}
                        <button style={CHICO} onClick={() => setVerNota(verNota === f.clave ? null : f.clave)}>{notas[f.clave] ? 'Nota ✎' : 'Nota'}</button>{' '}
                        <button style={CHICO} onClick={() => setVerTurnos(verTurnos === f.clave ? null : f.clave)}>{verTurnos === f.clave ? 'Ocultar turnos' : 'Ver turnos'}</button>
                        {verNota === f.clave && <div style={{ marginTop: 6 }}><input autoFocus style={{ ...S.input, width: '100%', boxSizing: 'border-box' }} placeholder="Motivo de la corrección u observación"
                          value={notas[f.clave] ?? ''} onChange={e => setNotas({ ...notas, [f.clave]: e.target.value })} /></div>}
                      </>}
                    </td>
                    <td style={S.td}>{precio(f).map((x, i) => <div key={i} style={{ fontSize: 12 }}>{x}</div>)}</td>
                    <td style={S.num}>{pesos(p?.total_c)}</td>
                    <td style={S.td}>
                      {!p && f.descartada ? <Etiqueta texto="No se factura este período (descartada)" color="#334155" /> : <Etiqueta texto={ev.texto} color={COLOR_VISIBLE[ev.clave]} />}
                      {p?.conciliacion && <Conciliacion c={p.conciliacion} />}
                      {!p?.conciliacion && mot.map((m, i) => <div key={i} style={{ color: '#fbbf24', fontSize: 12 }}>• {m}</div>)}
                      {!p?.conciliacion && !mot.length && (p?.requisitos ?? []).map((r: any, i: number) => <div key={i} style={{ color: '#fbbf24', fontSize: 12 }}>• {r.detalle}</div>)}</td>
                    <td style={S.td}>{p ? <button style={CHICO} onClick={() => setSel(sel === p.id ? null : p.id)}>{sel === p.id ? 'Cerrar' : 'Abrir'}</button>
                      : f.descartada ? <button style={CHICO} disabled={ocupado || !escribir} title={porQue} onClick={() => {
                        if (!confirm('VOLVER A FACTURAR este período\n\nLa prefactura descartada vuelve a borrador y se recalcula. ¿Continuar?')) return
                        correr(async () => {
                          await rpc('fact_prefactura_estado', { p_id: f.descartada!.id, p_estado: 'en_preparacion', p_version: f.descartada!.version, p_motivo: 'Se vuelve a facturar el período' })
                          await recalcular(mes, f.contratoId, setEsperando); await cargar(false)
                        }, 'El período vuelve a facturarse')
                      }}>Volver a facturar</button>
                      : <span style={S.sub}>sin generar</span>}</td>
                  </tr>
                  {verTurnos === f.clave && (
                    <tr><td colSpan={8} style={{ ...S.td, background: '#0b1428' }}>
                      <div style={{ ...S.sub, marginBottom: 8 }}>¿Faltan o sobran horas? Se corrigen en la cobertura del mes (turno y registro, con motivo) y después, acá, se toca Reemplazar. Las horas aceptadas no cambian solas.</div>
                      {f.objetivos.map(o => {
                        const k = claveObj(f.contratoId, o.objetivoId)
                        return (
                          <div key={o.objetivoId} style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                              {o.nombre}
                              {(() => {
                                // Desglose del renglón de este objetivo: sus horas propuestas y SU tarifa vigente.
                                const m = minutosPropuestos(o.propuesta, o.tratamiento)
                                const ts = tarifasParaObjetivo(f.tarifas, o.objetivoId)
                                return <span style={{ ...S.sub, fontWeight: 400 }}>
                                  {m != null ? ` · ${horas(m)} h` : ''}{ts.length ? ` · ${ts.map(t => `${t.concepto}: $ ${t.precio}${t.tratamientoIva === 'incluido' ? ' IVA incl.' : ''}${f.tarifas.find(x => x.id === t.id)?.objetivo_id ? ' (propia del objetivo)' : ' (general)'}`).join(' · ')}` : ' · sin tarifa'}
                                </span>
                              })()}
                            </div>
                            {o.propuesta?.desvio?.hayDiferencia && <CambiosHoras contratoId={f.contratoId} objetivoId={o.objetivoId} mes={mes} estadoPrefactura={p?.estado ?? null} />}
                            {o.error ? <span style={S.err}>{o.error}</span> : o.propuesta ? <DetalleHoras h={o.propuesta.horas} trat={o.tratamiento} alCambiarTrat={t => setTrat({ ...trat, [k]: t })} /> : <span style={S.sub}>Calculando…</span>}
                          </div>
                        )
                      })}
                    </td></tr>
                  )}
                </Fragment>
              )
            })}
            {!visibles.length && <tr><td style={S.td} colSpan={8}><span style={S.sub}>Sin comprobantes para {mes}.</span></td></tr>}
          </tbody>
        </table>
      </div>
      {actual && <Detalle p={actual} usuarios={usuarios} config={config} periodo={periodo} alCambiar={() => correr(() => cargar(false))} />}
    </div>
  )
}

/** Prefacturas del mes en Excel: una fila por renglón con su precio unitario, y el total por prefactura. */
async function exportarExcel(mes: string, filas: any[]) {
  const XLSX: any = await import('xlsx')
  const rows = filasExcel(filas, f => estadoVisible(f).texto)
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [34, 13, 8, 24, 24, 30, 12, 14, 15, 14, 15, 26, 40, 50].map(w => ({ wch: w }))
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
    // Ojo: NO usar punto_venta_prod (es el PV Web Service, 4). En Comprobantes en línea sólo sirven los
    // de Factura en Línea; sin dato propio la guía dice "el habilitado para Comprobantes en línea".
    correr(async () => setPv((await leer('fact_config', q => q.eq('clave', 'emision')))[0]?.valor?.punto_venta_en_linea ?? null))
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

function Detalle({ p, usuarios, config, periodo, alCambiar }: { p: any; usuarios: Array<{ id: string; nombre: string }>; config: Config; periodo: Periodo; alCambiar: () => void }) {
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
  // Cada prefactura admite una sola prueba en homologación (fact_emision_preparar lo controla por ambiente).
  const pruebaHomo = extra.emisiones.find((e: any) => e.ambiente === 'homologacion' && e.estado === 'autorizada')
  const verPdf = (comprobanteId: string) => correr(async () => {
    const r = await api(`comprobante-pdf?id=${comprobanteId}`, undefined, 'GET'); window.open(r.url, '_blank', 'noopener')
  })

  return (
    <div style={S.card}>
      <h3 style={S.h3}>{p.cliente?.razon_social} · {p.objetivo?.nombre ?? p.contrato?.nombre} · {p.periodo_mes}</h3>
      <Mensaje />
      {avisosVigentes(p.avisos, Boolean(config.emision?.punto_venta_prod)).map((a: string, i: number) => <div key={i} style={{ ...S.aviso, marginBottom: 6 }}>{a}</div>)}

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
          <div style={S.sub}>Comprobante tipo {p.tipo_comprobante ?? '—'} · PV {p.punto_venta ?? 'el de la configuración'} · vto. de pago informado a ARCA {fecha(p.fecha_vencimiento)}
            {p.fecha_vencimiento && p.fecha_vencimiento < fechaArgentina() && <> (ya pasó: si se emite hoy, se informa {fecha(vtoPagoParaArca(p.fecha_vencimiento, fechaArgentina(), p.contrato?.dias_vencimiento))}, {plazoPagoDias(p.contrato?.dias_vencimiento)} días desde la emisión, y esa fecha sale en la factura)</>}
            {' '}(el vencimiento comercial sale del contrato)</div>
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
            {!periodo.habilitado && <span style={{ ...S.sub, color: '#fca5a5' }}>Período protegido: no se aprueba ni se emite.</span>}
            {p.estado === 'lista_revision' && <button style={S.btn} disabled={ocupado || !periodo.habilitado} title={periodo.motivo ?? undefined} onClick={() => correr(async () => {
              await rpc('fact_prefactura_aprobar', { p_id: p.id, p_version: p.version }); await hecho()
            }, 'Prefactura aprobada (queda registrada la versión y el importe)')}>Aprobar</button>}
            {p.estado === 'aprobada_emitir' && periodo.habilitado && config.emision.homologacion_habilitada && !pruebaHomo && <>
              <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => {
                const r = await api('emitir', { prefactura_id: p.id, version: p.version, ambiente: 'homologacion' }); await hecho()
                if (r.estado !== 'autorizada') throw new Error(r.motivo ?? r.error ?? r.estado)
              }, 'Emitida en HOMOLOGACIÓN (prueba, no fiscal)')}>Probar en homologación</button>
            </>}
            {pruebaHomo && <>
              <span style={S.sub}>Ya probada en homologación{pruebaHomo.numero ? ` (N° ${pruebaHomo.numero})` : ''}: una prueba por prefactura.</span>
              {pruebaHomo.comprobante_id && <button style={S.btn2} disabled={ocupado} onClick={() => verPdf(pruebaHomo.comprobante_id)}>Ver PDF de la prueba</button>}
            </>}
            {p.estado === 'aprobada_emitir' && periodo.habilitado && config.emision.produccion_habilitada && <>
              <button style={S.btn} disabled={ocupado} onClick={() => correr(async () => {
                // Confirmación EXPRESA de Gerencia sobre este comprobante concreto (la ruta la vuelve a exigir).
                const imp = (await leer('fact_importaciones', q => q.eq('tipo', 'arca_emitidos').order('created_at', { ascending: false }).limit(1), 'created_at'))[0]
                const ultima = imp?.created_at ? new Date(imp.created_at).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : 'nunca'
                const tipo = p.tipo_comprobante === 1 ? 'Factura A' : p.tipo_comprobante === 6 ? 'Factura B' : p.tipo_comprobante === 201 ? 'Factura de Crédito Electrónica A' : `Tipo ${p.tipo_comprobante}`
                // Número previsto: último autorizado en ARCA + 1 (consulta de sólo lectura, no pide CAE).
                let previsto: any
                try { previsto = await api(`numero-previsto?prefactura_id=${encodeURIComponent(p.id)}`, undefined, 'GET') }
                catch (e: any) { throw new Error(`No se pudo consultar a ARCA el número previsto: ${e?.message ?? e}. No se emitió nada.`) }
                const hasta = new Date(Date.parse(`${p.periodo_hasta_excl}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
                if (!confirm(`EMITIR FACTURA REAL EN ARCA (Gerencia)\n\nCliente: ${p.cliente?.razon_social}\nCUIT: ${p.cuit_receptor}\nPeríodo: ${p.periodo_mes} (del ${fecha(p.periodo_desde)} al ${fecha(hasta)})\nTipo: ${tipo}\nImporte total: ${pesos(p.total_c)}\nNúmero previsto: ${previsto.numero_visible}, sujeto a la autorización definitiva de ARCA\n\nÚltima importación de "Mis Comprobantes": ${ultima}\n\n¿Confirmás que este servicio y período NO se facturó por fuera de la app (Comprobantes en línea)?`)) return
                const cuerpo = { prefactura_id: p.id, version: p.version, ambiente: 'produccion', confirmacion: { tipo: p.tipo_comprobante, cuit: p.cuit_receptor, total_c: p.total_c }, confirmo_no_emitida_fuera: true }
                let r: any
                try { r = await api('emitir', cuerpo) } catch (e: any) {
                  if (!e?.detalle?.excepcionable) throw e
                  const motivo = prompt(`${e.message}\n\nSólo si igual corresponde emitir, Gerencia puede autorizar una EXCEPCIÓN: escribí el motivo (queda en el historial).`)
                  if (!motivo?.trim()) throw e
                  r = await api('emitir', { ...cuerpo, excepcion: { motivo } })
                }
                await hecho()
                if (r.estado !== 'autorizada') throw new Error(r.motivo ?? r.error ?? r.estado)
              }, 'Comprobante autorizado por ARCA')}>Emitir en ARCA</button>
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
            {extra.emisiones.map(e => <div key={e.id} style={{ ...S.sub, ...S.fila }}>
              <span>{e.ambiente === 'homologacion' ? 'Prueba en homologación (sin validez fiscal)' : 'Emisión real'} · {e.estado}{e.numero ? ` · N° ${e.numero}` : ''}{e.observaciones ? ` · ${e.observaciones}` : ''}</span>
              {e.estado === 'autorizada' && e.comprobante_id && <button style={{ ...S.btn2, padding: '2px 8px' }} disabled={ocupado} onClick={() => verPdf(e.comprobante_id)}>Ver PDF</button>}
            </div>)}
          </div>}
          {p.estado === 'aprobada_emitir' && periodo.habilitado && config.modulos.emision_manual && <EmisionManual p={p} alHecho={hecho} />}
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
