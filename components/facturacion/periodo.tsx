'use client'
// Seguro de períodos en la pantalla: estado del mes elegido (vencido, en curso, futuro), la barra
// fija "FACTURACIÓN — OCTUBRE 2026" en todas las pestañas, la excepción gerencial y el recálculo
// que no se relanza a ciegas. La base y las rutas imponen lo mismo por su cuenta.
import { useCallback, useEffect, useState } from 'react'
import { api, leer, rpc } from '@/lib/facturacion/datos'
import { estadoDelPeriodo, motivoBloqueo, nombreDelMes, type EstadoPeriodo, type Excepcion } from '@/lib/facturacion/periodo-seguro'
import { S } from './comun'

export type Periodo = {
  mes: string; estado: EstadoPeriodo; habilitado: boolean; excepcion: Excepcion | null; esGerencia: boolean
  motivo: string | null // por qué no se puede escribir (null = se puede)
}

export function periodoLocal(mes: string): Periodo {
  const estado = estadoDelPeriodo(mes)
  return { mes, estado, habilitado: estado === 'vencido', excepcion: null, esGerencia: false, motivo: motivoBloqueo(mes, null) }
}

/** Estado del período según la base (con excepción vigente); sin la migración, la misma regla local. */
export function usePeriodo(mes: string) {
  const [p, setP] = useState<Periodo>(() => periodoLocal(mes))
  const cargar = useCallback(async () => {
    try {
      const e: any = await rpc('fact_periodo_estado', { p_mes: mes })
      const exc = e?.excepcion ?? null
      setP({ mes, estado: e.estado, habilitado: Boolean(e.habilitado), excepcion: exc, esGerencia: Boolean(e.es_gerencia), motivo: e.habilitado ? null : motivoBloqueo(mes, null) })
    } catch { setP(periodoLocal(mes)) }
  }, [mes])
  useEffect(() => { setP(periodoLocal(mes)); cargar() }, [mes, cargar])
  return { periodo: p, recargar: cargar }
}

const hora = (iso: string) => new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(new Date(iso))

