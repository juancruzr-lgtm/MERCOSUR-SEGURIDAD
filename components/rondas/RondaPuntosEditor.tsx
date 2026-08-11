'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  agregarPunto,
  actualizarPunto,
  desactivarPunto,
  obtenerRondaConPuntos,
  reordenarPuntos,
  puntoDuplicadoCercano,
  distanciaMetros,
  RONDA_PUNTO_DISTANCIA_MINIMA,
  MENSAJE_RONDA_PUNTO_DUPLICADO,
} from '@/lib/rondas'
import { POLITICAS_FOTO, etiquetaPoliticaFoto, ayudaPoliticaFoto } from '@/lib/rondas'
import type { NuevoRondaPunto, OrigenPosicion, PoliticaFoto, RondaPunto } from '@/lib/rondas'
import { capturarGpsNuevo, type CapturaGpsEnCurso } from '@/lib/gps-captura'
import type { PuntoRondaMapa } from './RondaPuntosMap'
import ReferenciaPuntoIA from '@/components/ia/ReferenciaPuntoIA'
import styles from './Rondas.module.css'

const RondaPuntosMap = dynamic(() => import('./RondaPuntosMap'), {
  ssr: false,
  loading: () => <div className={styles.mapEmpty}>Cargando mapa…</div>,
})

// La captura con watchPosition vive en lib/gps-captura.ts, compartida con el
// registro de puntos del vigilador.
const MENSAJE_IPHONE_POSICION_ANTERIOR =
  'El iPhone sigue informando la posición anterior. Esperá unos segundos o desplazate a un lugar con mejor señal y volvé a capturar.'

interface Props {
  rondaBaseId: string
  centroObjetivo?: [number, number] | null
  onCambio: () => void
  onDirtyChange: (dirty: boolean) => void
}

interface PuntoForm {
  nombre: string
  descripcion: string
  politica_foto: PoliticaFoto
  gps_requerido: boolean
  latitud: string
  longitud: string
  precision_metros: string
  radio_metros: string
  origen_posicion: OrigenPosicion
  posicion_capturada_at: string | null
  activo: boolean
}

function crearFormVacio(): PuntoForm {
  return {
    nombre: '',
    descripcion: '',
    politica_foto: 'obligatoria',
    gps_requerido: true,
    latitud: '',
    longitud: '',
    precision_metros: '',
    radio_metros: '30',
    origen_posicion: null,
    posicion_capturada_at: null,
    activo: true,
  }
}

function formDesdePunto(punto: RondaPunto): PuntoForm {
  return {
    nombre: punto.nombre,
    descripcion: punto.descripcion ?? '',
    politica_foto: punto.politica_foto,
    gps_requerido: punto.gps_requerido,
    latitud: punto.latitud?.toString() ?? '',
    longitud: punto.longitud?.toString() ?? '',
    precision_metros: punto.precision_metros?.toString() ?? '',
    radio_metros: punto.radio_metros?.toString() ?? '',
    origen_posicion: punto.origen_posicion,
    posicion_capturada_at: punto.posicion_capturada_at ?? null,
    activo: punto.activo,
  }
}

function numeroOpcional(valor: string): number | null {
  if (!valor.trim()) return null
  const numero = Number(valor.trim().replace(',', '.'))
  return Number.isFinite(numero) ? numero : null
}

function coordenadasFormulario(form: Pick<PuntoForm, 'latitud' | 'longitud'>): [number, number] | null {
  const latitud = numeroOpcional(form.latitud)
  const longitud = numeroOpcional(form.longitud)
  if (
    latitud === null ||
    longitud === null ||
    latitud < -90 ||
    latitud > 90 ||
    longitud < -180 ||
    longitud > 180
  ) {
    return null
  }
  return [latitud, longitud]
}

