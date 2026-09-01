import { describe, expect, it } from 'vitest'
import { etiquetaDePeriodo, vistaDeEvaluacion, type FilaPublicada } from '@/lib/mi-desempeno'

const fila = (over: Partial<FilaPublicada> = {}): FilaPublicada => ({
  empleado_id: 'x',
  periodo: '2026-08',
  cumplimiento_ponderado: 97.1,
  indice: 8.78,
  nota_final: 8.78,
  concepto: 'Muy bueno',
  datos_insuficientes: false,
  cobertura: 100,
  alcance: 'integral',
  estado_desempeno: 'excelente',
  dimensiones: [
    { clave: 'rondas', etiqueta: 'Rondas', nota: 9.92, peso: 35, estado: 'puntuable' },
    { clave: 'puntualidad', etiqueta: 'Puntualidad', nota: 9.4, peso: 25, estado: 'puntuable' },
    { clave: 'evidencias', etiqueta: 'Calidad de las fotos', nota: 10, peso: 0, estado: 'en_validacion' },
  ],
  faltas: [],
  explicacion: null,
  balance: {
    encabezado: 'Trabajaste 25 turnos.',
    bloques: [
      { clave: 'asistencia', etiqueta: 'Asistencia', grupo: 'servicio', estado: 'bien', hechos: ['25 de 25 jornadas'] },
      { clave: 'rondas', etiqueta: 'Rondas', grupo: 'servicio', estado: 'mejorar', hechos: ['1 ronda sin hacer'], recomendacion: 'Iniciá la ronda al comenzar el turno.' },
      { clave: 'libro', etiqueta: 'Libro', grupo: 'app', estado: 'no_aplica', hechos: [] },
    ],
    notaDeCobertura: null,
  },
  contexto: { jornadas: 25, objetivos: ['ACA'] },
  estado: 'publicada',
  ...over,
})

// ── La regla que protege a la persona ───────────────────────────────────────

describe('sin muestra no se muestra ningun numero', () => {
  const v = vistaDeEvaluacion(fila({
    datos_insuficientes: true, nota_final: null, indice: null,
    cumplimiento_ponderado: null, concepto: null, cobertura: null,
    contexto: { jornadas: 5, objetivos: [] },
  }))

  it('no hay nota', () => {
    expect(v.sinMuestra).toBe(true)
    expect(v.nota).toBeNull()
  })

  it('tampoco hay un cero disfrazado de nota', () => {
    // Un cero se lee como "hiciste todo mal". Lo que paso es que no hubo con que medir.
    expect(v.nota).not.toBe('0,00')
    expect(v.cumplimiento).toBeNull()
    expect(v.concepto).toBeNull()
  })

  it('se explica, con las jornadas que si hubo', () => {
    expect(v.explicacionSinMuestra).toContain('no existe información suficiente')
    expect(v.explicacionSinMuestra).toContain('5 jornadas')
    expect(v.explicacionSinMuestra).toContain('agosto de 2026')
  })

  it('se aclara que no es un reproche', () => {
    expect(v.explicacionSinMuestra).toContain('No es una nota baja')
  })

  it('con una sola jornada el texto queda en singular', () => {
    const u = vistaDeEvaluacion(fila({
      datos_insuficientes: true, nota_final: null, contexto: { jornadas: 1 },
    }))
    expect(u.explicacionSinMuestra).toContain('1 jornada,')
  })

  it('nota_final nula alcanza, aunque la fila no venga marcada', () => {
    expect(vistaDeEvaluacion(fila({ nota_final: null })).sinMuestra).toBe(true)
  })
})

// ── Las capas no se confunden ───────────────────────────────────────────────

describe('la nota es la nota y el cumplimiento es otra cosa', () => {
  const v = vistaDeEvaluacion(fila())

  it('la calificacion es nota_final, sobre 10', () => {
    expect(v.nota).toBe('8,78')
  })

  it('el ponderado va aparte, en porcentaje, y no vale como nota', () => {
    expect(v.cumplimiento).toBe('97,1')
    expect(v.cumplimiento).not.toBe(v.nota)
  })

  it('las dimensiones que pesan se ordenan por peso', () => {
    expect(v.dimensiones.map(d => d.etiqueta)).toEqual(['Rondas', 'Puntualidad'])
    expect(v.dimensiones[0].peso).toBe(35)
  })

  it('lo que no pesa se nombra aparte, no se esconde', () => {
    expect(v.informativas).toEqual(['Calidad de las fotos'])
  })
})

