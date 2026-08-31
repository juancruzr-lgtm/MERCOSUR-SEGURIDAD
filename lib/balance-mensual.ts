// El balance del mes que se le puede contar a un vigilador.
//
// ── Qué es y qué NO es ──────────────────────────────────────────────────────
// Es devolución operativa: qué se midió durante el mes, qué salió bien y qué
// conviene hacer distinto. NO es la evaluación administrativa: acá no hay nota,
// ni concepto, ni posición, ni comparación con nadie.
//
// Esa separación no se sostiene con buenas intenciones sino con la forma de la
// entrada: `EntradaBalance` NO recibe la `Evaluacion`. La nota, el tope y las
// faltas críticas no llegan hasta acá, así que no pueden filtrarse a un texto
// ni por descuido ni por un cambio futuro. Si alguien quisiera mostrar la nota
// tendría que cambiar la firma, y eso se ve en un diff.
//
// ── Por qué el Entrenador no alcanzaba ──────────────────────────────────────
// `ensenanzasDeCumplimiento` habla SÓLO de lo que salió mal, y sólo cuando pasa
// un umbral. Quien trabajó bien todo el mes no recibe nada, y quien recibe algo
// lee una lista de reproches sin contexto: no sabe sobre cuánto se lo midió ni
// qué hizo bien. Para un balance mensual hacen falta las dos mitades.
//
// ── Tres grupos, y no uno ───────────────────────────────────────────────────
// Un vigilador puede prestar el servicio impecablemente y usar mal la app. Son
// dos hechos distintos y mezclarlos produce la acusación genérica de "mal
// desempeño", que no le dice a nadie qué cambiar:
//
//   PRESTACIÓN     asistencia, rondas, puntualidad, uniforme, libro
//   USO DE LA APP  registro de ingreso y egreso
//   MEDICIÓN       cuando el problema es la evidencia, no lo que muestra
//
// ── La fuente ───────────────────────────────────────────────────────────────
// Nada se recalcula. Los estados —no_aplica, datos_insuficientes, medible— y
// los conteos salen tal cual de `calcularCumplimiento` y de los resúmenes de
// `cumplimiento-fuentes`, que ya aplican exclusiones, pausas, saneamientos,
// ausencia sin doble castigo y el Modelo C de Rondas.

import type { ClaveDimension, Dimension, ResumenPuntualidad } from '@/lib/cumplimiento'
import { ETIQUETA_DIMENSION } from '@/lib/cumplimiento'
import type { ResultadoDesempeno } from '@/lib/desempeno'
import type { ResumenEvidencia, ResumenRondas } from '@/lib/cumplimiento-fuentes'

export type GrupoBalance = 'servicio' | 'app' | 'medicion'

export type EstadoBloque =
  /** Los datos permiten afirmar que estuvo bien. */
  | 'bien'
  /** Hay algo concreto que corregir. */
  | 'mejorar'
  /** Se midió poco: se dice, no se juzga. */
  | 'sin_datos'
  /** No le correspondía. No es ni mérito ni falta. */
  | 'no_aplica'

export interface BloqueBalance {
  clave: ClaveDimension
  etiqueta: string
  grupo: GrupoBalance
  estado: EstadoBloque
  /** Hechos contados. Nunca una nota, un puesto ni una comparación. */
  hechos: string[]
  /** UNA acción concreta. Sólo cuando hay algo que mejorar. */
  recomendacion?: string
}

export interface BalanceMensual {
  empleadoId: string
  /** `2026-08`. */
  periodo: string
  turnosTrabajados: number
  encabezado: string
  bloques: BloqueBalance[]
  /**
   * Cuando parte del mes no se pudo medir, se dice. Ocultarlo haría que un
   * balance armado sobre tres jornadas se lea como el balance del mes.
   */
  notaDeCobertura: string | null
  /** ¿Hay algo real que contar? */
  corresponde: boolean
  motivoSiNoCorresponde: string | null
}

