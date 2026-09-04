import { describe, expect, it } from 'vitest'
import {
  construirResumenGuardia,
  diasDeNovedadEnMes,
  filasXLSXResumenGuardia,
  plantillaLiquidacionResumenGuardia,
  type NovedadResumen,
  type ParamsResumenGuardia,
  type TurnoResumen,
} from '@/lib/resumen-guardia'
import {
  resolverLineaLiquidacion,
  selectRegistroPrincipal,
  type RegistroUniverso,
} from '@/lib/liquidacion'

// Resumen Guardia: vista derivada del insumo mensual de liquidación.
// Estos tests cubren agrupación, jornadas, exclusiones y novedades.
// Las horas NO se recalculan acá: la única aserción sobre su valor compara
// contra resolverLineaLiquidacion() —la misma función que usa el módulo—,
// nunca contra una segunda implementación.

const OBJ_REAL = 'obj-real'
const OBJ_PRUEBA = 'obj-prueba'
const esPrueba = (id?: string | null) => id === OBJ_PRUEBA
const nombreObjetivo = (id?: string | null) => (id === OBJ_REAL ? 'CLUB' : id ?? '')

const turno = (over: Partial<TurnoResumen> & { id: string }): TurnoResumen => ({
  fecha: '2026-08-10',
  hora_inicio: '07:00',
  hora_fin: '19:00',
  objetivo_id: OBJ_REAL,
  estado: 'cubierto',
  guardia_id: 'g1',
  ...over,
})

const registro = (over: Partial<RegistroUniverso> & { turno_id: string }): RegistroUniverso => ({
  id: `r-${over.turno_id}`,
  guardia_id: 'g1',
  ...over,
})

const base = (over: Partial<ParamsResumenGuardia> = {}): ParamsResumenGuardia => ({
  mes: '2026-08',
  empleados: [{ id: 'g1', nombre: 'ESTANISLAO', apellido: 'ALMADA', cuil: '20144945817' }],
  turnos: [],
  registros: [],
  novedades: [],
  esObjetivoPrueba: esPrueba,
  nombreObjetivo,
  ...over,
})

const fila = (r: ReturnType<typeof construirResumenGuardia>, id = 'g1') =>
  r.filas.find(f => f.empleadoId === id)

