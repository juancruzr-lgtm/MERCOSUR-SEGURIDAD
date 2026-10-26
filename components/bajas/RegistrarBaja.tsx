'use client'

/**
 * components/bajas/RegistrarBaja.tsx
 *
 * REGISTRAR BAJA — el mismo procedimiento desde Guardias, desde el Legajo y desde
 * Diferencias con ARCA (un solo registro: baja_laboral). Administración/Gerencia.
 *
 *   Identificación (automática) → Motivo → Fechas → Telegramas (IA sugiere) →
 *   Vacaciones → Turnos posteriores → CONFIRMAR BAJA.
 *
 * Mientras es borrador no cambia nada del empleado. Al confirmar (con una
 * confirmación explícita) se bloquea el acceso, pasa a desvinculado y se genera
 * el borrador de liquidación final. La IA sólo sugiere: nada se completa solo.
 */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  accesoDeEmpleado, adjuntarDocumento, anularBaja, anularVacaciones, bajasDeEmpleado, cargarCausas, cargarTiposDocumentoBaja,
  confirmarBaja, documentosDeBaja, estadoLiquidacionDeBaja, guardarBorrador, historialDeBaja, leerDocumentoConIA,
  rectificarBaja, registrarVacaciones, rehabilitarAcceso, reintentarBloqueoAuth, resumenVacacionesDeBaja, turnosPosteriores,
  type BajaFila, type CausaCatalogo, type DocumentoBaja, type ResultadoConfirmar,
} from '@/lib/baja-laboral'
import { CONCEPTOS_A_EVALUAR } from '@/lib/liquidacion-final'
import type { ResumenVacaciones } from '@/lib/baja-vacaciones'
import type { LecturaBaja } from '@/lib/baja-lectura'
import type { TipoDocumento } from '@/lib/documentacion'

