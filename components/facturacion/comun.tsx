'use client'
// Estilos y piezas chicas compartidas por las pantallas de Facturación
// (mismo lenguaje visual que Liquidación).
import { useRef, useState } from 'react'
import { formatoPesos } from '@/lib/facturacion/dinero'
import { fechaCompleta } from '@/lib/facturacion/fecha-campo'

export const S: Record<string, React.CSSProperties> = {
  card: { background: '#0f1629', border: '1px solid #1e293b', borderRadius: 10, padding: 16, marginBottom: 16 },
  input: { padding: '8px 10px', background: '#0a0e1a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 14 },
  btn: { padding: '8px 14px', background: '#2563eb', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btn2: { padding: '8px 14px', background: 'transparent', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  btnPeligro: { padding: '8px 14px', background: 'transparent', color: '#f87171', border: '1px solid #7f1d1d', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  th: { textAlign: 'left', fontSize: 11, color: '#64748b', padding: '6px 8px', borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap' },
  td: { fontSize: 13, padding: '6px 8px', borderBottom: '1px solid #131c2e', verticalAlign: 'top' },
  num: { fontSize: 13, padding: '6px 8px', borderBottom: '1px solid #131c2e', verticalAlign: 'top', textAlign: 'right', whiteSpace: 'nowrap' },
  err: { color: '#f87171', fontSize: 13 }, ok: { color: '#4ade80', fontSize: 13 }, sub: { color: '#64748b', fontSize: 12 },
  h3: { margin: '0 0 10px', fontSize: 15, color: '#e2e8f0' },
  fila: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  aviso: { background: '#1c1917', border: '1px solid #78350f', color: '#fbbf24', borderRadius: 6, padding: '8px 10px', fontSize: 13 },
}

/**
 * Campo de fecha que guarda recién al salir del campo o con Enter, no en cada tecla: así se puede tipear
 * la fecha completa (DD/MM/AAAA con el teclado numérico) sin que la pantalla se recargue a mitad de
 * camino y se pierda el foco.
 */
export function FechaAlSalir({ valor, alGuardar, disabled, style, title }: {
  valor: string | null; alGuardar: (v: string | null) => void; disabled?: boolean; style?: React.CSSProperties; title?: string
}) {
  const [v, setV] = useState(valor ?? '')
  const [editando, setEditando] = useState(false)
  const mostrado = editando ? v : (valor ?? '')
  const guardar = () => {
    setEditando(false)
    if (!fechaCompleta(v)) { setV(valor ?? ''); return }
    if (v !== (valor ?? '')) alGuardar(v || null)
  }
  return <input type="date" style={style} title={title} disabled={disabled} value={mostrado}
    onFocus={() => { setV(valor ?? ''); setEditando(true) }}
    onChange={e => { setEditando(true); setV(e.target.value) }}
    onBlur={guardar}
    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
}

export const pesos = (c: unknown) => (c == null || c === '' ? '—' : formatoPesos(Number(c)))
export const fecha = (iso?: string | null) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—')
export const horas = (min?: number | null) => (min == null ? '—' : (Number(min) / 60).toLocaleString('es-AR', { maximumFractionDigits: 2 }))
/** '$ 1.234,56' / '1234.56' / '1234,56' → centavos. */
export function centavosDe(s: string): number | null {
  const t = s.trim().replace(/\$|\s/g, '')
  if (!t) return null
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

export function Etiqueta({ texto, color = '#334155' }: { texto: string; color?: string }) {
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, border: `1px solid ${color}`, fontSize: 11, color: '#cbd5e1', whiteSpace: 'nowrap' }}>{texto}</span>
}

export const COLOR_ESTADO: Record<string, string> = {
  en_preparacion: '#475569', esperando_requisitos: '#b45309', lista_revision: '#2563eb', aprobada_emitir: '#7c3aed', emitida: '#15803d', descartada: '#7f1d1d',
}

/** Ejecuta una acción mostrando ocupado / error / éxito. */
export function useAccion() {
  const [ocupado, setOcupado] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null)
  // Candado sincrónico: `ocupado` deshabilita el botón recién en el próximo render, y un doble clic
  // llegaba a disparar la acción dos veces (cobros duplicados).
  const enCurso = useRef(false)
  async function correr(fn: () => Promise<unknown>, exito?: string) {
    if (enCurso.current) return
    enCurso.current = true; setOcupado(true); setMsg(null)
    try { await fn(); if (exito) setMsg({ tipo: 'ok', texto: exito }) } catch (e: any) { setMsg({ tipo: 'err', texto: e?.message ?? String(e) }) } finally { enCurso.current = false; setOcupado(false) }
  }
  const Mensaje = () => (msg ? <div style={msg.tipo === 'ok' ? S.ok : S.err}>{msg.texto}</div> : null)
  return { ocupado, correr, Mensaje, setMsg }
}

export function mesActual(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7)
}