describe('construirResumenGuardia', () => {
  it('turno diurno normal: 1 jornada, 1 fecha, horas de la fuente canónica', () => {
    const t = turno({ id: 't1' })
    const r = registro({ turno_id: 't1', horas_liquidables: 12 })
    const res = construirResumenGuardia(base({ turnos: [t], registros: [r] }))
    const f = fila(res)!
    expect(f.jornadas).toBe(1)
    expect(f.fechasConActividad).toBe(1)
    expect(f.horasLiquidables).toBe(resolverLineaLiquidacion(t, r).horasLiquidables)
    expect(f.objetivos).toEqual(['CLUB'])
  })

  it('turno nocturno que cruza medianoche: 1 jornada, 2 fechas con actividad', () => {
    const t = turno({ id: 't1', hora_inicio: '19:00', hora_fin: '07:00' })
    const r = registro({ turno_id: 't1', horas_liquidables: 12 })
    const res = construirResumenGuardia(base({ turnos: [t], registros: [r] }))
    const f = fila(res)!
    expect(f.jornadas).toBe(1)
    expect(f.fechasConActividad).toBe(2)
  })

  it('turno cortado (dos turnos el mismo día) = 1 jornada, horas completas', () => {
    const manana = turno({ id: 't1', hora_inicio: '09:00', hora_fin: '16:00' })
    const noche = turno({ id: 't2', hora_inicio: '18:00', hora_fin: '23:00' })
    const rs = [
      registro({ turno_id: 't1', horas_liquidables: 7 }),
      registro({ turno_id: 't2', horas_liquidables: 5 }),
    ]
    const f = fila(construirResumenGuardia(base({ turnos: [manana, noche], registros: rs })))!
    expect(f.jornadas).toBe(1)
    expect(f.horasLiquidables).toBe(12)
    expect(f.origen.turnoIds.sort()).toEqual(['t1', 't2'])
  })

  it('múltiples turnos del mismo empleado suman jornadas y horas', () => {
    const t1 = turno({ id: 't1', fecha: '2026-08-10' })
    const t2 = turno({ id: 't2', fecha: '2026-08-11' })
    const t3 = turno({ id: 't3', fecha: '2026-08-12' })
    const rs = [
      registro({ turno_id: 't1', horas_liquidables: 12 }),
      registro({ turno_id: 't2', horas_liquidables: 8 }),
      registro({ turno_id: 't3', horas_liquidables: 12 }),
    ]
    const f = fila(construirResumenGuardia(base({ turnos: [t1, t2, t3], registros: rs })))!
    expect(f.jornadas).toBe(3)
    expect(f.fechasConActividad).toBe(3)
    expect(f.horasLiquidables).toBe(32)
  })

  it('valores decimales se conservan (media hora no se redondea a entero)', () => {
    const t = turno({ id: 't1' })
    const r = registro({ turno_id: 't1', horas_liquidables: 11.5 })
    const f = fila(construirResumenGuardia(base({ turnos: [t], registros: [r] })))!
    expect(f.horasLiquidables).toBe(11.5)
  })

  it('feriado nacional trabajado: cuenta feriado y sus horas', () => {
    // 17/08/2026 — feriado nacional del calendario del sistema (lib/feriados).
    const t = turno({ id: 't1', fecha: '2026-08-17' })
    const r = registro({ turno_id: 't1', horas_liquidables: 12 })
    const f = fila(construirResumenGuardia(base({ turnos: [t], registros: [r] })))!
    expect(f.feriadosTrabajados).toBe(1)
    expect(f.horasEnFeriado).toBe(12)
  })

  it('objetivo de prueba: un turno real ahí NO entra al resumen', () => {
    const tPrueba = turno({ id: 't1', objetivo_id: OBJ_PRUEBA })
    const rPrueba = registro({ turno_id: 't1', horas_liquidables: 12 })
    const res = construirResumenGuardia(base({ turnos: [tPrueba], registros: [rPrueba] }))
    expect(res.filas).toHaveLength(0)

    // Y con actividad mixta, sólo cuenta la del objetivo real.
    const tReal = turno({ id: 't2', fecha: '2026-08-11' })
    const rReal = registro({ turno_id: 't2', horas_liquidables: 8 })
    const f = fila(construirResumenGuardia(base({
      turnos: [tPrueba, tReal],
      registros: [rPrueba, rReal],
    })))!
    expect(f.jornadas).toBe(1)
    expect(f.horasLiquidables).toBe(8)
    expect(f.origen.turnoIds).toEqual(['t2'])
  })

  it('empleado sin actividad ni novedades no genera fila', () => {
    const res = construirResumenGuardia(base({
      empleados: [{ id: 'g1' }, { id: 'g2', nombre: 'OTRO', apellido: 'SIN ACTIVIDAD' }],
      turnos: [turno({ id: 't1' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 12 })],
    }))
    expect(res.filas.map(f => f.empleadoId)).toEqual(['g1'])
  })

  it('novedad aprobada: cuenta días del tipo; sin registro del tipo queda null (no 0)', () => {
    const nov: NovedadResumen = {
      id: 'n1', empleado_id: 'g1', tipo: 'licencia',
      fecha_desde: '2026-08-05', fecha_hasta: '2026-08-07', estado: 'aprobada',
    }
    const pendiente: NovedadResumen = {
      id: 'n2', empleado_id: 'g1', tipo: 'vacaciones',
      fecha_desde: '2026-08-20', fecha_hasta: '2026-08-25', estado: 'pendiente',
    }
    const t = turno({ id: 't1' })
    const r = registro({ turno_id: 't1', horas_liquidables: 12 })
    const f = fila(construirResumenGuardia(base({ turnos: [t], registros: [r], novedades: [nov, pendiente] })))!
    expect(f.licencias).toBe(3)
    // vacaciones existe pero NO está aprobada → sin dato, no 0
    expect(f.vacaciones).toBeNull()
    expect(f.art).toBeNull()
    expect(f.notas).toEqual(['licencia 05/08–07/08 (3 d)'])
    expect(f.origen.novedadIds).toEqual(['n1'])
    // Una novedad sola también genera fila (empleado sin turnos en el mes)
    const soloNovedad = construirResumenGuardia(base({ novedades: [nov] }))
    expect(soloNovedad.filas).toHaveLength(1)
    expect(soloNovedad.filas[0].jornadas).toBe(0)
  })

  it('múltiples objetivos en el período: lista alfabética, sin duplicados', () => {
    const t1 = turno({ id: 't1', objetivo_id: OBJ_REAL })
    const t2 = turno({ id: 't2', fecha: '2026-08-11', objetivo_id: 'obj-b' })
    const t3 = turno({ id: 't3', fecha: '2026-08-12', objetivo_id: OBJ_REAL })
    const rs = ['t1', 't2', 't3'].map(id => registro({ turno_id: id, horas_liquidables: 12 }))
    const f = fila(construirResumenGuardia(base({
      turnos: [t1, t2, t3], registros: rs,
      nombreObjetivo: (id) => (id === OBJ_REAL ? 'CLUB' : 'ANTENA'),
    })))!
    expect(f.objetivos).toEqual(['ANTENA', 'CLUB'])
  })

  it('cobertura confirmada por el supervisor acredita jornada y horas', () => {
    const t = turno({ id: 't1' })
    const r = registro({
      turno_id: 't1',
      horas_liquidables: 12,
      origen_cobertura: 'confirmacion_supervisor',
    })
    const f = fila(construirResumenGuardia(base({ turnos: [t], registros: [r] })))!
    expect(f.jornadas).toBe(1)
    expect(f.horasLiquidables).toBe(12)
    // la línea que la origina es exactamente la de la fuente canónica
    expect(resolverLineaLiquidacion(t, r).cargadoPorSupervisor).toBe(true)
  })

  it('varios registros del mismo turno no duplican: un solo registro principal', () => {
    const t = turno({ id: 't1' })
    const gps = registro({ id: 'r-gps', turno_id: 't1', hora_entrada_real: '07:02', hora_salida_real: '19:01', horas_trabajadas: 11.98 })
    const correccion = registro({ id: 'r-corr', turno_id: 't1', horas_liquidables: 12 })
    const f = fila(construirResumenGuardia(base({ turnos: [t], registros: [gps, correccion] })))!
    expect(f.jornadas).toBe(1)
    const principal = selectRegistroPrincipal([gps, correccion], 'g1')!
    expect(f.horasLiquidables).toBe(resolverLineaLiquidacion(t, principal).horasLiquidables)
  })

  it('consistencia total con resolverLineaLiquidacion() sobre un mes variado', () => {
    const turnos = [
      turno({ id: 't1', fecha: '2026-08-01' }),
      turno({ id: 't2', fecha: '2026-08-02', hora_inicio: '19:00', hora_fin: '07:00' }),
      turno({ id: 't3', fecha: '2026-08-17' }),
      turno({ id: 't4', fecha: '2026-08-20', estado: 'anulado' }),          // sin obligación: fuera
      turno({ id: 't5', fecha: '2026-08-21', objetivo_id: OBJ_PRUEBA }),    // prueba: fuera
    ]
    const registros = [
      registro({ turno_id: 't1', horas_liquidables: 12 }),
      registro({ turno_id: 't2', horas_liquidables: 11.5 }),
      registro({ turno_id: 't3', hora_entrada_real: '07:00', hora_salida_real: '19:00', horas_trabajadas: 12 }),
      registro({ turno_id: 't4', horas_liquidables: 12 }),
      registro({ turno_id: 't5', horas_liquidables: 12 }),
    ]
    const f = fila(construirResumenGuardia(base({ turnos, registros })))!
    const esperado = [0, 1, 2].map(i => resolverLineaLiquidacion(turnos[i], registros[i]).horasLiquidables)
      .reduce((a, b) => a + b, 0)
    expect(f.horasLiquidables).toBe(Math.round(esperado * 100) / 100)
    expect(f.origen.turnoIds.sort()).toEqual(['t1', 't2', 't3'])
    expect(f.jornadas).toBe(3)
  })
})

