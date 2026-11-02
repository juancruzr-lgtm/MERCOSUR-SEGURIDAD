'use client'

/**
 * Sección "Diagnóstico" del perfil (vigilador y supervisor). Se carga recién
 * al abrirla: medir la caché recorre sus entradas y no hace falta en cada
 * render del perfil.
 *
 * "Liberar espacio" borra SÓLO las cachés del Service Worker (app-shell,
 * íconos). No toca sesión, pendientes de protocolos, intentos de ingreso ni
 * la copia local de protocolos.
 */

import { useCallback, useState } from 'react'
import {
  formatearBytes, liberarCaches, recolectarDiagnostico, textoDiagnostico, type Diagnostico,
} from '@/lib/diagnostico-dispositivo'
import { ultimaActualizacion as ultimaActualizacionGlobal } from '@/lib/refresco-movil'

const s = {
  caja: { marginTop: 16, paddingTop: 12, borderTop: '1px solid #1e293b' } as const,
  titulo: { fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#94a3b8' } as const,
  fila: { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '3px 0', color: '#e2e8f0' } as const,
  etiqueta: { color: '#94a3b8' } as const,
  boton: {
    padding: '8px 12px', borderRadius: 10, border: '1px solid #334155', background: '#0f172a',
    color: '#e2e8f0', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  } as const,
}

export default function DiagnosticoDispositivo({
  ultimaActualizacion = null,
  pendientes = [],
}: {
  ultimaActualizacion?: Date | number | null
  pendientes?: Array<{ etiqueta: string; cantidad: number }>
}) {
  const [abierto, setAbierto] = useState(false)
  const [d, setD] = useState<Diagnostico | null>(null)
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const medir = useCallback(async () => {
    setOcupado(true)
    try {
      setD(await recolectarDiagnostico({
        pendientes,
        ultimaActualizacion: ultimaActualizacion ?? ultimaActualizacionGlobal(),
      }))
    } finally {
      setOcupado(false)
    }
  }, [pendientes, ultimaActualizacion])

  const abrir = () => {
    setAbierto(v => !v)
    if (!abierto) void medir()
  }

  const liberar = async () => {
    setOcupado(true)
    try {
      const n = await liberarCaches()
      setAviso(n > 0 ? `Listo: se borraron ${n} caché${n === 1 ? '' : 's'} de la app.` : 'No había caché para borrar.')
    } catch {
      setAviso('No se pudo liberar el espacio.')
    }
    await medir()
  }

  const copiar = async () => {
    if (!d) return
    const texto = textoDiagnostico(d)
    try {
      await navigator.clipboard.writeText(texto)
      setAviso('Diagnóstico copiado. Pegalo en el chat con soporte.')
    } catch {
      // Sin permiso de portapapeles: se muestra para copiar a mano.
      window.prompt('Copiá el diagnóstico:', texto)
    }
  }

  return (
    <div style={s.caja}>
      <button type="button" style={{ ...s.boton, width: '100%', textAlign: 'left' }} onClick={abrir}>
        {abierto ? '▾' : '▸'} Diagnóstico del teléfono
      </button>
      {abierto && (
        <div style={{ marginTop: 10 }}>
          {!d ? (
            <div style={{ fontSize: 13, color: '#94a3b8' }}>Midiendo…</div>
          ) : (
            <>
              <div style={s.fila}><span style={s.etiqueta}>Versión</span><span>{d.version}</span></div>
              <div style={s.fila}>
                <span style={s.etiqueta}>Conexión</span>
                <span>{d.enLinea === null ? '—' : d.enLinea ? 'En línea' : 'Sin conexión'}{d.tipoConexion ? ` · ${d.tipoConexion}` : ''}</span>
              </div>
              <div style={s.fila}>
                <span style={s.etiqueta}>Espacio usado</span>
                <span>{formatearBytes(d.usoBytes)} de {formatearBytes(d.cuotaBytes)}</span>
              </div>
              <div style={s.fila}>
                <span style={s.etiqueta}>Caché de la app</span>
                <span>{formatearBytes(d.cacheBytes)} · {d.cacheEntradas ?? 0} archivos</span>
              </div>
              {d.pendientes.map(p => (
                <div key={p.etiqueta} style={s.fila}>
                  <span style={s.etiqueta}>{p.etiqueta}</span>
                  <span style={{ color: p.cantidad > 0 ? '#fbbf24' : undefined }}>{p.cantidad}</span>
                </div>
              ))}
              <div style={s.fila}><span style={s.etiqueta}>Última actualización</span><span>{d.ultimaActualizacion ?? '—'}</span></div>
              <div style={s.fila}><span style={s.etiqueta}>Dispositivo</span><span>{d.dispositivo ?? '—'}</span></div>
            </>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button type="button" style={s.boton} disabled={ocupado} onClick={liberar}>Liberar espacio</button>
            <button type="button" style={s.boton} disabled={!d} onClick={copiar}>Copiar diagnóstico</button>
          </div>
          {aviso && <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 8 }}>{aviso}</div>}
        </div>
      )}
    </div>
  )
}
