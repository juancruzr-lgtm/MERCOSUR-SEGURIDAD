import { describe, expect, it } from 'vitest'
import {
  COBERTURA_MINIMA, INASISTENCIA_ACTIVA, MINIMO_RONDAS_EXIGIBLES, alcanceDe,
  coberturaDe, conceptoDe, evaluar, faltaPorInasistencia, faltaPorRondas, notaEscolar,
} from '@/lib/evaluacion-final'
import { ETIQUETA_DIMENSION, PESOS, calcularCumplimiento } from '@/lib/cumplimiento'
import type { ClaveDimension } from '@/lib/cumplimiento'
import { fuentesDeEmpleado } from '@/lib/cumplimiento-fuentes'
import type { RondasEmpleado } from '@/lib/cumplimiento-fuentes'
import { jornadaCumplimientoDesdeFila } from '@/lib/desempeno-datos'
import type { FilaBandejaMensual } from '@/lib/bandeja-planillas'

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

const calcular = (filas: FilaBandejaMensual[], r: RondasEmpleado | null = null) =>
  calcularCumplimiento(filas.map(jornadaCumplimientoDesdeFila), fuentesDeEmpleado(r, []).fuentes, PESOS)

const dim = (res: ReturnType<typeof calcular>, clave: ClaveDimension) =>
  res.dimensiones.find(d => d.clave === clave)!

/** Evaluación completa, tal como la haría la pantalla. */
const evaluarTodo = (
  res: ReturnType<typeof calcular>, cumplidas = 0, exigibles = 0, inasistencias = 0,
) => evaluar(res.puntaje! * 10, res.dimensiones, PESOS, [
  faltaPorRondas(cumplidas, exigibles),
  faltaPorInasistencia(inasistencias),
])

/** Dimensiones armadas a mano, para probar la cobertura como función pura. */
const dims = (estados: Partial<Record<ClaveDimension, string>>) =>
  (Object.keys(PESOS) as ClaveDimension[]).map(clave => ({
    clave, etiqueta: ETIQUETA_DIMENSION[clave], nota: null,
    peso: PESOS[clave], estado: (estados[clave] ?? 'puntuable') as any, detalle: '',
  }))

// ── La escala ───────────────────────────────────────────────────────────────

describe('escala escolar argentina', () => {
  it('pasa por los anclajes auditados, no por los de la primera simulación', () => {
    expect(notaEscolar(100)).toBe(10)
    expect(notaEscolar(98)).toBe(9)
    expect(notaEscolar(94)).toBe(8)
    expect(notaEscolar(88)).toBe(7)
    expect(notaEscolar(80)).toBe(6)
    expect(notaEscolar(68)).toBe(4)
    // La vieja daba 6 acá. Cumplir el 70 % de lo exigido no puede ser aprobar.
    expect(notaEscolar(70)).toBeLessThan(6)
  })

  it('es continua: 0,1 de índice nunca mueve un punto entero', () => {
    for (let i = 0; i <= 99.9; i += 0.1) {
      expect(Math.abs(notaEscolar(i + 0.1) - notaEscolar(i))).toBeLessThan(0.4)
    }
  })

  it('es monótona y está acotada', () => {
    let previa = -Infinity
    for (let i = -20; i <= 120; i += 0.25) {
      const n = notaEscolar(i)
      expect(n).toBeGreaterThanOrEqual(previa)
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(10)
      previa = n
    }
  })

  it('los conceptos son los pedidos', () => {
    expect(conceptoDe(10)).toBe('Sobresaliente')
    expect(conceptoDe(9)).toBe('Excelente')
    expect(conceptoDe(8)).toBe('Muy bueno')
    expect(conceptoDe(7)).toBe('Bueno')
    expect(conceptoDe(6)).toBe('Aprobado')
    expect(conceptoDe(5)).toBe('Insuficiente')
    expect(conceptoDe(4)).toBe('Aplazado')
    expect(conceptoDe(1)).toBe('Aplazado')
  })
})

// ── Faltas críticas de Rondas ───────────────────────────────────────────────

