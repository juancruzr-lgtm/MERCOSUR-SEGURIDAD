/**
 * lib/cobertura-turnos.ts
 *
 * Cobertura REAL de un turno, incluyendo los reemplazos, y control de doble
 * liquidación. Espejo en TypeScript de `public.turno_coberturas` /
 * `public.cobertura_real_turno` (migración 20261121120000): misma regla, para
 * que Dashboard, Planillas y Reportes den el mismo número que la base.
 *
 * Reglas fijas del negocio (no cambiar acá):
 *   · horas liquidables = horas efectivamente cubiertas y respaldadas por evidencia;
 *   · no hay categoría aparte de horas extra;
 *   · un turno que cruza la medianoche pertenece al día en que EMPIEZA;
 *   · Dashboard, Planillas y Reportes deben coincidir.
 *
 * Qué es un REEMPLAZO de un turno T: otro turno T2 del mismo puesto (o del
 * mismo objetivo si T no tiene puesto), de OTRO vigilador, con obligación, que
 * se superpone con T y que
 *   a) declara `reemplaza_turno_id = T.id` (vínculo explícito, nuevo), o
 *   b) sin vínculo, fue creado DESPUÉS que T (más de 5 min) y no antes de
 *      12 h previas al inicio de T. Es la huella de un reemplazo armado sobre
 *      la marcha (caso Lotuf 29/10: el turno de González se creó a las 15:05
 *      para un turno que empezaba a las 15:00). Un puesto con dos posiciones
 *      planificadas a la vez NO entra: esas se crean juntas, antes del día.
 *
 * Doble liquidación: la suma de horas liquidadas del titular y las atribuidas
 * a sus reemplazos (proporcionales al solapamiento) supera las horas
 * programadas del turno. El excedente es lo que se estaría pagando dos veces.
 */

import { ESTADOS_TURNO_SIN_OBLIGACION_COBERTURA } from '@/lib/turnos'
import {
  effectiveGuardia,
  resolverLineaLiquidacion,
  selectRegistroPrincipal,
  type RegistroUniverso,
  type TurnoUniverso,
} from '@/lib/liquidacion'
import { intervaloTurno } from '@/lib/validacion-turnos'

export interface TurnoCobertura extends TurnoUniverso {
  guardia_id?: string | null
  puesto_id?: string | null
  created_at?: string | null
  reemplaza_turno_id?: string | null
}

export interface RegistroCobertura extends RegistroUniverso {
  tipo_registro?: string | null
  registro_anulado_at?: string | null
}

export type TipoEvidencia = 'fichaje' | 'foto_o_ronda' | 'excepcion_autorizada' | 'sin_evidencia' | 'sin_registro'

export interface CoberturaParcial {
  turnoId: string
  guardiaId: string | null
  rol: 'titular' | 'reemplazo'
  evidencia: TipoEvidencia
  minutosSolapados: number
  horasLiquidables: number
  horasAtribuidas: number
}

export interface CoberturaRealTurno {
  turnoId: string
  /** Día de atribución: el de inicio, aunque el turno cruce la medianoche. */
  fecha: string
  horasProgramadas: number
  horasCubiertasConEvidencia: number
  horasLiquidadas: number
  horasDobleLiquidacion: number
  estado: 'cubierto_titular' | 'cubierto_reemplazo' | 'parcial' | 'descubierto' | 'doble_liquidacion'
  coberturas: CoberturaParcial[]
}

export interface OpcionesCobertura {
  /** Claves `${turnoId}:${guardiaId}` con fotos de ingreso o rondas del turno. */
  evidenciaExterna?: Set<string>
  /** Registros con excepción autorizada (ids de registros_asistencia). */
  registrosConExcepcion?: Set<string>
}

const SIN_OBLIGACION = new Set<string>(ESTADOS_TURNO_SIN_OBLIGACION_COBERTURA)
const MS_MIN = 60_000

const tieneObligacion = (t: { estado?: string | null }) => !SIN_OBLIGACION.has(t.estado ?? '')

/** Instante (ms) del inicio del turno en hora Argentina (UTC-3, sin horario de verano). */
export function inicioTurnoMs(t: Pick<TurnoCobertura, 'fecha' | 'hora_inicio'>): number {
  return Date.parse(`${t.fecha}T${t.hora_inicio.slice(0, 5)}:00-03:00`)
}

function mismoPuesto(a: TurnoCobertura, b: TurnoCobertura): boolean {
  if (a.puesto_id || b.puesto_id) return !!a.puesto_id && a.puesto_id === b.puesto_id
  return !!a.objetivo_id && a.objetivo_id === b.objetivo_id
}

function solapamientoMin(a: TurnoCobertura, b: TurnoCobertura): number {
  const ra = intervaloTurno(a)
  const rb = intervaloTurno(b)
  if (!ra || !rb) return 0
  return Math.max(0, Math.min(ra.fin, rb.fin) - Math.max(ra.inicio, rb.inicio))
}

