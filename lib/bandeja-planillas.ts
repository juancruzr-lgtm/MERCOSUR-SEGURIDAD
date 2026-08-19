/**
 * lib/bandeja-planillas.ts
 *
 * Bandeja mensual de revisión de planillas: estado único por fila, filtros y
 * resumen del mes.
 *
 * PURO: no consulta Supabase. La bandeja (components/supervisor/BandejaPlanillas)
 * arma las filas con los datos ya traídos y usa esto para clasificarlas,
 * filtrarlas y resumirlas. Hay una sola bandeja, montada desde administración y
 * desde la vista de supervisor; acá vive lo que ambas comparten.
 *
 * Reutiliza los estados que ya existen en lib/primer-control —
 * EstadoPrimerControl (lado del vigilador), EstadoSolicitud (ciclo de la
 * solicitud) y AccionSupervisor— y los combina en UN estado visible por fila.
 * No agrega estados a la base: es una derivación de lo que ya está guardado.
 */

import type { EstadoPrimerControl, EstadoSolicitud } from '@/lib/primer-control'

// ── Estado visible de la fila ────────────────────────────────────────────────

export const ESTADOS_REVISION = [
  'pendiente',
  'aceptado',
  'modificacion_solicitada',
  'revisado_supervisor',
  'pendiente_regularizacion',
  'resuelto',
] as const

export type EstadoRevision = typeof ESTADOS_REVISION[number]

export const ETIQUETA_ESTADO_REVISION: Record<EstadoRevision, string> = {
  pendiente: 'Pendiente',
  aceptado: 'Aceptado por vigilador',
  modificacion_solicitada: 'Modificación solicitada',
  revisado_supervisor: 'Revisado por supervisor',
  pendiente_regularizacion: 'Pendiente de regularización administrativa',
  resuelto: 'Resuelto',
}

/**
 * Estados que todavía esperan que alguien haga algo. Son los que cuenta el
 * resumen del mes: "Agosto 2026 — 12 pendientes de 340 registros".
 *
 * 'aceptado' NO cuenta como pendiente: el vigilador dio conformidad y no queda
 * nada por resolver. 'revisado_supervisor' y 'resuelto' tampoco.
 */
export const ESTADOS_PENDIENTES: ReadonlySet<EstadoRevision> = new Set<EstadoRevision>([
  'pendiente',
  'modificacion_solicitada',
  'pendiente_regularizacion',
])

export const esPendienteDeAccion = (e: EstadoRevision): boolean => ESTADOS_PENDIENTES.has(e)

/**
 * Etiqueta de una fila que NO requiere accion, aunque su estado de revision
 * siga siendo 'pendiente' porque el vigilador nunca respondio.
 *
 * Sin esto, cada fila mostraba "Pendiente" y el contador del mes decia otra
 * cosa ("75 pendientes de 283"): la pantalla se contradecia sola y obligaba a
 * revisar a mano turnos que estaban perfectos.
 */
export const ETIQUETA_NO_REQUIERE_REVISION = 'No requiere revisión'

// ── Cobertura del turno ──────────────────────────────────────────────────────

/**
 * Margen para dar por cubierto un extremo del turno.
 *
 * Es una TOLERANCIA OPERATIVA DE REVISIÓN, no de liquidación. Decide una sola
 * cosa: si el supervisor tiene que mirar la fila. No mueve horas, no toca
 * liquidación y NO es una regla automática de descuento por tardanza.
 *
 * Estaba en 5 minutos y llenaba la bandeja de relevos normales. Medido sobre
 * agosto de 2026: de los ~155 desvíos del mes, unos 98 eran de 6 a 20 minutos
 * —alguien que ficha la salida a las 15:52 de un turno que termina 16:00—. Eso
 * es el ruido del relevo, no una irregularidad que merezca intervención humana.
 *
 * Ojo: ya NO es el mismo umbral que calcAlertaEntrada (lib/supabase.ts), que
 * sigue marcando 'tarde' a partir de 5 minutos. Son dos preguntas distintas
 * —"¿hubo tardanza?" contra "¿alguien tiene que revisar esto?"— y desde este
 * cambio tienen umbrales distintos a propósito.
 */
