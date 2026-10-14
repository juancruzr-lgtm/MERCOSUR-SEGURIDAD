'use client'

/**
 * components/guardia/AvisoTramite.tsx
 *
 * Tarjeta en la app del vigilador mientras tiene un trámite de credencial en
 * curso: qué gestiones personales le faltan (DNI, antecedentes, fotos 2×2,
 * Art. 51, Medicina Legal, devolver los anexos). No es un modal ni bloquea:
 * son trámites que hace cuando puede. El DNI y los antecedentes los sube desde
 * acá cuando los tiene; quedan para revisar y, aprobados, la gestión queda
 * hecha sola. Los estudios médicos los carga Administración. Ante cualquier
 * error no se muestra.
 */

import { useCallback, useEffect, useState } from 'react'
import { subirDocumento } from '@/lib/documentacion-datos'
import { validarFechas } from '@/lib/documentacion'
import { TIPOS_TRAMITE, cargarMisPendientes, textoPaso } from '@/lib/credencial-pedido'
import type { MisPendientes, PasoPersonal } from '@/lib/credencial-pedido'

const hoyAr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#0a0e1a', border: '1px solid #1e2d42', color: '#e2e8f0', borderRadius: 8, padding: '9px 11px', fontSize: 15 }

function Subir({ empleadoId, paso, onListo }: { empleadoId: string; paso: PasoPersonal; onListo: () => void }) {
  const tipo = TIPOS_TRAMITE[paso.tipo_documento ?? '']
  const caras = tipo?.caras ?? ['Archivo']
  const [archivos, setArchivos] = useState<(File | null)[]>(caras.map(() => null))
  const [emision, setEmision] = useState('')
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!tipo) return null
  const enviar = async () => {
    if (archivos.some(a => !a)) { setError(caras.length > 1 ? `Faltan fotos: ${caras.join(' y ')}.` : 'Elegí la foto o el PDF.'); return }
    const f = validarFechas(tipo, emision, '', hoyAr())
    if (f) { setError(f); return }
    setError(null)
    const r = await subirDocumento({ empleadoId, tipo, fechaEmision: emision || null, venceEl: null, detalle: null, archivos: archivos as File[], onProgreso: setOcupado })
    setOcupado(null)
    if (r.error) { setError(r.error); return }
    onListo()
  }
  return (
    <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: '#0b1220', border: '1px solid #1e2d42' }}>
      {caras.map((c, i) => (
        <label key={c} style={{ display: 'block', fontSize: 13.5, color: '#cbd5e1', marginBottom: 6 }}>
          {caras.length > 1 ? `Foto del ${c.toLowerCase()}` : 'Foto o PDF del certificado'}
          <input type="file" accept={caras.length > 1 ? 'image/*' : 'image/*,application/pdf'} style={{ ...input, padding: 6, marginTop: 4 }}
            onChange={e => { const n = [...archivos]; n[i] = e.target.files?.[0] ?? null; setArchivos(n) }} />
        </label>
      ))}
      {tipo.campo_fecha !== 'no' && (
        <label style={{ display: 'block', fontSize: 13.5, color: '#cbd5e1' }}>
          Fecha del certificado
          <input type="date" value={emision} max={hoyAr()} onChange={e => setEmision(e.target.value)} style={{ ...input, marginTop: 4 }} />
        </label>
      )}
      {error && <div role="alert" style={{ fontSize: 13, color: '#f87171', marginTop: 6 }}>{error}</div>}
      {ocupado && <div role="status" style={{ fontSize: 13, color: '#93c5fd', marginTop: 6 }}>{ocupado}</div>}
      <button type="button" disabled={!!ocupado} onClick={() => void enviar()}
        style={{ marginTop: 8, width: '100%', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, padding: 10, fontSize: 14.5, fontWeight: 700, cursor: 'pointer' }}>
        Enviar
      </button>
    </div>
  )
}

export default function AvisoTramite({ empleadoId }: { empleadoId: string }) {
  const [datos, setDatos] = useState<MisPendientes | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)
  const cargar = useCallback(async () => { setDatos(await cargarMisPendientes().catch(() => ({ tramite: null, pasos: [] }))) }, [])
  useEffect(() => { void cargar() }, [cargar])
  if (!datos?.tramite || !datos.pasos.length) return null
  return (
    <section aria-label="Tu trámite de credencial" style={{
      background: 'rgba(245,158,11,.07)', border: '1px solid rgba(245,158,11,.4)', borderLeft: '4px solid #f59e0b',
      borderRadius: 10, padding: '14px 14px 12px', marginBottom: 12, color: '#e2e8f0',
    }}>
      <div style={{ fontWeight: 800, fontSize: 14.5, color: '#fbbf24' }}>
        Tu {datos.tramite.tipo === 'renovacion' ? 'renovación de credencial' : 'trámite de credencial'}: te falta
      </div>
      <div style={{ fontSize: 12.5, color: '#94a3b8', margin: '2px 0 8px' }}>Son trámites personales: hacelos cuando puedas. Si tenés dudas, consultá en la oficina.</div>
      {datos.pasos.map(p => (
        <div key={p.codigo} style={{ padding: '7px 0', borderTop: '1px solid rgba(148,163,184,.15)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 14, color: p.estado === 'recibido' ? '#86efac' : '#e2e8f0' }}>{p.estado === 'recibido' ? '✓ ' : '• '}{p.nombre}</span>
            {p.puede_subir && abierto !== p.codigo && (
              <button type="button" onClick={() => setAbierto(p.codigo)} style={{ background: 'transparent', color: '#93c5fd', border: '1px solid #334155', borderRadius: 8, padding: '5px 10px', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>Subir</button>
            )}
          </div>
          {textoPaso(p) && <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>{textoPaso(p)}</div>}
          {abierto === p.codigo && <Subir empleadoId={empleadoId} paso={p} onListo={() => { setAbierto(null); void cargar() }} />}
        </div>
      ))}
    </section>
  )
}
