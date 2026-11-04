// Fuente única de horas: Reportes → Planilla objetivo y Facturación leen las
// mismas filas (lib/planilla-objetivo). Liquidación usa la misma función por
// registro (resolverLineaLiquidacion). Una corrección se reconoce una vez.
import { describe, it, expect } from 'vitest'
import { filasHorasObjetivo, totalesHorasObjetivo } from '@/lib/planilla-objetivo'
import { horasDelObjetivo, minutosAprobables } from '@/lib/facturacion/horas'
import { periodoFacturacion } from '@/lib/facturacion/periodos'
import { proponerHoras } from '@/lib/facturacion/servidor'
import { effectiveGuardia, esPeriodoTransicion, resolverLineaLiquidacion, selectRegistroPrincipal } from '@/lib/liquidacion'
import { esCapacitacion } from '@/lib/caracteristica-turno'

const OBJ = 'obj-1'
const t = (id: string, fecha: string, ini: string, fin: string, extra: Record<string, unknown> = {}) =>
  ({ id, fecha, hora_inicio: ini, hora_fin: fin, objetivo_id: OBJ, estado: 'programado', puesto_id: 'P1', tipo_evento: 'normal', ...extra })
const r = (id: string, turno_id: string, extra: Record<string, unknown> = {}) => ({ id, turno_id, guardia_id: `g-${id}`, ...extra })

/** Cómo calculaba Reportes ANTES de compartir la función (copia literal de AppClient). */
function reportesAnterior(objetivoId: string, turnosMes: any[], registrosMes: any[]) {
  const turnoPorId = new Map(turnosMes.map(x => [x.id, x]))
  const registrosObjetivo = registrosMes.filter(x => (x.objetivo_final_id ?? turnoPorId.get(x.turno_id)?.objetivo_id) === objetivoId)
  const conReg = new Set(registrosObjetivo.map(x => x.turno_id))
  const filas: any[] = []
  for (const reg of registrosObjetivo) {
    const turno = turnoPorId.get(reg.turno_id); if (!turno) continue
    filas.push({ liq: resolverLineaLiquidacion(turno, reg).horasLiquidables, cap: esCapacitacion(turno.tipo_evento), turno: turno.id })
  }
  for (const turno of turnosMes.filter(x => x.objetivo_id === objetivoId && !conReg.has(x.id))) {
    const tr = turno.estado === 'cubierto' && esPeriodoTransicion(turno.fecha)
    const [a, b] = [turno.hora_inicio, turno.hora_fin].map((h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5)))
    filas.push({ liq: tr ? ((b <= a ? b + 1440 : b) - a) / 60 : 0, cap: esCapacitacion(turno.tipo_evento), turno: turno.id })
  }
  const porTurno = new Map<string, any[]>()
  for (const x of registrosObjetivo) porTurno.set(x.turno_id, [...(porTurno.get(x.turno_id) ?? []), x])
  let reales = 0
  for (const rs of Array.from(porTurno.values())) {
    const pg = new Map<string, any[]>()
    for (const x of rs) { const g = effectiveGuardia(x) ?? '__'; pg.set(g, [...(pg.get(g) ?? []), x]) }
    for (const g of Array.from(pg.values())) { const p: any = selectRegistroPrincipal(g); if (p) reales += Math.max(0, Number(p.horas_trabajadas) || 0) }
  }
  const capT = new Set(filas.filter(f => f.cap).map(f => f.turno))
  return { horasReales: reales, horasLiquidables: filas.reduce((s, f) => f.cap ? s : s + (f.liq || 0), 0),
    horasCapacitacion: filas.filter(f => f.cap).reduce((s, f) => s + (f.liq || 0), 0), turnosCapacitacion: capT.size }
}