// ── Novedad mensual informada (cantidad sin fechas exactas) ─────────────────
// La deduplicación vive en la IMPORTACIÓN: una mensual se carga por la
// diferencia contra lo ya registrado con fechas. Acá se prueba que el resumen
// suma ambas fuentes sin duplicar y sin tocar nada operativo.

describe('novedad mensual informada', () => {
  const MES_REF = { fecha_desde: '2026-08-01', fecha_hasta: '2026-08-31', estado: 'aprobada' }
  const conActividad = (novedades: NovedadResumen[]) =>
    fila(construirResumenGuardia(base({
      turnos: [turno({ id: 't1', fecha: '2026-08-17' })], // feriado nacional
      registros: [registro({ turno_id: 't1', horas_liquidables: 12 })],
      novedades,
    })))!

  it('mensual de 2 días sin fechas: el resumen muestra 2', () => {
    const f = conActividad([{ id: 'n1', empleado_id: 'g1', tipo: 'vacaciones', ...MES_REF, dias_informados: 2 }])
    expect(f.vacaciones).toBe(2)
    expect(f.notas).toEqual(['vacaciones 2 d (mensual informada)'])
  })

  it('novedad normal con fechas conocidas sigue funcionando igual', () => {
    const f = conActividad([{ id: 'n1', empleado_id: 'g1', tipo: 'vacaciones', fecha_desde: '2026-08-05', fecha_hasta: '2026-08-06', estado: 'aprobada' }])
    expect(f.vacaciones).toBe(2)
    expect(f.notas).toEqual(['vacaciones 05/08–06/08 (2 d)'])
  })

  it('app 2 con fechas + Excel 2: la importación no crea nada y el resumen sigue en 2', () => {
    // Caso A de la regla: cantidades iguales → conciliado, no se importa.
    const soloApp = conActividad([{ id: 'n1', empleado_id: 'g1', tipo: 'vacaciones', fecha_desde: '2026-08-05', fecha_hasta: '2026-08-06', estado: 'aprobada' }])
    expect(soloApp.vacaciones).toBe(2)
  })

  it('app 1 con fechas + Excel 2: la mensual entra por la DIFERENCIA y el total es 2, no 3', () => {
    const f = conActividad([
      { id: 'n1', empleado_id: 'g1', tipo: 'vacaciones', fecha_desde: '2026-08-05', fecha_hasta: '2026-08-05', estado: 'aprobada' },
      { id: 'n2', empleado_id: 'g1', tipo: 'vacaciones', ...MES_REF, dias_informados: 1 }, // diferencia importada (2−1)
    ])
    expect(f.vacaciones).toBe(2)
  })

  it('reimportación idéntica no duplica: la misma fila mensual cuenta una sola vez', () => {
    // La idempotencia de la importación se garantiza por origen_carga en la
    // base (el script no reinserta si ya existe para empleado+tipo+mes). Acá
    // se afirma que una única fila mensual vale exactamente su cantidad.
    const f = conActividad([{ id: 'n1', empleado_id: 'g1', tipo: 'suspension', ...MES_REF, dias_informados: 5 }])
    expect(f.ausenciasSuspensiones).toBe(5)
  })

  it('la mensual no modifica horas liquidables, jornadas ni feriados', () => {
    const sin = conActividad([])
    const con = conActividad([
      { id: 'n1', empleado_id: 'g1', tipo: 'vacaciones', ...MES_REF, dias_informados: 6 },
      { id: 'n2', empleado_id: 'g1', tipo: 'parte_medico', ...MES_REF, dias_informados: 2 },
    ])
    expect(con.horasLiquidables).toBe(sin.horasLiquidables)
    expect(con.jornadas).toBe(sin.jornadas)
    expect(con.feriadosTrabajados).toBe(sin.feriadosTrabajados)
    expect(con.horasEnFeriado).toBe(sin.horasEnFeriado)
    expect(con.vacaciones).toBe(6)
    expect(con.parteMedico).toBe(2)
  })

  it('una mensual de otro mes no cuenta en este resumen', () => {
    const f = conActividad([{ id: 'n1', empleado_id: 'g1', tipo: 'vacaciones', fecha_desde: '2026-07-01', fecha_hasta: '2026-07-31', estado: 'aprobada', dias_informados: 4 }])
    expect(f.vacaciones).toBeNull()
  })
})

describe('diasDeNovedadEnMes', () => {
  it('recorta al mes y cuenta extremos inclusivos', () => {
    const n = { empleado_id: 'g1', tipo: 'vacaciones', fecha_desde: '2026-07-28', fecha_hasta: '2026-08-03', estado: 'aprobada' }
    expect(diasDeNovedadEnMes(n, '2026-08')).toBe(3)
    expect(diasDeNovedadEnMes(n, '2026-07')).toBe(4)
    expect(diasDeNovedadEnMes(n, '2026-06')).toBe(0)
  })
})

