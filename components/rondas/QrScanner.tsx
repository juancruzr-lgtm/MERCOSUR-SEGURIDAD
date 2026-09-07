'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'

// Lector de QR determinístico para el punto de ronda.
//
// Camino principal: getUserMedia (cámara trasera) + jsQR decodificando cuadros
// en un canvas. Sin IA, sin servidores de imagen: el decodificado es local y
// el token resultante se valida por RPC. jsQR se carga con import() dinámico
// para no engordar el bundle de toda la app por una pantalla.
//
// Camino alternativo (cámara denegada o sin getUserMedia, p. ej. algunos
// WebView): el mismo <input type="file" capture> que ya usa el resto de la app
// para fotos; se decodifica ese único cuadro con jsQR. Sigue siendo lectura
// directa, no interpretación.

interface Props {
  /** QR decodificado (contenido crudo; el llamador extrae y valida el token). */
  onLeido: (payload: string) => void
  onCancelar: () => void
}

type EstadoScanner =
  | { tipo: 'iniciando' }
  | { tipo: 'escaneando' }
  | { tipo: 'sin_camara'; motivo: string }

const SCAN_MAX_LADO = 640

type JsQr = typeof import('jsqr').default

async function cargarJsQr(): Promise<JsQr> {
  const modulo = await import('jsqr')
  return modulo.default
}

function decodificar(jsQR: JsQr, canvas: HTMLCanvasElement): string | null {
  const contexto = canvas.getContext('2d', { willReadFrequently: true })
  if (!contexto) return null
  const imagen = contexto.getImageData(0, 0, canvas.width, canvas.height)
  const resultado = jsQR(imagen.data, imagen.width, imagen.height, {
    inversionAttempts: 'dontInvert',
  })
  const texto = resultado?.data?.trim()
  return texto ? texto : null
}