export const TOLERANCIA_COBERTURA_MIN = 15

const aMinutos = (h?: string | null): number | null => {
  if (!h) return null
  const [hh, mm] = h.split(':').map(Number)
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  return hh * 60 + mm
}

/**
 * ¿El fichaje cubre el turno completo? Entrar antes o salir después SÍ cubre:
 * el turno es el que manda y quedarse de más no lo agranda. Lo que no cubre es
 * entrar tarde o irse antes.
 *
 * Los turnos nocturnos (fin <= inicio) se resuelven igual que en
 * calcularHorasLiquidables: la entrada de madrugada y la salida anterior al
 * inicio pertenecen al día siguiente.
 */
export function cubreElTurno(
  f: Pick<FilaBandejaMensual, 'horaInicioProg' | 'horaFinProg' | 'entrada' | 'salida'>,
  toleranciaMin: number = TOLERANCIA_COBERTURA_MIN,
): boolean {
  const inicioProg = aMinutos(f.horaInicioProg)
  const finProgCrudo = aMinutos(f.horaFinProg)
  const entradaReal = aMinutos(f.entrada)
  const salidaReal = aMinutos(f.salida)
  if (inicioProg == null || finProgCrudo == null || entradaReal == null || salidaReal == null) return false

  const nocturno = finProgCrudo <= inicioProg
  const finProg = nocturno ? finProgCrudo + 1440 : finProgCrudo

  let entrada = entradaReal
  if (nocturno && entradaReal <= finProgCrudo) entrada += 1440
  let salida = salidaReal
  if (nocturno && salidaReal <= inicioProg) salida += 1440
  if (salida < entrada) salida += 1440

  return entrada <= inicioProg + toleranciaMin && salida >= finProg - toleranciaMin
}

/**
 * Qué lado del turno no quedó cubierto. null cuando el fichaje cubre, o cuando
 * faltan datos para saberlo.
 *
 * Existe porque la bandeja explicaba el motivo con `entrada > horaInicioProg`,
 * sin tolerancia: una entrada un minuto tarde —que SÍ cubre— hacía que la fila
 * dijera "entró tarde" aunque el problema real fuera una salida anticipada.
 * Mandaba al supervisor a mirar el lado equivocado.
 */
export function motivoNoCubre(
  f: Pick<FilaBandejaMensual, 'horaInicioProg' | 'horaFinProg' | 'entrada' | 'salida'>,
  toleranciaMin: number = TOLERANCIA_COBERTURA_MIN,
): 'entro_tarde' | 'se_retiro_antes' | 'ambos' | null {
  const inicioProg = aMinutos(f.horaInicioProg)
  const finProgCrudo = aMinutos(f.horaFinProg)
  const entradaReal = aMinutos(f.entrada)
  const salidaReal = aMinutos(f.salida)
  if (inicioProg == null || finProgCrudo == null || entradaReal == null || salidaReal == null) return null

  // Misma resolución de nocturnos que cubreElTurno: si cambia una, cambia la otra.
  const nocturno = finProgCrudo <= inicioProg
  const finProg = nocturno ? finProgCrudo + 1440 : finProgCrudo

  let entrada = entradaReal
  if (nocturno && entradaReal <= finProgCrudo) entrada += 1440
  let salida = salidaReal
  if (nocturno && salidaReal <= inicioProg) salida += 1440
  if (salida < entrada) salida += 1440

  const tarde = entrada > inicioProg + toleranciaMin
  const antes = salida < finProg - toleranciaMin
  if (tarde && antes) return 'ambos'
  if (tarde) return 'entro_tarde'
  if (antes) return 'se_retiro_antes'
  return null
}

