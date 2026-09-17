'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

// AFIP/ARCA — Fase 1: pantalla de corroboración de empleados contra el Padrón
// A13. Muestra la última corrida (cuándo, cuántos, cuántas novedades) y la foto
// por empleado, resaltando los que tienen algo para revisar. El botón dispara
// una corrida ahora. Todo va por /api/afip/corroboracion (las tablas AFIP son
// sólo-servidor, no se leen directo desde acá).

type Snapshot = {
  usuario_id: string
  cuil: string | null
  existe: boolean
  estado_clave: string | null
  tipo_persona: string | null
  apellido: string | null
  nombre: string | null
  razon_social: string | null
  direccion: string | null
  localidad: string | null
  cod_postal: string | null
  provincia: string | null
  novedades: string[]
  error: string | null
  consultado_at: string
  usuarios?: { nombre: string | null; apellido: string | null; legajo: string | null } | null
}

type Corrida = {
  id: string
  iniciada_at: string
  finalizada_at: string | null
  total: number
  consultados: number
  con_novedad: number
  errores: number
  ok: boolean | null
  detalle: any
}

const S: Record<string, React.CSSProperties> = {
  card: { background: '#0f1629', border: '1px solid #1e293b', borderRadius: 10, padding: 14, marginTop: 12 },
  th: { textAlign: 'left', fontSize: 11, color: '#64748b', padding: '5px 7px', borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap' },
  td: { fontSize: 12, padding: '4px 7px', borderBottom: '1px solid #131c2e', color: '#e2e8f0' },
  btn: { padding: '7px 14px', background: '#2563eb', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnOff: { padding: '7px 14px', background: '#334155', color: '#94a3b8', border: 0, borderRadius: 6, cursor: 'not-allowed', fontSize: 13, fontWeight: 600 },
  chip: { display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999, marginRight: 4, marginBottom: 2 },
  kpi: { fontSize: 22, fontWeight: 700, color: '#e2e8f0' },
  kpiLbl: { fontSize: 11, color: '#64748b' },
}

// Etiquetas legibles de cada bandera de novedad.
const NOVEDAD: Record<string, { txt: string; color: string; bg: string }> = {
  sin_cuil:          { txt: 'Sin CUIL',           color: '#fca5a5', bg: '#3f1d1d' },
  cuil_inexistente:  { txt: 'CUIL inexistente',   color: '#fca5a5', bg: '#3f1d1d' },
  estado_no_activo:  { txt: 'No activo en AFIP',  color: '#fcd34d', bg: '#3f2f0f' },
  apellido_difiere:  { txt: 'Apellido difiere',   color: '#fdba74', bg: '#3a2410' },
  nombre_difiere:    { txt: 'Nombre difiere',     color: '#fdba74', bg: '#3a2410' },
}

function fecha(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function nombreLocal(s: Snapshot): string {
  const u = s.usuarios
  return [u?.apellido, u?.nombre].filter(Boolean).join(', ') || s.usuario_id.slice(0, 8)
}

export default function CorroboracionAfip() {
  const [corridas, setCorridas] = useState<Corrida[]>([])
  const [snaps, setSnaps] = useState<Snapshot[]>([])
  const [cargando, setCargando] = useState(true)
  const [corriendo, setCorriendo] = useState(false)
  const [soloNovedades, setSoloNovedades] = useState(true)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)

  async function tokenHeader() {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  async function cargar() {
    setCargando(true)
    try {
      const res = await fetch('/api/afip/corroboracion', { headers: await tokenHeader(), cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) { setMsg({ ok: false, t: j.error || 'No se pudo cargar' }); return }
      setCorridas(j.corridas ?? [])
      setSnaps(j.snapshots ?? [])
    } catch (e: any) {
      setMsg({ ok: false, t: e?.message || 'Error de red' })
    } finally {
      setCargando(false)
    }
  }
  useEffect(() => { void cargar() }, [])

  async function corroborarAhora() {
    setCorriendo(true); setMsg(null)
    try {
      const res = await fetch('/api/afip/corroboracion', { method: 'POST', headers: await tokenHeader() })
      const j = await res.json()
      if (!res.ok || j.ok === false) {
        setMsg({ ok: false, t: j.error || 'La corroboración falló' })
      } else {
        setMsg({ ok: true, t: `Listo: ${j.consultados} consultados, ${j.conNovedad} con novedad, ${j.errores} errores.` })
      }
      await cargar()
    } catch (e: any) {
      setMsg({ ok: false, t: e?.message || 'Error de red' })
    } finally {
      setCorriendo(false)
    }
  }

  const ultima = corridas[0]
  const visibles = useMemo(
    () => snaps.filter(s => !soloNovedades || (s.novedades && s.novedades.length > 0)),
    [snaps, soloNovedades],
  )
  const conNovedad = snaps.filter(s => s.novedades?.length > 0).length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, color: '#e2e8f0' }}>AFIP · Corroboración de empleados</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b', maxWidth: 640 }}>
            Cruce diario contra el Padrón A13 de ARCA: valida el CUIL, el estado y los nombres, y
            trae el domicilio (localidad/provincia). No detecta altas/bajas de la relación laboral
            —eso es otro web service (Relaciones Laborales) que se suma más adelante—.
          </p>
        </div>
        <button
          style={corriendo ? S.btnOff : S.btn}
          disabled={corriendo}
          onClick={corroborarAhora}
        >
          {corriendo ? 'Corroborando…' : 'Corroborar ahora'}
        </button>
      </div>

      {msg && (
        <div style={{ ...S.card, borderColor: msg.ok ? '#166534' : '#7f1d1d', background: msg.ok ? '#0c2a1a' : '#2a0f0f' }}>
          <span style={{ fontSize: 13, color: msg.ok ? '#86efac' : '#fca5a5' }}>{msg.t}</span>
        </div>
      )}

      <div style={{ ...S.card, display: 'flex', gap: 28, flexWrap: 'wrap' }}>
        <div><div style={S.kpi}>{ultima ? ultima.total : '—'}</div><div style={S.kpiLbl}>Empleados</div></div>
        <div><div style={S.kpi}>{ultima ? ultima.consultados : '—'}</div><div style={S.kpiLbl}>Consultados</div></div>
        <div><div style={{ ...S.kpi, color: conNovedad ? '#fcd34d' : '#86efac' }}>{ultima ? ultima.con_novedad : conNovedad}</div><div style={S.kpiLbl}>Con novedad</div></div>
        <div><div style={{ ...S.kpi, color: ultima?.errores ? '#fca5a5' : '#e2e8f0' }}>{ultima ? ultima.errores : '—'}</div><div style={S.kpiLbl}>Errores</div></div>
        <div><div style={{ fontSize: 13, color: '#94a3b8', marginTop: 6 }}>Última corrida</div><div style={{ fontSize: 13, color: '#e2e8f0' }}>{fecha(ultima?.iniciada_at ?? null)}</div></div>
      </div>

      <div style={{ ...S.card }}>
        <label style={{ fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <input type="checkbox" checked={soloNovedades} onChange={e => setSoloNovedades(e.target.checked)} />
          Mostrar sólo empleados con novedad ({conNovedad})
        </label>

        {cargando ? (
          <p style={{ fontSize: 13, color: '#64748b' }}>Cargando…</p>
        ) : visibles.length === 0 ? (
          <p style={{ fontSize: 13, color: '#64748b' }}>
            {snaps.length === 0 ? 'Todavía no se corrió ninguna corroboración.' : 'Ningún empleado con novedades. 👍'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={S.th}>Empleado</th>
                  <th style={S.th}>CUIL</th>
                  <th style={S.th}>Novedades</th>
                  <th style={S.th}>AFIP: Apellido y nombre</th>
                  <th style={S.th}>Domicilio (AFIP)</th>
                  <th style={S.th}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map(s => (
                  <tr key={s.usuario_id}>
                    <td style={S.td}>{nombreLocal(s)}{s.usuarios?.legajo ? <span style={{ color: '#64748b' }}> · {s.usuarios.legajo}</span> : null}</td>
                    <td style={S.td}>{s.cuil || '—'}</td>
                    <td style={S.td}>
                      {s.novedades?.length
                        ? s.novedades.map(n => {
                            const m = NOVEDAD[n] || { txt: n, color: '#94a3b8', bg: '#1e293b' }
                            return <span key={n} style={{ ...S.chip, color: m.color, background: m.bg }}>{m.txt}</span>
                          })
                        : <span style={{ ...S.chip, color: '#86efac', background: '#0c2a1a' }}>OK</span>}
                    </td>
                    <td style={S.td}>{s.existe ? [s.apellido, s.nombre].filter(Boolean).join(', ') || (s.razon_social ?? '—') : (s.error || '—')}</td>
                    <td style={S.td}>{[s.direccion, s.localidad, s.provincia].filter(Boolean).join(', ') || '—'}</td>
                    <td style={S.td}>{s.estado_clave || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
