/**
 * lib/feriados.ts
 *
 * Fuente única de feriados nacionales, y la regla de cuándo un turno cuenta
 * como feriado trabajado.
 *
 * ── Qué determina la fecha ───────────────────────────────────────────────────
 * La FECHA DE INICIO del turno, igual que el mes operativo. El turno entero
 * pertenece a ese día. Un nocturno que arranca el 16 y termina el 17 NO es
 * feriado; uno que arranca el 17 a las 19:00 y termina el 18 a las 07:00 SÍ lo
 * es, completo. No se parte ningún turno.
 *
 * ── Qué NO hace ──────────────────────────────────────────────────────────────
 * No toca la liquidación. No paga adicionales. No cambia `horasLiquidables`.
 * Es información y conteo: cuántos feriados cubrió cada persona y cuántas horas
 * trabajó en ellos. Si algún día hay un tratamiento salarial diferencial, se
 * construirá sobre esta base, pero será otra decisión y otra orden.
 *
 * ── La tabla ─────────────────────────────────────────────────────────────────
 * Se carga por fecha explícita, no por regla de cálculo. Los feriados argentinos
 * mezclan fechas fijas por ley, fechas trasladables cuyo corrimiento se define
 * año a año, feriados móviles del calendario litúrgico y "puentes turísticos"
 * que fija el Poder Ejecutivo por decreto. Una función que intente derivarlos
 * se equivoca en silencio; una tabla explícita se puede auditar de un vistazo y
 * corregir en un renglón.
 *
 * `tipo` existe para eso: dice de dónde salió cada fecha y cuáles hay que
 * revalidar cuando el Ejecutivo publica el calendario del año.
 */

export type TipoFeriado =
  /** Fecha fija por ley. No se mueve. */
  | 'inamovible'
  /** Fecha que la ley permite trasladar; el corrimiento se define por año. */
  | 'trasladable'
  /** Calendario litúrgico: cambia todos los años. */
  | 'movil'
  /** Puente turístico fijado por decreto del Ejecutivo. */
  | 'puente'

export interface Feriado {
  /** `YYYY-MM-DD`. */
  fecha: string
  nombre: string
  tipo: TipoFeriado
}

/**
 * Feriados nacionales por fecha.
 *
 * IMPORTANTE al agregar un año: los `inamovible` se pueden dar por seguros; los
 * `movil`, `trasladable` y `puente` hay que copiarlos del calendario oficial
 * publicado para ese año. No inventarlos ni derivarlos.
 */
export const FERIADOS_NACIONALES: readonly Feriado[] = [
  // ── 2026 ──────────────────────────────────────────────────────────────────
  { fecha: '2026-01-01', nombre: 'Año Nuevo', tipo: 'inamovible' },
  { fecha: '2026-02-16', nombre: 'Carnaval', tipo: 'movil' },
  { fecha: '2026-02-17', nombre: 'Carnaval', tipo: 'movil' },
  { fecha: '2026-03-24', nombre: 'Día Nacional de la Memoria por la Verdad y la Justicia', tipo: 'inamovible' },
  { fecha: '2026-04-02', nombre: 'Día del Veterano y de los Caídos en la Guerra de Malvinas', tipo: 'inamovible' },
  { fecha: '2026-04-03', nombre: 'Viernes Santo', tipo: 'movil' },
  { fecha: '2026-05-01', nombre: 'Día del Trabajador', tipo: 'inamovible' },
  { fecha: '2026-05-25', nombre: 'Día de la Revolución de Mayo', tipo: 'inamovible' },
  { fecha: '2026-06-15', nombre: 'Paso a la Inmortalidad del Gral. Martín Miguel de Güemes', tipo: 'trasladable' },
  { fecha: '2026-06-20', nombre: 'Paso a la Inmortalidad del Gral. Manuel Belgrano', tipo: 'inamovible' },
  { fecha: '2026-07-09', nombre: 'Día de la Independencia', tipo: 'inamovible' },
  { fecha: '2026-08-17', nombre: 'Paso a la Inmortalidad del Gral. José de San Martín', tipo: 'trasladable' },
  { fecha: '2026-10-12', nombre: 'Día del Respeto a la Diversidad Cultural', tipo: 'trasladable' },
  { fecha: '2026-11-23', nombre: 'Día de la Soberanía Nacional', tipo: 'trasladable' },
  { fecha: '2026-12-08', nombre: 'Inmaculada Concepción de María', tipo: 'inamovible' },
  { fecha: '2026-12-25', nombre: 'Navidad', tipo: 'inamovible' },
]

