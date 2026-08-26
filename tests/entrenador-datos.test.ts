import { describe, expect, it } from 'vitest'
import { agruparCapacitacion, entradaEntrenador, turnoMasDemorado } from '@/lib/entrenador-datos'
import { ETIQUETA_ENTRENAMIENTO, ensenanzasDeCumplimiento } from '@/lib/entrenador-operativo'
import { calcularCumplimiento } from '@/lib/cumplimiento'
import { fuentesDeEmpleado } from '@/lib/cumplimiento-fuentes'
import type { RondasEmpleado } from '@/lib/cumplimiento-fuentes'
import { jornadaCumplimientoDesdeFila } from '@/lib/desempeno-datos'
import type { FilaBandejaMensual } from '@/lib/bandeja-planillas'

// El puente entre el Cumplimiento y el entrenador. Traduce, no mide: cada
// número que sale de acá tiene que ser el mismo que muestra la ficha.

const fila = (over: Partial<FilaBandejaMensual> = {}): FilaBandejaMensual => ({
  turnoId: 't1', empleadoId: 'e1', registroId: 'r1', vigilador: 'PEREZ, JUAN',
  fecha: '2026-08-10',
  objetivoId: 'o1', objetivo: 'LAROMET',
  puestoId: 'p1', puesto: 'Principal',
  horario: '07:00–19:00', horaInicioProg: '07:00', horaFinProg: '19:00',
  entrada: '07:00', salida: '19:00', horas: 12,
  caracteristica: 'Normal', salidaAutomatica: false, tieneFichaje: true,
  entradaPropia: true, salidaPropia: true,
  estadoControl: 'pendiente', solicitudId: null, solicitudTexto: null,
  solicitudEstado: null, revisado: false, derivado: false, observaciones: 0,
  ...over,
})

const rondas = (o: Partial<RondasEmpleado> = {}): RondasEmpleado => ({
  guardiaId: 'e1', obligaciones: 0, cumplidas: 0, noIniciada: 0,
  noFinalizada: 0, suspendida: 0, saneadas: 0, bajoPausa: 0,
  pausaAtribuible: 0, pausaNoAtribuible: 0, pausaCapacitacion: 0,
  pausaSinClasificar: 0, motivosPausa: {}, causasPausa: {},
  ...o,
})

describe('el turno donde más llega tarde', () => {
  const t = (objetivo: string, hora: string, minutos: number, id: string) => ({
    turnoId: id, fecha: '2026-08-10', objetivo, horaInicioProg: hora,
    entrada: '07:10', minutos, banda: 'tardanza' as const,
  })

  it('gana el par (objetivo, hora) que más se repite', () => {
    const r = turnoMasDemorado([
      t('PLANTA', '07:00', 5, 'a'), t('PLANTA', '07:00', 6, 'b'), t('ACA', '19:00', 40, 'c'),
    ])
    expect(r).toEqual({ objetivo: 'PLANTA', horaInicio: '07:00' })
  })

  it('con empate gana el de más demora acumulada', () => {
    const r = turnoMasDemorado([
      t('PLANTA', '07:00', 3, 'a'), t('ACA', '19:00', 40, 'b'),
    ])
    expect(r.objetivo).toBe('ACA')
  })

  it('sin tardanzas no inventa un turno', () => {
    expect(turnoMasDemorado([])).toEqual({ objetivo: null, horaInicio: null })
  })

  it('una tardanza sin horario programado no aporta horario', () => {
    const r = turnoMasDemorado([{ ...t('PLANTA', '07:00', 5, 'a'), horaInicioProg: null }])
    expect(r.horaInicio).toBeNull()
  })
})