export default function QrScanner({ onLeido, onCancelar }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [estado, setEstado] = useState<EstadoScanner>({ tipo: 'iniciando' })
  const [errorFoto, setErrorFoto] = useState<string | null>(null)
  const [procesandoFoto, setProcesandoFoto] = useState(false)

  useEffect(() => {
    let activo = true
    let stream: MediaStream | null = null
    let rafId = 0

    const detener = () => {
      if (rafId) cancelAnimationFrame(rafId)
      stream?.getTracks().forEach(track => track.stop())
      stream = null
    }

    const iniciar = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (activo) setEstado({ tipo: 'sin_camara', motivo: 'Este dispositivo no permite abrir la cámara desde la app.' })
        return
      }
      try {
        const [jsQR, mediaStream] = await Promise.all([
          cargarJsQr(),
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
            audio: false,
          }),
        ])
        if (!activo) {
          mediaStream.getTracks().forEach(track => track.stop())
          return
        }
        stream = mediaStream

        const video = videoRef.current
        if (!video) return
        video.srcObject = mediaStream
        await video.play()
        if (!activo) return
        setEstado({ tipo: 'escaneando' })

        const canvas = document.createElement('canvas')

        const cuadro = () => {
          if (!activo || !stream) return
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
            const escala = Math.min(1, SCAN_MAX_LADO / Math.max(video.videoWidth, video.videoHeight))
            canvas.width = Math.round(video.videoWidth * escala)
            canvas.height = Math.round(video.videoHeight * escala)
            canvas.getContext('2d', { willReadFrequently: true })
              ?.drawImage(video, 0, 0, canvas.width, canvas.height)
            const payload = decodificar(jsQR, canvas)
            if (payload) {
              detener()
              onLeido(payload)
              return
            }
          }
          rafId = requestAnimationFrame(cuadro)
        }
        rafId = requestAnimationFrame(cuadro)
      } catch (errorCamara) {
        if (!activo) return
        const nombre = (errorCamara as DOMException | null)?.name
        setEstado({
          tipo: 'sin_camara',
          motivo: nombre === 'NotAllowedError' || nombre === 'SecurityError'
            ? 'El permiso de cámara fue rechazado. Podés habilitarlo en el navegador o sacar una foto del QR.'
            : 'No se pudo abrir la cámara. Podés sacar una foto del QR como alternativa.',
        })
      }
    }

    void iniciar()
    return () => {
      activo = false
      detener()
    }
    // onLeido estable por diseño del llamador; el scanner vive una sola sesión.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const decodificarFoto = async (archivo: File | undefined) => {
    if (!archivo) return
    setErrorFoto(null)
    setProcesandoFoto(true)
    try {
      const jsQR = await cargarJsQr()
      const url = URL.createObjectURL(archivo)
      try {
        const imagen = await new Promise<HTMLImageElement>((resolve, reject) => {
          const elemento = new Image()
          elemento.onload = () => resolve(elemento)
          elemento.onerror = () => reject(new Error('El archivo no es una imagen válida.'))
          elemento.src = url
        })
        const canvas = document.createElement('canvas')
        const escala = Math.min(1, 1280 / Math.max(imagen.width, imagen.height))
        canvas.width = Math.max(1, Math.round(imagen.width * escala))
        canvas.height = Math.max(1, Math.round(imagen.height * escala))
        canvas.getContext('2d', { willReadFrequently: true })
          ?.drawImage(imagen, 0, 0, canvas.width, canvas.height)
        const payload = decodificar(jsQR, canvas)
        if (payload) {
          onLeido(payload)
        } else {
          setErrorFoto('No se encontró un QR legible en la foto. Acercate y probá de nuevo.')
        }
      } finally {
        URL.revokeObjectURL(url)
      }
    } catch {
      setErrorFoto('No se pudo procesar la foto del QR.')
    } finally {
      setProcesandoFoto(false)
    }
  }

  return (
    <div style={S.wrap} role="dialog" aria-label="Escanear QR del punto">
      <div style={S.marco}>
        {estado.tipo !== 'sin_camara' && (
          <video ref={videoRef} style={S.video} muted playsInline autoPlay />
        )}
        {estado.tipo === 'iniciando' && <div style={S.mensaje}>Abriendo cámara…</div>}
        {estado.tipo === 'escaneando' && (
          <div style={S.guia} aria-hidden="true" />
        )}
        {estado.tipo === 'sin_camara' && (
          <div style={S.sinCamara}>
            <div style={S.mensajeError}>{estado.motivo}</div>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              style={{ display: 'none' }}
              onChange={evento => {
                const archivo = evento.target.files?.[0]
                void decodificarFoto(archivo)
                evento.target.value = ''
              }}
            />
            <button
              type="button"
              style={S.secundario}
              onClick={() => inputRef.current?.click()}
              disabled={procesandoFoto}
            >
              {procesandoFoto ? 'Procesando…' : 'Sacar foto del QR'}
            </button>
            {errorFoto && <div style={S.mensajeError}>{errorFoto}</div>}
          </div>
        )}
      </div>

      {estado.tipo === 'escaneando' && (
        <div style={S.ayuda}>Apuntá al QR del punto. Se lee solo.</div>
      )}

      <button type="button" style={S.cancelar} onClick={onCancelar}>
        Cancelar
      </button>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 9 },
  marco: {
    position: 'relative', overflow: 'hidden', borderRadius: 10,
    border: '1px solid #1e2d42', background: '#020617', minHeight: 200,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  video: { display: 'block', width: '100%', maxHeight: 320, objectFit: 'cover' },
  guia: {
    position: 'absolute', inset: '14%', borderRadius: 12,
    border: '2px solid rgba(245,158,11,.85)', pointerEvents: 'none',
  },
  mensaje: { position: 'absolute', color: '#94a3b8', fontSize: 12 },
  sinCamara: { display: 'flex', flexDirection: 'column', gap: 9, padding: 14, width: '100%' },
  mensajeError: { color: '#fecaca', fontSize: 12, lineHeight: 1.5 },
  ayuda: { textAlign: 'center', color: '#94a3b8', fontSize: 11 },
  secundario: {
    width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #334155',
    background: '#1e293b', color: '#e2e8f0', fontSize: 13, fontWeight: 800, cursor: 'pointer',
  },
  cancelar: {
    width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #334155',
    background: 'transparent', color: '#94a3b8', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
}
