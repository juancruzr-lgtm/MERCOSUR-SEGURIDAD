'use client'
// Hoja de ruta de cierre de turno. Solo lectura, sin formularios: supervisor y
// turno, objetivos recorridos, novedades textuales completas, estado del envío
// a cada destinatario, historial de intentos y el recorrido GPS. La base
// decide quién la ve (hoja_ruta_puede_ver_actual: lista del legajo #328 o
// destinatario activo definido por Gerencia).
import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { PuntoRecorrido } from '@/lib/legajo-supervisor'
import { estadoDestinatario, type EstadoDestinatarioFila } from '@/lib/hoja-ruta-estado'

const MapaRecorridoGuardia = dynamic(() => import('@/components/supervisiones/MapaRecorridoGuardia'), { ssr: false })

interface Hoja {
  id: string; texto: string; generada_at: string; mensaje_longitud: number; envio_bloqueado: string | null
}
interface Intento { id: string; destinatario_id: string; intento: number; modo: string; estado: string; estado_meta: string | null; error: string | null; created_at: string }
interface Destinatario { usuario_id: string; cargo: string; activo: boolean }

export default function HojaRutaPage() {
  const { id } = useParams<{ id: string }>()
  const [hoja, setHoja] = useState<Hoja | null>(null)
  const [estados, setEstados] = useState<EstadoDestinatarioFila[]>([])
  const [intentos, setIntentos] = useState<Intento[]>([])
  const [destinatarios, setDestinatarios] = useState<Destinatario[]>([])
  const [personas, setPersonas] = useState<Map<string, string>>(new Map())
  const [puntos, setPuntos] = useState<PuntoRecorrido[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      const { data: s } = await supabase.auth.getSession()
      if (!s.session) { window.location.href = '/dashboard'; return }
      const { data, error: e } = await supabase.from('hojas_ruta')
        .select('id, texto, generada_at, mensaje_longitud, envio_bloqueado').eq('id', id).maybeSingle()
      if (e) { setError(e.message); return }
      if (!data) { setError('No tenés acceso a esta hoja de ruta o no existe.'); return }
      setHoja(data as Hoja)
      const [est, ints, dest, rec] = await Promise.all([
        supabase.from('hoja_ruta_destinatario_estado').select('*').eq('hoja_id', id),
        supabase.from('hoja_ruta_envios_estado').select('id, destinatario_id, intento, modo, estado, estado_meta, error, created_at').eq('hoja_id', id).order('created_at'),
        supabase.from('hoja_ruta_destinatarios').select('usuario_id, cargo, activo').eq('activo', true),
        supabase.rpc('hoja_ruta_recorrido', { p_hoja_id: id }),
      ])
      setEstados((est.data ?? []) as EstadoDestinatarioFila[])
      setIntentos((ints.data ?? []) as Intento[])
      const ds = (dest.data ?? []) as Destinatario[]
      setDestinatarios(ds)
      const ids = Array.from(new Set([...ds.map(d => d.usuario_id), ...((ints.data ?? []) as Intento[]).map(i => i.destinatario_id)]))
      if (ids.length) {
        const { data: us } = await supabase.from('usuarios').select('id, nombre, apellido').in('id', ids)
        setPersonas(new Map(((us ?? []) as any[]).map(u => [u.id, [u.nombre, u.apellido].filter(Boolean).join(' ')])))
      }
      if (!rec.error) {
        setPuntos(((rec.data ?? []) as any[]).map(p => ({
          ts: p.ts, lat: Number(p.lat), lng: Number(p.lng), precision_m: p.precision_m,
          tipo_punto: p.tipo_punto, estado_movimiento: p.estado_movimiento, supervision_id: p.supervision_id,
        })))
      }
    })()
  }, [id])

  // Destinatarios a mostrar: los activos y cualquiera que haya tenido intentos.
  const filas = Array.from(new Set([...destinatarios.map(d => d.usuario_id), ...estados.map(e => e.destinatario_id)]))
  const caja = { background: '#111827', border: '1px solid #1e2d42', borderRadius: 12, padding: 16, marginBottom: 12 } as const
  return (
    <div style={{ minHeight: '100vh', background: '#0a0e1a', color: '#e2e8f0', fontFamily: 'sans-serif', padding: 16 }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        {error && <div style={{ ...caja, color: '#f87171' }}>{error}</div>}
        {hoja && (
          <>
            <pre style={{ ...caja, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5 }}>{hoja.texto}</pre>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
              Generada el {new Date(hoja.generada_at).toLocaleString('es-AR')}. Es la versión definitiva; no se modifica.
            </div>
            {hoja.envio_bloqueado === 'excede_longitud' && (
              <div style={{ ...caja, borderColor: '#b45309', color: '#fbbf24', fontSize: 13 }}>
                No se envió por WhatsApp: el mensaje tiene {hoja.mensaje_longitud} caracteres y la plantilla admite 1024.
                No se recortó ninguna novedad; la hoja completa está acá.
              </div>
            )}
            <div style={caja}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Envío por WhatsApp</div>
              {filas.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>Sin destinatarios configurados.</div>}
              {filas.map(did => {
                const f = estados.find(e => e.destinatario_id === did) ?? null
                const e = estadoDestinatario(f, hoja.envio_bloqueado)
                const cargo = destinatarios.find(d => d.usuario_id === did)?.cargo
                return (
                  <div key={did} style={{ fontSize: 13, marginBottom: 6 }}>
                    <strong>{personas.get(did) ?? 'Destinatario'}</strong>{cargo ? ` (${cargo})` : ''}: <span style={{ color: e.color }}>{e.etiqueta}</span>
                    {f && <span style={{ color: '#94a3b8' }}> · {f.intentos} intento(s)</span>}
                    {f?.ultimo_error && <div style={{ fontSize: 12, color: '#f87171' }}>{f.ultimo_error}</div>}
                  </div>
                )
              })}
              {intentos.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 12, color: '#94a3b8', cursor: 'pointer' }}>Historial de intentos</summary>
                  {intentos.map(i => (
                    <div key={i.id} style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                      {new Date(i.created_at).toLocaleString('es-AR')} · {personas.get(i.destinatario_id) ?? i.destinatario_id} · intento {i.intento} · {i.modo} · {i.estado}
                      {i.estado_meta ? ` · Meta: ${i.estado_meta}` : ''}{i.error ? ` · ${i.error}` : ''}
                    </div>
                  ))}
                </details>
              )}
            </div>
            {puntos && puntos.length > 0 && (
              <div style={caja}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Recorrido GPS registrado</div>
                <MapaRecorridoGuardia puntos={puntos} supervisiones={[]} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