/** A qué grupo pertenece cada dimensión del modelo. */
export const GRUPO_DE: Record<ClaveDimension, GrupoBalance> = {
  asistencia: 'servicio',
  rondas: 'servicio',
  puntualidad: 'servicio',
  uniforme: 'servicio',
  libro_guardia: 'servicio',
  // "Procedimiento" es el nombre interno; para el vigilador es la app.
  procedimiento: 'app',
  evidencias: 'medicion',
}

export const ETIQUETA_GRUPO: Record<GrupoBalance, string> = {
  servicio: 'Prestación del servicio',
  app: 'Uso de la aplicación',
  medicion: 'Calidad de la medición',
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

export function mesEnPalabras(periodo: string): string {
  const [a, m] = periodo.split('-').map(Number)
  const nombre = MESES[(m || 0) - 1]
  return nombre ? `${nombre} de ${a}` : periodo
}

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios)
const turnos = (n: number) => `${n} ${plural(n, 'turno', 'turnos')}`
const jornadas = (n: number) => `${n} ${plural(n, 'jornada', 'jornadas')}`

/**
 * Lo que hace falta para armar el balance.
 *
 * NO incluye `Evaluacion` a propósito. Ver la nota de arriba: es la garantía
 * estructural de que la nota no puede aparecer en el texto.
 */
export interface EntradaBalance {
  empleadoId: string
  periodo: string
  /** Turnos del mes, del mismo universo que la bandeja. */
  turnosTrabajados: number
  /** Las siete dimensiones, tal cual las devolvió `calcularCumplimiento`. */
  dimensiones: Dimension[]
  base: ResultadoDesempeno
  puntualidad: ResumenPuntualidad
  rondas?: ResumenRondas | null
  uniforme?: ResumenEvidencia | null
  libro?: ResumenEvidencia | null
  calidad?: ResumenEvidencia | null
}

const estadoDim = (dims: Dimension[], clave: ClaveDimension) =>
  dims.find(d => d.clave === clave)?.estado ?? 'sin_datos'

/** Una dimensión que no se pudo medir no se juzga: se explica. */
function bloqueSinJuicio(
  clave: ClaveDimension, etiqueta: string, estado: 'no_aplica' | 'sin_datos', hecho: string,
): BloqueBalance {
  return { clave, etiqueta, grupo: GRUPO_DE[clave], estado, hechos: [hecho] }
}

// ── Asistencia ──────────────────────────────────────────────────────────────

function bloqueAsistencia(e: EntradaBalance): BloqueBalance | null {
  const est = estadoDim(e.dimensiones, 'asistencia')
  const evaluadas = e.base.observacionesValidas
  if (est === 'no_aplica' || evaluadas === 0) return null

  const { ausencias } = e.base
  if (ausencias === 0) {
    return {
      clave: 'asistencia', etiqueta: 'Asistencia', grupo: 'servicio', estado: 'bien',
      hechos: [`Cubriste ${plural(evaluadas, 'la', 'las')} ${jornadas(evaluadas)} ${plural(evaluadas, 'evaluada', 'evaluadas')} del período.`],
    }
  }
  return {
    clave: 'asistencia', etiqueta: 'Asistencia', grupo: 'servicio', estado: 'mejorar',
    hechos: [`Se registraron ${ausencias} ${plural(ausencias, 'ausencia', 'ausencias')} sobre ${jornadas(evaluadas)}.`],
    recomendacion: 'Si no vas a poder cubrir un turno, avisá con la mayor anticipación '
      + 'posible para que se pueda reasignar a tiempo.',
  }
}

// ── Rondas ──────────────────────────────────────────────────────────────────
//
// El bloque que más cuidado necesita. Decirle a alguien "no hiciste las rondas
// de agosto" cuando tuvo obligación en UN turno de veintitrés es falso, y es
// exactamente lo que el Modelo C vino a distinguir. El texto nombra siempre
// sobre cuántos turnos se lo midió.

