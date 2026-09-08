'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { compararReimport, type FilaDiff, type CeldaVisual } from '@/lib/excel-trabajo-reimport'

type Periodo = { id: string; mes: string; estado: string }

const S: Record<string, React.CSSProperties> = {
  card: { background: '#0f1629', border: '1px solid #1e293b', borderRadius: 10, padding: 16, marginTop: 12 },
  btn: { padding: '8px 14px', background: '#2563eb', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  th: { textAlign: 'left', fontSize: 11, color: '#64748b', padding: '5px 7px', borderBottom: '1px solid #1e293b', position: 'sticky', top: 0, background: '#0f1629' },
  td: { fontSize: 12, padding: '5px 7px', borderBottom: '1px solid #131c2e' },
  input: { padding: '6px 9px', background: '#0a0e1a', border: '1px solid #334155', borderRadius: 5, color: '#e2e8f0', fontSize: 13 },
}
const fmt = (v: number | null) => v === null ? '—' : (Math.round(v * 100) / 100).toString()

async function sha256(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export default function ReimportarExcelTrabajo({ periodo, onDone }: { periodo: Periodo; onDone: () => void }) {
  const [archivo, setArchivo] = useState('')
  const [hash, setHash] = useState('')
  const [diffs, setDiffs] = useState<FilaDiff[]>([])
  const [incorporar, setIncorporar] = useState<Record<number, boolean>>({})
  const [fuera, setFuera] = useState<string[]>([])
  const [motivo, setMotivo] = useState('')
  const [parsing, setParsing] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    setParsing(true); setMsg(null); setDiffs([]); setFuera([])
    try {
      const buf = await f.arrayBuffer()
      const h = await sha256(buf)
      // Baseline: la MISMA plantilla que generó LIQ2A para el mes del período.
      const { plantillaTrabajoDelMes } = await import('@/lib/excel-trabajo-liquidacion')
      const base = await plantillaTrabajoDelMes(supabase, periodo.mes)
      if (base.error || !base.plantilla) { setMsg({ ok: false, t: 'No se pudo armar el baseline de MERCOSUR: ' + (base.error || 'sin datos') }); return }
      // Grilla del archivo subido (valores efectivos, resolviendo fórmulas).
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf)
      const ws = wb.worksheets[0]
      const grid: CeldaVisual[][] = []
      ws.eachRow({ includeEmpty: true }, (row) => {
        const cells: CeldaVisual[] = []
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          let v: any = cell.value
          if (v && typeof v === 'object' && 'result' in v) v = v.result
          if (v && typeof v === 'object' && 'richText' in v) v = v.richText.map((t: any) => t.text).join('')
          cells[col - 1] = v ?? null
        })
        grid.push(cells)
      })
      const r = compararReimport(base.plantilla, grid)
      if (r.periodoDelArchivo && r.periodoDelArchivo !== periodo.mes) {
        setMsg({ ok: false, t: `El archivo es del período ${r.periodoDelArchivo}, no de ${periodo.mes}. Verificá que subís el Excel correcto.` }); return
      }
      setArchivo(f.name); setHash(h); setDiffs(r.diffs); setFuera(r.fueraDePadron)
      setIncorporar(Object.fromEntries(r.diffs.map((_, i) => [i, true])))
      setMsg({ ok: true, t: `${r.diffs.length} ajuste(s) detectado(s)${r.fueraDePadron.length ? ` · ${r.fueraDePadron.length} empleado(s) fuera del padrón (ignorados)` : ''}. Revisá y confirmá.` })
    } catch (err: any) {
      setMsg({ ok: false, t: 'No se pudo leer el archivo: ' + (err?.message || err) })
    } finally { setParsing(false); e.target.value = '' }
  }

  async function confirmar() {
    setConfirmando(true); setMsg(null)
    const ajustes = diffs.filter((_, i) => incorporar[i]).map(d => ({
      empleado_id: d.usuarioId, tipo: 'variable', clave: d.clave, etiqueta: d.etiqueta,
      valor_operativo: d.mercosur, valor_liquidacion: d.excel, motivo: motivo || null,
    }))
    if (ajustes.length === 0) { setMsg({ ok: false, t: 'No hay ajustes seleccionados para incorporar.' }); setConfirmando(false); return }
    const { data, error } = await supabase.rpc('aplicar_ajustes_liquidacion', {
      p_periodo_id: periodo.id, p_archivo: archivo, p_hash: hash, p_motivo: motivo || `Reimport ${archivo}`, p_ajustes: ajustes,
    })
    setConfirmando(false)
    if (error) { setMsg({ ok: false, t: 'No se pudo aplicar: ' + error.message }); return }
    const r = data as any
    setMsg({ ok: true, t: `Ajustes aplicados: ${r.altas} altas · ${r.cambios} cambios · ${r.errores} errores (lote ${String(r.lote).slice(0, 8)}).` })
    setDiffs([]); onDone()
  }

  const seleccionados = diffs.filter((_, i) => incorporar[i]).length

  return (
    <div style={S.card}>
      <strong>Subir Excel de trabajo revisado (PASO 3)</strong>
      <div style={{ color: '#64748b', fontSize: 12, margin: '4px 0 10px' }}>
        MERCOSUR compara tu archivo contra lo que calculó (baseline). Se muestran las diferencias por variable; recién al confirmar se guardan como ajustes (dato operativo original + valor de liquidación). No toca fichajes ni turnos.
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input type="file" accept=".xlsx" disabled={parsing || periodo.estado === 'cerrado' || periodo.estado === 'exportado'} onChange={onFile} />
        {parsing && <span style={{ color: '#94a3b8', fontSize: 13 }}>Analizando…</span>}
      </div>
      {msg && <div style={{ color: msg.ok ? '#4ade80' : '#f87171', fontSize: 13, marginTop: 8 }}>{msg.t}</div>}

      {fuera.length > 0 && (
        <div style={{ margin: '10px 0', fontSize: 12, color: '#fbbf24' }}>
          Fuera del padrón (no se aplican): {fuera.length} empleado(s) del archivo no están en el período.
        </div>
      )}

      {diffs.length > 0 && (
        <>
          <div style={{ maxHeight: 340, overflow: 'auto', marginTop: 10, border: '1px solid #1e293b', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={S.th}>Incorporar</th><th style={S.th}>Empleado</th><th style={S.th}>Variable</th>
                <th style={S.th}>MERCOSUR</th><th style={S.th}>Excel</th><th style={S.th}>Diferencia</th>
              </tr></thead>
              <tbody>
                {diffs.map((d, i) => (
                  <tr key={i}>
                    <td style={S.td}><input type="checkbox" checked={!!incorporar[i]} onChange={e => setIncorporar({ ...incorporar, [i]: e.target.checked })} /></td>
                    <td style={S.td}>{d.nombre || d.cuil || d.usuarioId}</td>
                    <td style={S.td}>{d.etiqueta}</td>
                    <td style={S.td}>{fmt(d.mercosur)}</td>
                    <td style={S.td}>{fmt(d.excel)}</td>
                    <td style={{ ...S.td, color: (d.diferencia ?? 0) > 0 ? '#4ade80' : '#f87171' }}>{d.diferencia === null ? '—' : (d.diferencia > 0 ? '+' : '') + fmt(d.diferencia)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input style={{ ...S.input, flex: '1 1 260px' }} placeholder="Motivo del ajuste (opcional, se guarda en auditoría)" value={motivo} onChange={e => setMotivo(e.target.value)} />
            <button style={{ ...S.btn, opacity: confirmando ? 0.6 : 1 }} disabled={confirmando} onClick={() => void confirmar()}>
              {confirmando ? 'Aplicando…' : `Confirmar ${seleccionados} ajuste(s)`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
