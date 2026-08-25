import { describe, expect, it } from 'vitest'
import {
  MIN_COBERTURA,
  MIN_OBSERVACIONES,
  calcularDesempeno,
  esConfirmacionDeSupervisor,
  estadoDePuntaje,
  faltanteParaMuestra,
  hechoDeJornada,
} from '@/lib/desempeno'
import type { JornadaDesempeno } from '@/lib/desempeno'

// Indicador de Desempeño y Cumplimiento — V2.1.
//
// Los patrones de regresión salen de la simulación de agosto 2026 sobre 65
// empleados (docs/diseno-indicadores-empleados.md). Se reproducen por FORMA,
// nunca por identidad: la lógica productiva no conoce a ninguna persona.

const jornada = (over: Partial<JornadaDesempeno> = {}): JornadaDesempeno => ({
  turnoId: 't', tieneRegistro: true, esAusencia: false,
  entradaPropia: true, salidaPropia: true,
  ...over,
})

/** Jornada completa y correcta. */
const ok = (n: number) => Array.from({ length: n }, (_, i) => jornada({ turnoId: `ok${i}` }))

/** Trabajó, el supervisor dio fe, él no registró nada. */
const confirmada = (n: number) => Array.from({ length: n }, (_, i) =>
  jornada({
    turnoId: `c${i}`, entradaPropia: false, salidaPropia: false,
    origenCobertura: 'confirmacion_supervisor',
  }))

/** Registró la entrada y nunca la salida. */
const sinSalida = (n: number) => Array.from({ length: n }, (_, i) =>
  jornada({ turnoId: `s${i}`, salidaPropia: false }))

/** Turno exigible sin ningún registro. */
const sinEvidencia = (n: number) => Array.from({ length: n }, (_, i) =>
  jornada({ turnoId: `h${i}`, tieneRegistro: false, entradaPropia: false, salidaPropia: false }))

const ausente = (n: number) => Array.from({ length: n }, (_, i) =>
  jornada({ turnoId: `a${i}`, esAusencia: true, entradaPropia: false, salidaPropia: false }))

// ── El hecho primario ────────────────────────────────────────────────────────

describe('un hecho por jornada, y uno solo', () => {
  it('sin registro no es una falta: es un hueco', () => {
    expect(hechoDeJornada(jornada({ tieneRegistro: false }))).toBe('sin_evidencia')
  })

  it('la ausencia confirmada es ausencia, no un problema de registro', () => {
    expect(hechoDeJornada(jornada({ esAusencia: true, entradaPropia: false, salidaPropia: false })))
      .toBe('ausencia')
  })

  it('sin entrada propia: incidencia de procedimiento', () => {
    expect(hechoDeJornada(jornada({ entradaPropia: false, salidaPropia: false })))
      .toBe('sin_registro_propio')
  })

  it('entrada sí, salida no: la otra incidencia', () => {
    expect(hechoDeJornada(jornada({ salidaPropia: false }))).toBe('entrada_sin_salida')
  })

  it('entrada y salida: correcta', () => {
    expect(hechoDeJornada(jornada())).toBe('correcta')
  })

  it('sin registro propio NO se cuenta además como entrada sin salida', () => {
    // Le faltan las dos, pero es UN hecho.
    const r = calcularDesempeno(confirmada(1).concat(ok(9)))
    expect(r.incidencias.sin_registro_propio).toBe(1)
    expect(r.incidencias.entrada_sin_salida).toBe(0)
  })
})

// ── El cierre automático no existe para este módulo ──────────────────────────

describe('cierre automático: no es una incidencia aparte', () => {
  it('una jornada sin salida da UNA incidencia, haya o no cierre automático', () => {
    // El cierre automático ni siquiera es un parámetro: no hay forma de que
    // sume una segunda penalización. Medido en produccion, se dispara casi
    // exactamente cuando falta la salida.
    const r = calcularDesempeno(sinSalida(2).concat(ok(8)))
    expect(r.incidencias.entrada_sin_salida).toBe(2)
    const total = r.incidencias.entrada_sin_salida + r.incidencias.sin_registro_propio
    expect(total).toBe(2)
  })
})