function estadoPosicion(
  latitud: number | null,
  longitud: number | null,
  origen: OrigenPosicion,
): { texto: string; clase: string } {
  if (latitud === null || longitud === null) {
    return { texto: 'Sin posicionar', clase: styles.statusUnpositioned }
  }
  if (origen === 'gps') return { texto: 'Posición GPS', clase: styles.statusGps }
  if (origen === 'manual') return { texto: 'Posición manual', clase: styles.statusManual }
  return { texto: 'Origen no registrado', clase: styles.statusUnknown }
}

function formulariosIguales(a: PuntoForm | null, b: PuntoForm): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b)
}

export default function RondaPuntosEditor({
  rondaBaseId,
  centroObjetivo = null,
  onCambio,
  onDirtyChange,
}: Props) {
  const [puntos, setPuntos] = useState<RondaPunto[]>([])
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [editandoId, setEditandoId] = useState<string | 'nuevo' | null>(null)
  const [form, setForm] = useState<PuntoForm>(crearFormVacio)
  const [formInicial, setFormInicial] = useState<PuntoForm | null>(null)
  const [ajusteMapa, setAjusteMapa] = useState(false)
  const [esMovil, setEsMovil] = useState(false)
  const [interaccionMapa, setInteraccionMapa] = useState(false)
  const [error, setError] = useState('')
  const [gpsEstado, setGpsEstado] = useState('')
  const [capturandoGps, setCapturandoGps] = useState(false)

  // Captura en curso + posición que tenía el formulario antes de capturar.
  const capturaGpsRef = useRef<CapturaGpsEnCurso | null>(null)
  const posicionAnteriorRef = useRef<{ lat: number; lng: number } | null>(null)

  // Corta la captura activa (sin tocar estado React, para poder llamarse también
  // en el desmontaje).
  const limpiarWatch = useCallback(() => {
    capturaGpsRef.current?.cancelar()
    capturaGpsRef.current = null
  }, [])

  const hayCambiosPendientes =
    editandoId !== null && !formulariosIguales(formInicial, form)

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

  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)')
    const actualizar = () => {
      setEsMovil(media.matches)
      setInteraccionMapa(!media.matches)
      if (media.matches) setAjusteMapa(false)
    }
    actualizar()
    media.addEventListener('change', actualizar)
    return () => media.removeEventListener('change', actualizar)
  }, [])

  useEffect(() => onDirtyChange(hayCambiosPendientes), [hayCambiosPendientes, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  // Cortar cualquier watchPosition activo al desmontar el componente.
  useEffect(() => limpiarWatch, [limpiarWatch])

  useEffect(() => {
    if (!hayCambiosPendientes) return
    const advertirSalida = (evento: BeforeUnloadEvent) => {
      evento.preventDefault()
      evento.returnValue = ''
    }
    window.addEventListener('beforeunload', advertirSalida)
    return () => window.removeEventListener('beforeunload', advertirSalida)
  }, [hayCambiosPendientes])

  const confirmarDescarte = (): boolean =>
    !hayCambiosPendientes ||
    window.confirm('Hay cambios del punto sin guardar. ¿Querés descartarlos?')

  const iniciarFormulario = (id: string | 'nuevo', siguiente: PuntoForm) => {
    limpiarWatch()
    setCapturandoGps(false)
    posicionAnteriorRef.current = null
    setForm(siguiente)
    setFormInicial({ ...siguiente })
    setEditandoId(id)
    setAjusteMapa(false)
    setError('')
    setGpsEstado('')
  }

  const abrirNuevo = () => {
    if (!confirmarDescarte()) return
    iniciarFormulario('nuevo', crearFormVacio())
  }

  const abrirEdicion = (punto: RondaPunto) => {
    if (editandoId === punto.id) return
    if (!confirmarDescarte()) return
    iniciarFormulario(punto.id, formDesdePunto(punto))
  }

  const cancelarEdicion = () => {
    if (!confirmarDescarte()) return
    limpiarWatch()
    setCapturandoGps(false)
    setEditandoId(null)
    setFormInicial(null)
    setAjusteMapa(false)
    setGpsEstado('')
    setError('')
  }

  const cambiarCoordenada = (campo: 'latitud' | 'longitud', valor: string) => {
    limpiarWatch()
    setCapturandoGps(false)
    setForm(actual => {
      const siguiente = { ...actual, [campo]: valor, precision_metros: '' }
      const sinCoordenadas = !siguiente.latitud.trim() && !siguiente.longitud.trim()
      siguiente.origen_posicion = sinCoordenadas ? null : 'manual'
      siguiente.posicion_capturada_at = sinCoordenadas ? null : new Date().toISOString()
      return siguiente
    })
    setGpsEstado('')
  }

  // Aplica la mejor lectura al formulario y avisa si el iPhone repitió una
  // posición anterior (misma del formulario o coincidente con otro punto).
  const aplicarLecturaGps = useCallback((posicion: GeolocationPosition) => {
    const latitud = posicion.coords.latitude
    const longitud = posicion.coords.longitude
    const accuracy = Math.round(posicion.coords.accuracy)
    const capturadaAt = new Date(posicion.timestamp)

    setForm(actual => ({
      ...actual,
      latitud: latitud.toFixed(7),
      longitud: longitud.toFixed(7),
      precision_metros: accuracy.toString(),
      origen_posicion: 'gps',
      posicion_capturada_at: capturadaAt.toISOString(),
    }))

    const anterior = posicionAnteriorRef.current
    const coincideAnterior = anterior
      ? distanciaMetros(latitud, longitud, anterior.lat, anterior.lng) < RONDA_PUNTO_DISTANCIA_MINIMA
      : false
    const coincideOtroPunto = puntoDuplicadoCercano(
      latitud, longitud, puntos,
      editandoId === 'nuevo' ? undefined : editandoId ?? undefined,
    ) !== null

    // `hour12: false` explícito: 'es-AR' con ICU reciente devuelve "p. m.".
    const hora = capturadaAt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    if (coincideAnterior || coincideOtroPunto) {
      setGpsEstado(MENSAJE_IPHONE_POSICION_ANTERIOR)
    } else {
      setGpsEstado(`Ubicación nueva capturada · precisión ${accuracy} m · ${hora}`)
    }
  }, [puntos, editandoId])

  const obtenerGps = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsEstado('Este dispositivo no ofrece ubicación GPS.')
      return
    }

    // Cortar cualquier captura previa y limpiar la posición: cada punto exige una
    // lectura GPS NUEVA; una lectura fallida no debe dejar coordenadas viejas.
    limpiarWatch()

    setForm(actual => {
      const prevLat = numeroOpcional(actual.latitud)
      const prevLng = numeroOpcional(actual.longitud)
      posicionAnteriorRef.current =
        prevLat !== null && prevLng !== null ? { lat: prevLat, lng: prevLng } : null
      return {
        ...actual,
        latitud: '',
        longitud: '',
        precision_metros: '',
        origen_posicion: null,
        posicion_capturada_at: null,
      }
    })
    setCapturandoGps(true)
    setGpsEstado('Buscando una ubicación GPS nueva…')

    const captura = capturarGpsNuevo({
      onProgreso: precision => {
        setGpsEstado(`Buscando una ubicación GPS nueva… (precisión ${Math.round(precision)} m)`)
      },
    })
    capturaGpsRef.current = captura

    void captura.promesa.then(resultado => {
      // Otra captura la reemplazó, o el editor se desmontó.
      if (capturaGpsRef.current !== captura) return
      capturaGpsRef.current = null
      setCapturandoGps(false)

      if (resultado.ok) {
        aplicarLecturaGps(resultado.posicion)
        return
      }
      setGpsEstado(
        resultado.motivo === 'sin_soporte'
          ? 'Este dispositivo no ofrece ubicación GPS.'
          : resultado.motivo === 'permiso_denegado'
            ? 'Permiso de ubicación denegado. Podés habilitarlo y volver a intentar.'
            : 'No se pudo obtener una ubicación nueva. Esperá unos segundos al aire libre y volvé a intentar.',
      )
    })
  }, [limpiarWatch, aplicarLecturaGps])

  const moverDesdeMapa = (latitud: number, longitud: number) => {
    limpiarWatch()
    setCapturandoGps(false)
    setForm(actual => ({
      ...actual,
      latitud: latitud.toFixed(7),
      longitud: longitud.toFixed(7),
      precision_metros: '',
      origen_posicion: 'manual',
      posicion_capturada_at: new Date().toISOString(),
    }))
    setGpsEstado('Posición definida MANUALMENTE en el mapa (sin GPS). La precisión GPS fue eliminada.')
  }

  const guardar = async () => {
    if (!editandoId || guardando) return
    if (capturandoGps) {
      setError('Esperá a que termine la captura de GPS antes de guardar.')
      return
    }
    setGuardando(true)
    setError('')

    const camposNumericos = [
      ['latitud', form.latitud],
      ['longitud', form.longitud],
      ['precisión', form.precision_metros],
      ['radio', form.radio_metros],
    ] as const
    const campoInvalido = camposNumericos.find(([, valor]) => valor.trim() && numeroOpcional(valor) === null)
    if (campoInvalido) {
      setError(`El valor de ${campoInvalido[0]} no es numérico.`)
      setGuardando(false)
      return
    }

    const latitud = numeroOpcional(form.latitud)
    const longitud = numeroOpcional(form.longitud)
    const sinCoordenadas = latitud === null && longitud === null

    // Anti-duplicado inmediato (el servidor lo valida igual, no se puede omitir).
    if (!sinCoordenadas && form.activo && latitud !== null && longitud !== null) {
      const conflicto = puntoDuplicadoCercano(
        latitud, longitud, puntos,
        editandoId === 'nuevo' ? undefined : editandoId ?? undefined,
      )
      if (conflicto) {
        setError(MENSAJE_RONDA_PUNTO_DUPLICADO)
        setGuardando(false)
        return
      }
    }

    const datos: NuevoRondaPunto = {
      nombre: form.nombre,
      descripcion: form.descripcion,
      politica_foto: form.politica_foto,
      gps_requerido: form.gps_requerido,
      latitud,
      longitud,
      precision_metros: sinCoordenadas ? null : numeroOpcional(form.precision_metros),
      radio_metros: numeroOpcional(form.radio_metros),
      origen_posicion: sinCoordenadas ? null : form.origen_posicion,
      posicion_capturada_at: sinCoordenadas ? null : form.posicion_capturada_at,
      activo: form.activo,
    }

    const resultado = editandoId === 'nuevo'
      ? await agregarPunto(rondaBaseId, datos)
      : await actualizarPunto(editandoId, datos)

    if (resultado.error) {
      setError(resultado.error)
    } else {
      setEditandoId(null)
      setFormInicial(null)
      setAjusteMapa(false)
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

  const puntosMapa = useMemo<PuntoRondaMapa[]>(() => {
    const base = puntos.map(punto => ({
      id: punto.id,
      nombre: punto.nombre,
      orden: punto.orden,
      latitud: punto.latitud,
      longitud: punto.longitud,
      radio_metros: punto.radio_metros,
      origen_posicion: punto.origen_posicion,
    }))
    if (!editandoId) return base

    const coordenadas = coordenadasFormulario(form)
    const borrador: PuntoRondaMapa = {
      id: editandoId,
      nombre: form.nombre.trim() || (editandoId === 'nuevo' ? 'Nuevo punto' : 'Punto sin nombre'),
      orden: editandoId === 'nuevo'
        ? puntos.length + 1
        : puntos.find(punto => punto.id === editandoId)?.orden ?? puntos.length + 1,
      latitud: coordenadas?.[0] ?? null,
      longitud: coordenadas?.[1] ?? null,
      radio_metros: numeroOpcional(form.radio_metros),
      origen_posicion: coordenadas ? form.origen_posicion : null,
    }

    if (editandoId === 'nuevo') return [...base, borrador]
    return base.map(punto => punto.id === editandoId ? borrador : punto)
  }, [editandoId, form, puntos])

  const coordenadasEditadasCompletas =
    editandoId !== null && coordenadasFormulario(form) !== null

  return (
    <div className={styles.editor}>
      <div className={styles.pointHeader}>
        <div>
          <div className={styles.name}>Puntos de control</div>
          <div className={styles.help}>El orden incluye puntos inactivos para preservar una secuencia estable.</div>
        </div>
        <button className={`${styles.button} ${styles.buttonPrimary}`} type="button" onClick={abrirNuevo} disabled={guardando}>
          Agregar punto
        </button>
      </div>

      {error && <div className={styles.message}>{error}</div>}

      <div className={styles.pointsWorkspace}>
        <div className={styles.pointsColumn}>
          {cargando ? (
            <div className={styles.help}>Cargando puntos…</div>
          ) : puntos.length === 0 ? (
            <div className={styles.help}>La ronda todavía no tiene puntos configurados.</div>
          ) : (
            <div className={styles.list}>
              {puntos.map((punto, indice) => {
                const estado = estadoPosicion(punto.latitud, punto.longitud, punto.origen_posicion)
                const seleccionado = editandoId === punto.id
                return (
                  <div
                    key={punto.id}
                    className={`${styles.point} ${punto.activo ? '' : styles.pointInactive} ${seleccionado ? styles.pointSelected : ''}`}
                  >
                    <div className={styles.row}>
                      <div className={styles.orderButtons}>
                        <button className={styles.button} type="button" aria-label="Subir punto" onClick={() => void mover(indice, -1)} disabled={indice === 0 || guardando}>↑</button>
                        <button className={styles.button} type="button" aria-label="Bajar punto" onClick={() => void mover(indice, 1)} disabled={indice === puntos.length - 1 || guardando}>↓</button>
                      </div>
                      <div className={styles.rowMain}>
                        <div className={styles.name}>#{punto.orden} · {punto.nombre}</div>
                        <div className={styles.statusRow}>
                          <span className={`${styles.statusBadge} ${estado.clase}`}>{estado.texto}</span>
                          {!punto.activo && <span className={`${styles.statusBadge} ${styles.statusUnknown}`}>Inactivo</span>}
                        </div>
                        <div className={styles.meta}>
                          {etiquetaPoliticaFoto(punto.politica_foto)} · {punto.gps_requerido ? 'GPS requerido' : 'GPS opcional'}
                          {punto.latitud !== null ? ` · ${punto.latitud.toFixed(5)}, ${punto.longitud?.toFixed(5)}` : ''}
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
                )
              })}
            </div>
          )}

          {editandoId && (
            <div className={`${styles.point} ${styles.editForm}`}>
              <div className={styles.name}>
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
                <div className={`${styles.field} ${styles.full}`}>
                  <label htmlFor="ronda-punto-politica-foto">Fotografía</label>
                  <select
                    id="ronda-punto-politica-foto"
                    value={form.politica_foto}
                    onChange={evento => setForm({ ...form, politica_foto: evento.target.value as PoliticaFoto })}
                  >
                    {POLITICAS_FOTO.map(politica => (
                      <option key={politica} value={politica}>{etiquetaPoliticaFoto(politica)}</option>
                    ))}
                  </select>
                  <small>{ayudaPoliticaFoto(form.politica_foto)}</small>
                </div>
                <label className={styles.check}>
                  <input type="checkbox" checked={form.gps_requerido} onChange={evento => setForm({ ...form, gps_requerido: evento.target.checked })} />
                  GPS requerido
                </label>
                <div className={styles.gpsBox}>
                  <div className={styles.gpsControls}>
                    <button
                      className={`${styles.button} ${styles.buttonPrimary}`}
                      type="button"
                      onClick={obtenerGps}
                      disabled={guardando || capturandoGps}
                    >
                      {capturandoGps
                        ? 'Buscando GPS…'
                        : coordenadasEditadasCompletas ? 'Actualizar GPS' : 'Usar ubicación actual'}
                    </button>
                    <button
                      className={`${styles.button} ${ajusteMapa ? styles.buttonActive : ''}`}
                      type="button"
                      onClick={() => {
                        setAjusteMapa(actual => {
                          const siguiente = !actual
                          if (siguiente) setInteraccionMapa(true)
                          return siguiente
                        })
                      }}
                      disabled={guardando || capturandoGps || !coordenadasEditadasCompletas}
                    >
                      {ajusteMapa ? 'Finalizar ajuste' : 'Ajustar en mapa'}
                    </button>
                  </div>
                  {gpsEstado && <div className={styles.help}>{gpsEstado}</div>}
                  {ajusteMapa && (
                    <div className={styles.mapNotice}>
                      La nueva posición se guardará al presionar Guardar punto.
                    </div>
                  )}
                </div>
                <div className={styles.field}>
                  <label htmlFor="ronda-punto-latitud">Latitud</label>
                  <input id="ronda-punto-latitud" inputMode="decimal" value={form.latitud} onChange={evento => cambiarCoordenada('latitud', evento.target.value)} />
                </div>
                <div className={styles.field}>
                  <label htmlFor="ronda-punto-longitud">Longitud</label>
                  <input id="ronda-punto-longitud" inputMode="decimal" value={form.longitud} onChange={evento => cambiarCoordenada('longitud', evento.target.value)} />
                </div>
                <div className={styles.field}>
                  <label htmlFor="ronda-punto-precision">Precisión GPS registrada (m)</label>
                  <input id="ronda-punto-precision" type="number" value={form.precision_metros} readOnly />
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
                {/* Referencia IA: sólo sobre un punto ya existente — necesita su id.
                    Escribe únicamente en ronda_punto_referencias; no altera el punto. */}
                {editandoId && editandoId !== 'nuevo' && (
                  <div className={styles.full}>
                    <ReferenciaPuntoIA rondaPuntoId={editandoId} />
                  </div>
                )}
              </div>
              <div className={styles.formActions}>
                <button className={styles.button} type="button" onClick={cancelarEdicion} disabled={guardando}>Cancelar</button>
                <button className={`${styles.button} ${styles.buttonPrimary}`} type="button" onClick={() => void guardar()} disabled={guardando || capturandoGps}>
                  {guardando ? 'Guardando…' : 'Guardar punto'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className={styles.mapColumn}>
          <div className={styles.mapHeader}>
            <div>
              <div className={styles.name}>Mapa de puntos</div>
              <div className={styles.help}>Seleccioná un marcador para editar el punto.</div>
            </div>
            {esMovil && (
              <button
                className={`${styles.button} ${interaccionMapa ? styles.buttonActive : ''}`}
                type="button"
                onClick={() => {
                  setInteraccionMapa(actual => {
                    if (actual) setAjusteMapa(false)
                    return !actual
                  })
                }}
              >
                {interaccionMapa ? 'Salir del mapa' : 'Interactuar con mapa'}
              </button>
            )}
          </div>
          <RondaPuntosMap
            puntos={puntosMapa}
            puntoSeleccionadoId={editandoId}
            ajusteHabilitado={ajusteMapa}
            interaccionHabilitada={interaccionMapa}
            centroObjetivo={centroObjetivo}
            onSeleccionar={puntoId => {
              if (puntoId === 'nuevo') return
              const punto = puntos.find(actual => actual.id === puntoId)
              if (punto) abrirEdicion(punto)
            }}
            onMover={moverDesdeMapa}
          />
          <div className={styles.mapLegend}>
            <span><i className={styles.legendUnpositioned} />Sin posicionar</span>
            <span><i className={styles.legendGps} />GPS</span>
            <span><i className={styles.legendManual} />Manual</span>
            <span><i className={styles.legendUnknown} />Origen no registrado</span>
          </div>
        </div>
      </div>
    </div>
  )
}
