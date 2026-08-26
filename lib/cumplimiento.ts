// Cumplimiento Operativo — las dimensiones y cómo se combinan.
//
// ── Qué mide y qué NO mide ──────────────────────────────────────────────────
// Mide el cumplimiento del procedimiento: presencia, horario, uso de la app,
// rondas, evidencias. NO mide si alguien es buen vigilador.
//
// Una persona puede ser la que el cliente pide por nombre y sacar 4 acá porque
// no ficha la salida. Son dos cosas distintas y el sistema no debe confundirlas:
// por eso este número se llama Cumplimiento Operativo y no "Desempeño".
// Desempeño será la capa de arriba, cuando existan la evaluación del supervisor
// y la del cliente.
//
// ── Por qué una dimensión puede aparecer y no puntuar ───────────────────────
// Se muestran las siete desde el primer día, para que se vea qué se está
// mirando y qué no. Pero una dimensión sin datos confiables NO inventa una
// nota: queda en `en_validacion` con peso 0 y fuera del promedio.
//
// Prometer una nota que no se puede sostener es peor que no darla: alguien
// tomaría una decisión sobre una persona con un número inventado.
//
// ── El núcleo no se reescribe ───────────────────────────────────────────────
// Asistencia y Procedimiento salen enteras de lib/desempeno.ts, que ya está en
// producción y validado sobre agosto. Acá no se recalculan: se envuelven.

import {
  ETIQUETA_ESTADO, calcularDesempeno, estadoDePuntaje,
  PESO_ASISTENCIA, PESO_PROCEDIMIENTO,
} from '@/lib/desempeno'
import type {
  EstadoDesempeno, JornadaDesempeno, MotivoDesempeno, ResultadoDesempeno,
} from '@/lib/desempeno'

export { ETIQUETA_ESTADO, estadoDePuntaje }
export type { EstadoDesempeno, MotivoDesempeno }

// ── Puntualidad ─────────────────────────────────────────────────────────────

/**
 * El vigilador debe presentarse 15 minutos antes para prepararse, anoticiarse
 * de las novedades y recibir el puesto. La ventana correcta es
 * [inicio − 15, inicio].
 *
 * Que el sistema TÉCNICAMENTE permita fichar unos minutos más tarde no vuelve
 * puntual a ese ingreso: son dos cosas distintas y viven en lugares distintos.
 * La tolerancia de fichaje pertenece a la operación y a la liquidación, y este
 * módulo no la lee ni la toca.
 *
 * ── Por qué NO se excluyen los horarios sospechosos ─────────────────────────
 * El horario programado es la referencia mientras no lo corrija una persona.
 * Si está mal cargado, queremos que el indicador lo haga VISIBLE para que
 * alguien lo revise y lo corrija — no esconderlo detrás de una excepción
 * estadística. Una excepción automática dejaría el dato malo intacto y sin que
 * nadie se entere.
 *
 * Para eso existe `patronesDeHorarioSospechoso`, que señala el puesto sin
 * neutralizar ninguna impuntualidad.
 */
export const MINUTOS_PRESENTACION_PREVIA = 15

export type HechoPuntualidad = 'puntual' | 'impuntual' | 'sin_dato'

export type ClaveBanda = 'puntual' | 'leve' | 'tardanza' | 'importante' | 'grave'

export interface BandaPuntualidad {
  clave: ClaveBanda
  etiqueta: string
  /** Minutos de demora desde el inicio programado. `hasta` inclusive. */
  desde: number
  hasta: number
  /**
   * Cuánto resta esa jornada, en "jornadas equivalentes". La nota es
   * 10 × (1 − Σpenalización / evaluables), así que 1.0 equivale a perder una
   * jornada entera.
   *
   * Los valores salen de simular agosto 2026 sobre 54 personas con muestra:
   * una tardanza leve aislada deja la nota en 9,7–9,9 —no destruye el mes— y
   * la reincidencia sí baja (17 tardanzas de 6–15 en 20 jornadas → 5,1).
   * No se eligieron para fabricar dispersión: 15 personas quedaron en 10,0.
   */
  penalizacion: number
}

export const BANDAS_PUNTUALIDAD: BandaPuntualidad[] = [
  { clave: 'puntual',    etiqueta: 'Puntual',              desde: -Infinity, hasta: 0,        penalizacion: 0 },
  { clave: 'leve',       etiqueta: 'Tardanza leve',        desde: 1,         hasta: 5,        penalizacion: 0.25 },
  { clave: 'tardanza',   etiqueta: 'Tardanza',             desde: 6,         hasta: 15,       penalizacion: 0.5 },
  { clave: 'importante', etiqueta: 'Tardanza importante',  desde: 16,        hasta: 30,       penalizacion: 1 },
  { clave: 'grave',      etiqueta: 'Tardanza grave',       desde: 31,        hasta: Infinity, penalizacion: 2 },
]