// Mes con todos los casos: fichado, reconocido por supervisor, corrección, cierre
// automático, capacitación, simultáneos, relevo, registro movido, cobertura anulada.
const TURNOS = [
  t('fich', '2026-10-01', '08:00:00', '20:00:00'),
  t('sup', '2026-10-02', '08:00:00', '20:00:00', { estado: 'cubierto' }),
  t('corr', '2026-10-03', '06:00:00', '18:00:00'),
  t('auto', '2026-10-04', '20:00:00', '08:00:00'),
  t('cap', '2026-10-05', '08:00:00', '16:00:00', { tipo_evento: 'capacitacion' }),
  t('s1', '2026-10-06', '10:00:00', '20:00:00'), t('s2', '2026-10-06', '10:00:00', '20:00:00'),
  t('rA', '2026-10-07', '06:00:00', '18:00:00'), t('rB', '2026-10-07', '17:00:00', '05:00:00'),
  t('otro', '2026-10-08', '08:00:00', '16:00:00', { objetivo_id: 'obj-2' }),
  t('anul', '2026-10-09', '08:00:00', '16:00:00'),
  t('desc', '2026-10-10', '08:00:00', '16:00:00'),
]
const REGISTROS = [
  r('1', 'fich', { hora_entrada_real: '07:55:00', hora_salida_real: '20:02:00', horas_trabajadas: 12.1 }),
  r('2', 'sup', { horas_liquidables: 12, tipo_registro: 'carga_manual', origen_cobertura: 'confirmacion_supervisor' }),
  r('3', 'corr', { hora_entrada_real: '06:00:00', hora_salida_real: '15:00:00', hora_salida_final: '17:00:00', horas_trabajadas: 9 }),
  r('4', 'auto', { hora_entrada_real: '20:00:00', hora_salida_final: '08:00:00', horas_liquidables: 12, cierre_automatico: true }),
  r('5', 'cap', { hora_entrada_real: '08:00:00', hora_salida_real: '16:00:00', horas_trabajadas: 8 }),
  r('6', 's1', { hora_entrada_real: '10:00:00', hora_salida_real: '20:00:00', horas_trabajadas: 10 }),
  r('7', 's2', { hora_entrada_real: '10:00:00', hora_salida_real: '20:00:00', horas_trabajadas: 10 }),
  r('8', 'rA', { hora_entrada_real: '06:00:00', hora_salida_real: '18:00:00', horas_trabajadas: 12 }),
  r('9', 'rB', { hora_entrada_real: '17:00:00', hora_salida_real: '05:00:00', horas_trabajadas: 12 }),
  r('10', 'otro', { hora_entrada_real: '08:00:00', hora_salida_real: '16:00:00', horas_trabajadas: 8, objetivo_final_id: OBJ }),
  r('11', 'anul', { hora_entrada_real: '08:00:00', hora_salida_real: '16:00:00', horas_trabajadas: 8, cobertura_anulada_at: '2026-10-09T20:00:00Z' }),
]
const oct = periodoFacturacion({ tipo: 'mes_calendario' }, '2026-10')
const AHORA = new Date('2026-11-03T12:00:00Z')
const fact = (turnos = TURNOS, registros: any[] = REGISTROS, superposicion: 'unir' | 'sumar' = 'unir') =>
  horasDelObjetivo({ objetivoId: OBJ, periodo: oct, turnos: turnos as any, registros: registros as any, franjaNocturna: null, separarDiurnaNocturna: false, superposicion, ahora: AHORA })

