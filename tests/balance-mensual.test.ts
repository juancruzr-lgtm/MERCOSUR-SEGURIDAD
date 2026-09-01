import { describe, expect, it } from 'vitest'
import {
  GRUPO_DE, MINIMO_JORNADAS_BALANCE, balanceATexto, bloqueAmerita, causaPrincipal,
  generarBalance, mesEnPalabras,
  resumenBalance,
} from '@/lib/balance-mensual'
import type { EntradaBalance } from '@/lib/balance-mensual'
import { ETIQUETA_DIMENSION, PESOS } from '@/lib/cumplimiento'
import type { ClaveDimension, Dimension, EstadoDimension } from '@/lib/cumplimiento'

// El balance es devolución operativa, NO la evaluación administrativa. Lo que
// se fija acá es sobre todo lo que NUNCA debe aparecer: una nota, un puesto,
// una comparación, o un juicio sobre algo que no se midió.

const dims = (estados: Partial<Record<ClaveDimension, EstadoDimension>> = {}): Dimension[] =>
  (Object.keys(PESOS) as ClaveDimension[]).map(clave => ({
    clave, etiqueta: ETIQUETA_DIMENSION[clave], nota: null, peso: PESOS[clave],
    estado: estados[clave] ?? 'puntuable', detalle: '',
  }))

const base = (over: any = {}) => ({
  puntaje: null, estado: 'medible', asistencia: null, procedimiento: null,
  observacionesValidas: 20, jornadasAplicables: 20, cobertura: 1,
  datosInsuficientes: false, ausencias: 0, sinEvidencia: 0,
  incidencias: { sin_registro_propio: 0, entrada_sin_salida: 0, salida_automatica: 0 },
  ...over,
})

const punt = (over: any = {}) => ({
  puntuales: 20, impuntuales: 0, sinDato: 0, evaluadas: 20,
  porBanda: { puntual: 20, leve: 0, tardanza: 0, importante: 0, grave: 0 },
  promedioTarde: null, maximo: null, nota: null, tardanzas: [],
  ...over,
})

const rondas = (over: any = {}) => ({
  estado: 'medible',
  medicion: { requeridos: 48, validos: 48, cumplidos: 48, incidencias: 0, excluidos: 0, exclusiones: [], estado: 'medible', nota: 10, bloquea: false, rango: { piso: 10, techo: 10 } },
  atribuibles: 48, cumplidas: 48, noRealizadas: 0, excluidas: 0, saneadas: 0,
  bajoPausa: 0, pausaAtribuible: 0, pausaNoAtribuible: 0, pausaCapacitacion: 0,
  pausaSinClasificar: 0, motivosPausa: {}, causasPausa: {},
  porcentaje: 100, nota: 10, enValidacion: false,
  turnosConObligacion: 9, turnosConAtribuibles: 9,
  turnosConIncumplimiento: 0, turnosSinIncumplimiento: 9,
  ...over,
})

const evidencia = (over: any = {}) => ({
  total: 10, sinObservaciones: 10, observadasPendientes: 0, confirmadas: 0,
  descartadas: 0, saneadas: 0, noEvaluables: 0,
  medicion: { requeridos: 10, validos: 10, cumplidos: 10, incidencias: 0, excluidos: 0, exclusiones: [], estado: 'medible', nota: 10, bloquea: false, rango: { piso: 10, techo: 10 } },
  nota: 10, enValidacion: false,
  ...over,
})

const entrada = (over: Partial<EntradaBalance> = {}): EntradaBalance => ({
  empleadoId: 'e1', periodo: '2026-08', turnosTrabajados: 20,
  dimensiones: dims(), base: base() as any, puntualidad: punt() as any,
  rondas: rondas() as any, uniforme: evidencia() as any, libro: evidencia() as any,
  calidad: null,
  ...over,
})

/** Todo el texto que vería el vigilador, en un solo string. */
const textoCompleto = (e: EntradaBalance) => balanceATexto(generarBalance(e))

// ── Lo que NUNCA puede aparecer ─────────────────────────────────────────────

