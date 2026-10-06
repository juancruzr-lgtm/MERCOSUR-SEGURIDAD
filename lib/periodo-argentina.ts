/**
 * lib/periodo-argentina.ts
 *
 * Una sola forma de responder "¿de qué día / de qué mes es esto?" y "¿cuál es
 * el rango de este mes?" para la operación, que vive en hora de Argentina.
 *
 * Existe porque el cambio de septiembre a octubre de 2026 expuso dos familias
 * de errores repetidos en varias pantallas:
 *
 *  1. `${mes}-31` como último día del mes. En un mes de 30 días Postgres
 *     rechaza '2026-09-31' (22008 date/time field value out of range); el
 *     código descartaba el error con `data ?? []` y la consulta "no tenía
 *     datos". Así se congeló la evaluación de septiembre sin novedades
 *     laborales, y el Cierre Operativo se quedó sin supervisores de guardia.
 *     Acá el rango es SIEMPRE [primer día, primer día del mes siguiente).
 *
 *  2. El mes o el día tomados de `toISOString()` (UTC). Entre las 21:00 y las
 *     23:59 de Argentina del último día del mes, UTC ya está en el mes
 *     siguiente: el período cambiaba tres horas antes.
 *
 * Los timestamps se siguen guardando en UTC: esto sólo decide cómo se
 * INTERPRETAN como día o mes de negocio.
 *
 * Argentina no tiene horario de verano desde 2009, pero el día local se
 * obtiene con Intl (no con un offset sumado a mano) para no depender de eso ni
 * de la zona horaria del proceso — Vercel corre en UTC, el navegador en la del
 * usuario.
 */

export const ZONA_ARGENTINA = 'America/Argentina/Buenos_Aires'

const RE_MES = /^(\d{4})-(\d{2})$/
const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Valida 'YYYY-MM' y lo devuelve como números. Lanza si no es un mes real. */
export function partirMes(mes: string): { anio: number; mes: number } {
  const m = RE_MES.exec(String(mes ?? ''))
  if (!m) throw new Error(`Período inválido: "${mes}" (se espera YYYY-MM)`)
  const anio = Number(m[1])
  const numero = Number(m[2])
  if (numero < 1 || numero > 12) throw new Error(`Período inválido: "${mes}" (mes fuera de 1-12)`)
  return { anio, mes: numero }
}

export function esMesValido(mes: string): boolean {
  try { partirMes(mes); return true } catch { return false }
}

/** 'YYYY-MM' a partir de año y mes (1-12), normalizando desbordes (13 → enero siguiente). */
function componerMes(anio: number, mes: number): string {
  const d = new Date(Date.UTC(anio, mes - 1, 1))
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`
}

export function mesSiguiente(mes: string): string {
  const p = partirMes(mes)
  return componerMes(p.anio, p.mes + 1)
}

export function mesAnterior(mes: string): string {
  const p = partirMes(mes)
  return componerMes(p.anio, p.mes - 1)
}

/** Cantidad de días reales del mes (28/29/30/31). */
export function diasDelMes(mes: string): number {
  const p = partirMes(mes)
  return new Date(Date.UTC(p.anio, p.mes, 0)).getUTCDate()
}

/**
 * Rango de FECHAS (columnas `date`) del mes.
 *
 *  - `desde`: primer día, inclusive.
 *  - `hastaExclusivo`: primer día del mes siguiente. Es la forma segura de
 *    filtrar: `.gte(col, desde).lt(col, hastaExclusivo)`.
 *  - `ultimoDia`: último día real, para los casos que necesitan un extremo
 *    inclusivo (`fecha_desde <= ultimoDia` en un solapamiento de rangos).
 */
export function rangoFechasMes(mes: string): { desde: string; hastaExclusivo: string; ultimoDia: string } {
  const p = partirMes(mes)
  const sig = mesSiguiente(mes)
  return {
    desde: `${p.anio}-${pad2(p.mes)}-01`,
    hastaExclusivo: `${sig}-01`,
    ultimoDia: `${p.anio}-${pad2(p.mes)}-${pad2(diasDelMes(mes))}`,
  }
}

/** Offset de Argentina (en minutos, negativo al oeste) vigente en un instante. */
function offsetArgentinaMin(instante: Date): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA_ARGENTINA, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instante)
  const v = (t: string) => Number(partes.find(x => x.type === t)?.value)
  const comoUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour') % 24, v('minute'), v('second'))
  return Math.round((comoUtc - Math.floor(instante.getTime() / 1000) * 1000) / 60000)
}

/**
 * Instante UTC (ISO con Z) de la medianoche argentina que abre una fecha.
 * '2026-10-01' → '2026-10-01T03:00:00.000Z'.
 */
export function inicioDiaArgentinaISO(fecha: string): string {
  const m = RE_FECHA.exec(String(fecha ?? ''))
  if (!m) throw new Error(`Fecha inválida: "${fecha}" (se espera YYYY-MM-DD)`)
  const ingenuo = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  // Dos pasadas: el offset se mide en el instante resultante, no en el ingenuo.
  let t = ingenuo - offsetArgentinaMin(new Date(ingenuo)) * 60000
  t = ingenuo - offsetArgentinaMin(new Date(t)) * 60000
  return new Date(t).toISOString()
}

/**
 * Rango de INSTANTES (columnas `timestamptz`) que cubre el mes en hora
 * argentina: [00:00 ART del día 1, 00:00 ART del día 1 del mes siguiente).
 * Filtrar con `.gte(col, desde).lt(col, hasta)`.
 */
export function rangoInstantesMesArgentina(mes: string): { desde: string; hasta: string } {
  const r = rangoFechasMes(mes)
  return { desde: inicioDiaArgentinaISO(r.desde), hasta: inicioDiaArgentinaISO(r.hastaExclusivo) }
}

/** Corre una fecha YYYY-MM-DD n días (aritmética de calendario, sin zona). */
export function sumarDias(fecha: string, dias: number): string {
  const m = RE_FECHA.exec(String(fecha ?? ''))
  if (!m) throw new Error(`Fecha inválida: "${fecha}"`)
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dias))
  return d.toISOString().slice(0, 10)
}

/** Rango de instantes de UN día argentino: [00:00 ART, 00:00 ART del día siguiente). */
export function rangoInstantesDiaArgentina(fecha: string): { desde: string; hasta: string } {
  return { desde: inicioDiaArgentinaISO(fecha), hasta: inicioDiaArgentinaISO(sumarDias(fecha, 1)) }
}

/** Fecha argentina (YYYY-MM-DD) de un instante. Acepta Date o ISO. */
export function fechaArgentina(instante: Date | string = new Date()): string {
  const d = instante instanceof Date ? instante : new Date(instante)
  if (Number.isNaN(d.getTime())) return ''
  // 'sv-SE' formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: ZONA_ARGENTINA, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

/** Mes argentino (YYYY-MM) de un instante. Reemplaza `created_at.slice(0,7)`. */
export function mesArgentina(instante: Date | string = new Date()): string {
  return fechaArgentina(instante).slice(0, 7)
}

/** Meses desde `desde` (inclusive) hasta el mes argentino actual, del más reciente hacia atrás. */
export function mesesHastaActual(desde: string, ahora: Date = new Date()): string[] {
  partirMes(desde)
  const out: string[] = []
  let m = mesArgentina(ahora)
  while (m >= desde && out.length <= 120) {
    out.push(m)
    m = mesAnterior(m)
  }
  return out
}
