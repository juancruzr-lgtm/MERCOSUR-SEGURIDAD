'use client'

/**
 * components/habilitacion/CargaCredencialAdmin.tsx
 *
 * Administración carga la credencial de un vigilador (por ejemplo, la renovada
 * que llega a la oficina antes de entregársela y se escanea). Sigue el mismo
 * camino que la foto que sube el vigilador: la IA lee la tarjeta (apellido, DNI,
 * número, emisión y vencimiento), la recorta y la endereza, y el documento queda
 * «para revisar»; al validarlo cuenta como «tiene credencial» y se copia al
 * servidor. No espera que el vigilador la acepte.
 *
 * Acepta fotos o PDF (del PDF se usa la primera página). También sirve para
 * reprocesar una carga anterior (`iniciales`): la nueva reemplaza a la pendiente.
 */

import { useEffect, useRef, useState } from 'react'
import { subirDocumento } from '@/lib/documentacion-datos'
import { TIPO_CREDENCIAL, avisoVencimiento, validarPedido } from '@/lib/credencial-pedido'
import { resumenLectura } from '@/lib/credencial-lectura'
import type { LecturaCredencial } from '@/lib/credencial-lectura'
import { girarFoto, leerYRecortar } from '@/lib/credencial-lectura-cliente'

type Cara = 'Frente' | 'Dorso'
const hoyAr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
const btn = (tipo: 'ok' | 'sec', activo = true): React.CSSProperties => ({
  background: tipo === 'ok' && activo ? '#16a34a' : 'transparent', color: !activo ? '#64748b' : tipo === 'ok' ? '#fff' : '#cbd5e1',
  border: tipo === 'ok' ? 'none' : '1px solid #334155', borderRadius: 8, padding: '9px 14px', fontSize: 14, fontWeight: 700,
  cursor: activo ? 'pointer' : 'not-allowed',
})

function Cara({ cara, archivo, leyendo, onElegir, onGirar }: {
  cara: Cara; archivo: File | null; leyendo: boolean; onElegir: (f: File) => void; onGirar: () => void
}) {
  const [vista, setVista] = useState<string | null>(null)
  useEffect(() => {
    if (!archivo || archivo.type === 'application/pdf') { setVista(null); return }
    const u = URL.createObjectURL(archivo); setVista(u)
    return () => URL.revokeObjectURL(u)
  }, [archivo])
  return (
    <label style={{ display: 'block', flex: '1 1 160px', minWidth: 0, border: `1px dashed ${archivo ? '#16a34a' : '#334155'}`, borderRadius: 10, padding: 8, textAlign: 'center', cursor: 'pointer' }}>
      {vista
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={vista} alt={cara} style={{ width: '100%', height: 130, objectFit: 'contain', borderRadius: 6, opacity: leyendo ? 0.4 : 1, background: '#0b1220' }} />
        : <div style={{ height: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>{archivo ? '📄' : '🖼️'}</div>}
      <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 6, color: leyendo ? '#93c5fd' : archivo ? '#86efac' : '#cbd5e1' }}>
        {leyendo ? 'Leyendo y recortando…' : archivo ? `✓ ${cara}` : `${cara}: foto o PDF`}
      </div>
      <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onElegir(f) }} />
      {archivo && !leyendo && archivo.type !== 'application/pdf' && (
        <button type="button" onClick={e => { e.preventDefault(); onGirar() }}
          style={{ marginTop: 6, background: 'transparent', color: '#93c5fd', border: '1px solid #334155', borderRadius: 8, padding: '4px 10px', fontSize: 13, cursor: 'pointer' }}>↻ Girar</button>
      )}
    </label>
  )
}

