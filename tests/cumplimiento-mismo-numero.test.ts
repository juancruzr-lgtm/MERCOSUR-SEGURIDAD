import { describe, expect, it } from 'vitest'
import { PESOS, calcularCumplimiento, resumenCorto } from '@/lib/cumplimiento'
import { fuentesDeEmpleado } from '@/lib/cumplimiento-fuentes'
import type { EvidenciaCumplimiento, RondasEmpleado } from '@/lib/cumplimiento-fuentes'
import {
  desempenoPorEmpleado, jornadaCumplimientoDesdeFila, resumirDesempeno,
} from '@/lib/desempeno-datos'
import type { FilaBandejaMensual } from '@/lib/bandeja-planillas'

// El mismo empleado tiene que mostrar EL MISMO X/10 en todas partes.
//
// Ya pasó una vez: la lista leía `resultado` —el núcleo, sin Puntualidad— y la
// tabla leía `cumplimiento`. Durante un mes dos pantallas dijeron números
// distintos de la misma persona y nadie lo notó, porque cada una era coherente
// consigo misma.
//
// Estos tests recorren TODAS las superficies que se pueden comprobar
// programáticamente. La verificación visual es aparte y no las reemplaza.

const fila = (over: Partial<FilaBandejaMensual> = {}): FilaBandejaMensual => ({
  turnoId: 't1', empleadoId: 'e1', registroId: 'r1', vigilador: 'PEREZ, JUAN',
  fecha: '2026-08-10',
  objetivoId: 'o1', objetivo: 'PLANTA',
  puestoId: 'p1', puesto: 'Principal',
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

/** Un mes con algo de todo, para que el número no sea trivialmente 10. */
const MES: FilaBandejaMensual[] = [
  ...Array.from({ length: 13 }, (_, i) => fila({ turnoId: `ok${i}`, fecha: `2026-08-${String(i + 1).padStart(2, '0')}` })),
  ...Array.from({ length: 4 }, (_, i) => fila({ turnoId: `tarde${i}`, entrada: '07:18', fecha: `2026-08-2${i}` })),
  ...Array.from({ length: 3 }, (_, i) => fila({
    turnoId: `sr${i}`, entradaPropia: false, salidaPropia: false, entrada: null, salida: null,
    origenCobertura: 'confirmacion_supervisor', fecha: `2026-08-2${i + 5}`,
  })),
]

const RONDAS = rondas({ obligaciones: 26, cumplidas: 19, noIniciada: 7 })

const EVIDENCIAS: EvidenciaCumplimiento[] = [
  ...Array.from({ length: 9 }, () => ({
    analisis_tipo: 'uniforme', clasificacion_efectiva: 'SIN_OBSERVACIONES', guardia_id: 'e1',
  })),
  { analisis_tipo: 'uniforme', clasificacion_efectiva: 'REVISAR', revision_estado: 'CORRECTO', guardia_id: 'e1' },
  ...Array.from({ length: 7 }, () => ({
    analisis_tipo: 'libro_guardia', clasificacion_efectiva: 'SIN_OBSERVACIONES', guardia_id: 'e1',
  })),
]

const medido = fuentesDeEmpleado(RONDAS, EVIDENCIAS)
const fuentesPorEmpleado = new Map([['e1', medido.fuentes]])

describe('el mismo X/10 en todas las superficies', () => {
  /** La ficha del legajo: calcula directo desde las filas del empleado. */
  const ficha = calcularCumplimiento(MES.map(jornadaCumplimientoDesdeFila), medido.fuentes)

  /** La lista y la tabla: pasan por desempenoPorEmpleado. */
  const lista = desempenoPorEmpleado(MES, fuentesPorEmpleado)

  it('la ficha y la lista dan el mismo puntaje', () => {
    expect(lista).toHaveLength(1)
    expect(lista[0].cumplimiento.puntaje).toBe(ficha.puntaje)
  })

  it('y la misma categoría', () => {
    expect(lista[0].cumplimiento.estado).toBe(ficha.estado)
  })

  it('y el mismo texto corto, que es lo que ve la tabla de Guardias', () => {
    expect(resumenCorto(lista[0].cumplimiento)).toBe(resumenCorto(ficha))
  })

  it('y las mismas siete dimensiones con las mismas notas', () => {
    expect(lista[0].cumplimiento.dimensiones).toEqual(ficha.dimensiones)
  })

  it('el resumen de la lista cuenta el estado del CUMPLIMIENTO, no el del núcleo', () => {
    // Éste es el bug exacto que ya ocurrió: resumirDesempeno contaba
    // `resultado.estado`, que no incluye Puntualidad ni nada posterior.
    const resumen = resumirDesempeno(lista)
    expect(resumen.porEstado[ficha.estado]).toBe(1)
    expect(resumen.total).toBe(1)
  })

  it('`resultado` sigue siendo el núcleo y NO el puntaje', () => {
    // Se conserva para lo que ya lo consume, pero no puede confundirse con el
    // número: son la misma cuenta mirada con distinto detalle.
    expect(lista[0].resultado).toBe(lista[0].cumplimiento.base)
    expect(lista[0].resultado.puntaje).not.toBe(ficha.puntaje)
  })
})

describe('las fuentes externas no pueden dar números distintos según quién las arme', () => {
  it('armarlas dos veces da exactamente lo mismo', () => {
    const a = fuentesDeEmpleado(RONDAS, EVIDENCIAS)
    const b = fuentesDeEmpleado(RONDAS, EVIDENCIAS)
    expect(a.fuentes).toEqual(b.fuentes)
  })

  it('sin fuentes el puntaje cambia, y por eso todas las pantallas tienen que pasarlas', () => {
    // Si una pantalla se olvidara de cargar rondas o evidencias mostraría otro
    // número. No es hipotético: es la forma que tomaría la próxima regresión.
    const conFuentes = calcularCumplimiento(MES.map(jornadaCumplimientoDesdeFila), medido.fuentes)
    const sinFuentes = calcularCumplimiento(MES.map(jornadaCumplimientoDesdeFila))
    expect(conFuentes.puntaje).not.toBe(sinFuentes.puntaje)
  })

  it('la lista sin el mapa de fuentes NO coincide con la ficha', () => {
    const listaSinFuentes = desempenoPorEmpleado(MES)
    const ficha = calcularCumplimiento(MES.map(jornadaCumplimientoDesdeFila), medido.fuentes)
    expect(listaSinFuentes[0].cumplimiento.puntaje).not.toBe(ficha.puntaje)
  })
})

describe('el peso total del denominador se arma igual en todas', () => {
  it('sólo suman las dimensiones puntuables', () => {
    const r = calcularCumplimiento(MES.map(jornadaCumplimientoDesdeFila), medido.fuentes)
    const puntuables = r.dimensiones.filter(d => d.estado === 'puntuable')
    const total = puntuables.reduce((s, d) => s + d.peso, 0)
    const suma = puntuables.reduce((s, d) => s + (d.nota as number) * d.peso, 0)
    expect(r.puntaje).toBe(Math.round((suma / total) * 100) / 100)
  })

  it('y el total es la suma de los pesos declarados de esas dimensiones', () => {
    const r = calcularCumplimiento(MES.map(jornadaCumplimientoDesdeFila), medido.fuentes)
    const puntuables = r.dimensiones.filter(d => d.estado === 'puntuable')
    const esperado = puntuables.reduce((s, d) => s + PESOS[d.clave], 0)
    expect(puntuables.reduce((s, d) => s + d.peso, 0)).toBe(esperado)
  })
})
