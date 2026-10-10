'use client'

/**
 * components/documentacion/DocumentacionLegajo.tsx
 *
 * La sección "Documentación" del legajo.
 *
 *   propio          la persona ve qué le falta, sube sus documentos con el
 *                   celular y deja su constancia (conformidad, recepción o
 *                   toma de conocimiento) de los que le cargó Administración.
 *   Administración  carga lo que ya tiene, revisa lo que subió la persona,
 *   y Gerencia      marca "no corresponde" o "solicitado", anula cargas
 *                   equivocadas y ve quién abrió cada archivo.
 *
 * La autorización no se decide acá: la base rechaza a quien no corresponde
 * (Supervisión, otro vigilador) y los archivos sólo se abren por el servidor,
 * que registra cada acceso.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BOTON_CONSTANCIA, ETIQUETA_CONSTANCIA, ETIQUETA_ESTADO, ETIQUETA_ORIGEN, MAX_ARCHIVOS, TONO_ESTADO,
  etiquetaRequisito, fechaCorta, fechaHora, insigniaTipo, puedeSubir, resumenDocumentacion,
  situacionDeTipo, validarFechas,
} from '@/lib/documentacion'
import type {
  ArchivoDocumento, DocumentacionEmpleado, DocumentoLegajo, ReferenciasSistema, SituacionTipo, TipoDocumento, Tono,
} from '@/lib/documentacion'
import {
  abrirArchivo, anularDocumento, cargarDocumentacion, marcarSituacion, responderDocumento, revisarDocumento,
  subirDocumento,
} from '@/lib/documentacion-datos'
import { ETIQUETA_FUENTE, cargarHistoricoDeEmpleado, cargarIndicios, cargarResumenHistorico, enlaceArchivoHistorico, porRevisar } from '@/lib/legajo-historico'
import type { Indicio, ReferenciaHistorica, ResumenHistorico } from '@/lib/legajo-historico'

// ── Estilos ──────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: '#111827', border: '1px solid #1e2d42', borderRadius: 10,
  padding: 14, marginBottom: 10, boxSizing: 'border-box', minWidth: 0,
}
const titulo: React.CSSProperties = {
  fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em',
  fontWeight: 700, margin: '18px 2px 8px',
}
const texto: React.CSSProperties = { fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }
const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#0b1220', border: '1px solid #334155',
  borderRadius: 8, color: '#e2e8f0', padding: '10px 11px', fontSize: 15,
}
const COLORES: Record<Tono, { fg: string; bg: string; borde: string }> = {
  ok: { fg: '#86efac', bg: 'rgba(34,197,94,.1)', borde: 'rgba(34,197,94,.35)' },
  alerta: { fg: '#fbbf24', bg: 'rgba(245,158,11,.1)', borde: 'rgba(245,158,11,.4)' },
  error: { fg: '#fca5a5', bg: 'rgba(239,68,68,.1)', borde: 'rgba(239,68,68,.4)' },
  accion: { fg: '#93c5fd', bg: 'rgba(59,130,246,.12)', borde: 'rgba(59,130,246,.45)' },
  neutro: { fg: '#94a3b8', bg: 'rgba(148,163,184,.08)', borde: '#334155' },
}
const boton = (tipo: 'primario' | 'secundario' | 'peligro' | 'ok', habilitado = true): React.CSSProperties => ({
  background: !habilitado ? '#334155'
    : tipo === 'primario' ? '#f59e0b' : tipo === 'ok' ? '#16a34a' : 'transparent',
  color: !habilitado ? '#64748b'
    : tipo === 'primario' ? '#1a1205' : tipo === 'ok' ? '#fff' : tipo === 'peligro' ? '#fca5a5' : '#cbd5e1',
  border: tipo === 'peligro' ? '1px solid rgba(239,68,68,.5)' : tipo === 'secundario' ? '1px solid #334155' : 'none',
  borderRadius: 8, padding: '10px 14px', fontSize: 14, fontWeight: tipo === 'primario' || tipo === 'ok' ? 800 : 600,
  cursor: habilitado ? 'pointer' : 'not-allowed', flex: '1 1 auto', minHeight: 42,
})
const enlace: React.CSSProperties = { background: 'none', border: 'none', color: '#93c5fd', fontSize: 13.5, padding: '8px 0 0', cursor: 'pointer' }

function Insignia({ texto: t, tono }: { texto: string; tono: Tono }) {
  const c = COLORES[tono]
  return (
    <span style={{
      display: 'inline-block', fontSize: 11.5, fontWeight: 700, color: c.fg, background: c.bg,
      border: `1px solid ${c.borde}`, borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap',
    }}>{t}</span>
  )
}

function kb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

// ── Archivos: se abren de a uno, por el servidor (queda registrado) ─────────

function Archivo({ a, total, descargar, onAbierto }: {
  a: ArchivoDocumento; total: number; descargar: boolean; onAbierto: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const etiqueta = a.cara ?? (total > 1 ? `Página ${a.orden}` : 'Archivo')
  const esPdf = a.mime === 'application/pdf'

  const abrir = async (modo: 'ver' | 'descargar') => {
    setOcupado(true); setError(null)
    const r = await abrirArchivo(a.id, modo)
    setOcupado(false)
    if (r.error || !r.url) { setError(r.error); return }
    onAbierto()
    if (modo === 'descargar') { window.location.assign(r.url); return }
    setUrl(r.url)
  }

  return (
    <div style={{ width: esPdf || !url ? 'auto' : '100%', maxWidth: 360 }}>
      {!url && (
        <button type="button" style={{ ...boton('secundario', !ocupado), flex: '0 1 auto', fontSize: 13 }} disabled={ocupado}
          onClick={() => void abrir('ver')}>
          {ocupado ? 'Abriendo…' : `${esPdf ? '📄' : '🖼️'} Ver ${etiqueta.toLowerCase()}${esPdf ? ` · PDF ${kb(a.bytes)}` : ''}`}
        </button>
      )}
      {url && !esPdf && (
        <a href={url} target="_blank" rel="noreferrer" title={`Abrir ${etiqueta}`} style={{ display: 'block', textDecoration: 'none' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={etiqueta} style={{ width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 8, border: '1px solid #334155', background: '#0b1220' }} />
          <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 3 }}>{etiqueta}</div>
        </a>
      )}
      {url && esPdf && (
        <a href={url} target="_blank" rel="noreferrer" style={{ ...boton('secundario'), flex: '0 1 auto', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', fontSize: 13 }}>
          📄 Abrir {etiqueta.toLowerCase()} (PDF)
        </a>
      )}
      {descargar && (
        <button type="button" style={{ ...enlace, color: '#64748b', fontSize: 12.5, display: 'block' }} onClick={() => void abrir('descargar')}>Descargar</button>
      )}
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 12.5, marginTop: 4 }}>{error}</div>}
    </div>
  )
}

function Archivos({ doc, descargar, onAbierto }: { doc: DocumentoLegajo; descargar: boolean; onAbierto: () => void }) {
  const archivos = doc.archivos ?? []
  if (!archivos.length) return null
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'flex-start' }}>
      {archivos.map(a => <Archivo key={a.id} a={a} total={archivos.length} descargar={descargar} onAbierto={onAbierto} />)}
    </div>
  )
}

// ── Subida ───────────────────────────────────────────────────────────────────

function FormSubida({ tipo, empleadoId, origenAdministracion, onListo, onCancelar }: {
  tipo: TipoDocumento
  empleadoId: string
  origenAdministracion: boolean
  onListo: () => void
  onCancelar: () => void
}) {
  const [caras, setCaras] = useState<(File | null)[]>(() => (tipo.caras ?? []).map(() => null))
  const [paginas, setPaginas] = useState<File[]>([])
  const [fecha, setFecha] = useState('')
  const [vence, setVence] = useState('')
  const [detalle, setDetalle] = useState('')
  const [progreso, setProgreso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const archivos = tipo.caras ? caras.filter((f): f is File => !!f) : paginas
  const hoy = new Date().toISOString().slice(0, 10)

  const enviar = async () => {
    setError(null)
    if (tipo.caras && archivos.length !== tipo.caras.length) { setError(`Faltan fotos: se necesitan ${tipo.caras.join(' y ')}.`); return }
    const errFecha = validarFechas(tipo, fecha, vence, hoy)
    if (errFecha) { setError(errFecha); return }
    if (tipo.etiqueta_detalle && tipo.multiple && !detalle.trim()) { setError(`Falta completar: ${tipo.etiqueta_detalle.toLowerCase()}.`); return }
    const r = await subirDocumento({
      empleadoId, tipo, fechaEmision: fecha || null, venceEl: tipo.campo_vencimiento === 'declarado' ? vence || null : null,
      detalle: detalle.trim() || null, archivos, onProgreso: setProgreso,
    })
    setProgreso(null)
    if (r.error) { setError(r.error); return }
    onListo()
  }

  const elegir = (onFile: (f: File[]) => void, multiple: boolean) => (
    <input
      type="file" accept="image/*,application/pdf" multiple={multiple}
      style={{ display: 'none' }}
      onChange={e => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; if (fs.length) onFile(fs) }}
    />
  )
  const ocupado = progreso !== null

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed #334155' }}>
      {tipo.caras ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          {tipo.caras.map((c, i) => (
            <label key={c} style={{
              ...boton(caras[i] ? 'ok' : 'secundario'), display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', textAlign: 'center', minHeight: 70, gap: 2,
            }}>
              <span style={{ fontSize: 20 }}>{caras[i] ? '✓' : '📷'}</span>
              <span>{caras[i] ? `${c} lista` : `Foto del ${c.toLowerCase()}`}</span>
              {elegir(fs => setCaras(prev => prev.map((p, j) => j === i ? fs[0] : p)), false)}
            </label>
          ))}
        </div>
      ) : (
        <>
          {paginas.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#cbd5e1', marginBottom: 6, minWidth: 0 }}>
              <span>{f.type === 'application/pdf' ? '📄' : '🖼️'}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              <button type="button" onClick={() => setPaginas(p => p.filter((_, j) => j !== i))}
                style={{ background: 'none', border: 'none', color: '#fca5a5', fontSize: 13, cursor: 'pointer' }}>Quitar</button>
            </div>
          ))}
          {paginas.length < MAX_ARCHIVOS && (
            <label style={{ ...boton('secundario'), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              📷 {paginas.length ? 'Agregar otra página' : 'Sacar foto o elegir PDF'}
              {elegir(fs => setPaginas(p => [...p, ...fs].slice(0, MAX_ARCHIVOS)), true)}
            </label>
          )}
        </>
      )}

      {tipo.etiqueta_detalle && (
        <label style={{ display: 'block', marginTop: 10 }}>
          <span style={{ ...texto, display: 'block', marginBottom: 4 }}>{tipo.etiqueta_detalle}{tipo.multiple ? ' *' : ''}</span>
          <input style={input} value={detalle} maxLength={200} onChange={e => setDetalle(e.target.value)} />
        </label>
      )}
      {tipo.campo_fecha !== 'no' && (
        <label style={{ display: 'block', marginTop: 10 }}>
          <span style={{ ...texto, display: 'block', marginBottom: 4 }}>
            {tipo.etiqueta_fecha}{tipo.campo_fecha === 'obligatoria' ? ' *' : ' (si la sabés)'}
          </span>
          <input type="date" style={input} value={fecha} max={hoy} onChange={e => setFecha(e.target.value)} />
        </label>
      )}
      {tipo.campo_vencimiento === 'declarado' && (
        <label style={{ display: 'block', marginTop: 10 }}>
          <span style={{ ...texto, display: 'block', marginBottom: 4 }}>Vence el (como figura en el documento) *</span>
          <input type="date" style={input} value={vence} onChange={e => setVence(e.target.value)} />
        </label>
      )}
      {tipo.campo_vencimiento === 'calculado' && tipo.vigencia_meses && (
        <div style={{ ...texto, fontSize: 12.5, marginTop: 6 }}>Vence {tipo.vigencia_meses} meses después de la emisión.</div>
      )}

      <div style={{ ...texto, marginTop: 10, fontSize: 12.5 }}>
        {tipo.sensibilidad === 'reservado_gerencia'
          ? 'Queda sólo para Gerencia: la persona y Administración no lo ven.'
          : origenAdministracion
            ? 'La persona lo va a ver en su legajo y va a tener que dejar su constancia.'
            : 'Queda presentado. Administración lo revisa y recién ahí queda validado.'}
      </div>
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13.5, marginTop: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button type="button" style={boton('primario', !ocupado && archivos.length > 0)} disabled={ocupado || archivos.length === 0} onClick={() => void enviar()}>
          {progreso ?? 'Enviar'}
        </button>
        <button type="button" style={{ ...boton('secundario', !ocupado), flex: '0 1 auto' }} disabled={ocupado} onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}

// ── Acciones con texto ───────────────────────────────────────────────────────

function AccionTexto({ etiqueta, placeholder, obligatorio, tipoBoton, onConfirmar, onCancelar }: {
  etiqueta: string; placeholder: string; obligatorio: boolean
  tipoBoton: 'primario' | 'ok'
  onConfirmar: (t: string) => Promise<string | null>; onCancelar: () => void
}) {
  const [t, setT] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listo = !obligatorio || t.trim().length >= 3
  return (
    <div style={{ marginTop: 10 }}>
      <textarea style={{ ...input, minHeight: 64, resize: 'vertical' }} placeholder={placeholder} value={t}
        maxLength={500} onChange={e => setT(e.target.value)} />
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 6 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button type="button" style={boton(tipoBoton, listo && !ocupado)} disabled={!listo || ocupado}
          onClick={async () => { setOcupado(true); setError(null); const e = await onConfirmar(t.trim()); setOcupado(false); if (e) setError(e) }}>
          {ocupado ? 'Guardando…' : etiqueta}
        </button>
        <button type="button" style={{ ...boton('secundario'), flex: '0 1 auto' }} onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}

// ── Un documento ─────────────────────────────────────────────────────────────

export function Documento({ doc, tipo, esPropio, puedeGestionar, nombrePersona, onCambio }: {
  doc: DocumentoLegajo
  tipo: TipoDocumento
  esPropio: boolean
  puedeGestionar: boolean
  nombrePersona?: string
  onCambio: () => void
}) {
  const [verArchivos, setVerArchivos] = useState(doc.estado === 'pendiente_aceptacion' || doc.estado === 'pendiente_revision')
  const [leido, setLeido] = useState(!!doc.leido)
  const [modo, setModo] = useState<null | 'rechazar' | 'observar' | 'con_comentario' | 'anular'>(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tono = TONO_ESTADO[doc.estado]
  const constancia = tipo.constancia === 'ninguna' ? null : tipo.constancia
  const hecho = (e: string | null) => { if (!e) { setModo(null); onCambio() } return e }

  const accion = async (f: () => Promise<string | null>) => {
    setOcupado(true); setError(null)
    const e = await f()
    setOcupado(false)
    if (e) setError(e); else { setModo(null); onCambio() }
  }

  const quien = doc.origen === 'vigilador' ? (esPropio ? 'vos' : (nombrePersona ?? 'la persona')) : ETIQUETA_ORIGEN[doc.origen]
  const respuestas = (doc.constancias ?? []).filter(c => c.tipo !== 'lectura')

  return (
    <div style={{ background: '#0b1220', border: `1px solid ${COLORES[tono].borde}`, borderRadius: 8, padding: 12, marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: '1 1 180px' }}>
          {doc.detalle && <div style={{ fontSize: 14, color: '#e2e8f0', fontWeight: 700, wordBreak: 'break-word' }}>{doc.detalle}</div>}
          <div style={{ ...texto, fontSize: 12.5 }}>
            Cargado por {quien} el {fechaHora(doc.confirmado_at)}
            {doc.fecha_emision && <><br />{tipo.etiqueta_fecha}: {fechaCorta(doc.fecha_emision)}</>}
            {doc.vence_el && <><br />Vence el {fechaCorta(doc.vence_el)}</>}
          </div>
        </div>
        <Insignia texto={ETIQUETA_ESTADO[doc.estado]} tono={tono} />
      </div>

      {doc.estado === 'aprobado' && doc.revisado_at && (
        <div style={{ ...texto, fontSize: 12.5, marginTop: 6 }}>
          Validado {doc.revisado_por_nombre ? `por ${doc.revisado_por_nombre} ` : ''}el {fechaHora(doc.revisado_at)}
        </div>
      )}
      {respuestas.map((c, i) => (
        <div key={i} style={{ ...texto, fontSize: 12.5, marginTop: 6 }}>
          {ETIQUETA_CONSTANCIA[c.tipo]} el {fechaHora(c.at)}{c.texto ? `: “${c.texto}”` : ''}
          {c.comentario && <><br />Comentario: “{c.comentario}”</>}
        </div>
      ))}
      {doc.estado === 'rechazado' && (
        <div style={{ color: '#fca5a5', fontSize: 13.5, marginTop: 6, lineHeight: 1.45 }}>
          Rechazado: {doc.motivo_rechazo}{esPropio ? '. Volvé a subirlo.' : ''}
        </div>
      )}
      {doc.estado === 'observado' && puedeGestionar && (
        <div style={{ ...texto, fontSize: 12.5, marginTop: 4 }}>Cargá el documento correcto o anulá este.</div>
      )}
      {doc.estado === 'pendiente_revision' && (
        <div style={{ ...texto, fontSize: 12.5, marginTop: 6 }}>
          {puedeGestionar ? 'Revisá que se lea bien y que sea de esta persona.' : 'Presentado. Administración lo está revisando.'}
        </div>
      )}
      {doc.estado === 'anulado' && (
        <div style={{ ...texto, fontSize: 12.5, marginTop: 6 }}>Anulado el {fechaHora(doc.anulado_at)}: {doc.motivo_anulacion}</div>
      )}

      {verArchivos
        ? <Archivos doc={doc} descargar={puedeGestionar} onAbierto={() => setLeido(true)} />
        : <button type="button" onClick={() => setVerArchivos(true)} style={enlace}>
            Ver {(doc.archivos?.length ?? 0) > 1 ? `los ${doc.archivos?.length} archivos` : 'el archivo'}
          </button>}

      {/* La persona deja su constancia de lo que cargó Administración */}
      {esPropio && doc.estado === 'pendiente_aceptacion' && constancia && modo === null && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13.5, color: '#e2e8f0', lineHeight: 1.5, marginBottom: 8 }}>“{tipo.texto_constancia}”</div>
          {!leido && <div style={{ ...texto, fontSize: 12.5, marginBottom: 8, color: '#93c5fd' }}>Primero abrí el documento para verlo.</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={boton('ok', !ocupado && leido)} disabled={ocupado || !leido}
              onClick={() => void accion(() => responderDocumento(doc.id, constancia))}>
              {ocupado ? 'Guardando…' : BOTON_CONSTANCIA[constancia]}
            </button>
            {constancia === 'conformidad'
              ? <button type="button" style={{ ...boton('peligro', leido), flex: '0 1 auto' }} disabled={!leido} onClick={() => setModo('observar')}>Hay un error</button>
              : <button type="button" style={{ ...boton('secundario', leido), flex: '0 1 auto' }} disabled={!leido} onClick={() => setModo('con_comentario')}>Con un comentario</button>}
          </div>
        </div>
      )}
      {modo === 'observar' && (
        <AccionTexto etiqueta="Enviar" placeholder="Contanos qué está mal" obligatorio tipoBoton="primario"
          onConfirmar={t => responderDocumento(doc.id, 'observacion', t).then(hecho)} onCancelar={() => setModo(null)} />
      )}
      {modo === 'con_comentario' && constancia && (
        <AccionTexto etiqueta={BOTON_CONSTANCIA[constancia]} placeholder="Tu comentario (opcional)" obligatorio={false} tipoBoton="ok"
          onConfirmar={t => responderDocumento(doc.id, constancia, t).then(hecho)} onCancelar={() => setModo(null)} />
      )}

      {/* Administración revisa lo que subió la persona */}
      {puedeGestionar && doc.estado === 'pendiente_revision' && modo === null && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" style={boton('ok', !ocupado)} disabled={ocupado}
            onClick={() => void accion(() => revisarDocumento(doc.id, 'aprobar'))}>{ocupado ? 'Guardando…' : 'Validar'}</button>
          <button type="button" style={{ ...boton('peligro'), flex: '0 1 auto' }} onClick={() => setModo('rechazar')}>Rechazar</button>
        </div>
      )}
      {modo === 'rechazar' && (
        <AccionTexto etiqueta="Rechazar" placeholder="Motivo (lo va a ver la persona). Ej.: la foto del dorso no se lee" obligatorio tipoBoton="primario"
          onConfirmar={t => revisarDocumento(doc.id, 'rechazar', t).then(hecho)} onCancelar={() => setModo(null)} />
      )}

      {puedeGestionar && !['anulado', 'reemplazado', 'subiendo', 'pendiente_revision'].includes(doc.estado) && modo === null && (
        <button type="button" onClick={() => setModo('anular')} style={{ ...enlace, color: '#64748b', fontSize: 12.5, padding: '10px 0 0' }}>
          Anular (carga equivocada)
        </button>
      )}
      {modo === 'anular' && (
        <AccionTexto etiqueta="Anular" placeholder="Motivo. El archivo queda guardado y la persona deja de verlo." obligatorio tipoBoton="primario"
          onConfirmar={t => anularDocumento(doc.id, t).then(hecho)} onCancelar={() => setModo(null)} />
      )}
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 6 }}>{error}</div>}
    </div>
  )
}

