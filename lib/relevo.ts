// Qué le pasa a la cobertura del puesto cuando se corre la hora de fin de un
// turno.
//
// ── El caso que lo motivó ───────────────────────────────────────────────────
// Un vigilador debía terminar 19:00 y se queda hasta 20:00. Administración
// corrige el turno. Si en ese puesto había un relevo programado a las 19:00,
// el cambio produce una hora de DOBLE COBERTURA que nadie ve: los dos turnos
// quedan válidos, los dos suman horas, y el solapamiento no aparece en ninguna
// pantalla.
//
// Al revés: si el turno se recorta a las 18:00 y el relevo entra 19:00, queda
// una hora de puesto DESCUBIERTO que tampoco avisa nadie, porque el turno de A
// terminó "bien" y el de B todavía no empezó.
//
// ── Lo que hace y lo que no ─────────────────────────────────────────────────
// Esto NO decide ni bloquea: calcula y describe, para que la pantalla pueda
// mostrar el impacto ANTES de confirmar. La decisión es de quien edita —una
// extensión solapada puede ser exactamente lo que se quiere cuando hay un
// traspaso presencial— pero tiene que ser una decisión tomada, no un efecto
// que se descubre a fin de mes en la liquidación.
//
// Tampoco toca horas trabajadas: correr la programación cambia la OBLIGACIÓN
// del puesto, no lo que la persona fichó.
//
// ── Por qué se compara por PUESTO y no por objetivo ─────────────────────────
// Dos puestos del mismo objetivo son coberturas paralelas: el de portería y el
// de perímetro se superponen todo el día y eso es correcto. Sólo se relevan
// entre sí los turnos del MISMO puesto. Cuando el turno no tiene puesto
// asignado se cae a comparar por objetivo, que es el criterio más amplio: sin
// el dato conviene advertir de más antes que callar un solapamiento real.

export interface TurnoRelevo {
  id: string
  objetivo_id?: string | null
  puesto_id?: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  guardia_id?: string | null
  estado?: string | null
}

export type ClaseImpacto = 'empalme' | 'solapamiento' | 'hueco' | 'sin_relevo'

export interface ImpactoRelevo {
  clase: ClaseImpacto
  /** Minutos de solapamiento o de hueco. 0 en empalme y sin_relevo. */
  minutos: number
  /** El turno que releva, cuando existe. */
  relevo: TurnoRelevo | null
  /** Cómo estaba ANTES del cambio, para no alarmar por algo preexistente. */
  previo: { clase: ClaseImpacto; minutos: number }
  /** Si el cambio empeora la cobertura respecto de como estaba. */
  empeora: boolean
}

const MINUTOS_DIA = 24 * 60

/** Minutos desde 1970-01-01 00:00 local. Sirve para ordenar y restar. */
function aMinutosAbsolutos(fecha: string, hora: string): number | null {
  const [a, m, d] = fecha.split('-').map(Number)
  const [hh, mm] = hora.split(':').map(Number)
  if (!a || !m || !d || !Number.isFinite(hh) || !Number.isFinite(mm)) return null
  // Date.UTC evita que el huso corra un día en los bordes; sólo se usa como
  // origen de una resta, nunca como instante real.
  return Math.floor(Date.UTC(a, m - 1, d) / 60000) + hh * 60 + mm
}

/**
 * Inicio y fin del turno en minutos absolutos. Un turno NOCTURNO —fin menor o
 * igual que inicio— termina al día siguiente; sin esto, 19:00–07:00 mediría
 * doce horas negativas y el relevo de la mañana parecería anterior al turno.
 */
export function tramoTurno(
  turno: Pick<TurnoRelevo, 'fecha' | 'hora_inicio' | 'hora_fin'>,
  horaFinOverride?: string | null,
): { inicio: number; fin: number } | null {
  const horaFin = (horaFinOverride ?? turno.hora_fin ?? '').slice(0, 5)
  const horaInicio = (turno.hora_inicio ?? '').slice(0, 5)
  const inicio = aMinutosAbsolutos(turno.fecha, horaInicio)
  const finMismoDia = aMinutosAbsolutos(turno.fecha, horaFin)
  if (inicio === null || finMismoDia === null) return null
  const fin = finMismoDia <= inicio ? finMismoDia + MINUTOS_DIA : finMismoDia
  return { inicio, fin }
}

/** ¿Los dos turnos cubren el mismo lugar y por lo tanto se relevan? */
function mismoPuesto(a: TurnoRelevo, b: TurnoRelevo): boolean {
  if (a.puesto_id && b.puesto_id) return a.puesto_id === b.puesto_id
  // Sin puesto en alguno de los dos, el objetivo es lo único comparable.
  return Boolean(a.objetivo_id) && a.objetivo_id === b.objetivo_id
}

