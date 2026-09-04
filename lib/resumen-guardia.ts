/**
 * lib/resumen-guardia.ts
 *
 * Resumen Guardia mensual: el insumo pre-liquidación que hasta ahora se armaba
 * contando planillas manuscritas (libro de Novedades, una hoja por mes).
 *
 * Qué ES: una vista derivada, por empleado y mes, de los datos consolidados de
 * MERCOSUR — horas canónicas, jornadas, feriados y novedades registradas.
 *
 * Qué NO es: no calcula dinero, no conoce tarifas ni conceptos, no persiste
 * nada y no recalcula horas. Toda hora sale de resolverLineaLiquidacion()
 * (lib/liquidacion.ts); este módulo sólo agrupa y cuenta.
 *
 * Jornada trabajada ≠ fecha con actividad (decisión de Juan, 03/09/2026):
 *   · JORNADA: fechas de INICIO distintas entre los turnos con horas
 *     reconocidas. Un turno nocturno que cruza la medianoche es UNA jornada
 *     aunque toque dos fechas; y un turno cortado (mañana + noche del mismo
 *     día — pasa de verdad: hay vigiladores con 13 días partidos en un mes)
 *     también es UNA jornada, no dos. Es el equivalente del "días" del conteo
 *     manual. (El tope de 25 días que aplica la planilla de sueldos es una
 *     regla de LIQUIDACIÓN, no de este resumen: queda para F5.)
 *   · FECHA CON ACTIVIDAD: cada fecha calendario tocada por esos turnos,
 *     incluida la del día siguiente cuando el turno cruza la medianoche. Es
 *     la métrica de auditoría, separada a propósito.
 *
 * Dato ausente ≠ cero: las columnas de novedades (licencias, ART, vacaciones,
 * parte médico, ausencias/suspensiones) devuelven null cuando el sistema no
 * tiene NINGUNA novedad aprobada de ese tipo para el empleado en el mes.
 * null significa "sin registro en la app", nunca se rellena con 0 inventado.
 */

import {
  RegistroUniverso,
  TurnoUniverso,
  effectiveGuardia,
  esPeriodoTransicion,
  resolverLineaLiquidacion,
  selectRegistroPrincipal,
} from '@/lib/liquidacion'
import { ESTADOS_SIN_OBLIGACION } from '@/lib/revision-operativa'
import { resumirFeriados, turnoCuentaEnFeriado } from '@/lib/feriados'
import {
  NovedadLaboral,
  TipoNovedad,
  novedadesAprobadas,
} from '@/lib/novedades-laborales'

// ── Tipos de entrada ──────────────────────────────────────────────────────────

export interface EmpleadoResumen {
  id: string
  nombre?: string | null
  apellido?: string | null
  cuil?: string | null
  legajo?: string | null
  /**
   * Etiqueta de Legajo que usa Visual Sueldos (usuarios.legajo_visual,
   * alfanumérica, ej. "ALMADA", "011 Bis"). No confundir con `legajo`
   * (histórico: contiene CUIL o DNI).
   */
  legajoVisual?: string | null
}

export interface TurnoResumen extends TurnoUniverso {
  guardia_id?: string | null
}

export interface NovedadResumen extends NovedadLaboral {
  id?: string | null
  /** Cantidad de horas cuando el tipo la usa (ej. ajuste_nocturnidad). */
  horas_afectadas?: number | string | null
  /**
   * Novedad MENSUAL INFORMADA: cantidad de días sin fechas exactas. Cuando
   * está presente vale este número y las fechas son sólo el período de
   * referencia. NULL = novedad normal (cantidad por fechas).
   */
  dias_informados?: number | string | null
}

/**
 * Configuración de nocturnidad del objetivo/servicio (columnas
 * objetivos.nocturnidad_activa/desde/hasta). Es una condición contractual del
 * servicio: el resumen sólo la consume, nunca la decide.
 */
export interface ConfigNocturnidad {
  activa: boolean
  /** 'HH:MM' (o 'HH:MM:SS'); la franja puede cruzar la medianoche. */
  desde: string | null
  hasta: string | null
}

/**
 * Excepción por empleado dentro de un objetivo
 * (tabla nocturnidad_empleado_objetivo):
 *   'heredar' → vale la configuración del objetivo (igual que no tener fila)
 *   'si'      → cobra nocturnidad aunque el objetivo no la tenga activa
 *   'no'      → no cobra aunque el objetivo la tenga activa
 */
export type ModoNocturnidadEmpleado = 'heredar' | 'si' | 'no'

/**
 * Franja usada cuando una excepción 'si' aplica sobre un objetivo que no tiene
 * franja propia configurada. Es la franja vigente confirmada por la empresa;
 * si el objetivo define la suya, la del objetivo siempre gana.
 */
export const FRANJA_NOCTURNA_DEFAULT = { desde: '22:00', hasta: '06:00' }

/**
 * Tipo de novedad laboral que fija las horas nocturnas FINALES de un empleado
 * para el período (ajuste manual mensual). REEMPLAZA al cálculo automático —
 * no se le suma — y no toca horas liquidables ni configuración permanente.
 */
export const TIPO_AJUSTE_NOCTURNIDAD = 'ajuste_nocturnidad'

