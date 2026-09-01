import { describe, expect, it } from 'vitest'
import {
  MENSAJE_POSITIVO, MENSAJE_SERVICIO_RECONOCIDO,
  entrenamientoDeEvaluacion,
} from '@/lib/entrenador-desde-snapshot'
import type { FilaPublicada } from '@/lib/mi-desempeno'

const bloque = (over: any) => ({
  clave: 'procedimiento', etiqueta: 'Registro en la app', grupo: 'app',
  estado: 'mejorar', hechos: [], requeridos: 25, incidencias: 5,
  recomendacion: 'Marcá el ingreso al comenzar el turno y la salida al terminarlo.',
  ...over,
})

const fila = (bloques: any[], over: Partial<FilaPublicada> = {}): FilaPublicada => ({
  empleado_id: 'x', periodo: '2026-08',
  cumplimiento_ponderado: 90, indice: 7, nota_final: 7, concepto: 'Bueno',
  datos_insuficientes: false, cobertura: 100, alcance: 'integral',
  estado_desempeno: 'correcto', dimensiones: [], faltas: [], explicacion: null,
  balance: { bloques }, contexto: { jornadas: 25 }, estado: 'publicada',
  ...over,
})

describe('mensaje positivo cuando no hay nada que corregir', () => {
  const e = entrenamientoDeEvaluacion(fila([
    bloque({ clave: 'asistencia', etiqueta: 'Asistencia', estado: 'bien', recomendacion: undefined }),
  ]))

  it('felicita, sin puntaje ni comparacion', () => {
    expect(e.felicitacion).toBe(MENSAJE_POSITIVO)
    expect(e.felicitacion).toContain('Mantené esta forma de trabajo')
  })

  it('no hay recomendaciones que dar', () => {
    expect(e.recomendaciones).toEqual([])
  })

  it('no menciona sanciones ni compara', () => {
    const todo = JSON.stringify(e).toLowerCase()
    for (const palabra of ['sanci', 'apercib', 'ranking', 'peor', 'mejor que', 'compañer']) {
      expect(todo).not.toContain(palabra)
    }
  })
})

describe('Rondas: el mensaje sale del balance, no de un motor nuevo', () => {
  const e = entrenamientoDeEvaluacion(fila([
    bloque({
      clave: 'rondas', etiqueta: 'Rondas', grupo: 'servicio',
      requeridos: 52, incidencias: 33,
      hechos: ['Se evaluaron 52 rondas exigibles y registraste 19 como realizadas.'],
      recomendacion: 'Cuando el puesto tenga rondas asignadas, iniciá el recorrido '
        + 'desde la aplicación y registrá todos los puntos indicados.',
    }),
  ]))

  it('dice qué hacer la próxima vez', () => {
    expect(e.recomendaciones[0].texto).toContain('iniciá el recorrido desde la aplicación')
  })

  it('trae los hechos que lo sostienen', () => {
    expect(e.recomendaciones[0].hechos[0]).toContain('52 rondas exigibles')
  })

  it('33 sobre 52 es patrón, no una incidencia suelta', () => {
    expect(e.recomendaciones[0].severidad).toBe('patron')
  })
})

describe('Registro en la app', () => {
  const e = entrenamientoDeEvaluacion(fila([bloque({})]))

  it('el mensaje es el del registro de entrada y salida', () => {
    expect(e.recomendaciones[0].clave).toBe('procedimiento_registro')
    expect(e.recomendaciones[0].texto).toContain('Marcá el ingreso')
  })

  it('5 jornadas sin registro ya son patrón: cuatro alcanzan, sin mirar proporción', () => {
    expect(e.recomendaciones[0].severidad).toBe('patron')
  })
})

describe('servicio reconocido pero sin registro propio', () => {
  const e = entrenamientoDeEvaluacion(fila([
    bloque({ clave: 'asistencia', etiqueta: 'Asistencia', estado: 'bien', recomendacion: undefined }),
    bloque({}),
  ]))

  it('se dice que el servicio se dio por prestado', () => {
    expect(e.servicioReconocido).toBe(MENSAJE_SERVICIO_RECONOCIDO)
    expect(e.servicioReconocido).toContain('El servicio fue reconocido')
  })

  it('y que lo que falta corregir es el uso de la app', () => {
    expect(e.servicioReconocido).toContain('registro y uso de la aplicación')
  })

  it('sin problema de registro no aparece esa aclaración', () => {
    const solo = entrenamientoDeEvaluacion(fila([
      bloque({ clave: 'asistencia', etiqueta: 'Asistencia', estado: 'bien', recomendacion: undefined }),
    ]))
    expect(solo.servicioReconocido).toBeNull()
  })
})

describe('el orden es el que ya usa el Entrenador', () => {
  it('asistencia antes que rondas, rondas después de registro', () => {
    const e = entrenamientoDeEvaluacion(fila([
      bloque({ clave: 'rondas', etiqueta: 'Rondas', recomendacion: 'r' }),
      bloque({ clave: 'asistencia', etiqueta: 'Asistencia', recomendacion: 'a' }),
      bloque({ clave: 'procedimiento', etiqueta: 'Registro', recomendacion: 'p' }),
    ]))
    expect(e.recomendaciones.map(r => r.clave))
      .toEqual(['asistencia', 'procedimiento_registro', 'rondas'])
  })
})

describe('sin muestra no se entrena', () => {
  const e = entrenamientoDeEvaluacion(fila([], { datos_insuficientes: true, nota_final: null }))

  it('no se felicita a alguien que no se pudo medir', () => {
    expect(e.sinMuestra).toBe(true)
    expect(e.felicitacion).toBeNull()
  })
})

describe('una fila sin balance no rompe', () => {
  it('devuelve vacío', () => {
    const e = entrenamientoDeEvaluacion(fila([], { balance: null }))
    expect(e.recomendaciones).toEqual([])
    expect(e.felicitacion).toBe(MENSAJE_POSITIVO)
  })
})
