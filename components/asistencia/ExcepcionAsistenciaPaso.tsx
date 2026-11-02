'use client'

// Paso que aparece dentro de la confirmación de asistencia cuando la base la
// rechaza por falta de respaldo. Quien puede autorizar escribe el motivo y con
// un solo botón autoriza y reintenta la confirmación; quien no puede (un
// supervisor de zona) ve a quién pedírsela.

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  MOTIVO_EXCEPCION_MINIMO,
  autorizarExcepcionAsistencia,
  motivoExcepcionValido,
  puedoAutorizarExcepcion,
} from '@/lib/excepcion-asistencia'

interface Props {
  turnoId: string
  /** Reintenta la confirmación original; la base consume la excepción en ese momento. */
  onAutorizada: () => Promise<void>
  deshabilitado?: boolean
}

export default function ExcepcionAsistenciaPaso({ turnoId, onAutorizada, deshabilitado }: Props) {
  const [puede, setPuede] = useState<boolean | null>(null)
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  // Un id por intento: si la respuesta se pierde y se toca de nuevo, el
  // servidor reconoce la misma operación y no crea otra excepción.
  const operacion = useRef<{ id: string, motivo: string } | null>(null)

  useEffect(() => {
    let vigente = true
    puedoAutorizarExcepcion(supabase).then(v => { if (vigente) setPuede(v) })
    return () => { vigente = false }
  }, [])

  const autorizar = async () => {
    if (enviando || !motivoExcepcionValido(motivo)) return
    setEnviando(true)
    setError('')
    try {
      const texto = motivo.trim()
      if (!operacion.current || operacion.current.motivo !== texto) {
        operacion.current = { id: crypto.randomUUID(), motivo: texto }
      }
      await autorizarExcepcionAsistencia(supabase, { operacionId: operacion.current.id, turnoId, motivo: texto })
      await onAutorizada()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo autorizar la excepción')
    } finally {
      setEnviando(false)
    }
  }

  const caja: React.CSSProperties = {
    background: 'rgba(245,158,11,.10)', border: '1px solid rgba(245,158,11,.45)', color: '#fde68a',
    borderRadius: 8, padding: 12, marginTop: 10, fontSize: 12.5, lineHeight: 1.45,
  }

  return (
    <div style={caja}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Sin respaldo para reconocer estas horas</div>
      <div>
        No hay fichaje, fotos ni rondas del vigilador, ni una supervisión cargada en el objetivo durante el turno.
        Para reconocer las horas hace falta una excepción autorizada.
      </div>
      {puede === null && <div style={{ marginTop: 8, color: '#94a3b8' }}>Verificando permisos…</div>}
      {puede === false && (
        <div style={{ marginTop: 8 }}>
          La autoriza jefatura operativa, administración o gerencia. Pedísela con el detalle de lo que verificaste;
          una vez autorizada, volvé a confirmar desde acá.
        </div>
      )}
      {puede === true && (
        <div style={{ marginTop: 8 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#fcd34d', marginBottom: 4 }}>
            Motivo de la excepción * (mín. {MOTIVO_EXCEPCION_MINIMO} caracteres)
          </label>
          <textarea
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            rows={3}
            disabled={enviando || deshabilitado}
            placeholder="Ej.: Hablé con el cliente, confirma que el vigilador cubrió el turno; el celular estaba roto."
            style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: 10, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
          />
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
            Queda registrado quién autorizó, cuándo y el motivo. Sirve una sola vez y vence a las 48 h.
          </div>
          {error && <div style={{ color: '#fca5a5', marginTop: 6 }}>{error}</div>}
          <button
            type="button"
            onClick={autorizar}
            disabled={enviando || deshabilitado || !motivoExcepcionValido(motivo)}
            style={{
              marginTop: 8, width: '100%', padding: '10px 0', borderRadius: 8, border: 'none', background: '#92400e',
              color: '#fde68a', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              opacity: enviando || deshabilitado || !motivoExcepcionValido(motivo) ? 0.5 : 1,
            }}
          >
            {enviando ? 'Autorizando…' : 'Autorizar excepción y confirmar'}
          </button>
        </div>
      )}
    </div>
  )
}