const C = {
  fondo: '#0b1220', card: '#111827', borde: '#1e2d42', texto: '#e2e8f0', sub: '#94a3b8', rojo: '#f87171', verde: '#86efac', ambar: '#fbbf24',
}
const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.borde}`, borderRadius: 10, padding: 14, marginBottom: 10 }
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: C.fondo, border: '1px solid #334155', borderRadius: 8, color: C.texto, padding: '9px 10px', fontSize: 14 }
const boton = (color = '#cbd5e1'): React.CSSProperties => ({ background: 'transparent', color, border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', minHeight: 36 })
const primario = (bg: string): React.CSSProperties => ({ ...boton('#fff'), background: bg, border: 'none', fontWeight: 800 })
const etiqueta: React.CSSProperties = { fontSize: 12.5, color: C.sub, marginBottom: 4, display: 'block' }
const fecha = (iso?: string | null) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—')
const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }

export interface IdentificacionEmpleado {
  id: string; nombre: string; dni: string | null; cuil: string | null; legajo: string | null; fechaIngreso: string | null; estado: string | null
}

async function identificacion(empleadoId: string): Promise<IdentificacionEmpleado | null> {
  const [{ data: u }, { data: l }] = await Promise.all([
    supabase.from('usuarios').select('id, nombre, apellido, dni, cuil, legajo, legajo_visual, estado').eq('id', empleadoId).maybeSingle(),
    supabase.from('legajo_datos_personales').select('fecha_ingreso').eq('empleado_id', empleadoId).maybeSingle(),
  ])
  if (!u) return null
  const x = u as any
  return { id: x.id, nombre: `${x.apellido ?? ''}, ${x.nombre ?? ''}`, dni: x.dni ?? null, cuil: x.cuil ?? null, legajo: x.legajo_visual ?? x.legajo ?? null, fechaIngreso: (l as any)?.fecha_ingreso ?? null, estado: x.estado ?? null }
}

export default function RegistrarBaja({ empleadoId, origen, puedeGerencia = false, onCerrar, onCambio }: {
  empleadoId: string
  origen: 'guardias' | 'legajo' | 'arca'
  puedeGerencia?: boolean
  onCerrar?: () => void
  onCambio?: () => void
}) {
  const [ident, setIdent] = useState<IdentificacionEmpleado | null>(null)
  const [baja, setBaja] = useState<BajaFila | null>(null)
  const [historicas, setHistoricas] = useState<BajaFila[]>([])
  const [causas, setCausas] = useState<CausaCatalogo[]>([])
  const [tipos, setTipos] = useState<TipoDocumento[]>([])
  const [docs, setDocs] = useState<DocumentoBaja[]>([])
  const [form, setForm] = useState({ causa: '', fecha_notificacion: '', fecha_baja: '', observaciones: '' })
  const [vac, setVac] = useState<ResumenVacaciones | null>(null)
  const [vacConf, setVacConf] = useState({ devengadas: '', tomadas: '', verificadas: false, nota: '' })
  const [nuevaVac, setNuevaVac] = useState({ periodo: String(new Date().getFullYear()), dias: '', desde: '', hasta: '', observacion: '' })
  const [turnos, setTurnos] = useState<Awaited<ReturnType<typeof turnosPosteriores>>>([])
  const [acceso, setAcceso] = useState<{ bloqueado: boolean; auth: boolean } | null>(null)
  const [liq, setLiq] = useState<{ id: string; estado: string } | null>(null)
  const [hist, setHist] = useState<Awaited<ReturnType<typeof historialDeBaja>>>([])
  const [nuevoDoc, setNuevoDoc] = useState<{ tipo: string; fecha: string; detalle: string; archivos: File[] }>({ tipo: '', fecha: '', detalle: '', archivos: [] })
  const [archivosLocales, setArchivosLocales] = useState<Record<string, File>>({})
  const [lecturas, setLecturas] = useState<Record<string, LecturaBaja>>({})
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [ocupado, setOcupado] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoConfirmar | null>(null)
  const [rect, setRect] = useState({ fecha_baja: '', causa: '', motivo: '' })
  const [motivoAccion, setMotivoAccion] = useState('')

  async function cargar(bajaIdPreferida?: string) {
    const [id, bs, cs, ts] = await Promise.all([identificacion(empleadoId), bajasDeEmpleado(empleadoId), cargarCausas(), cargarTiposDocumentoBaja()])
    setIdent(id); setCausas(cs); setTipos(ts)
    const abiertas = bs.data.filter(b => b.estado !== 'anulada')
    const actual = (bajaIdPreferida ? bs.data.find(b => b.id === bajaIdPreferida) : null) ?? abiertas[0] ?? null
    setBaja(actual); setHistoricas(bs.data.filter(b => b.id !== actual?.id))
    setAcceso(await accesoDeEmpleado(empleadoId))
    if (actual) {
      setForm({ causa: actual.causa ?? '', fecha_notificacion: actual.fecha_notificacion ?? '', fecha_baja: actual.fecha_baja ?? '', observaciones: actual.observaciones ?? '' })
      setRect({ fecha_baja: actual.fecha_baja ?? '', causa: actual.causa ?? '', motivo: '' })
      setDocs(await documentosDeBaja(actual.id))
      setHist(await historialDeBaja(actual.id))
      setLiq(await estadoLiquidacionDeBaja(actual.id))
    } else {
      setDocs([]); setHist([]); setLiq(null)
    }
  }
  useEffect(() => { void cargar() }, [empleadoId])

  const borrador = !baja || baja.estado === 'borrador'
  const fechaBaja = borrador ? form.fecha_baja : baja?.fecha_baja ?? ''
  const fechaIngreso = baja?.fecha_ingreso ?? ident?.fechaIngreso ?? null

  // Vacaciones y turnos se recalculan con la fecha efectiva cargada.
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const r = await resumenVacacionesDeBaja({ empleado_id: empleadoId, fecha_ingreso: fechaIngreso, fecha_baja: fechaBaja || null })
      if (!vivo) return
      setVac(r)
      setVacConf(v => (v.verificadas ? v : { ...v, devengadas: r.devengadasMetodoEmpresa != null ? String(r.devengadasMetodoEmpresa) : '', tomadas: String(r.tomadas) }))
      setTurnos(fechaBaja ? await turnosPosteriores(empleadoId, fechaBaja) : [])
    })()
    return () => { vivo = false }
  }, [empleadoId, fechaIngreso, fechaBaja, docs.length])

  const causa = useMemo(() => causas.find(c => c.codigo === (borrador ? form.causa : baja?.causa)), [causas, form.causa, baja?.causa, borrador])
  const pendientes = vacConf.devengadas !== '' && vacConf.tomadas !== '' ? Number(vacConf.devengadas) - Number(vacConf.tomadas) : null

  async function correr(etiquetaOcupado: string, fn: () => Promise<string | null>, ok: string) {
    setOcupado(etiquetaOcupado); setMsg(null)
    try { const e = await fn(); setMsg(e ? { ok: false, t: e } : { ok: true, t: ok }) }
    catch (e) { setMsg({ ok: false, t: e instanceof Error ? e.message : String(e) }) }
    setOcupado('')
  }

  const guardar = () => correr('guardar', async () => {
    const r = await guardarBorrador(baja?.id ?? null, empleadoId, {
      causa: form.causa || null, fecha_baja: form.fecha_baja || null, fecha_notificacion: form.fecha_notificacion || null,
      observaciones: form.observaciones || null, origen,
    })
    if (r.error) return r.error
    await cargar(r.bajaId ?? undefined); onCambio?.(); return null
  }, 'Borrador guardado. El empleado sigue activo hasta que confirmes la baja.')

  const adjuntar = () => correr('documento', async () => {
    const tipo = tipos.find(t => t.codigo === nuevoDoc.tipo)
    if (!tipo || !nuevoDoc.archivos.length) return 'Elegí el tipo de documento y el archivo.'
    let bajaId = baja?.id ?? null
    if (!bajaId) {
      const r = await guardarBorrador(null, empleadoId, { causa: form.causa || null, fecha_baja: form.fecha_baja || null, fecha_notificacion: form.fecha_notificacion || null, origen })
      if (r.error || !r.bajaId) return r.error ?? 'No se pudo crear el borrador'
      bajaId = r.bajaId
    }
    const r = await adjuntarDocumento({ bajaId, empleadoId, tipo, fecha: nuevoDoc.fecha || null, detalle: nuevoDoc.detalle || null, archivos: nuevoDoc.archivos, onProgreso: t => setOcupado(`documento: ${t}`) })
    if (r.error || !r.documentoId) return r.error
    setArchivosLocales(a => ({ ...a, [r.documentoId!]: nuevoDoc.archivos[0] }))
    setNuevoDoc({ tipo: '', fecha: '', detalle: '', archivos: [] })
    await cargar(bajaId)
    // La IA lee el documento recién subido (sugerencia; no cambia nada).
    setOcupado('ia')
    const l = await leerDocumentoConIA(bajaId, r.documentoId, nuevoDoc.archivos[0])
    if (l.lectura) setLecturas(x => ({ ...x, [r.documentoId!]: l.lectura! }))
    await cargar(bajaId)
    return l.error ? `Documento guardado en el legajo. La IA no pudo leerlo: ${l.error}` : null
  }, 'Documento guardado en el legajo. Revisá lo que leyó la IA y confirmalo o corregilo.')

  const releer = (documentoId: string) => correr('ia', async () => {
    const f = archivosLocales[documentoId]
    if (!f || !baja) return 'Para volver a leerlo, adjuntá de nuevo el archivo.'
    const l = await leerDocumentoConIA(baja.id, documentoId, f)
    if (l.lectura) setLecturas(x => ({ ...x, [documentoId]: l.lectura! }))
    await cargar(baja.id); return l.error
  }, 'Documento leído.')

  const usarLectura = (l: LecturaBaja) => {
    setForm(f => ({
      ...f,
      causa: l.motivo && causas.some(c => c.codigo === l.motivo) ? l.motivo : f.causa,
      fecha_baja: l.fecha_efectiva ?? f.fecha_baja,
      fecha_notificacion: l.fecha_notificacion ?? f.fecha_notificacion,
    }))
    setMsg({ ok: true, t: 'Datos de la IA copiados al formulario. Revisalos y tocá «Guardar borrador»: nada se guarda solo.' })
  }

  const agregarVacaciones = () => correr('vacaciones', async () => {
    const e = await registrarVacaciones(empleadoId, {
      periodo: Number(nuevaVac.periodo), dias: Number(nuevaVac.dias), desde: nuevaVac.desde || null, hasta: nuevaVac.hasta || null, observacion: nuevaVac.observacion,
    })
    if (e) return e
    setNuevaVac(v => ({ ...v, dias: '', desde: '', hasta: '', observacion: '' }))
    setVacConf(v => ({ ...v, verificadas: false }))
    await cargar(baja?.id); return null
  }, 'Vacaciones registradas en el legajo.')

  const confirmar = () => correr('confirmar', async () => {
    if (!baja) return 'Guardá el borrador primero.'
    const g = await guardarBorrador(baja.id, empleadoId, { causa: form.causa || null, fecha_baja: form.fecha_baja || null, fecha_notificacion: form.fecha_notificacion || null, observaciones: form.observaciones || null, origen })
    if (g.error) return g.error
    const vacaciones = vacConf.verificadas && pendientes != null
      ? { devengadas: Number(vacConf.devengadas), tomadas: Number(vacConf.tomadas), pendientes, metodo: 'empresa', verificadas: true, nota: vacConf.nota || null,
          sugerido: vac ? { devengadas: vac.devengadasMetodoEmpresa, control_lct: vac.devengadasControlLCT, tomadas: vac.tomadas } : null }
      : null
    const r = await confirmarBaja(baja.id, vacaciones)
    setConfirmando(false)
    if (r.error || !r.data) return r.error
    setResultado(r.data)
    await cargar(baja.id); onCambio?.(); return null
  }, 'Baja confirmada.')

  if (!ident) return <div style={card}>Cargando…</div>

  return (
    <div style={{ color: C.texto }}>
      {/* Encabezado fijo: «Volver» siempre a mano aunque se baje por el formulario (JC 26/10). */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10,
        ...(onCerrar ? { position: 'sticky' as const, top: -14, zIndex: 5, background: '#0f1629', padding: '10px 0', borderBottom: '1px solid #1e293b' } : {}) }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{baja?.estado === 'confirmada' ? 'Baja' : 'Registrar baja'}</div>
          <div style={{ fontSize: 13, color: C.sub }}>
            {baja ? (baja.estado === 'borrador' ? 'Borrador: el empleado sigue activo' : baja.estado === 'confirmada' ? `Baja confirmada el ${fecha(baja.confirmada_at)}` : 'Baja anulada')
              : ident.estado && ident.estado !== 'activo'
                ? 'Está inactivo en la app pero la baja NUNCA se registró: completá motivo y fecha y confirmala para que se arme la liquidación final.'
                : 'Nueva baja'}
          </div>
        </div>
        {onCerrar && <button type="button" style={boton()} onClick={onCerrar}>← Volver</button>}
      </div>
      {msg && <div role="status" style={{ ...card, borderColor: msg.ok ? '#166534' : '#7f1d1d', color: msg.ok ? C.verde : '#fca5a5' }}>{msg.t}</div>}

      {/* Identificación */}
      <div style={card}>
        <strong>Identificación</strong>
        <div style={{ ...grid2, marginTop: 8, fontSize: 14 }}>
          <div><span style={etiqueta}>Nombre y apellido</span>{baja?.nombre ?? ident.nombre}</div>
          <div><span style={etiqueta}>DNI</span>{baja?.dni ?? ident.dni ?? '—'}</div>
          <div><span style={etiqueta}>CUIL</span>{baja?.cuil ?? ident.cuil ?? '—'}</div>
          <div><span style={etiqueta}>Fecha de ingreso</span>{fecha(fechaIngreso)}{!fechaIngreso && <span style={{ color: C.ambar }}> (falta en el legajo)</span>}</div>
          <div><span style={etiqueta}>Legajo</span>{baja?.legajo ?? ident.legajo ?? '—'}</div>
          <div><span style={etiqueta}>Situación laboral / acceso</span>
            {ident.estado === 'activo' ? 'Activo' : 'Desvinculado / inactivo'} · {acceso?.bloqueado ? <span style={{ color: C.rojo }}>acceso bloqueado</span> : 'acceso habilitado'}
          </div>
        </div>
      </div>

      {/* Motivo y fechas */}
      <div style={card}>
        <strong>Motivo y fechas</strong>
        <div style={{ ...grid2, marginTop: 8 }}>
          <label><span style={etiqueta}>Motivo de desvinculación</span>
            <select style={input} disabled={!borrador} value={form.causa} onChange={e => setForm({ ...form, causa: e.target.value })}>
              <option value="">— Elegí —</option>{causas.map(c => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
            </select>
          </label>
          <label><span style={etiqueta}>Fecha de notificación</span>
            <input type="date" style={input} disabled={!borrador} value={form.fecha_notificacion} onChange={e => setForm({ ...form, fecha_notificacion: e.target.value })} />
          </label>
          <label><span style={etiqueta}>Fecha EFECTIVA de desvinculación</span>
            <input type="date" style={input} disabled={!borrador} value={form.fecha_baja} onChange={e => setForm({ ...form, fecha_baja: e.target.value })} />
          </label>
          <div><span style={etiqueta}>Registro administrativo</span>{baja ? `${fecha(baja.registrada_at)} (${baja.origen})` : 'al guardar'}</div>
        </div>
        {causa && (
          <div style={{ fontSize: 13, color: C.sub, marginTop: 8 }}>
            {causa.ayuda}{causa.evaluar.length > 0 && <> Conceptos a evaluar en la liquidación final: {causa.evaluar.map(k => CONCEPTOS_A_EVALUAR[k]?.texto ?? k).join(' · ')}.</>}
            {causa.presentismo === 'cero_si_no_completa_mes' && <> Presentismo en cero si no completa el mes.</>}
          </div>
        )}
        <label style={{ display: 'block', marginTop: 8 }}><span style={etiqueta}>Observaciones</span>
          <textarea style={{ ...input, minHeight: 60 }} disabled={!borrador} maxLength={1000} value={form.observaciones} onChange={e => setForm({ ...form, observaciones: e.target.value })} />
        </label>
        <div style={{ fontSize: 12.5, color: C.sub, marginTop: 6 }}>La fecha efectiva se carga a mano o desde el documento: nunca se toma del último turno trabajado.</div>
        {borrador && <button type="button" style={{ ...primario('#2563eb'), marginTop: 10 }} disabled={!!ocupado} onClick={() => void guardar()}>{ocupado === 'guardar' ? 'Guardando…' : 'Guardar borrador'}</button>}
      </div>

      {/* Documentación */}
      <div style={card}>
        <strong>Telegramas y documentación</strong>
        <div style={{ fontSize: 12.5, color: C.sub, marginTop: 2 }}>Se guardan en el legajo. Si no hay telegrama (contrato eventual o a plazo fijo), adjuntá la constancia de baja de ARCA. La IA lee el documento y sugiere datos: vos los confirmás o corregís.</div>
        {docs.map(d => {
          const l = lecturas[d.documento_id] ?? (d.ia_datos && 'alertas' in (d.ia_datos as any) ? d.ia_datos as LecturaBaja : null)
          return (
            <div key={d.documento_id} style={{ borderTop: `1px solid ${C.borde}`, marginTop: 8, paddingTop: 8, fontSize: 13.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span>{tipos.find(t => t.codigo === d.documento?.tipo)?.nombre ?? d.documento?.tipo} · {fecha(d.documento?.fecha_emision)} · IA: {d.ia_estado}</span>
                {archivosLocales[d.documento_id] && <button type="button" style={boton()} disabled={!!ocupado} onClick={() => void releer(d.documento_id)}>Leer de nuevo</button>}
              </div>
              {l && (
                <div style={{ marginTop: 6, padding: 8, background: C.fondo, borderRadius: 8 }}>
                  <div>Leído: {l.nombre ?? '—'} · DNI {l.dni ?? '—'} · documento {fecha(l.fecha_documento)} · notificación {fecha(l.fecha_notificacion)} · efectiva {fecha(l.fecha_efectiva)} · motivo {l.motivo ?? '—'}</div>
                  {l.motivo_textual && <div style={{ color: C.sub }}>«{l.motivo_textual}»</div>}
                  {l.informacion_liquidacion && <div style={{ color: C.sub }}>Para la liquidación: {l.informacion_liquidacion}</div>}
                  {l.alertas.length > 0 && <ul style={{ margin: '4px 0 0 18px', color: C.ambar }}>{l.alertas.map((a, i) => <li key={i}>{a}</li>)}</ul>}
                  {borrador && <button type="button" style={{ ...boton(C.verde), marginTop: 6 }} onClick={() => usarLectura(l)}>Usar estos datos en el formulario</button>}
                </div>
              )}
            </div>
          )
        })}
        {baja?.estado !== 'anulada' && (
          <div style={{ ...grid2, marginTop: 10 }}>
            <select style={input} value={nuevoDoc.tipo} onChange={e => setNuevoDoc({ ...nuevoDoc, tipo: e.target.value })}>
              <option value="">— Tipo de documento —</option>{tipos.map(t => <option key={t.codigo} value={t.codigo}>{t.nombre}</option>)}
            </select>
            <input type="date" style={input} value={nuevoDoc.fecha} onChange={e => setNuevoDoc({ ...nuevoDoc, fecha: e.target.value })} aria-label="Fecha del documento" />
            <input style={input} placeholder="Referencia (opcional)" value={nuevoDoc.detalle} onChange={e => setNuevoDoc({ ...nuevoDoc, detalle: e.target.value })} />
            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple style={{ ...input, padding: 6 }} onChange={e => setNuevoDoc({ ...nuevoDoc, archivos: Array.from(e.target.files ?? []) })} />
            <button type="button" style={primario('#475569')} disabled={!!ocupado || !nuevoDoc.tipo || !nuevoDoc.archivos.length} onClick={() => void adjuntar()}>
              {ocupado.startsWith('documento') ? ocupado.replace('documento: ', '') : ocupado === 'ia' ? 'La IA está leyendo…' : 'Adjuntar'}
            </button>
          </div>
        )}
      </div>

      {/* Vacaciones */}
      <div style={card}>
        <strong>Vacaciones</strong>
        {vac && (
          <div style={{ ...grid2, marginTop: 8, fontSize: 14 }}>
            <div><span style={etiqueta}>Antigüedad</span>{vac.antiguedadAnios != null ? `${vac.antiguedadAnios} años (${vac.antiguedadDias} días)` : '—'}</div>
            <div><span style={etiqueta}>Devengadas (método de la empresa: días/365 × 14)</span>{vac.devengadasMetodoEmpresa ?? '—'}</div>
            <div><span style={etiqueta}>Control LCT (no aplicado)</span>{vac.devengadasControlLCT ?? '—'}</div>
            <div><span style={etiqueta}>Gozadas registradas</span>{vac.tomadas}</div>
          </div>
        )}
        {vac && vac.detalleTomadas.length > 0 && (
          <ul style={{ fontSize: 13, color: C.sub, margin: '8px 0 0 18px' }}>
            {vac.detalleTomadas.map(t => (
              <li key={`${t.origen}-${t.id}`}>{t.dias} días · {t.desde ? `${fecha(t.desde)} a ${fecha(t.hasta)}` : `período ${t.periodo}`} · {t.origen === 'novedad' ? 'novedad de la app' : `cargado a mano${t.observacion ? ': ' + t.observacion : ''}`}
                {t.origen === 'manual' && borrador && <button type="button" style={{ ...boton(), padding: '2px 8px', minHeight: 0, marginLeft: 6 }} onClick={() => { const m = window.prompt('Motivo para anular este registro'); if (m) void correr('vacaciones', async () => { const e = await anularVacaciones(t.id, m); await cargar(baja?.id); return e }, 'Registro anulado.') }}>Anular</button>}
              </li>
            ))}
          </ul>
        )}
        {vac?.avisos.map((a, i) => <div key={i} style={{ fontSize: 12.5, color: C.ambar, marginTop: 4 }}>{a}</div>)}
        {borrador && (
          <>
            <div style={{ fontSize: 13, marginTop: 10 }}>Agregar vacaciones tomadas que no están en la app</div>
            <div style={{ ...grid2, marginTop: 6 }}>
              <input style={input} placeholder="Período (año)" value={nuevaVac.periodo} onChange={e => setNuevaVac({ ...nuevaVac, periodo: e.target.value })} />
              <input style={input} placeholder="Días" value={nuevaVac.dias} onChange={e => setNuevaVac({ ...nuevaVac, dias: e.target.value })} />
              <input type="date" style={input} value={nuevaVac.desde} onChange={e => setNuevaVac({ ...nuevaVac, desde: e.target.value })} aria-label="Desde" />
              <input type="date" style={input} value={nuevaVac.hasta} onChange={e => setNuevaVac({ ...nuevaVac, hasta: e.target.value })} aria-label="Hasta" />
              <input style={input} placeholder="Observación / respaldo" value={nuevaVac.observacion} onChange={e => setNuevaVac({ ...nuevaVac, observacion: e.target.value })} />
              <button type="button" style={boton()} disabled={!!ocupado || !nuevaVac.dias} onClick={() => void agregarVacaciones()}>Agregar</button>
            </div>
            <div style={{ ...grid2, marginTop: 10 }}>
              <label><span style={etiqueta}>Devengadas a liquidar</span><input style={input} value={vacConf.devengadas} onChange={e => setVacConf({ ...vacConf, devengadas: e.target.value, verificadas: false })} /></label>
              <label><span style={etiqueta}>Tomadas</span><input style={input} value={vacConf.tomadas} onChange={e => setVacConf({ ...vacConf, tomadas: e.target.value, verificadas: false })} /></label>
              <div><span style={etiqueta}>Pendientes de liquidación</span><strong>{pendientes ?? '—'}</strong></div>
              <label><span style={etiqueta}>Nota</span><input style={input} value={vacConf.nota} onChange={e => setVacConf({ ...vacConf, nota: e.target.value })} /></label>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, fontSize: 13.5 }}>
              <input type="checkbox" checked={vacConf.verificadas} onChange={e => setVacConf({ ...vacConf, verificadas: e.target.checked })} />
              Verifiqué el historial de vacaciones (sin esto, las vacaciones quedan pendientes en la liquidación).
            </label>
          </>
        )}
        {baja?.vacaciones && <div style={{ fontSize: 13.5, marginTop: 8 }}>Confirmadas: devengadas {baja.vacaciones.devengadas ?? '—'} · tomadas {baja.vacaciones.tomadas ?? '—'} · pendientes {baja.vacaciones.pendientes ?? '—'}</div>}
      </div>

      {/* Turnos posteriores */}
      {fechaBaja && (
        <div style={{ ...card, borderColor: turnos.length ? '#92400e' : C.borde }}>
          <strong>Turnos asignados después del {fecha(fechaBaja)}</strong>
          {turnos.length === 0 ? <div style={{ fontSize: 13.5, color: C.sub, marginTop: 4 }}>No tiene turnos asignados después de la baja.</div> : (
            <>
              <ul style={{ fontSize: 13.5, margin: '6px 0 0 18px' }}>{turnos.map(t => <li key={t.turno_id}>{fecha(t.fecha)} {t.hora_inicio?.slice(0, 5)}–{t.hora_fin?.slice(0, 5)} · {t.objetivo ?? '—'} · {t.estado}</li>)}</ul>
              <div style={{ fontSize: 12.5, color: C.ambar, marginTop: 4 }}>No se borran: al confirmar se avisa a Operaciones para reasignarlos desde la programación.</div>
            </>
          )}
        </div>
      )}

      {/* Confirmar */}
      {baja && baja.estado === 'borrador' && (
        <div style={{ ...card, borderColor: '#7f1d1d' }}>
          {!confirmando ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" style={primario('#dc2626')} disabled={!!ocupado || !form.causa || !form.fecha_baja} onClick={() => setConfirmando(true)}>CONFIRMAR BAJA</button>
              <button type="button" style={boton('#fca5a5')} disabled={!!ocupado} onClick={() => { const m = window.prompt('Motivo para anular el borrador'); if (m) void correr('anular', async () => { const e = await anularBaja(baja.id, m); await cargar(); onCambio?.(); return e }, 'Borrador anulado (queda en el historial).') }}>Anular borrador</button>
              {(!form.causa || !form.fecha_baja) && <span style={{ fontSize: 12.5, color: C.sub, alignSelf: 'center' }}>Para confirmar faltan el motivo y la fecha efectiva.</span>}
            </div>
          ) : (
            <div>
              <strong style={{ color: '#fca5a5' }}>¿Confirmar la baja de {baja.nombre}?</strong>
              <ul style={{ fontSize: 13.5, margin: '6px 0 0 18px' }}>
                <li>Fecha efectiva {fecha(form.fecha_baja)} · {causa?.nombre}.</li>
                <li>Pasa a desvinculado y se bloquea su acceso a la app (también si tiene una sesión abierta).</li>
                <li>Se genera el borrador de liquidación final en Liquidaciones (no se paga ni exporta solo).</li>
                <li>{turnos.length ? `Se avisa a Operaciones por ${turnos.length} turno(s) posteriores.` : 'No tiene turnos posteriores.'}</li>
                <li>{vacConf.verificadas ? `Vacaciones pendientes: ${pendientes}.` : 'Vacaciones sin verificar: quedan pendientes en la liquidación.'}</li>
              </ul>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" style={primario('#dc2626')} disabled={!!ocupado} onClick={() => void confirmar()}>{ocupado === 'confirmar' ? 'Confirmando…' : 'Sí, confirmar baja'}</button>
                <button type="button" style={boton()} onClick={() => setConfirmando(false)}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Resultado y acciones sobre una baja confirmada */}
      {resultado && (
        <div style={{ ...card, borderColor: '#166534' }}>
          <strong style={{ color: C.verde }}>Baja confirmada</strong>
          <ul style={{ fontSize: 13.5, margin: '6px 0 0 18px' }}>
            <li>Acceso bloqueado en la base de datos.</li>
            <li>{resultado.acceso.auth === 'bloqueado' ? 'Ingreso bloqueado en la cuenta de acceso.' : resultado.acceso.auth === 'sin_cuenta' ? 'No tenía cuenta de acceso.' : `No se pudo bloquear la cuenta de acceso (${resultado.acceso.error}). La base ya está bloqueada; reintentá abajo.`}</li>
            <li>Liquidación final generada (Liquidación → Liquidaciones finales).</li>
            <li>{resultado.turnos_futuros.length ? `${resultado.turnos_futuros.length} turno(s) para reasignar; avisos enviados: ${resultado.avisos_enviados}.` : 'Sin turnos posteriores.'}</li>
          </ul>
        </div>
      )}
      {baja && baja.estado === 'confirmada' && (
        <div style={card}>
          <strong>Baja confirmada</strong>
          <div style={{ fontSize: 13.5, marginTop: 6 }}>
            {fecha(baja.fecha_baja)} · {causas.find(c => c.codigo === baja.causa)?.nombre ?? baja.causa} · liquidación final: {liq?.estado ?? '—'}
          </div>
          {acceso?.bloqueado && !acceso.auth && (
            <button type="button" style={{ ...boton(C.ambar), marginTop: 8 }} disabled={!!ocupado} onClick={() => void correr('auth', async () => { const r = await reintentarBloqueoAuth(empleadoId); await cargar(baja.id); return r.error }, 'Ingreso bloqueado en la cuenta de acceso.')}>Reintentar bloqueo de la cuenta de acceso</button>
          )}
          <div style={{ fontSize: 13, marginTop: 12 }}>Rectificar (con motivo; no reactiva el acceso)</div>
          <div style={{ ...grid2, marginTop: 6 }}>
            <input type="date" style={input} value={rect.fecha_baja} onChange={e => setRect({ ...rect, fecha_baja: e.target.value })} />
            <select style={input} value={rect.causa} onChange={e => setRect({ ...rect, causa: e.target.value })}>{causas.map(c => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}</select>
            <input style={input} placeholder="Motivo de la rectificación" value={rect.motivo} onChange={e => setRect({ ...rect, motivo: e.target.value })} />
            <button type="button" style={boton()} disabled={!!ocupado || rect.motivo.trim().length < 3} onClick={() => void correr('rect', async () => { const e = await rectificarBaja(baja.id, { fecha_baja: rect.fecha_baja, causa: rect.causa }, rect.motivo); await cargar(baja.id); onCambio?.(); return e }, 'Baja rectificada; la liquidación final se recalcula.')}>Rectificar</button>
          </div>
          {puedeGerencia && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.borde}` }}>
              <div style={{ fontSize: 13 }}>Gerencia</div>
              <input style={{ ...input, marginTop: 6 }} placeholder="Motivo (obligatorio)" value={motivoAccion} onChange={e => setMotivoAccion(e.target.value)} />
              <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <button type="button" style={boton('#fca5a5')} disabled={!!ocupado || motivoAccion.trim().length < 3} onClick={() => void correr('anular', async () => { const e = await anularBaja(baja.id, motivoAccion); await cargar(); onCambio?.(); return e }, 'Baja anulada (el acceso sigue bloqueado hasta rehabilitarlo).')}>Anular baja</button>
                {acceso?.bloqueado && <button type="button" style={boton(C.verde)} disabled={!!ocupado || motivoAccion.trim().length < 3} onClick={() => void correr('rehab', async () => { const r = await rehabilitarAcceso(empleadoId, motivoAccion); await cargar(baja.id); return r.error }, 'Acceso rehabilitado. La situación laboral no cambió.')}>Rehabilitar acceso</button>}
              </div>
            </div>
          )}
        </div>
      )}
      {!baja && acceso?.bloqueado && puedeGerencia && (
        <div style={card}>
          <div style={{ fontSize: 13 }}>El acceso sigue bloqueado por una baja anulada.</div>
          <input style={{ ...input, marginTop: 6 }} placeholder="Motivo (obligatorio)" value={motivoAccion} onChange={e => setMotivoAccion(e.target.value)} />
          <button type="button" style={{ ...boton(C.verde), marginTop: 6 }} disabled={!!ocupado || motivoAccion.trim().length < 3} onClick={() => void correr('rehab', async () => { const r = await rehabilitarAcceso(empleadoId, motivoAccion); await cargar(); return r.error }, 'Acceso rehabilitado.')}>Rehabilitar acceso</button>
        </div>
      )}

      {(hist.length > 0 || historicas.length > 0) && (
        <details style={card}>
          <summary style={{ cursor: 'pointer' }}>Historial ({hist.length}){historicas.length ? ` · bajas anteriores: ${historicas.length}` : ''}</summary>
          <ul style={{ fontSize: 12.5, color: C.sub, margin: '6px 0 0 18px' }}>
            {hist.map(h => <li key={h.id}>{new Date(h.at).toLocaleString('es-AR')} · {h.accion}{h.datos?.motivo ? ` · ${h.datos.motivo}` : ''}</li>)}
            {historicas.map(b => <li key={b.id}>Baja {b.estado} · {fecha(b.fecha_baja)} · {b.causa ?? '—'}</li>)}
          </ul>
        </details>
      )}
      {onCerrar && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <button type="button" style={boton()} onClick={onCerrar}>← Volver</button>
        </div>
      )}
    </div>
  )
}