describe('el balance no publica la evaluación administrativa', () => {
  const casos: Array<[string, EntradaBalance]> = [
    ['todo bien', entrada()],
    ['todo mal', entrada({
      base: base({ ausencias: 4, incidencias: { sin_registro_propio: 6, entrada_sin_salida: 3, salida_automatica: 0 } }) as any,
      puntualidad: punt({ impuntuales: 9, puntuales: 11, porBanda: { puntual: 11, leve: 3, tardanza: 3, importante: 0, grave: 3 } }) as any,
      rondas: rondas({ cumplidas: 0, medicion: { ...rondas().medicion, cumplidos: 0, incidencias: 48 }, porcentaje: 0, turnosConIncumplimiento: 9 }) as any,
      uniforme: evidencia({ confirmadas: 4 }) as any,
      libro: evidencia({ confirmadas: 2 }) as any,
      calidad: evidencia({ noEvaluables: 3, total: 10 }) as any,
    })],
    ['parcial', entrada({ dimensiones: dims({ rondas: 'no_aplica', uniforme: 'datos_insuficientes' }), rondas: null, uniforme: null })],
  ]

  it.each(casos)('%s: no aparece ninguna nota sobre 10', (_n, e) => {
    const t = textoCompleto(e)
    // Notación de nota: la barra. "3 de 10 fotos" es un conteo legítimo y no
    // puede prohibirse — la primera versión de este test lo prohibía y habría
    // obligado a redactar peor los hechos para pasar el guard.
    expect(t).not.toMatch(/\d+([.,]\d+)?\s*\/\s*10\b/)
    expect(t).not.toMatch(/\bnota\b/i)
    expect(t).not.toMatch(/\bpuntaje\b|\bpuntuación\b|\bcalificaci/i)
    expect(t).not.toMatch(/de 10 puntos|escala de/i)
  })

  it.each(casos)('%s: no aparece ningún concepto de la escala', (_n, e) => {
    const t = textoCompleto(e)
    expect(t).not.toMatch(/sobresaliente|excelente|muy bueno|aprobado|insuficiente|aplazado|desaprobad/i)
  })

  it.each(casos)('%s: no hay ranking ni comparación con nadie', (_n, e) => {
    const t = textoCompleto(e)
    expect(t).not.toMatch(/ranking|puesto n|posici[óo]n|promedio del equipo|otros vigiladores|tus compa/i)
    expect(t).not.toMatch(/mejor que|peor que|por debajo de|por encima de/i)
  })

  it.each(casos)('%s: no hay lenguaje disciplinario', (_n, e) => {
    const t = textoCompleto(e)
    expect(t).not.toMatch(/sanci[óo]n|apercibimiento|negligen|abandon|dormid|incumplid[oa]r|grave falta/i)
  })

  it('la entrada no acepta la Evaluación: la nota no puede llegar hasta acá', () => {
    // Garantía estructural, no de disciplina. Si alguien quisiera mostrar la
    // nota tendría que cambiar la firma de EntradaBalance.
    const claves = Object.keys(entrada())
    expect(claves).not.toContain('evaluacion')
    expect(claves).not.toContain('notaFinal')
    expect(claves).not.toContain('concepto')
  })
})

// ── Privacidad ──────────────────────────────────────────────────────────────

describe('cada balance sólo habla de su dueño', () => {
  it('no menciona a ninguna otra persona', () => {
    const t = textoCompleto(entrada())
    // Los únicos nombres propios que podrían entrar vendrían de los datos, y
    // el generador no recibe ninguno de otro empleado.
    expect(t).not.toMatch(/\bOYOLA\b|\bGOMEZ\b|\bBENITEZ\b/i)
  })

  it('el balance lleva el id de su dueño y ningún otro', () => {
    const b = generarBalance(entrada({ empleadoId: 'e-propio' }))
    expect(b.empleadoId).toBe('e-propio')
    expect(JSON.stringify(b)).not.toContain('e-ajeno')
  })
})

// ── Los tres grupos ─────────────────────────────────────────────────────────

describe('servicio y app no se mezclan', () => {
  it('el registro en la app es su propio grupo', () => {
    expect(GRUPO_DE.procedimiento).toBe('app')
    expect(GRUPO_DE.asistencia).toBe('servicio')
    expect(GRUPO_DE.rondas).toBe('servicio')
  })

  it('quien presta bien el servicio y usa mal la app lo ve separado', () => {
    const e = entrada({
      base: base({ incidencias: { sin_registro_propio: 5, entrada_sin_salida: 0, salida_automatica: 0 } }) as any,
    })
    const b = generarBalance(e)
    const app = b.bloques.find(x => x.grupo === 'app')!
    const servicio = b.bloques.filter(x => x.grupo === 'servicio')

    expect(app.estado).toBe('mejorar')
    expect(servicio.every(x => x.estado !== 'mejorar')).toBe(true)
    // Y se dice explícitamente que no se le cuestiona el servicio.
    expect(app.recomendacion).toContain('no cuestiona que hayas cubierto el servicio')
  })

  it('el texto rotula los grupos', () => {
    const t = textoCompleto(entrada())
    expect(t).toContain('PRESTACIÓN DEL SERVICIO')
    expect(t).toContain('USO DE LA APLICACIÓN')
  })
})

// ── No inventar evaluaciones ────────────────────────────────────────────────

