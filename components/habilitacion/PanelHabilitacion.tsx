'use client'

/**
 * components/habilitacion/PanelHabilitacion.tsx
 *
 * «Credencial y Habilitación»: lo primero que se ve al abrir el legajo de un
 * vigilador (Administración y Gerencia). Responde: ¿tiene credencial? ¿está
 * vigente? Si no, ¿qué falta y quién lo tiene que hacer? Y permite registrar
 * cada gestión del trámite sin salir del legajo. La situación la decide la
 * base; esta pantalla no interpreta por su cuenta.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ESTADO_PASO, ETAPA, EVENTO, RESPONSABLE, SITUACION, actualizarPaso, anularCredencial, antiguedadTexto, cargarFechaIngreso,
  cargarHabilitacion, cerrarTramite, enlaceMega, fechaCorta, iniciarTramite, registrarCredencial, responsableTexto,
  seisMesesTexto, verificar,
} from '@/lib/habilitacion'
import type { EstadoRegistrable, EtapaHabilitacion, HabilitacionEmpleado, PasoHabilitacion, Persona } from '@/lib/habilitacion'

const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#0b1220', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '8px 10px', fontSize: 14 }
const etiqueta: React.CSSProperties = { fontSize: 12, color: '#94a3b8', display: 'block', margin: '8px 0 4px' }
const boton = (t: 'ok' | 'sec' | 'peligro', hab = true): React.CSSProperties => ({
  background: !hab ? '#334155' : t === 'ok' ? '#16a34a' : 'transparent', color: !hab ? '#64748b' : t === 'ok' ? '#fff' : t === 'peligro' ? '#fca5a5' : '#cbd5e1',
  border: t === 'ok' ? 'none' : t === 'peligro' ? '1px solid rgba(239,68,68,.5)' : '1px solid #334155',
  borderRadius: 8, padding: '7px 12px', fontWeight: t === 'ok' ? 800 : 600, cursor: hab ? 'pointer' : 'not-allowed', fontSize: 13,
})
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())

type Accion = null | 'ingreso' | 'credencial' | 'verificar' | 'consulta' | 'cerrar' | { anular: string }

function MensajeError({ e }: { e: string | null }) {
  return e ? <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 6 }}>{e}</div> : null
}

function FormIngreso({ empleadoId, primerTurno, onListo, onCancelar }: { empleadoId: string; primerTurno: string | null; onListo: () => void; onCancelar: () => void }) {
  const [fecha, setFecha] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <div style={{ marginTop: 8 }}>
      <span style={etiqueta}>Fecha de ingreso a la empresa</span>
      <input type="date" style={{ ...input, maxWidth: 220 }} max={hoy()} value={fecha} onChange={e => setFecha(e.target.value)} />
      {primerTurno && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Referencia: su primer turno en la app es del {fechaCorta(primerTurno)} (la app se usa desde marzo de 2026: puede haber ingresado antes).</div>}
      <MensajeError e={error} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" style={boton('ok', !!fecha)} disabled={!fecha} onClick={async () => { const e = await cargarFechaIngreso(empleadoId, fecha); if (e) setError(e); else onListo() }}>Guardar</button>
        <button type="button" style={boton('sec')} onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}

function FormCredencial({ datos, onListo, onCancelar }: { datos: HabilitacionEmpleado; onListo: () => void; onCancelar: () => void }) {
  const doc = datos.documentos_credencial.find(d => d.estado === 'aprobado' || d.estado === 'aceptado') ?? null
  const [usarDoc, setUsarDoc] = useState(!!doc)
  const [numero, setNumero] = useState('')
  const [emision, setEmision] = useState('')
  const [vence, setVence] = useState('')
  const [verificada, setVerificada] = useState(true)
  const [obs, setObs] = useState('')
  const [error, setError] = useState<string | null>(null)
  const venceFinal = vence || (usarDoc ? doc?.vence_el ?? '' : '')
  const listo = !!venceFinal && (verificada || obs.trim().length >= 5)
  return (
    <div style={{ marginTop: 8, padding: 10, borderRadius: 8, border: '1px solid #1e2d42', background: '#0f172a' }}>
      <div style={{ fontSize: 13.5, color: '#e2e8f0', fontWeight: 700 }}>Registrar la credencial emitida</div>
      {doc && (
        <label style={{ display: 'flex', gap: 8, fontSize: 13, color: '#cbd5e1', marginTop: 6 }}>
          <input type="checkbox" checked={usarDoc} onChange={e => setUsarDoc(e.target.checked)} />
          Usar la credencial validada en Documentación{doc.vence_el ? ` (vence el ${fechaCorta(doc.vence_el)})` : ''} — no hace falta volver a cargar las fechas.
        </label>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        <div><span style={etiqueta}>Número de credencial</span><input style={input} value={numero} maxLength={40} onChange={e => setNumero(e.target.value)} /></div>
        <div><span style={etiqueta}>Emisión {usarDoc && doc?.fecha_emision ? `(${fechaCorta(doc.fecha_emision)})` : '(si figura)'}</span><input type="date" style={input} max={hoy()} value={emision} onChange={e => setEmision(e.target.value)} /></div>
        <div><span style={etiqueta}>Vencimiento *{usarDoc && doc?.vence_el ? ` (${fechaCorta(doc.vence_el)})` : ''}</span><input type="date" style={input} value={vence} onChange={e => setVence(e.target.value)} /></div>
      </div>
      <label style={{ display: 'flex', gap: 8, fontSize: 13, color: '#cbd5e1', marginTop: 8 }}>
        <input type="checkbox" checked={verificada} onChange={e => setVerificada(e.target.checked)} />
        Vi la credencial (o la constancia de Control de Agencias) y los datos coinciden.
      </label>
      {!verificada && <input style={{ ...input, marginTop: 6 }} placeholder="De dónde sale el dato (p. ej.: lo informó el empleado por WhatsApp)" value={obs} maxLength={500} onChange={e => setObs(e.target.value)} />}
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
        {verificada ? 'Al registrarla verificada, el trámite abierto se da por emitido.' : 'Sin verificar no cierra el trámite y figura como «sin verificar».'}
        {' '}La imagen se sube en Documentación → Credencial de vigilador.
      </div>
      <MensajeError e={error} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" style={boton('ok', listo)} disabled={!listo} onClick={async () => {
          const e = await registrarCredencial(datos.empleado_id, { numero, emision: emision || null, vence: vence || null, documentoId: usarDoc ? doc?.id : null, verificada, observacion: obs })
          if (e) setError(e); else onListo()
        }}>Registrar credencial</button>
        <button type="button" style={boton('sec')} onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}

function ConMotivo({ titulo, boton: etiquetaBoton, placeholder, minimo = 5, onConfirmar, onCancelar }: {
  titulo: string; boton: string; placeholder: string; minimo?: number; onConfirmar: (t: string) => Promise<string | null>; onCancelar: () => void
}) {
  const [t, setT] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <div style={{ marginTop: 8 }}>
      <span style={etiqueta}>{titulo}</span>
      <input style={input} placeholder={placeholder} value={t} maxLength={500} onChange={e => setT(e.target.value)} />
      <MensajeError e={error} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" style={boton('ok', t.trim().length >= minimo)} disabled={t.trim().length < minimo} onClick={async () => { const e = await onConfirmar(t.trim()); if (e) setError(e) }}>{etiquetaBoton}</button>
        <button type="button" style={boton('sec')} onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}

function EditarPaso({ p, tramiteId, personas, esGerencia, onListo, onCancelar }: {
  p: PasoHabilitacion; tramiteId: string; personas: Persona[]; esGerencia: boolean; onListo: () => void; onCancelar: () => void
}) {
  // Un turno sin registrar empieza como «pedido» (con su fecha); lo demás, como hecho.
  const [estado, setEstado] = useState<EstadoRegistrable>(p.registrado ?? (p.estado === 'en_curso' || (p.codigo.startsWith('turno') && !p.registrado) ? 'en_curso' : 'hecho'))
  const [fecha, setFecha] = useState(p.fecha ?? (p.codigo.startsWith('turno') ? '' : hoy()))
  const [resp, setResp] = useState(p.responsable_usuario ?? '')
  const [obs, setObs] = useState(p.observacion ?? '')
  const [error, setError] = useState<string | null>(null)
  const esTurno = p.codigo.startsWith('turno')
  const bloqueada = p.codigo === 'firma_gerencia' && estado === 'hecho' && !esGerencia
  return (
    <div style={{ marginTop: 6, padding: 10, borderRadius: 8, border: '1px solid #1e2d42', background: '#0b1220' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
        <div><span style={etiqueta}>Estado</span>
          <select style={input} value={estado} onChange={e => setEstado(e.target.value as EstadoRegistrable)}>
            <option value="pendiente">Pendiente</option>
            <option value="en_curso">{esTurno ? 'Turno pedido / en curso' : 'En curso'}</option>
            <option value="hecho">Hecho</option>
            <option value="no_corresponde">No corresponde</option>
          </select></div>
        <div><span style={etiqueta}>{esTurno && estado === 'en_curso' ? 'Fecha del turno' : 'Fecha'}</span>
          <input type="date" style={input} value={fecha} onChange={e => setFecha(e.target.value)} /></div>
        <div><span style={etiqueta}>Responsable</span>
          <select style={input} value={resp} onChange={e => setResp(e.target.value)}>
            <option value="">{RESPONSABLE[p.responsable_rol]} (habitual)</option>
            {personas.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
          </select></div>
      </div>
      <input style={{ ...input, marginTop: 8 }} placeholder={estado === 'no_corresponde' ? 'Por qué no corresponde (obligatorio)' : 'Observación (opcional): p. ej., quién la llevó, qué falta'}
        value={obs} maxLength={500} onChange={e => setObs(e.target.value)} />
      {bloqueada && <div style={{ fontSize: 12.5, color: '#fbbf24', marginTop: 6 }}>La firma la registra Gerencia.</div>}
      {p.tipo_documento && estado === 'hecho' && !p.documento && (
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>Queda registrada como hecha sin documento validado. Si tenés el archivo, cargalo en Documentación para que quede verificado.</div>
      )}
      <MensajeError e={error} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" style={boton('ok', !bloqueada)} disabled={bloqueada} onClick={async () => {
          const e = await actualizarPaso(tramiteId, p.codigo, { estado, fecha: fecha || null, responsable: resp || null, observacion: obs })
          if (e) setError(e); else onListo()
        }}>Guardar</button>
        <button type="button" style={boton('sec')} onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}

function Pasos({ datos, onCambio }: { datos: HabilitacionEmpleado; onCambio: () => void }) {
  const t = datos.tramite!
  const [editando, setEditando] = useState<string | null>(null)
  const etapas = Array.from(new Set(t.pasos.map(p => p.etapa))) as EtapaHabilitacion[]
  return (
    <div style={{ marginTop: 10 }}>
      {etapas.map(et => (
        <div key={et} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11.5, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, margin: '6px 0 4px' }}>{ETAPA[et]}</div>
          {t.pasos.filter(p => p.etapa === et).map(p => {
            const e = ESTADO_PASO[p.estado]
            return (
              <div key={p.codigo} style={{ padding: '7px 0', borderTop: '1px solid #1e293b' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: e.color, minWidth: 92 }}>{p.resuelto ? '✓ ' : ''}{e.texto}</span>
                  <span style={{ fontSize: 13.5, color: p.resuelto ? '#94a3b8' : '#e2e8f0', flex: 1, minWidth: 160 }}>{p.nombre}</span>
                  <span style={{ fontSize: 12, color: '#64748b' }}>{p.responsable_nombre && p.responsable_rol !== 'empleado' ? p.responsable_nombre : RESPONSABLE[p.responsable_rol]}</span>
                  {editando !== p.codigo && <button type="button" style={{ ...boton('sec'), padding: '3px 9px', fontSize: 12 }} onClick={() => setEditando(p.codigo)}>Actualizar</button>}
                </div>
                {(() => {
                  const partes: React.ReactNode[] = [
                    p.fecha ? (p.codigo.startsWith('turno') && p.registrado === 'en_curso' ? `turno: ${fechaCorta(p.fecha)}` : fechaCorta(p.fecha)) : null,
                    p.documento ? (p.documento.estado === 'validado' ? `documento validado${p.documento.vence_el ? `, vence ${fechaCorta(p.documento.vence_el)}` : ''}` : 'archivo cargado, sin validar en Documentación') : null,
                    p.observacion,
                    p.mega_referencias > 0 && !p.resuelto && p.tipo_documento
                      ? <a key="mega" href={enlaceMega(datos.empleado_id, p.tipo_documento)} style={{ color: '#93c5fd' }}>hay {p.mega_referencias} en MEGA para revisar</a> : null,
                    !p.resuelto && !p.fecha && !p.observacion && !p.documento && p.ayuda ? p.ayuda : null,
                  ].filter(Boolean)
                  return partes.length ? (
                    <div style={{ fontSize: 12, color: '#64748b', marginLeft: 100 }}>
                      {partes.map((x, i) => <span key={i}>{i ? ' · ' : ''}{x}</span>)}
                    </div>
                  ) : null
                })()}
                {editando === p.codigo && <EditarPaso p={p} tramiteId={t.id} personas={datos.personas} esGerencia={datos.es_gerencia}
                  onListo={() => { setEditando(null); onCambio() }} onCancelar={() => setEditando(null)} />}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export default function PanelHabilitacion({ empleadoId }: { empleadoId: string }) {
  const [datos, setDatos] = useState<HabilitacionEmpleado | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [accion, setAccion] = useState<Accion>(null)
  const [verTramite, setVerTramite] = useState(false)
  const [verHistorial, setVerHistorial] = useState(false)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)
  const cargar = useCallback(async () => { const r = await cargarHabilitacion(empleadoId); setDatos(r.datos); setError(r.error) }, [empleadoId])
  useEffect(() => { void cargar() }, [cargar])
  const listo = () => { setAccion(null); setErrorAccion(null); void cargar() }
  const hacer = async (f: () => Promise<string | null>) => { setErrorAccion(null); const e = await f(); if (e) setErrorAccion(e); else listo() }

  if (error) return <div style={{ background: '#111827', border: '1px solid #1e2d42', borderRadius: 12, padding: 14, marginBottom: 14, color: '#fca5a5', fontSize: 13 }}>Credencial y Habilitación: {error}</div>
  if (!datos) return <div style={{ background: '#111827', border: '1px solid #1e2d42', borderRadius: 12, padding: 14, marginBottom: 14, color: '#64748b', fontSize: 13 }}>Cargando credencial y habilitación…</div>

  const s = SITUACION[datos.codigo]
  const seis = seisMesesTexto(datos)
  const resp = responsableTexto(datos)
  const cred = datos.credencial
  const t = datos.tramite
  const sinCredencialVerificada = !cred || !cred.verificada
  const dato = (titulo: string, valor: React.ReactNode) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em' }}>{titulo}</div>
      <div style={{ fontSize: 13.5, color: '#e2e8f0' }}>{valor}</div>
    </div>
  )

  return (
    <section aria-label="Credencial y Habilitación" style={{ background: '#111827', border: `1px solid ${s.color}55`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>Credencial y Habilitación</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginTop: 8, padding: '10px 12px', borderRadius: 10, background: s.fondo }}>
        <div aria-hidden style={{ fontSize: 22, color: s.color, fontWeight: 800, minWidth: 26, textAlign: 'center' }}>{s.icono}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: s.color }}>{datos.titulo}</div>
          <div style={{ fontSize: 14.5, color: '#e2e8f0', marginTop: 2 }}>{datos.detalle}</div>
          {resp && datos.codigo !== 'vigente' && <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 4 }}>Le toca a: <b>{resp}</b></div>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginTop: 10 }}>
        {dato('Ingreso', datos.ingreso
          ? <>{fechaCorta(datos.ingreso)} <span style={{ color: '#94a3b8' }}>({antiguedadTexto(datos.antiguedad_dias)})</span></>
          : <button type="button" style={{ ...boton('sec'), padding: '3px 9px', fontSize: 12.5, color: '#fbbf24' }} onClick={() => setAccion('ingreso')}>Cargar fecha de ingreso</button>)}
        {seis && dato('Seis meses', <span style={{ color: seis.color }}>{seis.texto}</span>)}
        {cred && dato('Credencial', <>{cred.numero ? `N° ${cred.numero} · ` : ''}vence {fechaCorta(cred.vence_el)}{!cred.verificada && <span style={{ color: '#fbbf24' }}> · sin verificar</span>}</>)}
        {t && dato(t.tipo === 'renovacion' ? 'Renovación' : 'Trámite', <>
          {t.estado === 'presentado' ? `presentado el ${fechaCorta(t.presentado_at)}` : `${t.pendientes} gestión${t.pendientes === 1 ? '' : 'es'} pendiente${t.pendientes === 1 ? '' : 's'}`}
          {t.demorado && <span style={{ color: '#f87171' }}> · sin movimiento hace {t.dias_sin_movimiento} días</span>}
        </>)}
      </div>

      {accion === 'ingreso' && <FormIngreso empleadoId={empleadoId} primerTurno={datos.primer_turno} onListo={listo} onCancelar={() => setAccion(null)} />}
      {accion === 'credencial' && <FormCredencial datos={datos} onListo={listo} onCancelar={() => setAccion(null)} />}
      {accion === 'verificar' && <ConMotivo titulo="¿Cómo lo verificaste? (opcional)" boton="No tiene credencial" placeholder="P. ej.: consultado en Control de Agencias por CUIL" minimo={0}
        onConfirmar={o => verificar(empleadoId, 'sin_credencial', o).then(e => { if (!e) listo(); return e })} onCancelar={() => setAccion(null)} />}
      {accion === 'consulta' && <ConMotivo titulo="Qué informó Control de Agencias (consulta por nombre, apellido y CUIL)" boton="Registrar consulta" placeholder="P. ej.: en trámite, sin observaciones"
        onConfirmar={o => verificar(empleadoId, 'consulta_agencias', o).then(e => { if (!e) listo(); return e })} onCancelar={() => setAccion(null)} />}
      {accion === 'cerrar' && t && <ConMotivo titulo="Por qué se cierra el trámite sin credencial" boton="Cerrar trámite" placeholder="P. ej.: el empleado dejó la empresa"
        onConfirmar={o => cerrarTramite(t.id, o).then(e => { if (!e) listo(); return e })} onCancelar={() => setAccion(null)} />}
      {accion && typeof accion === 'object' && <ConMotivo titulo="Por qué se anula esta credencial" boton="Anular" placeholder="P. ej.: datos cargados por error"
        onConfirmar={o => anularCredencial(accion.anular, o).then(e => { if (!e) listo(); return e })} onCancelar={() => setAccion(null)} />}
      <MensajeError e={errorAccion} />

      {accion === null && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {!t && sinCredencialVerificada && !cred && <button type="button" style={boton('ok')} onClick={() => void hacer(() => iniciarTramite(empleadoId, 'primera'))}>Iniciar trámite de credencial</button>}
          {!t && cred && cred.verificada && cred.estado !== 'vigente' && <button type="button" style={boton('ok')} onClick={() => void hacer(() => iniciarTramite(empleadoId, 'renovacion'))}>Iniciar renovación</button>}
          {t && <button type="button" style={boton(verTramite ? 'sec' : 'ok')} onClick={() => setVerTramite(v => !v)}>{verTramite ? 'Ocultar el trámite' : 'Ver y actualizar el trámite'}</button>}
          {(!cred || t || cred.estado !== 'vigente' || !cred.verificada) && <button type="button" style={boton('sec')} onClick={() => setAccion('credencial')}>Registrar credencial</button>}
          {datos.codigo === 'desconocida' && <button type="button" style={boton('sec')} onClick={() => setAccion('verificar')}>No tiene credencial (verificado)</button>}
          {(t || datos.codigo === 'desconocida') && <button type="button" style={boton('sec')} onClick={() => setAccion('consulta')}>Registrar consulta en Control de Agencias</button>}
          {t && <button type="button" style={boton('peligro')} onClick={() => setAccion('cerrar')}>Cerrar trámite</button>}
          {cred && <button type="button" style={boton('peligro')} onClick={() => setAccion({ anular: cred.id })}>Anular credencial</button>}
        </div>
      )}

      {t && verTramite && <Pasos datos={datos} onCambio={() => void cargar()} />}

      <button type="button" onClick={() => setVerHistorial(v => !v)} style={{ background: 'none', border: 'none', color: '#93c5fd', padding: 0, marginTop: 10, fontSize: 12.5, cursor: 'pointer' }}>
        {verHistorial ? 'Ocultar historial' : `Ver historial${datos.historial.length ? ` (${datos.historial.length})` : ''}`}
      </button>
      {verHistorial && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, color: '#94a3b8' }}>
          {datos.historial.length === 0 && <li>Sin movimientos todavía.</li>}
          {datos.historial.map((h, i) => (
            <li key={i}>
              {new Date(h.at).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })} · {h.quien ?? 'sistema'} · {EVENTO[h.evento] ?? h.evento}
              {typeof h.detalle?.nombre === 'string' ? `: ${h.detalle.nombre} → ${String(h.detalle.estado)}` : ''}
              {typeof h.detalle?.observacion === 'string' && h.detalle.observacion ? ` (${h.detalle.observacion})` : ''}
              {typeof h.detalle?.motivo === 'string' ? ` (${h.detalle.motivo})` : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
