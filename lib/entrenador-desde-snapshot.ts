/**
 * lib/entrenador-desde-snapshot.ts
 *
 * El Entrenador Operativo, alimentado por la evaluación publicada.
 *
 * ── Por qué no hay un motor nuevo ────────────────────────────────────────────
 * Los textos accionables ya los produce `lib/balance-mensual.ts` y viajan
 * dentro del snapshot, en `balance.bloques[].recomendacion`. La severidad ya la
 * decide `lib/entrenador-operativo.ts` con umbrales acordados. Este módulo sólo
 * ordena esas dos cosas y elige qué decir cuando no hay nada que corregir.
 *
 * Un segundo motor que volviera a redactar los mensajes podría contradecir al
 * primero: el vigilador leería una cosa en Mi Desempeño y otra distinta en el
 * Entrenador, sobre los mismos hechos.
 *
 * ── Lo que nunca hace ────────────────────────────────────────────────────────
 * No amenaza, no anuncia sanciones, no compara con nadie y no muestra puntajes.
 * Dice qué pasó, con qué números, y qué hacer la próxima vez.
 */

import {
  DIMENSION_DE, PRIORIDAD, severidadDe,
  type ClaveEntrenamiento, type Severidad,
} from '@/lib/entrenador-operativo'
import type { FilaPublicada } from '@/lib/mi-desempeno'

export interface Recomendacion {
  clave: ClaveEntrenamiento
  etiqueta: string
  /** El mensaje accionable, tal como lo lee el vigilador. */
  texto: string
  hechos: string[]
  severidad: Severidad | null
  incidencias: number
  requeridos: number
}

export interface EntrenamientoDelMes {
  periodo: string
  /** Cuando no hay nada que corregir. `null` si sí lo hay. */
  felicitacion: string | null
  /**
   * Cuando el servicio se prestó y lo que falló fue registrarlo.
   *
   * Es la distinción que más importa: quien cubrió su puesto y no fichó no hizo
   * lo mismo que quien no fue. Decirlo evita que un problema de registro se lea
   * como un reproche por el servicio.
   */
  servicioReconocido: string | null
  recomendaciones: Recomendacion[]
  /** Sin muestra no se entrena: no hay hechos suficientes sobre los que hablar. */
  sinMuestra: boolean
}

export const MENSAJE_POSITIVO =
  'Buen trabajo este mes. Cumpliste correctamente los controles evaluados. '
  + 'Mantené esta forma de trabajo.'

export const MENSAJE_SERVICIO_RECONOCIDO =
  'El servicio fue reconocido. Lo que encontramos para mejorar es el registro y '
  + 'uso de la aplicación.'

export const MENSAJE_SIN_MUESTRA =
  'Este mes no hubo jornadas suficientes para sacar conclusiones, así que no hay '
  + 'nada para corregir todavía.'

/** `procedimiento` → `procedimiento_registro`, y así con el resto. */
const CLAVE_POR_DIMENSION = Object.fromEntries(
  Object.entries(DIMENSION_DE).map(([entrenamiento, dimension]) => [dimension, entrenamiento]),
) as Record<string, ClaveEntrenamiento>

const lista = (v: unknown): any[] => (Array.isArray(v) ? v : [])
const objeto = (v: unknown): any => (v && typeof v === 'object' ? (v as any) : {})

export function entrenamientoDeEvaluacion(fila: FilaPublicada): EntrenamientoDelMes {
  const bloques = lista(objeto(fila.balance).bloques)

  const recomendaciones: Recomendacion[] = bloques
    .filter(b => b?.estado === 'mejorar' && typeof b?.recomendacion === 'string')
    .map(b => {
      const incidencias = Number(b.incidencias ?? 0)
      const requeridos = Number(b.requeridos ?? 0)
      return {
        clave: CLAVE_POR_DIMENSION[String(b.clave)] ?? 'procedimiento_registro',
        etiqueta: String(b.etiqueta ?? ''),
        texto: String(b.recomendacion),
        hechos: lista(b.hechos).map(String),
        severidad: severidadDe(incidencias, requeridos),
        incidencias,
        requeridos,
      }
    })
    // El mismo orden que ya usa el Entrenador para decidir qué enseñar primero.
    .sort((a, b) => (PRIORIDAD[a.clave] ?? 99) - (PRIORIDAD[b.clave] ?? 99))

  const sinMuestra = fila.datos_insuficientes || fila.nota_final === null

  // El servicio se dio por prestado si la asistencia salió bien; el registro
  // falló si `procedimiento` está entre lo que hay que mejorar.
  const asistenciaBien = bloques.some(b => b?.clave === 'asistencia' && b?.estado === 'bien')
  const registroFallo = recomendaciones.some(r => r.clave === 'procedimiento_registro')

  return {
    periodo: fila.periodo,
    felicitacion: !sinMuestra && recomendaciones.length === 0 ? MENSAJE_POSITIVO : null,
    servicioReconocido: asistenciaBien && registroFallo ? MENSAJE_SERVICIO_RECONOCIDO : null,
    recomendaciones,
    sinMuestra,
  }
}
