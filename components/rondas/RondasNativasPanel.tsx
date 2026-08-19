'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  obtenerAccesoRondasObjetivo,
  obtenerPuestosRonda,
  obtenerRondasPorObjetivo,
  presentarIntervalo,
} from '@/lib/rondas'
import type {
  AccesoRondasObjetivo,
  PuestoRonda,
  RondaBaseResumen,
} from '@/lib/rondas'
import RondaBaseEditor from './RondaBaseEditor'
import styles from './Rondas.module.css'

interface Props {
  objetivoId: string
  centroObjetivo?: [number, number] | null
  onDirtyChange: (dirty: boolean) => void
}

function mensajeAcceso(acceso: AccesoRondasObjetivo): string {
  if (acceso.motivo === 'objetivo_sin_zona') {
    return 'Este objetivo no tiene una zona operativa asignada. No tenés permisos para consultar ni administrar sus rondas.'
  }
  if (acceso.motivo === 'fuera_de_zona') {
    return 'Este objetivo está fuera de tu zona operativa. No tenés permisos para consultar ni administrar sus rondas.'
  }
  return 'No tenés permisos para consultar ni administrar las rondas de este objetivo.'
}

export default function RondasNativasPanel({
  objetivoId,
  centroObjetivo,
  onDirtyChange,
}: Props) {
  const [rondas, setRondas] = useState<RondaBaseResumen[]>([])
  const [puestos, setPuestos] = useState<PuestoRonda[]>([])
  const [acceso, setAcceso] = useState<AccesoRondasObjetivo | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [editando, setEditando] = useState<RondaBaseResumen | null | undefined>(undefined)

  // `silencioso` refresca los datos sin tocar `cargando`. Es lo que usa el editor
  // despues de guardar: con el spinner encendido el ternario de mas abajo saca a
  // RondaBaseEditor del arbol, React lo desmonta y al volver a montarse pisa lo
  // recien guardado con el valor con el que se abrio. Mismo criterio que
  // RondasGuardiaPanel.
  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true)
    const terminar = () => {
      if (!silencioso) setCargando(false)
    }

    const accesoRes = await obtenerAccesoRondasObjetivo(objetivoId)
    if (accesoRes.error) {
      setError(accesoRes.error)
      setAcceso(null)
      terminar()
      return
    }

    setAcceso(accesoRes.data)
    if (!accesoRes.data.puede_administrar) {
      setRondas([])
      setPuestos([])
      setError('')
      terminar()
      return
    }

    const [rondasRes, puestosRes] = await Promise.all([
      obtenerRondasPorObjetivo(objetivoId),
      obtenerPuestosRonda(objetivoId),
    ])
    if (rondasRes.error || puestosRes.error) {
      setError(rondasRes.error || puestosRes.error || 'No se pudieron cargar las rondas.')
    } else {
      const frescas = rondasRes.data
      setRondas(frescas)
      setPuestos(puestosRes.data)
      setError('')
      // La ronda abierta tiene que seguir a la lista. `null` es "creando una
      // ronda nueva" y `undefined` es "editor cerrado": ninguno de los dos se pisa.
      setEditando(previo =>
        previo ? (frescas.find(ronda => ronda.id === previo.id) ?? previo) : previo,
      )
    }
    terminar()
  }, [objetivoId])

  useEffect(() => {
    setEditando(undefined)
    onDirtyChange(false)
    void cargar()
  }, [cargar, onDirtyChange])

  const nombresPuestos = new Map(puestos.map(puesto => [puesto.id, puesto.nombre]))

  return (
    <div className={styles.panel}>
      <div className={styles.header} style={{ marginBottom: 12 }}>
        <div>
          <div className={styles.name} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Rondas nativas</div>
          <div className={styles.help}>Configuración por puesto, separada del historial JWM.</div>
        </div>
        {acceso?.puede_administrar && editando === undefined && (
          <button
            className={`${styles.button} ${styles.buttonPrimary}`}
            type="button"
            onClick={() => setEditando(null)}
            disabled={puestos.length === 0}
          >
            Nueva ronda
          </button>
        )}
      </div>

      {error && <div className={styles.message}>{error}</div>}

      {cargando ? (
        <div className={styles.help}>Verificando acceso y rondas configuradas…</div>
      ) : acceso && !acceso.puede_administrar ? (
        <div className={styles.accessNotice}>
          <strong>{mensajeAcceso(acceso)}</strong>
        </div>
      ) : editando !== undefined ? (
        <RondaBaseEditor
          key={editando?.id ?? 'nueva'}
          objetivoId={objetivoId}
          centroObjetivo={centroObjetivo}
          puestos={puestos}
          rondaInicial={editando}
          onCerrar={() => {
            setEditando(undefined)
            onDirtyChange(false)
            void cargar()
          }}
          onCambio={() => void cargar(true)}
          onDirtyChange={onDirtyChange}
        />
      ) : (
        <>
          {puestos.length === 0 && (
            <div className={styles.message}>
              Este objetivo no tiene puestos configurados. Creá o asigná un puesto antes de configurar rondas.
            </div>
          )}
          {rondas.length === 0 ? (
            puestos.length > 0 && (
              <div className={styles.help}>Este objetivo todavía no tiene rondas nativas configuradas.</div>
            )
          ) : (
            <div className={styles.list}>
              {rondas.map(ronda => (
                <div className={styles.row} key={ronda.id}>
                  <div className={styles.rowMain}>
                    <div className={styles.name}>{ronda.nombre}</div>
                    <div className={styles.meta}>
                      Puesto: {nombresPuestos.get(ronda.puesto_id) ?? 'No disponible'} · {presentarIntervalo(ronda.intervalo_minutos)}
                      {ronda.hora_inicio ? ` · Inicio ${ronda.hora_inicio.slice(0, 5)}` : ' · Sin hora de inicio'}
                      {` · ${ronda.cantidad_puntos} ${ronda.cantidad_puntos === 1 ? 'punto activo' : 'puntos activos'} · Versión ${ronda.version}`}
                    </div>
                    {ronda.descripcion && <div className={styles.help}>{ronda.descripcion}</div>}
                  </div>
                  <span className={`${styles.statusBadge} ${ronda.activo ? styles.statusGps : styles.statusUnknown}`}>
                    {ronda.activo ? 'Activa' : 'Inactiva'}
                  </span>
                  <button className={styles.button} type="button" onClick={() => setEditando(ronda)}>
                    Administrar
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
