// Por qué se pausó una ronda, y qué significa eso para el vigilador.
//
// Esta lista es la que decide si las ventanas que cubrió una pausa eran
// exigibles o no. Por eso vive en un solo lugar: la elige una persona en el
// modal de pausa, la valida `pausar_ronda`, y la lee `cumplimiento_rondas_por_empleado`.
// Tres copias de esta lista terminarían diciendo cosas distintas sobre la misma
// pausa.
//
// ── Lo que NO hace ──────────────────────────────────────────────────────────
// No se deduce del texto del motivo. Nunca. El motivo sigue existiendo, sigue
// siendo obligatorio y sigue mostrándose tal cual, pero es una explicación para
// una persona; la causa es el dato con el que se cuenta.
//
// Las pausas anteriores a esta clasificación no tienen causa y no se les
// inventa ninguna: quedan en `sin_clasificar`, que es lo que son.

export const CAUSAS_PAUSA = [
  'tecnica_gps', 'configuracion', 'no_aplica',
  'no_se_realiza', 'capacitacion', 'otra',
] as const

export type CausaPausa = typeof CAUSAS_PAUSA[number]

/** Lo que se guarda para una pausa vieja, que no eligió causa. */
export const CAUSA_SIN_CLASIFICAR = 'sin_clasificar'

/**
 * Quién es responsable de que la ronda no se hiciera.
 *
 *   atribuible      la ronda se podía hacer y no se hizo. La ventana cuenta
 *                   como no realizada.
 *   no_atribuible   el sistema no dejaba hacerla, o no correspondía. Sale del
 *                   universo sin penalizar a nadie.
 *   capacitacion    se podía hacer, pero nadie le enseñó. No penaliza al
 *                   vigilador y sí genera una enseñanza.
 *   sin_clasificar  nadie dijo por qué. Sale del universo Y deja la dimensión
 *                   en validación: no se puede afirmar nada.
 */
export type AtribucionPausa = 'atribuible' | 'no_atribuible' | 'capacitacion' | 'sin_clasificar'

export const ATRIBUCION: Record<CausaPausa, AtribucionPausa> = {
  no_se_realiza: 'atribuible',
  tecnica_gps:   'no_atribuible',
  configuracion: 'no_atribuible',
  no_aplica:     'no_atribuible',
  capacitacion:  'capacitacion',
  // "Otra" es honesta pero no es clasificable: si se contara como no atribuible
  // sería una salida gratis, y como atribuible una acusación que nadie hizo.
  otra:          'sin_clasificar',
}

export function atribucionDeCausa(causa?: string | null): AtribucionPausa {
  if (!causa) return 'sin_clasificar'
  return ATRIBUCION[causa as CausaPausa] ?? 'sin_clasificar'
}

export interface OpcionCausa {
  clave: CausaPausa
  etiqueta: string
  /** Qué implica elegirla. Se muestra al lado, para que la elección sea informada. */
  ayuda: string
}

/**
 * El orden es deliberado: primero las que sacan la ronda del universo, para que
 * quien pausa no tenga que leer las seis antes de encontrar la suya. La única
 * que cuenta como incumplimiento va señalada.
 */
export const OPCIONES_CAUSA: OpcionCausa[] = [
  {
    clave: 'tecnica_gps',
    etiqueta: 'Problema técnico / GPS',
    ayuda: 'El GPS no valida los puntos o la app no permite registrarla. '
      + 'Las rondas de este período no se le cuentan al vigilador.',
  },
  {
    clave: 'configuracion',
    etiqueta: 'Ronda mal configurada',
    ayuda: 'Sin puntos cargados, horario equivocado, puesto que no corresponde. '
      + 'No se le cuentan al vigilador.',
  },
  {
    clave: 'no_aplica',
    etiqueta: 'No correspondía hacerla',
    ayuda: 'La ronda no era exigible en ese período. No se le cuentan al vigilador.',
  },
  {
    clave: 'capacitacion',
    etiqueta: 'Falta capacitación',
    ayuda: 'Se podía hacer, pero el vigilador todavía no sabe cómo. '
      + 'No se le cuentan como incumplimiento y sí generan una instrucción.',
  },
  {
    clave: 'no_se_realiza',
    etiqueta: 'Se podía hacer y no se estaba haciendo',
    ayuda: 'ATENCIÓN: estas rondas SÍ se cuentan como no realizadas en el '
      + 'Cumplimiento Operativo del vigilador. Elegila sólo si el problema no '
      + 'era técnico ni de configuración.',
  },
  {
    clave: 'otra',
    etiqueta: 'Otra causa',
    ayuda: 'Explicala en el motivo. Estas rondas quedan fuera del cálculo y sin '
      + 'clasificar: no acusan a nadie, pero tampoco se pueden medir.',
  },
]

export const ETIQUETA_CAUSA: Record<string, string> = {
  ...Object.fromEntries(OPCIONES_CAUSA.map(o => [o.clave, o.etiqueta])),
  [CAUSA_SIN_CLASIFICAR]: 'Sin clasificar (pausa anterior a la clasificación)',
}

export function etiquetaCausa(causa?: string | null): string {
  return ETIQUETA_CAUSA[causa ?? CAUSA_SIN_CLASIFICAR] ?? String(causa)
}

export function esCausaValida(causa?: string | null): causa is CausaPausa {
  return (CAUSAS_PAUSA as readonly string[]).indexOf(String(causa)) >= 0
}
