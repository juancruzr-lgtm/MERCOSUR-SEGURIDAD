import { describe, expect, it } from 'vitest'
import {
  MIN_EVIDENCIAS, MIN_OBLIGACIONES_RONDAS, causasLegibles, detalleCalidad,
  detalleEvidencia, detalleRondas, fuentesDeEmpleado, resumirCalidad,
  resumirEvidencias, resumirRondas,
} from '@/lib/cumplimiento-fuentes'
import type { EvidenciaCumplimiento, RondasEmpleado } from '@/lib/cumplimiento-fuentes'
import { atribucionDeCausa } from '@/lib/rondas-causas'

// Rondas y evidencias. Lo que se prueba es que cada persona se evalúe sobre lo
// que realmente le tocó, que un mismo hecho no cuente dos veces, y que la IA
// sola nunca acuse a nadie.

const rondas = (o: Partial<RondasEmpleado> = {}): RondasEmpleado => ({
  guardiaId: 'g1', obligaciones: 0, cumplidas: 0, noIniciada: 0,
  noFinalizada: 0, suspendida: 0, saneadas: 0, bajoPausa: 0,
  pausaAtribuible: 0, pausaNoAtribuible: 0, pausaCapacitacion: 0,
  pausaSinClasificar: 0, motivosPausa: {}, causasPausa: {},
  ...o,
})

// ── REQUERIMIENTOS ──────────────────────────────────────────────────────────

describe('cada uno se evalúa sobre lo que le tocó', () => {
  it('1. sin rondas asignadas: no aplica, no cero', () => {
    expect(resumirRondas(null).estado).toBe('no_aplica')
    expect(resumirRondas(null).nota).toBeNull()
    expect(resumirRondas(rondas()).estado).toBe('no_aplica')
  })

  it('2. sólo se evalúan las rondas requeridas, no un número fijo', () => {
    const pocas = resumirRondas(rondas({ obligaciones: 10, cumplidas: 9, noIniciada: 1 }))
    const muchas = resumirRondas(rondas({ obligaciones: 60, cumplidas: 59, noIniciada: 1 }))
    expect(pocas.atribuibles).toBe(10)
    expect(muchas.atribuibles).toBe(60)
    // La misma incidencia pesa distinto porque los universos son distintos.
    expect(muchas.nota as number).toBeGreaterThan(pocas.nota as number)
  })

  it('3. sólo se evalúan las fotos que existieron', () => {
    const r = resumirEvidencias([
      { analisis_tipo: 'uniforme', clasificacion_efectiva: 'SIN_OBSERVACIONES' },
      { analisis_tipo: 'uniforme', clasificacion_efectiva: 'SIN_OBSERVACIONES' },
    ], 'uniforme')
    expect(r.medicion.requeridos).toBe(2)
    // No hay ningún "de 30 turnos deberías haber subido 30 fotos": eso es
    // Procedimiento, y castigarlo acá sería contarlo dos veces.
    expect(r.nota).toBeNull()   // dos evidencias no alcanzan como muestra
    expect(MIN_EVIDENCIAS).toBe(5)
  })

  it('4. el libro sólo se evalúa cuando hubo libro', () => {
    const soloUniforme: EvidenciaCumplimiento[] = Array.from({ length: 6 }, () => ({
      analisis_tipo: 'uniforme', clasificacion_efectiva: 'SIN_OBSERVACIONES',
    }))
    const { fuentes } = fuentesDeEmpleado(null, soloUniforme)
    expect(fuentes.libro_guardia?.noAplica).toBe(true)
    expect(fuentes.libro_guardia?.nota).toBeNull()
    expect(fuentes.uniforme?.nota).toBe(10)
  })

  it('el mínimo de rondas declarado son ocho obligaciones', () => {
    expect(MIN_OBLIGACIONES_RONDAS).toBe(8)
    expect(resumirRondas(rondas({ obligaciones: 8, cumplidas: 8 })).estado).toBe('medible')
    expect(resumirRondas(rondas({ obligaciones: 7, cumplidas: 7 })).estado).toBe('datos_insuficientes')
  })
})

// ── ATRIBUCIÓN DE PAUSAS ────────────────────────────────────────────────────

