'use client'

// Centro de Rondas: administrar las rondas activas sin entrar objetivo por
// objetivo. Es un AGREGADOR, no un modulo nuevo: la lista sale de
// listarCentroRondas (que junta rondas_base, ronda_puntos, ronda_ejecuciones y
// ronda_alertas) y "Ver / Administrar" monta el MISMO RondasNativasPanel que
// usa el Centro Operativo del Objetivo, apuntado a esa ronda. No hay un
// segundo editor, ni una segunda logica de puntos, GPS, radios o frecuencia.

import { useCallback, useEffect, useState } from 'react'
import {
  etiquetaHoraInicioRonda,
  listarCentroRondas,
  presentarIntervalo,
} from '@/lib/rondas'
import type { FilaCentroRondas } from '@/lib/rondas'
import { formatFechaHora } from '@/lib/formato'
import RondasNativasPanel from './RondasNativasPanel'
import styles from './Rondas.module.css'

export interface ObjetivoCentroRondas {
  id: string
  nombre: string
}

interface Props {
  /** Objetivos del alcance. El llamador ya filtro activos y de prueba. */
  objetivos: ObjetivoCentroRondas[]
  onDirtyChange?: (dirty: boolean) => void
}

export default function CentroDeRondas({ objetivos, onDirtyChange }: Props) {
  const [filas, setFilas] = useState<FilaCentroRondas[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [soloConAlertas, setSoloConAlertas] = useState(false)
  const [administrando, setAdministrando] = useState<FilaCentroRondas | null>(null)

  const ids = objetivos.map(o => o.id).join(',')

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await listarCentroRondas(ids ? ids.split(',') : [])
    if (r.error) setError(r.error)
    else { setFilas(r.data); setError('') }
    setCargando(false)
  }, [ids])

  useEffect(() => { void cargar() }, [cargar])

  // Administrando una ronda: se monta el panel del objetivo, abierto en ella.
  // Al volver se recarga, porque puede haber cambiado puntos, hora o estado.
  if (administrando) {
    return (
      <div className={styles.panel}>
        <div className={styles.header} style={{ marginBottom: 12 }}>
          <div>
            <div className={styles.name}>{administrando.objetivoNombre}</div>
            <div className={styles.help}>
              {administrando.puestoNombre} · {administrando.nombre}
            </div>
          </div>
          <button
            className={styles.button}
            type="button"
            onClick={() => { setAdministrando(null); onDirtyChange?.(false); void cargar() }}
          >
            Volver al Centro de Rondas
          </button>
        </div>
        <RondasNativasPanel
          objetivoId={administrando.objetivoId}
          rondaInicialId={administrando.rondaId}
          onDirtyChange={onDirtyChange ?? (() => {})}
        />
      </div>
    )
  }

  const visibles = soloConAlertas ? filas.filter(f => f.alertasPendientes > 0) : filas
  const conAlertas = filas.filter(f => f.alertasPendientes > 0).length

  return (
    <div className={styles.panel}>
      <div className={styles.header} style={{ marginBottom: 12 }}>
        <div>
          <div className={styles.name} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
            Centro de Rondas
          </div>
          <div className={styles.help}>
            Todas las rondas configuradas del alcance. Tocá una para administrarla.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`${styles.button} ${soloConAlertas ? styles.buttonPrimary : ''}`}
            type="button"
            onClick={() => setSoloConAlertas(v => !v)}
            disabled={conAlertas === 0}
          >
            {soloConAlertas ? '✓ ' : ''}Con alertas ({conAlertas})
          </button>
          <button className={styles.button} type="button" onClick={() => void cargar()} disabled={cargando}>
            {cargando ? '…' : '↻'}
          </button>
        </div>
      </div>

      {error && <div className={styles.message}>{error}</div>}

      {cargando ? (
        <div className={styles.help}>Cargando rondas…</div>
      ) : visibles.length === 0 ? (
        <div className={styles.help}>
          {filas.length === 0
            ? 'No hay rondas configuradas en tu alcance.'
            : 'Ninguna ronda tiene alertas pendientes.'}
        </div>
      ) : (
        <div className={styles.list}>
          {visibles.map(f => (
            <div className={styles.row} key={f.rondaId}>
              <div className={styles.rowMain}>
                <div className={styles.name}>
                  {f.objetivoNombre} · {f.nombre}
                </div>
                <div className={styles.meta}>
                  Puesto: {f.puestoNombre} · {presentarIntervalo(f.intervaloMinutos)} ·{' '}
                  {f.cantidadPuntos} {f.cantidadPuntos === 1 ? 'punto activo' : 'puntos activos'}
                </div>
                <div className={styles.help}>{etiquetaHoraInicioRonda(f.horaInicio)}</div>
                <div className={styles.help}>
                  {f.ultimaEjecucion
                    ? `Última ejecución: ${formatFechaHora(f.ultimaEjecucion)}`
                    : 'Sin ejecuciones registradas'}
                </div>
              </div>
              {f.alertasPendientes > 0 && (
                <span className={`${styles.statusBadge} ${styles.statusUnknown}`}>
                  {f.alertasPendientes} {f.alertasPendientes === 1 ? 'alerta' : 'alertas'}
                </span>
              )}
              <span className={`${styles.statusBadge} ${f.activo ? styles.statusGps : styles.statusUnknown}`}>
                {f.activo ? 'Activa' : 'Inactiva'}
              </span>
              <button className={styles.button} type="button" onClick={() => setAdministrando(f)}>
                Ver / Administrar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
