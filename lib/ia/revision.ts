// Qué significa cada estado de revisión de una foto analizada por la IA.
//
// Vive acá y no repartido por las pantallas porque de esta distinción depende
// algo que no se puede arreglar después: qué entra al aprendizaje de la IA.
//
//   PENDIENTE   nadie la miró todavía. Es trabajo abierto.
//   CORRECTO    una persona dijo que la observación de la IA era cierta.
//   INCORRECTO  una persona dijo que la IA se equivocó.
//   SANEADO     cierre administrativo. NADIE la miró.
//
// SANEADO existe porque el backlog anterior al criterio vigente no se podía
// cerrar con ninguna de las otras dos sin mentir: CORRECTO habría inventado un
// incumplimiento del vigilador, e INCORRECTO habría afirmado que la foto estaba
// bien. Las dos, además, habrían contaminado la medición de precisión —que es
// exactamente lo que se usa para mejorar la IA— con juicios que nadie emitió.

export type EstadoRevisionIA = 'PENDIENTE' | 'CORRECTO' | 'INCORRECTO' | 'SANEADO'

export const MOTIVO_SANEAMIENTO_IA =
  'Saneamiento de observaciones IA anteriores al nuevo criterio de revisión. ' +
  'No implica validación de la evidencia ni incumplimiento del vigilador.'

/** Sigue esperando que una persona decida. */
export function esperaRevision(estado?: string | null): boolean {
  return (estado ?? 'PENDIENTE') === 'PENDIENTE'
}

/** Una persona miró la foto y se pronunció. Sólo estas dos. */
export function esDecisionHumana(estado?: string | null): boolean {
  return estado === 'CORRECTO' || estado === 'INCORRECTO'
}

/** Se cerró sin que nadie la mirara. No dice nada de la foto ni de la persona. */
export function esSaneada(estado?: string | null): boolean {
  return estado === 'SANEADO'
}

/**
 * Si esta fila puede usarse para medir o entrenar a la IA.
 *
 * Sólo las decisiones humanas. Contar una saneada como acierto o como error
 * sería enseñarle al sistema con una respuesta que nadie dio, y el número de
 * precisión que salga de ahí no significaría nada.
 */
export function cuentaParaAprendizajeIA(estado?: string | null): boolean {
  return esDecisionHumana(estado)
}

/** Ya no es trabajo pendiente de nadie, la haya mirado alguien o no. */
export function salioDeLaBandeja(estado?: string | null): boolean {
  return !esperaRevision(estado)
}

export const ETIQUETA_REVISION_IA: Record<string, string> = {
  PENDIENTE:  'PENDIENTE DE REVISIÓN',
  CORRECTO:   'REVISADO: CORRECTO',
  INCORRECTO: 'REVISADO: INCORRECTO',
  SANEADO:    'CERRADA ADMINISTRATIVAMENTE',
}

export const AYUDA_REVISION_IA: Record<string, string> = {
  PENDIENTE:  'Todavía ninguna persona la revisó',
  CORRECTO:   'Decisión de una persona. Es la que vale.',
  INCORRECTO: 'Decisión de una persona. Es la que vale.',
  SANEADO:    'Cierre administrativo por quedar fuera del criterio vigente. '
            + 'Nadie la revisó: no afirma nada sobre la evidencia ni sobre el vigilador, '
            + 'y no entra en las métricas de precisión de la IA.',
}
