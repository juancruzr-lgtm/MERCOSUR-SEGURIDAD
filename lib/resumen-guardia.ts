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
}

export interface TurnoResumen extends TurnoUniverso {
  guardia_id?: string | null
}

export interface NovedadResumen extends NovedadLaboral {
  id?: string | null
}

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
}

// ── Tipos de salida ───────────────────────────────────────────────────────────

/** Conteo de días de novedad. null = sin registro en la app (≠ 0). */
export type DiasNovedad = number | null

export interface FilaResumenGuardia {
  empleadoId: string
  nombre: string
  cuil: string | null
  legajo: string | null
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
   * Horas nocturnas: la regla de a quién corresponde es contractual por
   * cliente/servicio y todavía no está configurada en el sistema.
   * Siempre null en esta versión — el campo existe para que el formato del
   * resumen ya la contemple. No confundir con 0.
   */
  horasNocturnas: null
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

function contarColumna(
  novedades: NovedadResumen[],
  tipos: TipoNovedad[],
  mes: string,
): DiasNovedad {
  const propias = novedades.filter(n => tipos.includes(n.tipo as TipoNovedad))
  if (propias.length === 0) return null
  return propias.reduce((s, n) => s + diasDeNovedadEnMes(n, mes), 0)
}

function notaDeNovedad(n: NovedadResumen, mes: string): string {
  const etiqueta = ETIQUETA_TIPO[n.tipo] ?? n.tipo
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

    const feriados = resumirFeriados(lineas.map(l => ({
      fecha: l.turno.fecha,
      cuenta: turnoCuentaEnFeriado(l.turno, l.horasLiquidables, ESTADOS_SIN_OBLIGACION),
      horas: l.horasLiquidables,
    })))

    const objetivos = Array.from(new Set(
      reconocidas.map(l => nombreObjetivo(l.registro?.objetivo_final_id ?? l.turno.objetivo_id)).filter(Boolean),
    )).sort()

    const novedadesEmp = aprobadas.filter(n => n.empleado_id === emp.id)

    // Fila sólo si hay algo que decir: actividad reconocida o novedades. Un
    // empleado sin nada en el mes no aparece — igual que en la hoja manual.
    if (reconocidas.length === 0 && lineas.length === 0 && novedadesEmp.length === 0) continue

    filas.push({
      empleadoId: emp.id,
      nombre: `${emp.apellido ?? ''}, ${emp.nombre ?? ''}`.replace(/^, |, $/g, '').trim(),
      cuil: emp.cuil ?? null,
      legajo: emp.legajo ?? null,
      objetivos,
      jornadas: jornadas.size,
      fechasConActividad: fechas.size,
      horasReales: Math.round(horasReales * 100) / 100,
      horasLiquidables: Math.round(horasLiquidables * 100) / 100,
      feriadosTrabajados: feriados.feriadosCubiertos,
      horasEnFeriado: feriados.horas,
      horasNocturnas: null,
      licencias: contarColumna(novedadesEmp, TIPOS_POR_COLUMNA.licencias, mes),
      art: contarColumna(novedadesEmp, TIPOS_POR_COLUMNA.art, mes),
      vacaciones: contarColumna(novedadesEmp, TIPOS_POR_COLUMNA.vacaciones, mes),
      parteMedico: contarColumna(novedadesEmp, TIPOS_POR_COLUMNA.parteMedico, mes),
      ausenciasSuspensiones: contarColumna(novedadesEmp, TIPOS_POR_COLUMNA.ausenciasSuspensiones, mes),
      notas: novedadesEmp.map(n => notaDeNovedad(n, mes)),
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

export function filasXLSXResumenGuardia(resumen: ResumenGuardiaMes): (string | number)[][] {
  const filas: (string | number)[][] = [
    [tituloResumenGuardia(resumen.mes)],
    ['Generado desde MERCOSUR — horas canónicas de liquidación. Jornada: fechas de inicio distintas con horas reconocidas (nocturno que cruza medianoche = 1; turno cortado del mismo día = 1). Celda vacía = sin registro en la app (no es cero). Nocturnidad: regla por cliente no configurada.'],
    [],
    ['CUIL', 'NOMBRE', 'NOVEDADES', 'OBJETIVO/S', 'JORNADAS', 'FECHAS CON ACTIVIDAD', 'HORAS REALES', 'HORAS LIQUIDABLES', 'HS NOCTURNAS', 'FERIADOS', 'HS EN FERIADO', 'LICENCIAS', 'ART', 'VACACIONES', 'PARTE MÉDICO', 'AUS/SUSP'],
    ...resumen.filas.map(f => [
      f.cuil ?? '',
      f.nombre,
      f.notas.join(' · '),
      f.objetivos.join('/'),
      f.jornadas,
      f.fechasConActividad,
      f.horasReales,
      f.horasLiquidables,
      '', // nocturnidad: sin regla configurada
      f.feriadosTrabajados,
      f.horasEnFeriado,
      celda(f.licencias),
      celda(f.art),
      celda(f.vacaciones),
      celda(f.parteMedico),
      celda(f.ausenciasSuspensiones),
    ] as (string | number)[]),
    [],
    ['TOTALES', '', '', '', resumen.totales.jornadas, '', resumen.totales.horasReales, resumen.totales.horasLiquidables, '', resumen.totales.feriadosTrabajados],
  ]
  return filas
}
