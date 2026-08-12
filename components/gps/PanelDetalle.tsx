'use client'

//
// Panel lateral de la Página GPS.
//
// Es presentación. La única consulta que hace por su cuenta es la URL firmada de
// la foto de referencia, y sólo cuando ya hay un punto seleccionado: nunca
// durante la carga del mapa.
//
// Las acciones (analizar, aplicar, ver marcaciones) las ejecuta la página; acá
// sólo se disparan. Objetivos, fichajes y supervisiones son de SÓLO LECTURA y no
// tienen ninguna acción de escritura, a propósito.
//

import { useEffect, useState } from 'react'
import { urlFotoReferencia, etiquetaDiagnostico, proponeCambio, type PuntoRondaGps } from '@/lib/gps-mapa'
import styles from './Gps.module.css'

export type SeleccionGps =
  | { tipo: 'objetivo'; datos: any }
  | { tipo: 'fichaje'; datos: any }
  | { tipo: 'supervision'; datos: any }
  | { tipo: 'punto'; datos: PuntoRondaGps }

function Fila({ label, valor }: { label: string; valor: React.ReactNode }) {
  return (
    <div className={styles.fila}>
      <span className={styles.filaLabel}>{label}</span>
      <span className={styles.filaValor}>{valor}</span>
    </div>
  )
}