export function esReemplazoDe(candidato: TurnoCobertura, base: TurnoCobertura): boolean {
  if (candidato.id === base.id) return false
  if (!candidato.guardia_id || candidato.guardia_id === base.guardia_id) return false
  if (!tieneObligacion(candidato)) return false
  if (!mismoPuesto(candidato, base)) return false
  if (solapamientoMin(candidato, base) <= 0) return false
  if (candidato.reemplaza_turno_id) return candidato.reemplaza_turno_id === base.id
  if (!candidato.created_at || !base.created_at) return false
  const creado = Date.parse(candidato.created_at)
  return creado > Date.parse(base.created_at) + 5 * MS_MIN
    && creado > inicioTurnoMs(base) - 12 * 60 * MS_MIN
}

function registrosDeGuardia(registros: RegistroCobertura[], turnoId: string, guardiaId: string | null): RegistroCobertura[] {
  return registros.filter(r =>
    r.turno_id === turnoId
    && r.tipo_registro !== 'ausencia'
    && !r.registro_anulado_at
    && (guardiaId == null || effectiveGuardia(r) === guardiaId))
}

function evidenciaDe(
  turno: TurnoCobertura,
  guardiaId: string | null,
  principal: RegistroCobertura | undefined,
  todos: RegistroCobertura[],
  opciones: OpcionesCobertura,
): TipoEvidencia {
  if (todos.some(r => r.hora_entrada_real != null && r.cobertura_anulada_at == null)) return 'fichaje'
  if (guardiaId && opciones.evidenciaExterna?.has(`${turno.id}:${guardiaId}`)) return 'foto_o_ronda'
  if (!principal) return 'sin_registro'
  if (principal.id && opciones.registrosConExcepcion?.has(principal.id)) return 'excepcion_autorizada'
  return 'sin_evidencia'
}

/**
 * Cobertura real de `turno`, mirando a sus reemplazos dentro de `universo`
 * (turnos vecinos del mismo puesto) y los `registros` de todos ellos.
 */
export function coberturaRealTurno(
  turno: TurnoCobertura,
  universo: TurnoCobertura[],
  registros: RegistroCobertura[],
  opciones: OpcionesCobertura = {},
): CoberturaRealTurno {
  const rango = intervaloTurno(turno)
  const minutosProgramados = rango ? rango.fin - rango.inicio : 0
  const horasProgramadas = minutosProgramados / 60

  const parcial = (t: TurnoCobertura, rol: CoberturaParcial['rol']): CoberturaParcial => {
    const guardiaId = t.guardia_id ?? null
    const propios = registrosDeGuardia(registros, t.id, guardiaId)
    const principal = selectRegistroPrincipal(propios)
    const horasLiquidables = tieneObligacion(t) ? resolverLineaLiquidacion(t, principal ?? null).horasLiquidables : 0
    const minutosSolapados = rol === 'titular' ? minutosProgramados : solapamientoMin(t, turno)
    const rt = intervaloTurno(t)
    const durT = rt ? rt.fin - rt.inicio : 0
    return {
      turnoId: t.id,
      guardiaId,
      rol,
      evidencia: evidenciaDe(t, guardiaId, principal, propios, opciones),
      minutosSolapados,
      horasLiquidables,
      horasAtribuidas: rol === 'titular' || durT === 0 ? horasLiquidables : horasLiquidables * (minutosSolapados / durT),
    }
  }

  const coberturas: CoberturaParcial[] = [parcial(turno, 'titular')]
  for (const t2 of universo) {
    if (esReemplazoDe(t2, turno)) coberturas.push(parcial(t2, 'reemplazo'))
  }

  const conEvidencia = (c: CoberturaParcial) =>
    c.evidencia === 'fichaje' || c.evidencia === 'foto_o_ronda' || c.evidencia === 'excepcion_autorizada'

  // Minutos cubiertos con evidencia: unión de intervalos dentro del turno.
  const tramos: [number, number][] = []
  if (rango) {
    for (const c of coberturas) {
      if (!conEvidencia(c)) continue
      const t = c.rol === 'titular' ? turno : universo.find(u => u.id === c.turnoId)
      const r = t ? intervaloTurno(t) : null
      if (!r) continue
      const a = Math.max(r.inicio, rango.inicio)
      const b = Math.min(r.fin, rango.fin)
      if (b > a) tramos.push([a, b])
    }
  }
  tramos.sort((x, y) => x[0] - y[0])
  let cubiertos = 0
  let hasta = -Infinity
  for (const [a, b] of tramos) {
    const desde = Math.max(a, hasta)
    if (b > desde) cubiertos += b - desde
    hasta = Math.max(hasta, b)
  }

  const redondear = (n: number) => Math.round(n * 100) / 100
  const horasLiquidadas = redondear(coberturas.reduce((s, c) => s + c.horasAtribuidas, 0))
  const horasDobleLiquidacion = redondear(Math.max(0, horasLiquidadas - horasProgramadas))
  const horasCubiertasConEvidencia = redondear(cubiertos / 60)

  const titular = coberturas[0]
  const estado: CoberturaRealTurno['estado'] =
    horasDobleLiquidacion > 0.01 ? 'doble_liquidacion'
      : cubiertos >= minutosProgramados && minutosProgramados > 0
        ? (conEvidencia(titular) ? 'cubierto_titular' : 'cubierto_reemplazo')
        : cubiertos > 0 ? 'parcial' : 'descubierto'

  return {
    turnoId: turno.id,
    fecha: turno.fecha,
    horasProgramadas: redondear(horasProgramadas),
    horasCubiertasConEvidencia,
    horasLiquidadas,
    horasDobleLiquidacion,
    estado,
    coberturas,
  }
}

