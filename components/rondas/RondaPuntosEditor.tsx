'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  agregarPunto,
  actualizarPunto,
  desactivarPunto,
  obtenerRondaConPuntos,
  reordenarPuntos,
} from '@/lib/rondas'
import type { NuevoRondaPunto, RondaPunto } from '@/lib/rondas'
import styles from './Rondas.module.css'

interface Props {
  rondaBaseId: string
  onCambio: () => void
}

interface PuntoForm {
  nombre: string
  descripcion: string
  foto_requerida: boolean
  gps_requerido: boolean
  latitud: string
  longitud: string
  precision_metros: string
  radio_metros: string
  activo: boolean
}

const FORM_VACIO: PuntoForm = {
  nombre: '',
  descripcion: '',
  foto_requerida: true,
  gps_requerido: true,
  latitud: '',
  longitud: '',
  precision_metros: '',
  radio_metros: '30',
  activo: true,
}

function formDesdePunto(punto: RondaPunto): PuntoForm {
  return {
    nombre: punto.nombre,
    descripcion: punto.descripcion ?? '',
    foto_requerida: punto.foto_requerida,
    gps_requerido: punto.gps_requerido,
    latitud: punto.latitud?.toString() ?? '',
    longitud: punto.longitud?.toString() ?? '',
    precision_metros: punto.precision_metros?.toString() ?? '',
    radio_metros: punto.radio_metros?.toString() ?? '',
    activo: punto.activo,
  }
}

function numeroOpcional(valor: string): number | null {
  if (!valor.trim()) return null
  const numero = Number(valor)
  return Number.isFinite(numero) ? numero : null
}

