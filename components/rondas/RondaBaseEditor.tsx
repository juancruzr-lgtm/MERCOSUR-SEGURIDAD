'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  actualizarRondaBase,
  cambiarEstadoRonda,
  crearRondaBase,
} from '@/lib/rondas'
import type { PuestoRonda, RondaBase, RondaBaseResumen } from '@/lib/rondas'
import RondaPuntosEditor from './RondaPuntosEditor'
import styles from './Rondas.module.css'

interface Props {
  objetivoId: string
  centroObjetivo?: [number, number] | null
  puestos: PuestoRonda[]
  rondaInicial: RondaBaseResumen | null
  onCerrar: () => void
  onCambio: () => void
  onDirtyChange: (dirty: boolean) => void
}

interface BaseForm {
  puesto_id: string
  nombre: string
  descripcion: string
  intervalo: string
  hora_inicio: string
}

function formInicial(ronda: RondaBaseResumen | null, puestos: PuestoRonda[]): BaseForm {
  return {
    puesto_id: ronda?.puesto_id ?? (puestos.length === 1 ? puestos[0].id : ''),
    nombre: ronda?.nombre ?? '',
    descripcion: ronda?.descripcion ?? '',
    intervalo: (ronda?.intervalo_minutos ?? 120).toString(),
    hora_inicio: ronda?.hora_inicio?.slice(0, 5) ?? '',
  }
}

export default function RondaBaseEditor({
  objetivoId,
  centroObjetivo,
  puestos,
  rondaInicial,
  onCerrar,
  onCambio,
  onDirtyChange,
}: Props) {
  const inicial = useMemo(() => formInicial(rondaInicial, puestos), [rondaInicial, puestos])
  const [ronda, setRonda] = useState<RondaBase | null>(rondaInicial)
  const [form, setForm] = useState<BaseForm>(inicial)
  const [baseGuardada, setBaseGuardada] = useState<BaseForm>(inicial)
  const [puntosDirty, setPuntosDirty] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const baseDirty = JSON.stringify(form) !== JSON.stringify(baseGuardada)
  const hayCambios = baseDirty || puntosDirty

  useEffect(() => onDirtyChange(hayCambios), [hayCambios, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  useEffect(() => {
    if (!hayCambios) return
    const advertir = (evento: BeforeUnloadEvent) => {
      evento.preventDefault()
      evento.returnValue = ''
    }
    window.addEventListener('beforeunload', advertir)
    return () => window.removeEventListener('beforeunload', advertir)
  }, [hayCambios])

  const confirmarSalida = () =>
    !hayCambios || window.confirm('Hay cambios de la ronda sin guardar. ¿Querés descartarlos?')

  const cerrar = () => {
    if (confirmarSalida()) onCerrar()
  }

  const guardarBase = async () => {
    if (guardando) return
    setGuardando(true)
    setError('')
    setMensaje('')

    const intervaloMinutos = Number(form.intervalo)
    const resultado = ronda
      ? await actualizarRondaBase(ronda.id, {
        nombre: form.nombre,
        descripcion: form.descripcion,
        intervalo_minutos: intervaloMinutos,
        hora_inicio: form.hora_inicio || null,
      })
      : await crearRondaBase({
        objetivo_id: objetivoId,
        puesto_id: form.puesto_id,
        nombre: form.nombre,
        descripcion: form.descripcion,
        intervalo_minutos: intervaloMinutos,
        hora_inicio: form.hora_inicio || null,
      })

    if (resultado.error) {
      setError(resultado.error)
    } else {
      setRonda(resultado.data)
      const guardada = formInicial({ ...resultado.data, cantidad_puntos: 0 }, puestos)
      setForm(guardada)
      setBaseGuardada(guardada)
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
    if (resultado.error) setError(resultado.error)
    else {
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
        <button className={styles.button} type="button" onClick={cerrar} disabled={guardando}>Cerrar editor</button>
      </div>

      {error && <div className={styles.message}>{error}</div>}
      {mensaje && <div className={`${styles.message} ${styles.success}`}>{mensaje}</div>}

      <div className={styles.formGrid}>
        <div className={styles.field}>
          <label htmlFor="ronda-base-puesto">Puesto</label>
          <select
            id="ronda-base-puesto"
            value={form.puesto_id}
            onChange={evento => setForm({ ...form, puesto_id: evento.target.value })}
            disabled={Boolean(ronda)}
          >
            <option value="">Seleccionar puesto</option>
            {puestos.map(puesto => (
              <option key={puesto.id} value={puesto.id}>
                {puesto.nombre}{puesto.activo ? '' : ' (inactivo)'}
              </option>
            ))}
          </select>
          {ronda && <div className={styles.help}>El puesto no puede cambiarse después de crear la ronda.</div>}
        </div>
        <div className={styles.field}>
          <label htmlFor="ronda-base-nombre">Nombre</label>
          <input id="ronda-base-nombre" value={form.nombre} onChange={evento => setForm({ ...form, nombre: evento.target.value })} maxLength={120} />
        </div>
        <div className={styles.field}>
          <label htmlFor="ronda-base-intervalo">Intervalo en minutos</label>
          <input id="ronda-base-intervalo" type="number" min="15" max="10080" step="15" value={form.intervalo} onChange={evento => setForm({ ...form, intervalo: evento.target.value })} />
          <div className={styles.help}>Ejemplos: 60 = cada hora, 120 = cada 2 horas.</div>
        </div>
        <div className={styles.field}>
          <label htmlFor="ronda-base-hora-inicio">Primera ronda / hora de inicio</label>
          <input id="ronda-base-hora-inicio" type="time" value={form.hora_inicio} onChange={evento => setForm({ ...form, hora_inicio: evento.target.value })} />
          <div className={styles.help}>Referencia futura para calcular intervalos; todavía no genera obligaciones.</div>
        </div>
        <div className={`${styles.field} ${styles.full}`}>
          <label htmlFor="ronda-base-descripcion">Descripción opcional</label>
          <textarea id="ronda-base-descripcion" value={form.descripcion} onChange={evento => setForm({ ...form, descripcion: evento.target.value })} maxLength={1000} />
        </div>
      </div>

      <div className={styles.actions} style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        {ronda && (
          <button className={`${styles.button} ${ronda.activo ? styles.buttonDanger : ''}`} type="button" onClick={() => void cambiarActivo()} disabled={guardando}>
            {ronda.activo ? 'Desactivar ronda' : 'Activar ronda'}
          </button>
        )}
        <button className={`${styles.button} ${styles.buttonPrimary}`} type="button" onClick={() => void guardarBase()} disabled={guardando}>
          {guardando ? 'Guardando…' : ronda ? 'Guardar cambios' : 'Crear ronda'}
        </button>
      </div>

      {ronda && (
        <RondaPuntosEditor
          rondaBaseId={ronda.id}
          centroObjetivo={centroObjetivo}
          onCambio={onCambio}
          onDirtyChange={setPuntosDirty}
        />
      )}
    </div>
  )
}
