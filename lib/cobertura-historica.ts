/**
 * lib/cobertura-historica.ts
 *
 * Motor de cobertura histórica (Bloque E). Busca la CONSTANTE OPERATIVA de
 * cada objetivo a partir de los turnos registrados en un mes (julio 2026 como
 * fuente): horario repetido, días habituales y cantidad habitual de turnos
 * simultáneos.
 *
 * Julio fue el primer mes de uso del sistema: puede haber servicio cubierto
 * que no quedó registrado. Por eso el motor NO mide cumplimiento contractual,
 * días descubiertos, posiciones faltantes ni cobertura efectiva. Un día sin
 * registro es ausencia de evidencia, no evidencia de ausencia: no reduce la
 * cantidad propuesta ni se informa como faltante — a lo sumo genera la
 * advertencia técnica "Datos incompletos en el mes de referencia".
 *
 * Regla de inferencia: para cada (objetivo, día de semana, hora_inicio,
 * hora_fin), la cantidad habitual es la MODA entre los días con registros
 * válidos. Un horario aislado o una cantidad excepcional no altera el patrón:
 * queda como variación observada, no determinante.
 *
 * PURO: no escribe en Supabase, no crea turnos, no modifica servicios.
 *
 * Reglas que reutiliza:
 *   · capacitaciones y estados sin obligación (ESTADOS_SIN_OBLIGACION) no son
 *     servicio del objetivo; las coberturas (reemplazos) sí;
 *   · el patrón nunca depende del nombre del vigilador ni del guardia habitual;
 *   · los nocturnos cuentan en su fecha de inicio (regla existente de
 *     lib/turnos: hora_fin <= hora_inicio cruza medianoche; no se reescribe).
 */

import { ESTADOS_SIN_OBLIGACION } from '@/lib/revision-operativa'
import { esTurnoNocturno } from '@/lib/turnos'
import { caracteristicaTurno } from '@/lib/caracteristica-turno'

// ── Umbrales centralizados (proporciones sobre días con evidencia posible) ───

export const UMBRALES_PATRON = {
  /** ≥ 80% de los días equivalentes con registro → patrón claro. */
  fuerte: 0.8,
  /** ≥ 60% y < 80% → patrón probable. */
  probable: 0.6,
  /** ≥ 30% y < 60% → requiere revisión. Debajo, aparición aislada. */
  revision: 0.3,
  /** Mínimo de días comparables para opinar. */
  minimoDiasComparables: 7,
  /** Mínimo de días de registro para que una franja participe de la
   *  detección de cambio de esquema. */
  minimoDiasCambioEsquema: 5,
} as const

export type ClasificacionPatron =
  | 'fuerte'
  | 'probable'
  | 'revision'
  | 'excepcion'
  | 'cambio_esquema'
  | 'sin_informacion'

export const ETIQUETA_CLASIFICACION: Record<ClasificacionPatron, string> = {
  fuerte: 'Patrón claro',
  probable: 'Patrón probable',
  revision: 'Requiere revisión',
  excepcion: 'Variación observada (no determinante)',
  cambio_esquema: 'Cambio de esquema detectado',
  sin_informacion: 'Sin datos suficientes',
}

export const NOTA_ALCANCE_MOTOR =
  'La propuesta busca la estructura habitual registrada. No determina cumplimiento contractual ni cobertura efectiva.'

export const ADVERTENCIA_DATOS_INCOMPLETOS = 'Datos incompletos en el mes de referencia'

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
  /** Cantidad habitual de posiciones simultáneas (moda de los días con registro). */
  posiciones: number
  /** Días equivalentes de la ventana observable (denominador de referencia). */
  dias_observados: number
  /** Días con al menos un registro válido en la franja. */
  dias_con_registro: number
  porcentaje: number // 0–100, redondeado
  clasificacion: ClasificacionPatron
  /** Días registrados con cantidad distinta a la habitual (no determinantes). */
  variaciones: string[]
  /** Días de los dows del patrón sin ningún registro (dato técnico, sin causa). */
  dias_sin_registro: number
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
  diasConRegistro: number,
  diasObservados: number,
  umbrales = UMBRALES_PATRON,
): ClasificacionPatron {
  if (diasObservados < umbrales.minimoDiasComparables) return 'sin_informacion'
  const p = diasConRegistro / diasObservados
  if (p >= umbrales.fuerte) return 'fuerte'
  if (p >= umbrales.probable) return 'probable'
  if (p >= umbrales.revision) return 'revision'
  return 'excepcion'
}

