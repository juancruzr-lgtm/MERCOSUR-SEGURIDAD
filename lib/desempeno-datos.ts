// Datos del indicador de desempeño: de las filas de la bandeja al cálculo.
//
// NO hay una segunda definición de "turno exigible" ni de "qué registro manda".
// Todo sale de construirFilasBandeja, que es la misma fuente que usa Revisión
// de planillas. Este archivo sólo traduce y agrupa.

import { calcularDesempeno, hechoDeJornada } from '@/lib/desempeno'
import type { JornadaDesempeno, ResultadoDesempeno } from '@/lib/desempeno'
import type { FilaBandejaMensual } from '@/lib/bandeja-planillas'

export interface DesempenoEmpleado {
  empleadoId: string
  empleado: string
  /** Objetivos donde trabajó en el período, para poder filtrar. */
  objetivos: string[]
  resultado: ResultadoDesempeno
  /** Las filas que lo formaron, para abrir el hecho detrás de cada motivo. */
  jornadas: FilaBandejaMensual[]
}

/** Una fila de la bandeja vista como jornada del indicador. */
export function jornadaDesdeFila(f: FilaBandejaMensual): JornadaDesempeno {
  return {
    turnoId: f.turnoId,
    // Una ausencia confirmada ES evidencia: alguien verifico que no vino.
    // construirFilasBandeja saca las ausencias de registrosPorTurno, asi que
    // tieneFichaje queda en false; sin este OR, una falta confirmada se contaba
    // como "sin evidencia" y desaparecia del denominador.
    tieneRegistro: f.tieneFichaje || Boolean(f.esAusencia),
    esAusencia: Boolean(f.esAusencia),
    entradaPropia: Boolean(f.entradaPropia),
    salidaPropia: Boolean(f.salidaPropia),
    origenCobertura: f.origenCobertura ?? null,
  }
}

/**
 * Agrupa por empleado y calcula. El orden es OPERATIVO, no un podio: primero lo
 * que necesita una decisión.
 */
export function desempenoPorEmpleado(filas: FilaBandejaMensual[]): DesempenoEmpleado[] {
  const porEmpleado = new Map<string, FilaBandejaMensual[]>()
  for (const f of filas) {
    const arr = porEmpleado.get(f.empleadoId) ?? []
    arr.push(f)
    porEmpleado.set(f.empleadoId, arr)
  }

  const out: DesempenoEmpleado[] = []
  porEmpleado.forEach((jornadas, empleadoId) => {
    const objetivos: string[] = []
    for (const j of jornadas) if (!objetivos.includes(j.objetivo)) objetivos.push(j.objetivo)
    out.push({
      empleadoId,
      empleado: jornadas[0]?.vigilador ?? '—',
      objetivos: objetivos.sort(),
      resultado: calcularDesempeno(jornadas.map(jornadaDesdeFila)),
      jornadas,
    })
  })

  return ordenOperativo(out)
}

/**
 * Primero lo que reclama una decisión, después lo que ya está bien.
 *
 * Deliberadamente NO es de mejor a peor ni al revés: es una bandeja de gestión,
 * no un podio. "Datos insuficientes" va tercero porque también pide acción
 * —falta registrar jornadas— aunque no sea un problema de la persona.
 */
const PESO_ESTADO: Record<string, number> = {
  requiere_intervencion: 0,
  requiere_seguimiento: 1,
  datos_insuficientes: 2,
  correcto: 3,
  excelente: 4,
}

export function ordenOperativo(lista: DesempenoEmpleado[]): DesempenoEmpleado[] {
  return [...lista].sort((a, b) => {
    const pa = PESO_ESTADO[a.resultado.estado] ?? 9
    const pb = PESO_ESTADO[b.resultado.estado] ?? 9
    if (pa !== pb) return pa - pb
    // Dentro del mismo estado, el que tiene más incidencias primero.
    const ia = a.resultado.incidencias.sin_registro_propio + a.resultado.incidencias.entrada_sin_salida
    const ib = b.resultado.incidencias.sin_registro_propio + b.resultado.incidencias.entrada_sin_salida
    if (ia !== ib) return ib - ia
    return a.empleado.localeCompare(b.empleado)
  })
}

export interface ResumenDesempeno {
  total: number
  porEstado: Record<string, number>
}

export function resumirDesempeno(lista: DesempenoEmpleado[]): ResumenDesempeno {
  const porEstado: Record<string, number> = {}
  for (const d of lista) {
    porEstado[d.resultado.estado] = (porEstado[d.resultado.estado] ?? 0) + 1
  }
  return { total: lista.length, porEstado }
}

/** Las jornadas detrás de un motivo, para poder abrir el hecho. */
export function jornadasDelMotivo(
  d: DesempenoEmpleado,
  tipo: 'sin_registro_propio' | 'entrada_sin_salida' | 'ausencia' | 'sin_evidencia',
): FilaBandejaMensual[] {
  // Reusa hechoDeJornada en vez de repetir el orden: tenerlo escrito dos
  // veces ya hizo que una ausencia apareciera como 'sin evidencia' aca mientras
  // el calculo la contaba bien.
  return d.jornadas.filter(f => hechoDeJornada(jornadaDesdeFila(f)) === tipo)
}

// ── Períodos ─────────────────────────────────────────────────────────────────

/**
 * El mes que se abre por defecto: EL EN CURSO.
 *
 * El indicador solo cuenta turnos ya TERMINADOS, asi que el mes en curso es
 * evaluable desde el primer dia: lo que todavia no ocurrio simplemente no
 * entra. Abrir en el mes anterior escondia el mes que a la operacion le
 * importa.
 *
 * Los primeros dias del mes va a decir "datos insuficientes" para casi todos.
 * Eso es correcto y esta explicado en pantalla, con el selector de mes al lado.
 */
export function mesPorDefecto(hoy: Date = new Date()): string {
  return hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0')
}

/** "2026-08" → "agosto de 2026". */
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

export function etiquetaMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) return mes
  return `${MESES[m - 1]} de ${y}`
}

/** Meses seleccionables, del más reciente hacia atrás. */
export function mesesDisponibles(desde: string, hoy: Date = new Date()): string[] {
  const [dy, dm] = desde.split('-').map(Number)
  const out: string[] = []
  let y = hoy.getFullYear()
  let m = hoy.getMonth() + 1
  while (y > dy || (y === dy && m >= dm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m -= 1
    if (m === 0) { m = 12; y -= 1 }
    if (out.length > 60) break
  }
  return out
}