describe('filasXLSXResumenGuardia', () => {
  it('layout de liquidación: sin horas reales, sin fechas, sin hs de feriado; null vacío y 0 real como 0', () => {
    const t = turno({ id: 't1' })
    const r = registro({ turno_id: 't1', horas_liquidables: 12 })
    const nov: NovedadResumen = { id: 'n1', empleado_id: 'g1', tipo: 'accidente', fecha_desde: '2026-08-04', fecha_hasta: '2026-08-04', estado: 'aprobada' }
    const res = construirResumenGuardia(base({
      empleados: [{ id: 'g1', nombre: 'ESTANISLAO', apellido: 'ALMADA', cuil: '20144945817', legajoVisual: 'ALMADA' }],
      turnos: [t], registros: [r], novedades: [nov],
    }))
    const filas = filasXLSXResumenGuardia(res)
    // Archivo plano: encabezado directo en la primera fila, sin título ni
    // texto explicativo (que obligaban a combinar celdas).
    const encabezado = filas[0] as string[]
    const cuerpo = filas[1]
    expect(encabezado).toEqual([
      'LEGAJO VISUAL', 'CUIL', 'CUENTA', 'NOMBRE', 'NOVEDADES', 'OBJETIVO/S', 'JORNADAS',
      'HORAS LIQUIDABLES', 'HORAS NOCTURNAS', 'FERIADOS',
      'LICENCIAS', 'ART', 'VACACIONES', 'PARTE MÉDICO', 'AUS/SUSP',
    ])
    // Columnas técnicas fuera del archivo de trabajo (siguen internas)
    expect(encabezado).not.toContain('HORAS REALES')
    expect(encabezado).not.toContain('FECHAS CON ACTIVIDAD')
    expect(encabezado).not.toContain('HS EN FERIADO')
    expect(cuerpo[0]).toBe('ALMADA')  // legajo Visual Sueldos: primera columna
    expect(cuerpo[1]).toBe('20144945817')
    expect(cuerpo[2]).toBe('')   // CUENTA: sin datos bancarios todavía
    expect(cuerpo[7]).toBe(12)   // horas liquidables
    expect(cuerpo[8]).toBe('')   // nocturnas: sin configuración provista → vacío, no 0
    expect(cuerpo[9]).toBe(0)    // feriados en días: 0 real (hubo actividad, ningún feriado)
    expect(cuerpo[10]).toBe('')  // licencias: sin dato → vacío
    expect(cuerpo[11]).toBe(1)   // ART: 1 día registrado
  })

  it('sin legajo visual cargado, la celda queda vacía (no se inventa)', () => {
    const res = construirResumenGuardia(base({
      turnos: [turno({ id: 't1' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 12 })],
    }))
    expect(res.filas[0].legajoVisual).toBeNull()
    expect(filasXLSXResumenGuardia(res)[1][0]).toBe('')
  })
})

// ── Nocturnidad configurable por objetivo ────────────────────────────────────
// La franja viene de la configuración del objetivo (nunca de un nombre).
// HORAS NOCTURNAS es un subconjunto de las liquidables: no se resta nada.

const NOCT_22_06 = { activa: true, desde: '22:00', hasta: '06:00' }
const conNocturnidad = (cfg: { activa: boolean; desde: string | null; hasta: string | null } | null) =>
  (id?: string | null) => (id === OBJ_REAL ? cfg : { activa: false, desde: null, hasta: null })

