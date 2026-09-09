'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// LIQ2G — Padrón de liquidación del período: carga de 000 DÍAS por persona
// (editable; sin valor = pendiente que bloquea el XLS) y gestión de expedientes
// de importe (se mapean a slots 111/993 al exportar).

type Persona = { id: string; cuil: string | null; nombre: string; cod_interno: string | null; usuario_id: string | null; estado_liquidable: string }
type Periodo = { id: string; mes: string; estado: string }

const S: Record<string, React.CSSProperties> = {
  card: { background: '#0f1629', border: '1px solid #1e293b', borderRadius: 10, padding: 14, marginTop: 12 },
  th: { textAlign: 'left', fontSize: 11, color: '#64748b', padding: '5px 7px', borderBottom: '1px solid #1e293b' },
  td: { fontSize: 12, padding: '4px 7px', borderBottom: '1px solid #131c2e' },
  inp: { width: 70, padding: '3px 6px', background: '#0a0e1a', border: '1px solid #334155', borderRadius: 5, color: '#e2e8f0', fontSize: 12 },
  inpTxt: { padding: '5px 7px', background: '#0a0e1a', border: '1px solid #334155', borderRadius: 5, color: '#e2e8f0', fontSize: 12 },
  btn: { padding: '5px 10px', background: '#2563eb', color: '#fff', border: 0, borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 600 },
}

