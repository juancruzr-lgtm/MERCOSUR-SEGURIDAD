'use client'
// Liquidación → Liquidaciones finales (migración 20261110120000).
// Cada baja confirmada (app o consulta de ARCA cargada a mano) trae UN borrador.
// La pantalla lo calcula al abrirlo; NO paga, no exporta y no cierra sola: marcar
// lista, exportar a Visual, reimportar el resultado y conciliar son pasos humanos.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CAUSAS_BAJA, type AjusteManual, type CausaBaja, type EntradasFinal } from '@/lib/liquidacion-final'
import {
  calcularYGuardar, conciliacionFinal, excelDeFinal, exportarFinal, historialDeFinal, importarResultadoFinal,
  leerFinal, lineasDeFinal, listarFinales, type FinalFila,
} from '@/lib/liquidacion-final-datos'

type Empleado = { id: string; nombre?: string | null; apellido?: string | null; estado?: string | null }

const S: Record<string, React.CSSProperties> = {
  card: { background: '#0f1629', border: '1px solid #1e293b', borderRadius: 10, padding: 16, marginBottom: 16 },
  input: { padding: '8px 10px', background: '#0a0e1a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 14 },
  btn: { padding: '8px 14px', background: '#2563eb', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btn2: { padding: '8px 14px', background: 'transparent', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  th: { textAlign: 'left', fontSize: 11, color: '#64748b', padding: '6px 8px', borderBottom: '1px solid #1e293b' },
  td: { fontSize: 13, padding: '6px 8px', borderBottom: '1px solid #131c2e', verticalAlign: 'top' },
  err: { color: '#f87171', fontSize: 13 }, ok: { color: '#4ade80', fontSize: 13 }, sub: { color: '#64748b', fontSize: 12 },
}
const ESTADO_TXT: Record<string, string> = {
  pendiente_calculo: 'Pendiente de cálculo', borrador: 'Borrador', lista: 'Lista para exportar',
  exportada: 'Exportada a Visual', conciliada: 'Conciliada', anulada: 'Anulada',
}
const fecha = (iso?: string | null) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—')
const pesos = (n: unknown) => (typeof n === 'number' || (typeof n === 'string' && n !== '') ? Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—')
const causaTxt = (c?: string | null) => CAUSAS_BAJA.find(x => x.valor === c)?.texto ?? 'sin dato'
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))

function descargar(bytes: BlobPart, nombre: string, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
  const a = document.createElement('a'); a.href = url; a.download = nombre
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}

export default function LiquidacionFinalPanel({ empleados }: { empleados: Empleado[] }) {
  const [finales, setFinales] = useState<FinalFila[]>([])
  const [verAnuladas, setVerAnuladas] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [ocupado, setOcupado] = useState('')
  const [alta, setAlta] = useState({ empleado_id: '', fecha: '', causa: '' as CausaBaja | '' })

  async function cargar() {
    const r = await listarFinales(supabase, verAnuladas)
    if (r.error) { setMsg({ ok: false, t: r.error }); return }
    setFinales(r.data)
  }
  useEffect(() => { void cargar() }, [verAnuladas])

  // Los borradores nuevos o con cambios se calculan solos al abrir la pantalla.
  useEffect(() => {
    const pendientes = finales.filter(f => (f.estado === 'pendiente_calculo' || (f.requiere_recalculo && ['borrador', 'lista'].includes(f.estado))))
    if (!pendientes.length || ocupado) return
    let vivo = true
    ;(async () => {
      setOcupado('calculo')
      for (const f of pendientes) {
        if (!vivo) break
        const r = await calcularYGuardar(supabase, f)
        if (r.error) setMsg({ ok: false, t: `${f.baja.nombre ?? f.baja.cuil}: ${r.error}` })
      }
      setOcupado('')
      if (vivo) void cargar()
    })()
    return () => { vivo = false }
  }, [finales.map(f => `${f.id}:${f.version}:${f.requiere_recalculo}`).join('|')])

  async function registrarBaja() {
    if (!alta.empleado_id || !alta.fecha) { setMsg({ ok: false, t: 'Elegí la persona y la fecha efectiva de la baja.' }); return }
    const { data, error } = await supabase.rpc('liquidacion_baja_registrar', {
      p_empleado_id: alta.empleado_id, p_cuil: null, p_fecha_baja: alta.fecha, p_causa: alta.causa || null, p_fuente: 'app', p_referencia: null,
    })
    if (error) { setMsg({ ok: false, t: 'No se pudo registrar: ' + error.message }); return }
    const d = data as any
    setMsg({ ok: true, t: d.nueva ? 'Baja registrada: se preparó el borrador de liquidación final.' : 'Esa baja ya estaba registrada: se sumó la confirmación (no se duplicó el borrador).' })
    setAlta({ empleado_id: '', fecha: '', causa: '' })
    setSel(d.final_id)
    await cargar()
  }

  const activos = useMemo(() => [...empleados].sort((a, b) => `${a.apellido}`.localeCompare(`${b.apellido}`)), [empleados])

  return (
    <div>
      <div style={S.card}>
        <strong>Liquidaciones finales por baja</strong>
        <div style={{ ...S.sub, marginTop: 4 }}>
          Cada baja confirmada (registrada acá, dada de baja en la app o confirmada desde Diferencias con ARCA) prepara UN borrador.
          La baja no corta el acceso a la app ni cambia el pago por banco: son decisiones aparte. Nada se paga, exporta ni cierra solo.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
          <select style={{ ...S.input, flex: '1 1 220px' }} value={alta.empleado_id} onChange={e => setAlta({ ...alta, empleado_id: e.target.value })}>
            <option value="">— Persona —</option>
            {activos.map(e => <option key={e.id} value={e.id}>{`${e.apellido ?? ''}, ${e.nombre ?? ''}${e.estado && e.estado !== 'activo' ? ' (inactivo)' : ''}`}</option>)}
          </select>
          <input type="date" style={S.input} value={alta.fecha} onChange={e => setAlta({ ...alta, fecha: e.target.value })} title="Fecha efectiva de la baja" />
          <select style={S.input} value={alta.causa} onChange={e => setAlta({ ...alta, causa: e.target.value as CausaBaja })}>
            <option value="">— Causa —</option>{CAUSAS_BAJA.map(c => <option key={c.valor} value={c.valor}>{c.texto}</option>)}
          </select>
          <button style={S.btn} onClick={() => void registrarBaja()}>Registrar baja</button>
        </div>
      </div>

      {msg && <div style={{ ...(msg.ok ? S.ok : S.err), marginBottom: 10 }}>{msg.t}</div>}
      {ocupado === 'calculo' && <div style={{ ...S.sub, marginBottom: 10 }}>Calculando borradores nuevos…</div>}

      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>Bajas y borradores</strong>
          <label style={S.sub}><input type="checkbox" checked={verAnuladas} onChange={e => setVerAnuladas(e.target.checked)} /> ver anuladas</label>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
            <thead><tr><th style={S.th}>Persona</th><th style={S.th}>Baja</th><th style={S.th}>Fuente</th><th style={S.th}>Estado</th><th style={S.th}>Total</th><th style={S.th}>Pendientes</th><th style={S.th}></th></tr></thead>
            <tbody>
              {finales.map(f => (
                <tr key={f.id} style={{ background: sel === f.id ? '#131c2e' : undefined }}>
                  <td style={S.td}>{f.baja.nombre ?? '—'}<div style={S.sub}>{f.baja.cuil ?? 'sin CUIL'}</div></td>
                  <td style={S.td}>{fecha(f.baja.fecha_baja)}<div style={S.sub}>{causaTxt(f.baja.causa)}</div></td>
                  <td style={S.td}>{f.baja.fuente === 'arca' ? 'ARCA' : 'App'}{f.baja.confirmaciones?.length > 1 ? <div style={S.sub}>{f.baja.confirmaciones.length} confirmaciones</div> : null}</td>
                  <td style={S.td}>{ESTADO_TXT[f.estado] ?? f.estado}{f.baja.discrepancia ? <div style={S.err}>discrepancia</div> : null}</td>
                  <td style={S.td}>{f.calculo ? pesos(f.calculo.total) : '—'}</td>
                  <td style={S.td}>{f.faltantes?.length ? <span style={S.err}>{f.faltantes.length}</span> : '0'}</td>
                  <td style={S.td}><button style={S.btn2} onClick={() => setSel(sel === f.id ? null : f.id)}>{sel === f.id ? 'Cerrar' : 'Abrir'}</button></td>
                </tr>
              ))}
              {finales.length === 0 && <tr><td style={S.td} colSpan={7}>No hay bajas registradas.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {sel && <DetalleFinal key={sel} finalId={sel} onCambio={() => void cargar()} />}
    </div>
  )
}

function DetalleFinal({ finalId, onCambio }: { finalId: string; onCambio: () => void }) {
  const [f, setF] = useState<FinalFila | null>(null)
  const [lineas, setLineas] = useState<any[]>([])
  const [hist, setHist] = useState<any[]>([])
  const [conc, setConc] = useState<any[] | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [vac, setVac] = useState({ saldo: '', tomadas: '', nota: '' })
  const [ajustes, setAjustes] = useState<AjusteManual[]>([])
  const [nuevoAj, setNuevoAj] = useState({ codigo: '', cantidad: '', importe: '', motivo: '' })
  const [corr, setCorr] = useState({ fecha: '', causa: '' as CausaBaja | '', motivo: '' })
  const [anular, setAnular] = useState('')

  async function cargar() {
    const r = await leerFinal(supabase, finalId)
    if (r.error || !r.data) { setMsg({ ok: false, t: r.error ?? 'No encontrado' }); return }
    setF(r.data)
    const e: EntradasFinal = r.data.entradas ?? {}
    setVac({ saldo: e.vacaciones?.saldoDias?.toString() ?? '', tomadas: e.vacaciones?.tomadasDias?.toString() ?? '', nota: e.vacaciones?.nota ?? '' })
    setAjustes(e.ajustes ?? [])
    setCorr({ fecha: r.data.baja.fecha_baja ?? '', causa: (r.data.baja.causa ?? '') as any, motivo: '' })
    setLineas((await lineasDeFinal(supabase, finalId)).data)
    setHist((await historialDeFinal(supabase, finalId)).data)
    if (['exportada', 'conciliada'].includes(r.data.estado)) setConc((await conciliacionFinal(supabase, finalId)).data)
  }
  useEffect(() => { void cargar() }, [finalId])

  if (!f) return <div style={S.card}>{msg ? <span style={S.err}>{msg.t}</span> : 'Cargando…'}</div>
  const editable = ['pendiente_calculo', 'borrador', 'lista'].includes(f.estado)
  const c = f.calculo

  async function correr(fn: () => Promise<string | null>, ok: string) {
    setOcupado(true); setMsg(null)
    try {
      const err = await fn()
      setMsg(err ? { ok: false, t: err } : { ok: true, t: ok })
    } catch (e: any) { setMsg({ ok: false, t: e?.message ?? String(e) }) }
    setOcupado(false)
    await cargar(); onCambio()
  }

  const guardarEntradas = () => correr(async () => {
    const entradas: EntradasFinal = {
      vacaciones: { saldoDias: numOrNull(vac.saldo), tomadasDias: numOrNull(vac.tomadas), nota: vac.nota.trim() || null },
      ajustes,
    }
    const { error } = await supabase.rpc('liquidacion_final_guardar_entradas', { p_final_id: f.id, p_entradas: entradas, p_version: f.version })
    if (error) return error.message
    const r = await leerFinal(supabase, f.id)
    if (!r.data) return 'No se pudo releer el borrador'
    return (await calcularYGuardar(supabase, r.data)).error
  }, 'Datos guardados y borrador recalculado.')

  const recalcular = () => correr(async () => (await calcularYGuardar(supabase, f)).error, 'Borrador recalculado.')
  const marcarLista = () => correr(async () => (await supabase.rpc('liquidacion_final_marcar_lista', { p_final_id: f.id, p_version: f.version })).error?.message ?? null, 'Marcada como lista. Todavía no se exportó.')
  const bajarExcel = () => correr(async () => {
    const r = await excelDeFinal(supabase, f)
    if (r.error || !r.buf) return r.error ?? 'sin archivo'
    descargar(r.buf, r.nombre, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); return null
  }, 'Excel de trabajo descargado.')
  const exportar = () => {
    if (!window.confirm('Exportar a Visual registra la liquidación final como enviada: después no se puede recalcular. ¿Seguir?')) return
    void correr(async () => {
      const r = await exportarFinal(supabase, f)
      if (r.error || !r.bytes) return r.error ?? 'sin archivo'
      descargar(r.bytes as BlobPart, r.nombre, 'application/vnd.ms-excel'); return null
    }, 'Archivo de Visual generado. Importalo en Visual y después reimportá la Planilla de Sueldos para conciliar.')
  }
  const importar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    void correr(async () => {
      const r = await importarResultadoFinal(supabase, f, file.name, await file.arrayBuffer())
      if (r.error) return r.error
      return r.repetido ? 'Ese archivo ya estaba importado (no se duplicó).' : null
    }, 'Resultado de Visual importado. Revisá la conciliación.')
  }
  const conciliar = () => correr(async () => {
    const { data, error } = await supabase.rpc('liquidacion_final_conciliar', { p_final_id: f.id })
    if (error) return error.message
    return (data as any).conciliada ? null : `Hay ${(data as any).diferencias} diferencias: no se concilió.`
  }, 'Conciliada al centavo.')
  const corregir = () => correr(async () => (await supabase.rpc('liquidacion_baja_corregir', {
    p_baja_id: f.baja_id, p_fecha_baja: corr.fecha || null, p_causa: corr.causa || null, p_motivo: corr.motivo,
  })).error?.message ?? null, 'Baja corregida; el borrador se recalcula.')
  const anularBaja = () => correr(async () => (await supabase.rpc('liquidacion_baja_anular', { p_baja_id: f.baja_id, p_motivo: anular })).error?.message ?? null, 'Baja anulada (se conserva el registro).')

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong>{f.baja.nombre ?? f.baja.cuil}</strong> <span style={S.sub}>CUIL {f.baja.cuil ?? '—'} · v{f.version} · {ESTADO_TXT[f.estado]}</span>
          <div style={S.sub}>Baja {fecha(f.baja.fecha_baja)} · {causaTxt(f.baja.causa)} · fuente {f.baja.fuente === 'arca' ? 'ARCA' : 'app'} · ingreso {fecha(c?.fechas.ingreso ?? f.baja.fecha_inicio_relacion)}</div>
          {f.baja.discrepancia && <div style={S.err}>{f.baja.discrepancia}</div>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {editable && <button style={S.btn2} disabled={ocupado} onClick={() => void recalcular()}>Recalcular</button>}
          {c && <button style={S.btn2} disabled={ocupado} onClick={() => void bajarExcel()}>Excel de trabajo</button>}
          {f.estado === 'borrador' && <button style={S.btn} disabled={ocupado || f.faltantes.length > 0 || f.requiere_recalculo} onClick={() => void marcarLista()}>Marcar lista</button>}
          {f.estado === 'lista' && <button style={{ ...S.btn, background: '#16a34a' }} disabled={ocupado} onClick={exportar}>Exportar a Visual (.xls)</button>}
        </div>
      </div>
      {msg && <div style={{ ...(msg.ok ? S.ok : S.err), marginTop: 8 }}>{msg.t}</div>}

      {f.faltantes.length > 0 && (
        <div style={{ marginTop: 12, padding: 10, border: '1px solid #7f1d1d', borderRadius: 8 }}>
          <strong style={{ color: '#fca5a5' }}>Datos faltantes ({f.faltantes.length})</strong>
          <ul style={{ margin: '6px 0 0 18px', fontSize: 13 }}>{f.faltantes.map(x => <li key={x.clave}>{x.detalle}</li>)}</ul>
        </div>
      )}

      {c && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 12, fontSize: 13 }}>
          <div><div style={S.sub}>Bases</div>Básico {pesos(c.bases.basico)} · día {pesos(c.bases.valorDia)} · hora extra {pesos(c.bases.horaExtra)}</div>
          <div><div style={S.sub}>SAC</div>{c.fechas.diasSAC != null ? `${c.fechas.diasSAC} días desde ${fecha(c.fechas.inicioComputo)}` : c.fechas.variantes ? c.fechas.variantes.map(v => `${v.conteo}: ${v.dias} d = ${pesos(v.total)}`).join(' · ') : '—'}<div style={S.sub}>{c.fechas.regla}</div></div>
          <div><div style={S.sub}>Vacaciones</div>saldo {c.vacaciones.saldo ?? '—'} − tomadas {c.vacaciones.tomadas ?? '—'} = {c.vacaciones.noGozadas ?? '—'}</div>
          <div><div style={S.sub}>Extras</div>{c.extras.horas} h × {pesos(c.extras.valorHora)} − pagado {pesos(c.extras.pagado)} = {pesos(c.extras.pendiente)}</div>
          {c.presentismo.motivo && <div><div style={S.sub}>Presentismo</div>{pesos(c.presentismo.calculado)} → {pesos(c.presentismo.aplicado)}<div style={S.sub}>{c.presentismo.motivo}</div></div>}
          {c.ya_liquidado.length > 0 && <div><div style={S.sub}>Ya liquidado en el mes</div>{c.ya_liquidado.map(y => `${y.codigo}: ${pesos(y.importe)}`).join(' · ')}</div>}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
          <thead><tr><th style={S.th}>Código</th><th style={S.th}>Concepto</th><th style={S.th}>Cantidad</th><th style={S.th}>Importe a Visual</th><th style={S.th}>Total</th><th style={S.th}>Base</th></tr></thead>
          <tbody>
            {lineas.map(l => (
              <tr key={l.codigo}>
                <td style={S.td}>{l.codigo}</td><td style={S.td}>{l.concepto}</td><td style={S.td}>{l.cantidad ?? '—'}</td>
                <td style={S.td}>{pesos(l.importe)}</td><td style={S.td}>{pesos(l.total)}</td>
                <td style={{ ...S.td, ...S.sub }}>{l.detalle?.formula}{l.detalle?.ajuste ? <div style={{ color: '#fbbf24' }}>Ajuste: {l.detalle.ajuste.motivo}</div> : null}</td>
              </tr>
            ))}
            {lineas.length === 0 && <tr><td style={S.td} colSpan={6}>{c ? 'Sin conceptos.' : 'Todavía no se calculó.'}</td></tr>}
            {c && <tr><td style={S.td} colSpan={4}><strong>Total</strong></td><td style={S.td}><strong>{pesos(c.total)}</strong></td><td style={S.td}></td></tr>}
          </tbody>
        </table>
      </div>
      {f.advertencias.length > 0 && <ul style={{ margin: '8px 0 0 18px', fontSize: 12, color: '#fbbf24' }}>{f.advertencias.map((a, i) => <li key={i}>{a}</li>)}</ul>}

      {editable && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #1e293b' }}>
          <strong>Datos manuales</strong>
          <div style={{ ...S.sub, marginTop: 2 }}>Sin saldo o sin vacaciones tomadas queda pendiente: nunca se asume cero.</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <input style={{ ...S.input, width: 150 }} placeholder="Saldo vacaciones (días)" value={vac.saldo} onChange={e => setVac({ ...vac, saldo: e.target.value })} />
            <input style={{ ...S.input, width: 150 }} placeholder="Tomadas (días)" value={vac.tomadas} onChange={e => setVac({ ...vac, tomadas: e.target.value })} />
            <input style={{ ...S.input, flex: '1 1 200px' }} placeholder="De dónde sale el dato" value={vac.nota} onChange={e => setVac({ ...vac, nota: e.target.value })} />
          </div>
          <div style={{ marginTop: 10, fontSize: 13 }}>Ajustes manuales (pisan el cálculo; cantidad e importe vacíos = mantener; importe 0 = quitar)</div>
          {ajustes.map((a, i) => (
            <div key={i} style={{ fontSize: 13, marginTop: 4 }}>
              {a.codigo} · cant {a.cantidad ?? '='} · importe {a.importe ?? '='} · {a.motivo}{' '}
              <button style={{ ...S.btn2, padding: '2px 8px' }} onClick={() => setAjustes(ajustes.filter((_, j) => j !== i))}>Quitar</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            <input style={{ ...S.input, width: 90 }} placeholder="Código" value={nuevoAj.codigo} onChange={e => setNuevoAj({ ...nuevoAj, codigo: e.target.value })} />
            <input style={{ ...S.input, width: 90 }} placeholder="Cantidad" value={nuevoAj.cantidad} onChange={e => setNuevoAj({ ...nuevoAj, cantidad: e.target.value })} />
            <input style={{ ...S.input, width: 120 }} placeholder="Importe" value={nuevoAj.importe} onChange={e => setNuevoAj({ ...nuevoAj, importe: e.target.value })} />
            <input style={{ ...S.input, flex: '1 1 200px' }} placeholder="Motivo (obligatorio)" value={nuevoAj.motivo} onChange={e => setNuevoAj({ ...nuevoAj, motivo: e.target.value })} />
            <button style={S.btn2} disabled={!/^\d{3,9}$/.test(nuevoAj.codigo) || nuevoAj.motivo.trim().length < 3} onClick={() => {
              setAjustes([...ajustes, { codigo: nuevoAj.codigo, cantidad: numOrNull(nuevoAj.cantidad), importe: numOrNull(nuevoAj.importe), motivo: nuevoAj.motivo.trim() }])
              setNuevoAj({ codigo: '', cantidad: '', importe: '', motivo: '' })
            }}>Agregar ajuste</button>
          </div>
          <button style={{ ...S.btn, marginTop: 10 }} disabled={ocupado} onClick={() => void guardarEntradas()}>Guardar y recalcular</button>

          <div style={{ marginTop: 14 }}><strong>Corregir la baja</strong></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            <input type="date" style={S.input} value={corr.fecha} onChange={e => setCorr({ ...corr, fecha: e.target.value })} />
            <select style={S.input} value={corr.causa} onChange={e => setCorr({ ...corr, causa: e.target.value as CausaBaja })}>
              <option value="">— Causa —</option>{CAUSAS_BAJA.map(x => <option key={x.valor} value={x.valor}>{x.texto}</option>)}
            </select>
            <input style={{ ...S.input, flex: '1 1 200px' }} placeholder="Motivo (obligatorio)" value={corr.motivo} onChange={e => setCorr({ ...corr, motivo: e.target.value })} />
            <button style={S.btn2} disabled={ocupado || !corr.fecha || corr.motivo.trim().length < 3} onClick={() => void corregir()}>Corregir</button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <input style={{ ...S.input, flex: '1 1 200px' }} placeholder="Motivo para anular la baja" value={anular} onChange={e => setAnular(e.target.value)} />
            <button style={{ ...S.btn2, color: '#fca5a5', borderColor: '#7f1d1d' }} disabled={ocupado || anular.trim().length < 3} onClick={() => void anularBaja()}>Anular baja</button>
          </div>
        </div>
      )}

      {['exportada', 'conciliada'].includes(f.estado) && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #1e293b' }}>
          <strong>Resultado de Visual y conciliación</strong>
          <div style={{ ...S.sub, marginTop: 2 }}>Reimportá la Planilla de Sueldos de Visual. Cada archivo queda como versión; el mismo archivo no se duplica.</div>
          {f.estado === 'exportada' && <input type="file" accept=".xls,.xlsx" style={{ marginTop: 8 }} disabled={ocupado} onChange={importar} />}
          {conc && conc.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
              <thead><tr><th style={S.th}>Código</th><th style={S.th}>Cant. enviada</th><th style={S.th}>Total enviado</th><th style={S.th}>Cant. Visual</th><th style={S.th}>Importe Visual</th><th style={S.th}>Estado</th></tr></thead>
              <tbody>{conc.map(x => (
                <tr key={x.codigo}><td style={S.td}>{x.codigo}</td><td style={S.td}>{x.cantidad_enviada ?? '—'}</td><td style={S.td}>{pesos(x.total_enviado)}</td>
                  <td style={S.td}>{x.cantidad_visual ?? '—'}</td><td style={S.td}>{pesos(x.importe_visual)}</td>
                  <td style={{ ...S.td, color: ['SIN_DIFERENCIA', 'CALCULADO_POR_VISUAL'].includes(x.estado) ? '#4ade80' : '#f87171' }}>{x.estado}</td></tr>
              ))}</tbody>
            </table>
          )}
          {f.estado === 'exportada' && conc && conc.length > 0 && <button style={{ ...S.btn, marginTop: 8 }} disabled={ocupado} onClick={() => void conciliar()}>Conciliar</button>}
        </div>
      )}

      <details style={{ marginTop: 14 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13 }}>Historial ({hist.length})</summary>
        <ul style={{ margin: '6px 0 0 18px', fontSize: 12, color: '#94a3b8' }}>
          {hist.map(h => <li key={h.id}>{new Date(h.at).toLocaleString('es-AR')} · v{h.version} · {h.accion}{h.datos?.motivo ? ` · ${h.datos.motivo}` : ''}{h.datos?.fuente ? ` · ${h.datos.fuente}` : ''}</li>)}
        </ul>
      </details>
    </div>
  )
}
