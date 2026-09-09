'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { parsearPlanillaVisual, type CeldaVisual } from '@/lib/liquidacion-visual'
import { conciliarResultado, resumenConciliacion, type FilaConciliacion, type EstadoConciliacion } from '@/lib/conciliacion-visual'

// LIQ3/F3 — Importar el RESULTADO FINAL de Visual como una VERSIÓN.
// Reutiliza el parser LIQ1B (parsearPlanillaVisual). El Neto de Visual es el
// valor salarial de referencia: NO se recalcula, sólo se controla que cierre
// (Imponible + No Imp + Asignaciones − Descuentos). Confirmar → RPC versionada.
// Después: conciliación contra lo que MERCOSUR envió.

type Periodo = { id: string; mes: string; estado: string }
type Version = { id: string; version: number; archivo: string | null; vigente: boolean; importado_at: string }

interface FilaResultado {
  cuil: string | null; legajo: string | null; nombre: string | null
  imponible: number | null; no_imponible: number | null; asignaciones: number | null; descuentos: number | null; neto: number | null
  netoControl: number; cierra: boolean
}

const TOL = 0.5
const S: Record<string, React.CSSProperties> = {
  card: { background: '#0f1629', border: '1px solid #1e293b', borderRadius: 10, padding: 16, marginTop: 12 },
  btn: { padding: '8px 14px', background: '#2563eb', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  th: { textAlign: 'left', fontSize: 11, color: '#64748b', padding: '5px 7px', borderBottom: '1px solid #1e293b', position: 'sticky', top: 0, background: '#0f1629' },
  td: { fontSize: 12, padding: '5px 7px', borderBottom: '1px solid #131c2e' },
}
const money = (n: number | null) => n === null || n === undefined ? '—' : n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const soloDigitos = (s?: string | null) => String(s ?? '').replace(/\D/g, '')

async function sha256(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const ETIQUETA: Record<EstadoConciliacion, string> = {
  SIN_DIFERENCIA: 'Sin diferencia',
  CALCULADO_POR_VISUAL: 'Calculado por Visual',
  MODIFICADO_EN_VISUAL: 'Modificado en Visual',
  NUEVO_EN_VISUAL: 'Nuevo en Visual',
  FALTANTE_EN_RESULTADO: 'Faltante en resultado',
  REQUIERE_REVISION: 'Requiere revisión',
}
const COLOR: Record<EstadoConciliacion, string> = {
  SIN_DIFERENCIA: '#4ade80',
  CALCULADO_POR_VISUAL: '#60a5fa',
  MODIFICADO_EN_VISUAL: '#fbbf24',
  NUEVO_EN_VISUAL: '#a78bfa',
  FALTANTE_EN_RESULTADO: '#fb923c',
  REQUIERE_REVISION: '#f87171',
}

export default function ImportarResultadoVisual({ periodo }: { periodo: Periodo }) {
  const [archivo, setArchivo] = useState('')
  const [hash, setHash] = useState('')
  const [filas, setFilas] = useState<FilaResultado[]>([])
  const [conceptos, setConceptos] = useState<{ cuil: string | null; codigo: string; nombre: string; cantidad: number | null; importe: number | null }[]>([])
  const [parsing, setParsing] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [versiones, setVersiones] = useState<Version[]>([])
  const [conc, setConc] = useState<FilaConciliacion[] | null>(null)
  const [cargandoConc, setCargandoConc] = useState(false)
  const [filtroConc, setFiltroConc] = useState<EstadoConciliacion | 'TODOS'>('TODOS')

  async function cargarVersiones() {
    const { data } = await supabase.from('liquidacion_resultado_visual')
      .select('id, version, archivo, vigente, importado_at').eq('periodo_id', periodo.id).order('version', { ascending: false })
    setVersiones((data as Version[]) ?? [])
  }
  useEffect(() => { void cargarVersiones() }, [periodo.id])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    setParsing(true); setMsg(null); setFilas([]); setConceptos([]); setConc(null)
    try {
      const buf = await f.arrayBuffer()
      const h = await sha256(buf)
      // SheetJS lee .xls (BIFF8) y .xlsx; Visual exporta la Planilla de Sueldos.
      const XLSX: any = await import('xlsx')
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const grid: CeldaVisual[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
      const p = parsearPlanillaVisual(grid)
      // Totales por empleado + control de Neto (NO se recalcula el salario).
      const fr: FilaResultado[] = p.totales.map(t => {
        const netoControl = (t.imponible ?? 0) + (t.noImponible ?? 0) + (t.asignaciones ?? 0) - (t.descuentos ?? 0)
        const legajoNombre = p.lineas.find(l => soloDigitos(l.cuil) === soloDigitos(t.cuil))
        return {
          cuil: t.cuil, legajo: legajoNombre?.legajo ?? null, nombre: legajoNombre?.nombreArchivo ?? null,
          imponible: t.imponible, no_imponible: t.noImponible, asignaciones: t.asignaciones, descuentos: t.descuentos, neto: t.neto,
          netoControl, cierra: Math.abs((t.neto ?? 0) - netoControl) < TOL,
        }
      })
      const cs = p.lineas.map(l => ({ cuil: l.cuil, codigo: l.codigo, nombre: l.concepto, cantidad: l.cantidad, importe: l.importe }))
      setArchivo(f.name); setHash(h); setFilas(fr); setConceptos(cs)
      const noCierran = fr.filter(x => !x.cierra).length
      if (p.filaEncabezado < 0) { setMsg({ ok: false, t: p.advertencias.join(' ') || 'No se reconoció la planilla de Visual.' }) }
      else setMsg({ ok: noCierran === 0, t: `Planilla leída: ${fr.length} empleados · ${cs.length} conceptos · Neto de control ${noCierran === 0 ? 'CIERRA en todos' : `NO cierra en ${noCierran} (revisar antes de confirmar)`}.` })
    } catch (err: any) {
      setMsg({ ok: false, t: 'No se pudo leer el archivo: ' + (err?.message || err) })
    } finally { setParsing(false); e.target.value = '' }
  }

  async function confirmar() {
    if (!filas.length) return
    setConfirmando(true); setMsg(null)
    const p_filas = filas.map(f => ({
      cuil: soloDigitos(f.cuil), legajo: f.legajo, nombre: f.nombre,
      imponible: f.imponible, no_imponible: f.no_imponible, asignaciones: f.asignaciones, descuentos: f.descuentos, neto: f.neto,
    }))
    const p_conceptos = conceptos.map(c => ({ cuil: soloDigitos(c.cuil), codigo: c.codigo, nombre: c.nombre, cantidad: c.cantidad, importe: c.importe }))
    const { data, error } = await supabase.rpc('importar_resultado_visual', {
      p_periodo_id: periodo.id, p_archivo: archivo, p_hash: hash, p_filas, p_conceptos,
    })
    setConfirmando(false)
    if (error) { setMsg({ ok: false, t: 'No se pudo importar: ' + error.message }); return }
    const r = data as any
    setMsg({ ok: true, t: `Resultado importado como versión ${r.version} (vigente): ${r.filas} empleados · ${r.conceptos} conceptos. Las versiones anteriores se conservan.` })
    setFilas([]); setConceptos([])
    await cargarVersiones()
    void conciliar()
  }

  // Conciliación: lo que MERCOSUR envió (enviado) vs el resultado VIGENTE de Visual.
  async function conciliar() {
    setCargandoConc(true); setConc(null); setMsg(null)
    try {
      const { data: env } = await supabase.from('liquidacion_enviado_visual')
        .select('cuil, codigo, importe').eq('periodo_id', periodo.id)
      const { data: ver } = await supabase.from('liquidacion_resultado_visual')
        .select('id').eq('periodo_id', periodo.id).eq('vigente', true).maybeSingle()
      if (!ver) { setMsg({ ok: false, t: 'No hay resultado vigente para conciliar. Importá primero el resultado de Visual.' }); return }
      const { data: res } = await supabase.from('liquidacion_resultado_concepto')
        .select('cuil, codigo, importe').eq('resultado_id', (ver as any).id)
      if (!env || env.length === 0) { setMsg({ ok: false, t: 'No hay registro de lo enviado a Visual en este período (generá el .xls de Visual para registrarlo).' }); return }
      const filasConc = conciliarResultado(env as any, (res as any) ?? [])
      setConc(filasConc)
    } catch (e: any) {
      setMsg({ ok: false, t: 'No se pudo conciliar: ' + (e?.message || e) })
    } finally { setCargandoConc(false) }
  }

  const resumen = conc ? resumenConciliacion(conc) : null
  const concVisible = conc ? (filtroConc === 'TODOS' ? conc : conc.filter(f => f.estado === filtroConc)) : []
  const netoNoCierra = filas.filter(f => !f.cierra).length

  return (
    <div style={S.card}>
      <strong>Importar resultado final de Visual (sobre {periodo.mes})</strong>
      <div style={{ color: '#64748b', fontSize: 12, margin: '4px 0 10px' }}>
        Subís la Planilla de Sueldos que Visual devolvió. El <b>Neto de Visual es el valor final</b>: acá sólo se controla que cierre, nunca se recalcula.
        Cada import es una <b>versión</b> nueva (la anterior se conserva). El mismo archivo no se importa dos veces.
      </div>

      {versiones.length > 0 && (
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
          Versiones importadas: {versiones.map(v => (
            <span key={v.id} style={{ marginRight: 10, color: v.vigente ? '#4ade80' : '#64748b' }}>
              v{v.version}{v.vigente ? ' (vigente)' : ''}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input type="file" accept=".xls,.xlsx" disabled={parsing || confirmando} onChange={onFile} />
        {parsing && <span style={{ color: '#94a3b8', fontSize: 13 }}>Leyendo…</span>}
      </div>
      {msg && <div style={{ color: msg.ok ? '#4ade80' : '#f87171', fontSize: 13, marginTop: 8 }}>{msg.t}</div>}

      {filas.length > 0 && (
        <>
          {netoNoCierra > 0 && (
            <div style={{ margin: '10px 0', padding: 8, background: '#2a0f0f', border: '1px solid #7f1d1d', borderRadius: 6, fontSize: 12, color: '#fca5a5' }}>
              El Neto de control no cierra en {netoNoCierra} empleado(s) (Imponible + No Imp + Asignaciones − Descuentos ≠ Neto). Revisá el archivo, pero podés importar igual: no se recalcula el salario.
            </div>
          )}
          <div style={{ maxHeight: 320, overflow: 'auto', marginTop: 10, border: '1px solid #1e293b', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={S.th}>Empleado</th><th style={S.th}>Imponible</th><th style={S.th}>No Imp.</th>
                <th style={S.th}>Asign.</th><th style={S.th}>Desc.</th><th style={S.th}>Neto (Visual)</th><th style={S.th}>Control</th>
              </tr></thead>
              <tbody>
                {filas.slice(0, 400).map((f, i) => (
                  <tr key={i}>
                    <td style={S.td}>{f.nombre || f.cuil || '—'}</td>
                    <td style={S.td}>{money(f.imponible)}</td><td style={S.td}>{money(f.no_imponible)}</td>
                    <td style={S.td}>{money(f.asignaciones)}</td><td style={S.td}>{money(f.descuentos)}</td>
                    <td style={{ ...S.td, fontWeight: 700 }}>{money(f.neto)}</td>
                    <td style={{ ...S.td, color: f.cierra ? '#4ade80' : '#f87171' }}>{f.cierra ? 'cierra' : money(f.netoControl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filas.length > 400 && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Mostrando 400 de {filas.length}; se importan todos.</div>}
          <div style={{ marginTop: 12 }}>
            <button style={{ ...S.btn, opacity: confirmando ? 0.6 : 1 }} disabled={confirmando} onClick={() => void confirmar()}>
              {confirmando ? 'Importando…' : `Confirmar e importar versión (${filas.length} empleados)`}
            </button>
          </div>
        </>
      )}

      {/* Conciliación */}
      {versiones.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #1e293b' }}>
          <button style={{ ...S.btn, background: '#334155', opacity: cargandoConc ? 0.6 : 1 }} disabled={cargandoConc} onClick={() => void conciliar()}>
            {cargandoConc ? 'Conciliando…' : 'Ver conciliación (enviado vs resultado)'}
          </button>
          {resumen && (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {(['TODOS', ...(Object.keys(ETIQUETA) as EstadoConciliacion[])] as (EstadoConciliacion | 'TODOS')[]).map(k => {
                  const n = k === 'TODOS' ? (conc?.length ?? 0) : resumen[k as EstadoConciliacion]
                  const activo = filtroConc === k
                  const color = k === 'TODOS' ? '#e2e8f0' : COLOR[k as EstadoConciliacion]
                  return (
                    <button key={k} onClick={() => setFiltroConc(k)}
                      style={{ padding: '4px 9px', borderRadius: 6, fontSize: 11, cursor: 'pointer', border: `1px solid ${activo ? color : '#1e293b'}`, background: activo ? '#1e293b' : 'transparent', color }}>
                      {k === 'TODOS' ? 'Todos' : ETIQUETA[k as EstadoConciliacion]}: <b>{n}</b>
                    </button>
                  )
                })}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>
                Los conceptos que MERCOSUR envía en 0/0 y vuelven con importe son <b>Calculado por Visual</b> (correcto, no un error). <b>Requiere revisión</b> = Visual anuló un valor que se había enviado.
              </div>
              <div style={{ maxHeight: 340, overflow: 'auto', border: '1px solid #1e293b', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={S.th}>CUIL</th><th style={S.th}>Código</th><th style={S.th}>Enviado</th><th style={S.th}>Resultado</th><th style={S.th}>Dif.</th><th style={S.th}>Estado</th>
                  </tr></thead>
                  <tbody>
                    {concVisible.slice(0, 500).map((f, i) => (
                      <tr key={i}>
                        <td style={S.td}>{f.cuil}</td><td style={S.td}>{f.codigo}</td>
                        <td style={S.td}>{money(f.enviado)}</td><td style={S.td}>{money(f.resultado)}</td>
                        <td style={S.td}>{money(f.diferencia)}</td>
                        <td style={{ ...S.td, color: COLOR[f.estado] }}>{ETIQUETA[f.estado]}</td>
                      </tr>
                    ))}
                    {concVisible.length === 0 && <tr><td style={S.td} colSpan={6}>Sin líneas en este estado.</td></tr>}
                  </tbody>
                </table>
              </div>
              {concVisible.length > 500 && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Mostrando 500 de {concVisible.length}.</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