// ── Asistencia ≠ Procedimiento ───────────────────────────────────────────────

describe('la confirmación del supervisor no se convierte en ausencia', () => {
  it('asistencia queda en 10 y baja sólo procedimiento', () => {
    const r = calcularDesempeno(confirmada(4).concat(ok(16)))
    expect(r.asistencia).toBe(10)
    expect(r.ausencias).toBe(0)
    expect(r.procedimiento).toBe(8)
    expect(r.incidencias.sin_registro_propio).toBe(4)
  })

  it('la ausencia confirmada sí baja asistencia, y no procedimiento', () => {
    const r = calcularDesempeno(ausente(2).concat(ok(18)))
    expect(r.asistencia).toBe(9)
    expect(r.procedimiento).toBe(10)
  })

  it('reconoce los orígenes de confirmación', () => {
    expect(esConfirmacionDeSupervisor('confirmacion_supervisor')).toBe(true)
    expect(esConfirmacionDeSupervisor('confirmacion_admin')).toBe(true)
    expect(esConfirmacionDeSupervisor('fichaje_gps')).toBe(false)
    expect(esConfirmacionDeSupervisor(null)).toBe(false)
  })
})

// ── Sin dato ≠ ausencia ──────────────────────────────────────────────────────

describe('los turnos sin evidencia', () => {
  it('no bajan asistencia ni procedimiento', () => {
    const r = calcularDesempeno(sinEvidencia(3).concat(ok(17)))
    expect(r.sinEvidencia).toBe(3)
    expect(r.ausencias).toBe(0)
    expect(r.asistencia).toBe(10)
    expect(r.procedimiento).toBe(10)
    expect(r.observacionesValidas).toBe(17)
  })

  it('pero sí bajan la cobertura', () => {
    const r = calcularDesempeno(sinEvidencia(3).concat(ok(17)))
    expect(r.cobertura).toBe(0.85)
    expect(r.jornadasAplicables).toBe(20)
  })
})

// ── Patrones de regresión (por forma, no por identidad) ──────────────────────

describe('patrones observados en agosto 2026', () => {
  it('muchas jornadas confirmadas sin fichaje propio: requiere intervención', () => {
    // Forma equivalente al peor caso real: 18 de 22 confirmadas.
    const r = calcularDesempeno(confirmada(18).concat(ok(4)))
    expect(r.asistencia).toBe(10)
    expect(r.procedimiento).toBeCloseTo(1.82, 2)
    expect(r.puntaje).toBeCloseTo(3.86, 2)
    expect(r.estado).toBe('requiere_intervencion')
    expect(r.motivos[0].texto).toBe('18 jornadas trabajadas sin registro propio')
  })

  it('ficha la entrada y omite la salida repetidamente', () => {
    // Forma equivalente: 11 de 19.
    const r = calcularDesempeno(sinSalida(11).concat(ok(8)))
    expect(r.procedimiento).toBeCloseTo(4.21, 2)
    expect(r.puntaje).toBeCloseTo(5.66, 2)
    expect(r.estado).toBe('requiere_intervencion')
    expect(r.motivos[0].texto).toBe('11 entradas sin salida registrada')
  })

  it('las dos conductas se cuentan por separado en el detalle', () => {
    const r = calcularDesempeno(confirmada(1).concat(sinSalida(6)).concat(ok(8)))
    expect(r.incidencias.sin_registro_propio).toBe(1)
    expect(r.incidencias.entrada_sin_salida).toBe(6)
    expect(r.motivos.map(m => m.texto)).toEqual([
      '1 jornada trabajada sin registro propio',
      '6 entradas sin salida registrada',
    ])
  })

  it('cero incidencias: excelente, sin necesidad de inventar dispersión', () => {
    const r = calcularDesempeno(ok(20))
    expect(r.puntaje).toBe(10)
    expect(r.estado).toBe('excelente')
    expect(r.motivos).toEqual([])
  })
})

