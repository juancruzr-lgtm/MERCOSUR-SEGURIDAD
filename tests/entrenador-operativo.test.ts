import { describe, expect, it } from 'vitest'
import {
  COOLDOWN_DIAS, ENVIO_POR_DEFECTO, PRIORIDAD, UMBRAL, clavePush,
  correspondeNotificar, ensenanzaPrioritaria, ensenanzasDeCumplimiento,
  esMomentoDeEnviar, evolucion, severidadDe,
} from '@/lib/entrenador-operativo'
import type { EntradaEntrenador, EnvioPrevio } from '@/lib/entrenador-operativo'

// El entrenador. Lo que se prueba: que no haga spam, que priorice, que respete
// el cooldown, que cada mensaje salga de hechos reales, y —lo más importante—
// que nunca le diga a alguien que llegó tarde cuando no sabemos a qué hora llegó.

const PERIODO = '2026-08'
const AHORA = new Date('2026-09-01T13:00:00Z')

const entrada = (o: Partial<EntradaEntrenador> = {}): EntradaEntrenador => ({
  periodo: PERIODO, ...o,
})

const soloDe = (e: EntradaEntrenador, clave: string) =>
  ensenanzasDeCumplimiento(e).find(x => x.clave === clave)

// ── 13. Una incidencia aislada no dispara nada ──────────────────────────────

describe('13. una incidencia aislada leve no genera spam', () => {
  it('una sola tardanza se registra pero no se notifica', () => {
    const e = soloDe(entrada({
      puntualidad: { impuntuales: 1, evaluadas: 22, horaInicio: '07:00', objetivo: 'PLANTA' },
    }), 'puntualidad')
    expect(e?.severidad).toBe('aislada')
    expect(e?.notificar).toBe(false)
    expect(correspondeNotificar(e!, [], AHORA)).toBe(false)
  })

  it('sin incidencias no hay ninguna enseñanza', () => {
    const todas = ensenanzasDeCumplimiento(entrada({
      asistencia: { ausencias: 0, jornadas: 22 },
      puntualidad: { impuntuales: 0, evaluadas: 22 },
      procedimiento: { incidencias: 0, jornadas: 22, sinRegistro: 0, entradaSinSalida: 0 },
      rondas: { incidencias: 0, requeridos: 30 },
    }))
    expect(todas).toHaveLength(0)
  })

  it('la aislada aparece igual en la lista: el supervisor la ve', () => {
    const todas = ensenanzasDeCumplimiento(entrada({
      rondas: { incidencias: 1, requeridos: 30 },
    }))
    expect(todas).toHaveLength(1)
    expect(todas[0].notificar).toBe(false)
  })
})

// ── 14. La reincidencia sí ──────────────────────────────────────────────────

describe('14. la reincidencia genera entrenamiento', () => {
  it('dos incidencias ya son reincidencia', () => {
    expect(severidadDe(2, 30)).toBe('reincidencia')
    expect(UMBRAL.reincidencia).toBe(2)
  })

  it('cuatro son patrón, sin mirar proporción', () => {
    expect(severidadDe(4, 100)).toBe('patron')
  })

  it('una proporción alta es patrón aunque sean pocas', () => {
    // 2 de 5 es el 40 %: no es un desliz, es cómo trabaja.
    expect(severidadDe(2, 5)).toBe('patron')
  })

  it('una proporción alta sobre una muestra ínfima NO se declara patrón', () => {
    // 2 de 3 es el 67 %, pero tres requerimientos no alcanzan para afirmar
    // que hay un patrón: sería una conclusión sobre casi nada.
    expect(severidadDe(2, 3)).toBe('reincidencia')
  })

  it('la reincidencia sí se notifica', () => {
    const e = soloDe(entrada({
      procedimiento: { incidencias: 2, jornadas: 20, sinRegistro: 2, entradaSinSalida: 0 },
    }), 'procedimiento_registro')
    expect(e?.severidad).toBe('reincidencia')
    expect(correspondeNotificar(e!, [], AHORA)).toBe(true)
  })
})

