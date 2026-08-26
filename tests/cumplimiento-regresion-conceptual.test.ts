import { describe, expect, it } from 'vitest'
import { VARIANTES_PESOS, calcularCumplimiento } from '@/lib/cumplimiento'
import type { ClaveDimension } from '@/lib/cumplimiento'
import { fuentesDeEmpleado } from '@/lib/cumplimiento-fuentes'
import type { EvidenciaCumplimiento, RondasEmpleado } from '@/lib/cumplimiento-fuentes'
import { jornadaCumplimientoDesdeFila } from '@/lib/desempeno-datos'
import type { FilaBandejaMensual } from '@/lib/bandeja-planillas'
import {
  COOLDOWN_GLOBAL_DIAS, ensenanzaPrioritaria, puedeRecibirAhora,
} from '@/lib/entrenador-operativo'
import { ensenanzasDeEmpleado } from '@/lib/entrenador-datos'

// Los doce casos conceptuales que el modelo tiene que resolver bien. No prueban
// una fórmula: prueban que el número diga sobre una persona lo que MERCOSUR
// diría sobre ella.
//
// Los fixtures son sintéticos a propósito. La decisión de pesos se toma con
// producción; estos tests fijan el comportamiento para que no se rompa después.

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

const ev = (tipo: string, clasif: string, revision?: string): EvidenciaCumplimiento =>
  ({ analisis_tipo: tipo, clasificacion_efectiva: clasif, revision_estado: revision ?? null })

const nOk = (n: number, tipo: string) =>
  Array.from({ length: n }, () => ev(tipo, 'SIN_OBSERVACIONES'))

/** Un mes de jornadas perfectas. */
const mesPerfecto = (n = 20) =>
  Array.from({ length: n }, (_, i) => fila({ turnoId: `p${i}` }))

/** Calcula con un modelo dado y devuelve el resultado completo. */
function conModelo(
  filas: FilaBandejaMensual[],
  r: RondasEmpleado | null,
  evidencias: EvidenciaCumplimiento[],
  modelo: keyof typeof VARIANTES_PESOS = 'modelo_a_equilibrado',
) {
  const medido = fuentesDeEmpleado(r, evidencias)
  return calcularCumplimiento(
    filas.map(jornadaCumplimientoDesdeFila), medido.fuentes, VARIANTES_PESOS[modelo],
  )
}

const dim = (res: ReturnType<typeof conModelo>, clave: ClaveDimension) =>
  res.dimensiones.find(d => d.clave === clave)!

// ── CASO 1 ──────────────────────────────────────────────────────────────────

describe('CASO 1 · trabajó siempre, el supervisor tuvo que confirmar varios días', () => {
  const mes = [
    ...Array.from({ length: 14 }, (_, i) => fila({ turnoId: `ok${i}` })),
    ...Array.from({ length: 6 }, (_, i) => fila({
      // El registro existe —lo creó el supervisor—; lo que falta es que sea
      // PROPIO del vigilador. Con tieneFichaje en false sería un hueco sin
      // evidencia, que es otra cosa distinta.
      turnoId: `sr${i}`, tieneFichaje: true, entradaPropia: false, salidaPropia: false,
      entrada: null, salida: null, origenCobertura: 'confirmacion_supervisor',
    })),
  ]
  const r = conModelo(mes, null, [])

  it('Asistencia queda intacta: presencia confirmada no es ausencia', () => {
    expect(dim(r, 'asistencia').nota).toBe(10)
  })

  it('el problema aparece en Procedimiento, y sólo ahí', () => {
    expect(dim(r, 'procedimiento').nota).toBeLessThan(10)
  })

  it('no se lo cuenta como ausente en ningún lado', () => {
    expect(r.base.ausencias).toBe(0)
    expect(r.motivos.some(m => m.tipo === 'ausencia')).toBe(false)
  })
})

// ── CASO 2 ──────────────────────────────────────────────────────────────────

