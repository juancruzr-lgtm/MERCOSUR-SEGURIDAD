'use client'

/**
 * components/control-preventivo/ControlPreventivoPanel.tsx
 *
 * Control preventivo en el Panel Principal: objetivos sin supervisión (con
 * responsable y nivel de escalamiento), puestos sin cubrir de las próximas
 * 48 h y rondas incompletas con clasificación SUGERIDA.
 *
 * Sólo lectura: no envía avisos ni sanciona. Se muestra únicamente con
 * NEXT_PUBLIC_CONTROL_PREVENTIVO=1 (ver lib/control-preventivo.ts).
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { brandColors, semanticColors } from '@/lib/brand-theme'
import { cargarControlPreventivo, type DatosControlPreventivo } from '@/lib/control-preventivo-datos'
import {
  ETIQUETA_CLASE_RONDA,
  ETIQUETA_MOTIVO_SIN_CUBRIR,
  ETIQUETA_NIVEL,
  FACTOR_ESCALAMIENTO_JEFE,
  horasLegibles,
  resumirClasificacion,
  type ClaseRonda,
} from '@/lib/control-preventivo'

const C = {
  muted: '#64748b',
  text: '#e2e8f0',
  yellow: brandColors.yellow ?? '#f59e0b',
  red: semanticColors.error ?? '#ef4444',
  info: semanticColors.info ?? '#38bdf8',
  green: semanticColors.success ?? '#10b981',
}

const LIMITE = 6

function Bloque({ titulo, cantidad, color, nota, error, children }: {
  titulo: string; cantidad: number | null; color: string; nota?: string; error?: string | null; children?: React.ReactNode
}) {
  return (
    <div style={{ border: '1px solid rgba(148,163,184,0.18)', borderLeft: `3px solid ${cantidad ? color : 'transparent'}`, borderRadius: 8, padding: '12px 14px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: C.text }}>{titulo}</span>
        <span style={{ fontSize: 13, fontWeight: 900, color: cantidad ? color : C.muted }}>{cantidad ?? '—'}</span>
      </div>
      {nota && <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>{nota}</div>}
      {error && <div style={{ fontSize: 11, color: C.yellow, marginBottom: 6 }}>No se pudo leer todo: {error}</div>}
      {children}
    </div>
  )
}

function Linea({ titulo, detalle, color }: { titulo: string; detalle: string; color?: string }) {
  return (
    <div style={{ padding: '5px 0', borderTop: '1px solid rgba(148,163,184,0.10)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: color ?? C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titulo}</div>
      <div style={{ fontSize: 11, color: C.muted }}>{detalle}</div>
    </div>
  )
}

function VerMas({ total, abierto, onClick }: { total: number; abierto: boolean; onClick: () => void }) {
  if (total <= LIMITE) return null
  return (
    <button type="button" onClick={onClick} style={{ marginTop: 6, background: 'none', border: 'none', color: C.yellow, fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
      {abierto ? 'Ver menos' : `Ver los ${total} →`}
    </button>
  )
}

const fechaHora = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isFinite(d.getTime())
    ? d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—'
}

const COLOR_CLASE: Record<ClaseRonda, string> = {
  evidencia_pendiente: C.info,
  conectividad: C.yellow,
  error_gps: C.yellow,
  incumplimiento: C.red,
}

export default function ControlPreventivoPanel() {
  const [d, setD] = useState<DatosControlPreventivo | null>(null)
  const [cargando, setCargando] = useState(true)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({})
  const alternar = (k: string) => setAbiertos(a => ({ ...a, [k]: !a[k] }))

  const cargar = useCallback(async () => {
    setCargando(true); setErrorGeneral(null)
    try {
      setD(await cargarControlPreventivo(supabase))
    } catch (e) {
      setErrorGeneral(e instanceof Error ? e.message : 'error de lectura')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  const cat = d?.catalogos
  const sup = d?.supervision.items ?? []
  const jefeCount = sup.filter(x => x.nivel === 'jefe_supervisores').length
  const puestos = d?.puestos.items ?? []
  const p24 = puestos.filter(p => p.franja === 'menos_24h').length
  const rondas = d?.rondas.items ?? []
  const resumen = resumirClasificacion(rondas)
  const ver = (k: string, total: number) => (abiertos[k] ? total : LIMITE)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1.4, textTransform: 'uppercase', color: C.muted }}>Control preventivo</div>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, border: '1px solid rgba(148,163,184,0.3)', borderRadius: 999, padding: '1px 8px' }}>
          Sólo lectura · sin envíos · decisión humana
        </span>
        <button type="button" onClick={() => void cargar()} disabled={cargando} style={{ marginLeft: 'auto', background: 'none', border: '1px solid rgba(148,163,184,0.3)', borderRadius: 6, color: C.text, fontSize: 11, padding: '3px 10px', cursor: cargando ? 'default' : 'pointer' }}>
          {cargando ? 'Cargando…' : 'Actualizar'}
        </button>
      </div>

      {errorGeneral && <div style={{ fontSize: 12, color: C.red, marginBottom: 8 }}>No se pudo cargar el control preventivo: {errorGeneral}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}>
        <Bloque
          titulo="Objetivos sin supervisión"
          cantidad={d ? sup.length : null}
          color={jefeCount ? C.red : C.yellow}
          nota={d ? `${jefeCount} escalado${jefeCount === 1 ? '' : 's'} al jefe (más de ${FACTOR_ESCALAMIENTO_JEFE}× su frecuencia o nunca supervisado)${d.supervision.jefes.length === 0 ? ' · lista de escalamiento sin jefe visible' : ''}` : undefined}
          error={d?.supervision.error}
        >
          {sup.slice(0, ver('sup', sup.length)).map(it => (
            <Linea
              key={it.objetivo_id}
              color={it.nivel === 'jefe_supervisores' ? C.red : undefined}
              titulo={`${it.nombre} · ${ETIQUETA_NIVEL[it.nivel]}`}
              detalle={[
                it.horasDesdeUltima === null ? 'Nunca supervisado' : `Última ${fechaHora(it.ultimaIso)} · vencida hace ${horasLegibles(it.horasVencida ?? 0)}`,
                `frec. ${it.frecuenciaHoras} h`,
                cat ? cat.nombreZona(it.zona_id) : '',
                it.responsables.length ? `Resp.: ${it.responsables.map(id => cat?.nombreUsuario(id)).join(' / ')}` : 'Sin responsable de zona',
              ].filter(Boolean).join(' · ')}
            />
          ))}
          <VerMas total={sup.length} abierto={!!abiertos.sup} onClick={() => alternar('sup')} />
        </Bloque>

        <Bloque
          titulo="Puestos sin cubrir (próximas 48 h)"
          cantidad={d ? puestos.length : null}
          color={p24 ? C.red : C.yellow}
          nota={d ? `${p24} en menos de 24 h · ${puestos.length - p24} entre 24 y 48 h. «Sin fichaje» de turnos en curso se ve en Atención operativa: no es ausencia.` : undefined}
          error={d?.puestos.error}
        >
          {puestos.slice(0, ver('pue', puestos.length)).map(p => (
            <Linea
              key={p.clave}
              color={p.franja === 'menos_24h' ? C.red : undefined}
              titulo={`${cat?.nombreObjetivo(p.objetivo_id) ?? ''}${p.cantidad > 1 ? ` (×${p.cantidad})` : ''}`}
              detalle={[
                `${p.fecha.slice(8, 10)}/${p.fecha.slice(5, 7)} ${p.hora_inicio}${p.hora_fin ? `–${p.hora_fin}` : ''}`,
                `en ${horasLegibles(p.horasParaInicio)}`,
                ETIQUETA_MOTIVO_SIN_CUBRIR[p.motivo] + (p.novedadTipo ? ` (${p.novedadTipo.replace(/_/g, ' ')})` : ''),
                p.guardia_id && cat ? cat.nombreUsuario(p.guardia_id) : '',
              ].filter(Boolean).join(' · ')}
            />
          ))}
          <VerMas total={puestos.length} abierto={!!abiertos.pue} onClick={() => alternar('pue')} />
        </Bloque>

        <Bloque
          titulo={`Rondas incompletas (últimos ${d?.rondas.dias ?? 7} días)`}
          cantidad={d ? rondas.length : null}
          color={resumen.incumplimiento ? C.red : C.yellow}
          nota={d ? (Object.keys(resumen) as ClaseRonda[]).map(k => `${ETIQUETA_CLASE_RONDA[k]}: ${resumen[k]}`).join(' · ') + '. Clasificación sugerida: la decide una persona.' : undefined}
          error={d?.rondas.error}
        >
          {rondas.slice(0, ver('ron', rondas.length)).map(r => (
            <Linea
              key={r.ejecucion_id}
              color={COLOR_CLASE[r.sugerida]}
              titulo={`${cat?.nombreObjetivo(r.ejecucion.objetivo_id) ?? ''} · ${r.ejecucion.snap_ronda_nombre || 'Ronda'} · ${ETIQUETA_CLASE_RONDA[r.sugerida]}`}
              detalle={[
                fechaHora(r.ejecucion.iniciada_at),
                cat ? cat.nombreUsuario(r.ejecucion.guardia_id) : '',
                `${r.senales.puntosRegistrados}/${r.senales.puntosTotal} puntos`,
                r.senales.incumplidos ? `${r.senales.incumplidos} incumplido${r.senales.incumplidos === 1 ? '' : 's'} (${r.senales.incumplidosGpsDudoso} con GPS dudoso)` : '',
                r.senales.pendientes ? `${r.senales.pendientes} pendiente${r.senales.pendientes === 1 ? '' : 's'}` : '',
                r.senales.eventosRed ? `${r.senales.eventosRed} error${r.senales.eventosRed === 1 ? '' : 'es'} de red` : '',
              ].filter(Boolean).join(' · ')}
            />
          ))}
          <VerMas total={rondas.length} abierto={!!abiertos.ron} onClick={() => alternar('ron')} />
        </Bloque>
      </div>
    </div>
  )
}
