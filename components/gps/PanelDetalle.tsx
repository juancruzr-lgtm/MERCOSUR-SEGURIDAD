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
import {
  etiquetaConfianza,
  etiquetaOrigenVigencia,
  etiquetaRecomendacionObjetivo,
  evidenciaTexto,
  sugerenciaObjetivoAplicable,
  type DiagnosticoGpsObjetivo,
  type UbicacionVigencia,
} from '@/lib/gps-objetivos'
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
  guardandoRadio,
  mensaje,
  error,
  onAnalizar,
  onAplicar,
  onVerMarcaciones,
  onOcultarMarcaciones,
  onRadioPreview,
  onGuardarRadio,
  objetivoPropuesto,
  guardandoObjetivo,
  onConfirmarObjetivo,
  onDescartarObjetivo,
  diagnosticoObjetivo,
  analizandoObjetivo,
  aplicandoObjetivo,
  metrosPropuestos,
  onAnalizarObjetivo,
  onAplicarObjetivo,
  puntoCtl,
  objetivoCtl,
  onCerrar,
}: {
  seleccion: SeleccionGps | null
  marcacionesVisibles: boolean
  cargandoMarcaciones: boolean
  analizando: boolean
  aplicando: boolean
  guardandoRadio: boolean
  mensaje: string
  error: string
  onAnalizar: (punto: PuntoRondaGps) => void
  onAplicar: (punto: PuntoRondaGps) => void
  onVerMarcaciones: (punto: PuntoRondaGps) => void
  onOcultarMarcaciones: () => void
  /** Radio tentativo para dibujar en el mapa. null borra la vista previa. */
  onRadioPreview: (metros: number | null) => void
  onGuardarRadio: (punto: PuntoRondaGps, metros: number) => void
  /** Ubicación propuesta al arrastrar el objetivo. Todavía sin guardar. */
  objetivoPropuesto: { id: string; lat: number; lng: number } | null
  guardandoObjetivo: boolean
  onConfirmarObjetivo: () => void
  onDescartarObjetivo: () => void
  /** Diagnóstico del objetivo seleccionado, si ya se pidió. */
  diagnosticoObjetivo: DiagnosticoGpsObjetivo | null
  analizandoObjetivo: boolean
  aplicandoObjetivo: boolean
  metrosPropuestos: number | null
  onAnalizarObjetivo: (objetivoId: string) => void
  onAplicarObjetivo: () => void
  /** Mover el punto de ronda seleccionado. Arrastrar propone, confirmar guarda. */
  puntoCtl: {
    modoMover: boolean
    propuesto: { id: string; lat: number; lng: number } | null
    metrosPropuestos: number | null
    guardando: boolean
    onIniciarMover: () => void
    onCancelarMover: () => void
    onConfirmar: () => void
  }
  /** Todo lo que hace falta para gestionar la ubicación del objetivo. */
  objetivoCtl: {
    modoMover: boolean
    tipoUbicacion: 'fijo' | 'movil'
    cambiandoTipo: boolean
    historial: UbicacionVigencia[]
    puntosRonda: number
    vigenteDesde: string
    onIniciarMover: () => void
    onCancelarMover: () => void
    onCambiarTipo: (tipo: 'fijo' | 'movil') => void
    onVigenteDesdeChange: (valor: string) => void
    onVerPuntosRonda: () => void
  }
  onCerrar: () => void
}) {
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [ampliada, setAmpliada] = useState(false)
  const [radioTexto, setRadioTexto] = useState('')

  const referenciaId = seleccion?.tipo === 'punto' ? seleccion.datos.referenciaId : null
  const puntoId = seleccion?.tipo === 'punto' ? seleccion.datos.id : null
  const radioActual = seleccion?.tipo === 'punto' ? seleccion.datos.radioMetros : null

  // Al cambiar de punto (o al volver de guardar) el campo arranca con el valor
  // vigente y se limpia la vista previa: nunca queda un radio tentativo de otro
  // punto dibujado en el mapa.
  useEffect(() => {
    setRadioTexto(radioActual !== null ? String(radioActual) : '')
    onRadioPreview(null)
    // onRadioPreview es estable en la página; incluirlo re-dispararía esto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puntoId, radioActual])

  const radioEditado = Number(radioTexto.trim().replace(',', '.'))
  const radioValido = Number.isFinite(radioEditado) && radioEditado > 0
  const radioCambio = radioValido && radioEditado !== radioActual

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

            {/* ── Fijo / Móvil ──────────────────────────────────────────── */}
            <div className={styles.editorRadio}>
              <span className={styles.label}>Tipo de ubicación</span>
              <div className={styles.editorRadioFila}>
                {(['fijo', 'movil'] as const).map(tipo => (
                  <button
                    key={tipo}
                    type="button"
                    className={`${styles.capa} ${objetivoCtl.tipoUbicacion === tipo ? styles.capaActiva : ''}`}
                    onClick={() => objetivoCtl.onCambiarTipo(tipo)}
                    disabled={objetivoCtl.cambiandoTipo || guardandoObjetivo}
                  >
                    {tipo === 'fijo' ? 'Fijo' : 'Móvil'}
                  </button>
                ))}
              </div>
              <div className={styles.ayudaRadio}>
                {objetivoCtl.tipoUbicacion === 'movil'
                  ? 'Se traslada. Sus ubicaciones anteriores no fueron errores, y el diagnóstico sólo mira los fichajes posteriores a la mudanza.'
                  : 'No se traslada. Si los fichajes caen lejos, la ubicación está mal cargada.'}
              </div>
            </div>

            {/* ── Diagnóstico sobre los fichajes reales ─────────────────── */}
            {(() => {
              const d = diagnosticoObjetivo?.objetivo_id === o.id ? diagnosticoObjetivo : null
              if (!d) return null

              const aplicable = sugerenciaObjetivoAplicable(d)
              const clase = aplicable
                ? styles.diagnosticoAlerta
                : d.recomendacion === 'sin_cambios'
                  ? styles.diagnosticoOk
                  : styles.diagnosticoNeutro

              return (
                <div className={`${styles.diagnostico} ${clase}`}>
                  <div style={{ fontWeight: 700 }}>{etiquetaRecomendacionObjetivo(d.recomendacion)}</div>
                  <div style={{ marginTop: 4, opacity: 0.85 }}>
                    {etiquetaConfianza(d.confianza)} · {evidenciaTexto(d)}
                  </div>
                  {d.desplazamiento_metros !== null && (
                    <div style={{ marginTop: 2, opacity: 0.85 }}>
                      Los fichajes caen a {Math.round(d.desplazamiento_metros)} m de la ubicación actual.
                    </div>
                  )}
                  {d.latitud_sugerida !== null && d.longitud_sugerida !== null && (
                    <div style={{ marginTop: 2, opacity: 0.85 }}>
                      Sugerida: {coordenada(d.latitud_sugerida, d.longitud_sugerida)}
                    </div>
                  )}
                  {d.radio_sugerido !== null && (
                    <div style={{ marginTop: 2, opacity: 0.85 }}>
                      Radio: {d.radio_actual ?? '—'} m → {d.radio_sugerido} m
                    </div>
                  )}
                  {d.distancia_p90 !== null && (
                    <div style={{ marginTop: 2, opacity: 0.7 }}>
                      El 90 % de las marcaciones cae dentro de {Math.round(d.distancia_p90)} m del centro sugerido.
                    </div>
                  )}
                </div>
              )
            })()}

            <div className={styles.acciones}>
              <button
                className={styles.boton}
                type="button"
                onClick={() => onAnalizarObjetivo(o.id)}
                disabled={analizandoObjetivo || aplicandoObjetivo || guardandoObjetivo}
              >
                {analizandoObjetivo
                  ? 'Analizando fichajes…'
                  : diagnosticoObjetivo?.objetivo_id === o.id ? 'Volver a analizar' : 'Analizar fichajes'}
              </button>

              {diagnosticoObjetivo?.objetivo_id === o.id
                && sugerenciaObjetivoAplicable(diagnosticoObjetivo)
                && !objetivoPropuesto && (
                <button
                  className={`${styles.boton} ${styles.botonPrimario}`}
                  type="button"
                  onClick={onAplicarObjetivo}
                  disabled={analizandoObjetivo || aplicandoObjetivo || guardandoObjetivo}
                >
                  {aplicandoObjetivo ? 'Aplicando…' : 'Aplicar sugerencia GPS'}
                </button>
              )}
            </div>

            {objetivoPropuesto?.id === o.id ? (
              <>
                <div className={`${styles.diagnostico} ${styles.diagnosticoAlerta}`}>
                  <div style={{ fontWeight: 700 }}>Corrección manual sin guardar</div>
                  <div style={{ marginTop: 4 }}>
                    Antes: {coordenada(o.lat ?? null, o.lng ?? null)}
                  </div>
                  <div>
                    Propuesta: {objetivoPropuesto.lat.toFixed(6)}, {objetivoPropuesto.lng.toFixed(6)}
                  </div>
                  {metrosPropuestos !== null && <div>Desplazamiento: {metrosPropuestos} m</div>}
                  <div>Radio: {o.radio_metros ?? '—'} m (no cambia)</div>
                </div>

                {/* Sólo un móvil declara desde cuándo rige: en uno fijo, una
                    ubicación nueva corrige algo que estaba mal, y corregir es
                    siempre ahora. */}
                {objetivoCtl.tipoUbicacion === 'movil' && (
                  <div className={styles.editorRadio}>
                    <label className={styles.label} htmlFor="gps-vigente-desde">
                      Rige desde
                    </label>
                    <input
                      id="gps-vigente-desde"
                      className={styles.input}
                      type="datetime-local"
                      value={objetivoCtl.vigenteDesde}
                      onChange={e => objetivoCtl.onVigenteDesdeChange(e.target.value)}
                      disabled={guardandoObjetivo}
                    />
                    <div className={styles.ayudaRadio}>
                      Vacío = desde ahora. Los fichajes anteriores a esta fecha
                      siguen perteneciendo a la ubicación anterior y no se tocan.
                    </div>
                  </div>
                )}

                {objetivoCtl.puntosRonda > 0 && (
                  <div className={`${styles.diagnostico} ${styles.diagnosticoAlerta}`}>
                    Al guardar, los {objetivoCtl.puntosRonda} punto
                    {objetivoCtl.puntosRonda === 1 ? '' : 's'} de ronda de este
                    objetivo <b>quedan donde están</b>. Si el objetivo se mudó,
                    hay que revisarlos aparte.
                  </div>
                )}
                <div className={styles.acciones}>
                  <button
                    className={`${styles.boton} ${styles.botonPrimario}`}
                    type="button"
                    onClick={onConfirmarObjetivo}
                    disabled={guardandoObjetivo}
                  >
                    {guardandoObjetivo ? 'Guardando…' : 'Guardar corrección'}
                  </button>
                  <button
                    className={styles.boton}
                    type="button"
                    onClick={onDescartarObjetivo}
                    disabled={guardandoObjetivo}
                  >
                    Descartar
                  </button>
                </div>
              </>
            ) : objetivoCtl.modoMover ? (
              <div className={`${styles.diagnostico} ${styles.diagnosticoNeutro}`}>
                <div style={{ fontWeight: 700 }}>Modo mover activo</div>
                <div style={{ marginTop: 4 }}>
                  Arrastrá el marcador azul del objetivo hasta el lugar correcto.
                  No se guarda hasta que confirmes.
                </div>
                {objetivoCtl.puntosRonda > 0 && (
                  <div style={{ marginTop: 8, color: '#fcd34d' }}>
                    Este objetivo tiene {objetivoCtl.puntosRonda} punto
                    {objetivoCtl.puntosRonda === 1 ? '' : 's'} de ronda. <b>No se
                    mueven con él</b>: son ubicaciones propias. Revisalos después.
                    <div style={{ marginTop: 6 }}>
                      <button className={styles.boton} type="button" onClick={objetivoCtl.onVerPuntosRonda}>
                        Ver sus puntos de ronda
                      </button>
                    </div>
                  </div>
                )}
                <div className={styles.acciones}>
                  <button className={styles.boton} type="button" onClick={objetivoCtl.onCancelarMover}>
                    Salir del modo mover
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.acciones}>
                <button
                  className={styles.boton}
                  type="button"
                  onClick={objetivoCtl.onIniciarMover}
                  disabled={guardandoObjetivo || aplicandoObjetivo}
                >
                  📍 Mover objetivo
                </button>
              </div>
            )}

            {/* ── Historial de ubicaciones ─────────────────────────────── */}
            {objetivoCtl.historial.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className={styles.label}>Ubicaciones que tuvo</div>
                {objetivoCtl.historial.map(v => (
                  <div key={v.id} className={styles.fila} style={{ display: 'block' }}>
                    <div className={styles.filaLabel}>
                      {new Date(v.vigente_desde).toLocaleDateString('es-AR')}
                      {' → '}
                      {v.vigente_hasta
                        ? new Date(v.vigente_hasta).toLocaleDateString('es-AR')
                        : 'vigente'}
                      {' · '}{etiquetaOrigenVigencia(v.origen)}
                    </div>
                    <div className={styles.filaValor} style={{ textAlign: 'left' }}>
                      {Number(v.lat).toFixed(6)}, {Number(v.lng).toFixed(6)} · {v.radio_metros} m
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className={styles.soloLectura}>
              Mover un objetivo cambia dónde puede fichar el personal <b>de acá en
              adelante</b>: los fichajes ya registrados conservan la distancia y
              el veredicto que se calcularon contra la ubicación de su momento, y
              no se recalculan nunca. Los dos caminos quedan auditados y se
              distinguen: mover a mano es <b>manual</b>; aplicar la sugerencia es
              <b> diagnostico_gps</b> con la firma del análisis.
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

            {/* Ajuste manual del radio. Va por la misma ruta que el editor de
                Rondas y queda auditado como cambio manual. */}
            <div className={styles.editorRadio}>
              <label className={styles.label} htmlFor="gps-radio">Radio de marcación (m)</label>
              <div className={styles.editorRadioFila}>
                <input
                  id="gps-radio"
                  className={styles.input}
                  type="number"
                  min={1}
                  step={1}
                  value={radioTexto}
                  disabled={guardandoRadio || aplicando}
                  onChange={e => {
                    const texto = e.target.value
                    setRadioTexto(texto)
                    const valor = Number(texto.trim().replace(',', '.'))
                    onRadioPreview(Number.isFinite(valor) && valor > 0 ? valor : null)
                  }}
                />
                <button
                  className={`${styles.boton} ${styles.botonPrimario}`}
                  type="button"
                  onClick={() => onGuardarRadio(p, Math.round(radioEditado))}
                  disabled={!radioCambio || guardandoRadio || aplicando}
                >
                  {guardandoRadio ? 'Guardando…' : 'Guardar radio'}
                </button>
                {radioCambio && !guardandoRadio && (
                  <button
                    className={styles.boton}
                    type="button"
                    onClick={() => {
                      setRadioTexto(radioActual !== null ? String(radioActual) : '')
                      onRadioPreview(null)
                    }}
                  >
                    Descartar
                  </button>
                )}
              </div>
              <div className={styles.ayudaRadio}>
                {radioTexto.trim() && !radioValido
                  ? 'El radio tiene que ser un número mayor que cero.'
                  : radioCambio
                    ? 'El círculo punteado del mapa es el radio nuevo. Todavía no se guardó.'
                    : 'Cambiá el número para ver el radio nuevo dibujado en el mapa.'}
              </div>
            </div>

            {/* ── Mover el punto ───────────────────────────────────────── */}
            {puntoCtl.propuesto?.id === p.id ? (
              <>
                <div className={`${styles.diagnostico} ${styles.diagnosticoAlerta}`}>
                  <div style={{ fontWeight: 700 }}>Nueva ubicación sin guardar</div>
                  <div style={{ marginTop: 4 }}>Antes: {coordenada(p.latitud, p.longitud)}</div>
                  <div>
                    Propuesta: {puntoCtl.propuesto.lat.toFixed(6)}, {puntoCtl.propuesto.lng.toFixed(6)}
                  </div>
                  {puntoCtl.metrosPropuestos !== null && (
                    <div>Desplazamiento: {puntoCtl.metrosPropuestos} m</div>
                  )}
                  <div>Radio: {p.radioMetros !== null ? `${p.radioMetros} m` : '—'} (no cambia)</div>
                </div>
                <div className={styles.acciones}>
                  <button
                    className={`${styles.boton} ${styles.botonPrimario}`}
                    type="button"
                    onClick={puntoCtl.onConfirmar}
                    disabled={puntoCtl.guardando}
                  >
                    {puntoCtl.guardando ? 'Guardando…' : 'Guardar ubicación'}
                  </button>
                  <button
                    className={styles.boton}
                    type="button"
                    onClick={puntoCtl.onCancelarMover}
                    disabled={puntoCtl.guardando}
                  >
                    Descartar
                  </button>
                </div>
              </>
            ) : puntoCtl.modoMover ? (
              <div className={`${styles.diagnostico} ${styles.diagnosticoNeutro}`}>
                <div style={{ fontWeight: 700 }}>Modo mover activo</div>
                <div style={{ marginTop: 4 }}>
                  Arrastrá el marcador de este punto hasta el lugar correcto. Sobre
                  Satélite o Híbrido se ve dónde está el portón de verdad. No se
                  guarda hasta que confirmes.
                </div>
                <div className={styles.acciones}>
                  <button className={styles.boton} type="button" onClick={puntoCtl.onCancelarMover}>
                    Salir del modo mover
                  </button>
                </div>
              </div>
            ) : null}

            <div className={styles.acciones}>
              {!puntoCtl.modoMover && !puntoCtl.propuesto && (
                <button
                  className={styles.boton}
                  type="button"
                  onClick={puntoCtl.onIniciarMover}
                  disabled={analizando || aplicando || guardandoRadio}
                >
                  📍 Mover punto
                </button>
              )}
              <button
                className={styles.boton}
                type="button"
                onClick={() => onAnalizar(p)}
                disabled={analizando || aplicando || guardandoRadio}
              >
                {analizando ? 'Analizando…' : p.diagnosticoEstado ? 'Volver a analizar' : 'Analizar GPS'}
              </button>

              {hayRecomendacion && (
                <button
                  className={`${styles.boton} ${styles.botonPrimario}`}
                  type="button"
                  onClick={() => onAplicar(p)}
                  disabled={analizando || aplicando || guardandoRadio}
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
              Guardar el radio y aplicar la sugerencia usan la misma ruta que el
              editor de Rondas: los dos quedan registrados en la auditoría del
              punto, uno como cambio manual y el otro como diagnóstico. Las
              marcaciones son evidencia: se miran, no se mueven.
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
