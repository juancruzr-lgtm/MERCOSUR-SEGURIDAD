import { describe, expect, it } from 'vitest'
import {
  COBERTURA_MINIMA_PUNTUALIDAD, PESOS, calcularCumplimiento, puntualidadEsSostenible,
} from '@/lib/cumplimiento'
import type { ClaveDimension } from '@/lib/cumplimiento'
import { APRUEBA_DESDE } from '@/lib/cumplimiento-medicion'
import { fuentesDeEmpleado, resumirRondas } from '@/lib/cumplimiento-fuentes'
import type { RondasEmpleado } from '@/lib/cumplimiento-fuentes'
import { jornadaCumplimientoDesdeFila } from '@/lib/desempeno-datos'
import type { FilaBandejaMensual } from '@/lib/bandeja-planillas'
import { ensenanzasDeEmpleado } from '@/lib/entrenador-datos'

// Las dos reglas de atribución, sobre las que se apoya todo el resto del
// modelo. Miden qué hechos son válidos; NO cuánto vale cada uno.
//
//   REGLA 1  La incertidumbre protege al vigilador sobre lo que no sabemos;
//            no elimina lo que sí sabemos.
//   REGLA 2  Lo que no sabemos no suma ni resta; lo que sabemos se penaliza
//            una sola vez.

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

/** Un mes de jornadas impecables. */
const mes = (n = 20, over: Partial<FilaBandejaMensual> = {}) =>
  Array.from({ length: n }, (_, i) => fila({ turnoId: `p${i}`, ...over }))

const calcular = (filas: FilaBandejaMensual[], r: RondasEmpleado | null = null) =>
  calcularCumplimiento(filas.map(jornadaCumplimientoDesdeFila), fuentesDeEmpleado(r, []).fuentes, PESOS)

const dim = (res: ReturnType<typeof calcular>, clave: ClaveDimension) =>
  res.dimensiones.find(d => d.clave === clave)!

// ── REGLA 1 ─────────────────────────────────────────────────────────────────

