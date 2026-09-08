'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import ImportarLiquidacion from '@/components/liquidacion/ImportarLiquidacion'
import ReimportarExcelTrabajo from '@/components/liquidacion/ReimportarExcelTrabajo'

// GERENCIA → GESTIÓN ECONÓMICA → LIQUIDACIÓN (LIQ1A).
// Principio: cada período NACE LIMPIO (padrón generado, conceptos desde cero;
// sólo entran los permanentes vigentes). No copia el mes anterior. Visual sigue
// siendo el motor salarial; acá se preparan/controlan conceptos.

type Empleado = { id: string; nombre?: string | null; apellido?: string | null; legajo?: string | null; estado?: string | null }
type Periodo = { id: string; mes: string; estado: string; created_at: string }
type Concepto = { id: string; codigo_visual: string | null; nombre: string; categoria: string; origen: string; ambito: string; activo: boolean }
type Permanente = { id: string; empleado_id: string; concepto_id: string; cantidad: number | null; importe: number | null; vigencia_desde: string; vigencia_hasta: string | null; motivo: string | null; activo: boolean }
type ConceptoPeriodo = { id: string; empleado_id: string | null; concepto_id: string; cantidad: number | null; importe: number | null; origen: string }

const CATEGORIAS = ['imponible', 'no_imponible', 'asignacion', 'descuento', 'base_auxiliar']
const ORIGENES = ['mercosur', 'novedad_laboral', 'regla', 'permanente_individual', 'manual_periodo', 'importado', 'calculado_visual']
// Transiciones "simples" (botón → siguiente). revision→consolidada va por el
// botón Consolidar (RPC + snapshot); consolidada→exportada por LIQ2D.
const ESTADOS_SIG: Record<string, string | null> = { borrador: 'revision', exportada: 'liquidada' }
const EDITABLE = (estado: string) => estado === 'borrador' || estado === 'revision'

