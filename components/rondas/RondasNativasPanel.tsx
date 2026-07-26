'use client'

import { useCallback, useEffect, useState } from 'react'
import { obtenerRondasPorObjetivo, presentarIntervalo } from '@/lib/rondas'
import type { RondaBaseResumen } from '@/lib/rondas'
import RondaBaseEditor from './RondaBaseEditor'
import styles from './Rondas.module.css'

interface Props {
  objetivoId: string
  centroObjetivo?: [number, number] | null
  puedeAdministrar: boolean
}

export default function RondasNativasPanel({
  objetivoId,
  centroObjetivo,
  puedeAdministrar,
}: Props) {
  const [rondas, setRondas] = useState<RondaBaseResumen[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [editando, setEditando] = useState<RondaBaseResumen | null | undefined>(undefined)

  const cargar = useCallback(async () => {
    setCargando(true)
    const resultado = await obtenerRondasPorObjetivo(objetivoId)
    if (resultado.error) {
      setError(resultado.error)
      setRondas([])
    } else {
      setRondas(resultado.data)
      setError('')
    }
    setCargando(false)
  }, [objetivoId])

  useEffect(() => {
    setEditando(undefined)
    void cargar()
  }, [cargar])

  return (
    <div className={styles.panel}>
      <div className={styles.header} style={{ marginBottom: 12 }}>
        <div>
          <div className={styles.name} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Rondas nativas</div>
          <div className={styles.help}>Configuración propia del objetivo, separada del historial JWM.</div>
        </div>
        {puedeAdministrar && editando === undefined && (
          <button className={`${styles.button} ${styles.buttonPrimary}`} type="button" onClick={() => setEditando(null)}>
            Nueva ronda
          </button>
        )}
      </div>

      {error && <div className={styles.message}>{error}</div>}

      {editando !== undefined ? (
        <RondaBaseEditor
          key={editando?.id ?? 'nueva'}
          objetivoId={objetivoId}
          centroObjetivo={centroObjetivo}
          rondaInicial={editando}
          onCerrar={() => {
            setEditando(undefined)
            void cargar()
          }}
          onCambio={() => void cargar()}
        />
      ) : cargando ? (
        <div className={styles.help}>Cargando rondas configuradas…</div>
      ) : rondas.length === 0 ? (
        <div className={styles.help}>Este objetivo todavía no tiene rondas nativas configuradas.</div>
      ) : (
        <div className={styles.list}>
          {rondas.map(ronda => (
            <div className={styles.row} key={ronda.id}>
              <div className={styles.rowMain}>
                <div className={styles.name}>{ronda.nombre}</div>
                <div className={styles.meta}>
                  {presentarIntervalo(ronda.intervalo_minutos)} · {ronda.cantidad_puntos} {ronda.cantidad_puntos === 1 ? 'punto activo' : 'puntos activos'} · Versión {ronda.version}
                </div>
                {ronda.descripcion && <div className={styles.help}>{ronda.descripcion}</div>}
              </div>
              <span
                style={{
                  alignSelf: 'center',
                  background: ronda.activo ? '#052e16' : '#1e293b',
                  border: `1px solid ${ronda.activo ? '#166534' : '#475569'}`,
                  borderRadius: 6,
                  color: ronda.activo ? '#86efac' : '#94a3b8',
                  fontSize: 11,
                  padding: '4px 8px',
                }}
              >
                {ronda.activo ? 'Activa' : 'Inactiva'}
              </span>
              {puedeAdministrar && (
                <button className={styles.button} type="button" onClick={() => setEditando(ronda)}>
                  Administrar
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
