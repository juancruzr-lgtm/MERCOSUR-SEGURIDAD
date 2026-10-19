'use client'

/**
 * components/rondas/RondaHorariosSinExigencia.tsx
 *
 * «Cuándo no se exige esta ronda», dentro del editor de la ronda. Ej.: Laromet
 * Baigorria, domingo de 06:00 a 22:00 (el vigilador hace de portero). La ventana
 * que empieza en ese horario no genera alerta ni cuenta en la evaluación, y el
 * vigilador no recibe avisos. Vale también hacia atrás (la evaluación se
 * recalcula).
 *
 * Cargar y dar de baja: quien edita protocolos (Administración, Gerencia,
 * jefatura de supervisores, dirección operativa); la base lo valida. Los
 * horarios no se editan ni se borran: se dan de baja con motivo.
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import styles from './Rondas.module.css'

export const DIAS_SEMANA = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const

interface Horario {
  id: string
  dia_semana: number
  desde: string
  hasta: string
  motivo: string
  creado_at: string
}

const campo: React.CSSProperties = { background: '#0a0e1a', border: '1px solid #1e2d42', color: '#e2e8f0', borderRadius: 8, padding: '6px 8px', fontSize: 13, fontFamily: 'inherit' }

export const hhmm = (t: string) => String(t).slice(0, 5)

export default function RondaHorariosSinExigencia({ rondaBaseId }: { rondaBaseId: string }) {
  const [horarios, setHorarios] = useState<Horario[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [nuevo, setNuevo] = useState(false)
  const [dia, setDia] = useState(7)
  const [desde, setDesde] = useState('06:00')
  const [hasta, setHasta] = useState('22:00')
  const [motivo, setMotivo] = useState('')

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.from('ronda_horarios_sin_exigencia')
      .select('id, dia_semana, desde, hasta, motivo, creado_at')
      .eq('ronda_base_id', rondaBaseId).eq('activo', true)
      .order('dia_semana').order('desde')
    // Sin la migración aplicada la tabla no existe: la sección no aparece.
    if (e) { setError(/does not exist|schema cache/i.test(e.message) ? 'sin_tabla' : e.message); return }
    setError(null)
    setHorarios((data ?? []) as Horario[])
  }, [rondaBaseId])

  useEffect(() => { void cargar() }, [cargar])

  if (error === 'sin_tabla') return null

  const agregar = async () => {
    setOcupado(true); setMensaje(null)
    const { error: e } = await supabase.rpc('ronda_horario_sin_exigencia_agregar', {
      p_ronda_base_id: rondaBaseId, p_dia_semana: dia, p_desde: desde, p_hasta: hasta, p_motivo: motivo,
    })
    setOcupado(false)
    if (e) { setMensaje(e.message); return }
    setNuevo(false); setMotivo('')
    setMensaje('Guardado: en ese horario la ronda ya no se exige.')
    await cargar()
  }

  const quitar = async (h: Horario) => {
    const m = window.prompt(`Motivo para volver a exigir la ronda el ${DIAS_SEMANA[h.dia_semana].toLowerCase()} de ${hhmm(h.desde)} a ${hhmm(h.hasta)}:`)
    if (!m || !m.trim()) return
    setOcupado(true); setMensaje(null)
    const { error: e } = await supabase.rpc('ronda_horario_sin_exigencia_quitar', { p_id: h.id, p_motivo: m.trim() })
    setOcupado(false)
    if (e) { setMensaje(e.message); return }
    setMensaje('Listo: en ese horario la ronda vuelve a exigirse.')
    await cargar()
  }

  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #1e2d42' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>Cuándo no se exige esta ronda</div>
      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5, marginTop: 2 }}>
        Para horarios en que el vigilador tiene otra tarea (p. ej. portería). En ese horario no hay alertas, no cuenta en la
        evaluación —tampoco hacia atrás— y el vigilador no recibe avisos.
      </div>
      {error && <div style={{ color: '#f87171', fontSize: 13, marginTop: 6 }}>{error}</div>}
      {mensaje && <div style={{ fontSize: 13, marginTop: 6, color: /permiso|rechaz|superpone|obligatorio|invalido|despues/i.test(mensaje) ? '#f87171' : '#4ade80' }}>{mensaje}</div>}

      {horarios && horarios.length === 0 && !nuevo && <div style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>Se exige en todo el turno.</div>}
      {horarios?.map(h => (
        <div key={h.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8, fontSize: 13, color: '#e2e8f0' }}>
          <b>{DIAS_SEMANA[h.dia_semana]} de {hhmm(h.desde)} a {hhmm(h.hasta)}</b>
          <span style={{ color: '#94a3b8' }}>· {h.motivo}</span>
          <button className={styles.button} type="button" disabled={ocupado} onClick={() => void quitar(h)}>Volver a exigir</button>
        </div>
      ))}

      {nuevo ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
          <select style={campo} value={dia} onChange={e => setDia(Number(e.target.value))} aria-label="Día">
            {DIAS_SEMANA.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
          </select>
          <span style={{ fontSize: 13, color: '#94a3b8' }}>de</span>
          <input style={campo} type="time" value={desde} onChange={e => setDesde(e.target.value)} aria-label="Desde" />
          <span style={{ fontSize: 13, color: '#94a3b8' }}>a</span>
          <input style={campo} type="time" value={hasta} onChange={e => setHasta(e.target.value)} aria-label="Hasta" />
          <input style={{ ...campo, minWidth: 240 }} placeholder="Motivo (obligatorio)" value={motivo} onChange={e => setMotivo(e.target.value)} />
          <button className={`${styles.button} ${styles.buttonPrimary}`} type="button" disabled={ocupado || !motivo.trim()} onClick={() => void agregar()}>Guardar</button>
          <button className={styles.button} type="button" onClick={() => setNuevo(false)}>Cancelar</button>
        </div>
      ) : (
        <button className={styles.button} style={{ marginTop: 10 }} type="button" onClick={() => setNuevo(true)}>Agregar horario sin exigencia</button>
      )}
    </div>
  )
}
