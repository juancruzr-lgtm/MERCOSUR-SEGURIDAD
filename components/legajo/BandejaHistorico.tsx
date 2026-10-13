'use client'

/**
 * components/legajo/BandejaHistorico.tsx
 *
 * Revisión documental de MEGA (Legajo Digital → Archivo histórico): bandeja
 * central para revisar sin entrar a cada legajo — listas (pendientes,
 * conflictos, para investigar, revisadas), agrupadas por empleado, y revisión
 * uno por uno con el original abierto y paso al siguiente.
 *
 * Cada archivo clasificado llega como una
 * PROPUESTA (persona y tipo sugeridos). Una persona de Administración decide:
 * aceptar (eligiendo persona y tipo), descartar o separar un PDF compilado.
 * Nada se importa desde acá: la importación es un proceso aparte, selectivo y
 * con autorización, que verifica el hash del archivo de MEGA.
 *
 * El archivo se abre en MEGA (la ruta está en cada tarjeta): esta pantalla no
 * copia nada. Las reglas (DNI repetido, conflicto, fechas) las vuelve a
 * controlar la base.
 */

import { useCallback, useEffect, useState } from 'react'
import VisorHistorico from '@/components/legajo/VisorHistorico'
import { TIPOS_HABILITACION } from '@/lib/habilitacion'
import {
  EVENTO_HISTORICO, FILTROS_REVISION, METODOS_VERIFICACION, NIVELES_IDENTIFICACION, agruparPorEmpleado, buscarPersona, cargarBandeja, cargarEventosHistorico, categoriaDe,
  confirmarEnLote, contarRevision, enFiltroRevision, esIdPersona, estadoVisual, faltaVerificacion, filtrarHistorico, leerRangos, marcaInvestigacion, motivoFueraDeLote,
  nivelIdentificacion, nombrePersona, personaDe, resolverPropuesta, siguienteEnCola,
} from '@/lib/legajo-historico'
import type {
  Bandeja, EventoHistorico, FiltroRevision, MetodoVerificacion, NivelIdentificacion, PersonaBuscada, PropuestaHistorica, TipoBandeja,
} from '@/lib/legajo-historico'

const card: React.CSSProperties = { background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 14, marginBottom: 10, minWidth: 0, boxSizing: 'border-box' }
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#0b1220', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '9px 10px', fontSize: 14 }
const etiqueta: React.CSSProperties = { fontSize: 12, color: '#94a3b8', display: 'block', margin: '8px 0 4px' }
const boton = (t: 'ok' | 'sec' | 'peligro', hab = true): React.CSSProperties => ({
  background: !hab ? '#334155' : t === 'ok' ? '#16a34a' : 'transparent', color: !hab ? '#64748b' : t === 'ok' ? '#fff' : t === 'peligro' ? '#fca5a5' : '#cbd5e1',
  border: t === 'ok' ? 'none' : t === 'peligro' ? '1px solid rgba(239,68,68,.5)' : '1px solid #334155',
  borderRadius: 8, padding: '8px 14px', fontWeight: t === 'ok' ? 800 : 600, cursor: hab ? 'pointer' : 'not-allowed', fontSize: 13.5,
})
const ETIQUETA_REVISAR: Record<string, string> = {
  varias_personas: 'varias personas', compilado_varios_documentos: 'PDF compilado', persona_distinta_a_carpeta: 'DNI ≠ carpeta',
  ocr_ilegible: 'escaneo ilegible', sin_texto: 'sin texto', sin_tipo: 'sin tipo', sin_persona: 'sin persona',
}

function nombreArchivo(ruta: string) { return ruta.split('/').pop() ?? ruta }

/**
 * Verificación del documento ORIGINAL: obligatoria para aceptar. Si no se abrió
 * en el visor de la app, se avisa y hay que explicar cómo se revisó (por
 * ejemplo, en MEGA). No bloquea una revisión legítima hecha por otro medio.
 */
function Verificacion({ vistoEnApp, valor, onCambio }: {
  vistoEnApp: boolean
  valor: { confirmado: boolean; metodo: MetodoVerificacion | ''; observacion: string }
  onCambio: (v: { confirmado: boolean; metodo: MetodoVerificacion | ''; observacion: string }) => void
}) {
  return (
    <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(59,130,246,.07)', border: '1px solid rgba(59,130,246,.3)' }}>
      <div style={{ fontSize: 12.5, color: '#93c5fd', fontWeight: 700 }}>Verificación del documento original</div>
      {!vistoEnApp && (
        <div role="note" style={{ fontSize: 12.5, color: '#fbbf24', marginTop: 4 }}>
          ⚠ No abriste este archivo en el visor de la app. Si lo revisaste en MEGA u otro medio, indicalo y explicá cómo lo verificaste.
        </div>
      )}
      <select style={{ ...input, marginTop: 6 }} value={valor.metodo} aria-label="Método de verificación"
        onChange={e => onCambio({ ...valor, metodo: e.target.value as MetodoVerificacion | '' })}>
        <option value="">¿Cómo lo verificaste?</option>
        {METODOS_VERIFICACION.map(([k, t]) => <option key={k} value={k} disabled={k === 'visor_app' && !vistoEnApp}>{t}</option>)}
      </select>
      {(!vistoEnApp || valor.metodo !== 'visor_app') && (
        <input style={{ ...input, marginTop: 6 }} maxLength={500} value={valor.observacion}
          placeholder={vistoEnApp ? 'Observación (opcional)' : 'Cómo lo verificaste (obligatorio, mín. 10 caracteres)'}
          onChange={e => onCambio({ ...valor, observacion: e.target.value })} />
      )}
      <label style={{ display: 'flex', gap: 8, fontSize: 13, color: '#cbd5e1', marginTop: 6 }}>
        <input type="checkbox" checked={valor.confirmado} onChange={e => onCambio({ ...valor, confirmado: e.target.checked })} />
        Comprobé el contenido del documento original (no alcanza con el nombre del archivo).
      </label>
    </div>
  )
}

