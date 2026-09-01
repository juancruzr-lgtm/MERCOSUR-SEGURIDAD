import { describe, expect, it } from 'vitest'
import { adopcionDeFila, resumirAdopcion } from '@/lib/adopcion-app'
import type { FilaPublicada } from '@/lib/mi-desempeno'

const fila = (
  incidencias: number, requeridos: number, over: Partial<FilaPublicada> = {}, extra: any[] = [],
): FilaPublicada => ({
  empleado_id: 'x', periodo: '2026-08',
  cumplimiento_ponderado: 90, indice: 7, nota_final: 7, concepto: 'Bueno',
  datos_insuficientes: false, cobertura: 100, alcance: 'integral',
  estado_desempeno: 'correcto', dimensiones: [], faltas: [], explicacion: null,
  balance: {
    bloques: [
      {
        clave: 'procedimiento', etiqueta: 'Registro en la app', grupo: 'app',
        estado: incidencias > 0 ? 'mejorar' : 'bien',
        hechos: [`En ${incidencias} jornadas no quedó registro propio de tu fichaje.`],
        requeridos, incidencias,
      },
      ...extra,
    ],
  },
  contexto: { jornadas: requeridos }, estado: 'publicada',
  ...over,
})

describe('la clasificacion es simple y usa los umbrales que ya existen', () => {
  it('sin jornadas sin registro: uso correcto', () => {
    const a = adopcionDeFila(fila(0, 25))!
    expect(a.clase).toBe('uso_correcto')
    expect(a.severidad).toBeNull()
    expect(a.proporcion).toBe(0)
  })

  it('una sola vez: necesita entrenamiento, no es reiterado', () => {
    expect(adopcionDeFila(fila(1, 25))!.clase).toBe('necesita_entrenamiento')
  })

  it('dos veces sobre veinticinco: necesita entrenamiento', () => {
    const a = adopcionDeFila(fila(2, 25))!
    expect(a.severidad).toBe('reincidencia')
    expect(a.clase).toBe('necesita_entrenamiento')
  })

  it('cuatro o mas: uso deficiente reiterado', () => {
    const a = adopcionDeFila(fila(5, 25))!
    expect(a.severidad).toBe('patron')
    expect(a.clase).toBe('uso_deficiente_reiterado')
    expect(a.proporcion).toBe(20)
  })

  it('proporcion alta sobre muestra suficiente tambien es reiterado', () => {
    // 3 de 8 es el 37,5 %: pasa el umbral de proporcion sin llegar a 4 casos.
    expect(adopcionDeFila(fila(3, 8))!.clase).toBe('uso_deficiente_reiterado')
  })
})

describe('funciona sin nota mensual: es el punto de la vista', () => {
  it('con cinco jornadas y cuatro sin registro, se detecta igual', () => {
    const a = adopcionDeFila(fila(4, 5, { datos_insuficientes: true, nota_final: null }))!
    expect(a.sinNota).toBe(true)
    expect(a.clase).toBe('uso_deficiente_reiterado')
    expect(a.jornadas).toBe(5)
    expect(a.sinRegistroPropio).toBe(4)
  })

  it('una muestra chica se marca, no se oculta', () => {
    const a = adopcionDeFila(fila(2, 3))!
    expect(a.muestraChica).toBe(true)
    expect(a.clase).toBe('necesita_entrenamiento')
  })
})

describe('Rondas no entra en uso de la app', () => {
  it('un incumplimiento de rondas no cambia la clasificacion de adopcion', () => {
    const conRondas = adopcionDeFila(fila(0, 25, {}, [{
      clave: 'rondas', etiqueta: 'Rondas', grupo: 'servicio', estado: 'mejorar',
      hechos: [], requeridos: 52, incidencias: 33,
    }]))!
    // Ficha siempre bien: es uso correcto de la app, aunque falle en rondas.
    expect(conRondas.clase).toBe('uso_correcto')
    expect(conRondas.sinRegistroPropio).toBe(0)
  })
})

describe('sin bloque de registro no se afirma nada', () => {
  it('devuelve null en vez de inventar un uso correcto', () => {
    const f = fila(0, 25)
    ;(f.balance as any).bloques = [{ clave: 'rondas', requeridos: 5, incidencias: 1 }]
    expect(adopcionDeFila(f)).toBeNull()
  })

  it('sin jornadas evaluadas tampoco', () => {
    expect(adopcionDeFila(fila(0, 0))).toBeNull()
  })
})