function bloqueRondas(e: EntradaBalance): BloqueBalance | null {
  const r = e.rondas
  const est = estadoDim(e.dimensiones, 'rondas')

  if (!r || est === 'no_aplica' || r.medicion.requeridos === 0) {
    return bloqueSinJuicio('rondas', 'Rondas', 'no_aplica',
      'En este período no tuviste puestos con rondas asignadas.')
  }

  const atribuibles = r.medicion.validos
  const conObligacion = r.turnosConObligacion ?? 0
  const enCuantos = conObligacion > 0
    ? ` La obligación estuvo repartida en ${conObligacion}`
      + (e.turnosTrabajados > 0
        ? ` de los ${turnos(e.turnosTrabajados)} que trabajaste.`
        : ` ${plural(conObligacion, 'turno', 'turnos')}.`)
    : ''

  if (atribuibles === 0) {
    return bloqueSinJuicio('rondas', 'Rondas', 'sin_datos',
      `Tuviste rondas programadas, pero ninguna quedó en condiciones de evaluarse `
      + `—estuvieron pausadas o se cerraron administrativamente—, así que no hay nada `
      + `que puedas haber hecho distinto.${enCuantos}`)
  }

  const cumplidas = r.cumplidas
  const hechos = [
    `Se evaluaron ${atribuibles} `
    + `${plural(atribuibles, 'ronda exigible', 'rondas exigibles')} y `
    + `${cumplidas === 0 ? 'no se registró ninguna como realizada' : `registraste ${cumplidas} como ${plural(cumplidas, 'realizada', 'realizadas')}`}.`,
  ]

  // Por qué el número evaluado es menor que el programado. Sin esto, alguien
  // con 16 rondas programadas lee "se evaluaron 9" y no sabe qué pasó con las
  // otras 7 — y la respuesta lo favorece: quedaron fuera y no se le cobran.
  const fueraDeEvaluacion = r.medicion.requeridos - atribuibles
  if (fueraDeEvaluacion > 0) {
    hechos.push(
      `Otras ${fueraDeEvaluacion} ${plural(fueraDeEvaluacion, 'quedó', 'quedaron')} fuera de la `
      + 'evaluación porque estuvieron pausadas o se cerraron administrativamente, así que no '
      + `${plural(fueraDeEvaluacion, 'cuenta', 'cuentan')} ni a favor ni en contra.`,
    )
  }

  if (enCuantos) hechos.push(enCuantos.trim())

  const incumplidos = r.turnosConIncumplimiento ?? 0
  const evaluados = r.turnosConAtribuibles ?? 0

  if (cumplidas === atribuibles) {
    return { clave: 'rondas', etiqueta: 'Rondas', grupo: 'servicio', estado: 'bien', hechos }
  }

  if (evaluados > 0) {
    hechos.push(
      incumplidos === 1 && evaluados > 1
        ? `Quedaron rondas sin registrar en 1 de los ${turnos(evaluados)} evaluados.`
        : `Quedaron rondas sin registrar en ${incumplidos} de ${turnos(evaluados)} ${plural(evaluados, 'evaluado', 'evaluados')}.`,
    )
    // El salto de "obligación en 16 turnos" a "7 evaluados" no se explica solo,
    // y quien lo lee tiene derecho a saber por qué se lo mide sobre menos.
    if (conObligacion > evaluados) {
      hechos.push(
        `En ${plural(conObligacion - evaluados, 'el otro turno', `los otros ${conObligacion - evaluados} turnos`)} `
        + `las rondas estuvieron pausadas y no ${plural(conObligacion - evaluados, 'se evaluó', 'se evaluaron')}.`,
      )
    }
  }
  // Una sola jornada es un episodio dentro de la muestra disponible, y decirlo
  // no es atenuar nada: es la diferencia entre un hecho y un hábito.
  if (incumplidos === 1 && evaluados === 1) {
    hechos.push('Fue un episodio dentro de la muestra disponible de este período.')
  }

  return {
    clave: 'rondas', etiqueta: 'Rondas', grupo: 'servicio', estado: 'mejorar', hechos,
    recomendacion: 'Cuando el puesto tenga rondas asignadas, iniciá el recorrido desde la '
      + 'aplicación y registrá todos los puntos indicados antes de que termine cada intervalo.',
  }
}

