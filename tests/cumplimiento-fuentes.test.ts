import { describe, expect, it } from 'vitest'
import {
  MIN_OBLIGACIONES_RONDAS, detalleCalidad, detalleEvidencia, detalleRondas,
  resumirCalidad, resumirEvidencias, resumirRondas,
} from '@/lib/cumplimiento-fuentes'
import type { EvidenciaCumplimiento, RondasEmpleado } from '@/lib/cumplimiento-fuentes'

// Rondas y evidencias. Las cuatro dimensiones que salen de acá tienen peso 0;
// lo que se prueba es que los números describan bien y que nada invente una
// falta que nadie verificó.

const rondas = (o: Partial<RondasEmpleado> = {}): RondasEmpleado => ({
  guardiaId: 'g1', obligaciones: 0, cumplidas: 0, noIniciada: 0,
  noFinalizada: 0, suspendida: 0, saneadas: 0, bajoPausa: 0, motivosPausa: {},
  ...o,
})

// ── Rondas ──────────────────────────────────────────────────────────────────

describe('rondas: qué entra al universo atribuible', () => {
  it('una ronda cumplida suma', () => {
    const r = resumirRondas(rondas({ obligaciones: 10, cumplidas: 10 }))
    expect(r).toMatchObject({ estado: 'medible', atribuibles: 10, cumplidas: 10, porcentaje: 100 })
  })

  it('no iniciada, no finalizada y suspendida cuentan como no realizadas', () => {
    const r = resumirRondas(rondas({
      obligaciones: 20, cumplidas: 14, noIniciada: 4, noFinalizada: 1, suspendida: 1,
    }))
    expect(r.noRealizadas).toBe(6)
    expect(r.atribuibles).toBe(20)
    expect(r.porcentaje).toBe(70)
  })

  it('las saneadas salen del universo', () => {
    const r = resumirRondas(rondas({ obligaciones: 30, cumplidas: 10, saneadas: 20 }))
    expect(r.atribuibles).toBe(10)
    expect(r.saneadas).toBe(20)
    expect(r.porcentaje).toBe(100)
  })

  it('las ventanas bajo pausa también salen', () => {
    const r = resumirRondas(rondas({ obligaciones: 30, cumplidas: 10, bajoPausa: 20 }))
    expect(r.atribuibles).toBe(10)
    expect(r.bajoPausa).toBe(20)
  })

  it('una ronda pausada no se cuenta como cumplida', () => {
    // Es el error que más engaña: sin alerta parece cumplida, y en realidad no
    // era exigible. Contarla infla el numerador.
    const conPausa = resumirRondas(rondas({ obligaciones: 20, cumplidas: 10, bajoPausa: 10 }))
    expect(conPausa.cumplidas).toBe(10)
    expect(conPausa.atribuibles).toBe(10)
  })

  it('los motivos de pausa se conservan sin clasificar', () => {
    const motivos = { 'la pauso por que no se hace': 199, 'No le da ubicación en los puntos': 29 }
    const r = resumirRondas(rondas({ obligaciones: 300, cumplidas: 72, bajoPausa: 228, motivosPausa: motivos }))
    expect(r.motivosPausa).toEqual(motivos)
  })
})

describe('rondas: no aplica y datos insuficientes no son cero', () => {
  it('sin rondas asignadas: no aplica', () => {
    expect(resumirRondas(null).estado).toBe('no_aplica')
    expect(resumirRondas(rondas()).estado).toBe('no_aplica')
    expect(resumirRondas(null).porcentaje).toBeNull()
  })

  it('con muestra chica: datos insuficientes, no un porcentaje', () => {
    const r = resumirRondas(rondas({ obligaciones: 5, cumplidas: 3, noIniciada: 2 }))
    expect(r.estado).toBe('datos_insuficientes')
    expect(r.atribuibles).toBe(5)
  })

  it('el mínimo declarado son ocho obligaciones', () => {
    expect(MIN_OBLIGACIONES_RONDAS).toBe(8)
    expect(resumirRondas(rondas({ obligaciones: 8, cumplidas: 8 })).estado).toBe('medible')
    expect(resumirRondas(rondas({ obligaciones: 7, cumplidas: 7 })).estado).toBe('datos_insuficientes')
  })

  it('si TODO quedó excluido no es 0 %: es no aplica', () => {
    // Alguien cuyas rondas estuvieron pausadas todo el mes no cumple mal:
    // no tuvo nada exigible. Un 0 % ahí sería una acusación inventada.
    const r = resumirRondas(rondas({ obligaciones: 40, bajoPausa: 40 }))
    expect(r.estado).toBe('no_aplica')
    expect(r.porcentaje).toBeNull()
    expect(r.bajoPausa).toBe(40)
  })

  it('el detalle no esconde las exclusiones', () => {
    const r = resumirRondas(rondas({
      obligaciones: 25, cumplidas: 18, noIniciada: 2, bajoPausa: 3, saneadas: 2,
    }))
    const texto = detalleRondas(r)
    expect(texto).toContain('18 de 20 realizadas')
    expect(texto).toContain('2 no realizadas')
    expect(texto).toContain('3 bajo ronda pausada')
    expect(texto).toContain('2 saneadas')
  })
})

