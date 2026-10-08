'use client'

/**
 * components/supervisiones/SalidasAnticipadasPanel.tsx
 *
 * Bandeja de salidas anticipadas: lo que el sistema detectó y lo que
 * Supervisión decidió.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 * Auditoría 08/10/2026: en septiembre hubo 503 salidas antes del fin
 * programado, de 42 personas, y ninguna tenía efecto. Gerencia decidió que la
 * salida injustificada es una falta grave (tope 4) y el abandono sin relevo,
 * más grave todavía (tope 2). Pero el sistema NO puede declarar injustificado
 * nada: sólo detecta. Esta pantalla es donde una persona con nombre decide.
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
import {
  corregirCapa4, faltaPorAbandono, faltaPorSalidaAnticipada, salidaAnticipadaVigente,
} from '@/lib/evaluacion-final'
import {
  ETIQUETA_ESTADO_SALIDA, ETIQUETA_SITUACION_RELEVO, MOTIVOS_POR_ESTADO, MOTIVO_MINIMO,
  agruparPorPersona, textoAnticipacion,
  type EstadoResolucion, type GrupoPersona, type SalidaAnticipada,
} from '@/lib/salidas-anticipadas'
import {
  cargarEvaluacionPublicada, cargarSalidasDelMes, corregirEvaluacionPublicada, resolverSalidas,
  type EvaluacionPublicadaResumen,
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
  background: C.bg, border: `1px solid ${C.borde}`, borderRadius: 12, padding: 14,
}
const campo: React.CSSProperties = {
  background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: C.texto,
  padding: '8px 10px', fontSize: 13, width: '100%',
}
const boton = (color: string, deshabilitado = false): React.CSSProperties => ({
  background: deshabilitado ? '#1e293b' : `${color}22`, color: deshabilitado ? C.apagado : color,
  border: `1px solid ${deshabilitado ? '#334155' : `${color}66`}`, borderRadius: 8,
  padding: '8px 12px', fontSize: 13, fontWeight: 700, cursor: deshabilitado ? 'not-allowed' : 'pointer',
})

const hora = (ts: string | null) => (ts ? ts.slice(11, 16) : '—')
const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`

interface Props {
  /** Gerencia (o delegación vigente): habilita la corrección de evaluaciones publicadas. */
  esGerencia: boolean
}

