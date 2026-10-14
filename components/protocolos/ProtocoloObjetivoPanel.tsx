'use client'

/**
 * components/protocolos/ProtocoloObjetivoPanel.tsx
 *
 * Sección «Protocolo» de la ficha del objetivo (CentroOperativoObjetivo).
 *
 * ── Qué muestra ──────────────────────────────────────────────────────────────
 *  · El protocolo vigente (por objetivo y, si hay, por puesto) con su texto.
 *  · Todas las versiones: borradores, pendientes de aprobación, reemplazadas y
 *    descartadas, con su fuente y su estado de asociación con el objetivo.
 *  · Quién abrió y quién confirmó cada versión vigente, y quién falta.
 *  · Las diferencias pendientes de validación (protocolo vs otros documentos
 *    vs configuración operativa).
 *
 * ── Quién hace qué ───────────────────────────────────────────────────────────
 * Los botones salen de los permisos que devuelve la base
 * (protocolo_panel_objetivo.permisos), y cada RPC los vuelve a validar:
 * preparar = Administración, Gerencia, jefatura y dirección operativa;
 * publicar, devolver, descartar, confirmar asociación y resolver = Gerencia.
 * Un supervisor de la zona ve todo y puede registrar diferencias.
 *
 * ── Qué NO hace ──────────────────────────────────────────────────────────────
 * No cambia rondas, alertas ni nada de la configuración que una diferencia
 * menciona: la diferencia se documenta y la resuelve una persona.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  COLOR_ESTADO, ETIQUETA_ESTADO, ETIQUETA_TIPO_DIFERENCIA, TIPOS_DIFERENCIA,
  accionesDeVersion, fechaHoraAR, separarLecturas,
} from '@/lib/protocolos'
import type { DiferenciaProtocolo, LecturaProtocolo, PanelObjetivo, TipoDiferencia, VersionProtocolo } from '@/lib/protocolos'
import {
  asignarResponsable, cargarPanelObjetivo, confirmarAsociacion, crearBorrador, descartarVersion,
  devolverBorrador, editarBorrador, enviarAprobacion, publicarVersion, registrarDiferencia, resolverDiferencia,
} from '@/lib/protocolos-datos'

const card: React.CSSProperties = {
  background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 16, marginBottom: 14,
}
const sub: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#e2e8f0', margin: '16px 0 8px' }
const etiqueta: React.CSSProperties = { fontSize: 10.5, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em' }
const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#0a0e1a', border: '1px solid #1e2d42',
  color: '#e2e8f0', borderRadius: 8, padding: '8px 10px', fontSize: 13.5, fontFamily: 'inherit',
}
const boton = (tono: 'primario' | 'secundario' | 'peligro' | 'ok' = 'secundario'): React.CSSProperties => ({
  border: tono === 'secundario' ? '1px solid #334155' : 'none', borderRadius: 8, padding: '7px 12px',
  fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  background: tono === 'primario' ? '#f59e0b' : tono === 'peligro' ? '#b91c1c' : tono === 'ok' ? '#15803d' : 'transparent',
  color: tono === 'primario' ? '#1a1205' : tono === 'secundario' ? '#cbd5e1' : '#fff',
})
const pill = (color: string): React.CSSProperties => ({
  display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
  border: `1px solid ${color}`, color, whiteSpace: 'nowrap',
})
const textoDoc: React.CSSProperties = {
  whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13.5, lineHeight: 1.6, color: '#e2e8f0',
  background: '#0a0e1a', border: '1px solid #1e2d42', borderRadius: 8, padding: 12, maxHeight: 420, overflowY: 'auto',
}

type Puesto = { id: string; nombre: string }

export default function ProtocoloObjetivoPanel({ objetivoId }: { objetivoId: string }) {
  const [panel, setPanel] = useState<PanelObjetivo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [puestos, setPuestos] = useState<Puesto[]>([])
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null)
  const [verTexto, setVerTexto] = useState<Record<string, boolean>>({})
  const [nueva, setNueva] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await cargarPanelObjetivo(objetivoId)
    setCargando(false)
    if (r.error) { setError(r.error); setPanel(null); return }
    setError(null)
    setPanel(r.data)
  }, [objetivoId])

  useEffect(() => { void cargar() }, [cargar])
  useEffect(() => {
    void supabase.from('puestos').select('id, nombre').eq('objetivo_id', objetivoId).eq('activo', true)
      .order('orden').limit(200)
      .then(({ data }) => setPuestos((data ?? []) as Puesto[]))
  }, [objetivoId])

  /** Ejecuta una acción, muestra el resultado y recarga. */
  const ejecutar = useCallback(async (fn: () => Promise<{ error: string | null }>, ok: string) => {
    const r = await fn()
    if (r.error) { setMensaje({ texto: r.error, tipo: 'error' }); return false }
    setMensaje({ texto: ok, tipo: 'ok' })
    await cargar()
    return true
  }, [cargar])

  const vigentes = useMemo(() => (panel?.versiones ?? []).filter(v => v.estado === 'vigente'), [panel])
  const otras = useMemo(() => (panel?.versiones ?? []).filter(v => v.estado !== 'vigente'), [panel])

  if (cargando && !panel) return <div style={card}><div style={{ color: '#64748b', fontSize: 13 }}>Cargando protocolo…</div></div>
  if (error) {
    return (
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0', marginBottom: 6 }}>📋 Protocolo</div>
        <div style={{ color: /permiso/i.test(error) ? '#94a3b8' : '#f87171', fontSize: 13 }}>
          {/permiso/i.test(error) ? 'No tenés acceso al protocolo de este objetivo.' : `No se pudo cargar: ${error}`}
        </div>
      </div>
    )
  }
  if (!panel) return null
  const p = panel.permisos

  return (
    <div style={card} id="protocolo-objetivo">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0', flex: 1 }}>📋 Protocolo</div>
        {p.preparar && !nueva && <button type="button" style={boton('primario')} onClick={() => setNueva(true)}>Preparar nueva versión</button>}
        <button type="button" style={boton()} onClick={() => void cargar()}>Actualizar</button>
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, lineHeight: 1.5 }}>
        Lo que el vigilador lee desde la tarjeta de su turno. Confirmar la lectura no acredita cumplimiento ni cuenta para Mi Desempeño.
      </div>

      {mensaje && (
        <div style={{
          marginTop: 10, fontSize: 13, padding: '8px 10px', borderRadius: 8,
          background: mensaje.tipo === 'ok' ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)',
          color: mensaje.tipo === 'ok' ? '#4ade80' : '#f87171',
        }}>{mensaje.texto}</div>
      )}

      {nueva && (
        <NuevaVersion
          puestos={puestos}
          onCancelar={() => setNueva(false)}
          onGuardar={async (d) => {
            const ok = await ejecutar(() => crearBorrador({ objetivoId, ...d }), 'Borrador creado. Queda sin publicar hasta que Gerencia lo apruebe.')
            if (ok) setNueva(false)
          }}
        />
      )}

      <div style={sub}>Vigente</div>
      {vigentes.length === 0 && (
        <div style={{ fontSize: 13, color: '#94a3b8' }}>
          No hay protocolo publicado: los vigiladores todavía no ven nada.
        </div>
      )}
      {vigentes.map(v => (
        <div key={v.id} style={{ border: '1px solid #14532d', borderRadius: 8, padding: 12, marginBottom: 10 }}>
          <CabeceraVersion v={v} />
          <div style={{ marginTop: 8 }}><div style={textoDoc}>{v.texto}</div></div>
          <Lecturas lecturas={panel.lecturas} versionId={v.id} />
        </div>
      ))}

      <div style={sub}>Versiones ({otras.length})</div>
      {otras.length === 0 && <div style={{ fontSize: 13, color: '#64748b' }}>Ninguna.</div>}
      <div style={{ display: 'grid', gap: 10 }}>
        {otras.map(v => (
          <TarjetaVersion
            key={v.id} v={v} permisos={p}
            verTexto={!!verTexto[v.id]}
            alternarTexto={() => setVerTexto(s => ({ ...s, [v.id]: !s[v.id] }))}
            ejecutar={ejecutar}
          />
        ))}
      </div>

      <Diferencias
        objetivoId={objetivoId}
        diferencias={panel.diferencias}
        versiones={panel.versiones}
        permisos={p}
        ejecutar={ejecutar}
      />
    </div>
  )
}

