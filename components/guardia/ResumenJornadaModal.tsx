'use client'

// Resumen post-egreso (continuidad de Bloque C/D — Mi Planilla).
//
// Aparece apenas se registra la salida y, si el vigilador cierra la app sin
// responder, queda disponible después en Mi Planilla abriendo la misma fila:
// un solo componente, sin estado paralelo.
//
// Reutiliza exactamente las RPC ya existentes (aceptar_turno_planilla,
// solicitar_modificacion_planilla) y la regla accionesPrimerControl — no crea
// ninguna tabla, RPC ni regla nueva. Nunca modifica horas, turno, asistencia,
// GPS ni liquidación: solo dos acciones de trazabilidad.

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { track } from '@/lib/telemetry'
import {
  ETIQUETA_PRIMER_CONTROL, ETIQUETA_SALIDA_AUTOMATICA,
  accionesPrimerControl, formatearDuracionHoraMin, etiquetaEstadoGps,
} from '@/lib/primer-control'
import type { EstadoPrimerControl } from '@/lib/primer-control'

export interface ResumenJornadaModalProps {
  turnoId: string
  empleadoId: string
  objetivoNombre: string | null
  puestoNombre: string | null
  horaInicioProgramada: string | null
  horaFinProgramada: string | null
  horaEntradaRegistrada: string | null
  horaSalidaRegistrada: string | null
  horasTrabajadas: number | null
  salidaAutomatica: boolean
  gpsIngresoEstado: string | null
  gpsEgresoEstado: string | null
  estado: 'trabajado' | 'en_curso' | 'programado' | 'sin_programacion'
  estadoControlInicial: EstadoPrimerControl | null
  permiteAceptar: boolean
  esTitular: boolean
  onClose: () => void
  /** Se llama tras aceptar o solicitar con éxito, para que la pantalla que abrió el resumen refresque su propia lista. */
  onCambio?: () => void
}

const S = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 } as React.CSSProperties,
  card: { background: '#1e293b', borderRadius: 12, padding: 20, width: '100%', maxWidth: 420, border: '1px solid #334155' } as React.CSSProperties,
  titulo: { fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 } as React.CSSProperties,
  fila: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #0f172a', fontSize: 13 } as React.CSSProperties,
  etiqueta: { color: '#64748b' } as React.CSSProperties,
  valor: { color: '#e2e8f0', fontWeight: 600, textAlign: 'right' as const } as React.CSSProperties,
}

