'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Novedades del Personal (Administración). CRUD de la tabla EXISTENTE
// novedades_laborales por RANGO (fecha_desde/hasta) o CANTIDAD MENSUAL
// (dias_informados) — sin cargar día por día ni inventar fechas para una
// cantidad. La conversión a días del período la resuelve lib/resumen-guardia
// (fuente única); acá sólo se cargan/consultan las filas.

// Tipos LABORALES que carga Administración (el CHECK de la tabla admite más;
// ajuste_nocturnidad es operativo/nocturnidad y NO se carga por acá).
const TIPOS_LABORALES: { valor: string; label: string; modo: 'rango' | 'ambos' }[] = [
  { valor: 'vacaciones', label: 'Vacaciones', modo: 'ambos' },
  { valor: 'parte_medico', label: 'Parte médico', modo: 'ambos' },
  { valor: 'accidente', label: 'ART / accidente laboral', modo: 'ambos' },
  { valor: 'licencia', label: 'Licencia', modo: 'ambos' },
  { valor: 'suspension', label: 'Suspensión', modo: 'ambos' },
  { valor: 'falta_justificada', label: 'Falta justificada', modo: 'ambos' },
  { valor: 'falta_injustificada', label: 'Falta injustificada', modo: 'ambos' },
  { valor: 'dia_estudio', label: 'Día de estudio', modo: 'ambos' },
  { valor: 'franco', label: 'Franco', modo: 'ambos' },
  { valor: 'otra', label: 'Otra novedad laboral', modo: 'ambos' },
]

const labelTipo = (t?: string | null) => TIPOS_LABORALES.find(x => x.valor === t)?.label || t || '—'

type Empleado = { id: string; nombre?: string | null; apellido?: string | null; legajo?: string | null; estado?: string | null }
interface NovedadFila {
  id: string; empleado_id: string; tipo: string; estado: string
  fecha_desde: string; fecha_hasta: string; dias_informados: number | null
  cantidad_dias: number | null; observacion: string | null; origen_carga: string | null
}