/** Turnos con obligación cuyo intervalo se estaría liquidando más de una vez. */
export function detectarDobleLiquidacion(
  turnos: TurnoCobertura[],
  registros: RegistroCobertura[],
  opciones: OpcionesCobertura = {},
): CoberturaRealTurno[] {
  return turnos
    .filter(tieneObligacion)
    .map(t => coberturaRealTurno(t, turnos, registros, opciones))
    .filter(c => c.horasDobleLiquidacion > 0.01)
}

// ── Consistencia Dashboard / Planillas / Reportes ────────────────────────────

export interface FuenteHoras {
  nombre: string
  /** Horas por clave `${guardiaId}|${fecha}` según esa pantalla o reporte. */
  horas: Map<string, number>
}

export interface DiferenciaHoras {
  clave: string
  guardiaId: string
  fecha: string
  esperado: number
  porFuente: Record<string, number>
}

export interface ResultadoConsistencia {
  /** Horas esperadas por `${guardiaId}|${fecha}` (fecha = día de inicio del turno). */
  esperado: Map<string, number>
  diferencias: DiferenciaHoras[]
  dobleLiquidacion: CoberturaRealTurno[]
  consistente: boolean
}

/**
 * Horas liquidables esperadas por vigilador y día de inicio, con la misma
 * regla que la liquidación (`resolverLineaLiquidacion` sobre el registro
 * principal de cada turno). Un nocturno 22–06 suma entero en su día de inicio.
 */
export function horasEsperadasPorGuardiaDia(
  turnos: TurnoCobertura[],
  registros: RegistroCobertura[],
): Map<string, number> {
  const res = new Map<string, number>()
  for (const t of turnos) {
    if (!tieneObligacion(t)) continue
    const propios = registros.filter(r => r.turno_id === t.id && r.tipo_registro !== 'ausencia' && !r.registro_anulado_at)
    const principal = selectRegistroPrincipal(propios)
    const linea = resolverLineaLiquidacion(t, principal ?? null)
    if (linea.horasLiquidables <= 0) continue
    const guardia = linea.guardiaEfectivoId ?? t.guardia_id ?? null
    if (!guardia) continue
    const clave = `${guardia}|${t.fecha}`
    res.set(clave, Math.round(((res.get(clave) ?? 0) + linea.horasLiquidables) * 100) / 100)
  }
  return res
}

/**
 * Compara lo que muestran Dashboard, Planillas y Reportes contra lo esperado.
 * Devuelve cada clave en la que alguna fuente difiere en más de `tolerancia`.
 */
export function verificarConsistenciaHoras(
  turnos: TurnoCobertura[],
  registros: RegistroCobertura[],
  fuentes: FuenteHoras[],
  opciones: OpcionesCobertura & { tolerancia?: number } = {},
): ResultadoConsistencia {
  const tolerancia = opciones.tolerancia ?? 0.01
  const esperado = horasEsperadasPorGuardiaDia(turnos, registros)
  const claves = new Set<string>(Array.from(esperado.keys()))
  for (const f of fuentes) f.horas.forEach((_, k) => claves.add(k))

  const diferencias: DiferenciaHoras[] = []
  for (const clave of Array.from(claves).sort()) {
    const e = esperado.get(clave) ?? 0
    const porFuente: Record<string, number> = {}
    let difiere = false
    for (const f of fuentes) {
      const v = f.horas.get(clave) ?? 0
      porFuente[f.nombre] = v
      if (Math.abs(v - e) > tolerancia) difiere = true
    }
    if (difiere) {
      const [guardiaId, fecha] = clave.split('|')
      diferencias.push({ clave, guardiaId, fecha, esperado: e, porFuente })
    }
  }
  const dobleLiquidacion = detectarDobleLiquidacion(turnos, registros, opciones)
  return { esperado, diferencias, dobleLiquidacion, consistente: diferencias.length === 0 && dobleLiquidacion.length === 0 }
}
