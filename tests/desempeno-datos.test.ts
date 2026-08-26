import { describe, expect, it } from 'vitest'
import {
  desempenoPorEmpleado, etiquetaMes, jornadaDesdeFila, jornadasDelMotivo,
  mesPorDefecto, mesesDisponibles, ordenOperativo, resumirDesempeno,
} from '@/lib/desempeno-datos'
import type { DesempenoEmpleado } from '@/lib/desempeno-datos'
import type { FilaBandejaMensual } from '@/lib/bandeja-planillas'

// La capa que lleva de las filas de la bandeja al cálculo. No calcula: traduce
// y agrupa. El puntaje sale siempre de lib/desempeno.

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

describe('jornadaDesdeFila — traduce, no interpreta', () => {
  it('una jornada completa', () => {
    expect(jornadaDesdeFila(fila())).toEqual({
      turnoId: 't1', tieneRegistro: true, esAusencia: false,
      entradaPropia: true, salidaPropia: true, origenCobertura: null,
    })
  })

  it('sin fichaje: no hay registro', () => {
    const j = jornadaDesdeFila(fila({ tieneFichaje: false, entradaPropia: false, salidaPropia: false }))
    expect(j.tieneRegistro).toBe(false)
  })

  it('confirmada por supervisor: el origen viaja para poder explicarlo', () => {
    const j = jornadaDesdeFila(fila({
      entradaPropia: false, salidaPropia: false,
      origenCobertura: 'confirmacion_supervisor',
    }))
    expect(j.entradaPropia).toBe(false)
    expect(j.origenCobertura).toBe('confirmacion_supervisor')
  })
})

describe('desempenoPorEmpleado', () => {
  const filas = [
    ...Array.from({ length: 10 }, (_, i) => fila({ turnoId: `a${i}`, empleadoId: 'A', vigilador: 'ALFA, A' })),
    ...Array.from({ length: 10 }, (_, i) => fila({
      turnoId: `b${i}`, empleadoId: 'B', vigilador: 'BETA, B', objetivo: 'ACA',
      entradaPropia: false, salidaPropia: false, origenCobertura: 'confirmacion_supervisor',
    })),
  ]

  it('agrupa por empleado y calcula con el módulo', () => {
    const r = desempenoPorEmpleado(filas)
    expect(r).toHaveLength(2)
    const a = r.find(x => x.empleadoId === 'A')!
    const b = r.find(x => x.empleadoId === 'B')!
    expect(a.resultado.puntaje).toBe(10)
    expect(b.resultado.procedimiento).toBe(0)
    expect(b.resultado.asistencia).toBe(10)
  })

  it('el orden es operativo: primero lo que pide una decisión', () => {
    const r = desempenoPorEmpleado(filas)
    expect(r[0].empleadoId).toBe('B')
    expect(r[0].resultado.estado).toBe('requiere_intervencion')
  })

  it('junta los objetivos del período', () => {
    const r = desempenoPorEmpleado(filas)
    expect(r.find(x => x.empleadoId === 'A')!.objetivos).toEqual(['LAROMET'])
  })
})

describe('ordenOperativo — bandeja, no podio', () => {
  const con = (estado: string, incid = 0): DesempenoEmpleado => ({
    empleadoId: estado + incid, empleado: 'X', objetivos: [], jornadas: [],
    resultado: {
      puntaje: null, estado: estado as any, asistencia: null, procedimiento: null,
      observacionesValidas: 0, jornadasAplicables: 0, cobertura: 0,
      datosInsuficientes: false,
      incidencias: { sin_registro_propio: incid, entrada_sin_salida: 0 },
      ausencias: 0, sinEvidencia: 0, motivos: [],
    },
    // ordenOperativo sólo mira el estado; el resto del objeto no participa.
    cumplimiento: { dimensiones: [], motivos: [] } as any,
  })

  it('intervención primero, excelente último', () => {
    const orden = ordenOperativo([
      con('excelente'), con('correcto'), con('datos_insuficientes'),
      con('requiere_seguimiento'), con('requiere_intervencion'),
    ]).map(x => x.resultado.estado)
    expect(orden).toEqual([
      'requiere_intervencion', 'requiere_seguimiento', 'datos_insuficientes',
      'correcto', 'excelente',
    ])
  })

  it('datos insuficientes va antes que correcto: también pide acción', () => {
    const orden = ordenOperativo([con('correcto'), con('datos_insuficientes')])
    expect(orden[0].resultado.estado).toBe('datos_insuficientes')
  })

  it('dentro del mismo estado, más incidencias primero', () => {
    const orden = ordenOperativo([con('correcto', 1), con('correcto', 5)])
    expect(orden[0].resultado.incidencias.sin_registro_propio).toBe(5)
  })

  it('no muta el arreglo original', () => {
    const original = [con('excelente'), con('requiere_intervencion')]
    ordenOperativo(original)
    expect(original[0].resultado.estado).toBe('excelente')
  })
})

