'use client'

/**
 * Para el vigilador: si en el objetivo donde tiene turno hay que crear la
 * ronda, le aparece este recuadro (se revisa al abrir la app y cada 2 minutos,
 * así también le llega si ya está trabajando).
 *
 *  Paso 1: "Dirigite a un extremo del puesto… MARCAR PUNTO 1".
 *  Paso 2: "Ahora dirigite al otro extremo… MARCAR PUNTO 2".
 *  Confirmación: mapa esquemático, distancia, frecuencia, RONDA ACTIVA.
 *
 * Sin señal: el punto se guarda en el celular con su hora real y se envía
 * solo cuando vuelve la conexión (la ronda se activa recién al llegar).
 * Si no puede completarlo, informa el motivo con un toque y pasa a
 * supervisión: no se activa ninguna ronda.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  distanciaMetros, MOTIVOS_PROBLEMA, RONDA_GUIADA, textoFrecuencia, textoProblema, validarPunto,
  type MotivoProblema, type ObjetivoArea, type PuntoGps, type ProblemaPunto,
} from '@/lib/configuracion-guiada'

interface Pendiente { objetivo_id: string; objetivo: string; area: ObjetivoArea; frecuencia_minutos: number; punto1: PuntoGps | null }
interface PuntoEnCola { objetivoId: string; numero: 1 | 2; lat: number; lng: number; precision: number; capturadoAt: string }
interface Activa { objetivo: string; distancia: number; frecuencia: number; p1: PuntoGps; p2: PuntoGps; hora: string }

const COLA = 'ronda_guiada_cola_v1'
const leerCola = (): PuntoEnCola[] => { try { return JSON.parse(localStorage.getItem(COLA) ?? '[]') } catch { return [] } }
const guardarCola = (c: PuntoEnCola[]) => { try { localStorage.setItem(COLA, JSON.stringify(c)) } catch { /* sin almacenamiento */ } }

const ERRORES: Record<string, ProblemaPunto['tipo']> = { sin_gps: 'sin_gps', impreciso: 'impreciso', fuera_del_objetivo: 'fuera_del_objetivo', indistinguible: 'indistinguible' }
const esErrorDeRed = (m: string) => /fetch|network|Failed to|conex|timeout|offline/i.test(m) || (typeof navigator !== 'undefined' && navigator.onLine === false)