// ── Muestra mínima: las dos condiciones ──────────────────────────────────────

describe('muestra insuficiente: no se muestra ningún número', () => {
  it('poca muestra absoluta', () => {
    const r = calcularDesempeno(ok(5))
    expect(r.datosInsuficientes).toBe(true)
    expect(r.puntaje).toBeNull()
    expect(r.estado).toBe('datos_insuficientes')
    // Las dimensiones sí se calculan: sirven para el detalle interno.
    expect(r.asistencia).toBe(10)
  })

  it('cobertura por debajo del 70 % aunque sobren observaciones', () => {
    // 8 observaciones sobre 19 turnos = 42 %. Es el caso que hacía que excluir
    // dato no confiable fabricara un puntaje perfecto.
    const r = calcularDesempeno(ok(8).concat(sinEvidencia(11)))
    expect(r.observacionesValidas).toBe(8)
    expect(r.observacionesValidas).toBeGreaterThanOrEqual(MIN_OBSERVACIONES)
    expect(r.cobertura).toBeLessThan(MIN_COBERTURA)
    expect(r.datosInsuficientes).toBe(true)
    expect(r.puntaje).toBeNull()
  })

  it('justo en los dos límites, sí calcula', () => {
    // 8 observaciones sobre 10 turnos = 80 %.
    const r = calcularDesempeno(ok(8).concat(sinEvidencia(2)))
    expect(r.datosInsuficientes).toBe(false)
    expect(r.puntaje).toBe(10)
  })

  it('explica cuánto falta, en vez de sólo decir que no alcanza', () => {
    expect(faltanteParaMuestra(calcularDesempeno(ok(5)))).toContain('Faltan 3 jornadas')
    expect(faltanteParaMuestra(calcularDesempeno(ok(8).concat(sinEvidencia(11)))))
      .toContain('cobertura')
    expect(faltanteParaMuestra(calcularDesempeno(ok(20)))).toBeNull()
  })

  it('sin ninguna jornada no explota', () => {
    const r = calcularDesempeno([])
    expect(r.puntaje).toBeNull()
    expect(r.asistencia).toBeNull()
    expect(r.cobertura).toBe(0)
    expect(r.estado).toBe('datos_insuficientes')
  })
})

// ── Estados ──────────────────────────────────────────────────────────────────

describe('estados', () => {
  it('los cortes salen de los casos reales, no de percentiles', () => {
    expect(estadoDePuntaje(10)).toBe('excelente')
    expect(estadoDePuntaje(9.5)).toBe('excelente')
    expect(estadoDePuntaje(9.49)).toBe('correcto')
    expect(estadoDePuntaje(8.5)).toBe('correcto')
    expect(estadoDePuntaje(8.49)).toBe('requiere_seguimiento')
    expect(estadoDePuntaje(7)).toBe('requiere_seguimiento')
    expect(estadoDePuntaje(6.99)).toBe('requiere_intervencion')
    expect(estadoDePuntaje(null)).toBe('datos_insuficientes')
  })
})

// ── Lo que el llamador debe haber filtrado ───────────────────────────────────

describe('el universo lo decide el llamador', () => {
  it('sólo entran turnos exigibles: lo que no entra, no cuenta', () => {
    // Un turno no terminado, o anulado/cancelado/reemplazado, no llega hasta
    // acá. Se verifica por ausencia: la lista que se pasa ya está filtrada y
    // el resultado sólo habla de lo que recibió.
    const soloExigibles = ok(10)
    const r = calcularDesempeno(soloExigibles)
    expect(r.jornadasAplicables).toBe(10)
    expect(r.observacionesValidas).toBe(10)
  })
})