describe('lo que no se midió no se juzga', () => {
  it('uniforme sin datos no dice ni bien ni mal', () => {
    const b = generarBalance(entrada({
      dimensiones: dims({ uniforme: 'datos_insuficientes' }),
      uniforme: evidencia({ total: 2, medicion: { ...evidencia().medicion, validos: 0 } }) as any,
    }))
    const u = b.bloques.find(x => x.clave === 'uniforme')!
    expect(u.estado).toBe('sin_datos')
    expect(u.hechos[0]).toContain('No hubo información suficiente')
    expect(u.recomendacion).toBeUndefined()
  })

  it('rondas que no aplican no se presentan como incumplimiento', () => {
    const b = generarBalance(entrada({ dimensiones: dims({ rondas: 'no_aplica' }), rondas: null }))
    const r = b.bloques.find(x => x.clave === 'rondas')!
    expect(r.estado).toBe('no_aplica')
    expect(r.hechos[0]).toContain('no tuviste puestos con rondas asignadas')
    expect(r.recomendacion).toBeUndefined()
  })

  it('sin ingreso propio no se afirma nada sobre la hora de llegada', () => {
    const b = generarBalance(entrada({ puntualidad: punt({ evaluadas: 0, puntuales: 0, sinDato: 20 }) as any }))
    const p = b.bloques.find(x => x.clave === 'puntualidad')!
    expect(p.estado).toBe('sin_datos')
    expect(p.hechos[0]).toContain('no se pudo evaluar')
  })

  it('rondas con todo pausado dice que no hubo nada que hacer distinto', () => {
    const b = generarBalance(entrada({
      rondas: rondas({
        medicion: { ...rondas().medicion, validos: 0, cumplidos: 0, requeridos: 16, excluidos: 16 },
        cumplidas: 0, turnosConObligacion: 1, turnosConAtribuibles: 0, turnosConIncumplimiento: 0,
      }) as any,
    }))
    const r = b.bloques.find(x => x.clave === 'rondas')!
    expect(r.estado).toBe('sin_datos')
    expect(r.hechos[0]).toContain('nada que puedas haber hecho distinto')
  })

  it('cuando algo no se pudo medir, el balance lo dice', () => {
    const b = generarBalance(entrada({
      dimensiones: dims({ uniforme: 'datos_insuficientes' }),
      uniforme: evidencia({ total: 2, medicion: { ...evidencia().medicion, validos: 0 } }) as any,
    }))
    expect(b.notaDeCobertura).toContain('no pudo medirse')
    expect(b.notaDeCobertura).toContain('únicamente lo que sí se midió')
  })

  it('con todo medido no se agrega ninguna advertencia de cobertura', () => {
    expect(generarBalance(entrada()).notaDeCobertura).toBeNull()
  })
})

// ── El caso que motivó el Modelo C ──────────────────────────────────────────

describe('rondas: un episodio no se cuenta como el mes entero', () => {
  /** 23 turnos trabajados, obligación en 1, 9 atribuibles, 0 realizadas. */
  const caso = entrada({
    turnosTrabajados: 23,
    base: base({ observacionesValidas: 23, jornadasAplicables: 23 }) as any,
    puntualidad: punt({ evaluadas: 23, puntuales: 23, porBanda: { puntual: 23, leve: 0, tardanza: 0, importante: 0, grave: 0 } }) as any,
    rondas: rondas({
      medicion: { ...rondas().medicion, requeridos: 16, validos: 9, cumplidos: 0, incidencias: 9, excluidos: 7 },
      atribuibles: 9, cumplidas: 0, noRealizadas: 9, excluidas: 7, porcentaje: 0,
      turnosConObligacion: 1, turnosConAtribuibles: 1,
      turnosConIncumplimiento: 1, turnosSinIncumplimiento: 0,
    }) as any,
  })

  it('dice sobre cuántos turnos se lo midió', () => {
    const r = generarBalance(caso).bloques.find(x => x.clave === 'rondas')!
    const t = r.hechos.join(' ')
    expect(t).toContain('9 rondas exigibles')
    expect(t).toContain('no se registró ninguna como realizada')
    expect(t).toContain('repartida en 1 de los 23 turnos que trabajaste')
  })

  it('lo nombra como episodio dentro de la muestra', () => {
    const r = generarBalance(caso).bloques.find(x => x.clave === 'rondas')!
    expect(r.hechos.join(' ')).toContain('episodio dentro de la muestra disponible')
  })

  it('NO dice que incumplió las rondas de todo el mes', () => {
    const t = textoCompleto(caso)
    expect(t).not.toMatch(/durante todo (el mes|agosto)/i)
    expect(t).not.toMatch(/nunca (hiciste|realizaste)/i)
  })

  it('y aun así hay una recomendación concreta: no se lo absuelve', () => {
    const r = generarBalance(caso).bloques.find(x => x.clave === 'rondas')!
    expect(r.estado).toBe('mejorar')
    expect(r.recomendacion).toContain('iniciá el recorrido desde la aplicación')
  })
})

// ── Reconocer lo que estuvo bien ────────────────────────────────────────────

