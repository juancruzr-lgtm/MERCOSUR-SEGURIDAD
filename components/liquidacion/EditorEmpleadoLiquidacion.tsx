'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { FilaVisual } from '@/lib/visual-export'

// EDITOR POR EMPLEADO (JC 04/11): "entrar a cada uno y corregir de a una cosa,
// que después se refleje en el Excel completo" + "bajar para Visual sólo a ese
// empleado". Se edita lo que Visual toma como DESCUENTO por expediente (embargos /
// alimentos en los slots 111/993 del padrón de liquidación). La corrección se
// guarda en vivo (liquidacion_expediente, RLS: liquidadores) y:
//   · "Preparar / descargar Visual de este empleado" rearma el .xls SÓLO de esa
//     persona con la MISMA regla del archivo completo, ya con la corrección;
//   · tras correrlo en Visual y reimportar el resultado (paso 5), el Excel
//     completo del mes muestra el neto nuevo (el embargo lo aplica Visual).

type Periodo = { id: string; mes: string; estado: string }
type Persona = { id: string; nombre: string | null; cuil: string | null; cod_interno: string | null; estado_liquidable: string }
type Expediente = {
  id: string; persona_id: string; referencia: string | null; observacion: string | null;
  importe: number | null; vigencia_desde: string; vigencia_hasta: string | null;
  estado: string; slot_preferido: string | null; origen: string | null
}

const SLOTS = ['111', '993'] as const

