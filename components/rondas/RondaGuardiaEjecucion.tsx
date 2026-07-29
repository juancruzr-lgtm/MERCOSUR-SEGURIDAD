'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  etiquetaPoliticaFoto,
  fotoEsObligatoria,
  mensajeContextoRegistrarPunto,
  registrarPuntoRonda,
  subirFotoPuntoRonda,
  type GpsPuntoRonda,
  type RondaEjecucionActual,
  type RondaEjecucionPuntoEstado,
  type VeredictoPuntoRonda,
} from '@/lib/rondas'
import {
  capturarGpsNuevo,
  type CapturaGpsEnCurso,
  type MotivoFalloGps,
  type ResultadoCapturaGps,
} from '@/lib/gps-captura'

type EstadoGps =
  | { tipo: 'sin_solicitar' }
  | { tipo: 'obteniendo' }
  | { tipo: 'disponible'; gps: GpsPuntoRonda }
  | { tipo: 'no_disponible'; motivo: string }

interface FotoPunto {
  file: File
  url: string
}

interface UltimoResultado {
  puntoNombre: string
  veredicto: VeredictoPuntoRonda
}

interface Props {
  ejecucion: RondaEjecucionActual
  onEjecucionChange: (ejecucion: RondaEjecucionActual) => void
  onOperacionChange?: (enCurso: boolean) => void
  onVolver: () => void
}

const FOTO_MAX_WIDTH = 1280
const FOTO_QUALITY = 0.76

export function obtenerPuntoPendiente(
  ejecucion: RondaEjecucionActual,
): RondaEjecucionPuntoEstado | null {
  return ejecucion.puntos.find(punto => punto.estado === 'pendiente') ?? null
}

export function precisionGpsInsuficiente(
  punto: RondaEjecucionPuntoEstado,
  gps: GpsPuntoRonda,
): boolean {
  if (gps.precision_metros == null) return false
  const umbral = punto.radio_metros ?? 150
  return gps.precision_metros > umbral
}

function motivoFalloGps(motivo: MotivoFalloGps): string {
  if (motivo === 'sin_soporte') return 'Este dispositivo no ofrece ubicación GPS.'
  if (motivo === 'permiso_denegado') return 'El permiso de ubicación fue rechazado.'
  return 'No fue posible obtener una ubicación nueva.'
}

function estadoDesdeCaptura(resultado: ResultadoCapturaGps): EstadoGps {
  if (!resultado.ok) {
    return { tipo: 'no_disponible', motivo: motivoFalloGps(resultado.motivo) }
  }
  const { coords } = resultado.posicion
  return {
    tipo: 'disponible',
    gps: {
      latitud: coords.latitude,
      longitud: coords.longitude,
      precision_metros: Number.isFinite(coords.accuracy) ? coords.accuracy : null,
    },
  }
}

function comprimirFoto(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const imagen = new Image()
    const timer = window.setTimeout(() => {
      URL.revokeObjectURL(url)
      reject(new Error('La imagen tardó demasiado en procesarse.'))
    }, 10_000)

    imagen.onload = () => {
      window.clearTimeout(timer)
      URL.revokeObjectURL(url)

      const escala = Math.min(1, FOTO_MAX_WIDTH / imagen.width)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(imagen.width * escala))
      canvas.height = Math.max(1, Math.round(imagen.height * escala))
      const contexto = canvas.getContext('2d')

      if (!contexto) {
        reject(new Error('El dispositivo no pudo preparar la foto.'))
        return
      }

      contexto.drawImage(imagen, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        blob => {
          if (!blob) {
            reject(new Error('El dispositivo no pudo comprimir la foto.'))
            return
          }
          resolve(new File([blob], 'punto-ronda.jpg', { type: 'image/jpeg' }))
        },
        'image/jpeg',
        FOTO_QUALITY,
      )
    }

    imagen.onerror = () => {
      window.clearTimeout(timer)
      URL.revokeObjectURL(url)
      reject(new Error('El archivo seleccionado no es una imagen válida.'))
    }

    imagen.src = url
  })
}

