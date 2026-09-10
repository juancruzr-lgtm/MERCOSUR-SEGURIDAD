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
  /** Rol heredado (identidad). Sólo fallback de clasificación si falta puesto. */
  rol?: string | null
  /**
   * PUESTO organizacional: clasificador CANÓNICO del bloque (vigiladores /
   * supervisores / administrativos) y de la regla de mensualizados. Reemplaza a
   * `rol` para que, p.ej., Sergio (rol=admin heredado, puesto=supervisor) caiga
   * en supervisores y no en administrativos.
   */
  puesto_organizacional?: string | null
  /**
   * REGLA DURA (Juan, 07/09): un empleado ACTIVO va SIEMPRE al archivo,
   * aunque no tenga un solo dato en el mes — una fila incompleta se ve, una
   * ausente no se nota hasta que el sueldo no se liquidó. Sin estado se
   * asume activo: ante la duda, mejor una fila de más que una de menos.
   */
  estado?: string | null
  /**
   * Cuenta de prueba (usuarios.es_prueba): no aparece en el resumen ni en el
   * archivo de liquidación, aunque esté activa. Mismo criterio que
   * objetivos.es_prueba.
   */
  esPrueba?: boolean | null
  cuil?: string | null
  legajo?: string | null
  /**
   * Etiqueta de Legajo que usa Visual Sueldos (usuarios.legajo_visual,
   * alfanumérica, ej. "ALMADA", "011 Bis"). No confundir con `legajo`
   * (histórico: contiene CUIL o DNI).
   */
  legajoVisual?: string | null
  /**
   * Cuenta bancaria de acreditación (usuarios.cuenta_bancaria). TEXTO
   * siempre: conserva ceros a la izquierda y admite CBU de 22 dígitos.
   */
  cuenta?: string | null
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

// ── Bloques y mensualizados ───────────────────────────────────────────────────
//
// Supervisores y administrativos son MENSUALIZADOS (sueldo fijo, decisión de
// Juan 07/09/2026). Regla general: NINGUNA columna que la liquidación
// multiplica (JORNADAS, HORAS LIQUIDABLES, nocturnas, feriados, novedades en
// días) puede llevar datos de un mensualizado — el archivo alimenta los
// conceptos por jornada de Visual Sueldos y les pagaría por jornada. Sus
// datos operativos van SOLO en las columnas informativas del final
// (SUPERVISIONES / HORAS SUPERVISION / JORNADAS SUPERVISION) o en la
// observación de la fila.

export type GrupoResumen = 'vigiladores' | 'supervisores' | 'administrativos'

/**
 * Clasificación del bloque por PUESTO (canónico), con fallback por rol viejo
 * cuando el puesto es null (p.ej. cuentas es_prueba). Operación que supervisa
 * (supervisor/jefe/dirección operativa) → supervisores; administración/gerencia
 * → administrativos; vigilador → vigiladores.
 */
export function grupoDeResumen(sujeto?: { rol?: string | null; puesto_organizacional?: string | null } | null): GrupoResumen {
  const p = String(sujeto?.puesto_organizacional ?? '').trim().toLowerCase()
  if (p === 'vigilador') return 'vigiladores'
  // Supervisión operativa de calle: supervisor y jefe de supervisores → BLOQUE 2.
  if (p === 'supervisor' || p === 'jefe_supervisores') return 'supervisores'
  // Jerárquicos/mensualizados → BLOQUE 3. Dirección operativa es jerárquica
  // (Rodolfo): NO va con los supervisores de calle.
  if (p === 'direccion_operativa' || p === 'administracion' || p === 'gerencia') return 'administrativos'
  const r = String(sujeto?.rol ?? '').trim().toLowerCase()
  if (r === 'admin') return 'administrativos'
  if (r === 'supervisor') return 'supervisores'
  return 'vigiladores'
}

/** @deprecated Usar grupoDeResumen (por puesto). Se conserva por compatibilidad. */
export function grupoDeRol(rol?: string | null): GrupoResumen {
  return grupoDeResumen({ rol })
}

/** Guardia de supervisor cargada en el mes (tabla supervisores_guardia). */
export interface SupervisorGuardiaResumen {
  supervisor_id?: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  zona?: string | null
  estado?: string | null
}

/** Supervisión registrada (tabla supervisiones); alcanza con estos campos. */
export interface SupervisionResumen {
  supervisor_id?: string | null
  objetivo_id?: string | null
  estado?: string | null
  created_at: string
}

/**
 * Dedup de supervisiones: dos registros del mismo supervisor sobre el mismo
 * objetivo con ≤10 min de diferencia son UNA supervisión (reintento con la
 * respuesta perdida, foto subida aparte). Es una red de seguridad: el arreglo
 * de raíz es la idempotencia en /api/save-supervision.
 */
export const VENTANA_DEDUP_SUPERVISIONES_MIN = 10

/**
 * Cantidad de supervisiones distintas del supervisor. Las 'incompleta' NO
 * cuentan — decisión de Juan (07/09/2026), no criterio técnico: no revertir
 * sin preguntarle.
 */
export function contarSupervisiones(
  supervisiones: SupervisionResumen[],
  supervisorId: string,
): number {
  const propias = supervisiones
    .filter(s => s.supervisor_id === supervisorId && s.estado !== 'incompleta')
    .sort((a, b) =>
      String(a.objetivo_id ?? '').localeCompare(String(b.objetivo_id ?? '')) ||
      a.created_at.localeCompare(b.created_at),
    )
  let total = 0
  let ultObjetivo: string | null = null
  let ultContada = 0
  for (const s of propias) {
    const objetivo = String(s.objetivo_id ?? '')
    const ts = Date.parse(s.created_at)
    const esDuplicado = objetivo === ultObjetivo &&
      ts - ultContada <= VENTANA_DEDUP_SUPERVISIONES_MIN * 60_000
    if (!esDuplicado) {
      total += 1
      ultObjetivo = objetivo
      ultContada = ts
    }
  }
  return total
}

