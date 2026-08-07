/**
 * lib/calendario-mes.ts
 *
 * Armado del calendario mensual que se usa para elegir días a mano, en vez
 * de escribir "desde / hasta / patrón / excluir fechas separadas por coma".
 *
 * PURO: solo calcula la grilla de semanas y qué fechas caen en cada atajo.
 * Quién puede seleccionarse y qué se hace con la selección lo deciden las
 * pantallas que lo usan.
 *
 * Reutiliza fechasEnRango y diasDelPatron de lib/asignacion-mensual: los
 * atajos "Lunes a viernes" y "Fin de semana" son exactamente el mismo
 * criterio que ya aplican la asignación por rango y la generación de turnos.
 */

import { diasDelPatron, fechasEnRango } from '@/lib/asignacion-mensual'
import type { PatronDias } from '@/lib/asignacion-mensual'

/** Encabezados de la grilla, empezando en lunes (como se lee un calendario acá). */
export const ENCABEZADOS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Día de la semana 1..7 con lunes = 1. */
const dow1a7 = (fecha: string): number => {
  const [a, m, d] = fecha.split('-').map(Number)
  const x = new Date(a, m - 1, d).getDay()
  return x === 0 ? 7 : x
}

/** Primera y última fecha del mes 'YYYY-MM'. */
export function limitesDelMes(mes: string): { desde: string; hasta: string } {
  const [anio, num] = mes.split('-').map(Number)
  const ultimo = new Date(anio, num, 0).getDate()
  return { desde: `${mes}-01`, hasta: `${mes}-${pad2(ultimo)}` }
}

/** Todas las fechas del mes, en orden. */
export function fechasDelMesCompleto(mes: string): string[] {
  const { desde, hasta } = limitesDelMes(mes)
  return fechasEnRango(desde, hasta)
}

/**
 * El mes partido en semanas de 7 posiciones, con `null` en los huecos del
 * principio y del final para que cada columna caiga siempre bajo su día.
 */
export function semanasDelMes(mes: string): (string | null)[][] {
  const fechas = fechasDelMesCompleto(mes)
  if (fechas.length === 0) return []

  const semanas: (string | null)[][] = []
  let semana: (string | null)[] = Array(dow1a7(fechas[0]) - 1).fill(null)

  for (const fecha of fechas) {
    semana.push(fecha)
    if (semana.length === 7) { semanas.push(semana); semana = [] }
  }
  if (semana.length > 0) {
    while (semana.length < 7) semana.push(null)
    semanas.push(semana)
  }
  return semanas
}

/** Fechas del mes que entran en un atajo, filtradas por las que se pueden elegir. */
export function fechasDeAtajo(
  mes: string,
  patron: PatronDias,
  sePuedeElegir: (fecha: string) => boolean = () => true,
): string[] {
  const enPatron = diasDelPatron(patron)
  return fechasDelMesCompleto(mes).filter(f => enPatron(f) && sePuedeElegir(f))
}

/**
 * Rango que cubre la selección. Las funciones que planifican (generación y
 * asignación) siguen recibiendo desde/hasta + patrón 'seleccion': esto evita
 * duplicar su lógica solo porque cambió la forma de elegir los días.
 */
export function rangoDeSeleccion(fechas: Iterable<string>): { desde: string; hasta: string } | null {
  const ordenadas = [...fechas].sort()
  if (ordenadas.length === 0) return null
  return { desde: ordenadas[0], hasta: ordenadas[ordenadas.length - 1] }
}
