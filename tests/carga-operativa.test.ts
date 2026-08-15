import { describe, expect, it } from 'vitest'
import { cargaDeSupervisor, clasificarCargaZonas } from '@/lib/carga-operativa'
import type { ParametrosCarga, TurnoCarga } from '@/lib/carga-operativa'
import { previsualizarDesdeReglas, rangoDelMes } from '@/lib/guardias-supervisor'
import type { ReglaSemanal } from '@/lib/guardias-supervisor'

// Clasificación de carga operativa contra la programación REAL de Rosario:
//   Sabino  · dom-jue 07-19 · vie 07-13 · vie 19→07
//   Walter  · sáb-jue 19→07
//   Sergio  · lun-sáb 07-19
// 2026-09-07 es lunes, 2026-09-11 viernes, 2026-09-12 sábado.

const ZONAS = [
  { id: 'z-rosario', nombre: 'Rosario' },
  { id: 'z-rafaela', nombre: 'Rafaela' },
  { id: 'z-huerfana', nombre: 'Huérfana' },
]

const SUPERVISOR_ZONAS = [
  { supervisor_id: 'sabino', zona_id: 'z-rosario' },
  { supervisor_id: 'sergio', zona_id: 'z-rosario' },
  { supervisor_id: 'walter', zona_id: 'z-rosario' },
  { supervisor_id: 'cristian', zona_id: 'z-rafaela' },
]

const OBJETIVOS = [
  { id: 'obj-ros', zona_id: 'z-rosario' },
  { id: 'obj-raf', zona_id: 'z-rafaela' },
  { id: 'obj-hue', zona_id: 'z-huerfana' },
  { id: 'obj-prueba', zona_id: 'z-rosario', es_prueba: true },
]

const regla = (over: Partial<ReglaSemanal>): ReglaSemanal => ({
  id: 'r', supervisor_id: '', zona_id: 'z-rosario', zona_nombre: 'Rosario',
  dias_semana: [], hora_inicio: '', hora_fin: '', rol_operativo: 'supervisor',
  observacion: null, activo: true, vigencia_desde: null, vigencia_hasta: null,
  ...over,
})

// Guardias reales de septiembre + el primer día de octubre (la frontera:
// los turnos que pasan de las 07:00 del 1/10 necesitan la guardia siguiente).
const REGLAS = [
  regla({ id: 'sabino-diurno', supervisor_id: 'sabino', dias_semana: [7, 1, 2, 3, 4], hora_inicio: '07:00', hora_fin: '19:00' }),
  regla({ id: 'sabino-viernes', supervisor_id: 'sabino', dias_semana: [5], hora_inicio: '07:00', hora_fin: '13:00' }),
  regla({ id: 'sabino-nocturno', supervisor_id: 'sabino', dias_semana: [5], hora_inicio: '19:00', hora_fin: '07:00' }),
  regla({ id: 'walter', supervisor_id: 'walter', dias_semana: [6, 7, 1, 2, 3, 4], hora_inicio: '19:00', hora_fin: '07:00' }),
  regla({ id: 'sergio', supervisor_id: 'sergio', dias_semana: [1, 2, 3, 4, 5, 6], hora_inicio: '07:00', hora_fin: '19:00' }),
]

const GUARDIAS_SEPT = previsualizarDesdeReglas(REGLAS, rangoDelMes('2026-09')).aCrear
const GUARDIAS_CON_FRONTERA = [
  ...GUARDIAS_SEPT,
  ...previsualizarDesdeReglas(REGLAS, { desde: '2026-10-01', hasta: '2026-10-01' }).aCrear,
]

const turno = (fecha: string, hi: string, hf: string, objetivo = 'obj-ros', estado = 'programado'): TurnoCarga =>
  ({ objetivo_id: objetivo, fecha, hora_inicio: hi, hora_fin: hf, estado })

const clasificar = (turnos: TurnoCarga[], over: Partial<ParametrosCarga> = {}) => clasificarCargaZonas({
  turnos,
  objetivos: OBJETIVOS,
  guardias: GUARDIAS_CON_FRONTERA,
  supervisorZonas: SUPERVISOR_ZONAS,
  zonas: ZONAS,
  ...over,
})

describe('clasificarCargaZonas — franjas reales de Rosario', () => {
  it('lunes diurno completo: todo compartido Sabino+Sergio', () => {
    const carga = clasificar([turno('2026-09-07', '07:00', '19:00')]).get('z-rosario')!
    expect(carga.totalHoras).toBe(12)
    expect(carga.exclusivas).toEqual({})
    expect(carga.compartidas).toEqual([{ supervisorIds: ['sabino', 'sergio'], horas: 12 }])
    expect(carga.sinSupervisor).toBe(0)
  })

  it('nocturno lunes 18:00→08:00: 2 h compartidas en las puntas y 12 h exclusivas de Walter', () => {
    const carga = clasificar([turno('2026-09-07', '18:00', '08:00')]).get('z-rosario')!
    expect(carga.totalHoras).toBe(14)
    expect(carga.exclusivas).toEqual({ walter: 12 })
    // 18-19 del lunes y 07-08 del martes: en ambas puntas están Sabino y Sergio.
    expect(carga.compartidas).toEqual([{ supervisorIds: ['sabino', 'sergio'], horas: 2 }])
    expect(carga.sinSupervisor).toBe(0)
  })

  it('viernes diurno: compartida hasta las 13, exclusiva de Sergio después', () => {
    const carga = clasificar([turno('2026-09-11', '07:00', '19:00')]).get('z-rosario')!
    expect(carga.compartidas).toEqual([{ supervisorIds: ['sabino', 'sergio'], horas: 6 }])
    expect(carga.exclusivas).toEqual({ sergio: 6 })
  })

  it('sábado 10:00-22:00: Sergio de día, Walter de noche, nada compartido', () => {
    const carga = clasificar([turno('2026-09-12', '10:00', '22:00')]).get('z-rosario')!
    expect(carga.exclusivas).toEqual({ sergio: 9, walter: 3 })
    expect(carga.compartidas).toEqual([])
  })

  it('la compartida cuenta UNA vez: total = exclusivas + compartida + sin supervisor', () => {
    const carga = clasificar([
      turno('2026-09-07', '07:00', '19:00'),
      turno('2026-09-07', '18:00', '08:00'),
      turno('2026-09-11', '07:00', '19:00'),
    ]).get('z-rosario')!

    const sumaExclusivas = Object.values(carga.exclusivas).reduce((a, b) => a + b, 0)
    const sumaCompartidas = carga.compartidas.reduce((a, c) => a + c.horas, 0)
    expect(sumaExclusivas + sumaCompartidas + carga.sinSupervisor).toBe(carga.totalHoras)
    expect(carga.totalHoras).toBe(38)
  })
})

