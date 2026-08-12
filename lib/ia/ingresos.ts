// lib/ia/ingresos.ts
//
// Estado operativo de un fichaje de ingreso, mirando sus dos fotos.
// Lógica pura y testeable. No modifica asistencia, horas ni liquidación:
// es un resumen de lectura, no un juicio con consecuencias.

export const ESTADOS_INGRESO = [
  'COMPLETO_SIN_OBSERVACIONES',
  'PENDIENTE_DE_REVISION',
  'EVIDENCIA_INSUFICIENTE',
  'FALTA_EVIDENCIA',
  'INCORRECTO_CONFIRMADO',
] as const
export type EstadoIngreso = typeof ESTADOS_INGRESO[number]

export const ETIQUETA_ESTADO_INGRESO: Record<EstadoIngreso, string> = {
  COMPLETO_SIN_OBSERVACIONES: 'Completo sin observaciones',
  PENDIENTE_DE_REVISION: 'Pendiente de revisión',
  EVIDENCIA_INSUFICIENTE: 'Evidencia insuficiente',
  FALTA_EVIDENCIA: 'Falta evidencia',
  INCORRECTO_CONFIRMADO: 'Incorrecto confirmado',
}

/** Estado de una de las dos fotos del ingreso. */
export type EstadoFoto = {
  /** false = el vigilador nunca la subió. */
  recibida: boolean
  /** null = recibida pero todavía sin analizar. */
  clasificacion: 'SIN_OBSERVACIONES' | 'REVISAR' | 'EVIDENCIA_INSUFICIENTE' | null
  revision: 'PENDIENTE' | 'CORRECTO' | 'INCORRECTO' | null
  /**
   * Esta foto no corresponde en este objetivo: no se exige ni se analiza.
   * Caso real: un objetivo móvil es una máquina que se traslada a diario, no
   * tiene garita y por lo tanto no tiene libro de guardia.
   *
   * Es distinto de "no llegó". Una foto que no aplica no puede faltar, y
   * tampoco puede quedar pendiente de un análisis que nunca va a ocurrir.
   */
  noAplica?: boolean
}

export type Ingreso = {
  uniforme: EstadoFoto
  libro: EstadoFoto
}

/**
 * Precedencia deliberada, de peor a mejor:
 *
 *   1. INCORRECTO_CONFIRMADO — una persona ya dijo que algo está mal. Manda
 *      sobre todo lo demás: es el único estado respaldado por un juicio humano.
 *   2. FALTA_EVIDENCIA — falta una foto o las dos. No es opinable y la IA no
 *      puede verlo: no hay imagen que analizar.
 *   3. EVIDENCIA_INSUFICIENTE — la foto llegó pero no se puede evaluar.
 *      NO es incumplimiento: es "no puedo saberlo".
 *   4. PENDIENTE_DE_REVISION — hay algo marcado, o algo sin analizar todavía.
 *   5. COMPLETO_SIN_OBSERVACIONES — las dos fotos llegaron y ninguna dio nada.
 *
 * FALTA_EVIDENCIA va por encima de EVIDENCIA_INSUFICIENTE a propósito: una foto
 * que no existe es un hecho verificable, una foto ilegible es una limitación de
 * la IA. No son lo mismo y no deberían mezclarse.
 */
export function estadoIngreso(ing: Ingreso): EstadoIngreso {
  // Lo que no se exige no participa de ninguna regla. Si se dejara entrar, un
  // ingreso de objetivo móvil quedaría PENDIENTE_DE_REVISION para siempre,
  // esperando el análisis de un libro que no existe: el mismo ruido de antes,
  // corrido de la bandeja al resumen diario.
  const fotos = [ing.uniforme, ing.libro].filter(f => !f.noAplica)
  if (fotos.length === 0) return 'COMPLETO_SIN_OBSERVACIONES'

  if (fotos.some(f => f.revision === 'INCORRECTO')) return 'INCORRECTO_CONFIRMADO'
  if (fotos.some(f => !f.recibida)) return 'FALTA_EVIDENCIA'
  if (fotos.some(f => f.clasificacion === 'EVIDENCIA_INSUFICIENTE')) return 'EVIDENCIA_INSUFICIENTE'

  // Sin analizar todavía, o marcada REVISAR y nadie la miró.
  if (fotos.some(f => f.clasificacion === null)) return 'PENDIENTE_DE_REVISION'
  if (fotos.some(f => f.clasificacion === 'REVISAR' && f.revision !== 'CORRECTO')) return 'PENDIENTE_DE_REVISION'

  return 'COMPLETO_SIN_OBSERVACIONES'
}

export const COLOR_ESTADO_INGRESO: Record<EstadoIngreso, 'verde' | 'amarillo' | 'azul' | 'rojo'> = {
  COMPLETO_SIN_OBSERVACIONES: 'verde',
  PENDIENTE_DE_REVISION: 'amarillo',
  EVIDENCIA_INSUFICIENTE: 'azul',
  FALTA_EVIDENCIA: 'rojo',
  INCORRECTO_CONFIRMADO: 'rojo',
}

export type ResumenIngresos = {
  total: number
  completos: number
  sinUniforme: number
  sinLibro: number
  sinNinguna: number
  pendientes: number
  incorrectos: number
}

export function resumirIngresos(ingresos: Ingreso[]): ResumenIngresos {
  const r: ResumenIngresos = {
    total: ingresos.length,
    completos: 0, sinUniforme: 0, sinLibro: 0, sinNinguna: 0,
    pendientes: 0, incorrectos: 0,
  }

  for (const i of ingresos) {
    const estado = estadoIngreso(i)

    // Una foto que no se exige nunca falta. Sin esto, cada ingreso de un
    // objetivo móvil sumaría a "sin libro" y el informe diario mostraría como
    // incumplimiento algo que la operación ni siquiera pide.
    const faltaUniforme = !i.uniforme.recibida && !i.uniforme.noAplica
    const faltaLibro    = !i.libro.recibida    && !i.libro.noAplica

    if (!faltaUniforme && !faltaLibro) r.completos++
    // Las tres categorías de faltante son excluyentes: un ingreso sin ninguna
    // foto se cuenta una sola vez y no infla los otros dos contadores.
    if (faltaUniforme && faltaLibro) r.sinNinguna++
    else if (faltaUniforme) r.sinUniforme++
    else if (faltaLibro) r.sinLibro++

    if (estado === 'PENDIENTE_DE_REVISION') r.pendientes++
    if (estado === 'INCORRECTO_CONFIRMADO') r.incorrectos++
  }

  return r
}