describe('la pausa cuenta según la causa que eligió una persona', () => {
  it('sólo "no se realiza" cuenta como no realizada', () => {
    const r = resumirRondas(rondas({
      obligaciones: 20, cumplidas: 10, pausaAtribuible: 10,
      bajoPausa: 10, causasPausa: { no_se_realiza: 10 },
    }))
    expect(r.atribuibles).toBe(20)
    expect(r.noRealizadas).toBe(10)
    expect(r.nota).toBe(5)
  })

  it('la pausa técnica o de configuración sale del universo sin penalizar', () => {
    const r = resumirRondas(rondas({
      obligaciones: 20, cumplidas: 10, pausaNoAtribuible: 10,
      bajoPausa: 10, causasPausa: { tecnica_gps: 6, configuracion: 4 },
    }))
    expect(r.atribuibles).toBe(10)
    expect(r.nota).toBe(10)
  })

  it('la pausa por capacitación no es incumplimiento del vigilador', () => {
    const r = resumirRondas(rondas({
      obligaciones: 20, cumplidas: 10, pausaCapacitacion: 10,
      bajoPausa: 10, causasPausa: { capacitacion: 10 },
    }))
    expect(r.atribuibles).toBe(10)
    expect(r.nota).toBe(10)
    expect(r.pausaCapacitacion).toBe(10)
  })

  it('una pausa sin causa sale del universo Y deja la nota en validación', () => {
    // Es el caso de todo agosto: la causa no existía cuando se crearon.
    const r = resumirRondas(rondas({
      obligaciones: 20, cumplidas: 10, pausaSinClasificar: 2,
      bajoPausa: 2, causasPausa: { sin_clasificar: 2 },
    }))
    expect(r.atribuibles).toBe(18)
    expect(r.nota).not.toBeNull()
    expect(r.enValidacion).toBe(true)
  })

  it('sin pausas sin clasificar la nota deja de estar en validación', () => {
    const r = resumirRondas(rondas({
      obligaciones: 20, cumplidas: 18, noIniciada: 2,
    }))
    expect(r.enValidacion).toBe(false)
  })

  it('la atribución no se deduce del texto del motivo', () => {
    // Un motivo que dice literalmente que no se hacía, pero SIN causa
    // registrada, no convierte nada en incumplimiento.
    const r = resumirRondas(rondas({
      obligaciones: 20, cumplidas: 10, pausaSinClasificar: 10, bajoPausa: 10,
      motivosPausa: { 'la pauso por que no se hace': 10 },
      causasPausa: { sin_clasificar: 10 },
    }))
    expect(r.noRealizadas).toBe(0)
    expect(r.atribuibles).toBe(10)
    expect(atribucionDeCausa(null)).toBe('sin_clasificar')
  })

  it('las saneadas salen del universo', () => {
    const r = resumirRondas(rondas({ obligaciones: 30, cumplidas: 10, saneadas: 20 }))
    expect(r.atribuibles).toBe(10)
    expect(r.nota).toBe(10)
  })

  it('si TODO quedó excluido no es 0 %: es no aplica', () => {
    const r = resumirRondas(rondas({ obligaciones: 40, bajoPausa: 40, pausaSinClasificar: 40 }))
    expect(r.estado).toBe('no_aplica')
    expect(r.nota).toBeNull()
    expect(r.porcentaje).toBeNull()
  })

  it('los motivos se conservan sin clasificar, y las causas aparte', () => {
    const motivos = { 'la pauso por que no se hace': 199, 'No le da ubicación en los puntos': 29 }
    const r = resumirRondas(rondas({
      obligaciones: 300, cumplidas: 72, bajoPausa: 228, pausaSinClasificar: 228,
      motivosPausa: motivos, causasPausa: { sin_clasificar: 228 },
    }))
    expect(r.motivosPausa).toEqual(motivos)
    expect(causasLegibles(r)[0].etiqueta).toContain('Sin clasificar')
  })

  it('8. la ronda pausada no se duplica con la no realizada', () => {
    // Una ventana bajo pausa NO genera alerta, así que no puede aparecer a la
    // vez como pausada y como no_iniciada. Los totales tienen que cerrar.
    const r = resumirRondas(rondas({
      obligaciones: 20, cumplidas: 12, noIniciada: 3, pausaAtribuible: 5, bajoPausa: 5,
    }))
    expect(r.cumplidas + r.noRealizadas).toBe(20)
    expect(r.noRealizadas).toBe(8)
  })

  it('el detalle no esconde ninguna exclusión', () => {
    const r = resumirRondas(rondas({
      obligaciones: 25, cumplidas: 18, noIniciada: 2, bajoPausa: 3,
      pausaSinClasificar: 3, saneadas: 2,
    }))
    const texto = detalleRondas(r)
    expect(texto).toContain('18 de 20 realizadas')
    expect(texto).toContain('2 no realizadas')
    expect(texto).toContain('3 pausadas sin causa registrada')
    expect(texto).toContain('2 saneadas')
  })
})

