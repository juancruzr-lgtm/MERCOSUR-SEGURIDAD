import { describe, expect, it } from 'vitest'
import { analizarCoberturaHistorica } from '@/lib/cobertura-historica'
import type { AnalisisObjetivo, TurnoHistorico } from '@/lib/cobertura-historica'
import {
  armarPropuestasObjetivo,
  clasificarLogicaObjetivo,
  clavePropuesta,
  contarExcluidos,
  mesAnteriorDe,
  planDeclaracion,
  resumenPlan,
} from '@/lib/logica-detectada'
import type { PropuestaFranja } from '@/lib/logica-detectada'

// ── Fixture: agosto 2026 sintético ───────────────────────────────────────────

const OBJ = 'obj-1'
const OBJETIVOS = [{ id: OBJ, nombre: 'Objetivo Uno', estado: 'activo', es_prueba: false }]

/** Fechas de agosto 2026 cuyos días de semana ISO están en `dows`. */
function fechasAgosto(dows: number[], desde = 1, hasta = 31): string[] {
  const fechas: string[] = []
  for (let d = desde; d <= hasta; d++) {
    let dow = new Date(2026, 7, d).getDay()
    if (dow === 0) dow = 7
    if (dows.includes(dow)) fechas.push(`2026-08-${String(d).padStart(2, '0')}`)
  }
  return fechas
}

function turnos(fechas: string[], hi: string, hf: string, extra: Partial<TurnoHistorico> = {}): TurnoHistorico[] {
  return fechas.map(fecha => ({
    objetivo_id: OBJ, fecha, hora_inicio: hi, hora_fin: hf,
    puesto_id: 'p-principal', guardia_id: 'g-1', estado: 'programado', tipo_evento: 'normal',
    ...extra,
  }))
}

function analizar(ts: TurnoHistorico[], servicios: any[] = []): AnalisisObjetivo {
  const r = analizarCoberturaHistorica({ anio: 2026, mes: 8, turnos: ts, objetivos: OBJETIVOS, servicios })
  expect(r.objetivos).toHaveLength(1)
  return r.objetivos[0]
}

const CATALOGO_PUESTOS = [
  { id: 'p-principal', nombre: 'Principal' },
  { id: 'p-v1', nombre: 'Vigilador 1' },
  { id: 'p-v2', nombre: 'Vigilador 2' },
]

const CATALOGO_BASES = [
  { id: 'tb-diurno', nombre: 'DIURNO 07-19', hora_inicio: '07:00', hora_fin: '19:00', activo: true },
]

// ── mesAnteriorDe ────────────────────────────────────────────────────────────

describe('mesAnteriorDe', () => {
  it('devuelve el mes anterior con sus límites', () => {
    expect(mesAnteriorDe('2026-09')).toEqual({
      anio: 2026, mes: 8, mesStr: '2026-08', desde: '2026-08-01', hasta: '2026-08-31',
    })
  })

  it('cruza el año hacia diciembre', () => {
    expect(mesAnteriorDe('2026-01')).toEqual({
      anio: 2025, mes: 12, mesStr: '2025-12', desde: '2025-12-01', hasta: '2025-12-31',
    })
  })

  it('rechaza formatos inválidos', () => {
    expect(mesAnteriorDe('')).toBeNull()
    expect(mesAnteriorDe('2026-13')).toBeNull()
    expect(mesAnteriorDe('septiembre')).toBeNull()
  })
})

// ── Clasificación del objetivo ───────────────────────────────────────────────