describe('CASO 2 · ficha perfecto, llega a horario, no hace las rondas', () => {
  const r = conModelo(mesPerfecto(), rondas({ obligaciones: 20, cumplidas: 6, noIniciada: 14 }), nOk(8, 'uniforme'))

  it('Asistencia, Puntualidad y Procedimiento en 10', () => {
    expect(dim(r, 'asistencia').nota).toBe(10)
    expect(dim(r, 'puntualidad').nota).toBe(10)
    expect(dim(r, 'procedimiento').nota).toBe(10)
  })

  it('Rondas 3/10 y el total baja de verdad', () => {
    expect(dim(r, 'rondas').nota).toBe(3)
    // Con el modelo A, Rondas pesa 25 sobre un total de 100 aplicables.
    expect(r.puntaje).toBeLessThan(8.5)
  })

  it('cuanto más pesan las rondas, más baja', () => {
    const a = conModelo(mesPerfecto(), rondas({ obligaciones: 20, cumplidas: 6, noIniciada: 14 }), nOk(8, 'uniforme'), 'modelo_a_equilibrado')
    const d = conModelo(mesPerfecto(), rondas({ obligaciones: 20, cumplidas: 6, noIniciada: 14 }), nOk(8, 'uniforme'), 'modelo_d_rondas')
    expect(d.puntaje as number).toBeLessThan(a.puntaje as number)
  })
})

// ── CASO 3 ──────────────────────────────────────────────────────────────────

describe('CASO 3 · hace todas las rondas, buen servicio, una salida olvidada', () => {
  const mes = [
    ...Array.from({ length: 19 }, (_, i) => fila({ turnoId: `ok${i}` })),
    fila({ turnoId: 'sinsalida', salidaPropia: false, salida: null, salidaAutomatica: true }),
  ]
  const r = conModelo(mes, rondas({ obligaciones: 30, cumplidas: 30 }), nOk(8, 'uniforme'))

  it('Procedimiento baja, pero poco', () => {
    expect(dim(r, 'procedimiento').nota).toBeLessThan(10)
    expect(dim(r, 'procedimiento').nota as number).toBeGreaterThan(9)
  })

  it('NO queda destruido: sigue siendo excelente', () => {
    expect(r.puntaje as number).toBeGreaterThan(9.5)
    expect(r.estado).toBe('excelente')
  })

  it('con los pesos viejos ese olvido pesaba mucho más', () => {
    // Procedimiento valía el 50 % del número. El mismo hecho, otra consecuencia.
    const viejo = conModelo(mes, rondas({ obligaciones: 30, cumplidas: 30 }), nOk(8, 'uniforme'), 'actual')
    const nuevo = conModelo(mes, rondas({ obligaciones: 30, cumplidas: 30 }), nOk(8, 'uniforme'), 'modelo_a_equilibrado')
    expect(nuevo.puntaje as number).toBeGreaterThan(viejo.puntaje as number)
  })
})

// ── CASO 4 ──────────────────────────────────────────────────────────────────

describe('CASO 4 · sin rondas asignadas', () => {
  const r = conModelo(mesPerfecto(), null, nOk(8, 'uniforme'))

  it('Rondas es No aplica, ni 0 ni 10', () => {
    expect(dim(r, 'rondas').estado).toBe('no_aplica')
    expect(dim(r, 'rondas').nota).toBeNull()
  })

  it('no entra al denominador: ni premio ni castigo', () => {
    const conRondasPerfectas = conModelo(mesPerfecto(), rondas({ obligaciones: 20, cumplidas: 20 }), nOk(8, 'uniforme'))
    // Los dos tienen todo lo demás igual y en 10, así que el puntaje coincide:
    // no tener rondas no lo baja, y tenerlas perfectas no lo sube.
    expect(r.puntaje).toBe(conRondasPerfectas.puntaje)
  })
})

// ── CASO 5 y 7 ──────────────────────────────────────────────────────────────

describe('CASO 5 y 7 · observaciones humanas confirmadas de uniforme y libro', () => {
  const uniforme = [
    ...nOk(7, 'uniforme'),
    ...Array.from({ length: 4 }, () => ev('uniforme', 'REVISAR', 'CORRECTO')),
  ]
  const libro = [
    ...nOk(14, 'libro_guardia'),
    ...Array.from({ length: 3 }, () => ev('libro_guardia', 'REVISAR', 'CORRECTO')),
  ]
  const r = conModelo(mesPerfecto(), null, [...uniforme, ...libro])

  it('uniforme 7 de 11 confirmadas por una persona', () => {
    expect(dim(r, 'uniforme').nota).toBeCloseTo(6.36, 1)
  })

  it('libro 14 de 17', () => {
    expect(dim(r, 'libro_guardia').nota).toBeCloseTo(8.24, 1)
  })

  it('con todo lo demás en 10, eso alcanza para sacarlo de Excelente', () => {
    expect(r.estado).not.toBe('excelente')
  })

  it('con los pesos actuales no cambiaba nada: quedaba Excelente', () => {
    const viejo = conModelo(mesPerfecto(), null, [...uniforme, ...libro], 'actual')
    expect(viejo.puntaje).toBe(10)
    expect(viejo.estado).toBe('excelente')
  })
})