describe('nocturnidad', () => {
  const fnoct = (over: Partial<ParamsResumenGuardia>) =>
    fila(construirResumenGuardia(base(over)))!

  it('objetivo sin nocturnidad activada → 0 (determinado, no null)', () => {
    const f = fnoct({
      turnos: [turno({ id: 't1', hora_inicio: '19:00', hora_fin: '07:00' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 12 })],
      nocturnidadObjetivo: conNocturnidad({ activa: false, desde: null, hasta: null }),
    })
    expect(f.horasNocturnas).toBe(0)
  })

  it('sin configuración provista → null (dato pendiente, no 0)', () => {
    const f = fnoct({
      turnos: [turno({ id: 't1', hora_inicio: '19:00', hora_fin: '07:00' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 12 })],
    })
    expect(f.horasNocturnas).toBeNull()
  })

  it('turno 22:00–06:00 completo → 8 nocturnas', () => {
    const f = fnoct({
      turnos: [turno({ id: 't1', hora_inicio: '22:00', hora_fin: '06:00' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 8 })],
      nocturnidadObjetivo: conNocturnidad(NOCT_22_06),
    })
    expect(f.horasNocturnas).toBe(8)
  })

  it('turno 19:00–07:00 → 12 liquidables y 8 nocturnas (el plus no resta)', () => {
    const f = fnoct({
      turnos: [turno({ id: 't1', hora_inicio: '19:00', hora_fin: '07:00' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 12 })],
      nocturnidadObjetivo: conNocturnidad(NOCT_22_06),
    })
    expect(f.horasLiquidables).toBe(12)
    expect(f.horasNocturnas).toBe(8)
  })

  it('turno 20:00–00:00 → 2 nocturnas', () => {
    const f = fnoct({
      turnos: [turno({ id: 't1', hora_inicio: '20:00', hora_fin: '00:00' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 4 })],
      nocturnidadObjetivo: conNocturnidad(NOCT_22_06),
    })
    expect(f.horasNocturnas).toBe(2)
  })

  it('turno 04:00–08:00 → 2 nocturnas (cola de la franja del día anterior)', () => {
    const f = fnoct({
      turnos: [turno({ id: 't1', hora_inicio: '04:00', hora_fin: '08:00' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 4 })],
      nocturnidadObjetivo: conNocturnidad(NOCT_22_06),
    })
    expect(f.horasNocturnas).toBe(2)
  })

  it('turno completamente diurno → 0', () => {
    const f = fnoct({
      turnos: [turno({ id: 't1', hora_inicio: '08:00', hora_fin: '16:00' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 8 })],
      nocturnidadObjetivo: conNocturnidad(NOCT_22_06),
    })
    expect(f.horasNocturnas).toBe(0)
  })

  it('nocturno cruzando medianoche parcial (23:00–07:00) → 7', () => {
    const f = fnoct({
      turnos: [turno({ id: 't1', hora_inicio: '23:00', hora_fin: '07:00' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 8 })],
      nocturnidadObjetivo: conNocturnidad(NOCT_22_06),
    })
    expect(f.horasNocturnas).toBe(7)
  })

  it('media hora dentro de la franja → 0.5 (sin redondear a enteros)', () => {
    const f = fnoct({
      turnos: [turno({ id: 't1', hora_inicio: '21:30', hora_fin: '22:30' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 1 })],
      nocturnidadObjetivo: conNocturnidad(NOCT_22_06),
    })
    expect(f.horasNocturnas).toBe(0.5)
  })

  it('objetivo de prueba: excluido aunque tenga nocturnidad activada', () => {
    const res = construirResumenGuardia(base({
      turnos: [turno({ id: 't1', objetivo_id: OBJ_PRUEBA, hora_inicio: '22:00', hora_fin: '06:00' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 8 })],
      nocturnidadObjetivo: () => NOCT_22_06,
    }))
    expect(res.filas).toHaveLength(0)
  })

  it('turno sin horas liquidables → 0 nocturnas; y el tope: nunca más nocturno que liquidable', () => {
    const sinHoras = fnoct({
      turnos: [turno({ id: 't1', hora_inicio: '22:00', hora_fin: '06:00' })],
      registros: [registro({ turno_id: 't1', hora_entrada_real: '22:01' })], // en curso: hl 0
      nocturnidadObjetivo: conNocturnidad(NOCT_22_06),
    })
    expect(sinHoras.horasNocturnas).toBe(0)

    // Reconocidas 4 hs sobre un turno 22–06 sin tramo corregido → tope en 4.
    const topeada = fnoct({
      turnos: [turno({ id: 't2', hora_inicio: '22:00', hora_fin: '06:00' })],
      registros: [registro({ turno_id: 't2', horas_liquidables: 4 })],
      nocturnidadObjetivo: conNocturnidad(NOCT_22_06),
    })
    expect(topeada.horasNocturnas).toBe(4)
  })

  it('corrección de horario final: el tramo corregido manda', () => {
    const f = fnoct({
      turnos: [turno({ id: 't1', hora_inicio: '22:00', hora_fin: '06:00' })],
      registros: [registro({
        turno_id: 't1',
        horas_liquidables: 5,
        hora_entrada_final: '00:00',
        hora_salida_final: '05:00',
      })],
      nocturnidadObjetivo: conNocturnidad(NOCT_22_06),
    })
    expect(f.horasNocturnas).toBe(5)
  })

  it('cobertura reconocida por supervisor sin horario observado: usa el turno programado', () => {
    const f = fnoct({
      turnos: [turno({ id: 't1', hora_inicio: '19:00', hora_fin: '07:00' })],
      registros: [registro({
        turno_id: 't1',
        horas_liquidables: 12,
        origen_cobertura: 'confirmacion_supervisor',
      })],
      nocturnidadObjetivo: conNocturnidad(NOCT_22_06),
    })
    expect(f.horasNocturnas).toBe(8)
  })

  it('franja configurable distinta (21:00–05:00) demuestra que nada está hardcodeado', () => {
    const f = fnoct({
      turnos: [turno({ id: 't1', hora_inicio: '22:00', hora_fin: '06:00' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 8 })],
      nocturnidadObjetivo: conNocturnidad({ activa: true, desde: '21:00', hasta: '05:00' }),
    })
    expect(f.horasNocturnas).toBe(7)
  })

  it('precedencia: objetivo NO + heredar → 0; objetivo SÍ + heredar → calcula', () => {
    const armar = (cfgActiva: boolean) => fnoct({
      turnos: [turno({ id: 't1', hora_inicio: '22:00', hora_fin: '06:00' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 8 })],
      nocturnidadObjetivo: conNocturnidad({ activa: cfgActiva, desde: cfgActiva ? '22:00' : null, hasta: cfgActiva ? '06:00' : null }),
      nocturnidadEmpleadoObjetivo: () => 'heredar',
    })
    expect(armar(false).horasNocturnas).toBe(0)   // desactivada por defecto
    expect(armar(true).horasNocturnas).toBe(8)
  })

  it('precedencia: objetivo NO + excepción SÍ → calcula (franja default si el objetivo no tiene)', () => {
    const f = fnoct({
      turnos: [turno({ id: 't1', hora_inicio: '22:00', hora_fin: '06:00' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 8 })],
      nocturnidadObjetivo: conNocturnidad({ activa: false, desde: null, hasta: null }),
      nocturnidadEmpleadoObjetivo: () => 'si',
    })
    expect(f.horasNocturnas).toBe(8)
    expect(f.nocturnidadOrigen).toBe('calculo')
  })

  it('precedencia: objetivo SÍ + excepción NO → 0', () => {
    const f = fnoct({
      turnos: [turno({ id: 't1', hora_inicio: '22:00', hora_fin: '06:00' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 8 })],
      nocturnidadObjetivo: conNocturnidad(NOCT_22_06),
      nocturnidadEmpleadoObjetivo: () => 'no',
    })
    expect(f.horasNocturnas).toBe(0)
  })

  it('mismo empleado en dos objetivos con reglas distintas: sólo suma el que corresponde', () => {
    // Objetivo A (OBJ_REAL): nocturnidad activa. Objetivo B: activa, pero el
    // empleado tiene excepción 'no' SOLO en B — cobra en A y no en B.
    const tA = turno({ id: 'tA', fecha: '2026-08-10', objetivo_id: OBJ_REAL, hora_inicio: '22:00', hora_fin: '06:00' })
    const tB = turno({ id: 'tB', fecha: '2026-08-12', objetivo_id: 'obj-b', hora_inicio: '22:00', hora_fin: '06:00' })
    const f = fnoct({
      turnos: [tA, tB],
      registros: [
        registro({ turno_id: 'tA', horas_liquidables: 8 }),
        registro({ turno_id: 'tB', horas_liquidables: 8 }),
      ],
      nocturnidadObjetivo: () => NOCT_22_06,
      nocturnidadEmpleadoObjetivo: (_emp, obj) => (obj === 'obj-b' ? 'no' : 'heredar'),
    })
    expect(f.horasLiquidables).toBe(16)
    expect(f.horasNocturnas).toBe(8)
  })

  it('ajuste manual mensual reemplaza al cálculo (198 sobre 176) sin tocar liquidables', () => {
    // 22 turnos nocturnos 19–07 reconocidos: cálculo automático = 22 × 8 = 176.
    const turnos = Array.from({ length: 22 }, (_, i) =>
      turno({ id: `t${i}`, fecha: `2026-08-${String(i + 1).padStart(2, '0')}`, hora_inicio: '19:00', hora_fin: '07:00' }))
    const registros = turnos.map(t => registro({ turno_id: t.id, horas_liquidables: 12 }))
    const ajuste: NovedadResumen = {
      id: 'aj1', empleado_id: 'g1', tipo: 'ajuste_nocturnidad',
      fecha_desde: '2026-08-01', fecha_hasta: '2026-08-31', estado: 'aprobada',
      horas_afectadas: 198,
    }
    const sinAjuste = fnoct({ turnos, registros, nocturnidadObjetivo: conNocturnidad(NOCT_22_06) })
    expect(sinAjuste.horasNocturnas).toBe(176)
    expect(sinAjuste.nocturnidadOrigen).toBe('calculo')

    const conAjuste = fnoct({ turnos, registros, novedades: [ajuste], nocturnidadObjetivo: conNocturnidad(NOCT_22_06) })
    expect(conAjuste.horasNocturnas).toBe(198)          // reemplaza, no suma
    expect(conAjuste.horasNocturnasCalculadas).toBe(176) // trazabilidad del cálculo
    expect(conAjuste.nocturnidadOrigen).toBe('ajuste_manual')
    expect(conAjuste.horasLiquidables).toBe(sinAjuste.horasLiquidables) // liquidables intactas
    // El ajuste no es novedad de día: no aparece en el texto libre ni en columnas
    expect(conAjuste.notas).toEqual([])
    expect(conAjuste.licencias).toBeNull()
  })

  it('ajuste manual vale incluso sin reglas automáticas activas (agosto histórico)', () => {
    const ajuste: NovedadResumen = {
      id: 'aj1', empleado_id: 'g1', tipo: 'ajuste_nocturnidad',
      fecha_desde: '2026-08-01', fecha_hasta: '2026-08-31', estado: 'aprobada',
      horas_afectadas: 198,
    }
    const f = fnoct({
      turnos: [turno({ id: 't1', hora_inicio: '19:00', hora_fin: '07:00' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 12 })],
      novedades: [ajuste],
      nocturnidadObjetivo: conNocturnidad({ activa: false, desde: null, hasta: null }),
    })
    expect(f.horasNocturnas).toBe(198)
    expect(f.horasNocturnasCalculadas).toBe(0)
    expect(f.nocturnidadOrigen).toBe('ajuste_manual')
  })

  it('un ajuste pendiente (no aprobado) no cuenta', () => {
    const pendiente: NovedadResumen = {
      id: 'aj1', empleado_id: 'g1', tipo: 'ajuste_nocturnidad',
      fecha_desde: '2026-08-01', fecha_hasta: '2026-08-31', estado: 'pendiente',
      horas_afectadas: 198,
    }
    const f = fnoct({
      turnos: [turno({ id: 't1', hora_inicio: '22:00', hora_fin: '06:00' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 8 })],
      novedades: [pendiente],
      nocturnidadObjetivo: conNocturnidad(NOCT_22_06),
    })
    expect(f.horasNocturnas).toBe(8)
    expect(f.nocturnidadOrigen).toBe('calculo')
  })

  it('suma mensual de nocturnas sobre múltiples turnos', () => {
    const f = fnoct({
      turnos: [
        turno({ id: 't1', fecha: '2026-08-10', hora_inicio: '22:00', hora_fin: '06:00' }),
        turno({ id: 't2', fecha: '2026-08-12', hora_inicio: '20:00', hora_fin: '00:00' }),
        turno({ id: 't3', fecha: '2026-08-14', hora_inicio: '08:00', hora_fin: '16:00' }),
      ],
      registros: [
        registro({ turno_id: 't1', horas_liquidables: 8 }),
        registro({ turno_id: 't2', horas_liquidables: 4 }),
        registro({ turno_id: 't3', horas_liquidables: 8 }),
      ],
      nocturnidadObjetivo: conNocturnidad(NOCT_22_06),
    })
    expect(f.horasNocturnas).toBe(10)
    expect(f.horasLiquidables).toBe(20)
    expect(f.jornadas).toBe(3)
  })
})

