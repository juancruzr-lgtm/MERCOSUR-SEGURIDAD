import { describe, expect, it } from 'vitest'
import { vistaDeEvaluacion } from '@/lib/mi-desempeno'
import { entrenamientoDeEvaluacion, MENSAJE_POSITIVO } from '@/lib/entrenador-desde-snapshot'
import { corregirCapa4, faltaPorSalidaAnticipada } from '@/lib/evaluacion-final'

// MENA, septiembre 2026: balance congelado ANTES de la corrección (todo "bien").
const publicada: any = {
  id: 'ev', empleado_id: 'e', periodo: '2026-09', estado: 'publicada',
  cumplimiento_ponderado: 100, indice: 10, nota_final: 10, concepto: 'Sobresaliente',
  alcance: 'integral', cobertura: 100, datos_insuficientes: false, faltas: [], explicacion: '10 de desempeño',
  dimensiones: [], contexto: {},
  balance: { bloques: [
    { clave: 'asistencia', estado: 'bien', etiqueta: 'Asistencia', hechos: ['Cubriste las 21 jornadas.'] },
    { clave: 'puntualidad', estado: 'bien', etiqueta: 'Puntualidad', hechos: ['Llegaste dentro del horario.'] },
  ] },
}
const corregida = { ...publicada, ...corregirCapa4(publicada, [faltaPorSalidaAnticipada(19)]) }

describe('Mi Desempeño no se contradice con una falta de salida', () => {
  it('sin falta: se felicita como siempre', () => {
    expect(entrenamientoDeEvaluacion(publicada).felicitacion).toBe(MENSAJE_POSITIVO)
  })

  it('con la corrección: no hay "buen trabajo", y lo primero a corregir es el horario de salida', () => {
    const e = entrenamientoDeEvaluacion(corregida)
    expect(e.felicitacion).toBeNull()
    expect(e.servicioReconocido).toBeNull()
    expect(e.recomendaciones[0].clave).toBe('horario_salida')
    expect(e.recomendaciones[0].texto).toMatch(/Llegar antes no te autoriza a retirarte antes/)
  })

  it('"Lo que conviene mejorar" incluye el horario de salida aunque el balance congelado no lo tenga', () => {
    const v = vistaDeEvaluacion(corregida)!
    expect(v.nota).toBe('4,00')
    expect(v.topeAplicado?.texto).toMatch(/limitada a 4,00.*habría sido 10,00/)
    expect(v.loQueConvieneMejorar[0].etiqueta).toBe('Horario de salida')
  })
})
