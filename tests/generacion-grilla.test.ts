import { describe, expect, it } from 'vitest'
import {
  motivoBloqueoGeneracion,
  planificarGeneracionGrilla,
  resumenResultadoGeneracion,
} from '@/lib/generacion-grilla'
import type { TurnoExistenteGrilla } from '@/lib/generacion-grilla'

// Programación desde la grilla del objetivo. Acá se cubre la clasificación de
// cada fecha antes de confirmar; la creación real (permisos, deduplicación en
// servidor, idempotencia y auditoría) vive en la RPC
// crear_turnos_posicion_objetivo y no es ejecutable sin base de datos.

const PUESTO = 'puesto-1'
const OTRO_PUESTO = 'puesto-2'

// Referencia fija: martes 2026-08-04, 10:00.
const HOY = '2026-08-04'
const AHORA = '10:00'

const planBase = (over: Partial<Parameters<typeof planificarGeneracionGrilla>[0]> = {}) =>
  planificarGeneracionGrilla({
    puestoId: PUESTO,
    horaInicio: '22:00',
    horaFin: '06:00',
    desde: '2026-08-05',
    hasta: '2026-08-11',
    patron: 'todos',
    turnosExistentes: [],
    fechaActual: HOY,
    horaActual: AHORA,
    ...over,
  })

describe('motivoBloqueoGeneracion', () => {
  const ok = { puestoId: PUESTO, horaInicio: '22:00', horaFin: '06:00', desde: '2026-08-05', hasta: '2026-08-11' }

  it('datos completos: no bloquea', () => {
    expect(motivoBloqueoGeneracion(ok)).toBeNull()
  })

  it('sin posición operativa', () => {
    expect(motivoBloqueoGeneracion({ ...ok, puestoId: '' })).toMatch(/posición operativa/i)
  })

  it('horario incompleto', () => {
    expect(motivoBloqueoGeneracion({ ...ok, horaFin: '' })).toMatch(/horario/i)
  })

  it('fin igual a inicio: inválido', () => {
    expect(motivoBloqueoGeneracion({ ...ok, horaInicio: '08:00', horaFin: '08:00' })).toMatch(/igual/i)
  })

  it('turno nocturno (fin menor que inicio): válido, no es error', () => {
    expect(motivoBloqueoGeneracion({ ...ok, horaInicio: '22:00', horaFin: '06:00' })).toBeNull()
  })

  it('desde posterior a hasta', () => {
    expect(motivoBloqueoGeneracion({ ...ok, desde: '2026-08-20', hasta: '2026-08-10' })).toMatch(/desde/i)
  })
})

describe('planificarGeneracionGrilla — patrón de días', () => {
  it('todos los días del rango', () => {
    const plan = planBase()
    expect(plan.resumen.total).toBe(7)
    expect(plan.resumen.validos).toBe(7)
    expect(plan.fechas_a_crear).toHaveLength(7)
  })

  it('lunes a viernes deja fuera sábado y domingo', () => {
    const plan = planBase({ patron: 'lun_vie' })
    // 2026-08-05 (mié) al 11 (mar): sáb 08 y dom 09 quedan fuera.
    expect(plan.resumen.validos).toBe(5)
    expect(plan.fechas_a_crear).not.toContain('2026-08-08')
    expect(plan.fechas_a_crear).not.toContain('2026-08-09')
    expect(plan.resumen.omitidos).toBe(2)
  })

  it('sábados y domingos', () => {
    const plan = planBase({ patron: 'sab_dom' })
    expect(plan.fechas_a_crear).toEqual(['2026-08-08', '2026-08-09'])
  })

  it('selección puntual de días', () => {
    const plan = planBase({ patron: 'seleccion', diasSeleccionados: ['2026-08-06', '2026-08-10'] })
    expect(plan.fechas_a_crear).toEqual(['2026-08-06', '2026-08-10'])
  })

  it('fechas excluidas a mano no se crean', () => {
    const plan = planBase({ excluir: ['2026-08-07'] })
    expect(plan.fechas_a_crear).not.toContain('2026-08-07')
    expect(plan.filas.find(f => f.fecha === '2026-08-07')?.estado).toBe('excluido')
  })
})

