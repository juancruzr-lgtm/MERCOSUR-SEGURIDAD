// lib/ia/rondas.ts
//
// Traduce el resultado técnico de la IA a estados operativos de ronda.
//
// La IA devuelve PRESENTE / AUSENTE / NO_DETERMINABLE por elemento. Eso sirve
// para medir, no para operar: quien mira una ronda necesita saber "¿esto está
// bien o hay que mirarlo?", no leer una matriz.
//
// Lógica pura. No consulta nada, no escribe nada. GPS y foto se evalúan por
// separado a propósito: son controles independientes y la IA no reemplaza al GPS.

export type EstadoPuntoIA =
  | 'OK'                 // cumplido, con foto que coincide o sin foto exigida
  | 'PUNTO_FALTANTE'     // el punto no se registró
  | 'FOTO_FALTANTE'      // se exigía foto y no llegó
  | 'FOTO_NO_COINCIDE'   // hay referencia y la IA dice que no se parece
  | 'FOTO_INSUFICIENTE'  // oscura, tapada, borrosa, vacía: no se puede evaluar
  | 'SIN_REFERENCIA'     // hay foto, pero no hay referencia ni historial con qué comparar
  | 'PENDIENTE'          // hay foto y todavía no se analizó

export const ETIQUETA_ESTADO_PUNTO: Record<EstadoPuntoIA, string> = {
  OK: 'OK',
  PUNTO_FALTANTE: 'Punto no registrado',
  FOTO_FALTANTE: 'Foto requerida faltante',
  FOTO_NO_COINCIDE: 'La foto no coincide',
  FOTO_INSUFICIENTE: 'Foto no evaluable',
  SIN_REFERENCIA: 'Sin referencia ni historial suficiente',
  PENDIENTE: 'Análisis pendiente',
}

/** Cómo se ve la foto en la fila del punto. */
export const ETIQUETA_FOTO: Record<EstadoPuntoIA, string> = {
  OK: 'Coincide',
  PUNTO_FALTANTE: '—',
  FOTO_FALTANTE: 'FALTANTE',
  FOTO_NO_COINCIDE: 'NO COINCIDE',
  FOTO_INSUFICIENTE: 'INSUFICIENTE',
  SIN_REFERENCIA: 'Sin comparación',
  PENDIENTE: 'Pendiente',
}

export type EntradaPunto = {
  /** El punto quedó cumplido según las reglas de la ronda. */
  cumplido: boolean
  /**
   * El vigilador PASÓ por el punto y lo registró, haya dado bien el GPS o no.
   *
   * Es distinto de `cumplido`: un punto registrado a las 21:02, con foto, puede
   * quedar 'incumplido' porque el GPS marcó fuera de radio. Tratar eso como
   * "no registrado" le atribuye al vigilador un problema de configuración —
   * justo lo que este módulo existe para evitar.
   *
   * Si no se informa, se asume `cumplido` para no cambiar el comportamiento de
   * quien todavía no distingue los dos casos.
   */
  registrado?: boolean
  /** La política del punto exigía foto. */
  fotoRequerida: boolean
  /** Llegó la foto. */
  fotoRecibida: boolean
  /**
   * Hay con qué comparar: referencia formal cargada por Administración, o
   * historial propio del punto —fotos confirmadas por una persona—, o las dos.
   * Ver lib/ia/memoria.ts: para el vigilador da igual de dónde salga el patrón.
   */
  tieneReferencia: boolean
  /** null = todavía sin analizar. */
  clasificacion: 'SIN_OBSERVACIONES' | 'REVISAR' | 'EVIDENCIA_INSUFICIENTE' | null
  /** Valor del elemento `coincide_con_referencia` que devolvió la IA. */
  coincide: 'PRESENTE' | 'AUSENTE' | 'NO_DETERMINABLE' | null
  /** false = el GPS quedó fuera del radio. null = sin dato. */
  dentroRadio: boolean | null
}

/**
 * Estado del punto según su FOTO. El GPS va por separado (ver `gpsFueraRadio`):
 * mezclarlos escondería que son dos controles distintos.
 *
 * Precedencia, de más grave a menos:
 *   punto no registrado > foto faltante > no evaluable > no coincide >
 *   sin referencia > pendiente > OK
 *
 * "Sin referencia" NO es una falta: es una limitación de la configuración, no
 * del vigilador. Por eso nunca se traduce como que la foto esté mal.
 */
export function estadoPunto(p: EntradaPunto): EstadoPuntoIA {
  // PUNTO_FALTANTE es "el vigilador no pasó". Un punto registrado pero marcado
  // incumplido por GPS NO es faltante: pasó, sacó la foto y la subió. Ese caso
  // lo reporta `gpsFueraRadio()`, que es un control aparte a propósito.
  if (!(p.registrado ?? p.cumplido)) return 'PUNTO_FALTANTE'
  if (p.fotoRequerida && !p.fotoRecibida) return 'FOTO_FALTANTE'
  if (!p.fotoRecibida) return 'OK'                    // no exigía foto y no la mandó
  if (p.clasificacion === null) return 'PENDIENTE'
  if (p.clasificacion === 'EVIDENCIA_INSUFICIENTE') return 'FOTO_INSUFICIENTE'
  if (!p.tieneReferencia) return 'SIN_REFERENCIA'
  if (p.coincide === 'AUSENTE') return 'FOTO_NO_COINCIDE'
  if (p.coincide === 'NO_DETERMINABLE' || p.coincide === null) return 'SIN_REFERENCIA'
  return 'OK'
}