export default function RondaGuiadaCaptura() {
  const [pend, setPend] = useState<Pendiente | null>(null)
  const [punto1, setPunto1] = useState<PuntoGps | null>(null)
  const [gps, setGps] = useState<PuntoGps | null>(null)
  const [estado, setEstado] = useState<'idle' | 'marcando' | 'problema' | 'listo' | 'en_cola' | 'derivado'>('idle')
  const [aviso, setAviso] = useState<string | null>(null)
  const [fallas, setFallas] = useState(0)
  const [activa, setActiva] = useState<Activa | null>(null)
  const watch = useRef<number | null>(null)

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('ronda_guiada_mi_pendiente')
    if (error || !Array.isArray(data) || data.length === 0) { if (!error) setPend(null); return }
    const p = data[0] as Pendiente
    setPend(prev => prev?.objetivo_id === p.objetivo_id ? prev : p)
    if (p.punto1) setPunto1(p.punto1)
  }, [])

  // Envía lo que quedó guardado sin señal.
  const vaciarCola = useCallback(async () => {
    const cola = leerCola()
    if (cola.length === 0) return
    const resto: PuntoEnCola[] = []
    for (const x of cola) {
      const { data, error } = await supabase.rpc('ronda_guiada_marcar_punto', { p_objetivo_id: x.objetivoId, p_numero: x.numero, p_lat: x.lat, p_lng: x.lng, p_precision: Math.round(x.precision), p_capturado_at: x.capturadoAt })
      if (error && esErrorDeRed(error.message)) { resto.push(x); continue }
      if (!error && x.numero === 2 && data?.ok) setEstado('listo')
    }
    guardarCola(resto)
    if (resto.length === 0) void cargar()
  }, [cargar])

  useEffect(() => {
    void vaciarCola().then(cargar)
    const t = setInterval(() => { void vaciarCola(); void cargar() }, 120_000)
    const online = () => { void vaciarCola() }
    window.addEventListener('online', online)
    return () => { clearInterval(t); window.removeEventListener('online', online) }
  }, [cargar, vaciarCola])

  // GPS en vivo mientras el recuadro está abierto.
  useEffect(() => {
    if (!pend || estado === 'listo' || typeof navigator === 'undefined' || !navigator.geolocation) return
    watch.current = navigator.geolocation.watchPosition(
      pos => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, precision: pos.coords.accuracy }),
      () => setGps(null),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    )
    return () => { if (watch.current != null) navigator.geolocation.clearWatch(watch.current) }
  }, [pend, estado])

  if (estado === 'listo' && activa) return <Confirmacion a={activa} />
  if (estado === 'listo') return <Caja><b>¡Listo!</b> La ronda quedó creada y activa.</Caja>
  if (estado === 'derivado') return <Caja><b>Avisamos a tu supervisor.</b> No tenés que hacer nada más con la ronda.</Caja>
  if (!pend) return estado === 'en_cola' ? <Caja>Los puntos quedaron guardados en el celular. Se envían solos cuando vuelva la señal.</Caja> : null

  const numero: 1 | 2 = punto1 ? 2 : 1
  const problemaVivo = gps ? validarPunto(gps, pend.area, numero === 2 ? punto1 : null) : null
  const listo = gps != null && gps.precision <= RONDA_GUIADA.precisionMaximaMetros

  const marcar = async () => {
    if (!gps) { setAviso(textoProblema({ tipo: 'sin_gps' })); return }
    const problema = validarPunto(gps, pend.area, numero === 2 ? punto1 : null)
    if (problema) { setAviso(textoProblema(problema)); setFallas(f => f + 1); return }
    setEstado('marcando'); setAviso(null)
    // Si el punto 1 quedó guardado sin señal, que llegue antes que el 2.
    if (numero === 2 && leerCola().length > 0) await vaciarCola()
    const x: PuntoEnCola = { objetivoId: pend.objetivo_id, numero, lat: gps.lat, lng: gps.lng, precision: gps.precision, capturadoAt: new Date().toISOString() }
    const { data, error } = await supabase.rpc('ronda_guiada_marcar_punto', { p_objetivo_id: x.objetivoId, p_numero: x.numero, p_lat: x.lat, p_lng: x.lng, p_precision: Math.round(x.precision), p_capturado_at: x.capturadoAt })
    if (error && esErrorDeRed(error.message)) {
      guardarCola([...leerCola(), x])
      if (numero === 1) { setPunto1(gps); setEstado('idle'); setAviso('Sin señal: el punto 1 quedó guardado en el celular. Seguí con el punto 2.') }
      else { setEstado('en_cola'); setPend(null) }
      return
    }
    if (error) {
      const clave = Object.keys(ERRORES).find(k => error.message.includes(k))
      const m = /indistinguible: (\d+) m, hacen falta más de (\d+) m/.exec(error.message)
      setAviso(clave ? textoProblema({ tipo: ERRORES[clave], precision: Math.round(gps.precision), distancia: m ? Number(m[1]) : 0, minimo: m ? Number(m[2]) : 0 } as ProblemaPunto) : error.message)
      setFallas(f => f + 1); setEstado('idle'); return
    }
    if (numero === 1) { setPunto1(gps); setEstado('idle'); setFallas(0); return }
    setActiva({ objetivo: pend.objetivo, distancia: data?.distancia ?? Math.round(distanciaMetros(punto1!, gps)), frecuencia: data?.frecuencia_minutos ?? pend.frecuencia_minutos, p1: punto1!, p2: gps, hora: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }) })
    setEstado('listo')
  }

  const informar = async (motivo: MotivoProblema) => {
    const { error } = await supabase.rpc('ronda_guiada_reportar_problema', { p_objetivo_id: pend.objetivo_id, p_motivo: motivo })
    if (error) { setAviso(esErrorDeRed(error.message) ? 'Sin señal: probá de nuevo en un rato.' : error.message); return }
    setEstado('derivado')
  }

  if (estado === 'problema') {
    return (
      <Caja>
        <div style={eyebrow}>NO PUEDO CREAR LA RONDA · {pend.objetivo}</div>
        <div style={{ fontSize: 15, margin: '6px 0 10px' }}>¿Qué pasa?</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {(Object.keys(MOTIVOS_PROBLEMA) as MotivoProblema[]).map(m => <button key={m} style={secundario} onClick={() => informar(m)}>{MOTIVOS_PROBLEMA[m]}</button>)}
          <button style={{ ...secundario, border: 'none', color: '#94a3b8' }} onClick={() => setEstado('idle')}>Volver</button>
        </div>
      </Caja>
    )
  }

  return (
    <Caja>
      <div style={eyebrow}>CREAR LA RONDA · {pend.objetivo}</div>
      <div style={{ display: 'flex', gap: 6, margin: '6px 0 10px' }}><span style={barra(true)} /><span style={barra(numero === 2)} /></div>
      {numero === 2 && <div style={{ fontSize: 13, color: '#4ade80', marginBottom: 4 }}>✓ Punto 1 marcado</div>}
      <div style={{ fontSize: 16, marginBottom: 10, lineHeight: 1.4 }}>
        {numero === 1
          ? <>Paso 1 de 2: <b>dirigite a un extremo del puesto que debas controlar</b> y presioná MARCAR PUNTO 1.</>
          : <>Paso 2 de 2: <b>ahora dirigite al otro extremo del puesto</b> y presioná MARCAR PUNTO 2.</>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontFamily: 'ui-monospace, monospace', color: '#94a3b8', marginBottom: 4 }}>
        <span>GPS</span>
        <span style={{ color: !gps ? '#f87171' : listo ? '#4ade80' : '#fbbf24' }}>{!gps ? 'buscando señal…' : `±${Math.round(gps.precision)} m${listo ? ' · listo' : ' · esperá'}`}</span>
      </div>
      {numero === 2 && gps && punto1 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontFamily: 'ui-monospace, monospace', color: '#94a3b8', marginBottom: 8 }}><span>Distancia al punto 1</span><span>{Math.round(distanciaMetros(punto1, gps))} m</span></div>}
      <button onClick={marcar} disabled={estado === 'marcando' || !listo} style={{ ...primario, opacity: listo ? 1 : 0.5 }}>
        {estado === 'marcando' ? 'Guardando…' : `MARCAR PUNTO ${numero}`}
      </button>
      {aviso && <div style={{ marginTop: 8, color: '#fbbf24', fontSize: 14 }}>{aviso}</div>}
      {!aviso && problemaVivo && problemaVivo.tipo !== 'impreciso' && <div style={{ marginTop: 8, color: '#94a3b8', fontSize: 13 }}>{textoProblema(problemaVivo)}</div>}
      <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
        {numero === 2 && <button style={secundario} onClick={() => { setPunto1(null); setAviso(null) }}>Volver a marcar el punto 1</button>}
        <button style={secundario} onClick={() => setEstado('problema')}>{fallas >= RONDA_GUIADA.intentosAntesDeDerivar ? 'Pasárselo al supervisor' : 'No puedo llegar a un extremo'}</button>
      </div>
    </Caja>
  )
}

