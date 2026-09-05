'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  MODOS_QR,
  MENSAJE_CONFIRMAR_REGENERAR,
  ayudaModoQr,
  etiquetaModoQr,
  formatearPayloadQr,
  generarQrPunto,
  mensajeContextoGenerarQr,
  mensajeContextoObtenerQr,
  obtenerQrPunto,
  type EstadoQrPunto,
  type ModoQr,
} from '@/lib/rondas-qr'
import styles from './Rondas.module.css'

// Sección "Validación QR" del editor de punto. Sólo para puntos existentes
// (necesita el id, igual que la referencia IA). El modo viaja con el formulario
// del punto (grant de UPDATE por columna + auditoría por trigger); la
// generación/regeneración de la credencial es inmediata vía RPC y queda en
// ronda_puntos_auditoria.
//
// La activación es deliberada: nada se genera automáticamente ni en masa.

interface Props {
  rondaPuntoId: string
  modo: ModoQr
  onModoChange: (modo: ModoQr) => void
  disabled?: boolean
}

async function abrirImpresion(estado: EstadoQrPunto): Promise<string | null> {
  if (!estado.qr) return 'El punto no tiene un QR activo para imprimir.'

  // Generación local y determinística del gráfico; el contenido del QR es sólo
  // la credencial (prefijo + token), nunca nombres ni coordenadas.
  const QRCode = (await import('qrcode')).default
  const dataUrl = await QRCode.toDataURL(formatearPayloadQr(estado.qr.token), {
    width: 640,
    margin: 2,
    errorCorrectionLevel: 'M',
  })

  const ventana = window.open('', '_blank', 'noopener,width=480,height=700')
  if (!ventana) return 'El navegador bloqueó la ventana de impresión. Habilitá los pop-ups.'

  const esc = (texto: string) =>
    texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  ventana.document.write(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>QR · ${esc(estado.punto_nombre)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 32px; text-align: center; color: #111; }
  .empresa { font-size: 20px; font-weight: 900; letter-spacing: 1px; }
  .dato { font-size: 15px; margin-top: 6px; }
  .dato strong { font-weight: 800; }
  img { width: 320px; height: 320px; margin: 22px auto 10px; display: block; }
  .codigo { font-size: 13px; color: #444; letter-spacing: 2px; }
  .pie { font-size: 11px; color: #777; margin-top: 18px; }
  @media print { .no-imprimir { display: none } }
  .no-imprimir { margin-top: 24px; }
  button { padding: 10px 18px; font-size: 14px; cursor: pointer; }
</style>
</head>
<body>
  <div class="empresa">MERCOSUR SEGURIDAD</div>
  <div class="dato"><strong>Objetivo:</strong> ${esc(estado.objetivo_nombre)}</div>
  <div class="dato"><strong>Ronda:</strong> ${esc(estado.ronda_nombre)}</div>
  <div class="dato"><strong>Punto:</strong> ${esc(estado.punto_nombre)}</div>
  <img src="${dataUrl}" alt="QR del punto de control">
  <div class="codigo">Código ${esc(estado.qr.codigo_corto)}</div>
  <div class="pie">Escanear desde la app durante la ronda. Pegar en el punto indicado.</div>
  <div class="no-imprimir"><button onclick="window.print()">Imprimir</button></div>
</body>
</html>`)
  ventana.document.close()
  return null
}

export default function QrPuntoAdmin({ rondaPuntoId, modo, onModoChange, disabled }: Props) {
  const [estado, setEstado] = useState<EstadoQrPunto | null>(null)
  const [cargando, setCargando] = useState(true)
  const [operando, setOperando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data, error } = await obtenerQrPunto(rondaPuntoId)
    if (error) {
      setMensaje(error)
      setEstado(null)
    } else if (data && data.contexto !== 'ok') {
      setMensaje(mensajeContextoObtenerQr(data.contexto))
      setEstado(null)
    } else {
      setMensaje(null)
      setEstado(data)
    }
    setCargando(false)
  }, [rondaPuntoId])

  useEffect(() => { void cargar() }, [cargar])

  const generar = async (regenerar: boolean) => {
    if (operando) return
    if (regenerar && !window.confirm(MENSAJE_CONFIRMAR_REGENERAR)) return

    setOperando(true)
    setMensaje(null)
    const { data, error } = await generarQrPunto(rondaPuntoId, regenerar)
    if (error) {
      setMensaje(error)
    } else if (data) {
      const contexto = mensajeContextoGenerarQr(data.contexto)
      if (contexto) setMensaje(contexto)
      await cargar()
    }
    setOperando(false)
  }

  const imprimir = async () => {
    if (!estado || operando) return
    setOperando(true)
    const errorImpresion = await abrirImpresion(estado)
    if (errorImpresion) setMensaje(errorImpresion)
    setOperando(false)
  }

  const tieneQr = estado?.qr != null
  const ocupado = Boolean(disabled) || operando || cargando

  return (
    <div className={`${styles.field} ${styles.full}`}>
      <label htmlFor="ronda-punto-qr-modo">Validación QR</label>
      <select
        id="ronda-punto-qr-modo"
        value={modo}
        onChange={evento => onModoChange(evento.target.value as ModoQr)}
        disabled={Boolean(disabled)}
      >
        {MODOS_QR.map(opcion => (
          <option key={opcion} value={opcion}>{etiquetaModoQr(opcion)}</option>
        ))}
      </select>
      <small>{ayudaModoQr(modo)}</small>

      {cargando ? (
        <div className={styles.help}>Consultando QR del punto…</div>
      ) : (
        <>
          <div className={styles.help}>
            {tieneQr
              ? `QR activo · código ${estado?.qr?.codigo_corto}. El QR anterior a una regeneración deja de ser válido.`
              : 'QR no generado.'}
            {!tieneQr && modo !== 'desactivado' && (
              ' Generá e imprimí el QR: hasta que exista una credencial activa, la exigencia no aplica en las rondas.'
            )}
          </div>
          <div className={styles.gpsControls}>
            {!tieneQr && (
              <button
                className={`${styles.button} ${styles.buttonPrimary}`}
                type="button"
                onClick={() => void generar(false)}
                disabled={ocupado}
              >
                Generar QR
              </button>
            )}
            {tieneQr && (
              <>
                <button
                  className={styles.button}
                  type="button"
                  onClick={() => void imprimir()}
                  disabled={ocupado}
                >
                  Ver / imprimir
                </button>
                <button
                  className={`${styles.button} ${styles.buttonDanger}`}
                  type="button"
                  onClick={() => void generar(true)}
                  disabled={ocupado}
                >
                  Regenerar QR
                </button>
              </>
            )}
          </div>
        </>
      )}

      {mensaje && <div className={styles.help}>{mensaje}</div>}
    </div>
  )
}