/** Barra fija con el período, visible en todas las pestañas. */
export function BarraPeriodo({ periodo, alCambiar }: { periodo: Periodo; alCambiar: () => void }) {
  const vencido = periodo.estado === 'vencido'
  const [error, setError] = useState<string | null>(null)
  const color = vencido ? '#065f46' : periodo.habilitado ? '#92400e' : '#7f1d1d'
  return (
    <div data-testid="barra-periodo" style={{ position: 'sticky', top: 0, zIndex: 20, background: color, color: '#fff', borderRadius: 8, padding: '8px 12px', marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <b style={{ fontSize: 16, letterSpacing: 0.5 }}>FACTURACIÓN — {nombreDelMes(periodo.mes)}</b>
      <b style={{ background: 'rgba(0,0,0,.25)', borderRadius: 6, padding: '2px 8px' }}>
        {vencido ? 'PERÍODO VENCIDO' : periodo.estado === 'en_curso' ? 'ADVERTENCIA — PERÍODO EN CURSO' : 'ADVERTENCIA — PERÍODO FUTURO'}
      </b>
      {!vencido && !periodo.excepcion && <span style={{ fontSize: 13 }}>Sólo consulta: no se aceptan horas, no se recalcula, no se aprueba ni se emite.</span>}
      {periodo.excepcion && <span style={{ fontSize: 13 }}>
        Excepción gerencial vigente hasta {hora(periodo.excepcion.vence_at)}{periodo.excepcion.otorgada_por_nombre ? ` (${periodo.excepcion.otorgada_por_nombre})` : ''}: «{periodo.excepcion.motivo}»
      </span>}
      {!vencido && periodo.esGerencia && !periodo.excepcion && <button style={{ ...S.btn2, padding: '3px 10px' }} onClick={async () => {
        const motivo = prompt(`Excepción para operar sobre ${nombreDelMes(periodo.mes)} (período ${periodo.estado === 'en_curso' ? 'en curso' : 'futuro'}).\nMotivo (obligatorio, queda auditado):`)
        if (!motivo) return
        const horas = Number(prompt('¿Por cuántas horas? (1 a 24)', '2') ?? 0)
        try { setError(null); await rpc('fact_periodo_excepcion_otorgar', { p_mes: periodo.mes, p_motivo: motivo, p_horas: horas }); alCambiar() } catch (e: any) { setError(e?.message ?? String(e)) }
      }}>Habilitar excepción (Gerencia)</button>}
      {periodo.excepcion && periodo.esGerencia && <button style={{ ...S.btn2, padding: '3px 10px' }} onClick={async () => {
        if (!confirm('¿Revocar la excepción? El período vuelve a quedar protegido.')) return
        try { setError(null); await rpc('fact_periodo_excepcion_revocar', { p_id: periodo.excepcion!.id, p_motivo: 'Revocada desde la pantalla' }); alCambiar() } catch (e: any) { setError(e?.message ?? String(e)) }
      }}>Revocar excepción</button>}
      {error && <span style={{ background: '#fff', color: '#991b1b', borderRadius: 6, padding: '2px 8px', fontSize: 13 }}>{error}</span>}
    </div>
  )
}

// ── Recálculo sin duplicados ─────────────────────────────────────────────────

export type Operacion = { id: string; tipo: string; mes: string; contrato_id: string | null; estado: 'en_curso' | 'terminada' | 'fallida' | 'sin_confirmar'; iniciada_at: string; terminada_at: string | null; resultado: any }

/** Última operación de recálculo del mes (o null). */
export async function ultimaOperacion(mes: string): Promise<Operacion | null> {
  try {
    const ops = await leer('fact_operaciones', q => q.eq('mes', mes).order('iniciada_at', { ascending: false }).limit(1))
    return (ops?.[0] as Operacion) ?? null
  } catch { return null }
}

/** Corte del navegador o de la plataforma: el servidor pudo haber seguido trabajando. */
export const resultadoDesconocido = (e: any) =>
  e instanceof TypeError || e?.name === 'AbortError' || /^Error 50[234]$/.test(e?.message ?? '') || /Failed to fetch|NetworkError|Load failed/i.test(e?.message ?? '')

const espera = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Recalcula (mes completo o un contrato). Si el pedido se corta sin respuesta, NO lo relanza:
 * consulta en la base el estado real de la operación hasta que termine y devuelve su resultado.
 */
export async function recalcular(mes: string, contratoId: string | undefined, alEsperar?: (texto: string | null) => void) {
  const antes = await ultimaOperacion(mes)
  try {
    return await api('prefacturas', contratoId ? { mes, contrato_id: contratoId } : { mes })
  } catch (e: any) {
    const enCurso = e?.detalle?.codigo === 'operacion_en_curso'
    if (!enCurso && !resultadoDesconocido(e)) throw e
    // El servidor sigue (o ya hay otra igual en curso): esperar el resultado real, sin relanzar.
    alEsperar?.(enCurso ? e.message : 'La respuesta tardó más de lo esperado: consultando el estado real del recálculo…')
    for (let i = 0; i < 120; i++) {
      await espera(5000)
      const op = await ultimaOperacion(mes)
      if (op && op.id !== antes?.id || op && enCurso) {
        if (op.estado === 'en_curso') { alEsperar?.(`Recálculo en curso desde las ${hora(op.iniciada_at)}…`); continue }
        alEsperar?.(null)
        if (op.estado === 'terminada') return { ...(op.resultado ?? {}), operacion_id: op.id, recuperado: true }
        if (op.estado === 'sin_confirmar') throw new Error('El recálculo quedó sin confirmar (resultado desconocido). Revisá la lista antes de volver a lanzarlo.')
        throw new Error(`El recálculo falló: ${op.resultado?.error ?? 'sin detalle'}`)
      }
    }
    alEsperar?.(null)
    throw new Error('No se pudo confirmar el resultado del recálculo. Revisá la lista antes de volver a lanzarlo.')
  }
}

/** Aviso de una operación en curso (o sin confirmar) del mes, para bloquear relanzarla. */
export function useOperacion(mes: string) {
  const [op, setOp] = useState<Operacion | null>(null)
  const cargar = useCallback(async () => setOp(await ultimaOperacion(mes)), [mes])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => {
    if (op?.estado !== 'en_curso') return
    const t = setInterval(cargar, 5000)
    return () => clearInterval(t)
  }, [op?.estado, cargar])
  return { operacion: op, recargarOperacion: cargar }
}