describe('también se dice lo que salió bien, cuando los datos lo permiten', () => {
  it('asistencia completa', () => {
    const a = generarBalance(entrada()).bloques.find(x => x.clave === 'asistencia')!
    expect(a.estado).toBe('bien')
    expect(a.hechos[0]).toContain('Cubriste las 20 jornadas evaluadas')
  })

  it('rondas completas', () => {
    const r = generarBalance(entrada()).bloques.find(x => x.clave === 'rondas')!
    expect(r.estado).toBe('bien')
    expect(r.hechos[0]).toContain('registraste 48 como realizadas')
  })

  it('registro en la app completo', () => {
    const p = generarBalance(entrada()).bloques.find(x => x.clave === 'procedimiento')!
    expect(p.estado).toBe('bien')
  })

  it('pero no se felicita por lo que no se midió', () => {
    const b = generarBalance(entrada({
      dimensiones: dims({ uniforme: 'datos_insuficientes' }),
      uniforme: evidencia({ total: 0 }) as any,
    }))
    expect(b.bloques.find(x => x.clave === 'uniforme')!.estado).not.toBe('bien')
  })

  it('la calidad de las fotos no genera felicitación: sólo aparece si hay algo que decir', () => {
    expect(generarBalance(entrada()).bloques.find(x => x.clave === 'evidencias')).toBeUndefined()
  })
})

// ── Una recomendación por dimensión, y sólo donde hace falta ────────────────

describe('acciones concretas', () => {
  it('cada bloque a mejorar trae exactamente una recomendación', () => {
    const b = generarBalance(entrada({
      base: base({ ausencias: 2, incidencias: { sin_registro_propio: 4, entrada_sin_salida: 1, salida_automatica: 0 } }) as any,
      puntualidad: punt({ impuntuales: 5, puntuales: 15 }) as any,
    }))
    for (const bl of b.bloques) {
      if (bl.estado === 'mejorar') expect(typeof bl.recomendacion).toBe('string')
      else expect(bl.recomendacion).toBeUndefined()
    }
  })

  it('los bloques en verde no traen instrucciones', () => {
    const b = generarBalance(entrada())
    expect(b.bloques.filter(x => x.recomendacion).length).toBe(0)
    expect(balanceATexto(b)).not.toContain('PARA MEJORAR')
  })
})

// ── Cuándo NO corresponde ───────────────────────────────────────────────────

describe('cuándo no se manda', () => {
  it('con menos jornadas que el mínimo no corresponde', () => {
    const b = generarBalance(entrada({
      base: base({ observacionesValidas: 2, jornadasAplicables: 2 }) as any,
      turnosTrabajados: 2,
    }))
    expect(b.disponible).toBe(false)
    expect(b.motivoSiNoDisponible).toContain('2 jornadas evaluadas')
    expect(MINIMO_JORNADAS_BALANCE).toBe(3)
  })

  it('sin ninguna dimensión evaluable tampoco', () => {
    const b = generarBalance(entrada({
      dimensiones: dims({ rondas: 'no_aplica', uniforme: 'no_aplica', libro_guardia: 'no_aplica' }),
      base: base({ observacionesValidas: 0, jornadasAplicables: 0 }) as any,
      puntualidad: punt({ evaluadas: 0, puntuales: 0 }) as any,
      rondas: null, uniforme: null, libro: null,
    }))
    expect(b.disponible).toBe(false)
  })

  it('con muestra suficiente sí corresponde', () => {
    expect(generarBalance(entrada()).disponible).toBe(true)
  })
})

// ── Formato ─────────────────────────────────────────────────────────────────

describe('el texto', () => {
  it('empieza nombrando el período y los turnos', () => {
    expect(textoCompleto(entrada())).toMatch(/^Durante agosto de 2026 trabajaste 20 turnos\./)
  })

  it('un solo turno va en singular', () => {
    expect(mesEnPalabras('2026-09')).toBe('septiembre de 2026')
    const t = textoCompleto(entrada({ turnosTrabajados: 1 }))
    expect(t).toContain('trabajaste 1 turno.')
  })

  it('un período ilegible no rompe nada', () => {
    expect(mesEnPalabras('cualquiera')).toBe('cualquiera')
  })

  it('resumenBalance cuenta los bloques por estado', () => {
    const r = resumenBalance(generarBalance(entrada()))
    expect(r.bien + r.mejorar + r.sinDatos + r.noAplica).toBeGreaterThan(0)
    expect(r.mejorar).toBe(0)
  })
})

// ── Los números que no se explican solos ────────────────────────────────────
//
// "Se evaluaron 9" cuando había 16 programadas, o "3 de 7 turnos" cuando la
// obligación estuvo en 16, dejan una pregunta abierta. La respuesta favorece a
// la persona —esas rondas no se le cobran— así que callarla es peor.

