'use client'

/**
 * components/postulantes/FichaPostulante.tsx
 *
 * Ficha de revisión de una postulación (celular y computadora). Muestra la foto
 * original de la solicitud, los campos que pasan al legajo (los dudosos en
 * ámbar, con confirmación obligatoria), los datos de selección (no pasan al
 * legajo), los posibles duplicados y las acciones que corresponden al rol:
 *   - quien carga (Administración o supervisor habilitado): guardar, marcar revisado;
 *   - Administración/Gerencia: aprobar ingreso, descartar, dar de alta.
 * La base vuelve a controlar cada acción (funciones postulacion_*).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  CAMPOS, CAMPOS_SELECCION, COLOR_ESTADO, ETIQUETA_ESTADO,
  errorCampo, faltantes, mensajeError, normalizarParaGuardar,
  type ApiPostulantes, type ArchivoPostulacion, type CampoPostulacion, type CampoSeleccion,
  type Duplicado, type Postulacion, type ResultadoAlta,
} from '@/lib/postulantes'
import { comprimirImagen } from '@/lib/comprimir-imagen'

export type LecturaPropuesta = {
  valores: Partial<Record<CampoPostulacion, string | null>>
  seleccion: Partial<Record<CampoSeleccion, string | null>>
  dudosos: CampoPostulacion[]
  avisos: string[]
  /** Dónde está escrito cada dato: página y rectángulo [ymin, xmin, ymax, xmax] en milésimas. */
  regiones?: Partial<Record<CampoPostulacion, { pagina: number; caja: [number, number, number, number] }>>
}

/** Recorte de la foto original donde está escrito el dato (para comparar al confirmar). */
function RecorteFoto({ url, caja }: { url: string; caja: [number, number, number, number] }) {
  const [tam, setTam] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const img = new Image()
    img.onload = () => setTam({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = url
  }, [url])
  if (!tam) return null
  // Margen alrededor del dato para que se vea el renglón completo.
  const [y0, x0, y1, x1] = [Math.max(0, caja[0] - 15), Math.max(0, caja[1] - 20), Math.min(1000, caja[2] + 15), Math.min(1000, caja[3] + 20)]
  const rw = (x1 - x0) / 1000; const rh = (y1 - y0) / 1000
  return (
    <div role="img" aria-label="Recorte de la solicitud original" style={{
      width: '100%', aspectRatio: `${rw * tam.w} / ${rh * tam.h}`, maxHeight: 90, marginTop: 6, borderRadius: 6,
      border: '1px dashed #f59e0b', backgroundColor: '#fff', backgroundImage: `url("${url}")`, backgroundRepeat: 'no-repeat',
      backgroundSize: `${100 / rw}% ${100 / rh}%`,
      backgroundPosition: `${rw >= 1 ? 0 : (x0 / 1000 / (1 - rw)) * 100}% ${rh >= 1 ? 0 : (y0 / 1000 / (1 - rh)) * 100}%`,
    }} />
  )
}

const C = {
  fondo: '#0b1220', tarjeta: '#111827', borde: '#1e2d42', texto: '#e2e8f0', suave: '#94a3b8', tenue: '#64748b',
  ambar: '#f59e0b', ambarFondo: 'rgba(245,158,11,.10)', rojo: '#fca5a5', verde: '#22c55e', azul: '#60a5fa',
}
const tarjeta: CSSProperties = { background: C.tarjeta, border: `1px solid ${C.borde}`, borderRadius: 12, padding: 14, marginBottom: 12, minWidth: 0, boxSizing: 'border-box' }
const etiqueta: CSSProperties = { display: 'block', fontSize: 12.5, color: C.suave, fontWeight: 700, marginBottom: 4 }
const input: CSSProperties = { width: '100%', boxSizing: 'border-box', background: C.fondo, border: '1px solid #334155', borderRadius: 8, color: C.texto, padding: '10px 11px', fontSize: 15, minHeight: 44 }
const boton = (tipo: 'primario' | 'secundario' | 'peligro' | 'exito' = 'secundario'): CSSProperties => ({
  minHeight: 44, padding: '10px 16px', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer',
  border: tipo === 'secundario' ? '1px solid #334155' : tipo === 'peligro' ? '1px solid rgba(239,68,68,.55)' : 'none',
  background: tipo === 'primario' ? '#eab308' : tipo === 'exito' ? '#16a34a' : 'transparent',
  color: tipo === 'primario' ? '#0a0e1a' : tipo === 'exito' ? '#fff' : tipo === 'peligro' ? C.rojo : C.texto,
})
const titulo: CSSProperties = { fontSize: 15, fontWeight: 800, color: C.texto, marginBottom: 10 }

