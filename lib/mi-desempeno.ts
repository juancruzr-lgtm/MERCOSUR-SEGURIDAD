/**
 * lib/mi-desempeno.ts
 *
 * Lo que el vigilador lee de su propia evaluación.
 *
 * ── De dónde salen los números ───────────────────────────────────────────────
 * De `evaluaciones_mensuales` y de ningún otro lado. No se toca una tabla
 * operativa ni se vuelve a calcular nada: si la nota que ve el vigilador se
 * recalculara al abrir la pantalla, dos personas mirando el mismo mes podrían
 * ver números distintos y no habría forma de responder por una calificación ya
 * entregada.
 *
 * ── Las dos reglas que este módulo hace cumplir ──────────────────────────────
 *
 *  1. La nota es `nota_final`, sobre 10, y es lo único que se presenta como
 *     calificación. El cumplimiento ponderado va aparte, en porcentaje y con su
 *     nombre: es la capa 1, no la nota, y confundirlos fue el defecto que tuvo
 *     la lista de Cumplimiento hasta el PR #141.
 *
 *  2. Sin muestra suficiente NO se muestra un número. Ni la nota, ni un cero,
 *     ni un "0 %". Un cero se lee como "hiciste todo mal" cuando lo que pasó es
 *     que no hubo con qué medir, y es exactamente el reproche que la persona no
 *     merece.
 */

/** La fila tal cual viene de `evaluaciones_mensuales`. */
export interface FilaPublicada {
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
  estado: string
  publicado_at?: string | null
}

export interface DimensionVista {
  etiqueta: string
  /** Sobre 10. `null` cuando no se pudo medir o no le correspondía. */
  nota: number | null
  peso: number
  estado: string
  /** Por qué no tiene nota, cuando no la tiene. */
  aclaracion: string | null
}

export interface BloqueVista {
  etiqueta: string
  hechos: string[]
  recomendacion: string | null
}

export interface VistaDesempeno {
  periodo: string
  /** `true` cuando no hay con qué evaluar: la pantalla no muestra ningún número. */
  sinMuestra: boolean
  /** La calificación, ya formateada: "8,78". `null` si no hay muestra. */
  nota: string | null
  concepto: string | null
  /** Capa 1, en porcentaje y etiquetada aparte. Nunca con formato /10. */
  cumplimiento: string | null
  /** El texto que reemplaza a la nota cuando no hay muestra. */
  explicacionSinMuestra: string | null
  /** Aviso cuando el mes se pudo medir sólo en parte. */
  avisoDeCobertura: string | null
  /** Sólo cuando un tope efectivamente bajó la nota. */
  topeAplicado: { hecho: string; texto: string } | null
  /** Lo que hay que corregir aunque no haya bajado la nota. */
  aTenerEnCuenta: string[]
  dimensiones: DimensionVista[]
  /** El detalle en validación no puntúa: se nombra para que no parezca oculto. */
  informativas: string[]
  loQueSalioBien: BloqueVista[]
  loQueConvieneMejorar: BloqueVista[]
  encabezadoDelBalance: string | null
}

const numero = (v: number | null | undefined, decimales: number): string | null =>
  v === null || v === undefined || Number.isNaN(v)
    ? null
    : v.toFixed(decimales).replace('.', ',')

const MES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

export function etiquetaDePeriodo(periodo: string): string {
  const [a, m] = periodo.split('-')
  const i = Number(m) - 1
  return MES[i] ? `${MES[i]} de ${a}` : periodo
}

const lista = (v: unknown): any[] => (Array.isArray(v) ? v : [])
const objeto = (v: unknown): any => (v && typeof v === 'object' ? (v as any) : {})

/**
 * Por qué una dimensión no tiene nota.
 *
 * Dejarla en blanco haría pensar que se perdió el dato o que la nota es cero.
 */
function aclaracionDeDimension(estado: string): string | null {
  if (estado === 'no_aplica') return 'No te correspondía este mes'
  if (estado === 'sin_datos' || estado === 'datos_insuficientes') {
    return 'No se midió lo suficiente como para calificarla'
  }
  if (estado === 'en_validacion') return 'Se mide, pero todavía no pesa en el puntaje'
  return null
}

/**
 * Arma la vista.
 *
 * `fila` es la fila publicada. No recibe nada más a propósito: si necesitara un
 * segundo origen, ese origen podría contradecir a la evaluación entregada.
 */