// ── 15. Cooldown ────────────────────────────────────────────────────────────

describe('15. el mismo entrenamiento respeta el cooldown', () => {
  const e = () => soloDe(entrada({
    rondas: { incidencias: 5, requeridos: 20 },
  }), 'rondas')!

  it('el mismo tipo y el mismo período no se manda dos veces', () => {
    const previos: EnvioPrevio[] = [
      { clave: 'rondas', periodo: PERIODO, enviadoEn: '2026-08-05T10:00:00Z' },
    ]
    expect(correspondeNotificar(e(), previos, AHORA)).toBe(false)
  })

  it('otro período, pero dentro del cooldown, tampoco', () => {
    const previos: EnvioPrevio[] = [
      { clave: 'rondas', periodo: '2026-07', enviadoEn: '2026-08-25T10:00:00Z' },
    ]
    // 14 días de cooldown para un patrón; del 25/08 al 01/09 van 7.
    expect(COOLDOWN_DIAS.patron).toBe(14)
    expect(correspondeNotificar(e(), previos, AHORA)).toBe(false)
  })

  it('pasado el cooldown vuelve a corresponder', () => {
    const previos: EnvioPrevio[] = [
      { clave: 'rondas', periodo: '2026-06', enviadoEn: '2026-07-01T10:00:00Z' },
    ]
    expect(correspondeNotificar(e(), previos, AHORA)).toBe(true)
  })

  it('el cooldown es por tipo: otro tema no lo bloquea', () => {
    const previos: EnvioPrevio[] = [
      { clave: 'uniforme', periodo: PERIODO, enviadoEn: '2026-08-30T10:00:00Z' },
    ]
    expect(correspondeNotificar(e(), previos, AHORA)).toBe(true)
  })

  it('la clave de push lleva el tipo y el período adentro', () => {
    expect(clavePush('rondas', PERIODO)).toBe('entrenamiento_operativo:rondas:2026-08')
  })
})

// ── 16. Prioridad ───────────────────────────────────────────────────────────

describe('16. varios problemas producen un solo mensaje', () => {
  const conTodo = entrada({
    asistencia: { ausencias: 3, jornadas: 20 },
    puntualidad: { impuntuales: 6, evaluadas: 20, horaInicio: '07:00', objetivo: 'PLANTA' },
    procedimiento: { incidencias: 5, jornadas: 20, sinRegistro: 3, entradaSinSalida: 2 },
    rondas: { incidencias: 8, requeridos: 20 },
    uniforme: { confirmadas: 4, revisadas: 12 },
    libroGuardia: { confirmadas: 3, revisadas: 12 },
    calidad: { noEvaluables: 5, total: 30 },
  })

  it('se generan todas, ordenadas por prioridad', () => {
    const todas = ensenanzasDeCumplimiento(conTodo)
    expect(todas.length).toBeGreaterThanOrEqual(7)
    const orden = todas.map(t => t.prioridad)
    expect(orden).toEqual([...orden].sort((a, b) => a - b))
    expect(todas[0].clave).toBe('asistencia')
  })

  it('pero sólo se manda UNA, la más prioritaria', () => {
    const elegida = ensenanzaPrioritaria(ensenanzasDeCumplimiento(conTodo), [], AHORA)
    expect(elegida?.clave).toBe('asistencia')
  })

  it('si la más prioritaria ya se mandó, sigue la próxima', () => {
    const previos: EnvioPrevio[] = [
      { clave: 'asistencia', periodo: PERIODO, enviadoEn: '2026-08-10T10:00:00Z' },
    ]
    const elegida = ensenanzaPrioritaria(ensenanzasDeCumplimiento(conTodo), previos, AHORA)
    expect(elegida?.clave).toBe('puntualidad')
  })

  it('el 1 queda libre: hay algo más grave que el sistema todavía no mide', () => {
    expect(Math.min(...Object.values(PRIORIDAD))).toBe(2)
  })
})

