'use client'

/**
 * components/guardia/PedidoCredencial.tsx
 *
 * Pedido ÚNICO de la credencial al vigilador, al entrar a la app (el padre lo
 * monta sólo fuera de un fichaje y después del teléfono). Tres respuestas:
 *   - «Tengo credencial»: foto del frente y del dorso + vencimiento → Documentación.
 *   - «Está en trámite» (qué presentó y cuándo, opcional).
 *   - «No tengo» (por qué, obligatorio).
 * Una vez respondido no se vuelve a pedir. «Ahora no la tengo encima» lo pospone
 * hasta la próxima vez que entre. Si el pedido está cerrado o hay un error, no
 * se muestra nada: nunca bloquea el trabajo.
 */

import { useEffect, useState } from 'react'
import { subirDocumento } from '@/lib/documentacion-datos'
import { TIPO_CREDENCIAL, cargarMiEstado, declarar, posponer, pospuesto, validarPedido } from '@/lib/credencial-pedido'
import { resumenLectura } from '@/lib/credencial-lectura'
import type { LecturaCredencial } from '@/lib/credencial-lectura'
import { leerYRecortar } from '@/lib/credencial-lectura-cliente'

type Paso = 'elegir' | 'tiene' | 'en_tramite' | 'no_tiene' | 'listo'

const fondo: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }
const caja: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e2d42', borderRadius: 14, padding: 20, maxWidth: 400, width: '100%', color: '#e2e8f0', maxHeight: '92vh', overflowY: 'auto', boxSizing: 'border-box' }
const opcion = (color: string): React.CSSProperties => ({ display: 'block', width: '100%', textAlign: 'left', background: '#111827', border: `1px solid ${color}`, borderRadius: 10, padding: '13px 14px', color: '#e2e8f0', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 8 })
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#0a0e1a', border: '1px solid #1e2d42', color: '#e2e8f0', borderRadius: 8, padding: '10px 12px', fontSize: 15 }
const primario = (activo: boolean): React.CSSProperties => ({ flex: 1, background: activo ? '#16a34a' : '#334155', color: '#fff', border: 'none', borderRadius: 8, padding: '11px', fontSize: 15, fontWeight: 700, cursor: activo ? 'pointer' : 'default' })
const secundario: React.CSSProperties = { background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: 8, padding: '11px 14px', fontSize: 14, cursor: 'pointer' }
const hoyAr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())

function Foto({ cara, archivo, leyendo, onElegir }: { cara: string; archivo: File | null; leyendo: boolean; onElegir: (f: File | null) => void }) {
  const [vista, setVista] = useState<string | null>(null)
  useEffect(() => {
    if (!archivo) { setVista(null); return }
    const u = URL.createObjectURL(archivo); setVista(u)
    return () => URL.revokeObjectURL(u)
  }, [archivo])
  return (
    <label style={{ display: 'block', flex: 1, minWidth: 0, border: `1px dashed ${archivo ? '#16a34a' : '#334155'}`, borderRadius: 10, padding: 8, textAlign: 'center', cursor: 'pointer' }}>
      {vista
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={vista} alt={cara} style={{ width: '100%', height: 90, objectFit: 'contain', borderRadius: 6, opacity: leyendo ? 0.4 : 1 }} />
        : <div style={{ height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>📷</div>}
      <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 6, color: leyendo ? '#93c5fd' : archivo ? '#86efac' : '#cbd5e1' }}>{leyendo ? 'Leyendo…' : archivo ? `✓ ${cara}` : `Foto del ${cara.toLowerCase()}`}</div>
      <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => { onElegir(e.target.files?.[0] ?? null); e.target.value = '' }} />
    </label>
  )
}

