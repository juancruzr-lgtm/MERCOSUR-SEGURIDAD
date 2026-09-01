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

// ── Qué objetivos reclaman una visita ───────────────────────────────────────
//
// Estar `activo` en la base no significa estar operando. Cinco de los 39
// objetivos activos no tienen un turno desde hace semanas —MUSEO CASTAGNINO
// desde el 17/08, LAROMET RP41 PUESTO 2 desde el 04/08— y el panel los
// reclamaba igual: pedía ir a supervisar lugares donde no hay nadie a quien
// supervisar. Dos de los tres "nunca supervisados" eran de estos.
//
// Un objetivo sin servicio no es un incumplimiento de nadie. Contarlo infla
// "sin supervisar" con trabajo que no existe, y esa es la forma más rápida de
// que la lista deje de leerse.

/**
 * Días hacia atrás sin ningún turno que hacen que un objetivo se considere
 * fuera de operación.
 *
 * Siete. La frecuencia de supervisión más larga configurada es de 72 horas, así
 * que una semana deja pasar holgadamente a los objetivos con servicio
 * intermitente —los que se cubren sólo algunos días— y sólo saca a los que
 * efectivamente dejaron de operar. Con tres días, un objetivo de fin de semana
 * desaparecería los miércoles.
 */
export const DIAS_SIN_OPERACION = 7

/**
 * ¿Este objetivo tiene servicio vigente?
 *
 * `fechas` son las de sus turnos NO anulados, en 'YYYY-MM-DD'. Alcanza con una
 * dentro de la ventana o en el futuro: un objetivo cuyo servicio arranca la
 * semana que viene ya está operando aunque todavía no haya tenido a nadie.
 */
export function objetivoEnOperacion(
  fechas: Array<string | null | undefined>,
  ahora: Date = new Date(),
): boolean {
  const limite = new Date(ahora)
  limite.setDate(limite.getDate() - DIAS_SIN_OPERACION)
  const corte = fechaISO(limite)

  for (const f of fechas) {
    if (!f) continue
    // Comparación de cadenas 'YYYY-MM-DD': ordena igual que las fechas y no
    // arrastra el huso, que en los bordes del día corría un turno de lugar.
    if (f.slice(0, 10) >= corte) return true
  }
  return false
}

function fechaISO(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}