function coordenada(lat: number | null, lng: number | null): string {
  if (lat === null || lng === null) return '—'
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`
}

export default function PanelDetalle({
  seleccion,
  marcacionesVisibles,
  cargandoMarcaciones,
  analizando,
  aplicando,
  mensaje,
  error,
  onAnalizar,
  onAplicar,
  onVerMarcaciones,
  onOcultarMarcaciones,
  onCerrar,
}: {
  seleccion: SeleccionGps | null
  marcacionesVisibles: boolean
  cargandoMarcaciones: boolean
  analizando: boolean
  aplicando: boolean
  mensaje: string
  error: string
  onAnalizar: (punto: PuntoRondaGps) => void
  onAplicar: (punto: PuntoRondaGps) => void
  onVerMarcaciones: (punto: PuntoRondaGps) => void
  onOcultarMarcaciones: () => void
  onCerrar: () => void
}) {
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [ampliada, setAmpliada] = useState(false)

  const referenciaId = seleccion?.tipo === 'punto' ? seleccion.datos.referenciaId : null

  // La foto se resuelve recién acá, para un solo punto y sólo si existe.
  useEffect(() => {
    let vigente = true
    setFotoUrl(null)
    setAmpliada(false)
    if (!referenciaId) return
    ;(async () => {
      const url = await urlFotoReferencia(referenciaId)
      if (vigente) setFotoUrl(url)
    })()
    return () => { vigente = false }
  }, [referenciaId])

  if (!seleccion) {
    return (
      <div className={styles.panel}>
        <div className={styles.vacio}>
          Tocá un marcador del mapa para ver su detalle.<br />
          Los puntos de ronda además muestran el diagnóstico GPS.
        </div>
      </div>
    )
  }

  return (
    <div className={styles.panel}>
      {error && <div className={styles.error}>{error}</div>}
      {mensaje && <div className={styles.ok}>{mensaje}</div>}

      {/* ── OBJETIVO — sólo lectura ─────────────────────────────────────── */}
      {seleccion.tipo === 'objetivo' && (() => {
        const o = seleccion.datos
        return (
          <>
            <div className={styles.panelTitulo}>{o.nombre}</div>
            <div className={styles.panelTipo}>Objetivo</div>
            <Fila label="Cliente" valor={o.cliente || '—'} />
            <Fila label="Dirección" valor={o.direccion || '—'} />
            <Fila label="Coordenadas" valor={coordenada(o.lat ?? null, o.lng ?? null)} />
            <Fila label="Radio" valor={o.radio_metros ? `${o.radio_metros} m` : '—'} />
            <Fila label="Estado" valor={o.estado || '—'} />
            <div className={styles.soloLectura}>
              La ubicación y el radio del objetivo son de sólo lectura desde acá.
              Todavía no existe auditoría de cambios GPS de objetivos, así que se
              siguen editando desde el legajo del objetivo, donde ya se hacía.
            </div>
          </>
        )
      })()}

      {/* ── FICHAJE — evidencia ─────────────────────────────────────────── */}
      {seleccion.tipo === 'fichaje' && (() => {
        const m = seleccion.datos
        return (
          <>
            <div className={styles.panelTitulo}>{m.empleado}</div>
            <div className={styles.panelTipo}>{m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}</div>
            <Fila label="Objetivo" valor={m.objetivo} />
            <Fila label="Fecha" valor={m.fecha} />
            <Fila label="Hora" valor={m.hora} />
            <Fila label="Coordenada" valor={`${m.lat.toFixed(6)}, ${m.lng.toFixed(6)}`} />
            <Fila label="Distancia" valor={m.distancia} />
            <Fila label="Precisión GPS" valor={m.precision} />
            <Fila label="Estado GPS" valor={m.estado} />
            <Fila label="Tipo de registro" valor={m.tipoRegistro} />
            <div className={styles.soloLectura}>
              Un fichaje es evidencia de lo que pasó: no se mueve ni se edita
              desde el mapa.
            </div>
          </>
        )
      })()}

      {/* ── SUPERVISIÓN — evidencia ─────────────────────────────────────── */}
      {seleccion.tipo === 'supervision' && (() => {
        const s = seleccion.datos
        return (
          <>
            <div className={styles.panelTitulo}>{s.supervisor}</div>
            <div className={styles.panelTipo}>Supervisión</div>
            <Fila label="Objetivo" valor={s.objetivo} />
            <Fila label="Fecha/hora" valor={s.fecha} />
            <Fila label="Coordenada" valor={`${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}`} />
            <Fila label="Distancia al objetivo" valor={s.distancia} />
            <Fila label="Precisión GPS" valor={s.precision} />
            <Fila label="Dentro del radio" valor={s.dentroRadio === null ? '—' : s.dentroRadio ? 'Sí' : 'No'} />
            <Fila label="Estado" valor={s.estado} />
            <div className={styles.soloLectura}>
              Fuera de radio y GPS impreciso no son lo mismo: la precisión dice
              cuánto se puede confiar en la coordenada, la distancia dice dónde
              estaba. Es evidencia y no se edita.
            </div>
          </>
        )
      })()}

      {/* ── PUNTO DE RONDA — configuración ──────────────────────────────── */}
      {seleccion.tipo === 'punto' && (() => {
        const p = seleccion.datos
        const etiqueta = etiquetaDiagnostico(p.diagnosticoEstado)
        const hayRecomendacion = proponeCambio(p.diagnosticoEstado)
        const claseDiagnostico = hayRecomendacion
          ? styles.diagnosticoAlerta
          : p.diagnosticoEstado === 'sin_cambios'
            ? styles.diagnosticoOk
            : styles.diagnosticoNeutro

        return (
          <>
            <div className={styles.panelTitulo}>{p.nombre}</div>
            <div className={styles.panelTipo}>Punto de ronda</div>

            <Fila label="Objetivo" valor={p.objetivoNombre} />
            <Fila label="Ronda" valor={p.rondaNombre} />
            <Fila label="Puesto" valor={p.puestoNombre ?? '—'} />
            <Fila label="Coordenadas" valor={coordenada(p.latitud, p.longitud)} />
            <Fila label="Radio actual" valor={p.radioMetros !== null ? `${p.radioMetros} m` : '—'} />
            <Fila label="GPS requerido" valor={p.gpsRequerido ? 'Sí' : 'No'} />
            <Fila
              label="Incumplimientos seguidos"
              valor={p.incumplimientosConsecutivos > 0
                ? `${p.incumplimientosConsecutivos}`
                : 'ninguno'}
            />
            {p.fotoControlProximaVisita && (
              <Fila label="Próxima visita" valor="Exige foto de control" />
            )}
            <Fila label="Foto de referencia" valor={p.referenciaId ? 'Tiene' : 'No tiene'} />

            <div className={`${styles.diagnostico} ${claseDiagnostico}`}>
              {etiqueta ?? 'Este punto todavía no fue analizado.'}
              {p.muestras !== null && (
                <div style={{ marginTop: 4, opacity: 0.85 }}>
                  Muestras consideradas: {p.muestras}
                </div>
              )}
              {p.radioSugerido !== null && (
                <div style={{ marginTop: 2, opacity: 0.85 }}>
                  Radio sugerido: {p.radioSugerido} m
                </div>
              )}
              {hayRecomendacion && p.latitudSugerida !== null && p.longitudSugerida !== null && (
                <div style={{ marginTop: 2, opacity: 0.85 }}>
                  Ubicación sugerida: {coordenada(p.latitudSugerida, p.longitudSugerida)}
                </div>
              )}
            </div>

            <div className={styles.acciones}>
              <button
                className={styles.boton}
                type="button"
                onClick={() => onAnalizar(p)}
                disabled={analizando || aplicando}
              >
                {analizando ? 'Analizando…' : p.diagnosticoEstado ? 'Volver a analizar' : 'Analizar GPS'}
              </button>

              {hayRecomendacion && (
                <button
                  className={`${styles.boton} ${styles.botonPrimario}`}
                  type="button"
                  onClick={() => onAplicar(p)}
                  disabled={analizando || aplicando}
                >
                  {aplicando ? 'Aplicando…' : 'Aplicar sugerencia'}
                </button>
              )}

              <button
                className={styles.boton}
                type="button"
                onClick={() => (marcacionesVisibles ? onOcultarMarcaciones() : onVerMarcaciones(p))}
                disabled={cargandoMarcaciones}
              >
                {cargandoMarcaciones
                  ? 'Buscando…'
                  : marcacionesVisibles ? 'Ocultar marcaciones' : 'Ver marcaciones'}
              </button>
            </div>

            {p.referenciaId && (
              <div className={styles.miniatura}>
                {fotoUrl
                  ? <img src={fotoUrl} alt="Foto de referencia del punto" onClick={() => setAmpliada(true)} />
                  : <div className={styles.soloLectura}>Cargando foto de referencia…</div>}
              </div>
            )}

            <div className={styles.soloLectura}>
              Aplicar guarda por la misma ruta que usa el editor de Rondas y queda
              registrado en la auditoría del punto. Las marcaciones son evidencia:
              se miran, no se mueven.
            </div>

            {ampliada && fotoUrl && (
              <div className={styles.ampliada} onClick={() => setAmpliada(false)}>
                <img src={fotoUrl} alt="Foto de referencia ampliada" />
              </div>
            )}
          </>
        )
      })()}

      <div className={styles.acciones}>
        <button className={styles.boton} type="button" onClick={onCerrar}>Cerrar</button>
      </div>
    </div>
  )
}
