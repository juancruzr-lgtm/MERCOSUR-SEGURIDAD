'use client'
//
// Referencias IA — Administración.
//
// Define QUÉ se espera revisar en cada tipo de evidencia y con qué fotos de
// referencia. FASE B: acá no se analiza nada, no se llama a ningún proveedor y
// no hay prompts. Sólo se construye la configuración que FASE C va a usar.
//
// Lectura: directa por RLS (el navegador consulta las tablas con su sesión).
// Escritura: siempre por /api/ia/* con service_role y validación de rol.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { brandColors, brandTypography, semanticColors } from '@/lib/brand-theme'
import {
  ETIQUETA_TIPO,
  catalogoInicial,
  esBorrador,
  estaVigenteAhora,
  normalizarClave,
  type ElementoCriterio,
  type TipoReferenciaIA,
} from '@/lib/ia/referencias'

const FONT = brandTypography?.fontFamily ?? 'system-ui, sans-serif'
const C = {
  card:   '#111827',
  border: '#1e2d42',
  muted:  '#64748b',
  text:   '#e2e8f0',
  sub:    '#94a3b8',
  yellow: brandColors.yellow ?? '#f59e0b',
  green:  semanticColors.success ?? '#22c55e',
  red:    semanticColors.error ?? '#ef4444',
  blue:   '#3b82f6',
}

const card = (extra: Record<string, unknown> = {}): React.CSSProperties => ({
  background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
  padding: '18px 20px', ...extra,
})

const badge = (color: string): React.CSSProperties => ({
  display: 'inline-block', padding: '2px 10px', borderRadius: 999,
  fontSize: 11, fontWeight: 700, background: color + '22', color, fontFamily: FONT,
})

const boton = (color: string, activo = true): React.CSSProperties => ({
  padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700,
  border: `1px solid ${color}55`, background: activo ? color + '22' : 'transparent',
  color, cursor: activo ? 'pointer' : 'not-allowed', fontFamily: FONT,
  opacity: activo ? 1 : 0.5,
})

const input: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
  background: '#0a0e1a', border: `1px solid ${C.border}`, color: C.text, fontFamily: FONT,
}

// ── Tipos de fila ───────────────────────────────────────────────────────────

type Configuracion = {
  id: string
  analisis_tipo: TipoReferenciaIA
  version: string
  nombre: string
  descripcion: string | null
  criterios: { elementos?: ElementoCriterio[] } | null
  modelo: string | null
  prompt: string | null
  activo: boolean
  vigente_desde: string
  vigente_hasta: string | null
  created_at: string
}

type ImagenReferencia = {
  id: string
  configuracion_id: string
  descripcion: string | null
  activo: boolean
  bytes: number | null
  created_at: string
}

type ReferenciaPunto = {
  id: string
  ronda_punto_id: string
  descripcion: string | null
  activo: boolean
  vigente_desde: string
  vigente_hasta: string | null
  created_at: string
}

const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

async function headersAuth(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sesión requerida')
  return { Authorization: `Bearer ${token}` }
}

// ════════════════════════════════════════════════════════════════════════════
// Editor de criterios
// ════════════════════════════════════════════════════════════════════════════