describe('planificarGeneracionGrilla — turnos ya existentes', () => {
  const existente: TurnoExistenteGrilla = {
    puesto_id: PUESTO, fecha: '2026-08-06', hora_inicio: '22:00', hora_fin: '06:00', estado: 'programado',
  }

  it('misma posición, fecha y horario: ya existe, no se duplica', () => {
    const plan = planBase({ turnosExistentes: [existente] })
    expect(plan.filas.find(f => f.fecha === '2026-08-06')?.estado).toBe('ya_existe')
    expect(plan.fechas_a_crear).not.toContain('2026-08-06')
    expect(plan.resumen.ya_existen).toBe(1)
  })

  it('turno anulado no ocupa: la fecha vuelve a estar libre', () => {
    const plan = planBase({ turnosExistentes: [{ ...existente, estado: 'anulado' }] })
    expect(plan.fechas_a_crear).toContain('2026-08-06')
  })

  it('turno reemplazado tampoco ocupa', () => {
    const plan = planBase({ turnosExistentes: [{ ...existente, estado: 'reemplazado' }] })
    expect(plan.fechas_a_crear).toContain('2026-08-06')
  })

  it('una capacitación no bloquea la cobertura normal', () => {
    const plan = planBase({ turnosExistentes: [{ ...existente, tipo_evento: 'capacitacion' }] })
    expect(plan.fechas_a_crear).toContain('2026-08-06')
  })

  it('otro horario en la misma posición no bloquea', () => {
    const plan = planBase({ turnosExistentes: [{ ...existente, hora_inicio: '06:00', hora_fin: '14:00' }] })
    expect(plan.fechas_a_crear).toContain('2026-08-06')
  })

  it('mismo horario en OTRA posición: se crea igual, solo se informa', () => {
    const plan = planBase({ turnosExistentes: [{ ...existente, puesto_id: OTRO_PUESTO }] })
    const fila = plan.filas.find(f => f.fecha === '2026-08-06')
    expect(fila?.estado).toBe('valido')
    expect(fila?.detalle).toBeTruthy()
    expect(plan.fechas_a_crear).toContain('2026-08-06')
  })
})

// La grilla ahora puede crear capacitaciones, no solo turnos normales. El
// duplicado se mide contra la MISMA característica: una capacitación y un turno
// normal en la misma posición y horario son dos cosas distintas —una se le
// cobra al objetivo y la otra no— y pueden convivir.
describe('planificarGeneracionGrilla — característica del turno', () => {
  const normal: TurnoExistenteGrilla = {
    puesto_id: PUESTO, fecha: '2026-08-06', hora_inicio: '22:00', hora_fin: '06:00', estado: 'programado',
  }
  const capacitacion: TurnoExistenteGrilla = { ...normal, tipo_evento: 'capacitacion' }

  it('por defecto se planifica un turno normal (comportamiento previo)', () => {
    const plan = planBase({ turnosExistentes: [normal] })
    expect(plan.filas.find(f => f.fecha === '2026-08-06')?.estado).toBe('ya_existe')
  })

  it('crear capacitación donde hay un turno normal: se crea', () => {
    const plan = planBase({ turnosExistentes: [normal], caracteristica: 'capacitacion' })
    expect(plan.fechas_a_crear).toContain('2026-08-06')
  })

  it('crear capacitación donde ya hay esa capacitación: no se duplica', () => {
    const plan = planBase({ turnosExistentes: [capacitacion], caracteristica: 'capacitacion' })
    expect(plan.filas.find(f => f.fecha === '2026-08-06')?.estado).toBe('ya_existe')
    expect(plan.fechas_a_crear).not.toContain('2026-08-06')
  })

  it('una capacitación anulada no ocupa: la fecha vuelve a estar libre', () => {
    const plan = planBase({
      turnosExistentes: [{ ...capacitacion, estado: 'anulado' }],
      caracteristica: 'capacitacion',
    })
    expect(plan.fechas_a_crear).toContain('2026-08-06')
  })

  it('permitirDuplicado también vale para capacitaciones', () => {
    const plan = planBase({
      turnosExistentes: [capacitacion],
      caracteristica: 'capacitacion',
      permitirDuplicado: true,
    })
    expect(plan.fechas_a_crear).toContain('2026-08-06')
  })

  it('una capacitación no avisa "cobertura equivalente": no cubre nada', () => {
    // Turno normal en OTRA posición, mismo día y horario: para un turno normal
    // eso se informa; para una capacitación es ruido.
    const enOtraPosicion = { ...normal, puesto_id: OTRO_PUESTO }
    const comoNormal = planBase({ turnosExistentes: [enOtraPosicion] })
    expect(comoNormal.filas.find(f => f.fecha === '2026-08-06')?.detalle).toBeTruthy()

    const comoCapacitacion = planBase({ turnosExistentes: [enOtraPosicion], caracteristica: 'capacitacion' })
    expect(comoCapacitacion.filas.find(f => f.fecha === '2026-08-06')?.detalle).toBeNull()
  })
})