/** Horas de una guardia de supervisor; fin ≤ inicio = cruza la medianoche. */
export function horasGuardiaSupervisor(g: SupervisorGuardiaResumen): number {
  const ini = minutosDelDia(g.hora_inicio)
  let fin = minutosDelDia(g.hora_fin)
  if (fin <= ini) fin += 1440
  return (fin - ini) / 60
}

/**
 * Horas PROGRAMADAS de un turno = duración de su horario (hora_fin −
 * hora_inicio), sumando 24 h cuando cruza la medianoche (fin ≤ inicio). Es la
 * cobertura planificada del servicio, NO las horas trabajadas/liquidables de
 * una persona: alimenta sólo la métrica HS VIGILANCIA ZONA.
 */
export function horasProgramadasTurno(t: { hora_inicio: string; hora_fin: string }): number {
  const ini = minutosDelDia(t.hora_inicio)
  let fin = minutosDelDia(t.hora_fin)
  if (fin <= ini) fin += 1440
  return (fin - ini) / 60
}

export interface ParamsResumenGuardia {
  /** Mes operativo, formato 'YYYY-MM'. */
  mes: string
  empleados: EmpleadoResumen[]
  /**
   * Grupos organizacionales a incluir. Sin pasar (undefined) = TODOS (los 3
   * bloques) → comportamiento histórico, el que usa el Excel de Liquidación.
   * Resumen Guardia (reporte operativo de vigilancia) pasa ['vigiladores'] para
   * NO mostrar supervisores/jerárquicos/administrativos ni sus datos salariales.
   * Es un filtro de alcance; no cambia el cálculo por empleado.
   */
  gruposIncluidos?: GrupoResumen[]
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
  /**
   * Guardias de supervisor del mes (supervisores_guardia, estado activo).
   * Alimentan SOLO las columnas informativas del bloque de supervisores.
   */
  supervisoresGuardia?: SupervisorGuardiaResumen[]
  /** Supervisiones del mes, para la columna SUPERVISIONES (conteo dedup). */
  supervisiones?: SupervisionResumen[]
  /**
   * zona_id operativa de un objetivo (objetivos.zona_id). Alimenta HS
   * VIGILANCIA ZONA: agrupa las horas programadas de los turnos por zona. Sin
   * callback la columna queda en 0 y nada más cambia.
   */
  zonaObjetivo?: (objetivoId?: string | null) => string | null
  /**
   * Zonas que un empleado tiene A CARGO por asignación operativa (tabla
   * supervisor_zonas), INDEPENDIENTE del rol: un admin que supervisa (caso
   * MARTINEZ) devuelve sus zonas igual. Sin asignación → []. Un Jefe de
   * Supervisores con alcance total NO se resuelve acá con una zona inventada:
   * hasta que exista su representación de "todas las zonas", devuelve [].
   */
  zonasSupervisor?: (empleadoId: string) => string[]
}

// ── Tipos de salida ───────────────────────────────────────────────────────────

/** Conteo de días de novedad. null = sin registro en la app (≠ 0). */
export type DiasNovedad = number | null

export interface FilaResumenGuardia {
  empleadoId: string
  /** Bloque del archivo. Mensualizados: supervisores y administrativos. */
  grupo: GrupoResumen
  nombre: string
  cuil: string | null
  legajo: string | null
  /** Legajo de Visual Sueldos: primera columna del archivo de liquidación. */
  legajoVisual: string | null
  /** Cuenta bancaria (texto, con ceros a la izquierda); null = sin dato. */
  cuenta: string | null
  /** Objetivos con horas reconocidas en el mes, orden alfabético. */
  objetivos: string[]
  /**
   * Fechas de inicio distintas entre los turnos con horas reconocidas.
   * Nocturno que cruza medianoche = 1; turno cortado del mismo día = 1.
   */
  jornadas: number
  /**
   * Jornadas REALES trabajadas (fechas distintas con horas reconocidas), SIN el
   * cero de mensualizados: acá siempre es el conteo real, tenga o no actividad,
   * sea vigilador, supervisor o administrativo. Es la fuente del 000 DÍAS para
   * el personal OPERATIVO (vigiladores + supervisores con actividad). El campo
   * `jornadas` de arriba mantiene el 0 de mensualizados para las columnas de
   * sueldo; este NO.
   */
  jornadasReales: number
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
  /**
   * Columnas informativas del final (AY-BA): SOLO llevan datos en el bloque
   * de supervisores; en vigiladores y administrativos van en 0 (pedido de
   * Juan 07/09). No las multiplica ninguna fórmula de liquidación.
   */
  supervisiones: number
  horasSupervision: number
  jornadasSupervision: number
  /**
   * HS VIGILANCIA ZONA: horas programadas de TODOS los turnos del mes de
   * TODOS los objetivos de las zonas que el empleado tiene a cargo. Es el
   * VOLUMEN operativo bajo supervisión (no las horas personales del
   * supervisor) y se resuelve por asignación de zona, no por rol='supervisor'
   * — un admin que supervisa (MARTINEZ) la lleva igual. Informativa: ninguna
   * fórmula de liquidación la multiplica. 0 = sin zona a cargo.
   */
  hsVigilanciaZona: number
  /**
   * Marcas visibles de la fila (columna de observación): datos de
   * liquidación faltantes ("REVISAR: falta CUIL") y actividad de un
   * mensualizado que NO se liquida por jornada ("cubrió N turnos").
   */
  observaciones: string[]
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

/**
 * RESUMEN GUARDIA (reporte operativo de vigilancia) = SOLAMENTE VIGILADORES.
 * Fuerza `gruposIncluidos: ['vigiladores']` para que NO aparezcan supervisores,
 * jerárquicos (Rodolfo/dirección operativa) ni administrativos, ni sus datos
 * salariales. Comparte el motor con Liquidación pero no su alcance: el Excel de
 * Liquidación sigue llamando a `construirResumenGuardia` con los 3 bloques.
 */
export function construirResumenGuardiaVigiladores(
  params: Omit<ParamsResumenGuardia, 'gruposIncluidos'>,
): ResumenGuardiaMes {
  return construirResumenGuardia({ ...params, gruposIncluidos: ['vigiladores'] })
}

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