const S: Record<string, React.CSSProperties> = {
  card: { background: '#0f1629', border: '1px solid #1e293b', borderRadius: 10, padding: 16, marginBottom: 16, color: '#e2e8f0' },
  input: { padding: '8px 10px', background: '#0a0e1a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 14 },
  btn: { padding: '8px 14px', background: '#2563eb', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  th: { textAlign: 'left', fontSize: 11, color: '#64748b', padding: '6px 8px', borderBottom: '1px solid #1e293b' },
  td: { fontSize: 13, padding: '6px 8px', borderBottom: '1px solid #131c2e' },
  err: { color: '#f87171', fontSize: 13 }, ok: { color: '#4ade80', fontSize: 13 },
}

function descargarArchivo(bytes: BlobPart, filename: string, mime: string) {
  const blob = new Blob([bytes], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}
const money = (n: number | null | undefined) =>
  (Number(n ?? 0)).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// Último día del mes 'YYYY-MM' como 'YYYY-MM-DD' (para dar de baja "hasta este mes").
function finDeMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  const ultimo = new Date(y, m, 0).getDate()
  return `${mes}-${String(ultimo).padStart(2, '0')}`
}

export default function EditorEmpleadoLiquidacion({ periodos }: { periodos: Periodo[] }) {
  // Períodos activos (no anulados), el más reciente primero.
  const periodosVigentes = useMemo(
    () => (periodos || []).filter(p => p.estado !== 'anulado'),
    [periodos],
  )
  const [periodoId, setPeriodoId] = useState('')
  const periodo = useMemo(() => periodosVigentes.find(p => p.id === periodoId) ?? null, [periodosVigentes, periodoId])
  useEffect(() => {
    if (!periodoId && periodosVigentes.length) setPeriodoId(periodosVigentes[0].id)
  }, [periodosVigentes, periodoId])

  const [personas, setPersonas] = useState<Persona[]>([])
  const [buscar, setBuscar] = useState('')
  const [personaId, setPersonaId] = useState('')
  const persona = useMemo(() => personas.find(p => p.id === personaId) ?? null, [personas, personaId])

  const [expedientes, setExpedientes] = useState<Expediente[]>([])
  const [cargandoExp, setCargandoExp] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)

  // Alta de expediente
  const [alta, setAlta] = useState({ referencia: '', importe: '', slot: '111', vigencia_desde: '', vigencia_hasta: '' })
  // Edición inline (importe / referencia)
  const [editId, setEditId] = useState<string | null>(null)
  const [editVals, setEditVals] = useState<{ referencia: string; importe: string }>({ referencia: '', importe: '' })

  // Preparación del Visual de ESTE empleado (preview + bytes listos para bajar)
  const [prep, setPrep] = useState<{ lineas: FilaVisual[]; bytes: Uint8Array | null; nombre: string | null } | null>(null)
  const [preparando, setPreparando] = useState(false)
  const [bajandoExcel, setBajandoExcel] = useState(false)

  async function cargarPersonas() {
    const { data, error } = await supabase
      .from('liquidacion_persona')
      .select('id, nombre, cuil, cod_interno, estado_liquidable')
      .in('estado_liquidable', ['activo', 'excluido'])
      .order('nombre')
    if (error) { setMsg({ ok: false, t: 'No se pudo cargar el padrón: ' + error.message }); return }
    setPersonas((data as Persona[]) ?? [])
  }
  useEffect(() => { void cargarPersonas() }, [])

  async function cargarExpedientes(id: string) {
    setCargandoExp(true)
    try {
      const { data, error } = await supabase
        .from('liquidacion_expediente')
        .select('id, persona_id, referencia, observacion, importe, vigencia_desde, vigencia_hasta, estado, slot_preferido, origen')
        .eq('persona_id', id)
        .order('vigencia_desde', { ascending: false })
      if (error) { setMsg({ ok: false, t: 'No se pudieron cargar los expedientes: ' + error.message }); return }
      setExpedientes((data as Expediente[]) ?? [])
    } finally { setCargandoExp(false) }
  }

  function seleccionarPersona(id: string) {
    setPersonaId(id)
    setPrep(null); setEditId(null); setMsg(null)
    setAlta({ referencia: '', importe: '', slot: '111', vigencia_desde: periodo ? `${periodo.mes}-01` : '', vigencia_hasta: '' })
    if (id) void cargarExpedientes(id)
    else setExpedientes([])
  }

  // Al cambiar de período, la fecha "desde" por defecto del alta sigue al período.
  useEffect(() => {
    if (periodo) setAlta(a => ({ ...a, vigencia_desde: a.vigencia_desde || `${periodo.mes}-01` }))
  }, [periodo])

  const soloDig = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '')
  const personasFiltradas = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    if (!q) return personas
    const qd = soloDig(q)
    return personas.filter(p =>
      (p.nombre ?? '').toLowerCase().includes(q) ||
      (qd && soloDig(p.cuil).includes(qd)) ||
      (p.cod_interno ?? '').toLowerCase().includes(q),
    )
  }, [personas, buscar])

  // ── Expedientes: alta / baja / reactivar / editar ──────────────────────────
  async function altaExpediente() {
    if (!persona) return
    setMsg(null)
    const imp = alta.importe.trim() === '' ? null : Number(alta.importe)
    if (imp != null && !Number.isFinite(imp)) { setMsg({ ok: false, t: 'Importe inválido.' }); return }
    if (!alta.vigencia_desde) { setMsg({ ok: false, t: 'Falta la vigencia desde.' }); return }
    const { error } = await supabase.from('liquidacion_expediente').insert({
      persona_id: persona.id,
      referencia: alta.referencia.trim() || null,
      importe: imp,
      slot_preferido: alta.slot,
      vigencia_desde: alta.vigencia_desde,
      vigencia_hasta: alta.vigencia_hasta || null,
      estado: 'activo',
      origen: 'editor_empleado',
    })
    if (error) { setMsg({ ok: false, t: 'No se pudo agregar: ' + error.message }); return }
    setAlta({ referencia: '', importe: '', slot: '111', vigencia_desde: periodo ? `${periodo.mes}-01` : '', vigencia_hasta: '' })
    setPrep(null)
    setMsg({ ok: true, t: `Expediente agregado (slot ${alta.slot}). Volvé a preparar el Visual de este empleado para verlo.` })
    await cargarExpedientes(persona.id)
  }

  async function bajaExpediente(e: Expediente) {
    if (!persona || !periodo) return
    const hasta = finDeMes(periodo.mes)
    if (!window.confirm(`Dar de baja el expediente "${e.referencia ?? e.slot_preferido ?? e.id}" ($${money(e.importe)}, slot ${e.slot_preferido ?? '—'})?\nDeja de aplicarse desde ya (y queda registrado como vigente hasta ${hasta}).`)) return
    const { error } = await supabase.from('liquidacion_expediente')
      .update({ estado: 'baja', vigencia_hasta: hasta, updated_at: new Date().toISOString() })
      .eq('id', e.id)
    if (error) { setMsg({ ok: false, t: 'No se pudo dar de baja: ' + error.message }); return }
    setPrep(null)
    setMsg({ ok: true, t: `Expediente dado de baja (hasta ${hasta}). Ya no se exporta a Visual.` })
    await cargarExpedientes(persona.id)
  }

  async function reactivarExpediente(e: Expediente) {
    if (!persona) return
    if (!window.confirm(`Reactivar el expediente "${e.referencia ?? e.slot_preferido ?? e.id}"? Vuelve a aplicarse (sin fecha de corte).`)) return
    const { error } = await supabase.from('liquidacion_expediente')
      .update({ estado: 'activo', vigencia_hasta: null, updated_at: new Date().toISOString() })
      .eq('id', e.id)
    if (error) { setMsg({ ok: false, t: 'No se pudo reactivar: ' + error.message }); return }
    setPrep(null)
    setMsg({ ok: true, t: 'Expediente reactivado.' })
    await cargarExpedientes(persona.id)
  }

  function empezarEdicion(e: Expediente) {
    setEditId(e.id)
    setEditVals({ referencia: e.referencia ?? '', importe: e.importe == null ? '' : String(e.importe) })
  }
  async function guardarEdicion(e: Expediente) {
    setMsg(null)
    const imp = editVals.importe.trim() === '' ? null : Number(editVals.importe)
    if (imp != null && !Number.isFinite(imp)) { setMsg({ ok: false, t: 'Importe inválido.' }); return }
    const { error } = await supabase.from('liquidacion_expediente')
      .update({ referencia: editVals.referencia.trim() || null, importe: imp, updated_at: new Date().toISOString() })
      .eq('id', e.id)
    if (error) { setMsg({ ok: false, t: 'No se pudo guardar: ' + error.message }); return }
    setEditId(null); setPrep(null)
    setMsg({ ok: true, t: 'Expediente actualizado. Volvé a preparar el Visual para verlo reflejado.' })
    if (persona) await cargarExpedientes(persona.id)
  }

  // ── Visual de este empleado (misma regla, en vivo) ─────────────────────────
  async function prepararVisual() {
    if (!persona || !periodo) { setMsg({ ok: false, t: 'Elegí período y empleado.' }); return }
    setPreparando(true); setMsg(null); setPrep(null)
    try {
      const { exportarVisualDeEmpleado } = await import('@/lib/visual-generar')
      const r = await exportarVisualDeEmpleado(supabase, { id: periodo.id, mes: periodo.mes }, { cuil: persona.cuil, codInterno: persona.cod_interno })
      if (r.error || !r.bytes) { setMsg({ ok: false, t: 'No se pudo preparar el Visual de este empleado: ' + (r.error || 'sin líneas') }); return }
      setPrep({ lineas: r.lineas, bytes: r.bytes, nombre: r.nombre })
      setMsg({ ok: true, t: `Visual preparado: ${r.lineas.length} línea(s) para ${r.nombre ?? persona.nombre ?? 'el empleado'} (${periodo.mes}). Revisá abajo y descargalo.` })
    } catch (err: any) {
      setMsg({ ok: false, t: 'No se pudo preparar el Visual: ' + (err?.message || err) })
    } finally { setPreparando(false) }
  }
  function descargarVisual() {
    if (!prep?.bytes || !periodo || !persona) return
    const cod = (persona.cod_interno ?? soloDig(persona.cuil) ?? 'empleado').toString().replace(/[^\w.-]/g, '_')
    descargarArchivo(prep.bytes as BlobPart, `visual_${cod}_${periodo.mes}.xls`, 'application/vnd.ms-excel')
  }

  async function descargarExcelCompleto() {
    if (!periodo) return
    setBajandoExcel(true); setMsg(null)
    try {
      const { generarExcelCompletoConNeto } = await import('@/lib/excel-trabajo-liquidacion')
      const r = await generarExcelCompletoConNeto(supabase, { id: periodo.id, mes: periodo.mes })
      if (r.error || !r.buf) { setMsg({ ok: false, t: 'No se pudo generar el Excel completo: ' + (r.error || 'sin datos') }); return }
      descargarArchivo(r.buf, `liquidacion_completa_${periodo.mes}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      setMsg({ ok: true, t: `Excel completo del mes ${periodo.mes} generado (${r.filas} empleados)${r.visualPendiente ? ' — SUELDO DEL MES pendiente de Visual' : ''}. El neto refleja el embargo recién después de correr Visual y reimportar el resultado (paso 5).` })
    } catch (err: any) {
      setMsg({ ok: false, t: 'No se pudo generar el Excel completo: ' + (err?.message || err) })
    } finally { setBajandoExcel(false) }
  }

  const expVigente = (e: Expediente) =>
    e.estado === 'activo' && (!e.vigencia_hasta || e.vigencia_hasta >= new Date().toISOString().slice(0, 10))

  return (
    <div>
      <div style={S.card}>
        <strong>Editor por empleado</strong>
        <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
          Entrá a cada empleado y corregí de a una cosa: los <b>expedientes / embargos</b> (slots 111 y 993) que
          Visual aplica como descuento. La corrección se guarda al instante; después <b>preparás y descargás el
          archivo de Visual de ese solo empleado</b>, lo corrés en Visual y reimportás el resultado (paso 5) para
          que el <b>Excel completo</b> muestre el neto nuevo.
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
          <label style={{ fontSize: 12, color: '#94a3b8' }}>Período</label>
          <select style={S.input} value={periodoId} onChange={e => { setPeriodoId(e.target.value); setPrep(null) }}>
            {periodosVigentes.length === 0 && <option value="">(sin períodos)</option>}
            {periodosVigentes.map(p => <option key={p.id} value={p.id}>{p.mes} · {p.estado}</option>)}
          </select>
          <input style={{ ...S.input, flex: '1 1 220px' }} placeholder="Buscar empleado (nombre, CUIL o COD)…" value={buscar} onChange={e => setBuscar(e.target.value)} />
          <select style={{ ...S.input, flex: '1 1 260px' }} value={personaId} onChange={e => seleccionarPersona(e.target.value)}>
            <option value="">— Elegí un empleado ({personasFiltradas.length}) —</option>
            {personasFiltradas.map(p => (
              <option key={p.id} value={p.id}>
                {(p.nombre ?? '(sin nombre)')}{p.cod_interno ? ` · ${p.cod_interno}` : ''}{p.cuil ? ` · ${p.cuil}` : ''}{p.estado_liquidable === 'excluido' ? ' · EXCLUIDO' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {msg && <div style={{ ...(msg.ok ? S.ok : S.err), marginBottom: 12 }}>{msg.t}</div>}

      {persona && (
        <>
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
              <strong>{persona.nombre ?? '(sin nombre)'} <span style={{ color: '#64748b', fontWeight: 400, fontSize: 12 }}>· CUIL {persona.cuil ?? '—'} · COD {persona.cod_interno ?? '—'}</span></strong>
              {persona.estado_liquidable === 'excluido' && <span style={{ color: '#fbbf24', fontSize: 12 }}>⚠ excluido de liquidación (no exporta a Visual)</span>}
            </div>

            <div style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', margin: '12px 0 4px' }}>Expedientes / embargos (slots 111 · 993)</div>
            {cargandoExp ? <div style={{ color: '#64748b', fontSize: 13 }}>Cargando…</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={S.th}>Slot</th><th style={S.th}>Referencia</th><th style={S.th}>Importe</th>
                  <th style={S.th}>Vigencia</th><th style={S.th}>Estado</th><th style={S.th}>Acciones</th>
                </tr></thead>
                <tbody>
                  {expedientes.map(e => {
                    const editando = editId === e.id
                    return (
                      <tr key={e.id} style={{ opacity: expVigente(e) ? 1 : 0.55 }}>
                        <td style={S.td}>{e.slot_preferido ?? '—'}</td>
                        <td style={S.td}>{editando
                          ? <input style={{ ...S.input, padding: '4px 6px', width: 160 }} value={editVals.referencia} onChange={ev => setEditVals({ ...editVals, referencia: ev.target.value })} />
                          : (e.referencia ?? '—')}</td>
                        <td style={S.td}>{editando
                          ? <input style={{ ...S.input, padding: '4px 6px', width: 100 }} value={editVals.importe} onChange={ev => setEditVals({ ...editVals, importe: ev.target.value })} />
                          : `$${money(e.importe)}`}</td>
                        <td style={S.td}>{e.vigencia_desde} → {e.vigencia_hasta || '∞'}</td>
                        <td style={S.td}>{e.estado === 'activo' ? <span style={{ color: '#4ade80' }}>activo</span> : <span style={{ color: '#94a3b8' }}>{e.estado}</span>}</td>
                        <td style={S.td}>
                          {editando ? (
                            <>
                              <button style={{ ...S.btn, padding: '4px 10px', background: '#059669', marginRight: 6 }} onClick={() => void guardarEdicion(e)}>Guardar</button>
                              <button style={{ ...S.btn, padding: '4px 10px', background: '#334155' }} onClick={() => setEditId(null)}>Cancelar</button>
                            </>
                          ) : (
                            <>
                              <button style={{ ...S.btn, padding: '4px 10px', background: '#334155', marginRight: 6 }} onClick={() => empezarEdicion(e)}>Editar</button>
                              {e.estado === 'activo'
                                ? <button style={{ ...S.btn, padding: '4px 10px', background: '#7f1d1d' }} onClick={() => void bajaExpediente(e)}>Dar de baja</button>
                                : <button style={{ ...S.btn, padding: '4px 10px', background: '#1d4ed8' }} onClick={() => void reactivarExpediente(e)}>Reactivar</button>}
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {expedientes.length === 0 && <tr><td style={S.td} colSpan={6}>Sin expedientes para este empleado.</td></tr>}
                </tbody>
              </table>
            )}

            {/* Alta de expediente */}
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #1e293b' }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Agregar un expediente. Visual admite hasta 2 por persona (un slot 111 y un 993).</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select style={S.input} value={alta.slot} onChange={e => setAlta({ ...alta, slot: e.target.value })}>
                  {SLOTS.map(s => <option key={s} value={s}>slot {s}</option>)}
                </select>
                <input style={{ ...S.input, flex: '1 1 180px' }} placeholder="Referencia (ej. embargo / alimentos)" value={alta.referencia} onChange={e => setAlta({ ...alta, referencia: e.target.value })} />
                <input style={{ ...S.input, width: 110 }} placeholder="Importe" value={alta.importe} onChange={e => setAlta({ ...alta, importe: e.target.value })} />
                <input type="date" style={S.input} title="Vigencia desde" value={alta.vigencia_desde} onChange={e => setAlta({ ...alta, vigencia_desde: e.target.value })} />
                <input type="date" style={S.input} title="Vigencia hasta (opcional)" value={alta.vigencia_hasta} onChange={e => setAlta({ ...alta, vigencia_hasta: e.target.value })} />
                <button style={S.btn} onClick={() => void altaExpediente()}>Agregar</button>
              </div>
            </div>
          </div>

          {/* Visual de este empleado */}
          <div style={S.card}>
            <strong>Archivo de Visual de este empleado</strong>
            <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
              Rearma el .xls de Visual <b>sólo de {persona.nombre ?? 'este empleado'}</b> con la misma regla del archivo
              completo, ya con tus correcciones. Es una re-descarga puntual: no congela ni reemplaza el archivo del mes.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
              <button style={{ ...S.btn, background: '#334155', opacity: preparando ? 0.6 : 1 }} disabled={preparando} onClick={() => void prepararVisual()}>
                {preparando ? 'Preparando…' : 'Preparar Visual de este empleado'}
              </button>
              {prep?.bytes && <button style={{ ...S.btn, background: '#059669' }} onClick={() => descargarVisual()}>⬇ Descargar .xls de Visual</button>}
              <button style={{ ...S.btn, background: '#334155', opacity: bajandoExcel ? 0.6 : 1 }} disabled={bajandoExcel} onClick={() => void descargarExcelCompleto()}>
                {bajandoExcel ? 'Generando…' : '📊 Descargar Excel completo del mes'}
              </button>
            </div>

            {prep && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Líneas que irían a Visual para este empleado (control):</div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={S.th}>COD</th><th style={S.th}>CUIL</th><th style={S.th}>Código</th><th style={S.th}>Cantidad</th><th style={S.th}>Importe</th></tr></thead>
                  <tbody>
                    {prep.lineas.map((l, i) => (
                      <tr key={i}>
                        <td style={S.td}>{l.legajo}</td><td style={S.td}>{l.cuil}</td><td style={S.td}>{l.codigo}</td>
                        <td style={S.td}>{l.cantidad ?? '—'}</td><td style={S.td}>{l.importe == null ? '—' : `$${money(l.importe)}`}</td>
                      </tr>
                    ))}
                    {prep.lineas.length === 0 && <tr><td style={S.td} colSpan={5}>Sin líneas.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
