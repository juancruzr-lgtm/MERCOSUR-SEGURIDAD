/**
 * lib/tablero-gerencia/historico.ts
 *
 * Comparación de TODOS los meses con datos en la app, en pocas cifras.
 * Horas: la misma regla oficial del tablero (lineaHoras). Fichajes: sobre los
 * turnos ya terminados con obligación de servicio. El mes en curso se marca
 * como parcial y se compara contra el mes anterior hasta el mismo día.
 *
 * Función pura.
 */

import { lineaHoras, type RegistroHoras, type TurnoHoras } from './horas'
import { ESTADOS_SIN_OBLIGACION } from '@/lib/revision-operativa'

export interface RegistroHistorico extends RegistroHoras {
  alerta_entrada?: string | null
  gps_ingreso_estado?: string | null
}

export interface FilaMes {
  mes: string
  parcial: boolean
  /** hasta qué día del mes se contó (sólo mes en curso) */
  hastaDia: number | null
  turnos: number
  horas: number
  conFichaje: number
  sinFichaje: number
  ausencias: number
  tarde: number
  fueraRadio: number
  supervisiones: number
  objetivosSupervisados: number
  alertasRonda: number
  facturado: number | null
  avisos: string[]
}

export interface Indicador {
  clave: keyof Pick<FilaMes, 'horas' | 'turnos' | 'sinFichaje' | 'tarde' | 'fueraRadio' | 'supervisiones' | 'alertasRonda' | 'facturado'> | 'pctFichaje'
  titulo: string
  /** true = que suba es bueno */
  subirEsBueno: boolean
  formato: 'horas' | 'numero' | 'pct' | 'pesos'
}

export const INDICADORES: Indicador[] = [
  { clave: 'horas', titulo: 'Horas trabajadas', subirEsBueno: true, formato: 'horas' },
  { clave: 'turnos', titulo: 'Turnos cumplidos o a cumplir', subirEsBueno: true, formato: 'numero' },
  { clave: 'pctFichaje', titulo: 'Turnos con fichaje', subirEsBueno: true, formato: 'pct' },
  { clave: 'sinFichaje', titulo: 'Turnos sin fichaje', subirEsBueno: false, formato: 'numero' },
  { clave: 'tarde', titulo: 'Llegadas tarde', subirEsBueno: false, formato: 'numero' },
  { clave: 'fueraRadio', titulo: 'Fichajes fuera del lugar', subirEsBueno: false, formato: 'numero' },
  { clave: 'supervisiones', titulo: 'Visitas de supervisión', subirEsBueno: true, formato: 'numero' },
  { clave: 'alertasRonda', titulo: 'Alertas de rondas', subirEsBueno: false, formato: 'numero' },
  { clave: 'facturado', titulo: 'Facturación (prefacturas)', subirEsBueno: true, formato: 'pesos' },
]

export function valor(f: FilaMes, c: Indicador['clave']): number | null {
  if (c === 'pctFichaje') return f.turnos ? Math.round((f.conFichaje / f.turnos) * 1000) / 10 : null
  const v = f[c]
  return v == null ? null : v
}

const red = (n: number) => Math.round(n * 10) / 10

/** Fin del turno en ms (hora argentina, UTC−3). */
function finTurno(t: TurnoHoras): number {
  const ini = Date.parse(`${t.fecha}T${(t.hora_inicio ?? '00:00').slice(0, 5)}:00-03:00`)
  let fin = Date.parse(`${t.fecha}T${(t.hora_fin ?? '00:00').slice(0, 5)}:00-03:00`)
  if (fin <= ini) fin += 86_400_000
  return fin
}