export default function SalidasAnticipadasPanel({ esGerencia }: Props) {
  const [mes, setMes] = useState(mesPorDefecto())
  const [salidas, setSalidas] = useState<SalidaAnticipada[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [soloPendientes, setSoloPendientes] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await cargarSalidasDelMes(mes)
    setSalidas(r.data)
    setError(r.error ?? '')
    setSeleccion(new Set())
    setCargando(false)
  }, [mes])

  useEffect(() => { void cargar() }, [cargar])

  const grupos = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return agruparPorPersona(salidas).filter(g =>
      (!soloPendientes || g.pendientes > 0)
      && (!q || g.empleado.toLowerCase().includes(q) || g.objetivos.some(o => o.toLowerCase().includes(q))))
  }, [salidas, soloPendientes, busqueda])

  const total = useMemo(() => ({
    jornadas: salidas.length,
    personas: new Set(salidas.map(s => s.empleado_id)).size,
    pendientes: salidas.filter(s => s.estado === 'detectada').length,
    injustificadas: salidas.filter(s => s.estado === 'injustificada').length,
    abandonos: salidas.filter(s => s.estado === 'abandono').length,
    autorizadas: salidas.filter(s => s.estado === 'autorizada').length,
  }), [salidas])

  const rige = salidaAnticipadaVigente(mes)

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.texto }}>Salidas anticipadas</div>
        <div style={{ fontSize: 13, color: C.tenue, marginTop: 4, lineHeight: 1.5 }}>
          Toda salida registrada antes del horario de finalización del servicio, aunque sea
          por un minuto. Llegar antes no autoriza a retirarse antes y la tolerancia de 15
          minutos no es un permiso. Lo detectado <b>no tiene efecto en la nota</b> hasta que
          alguien lo resuelva.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={mes} onChange={e => setMes(e.target.value)} style={{ ...campo, flex: '1 1 170px', width: 'auto' }}>
          {mesesDisponibles('2026-08').map(m => <option key={m} value={m}>{etiquetaMes(m)}</option>)}
        </select>
        <input
          value={busqueda} onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar persona u objetivo" style={{ ...campo, flex: '2 1 200px', width: 'auto' }}
        />
        <label style={{ fontSize: 13, color: C.tenue, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={soloPendientes} onChange={e => setSoloPendientes(e.target.checked)} />
          Sólo con pendientes
        </label>
      </div>

      <div style={{ ...caja, fontSize: 13, color: rige ? '#fca5a5' : C.tenue }}>
        {rige
          ? `En ${etiquetaMes(mes)} la regla rige: cada salida confirmada como injustificada limita la nota final a 4, y un abandono comprobado a 2.`
          : `En ${etiquetaMes(mes)} la regla general todavía no rige: lo que se resuelva acá queda documentado, pero no cambia ninguna nota salvo una corrección individual expresa de Gerencia.`}
      </div>

      {error && (
        <div style={{ ...caja, color: '#fca5a5', borderColor: 'rgba(239,68,68,.35)' }}>
          No se pudieron leer las salidas anticipadas: {error}
        </div>
      )}

      {!error && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            ['Jornadas', total.jornadas, C.texto], ['Personas', total.personas, C.texto],
            ['Pendientes', total.pendientes, C.amarillo], ['Injustificadas', total.injustificadas, C.rojo],
            ['Abandonos', total.abandonos, '#f87171'], ['Autorizadas', total.autorizadas, C.verde],
          ].map(([t, n, c]) => (
            <div key={String(t)} style={{ ...caja, padding: '8px 12px', minWidth: 100 }}>
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
          mes={mes}
          abierto={abierto === g.empleadoId}
          onAbrir={() => setAbierto(abierto === g.empleadoId ? null : g.empleadoId)}
          seleccion={seleccion}
          setSeleccion={setSeleccion}
          esGerencia={esGerencia}
          onCambio={cargar}
        />
      ))}
    </div>
  )
}