describe('falta crítica · Rondas', () => {
  const casos: Array<[number, number, number | null]> = [
    [50, 50, null], [49, 50, null], [45, 50, null], [40, 50, null],
    [35, 50, null], [30, 50, null],            // 60 % justo: sin tope
    [29, 50, 6],                               // 58 %
    [25, 50, 6],                               // 50 % exacto: tope 6
    [24, 50, 4],                               // 48 %
    [20, 50, 4],                               // 40 %
    [8, 10, null], [6, 10, null],              // 80 % y 60 %
    [5, 10, 6], [4, 10, 4],
    [0, 9, 4],
    [1, 2, null], [0, 2, null],                // muestra insuficiente
  ]

  it.each(casos)('%i de %i → tope %s', (cumplidas, exigibles, tope) => {
    const f = faltaPorRondas(cumplidas, exigibles)
    expect(f?.tope ?? null).toBe(tope)
  })

  it('el mínimo de muestra es 8 y protege al que tuvo pocas rondas', () => {
    expect(MINIMO_RONDAS_EXIGIBLES).toBe(8)
    expect(faltaPorRondas(0, 7)).toBeNull()
    expect(faltaPorRondas(0, 8)!.tope).toBe(4)
  })

  it('el hecho se enuncia sin interpretación disciplinaria', () => {
    const f = faltaPorRondas(19, 52)!
    expect(f.hecho).toBe('Realizó 19 de 52 rondas exigibles (36.5 %)')
    expect(f.hecho).not.toMatch(/dormido|abandon|negligen|grave|falta de/i)
  })

  it('sin rondas exigibles no hay regla crítica de Rondas', () => {
    expect(faltaPorRondas(0, 0)).toBeNull()
    const sinRondas = calcular(mes(20), rondas({ obligaciones: 0 }))
    expect(dim(sinRondas, 'rondas').estado).toBe('no_aplica')
    expect(evaluarTodo(sinRondas, 0, 0).faltas).toHaveLength(0)
  })

  it('con Rondas en datos insuficientes tampoco', () => {
    const pocas = calcular(mes(20), rondas({ obligaciones: 4, cumplidas: 0, noIniciada: 4 }))
    expect(dim(pocas, 'rondas').estado).toBe('datos_insuficientes')
    expect(faltaPorRondas(0, 4)).toBeNull()
  })

  it('lo excluido no entra al universo que mira la regla', () => {
    // Pausa técnica: 12 fuera, quedan 18 y las 18 se cumplieron.
    const tecnica = fuentesDeEmpleado(rondas({
      obligaciones: 30, cumplidas: 18, bajoPausa: 12, pausaNoAtribuible: 12,
    }), [])
    expect(tecnica.rondas.medicion.validos).toBe(18)
    expect(faltaPorRondas(18, 18)).toBeNull()

    // Capacitación: igual.
    const capac = fuentesDeEmpleado(rondas({
      obligaciones: 30, cumplidas: 18, bajoPausa: 12, pausaCapacitacion: 12,
    }), [])
    expect(faltaPorRondas(18, capac.rondas.medicion.validos)).toBeNull()

    // "No se realiza" SÍ entra: era exigible.
    const noSe = fuentesDeEmpleado(rondas({
      obligaciones: 30, cumplidas: 12, bajoPausa: 18, pausaAtribuible: 18,
    }), [])
    expect(noSe.rondas.medicion.validos).toBe(30)
    expect(faltaPorRondas(12, 30)!.tope).toBe(4)
  })
})

// ── Inasistencia ────────────────────────────────────────────────────────────

describe('falta crítica · inasistencia', () => {
  it('la regla NO está activa: falta el cruce con novedades_laborales', () => {
    expect(INASISTENCIA_ACTIVA).toBe(false)
  })

  it('una inasistencia injustificada confirmada impone tope 4', () => {
    expect(faltaPorInasistencia(1)!.tope).toBe(4)
    expect(faltaPorInasistencia(3)!.tope).toBe(4)
    expect(faltaPorInasistencia(3)!.hecho).toContain('3 inasistencias')
  })

  it('no escalona: 1, 2 y 3 topean igual y se muestra la cantidad', () => {
    expect(faltaPorInasistencia(1)!.tope).toBe(faltaPorInasistencia(3)!.tope)
  })

  it('trabajó sin fichar NO es inasistencia', () => {
    const res = calcular(mes(20).map((f, i) => i < 10 ? { ...f, entradaPropia: false } : f))
    expect(res.base.ausencias).toBe(0)
    expect(dim(res, 'asistencia').nota).toBe(10)
    expect(faltaPorInasistencia(res.base.ausencias)).toBeNull()
  })

  it('la asistencia confirmada por el supervisor NO es inasistencia', () => {
    const res = calcular(mes(20).map((f, i) => i < 7 ? { ...f, entradaPropia: false } : f))
    expect(res.base.ausencias).toBe(0)
    expect(faltaPorInasistencia(res.base.ausencias)).toBeNull()
  })

  it('la ausencia no se cobra además en Registro en App', () => {
    const res = calcular(mes(20).map((f, i) => i < 3
      ? { ...f, esAusencia: true, tieneFichaje: false, entradaPropia: false, salidaPropia: false }
      : f))
    expect(res.base.ausencias).toBe(3)
    expect(res.base.incidencias.sin_registro_propio).toBe(0)
    expect(dim(res, 'procedimiento').nota).toBe(10)
  })

  it('la ausencia tampoco se cobra en Rondas: la regla vive en SQL', () => {
    // rondas_ventanas_programadas excluye los turnos con un registro de
    // tipo_registro = 'ausencia'. Acá se fija el espejo de esa condición.
    const exigeRondas = (tipoRegistro: string | null) => tipoRegistro !== 'ausencia'
    expect(exigeRondas('ausencia')).toBe(false)
    expect(exigeRondas('fichaje_gps')).toBe(true)
    expect(exigeRondas('presente_manual')).toBe(true)
    expect(exigeRondas('reemplazo')).toBe(true)
    expect(exigeRondas(null)).toBe(true)
  })
})