function Aceptar({ p, tipos, vistoEnApp, onListo, onCancelar }: { p: PropuestaHistorica; tipos: TipoBandeja[]; vistoEnApp: boolean; onListo: () => void; onCancelar: () => void }) {
  const [persona, setPersona] = useState<{ id: string; texto: string; dniRepetido: boolean } | null>(
    p.sugerido ? { id: p.sugerido.id, texto: `${p.sugerido.apellido}, ${p.sugerido.nombre}${p.sugerido.legajo ? ` · ${p.sugerido.legajo}` : ''}`, dniRepetido: false } : null)
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<PersonaBuscada[]>([])
  const [tipo, setTipo] = useState(p.tipo_sugerido ?? '')
  const [fecha, setFecha] = useState('')
  const [vence, setVence] = useState('')
  const [detalle, setDetalle] = useState('')
  const [confirmo, setConfirmo] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [verif, setVerif] = useState<{ confirmado: boolean; metodo: MetodoVerificacion | ''; observacion: string }>(
    { confirmado: false, metodo: vistoEnApp ? 'visor_app' : '', observacion: '' })
  const faltaVerif = faltaVerificacion({ ...verif, vistoEnApp })
  // Si abre el original en el visor después de empezar a confirmar, se registra.
  useEffect(() => { if (vistoEnApp) setVerif(v => (v.metodo ? v : { ...v, metodo: 'visor_app' })) }, [vistoEnApp])
  const t = tipos.find(x => x.codigo === tipo)
  const exigeConfirmacion = p.estado === 'conflicto' || (persona && persona.id !== p.sugerido?.id) || persona?.dniRepetido

  useEffect(() => {
    if (busqueda.trim().length < 3) { setResultados([]); return }
    const h = setTimeout(() => { void buscarPersona(busqueda).then(setResultados) }, 300)
    return () => clearTimeout(h)
  }, [busqueda])

  const guardar = async () => {
    setOcupado(true); setError(null)
    const e = await resolverPropuesta(p.id, 'aceptar', {
      empleadoId: persona?.id, tipo, fechaEmision: fecha, venceEl: t?.campo_vencimiento === 'declarado' ? vence : null,
      detalle, motivo, confirmoDniDistinto: confirmo,
      verificacion: verif.metodo || null, observacion: verif.observacion,
    })
    setOcupado(false)
    if (e) setError(e); else onListo()
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #334155' }}>
      <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.45 }}>
        Confirmás <b style={{ color: '#cbd5e1' }}>de quién es</b> el documento y qué es. Esto no lo valida: la validación del legajo se hace después, en Documentación.
      </div>
      <span style={etiqueta}>Persona {p.sugerido ? '(si no es la sugerida, tocá «Cambiar»)' : ''}</span>
      {persona
        ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <b style={{ color: '#e2e8f0', fontSize: 14 }}>{persona.texto}</b>
            {persona.dniRepetido && <span style={{ color: '#fbbf24', fontSize: 12 }}>DNI repetido en la app</span>}
            <button type="button" style={boton('sec')} onClick={() => setPersona(null)}>Cambiar</button>
          </div>
        : <>
            <input style={input} placeholder="Buscar por apellido, DNI o legajo" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
            {resultados.map(r => (
              <button key={r.id} type="button" onClick={() => { setPersona({ id: r.id, texto: `${r.apellido}, ${r.nombre}${r.legajo ? ` · ${r.legajo}` : ''}`, dniRepetido: r.dni_repetido }); setBusqueda('') }}
                style={{ ...boton('sec'), display: 'block', width: '100%', textAlign: 'left', marginTop: 4 }}>
                {r.apellido}, {r.nombre}{r.legajo ? ` · ${r.legajo}` : ''}{r.estado !== 'activo' ? ' (baja)' : ''}{r.dni_repetido ? ' · DNI repetido' : ''}
              </button>
            ))}
          </>}
      <span style={etiqueta}>Tipo de documento</span>
      <select style={input} value={tipo} onChange={e => setTipo(e.target.value)}>
        <option value="">Elegí…</option>
        {tipos.map(x => <option key={x.codigo} value={x.codigo}>{x.nombre}</option>)}
      </select>
      {t && t.campo_fecha !== 'no' && (<><span style={etiqueta}>Fecha {t.campo_fecha === 'obligatoria' ? '*' : '(si figura)'}</span>
        <input type="date" style={input} value={fecha} onChange={e => setFecha(e.target.value)} /></>)}
      {t?.campo_vencimiento === 'declarado' && (<><span style={etiqueta}>Vence el (como figura en el documento) *</span>
        <input type="date" style={input} value={vence} onChange={e => setVence(e.target.value)} /></>)}
      {t?.etiqueta_detalle && (<><span style={etiqueta}>{t.etiqueta_detalle}{t.multiple ? ' *' : ''}</span>
        <input style={input} value={detalle} maxLength={200} onChange={e => setDetalle(e.target.value)} /></>)}
      {exigeConfirmacion && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.35)' }}>
          <label style={{ display: 'flex', gap: 8, fontSize: 13, color: '#fbbf24' }}>
            <input type="checkbox" checked={confirmo} onChange={e => setConfirmo(e.target.checked)} />
            Verifiqué a mano que el documento es de esta persona (no es una asociación automática).
          </label>
          <input style={{ ...input, marginTop: 6 }} placeholder="Cómo lo verificaste" value={motivo} maxLength={300} onChange={e => setMotivo(e.target.value)} />
        </div>
      )}
      <Verificacion vistoEnApp={vistoEnApp} valor={verif} onCambio={setVerif} />
      {faltaVerif && verif.confirmado && <div style={{ color: '#fbbf24', fontSize: 12.5, marginTop: 6 }}>{faltaVerif}</div>}
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 6 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button type="button" style={boton('ok', !ocupado && !!persona && !!tipo && !faltaVerif)} disabled={ocupado || !persona || !tipo || !!faltaVerif} onClick={() => void guardar()}>
          {ocupado ? 'Guardando…' : 'Confirmar persona y tipo'}
        </button>
        <button type="button" style={boton('sec')} onClick={onCancelar}>Cancelar</button>
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>Confirmar vincula el archivo de MEGA al legajo de la persona, sin copiarlo. No lo da por válido: queda como referencia histórica.</div>
    </div>
  )
}

