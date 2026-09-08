'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { parsearPlanillaVisual, categoriaSugerida, type CeldaVisual } from '@/lib/liquidacion-visual'

type Empleado = { id: string; nombre?: string | null; apellido?: string | null; cuil?: string | null; legajo?: string | null }
type Concepto = { id: string; codigo_visual: string | null; nombre: string; categoria: string }
type Periodo = { id: string; mes: string; estado: string }
type Estado = 'conocido' | 'concepto_nuevo' | 'empleado_no_identificado' | 'error'

interface FilaPreview {
  cuil: string | null; empleado_id: string | null; empleadoNombre: string
  codigo: string; concepto: string; cantidad: number | null; importe: number | null
  concepto_id: string | null; estado: Estado
}

const CATEGORIAS = ['imponible', 'no_imponible', 'asignacion', 'descuento', 'base_auxiliar']
const S: Record<string, React.CSSProperties> = {
  card: { background: '#0f1629', border: '1px solid #1e293b', borderRadius: 10, padding: 16, marginTop: 12 },
  btn: { padding: '8px 14px', background: '#2563eb', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  th: { textAlign: 'left', fontSize: 11, color: '#64748b', padding: '5px 7px', borderBottom: '1px solid #1e293b', position: 'sticky', top: 0, background: '#0f1629' },
  td: { fontSize: 12, padding: '5px 7px', borderBottom: '1px solid #131c2e' },
  input: { padding: '5px 7px', background: '#0a0e1a', border: '1px solid #334155', borderRadius: 5, color: '#e2e8f0', fontSize: 12 },
}
const COLOR_ESTADO: Record<Estado, string> = { conocido: '#4ade80', concepto_nuevo: '#fbbf24', empleado_no_identificado: '#f87171', error: '#f87171' }
const soloDigitos = (s?: string | null) => String(s ?? '').replace(/\D/g, '')

async function sha256(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export default function ImportarLiquidacion({ periodo, empleados, catalogo, onDone }: {
  periodo: Periodo; empleados: Empleado[]; catalogo: Concepto[]; onDone: () => void
}) {
  const [archivo, setArchivo] = useState<string>('')
  const [hash, setHash] = useState<string>('')
  const [filas, setFilas] = useState<FilaPreview[]>([])
  const [claseNuevos, setClaseNuevos] = useState<Record<string, string>>({}) // codigo -> categoria
  const [parsing, setParsing] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)

  const porCuil = new Map(empleados.map(e => [soloDigitos(e.cuil), e]))
  const porCodigo = new Map(catalogo.filter(c => c.codigo_visual).map(c => [c.codigo_visual as string, c]))

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    setParsing(true); setMsg(null); setFilas([])
    try {
      const buf = await f.arrayBuffer()
      const h = await sha256(buf)
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
      const p = parsearPlanillaVisual(grid)
      const nuevos: Record<string, string> = {}
      const fp: FilaPreview[] = p.lineas.map(l => {
        const emp = porCuil.get(soloDigitos(l.cuil))
        const con = porCodigo.get(l.codigo)
        let estado: Estado = 'conocido'
        if (!emp) estado = 'empleado_no_identificado'
        else if (!con) { estado = 'concepto_nuevo'; if (!(l.codigo in nuevos)) nuevos[l.codigo] = categoriaSugerida(l.codigo, l.concepto) }
        return {
          cuil: l.cuil, empleado_id: emp?.id ?? null, empleadoNombre: emp ? `${emp.apellido ?? ''}, ${emp.nombre ?? ''}` : (l.nombreArchivo || l.cuil || '—'),
          codigo: l.codigo, concepto: l.concepto, cantidad: l.cantidad, importe: l.importe,
          concepto_id: con?.id ?? null, estado,
        }
      })
      setArchivo(f.name); setHash(h); setFilas(fp); setClaseNuevos(nuevos)
      const res = { conocidos: fp.filter(x => x.estado === 'conocido').length, nuevos: Object.keys(nuevos).length, sinEmp: fp.filter(x => x.estado === 'empleado_no_identificado').length }
      setMsg({ ok: true, t: `Parseado: ${fp.length} líneas · ${res.conocidos} con concepto conocido · ${res.nuevos} códigos nuevos (clasificar) · ${res.sinEmp} sin empleado.` })
      if (p.advertencias.length) setMsg({ ok: false, t: p.advertencias.join(' ') })
    } catch (err: any) {
      setMsg({ ok: false, t: 'No se pudo leer el archivo: ' + (err?.message || err) })
    } finally { setParsing(false); e.target.value = '' }
  }

  const codigosNuevos = Object.keys(claseNuevos)

  async function confirmar() {
    setConfirmando(true); setMsg(null)
    // Sólo se persisten las líneas con empleado identificado. Los códigos nuevos
    // llevan la categoría clasificada; los conocidos su concepto_id.
    const lineas = filas.filter(f => f.estado !== 'empleado_no_identificado' && f.estado !== 'error').map(f => ({
      empleado_id: f.empleado_id, concepto_id: f.concepto_id, codigo: f.codigo, nombre: f.concepto,
      categoria: f.concepto_id ? null : (claseNuevos[f.codigo] || 'base_auxiliar'), origen: 'importado',
      cantidad: f.cantidad, importe: f.importe, permanente: false,
    }))
    const { data, error } = await supabase.rpc('importar_conceptos_liquidacion', {
      p_periodo_id: periodo.id, p_archivo: archivo, p_hash: hash, p_motivo: `Import ${archivo}`, p_lineas: lineas,
    })
    setConfirmando(false)
    if (error) { setMsg({ ok: false, t: 'No se pudo importar: ' + error.message }); return }
    const r = data as any
    setMsg({ ok: true, t: `Importado: ${r.altas} altas · ${r.cambios} cambios · ${r.errores} errores (lote ${String(r.lote).slice(0, 8)}).` })
    setFilas([]); onDone()
  }

  return (
    <div style={S.card}>
      <strong>Importar planilla de Visual (sobre {periodo.mes})</strong>
      <div style={{ color: '#64748b', fontSize: 12, margin: '4px 0 10px' }}>
        Subís el archivo, se muestra el preview y recién al confirmar se persiste con auditoría. El mismo archivo no se importa dos veces.
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input type="file" accept=".xlsx" disabled={parsing || periodo.estado === 'cerrado' || periodo.estado === 'exportado'} onChange={onFile} />
        {parsing && <span style={{ color: '#94a3b8', fontSize: 13 }}>Parseando…</span>}
      </div>
      {msg && <div style={{ color: msg.ok ? '#4ade80' : '#f87171', fontSize: 13, marginTop: 8 }}>{msg.t}</div>}

      {codigosNuevos.length > 0 && (
        <div style={{ margin: '12px 0', padding: 10, background: '#1a1206', border: '1px solid #7c5510', borderRadius: 8 }}>
          <div style={{ fontSize: 13, color: '#fbbf24', marginBottom: 6 }}>Códigos NUEVOS (clasificá antes de confirmar; se incorporan al catálogo):</div>
          {codigosNuevos.map(cod => {
            const ej = filas.find(f => f.codigo === cod)
            return (
              <div key={cod} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 12, minWidth: 220 }}>{cod} · {ej?.concepto}</span>
                <select style={S.input} value={claseNuevos[cod]} onChange={e => setClaseNuevos({ ...claseNuevos, [cod]: e.target.value })}>
                  {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )
          })}
        </div>
      )}

      {filas.length > 0 && (
        <>
          <div style={{ maxHeight: 320, overflow: 'auto', marginTop: 10, border: '1px solid #1e293b', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={S.th}>Empleado</th><th style={S.th}>Código</th><th style={S.th}>Concepto</th>
                <th style={S.th}>Cant.</th><th style={S.th}>Importe</th><th style={S.th}>Estado</th>
              </tr></thead>
              <tbody>
                {filas.slice(0, 400).map((f, i) => (
                  <tr key={i}>
                    <td style={S.td}>{f.empleadoNombre}</td><td style={S.td}>{f.codigo}</td><td style={S.td}>{f.concepto}</td>
                    <td style={S.td}>{f.cantidad ?? '—'}</td><td style={S.td}>{f.importe ?? '—'}</td>
                    <td style={{ ...S.td, color: COLOR_ESTADO[f.estado] }}>{f.estado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filas.length > 400 && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Mostrando 400 de {filas.length}; se importan todas.</div>}
          <div style={{ marginTop: 12 }}>
            <button style={{ ...S.btn, opacity: confirmando ? 0.6 : 1 }} disabled={confirmando} onClick={() => void confirmar()}>
              {confirmando ? 'Importando…' : `Confirmar importación (${filas.filter(f => f.estado !== 'empleado_no_identificado').length} líneas)`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
