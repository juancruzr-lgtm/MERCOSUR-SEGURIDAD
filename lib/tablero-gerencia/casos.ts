/**
 * lib/tablero-gerencia/casos.ts
 *
 * Circuito único de gestión de problemas del Tablero de Gerencia:
 *   Detectar → Revisar → Comunicar → Asignar → Resolver → Verificar.
 *
 * Lógica pura (sin Supabase ni navegador). La base (migración
 * 20261215120000_gestion_casos_tablero, SIN APLICAR) replica estas reglas en
 * la RPC; acá se definen y se prueban.
 *
 * Principios (AGENTS.md + orden de Gerencia 16/11/2026):
 *  - Detectado, revisado y resuelto son estados distintos.
 *  - Enviar un mensaje NO resuelve nada: sólo deja constancia de la comunicación.
 *  - "Resuelto" lo declara una persona; "Verificado" exige que los datos
 *    confirmen que la condición ya no está vigente.
 *  - Nadie queda como responsable de una falta por una causa técnica,
 *    de configuración o administrativa: la causa "conducta" sólo la asigna
 *    una persona, nunca la detección automática.
 */

export type TipoCaso =
  | 'sin_fichaje'
  | 'ingreso_tardio'
  | 'salida_anticipada'
  | 'sin_salida'
  | 'gps_fuera_radio'
  | 'turno_sin_cobertura'
  | 'ronda_incumplida'
  | 'supervision_vencida'
  | 'diferencia_horas'
  | 'objetivo_reincidente'
  | 'excepcion_reiterada'
  | 'programacion'
  | 'alerta_sin_resolver'

export type Gravedad = 'baja' | 'media' | 'alta' | 'critica'

export type EstadoCaso =
  | 'detectado'    // lo encontró una regla; nadie lo miró todavía
  | 'en_revision'  // una persona lo abrió y lo está analizando
  | 'comunicado'   // se pidió explicación o se avisó; esperando respuesta
  | 'respondido'   // llegó una respuesta/justificación; falta decidir
  | 'resuelto'     // una persona declaró resuelto, con motivo
  | 'verificado'   // los datos confirman que la condición ya no está vigente
  | 'descartado'   // no era un problema (falso positivo), con motivo
  | 'reabierto'    // la verificación falló o se reabrió a mano

export type CausaProbable =
  | 'indeterminada'
  | 'tecnica_gps'
  | 'configuracion'
  | 'administrativa'
  | 'conducta'

export const ESTADOS_CERRADOS: ReadonlySet<EstadoCaso> = new Set<EstadoCaso>(['verificado', 'descartado'])
export const ESTADOS_SIN_PLAZO: ReadonlySet<EstadoCaso> = new Set<EstadoCaso>(['resuelto', 'verificado', 'descartado'])

export interface EvidenciaCaso {
  /** Fuente exacta: tabla e id (p. ej. registros_asistencia:<uuid>). */
  fuente: string
  descripcion: string
  /** Datos crudos para mostrar: horario programado, fichajes, GPS, fotos. */
  datos?: Record<string, unknown>
}

export interface Caso {
  id: string
  tipo: TipoCaso
  gravedad: Gravedad
  estado: EstadoCaso
  causa: CausaProbable
  /** Clave natural para no duplicar: misma regla + mismo hecho = mismo caso. */
  clave: string
  regla: string
  empleadoId: string | null
  objetivoId: string | null
  clienteId: string | null
  turnoId: string | null
  fechaHecho: string            // AAAA-MM-DD (hora argentina)
  detectadoAt: string           // ISO
  plazoAt: string | null        // ISO; null = sin plazo
  responsableId: string | null
  evidencias: EvidenciaCaso[]
  eventos: EventoCaso[]
}

export type AccionCaso =
  | 'revisar'
  | 'solicitar_explicacion'
  | 'avisar_supervisor'
  | 'asignar'
  | 'registrar_respuesta'
  | 'marcar_resuelto'
  | 'verificar'
  | 'descartar'
  | 'reabrir'
  | 'comentar'

export interface EventoCaso {
  accion: AccionCaso
  actorId: string
  at: string
  estadoAnterior: EstadoCaso
  estadoNuevo: EstadoCaso
  comentario?: string | null
  responsableId?: string | null
  causa?: CausaProbable | null
  /** Id de la comunicación (gestion_comunicaciones) cuando la acción es un mensaje. */
  comunicacionId?: string | null
}

export interface EntradaAccion {
  accion: AccionCaso
  actorId: string
  at: string
  comentario?: string | null
  responsableId?: string | null
  causa?: CausaProbable | null
  comunicacionId?: string | null
  /** Para `verificar`: resultado de volver a mirar los datos. */
  condicionVigente?: boolean
}