// ── Referencias del sistema ─────────────────────────────────────────────────

function lineasReferencia(tipo: TipoDocumento, r: ReferenciasSistema): string[] {
  if (tipo.referencia === 'sindicato') {
    return r.sindicato.map(s => `Liquidación: afiliado desde ${fechaCorta(s.desde)}${s.hasta ? ` hasta ${fechaCorta(s.hasta)}` : ''}`)
  }
  if (tipo.referencia === 'embargos') {
    return r.embargos.map(e => `Liquidación: ${e.referencia ?? 'embargo'} · desde ${fechaCorta(e.desde)}${e.hasta ? ` hasta ${fechaCorta(e.hasta)}` : ''}`)
  }
  if (tipo.referencia === 'suspensiones') {
    return r.suspensiones.map(s => `Novedades: suspensión del ${fechaCorta(s.desde)} al ${fechaCorta(s.hasta)}${s.observacion ? ` · ${s.observacion}` : ''}`)
  }
  return []
}

// ── Marca de Administración: no corresponde / solicitado ────────────────────

function MarcaAdministracion({ tipo, s, empleadoId, onCambio }: {
  tipo: TipoDocumento; s: SituacionTipo; empleadoId: string; onCambio: () => void
}) {
  const [modo, setModo] = useState<null | 'no_corresponde' | 'solicitado'>(null)
  const [error, setError] = useState<string | null>(null)
  if (s.vigentes.length > 0) return null
  const hecho = (e: string | null) => { if (!e) { setModo(null); onCambio() } return e }
  return (
    <div style={{ marginTop: 6 }}>
      {s.marca && modo === null && (
        <button type="button" style={{ ...enlace, color: '#64748b', fontSize: 12.5 }}
          onClick={async () => { const e = await marcarSituacion(empleadoId, tipo.codigo, 'sin_efecto'); if (e) setError(e); else onCambio() }}>
          Quitar “{s.marca.situacion === 'no_corresponde' ? 'no corresponde' : 'solicitado'}”
        </button>
      )}
      {!s.marca && modo === null && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <button type="button" style={{ ...enlace, fontSize: 12.5 }} onClick={() => setModo('solicitado')}>Pedírselo a la persona</button>
          <button type="button" style={{ ...enlace, color: '#94a3b8', fontSize: 12.5 }} onClick={() => setModo('no_corresponde')}>No corresponde</button>
        </div>
      )}
      {modo === 'solicitado' && (
        <AccionTexto etiqueta="Solicitar" placeholder="Qué tiene que traer (opcional). La persona lo ve en su legajo." obligatorio={false} tipoBoton="primario"
          onConfirmar={t => marcarSituacion(empleadoId, tipo.codigo, 'solicitado', t).then(hecho)} onCancelar={() => setModo(null)} />
      )}
      {modo === 'no_corresponde' && (
        <AccionTexto etiqueta="No corresponde" placeholder="Por qué no corresponde. Ej.: no terminó el secundario" obligatorio tipoBoton="primario"
          onConfirmar={t => marcarSituacion(empleadoId, tipo.codigo, 'no_corresponde', t).then(hecho)} onCancelar={() => setModo(null)} />
      )}
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 6 }}>{error}</div>}
    </div>
  )
}