describe('el resumen para Gerencia', () => {
  const items = [
    adopcionDeFila(fila(0, 25))!,
    adopcionDeFila(fila(0, 20))!,
    adopcionDeFila(fila(2, 20))!,
    adopcionDeFila(fila(8, 20))!,
  ]
  const r = resumirAdopcion(items)

  it('cuenta y porcentaje por clase', () => {
    expect(r.total).toBe(4)
    expect(r.porClase.uso_correcto).toBe(2)
    expect(r.porClase.necesita_entrenamiento).toBe(1)
    expect(r.porClase.uso_deficiente_reiterado).toBe(1)
    expect(r.porcentaje.uso_correcto).toBe(50)
  })

  it('suma las jornadas sin registro sobre las trabajadas', () => {
    expect(r.jornadasSinRegistro).toBe(10)
    expect(r.jornadasEvaluadas).toBe(85)
  })

  it('los casos vienen del mas reiterado al menos, sin los correctos', () => {
    expect(r.casos).toHaveLength(2)
    expect(r.casos[0].sinRegistroPropio).toBe(8)
  })

  it('sin nadie, todo en cero y sin dividir por cero', () => {
    const v = resumirAdopcion([])
    expect(v.total).toBe(0)
    expect(v.porcentaje.uso_correcto).toBe(0)
    expect(v.casos).toEqual([])
  })
})

// ── El bloque "bien" no trae numeros ────────────────────────────────────────
//
// `balance-mensual` sólo emite `requeridos`/`incidencias` cuando hay algo que
// contar. Leerlos como cero dejaba fuera de la clasificacion a todo el que
// ficha bien: la pantalla mostraba CERO personas con uso correcto sobre 65.

describe('quien ficha bien se cuenta, aunque el bloque no traiga numeros', () => {
  const conBloqueBien = (over: any = {}, contexto: any = { jornadas: 26 }) => ({
    empleado_id: 'ok', periodo: '2026-08',
    cumplimiento_ponderado: 99.8, indice: 9.9, nota_final: 9.9, concepto: 'Excelente',
    datos_insuficientes: false, cobertura: 100, alcance: 'integral',
    estado_desempeno: 'excelente', dimensiones: [], faltas: [], explicacion: null,
    balance: {
      bloques: [{
        clave: 'procedimiento', grupo: 'app', estado: 'bien',
        etiqueta: 'Registro en la app',
        hechos: ['Tus ingresos y egresos quedaron registrados en las 26 jornadas evaluadas.'],
        ...over,
      }],
    },
    contexto, estado: 'publicada',
  }) as any

  it('se clasifica como uso correcto, no se descarta', () => {
    const a = adopcionDeFila(conBloqueBien())
    expect(a).not.toBeNull()
    expect(a!.clase).toBe('uso_correcto')
    expect(a!.sinRegistroPropio).toBe(0)
  })

  it('las jornadas salen del contexto cuando el bloque no las trae', () => {
    expect(adopcionDeFila(conBloqueBien())!.jornadas).toBe(26)
    expect(adopcionDeFila(conBloqueBien())!.proporcion).toBe(0)
  })

  it('si el bloque SI trae requeridos, mandan los del bloque', () => {
    const a = adopcionDeFila(conBloqueBien({ requeridos: 30 }, { jornadas: 26 }))!
    expect(a.jornadas).toBe(30)
  })

  it('sin jornadas por ningun lado no se afirma nada', () => {
    expect(adopcionDeFila(conBloqueBien({}, {}))).toBeNull()
  })
})

describe('lo que no se pudo medir no cuenta como uso correcto', () => {
  const conEstado = (estado: string) => ({
    empleado_id: 'x', periodo: '2026-08',
    cumplimiento_ponderado: null, indice: null, nota_final: null, concepto: null,
    datos_insuficientes: true, cobertura: null, alcance: 'parcial',
    estado_desempeno: null, dimensiones: [], faltas: [], explicacion: null,
    balance: { bloques: [{ clave: 'procedimiento', estado, hechos: [] }] },
    contexto: { jornadas: 10 }, estado: 'publicada',
  }) as any

  it('no_aplica devuelve null', () => {
    expect(adopcionDeFila(conEstado('no_aplica'))).toBeNull()
  })

  it('sin_datos devuelve null', () => {
    expect(adopcionDeFila(conEstado('sin_datos'))).toBeNull()
  })
})
