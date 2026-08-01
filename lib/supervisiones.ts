// ── Vigencia de supervisiones · definición ÚNICA ─────────────────────────────
//
// Antes este cálculo estaba repetido en cuatro lugares (Dashboard/Panel de
// Supervisiones, ranking de supervisores, Inicio Supervisor y el cron de push),
// cada uno con su propio default y su propio umbral. Dos de esas copias además
// leían fuentes de datos distintas y de distinto tamaño, así que un mismo
// objetivo podía figurar vencido en un panel y vigente en otro.
//
// REGLA: la vigencia depende SOLO de `ultima_supervision + frecuencia_supervision_horas`
// contra `now()`. No interviene el mes calendario, ni el rango cargado en
// pantalla, ni ninguna otra ventana temporal. Empezar un mes nuevo NO reinicia
// el estado de nada.

export type EstadoSupervision = 'nunca' | 'vigente' | 'vencida'

// Frecuencia asumida cuando el objetivo no define una propia.
export const FRECUENCIA_SUPERVISION_DEFECTO_HORAS = 24

// Un objetivo entra en "por vencer" cuando le queda este porcentaje o menos de
// su ciclo. Es un aviso anticipado para el push y para los filtros de agenda:
// NO es un estado de vigencia y nunca reemplaza a los tres de arriba.
export const SUPERVISION_PROXIMA_PORCENTAJE = 0.25

const MS_HORA = 60 * 60 * 1000

export type ObjetivoSupervisable = {
  id: string
  frecuencia_supervision_horas?: number | null
}

export const frecuenciaSupervision = (objetivo: ObjetivoSupervisable): number =>
  objetivo.frecuencia_supervision_horas || FRECUENCIA_SUPERVISION_DEFECTO_HORAS

/**
 * Estado de vigencia de un objetivo.
 *
 * `nunca`   — no existe ninguna supervisión registrada. No es lo mismo que
 *             vencida: nunca hubo un ciclo que vencer.
 * `vigente` — la última supervisión sigue dentro de la frecuencia pactada.
 * `vencida` — pasó `ultima + frecuencia` y todavía no se supervisó de nuevo.
 */
export function estadoSupervision(
  ultimaIso: string | null | undefined,
  frecuenciaHoras: number,
  ahoraMs: number = Date.now(),
): EstadoSupervision {
  if (!ultimaIso) return 'nunca'

  const ultimaMs = new Date(ultimaIso).getTime()
  // Fecha ilegible: se trata como sin supervisar en vez de darla por vigente.
  if (!Number.isFinite(ultimaMs)) return 'nunca'

  const vencimientoMs = ultimaMs + frecuenciaHoras * MS_HORA
  return ahoraMs > vencimientoMs ? 'vencida' : 'vigente'
}

export const estadoSupervisionObjetivo = (
  objetivo: ObjetivoSupervisable,
  ultimaIso: string | null | undefined,
  ahoraMs: number = Date.now(),
): EstadoSupervision =>
  estadoSupervision(ultimaIso, frecuenciaSupervision(objetivo), ahoraMs)

// Requiere atención = nunca supervisado o vencido. Es lo que cuentan los
// tableros bajo el rótulo "vencidas".
export const supervisionRequiereAtencion = (estado: EstadoSupervision): boolean =>
  estado !== 'vigente'

export const objetivoSupervisionVencida = (
  objetivo: ObjetivoSupervisable,
  ultimaIso: string | null | undefined,
  ahoraMs: number = Date.now(),
): boolean =>
  supervisionRequiereAtencion(estadoSupervisionObjetivo(objetivo, ultimaIso, ahoraMs))

/**
 * Horas que faltan para el vencimiento. Negativo = ya vencido.
 * `null` cuando no hay supervisión previa: no hay ciclo del cual contar.
 */
export function horasParaVencimiento(
  ultimaIso: string | null | undefined,
  frecuenciaHoras: number,
  ahoraMs: number = Date.now(),
): number | null {
  if (!ultimaIso) return null

  const ultimaMs = new Date(ultimaIso).getTime()
  if (!Number.isFinite(ultimaMs)) return null

  return frecuenciaHoras - (ahoraMs - ultimaMs) / MS_HORA
}

// Aviso anticipado, sobre un objetivo TODAVÍA vigente. Un vencido no es
// "próximo a vencer": ya venció.
export function supervisionProximaAVencer(
  ultimaIso: string | null | undefined,
  frecuenciaHoras: number,
  ahoraMs: number = Date.now(),
): boolean {
  if (estadoSupervision(ultimaIso, frecuenciaHoras, ahoraMs) !== 'vigente') return false

  const restantes = horasParaVencimiento(ultimaIso, frecuenciaHoras, ahoraMs)
  return restantes !== null && restantes <= frecuenciaHoras * SUPERVISION_PROXIMA_PORCENTAJE
}

export const ETIQUETA_ESTADO_SUPERVISION: Record<EstadoSupervision, string> = {
  nunca:   'Nunca supervisado',
  vigente: 'Vigente',
  vencida: 'Vencida',
}

export const COLOR_ESTADO_SUPERVISION: Record<EstadoSupervision, string> = {
  nunca:   '#94a3b8',
  vigente: '#22c55e',
  vencida: '#ef4444',
}

/**
 * Índice objetivo_id → ISO de la última supervisión.
 *
 * Espera la lista COMPLETA de supervisiones disponibles, sin recortar por mes
 * ni por rango de pantalla: recortarla es exactamente lo que hacía que un
 * objetivo supervisado hace tiempo reapareciera como "nunca supervisado".
 */
export function indexarUltimaSupervision(
  supervisiones: Array<{ objetivo_id?: string | null; created_at?: string | null }>,
): Map<string, string> {
  const indice = new Map<string, string>()

  for (const s of supervisiones) {
    if (!s.objetivo_id || !s.created_at) continue

    const previa = indice.get(s.objetivo_id)
    if (!previa || new Date(s.created_at).getTime() > new Date(previa).getTime()) {
      indice.set(s.objetivo_id, s.created_at)
    }
  }

  return indice
}