// ── Tarjeta de un tipo ───────────────────────────────────────────────────────

function ArchivoHistorico({ refs }: { refs: ReferenciaHistorica[] }) {
  const [copiada, setCopiada] = useState<string | null>(null)
  if (!refs.length) return null
  return (
    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(168,85,247,.07)', border: '1px solid rgba(168,85,247,.3)' }}>
      <div style={{ fontSize: 11, color: '#c4b5fd', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>Archivo histórico (MEGA) · referencia, sin validar</div>
      {refs.map(r => (
        <div key={r.id} style={{ fontSize: 12.5, color: '#cbd5e1', marginTop: 4, overflowWrap: 'anywhere', lineHeight: 1.45 }}>
          {r.ruta_origen}{r.paginas ? ` · págs. ${r.paginas[0]}–${r.paginas[1]}` : ''}{r.fecha_emision ? ` · ${fechaCorta(r.fecha_emision)}` : ''}
          {!r.disponible && <span style={{ color: '#fca5a5' }}> · no figura disponible en el índice</span>}
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(r.ruta_origen); setCopiada(r.id) }}
            style={{ marginLeft: 8, background: 'none', border: 'none', color: '#93c5fd', fontSize: 12, cursor: 'pointer', padding: 0 }}>
            {copiada === r.id ? 'Ruta copiada' : 'Copiar ruta'}
          </button>
          <div style={{ fontSize: 11.5, color: '#64748b' }}>Asociado {r.revisado_por ? `por ${r.revisado_por} ` : ''}el {fechaHora(r.revisado_at)}</div>
        </div>
      ))}
    </div>
  )
}

