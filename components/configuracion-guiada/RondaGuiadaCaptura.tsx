'use client'

/**
 * Para el vigilador: si su jefe pidió configurar la ronda del objetivo donde
 * tiene turno, le aparece este recuadro para marcar los dos extremos del
 * puesto. Si no hay pedido (o la migración no está), no muestra nada.
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { textoProblema, validarPunto, type PuntoGps, type ProblemaPunto } from '@/lib/configuracion-guiada'

interface Pendiente { id: string; objetivo: string; centro: { lat: number; lng: number } | null; punto1: { lat: number; lng: number } | null }

const ERRORES_SERVIDOR: Record<string, ProblemaPunto['tipo']> = { sin_gps: 'sin_gps', impreciso: 'impreciso', lejos_del_objetivo: 'lejos_del_objetivo', muy_cerca: 'muy_cerca', muy_lejos: 'muy_lejos' }

/** Lee el GPS unos segundos y se queda con la lectura más precisa. */
function leerUbicacion(segundos = 8): Promise<PuntoGps | null> {
  return new Promise(resolve => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
    let mejor: PuntoGps | null = null
    const id = navigator.geolocation.watchPosition(
      pos => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, precision: pos.coords.accuracy }
        if (!mejor || p.precision < mejor.precision) mejor = p
        if (p.precision <= 10) { navigator.geolocation.clearWatch(id); resolve(p) }
      },
      () => { navigator.geolocation.clearWatch(id); resolve(mejor) },
      { enableHighAccuracy: true, maximumAge: 0, timeout: segundos * 1000 },
    )
    setTimeout(() => { navigator.geolocation.clearWatch(id); resolve(mejor) }, segundos * 1000)
  })
}

export default function RondaGuiadaCaptura() {
  const [pend, setPend] = useState<Pendiente | null>(null)
  const [punto1, setPunto1] = useState<PuntoGps | null>(null)
  const [estado, setEstado] = useState<'idle' | 'leyendo' | 'listo'>('idle')
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('ronda_guiada_mi_pendiente')
    if (error || !Array.isArray(data) || data.length === 0) { setPend(null); return }
    const p = data[0] as Pendiente
    setPend(p)
    if (p.punto1) setPunto1({ ...p.punto1, precision: 0 })
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  if (!pend || estado === 'listo' && !aviso) return estado === 'listo' ? <Caja><b>¡Gracias!</b> La ronda quedó cargada. Tu supervisor la revisa y empieza a regir en 24 horas.</Caja> : null

  const numero = punto1 ? 2 : 1
  const marcar = async () => {
    setEstado('leyendo'); setAviso(null)
    const p = await leerUbicacion()
    const problema = validarPunto(p, pend.centro, numero === 2 ? punto1 : null)
    if (problema) { setAviso(textoProblema(problema)); setEstado('idle'); return }
    const { error } = await supabase.rpc('ronda_guiada_marcar_punto', { p_id: pend.id, p_numero: numero, p_lat: p!.lat, p_lng: p!.lng, p_precision: Math.round(p!.precision) })
    if (error) {
      const clave = Object.keys(ERRORES_SERVIDOR).find(k => error.message.includes(k))
      setAviso(clave ? textoProblema({ tipo: ERRORES_SERVIDOR[clave], precision: Math.round(p!.precision), distancia: 0 } as ProblemaPunto) : error.message)
      setEstado('idle'); return
    }
    if (numero === 1) { setPunto1(p); setEstado('idle') } else { setEstado('listo'); setAviso(null) }
  }

  return (
    <Caja>
      <div style={{ fontSize: 13, color: '#93c5fd', fontWeight: 700, marginBottom: 4 }}>CONFIGURAR LA RONDA · {pend.objetivo}</div>
      <div style={{ fontSize: 15, marginBottom: 10 }}>
        {numero === 1
          ? <>Paso 1 de 2: <b>dirigite a un extremo del puesto</b> y tocá el botón.</>
          : <>Paso 2 de 2: <b>ahora caminá hasta el otro extremo del puesto</b> y tocá el botón.</>}
      </div>
      <button onClick={marcar} disabled={estado === 'leyendo'} style={{ width: '100%', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 10, padding: '14px', fontSize: 16, fontWeight: 700 }}>
        {estado === 'leyendo' ? 'Leyendo ubicación…' : `Marcar punto ${numero}`}
      </button>
      {aviso && <div style={{ marginTop: 8, color: '#fbbf24', fontSize: 14 }}>{aviso}</div>}
      <div style={{ marginTop: 8, fontSize: 12, color: '#94a3b8' }}>Con estos dos puntos se arma la ronda de recorrida del puesto. La primera semana es de prueba.</div>
    </Caja>
  )
}

function Caja({ children }: { children: React.ReactNode }) {
  return <div style={{ background: '#0b1a33', border: '1px solid #1d4ed8', borderRadius: 12, padding: 14, margin: '10px 0', color: '#e2e8f0' }}>{children}</div>
}
