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
  if (acceso.motivo === 'objetivo_sin_zona') return 'Objetivo sin zona operativa asignada.'
  if (acceso.motivo === 'fuera_de_zona') return 'No tenés permisos de administración para este objetivo.'
  return 'Tu usuario no tiene permisos para administrar rondas.'
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

  const cargar = useCallback(async () => {
    setCargando(true)
    const accesoRes = await obtenerAccesoRondasObjetivo(objetivoId)
    if (accesoRes.error) {
      setError(accesoRes.error)
      setAcceso(null)
      setCargando(false)
      return
    }

    setAcceso(accesoRes.data)
    if (!accesoRes.data.puede_administrar) {
      setRondas([])
      setPuestos([])
      setError('')
      setCargando(false)
      return
    }

    const [rondasRes, puestosRes] = await Promise.all([
      obtenerRondasPorObjetivo(objetivoId),
      obtenerPuestosRonda(objetivoId),
    ])
    if (rondasRes.error || puestosRes.error) {
      setError(rondasRes.error || puestosRes.error || 'No se pudieron cargar las rondas.')
    } else {
      setRondas(rondasRes.data)
      setPuestos(puestosRes.data)
      setError('')
    }
    setCargando(false)
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
          <button className={`${styles.button} ${styles.buttonPrimary}`} type="button" onClick={() => setEditando(null)}>
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
          <span>
            {acceso.cantidad_rondas > 0
              ? `Existen ${acceso.cantidad_rondas} ronda(s) configurada(s), disponibles en modo informativo sin controles de edición.`
              : 'No hay rondas configuradas para este objetivo.'}
          </span>
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
          onCambio={() => void cargar()}
          onDirtyChange={onDirtyChange}
        />
      ) : rondas.length === 0 ? (
        <div className={styles.help}>
          {puestos.length === 0
            ? 'Este objetivo no tiene puestos disponibles para configurar rondas.'
            : 'Este objetivo todavía no tiene rondas nativas configuradas.'}
        </div>
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
    </div>
  )
}