describe('clasificarLogicaObjetivo', () => {
  it('24x7 sin configuración → propuesta detectada', () => {
    const a = analizar([
      ...turnos(fechasAgosto([1, 2, 3, 4, 5, 6, 7]), '07:00', '19:00'),
      ...turnos(fechasAgosto([1, 2, 3, 4, 5, 6, 7]), '19:00', '07:00'),
    ])
    expect(a.patrones.every(p => p.clasificacion === 'fuerte')).toBe(true)
    expect(clasificarLogicaObjetivo(a)).toBe('propuesta')
  })

  it('configuración que coincide → coincide', () => {
    const a = analizar(
      turnos(fechasAgosto([1, 2, 3, 4, 5]), '08:45', '16:45'),
      [{ objetivo_id: OBJ, activo: true, dias_semana: [1, 2, 3, 4, 5], turno_base: { hora_inicio: '08:45', hora_fin: '16:45' } }],
    )
    expect(clasificarLogicaObjetivo(a)).toBe('coincide')
  })

  it('configuración con días distintos → divergencia', () => {
    const a = analizar(
      turnos(fechasAgosto([1, 2, 3, 4, 5, 6, 7]), '07:00', '19:00'),
      [{ objetivo_id: OBJ, activo: true, dias_semana: [1, 2, 3, 4, 5], turno_base: { hora_inicio: '07:00', hora_fin: '19:00' } }],
    )
    expect(clasificarLogicaObjetivo(a)).toBe('divergencia')
  })

  it('franjas aisladas sin patrón confiable → sin lógica única', () => {
    const a = analizar([
      ...turnos(['2026-08-03', '2026-08-11'], '08:00', '20:00'),
      ...turnos(['2026-08-05', '2026-08-20'], '17:00', '08:00'),
      ...turnos(['2026-08-14'], '12:00', '20:00'),
    ])
    expect(clasificarLogicaObjetivo(a)).toBe('sin_logica')
  })
})

// ── Propuestas ───────────────────────────────────────────────────────────────

describe('armarPropuestasObjetivo', () => {
  it('propone la franja con turno base existente y puesto observado', () => {
    const ts = turnos(fechasAgosto([1, 2, 3, 4, 5, 6, 7]), '07:00', '19:00')
    const propuestas = armarPropuestasObjetivo({
      analisis: analizar(ts), turnos: ts, turnosBase: CATALOGO_BASES, puestos: CATALOGO_PUESTOS,
    })
    expect(propuestas).toHaveLength(1)
    expect(propuestas[0]).toMatchObject({
      hora_inicio: '07:00', hora_fin: '19:00',
      dias_semana: [1, 2, 3, 4, 5, 6, 7], posiciones: 1,
      turno_base_id: 'tb-diurno',
      comparacion: 'falta_configuracion',
    })
    expect(propuestas[0].puestos_sugeridos[0].puesto_id).toBe('p-principal')
  })

  it('franja sin turno base en el catálogo → turno_base_id null', () => {
    const ts = turnos(fechasAgosto([1, 2, 3, 4, 5, 6, 7]), '21:00', '07:00')
    const propuestas = armarPropuestasObjetivo({
      analisis: analizar(ts), turnos: ts, turnosBase: CATALOGO_BASES, puestos: CATALOGO_PUESTOS,
    })
    expect(propuestas[0].turno_base_id).toBeNull()
  })

  it('cambio de puesto a mitad de mes: sugiere primero los puestos vigentes', () => {
    // Principal doblado hasta el 05; desde el 06, Vigilador 1 y 2.
    const ts = [
      ...turnos(fechasAgosto([1, 2, 3, 4, 5, 6, 7], 1, 5), '07:00', '19:00'),
      ...turnos(fechasAgosto([1, 2, 3, 4, 5, 6, 7], 1, 5), '07:00', '19:00', { guardia_id: 'g-2' }),
      ...turnos(fechasAgosto([1, 2, 3, 4, 5, 6, 7], 6, 31), '07:00', '19:00', { puesto_id: 'p-v1' }),
      ...turnos(fechasAgosto([1, 2, 3, 4, 5, 6, 7], 6, 31), '07:00', '19:00', { puesto_id: 'p-v2', guardia_id: 'g-2' }),
    ]
    const propuestas = armarPropuestasObjetivo({
      analisis: analizar(ts), turnos: ts, turnosBase: CATALOGO_BASES, puestos: CATALOGO_PUESTOS,
    })
    expect(propuestas).toHaveLength(1)
    expect(propuestas[0].posiciones).toBe(2)
    const sugeridos = propuestas[0].puestos_sugeridos.map(p => p.puesto_id)
    expect(sugeridos.slice(0, 2).sort()).toEqual(['p-v1', 'p-v2'])
    expect(sugeridos[2]).toBe('p-principal')
  })

  it('lo que ya coincide no se propone', () => {
    const ts = turnos(fechasAgosto([1, 2, 3, 4, 5, 6, 7]), '07:00', '19:00')
    const analisis = analizar(ts, [
      { objetivo_id: OBJ, activo: true, dias_semana: [1, 2, 3, 4, 5, 6, 7], turno_base: { hora_inicio: '07:00', hora_fin: '19:00' } },
    ])
    const propuestas = armarPropuestasObjetivo({
      analisis, turnos: ts, turnosBase: CATALOGO_BASES, puestos: CATALOGO_PUESTOS,
    })
    expect(propuestas).toHaveLength(0)
  })
})