// ── 17-20. El mensaje sale de hechos reales ─────────────────────────────────

describe('17. el mensaje deriva de hechos, no de un texto fijo', () => {
  it('las rondas dicen cuántas de cuántas', () => {
    const e = soloDe(entrada({ rondas: { incidencias: 2, requeridos: 8 } }), 'rondas')
    expect(e?.texto).toContain('8 rondas requeridas')
    expect(e?.texto).toContain('quedaron 2 sin completar')
    expect(e?.hechos).toContain('2 de 8 rondas requeridas')
  })

  it('el singular no dice "quedaron 1"', () => {
    const e = soloDe(entrada({ rondas: { incidencias: 1, requeridos: 8 } }), 'rondas')
    expect(e?.texto).toContain('quedó 1 sin completar')
  })

  it('procedimiento distingue sin registro de entrada sin salida', () => {
    const e = soloDe(entrada({
      procedimiento: { incidencias: 5, jornadas: 20, sinRegistro: 3, entradaSinSalida: 2 },
    }), 'procedimiento_registro')
    expect(e?.motivo).toContain('3 jornadas trabajadas sin registro propio')
    expect(e?.motivo).toContain('2 entradas sin salida registrada')
    expect(e?.texto).toContain('5 de tus 20 jornadas')
  })

  it('ningún texto contiene el puntaje ni una categoría', () => {
    const todas = ensenanzasDeCumplimiento(entrada({
      asistencia: { ausencias: 3, jornadas: 20 },
      puntualidad: { impuntuales: 6, evaluadas: 20, horaInicio: '07:00' },
      rondas: { incidencias: 8, requeridos: 20 },
      uniforme: { confirmadas: 4, revisadas: 12 },
    }))
    for (const t of todas) {
      expect(t.texto).not.toMatch(/\/\s*10/)
      expect(t.texto.toLowerCase()).not.toContain('puntaje')
      expect(t.texto.toLowerCase()).not.toContain('excelente')
      expect(t.texto.toLowerCase()).not.toContain('requiere intervención')
    }
  })
})

describe('18. la IA sola no genera un mensaje acusatorio', () => {
  it('sin confirmaciones humanas no hay enseñanza de uniforme', () => {
    expect(soloDe(entrada({ uniforme: { confirmadas: 0, revisadas: 12 } }), 'uniforme')).toBeUndefined()
  })

  it('con confirmación humana sí, y dice cuántas de cuántas revisadas', () => {
    const e = soloDe(entrada({ uniforme: { confirmadas: 3, revisadas: 12 } }), 'uniforme')
    expect(e?.texto).toContain('3 de tus 12 evidencias revisadas')
    expect(e?.motivo).toContain('confirmada por una persona')
  })

  it('el libro no acusa: dice qué comprobar antes de sacar la foto', () => {
    const e = soloDe(entrada({ libroGuardia: { confirmadas: 3, revisadas: 10 } }), 'libro_guardia')
    expect(e?.texto).toContain('fecha')
    expect(e?.texto).toContain('firma')
  })
})

describe('19. el mensaje de puntualidad usa el horario real', () => {
  it('dice la hora del turno y desde cuándo puede fichar', () => {
    const e = soloDe(entrada({
      puntualidad: { impuntuales: 4, evaluadas: 20, horaInicio: '07:00', objetivo: 'PLANTA NORTE' },
    }), 'puntualidad')
    expect(e?.texto).toContain('comienza a las 07:00')
    expect(e?.texto).toContain('desde las 06:45')
    expect(e?.texto).toContain('PLANTA NORTE')
  })

  it('cruza la medianoche sin inventar una hora imposible', () => {
    const e = soloDe(entrada({
      puntualidad: { impuntuales: 4, evaluadas: 20, horaInicio: '00:10' },
    }), 'puntualidad')
    expect(e?.texto).toContain('desde las 23:55')
  })

  it('sin horario conocido no inventa uno', () => {
    const e = soloDe(entrada({
      puntualidad: { impuntuales: 4, evaluadas: 20, horaInicio: null },
    }), 'puntualidad')
    expect(e?.texto).not.toMatch(/\d{2}:\d{2}/)
    expect(e?.texto).toContain('15 minutos antes')
  })
})