const PASOS: Postulacion['estado'][] = ['entrevistado', 'revisado', 'aprobado_ingreso', 'alta_efectiva']

type Valores = Partial<Record<CampoPostulacion, string | null>>

function Pasos({ estado }: { estado: Postulacion['estado'] }) {
  if (estado === 'descartado') return <div style={{ ...tarjeta, color: C.suave, fontSize: 13 }}>Postulación descartada.</div>
  const actual = PASOS.indexOf(estado)
  return (
    <ol aria-label="Etapas del alta" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 6, listStyle: 'none', padding: 0, margin: '0 0 12px' }}>
      {PASOS.map((p, i) => (
        <li key={p} aria-current={i === actual ? 'step' : undefined} style={{ textAlign: 'center' }}>
          <div style={{ height: 6, borderRadius: 3, background: i <= actual ? COLOR_ESTADO[p] : '#1f2937' }} />
          <div style={{ fontSize: 11.5, marginTop: 4, color: i === actual ? C.texto : C.tenue, fontWeight: i === actual ? 800 : 600, lineHeight: 1.2 }}>{ETIQUETA_ESTADO[p]}</div>
        </li>
      ))}
    </ol>
  )
}

function Campo({ def, valor, error, dudoso, editable, onCambio, onConfirmar, recorte }: {
  def: (typeof CAMPOS)[number]; valor: string; error: string | null; dudoso: boolean; editable: boolean
  onCambio: (v: string) => void; onConfirmar: () => void
  recorte?: ReactNode
}) {
  const id = `campo-${def.campo}`
  return (
    <div style={{ minWidth: 0 }}>
      <label htmlFor={id} style={{ ...etiqueta, color: dudoso ? C.ambar : C.suave }}>
        {def.etiqueta}{def.obligatorio ? ' *' : ''}
      </label>
      <input
        id={id}
        type={def.tipo === 'fecha' ? 'date' : def.tipo === 'email' ? 'email' : def.tipo === 'tel' ? 'tel' : 'text'}
        inputMode={def.campo === 'dni' || def.campo === 'cuil' ? 'numeric' : undefined}
        value={valor}
        disabled={!editable}
        aria-invalid={Boolean(error)}
        onChange={e => onCambio(e.target.value)}
        style={{ ...input, borderColor: error ? 'rgba(239,68,68,.7)' : dudoso ? C.ambar : '#334155', background: dudoso ? C.ambarFondo : C.fondo }}
      />
      {dudoso && recorte}
      {dudoso && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
          <span style={{ fontSize: 12, color: C.ambar }}>Dudoso: compará con la foto y confirmá o corregí.</span>
          {editable && <button type="button" onClick={onConfirmar} style={{ ...boton('secundario'), minHeight: 32, padding: '4px 10px', fontSize: 12.5, borderColor: C.ambar, color: C.ambar }}>Confirmar</button>}
        </div>
      )}
      {error && <div role="alert" style={{ fontSize: 12, color: C.rojo, marginTop: 4 }}>{error}</div>}
    </div>
  )
}