// ── El tope se nombra solo cuando hizo algo ─────────────────────────────────

describe('un tope que no bajo la nota no se presenta como tope', () => {
  it('PIÑERO: el tope si aplico y se explica con el numero de antes', () => {
    const v = vistaDeEvaluacion(fila({
      indice: 5.05, nota_final: 4, concepto: 'Aplazado',
      faltas: [{ clave: 'rondas_incumplidas', tope: 4, hecho: 'Realizó 19 de 52 rondas exigibles' }],
    }))
    expect(v.topeAplicado).not.toBeNull()
    expect(v.topeAplicado!.texto).toContain('limitada a 4,00')
    expect(v.topeAplicado!.texto).toContain('habría sido 5,05')
    expect(v.topeAplicado!.hecho).toContain('19 de 52')
  })

  it('OYOLA: la falta existe pero el indice ya venia por debajo del tope', () => {
    const v = vistaDeEvaluacion(fila({
      indice: 4.03, nota_final: 4.03, concepto: 'Aplazado',
      faltas: [{ clave: 'rondas_incumplidas', tope: 6, hecho: 'Realizó 0 de 9 rondas exigibles' }],
    }))
    // Decir "tu nota quedo limitada a 6" con una nota de 4,03 seria falso.
    expect(v.topeAplicado).toBeNull()
    expect(v.aTenerEnCuenta).toEqual(['Realizó 0 de 9 rondas exigibles'])
  })

  it('sin faltas no hay ni tope ni advertencias', () => {
    const v = vistaDeEvaluacion(fila())
    expect(v.topeAplicado).toBeNull()
    expect(v.aTenerEnCuenta).toEqual([])
  })
})

// ── La evaluación parcial se avisa ──────────────────────────────────────────

describe('una evaluacion parcial dice que es parcial', () => {
  it('avisa con el porcentaje que se pudo medir', () => {
    const v = vistaDeEvaluacion(fila({
      alcance: 'parcial', cobertura: 53.5, nota_final: 3.89, indice: 3.89,
    }))
    expect(v.avisoDeCobertura).toContain('53,5 %')
    expect(v.avisoDeCobertura).toContain('parcial')
  })

  it('una integral no inventa el aviso', () => {
    expect(vistaDeEvaluacion(fila()).avisoDeCobertura).toBeNull()
  })
})

// ── El balance, separado en lo que salio bien y lo que no ───────────────────

describe('el balance se parte en dos', () => {
  const v = vistaDeEvaluacion(fila())

  it('lo que salio bien', () => {
    expect(v.loQueSalioBien.map(b => b.etiqueta)).toEqual(['Asistencia'])
  })

  it('lo que conviene mejorar viene con una accion concreta', () => {
    expect(v.loQueConvieneMejorar).toHaveLength(1)
    expect(v.loQueConvieneMejorar[0].recomendacion).toContain('Iniciá la ronda')
  })

  it('lo que no le correspondia no aparece en ninguna de las dos', () => {
    const todas = [...v.loQueSalioBien, ...v.loQueConvieneMejorar].map(b => b.etiqueta)
    expect(todas).not.toContain('Libro')
  })
})

// ── Nada de esto puede romperse con datos incompletos ───────────────────────

describe('una fila incompleta no rompe la pantalla', () => {
  it('sin balance, sin dimensiones y sin faltas', () => {
    const v = vistaDeEvaluacion(fila({ balance: null, dimensiones: null, faltas: null }))
    expect(v.dimensiones).toEqual([])
    expect(v.loQueSalioBien).toEqual([])
    expect(v.encabezadoDelBalance).toBeNull()
    expect(v.nota).toBe('8,78')
  })
})

describe('el periodo se escribe en castellano', () => {
  it('2026-08 es agosto de 2026', () => {
    expect(etiquetaDePeriodo('2026-08')).toBe('agosto de 2026')
  })
  it('un periodo raro no rompe', () => {
    expect(etiquetaDePeriodo('nada')).toBe('nada')
  })
})