describe('REGLA 1 · la incertidumbre no borra lo comprobado', () => {
  it('1 · 0 de 9 comprobables no puede hacer desaparecer la dimensión', () => {
    const r = rondas({ obligaciones: 16, cumplidas: 0, noIniciada: 9, bajoPausa: 7, pausaSinClasificar: 7 })
    const res = calcular(mes(), r)
    expect(dim(res, 'rondas').estado).toBe('puntuable')
    expect(dim(res, 'rondas').nota).toBe(0)
    expect(res.puntaje).toBeLessThan(10)
  })

  it('2 · si lo ambiguo puede cambiar la conclusión, sigue En validación', () => {
    // 8 de 9 comprobables aprueba con holgura. Que existan 7 ventanas que nadie
    // pudo clasificar mueve el número, y por eso no se afirma ninguno.
    const r = rondas({ obligaciones: 16, cumplidas: 8, noIniciada: 1, bajoPausa: 7, pausaSinClasificar: 7 })
    const res = calcular(mes(), r)
    expect(dim(res, 'rondas').estado).toBe('en_validacion')
    expect(res.puntaje).toBe(10)
  })

  it('3 · lo ambiguo NUNCA se convierte automáticamente en incumplimiento', () => {
    const r = resumirRondas(rondas({
      obligaciones: 16, cumplidas: 0, noIniciada: 9, bajoPausa: 7, pausaSinClasificar: 7,
    }))
    // Las 7 ambiguas no se cuentan como no realizadas ni entran al denominador.
    expect(r.noRealizadas).toBe(9)
    expect(r.atribuibles).toBe(9)
    expect(r.medicion.requeridos).toBe(16)
  })

  it('la nota que puntúa es el TECHO, nunca el piso', () => {
    const r = resumirRondas(rondas({
      obligaciones: 216, cumplidas: 19, noIniciada: 33, bajoPausa: 164,
      saneadas: 68, pausaSinClasificar: 96,
    }))
    expect(r.medicion.rango!.techo).toBe(r.nota)
    expect(r.nota!).toBeGreaterThan(r.medicion.rango!.piso)
    expect(r.enValidacion).toBe(false)
  })

  it('el corte es el aprobado de la escala, no un número inventado', () => {
    expect(APRUEBA_DESDE).toBe(6)
    // 6 de 10 comprobables da exactamente 6: aprueba, así que la duda importa.
    expect(resumirRondas(rondas({
      obligaciones: 20, cumplidas: 6, noIniciada: 4, bajoPausa: 10, pausaSinClasificar: 10,
    })).enValidacion).toBe(true)
    // 5 de 10 no aprueba de ninguna manera.
    expect(resumirRondas(rondas({
      obligaciones: 20, cumplidas: 5, noIniciada: 5, bajoPausa: 10, pausaSinClasificar: 10,
    })).enValidacion).toBe(false)
  })

  it('sin ambigüedad la regla no opina: no hay rango', () => {
    const r = resumirRondas(rondas({ obligaciones: 20, cumplidas: 18, noIniciada: 2 }))
    expect(r.medicion.ambigua).toBe(false)
    expect(r.medicion.rango).toBeNull()
    expect(r.enValidacion).toBe(false)
  })

  it('NO se extiende a Calidad de evidencias, que no puntúa por decisión', () => {
    // Calidad mide si la foto se podía leer. Está en validación a propósito y
    // con peso 0: la Regla 1 mira la ambigüedad del universo, no esa decisión.
    const res = calcular(mes())
    expect(dim(res, 'evidencias').estado).not.toBe('puntuable')
    expect(PESOS.evidencias).toBe(0)
  })

  it('4 · persona sin rondas asignadas → No aplica, ni 0 ni 10', () => {
    const res = calcular(mes(), rondas({ obligaciones: 0 }))
    expect(dim(res, 'rondas').estado).toBe('no_aplica')
    expect(dim(res, 'rondas').nota).toBeNull()
  })

  it('5 · muestra insuficiente → Datos insuficientes, no una nota', () => {
    const res = calcular(mes(), rondas({ obligaciones: 4, cumplidas: 0, noIniciada: 4 }))
    expect(dim(res, 'rondas').estado).toBe('datos_insuficientes')
    expect(dim(res, 'rondas').nota).toBeNull()
  })

  it('6 · falla técnica → sale del universo y no penaliza', () => {
    const res = calcular(mes(), rondas({
      obligaciones: 30, cumplidas: 18, bajoPausa: 12, pausaNoAtribuible: 12,
      causasPausa: { tecnica_gps: 12 },
    }))
    expect(dim(res, 'rondas').nota).toBe(10)
    expect(dim(res, 'rondas').estado).toBe('puntuable')
  })

  it('7 · ronda atribuible no realizada → penaliza', () => {
    const r = resumirRondas(rondas({
      obligaciones: 30, cumplidas: 18, bajoPausa: 12, pausaAtribuible: 12,
      causasPausa: { no_se_realiza: 12 },
    }))
    expect(r.medicion.validos).toBe(30)
    expect(r.noRealizadas).toBe(12)
    expect(r.nota).toBe(6)
  })
})

// ── REGLA 2 ─────────────────────────────────────────────────────────────────

describe('REGLA 2 · un hecho, un castigo', () => {
  /** `sin` jornadas sin registro propio + `puntual` a horario + `tarde` tardías. */
  const conCobertura = (sin: number, puntual: number, tarde: number) => [
    ...Array.from({ length: sin }, (_, i) => fila({ turnoId: `s${i}`, entradaPropia: false })),
    ...Array.from({ length: puntual }, (_, i) => fila({ turnoId: `k${i}`, entrada: '06:50' })),
    ...Array.from({ length: tarde }, (_, i) => fila({ turnoId: `t${i}`, entrada: '07:40' })),
  ]

  it('8 · cobertura 49 % → Datos insuficientes', () => {
    const res = calcular(conCobertura(51, 47, 2))
    expect(res.puntualidad.evaluadas).toBe(49)
    expect(res.base.observacionesValidas).toBe(100)
    expect(dim(res, 'puntualidad').estado).toBe('datos_insuficientes')
    expect(dim(res, 'puntualidad').nota).toBeNull()
  })

  it('9 · cobertura 50 % → evaluable', () => {
    const res = calcular(conCobertura(50, 48, 2))
    expect(res.puntualidad.evaluadas).toBe(50)
    expect(dim(res, 'puntualidad').estado).toBe('puntuable')
    expect(dim(res, 'puntualidad').nota).not.toBeNull()
  })

  it('el corte es exactamente la mitad, y no depende de a quién se mire', () => {
    expect(COBERTURA_MINIMA_PUNTUALIDAD).toBe(0.5)
    expect(puntualidadEsSostenible(49, 100)).toBe(false)
    expect(puntualidadEsSostenible(50, 100)).toBe(true)
    expect(puntualidadEsSostenible(0, 0)).toBe(false)
  })

  it('debajo del corte NO se asume puntualidad ni impuntualidad', () => {
    // Mismo mes, dos historias distintas en las pocas jornadas medibles: el
    // resultado es el mismo, porque no se afirma nada.
    const impecable = calcular(conCobertura(16, 4, 0))
    const pesimo = calcular(conCobertura(16, 0, 4))
    expect(dim(impecable, 'puntualidad').estado).toBe('datos_insuficientes')
    expect(dim(pesimo, 'puntualidad').estado).toBe('datos_insuficientes')
    expect(impecable.puntaje).toBe(pesimo.puntaje)
  })

  it('10 · sin fichaje propio → Procedimiento, nunca Puntualidad', () => {
    const res = calcular(conCobertura(10, 10, 0))
    expect(res.base.incidencias.sin_registro_propio).toBe(10)
    expect(res.puntualidad.evaluadas).toBe(10)
    expect(res.puntualidad.sinDato).toBe(10)
    expect(res.puntualidad.impuntuales).toBe(0)
  })

  it('11 · tardanza con fichaje propio → Puntualidad, y Procedimiento intacto', () => {
    const res = calcular(mes(20, { entrada: '07:40' }))
    expect(dim(res, 'puntualidad').nota!).toBeLessThan(10)
    expect(dim(res, 'procedimiento').nota).toBe(10)
  })

  it('la tolerancia para fichar tarde no convierte la llegada en puntual', () => {
    expect(dim(calcular(mes(20, { entrada: '07:01' })), 'puntualidad').nota!).toBeLessThan(10)
    expect(dim(calcular(mes(20, { entrada: '07:00' })), 'puntualidad').nota).toBe(10)
    expect(dim(calcular(mes(20, { entrada: '06:45' })), 'puntualidad').nota).toBe(10)
  })
})

