import { describe, expect, it } from 'vitest'
import {
  construirResumenGuardia,
  diasDeNovedadEnMes,
  filasXLSXResumenGuardia,
  plantillaLiquidacionResumenGuardia,
  PARAMETROS_PLANTILLA,
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

  // LIQ2C — overrides de ajuste. Sin ajuste el archivo es idéntico (lo cubren
  // los 89 tests previos); acá se verifica que un ajuste recalcula el concepto
  // derivado del empleado ajustado, y sólo de ese. Fila 8 = ALMADA (g1),
  // fila 9 = ALMARA (g2). hora = 1020300/200 = 5101.5; día = hora*8 = 40812.
  it('un ajuste de feriados recalcula AT (006) del empleado, sin tocar al otro', () => {
    const mb = mapa(plantillaLiquidacionResumenGuardia(dosVigiladores()))
    expect(mb.get('K8')?.v).toBe(0)
    expect(mb.get('AT8')?.v).toBe(0)
    const ma = mapa(plantillaLiquidacionResumenGuardia(dosVigiladores(), new Map([['g1', { feriados: 2 }]])))
    expect(ma.get('K8')?.v).toBe(2)
    expect(ma.get('AT8')?.v).toBe(2 * (1020300 / 200 * 8)) // 81624
    // g2 (sin ajuste) intacto
    expect(ma.get('K9')?.v).toBe(mb.get('K9')?.v)
    expect(ma.get('AT9')?.v).toBe(mb.get('AT9')?.v)
  })

  it('un ajuste de adicional_hs a un vigilador emite AH y recalcula AI (adicional)', () => {
    const mb = mapa(plantillaLiquidacionResumenGuardia(dosVigiladores()))
    expect(mb.get('AH8')).toBeUndefined() // vigilador sin adicional: no se emite
    const ma = mapa(plantillaLiquidacionResumenGuardia(dosVigiladores(), new Map([['g1', { adicional_hs: 50 }]])))
    expect(ma.get('AH8')?.v).toBe(50)
    expect(ma.get('AI8')?.v).toBe(50 * (1020300 / 200)) // AH*hora = 255075
  })

  it('un ajuste de horas_liquidables recalcula extras (AL) del empleado', () => {
    const ma = mapa(plantillaLiquidacionResumenGuardia(dosVigiladores(), new Map([['g1', { horas_liquidables: 160 }]])))
    expect(ma.get('I8')?.v).toBe(160)
    // AG = IF(160<=150,H*8,150) = 150 ; AL = MAX(0,160-150) = 10
    expect(ma.get('AG8')?.v).toBe(150)
    expect(ma.get('AL8')?.v).toBe(10)
  })

  // Tope de 25 (contrato): viáticos/presentismo/no-rem se prorratean por
  // MIN(jornadas,25). Trabajar >25 días NO incrementa el importe por encima del
  // tope. La jornada real puede seguir siendo 26; el multiplicador se limita a 25.
  it('viáticos (203) topea en 25: 26 días = 100%, no 26/25; extras no se topean', () => {
    const via = 514500 // E3 viático mensual (tope 25 jornadas)
    const m20 = mapa(plantillaLiquidacionResumenGuardia(dosVigiladores(), new Map([['g1', { jornadas: 20 }]])))
    const m26 = mapa(plantillaLiquidacionResumenGuardia(dosVigiladores(), new Map([['g1', { jornadas: 26 }]])))
    const m30 = mapa(plantillaLiquidacionResumenGuardia(dosVigiladores(), new Map([['g1', { jornadas: 30 }]])))
    expect(m20.get('AC8')?.v).toBeCloseTo((via / 25) * 20, 2) // 20/25 del valor
    expect(m26.get('AC8')?.v).toBeCloseTo(via, 2)             // 26 días → 100%, NO 26/25
    expect(m30.get('AC8')?.v).toBeCloseTo(via, 2)             // 30 días → 100%
    // presentismo (204) y no-rem (212) también topean por H
    expect(m26.get('AD8')?.v).toBeCloseTo(180000, 2)
    expect(m26.get('AE8')?.v).toBeCloseTo(30000, 2)
    // la jornada real (G) NO se topea; sigue siendo 26
    expect(m26.get('G8')?.v).toBe(26)
  })

  it('geometría de bloques: título, datos, subtotal por bloque y TOTAL GENERAL al final', () => {
    const p = plantillaLiquidacionResumenGuardia(dosVigiladores())
    expect(p.nombreHoja).toBe('Liquidación')
    // 7 título B1 · 8-9 datos · 10 subtotal · 11 sep · 12 título B2 ·
    // 13 subtotal · 14 sep · 15 título B3 · 16 subtotal · 17 sep · 18 total
    // BD/BE = columnas técnicas ocultas (usuario_id, período)
    expect(p.ref).toBe('A1:BE18')
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
    expect(m.get('BC6')?.v).toBe('HS VIGILANCIA ZONA') // métrica nueva al final
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
    // Parámetros con $ absoluto (arrastrables), fila del empleado relativa.
    expect(m.get('H8')?.f).toBe('MIN(G8,25)')
    expect(m.get('AC9')?.f).toBe('($E$3/25)*H9')       // viáticos: $E$3 fijo, H9 relativo
    expect(m.get('AD8')?.f).toBe('($E$2/25)*H8')
    expect(m.get('AE8')?.f).toBe('($E$4/25)*H8')
    expect(m.get('AG8')?.f).toBe('IF(I8<=150,H8*8,150)')
    expect(m.get('AI8')?.f).toBe('AH8*$F$1')            // adicional = AH × hora ($F$1)
    expect(m.get('AJ8')?.f).toBe('AG8*$F$1')
    expect(m.get('AM8')?.f).toBe('IF(AL8>0,(AL8*100)/I8,0)')
    expect(m.get('AO8')?.f).toBe('AC8+AD8+AE8+AF8+AI8+AJ8+AT8+AU8+AV8+AW8+AX8+AP8')
    expect(m.get('AP8')?.f).toBe('IF(AL8>0,AL8*$AP$6,0)-AR8') // extra = $AP$6 fijo
    expect(m.get('AS8')?.f).toBe('IF(AO8>0,AO8/I8,0)')
    expect(m.get('AT8')?.f).toBe('K8*$F$2')             // feriados × día ($F$2)
    // Ya no hay columnas de parámetros repetidas por fila (U-AB)
    expect(m.get('U8')).toBeUndefined()
    expect(m.get('Y8')).toBeUndefined()
    expect(m.get('AA9')).toBeUndefined()
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
    expect(m.get('AF8')?.f).toBe('($F$1/10)*J8')
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

  it('clasifica por PUESTO, no por rol: Sergio (rol admin / puesto supervisor) va a supervisores', () => {
    const res = construirResumenGuardia(base({
      empleados: [
        { id: 'serg', nombre: 'SERGIO', apellido: 'MARTINEZ', rol: 'admin', puesto_organizacional: 'supervisor', cuil: '20260157400', legajoVisual: 'MARTINEZ', cuenta: '1' },
        { id: 'aldo', nombre: 'ALDO', apellido: 'MONZON', rol: 'supervisor', puesto_organizacional: 'jefe_supervisores', cuil: '20111111111', legajoVisual: 'MONZON', cuenta: '2' },
        { id: 'joel', nombre: 'JOEL', apellido: 'JUAREZ', rol: 'admin', puesto_organizacional: 'administracion', cuil: '20444444444', legajoVisual: 'JUAREZ', cuenta: '3' },
        { id: 'vig', nombre: 'X', apellido: 'VIG', rol: 'guardia', puesto_organizacional: 'vigilador', cuil: '20555555555', legajoVisual: 'VIG', cuenta: '4' },
      ],
    }))
    const porId = new Map(res.filas.map(f => [f.empleadoId, f.grupo]))
    expect(porId.get('serg')).toBe('supervisores')    // NO administrativos, pese a rol=admin heredado
    expect(porId.get('aldo')).toBe('supervisores')     // jefe_supervisores
    expect(porId.get('joel')).toBe('administrativos')  // administracion
    expect(porId.get('vig')).toBe('vigiladores')
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

  it('admin que supervisa (caso MARTINEZ): rol admin intacto, sus datos en las informativas del bloque 3', () => {
    const res = construirResumenGuardia(base({
      empleados: [{ id: 'a1', nombre: 'SERGIO', apellido: 'MARTINEZ', rol: 'admin' }],
      supervisiones: [
        { supervisor_id: 'a1', objetivo_id: 'o1', estado: 'ok', created_at: '2026-08-01T10:00:00Z' },
        { supervisor_id: 'a1', objetivo_id: 'o2', estado: 'ok', created_at: '2026-08-01T11:00:00Z' },
      ],
      supervisoresGuardia: [
        { supervisor_id: 'a1', fecha: '2026-08-01', hora_inicio: '08:00', hora_fin: '16:00', zona: 'Rosario / General' },
      ],
    }))
    const f = res.filas[0]
    expect(f.grupo).toBe('administrativos')
    expect(f.supervisiones).toBe(2)
    expect(f.horasSupervision).toBe(8)
    expect(f.jornadasSupervision).toBe(1)
    expect(f.objetivos).toEqual(['Rosario / General'])
    // y sigue mensualizado: nada en las columnas que se multiplican
    expect(f.jornadas).toBe(0)
    expect(f.horasLiquidables).toBe(0)
  })

  it('cuenta de prueba (es_prueba): no aparece nunca, aunque esté activa y tenga datos', () => {
    const res = construirResumenGuardia(base({
      empleados: [
        { id: 'g1', nombre: 'ESTANISLAO', apellido: 'ALMADA', rol: 'guardia' },
        { id: 'px', nombre: 'Supervisor', apellido: 'Prueba', rol: 'supervisor', esPrueba: true },
      ],
      turnos: [turno({ id: 't1' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 12 })],
      supervisiones: [{ supervisor_id: 'px', objetivo_id: 'o1', estado: 'ok', created_at: '2026-08-01T10:00:00Z' }],
    }))
    expect(res.filas.map(f => f.empleadoId)).toEqual(['g1'])
  })

  it('dos homónimos (caso Facundo Romero): el guardia es_prueba se excluye y el admin sigue', () => {
    // Mismo apellido y nombre: el ÚNICO discriminante es es_prueba, no el
    // nombre. El guardia "adm 2" marcado de prueba no debe aparecer; el
    // administrador ADM001 (es_prueba=false) tiene que seguir en el archivo.
    const res = construirResumenGuardia(base({
      empleados: [
        { id: 'fac-guardia', nombre: 'facundo', apellido: 'romero', rol: 'guardia', legajo: 'adm 2', esPrueba: true },
        { id: 'fac-admin', nombre: 'Facundo', apellido: 'Romero', rol: 'admin', legajo: 'ADM001', esPrueba: false },
      ],
      turnos: [turno({ id: 't1', guardia_id: 'fac-guardia' })],
      registros: [registro({ turno_id: 't1', guardia_id: 'fac-guardia', horas_liquidables: 12 })],
    }))
    const ids = res.filas.map(f => f.empleadoId)
    expect(ids).toContain('fac-admin')       // administrador: sigue incluido
    expect(ids).not.toContain('fac-guardia') // guardia de prueba: excluido
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
    // Mensualizado: base de liquidación convencional (revoca la regla 0/0)
    expect(m.get('G12')?.v).toBe(25)  // JORNADAS base
    expect(m.get('I12')?.v).toBe(150) // HORAS LIQUIDABLES base
    expect(m.get('AH12')?.v).toBe(50) // ADICIONAL (hs a valor pleno) base
    expect(m.get('AY12')?.v).toBe(0)  // supervisiones informativas, sin datos acá
    // 13 subtotal B2 · 14 sep · 15 título B3 · 16 ROMERO · 17 subtotal · 18 sep · 19 TOTAL
    expect(m.get('D16')?.v).toBe('ROMERO, JUAN')
    expect(m.get('A19')?.v).toBe('TOTAL GENERAL')
    expect(m.get('I19')?.f).toBe('I9+I13+I17')
    expect(m.get('I19')?.v).toBe(312) // 12 vigilador + 150 supervisor + 150 admin
    expect(p.ref).toBe('A1:BE19')
  })
})

// ── HS VIGILANCIA ZONA (Juan, 07/09/2026) ────────────────────────────────────
// Horas programadas de TODOS los turnos del mes de TODOS los objetivos de la
// zona que el supervisor tiene a cargo. Volumen operativo bajo supervisión, no
// horas personales. Se resuelve por asignación de zona (supervisor_zonas), no
// por rol='supervisor': el admin que supervisa (MARTINEZ) la lleva igual.
// Objetivos: o1 y o2 → zona Z1; o3 → zona Z2. El objetivo de prueba OBJ_PRUEBA
// no tiene zona relevante (queda excluido por es_prueba de todos modos).

describe('HS VIGILANCIA ZONA', () => {
  const zonaObjetivo = (id?: string | null): string | null =>
    id === 'o1' || id === 'o2' ? 'Z1' : id === 'o3' ? 'Z2' : null

  // Turnos de la zona Z1: o1 cubierto 24 h (12+12) el 01/08 y o2 12 h el 02/08
  // → Z1 = 36 h programadas. o3 (Z2) = 12 h. Sin registros a propósito: la
  // métrica cuenta el horario PROGRAMADO, no lo fichado.
  const turnosZona: TurnoResumen[] = [
    turno({ id: 'z-t1', fecha: '2026-08-01', objetivo_id: 'o1', hora_inicio: '07:00', hora_fin: '19:00', guardia_id: 'x' }),
    turno({ id: 'z-t2', fecha: '2026-08-01', objetivo_id: 'o1', hora_inicio: '19:00', hora_fin: '07:00', guardia_id: 'x' }),
    turno({ id: 'z-t3', fecha: '2026-08-02', objetivo_id: 'o2', hora_inicio: '08:00', hora_fin: '20:00', guardia_id: 'x' }),
    turno({ id: 'z-t4', fecha: '2026-08-03', objetivo_id: 'o3', hora_inicio: '08:00', hora_fin: '20:00', guardia_id: 'x' }),
  ]

  const conZona = (emp: any, over: Partial<ParamsResumenGuardia> = {}) =>
    fila(construirResumenGuardia(base({
      empleados: [emp],
      turnos: turnosZona,
      zonaObjetivo,
      zonasSupervisor: (id: string) => over.zonasSupervisor?.(id) ?? [],
      ...over,
    })), emp.id)!

  it('zona de un solo supervisor: lleva TODAS las horas programadas de sus objetivos', () => {
    const f = conZona(
      { id: 's1', nombre: 'C', apellido: 'ACOSTA', rol: 'supervisor' },
      { zonasSupervisor: () => ['Z1'] },
    )
    expect(f.hsVigilanciaZona).toBe(36) // 24 (o1) + 12 (o2), programadas, sin fichar
  })

  it('admin que supervisa (MARTINEZ): lleva las horas de su zona aunque el rol sea admin', () => {
    const f = conZona(
      { id: 'a1', nombre: 'SERGIO', apellido: 'MARTINEZ', rol: 'admin' },
      { zonasSupervisor: () => ['Z1'] },
    )
    expect(f.grupo).toBe('administrativos')
    expect(f.hsVigilanciaZona).toBe(36)
    // sigue mensualizado: nada en las columnas que se multiplican
    expect(f.jornadas).toBe(0)
    expect(f.horasLiquidables).toBe(0)
  })

  it('varias zonas a cargo: suma las dos', () => {
    const f = conZona(
      { id: 's1', nombre: 'C', apellido: 'ACOSTA', rol: 'supervisor' },
      { zonasSupervisor: () => ['Z1', 'Z2'] },
    )
    expect(f.hsVigilanciaZona).toBe(48) // 36 + 12
  })

  it('Jefe de Supervisores sin fila en supervisor_zonas: 0, no se le inventa una zona', () => {
    const f = conZona(
      { id: 'jefe', nombre: 'ALDO', apellido: 'MONZON', rol: 'supervisor' },
      { zonasSupervisor: () => [] },
    )
    expect(f.hsVigilanciaZona).toBe(0)
  })

  it('vigilador con asignación por error: 0 (un guardia no supervisa zonas)', () => {
    const f = conZona(
      { id: 'g1', nombre: 'E', apellido: 'ALMADA', rol: 'guardia' },
      { zonasSupervisor: () => ['Z1'] },
    )
    expect(f.hsVigilanciaZona).toBe(0)
    expect(f.horasLiquidables).toBe(0) // sus turnos son de otro guardia
  })

  it('objetivo de prueba y estados sin obligación no suman a la zona', () => {
    const turnos: TurnoResumen[] = [
      turno({ id: 'v1', fecha: '2026-08-01', objetivo_id: 'o1', hora_inicio: '07:00', hora_fin: '19:00', guardia_id: 'x' }), // 12 h válidas
      turno({ id: 'v2', fecha: '2026-08-02', objetivo_id: 'o1', hora_inicio: '07:00', hora_fin: '19:00', estado: 'anulado', guardia_id: 'x' }), // fuera
      turno({ id: 'v3', fecha: '2026-08-03', objetivo_id: OBJ_PRUEBA, hora_inicio: '07:00', hora_fin: '19:00', guardia_id: 'x' }), // fuera
    ]
    const f = fila(construirResumenGuardia(base({
      empleados: [{ id: 's1', nombre: 'C', apellido: 'ACOSTA', rol: 'supervisor' }],
      turnos,
      // el objetivo de prueba mapea a Z1 igual: debe quedar excluido por es_prueba, no por la zona
      zonaObjetivo: (id?: string | null) => (id === 'o1' || id === OBJ_PRUEBA ? 'Z1' : null),
      zonasSupervisor: () => ['Z1'],
    })), 's1')!
    expect(f.hsVigilanciaZona).toBe(12)
  })

  it('sin zonaObjetivo provisto: la columna queda en 0 (compatibilidad hacia atrás)', () => {
    const f = fila(construirResumenGuardia(base({
      empleados: [{ id: 's1', nombre: 'C', apellido: 'ACOSTA', rol: 'supervisor' }],
      turnos: turnosZona,
      zonasSupervisor: () => ['Z1'],
    })), 's1')!
    expect(f.hsVigilanciaZona).toBe(0)
  })

  it('plantilla: valor por fila, y NADA de subtotal/total (zona compartida no se cuenta dos veces)', () => {
    // Dos supervisores de la MISMA zona Z1: cada uno lleva las 36 h completas.
    const res = construirResumenGuardia(base({
      empleados: [
        { id: 's1', nombre: 'C', apellido: 'AAA', rol: 'supervisor' },
        { id: 's2', nombre: 'D', apellido: 'BBB', rol: 'supervisor' },
      ],
      turnos: turnosZona,
      zonaObjetivo,
      zonasSupervisor: () => ['Z1'],
    }))
    const m = new Map(plantillaLiquidacionResumenGuardia(res).celdas.map(c => [c.ref, c]))
    // Bloque 1 vacío (7 título, 8 subtotal, 9 sep), Bloque 2 supervisores:
    // 10 título, 11 AAA, 12 BBB, 13 subtotal, 14 sep, 15/16 admin, 17 sep, 18 total
    expect(m.get('D11')?.v).toBe('AAA, C')
    expect(m.get('BC11')?.v).toBe(36)
    expect(m.get('BC12')?.v).toBe(36)
    // NO se suma: en zona compartida sumar por supervisor contaría la zona 2 veces
    expect(m.get('BC13')).toBeUndefined() // subtotal supervisores
    expect(m.get('BC18')).toBeUndefined() // total general
    // las demás informativas sí totalizan (contraste): AY13 existe
    expect(m.get('AY13')?.f).toBe('SUM(AY11:AY12)')
  })
})

// ── Base de liquidación de MENSUALIZADOS (Juan, 07/09/2026) ──────────────────
// REVOCA la regla anterior (JORNADAS=0, HORAS LIQUIDABLES=0). En la plantilla
// de liquidación, supervisores y administrativos llevan valores CONVENCIONALES
// para que las fórmulas salariales operen: JORNADAS=25, HORAS LIQUIDABLES=150,
// ADICIONAL=50 (columna AH = "hs a valor pleno", que alimenta AI = AH*Y). No
// son horas trabajadas y no tocan ninguna fuente operativa.

describe('base de liquidación de mensualizados', () => {
  const hora = PARAMETROS_PLANTILLA.basico / 200
  // Localiza dinámicamente la fila de un empleado por su NOMBRE (columna D):
  // según los bloques presentes la fila cambia de número, no la hardcodeamos.
  const armar = (res: ReturnType<typeof construirResumenGuardia>) => {
    const celdas = plantillaLiquidacionResumenGuardia(res).celdas
    const m = new Map(celdas.map(c => [c.ref, c]))
    const filaDe = (nombre: string) => {
      const d = celdas.find(c => /^D\d+$/.test(c.ref) && c.v === nombre)
      return d ? Number(d.ref.slice(1)) : -1
    }
    return { m, filaDe }
  }

  it('guardia normal: conserva JORNADAS y HORAS LIQUIDABLES de la fuente operativa; AH vacía', () => {
    const { m, filaDe } = armar(construirResumenGuardia(base({
      empleados: [{ id: 'g1', nombre: 'E', apellido: 'ALMADA', rol: 'guardia', legajoVisual: 'ALMADA' }],
      turnos: [turno({ id: 't1', fecha: '2026-08-10' }), turno({ id: 't2', fecha: '2026-08-11' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 12 }), registro({ turno_id: 't2', horas_liquidables: 8 })],
    })))
    const r = filaDe('ALMADA, E')
    expect(m.get(`G${r}`)?.v).toBe(2)   // jornadas reales
    expect(m.get(`I${r}`)?.v).toBe(20)  // horas liquidables reales
    expect(m.get(`AH${r}`)).toBeUndefined() // vigilador: AH queda para carga manual
    expect(m.get(`AI${r}`)?.v).toBe(0)      // adicional = AH(vacío)*Y = 0
  })

  const mensualizado = (rol: 'supervisor' | 'admin', over: Partial<ParamsResumenGuardia> = {}) => {
    const { m, filaDe } = armar(construirResumenGuardia(base({
      empleados: [{ id: 'm1', nombre: 'C', apellido: 'ACOSTA', rol }],
      ...over,
    })))
    return { m, r: filaDe('ACOSTA, C') }
  }

  it('mensualizado supervisor: JORNADAS = 25', () => {
    const { m, r } = mensualizado('supervisor')
    expect(m.get(`G${r}`)?.v).toBe(25)
  })

  it('mensualizado supervisor: HORAS LIQUIDABLES = 150', () => {
    const { m, r } = mensualizado('supervisor')
    expect(m.get(`I${r}`)?.v).toBe(150)
  })

  it('mensualizado supervisor: ADICIONAL = 50 en AH (hs a valor pleno), y AI = 50*hora', () => {
    const { m, r } = mensualizado('supervisor')
    expect(m.get(`AH${r}`)?.v).toBe(50)            // columna identificada: AH
    expect(m.get(`AI${r}`)?.v).toBe(50 * hora)     // 'adicional' AI = AH*Y
    expect(m.get(`AI${r}`)?.f).toBe(`AH${r}*$F$1`) // adicional = AH × hora ($F$1 absoluto)
  })

  it('mensualizado admin (caso MARTINEZ): misma base 25/150/50 aunque el rol sea admin', () => {
    const { m, r } = mensualizado('admin')
    expect(m.get(`G${r}`)?.v).toBe(25)
    expect(m.get(`I${r}`)?.v).toBe(150)
    expect(m.get(`AH${r}`)?.v).toBe(50)
  })

  it('las horas operativas reales del mensualizado NO modifican la base convencional', () => {
    // Supervisor con turnos fichados a su nombre: igual 25/150/50 (no lo cambian).
    const { m, r } = mensualizado('supervisor', {
      turnos: [turno({ id: 't1', guardia_id: 'm1' }), turno({ id: 't2', fecha: '2026-08-12', guardia_id: 'm1' })],
      registros: [registro({ turno_id: 't1', guardia_id: 'm1', horas_liquidables: 12 }), registro({ turno_id: 't2', guardia_id: 'm1', horas_liquidables: 12 })],
    })
    expect(m.get(`G${r}`)?.v).toBe(25)
    expect(m.get(`I${r}`)?.v).toBe(150)
    expect(m.get(`AH${r}`)?.v).toBe(50)
  })

  it('HS VIGILANCIA ZONA sigue informativa e independiente de la base (150 ≠ 12.944,5)', () => {
    // Objetivo o1 en zona Z1 con 24 h programadas; el supervisor la tiene a cargo.
    const { m, r } = mensualizado('supervisor', {
      turnos: [
        turno({ id: 'z1', objetivo_id: 'o1', hora_inicio: '07:00', hora_fin: '19:00', guardia_id: 'x' }),
        turno({ id: 'z2', objetivo_id: 'o1', hora_inicio: '19:00', hora_fin: '07:00', guardia_id: 'x' }),
      ],
      zonaObjetivo: (id) => (id === 'o1' ? 'Z1' : null),
      zonasSupervisor: () => ['Z1'],
    })
    expect(m.get(`I${r}`)?.v).toBe(150)   // base de liquidación
    expect(m.get(`BC${r}`)?.v).toBe(24)   // volumen de vigilancia de la zona (independiente)
  })

  it('columnas históricas no se desplazan: A:AX intactas, AI sigue "adicional"/212, informativas al final', () => {
    const { m, r } = mensualizado('supervisor')
    expect(m.get('AI5')?.v).toBe('adicional')
    expect(m.get('AI6')?.v).toBe('212')
    expect(m.get(`AJ${r}`)?.f).toBe(`AG${r}*$F$1`)  // horas rec × hora ($F$1 absoluto)
    expect(m.get('AX6')?.v).toBe('008')     // último concepto histórico, sin correr
    expect(m.get('AY6')?.v).toBe('SUPERVISIONES') // informativas siguen DESPUÉS de AX
    expect(m.get('BC6')?.v).toBe('HS VIGILANCIA ZONA')
  })

  it('mensualizado: AL (hs extras) = 0, nunca negativo, con fórmula MAX(0,I-AG)', () => {
    for (const rol of ['supervisor', 'admin'] as const) {
      const { m, r } = mensualizado(rol)
      expect(m.get(`AL${r}`)?.v).toBe(0)                       // ya no -50
      expect(m.get(`AL${r}`)?.v as number).toBeGreaterThanOrEqual(0)
      expect(m.get(`AL${r}`)?.f).toBe(`MAX(0,I${r}-AG${r})`)   // fórmula no negativa
      expect(m.get(`AP${r}`)?.v).toBe(0)                       // 0 por extras
    }
  })

  it('mensualizado: el total salarial (AO) NO cambia respecto del resultado validado', () => {
    // AO validado previamente = 1.999.875 (AC 514500 + AD 180000 + AE 30000 +
    // AI 255075 + AJ 1020300; AL=0 → AP=0 no aporta). El MAX no altera el total.
    const { m, r } = mensualizado('supervisor')
    expect(m.get(`AO${r}`)?.v).toBe(1999875)
  })

  it('vigilador con horas > base: sigue generando extras correctamente (AL>0, AP paga)', () => {
    // 20 jornadas de 8 h = 160 hs liquidables (>150) → AG=150, AL=10, AP=10*2500.
    const turnos: TurnoResumen[] = []
    const registros: RegistroUniverso[] = []
    for (let d = 1; d <= 20; d++) {
      const fecha = '2026-08-' + String(d).padStart(2, '0')
      turnos.push(turno({ id: 'e' + d, fecha, hora_inicio: '08:00', hora_fin: '16:00' }))
      registros.push(registro({ turno_id: 'e' + d, horas_liquidables: 8 }))
    }
    const { m, filaDe } = armar(construirResumenGuardia(base({
      empleados: [{ id: 'g1', nombre: 'E', apellido: 'ALMADA', rol: 'guardia' }],
      turnos, registros,
    })))
    const r = filaDe('ALMADA, E')
    expect(m.get(`I${r}`)?.v).toBe(160)
    expect(m.get(`AL${r}`)?.v).toBe(10)                        // extras reales intactas
    expect(m.get(`AL${r}`)?.f).toBe(`MAX(0,I${r}-AG${r})`)
    expect(m.get(`AP${r}`)?.v).toBe(10 * PARAMETROS_PLANTILLA.horaExtra) // 25000
  })
})

// ── Prolijidad, identidad oculta y metadatos para el escritor (Juan 12/13/16) ─
// La plantilla ahora expone columnas (ancho/oculto/formato), estilos (filas por
// categoría) y secciones (bordes), y lleva identidad técnica oculta para el
// futuro reimport MERCOSUR ↔ Excel. Nada de esto cambia importes ni códigos.

describe('plantilla: prolijidad e identidad', () => {
  const armar = (res: ReturnType<typeof construirResumenGuardia>) => {
    const p = plantillaLiquidacionResumenGuardia(res)
    const m = new Map(p.celdas.map(c => [c.ref, c]))
    const filaDe = (nombre: string) => {
      const d = p.celdas.find(c => /^D\d+$/.test(c.ref) && c.v === nombre)
      return d ? Number(d.ref.slice(1)) : -1
    }
    return { p, m, filaDe }
  }

  it('identidad técnica oculta: usuario_id y período por fila; CUIL visible', () => {
    const { p, m, filaDe } = armar(construirResumenGuardia(base({
      empleados: [{ id: 'emp-123', nombre: 'C', apellido: 'ACOSTA', rol: 'supervisor', cuil: '20222222222' }],
    })))
    const r = filaDe('ACOSTA, C')
    expect(m.get(`BD${r}`)?.v).toBe('emp-123')  // usuario_id interno
    expect(m.get(`BE${r}`)?.v).toBe('2026-08')  // período
    expect(m.get(`B${r}`)?.v).toBe('20222222222') // CUIL visible
    expect(m.get('BD6')?.v).toBe('usuario_id')
    expect(m.get('BE6')?.v).toBe('periodo')
    // BD/BE ocultas; CUIL (B) visible
    const bd = p.columnas.find(c => c.col === 'BD')
    const be = p.columnas.find(c => c.col === 'BE')
    const b = p.columnas.find(c => c.col === 'B')
    expect(bd?.hidden).toBe(true)
    expect(be?.hidden).toBe(true)
    expect(b?.hidden).toBeFalsy()
  })

  it('columnas: anchos, formatos y ocultamiento de las auxiliares repetitivas (U-AB)', () => {
    const { p } = armar(construirResumenGuardia(base({
      empleados: [{ id: 'g1', nombre: 'E', apellido: 'ALMADA', rol: 'guardia' }],
    })))
    const col = (c: string) => p.columnas.find(x => x.col === c)
    expect(col('AO')?.numFmt).toBe('money')   // total: moneda
    expect(col('I')?.numFmt).toBe('hours')    // horas liquidables
    expect(col('G')?.numFmt).toBe('int')      // jornadas
    expect(col('BC')?.numFmt).toBe('hours')   // hs vigilancia zona
    // Las columnas de parámetros repetidos del ejemplo viejo quedan ocultas
    for (const c of ['U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB']) {
      expect(col(c)?.hidden).toBe(true)
    }
    expect(typeof col('D')?.width).toBe('number')
  })

  it('estilos y secciones expuestos para el escritor (bordes/negritas)', () => {
    const { p } = armar(construirResumenGuardia(base({
      empleados: [
        { id: 'g1', nombre: 'E', apellido: 'ALMADA', rol: 'guardia' },
        { id: 's1', nombre: 'C', apellido: 'ACOSTA', rol: 'supervisor' },
      ],
      turnos: [turno({ id: 't1' })],
      registros: [registro({ turno_id: 't1', horas_liquidables: 12 })],
    })))
    expect(p.estilos.encabezado).toBe(6)
    expect(p.estilos.titulos.length).toBe(3)       // 3 bloques
    expect(p.estilos.subtotales.length).toBe(3)
    expect(p.estilos.total).toBeGreaterThan(0)
    expect(p.estilos.filasDatos.length).toBe(2)    // 1 vigilador + 1 supervisor
    expect(p.secciones).toContain('AC')            // arranque de cálculos salariales
    expect(p.secciones).toContain('AY')            // arranque de supervisión
  })
})

// ── 000 DÍAS TRABAJADOS: fuente y reglas (corrección definitiva 09/09/2026) ──
// El 000 = fechas distintas EFECTIVAMENTE trabajadas de la planilla liquidable
// (no turnos crudos, no programados, no históricos de Visual). Una fecha = 1 día,
// sin tope de 25. `fila.jornadas` es exactamente lo que `jornadasPorUsuarioDelMes`
// envía como 000 (para vigiladores; los mensualizados y sin actividad van a 0).
describe('000 DÍAS TRABAJADOS — jornadas para Visual', () => {
  const dia = (n: number) => `2026-08-${String(n).padStart(2, '0')}`
  const trabajadas = (fechas: string[]) => {
    const turnos = fechas.map((f, i) => turno({ id: `t${i}`, fecha: f }))
    const registros = turnos.map(t => registro({ turno_id: t.id, horas_liquidables: 12 }))
    return construirResumenGuardia(base({ turnos, registros }))
  }

  it('26 fechas distintas trabajadas → 000 = 26', () => {
    const fechas = Array.from({ length: 26 }, (_, i) => dia(i + 1))
    expect(fila(trabajadas(fechas))!.jornadas).toBe(26)
  })

  it('sin tope de 25: 27 fechas distintas → 000 = 27', () => {
    const fechas = Array.from({ length: 27 }, (_, i) => dia(i + 1))
    expect(fila(trabajadas(fechas))!.jornadas).toBe(27)
  })

  it('una fecha trabajada → 000 = 1', () => {
    expect(fila(trabajadas([dia(3)]))!.jornadas).toBe(1)
  })

  it('dos turnos la MISMA fecha → 1 día', () => {
    const manana = turno({ id: 't1', fecha: dia(10), hora_inicio: '09:00', hora_fin: '16:00' })
    const tarde = turno({ id: 't2', fecha: dia(10), hora_inicio: '18:00', hora_fin: '23:00' })
    const rs = [registro({ turno_id: 't1', horas_liquidables: 7 }), registro({ turno_id: 't2', horas_liquidables: 5 })]
    expect(fila(construirResumenGuardia(base({ turnos: [manana, tarde], registros: rs })))!.jornadas).toBe(1)
  })

  it('programado pero NO trabajado (turno cubierto sin registro, fuera de transición) → 0', () => {
    const t = turno({ id: 't1', fecha: dia(12), estado: 'cubierto' })
    const f = fila(construirResumenGuardia(base({ turnos: [t], registros: [] })))!
    expect(f.jornadas).toBe(0)
  })

  it('jornada reconocida en la planilla (con horas liquidables) → incluida', () => {
    const t = turno({ id: 't1', fecha: dia(5) })
    const r = registro({ turno_id: 't1', horas_liquidables: 8 })
    expect(fila(construirResumenGuardia(base({ turnos: [t], registros: [r] })))!.jornadas).toBe(1)
  })

  it('día NO reconocido (ausencia registrada) → excluido del 000', () => {
    const t = turno({ id: 't1', fecha: dia(6) })
    const r = registro({ turno_id: 't1', tipo_registro: 'ausencia', horas_liquidables: 0 })
    expect(fila(construirResumenGuardia(base({ turnos: [t], registros: [r] })))!.jornadas).toBe(0)
  })

  it('día sin horas reconocidas (horas liquidables 0) → excluido del 000', () => {
    const t = turno({ id: 't1', fecha: dia(7) })
    const r = registro({ turno_id: 't1', horas_liquidables: 0 })
    expect(fila(construirResumenGuardia(base({ turnos: [t], registros: [r] })))!.jornadas).toBe(0)
  })

  it('mezcla: 3 fechas trabajadas + 1 ausencia + 1 programado-no-trabajado → 000 = 3', () => {
    const trabajos = [dia(1), dia(2), dia(3)].map((f, i) => turno({ id: `w${i}`, fecha: f }))
    const regsTrabajo = trabajos.map(t => registro({ turno_id: t.id, horas_liquidables: 12 }))
    const ausente = turno({ id: 'a1', fecha: dia(4) })
    const programado = turno({ id: 'p1', fecha: dia(5), estado: 'cubierto' })
    const res = construirResumenGuardia(base({
      turnos: [...trabajos, ausente, programado],
      registros: [...regsTrabajo, registro({ turno_id: 'a1', tipo_registro: 'ausencia', horas_liquidables: 0 })],
    }))
    expect(fila(res)!.jornadas).toBe(3)
  })
})