export default function PadronLiquidacion({ periodo }: { periodo: Periodo }) {
  const [tab, setTab] = useState<'dias' | 'expedientes'>('dias')
  const [personas, setPersonas] = useState<Persona[]>([])
  const [dias, setDias] = useState<Record<string, string>>({})   // persona_id -> días (string editable)
  const [meta, setMeta] = useState<Record<string, { calc: number | null; origen: string | null }>>({})
  const [excelCorr, setExcelCorr] = useState<Record<string, { orig: number | null; corr: number | null }>>({}) // por usuario_id
  const [expedientes, setExpedientes] = useState<any[]>([])
  const [expForm, setExpForm] = useState({ persona_id: '', referencia: '', importe: '' })
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const editable = periodo.estado === 'borrador' || periodo.estado === 'revision'

  async function cargar() {
    const [{ data: pers }, { data: dd }, { data: exp }, { data: aj }] = await Promise.all([
      supabase.from('liquidacion_persona').select('id, cuil, nombre, cod_interno, usuario_id, estado_liquidable').eq('estado_liquidable', 'activo').order('nombre'),
      supabase.from('liquidacion_dias').select('persona_id, dias, dias_calculado, origen').eq('periodo_id', periodo.id),
      supabase.from('liquidacion_expediente').select('id, persona_id, referencia, importe, slot_preferido, estado, vigencia_desde, vigencia_hasta').eq('estado', 'activo'),
      supabase.from('liquidacion_ajuste').select('empleado_id, valor_operativo, valor_liquidacion').eq('periodo_id', periodo.id).eq('tipo', 'variable').eq('clave', 'jornadas'),
    ])
    setPersonas((pers as Persona[]) ?? [])
    const d: Record<string, string> = {}
    const m: Record<string, { calc: number | null; origen: string | null }> = {}
    for (const x of (dd ?? []) as any[]) {
      d[x.persona_id] = x.dias == null ? '' : String(x.dias)
      m[x.persona_id] = { calc: x.dias_calculado == null ? null : Number(x.dias_calculado), origen: x.origen ?? null }
    }
    setDias(d); setMeta(m)
    const ec: Record<string, { orig: number | null; corr: number | null }> = {}
    for (const a of (aj ?? []) as any[]) ec[a.empleado_id] = { orig: a.valor_operativo == null ? null : Number(a.valor_operativo), corr: a.valor_liquidacion == null ? null : Number(a.valor_liquidacion) }
    setExcelCorr(ec)
    setExpedientes((exp as any[]) ?? [])
  }
  useEffect(() => { void cargar() }, [periodo.id])

  const [calculando, setCalculando] = useState(false)
  // Decisión de negocio: 000 = jornadas reales del período (fechas distintas
  // trabajadas). Sólo para quien tiene actividad operativa liquidable; los
  // socios/administrativos sin actividad NO se autocompletan (carga manual).
  async function calcularDias() {
    setCalculando(true); setMsg(null)
    try {
      const { jornadasPorUsuarioDelMes } = await import('@/lib/excel-trabajo-liquidacion')
      const { jornadas, corregidos, error } = await jornadasPorUsuarioDelMes(supabase, { id: periodo.id, mes: periodo.mes })
      if (error) { setMsg({ ok: false, t: 'No se pudo calcular: ' + error }); return }
      let n = 0, sinActividad = 0
      const upserts: any[] = []
      for (const p of personas) {
        const j = p.usuario_id ? (jornadas.get(p.usuario_id) ?? 0) : 0
        if (j > 0) { upserts.push({ periodo_id: periodo.id, persona_id: p.id, dias: j, dias_calculado: j, origen: 'calculado_planilla' }); n++ }
        else sinActividad++
      }
      if (upserts.length > 0) {
        const { error: e2 } = await supabase.from('liquidacion_dias').upsert(upserts, { onConflict: 'periodo_id,persona_id' })
        if (e2) { setMsg({ ok: false, t: 'No se pudo guardar: ' + e2.message }); return }
      }
      setMsg({ ok: true, t: `000 calculado desde la planilla del mes (fechas distintas trabajadas, sin tope) para ${n} persona(s)${corregidos ? `, ${corregidos} con jornadas corregidas en el Excel` : ''}. ${sinActividad} sin actividad operativa quedan para carga manual (no se autocompletan). Podés ajustar antes de exportar.` })
      void cargar()
    } catch (e: any) { setMsg({ ok: false, t: 'No se pudo calcular: ' + (e?.message || e) }) }
    finally { setCalculando(false) }
  }

  async function guardarDias(persona_id: string) {
    const raw = dias[persona_id]
    const val = raw === '' || raw === undefined ? null : Number(raw)
    if (val !== null && !Number.isFinite(val)) { setMsg({ ok: false, t: 'Días inválido.' }); return }
    const { error } = await supabase.from('liquidacion_dias')
      .upsert({ periodo_id: periodo.id, persona_id, dias: val, origen: 'manual' }, { onConflict: 'periodo_id,persona_id' })
    setMsg(error ? { ok: false, t: 'No se pudo guardar: ' + error.message } : { ok: true, t: 'Días guardados.' })
  }

  async function agregarExpediente() {
    if (!expForm.persona_id || !expForm.importe) { setMsg({ ok: false, t: 'Persona e importe requeridos.' }); return }
    const vigentes = expedientes.filter(e => e.persona_id === expForm.persona_id)
    if (vigentes.length >= 2) { setMsg({ ok: false, t: 'Ya hay 2 expedientes vigentes (slots 111/993). Dá de baja uno primero.' }); return }
    const slot = vigentes.some(e => e.slot_preferido === '111') ? '993' : '111'
    const { error } = await supabase.from('liquidacion_expediente').insert({
      persona_id: expForm.persona_id, referencia: expForm.referencia || null, importe: Number(expForm.importe),
      vigencia_desde: `${periodo.mes}-01`, estado: 'activo', slot_preferido: slot, origen: 'manual',
    })
    if (error) { setMsg({ ok: false, t: 'No se pudo: ' + error.message }); return }
    setExpForm({ persona_id: '', referencia: '', importe: '' }); setMsg({ ok: true, t: `Expediente agregado (slot ${slot}).` }); void cargar()
  }
  async function bajaExpediente(id: string) {
    const { error } = await supabase.from('liquidacion_expediente').update({ estado: 'baja', vigencia_hasta: `${periodo.mes}-01` }).eq('id', id)
    if (!error) { setMsg({ ok: true, t: 'Expediente dado de baja.' }); void cargar() }
  }

  const nombrePersona = (id: string) => personas.find(p => p.id === id)?.nombre ?? id
  const pendientes = personas.filter(p => !(p.id in dias) || dias[p.id] === '').length

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button style={{ ...S.btn, background: tab === 'dias' ? '#1e293b' : 'transparent', color: tab === 'dias' ? '#fff' : '#94a3b8' }} onClick={() => setTab('dias')}>000 Días trabajados {pendientes > 0 && <span style={{ color: '#f87171' }}>({pendientes} pendientes)</span>}</button>
        <button style={{ ...S.btn, background: tab === 'expedientes' ? '#1e293b' : 'transparent', color: tab === 'expedientes' ? '#fff' : '#94a3b8' }} onClick={() => setTab('expedientes')}>Expedientes / embargos (111/993)</button>
      </div>
      {msg && <div style={{ color: msg.ok ? '#4ade80' : '#f87171', fontSize: 12, marginBottom: 8 }}>{msg.t}</div>}

      {tab === 'dias' && (
        <>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>
            <b>Auditoría del 000</b> (no es carga obligatoria): el 000 ya viaja en el Excel de trabajo y en la generación a Visual, calculado desde la planilla real. Acá ves <b>calculado</b> vs <b>corregido en el Excel</b>, y podés forzar un valor manual si hace falta. Sin actividad = <b style={{ color: '#fbbf24' }}>PENDIENTE</b> (no se inventa). {personas.length} personas liquidables.
          </div>
          {editable && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <button style={{ ...S.btn, opacity: calculando ? 0.6 : 1 }} disabled={calculando} onClick={() => void calcularDias()}>
                {calculando ? 'Calculando…' : 'Recalcular 000 (diagnóstico)'}
              </button>
              <span style={{ color: '#64748b', fontSize: 12, flex: '1 1 260px' }}>
                Recalcula desde las <b>jornadas reales</b> (fechas distintas; varios turnos el mismo día = 1; sin tope) e incorpora la corrección del Excel. Los <b>sin actividad</b> NO se autocompletan.
              </span>
            </div>
          )}
          <div style={{ maxHeight: 340, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={S.th}>Persona</th><th style={S.th}>COD_INT.</th><th style={S.th}>Calc. planilla</th><th style={S.th}>Corregido Excel</th><th style={S.th}>000 (final)</th><th style={S.th}>Origen</th><th style={S.th}></th></tr></thead>
              <tbody>{personas.map(p => {
                const mm = meta[p.id]
                const ec = p.usuario_id ? excelCorr[p.usuario_id] : undefined
                const pendiente = dias[p.id] === '' || !(p.id in dias)
                return (
                <tr key={p.id} style={{ background: pendiente ? '#1a0f0f' : 'transparent' }}>
                  <td style={S.td}>{p.nombre}{!p.usuario_id && <span style={{ color: '#fbbf24' }}> · sólo Visual</span>}</td>
                  <td style={S.td}>{p.cod_interno || <span style={{ color: '#f87171' }}>falta</span>}</td>
                  <td style={S.td}>{mm?.calc ?? '—'}</td>
                  <td style={S.td}>{ec && ec.corr != null ? <span style={{ color: '#fbbf24' }}>{ec.corr}{ec.orig != null && ec.orig !== ec.corr ? ` (era ${ec.orig})` : ''}</span> : '—'}</td>
                  <td style={S.td}><input style={S.inp} disabled={!editable} value={dias[p.id] ?? ''} onChange={e => setDias({ ...dias, [p.id]: e.target.value })} placeholder={pendiente ? 'PEND.' : '—'} /></td>
                  <td style={S.td}>{mm?.origen ?? '—'}</td>
                  <td style={S.td}>{editable && <button style={S.btn} onClick={() => void guardarDias(p.id)}>Guardar</button>}</td>
                </tr>
              )})}</tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'expedientes' && (
        <>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>
            Expedientes/embargos de importe. Máximo 2 vigentes por persona → slots <b>111</b> y <b>993</b>. Los importes NO son eternos (tienen vigencia).
          </div>
          {editable && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <select style={S.inpTxt} value={expForm.persona_id} onChange={e => setExpForm({ ...expForm, persona_id: e.target.value })}>
                <option value="">— Persona —</option>{personas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
              <input style={{ ...S.inpTxt, flex: '1 1 160px' }} placeholder="Referencia/expediente" value={expForm.referencia} onChange={e => setExpForm({ ...expForm, referencia: e.target.value })} />
              <input style={S.inpTxt} placeholder="Importe" value={expForm.importe} onChange={e => setExpForm({ ...expForm, importe: e.target.value })} />
              <button style={S.btn} onClick={() => void agregarExpediente()}>Agregar</button>
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={S.th}>Persona</th><th style={S.th}>Referencia</th><th style={S.th}>Slot</th><th style={S.th}>Importe</th><th style={S.th}>Vigencia</th><th style={S.th}></th></tr></thead>
            <tbody>{expedientes.map(e => (
              <tr key={e.id}>
                <td style={S.td}>{nombrePersona(e.persona_id)}</td><td style={S.td}>{e.referencia || '—'}</td>
                <td style={S.td}>{e.slot_preferido || '—'}</td><td style={S.td}>{e.importe ?? '—'}</td>
                <td style={S.td}>{e.vigencia_desde} → {e.vigencia_hasta || '∞'}</td>
                <td style={S.td}>{editable && <button style={{ ...S.btn, background: '#7f1d1d' }} onClick={() => void bajaExpediente(e.id)}>Baja</button>}</td>
              </tr>
            ))}
              {expedientes.length === 0 && <tr><td style={S.td} colSpan={6}>Sin expedientes vigentes.</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
