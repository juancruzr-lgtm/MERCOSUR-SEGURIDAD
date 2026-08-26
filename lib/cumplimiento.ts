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
 * El vigilador debe presentarse 15 minutos antes para prepararse y anoticiarse
 * de las novedades. La ventana correcta es [inicio − 15, inicio].
 *
 * Que el sistema TÉCNICAMENTE permita fichar unos minutos más tarde no vuelve
 * puntual a ese ingreso: son dos cosas distintas y viven en lugares distintos.
 * La tolerancia de fichaje pertenece a la operación y a la liquidación, y este
 * módulo no la toca ni la lee.
 */
export const MINUTOS_PRESENTACION_PREVIA = 15

export type HechoPuntualidad = 'puntual' | 'impuntual' | 'sin_dato'

function aMinutos(hora?: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hora ?? ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

export interface JornadaCumplimiento extends JornadaDesempeno {
  /** Horario programado del turno. */
  horaInicioProg?: string | null
  horaFinProg?: string | null
  /** Hora de entrada efectivamente registrada. */
  entrada?: string | null
}

/**
 * Puntualidad de UNA jornada.
 *
 * `sin_dato` cuando el vigilador no registró su propia entrada. Es deliberado:
 * esa jornada ya cuenta como incidencia de Procedimiento, y llamarla además
 * "impuntual" sería castigar dos veces el mismo hecho. Además sería inventar:
 * si nadie fichó, no se sabe a qué hora llegó.
 */
export function hechoDePuntualidad(j: JornadaCumplimiento): HechoPuntualidad {
  if (!j.tieneRegistro || j.esAusencia) return 'sin_dato'
  if (!j.entradaPropia) return 'sin_dato'

  const inicio = aMinutos(j.horaInicioProg)
  const entradaCruda = aMinutos(j.entrada)
  if (inicio === null || entradaCruda === null) return 'sin_dato'

  // Nocturno: si el turno arranca a las 22:00 y la entrada dice 21:50, llegó
  // temprano; si dice 01:00, llegó al día siguiente. El corte se hace lejos del
  // inicio para no confundir una llegada anticipada con una tardía de 22 horas.
  const fin = aMinutos(j.horaFinProg)
  const nocturno = fin !== null && fin <= inicio
  let entrada = entradaCruda
  if (nocturno && entradaCruda < inicio - 720) entrada += 1440

  return entrada <= inicio ? 'puntual' : 'impuntual'
}

export interface ResumenPuntualidad {
  puntuales: number
  impuntuales: number
  sinDato: number
  /** Sobre las jornadas donde SÍ se puede juzgar. */
  evaluadas: number
  nota: number | null
}

export function resumirPuntualidad(jornadas: JornadaCumplimiento[]): ResumenPuntualidad {
  let puntuales = 0
  let impuntuales = 0
  let sinDato = 0
  for (const j of jornadas) {
    const h = hechoDePuntualidad(j)
    if (h === 'puntual') puntuales += 1
    else if (h === 'impuntual') impuntuales += 1
    else sinDato += 1
  }
  const evaluadas = puntuales + impuntuales
  return {
    puntuales, impuntuales, sinDato, evaluadas,
    nota: evaluadas > 0 ? Math.round((10 * puntuales / evaluadas) * 100) / 100 : null,
  }
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
 * `en_validacion` se calcula y se muestra, pero con peso 0: falta la auditoría
 *                 que diga que el dato es atribuible a la persona.
 * `sin_datos`     no hay ni siquiera con qué describirla en este período.
 */
export type EstadoDimension = 'puntuable' | 'en_validacion' | 'sin_datos'

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
export const PESOS: Record<ClaveDimension, number> = {
  asistencia:    PESO_ASISTENCIA,
  procedimiento: PESO_PROCEDIMIENTO,
  // Calculada y testeada. Pesa cuando PUNT-1 y PUNT-2 confirmen que los
  // horarios programados representan la operación real: una programación
  // cargada con varias horas de desvío convertiría un error nuestro en mala
  // conducta del vigilador.
  puntualidad:   0,
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
  puntualidad: 'Falta la auditoría de horarios programados (PUNT-1 y PUNT-2). '
    + 'Sin ella, una programación mal cargada se leería como impuntualidad de la persona.',
  rondas: 'Falta contar rondas exigibles contra cumplidas por persona '
    + '(RONDAS-obligaciones-agosto), separando pausadas, cerradas administrativamente '
    + 'y fallas técnicas no atribuibles al vigilador.',
  uniforme: 'Falta muestra con revisión humana. Una observación de la IA sin '
    + 'confirmar no baja el puntaje, y no haber subido la foto es un hecho de '
    + 'Procedimiento, no una afirmación sobre el uniforme.',
  libro_guardia: 'Falta muestra con revisión humana, y distinguir "no subió la foto" '
    + 'de "el libro está mal". No son el mismo problema.',
  evidencias: 'Falta definir el hecho primario cuando una foto no es evaluable: '
    + 'ahí el problema es la evidencia, no lo que la evidencia no pudo mostrar.',
}

export function calcularCumplimiento(jornadas: JornadaCumplimiento[]): ResultadoCumplimiento {
  const base = calcularDesempeno(jornadas)
  const punt = resumirPuntualidad(jornadas)

  const dimension = (
    clave: ClaveDimension, nota: number | null, detalle: string,
  ): Dimension => {
    const peso = PESOS[clave]
    const hayDato = nota !== null
    const estado: EstadoDimension =
      peso > 0 && hayDato ? 'puntuable'
      : hayDato           ? 'en_validacion'
      :                     'sin_datos'
    return {
      clave, etiqueta: ETIQUETA_DIMENSION[clave], nota, peso, estado, detalle,
      ...(estado === 'puntuable' ? {} : { faltante: FALTANTE[clave] }),
    }
  }

  const dimensiones: Dimension[] = [
    dimension('asistencia', base.asistencia,
      base.observacionesValidas > 0
        ? `${base.ausencias} ausencia(s) confirmada(s) sobre ${pluralJornadas(base.observacionesValidas)}`
        : 'Sin jornadas evaluables en el período'),
    dimension('puntualidad', punt.nota,
      punt.evaluadas > 0
        ? `${punt.impuntuales} ingreso(s) posterior(es) al horario sobre ${punt.evaluadas} evaluable(s)`
          + (punt.sinDato > 0 ? ` · ${punt.sinDato} sin fichaje propio, no se juzga` : '')
        : 'Sin ingresos propios que se puedan evaluar'),
    dimension('procedimiento', base.procedimiento,
      base.observacionesValidas > 0
        ? `${base.incidencias.sin_registro_propio + base.incidencias.entrada_sin_salida} incidencia(s) sobre ${pluralJornadas(base.observacionesValidas)}`
        : 'Sin jornadas evaluables en el período'),
    dimension('rondas', null, 'Pendiente de medir rondas exigibles contra cumplidas'),
    dimension('uniforme', null, 'Pendiente de muestra con revisión humana'),
    dimension('libro_guardia', null, 'Pendiente de muestra con revisión humana'),
    dimension('evidencias', null, 'Pendiente de definir el hecho primario'),
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
