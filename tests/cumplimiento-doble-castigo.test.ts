import { describe, expect, it } from 'vitest'
import { VARIANTES_PESOS, calcularCumplimiento } from '@/lib/cumplimiento'
import { fuentesDeEmpleado } from '@/lib/cumplimiento-fuentes'
import type { EvidenciaCumplimiento, RondasEmpleado } from '@/lib/cumplimiento-fuentes'
import { jornadaCumplimientoDesdeFila } from '@/lib/desempeno-datos'
import { ensenanzasDeEmpleado } from '@/lib/entrenador-datos'
import type { FilaBandejaMensual } from '@/lib/bandeja-planillas'

// Auditoría de doble castigo: un hecho, una incidencia.
//
// Cada test de acá corresponde a una regla del pliego. No son casos bonitos:
// son las cinco formas concretas en que este indicador podría cobrarle dos
// veces lo mismo a una persona.

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

const calc = (filas: FilaBandejaMensual[], r: RondasEmpleado | null, ev: EvidenciaCumplimiento[]) => {
  const medido = fuentesDeEmpleado(r, ev)
  return {
    res: calcularCumplimiento(filas.map(jornadaCumplimientoDesdeFila), medido.fuentes,
      VARIANTES_PESOS.modelo_e_sin_lastre),
    medido,
  }
}

// ── 1 · No fichó, pero el supervisor confirma que trabajó ───────────────────

describe('1 · trabajó sin fichar: Procedimiento sí, Asistencia no', () => {
  const mes = [
    ...Array.from({ length: 12 }, (_, i) => fila({ turnoId: `ok${i}` })),
    ...Array.from({ length: 8 }, (_, i) => fila({
      turnoId: `sr${i}`, entradaPropia: false, salidaPropia: false,
      entrada: null, salida: null, origenCobertura: 'confirmacion_supervisor',
    })),
  ]
  const { res } = calc(mes, null, [])

  it('Asistencia intacta', () => {
    expect(res.dimensiones.find(d => d.clave === 'asistencia')?.nota).toBe(10)
    expect(res.base.ausencias).toBe(0)
  })

  it('la incidencia vive sólo en Procedimiento', () => {
    expect(res.dimensiones.find(d => d.clave === 'procedimiento')?.nota).toBeLessThan(10)
    expect(res.base.incidencias.sin_registro_propio).toBe(8)
  })

  it('Puntualidad NO lo castiga: sin fichaje propio no se sabe a qué hora llegó', () => {
    // Ocho jornadas sin ingreso propio salen del universo de Puntualidad. Si
    // entraran como impuntuales sería el mismo hecho cobrado dos veces.
    expect(res.puntualidad.evaluadas).toBe(12)
    expect(res.puntualidad.sinDato).toBe(8)
    expect(res.dimensiones.find(d => d.clave === 'puntualidad')?.nota).toBe(10)
  })
})

// ── 2 · No hubo foto porque nunca fichó ────────────────────────────────────

describe('2 · sin fichaje no hay foto: no se cobra en Uniforme, Libro ni Calidad', () => {
  const mes = Array.from({ length: 20 }, (_, i) => fila({
    turnoId: `sr${i}`, entradaPropia: false, salidaPropia: false,
    entrada: null, salida: null, origenCobertura: 'confirmacion_supervisor',
  }))
  const { res, medido } = calc(mes, null, [])

  it('las tres dimensiones de evidencia quedan en No aplica', () => {
    for (const clave of ['uniforme', 'libro_guardia', 'evidencias'] as const) {
      expect(res.dimensiones.find(d => d.clave === clave)?.estado).toBe('no_aplica')
      expect(res.dimensiones.find(d => d.clave === clave)?.nota).toBeNull()
    }
  })

  it('ninguna de las tres aporta incidencias', () => {
    expect(medido.uniforme.medicion.incidencias).toBe(0)
    expect(medido.libro.medicion.incidencias).toBe(0)
    expect(medido.calidad.medicion.incidencias).toBe(0)
  })

  it('el Entrenador tampoco le habla de fotos que no existen', () => {
    const claves = ensenanzasDeEmpleado('2026-08', res, medido).map(e => e.clave)
    expect(claves).not.toContain('uniforme')
    expect(claves).not.toContain('libro_guardia')
    expect(claves).not.toContain('calidad_evidencias')
    expect(claves).toContain('procedimiento_registro')
  })
})

// ── 3 · Foto borrosa ────────────────────────────────────────────────────────

