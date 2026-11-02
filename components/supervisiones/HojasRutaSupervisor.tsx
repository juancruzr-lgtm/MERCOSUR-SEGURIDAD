'use client'
// Hojas de ruta de cierre de turno del supervisor, dentro del legajo operativo
// (#328). Solo lectura: fecha, guardia, estado del envío por destinatario y
// enlace al contenido completo. Es evidencia del trabajo, no una evaluación.
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { estadoDestinatario, type EstadoDestinatarioFila } from '@/lib/hoja-ruta-estado'

interface HojaFila { id: string; fecha: string; inicio: string; fin: string; generada_at: string; envio_bloqueado: string | null }

const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' })

export default function HojasRutaSupervisor({ supervisorId, desde, hasta }: { supervisorId: string; desde: string; hasta: string }) {
  const [hojas, setHojas] = useState<HojaFila[]>([])
  const [estados, setEstados] = useState<EstadoDestinatarioFila[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    void (async () => {
      const r = await supabase.from('hojas_ruta').select('id, fecha, inicio, fin, generada_at, envio_bloqueado')
        .eq('supervisor_id', supervisorId).gte('fecha', desde).lte('fecha', hasta).order('fecha', { ascending: false })
      if (!vivo) return
      if (r.error) { setError(r.error.message); return }
      const filas = (r.data ?? []) as HojaFila[]
      setHojas(filas)
      if (filas.length) {
        const e = await supabase.from('hoja_ruta_destinatario_estado').select('*').in('hoja_id', filas.map(h => h.id))
        if (vivo && !e.error) setEstados((e.data ?? []) as EstadoDestinatarioFila[])
      }
    })()
    return () => { vivo = false }
  }, [supervisorId, desde, hasta])

  return (
    <div style={{ background: '#0b1220', border: '1px solid #1e293b', borderRadius: 12, padding: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Hojas de ruta (cierre de turno)</div>
      {error && <div style={{ fontSize: 12, color: '#fca5a5' }}>{error}</div>}
      {!error && hojas.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>Sin hojas de ruta en el período.</div>}
      {hojas.map(h => (
        <div key={h.id} style={{ fontSize: 13, padding: '6px 0', borderTop: '1px solid #1e293b' }}>
          <a href={`/hoja-ruta/${h.id}`} style={{ color: '#7dd3fc' }}>{h.fecha.split('-').reverse().join('/')} · {hora(h.inicio)}–{hora(h.fin)}</a>
          {h.envio_bloqueado && <span style={{ marginLeft: 10, fontSize: 12, color: '#f59e0b' }}>{estadoDestinatario(null, h.envio_bloqueado).etiqueta}</span>}
          {estados.filter(e => e.hoja_id === h.id).map(e => {
            const x = estadoDestinatario(e)
            return <span key={e.destinatario_id} style={{ marginLeft: 10, fontSize: 12, color: x.color }}>{x.etiqueta}</span>
          })}
        </div>
      ))}
    </div>
  )
}