function ConTexto({ etiquetaBoton, placeholder, onConfirmar, onCancelar, tono = 'peligro' }: { etiquetaBoton: string; placeholder: string; onConfirmar: (t: string) => Promise<string | null>; onCancelar: () => void; tono?: 'peligro' | 'sec' }) {
  const [t, setT] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <div style={{ marginTop: 10 }}>
      <input style={input} placeholder={placeholder} value={t} maxLength={300} onChange={e => setT(e.target.value)} />
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 6 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" style={boton(tono, t.trim().length >= 1)} disabled={!t.trim()} onClick={async () => { const e = await onConfirmar(t.trim()); if (e) setError(e) }}>{etiquetaBoton}</button>
        <button type="button" style={boton('sec')} onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}

function Historial({ id }: { id: string }) {
  const [r, setR] = useState<{ eventos: EventoHistorico[]; error: string | null } | null>(null)
  useEffect(() => { void cargarEventosHistorico(id).then(setR) }, [id])
  if (!r) return <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 6 }}>Cargando historial…</div>
  if (r.error) return <div role="alert" style={{ fontSize: 12.5, color: '#fca5a5', marginTop: 6 }}>{r.error}</div>
  return (
    <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, color: '#94a3b8' }}>
      {r.eventos.map((e, i) => (
        <li key={i}>
          {new Date(e.at).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })} · {EVENTO_HISTORICO[e.evento] ?? e.evento}
          {e.quien ? ` · ${e.quien}` : ' · sistema'}
        </li>
      ))}
    </ul>
  )
}

/**
 * Confirmación en lote: vista previa, selección y confirmación expresa. Sólo
 * entran las inequívocas que no piden ningún dato (motivoFueraDeLote); la base
 * vuelve a controlar cada una y registra quién confirmó. Asocia, no valida.
 */