describe('plantillaLiquidacionResumenGuardia', () => {
  // Réplica de "ejemplo agoto app.xlsx": la app rellena las celdas de entrada
  // y emite las fórmulas de la plantilla con la fila ajustada. Los valores
  // esperados de ALMADA salen del archivo de Juan (fila 7 del ejemplo).
  const dosVigiladores = () => {
    const t1 = turno({ id: 't1' })
    const t2 = turno({ id: 't2', fecha: '2026-08-11', guardia_id: 'g2' })
    const r1 = registro({ turno_id: 't1', horas_liquidables: 12 })
    const r2 = registro({ turno_id: 't2', guardia_id: 'g2', horas_liquidables: 8 })
    return construirResumenGuardia(base({
      empleados: [
        { id: 'g1', nombre: 'ESTANISLAO', apellido: 'ALMADA', cuil: '20144945817', legajoVisual: 'ALMADA', cuenta: '00404906522208' },
        { id: 'g2', nombre: 'SILVIO', apellido: 'ALMARA', cuil: '20295393522', legajoVisual: 'ALMARA' },
      ],
      turnos: [t1, t2],
      registros: [r1, r2],
    }))
  }
  const mapa = (p: ReturnType<typeof plantillaLiquidacionResumenGuardia>) => {
    const m = new Map<string, { v?: string | number; f?: string }>()
    for (const c of p.celdas) m.set(c.ref, c)
    return m
  }

  it('geometría: datos desde la fila 7, fila separadora vacía y TOTALES con SUM hasta la separadora', () => {
    const p = plantillaLiquidacionResumenGuardia(dosVigiladores())
    expect(p.nombreHoja).toBe('Hoja1')
    expect(p.ref).toBe('A1:AX10') // 2 filas de datos (7-8), separadora 9, TOTALES 10
    const m = mapa(p)
    expect(m.get('A10')?.v).toBe('TOTALES')
    expect(m.get('I10')?.f).toBe('SUM(I7:I9)')
    expect(m.get('G10')?.f).toBe('SUM(G7:G9)')
    expect(m.get('AX10')?.f).toBe('SUM(AX7:AX9)')
    expect(p.celdas.filter(c => /^[A-Z]+9$/.test(c.ref)).length).toBe(0)
  })

  it('bloque de parámetros y encabezados, literal del ejemplo', () => {
    const m = mapa(plantillaLiquidacionResumenGuardia(dosVigiladores()))
    expect(m.get('A1')?.v).toBe('VisualSueldos - Planilla de importación de datos')
    expect(m.get('E1')?.v).toBe(1020300)
    expect(m.get('F1')?.f).toBe('E1/200')
    expect(m.get('F2')?.f).toBe('E1/200*8')
    expect(m.get('E2')?.v).toBe(180000)
    expect(m.get('E3')?.v).toBe(514500)
    expect(m.get('E4')?.v).toBe(30000)
    expect(m.get('AP5')?.v).toBe('extras')
    expect(m.get('AP6')?.v).toBe(2500)
    expect(m.get('AF5')?.v).toBe('nocturnidad')
    expect(m.get('AJ6')?.v).toBe('001')
    expect(m.get('AN6')?.v).toBe('hs dia')
    expect(m.get('AU6')?.v).toBe('888')
    expect(m.get('A6')?.v).toBe('LEGAJO VISUAL')
    expect(m.get('G6')?.v).toBe('JORNADAS')
    expect(m.get('H6')).toBeUndefined() // H no tiene título: es el tope de 25 días
    expect(m.get('I6')?.v).toBe('HORAS LIQUIDABLES')
    expect(m.get('P6')?.v).toBe('AUS/SUSP')
    expect(m.get('AF6')?.v).toBe('004')
    expect(m.get('AO6')?.v).toBe('total')
    // códigos de concepto SIEMPRE texto de 3 dígitos (importación de recibos)
    expect(m.get('AC6')?.v).toBe('203')
    expect(m.get('AG6')?.v).toBe('001')
    expect(m.get('AV6')?.v).toBe('010')
    expect(m.get('AX6')?.v).toBe('008')
  })

  it('celdas de entrada: datos consolidados de la app en A-P', () => {
    const m = mapa(plantillaLiquidacionResumenGuardia(dosVigiladores()))
    expect(m.get('A7')?.v).toBe('ALMADA')
    expect(m.get('B7')?.v).toBe('20144945817')
    expect(m.get('C7')?.v).toBe('00404906522208') // CUENTA como texto: conserva ceros a la izquierda
    expect(m.get('C8')?.v).toBe('') // sin cuenta cargada → vacía
    expect(m.get('D7')?.v).toBe('ALMADA, ESTANISLAO')
    expect(m.get('G7')?.v).toBe(1)
    expect(m.get('I7')?.v).toBe(12)
    expect(m.get('A8')?.v).toBe('ALMARA')
  })

  it('fórmulas por fila idénticas a la plantilla, con la fila ajustada', () => {
    const m = mapa(plantillaLiquidacionResumenGuardia(dosVigiladores()))
    expect(m.get('H7')?.f).toBe('MIN(G7,25)')
    expect(m.get('U7')?.f).toBe('F2')
    expect(m.get('V7')?.f).toBe('E2')
    expect(m.get('U8')?.f).toBe('U7') // las siguientes arrastran la de arriba
    expect(m.get('Y7')?.f).toBe('U7/8')
    expect(m.get('AC8')?.f).toBe('AA8*H8')
    expect(m.get('AG7')?.f).toBe('IF(I7<=150,H7*8,150)')
    expect(m.get('AI7')?.f).toBe('AH7*Y7')
    expect(m.get('AM7')?.f).toBe('IF(AL7>0,(AL7*100)/I7,0)')
    expect(m.get('AO7')?.f).toBe('AC7+AD7+AE7+AF7+AI7+AJ7+AT7+AU7+AV7+AW7+AX7+AP7')
    expect(m.get('AP7')?.f).toBe('IF(AL7>0,AL7*2500,0)-AR7')
    expect(m.get('AS7')?.f).toBe('IF(AO7>0,AO7/I7,0)')
    expect(m.get('AT7')?.f).toBe('K7*U7')
  })

  it('las columnas de carga manual (AH, AK, AQ, AR) quedan libres en las filas de datos', () => {
    const p = plantillaLiquidacionResumenGuardia(dosVigiladores())
    for (const c of p.celdas) {
      expect(c.ref).not.toMatch(/^(AH|AK|AQ|AR)[78]$/)
    }
  })

  it('nocturnidad 004: (Y/10)*J en TODAS las filas — la corrección de la fila de FIGGINI, generalizada', () => {
    const t = turno({ id: 't1', hora_inicio: '22:00', hora_fin: '06:00' })
    const res = construirResumenGuardia(base({
      turnos: [t],
      registros: [registro({ turno_id: 't1', horas_liquidables: 8 })],
      nocturnidadObjetivo: () => ({ activa: true, desde: '22:00', hasta: '06:00' }),
    }))
    const m = mapa(plantillaLiquidacionResumenGuardia(res))
    expect(m.get('AF7')?.f).toBe('(Y7/10)*J7')
    // hora/10 × hs nocturnas: 500.65 × 8 — no la variante ×200 del resto del ejemplo
    expect(m.get('AF7')?.v).toBeCloseTo((1020300 / 200 / 10) * 8, 6)
  })

  it('caso ALMADA del ejemplo: 26 jornadas, 208 hs, 1 feriado → mismos importes que el archivo de Juan', () => {
    // 26 turnos de 8 hs en fechas distintas: G=26, I=208; el feriado se carga
    // como valor consolidado, así que acá se simula el resumen directo.
    const turnos: TurnoResumen[] = []
    const registros: RegistroUniverso[] = []
    for (let d = 1; d <= 26; d++) {
      const fecha = '2026-08-' + String(d).padStart(2, '0')
      turnos.push(turno({ id: 't' + d, fecha, hora_inicio: '07:00', hora_fin: '15:00' }))
      registros.push(registro({ turno_id: 't' + d, horas_liquidables: 8 }))
    }
    const res = construirResumenGuardia(base({ turnos, registros }))
    const f = fila(res)!
    expect(f.jornadas).toBe(26)
    expect(f.horasLiquidables).toBe(208)
    f.feriadosTrabajados = 1 // como ALMADA en agosto
    const m = mapa(plantillaLiquidacionResumenGuardia(res))
    expect(m.get('H7')?.v).toBe(25) // MIN(26,25)
    expect(m.get('AC7')?.v).toBe(514500) // viáticos: 20580 × 25
    expect(m.get('AD7')?.v).toBe(180000) // presentismo
    expect(m.get('AE7')?.v).toBe(30000) // no rem
    expect(m.get('AG7')?.v).toBe(150) // 208 > 150 → tope
    expect(m.get('AJ7')?.v).toBe(765225) // 150 × hora
    expect(m.get('AL7')?.v).toBe(58) // hs extras
    expect(m.get('AP7')?.v).toBe(145000) // 58 × 2500
    expect(m.get('AT7')?.v).toBe(40812) // 1 feriado × valor día
    expect(m.get('AO7')?.v).toBe(1675537) // total, igual a AO7 del ejemplo corregido
  })

  it('sin dato (null) la celda NO se emite: vacía de verdad, las fórmulas la toman como 0 sin #¡VALOR!', () => {
    const res = construirResumenGuardia(base({
      turnos: [turno({ id: 't1', hora_inicio: '22:00', hora_fin: '06:00' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 8 })],
      // sin configuración de nocturnidad → horasNocturnas null
    }))
    expect(fila(res)!.horasNocturnas).toBeNull()
    const m = mapa(plantillaLiquidacionResumenGuardia(res))
    // nunca un "" de texto: eso rompía L×U, el total y po hs con #¡VALOR!
    for (const ref of ['J7', 'L7', 'M7', 'N7', 'O7', 'P7']) expect(m.get(ref)).toBeUndefined()
    expect(m.get('AF7')?.v).toBe(0)
    // con dato, la celda sí va (aunque sea 0 determinado)
    const res2 = construirResumenGuardia(base({
      turnos: [turno({ id: 't1', hora_inicio: '22:00', hora_fin: '06:00' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 8 })],
      nocturnidadObjetivo: () => ({ activa: false, desde: null, hasta: null }),
    }))
    expect(mapa(plantillaLiquidacionResumenGuardia(res2)).get('J7')?.v).toBe(0)
  })

  it('TOTALES cachea las sumas de las filas', () => {
    const m = mapa(plantillaLiquidacionResumenGuardia(dosVigiladores()))
    expect(m.get('G10')?.v).toBe(2)
    expect(m.get('I10')?.v).toBe(20)
    // AG de cada fila (H×8 = 8, sin llegar al tope) × hora, sumado
    expect(m.get('AJ10')?.v).toBe(2 * 8 * (1020300 / 200))
  })
})
