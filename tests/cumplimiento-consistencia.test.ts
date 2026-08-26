import { describe, expect, it } from 'vitest'
import {
  PESOS, VARIANTES_PESOS, calcularCumplimiento, normalizacion,
} from '@/lib/cumplimiento'
import type { ClaveDimension } from '@/lib/cumplimiento'
import { desempenoPorEmpleado, jornadaCumplimientoDesdeFila } from '@/lib/desempeno-datos'
import { fuentesDeEmpleado } from '@/lib/cumplimiento-fuentes'
import type { EvidenciaCumplimiento, RondasEmpleado } from '@/lib/cumplimiento-fuentes'
import { ensenanzasDeEmpleado } from '@/lib/entrenador-datos'
import { puedeAbrirDesempeno, puedeVerDesempeno } from '@/lib/desempeno-visibilidad'
import { objetivoEnAlcance } from '@/lib/bandeja-planillas'
import type { FilaBandejaMensual } from '@/lib/bandeja-planillas'

// Consistencia y visibilidad. Lo que se prueba acá no es una fórmula: es que
// las tres pantallas digan el mismo número, que el entrenador no toque nada, y
// que nadie vea lo que no le corresponde.

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

/** Un mes real: 20 jornadas, 3 tarde, 2 sin registro propio. */
const MES: FilaBandejaMensual[] = [
  ...Array.from({ length: 15 }, (_, i) => fila({ turnoId: `ok${i}`, fecha: `2026-08-${String(i + 1).padStart(2, '0')}` })),
  ...Array.from({ length: 3 }, (_, i) => fila({ turnoId: `tarde${i}`, entrada: '07:12', fecha: `2026-08-2${i}` })),
  ...Array.from({ length: 2 }, (_, i) => fila({
    turnoId: `sr${i}`, tieneFichaje: false, entradaPropia: false, salidaPropia: false,
    origenCobertura: 'confirmacion_supervisor', fecha: `2026-08-2${i + 5}`,
  })),
]

const EVIDENCIAS: EvidenciaCumplimiento[] = [
  ...Array.from({ length: 8 }, () => ({
    analisis_tipo: 'uniforme', clasificacion_efectiva: 'SIN_OBSERVACIONES', guardia_id: 'e1',
  })),
  { analisis_tipo: 'uniforme', clasificacion_efectiva: 'REVISAR', revision_estado: 'CORRECTO', guardia_id: 'e1' },
  ...Array.from({ length: 6 }, () => ({
    analisis_tipo: 'libro_guardia', clasificacion_efectiva: 'SIN_OBSERVACIONES', guardia_id: 'e1',
  })),
]

const RONDAS = rondas({ obligaciones: 24, cumplidas: 18, noIniciada: 6 })

// ── 25. El mismo número en las tres pantallas ───────────────────────────────

describe('25. tabla, ficha y panel muestran el mismo X/10', () => {
  const medido = fuentesDeEmpleado(RONDAS, EVIDENCIAS)

  it('la ficha y la lista calculan lo mismo', () => {
    const ficha = calcularCumplimiento(MES.map(jornadaCumplimientoDesdeFila), medido.fuentes)
    const lista = desempenoPorEmpleado(MES, new Map([['e1', medido.fuentes]]))
    expect(lista[0].cumplimiento.puntaje).toBe(ficha.puntaje)
    expect(lista[0].cumplimiento.estado).toBe(ficha.estado)
  })

  it('y la tabla usa el mismo objeto, no el núcleo suelto', () => {
    const lista = desempenoPorEmpleado(MES, new Map([['e1', medido.fuentes]]))
    // `resultado` es sólo Asistencia + Procedimiento. Que sea distinto es
    // correcto; lo que no puede pasar es que una pantalla lo muestre como si
    // fuera el puntaje.
    expect(lista[0].resultado).toBe(lista[0].cumplimiento.base)
  })
})

// ── 26. La enseñanza no toca el puntaje ─────────────────────────────────────