function ConfirmarLote({ propuestas, tipos, onListo }: { propuestas: PropuestaHistorica[]; tipos: TipoBandeja[]; onListo: () => void }) {
  const aptas = propuestas.filter(p => motivoFueraDeLote(p, tipos) === null)
  const fuera = propuestas.length - aptas.length
  const [abierto, setAbierto] = useState(false)
  const [elegidas, setElegidas] = useState<Set<string>>(new Set())
  const [entiendo, setEntiendo] = useState(false)
  const [metodo, setMetodo] = useState<MetodoVerificacion | ''>('')
  const [observacion, setObservacion] = useState('')
  const [avance, setAvance] = useState<number | null>(null)
  const [resultado, setResultado] = useState<{ ok: number; errores: { archivo: string; error: string }[] } | null>(null)
  if (!aptas.length && !resultado) return null
  const abrir = () => { setElegidas(new Set(aptas.map(p => p.id))); setEntiendo(false); setResultado(null); setAbierto(true) }
  const confirmar = async () => {
    const lista = aptas.filter(p => elegidas.has(p.id))
    setAvance(0)
    if (!metodo) return
    const r = await confirmarEnLote(lista, { metodo, observacion }, setAvance)
    setAvance(null); setAbierto(false)
    setResultado({ ok: r.ok.length, errores: r.errores.map(e => ({ archivo: nombreArchivo(lista.find(p => p.id === e.id)?.ruta_origen ?? ''), error: e.error })) })
    onListo()
  }
  return (
    <div style={{ ...card, borderColor: 'rgba(34,197,94,.35)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ fontSize: 13.5, color: '#cbd5e1' }}>
          <b>{aptas.length}</b> propuesta(s) inequívocas se pueden confirmar en lote{fuera ? ` · ${fuera} necesitan revisión una por una` : ''}.
        </div>
        {!abierto && aptas.length > 0 && <button type="button" style={boton('sec')} onClick={abrir}>Revisar lote</button>}
      </div>
      {resultado && (
        <div style={{ fontSize: 13, color: resultado.errores.length ? '#fbbf24' : '#86efac', marginTop: 6 }}>
          Confirmadas {resultado.ok}.{resultado.errores.length ? ` No se pudieron confirmar ${resultado.errores.length}:` : ''}
          {resultado.errores.map((e, i) => <div key={i} style={{ color: '#fca5a5', fontSize: 12.5 }}>{e.archivo}: {e.error}</div>)}
        </div>
      )}
      {abierto && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 6 }}>Vista previa. Destildá lo que no quieras confirmar.</div>
          <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #1e2d42', borderRadius: 8 }}>
            {aptas.map(p => (
              <label key={p.id} style={{ display: 'flex', gap: 8, padding: '6px 8px', borderBottom: '1px solid #1e293b', fontSize: 13, color: '#cbd5e1', alignItems: 'flex-start' }}>
                <input type="checkbox" checked={elegidas.has(p.id)} onChange={e => setElegidas(prev => { const n = new Set(prev); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n })} />
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  <b>{nombreArchivo(p.ruta_origen)}</b> → {tipos.find(t => t.codigo === p.tipo_sugerido)?.nombre} de {p.sugerido?.apellido}, {p.sugerido?.nombre}
                </span>
              </label>
            ))}
          </div>
          <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: 'rgba(59,130,246,.07)', border: '1px solid rgba(59,130,246,.3)' }}>
            <div style={{ fontSize: 12.5, color: '#93c5fd', fontWeight: 700 }}>Verificación de los documentos originales</div>
            <div style={{ fontSize: 12.5, color: '#fbbf24', marginTop: 4 }}>⚠ En lote no se registra el visor de la app: indicá cómo revisaste los originales y explicalo.</div>
            <select style={{ ...input, marginTop: 6 }} value={metodo} aria-label="Método de verificación del lote" onChange={e => setMetodo(e.target.value as MetodoVerificacion | '')}>
              <option value="">¿Cómo los verificaste?</option>
              {METODOS_VERIFICACION.filter(([k]) => k !== 'visor_app').map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
            <input style={{ ...input, marginTop: 6 }} maxLength={500} value={observacion} onChange={e => setObservacion(e.target.value)}
              placeholder="Cómo los verificaste (obligatorio, mín. 10 caracteres)" />
          </div>
          <label style={{ display: 'flex', gap: 8, fontSize: 13, color: '#fbbf24', marginTop: 8 }}>
            <input type="checkbox" checked={entiendo} onChange={e => setEntiendo(e.target.checked)} />
            Comprobé el contenido de los {elegidas.size} documentos originales y confirmo su asociación. Entiendo que no valida los documentos: siguen sin validar hasta su revisión en Documentación.
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" style={boton('ok', entiendo && !!metodo && observacion.trim().length >= 10 && elegidas.size > 0 && avance === null)}
              disabled={!entiendo || !metodo || observacion.trim().length < 10 || !elegidas.size || avance !== null} onClick={() => void confirmar()}>
              {avance !== null ? `Confirmando… ${avance}/${elegidas.size}` : `Confirmar ${elegidas.size}`}
            </button>
            <button type="button" style={boton('sec')} disabled={avance !== null} onClick={() => setAbierto(false)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Corregir o quitar la categoría SUGERIDA (no acepta nada; queda en el historial). */
function Recategorizar({ p, tipos, onListo, onCancelar }: { p: PropuestaHistorica; tipos: TipoBandeja[]; onListo: () => void; onCancelar: () => void }) {
  const [tipo, setTipo] = useState(p.tipo_sugerido ?? '')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const guardar = async () => {
    const e = await resolverPropuesta(p.id, 'recategorizar', { tipo: tipo || null, motivo })
    if (e) setError(e); else onListo()
  }
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #334155' }}>
      <span style={etiqueta}>Categoría sugerida</span>
      <select style={input} value={tipo} onChange={e => setTipo(e.target.value)} aria-label="Categoría sugerida">
        <option value="">Sin categoría (revisar más adelante)</option>
        {tipos.map(x => <option key={x.codigo} value={x.codigo}>{x.nombre}</option>)}
      </select>
      <input style={{ ...input, marginTop: 6 }} placeholder="Por qué (p. ej.: es una solicitud de empleo, no un embargo)" value={motivo} maxLength={300} onChange={e => setMotivo(e.target.value)} />
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 6 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" style={boton('sec', motivo.trim().length >= 3)} disabled={motivo.trim().length < 3} onClick={() => void guardar()}>Guardar categoría</button>
        <button type="button" style={boton('sec')} onClick={onCancelar}>Cancelar</button>
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>Cambia sólo la sugerencia: la referencia sigue pendiente de revisión.</div>
    </div>
  )
}

/**
 * Una referencia con todo lo necesario para decidir: el original (visor), la
 * persona y el tipo sugeridos, la evidencia y las acciones. En la revisión
 * (`enRevision`) el original se abre solo y, al resolver, se pasa al siguiente.
 */
function Tarjeta({ p, tipos, onCambio, onResuelto, enRevision = false, autoAbrir = false }: {
  p: PropuestaHistorica; tipos: TipoBandeja[]
  /** Cambió algo pero el documento sigue en la lista (p. ej., la categoría sugerida). */
  onCambio: () => void
  /** Se resolvió (o se dejó para investigar): en la revisión, pasa al siguiente. */
  onResuelto?: () => void
  enRevision?: boolean; autoAbrir?: boolean
}) {
  const [modo, setModo] = useState<null | 'aceptar' | 'descartar' | 'separar' | 'recategorizar' | 'investigar'>(null)
  const [verHistorial, setVerHistorial] = useState(false)
  const [verDoc, setVerDoc] = useState(autoAbrir && p.indexado)
  const [vistoEnApp, setVistoEnApp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resuelto = onResuelto ?? onCambio
  const nivel = estadoVisual(p)
  const ident = NIVELES_IDENTIFICACION.find(([k]) => k === nivelIdentificacion(p))?.[1] ?? ''
  const evidencia = [
    typeof p.senales?.identidad === 'string' ? p.senales.identidad : p.dni_sugerido ? `DNI ${p.dni_sugerido} (único en la app)` : null,
    typeof p.senales?.categoria === 'string' ? `categoría por ${p.senales.categoria}` : p.criterio,
  ].filter(Boolean).join(' · ')
  const nombreTipo = (c: string | null) => tipos.find(t => t.codigo === c)?.nombre ?? c ?? 'a definir'
  const revisar = (p.senales?.revisar ?? []).map(r => ETIQUETA_REVISAR[r.split(':')[0]] ?? r)
  const abierta = p.estado === 'pendiente' || p.estado === 'conflicto'
  const investigar = abierta ? marcaInvestigacion(p) : null
  const persona = p.empleado ?? null
  const dato = (titulo: string, valor: React.ReactNode) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em' }}>{titulo}</div>
      <div style={{ fontSize: 14, color: '#e2e8f0', overflowWrap: 'anywhere' }}>{valor}</div>
    </div>
  )
  const borde = p.estado === 'conflicto' ? 'rgba(245,158,11,.4)' : investigar ? 'rgba(168,85,247,.45)' : '#1e2d42'
  const bloqueInfo = (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ color: '#e2e8f0', fontSize: enRevision ? 16 : 14.5, overflowWrap: 'anywhere' }}>{nombreArchivo(p.ruta_origen)}</b>
        <span style={{ fontSize: 12.5, color: nivel.color }}>{investigar ? 'Para investigar' : nivel.texto}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginTop: 8 }}>
        {persona
          ? dato('Persona asociada', <>{persona.apellido}, {persona.nombre}{persona.legajo ? ` · ${persona.legajo}` : ''}
              {p.sugerido && p.sugerido.id !== persona.id && <span style={{ color: '#94a3b8', fontSize: 12 }}> (el sistema sugería {p.sugerido.apellido})</span>}</>)
          : dato('Empleado sugerido', p.sugerido
              ? <>{p.sugerido.apellido}, {p.sugerido.nombre}{p.sugerido.legajo ? ` · ${p.sugerido.legajo}` : ''}{p.sugerido.estado !== 'activo' ? ' (baja)' : ''}</>
              : <span style={{ color: '#fbbf24' }}>Sin persona identificada</span>)}
        {dato(p.estado === 'aceptada' || p.estado === 'importada' ? 'Tipo confirmado' : 'Tipo sugerido',
          <>{nombreTipo(p.estado === 'aceptada' || p.estado === 'importada' ? p.tipo : p.tipo_sugerido)}
            {abierta && <span style={{ fontSize: 12, color: p.confianza === 'alta' ? '#86efac' : p.confianza === 'media' ? '#fbbf24' : '#94a3b8' }} title="Qué tan segura es la categoría sugerida (la identidad se evalúa aparte)"> · confianza {p.confianza}</span>}</>)}
        {dato('Identificación', ident)}
      </div>
      {investigar && (
        <div style={{ fontSize: 13, color: '#d8b4fe', marginTop: 8 }}>
          🔎 Para investigar: {investigar.motivo}{investigar.at ? ` (${new Date(investigar.at).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })})` : ''}
        </div>
      )}
      {p.motivo_conflicto && <div style={{ fontSize: 13, color: '#fbbf24', marginTop: 6 }}>⚠ {p.motivo_conflicto}</div>}
      {evidencia && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6, overflowWrap: 'anywhere' }}>Evidencia: {evidencia}</div>}
      {revisar.length > 0 && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>Señales: {revisar.join(' · ')}</div>}
      <div style={{ fontSize: 12, color: '#64748b', overflowWrap: 'anywhere', marginTop: 2 }}>MEGA: {p.ruta_origen}{p.pagina_desde ? ` · páginas ${p.pagina_desde}–${p.pagina_hasta}` : p.paginas ? ` · ${p.paginas} pág.` : ''}</div>
      {p.tipo_sugerido && !p.tipo && abierta && !tipos.some(t => t.codigo === p.tipo_sugerido) && (
        <div style={{ fontSize: 12.5, color: '#fbbf24', marginTop: 4 }}>La categoría sugerida hoy no se exige en el legajo: al confirmar, elegí otra categoría o descartalo.</div>
      )}
      {!p.indexado && <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 4 }}>El archivo no está en el índice del agente: no se puede abrir ni confirmar hasta reindexar.</div>}
      {p.motivo && <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 4 }}>Motivo: {p.motivo}</div>}
      {p.revisado_por_nombre && !abierta && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Revisado por {p.revisado_por_nombre}{p.revisado_at ? ` el ${new Date(p.revisado_at).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}` : ''}</div>}

    </>
  )
  const bloqueVisor = (
    <>
      {p.indexado && !verDoc && (
        <button type="button" onClick={() => setVerDoc(true)} style={{ ...boton('sec'), display: 'block', marginTop: 10, color: '#93c5fd', borderColor: 'rgba(59,130,246,.5)' }}>
          📄 Abrir el original{(p.paginas ?? 0) > 1 && !p.padre_id ? ' (y separar páginas)' : ''}
        </button>
      )}
      {verDoc && <VisorHistorico p={p} tipos={tipos} onCerrar={() => setVerDoc(false)} onCambio={resuelto} onAbierto={() => setVistoEnApp(true)} />}

    </>
  )
  const bloqueAcciones = (
    <>
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 6 }}>{error}</div>}
      {abierta && modo === null && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button type="button" style={boton('ok', p.indexado)} disabled={!p.indexado} onClick={() => setModo('aceptar')}>
            {p.sugerido || p.empleado ? 'Confirmar persona y tipo' : 'Asignar persona y tipo'}
          </button>
          {!investigar && <button type="button" style={boton('sec')} onClick={() => setModo('investigar')}>Dejar pendiente para investigar</button>}
          {investigar && <button type="button" style={boton('sec')} onClick={async () => { setError(null); const e = await resolverPropuesta(p.id, 'quitar_investigacion'); if (e) setError(e); else resuelto() }}>Quitar marca de investigación</button>}
          <button type="button" style={boton('sec')} onClick={() => setModo('recategorizar')}>Cambiar categoría sugerida</button>
          {!p.padre_id && (p.paginas ?? 0) > 1 && <button type="button" style={boton('sec')} onClick={() => setModo('separar')}>Separar páginas</button>}
          <button type="button" style={boton('peligro')} onClick={() => setModo('descartar')}>Descartar</button>
        </div>
      )}
      {(p.estado === 'aceptada' || p.estado === 'descartada') && modo === null && (
        <button type="button" style={{ ...boton('sec'), marginTop: 10 }} onClick={async () => { setError(null); const e = await resolverPropuesta(p.id, 'reabrir'); if (e) setError(e); else onCambio() }}>Reabrir (vuelve a pendientes)</button>
      )}
      {modo === 'aceptar' && <Aceptar p={p} tipos={tipos} vistoEnApp={vistoEnApp} onListo={() => { setModo(null); resuelto() }} onCancelar={() => setModo(null)} />}
      {modo === 'recategorizar' && <Recategorizar p={p} tipos={tipos} onListo={() => { setModo(null); onCambio() }} onCancelar={() => setModo(null)} />}
      {modo === 'investigar' && <ConTexto tono="sec" etiquetaBoton="Dejar para investigar" placeholder="Qué hay que averiguar (p. ej.: pedir el legajo en papel, consultar a la persona)"
        onConfirmar={t => resolverPropuesta(p.id, 'investigar', { motivo: t }).then(e => { if (!e) { setModo(null); resuelto() } return e })} onCancelar={() => setModo(null)} />}
      {modo === 'descartar' && <ConTexto etiquetaBoton="Descartar" placeholder="Por qué (p. ej.: no es documentación del legajo)"
        onConfirmar={t => resolverPropuesta(p.id, 'descartar', { motivo: t }).then(e => { if (!e) { setModo(null); resuelto() } return e })} onCancelar={() => setModo(null)} />}
      {modo === 'separar' && <ConTexto etiquetaBoton="Separar" placeholder={`Rangos y tipo, p. ej.: 1-2 dni, 3 cuil (tiene ${p.paginas} páginas)`}
        onConfirmar={async t => { const r = leerRangos(t, p.paginas); if (r.error) return r.error; const e = await resolverPropuesta(p.id, 'separar', { rangos: r.rangos }); if (!e) { setModo(null); resuelto() } return e }}
        onCancelar={() => setModo(null)} />}

      <button type="button" onClick={() => setVerHistorial(v => !v)} style={{ background: 'none', border: 'none', color: '#93c5fd', padding: 0, marginTop: 10, fontSize: 12.5, cursor: 'pointer' }}>
        {verHistorial ? 'Ocultar historial' : 'Ver historial'}
      </button>
      {verHistorial && <Historial id={p.id} />}
    </>
  )
  // En la revisión: el original a la izquierda y la decisión a la derecha (en
  // pantallas angostas, uno debajo del otro). Los botones quedan a la vista.
  if (enRevision) return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 12, alignItems: 'start' }}>
      <div style={{ ...card, marginBottom: 0, borderColor: borde }}>{bloqueInfo}{bloqueAcciones}</div>
      <div style={{ minWidth: 0, position: 'sticky', top: 8 }}>{bloqueVisor}</div>
    </div>
  )
  return (
    <div style={{ ...card, borderColor: borde }}>
      {bloqueInfo}
      {bloqueVisor}
      {bloqueAcciones}
    </div>
  )
}

