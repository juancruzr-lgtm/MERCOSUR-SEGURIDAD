'use client'

/**
 * components/bajas/SituacionLaboral.tsx
 *
 * En el Legajo (Administración/Gerencia): situación laboral, fecha de baja,
 * motivo, documentación y estado de la liquidación final, con el botón
 * REGISTRAR BAJA que abre el mismo procedimiento que Guardias.
 */

import { useEffect, useState } from 'react'
import RegistrarBaja from '@/components/bajas/RegistrarBaja'
import { accesoDeEmpleado, bajasDeEmpleado, cargarCausas, documentosDeBaja, estadoLiquidacionDeBaja, type BajaFila } from '@/lib/baja-laboral'

const ESTADO_LIQ: Record<string, string> = {
  pendiente_calculo: 'pendiente de cálculo', borrador: 'borrador', lista: 'lista para exportar',
  exportada: 'exportada a Visual', conciliada: 'conciliada', anulada: 'anulada',
}
const fecha = (iso?: string | null) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—')

export default function SituacionLaboral({ empleadoId, estado, puedeGerencia, abrirAlCargar = false, origen = 'legajo' }: {
  empleadoId: string
  estado: string | null
  puedeGerencia: boolean
  abrirAlCargar?: boolean
  origen?: 'legajo' | 'arca'
}) {
  const [baja, setBaja] = useState<BajaFila | null>(null)
  const [causa, setCausa] = useState<string | null>(null)
  const [docs, setDocs] = useState(0)
  const [liq, setLiq] = useState<string | null>(null)
  const [acceso, setAcceso] = useState<{ bloqueado: boolean; auth: boolean } | null>(null)
  const [abierto, setAbierto] = useState(abrirAlCargar)
  const [sinTabla, setSinTabla] = useState(false)

  async function cargar() {
    const r = await bajasDeEmpleado(empleadoId)
    if (r.error) { setSinTabla(true); return }
    const actual = r.data.find(b => b.estado !== 'anulada') ?? null
    setBaja(actual)
    setAcceso(await accesoDeEmpleado(empleadoId))
    if (actual) {
      const causas = await cargarCausas()
      setCausa(causas.find(c => c.codigo === actual.causa)?.nombre ?? actual.causa)
      setDocs((await documentosDeBaja(actual.id)).length)
      setLiq((await estadoLiquidacionDeBaja(actual.id))?.estado ?? null)
    }
  }
  useEffect(() => { void cargar() }, [empleadoId])

  if (sinTabla) return null
  const desvinculado = baja?.estado === 'confirmada'

  return (
    <div style={{ background: '#111827', border: `1px solid ${desvinculado ? '#7f1d1d' : '#1e2d42'}`, borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ color: '#e2e8f0' }}>
          <div style={{ fontWeight: 800 }}>Situación laboral: {desvinculado ? 'desvinculado' : estado === 'activo' ? 'activo' : 'inactivo'}</div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>
            {baja
              ? <>Baja {baja.estado === 'borrador' ? 'en borrador' : 'confirmada'} · fecha {fecha(baja.fecha_baja)} · {causa ?? 'motivo sin cargar'} · documentos: {docs}{liq ? ` · liquidación final: ${ESTADO_LIQ[liq] ?? liq}` : ''}</>
              : 'Sin baja registrada.'}
            {acceso?.bloqueado && <> · <span style={{ color: '#f87171' }}>acceso bloqueado{acceso.auth ? '' : ' (falta bloquear la cuenta)'}</span></>}
          </div>
        </div>
        <button type="button" onClick={() => setAbierto(true)}
          style={{ background: desvinculado ? 'transparent' : '#7f1d1d', color: desvinculado ? '#cbd5e1' : '#fff', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', fontWeight: 800, cursor: 'pointer' }}>
          {baja ? (baja.estado === 'borrador' ? 'Continuar baja' : 'Ver baja') : 'REGISTRAR BAJA'}
        </button>
      </div>
      {abierto && (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,.75)', zIndex: 60, overflowY: 'auto', padding: '16px 12px' }}>
          <div style={{ maxWidth: 860, margin: '0 auto', background: '#0f1629', border: '1px solid #1e293b', borderRadius: 12, padding: 14 }}>
            <RegistrarBaja empleadoId={empleadoId} origen={origen} puedeGerencia={puedeGerencia} onCerrar={() => setAbierto(false)} onCambio={() => void cargar()} />
          </div>
        </div>
      )}
    </div>
  )
}