function GrupoSalidas({
  grupo, mes, abierto, onAbrir, seleccion, setSeleccion, esGerencia, onCambio,
}: {
  grupo: GrupoPersona
  mes: string
  abierto: boolean
  onAbrir: () => void
  seleccion: Set<string>
  setSeleccion: (s: Set<string>) => void
  esGerencia: boolean
  onCambio: () => Promise<void>
}) {
  const resolubles = grupo.salidas.filter(s => s.puede_resolver)
  const elegidas = grupo.salidas.filter(s => seleccion.has(s.id))
  const todasElegidas = resolubles.length > 0 && resolubles.every(s => seleccion.has(s.id))

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

  const minutos = grupo.salidas.map(s => s.segundos_antes)
  const promedio = Math.round(minutos.reduce((a, b) => a + b, 0) / Math.max(1, minutos.length))

  return (
    <div style={caja}>
      <div onClick={onAbrir} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
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
        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          {resolubles.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: C.tenue }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={todasElegidas} onChange={alternarTodas} />
                Seleccionar todas
              </label>
              {/* Las de segundos se pueden querer dejar para revisión aparte
                  (decisión de Gerencia para MENA, septiembre 2026). */}
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
          <div style={{ display: 'grid', gap: 6 }}>
            {grupo.salidas.map(s => (
              <label key={s.id} style={{
                display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px',
                border: `1px solid ${seleccion.has(s.id) ? '#38bdf855' : C.borde}`, borderRadius: 8,
                background: seleccion.has(s.id) ? '#38bdf811' : 'transparent', fontSize: 13, color: C.texto,
                cursor: s.puede_resolver ? 'pointer' : 'default',
              }}>
                <input
                  type="checkbox" disabled={!s.puede_resolver}
                  checked={seleccion.has(s.id)} onChange={() => alternar(s.id)}
                  style={{ marginTop: 3, visibility: s.puede_resolver ? 'visible' : 'hidden' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <span>
                      <b>{fechaCorta(s.fecha)}</b> · {s.objetivo ?? '—'}
                    </span>
                    <span style={{ color: COLOR_ESTADO[s.estado] ?? C.tenue, fontWeight: 700, fontSize: 12 }}>
                      {ETIQUETA_ESTADO_SALIDA[s.estado]}
                    </span>
                  </div>
                  <div style={{ marginTop: 2 }}>
                    Fin {hora(s.fin_programado)} · salió {hora(s.salida_registrada)} ·{' '}
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
                      {s.resuelto_at ? `, ${s.resuelto_at.slice(8, 10)}/${s.resuelto_at.slice(5, 7)} ${s.resuelto_at.slice(11, 16)}` : ''}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>

          {elegidas.length > 0 && (
            <FormResolucion salidas={elegidas} onListo={async () => { setSeleccion(new Set()); await onCambio() }} />
          )}

          {esGerencia && (grupo.injustificadas > 0 || grupo.abandonos > 0) && (
            <CorreccionEvaluacion grupo={grupo} mes={mes} />
          )}
        </div>
      )}
    </div>
  )
}

function FormResolucion({ salidas, onListo }: { salidas: SalidaAnticipada[]; onListo: () => Promise<void> }) {
  const puedeAbandono = salidas.every(s => s.puede_abandono)
  const estados: EstadoResolucion[] = ['autorizada', 'injustificada', ...(puedeAbandono ? ['abandono' as const] : []), 'descartada', 'detectada']
  const [estado, setEstado] = useState<EstadoResolucion>('injustificada')
  const [codigo, setCodigo] = useState(MOTIVOS_POR_ESTADO.injustificada[0].codigo)
  const [motivo, setMotivo] = useState('')
  const [evidencia, setEvidencia] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState('')

  const valido = motivo.trim().length >= MOTIVO_MINIMO && Boolean(codigo)

  const registrar = async () => {
    if (!valido) return
    const conf = window.confirm(
      `Vas a registrar ${salidas.length} ${salidas.length === 1 ? 'salida' : 'salidas'} como «${ETIQUETA_ESTADO_SALIDA[estado]}».\n\n`
      + 'Queda a tu nombre, con fecha y motivo, en el historial. ¿Confirmás?',
    )
    if (!conf) return
    setEnviando(true)
    const r = await resolverSalidas(salidas.map(s => s.id), estado, codigo, motivo, evidencia || null)
    setEnviando(false)
    if (r.error) { setAviso(`No se registró: ${r.error}`); return }
    setAviso('')
    setMotivo(''); setEvidencia('')
    await onListo()
  }

  return (
    <div style={{ ...caja, background: '#111827', display: 'grid', gap: 8 }}>
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
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={registrar} disabled={!valido || enviando} style={boton(COLOR_ESTADO[estado] ?? C.celeste, !valido || enviando)}>
          {enviando ? 'Registrando…' : 'Registrar'}
        </button>
        {!valido && <span style={{ fontSize: 12, color: C.apagado }}>El motivo necesita al menos {MOTIVO_MINIMO} caracteres.</span>}
        {aviso && <span style={{ fontSize: 12, color: '#fca5a5' }}>{aviso}</span>}
      </div>
    </div>
  )
}

/**
 * Corrección individual de una evaluación YA PUBLICADA, sólo Gerencia.
 *
 * Existe por el caso MENA (septiembre 2026): la regla general es prospectiva,
 * pero Gerencia ordenó aplicar el tope a una persona sobre un mes publicado.
 * Se muestra antes y después, y sólo cambia la capa final: las dimensiones y
 * sus porcentajes quedan como se publicaron. La versión anterior queda en el
 * historial y la base registra fecha, motivo y autor.
 */
function CorreccionEvaluacion({ grupo, mes }: { grupo: GrupoPersona; mes: string }) {
  const [ev, setEv] = useState<EvaluacionPublicadaResumen | null>(null)
  const [cargada, setCargada] = useState(false)
  const [error, setError] = useState('')
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [hecho, setHecho] = useState('')

  const cargar = useCallback(async () => {
    const r = await cargarEvaluacionPublicada(grupo.empleadoId, mes)
    setEv(r.data); setError(r.error ?? ''); setCargada(true)
  }, [grupo.empleadoId, mes])

  const propuesta = useMemo(() => ev ? corregirCapa4(ev, [
    faltaPorSalidaAnticipada(grupo.injustificadas),
    faltaPorAbandono(grupo.abandonos),
  ]) : null, [ev, grupo.injustificadas, grupo.abandonos])

  if (!cargada) {
    return (
      <button onClick={() => void cargar()} style={boton(C.celeste)}>
        Gerencia · revisar el efecto sobre la evaluación publicada de {etiquetaMes(mes)}
      </button>
    )
  }
  if (error) return <div style={{ fontSize: 12, color: '#fca5a5' }}>No se pudo leer la evaluación: {error}</div>
  if (!ev || ev.estado !== 'publicada') {
    return <div style={{ fontSize: 12, color: C.tenue }}>No hay una evaluación publicada de {etiquetaMes(mes)} para esta persona.</div>
  }
  if (ev.corregida_at) {
    return (
      <div style={{ ...caja, fontSize: 12, color: C.tenue }}>
        Evaluación corregida el {ev.corregida_at.slice(8, 10)}/{ev.corregida_at.slice(5, 7)}/{ev.corregida_at.slice(0, 4)}
        {' '}(versión {ev.version}). Nota final {ev.nota_final}. Motivo: {ev.motivo_correccion}
      </div>
    )
  }
  if (!propuesta) return null

  const cambia = propuesta.nota_final < Number(ev.nota_final)
  const aplicar = async () => {
    if (motivo.trim().length < 20) return
    const ok = window.confirm(
      `Vas a corregir y republicar la evaluación de ${grupo.empleado} de ${etiquetaMes(mes)}:\n\n`
      + `nota final ${ev.nota_final} → ${propuesta.nota_final} (${propuesta.concepto}).\n\n`
      + 'La versión publicada queda guardada en el historial. ¿Confirmás?',
    )
    if (!ok) return
    setEnviando(true)
    const r = await corregirEvaluacionPublicada({
      evaluacionId: ev.id,
      notaFinal: propuesta.nota_final,
      concepto: propuesta.concepto,
      faltas: propuesta.faltas,
      explicacion: propuesta.explicacion,
      motivo,
    })
    setEnviando(false)
    if (r.error) { setHecho(`No se corrigió: ${r.error}`); return }
    setHecho('Corregida y republicada.')
    await cargar()
  }

  return (
    <div style={{ ...caja, background: '#111827', display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: C.texto }}>
        Corrección individual de la evaluación publicada · sólo Gerencia
      </div>
      <div style={{ fontSize: 13, color: C.tenue, lineHeight: 1.6 }}>
        Publicada: <b style={{ color: C.texto }}>{ev.nota_final}</b> ({ev.concepto}) · desempeño {ev.indice}
        <br />
        Con las salidas confirmadas: <b style={{ color: cambia ? '#fca5a5' : C.texto }}>{propuesta.nota_final}</b> ({propuesta.concepto})
        <br />
        Explicación que verá la persona: «{propuesta.explicacion}»
        <br />
        Las dimensiones y sus porcentajes no cambian.
      </div>
      {cambia ? (
        <>
          <textarea
            value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
            placeholder="Motivo de la corrección (obligatorio, queda en el historial)"
            style={campo}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={aplicar} disabled={motivo.trim().length < 20 || enviando} style={boton(C.rojo, motivo.trim().length < 20 || enviando)}>
              {enviando ? 'Corrigiendo…' : 'Corregir y republicar'}
            </button>
            {hecho && <span style={{ fontSize: 12, color: C.tenue }}>{hecho}</span>}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: C.tenue }}>La nota publicada ya está en o por debajo del tope: no hay nada que corregir.</div>
      )}
    </div>
  )
}