// ── Puntualidad ─────────────────────────────────────────────────────────────

function bloquePuntualidad(e: EntradaBalance): BloqueBalance | null {
  const p = e.puntualidad
  const est = estadoDim(e.dimensiones, 'puntualidad')

  // Sin ingreso propio no se sabe a qué hora llegó. Suponerlo sería inventar.
  if (p.evaluadas === 0) {
    return bloqueSinJuicio('puntualidad', 'Puntualidad', 'sin_datos',
      'No hubo jornadas con ingreso propio registrado, así que no se pudo evaluar '
      + 'la hora de llegada en este período.')
  }
  if (est === 'no_aplica') return null

  if (p.impuntuales === 0) {
    return {
      clave: 'puntualidad', etiqueta: 'Puntualidad', grupo: 'servicio', estado: 'bien',
      hechos: [`Llegaste dentro del horario en ${plural(p.evaluadas, 'la', 'las')} ${jornadas(p.evaluadas)} ${plural(p.evaluadas, 'evaluada', 'evaluadas')}.`],
    }
  }

  const hechos = [
    `${p.impuntuales} de ${jornadas(p.evaluadas)} ${plural(p.evaluadas, 'evaluada', 'evaluadas')} `
    + `${plural(p.impuntuales, 'tuvo', 'tuvieron')} el ingreso registrado después de la hora de inicio.`,
  ]
  if (p.porBanda.grave > 0) {
    hechos.push(`${p.porBanda.grave} de ${plural(p.porBanda.grave, 'ellas superó', 'ellas superaron')} los 30 minutos.`)
  }

  return {
    clave: 'puntualidad', etiqueta: 'Puntualidad', grupo: 'servicio', estado: 'mejorar', hechos,
    recomendacion: 'Registrá el ingreso al llegar, dentro del horario programado. '
      + 'Podés fichar desde 15 minutos antes del inicio del turno.',
  }
}

// ── Registro en la app ──────────────────────────────────────────────────────

function bloqueRegistro(e: EntradaBalance): BloqueBalance | null {
  const evaluadas = e.base.observacionesValidas
  if (evaluadas === 0) return null

  const sinRegistro = e.base.incidencias.sin_registro_propio
  const entradaSinSalida = e.base.incidencias.entrada_sin_salida
  const total = sinRegistro + entradaSinSalida

  if (total === 0) {
    return {
      clave: 'procedimiento', etiqueta: 'Registro en la app', grupo: 'app', estado: 'bien',
      hechos: [`Tus ingresos y egresos quedaron registrados en ${plural(evaluadas, 'la', 'las')} ${jornadas(evaluadas)} ${plural(evaluadas, 'evaluada', 'evaluadas')}.`],
    }
  }

  const hechos: string[] = []
  if (sinRegistro > 0) {
    hechos.push(`En ${jornadas(sinRegistro)} no quedó registro propio de tu fichaje.`)
  }
  if (entradaSinSalida > 0) {
    hechos.push(`En ${jornadas(entradaSinSalida)} quedó el ingreso registrado pero no la salida.`)
  }
  hechos.push(`Fue sobre ${jornadas(evaluadas)} ${plural(evaluadas, 'evaluada', 'evaluadas')}.`)

  return {
    clave: 'procedimiento', etiqueta: 'Registro en la app', grupo: 'app', estado: 'mejorar', hechos,
    // Se dice explícitamente que esto es la app y no el servicio: alguien puede
    // haber trabajado las doce horas completas y tener esta observación.
    recomendacion: 'Marcá el ingreso al comenzar el turno y la salida al terminarlo. '
      + 'Esto no cuestiona que hayas cubierto el servicio: es el registro lo que faltó.',
  }
}

