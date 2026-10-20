/**
 * lib/baja-avisos.ts
 *
 * Aviso a Operaciones cuando se confirma una baja con turnos asignados después de
 * la fecha efectiva. PURO: arma a quién avisar y qué decir. Sólo datos operativos
 * (objetivo y fechas): nada de importes, motivo ni documentación.
 * Destinatarios: los supervisores con la zona del objetivo asignada y los jefes de
 * supervisores. Si no hay nadie, el aviso queda sólo en la pantalla de la baja.
 */

export interface TurnoFuturo { turno_id: string; fecha: string; objetivo_id: string | null; objetivo: string | null; hora_inicio?: string | null }

export interface AvisoTurnos {
  objetivoId: string | null
  objetivo: string
  /** Turno de referencia para la deduplicación de push (usuario, turno, tipo). */
  turnoId: string
  fechas: string[]
  usuarios: string[]
  titulo: string
  cuerpo: string
}

export const TIPO_AVISO_BAJA = 'baja_turnos_futuros'

const fechaCorta = (iso: string) => iso.slice(0, 10).split('-').reverse().slice(0, 2).join('/')

export function armarAvisosTurnosFuturos(p: {
  persona: string
  fechaBaja: string
  turnos: TurnoFuturo[]
  zonaDeObjetivo: Map<string, string | null>
  supervisoresPorZona: Map<string, string[]>
  jefes: string[]
}): AvisoTurnos[] {
  const porObjetivo = new Map<string, TurnoFuturo[]>()
  for (const t of p.turnos) {
    const k = t.objetivo_id ?? 'sin_objetivo'
    porObjetivo.set(k, [...(porObjetivo.get(k) ?? []), t])
  }
  const out: AvisoTurnos[] = []
  for (const [k, ts] of Array.from(porObjetivo.entries())) {
    const ordenados = [...ts].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
    const zona = k === 'sin_objetivo' ? null : p.zonaDeObjetivo.get(k) ?? null
    const usuarios = Array.from(new Set([...(zona ? p.supervisoresPorZona.get(zona) ?? [] : []), ...p.jefes]))
    const objetivo = ordenados[0].objetivo ?? 'sin objetivo'
    const fechas = ordenados.map(t => String(t.fecha).slice(0, 10))
    out.push({
      objetivoId: k === 'sin_objetivo' ? null : k,
      objetivo,
      turnoId: ordenados[0].turno_id,
      fechas,
      usuarios,
      titulo: `Baja: ${p.persona}`,
      cuerpo: `Dejó de trabajar el ${fechaCorta(p.fechaBaja)}. Tiene ${fechas.length} turno${fechas.length === 1 ? '' : 's'} en ${objetivo} desde el ${fechaCorta(fechas[0])}: hay que reasignarlo${fechas.length === 1 ? '' : 's'}.`,
    })
  }
  return out
}