describe('jornadasDelMotivo — de la frase al hecho', () => {
  const d = desempenoPorEmpleado([
    fila({ turnoId: 'ok' }),
    fila({ turnoId: 'conf', entradaPropia: false, salidaPropia: false, origenCobertura: 'confirmacion_supervisor' }),
    fila({ turnoId: 'sal', salidaPropia: false }),
    fila({ turnoId: 'hueco', tieneFichaje: false, entradaPropia: false, salidaPropia: false }),
    fila({ turnoId: 'aus', esAusencia: true, entradaPropia: false, salidaPropia: false }),
  ])[0]

  it('cada motivo devuelve exactamente sus jornadas', () => {
    expect(jornadasDelMotivo(d, 'sin_registro_propio').map(f => f.turnoId)).toEqual(['conf'])
    expect(jornadasDelMotivo(d, 'entrada_sin_salida').map(f => f.turnoId)).toEqual(['sal'])
    expect(jornadasDelMotivo(d, 'ausencia').map(f => f.turnoId)).toEqual(['aus'])
    expect(jornadasDelMotivo(d, 'sin_evidencia').map(f => f.turnoId)).toEqual(['hueco'])
  })

  it('una jornada correcta no aparece en ningún motivo', () => {
    const todos = ([
      'sin_registro_propio', 'entrada_sin_salida', 'ausencia', 'sin_evidencia',
    ] as const).flatMap(t => jornadasDelMotivo(d, t).map(f => f.turnoId))
    expect(todos).not.toContain('ok')
  })
})

describe('resumirDesempeno', () => {
  it('cuenta por estado', () => {
    const r = resumirDesempeno(desempenoPorEmpleado([
      ...Array.from({ length: 10 }, (_, i) => fila({ turnoId: `a${i}`, empleadoId: 'A' })),
    ]))
    expect(r.total).toBe(1)
    expect(r.porEstado.excelente).toBe(1)
  })
})

describe('períodos', () => {
  it('abre en el mes en curso', () => {
    // El indicador solo cuenta turnos ya terminados, asi que el mes en curso es
    // evaluable desde el primer dia: lo que no ocurrio no entra.
    expect(mesPorDefecto(new Date(2026, 7, 25))).toBe('2026-08')
    expect(mesPorDefecto(new Date(2026, 8, 15))).toBe('2026-09')
    expect(mesPorDefecto(new Date(2026, 0, 3))).toBe('2026-01')
  })

  it('etiqueta legible', () => {
    expect(etiquetaMes('2026-08')).toBe('agosto de 2026')
    expect(etiquetaMes('2026-01')).toBe('enero de 2026')
    expect(etiquetaMes('roto')).toBe('roto')
  })

  it('los meses van del más reciente hacia atrás', () => {
    const m = mesesDisponibles('2026-06', new Date(2026, 7, 25))
    expect(m).toEqual(['2026-08', '2026-07', '2026-06'])
  })

  it('cruza el año sin romperse', () => {
    const m = mesesDisponibles('2025-11', new Date(2026, 0, 10))
    expect(m).toEqual(['2026-01', '2025-12', '2025-11'])
  })
})

// Regresion: en produccion MARTINEZ RAUL mostraba 4/8 jornadas donde la
// simulacion daba 5. construirFilasBandeja saca las ausencias de
// registrosPorTurno, asi que tieneFichaje queda en false, y el hecho primario
// mira tieneRegistro antes que esAusencia: una falta confirmada se contaba como
// "sin evidencia" y salia del denominador.

describe('una ausencia confirmada es evidencia, no un hueco', () => {
  const ausencia = (over: Partial<FilaBandejaMensual> = {}) => fila({
    esAusencia: true,
    tieneFichaje: false,      // asi la construye la bandeja
    entradaPropia: false,
    salidaPropia: false,
    ...over,
  })

  it('cuenta como observacion valida, no como dato faltante', () => {
    const j = jornadaDesdeFila(ausencia())
    expect(j.tieneRegistro).toBe(true)
    expect(j.esAusencia).toBe(true)
  })

  it('baja Asistencia y entra al denominador', () => {
    const filas = [
      ausencia({ turnoId: 'aus' }),
      ...Array.from({ length: 9 }, (_, i) => fila({ turnoId: `ok${i}` })),
    ]
    const d = desempenoPorEmpleado(filas)[0]
    expect(d.resultado.observacionesValidas).toBe(10)
    expect(d.resultado.sinEvidencia).toBe(0)
    expect(d.resultado.ausencias).toBe(1)
    expect(d.resultado.asistencia).toBe(9)
    expect(d.resultado.cobertura).toBe(1)
  })

  it('un turno sin nada sigue siendo un hueco', () => {
    const j = jornadaDesdeFila(fila({
      tieneFichaje: false, esAusencia: false, entradaPropia: false, salidaPropia: false,
    }))
    expect(j.tieneRegistro).toBe(false)
  })

  it('la ausencia aparece en su motivo y no en "sin datos"', () => {
    const d = desempenoPorEmpleado([
      ausencia({ turnoId: 'aus' }),
      ...Array.from({ length: 9 }, (_, i) => fila({ turnoId: `ok${i}` })),
    ])[0]
    expect(jornadasDelMotivo(d, 'ausencia').map(f => f.turnoId)).toEqual(['aus'])
    expect(jornadasDelMotivo(d, 'sin_evidencia')).toEqual([])
  })
})