describe('el balance explica por qué se lo mide sobre menos', () => {
  const conExclusiones = entrada({
    turnosTrabajados: 23,
    base: base({ observacionesValidas: 23, jornadasAplicables: 23 }) as any,
    puntualidad: punt({ evaluadas: 23, puntuales: 23, porBanda: { puntual: 23, leve: 0, tardanza: 0, importante: 0, grave: 0 } }) as any,
    rondas: rondas({
      medicion: { ...rondas().medicion, requeridos: 16, validos: 9, cumplidos: 0, incidencias: 9, excluidos: 7 },
      atribuibles: 9, cumplidas: 0, porcentaje: 0,
      turnosConObligacion: 1, turnosConAtribuibles: 1,
      turnosConIncumplimiento: 1, turnosSinIncumplimiento: 0,
    }) as any,
  })

  it('dice qué pasó con las rondas que quedaron fuera', () => {
    const r = generarBalance(conExclusiones).bloques.find(x => x.clave === 'rondas')!
    const t = r.hechos.join(' ')
    expect(t).toContain('Otras 7 quedaron fuera de la evaluación')
    expect(t).toContain('no cuentan ni a favor ni en contra')
  })

  it('explica el salto entre turnos con obligación y turnos evaluados', () => {
    const r = generarBalance(entrada({
      turnosTrabajados: 24,
      rondas: rondas({
        medicion: { ...rondas().medicion, requeridos: 216, validos: 52, cumplidos: 19, incidencias: 33, excluidos: 164 },
        atribuibles: 52, cumplidas: 19, porcentaje: 37,
        turnosConObligacion: 16, turnosConAtribuibles: 7,
        turnosConIncumplimiento: 3, turnosSinIncumplimiento: 4,
      }) as any,
    })).bloques.find(x => x.clave === 'rondas')!
    expect(r.hechos.join(' ')).toContain('En los otros 9 turnos las rondas estuvieron pausadas y no se evaluaron.')
  })

  it('sin exclusiones no agrega ninguna aclaración de más', () => {
    const r = generarBalance(entrada({
      rondas: rondas({
        medicion: { ...rondas().medicion, requeridos: 48, validos: 48, cumplidos: 40, incidencias: 8, excluidos: 0 },
        cumplidas: 40, turnosConIncumplimiento: 3,
      }) as any,
    })).bloques.find(x => x.clave === 'rondas')!
    expect(r.hechos.join(' ')).not.toContain('quedaron fuera de la evaluación')
    expect(r.hechos.join(' ')).not.toContain('estuvieron pausadas y no')
  })

  it('un solo turno fuera se dice en singular', () => {
    const r = generarBalance(entrada({
      rondas: rondas({
        medicion: { ...rondas().medicion, requeridos: 48, validos: 40, cumplidos: 30, incidencias: 10, excluidos: 8 },
        cumplidas: 30, turnosConObligacion: 9, turnosConAtribuibles: 8, turnosConIncumplimiento: 2,
      }) as any,
    })).bloques.find(x => x.clave === 'rondas')!
    expect(r.hechos.join(' ')).toContain('En el otro turno las rondas estuvieron pausadas')
  })
})

// ── Denominadores distintos ─────────────────────────────────────────────────
//
// El caso: 10 turnos trabajados, Puntualidad dice 8, Registro dice 10. Las dos
// cifras son correctas y juntas parecen una inconsistencia.

describe('cuando una dimensión mide sobre menos jornadas, se explica', () => {
  const conMenos = entrada({
    turnosTrabajados: 10,
    base: base({ observacionesValidas: 10, jornadasAplicables: 10 }) as any,
    puntualidad: punt({ evaluadas: 8, puntuales: 6, impuntuales: 2, sinDato: 2,
      porBanda: { puntual: 6, leve: 2, tardanza: 0, importante: 0, grave: 0 } }) as any,
  })

  it('Puntualidad dice por qué mide sobre 8 y no sobre 10', () => {
    const p = generarBalance(conMenos).bloques.find(x => x.clave === 'puntualidad')!
    expect(p.hechos.join(' ')).toContain('2 de 8 jornadas evaluadas')
    expect(p.hechos.join(' ')).toContain('Puntualidad se mide en las jornadas donde hubo un ingreso propio registrado.')
  })

  it('la explicación también aparece cuando llegó bien a todas', () => {
    const p = generarBalance(entrada({
      base: base({ observacionesValidas: 10 }) as any,
      puntualidad: punt({ evaluadas: 8, puntuales: 8, sinDato: 2, porBanda: { puntual: 8, leve: 0, tardanza: 0, importante: 0, grave: 0 } }) as any,
    })).bloques.find(x => x.clave === 'puntualidad')!
    expect(p.estado).toBe('bien')
    expect(p.hechos.join(' ')).toContain('ingreso propio registrado')
  })

  it('con los denominadores iguales NO se agrega la aclaración', () => {
    const p = generarBalance(entrada()).bloques.find(x => x.clave === 'puntualidad')!
    expect(p.hechos.join(' ')).not.toContain('ingreso propio registrado')
  })

  it('el registro en la app sigue midiendo sobre el total, sin contradicción', () => {
    const b = generarBalance(conMenos)
    const reg = b.bloques.find(x => x.clave === 'procedimiento')!
    expect(reg.hechos.join(' ')).toContain('10 jornadas')
    // Y el texto completo explica el porqué de la diferencia.
    expect(balanceATexto(b)).toContain('ingreso propio registrado')
  })
})