/** Turno que representa servicio real del objetivo para el patrón. */
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
    if (utiles.length === 0) continue // nada representa servicio del objetivo

    // Ventana observable del objetivo dentro del mes: se analizan solo los
    // días desde el inicio observable del servicio (los anteriores no se
    // castigan; el recorte queda informado como dato, sin interpretar causa).
    const fechasUtiles = [...new Set(utiles.map(t => t.fecha))].sort()
    const ventanaDesde = fechasUtiles[0]
    const ventanaHasta = fechasUtiles[fechasUtiles.length - 1]
    const fechasVentana = fechasMes.filter(f => f.fecha >= ventanaDesde && f.fecha <= ventanaHasta)
    const equivalentesPorDow = new Map<number, number>()
    for (const f of fechasVentana) equivalentesPorDow.set(f.dow, (equivalentesPorDow.get(f.dow) ?? 0) + 1)

    // Registros por franja horaria y fecha (simultáneos por día). La posición
    // histórica "Principal" no se asume única: la cantidad sale de contar
    // turnos simultáneos, no de contar posiciones distintas.
    const porSlot = new Map<string, Map<string, number>>() // slot → fecha → simultáneos
    for (const t of utiles) {
      const slot = `${hora5(t.hora_inicio)}|${hora5(t.hora_fin)}`
      const fechas = porSlot.get(slot) ?? new Map<string, number>()
      fechas.set(t.fecha, (fechas.get(t.fecha) ?? 0) + 1)
      porSlot.set(slot, fechas)
    }

    const patrones: PatronCobertura[] = []
    const advertencias: string[] = []
    let diasSinRegistroTotal = 0

    for (const [slot, porFecha] of porSlot) {
      const [hi, hf] = slot.split('|')

      // Presencia (≥1 registro) y moda por día de semana. La cantidad habitual
      // sale SOLO de los días con registro: los días sin registro no reducen
      // la propuesta ni cuentan como incumplimiento.
      const presentesPorDow = new Map<number, number>()
      const cantidadesPorDow = new Map<number, number[]>()
      for (const [fecha, cant] of porFecha) {
        const dow = dowPorFecha.get(fecha)!
        presentesPorDow.set(dow, (presentesPorDow.get(dow) ?? 0) + 1)
        cantidadesPorDow.set(dow, [...(cantidadesPorDow.get(dow) ?? []), cant])
      }

      // Días de semana donde la franja aparece de forma no aislada.
      const dows = [...presentesPorDow.entries()]
        .filter(([dow, presentes]) => presentes / (equivalentesPorDow.get(dow) ?? 1) >= umbrales.revision)
        .map(([dow]) => dow)
        .sort((a, b) => a - b)

      const dowsEfectivos = dows.length > 0
        ? dows
        : [...new Set([...porFecha.keys()].map(f => dowPorFecha.get(f)!))].sort((a, b) => a - b)

      // Sub-patrones por cantidad habitual: la moda se calcula por día de
      // semana y los días con igual cantidad habitual se agrupan (permite
      // "Lun–Vie 2 posiciones / Sáb y Dom 1 posición" en la misma franja).
      const grupos = new Map<number, number[]>() // cantidad habitual → dows
      for (const dow of dowsEfectivos) {
        const cantidad = moda(cantidadesPorDow.get(dow) ?? [])
        grupos.set(cantidad, [...(grupos.get(cantidad) ?? []), dow])
      }

      for (const [posiciones, dowsGrupo] of grupos) {
        const dias_observados = dowsGrupo.reduce((s, d) => s + (equivalentesPorDow.get(d) ?? 0), 0)
        const dias_con_registro = dowsGrupo.reduce((s, d) => s + (presentesPorDow.get(d) ?? 0), 0)
        const clasificacion: ClasificacionPatron = dows.length === 0
          ? 'excepcion'
          : clasificarProporcion(dias_con_registro, dias_observados, umbrales)

        // Variaciones: días registrados con cantidad distinta a la habitual.
        // Los días sin registro NO se listan (solo se cuentan como dato).
        const variaciones: string[] = []
        let dias_sin_registro = 0
        for (const { fecha, dow } of fechasVentana) {
          if (!dowsGrupo.includes(dow)) continue
          const cant = porFecha.get(fecha)
          if (cant === undefined) { dias_sin_registro++; continue }
          if (cant !== posiciones) variaciones.push(`${fecha}: ${cant} registrado(s), habitual ${posiciones}`)
        }
        diasSinRegistroTotal += dias_sin_registro

        patrones.push({
          hora_inicio: hi,
          hora_fin: hf,
          nocturno: esTurnoNocturno({ hora_inicio: hi, hora_fin: hf }),
          etiqueta_dias: etiquetaDias(dowsGrupo),
          dows: dowsGrupo,
          posiciones,
          dias_observados,
          dias_con_registro,
          porcentaje: dias_observados > 0 ? Math.round((dias_con_registro / dias_observados) * 100) : 0,
          clasificacion,
          variaciones: variaciones.slice(0, 5),
          dias_sin_registro,
          comparacion: null,
        })
      }
    }

    patrones.sort((a, b) => b.dias_con_registro - a.dias_con_registro || a.hora_inicio.localeCompare(b.hora_inicio))

    // Cambio de esquema: dos franjas con suficiente registro cuyas ventanas
    // son secuenciales (una termina antes de que empiece la otra) indican un
    // cambio estructural dentro del mes, no dos patrones estables.
    const ventanaPorPatron = patrones.map(p => {
      const fechas = [...(porSlot.get(`${p.hora_inicio}|${p.hora_fin}`) ?? new Map()).keys()]
        .filter(f => p.dows.includes(dowPorFecha.get(f)!))
        .sort()
      return { desde: fechas[0] ?? '', hasta: fechas[fechas.length - 1] ?? '' }
    })
    let huboCambioEsquema = false
    for (let a = 0; a < patrones.length; a++) {
      for (let b = 0; b < patrones.length; b++) {
        if (a === b) continue
        const pa = patrones[a]; const pb = patrones[b]
        if (pa.dias_con_registro < umbrales.minimoDiasCambioEsquema) continue
        if (pb.dias_con_registro < umbrales.minimoDiasCambioEsquema) continue
        if (pa.clasificacion === 'fuerte' || pb.clasificacion === 'fuerte') continue
        if (ventanaPorPatron[a].hasta < ventanaPorPatron[b].desde) {
          patrones[a].clasificacion = 'cambio_esquema'
          patrones[b].clasificacion = 'cambio_esquema'
          huboCambioEsquema = true
        }
      }
    }
    if (huboCambioEsquema) advertencias.push('Cambio de esquema detectado: requiere revisión')

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
      .map(s => `${hora5(s.turno_base?.hora_inicio)}–${hora5(s.turno_base?.hora_fin)} configurado sin registros en el mes`)

    // Advertencias técnicas: describen los datos, nunca interpretan causa ni
    // afirman incumplimiento.
    if (capacitaciones >= 3) advertencias.push(`${capacitaciones} turnos de capacitación en el mes`)
    if (diasSinRegistroTotal > 0) advertencias.push(`${ADVERTENCIA_DATOS_INCOMPLETOS} (${diasSinRegistroTotal} día(s) sin registros en franjas habituales)`)
    const variacionesTotal = patrones.reduce((s, p) => s + p.variaciones.length, 0)
    if (variacionesTotal > 0) advertencias.push('Variaciones observadas en la cantidad registrada')
    const aisladas = patrones.filter(p => p.clasificacion === 'excepcion').length
    if (aisladas > 0) advertencias.push(`${aisladas} franja(s) de aparición aislada`)
    if (ventanaDesde > `${mesStr}-05`) advertencias.push(`Registros desde el ${ventanaDesde} (inicio observable del servicio)`)
    const ultimoDia = fechasMes[fechasMes.length - 1].fecha
    if (ventanaHasta < `${mesStr}-26` && ventanaHasta < ultimoDia) advertencias.push(`Últimos registros el ${ventanaHasta}`)

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
    requieren_revision: analisis.filter(a => tiene(a, 'revision') || tiene(a, 'cambio_esquema')).length,
    sin_informacion: analisis.filter(a => tiene(a, 'sin_informacion')).length,
  }

  return { mes: mesStr, resumen, objetivos: analisis }
}
