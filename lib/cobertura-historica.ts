/**
 * lib/cobertura-historica.ts
 *
 * Motor de cobertura histórica (Bloque E). Analiza los turnos reales de un
 * mes (julio 2026 como fuente principal) y propone la estructura habitual de
 * cobertura de cada objetivo: día de semana, horario y cantidad de posiciones
 * simultáneas, con su frecuencia de repetición.
 *
 * PURO: no escribe en Supabase, no crea turnos, no modifica servicios. La
 * propuesta NO afirma representar el contrato: es solo lo observado en el mes.
 *
 * Reglas:
 *   · el patrón nunca depende del nombre del vigilador ni del guardia habitual;
 *   · capacitaciones y estados sin obligación (ESTADOS_SIN_OBLIGACION) quedan
 *     fuera; las coberturas (reemplazos) SÍ cuentan como servicio real;
 *   · dos turnos simultáneos del mismo horario no son duplicados: son dos
 *     posiciones requeridas (la posición histórica "Principal" puede contener
 *     varias — se calcula la simultaneidad por horario, sin asumir una);
 *   · los nocturnos cuentan en su fecha de inicio (regla existente de
 *     lib/turnos: hora_fin <= hora_inicio cruza medianoche; no se reescribe).
 */

import { ESTADOS_SIN_OBLIGACION } from '@/lib/revision-operativa'
import { esTurnoNocturno } from '@/lib/turnos'
import { caracteristicaTurno } from '@/lib/caracteristica-turno'

// ── Umbrales centralizados (proporciones sobre días equivalentes) ────────────

export const UMBRALES_PATRON = {
  /** ≥ 80% de los días equivalentes. */
  fuerte: 0.8,
  /** ≥ 60% y < 80%. */
  probable: 0.6,
  /** ≥ 30% y < 60%. Debajo de esto es excepción. */
  revision: 0.3,
  /** Mínimo de días comparables para opinar. */
  minimoDiasComparables: 7,
} as const

export type ClasificacionPatron =
  | 'fuerte'
  | 'probable'
  | 'revision'
  | 'excepcion'
  | 'sin_informacion'

export const ETIQUETA_CLASIFICACION: Record<ClasificacionPatron, string> = {
  fuerte: 'Patrón fuerte',
  probable: 'Patrón probable',
  revision: 'Requiere revisión',
  excepcion: 'Excepción',
  sin_informacion: 'Sin información suficiente',
}

export type ComparacionConfig =
  | 'coincide'
  | 'falta_configuracion'
  | 'horario_diferente'
  | 'dias_diferentes'
  | 'cantidad_diferente'

export const ETIQUETA_COMPARACION: Record<ComparacionConfig, string> = {
  coincide: 'Coincide con la configuración',
  falta_configuracion: 'Falta configuración',
  horario_diferente: 'Horario diferente',
  dias_diferentes: 'Días diferentes',
  cantidad_diferente: 'Cantidad de posiciones diferente',
}

// ── Entradas ─────────────────────────────────────────────────────────────────

export interface TurnoHistorico {
  id?: string | null
  objetivo_id: string
  puesto_id?: string | null
  guardia_id?: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  estado?: string | null
  tipo_evento?: string | null
}

export interface ObjetivoHistorico {
  id: string
  nombre: string
  estado?: string | null
  es_prueba?: boolean | null
}

export interface ServicioConfigurado {
  objetivo_id: string
  activo: boolean
  dias_semana?: number[] | null
  turno_base?: { hora_inicio?: string | null; hora_fin?: string | null } | null
}

// ── Salidas ──────────────────────────────────────────────────────────────────

export interface PatronCobertura {
  hora_inicio: string
  hora_fin: string
  nocturno: boolean
  etiqueta_dias: string
  dows: number[] // 1=Lun … 7=Dom
  posiciones: number
  dias_observados: number
  dias_cumplidos: number
  porcentaje: number // 0–100, redondeado
  clasificacion: ClasificacionPatron
  /** Fechas de ejemplo donde la cobertura difirió de la propuesta. */
  excepciones: string[]
  comparacion: ComparacionConfig | null
}

export interface AnalisisObjetivo {
  objetivo_id: string
  objetivo_nombre: string
  patrones: PatronCobertura[]
  advertencias: string[]
  /** Servicios activos configurados cuyo horario no se observó en el mes. */
  configuracion_adicional: string[]
}

