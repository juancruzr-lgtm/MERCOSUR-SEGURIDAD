import { describe, expect, it } from 'vitest'
import { derivarClasificacion } from '@/lib/ia/contratos'
import type { ResultadoIA, Umbrales } from '@/lib/ia/contratos'
import type { ElementoCriterio } from '@/lib/ia/referencias'

// Lista blanca de motivos por tipo de análisis.
//
// Medido sobre producción: el REVISAR crudo del modelo tiene precisión 0%. De
// 100 fotos que un humano miró porque la IA las marcó, se descartaron las 100,
// en los tres tipos. Un umbral de confianza no separa nada —los tres buckets
// viven entre 0,89 y 0,99— así que el corte útil es por motivo.
//
// Precisión medida (confirmadas / vistas):
//   SEÑAL   uniforme SIN_PERSONA_EN_IMAGEN          2/3   (67%)
//           libro_guardia NO_CORRESPONDE_AL_TIPO    6/12  (50%)
//           libro_guardia ESCENA_NO_COINCIDE        3/8   (38%)
//   RUIDO   punto_control ESCENA_NO_COINCIDE        0/28
//           uniforme ELEMENTO_REQUERIDO_AUSENTE     0/8
//           libro_guardia ELEMENTO_REQUERIDO_AUSENTE 0/7
//           punto_control SIN_BASE_DE_COMPARACION   1/19
//
// La lista viaja por configuración, y cada tipo de análisis tiene la suya.

const resultado = (over: Partial<ResultadoIA> = {}): ResultadoIA => ({
  evaluable: true,
  clasificacion: 'REVISAR',
  confianza: 0.95,
  motivos: [],
  elementos: [],
  calidad: { nitidez: 'OK', iluminacion: 'OK', encuadre: 'OK' },
  resumen: '',
  ...over,
})

const criterio = (clave: string, requerido = true): ElementoCriterio =>
  ({ clave, etiqueta: clave, requerido, nota: '' })

// Las tres listas propuestas por la auditoría.
const RONDA: Umbrales       = { motivosQueHabilitanRevisar: ['NO_CORRESPONDE_AL_TIPO'] }
const UNIFORME: Umbrales    = { motivosQueHabilitanRevisar: ['SIN_PERSONA_EN_IMAGEN'] }
const LIBRO: Umbrales       = { motivosQueHabilitanRevisar: ['NO_CORRESPONDE_AL_TIPO', 'ESCENA_NO_COINCIDE'] }

describe('sin lista configurada, nada cambia', () => {
  it('un REVISAR del modelo sigue siendo REVISAR', () => {
    expect(derivarClasificacion(resultado({ motivos: ['ESCENA_NO_COINCIDE'] }), [])).toBe('REVISAR')
  })

  it('una lista vacía tampoco filtra', () => {
    expect(derivarClasificacion(
      resultado({ motivos: ['ESCENA_NO_COINCIDE'] }), [], { motivosQueHabilitanRevisar: [] },
    )).toBe('REVISAR')
  })
})

describe('ronda (punto_control): el ruido deja de llegar', () => {
  it('ESCENA_NO_COINCIDE ya no manda a revisión — era 0 de 28', () => {
    expect(derivarClasificacion(
      resultado({ motivos: ['ESCENA_NO_COINCIDE'] }), [], RONDA,
    )).toBe('SIN_OBSERVACIONES')
  })

  it('SIN_BASE_DE_COMPARACION tampoco: es carencia de configuración nuestra', () => {
    expect(derivarClasificacion(
      resultado({ motivos: ['SIN_BASE_DE_COMPARACION'] }), [], RONDA,
    )).toBe('SIN_OBSERVACIONES')
  })

  it('NO_CORRESPONDE_AL_TIPO sí pasa: es el piso barato', () => {
    expect(derivarClasificacion(
      resultado({ motivos: ['NO_CORRESPONDE_AL_TIPO'] }), [], RONDA,
    )).toBe('REVISAR')
  })
})

describe('uniforme y libro: sólo lo que demostró señal', () => {
  it('uniforme: SIN_PERSONA_EN_IMAGEN pasa', () => {
    expect(derivarClasificacion(
      resultado({ motivos: ['SIN_PERSONA_EN_IMAGEN'] }), [], UNIFORME,
    )).toBe('REVISAR')
  })

  it('uniforme: ELEMENTO_REQUERIDO_AUSENTE no — era 0 de 8', () => {
    const r = resultado({ motivos: [], elementos: [{ clave: 'logo', valor: 'AUSENTE', comentario: '' }] })
    expect(derivarClasificacion(r, [criterio('logo')], UNIFORME)).toBe('SIN_OBSERVACIONES')
  })

  it('libro: NO_CORRESPONDE_AL_TIPO y ESCENA_NO_COINCIDE pasan', () => {
    expect(derivarClasificacion(resultado({ motivos: ['NO_CORRESPONDE_AL_TIPO'] }), [], LIBRO)).toBe('REVISAR')
    expect(derivarClasificacion(resultado({ motivos: ['ESCENA_NO_COINCIDE'] }), [], LIBRO)).toBe('REVISAR')
  })

  it('libro: ELEMENTO_REQUERIDO_AUSENTE no — era 0 de 7', () => {
    const r = resultado({ motivos: [], elementos: [{ clave: 'fecha', valor: 'AUSENTE', comentario: '' }] })
    expect(derivarClasificacion(r, [criterio('fecha')], LIBRO)).toBe('SIN_OBSERVACIONES')
  })

  it('el elemento faltante SÍ pasa si se lo pone en la lista', () => {
    const r = resultado({ motivos: [], elementos: [{ clave: 'logo', valor: 'AUSENTE', comentario: '' }] })
    const conElemento: Umbrales = { motivosQueHabilitanRevisar: ['ELEMENTO_REQUERIDO_AUSENTE'] }
    expect(derivarClasificacion(r, [criterio('logo')], conElemento)).toBe('REVISAR')
  })
})

describe('lo que la lista blanca NO puede pisar', () => {
  it('la calidad crítica sigue siendo evidencia insuficiente', () => {
    const r = resultado({ calidad: { nitidez: 'CRITICA', iluminacion: 'OK', encuadre: 'OK' } })
    expect(derivarClasificacion(r, [], RONDA)).toBe('EVIDENCIA_INSUFICIENTE')
  })

  it('no evaluable, tampoco', () => {
    expect(derivarClasificacion(resultado({ evaluable: false }), [], RONDA)).toBe('EVIDENCIA_INSUFICIENTE')
  })

  it('la confianza por debajo del mínimo, tampoco', () => {
    const r = resultado({ confianza: 0.1, motivos: ['NO_CORRESPONDE_AL_TIPO'] })
    expect(derivarClasificacion(r, [], RONDA)).toBe('EVIDENCIA_INSUFICIENTE')
  })

  it('motivosQueObliganRevisar es un override: pasa por encima de la lista', () => {
    const u: Umbrales = {
      motivosQueObliganRevisar: ['CAMARA_TAPADA'],
      motivosQueHabilitanRevisar: ['NO_CORRESPONDE_AL_TIPO'],
    }
    expect(derivarClasificacion(resultado({ motivos: ['CAMARA_TAPADA'] }), [], u)).toBe('REVISAR')
  })

  it('un SIN_OBSERVACIONES del modelo no se convierte en REVISAR por tener la lista', () => {
    const r = resultado({ clasificacion: 'SIN_OBSERVACIONES', motivos: ['NO_CORRESPONDE_AL_TIPO'] })
    expect(derivarClasificacion(r, [], RONDA)).toBe('SIN_OBSERVACIONES')
  })
})