function Confirmacion({ a }: { a: Activa }) {
  // Mapa esquemático: los dos puntos en proporción, sin servicio de mapas externo.
  const dx = (a.p2.lng - a.p1.lng) * Math.cos((a.p1.lat * Math.PI) / 180), dy = a.p2.lat - a.p1.lat
  const ang = Math.atan2(-dy, dx)
  const x1 = 160 - Math.cos(ang) * 100, y1 = 90 - Math.sin(ang) * 60, x2 = 160 + Math.cos(ang) * 100, y2 = 90 + Math.sin(ang) * 60
  return (
    <Caja>
      <div style={eyebrow}>RONDA CREADA · {a.objetivo}</div>
      <svg viewBox="0 0 320 180" style={{ width: '100%', borderRadius: 10, background: '#16251c', margin: '8px 0' }} role="img" aria-label="Los dos puntos de la ronda">
        <rect x="20" y="15" width="280" height="150" rx="8" fill="#1d3326" stroke="#4b6b55" strokeDasharray="6 5" />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#3b82f6" strokeWidth="3" strokeDasharray="8 6" />
        <circle cx={x1} cy={y1} r="9" fill="#2563eb" stroke="#fff" strokeWidth="2" /><text x={x1 + 12} y={y1 - 8} fill="#bfdbfe" fontSize="14" fontWeight="700">1</text>
        <circle cx={x2} cy={y2} r="9" fill="#2563eb" stroke="#fff" strokeWidth="2" /><text x={x2 + 12} y={y2 - 8} fill="#bfdbfe" fontSize="14" fontWeight="700">2</text>
        <text x="160" y="172" textAnchor="middle" fill="#86efac" fontSize="12">{a.distancia} m</text>
      </svg>
      <div style={{ background: '#0f3d2a', border: '1px solid #1f7a52', color: '#6ee7b7', fontWeight: 800, textAlign: 'center', padding: 10, borderRadius: 10, letterSpacing: '.04em' }}>RONDA ACTIVA</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 14, marginTop: 10 }}>
        <span style={{ color: '#94a3b8' }}>Distancia</span><span>{a.distancia} m entre puntos</span>
        <span style={{ color: '#94a3b8' }}>Frecuencia</span><span>{textoFrecuencia(a.frecuencia)}</span>
        <span style={{ color: '#94a3b8' }}>Activa desde</span><span>{a.hora}</span>
        <span style={{ color: '#94a3b8' }}>Precisión</span><span>±{Math.round(a.p1.precision)} m y ±{Math.round(a.p2.precision)} m</span>
      </div>
      <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 8 }}>Gracias. La primera ronda se exige en la próxima ventana del turno. Tu supervisor puede ajustar los puntos o la frecuencia.</div>
    </Caja>
  )
}

const eyebrow = { fontSize: 12, color: '#93c5fd', fontWeight: 700, letterSpacing: '.04em' } as const
const primario = { width: '100%', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 12, padding: 15, fontSize: 16, fontWeight: 700 } as const
const secundario = { width: '100%', background: 'transparent', color: '#e2e8f0', border: '1px solid #2f3e52', borderRadius: 12, padding: 11, fontSize: 14 } as const
const barra = (on: boolean) => ({ flex: 1, height: 4, borderRadius: 4, background: on ? '#3b82f6' : '#2f3e52' })

function Caja({ children }: { children: React.ReactNode }) {
  return <div style={{ background: '#0b1a33', border: '1px solid #1d4ed8', borderRadius: 12, padding: 14, margin: '10px 0', color: '#e2e8f0' }}>{children}</div>
}