export default function FichaPostulante({ api, postulacion, permisos, onVolver, onCambio, lector }: {
  api: ApiPostulantes
  /** null = postulación nueva (se crea al guardar o al subir la primera foto). */
  postulacion: Postulacion | null
  permisos: { gestiona: boolean; carga: boolean }
  onVolver: () => void
  onCambio: (id: string) => void
  /** Lectura de la solicitud con IA (PR 3). Devuelve una propuesta; nunca guarda sola. */
  lector?: (postulacionId: string) => Promise<LecturaPropuesta>
}) {
  const [id, setId] = useState<string | null>(postulacion?.id ?? null)
  const estado = postulacion?.estado ?? 'entrevistado'
  const cerrada = estado === 'alta_efectiva' || estado === 'descartado'
  const editable = !cerrada && (permisos.gestiona || (permisos.carga && (estado === 'entrevistado' || estado === 'revisado')))

  const inicial = useMemo<Valores>(() => {
    const v: Valores = {}
    for (const c of CAMPOS) v[c.campo] = (postulacion?.[c.campo] as string | null | undefined) ?? ''
    if (!postulacion) v.fecha_entrevista = new Date().toISOString().slice(0, 10)
    return v
  }, [postulacion])
  const [valores, setValores] = useState<Valores>(inicial)
  const [seleccion, setSeleccion] = useState<Partial<Record<CampoSeleccion, string>>>(postulacion?.datos_seleccion ?? {})
  const [observaciones, setObservaciones] = useState(postulacion?.observaciones ?? '')
  const [dudosos, setDudosos] = useState<string[]>(postulacion?.campos_dudosos ?? [])
  const [archivos, setArchivos] = useState<ArchivoPostulacion[]>([])
  const [vista, setVista] = useState<{ id: string; url: string; pdf: boolean } | null>(null)
  const [duplicados, setDuplicados] = useState<Duplicado[] | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error' | 'info'; texto: string } | null>(null)
  const [avisosLectura, setAvisosLectura] = useState<string[]>([])
  const [regiones, setRegiones] = useState<NonNullable<LecturaPropuesta['regiones']>>({})
  const [fotoPagina, setFotoPagina] = useState<Record<number, string>>({})
  const [modo, setModo] = useState<null | 'aprobar' | 'descartar' | 'alta'>(null)
  const [fechaIngreso, setFechaIngreso] = useState(postulacion?.fecha_ingreso_prevista ?? new Date().toISOString().slice(0, 10))
  const [legajo, setLegajo] = useState(postulacion?.legajo_propuesto ?? '')
  const [motivo, setMotivo] = useState('')
  const [alta, setAlta] = useState<ResultadoAlta | null>(null)
  const camara = useRef<HTMLInputElement>(null)
  const archivo = useRef<HTMLInputElement>(null)

  const cargarArchivos = useCallback(async (pid: string) => {
    try { setArchivos(await api.archivos(pid)) } catch (e) { setAviso({ tipo: 'error', texto: mensajeError(e) }) }
  }, [api])
  const buscarDuplicados = useCallback(async (pid: string, v: Valores) => {
    if (!v.dni && !v.cuil && !v.email && !v.telefono) { setDuplicados([]); return }
    try { setDuplicados(await api.duplicados({ id: pid, ...normalizarParaGuardar({ dni: v.dni, cuil: v.cuil, email: v.email, telefono: v.telefono }) })) }
    catch { setDuplicados(null) }
  }, [api])
  useEffect(() => {
    if (!postulacion?.id) return
    void cargarArchivos(postulacion.id)
    void buscarDuplicados(postulacion.id, inicial)
  }, [postulacion?.id, cargarArchivos, buscarDuplicados, inicial])

  const errores = useMemo(() => {
    const e: Partial<Record<CampoPostulacion, string>> = {}
    for (const c of CAMPOS) { const err = errorCampo(c.campo, valores[c.campo], valores); if (err) e[c.campo] = err }
    return e
  }, [valores])
  const hayErrores = Object.keys(errores).length > 0

  const payload = () => ({
    ...normalizarParaGuardar(valores),
    datos_seleccion: Object.fromEntries(Object.entries(seleccion).filter(([, v]) => String(v ?? '').trim())),
    campos_dudosos: dudosos,
    observaciones: observaciones.trim() || null,
  })

  /** Crea la postulación si es nueva. Devuelve el id. */
  const asegurarId = async (): Promise<string> => {
    if (id) return id
    const nuevo = await api.crear(payload())
    setId(nuevo)
    onCambio(nuevo)
    return nuevo
  }

  const correr = async (clave: string, fn: () => Promise<void>) => {
    setOcupado(clave); setAviso(null)
    try { await fn() } catch (e) { setAviso({ tipo: 'error', texto: mensajeError(e) }) } finally { setOcupado(null) }
  }

  const guardar = () => correr('guardar', async () => {
    if (hayErrores) throw new Error('Corregí los campos marcados en rojo antes de guardar.')
    const pid = id ?? await asegurarId()
    if (id) await api.guardar(pid, payload())
    await buscarDuplicados(pid, valores)
    onCambio(pid)
    setAviso({ tipo: 'ok', texto: 'Cambios guardados.' })
  })

  const subir = (lista: FileList | null) => correr('subir', async () => {
    if (!lista?.length) return
    const pid = await asegurarId()
    let orden = archivos.length
    for (const f of Array.from(lista).slice(0, 4 - archivos.length)) {
      orden += 1
      // Manuscrito: más resolución que una foto operativa (2000 px, calidad 0,85) para que se lea bien.
      const blob = f.type.startsWith('image/') && f.type !== 'image/heic'
        ? await comprimirImagen(f, { ladoMayor: 2000, quality: 0.85, timeoutMs: 15_000 }).catch(() => f)
        : f
      await api.subirArchivo(pid, blob, orden)
    }
    await cargarArchivos(pid)
    setAviso({ tipo: 'ok', texto: 'Solicitud guardada en el archivo privado.' })
  })

  const leer = () => correr('leer', async () => {
    if (!lector || !id) return
    const p = await lector(id)
    setValores(v => {
      const n = { ...v }
      for (const [k, val] of Object.entries(p.valores)) if (val != null && String(val).trim()) n[k as CampoPostulacion] = String(val)
      return n
    })
    setSeleccion(s => {
      const n = { ...s }
      for (const [k, val] of Object.entries(p.seleccion)) if (val != null && String(val).trim()) n[k as CampoSeleccion] = String(val)
      return n
    })
    setDudosos(d => Array.from(new Set([...d, ...p.dudosos])))
    setAvisosLectura(p.avisos)
    setRegiones(p.regiones ?? {})
    // Fotos de las páginas con datos dudosos, para mostrar el recorte al lado del campo.
    const paginas = Array.from(new Set(p.dudosos.map(c => p.regiones?.[c]?.pagina).filter((n): n is number => typeof n === 'number')))
    const urls: Record<number, string> = {}
    for (const n of paginas) {
      const a = archivos.find(x => x.orden === n && x.mime !== 'application/pdf')
      if (a) urls[n] = await api.urlArchivo(a.id).catch(() => '')
    }
    setFotoPagina(urls)
    setAviso({ tipo: 'info', texto: `Lectura lista: revisá los ${p.dudosos.length} campo(s) en ámbar y tocá "Guardar". Nada se guardó todavía.` })
  })

  const marcarRevisada = () => correr('revisar', async () => {
    if (!id) throw new Error('Guardá la postulación primero.')
    if (dudosos.length) throw new Error('Confirmá los campos dudosos (en ámbar) antes de marcarla como revisada.')
    const f = faltantes(valores as Partial<Postulacion>, 'revisar')
    if (f.length) throw new Error(`Faltan datos: ${f.map(c => CAMPOS.find(x => x.campo === c)?.etiqueta).join(', ')}.`)
    if (hayErrores) throw new Error('Corregí los campos marcados en rojo.')
    await api.guardar(id, payload())
    await api.marcarRevisada(id)
    onCambio(id)
    setAviso({ tipo: 'ok', texto: 'Postulación revisada. Queda para que Administración autorice el ingreso.' })
  })

  const aprobar = () => correr('aprobar', async () => {
    if (!id) return
    await api.aprobar(id, fechaIngreso || null, legajo.trim() || null)
    setModo(null); onCambio(id)
    setAviso({ tipo: 'ok', texto: 'Ingreso aprobado. Todavía no es empleado: falta el alta efectiva.' })
  })

  const descartar = () => correr('descartar', async () => {
    if (!id) return
    await api.descartar(id, motivo)
    setModo(null); onCambio(id)
    setAviso({ tipo: 'ok', texto: 'Postulación descartada. Sus datos y la foto se podrán eliminar en 180 días.' })
  })

  const darAlta = () => correr('alta', async () => {
    if (!id) return
    const r = await api.darAlta(id)
    setAlta(r); setModo(null); onCambio(id)
    setAviso({ tipo: r.invitacion === 'error' ? 'error' : 'ok', texto: r.mensaje })
  })

  const grupos = Array.from(new Set(CAMPOS.map(c => c.grupo)))
  const nombre = [valores.apellido, valores.nombre].filter(Boolean).join(', ')
  const enPersonal = (duplicados ?? []).filter(d => d.donde === 'personal')

  const avisoCaja = (a: NonNullable<typeof aviso>): ReactNode => (
    <div role={a.tipo === 'error' ? 'alert' : 'status'} style={{
      ...tarjeta, fontSize: 14,
      color: a.tipo === 'error' ? C.rojo : a.tipo === 'ok' ? '#86efac' : '#bfdbfe',
      borderColor: a.tipo === 'error' ? 'rgba(239,68,68,.45)' : a.tipo === 'ok' ? 'rgba(34,197,94,.4)' : 'rgba(96,165,250,.4)',
    }}>{a.texto}</div>
  )

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <button type="button" onClick={onVolver} style={{ ...boton('secundario'), minHeight: 38, padding: '6px 12px' }}>← Postulantes</button>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.texto, overflowWrap: 'anywhere', flex: '1 1 200px' }}>{nombre || 'Nuevo vigilador'}</div>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: COLOR_ESTADO[estado], border: `1px solid ${COLOR_ESTADO[estado]}`, borderRadius: 999, padding: '3px 10px' }}>{ETIQUETA_ESTADO[estado]}</span>
      </div>
      <Pasos estado={estado} />
      {aviso && avisoCaja(aviso)}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 12, alignItems: 'start' }}>
        {/* Solicitud en papel */}
        <section aria-labelledby="t-solicitud" style={tarjeta}>
          <div id="t-solicitud" style={titulo}>Solicitud en papel</div>
          {archivos.length === 0 && <div style={{ fontSize: 13.5, color: C.suave, marginBottom: 10 }}>Sacá una foto de la solicitud completa, bien iluminada y sin cortar los bordes. Podés cargar hasta 4 páginas.</div>}
          {archivos.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {archivos.map(a => (
                <button key={a.id} type="button" onClick={() => void correr('ver', async () => setVista({ id: a.id, url: await api.urlArchivo(a.id), pdf: a.mime === 'application/pdf' }))}
                  style={{ ...boton('secundario'), minHeight: 40, fontWeight: 700, borderColor: vista?.id === a.id ? C.azul : '#334155' }}>
                  {a.mime === 'application/pdf' ? '📄' : '🖼️'} Página {a.orden}
                </button>
              ))}
            </div>
          )}
          {vista && (
            <div style={{ marginBottom: 10 }}>
              {vista.pdf
                ? <a href={vista.url} target="_blank" rel="noreferrer" style={{ color: C.azul }}>Abrir PDF (enlace válido por 60 segundos)</a>
                : <img src={vista.url} alt="Foto de la solicitud de empleo" style={{ width: '100%', borderRadius: 8, border: `1px solid ${C.borde}`, background: '#000' }} />}
              <div style={{ fontSize: 11.5, color: C.tenue, marginTop: 4 }}>Archivo privado: cada apertura queda registrada.</div>
            </div>
          )}
          {editable && archivos.length < 4 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button type="button" disabled={ocupado === 'subir'} onClick={() => camara.current?.click()} style={boton('primario')}>📷 Sacar foto</button>
              <button type="button" disabled={ocupado === 'subir'} onClick={() => archivo.current?.click()} style={boton('secundario')}>🗂️ Elegir archivo</button>
              <input ref={camara} type="file" accept="image/*" capture="environment" hidden onChange={e => { void subir(e.target.files); e.target.value = '' }} />
              <input ref={archivo} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple hidden onChange={e => { void subir(e.target.files); e.target.value = '' }} />
            </div>
          )}
          {ocupado === 'subir' && <div style={{ fontSize: 13, color: C.suave, marginTop: 8 }}>Subiendo…</div>}
          {lector && editable && archivos.length > 0 && (
            <button type="button" disabled={ocupado === 'leer'} onClick={() => void leer()} style={{ ...boton('secundario'), width: '100%', marginTop: 10, borderColor: C.azul, color: '#bfdbfe' }}>
              {ocupado === 'leer' ? 'Leyendo la solicitud…' : '✨ Leer la solicitud con IA'}
            </button>
          )}
          {avisosLectura.length > 0 && (
            <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12.5, color: C.ambar }}>
              {avisosLectura.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          )}
          <div style={{ fontSize: 12, color: C.tenue, marginTop: 10, lineHeight: 1.4 }}>
            No se cargan datos de salud, medicación, antecedentes ni de familiares: aunque figuren en el papel, no se transcriben.
          </div>
        </section>

        {/* Datos que pasan al legajo */}
        <section aria-labelledby="t-datos" style={tarjeta}>
          <div id="t-datos" style={titulo}>Datos para el legajo</div>
          {dudosos.length > 0 && (
            <div style={{ fontSize: 13, color: C.ambar, background: C.ambarFondo, borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
              {dudosos.length} campo(s) dudoso(s): no se puede avanzar hasta confirmarlos.
            </div>
          )}
          {grupos.map(g => (
            <fieldset key={g} style={{ border: 'none', padding: 0, margin: '0 0 14px' }}>
              <legend style={{ fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: C.tenue, fontWeight: 800, marginBottom: 6 }}>{g}</legend>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 10 }}>
                {CAMPOS.filter(c => c.grupo === g).map(c => (
                  <Campo key={c.campo} def={c} valor={String(valores[c.campo] ?? '')} error={errores[c.campo] ?? null}
                    dudoso={dudosos.includes(c.campo)} editable={editable}
                    onCambio={v => setValores(x => ({ ...x, [c.campo]: v }))}
                    onConfirmar={() => setDudosos(d => d.filter(x => x !== c.campo))}
                    recorte={regiones[c.campo] && fotoPagina[regiones[c.campo]!.pagina]
                      ? <RecorteFoto url={fotoPagina[regiones[c.campo]!.pagina]} caja={regiones[c.campo]!.caja} />
                      : undefined} />
                ))}
              </div>
            </fieldset>
          ))}
        </section>

        {/* Selección (no pasa al legajo) */}
        <section aria-labelledby="t-seleccion" style={tarjeta}>
          <details>
            <summary id="t-seleccion" style={{ ...titulo, cursor: 'pointer', marginBottom: 0 }}>Datos de la entrevista <span style={{ fontWeight: 600, color: C.tenue, fontSize: 12.5 }}>(no pasan al legajo)</span></summary>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 10, marginTop: 10 }}>
              {CAMPOS_SELECCION.map(c => (
                <div key={c.campo}>
                  <label htmlFor={`sel-${c.campo}`} style={etiqueta}>{c.etiqueta}</label>
                  <input id={`sel-${c.campo}`} value={seleccion[c.campo] ?? ''} disabled={!editable} maxLength={200}
                    onChange={e => setSeleccion(s => ({ ...s, [c.campo]: e.target.value }))} style={input} />
                </div>
              ))}
            </div>
            <label htmlFor="obs" style={{ ...etiqueta, marginTop: 10 }}>Observaciones de la entrevista</label>
            <textarea id="obs" value={observaciones} disabled={!editable} maxLength={500} rows={3}
              onChange={e => setObservaciones(e.target.value)} style={{ ...input, minHeight: 80, resize: 'vertical' }} />
          </details>
        </section>

        {/* Duplicados */}
        <section aria-labelledby="t-dup" style={tarjeta}>
          <div id="t-dup" style={titulo}>Control de duplicados</div>
          {duplicados === null && <div style={{ fontSize: 13.5, color: C.suave }}>Se verifica por DNI, CUIL, email y celular al guardar.</div>}
          {duplicados && duplicados.length === 0 && <div style={{ fontSize: 13.5, color: '#86efac' }}>✓ No hay coincidencias en el personal ni en otras postulaciones.</div>}
          {duplicados && duplicados.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, color: C.rojo }}>
              {duplicados.map((d, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  {d.donde === 'personal' ? 'Ya existe en el personal' : 'Hay otra postulación abierta'} (coincide por {d.coincide_por})
                  {d.nombre ? ` — ${d.nombre}` : ''}{d.legajo ? `, legajo ${d.legajo}` : ''}{d.estado ? `, ${d.estado}` : ''}
                  {d.donde === 'personal' && d.referencia_id && <> · <a href={`/guardias/${d.referencia_id}`} style={{ color: C.azul }}>ver legajo</a></>}
                </li>
              ))}
            </ul>
          )}
          {enPersonal.length > 0 && <div style={{ fontSize: 12.5, color: C.suave, marginTop: 6 }}>Si es un reingreso, se gestiona desde su legajo: no se crea un empleado nuevo.</div>}
        </section>
      </div>

      {/* Resultado del alta */}
      {(alta || postulacion?.usuario_id) && (
        <div style={{ ...tarjeta, borderColor: 'rgba(34,197,94,.4)' }}>
          <div style={{ ...titulo, color: '#86efac' }}>Empleado dado de alta</div>
          <a href={`/guardias/${alta?.usuario_id ?? postulacion?.usuario_id}`} style={{ color: C.azul, fontWeight: 700 }}>Abrir su legajo →</a>
          <div style={{ fontSize: 12.5, color: C.suave, marginTop: 6 }}>Cuando ingrese por primera vez, la app le va a pedir sólo los datos que falten (por ejemplo, el contacto de emergencia).</div>
        </div>
      )}

      {/* Acciones */}
      {!cerrada && (
        <div style={{ position: 'sticky', bottom: 0, background: 'linear-gradient(transparent, #0a0e1a 30%)', paddingTop: 16, paddingBottom: 'max(10px, env(safe-area-inset-bottom))', zIndex: 5 }}>
          {modo === 'aprobar' && (
            <div style={tarjeta}>
              <div style={titulo}>Autorizar el ingreso</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 10 }}>
                <div><label htmlFor="f-ingreso" style={etiqueta}>Fecha de ingreso prevista</label><input id="f-ingreso" type="date" value={fechaIngreso} onChange={e => setFechaIngreso(e.target.value)} style={input} /></div>
                <div><label htmlFor="f-legajo" style={etiqueta}>Legajo (vacío = CUIL)</label><input id="f-legajo" value={legajo} placeholder={String(valores.cuil ?? '').replace(/\D/g, '')} onChange={e => setLegajo(e.target.value)} style={input} /></div>
              </div>
              <div style={{ fontSize: 12.5, color: C.suave, margin: '8px 0' }}>Todavía no se crea el empleado ni su cuenta.</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" disabled={ocupado === 'aprobar'} onClick={() => void aprobar()} style={boton('exito')}>Aprobar ingreso</button>
                <button type="button" onClick={() => setModo(null)} style={boton()}>Cancelar</button>
              </div>
            </div>
          )}
          {modo === 'descartar' && (
            <div style={tarjeta}>
              <label htmlFor="f-motivo" style={etiqueta}>Motivo del descarte</label>
              <input id="f-motivo" value={motivo} maxLength={300} onChange={e => setMotivo(e.target.value)} style={input} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <button type="button" disabled={ocupado === 'descartar' || motivo.trim().length < 3} onClick={() => void descartar()} style={boton('peligro')}>Descartar</button>
                <button type="button" onClick={() => setModo(null)} style={boton()}>Cancelar</button>
              </div>
            </div>
          )}
          {modo === 'alta' && (
            <div style={{ ...tarjeta, borderColor: 'rgba(234,179,8,.5)' }}>
              <div style={titulo}>Confirmar alta efectiva</div>
              <div style={{ fontSize: 13.5, color: C.texto, lineHeight: 1.5 }}>
                Se crea el empleado <b>{nombre}</b> (legajo {postulacion?.legajo_propuesto}), activo, con puesto vigilador, y su Legajo Digital con los datos revisados.
                Desde ese momento puede recibir turnos. Si el acceso por invitación está habilitado, se le envía un email a <b>{valores.email}</b> para que elija su contraseña.
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                <button type="button" disabled={ocupado === 'alta'} onClick={() => void darAlta()} style={boton('exito')}>{ocupado === 'alta' ? 'Dando de alta…' : 'Sí, dar de alta'}</button>
                <button type="button" onClick={() => setModo(null)} style={boton()}>Cancelar</button>
              </div>
            </div>
          )}
          {!modo && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {editable && <button type="button" disabled={ocupado === 'guardar'} onClick={() => void guardar()} style={boton('primario')}>{ocupado === 'guardar' ? 'Guardando…' : 'Guardar'}</button>}
              {editable && estado === 'entrevistado' && id && <button type="button" disabled={ocupado === 'revisar'} onClick={() => void marcarRevisada()} style={boton()}>Marcar como revisada</button>}
              {permisos.gestiona && estado === 'revisado' && <button type="button" onClick={() => setModo('aprobar')} style={boton('exito')}>Aprobar ingreso</button>}
              {permisos.gestiona && estado === 'aprobado_ingreso' && <button type="button" onClick={() => setModo('alta')} style={boton('exito')}>Dar de alta</button>}
              {permisos.gestiona && id && <button type="button" onClick={() => setModo('descartar')} style={boton('peligro')}>Descartar</button>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