// ── Excepciones ignoradas ────────────────────────────────────────────────────

describe('contarExcluidos', () => {
  it('cuenta anulados/reemplazados y capacitaciones por separado', () => {
    const ts: TurnoHistorico[] = [
      ...turnos(['2026-08-01'], '07:00', '19:00'),
      ...turnos(['2026-08-02'], '07:00', '19:00', { estado: 'anulado' }),
      ...turnos(['2026-08-03'], '07:00', '19:00', { estado: 'reemplazado' }),
      ...turnos(['2026-08-04'], '07:00', '19:00', { tipo_evento: 'capacitacion' }),
    ]
    expect(contarExcluidos(ts, OBJ)).toEqual({ sin_obligacion: 2, capacitaciones: 1 })
    expect(contarExcluidos(ts, 'otro')).toEqual({ sin_obligacion: 0, capacitaciones: 0 })
  })
})

// ── Plan de declaración ──────────────────────────────────────────────────────

const propuestaBase = (extra: Partial<PropuestaFranja> = {}): PropuestaFranja => ({
  objetivo_id: OBJ, objetivo_nombre: 'Objetivo Uno',
  hora_inicio: '07:00', hora_fin: '19:00',
  dias_semana: [1, 2, 3, 4, 5, 6, 7], etiqueta_dias: 'Todos los días',
  posiciones: 1, clasificacion: 'fuerte', porcentaje: 100,
  dias_con_registro: 31, dias_observados: 31,
  comparacion: 'falta_configuracion',
  puestos_sugeridos: [], turno_base_id: 'tb-diurno', turno_base_nombre: 'DIURNO 07-19',
  ...extra,
})