// ── Cobertura insuficiente: la nota y el balance dicen lo mismo ─────────────
//
// Caso real de agosto 2026: 29 jornadas, 20 sin registro propio. Con 31 % de
// cobertura la nota deja Puntualidad fuera del cálculo —`puntualidadEsSostenible`,
// REGLA 2 de `calcularCumplimiento`— y la dimensión llega como `sin_datos`.
//
// El balance la juzgaba igual sobre las 9 medibles. Eso castigaba dos veces el
// mismo hecho —no fichar ya se penaliza en Registro en la app— y partía la
// pantalla: el gráfico decía "Sin datos" y el renglón decía "Puntualidad".

describe('debajo de la cobertura mínima, Puntualidad no se juzga', () => {
  const rosón = entrada({
    turnosTrabajados: 29,
    dimensiones: dims({ puntualidad: 'sin_datos', rondas: 'no_aplica' }),
    rondas: null,
    base: base({
      observacionesValidas: 29, jornadasAplicables: 29,
      incidencias: { sin_registro_propio: 20, entrada_sin_salida: 0, salida_automatica: 0 },
    }) as any,
    puntualidad: punt({ evaluadas: 9, puntuales: 6, impuntuales: 3, sinDato: 20,
      porBanda: { puntual: 6, leve: 1, tardanza: 1, importante: 0, grave: 1 } }) as any,
  })

  it('el bloque queda sin datos, no en "mejorar"', () => {
    const p = generarBalance(rosón).bloques.find(x => x.clave === 'puntualidad')!
    expect(p.estado).toBe('sin_datos')
    expect(bloqueAmerita(p)).toBe(false)
  })

  it('dice cuántas se pudieron medir y a dónde va lo que falta', () => {
    const p = generarBalance(rosón).bloques.find(x => x.clave === 'puntualidad')!
    expect(p.hechos.join(' ')).toContain('Solo 9 de 29 jornadas')
    expect(p.hechos.join(' ')).toContain('Registro en la app')
  })

  it('no acusa: sin incidencias ni recomendación sobre la hora de llegada', () => {
    const p = generarBalance(rosón).bloques.find(x => x.clave === 'puntualidad')!
    expect(p.incidencias).toBeUndefined()
    expect(p.recomendacion).toBeUndefined()
  })

  it('la causa y el tipo de devolución son sólo del uso de la app', () => {
    const b = generarBalance(rosón)
    expect(causaPrincipal(b)).not.toContain('Puntualidad')
    expect(b.tipoDevolucion).toBe('uso_app')
  })

  it('con cobertura suficiente sí se sigue juzgando', () => {
    const b = generarBalance(entrada({
      turnosTrabajados: 29,
      base: base({ observacionesValidas: 29, jornadasAplicables: 29 }) as any,
      puntualidad: punt({ evaluadas: 20, puntuales: 17, impuntuales: 3, sinDato: 9,
        porBanda: { puntual: 17, leve: 1, tardanza: 1, importante: 0, grave: 1 } }) as any,
    }))
    const p = b.bloques.find(x => x.clave === 'puntualidad')!
    expect(p.estado).toBe('mejorar')
    expect(causaPrincipal(b)).toContain('Puntualidad')
  })
})

// ── Balance disponible ≠ mensaje del Entrenador ─────────────────────────────

describe('tener balance y recibir un mensaje son cosas distintas', () => {
  it('quien cumplió todo tiene balance y NO es candidato', () => {
    const b = generarBalance(entrada())
    expect(b.disponible).toBe(true)
    expect(b.candidatoEntrenador).toBe(false)
    expect(b.motivoEntrenador).toBeNull()
    expect(b.tipoDevolucion).toBe('sin_intervencion')
  })

  it('no se inventa una recomendación para justificar un envío', () => {
    const b = generarBalance(entrada())
    expect(b.bloques.filter(x => x.recomendacion).length).toBe(0)
  })

  it('muestra insuficiente: ni balance ni mensaje', () => {
    const b = generarBalance(entrada({ base: base({ observacionesValidas: 2 }) as any }))
    expect(b.disponible).toBe(false)
    expect(b.candidatoEntrenador).toBe(false)
    expect(b.tipoDevolucion).toBe('muestra_insuficiente')
  })

  it('el motivo nombra las dimensiones que lo hacen candidato', () => {
    const b = generarBalance(entrada({
      base: base({ ausencias: 2 }) as any,
      puntualidad: punt({ impuntuales: 4, puntuales: 16 }) as any,
    }))
    expect(b.candidatoEntrenador).toBe(true)
    expect(b.motivoEntrenador).toContain('Asistencia')
    expect(b.motivoEntrenador).toContain('Puntualidad')
  })
})

// ── App no es servicio ──────────────────────────────────────────────────────