export function gpsFueraRadio(p: EntradaPunto): boolean {
  return p.dentroRadio === false
}

/** ¿Este punto necesita que una persona lo mire? */
export function requiereRevision(p: EntradaPunto): boolean {
  const e = estadoPunto(p)
  return e === 'FOTO_NO_COINCIDE' || e === 'FOTO_INSUFICIENTE' || gpsFueraRadio(p)
}

// ── Nivel ronda ─────────────────────────────────────────────────────────────

export type EstadoRonda = 'RONDA_OK' | 'RONDA_INCOMPLETA' | 'REVISAR' | 'PENDIENTE'

export const ETIQUETA_ESTADO_RONDA: Record<EstadoRonda, string> = {
  RONDA_OK: 'Ronda OK',
  RONDA_INCOMPLETA: 'Ronda incompleta',
  REVISAR: 'Revisar',
  PENDIENTE: 'Análisis pendiente',
}

export const COLOR_ESTADO_RONDA: Record<EstadoRonda, 'verde' | 'amarillo' | 'rojo' | 'gris'> = {
  RONDA_OK: 'verde',
  RONDA_INCOMPLETA: 'rojo',
  REVISAR: 'amarillo',
  PENDIENTE: 'gris',
}

/**
 * Estado de la ronda entera.
 *
 * Lo incompleto pesa más que lo dudoso: que falte un punto o una foto exigida
 * es un hecho verificable; que una foto no coincida es un juicio de la IA que
 * todavía necesita confirmación humana.
 *
 * Ninguno de estos estados sanciona ni modifica la ronda: es una lectura.
 */
export function estadoRonda(puntos: EntradaPunto[]): EstadoRonda {
  if (puntos.length === 0) return 'PENDIENTE'

  const estados = puntos.map(estadoPunto)
  if (estados.some(e => e === 'PUNTO_FALTANTE' || e === 'FOTO_FALTANTE')) return 'RONDA_INCOMPLETA'
  if (puntos.some(requiereRevision)) return 'REVISAR'
  if (estados.some(e => e === 'PENDIENTE')) return 'PENDIENTE'
  return 'RONDA_OK'
}

export type ResumenRonda = {
  puntosTotales: number
  cumplidos: number
  faltantes: number
  fotosRequeridas: number
  fotosRecibidas: number
  fotosNoCoinciden: number
  fotosInsuficientes: number
  sinReferencia: number
  gpsFueraRadio: number
  pendientes: number
  estado: EstadoRonda
}

export function resumirRonda(puntos: EntradaPunto[]): ResumenRonda {
  const r: ResumenRonda = {
    puntosTotales: puntos.length,
    cumplidos: 0, faltantes: 0,
    fotosRequeridas: 0, fotosRecibidas: 0,
    fotosNoCoinciden: 0, fotosInsuficientes: 0, sinReferencia: 0,
    gpsFueraRadio: 0, pendientes: 0,
    estado: estadoRonda(puntos),
  }

  for (const p of puntos) {
    if (p.cumplido) r.cumplidos++
    // "Faltantes" cuenta puntos por los que el vigilador NO pasó. Un punto
    // registrado que quedó incumplido por GPS no falta: está en gpsFueraRadio.
    // Sumarlo acá haría leer un problema de coordenadas como abandono de ronda.
    if (!(p.registrado ?? p.cumplido)) r.faltantes++
    if (p.fotoRequerida) r.fotosRequeridas++
    if (p.fotoRecibida) r.fotosRecibidas++
    if (gpsFueraRadio(p)) r.gpsFueraRadio++

    switch (estadoPunto(p)) {
      case 'FOTO_NO_COINCIDE': r.fotosNoCoinciden++; break
      case 'FOTO_INSUFICIENTE': r.fotosInsuficientes++; break
      case 'SIN_REFERENCIA': r.sinReferencia++; break
      case 'PENDIENTE': r.pendientes++; break
    }
  }

  return r
}

/** Extrae el veredicto de comparación del JSON que devolvió el modelo. */
export function leerCoincidencia(resultadoJson: unknown): EntradaPunto['coincide'] {
  const elementos = (resultadoJson as any)?.elementos
  if (!Array.isArray(elementos)) return null
  const el = elementos.find((e: any) => e?.clave === 'coincide_con_referencia')
  const v = el?.valor
  return v === 'PRESENTE' || v === 'AUSENTE' || v === 'NO_DETERMINABLE' ? v : null
}