export function filasHistoricas(p: {
  ahoraIso: string
  turnos: TurnoHoras[]
  registros: RegistroHistorico[]
  supervisiones: { objetivo_id: string; created_at: string; estado?: string | null }[]
  alertasRonda: { ventana_inicio: string }[]
  facturacion: { mes: string; total: number }[] | null
  /** Turnos de prueba u objetivos excluidos */
  objetivoValido?: (id: string | null) => boolean
}): FilaMes[] {
  const ahora = Date.parse(p.ahoraIso)
  const hoy = new Date(ahora - 3 * 3_600_000).toISOString().slice(0, 10)
  const mesActual = hoy.slice(0, 7)
  const diaHoy = Number(hoy.slice(8, 10))
  const ok = p.objetivoValido ?? (() => true)
  const porTurno = new Map<string, RegistroHistorico[]>()
  for (const r of p.registros) porTurno.set(r.turno_id, [...(porTurno.get(r.turno_id) ?? []), r])

  const filas = new Map<string, FilaMes>()
  const fila = (mes: string) => {
    let f = filas.get(mes)
    if (!f) {
      f = { mes, parcial: mes === mesActual, hastaDia: mes === mesActual ? diaHoy : null, turnos: 0, horas: 0, conFichaje: 0, sinFichaje: 0, ausencias: 0, tarde: 0, fueraRadio: 0, supervisiones: 0, objetivosSupervisados: 0, alertasRonda: 0, facturado: null, avisos: [] }
      filas.set(mes, f)
    }
    return f
  }

  for (const t of p.turnos) {
    if (!ok(t.objetivo_id ?? null) || ESTADOS_SIN_OBLIGACION.has(t.estado ?? '')) continue
    if (finTurno(t) > ahora) continue // todavía no terminó
    const f = fila(t.fecha.slice(0, 7))
    const regs = porTurno.get(t.id) ?? []
    const vigentes = regs.filter(r => !r.registro_anulado_at)
    const l = lineaHoras(t, regs)
    f.turnos++
    f.horas += l.oficiales
    if (vigentes.some(r => r.tipo_registro === 'ausencia')) { f.ausencias++; continue }
    const conEntrada = vigentes.find(r => r.hora_entrada_real)
    if (conEntrada) {
      f.conFichaje++
      if (conEntrada.alerta_entrada === 'tarde') f.tarde++
      if (conEntrada.gps_ingreso_estado === 'fuera_radio') f.fueraRadio++
    } else f.sinFichaje++
  }

  const objSup = new Map<string, Set<string>>()
  for (const s of p.supervisiones) {
    if (!ok(s.objetivo_id)) continue
    const mes = new Date(Date.parse(s.created_at) - 3 * 3_600_000).toISOString().slice(0, 7)
    if (!filas.has(mes)) continue
    fila(mes).supervisiones++
    objSup.set(mes, (objSup.get(mes) ?? new Set()).add(s.objetivo_id))
  }
  objSup.forEach((set, mes) => { fila(mes).objetivosSupervisados = set.size })
  for (const a of p.alertasRonda) {
    const mes = new Date(Date.parse(a.ventana_inicio) - 3 * 3_600_000).toISOString().slice(0, 7)
    if (filas.has(mes)) fila(mes).alertasRonda++
  }
  for (const x of p.facturacion ?? []) if (filas.has(x.mes)) fila(x.mes).facturado = red((fila(x.mes).facturado ?? 0) + x.total)

  const lista = Array.from(filas.values()).sort((a, b) => a.mes.localeCompare(b.mes))
  for (const f of lista) {
    f.horas = red(f.horas)
    if (f.turnos > 0 && f.conFichaje + f.ausencias === 0) f.avisos.push('Sin fichajes cargados en la app: sólo turnos programados')
    else if (f.turnos > 0 && f.conFichaje / f.turnos < 0.5) f.avisos.push('Pocos fichajes: la app recién se empezaba a usar')
    if (f.mes === '2026-06' || f.mes === '2026-07') f.avisos.push('Período de transición: algunas horas se tomaron como cubiertas sin fichaje')
    if (f.parcial) f.avisos.push(`Mes en curso (hasta el día ${f.hastaDia})`)
  }
  return lista
}

export interface Variacion { delta: number; pct: number | null; mejora: boolean | null }

export function variacion(actual: number | null, anterior: number | null, ind: Indicador): Variacion | null {
  if (actual == null || anterior == null) return null
  const delta = Math.round((actual - anterior) * 10) / 10
  const pct = anterior !== 0 && ind.formato !== 'pct' ? Math.round(((actual - anterior) / Math.abs(anterior)) * 1000) / 10 : null
  return { delta, pct, mejora: delta === 0 ? null : (delta > 0) === ind.subirEsBueno }
}

/**
 * Comparación del mes en curso contra el anterior HASTA EL MISMO DÍA
 * (si no, un mes a medias siempre "baja"). Recalcula el mes anterior cortado.
 */
export function cortarHastaDia<T extends { fecha: string }>(turnos: T[], mes: string, dia: number): T[] {
  return turnos.filter(t => t.fecha.slice(0, 7) !== mes || Number(t.fecha.slice(8, 10)) <= dia)
}

/** Frases simples para leer la comparación sin mirar la tabla. */
export function resumenEnPalabras(filas: FilaMes[], filasMismoDiaAnterior: FilaMes | null): string[] {
  const completas = filas.filter(f => !f.parcial && f.conFichaje > 0)
  const out: string[] = []
  const nombreMes = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  const n = (x: number) => x.toLocaleString('es-AR', { maximumFractionDigits: 0 })
  if (completas.length >= 2) {
    const [a, b] = completas.slice(-2)
    const v = b.horas - a.horas
    out.push(`En ${nombreMes(b.mes)} se trabajaron ${n(b.horas)} horas, ${n(Math.abs(v))} ${v >= 0 ? 'más' : 'menos'} que en ${nombreMes(a.mes)} (${v >= 0 ? '+' : '−'}${Math.abs(Math.round((v / (a.horas || 1)) * 1000) / 10)} %).`)
    const sa = a.turnos ? a.sinFichaje / a.turnos : 0, sb = b.turnos ? b.sinFichaje / b.turnos : 0
    out.push(`Turnos sin fichaje: ${Math.round(sb * 1000) / 10} % en ${nombreMes(b.mes)} contra ${Math.round(sa * 1000) / 10} % el mes anterior (${sb <= sa ? 'mejoró' : 'empeoró'}).`)
    out.push(`Supervisión: ${n(b.supervisiones)} visitas en ${nombreMes(b.mes)} contra ${n(a.supervisiones)} el mes anterior.`)
    const mejorMes = completas.reduce((m, f) => (f.horas > m.horas ? f : m))
    out.push(`El mes con más horas trabajadas fue ${nombreMes(mejorMes.mes)} (${n(mejorMes.horas)} h).`)
  }
  const actual = filas.find(f => f.parcial)
  if (actual && filasMismoDiaAnterior) {
    const v = actual.horas - filasMismoDiaAnterior.horas
    out.push(`Mes en curso: hasta el día ${actual.hastaDia} van ${n(actual.horas)} horas, ${n(Math.abs(v))} ${v >= 0 ? 'más' : 'menos'} que el mes pasado a la misma altura.`)
  }
  return out
}