export default function CargaCredencialAdmin({ empleadoId, iniciales, onListo, onCancelar }: {
  empleadoId: string
  /** Archivos de una carga anterior para volver a procesar (frente y dorso). */
  iniciales?: Partial<Record<Cara, File>>
  onListo: () => void
  onCancelar: () => void
}) {
  const [archivos, setArchivos] = useState<Record<Cara, File | null>>({ Frente: null, Dorso: null })
  const [leyendo, setLeyendo] = useState<Record<Cara, boolean>>({ Frente: false, Dorso: false })
  const [lectura, setLectura] = useState<LecturaCredencial | null>(null)
  const [vence, setVence] = useState('')
  const venceDeIA = useRef(false)
  const [progreso, setProgreso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const elegir = async (cara: Cara, original: File) => {
    setArchivos(a => ({ ...a, [cara]: original })); setLeyendo(l => ({ ...l, [cara]: true }))
    const r = await leerYRecortar(original, empleadoId)
    setArchivos(a => ({ ...a, [cara]: r.foto })); setLeyendo(l => ({ ...l, [cara]: false }))
    if (cara !== 'Frente') return
    setLectura(r.lectura)
    if (r.lectura?.vencimiento) {
      setVence(v => (!v || venceDeIA.current ? r.lectura!.vencimiento! : v)); venceDeIA.current = true
    }
  }

  // Reprocesar: se leen y recortan los archivos de la carga anterior al abrir.
  const iniciado = useRef(false)
  useEffect(() => {
    if (iniciado.current || !iniciales) return
    iniciado.current = true
    if (iniciales.Frente) void elegir('Frente', iniciales.Frente)
    if (iniciales.Dorso) void elegir('Dorso', iniciales.Dorso)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const girar = async (cara: Cara) => {
    const f = archivos[cara]; if (!f) return
    const g = await girarFoto(f).catch(() => f)
    setArchivos(a => ({ ...a, [cara]: g }))
  }

  const ocupado = progreso !== null || leyendo.Frente || leyendo.Dorso
  const enviar = async () => {
    const inval = validarPedido({ frente: archivos.Frente, dorso: archivos.Dorso, venceEl: vence, hoy: hoyAr() })
    if (inval) { setError(inval); return }
    setError(null)
    const r = await subirDocumento({
      empleadoId, tipo: TIPO_CREDENCIAL, fechaEmision: lectura?.emision ?? null, venceEl: vence,
      detalle: resumenLectura(lectura), archivos: [archivos.Frente!, archivos.Dorso!], onProgreso: setProgreso,
    })
    setProgreso(null)
    if (r.error) { setError(r.error); return }
    onListo()
  }

  const aviso = avisoVencimiento(vence, hoyAr())
  return (
    <div style={{ marginTop: 10, padding: 10, borderRadius: 10, border: '1px solid #334155', background: '#0b1220' }}>
      <div style={{ fontSize: 13.5, color: '#cbd5e1', marginBottom: 8, lineHeight: 1.45 }}>
        Cargá el frente y el dorso (foto o escaneo en PDF). La IA lee la tarjeta, la recorta y completa el vencimiento.
        Queda para revisar; el vigilador no tiene que aceptarla.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(['Frente', 'Dorso'] as Cara[]).map(c => (
          <Cara key={c} cara={c} archivo={archivos[c]} leyendo={leyendo[c]} onElegir={f => void elegir(c, f)} onGirar={() => void girar(c)} />
        ))}
      </div>
      {lectura && (
        <div style={{ fontSize: 12.5, color: lectura.es_credencial ? '#93c5fd' : '#fbbf24', marginTop: 8, lineHeight: 1.45 }}>
          {!lectura.es_credencial
            ? 'La IA no reconoce una credencial de vigilador en el frente: revisá el archivo.'
            : <>
                Leído por IA: {[lectura.apellido && `${lectura.apellido}${lectura.nombre ? ` ${lectura.nombre}` : ''}`, lectura.dni && `DNI ${lectura.dni}`, lectura.numero && `N° ${lectura.numero}`].filter(Boolean).join(' · ') || 'sin datos legibles'}
                {lectura.dni_coincide === false && <span style={{ color: '#fca5a5', fontWeight: 700 }}> · el DNI no coincide con el de esta persona</span>}
              </>}
        </div>
      )}
      <label style={{ display: 'block', fontSize: 13, color: '#cbd5e1', marginTop: 10 }}>
        Vence el (como se lee en la tarjeta) *
        <input type="date" value={vence} onChange={e => { setVence(e.target.value); venceDeIA.current = false }}
          style={{ display: 'block', marginTop: 4, background: '#0b1220', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '8px 10px', fontSize: 14 }} />
      </label>
      {aviso && <div style={{ fontSize: 12.5, color: '#fbbf24', marginTop: 4 }}>{aviso}</div>}
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 6 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button type="button" style={btn('ok', !ocupado && !!archivos.Frente && !!archivos.Dorso)} disabled={ocupado || !archivos.Frente || !archivos.Dorso}
          onClick={() => void enviar()}>{progreso ?? 'Cargar para revisar'}</button>
        <button type="button" style={btn('sec', !ocupado)} disabled={progreso !== null} onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}
