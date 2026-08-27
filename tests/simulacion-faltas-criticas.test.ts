import { describe, expect, it } from 'vitest'
import {
  COBERTURA_MINIMA_PARA_CALIFICAR, REGLAS_RONDAS, evaluar, faltaPorInasistencia,
  faltaPorRondas, leyenda, notaEscolar, suficienciaDe,
} from '@/lib/simulacion-faltas-criticas'
import { PESOS, VARIANTES_PESOS, calcularCumplimiento } from '@/lib/cumplimiento'
import type { ClaveDimension } from '@/lib/cumplimiento'
import { coberturaDe } from '@/lib/cumplimiento-cobertura'
import { fuentesDeEmpleado } from '@/lib/cumplimiento-fuentes'
import type { RondasEmpleado } from '@/lib/cumplimiento-fuentes'
import { jornadaCumplimientoDesdeFila } from '@/lib/desempeno-datos'
import type { FilaBandejaMensual } from '@/lib/bandeja-planillas'

// SIMULACIÓN. Nada de esto está activo: el puntaje productivo sigue siendo el
// promedio ponderado sin topes.

const fila = (over: Partial<FilaBandejaMensual> = {}): FilaBandejaMensual => ({
  turnoId: 't1', empleadoId: 'e1', registroId: 'r1', vigilador: 'PEREZ, JUAN',
  fecha: '2026-08-10',
  objetivoId: 'o1', objetivo: 'PLANTA', puestoId: 'p1', puesto: 'Principal',
  horario: '07:00–19:00', horaInicioProg: '07:00', horaFinProg: '19:00',
  entrada: '06:50', salida: '19:05', horas: 12,
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

const mes = (n = 20, over: Partial<FilaBandejaMensual> = {}) =>
  Array.from({ length: n }, (_, i) => fila({ turnoId: `p${i}`, ...over }))

const M6 = VARIANTES_PESOS.sim6_propuesto

const calcular = (filas: FilaBandejaMensual[], r: RondasEmpleado | null = null) =>
  calcularCumplimiento(filas.map(jornadaCumplimientoDesdeFila), fuentesDeEmpleado(r, []).fuentes, M6)

const dim = (res: ReturnType<typeof calcular>, clave: ClaveDimension) =>
  res.dimensiones.find(d => d.clave === clave)!

/** Índice 0-100 desde el puntaje X/10. */
const indice = (res: ReturnType<typeof calcular>) => res.puntaje! * 10

// ── Inasistencia ────────────────────────────────────────────────────────────

describe('falta crítica · inasistencia injustificada', () => {
  it('1 · una inasistencia injustificada impone tope 4', () => {
    const f = faltaPorInasistencia(1)!
    expect(f.tope).toBe(4)
    expect(f.hecho).toBe('1 inasistencia injustificada confirmada')
  })

  it('2 · promedio 10 con una inasistencia da final 4, y el 10 se conserva', () => {
    const e = evaluar(100, [faltaPorInasistencia(1)])
    expect(e.desempeno).toBe(10)
    expect(e.notaFinal).toBe(4)
    expect(e.explicacion).toContain('10 de desempeño')
    expect(e.explicacion).toContain('4 final')
  })

  it('3 · una ausencia justificada no llega acá: no hay falta', () => {
    // La función recibe SÓLO las confirmadas como injustificadas. Vacaciones,
    // licencia y parte médico no suman a ese contador.
    expect(faltaPorInasistencia(0)).toBeNull()
    expect(evaluar(92, [faltaPorInasistencia(0)]).notaFinal).toBe(notaEscolar(92))
  })

  it('4 · trabajó sin fichar NO es ausencia', () => {
    const res = calcular(mes(20).map((f, i) => i < 10 ? { ...f, entradaPropia: false } : f))
    expect(res.base.ausencias).toBe(0)
    expect(dim(res, 'asistencia').nota).toBe(10)
    expect(res.base.incidencias.sin_registro_propio).toBe(10)
    // Y por lo tanto no puede disparar el aplazo.
    expect(faltaPorInasistencia(res.base.ausencias)).toBeNull()
  })

  it('5 · asistencia confirmada por el supervisor no es ausencia', () => {
    const res = calcular(mes(20).map((f, i) => i < 7 ? { ...f, entradaPropia: false } : f))
    expect(res.base.ausencias).toBe(0)
    expect(faltaPorInasistencia(res.base.ausencias)).toBeNull()
  })

  it('6 · la ausencia no se cobra además en Registro en App', () => {
    const res = calcular(mes(20).map((f, i) => i < 3
      ? { ...f, esAusencia: true, tieneFichaje: false, entradaPropia: false, salidaPropia: false }
      : f))
    expect(res.base.ausencias).toBe(3)
    expect(res.base.incidencias.sin_registro_propio).toBe(0)
    expect(res.base.incidencias.entrada_sin_salida).toBe(0)
    expect(dim(res, 'procedimiento').nota).toBe(10)
  })

  it('7 · DEFECTO ABIERTO · la ausencia sí se cobra hoy en Rondas', () => {
    // rondas_ventanas_programadas sólo pide que el turno tenga puesto y guardia
    // asignados: no mira si ese día hubo ausencia registrada. Las ventanas se
    // generan igual y ninguna se cumple.
    //
    // Este test NO fuerza la conducta deseada: fija la que hay, para que el día
    // que se arregle falle y haya que venir a mirarlo.
    const res = calcular(
      mes(20).map((f, i) => i < 5
        ? { ...f, esAusencia: true, tieneFichaje: false, entradaPropia: false, salidaPropia: false }
        : f),
      rondas({ obligaciones: 20, cumplidas: 15, noIniciada: 5 }),
    )
    expect(res.base.ausencias).toBe(5)
    // Las 5 rondas de las jornadas ausentes siguen contando como no realizadas.
    expect(dim(res, 'rondas').nota).toBe(7.5)
  })
})

// ── Rondas ──────────────────────────────────────────────────────────────────

describe('falta crítica · rondas', () => {
  const R1 = REGLAS_RONDAS.R1
  const R2 = REGLAS_RONDAS.R2
  const R5 = REGLAS_RONDAS.R5

  it('8 · 49 de 50 no es falta crítica en ninguna regla', () => {
    for (const r of Object.values(REGLAS_RONDAS)) expect(faltaPorRondas(49, 50, r)).toBeNull()
  })

  it('9 · 45 de 50 tampoco', () => {
    for (const r of Object.values(REGLAS_RONDAS)) expect(faltaPorRondas(45, 50, r)).toBeNull()
  })

  it('10 · 40 de 50 (80 %) tampoco', () => {
    expect(faltaPorRondas(40, 50, R1)).toBeNull()
    expect(faltaPorRondas(40, 50, R2)).toBeNull()
  })

  it('11 · 35 de 50 (70 %) tampoco', () => {
    expect(faltaPorRondas(35, 50, R2)).toBeNull()
  })

  it('12 · 30 de 50 (60 %) está justo en el borde de R2 y no cae', () => {
    expect(faltaPorRondas(30, 50, R2)).toBeNull()
    expect(faltaPorRondas(30, 50, R1)).toBeNull()
  })

  it('13 · 25 de 50 (50 %) separa R1 de R2: es el caso que decide', () => {
    expect(faltaPorRondas(25, 50, R1)).toBeNull()
    expect(faltaPorRondas(25, 50, R2)!.tope).toBe(4)
    expect(faltaPorRondas(25, 50, R5)!.tope).toBe(6)
  })

  it('14 · 20 de 50 (40 %) es falta crítica en todas', () => {
    for (const r of Object.values(REGLAS_RONDAS)) {
      expect(faltaPorRondas(20, 50, r)!.tope).toBe(4)
    }
  })

  it('15 · 4 de 10 (40 %) es crítica: 10 exigibles alcanzan como muestra en R1/R2', () => {
    expect(faltaPorRondas(4, 10, R1)!.tope).toBe(4)
    // Pero con mínimo 12 no, y ahí está el problema de R3/R4.
    expect(faltaPorRondas(4, 10, REGLAS_RONDAS.R3)).toBeNull()
  })

  it('16 · 1 de 2 NO es falta crítica: la muestra no alcanza', () => {
    for (const r of Object.values(REGLAS_RONDAS)) expect(faltaPorRondas(1, 2, r)).toBeNull()
    expect(faltaPorRondas(0, 2, R1)).toBeNull()
  })

  it('R3 y R4 dejarían fuera al peor caso real: 0 de 9', () => {
    expect(faltaPorRondas(0, 9, R1)!.tope).toBe(4)
    expect(faltaPorRondas(0, 9, REGLAS_RONDAS.R3)).toBeNull()
    expect(faltaPorRondas(0, 9, REGLAS_RONDAS.R4)).toBeNull()
  })

  it('el hecho se enuncia sin interpretación disciplinaria', () => {
    const f = faltaPorRondas(20, 50, R1)!
    expect(f.hecho).toBe('Realizó 20 de 50 rondas exigibles (40 %)')
    expect(f.hecho).not.toMatch(/dormido|abandon|negligen|no estaba/i)
  })

  it('17-19 · lo excluido no entra al universo: técnica, configuración y no aplica', () => {
    const tecnica = fuentesDeEmpleado(rondas({
      obligaciones: 30, cumplidas: 18, bajoPausa: 12, pausaNoAtribuible: 12,
      causasPausa: { tecnica_gps: 12 },
    }), [])
    expect(tecnica.rondas.medicion.validos).toBe(18)
    expect(faltaPorRondas(18, 18, REGLAS_RONDAS.R1)).toBeNull()

    const capacit = fuentesDeEmpleado(rondas({
      obligaciones: 30, cumplidas: 18, bajoPausa: 12, pausaCapacitacion: 12,
    }), [])
    expect(capacit.rondas.medicion.validos).toBe(18)

    const sinRondas = calcular(mes(20), rondas({ obligaciones: 0 }))
    expect(dim(sinRondas, 'rondas').estado).toBe('no_aplica')
    expect(faltaPorRondas(0, 0, REGLAS_RONDAS.R1)).toBeNull()
  })

  it('20 · la ronda atribuible no realizada SÍ entra al universo', () => {
    const m = fuentesDeEmpleado(rondas({
      obligaciones: 30, cumplidas: 12, bajoPausa: 18, pausaAtribuible: 18,
      causasPausa: { no_se_realiza: 18 },
    }), [])
    expect(m.rondas.medicion.validos).toBe(30)
    expect(faltaPorRondas(12, 30, REGLAS_RONDAS.R1)!.tope).toBe(4)
  })
})

// ── Las dos capas ───────────────────────────────────────────────────────────

describe('las dos capas se conservan', () => {
  it('21 · el índice y la nota escolar sobreviven al tope', () => {
    const e = evaluar(96, [faltaPorInasistencia(1)])
    expect(e.indice).toBe(96)
    expect(e.desempeno).toBe(notaEscolar(96))
    expect(e.desempeno).toBeGreaterThan(8)
    expect(e.notaFinal).toBe(4)
  })

  it('sin faltas, la nota final ES el desempeño', () => {
    const e = evaluar(88, [])
    expect(e.notaFinal).toBe(e.desempeno)
    expect(e.faltas).toHaveLength(0)
  })

  it('el tope nunca SUBE una nota', () => {
    // Alguien ya aplazado por desempeño no mejora porque el tope sea 4.
    const e = evaluar(50, [faltaPorInasistencia(1)])
    expect(e.desempeno).toBeLessThan(4)
    expect(e.notaFinal).toBe(e.desempeno)
  })

  it('con dos faltas manda la más grave', () => {
    const e = evaluar(100, [faltaPorInasistencia(1), faltaPorRondas(25, 50, REGLAS_RONDAS.R5)])
    expect(e.notaFinal).toBe(4)
    expect(e.faltas).toHaveLength(2)
  })

  it('la escala es continua: 0,1 de índice no mueve un punto entero', () => {
    for (let i = 0; i <= 99.9; i += 0.1) {
      expect(Math.abs(notaEscolar(i + 0.1) - notaEscolar(i))).toBeLessThan(0.4)
    }
  })

  it('la escala es monótona', () => {
    let previa = -Infinity
    for (let i = 0; i <= 100; i += 0.25) {
      const n = notaEscolar(i)
      expect(n).toBeGreaterThanOrEqual(previa)
      previa = n
    }
  })
})

// ── Qué NO puede disparar un aplazo ─────────────────────────────────────────

describe('26-29 · sólo Asistencia y Rondas pueden ser falta crítica', () => {
  it('26 · Registro en App por sí solo no aplaza', () => {
    const res = calcular(mes(20).map((f, i) => i < 12 ? { ...f, salidaPropia: false } : f))
    expect(dim(res, 'procedimiento').nota).toBe(4)
    const e = evaluar(indice(res), [faltaPorInasistencia(res.base.ausencias)])
    expect(e.faltas).toHaveLength(0)
    expect(e.notaFinal).toBe(e.desempeno)
  })

  it('27 · Uniforme por sí solo no aplaza', () => {
    const res = calcularCumplimiento(
      mes(20).map(jornadaCumplimientoDesdeFila),
      { ...fuentesDeEmpleado(null, []).fuentes, uniforme: { nota: 4, detalle: '4 de 10' } }, M6)
    expect(dim(res, 'uniforme').nota).toBe(4)
    expect(evaluar(indice(res), []).faltas).toHaveLength(0)
  })

  it('28 · Libro por sí solo no aplaza', () => {
    const res = calcularCumplimiento(
      mes(20).map(jornadaCumplimientoDesdeFila),
      { ...fuentesDeEmpleado(null, []).fuentes, libro_guardia: { nota: 4, detalle: '4 de 10' } }, M6)
    expect(dim(res, 'libro_guardia').nota).toBe(4)
    expect(evaluar(indice(res), []).faltas).toHaveLength(0)
  })

  it('29 · Puntualidad baja el promedio y no inventa una ausencia', () => {
    const res = calcular(mes(20, { entrada: '08:30' }))
    expect(dim(res, 'puntualidad').nota!).toBeLessThan(5)
    expect(res.base.ausencias).toBe(0)
    expect(evaluar(indice(res), [faltaPorInasistencia(res.base.ausencias)]).faltas).toHaveLength(0)
  })
})

// ── Cobertura ───────────────────────────────────────────────────────────────

describe('22-25 · cobertura y el significado del 10', () => {
  it('22 · 10 integral: se midió casi todo lo exigible', () => {
    const res = calcular(mes(20), rondas({ obligaciones: 20, cumplidas: 20 }))
    const c = coberturaDe(res.dimensiones, M6)
    expect(res.puntaje).toBe(10)
    expect(suficienciaDe(c.ajustada)).toBe('integral')
    expect(leyenda(evaluar(100, []), c.ajustada)).not.toContain('parcial')
  })

  it('23 · 10 parcial: tenía rondas y no se pudieron medir', () => {
    const res = calcular(mes(20), rondas({ obligaciones: 4, cumplidas: 4 }))
    const c = coberturaDe(res.dimensiones, M6)
    expect(res.puntaje).toBe(10)
    expect(dim(res, 'rondas').estado).toBe('datos_insuficientes')
    expect(suficienciaDe(c.ajustada)).toBe('parcial')
    expect(leyenda(evaluar(100, []), c.ajustada)).toContain('Evaluación parcial')
  })

  it('24-25 · bruta y ajustada: no tener rondas no es tener menos evaluación', () => {
    const sinRondas = calcular(mes(20), rondas({ obligaciones: 0 }))
    const c = coberturaDe(sinRondas.dimensiones, M6)
    // Sin rondas y sin fotos evaluables, tres dimensiones quedan en No aplica.
    expect(c.noAplica).toBe(M6.rondas + M6.uniforme + M6.libro_guardia)
    expect(c.ajustada!).toBeGreaterThan(c.bruta)
    // Y sobre lo que sí le correspondía, se le midió todo.
    expect(c.ajustada).toBe(100)
  })

  it('el umbral es el mismo en los dos extremos, y no cambia ningún número', () => {
    expect(COBERTURA_MINIMA_PARA_CALIFICAR).toBe(70)
    const e = evaluar(62, [])
    expect(leyenda(e, 50.7)).toContain('Evaluación parcial')
    // El desempeño se conserva intacto: la leyenda no lo toca.
    expect(e.notaFinal).toBe(e.desempeno)
  })
})

// ── Monotonicidad ───────────────────────────────────────────────────────────

describe('30 · mejor desempeño nunca da peor resultado', () => {
  it('más rondas cumplidas: ni el índice ni la nota final bajan', () => {
    let previoIdx = -1
    let previoFinal = -1
    for (let c = 0; c <= 20; c += 2) {
      const res = calcular(mes(20), rondas({ obligaciones: 20, cumplidas: c, noIniciada: 20 - c }))
      const e = evaluar(indice(res), [faltaPorRondas(c, 20, REGLAS_RONDAS.R1)])
      expect(res.puntaje!).toBeGreaterThanOrEqual(previoIdx)
      expect(e.notaFinal).toBeGreaterThanOrEqual(previoFinal)
      previoIdx = res.puntaje!
      previoFinal = e.notaFinal
    }
  })

  it('el modelo productivo sigue sin topes ni escala', () => {
    expect(PESOS).toEqual(VARIANTES_PESOS.modelo_e_sin_lastre)
    const res = calcularCumplimiento(mes(20).map(jornadaCumplimientoDesdeFila), {}, PESOS)
    expect(res.puntaje).toBe(10)
  })
})