  // HS VIGILANCIA ZONA — horas programadas por zona operativa, sobre el MISMO
  // universo de turnos válidos (sin objetivos de prueba ni estados sin
  // obligación). Se calcula una sola vez; cada supervisor toma las zonas que
  // tiene a cargo. Suma la cobertura de TODOS los turnos de la zona, sin mirar
  // quién los fichó: es el volumen a supervisar, no horas de una persona.
  const horasPorZona = new Map<string, number>()
  if (params.zonaObjetivo) {
    for (const t of turnosValidos) {
      const zona = params.zonaObjetivo(t.objetivo_id)
      if (!zona) continue
      horasPorZona.set(zona, (horasPorZona.get(zona) ?? 0) + horasProgramadasTurno(t))
    }
  }

  // Turnos que tienen algún registro (de cualquier guardia): un turno cubierto
  // por reemplazo no debe caer también como fallback de transición del titular.
  const turnosConRegistro = new Set(registros.map(r => r.turno_id))

  const filas: FilaResumenGuardia[] = []

  for (const emp of empleados) {
    // Cuenta de prueba: nunca entra al archivo, aunque esté activa. Mismo
    // criterio que los objetivos es_prueba (Juan la usa para testear).
    if (emp.esPrueba) continue
    // Filtro de alcance por grupo (desacople): Resumen Guardia pide sólo
    // vigiladores; Liquidación no pasa nada e incluye los 3 bloques.
    if (params.gruposIncluidos && !params.gruposIncluidos.includes(grupoDeResumen(emp))) continue

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

    const grupo = grupoDeResumen(emp)
    const mensualizado = grupo !== 'vigiladores'
    const activo = String(emp.estado ?? 'activo').trim().toLowerCase() !== 'inactivo'

    // ── Columnas informativas de supervisión ──────────────────────────────
    // Cargas propias del mes; sin cargas va igual con 0 — lo importante es
    // que aparezca. Se computan para TODO mensualizado (supervisores y
    // administrativos): hay admins que supervisan sin resignar su rol —
    // cambiarles el rol les quitaría el acceso al sistema (caso MARTINEZ,
    // Juan 07/09). Vigiladores: 0 siempre.
    const cargas = mensualizado
      ? (params.supervisoresGuardia ?? []).filter(
          g => g.supervisor_id === emp.id && String(g.estado ?? 'activo') === 'activo',
        )
      : []
    const horasSupervision = Math.round(cargas.reduce((s, g) => s + horasGuardiaSupervisor(g), 0) * 100) / 100
    const jornadasSupervision = new Set(cargas.map(g => g.fecha)).size
    const supervisionesMes = mensualizado
      ? contarSupervisiones(params.supervisiones ?? [], emp.id)
      : 0
    const zonas = Array.from(new Set(cargas.map(g => (g.zona ?? '').trim()).filter(Boolean))).sort()

    // HS VIGILANCIA ZONA: suma de las horas programadas de las zonas a cargo
    // (supervisor_zonas), por asignación operativa y no por rol — incluye al
    // admin que supervisa (MARTINEZ). Sólo para mensualizados, igual criterio
    // que el resto de las informativas: un vigilador no supervisa zonas y, si
    // por un error de datos tuviera asignación, no se le computa. Un empleado
    // sin zona a cargo (incluido el Jefe de Supervisores mientras su alcance
    // total no tenga representación) queda en 0: no se le inventa una zona.
    const zonasACargo = mensualizado ? (params.zonasSupervisor?.(emp.id) ?? []) : []
    const hsVigilanciaZona = Math.round(
      zonasACargo.reduce((s, z) => s + (horasPorZona.get(z) ?? 0), 0) * 100,
    ) / 100

    // REGLA DURA (Juan, 07/09): ningún ACTIVO puede faltar en el archivo.
    // El "sin nada que decir → sin fila" queda solo para inactivos.
    if (!activo && reconocidas.length === 0 && lineas.length === 0 && novedadesEmp.length === 0) continue

    // ── Regla de MENSUALIZADOS ────────────────────────────────────────────
    // Supervisores y administrativos cobran sueldo fijo: cero en TODAS las
    // columnas que la liquidación multiplica, AUNQUE tengan turnos fichados.
    // La actividad no se pierde: queda en la observación de la fila.
    const observaciones: string[] = []
    if (mensualizado && lineas.length > 0) {
      observaciones.push(
        `cubrió ${lineas.length} turno${lineas.length === 1 ? '' : 's'} (${Math.round(horasLiquidables * 100) / 100} hs) — mensualizado: no liquida por jornada`,
      )
    }
    const faltantes = [
      !emp.cuil?.trim() ? 'CUIL' : null,
      !emp.legajoVisual?.trim() ? 'legajo Visual' : null,
      !emp.cuenta?.trim() ? 'cuenta' : null,
    ].filter((x): x is string => x != null)
    if (faltantes.length > 0) observaciones.push(`REVISAR: falta ${faltantes.join(', ')}`)

    filas.push({
      empleadoId: emp.id,
      grupo,
      nombre: `${emp.apellido ?? ''}, ${emp.nombre ?? ''}`.replace(/^, |, $/g, '').trim(),
      cuil: emp.cuil ?? null,
      legajo: emp.legajo ?? null,
      legajoVisual: emp.legajoVisual ?? null,
      cuenta: emp.cuenta ?? null,
      // Mensualizados: la columna Objetivo/s informa sus zonas de recorrida.
      objetivos: mensualizado ? zonas : objetivos,
      jornadas: mensualizado ? 0 : jornadas.size,
      // Real siempre (para el 000 de operativos); no se pisa con 0 en mensualizados.
      jornadasReales: jornadas.size,
      fechasConActividad: mensualizado ? 0 : fechas.size,
      horasReales: mensualizado ? 0 : Math.round(horasReales * 100) / 100,
      horasLiquidables: mensualizado ? 0 : Math.round(horasLiquidables * 100) / 100,
      feriadosTrabajados: mensualizado ? 0 : feriados.feriadosCubiertos,
      horasEnFeriado: mensualizado ? 0 : feriados.horas,
      horasNocturnas: mensualizado ? null : horasNocturnas,
      horasNocturnasCalculadas: mensualizado ? null : horasNocturnasCalculadas,
      nocturnidadOrigen: mensualizado ? null : nocturnidadOrigen,
      licencias: mensualizado ? null : contarColumna(novedadesEmp, TIPOS_POR_COLUMNA.licencias, mes),
      art: mensualizado ? null : contarColumna(novedadesEmp, TIPOS_POR_COLUMNA.art, mes),
      vacaciones: mensualizado ? null : contarColumna(novedadesEmp, TIPOS_POR_COLUMNA.vacaciones, mes),
      parteMedico: mensualizado ? null : contarColumna(novedadesEmp, TIPOS_POR_COLUMNA.parteMedico, mes),
      ausenciasSuspensiones: mensualizado ? null : contarColumna(novedadesEmp, TIPOS_POR_COLUMNA.ausenciasSuspensiones, mes),
      // El ajuste de nocturnidad no es una novedad de día: no va al texto
      // libre (ya está expresado en la columna HORAS NOCTURNAS).
      notas: novedadesEmp.filter(n => n.tipo !== TIPO_AJUSTE_NOCTURNIDAD).map(n => notaDeNovedad(n, mes)),
      supervisiones: supervisionesMes,
      horasSupervision,
      jornadasSupervision,
      hsVigilanciaZona,
      observaciones,
      origen: {
        turnoIds: lineas.map(l => l.turno.id),
        registroIds: lineas.map(l => l.registro?.id ?? null).filter((x): x is string => x != null),
        novedadIds: novedadesEmp.map(n => n.id ?? null).filter((x): x is string => x != null),
      },
    })
  }