const ESTADOS_SIN_COBERTURA = new Set(['anulado', 'cancelado'])

/**
 * El turno que toma la posta: el del mismo puesto que empieza más temprano
 * DESPUÉS del inicio del turno editado.
 *
 * Se busca desde el inicio del turno —y no desde su fin— a propósito: si se
 * busca desde el fin, recortar el turno haría "aparecer" un relevo distinto y
 * el aviso cambiaría según cuánto se recorta.
 */
export function buscarRelevo(turno: TurnoRelevo, candidatos: TurnoRelevo[]): TurnoRelevo | null {
  const propio = tramoTurno(turno)
  if (!propio) return null

  let mejor: { t: TurnoRelevo; inicio: number } | null = null

  for (const c of candidatos) {
    if (c.id === turno.id) continue
    if (ESTADOS_SIN_COBERTURA.has((c.estado ?? '').toLowerCase())) continue
    if (!mismoPuesto(turno, c)) continue
    const tramo = tramoTurno(c)
    if (!tramo) continue
    if (tramo.inicio <= propio.inicio) continue
    if (!mejor || tramo.inicio < mejor.inicio) mejor = { t: c, inicio: tramo.inicio }
  }

  return mejor?.t ?? null
}

function compararConRelevo(finTurno: number, inicioRelevo: number): { clase: ClaseImpacto; minutos: number } {
  if (finTurno > inicioRelevo) return { clase: 'solapamiento', minutos: finTurno - inicioRelevo }
  if (finTurno < inicioRelevo) return { clase: 'hueco', minutos: inicioRelevo - finTurno }
  return { clase: 'empalme', minutos: 0 }
}

/**
 * Qué pasaría con la cobertura del puesto si este turno terminara a
 * `horaFinNueva`.
 *
 * Devuelve también cómo estaba antes: un puesto que YA tenía dos horas de
 * hueco no se vuelve culpa de quien corrige el horario, y avisar igual haría
 * que el cartel se ignore.
 */
export function evaluarCambioDeFin(
  turno: TurnoRelevo,
  horaFinNueva: string,
  candidatos: TurnoRelevo[],
): ImpactoRelevo | null {
  const nuevo = tramoTurno(turno, horaFinNueva)
  const actual = tramoTurno(turno)
  if (!nuevo || !actual) return null

  const relevo = buscarRelevo(turno, candidatos)
  if (!relevo) {
    return {
      clase: 'sin_relevo', minutos: 0, relevo: null,
      previo: { clase: 'sin_relevo', minutos: 0 },
      empeora: false,
    }
  }

  const tramoRelevo = tramoTurno(relevo)
  if (!tramoRelevo) return null

  const despues = compararConRelevo(nuevo.fin, tramoRelevo.inicio)
  const previo = compararConRelevo(actual.fin, tramoRelevo.inicio)

  // "Empeora" es que crezca el problema que ya había, o que aparezca uno nuevo.
  // Pasar de hueco a solapamiento cuenta como empeorar aunque los minutos
  // bajen: son dos defectos distintos, no una escala.
  const empeora = despues.clase !== 'empalme' && (
    despues.clase !== previo.clase || despues.minutos > previo.minutos
  )

  return { clase: despues.clase, minutos: despues.minutos, relevo, previo, empeora }
}

/** "1 h 15 min", "45 min". Para que el aviso se lea sin hacer cuentas. */
export function duracionLegible(minutos: number): string {
  const m = Math.abs(Math.round(minutos))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const resto = m % 60
  return resto === 0 ? `${h} h` : `${h} h ${resto} min`
}

/**
 * El texto que ve quien edita. Nombra al relevo y dice qué queda mal, sin
 * decidir por él.
 */
export function mensajeImpacto(
  impacto: ImpactoRelevo,
  nombreGuardiaRelevo: (id?: string | null) => string,
): string | null {
  if (impacto.clase === 'sin_relevo' || impacto.clase === 'empalme') return null
  const r = impacto.relevo
  if (!r) return null

  const quien = r.guardia_id ? nombreGuardiaRelevo(r.guardia_id) : 'un turno sin vigilador asignado'
  const horario = `${(r.hora_inicio ?? '').slice(0, 5)}–${(r.hora_fin ?? '').slice(0, 5)}`

  if (impacto.clase === 'solapamiento') {
    return `Este cambio se superpone ${duracionLegible(impacto.minutos)} con el turno de ${quien} ${horario}: el puesto queda con doble cobertura.`
  }
  return `Queda un hueco de cobertura de ${duracionLegible(impacto.minutos)} hasta que entra ${quien} ${horario}.`
}
