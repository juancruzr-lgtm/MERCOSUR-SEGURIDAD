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
  const fotos = [ing.uniforme, ing.libro]

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
    if (i.uniforme.recibida && i.libro.recibida) r.completos++
    // Las tres categorías de faltante son excluyentes: un ingreso sin ninguna
    // foto se cuenta una sola vez y no infla los otros dos contadores.
    if (!i.uniforme.recibida && !i.libro.recibida) r.sinNinguna++
    else if (!i.uniforme.recibida) r.sinUniforme++
    else if (!i.libro.recibida) r.sinLibro++

    if (estado === 'PENDIENTE_DE_REVISION') r.pendientes++
    if (estado === 'INCORRECTO_CONFIRMADO') r.incorrectos++
  }

  return r
}
