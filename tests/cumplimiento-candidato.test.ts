import { describe, expect, it } from 'vitest'
import {
  APRUEBA_DESDE, COBERTURA_MINIMA_PUNTUALIDAD, MODELO_CANDIDATO_ACTIVO,
  PESOS_CANDIDATOS, puntualidadEsSostenible, rangoAmbiguo, resolverAmbiguedad,
} from '@/lib/cumplimiento-candidato'
import { PESOS, VARIANTES_PESOS, calcularCumplimiento } from '@/lib/cumplimiento'
import { fuentesDeEmpleado } from '@/lib/cumplimiento-fuentes'
import type { RondasEmpleado } from '@/lib/cumplimiento-fuentes'
import { jornadaCumplimientoDesdeFila } from '@/lib/desempeno-datos'
import type { FilaBandejaMensual } from '@/lib/bandeja-planillas'
import { ensenanzasDeEmpleado } from '@/lib/entrenador-datos'

// Las dos reglas candidatas, y —antes que ellas— la prueba de que los dos
// defectos que las motivan existen HOY. Si alguien las descarta, que sea
// sabiendo qué queda sin arreglar.

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

const mesPerfecto = (n = 20) => Array.from({ length: n }, (_, i) => fila({ turnoId: `p${i}` }))

const calcular = (filas: FilaBandejaMensual[], r: RondasEmpleado | null, pesos = PESOS) =>
  calcularCumplimiento(filas.map(jornadaCumplimientoDesdeFila), fuentesDeEmpleado(r, []).fuentes, pesos)

// ── El flag ─────────────────────────────────────────────────────────────────

describe('el candidato está apagado', () => {
  it('la constante es false', () => {
    expect(MODELO_CANDIDATO_ACTIVO).toBe(false)
  })

  it('los pesos productivos siguen siendo los del Modelo E, no los candidatos', () => {
    expect(PESOS).toEqual(VARIANTES_PESOS.modelo_e_sin_lastre)
    expect(PESOS.rondas).toBe(30)
    expect(PESOS_CANDIDATOS.rondas).toBe(35)
  })

  it('los pesos candidatos son todos no negativos y Calidad sigue sin pesar', () => {
    for (const p of Object.values(PESOS_CANDIDATOS)) expect(p).toBeGreaterThanOrEqual(0)
    expect(PESOS_CANDIDATOS.evidencias).toBe(0)
  })
})

// ── DEFECTO 1 · la ambigüedad como amnistía ─────────────────────────────────

describe('DEFECTO HOY · cero rondas hechas y nota 10', () => {
  // Reproduce lo medido en agosto: 9 ventanas exigibles, ninguna cumplida, y 7
  // más excluidas porque nadie clasificó la pausa. Todo lo demás impecable.
  const r = rondas({ obligaciones: 16, cumplidas: 0, noIniciada: 9, bajoPausa: 7, pausaSinClasificar: 7 })

  it('la ficha muestra Rondas 0', () => {
    const m = fuentesDeEmpleado(r, [])
    expect(m.rondas.nota).toBe(0)
    expect(m.rondas.enValidacion).toBe(true)
  })

  it('y el puntaje total es 10, con CUALQUIER peso de Rondas', () => {
    for (const v of ['modelo_e_sin_lastre', 'modelo_g_rondas40', 'modelo_d_rondas'] as const) {
      expect(calcular(mesPerfecto(), r, VARIANTES_PESOS[v]).puntaje).toBe(10)
    }
  })

  it('subir el peso de Rondas no arregla nada: el problema no es el peso', () => {
    const conMucho = calcular(mesPerfecto(), r, { ...PESOS, rondas: 90 })
    const conPoco = calcular(mesPerfecto(), r, { ...PESOS, rondas: 1 })
    expect(conMucho.puntaje).toBe(conPoco.puntaje)
  })
})

// ── REGLA 1 · el techo decide ───────────────────────────────────────────────

describe('REGLA 1 · si ni el techo aprueba, la ambigüedad no salva', () => {
  it('cero de cualquier forma que se lo mire: puntúa', () => {
    const res = resolverAmbiguedad(rangoAmbiguo(0, 9, 16))!
    expect(res.puntua).toBe(true)
    expect(res.nota).toBe(0)
  })

  it('19 de 52 saneadas, 216 en total: mal por las dos puntas, puntúa con la mejor', () => {
    const res = resolverAmbiguedad(rangoAmbiguo(19, 52, 216))!
    expect(res.puntua).toBe(true)
    expect(res.nota).toBe(3.65)
    expect(res.nota!).toBeGreaterThan(rangoAmbiguo(19, 52, 216)!.piso)
  })

  it('37 de 38 saneadas pero 128 en total: la conclusión sí depende de lo que falta', () => {
    const res = resolverAmbiguedad(rangoAmbiguo(37, 38, 128))!
    expect(res.puntua).toBe(false)
    expect(res.motivo).toContain('cambia la conclusión')
  })

  it('nunca puntúa con el piso: la duda siempre se resuelve a favor', () => {
    for (const [c, s, t] of [[0, 9, 16], [19, 52, 216], [5, 20, 40], [3, 30, 60]]) {
      const rango = rangoAmbiguo(c, s, t)!
      const res = resolverAmbiguedad(rango)!
      expect(res.nota).toBe(rango.techo)
      expect(rango.techo).toBeGreaterThanOrEqual(rango.piso)
    }
  })

  it('quien no tiene exclusiones ambiguas no se entera de esta regla', () => {
    expect(resolverAmbiguedad(null)).toBeNull()
  })

  it('el corte es el 6 de la escala escolar, no un número inventado', () => {
    expect(APRUEBA_DESDE).toBe(6)
    expect(resolverAmbiguedad(rangoAmbiguo(6, 10, 20))!.puntua).toBe(false)
    expect(resolverAmbiguedad(rangoAmbiguo(59, 100, 200))!.puntua).toBe(true)
  })
})