export const ETIQUETA_MOTIVO_NO_CUBRE: Record<'entro_tarde' | 'se_retiro_antes' | 'ambos', string> = {
  entro_tarde: 'entró tarde',
  se_retiro_antes: 'se retiró antes',
  ambos: 'entró tarde y se retiró antes',
}

// ── Corrección del horario reconocido ────────────────────────────────────────
//
// El turno programado manda: el fichaje por si solo nunca mueve las horas. La
// unica forma de reconocer un horario distinto es esta, con motivo y auditoria.
//
// Espeja la aritmetica de calcular_horas_reconocidas en Postgres (misma
// resolucion de turnos nocturnos, sin tope ni tolerancia). Es solo para la
// vista previa del modal: lo que se guarda lo recalcula la RPC en el servidor.

/**
 * Duración exacta de un tramo, en horas. Sin tope contra lo programado.
 *
 * Una salida anterior a la entrada significa que cruzó medianoche. Da el mismo
 * resultado que calcular_horas_reconocidas en Postgres: cuando el turno es
 * nocturno, esa función desplaza entrada y salida al día siguiente, y el
 * desplazamiento se cancela en la resta.
 */
export function horasDelTramo(entrada: string, salida: string): number {
  const e = aMinutos(entrada)
  const s = aMinutos(salida)
  if (e == null || s == null) return 0
  const salidaAbs = s < e ? s + 1440 : s
  return Math.round(((salidaAbs - e) / 60) * 100) / 100
}

/** Duración programada del turno, en horas. */
export function horasProgramadas(horaInicioProg: string, horaFinProg: string): number {
  const i = aMinutos(horaInicioProg)
  const f = aMinutos(horaFinProg)
  if (i == null || f == null) return 0
  const fin = f <= i ? f + 1440 : f
  return Math.round(((fin - i) / 60) * 100) / 100
}

export interface PlanCorreccionHorario {
  /** null si se puede guardar; si no, el motivo por el que falta algo. */
  bloqueo: string | null
  horasReconocidas: number
  horasProgramadas: number
  /** Diferencia contra lo programado. Positiva = por encima del turno. */
  diferencia: number
  /** Reconoce tiempo POR ENCIMA del turno: exige confirmación aparte. */
  excedeTurno: boolean
  /** Reconoce menos que el turno programado. */
  quedaCorto: boolean
  /** true cuando hay que mandar p_reconocer_fuera_de_turno a la RPC. */
  requiereFueraDeTurno: boolean
}

export function planCorreccionHorario(p: {
  horaInicioProg: string
  horaFinProg: string
  entradaReconocida: string
  salidaReconocida: string
  motivo: string
}): PlanCorreccionHorario {
  const prog = horasProgramadas(p.horaInicioProg, p.horaFinProg)
  const reconocidas = p.entradaReconocida && p.salidaReconocida
    ? horasDelTramo(p.entradaReconocida, p.salidaReconocida)
    : 0
  const diferencia = Math.round((reconocidas - prog) * 100) / 100
  // Un minuto de diferencia ya sale de lo programado: el flag existe justamente
  // para que la RPC no vuelva a redondear contra el turno.
  const excedeTurno = diferencia > 0
  const quedaCorto = diferencia < 0

  let bloqueo: string | null = null
  if (!p.entradaReconocida || !p.salidaReconocida) bloqueo = 'Completá la entrada y la salida reconocidas.'
  else if (p.entradaReconocida === p.salidaReconocida) bloqueo = 'La salida no puede ser igual a la entrada.'
  else if (p.motivo.trim().length < 3) bloqueo = 'El motivo es obligatorio.'

  return {
    bloqueo,
    horasReconocidas: reconocidas,
    horasProgramadas: prog,
    diferencia,
    excedeTurno,
    quedaCorto,
    requiereFueraDeTurno: excedeTurno || quedaCorto,
  }
}

