// Indicador de Desempeño y Cumplimiento — cálculo puro (Etapa 1, V2.1).
//
// Detecta desvíos sostenidos. NO es un ranking, no busca dispersión y no
// sanciona: si todos cumplen, todos pueden tener buen desempeño.
//
// Diseño completo y simulación sobre agosto 2026 en
// docs/diseno-indicadores-empleados.md
//
// ── Por qué `cierre_automatico` NO es un parámetro de este módulo ────────────
// Se midió sobre producción: en agosto hubo 60 jornadas con entrada y sin
// salida contra 70 cierres automáticos, y en 61 de 67 filas los dos números
// eran idénticos. El cierre automático no es una incidencia aparte: es la
// reacción del sistema a la salida que falta.
//
// Modelarlo permitiría contar dos veces el mismo hecho. La garantía más fuerte
// contra ese doble castigo es que el dato no entre: por eso no está en la
// interfaz de entrada, y agregarlo sería una regresión.

import { ORIGENES_CONFIRMACION_HUMANA } from '@/lib/turnos'

export const PESO_ASISTENCIA = 20
export const PESO_PROCEDIMIENTO = 60

/** Sin esto, un 10/10 no significa nada. Las dos condiciones son necesarias. */
export const MIN_OBSERVACIONES = 8
export const MIN_COBERTURA = 0.7

/**
 * Orígenes en los que una persona dio fe de la presencia, sin fichaje propio.
 * Antes esta lista estaba duplicada acá "espejando" la de bandeja-planillas.
 * Ahora se importa: la misma pregunta no puede tener dos respuestas.
 */
const ORIGENES_CONFIRMACION = ORIGENES_CONFIRMACION_HUMANA

export const TIPOS_INCIDENCIA = ['sin_registro_propio', 'entrada_sin_salida'] as const
export type TipoIncidencia = typeof TIPOS_INCIDENCIA[number]

export const ETIQUETA_INCIDENCIA: Record<TipoIncidencia, { singular: string; plural: string }> = {
  sin_registro_propio: {
    singular: 'jornada trabajada sin registro propio',
    plural: 'jornadas trabajadas sin registro propio',
  },
  entrada_sin_salida: {
    singular: 'entrada sin salida registrada',
    plural: 'entradas sin salida registrada',
  },
}

export const ESTADOS_DESEMPENO = [
  'excelente', 'correcto', 'requiere_seguimiento', 'requiere_intervencion', 'datos_insuficientes',
] as const
export type EstadoDesempeno = typeof ESTADOS_DESEMPENO[number]

export const ETIQUETA_ESTADO: Record<EstadoDesempeno, string> = {
  excelente:             'Excelente',
  correcto:              'Correcto',
  requiere_seguimiento:  'Requiere seguimiento',
  requiere_intervencion: 'Requiere intervención',
  datos_insuficientes:   'Datos insuficientes',
}

/**
 * Una jornada ya filtrada por el llamador.
 *
 * Sólo entran turnos EXIGIBLES: ya terminados, con obligación operativa
 * (ni reemplazado, ni anulado, ni cancelado) y de un objetivo real. Ese filtro
 * es el mismo que usa la bandeja de planillas y no se redefine acá.
 */
export interface JornadaDesempeno {
  turnoId: string
  /** ¿Existe un registro de asistencia? Sin registro NO es una falta: es un hueco. */
  tieneRegistro: boolean
  /** Ausencia confirmada por un supervisor. Ya pasó por revisión humana. */
  esAusencia: boolean
  /** El vigilador registró su entrada. */
  entradaPropia: boolean
  /** El vigilador registró su salida. */
  salidaPropia: boolean
  /** `registros_asistencia.origen_cobertura`. Sólo para explicar el motivo. */
  origenCobertura?: string | null
}

/** El hecho primario de una jornada. Uno solo, siempre. */
export type HechoJornada =
  | 'sin_evidencia'
  | 'ausencia'
  | 'sin_registro_propio'
  | 'entrada_sin_salida'
  | 'correcta'

/**
 * Un hecho por jornada, evaluado en orden. El primero que aplica gana y los
 * demás no se miran: es lo que garantiza que un turno no pueda penalizar dos
 * veces por el mismo evento.
 */
export function hechoDeJornada(j: JornadaDesempeno): HechoJornada {
  if (!j.tieneRegistro) return 'sin_evidencia'
  if (j.esAusencia) return 'ausencia'
  // Trabajó y alguien dio fe, pero él no registró nada. Asistencia CUMPLIDA:
  // la falta es de procedimiento, no de presencia.
  if (!j.entradaPropia) return 'sin_registro_propio'
  if (!j.salidaPropia) return 'entrada_sin_salida'
  return 'correcta'
}

export function esConfirmacionDeSupervisor(origen?: string | null): boolean {
  return typeof origen === 'string' && ORIGENES_CONFIRMACION.has(origen)
}

export interface MotivoDesempeno {
  tipo: TipoIncidencia | 'ausencia'
  cantidad: number
  texto: string
}

export interface ResultadoDesempeno {
  puntaje: number | null
  estado: EstadoDesempeno
  asistencia: number | null
  procedimiento: number | null
  /** Jornadas que entraron al cálculo. */
  observacionesValidas: number
  /** Turnos exigibles del período, hayan tenido registro o no. */
  jornadasAplicables: number
  cobertura: number
  datosInsuficientes: boolean
  incidencias: Record<TipoIncidencia, number>
  ausencias: number
  /** Turnos sin ningún registro. Fuera del denominador; NO son faltas. */
  sinEvidencia: number
  motivos: MotivoDesempeno[]
}