/**
 * Para Administración/Gerencia: qué hay de esta persona, separado en tres
 * situaciones. Sólo lo validado en Documentación cuenta para el cumplimiento;
 * lo de MEGA es una pista para revisar, y se revisa a mano en la bandeja.
 */
function SituacionDocumental({ validados, obligatorios, resumen, empleadoId }: {
  validados: number; obligatorios: number; resumen: ResumenHistorico; empleadoId: string
}) {
  const pendientes = porRevisar(resumen)
  const asociadas = resumen.asociadas + resumen.copiadas
  const fila = (color: string, n: number, textoFila: string, detalle: string) => (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 0', borderTop: '1px solid #1e293b' }}>
      <b style={{ color, fontSize: 17, minWidth: 28, textAlign: 'right' }}>{n}</b>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: '#e2e8f0' }}>{textoFila}</div>
        <div style={{ fontSize: 12, color: '#64748b' }}>{detalle}</div>
      </div>
    </div>
  )
  return (
    <div style={card}>
      <div style={{ fontSize: 13, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, marginBottom: 4 }}>Qué hay de esta persona</div>
      {fila('#22c55e', validados, `Documentos validados en Documentación (de ${obligatorios} obligatorios)`, 'Son los únicos que cuentan para el cumplimiento.')}
      {fila('#c4b5fd', asociadas, 'Referencias de MEGA asociadas, sin validar', 'Revisadas y asociadas por Administración; figuran en cada documento. No cuentan para el cumplimiento.')}
      {fila('#93c5fd', pendientes, 'Referencias de MEGA detectadas, pendientes de revisión',
        `Sugeridas por el sistema; nadie las revisó todavía${resumen.conflictos ? ` (${resumen.conflictos} con conflicto)` : ''}. No están incorporadas al legajo.`)}
      {pendientes + asociadas > 0 && (
        <a href={enlaceArchivoHistorico(empleadoId)} style={{ display: 'inline-block', marginTop: 8, color: '#93c5fd', fontSize: 13.5, fontWeight: 600 }}>
          {pendientes > 0 ? `Revisar ${pendientes === 1 ? 'la referencia' : `las ${pendientes} referencias`} en Archivo histórico →` : 'Ver en Archivo histórico →'}
        </a>
      )}
    </div>
  )
}

