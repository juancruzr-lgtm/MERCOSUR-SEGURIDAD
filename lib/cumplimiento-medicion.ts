// La unidad de medida de todas las dimensiones: CUMPLIDO sobre REQUERIDO VÁLIDO.
//
// No "cantidad de errores". Dos personas con tres incidencias cada una no
// hicieron lo mismo si una tuvo 4 requerimientos y la otra 40. Contar errores
// absolutos convierte al que más trabaja en el que peor cumple, que es
// exactamente al revés de lo que pasó.
//
// ── Las tres respuestas posibles, y ninguna es cero ─────────────────────────
//   no_aplica            no tuvo ese requerimiento. No le falta nada.
//   datos_insuficientes  lo tuvo, pero tan poco que un número diría más de lo
//                        que sabe.
//   medible              hay con qué.
//
// Un cero es una afirmación fuerte: dice "tuvo que hacerlo y no hizo NADA".
// Decirlo cuando en realidad no había obligación es la falla más cara que puede
// tener un indicador que después usa una persona para tomar una decisión.
//
// ── Exclusiones ────────────────────────────────────────────────────────────
// Lo excluido nunca desaparece: viaja con su etiqueta y su cantidad. La
// pantalla las muestra. Una exclusión invisible es indistinguible de un dato
// que no existió.

/** Redondeo a dos decimales, sin sorpresas de coma flotante. */
const dos = (n: number) => Math.round(n * 100) / 100

export type EstadoMedicion = 'no_aplica' | 'datos_insuficientes' | 'medible'

export interface Exclusion {
  clave: string
  etiqueta: string
  cantidad: number
  /**
   * `true` cuando la exclusión salió del universo porque NADIE pudo decir qué
   * era. No es lo mismo que una exclusión justificada: mantiene la dimensión en
   * validación, porque el número que queda describe un universo recortado por
   * una ignorancia, no por una razón.
   */
  ambigua?: boolean
}

/**
 * Las tres formas de convertir cumplidos/válidos en una nota.
 *
 *   proporcional     10 × c/v. Es la que está en uso.
 *   tolerancia_uno   perdona el primer fallo del período.
 *   exigente         10 × (c/v)^1.5. Castiga más fuerte cuando falla mucho.
 *
 * Existen las tres para poder comparar sobre datos reales antes de elegir, no
 * para que cada pantalla elija la suya: el llamador pasa la curva y la que se
 * usa en producción es una sola.
 */
export type CurvaNota = 'proporcional' | 'tolerancia_uno' | 'exigente'

export const CURVAS: CurvaNota[] = ['proporcional', 'tolerancia_uno', 'exigente']

export function notaDe(cumplidos: number, validos: number, curva: CurvaNota = 'proporcional'): number | null {
  if (validos <= 0) return null
  const c = Math.max(0, Math.min(cumplidos, validos))
  switch (curva) {
    case 'tolerancia_uno':
      // Un fallo aislado en un mes largo no debería cambiar la categoría de
      // nadie; diez sobre veinte sí.
      return dos((10 * Math.min(c + 1, validos)) / validos)
    case 'exigente':
      return dos(10 * Math.pow(c / validos, 1.5))
    default:
      return dos((10 * c) / validos)
  }
}

export interface Medicion {
  /** Todo lo que el período le exigió, antes de sacar nada. */
  requeridos: number
  exclusiones: Exclusion[]
  excluidos: number
  /** Sobre esto se mide. `requeridos − excluidos`. */
  validos: number
  cumplidos: number
  incidencias: number
  estado: EstadoMedicion
  nota: number | null
  minimo: number
  /**
   * Hay exclusiones que nadie pudo justificar. La nota existe pero describe un
   * universo recortado a ciegas.
   *
   * Que sea ambigua NO decide por sí sola si la dimensión puntúa: eso lo dice
   * `bloquea`.
   */
  ambigua: boolean
  /**
   * Las dos puntas entre las que se mueve la verdad cuando hay ambigüedad.
   *
   *   techo  la nota sobre el universo saneado. Es lo más favorable posible
   *          para el vigilador: supone que TODO lo ambiguo no era exigible.
   *   piso   la nota si nada se excluyera. Es el peor caso concebible.
   *
   * `null` cuando no hay ambigüedad, porque entonces no hay rango: hay un dato.
   */
  rango: { piso: number; techo: number } | null
  /**
   * La ambigüedad impide concluir, así que la dimensión no puede puntuar.
   *
   * Ver `LA REGLA DE ATRIBUCIÓN` abajo.
   */
  bloquea: boolean
}