function redondear(v: number): number {
  return Math.round(v * 100) / 100
}

export function estadoDePuntaje(puntaje: number | null): EstadoDesempeno {
  if (puntaje === null) return 'datos_insuficientes'
  if (puntaje >= 9.5) return 'excelente'
  if (puntaje >= 8.5) return 'correcto'
  if (puntaje >= 7) return 'requiere_seguimiento'
  return 'requiere_intervencion'
}

/**
 * Los motivos salen de contadores, nunca de texto libre ni de una plantilla
 * generada: si el número cambia, el texto cambia con él, y siempre se puede
 * volver de la frase al hecho.
 */
export function motivosDeIncidencias(
  incidencias: Record<TipoIncidencia, number>,
  ausencias: number,
): MotivoDesempeno[] {
  const motivos: MotivoDesempeno[] = []

  if (ausencias > 0) {
    motivos.push({
      tipo: 'ausencia',
      cantidad: ausencias,
      texto: `${ausencias} ${ausencias === 1 ? 'ausencia confirmada' : 'ausencias confirmadas'}`,
    })
  }

  for (const tipo of TIPOS_INCIDENCIA) {
    const n = incidencias[tipo]
    if (n <= 0) continue
    const e = ETIQUETA_INCIDENCIA[tipo]
    motivos.push({ tipo, cantidad: n, texto: `${n} ${n === 1 ? e.singular : e.plural}` })
  }

  return motivos
}

/**
 * Calcula el desempeño de un período.
 *
 * `jornadas` son los turnos EXIGIBLES del período. Los que no tienen registro
 * quedan fuera del denominador —sin dato no es ausencia— pero siguen contando
 * para la cobertura: si la mitad de los turnos de alguien no tiene registro,
 * su puntaje no puede presentarse como si estuviera completo.
 */
export function calcularDesempeno(jornadas: JornadaDesempeno[]): ResultadoDesempeno {
  const incidencias: Record<TipoIncidencia, number> = {
    sin_registro_propio: 0,
    entrada_sin_salida: 0,
  }
  let ausencias = 0
  let sinEvidencia = 0
  let observaciones = 0

  for (const j of jornadas) {
    const hecho = hechoDeJornada(j)
    if (hecho === 'sin_evidencia') { sinEvidencia += 1; continue }
    observaciones += 1
    if (hecho === 'ausencia') { ausencias += 1; continue }
    if (hecho === 'sin_registro_propio' || hecho === 'entrada_sin_salida') {
      incidencias[hecho] += 1
    }
  }

  const jornadasAplicables = jornadas.length
  const cobertura = jornadasAplicables > 0 ? observaciones / jornadasAplicables : 0
  const totalIncidencias = incidencias.sin_registro_propio + incidencias.entrada_sin_salida

  // Se redondea al final, nunca antes de combinar: redondear las dimensiones
  // primero arrastra el error al total y lo corre hasta un centesimo.
  const asistenciaCruda = observaciones > 0 ? 10 * (1 - ausencias / observaciones) : null
  const procedimientoCrudo = observaciones > 0 ? 10 * (1 - totalIncidencias / observaciones) : null
  const asistencia = asistenciaCruda === null ? null : redondear(asistenciaCruda)
  const procedimiento = procedimientoCrudo === null ? null : redondear(procedimientoCrudo)

  const alcanzaMuestra =
    observaciones >= MIN_OBSERVACIONES &&
    cobertura >= MIN_COBERTURA &&
    asistenciaCruda !== null &&
    procedimientoCrudo !== null

  const puntaje = alcanzaMuestra
    ? redondear(
        (asistenciaCruda! * PESO_ASISTENCIA + procedimientoCrudo! * PESO_PROCEDIMIENTO) /
        (PESO_ASISTENCIA + PESO_PROCEDIMIENTO),
      )
    : null

  return {
    puntaje,
    estado: estadoDePuntaje(puntaje),
    asistencia,
    procedimiento,
    observacionesValidas: observaciones,
    jornadasAplicables,
    cobertura: redondear(cobertura * 100) / 100,
    datosInsuficientes: !alcanzaMuestra,
    incidencias,
    ausencias,
    sinEvidencia,
    motivos: motivosDeIncidencias(incidencias, ausencias),
  }
}

/**
 * Qué le falta a alguien para tener puntaje. Se le muestra tal cual: decir
 * "datos insuficientes" sin decir cuánto falta no ayuda a nadie.
 */
export function faltanteParaMuestra(r: ResultadoDesempeno): string | null {
  if (!r.datosInsuficientes) return null
  const faltanJornadas = Math.max(0, MIN_OBSERVACIONES - r.observacionesValidas)
  if (faltanJornadas > 0) {
    return `Se evaluaron ${r.observacionesValidas} de tus ${r.jornadasAplicables} jornadas del período. `
      + `${faltanJornadas === 1 ? 'Falta 1 jornada' : `Faltan ${faltanJornadas} jornadas`} con registro.`
  }
  return `Se evaluaron ${r.observacionesValidas} de tus ${r.jornadasAplicables} jornadas `
    + `(${Math.round(r.cobertura * 100)} % de cobertura). Hace falta al menos el ${Math.round(MIN_COBERTURA * 100)} %.`
}
