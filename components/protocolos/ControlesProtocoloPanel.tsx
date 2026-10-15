'use client'

/**
 * components/protocolos/ControlesProtocoloPanel.tsx
 *
 * Sección «Checklist desde el protocolo» de la ficha del objetivo, debajo del
 * protocolo. Convierte instrucciones del protocolo en puntos del checklist de
 * supervisión del objetivo, en modo propuesta:
 *
 *   dividir en instrucciones → la IA clasifica y propone → una persona valida
 *   la clasificación y aprueba o rechaza → Gerencia activa lo aprobado (sólo
 *   desde la versión vigente) en la plantilla propia del objetivo.
 *
 * Los botones salen de protocolo_controles_panel.permisos y cada RPC vuelve a
 * validar: preparar (validar, proponer, aprobar, rechazar) = Administración,
 * Gerencia, jefatura de supervisores y dirección operativa; activar = Gerencia.
 * Un supervisor de la zona ve todo sin botones. Puntos de ronda, tareas,
 * órdenes y alertas se pueden aprobar como decisión pero no se activan.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CLASIFICACIONES, COLOR_ESTADO_CONTROL, DESTINOS, ETIQUETA_CLASIFICACION, ETIQUETA_DESTINO,
  ETIQUETA_ESTADO_CONTROL, ETIQUETA_EXISTENTE, controlesPorInstruccion, destinoActivable,
} from '@/lib/protocolo-controles'
import type { Clasificacion, ControlPropuesto, Destino, InstruccionPanel, PanelControles, VersionControles } from '@/lib/protocolo-controles'
import {
  activarControles, aprobarControl, cargarPanelControles, dividirInstrucciones, editarControl,
  proponerConIA, proponerControl, rechazarControl, validarInstruccion,
} from '@/lib/protocolo-controles-datos'
import { ETIQUETA_ESTADO, fechaHoraAR } from '@/lib/protocolos'

const card: React.CSSProperties = {
  background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 16, marginBottom: 14,
}
const sub: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#e2e8f0', margin: '16px 0 8px' }
const nota: React.CSSProperties = { fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }
const input: React.CSSProperties = {
  boxSizing: 'border-box', background: '#0a0e1a', border: '1px solid #1e2d42',
  color: '#e2e8f0', borderRadius: 8, padding: '6px 8px', fontSize: 13, fontFamily: 'inherit',
}
const boton = (tono: 'primario' | 'secundario' | 'peligro' | 'ok' = 'secundario'): React.CSSProperties => ({
  border: tono === 'secundario' ? '1px solid #334155' : 'none', borderRadius: 8, padding: '6px 11px',
  fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  background: tono === 'primario' ? '#f59e0b' : tono === 'peligro' ? '#b91c1c' : tono === 'ok' ? '#15803d' : 'transparent',
  color: tono === 'primario' ? '#1a1205' : tono === 'secundario' ? '#cbd5e1' : '#fff',
})
const pill = (color: string): React.CSSProperties => ({
  display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
  border: `1px solid ${color}`, color, whiteSpace: 'nowrap',
})

type Ejecutar = (fn: () => Promise<{ error: string | null }>, ok?: string) => Promise<boolean>

export default function ControlesProtocoloPanel({ objetivoId }: { objetivoId: string }) {
  const [panel, setPanel] = useState<PanelControles | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null)
  const [versionId, setVersionId] = useState<string | null>(null)
  const [ocultarInformativas, setOcultarInformativas] = useState(true)
  const [abierto, setAbierto] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await cargarPanelControles(objetivoId)
    setPanel(r.data)
    setError(r.error)
    setCargando(false)
  }, [objetivoId])

  useEffect(() => { void cargar() }, [cargar])

  // Por defecto, la vigente; si no hay, la última en preparación.
  useEffect(() => {
    if (!panel) return
    if (versionId && panel.versiones.some(v => v.id === versionId)) return
    const v = panel.versiones.find(x => x.estado === 'vigente') ?? panel.versiones[0]
    setVersionId(v?.id ?? null)
  }, [panel, versionId])

  const ejecutar: Ejecutar = useCallback(async (fn, ok) => {
    setOcupado(true)
    setMensaje(null)
    const r = await fn()
    setOcupado(false)
    if (r.error) { setMensaje({ texto: r.error, tipo: 'error' }); return false }
    if (ok) setMensaje({ texto: ok, tipo: 'ok' })
    await cargar()
    return true
  }, [cargar])

  const porInstruccion = useMemo(() => controlesPorInstruccion(panel?.controles ?? []), [panel])

  // Sin acceso al protocolo, la sección no aparece (el panel del protocolo ya lo
  // dice). Tampoco si la migración todavía no se aplicó (la RPC no existe).
  if (error && /permiso|could not find the function|does not exist/i.test(error)) return null
  if (cargando && !panel) return null
  if (error) return <div style={card}><div style={{ color: '#f87171', fontSize: 13 }}>Checklist desde el protocolo: {error}</div></div>
  if (!panel) return null

  const version = panel.versiones.find(v => v.id === versionId) ?? null
  const p = panel.permisos
  const aprobadosActivables = panel.controles.filter(c =>
    c.estado === 'aprobado' && destinoActivable(c.destino) && c.version_id === version?.id)
  const pendientes = panel.controles.filter(c => c.estado === 'propuesto').length

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#f1f5f9' }}>Checklist desde el protocolo</div>
          <div style={nota}>
            Propuestas de puntos de control a partir de las instrucciones del protocolo. Nada cambia el checklist del
            supervisor hasta que Gerencia lo activa.
          </div>
        </div>
        <button type="button" style={boton()} onClick={() => setAbierto(a => !a)}>
          {abierto ? 'Ocultar' : `Ver${pendientes ? ` · ${pendientes} por revisar` : ''}`}
        </button>
      </div>

      <div style={{ ...nota, marginTop: 10 }}>
        Checklist que usa hoy el supervisor:{' '}
        {panel.plantilla
          ? <><b style={{ color: '#e2e8f0' }}>{panel.plantilla.nombre}</b> · {panel.plantilla.items.length} puntos ·{' '}
              {panel.plantilla.propia ? 'propia de este objetivo' : 'plantilla general (compartida con otros objetivos)'}
              {' · '}{panel.plantilla.items.filter(i => i.origen_instruccion_id).length} salen del protocolo</>
          : 'ninguno asignado'}
      </div>

      {abierto && (
        <>
          {mensaje && (
            <div style={{ marginTop: 10, fontSize: 13, color: mensaje.tipo === 'ok' ? '#4ade80' : '#f87171' }}>{mensaje.texto}</div>
          )}

          {panel.versiones.length === 0 && <div style={{ ...nota, marginTop: 12 }}>El objetivo no tiene protocolo vigente ni en preparación.</div>}

          {panel.versiones.length > 1 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
              {panel.versiones.map(v => (
                <button key={v.id} type="button" onClick={() => setVersionId(v.id)}
                  style={{ ...boton(v.id === versionId ? 'primario' : 'secundario') }}>
                  v{v.numero}{v.puesto_nombre ? ` · ${v.puesto_nombre}` : ''} · {ETIQUETA_ESTADO[v.estado]}
                </button>
              ))}
            </div>
          )}

          {version && (
            <Version
              version={version} panel={panel} porInstruccion={porInstruccion} ocupado={ocupado}
              ocultarInformativas={ocultarInformativas} setOcultarInformativas={setOcultarInformativas}
              ejecutar={ejecutar}
            />
          )}

          {version && p.activar && (
            <Activacion objetivoId={objetivoId} version={version} panel={panel} aprobados={aprobadosActivables} ocupado={ocupado} ejecutar={ejecutar} />
          )}

          {panel.corridas.length > 0 && (
            <details style={{ marginTop: 14 }}>
              <summary style={{ ...nota, cursor: 'pointer' }}>Pedidos a la IA ({panel.corridas.length})</summary>
              <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                {panel.corridas.map(r => (
                  <div key={r.id} style={nota}>
                    {fechaHoraAR(r.creado_at)} · {r.modelo} · {r.instrucciones_enviadas} instrucciones · {r.propuestas} propuestas ·
                    tokens {r.tokens_entrada ?? '—'} entrada / {r.tokens_salida ?? '—'} salida
                    {r.estado === 'error' && <span style={{ color: '#f87171' }}> · error: {r.error}</span>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  )
}

export function Version({ version, panel, porInstruccion, ocupado, ocultarInformativas, setOcultarInformativas, ejecutar }: {
  version: VersionControles
  panel: PanelControles
  porInstruccion: Map<string, ControlPropuesto[]>
  ocupado: boolean
  ocultarInformativas: boolean
  setOcultarInformativas: (v: boolean) => void
  ejecutar: Ejecutar
}) {
  const p = panel.permisos
  const desactualizadas = version.instrucciones.some(i => !i.coincide)
  const visibles = version.instrucciones.filter(i =>
    !ocultarInformativas || (i.clasificacion ?? i.clasificacion_ia) !== 'informativa' || (porInstruccion.get(i.id)?.length ?? 0) > 0)
  const sinValidar = version.instrucciones.filter(i => !i.validada_at).length

  const [resultadoIA, setResultadoIA] = useState<string | null>(null)
  const pedirIA = () => ejecutar(async () => {
    const r = await proponerConIA(version.id)
    if (r.error) return { error: r.error }
    setResultadoIA(r.data?.mensaje ?? `La IA propuso ${r.data?.creadas ?? 0} controles (${r.data?.omitidas ?? 0} omitidos). Revisalos abajo.`)
    return { error: null }
  })

  return (
    <div>
      <div style={sub}>
        Versión {version.numero}{version.puesto_nombre ? ` · ${version.puesto_nombre}` : ''} · {ETIQUETA_ESTADO[version.estado]}
      </div>
      {version.estado !== 'vigente' && (
        <div style={{ ...nota, marginBottom: 8 }}>
          Esta versión todavía no está publicada: se puede preparar el checklist, pero se activa recién cuando Gerencia la publique.
        </div>
      )}

      {p.preparar && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          {(version.instrucciones.length === 0 || desactualizadas) && (
            <button type="button" style={boton()} disabled={ocupado}
              onClick={() => ejecutar(async () => dividirInstrucciones(version.id), 'Instrucciones actualizadas')}>
              {desactualizadas ? 'El texto cambió: volver a dividir' : 'Dividir en instrucciones'}
            </button>
          )}
          <button type="button" style={boton('primario')} disabled={ocupado} onClick={pedirIA}>
            {ocupado ? 'Trabajando…' : 'Proponer controles con IA'}
          </button>
          {resultadoIA && <span style={{ ...nota, color: '#4ade80' }}>{resultadoIA}</span>}
        </div>
      )}

      {version.instrucciones.length === 0 ? (
        <div style={nota}>Todavía no se dividió en instrucciones.</div>
      ) : (
        <>
          <label style={{ ...nota, display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <input type="checkbox" checked={ocultarInformativas} onChange={e => setOcultarInformativas(e.target.checked)} />
            Ocultar las informativas sin propuesta · {version.instrucciones.length} instrucciones, {sinValidar} sin validar
          </label>
          <div style={{ display: 'grid', gap: 8 }}>
            {visibles.map(i => (
              <Instruccion key={i.id} ins={i} controles={porInstruccion.get(i.id) ?? []} preparar={p.preparar} ocupado={ocupado} ejecutar={ejecutar} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function Instruccion({ ins, controles, preparar, ocupado, ejecutar }: {
  ins: InstruccionPanel
  controles: ControlPropuesto[]
  preparar: boolean
  ocupado: boolean
  ejecutar: Ejecutar
}) {
  const [clas, setClas] = useState<Clasificacion>(ins.clasificacion ?? ins.clasificacion_ia ?? 'obligacion')
  const [quien, setQuien] = useState(ins.quien ?? ins.quien_ia ?? '')
  const [cuando, setCuando] = useState(ins.cuando ?? ins.cuando_ia ?? '')
  const [validando, setValidando] = useState(false)
  const [manual, setManual] = useState(false)
  const enCurso = controles.find(c => c.estado !== 'rechazado') ?? null
  const rechazados = controles.filter(c => c.estado === 'rechazado')
  const efectiva = ins.clasificacion ?? null

  return (
    <div style={{ border: '1px solid #1e2d42', borderRadius: 8, padding: 10, background: '#0b1220' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, color: '#64748b', minWidth: 22 }}>{ins.orden}.</span>
        <div style={{ fontSize: 13.5, color: ins.coincide ? '#e2e8f0' : '#f87171', lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {ins.texto}
          {!ins.coincide && <div style={{ fontSize: 11.5 }}>El texto del protocolo cambió: volver a dividir.</div>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '6px 0 0 30px' }}>
        {efectiva ? (
          <span style={pill('#22c55e')} title={`Validada${ins.validada_por_nombre ? ` por ${ins.validada_por_nombre}` : ''} ${ins.validada_at ? fechaHoraAR(ins.validada_at) : ''}`}>
            {ETIQUETA_CLASIFICACION[efectiva]}{ins.quien ? ` · ${ins.quien}` : ''}{ins.cuando ? ` · ${ins.cuando}` : ''} ✓
          </span>
        ) : ins.clasificacion_ia ? (
          <span style={pill('#94a3b8')}>
            IA: {ETIQUETA_CLASIFICACION[ins.clasificacion_ia]}{ins.quien_ia ? ` · ${ins.quien_ia}` : ''}{ins.cuando_ia ? ` · ${ins.cuando_ia}` : ''} · sin validar
          </span>
        ) : (
          <span style={pill('#475569')}>Sin clasificar</span>
        )}
        {preparar && ins.coincide && !validando && (
          <button type="button" style={{ ...boton(), padding: '3px 9px' }} onClick={() => setValidando(true)}>
            {efectiva ? 'Corregir' : 'Validar'}
          </button>
        )}
      </div>

      {validando && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0 0 30px' }}>
          <select style={input} value={clas} onChange={e => setClas(e.target.value as Clasificacion)}>
            {CLASIFICACIONES.map(c => <option key={c} value={c}>{ETIQUETA_CLASIFICACION[c]}</option>)}
          </select>
          <input style={{ ...input, width: 150 }} placeholder="Quién" value={quien} maxLength={200} onChange={e => setQuien(e.target.value)} />
          <input style={{ ...input, width: 170 }} placeholder="Cuándo" value={cuando} maxLength={200} onChange={e => setCuando(e.target.value)} />
          <button type="button" style={boton('ok')} disabled={ocupado} onClick={async () => {
            if (await ejecutar(() => validarInstruccion(ins.id, clas, quien || null, cuando || null), 'Clasificación validada')) setValidando(false)
          }}>Guardar</button>
          <button type="button" style={boton()} onClick={() => setValidando(false)}>Cancelar</button>
        </div>
      )}

      {enCurso && <Control c={enCurso} preparar={preparar} validada={!!efectiva && efectiva !== 'informativa'} ocupado={ocupado} ejecutar={ejecutar} />}

      {!enCurso && preparar && ins.coincide && efectiva !== 'informativa' && (
        manual
          ? <FormControl
              inicial={{ destino: 'checklist_supervision', texto: '', criticidad: 'normal', foto: false }}
              ocupado={ocupado}
              onCancelar={() => setManual(false)}
              onGuardar={async v => { if (await ejecutar(() => proponerControl(ins.id, v.destino, v.texto, v.criticidad, v.foto), 'Propuesta cargada')) setManual(false) }}
            />
          : <div style={{ margin: '6px 0 0 30px' }}>
              <button type="button" style={{ ...boton(), padding: '3px 9px' }} onClick={() => setManual(true)}>Proponer control a mano</button>
            </div>
      )}

      {rechazados.length > 0 && (
        <details style={{ margin: '6px 0 0 30px' }}>
          <summary style={{ ...nota, cursor: 'pointer' }}>{rechazados.length} propuesta{rechazados.length > 1 ? 's' : ''} rechazada{rechazados.length > 1 ? 's' : ''}</summary>
          {rechazados.map(r => (
            <div key={r.id} style={{ ...nota, marginTop: 4 }}>«{r.texto_item}» — {r.motivo_rechazo}</div>
          ))}
        </details>
      )}
    </div>
  )
}

function Control({ c, preparar, validada, ocupado, ejecutar }: {
  c: ControlPropuesto
  preparar: boolean
  validada: boolean
  ocupado: boolean
  ejecutar: Ejecutar
}) {
  const [editando, setEditando] = useState(false)
  const [rechazando, setRechazando] = useState(false)
  const [motivo, setMotivo] = useState('')

  return (
    <div style={{ margin: '8px 0 0 30px', borderLeft: `3px solid ${COLOR_ESTADO_CONTROL[c.estado]}`, paddingLeft: 10 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={pill(COLOR_ESTADO_CONTROL[c.estado])}>{ETIQUETA_ESTADO_CONTROL[c.estado]}</span>
        <span style={{ fontSize: 11.5, color: '#94a3b8' }}>
          {ETIQUETA_DESTINO[c.destino]}{c.origen === 'ia' ? ' · propuesto por IA' : ' · propuesto a mano'}
          {c.criticidad === 'alta' ? ' · criticidad alta' : ''}{c.foto_obligatoria ? ' · con foto' : ''}
        </span>
      </div>
      {editando ? (
        <FormControl
          inicial={{ destino: c.destino, texto: c.texto_item, criticidad: c.criticidad, foto: c.foto_obligatoria }}
          ocupado={ocupado}
          onCancelar={() => setEditando(false)}
          onGuardar={async v => { if (await ejecutar(() => editarControl(c.id, v.destino, v.texto, v.criticidad, v.foto), 'Propuesta corregida')) setEditando(false) }}
        />
      ) : (
        <div style={{ fontSize: 13.5, color: '#f1f5f9', fontWeight: 600, marginTop: 4 }}>{c.texto_item}</div>
      )}
      {c.texto_item !== c.texto_original && <div style={nota}>Original: «{c.texto_original}»</div>}
      {c.motivo && <div style={nota}>{c.motivo}</div>}
      {c.existente_tipo && (
        <div style={{ fontSize: 12, color: '#fbbf24', marginTop: 4 }}>
          Ya cubierto por {ETIQUETA_EXISTENTE[c.existente_tipo]}: «{c.existente_texto}». No se aprueba: rechazala como duplicada o corregí el texto.
        </div>
      )}
      {!destinoActivable(c.destino) && c.estado !== 'rechazado' && (
        <div style={nota}>En esta etapa sólo se activan puntos del checklist de supervisión: esto queda como propuesta documentada.</div>
      )}
      {c.estado === 'aprobado' && <div style={nota}>Aprobado{c.aprobado_por_nombre ? ` por ${c.aprobado_por_nombre}` : ''} {c.aprobado_at ? fechaHoraAR(c.aprobado_at) : ''}</div>}
      {c.estado === 'activado' && <div style={nota}>Activado{c.activado_por_nombre ? ` por ${c.activado_por_nombre}` : ''} {c.activado_at ? fechaHoraAR(c.activado_at) : ''} · ya está en el checklist del supervisor</div>}

      {preparar && !editando && (c.estado === 'propuesto' || c.estado === 'aprobado') && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {c.estado === 'propuesto' && (
            <button type="button" style={boton('ok')} disabled={ocupado || !validada || !!c.existente_tipo}
              title={!validada ? 'Primero validá la clasificación de la instrucción' : undefined}
              onClick={() => ejecutar(() => aprobarControl(c.id), 'Propuesta aprobada')}>Aprobar</button>
          )}
          {c.estado === 'propuesto' && <button type="button" style={boton()} onClick={() => setEditando(true)}>Corregir</button>}
          {!rechazando && <button type="button" style={boton('peligro')} onClick={() => setRechazando(true)}>Rechazar</button>}
          {rechazando && (
            <>
              <input style={{ ...input, minWidth: 220 }} placeholder="Motivo del rechazo" value={motivo} onChange={e => setMotivo(e.target.value)} />
              <button type="button" style={boton('peligro')} disabled={ocupado || !motivo.trim()}
                onClick={() => ejecutar(() => rechazarControl(c.id, motivo.trim()), 'Propuesta rechazada')}>Confirmar rechazo</button>
              <button type="button" style={boton()} onClick={() => { setRechazando(false); setMotivo('') }}>Cancelar</button>
            </>
          )}
          {c.estado === 'propuesto' && !validada && <span style={nota}>Para aprobar, validá antes la clasificación.</span>}
        </div>
      )}
    </div>
  )
}

function FormControl({ inicial, ocupado, onGuardar, onCancelar }: {
  inicial: { destino: Destino; texto: string; criticidad: 'normal' | 'alta'; foto: boolean }
  ocupado: boolean
  onGuardar: (v: { destino: Destino; texto: string; criticidad: 'normal' | 'alta'; foto: boolean }) => void
  onCancelar: () => void
}) {
  const [v, setV] = useState(inicial)
  return (
    <div style={{ display: 'grid', gap: 6, margin: '6px 0 0 30px', maxWidth: 560 }}>
      <select style={input} value={v.destino} onChange={e => setV({ ...v, destino: e.target.value as Destino })}>
        {DESTINOS.map(d => <option key={d} value={d}>{ETIQUETA_DESTINO[d]}</option>)}
      </select>
      <input style={input} placeholder="Qué tiene que verificar el supervisor" value={v.texto} maxLength={500}
        onChange={e => setV({ ...v, texto: e.target.value })} />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={nota}>
          <input type="checkbox" checked={v.criticidad === 'alta'} onChange={e => setV({ ...v, criticidad: e.target.checked ? 'alta' : 'normal' })} /> Criticidad alta
        </label>
        <label style={nota}>
          <input type="checkbox" checked={v.foto} onChange={e => setV({ ...v, foto: e.target.checked })} /> Foto obligatoria
        </label>
        <button type="button" style={boton('ok')} disabled={ocupado || !v.texto.trim()} onClick={() => onGuardar({ ...v, texto: v.texto.trim() })}>Guardar</button>
        <button type="button" style={boton()} onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}

export function Activacion({ objetivoId, version, panel, aprobados, ocupado, ejecutar }: {
  objetivoId: string
  version: VersionControles
  panel: PanelControles
  aprobados: ControlPropuesto[]
  ocupado: boolean
  ejecutar: Ejecutar
}) {
  const [elegidos, setElegidos] = useState<Set<string>>(new Set())
  useEffect(() => { setElegidos(new Set(aprobados.map(c => c.id))) }, [aprobados.map(c => c.id).join(',')])

  if (aprobados.length === 0) return null
  const vigente = version.estado === 'vigente'
  const plantilla = panel.plantilla
  const efecto = plantilla?.propia
    ? `Se agregan a «${plantilla.nombre}», la plantilla propia del objetivo.`
    : plantilla
      ? `Se crea una plantilla propia del objetivo: copia de «${plantilla.nombre}» (${plantilla.items.length} puntos) más estos. La plantilla general no cambia para los demás objetivos.`
      : 'Se crea una plantilla propia del objetivo con estos puntos.'

  return (
    <div style={{ marginTop: 16, border: '1px solid #14532d', borderRadius: 8, padding: 12, background: '#052e16' }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: '#bbf7d0' }}>Activar en el checklist del supervisor</div>
      <div style={{ ...nota, color: '#a7f3d0', margin: '4px 0 8px' }}>
        {vigente ? efecto : 'Se activa recién cuando esta versión del protocolo esté publicada (vigente).'}
        {' '}Los supervisores lo van a ver en su próxima supervisión del objetivo.
      </div>
      <div style={{ display: 'grid', gap: 4 }}>
        {aprobados.map(c => (
          <label key={c.id} style={{ fontSize: 13, color: '#e2e8f0', display: 'flex', gap: 6 }}>
            <input type="checkbox" checked={elegidos.has(c.id)} disabled={!vigente}
              onChange={e => {
                const s = new Set(elegidos)
                if (e.target.checked) s.add(c.id); else s.delete(c.id)
                setElegidos(s)
              }} />
            {c.texto_item}{c.criticidad === 'alta' ? ' · alta' : ''}{c.foto_obligatoria ? ' · con foto' : ''}
          </label>
        ))}
      </div>
      <button type="button" style={{ ...boton('ok'), marginTop: 10 }} disabled={!vigente || ocupado || elegidos.size === 0}
        onClick={() => {
          if (!window.confirm(`${efecto}\n\n¿Activar ${elegidos.size} punto${elegidos.size > 1 ? 's' : ''}?`)) return
          void ejecutar(async () => {
            const r = await activarControles(objetivoId, Array.from(elegidos))
            return { error: r.error }
          }, 'Activado: ya está en el checklist del supervisor')
        }}>
        Activar {elegidos.size} punto{elegidos.size === 1 ? '' : 's'}
      </button>
    </div>
  )
}