export default function RondaPuntosEditor({ rondaBaseId, onCambio }: Props) {
  const [puntos, setPuntos] = useState<RondaPunto[]>([])
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [editandoId, setEditandoId] = useState<string | 'nuevo' | null>(null)
  const [form, setForm] = useState<PuntoForm>(FORM_VACIO)
  const [error, setError] = useState('')
  const [gpsEstado, setGpsEstado] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true)
    const resultado = await obtenerRondaConPuntos(rondaBaseId)
    if (resultado.error) {
      setError(resultado.error)
    } else {
      setPuntos(resultado.data.puntos)
      setError('')
    }
    setCargando(false)
  }, [rondaBaseId])

  useEffect(() => { void cargar() }, [cargar])

  const abrirNuevo = () => {
    setForm(FORM_VACIO)
    setEditandoId('nuevo')
    setError('')
    setGpsEstado('')
  }

  const abrirEdicion = (punto: RondaPunto) => {
    setForm(formDesdePunto(punto))
    setEditandoId(punto.id)
    setError('')
    setGpsEstado('')
  }

  const obtenerGps = () => {
    if (!navigator.geolocation) {
      setGpsEstado('Este dispositivo no ofrece ubicación GPS.')
      return
    }

    setGpsEstado('Obteniendo ubicación…')
    navigator.geolocation.getCurrentPosition(
      posicion => {
        setForm(actual => ({
          ...actual,
          latitud: posicion.coords.latitude.toFixed(7),
          longitud: posicion.coords.longitude.toFixed(7),
          precision_metros: Math.round(posicion.coords.accuracy).toString(),
        }))
        setGpsEstado(`Ubicación obtenida con precisión aproximada de ${Math.round(posicion.coords.accuracy)} m.`)
      },
      fallo => {
        const mensaje = fallo.code === fallo.PERMISSION_DENIED
          ? 'Permiso de ubicación denegado. Podés habilitarlo y volver a intentar.'
          : 'No se pudo obtener una ubicación confiable. Volvé a intentar al aire libre.'
        setGpsEstado(mensaje)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }

  const guardar = async () => {
    if (!editandoId || guardando) return
    setGuardando(true)
    setError('')

    const camposNumericos = [
      ['latitud', form.latitud],
      ['longitud', form.longitud],
      ['precisión', form.precision_metros],
      ['radio', form.radio_metros],
    ] as const
    const campoInvalido = camposNumericos.find(([, valor]) => valor.trim() && !Number.isFinite(Number(valor)))
    if (campoInvalido) {
      setError(`El valor de ${campoInvalido[0]} no es numérico.`)
      setGuardando(false)
      return
    }

    const datos: NuevoRondaPunto = {
      nombre: form.nombre,
      descripcion: form.descripcion,
      foto_requerida: form.foto_requerida,
      gps_requerido: form.gps_requerido,
      latitud: numeroOpcional(form.latitud),
      longitud: numeroOpcional(form.longitud),
      precision_metros: numeroOpcional(form.precision_metros),
      radio_metros: numeroOpcional(form.radio_metros),
      activo: form.activo,
    }

    const resultado = editandoId === 'nuevo'
      ? await agregarPunto(rondaBaseId, datos)
      : await actualizarPunto(editandoId, datos)

    if (resultado.error) {
      setError(resultado.error)
    } else {
      setEditandoId(null)
      await cargar()
      onCambio()
    }
    setGuardando(false)
  }

  const desactivar = async (punto: RondaPunto) => {
    if (!window.confirm(`¿Desactivar el punto "${punto.nombre}"? No se borrará físicamente.`)) return
    setGuardando(true)
    const resultado = await desactivarPunto(punto.id)
    if (resultado.error) setError(resultado.error)
    else {
      await cargar()
      onCambio()
    }
    setGuardando(false)
  }

  const mover = async (indice: number, direccion: -1 | 1) => {
    const destino = indice + direccion
    if (destino < 0 || destino >= puntos.length || guardando) return

    const nuevos = [...puntos]
    ;[nuevos[indice], nuevos[destino]] = [nuevos[destino], nuevos[indice]]
    setPuntos(nuevos)
    setGuardando(true)
    const resultado = await reordenarPuntos(rondaBaseId, nuevos.map(punto => punto.id))
    if (resultado.error) {
      setError(resultado.error)
      await cargar()
    } else {
      await cargar()
      onCambio()
    }
    setGuardando(false)
  }

  return (
    <div className={styles.editor}>
      <div className={styles.pointHeader} style={{ marginTop: 18, marginBottom: 10 }}>
        <div>
          <div className={styles.name}>Puntos de control</div>
          <div className={styles.help}>El orden incluye puntos inactivos para preservar una secuencia estable.</div>
        </div>
        <button className={`${styles.button} ${styles.buttonPrimary}`} type="button" onClick={abrirNuevo} disabled={guardando}>
          Agregar punto
        </button>
      </div>

      {error && <div className={styles.message}>{error}</div>}
      {cargando ? (
        <div className={styles.help}>Cargando puntos…</div>
      ) : puntos.length === 0 ? (
        <div className={styles.help}>La ronda todavía no tiene puntos configurados.</div>
      ) : (
        <div className={styles.list}>
          {puntos.map((punto, indice) => (
            <div key={punto.id} className={`${styles.point} ${punto.activo ? '' : styles.pointInactive}`}>
              <div className={styles.row}>
                <div className={styles.orderButtons}>
                  <button className={styles.button} type="button" aria-label="Subir punto" onClick={() => void mover(indice, -1)} disabled={indice === 0 || guardando}>↑</button>
                  <button className={styles.button} type="button" aria-label="Bajar punto" onClick={() => void mover(indice, 1)} disabled={indice === puntos.length - 1 || guardando}>↓</button>
                </div>
                <div className={styles.rowMain}>
                  <div className={styles.name}>#{indice + 1} · {punto.nombre}</div>
                  <div className={styles.meta}>
                    {punto.foto_requerida ? 'Foto requerida' : 'Sin foto'} · {punto.gps_requerido ? 'GPS requerido' : 'GPS opcional'}
                    {punto.latitud !== null ? ` · ${punto.latitud.toFixed(5)}, ${punto.longitud?.toFixed(5)}` : ' · Sin coordenadas'}
                    {!punto.activo ? ' · Inactivo' : ''}
                  </div>
                </div>
                <div className={styles.actions}>
                  <button className={styles.button} type="button" onClick={() => abrirEdicion(punto)} disabled={guardando}>Editar</button>
                  {punto.activo && (
                    <button className={`${styles.button} ${styles.buttonDanger}`} type="button" onClick={() => void desactivar(punto)} disabled={guardando}>
                      Desactivar
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editandoId && (
        <div className={styles.point} style={{ marginTop: 12 }}>
          <div className={styles.name} style={{ marginBottom: 12 }}>
            {editandoId === 'nuevo' ? 'Nuevo punto' : 'Editar punto'}
          </div>
          <div className={styles.formGrid}>
            <div className={`${styles.field} ${styles.full}`}>
              <label htmlFor="ronda-punto-nombre">Nombre</label>
              <input id="ronda-punto-nombre" value={form.nombre} onChange={evento => setForm({ ...form, nombre: evento.target.value })} maxLength={120} />
            </div>
            <div className={`${styles.field} ${styles.full}`}>
              <label htmlFor="ronda-punto-descripcion">Descripción opcional</label>
              <textarea id="ronda-punto-descripcion" value={form.descripcion} onChange={evento => setForm({ ...form, descripcion: evento.target.value })} maxLength={500} />
            </div>
            <label className={styles.check}>
              <input type="checkbox" checked={form.foto_requerida} onChange={evento => setForm({ ...form, foto_requerida: evento.target.checked })} />
              Fotografía requerida
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={form.gps_requerido} onChange={evento => setForm({ ...form, gps_requerido: evento.target.checked })} />
              GPS requerido
            </label>
            <div className={styles.gpsBox}>
              <div className={styles.actions}>
                <button className={styles.button} type="button" onClick={obtenerGps} disabled={guardando}>Usar ubicación actual</button>
              </div>
              {gpsEstado && <div className={styles.help} style={{ marginTop: 6 }}>{gpsEstado}</div>}
            </div>
            <div className={styles.field}>
              <label htmlFor="ronda-punto-latitud">Latitud</label>
              <input id="ronda-punto-latitud" inputMode="decimal" value={form.latitud} onChange={evento => setForm({ ...form, latitud: evento.target.value })} />
            </div>
            <div className={styles.field}>
              <label htmlFor="ronda-punto-longitud">Longitud</label>
              <input id="ronda-punto-longitud" inputMode="decimal" value={form.longitud} onChange={evento => setForm({ ...form, longitud: evento.target.value })} />
            </div>
            <div className={styles.field}>
              <label htmlFor="ronda-punto-precision">Precisión registrada (m)</label>
              <input id="ronda-punto-precision" type="number" min="0" step="0.1" value={form.precision_metros} onChange={evento => setForm({ ...form, precision_metros: evento.target.value })} />
            </div>
            <div className={styles.field}>
              <label htmlFor="ronda-punto-radio">Radio permitido (m)</label>
              <input id="ronda-punto-radio" type="number" min="1" step="1" value={form.radio_metros} onChange={evento => setForm({ ...form, radio_metros: evento.target.value })} />
            </div>
            {editandoId !== 'nuevo' && (
              <label className={styles.check}>
                <input type="checkbox" checked={form.activo} onChange={evento => setForm({ ...form, activo: evento.target.checked })} />
                Punto activo
              </label>
            )}
          </div>
          <div className={styles.actions} style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button className={styles.button} type="button" onClick={() => setEditandoId(null)} disabled={guardando}>Cancelar</button>
            <button className={`${styles.button} ${styles.buttonPrimary}`} type="button" onClick={() => void guardar()} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar punto'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