describe('26-29. el entrenador no modifica ningún dato', () => {
  const medido = fuentesDeEmpleado(RONDAS, EVIDENCIAS)
  const jornadas = MES.map(jornadaCumplimientoDesdeFila)

  it('26. generar enseñanzas no cambia el X/10', () => {
    const antes = calcularCumplimiento(jornadas, medido.fuentes)
    const ensenanzas = ensenanzasDeEmpleado('2026-08', antes, {
      rondas: medido.rondas, uniforme: medido.uniforme, libro: medido.libro, calidad: medido.calidad,
    })
    expect(ensenanzas.length).toBeGreaterThan(0)
    const despues = calcularCumplimiento(jornadas, medido.fuentes)
    expect(despues.puntaje).toBe(antes.puntaje)
    expect(despues.dimensiones).toEqual(antes.dimensiones)
  })

  it('27-28. no toca horas, ni liquidación, ni fichajes', () => {
    const copia = JSON.parse(JSON.stringify(MES))
    const r = calcularCumplimiento(jornadas, medido.fuentes)
    ensenanzasDeEmpleado('2026-08', r, {
      rondas: medido.rondas, uniforme: medido.uniforme, libro: medido.libro, calidad: medido.calidad,
    })
    // Las filas de la bandeja —donde viven horas, entrada, salida— siguen
    // idénticas: este módulo es puro y no muta su entrada.
    expect(MES).toEqual(copia)
  })

  it('29. tampoco cambia los datos históricos de rondas ni de evidencias', () => {
    const copiaRondas = JSON.parse(JSON.stringify(RONDAS))
    const copiaEv = JSON.parse(JSON.stringify(EVIDENCIAS))
    const m = fuentesDeEmpleado(RONDAS, EVIDENCIAS)
    ensenanzasDeEmpleado('2026-08', calcularCumplimiento(jornadas, m.fuentes), {
      rondas: m.rondas, uniforme: m.uniforme, libro: m.libro, calidad: m.calidad,
    })
    expect(RONDAS).toEqual(copiaRondas)
    expect(EVIDENCIAS).toEqual(copiaEv)
  })
})

// ── 21-24. Visibilidad ──────────────────────────────────────────────────────

describe('21-24. quién ve qué', () => {
  it('21. el vigilador no ve el puntaje, ni siquiera el propio', () => {
    expect(puedeVerDesempeno({ rol: 'guardia', esPropio: true, visibleParaVigilador: false })).toBe(false)
    expect(puedeAbrirDesempeno('guardia', false)).toBe(false)
  })

  it('21bis. y no se enciende solo: el default es no mostrar', () => {
    expect(puedeVerDesempeno({ rol: 'guardia', esPropio: true, visibleParaVigilador: undefined as any })).toBe(false)
    expect(puedeVerDesempeno({ rol: 'vigilador', esPropio: false, visibleParaVigilador: true })).toBe(false)
  })

  it('22. el supervisor ve, y sólo su zona', () => {
    expect(puedeVerDesempeno({ rol: 'supervisor', esPropio: false, visibleParaVigilador: false })).toBe(true)
    const susZonas = new Set(['z1'])
    expect(objetivoEnAlcance('z1', false, susZonas)).toBe(true)
    expect(objetivoEnAlcance('z2', false, susZonas)).toBe(false)
  })

  it('23. el admin ve a todos', () => {
    expect(puedeVerDesempeno({ rol: 'admin', esPropio: false, visibleParaVigilador: false })).toBe(true)
    expect(objetivoEnAlcance('z9', true, new Set())).toBe(true)
    expect(objetivoEnAlcance(null, true, new Set())).toBe(true)
  })

  it('24. el supervisor sin zonas no ve nada', () => {
    expect(objetivoEnAlcance('z1', false, new Set())).toBe(false)
    expect(objetivoEnAlcance('z1', false, undefined)).toBe(false)
    expect(objetivoEnAlcance(null, false, new Set())).toBe(false)
  })

  it('ningún texto de dimensión que llegue al vigilador lleva la nota', () => {
    // El vigilador no consume estas pantallas, pero la garantía que importa es
    // que lo que SÍ le llega —las enseñanzas— no contiene el número.
    const medido = fuentesDeEmpleado(RONDAS, EVIDENCIAS)
    const r = calcularCumplimiento(MES.map(jornadaCumplimientoDesdeFila), medido.fuentes)
    const textos = ensenanzasDeEmpleado('2026-08', r, {
      rondas: medido.rondas, uniforme: medido.uniforme, libro: medido.libro, calidad: medido.calidad,
    }).map(e => e.texto).join(' ')
    expect(textos).not.toContain(String(r.puntaje))
    expect(textos).not.toMatch(/\/\s*10/)
  })
})

// ── Las dimensiones nuevas no entran al número ──────────────────────────────