// ── CASO 6 ──────────────────────────────────────────────────────────────────

describe('CASO 6 · sin observaciones evaluables de uniforme', () => {
  it('no se inventa Uniforme 10', () => {
    const r = conModelo(mesPerfecto(), null, [])
    expect(dim(r, 'uniforme').nota).toBeNull()
    expect(dim(r, 'uniforme').estado).toBe('no_aplica')
  })

  it('con muestra chica dice datos insuficientes, no un número', () => {
    const r = conModelo(mesPerfecto(), null, nOk(3, 'uniforme'))
    expect(dim(r, 'uniforme').nota).toBeNull()
    expect(dim(r, 'uniforme').estado).toBe('datos_insuficientes')
  })

  it('ni no_aplica ni datos_insuficientes regalan puntos', () => {
    const sinNada = conModelo(mesPerfecto(), null, [])
    const conPocas = conModelo(mesPerfecto(), null, nOk(3, 'uniforme'))
    const conMuchasOk = conModelo(mesPerfecto(), null, nOk(10, 'uniforme'))
    // Los tres tienen el resto en 10, así que los tres dan 10. Lo que importa
    // es que ninguno recibe un empujón por lo que NO se pudo medir.
    expect(sinNada.puntaje).toBe(10)
    expect(conPocas.puntaje).toBe(10)
    expect(conMuchasOk.puntaje).toBe(10)
  })
})

// ── CASO 8 ──────────────────────────────────────────────────────────────────

describe('CASO 8 · foto ilegible', () => {
  const lista = [...nOk(6, 'uniforme'), ...Array.from({ length: 4 }, () => ev('uniforme', 'EVIDENCIA_INSUFICIENTE'))]
  const medido = fuentesDeEmpleado(null, lista)

  it('NO se convierte en uniforme incorrecto', () => {
    expect(medido.uniforme.confirmadas).toBe(0)
    expect(medido.uniforme.medicion.incidencias).toBe(0)
    expect(medido.uniforme.nota).toBe(10)
  })

  it('Calidad sí lo registra', () => {
    expect(medido.calidad.noEvaluables).toBe(4)
    expect(medido.calidad.medicion.incidencias).toBe(4)
  })

  it('y Calidad no pesa en ningún modelo', () => {
    for (const m of Object.keys(VARIANTES_PESOS)) {
      expect(VARIANTES_PESOS[m].evidencias).toBe(0)
    }
  })
})

// ── CASO 9 y 10 ─────────────────────────────────────────────────────────────

describe('CASO 9 y 10 · pausas con causa', () => {
  it('9 · pausa técnica: sale del denominador, no penaliza', () => {
    const r = conModelo(mesPerfecto(), rondas({
      obligaciones: 30, cumplidas: 18, bajoPausa: 12, pausaNoAtribuible: 12,
      causasPausa: { tecnica_gps: 12 },
    }), [])
    expect(dim(r, 'rondas').nota).toBe(10)
    expect(dim(r, 'rondas').estado).toBe('puntuable')
  })

  it('10 · pausa "no se realiza": la ronda era exigible y cuenta', () => {
    const medido = fuentesDeEmpleado(rondas({
      obligaciones: 30, cumplidas: 18, bajoPausa: 12, pausaAtribuible: 12,
      causasPausa: { no_se_realiza: 12 },
    }), [])
    expect(medido.rondas.medicion.validos).toBe(30)
    expect(medido.rondas.noRealizadas).toBe(12)
    expect(medido.rondas.nota).toBe(6)
  })

  it('la pausa histórica SIN causa sale del denominador y deja la nota en validación', () => {
    const medido = fuentesDeEmpleado(rondas({
      obligaciones: 30, cumplidas: 18, noIniciada: 2, bajoPausa: 10, pausaSinClasificar: 10,
    }), [])
    expect(medido.rondas.medicion.validos).toBe(20)
    expect(medido.rondas.enValidacion).toBe(true)
    // Y en validación NO puntúa, ni siquiera con peso.
    const r = conModelo(mesPerfecto(), rondas({
      obligaciones: 30, cumplidas: 18, noIniciada: 2, bajoPausa: 10, pausaSinClasificar: 10,
    }), [], 'modelo_d_rondas')
    expect(dim(r, 'rondas').estado).toBe('en_validacion')
    expect(r.puntaje).toBe(10)
  })
})

// ── CASO 11 ─────────────────────────────────────────────────────────────────

