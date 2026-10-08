'use client'

/**
 * components/supervisiones/SalidasAnticipadasPanel.tsx
 *
 * Bandeja de salidas anticipadas: lo que el sistema detectó y lo que
 * Supervisión decidió. Se usa en Administración y en la app móvil de
 * Supervisión (pestaña Salidas): es el mismo componente.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 * Auditoría 08/10/2026: en septiembre hubo 503 salidas antes del fin
 * programado, de 42 personas, y ninguna tenía efecto. Orden de Gerencia: la
 * salida injustificada confirmada limita la nota final a 4 y el abandono
 * comprobado a 2, para todos por igual. El sistema NO declara injustificado
 * nada: sólo detecta. Esta pantalla es donde una persona con nombre decide, y
 * al confirmar, la evaluación del período se recalcula sola en la base.
 *
 * ── Por qué agrupa por persona ───────────────────────────────────────────────
 * Son ~500 jornadas por mes y ~40 personas. Nadie revisa 500 filas; se mira el
 * patrón de cada uno —"21 de 21 jornadas, siempre 5 minutos antes"— y se
 * resuelve en bloque con un mismo motivo.
 *
 * ── Lo que NO hace ───────────────────────────────────────────────────────────
 * No decide permisos: la base valida alcance (zona del supervisor) y quién
 * puede confirmar un abandono. Los botones sólo evitan ofrecer lo que la base
 * va a rechazar.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { etiquetaMes, mesPorDefecto, mesesDisponibles } from '@/lib/desempeno-datos'
import { salidaAnticipadaVigente } from '@/lib/evaluacion-final'
import {
  ETIQUETA_ESTADO_SALIDA, ETIQUETA_SITUACION_RELEVO, MOTIVOS_POR_ESTADO, MOTIVO_MINIMO,
  agruparPorPersona, textoAnticipacion,
  type EstadoResolucion, type GrupoPersona, type SalidaAnticipada,
} from '@/lib/salidas-anticipadas'
import {
  cargarHistorialSalida, cargarSalidasDelMes, resolverSalidas, type CambioSalida,
} from '@/lib/salidas-anticipadas-datos'

const C = {
  bg: '#0f172a', borde: '#1e293b', texto: '#e2e8f0', tenue: '#94a3b8', apagado: '#64748b',
  amarillo: '#f59e0b', rojo: '#ef4444', verde: '#10b981', celeste: '#38bdf8',
}

const COLOR_ESTADO: Record<string, string> = {
  detectada: C.amarillo, autorizada: C.verde, injustificada: C.rojo,
  abandono: '#b91c1c', descartada: C.apagado, sin_efecto: C.apagado,
}

const caja: React.CSSProperties = {
  minWidth: 0, boxSizing: 'border-box',
  background: C.bg, border: `1px solid ${C.borde}`, borderRadius: 12, padding: 14,
}
const campo: React.CSSProperties = {
  background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: C.texto,
  padding: '8px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box', minWidth: 0, maxWidth: '100%',
}
const boton = (color: string, deshabilitado = false): React.CSSProperties => ({
  background: deshabilitado ? '#1e293b' : `${color}22`, color: deshabilitado ? C.apagado : color,
  border: `1px solid ${deshabilitado ? '#334155' : `${color}66`}`, borderRadius: 8,
  padding: '8px 12px', fontSize: 13, fontWeight: 700, cursor: deshabilitado ? 'not-allowed' : 'pointer',
})
const grilla: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)' }

const hora = (ts: string | null | undefined) => (ts ? ts.slice(11, 16) : '—')
const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`
const fechaHora = (ts: string) => `${ts.slice(8, 10)}/${ts.slice(5, 7)} ${ts.slice(11, 16)}`

export default function SalidasAnticipadasPanel() {
  const [mes, setMes] = useState(mesPorDefecto())
  const [salidas, setSalidas] = useState<SalidaAnticipada[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [soloPendientes, setSoloPendientes] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [objetivo, setObjetivo] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [aviso, setAviso] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await cargarSalidasDelMes(mes)
    setSalidas(r.data)
    setError(r.error ?? '')
    setSeleccion(new Set())
    setCargando(false)
  }, [mes])

  useEffect(() => { void cargar() }, [cargar])

  const objetivos = useMemo(
    () => Array.from(new Set(salidas.map(s => s.objetivo).filter((o): o is string => Boolean(o)))).sort(),
    [salidas],
  )

  const grupos = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    const visibles = objetivo ? salidas.filter(s => s.objetivo === objetivo) : salidas
    return agruparPorPersona(visibles).filter(g =>
      (!soloPendientes || g.pendientes > 0)
      && (!q || g.empleado.toLowerCase().includes(q) || g.objetivos.some(o => o.toLowerCase().includes(q))))
  }, [salidas, soloPendientes, busqueda, objetivo])

  const total = useMemo(() => {
    const base = objetivo ? salidas.filter(s => s.objetivo === objetivo) : salidas
    return {
      jornadas: base.length,
      personas: new Set(base.map(s => s.empleado_id)).size,
      pendientes: base.filter(s => s.estado === 'detectada').length,
      injustificadas: base.filter(s => s.estado === 'injustificada').length,
      abandonos: base.filter(s => s.estado === 'abandono').length,
      autorizadas: base.filter(s => s.estado === 'autorizada').length,
    }
  }, [salidas, objetivo])

  const rige = salidaAnticipadaVigente(mes)

  return (
    <div style={{ ...grilla, gap: 12 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.texto }}>Salidas anticipadas</div>
        <div style={{ fontSize: 13, color: C.tenue, marginTop: 4, lineHeight: 1.5 }}>
          Toda salida registrada antes del horario de finalización del servicio, aunque sea
          por un minuto. Llegar antes no autoriza a retirarse antes, la llegada del relevo
          tampoco, y la tolerancia de 15 minutos no es un permiso. Lo detectado <b>no tiene
          efecto en la nota</b> hasta que alguien habilitado lo resuelva.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={mes} onChange={e => { setMes(e.target.value); setObjetivo('') }} style={{ ...campo, flex: '1 1 160px', width: 'auto' }}>
          {mesesDisponibles('2026-09').map(m => <option key={m} value={m}>{etiquetaMes(m)}</option>)}
        </select>
        <select value={objetivo} onChange={e => setObjetivo(e.target.value)} style={{ ...campo, flex: '1 1 160px', width: 'auto' }}>
          <option value="">Todos los objetivos</option>
          {objetivos.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <input
          value={busqueda} onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar vigilador" style={{ ...campo, flex: '2 1 180px', width: 'auto' }}
        />
        <label style={{ fontSize: 13, color: C.tenue, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={soloPendientes} onChange={e => setSoloPendientes(e.target.checked)} />
          Sólo con pendientes
        </label>
      </div>

      <div style={{ ...caja, fontSize: 13, color: rige ? '#fca5a5' : C.tenue }}>
        {rige
          ? `Al confirmar una salida injustificada, la nota final de ${etiquetaMes(mes)} queda limitada a 4 (un abandono comprobado, a 2) y la evaluación se actualiza sola. Autorizar o descartar no cambia la nota. No modifica horas ni sueldos.`
          : `En ${etiquetaMes(mes)} la regla no rige: lo que se resuelva queda documentado pero no cambia ninguna nota.`}
      </div>

      {aviso && <div style={{ ...caja, fontSize: 13, color: C.verde }}>{aviso}</div>}

      {error && (
        <div style={{ ...caja, color: '#fca5a5', borderColor: 'rgba(239,68,68,.35)' }}>
          No se pudieron leer las salidas anticipadas: {error}
        </div>
      )}

      {!error && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
          {[
            ['Jornadas', total.jornadas, C.texto], ['Personas', total.personas, C.texto],
            ['Pendientes', total.pendientes, C.amarillo], ['Injustificadas', total.injustificadas, C.rojo],
            ['Abandonos', total.abandonos, '#f87171'], ['Autorizadas', total.autorizadas, C.verde],
          ].map(([t, n, c]) => (
            <div key={String(t)} style={{ ...caja, padding: '8px 12px' }}>
              <div style={{ fontSize: 11, color: C.apagado }}>{t}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: String(c) }}>{n}</div>
            </div>
          ))}
        </div>
      )}

      {cargando ? (
        <div style={{ ...caja, color: C.tenue }}>Cargando…</div>
      ) : grupos.length === 0 && !error ? (
        <div style={{ ...caja, color: C.tenue }}>No hay salidas anticipadas para mostrar en {etiquetaMes(mes)}.</div>
      ) : grupos.map(g => (
        <GrupoSalidas
          key={g.empleadoId}
          grupo={g}
          rige={rige}
          abierto={abierto === g.empleadoId}
          onAbrir={() => setAbierto(abierto === g.empleadoId ? null : g.empleadoId)}
          seleccion={seleccion}
          setSeleccion={setSeleccion}
          onCambio={async (texto) => { setAviso(texto); await cargar() }}
        />
      ))}
    </div>
  )
}

function GrupoSalidas({
  grupo, rige, abierto, onAbrir, seleccion, setSeleccion, onCambio,
}: {
  grupo: GrupoPersona
  rige: boolean
  abierto: boolean
  onAbrir: () => void
  seleccion: Set<string>
  setSeleccion: (s: Set<string>) => void
  onCambio: (aviso: string) => Promise<void>
}) {
  const resolubles = grupo.salidas.filter(s => s.puede_resolver)
  const elegidas = grupo.salidas.filter(s => seleccion.has(s.id))
  const todasElegidas = resolubles.length > 0 && resolubles.every(s => seleccion.has(s.id))
  const [historial, setHistorial] = useState<Record<string, CambioSalida[] | 'cargando' | string>>({})

  const alternar = (id: string) => {
    const n = new Set(seleccion)
    if (n.has(id)) n.delete(id); else n.add(id)
    setSeleccion(n)
  }
  const alternarTodas = () => {
    const n = new Set(seleccion)
    if (todasElegidas) resolubles.forEach(s => n.delete(s.id))
    else resolubles.forEach(s => n.add(s.id))
    setSeleccion(n)
  }
  const verHistorial = async (id: string) => {
    if (historial[id]) { setHistorial(h => { const n = { ...h }; delete n[id]; return n }); return }
    setHistorial(h => ({ ...h, [id]: 'cargando' }))
    const r = await cargarHistorialSalida(id)
    setHistorial(h => ({ ...h, [id]: r.error ? `No se pudo leer el historial: ${r.error}` : r.data }))
  }

  const segundos = grupo.salidas.map(s => s.segundos_antes)
  const promedio = Math.round(segundos.reduce((a, b) => a + b, 0) / Math.max(1, segundos.length))

  return (
    <div style={caja}>
      <div onClick={onAbrir} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.texto }}>{grupo.empleado}</div>
          <div style={{ fontSize: 12, color: C.tenue }}>
            {grupo.objetivos.join(' · ')} · {grupo.salidas.length} {grupo.salidas.length === 1 ? 'salida' : 'salidas'} antes
            del fin · promedio {textoAnticipacion(promedio)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
          {grupo.pendientes > 0 && <span style={{ color: C.amarillo }}>● {grupo.pendientes} pendientes</span>}
          {grupo.injustificadas > 0 && <span style={{ color: C.rojo }}>● {grupo.injustificadas} injustificadas</span>}
          {grupo.abandonos > 0 && <span style={{ color: '#f87171' }}>● {grupo.abandonos} abandonos</span>}
          {grupo.autorizadas > 0 && <span style={{ color: C.verde }}>● {grupo.autorizadas} autorizadas</span>}
          <span style={{ color: C.apagado }}>{abierto ? '▲' : '▼'}</span>
        </div>
      </div>

      {abierto && (
        <div style={{ ...grilla, marginTop: 12, gap: 10 }}>
          {resolubles.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: C.tenue }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={todasElegidas} onChange={alternarTodas} />
                Seleccionar todas
              </label>
              {/* Las de segundos se pueden querer revisar aparte. */}
              <button
                onClick={() => {
                  const n = new Set(seleccion)
                  resolubles.forEach(s => { if (s.estado === 'detectada' && s.segundos_antes >= 60) n.add(s.id); else n.delete(s.id) })
                  setSeleccion(n)
                }}
                style={{ ...boton(C.celeste), padding: '4px 8px', fontSize: 12 }}
              >
                Pendientes de 1 min o más
              </button>
            </div>
          )}

          {/* Tarjetas y no tabla: tiene que leerse en el celular del supervisor. */}
          <div style={{ ...grilla, gap: 6 }}>
            {grupo.salidas.map(s => {
              const h = historial[s.id]
              return (
                <div key={s.id} style={{
                  padding: '8px 10px', borderRadius: 8, minWidth: 0,
                  border: `1px solid ${seleccion.has(s.id) ? '#38bdf855' : C.borde}`,
                  background: seleccion.has(s.id) ? '#38bdf811' : 'transparent', fontSize: 13, color: C.texto,
                }}>
                  <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: s.puede_resolver ? 'pointer' : 'default' }}>
                    <input
                      type="checkbox" disabled={!s.puede_resolver}
                      checked={seleccion.has(s.id)} onChange={() => alternar(s.id)}
                      style={{ marginTop: 3, visibility: s.puede_resolver ? 'visible' : 'hidden' }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                        <span><b>{fechaCorta(s.fecha)}</b> · {s.objetivo ?? '—'}</span>
                        <span style={{ color: COLOR_ESTADO[s.estado] ?? C.tenue, fontWeight: 700, fontSize: 12 }}>
                          {ETIQUETA_ESTADO_SALIDA[s.estado]}
                        </span>
                      </div>
                      <div style={{ marginTop: 2 }}>
                        Programado {hora(s.inicio_programado)}–{hora(s.fin_programado)}
                      </div>
                      <div>
                        Entró {hora(s.entrada_registrada)} · salió {hora(s.salida_registrada)} ·{' '}
                        <b>{textoAnticipacion(s.segundos_antes)} antes</b>
                      </div>
                      <div style={{ color: C.tenue, fontSize: 12, marginTop: 2 }}>
                        {ETIQUETA_SITUACION_RELEVO[s.situacion_relevo]}
                        {s.relevo ? ` · ${s.relevo}${s.relevo_entrada ? ` (${hora(s.relevo_entrada)})` : ''}` : ''}
                      </div>
                      {s.motivo && (
                        <div style={{ color: C.tenue, fontSize: 12, marginTop: 2 }}>
                          {s.motivo}
                          {s.resuelto_por_nombre ? ` — ${s.resuelto_por_nombre}` : ''}
                          {s.resuelto_at ? `, ${fechaHora(s.resuelto_at)}` : ''}
                        </div>
                      )}
                      {s.evidencia && (
                        <div style={{ color: C.tenue, fontSize: 12, marginTop: 2 }}>Evidencia: {s.evidencia}</div>
                      )}
                    </div>
                  </label>
                  <button
                    onClick={() => void verHistorial(s.id)}
                    style={{ background: 'none', border: 'none', color: C.celeste, fontSize: 12, padding: '4px 0 0 26px', cursor: 'pointer' }}
                  >
                    {h ? 'Ocultar historial' : 'Ver historial'}
                  </button>
                  {h && (
                    <div style={{ fontSize: 12, color: C.tenue, padding: '4px 0 0 26px' }}>
                      {h === 'cargando' ? 'Cargando…' : typeof h === 'string' ? h : h.map((c, i) => (
                        <div key={i} style={{ marginTop: 2 }}>
                          {fechaHora(c.registrado_at)} · {c.actor}:{' '}
                          {c.estado_anterior ? `${ETIQUETA_ESTADO_SALIDA[c.estado_anterior as keyof typeof ETIQUETA_ESTADO_SALIDA] ?? c.estado_anterior} → ` : ''}
                          {ETIQUETA_ESTADO_SALIDA[c.estado_nuevo as keyof typeof ETIQUETA_ESTADO_SALIDA] ?? c.estado_nuevo}
                          {c.motivo ? ` · ${c.motivo}` : ''}
                          {c.evidencia ? ` · Evidencia: ${c.evidencia}` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {elegidas.length > 0 && (
            <FormResolucion
              salidas={elegidas}
              rige={rige}
              onListo={async (texto) => { setSeleccion(new Set()); await onCambio(texto) }}
            />
          )}
        </div>
      )}
    </div>
  )
}

function FormResolucion({ salidas, rige, onListo }: {
  salidas: SalidaAnticipada[]
  rige: boolean
  onListo: (aviso: string) => Promise<void>
}) {
  const puedeAbandono = salidas.every(s => s.puede_abandono)
  const estados: EstadoResolucion[] = ['autorizada', 'injustificada', ...(puedeAbandono ? ['abandono' as const] : []), 'descartada', 'detectada']
  const [estado, setEstado] = useState<EstadoResolucion>('injustificada')
  const [codigo, setCodigo] = useState(MOTIVOS_POR_ESTADO.injustificada[0].codigo)
  const [motivo, setMotivo] = useState('')
  const [evidencia, setEvidencia] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  const valido = motivo.trim().length >= MOTIVO_MINIMO && Boolean(codigo)
  const afectaNota = rige && (estado === 'injustificada' || estado === 'abandono')

  const registrar = async () => {
    if (!valido) return
    const conf = window.confirm(
      `Vas a registrar ${salidas.length} ${salidas.length === 1 ? 'salida' : 'salidas'} como «${ETIQUETA_ESTADO_SALIDA[estado]}».\n\n`
      + 'Queda a tu nombre, con fecha y motivo, en el historial.'
      + (afectaNota ? `\n\nLa nota final de esta persona en el período quedará limitada a ${estado === 'abandono' ? 2 : 4} y su evaluación se actualizará automáticamente.` : '')
      + '\n\n¿Confirmás?',
    )
    if (!conf) return
    setEnviando(true)
    const r = await resolverSalidas(salidas.map(s => s.id), estado, codigo, motivo, evidencia || null)
    setEnviando(false)
    if (r.error) { setError(`No se registró: ${r.error}`); return }
    setError('')
    setMotivo(''); setEvidencia('')
    await onListo(
      `Registradas ${r.afectadas} ${r.afectadas === 1 ? 'salida' : 'salidas'} como «${ETIQUETA_ESTADO_SALIDA[estado]}».`
      + (rige ? ' Si el período ya tenía evaluación, se recalculó automáticamente.' : ''),
    )
  }

  return (
    <div style={{ ...caja, ...grilla, background: '#111827', gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: C.texto }}>
        Resolver {salidas.length} {salidas.length === 1 ? 'salida seleccionada' : 'salidas seleccionadas'}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select
          value={estado}
          onChange={e => {
            const v = e.target.value as EstadoResolucion
            setEstado(v); setCodigo(MOTIVOS_POR_ESTADO[v][0].codigo)
          }}
          style={{ ...campo, flex: '1 1 220px', width: 'auto' }}
        >
          {estados.map(e => <option key={e} value={e}>{e === 'detectada' ? 'Volver a pendiente' : ETIQUETA_ESTADO_SALIDA[e]}</option>)}
        </select>
        <select value={codigo} onChange={e => setCodigo(e.target.value)} style={{ ...campo, flex: '2 1 260px', width: 'auto' }}>
          {MOTIVOS_POR_ESTADO[estado].map(m => <option key={m.codigo} value={m.codigo}>{m.etiqueta}</option>)}
        </select>
      </div>
      {estado === 'abandono' && (
        <div style={{ fontSize: 12, color: '#fca5a5' }}>
          Abandono es sólo cuando está comprobado que dejó el puesto sin relevo. Una salida
          anticipada no es, por sí sola, un abandono.
        </div>
      )}
      {estado === 'autorizada' && (
        <div style={{ fontSize: 12, color: C.tenue }}>
          Indicá quién autorizó y cuándo. Que haya llegado antes, o que el relevo haya llegado
          antes, no es una autorización.
        </div>
      )}
      {estado === 'injustificada' && (
        <div style={{ fontSize: 12, color: C.tenue }}>
          Que no haya una autorización registrada no alcanza: confirmá sólo si verificaste que
          se retiró sin autorización.
        </div>
      )}
      <textarea
        value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
        placeholder="Motivo (obligatorio): qué pasó, quién autorizó o cómo se comprobó"
        style={campo}
      />
      <input
        value={evidencia} onChange={e => setEvidencia(e.target.value)}
        placeholder="Evidencia disponible (opcional): mensaje, novedad, llamado, testigo…"
        style={campo}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={registrar} disabled={!valido || enviando} style={boton(COLOR_ESTADO[estado] ?? C.celeste, !valido || enviando)}>
          {enviando ? 'Registrando…' : 'Registrar'}
        </button>
        {!valido && <span style={{ fontSize: 12, color: C.apagado }}>El motivo necesita al menos {MOTIVO_MINIMO} caracteres.</span>}
        {error && <span style={{ fontSize: 12, color: '#fca5a5' }}>{error}</span>}
      </div>
    </div>
  )
}
