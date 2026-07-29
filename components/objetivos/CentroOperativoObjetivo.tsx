'use client'

// Centro Operativo del Objetivo — vista de detalle de un objetivo.
//
// Extraído de app/dashboard/AppClient.tsx sin cambios funcionales. Vivía como
// función local y por eso no podía reutilizarse desde SupervisorMobile, que es
// el motivo por el que hoy el supervisor no puede abrir el legajo del objetivo.
//
// Los estilos `S.btn*` de AppClient se reemplazaron por sus equivalentes de
// components/ui/base (mismos valores) y `Badge` se importa del mismo módulo.
//
// Los datos ya no llegan por props desde AppClient: el componente los pide a
// lib/legajo-objetivo.ts con el `objetivoId`. Es lo que le permite montarse
// desde cualquier pantalla sin arrastrar el estado global del panel de admin.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Badge, btn, btnPrimary, btnSecondary } from '@/components/ui/base'
import RondasSupervisionPanel from '@/components/rondas/RondasSupervisionPanel'
import styles from './CentroOperativoObjetivo.module.css'
import {
  cargarLegajoObjetivo, cargarRondasObjetivo, derivarEstadoObjetivo,
  indexarRegistrosPorTurno, turnoTieneEntrada, nombrePersona,
  presentacionSemaforo, fechaHoyLocal,
} from '@/lib/legajo-objetivo'
import type { LegajoObjetivo, RondaLegajo, TurnoLegajo } from '@/lib/legajo-objetivo'

const S = { btn, btnPrimary, btnSecondary }

// Mapeo temporal objetivo → URL rondas JWM.
// Indexado por nombre exacto del objetivo (case-sensitive).
// Reemplazar con tabla objetivo_integraciones cuando escale.
const JWM_RONDAS_URL: Record<string, string> = {
  'ACA':                'https://overseas.jwmyun.com/setup/dept',
  'Club Universitario': 'https://overseas.jwmyun.com/setup/dept',
  'PNC Remolques':      'https://overseas.jwmyun.com/setup/dept',
}

