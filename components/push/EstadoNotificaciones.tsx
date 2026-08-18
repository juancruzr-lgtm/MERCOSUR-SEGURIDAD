'use client'

/**
 * Sección "Estado de notificaciones" — compartida por la app del supervisor
 * y la del vigilador. Diagnostica ESTE dispositivo (permiso, Service Worker,
 * suscripción del navegador vs. la guardada) y permite dos acciones sobre el
 * mismo Web Push que usan las alertas reales: activar y enviar una prueba.
 *
 * La prueba NO es un toast: es una notificación real del sistema operativo.
 * La comprobación que cierra el circuito es física —cerrar la app, bloquear
 * el teléfono y ver la notificación—; esta pantalla deja todo listo para eso
 * y le dice a la persona exactamente qué hacer.
 */

import { useCallback, useEffect, useState } from 'react'
import { activarNotificacionesPush, diagnosticarPushDispositivo, enviarPushDePrueba } from '@/lib/push-client'
import type { DiagnosticoPushDispositivo } from '@/lib/push-client'
import { textoUltimoEnvio } from '@/lib/push-estado'

const card: React.CSSProperties = { background: '#111827', border: '1px solid #1e2d42', borderRadius: 12, padding: 16 }
const fila: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '6px 0', borderBottom: '1px solid #1e2d4266' }
const label: React.CSSProperties = { color: '#94a3b8' }
const btn: React.CSSProperties = { border: 'none', borderRadius: 10, padding: '11px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer', width: '100%' }

export default function EstadoNotificaciones() {
  const [diag, setDiag] = useState<DiagnosticoPushDispositivo | null>(null)
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState<'activar' | 'probar' | null>(null)
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error' | 'info'; texto: string } | null>(null)

  const refrescar = useCallback(async () => {
    setCargando(true)
    try {
      setDiag(await diagnosticarPushDispositivo())
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { refrescar() }, [refrescar])

  const activar = async () => {
    setOcupado('activar')
    setMensaje(null)
    const r = await activarNotificacionesPush()
    setMensaje({ tipo: r.ok ? 'ok' : 'error', texto: r.message })
    setOcupado(null)
    await refrescar()
  }

  const probar = async () => {
    setOcupado('probar')
    setMensaje(null)
    const r = await enviarPushDePrueba()
    if (r.ok === true) {
      setMensaje({
        tipo: 'ok',
        texto: 'Prueba enviada por el mismo canal que las alertas. Ahora cerrá MERCOSUR y bloqueá el teléfono: la notificación tiene que aparecer en la pantalla del teléfono en menos de un minuto. Si no aparece, el problema está en el teléfono (ahorro de batería, permisos del sistema o modo No molestar).',
      })
    } else {
      const textos: Record<string, string> = {
        sin_dispositivo: 'Este dispositivo no está registrado. Tocá "Activar notificaciones".',
        suscripcion_invalida: 'La suscripción de este teléfono ya no es válida para el servicio push. Se dio de baja: volvé a activar las notificaciones.',
        envio_rechazado: 'El servicio push rechazó el envío. Reintentá en unos segundos; si persiste, volvé a activar las notificaciones.',
        error: 'No se pudo enviar la prueba.',
      }
      setMensaje({ tipo: 'error', texto: `${textos[r.resultado] || textos.error} Detalle: ${r.error}` })
    }
    setOcupado(null)
    await refrescar()
  }

  const e = diag?.estado
  const color = !e ? '#64748b' : e.ok ? '#10b981' : e.codigo === 'permiso_bloqueado' || e.codigo === 'ios_sin_pwa' ? '#ef4444' : '#f59e0b'

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: '#e2e8f0' }}>Estado de notificaciones</div>
        <button onClick={refrescar} disabled={cargando} style={{ background: 'none', border: '1px solid #1e2d42', color: '#94a3b8', borderRadius: 8, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
          {cargando ? '…' : '↻'}
        </button>
      </div>

      {cargando && !diag ? (
        <div style={{ color: '#64748b', fontSize: 13 }}>Revisando este dispositivo…</div>
      ) : e ? (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: `${color}14`, border: `1px solid ${color}55`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: color, marginTop: 4, flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 800, color, fontSize: 14 }}>{e.titulo}</div>
              <div style={{ color: '#cbd5e1', fontSize: 13, marginTop: 2 }}>{e.detalle}</div>
              {e.accion && <div style={{ color: '#fbbf24', fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>➜ {e.accion}</div>}
            </div>
          </div>

          <div style={fila}><span style={label}>Permiso de notificaciones</span><strong style={{ color: e.permisoTexto === 'Permitido' ? '#10b981' : e.permisoTexto === 'Bloqueado' ? '#ef4444' : '#f59e0b' }}>{e.permisoTexto}</strong></div>
          <div style={fila}><span style={label}>Service Worker</span><strong style={{ color: e.serviceWorkerTexto === 'Activo' ? '#10b981' : '#f59e0b' }}>{e.serviceWorkerTexto}</strong></div>
          <div style={fila}><span style={label}>Este dispositivo está suscripto</span><strong style={{ color: e.suscriptoTexto === 'Sí' ? '#10b981' : '#f59e0b' }}>{e.suscriptoTexto}</strong></div>
          <div style={fila}><span style={label}>Último envío a este usuario</span><span style={{ color: '#e2e8f0', textAlign: 'right' }}>{textoUltimoEnvio(diag?.ultimoEnvio)}{diag?.ultimoEnvioTitulo ? <div style={{ fontSize: 11, color: '#64748b' }}>{diag.ultimoEnvioTitulo}</div> : null}</span></div>

          <div style={{ display: 'grid', gridTemplateColumns: e.puedeActivar && e.puedeProbar ? '1fr 1fr' : '1fr', gap: 10, marginTop: 14 }}>
            {e.puedeActivar && (
              <button onClick={activar} disabled={ocupado !== null} style={{ ...btn, background: '#f59e0b', color: '#111827', opacity: ocupado ? 0.6 : 1 }}>
                {ocupado === 'activar' ? 'Activando…' : 'Activar notificaciones'}
              </button>
            )}
            {e.puedeProbar && (
              <button onClick={probar} disabled={ocupado !== null} style={{ ...btn, background: '#10b981', color: '#052e1c', opacity: ocupado ? 0.6 : 1 }}>
                {ocupado === 'probar' ? 'Enviando…' : 'Enviar notificación de prueba a este dispositivo'}
              </button>
            )}
          </div>

          {mensaje && (
            <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.5, color: mensaje.tipo === 'ok' ? '#10b981' : mensaje.tipo === 'error' ? '#fca5a5' : '#94a3b8' }}>
              {mensaje.texto}
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