describe('planDeclaracion', () => {
  it('falta_configuracion crea el servicio con el turno base existente', () => {
    const plan = planDeclaracion({
      elecciones: [{ propuesta: propuestaBase(), puesto_ids: ['p-principal'] }],
      serviciosExistentes: [], turnosBase: CATALOGO_BASES,
    })
    expect(plan.errores).toEqual([])
    expect(plan.crear_turnos_base).toEqual([])
    expect(plan.crear_servicios).toEqual([{
      objetivo_id: OBJ, puesto_id: 'p-principal',
      hora_inicio: '07:00', hora_fin: '19:00',
      turno_base_id: 'tb-diurno', dias_semana: [1, 2, 3, 4, 5, 6, 7],
    }])
  })

  it('franja sin turno base lo agrega al plan una sola vez', () => {
    const nocturna = propuestaBase({ hora_inicio: '19:00', hora_fin: '07:00', turno_base_id: null, posiciones: 2 })
    const plan = planDeclaracion({
      elecciones: [{ propuesta: nocturna, puesto_ids: ['p-v1', 'p-v2'] }],
      serviciosExistentes: [], turnosBase: CATALOGO_BASES,
    })
    expect(plan.crear_turnos_base).toEqual([{ nombre: '19:00–07:00', hora_inicio: '19:00', hora_fin: '07:00' }])
    expect(plan.crear_servicios).toHaveLength(2)
    expect(plan.crear_servicios.every(s => s.turno_base_id === null)).toBe(true)
  })

  it('valida cantidad de puestos y repetidos', () => {
    const dosPos = propuestaBase({ posiciones: 2 })
    expect(planDeclaracion({
      elecciones: [{ propuesta: dosPos, puesto_ids: ['p-v1'] }],
      serviciosExistentes: [], turnosBase: CATALOGO_BASES,
    }).errores).toHaveLength(1)
    expect(planDeclaracion({
      elecciones: [{ propuesta: dosPos, puesto_ids: ['p-v1', 'p-v1'] }],
      serviciosExistentes: [], turnosBase: CATALOGO_BASES,
    }).errores).toHaveLength(1)
  })

  it('dias_diferentes actualiza los días de los servicios de la franja', () => {
    const plan = planDeclaracion({
      elecciones: [{ propuesta: propuestaBase({ comparacion: 'dias_diferentes' }), puesto_ids: ['p-principal'] }],
      serviciosExistentes: [{
        id: 'srv-1', objetivo_id: OBJ, puesto_id: 'p-principal', activo: true,
        dias_semana: [1, 2, 3, 4, 5], turno_base: { hora_inicio: '07:00', hora_fin: '19:00' },
      }],
      turnosBase: CATALOGO_BASES,
    })
    expect(plan.crear_servicios).toEqual([])
    expect(plan.actualizar_dias).toEqual([{ servicio_id: 'srv-1', dias_semana: [1, 2, 3, 4, 5, 6, 7] }])
  })

  it('cantidad_diferente crea solo los puestos que faltan', () => {
    const plan = planDeclaracion({
      elecciones: [{ propuesta: propuestaBase({ comparacion: 'cantidad_diferente', posiciones: 2 }), puesto_ids: ['p-v1', 'p-v2'] }],
      serviciosExistentes: [{
        id: 'srv-1', objetivo_id: OBJ, puesto_id: 'p-v1', activo: true,
        dias_semana: [1, 2, 3, 4, 5, 6, 7], turno_base: { hora_inicio: '07:00', hora_fin: '19:00' },
      }],
      turnosBase: CATALOGO_BASES,
    })
    expect(plan.crear_servicios.map(s => s.puesto_id)).toEqual(['p-v2'])
  })

  it('horario_diferente desactiva las franjas declaradas no observadas y lo lista', () => {
    const plan = planDeclaracion({
      elecciones: [{ propuesta: propuestaBase({ comparacion: 'horario_diferente' }), puesto_ids: ['p-principal'] }],
      serviciosExistentes: [{
        id: 'srv-viejo', objetivo_id: OBJ, puesto_id: 'p-principal', activo: true,
        dias_semana: [1, 2, 3, 4, 5, 6, 7], turno_base: { hora_inicio: '22:00', hora_fin: '06:00' },
      }],
      turnosBase: CATALOGO_BASES,
    })
    expect(plan.crear_servicios).toHaveLength(1)
    expect(plan.desactivar_servicios).toEqual(['srv-viejo'])
    expect(resumenPlan(plan)).toContain('1 servicio(s) a desactivar')
  })
})

// ── Clave estable ────────────────────────────────────────────────────────────

describe('clavePropuesta', () => {
  it('distingue franjas y días', () => {
    const a = clavePropuesta(propuestaBase())
    const b = clavePropuesta(propuestaBase({ dias_semana: [1, 2, 3, 4, 5] }))
    expect(a).not.toBe(b)
  })
})