export function bandaDeDemora(minutos: number): BandaPuntualidad {
  for (const b of BANDAS_PUNTUALIDAD) {
    if (minutos >= b.desde && minutos <= b.hasta) return b
  }
  return BANDAS_PUNTUALIDAD[BANDAS_PUNTUALIDAD.length - 1]
}

function aMinutos(hora?: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hora ?? ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

export interface JornadaCumplimiento extends JornadaDesempeno {
  /** De quién es la jornada. Sin esto no se puede contar personas. */
  empleadoId?: string | null
  /** Fecha del turno, para poder mostrar el hecho detrás del número. */
  fecha?: string | null
  /** Horario programado del turno. */
  horaInicioProg?: string | null
  horaFinProg?: string | null
  /**
   * Hora de entrada reconocida. Si Administración corrigió el fichaje, ésta es
   * la corregida: la corrección humana es la fuente autoritativa y este módulo
   * no la discute ni mantiene una segunda versión del dato.
   */
  entrada?: string | null
  objetivo?: string | null
}

/**
 * Minutos de demora respecto del inicio programado. Negativo = llegó antes.
 * `null` cuando no se puede saber.
 */
export function minutosDeDemora(j: JornadaCumplimiento): number | null {
  if (!j.tieneRegistro || j.esAusencia) return null
  // Sin fichaje propio no se sabe a qué hora llegó. Ya cuenta como incidencia
  // de Procedimiento; suponer una hora sería inventar y castigar dos veces.
  if (!j.entradaPropia) return null

  const inicio = aMinutos(j.horaInicioProg)
  const entradaCruda = aMinutos(j.entrada)
  if (inicio === null || entradaCruda === null) return null

  // Nocturno: si el turno arranca a las 22:00 y la entrada dice 21:50, llegó
  // temprano; si dice 01:00, llegó al día siguiente. El corte se hace lejos del
  // inicio para no confundir una llegada anticipada con una tardía de 22 horas.
  const fin = aMinutos(j.horaFinProg)
  const nocturno = fin !== null && fin <= inicio
  let entrada = entradaCruda
  if (nocturno && entradaCruda < inicio - 720) entrada += 1440

  return entrada - inicio
}

export function hechoDePuntualidad(j: JornadaCumplimiento): HechoPuntualidad {
  const m = minutosDeDemora(j)
  if (m === null) return 'sin_dato'
  return m <= 0 ? 'puntual' : 'impuntual'
}

/** Una jornada tarde, con todo lo que hace falta para poder rastrearla. */
export interface DetalleTardanza {
  turnoId: string
  fecha: string | null
  objetivo: string | null
  horaInicioProg: string | null
  entrada: string | null
  minutos: number
  banda: ClaveBanda
}

export interface ResumenPuntualidad {
  puntuales: number
  impuntuales: number
  sinDato: number
  /** Sobre las jornadas donde SÍ se puede juzgar. */
  evaluadas: number
  porBanda: Record<ClaveBanda, number>
  /** Promedio de demora contando SOLO las tardías. */
  promedioTarde: number | null
  maximo: number | null
  nota: number | null
  /** Las tardías, de mayor a menor demora. Es la trazabilidad del número. */
  tardanzas: DetalleTardanza[]
}

export function resumirPuntualidad(jornadas: JornadaCumplimiento[]): ResumenPuntualidad {
  const porBanda: Record<ClaveBanda, number> = {
    puntual: 0, leve: 0, tardanza: 0, importante: 0, grave: 0,
  }
  const tardanzas: DetalleTardanza[] = []
  let sinDato = 0
  let penalizacion = 0
  let sumaTarde = 0
  let maximo: number | null = null

  for (const j of jornadas) {
    const m = minutosDeDemora(j)
    if (m === null) { sinDato += 1; continue }
    const banda = bandaDeDemora(m)
    porBanda[banda.clave] += 1
    penalizacion += banda.penalizacion
    if (m > 0) {
      sumaTarde += m
      if (maximo === null || m > maximo) maximo = m
      tardanzas.push({
        turnoId: j.turnoId,
        fecha: j.fecha ?? null,
        objetivo: j.objetivo ?? null,
        horaInicioProg: j.horaInicioProg ?? null,
        entrada: j.entrada ?? null,
        minutos: m,
        banda: banda.clave,
      })
    }
  }

  const puntuales = porBanda.puntual
  const impuntuales = porBanda.leve + porBanda.tardanza + porBanda.importante + porBanda.grave
  const evaluadas = puntuales + impuntuales

  return {
    puntuales, impuntuales, sinDato, evaluadas, porBanda,
    promedioTarde: impuntuales > 0 ? Math.round(sumaTarde / impuntuales) : null,
    maximo,
    // Piso en 0: alguien con más penalización que jornadas no baja de cero, y
    // un número negativo no significaría nada.
    nota: evaluadas > 0
      ? Math.round(Math.max(0, 10 * (1 - penalizacion / evaluadas)) * 100) / 100
      : null,
    tardanzas: tardanzas.sort((a, b) => b.minutos - a.minutos),
  }
}

// ── Horarios posiblemente mal cargados ──────────────────────────────────────

export interface PatronHorario {
  objetivo: string
  horaInicio: string
  entradas: number
  personas: number
  porcentajeTarde: number
  promedioTarde: number
}

/** Un patrón necesita repetirse, con más de una persona, y con demora real. */
export const UMBRAL_PATRON = { entradas: 5, personas: 2, porcentaje: 70, promedio: 10 }

/**
 * Puestos donde la tardanza parece del horario y no de las personas.
 *
 * Se le pasan TODAS las jornadas del período, no las de una persona: si sólo
 * ve las de un vigilador no puede saber si los demás también llegan tarde ahí,
 * que es justamente lo que distingue un horario mal cargado de una persona
 * impuntual.
 *
 * NO neutraliza ninguna impuntualidad: es una advertencia para que alguien
 * revise la programación. Si el horario estaba mal, se corrige por el mecanismo
 * de siempre y el indicador pasa a usar el dato corregido — que es el que ya
 * lee, porque `entrada` viene de la hora reconocida.
 */
export function patronesDeHorarioSospechoso(
  jornadas: JornadaCumplimiento[],
  umbral = UMBRAL_PATRON,
): PatronHorario[] {
  const grupos = new Map<string, { obj: string; ini: string; ms: number[]; personas: Set<string> }>()

  for (const j of jornadas) {
    const m = minutosDeDemora(j)
    if (m === null || !j.objetivo || !j.horaInicioProg) continue
    const clave = `${j.objetivo}@${j.horaInicioProg}`
    const g = grupos.get(clave) ?? {
      obj: j.objetivo, ini: j.horaInicioProg, ms: [], personas: new Set<string>(),
    }
    g.ms.push(m)
    // Sin empleadoId no se cuenta: es preferible no levantar la advertencia a
    // levantarla contando jornadas como si fueran personas. Eso decía
    // "20 entradas de 20 vigiladores" sobre una sola persona.
    if (j.empleadoId) g.personas.add(String(j.empleadoId))
    grupos.set(clave, g)
  }

  const out: PatronHorario[] = []
  grupos.forEach(g => {
    const tarde = g.ms.filter(m => m > 0)
    if (g.ms.length < umbral.entradas || g.personas.size < umbral.personas) return
    const pct = Math.round((100 * tarde.length) / g.ms.length)
    if (pct < umbral.porcentaje || tarde.length === 0) return
    const prom = Math.round(tarde.reduce((s, m) => s + m, 0) / tarde.length)
    if (prom < umbral.promedio) return
    out.push({
      objetivo: g.obj, horaInicio: g.ini, entradas: g.ms.length,
      personas: g.personas.size, porcentajeTarde: pct, promedioTarde: prom,
    })
  })

  return out.sort((a, b) => b.promedioTarde - a.promedioTarde)
}

// ── Las siete dimensiones ───────────────────────────────────────────────────

export const DIMENSIONES = [
  'asistencia', 'puntualidad', 'procedimiento',
  'rondas', 'uniforme', 'libro_guardia', 'evidencias',
] as const
export type ClaveDimension = typeof DIMENSIONES[number]

export const ETIQUETA_DIMENSION: Record<ClaveDimension, string> = {
  asistencia:    'Asistencia',
  puntualidad:   'Puntualidad',
  procedimiento: 'Procedimiento / uso de la app',
  rondas:        'Rondas',
  uniforme:      'Uniforme',
  libro_guardia: 'Libro de guardia',
  evidencias:    'Calidad de evidencias',
}

/**
 * `puntuable`     entra al promedio con su peso.
 * `en_validacion` tiene nota y se muestra, pero NO entra al promedio. O bien su
 *                 peso es cero, o bien su universo quedó recortado por
 *                 exclusiones que nadie pudo justificar.
 * `no_aplica`     la persona no tuvo ese requerimiento. No le falta nada.
 * `sin_datos`     no hay ni siquiera con qué describirla en este período.
 */
export type EstadoDimension = 'puntuable' | 'en_validacion' | 'no_aplica' | 'sin_datos'

/**
 * Los pesos de HOY.
 *
 * Sólo pesan las dos dimensiones auditadas contra agosto 2026. Las otras cinco
 * están en cero a propósito y subirlas es cambiar este objeto —una vez que la
 * auditoría correspondiente exista—, no reescribir el módulo.
 *
 * Con Puntualidad en 0, el número que sale de acá es EXACTAMENTE el que ya está
 * en producción. Eso está cubierto por un test: encender una dimensión tiene
 * que ser una decisión, nunca un efecto colateral.
 */
/**
 * Peso de Puntualidad, elegido sobre la simulacion de agosto 2026.
 *
 * Con 40 la normalizacion queda Asistencia 16,7 %, Puntualidad 33,3 % y
 * Procedimiento 50 %. Antes Procedimiento era el 75 % del numero, y eso hacia
 * que usar mal la app dominara el resultado de alguien que vino todos los dias
 * y llego puntual: exactamente lo que este indicador no debe afirmar.
 *
 * Los pesos de Asistencia y Procedimiento NO se tocaron; el rebalanceo sale de
 * agregar la dimension nueva al denominador.
 */
export const PESO_PUNTUALIDAD = 40

export const PESOS: Record<ClaveDimension, number> = {
  asistencia:    PESO_ASISTENCIA,
  procedimiento: PESO_PROCEDIMIENTO,
  // Mide contra el horario programado, que es la referencia mientras nadie lo
  // corrija. Un horario mal cargado se hace VISIBLE por patronesDeHorarioSospechoso,
  // no se esconde con una excepcion automatica.
  puntualidad:   PESO_PUNTUALIDAD,
  // Pesa cuando RONDAS-obligaciones-agosto permita contar rondas EXIGIBLES vs
  // CUMPLIDAS por persona, y distinguir lo no atribuible: pausadas, cerradas
  // administrativamente, problemas técnicos, configuración que no correspondía.
  rondas:        0,
  // Las tres de evidencia esperan muestra confiable con revisión humana. Una
  // observación de IA sin confirmar no puede bajar un puntaje.
  uniforme:      0,
  libro_guardia: 0,
  evidencias:    0,
}

/**
 * Lo que las cuatro dimensiones de fuente externa aportan al resultado.
 *
 * Se INYECTAN en vez de consultarse acá a propósito: el X/10 no puede depender
 * de una consulta que puede fallar. Si Rondas no carga, las tres dimensiones
 * que puntúan siguen dando exactamente el mismo número que antes.
 */
export interface AporteDimension {
  nota: number | null
  detalle: string
  /** Tiene nota pero el universo quedó recortado sin justificación. */
  enValidacion?: boolean
  /** No tuvo ese requerimiento. Distinto de "no hay datos". */
  noAplica?: boolean
  faltante?: string | null
}

export type FuentesCumplimiento = Partial<Record<ClaveDimension, AporteDimension>>

export interface Dimension {
  clave: ClaveDimension
  etiqueta: string
  /** 0..10, o null si no hay con qué. */
  nota: number | null
  peso: number
  estado: EstadoDimension
  /** Qué se está mirando, en una línea. Siempre, aunque no puntúe. */
  detalle: string
  /** Por qué falta, cuando no puntúa. */
  faltante?: string
}

export interface ResultadoCumplimiento {
  puntaje: number | null
  estado: EstadoDesempeno
  dimensiones: Dimension[]
  motivos: MotivoDesempeno[]
  /** El resultado crudo del núcleo, para lo que ya lo consume. */
  base: ResultadoDesempeno
  puntualidad: ResumenPuntualidad
}

const pluralJornadas = (n: number) => `${n} ${n === 1 ? 'jornada' : 'jornadas'}`

/**
 * El texto de cada dimensión que todavía no puntúa.
 *
 * Dice qué falta, no "no disponible": alguien tiene que poder leer esto y saber
 * qué hacer para habilitarla.
 */
const FALTANTE: Partial<Record<ClaveDimension, string>> = {
  rondas: 'Quedan ventanas pausadas sin causa registrada. Una pausa sin causa '
    + 'puede haber sido un problema técnico o la ronda que no se hacía, y las dos '
    + 'se leen igual: el número describe un universo recortado a ciegas.',
  uniforme: 'Quedan observaciones de la IA sin revisar. Hasta que una persona se '
    + 'pronuncie no son faltas, y la nota sólo describe lo que alguien miró.',
  libro_guardia: 'Quedan observaciones de la IA sin revisar. No subir la foto es un '
    + 'hecho de Procedimiento; que el libro esté mal es otra cosa y necesita que '
    + 'una persona lo confirme.',
  evidencias: 'Descriptiva por decisión: mide si la foto se podía leer, no lo que '
    + 'la foto muestra. No corresponde que baje el puntaje de nadie.',
}

// ── Simulación de pesos ─────────────────────────────────────────────────────

/**
 * Combinaciones a comparar sobre datos reales antes de mover un peso.
 *
 * La `actual` es la de producción y está acá para que la comparación tenga
 * línea de base. Las otras dos no son propuestas: son las dos preguntas que hay
 * que poder responder con números —"¿qué pasa si Rondas pesa lo mismo que
 * Asistencia?" y "¿qué pasa si todo lo medible pesa?"— antes de decidir nada.
 *
 * Elegir una por cómo queda la distribución sería fabricar diferencias entre
 * personas. Se elige por si el número que sale se puede sostener frente a la
 * persona que lo recibe.
 */
export const VARIANTES_PESOS: Record<string, Record<ClaveDimension, number>> = {
  actual: {
    asistencia: 20, puntualidad: 40, procedimiento: 60,
    rondas: 0, uniforme: 0, libro_guardia: 0, evidencias: 0,
  },
  rondas_como_asistencia: {
    asistencia: 20, puntualidad: 40, procedimiento: 60,
    rondas: 20, uniforme: 0, libro_guardia: 0, evidencias: 0,
  },
  todo_lo_medible: {
    asistencia: 20, puntualidad: 40, procedimiento: 60,
    rondas: 30, uniforme: 15, libro_guardia: 15, evidencias: 0,
  },
}

/** Cómo se reparte el 100 % con una combinación dada, contando sólo lo puntuable. */
export function normalizacion(
  pesos: Record<ClaveDimension, number>,
  puntuables: ClaveDimension[],
): Record<string, number> {
  const total = puntuables.reduce((s, c) => s + (pesos[c] ?? 0), 0)
  const out: Record<string, number> = {}
  for (const c of puntuables) {
    out[c] = total > 0 ? Math.round((1000 * (pesos[c] ?? 0)) / total) / 10 : 0
  }
  return out
}

/**
 * @param fuentes  Rondas, Uniforme, Libro y Calidad, ya medidas.
 * @param pesos    Se inyectan para poder SIMULAR otra combinación con esta
 *                 misma función. Una simulación que reimplemente el promedio no
 *                 prueba nada sobre el promedio de producción.
 */
export function calcularCumplimiento(
  jornadas: JornadaCumplimiento[],
  fuentes: FuentesCumplimiento = {},
  pesos: Record<ClaveDimension, number> = PESOS,
): ResultadoCumplimiento {
  const base = calcularDesempeno(jornadas)
  const punt = resumirPuntualidad(jornadas)

  const dimension = (
    clave: ClaveDimension, nota: number | null, detalle: string,
    extra: { enValidacion?: boolean; noAplica?: boolean; faltante?: string | null } = {},
  ): Dimension => {
    const peso = pesos[clave] ?? 0
    const hayDato = nota !== null
    // Una dimensión en validación NO puntúa aunque tenga peso. La validación es
    // sobre el universo, no sobre la importancia: si no se sabe qué se excluyó,
    // el número no se puede sostener y ningún peso lo arregla.
    const estado: EstadoDimension =
      peso > 0 && hayDato && !extra.enValidacion ? 'puntuable'
      : hayDato                                  ? 'en_validacion'
      : extra.noAplica                           ? 'no_aplica'
      :                                            'sin_datos'
    return {
      clave, etiqueta: ETIQUETA_DIMENSION[clave], nota, peso, estado, detalle,
      ...(estado === 'puntuable'
        ? {}
        : { faltante: extra.faltante ?? FALTANTE[clave] }),
    }
  }

  const aporte = (clave: ClaveDimension, porDefecto: string): Dimension => {
    const f = fuentes[clave]
    if (!f) return dimension(clave, null, porDefecto)
    return dimension(clave, f.nota, f.detalle, {
      enValidacion: f.enValidacion,
      noAplica: f.noAplica,
      faltante: f.faltante,
    })
  }

  const dimensiones: Dimension[] = [
    dimension('asistencia', base.asistencia,
      base.observacionesValidas > 0
        ? `${base.ausencias} ausencia(s) confirmada(s) sobre ${pluralJornadas(base.observacionesValidas)}`
        : 'Sin jornadas evaluables en el período'),
    dimension('puntualidad', punt.nota, detallePuntualidad(punt)),
    dimension('procedimiento', base.procedimiento,
      base.observacionesValidas > 0
        ? `${base.incidencias.sin_registro_propio + base.incidencias.entrada_sin_salida} incidencia(s) sobre ${pluralJornadas(base.observacionesValidas)}`
        : 'Sin jornadas evaluables en el período'),
    aporte('rondas', 'Pendiente de medir rondas exigibles contra cumplidas'),
    aporte('uniforme', 'Pendiente de muestra con revisión humana'),
    aporte('libro_guardia', 'Pendiente de muestra con revisión humana'),
    aporte('evidencias', 'Pendiente de definir el hecho primario'),
  ]

  // El promedio sale SOLO de las puntuables. Una dimensión en validación no
  // entra ni con nota ni con cero: entrar con cero sería peor que no estar.
  const puntuables = dimensiones.filter(d => d.estado === 'puntuable')
  const pesoTotal = puntuables.reduce((s, d) => s + d.peso, 0)

  // `base.puntaje` ya aplicó el mínimo de muestra. Si el núcleo dijo que no
  // alcanza, acá tampoco alcanza: la regla de suficiencia es una sola.
  const puntaje = base.puntaje === null || pesoTotal === 0
    ? null
    : Math.round(
        (puntuables.reduce((s, d) => s + (d.nota ?? 0) * d.peso, 0) / pesoTotal) * 100,
      ) / 100

  return {
    puntaje,
    estado: estadoDePuntaje(puntaje),
    dimensiones,
    motivos: motivosDeCumplimiento(base, punt),
    base,
    puntualidad: punt,
  }
}

/**
 * Las principales incidencias, en texto rastreable a hechos.
 *
 * Los motivos de las dimensiones que NO puntúan se muestran igual —son
 * información útil— pero se dicen sin acusar: "ingresos posteriores al horario"
 * describe lo que pasó; "llegó tarde" ya es un juicio, y todavía no sabemos si
 * el horario programado era el correcto.
 */
export function motivosDeCumplimiento(
  base: ResultadoDesempeno, punt: ResumenPuntualidad,
): MotivoDesempeno[] {
  const motivos = [...base.motivos]
  if (punt.impuntuales > 0) {
    motivos.push({
      tipo: 'ausencia',
      cantidad: punt.impuntuales,
      texto: `${punt.impuntuales} ${punt.impuntuales === 1 ? 'ingreso posterior' : 'ingresos posteriores'} al horario programado`,
    })
  }
  return motivos
}

/** "9,6 / 10 · Excelente" o "— · Datos insuficientes". Para la tabla. */
export function resumenCorto(r: { puntaje: number | null; estado: EstadoDesempeno }): string {
  const etiqueta = ETIQUETA_ESTADO[r.estado]
  if (r.puntaje === null) return `— · ${etiqueta}`
  return `${r.puntaje.toFixed(1).replace('.', ',')} / 10 · ${etiqueta}`
}

/** "19 de 23 puntuales · 2 de 1–5 min · 1 de 6–15 · demora promedio 6 min". */
export function detallePuntualidad(p: ResumenPuntualidad): string {
  if (p.evaluadas === 0) return 'Sin ingresos propios que se puedan evaluar'
  const partes = [`${p.puntuales} de ${p.evaluadas} puntuales`]
  for (const b of BANDAS_PUNTUALIDAD) {
    if (b.clave === 'puntual') continue
    const n = p.porBanda[b.clave]
    if (n > 0) partes.push(`${n} ${b.etiqueta.toLowerCase()}`)
  }
  if (p.promedioTarde !== null) partes.push(`demora promedio ${p.promedioTarde} min`)
  if (p.maximo !== null && p.maximo > 0) partes.push(`máxima ${p.maximo} min`)
  if (p.sinDato > 0) partes.push(`${p.sinDato} sin fichaje propio, no se juzga`)
  return partes.join(' · ')
}
