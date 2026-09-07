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
    // El empleado activo aparece igual (REGLA DURA), pero la actividad del
    // objetivo de prueba no le acredita nada.
    expect(res.filas).toHaveLength(1)
    expect(res.filas[0].jornadas).toBe(0)
    expect(res.filas[0].horasLiquidables).toBe(0)
    expect(res.filas[0].origen.turnoIds).toEqual([])

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

  it('REGLA DURA: el activo sin actividad va igual con ceros; el inactivo sin nada no aparece', () => {
    const res = construirResumenGuardia(base({
      empleados: [
        { id: 'g1' },
        { id: 'g2', nombre: 'OTRO', apellido: 'SIN ACTIVIDAD' },              // activo (default)
        { id: 'g3', nombre: 'VIEJO', apellido: 'INACTIVO', estado: 'inactivo' }, // sin nada: fuera
      ],
      turnos: [turno({ id: 't1' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 12 })],
    }))
    expect(res.filas.map(f => f.empleadoId).sort()).toEqual(['g1', 'g2'])
    const sinActividad = res.filas.find(f => f.empleadoId === 'g2')!
    expect(sinActividad.jornadas).toBe(0)
    expect(sinActividad.horasLiquidables).toBe(0)
    expect(sinActividad.licencias).toBeNull()
  })

  it('el inactivo CON actividad en el mes sigue entrando (se fue a mitad de mes: igual cobra)', () => {
    const res = construirResumenGuardia(base({
      empleados: [{ id: 'g1', nombre: 'ESTANISLAO', apellido: 'ALMADA', estado: 'inactivo' }],
      turnos: [turno({ id: 't1' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 12 })],
    }))
    expect(res.filas).toHaveLength(1)
    expect(res.filas[0].horasLiquidables).toBe(12)
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
    // La fila del activo existe (REGLA DURA) pero el objetivo de prueba no
    // le acredita nocturnas ni horas.
    expect(res.filas[0].horasNocturnas).toBe(0)
    expect(res.filas[0].horasLiquidables).toBe(0)
    expect(res.filas[0].jornadas).toBe(0)
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

  it('geometría de bloques: título, datos, subtotal por bloque y TOTAL GENERAL al final', () => {
    const p = plantillaLiquidacionResumenGuardia(dosVigiladores())
    expect(p.nombreHoja).toBe('Hoja1')
    // 7 título B1 · 8-9 datos · 10 subtotal · 11 sep · 12 título B2 ·
    // 13 subtotal · 14 sep · 15 título B3 · 16 subtotal · 17 sep · 18 total
    expect(p.ref).toBe('A1:BB18')
    const m = mapa(p)
    expect(m.get('A7')?.v).toBe('BLOQUE 1 - VIGILADORES')
    expect(m.get('A10')?.v).toBe('SUBTOTAL VIGILADORES')
    expect(m.get('I10')?.f).toBe('SUM(I8:I9)')
    expect(m.get('G10')?.f).toBe('SUM(G8:G9)')
    expect(m.get('AX10')?.f).toBe('SUM(AX8:AX9)')
    // Bloques 2 y 3 sin gente: aparecen igual, con subtotal 0 y sin fórmula
    expect(m.get('A12')?.v).toBe('BLOQUE 2 - SUPERVISORES')
    expect(m.get('A13')?.v).toBe('SUBTOTAL SUPERVISORES')
    expect(m.get('I13')?.v).toBe(0)
    expect(m.get('I13')?.f).toBeUndefined()
    expect(m.get('A15')?.v).toBe('BLOQUE 3 - ADMINISTRATIVOS')
    expect(m.get('A16')?.v).toBe('SUBTOTAL ADMINISTRATIVOS')
    // TOTAL GENERAL suma los subtotales, nunca el rango entero (los contaría
    // dos veces)
    expect(m.get('A18')?.v).toBe('TOTAL GENERAL')
    expect(m.get('I18')?.f).toBe('I10+I13+I16')
    expect(m.get('I18')?.v).toBe(20)
    // Filas separadoras realmente vacías
    for (const r of [11, 14, 17]) {
      expect(p.celdas.filter(c => new RegExp(`^[A-Z]+${r}$`).test(c.ref)).length).toBe(0)
    }
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
    // Informativas al final: nunca insertadas entre A y AX
    expect(m.get('AY6')?.v).toBe('SUPERVISIONES')
    expect(m.get('AZ6')?.v).toBe('HORAS SUPERVISION')
    expect(m.get('BA6')?.v).toBe('JORNADAS SUPERVISION')
    expect(m.get('BB6')?.v).toBe('OBSERVACION')
  })

  it('celdas de entrada: datos consolidados de la app en A-P', () => {
    const m = mapa(plantillaLiquidacionResumenGuardia(dosVigiladores()))
    expect(m.get('A8')?.v).toBe('ALMADA')
    expect(m.get('B8')?.v).toBe('20144945817')
    expect(m.get('C8')?.v).toBe('00404906522208') // CUENTA como texto: conserva ceros a la izquierda
    expect(m.get('C9')?.v).toBe('') // sin cuenta cargada → vacía
    expect(m.get('D8')?.v).toBe('ALMADA, ESTANISLAO')
    expect(m.get('G8')?.v).toBe(1)
    expect(m.get('I8')?.v).toBe(12)
    expect(m.get('A9')?.v).toBe('ALMARA')
  })

  it('fórmulas por fila idénticas a la plantilla, con la fila ajustada', () => {
    const m = mapa(plantillaLiquidacionResumenGuardia(dosVigiladores()))
    expect(m.get('H8')?.f).toBe('MIN(G8,25)')
    expect(m.get('U8')?.f).toBe('F2')
    expect(m.get('V8')?.f).toBe('E2')
    expect(m.get('U9')?.f).toBe('U8') // las siguientes arrastran la de arriba
    expect(m.get('Y8')?.f).toBe('U8/8')
    expect(m.get('AC9')?.f).toBe('AA9*H9')
    expect(m.get('AG8')?.f).toBe('IF(I8<=150,H8*8,150)')
    expect(m.get('AI8')?.f).toBe('AH8*Y8')
    expect(m.get('AM8')?.f).toBe('IF(AL8>0,(AL8*100)/I8,0)')
    expect(m.get('AO8')?.f).toBe('AC8+AD8+AE8+AF8+AI8+AJ8+AT8+AU8+AV8+AW8+AX8+AP8')
    expect(m.get('AP8')?.f).toBe('IF(AL8>0,AL8*2500,0)-AR8')
    expect(m.get('AS8')?.f).toBe('IF(AO8>0,AO8/I8,0)')
    expect(m.get('AT8')?.f).toBe('K8*U8')
  })

  it('las columnas de carga manual (AH, AK, AQ, AR) quedan libres en las filas de datos', () => {
    const p = plantillaLiquidacionResumenGuardia(dosVigiladores())
    for (const c of p.celdas) {
      expect(c.ref).not.toMatch(/^(AH|AK|AQ|AR)[89]$/)
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
    expect(m.get('AF8')?.f).toBe('(Y8/10)*J8')
    // hora/10 × hs nocturnas: 500.65 × 8 — no la variante ×200 del resto del ejemplo
    expect(m.get('AF8')?.v).toBeCloseTo((1020300 / 200 / 10) * 8, 6)
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
    expect(m.get('H8')?.v).toBe(25) // MIN(26,25)
    expect(m.get('AC8')?.v).toBe(514500) // viáticos: 20580 × 25
    expect(m.get('AD8')?.v).toBe(180000) // presentismo
    expect(m.get('AE8')?.v).toBe(30000) // no rem
    expect(m.get('AG8')?.v).toBe(150) // 208 > 150 → tope
    expect(m.get('AJ8')?.v).toBe(765225) // 150 × hora
    expect(m.get('AL8')?.v).toBe(58) // hs extras
    expect(m.get('AP8')?.v).toBe(145000) // 58 × 2500
    expect(m.get('AT8')?.v).toBe(40812) // 1 feriado × valor día
    expect(m.get('AO8')?.v).toBe(1675537) // total, igual a AO7 del ejemplo corregido
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
    for (const ref of ['J8', 'L8', 'M8', 'N8', 'O8', 'P8']) expect(m.get(ref)).toBeUndefined()
    expect(m.get('AF8')?.v).toBe(0)
    // con dato, la celda sí va (aunque sea 0 determinado)
    const res2 = construirResumenGuardia(base({
      turnos: [turno({ id: 't1', hora_inicio: '22:00', hora_fin: '06:00' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 8 })],
      nocturnidadObjetivo: () => ({ activa: false, desde: null, hasta: null }),
    }))
    expect(mapa(plantillaLiquidacionResumenGuardia(res2)).get('J8')?.v).toBe(0)
  })

  it('subtotales y TOTAL GENERAL cachean las sumas de las filas', () => {
    const m = mapa(plantillaLiquidacionResumenGuardia(dosVigiladores()))
    expect(m.get('G10')?.v).toBe(2)
    expect(m.get('I10')?.v).toBe(20)
    // AG de cada fila (H×8 = 8, sin llegar al tope) × hora, sumado
    expect(m.get('AJ10')?.v).toBe(2 * 8 * (1020300 / 200))
    expect(m.get('G18')?.v).toBe(2)
    expect(m.get('AJ18')?.v).toBe(2 * 8 * (1020300 / 200))
  })
})

// ── Bloques por rol y regla de MENSUALIZADOS (Juan, 07/09/2026) ──────────────
// Supervisores y administrativos cobran sueldo fijo: ninguna columna que la
// liquidación multiplica puede llevar sus datos. Lo operativo va en las
// columnas informativas del final (AY-BA) o en la observación (BB).

describe('bloques y mensualizados', () => {
  const personal = () => base({
    empleados: [
      { id: 'g1', nombre: 'ESTANISLAO', apellido: 'ALMADA', rol: 'guardia', cuil: '20144945817', legajoVisual: 'ALMADA', cuenta: '00404906522208' },
      { id: 's1', nombre: 'CARLOS', apellido: 'ACOSTA', rol: 'supervisor', cuil: '20222222222', legajoVisual: 'ACOSTA', cuenta: '111' },
      { id: 'a1', nombre: 'JUAN', apellido: 'ROMERO', rol: 'admin', cuil: '20333333333', legajoVisual: 'ROMERO', cuenta: '222' },
    ],
    turnos: [turno({ id: 't1' })],
    registros: [registro({ turno_id: 't1', horas_liquidables: 12 })],
  })

  it('orden: vigiladores, después supervisores, al final administrativos', () => {
    const res = construirResumenGuardia(personal())
    expect(res.filas.map(f => f.grupo)).toEqual(['vigiladores', 'supervisores', 'administrativos'])
    expect(res.filas.map(f => f.empleadoId)).toEqual(['g1', 's1', 'a1'])
  })

  it('supervisor con turnos fichados: JORNADAS y HORAS LIQUIDABLES en 0 igual — es mensualizado', () => {
    const res = construirResumenGuardia(base({
      empleados: [{ id: 's1', nombre: 'CARLOS', apellido: 'ACOSTA', rol: 'supervisor' }],
      turnos: [turno({ id: 't1', guardia_id: 's1' })],
      registros: [registro({ turno_id: 't1', guardia_id: 's1', horas_liquidables: 12 })],
    }))
    const f = res.filas[0]
    expect(f.jornadas).toBe(0)
    expect(f.horasLiquidables).toBe(0)
    expect(f.feriadosTrabajados).toBe(0)
    expect(f.licencias).toBeNull()
    // la actividad no se pierde: queda a la vista en la observación
    expect(f.observaciones.join(' ')).toContain('cubrió 1 turno')
  })

  it('admin con turno cubierto: misma regla que el supervisor', () => {
    const res = construirResumenGuardia(base({
      empleados: [{ id: 'a1', nombre: 'JUAN', apellido: 'ROMERO', rol: 'admin' }],
      turnos: [turno({ id: 't1', guardia_id: 'a1' })],
      registros: [registro({ turno_id: 't1', guardia_id: 'a1', horas_liquidables: 12 })],
    }))
    const f = res.filas[0]
    expect(f.jornadas).toBe(0)
    expect(f.horasLiquidables).toBe(0)
    expect(f.observaciones.join(' ')).toContain('cubrió 1 turno')
  })

  it('horas y jornadas de supervisión salen de supervisores_guardia, con cruce de medianoche', () => {
    const res = construirResumenGuardia(base({
      empleados: [{ id: 's1', nombre: 'CARLOS', apellido: 'ACOSTA', rol: 'supervisor' }],
      supervisoresGuardia: [
        { supervisor_id: 's1', fecha: '2026-08-01', hora_inicio: '18:00', hora_fin: '06:00', zona: 'rafaela' }, // nocturna: 12 hs
        { supervisor_id: 's1', fecha: '2026-08-02', hora_inicio: '08:00', hora_fin: '16:00', zona: 'Rosario / General' },
        { supervisor_id: 's1', fecha: '2026-08-02', hora_inicio: '18:00', hora_fin: '22:00', zona: 'rafaela' }, // mismo día: 1 jornada
        { supervisor_id: 'otro', fecha: '2026-08-03', hora_inicio: '08:00', hora_fin: '16:00' },
        { supervisor_id: 's1', fecha: '2026-08-04', hora_inicio: '08:00', hora_fin: '16:00', estado: 'anulado' }, // no cuenta
      ],
    }))
    const f = res.filas[0]
    expect(f.horasSupervision).toBe(24)
    expect(f.jornadasSupervision).toBe(2)
    expect(f.objetivos).toEqual(['Rosario / General', 'rafaela']) // zonas, no objetivos de turnos
    // y nada de eso toca las columnas de liquidación
    expect(f.jornadas).toBe(0)
    expect(f.horasLiquidables).toBe(0)
  })

  it('SUPERVISIONES cuenta distintas: dedup ≤10 min mismo objetivo; incompletas fuera (decisión de Juan)', () => {
    const res = construirResumenGuardia(base({
      empleados: [{ id: 's1', nombre: 'CARLOS', apellido: 'ACOSTA', rol: 'supervisor' }],
      supervisiones: [
        { supervisor_id: 's1', objetivo_id: 'o1', estado: 'ok', created_at: '2026-08-01T10:00:00Z' },
        { supervisor_id: 's1', objetivo_id: 'o1', estado: 'ok', created_at: '2026-08-01T10:04:00Z' }, // reintento → 1
        { supervisor_id: 's1', objetivo_id: 'o1', estado: 'ok', created_at: '2026-08-01T10:20:00Z' }, // visita nueva
        { supervisor_id: 's1', objetivo_id: 'o2', estado: 'con_observacion', created_at: '2026-08-01T10:05:00Z' }, // otro objetivo
        { supervisor_id: 's1', objetivo_id: 'o3', estado: 'incompleta', created_at: '2026-08-01T12:00:00Z' }, // no cuenta
        { supervisor_id: 'otro', objetivo_id: 'o1', estado: 'ok', created_at: '2026-08-01T10:01:00Z' }, // de otro
      ],
    }))
    expect(res.filas[0].supervisiones).toBe(3)
  })

  it('vigilador: informativas en 0 y sus columnas de liquidación intactas', () => {
    const res = construirResumenGuardia(base({
      turnos: [turno({ id: 't1' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 12 })],
      // aunque por error hubiera filas suyas en estas fuentes, no se le computan
      supervisiones: [{ supervisor_id: 'g1', objetivo_id: 'o1', estado: 'ok', created_at: '2026-08-01T10:00:00Z' }],
      supervisoresGuardia: [{ supervisor_id: 'g1', fecha: '2026-08-01', hora_inicio: '08:00', hora_fin: '16:00' }],
    }))
    const f = res.filas[0]
    expect(f.supervisiones).toBe(0)
    expect(f.horasSupervision).toBe(0)
    expect(f.jornadasSupervision).toBe(0)
    expect(f.horasLiquidables).toBe(12)
  })

  it('fila incompleta se ve: la observación marca qué dato de liquidación falta', () => {
    const res = construirResumenGuardia(base({
      empleados: [{ id: 'g1', nombre: 'ESTANISLAO', apellido: 'ALMADA', cuil: '20144945817' }], // sin legajoVisual ni cuenta
      turnos: [turno({ id: 't1' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 12 })],
    }))
    expect(res.filas[0].observaciones).toEqual(['REVISAR: falta legajo Visual, cuenta'])
  })

  it('plantilla: el supervisor va al bloque 2 con AY-BA cargadas y BB con la observación', () => {
    const res = construirResumenGuardia(personal())
    const p = plantillaLiquidacionResumenGuardia(res)
    const m = new Map(p.celdas.map(c => [c.ref, c]))
    // 7 título B1 · 8 ALMADA · 9 subtotal · 10 sep · 11 título B2 · 12 ACOSTA
    expect(m.get('A8')?.v).toBe('ALMADA')
    expect(m.get('A11')?.v).toBe('BLOQUE 2 - SUPERVISORES')
    expect(m.get('D12')?.v).toBe('ACOSTA, CARLOS')
    expect(m.get('G12')?.v).toBe(0) // mensualizado: jornadas 0
    expect(m.get('I12')?.v).toBe(0)
    expect(m.get('AY12')?.v).toBe(0)
    // 13 subtotal B2 · 14 sep · 15 título B3 · 16 ROMERO · 17 subtotal · 18 sep · 19 TOTAL
    expect(m.get('D16')?.v).toBe('ROMERO, JUAN')
    expect(m.get('A19')?.v).toBe('TOTAL GENERAL')
    expect(m.get('I19')?.f).toBe('I9+I13+I17')
    expect(m.get('I19')?.v).toBe(12)
    expect(p.ref).toBe('A1:BB19')
  })
})