// ── Uniforme y libro de guardia ─────────────────────────────────────────────
//
// Sólo cuentan las observaciones que una PERSONA confirmó. Lo que la IA marcó y
// nadie miró todavía no es una falta y no se menciona: sería acusar a alguien
// con una sospecha automática.

function bloqueEvidencia(
  e: EntradaBalance, clave: 'uniforme' | 'libro_guardia',
  resumen: ResumenEvidencia | null | undefined,
  recomendacion: string,
): BloqueBalance | null {
  const etiqueta = ETIQUETA_DIMENSION[clave]
  const est = estadoDim(e.dimensiones, clave)

  if (!resumen || resumen.total === 0 || est === 'no_aplica') {
    return bloqueSinJuicio(clave, etiqueta, 'no_aplica',
      `No se registraron controles de ${etiqueta.toLowerCase()} en este período.`)
  }

  const revisadas = resumen.medicion.validos
  if (revisadas === 0 || est === 'datos_insuficientes' || est === 'sin_datos') {
    return bloqueSinJuicio(clave, etiqueta, 'sin_datos',
      `No hubo información suficiente para evaluar ${etiqueta.toLowerCase()} en este período.`)
  }

  if (resumen.confirmadas === 0) {
    return {
      clave, etiqueta, grupo: 'servicio', estado: 'bien',
      hechos: [`Se revisaron ${revisadas} ${plural(revisadas, 'control', 'controles')} y no quedó ninguna observación confirmada.`],
    }
  }

  return {
    clave, etiqueta, grupo: 'servicio', estado: 'mejorar',
    hechos: [`De ${revisadas} ${plural(revisadas, 'control revisado', 'controles revisados')}, `
      + `${resumen.confirmadas} ${plural(resumen.confirmadas, 'quedó confirmado', 'quedaron confirmados')} `
      + 'por una persona del área.'],
    recomendacion,
  }
}

// ── Calidad de la evidencia ─────────────────────────────────────────────────

function bloqueCalidad(e: EntradaBalance): BloqueBalance | null {
  const c = e.calidad
  if (!c || c.total === 0) return null
  if (c.noEvaluables === 0) return null   // nada que decir; no se felicita por defecto

  return {
    clave: 'evidencias', etiqueta: 'Calidad de las fotos', grupo: 'medicion', estado: 'mejorar',
    hechos: [`${c.noEvaluables} de ${c.total} ${plural(c.total, 'foto no pudo', 'fotos no pudieron')} `
      + 'usarse para el control porque no se veía con claridad.'],
    recomendacion: 'Sacá la foto con buena luz, de frente y sin movimiento, para que se pueda '
      + 'ver lo que hay que controlar.',
  }
}

// ── El balance ──────────────────────────────────────────────────────────────

/** Mínimo de jornadas para que el balance describa un mes y no un par de días. */
export const MINIMO_JORNADAS_BALANCE = 3

