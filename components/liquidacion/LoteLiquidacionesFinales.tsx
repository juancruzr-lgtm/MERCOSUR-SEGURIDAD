'use client'
// Liquidaciones finales EN LOTE (pedido de JC 20/10):
//   1. Bajar el Excel de trabajo con todas las finales, con el FORMATO DEL EXCEL DE
//      TRABAJO MENSUAL (una fila por persona) y al final las columnas de la
//      liquidación (JC 21/10). Se sigue aceptando el de una hoja por persona.
//   2. Completar lo que falte y volver a subirlo: la app muestra SÓLO lo que cambió
//      y lo aplica cuando se confirma (motivo obligatorio, control de versión).
//   3. Aprobar las que quedaron sin pendientes.
//   4. EXPORTAR LIQUIDACIONES FINALES: un único .xls de Visual con las personas elegidas.
//   5. Reimportar la Planilla de Sueldos de Visual para todo el lote.
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  analizarExcelLote, analizarExcelLoteMensual, aplicarDiferenciasLote, aprobarSinPendientes, excelDeLoteMensual, exportarLote, importarResultadoLote,
  type FinalFila,
} from '@/lib/liquidacion-final-datos'

const S: Record<string, React.CSSProperties> = {
  card: { background: '#0f1629', border: '1px solid #1e293b', borderRadius: 10, padding: 16, marginBottom: 16 },
  btn: { padding: '8px 14px', background: '#2563eb', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btn2: { padding: '8px 14px', background: 'transparent', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  sub: { color: '#64748b', fontSize: 12 }, err: { color: '#f87171', fontSize: 13 }, ok: { color: '#4ade80', fontSize: 13 },
  td: { fontSize: 13, padding: '6px 8px', borderBottom: '1px solid #131c2e', verticalAlign: 'top' },
  th: { textAlign: 'left', fontSize: 11, color: '#64748b', padding: '6px 8px', borderBottom: '1px solid #1e293b' },
}
const ESTADO_TXT: Record<string, string> = { pendiente_calculo: 'pendiente', borrador: 'borrador', lista: 'aprobada', exportada: 'exportada', conciliada: 'conciliada' }

function descargar(bytes: BlobPart, nombre: string, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
  const a = document.createElement('a'); a.href = url; a.download = nombre
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}

export default function LoteLiquidacionesFinales({ finales, onCambio }: { finales: FinalFila[]; onCambio: () => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [ocupado, setOcupado] = useState('')
  const [difs, setDifs] = useState<{ finalId: string; version: number; persona?: string | null; hoja: string; cambios: string[]; errores: string[]; entradas: any; noTomados?: string[]; legajoVisual?: { usuarioId: string; valor: string } | null }[] | null>(null)
  const [avisosExcel, setAvisosExcel] = useState<string[]>([])
  const [eligiendo, setEligiendo] = useState(false)
  const [elegidas, setElegidas] = useState<Set<string>>(new Set())

  const editables = useMemo(() => finales.filter(f => ['pendiente_calculo', 'borrador', 'lista'].includes(f.estado) && f.calculo), [finales])
  const exportables = useMemo(() => finales.filter(f => ['lista', 'exportada'].includes(f.estado)), [finales])
  const aprobables = finales.filter(f => f.estado === 'borrador' && !f.requiere_recalculo && !(f.faltantes?.length))

  async function correr(etq: string, fn: () => Promise<string | null>, ok: string | (() => string)) {
    setOcupado(etq); setMsg(null)
    try { const e = await fn(); setMsg(e ? { ok: false, t: e } : { ok: true, t: typeof ok === 'function' ? ok() : ok }) }
    catch (e: any) { setMsg({ ok: false, t: e?.message ?? String(e) }) }
    setOcupado('')
  }

  let resumenExcel = ''
  const bajarExcel = () => correr('excel', async () => {
    const r = await excelDeLoteMensual(supabase, editables)
    if (r.error || !r.buf) return r.error ?? 'sin archivo'
    descargar(r.buf, r.nombre, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    resumenExcel = `Excel de trabajo descargado: ${editables.length - r.omitidas.length} persona(s) con el formato del Excel mensual y, al final, las columnas de la liquidación. Editá lo que quieras y volvé a subirlo: la app toma los cambios y los refleja en el archivo de Visual.`
      + (r.omitidas.length ? ` Sin calcular o sin fecha de baja (no van): ${r.omitidas.join(', ')}.` : '')
    return null
  }, () => resumenExcel)

  const subirExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    void correr('leer', async () => {
      const buf = await file.arrayBuffer()
      const m = await analizarExcelLoteMensual(supabase, buf)
      if (m.error) return m.error
      if (m.formato === 'mensual') { setDifs(m.diferencias); setAvisosExcel(m.avisos); return null }
      const r = await analizarExcelLote(supabase, buf)
      if (r.error) return r.error
      setDifs(r.diferencias); setAvisosExcel([]); return null
    }, 'Archivo leído: revisá los cambios antes de aplicarlos.')
  }

  let resumenAplicado = ''
  const aplicar = () => correr('aplicar', async () => {
    if (!difs) return null
    const res = await aplicarDiferenciasLote(supabase, difs)
    const mal = res.filter(r => !r.ok)
    resumenAplicado = `Aplicado a ${res.length - mal.length} persona(s); los borradores se recalcularon.`
    setDifs(null); setAvisosExcel([]); onCambio()
    return mal.length ? `${resumenAplicado} No se pudo en ${mal.length}: ${mal.map(m => m.error).join(' · ')}` : null
  }, () => resumenAplicado)

  let resumenAprobado = ''
  const aprobar = () => correr('aprobar', async () => {
    const res = await aprobarSinPendientes(supabase, finales)
    const mal = res.filter(r => !r.ok)
    resumenAprobado = `${res.length - mal.length} liquidación(es) aprobada(s) para exportar.`
    onCambio()
    return mal.length ? `${resumenAprobado} Errores: ${mal.map(m => m.error).join(' · ')}` : null
  }, () => resumenAprobado)

  let resumenExport = ''
  const exportar = () => correr('exportar', async () => {
    const elegidasF = exportables.filter(f => elegidas.has(f.id))
    if (!elegidasF.length) return 'Elegí al menos una persona.'
    const r = await exportarLote(supabase, elegidasF)
    setEligiendo(false); onCambio()
    if (r.bytes) descargar(r.bytes as BlobPart, r.nombre, 'application/vnd.ms-excel')
    resumenExport = `Archivo de Visual con ${r.incluidas.length} persona(s): ${r.incluidas.join(', ')}.`
    if (r.rechazadas.length) return `${r.bytes ? resumenExport + ' ' : ''}No entraron: ${r.rechazadas.map(x => `${x.persona} (${x.error})`).join(' · ')}`
    return null
  }, () => resumenExport)

  let resumenResultado = ''
  const importarVisual = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    void correr('visual', async () => {
      const r = await importarResultadoLote(supabase, finales, file.name, await file.arrayBuffer())
      onCambio()
      if (!r.length) return 'El archivo no trae a ninguna de las personas exportadas.'
      resumenResultado = r.map(x => `${x.persona}: ${x.detalle}`).join(' · ')
      return r.some(x => !x.ok) ? resumenResultado : null
    }, () => `Resultado importado. ${resumenResultado}. Conciliá cada una desde su detalle.`)
  }

  const cambiosAplicables = (difs ?? []).filter(d => d.entradas || d.legajoVisual).length

  return (
    <div style={S.card}>
      <strong>Todas las liquidaciones finales</strong>
      <div style={{ ...S.sub, marginTop: 4 }}>
        Bajá el Excel de trabajo (mismo formato que el mensual: una fila por persona y, al final, las columnas de la liquidación), editá lo que quieras, volvelo a subir y exportá un solo archivo de Visual con los empleados de baja.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
        <button style={S.btn2} disabled={!!ocupado || !editables.length} onClick={() => void bajarExcel()}>{ocupado === 'excel' ? 'Armando…' : `Bajar Excel de trabajo (${editables.length})`}</button>
        <label style={{ ...S.btn2, display: 'inline-block' }}>
          {ocupado === 'leer' ? 'Leyendo…' : 'Subir Excel de trabajo'}
          <input type="file" accept=".xlsx" style={{ display: 'none' }} disabled={!!ocupado} onChange={subirExcel} />
        </label>
        <button style={S.btn2} disabled={!!ocupado || !aprobables.length} onClick={() => void aprobar()}>Aprobar sin pendientes ({aprobables.length})</button>
        <button style={{ ...S.btn, background: '#16a34a' }} disabled={!!ocupado || !exportables.length}
          onClick={() => { setElegidas(new Set(exportables.filter(f => f.estado === 'lista').map(f => f.id))); setEligiendo(true) }}>
          EXPORTAR LIQUIDACIONES FINALES
        </button>
        <label style={{ ...S.btn2, display: 'inline-block' }}>
          {ocupado === 'visual' ? 'Importando…' : 'Importar resultado de Visual'}
          <input type="file" accept=".xls,.xlsx" style={{ display: 'none' }} disabled={!!ocupado} onChange={importarVisual} />
        </label>
      </div>
      {msg && <div style={{ ...(msg.ok ? S.ok : S.err), marginTop: 8 }}>{msg.t}</div>}

      {difs && (
        <div style={{ marginTop: 12 }}>
          <strong>Cambios leídos del Excel</strong>
          {avisosExcel.map((a, i) => <div key={i} style={{ color: '#fbbf24', fontSize: 12.5, marginTop: 4 }}>{a}</div>)}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
            <thead><tr><th style={S.th}>Persona / hoja</th><th style={S.th}>Cambios</th><th style={S.th}>Avisos</th></tr></thead>
            <tbody>{difs.map(d => (
              <tr key={d.finalId}>
                <td style={S.td}>{d.persona ?? d.hoja}</td>
                <td style={S.td}>{d.cambios.length ? d.cambios.join(' · ') : <span style={S.sub}>sin cambios</span>}</td>
                <td style={S.td}>
                  {d.errores.length > 0 && <div style={{ color: '#f87171' }}>{d.errores.join(' · ')}</div>}
                  {(d.noTomados ?? []).length > 0 && <div style={{ color: '#fbbf24' }}>No se toma: {d.noTomados!.join(' · ')}</div>}
                </td>
              </tr>
            ))}</tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button style={S.btn} disabled={!!ocupado || !cambiosAplicables} onClick={() => void aplicar()}>Aplicar cambios ({cambiosAplicables})</button>
            <button style={S.btn2} onClick={() => { setDifs(null); setAvisosExcel([]) }}>Descartar</button>
          </div>
          <div style={{ ...S.sub, marginTop: 4 }}>Sólo no se aplica una fila si el borrador cambió después de bajar el Excel (en rojo): bajalo de nuevo.</div>
        </div>
      )}

      {eligiendo && (
        <div style={{ marginTop: 12, padding: 10, border: '1px solid #166534', borderRadius: 8 }}>
          <strong>¿Quiénes van en el archivo de Visual?</strong>
          <div style={{ ...S.sub, marginTop: 2 }}>Sólo aprobadas, o ya exportadas para volver a bajar el archivo. Exportar las registra como enviadas: después no se recalculan.</div>
          {exportables.map(f => (
            <label key={f.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginTop: 6 }}>
              <input type="checkbox" checked={elegidas.has(f.id)} onChange={e => {
                const n = new Set(elegidas); if (e.target.checked) n.add(f.id); else n.delete(f.id); setElegidas(n)
              }} />
              {f.baja.nombre} · baja {f.baja.fecha_baja ? f.baja.fecha_baja.split('-').reverse().join('/') : '—'} · {ESTADO_TXT[f.estado] ?? f.estado} · total {f.calculo ? Number(f.calculo.total).toLocaleString('es-AR', { minimumFractionDigits: 2 }) : '—'}
            </label>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button style={{ ...S.btn, background: '#16a34a' }} disabled={!!ocupado || !elegidas.size} onClick={() => void exportar()}>{ocupado === 'exportar' ? 'Exportando…' : `Generar archivo de Visual (${elegidas.size})`}</button>
            <button style={S.btn2} onClick={() => setEligiendo(false)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