// ── Precedencia ─────────────────────────────────────────────────────────────

describe('precedencia de reglas', () => {
  it('nota 9 + rondas críticas → final 4, y el 9 se conserva', () => {
    const e = evaluar(98, dims({}), PESOS, [faltaPorRondas(20, 50)])
    expect(e.desempeno).toBe(9)
    expect(e.notaFinal).toBe(4)
    expect(e.indice).toBe(98)
    expect(e.explicacion).toContain('9 de desempeño')
  })

  it('nota 8 + inasistencia → final 4', () => {
    const e = evaluar(94, dims({}), PESOS, [faltaPorInasistencia(1)])
    expect(e.desempeno).toBe(8)
    expect(e.notaFinal).toBe(4)
  })

  it('un tope NUNCA sube una nota', () => {
    // Desempeño 3, tope 4: queda en 3.
    const e = evaluar(60, dims({}), PESOS, [faltaPorInasistencia(1)])
    expect(e.desempeno).toBeLessThan(4)
    expect(e.notaFinal).toBe(e.desempeno)
  })

  it('rondas al 55 % con desempeño natural 5 queda en 5, no sube a 6', () => {
    const e = evaluar(74, dims({}), PESOS, [faltaPorRondas(28, 51)])
    expect(e.faltas[0].tope).toBe(6)
    expect(e.desempeno).toBeLessThan(6)
    expect(e.notaFinal).toBe(e.desempeno)
  })

  it('dos faltas críticas: manda la más restrictiva', () => {
    const e = evaluar(100, dims({}), PESOS, [faltaPorRondas(28, 51), faltaPorInasistencia(1)])
    expect(e.faltas).toHaveLength(2)
    expect(e.notaFinal).toBe(4)
  })

  it('sin faltas la nota final ES el desempeño', () => {
    const e = evaluar(90, dims({}), PESOS, [])
    expect(e.notaFinal).toBe(e.desempeno)
    expect(e.explicacion).not.toContain('final por')
  })
})

// ── Cobertura ───────────────────────────────────────────────────────────────