// ── DOBLE CASTIGO ───────────────────────────────────────────────────────────

const ev = (o: Partial<EvidenciaCumplimiento> = {}): EvidenciaCumplimiento => ({
  analisis_tipo: 'uniforme',
  clasificacion_efectiva: 'REVISAR',
  revision_estado: 'PENDIENTE',
  ...o,
})

describe('un hecho, una incidencia', () => {
  it('5. no fichar no genera además una falta de uniforme ni de libro', () => {
    // Sin fichaje no hay foto, y sin foto no hay evidencia: el universo de
    // Uniforme y de Libro queda vacío. La incidencia vive en Procedimiento.
    const { fuentes } = fuentesDeEmpleado(null, [])
    expect(fuentes.uniforme?.noAplica).toBe(true)
    expect(fuentes.uniforme?.nota).toBeNull()
    expect(fuentes.libro_guardia?.noAplica).toBe(true)
    expect(fuentes.libro_guardia?.nota).toBeNull()
  })

  it('6. una foto borrosa afecta Calidad y deja Uniforme sin evaluar', () => {
    const lista = [ev({ clasificacion_efectiva: 'EVIDENCIA_INSUFICIENTE' })]
    expect(resumirCalidad(lista).noEvaluables).toBe(1)
    const uni = resumirEvidencias(lista, 'uniforme')
    expect(uni.confirmadas).toBe(0)
    expect(uni.medicion.validos).toBe(0)
  })

  it('6bis. la foto ilegible no produce dos incidencias', () => {
    const lista = [
      ...Array.from({ length: 5 }, () => ev({ clasificacion_efectiva: 'SIN_OBSERVACIONES' })),
      ev({ clasificacion_efectiva: 'EVIDENCIA_INSUFICIENTE' }),
    ]
    const uni = resumirEvidencias(lista, 'uniforme')
    const cal = resumirCalidad(lista)
    expect(uni.medicion.incidencias).toBe(0)   // no cuenta como uniforme incorrecto
    expect(cal.medicion.incidencias).toBe(1)   // cuenta una sola vez, acá
  })

  it('7. el uniforme incorrecto confirmado por una persona sí es incidencia', () => {
    const lista = [
      ...Array.from({ length: 5 }, () => ev({ clasificacion_efectiva: 'SIN_OBSERVACIONES' })),
      ev({ revision_estado: 'CORRECTO' }),
    ]
    const r = resumirEvidencias(lista, 'uniforme')
    expect(r.confirmadas).toBe(1)
    expect(r.medicion.incidencias).toBe(1)
    expect(r.medicion.validos).toBe(6)
  })
})

// ── IA ──────────────────────────────────────────────────────────────────────