// ── Matriz de doble castigo ─────────────────────────────────────────────────

describe('un hecho atribuible = una incidencia primaria', () => {
  it('12 · entrada sin salida cuenta una sola vez en Procedimiento', () => {
    const res = calcular(mes(20).map((f, i) => i < 5 ? { ...f, salidaPropia: false } : f))
    expect(res.base.incidencias.entrada_sin_salida).toBe(5)
    expect(res.base.incidencias.sin_registro_propio).toBe(0)
    expect(dim(res, 'puntualidad').nota).toBe(10)
  })

  it('13 · el cierre automático no agrega una incidencia aparte', () => {
    const conCierre = calcular(mes(20).map((f, i) =>
      i < 5 ? { ...f, salidaPropia: false, salidaAutomatica: true } : f))
    const sinCierre = calcular(mes(20).map((f, i) =>
      i < 5 ? { ...f, salidaPropia: false } : f))
    expect(conCierre.puntaje).toBe(sinCierre.puntaje)
    expect(conCierre.base.incidencias.entrada_sin_salida).toBe(5)
  })

  it('14 · la ausencia es de Asistencia y no se cobra en Procedimiento', () => {
    // Una ausencia confirmada llega sin fichaje y sin marcas propias: si el
    // orden de los hechos estuviera mal, la misma jornada aportaría además una
    // incidencia de uso del sistema.
    const res = calcular(mes(20).map((f, i) => i < 2
      ? { ...f, esAusencia: true, tieneFichaje: false, entradaPropia: false, salidaPropia: false }
      : f))
    expect(res.base.ausencias).toBe(2)
    expect(dim(res, 'asistencia').nota!).toBeLessThan(10)
    expect(res.base.incidencias.sin_registro_propio).toBe(0)
    expect(res.base.incidencias.entrada_sin_salida).toBe(0)
    // Y tampoco inventa una hora de llegada para esas dos.
    expect(res.puntualidad.evaluadas).toBe(18)
  })

  it('la asistencia confirmada por el supervisor no es una ausencia', () => {
    const res = calcular(mes(20).map((f, i) => i < 7 ? { ...f, entradaPropia: false } : f))
    expect(dim(res, 'asistencia').nota).toBe(10)
    expect(res.base.ausencias).toBe(0)
    expect(res.base.incidencias.sin_registro_propio).toBe(7)
  })

  it('17 · ningún hecho genera dos penalizaciones por falta de información', () => {
    // 20 de 25 sin registro propio: Procedimiento lo cobra, Puntualidad no.
    const res = calcular([
      ...Array.from({ length: 20 }, (_, i) => fila({ turnoId: `s${i}`, entradaPropia: false })),
      ...Array.from({ length: 5 }, (_, i) => fila({ turnoId: `k${i}` })),
    ])
    expect(res.base.incidencias.sin_registro_propio).toBe(20)
    expect(dim(res, 'procedimiento').nota!).toBeLessThan(10)
    expect(dim(res, 'puntualidad').estado).toBe('datos_insuficientes')
  })

  it('dos hechos distintos el mismo día SÍ pueden afectar dos dimensiones', () => {
    // Llegó tarde Y no hizo las rondas: son hechos diferentes.
    const res = calcular(mes(20, { entrada: '07:40' }), rondas({ obligaciones: 20, cumplidas: 10, noIniciada: 10 }))
    expect(dim(res, 'puntualidad').nota!).toBeLessThan(10)
    expect(dim(res, 'rondas').nota).toBe(5)
  })
})