function CabeceraVersion({ v }: { v: VersionProtocolo }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={pill(COLOR_ESTADO[v.estado])}>{ETIQUETA_ESTADO[v.estado]}</span>
        {v.asociacion === 'pendiente_validacion' && <span style={pill('#f59e0b')}>Coincidencia con el objetivo sin confirmar</span>}
        <span style={{ fontSize: 13.5, fontWeight: 700, color: '#e2e8f0', overflowWrap: 'anywhere' }}>
          v{v.numero} · {v.titulo}{v.puesto_nombre ? ` · sólo ${v.puesto_nombre}` : ''}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '6px 14px', marginTop: 8, fontSize: 12.5, color: '#cbd5e1' }}>
        <div style={{ minWidth: 0 }}><div style={etiqueta}>Fuente</div><span style={{ overflowWrap: 'anywhere' }}>{v.fuente_descripcion}</span></div>
        {v.fuente_archivo_sha256 && <div style={{ minWidth: 0 }}><div style={etiqueta}>Hash de la fuente</div><code style={{ fontSize: 11 }}>{v.fuente_archivo_sha256.slice(0, 12)}…</code></div>}
        <div><div style={etiqueta}>Hash del texto</div><code style={{ fontSize: 11 }}>{v.texto_sha256.slice(0, 12)}…</code></div>
        {v.aprobado_at && <div><div style={etiqueta}>Aprobada</div>{fechaHoraAR(v.aprobado_at)}{v.aprobado_por_nombre ? ` · ${v.aprobado_por_nombre}` : ''}</div>}
        {v.estado === 'vigente' || v.estado === 'reemplazado'
          ? <div><div style={etiqueta}>Lecturas</div>{v.aperturas} abrieron · {v.confirmaciones} confirmaron</div>
          : <div><div style={etiqueta}>Creada</div>{fechaHoraAR(v.creado_at)}</div>}
      </div>
      {v.asociacion_nota && <div style={{ fontSize: 12.5, color: '#fbbf24', marginTop: 6 }}>{v.asociacion_nota}</div>}
      {v.notas && <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 6, lineHeight: 1.5 }}>{v.notas}</div>}
      {v.devuelto_motivo && v.estado === 'borrador' && <div style={{ fontSize: 12.5, color: '#f87171', marginTop: 6 }}>Devuelta por Gerencia: {v.devuelto_motivo}</div>}
      {v.motivo_descarte && <div style={{ fontSize: 12.5, color: '#f87171', marginTop: 6 }}>Descartada: {v.motivo_descarte}</div>}
    </div>
  )
}