// ── LA REGLA DE ATRIBUCIÓN ──────────────────────────────────────────────────
//
// «La incertidumbre protege al vigilador sobre lo que no sabemos; no elimina lo
//  que sí sabemos.»
//
// Antes, cualquier exclusión ambigua sacaba la dimensión entera del puntaje. La
// intención era no afirmar un número sobre un universo recortado a ciegas. El
// efecto medido sobre agosto fue el contrario del buscado: alguien con 0 rondas
// hechas de 9 exigibles —y 0 de 16 si no se excluyera nada— terminaba con nota
// 10, porque 7 pausas sin clasificar sacaron Rondas del cálculo. La ficha
// mostraba "Rondas 0" al lado de ese 10. Cuanto más sucia la medición, más
// protegido el peor cumplimiento.
//
// La regla nueva compara las dos puntas del rango:
//
//   · Si ni siquiera el TECHO aprueba, la conclusión no depende de lo que no
//     sabemos: está mal de cualquier forma que se lo mire. La dimensión puntúa,
//     y puntúa con el techo — nunca con el piso.
//   · Si el techo aprueba y el piso no, la diferencia sí depende de lo que nadie
//     clasificó. Sigue sin puntuar.
//
// Lo que la regla NO hace, y no puede hacer nunca:
//   · inventar qué pasó con lo ambiguo;
//   · convertir un ambiguo en incumplimiento;
//   · puntuar con el piso;
//   · empeorar a alguien por debajo de su mejor medición posible.
//
// Se puede defender en una frase frente a un vigilador: «si aun contando sólo
// lo que te podemos exigir con certeza no llegás a aprobar, no sirve alegar que
// el resto no se sabe».

/** La nota mínima que se considera cumplimiento. Es el 6 de la escala escolar. */
export const APRUEBA_DESDE = 6

export interface ParametrosMedicion {
  requeridos: number
  cumplidos: number
  exclusiones?: Exclusion[]
  /** Debajo de esto no se da número. */
  minimo: number
  curva?: CurvaNota
}

export function medir(p: ParametrosMedicion): Medicion {
  const exclusiones = (p.exclusiones ?? []).filter(e => e.cantidad > 0)
  const excluidos = exclusiones.reduce((s, e) => s + e.cantidad, 0)
  const validos = Math.max(0, p.requeridos - excluidos)
  const cumplidos = Math.max(0, Math.min(p.cumplidos, validos))

  const estado: EstadoMedicion =
    validos === 0        ? 'no_aplica'
    : validos < p.minimo ? 'datos_insuficientes'
    :                      'medible'

  // Sin muestra no se inventa un número, ni siquiera "provisorio": una vez que
  // aparece en pantalla alguien lo usa.
  const nota = estado === 'medible' ? notaDe(cumplidos, validos, p.curva) : null
  const ambigua = exclusiones.some(e => e.ambigua)

  // El rango sólo existe si hay ambigüedad Y hay una nota que comparar. El piso
  // se mide sobre TODO lo requerido con los mismos cumplidos: es el peor caso
  // concebible, y está acá para poder decir cuánta incertidumbre hay, no para
  // puntuar con él.
  const rango = ambigua && nota !== null
    ? { piso: notaDe(cumplidos, p.requeridos, p.curva) ?? 0, techo: nota }
    : null

  return {
    requeridos: p.requeridos,
    exclusiones,
    excluidos,
    validos,
    cumplidos,
    incidencias: validos - cumplidos,
    estado,
    nota,
    minimo: p.minimo,
    ambigua,
    rango,
    // Si ni el techo aprueba, la ambigüedad no cambia la conclusión y no puede
    // seguir tapándola. Sin nota que comparar sigue bloqueando: ahí la duda es
    // total.
    bloquea: ambigua && (nota === null || nota >= APRUEBA_DESDE),
  }
}

/** "18 de 20 · 2 incidencias · 5 excluidas". El número nunca va solo. */
export function detalleMedicion(m: Medicion, unidad: string, plural: string): string {
  if (m.requeridos === 0) return `Sin ${plural} en el período`
  if (m.estado === 'no_aplica') {
    return `Sin ${plural} exigibles · ${m.excluidos} fuera del cálculo`
  }
  const partes = [`${m.cumplidos} de ${m.validos} ${m.validos === 1 ? unidad : plural}`]
  if (m.incidencias > 0) partes.push(`${m.incidencias} sin cumplir`)
  for (const e of m.exclusiones) partes.push(`${e.cantidad} ${e.etiqueta}`)
  return partes.join(' · ')
}

/** Por qué no hay número. Dice qué falta, no "no disponible". */
export function faltanteDeMedicion(m: Medicion, plural: string): string | null {
  if (m.estado === 'no_aplica') {
    return m.requeridos === 0
      ? `No tuvo ${plural} en el período`
      : `Todas sus ${plural} quedaron fuera del cálculo`
  }
  if (m.estado === 'datos_insuficientes') {
    return `Con ${m.validos} ${plural} no alcanza: hacen falta al menos ${m.minimo}`
  }
  return null
}