export interface ParamsResumenGuardia {
  /** Mes operativo, formato 'YYYY-MM'. */
  mes: string
  empleados: EmpleadoResumen[]
  /** Turnos del mes (con estado y objetivo_id). */
  turnos: TurnoResumen[]
  /** Registros de asistencia de esos turnos. */
  registros: RegistroUniverso[]
  /** Novedades laborales que tocan el mes; acá se filtran las aprobadas. */
  novedades: NovedadResumen[]
  /** Identificación canónica de objetivos de prueba (objetivos.es_prueba). */
  esObjetivoPrueba: (objetivoId?: string | null) => boolean
  /** Nombre visible del objetivo, para la columna Objetivo/s. */
  nombreObjetivo?: (objetivoId?: string | null) => string
  /**
   * Configuración de nocturnidad por objetivo. Si no se provee, la columna
   * queda como dato no determinado (null), nunca como 0 inventado.
   */
  nocturnidadObjetivo?: (objetivoId?: string | null) => ConfigNocturnidad | null
  /**
   * Excepción por empleado+objetivo. Sin fila (o sin callback) equivale a
   * 'heredar': vale lo que diga el objetivo.
   */
  nocturnidadEmpleadoObjetivo?: (
    empleadoId: string,
    objetivoId?: string | null,
  ) => ModoNocturnidadEmpleado | null
}

// ── Tipos de salida ───────────────────────────────────────────────────────────

/** Conteo de días de novedad. null = sin registro en la app (≠ 0). */
export type DiasNovedad = number | null

export interface FilaResumenGuardia {
  empleadoId: string
  nombre: string
  cuil: string | null
  legajo: string | null
  /** Legajo de Visual Sueldos: primera columna del archivo de liquidación. */
  legajoVisual: string | null
  /** Objetivos con horas reconocidas en el mes, orden alfabético. */
  objetivos: string[]
  /**
   * Fechas de inicio distintas entre los turnos con horas reconocidas.
   * Nocturno que cruza medianoche = 1; turno cortado del mismo día = 1.
   */
  jornadas: number
  /** Fechas calendario tocadas por esos turnos (auditoría). */
  fechasConActividad: number
  horasReales: number
  horasLiquidables: number
  feriadosTrabajados: number
  horasEnFeriado: number
  /**
   * Horas nocturnas FINALES del período, tras resolver la precedencia:
   *   1º ajuste manual mensual (novedad aprobada tipo 'ajuste_nocturnidad':
   *      reemplaza al cálculo, no se le suma);
   *   2º excepción empleado+objetivo (si / no / heredar);
   *   3º configuración general del objetivo.
   * Es un PLUS informativo: NUNCA se resta de horasLiquidables — un turno
   * 19:00–07:00 reconocido entero es 12 liquidables y 8 nocturnas.
   * 0 = se pudo determinar que no corresponde. null = no se pudo determinar
   * (sin configuración disponible) — nunca se inventa un 0.
   */
  horasNocturnas: number | null
  /** El resultado del cálculo automático solo (auditoría del ajuste manual). */
  horasNocturnasCalculadas: number | null
  /** De dónde salió el valor final. */
  nocturnidadOrigen: 'ajuste_manual' | 'calculo' | null
  licencias: DiasNovedad
  art: DiasNovedad
  vacaciones: DiasNovedad
  parteMedico: DiasNovedad
  ausenciasSuspensiones: DiasNovedad
  /** Novedades del mes en texto corto (tipo y rango), para la columna libre. */
  notas: string[]
  /** Trazabilidad: qué datos de MERCOSUR originaron la fila. */
  origen: {
    turnoIds: string[]
    registroIds: string[]
    novedadIds: string[]
  }
}

export interface ResumenGuardiaMes {
  mes: string
  filas: FilaResumenGuardia[]
  totales: {
    empleados: number
    jornadas: number
    horasReales: number
    horasLiquidables: number
    /** Suma de las filas con dato; las filas null (no determinado) no aportan. */
    horasNocturnas: number
    feriadosTrabajados: number
  }
}

// ── Fechas (aritmética pura sobre 'YYYY-MM-DD', sin zonas horarias) ───────────