// ── Evidencias ──────────────────────────────────────────────────────────────

const ev = (o: Partial<EvidenciaCumplimiento> = {}): EvidenciaCumplimiento => ({
  analisis_tipo: 'uniforme',
  clasificacion_efectiva: 'REVISAR',
  revision_estado: 'PENDIENTE',
  ...o,
})

describe('uniforme y libro: la IA sola no acusa a nadie', () => {
  it('una observación sin revisar NO es una falta', () => {
    const r = resumirEvidencias([ev()], 'uniforme')
    expect(r.observadasPendientes).toBe(1)
    expect(r.confirmadas).toBe(0)
  })

  it('SANEADO no penaliza y queda aparte', () => {
    const r = resumirEvidencias([ev({ revision_estado: 'SANEADO' })], 'uniforme')
    expect(r.saneadas).toBe(1)
    expect(r.confirmadas).toBe(0)
    expect(r.descartadas).toBe(0)
  })

  it('descartada por una persona es falso positivo de la IA, no falta del vigilador', () => {
    const r = resumirEvidencias([ev({ revision_estado: 'INCORRECTO' })], 'uniforme')
    expect(r.descartadas).toBe(1)
    expect(r.confirmadas).toBe(0)
  })

  it('confirmada por una persona es la única incidencia válida', () => {
    const r = resumirEvidencias([ev({ revision_estado: 'CORRECTO' })], 'uniforme')
    expect(r.confirmadas).toBe(1)
  })

  it('una foto no evaluable NO se convierte en uniforme incorrecto', () => {
    const r = resumirEvidencias([ev({ clasificacion_efectiva: 'EVIDENCIA_INSUFICIENTE' })], 'uniforme')
    expect(r.noEvaluables).toBe(1)
    expect(r.confirmadas).toBe(0)
    expect(r.observadasPendientes).toBe(0)
  })

  it('cada tipo cuenta lo suyo: el libro no se mezcla con el uniforme', () => {
    const lista = [ev(), ev({ analisis_tipo: 'libro_guardia' }), ev({ analisis_tipo: 'libro_guardia' })]
    expect(resumirEvidencias(lista, 'uniforme').total).toBe(1)
    expect(resumirEvidencias(lista, 'libro_guardia').total).toBe(2)
  })

  it('el detalle dice en voz alta qué no penaliza', () => {
    const texto = detalleEvidencia(resumirEvidencias([
      ev(), ev({ revision_estado: 'SANEADO' }),
    ], 'uniforme'))
    expect(texto).toContain('no penalizan')
  })

  it('sin evidencias no inventa nada', () => {
    expect(detalleEvidencia(resumirEvidencias([], 'uniforme'))).toBe('Sin evidencias del período')
  })
})

describe('calidad de evidencias: el hecho primario', () => {
  it('la foto que no permite evaluar cuenta acá, no en Uniforme', () => {
    const lista = [ev({ clasificacion_efectiva: 'EVIDENCIA_INSUFICIENTE' })]
    expect(resumirCalidad(lista).noEvaluables).toBe(1)
    expect(resumirEvidencias(lista, 'uniforme').confirmadas).toBe(0)
  })

  it('suma los tres tipos', () => {
    const lista = [
      ev(), ev({ analisis_tipo: 'libro_guardia' }), ev({ analisis_tipo: 'punto_control' }),
    ]
    expect(resumirCalidad(lista).total).toBe(3)
  })

  it('el detalle separa evaluables de las que no se pudieron leer', () => {
    const texto = detalleCalidad(resumirCalidad([
      ev({ clasificacion_efectiva: 'SIN_OBSERVACIONES' }),
      ev({ clasificacion_efectiva: 'EVIDENCIA_INSUFICIENTE' }),
    ]))
    expect(texto).toContain('1 de 2 evaluables')
    expect(texto).toContain('el problema es la foto')
  })

  it('una evidencia mala no produce dos incidencias', () => {
    // Sale en Calidad como no evaluable y en Uniforme no cuenta como nada.
    const lista = [ev({ clasificacion_efectiva: 'EVIDENCIA_INSUFICIENTE' })]
    const uni = resumirEvidencias(lista, 'uniforme')
    expect(uni.confirmadas + uni.observadasPendientes).toBe(0)
    expect(resumirCalidad(lista).noEvaluables).toBe(1)
  })
})