describe('3 · foto ilegible: Calidad sí, Uniforme no', () => {
  const lista: EvidenciaCumplimiento[] = [
    ...Array.from({ length: 6 }, () => ({ analisis_tipo: 'uniforme', clasificacion_efectiva: 'SIN_OBSERVACIONES' })),
    ...Array.from({ length: 5 }, () => ({ analisis_tipo: 'uniforme', clasificacion_efectiva: 'EVIDENCIA_INSUFICIENTE' })),
  ]
  const { medido } = calc(Array.from({ length: 20 }, (_, i) => fila({ turnoId: `p${i}` })), null, lista)

  it('el hecho se cuenta UNA vez, y en Calidad', () => {
    expect(medido.calidad.medicion.incidencias).toBe(5)
    expect(medido.uniforme.medicion.incidencias).toBe(0)
  })

  it('Uniforme no la cuenta ni a favor ni en contra', () => {
    expect(medido.uniforme.medicion.validos).toBe(6)
    expect(medido.uniforme.nota).toBe(10)
  })

  it('salvo que una persona SÍ haya podido evaluarlo y lo confirme incorrecto', () => {
    const conConfirmada = [...lista, { analisis_tipo: 'uniforme', clasificacion_efectiva: 'REVISAR', revision_estado: 'CORRECTO' }]
    const m = fuentesDeEmpleado(null, conConfirmada)
    expect(m.uniforme.confirmadas).toBe(1)
    expect(m.uniforme.medicion.incidencias).toBe(1)
    // Y la ilegible sigue contando una sola vez, en Calidad.
    expect(m.calidad.medicion.incidencias).toBe(5)
  })
})

// ── 4 · Entrada tarde ──────────────────────────────────────────────────────

describe('4 · llegar tarde es Puntualidad, no Procedimiento', () => {
  const mes = [
    ...Array.from({ length: 14 }, (_, i) => fila({ turnoId: `ok${i}` })),
    ...Array.from({ length: 6 }, (_, i) => fila({ turnoId: `tarde${i}`, entrada: '07:25' })),
  ]
  const { res } = calc(mes, null, [])

  it('Puntualidad baja', () => {
    expect(res.puntualidad.impuntuales).toBe(6)
    expect(res.dimensiones.find(d => d.clave === 'puntualidad')?.nota).toBeLessThan(10)
  })

  it('Procedimiento queda intacto: registró entrada y salida', () => {
    expect(res.dimensiones.find(d => d.clave === 'procedimiento')?.nota).toBe(10)
    expect(res.base.incidencias.sin_registro_propio).toBe(0)
    expect(res.base.incidencias.entrada_sin_salida).toBe(0)
  })
})

// ── 5 · Ronda no realizada ─────────────────────────────────────────────────

describe('5 · ronda no realizada es Rondas, no Procedimiento', () => {
  const mes = Array.from({ length: 20 }, (_, i) => fila({ turnoId: `p${i}` }))
  const { res } = calc(mes, rondas({ obligaciones: 24, cumplidas: 12, noIniciada: 12 }), [])

  it('Rondas baja a la mitad', () => {
    expect(res.dimensiones.find(d => d.clave === 'rondas')?.nota).toBe(5)
  })

  it('Procedimiento no se entera: son hechos independientes', () => {
    expect(res.dimensiones.find(d => d.clave === 'procedimiento')?.nota).toBe(10)
  })
})

// ── Una jornada, una incidencia primaria ───────────────────────────────────

describe('una jornada no puede aportar dos incidencias de Procedimiento', () => {
  it('sin registro propio Y sin salida cuenta una sola vez', () => {
    const mes = [
      ...Array.from({ length: 15 }, (_, i) => fila({ turnoId: `ok${i}` })),
      ...Array.from({ length: 5 }, (_, i) => fila({
        // Ni entrada ni salida propias: es UN hecho, no dos.
        turnoId: `nada${i}`, entradaPropia: false, salidaPropia: false,
        entrada: null, salida: null, salidaAutomatica: true,
        origenCobertura: 'confirmacion_supervisor',
      })),
    ]
    const { res } = calc(mes, null, [])
    const total = res.base.incidencias.sin_registro_propio + res.base.incidencias.entrada_sin_salida
    expect(total).toBe(5)
    expect(res.base.incidencias.entrada_sin_salida).toBe(0)
  })

  it('el cierre automático no es una incidencia aparte de la salida que falta', () => {
    const mes = [
      ...Array.from({ length: 18 }, (_, i) => fila({ turnoId: `ok${i}` })),
      ...Array.from({ length: 2 }, (_, i) => fila({
        turnoId: `auto${i}`, salidaPropia: false, salida: null, salidaAutomatica: true,
      })),
    ]
    const { res } = calc(mes, null, [])
    expect(res.base.incidencias.entrada_sin_salida).toBe(2)
    expect(res.base.incidencias.sin_registro_propio).toBe(0)
  })
})