describe('cobertura de la evaluación', () => {
  it('todo medido = 100 % por las dos vías', () => {
    const c = coberturaDe(dims({}), PESOS)
    expect(c.bruta).toBe(100)
    expect(c.ajustada).toBe(100)
    expect(alcanceDe(c)).toBe('integral')
  })

  it('NO APLICA no cuenta en contra; DATOS INSUFICIENTES sí', () => {
    const na = coberturaDe(dims({ rondas: 'no_aplica' }), PESOS)
    const di = coberturaDe(dims({ rondas: 'datos_insuficientes' }), PESOS)
    expect(na.ajustada).toBe(100)
    expect(di.ajustada!).toBeLessThan(100)
    expect(na.bruta).toBe(di.bruta)
  })

  it('una dimensión en validación cuenta como no medida', () => {
    const c = coberturaDe(dims({ rondas: 'en_validacion' }), PESOS)
    expect(c.noAplica).toBe(0)
    expect(c.ajustada!).toBeLessThan(100)
  })

  it('el umbral es 70 y separa integral de parcial', () => {
    expect(COBERTURA_MINIMA).toBe(70)
    expect(alcanceDe({ medido: 70, teorico: 100, noAplica: 0, bruta: 70, ajustada: 70 })).toBe('integral')
    expect(alcanceDe({ medido: 69.9, teorico: 100, noAplica: 0, bruta: 69.9, ajustada: 69.9 })).toBe('parcial')
    expect(alcanceDe({ medido: 50, teorico: 100, noAplica: 0, bruta: 50, ajustada: 50 })).toBe('parcial')
  })

  it('con cobertura parcial NO se afirma un concepto integral, y el número no baja', () => {
    const e = evaluar(100, dims({ rondas: 'datos_insuficientes', uniforme: 'datos_insuficientes', libro_guardia: 'datos_insuficientes' }), PESOS, [])
    expect(e.alcance).toBe('parcial')
    expect(e.desempeno).toBe(10)
    expect(e.notaFinal).toBe(10)
    expect(e.concepto).toBe('Evaluación parcial')
    expect(e.explicacion).toContain('Evaluación parcial')
  })

  it('un 10 integral sí se llama Sobresaliente', () => {
    const e = evaluar(100, dims({}), PESOS, [])
    expect(e.alcance).toBe('integral')
    expect(e.concepto).toBe('Sobresaliente')
  })

  it('perder sólo Uniforme y Libro NO alcanza para ser parcial: son 12 de 110', () => {
    const e = evaluar(90, dims({ uniforme: 'datos_insuficientes', libro_guardia: 'datos_insuficientes' }), PESOS, [])
    expect(e.cobertura.ajustada).toBe(89.1)
    expect(e.alcance).toBe('integral')
  })

  it('cobertura parcial + rondas críticas: se muestran los dos hechos', () => {
    // Puntualidad sin cobertura, más Uniforme y Libro sin muestra: quedan
    // medidos 42 de 110 sobre lo exigible.
    const e = evaluar(80, dims({
      puntualidad: 'datos_insuficientes', uniforme: 'datos_insuficientes',
      libro_guardia: 'datos_insuficientes',
    }), PESOS, [faltaPorRondas(20, 50)])
    expect(e.alcance).toBe('parcial')
    expect(e.notaFinal).toBe(4)
    expect(e.faltas).toHaveLength(1)
    expect(e.explicacion).toContain('rondas exigibles')
    expect(e.explicacion).toContain('Evaluación parcial')
  })
})

// ── El nombre ───────────────────────────────────────────────────────────────

describe('Registro en App', () => {
  it('la dimensión se llama por lo que mide, y la clave interna no cambia', () => {
    expect(ETIQUETA_DIMENSION.procedimiento).toBe('Registro en App')
    const res = calcular(mes(20))
    expect(dim(res, 'procedimiento').clave).toBe('procedimiento')
    expect(dim(res, 'procedimiento').etiqueta).toBe('Registro en App')
  })

  it('Registro en App por sí solo nunca es falta crítica', () => {
    const res = calcular(mes(20).map((f, i) => i < 16 ? { ...f, salidaPropia: false } : f))
    expect(dim(res, 'procedimiento').nota).toBe(2)
    expect(evaluarTodo(res).faltas).toHaveLength(0)
  })

  it('Uniforme, Libro y Puntualidad tampoco', () => {
    const conUniLibro = calcularCumplimiento(
      mes(20).map(jornadaCumplimientoDesdeFila),
      {
        ...fuentesDeEmpleado(null, []).fuentes,
        uniforme: { nota: 2, detalle: '2 de 10' },
        libro_guardia: { nota: 2, detalle: '2 de 10' },
      }, PESOS)
    expect(evaluarTodo(conUniLibro).faltas).toHaveLength(0)

    const tarde = calcular(mes(20, { entrada: '09:00' }))
    expect(dim(tarde, 'puntualidad').nota!).toBeLessThan(5)
    expect(tarde.base.ausencias).toBe(0)
    expect(evaluarTodo(tarde).faltas).toHaveLength(0)
  })
})

// ── Monotonicidad de punta a punta ──────────────────────────────────────────

describe('mejor desempeño nunca da peor nota final', () => {
  it('a más rondas cumplidas, ni el índice ni la final bajan', () => {
    let idx = -1
    let fin = -1
    for (let c = 0; c <= 20; c += 2) {
      const res = calcular(mes(20), rondas({ obligaciones: 20, cumplidas: c, noIniciada: 20 - c }))
      const e = evaluarTodo(res, c, 20)
      expect(res.puntaje!).toBeGreaterThanOrEqual(idx)
      expect(e.notaFinal).toBeGreaterThanOrEqual(fin)
      idx = res.puntaje!
      fin = e.notaFinal
    }
  })
})