export interface ResumenCobertura {
  objetivos_analizados: number
  con_patron_fuerte: number
  con_patron_probable: number
  requieren_revision: number
  sin_informacion: number
}

export interface ResultadoCobertura {
  mes: string
  resumen: ResumenCobertura
  objetivos: AnalisisObjetivo[]
}

// ── Utilidades ───────────────────────────────────────────────────────────────

const hora5 = (h?: string | null) => (h ?? '').slice(0, 5)
const pad2 = (n: number) => String(n).padStart(2, '0')

const DIA_LABEL = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

/** Fechas del mes con su día de semana ISO (1=Lun … 7=Dom). */
function fechasDelMesConDow(anio: number, mes: number): { fecha: string; dow: number }[] {
  const ultimo = new Date(anio, mes, 0).getDate()
  const filas: { fecha: string; dow: number }[] = []
  for (let d = 1; d <= ultimo; d++) {
    let dow = new Date(anio, mes - 1, d).getDay()
    if (dow === 0) dow = 7
    filas.push({ fecha: `${anio}-${pad2(mes)}-${pad2(d)}`, dow })
  }
  return filas
}

/** Etiqueta legible de un conjunto de días ISO. */
export function etiquetaDias(dows: number[]): string {
  const set = [...new Set(dows)].sort((a, b) => a - b)
  const igual = (xs: number[]) => set.length === xs.length && xs.every((x, i) => set[i] === x)
  if (igual([1, 2, 3, 4, 5, 6, 7])) return 'Todos los días'
  if (igual([1, 2, 3, 4, 5])) return 'Lun–Vie'
  if (igual([6, 7])) return 'Sáb y Dom'
  return set.map(d => DIA_LABEL[d]).join(', ')
}

/** Moda de una lista de enteros positivos (la cantidad simultánea habitual). */
function moda(valores: number[]): number {
  const conteo = new Map<number, number>()
  for (const v of valores) conteo.set(v, (conteo.get(v) ?? 0) + 1)
  let mejor = valores[0] ?? 0
  let mejorConteo = 0
  for (const [v, c] of conteo) {
    if (c > mejorConteo || (c === mejorConteo && v > mejor)) { mejor = v; mejorConteo = c }
  }
  return mejor
}

export function clasificarProporcion(
  diasCumplidos: number,
  diasObservados: number,
  umbrales = UMBRALES_PATRON,
): ClasificacionPatron {
  if (diasObservados < umbrales.minimoDiasComparables) return 'sin_informacion'
  const p = diasCumplidos / diasObservados
  if (p >= umbrales.fuerte) return 'fuerte'
  if (p >= umbrales.probable) return 'probable'
  if (p >= umbrales.revision) return 'revision'
  return 'excepcion'
}

/** Turno que representa servicio real para el patrón. */
export function turnoCuentaParaPatron(t: Pick<TurnoHistorico, 'estado' | 'tipo_evento'>): boolean {
  if (ESTADOS_SIN_OBLIGACION.has(t.estado || '')) return false
  // Capacitación no es cobertura del objetivo; la cobertura (reemplazo) sí.
  if (caracteristicaTurno(t.tipo_evento) === 'capacitacion') return false
  return true
}

// ── Motor ────────────────────────────────────────────────────────────────────