describe('la IA sola no acusa a nadie', () => {
  it('9. una observación pendiente no penaliza', () => {
    const lista = [
      ...Array.from({ length: 5 }, () => ev({ clasificacion_efectiva: 'SIN_OBSERVACIONES' })),
      ev({ revision_estado: 'PENDIENTE' }),
    ]
    const r = resumirEvidencias(lista, 'uniforme')
    expect(r.observadasPendientes).toBe(1)
    expect(r.medicion.incidencias).toBe(0)
    expect(r.medicion.validos).toBe(5)
  })

  it('10. una observación descartada por una persona no penaliza', () => {
    const lista = [
      ...Array.from({ length: 5 }, () => ev({ clasificacion_efectiva: 'SIN_OBSERVACIONES' })),
      ev({ revision_estado: 'INCORRECTO' }),
    ]
    const r = resumirEvidencias(lista, 'uniforme')
    expect(r.descartadas).toBe(1)
    expect(r.medicion.incidencias).toBe(0)
    // Sí entra al universo: alguien la miró y dijo que estaba bien.
    expect(r.medicion.validos).toBe(6)
  })

  it('11. SANEADO no penaliza y no entra al universo', () => {
    const lista = [
      ...Array.from({ length: 5 }, () => ev({ clasificacion_efectiva: 'SIN_OBSERVACIONES' })),
      ev({ revision_estado: 'SANEADO' }),
    ]
    const r = resumirEvidencias(lista, 'uniforme')
    expect(r.saneadas).toBe(1)
    expect(r.medicion.validos).toBe(5)
    expect(r.medicion.incidencias).toBe(0)
  })

  it('12. una observación confirmada genera incidencia descriptiva', () => {
    const r = resumirEvidencias([ev({ revision_estado: 'CORRECTO' })], 'uniforme')
    expect(r.confirmadas).toBe(1)
  })

  it('mientras haya observaciones sin revisar la nota queda en validación', () => {
    const lista = [
      ...Array.from({ length: 6 }, () => ev({ clasificacion_efectiva: 'SIN_OBSERVACIONES' })),
      ev({ revision_estado: 'PENDIENTE' }),
    ]
    expect(resumirEvidencias(lista, 'uniforme').enValidacion).toBe(true)
  })

  it('cada tipo cuenta lo suyo: el libro no se mezcla con el uniforme', () => {
    const lista = [ev(), ev({ analisis_tipo: 'libro_guardia' }), ev({ analisis_tipo: 'libro_guardia' })]
    expect(resumirEvidencias(lista, 'uniforme').total).toBe(1)
    expect(resumirEvidencias(lista, 'libro_guardia').total).toBe(2)
  })

  it('el detalle dice en voz alta qué no penaliza', () => {
    const texto = detalleEvidencia(resumirEvidencias([ev(), ev({ revision_estado: 'SANEADO' })], 'uniforme'))
    expect(texto).toContain('no penalizan')
  })

  it('sin evidencias no inventa nada', () => {
    expect(detalleEvidencia(resumirEvidencias([], 'uniforme'))).toBe('Sin evidencias del período')
    expect(detalleCalidad(resumirCalidad([]))).toBe('Sin evidencias del período')
  })
})

describe('calidad de evidencias', () => {
  it('suma los tres tipos', () => {
    const lista = [ev(), ev({ analisis_tipo: 'libro_guardia' }), ev({ analisis_tipo: 'punto_control' })]
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

  it('se queda descriptiva por decisión, no por falta de datos', () => {
    const lista = Array.from({ length: 10 }, () => ev({ clasificacion_efectiva: 'SIN_OBSERVACIONES' }))
    const { fuentes } = fuentesDeEmpleado(null, lista)
    expect(fuentes.evidencias?.nota).toBe(10)
    expect(fuentes.evidencias?.enValidacion).toBe(true)
  })
})

// ── El "por qué no puntúa" es de la persona, no del módulo ──────────────────

describe('la explicación de por qué no puntúa habla de ESTA persona', () => {
  it('a quien no tuvo rondas no se le dice que tiene ventanas pausadas', () => {
    // Era un texto genérico del módulo puesto sobre cualquiera: a alguien con
    // cero rondas le afirmaba que "quedan ventanas pausadas sin causa", que es
    // sencillamente falso sobre él.
    const { fuentes } = fuentesDeEmpleado(null, [])
    expect(fuentes.rondas?.faltante).toBe('No tuvo rondas en el período')
    expect(fuentes.rondas?.faltante).not.toContain('pausadas')
  })

  it('a quien las tuvo todas excluidas se le dice eso', () => {
    const { fuentes } = fuentesDeEmpleado(
      rondas({ obligaciones: 40, bajoPausa: 40, pausaSinClasificar: 40 }), [],
    )
    expect(fuentes.rondas?.faltante).toBe('Sus 40 rondas quedaron fuera del cálculo')
  })

  it('con muestra chica se dice cuántas faltan, no que haya ambigüedad', () => {
    const { fuentes } = fuentesDeEmpleado(rondas({ obligaciones: 5, cumplidas: 5 }), [])
    expect(fuentes.rondas?.faltante).toContain('hacen falta al menos 8')
  })

  it('sólo cuando hay nota se explica la ambigüedad', () => {
    const { fuentes } = fuentesDeEmpleado(
      rondas({ obligaciones: 20, cumplidas: 15, noIniciada: 3, bajoPausa: 2, pausaSinClasificar: 2 }), [],
    )
    expect(fuentes.rondas?.faltante).toContain('sin causa registrada')
  })

  it('lo mismo para uniforme y libro', () => {
    const pocas = Array.from({ length: 2 }, () => ev({ clasificacion_efectiva: 'SIN_OBSERVACIONES' }))
    const { fuentes } = fuentesDeEmpleado(null, pocas)
    expect(fuentes.uniforme?.faltante).toContain('hacen falta al menos 5')
    expect(fuentes.libro_guardia?.faltante).toBe('No tuvo registros de libro en el período')
  })
})