describe('clasificación del tipo de devolución', () => {
  /** Asistió, fue puntual, cumplió las rondas — pero fichó mal. */
  it('sólo fichaje → Uso de la App, no problema de servicio', () => {
    const b = generarBalance(entrada({
      base: base({ incidencias: { sin_registro_propio: 5, entrada_sin_salida: 0, salida_automatica: 0 } }) as any,
    }))
    expect(b.tipoDevolucion).toBe('uso_app')
    expect(b.candidatoEntrenador).toBe(true)
    expect(b.bloques.filter(x => x.grupo === 'servicio' && x.estado === 'mejorar')).toHaveLength(0)
  })

  it('sólo rondas → Prestación del Servicio', () => {
    const b = generarBalance(entrada({
      rondas: rondas({
        medicion: { ...rondas().medicion, cumplidos: 20, incidencias: 28 },
        cumplidas: 20, turnosConIncumplimiento: 4,
      }) as any,
    }))
    expect(b.tipoDevolucion).toBe('prestacion_servicio')
  })

  it('rondas + fichaje → App + Servicio', () => {
    const b = generarBalance(entrada({
      base: base({ incidencias: { sin_registro_propio: 4, entrada_sin_salida: 0, salida_automatica: 0 } }) as any,
      rondas: rondas({
        medicion: { ...rondas().medicion, cumplidos: 20, incidencias: 28 },
        cumplidas: 20, turnosConIncumplimiento: 4,
      }) as any,
    }))
    expect(b.tipoDevolucion).toBe('app_y_servicio')
  })

  it('lo NO medible no cuenta como problema', () => {
    const b = generarBalance(entrada({
      dimensiones: dims({ rondas: 'no_aplica', uniforme: 'datos_insuficientes', libro_guardia: 'no_aplica' }),
      rondas: null, uniforme: null, libro: null,
    }))
    expect(b.tipoDevolucion).toBe('sin_intervencion')
    expect(b.candidatoEntrenador).toBe(false)
  })

  it('la calidad de la foto cuenta como uso de la app', () => {
    // Sacar la evidencia es usar la herramienta, no prestar el servicio.
    const b = generarBalance(entrada({ calidad: evidencia({ noEvaluables: 4, total: 10 }) as any }))
    expect(b.tipoDevolucion).toBe('uso_app')
  })
})

// ── Un hecho aislado no dispara un mensaje ──────────────────────────────────
//
// Se usa el MISMO umbral que ya aplica el Entrenador (`severidadDe`): una
// incidencia suelta es `aislada` y las aisladas no se notifican. Sin esto,
// cualquier tardanza única haría candidato a casi todo el mundo y la
// clasificación dejaría de servir para decidir a quién hablarle.

describe('el umbral para hablarle a alguien', () => {
  it('una tardanza en 26 jornadas se cuenta pero no amerita mensaje', () => {
    const b = generarBalance(entrada({
      turnosTrabajados: 29,
      base: base({ observacionesValidas: 29 }) as any,
      puntualidad: punt({ evaluadas: 26, puntuales: 25, impuntuales: 1, sinDato: 3,
        porBanda: { puntual: 25, leve: 1, tardanza: 0, importante: 0, grave: 0 } }) as any,
    }))
    // El hecho SÍ está en el balance: es cierto y no se esconde.
    expect(balanceATexto(b)).toContain('1 de 26 jornadas evaluadas')
    // Pero no lo convierte en candidato.
    expect(b.candidatoEntrenador).toBe(false)
    expect(b.tipoDevolucion).toBe('sin_intervencion')
  })

  it('dos ya son reincidencia y sí ameritan', () => {
    const b = generarBalance(entrada({
      puntualidad: punt({ evaluadas: 26, puntuales: 24, impuntuales: 2,
        porBanda: { puntual: 24, leve: 2, tardanza: 0, importante: 0, grave: 0 } }) as any,
    }))
    expect(b.candidatoEntrenador).toBe(true)
    expect(b.tipoDevolucion).toBe('prestacion_servicio')
  })

  it('una proporción alta amerita aunque sean pocas', () => {
    // 2 de 5 es el 40 %: patrón por proporción.
    const b = generarBalance(entrada({
      base: base({ observacionesValidas: 5, incidencias: { sin_registro_propio: 2, entrada_sin_salida: 0, salida_automatica: 0 } }) as any,
      puntualidad: punt({ evaluadas: 5, puntuales: 5 }) as any,
    }))
    expect(b.candidatoEntrenador).toBe(true)
    expect(b.tipoDevolucion).toBe('uso_app')
  })

  it('bloqueAmerita respeta el estado del bloque', () => {
    expect(bloqueAmerita({ clave: 'rondas', etiqueta: 'R', grupo: 'servicio', estado: 'bien', hechos: [] })).toBe(false)
    expect(bloqueAmerita({ clave: 'rondas', etiqueta: 'R', grupo: 'servicio', estado: 'sin_datos', hechos: [] })).toBe(false)
    expect(bloqueAmerita({ clave: 'rondas', etiqueta: 'R', grupo: 'servicio', estado: 'no_aplica', hechos: [] })).toBe(false)
  })

  it('sin conteos, un bloque a mejorar amerita: no se absuelve por falta de dato', () => {
    expect(bloqueAmerita({ clave: 'rondas', etiqueta: 'R', grupo: 'servicio', estado: 'mejorar', hechos: [] })).toBe(true)
  })
})

