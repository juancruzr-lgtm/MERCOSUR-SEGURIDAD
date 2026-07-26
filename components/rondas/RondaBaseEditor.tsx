'use client'

import { useState } from 'react'
import {
  actualizarRondaBase,
  cambiarEstadoRonda,
  crearRondaBase,
} from '@/lib/rondas'
import type { RondaBase, RondaBaseResumen } from '@/lib/rondas'
import RondaPuntosEditor from './RondaPuntosEditor'
import styles from './Rondas.module.css'

interface Props {
  objetivoId: string
  rondaInicial: RondaBaseResumen | null
  onCerrar: () => void
  onCambio: () => void
}

export default function RondaBaseEditor({
  objetivoId,
  rondaInicial,
  onCerrar,
  onCambio,
}: Props) {
  const [ronda, setRonda] = useState<RondaBase | null>(rondaInicial)
  const [nombre, setNombre] = useState(rondaInicial?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(rondaInicial?.descripcion ?? '')
  const [intervalo, setIntervalo] = useState((rondaInicial?.intervalo_minutos ?? 120).toString())
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')

  const guardarBase = async () => {
    if (guardando) return
    setGuardando(true)
    setError('')
    setMensaje('')

    const intervaloMinutos = Number(intervalo)
    const resultado = ronda
      ? await actualizarRondaBase(ronda.id, {
        nombre,
        descripcion,
        intervalo_minutos: intervaloMinutos,
      })
      : await crearRondaBase({
        objetivo_id: objetivoId,
        nombre,
        descripcion,
        intervalo_minutos: intervaloMinutos,
      })

    if (resultado.error) {
      setError(resultado.error)
    } else {
      setRonda(resultado.data)
      setNombre(resultado.data.nombre)
      setDescripcion(resultado.data.descripcion ?? '')
      setIntervalo(resultado.data.intervalo_minutos.toString())
      setMensaje(ronda ? 'Ronda actualizada.' : 'Ronda creada. Ya podés configurar sus puntos.')
      onCambio()
    }
    setGuardando(false)
  }

  const cambiarActivo = async () => {
    if (!ronda || guardando) return
    const accion = ronda.activo ? 'desactivar' : 'activar'
    if (!window.confirm(`¿Querés ${accion} la ronda "${ronda.nombre}"?`)) return

    setGuardando(true)
    setError('')
    const resultado = await cambiarEstadoRonda(ronda.id, !ronda.activo)
    if (resultado.error) {
      setError(resultado.error)
    } else {
      setRonda(resultado.data)
      setMensaje(`Ronda ${resultado.data.activo ? 'activada' : 'desactivada'}.`)
      onCambio()
    }
    setGuardando(false)
  }

  return (
    <div className={styles.editor}>
      <div className={styles.header} style={{ marginBottom: 14 }}>
        <div>
          <div className={styles.name}>{ronda ? `Administrar: ${ronda.nombre}` : 'Crear ronda base'}</div>
          <div className={styles.help}>La configuración se aplicará únicamente a futuras ejecuciones.</div>
        </div>
        <button className={styles.button} type="button" onClick={onCerrar} disabled={guardando}>Cerrar editor</button>
      </div>

      {error && <div className={styles.message}>{error}</div>}
      {mensaje && <div className={`${styles.message} ${styles.success}`}>{mensaje}</div>}

      <div className={styles.formGrid}>
        <div className={styles.field}>
          <label htmlFor="ronda-base-nombre">Nombre</label>
          <input id="ronda-base-nombre" value={nombre} onChange={evento => setNombre(evento.target.value)} maxLength={120} />
        </div>
        <div className={styles.field}>
          <label htmlFor="ronda-base-intervalo">Intervalo en minutos</label>
          <input id="ronda-base-intervalo" type="number" min="15" max="10080" step="15" value={intervalo} onChange={evento => setIntervalo(evento.target.value)} />
          <div className={styles.help}>Ejemplos: 60 = cada hora, 120 = cada 2 horas.</div>
        </div>
        <div className={`${styles.field} ${styles.full}`}>
          <label htmlFor="ronda-base-descripcion">Descripción opcional</label>
          <textarea id="ronda-base-descripcion" value={descripcion} onChange={evento => setDescripcion(evento.target.value)} maxLength={1000} />
        </div>
      </div>

      <div className={styles.actions} style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        {ronda && (
          <button
            className={`${styles.button} ${ronda.activo ? styles.buttonDanger : ''}`}
            type="button"
            onClick={() => void cambiarActivo()}
            disabled={guardando}
          >
            {ronda.activo ? 'Desactivar ronda' : 'Activar ronda'}
          </button>
        )}
        <button className={`${styles.button} ${styles.buttonPrimary}`} type="button" onClick={() => void guardarBase()} disabled={guardando}>
          {guardando ? 'Guardando…' : ronda ? 'Guardar cambios' : 'Crear ronda'}
        </button>
      </div>

      {ronda && <RondaPuntosEditor rondaBaseId={ronda.id} onCambio={onCambio} />}
    </div>
  )
}
