'use client'

/**
 * components/postulantes/PostulantesPanel.tsx
 *
 * Lista de postulaciones (Entrevistado → Revisado → Aprobado para ingreso →
 * Alta efectiva / Descartado) y entrada a "Nuevo vigilador". La usan:
 *   - Administración y Gerencia, desde Legajo Digital → Postulantes (ven todas);
 *   - supervisores habilitados, desde su app (ven sólo las que cargaron).
 * Qué ve y qué puede hacer cada uno lo decide la base.
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import FichaPostulante, { type LecturaPropuesta } from '@/components/postulantes/FichaPostulante'
import {
  COLOR_ESTADO, ETIQUETA_ESTADO, dniEnmascarado, mensajeError,
  type ApiPostulantes, type EstadoPostulacion, type Postulacion,
} from '@/lib/postulantes'

type Filtro = 'abiertas' | EstadoPostulacion

const FILTROS: [Filtro, string][] = [
  ['abiertas', 'Abiertas'], ['entrevistado', 'Entrevistado'], ['revisado', 'Revisado'],
  ['aprobado_ingreso', 'Aprobado'], ['alta_efectiva', 'Alta efectiva'], ['descartado', 'Descartado'],
]
const ABIERTAS: EstadoPostulacion[] = ['entrevistado', 'revisado', 'aprobado_ingreso']

const chip = (activo: boolean): CSSProperties => ({
  background: activo ? '#1e293b' : 'transparent', color: activo ? '#e2e8f0' : '#94a3b8',
  border: '1px solid ' + (activo ? '#334155' : '#1f2937'), borderRadius: 999, padding: '7px 12px',
  fontWeight: activo ? 800 : 600, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 36,
})

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric' })

export default function PostulantesPanel({ api, lector }: {
  api: ApiPostulantes
  lector?: (postulacionId: string) => Promise<LecturaPropuesta>
}) {
  const [lista, setLista] = useState<Postulacion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [permisos, setPermisos] = useState<{ gestiona: boolean; carga: boolean } | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('abiertas')
  const [abierta, setAbierta] = useState<{ id: string | null; clave: string } | null>(null)

  const cargar = useCallback(async () => {
    try { setLista(await api.listar()); setError(null) } catch (e) { setError(mensajeError(e)) }
  }, [api])
  useEffect(() => {
    void cargar()
    api.permisos().then(setPermisos).catch(() => setPermisos({ gestiona: false, carga: false }))
  }, [api, cargar])

  const cuenta = useMemo(() => {
    const c: Record<string, number> = { abiertas: 0 }
    for (const p of lista ?? []) { c[p.estado] = (c[p.estado] ?? 0) + 1; if (ABIERTAS.includes(p.estado)) c.abiertas += 1 }
    return c
  }, [lista])

  const visibles = (lista ?? []).filter(p => filtro === 'abiertas' ? ABIERTAS.includes(p.estado) : p.estado === filtro)

  if (abierta && permisos) {
    const p = abierta.id ? (lista ?? []).find(x => x.id === abierta.id) ?? null : null
    return (
      <FichaPostulante
        key={abierta.clave}
        api={api}
        postulacion={p}
        permisos={permisos}
        lector={lector}
        onVolver={() => { setAbierta(null); void cargar() }}
        onCambio={async id => { await cargar(); setAbierta(a => (a && !a.id ? { ...a, id } : a)) }}
      />
    )
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#e2e8f0', flex: '1 1 auto' }}>Postulantes</div>
        {permisos?.carga && (
          <button type="button" onClick={() => setAbierta({ id: null, clave: `nueva-${Date.now()}` })}
            style={{ minHeight: 44, padding: '10px 16px', borderRadius: 10, border: 'none', background: '#eab308', color: '#0a0e1a', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
            + Nuevo vigilador
          </button>
        )}
      </div>
      <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>
        Entrevistado → Revisado → Aprobado para ingreso → Alta efectiva. Un postulante no es empleado: no recibe turnos ni tiene acceso hasta el alta.
      </div>
      <div role="tablist" aria-label="Filtrar por estado" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 12 }}>
        {FILTROS.map(([f, t]) => (
          <button key={f} type="button" role="tab" aria-selected={filtro === f} onClick={() => setFiltro(f)} style={chip(filtro === f)}>
            {t}{cuenta[f] ? ` · ${cuenta[f]}` : ''}
          </button>
        ))}
      </div>
      {error && <div role="alert" style={{ color: '#fca5a5', background: '#111827', border: '1px solid rgba(239,68,68,.4)', borderRadius: 10, padding: 12 }}>{error}</div>}
      {!lista && !error && <div style={{ color: '#64748b', padding: 24 }}>Cargando…</div>}
      {lista && visibles.length === 0 && <div style={{ color: '#94a3b8', background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 16 }}>No hay postulaciones en este estado.</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {visibles.map(p => (
          <button key={p.id} type="button" onClick={() => setAbierta({ id: p.id, clave: p.id })}
            style={{ textAlign: 'left', background: '#111827', border: '1px solid #1e2d42', borderRadius: 12, padding: 14, cursor: 'pointer', color: '#e2e8f0', minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800, fontSize: 15, overflowWrap: 'anywhere' }}>{[p.apellido, p.nombre].filter(Boolean).join(', ') || 'Sin nombre todavía'}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: COLOR_ESTADO[p.estado] }}>{ETIQUETA_ESTADO[p.estado]}</span>
            </div>
            <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <span>DNI {dniEnmascarado(p.dni)}</span>
              <span>Cargada {fecha(p.creado_at)}</span>
              {p.campos_dudosos.length > 0 && <span style={{ color: '#f59e0b' }}>{p.campos_dudosos.length} dato(s) dudoso(s)</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
