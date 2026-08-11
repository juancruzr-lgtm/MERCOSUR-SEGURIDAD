'use client'
//
// Foto de referencia IA de un punto de control.
//
// Se monta dentro del editor del punto (components/rondas/RondaPuntosEditor).
// Escribe EXCLUSIVAMENTE en `ronda_punto_referencias` vía /api/ia/puntos/referencia.
//
// No toca politica_foto, foto_requerida, GPS, orden, obligación, ejecución ni
// alertas. El análisis IA de rondas todavía no está activado: esto sólo deja la
// referencia lista para cuando lo esté.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { brandColors, semanticColors } from '@/lib/brand-theme'

const C = {
  border: '#1e2d42',
  muted:  '#64748b',
  text:   '#e2e8f0',
  sub:    '#94a3b8',
  yellow: brandColors.yellow ?? '#f59e0b',
  green:  semanticColors.success ?? '#22c55e',
  red:    semanticColors.error ?? '#ef4444',
}

type Referencia = {
  id: string
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

export default function ReferenciaPuntoIA({
  rondaPuntoId, puedeEditar = true,
}: { rondaPuntoId: string, puedeEditar?: boolean }) {
  const [referencias, setReferencias] = useState<Referencia[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [descripcion, setDescripcion] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState('')
  const [verHistoria, setVerHistoria] = useState(false)
  const [ampliada, setAmpliada] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from('ronda_punto_referencias')
      .select('id, descripcion, activo, vigente_desde, vigente_hasta, created_at')
      .eq('ronda_punto_id', rondaPuntoId)
      .order('vigente_desde', { ascending: false })

    const filas = (data ?? []) as Referencia[]
    setReferencias(filas)
    if (filas.length === 0) { setUrls({}); return }

    try {
      const res = await fetch('/api/ia/referencias/url', {
        method: 'POST',
        headers: { ...(await headersAuth()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: 'punto', ids: filas.map(f => f.id) }),
      })
      const json = await res.json()
      if (res.ok) setUrls(json.urls ?? {})
    } catch { /* sin miniatura; no rompe el editor del punto */ }
  }, [rondaPuntoId])

  useEffect(() => { cargar() }, [cargar])

  const activa = referencias.find(r => r.activo) ?? null
  const historicas = referencias.filter(r => !r.activo)

  const subir = async (archivo: File) => {
    setSubiendo(true); setError('')
    try {
      const fd = new FormData()
      fd.append('ronda_punto_id', rondaPuntoId)
      fd.append('imagen', archivo)
      if (descripcion.trim()) fd.append('descripcion', descripcion.trim())
      // Si ya hay una activa, se le cierra la vigencia en vez de borrarla.
      if (activa) fd.append('reemplazar_activa', 'true')

      const res = await fetch('/api/ia/puntos/referencia', {
        method: 'POST', headers: await headersAuth(), body: fd,
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'No se pudo subir')
      setDescripcion('')
      await cargar()
    } catch (e: any) {
      setError(e.message || 'Error al subir')
    } finally {
      setSubiendo(false)
    }
  }

  const alternar = async (ref: Referencia) => {
    setError('')
    try {
      const res = await fetch('/api/ia/puntos/referencia', {
        method: 'PATCH',
        headers: { ...(await headersAuth()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ref.id, activo: !ref.activo }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      await cargar()
    } catch (e: any) {
      setError(e.message || 'Error')
    }
  }

  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 8, padding: 14,
      background: 'rgba(10,14,26,.5)', marginTop: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <strong style={{ fontSize: 13, color: C.text }}>Foto de referencia IA</strong>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
          background: C.yellow + '22', color: C.yellow,
        }}>SE USA SI EL GPS FALLA</span>
      </div>

      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>
        Metadata para el análisis futuro. No modifica la política de foto, el GPS,
        la obligación ni las alertas de este punto.
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {activa ? (
          <div style={{ width: 160 }}>
            {urls[activa.id]
              ? <img
                  src={urls[activa.id]} alt=""
                  style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 6, cursor: 'zoom-in', display: 'block' }}
                  onClick={() => setAmpliada(urls[activa.id])}
                />
              : <div style={{
                  height: 120, borderRadius: 6, border: `1px solid ${C.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 11,
                }}>sin vista previa</div>}
            <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>
              Vigente desde {fecha(activa.vigente_desde)}
            </div>
            {activa.descripcion && (
              <div style={{ fontSize: 11, color: C.sub, marginTop: 4 }}>{activa.descripcion}</div>
            )}
            {puedeEditar && (
              <button
                type="button"
                onClick={() => alternar(activa)}
                style={{
                  marginTop: 8, width: '100%', padding: '5px 8px', fontSize: 11, borderRadius: 6,
                  border: `1px solid ${C.red}55`, background: C.red + '22', color: C.red, cursor: 'pointer',
                }}
              >Desactivar</button>
            )}
          </div>
        ) : (
          <div style={{
            width: 160, height: 120, borderRadius: 6, border: `1px dashed ${C.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 12,
          }}>Sin referencia</div>
        )}

        {puedeEditar && (
          <div style={{ flex: '1 1 220px', minWidth: 200 }}>
            <label style={{ fontSize: 11, color: C.sub, display: 'block', marginBottom: 4 }}>
              Descripción (opcional)
            </label>
            <input
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              placeholder="Ej.: portón metálico, garita a la derecha"
              style={{
                width: '100%', padding: '7px 9px', borderRadius: 6, fontSize: 12,
                background: '#0a0e1a', border: `1px solid ${C.border}`, color: C.text, marginBottom: 10,
              }}
            />
            <label style={{
              display: 'inline-block', padding: '7px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700,
              border: `1px solid ${C.green}55`, background: C.green + '22', color: C.green,
              cursor: subiendo ? 'wait' : 'pointer',
            }}>
              {subiendo ? 'Subiendo…' : activa ? 'Reemplazar referencia' : 'Cargar referencia'}
              <input
                type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                disabled={subiendo}
                onChange={e => { const f = e.target.files?.[0]; if (f) subir(f); e.target.value = '' }}
              />
            </label>
            {activa && (
              <div style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
                Reemplazar no borra la anterior: se le cierra la vigencia y queda en el historial.
              </div>
            )}
          </div>
        )}
      </div>

      {historicas.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={() => setVerHistoria(v => !v)}
            style={{ background: 'none', border: 'none', color: C.sub, fontSize: 11, cursor: 'pointer', padding: 0 }}
          >
            {verHistoria ? '▾' : '▸'} {historicas.length} referencia(s) anterior(es)
          </button>
          {verHistoria && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {historicas.map(h => (
                <div key={h.id} style={{ width: 96, opacity: 0.6 }}>
                  {urls[h.id]
                    ? <img
                        src={urls[h.id]} alt=""
                        style={{ width: '100%', height: 72, objectFit: 'cover', borderRadius: 4, cursor: 'zoom-in', display: 'block' }}
                        onClick={() => setAmpliada(urls[h.id])}
                      />
                    : <div style={{ height: 72, border: `1px solid ${C.border}`, borderRadius: 4 }} />}
                  <div style={{ fontSize: 9, color: C.muted, marginTop: 4 }}>
                    {fecha(h.vigente_desde)} → {fecha(h.vigente_hasta)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <div style={{ color: C.red, fontSize: 12, marginTop: 10 }}>{error}</div>}

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