/** Fila compacta de la lista: lo justo para saber qué es y abrir la revisión. */
function Fila({ p, tipos, mostrarPersona, onRevisar }: { p: PropuestaHistorica; tipos: TipoBandeja[]; mostrarPersona: boolean; onRevisar: () => void }) {
  const per = personaDe(p)
  const tipo = p.tipo ?? p.tipo_sugerido
  const inv = (p.estado === 'pendiente' || p.estado === 'conflicto') ? marcaInvestigacion(p) : null
  const nivel = estadoVisual(p)
  return (
    <button type="button" onClick={onRevisar} style={{
      display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8, alignItems: 'center', width: '100%', textAlign: 'left',
      background: '#0f172a', border: '1px solid #1e2d42', borderRadius: 8, padding: '9px 12px', marginBottom: 6, cursor: 'pointer', color: 'inherit',
    }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: '#e2e8f0', overflowWrap: 'anywhere' }}>{nombreArchivo(p.ruta_origen)}</span>
        <span style={{ display: 'block', fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>
          {mostrarPersona && <>{per ? `${per.apellido}, ${per.nombre}` : <span style={{ color: '#fbbf24' }}>Sin persona</span>} · </>}
          {tipos.find(t => t.codigo === tipo)?.nombre ?? tipo ?? 'sin tipo'}
          {' · '}<span style={{ color: inv ? '#d8b4fe' : nivel.color }}>{inv ? 'para investigar' : nivel.texto.split(' · ')[0].toLowerCase()}</span>
        </span>
      </span>
      <span style={{ fontSize: 13, color: '#93c5fd', fontWeight: 700, whiteSpace: 'nowrap' }}>Revisar →</span>
    </button>
  )
}

const LS_AUTOABRIR = 'mercosur.revision.autoAbrir'
const CREDENCIAL = '(credencial)'

export default function BandejaHistorico({ busquedaInicial, categoriaInicial, verInicial }: { busquedaInicial?: string; categoriaInicial?: string; verInicial?: FiltroRevision } = {}) {
  const [filtro, setFiltro] = useState<FiltroRevision>(verInicial ?? 'pendientes')
  // Desde el legajo de una persona o la matriz llega su id: se filtra por persona
  // (sin poner nombre ni DNI en la dirección) y se muestra su nombre.
  const [persona, setPersona] = useState<{ id: string; nombre: string | null } | null>(
    busquedaInicial && esIdPersona(busquedaInicial) ? { id: busquedaInicial.toLowerCase(), nombre: null } : null)
  const [texto, setTexto] = useState(busquedaInicial && !esIdPersona(busquedaInicial) ? busquedaInicial : '')
  const [buscarTexto, setBuscarTexto] = useState(texto)
  const buscar = buscarTexto.trim().length >= 3 ? buscarTexto : (persona?.id ?? buscarTexto)
  useEffect(() => { if (persona && !persona.nombre) void nombrePersona(persona.id).then(n => setPersona(p => (p && p.id === persona.id ? { ...p, nombre: n } : p))) }, [persona])
  const [datos, setDatos] = useState<Bandeja | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargandoMas, setCargandoMas] = useState(false)
  // Desde el menú se empieza por lo que hace falta para la credencial (no por
  // cartas documento, sanciones o expedientes); con «Todos los tipos» se ve el resto.
  const [categoria, setCategoria] = useState(categoriaInicial ?? CREDENCIAL)
  const [nivel, setNivel] = useState<NivelIdentificacion | ''>('')
  const [agrupar, setAgrupar] = useState(true)
  const [revision, setRevision] = useState<{ cola: string[]; actual: string } | null>(null)
  const [finRevision, setFinRevision] = useState(false)
  const [autoAbrir, setAutoAbrir] = useState(true)
  useEffect(() => { try { if (localStorage.getItem(LS_AUTOABRIR) === 'no') setAutoAbrir(false) } catch { /* sin almacenamiento */ } }, [])
  const cambiarAutoAbrir = (v: boolean) => { setAutoAbrir(v); try { localStorage.setItem(LS_AUTOABRIR, v ? 'si' : 'no') } catch { /* sin almacenamiento */ } }
  const buscando = buscar.trim().length >= 3
  // Sin búsqueda: las abiertas (pendientes, conflictos, para investigar) o las revisadas.
  // Los contadores de las abiertas salen siempre de su lista; el de revisadas, de la base.
  const estadoRpc = buscando ? 'pendiente' : filtro === 'revisadas' ? 'revisadas' : 'abiertas'
  const [conteos, setConteos] = useState<Record<FiltroRevision, number> | null>(null)
  const cargar = useCallback(async () => {
    if (buscando) {
      const r = await cargarBandeja('pendiente', buscar)
      setDatos(r.datos); setError(r.error)
      if (r.datos) setConteos(contarRevision(r.datos.propuestas))
      return r.datos
    }
    const [a, rv] = await Promise.all([cargarBandeja('abiertas'), estadoRpc === 'revisadas' ? cargarBandeja('revisadas') : Promise.resolve(null)])
    const r = rv ?? a
    setDatos(r.datos); setError(a.error ?? r.error)
    if (a.datos) {
      const k = a.datos.conteo
      setConteos({ ...contarRevision(a.datos.propuestas), revisadas: (k.aceptada ?? 0) + (k.importada ?? 0) + (k.descartada ?? 0) })
    }
    return r.datos
  }, [estadoRpc, buscar, buscando])
  useEffect(() => { void cargar() }, [cargar])
  useEffect(() => { const t = setTimeout(() => setBuscarTexto(texto), 350); return () => clearTimeout(t) }, [texto])
  const cargarMas = async () => {
    if (!datos) return
    setCargandoMas(true)
    const r = await cargarBandeja(estadoRpc, buscar, datos.propuestas.length)
    setCargandoMas(false)
    if (r.error || !r.datos) { setError(r.error); return }
    const vistos = new Set(datos.propuestas.map(p => p.id))
    setDatos({ ...r.datos, propuestas: [...datos.propuestas, ...r.datos.propuestas.filter(p => !vistos.has(p.id))] })
  }
  const total = datos?.total ?? datos?.propuestas.length ?? 0
  const filtrar = (lista: PropuestaHistorica[]) => filtrarHistorico(lista.filter(p => enFiltroRevision(p, filtro)
    && (categoria !== CREDENCIAL || (TIPOS_HABILITACION as readonly string[]).includes(categoriaDe(p) ?? ''))), {
    categoria: categoria === CREDENCIAL ? '' : categoria, nivel, activas: datos?.tipos.map(t => t.codigo) ?? [],
  })
  const visibles = datos ? filtrar(datos.propuestas) : []
  const grupos = agrupar ? agruparPorEmpleado(visibles) : [{ clave: 'todo', nombre: '', items: visibles }]
  const numero = (k: FiltroRevision) => conteos?.[k] ?? 0
  const control: React.CSSProperties = { background: '#0b1220', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '7px 8px', fontSize: 13, minWidth: 0, maxWidth: '100%' }

  // Revisión uno por uno: la cola es la lista visible al empezar (en el orden de la
  // pantalla, por persona si está agrupada). Al resolver, se recarga y se pasa al
  // siguiente que siga en la lista; lo resuelto sale solo.
  const ordenVisible = grupos.flatMap(g => g.items.map(p => p.id))
  const empezar = (desde: string, cola = ordenVisible) => { setFinRevision(false); setRevision({ cola, actual: desde }); window.scrollTo({ top: 0 }) }
  const pasar = async (resolvio: boolean) => {
    if (!revision) return
    const lista = resolvio ? await cargar() : datos
    const vigentes = new Set(lista ? filtrar(lista.propuestas).map(p => p.id) : [])
    const sig = siguienteEnCola(revision.cola, revision.actual, vigentes)
    if (sig) setRevision({ ...revision, actual: sig })
    else { setRevision(null); setFinRevision(true) }
    window.scrollTo({ top: 0 })
  }
  const anterior = () => {
    if (!revision) return
    const vig = new Set(visibles.map(p => p.id))
    const i = revision.cola.indexOf(revision.actual)
    for (let j = i - 1; j >= 0; j--) if (vig.has(revision.cola[j])) { setRevision({ ...revision, actual: revision.cola[j] }); return }
  }

  if (revision && datos) {
    const p = datos.propuestas.find(x => x.id === revision.actual)
    const enCola = revision.cola.filter(id => visibles.some(v => v.id === id))
    const pos = enCola.indexOf(revision.actual) + 1
    return (
      <div style={{ maxWidth: 1280, margin: '0 auto', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button type="button" style={boton('sec')} onClick={() => { setRevision(null); void cargar() }}>← Volver a la lista</button>
          <div style={{ flex: 1, minWidth: 120, fontSize: 14, color: '#cbd5e1', textAlign: 'center' }}>
            Documento <b>{pos || '—'}</b> de <b>{enCola.length}</b> por revisar en esta tanda · {FILTROS_REVISION.find(([k]) => k === filtro)?.[1]}
          </div>
          <button type="button" style={boton('sec', pos > 1)} disabled={pos <= 1} onClick={anterior}>Anterior</button>
          <button type="button" style={boton('sec')} onClick={() => void pasar(false)}>Siguiente (sin cambios) →</button>
        </div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: '#94a3b8', marginBottom: 8 }}>
          <input type="checkbox" checked={autoAbrir} onChange={e => cambiarAutoAbrir(e.target.checked)} /> Abrir el original automáticamente al pasar de documento
        </label>
        {p
          ? <Tarjeta key={p.id} p={p} tipos={datos.tipos} enRevision autoAbrir={autoAbrir}
              onCambio={() => void cargar()} onResuelto={() => void pasar(true)} />
          : <div style={{ ...card, color: '#94a3b8' }}>Este documento ya no está en la lista (lo resolvió otra persona). <button type="button" style={boton('sec')} onClick={() => void pasar(false)}>Siguiente →</button></div>}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', minWidth: 0 }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: '#e2e8f0' }}>Revisión documental (MEGA)</div>
      <div style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0 12px', lineHeight: 1.5 }}>
        Documentos encontrados en MEGA para revisar sin entrar a cada legajo: abrí el original, confirmá <b style={{ color: '#cbd5e1' }}>de quién es</b> y
        pasá al siguiente. Confirmar la persona <b style={{ color: '#cbd5e1' }}>no valida</b> el documento: la validación del legajo se hace después, en Documentación.
      </div>
      <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Buscar por apellido, DNI, legajo o nombre del archivo"
        style={{ width: '100%', boxSizing: 'border-box', background: '#0b1220', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '10px 12px', fontSize: 14, marginBottom: 10 }} />
      {persona && buscar === persona.id && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, color: '#cbd5e1', margin: '0 2px 10px' }}>
          <span>Documentos de <b>{persona.nombre ?? 'la persona elegida'}</b></span>
          <button type="button" onClick={() => setPersona(null)} style={{ background: 'none', border: '1px solid #334155', borderRadius: 8, color: '#93c5fd', padding: '3px 8px', fontSize: 12, cursor: 'pointer' }}>Ver todos</button>
        </div>
      )}
      {buscando && !(persona && buscar === persona.id) && <div style={{ fontSize: 13, color: '#94a3b8', margin: '0 2px 10px' }}>{total} resultado(s) para “{buscar.trim()}”</div>}
      <div role="tablist" aria-label="Lista" style={{ display: 'flex', gap: 4, borderBottom: '1px solid #1e2d42', marginBottom: 12, overflowX: 'auto' }}>
        {FILTROS_REVISION.map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={filtro === k} onClick={() => setFiltro(k)} style={{
            background: 'none', border: 'none', borderBottom: filtro === k ? '2px solid #f59e0b' : '2px solid transparent',
            color: filtro === k ? '#f59e0b' : '#94a3b8', padding: '10px 12px', fontSize: 13.5, fontWeight: filtro === k ? 700 : 400, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{t} ({numero(k)})</button>
        ))}
      </div>
      {error && <div style={{ ...card, color: '#fca5a5' }}>{error}</div>}
      {!datos && !error && <div style={{ color: '#64748b', padding: 24 }}>Cargando…</div>}
      {finRevision && datos && <div style={{ ...card, color: '#86efac' }}>{visibles.length
        ? `✓ Terminaste esa tanda. Quedan ${visibles.length} en esta lista.`
        : '✓ No quedan documentos en esta lista. Buen trabajo.'}</div>}
      {datos && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          {visibles.length > 0 && (
            <button type="button" style={boton('ok')} onClick={() => empezar(ordenVisible[0])}>
              Revisar uno por uno ({visibles.length})
            </button>
          )}
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: '#94a3b8' }}>
            <input type="checkbox" checked={agrupar} onChange={e => setAgrupar(e.target.checked)} /> Agrupar por empleado
          </label>
          <select value={categoria} onChange={e => setCategoria(e.target.value)} aria-label="Tipo de documento" style={control}>
            <option value={CREDENCIAL}>Requisitos de la credencial</option>
            <option value="">Todos los tipos</option>
            <option value="(sin)">Sin tipo</option>
            <option value="(fuera)">Tipo que hoy no se exige</option>
            {datos.tipos.filter(t => datos.propuestas.some(p => categoriaDe(p) === t.codigo)).map(t => <option key={t.codigo} value={t.codigo}>{t.nombre}</option>)}
          </select>
          <select value={nivel} onChange={e => setNivel(e.target.value as NivelIdentificacion | '')} aria-label="Nivel de identificación" style={control}>
            <option value="">Cualquier identificación</option>
            {NIVELES_IDENTIFICACION.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </div>
      )}
      {datos && !buscando && filtro === 'pendientes' && <ConfirmarLote propuestas={visibles} tipos={datos.tipos} onListo={() => void cargar()} />}
      {datos && categoria === CREDENCIAL && (
        <div style={{ fontSize: 12.5, color: '#94a3b8', margin: '0 2px 10px' }}>
          Mostrando los requisitos de la credencial (DNI, alta ARCA, antecedentes, estudios médicos, credencial).{' '}
          <button type="button" onClick={() => setCategoria('')} style={{ background: 'none', border: 'none', color: '#93c5fd', padding: 0, fontSize: 12.5, cursor: 'pointer' }}>Ver todos los tipos</button>
        </div>
      )}
      {datos && visibles.length === 0 && <div style={{ ...card, color: '#94a3b8' }}>No hay documentos en esta lista{categoria || nivel ? ' con estos filtros' : ''}.</div>}
      {grupos.map(g => (
        <div key={g.clave} style={{ marginBottom: agrupar ? 14 : 0 }}>
          {agrupar && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '4px 2px 6px' }}>
              <b style={{ color: g.clave === '(sin)' ? '#fbbf24' : '#e2e8f0', fontSize: 14.5 }}>{g.nombre} <span style={{ color: '#64748b', fontWeight: 400 }}>· {g.items.length}</span></b>
              {g.items.length > 1 && <button type="button" style={{ ...boton('sec'), padding: '4px 10px', fontSize: 12.5 }} onClick={() => empezar(g.items[0].id, g.items.map(p => p.id))}>Revisar sus {g.items.length}</button>}
            </div>
          )}
          {g.items.map(p => <Fila key={p.id} p={p} tipos={datos?.tipos ?? []} mostrarPersona={!agrupar} onRevisar={() => empezar(p.id)} />)}
        </div>
      ))}
      {datos && total > datos.propuestas.length && (
        <button type="button" style={{ ...boton('sec', !cargandoMas), width: '100%' }} disabled={cargandoMas} onClick={() => void cargarMas()}>
          {cargandoMas ? 'Cargando…' : `Cargar más (${datos.propuestas.length} de ${total})`}
        </button>
      )}
    </div>
  )
}
