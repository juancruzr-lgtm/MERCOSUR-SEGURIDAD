'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import ReimportarExcelTrabajo from '@/components/liquidacion/ReimportarExcelTrabajo'
import PadronLiquidacion from '@/components/liquidacion/PadronLiquidacion'
import ImportarResultadoVisual from '@/components/liquidacion/ImportarResultadoVisual'
import { clasificarBloqueados } from '@/lib/visual-export'

// GERENCIA → GESTIÓN ECONÓMICA → LIQUIDACIÓN (LIQ1A).
// Principio: cada período NACE LIMPIO (padrón generado, conceptos desde cero;
// sólo entran los permanentes vigentes). No copia el mes anterior. Visual sigue
// siendo el motor salarial; acá se preparan/controlan conceptos.

type Empleado = { id: string; nombre?: string | null; apellido?: string | null; legajo?: string | null; estado?: string | null }
type Periodo = { id: string; mes: string; estado: string; created_at: string; creado_por?: string | null }
type PeriodoFlags = { reimport: boolean; consolidada: boolean; resultado: boolean }
type Concepto = { id: string; codigo_visual: string | null; nombre: string; categoria: string; origen: string; ambito: string; activo: boolean }
type Permanente = { id: string; empleado_id: string; concepto_id: string; cantidad: number | null; importe: number | null; vigencia_desde: string; vigencia_hasta: string | null; motivo: string | null; activo: boolean }
type ConceptoPeriodo = { id: string; empleado_id: string | null; concepto_id: string; cantidad: number | null; importe: number | null; origen: string }

const CATEGORIAS = ['imponible', 'no_imponible', 'asignacion', 'descuento', 'base_auxiliar']
const ORIGENES = ['mercosur', 'novedad_laboral', 'regla', 'permanente_individual', 'manual_periodo', 'importado', 'calculado_visual']
// Transiciones "simples" (botón → siguiente). revision→consolidada va por el
// botón Consolidar (RPC + snapshot); consolidada→exportada por LIQ2D.
const ESTADOS_SIG: Record<string, string | null> = { borrador: 'revision', exportada: 'liquidada' }
const EDITABLE = (estado: string) => estado === 'borrador' || estado === 'revision'
// Mientras la liquidación NO fue enviada a Visual: se puede descargar el Excel de
// trabajo, reimportar y prevalidar. Incluye períodos legacy en 'consolidada'
// (ese paso manual se eliminó; ahora consolidar ocurre dentro de Generar Visual).
const ANTES_VISUAL = (estado: string) => estado !== 'exportada' && estado !== 'liquidada'
// UX (JC): las herramientas de revisión auxiliares (000 / expedientes / novedades /
// comparación) se OCULTAN del panel hasta tener el editable real por empleado.
// No se borra código ni datos ni RPCs: sólo no se renderiza la sección.
const MOSTRAR_HERRAMIENTAS_REVISION = false