  // Vigiladores primero, después supervisores, al final administrativos
  // (pedido de Juan 07/09); adentro de cada bloque, apellido con la ñ y las
  // tildes bien ubicadas.
  const ORDEN_GRUPO: Record<GrupoResumen, number> = { vigiladores: 0, supervisores: 1, administrativos: 2 }
  filas.sort((a, b) =>
    ORDEN_GRUPO[a.grupo] - ORDEN_GRUPO[b.grupo] || a.nombre.localeCompare(b.nombre, 'es'),
  )

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
      f.cuenta ?? '',
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

/** Formato numérico de una columna (lo aplica el escritor exceljs). */
export type FmtColumna = 'money' | 'hours' | 'int' | 'pct' | 'text'

export interface ColumnaPlantilla {
  col: string
  width: number
  hidden?: boolean
  numFmt?: FmtColumna
}

/**
 * Metadatos de estilo para el escritor (lib/liquidacion-xlsx): qué filas son
 * parámetros, etiquetas, encabezado, títulos de bloque, subtotales y total, y
 * qué filas llevan datos de empleados. El escritor los usa para bordes,
 * negritas y rellenos sin re-derivar la geometría.
 */
export interface EstilosPlantilla {
  parametros: number[]
  etiquetas: number
  encabezado: number
  titulos: number[]
  subtotales: number[]
  total: number
  filasDatos: number[]
  /**
   * Fila del SUBTOTAL de VIGILADORES (BLOQUE 1). El indicador REC vs Extras
   * se construye SÓLO con vigiladores (horas de vigilancia), no con el total
   * general (que mezcla las horas artificiales de los mensualizados). Opcional
   * para no romper fixtures mínimos; el escritor cae a `total` si falta.
   */
  subtotalVigiladores?: number
}

export interface PlantillaLiquidacion {
  nombreHoja: string
  /** Rango usado de la hoja, p. ej. 'A1:BE73'. */
  ref: string
  celdas: CeldaPlantilla[]
  /** Ancho / oculto / formato por columna. */
  columnas: ColumnaPlantilla[]
  /** Filas por categoría, para el escritor. */
  estilos: EstilosPlantilla
  /** Columnas donde empieza una sección visual (borde vertical izquierdo). */
  secciones: string[]
}

/**
 * Parámetros salariales de la plantilla; Juan los edita en Excel (todo
 * recalcula desde E1-E4). Valores vigentes de la versión corregida del
 * ejemplo (04/09/2026).
 */
export const PARAMETROS_PLANTILLA = {
  basico: 1020300, // E1 · hora = básico/200
  presentismo: 180000, // E2
  viatico: 514500, // E3
  noRem: 30000, // E4
  horaExtra: 2500, // AP6 · valor de la hora excedente
}

// Especificación de columnas: ancho, formato y visibilidad. Las columnas de
// parámetros por fila del ejemplo viejo (U-AB) desaparecen: ahora las fórmulas
// leen los parámetros de arriba con referencias absolutas ($E$2…), así no se
// repiten valores por fila (pedido de Juan 12/13). Q-AB quedan ocultas (hueco
// heredado). BD/BE son técnicas ocultas: identidad para el futuro reimport.
const COLUMNAS_PLANTILLA: ColumnaPlantilla[] = [
  { col: 'A', width: 12, numFmt: 'text' }, { col: 'B', width: 14, numFmt: 'text' },
  { col: 'C', width: 18, numFmt: 'text' }, { col: 'D', width: 26, numFmt: 'text' },
  { col: 'E', width: 24, numFmt: 'text' }, { col: 'F', width: 20, numFmt: 'text' },
  { col: 'G', width: 9, numFmt: 'int' }, { col: 'H', width: 7, numFmt: 'int' },
  { col: 'I', width: 12, numFmt: 'hours' }, { col: 'J', width: 12, numFmt: 'hours' },
  { col: 'K', width: 9, numFmt: 'int' }, { col: 'L', width: 9, numFmt: 'int' },
  { col: 'M', width: 7, numFmt: 'int' }, { col: 'N', width: 10, numFmt: 'int' },
  { col: 'O', width: 11, numFmt: 'int' }, { col: 'P', width: 9, numFmt: 'int' },
  { col: 'Q', width: 3, hidden: true }, { col: 'R', width: 3, hidden: true },
  { col: 'S', width: 3, hidden: true }, { col: 'T', width: 3, hidden: true },
  { col: 'U', width: 3, hidden: true }, { col: 'V', width: 3, hidden: true },
  { col: 'W', width: 3, hidden: true }, { col: 'X', width: 3, hidden: true },
  { col: 'Y', width: 3, hidden: true }, { col: 'Z', width: 3, hidden: true },
  { col: 'AA', width: 3, hidden: true }, { col: 'AB', width: 3, hidden: true },
  { col: 'AC', width: 12, numFmt: 'money' }, { col: 'AD', width: 12, numFmt: 'money' },
  { col: 'AE', width: 12, numFmt: 'money' }, { col: 'AF', width: 12, numFmt: 'money' },
  { col: 'AG', width: 9, numFmt: 'hours' }, { col: 'AH', width: 9, numFmt: 'hours' },
  { col: 'AI', width: 12, numFmt: 'money' }, { col: 'AJ', width: 13, numFmt: 'money' },
  { col: 'AK', width: 3, hidden: true },
  { col: 'AL', width: 9, numFmt: 'hours' }, { col: 'AM', width: 8, numFmt: 'pct' },
  { col: 'AN', width: 8, numFmt: 'hours' }, { col: 'AO', width: 14, numFmt: 'money' },
  { col: 'AP', width: 12, numFmt: 'money' }, { col: 'AQ', width: 3, hidden: true },
  { col: 'AR', width: 12, numFmt: 'money' }, { col: 'AS', width: 10, numFmt: 'money' },
  { col: 'AT', width: 12, numFmt: 'money' }, { col: 'AU', width: 12, numFmt: 'money' },
  { col: 'AV', width: 12, numFmt: 'money' }, { col: 'AW', width: 12, numFmt: 'money' },
  { col: 'AX', width: 12, numFmt: 'money' },
  { col: 'AY', width: 12, numFmt: 'int' }, { col: 'AZ', width: 16, numFmt: 'hours' },
  { col: 'BA', width: 18, numFmt: 'int' }, { col: 'BB', width: 30, numFmt: 'text' },
  { col: 'BC', width: 16, numFmt: 'hours' },
  // Técnicas ocultas: identidad estable para el ida y vuelta (Juan 15/16).
  { col: 'BD', width: 3, hidden: true, numFmt: 'text' },
  { col: 'BE', width: 3, hidden: true, numFmt: 'text' },
  // SUELDO MENSUAL (grupo A · mensualizados fijos): importe base individual,
  // editable; en vigiladores/supervisores va vacío. Se reimporta con vigencia.
  { col: 'BF', width: 16, numFmt: 'money' },
]

// Columnas donde empieza una sección visual (borde vertical izquierdo):
// identidad | operativo | novedades | cálculos salariales | conceptos | supervisión.
const SECCIONES_PLANTILLA = ['A', 'G', 'L', 'AC', 'AT', 'AY']

export function plantillaLiquidacionResumenGuardia(
  resumen: ResumenGuardiaMes,
  /**
   * Ajustes de liquidación por empleado (LIQ2C): { empleadoId → { clave → valor } }
   * sobre las columnas de entrada (jornadas, horas_liquidables, horas_nocturnas,
   * feriados, licencias, art, vacaciones, parte_medico, aus_susp, adicional_hs).
   * Sin este argumento el archivo es idéntico al de #170.
   */
  ajustesPorEmpleado?: Map<string, Record<string, number | null>>,
  /**
   * SUELDO MENSUAL individual por empleado (grupo A · mensualizados fijos):
   * { empleadoId → importe }. Si está seteado, es el ÚNICO haber base del grupo A
   * (concepto 001), y NO se le suman 203/204/212 de la convención de 25 días.
   * Si un grupo A no tiene valor, cae al básico general (fallback). Sin este
   * argumento, el comportamiento es idéntico al anterior.
   */
  sueldoMensualPorEmpleado?: Map<string, number>,
): PlantillaLiquidacion {
  const P = PARAMETROS_PLANTILLA
  const hora = P.basico / 200
  const dia8 = hora * 8
  const celdas: CeldaPlantilla[] = []
  const put = (ref: string, v?: string | number, f?: string) => {
    celdas.push(f !== undefined ? { ref, v, f } : { ref, v })
  }
  const num = (v: number | null): number => v ?? 0

  // ── Bloque de PARÁMETROS (filas 1-4): una sola vez arriba ────────────────
  // Juan edita E1-E4; F1 (hora) y F2 (día de 8 h) se derivan. TODAS las
  // fórmulas por fila referencian estos con $ absoluto para poder arrastrarse
  // sin reescribir (pedido de Juan 13): $E$2/$E$3/$E$4, $F$1, $F$2, $AP$6.
  put('A1', 'VisualSueldos - Planilla de importación de datos')
  put('D1', 'Básico'); put('E1', P.basico); put('F1', hora, 'E1/200'); put('G1', 'hora = básico/200')
  put('D2', 'Presentismo'); put('E2', P.presentismo); put('F2', dia8, 'E1/200*8'); put('G2', 'día = hora*8')
  put('D3', 'Viático'); put('E3', P.viatico)
  put('D4', 'No rem.'); put('E4', P.noRem)

  // Fila 5: etiquetas humanas de la capa de cálculo. Ya no hay U-AB (params por
  // fila): las etiquetas repetidas de esos parámetros desaparecen.
  const fila5: [string, string | number][] = [
    ['AC5', 'viáticos'], ['AD5', 'presentismo'], ['AE5', 'no rem'],
    ['AF5', 'nocturnidad'], ['AG5', 'horas rec'], ['AH5', 'adic. (hs)'], ['AI5', 'adicional'],
    ['AJ5', 'horas rec $'], ['AP5', 'extras'],
    ['AT5', 'feriados'], ['AU5', 'licencia'], ['AV5', 'art'], ['AW5', 'vacaciones'], ['AX5', 'parte med'],
  ]
  for (const [ref, v] of fila5) put(ref, v)

  // Fila 6: encabezados del export (A-P) + códigos de concepto de la capa de
  // liquidación. Los códigos van SIEMPRE como texto de 3 dígitos ('006') — son
  // los códigos de importación de recibos y NO cambian (semántica de Visual).
  const fila6: [string, string | number][] = [
    ['A6', 'LEGAJO VISUAL'], ['B6', 'CUIL'], ['C6', 'CUENTA'], ['D6', 'NOMBRE'],
    ['E6', 'NOVEDADES'], ['F6', 'OBJETIVO/S'], ['G6', 'JORNADAS'],
    ['I6', 'HORAS LIQUIDABLES'], ['J6', 'HORAS NOCTURNAS'], ['K6', 'FERIADOS'],
    ['L6', 'LICENCIAS'], ['M6', 'ART'], ['N6', 'VACACIONES'], ['O6', 'PARTE MÉDICO'], ['P6', 'AUS/SUSP'],
    ['AC6', '203'], ['AD6', '204'], ['AE6', '212'], ['AF6', '004'], ['AG6', '001'],
    ['AI6', '212'], ['AJ6', '001'], ['AL6', 'hs extras'], ['AM6', '% ex'], ['AN6', 'hs dia'],
    ['AO6', 'total'], ['AP6', P.horaExtra], ['AR6', 'adelantos'], ['AS6', 'po hs'],
    ['AT6', '006'], ['AU6', '888'], ['AV6', '010'], ['AW6', '205'], ['AX6', '008'],
    // Informativas al FINAL: no se insertan entre A y AX (no corren fórmulas
    // ni códigos). Ninguna fórmula de liquidación las multiplica.
    ['AY6', 'SUPERVISIONES'], ['AZ6', 'HORAS SUPERVISION'], ['BA6', 'JORNADAS SUPERVISION'],
    ['BB6', 'OBSERVACION'], ['BC6', 'HS VIGILANCIA ZONA'],
    // Técnicas ocultas: identidad para el reimport (no depender de nombre ni fila).
    ['BD6', 'usuario_id'], ['BE6', 'periodo'],
    // SUELDO MENSUAL editable (grupo A). Se reimporta con vigencia.
    ['BF6', 'SUELDO MENSUAL'],
  ]
  for (const [ref, v] of fila6) put(ref, v)

  const grupos: { clave: GrupoResumen; titulo: string; subtotal: string }[] = [
    { clave: 'vigiladores', titulo: 'BLOQUE 1 - VIGILADORES', subtotal: 'SUBTOTAL VIGILADORES' },
    { clave: 'supervisores', titulo: 'BLOQUE 2 - SUPERVISORES', subtotal: 'SUBTOTAL SUPERVISORES' },
    { clave: 'administrativos', titulo: 'BLOQUE 3 - ADMINISTRATIVOS', subtotal: 'SUBTOTAL ADMINISTRATIVOS' },
  ]

  const emitirFila = (fila: FilaResumenGuardia, r: number, acum: (col: string, v: number) => void) => {
    put(`A${r}`, fila.legajoVisual ?? '')
    put(`B${r}`, fila.cuil ?? '') // CUIL visible: parte de la identidad
    put(`C${r}`, fila.cuenta ?? '') // texto: conserva ceros a la izquierda
    put(`D${r}`, fila.nombre)
    put(`E${r}`, fila.notas.join(' · '))
    put(`F${r}`, fila.objetivos.join('/'))
    // Ajustes de liquidación (LIQ2C): overrides por empleado sobre las columnas
    // de ENTRADA. Sin ajuste → valor base idéntico al de siempre (el archivo de
    // #170 no cambia). Con ajuste → recalculan los conceptos derivados, porque
    // Visual necesita el valor de liquidación, no el operativo.
    const ov = ajustesPorEmpleado?.get(fila.empleadoId) ?? {}
    const ovNum = (clave: string, base: number): number => {
      const o = ov[clave]; return (o === undefined || o === null) ? base : o
    }
    const ovNullable = (clave: string, base: number | null): number | null => {
      const o = ov[clave]; return (o === undefined) ? base : o
    }
    // Base de liquidación de MENSUALIZADOS (Juan, 07/09): valores convencionales
    // para que operen las fórmulas — NO son horas trabajadas. Sólo en esta capa.
    const mensualizado = fila.grupo !== 'vigiladores'
    const G = ovNum('jornadas', mensualizado ? 25 : fila.jornadas)
    const H = Math.min(G, 25)
    const I = ovNum('horas_liquidables', mensualizado ? 150 : fila.horasLiquidables)
    const Jval = ovNullable('horas_nocturnas', fila.horasNocturnas)
    const J = num(Jval)
    const Kv = ovNum('feriados', fila.feriadosTrabajados)
    const Lval = ovNullable('licencias', fila.licencias)
    const Mval = ovNullable('art', fila.art)
    const Nval = ovNullable('vacaciones', fila.vacaciones)
    const Oval = ovNullable('parte_medico', fila.parteMedico)
    const Pval = ovNullable('aus_susp', fila.ausenciasSuspensiones)
    put(`G${r}`, G)
    put(`H${r}`, H, `MIN(G${r},25)`)
    put(`I${r}`, I)
    // null → celda sin emitir (vacía real = 0 en fórmulas, sin #¡VALOR!).
    const putNum = (ref: string, v: number | null) => { if (v != null) put(ref, v) }
    putNum(`J${r}`, Jval)
    put(`K${r}`, Kv)
    putNum(`L${r}`, Lval)
    putNum(`M${r}`, Mval)
    putNum(`N${r}`, Nval)
    putNum(`O${r}`, Oval)
    putNum(`P${r}`, Pval)
    const AC = (P.viatico / 25) * H
    const AD = (P.presentismo / 25) * H
    const AE = (P.noRem / 25) * H
    const AF = (hora / 10) * J
    const AG = I <= 150 ? H * 8 : 150
    // ADICIONAL: AH = "hs a valor pleno" (concepto 212), input que alimenta la
    // columna 'adicional' AI = AH*hora. Base mensualizada = 50; vigilador vacío.
    const AH = ovNum('adicional_hs', mensualizado ? 50 : 0)
    const AI = AH * hora
    const AJ = AG * hora
    // AL (hs extras) nunca negativo: MAX(0, I-AG). No cambia el pago (AM/AP ya
    // usan IF(AL>0,…)); evita el −50 conceptualmente incorrecto de mensualizados.
    const AL = Math.max(0, I - AG)
    const AM = AL > 0 && I > 0 ? (AL * 100) / I : 0
    const AN = G > 0 ? I / G : 0
    const AP = AL > 0 ? AL * P.horaExtra : 0 // menos AR (adelantos), manual
    const AT = Kv * dia8
    const AU = num(Lval) * dia8
    const AV = num(Mval) * dia8
    const AW = num(Nval) * dia8
    const AX = num(Oval) * dia8
    const AO = AC + AD + AE + AF + AI + AJ + AT + AU + AV + AW + AX + AP
    const AS = AO > 0 && I > 0 ? AO / I : 0
    // GRUPO A · mensualizado FIJO (administrativos: dir. operativa / administración
    // / gerencia, con o sin usuario). Cobra SÓLO el SUELDO MENSUAL en el concepto
    // 001; NO se le suman 203/204/212 de la convención de 25 días. Si aún no tiene
    // SUELDO MENSUAL cargado, cae al básico general (fallback). Supervisores (B) y
    // vigiladores (C) NO se tocan: siguen exactamente como antes.
    const esGrupoA = fila.grupo === 'administrativos'
    const sueldoMensual = esGrupoA ? (sueldoMensualPorEmpleado?.get(fila.empleadoId) ?? P.basico) : null
    const gAC = esGrupoA ? 0 : AC
    const gAD = esGrupoA ? 0 : AD
    const gAE = esGrupoA ? 0 : AE
    const gAF = esGrupoA ? 0 : AF
    const gAG = esGrupoA ? 0 : AG
    const gAH = esGrupoA ? 0 : AH
    const gAI = esGrupoA ? 0 : AI
    const gAJ = esGrupoA ? (sueldoMensual as number) : AJ
    const gAL = esGrupoA ? 0 : AL
    const gAM = esGrupoA ? 0 : AM
    const gAN = esGrupoA ? 0 : AN
    const gAP = esGrupoA ? 0 : AP
    const gAO = gAC + gAD + gAE + gAF + gAI + gAJ + AT + AU + AV + AW + AX + gAP
    const gAS = gAO > 0 && I > 0 ? gAO / I : 0
    // Fórmulas ARRASTRABLES (Juan 13): parámetros con $ absoluto, referencias
    // de la fila del empleado relativas (H8→H9 al arrastrar). Grupo A: 001 = SUELDO
    // MENSUAL (columna BF, editable); el resto de la convención va en 0 (literal).
    put(`AC${r}`, gAC, esGrupoA ? undefined : `($E$3/25)*H${r}`)
    put(`AD${r}`, gAD, esGrupoA ? undefined : `($E$2/25)*H${r}`)
    put(`AE${r}`, gAE, esGrupoA ? undefined : `($E$4/25)*H${r}`)
    put(`AF${r}`, gAF, esGrupoA ? undefined : `($F$1/10)*J${r}`)
    put(`AG${r}`, gAG, esGrupoA ? undefined : `IF(I${r}<=150,H${r}*8,150)`)
    // Mensualizado (B): AH=50 (adicional base). Vigilador/Grupo A: NO se emite.
    if (gAH !== 0) put(`AH${r}`, gAH)
    put(`AI${r}`, gAI, esGrupoA ? undefined : `AH${r}*$F$1`)
    put(`AJ${r}`, gAJ, esGrupoA ? `BF${r}` : `AG${r}*$F$1`)
    put(`AL${r}`, gAL, esGrupoA ? undefined : `MAX(0,I${r}-AG${r})`)
    put(`AM${r}`, gAM, esGrupoA ? undefined : `IF(AL${r}>0,(AL${r}*100)/I${r},0)`)
    put(`AN${r}`, gAN, esGrupoA ? undefined : `I${r}/G${r}`)
    put(`AO${r}`, gAO, `AC${r}+AD${r}+AE${r}+AF${r}+AI${r}+AJ${r}+AT${r}+AU${r}+AV${r}+AW${r}+AX${r}+AP${r}`)
    put(`AP${r}`, gAP, esGrupoA ? undefined : `IF(AL${r}>0,AL${r}*$AP$6,0)-AR${r}`)
    put(`AS${r}`, gAS, esGrupoA ? undefined : `IF(AO${r}>0,AO${r}/I${r},0)`)
    put(`AT${r}`, AT, `K${r}*$F$2`)
    put(`AU${r}`, AU, `L${r}*$F$2`)
    put(`AV${r}`, AV, `M${r}*$F$2`)
    put(`AW${r}`, AW, `N${r}*$F$2`)
    put(`AX${r}`, AX, `O${r}*$F$2`)
    // SUELDO MENSUAL editable: sólo grupo A lleva la celda.
    if (esGrupoA) put(`BF${r}`, sueldoMensual as number)
    // Informativas del final: valores puros.
    put(`AY${r}`, fila.supervisiones)
    put(`AZ${r}`, fila.horasSupervision)
    put(`BA${r}`, fila.jornadasSupervision)
    if (fila.observaciones.length > 0) put(`BB${r}`, fila.observaciones.join(' · '))
    // HS VIGILANCIA ZONA: por fila, informativa; NO se totaliza (zona compartida).
    put(`BC${r}`, fila.hsVigilanciaZona)
    // Identidad técnica oculta (Juan 16): usuario_id interno + período. MERCOSUR
    // reconoce la fila por esto (más CUIL en B), nunca por nombre ni nº de fila.
    put(`BD${r}`, fila.empleadoId)
    put(`BE${r}`, resumen.mes)
    const cacheFila: [string, number][] = [
      ['G', G], ['I', I], ['J', J], ['K', Kv],
      ['L', num(Lval)], ['M', num(Mval)], ['N', num(Nval)],
      ['O', num(Oval)], ['P', num(Pval)],
      // Grupo A ya viene con los conceptos de convención en 0 y 001 = SUELDO MENSUAL.
      ['AC', gAC], ['AD', gAD], ['AE', gAE], ['AF', gAF], ['AG', gAG], ['AH', gAH],
      ['AI', gAI], ['AJ', gAJ], ['AL', gAL], ['AO', gAO], ['AP', gAP],
      ['AT', AT], ['AU', AU], ['AV', AV], ['AW', AW], ['AX', AX],
      ['AY', fila.supervisiones], ['AZ', fila.horasSupervision], ['BA', fila.jornadasSupervision],
    ]
    for (const [col, v] of cacheFila) acum(col, v)
  }

  // Sólo se totalizan cantidades e importes; NO los ratios (AM %, AN hs/día,
  // AS $/hora) ni HS VIGILANCIA ZONA (BC). H no tiene total (es un tope).
  const colsTotales = ['G', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P',
    'AC', 'AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AL', 'AO', 'AP',
    'AT', 'AU', 'AV', 'AW', 'AX', 'AY', 'AZ', 'BA']

  let r = 7
  const titulos: number[] = []
  const subtotalesFilas: number[] = []
  const filasDatos: number[] = []
  let subtotalVigiladores = 0  // fila del SUBTOTAL VIGILADORES (para REC/Extras)
  const subtotales: { fila: number; suma: Record<string, number> }[] = []
  for (const gp of grupos) {
    const filasGrupo = resumen.filas.filter(f => f.grupo === gp.clave)
    put(`A${r}`, gp.titulo)
    titulos.push(r)
    r += 1
    const primeraDato = r
    const suma: Record<string, number> = {}
    const acum = (col: string, v: number) => { suma[col] = (suma[col] ?? 0) + v }
    for (const fila of filasGrupo) {
      emitirFila(fila, r, acum)
      filasDatos.push(r)
      r += 1
    }
    const ultimaDato = r - 1
    const filaSubtotal = r
    put(`A${filaSubtotal}`, gp.subtotal)
    for (const col of colsTotales) {
      if (filasGrupo.length > 0) {
        put(`${col}${filaSubtotal}`, suma[col] ?? 0, `SUM(${col}${primeraDato}:${col}${ultimaDato})`)
      } else {
        put(`${col}${filaSubtotal}`, 0)
      }
    }
    subtotalesFilas.push(filaSubtotal)
    subtotales.push({ fila: filaSubtotal, suma })
    if (gp.clave === 'vigiladores') subtotalVigiladores = filaSubtotal
    r += 2 // subtotal + fila separadora vacía
  }

  // TOTAL GENERAL = suma de los tres subtotales (nunca SUM del rango entero).
  const filaTotales = r
  put(`A${filaTotales}`, 'TOTAL GENERAL')
  for (const col of colsTotales) {
    const v = subtotales.reduce((s, b) => s + (b.suma[col] ?? 0), 0)
    put(`${col}${filaTotales}`, v, subtotales.map(b => `${col}${b.fila}`).join('+'))
  }

  return {
    nombreHoja: 'Liquidación',
    ref: `A1:BE${filaTotales}`,
    celdas,
    columnas: COLUMNAS_PLANTILLA,
    secciones: SECCIONES_PLANTILLA,
    estilos: {
      parametros: [1, 2, 3, 4],
      etiquetas: 5,
      encabezado: 6,
      titulos,
      subtotales: subtotalesFilas,
      total: filaTotales,
      filasDatos,
      subtotalVigiladores,
    },
  }
}
