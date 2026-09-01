/**
 * lib/evaluacion-snapshot.ts
 *
 * Congela una evaluación mensual para poder publicarla.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 * La evaluación se calcula en el navegador cada vez que alguien abre la
 * pantalla. Eso impide publicarla: la nota se movería sola cuando Administración
 * corrige el mes, y el vigilador vería un número distinto cada vez que entra.
 *
 * Este módulo no calcula nada. Toma lo que el motor ya produjo —`cumplimiento`,
 * `evaluacion`, `balance`— y lo aplana a la forma de `evaluaciones_mensuales`.
 * Si algún día el modelo cambia, lo publicado sigue siendo lo que se publicó,
 * que es justamente lo que hace falta para poder responder por una calificación
 * ya entregada.
 *
 * ── Las cuatro capas, separadas ──────────────────────────────────────────────
 * El defecto que tuvo la lista de Cumplimiento hasta el PR #141 fue mostrar la
 * capa 1 con formato de nota. Acá cada capa viaja en su propio campo y con su
 * propia unidad, para que no se puedan confundir aguas abajo:
 *
 *   cumplimiento_ponderado  0 a 100   — NO es la nota
 *   indice                  1 a 10    — después de la escala escolar
 *   nota_final              1 a 10    — después de los topes. ES la nota
 */

import type { DesempenoEmpleado } from '@/lib/desempeno-datos'
import type { Evaluacion } from '@/lib/evaluacion-final'
import type { BalanceMensual } from '@/lib/balance-mensual'

export type EstadoPublicacion = 'calculada' | 'revisada' | 'publicada'

/** Una fila de `evaluaciones_mensuales`, lista para insertar. */
export interface FilaEvaluacion {
  empleado_id: string
  periodo: string
  cumplimiento_ponderado: number | null
  indice: number | null
  nota_final: number | null
  concepto: string | null
  datos_insuficientes: boolean
  cobertura: number | null
  alcance: string | null
  estado_desempeno: string | null
  dimensiones: unknown
  faltas: unknown
  explicacion: string | null
  balance: unknown
  contexto: unknown
  estado: EstadoPublicacion
}

const redondear = (v: number | null | undefined, decimales = 2): number | null =>
  v === null || v === undefined || Number.isNaN(v)
    ? null
    : Math.round(v * 10 ** decimales) / 10 ** decimales

/**
 * El contexto que hace entendible un número.
 *
 * Sin esto, "0 % de rondas" no se puede leer: no es lo mismo sobre un turno que
 * sobre veinte. Es el caso OYOLA, y es la razón por la que este objeto viaja
 * junto a la nota en vez de reconstruirse después.
 */
export interface ContextoEvaluacion {
  jornadas: number
  objetivos: string[]
  rondasExigibles?: number | null
  rondasCumplidas?: number | null
  turnosConObligacionDeRonda?: number | null
  turnosConIncumplimientoDeRonda?: number | null
}

export interface EntradaSnapshot {
  desempeno: DesempenoEmpleado
  balance?: BalanceMensual | null
  contexto?: Partial<ContextoEvaluacion>
}

/**
 * Aplana una persona.
 *
 * `datos_insuficientes` no es un defecto: es la respuesta honesta cuando la
 * muestra no alcanza. En ese caso la nota va en `null` a propósito, para que
 * ninguna pantalla pueda mostrar un cero que nadie calculó.
 */
export function filaDeEvaluacion(
  entrada: EntradaSnapshot,
  periodo: string,
  estado: EstadoPublicacion = 'calculada',
): FilaEvaluacion {
  const d = entrada.desempeno
  const e: Evaluacion | null = d.evaluacion ?? null
  const ponderado = d.cumplimiento?.puntaje ?? null
  const sinDatos = ponderado === null || e === null

  return {
    empleado_id: d.empleadoId,
    periodo,
    // La capa 1 se guarda en su unidad natural, 0 a 100, para que nadie la
    // confunda con una nota por venir en el mismo rango.
    cumplimiento_ponderado: sinDatos ? null : redondear(ponderado! * 10),
    indice: sinDatos ? null : redondear(e!.desempeno),
    nota_final: sinDatos ? null : redondear(e!.notaFinal),
    concepto: sinDatos ? null : (e!.concepto ?? null),
    datos_insuficientes: sinDatos,
    // `ajustada` es la que decide: mide sobre lo que le aplicaba, no sobre el
    // total teórico. Es la que la ficha muestra como "cobertura de lo exigible".
    cobertura: sinDatos ? null : redondear((e!.cobertura?.ajustada ?? 0) * 100),
    alcance: sinDatos ? null : (e!.alcance ?? null),
    estado_desempeno: d.cumplimiento?.estado ?? null,
    dimensiones: d.cumplimiento?.dimensiones ?? [],
    faltas: e?.faltas ?? [],
    explicacion: e?.explicacion ?? null,
    balance: entrada.balance ?? null,
    contexto: {
      jornadas: d.jornadas?.length ?? 0,
      objetivos: d.objetivos ?? [],
      ...entrada.contexto,
    },
    estado,
  }
}

export function filasDeSnapshot(
  entradas: readonly EntradaSnapshot[],
  periodo: string,
  estado: EstadoPublicacion = 'calculada',
): FilaEvaluacion[] {
  return entradas.map(x => filaDeEvaluacion(x, periodo, estado))
}

export interface ResumenSnapshot {
  total: number
  conNota: number
  sinDatos: number
  conTope: number
  promedioNota: number | null
  promedioPonderado: number | null
  /** Cuántas personas por nota entera. La clave es el piso: 8 son 8,0 a 8,9. */
  distribucion: Record<number, number>
  aprobados: number
  aplazados: number
}

/** Nota mínima para estar aprobado. Es la escala ya aprobada, no una nueva. */
export const NOTA_APROBADO = 6

/**
 * El resumen que consume el Tablero de Gerencia.
 *
 * Sale del MISMO snapshot que ve el vigilador, no de una segunda cuenta: si
 * Gerencia tuviera su propio cálculo, el día que uno cambiara el otro quedaría
 * mintiendo y nadie lo notaría hasta comparar las pantallas.
 */
export function resumirSnapshot(filas: readonly FilaEvaluacion[]): ResumenSnapshot {
  const conNota = filas.filter(f => !f.datos_insuficientes && f.nota_final !== null)
  const distribucion: Record<number, number> = {}
  for (const f of conNota) {
    const piso = Math.floor(f.nota_final!)
    distribucion[piso] = (distribucion[piso] ?? 0) + 1
  }
  const prom = (xs: number[]) =>
    xs.length === 0 ? null : Math.round((xs.reduce((s, v) => s + v, 0) / xs.length) * 100) / 100

  return {
    total: filas.length,
    conNota: conNota.length,
    sinDatos: filas.length - conNota.length,
    conTope: conNota.filter(f => Array.isArray(f.faltas) && f.faltas.length > 0).length,
    promedioNota: prom(conNota.map(f => f.nota_final!)),
    promedioPonderado: prom(
      conNota.map(f => f.cumplimiento_ponderado!).filter(v => v !== null),
    ),
    distribucion,
    aprobados: conNota.filter(f => f.nota_final! >= NOTA_APROBADO).length,
    aplazados: conNota.filter(f => f.nota_final! < NOTA_APROBADO).length,
  }
}