export function vistaDeEvaluacion(fila: FilaPublicada): VistaDesempeno {
  const bal = objeto(fila.balance)
  const bloques = lista(bal.bloques)

  const dims: DimensionVista[] = lista(fila.dimensiones)
    .filter(d => Number(d?.peso ?? 0) > 0)
    .map(d => ({
      etiqueta: String(d.etiqueta ?? d.clave ?? ''),
      nota: typeof d.nota === 'number' ? d.nota : null,
      peso: Number(d.peso ?? 0),
      estado: String(d.estado ?? ''),
      aclaracion: aclaracionDeDimension(String(d.estado ?? '')),
    }))
    .sort((a, b) => b.peso - a.peso)

  const informativas = lista(fila.dimensiones)
    .filter(d => Number(d?.peso ?? 0) === 0)
    .map(d => String(d.etiqueta ?? d.clave ?? ''))
    .filter(Boolean)

  // ── Sin muestra: no hay número que mostrar ────────────────────────────────
  if (fila.datos_insuficientes || fila.nota_final === null) {
    const jornadas = Number(objeto(fila.contexto).jornadas ?? 0)
    return {
      periodo: fila.periodo,
      sinMuestra: true,
      nota: null,
      concepto: null,
      cumplimiento: null,
      explicacionSinMuestra:
        'Todavía no existe información suficiente para consolidar tu evaluación '
        + `de ${etiquetaDePeriodo(fila.periodo)}`
        + (jornadas > 0
          ? `: se registraron ${jornadas} ${jornadas === 1 ? 'jornada' : 'jornadas'}, `
            + 'y son muy pocas para describir el mes.'
          : '.')
        + ' No es una nota baja ni una observación: es que no hay con qué medir.',
      avisoDeCobertura: null,
      topeAplicado: null,
      aTenerEnCuenta: [],
      dimensiones: dims,
      informativas,
      loQueSalioBien: [],
      loQueConvieneMejorar: [],
      encabezadoDelBalance: null,
    }
  }

  // ── El tope: sólo se nombra como tope si efectivamente bajó la nota ───────
  //
  // Puede haber una falta registrada con la nota ya por debajo del tope. Decir
  // ahí "tu nota quedó limitada a 6" cuando la nota es 4,03 sería falso: el
  // tope no hizo nada. El hecho se cuenta igual, pero como algo a corregir.
  const faltas = lista(fila.faltas)
  const bajoLaNota =
    fila.indice !== null && fila.nota_final !== null && fila.nota_final < fila.indice
  const topeAplicado = bajoLaNota && faltas.length > 0
    ? {
      hecho: String(faltas[0].hecho ?? ''),
      texto: `Tu nota quedó limitada a ${numero(fila.nota_final, 2)} por este motivo. `
        + `Sin él habría sido ${numero(fila.indice, 2)}.`,
    }
    : null
  const aTenerEnCuenta = bajoLaNota
    ? faltas.slice(1).map(f => String(f.hecho ?? '')).filter(Boolean)
    : faltas.map(f => String(f.hecho ?? '')).filter(Boolean)

  const mapear = (b: any): BloqueVista => ({
    etiqueta: String(b.etiqueta ?? ''),
    hechos: lista(b.hechos).map(String),
    recomendacion: b.recomendacion ? String(b.recomendacion) : null,
  })

  return {
    periodo: fila.periodo,
    sinMuestra: false,
    nota: numero(fila.nota_final, 2),
    concepto: fila.concepto,
    // Un decimal y el signo de porcentaje pegado al número: que no se pueda
    // leer como una nota sobre 10 ni por descuido.
    cumplimiento: numero(fila.cumplimiento_ponderado, 1),
    explicacionSinMuestra: null,
    avisoDeCobertura: fila.alcance === 'parcial'
      ? `Este mes se pudo evaluar el ${numero(fila.cobertura, 1) ?? '—'} % de lo que `
        + 'correspondía medir, así que la evaluación es parcial: describe lo que se '
        + 'midió, no todo el mes.'
      : (typeof bal.notaDeCobertura === 'string' ? bal.notaDeCobertura : null),
    topeAplicado,
    aTenerEnCuenta,
    dimensiones: dims,
    informativas,
    loQueSalioBien: bloques.filter(b => b?.estado === 'bien').map(mapear),
    loQueConvieneMejorar: bloques.filter(b => b?.estado === 'mejorar').map(mapear),
    encabezadoDelBalance: typeof bal.encabezado === 'string' ? bal.encabezado : null,
  }
}