function limitesDelMes(mes: string): { desde: string; hasta: string } {
  const [y, m] = mes.split('-').map(Number)
  const ultimo = new Date(y, m, 0).getDate()
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, '0')}` }
}

const S: Record<string, React.CSSProperties> = {
  wrap: { padding: 16, color: '#e2e8f0', maxWidth: 900 },
  card: { background: '#0f1629', border: '1px solid #1e293b', borderRadius: 10, padding: 16, marginBottom: 16 },
  label: { display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4, marginTop: 8 },
  input: { width: '100%', padding: '8px 10px', background: '#0a0e1a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 14 },
  btn: { padding: '9px 16px', background: '#2563eb', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  btnGhost: { padding: '6px 10px', background: 'transparent', color: '#f87171', border: '1px solid #7f1d1d', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
  row: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  th: { textAlign: 'left', fontSize: 11, color: '#64748b', padding: '6px 8px', borderBottom: '1px solid #1e293b' },
  td: { fontSize: 13, padding: '6px 8px', borderBottom: '1px solid #131c2e' },
  msgOk: { color: '#4ade80', fontSize: 13, marginTop: 8 },
  msgErr: { color: '#f87171', fontSize: 13, marginTop: 8 },
}

export default function NovedadesPersonalPanel({ user, empleados }: { user: any; empleados: Empleado[] }) {
  const hoy = new Date().toISOString().slice(0, 10)
  const mesActual = hoy.slice(0, 7)
  const activos = useMemo(
    () => (empleados || []).filter(e => String(e.estado ?? 'activo').toLowerCase() !== 'inactivo')
      .sort((a, b) => `${a.apellido}`.localeCompare(`${b.apellido}`, 'es')),
    [empleados],
  )

  const [empleadoId, setEmpleadoId] = useState('')
  const [tipo, setTipo] = useState('vacaciones')
  const [modo, setModo] = useState<'rango' | 'mensual'>('rango')
  const [desde, setDesde] = useState(hoy)
  const [hasta, setHasta] = useState(hoy)
  const [mes, setMes] = useState(mesActual)
  const [diasInformados, setDiasInformados] = useState('')
  const [observacion, setObservacion] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [filas, setFilas] = useState<NovedadFila[]>([])
  const [mesLista, setMesLista] = useState(mesActual)

  async function cargarLista() {
    const { desde: d, hasta: h } = limitesDelMes(mesLista)
    let q = supabase.from('novedades_laborales')
      .select('id, empleado_id, tipo, estado, fecha_desde, fecha_hasta, dias_informados, cantidad_dias, observacion, origen_carga')
      .lte('fecha_desde', h).gte('fecha_hasta', d)
      .order('fecha_desde', { ascending: false })
    if (empleadoId) q = q.eq('empleado_id', empleadoId)
    const { data, error } = await q
    if (!error && data) setFilas(data as NovedadFila[])
  }
  useEffect(() => { void cargarLista() }, [mesLista, empleadoId]) // eslint-disable-line react-hooks/exhaustive-deps

  const nombreEmp = (id: string) => {
    const e = activos.find(x => x.id === id)
    return e ? `${e.apellido ?? ''}, ${e.nombre ?? ''}`.replace(/^, |, $/g, '') : id
  }

  async function guardar() {
    setMsg(null)
    if (!empleadoId) { setMsg({ ok: false, texto: 'Elegí un empleado.' }); return }
    if (modo === 'rango' && (!desde || !hasta || hasta < desde)) { setMsg({ ok: false, texto: 'Rango de fechas inválido (hasta ≥ desde).' }); return }
    if (modo === 'mensual') {
      const n = Number(diasInformados)
      if (!Number.isInteger(n) || n < 1 || n > 31) { setMsg({ ok: false, texto: 'Cantidad mensual inválida (1 a 31 días).' }); return }
    }
    setGuardando(true)
    // estado/aprobado se setean juntos (lo exige el CHECK de la tabla).
    const base: any = {
      empleado_id: empleadoId, tipo, observacion: observacion.trim() || null,
      estado: 'aprobada', cargado_por: user?.id ?? null, aprobado_por: user?.id ?? null,
      aprobado_at: new Date().toISOString(),
    }
    if (modo === 'rango') {
      Object.assign(base, { fecha_desde: desde, fecha_hasta: hasta, origen_carga: 'app' })
    } else {
      // Cantidad mensual: las fechas son el PERÍODO de referencia; el valor lo lleva
      // dias_informados (no se inventan filas por día). diasQueAporta lo prioriza.
      const { desde: d, hasta: h } = limitesDelMes(mes)
      Object.assign(base, { fecha_desde: d, fecha_hasta: h, origen_carga: 'importacion_mensual', dias_informados: Number(diasInformados) })
    }
    const { error } = await supabase.from('novedades_laborales').insert(base)
    setGuardando(false)
    if (error) { setMsg({ ok: false, texto: 'No se pudo guardar: ' + error.message }); return }
    setMsg({ ok: true, texto: 'Novedad cargada.' })
    setObservacion(''); setDiasInformados('')
    if (modo === 'mensual') setMesLista(mes)
    void cargarLista()
  }

  async function anular(id: string) {
    const { error } = await supabase.from('novedades_laborales')
      .update({ estado: 'rechazada', observacion: 'Anulada desde Novedades del Personal' })
      .eq('id', id)
    if (!error) void cargarLista()
  }

  const tipoSel = TIPOS_LABORALES.find(t => t.valor === tipo)

  return (
    <div style={S.wrap}>
      <h2 style={{ fontSize: 20, marginBottom: 4 }}>Novedades del Personal</h2>
      <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16 }}>
        Carga de novedades laborales por empleado, por rango de fechas o cantidad mensual.
        Alimentan Reportes, Planillas y Liquidación (fuente única). No incluye conceptos económicos.
      </div>

      <div style={S.card}>
        <div style={S.row}>
          <div style={{ flex: '1 1 260px' }}>
            <label style={S.label}>Empleado</label>
            <select style={S.input} value={empleadoId} onChange={e => setEmpleadoId(e.target.value)}>
              <option value="">— Elegir empleado —</option>
              {activos.map(e => <option key={e.id} value={e.id}>{`${e.apellido ?? ''}, ${e.nombre ?? ''}`}{e.legajo ? ` (${e.legajo})` : ''}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={S.label}>Tipo de novedad</label>
            <select style={S.input} value={tipo} onChange={e => setTipo(e.target.value)}>
              {TIPOS_LABORALES.map(t => <option key={t.valor} value={t.valor}>{t.label}</option>)}
            </select>
          </div>
        </div>

        <div style={S.row}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={S.label}>Modo de carga</label>
            <select style={S.input} value={modo} onChange={e => setModo(e.target.value as any)}>
              <option value="rango">Rango de fechas (desde/hasta; un día = misma fecha)</option>
              <option value="mensual">Cantidad de días en el mes</option>
            </select>
          </div>
        </div>

        {modo === 'rango' ? (
          <div style={S.row}>
            <div style={{ flex: '1 1 160px' }}>
              <label style={S.label}>Desde</label>
              <input type="date" style={S.input} value={desde} onChange={e => { setDesde(e.target.value); if (hasta < e.target.value) setHasta(e.target.value) }} />
            </div>
            <div style={{ flex: '1 1 160px' }}>
              <label style={S.label}>Hasta</label>
              <input type="date" style={S.input} value={hasta} min={desde} onChange={e => setHasta(e.target.value)} />
            </div>
          </div>
        ) : (
          <div style={S.row}>
            <div style={{ flex: '1 1 140px' }}>
              <label style={S.label}>Mes</label>
              <input type="month" style={S.input} value={mes} onChange={e => setMes(e.target.value)} />
            </div>
            <div style={{ flex: '1 1 140px' }}>
              <label style={S.label}>Cantidad de días</label>
              <input type="number" min={1} max={31} style={S.input} value={diasInformados} onChange={e => setDiasInformados(e.target.value)} placeholder="1 a 31" />
            </div>
          </div>
        )}

        <label style={S.label}>Observación (opcional)</label>
        <input style={S.input} value={observacion} onChange={e => setObservacion(e.target.value)} placeholder={tipoSel ? `Detalle de ${tipoSel.label.toLowerCase()}` : ''} />

        <div style={{ marginTop: 14 }}>
          <button style={{ ...S.btn, opacity: guardando ? 0.6 : 1 }} disabled={guardando} onClick={() => void guardar()}>
            {guardando ? 'Guardando…' : 'Cargar novedad'}
          </button>
          {msg && <span style={msg.ok ? S.msgOk : S.msgErr}> {msg.texto}</span>}
        </div>
      </div>

      <div style={S.card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <strong>Novedades del mes {empleadoId ? `· ${nombreEmp(empleadoId)}` : '· todos'}</strong>
          <input type="month" style={{ ...S.input, width: 160 }} value={mesLista} onChange={e => setMesLista(e.target.value)} />
        </div>
        {filas.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 13, padding: 8 }}>Sin novedades cargadas en el período.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={S.th}>Empleado</th><th style={S.th}>Tipo</th><th style={S.th}>Período</th>
              <th style={S.th}>Días</th><th style={S.th}>Estado</th><th style={S.th}></th>
            </tr></thead>
            <tbody>
              {filas.map(f => (
                <tr key={f.id} style={{ opacity: f.estado === 'rechazada' ? 0.5 : 1 }}>
                  <td style={S.td}>{nombreEmp(f.empleado_id)}</td>
                  <td style={S.td}>{labelTipo(f.tipo)}</td>
                  <td style={S.td}>{f.origen_carga === 'importacion_mensual' ? `${f.fecha_desde.slice(0, 7)} (mensual)` : `${f.fecha_desde} → ${f.fecha_hasta}`}</td>
                  <td style={S.td}>{f.dias_informados ?? f.cantidad_dias ?? '—'}</td>
                  <td style={S.td}>{f.estado}</td>
                  <td style={S.td}>{f.estado !== 'rechazada' && <button style={S.btnGhost} onClick={() => void anular(f.id)}>Anular</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