export default function ResumenJornadaModal(props: ResumenJornadaModalProps) {
  const { turnoId, empleadoId, onClose, onCambio } = props
  const [estadoControl, setEstadoControl] = useState<EstadoPrimerControl | null>(props.estadoControlInicial)
  const [accionando, setAccionando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mostrarFormSolicitud, setMostrarFormSolicitud] = useState(false)
  const [textoSolicitud, setTextoSolicitud] = useState('')

  const acciones = accionesPrimerControl({
    estado: props.estado,
    estado_control: estadoControl,
    permite_aceptar: props.permiteAceptar,
    turno_id: turnoId,
  }, props.esTitular)

  const aceptar = async () => {
    if (accionando) return
    setAccionando(true)
    setError(null)
    try {
      const { error: rpcError } = await supabase.rpc('aceptar_turno_planilla', { p_turno_id: turnoId })
      if (rpcError) throw new Error(rpcError.message)
      track('planilla_turno_aceptado', {
        screen: 'resumen_post_egreso',
        screen_section: 'planilla',
        category: 'guardia',
        turno_id: turnoId,
        value_json: { empleado_id: empleadoId, salida_automatica: props.salidaAutomatica },
      })
      setEstadoControl('aceptado')
      onCambio?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar la aceptación')
    } finally {
      setAccionando(false)
    }
  }

  const enviarSolicitud = async () => {
    if (accionando) return
    if (textoSolicitud.trim().length < 3) {
      setError('Debe indicar qué desea modificar')
      return
    }
    setAccionando(true)
    setError(null)
    try {
      const { error: rpcError } = await supabase.rpc('solicitar_modificacion_planilla', {
        p_turno_id: turnoId,
        p_texto: textoSolicitud.trim(),
      })
      if (rpcError) throw new Error(rpcError.message)
      track('planilla_modificacion_solicitada', {
        screen: 'resumen_post_egreso',
        screen_section: 'planilla',
        category: 'guardia',
        turno_id: turnoId,
        value_json: { empleado_id: empleadoId },
      })
      setEstadoControl('modificacion_solicitada')
      setMostrarFormSolicitud(false)
      setTextoSolicitud('')
      onCambio?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar la solicitud')
    } finally {
      setAccionando(false)
    }
  }

  return (
    <div style={S.overlay} onClick={() => { if (!accionando) onClose() }}>
      <div style={S.card} onClick={e => e.stopPropagation()}>
        <div style={S.titulo}>Resumen de la jornada</div>

        <div style={S.fila}><span style={S.etiqueta}>Objetivo</span><span style={S.valor}>{props.objetivoNombre ?? '—'}</span></div>
        <div style={S.fila}><span style={S.etiqueta}>Posición operativa</span><span style={S.valor}>{props.puestoNombre ?? '—'}</span></div>
        <div style={S.fila}><span style={S.etiqueta}>Horario programado</span><span style={S.valor}>{props.horaInicioProgramada ?? '—'} – {props.horaFinProgramada ?? '—'}</span></div>
        <div style={S.fila}><span style={S.etiqueta}>Horario registrado</span><span style={S.valor}>{props.horaEntradaRegistrada ?? '—'} – {props.horaSalidaRegistrada ?? '—'}</span></div>
        <div style={S.fila}><span style={S.etiqueta}>Tiempo trabajado</span><span style={S.valor}>{formatearDuracionHoraMin(props.horasTrabajadas)}</span></div>
        <div style={S.fila}><span style={S.etiqueta}>GPS ingreso</span><span style={S.valor}>{etiquetaEstadoGps(props.gpsIngresoEstado)}</span></div>
        <div style={{ ...S.fila, borderBottom: 'none' }}><span style={S.etiqueta}>GPS egreso</span><span style={S.valor}>{etiquetaEstadoGps(props.gpsEgresoEstado)}</span></div>

        {props.salidaAutomatica && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#f59e0b', background: '#f59e0b18', border: '1px solid #f59e0b55', borderRadius: 6, padding: '6px 10px' }}>
            {ETIQUETA_SALIDA_AUTOMATICA}: la salida se cerró automáticamente, no fue fichada.
          </div>
        )}

        {error && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 10 }}>{error}</div>}

        {estadoControl === 'aceptado' && (
          <div style={{ marginTop: 14, textAlign: 'center' as const, color: '#10b981', fontSize: 13, fontWeight: 600 }}>
            ✓ {ETIQUETA_PRIMER_CONTROL.aceptado}
          </div>
        )}
        {estadoControl === 'modificacion_solicitada' && (
          <div style={{ marginTop: 14, textAlign: 'center' as const, color: '#f59e0b', fontSize: 13, fontWeight: 600 }}>
            {ETIQUETA_PRIMER_CONTROL.modificacion_solicitada}
          </div>
        )}

        {estadoControl === 'pendiente' && !mostrarFormSolicitud && (acciones.aceptar || acciones.solicitar) && (
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            {acciones.aceptar && (
              <button
                style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #16653488', background: '#14532d', color: '#4ade80', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: accionando ? 0.6 : 1 }}
                disabled={accionando}
                onClick={aceptar}
              >
                {accionando ? 'Aceptando…' : 'Aceptar'}
              </button>
            )}
            {acciones.solicitar && (
              <button
                style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #92400e88', background: '#78350f', color: '#fbbf24', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                disabled={accionando}
                onClick={() => { setMostrarFormSolicitud(true); setError(null) }}
              >
                Solicitar modificación
              </button>
            )}
          </div>
        )}

        {estadoControl === 'pendiente' && !acciones.aceptar && !acciones.solicitar && (
          <div style={{ marginTop: 14, textAlign: 'center' as const, color: '#64748b', fontSize: 12 }}>
            {ETIQUETA_PRIMER_CONTROL.pendiente}
          </div>
        )}

        {mostrarFormSolicitud && (
          <div style={{ marginTop: 14 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>¿Qué desea modificar? *</label>
            <textarea
              value={textoSolicitud}
              onChange={e => setTextoSolicitud(e.target.value)}
              rows={4}
              placeholder="Ej.: La salida correcta fue a las 07:00."
              style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: 10, fontSize: 13, resize: 'vertical' as const, boxSizing: 'border-box' as const }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
              <button
                style={{ padding: '10px 0', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}
                disabled={accionando}
                onClick={() => { setMostrarFormSolicitud(false); setError(null) }}
              >
                Cancelar
              </button>
              <button
                style={{ padding: '10px 0', borderRadius: 8, border: '1px solid #92400e', background: '#78350f', color: '#fbbf24', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: accionando || textoSolicitud.trim().length < 3 ? 0.5 : 1 }}
                disabled={accionando || textoSolicitud.trim().length < 3}
                onClick={enviarSolicitud}
              >
                {accionando ? 'Enviando…' : 'Enviar solicitud'}
              </button>
            </div>
          </div>
        )}

        <button
          style={{ width: '100%', marginTop: 16, padding: '8px 0', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#64748b', fontSize: 12, cursor: 'pointer' }}
          onClick={onClose}
        >
          Cerrar
        </button>
      </div>
    </div>
  )
}