function TarjetaTipo({ tipo, s, datos, nombrePersona, indicios = [], historicos = [], onCambio }: {
  tipo: TipoDocumento
  s: SituacionTipo
  datos: DocumentacionEmpleado
  nombrePersona?: string
  indicios?: Indicio[]
  historicos?: ReferenciaHistorica[]
  onCambio: () => void
}) {
  const [subiendo, setSubiendo] = useState(false)
  const [historial, setHistorial] = useState(false)
  const insignia = insigniaTipo(s)
  const habilitado = puedeSubir(tipo, datos.es_propio, datos.puede_gestionar, !!datos.es_gerencia)
  const refs = lineasReferencia(tipo, datos.referencias)
  // Lo que la persona tiene para confirmar ya está arriba, en "Para confirmar".
  const visibles = [...s.pendientes, ...s.vigentes]
    .filter(d => !(datos.es_propio && d.estado === 'pendiente_aceptacion'))
  const esperaConstancia = datos.es_propio && s.pendientes.some(d => d.estado === 'pendiente_aceptacion')

  const textoBoton = tipo.multiple
    ? (s.vigentes.length || s.pendientes.length ? 'Agregar otro' : 'Subir')
    : s.base === 'vencido' ? 'Subir el nuevo'
    : (s.vigentes.length || s.pendientes.length ? 'Volver a subir' : 'Subir')

  return (
    <div style={{ ...card, opacity: s.base === 'no_corresponde' ? 0.75 : 1 }} id={`doc-${tipo.codigo}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', lineHeight: 1.3 }}>{tipo.nombre}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            {etiquetaRequisito(tipo)}{tipo.requisito === 'obligatorio' && tipo.ayuda ? ` · ${tipo.ayuda}` : ''}
          </div>
        </div>
        <Insignia texto={insignia.texto} tono={insignia.tono} />
      </div>

      {s.marca && (
        <div style={{ ...texto, fontSize: 12.5, marginTop: 6, color: s.marca.situacion === 'solicitado' ? '#93c5fd' : '#94a3b8' }}>
          {s.marca.situacion === 'solicitado'
            ? `Administración te lo pidió${s.marca.motivo ? `: ${s.marca.motivo}` : '.'}`
            : `No corresponde${s.marca.motivo ? `: ${s.marca.motivo}` : '.'}`}
        </div>
      )}

      {refs.length > 0 && (
        <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.25)' }}>
          <div style={{ fontSize: 11, color: '#93c5fd', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>Ya figura en el sistema</div>
          {refs.map((r, i) => <div key={i} style={{ fontSize: 13, color: '#cbd5e1', marginTop: 3, wordBreak: 'break-word' }}>{r}</div>)}
          {s.vigentes.length === 0 && s.pendientes.length === 0 && (
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
              {datos.puede_gestionar ? 'Falta cargar el documento.' : 'Todavía no está el documento en tu legajo.'}
            </div>
          )}
        </div>
      )}

      {/* Planillas viejas: sólo indicio, nunca validan nada. */}
      {indicios.length > 0 && s.vigentes.length === 0 && (
        <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(148,163,184,.07)', border: '1px dashed #334155' }}>
          {indicios.map((i, k) => (
            <div key={k} style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.45 }}>
              Según la {ETIQUETA_FUENTE[i.fuente] ?? i.fuente}: {i.valor ?? '—'}{i.fecha ? ` (${fechaCorta(i.fecha)})` : ''} · <i>pendiente de corroboración</i>
            </div>
          ))}
        </div>
      )}

      {datos.puede_gestionar && <ArchivoHistorico refs={historicos} />}

      {visibles.map(d => (
        <Documento key={d.id} doc={d} tipo={tipo} esPropio={datos.es_propio} puedeGestionar={datos.puede_gestionar}
          nombrePersona={nombrePersona} onCambio={onCambio} />
      ))}

      {esperaConstancia && (
        <div style={{ fontSize: 13, color: '#93c5fd', marginTop: 8 }}>Administración te lo cargó: confirmalo arriba, en “Para confirmar”.</div>
      )}

      {habilitado && !subiendo && s.base !== 'no_corresponde' && (
        <div style={{ display: 'flex', marginTop: 10 }}>
          <button type="button" style={boton(s.base === 'falta' || s.base === 'vencido' || s.pendiente?.estado === 'rechazado' ? 'primario' : 'secundario')}
            onClick={() => setSubiendo(true)}>
            📷 {textoBoton}
          </button>
        </div>
      )}
      {!habilitado && datos.es_propio && s.vigentes.length === 0 && s.pendientes.length === 0 && s.base !== 'no_corresponde' && (
        <div style={{ ...texto, fontSize: 12.5, marginTop: 8 }}>Lo carga Administración.</div>
      )}
      {subiendo && (
        <FormSubida tipo={tipo} empleadoId={datos.empleado_id} origenAdministracion={datos.puede_gestionar}
          onCancelar={() => setSubiendo(false)} onListo={() => { setSubiendo(false); onCambio() }} />
      )}
      {datos.puede_gestionar && !subiendo && (tipo.sensibilidad !== 'reservado_gerencia' || datos.es_gerencia) && (
        <MarcaAdministracion tipo={tipo} s={s} empleadoId={datos.empleado_id} onCambio={onCambio} />
      )}

      {s.historial.length > 0 && (
        historial
          ? s.historial.map(d => (
              <Documento key={d.id} doc={d} tipo={tipo} esPropio={datos.es_propio} puedeGestionar={datos.puede_gestionar}
                nombrePersona={nombrePersona} onCambio={onCambio} />
            ))
          : <button type="button" onClick={() => setHistorial(true)} style={{ ...enlace, color: '#64748b', fontSize: 12.5, padding: '10px 0 0' }}>
              Ver anteriores ({s.historial.length})
            </button>
      )}
    </div>
  )
}

// ── Registro de accesos (Administración y Gerencia) ─────────────────────────

function Accesos({ datos }: { datos: DocumentacionEmpleado }) {
  const [abierto, setAbierto] = useState(false)
  const accesos = datos.accesos ?? []
  const nombre = (codigo: string) => datos.tipos.find(t => t.codigo === codigo)?.nombre ?? codigo
  return (
    <div style={card}>
      <button type="button" onClick={() => setAbierto(a => !a)} style={{ ...enlace, padding: 0 }}>
        {abierto ? '▾' : '▸'} Quién abrió los archivos ({accesos.length})
      </button>
      {abierto && (
        <div style={{ marginTop: 8 }}>
          {accesos.length === 0 && <div style={{ ...texto, fontSize: 12.5 }}>Nadie todavía.</div>}
          {accesos.map((a, i) => (
            <div key={i} style={{ ...texto, fontSize: 12.5, borderTop: i ? '1px solid #1e293b' : 'none', padding: '5px 0' }}>
              {fechaHora(a.at)} · {a.quien ?? '—'} · {a.modo === 'descargar' ? 'descargó' : 'vio'} {nombre(a.tipo)} (archivo {a.orden})
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Sección ──────────────────────────────────────────────────────────────────

export default function DocumentacionLegajo({ empleadoId, nombrePersona }: {
  empleadoId: string
  nombrePersona?: string
}) {
  const [datos, setDatos] = useState<DocumentacionEmpleado | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [indicios, setIndicios] = useState<Indicio[]>([])
  const [historicos, setHistoricos] = useState<ReferenciaHistorica[]>([])
  const [resumenMega, setResumenMega] = useState<ResumenHistorico | null>(null)

  const cargar = useCallback(async () => {
    const [r, ind] = await Promise.all([cargarDocumentacion(empleadoId), cargarIndicios(empleadoId)])
    setDatos(r.datos); setError(r.error); setIndicios(ind); setCargando(false)
    // Sólo Administración/Gerencia: la base rechaza a cualquier otro.
    if (r.datos?.puede_gestionar) {
      const [h, rm] = await Promise.all([cargarHistoricoDeEmpleado(empleadoId), cargarResumenHistorico(empleadoId)])
      setHistoricos(h); setResumenMega(rm)
    }
  }, [empleadoId])

  useEffect(() => { void cargar() }, [cargar])

  const situaciones = useMemo(() => {
    if (!datos) return []
    return datos.tipos.map(t => ({ tipo: t, s: situacionDeTipo(t, datos.documentos, datos.hoy, datos.situaciones) }))
  }, [datos])

  if (cargando) return <div style={{ ...texto, padding: 24, textAlign: 'center' }}>Cargando documentación…</div>
  if (error || !datos) {
    return <div style={{ ...card, color: '#fca5a5' }}>{error ?? 'No se pudo cargar la documentación.'}</div>
  }

  const r = resumenDocumentacion(datos.tipos, datos.documentos, datos.hoy, datos.situaciones)
  const porcentaje = r.obligatorios ? Math.round((r.validados / r.obligatorios) * 100) : 0
  const porcentajePresentados = r.obligatorios ? Math.round(((r.validados + r.presentados) / r.obligatorios) * 100) : 0
  const obligatorios = situaciones.filter(x => x.tipo.requisito === 'obligatorio')
  const otros = situaciones.filter(x => x.tipo.requisito !== 'obligatorio')
  const paraConfirmar = datos.es_propio
    ? situaciones.filter(x => x.s.pendientes.some(d => d.estado === 'pendiente_aceptacion'))
    : []

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', minWidth: 0 }}>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>Documentación obligatoria validada</div>
          <div style={{ fontSize: 14, color: '#cbd5e1' }}><b style={{ color: '#f59e0b', fontSize: 18 }}>{r.validados}</b> de {r.obligatorios}</div>
        </div>
        <div style={{ height: 8, background: '#1e293b', borderRadius: 99, marginTop: 10, overflow: 'hidden', position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0, width: `${porcentajePresentados}%`, background: 'rgba(245,158,11,.35)' }} />
          <div style={{ position: 'absolute', inset: 0, width: `${porcentaje}%`, background: porcentaje === 100 ? '#22c55e' : '#f59e0b' }} />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {r.presentados > 0 && <Insignia texto={`${r.presentados} presentado${r.presentados > 1 ? 's' : ''} sin validar`} tono="alerta" />}
          {r.paraAceptar > 0 && <Insignia texto={`${r.paraAceptar} para confirmar`} tono="accion" />}
          {r.solicitados > 0 && <Insignia texto={`${r.solicitados} solicitado${r.solicitados > 1 ? 's' : ''}`} tono="accion" />}
          {r.rechazados > 0 && <Insignia texto={`${r.rechazados} rechazado${r.rechazados > 1 ? 's' : ''}`} tono="error" />}
          {r.observados > 0 && <Insignia texto={`${r.observados} con observación`} tono="error" />}
          {r.vencidos > 0 && <Insignia texto={`${r.vencidos} vencido${r.vencidos > 1 ? 's' : ''}`} tono="error" />}
          {r.porVencer > 0 && <Insignia texto={`${r.porVencer} por vencer`} tono="alerta" />}
          {r.faltan > 0 && <Insignia texto={`${r.faltan} pendiente${r.faltan > 1 ? 's' : ''}`} tono="neutro" />}
        </div>
        {datos.es_propio && (
          <div style={{ ...texto, marginTop: 10 }}>
            Sacale una foto a cada documento con el celular (que se lea bien, sin reflejos) o subí el PDF.
            Administración los revisa y recién ahí quedan validados. Los que te carga Administración tenés que abrirlos y confirmarlos acá.
          </div>
        )}
      </div>

      {datos.puede_gestionar && resumenMega && (
        <SituacionDocumental validados={r.validados} obligatorios={r.obligatorios} resumen={resumenMega} empleadoId={empleadoId} />
      )}

      {paraConfirmar.length > 0 && (
        <>
          <div style={{ ...titulo, color: '#93c5fd' }}>Para confirmar</div>
          {paraConfirmar.map(({ tipo, s }) => (
            <div key={tipo.codigo} style={{ ...card, borderColor: COLORES.accion.borde }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>{tipo.nombre}</div>
              {s.pendientes.filter(d => d.estado === 'pendiente_aceptacion').map(d => (
                <Documento key={d.id} doc={d} tipo={tipo} esPropio puedeGestionar={datos.puede_gestionar} onCambio={() => void cargar()} />
              ))}
            </div>
          ))}
        </>
      )}

      <div style={titulo}>Obligatorios</div>
      {obligatorios.map(({ tipo, s }) => (
        <TarjetaTipo key={tipo.codigo} tipo={tipo} s={s} datos={datos} nombrePersona={nombrePersona}
          indicios={indicios.filter(i => i.tipo === tipo.codigo)} historicos={historicos.filter(h => h.tipo === tipo.codigo)} onCambio={() => void cargar()} />
      ))}

      <div style={titulo}>Si corresponde</div>
      {otros.map(({ tipo, s }) => (
        <TarjetaTipo key={tipo.codigo} tipo={tipo} s={s} datos={datos} nombrePersona={nombrePersona}
          indicios={indicios.filter(i => i.tipo === tipo.codigo)} historicos={historicos.filter(h => h.tipo === tipo.codigo)} onCambio={() => void cargar()} />
      ))}

      {datos.puede_gestionar && datos.accesos && <Accesos datos={datos} />}
    </div>
  )
}
