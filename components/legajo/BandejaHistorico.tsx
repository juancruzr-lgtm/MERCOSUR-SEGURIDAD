'use client'

/**
 * components/legajo/BandejaHistorico.tsx
 *
 * Archivo histórico (MEGA) → legajo. Cada archivo clasificado llega como una
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
import {
  ESTADOS_VISUALES, EVENTO_HISTORICO, NIVELES_IDENTIFICACION, buscarPersona, cargarBandeja, cargarEventosHistorico, categoriaDe,
  confirmarEnLote, estadoVisual, filtrarHistorico, leerRangos, motivoFueraDeLote, nivelIdentificacion, resolverPropuesta, tienePersona,
} from '@/lib/legajo-historico'
import type {
  Bandeja, EstadoPropuesta, EstadoVisual, EventoHistorico, NivelIdentificacion, PersonaBuscada, PropuestaHistorica, TipoBandeja,
} from '@/lib/legajo-historico'

const card: React.CSSProperties = { background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 14, marginBottom: 10, minWidth: 0, boxSizing: 'border-box' }
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#0b1220', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '9px 10px', fontSize: 14 }
const etiqueta: React.CSSProperties = { fontSize: 12, color: '#94a3b8', display: 'block', margin: '8px 0 4px' }
const boton = (t: 'ok' | 'sec' | 'peligro', hab = true): React.CSSProperties => ({
  background: !hab ? '#334155' : t === 'ok' ? '#16a34a' : 'transparent', color: !hab ? '#64748b' : t === 'ok' ? '#fff' : t === 'peligro' ? '#fca5a5' : '#cbd5e1',
  border: t === 'ok' ? 'none' : t === 'peligro' ? '1px solid rgba(239,68,68,.5)' : '1px solid #334155',
  borderRadius: 8, padding: '8px 14px', fontWeight: t === 'ok' ? 800 : 600, cursor: hab ? 'pointer' : 'not-allowed', fontSize: 13.5,
})
const PESTAÑAS: [EstadoPropuesta, string][] = [
  ['pendiente', 'Para revisar'], ['conflicto', 'Con conflicto'], ['aceptada', 'Asociadas (sin validar)'],
  ['importada', 'Copiadas al legajo'], ['descartada', 'Descartadas'],
]
const ETIQUETA_REVISAR: Record<string, string> = {
  varias_personas: 'varias personas', compilado_varios_documentos: 'PDF compilado', persona_distinta_a_carpeta: 'DNI ≠ carpeta',
  ocr_ilegible: 'escaneo ilegible', sin_texto: 'sin texto', sin_tipo: 'sin tipo', sin_persona: 'sin persona',
}

function nombreArchivo(ruta: string) { return ruta.split('/').pop() ?? ruta }

function Aceptar({ p, tipos, onListo, onCancelar }: { p: PropuestaHistorica; tipos: TipoBandeja[]; onListo: () => void; onCancelar: () => void }) {
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
    })
    setOcupado(false)
    if (e) setError(e); else onListo()
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #334155' }}>
      <span style={etiqueta}>Persona</span>
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
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 6 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button type="button" style={boton('ok', !ocupado && !!persona && !!tipo)} disabled={ocupado || !persona || !tipo} onClick={() => void guardar()}>
          {ocupado ? 'Guardando…' : 'Aceptar'}
        </button>
        <button type="button" style={boton('sec')} onClick={onCancelar}>Cancelar</button>
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>Aceptar vincula el archivo de MEGA al legajo de la persona, sin copiarlo. No lo da por válido: queda como referencia histórica.</div>
    </div>
  )
}

function ConTexto({ etiquetaBoton, placeholder, onConfirmar, onCancelar }: { etiquetaBoton: string; placeholder: string; onConfirmar: (t: string) => Promise<string | null>; onCancelar: () => void }) {
  const [t, setT] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <div style={{ marginTop: 10 }}>
      <input style={input} placeholder={placeholder} value={t} onChange={e => setT(e.target.value)} />
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 6 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" style={boton('peligro', t.trim().length >= 1)} disabled={!t.trim()} onClick={async () => { const e = await onConfirmar(t.trim()); if (e) setError(e) }}>{etiquetaBoton}</button>
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
  const [avance, setAvance] = useState<number | null>(null)
  const [resultado, setResultado] = useState<{ ok: number; errores: { archivo: string; error: string }[] } | null>(null)
  if (!aptas.length && !resultado) return null
  const abrir = () => { setElegidas(new Set(aptas.map(p => p.id))); setEntiendo(false); setResultado(null); setAbierto(true) }
  const confirmar = async () => {
    const lista = aptas.filter(p => elegidas.has(p.id))
    setAvance(0)
    const r = await confirmarEnLote(lista, setAvance)
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
          <label style={{ display: 'flex', gap: 8, fontSize: 13, color: '#fbbf24', marginTop: 8 }}>
            <input type="checkbox" checked={entiendo} onChange={e => setEntiendo(e.target.checked)} />
            Confirmo la asociación de estas {elegidas.size} referencias. Entiendo que no valida los documentos: siguen sin validar hasta su revisión en Documentación.
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" style={boton('ok', entiendo && elegidas.size > 0 && avance === null)} disabled={!entiendo || !elegidas.size || avance !== null} onClick={() => void confirmar()}>
              {avance !== null ? `Confirmando… ${avance}/${elegidas.size}` : `Confirmar ${elegidas.size}`}
            </button>
            <button type="button" style={boton('sec')} disabled={avance !== null} onClick={() => setAbierto(false)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Tarjeta({ p, tipos, onCambio }: { p: PropuestaHistorica; tipos: TipoBandeja[]; onCambio: () => void }) {
  const [modo, setModo] = useState<null | 'aceptar' | 'descartar' | 'separar'>(null)
  const [verHistorial, setVerHistorial] = useState(false)
  const [verDoc, setVerDoc] = useState(false)
  const nivel = estadoVisual(p)
  const ident = NIVELES_IDENTIFICACION.find(([k]) => k === nivelIdentificacion(p))?.[1] ?? ''
  const evidencia = [
    typeof p.senales?.identidad === 'string' ? p.senales.identidad : p.dni_sugerido ? `DNI ${p.dni_sugerido} (único en la app)` : null,
    typeof p.senales?.categoria === 'string' ? `categoría por ${p.senales.categoria}` : p.criterio,
  ].filter(Boolean).join(' · ')
  const nombreTipo = (c: string | null) => tipos.find(t => t.codigo === c)?.nombre ?? c ?? 'a definir'
  const revisar = (p.senales?.revisar ?? []).map(r => ETIQUETA_REVISAR[r.split(':')[0]] ?? r)
  const abierta = p.estado === 'pendiente' || p.estado === 'conflicto'
  return (
    <div style={{ ...card, borderColor: p.estado === 'conflicto' ? 'rgba(245,158,11,.4)' : '#1e2d42' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ color: '#e2e8f0', fontSize: 14.5, overflowWrap: 'anywhere' }}>{nombreArchivo(p.ruta_origen)}</b>
        <span style={{ fontSize: 12, color: p.confianza === 'alta' ? '#86efac' : p.confianza === 'media' ? '#fbbf24' : '#94a3b8' }}>confianza {p.confianza}</span>
      </div>
      <div style={{ fontSize: 12, color: nivel.color, marginTop: 2 }}>
        {nivel.texto} · identificación {ident.toLowerCase()}
      </div>
      {evidencia && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2, overflowWrap: 'anywhere' }}>Evidencia: {evidencia}</div>}
      <div style={{ fontSize: 12, color: '#64748b', overflowWrap: 'anywhere', marginTop: 2 }}>MEGA: {p.ruta_origen}{p.pagina_desde ? ` · páginas ${p.pagina_desde}–${p.pagina_hasta}` : p.paginas ? ` · ${p.paginas} pág.` : ''}</div>
      <div style={{ fontSize: 13.5, color: '#cbd5e1', marginTop: 6 }}>
        {p.estado === 'aceptada' || p.estado === 'importada'
          ? <>Aceptado como <b>{nombreTipo(p.tipo)}</b></>
          : <>Sugerido: <b>{nombreTipo(p.tipo_sugerido)}</b> de <b>{p.sugerido ? `${p.sugerido.apellido}, ${p.sugerido.nombre}` : 'persona a definir'}</b></>}
      </div>
      {p.tipo_sugerido && !p.tipo && !tipos.some(t => t.codigo === p.tipo_sugerido) && (
        <div style={{ fontSize: 12.5, color: '#fbbf24', marginTop: 4 }}>La categoría sugerida hoy no se exige en el legajo: al aceptar, elegí otra categoría o descartalo.</div>
      )}
      {p.motivo_conflicto && <div style={{ fontSize: 13, color: '#fbbf24', marginTop: 4 }}>⚠ {p.motivo_conflicto}</div>}
      {revisar.length > 0 && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Señales: {revisar.join(' · ')}</div>}
      {!p.indexado && <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 4 }}>El archivo no está en el índice del agente: no se puede aceptar hasta reindexar.</div>}
      {p.motivo && <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 4 }}>Motivo: {p.motivo}</div>}
      <button type="button" onClick={() => setVerHistorial(v => !v)} style={{ background: 'none', border: 'none', color: '#93c5fd', padding: 0, marginTop: 6, fontSize: 12.5, cursor: 'pointer' }}>
        {verHistorial ? 'Ocultar historial' : 'Ver historial'}
      </button>
      {verHistorial && <Historial id={p.id} />}
      {p.indexado && !verDoc && (
        <button type="button" onClick={() => setVerDoc(true)} style={{ display: 'block', background: 'none', border: 'none', color: '#93c5fd', padding: 0, marginTop: 6, fontSize: 12.5, cursor: 'pointer' }}>
          Ver documento{(p.paginas ?? 0) > 1 && !p.padre_id ? ' y asignar páginas' : ''}
        </button>
      )}
      {verDoc && <VisorHistorico p={p} tipos={tipos} onCerrar={() => setVerDoc(false)} onCambio={onCambio} />}

      {abierta && modo === null && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button type="button" style={boton('ok', p.indexado)} disabled={!p.indexado} onClick={() => setModo('aceptar')}>Revisar y aceptar</button>
          {!p.padre_id && (p.paginas ?? 0) > 1 && <button type="button" style={boton('sec')} onClick={() => setModo('separar')}>Separar páginas</button>}
          <button type="button" style={boton('peligro')} onClick={() => setModo('descartar')}>Descartar</button>
        </div>
      )}
      {(p.estado === 'aceptada' || p.estado === 'descartada') && modo === null && (
        <button type="button" style={{ ...boton('sec'), marginTop: 10 }} onClick={async () => { const e = await resolverPropuesta(p.id, 'reabrir'); if (!e) onCambio() }}>Reabrir</button>
      )}
      {modo === 'aceptar' && <Aceptar p={p} tipos={tipos} onListo={() => { setModo(null); onCambio() }} onCancelar={() => setModo(null)} />}
      {modo === 'descartar' && <ConTexto etiquetaBoton="Descartar" placeholder="Por qué (p. ej.: no es documentación del legajo)"
        onConfirmar={t => resolverPropuesta(p.id, 'descartar', { motivo: t }).then(e => { if (!e) { setModo(null); onCambio() } return e })} onCancelar={() => setModo(null)} />}
      {modo === 'separar' && <ConTexto etiquetaBoton="Separar" placeholder={`Rangos y tipo, p. ej.: 1-2 dni, 3 cuil (tiene ${p.paginas} páginas)`}
        onConfirmar={async t => { const r = leerRangos(t, p.paginas); if (r.error) return r.error; const e = await resolverPropuesta(p.id, 'separar', { rangos: r.rangos }); if (!e) { setModo(null); onCambio() } return e }}
        onCancelar={() => setModo(null)} />}
    </div>
  )
}

export default function BandejaHistorico({ busquedaInicial, categoriaInicial }: { busquedaInicial?: string; categoriaInicial?: string } = {}) {
  const [estado, setEstado] = useState<EstadoPropuesta>('pendiente')
  const [texto, setTexto] = useState(busquedaInicial ?? '')
  const [buscar, setBuscar] = useState(busquedaInicial ?? '')
  const [datos, setDatos] = useState<Bandeja | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [categoria, setCategoria] = useState(categoriaInicial ?? '')
  const [nivel, setNivel] = useState<NivelIdentificacion | ''>('')
  const [visual, setVisual] = useState<EstadoVisual | ''>('')
  const [soloSinPersona, setSoloSinPersona] = useState(false)
  const [soloConflictos, setSoloConflictos] = useState(false)
  const cargar = useCallback(async () => { const r = await cargarBandeja(estado, buscar); setDatos(r.datos); setError(r.error) }, [estado, buscar])
  useEffect(() => { void cargar() }, [cargar])
  useEffect(() => { const t = setTimeout(() => setBuscar(texto), 350); return () => clearTimeout(t) }, [texto])
  const buscando = buscar.trim().length >= 3
  const cargarMas = async () => {
    if (!datos) return
    setCargandoMas(true)
    const r = await cargarBandeja(estado, buscar, datos.propuestas.length)
    setCargandoMas(false)
    if (r.error || !r.datos) { setError(r.error); return }
    const vistos = new Set(datos.propuestas.map(p => p.id))
    setDatos({ ...r.datos, propuestas: [...datos.propuestas, ...r.datos.propuestas.filter(p => !vistos.has(p.id))] })
  }
  const total = datos?.total ?? datos?.propuestas.length ?? 0
  const visibles = datos ? filtrarHistorico(datos.propuestas, {
    categoria, soloSinPersona, soloConflictos, nivel, estadoVisual: visual, activas: datos.tipos.map(t => t.codigo),
  }) : []
  const control: React.CSSProperties = { background: '#0b1220', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '7px 8px', fontSize: 13, minWidth: 0, maxWidth: '100%' }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', minWidth: 0 }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: '#e2e8f0' }}>Archivo histórico (MEGA)</div>
      <div style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0 12px', lineHeight: 1.5 }}>
        Referencias a archivos de MEGA, con la persona y la categoría que sugiere el sistema. El archivo no se copia: se abre en MEGA con la ruta de cada tarjeta.
        <b style={{ color: '#cbd5e1' }}> Localizar</b> o <b style={{ color: '#cbd5e1' }}>asociar</b> un archivo a una persona no lo vuelve documentación válida:
        sólo cuenta como presentado y aprobado lo que se revisa en la sección Documentación.
      </div>
      <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Buscar por apellido, DNI, legajo o nombre del archivo (en todos los estados)"
        style={{ width: '100%', boxSizing: 'border-box', background: '#0b1220', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '10px 12px', fontSize: 14, marginBottom: 10 }} />
      {buscando && <div style={{ fontSize: 13, color: '#94a3b8', margin: '0 2px 10px' }}>{total} resultado(s) para “{buscar.trim()}”</div>}
      <div style={{ display: buscando ? 'none' : 'flex', gap: 4, borderBottom: '1px solid #1e2d42', marginBottom: 12, overflowX: 'auto' }}>
        {PESTAÑAS.map(([k, t]) => (
          <button key={k} type="button" onClick={() => setEstado(k)} style={{
            background: 'none', border: 'none', borderBottom: estado === k ? '2px solid #f59e0b' : '2px solid transparent',
            color: estado === k ? '#f59e0b' : '#94a3b8', padding: '10px 12px', fontSize: 13.5, fontWeight: estado === k ? 700 : 400, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{t} ({datos?.conteo[k] ?? 0})</button>
        ))}
      </div>
      {error && <div style={{ ...card, color: '#fca5a5' }}>{error}</div>}
      {!datos && !error && <div style={{ color: '#64748b', padding: 24 }}>Cargando…</div>}
      {datos && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <select value={categoria} onChange={e => setCategoria(e.target.value)} aria-label="Categoría" style={control}>
            <option value="">Todas las categorías</option>
            <option value="(sin)">Sin categoría</option>
            <option value="(fuera)">Categoría que hoy no se exige</option>
            {datos.tipos.filter(t => datos.propuestas.some(p => categoriaDe(p) === t.codigo)).map(t => <option key={t.codigo} value={t.codigo}>{t.nombre}</option>)}
          </select>
          <select value={nivel} onChange={e => setNivel(e.target.value as NivelIdentificacion | '')} aria-label="Nivel de identificación" style={control}>
            <option value="">Cualquier identificación</option>
            {NIVELES_IDENTIFICACION.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
          {buscando && (
            <select value={visual} onChange={e => setVisual(e.target.value as EstadoVisual | '')} aria-label="Estado" style={control}>
              <option value="">Todos los estados</option>
              {ESTADOS_VISUALES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
          )}
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: '#94a3b8' }}>
            <input type="checkbox" checked={soloSinPersona} onChange={e => setSoloSinPersona(e.target.checked)} /> Sólo sin persona asociada
          </label>
          {buscando && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: '#94a3b8' }}>
              <input type="checkbox" checked={soloConflictos} onChange={e => setSoloConflictos(e.target.checked)} /> Sólo conflictivos
            </label>
          )}
          <span style={{ fontSize: 12, color: '#64748b' }}>{visibles.length} de {datos.propuestas.length}{total > datos.propuestas.length ? ` (cargadas; hay ${total})` : ''}</span>
        </div>
      )}
      {datos && !buscando && estado === 'pendiente' && <ConfirmarLote propuestas={visibles} tipos={datos.tipos} onListo={() => void cargar()} />}
      {datos && visibles.length === 0 && <div style={{ ...card, color: '#94a3b8' }}>No hay propuestas con estos filtros.</div>}
      {visibles.map(p => <Tarjeta key={p.id} p={p} tipos={datos?.tipos ?? []} onCambio={() => void cargar()} />)}
      {datos && total > datos.propuestas.length && (
        <button type="button" style={{ ...boton('sec', !cargandoMas), width: '100%' }} disabled={cargandoMas} onClick={() => void cargarMas()}>
          {cargandoMas ? 'Cargando…' : `Cargar más (${datos.propuestas.length} de ${total})`}
        </button>
      )}
    </div>
  )
}