/** "1 h 30 min por encima del turno" / "45 min por debajo". */
export function etiquetaDiferencia(diferencia: number): string {
  if (diferencia === 0) return 'Coincide con el turno programado'
  const totalMin = Math.round(Math.abs(diferencia) * 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  const dur = [h > 0 ? `${h} h` : null, m > 0 ? `${m} min` : null].filter(Boolean).join(' ')
  return `${dur} ${diferencia > 0 ? 'por encima' : 'por debajo'} del turno`
}

/**
 * ¿La fila espera que alguien haga algo?
 *
 * Lo que manda es si el turno quedó cubierto, no si el vigilador contestó.
 *
 *   · Fichaje que NO cubre el turno (entró tarde o se fue antes) → hay una
 *     decisión que tomar: si fue por un problema real se cuenta el turno
 *     completo, y si no, corresponde descontar. Eso lo resuelve el supervisor.
 *   · Modificación solicitada o derivado a administración → alguien pidió algo.
 *   · Fichaje que cubre el turno → no hay nada que resolver, haya aceptado el
 *     vigilador o no.
 *
 * La falta de respuesta del vigilador dejó de contar por sí sola. Antes, un
 * turno cubierto de punta a punta figuraba como pendiente solo porque nadie
 * apretó "Aceptar" en el celular — y como la aceptación en Mi Planilla es
 * reciente, eso arrastraba cientos de turnos viejos que no tenían nada de malo.
 * "Sin respuesta del vigilador" sigue existiendo como estado y como filtro,
 * para poder auditarlo cuando haga falta.
 *
 * Un turno sin fichaje tampoco cubre el turno, así que sigue pidiendo revisión.
 */
export function requiereRevision(f: FilaBandejaMensual): boolean {
  const estado = estadoRevision(f)
  if (estado === 'revisado_supervisor' || estado === 'resuelto') return false
  if (estado === 'modificacion_solicitada' || estado === 'pendiente_regularizacion') return true
  // 'pendiente' y 'aceptado': decide la cobertura del turno.
  return !cubreElTurno(f)
}

// ── Fila de la bandeja ───────────────────────────────────────────────────────

export interface FilaBandejaMensual {
  turnoId: string
  empleadoId: string
  /** Registro de asistencia principal del turno. null si no hubo fichaje. */
  registroId: string | null
  vigilador: string
  fecha: string
  objetivoId: string
  objetivo: string
  puestoId: string | null
  puesto: string
  horario: string
  /** Horario programado. Es el que manda: trabajar de más no agranda el turno. */
  horaInicioProg: string
  horaFinProg: string
  /** Horario efectivamente fichado. */
  entrada: string | null
  salida: string | null
  horas: number
  caracteristica: string
  salidaAutomatica: boolean
  tieneFichaje: boolean
  /**
   * Ausencia marcada por un supervisor sobre este turno.
   *
   * Va aparte de `tieneFichaje` a propósito: una ausencia NO es un fichaje y
   * nunca aporta horas. Si además hubo reemplazo, la fila muestra al reemplazo
   * con sus horas y `ausenciaVigilador` conserva el nombre del que faltó — son
   * dos personas distintas sobre el mismo turno.
   */
  esAusencia?: boolean
  ausenciaVigilador?: string | null
  ausenciaComentario?: string | null
  ausenciaSupervisor?: string | null
  ausenciaAt?: string | null
  /** Lo que respondió el vigilador. */
  estadoControl: EstadoPrimerControl
  solicitudId: string | null
  solicitudTexto: string | null
  solicitudEstado: EstadoSolicitud | null
  /** El supervisor marcó la fila como revisada. */
  revisado: boolean
  /** El supervisor la derivó a administración. */
  derivado: boolean
  observaciones: number
}

/**
 * Estado visible de una fila, combinando lo del vigilador con lo que hizo
 * después el supervisor o administración.
 *
 * Precedencia: gana lo más avanzado del ciclo. Si el supervisor ya revisó, eso
 * pesa más que la respuesta del vigilador, porque ocurrió después. Sin esta
 * regla una fila revisada seguiría apareciendo como "Modificación solicitada" y
 * volvería a la bandeja para siempre.
 */
export function estadoRevision(f: Pick<FilaBandejaMensual,
  'estadoControl' | 'solicitudEstado' | 'revisado' | 'derivado'>): EstadoRevision {
  if (f.solicitudEstado === 'resuelta') return 'resuelto'
  if (f.derivado || f.solicitudEstado === 'requiere_regularizacion') return 'pendiente_regularizacion'
  if (f.revisado || f.solicitudEstado === 'revisada') return 'revisado_supervisor'
  if (f.estadoControl === 'modificacion_solicitada') return 'modificacion_solicitada'
  if (f.estadoControl === 'aceptado') return 'aceptado'
  return 'pendiente'
}

// ── Estado de revisión por turno+empleado ────────────────────────────────────
// Lo que la bandeja arma desde aceptaciones_planilla,
// solicitudes_modificacion_planilla y revisiones_planilla. Vive acá porque no
// es sólo de la bandeja: Reportes → Diferencias necesita la misma respuesta a
// "¿esto ya se resolvió?", y con dos construcciones distintas la misma fila
// aparecía pendiente en una pantalla y resuelta en la otra.

export const claveRevision = (turnoId: string, empleadoId: string) => `${turnoId}:${empleadoId}`

export interface EstadoRevisionClave {
  estadoControl: EstadoPrimerControl
  solicitudId: string | null
  solicitudTexto: string | null
  solicitudEstado: EstadoSolicitud | null
  revisado: boolean
  derivado: boolean
  observaciones: number
}

export function construirRevisionPorClave(
  aceptaciones: Array<{ turno_id: string; empleado_id: string }>,
  /** Ordenadas por created_at descendente: la primera vista es la más reciente. */
  solicitudes: Array<{ id?: string; turno_id: string; empleado_id: string; texto?: string | null; estado: string }>,
  /** created_at decide cual accion vale: sin fecha, gana la derivacion. */
  revisiones: Array<{ turno_id: string; empleado_id: string; accion: string; created_at?: string | null }>,
): Map<string, EstadoRevisionClave> {
  // Las claves se juntan a mano en un array en vez de iterar los Set: el
  // target de compilación es ES5 y el spread de Set/Map no compila.
  const claves: string[] = []
  const vistas = new Set<string>()
  const anotar = (k: string) => { if (!vistas.has(k)) { vistas.add(k); claves.push(k) } }

  const aceptados = new Set<string>()
  for (const a of aceptaciones) {
    const k = claveRevision(a.turno_id, a.empleado_id)
    aceptados.add(k); anotar(k)
  }

  const solicitudPor = new Map<string, typeof solicitudes[number]>()
  for (const s of solicitudes) {
    const k = claveRevision(s.turno_id, s.empleado_id)
    anotar(k)
    // Preferir la no resuelta: una solicitud vieja ya cerrada no puede tapar
    // una nueva abierta sobre el mismo turno.
    const previa = solicitudPor.get(k)
    if (!previa || (previa.estado === 'resuelta' && s.estado !== 'resuelta')) solicitudPor.set(k, s)
  }

  // Gana la ULTIMA accion, no "alguna vez paso".
  //
  // Antes esto eran dos Set: bastaba con que existiera una derivacion para que
  // la fila quedara derivada para siempre. Y como estadoRevision mira `derivado`
  // antes que `revisado`, ningun "Marcar como revisado" posterior podia sacarla
  // de la bandeja. La unica salida prevista —una solicitud en estado 'resuelta'—
  // no la escribe ninguna parte del codigo, asi que era una puerta sin picaporte:
  // el supervisor derivaba, se arrepentia, marcaba revisado y no pasaba nada.
  //
  // Con la fecha, la fila refleja lo ultimo que decidio el supervisor: deriva y
  // queda derivada; si despues la revisa, sale; si la vuelve a derivar, vuelve a
  // entrar. Ante empate o falta de fecha gana la derivacion, que es como se
  // comportaba antes: preferimos dejar una fila de mas en la bandeja que perderla.
  const marcaRevisado = new Map<string, number>()
  const marcaDerivado = new Map<string, number>()
  const observaciones = new Map<string, number>()

  const momento = (iso?: string | null) => {
    const t = iso ? Date.parse(iso) : NaN
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY
  }
  const marcarUltima = (m: Map<string, number>, k: string, t: number) => {
    const previa = m.get(k)
    if (previa === undefined || t > previa) m.set(k, t)
  }

  for (const r of revisiones) {
    const k = claveRevision(r.turno_id, r.empleado_id)
    anotar(k)
    const t = momento(r.created_at)
    if (r.accion === 'revisado') marcarUltima(marcaRevisado, k, t)
    if (r.accion === 'derivar_administracion') marcarUltima(marcaDerivado, k, t)
    if (r.accion === 'observacion') observaciones.set(k, (observaciones.get(k) ?? 0) + 1)
  }

  const esDerivado = (k: string) => {
    const d = marcaDerivado.get(k)
    if (d === undefined) return false
    const r = marcaRevisado.get(k)
    return r === undefined || d >= r
  }
  const esRevisado = (k: string) => {
    const r = marcaRevisado.get(k)
    if (r === undefined) return false
    const d = marcaDerivado.get(k)
    return d === undefined || r > d
  }

  const mapa = new Map<string, EstadoRevisionClave>()
  for (const k of claves) {
    const solicitud = solicitudPor.get(k) ?? null
    mapa.set(k, {
      estadoControl: solicitud && solicitud.estado !== 'resuelta'
        ? 'modificacion_solicitada'
        : aceptados.has(k) ? 'aceptado' : 'pendiente',
      solicitudId: solicitud?.id ?? null,
      solicitudTexto: solicitud?.texto ?? null,
      solicitudEstado: (solicitud?.estado as EstadoSolicitud) ?? null,
      revisado: esRevisado(k),
      derivado: esDerivado(k),
      observaciones: observaciones.get(k) ?? 0,
    })
  }
  return mapa
}

/** Estado por defecto de un turno sobre el que nadie hizo nada todavía. */
export const REVISION_SIN_TOCAR: EstadoRevisionClave = {
  estadoControl: 'pendiente',
  solicitudId: null,
  solicitudTexto: null,
  solicitudEstado: null,
  revisado: false,
  derivado: false,
  observaciones: 0,
}

// ── Filtros ──────────────────────────────────────────────────────────────────

export type FiltroTernario = 'todos' | 'si' | 'no'

export interface FiltrosBandejaMensual {
  /** 'YYYY-MM'. El mes NO se aplica acá: acota la consulta, no el filtrado. */
  empleadoId?: string | null
  objetivoId?: string | null
  puestoId?: string | null
  estado?: EstadoRevision | 'todos'
  /** 'si' = solo con fichaje, 'no' = solo sin fichaje. */
  conFichaje?: FiltroTernario
  salidaAutomatica?: FiltroTernario
  /** Solo lo que espera acción de alguien. */
  soloPendientes?: boolean
}

export function filtrarFilasBandeja(
  filas: FilaBandejaMensual[],
  f: FiltrosBandejaMensual,
): FilaBandejaMensual[] {
  return filas.filter(fila => {
    const estado = estadoRevision(fila)
    if (f.empleadoId && fila.empleadoId !== f.empleadoId) return false
    if (f.objetivoId && fila.objetivoId !== f.objetivoId) return false
    if (f.puestoId && (fila.puestoId ?? '') !== f.puestoId) return false
    if (f.estado && f.estado !== 'todos' && estado !== f.estado) return false
    if (f.conFichaje === 'si' && !fila.tieneFichaje) return false
    if (f.conFichaje === 'no' && fila.tieneFichaje) return false
    if (f.salidaAutomatica === 'si' && !fila.salidaAutomatica) return false
    if (f.salidaAutomatica === 'no' && fila.salidaAutomatica) return false
    if (f.soloPendientes && !requiereRevision(fila)) return false
    return true
  })
}

// ── Resumen del mes ──────────────────────────────────────────────────────────

export interface ResumenBandejaMensual {
  total: number
  pendientes: number
  porEstado: Record<EstadoRevision, number>
  /** true cuando no queda nada esperando acción: el mes está al día. */
  cerrado: boolean
}

export function resumenBandejaMensual(filas: FilaBandejaMensual[]): ResumenBandejaMensual {
  const porEstado = Object.fromEntries(
    ESTADOS_REVISION.map(e => [e, 0]),
  ) as Record<EstadoRevision, number>

  let pendientes = 0
  for (const fila of filas) {
    porEstado[estadoRevision(fila)] += 1
    if (requiereRevision(fila)) pendientes += 1
  }
  return {
    total: filas.length,
    pendientes,
    porEstado,
    // Un mes sin registros no está "cerrado": no hay nada que revisar todavía.
    cerrado: filas.length > 0 && pendientes === 0,
  }
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

/** "Agosto 2026" a partir de 'YYYY-MM'. */
export function nombreMes(mes: string): string {
  const [anio, num] = mes.split('-').map(Number)
  return `${MESES[(num || 1) - 1] ?? mes} ${anio || ''}`.trim()
}

/** "Agosto 2026 — 12 pendientes de 340 registros" */
export function etiquetaResumenMes(mes: string, r: ResumenBandejaMensual): string {
  const nombre = nombreMes(mes)
  if (r.total === 0) return `${nombre} — sin registros para revisar`
  if (r.pendientes === 0) return `${nombre} — al día · ${r.total} registro${r.total !== 1 ? 's' : ''}`
  return `${nombre} — ${r.pendientes} pendiente${r.pendientes !== 1 ? 's' : ''} de ${r.total} registro${r.total !== 1 ? 's' : ''}`
}

// ── Opciones de los desplegables ─────────────────────────────────────────────
// Se derivan de las filas del mes: solo se ofrece filtrar por lo que realmente
// aparece, en vez de listar todos los vigiladores y objetivos del sistema.

export interface OpcionFiltro {
  id: string
  nombre: string
}

const opciones = (
  filas: FilaBandejaMensual[],
  id: (f: FilaBandejaMensual) => string | null,
  nombre: (f: FilaBandejaMensual) => string,
): OpcionFiltro[] => {
  const mapa = new Map<string, string>()
  for (const f of filas) {
    const k = id(f)
    if (k) mapa.set(k, nombre(f))
  }
  return [...mapa.entries()]
    .map(([id, nombre]) => ({ id, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
}

export const opcionesVigilador = (filas: FilaBandejaMensual[]) =>
  opciones(filas, f => f.empleadoId, f => f.vigilador)

export const opcionesObjetivo = (filas: FilaBandejaMensual[]) =>
  opciones(filas, f => f.objetivoId, f => f.objetivo)

export const opcionesPuesto = (filas: FilaBandejaMensual[]) =>
  opciones(filas, f => f.puestoId, f => f.puesto)

// ── Alcance de datos ─────────────────────────────────────────────────────────

/**
 * Administración ve todos los objetivos; supervisión, solo los de sus zonas.
 * Un supervisor sin zonas asignadas conserva el alcance total, que es la regla
 * que ya aplican las RPC de programación — no se cambia acá.
 *
 * Esto solo decide qué se muestra: la RLS del servidor sigue siendo el límite
 * real de lo que cada usuario puede leer.
 */
export function objetivoEnAlcance(
  objetivoZonaId: string | null | undefined,
  esAdmin: boolean,
  zonasDelSupervisor: ReadonlySet<string> | null,
): boolean {
  if (esAdmin) return true
  if (!zonasDelSupervisor || zonasDelSupervisor.size === 0) return true
  return !!objetivoZonaId && zonasDelSupervisor.has(objetivoZonaId)
}
