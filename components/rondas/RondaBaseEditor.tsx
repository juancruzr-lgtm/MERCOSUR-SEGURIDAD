'use client'

import { useEffect, useMemo, useState } from 'react'
import { eliminarRondaBase, mensajeContextoEliminarRonda } from '@/lib/rondas'
import {
  actualizarRondaBase,
  cambiarEstadoRonda,
  crearRondaBase,
} from '@/lib/rondas'
import { motivoRondaSinVentanas, ventanasRondaEnTurno } from '@/lib/rondas'
import type { PuestoRonda, RondaBase, RondaBaseResumen, TurnoVentanaRonda } from '@/lib/rondas'
import { supabase } from '@/lib/supabase'
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
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  // El input type="time" no sabe expresar "sin hora": al vaciarlo el navegador
  // termina en 00:00, que NO es lo mismo — ancla el ciclo a medianoche en vez de
  // al turno. Este checkbox es la unica via de la pantalla para producir el null
  // que la logica ya soporta (ventanasRondaEnTurno: base = hora_inicio ?? inicio
  // del turno).
  const [sinHora, setSinHora] = useState(!inicial.hora_inicio)
  const [horaPrevia, setHoraPrevia] = useState(inicial.hora_inicio || '08:00')
  const baseDirty = JSON.stringify(form) !== JSON.stringify(baseGuardada)
  const hayCambios = baseDirty || puntosDirty

  // Turnos del puesto, sólo para anticipar qué generaría esta configuración.
  // No decide nada: la obligación la calcula rondas_ventanas_programadas en el
  // servidor. Acá se usan para no dejar guardar en silencio una hora que
  // dejaría el puesto sin ninguna ronda.
  const [turnosRef, setTurnosRef] = useState<TurnoVentanaRonda[]>([])

  useEffect(() => {
    if (!form.puesto_id) { setTurnosRef([]); return }
    let activo = true
    void supabase
      .from('turnos')
      .select('hora_inicio, hora_fin')
      .eq('puesto_id', form.puesto_id)
      .not('estado', 'in', '("reemplazado","anulado","cancelado")')
      .order('fecha', { ascending: false })
      .limit(60)
      .then(({ data }) => {
        if (!activo) return
        const vistos = new Set<string>()
        const unicos: TurnoVentanaRonda[] = []
        for (const t of (data ?? []) as any[]) {
          const k = `${t.hora_inicio}-${t.hora_fin}`
          if (vistos.has(k)) continue
          vistos.add(k)
          unicos.push({ hora_inicio: t.hora_inicio, hora_fin: t.hora_fin })
        }
        setTurnosRef(unicos)
      })
    return () => { activo = false }
  }, [form.puesto_id])

  const rondaConfigurada = {
    hora_inicio: form.hora_inicio ? `${form.hora_inicio}:00` : null,
    intervalo_minutos: Number(form.intervalo),
  }
  const errorVentanas = motivoRondaSinVentanas(rondaConfigurada, turnosRef)

  // Vista previa sobre el turno más frecuente del puesto: que el administrador
  // vea los horarios antes de guardar, no después de que falten rondas.
  const previsualizacion = (() => {
    if (errorVentanas || turnosRef.length === 0) return ''
    const turno = turnosRef.find(t => ventanasRondaEnTurno(t, rondaConfigurada).length > 0)
    if (!turno) return ''
    const v = ventanasRondaEnTurno(turno, rondaConfigurada)
    const muestra = v.slice(0, 6).join(' → ') + (v.length > 6 ? ' → …' : '')
    return `En un turno ${turno.hora_inicio.slice(0, 5)}–${turno.hora_fin.slice(0, 5)}: ${v.length} ronda${v.length === 1 ? '' : 's'} · ${muestra}`
  })()

  useEffect(() => onDirtyChange(hayCambios), [hayCambios, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  useEffect(() => {
    if (ronda || form.puesto_id || puestos.length !== 1) return
    const puestoId = puestos[0].id
    setForm(actual => ({ ...actual, puesto_id: puestoId }))
    setBaseGuardada(actual => ({ ...actual, puesto_id: puestoId }))
  }, [form.puesto_id, puestos, ronda])

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

  const alternarSinHora = (marcado: boolean) => {
    setSinHora(marcado)
    if (marcado) {
      if (form.hora_inicio) setHoraPrevia(form.hora_inicio)
      setForm(actual => ({ ...actual, hora_inicio: '' }))
    } else {
      setForm(actual => ({ ...actual, hora_inicio: horaPrevia }))
    }
  }

  const guardarBase = async () => {
    if (guardando) return
    if (!ronda && !form.puesto_id) {
      setError('Seleccioná el puesto al que pertenece la ronda.')
      return
    }
    // Una hora fuera de la ventana del turno se guardaba sin protestar y el
    // puesto quedaba sin ninguna ronda, sin que nada lo dijera.
    if (errorVentanas) {
      setError(errorVentanas)
      return
    }
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
      setSinHora(!guardada.hora_inicio)
      if (guardada.hora_inicio) setHoraPrevia(guardada.hora_inicio)
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

  /**
   * Eliminar la ronda. Solo si nunca se ejecutó.
   *
   * La decisión de si se puede o no la toma la base, no esta pantalla: si tiene
   * ejecuciones la RPC contesta `tiene_historia` y no borra nada. Acá sólo se
   * muestra lo que contestó.
   */
  const eliminar = async () => {
    if (!ronda || guardando) return
    setGuardando(true)
    setMensaje(null)
    const { data, error } = await eliminarRondaBase(ronda.id)
    setGuardando(false)
    if (error) { setMensaje(error); return }
    const aviso = data ? mensajeContextoEliminarRonda(data) : 'No se pudo eliminar la ronda.'
    if (aviso) { setMensaje(aviso); setConfirmandoBorrado(false); return }
    onCambio()
    onCerrar()
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
            required
          >
            <option value="">Seleccionar puesto</option>
            {ronda && !puestos.some(puesto => puesto.id === ronda.puesto_id) && (
              <option value={ronda.puesto_id}>Puesto asignado (inactivo o no disponible)</option>
            )}
            {puestos.map(puesto => (
              <option key={puesto.id} value={puesto.id}>
                {puesto.nombre}
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
          <input
            id="ronda-base-hora-inicio"
            type="time"
            value={form.hora_inicio}
            disabled={sinHora}
            onChange={evento => setForm({ ...form, hora_inicio: evento.target.value })}
          />
          <label className={styles.help} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <input type="checkbox" checked={sinHora} onChange={evento => alternarSinHora(evento.target.checked)} />
            Sin hora fija — arranca con cada turno (24 h)
          </label>
          {/* El texto anterior decía que era "referencia futura" y que "todavía
              no genera obligaciones". Era exactamente al revés: esta hora ancla
              el ciclo completo. Verificado en producción: NACION SANTA FE con
              primera 23:00 y 60 min genera 23:00 → 00:00 → … → 06:00. */}
          <div className={styles.help}>
            {sinHora
              ? 'Cobertura 24 h: el ciclo arranca al comenzar cada turno del puesto y se repite según el intervalo mientras exista un turno activo, sea cual sea su horario.'
              : 'Hora de inicio del ciclo. Las rondas se repiten desde esta hora según el intervalo configurado mientras exista un turno activo, y solo en los turnos que contengan esa hora.'}
          </div>
          {previsualizacion && (
            <div className={styles.help} style={{ color: '#38bdf8' }}>
              {previsualizacion}
            </div>
          )}
        </div>
        <div className={`${styles.field} ${styles.full}`}>
          <label htmlFor="ronda-base-descripcion">Descripción opcional</label>
          <textarea id="ronda-base-descripcion" value={form.descripcion} onChange={evento => setForm({ ...form, descripcion: evento.target.value })} maxLength={1000} />
        </div>
      </div>

      <div className={styles.actions} style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        {ronda && !confirmandoBorrado && (
          <button
            className={styles.button}
            type="button"
            onClick={() => setConfirmandoBorrado(true)}
            disabled={guardando}
          >
            Eliminar ronda
          </button>
        )}
        {ronda && confirmandoBorrado && (
          <>
            <span style={{ fontSize: 12, color: '#fbbf24', alignSelf: 'center', marginRight: 6 }}>
              Se elimina con sus puntos y alertas. Si ya tiene ejecuciones no se borra.
            </span>
            <button className={styles.button} type="button" onClick={() => setConfirmandoBorrado(false)} disabled={guardando}>
              Cancelar
            </button>
            <button className={`${styles.button} ${styles.buttonDanger}`} type="button" onClick={() => void eliminar()} disabled={guardando}>
              {guardando ? 'Eliminando…' : 'Confirmar eliminación'}
            </button>
          </>
        )}
        {ronda && (
          <button className={`${styles.button} ${ronda.activo ? styles.buttonDanger : ''}`} type="button" onClick={() => void cambiarActivo()} disabled={guardando}>
            {ronda.activo ? 'Desactivar ronda' : 'Activar ronda'}
          </button>
        )}
        <button
          className={`${styles.button} ${styles.buttonPrimary}`}
          type="button"
          onClick={() => void guardarBase()}
          disabled={guardando || (!ronda && !form.puesto_id)}
        >
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