// ── CENTRO OPERATIVO DEL OBJETIVO ────────────────────────────────────
function CentroOperativoObjetivo({ objetivoId, onVolver, onNavigate, esAdmin, rolUsuario }: {
  objetivoId: string
  onVolver: () => void
  onNavigate?: (destino: string, filtro?: any) => void
  esAdmin?: boolean
  rolUsuario?: 'admin' | 'supervisor' | 'guardia' | 'vigilador'
}) {
  const hoy = fechaHoyLocal()

  // ── Datos del legajo ──
  const [datos, setDatos] = useState<LegajoObjetivo | null>(null)
  const [cargando, setCargando] = useState(true)
  const [rondasDirty, setRondasDirty] = useState(false)

  const recargar = useCallback(async () => {
    setCargando(true)
    setDatos(await cargarLegajoObjetivo(objetivoId, hoy))
    setCargando(false)
  }, [objetivoId, hoy])

  useEffect(() => { void recargar() }, [recargar])

  // ── Historial de rondas JWM ──
  const [historial, setHistorial] = useState<RondaLegajo[]>([])
  const [histDesde, setHistDesde] = useState(hoy)
  const [histHasta, setHistHasta] = useState(hoy)
  const [histLoading, setHistLoading] = useState(false)

  const cargarHistorial = async (desde: string, hasta: string) => {
    setHistLoading(true)
    const { rondas } = await cargarRondasObjetivo(objetivoId, desde, hasta)
    setHistorial(rondas)
    setHistLoading(false)
  }

  useEffect(() => { void cargarHistorial(histDesde, histHasta) }, [objetivoId])

  // ── Modal importación de rondas JWM ──
  const [showModal, setShowModal] = useState(false)
  const [modalStep, setModalStep] = useState<'form'|'loading'|'done'|'error'>('form')
  const [fechaDesde, setFechaDesde] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return d.toLocaleDateString('sv-SE')
  })
  const [fechaHasta, setFechaHasta] = useState(hoy)
  const [jwmToken, setJwmToken] = useState('')
  const [modalMsg, setModalMsg] = useState('')
  const [modalCount, setModalCount] = useState(0)

  const importarRondas = async () => {
    setModalStep('loading')
    setModalMsg('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch('/api/jwm/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ token: jwmToken, fecha_desde: fechaDesde, fecha_hasta: fechaHasta, objetivo_id: objetivoId }),
      })
      const json = await resp.json()
      if (!resp.ok) {
        setModalStep('error')
        setModalMsg(json?.message ?? json?.error ?? 'Error desconocido')
        return
      }
      setModalCount(json.filas_nuevas ?? 0)
      setModalStep('done')
    } catch (e: any) {
      setModalStep('error')
      setModalMsg(e?.message ?? 'Error de red')
    }
  }

  const cerrarModal = () => {
    setShowModal(false)
    setModalStep('form')
    setJwmToken(''); setModalMsg('')
  }

  // Todas las derivaciones salen del servicio: no se recalcula nada acá.
  const objetivo          = datos?.objetivo ?? null
  const puestos           = datos?.puestos ?? []
  const turnosHoy         = datos?.turnosHoy ?? []
  const registros         = datos?.registros ?? []
  const ultimaSupervision = datos?.ultimaSupervision ?? null
  const novedadesObj      = datos?.novedadesActivas ?? []
  const personas          = datos?.personas ?? []

  const { turnosActivos, turnosProximos, turnosSinFichar, alertas, semaforo } =
    derivarEstadoObjetivo(turnosHoy, registros, novedadesObj)

  const { color: semaforoColor, label: semaforoLabel } = presentacionSemaforo(semaforo)

  const registrosPorTurno = indexarRegistrosPorTurno(registros)
  const tieneEntrada = (t: TurnoLegajo) => turnoTieneEntrada(t.id, registrosPorTurno)
  const estaSinFichar = (t: TurnoLegajo) => turnosSinFichar.some(x => x.id === t.id)

  const nombreGuardia = (id?: string | null) => nombrePersona(id, personas)
  const ejecutarConConfirmacionRondas = (accion: () => void) => {
    if (
      !rondasDirty ||
      window.confirm('Hay cambios de rondas sin guardar. Si continuás podrían perderse. ¿Querés continuar?')
    ) {
      accion()
    }
  }

  if (cargando && !datos) {
    return (
      <div className={styles.root} style={{ padding: 16, color: '#64748b' }}>
        <button
          type="button"
          style={{ ...S.btn, ...S.btnSecondary, minHeight:44, padding:'6px 12px', fontSize:12, marginBottom:16 }}
          onClick={onVolver}
        >
          ← Volver
        </button>
        <div>Cargando objetivo…</div>
      </div>
    )
  }

  if (!objetivo) {
    return (
      <div className={styles.root} style={{ padding: 16 }}>
        <button type="button" style={{ ...S.btn, ...S.btnSecondary, minHeight:44, padding:'6px 12px', fontSize:12 }} onClick={() => ejecutarConConfirmacionRondas(onVolver)}>← Volver</button>
        <div style={{ color: '#ef4444', marginTop: 16 }}>
          {datos?.error || 'No se pudo cargar el objetivo.'}
        </div>
      </div>
    )
  }
  const hora = (h: string) => h?.slice(0, 5) || '—'
  const fechaCorta = (iso: string) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
  }

  const card: React.CSSProperties = { background:'#111827', border:'1px solid #1e2d42', borderRadius:12, padding:16, marginBottom:16 }
  const secTitle: React.CSSProperties = { fontFamily:'Syne,sans-serif', fontWeight:700, fontSize:14, color:'#e2e8f0', marginBottom:10, textTransform:'uppercase', letterSpacing:1 }
  const pill = (color: string, text: string) => (
    <span style={{ background: color + '22', color, border:`1px solid ${color}44`, borderRadius:6, padding:'2px 8px', fontSize:11, fontWeight:600 }}>{text}</span>
  )

  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.header} style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
        <button type="button" style={{ ...S.btn, ...S.btnSecondary, minHeight:44, padding:'6px 12px', fontSize:12 }} onClick={onVolver}>← Volver</button>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:'Syne,sans-serif', fontSize:22, fontWeight:800, color:'#f8fafc', overflowWrap:'anywhere' }}>{objetivo.nombre}</div>
          <div style={{ color:'#94a3b8', fontSize:13 }}>{objetivo.cliente || '—'} {objetivo.direccion ? `· ${objetivo.direccion}` : ''}</div>
        </div>
        <div className={styles.status} style={{ textAlign:'right' }}>
          <div style={{ width:14, height:14, borderRadius:'50%', background:semaforoColor, display:'inline-block', marginRight:6, boxShadow:`0 0 8px ${semaforoColor}` }} />
          <span style={{ fontFamily:'Syne,sans-serif', fontWeight:700, color:semaforoColor, fontSize:15 }}>{semaforoLabel}</span>
        </div>
      </div>

      {/* Estado general */}
      <div className={styles.summaryGrid} style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(130px,1fr))', gap:10, marginBottom:16 }}>
        {[
          { label:'Turnos hoy',   value:turnosHoy.length,   color:'#3b82f6', anchor:'sec-turnos' },
          { label:'Activos ahora',value:turnosActivos.length,color:'#10b981', anchor:'sec-turnos' },
          { label:'Sin fichar',   value:turnosSinFichar.length, color:'#f59e0b', anchor:'sec-turnos' },
          { label:'Alertas',      value:alertas.length,     color: alertas.length > 0 ? '#ef4444' : '#64748b', anchor:'sec-alertas' },
          { label:'Novedades',    value:novedadesObj.length, color: novedadesObj.length > 0 ? '#f59e0b' : '#64748b', anchor:'sec-alertas' },
          { label:'Checkpoints JWM hoy', value:historial.length, color:'#a78bfa', anchor:'sec-historial' },
        ].map(({ label, value, color, anchor }) => (
          <div
            key={label}
            onClick={() => ejecutarConConfirmacionRondas(() => document.getElementById(anchor)?.scrollIntoView({ behavior:'smooth', block:'start' }))}
            style={{ background:'#1a2235', border:'1px solid #1e2d42', borderRadius:8, padding:'10px 14px', cursor:'pointer', transition:'border-color 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#334155')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = '#1e2d42')}
          >
            <div style={{ fontSize:10, color:'#64748b', textTransform:'uppercase' as const, letterSpacing:1, marginBottom:4 }}>{label}</div>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:22, fontWeight:800, color }}>{value}</div>
            <div style={{ fontSize:10, color:'#334155', marginTop:4 }}>Ver detalle ↓</div>
          </div>
        ))}
      </div>

      {/* Puestos */}
      {puestos.length > 0 && (
        <div style={card}>
          <div style={secTitle}>Puestos</div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {puestos.map((p: any) => (
              <div key={p.id} style={{ background:'#1a2235', border:'1px solid #1e2d42', borderRadius:8, padding:'8px 14px', fontSize:13 }}>
                <span style={{ color:'#e2e8f0', fontWeight:600 }}>{p.nombre}</span>
                {p.orden && <span style={{ color:'#475569', fontSize:11, marginLeft:6 }}>#{p.orden}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Turnos del día */}
      <div id="sec-turnos" style={card}>
        <div style={secTitle}>Turnos hoy</div>
        {turnosHoy.length === 0 ? (
          <div style={{ color:'#64748b', fontSize:13 }}>Sin turnos programados para hoy.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {turnosHoy.map((t: TurnoLegajo) => {
              const regs = registrosPorTurno.get(t.id) || []
              const reg = regs.find((r: any) => r.hora_entrada_real) || regs[0]
              const activo = turnosActivos.some((x: TurnoLegajo) => x.id === t.id)
              const sinFichar = estaSinFichar(t)
              const estadoColor = t.estado === 'descubierto' || !t.guardia_id ? '#ef4444' : activo && !reg?.hora_salida_real ? '#10b981' : sinFichar ? '#f59e0b' : '#64748b'
              return (
                <div className={styles.turnRow} key={t.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 12px', background:'#0f172a', borderRadius:8, borderLeft:`3px solid ${estadoColor}` }}>
                  <div className={styles.turnTime} style={{ minWidth:90, fontFamily:'Syne,sans-serif', fontWeight:700, fontSize:13, color:'#e2e8f0' }}>{hora(t.hora_inicio)} – {hora(t.hora_fin)}</div>
                  <div style={{ flex:1, fontSize:13, color:'#94a3b8' }}>{nombreGuardia(t.guardia_id)}</div>
                  <div className={styles.turnStatus} style={{ fontSize:11 }}>
                    {!t.guardia_id ? pill('#ef4444','Sin guardia')
                      : t.estado === 'descubierto' ? pill('#ef4444','Descubierto')
                      : reg?.hora_entrada_real && !reg?.hora_salida_real ? pill('#10b981','En turno')
                      : reg?.hora_entrada_real && reg?.hora_salida_real ? pill('#64748b','Completado')
                      : sinFichar ? pill('#f59e0b','Sin fichar')
                      : pill('#3b82f6','Programado')}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {turnosProximos.length > 0 && (
          <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid #1e2d42' }}>
            <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:1, marginBottom:8 }}>Próximos</div>
            {turnosProximos.map((t: TurnoLegajo) => (
              <div className={styles.upcomingRow} key={t.id} style={{ display:'flex', gap:12, padding:'6px 0', borderBottom:'1px solid #0f172a', fontSize:13, color:'#94a3b8' }}>
                <span style={{ fontFamily:'Syne,sans-serif', fontWeight:700, color:'#e2e8f0', minWidth:90 }}>{hora(t.hora_inicio)} – {hora(t.hora_fin)}</span>
                <span>{nombreGuardia(t.guardia_id)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Última supervisión */}
      <div style={card}>
        <div style={secTitle}>Última supervisión</div>
        {!ultimaSupervision ? (
          <div style={{ color:'#64748b', fontSize:13 }}>Sin supervisiones registradas.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            <div style={{ display:'flex', gap:12, alignItems:'center' }}>
              <div style={{ fontSize:13, color:'#94a3b8' }}>{fechaCorta(ultimaSupervision.created_at)}</div>
              <Badge type={ultimaSupervision.estado}>{ultimaSupervision.estado?.replace('_',' ') || '—'}</Badge>
            </div>
            <div style={{ fontSize:13, color:'#64748b' }}>
              Supervisor: <span style={{ color:'#e2e8f0' }}>{ultimaSupervision.supervisor?.apellido}, {ultimaSupervision.supervisor?.nombre}</span>
            </div>
            {ultimaSupervision.observaciones && (
              <div style={{ fontSize:12, color:'#94a3b8', background:'#0f172a', borderRadius:6, padding:'6px 10px', marginTop:4 }}>{ultimaSupervision.observaciones}</div>
            )}
          </div>
        )}
      </div>

      {/* Alertas y novedades */}
      {(alertas.length > 0 || novedadesObj.length > 0) && (
        <div id="sec-alertas" style={card}>
          <div style={secTitle}>Alertas y novedades activas</div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {novedadesObj.slice(0, 5).map((n: any) => (
              <div key={n.id} style={{ display:'flex', gap:10, alignItems:'flex-start', padding:'8px 10px', background:'#0f172a', borderRadius:8, borderLeft:`3px solid ${n.prioridad==='urgente'?'#ef4444':n.prioridad==='importante'?'#f59e0b':'#3b82f6'}` }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, color:'#e2e8f0' }}>{n.descripcion}</div>
                  <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>{n.tipo} · {fechaCorta(n.created_at)}</div>
                </div>
                <Badge type={n.prioridad}>{n.prioridad}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Configuración nativa, independiente del historial importado de JWM. */}
      {(rolUsuario === 'admin' || rolUsuario === 'supervisor') && (
        <div id="sec-rondas-nativas" style={card}>
          {objetivo.zona_id === null && (
            <div style={{ color:'#fbbf24', background:'rgba(245,158,11,.1)', border:'1px solid rgba(245,158,11,.35)', borderRadius:8, padding:10, marginBottom:12, fontSize:13 }}>
              Objetivo sin zona operativa asignada.
            </div>
          )}
          <RondasSupervisionPanel
            objetivoId={objetivoId}
            centroObjetivo={
              objetivo.lat !== null && objetivo.lng !== null
                ? [objetivo.lat, objetivo.lng]
                : null
            }
            onRondasDirtyChange={setRondasDirty}
          />
        </div>
      )}

      {/* Integraciones — Rondas y Cámaras */}
      {JWM_RONDAS_URL[objetivo.nombre] && (
        <div style={card}>
          <div style={secTitle}>Integraciones</div>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            <a
              href={JWM_RONDAS_URL[objetivo.nombre]}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...S.btn, ...S.btnSecondary, fontSize:13, textDecoration:'none', display:'inline-flex', alignItems:'center', gap:6 }}
            >
              🔄 Rondas JWM
            </a>
            {esAdmin && (
              <button
                style={{ ...S.btn, ...S.btnSecondary, fontSize:13 }}
                onClick={() => { setShowModal(true); setModalStep('form') }}
              >
                📥 Recopilar datos de rondas
              </button>
            )}
            <button style={{ ...S.btn, ...S.btnSecondary, fontSize:13, opacity:0.45, cursor:'not-allowed' }} disabled>
              📷 Cámaras <span style={{ fontSize:10, color:'#475569' }}>(próximamente)</span>
            </button>
          </div>
        </div>
      )}

      {/* Historial legado de checkpoints JWM */}
      {JWM_RONDAS_URL[objetivo.nombre] && (
        <div id="sec-historial" style={card}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10, marginBottom:12 }}>
            <div style={secTitle}>Historial JWM</div>
            <div className={styles.historyControls} style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              <input className={styles.dateInput} type="date" value={histDesde} onChange={e => setHistDesde(e.target.value)}
                style={{ background:'#0f172a', border:'1px solid #334155', borderRadius:6, padding:'5px 8px', color:'#e2e8f0', fontSize:12 }} />
              <span style={{ color:'#475569', fontSize:12 }}>→</span>
              <input className={styles.dateInput} type="date" value={histHasta} onChange={e => setHistHasta(e.target.value)}
                style={{ background:'#0f172a', border:'1px solid #334155', borderRadius:6, padding:'5px 8px', color:'#e2e8f0', fontSize:12 }} />
              <button
                style={{ ...S.btn, ...S.btnSecondary, fontSize:12, padding:'5px 10px' }}
                onClick={() => cargarHistorial(histDesde, histHasta)}
              >
                Buscar
              </button>
            </div>
          </div>

          {histLoading ? (
            <div style={{ color:'#475569', fontSize:13 }}>Cargando…</div>
          ) : historial.length === 0 ? (
            <div style={{ color:'#475569', fontSize:13 }}>Sin controles importados para el período seleccionado.</div>
          ) : (
            <div>
              <div style={{ fontSize:11, color:'#64748b', marginBottom:8 }}>{historial.length} controles</div>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ borderBottom:'1px solid #1e2d42' }}>
                      {['Fecha y hora','Checkpoint','Dispositivo','Estado','Observación'].map(h => (
                        <th key={h} style={{ padding:'6px 10px', textAlign:'left', color:'#64748b', fontWeight:600, fontSize:11, textTransform:'uppercase', letterSpacing:0.5, whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {historial.map((r: any) => (
                      <tr key={r.id} style={{ borderBottom:'1px solid #0f172a' }}>
                        <td style={{ padding:'7px 10px', color:'#93c5fd', whiteSpace:'nowrap', fontFamily:'Syne,sans-serif', fontWeight:600 }}>
                          {new Date(r.fecha_hora).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })}
                        </td>
                        <td style={{ padding:'7px 10px', color:'#e2e8f0' }}>{r.checkpoint || '—'}</td>
                        <td style={{ padding:'7px 10px', color:'#94a3b8', whiteSpace:'nowrap' }}>{r.dispositivo_id || '—'}</td>
                        <td style={{ padding:'7px 10px' }}>
                          <span style={{ background:'#052e1688', color:'#4ade80', border:'1px solid #166534', borderRadius:4, padding:'2px 7px', fontSize:11 }}>
                            {r.estado || 'ok'}
                          </span>
                        </td>
                        <td style={{ padding:'7px 10px', color:'#64748b', fontSize:11 }}>
                          {r.raw_data?.observacion || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal importación de rondas JWM */}
      {showModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
          <div style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:14, padding:24, width:'100%', maxWidth:420 }}>
            <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, fontSize:16, color:'#f8fafc', marginBottom:16 }}>
              Importar historial de rondas JWM
            </div>

            {modalStep === 'form' && (
              <>
                <div className={styles.modalDates} style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
                  <div>
                    <div style={{ fontSize:11, color:'#64748b', marginBottom:4 }}>Desde</div>
                    <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
                      style={{ width:'100%', background:'#0f172a', border:'1px solid #334155', borderRadius:6, padding:'7px 10px', color:'#e2e8f0', fontSize:13 }} />
                  </div>
                  <div>
                    <div style={{ fontSize:11, color:'#64748b', marginBottom:4 }}>Hasta</div>
                    <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
                      style={{ width:'100%', background:'#0f172a', border:'1px solid #334155', borderRadius:6, padding:'7px 10px', color:'#e2e8f0', fontSize:13 }} />
                  </div>
                </div>
                <div style={{ marginBottom:6 }}>
                  <div style={{ fontSize:11, color:'#64748b', marginBottom:4 }}>Token JWM</div>
                  <input type="password" value={jwmToken} onChange={e => setJwmToken(e.target.value)}
                    placeholder="eyJ0eXAiOiJKV1Qi..."
                    style={{ width:'100%', background:'#0f172a', border:'1px solid #334155', borderRadius:6, padding:'7px 10px', color:'#e2e8f0', fontSize:13 }} />
                </div>
                <div style={{ fontSize:11, color:'#475569', marginBottom:16, lineHeight:1.6 }}>
                  Obtené el token en JWM: F12 → Application → Local Storage → <strong style={{color:'#64748b'}}>token</strong>.
                </div>
                <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                  <button style={{ ...S.btn, ...S.btnSecondary, fontSize:13 }} onClick={cerrarModal}>Cancelar</button>
                  <button style={{ ...S.btn, ...S.btnPrimary, fontSize:13 }} onClick={importarRondas} disabled={!jwmToken}>
                    Importar
                  </button>
                </div>
              </>
            )}

            {modalStep === 'loading' && (
              <div style={{ textAlign:'center', padding:'24px 0', color:'#94a3b8', fontSize:14 }}>
                ⏳ Importando rondas desde JWM…
              </div>
            )}

            {modalStep === 'done' && (
              <>
                <div style={{ background:'#052e16', border:'1px solid #166534', borderRadius:8, padding:14, marginBottom:16, textAlign:'center' }}>
                  <div style={{ fontSize:22, marginBottom:4 }}>✅</div>
                  <div style={{ fontFamily:'Syne,sans-serif', fontWeight:700, fontSize:15, color:'#4ade80' }}>
                    {modalCount} {modalCount === 1 ? 'control nuevo importado' : 'controles nuevos importados'}
                  </div>
                  <div style={{ fontSize:12, color:'#64748b', marginTop:4 }}>Del {fechaDesde} al {fechaHasta}</div>
                </div>
                <div style={{ display:'flex', justifyContent:'flex-end' }}>
                  <button style={{ ...S.btn, ...S.btnPrimary, fontSize:13 }} onClick={cerrarModal}>Cerrar</button>
                </div>
              </>
            )}

            {modalStep === 'error' && (
              <>
                <div style={{ background:'#1c1917', border:'1px solid #44403c', borderRadius:8, padding:12, marginBottom:16, fontSize:13, color:'#f87171' }}>
                  {modalMsg || 'Error al importar datos.'}
                </div>
                <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                  <button style={{ ...S.btn, ...S.btnSecondary, fontSize:13 }} onClick={() => setModalStep('form')}>Reintentar</button>
                  <button style={{ ...S.btn, ...S.btnSecondary, fontSize:13 }} onClick={cerrarModal}>Cerrar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Admin: accesos rápidos */}
      {esAdmin && (
        <div style={card}>
          <div style={secTitle}>Accesos rápidos</div>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            <button
              style={{ ...S.btn, ...S.btnSecondary, fontSize:13 }}
              onClick={() => ejecutarConConfirmacionRondas(() => onNavigate?.('reportes', { tipo:'objetivo', objetivoId }))}
            >
              📊 Reportes
            </button>
            <button style={{ ...S.btn, ...S.btnSecondary, fontSize:13, opacity:0.45, cursor:'not-allowed' }} disabled>
              📋 Protocolos <span style={{ fontSize:10, color:'#475569' }}>(próximamente)</span>
            </button>
            <button style={{ ...S.btn, ...S.btnSecondary, fontSize:13, opacity:0.45, cursor:'not-allowed' }} disabled>
              📁 Documentación <span style={{ fontSize:10, color:'#475569' }}>(próximamente)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default CentroOperativoObjetivo