export default function RondaGuardiaEjecucion({
  ejecucion,
  onEjecucionChange,
  onOperacionChange,
  onVolver,
}: Props) {
  const fotoInputRef = useRef<HTMLInputElement>(null)
  const capturaGpsRef = useRef<CapturaGpsEnCurso | null>(null)
  const [estadoGps, setEstadoGps] = useState<EstadoGps>({ tipo: 'sin_solicitar' })
  const [foto, setFoto] = useState<FotoPunto | null>(null)
  const [procesandoFoto, setProcesandoFoto] = useState(false)
  const [registrando, setRegistrando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ultimoResultado, setUltimoResultado] = useState<UltimoResultado | null>(null)
  const [hayNovedad, setHayNovedad] = useState(false)

  const puntoActual = obtenerPuntoPendiente(ejecucion)
  const puntoActualId = puntoActual?.ejecucion_punto_id ?? null

  useEffect(() => {
    setEstadoGps({ tipo: 'sin_solicitar' })
    setFoto(null)
    setProcesandoFoto(false)
    setError(null)
    setHayNovedad(false)
  }, [puntoActualId])

  // Misma regla que aplica el servidor. Se recalcula al marcar la novedad:
  // con política `solo_novedad` es esa marca la que vuelve obligatoria una foto
  // que hasta recién no se pedía.
  const politicaFoto = puntoActual?.politica_foto ?? 'obligatoria'
  const fotoObligatoria = puntoActual != null && fotoEsObligatoria(politicaFoto, hayNovedad)

  useEffect(() => {
    return () => {
      if (foto?.url) URL.revokeObjectURL(foto.url)
    }
  }, [foto?.url])

  // Corta la captura en curso al cambiar de punto o al desmontar: watchPosition
  // sigue vivo hasta que se lo limpia.
  useEffect(() => {
    return () => {
      capturaGpsRef.current?.cancelar()
      capturaGpsRef.current = null
    }
  }, [puntoActualId])

  const solicitarGps = async () => {
    if (registrando) return
    setError(null)
    setEstadoGps({ tipo: 'obteniendo' })

    capturaGpsRef.current?.cancelar()
    const captura = capturarGpsNuevo()
    capturaGpsRef.current = captura

    const resultado = await captura.promesa
    // Otra captura la reemplazó, o el punto cambió mientras esperábamos.
    if (capturaGpsRef.current !== captura) return
    capturaGpsRef.current = null
    setEstadoGps(estadoDesdeCaptura(resultado))
  }

  const seleccionarFoto = async (archivo: File | undefined) => {
    if (!archivo) return

    setError(null)
    setProcesandoFoto(true)
    try {
      const comprimida = await comprimirFoto(archivo)
      setFoto({
        file: comprimida,
        url: URL.createObjectURL(comprimida),
      })
    } catch (errorFoto) {
      setError(errorFoto instanceof Error ? errorFoto.message : 'No se pudo preparar la foto.')
    } finally {
      setProcesandoFoto(false)
    }
  }

  const registrarActual = async () => {
    if (!puntoActual || registrando) return
    if (estadoGps.tipo !== 'disponible' && estadoGps.tipo !== 'no_disponible') {
      setError('Primero intentá obtener la ubicación.')
      return
    }
    if (fotoObligatoria && !foto) {
      setError(hayNovedad && politicaFoto === 'solo_novedad'
        ? 'Marcaste que hay una novedad: la foto pasa a ser obligatoria.'
        : 'Este punto requiere una foto antes de continuar.')
      return
    }

    setRegistrando(true)
    setError(null)
    onOperacionChange?.(true)

    try {
      if (foto) {
        const subida = await subirFotoPuntoRonda(puntoActual.ejecucion_punto_id, foto.file)
        if (subida.error) {
          setError(subida.error)
          return
        }
      }

      const gps = estadoGps.tipo === 'disponible' ? estadoGps.gps : null
      const registro = await registrarPuntoRonda(puntoActual.ejecucion_punto_id, gps, hayNovedad)
      if (registro.error || !registro.data) {
        setError(registro.error || 'No se pudo registrar el punto.')
        return
      }

      const mensaje = mensajeContextoRegistrarPunto(registro.data.contexto)
      if (mensaje) {
        setError(mensaje)
        return
      }
      if (!registro.data.ejecucion || !registro.data.punto) {
        setError('El servidor no devolvió el estado actualizado de la ronda.')
        return
      }

      setUltimoResultado({
        puntoNombre: puntoActual.nombre,
        veredicto: registro.data.punto,
      })
      onEjecucionChange(registro.data.ejecucion)
    } finally {
      setRegistrando(false)
      onOperacionChange?.(false)
    }
  }

  if (ejecucion.estado === 'finalizada') {
    const completa = ejecucion.resultado === 'completa'
    return (
      <section style={S.finalCard} aria-live="polite">
        <div style={{ ...S.finalIcono, background: completa ? '#14532d' : '#713f12' }}>
          {completa ? '✓' : '!'}
        </div>
        <div style={S.finalTitulo}>Ronda finalizada</div>
        <div style={S.finalTexto}>
          {completa
            ? 'Todos los puntos fueron cumplidos.'
            : 'La ronda terminó con uno o más puntos incumplidos.'}
        </div>
        <div style={{ ...S.resultadoBadge, ...(completa ? S.resultadoOk : S.resultadoWarn) }}>
          {completa ? 'Completa' : 'Incompleta'}
        </div>
        <button type="button" style={S.primario} onClick={onVolver}>
          Volver a las rondas
        </button>
      </section>
    )
  }

  if (!puntoActual) {
    return (
      <section style={S.card}>
        <div style={S.errorBox}>
          La ejecución está en curso, pero no se encontró un punto pendiente. Actualizá la pantalla.
        </div>
        <button type="button" style={S.secundario} onClick={onVolver}>
          Actualizar
        </button>
      </section>
    )
  }

  const gpsIntentado = estadoGps.tipo === 'disponible' || estadoGps.tipo === 'no_disponible'
  const precisionBaja = estadoGps.tipo === 'disponible'
    && precisionGpsInsuficiente(puntoActual, estadoGps.gps)
  // Estar fuera del radio o con precisión mayor al radio NO bloquea: si hay una
  // ubicación válida se puede registrar y el servidor decide el resultado
  // (cumplido / fuera de radio). Solo se bloquea por GPS cuando el punto lo
  // requiere y no se pudo obtener ninguna ubicación válida.
  const ubicacionValida = estadoGps.tipo === 'disponible'
  const bloqueoPorGps = puntoActual.requiere_gps && !ubicacionValida
  const puedeRegistrar = gpsIntentado
    && !bloqueoPorGps
    && (!fotoObligatoria || foto !== null)
    && !procesandoFoto
    && !registrando
  const porcentaje = Math.min(100, Math.max(0, ejecucion.porcentaje))

  return (
    <section style={S.wrap} aria-label="Ronda en curso">
      <div style={S.encabezado}>
        <div>
          <div style={S.eyebrow}>Ronda en curso</div>
          <div style={S.titulo}>{ejecucion.ronda_nombre}</div>
        </div>
        <div style={S.progresoNumero}>{ejecucion.puntos_completados}/{ejecucion.puntos_total}</div>
      </div>

      <div style={S.barraFondo} aria-label={`Progreso ${porcentaje}%`}>
        <div style={{ ...S.barraValor, width: `${porcentaje}%` }} />
      </div>

      {ultimoResultado && (
        <div
          style={{
            ...S.resultadoAnterior,
            ...(ultimoResultado.veredicto.estado === 'cumplido' ? S.resultadoAnteriorOk : S.resultadoAnteriorWarn),
          }}
          aria-live="polite"
        >
          <strong>{ultimoResultado.puntoNombre}:</strong>{' '}
          {ultimoResultado.veredicto.estado === 'cumplido' ? 'cumplido' : 'incumplido'}
          {ultimoResultado.veredicto.distancia_metros != null
            ? ` · ${Math.round(ultimoResultado.veredicto.distancia_metros)} m`
            : ''}
        </div>
      )}

      <div style={S.card}>
        <div style={S.puntoTop}>
          <div style={S.orden}>{puntoActual.orden}</div>
          <div style={{ minWidth: 0 }}>
            <div style={S.puntoEtiqueta}>Punto actual</div>
            <div style={S.puntoNombre}>{puntoActual.nombre}</div>
          </div>
        </div>

        <div style={S.reglas}>
          <span style={{ ...S.regla, ...(puntoActual.requiere_gps ? S.reglaActiva : S.reglaOpcional) }}>
            {puntoActual.requiere_gps ? 'GPS requerido' : 'GPS opcional'}
          </span>
          <span style={{ ...S.regla, ...(fotoObligatoria ? S.reglaActiva : S.reglaOpcional) }}>
            {etiquetaPoliticaFoto(politicaFoto)}
          </span>
          {puntoActual.radio_metros != null && (
            <span style={{ ...S.regla, ...S.reglaOpcional }}>Radio {puntoActual.radio_metros} m</span>
          )}
        </div>

        <div style={S.bloque}>
          <div style={S.bloqueTitulo}>1. Ubicación</div>

          {estadoGps.tipo === 'sin_solicitar' && (
            <div style={S.ayuda}>
              Se solicitará la ubicación actual. La distancia y el resultado los calcula el servidor.
            </div>
          )}

          {estadoGps.tipo === 'obteniendo' && (
            <div style={S.estadoInfo}>Obteniendo ubicación GPS…</div>
          )}

          {estadoGps.tipo === 'disponible' && (
            <div style={{ ...S.estadoInfo, ...(precisionBaja ? S.estadoWarn : S.estadoOk) }}>
              <strong>GPS obtenido</strong>
              <span>
                Precisión: {estadoGps.gps.precision_metros == null
                  ? 'no informada'
                  : `±${Math.round(estadoGps.gps.precision_metros)} m`}
              </span>
              {precisionBaja && (
                <span>
                  La precisión es mayor que el radio configurado. Podés reintentar; el servidor decidirá el resultado.
                </span>
              )}
            </div>
          )}

          {estadoGps.tipo === 'no_disponible' && (
            <div style={{ ...S.estadoInfo, ...S.estadoError }}>
              <strong>GPS no disponible</strong>
              <span>{estadoGps.motivo}</span>
              <span>
                {puntoActual.requiere_gps
                  ? 'Si continuás, el servidor registrará el punto como incumplido.'
                  : 'Podés continuar porque el GPS es opcional.'}
              </span>
            </div>
          )}

          <button
            type="button"
            style={S.secundario}
            onClick={() => void solicitarGps()}
            disabled={estadoGps.tipo === 'obteniendo' || registrando}
          >
            {estadoGps.tipo === 'sin_solicitar' ? 'Obtener ubicación' : 'Reintentar GPS'}
          </button>
        </div>

        {politicaFoto === 'solo_novedad' && (
          <div style={S.bloque}>
            <div style={S.bloqueTitulo}>2. ¿Hay novedad?</div>
            <div style={S.ayuda}>
              Si marcás que hay una novedad, la foto pasa a ser obligatoria para este punto.
            </div>
            <label style={S.novedadFila}>
              <input
                type="checkbox"
                checked={hayNovedad}
                onChange={evento => { setHayNovedad(evento.target.checked); setError(null) }}
                disabled={registrando}
              />
              <span>Hay una novedad para reportar</span>
            </label>
          </div>
        )}

        <div style={S.bloque}>
          <div style={S.bloqueTitulo}>
            {politicaFoto === 'solo_novedad' ? '3. Foto' : '2. Foto'}
            {fotoObligatoria ? ' obligatoria' : ' opcional'}
          </div>
          <input
            ref={fotoInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            style={{ display: 'none' }}
            onChange={evento => {
              const archivo = evento.target.files?.[0]
              void seleccionarFoto(archivo)
              evento.target.value = ''
            }}
          />

          {procesandoFoto && <div style={S.estadoInfo}>Preparando foto…</div>}

          {foto && (
            <div style={S.fotoPreview}>
              <img src={foto.url} alt="Vista previa del punto de ronda" style={S.fotoImagen} />
              <div style={S.fotoPie}>Foto lista para subir</div>
            </div>
          )}

          <button
            type="button"
            style={S.secundario}
            onClick={() => fotoInputRef.current?.click()}
            disabled={procesandoFoto || registrando}
          >
            {foto ? 'Repetir foto' : 'Tomar foto'}
          </button>
        </div>

        {error && <div style={S.errorBox} role="alert">{error}</div>}

        <button
          type="button"
          style={{ ...S.primario, ...(!puedeRegistrar ? S.deshabilitado : null) }}
          onClick={() => void registrarActual()}
          disabled={!puedeRegistrar}
        >
          {registrando
            ? (foto ? 'Subiendo y validando…' : 'Validando punto…')
            : 'Registrar punto'}
        </button>

        {!gpsIntentado && (
          <div style={S.pieAyuda}>Primero obtené la ubicación para habilitar el registro.</div>
        )}
        {gpsIntentado && fotoObligatoria && !foto && (
          <div style={S.pieAyuda}>La foto obligatoria bloquea el avance.</div>
        )}
      </div>
    </section>
  )
}

const S: Record<string, CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 12 },
  encabezado: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  eyebrow: { color: '#f59e0b', fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.8 },
  titulo: { color: '#f8fafc', fontSize: 18, fontWeight: 900, marginTop: 2 },
  progresoNumero: {
    flexShrink: 0, borderRadius: 999, padding: '5px 10px', background: '#1e293b',
    color: '#e2e8f0', fontSize: 12, fontWeight: 800,
  },
  barraFondo: { height: 7, borderRadius: 999, background: '#1e293b', overflow: 'hidden' },
  barraValor: { height: '100%', borderRadius: 999, background: '#f59e0b', transition: 'width .25s ease' },
  resultadoAnterior: { borderRadius: 10, padding: '9px 11px', fontSize: 12, lineHeight: 1.4 },
  resultadoAnteriorOk: { background: '#0b2a1c', color: '#86efac', border: '1px solid #166534' },
  resultadoAnteriorWarn: { background: '#3f2d10', color: '#fde68a', border: '1px solid #92400e' },
  card: { border: '1px solid #1e2d42', borderRadius: 14, background: '#111827', padding: 14 },
  puntoTop: { display: 'flex', alignItems: 'center', gap: 12 },
  orden: {
    width: 38, height: 38, borderRadius: 999, flexShrink: 0, display: 'flex',
    alignItems: 'center', justifyContent: 'center', background: '#f59e0b',
    color: '#111827', fontSize: 16, fontWeight: 900,
  },
  puntoEtiqueta: { fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 800 },
  puntoNombre: { color: '#f8fafc', fontSize: 17, fontWeight: 900, marginTop: 1 },
  reglas: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  regla: { borderRadius: 999, padding: '3px 8px', fontSize: 10, fontWeight: 800 },
  reglaActiva: { color: '#86efac', background: '#0b2a1c' },
  reglaOpcional: { color: '#94a3b8', background: '#1e293b' },
  bloque: { marginTop: 14, paddingTop: 14, borderTop: '1px solid #1e2d42' },
  bloqueTitulo: { color: '#e2e8f0', fontSize: 13, fontWeight: 800, marginBottom: 8 },
  ayuda: { color: '#94a3b8', fontSize: 12, lineHeight: 1.5, marginBottom: 9 },
  novedadFila: {
    display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
    color: '#e2e8f0', fontSize: 14, padding: '8px 0',
  },
  estadoInfo: {
    display: 'flex', flexDirection: 'column', gap: 3, padding: 10, borderRadius: 10,
    background: '#0f1729', color: '#cbd5e1', fontSize: 12, lineHeight: 1.4, marginBottom: 9,
  },
  estadoOk: { border: '1px solid #166534', color: '#86efac', background: '#0b2a1c' },
  estadoWarn: { border: '1px solid #92400e', color: '#fde68a', background: '#3f2d10' },
  estadoError: { border: '1px solid #991b1b', color: '#fecaca', background: '#3b1116' },
  fotoPreview: { overflow: 'hidden', borderRadius: 10, border: '1px solid #1e2d42', marginBottom: 9 },
  fotoImagen: { display: 'block', width: '100%', maxHeight: 260, objectFit: 'cover', background: '#020617' },
  fotoPie: { color: '#86efac', background: '#0b2a1c', padding: '7px 9px', fontSize: 11, fontWeight: 800 },
  errorBox: {
    border: '1px solid #991b1b', background: '#3b1116', color: '#fecaca',
    borderRadius: 10, padding: 10, fontSize: 12, lineHeight: 1.45, marginTop: 12,
  },
  primario: {
    width: '100%', marginTop: 14, padding: '12px 14px', borderRadius: 10, border: 'none',
    background: '#f59e0b', color: '#111827', fontSize: 14, fontWeight: 900, cursor: 'pointer',
  },
  secundario: {
    width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #334155',
    background: '#1e293b', color: '#e2e8f0', fontSize: 13, fontWeight: 800, cursor: 'pointer',
  },
  deshabilitado: { background: '#334155', color: '#64748b', cursor: 'not-allowed' },
  pieAyuda: { textAlign: 'center', color: '#64748b', fontSize: 11, marginTop: 7 },
  finalCard: {
    border: '1px solid #1e2d42', borderRadius: 14, background: '#111827', padding: 20,
    textAlign: 'center',
  },
  finalIcono: {
    width: 52, height: 52, borderRadius: 999, display: 'flex', alignItems: 'center',
    justifyContent: 'center', margin: '0 auto 10px', color: '#f8fafc', fontSize: 25, fontWeight: 900,
  },
  finalTitulo: { color: '#f8fafc', fontSize: 19, fontWeight: 900 },
  finalTexto: { color: '#94a3b8', fontSize: 13, lineHeight: 1.5, marginTop: 5 },
  resultadoBadge: {
    display: 'inline-block', borderRadius: 999, padding: '5px 12px',
    fontSize: 12, fontWeight: 900, marginTop: 12,
  },
  resultadoOk: { background: '#0b2a1c', color: '#86efac' },
  resultadoWarn: { background: '#3f2d10', color: '#fde68a' },
}