function TarjetaVersion({ v, permisos, verTexto, alternarTexto, ejecutar }: {
  v: VersionProtocolo
  permisos: PanelObjetivo['permisos']
  verTexto: boolean
  alternarTexto: () => void
  ejecutar: (fn: () => Promise<{ error: string | null }>, ok: string) => Promise<boolean>
}) {
  const a = accionesDeVersion(v, permisos)
  // Acción que pide un segundo paso (motivo o confirmación).
  const [paso, setPaso] = useState<null | 'publicar' | 'devolver' | 'descartar' | 'asociacion' | 'editar'>(null)
  const [motivo, setMotivo] = useState('')
  const [titulo, setTitulo] = useState(v.titulo)
  const [texto, setTexto] = useState(v.texto)
  const cerrarPaso = () => { setPaso(null); setMotivo('') }

  return (
    <div style={{ border: '1px solid #1e2d42', borderRadius: 8, padding: 12, background: '#0f172a', minWidth: 0 }}>
      <CabeceraVersion v={v} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        <button type="button" style={boton()} onClick={alternarTexto}>{verTexto ? 'Ocultar texto' : 'Ver texto completo'}</button>
        {a.editar && v.fuente_tipo !== 'whatsapp' && <button type="button" style={boton()} onClick={() => setPaso('editar')}>Editar borrador</button>}
        {a.enviar && <button type="button" style={boton('primario')} onClick={() => void ejecutar(() => enviarAprobacion(v.id), 'Enviada a aprobación de Gerencia.')}>Enviar a aprobación</button>}
        {a.confirmarAsociacion && <button type="button" style={boton()} onClick={() => setPaso('asociacion')}>Confirmar objetivo</button>}
        {a.publicar && <button type="button" style={boton('ok')} onClick={() => setPaso('publicar')}>Publicar</button>}
        {a.devolver && <button type="button" style={boton()} onClick={() => setPaso('devolver')}>Devolver</button>}
        {a.descartar && <button type="button" style={boton('peligro')} onClick={() => setPaso('descartar')}>Descartar</button>}
      </div>
      {v.estado === 'pendiente_aprobacion' && v.asociacion === 'pendiente_validacion' && permisos.publicar && (
        <div style={{ fontSize: 12, color: '#fbbf24', marginTop: 6 }}>Para publicar, primero confirmá que este texto corresponde a este objetivo.</div>
      )}

      {paso && (
        <div style={{ marginTop: 10, borderTop: '1px solid #1e2d42', paddingTop: 10, display: 'grid', gap: 8 }}>
          {paso === 'publicar' && (
            <div style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.5 }}>
              Al publicar, esta versión pasa a ser la que ven los vigiladores de este objetivo{v.puesto_nombre ? ` (puesto ${v.puesto_nombre})` : ''} y
              se les pide confirmar la lectura. La vigente anterior, si hay, queda reemplazada. No se puede deshacer ni cambiar el texto después.
            </div>
          )}
          {paso === 'asociacion' && (
            <div style={{ fontSize: 13, color: '#e2e8f0' }}>¿Confirmás que este texto corresponde a este objetivo?</div>
          )}
          {(paso === 'devolver' || paso === 'descartar' || paso === 'asociacion') && (
            <textarea
              style={{ ...input, minHeight: 60 }} value={motivo} onChange={e => setMotivo(e.target.value)}
              placeholder={paso === 'asociacion' ? 'Nota (opcional)' : 'Motivo (obligatorio)'}
              aria-label={paso === 'asociacion' ? 'Nota' : 'Motivo'}
            />
          )}
          {paso === 'editar' && (
            <>
              <input style={input} value={titulo} onChange={e => setTitulo(e.target.value)} aria-label="Título" />
              <textarea style={{ ...input, minHeight: 220, fontFamily: 'inherit' }} value={texto} onChange={e => setTexto(e.target.value)} aria-label="Texto del protocolo" />
            </>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              style={boton(paso === 'descartar' ? 'peligro' : paso === 'publicar' ? 'ok' : 'primario')}
              disabled={(paso === 'devolver' || paso === 'descartar') && !motivo.trim()}
              onClick={async () => {
                let ok = false
                if (paso === 'publicar') ok = await ejecutar(() => publicarVersion(v.id), 'Publicada. Los vigiladores del objetivo ya la ven.')
                if (paso === 'devolver') ok = await ejecutar(() => devolverBorrador(v.id, motivo), 'Devuelta a borrador.')
                if (paso === 'descartar') ok = await ejecutar(() => descartarVersion(v.id, motivo), 'Versión descartada (queda guardada).')
                if (paso === 'asociacion') ok = await ejecutar(() => confirmarAsociacion(v.id, motivo || null), 'Coincidencia con el objetivo confirmada.')
                if (paso === 'editar') ok = await ejecutar(() => editarBorrador(v.id, titulo, texto, v.notas), 'Borrador guardado.')
                if (ok) cerrarPaso()
              }}
            >
              {paso === 'publicar' ? 'Sí, publicar' : paso === 'devolver' ? 'Devolver a borrador' : paso === 'descartar' ? 'Descartar versión'
                : paso === 'asociacion' ? 'Confirmar objetivo' : 'Guardar borrador'}
            </button>
            <button type="button" style={boton()} onClick={cerrarPaso}>Cancelar</button>
          </div>
        </div>
      )}

      {verTexto && <div style={{ marginTop: 10 }}><div style={textoDoc}>{v.texto}</div></div>}
    </div>
  )
}