// ── El denominador ──────────────────────────────────────────────────────────

describe('el denominador no regala ni castiga', () => {
  it('15 · No aplica no agrega un 10', () => {
    const conRondasPerfectas = calcular(mes(), rondas({ obligaciones: 30, cumplidas: 30 }))
    const sinRondas = calcular(mes(), rondas({ obligaciones: 0 }))
    // Los dos dan 10, pero por razones distintas: hay que verlo en el peso.
    expect(dim(sinRondas, 'rondas').peso).toBe(PESOS.rondas)
    expect(dim(sinRondas, 'rondas').estado).toBe('no_aplica')
    // Y con una dimensión floja, la que no aplica no la diluye.
    const flojo = calcular(mes(20, { entrada: '07:40' }), rondas({ obligaciones: 0 }))
    const flojoConRondas = calcular(mes(20, { entrada: '07:40' }), rondas({ obligaciones: 30, cumplidas: 30 }))
    expect(flojoConRondas.puntaje!).toBeGreaterThan(flojo.puntaje!)
    expect(conRondasPerfectas.puntaje).toBe(10)
  })

  it('16 · Datos insuficientes tampoco agrega un 10', () => {
    const res = calcular(mes(20, { entrada: '07:40' }), rondas({ obligaciones: 4, cumplidas: 4 }))
    const sin = calcular(mes(20, { entrada: '07:40' }), rondas({ obligaciones: 0 }))
    expect(dim(res, 'rondas').estado).toBe('datos_insuficientes')
    expect(res.puntaje).toBe(sin.puntaje)
  })

  it('18 · mejor desempeño nunca produce peor resultado', () => {
    let previa = -1
    for (let c = 0; c <= 30; c += 3) {
      const p = calcular(mes(), rondas({ obligaciones: 30, cumplidas: c, noIniciada: 30 - c })).puntaje!
      expect(p).toBeGreaterThanOrEqual(previa)
      previa = p
    }
  })

  it('trabajar más no da peor nota si la proporción es igual', () => {
    const corto = calcular(mes(10), rondas({ obligaciones: 10, cumplidas: 9, noIniciada: 1 }))
    const largo = calcular(mes(40), rondas({ obligaciones: 40, cumplidas: 36, noIniciada: 4 }))
    expect(largo.puntaje).toBe(corto.puntaje)
  })
})

// ── Lo que se lee en pantalla ───────────────────────────────────────────────
//
// El número nunca va solo. Y lo que lo acompaña tiene que ser el hecho, no la
// fórmula: nadie decide sobre una persona leyendo un porcentaje técnico.

describe('los textos dicen hechos, no fórmulas', () => {
  it('Rondas que puntúa con 0 dice cuántas eran y cuántas quedaron sin clasificar', () => {
    const res = calcular(mes(22), rondas({
      obligaciones: 16, cumplidas: 0, noIniciada: 9, bajoPausa: 7, pausaSinClasificar: 7,
    }))
    const d = dim(res, 'rondas')
    expect(d.detalle).toContain('0 de 9')
    expect(d.detalle).toContain('7 pausadas sin causa registrada')
    // Puntúa, así que no arrastra el cartel de "en validación".
    expect(d.faltante).toBeUndefined()
  })

  it('Rondas que sigue en validación explica que no se puede atribuir', () => {
    const res = calcular(mes(22), rondas({
      obligaciones: 16, cumplidas: 8, noIniciada: 1, bajoPausa: 7, pausaSinClasificar: 7,
    }))
    expect(dim(res, 'rondas').faltante).toContain('sin causa')
  })

  it('Puntualidad sin cobertura dice en cuántas jornadas se pudo medir', () => {
    const res = calcular([
      ...Array.from({ length: 20 }, (_, i) => fila({ turnoId: `s${i}`, entradaPropia: false })),
      ...Array.from({ length: 5 }, (_, i) => fila({ turnoId: `k${i}` })),
    ])
    const f = dim(res, 'puntualidad').faltante!
    expect(f).toContain('5 de 25 jornadas')
    expect(f).toContain('Procedimiento')
    // Nada de porcentajes técnicos ni nombres de constantes.
    expect(f).not.toMatch(/%|COBERTURA|0\.5/)
  })

  it('ninguna explicación afirma algo sobre jornadas desconocidas', () => {
    const res = calcular([
      ...Array.from({ length: 20 }, (_, i) => fila({ turnoId: `s${i}`, entradaPropia: false })),
      ...Array.from({ length: 5 }, (_, i) => fila({ turnoId: `k${i}` })),
    ])
    const f = dim(res, 'puntualidad').faltante!
    expect(f).not.toMatch(/impuntual|tarde|puntual /i)
  })
})