describe('la entrada del entrenador sale del Cumplimiento, sin recalcular', () => {
  const MES: FilaBandejaMensual[] = [
    ...Array.from({ length: 14 }, (_, i) => fila({ turnoId: `ok${i}` })),
    ...Array.from({ length: 4 }, (_, i) => fila({ turnoId: `tarde${i}`, entrada: '07:12' })),
    ...Array.from({ length: 2 }, (_, i) => fila({
      turnoId: `sr${i}`, tieneFichaje: false, entradaPropia: false, salidaPropia: false,
      origenCobertura: 'confirmacion_supervisor',
    })),
  ]
  const jornadas = MES.map(jornadaCumplimientoDesdeFila)
  const r = calcularCumplimiento(jornadas)

  it('los números coinciden con los del resultado', () => {
    const e = entradaEntrenador('2026-08', r)
    expect(e.puntualidad?.impuntuales).toBe(r.puntualidad.impuntuales)
    expect(e.puntualidad?.evaluadas).toBe(r.puntualidad.evaluadas)
    expect(e.procedimiento?.sinRegistro).toBe(r.base.incidencias.sin_registro_propio)
    expect(e.asistencia?.jornadas).toBe(r.base.observacionesValidas)
  })

  it('el horario del mensaje sale de las tardanzas reales', () => {
    const e = entradaEntrenador('2026-08', r)
    expect(e.puntualidad?.horaInicio).toBe('07:00')
    expect(e.puntualidad?.objetivo).toBe('LAROMET')
  })

  it('sólo lo atribuible de rondas llega al entrenador', () => {
    const medido = fuentesDeEmpleado(
      rondas({ obligaciones: 30, cumplidas: 18, noIniciada: 2, bajoPausa: 10, pausaSinClasificar: 10 }),
      [],
    )
    const e = entradaEntrenador('2026-08', r, { rondas: medido.rondas })
    // 30 obligaciones, 10 fuera del universo: se enseña sobre 20, no sobre 30.
    expect(e.rondas).toEqual({ incidencias: 2, requeridos: 20 })
  })

  it('sin rondas exigibles no se genera ninguna instrucción de rondas', () => {
    const medido = fuentesDeEmpleado(rondas({ obligaciones: 12, bajoPausa: 12, pausaNoAtribuible: 12 }), [])
    const e = entradaEntrenador('2026-08', r, { rondas: medido.rondas })
    expect(e.rondas).toBeUndefined()
    expect(ensenanzasDeCumplimiento(e).some(x => x.clave === 'rondas')).toBe(false)
  })

  it('la pausa por capacitación sí genera instrucción, sin acusar', () => {
    const medido = fuentesDeEmpleado(
      rondas({ obligaciones: 12, bajoPausa: 12, pausaCapacitacion: 12 }), [],
    )
    const e = entradaEntrenador('2026-08', r, { rondas: medido.rondas })
    expect(e.rondasSinCapacitacion).toBe(12)
    const ens = ensenanzasDeCumplimiento(e).find(x => x.clave === 'rondas')
    expect(ens?.incidencias).toBe(0)
    expect(ens?.texto).toContain('falta enseñarte')
  })
})

describe('quién necesita capacitación', () => {
  const ens = (clave: string, severidad: string) => ({
    clave, dimension: clave, prioridad: 5, severidad, motivo: '', texto: '',
    hechos: [], incidencias: 1, requeridos: 10, notificar: true,
    cooldownDias: 14, clavePush: '', periodo: '2026-08',
  }) as any

  it('agrupa por tema y cuenta personas, no incidencias', () => {
    const g = agruparCapacitacion([
      { empleadoId: 'a', empleado: 'ALFA', ensenanzas: [ens('rondas', 'patron'), ens('uniforme', 'reincidencia')] },
      { empleadoId: 'b', empleado: 'BETA', ensenanzas: [ens('rondas', 'reincidencia')] },
    ], ETIQUETA_ENTRENAMIENTO)
    const rondasG = g.find(x => x.clave === 'rondas')
    expect(rondasG?.personas).toEqual(['ALFA', 'BETA'])
    expect(rondasG?.patrones).toBe(1)
  })

  it('una incidencia aislada NO es una necesidad de capacitación', () => {
    const g = agruparCapacitacion([
      { empleadoId: 'a', empleado: 'ALFA', ensenanzas: [ens('rondas', 'aislada')] },
    ], ETIQUETA_ENTRENAMIENTO)
    expect(g).toHaveLength(0)
  })

  it('el tema con más gente va primero', () => {
    const g = agruparCapacitacion([
      { empleadoId: 'a', empleado: 'ALFA', ensenanzas: [ens('rondas', 'patron'), ens('uniforme', 'patron')] },
      { empleadoId: 'b', empleado: 'BETA', ensenanzas: [ens('uniforme', 'patron')] },
      { empleadoId: 'c', empleado: 'CARLA', ensenanzas: [ens('uniforme', 'patron')] },
    ], ETIQUETA_ENTRENAMIENTO)
    expect(g[0].clave).toBe('uniforme')
    expect(g[0].personas).toHaveLength(3)
  })

  it('usa la etiqueta legible, no la clave interna', () => {
    const g = agruparCapacitacion([
      { empleadoId: 'a', empleado: 'ALFA', ensenanzas: [ens('procedimiento_registro', 'patron')] },
    ], ETIQUETA_ENTRENAMIENTO)
    expect(g[0].etiqueta).toBe('Registro de entrada y salida')
  })
})
