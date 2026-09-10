'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { compararReimport, CLAVE_SUELDO_MENSUAL, CLAVE_EXTRA_MENSUAL, type FilaDiff, type FilaIdentidadDiff, type CeldaVisual } from '@/lib/excel-trabajo-reimport'

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
  const [identidad, setIdentidad] = useState<FilaIdentidadDiff[]>([])
  const [incorporar, setIncorporar] = useState<Record<number, boolean>>({})
  const [incorporarId, setIncorporarId] = useState<Record<number, boolean>>({})
  const [fuera, setFuera] = useState<string[]>([])
  const [motivo, setMotivo] = useState('')
  const [parsing, setParsing] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    setParsing(true); setMsg(null); setDiffs([]); setIdentidad([]); setFuera([])
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
      // Falla segura: si no se reconoció ninguna fila de empleado o no hay un
      // período válido en el archivo, NO se asume nada.
      if (r.personasEnArchivo === 0) {
        setMsg({ ok: false, t: 'No se reconoció ninguna fila de empleado en el archivo. ¿Es el Excel de trabajo generado por MERCOSUR?' }); return
      }
      if (!r.periodoDelArchivo) {
        setMsg({ ok: false, t: 'No se pudo determinar el período del archivo (falta la columna oculta de período). Regenerá el Excel de trabajo y volvé a subirlo.' }); return
      }
      if (r.periodoDelArchivo !== periodo.mes) {
        setMsg({ ok: false, t: `El archivo es del período ${r.periodoDelArchivo}, no de ${periodo.mes}. Verificá que subís el Excel correcto.` }); return
      }
      setArchivo(f.name); setHash(h); setDiffs(r.diffs); setIdentidad(r.identidad); setFuera(r.fueraDePadron)
      setIncorporar(Object.fromEntries(r.diffs.map((_, i) => [i, true])))
      setIncorporarId(Object.fromEntries(r.identidad.map((_, i) => [i, true])))
      const partesMsg = [
        `${r.diffs.length} ajuste(s)`,
        r.identidad.length ? `${r.identidad.length} cambio(s) de legajo` : '',
        r.fueraDePadron.length ? `${r.fueraDePadron.length} fuera del padrón (ignorados)` : '',
      ].filter(Boolean)
      setMsg({ ok: true, t: `${partesMsg.join(' · ')}. Revisá y confirmá.` })
    } catch (err: any) {
      setMsg({ ok: false, t: 'No se pudo leer el archivo: ' + (err?.message || err) })
    } finally { setParsing(false); e.target.value = '' }
  }

  async function confirmar() {
    setConfirmando(true); setMsg(null)
    try {
      const seleccion = diffs.filter((_, i) => incorporar[i])
      const idSeleccion = identidad.filter((_, i) => incorporarId[i])
      // SUELDO MENSUAL y EXTRA se guardan con VIGENCIA (arrastre), NO como ajuste
      // de mes. El resto va a liquidacion_ajuste. La identidad va a `usuarios`.
      const smDiffs = seleccion.filter(d => d.clave === CLAVE_SUELDO_MENSUAL && d.excel != null)
      const exDiffs = seleccion.filter(d => d.clave === CLAVE_EXTRA_MENSUAL && d.excel != null)
      const ajustes = seleccion
        .filter(d => d.clave !== CLAVE_SUELDO_MENSUAL && d.clave !== CLAVE_EXTRA_MENSUAL)
        .map(d => ({
          empleado_id: d.usuarioId, tipo: 'variable', clave: d.clave, etiqueta: d.etiqueta,
          valor_operativo: d.mercosur, valor_liquidacion: d.excel, motivo: motivo || null,
        }))
      if (ajustes.length === 0 && smDiffs.length === 0 && exDiffs.length === 0 && idSeleccion.length === 0) {
        setMsg({ ok: false, t: 'No hay cambios seleccionados para incorporar.' }); return
      }

      let resumenAjustes = ''
      if (ajustes.length > 0) {
        const { data, error } = await supabase.rpc('aplicar_ajustes_liquidacion', {
          p_periodo_id: periodo.id, p_archivo: archivo, p_hash: hash, p_motivo: motivo || `Reimport ${archivo}`, p_ajustes: ajustes,
        })
        if (error) { setMsg({ ok: false, t: 'No se pudo aplicar: ' + error.message }); return }
        const r = data as any
        resumenAjustes = `Ajustes: ${r.altas} altas · ${r.cambios} cambios · ${r.errores} errores.`
      }

      let smOk = 0
      if (smDiffs.length > 0) {
        // El BD (columna oculta) de un mensualizado fijo ES su usuario_id.
        for (const d of smDiffs) {
          if (!d.usuarioId) continue
          const { error } = await supabase.rpc('set_sueldo_mensual', { p_usuario_id: d.usuarioId, p_importe: d.excel, p_mes: periodo.mes })
          if (!error) smOk++
        }
      }

      let exOk = 0
      if (exDiffs.length > 0) {
        for (const d of exDiffs) {
          if (!d.usuarioId) continue
          const { error } = await supabase.rpc('set_extra_mensual', { p_usuario_id: d.usuarioId, p_importe: d.excel, p_mes: periodo.mes })
          if (!error) exOk++
        }
      }

      // IDENTIDAD → usuarios (una llamada por persona, junta legajo/CUIL/cuenta).
      let idOk = 0
      if (idSeleccion.length > 0) {
        const porUsuario = new Map<string, { cuil?: string; legajo?: string; cuenta?: string }>()
        for (const d of idSeleccion) {
          if (!d.usuarioId || d.excel == null) continue
          const m = porUsuario.get(d.usuarioId) ?? {}
          if (d.campo === 'cuil') m.cuil = d.excel
          else if (d.campo === 'legajo_visual') m.legajo = d.excel
          else if (d.campo === 'cuenta') m.cuenta = d.excel
          porUsuario.set(d.usuarioId, m)
        }
        for (const [usuarioId, m] of Array.from(porUsuario.entries())) {
          const { error } = await supabase.rpc('actualizar_identidad_usuario', {
            p_usuario_id: usuarioId, p_cuil: m.cuil ?? null, p_legajo_visual: m.legajo ?? null, p_cuenta: m.cuenta ?? null,
          })
          if (!error) idOk++
        }
      }

      const partes = [
        resumenAjustes,
        smDiffs.length ? `SUELDO MENSUAL: ${smOk}/${smDiffs.length} guardado(s) desde ${periodo.mes} (se arrastra).` : '',
        exDiffs.length ? `EXTRA: ${exOk}/${exDiffs.length} guardado(s) desde ${periodo.mes} (se arrastra).` : '',
        idSeleccion.length ? `Legajo: ${idOk} persona(s) actualizada(s) en usuarios.` : '',
      ].filter(Boolean)
      setMsg({ ok: true, t: partes.join(' · ') || 'Aplicado.' })
      setDiffs([]); setIdentidad([]); onDone()
    } catch (e: any) {
      setMsg({ ok: false, t: 'No se pudo aplicar: ' + (e?.message || e) })
    } finally { setConfirmando(false) }
  }

  const seleccionados = diffs.filter((_, i) => incorporar[i]).length + identidad.filter((_, i) => incorporarId[i]).length
  const hayCambios = diffs.length > 0 || identidad.length > 0

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
      )}

      {identidad.length > 0 && (
        <div style={{ maxHeight: 260, overflow: 'auto', marginTop: 10, border: '1px solid #1e293b', borderRadius: 8 }}>
          <div style={{ fontSize: 11, color: '#93c5fd', padding: '6px 8px', background: '#0a1020' }}>
            Datos de legajo editados en el Excel → se guardan en el usuario (persisten para los próximos meses).
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={S.th}>Guardar</th><th style={S.th}>Empleado</th><th style={S.th}>Dato</th>
              <th style={S.th}>Actual</th><th style={S.th}>Nuevo (Excel)</th>
            </tr></thead>
            <tbody>
              {identidad.map((d, i) => (
                <tr key={i}>
                  <td style={S.td}><input type="checkbox" checked={!!incorporarId[i]} onChange={e => setIncorporarId({ ...incorporarId, [i]: e.target.checked })} /></td>
                  <td style={S.td}>{d.nombre || d.usuarioId}</td>
                  <td style={S.td}>{d.etiqueta}</td>
                  <td style={{ ...S.td, color: '#64748b' }}>{d.mercosur || '—'}</td>
                  <td style={{ ...S.td, color: '#4ade80' }}>{d.excel || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hayCambios && (
        <>
          <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input style={{ ...S.input, flex: '1 1 260px' }} placeholder="Motivo del ajuste (opcional, se guarda en auditoría)" value={motivo} onChange={e => setMotivo(e.target.value)} />
            <button style={{ ...S.btn, opacity: confirmando ? 0.6 : 1 }} disabled={confirmando} onClick={() => void confirmar()}>
              {confirmando ? 'Aplicando…' : `Confirmar ${seleccionados} cambio(s)`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