// ── Regresión de los tres casos que motivaron las reglas ────────────────────
//
// Los nombres son la etiqueta del caso, no lógica: ninguna regla del sistema
// conoce a nadie. Los números son los medidos en agosto 2026.

describe('regresión · los tres casos reales', () => {
  it('OYOLA · 0 de 9 rondas comprobables ya no puede dar 10', () => {
    const r = rondas({ obligaciones: 16, cumplidas: 0, noIniciada: 9, bajoPausa: 7, pausaSinClasificar: 7 })
    const res = calcular(mes(22), r)
    expect(dim(res, 'rondas').estado).toBe('puntuable')
    expect(dim(res, 'rondas').nota).toBe(0)
    expect(res.puntaje!).toBeLessThan(8)
  })

  it('OYOLA · y el Entrenador ya no contradice al tablero', () => {
    const r = rondas({ obligaciones: 16, cumplidas: 0, noIniciada: 9, bajoPausa: 7, pausaSinClasificar: 7 })
    const medido = fuentesDeEmpleado(r, [])
    const res = calcularCumplimiento(mes(22).map(jornadaCumplimientoDesdeFila), medido.fuentes, PESOS)
    const ens = ensenanzasDeEmpleado('2026-08', res, { rondas: medido.rondas })
    // Si el Entrenador lo considera suficientemente cierto para enseñarlo,
    // Cumplimiento no puede tratarlo como inexistente.
    expect(ens.some(e => e.clave === 'rondas')).toBe(true)
    expect(dim(res, 'rondas').estado).toBe('puntuable')
  })

  it('PIÑERO · 19 de 52 comprobables puntúa con el techo, no con el piso', () => {
    const r = resumirRondas(rondas({
      obligaciones: 216, cumplidas: 19, noIniciada: 33, bajoPausa: 164,
      saneadas: 68, pausaSinClasificar: 96,
    }))
    expect(r.medicion.validos).toBe(52)
    expect(r.nota).toBe(3.65)
    expect(r.medicion.rango!.piso).toBe(0.88)
    expect(r.enValidacion).toBe(false)
  })

  it('ROSÓN · las 20 jornadas sin registro siguen en Procedimiento y salen de Puntualidad', () => {
    const res = calcular([
      ...Array.from({ length: 20 }, (_, i) => fila({ turnoId: `s${i}`, entradaPropia: false })),
      ...Array.from({ length: 3 }, (_, i) => fila({ turnoId: `k${i}`, entrada: '06:50' })),
      ...Array.from({ length: 2 }, (_, i) => fila({ turnoId: `t${i}`, entrada: '07:40' })),
    ])
    expect(res.base.observacionesValidas).toBe(25)
    expect(res.base.incidencias.sin_registro_propio).toBe(20)
    expect(dim(res, 'procedimiento').nota).toBe(2)
    expect(dim(res, 'asistencia').nota).toBe(10)
    expect(dim(res, 'puntualidad').estado).toBe('datos_insuficientes')
  })

  it('ROSÓN · y su puntaje deja de cargar una impuntualidad que nadie puede afirmar', () => {
    const filas = [
      ...Array.from({ length: 20 }, (_, i) => fila({ turnoId: `s${i}`, entradaPropia: false })),
      ...Array.from({ length: 3 }, (_, i) => fila({ turnoId: `k${i}`, entrada: '06:50' })),
      ...Array.from({ length: 2 }, (_, i) => fila({ turnoId: `t${i}`, entrada: '07:40' })),
    ]
    const conRegla = calcular(filas)
    // Sin la Regla 2 la nota de Puntualidad sería la de esas 5 jornadas.
    expect(conRegla.puntualidad.nota!).toBeLessThan(APRUEBA_DESDE)
    expect(dim(conRegla, 'puntualidad').nota).toBeNull()
    expect(conRegla.puntaje!).toBeGreaterThan(0)
  })
})