describe('CASO 11 · ronda creada a mitad del mes', () => {
  it('la regla vive en SQL; acá se fija el espejo', () => {
    // rondas_ventanas_programadas exige ventana_inicio >= rondas_base.created_at.
    const exigible = (ventana: string, creada: string) => Date.parse(ventana) >= Date.parse(creada)
    const creada = '2026-08-15T01:48:00-03:00'
    expect(exigible('2026-08-10T08:00:00-03:00', creada)).toBe(false)
    expect(exigible('2026-08-20T08:00:00-03:00', creada)).toBe(true)
  })
})

// ── CASO 12 ─────────────────────────────────────────────────────────────────

describe('CASO 12 · varias dimensiones flojas, un solo mensaje', () => {
  const mes = [
    ...Array.from({ length: 10 }, (_, i) => fila({ turnoId: `t${i}`, entrada: '07:20' })),
    ...Array.from({ length: 6 }, (_, i) => fila({
      // El registro existe —lo creó el supervisor—; lo que falta es que sea
      // PROPIO del vigilador. Con tieneFichaje en false sería un hueco sin
      // evidencia, que es otra cosa distinta.
      turnoId: `sr${i}`, tieneFichaje: true, entradaPropia: false, salidaPropia: false,
      entrada: null, salida: null, origenCobertura: 'confirmacion_supervisor',
    })),
    ...Array.from({ length: 4 }, (_, i) => fila({ turnoId: `ok${i}` })),
  ]
  const medido = fuentesDeEmpleado(
    rondas({ obligaciones: 20, cumplidas: 8, noIniciada: 12 }),
    [...nOk(6, 'uniforme'), ...Array.from({ length: 3 }, () => ev('uniforme', 'REVISAR', 'CORRECTO'))],
  )
  const r = calcularCumplimiento(
    mes.map(jornadaCumplimientoDesdeFila), medido.fuentes, VARIANTES_PESOS.modelo_a_equilibrado,
  )
  const todas = () => ensenanzasDeEmpleado('2026-08', r, {
    rondas: medido.rondas, uniforme: medido.uniforme, libro: medido.libro, calidad: medido.calidad,
  })
  const ahora = new Date('2026-09-01T13:00:00Z')

  it('el Entrenador las detecta todas', () => {
    expect(todas().length).toBeGreaterThanOrEqual(3)
  })

  it('pero manda una sola', () => {
    const elegida = ensenanzaPrioritaria(todas(), [], ahora)
    expect(elegida).not.toBeNull()
    expect(todas().filter(e => e.clave === elegida?.clave)).toHaveLength(1)
  })

  it('y el cooldown global la deja sin nada hasta los catorce días', () => {
    const previos = [{ clave: 'puntualidad', periodo: '2026-08', enviadoEn: '2026-08-28T10:00:00Z' }]
    expect(puedeRecibirAhora(previos, ahora)).toBe(false)
    expect(ensenanzaPrioritaria(todas(), previos, ahora)).toBeNull()
    expect(COOLDOWN_GLOBAL_DIAS).toBe(14)
  })
})

// ── Normalización sobre dimensiones aplicables ──────────────────────────────

describe('el denominador son sólo las dimensiones aplicables y medibles', () => {
  it('quien tiene menos dimensiones se mide sobre las que tiene', () => {
    const soloNucleo = conModelo(mesPerfecto(), null, [])
    const puntuables = soloNucleo.dimensiones.filter(d => d.estado === 'puntuable')
    expect(puntuables.map(d => d.clave).sort())
      .toEqual(['asistencia', 'procedimiento', 'puntualidad'])
    expect(soloNucleo.puntaje).toBe(10)
  })

  it('una dimensión floja pesa según su peso relativo, no absoluto', () => {
    // Rondas 5/10 con todo lo demás perfecto. En A pesa 25 de 100; en D, 40 de 95.
    const r = rondas({ obligaciones: 20, cumplidas: 10, noIniciada: 10 })
    const a = conModelo(mesPerfecto(), r, nOk(8, 'uniforme'), 'modelo_a_equilibrado')
    const d = conModelo(mesPerfecto(), r, nOk(8, 'uniforme'), 'modelo_d_rondas')
    expect(a.puntaje as number).toBeGreaterThan(d.puntaje as number)
  })

  it('el peso total se recalcula: no quedan huecos', () => {
    const r = conModelo(mesPerfecto(), null, [])
    const total = r.dimensiones
      .filter(d => d.estado === 'puntuable')
      .reduce((s, d) => s + d.peso, 0)
    // Modelo A sin rondas ni evidencias: 25 + 20 + 10 = 55, y el promedio se
    // divide por 55, no por 100.
    expect(total).toBe(55)
  })
})