// Un puesto puede llevar más de un vigilador a la vez (MUSEO CASTAGNINO tiene 3
// en Principal los fines de semana). Sin permitirDuplicado eso no se podía
// cargar desde la grilla, aunque el alta manual de turnos siempre lo permitió.
describe('planificarGeneracionGrilla — puesto doblado', () => {
  const existente: TurnoExistenteGrilla = {
    puesto_id: PUESTO, fecha: '2026-08-06', hora_inicio: '22:00', hora_fin: '06:00', estado: 'programado',
  }

  it('con permitirDuplicado, un día ya ocupado vuelve a ser válido', () => {
    const plan = planBase({ turnosExistentes: [existente], permitirDuplicado: true })
    expect(plan.fechas_a_crear).toContain('2026-08-06')
    expect(plan.resumen.ya_existen).toBe(0)
  })

  it('avisa cuántos turnos ya hay', () => {
    const plan = planBase({ turnosExistentes: [existente], permitirDuplicado: true })
    expect(plan.filas.find(f => f.fecha === '2026-08-06')?.detalle).toMatch(/Ya hay 1 turno/)
  })

  it('cuenta bien cuando ya hay varios: no hay tope', () => {
    const tres = [
      existente,
      { ...existente, puesto_id: PUESTO },
      { ...existente, puesto_id: PUESTO },
    ]
    const plan = planBase({ turnosExistentes: tres, permitirDuplicado: true })
    expect(plan.filas.find(f => f.fecha === '2026-08-06')?.detalle).toMatch(/Ya hay 3 turnos/)
    expect(plan.fechas_a_crear).toContain('2026-08-06')
  })

  it('sin permitirDuplicado sigue bloqueando: la protección no se pierde', () => {
    const plan = planBase({ turnosExistentes: [existente] })
    expect(plan.filas.find(f => f.fecha === '2026-08-06')?.estado).toBe('ya_existe')
  })

  it('duplicar no habilita fechas pasadas', () => {
    const plan = planBase({ desde: '2026-08-01', hasta: '2026-08-05', permitirDuplicado: true })
    expect(plan.filas.find(f => f.fecha === '2026-08-03')?.estado).toBe('fecha_pasada')
  })

  it('duplicar no ignora el patrón de días ni las exclusiones', () => {
    const plan = planBase({ permitirDuplicado: true, patron: 'lun_vie', excluir: ['2026-08-10'] })
    expect(plan.fechas_a_crear).not.toContain('2026-08-08') // sábado
    expect(plan.fechas_a_crear).not.toContain('2026-08-10') // excluido
  })
})

describe('planificarGeneracionGrilla — sin creación retroactiva', () => {
  it('fecha anterior a hoy queda como fecha pasada', () => {
    const plan = planBase({ desde: '2026-08-01', hasta: '2026-08-05' })
    expect(plan.filas.find(f => f.fecha === '2026-08-03')?.estado).toBe('fecha_pasada')
    expect(plan.fechas_a_crear).not.toContain('2026-08-03')
    expect(plan.resumen.fechas_pasadas).toBeGreaterThan(0)
  })

  it('hoy con el turno ya empezado: no se crea', () => {
    // Turno de 08:00 y son las 10:00 → ya empezó.
    const plan = planBase({ desde: HOY, hasta: HOY, horaInicio: '08:00', horaFin: '16:00' })
    expect(plan.filas[0].estado).toBe('fecha_pasada')
  })

  it('hoy con el turno todavía por empezar: se crea', () => {
    const plan = planBase({ desde: HOY, hasta: HOY, horaInicio: '22:00', horaFin: '06:00' })
    expect(plan.filas[0].estado).toBe('valido')
  })

  it('una fecha pasada que ya tiene turno se muestra como "ya existe", no como problema', () => {
    const plan = planBase({
      desde: '2026-08-01', hasta: '2026-08-05',
      turnosExistentes: [{ puesto_id: PUESTO, fecha: '2026-08-02', hora_inicio: '22:00', hora_fin: '06:00', estado: 'programado' }],
    })
    expect(plan.filas.find(f => f.fecha === '2026-08-02')?.estado).toBe('ya_existe')
  })
})

describe('planificarGeneracionGrilla — el plan no escribe', () => {
  it('fechas_a_crear contiene exactamente las filas válidas', () => {
    const plan = planBase({
      patron: 'lun_vie',
      excluir: ['2026-08-06'],
      turnosExistentes: [{ puesto_id: PUESTO, fecha: '2026-08-07', hora_inicio: '22:00', hora_fin: '06:00', estado: 'programado' }],
    })
    expect(plan.fechas_a_crear).toEqual(plan.filas.filter(f => f.estado === 'valido').map(f => f.fecha))
  })

  it('el total cubre todas las fechas del rango, se creen o no', () => {
    const plan = planBase({ patron: 'lun_vie' })
    expect(plan.resumen.total).toBe(plan.filas.length)
    expect(plan.filas).toHaveLength(7)
  })

  it('cada fila trae el día de la semana', () => {
    const plan = planBase({ desde: '2026-08-08', hasta: '2026-08-08' })
    expect(plan.filas[0].dia_semana).toBe('Sáb')
  })
})

describe('resumenResultadoGeneracion', () => {
  const base = { operacion_id: 'op', solicitadas: 0, creadas: 0, ya_existentes: 0, omitidas: 0, turnos_creados: [], filas: [] }

  it('solo creados', () => {
    expect(resumenResultadoGeneracion({ ...base, creadas: 5 })).toBe('5 turnos creados')
  })

  it('singular', () => {
    expect(resumenResultadoGeneracion({ ...base, creadas: 1 })).toBe('1 turno creado')
  })

  it('con ya existentes y omitidos', () => {
    expect(resumenResultadoGeneracion({ ...base, creadas: 3, ya_existentes: 2, omitidas: 1 }))
      .toBe('3 turnos creados · 2 ya existían · 1 omitido')
  })

  it('nada para crear: igual informa', () => {
    expect(resumenResultadoGeneracion({ ...base, ya_existentes: 4 })).toBe('0 turnos creados · 4 ya existían')
  })
})