/** Dispara la descarga de un archivo en el navegador (Blob + ancla efímera). */
function descargarArchivo(bytes: BlobPart, filename: string, mime: string) {
  const blob = new Blob([bytes], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}

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
// F2: encabezado de paso del circuito (secuencia guía, no wizard rígido).
function PasoHeader({ n, titulo, sub, activo }: { n: number; titulo: string; sub?: string; activo: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '18px 0 8px', paddingTop: 12, borderTop: '1px solid #1e293b' }}>
      <span style={{ width: 24, height: 24, borderRadius: '50%', background: activo ? '#2563eb' : '#334155', color: '#fff', fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{n}</span>
      <div><span style={{ fontWeight: 700, fontSize: 15, color: activo ? '#e2e8f0' : '#94a3b8' }}>{titulo}</span>{sub && <span style={{ color: '#64748b', fontSize: 12, marginLeft: 8 }}>{sub}</span>}</div>
    </div>
  )
}
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
  const [flags, setFlags] = useState<Record<string, PeriodoFlags>>({})
  const [creadores, setCreadores] = useState<Record<string, string>>({})
  const [verAnulados, setVerAnulados] = useState(false)
  const [borrando, setBorrando] = useState<string | null>(null)
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
  // Snapshot consolidado (informativo). La consolidación dejó de ser un paso
  // manual: ocurre dentro de "Generar archivo Visual" (export atómico).
  const [consolidadaN, setConsolidadaN] = useState(0)
  // Prevalidación (PREVIEW): reutiliza la regla real de Visual. Generar Visual la
  // vuelve a correr de forma autoritativa antes de escribir nada.
  const [preval, setPreval] = useState<any>(null)
  const [prevalidando, setPrevalidando] = useState(false)
  // Export a Visual + validación pre-export
  const [genVisual, setGenVisual] = useState(false)
  const [validacion, setValidacion] = useState<any>(null)
  const [genBanco, setGenBanco] = useState<'' | 'sueldos' | 'extras' | 'completo' | 'general'>('')
  const [msgBanco, setMsgBanco] = useState<{ ok: boolean; t: string } | null>(null)
  // Banner READ-ONLY: cambios operativos posteriores al archivo enviado a Visual.
  const [cambiosPost, setCambiosPost] = useState<any>(null)
  // Permanentes
  const [permanentes, setPermanentes] = useState<Permanente[]>([])
  const [pForm, setPForm] = useState({ empleado_id: '', concepto_id: '', importe: '', cantidad: '', vigencia_desde: new Date().toISOString().slice(0, 10), vigencia_hasta: '', motivo: '' })

  async function cargarPeriodos() {
    const { data } = await supabase.from('liquidacion_periodo').select('id, mes, estado, created_at, creado_por').order('mes', { ascending: false })
    const ps = (data as Periodo[]) ?? []
    setPeriodos(ps)
    // Flags por período (reimport/consolidada/resultado) para la lista.
    const [{ data: aj }, { data: cons }, { data: res }] = await Promise.all([
      supabase.from('liquidacion_ajuste').select('periodo_id'),
      supabase.from('liquidacion_consolidada').select('periodo_id'),
      supabase.from('liquidacion_resultado_visual').select('periodo_id'),
    ])
    const setDe = (rows: any[] | null) => new Set((rows ?? []).map(r => r.periodo_id))
    const sAj = setDe(aj), sCons = setDe(cons), sRes = setDe(res)
    const f: Record<string, PeriodoFlags> = {}
    for (const p of ps) f[p.id] = { reimport: sAj.has(p.id), consolidada: sCons.has(p.id), resultado: sRes.has(p.id) }
    setFlags(f)
    // Nombres de los creadores.
    const ids = Array.from(new Set(ps.map(p => p.creado_por).filter(Boolean))) as string[]
    if (ids.length) {
      const { data: us } = await supabase.from('usuarios').select('id, nombre, apellido').in('id', ids)
      const m: Record<string, string> = {}
      for (const u of (us ?? []) as any[]) m[u.id] = `${u.apellido ?? ''}, ${u.nombre ?? ''}`.replace(/^,\s*|,\s*$/g, '') || u.id
      setCreadores(m)
    }
  }

  // Eliminar (si vacío) o anular (si tiene historia) un período. Muestra el
  // contenido y pide confirmación fuerte antes de anular; nunca borra historia.
  async function eliminarPeriodo(p: Periodo) {
    setBorrando(p.id); setMsg(null)
    try {
      const { data: cont, error: e1 } = await supabase.rpc('contenido_periodo_liquidacion', { p_periodo_id: p.id })
      if (e1) { setMsg({ ok: false, t: 'No se pudo leer el contenido: ' + e1.message }); return }
      const c = cont as any
      const tieneHistoria = Boolean(c?.tiene_historia)
      const detalle = `Padrón ${c.padron} · conceptos ${c.conceptos} · días ${c.dias} · ajustes ${c.ajustes} · importaciones ${c.importaciones} · consolidada ${c.consolidada} · enviado ${c.enviado} · resultado ${c.resultado}`
      if (!tieneHistoria) {
        if (!window.confirm(`Eliminar definitivamente el período ${p.mes}?\n(${detalle})\nNo tiene historia relevante: se borra físicamente.`)) return
        const { data, error } = await supabase.rpc('eliminar_periodo_liquidacion', { p_periodo_id: p.id, p_forzar: false })
        if (error) { setMsg({ ok: false, t: 'No se pudo eliminar: ' + error.message }); return }
        setMsg({ ok: true, t: `Período ${p.mes} eliminado.` })
      } else {
        if (!window.confirm(`El período ${p.mes} TIENE datos:\n${detalle}\n\nNo se puede borrar la historia. ¿Anularlo (queda archivado, oculto por defecto)?`)) return
        const motivo = window.prompt('Motivo de la anulación (opcional):', 'período de prueba') || null
        const { data, error } = await supabase.rpc('eliminar_periodo_liquidacion', { p_periodo_id: p.id, p_forzar: true, p_motivo: motivo })
        if (error) { setMsg({ ok: false, t: 'No se pudo anular: ' + error.message }); return }
        setMsg({ ok: true, t: `Período ${p.mes} anulado (archivado). Activá "ver anulados" para verlo.` })
      }
      if (sel?.id === p.id) setSel(null)
      await cargarPeriodos()
    } catch (e: any) {
      setMsg({ ok: false, t: 'No se pudo: ' + (e?.message || e) })
    } finally { setBorrando(null) }
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
    setPreval(null)
    setCambiosPost(null)
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
    // Período ya enviado a Visual: chequear (read-only) si cambió lo operativo.
    if (p.estado === 'exportada' || p.estado === 'liquidada') {
      try {
        const { detectarCambiosPosteriores } = await import('@/lib/liquidacion-cambios')
        const d = await detectarCambiosPosteriores(supabase, { id: p.id, mes: p.mes })
        setCambiosPost(d.error ? null : d)
      } catch { setCambiosPost(null) }
    }
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
      // Editable = estado ACTUAL: se pasa periodoId para que aplique los
      // ajustes/reimportaciones ya cargados (no el estado previo a las correcciones).
      const r = await generarExcelTrabajoLiquidacion(supabase, sel.mes, { periodoId: sel.id })
      if (r.error || !r.buf) { setMsg({ ok: false, t: 'No se pudo generar el Excel de trabajo: ' + (r.error || 'sin datos') }); return }
      descargarArchivo(r.buf, `liquidacion_trabajo_${sel.mes}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      setMsg({ ok: true, t: `Excel de trabajo generado (${r.filas} empleados) con los ajustes actuales. Trae padrón, jornadas reales (000), horas, conceptos, permanentes, fórmulas, las celdas dinámicas Horas REC Vigiladores / Horas Extras Vigiladores / % REC / % Extras y los semáforos de % extras y costo por hora (mismas escalas del archivo original). Editalo (podés corregir el 000) y volvé a subirlo.` })
    } catch (e: any) {
      setMsg({ ok: false, t: 'No se pudo generar el Excel de trabajo: ' + (e?.message || e) })
    } finally { setGenExcel(false) }
  }

  const money = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // PAGOS (banco Galicia): sueldos = neto de Visual + sueldo mensual de excluidos;
  // extras = extra fija del mes. Formato Cuenta | Nombre | Importe (hoja Empleados).
  async function descargarBanco(tipo: 'sueldos' | 'extras') {
    if (!sel) return
    setGenBanco(tipo); setMsgBanco(null)
    try {
      const { filasSueldosBanco, filasExtrasBanco, escribirBancoXLSX } = await import('@/lib/pagos-banco')
      const r = tipo === 'sueldos' ? await filasSueldosBanco(supabase, sel.id) : await filasExtrasBanco(supabase, sel.id)
      if (r.error) { setMsgBanco({ ok: false, t: `No se pudo generar el archivo de ${tipo}: ${r.error}` }); return }
      if (r.rows.length === 0) { setMsgBanco({ ok: false, t: `No hay filas para ${tipo} (¿faltan cuentas o el resultado de Visual?).` }); return }
      const buf = await escribirBancoXLSX(r.rows)
      descargarArchivo(buf, `GALICIA ${tipo} ${sel.mes}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      setMsgBanco({ ok: true, t: `Archivo de ${tipo}: ${r.rows.length} persona(s), total $${money(r.total)}.` })
    } catch (e: any) {
      setMsgBanco({ ok: false, t: `No se pudo generar el archivo de ${tipo}: ${e?.message || e}` })
    } finally { setGenBanco('') }
  }

  // Excel completo del mes (con los cambios/ajustes ya cargados) — disponible en
  // cualquier estado (también después de exportar), para archivo/control.
  async function descargarExcelCompleto() {
    if (!sel) return
    setGenBanco('completo'); setMsgBanco(null)
    try {
      const { generarExcelCompletoConNeto } = await import('@/lib/excel-trabajo-liquidacion')
      const r = await generarExcelCompletoConNeto(supabase, { id: sel.id, mes: sel.mes })
      if (r.error || !r.buf) { setMsgBanco({ ok: false, t: 'No se pudo generar el Excel completo: ' + (r.error || 'sin datos') }); return }
      descargarArchivo(r.buf, `liquidacion_completa_${sel.mes}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      setMsgBanco({ ok: true, t: `Excel completo del mes generado (${r.filas} empleados) con tus cambios, los totales y la solapa NETO A PAGAR (${r.netos} persona(s) — lo que recibe cada uno).` })
    } catch (e: any) {
      setMsgBanco({ ok: false, t: 'No se pudo generar el Excel completo: ' + (e?.message || e) })
    } finally { setGenBanco('') }
  }

  // Libro GENERAL: un .xlsx con TODOS los meses, una solapa por período (último
  // adelante). Se arma en el momento desde lo guardado (no necesita archivos viejos).
  async function descargarLibroGeneral() {
    setGenBanco('general'); setMsgBanco(null)
    try {
      const { generarLibroGeneralTrabajo } = await import('@/lib/excel-trabajo-liquidacion')
      const r = await generarLibroGeneralTrabajo(supabase)
      if (r.error || !r.buf) { setMsgBanco({ ok: false, t: 'No se pudo generar el libro general: ' + (r.error || 'sin datos') }); return }
      descargarArchivo(r.buf, `liquidaciones_todos_los_meses.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      setMsgBanco({ ok: true, t: `Libro general generado: ${r.meses} mes(es), una solapa por mes (el último adelante).` })
    } catch (e: any) {
      setMsgBanco({ ok: false, t: 'No se pudo generar el libro general: ' + (e?.message || e) })
    } finally { setGenBanco('') }
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
  // ETAPA 1: prevalida con la MISMA regla que después bloquea la generación
  // Visual (construirLineasVisual sobre el snapshot en vivo). Devuelve el
  // resultado y lo deja en estado para la UI.
  async function prevalidar(): Promise<any> {
    if (!sel) return null
    setPrevalidando(true)
    try {
      const { prevalidarVisual } = await import('@/lib/visual-generar')
      const r = await prevalidarVisual(supabase, { id: sel.id, mes: sel.mes })
      setPreval(r)
      return r
    } catch (e: any) {
      const r = { listo: false, error: e?.message || String(e), criticos: [], identidadFaltante: [], diasRequerido: [], otros: [], advertencias: [], totalPersonas: 0, exportan: 0 }
      setPreval(r); return r
    } finally { setPrevalidando(false) }
  }

  // "Generar archivo Visual" = exportación ATÓMICA (reemplaza el paso manual de
  // Consolidar). UNA preparación → snapshot + líneas Visual; bytes EN MEMORIA (si
  // fallan, cero escrituras); prevalidación autoritativa (críticos/bloqueados
  // abortan); si OK, una sola RPC transaccional (consolidada + enviado +
  // exportada) y recién después se descarga el archivo ya generado.
  // En período ya exportado/liquidado: reconstruye el .xls DESDE lo enviado
  // (liquidacion_enviado_visual), sin releer operativo ni recalcular.
  async function generarVisual() {
    if (!sel) return
    setGenVisual(true); setMsg(null); setValidacion(null)
    try {
      if (sel.estado === 'exportada' || sel.estado === 'liquidada') {
        const { regenerarVisualDesdeEnviado } = await import('@/lib/visual-generar')
        const r = await regenerarVisualDesdeEnviado(supabase, sel.id)
        if (r.error || !r.bytes) { setMsg({ ok: false, t: 'No se pudo reconstruir desde lo enviado: ' + (r.error || 'sin datos') }); return }
        descargarArchivo(r.bytes as BlobPart, `visual_importacion_${sel.mes}.xls`, 'application/vnd.ms-excel')
        setMsg({ ok: true, t: `Archivo Visual reconstruido desde lo enviado (${r.lineas} líneas). No recalcula: son exactamente las líneas registradas como enviadas a Visual.` })
        return
      }

      const { exportarVisualCompleto } = await import('@/lib/visual-generar')
      const r = await exportarVisualCompleto(supabase, { id: sel.id, mes: sel.mes })
      if (r.resultado) setValidacion(r.resultado)

      // Prevalidación autoritativa: críticos o bloqueados abortan SIN escribir nada.
      if (r.bloqueado) {
        const b = r.resultado ? clasificarBloqueados(r.resultado.bloqueados) : { identidadFaltante: [], diasRequerido: [], otros: [] }
        const nCrit = r.resultado?.criticos.length ?? 0
        setMsg({ ok: false, t: `FALTAN DATOS: no se generó nada. Identidad Visual: ${b.identidadFaltante.length} · 000 requerido: ${b.diasRequerido.length}${b.otros.length ? ` · otros: ${b.otros.length}` : ''}${nCrit ? ` · críticos: ${nCrit}` : ''}. Resolvé los faltantes (detalle abajo) y reintentá.` })
        return
      }
      if (r.error || !r.bytes) { setMsg({ ok: false, t: 'No se pudo generar: ' + (r.error || 'sin datos') }); return }

      // Bytes ya generados: recién ahora se persiste, en una sola transacción.
      const { error } = await supabase.rpc('exportar_liquidacion_periodo', {
        p_periodo_id: sel.id, p_consolidada: r.consolidada, p_enviado: r.enviado,
      })
      if (error) { setMsg({ ok: false, t: `Archivo generado, pero la exportación atómica falló (no se guardó nada): ${error.message}` }); return }

      descargarArchivo(r.bytes as BlobPart, `visual_importacion_${sel.mes}.xls`, 'application/vnd.ms-excel')
      const nFilas = r.resultado?.lineas.length ?? 0
      const nAdv = r.resultado?.advertencias.length ?? 0
      setMsg({ ok: true, t: `Archivo Visual generado (${nFilas} líneas${nAdv ? `, ${nAdv} advertencia(s)` : ''}) y período EXPORTADA (consolidado + enviado registrados en un solo acto). Importalo y corré "Recalc. Todos" en Visual.` })
      await cargarPeriodos(); const upd = { ...sel, estado: 'exportada' }; setSel(upd); void abrirPeriodo(upd)
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>Períodos</strong>
              <label style={{ fontSize: 12, color: '#94a3b8', cursor: 'pointer' }}>
                <input type="checkbox" checked={verAnulados} onChange={e => setVerAnulados(e.target.checked)} style={{ marginRight: 6 }} />
                ver anulados
              </label>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
              <thead><tr>
                <th style={S.th}>Mes</th><th style={S.th}>Estado</th><th style={S.th}>Creado</th><th style={S.th}>Por</th>
                <th style={S.th}>Excel rev.</th><th style={S.th}>Consol.</th><th style={S.th}>Result. Visual</th><th style={S.th}></th>
              </tr></thead>
              <tbody>{periodos.filter(p => verAnulados || p.estado !== 'anulado').map(p => {
                const f = flags[p.id] || { reimport: false, consolidada: false, resultado: false }
                const anulado = p.estado === 'anulado'
                const si = (b: boolean) => b ? <span style={{ color: '#4ade80' }}>sí</span> : <span style={{ color: '#475569' }}>—</span>
                return (
                <tr key={p.id} style={{ opacity: anulado ? 0.5 : 1, background: sel?.id === p.id ? '#111a2e' : 'transparent' }}>
                  <td style={S.td}><b>{p.mes}</b>{sel?.id === p.id && !anulado && <span style={{ color: '#60a5fa', fontSize: 10, marginLeft: 6 }}>● vigente</span>}</td>
                  <td style={S.td}>{p.estado}</td>
                  <td style={S.td}>{p.created_at ? new Date(p.created_at).toLocaleDateString('es-AR') : '—'}</td>
                  <td style={S.td}>{p.creado_por ? (creadores[p.creado_por] || '—') : '—'}</td>
                  <td style={S.td}>{si(f.reimport)}</td><td style={S.td}>{si(f.consolidada)}</td><td style={S.td}>{si(f.resultado)}</td>
                  <td style={S.td}>
                    {!anulado && <button style={{ ...S.btn, background: '#334155', marginRight: 6 }} onClick={() => void abrirPeriodo(p)}>Ver</button>}
                    {!anulado && ESTADOS_SIG[p.estado] && <button style={{ ...S.btn, background: '#475569', marginRight: 6 }} onClick={() => void cambiarEstado(p)}>→ {ESTADOS_SIG[p.estado]}</button>}
                    {!anulado && <button style={{ ...S.btn, background: '#7f1d1d', opacity: borrando === p.id ? 0.6 : 1 }} disabled={borrando === p.id} onClick={() => void eliminarPeriodo(p)}>{borrando === p.id ? '…' : 'Eliminar'}</button>}
                  </td>
                </tr>)})}
                {periodos.filter(p => verAnulados || p.estado !== 'anulado').length === 0 && <tr><td style={S.td} colSpan={8}>Sin períodos.</td></tr>}
              </tbody>
            </table>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
              Vacío/de prueba → se elimina físicamente. Con historia (ajustes, importaciones, consolidación, envío o resultado) → se anula (queda archivado, oculto por defecto), nunca se borra.
            </div>
          </div>
          {sel && (
            <div style={S.card}>
              <strong>Circuito de liquidación · Período {sel.mes} · <span style={{ color: '#60a5fa' }}>{sel.estado}</span></strong>
              <div style={{ fontSize: 13, marginTop: 6 }}>Padrón: <b>{padronN}</b> empleados · Conceptos cargados: <b>{conceptosP.length}</b> {conceptosP.length === 0 && <span style={{ color: '#64748b' }}>(nace vacío)</span>}</div>
              {conceptosP.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
                  <thead><tr><th style={S.th}>Empleado</th><th style={S.th}>Concepto</th><th style={S.th}>Cant</th><th style={S.th}>Importe</th><th style={S.th}>Origen</th></tr></thead>
                  <tbody>{conceptosP.slice(0, 100).map(c => (
                    <tr key={c.id}><td style={S.td}>{c.empleado_id ? nombreEmp(c.empleado_id) : '(general)'}</td><td style={S.td}>{nombreConcepto(c.concepto_id)}</td><td style={S.td}>{c.cantidad ?? '—'}</td><td style={S.td}>{c.importe ?? '—'}</td><td style={S.td}>{c.origen}</td></tr>
                  ))}</tbody>
                </table>
              )}

              {/* ═══ PASO 1 · DESCARGAR EXCEL DE TRABAJO (con 000 ya calculado) ═══ */}
              <PasoHeader n={1} titulo="Descargar Excel de trabajo" sub="Ya trae padrón, 000 real, horas, conceptos, permanentes y fórmulas" activo={ANTES_VISUAL(sel.estado)} />
              {ANTES_VISUAL(sel.estado) ? (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button style={{ ...S.btn, opacity: genExcel ? 0.6 : 1 }} disabled={genExcel} onClick={() => void descargarExcelTrabajo()}>
                    {genExcel ? 'Generando…' : 'Descargar Excel de trabajo'}
                  </button>
                  <span style={{ color: '#64748b', fontSize: 12, flex: '1 1 240px' }}>
                    <b>Excel de trabajo editable.</b> Descargalo las veces que necesites: sale siempre del <b>estado actual</b> (datos operativos + ajustes/reimportaciones ya cargados). El <b>000</b> viene calculado desde la planilla real. Corregí lo que haga falta y subilo en el paso 2.
                  </span>
                </div>
              ) : <div style={{ color: '#64748b', fontSize: 12 }}>El período ya fue enviado a Visual. Podés volver a descargar el <b>archivo Visual enviado</b> (paso 4).</div>}
              {/* Indicadores recuperados del Excel original (auditado). El gráfico
                  de torta se eliminó en #205: quedan sólo las celdas dinámicas. */}
              <div style={{ marginTop: 8, padding: 10, background: '#0f1a2e', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 12, color: '#93c5fd' }}>
                Incluye, reproducidos del Excel original: las celdas dinámicas <b>Horas REC Vigiladores / Horas Extras Vigiladores / % REC / % Extras</b> (sólo vigilancia, debajo del total), el <b>semáforo de % extras</b> (formato condicional rojo→amarillo→verde en la columna «% ex») y la <b>barra de costo por hora</b> («po hs»), con los mismos límites y colores del archivo original.
              </div>

              {/* ═══ PASO 2 · SUBIR EXCEL REVISADO → preview de diferencias → confirmar ═══ */}
              <PasoHeader n={2} titulo="Subir Excel revisado" sub="Preview de diferencias y confirmación (incluye el 000 corregido)" activo={ANTES_VISUAL(sel.estado)} />
              {ANTES_VISUAL(sel.estado) ? (
                <ReimportarExcelTrabajo periodo={sel} onDone={() => { void abrirPeriodo(sel) }} />
              ) : <div style={{ color: '#64748b', fontSize: 12 }}>El período ya fue enviado a Visual: no se reimporta.</div>}

              {/* ═══ PASO 3 · PREVALIDAR (preview) ═══ */}
              <PasoHeader n={3} titulo="Prevalidar" sub="Preview: LISTO / FALTAN DATOS antes de generar el archivo Visual" activo={ANTES_VISUAL(sel.estado)} />
              <div>
                {ANTES_VISUAL(sel.estado) ? (
                  <>
                    {/* Preview: misma regla que después bloquea la generación Visual. */}
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                      <button style={{ ...S.btn, background: '#334155', opacity: prevalidando ? 0.6 : 1 }} disabled={prevalidando} onClick={() => void prevalidar()}>
                        {prevalidando ? 'Prevalidando…' : 'Prevalidar'}
                      </button>
                      <span style={{ color: '#64748b', fontSize: 12, flex: '1 1 200px' }}>Preview de lo que falta. Al <b>Generar archivo Visual</b> se vuelve a validar de forma autoritativa: si falta algo, no se genera ni se guarda nada.</span>
                    </div>
                    {preval && !preval.error && (
                      preval.listo ? (
                        <div style={{ padding: 8, background: '#0e2a16', border: '1px solid #14532d', borderRadius: 6, marginBottom: 6, color: '#4ade80', fontWeight: 700 }}>
                          ✓ LISTO — {preval.exportan} de {preval.totalPersonas} personas exportan; sin faltantes.
                        </div>
                      ) : (
                        <div style={{ padding: 8, background: '#2a1206', border: '1px solid #7c5510', borderRadius: 6, marginBottom: 6, fontSize: 12 }}>
                          <b style={{ color: '#fbbf24' }}>FALTAN DATOS — todavía no se puede generar el archivo Visual.</b>
                          {preval.criticos.length > 0 && (<div style={{ marginTop: 4 }}><b style={{ color: '#f87171' }}>Críticos ({preval.criticos.length}):</b>{preval.criticos.slice(0, 8).map((c: any, i: number) => <div key={i} style={{ color: '#fca5a5' }}>• {c.detalle}</div>)}</div>)}
                          {preval.identidadFaltante.length > 0 && (<div style={{ marginTop: 4 }}><b style={{ color: '#fbbf24' }}>Identidad Visual faltante ({preval.identidadFaltante.length}) — sin COD_INTERNO / CUIL:</b>{preval.identidadFaltante.slice(0, 10).map((c: any, i: number) => <div key={i} style={{ color: '#fcd34d' }}>• {c.detalle}</div>)}{preval.identidadFaltante.length > 10 && <div style={{ color: '#64748b' }}>… y {preval.identidadFaltante.length - 10} más</div>}</div>)}
                          {preval.diasRequerido.length > 0 && (<div style={{ marginTop: 4 }}><b style={{ color: '#fbbf24' }}>000 requerido ({preval.diasRequerido.length}) — cargar el valor (manual si es mensualizado):</b>{preval.diasRequerido.slice(0, 10).map((c: any, i: number) => <div key={i} style={{ color: '#fcd34d' }}>• {c.detalle}</div>)}{preval.diasRequerido.length > 10 && <div style={{ color: '#64748b' }}>… y {preval.diasRequerido.length - 10} más</div>}</div>)}
                          {preval.otros.length > 0 && (<div style={{ marginTop: 4 }}><b style={{ color: '#fbbf24' }}>Otros pendientes ({preval.otros.length}):</b>{preval.otros.slice(0, 8).map((c: any, i: number) => <div key={i} style={{ color: '#fcd34d' }}>• {c.detalle}</div>)}</div>)}
                        </div>
                      )
                    )}
                    {preval?.error && <div style={{ ...S.err, marginBottom: 6 }}>No se pudo prevalidar: {preval.error}</div>}
                  </>
                ) : <div style={{ color: '#64748b', fontSize: 12 }}>Período {sel.estado}: ya prevalidado y enviado a Visual.</div>}
              </div>

              {/* ═══ PASO 4 · GENERAR ARCHIVO PARA VISUAL (consolida internamente) ═══ */}
              <PasoHeader n={4} titulo="Generar archivo para Visual" sub="Congela + registra + exporta en un solo acto; Visual calcula el recibo" activo={true} />
              <div>
                {/* Banner READ-ONLY: cambios operativos posteriores al envío a Visual. */}
                {(sel.estado === 'exportada' || sel.estado === 'liquidada') && cambiosPost?.hayCambios && (
                  <div style={{ padding: 10, background: '#2a1206', border: '1px solid #b45309', borderRadius: 8, marginBottom: 10, fontSize: 12 }}>
                    <b style={{ color: '#fbbf24' }}>⚠ HAY CAMBIOS OPERATIVOS POSTERIORES AL ARCHIVO ENVIADO A VISUAL</b>
                    <div style={{ color: '#fcd34d', marginTop: 4 }}>
                      {cambiosPost.cantidad} diferencia(s) en {cambiosPost.personas} persona(s). Sólo aviso: NO se reabre ni se regenera; la re-descarga sigue saliendo de lo enviado.
                    </div>
                    {cambiosPost.detalle?.slice(0, 8).map((d: any, i: number) => (
                      <div key={i} style={{ color: '#fcd34d' }}>• CUIL {d.cuil} · cód {d.codigo} · {d.tipo}{d.campo ? ` (${d.campo}: ${d.antes ?? '—'} → ${d.ahora ?? '—'})` : ''}</div>
                    ))}
                    {cambiosPost.detalle?.length > 8 && <div style={{ color: '#64748b' }}>… y {cambiosPost.detalle.length - 8} más</div>}
                  </div>
                )}
                {ANTES_VISUAL(sel.estado) ? (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button style={{ ...S.btn, background: '#059669', opacity: genVisual ? 0.6 : 1 }} disabled={genVisual} onClick={() => void generarVisual()}>
                      {genVisual ? 'Generando…' : 'Generar archivo Visual Sueldos'}
                    </button>
                    <span style={{ color: '#64748b', fontSize: 12, flex: '1 1 100%' }}>
                      Prevalida, congela la versión (consolidada + enviado) y marca EXPORTADA <b>en un solo acto atómico</b>, desde una única preparación de datos. El 000 sale de la planilla real (con tus correcciones). {consolidadaN > 0 && <span>Este período ya tenía {consolidadaN} filas consolidadas (legacy); se reemplazan al generar.</span>}
                    </span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button style={{ ...S.btn, background: '#059669', opacity: genVisual ? 0.6 : 1 }} disabled={genVisual} onClick={() => void generarVisual()}>
                      {genVisual ? 'Generando…' : 'Regenerar / Descargar archivo Visual'}
                    </button>
                    <span style={{ color: '#64748b', fontSize: 12 }}>Período {sel.estado}. Se reconstruye <b>exactamente desde lo enviado</b> (no recalcula ni relee datos operativos).</span>
                  </div>
                )}

                {/* Validación pre-export. Críticos bloquean; advertencias visibles. */}
                {validacion && (
                  <div style={{ marginTop: 12, fontSize: 12 }}>
                    {(() => { const p = validacion.padron || []
                      const exporta = p.filter((x: any) => x.estado === 'exporta').length
                      const noCorr = p.filter((x: any) => x.estado === 'no_corresponde').length
                      const falta = p.filter((x: any) => x.estado === 'falta_info').length
                      return <div style={{ color: '#94a3b8', marginBottom: 6 }}>Padrón: <b style={{ color: '#4ade80' }}>{exporta} exportan</b> · {noCorr} no corresponde · <b style={{ color: falta ? '#f87171' : '#64748b' }}>{falta} pendientes (ver detalle abajo)</b></div>
                    })()}
                    {validacion.criticos?.length > 0 && (
                      <div style={{ padding: 8, background: '#2a0f0f', border: '1px solid #7f1d1d', borderRadius: 6, marginBottom: 6 }}>
                        <b style={{ color: '#f87171' }}>Errores críticos ({validacion.criticos.length}) — impiden exportar:</b>
                        {validacion.criticos.slice(0, 12).map((c: any, i: number) => <div key={i} style={{ color: '#fca5a5' }}>• {c.detalle}</div>)}
                        {validacion.criticos.length > 12 && <div style={{ color: '#64748b' }}>… y {validacion.criticos.length - 12} más</div>}
                      </div>
                    )}
                    {validacion.bloqueados?.length > 0 && (() => {
                      // Causas separadas (no mezclar): identidad Visual faltante ≠ 000 requerido.
                      const bl = clasificarBloqueados(validacion.bloqueados)
                      const bloque = (titulo: string, items: any[]) => items.length > 0 && (
                        <div style={{ padding: 8, background: '#1a1206', border: '1px solid #7c5510', borderRadius: 6, marginBottom: 6 }}>
                          <b style={{ color: '#fbbf24' }}>{titulo} ({items.length}):</b>
                          {items.slice(0, 10).map((c: any, i: number) => <div key={i} style={{ color: '#fcd34d' }}>• {c.detalle}</div>)}
                          {items.length > 10 && <div style={{ color: '#64748b' }}>… y {items.length - 10} más</div>}
                        </div>
                      )
                      return <>
                        {bloque('Identidad Visual faltante (sin COD_INTERNO / CUIL inválido)', bl.identidadFaltante)}
                        {bloque('000 DÍAS requerido (cargar el valor; manual si es mensualizado)', bl.diasRequerido)}
                        {bloque('Otros pendientes', bl.otros)}
                      </>
                    })()}
                    {validacion.advertencias?.length > 0 && (
                      <div style={{ padding: 8, background: '#0f1a2e', border: '1px solid #1e3a5f', borderRadius: 6 }}>
                        <b style={{ color: '#60a5fa' }}>Advertencias ({validacion.advertencias.length}):</b>
                        {validacion.advertencias.slice(0, 8).map((c: any, i: number) => <div key={i} style={{ color: '#93c5fd' }}>• {c.detalle}</div>)}
                        {validacion.advertencias.length > 8 && <div style={{ color: '#64748b' }}>… y {validacion.advertencias.length - 8} más</div>}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ═══ PASO 5 · RESULTADO DE VISUAL — importar + conciliación ═══ */}
              <PasoHeader n={5} titulo="Resultado de Visual" sub="Importar la planilla final y conciliar contra lo enviado" activo={sel.estado === 'exportada' || sel.estado === 'liquidada'} />
              <ImportarResultadoVisual periodo={sel} />

              {/* ═══ PASO 6 · PAGOS (banco Galicia) — descargas ═══ */}
              <PasoHeader n={6} titulo="Pagos — archivos para el banco" sub="Sueldos (neto) y extras a acreditar (formato Galicia: Cuenta | Nombre | Importe)" activo={sel.estado === 'exportada' || sel.estado === 'liquidada'} />
              <div style={{ ...S.card, marginTop: 8 }}>
                <div style={{ color: '#64748b', fontSize: 12, marginBottom: 10 }}>
                  <b>Sueldos</b> = neto que devolvió Visual por persona + el sueldo mensual de los de nómina que no pasan por Visual (todos con cuenta). <b>Extras</b> = la extra fija del mes por persona con cuenta. El <b>Excel completo</b> trae tus cambios y los totales. El <b>libro general</b> junta todos los meses, una solapa por mes (el último adelante).
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={{ ...S.btn, opacity: genBanco ? 0.6 : 1 }} disabled={!!genBanco} onClick={() => void descargarBanco('sueldos')}>
                    {genBanco === 'sueldos' ? 'Generando…' : '📄 Descargar Galicia — Sueldos'}
                  </button>
                  <button style={{ ...S.btn, opacity: genBanco ? 0.6 : 1 }} disabled={!!genBanco} onClick={() => void descargarBanco('extras')}>
                    {genBanco === 'extras' ? 'Generando…' : '📄 Descargar Galicia — Extras'}
                  </button>
                  <button style={{ ...S.btn, background: '#334155', opacity: genBanco ? 0.6 : 1 }} disabled={!!genBanco} onClick={() => void descargarExcelCompleto()}>
                    {genBanco === 'completo' ? 'Generando…' : '📊 Descargar Excel completo (con totales)'}
                  </button>
                  <button style={{ ...S.btn, background: '#334155', opacity: genBanco ? 0.6 : 1 }} disabled={!!genBanco} onClick={() => void descargarLibroGeneral()}>
                    {genBanco === 'general' ? 'Generando…' : '📚 Descargar libro general (todos los meses)'}
                  </button>
                </div>
                {msgBanco && <div style={{ color: msgBanco.ok ? '#4ade80' : '#f87171', fontSize: 13, marginTop: 10 }}>{msgBanco.t}</div>}
              </div>

              {/* ─── Herramientas de revisión (auxiliares): OCULTAS (JC) hasta tener
                   el editable real por empleado. Código, datos y RPCs intactos. ─── */}
              {MOSTRAR_HERRAMIENTAS_REVISION && (
              <div style={{ marginTop: 22, paddingTop: 12, borderTop: '2px solid #1e293b' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>Herramientas de revisión (auxiliares)</div>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
                  Auditoría del 000, expedientes, novedades y comparación. No hace falta cargar nada acá para el flujo principal: el 000 ya viaja en el Excel y en la generación a Visual.
                </div>
                {/* Padrón — 000 (auditoría/override) + expedientes 111/993. */}
                <PadronLiquidacion periodo={sel} />
                {/* Novedades laborales del mes: control (referencia). */}
                <div style={{ marginTop: 12, fontSize: 13 }}>
                  <b>Novedades del mes (aprobadas):</b> {novedadesMes.length}
                  {novedadesMes.length > 0 && <span style={{ color: '#64748b' }}> — control para cruzar contra los conceptos cargados.</span>}
                </div>
                {/* Comparación con el período anterior (control de omisiones, no copia). */}
                <div style={{ marginTop: 12 }}>
                  <button style={{ ...S.btn, background: '#334155' }} onClick={() => void comparar()}>Comparar con período anterior</button>
                  {comparacion && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>
                        El mes anterior es sólo control de omisiones: <b>desaparecido</b> = estaba antes y ahora no. Nunca se copia automáticamente.
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
              </div>
              )}

              {/* ─── Próximas fases (pendientes, NO implementadas todavía) ─── */}
              <div style={{ marginTop: 18, padding: 10, background: '#0f1a2e', border: '1px dashed #1e3a5f', borderRadius: 8, fontSize: 12, color: '#93c5fd' }}>
                <b>Próximas fases (pendientes, aún no implementadas):</b> Libro de Sueldos Digital, ARCA/AFIP y Facturación. (Los archivos de acreditación Galicia — sueldos y extras — ya se generan en el paso 6.)
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