function EditorCriterios({
  elementos, onChange, deshabilitado,
}: { elementos: ElementoCriterio[], onChange: (e: ElementoCriterio[]) => void, deshabilitado?: boolean }) {
  const actualizar = (i: number, campo: keyof ElementoCriterio, valor: string | boolean) => {
    const copia = elementos.map((e, idx) => idx === i ? { ...e, [campo]: valor } : e)
    onChange(copia)
  }

  return (
    <div>
      {elementos.map((el, i) => (
        <div key={i} style={{
          display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap',
          padding: '8px 0', borderBottom: `1px solid ${C.border}55`,
        }}>
          <input
            style={{ ...input, flex: '1 1 160px', minWidth: 120 }}
            value={el.etiqueta}
            placeholder="Elemento a revisar"
            disabled={deshabilitado}
            onChange={e => actualizar(i, 'etiqueta', e.target.value)}
          />
          <input
            style={{ ...input, flex: '2 1 220px', minWidth: 140 }}
            value={el.nota}
            placeholder="Nota para quien revisa (opcional)"
            disabled={deshabilitado}
            onChange={e => actualizar(i, 'nota', e.target.value)}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.sub, padding: '8px 0' }}>
            <input
              type="checkbox"
              checked={el.requerido}
              disabled={deshabilitado}
              onChange={e => actualizar(i, 'requerido', e.target.checked)}
            />
            Requerido
          </label>
          <button
            style={{ ...boton(C.red), padding: '6px 10px' }}
            disabled={deshabilitado}
            onClick={() => onChange(elementos.filter((_, idx) => idx !== i))}
            title="Quitar elemento"
          >✕</button>
        </div>
      ))}

      <button
        style={{ ...boton(C.blue), marginTop: 12 }}
        disabled={deshabilitado}
        onClick={() => onChange([...elementos, { clave: '', etiqueta: '', requerido: false, nota: '' }])}
      >+ Agregar elemento</button>

      <div style={{ marginTop: 12, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
        Cada elemento va a poder resultar <strong style={{ color: C.green }}>PRESENTE</strong>,{' '}
        <strong style={{ color: C.red }}>AUSENTE</strong> o{' '}
        <strong style={{ color: C.yellow }}>NO&nbsp;DETERMINABLE</strong>.
        Si algo no se ve en la foto, el resultado es NO DETERMINABLE — nunca AUSENTE.
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Fotos de referencia de una configuración
// ════════════════════════════════════════════════════════════════════════════

function ImagenesConfiguracion({
  configuracionId, esAdmin, onCambio,
}: { configuracionId: string, esAdmin: boolean, onCambio: () => void }) {
  const [imagenes, setImagenes] = useState<ImagenReferencia[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState('')
  const [ampliada, setAmpliada] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from('ia_referencia_imagenes')
      .select('id, configuracion_id, descripcion, activo, bytes, created_at')
      .eq('configuracion_id', configuracionId)
      .order('orden', { ascending: true })

    const filas = (data ?? []) as ImagenReferencia[]
    setImagenes(filas)
    if (filas.length === 0) { setUrls({}); return }

    try {
      const res = await fetch('/api/ia/referencias/url', {
        method: 'POST',
        headers: { ...(await headersAuth()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: 'configuracion', ids: filas.map(f => f.id) }),
      })
      const json = await res.json()
      if (res.ok) setUrls(json.urls ?? {})
    } catch { /* la miniatura queda sin cargar; no rompe la pantalla */ }
  }, [configuracionId])

  useEffect(() => { cargar() }, [cargar])

  const subir = async (archivo: File) => {
    setSubiendo(true); setError('')
    try {
      const fd = new FormData()
      fd.append('configuracion_id', configuracionId)
      fd.append('imagen', archivo)
      const res = await fetch('/api/ia/referencias/imagen', {
        method: 'POST', headers: await headersAuth(), body: fd,
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'No se pudo subir')
      await cargar(); onCambio()
    } catch (e: any) {
      setError(e.message || 'Error al subir')
    } finally {
      setSubiendo(false)
    }
  }

  const alternar = async (img: ImagenReferencia) => {
    try {
      const res = await fetch('/api/ia/referencias/imagen', {
        method: 'PATCH',
        headers: { ...(await headersAuth()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: img.id, activo: !img.activo }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      await cargar(); onCambio()
    } catch (e: any) {
      setError(e.message || 'Error')
    }
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, marginBottom: 8 }}>
        FOTOS DE REFERENCIA ({imagenes.filter(i => i.activo).length} activas de {imagenes.length})
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {imagenes.map(img => (
          <div key={img.id} style={{
            width: 128, border: `1px solid ${img.activo ? C.green + '66' : C.border}`,
            borderRadius: 8, overflow: 'hidden', background: '#0a0e1a',
            opacity: img.activo ? 1 : 0.5,
          }}>
            {urls[img.id]
              ? <img
                  src={urls[img.id]} alt="" loading="lazy" decoding="async"
                  style={{ width: '100%', height: 96, objectFit: 'cover', cursor: 'zoom-in', display: 'block' }}
                  onClick={() => setAmpliada(urls[img.id])}
                />
              : <div style={{ height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 11 }}>
                  sin vista previa
                </div>}
            <div style={{ padding: '6px 8px', fontSize: 10, color: C.muted }}>
              {fecha(img.created_at)}
              {esAdmin && (
                <button
                  style={{ ...boton(img.activo ? C.red : C.green), padding: '3px 8px', fontSize: 10, marginTop: 6, width: '100%' }}
                  onClick={() => alternar(img)}
                >{img.activo ? 'Desactivar' : 'Reactivar'}</button>
              )}
            </div>
          </div>
        ))}

        {esAdmin && (
          <label style={{
            width: 128, height: 130, border: `1px dashed ${C.border}`, borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
            color: C.sub, fontSize: 12, cursor: subiendo ? 'wait' : 'pointer', padding: 8,
          }}>
            {subiendo ? 'Subiendo…' : '+ Agregar foto'}
            <input
              type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
              disabled={subiendo}
              onChange={e => { const f = e.target.files?.[0]; if (f) subir(f); e.target.value = '' }}
            />
          </label>
        )}
      </div>

      {error && <div style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{error}</div>}

      {ampliada && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'zoom-out',
          }}
          onClick={() => setAmpliada(null)}
        >
          <img src={ampliada} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Pestaña de configuraciones (uniforme / libro)
// ════════════════════════════════════════════════════════════════════════════

function TabConfiguraciones({ tipo, esAdmin }: { tipo: TipoReferenciaIA, esAdmin: boolean }) {
  const [configs, setConfigs] = useState<Configuracion[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [creando, setCreando] = useState(false)
  const [expandida, setExpandida] = useState<string | null>(null)
  const [borrador, setBorrador] = useState<{ nombre: string, descripcion: string, elementos: ElementoCriterio[] } | null>(null)
  const [editando, setEditando] = useState<Record<string, ElementoCriterio[]>>({})
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data, error: e } = await supabase
      .from('ia_configuraciones')
      .select('*')
      .eq('analisis_tipo', tipo)
      .order('created_at', { ascending: false })
    if (e) setError(e.message)
    setConfigs((data ?? []) as Configuracion[])
    setCargando(false)
  }, [tipo])

  useEffect(() => { cargar() }, [cargar])

  const crear = async () => {
    if (!borrador) return
    setGuardando(true); setError('')
    try {
      const res = await fetch('/api/ia/referencias', {
        method: 'POST',
        headers: { ...(await headersAuth()), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analisis_tipo: tipo,
          nombre: borrador.nombre,
          descripcion: borrador.descripcion,
          criterios: { elementos: borrador.elementos.map(e => ({ ...e, clave: e.clave || normalizarClave(e.etiqueta) })) },
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'No se pudo crear')
      setCreando(false); setBorrador(null)
      await cargar()
      setExpandida(json.configuracion?.id ?? null)
    } catch (e: any) {
      setError(e.message || 'Error')
    } finally {
      setGuardando(false)
    }
  }

  const parchear = async (id: string, cambios: Record<string, unknown>) => {
    setGuardando(true); setError('')
    try {
      const res = await fetch('/api/ia/referencias', {
        method: 'PATCH',
        headers: { ...(await headersAuth()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...cambios }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'No se pudo actualizar')
      await cargar()
    } catch (e: any) {
      setError(e.message || 'Error')
    } finally {
      setGuardando(false)
    }
  }

  // Deriva el prompt desde los criterios y fija el modelo: pasa de borrador a
  // analizable. No se escribe prompt a mano en ningún lado.
  const preparar = async (id: string) => {
    setGuardando(true); setError('')
    try {
      const res = await fetch('/api/ia/referencias/preparar', {
        method: 'POST',
        headers: { ...(await headersAuth()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'No se pudo preparar')
      await cargar()
    } catch (e: any) {
      setError(e.message || 'Error')
    } finally {
      setGuardando(false)
    }
  }

  const iniciarAlta = () => {
    setBorrador({ nombre: `${ETIQUETA_TIPO[tipo]} — criterios`, descripcion: '', elementos: catalogoInicial(tipo) })
    setCreando(true)
  }

  if (cargando) return <div style={{ color: C.muted, padding: 24 }}>Cargando…</div>

  return (
    <div>
      {error && <div style={{ ...card({ borderColor: C.red + '66', marginBottom: 14 }), color: C.red, fontSize: 13 }}>{error}</div>}

      {esAdmin && !creando && (
        <button style={{ ...boton(C.yellow), marginBottom: 16 }} onClick={iniciarAlta}>
          + Nueva configuración de {ETIQUETA_TIPO[tipo].toLowerCase()}
        </button>
      )}

      {creando && borrador && (
        <div style={card({ marginBottom: 18, borderColor: C.yellow + '66' })}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12, color: C.text }}>
            Nueva configuración — {ETIQUETA_TIPO[tipo]}
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: C.sub }}>Nombre</label>
            <input style={input} value={borrador.nombre} onChange={e => setBorrador({ ...borrador, nombre: e.target.value })} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: C.sub }}>Descripción (opcional)</label>
            <input style={input} value={borrador.descripcion} onChange={e => setBorrador({ ...borrador, descripcion: e.target.value })} />
          </div>
          <EditorCriterios
            elementos={borrador.elementos}
            onChange={elementos => setBorrador({ ...borrador, elementos })}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button style={boton(C.green, !guardando)} disabled={guardando} onClick={crear}>
              {guardando ? 'Guardando…' : 'Crear configuración'}
            </button>
            <button style={boton(C.muted)} onClick={() => { setCreando(false); setBorrador(null) }}>Cancelar</button>
          </div>
        </div>
      )}

      {configs.length === 0 && !creando && (
        <div style={{ ...card(), color: C.muted, fontSize: 13 }}>
          Todavía no hay configuraciones de {ETIQUETA_TIPO[tipo].toLowerCase()}.
        </div>
      )}

      {configs.map(cfg => {
        const vigente = estaVigenteAhora(cfg)
        const elementos = editando[cfg.id] ?? (cfg.criterios?.elementos ?? [])
        const abierta = expandida === cfg.id
        return (
          <div key={cfg.id} style={card({ marginBottom: 12, borderColor: vigente ? C.green + '55' : C.border })}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={badge(vigente ? C.green : C.muted)}>{vigente ? 'ACTIVA' : 'INACTIVA'}</span>
              <span style={badge(C.blue)}>{cfg.version}</span>
              {esBorrador(cfg) && <span style={badge(C.yellow)}>BORRADOR · sin modelo</span>}
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: C.text }}>{cfg.nombre}</div>
                <div style={{ fontSize: 11, color: C.muted }}>
                  Vigente desde {fecha(cfg.vigente_desde)}
                  {cfg.vigente_hasta ? ` · hasta ${fecha(cfg.vigente_hasta)}` : ''}
                  {' · '}{(cfg.criterios?.elementos ?? []).length} elementos
                </div>
              </div>
              <button style={boton(C.blue)} onClick={() => setExpandida(abierta ? null : cfg.id)}>
                {abierta ? 'Cerrar' : 'Ver detalle'}
              </button>
              {esAdmin && esBorrador(cfg) && (
                <button
                  style={boton(C.yellow, !guardando)}
                  disabled={guardando}
                  title="Genera el prompt a partir de los criterios y fija el modelo"
                  onClick={() => preparar(cfg.id)}
                >Preparar para análisis</button>
              )}
              {esAdmin && (
                <button
                  style={boton(vigente ? C.red : C.green, !guardando)}
                  disabled={guardando}
                  onClick={() => parchear(cfg.id, { activo: !vigente })}
                >{vigente ? 'Desactivar' : 'Activar'}</button>
              )}
            </div>

            {abierta && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
                {cfg.descripcion && (
                  <div style={{ fontSize: 13, color: C.sub, marginBottom: 12 }}>{cfg.descripcion}</div>
                )}

                <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, marginBottom: 6 }}>
                  ELEMENTOS A REVISAR
                </div>
                <EditorCriterios
                  elementos={elementos}
                  deshabilitado={!esAdmin}
                  onChange={e => setEditando(prev => ({ ...prev, [cfg.id]: e }))}
                />
                {esAdmin && editando[cfg.id] && (
                  <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    <button
                      style={boton(C.green, !guardando)}
                      disabled={guardando}
                      onClick={async () => {
                        await parchear(cfg.id, {
                          criterios: { elementos: editando[cfg.id].map(e => ({ ...e, clave: e.clave || normalizarClave(e.etiqueta) })) },
                        })
                        setEditando(prev => { const c = { ...prev }; delete c[cfg.id]; return c })
                      }}
                    >Guardar criterios</button>
                    <button
                      style={boton(C.muted)}
                      onClick={() => setEditando(prev => { const c = { ...prev }; delete c[cfg.id]; return c })}
                    >Descartar cambios</button>
                  </div>
                )}

                <ImagenesConfiguracion configuracionId={cfg.id} esAdmin={esAdmin} onCambio={cargar} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Pestaña de puntos de ronda (informativa)
// ════════════════════════════════════════════════════════════════════════════

type FilaPunto = {
  id: string
  nombre: string
  orden: number
  activo: boolean
  politica_foto: string | null
  ronda_base_id: string
  rondaNombre: string
  objetivoNombre: string
  referencias: ReferenciaPunto[]
}

function TabPuntos() {
  const [filas, setFilas] = useState<FilaPunto[]>([])
  const [cargando, setCargando] = useState(true)
  const [soloSinReferencia, setSoloSinReferencia] = useState(false)

  useEffect(() => {
    (async () => {
      setCargando(true)
      const [{ data: puntos }, { data: refs }] = await Promise.all([
        supabase
          .from('ronda_puntos')
          .select('id, nombre, orden, activo, politica_foto, ronda_base_id, rondas_base(nombre, objetivo_id, objetivos(nombre))')
          .eq('activo', true)
          .order('orden', { ascending: true }),
        supabase
          .from('ronda_punto_referencias')
          .select('id, ronda_punto_id, descripcion, activo, vigente_desde, vigente_hasta, created_at'),
      ])

      const porPunto = new Map<string, ReferenciaPunto[]>()
      for (const r of ((refs ?? []) as ReferenciaPunto[])) {
        const lista = porPunto.get(r.ronda_punto_id) ?? []
        lista.push(r)
        porPunto.set(r.ronda_punto_id, lista)
      }

      setFilas(((puntos ?? []) as any[]).map(p => ({
        id: p.id,
        nombre: p.nombre,
        orden: p.orden,
        activo: p.activo,
        politica_foto: p.politica_foto,
        ronda_base_id: p.ronda_base_id,
        rondaNombre: p.rondas_base?.nombre ?? '—',
        objetivoNombre: p.rondas_base?.objetivos?.nombre ?? '—',
        referencias: porPunto.get(p.id) ?? [],
      })))
      setCargando(false)
    })()
  }, [])

  const visibles = useMemo(
    () => soloSinReferencia ? filas.filter(f => !f.referencias.some(r => r.activo)) : filas,
    [filas, soloSinReferencia],
  )

  if (cargando) return <div style={{ color: C.muted, padding: 24 }}>Cargando puntos…</div>

  const conRef = filas.filter(f => f.referencias.some(r => r.activo)).length

  return (
    <div>
      <div style={card({ marginBottom: 16 })}>
        <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.6 }}>
          La foto de referencia de cada punto se carga <strong style={{ color: C.text }}>desde el punto de control</strong>,
          en la configuración de la ronda. Esta pantalla es un inventario para ver qué falta.
          <br />
          El análisis de rondas se dispara <strong style={{ color: C.yellow }}>sólo cuando el GPS quedó fuera del
          radio</strong> del punto. El GPS sigue siendo la evidencia geográfica; la foto aporta una señal más para
          que una persona decida. Sin referencia cargada, la comparación resulta NO DETERMINABLE.
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 14, flexWrap: 'wrap' }}>
          <div><span style={badge(C.green)}>{conRef}</span> <span style={{ fontSize: 12, color: C.sub }}>con referencia</span></div>
          <div><span style={badge(C.muted)}>{filas.length - conRef}</span> <span style={{ fontSize: 12, color: C.sub }}>sin referencia</span></div>
          <label style={{ fontSize: 12, color: C.sub, display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            <input type="checkbox" checked={soloSinReferencia} onChange={e => setSoloSinReferencia(e.target.checked)} />
            Ver sólo los que no tienen
          </label>
        </div>
      </div>

      {visibles.length === 0 && (
        <div style={{ ...card(), color: C.muted, fontSize: 13 }}>No hay puntos para mostrar.</div>
      )}

      {visibles.map(p => {
        const activa = p.referencias.find(r => r.activo)
        const historicas = p.referencias.filter(r => !r.activo).length
        return (
          <div key={p.id} style={card({ marginBottom: 10, padding: '12px 16px' })}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={badge(activa ? C.green : C.muted)}>{activa ? 'CON REFERENCIA' : 'SIN REFERENCIA'}</span>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>
                  {p.orden}. {p.nombre}
                </div>
                <div style={{ fontSize: 11, color: C.muted }}>
                  {p.objetivoNombre} · {p.rondaNombre}
                  {p.politica_foto ? ` · foto: ${p.politica_foto}` : ''}
                  {historicas > 0 ? ` · ${historicas} referencia(s) histórica(s)` : ''}
                </div>
              </div>
              {activa?.descripcion && (
                <div style={{ fontSize: 11, color: C.sub, flex: '1 1 200px' }}>{activa.descripcion}</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Panel
// ════════════════════════════════════════════════════════════════════════════

export default function ReferenciasIAPanel({ user }: { user?: { rol?: string } }) {
  const [tab, setTab] = useState<'uniforme' | 'libro_guardia' | 'puntos'>('uniforme')
  const esAdmin = user?.rol === 'admin'

  const tabs: Array<{ id: typeof tab, label: string }> = [
    { id: 'uniforme',      label: 'Uniforme' },
    { id: 'libro_guardia', label: 'Libro de guardia' },
    { id: 'puntos',        label: 'Puntos de ronda' },
  ]

  return (
    <div style={{ padding: '4px 0 40px' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontFamily: FONT, fontSize: 22, fontWeight: 900, color: C.text, margin: 0 }}>
          Referencias IA
        </h1>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
          Qué se espera revisar en cada evidencia y con qué fotos de referencia comparar.
          {!esAdmin && ' Sólo lectura: la edición es de Administración.'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button
            key={t.id}
            style={boton(tab === t.id ? C.yellow : C.muted, true)}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </div>

      {tab === 'puntos'
        ? <>
            <TabConfiguraciones key="punto_control" tipo="punto_control" esAdmin={esAdmin} />
            <div style={{ height: 8 }} />
            <TabPuntos />
          </>
        : <TabConfiguraciones key={tab} tipo={tab} esAdmin={esAdmin} />}
    </div>
  )
}