export function generarBalance(e: EntradaBalance): BalanceMensual {
  const bloques = [
    bloqueAsistencia(e),
    bloqueRondas(e),
    bloquePuntualidad(e),
    bloqueEvidencia(e, 'uniforme', e.uniforme,
      'Presentate con el uniforme completo al iniciar el turno.'),
    bloqueEvidencia(e, 'libro_guardia', e.libro,
      'Completá el libro de guardia con las novedades del turno, con fecha, hora y firma.'),
    bloqueRegistro(e),
    bloqueCalidad(e),
  ].filter((b): b is BloqueBalance => b !== null)

  const evaluadas = e.base.observacionesValidas
  const mes = mesEnPalabras(e.periodo)

  const encabezado = e.turnosTrabajados > 0
    ? `Durante ${mes} trabajaste ${turnos(e.turnosTrabajados)}.`
    : `Balance de ${mes}.`

  // Con muy pocas jornadas no se manda: el balance diría más de lo que sabe.
  if (evaluadas < MINIMO_JORNADAS_BALANCE) {
    return {
      empleadoId: e.empleadoId, periodo: e.periodo, turnosTrabajados: e.turnosTrabajados,
      encabezado, bloques, notaDeCobertura: null, corresponde: false,
      motivoSiNoCorresponde: `Sólo ${jornadas(evaluadas)} ${plural(evaluadas, 'evaluada', 'evaluadas')} `
        + `en el período: por debajo del mínimo de ${MINIMO_JORNADAS_BALANCE}.`,
    }
  }

  const medibles = bloques.filter(b => b.estado === 'bien' || b.estado === 'mejorar')
  if (medibles.length === 0) {
    return {
      empleadoId: e.empleadoId, periodo: e.periodo, turnosTrabajados: e.turnosTrabajados,
      encabezado, bloques, notaDeCobertura: null, corresponde: false,
      motivoSiNoCorresponde: 'Ninguna dimensión quedó en condiciones de evaluarse en el período.',
    }
  }

  // Se dice cuánto del cuadro quedó sin medir. No es una advertencia legal: es
  // para que nadie lea "todo bien" cuando en realidad se miró la mitad.
  const sinMedir = bloques.filter(b => b.estado === 'sin_datos').length
  const notaDeCobertura = sinMedir > 0
    ? `De los aspectos que se controlan, ${sinMedir} no ${plural(sinMedir, 'pudo medirse', 'pudieron medirse')} `
      + 'en este período. Lo que sigue describe únicamente lo que sí se midió.'
    : null

  return {
    empleadoId: e.empleadoId, periodo: e.periodo, turnosTrabajados: e.turnosTrabajados,
    encabezado, bloques, notaDeCobertura, corresponde: true, motivoSiNoCorresponde: null,
  }
}

// ── Del contenido al canal ──────────────────────────────────────────────────
//
// El generador de arriba no sabe si esto va a Mi Legajo, a una push o a
// WhatsApp. Esta función es SÓLO la versión en texto plano; agregar un canal
// nuevo es escribir otra función acá, sin tocar la lógica.

const ORDEN_GRUPOS: GrupoBalance[] = ['servicio', 'app', 'medicion']

export function balanceATexto(b: BalanceMensual): string {
  const partes: string[] = [b.encabezado]
  if (b.notaDeCobertura) partes.push(b.notaDeCobertura)

  for (const grupo of ORDEN_GRUPOS) {
    const delGrupo = b.bloques.filter(x => x.grupo === grupo)
    if (delGrupo.length === 0) continue
    partes.push(`\n${ETIQUETA_GRUPO[grupo].toUpperCase()}`)
    for (const bl of delGrupo) {
      partes.push(`${bl.etiqueta}: ${bl.hechos.join(' ')}`)
    }
  }

  const aMejorar = b.bloques.filter(x => x.recomendacion)
  if (aMejorar.length > 0) {
    partes.push('\nPARA MEJORAR')
    for (const bl of aMejorar) partes.push(`${bl.etiqueta}: ${bl.recomendacion}`)
  }

  return partes.join('\n')
}

/** Resumen de una línea para la vista previa administrativa. */
export function resumenBalance(b: BalanceMensual): {
  bien: number; mejorar: number; sinDatos: number; noAplica: number
} {
  return {
    bien: b.bloques.filter(x => x.estado === 'bien').length,
    mejorar: b.bloques.filter(x => x.estado === 'mejorar').length,
    sinDatos: b.bloques.filter(x => x.estado === 'sin_datos').length,
    noAplica: b.bloques.filter(x => x.estado === 'no_aplica').length,
  }
}