describe('clasificarCargaZonas — frontera del período', () => {
  it('el turno del 30/09 hasta las 08:00 queda cubierto si están las guardias del 1/10', () => {
    // El caso PEAJE/PNC: sin el día extra, 07-08 del 1/10 daría "sin
    // supervisor" aunque la guardia del miércoles exista.
    const carga = clasificar([turno('2026-09-30', '20:00', '08:00')]).get('z-rosario')!
    expect(carga.sinSupervisor).toBe(0)
    expect(carga.exclusivas.walter).toBe(11) // 20:00 → 07:00
    expect(carga.compartidas).toEqual([{ supervisorIds: ['sabino', 'sergio'], horas: 1 }])
  })

  it('sin las guardias del día siguiente, esa cola aparece sin supervisor (Rosario tiene 3 asignados)', () => {
    const carga = clasificar([turno('2026-09-30', '20:00', '08:00')], { guardias: GUARDIAS_SEPT }).get('z-rosario')!
    expect(carga.sinSupervisor).toBe(1)
  })
})

describe('clasificarCargaZonas — fallback y exclusiones', () => {
  it('zona sin guardias con responsable único: toda la carga es exclusiva de él', () => {
    const carga = clasificar([turno('2026-09-07', '07:00', '19:00', 'obj-raf')]).get('z-rafaela')!
    expect(carga.exclusivas).toEqual({ cristian: 12 })
    expect(carga.sinSupervisor).toBe(0)
  })

  it('zona sin guardias y sin responsable único: sin supervisor, no se elige', () => {
    const carga = clasificar([turno('2026-09-07', '07:00', '19:00', 'obj-hue')]).get('z-huerfana')!
    expect(carga.sinSupervisor).toBe(12)
    expect(carga.exclusivas).toEqual({})
  })

  it('el franco del día convierte la franja compartida en exclusiva del otro', () => {
    const conFranco = GUARDIAS_CON_FRONTERA.map(g =>
      g.supervisor_id === 'sabino' && g.fecha === '2026-09-07' ? { ...g, tipo_evento: 'franco' } : g,
    )
    const carga = clasificar([turno('2026-09-07', '07:00', '19:00')], { guardias: conFranco }).get('z-rosario')!
    expect(carga.exclusivas).toEqual({ sergio: 12 })
    expect(carga.compartidas).toEqual([])
  })

  it('turnos sin obligación y objetivos de prueba no aportan carga', () => {
    const cargas = clasificar([
      turno('2026-09-07', '07:00', '19:00', 'obj-ros', 'anulado'),
      turno('2026-09-07', '07:00', '19:00', 'obj-ros', 'reemplazado'),
      turno('2026-09-07', '07:00', '19:00', 'obj-prueba'),
    ])
    expect(cargas.get('z-rosario')).toBeUndefined()
  })

  it('un usuario inactivo no cubre ni por guardia ni por fallback', () => {
    const usuarios = [
      { id: 'sabino', estado: 'activo' }, { id: 'sergio', estado: 'activo' },
      { id: 'walter', estado: 'activo' }, { id: 'cristian', estado: 'inactivo' },
    ]
    const rafaela = clasificar([turno('2026-09-07', '07:00', '19:00', 'obj-raf')], { usuarios }).get('z-rafaela')!
    expect(rafaela.sinSupervisor).toBe(12)
  })
})

describe('cargaDeSupervisor', () => {
  const cargas = clasificar([
    turno('2026-09-07', '07:00', '19:00'), // compartida 12
    turno('2026-09-12', '10:00', '22:00'), // sergio 9 + walter 3
  ])

  it('separa exclusiva de compartida, nunca las suma', () => {
    const sergio = cargaDeSupervisor(cargas, 'sergio', ['z-rosario'])
    expect(sergio.exclusiva).toBe(9)
    expect(sergio.compartidas).toEqual([{ supervisorIds: ['sabino', 'sergio'], horas: 12 }])

    const walter = cargaDeSupervisor(cargas, 'walter', ['z-rosario'])
    expect(walter.exclusiva).toBe(3)
    expect(walter.compartidas).toEqual([])
  })

  it('zonas que no están en el mapa no aportan', () => {
    const cristian = cargaDeSupervisor(cargas, 'cristian', ['z-rafaela'])
    expect(cristian.exclusiva).toBe(0)
    expect(cristian.compartidas).toEqual([])
  })
})