function Lecturas({ lecturas, versionId }: { lecturas: LecturaProtocolo[]; versionId: string }) {
  const { confirmaron, abrieronSinConfirmar, sinAbrir } = separarLecturas(lecturas, versionId)
  const total = confirmaron.length + abrieronSinConfirmar.length + sinAbrir.length
  const fila = (l: LecturaProtocolo, detalle: string) => (
    <div key={l.empleado_id} style={{ fontSize: 12.5, color: '#cbd5e1', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <a href={`/guardias/${l.empleado_id}`} style={{ color: '#e2e8f0', fontWeight: 600 }}>{l.apellido}, {l.nombre}</a>
      <span style={{ color: '#64748b' }}>{detalle}</span>
    </div>
  )
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 6 }}>
        Vigiladores con turnos en los últimos 30 días o los próximos 7: <strong style={{ color: '#e2e8f0' }}>{total}</strong> ·
        confirmaron <strong style={{ color: '#4ade80' }}>{confirmaron.length}</strong> ·
        faltan <strong style={{ color: '#fbbf24' }}>{abrieronSinConfirmar.length + sinAbrir.length}</strong>
      </div>
      {total > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 12.5, color: '#93c5fd' }}>Ver quiénes</summary>
          <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
            {sinAbrir.map(l => fila(l, `sin abrir · último turno ${l.ultimo_turno ?? '—'}`))}
            {abrieronSinConfirmar.map(l => fila(l, `abrió ${fechaHoraAR(l.abierto_at)} · sin confirmar`))}
            {confirmaron.map(l => fila(l, `confirmó ${fechaHoraAR(l.confirmado_at)}`))}
          </div>
        </details>
      )}
    </div>
  )
}