export type ResultadoAccion =
  | { ok: true; caso: Caso; evento: EventoCaso }
  | { ok: false; error: string }

const COMUNICACIONES: ReadonlySet<AccionCaso> = new Set<AccionCaso>(['solicitar_explicacion', 'avisar_supervisor'])

function sinTexto(s?: string | null): boolean {
  return !s || s.trim().length < 3
}

/**
 * Aplica una acción al caso y devuelve el caso nuevo + el evento a guardar
 * (append-only). No muta el caso recibido.
 */
export function aplicarAccion(caso: Caso, e: EntradaAccion): ResultadoAccion {
  const de = caso.estado
  let a: EstadoCaso = de
  let responsableId = caso.responsableId
  let causa = caso.causa

  if (ESTADOS_CERRADOS.has(de) && e.accion !== 'reabrir' && e.accion !== 'comentar') {
    return { ok: false, error: `El caso está ${de}: sólo se puede comentar o reabrir.` }
  }

  switch (e.accion) {
    case 'comentar':
      if (sinTexto(e.comentario)) return { ok: false, error: 'El comentario está vacío.' }
      break

    case 'revisar':
      if (de === 'detectado' || de === 'reabierto') a = 'en_revision'
      break

    case 'solicitar_explicacion':
    case 'avisar_supervisor':
      if (!e.comunicacionId) {
        return { ok: false, error: 'Una comunicación debe quedar registrada antes de vincularla al caso.' }
      }
      // Comunicar nunca resuelve: sólo avanza si el caso todavía no tenía respuesta.
      if (de === 'detectado' || de === 'en_revision' || de === 'reabierto') a = 'comunicado'
      break

    case 'asignar':
      if (!e.responsableId) return { ok: false, error: 'Falta el responsable.' }
      responsableId = e.responsableId
      if (de === 'detectado') a = 'en_revision'
      break

    case 'registrar_respuesta':
      if (sinTexto(e.comentario)) return { ok: false, error: 'La respuesta o justificación está vacía.' }
      if (de !== 'resuelto') a = 'respondido'
      break

    case 'marcar_resuelto':
      if (sinTexto(e.comentario)) return { ok: false, error: 'Para resolver hay que explicar qué se hizo.' }
      if (!e.causa) return { ok: false, error: 'Para resolver hay que indicar la causa.' }
      causa = e.causa
      a = 'resuelto'
      break

    case 'verificar':
      if (de !== 'resuelto') return { ok: false, error: 'Sólo se verifica un caso marcado como resuelto.' }
      if (e.condicionVigente === undefined) {
        return { ok: false, error: 'La verificación necesita volver a mirar los datos.' }
      }
      a = e.condicionVigente ? 'reabierto' : 'verificado'
      break

    case 'descartar':
      if (sinTexto(e.comentario)) return { ok: false, error: 'Para descartar hay que explicar por qué no era un problema.' }
      if (e.causa === 'conducta') return { ok: false, error: 'Un caso por conducta no se descarta: se resuelve.' }
      causa = e.causa ?? causa
      a = 'descartado'
      break

    case 'reabrir':
      if (de !== 'resuelto' && de !== 'verificado' && de !== 'descartado') {
        return { ok: false, error: 'El caso ya está abierto.' }
      }
      if (sinTexto(e.comentario)) return { ok: false, error: 'Para reabrir hay que explicar el motivo.' }
      a = 'reabierto'
      break
  }

  const evento: EventoCaso = {
    accion: e.accion,
    actorId: e.actorId,
    at: e.at,
    estadoAnterior: de,
    estadoNuevo: a,
    comentario: e.comentario ?? null,
    responsableId: e.accion === 'asignar' ? responsableId : null,
    causa: e.accion === 'marcar_resuelto' || e.accion === 'descartar' ? causa : null,
    comunicacionId: COMUNICACIONES.has(e.accion) ? e.comunicacionId ?? null : null,
  }

  return {
    ok: true,
    evento,
    caso: { ...caso, estado: a, responsableId, causa, eventos: [...caso.eventos, evento] },
  }
}

export function casoVencido(caso: Caso, ahoraIso: string): boolean {
  if (!caso.plazoAt || ESTADOS_SIN_PLAZO.has(caso.estado)) return false
  return Date.parse(caso.plazoAt) < Date.parse(ahoraIso)
}

/** Comunicaciones vinculadas al caso que todavía no tuvieron respuesta registrada. */
export function comunicacionesSinRespuesta(caso: Caso): number {
  let pendientes = 0
  for (const ev of caso.eventos) {
    if (COMUNICACIONES.has(ev.accion)) pendientes++
    if (ev.accion === 'registrar_respuesta') pendientes = 0
  }
  return ESTADOS_CERRADOS.has(caso.estado) ? 0 : pendientes
}