export default function PedidoCredencial({ empleadoId }: { empleadoId: string }) {
  const [abierto, setAbierto] = useState(false)
  const [paso, setPaso] = useState<Paso>('elegir')
  const [frente, setFrente] = useState<File | null>(null)
  const [dorso, setDorso] = useState<File | null>(null)
  const [vence, setVence] = useState('')
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Si las fotos ya subieron y falló sólo la respuesta, no se vuelven a subir.
  const [subido, setSubido] = useState(false)
  const [rechazo, setRechazo] = useState<string | null>(null)
  const [confirmaVencida, setConfirmaVencida] = useState(false)
  // Lectura con IA del frente: recorta la tarjeta y completa el vencimiento (se puede cambiar).
  const [lectura, setLectura] = useState<LecturaCredencial | null>(null)
  const [leyendo, setLeyendo] = useState<'Frente' | 'Dorso' | null>(null)
  const [venceDeIA, setVenceDeIA] = useState(false)

  useEffect(() => {
    let vivo = true
    if (pospuesto()) return
    void cargarMiEstado().then(e => { if (vivo && e.pedir) { setRechazo(e.rechazo ?? null); setAbierto(true) } }).catch(() => {})
    return () => { vivo = false }
  }, [])

  if (!abierto) return null

  const volver = () => { setPaso('elegir'); setError(null); setTexto('') }

  const elegirFoto = async (cara: 'Frente' | 'Dorso', original: File | null) => {
    const poner = cara === 'Frente' ? setFrente : setDorso
    if (!original) { poner(null); return }
    poner(original); setLeyendo(cara)
    const r = await leerYRecortar(original)
    poner(r.foto); setLeyendo(null)
    if (cara !== 'Frente') return
    setLectura(r.lectura)
    if (r.lectura?.vencimiento && (!vence || venceDeIA)) { setVence(r.lectura.vencimiento); setVenceDeIA(true); setConfirmaVencida(false) }
  }

  const enviarFotos = async () => {
    const inval = validarPedido({ frente, dorso, venceEl: vence, hoy: hoyAr() })
    if (inval) { setError(inval); return }
    // La fecha de hoy o una pasada casi siempre es la que quedó sin cambiar: se pide confirmarla una vez.
    if (vence <= hoyAr() && !confirmaVencida) {
      setConfirmaVencida(true)
      setError('La fecha que pusiste es hoy o ya pasó: ¿tu credencial está vencida? Si no, corregí la fecha. Si es correcta, tocá «Enviar fotos» otra vez.')
      return
    }
    setError(null)
    if (!subido) {
      const r = await subirDocumento({ empleadoId, tipo: TIPO_CREDENCIAL, fechaEmision: null, venceEl: vence, detalle: resumenLectura(lectura), archivos: [frente!, dorso!], onProgreso: setOcupado })
      if (r.error) { setOcupado(null); setError(r.error); return }
      setSubido(true)
    }
    setOcupado('Guardando…')
    const e = await declarar('tiene')
    setOcupado(null)
    if (e) { setError(e); return }
    setPaso('listo')
  }

  const enviarDeclaracion = async (respuesta: 'en_tramite' | 'no_tiene') => {
    if (respuesta === 'no_tiene' && texto.trim().length < 3) { setError('Contanos por qué no tenés credencial.'); return }
    setOcupado('Guardando…'); setError(null)
    const e = await declarar(respuesta, texto)
    setOcupado(null)
    if (e) { setError(e); return }
    setPaso('listo')
  }

  return (
    <div style={fondo} role="dialog" aria-modal="true" aria-labelledby="pedido-credencial-titulo">
      <div style={caja}>
        <div id="pedido-credencial-titulo" style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>Tu credencial de vigilador</div>

        {paso === 'elegir' && (
          <>
            <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 14, lineHeight: 1.45 }}>
              Administración necesita tener tu credencial en el legajo. Te lo pedimos una sola vez.
            </div>
            {rechazo && <div style={{ fontSize: 13.5, color: '#fbbf24', marginBottom: 12 }}>La foto anterior no se pudo aceptar: {rechazo}. Volvé a sacarla.</div>}
            <button type="button" style={opcion('#16a34a')} onClick={() => setPaso('tiene')}>
              ✅ Tengo credencial<div style={{ fontSize: 13, fontWeight: 400, color: '#94a3b8', marginTop: 2 }}>Le sacás una foto de frente y otra del dorso.</div>
            </button>
            <button type="button" style={opcion('#3b82f6')} onClick={() => setPaso('en_tramite')}>
              ⏳ Está en trámite<div style={{ fontSize: 13, fontWeight: 400, color: '#94a3b8', marginTop: 2 }}>Ya presentaste los papeles y estás esperando.</div>
            </button>
            <button type="button" style={opcion('#f59e0b')} onClick={() => setPaso('no_tiene')}>
              ✖ No tengo credencial<div style={{ fontSize: 13, fontWeight: 400, color: '#94a3b8', marginTop: 2 }}>Contanos por qué.</div>
            </button>
            <button type="button" style={{ ...secundario, width: '100%', marginTop: 4 }} onClick={() => { posponer(); setAbierto(false) }}>
              Ahora no la tengo encima (me lo piden la próxima vez)
            </button>
          </>
        )}

        {paso === 'tiene' && (
          <>
            <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 12, lineHeight: 1.45 }}>Sacá las fotos con buena luz, que se lean los datos.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Foto cara="Frente" archivo={frente} leyendo={leyendo === 'Frente'} onElegir={f => void elegirFoto('Frente', f)} />
              <Foto cara="Dorso" archivo={dorso} leyendo={leyendo === 'Dorso'} onElegir={f => void elegirFoto('Dorso', f)} />
            </div>
            {lectura && !lectura.es_credencial && (
              <div style={{ fontSize: 13, color: '#fbbf24', marginTop: 8 }}>La foto del frente no parece una credencial de vigilador. Revisala antes de enviar.</div>
            )}
            {lectura?.es_credencial && (
              <div style={{ fontSize: 13, color: '#93c5fd', marginTop: 8, lineHeight: 1.45 }}>
                Leímos tu credencial{lectura.numero ? ` N° ${lectura.numero}` : ''}{lectura.vencimiento ? `: vence el ${lectura.vencimiento.split('-').reverse().join('/')}` : ''}. Revisá que la fecha sea la correcta.
              </div>
            )}
            {lectura?.dni_coincide === false && (
              <div style={{ fontSize: 13, color: '#fbbf24', marginTop: 4 }}>El DNI de la credencial no coincide con el tuyo: fijate que sea tu credencial.</div>
            )}
            <label style={{ display: 'block', fontSize: 14, color: '#cbd5e1', marginTop: 14 }}>
              Vence el (como figura en la credencial)
              <input type="date" value={vence} onChange={e => { setVence(e.target.value); setVenceDeIA(false); setConfirmaVencida(false) }} style={{ ...input, marginTop: 6 }} />
            </label>
          </>
        )}

        {(paso === 'en_tramite' || paso === 'no_tiene') && (
          <label style={{ display: 'block', fontSize: 14, color: '#cbd5e1', marginTop: 4 }}>
            {paso === 'en_tramite' ? '¿Qué presentaste y cuándo? (si sabés)' : '¿Por qué no tenés credencial?'}
            <textarea value={texto} onChange={e => setTexto(e.target.value)} maxLength={300} rows={3}
              placeholder={paso === 'en_tramite' ? 'Ej.: presenté los papeles en septiembre' : 'Ej.: entré hace poco, nunca la tramité, se me venció…'}
              style={{ ...input, marginTop: 6, resize: 'vertical' }} />
          </label>
        )}

        {paso === 'listo' && (
          <div style={{ fontSize: 15, color: '#86efac', padding: '8px 0', lineHeight: 1.45 }}>
            ✓ ¡Gracias! Ya quedó en tu legajo. Si hace falta algo más, Administración te avisa.
          </div>
        )}

        {error && <div role="alert" style={{ fontSize: 13.5, color: '#f87171', marginTop: 10 }}>{error}</div>}
        {ocupado && <div role="status" style={{ fontSize: 13.5, color: '#93c5fd', marginTop: 10 }}>{ocupado}</div>}

        {paso !== 'elegir' && paso !== 'listo' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button type="button" style={secundario} disabled={!!ocupado} onClick={volver}>Volver</button>
            {paso === 'tiene'
              ? <button type="button" style={primario(!ocupado && !leyendo && !!frente && !!dorso && !!vence)} disabled={!!ocupado || !!leyendo} onClick={() => void enviarFotos()}>Enviar fotos</button>
              : <button type="button" style={primario(!ocupado && (paso === 'en_tramite' || texto.trim().length >= 3))} disabled={!!ocupado} onClick={() => void enviarDeclaracion(paso)}>Enviar</button>}
          </div>
        )}
        {paso === 'listo' && (
          <button type="button" style={{ ...primario(true), width: '100%', marginTop: 12 }} onClick={() => setAbierto(false)}>Listo</button>
        )}
      </div>
    </div>
  )
}
