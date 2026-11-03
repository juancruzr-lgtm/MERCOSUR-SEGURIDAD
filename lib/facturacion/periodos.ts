/**
 * lib/facturacion/periodos.ts
 *
 * Período de PRESTACIÓN que se factura. No es el mes de emisión ni el de
 * cobro: el tablero los separa.
 *
 *  - `mes_calendario`: del 1 al último día.
 *  - `corte`: de `diaInicio` del mes anterior a `diaInicio - 1` del mes
 *    indicado (La Caja / Hagana: 26 → 25). El período se nombra por el mes en
 *    que CIERRA: '2026-10' = 26/09 a 25/10. Lo que vale es el rango guardado
 *    en la prefactura, el nombre es sólo una etiqueta.
 *
 * Los límites son medianoche de Argentina. Un turno que cruza un límite se
 * reparte por minutos entre los dos períodos (nunca se cuenta entero en
 * ambos ni se pierde).
 */

import { inicioDiaArgentinaISO, partirMes, rangoFechasMes, sumarDias, mesAnterior } from '@/lib/periodo-argentina'

export type ReglaPeriodo =
  | { tipo: 'mes_calendario' }
  | { tipo: 'corte'; diaInicio: number }

export type RangoPeriodo = {
  mes: string
  /** Fecha inclusiva (YYYY-MM-DD). */
  desde: string
  /** Fecha exclusiva (YYYY-MM-DD). */
  hastaExclusivo: string
  /** Instantes UTC de los límites (medianoche argentina). */
  instanteDesde: string
  instanteHasta: string
}

export function periodoFacturacion(regla: ReglaPeriodo, mes: string): RangoPeriodo {
  partirMes(mes)
  let desde: string
  let hastaExclusivo: string
  if (regla.tipo === 'corte') {
    const d = Math.trunc(regla.diaInicio)
    if (!(d >= 2 && d <= 28)) throw new Error(`Día de corte inválido: ${regla.diaInicio} (2 a 28)`)
    desde = `${mesAnterior(mes)}-${String(d).padStart(2, '0')}`
    hastaExclusivo = `${mes}-${String(d).padStart(2, '0')}`
  } else {
    const r = rangoFechasMes(mes)
    desde = r.desde
    hastaExclusivo = r.hastaExclusivo
  }
  return {
    mes, desde, hastaExclusivo,
    instanteDesde: inicioDiaArgentinaISO(desde),
    instanteHasta: inicioDiaArgentinaISO(hastaExclusivo),
  }
}

/** Minutos de [inicio, fin) que caen dentro de [desde, hasta). */
export function minutosEnRango(inicio: string, fin: string, desde: string, hasta: string): number {
  const a = Math.max(Date.parse(inicio), Date.parse(desde))
  const b = Math.min(Date.parse(fin), Date.parse(hasta))
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0
  return Math.round((b - a) / 60000)
}

export type FranjaNocturna = { desde: string; hasta: string } // 'HH:MM' hora argentina

function minutosDeHora(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m) throw new Error(`Hora inválida: "${hhmm}"`)
  const v = Number(m[1]) * 60 + Number(m[2])
  if (v < 0 || v > 24 * 60) throw new Error(`Hora inválida: "${hhmm}"`)
  return v
}

/**
 * Reparte un turno en minutos diurnos y nocturnos según la franja nocturna
 * del CONTRATO (no la salarial). Sin franja definida no se clasifica: el
 * llamador debe tratarlo como requisito pendiente.
 */
export function clasificarDiurnaNocturna(
  inicio: string,
  fin: string,
  franja: FranjaNocturna,
): { diurnos: number; nocturnos: number } {
  const total = minutosEnRango(inicio, fin, inicio, fin)
  if (total === 0) return { diurnos: 0, nocturnos: 0 }
  const nd = minutosDeHora(franja.desde)
  const nh = minutosDeHora(franja.hasta)
  let nocturnos = 0
  // Recorre cada día argentino que toca el turno (desde el día anterior, por
  // la parte de la franja que arranca la noche previa).
  const fechaIni = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(inicio))
  for (let i = -1; i <= 2; i++) {
    const dia = sumarDias(fechaIni, i)
    const base = Date.parse(inicioDiaArgentinaISO(dia))
    const tramos: Array<[number, number]> = nd > nh
      ? [[0, nh], [nd, 24 * 60]]
      : [[nd, nh]]
    for (const [a, b] of tramos) {
      if (b <= a) continue
      nocturnos += minutosEnRango(inicio, fin, new Date(base + a * 60000).toISOString(), new Date(base + b * 60000).toISOString())
    }
  }
  nocturnos = Math.min(nocturnos, total)
  return { diurnos: total - nocturnos, nocturnos }
}

/** Fecha de vencimiento a N días corridos de la fecha de factura. */
export function vencimientoPorDias(fechaFactura: string, dias: number): string {
  if (!Number.isInteger(dias) || dias < 0) throw new Error(`Días de vencimiento inválidos: ${dias}`)
  return sumarDias(fechaFactura, dias)
}

/** ¿El servicio [inicio, fin] (fin null = vigente) tuvo días dentro del período? */
export function servicioActivoEnPeriodo(
  servicio: { fechaInicio: string | null; fechaFin: string | null },
  periodo: { desde: string; hastaExclusivo: string },
): boolean {
  if (servicio.fechaInicio && servicio.fechaInicio >= periodo.hastaExclusivo) return false
  if (servicio.fechaFin && servicio.fechaFin < periodo.desde) return false
  return true
}