describe('encender una dimensión es una decisión, no un efecto colateral', () => {
  const jornadas = MES.map(jornadaCumplimientoDesdeFila)

  it('Rondas, Uniforme, Libro y Calidad tienen peso 0 hoy', () => {
    for (const c of ['rondas', 'uniforme', 'libro_guardia', 'evidencias'] as ClaveDimension[]) {
      expect(PESOS[c]).toBe(0)
    }
  })

  it('el puntaje es el mismo con y sin las cuatro fuentes', () => {
    const sin = calcularCumplimiento(jornadas)
    const con = calcularCumplimiento(jornadas, fuentesDeEmpleado(RONDAS, EVIDENCIAS).fuentes)
    expect(con.puntaje).toBe(sin.puntaje)
    expect(con.estado).toBe(sin.estado)
  })

  it('tienen nota y se muestran, pero en validación', () => {
    const r = calcularCumplimiento(jornadas, fuentesDeEmpleado(RONDAS, EVIDENCIAS).fuentes)
    const rondasDim = r.dimensiones.find(d => d.clave === 'rondas')
    expect(rondasDim?.nota).toBe(7.5)
    expect(rondasDim?.estado).toBe('en_validacion')
  })

  it('una dimensión en validación NO puntúa aunque tenga peso', () => {
    // La validación es sobre el universo, no sobre la importancia: si no se
    // sabe qué se excluyó, ningún peso arregla el número.
    const conAmbiguedad = fuentesDeEmpleado(
      rondas({ obligaciones: 24, cumplidas: 18, noIniciada: 4, bajoPausa: 2, pausaSinClasificar: 2 }),
      EVIDENCIAS,
    )
    const pesos = { ...PESOS, rondas: 30 }
    const r = calcularCumplimiento(jornadas, conAmbiguedad.fuentes, pesos)
    const dim = r.dimensiones.find(d => d.clave === 'rondas')
    expect(dim?.nota).not.toBeNull()
    expect(dim?.estado).toBe('en_validacion')
    expect(r.puntaje).toBe(calcularCumplimiento(jornadas).puntaje)
  })

  it('sin ambigüedad y con peso, sí entra', () => {
    const limpio = fuentesDeEmpleado(rondas({ obligaciones: 24, cumplidas: 18, noIniciada: 6 }), EVIDENCIAS)
    const pesos = { ...PESOS, rondas: 30 }
    const r = calcularCumplimiento(jornadas, limpio.fuentes, pesos)
    expect(r.dimensiones.find(d => d.clave === 'rondas')?.estado).toBe('puntuable')
    expect(r.puntaje).not.toBe(calcularCumplimiento(jornadas).puntaje)
  })

  it('"no aplica" nunca entra como cero', () => {
    const sinRondas = fuentesDeEmpleado(null, EVIDENCIAS)
    const pesos = { ...PESOS, rondas: 30 }
    const r = calcularCumplimiento(jornadas, sinRondas.fuentes, pesos)
    expect(r.dimensiones.find(d => d.clave === 'rondas')?.estado).toBe('no_aplica')
    expect(r.puntaje).toBe(calcularCumplimiento(jornadas).puntaje)
  })
})

describe('la simulación de pesos usa la misma función que producción', () => {
  it('hay al menos tres variantes declaradas', () => {
    expect(Object.keys(VARIANTES_PESOS).length).toBeGreaterThanOrEqual(3)
    expect(VARIANTES_PESOS.actual).toEqual(PESOS)
  })

  it('la normalización dice cómo se reparte el 100 %', () => {
    const n = normalizacion(VARIANTES_PESOS.actual, ['asistencia', 'puntualidad', 'procedimiento'])
    expect(n.asistencia).toBeCloseTo(16.7, 1)
    expect(n.puntualidad).toBeCloseTo(33.3, 1)
    expect(n.procedimiento).toBe(50)
  })

  it('con Rondas adentro, Procedimiento deja de dominar', () => {
    const n = normalizacion(VARIANTES_PESOS.todo_lo_medible,
      ['asistencia', 'puntualidad', 'procedimiento', 'rondas', 'uniforme', 'libro_guardia'])
    expect(n.procedimiento).toBeLessThan(50)
    expect(Object.values(n).reduce((s, v) => s + v, 0)).toBeCloseTo(100, 0)
  })
})

describe('un "no hay nada que explicar" explícito no cae al texto genérico', () => {
  const jornadas = MES.map(jornadaCumplimientoDesdeFila)

  it('sin rondas, la dimensión no muestra el motivo de otras personas', () => {
    // Con `extra.faltante ?? FALTANTE[clave]` un null explícito caía igual al
    // texto del módulo, y le decía a alguien con CERO rondas que "quedan
    // ventanas pausadas sin causa registrada".
    const r = calcularCumplimiento(jornadas, fuentesDeEmpleado(null, EVIDENCIAS).fuentes)
    const d = r.dimensiones.find(x => x.clave === 'rondas')
    expect(d?.estado).toBe('no_aplica')
    expect(d?.faltante).toBeUndefined()
    expect(d?.detalle).toBe('Sin rondas asignadas en el período')
  })

  it('con ambigüedad real sí se explica', () => {
    const conPausas = fuentesDeEmpleado(
      rondas({ obligaciones: 24, cumplidas: 18, noIniciada: 4, bajoPausa: 2, pausaSinClasificar: 2 }),
      EVIDENCIAS,
    )
    const d = calcularCumplimiento(jornadas, conPausas.fuentes).dimensiones
      .find(x => x.clave === 'rondas')
    expect(d?.faltante).toContain('sin causa registrada')
  })

  it('una dimensión sin aporte sigue usando el texto del módulo', () => {
    const d = calcularCumplimiento(jornadas).dimensiones.find(x => x.clave === 'rondas')
    expect(d?.faltante).toContain('pausadas sin causa registrada')
  })
})
