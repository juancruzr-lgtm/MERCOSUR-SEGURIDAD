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

/**
 * Hace cuánto fue la última supervisión, en palabras.
 *
 * En una lista de vencidos la fecha sola no dice lo urgente que es: "30/08" y
 * "12/06" se leen igual de rápido y son problemas muy distintos. El texto va
 * al lado de la fecha, no en su lugar — la fecha exacta sigue siendo el dato
 * que se copia a un reclamo.
 *
 * Devuelve null si no hay fecha o es ilegible: quien llama decide qué decir,
 * porque "nunca supervisado" no es lo mismo que "hace 0 días".
 */
export function antiguedadSupervision(
  ultimaIso: string | null | undefined,
  ahoraMs: number = Date.now(),
): string | null {
  if (!ultimaIso) return null

  const ultimaMs = new Date(ultimaIso).getTime()
  if (!Number.isFinite(ultimaMs)) return null

  const horas = (ahoraMs - ultimaMs) / MS_HORA
  // Una supervisión con fecha futura (reloj corrido, carga manual adelantada)
  // no se anuncia como "hace -3 h".
  if (horas < 1) return 'hace menos de 1 h'
  if (horas < 24) return `hace ${Math.floor(horas)} h`

  const dias = Math.floor(horas / 24)
  if (dias === 1) return 'hace 1 día'
  if (dias < 30) return `hace ${dias} días`

  const meses = Math.floor(dias / 30)
  return meses === 1 ? 'hace más de 1 mes' : `hace más de ${meses} meses`
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

/**
 * En qué momento de su vida operativa está un objetivo.
 *
 * `objetivoEnOperacion` no alcanzaba: dejaba pasar al objetivo que TODAVÍA NO
 * EMPEZÓ. Uno dado de alta hoy con el primer turno para dentro de dos semanas
 * entraba al universo y salía como "Nunca supervisado" — deuda de supervisión
 * por un servicio que no existe. Nadie puede haber ido a supervisar un lugar
 * donde el servicio arranca el mes que viene.
 *
 *   proximo        tiene turnos, todos futuros, y nunca prestó servicio.
 *                  Se puede mostrar como que viene, pero NO genera vencimiento,
 *                  ni "nunca supervisado", ni deuda.
 *   operando       ya prestó servicio y sigue: turnos recientes, o turnos
 *                  futuros después de haber operado alguna vez.
 *   sin_operacion  operó y dejó de hacerlo: nada en la ventana ni por delante.
 */
export type FaseOperativa = 'proximo' | 'operando' | 'sin_operacion'

export function faseOperativa(
  fechas: Array<string | null | undefined>,
  /** ¿Tuvo algún turno anterior a la ventana? Lo sabe quien consulta. */
  yaOperoAntes: boolean,
  ahora: Date = new Date(),
): FaseOperativa {
  const hoy = fechaISO(ahora)
  const limite = new Date(ahora)
  limite.setDate(limite.getDate() - DIAS_SIN_OPERACION)
  const corte = fechaISO(limite)

  let recientes = false
  let futuros = false
  for (const f of fechas) {
    if (!f) continue
    const d = f.slice(0, 10)
    if (d > hoy) futuros = true
    else if (d >= corte) recientes = true
    else yaOperoAntes = true   // un turno viejo dentro del lote también cuenta
  }

  // Ya prestó servicio alguna vez: universo normal mientras siga habiendo algo.
  if (recientes || (yaOperoAntes && futuros)) return 'operando'
  // Sólo tiene por delante y nunca arrancó.
  if (futuros) return 'proximo'
  return 'sin_operacion'
}

// ── Exigibilidad: UN SOLO criterio de "este objetivo debe supervisarse" ─────
//
// Antes cada pantalla tenía el suyo: el panel del Dashboard filtraba
// `estado='activo'` Y en operación (14 pendientes); el admin, el ranking, la
// agenda del supervisor y el cron de push filtraban sólo `estado='activo'`
// (17 pendientes). Tres objetivos sin turnos hace semanas figuraban como
// deuda en unas pantallas y no en otras.
//
// REGLA (aprobada): un objetivo exige supervisión en una fecha si
//   1. está `activo` y no es de prueba,
//   2. la fecha está dentro de su servicio (fecha_inicio_servicio ..
//      fecha_fin_servicio, ambas opcionales e inclusivas),
//   3. no tiene una suspensión vigente en esa fecha, y
//   4. está OPERANDO: turnos en los últimos DIAS_SIN_OPERACION días, o turnos
//      futuros habiendo operado antes (ver `faseOperativa`).
//
// Un objetivo activo que no cumple 4 NO se da de baja ni se oculta en
// silencio: va a la lista "Sin turnos recientes — confirmar estado". Nadie lo
// cierra automáticamente; lo decide Operaciones.
//
// Las supervisiones `incompleta` NO cuentan como última supervisión, igual
// que en la evaluación E1 (`s.estado <> 'incompleta'`): una visita sin
// checklist o sin foto no regulariza el vencimiento.

export type ObjetivoServicio = ObjetivoSupervisable & {
  nombre?: string | null
  estado?: string | null
  es_prueba?: boolean | null
  fecha_inicio_servicio?: string | null
  fecha_fin_servicio?: string | null
}

export type SuspensionObjetivo = {
  objetivo_id: string
  /** 'YYYY-MM-DD', inclusivo. */
  desde: string
  /** 'YYYY-MM-DD', inclusivo. `null` = hasta nuevo aviso. */
  hasta?: string | null
  motivo?: string | null
  anulada_at?: string | null
}

export type MotivoNoExigible =
  | 'inactivo'
  | 'prueba'
  | 'antes_de_inicio'
  | 'servicio_finalizado'
  | 'suspendido'
  | 'por_comenzar'
  | 'sin_turnos_recientes'

/** `motivo` es null cuando exige. Forma plana: el repo compila sin strict y no estrecha uniones. */
export type Exigibilidad = { exige: boolean; motivo: MotivoNoExigible | null }

export const ETIQUETA_MOTIVO_NO_EXIGIBLE: Record<MotivoNoExigible, string> = {
  inactivo: 'Inactivo',
  prueba: 'De prueba',
  antes_de_inicio: 'Servicio todavía no iniciado',
  servicio_finalizado: 'Servicio finalizado',
  suspendido: 'Servicio suspendido',
  por_comenzar: 'Por comenzar (sólo turnos futuros)',
  sin_turnos_recientes: 'Sin turnos recientes — confirmar estado',
}

/** Estados de turno que no prueban servicio (AGENTS.md: no generan obligación). */
export const ESTADOS_TURNO_SIN_SERVICIO = ['anulado', 'cancelado', 'reemplazado'] as const

/**
 * Contexto que hace falta para decidir. `fechasTurnos === null` significa "no
 * se pudo leer": en ese caso NO se descarta el objetivo por falta de turnos —
 * un fallo de red no puede hacer desaparecer deuda real.
 */
export type ContextoExigibilidad = {
  fechasTurnos: Map<string, string[]> | null
  yaOperaron: Set<string>
  suspensiones: SuspensionObjetivo[]
}

export const CONTEXTO_EXIGIBILIDAD_VACIO: ContextoExigibilidad = {
  fechasTurnos: null, yaOperaron: new Set(), suspensiones: [],
}

/** Suspensión vigente (no anulada) que cubre `fecha` ('YYYY-MM-DD'). */
export function suspensionVigenteEn(
  objetivoId: string,
  suspensiones: SuspensionObjetivo[],
  fecha: string,
): SuspensionObjetivo | null {
  for (const s of suspensiones) {
    if (s.objetivo_id !== objetivoId || s.anulada_at) continue
    const desde = (s.desde ?? '').slice(0, 10)
    const hasta = s.hasta ? s.hasta.slice(0, 10) : null
    if (desde && desde <= fecha && (hasta === null || fecha <= hasta)) return s
  }
  return null
}

/**
 * Parte "administrativa" del criterio (1-3): estado, prueba, fechas de
 * servicio y suspensiones. Es el espejo de la función SQL
 * `objetivo_exigible_en(objetivo_id, instante)`, salvo que acá el estado es el
 * actual (la base reconstruye el histórico con objetivos_auditoria).
 */
export function motivoServicioNoVigente(
  objetivo: ObjetivoServicio,
  suspensiones: SuspensionObjetivo[],
  fecha: string,
): MotivoNoExigible | null {
  if ((objetivo.estado || 'activo') !== 'activo') return 'inactivo'
  if (objetivo.es_prueba) return 'prueba'
  const inicio = objetivo.fecha_inicio_servicio?.slice(0, 10)
  const fin = objetivo.fecha_fin_servicio?.slice(0, 10)
  if (inicio && fecha < inicio) return 'antes_de_inicio'
  if (fin && fecha > fin) return 'servicio_finalizado'
  if (suspensionVigenteEn(objetivo.id, suspensiones, fecha)) return 'suspendido'
  return null
}

/** El criterio completo, con el motivo cuando no exige. */
export function exigibilidadSupervision(
  objetivo: ObjetivoServicio,
  contexto: ContextoExigibilidad,
  ahora: Date = new Date(),
): Exigibilidad {
  const hoy = fechaArgentinaDe(ahora)
  const motivo = motivoServicioNoVigente(objetivo, contexto.suspensiones, hoy)
  if (motivo) return { exige: false, motivo }
  if (contexto.fechasTurnos === null) return { exige: true, motivo: null }

  const fase = faseOperativa(
    contexto.fechasTurnos.get(objetivo.id) ?? [],
    contexto.yaOperaron.has(objetivo.id),
    ahora,
  )
  if (fase === 'operando') return { exige: true, motivo: null }
  return { exige: false, motivo: fase === 'proximo' ? 'por_comenzar' : 'sin_turnos_recientes' }
}

export const objetivoExigeSupervision = (
  objetivo: ObjetivoServicio,
  contexto: ContextoExigibilidad,
  ahora: Date = new Date(),
): boolean => exigibilidadSupervision(objetivo, contexto, ahora).exige

export type UniversoSupervision<O extends ObjetivoServicio> = {
  /** Los que reclaman visita: entran en vencidos, ranking, agenda y push. */
  exigibles: O[]
  /** Activos sin turnos en la ventana: se listan aparte, nunca se cierran solos. */
  sinTurnosRecientes: O[]
  /** Activos con sólo turnos futuros que nunca operaron. */
  porComenzar: O[]
  /** Activos con servicio finalizado, no iniciado o suspendido hoy. */
  fueraDeServicio: Array<{ objetivo: O; motivo: MotivoNoExigible }>
}

/**
 * Reparte objetivos según el criterio único. Los inactivos y de prueba no
 * aparecen en ninguna lista: no son parte del universo.
 */
export function clasificarUniversoSupervision<O extends ObjetivoServicio>(
  objetivos: O[],
  contexto: ContextoExigibilidad,
  ahora: Date = new Date(),
): UniversoSupervision<O> {
  const u: UniversoSupervision<O> = { exigibles: [], sinTurnosRecientes: [], porComenzar: [], fueraDeServicio: [] }
  for (const o of objetivos) {
    const e = exigibilidadSupervision(o, contexto, ahora)
    if (e.exige || !e.motivo) { u.exigibles.push(o); continue }
    if (e.motivo === 'inactivo' || e.motivo === 'prueba') continue
    if (e.motivo === 'sin_turnos_recientes') u.sinTurnosRecientes.push(o)
    else if (e.motivo === 'por_comenzar') u.porComenzar.push(o)
    else u.fueraDeServicio.push({ objetivo: o, motivo: e.motivo })
  }
  return u
}

/** Agrupa fechas de turno por objetivo (para `ContextoExigibilidad`). */
export function fechasTurnosPorObjetivo(
  turnos: Array<{ objetivo_id?: string | null; fecha?: string | null; estado?: string | null }>,
): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const t of turnos) {
    if (!t?.objetivo_id || !t.fecha) continue
    if (t.estado && (ESTADOS_TURNO_SIN_SERVICIO as readonly string[]).includes(t.estado)) continue
    const arr = m.get(t.objetivo_id) ?? []
    arr.push(t.fecha)
    m.set(t.objetivo_id, arr)
  }
  return m
}

