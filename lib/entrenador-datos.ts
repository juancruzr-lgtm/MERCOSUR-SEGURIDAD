// Del Cumplimiento Operativo a la entrada del entrenador.
//
// Traduce, no mide. Cada número que sale de acá ya fue calculado por
// lib/cumplimiento y lib/cumplimiento-fuentes; si acá se recalculara algo, el
// mensaje que recibe una persona podría decir un número distinto al que muestra
// la ficha, y no habría forma de saber cuál de los dos es el bueno.

import type { ResultadoCumplimiento } from '@/lib/cumplimiento'
import type { ResumenEvidencia, ResumenRondas } from '@/lib/cumplimiento-fuentes'
import { ensenanzasDeCumplimiento } from '@/lib/entrenador-operativo'
import type { EntradaEntrenador, Ensenanza } from '@/lib/entrenador-operativo'

/**
 * El puesto y el horario donde más llegó tarde.
 *
 * El mensaje de puntualidad tiene que poder decir "tu turno comienza a las
 * 07:00, podés fichar desde las 06:45". Con un horario genérico la instrucción
 * no sirve: la persona no sabe a cuál de sus turnos se refiere.
 *
 * Se elige el par (objetivo, hora) que más se repite entre sus tardanzas. Si
 * hay empate, gana el de mayor demora acumulada — es el que más le conviene
 * corregir primero.
 */
export function turnoMasDemorado(
  tardanzas: ResultadoCumplimiento['puntualidad']['tardanzas'],
): { objetivo: string | null; horaInicio: string | null } {
  const grupos = new Map<string, { objetivo: string | null; hora: string | null; n: number; minutos: number }>()
  for (const t of tardanzas) {
    if (!t.horaInicioProg) continue
    const clave = `${t.objetivo ?? ''}@${t.horaInicioProg}`
    const g = grupos.get(clave) ?? { objetivo: t.objetivo ?? null, hora: t.horaInicioProg, n: 0, minutos: 0 }
    g.n += 1
    g.minutos += t.minutos
    grupos.set(clave, g)
  }
  let mejor: { objetivo: string | null; hora: string | null; n: number; minutos: number } | null = null
  grupos.forEach(g => {
    if (!mejor || g.n > mejor.n || (g.n === mejor.n && g.minutos > mejor.minutos)) mejor = g
  })
  // `strict: false` no estrecha el tipo dentro del forEach; se lee explícito.
  const m = mejor as { objetivo: string | null; hora: string | null } | null
  return { objetivo: m?.objetivo ?? null, horaInicio: m?.hora ?? null }
}

export interface FuentesEntrenador {
  rondas?: ResumenRondas | null
  uniforme?: ResumenEvidencia | null
  libro?: ResumenEvidencia | null
  calidad?: ResumenEvidencia | null
}

export function entradaEntrenador(
  periodo: string,
  r: ResultadoCumplimiento,
  f: FuentesEntrenador = {},
): EntradaEntrenador {
  const base = r.base
  const punt = r.puntualidad
  const dondeLlegaTarde = turnoMasDemorado(punt.tardanzas)

  const sinRegistro = base.incidencias.sin_registro_propio
  const entradaSinSalida = base.incidencias.entrada_sin_salida

  return {
    periodo,
    asistencia: { ausencias: base.ausencias, jornadas: base.observacionesValidas },
    puntualidad: {
      impuntuales: punt.impuntuales,
      evaluadas: punt.evaluadas,
      objetivo: dondeLlegaTarde.objetivo,
      horaInicio: dondeLlegaTarde.horaInicio,
      graves: punt.porBanda.grave,
    },
    procedimiento: {
      incidencias: sinRegistro + entradaSinSalida,
      jornadas: base.observacionesValidas,
      sinRegistro,
      entradaSinSalida,
    },
    // Sólo lo atribuible. Una ronda que quedó fuera del universo —pausada por
    // causa técnica, saneada, sin causa registrada— no genera ninguna
    // instrucción: no hubo nada que la persona pudiera haber hecho distinto.
    ...(f.rondas && f.rondas.medicion.validos > 0
      ? { rondas: { incidencias: f.rondas.medicion.incidencias, requeridos: f.rondas.medicion.validos } }
      : {}),
    ...(f.rondas && f.rondas.pausaCapacitacion > 0
      ? { rondasSinCapacitacion: f.rondas.pausaCapacitacion }
      : {}),
    // Confirmadas por una persona. La IA sola no acusa a nadie ni genera un
    // mensaje que le diga a alguien que se vistió mal.
    ...(f.uniforme && f.uniforme.medicion.validos > 0
      ? { uniforme: { confirmadas: f.uniforme.confirmadas, revisadas: f.uniforme.medicion.validos } }
      : {}),
    ...(f.libro && f.libro.medicion.validos > 0
      ? { libroGuardia: { confirmadas: f.libro.confirmadas, revisadas: f.libro.medicion.validos } }
      : {}),
    ...(f.calidad && f.calidad.total > 0
      ? { calidad: { noEvaluables: f.calidad.noEvaluables, total: f.calidad.total } }
      : {}),
  }
}

/** El atajo que usan las pantallas: del resultado a las enseñanzas. */
export function ensenanzasDeEmpleado(
  periodo: string, r: ResultadoCumplimiento, f: FuentesEntrenador = {},
): Ensenanza[] {
  return ensenanzasDeCumplimiento(entradaEntrenador(periodo, r, f))
}

/**
 * Cuánta gente necesita capacitación en cada cosa.
 *
 * Es el resumen que pide Administración, y sale de las mismas enseñanzas que
 * recibe cada persona: no hay una segunda cuenta de "quién anda mal".
 *
 * ── SIN CONSUMIDOR PRODUCTIVO desde el 31/08/2026 ───────────────────────────
 * La alimentaba el bloque "Necesitan capacitación" del panel de Cumplimiento,
 * que se reemplazó por la clasificación por tipo de devolución: listar seis
 * grupos con treinta nombres decía quién se equivocó pero no servía para
 * gestionar, porque no distinguía a quien no presta el servicio de quien lo
 * presta y no lo registra.
 *
 * Queda acá, con sus tests, porque la agregación por tema sigue siendo válida
 * y puede hacer falta para una vista de capacitación propia. Si en un tiempo
 * nadie la usó, se borra.
 */
export interface GrupoCapacitacion {
  clave: string
  etiqueta: string
  personas: string[]
  patrones: number
}

export function agruparCapacitacion(
  porEmpleado: Array<{ empleadoId: string; empleado: string; ensenanzas: Ensenanza[] }>,
  etiquetas: Record<string, string>,
): GrupoCapacitacion[] {
  const grupos = new Map<string, GrupoCapacitacion>()
  for (const p of porEmpleado) {
    for (const e of p.ensenanzas) {
      // Una incidencia aislada no es una necesidad de capacitación. Meterla acá
      // llenaría la lista de gente que se equivocó una vez.
      if (e.severidad === 'aislada') continue
      const g = grupos.get(e.clave) ?? {
        clave: e.clave, etiqueta: etiquetas[e.clave] ?? e.clave, personas: [], patrones: 0,
      }
      if (g.personas.indexOf(p.empleado) < 0) g.personas.push(p.empleado)
      if (e.severidad === 'patron') g.patrones += 1
      grupos.set(e.clave, g)
    }
  }
  return Array.from(grupos.values())
    .map(g => ({ ...g, personas: g.personas.sort() }))
    .sort((a, b) => b.personas.length - a.personas.length || a.etiqueta.localeCompare(b.etiqueta))
}