/** Horas desde la detección hasta la primera vez que quedó resuelto (o null). */
export function horasHastaResolucion(caso: Caso): number | null {
  const ev = caso.eventos.find(x => x.estadoNuevo === 'resuelto' || x.estadoNuevo === 'descartado')
  if (!ev) return null
  return Math.max(0, (Date.parse(ev.at) - Date.parse(caso.detectadoAt)) / 3_600_000)
}

export interface ResumenCasos {
  total: number
  abiertos: number
  vencidos: number
  resueltosSinVerificar: number
  verificados: number
  descartados: number
  reabiertos: number
  sinResponsable: number
  mensajesSinRespuesta: number
  horasMedianaResolucion: number | null
  porTipo: Record<string, number>
  porResponsable: Record<string, { abiertos: number; vencidos: number }>
  /** empleado|tipo con 3 o más casos en el período. */
  reincidencias: { empleadoId: string; tipo: TipoCaso; casos: number }[]
}

export function resumirCasos(casos: Caso[], ahoraIso: string, umbralReincidencia = 3): ResumenCasos {
  const r: ResumenCasos = {
    total: casos.length, abiertos: 0, vencidos: 0, resueltosSinVerificar: 0, verificados: 0,
    descartados: 0, reabiertos: 0, sinResponsable: 0, mensajesSinRespuesta: 0,
    horasMedianaResolucion: null, porTipo: {}, porResponsable: {}, reincidencias: [],
  }
  const tiempos: number[] = []
  const reinc = new Map<string, number>()

  for (const c of casos) {
    r.porTipo[c.tipo] = (r.porTipo[c.tipo] ?? 0) + 1
    const abierto = !ESTADOS_SIN_PLAZO.has(c.estado)
    const vencido = casoVencido(c, ahoraIso)
    if (abierto) r.abiertos++
    if (vencido) r.vencidos++
    if (c.estado === 'resuelto') r.resueltosSinVerificar++
    if (c.estado === 'verificado') r.verificados++
    if (c.estado === 'descartado') r.descartados++
    if (c.estado === 'reabierto') r.reabiertos++
    if (abierto && !c.responsableId) r.sinResponsable++
    if (comunicacionesSinRespuesta(c) > 0) r.mensajesSinRespuesta++
    if (abierto && c.responsableId) {
      const p = (r.porResponsable[c.responsableId] ??= { abiertos: 0, vencidos: 0 })
      p.abiertos++
      if (vencido) p.vencidos++
    }
    const h = horasHastaResolucion(c)
    if (h !== null) tiempos.push(h)
    // Un descarte (falso positivo) no cuenta como reincidencia de la persona.
    if (c.empleadoId && c.estado !== 'descartado') {
      const k = `${c.empleadoId}|${c.tipo}`
      reinc.set(k, (reinc.get(k) ?? 0) + 1)
    }
  }

  if (tiempos.length) {
    const s = [...tiempos].sort((x, y) => x - y)
    const m = Math.floor(s.length / 2)
    r.horasMedianaResolucion = Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10
  }
  reinc.forEach((n, k) => {
    if (n >= umbralReincidencia) {
      const [empleadoId, tipo] = k.split('|')
      r.reincidencias.push({ empleadoId, tipo: tipo as TipoCaso, casos: n })
    }
  })
  r.reincidencias.sort((x, y) => y.casos - x.casos)
  return r
}

export interface FiltroCasos {
  estados?: EstadoCaso[]
  tipos?: TipoCaso[]
  objetivoIds?: ReadonlySet<string>
  clienteId?: string
  empleadoId?: string
  responsableId?: string
  soloVencidos?: boolean
}

/**
 * Filtra por los filtros de la pantalla Y por el alcance del usuario.
 * `permitidos === null` = alcance 'todas'; un Set vacío no muestra nada
 * (fail-closed, igual que lib/alertas-alcance.ts).
 */
export function filtrarCasos(
  casos: Caso[],
  f: FiltroCasos,
  permitidos: ReadonlySet<string> | null,
  ahoraIso: string,
): Caso[] {
  return casos.filter(c => {
    if (permitidos !== null && (!c.objetivoId || !permitidos.has(c.objetivoId))) return false
    if (f.estados && !f.estados.includes(c.estado)) return false
    if (f.tipos && !f.tipos.includes(c.tipo)) return false
    if (f.objetivoIds && (!c.objetivoId || !f.objetivoIds.has(c.objetivoId))) return false
    if (f.clienteId && c.clienteId !== f.clienteId) return false
    if (f.empleadoId && c.empleadoId !== f.empleadoId) return false
    if (f.responsableId && c.responsableId !== f.responsableId) return false
    if (f.soloVencidos && !casoVencido(c, ahoraIso)) return false
    return true
  })
}