const S: Record<string, React.CSSProperties> = {
  wrap: { padding: 16, color: '#e2e8f0', maxWidth: 1000 },
  card: { background: '#0f1629', border: '1px solid #1e293b', borderRadius: 10, padding: 16, marginBottom: 16 },
  input: { padding: '8px 10px', background: '#0a0e1a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 14 },
  btn: { padding: '8px 14px', background: '#2563eb', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  th: { textAlign: 'left', fontSize: 11, color: '#64748b', padding: '6px 8px', borderBottom: '1px solid #1e293b' },
  td: { fontSize: 13, padding: '6px 8px', borderBottom: '1px solid #131c2e' },
  err: { color: '#f87171', fontSize: 13 }, ok: { color: '#4ade80', fontSize: 13 },
}
const tabStyle = (a: boolean): React.CSSProperties => ({ padding: '8px 14px', background: a ? '#1e293b' : 'transparent', color: a ? '#fff' : '#94a3b8', border: '1px solid #1e293b', borderRadius: 6, cursor: 'pointer', fontSize: 13 })
// Límites [desde, hasta] del mes 'YYYY-MM' (para cruzar novedades del mes con el período).
function limitesDelMes(mes: string): { desde: string; hasta: string } {
  const desde = `${mes}-01`
  const [y, m] = mes.split('-').map(Number)
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { desde, hasta: `${mes}-${String(ultimo).padStart(2, '0')}` }
}

export default function LiquidacionPanel({ user, empleados }: { user: any; empleados: Empleado[] }) {
  const [tab, setTab] = useState<'periodos' | 'catalogo' | 'permanentes'>('periodos')
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const activos = useMemo(() => (empleados || []).filter(e => String(e.estado ?? 'activo').toLowerCase() !== 'inactivo')
    .sort((a, b) => `${a.apellido}`.localeCompare(`${b.apellido}`, 'es')), [empleados])
  const nombreEmp = (id?: string | null) => { const e = activos.find(x => x.id === id); return e ? `${e.apellido ?? ''}, ${e.nombre ?? ''}` : (id || '—') }

  // Períodos
  const [periodos, setPeriodos] = useState<Periodo[]>([])
  const [nuevoMes, setNuevoMes] = useState(new Date().toISOString().slice(0, 7))
  const [sel, setSel] = useState<Periodo | null>(null)
  const [padronN, setPadronN] = useState(0)
  const [conceptosP, setConceptosP] = useState<ConceptoPeriodo[]>([])
  // Catálogo
  const [catalogo, setCatalogo] = useState<Concepto[]>([])
  const [cForm, setCForm] = useState({ codigo_visual: '', nombre: '', categoria: 'imponible', origen: 'mercosur' })
  // Comparación con período anterior + novedades del mes (LIQ1C)
  const [comparacion, setComparacion] = useState<any[] | null>(null)
  const [novedadesMes, setNovedadesMes] = useState<any[]>([])
  // LIQ2A: generación del Excel de trabajo
  const [genExcel, setGenExcel] = useState(false)
  // LIQ2C: consolidación
  const [consolidando, setConsolidando] = useState(false)
  const [consolidadaN, setConsolidadaN] = useState(0)
  // LIQ2D: export a Visual
  const [genVisual, setGenVisual] = useState(false)
  // Permanentes
  const [permanentes, setPermanentes] = useState<Permanente[]>([])
  const [pForm, setPForm] = useState({ empleado_id: '', concepto_id: '', importe: '', cantidad: '', vigencia_desde: new Date().toISOString().slice(0, 10), vigencia_hasta: '', motivo: '' })

  async function cargarPeriodos() {
    const { data } = await supabase.from('liquidacion_periodo').select('id, mes, estado, created_at').order('mes', { ascending: false })
    if (data) setPeriodos(data as Periodo[])
  }
  async function cargarCatalogo() {
    const { data } = await supabase.from('liquidacion_concepto_catalogo').select('id, codigo_visual, nombre, categoria, origen, ambito, activo').order('nombre')
    if (data) setCatalogo(data as Concepto[])
  }
  async function cargarPermanentes() {
    const { data } = await supabase.from('liquidacion_concepto_permanente').select('id, empleado_id, concepto_id, cantidad, importe, vigencia_desde, vigencia_hasta, motivo, activo').order('vigencia_desde', { ascending: false })
    if (data) setPermanentes(data as Permanente[])
  }
  useEffect(() => { void cargarPeriodos(); void cargarCatalogo(); void cargarPermanentes() }, [])

  async function abrirPeriodo(p: Periodo) {
    setSel(p)
    setComparacion(null)
    const { desde, hasta } = limitesDelMes(p.mes)
    const [{ count }, { data: cp }, { data: nov }, { count: consN }] = await Promise.all([
      supabase.from('liquidacion_periodo_empleado').select('*', { count: 'exact', head: true }).eq('periodo_id', p.id),
      supabase.from('liquidacion_concepto_periodo').select('id, empleado_id, concepto_id, cantidad, importe, origen').eq('periodo_id', p.id),
      supabase.from('novedades_laborales').select('empleado_id, tipo, fecha_desde, fecha_hasta, dias_informados, cantidad_dias')
        .eq('estado', 'aprobada').lte('fecha_desde', hasta).gte('fecha_hasta', desde),
      supabase.from('liquidacion_consolidada').select('*', { count: 'exact', head: true }).eq('periodo_id', p.id),
    ])
    setPadronN(count ?? 0)
    setConceptosP((cp as ConceptoPeriodo[]) ?? [])
    setNovedadesMes((nov as any[]) ?? [])
    setConsolidadaN(consN ?? 0)
  }

  async function comparar() {
    if (!sel) return
    const { data, error } = await supabase.rpc('comparar_liquidacion_anterior', { p_periodo_id: sel.id })
    if (error) { setMsg({ ok: false, t: 'No se pudo comparar: ' + error.message }); return }
    setComparacion((data as any[]) ?? [])
  }

  // LIQ2A: MERCOSUR genera el Excel de trabajo del mes del período (mismo
  // archivo que #170, con identidad oculta para el reimport). Juan lo edita y
  // lo vuelve a subir (LIQ2B). No depende del mes cargado en Reportes.
  async function descargarExcelTrabajo() {
    if (!sel) return
    setGenExcel(true); setMsg(null)
    try {
      const { generarExcelTrabajoLiquidacion } = await import('@/lib/excel-trabajo-liquidacion')
      const r = await generarExcelTrabajoLiquidacion(supabase, sel.mes)
      if (r.error || !r.buf) { setMsg({ ok: false, t: 'No se pudo generar el Excel de trabajo: ' + (r.error || 'sin datos') }); return }
      const blob = new Blob([r.buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `liquidacion_trabajo_${sel.mes}.xlsx`
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
      setMsg({ ok: true, t: `Excel de trabajo generado (${r.filas} empleados). Editalo y volvé a subirlo para ver las diferencias.` })
    } catch (e: any) {
      setMsg({ ok: false, t: 'No se pudo generar el Excel de trabajo: ' + (e?.message || e) })
    } finally { setGenExcel(false) }
  }

  async function crearPeriodo() {
    setMsg(null)
    const { data, error } = await supabase.rpc('crear_periodo_liquidacion', { p_mes: nuevoMes })
    if (error) { setMsg({ ok: false, t: 'No se pudo crear: ' + error.message }); return }
    setMsg({ ok: true, t: `Período ${nuevoMes} creado (nace limpio: padrón generado, conceptos desde cero).` })
    await cargarPeriodos()
    if (data) { const p = { id: data as string, mes: nuevoMes, estado: 'borrador', created_at: '' }; await abrirPeriodo(p) }
  }

  async function cambiarEstado(p: Periodo) {
    const sig = ESTADOS_SIG[p.estado]; if (!sig) return
    const { error } = await supabase.from('liquidacion_periodo').update({ estado: sig, updated_at: new Date().toISOString() }).eq('id', p.id)
    if (!error) { await cargarPeriodos(); if (sel?.id === p.id) setSel({ ...p, estado: sig }) }
  }

  // LIQ2C: consolidar = congelar snapshot (baseline + ajustes) por empleado×código
  // y pasar el período a 'consolidada'. El cálculo vive en el cliente (fuente
  // única); la RPC sólo persiste atómico.
  async function consolidar() {
    if (!sel) return
    setConsolidando(true); setMsg(null)
    try {
      const { snapshotConsolidadoDelMes } = await import('@/lib/excel-trabajo-liquidacion')
      const snap = await snapshotConsolidadoDelMes(supabase, sel.id, sel.mes)
      if (snap.error) { setMsg({ ok: false, t: 'No se pudo armar el consolidado: ' + snap.error }); return }
      const { data, error } = await supabase.rpc('consolidar_periodo', { p_periodo_id: sel.id, p_filas: snap.filas })
      if (error) { setMsg({ ok: false, t: 'No se pudo consolidar: ' + error.message }); return }
      const r = data as any
      setMsg({ ok: true, t: `Consolidado: ${r.filas} filas (empleado × código). El período quedó CONSOLIDADO.` })
      await cargarPeriodos(); const actualizado = { ...sel, estado: 'consolidada' }; setSel(actualizado); void abrirPeriodo(actualizado)
    } catch (e: any) {
      setMsg({ ok: false, t: 'No se pudo consolidar: ' + (e?.message || e) })
    } finally { setConsolidando(false) }
  }

  // LIQ2D: genera el .xls de importación a Visual desde el consolidado + config
  // por concepto, lo descarga y marca el período EXPORTADA. No recalcula.
  async function generarVisual() {
    if (!sel) return
    setGenVisual(true); setMsg(null)
    try {
      const [{ data: cons, error: e1 }, { data: cfg, error: e2 }] = await Promise.all([
        supabase.from('liquidacion_consolidada').select('empleado_id, legajo_visual, cuil, nombre, codigo, cantidad, importe').eq('periodo_id', sel.id),
        supabase.from('liquidacion_concepto_catalogo').select('codigo_visual, exporta_visual, manda_cantidad, manda_importe'),
      ])
      if (e1 || e2) { setMsg({ ok: false, t: 'No se pudo leer el consolidado: ' + ((e1 || e2) as any).message }); return }
      if (!cons || cons.length === 0) { setMsg({ ok: false, t: 'No hay filas consolidadas. Consolidá primero.' }); return }
      const configPorCodigo = new Map<string, any>()
      for (const c of (cfg ?? []) as any[]) if (c.codigo_visual) configPorCodigo.set(String(c.codigo_visual), { exporta_visual: c.exporta_visual, manda_cantidad: c.manda_cantidad, manda_importe: c.manda_importe })
      const { filasVisual, escribirLibroVisualXls } = await import('@/lib/visual-export')
      const filas = filasVisual(cons as any, configPorCodigo)
      if (filas.length === 0) { setMsg({ ok: false, t: 'La configuración de conceptos dejó 0 filas para exportar.' }); return }
      const bytes = await escribirLibroVisualXls(filas)
      const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.ms-excel' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `visual_importacion_${sel.mes}.xls`
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
      // Sólo la PRIMERA exportación (desde consolidada) marca el estado; una
      // regeneración posterior sólo vuelve a bajar el archivo.
      if (sel.estado === 'consolidada') {
        const { error } = await supabase.rpc('marcar_exportada_visual', { p_periodo_id: sel.id })
        if (error) { setMsg({ ok: false, t: `Archivo generado (${filas.length} filas), pero no se pudo marcar exportado: ${error.message}` }); return }
        setMsg({ ok: true, t: `Archivo Visual generado (${filas.length} filas) y período marcado EXPORTADA. Importalo en Visual Sueldos para calcular los recibos.` })
        await cargarPeriodos(); const upd = { ...sel, estado: 'exportada' }; setSel(upd); void abrirPeriodo(upd)
      } else {
        setMsg({ ok: true, t: `Archivo Visual regenerado (${filas.length} filas).` })
      }
    } catch (e: any) {
      setMsg({ ok: false, t: 'No se pudo generar el archivo Visual: ' + (e?.message || e) })
    } finally { setGenVisual(false) }
  }

  async function agregarConcepto() {
    setMsg(null)
    if (!cForm.nombre.trim()) { setMsg({ ok: false, t: 'Nombre requerido.' }); return }
    const { error } = await supabase.from('liquidacion_concepto_catalogo').insert({
      codigo_visual: cForm.codigo_visual.trim() || null, nombre: cForm.nombre.trim(),
      categoria: cForm.categoria, origen: cForm.origen, created_by: user?.id ?? null,
    })
    if (error) { setMsg({ ok: false, t: 'No se pudo: ' + error.message }); return }
    setCForm({ codigo_visual: '', nombre: '', categoria: 'imponible', origen: 'mercosur' })
    setMsg({ ok: true, t: 'Concepto agregado al catálogo.' }); void cargarCatalogo()
  }

  async function agregarPermanente() {
    setMsg(null)
    if (!pForm.empleado_id || !pForm.concepto_id) { setMsg({ ok: false, t: 'Empleado y concepto requeridos.' }); return }
    const { error } = await supabase.from('liquidacion_concepto_permanente').insert({
      empleado_id: pForm.empleado_id, concepto_id: pForm.concepto_id,
      importe: pForm.importe ? Number(pForm.importe) : null, cantidad: pForm.cantidad ? Number(pForm.cantidad) : null,
      vigencia_desde: pForm.vigencia_desde, vigencia_hasta: pForm.vigencia_hasta || null,
      motivo: pForm.motivo.trim() || null, created_by: user?.id ?? null,
    })
    if (error) { setMsg({ ok: false, t: 'No se pudo: ' + error.message }); return }
    setPForm({ ...pForm, importe: '', cantidad: '', motivo: '' })
    setMsg({ ok: true, t: 'Concepto permanente agregado (entrará en cada período vigente).' }); void cargarPermanentes()
  }

  const nombreConcepto = (id: string) => { const c = catalogo.find(x => x.id === id); return c ? `${c.codigo_visual ? c.codigo_visual + ' · ' : ''}${c.nombre}` : id }

  return (
    <div style={S.wrap}>
      <h2 style={{ fontSize: 20, marginBottom: 2 }}>Gestión Económica · Liquidación</h2>
      <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 12 }}>
        Cada período nace limpio: se genera el padrón pero los conceptos se construyen desde cero.
        El mes anterior sirve de control, nunca como plantilla. Visual Sueldos calcula el recibo.
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button style={tabStyle(tab === 'periodos')} onClick={() => setTab('periodos')}>Períodos</button>
        <button style={tabStyle(tab === 'catalogo')} onClick={() => setTab('catalogo')}>Catálogo de conceptos</button>
        <button style={tabStyle(tab === 'permanentes')} onClick={() => setTab('permanentes')}>Permanentes</button>
      </div>
      {msg && <div style={{ ...(msg.ok ? S.ok : S.err), marginBottom: 10 }}>{msg.t}</div>}

      {tab === 'periodos' && (
        <>
          <div style={S.card}>
            <strong>Nuevo período</strong>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
              <input type="month" style={S.input} value={nuevoMes} onChange={e => setNuevoMes(e.target.value)} />
              <button style={S.btn} onClick={() => void crearPeriodo()}>Crear período (vacío)</button>
            </div>
          </div>
          <div style={S.card}>
            <strong>Períodos</strong>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
              <thead><tr><th style={S.th}>Mes</th><th style={S.th}>Estado</th><th style={S.th}></th></tr></thead>
              <tbody>{periodos.map(p => (
                <tr key={p.id}>
                  <td style={S.td}>{p.mes}</td><td style={S.td}>{p.estado}</td>
                  <td style={S.td}>
                    <button style={{ ...S.btn, background: '#334155', marginRight: 6 }} onClick={() => void abrirPeriodo(p)}>Ver</button>
                    {ESTADOS_SIG[p.estado] && <button style={{ ...S.btn, background: '#475569' }} onClick={() => void cambiarEstado(p)}>→ {ESTADOS_SIG[p.estado]}</button>}
                  </td>
                </tr>))}
                {periodos.length === 0 && <tr><td style={S.td} colSpan={3}>Sin períodos.</td></tr>}
              </tbody>
            </table>
          </div>
          {sel && (
            <div style={S.card}>
              <strong>Período {sel.mes} · {sel.estado}</strong>
              <div style={{ fontSize: 13, marginTop: 6 }}>Padrón: <b>{padronN}</b> empleados · Conceptos cargados: <b>{conceptosP.length}</b> {conceptosP.length === 0 && <span style={{ color: '#64748b' }}>(nace vacío)</span>}</div>
              {conceptosP.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
                  <thead><tr><th style={S.th}>Empleado</th><th style={S.th}>Concepto</th><th style={S.th}>Cant</th><th style={S.th}>Importe</th><th style={S.th}>Origen</th></tr></thead>
                  <tbody>{conceptosP.slice(0, 100).map(c => (
                    <tr key={c.id}><td style={S.td}>{c.empleado_id ? nombreEmp(c.empleado_id) : '(general)'}</td><td style={S.td}>{nombreConcepto(c.concepto_id)}</td><td style={S.td}>{c.cantidad ?? '—'}</td><td style={S.td}>{c.importe ?? '—'}</td><td style={S.td}>{c.origen}</td></tr>
                  ))}</tbody>
                </table>
              )}
              {/* LIQ2A · PASO 1: MERCOSUR genera el Excel de trabajo del mes. */}
              {EDITABLE(sel.estado) && (
                <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button style={{ ...S.btn, opacity: genExcel ? 0.6 : 1 }} disabled={genExcel} onClick={() => void descargarExcelTrabajo()}>
                    {genExcel ? 'Generando…' : 'Descargar Excel de trabajo'}
                  </button>
                  <span style={{ color: '#64748b', fontSize: 12, flex: '1 1 240px' }}>
                    PASO 1 · MERCOSUR arma el Excel del mes (padrón, jornadas, novedades, conceptos y fórmulas). Lo editás en Excel y lo volvés a subir para ver las diferencias.
                  </span>
                </div>
              )}

              {/* LIQ2B · PASO 3: subir el Excel revisado → preview de diferencias. */}
              {EDITABLE(sel.estado) && (
                <ReimportarExcelTrabajo periodo={sel} onDone={() => { void abrirPeriodo(sel) }} />
              )}

              {/* Importación del RESULTADO de Visual (conciliación) — NO es el
                  flujo principal de preparación. Queda para traer/contrastar lo
                  que Visual devolvió. */}
              {EDITABLE(sel.estado) && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12, color: '#64748b', margin: '6px 0' }}>
                    Conciliación (opcional): importar un resultado/planilla de Visual para contrastar. No reemplaza al Excel de trabajo.
                  </div>
                  <ImportarLiquidacion periodo={sel} empleados={activos as any} catalogo={catalogo as any}
                    onDone={() => { void abrirPeriodo(sel); void cargarCatalogo() }} />
                </div>
              )}

              {/* Novedades laborales del mes: control de alimentación (referencia). */}
              <div style={{ marginTop: 12, fontSize: 13 }}>
                <b>Novedades del mes (aprobadas):</b> {novedadesMes.length}
                {novedadesMes.length > 0 && <span style={{ color: '#64748b' }}> — control para cruzar contra los conceptos cargados.</span>}
              </div>

              {/* LIQ1C: comparación con el período anterior (control de omisiones, no copia). */}
              <div style={{ marginTop: 12 }}>
                <button style={{ ...S.btn, background: '#334155' }} onClick={() => void comparar()}>Comparar con período anterior</button>
                {comparacion && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>
                      El mes anterior es sólo control de omisiones: <b>desaparecido</b> = estaba antes y ahora no (¿falta cargar o terminó?). Nunca se copia automáticamente.
                    </div>
                    {comparacion.length === 0 ? <div style={{ color: '#64748b', fontSize: 13 }}>Sin diferencias con el período anterior (o no hay anterior).</div> : (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr><th style={S.th}>Empleado</th><th style={S.th}>Concepto</th><th style={S.th}>Estado</th><th style={S.th}>Actual</th><th style={S.th}>Anterior</th></tr></thead>
                        <tbody>{comparacion.slice(0, 200).map((c, i) => (
                          <tr key={i} style={{ color: c.estado === 'desaparecido' ? '#fbbf24' : c.estado === 'nuevo' ? '#4ade80' : '#e2e8f0' }}>
                            <td style={S.td}>{nombreEmp(c.empleado_id)}</td>
                            <td style={S.td}>{c.codigo ? c.codigo + ' · ' : ''}{c.concepto || '—'}</td>
                            <td style={S.td}>{c.estado}</td>
                            <td style={S.td}>{c.importe_actual ?? '—'}</td>
                            <td style={S.td}>{c.importe_anterior ?? '—'}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>

              {/* LIQ2C · PASO 6: consolidar (congela snapshot por empleado×código). */}
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #1e293b' }}>
                {consolidadaN > 0 && (
                  <div style={{ fontSize: 13, marginBottom: 8 }}>
                    Consolidado: <b>{consolidadaN}</b> filas (empleado × código) congeladas
                    {sel.estado === 'consolidada' && <span style={{ color: '#4ade80' }}> · período CONSOLIDADO</span>}.
                  </div>
                )}
                {EDITABLE(sel.estado) ? (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button style={{ ...S.btn, background: '#7c3aed', opacity: consolidando ? 0.6 : 1 }} disabled={consolidando} onClick={() => void consolidar()}>
                      {consolidando ? 'Consolidando…' : 'Consolidar liquidación'}
                    </button>
                    <span style={{ color: '#64748b', fontSize: 12, flex: '1 1 240px' }}>
                      PASO 6 · Congela una versión concreta y auditable (baseline + ajustes) para exportar a Visual. Podés re-consolidar mientras no esté exportada.
                    </span>
                  </div>
                ) : sel.estado === 'consolidada' ? (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button style={{ ...S.btn, background: '#059669', opacity: genVisual ? 0.6 : 1 }} disabled={genVisual} onClick={() => void generarVisual()}>
                      {genVisual ? 'Generando…' : 'Generar archivo Visual Sueldos'}
                    </button>
                    <button style={{ ...S.btn, background: '#475569', opacity: consolidando ? 0.6 : 1 }} disabled={consolidando} onClick={() => void consolidar()}>
                      Re-consolidar
                    </button>
                    <span style={{ color: '#64748b', fontSize: 12, flex: '1 1 100%' }}>
                      PASO 7 · Genera el .xls de importación a Visual desde el consolidado (config por concepto). Marca el período EXPORTADA. La liquidación final la calcula Visual.
                    </span>
                  </div>
                ) : sel.estado === 'exportada' || sel.estado === 'liquidada' ? (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button style={{ ...S.btn, background: '#059669', opacity: genVisual ? 0.6 : 1 }} disabled={genVisual} onClick={() => void generarVisual()}>
                      {genVisual ? 'Generando…' : 'Regenerar archivo Visual'}
                    </button>
                    <span style={{ color: '#64748b', fontSize: 12, flex: '1 1 240px' }}>
                      Período {sel.estado}. Podés volver a bajar el archivo de importación.
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'catalogo' && (
        <div style={S.card}>
          <strong>Catálogo de conceptos</strong>
          <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>Los códigos de Visual son semilla; el import (LIQ1B) incorpora los desconocidos, nunca los ignora.</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
            <input style={{ ...S.input, width: 110 }} placeholder="Cód. Visual" value={cForm.codigo_visual} onChange={e => setCForm({ ...cForm, codigo_visual: e.target.value })} />
            <input style={{ ...S.input, flex: '1 1 200px' }} placeholder="Nombre del concepto" value={cForm.nombre} onChange={e => setCForm({ ...cForm, nombre: e.target.value })} />
            <select style={S.input} value={cForm.categoria} onChange={e => setCForm({ ...cForm, categoria: e.target.value })}>{CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}</select>
            <select style={S.input} value={cForm.origen} onChange={e => setCForm({ ...cForm, origen: e.target.value })}>{ORIGENES.map(o => <option key={o} value={o}>{o}</option>)}</select>
            <button style={S.btn} onClick={() => void agregarConcepto()}>Agregar</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={S.th}>Código</th><th style={S.th}>Nombre</th><th style={S.th}>Categoría</th><th style={S.th}>Origen</th></tr></thead>
            <tbody>{catalogo.map(c => (<tr key={c.id}><td style={S.td}>{c.codigo_visual || '—'}</td><td style={S.td}>{c.nombre}</td><td style={S.td}>{c.categoria}</td><td style={S.td}>{c.origen}</td></tr>))}
              {catalogo.length === 0 && <tr><td style={S.td} colSpan={4}>Catálogo vacío (se puebla por carga manual o import).</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'permanentes' && (
        <div style={S.card}>
          <strong>Conceptos permanentes individuales</strong>
          <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>Ej: embargo/alimentos con vigencia. Entran automáticamente en cada período vigente.</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
            <select style={{ ...S.input, flex: '1 1 200px' }} value={pForm.empleado_id} onChange={e => setPForm({ ...pForm, empleado_id: e.target.value })}>
              <option value="">— Empleado —</option>{activos.map(e => <option key={e.id} value={e.id}>{`${e.apellido ?? ''}, ${e.nombre ?? ''}`}</option>)}
            </select>
            <select style={{ ...S.input, flex: '1 1 180px' }} value={pForm.concepto_id} onChange={e => setPForm({ ...pForm, concepto_id: e.target.value })}>
              <option value="">— Concepto —</option>{catalogo.map(c => <option key={c.id} value={c.id}>{`${c.codigo_visual ? c.codigo_visual + ' · ' : ''}${c.nombre}`}</option>)}
            </select>
            <input style={{ ...S.input, width: 100 }} placeholder="Importe" value={pForm.importe} onChange={e => setPForm({ ...pForm, importe: e.target.value })} />
            <input type="date" style={S.input} value={pForm.vigencia_desde} onChange={e => setPForm({ ...pForm, vigencia_desde: e.target.value })} />
            <input type="date" style={S.input} value={pForm.vigencia_hasta} onChange={e => setPForm({ ...pForm, vigencia_hasta: e.target.value })} title="Vigencia hasta (opcional)" />
            <input style={{ ...S.input, flex: '1 1 140px' }} placeholder="Motivo" value={pForm.motivo} onChange={e => setPForm({ ...pForm, motivo: e.target.value })} />
            <button style={S.btn} onClick={() => void agregarPermanente()}>Agregar</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={S.th}>Empleado</th><th style={S.th}>Concepto</th><th style={S.th}>Importe</th><th style={S.th}>Vigencia</th><th style={S.th}>Motivo</th></tr></thead>
            <tbody>{permanentes.map(p => (<tr key={p.id} style={{ opacity: p.activo ? 1 : 0.5 }}><td style={S.td}>{nombreEmp(p.empleado_id)}</td><td style={S.td}>{nombreConcepto(p.concepto_id)}</td><td style={S.td}>{p.importe ?? '—'}</td><td style={S.td}>{p.vigencia_desde} → {p.vigencia_hasta || '∞'}</td><td style={S.td}>{p.motivo || '—'}</td></tr>))}
              {permanentes.length === 0 && <tr><td style={S.td} colSpan={5}>Sin conceptos permanentes.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