export function analizarCoberturaHistorica(params: {
  anio: number
  mes: number // 1–12
  turnos: TurnoHistorico[]
  objetivos: ObjetivoHistorico[]
  servicios: ServicioConfigurado[]
  umbrales?: typeof UMBRALES_PATRON
}): ResultadoCobertura {
  const { anio, mes, turnos, objetivos, servicios } = params
  const umbrales = params.umbrales ?? UMBRALES_PATRON
  const mesStr = `${anio}-${pad2(mes)}`
  const fechasMes = fechasDelMesConDow(anio, mes)
  const dowPorFecha = new Map(fechasMes.map(f => [f.fecha, f.dow]))

  // Objetivos oficiales: activos y no de prueba.
  const oficiales = objetivos.filter(o => o.estado === 'activo' && !o.es_prueba)
  const analisis: AnalisisObjetivo[] = []

  for (const objetivo of oficiales) {
    const delMes = turnos.filter(t => t.objetivo_id === objetivo.id && dowPorFecha.has(t.fecha))
    if (delMes.length === 0) continue

    // Exclusiones + deduplicación técnica (misma fila exacta contada una vez).
    const vistos = new Set<string>()
    const utiles: TurnoHistorico[] = []
    let capacitaciones = 0
    for (const t of delMes) {
      if (caracteristicaTurno(t.tipo_evento) === 'capacitacion') { capacitaciones++; continue }
      if (!turnoCuentaParaPatron(t)) continue
      const clave = `${t.fecha}|${hora5(t.hora_inicio)}|${hora5(t.hora_fin)}|${t.puesto_id ?? ''}|${t.guardia_id ?? ''}`
      if (vistos.has(clave)) continue // duplicado técnico
      vistos.add(clave)
      utiles.push(t)
    }

    if (utiles.length === 0) continue // nada representa cobertura real

    // Días equivalentes sobre la VENTANA de actividad del objetivo dentro del
    // mes: un objetivo iniciado (o dado de baja) a mitad del mes se evalúa
    // contra sus días reales de operación, y el faltante se informa como
    // advertencia de mes incompleto — no como incumplimiento del patrón.
    const fechasUtiles = [...new Set(utiles.map(t => t.fecha))].sort()
    const ventanaDesde = fechasUtiles[0]
    const ventanaHasta = fechasUtiles[fechasUtiles.length - 1]
    const fechasVentana = fechasMes.filter(f => f.fecha >= ventanaDesde && f.fecha <= ventanaHasta)
    const equivalentesPorDow = new Map<number, number>()
    for (const f of fechasVentana) equivalentesPorDow.set(f.dow, (equivalentesPorDow.get(f.dow) ?? 0) + 1)

    // Agrupar por franja horaria y contar simultáneos por fecha.
    // La posición histórica "Principal" no se asume única: la cantidad sale
    // de contar turnos simultáneos, no de contar posiciones distintas.
    const porSlot = new Map<string, Map<string, number>>() // slot → fecha → simultáneos
    for (const t of utiles) {
      const slot = `${hora5(t.hora_inicio)}|${hora5(t.hora_fin)}`
      const fechas = porSlot.get(slot) ?? new Map<string, number>()
      fechas.set(t.fecha, (fechas.get(t.fecha) ?? 0) + 1)
      porSlot.set(slot, fechas)
    }

    const patrones: PatronCobertura[] = []
    const advertencias: string[] = []

    for (const [slot, porFecha] of porSlot) {
      const [hi, hf] = slot.split('|')
      const cantidades = [...porFecha.values()]
      const posiciones = moda(cantidades)

      // Presencia por día de semana: un día "cumple" si cubrió al menos la
      // cantidad habitual. Un solo refuerzo o faltante no tumba el patrón,
      // pero queda como excepción visible.
      const presentesPorDow = new Map<number, number>()
      for (const [fecha, cant] of porFecha) {
        if (cant >= posiciones) {
          const dow = dowPorFecha.get(fecha)!
          presentesPorDow.set(dow, (presentesPorDow.get(dow) ?? 0) + 1)
        }
      }

      // Días de semana donde la franja aparece de forma no excepcional.
      const dows = [...presentesPorDow.entries()]
        .filter(([dow, presentes]) => presentes / (equivalentesPorDow.get(dow) ?? 1) >= umbrales.revision)
        .map(([dow]) => dow)
        .sort((a, b) => a - b)

      const dowsEfectivos = dows.length > 0
        ? dows
        : [...new Set([...porFecha.keys()].map(f => dowPorFecha.get(f)!))].sort((a, b) => a - b)

      const dias_observados = dowsEfectivos.reduce((s, d) => s + (equivalentesPorDow.get(d) ?? 0), 0)
      const dias_cumplidos = dowsEfectivos.reduce((s, d) => s + (presentesPorDow.get(d) ?? 0), 0)
      // Sin ningún día de semana por encima del umbral de revisión, la franja
      // es una aparición excepcional (p. ej. un refuerzo de un solo día).
      const clasificacion: ClasificacionPatron = dows.length === 0
        ? 'excepcion'
        : clasificarProporcion(dias_cumplidos, dias_observados, umbrales)

      const excepciones: string[] = []
      for (const { fecha, dow } of fechasVentana) {
        if (!dowsEfectivos.includes(dow)) continue
        const cant = porFecha.get(fecha) ?? 0
        if (cant === posiciones) continue
        excepciones.push(`${fecha}: ${cant === 0 ? 'sin cobertura' : `${cant} en lugar de ${posiciones}`}`)
      }

      patrones.push({
        hora_inicio: hi,
        hora_fin: hf,
        nocturno: esTurnoNocturno({ hora_inicio: hi, hora_fin: hf }),
        etiqueta_dias: etiquetaDias(dowsEfectivos),
        dows: dowsEfectivos,
        posiciones,
        dias_observados,
        dias_cumplidos,
        porcentaje: dias_observados > 0 ? Math.round((dias_cumplidos / dias_observados) * 100) : 0,
        clasificacion,
        excepciones: excepciones.slice(0, 5),
        comparacion: null,
      })
    }

    patrones.sort((a, b) => b.dias_cumplidos - a.dias_cumplidos || a.hora_inicio.localeCompare(b.hora_inicio))

    // Comparación con la configuración existente (solo informa, no modifica).
    const serviciosObj = servicios.filter(s => s.objetivo_id === objetivo.id && s.activo)
    const horariosConfigurados = new Set<string>()
    for (const patron of patrones) {
      const mismos = serviciosObj.filter(s =>
        hora5(s.turno_base?.hora_inicio) === patron.hora_inicio &&
        hora5(s.turno_base?.hora_fin) === patron.hora_fin)
      mismos.forEach(() => horariosConfigurados.add(`${patron.hora_inicio}|${patron.hora_fin}`))
      if (mismos.length === 0) {
        patron.comparacion = serviciosObj.length === 0 ? 'falta_configuracion' : 'horario_diferente'
        continue
      }
      if (mismos.length !== patron.posiciones) {
        patron.comparacion = 'cantidad_diferente'
        continue
      }
      const diasConfig = [...new Set(mismos.flatMap(s => s.dias_semana ?? []))].sort((a, b) => a - b)
      patron.comparacion =
        JSON.stringify(diasConfig) === JSON.stringify(patron.dows) ? 'coincide' : 'dias_diferentes'
    }
    const configuracion_adicional = serviciosObj
      .filter(s => !horariosConfigurados.has(`${hora5(s.turno_base?.hora_inicio)}|${hora5(s.turno_base?.hora_fin)}`))
      .map(s => `${hora5(s.turno_base?.hora_inicio)}–${hora5(s.turno_base?.hora_fin)} configurado sin cobertura observada en el mes`)

    // Advertencias.
    if (capacitaciones >= 3) advertencias.push(`${capacitaciones} turnos de capacitación en el mes`)
    const fechasConTurno = new Set(fechasUtiles)
    const patronDiario = patrones.some(p => p.dows.length === 7 && p.clasificacion === 'fuerte')
    const sinTurnos = fechasVentana.filter(f => !fechasConTurno.has(f.fecha)).length
    if (patronDiario && sinTurnos > 0) advertencias.push(`${sinTurnos} día(s) del mes sin ningún turno`)
    const refuerzos = patrones.reduce((s, p) => s + p.excepciones.filter(e => e.includes('en lugar de')).length, 0)
    if (refuerzos > 0) advertencias.push('Días con cantidad distinta a la habitual (refuerzos o faltantes)')
    const atipicos = patrones.filter(p => p.clasificacion === 'excepcion').length
    if (atipicos > 0) advertencias.push(`${atipicos} franja(s) horaria(s) atípica(s) de aparición excepcional`)
    if (ventanaDesde > `${mesStr}-05`) advertencias.push(`Cobertura iniciada el ${ventanaDesde} (mes incompleto al inicio)`)
    const ultimoDia = fechasMes[fechasMes.length - 1].fecha
    if (ventanaHasta < `${mesStr}-26` && ventanaHasta < ultimoDia) advertencias.push(`Última cobertura el ${ventanaHasta} (mes incompleto al final)`)

    analisis.push({
      objetivo_id: objetivo.id,
      objetivo_nombre: objetivo.nombre,
      patrones,
      advertencias,
      configuracion_adicional,
    })
  }

  analisis.sort((a, b) => a.objetivo_nombre.localeCompare(b.objetivo_nombre))

  const tiene = (a: AnalisisObjetivo, c: ClasificacionPatron) => a.patrones.some(p => p.clasificacion === c)
  const resumen: ResumenCobertura = {
    objetivos_analizados: analisis.length,
    con_patron_fuerte: analisis.filter(a => tiene(a, 'fuerte')).length,
    con_patron_probable: analisis.filter(a => tiene(a, 'probable')).length,
    requieren_revision: analisis.filter(a => tiene(a, 'revision')).length,
    sin_informacion: analisis.filter(a => tiene(a, 'sin_informacion')).length,
  }

  return { mes: mesStr, resumen, objetivos: analisis }
}