function NuevaVersion({ puestos, onCancelar, onGuardar }: {
  puestos: Puesto[]
  onCancelar: () => void
  onGuardar: (d: { puestoId: string | null; titulo: string; texto: string; fuenteTipo: 'documento' | 'manual'; fuenteDescripcion: string; notas: string | null }) => Promise<void>
}) {
  const [puestoId, setPuestoId] = useState('')
  const [titulo, setTitulo] = useState('')
  const [texto, setTexto] = useState('')
  const [fuenteTipo, setFuenteTipo] = useState<'documento' | 'manual'>('documento')
  const [fuente, setFuente] = useState('')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const valido = titulo.trim() && texto.trim() && fuente.trim()
  return (
    <div style={{ border: '1px solid #78350f', borderRadius: 8, padding: 12, marginTop: 12, display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: '#fbbf24' }}>Nueva versión (queda como borrador)</div>
      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
        Pegá el texto completo tal como lo entregó Operaciones. No se resume ni se completa: lo que se publica es esto, palabra por palabra.
      </div>
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={etiqueta}>Alcance</span>
        <select id="proto-puesto" style={input} value={puestoId} onChange={e => setPuestoId(e.target.value)}>
          <option value="">Todo el objetivo</option>
          {puestos.map(p => <option key={p.id} value={p.id}>Sólo el puesto {p.nombre}</option>)}
        </select>
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={etiqueta}>Título</span>
        <input id="proto-titulo" style={input} value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ej.: Funciones y procedimientos" />
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={etiqueta}>Texto completo</span>
        <textarea id="proto-texto" style={{ ...input, minHeight: 220 }} value={texto} onChange={e => setTexto(e.target.value)} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 8 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={etiqueta}>Tipo de fuente</span>
          <select id="proto-fuente-tipo" style={input} value={fuenteTipo} onChange={e => setFuenteTipo(e.target.value as 'documento' | 'manual')}>
            <option value="documento">Documento</option>
            <option value="manual">Redactado en la app</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={etiqueta}>De dónde sale</span>
          <input id="proto-fuente" style={input} value={fuente} onChange={e => setFuente(e.target.value)} placeholder="Ej.: Instructivo de Aldo Monzón, 20/10/2026" />
        </label>
      </div>
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={etiqueta}>Notas internas (opcional)</span>
        <input id="proto-notas" style={input} value={notas} onChange={e => setNotas(e.target.value)} />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button" style={{ ...boton('primario'), opacity: valido && !guardando ? 1 : 0.5 }} disabled={!valido || guardando}
          onClick={async () => {
            setGuardando(true)
            await onGuardar({ puestoId: puestoId || null, titulo: titulo.trim(), texto, fuenteTipo, fuenteDescripcion: fuente.trim(), notas: notas.trim() || null })
            setGuardando(false)
          }}
        >
          {guardando ? 'Guardando…' : 'Guardar borrador'}
        </button>
        <button type="button" style={boton()} onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}

function Diferencias({ objetivoId, diferencias, versiones, permisos, ejecutar }: {
  objetivoId: string
  diferencias: DiferenciaProtocolo[]
  versiones: VersionProtocolo[]
  permisos: PanelObjetivo['permisos']
  ejecutar: (fn: () => Promise<{ error: string | null }>, ok: string) => Promise<boolean>
}) {
  const pendientes = diferencias.filter(d => d.estado === 'pendiente')
  const resueltas = diferencias.filter(d => d.estado === 'resuelta')
  const [nueva, setNueva] = useState(false)
  const [tipo, setTipo] = useState<TipoDiferencia>('otro')
  const [versionId, setVersionId] = useState('')
  const [origen, setOrigen] = useState('')
  const [referencia, setReferencia] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [responsable, setResponsable] = useState('')

  return (
    <>
      <div style={{ ...sub, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ flex: 1 }}>Diferencias pendientes de validación ({pendientes.length})</span>
        {permisos.registrar_diferencias && !nueva && <button type="button" style={boton()} onClick={() => setNueva(true)}>Registrar diferencia</button>}
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8, lineHeight: 1.5 }}>
        Lo que no coincide entre el protocolo, otros documentos y la configuración de la app. Registrar o resolver una diferencia no cambia rondas, alertas ni horarios.
      </div>

      {nueva && (
        <div style={{ border: '1px solid #1e3a8a', borderRadius: 8, padding: 12, display: 'grid', gap: 8, marginBottom: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={etiqueta}>Tipo</span>
              <select id="dif-tipo" style={input} value={tipo} onChange={e => setTipo(e.target.value as TipoDiferencia)}>
                {TIPOS_DIFERENCIA.map(t => <option key={t} value={t}>{ETIQUETA_TIPO_DIFERENCIA[t]}</option>)}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={etiqueta}>Versión (opcional)</span>
              <select id="dif-version" style={input} value={versionId} onChange={e => setVersionId(e.target.value)}>
                <option value="">—</option>
                {versiones.map(v => <option key={v.id} value={v.id}>v{v.numero} · {ETIQUETA_ESTADO[v.estado]}</option>)}
              </select>
            </label>
          </div>
          <input id="dif-origen" style={input} value={origen} onChange={e => setOrigen(e.target.value)} placeholder="Documento o configuración de origen (obligatorio)" aria-label="Origen" />
          <textarea id="dif-referencia" style={{ ...input, minHeight: 50 }} value={referencia} onChange={e => setReferencia(e.target.value)} placeholder="Texto o referencia original, citado tal cual" aria-label="Referencia original" />
          <textarea id="dif-descripcion" style={{ ...input, minHeight: 60 }} value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="Qué no coincide (obligatorio)" aria-label="Descripción" />
          <input id="dif-responsable" style={input} value={responsable} onChange={e => setResponsable(e.target.value)} placeholder="Responsable (opcional)" aria-label="Responsable" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button" style={boton('primario')} disabled={!origen.trim() || !descripcion.trim()}
              onClick={async () => {
                const ok = await ejecutar(() => registrarDiferencia({
                  objetivoId, versionId: versionId || null, tipo, origen: origen.trim(),
                  referenciaOriginal: referencia.trim() || null, descripcion: descripcion.trim(), responsable: responsable.trim() || null,
                }), 'Diferencia registrada.')
                if (ok) { setNueva(false); setOrigen(''); setReferencia(''); setDescripcion(''); setResponsable('') }
              }}
            >
              Registrar
            </button>
            <button type="button" style={boton()} onClick={() => setNueva(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {pendientes.length === 0 && <div style={{ fontSize: 13, color: '#64748b' }}>No hay diferencias pendientes.</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {pendientes.map(d => <TarjetaDiferencia key={d.id} d={d} permisos={permisos} ejecutar={ejecutar} />)}
      </div>
      {resueltas.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12.5, color: '#93c5fd' }}>Resueltas ({resueltas.length})</summary>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {resueltas.map(d => <TarjetaDiferencia key={d.id} d={d} permisos={permisos} ejecutar={ejecutar} />)}
          </div>
        </details>
      )}
    </>
  )
}

function TarjetaDiferencia({ d, permisos, ejecutar }: {
  d: DiferenciaProtocolo
  permisos: PanelObjetivo['permisos']
  ejecutar: (fn: () => Promise<{ error: string | null }>, ok: string) => Promise<boolean>
}) {
  const [paso, setPaso] = useState<null | 'responsable' | 'resolver'>(null)
  const [valor, setValor] = useState('')
  return (
    <div style={{ border: '1px solid #1e2d42', borderRadius: 8, padding: 10, background: '#0f172a', minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={pill(d.estado === 'pendiente' ? '#f59e0b' : '#10b981')}>{d.estado === 'pendiente' ? 'Pendiente' : 'Resuelta'}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#e2e8f0' }}>{ETIQUETA_TIPO_DIFERENCIA[d.tipo]}</span>
        {d.registro_origen === 'auditoria_20261014' && <span style={{ fontSize: 11, color: '#64748b' }}>Auditoría 14/10/2026</span>}
      </div>
      <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 6, lineHeight: 1.5 }}>{d.descripcion}</div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, overflowWrap: 'anywhere' }}>Origen: {d.origen}</div>
      {d.referencia_original && (
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, fontStyle: 'italic', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          «{d.referencia_original}»
        </div>
      )}
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Responsable: {d.responsable ?? 'sin asignar'}</div>
      {d.estado === 'resuelta' && (
        <div style={{ fontSize: 12.5, color: '#4ade80', marginTop: 6 }}>
          Resolución: {d.resolucion} · {fechaHoraAR(d.resuelta_at)}{d.resuelta_por_nombre ? ` · ${d.resuelta_por_nombre}` : ''}
        </div>
      )}
      {d.estado === 'pendiente' && (permisos.preparar || permisos.publicar) && !paso && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {permisos.preparar && <button type="button" style={boton()} onClick={() => { setValor(d.responsable ?? ''); setPaso('responsable') }}>Asignar responsable</button>}
          {permisos.publicar && <button type="button" style={boton('ok')} onClick={() => { setValor(''); setPaso('resolver') }}>Resolver</button>}
        </div>
      )}
      {paso && (
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          {paso === 'resolver'
            ? <textarea style={{ ...input, minHeight: 60 }} value={valor} onChange={e => setValor(e.target.value)} placeholder="Qué se decidió (obligatorio)" aria-label="Resolución" />
            : <input style={input} value={valor} onChange={e => setValor(e.target.value)} placeholder="Nombre del responsable" aria-label="Responsable" />}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button" style={boton(paso === 'resolver' ? 'ok' : 'primario')} disabled={paso === 'resolver' && !valor.trim()}
              onClick={async () => {
                const ok = paso === 'resolver'
                  ? await ejecutar(() => resolverDiferencia(d.id, valor), 'Diferencia resuelta.')
                  : await ejecutar(() => asignarResponsable(d.id, valor), 'Responsable asignado.')
                if (ok) setPaso(null)
              }}
            >
              {paso === 'resolver' ? 'Marcar resuelta' : 'Guardar'}
            </button>
            <button type="button" style={boton()} onClick={() => setPaso(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