// ── DEFECTO 2 y REGLA 2 · un hecho, un castigo ──────────────────────────────

describe('DEFECTO HOY · no fichar deforma el denominador de Puntualidad', () => {
  // 25 jornadas, 20 sin registro propio, y de las 5 medibles llegó tarde 2.
  const mes = [
    ...Array.from({ length: 20 }, (_, i) => fila({ turnoId: `s${i}`, entradaPropia: false })),
    ...Array.from({ length: 3 }, (_, i) => fila({ turnoId: `ok${i}`, entrada: '06:50' })),
    ...Array.from({ length: 2 }, (_, i) => fila({ turnoId: `t${i}`, entrada: '07:40' })),
  ]

  it('Procedimiento cobra las 20, que es donde corresponde', () => {
    const res = calcular(mes, null)
    expect(res.base.incidencias.sin_registro_propio).toBe(20)
  })

  it('pero Puntualidad se mide sobre 5 de 25 y da una nota que no describe el mes', () => {
    const res = calcular(mes, null)
    expect(res.puntualidad.evaluadas).toBe(5)
    expect(res.puntualidad.impuntuales).toBe(2)
    // 2 tardanzas sobre 25 jornadas reales serían el 8 %. Acá pesan el 40 %.
    expect(res.dimensiones.find(d => d.clave === 'puntualidad')!.nota!).toBeLessThan(7)
  })

  it('REGLA 2 · con 5 de 25 no hay cobertura para afirmar una nota', () => {
    expect(puntualidadEsSostenible(5, 25)).toBe(false)
    expect(COBERTURA_MINIMA_PUNTUALIDAD).toBe(0.5)
  })

  it('con la mitad o más sí, y la regla no toca a nadie que fiche normalmente', () => {
    expect(puntualidadEsSostenible(10, 20)).toBe(true)
    expect(puntualidadEsSostenible(20, 20)).toBe(true)
    expect(puntualidadEsSostenible(9, 20)).toBe(false)
  })

  it('sin jornadas no afirma cobertura', () => {
    expect(puntualidadEsSostenible(0, 0)).toBe(false)
  })
})

// ── Invariantes que ninguna regla candidata puede romper ────────────────────

describe('lo que las reglas candidatas NO pueden hacer', () => {
  it('quien cumple todo sigue sacando 10 con los pesos candidatos', () => {
    const res = calcular(mesPerfecto(), rondas({ obligaciones: 30, cumplidas: 30 }), PESOS_CANDIDATOS)
    expect(res.puntaje).toBe(10)
  })

  it('quien no tiene rondas asignadas no cambia por el peso de Rondas', () => {
    const sinRondas = calcular(mesPerfecto(), null, PESOS_CANDIDATOS)
    const conOtroPeso = calcular(mesPerfecto(), null, { ...PESOS_CANDIDATOS, rondas: 90 })
    expect(sinRondas.puntaje).toBe(conOtroPeso.puntaje)
  })

  it('hacer más rondas nunca da peor nota', () => {
    let previa = -1
    for (let c = 0; c <= 30; c += 5) {
      const p = calcular(mesPerfecto(), rondas({ obligaciones: 30, cumplidas: c }), PESOS_CANDIDATOS).puntaje!
      expect(p).toBeGreaterThanOrEqual(previa)
      previa = p
    }
  })

  it('trabajar más no da peor nota si la proporción es igual', () => {
    const corto = calcular(mesPerfecto(10), rondas({ obligaciones: 10, cumplidas: 9 }), PESOS_CANDIDATOS)
    const largo = calcular(mesPerfecto(40), rondas({ obligaciones: 40, cumplidas: 36 }), PESOS_CANDIDATOS)
    expect(largo.puntaje).toBe(corto.puntaje)
  })
})

// ── El Entrenador contra el tablero ─────────────────────────────────────────
//
// La incoherencia más incómoda que dejó la auditoría: sobre exactamente los
// mismos datos, el Entrenador le enseña a alguien que no hizo sus rondas
// mientras el tablero le pone 10. No es un defecto del Entrenador —mira las
// incidencias, que son reales— sino la mejor prueba de que la amnistía sobra.

describe('el Entrenador ya dice lo que el puntaje calla', () => {
  const r = rondas({ obligaciones: 16, cumplidas: 0, noIniciada: 9, bajoPausa: 7, pausaSinClasificar: 7 })
  const medido = fuentesDeEmpleado(r, [])
  const res = calcularCumplimiento(mesPerfecto().map(jornadaCumplimientoDesdeFila), medido.fuentes)

  it('el tablero le da 10', () => {
    expect(res.puntaje).toBe(10)
  })

  it('y el Entrenador, sobre los MISMOS datos, le enseña que no hizo las rondas', () => {
    const ens = ensenanzasDeEmpleado('2026-08', res, { rondas: medido.rondas })
    expect(ens.some(e => e.clave === 'rondas')).toBe(true)
  })

  it('las nueve incidencias existen: lo que las oculta es el estado, no el dato', () => {
    expect(medido.rondas.medicion.validos).toBe(9)
    expect(medido.rondas.medicion.incidencias).toBe(9)
    expect(medido.rondas.enValidacion).toBe(true)
  })
})