describe('fuente única: Reportes → Planilla objetivo', () => {
  it('Reportes da exactamente lo mismo que antes de compartir la función', () => {
    expect(totalesHorasObjetivo(filasHorasObjetivo(OBJ, TURNOS as any, REGISTROS as any))).toEqual(reportesAnterior(OBJ, TURNOS, REGISTROS))
  })

  it('período de transición (jun–jul 2026): el turno cubierto sin registro vale lo programado, igual que antes', () => {
    const tr = [t('j1', '2026-07-10', '22:00:00', '06:00:00', { estado: 'cubierto' }), t('j2', '2026-07-11', '08:00:00', '08:00:00', { estado: 'cubierto' })]
    expect(totalesHorasObjetivo(filasHorasObjetivo(OBJ, tr as any, []))).toEqual(reportesAnterior(OBJ, tr, []))
    expect(totalesHorasObjetivo(filasHorasObjetivo(OBJ, tr as any, [])).horasLiquidables).toBe(32)
  })

  it('Facturación recibe las mismas horas liquidables que muestra Reportes', () => {
    const rep = totalesHorasObjetivo(filasHorasObjetivo(OBJ, TURNOS as any, REGISTROS as any))
    const h = fact()
    expect(h.minutosLiquidables).toBe(Math.round(rep.horasLiquidables * 60))
    expect(h.minutosCapacitacionLiquidables).toBe(Math.round(rep.horasCapacitacion * 60))
    expect(h.minutosReales).toBe(Math.round(rep.horasReales * 60))
  })

  it('reglas comerciales sobre esa base: − capacitación (ya fuera), − relevo, simultáneos se facturan', () => {
    const h = fact()
    // fichado 12 + supervisor 12 + corrección 11 + cierre auto 12 + simultáneos 20 + relevo 24 + movido 8 = 99 h
    expect(h.minutosLiquidables).toBe(99 * 60)
    expect(h.minutosSuperpuestos).toBe(60)          // relevo rA/rB: 1 h una sola vez
    expect(h.minutosCubiertos).toBe(98 * 60)
    expect(h.minutosSimultaneos).toBe(600)           // el segundo vigilador del 06/10
    expect(h.minutosCapacitacionLiquidables).toBe(480)
    expect(fact(TURNOS, REGISTROS, 'sumar').minutosCubiertos).toBe(99 * 60)
    // Descubierto: 1 h de la corrección + el turno anulado (cobertura anulada) + el turno sin registro.
    expect(h.minutosDescubiertos).toBe(60 + 480 + 480)
    expect(minutosAprobables(h, 'no_facturar').aprobados).toBe(98 * 60)
  })

  it('corrección posterior: el supervisor reconoce un turno sin fichaje → Reportes y Facturación cambian igual', () => {
    const antes = { rep: totalesHorasObjetivo(filasHorasObjetivo(OBJ, TURNOS as any, REGISTROS as any)).horasLiquidables, fac: fact().minutosCubiertos }
    const corregidos = [...REGISTROS, r('12', 'desc', { horas_liquidables: 8, tipo_registro: 'carga_manual', origen_cobertura: 'confirmacion_supervisor' })]
    const despues = { rep: totalesHorasObjetivo(filasHorasObjetivo(OBJ, TURNOS as any, corregidos as any)).horasLiquidables, fac: fact(TURNOS, corregidos).minutosCubiertos }
    expect(despues.rep - antes.rep).toBe(8)
    expect(despues.fac - antes.fac).toBe(8 * 60)
    expect(fact(TURNOS, corregidos).minutosDescubiertos).toBe(60 + 480)
  })
})

// Cliente Supabase mínimo para proponerHoras: contrato, turnos, registros y una aprobación previa.
function db(registros: any[], aprobada: any) {
  let lecturasRegistros = 0
  return {
    from: (tabla: string) => {
      const q: any = {
        select: () => q, eq: () => q, gte: () => q, lt: () => q, in: () => q, order: () => q,
        single: async () => ({ data: { id: 'k1', regla_periodo: 'mes_calendario', superposicion: 'unir' }, error: null }),
        maybeSingle: async () => ({ data: tabla === 'fact_horas_aprobaciones' ? aprobada : null, error: null }),
        range: async (a: number) => {
          if (a > 0) return { data: [], error: null }
          if (tabla === 'turnos') return { data: TURNOS.filter(x => x.objetivo_id === OBJ), error: null }
          if (tabla === 'registros_asistencia') return { data: lecturasRegistros++ === 0 ? registros.filter(x => x.objetivo_final_id === OBJ) : registros, error: null }
          return { data: [], error: null }
        },
      }
      return q
    },
  } as any
}

describe('cambio posterior a la aprobación', () => {
  it('la aprobación no se pisa: se informa la diferencia para revisar', async () => {
    const base = await proponerHoras(db(REGISTROS, null), { contratoId: 'k1', objetivoId: OBJ, mes: '2026-10' })
    const aprobada = { id: 'ap1', minutos_cubiertos: base.horas.minutosCubiertos, minutos_descubiertos: base.horas.minutosDescubiertos, aprobado_at: '2026-11-01T12:00:00Z' }
    const sinCambios = await proponerHoras(db(REGISTROS, aprobada), { contratoId: 'k1', objetivoId: OBJ, mes: '2026-10' })
    expect(sinCambios.desvio?.hayDiferencia).toBe(false)
    const corregidos = [...REGISTROS, r('12', 'desc', { horas_liquidables: 8 })]
    const conCambio = await proponerHoras(db(corregidos, aprobada), { contratoId: 'k1', objetivoId: OBJ, mes: '2026-10' })
    expect(conCambio.desvio).toMatchObject({ hayDiferencia: true, cubiertosAprobados: base.horas.minutosCubiertos, cubiertosActuales: base.horas.minutosCubiertos + 480 })
  })
})
