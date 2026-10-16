import { describe, expect, it } from 'vitest'
import { PERFIL_POR_TIPO, compararLecturas, estimarLote, resumirLote } from '@/lib/ia/lote-control'
import type { ItemLote, Lectura } from '@/lib/ia/lote-control'

const lectura = (clasificacion: string, elementos: Record<string, string> = { libro: 'PRESENTE' }, nitidez = 'OK'): Lectura => ({
  clasificacion, tokensEntrada: 100, tokensSalida: 10,
  resultado: {
    evaluable: true, clasificacion: clasificacion as never, confianza: 0.9, motivos: [], resumen: '',
    elementos: Object.entries(elementos).map(([clave, valor]) => ({ clave, valor: valor as never, comentario: '' })),
    calidad: { nitidez: nitidez as never, iluminacion: 'OK', encuadre: 'OK' },
  },
})
const sinCambio = { clasificacion: false, elementos: [], calidad: [], critica: false }

describe('Lote de control de la IA', () => {
  it('los perfiles son los de #280', () => {
    expect(PERFIL_POR_TIPO.libro_guardia).toEqual({ ladoMayor: 1800, quality: 0.78 })
    expect(PERFIL_POR_TIPO.punto_control).toEqual({ ladoMayor: 1600, quality: 0.75 })
  })
  it('detecta cambio crítico, de elementos y de calidad', () => {
    const d = compararLecturas(lectura('SIN_OBSERVACIONES'), lectura('REVISAR', { libro: 'AUSENTE' }, 'BAJA'))
    expect(d).toEqual({ clasificacion: true, elementos: ['libro'], calidad: ['nitidez'], critica: true })
    expect(compararLecturas(lectura('REVISAR'), lectura('EVIDENCIA_INSUFICIENTE')).critica).toBe(false)
  })
  const item = (tipo: string, compresion = sinCambio, estabilidad = sinCambio): ItemLote =>
    ({ analisisId: 'x', tipo, bytesOriginal: 300, bytesNuevo: 250, compresion, estabilidad })
  it('veredicto: sin diferencias', () => {
    expect(resumirLote([item('libro_guardia'), item('punto_control')]).veredicto).toBe('sin_diferencias')
  })
  it('veredicto: dentro de la variación propia del modelo', () => {
    const cambio = { ...sinCambio, clasificacion: true }
    expect(resumirLote([item('libro_guardia', cambio), item('libro_guardia', sinCambio, cambio)]).veredicto).toBe('dentro_de_la_variacion_del_modelo')
  })
  it('veredicto: revisar si hay un cambio crítico o más cambios que la variación propia', () => {
    const critico = { ...sinCambio, clasificacion: true, critica: true }
    expect(resumirLote([item('punto_control', critico, critico)]).veredicto).toBe('revisar')
    const cambio = { ...sinCambio, clasificacion: true }
    expect(resumirLote([item('punto_control', cambio), item('punto_control', cambio)]).veredicto).toBe('revisar')
  })
  it('estimación con los tokens promedio reales de producción (30 + 30, tres corridas)', () => {
    const e = estimarLote({
      libro_guardia: { fotos: 30, tokensEntrada: 3725, tokensSalida: 299 },
      punto_control: { fotos: 30, tokensEntrada: 6077, tokensSalida: 303 },
    }, 3)
    expect(e).toEqual({ llamadas: 180, tokensEntrada: 882180, tokensSalida: 54180, usd: null })
    expect(estimarLote({ x: { fotos: 1, tokensEntrada: 1e6, tokensSalida: 1e6 } }, 1, { entrada: 0.1, salida: 0.4 }).usd).toBeCloseTo(0.5)
  })
})