describe('20. sin fichaje propio no se inventa "llegaste tarde"', () => {
  it('sin ingresos evaluables no hay enseñanza de puntualidad', () => {
    const e = soloDe(entrada({
      puntualidad: { impuntuales: 0, evaluadas: 0, horaInicio: '07:00' },
    }), 'puntualidad')
    expect(e).toBeUndefined()
  })

  it('aunque el resto del mes tenga incidencias, puntualidad calla', () => {
    const todas = ensenanzasDeCumplimiento(entrada({
      puntualidad: { impuntuales: 0, evaluadas: 0 },
      procedimiento: { incidencias: 12, jornadas: 12, sinRegistro: 12, entradaSinSalida: 0 },
    }))
    expect(todas.map(t => t.clave)).toEqual(['procedimiento_registro'])
  })
})

// ── Capacitación: enseñar sin acusar ────────────────────────────────────────

describe('la ronda pausada por falta de capacitación enseña y no acusa', () => {
  const e = () => ensenanzasDeCumplimiento(entrada({ rondasSinCapacitacion: 12 }))[0]

  it('genera enseñanza aunque no haya ninguna incidencia atribuible', () => {
    expect(e().clave).toBe('rondas')
    expect(e().incidencias).toBe(0)
    expect(e().notificar).toBe(true)
  })

  it('el texto le pide coordinar con el supervisor, no le reprocha nada', () => {
    expect(e().texto).toContain('falta enseñarte')
    expect(e().texto).toContain('supervisor')
  })
})

// ── El momento del envío ────────────────────────────────────────────────────

describe('nunca mientras está trabajando', () => {
  const base = { diaSemana: 1, horaLocal: '10:20', diaConfigurado: 1, horaConfigurada: '10:00' }

  it('en turno no se manda, aunque sea el día y la hora', () => {
    expect(esMomentoDeEnviar({ ...base, trabajando: true })).toBe(false)
  })

  it('fuera de turno, el día y dentro de la ventana, sí', () => {
    expect(esMomentoDeEnviar({ ...base, trabajando: false })).toBe(true)
  })

  it('otro día no', () => {
    expect(esMomentoDeEnviar({ ...base, diaSemana: 3, trabajando: false })).toBe(false)
  })

  it('antes de la hora configurada no, y pasada la ventana tampoco', () => {
    expect(esMomentoDeEnviar({ ...base, horaLocal: '09:30', trabajando: false })).toBe(false)
    expect(esMomentoDeEnviar({ ...base, horaLocal: '11:05', trabajando: false })).toBe(false)
  })

  it('sin configuración usa el default declarado, no un horario escondido', () => {
    expect(ENVIO_POR_DEFECTO).toEqual({ dia: 1, hora: '10:00' })
    expect(esMomentoDeEnviar({
      diaSemana: 1, horaLocal: '10:30', diaConfigurado: null, horaConfigurada: null, trabajando: false,
    })).toBe(true)
  })
})

// ── ¿Sirvió? ────────────────────────────────────────────────────────────────

describe('la evolución describe, no puntúa', () => {
  it('mejoró', () => {
    const e = evolucion(6, 9)
    expect(e.sentido).toBe('mejora')
    expect(e.delta).toBe(3)
    expect(e.texto).toContain('6,0 → 9,0')
  })

  it('empeoró', () => {
    expect(evolucion(9, 6).sentido).toBe('empeora')
  })

  it('una diferencia despreciable no se declara mejora', () => {
    expect(evolucion(8.0, 8.03).sentido).toBe('igual')
  })

  it('sin período posterior no inventa una comparación', () => {
    const e = evolucion(7, null)
    expect(e.sentido).toBe('sin_datos')
    expect(e.delta).toBeNull()
  })
})