/** Fecha argentina 'YYYY-MM-DD' de un instante (AGENTS.md: umbrales en hora ART). */
export function fechaArgentinaDe(d: Date): string {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d)
  } catch {
    return fechaISO(d)
  }
}

// ── Objetivo equivocado: aviso al empezar una supervisión ──────────────────
//
// 27 supervisiones de octubre se cargaron en objetivos duplicados (mismo
// lugar, <40 m): p. ej. una de LAROMET ROSARIO 2 quedó en "LAROMET ROSARIO",
// que no tenía turno. El aviso NO bloquea: sugiere el objetivo correcto.

export const RADIO_OBJETIVO_CERCANO_M = 100

type ObjetivoGeo = { id: string; nombre?: string | null; lat?: unknown; lng?: unknown }

function coordenada(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function metrosEntre(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Si `elegido` no tiene turno en el día y otro objetivo a menos de
 * RADIO_OBJETIVO_CERCANO_M sí lo tiene, devuelve el más cercano de esos.
 * `null` = no hay nada que advertir (o faltan coordenadas).
 */
export function sugerirObjetivoConTurno<O extends ObjetivoGeo>(
  elegido: O,
  candidatos: O[],
  objetivosConTurno: Set<string>,
  radioM: number = RADIO_OBJETIVO_CERCANO_M,
): { objetivo: O; distanciaM: number } | null {
  if (objetivosConTurno.has(elegido.id)) return null
  const lat = coordenada(elegido.lat)
  const lng = coordenada(elegido.lng)
  if (lat === null || lng === null) return null

  let mejor: { objetivo: O; distanciaM: number } | null = null
  for (const c of candidatos) {
    if (c.id === elegido.id || !objetivosConTurno.has(c.id)) continue
    const clat = coordenada(c.lat)
    const clng = coordenada(c.lng)
    if (clat === null || clng === null) continue
    const d = metrosEntre(lat, lng, clat, clng)
    if (d < radioM && (!mejor || d < mejor.distanciaM)) mejor = { objetivo: c, distanciaM: Math.round(d) }
  }
  return mejor
}