const POR_FECHA: ReadonlyMap<string, Feriado> = new Map(
  FERIADOS_NACIONALES.map(f => [f.fecha, f]),
)

/** El feriado de una fecha `YYYY-MM-DD`, o `null` si no lo es. */
export function feriadoDeFecha(fecha?: string | null): Feriado | null {
  if (!fecha) return null
  return POR_FECHA.get(fecha.slice(0, 10)) ?? null
}

export function esFeriadoNacional(fecha?: string | null): boolean {
  return feriadoDeFecha(fecha) !== null
}

/** Los feriados de un mes `YYYY-MM`, en orden. */
export function feriadosDelMes(mes: string): Feriado[] {
  return FERIADOS_NACIONALES
    .filter(f => f.fecha.slice(0, 7) === mes)
    .slice()
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
}

/**
 * El feriado al que pertenece un turno, por su FECHA DE INICIO.
 *
 * Acá está toda la regla del cruce de medianoche: se mira `turno.fecha` y nada
 * más. Un turno 16/08 19:00 → 17/08 07:00 devuelve `null` aunque termine dentro
 * del feriado; uno 17/08 19:00 → 18/08 07:00 devuelve el feriado, completo.
 */
export function feriadoDelTurno(turno: { fecha?: string | null }): Feriado | null {
  return feriadoDeFecha(turno?.fecha)
}

/**
 * ¿Este turno cuenta como feriado nacional TRABAJADO?
 *
 * Tres condiciones, en este orden:
 *   1. su fecha de inicio es feriado;
 *   2. el turno no está fuera del mes (anulado, cancelado, reemplazado);
 *   3. efectivamente se trabajó.
 *
 * Lo tercero se resuelve con las horas que el sistema ya reconoce, no con un
 * criterio nuevo: si la línea de liquidación da cero —ausencia, turno sin
 * registro, cobertura anulada— no se trabajó y no cuenta. Y si las horas
 * vinieron de una cobertura, cuentan para quien la cubrió, porque son las horas
 * de esa persona: el reemplazo ya está resuelto aguas arriba y acá no se vuelve
 * a decidir.
 */
export function turnoCuentaEnFeriado(
  turno: { fecha?: string | null; estado?: string | null },
  horasReconocidas: number,
  estadosSinObligacion: ReadonlySet<string>,
): boolean {
  if (!esFeriadoNacional(turno?.fecha)) return false
  if (estadosSinObligacion.has(turno?.estado ?? '')) return false
  return horasReconocidas > 0
}

export interface ResumenFeriados {
  /** Cuántos feriados distintos cubrió. No cuenta dos turnos del mismo día dos veces. */
  feriadosCubiertos: number
  /** Horas reconocidas en esos turnos. */
  horas: number
  /** Los turnos que contaron, para poder auditar el número. */
  turnos: number
  /** Fechas cubiertas, ordenadas. */
  fechas: string[]
}

export const RESUMEN_FERIADOS_VACIO: ResumenFeriados = {
  feriadosCubiertos: 0, horas: 0, turnos: 0, fechas: [],
}

/**
 * Resume una lista de jornadas ya evaluadas.
 *
 * Recibe lo que cada pantalla ya calculó —si el turno cuenta y cuántas horas
 * reconoce— en vez de recalcularlo. Es la misma disciplina que el resto del
 * módulo de liquidación: una sola fuente por pregunta.
 */
export function resumirFeriados(
  jornadas: readonly { fecha: string; cuenta: boolean; horas: number }[],
): ResumenFeriados {
  const fechas = new Set<string>()
  let horas = 0
  let turnos = 0
  for (const j of jornadas) {
    if (!j.cuenta) continue
    fechas.add(j.fecha)
    horas += j.horas
    turnos += 1
  }
  return {
    feriadosCubiertos: fechas.size,
    horas: Math.round(horas * 100) / 100,
    turnos,
    fechas: Array.from(fechas).sort(),
  }
}