// ── La causa que se muestra en la fila ──────────────────────────────────────

describe('causa principal', () => {
  it('sin nada accionable no inventa una causa', () => {
    expect(causaPrincipal(generarBalance(entrada()))).toBe('Sin intervención')
  })

  it('sólo fichaje: la causa es el registro, no el servicio', () => {
    const b = generarBalance(entrada({
      base: base({ incidencias: { sin_registro_propio: 6, entrada_sin_salida: 0, salida_automatica: 0 } }) as any,
    }))
    expect(causaPrincipal(b)).toBe('Registro en la app')
  })

  it('sólo rondas', () => {
    const b = generarBalance(entrada({
      rondas: rondas({
        medicion: { ...rondas().medicion, cumplidos: 20, incidencias: 28 },
        cumplidas: 20, turnosConIncumplimiento: 4,
      }) as any,
    }))
    expect(causaPrincipal(b)).toBe('Rondas')
  })

  it('con dos causas las nombra a las dos', () => {
    const b = generarBalance(entrada({
      base: base({ incidencias: { sin_registro_propio: 8, entrada_sin_salida: 0, salida_automatica: 0 } }) as any,
      rondas: rondas({
        medicion: { ...rondas().medicion, cumplidos: 10, incidencias: 38 },
        cumplidas: 10, turnosConIncumplimiento: 6,
      }) as any,
    }))
    const c = causaPrincipal(b)
    expect(c).toContain('Rondas')
    expect(c).toContain('Registro en la app')
  })

  it('NO elige la dimensión con nota más baja si es un hecho aislado', () => {
    // Puntualidad 9,7 por UNA tardanza en 26 no es la causa de nadie.
    const b = generarBalance(entrada({
      base: base({ observacionesValidas: 26, incidencias: { sin_registro_propio: 5, entrada_sin_salida: 0, salida_automatica: 0 } }) as any,
      puntualidad: punt({ evaluadas: 26, puntuales: 25, impuntuales: 1,
        porBanda: { puntual: 25, leve: 1, tardanza: 0, importante: 0, grave: 0 } }) as any,
    }))
    expect(causaPrincipal(b)).toBe('Registro en la app')
    expect(causaPrincipal(b)).not.toContain('Puntualidad')
  })

  it('nombra como mucho dos: la fila no es el detalle', () => {
    const b = generarBalance(entrada({
      base: base({ ausencias: 4, incidencias: { sin_registro_propio: 8, entrada_sin_salida: 4, salida_automatica: 0 } }) as any,
      puntualidad: punt({ impuntuales: 9, puntuales: 11 }) as any,
      rondas: rondas({ medicion: { ...rondas().medicion, cumplidos: 0, incidencias: 48 }, cumplidas: 0, turnosConIncumplimiento: 9 }) as any,
    }))
    expect(causaPrincipal(b).split(' + ').length).toBeLessThanOrEqual(2)
  })

  it('con muestra insuficiente lo dice, no inventa una dimensión', () => {
    const b = generarBalance(entrada({ base: base({ observacionesValidas: 2 }) as any }))
    expect(causaPrincipal(b)).toBe('Muestra insuficiente')
  })
})

// ── El motor no se toca ─────────────────────────────────────────────────────
//
// La clasificación y el gráfico son PRESENTACIÓN. Si generar el balance
// cambiara una nota o un estado, la tabla y la ficha dirían cosas distintas de
// la misma persona.

describe('generar el balance no altera lo que recibe', () => {
  it('las dimensiones salen intactas', () => {
    const e = entrada()
    const antes = JSON.stringify(e.dimensiones)
    generarBalance(e)
    expect(JSON.stringify(e.dimensiones)).toBe(antes)
  })

  it('la base y la puntualidad tampoco cambian', () => {
    const e = entrada()
    const antes = JSON.stringify({ b: e.base, p: e.puntualidad })
    generarBalance(e)
    expect(JSON.stringify({ b: e.base, p: e.puntualidad })).toBe(antes)
  })

  it('los resúmenes de rondas y evidencias quedan igual', () => {
    const e = entrada()
    const antes = JSON.stringify({ r: e.rondas, u: e.uniforme, l: e.libro })
    generarBalance(e)
    expect(JSON.stringify({ r: e.rondas, u: e.uniforme, l: e.libro })).toBe(antes)
  })

  it('dos llamadas seguidas dan el mismo resultado', () => {
    const e = entrada()
    expect(JSON.stringify(generarBalance(e))).toBe(JSON.stringify(generarBalance(e)))
  })

  it('el balance no expone ninguna nota de dimensión', () => {
    // Las notas viven en `dimensiones`, que el balance lee pero no copia.
    const b = generarBalance(entrada())
    const json = JSON.stringify(b)
    expect(json).not.toContain('"nota"')
    expect(json).not.toContain('"peso"')
  })
})