function diaSiguiente(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Mismo criterio nocturno que finProgramadoTurno() y las RPC de Postgres. */
function cruzaMedianoche(turno: TurnoUniverso): boolean {
  const [hi, mi] = turno.hora_inicio.split(':').map(Number)
  const [hf, mf] = turno.hora_fin.split(':').map(Number)
  return (hf * 60 + mf) <= (hi * 60 + mi)
}

function minutosDelDia(hhmm: string): number {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/**
 * Horas del tramo [entrada, salida] que caen dentro de la franja nocturna
 * [desde, hasta]. Tanto el tramo como la franja pueden cruzar la medianoche
 * (salida <= entrada, o hasta <= desde). Devuelve horas con decimales — los
 * minutos no se redondean acá.
 */
export function horasNocturnasTramo(
  entrada: string,
  salida: string,
  desde: string,
  hasta: string,
): number {
  const ini = minutosDelDia(entrada)
  let fin = minutosDelDia(salida)
  if (fin <= ini) fin += 1440

  const vDesde = minutosDelDia(desde)
  let largo = minutosDelDia(hasta) - vDesde
  if (largo <= 0) largo += 1440

  // La franja se repite cada día; con turnos de hasta 24 h alcanza con mirar
  // la ocurrencia del día anterior, la del día y la del siguiente.
  let minutos = 0
  for (const k of [-1, 0, 1]) {
    const vIni = vDesde + k * 1440
    const vFin = vIni + largo
    minutos += Math.max(0, Math.min(fin, vFin) - Math.max(ini, vIni))
  }
  return minutos / 60
}

function ultimoDiaDelMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number)
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`
}

/** Días de la novedad que caen dentro del mes (extremos inclusivos). */
export function diasDeNovedadEnMes(n: NovedadLaboral, mes: string): number {
  const desde = n.fecha_desde > `${mes}-01` ? n.fecha_desde : `${mes}-01`
  const hasta = n.fecha_hasta < ultimoDiaDelMes(mes) ? n.fecha_hasta : ultimoDiaDelMes(mes)
  if (desde > hasta) return 0
  const ms = Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)
  return Math.round(ms / 86_400_000) + 1
}

// ── Novedades → columnas del resumen ─────────────────────────────────────────
// Mapa alineado con las columnas del libro de Novedades histórico. La app
// no infiere novedades: sólo cuenta las que Administración aprobó.

const TIPOS_POR_COLUMNA: Record<string, TipoNovedad[]> = {
  licencias: ['licencia'],
  art: ['accidente'],
  vacaciones: ['vacaciones'],
  parteMedico: ['parte_medico'],
  ausenciasSuspensiones: ['falta_injustificada', 'suspension'],
}

const ETIQUETA_TIPO: Record<string, string> = {
  parte_medico: 'parte médico',
  accidente: 'ART',
  licencia: 'licencia',
  vacaciones: 'vacaciones',
  falta_justificada: 'falta justificada',
  falta_injustificada: 'falta injustificada',
  dia_estudio: 'día de estudio',
  suspension: 'suspensión',
  franco: 'franco',
  otra: 'novedad',
}

/**
 * Días que aporta una novedad al mes. Una novedad MENSUAL INFORMADA (con
 * dias_informados) vale exactamente esa cantidad — sus fechas son sólo el
 * período de referencia, no días afirmados. Una novedad normal vale los días
 * de su rango que caen en el mes. La deduplicación pasa en la IMPORTACIÓN
 * (las mensuales se cargan por la diferencia contra lo ya registrado con
 * fechas), así que acá la suma de ambas fuentes nunca duplica.
 */
function diasQueAporta(n: NovedadResumen, mes: string): number {
  if (n.dias_informados != null) {
    // Sólo cuenta si su período de referencia toca el mes pedido.
    return diasDeNovedadEnMes(n, mes) > 0 ? Number(n.dias_informados) : 0
  }
  return diasDeNovedadEnMes(n, mes)
}

function contarColumna(
  novedades: NovedadResumen[],
  tipos: TipoNovedad[],
  mes: string,
): DiasNovedad {
  const propias = novedades.filter(n =>
    tipos.includes(n.tipo as TipoNovedad) && diasDeNovedadEnMes(n, mes) > 0,
  )
  if (propias.length === 0) return null
  return propias.reduce((s, n) => s + diasQueAporta(n, mes), 0)
}

function notaDeNovedad(n: NovedadResumen, mes: string): string {
  const etiqueta = ETIQUETA_TIPO[n.tipo] ?? n.tipo
  if (n.dias_informados != null) {
    // Mensual informada: no afirmar fechas que no conocemos.
    return `${etiqueta} ${Number(n.dias_informados)} d (mensual informada)`
  }
  const dias = diasDeNovedadEnMes(n, mes)
  const rango = n.fecha_desde === n.fecha_hasta
    ? n.fecha_desde.slice(8, 10) + '/' + n.fecha_desde.slice(5, 7)
    : `${n.fecha_desde.slice(8, 10)}/${n.fecha_desde.slice(5, 7)}–${n.fecha_hasta.slice(8, 10)}/${n.fecha_hasta.slice(5, 7)}`
  return `${etiqueta} ${rango} (${dias} d)`
}

// ── Construcción del resumen ──────────────────────────────────────────────────

export function construirResumenGuardia(params: ParamsResumenGuardia): ResumenGuardiaMes {
  const { mes, empleados, turnos, registros, esObjetivoPrueba } = params
  const nombreObjetivo = params.nombreObjetivo ?? ((id?: string | null) => id ?? '')
  const aprobadas = novedadesAprobadas(params.novedades) as NovedadResumen[]

  // Universo de turnos válidos: sin objetivos de prueba, sin estados sin
  // obligación (reemplazado/anulado/cancelado). Mismo criterio que
  // turnosOperativosDelMes(), aplicado una vez acá.
  const turnosValidos = turnos.filter(t =>
    !esObjetivoPrueba(t.objetivo_id) && !ESTADOS_SIN_OBLIGACION.has(t.estado || ''),
  )
  const turnoPorId = new Map<string, TurnoResumen>(turnosValidos.map(t => [t.id, t]))

  // Turnos que tienen algún registro (de cualquier guardia): un turno cubierto
  // por reemplazo no debe caer también como fallback de transición del titular.
  const turnosConRegistro = new Set(registros.map(r => r.turno_id))

  const filas: FilaResumenGuardia[] = []

  for (const emp of empleados) {
    // Registros del empleado sobre turnos válidos. La ausencia registrada no
    // es actividad. El guardia efectivo (final ?? original) decide de quién es
    // la línea — igual que Reportes y el Legajo.
    const propios = registros.filter(r =>
      r.tipo_registro !== 'ausencia' &&
      effectiveGuardia(r) === emp.id &&
      turnoPorId.has(r.turno_id),
    )
    const porTurno = new Map<string, RegistroUniverso[]>()
    for (const r of propios) {
      const arr = porTurno.get(r.turno_id) ?? []
      arr.push(r)
      porTurno.set(r.turno_id, arr)
    }

    // Transición jun/jul 2026: turno cubierto sin ningún registro → cuenta por
    // horas programadas. resolverLineaLiquidacion(turno, null) resuelve el valor.
    const fallback = turnosValidos.filter(t =>
      t.guardia_id === emp.id &&
      t.estado === 'cubierto' &&
      esPeriodoTransicion(t.fecha) &&
      !turnosConRegistro.has(t.id),
    )

    // Una línea por turno, siempre vía la fuente única de horas.
    const lineas: {
      turno: TurnoResumen
      registro: RegistroUniverso | null
      horasReales: number
      horasLiquidables: number
    }[] = []
    for (const [turnoId, rs] of Array.from(porTurno.entries())) {
      const turno = turnoPorId.get(turnoId)!
      const registro: RegistroUniverso | null = selectRegistroPrincipal<RegistroUniverso>(rs, emp.id) ?? null
      const linea = resolverLineaLiquidacion(turno, registro)
      lineas.push({ turno, registro, horasReales: linea.horasReales, horasLiquidables: linea.horasLiquidables })
    }
    for (const turno of fallback) {
      const linea = resolverLineaLiquidacion(turno, null)
      lineas.push({ turno, registro: null, horasReales: linea.horasReales, horasLiquidables: linea.horasLiquidables })
    }

    // Jornadas y fechas: sólo turnos con horas reconocidas.
    const reconocidas = lineas.filter(l => l.horasLiquidables > 0)
    const jornadas = new Set<string>()
    const fechas = new Set<string>()
    for (const l of reconocidas) {
      jornadas.add(l.turno.fecha)
      fechas.add(l.turno.fecha)
      if (cruzaMedianoche(l.turno)) fechas.add(diaSiguiente(l.turno.fecha))
    }

    const horasReales = lineas.reduce((s, l) => s + l.horasReales, 0)
    const horasLiquidables = lineas.reduce((s, l) => s + l.horasLiquidables, 0)

    const novedadesEmp = aprobadas.filter(n => n.empleado_id === emp.id)

    // ── Nocturnidad — cálculo automático ──────────────────────────────────
    // Subconjunto de las horas liquidables que cae en la franja nocturna. Es
    // un plus informativo — jamás se resta del total. Por línea se resuelve la
    // excepción empleado+objetivo ('si'/'no'/'heredar') y recién después la
    // configuración general del objetivo. La distribución temporal usa la
    // MISMA fuente que las horas: tramo corregido (_final ?? real) cuando hubo
    // corrección explícita, y el horario programado del turno en los demás
    // casos (el GPS crudo confirma presencia pero no determina horas, y una
    // cobertura manual sin horario observado sólo conoce el turno). Si las
    // horas reconocidas son menores que el tramo, la parte nocturna se topea a
    // lo reconocido: nunca se informa más nocturno que liquidable, y no se
    // inventa una distribución.
    const hayConfig = params.nocturnidadObjetivo != null
    let horasNocturnasCalculadas: number | null = hayConfig ? 0 : null
    if (hayConfig) {
      for (const l of reconocidas) {
        const objetivoLinea = l.registro?.objetivo_final_id ?? l.turno.objetivo_id
        const cfg = params.nocturnidadObjetivo!(objetivoLinea)
        const modo: ModoNocturnidadEmpleado =
          params.nocturnidadEmpleadoObjetivo?.(emp.id, objetivoLinea) ?? 'heredar'

        if (modo === 'no') continue
        if (modo === 'heredar' && !cfg?.activa) continue
        // modo 'si': cobra aunque el objetivo no tenga activa la regla.
        // Franja: la del objetivo si la tiene definida; si no, la default de
        // la empresa (una excepción 'si' sobre un objetivo sin franja propia
        // no puede quedar sin franja, y la del objetivo siempre gana).
        const desde = cfg?.desde ?? (modo === 'si' ? FRANJA_NOCTURNA_DEFAULT.desde : null)
        const hasta = cfg?.hasta ?? (modo === 'si' ? FRANJA_NOCTURNA_DEFAULT.hasta : null)
        if (!desde || !hasta) {
          // Configuración activa pero incompleta: dato pendiente, no 0.
          horasNocturnasCalculadas = null
          break
        }
        const tieneCorreccion =
          l.registro?.hora_entrada_final != null || l.registro?.hora_salida_final != null
        const entrada = tieneCorreccion
          ? (l.registro?.hora_entrada_final ?? l.registro?.hora_entrada_real ?? l.turno.hora_inicio)
          : l.turno.hora_inicio
        const salida = tieneCorreccion
          ? (l.registro?.hora_salida_final ?? l.registro?.hora_salida_real ?? l.turno.hora_fin)
          : l.turno.hora_fin
        const enFranja = horasNocturnasTramo(entrada, salida, desde, hasta)
        horasNocturnasCalculadas = (horasNocturnasCalculadas ?? 0) + Math.min(enFranja, l.horasLiquidables)
      }
      if (horasNocturnasCalculadas != null) {
        horasNocturnasCalculadas = Math.round(horasNocturnasCalculadas * 100) / 100
      }
    }

    // ── Nocturnidad — ajuste manual mensual (máxima precedencia) ──────────
    // Una novedad aprobada tipo 'ajuste_nocturnidad' que toca el mes fija las
    // horas nocturnas FINALES del empleado: REEMPLAZA al cálculo (no se suma)
    // sin alterar horas liquidables, configuración permanente ni turnos.
    const ajustes = novedadesEmp.filter(
      n => n.tipo === TIPO_AJUSTE_NOCTURNIDAD && diasDeNovedadEnMes(n, mes) > 0,
    )
    const ajusteManual = ajustes.length > 0
      ? Math.round(ajustes.reduce((s, n) => s + (Number(n.horas_afectadas) || 0), 0) * 100) / 100
      : null

    const horasNocturnas = ajusteManual ?? horasNocturnasCalculadas
    const nocturnidadOrigen: 'ajuste_manual' | 'calculo' | null =
      ajusteManual != null ? 'ajuste_manual' : (horasNocturnasCalculadas != null ? 'calculo' : null)

    const feriados = resumirFeriados(lineas.map(l => ({
      fecha: l.turno.fecha,
      cuenta: turnoCuentaEnFeriado(l.turno, l.horasLiquidables, ESTADOS_SIN_OBLIGACION),
      horas: l.horasLiquidables,
    })))

    const objetivos = Array.from(new Set(
      reconocidas.map(l => nombreObjetivo(l.registro?.objetivo_final_id ?? l.turno.objetivo_id)).filter(Boolean),
    )).sort()

    // Fila sólo si hay algo que decir: actividad reconocida o novedades. Un
    // empleado sin nada en el mes no aparece — igual que en la hoja manual.
    if (reconocidas.length === 0 && lineas.length === 0 && novedadesEmp.length === 0) continue

    filas.push({
      empleadoId: emp.id,
      nombre: `${emp.apellido ?? ''}, ${emp.nombre ?? ''}`.replace(/^, |, $/g, '').trim(),
      cuil: emp.cuil ?? null,
      legajo: emp.legajo ?? null,
      legajoVisual: emp.legajoVisual ?? null,
      objetivos,
      jornadas: jornadas.size,
      fechasConActividad: fechas.size,
      horasReales: Math.round(horasReales * 100) / 100,
      horasLiquidables: Math.round(horasLiquidables * 100) / 100,
      feriadosTrabajados: feriados.feriadosCubiertos,
      horasEnFeriado: feriados.horas,
      horasNocturnas,
      horasNocturnasCalculadas,
      nocturnidadOrigen,
      licencias: contarColumna(novedadesEmp, TIPOS_POR_COLUMNA.licencias, mes),
      art: contarColumna(novedadesEmp, TIPOS_POR_COLUMNA.art, mes),
      vacaciones: contarColumna(novedadesEmp, TIPOS_POR_COLUMNA.vacaciones, mes),
      parteMedico: contarColumna(novedadesEmp, TIPOS_POR_COLUMNA.parteMedico, mes),
      ausenciasSuspensiones: contarColumna(novedadesEmp, TIPOS_POR_COLUMNA.ausenciasSuspensiones, mes),
      // El ajuste de nocturnidad no es una novedad de día: no va al texto
      // libre (ya está expresado en la columna HORAS NOCTURNAS).
      notas: novedadesEmp.filter(n => n.tipo !== TIPO_AJUSTE_NOCTURNIDAD).map(n => notaDeNovedad(n, mes)),
      origen: {
        turnoIds: lineas.map(l => l.turno.id),
        registroIds: lineas.map(l => l.registro?.id ?? null).filter((x): x is string => x != null),
        novedadIds: novedadesEmp.map(n => n.id ?? null).filter((x): x is string => x != null),
      },
    })
  }

  filas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

  return {
    mes,
    filas,
    totales: {
      empleados: filas.length,
      jornadas: filas.reduce((s, f) => s + f.jornadas, 0),
      horasReales: Math.round(filas.reduce((s, f) => s + f.horasReales, 0) * 100) / 100,
      horasLiquidables: Math.round(filas.reduce((s, f) => s + f.horasLiquidables, 0) * 100) / 100,
      horasNocturnas: Math.round(filas.reduce((s, f) => s + (f.horasNocturnas ?? 0), 0) * 100) / 100,
      feriadosTrabajados: filas.reduce((s, f) => s + f.feriadosTrabajados, 0),
    },
  }
}

// ── Export XLSX (estructura de filas; la descarga la hace la pantalla) ────────
// Layout tomado del libro de Novedades: una fila por empleado, columnas
// reconocibles. null se exporta como celda vacía — "sin dato", nunca 0.

const NOMBRE_MES = [
  '', 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
]

export function tituloResumenGuardia(mes: string): string {
  const [a, m] = mes.split('-').map(Number)
  return `RESUMEN GUARDIA — ${NOMBRE_MES[m] ?? mes} ${a}`
}

function celda(v: number | null): number | '' {
  return v == null ? '' : v
}

// Columnas alineadas al insumo real de liquidación (Fase 0B, hoja mensual del
// libro de Novedades). Fuera del XLSX quedan las métricas internas de
// auditoría (horas reales, fechas con actividad, horas en feriado): siguen en
// FilaResumenGuardia pero no son campos de liquidación. CUENTA va vacía hasta
// que existan datos bancarios en el sistema (formato de transición).
// Archivo de trabajo plano, a pedido de Juan: encabezado en la primera fila,
// sin texto explicativo ni celdas combinadas. Las semánticas (jornadas,
// nocturnas finales, vacío = sin dato) viven en la documentación del módulo.
export function filasXLSXResumenGuardia(resumen: ResumenGuardiaMes): (string | number)[][] {
  const filas: (string | number)[][] = [
    ['LEGAJO VISUAL', 'CUIL', 'CUENTA', 'NOMBRE', 'NOVEDADES', 'OBJETIVO/S', 'JORNADAS', 'HORAS LIQUIDABLES', 'HORAS NOCTURNAS', 'FERIADOS', 'LICENCIAS', 'ART', 'VACACIONES', 'PARTE MÉDICO', 'AUS/SUSP'],
    ...resumen.filas.map(f => [
      f.legajoVisual ?? '',
      f.cuil ?? '',
      '', // CUENTA: sin datos bancarios en el sistema todavía
      f.nombre,
      f.notas.join(' · '),
      f.objetivos.join('/'),
      f.jornadas,
      f.horasLiquidables,
      celda(f.horasNocturnas),
      f.feriadosTrabajados,
      celda(f.licencias),
      celda(f.art),
      celda(f.vacaciones),
      celda(f.parteMedico),
      celda(f.ausenciasSuspensiones),
    ] as (string | number)[]),
    [],
    ['TOTALES', '', '', '', '', '', resumen.totales.jornadas, resumen.totales.horasLiquidables, resumen.totales.horasNocturnas, resumen.totales.feriadosTrabajados],
  ]
  return filas
}

// ── Plantilla canónica de liquidación (ejemplo agoto app.xlsx) ────────────────
//
// Reproduce la planilla que Juan armó sobre el export del Resumen Guardia:
// bloque de parámetros (filas 1-4), encabezados (filas 5-6), una fila por
// vigilador con la capa de fórmulas de liquidación (columnas H y U-AX), una
// fila separadora y la fila TOTALES con SUM por columna. Las únicas celdas
// que la app rellena son las de entrada: parámetros fijos, encabezados y los
// datos consolidados A-P de cada vigilador; todo lo demás son las fórmulas de
// la plantilla, tal cual, con la referencia de fila ajustada.
//
// Columnas de carga manual que quedan vacías a propósito (Juan las completa
// en Excel después de descargar): AH (hs a valor pleno, concepto 212),
// AR (adelantos) y los reemplazos puntuales de AP por un importe fijo.
//
// Desvíos deliberados respecto del archivo de ejemplo, todos verificados con
// Juan o neutros:
//  · AF (nocturnidad 004) usa (Y/10)*J = hora/10 × hs nocturnas en TODAS las
//    filas. El ejemplo tenía ((Y*200)/10)*J en las filas con J=0 (donde no
//    afecta) y la fórmula corregida solo en FIGGINI, la única con nocturnas.
//    Emitir la variante errada habría pagado 200 veces de más el primer mes
//    en que otro vigilador tenga nocturnas.
//  · G de TOTALES es SUM como sus vecinas (el ejemplo traía 1322 pegado a mano).
//  · No se copian dos celdas sueltas del ejemplo: AO3 (cuenta borrador que
//    apuntaba a la fila 12 de ESE mes) y X83 (un espacio perdido).
//
// Devuelve celdas puras (sin depender de xlsx): v = valor, f = fórmula. Las
// fórmulas llevan además el valor calculado en `v` para que el archivo muestre
// importes aunque el visor no recalcule al abrir.

export interface CeldaPlantilla {
  ref: string
  v?: string | number
  f?: string
}

export interface PlantillaLiquidacion {
  nombreHoja: string
  /** Rango usado de la hoja, p. ej. 'A1:AX73'. */
  ref: string
  celdas: CeldaPlantilla[]
}

/** Parámetros salariales de la plantilla; Juan los edita en Excel (todo recalcula desde E1-E4). */
export const PARAMETROS_PLANTILLA = {
  basico: 1001300, // E1 · hora = básico/200
  presentismo: 180000, // E2
  viatico: 505500, // E3
  noRem: 20000, // E4
  horaExtra: 2500, // AP5 · valor de la hora excedente
}

export function plantillaLiquidacionResumenGuardia(resumen: ResumenGuardiaMes): PlantillaLiquidacion {
  const P = PARAMETROS_PLANTILLA
  const hora = P.basico / 200
  const dia8 = hora * 8
  const celdas: CeldaPlantilla[] = []
  const put = (ref: string, v?: string | number, f?: string) => {
    celdas.push(f !== undefined ? { ref, v, f } : { ref, v })
  }
  const num = (v: number | null): number => v ?? 0

  // Bloque de parámetros y etiquetas (filas 1-5), literal del ejemplo.
  put('A1', 'VisualSueldos - Planilla de importación de datos')
  put('D1', 'hs'); put('E1', P.basico); put('F1', hora, 'E1/200'); put('U1', 'v')
  put('A2', 'Legajo'); put('D2', 'presentismo'); put('E2', P.presentismo); put('F2', dia8, 'E1/200*8')
  put('D3', 'viatico'); put('E3', P.viatico)
  put('D4', 'no rem'); put('E4', P.noRem)
  const fila5: [string, string | number][] = [
    ['U5', 'dia'], ['V5', 'presentismoo'], ['W5', 'viati'], ['X5', 'no remunerativo'],
    ['Y5', 'Gora'], ['Z5', 'pres por dia'], ['AA5', 'viatico por dia'], ['AB5', 'no rem por dia'],
    ['AC5', 'viaticos'], ['AD5', 'presentismo por dia'], ['AE5', 'no rem'],
    ['AJ5', '001'], ['AP5', P.horaExtra], ['AT5', 'feriados'], ['AU5', '888'],
  ]
  for (const [ref, v] of fila5) put(ref, v)

  // Fila 6: encabezados del export de la app (A-P, H sin título: es el tope de
  // 25 días) + códigos de concepto de la capa de liquidación. Los códigos van
  // SIEMPRE como texto de 3 dígitos ('006', '010'), nunca como número: son
  // los códigos de importación al sistema de recibos (pedido de Juan 04/09;
  // el ejemplo los tenía mezclados: algunos número, algunos texto sin cero).
  const fila6: [string, string | number][] = [
    ['A6', 'LEGAJO VISUAL'], ['B6', 'CUIL'], ['C6', 'CUENTA'], ['D6', 'NOMBRE'],
    ['E6', 'NOVEDADES'], ['F6', 'OBJETIVO/S'], ['G6', 'JORNADAS'],
    ['I6', 'HORAS LIQUIDABLES'], ['J6', 'HORAS NOCTURNAS'], ['K6', 'FERIADOS'],
    ['L6', 'LICENCIAS'], ['M6', 'ART'], ['N6', 'VACACIONES'], ['O6', 'PARTE MÉDICO'], ['P6', 'AUS/SUSP'],
    ['AC6', '203'], ['AD6', '204'], ['AE6', '212'], ['AF6', '004'], ['AG6', '001'],
    ['AI6', '212'], ['AJ6', 'hs rec'], ['AL6', 'hs extras'], ['AM6', '% ex'],
    ['AO6', 'total'], ['AR6', 'adelantos'], ['AS6', 'po hs'], ['AT6', '006'],
    ['AV6', '010'], ['AW6', '205'], ['AX6', '008'],
  ]
  for (const [ref, v] of fila6) put(ref, v)

  // Filas de datos: la primera es la 7, como en el ejemplo.
  const filaInicial = 7
  const filaFinal = filaInicial + resumen.filas.length - 1
  const filaSeparadora = filaFinal + 1
  const filaTotales = filaSeparadora + 1
  // Acumuladores de los valores calculados, para cachear también los SUM.
  const suma: Record<string, number> = {}
  const acum = (col: string, v: number) => { suma[col] = (suma[col] ?? 0) + v }

  resumen.filas.forEach((fila, i) => {
    const r = filaInicial + i
    put(`A${r}`, fila.legajoVisual ?? '')
    put(`B${r}`, fila.cuil ?? '')
    put(`C${r}`, '') // CUENTA: sin datos bancarios en el sistema todavía
    put(`D${r}`, fila.nombre)
    put(`E${r}`, fila.notas.join(' · '))
    put(`F${r}`, fila.objetivos.join('/'))
    const G = fila.jornadas
    const H = Math.min(G, 25)
    const I = fila.horasLiquidables
    const J = num(fila.horasNocturnas)
    put(`G${r}`, G)
    put(`H${r}`, H, `MIN(G${r},25)`)
    put(`I${r}`, I)
    // Sin dato (null) → la celda NO se emite: en Excel una celda realmente
    // vacía vale 0 en las fórmulas (L×U, el total, po hs) y se ve en blanco,
    // así que se conserva "vacío = sin dato" sin romper el cálculo. Un ""
    // de texto acá rompía todo con #¡VALOR!.
    const putNum = (ref: string, v: number | null) => { if (v != null) put(ref, v) }
    putNum(`J${r}`, fila.horasNocturnas)
    put(`K${r}`, fila.feriadosTrabajados)
    putNum(`L${r}`, fila.licencias)
    putNum(`M${r}`, fila.art)
    putNum(`N${r}`, fila.vacaciones)
    putNum(`O${r}`, fila.parteMedico)
    putNum(`P${r}`, fila.ausenciasSuspensiones)
    // Parámetros por fila: la primera toma F2/E2/E3/E4 y las demás arrastran
    // la de arriba, igual que en el ejemplo.
    if (r === filaInicial) {
      put(`U${r}`, dia8, 'F2'); put(`V${r}`, P.presentismo, 'E2')
      put(`W${r}`, P.viatico, 'E3'); put(`X${r}`, P.noRem, 'E4')
    } else {
      put(`U${r}`, dia8, `U${r - 1}`); put(`V${r}`, P.presentismo, `V${r - 1}`)
      put(`W${r}`, P.viatico, `W${r - 1}`); put(`X${r}`, P.noRem, `X${r - 1}`)
    }
    put(`Y${r}`, hora, `U${r}/8`)
    put(`Z${r}`, P.presentismo / 25, `V${r}/25`)
    put(`AA${r}`, P.viatico / 25, `W${r}/25`)
    put(`AB${r}`, P.noRem / 25, `X${r}/25`)
    const AC = (P.viatico / 25) * H
    const AD = (P.presentismo / 25) * H
    const AE = (P.noRem / 25) * H
    const AF = (hora / 10) * J
    const AG = I <= 150 ? H * 8 : 150
    const AI = 0 // AH (hs a valor pleno) queda vacío para carga manual
    const AJ = AG * hora
    const AL = I - AG
    const AM = AL > 0 && I > 0 ? (AL * 100) / I : 0
    const AN = G > 0 ? I / G : 0
    const AP = AL > 0 ? AL * P.horaExtra : 0 // menos AR (adelantos), vacío acá
    const AT = fila.feriadosTrabajados * dia8
    const AU = num(fila.licencias) * dia8
    const AV = num(fila.art) * dia8
    const AW = num(fila.vacaciones) * dia8
    const AX = num(fila.parteMedico) * dia8
    const AO = AC + AD + AE + AF + AI + AJ + AT + AU + AV + AW + AX + AP
    const AS = AO > 0 && I > 0 ? AO / I : 0
    put(`AC${r}`, AC, `AA${r}*H${r}`)
    put(`AD${r}`, AD, `Z${r}*H${r}`)
    put(`AE${r}`, AE, `(X${r}/25)*H${r}`)
    put(`AF${r}`, AF, `(Y${r}/10)*J${r}`)
    put(`AG${r}`, AG, `IF(I${r}<=150,H${r}*8,150)`)
    put(`AI${r}`, AI, `AH${r}*Y${r}`)
    put(`AJ${r}`, AJ, `AG${r}*Y${r}`)
    put(`AL${r}`, AL, `I${r}-AG${r}`)
    put(`AM${r}`, AM, `IF(AL${r}>0,(AL${r}*100)/I${r},0)`)
    put(`AN${r}`, AN, `I${r}/G${r}`)
    put(`AO${r}`, AO, `AC${r}+AD${r}+AE${r}+AF${r}+AI${r}+AJ${r}+AT${r}+AU${r}+AV${r}+AW${r}+AX${r}+AP${r}`)
    put(`AP${r}`, AP, `IF(AL${r}>0,AL${r}*${P.horaExtra},0)-AR${r}`)
    put(`AS${r}`, AS, `IF(AO${r}>0,AO${r}/I${r},0)`)
    put(`AT${r}`, AT, `K${r}*U${r}`)
    put(`AU${r}`, AU, `L${r}*U${r}`)
    put(`AV${r}`, AV, `M${r}*U${r}`)
    put(`AW${r}`, AW, `N${r}*U${r}`)
    put(`AX${r}`, AX, `O${r}*U${r}`)
    const cacheFila: [string, number][] = [
      ['G', G], ['I', I], ['J', J], ['K', fila.feriadosTrabajados],
      ['L', num(fila.licencias)], ['M', num(fila.art)], ['N', num(fila.vacaciones)],
      ['O', num(fila.parteMedico)], ['P', num(fila.ausenciasSuspensiones)],
      ['U', dia8], ['V', P.presentismo], ['W', P.viatico], ['X', P.noRem],
      ['Y', hora], ['Z', P.presentismo / 25], ['AA', P.viatico / 25], ['AB', P.noRem / 25],
      ['AC', AC], ['AD', AD], ['AE', AE], ['AF', AF], ['AG', AG], ['AH', 0],
      ['AI', AI], ['AJ', AJ], ['AK', 0], ['AL', AL], ['AM', AM], ['AN', AN],
      ['AO', AO], ['AP', AP], ['AQ', 0], ['AR', 0], ['AS', AS],
      ['AT', AT], ['AU', AU], ['AV', AV], ['AW', AW], ['AX', AX],
    ]
    for (const [col, v] of cacheFila) acum(col, v)
  })

  // Fila TOTALES: SUM hasta la fila separadora inclusive, como el ejemplo
  // (SUM(I7:I72) con datos hasta la 71). H no tiene total; Q-T y AH/AK/AQ/AR
  // suman columnas vacías (dan 0) pero el ejemplo las trae y se conservan.
  put(`A${filaTotales}`, 'TOTALES')
  for (const col of ['B', 'C', 'D', 'E', 'F']) put(`${col}${filaTotales}`, '')
  const colsTotales = ['G', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
    'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH', 'AI',
    'AJ', 'AK', 'AL', 'AM', 'AN', 'AO', 'AP', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AV', 'AW', 'AX']
  for (const col of colsTotales) {
    put(`${col}${filaTotales}`, suma[col] ?? 0, `SUM(${col}${filaInicial}:${col}${filaSeparadora})`)
  }

  return { nombreHoja: 'Hoja1', ref: `A1:AX${filaTotales}`, celdas }
}
