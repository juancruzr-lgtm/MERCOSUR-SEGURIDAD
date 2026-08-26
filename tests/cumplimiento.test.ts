import { describe, expect, it } from 'vitest'
import {
  BANDAS_PUNTUALIDAD, MINUTOS_PRESENTACION_PREVIA, PESOS, PESO_PUNTUALIDAD,
  bandaDeDemora, calcularCumplimiento, detallePuntualidad, hechoDePuntualidad,
  minutosDeDemora, patronesDeHorarioSospechoso, resumenCorto, resumirPuntualidad,
} from '@/lib/cumplimiento'
import type { JornadaCumplimiento } from '@/lib/cumplimiento'
import { calcularDesempeno } from '@/lib/desempeno'
import {
  desempenoPorEmpleado, jornadaCumplimientoDesdeFila, resumirDesempeno,
} from '@/lib/desempeno-datos'

/** Una fila de bandeja mínima, del mismo shape que produce construirFilasBandeja. */
let seq = 0
const fila = (empleadoId: string, over: Record<string, any> = {}) => ({
  turnoId: 't' + (seq++), empleadoId, registroId: 'r',
  vigilador: empleadoId, fecha: '2026-08-10',
  objetivoId: 'o1', objetivo: 'LAROMET', puestoId: 'p1', puesto: 'Principal',
  horario: '07:00–19:00', horaInicioProg: '07:00', horaFinProg: '19:00',
  entrada: '06:50', salida: '19:00', horas: 12,
  caracteristica: 'Normal', salidaAutomatica: false, tieneFichaje: true,
  entradaPropia: true, salidaPropia: true,
  estadoControl: 'pendiente', solicitudId: null, solicitudTexto: null,
  solicitudEstado: null, revisado: false, derivado: false, observaciones: 0,
  ...over,
})

// Cumplimiento Operativo. Mide el procedimiento, no si alguien es buen
// vigilador: una persona puede ser la que el cliente pide por nombre y sacar 4
// acá porque no ficha la salida.
//
// La regla transversal que más se prueba en este archivo es una sola:
// UN HECHO NO CASTIGA DOS VECES.

const j = (over: Partial<JornadaCumplimiento> = {}): JornadaCumplimiento => ({
  turnoId: 't1',
  tieneRegistro: true,
  esAusencia: false,
  entradaPropia: true,
  salidaPropia: true,
  horaInicioProg: '07:00',
  horaFinProg: '19:00',
  entrada: '06:50',
  ...over,
})

/** Doce jornadas correctas: alcanza la muestra mínima sin ruido. */
const base = (n = 12, over: Partial<JornadaCumplimiento> = {}) =>
  Array.from({ length: n }, (_, i) => j({ turnoId: `t${i}`, ...over }))

// ── Puntualidad ─────────────────────────────────────────────────────────────

describe('puntualidad: la ventana es [inicio − 15, inicio]', () => {
  it('quince minutos antes es puntual', () => {
    expect(hechoDePuntualidad(j({ horaInicioProg: '07:00', entrada: '06:45' }))).toBe('puntual')
  })

  it('exactamente a la hora es puntual', () => {
    expect(hechoDePuntualidad(j({ horaInicioProg: '07:00', entrada: '07:00' }))).toBe('puntual')
  })

  it('un minuto después ya es impuntual', () => {
    expect(hechoDePuntualidad(j({ horaInicioProg: '07:00', entrada: '07:01' }))).toBe('impuntual')
  })

  it('la tolerancia técnica de fichaje no vuelve puntual al ingreso', () => {
    // El sistema puede permitir fichar a las 07:05. Eso no lo hace puntual.
    expect(hechoDePuntualidad(j({ horaInicioProg: '07:00', entrada: '07:05' }))).toBe('impuntual')
  })

  it('llegar mucho antes no es una falta', () => {
    expect(hechoDePuntualidad(j({ horaInicioProg: '07:00', entrada: '06:00' }))).toBe('puntual')
  })

  it('la ventana declarada son quince minutos', () => {
    expect(MINUTOS_PRESENTACION_PREVIA).toBe(15)
  })

  it('un nocturno que entra antes de medianoche llegó temprano, no 22 horas tarde', () => {
    expect(hechoDePuntualidad(j({
      horaInicioProg: '22:00', horaFinProg: '06:00', entrada: '21:50',
    }))).toBe('puntual')
  })

  it('y si entra pasada la medianoche, es impuntual', () => {
    expect(hechoDePuntualidad(j({
      horaInicioProg: '22:00', horaFinProg: '06:00', entrada: '00:30',
    }))).toBe('impuntual')
  })
})

describe('puntualidad: cuándo NO se juzga', () => {
  it('sin fichaje propio no es impuntual: es sin dato', () => {
    // Ya cuenta como incidencia de Procedimiento. Llamarla además impuntual
    // sería castigar dos veces, y además sería inventar: nadie sabe a qué hora
    // llegó.
    expect(hechoDePuntualidad(j({ entradaPropia: false, entrada: '09:00' }))).toBe('sin_dato')
  })

  it('una ausencia confirmada no es impuntual', () => {
    expect(hechoDePuntualidad(j({ esAusencia: true }))).toBe('sin_dato')
  })

  it('una jornada sin registro tampoco', () => {
    expect(hechoDePuntualidad(j({ tieneRegistro: false }))).toBe('sin_dato')
  })

  it('las sin dato quedan fuera del denominador', () => {
    const r = resumirPuntualidad([
      j({ entrada: '07:01' }),
      j({ entradaPropia: false }),
      j({ esAusencia: true }),
    ])
    expect(r).toMatchObject({ puntuales: 0, impuntuales: 1, sinDato: 2, evaluadas: 1 })
    // Una sola jornada, y es una tardanza leve: 10 × (1 − 0,25/1).
    expect(r.nota).toBe(7.5)
  })
})

// ── Un hecho no castiga dos veces ───────────────────────────────────────────

describe('un hecho no castiga dos veces', () => {
  it('trabajó sin fichar: Asistencia cumplida, Procedimiento con incidencia', () => {
    const r = calcularCumplimiento(base(12, { entradaPropia: false, salidaPropia: false }))
    const asistencia = r.dimensiones.find(d => d.clave === 'asistencia')!
    const proc = r.dimensiones.find(d => d.clave === 'procedimiento')!
    expect(asistencia.nota).toBe(10)
    expect(proc.nota).toBe(0)
  })

  it('y esa misma jornada no suma además una impuntualidad', () => {
    const r = calcularCumplimiento(base(12, { entradaPropia: false }))
    expect(r.puntualidad.impuntuales).toBe(0)
    expect(r.puntualidad.sinDato).toBe(12)
  })

  it('la asistencia confirmada por supervisor no es ausencia', () => {
    const r = calcularCumplimiento(base(12, {
      entradaPropia: false, salidaPropia: false, origenCobertura: 'confirmacion_supervisor',
    }))
    expect(r.base.ausencias).toBe(0)
    expect(r.dimensiones.find(d => d.clave === 'asistencia')!.nota).toBe(10)
  })

  it('entrada sin salida es UNA sola incidencia', () => {
    const r = calcularCumplimiento([...base(11), j({ turnoId: 'x', salidaPropia: false })])
    expect(r.base.incidencias.entrada_sin_salida).toBe(1)
    expect(r.base.incidencias.sin_registro_propio).toBe(0)
  })

  it('el cierre automático no agrega una segunda incidencia', () => {
    // La garantía es estructural: el dato ni siquiera entra al cálculo. Si
    // alguien lo agregara como campo, este test no alcanzaría — por eso la
    // interfaz de entrada no lo tiene.
    const conCierre = { ...j({ salidaPropia: false }), cierre_automatico: true } as any
    const sinCierre = j({ salidaPropia: false })
    expect(calcularDesempeno([conCierre])).toEqual(calcularDesempeno([sinCierre]))
  })
})

// ── Dimensiones y pesos ─────────────────────────────────────────────────────

describe('las siete dimensiones se muestran desde el primer día', () => {
  it('están las siete, siempre', () => {
    const r = calcularCumplimiento(base())
    expect(r.dimensiones.map(d => d.clave)).toEqual([
      'asistencia', 'puntualidad', 'procedimiento',
      'rondas', 'uniforme', 'libro_guardia', 'evidencias',
    ])
  })


  it('una dimensión que no puntúa dice qué le falta, no "no disponible"', () => {
    const r = calcularCumplimiento(base())
    for (const d of r.dimensiones.filter(x => x.estado !== 'puntuable')) {
      expect(d.faltante && d.faltante.length > 20).toBe(true)
    }
  })


  it('las que no tienen dato quedan en sin_datos, no en cero', () => {
    const r = calcularCumplimiento(base())
    for (const clave of ['rondas', 'uniforme', 'libro_guardia', 'evidencias'] as const) {
      const d = r.dimensiones.find(x => x.clave === clave)!
      expect(d.estado).toBe('sin_datos')
      expect(d.nota).toBeNull()
    }
  })

})

// ── Muestra mínima y explicabilidad ─────────────────────────────────────────

describe('datos insuficientes', () => {
  it('con pocas jornadas no hay puntaje', () => {
    const r = calcularCumplimiento(base(3))
    expect(r.puntaje).toBeNull()
    expect(r.estado).toBe('datos_insuficientes')
  })

  it('la regla de suficiencia es una sola: la del núcleo', () => {
    const jornadas = base(3)
    expect(calcularCumplimiento(jornadas).puntaje).toBe(calcularDesempeno(jornadas).puntaje)
  })
})

describe('explicabilidad', () => {
  it('cada motivo sale de un contador, no de una plantilla', () => {
    const r = calcularCumplimiento([
      ...base(10),
      j({ turnoId: 'a', salidaPropia: false }),
      j({ turnoId: 'b', entrada: '07:40' }),
    ])
    const textos = r.motivos.map(m => m.texto)
    expect(textos).toContain('1 entrada sin salida registrada')
    expect(textos).toContain('1 ingreso posterior al horario programado')
  })

  it('los motivos describen el hecho, no acusan a la persona', () => {
    const r = calcularCumplimiento([...base(11), j({ turnoId: 'x', entrada: '09:00' })])
    const texto = r.motivos.map(m => m.texto).join(' ')
    expect(texto).toContain('ingreso posterior al horario')
    expect(texto).not.toMatch(/llegó tarde|impuntual|incumpli/i)
  })
})

describe('resumenCorto — lo que ve la tabla de Guardias', () => {
  it('muestra puntaje y categoría', () => {
    expect(resumenCorto({ puntaje: 9.6, estado: 'excelente' })).toBe('9,6 / 10 · Excelente')
    expect(resumenCorto({ puntaje: 5.4, estado: 'requiere_intervencion' }))
      .toBe('5,4 / 10 · Requiere intervención')
  })

  it('sin puntaje muestra raya, no un cero', () => {
    expect(resumenCorto({ puntaje: null, estado: 'datos_insuficientes' }))
      .toBe('— · Datos insuficientes')
  })

  it('usa coma decimal', () => {
    expect(resumenCorto({ puntaje: 8.9, estado: 'correcto' })).toContain('8,9')
  })
})

// ── La tabla y el detalle no pueden discrepar ───────────────────────────────

describe('un solo número para las dos pantallas', () => {
  it('la tabla de Guardias y la ficha del empleado salen del mismo cálculo', () => {
    // La tabla usa desempenoPorEmpleado(); la ficha llama a calcularCumplimiento
    // sobre las jornadas de esa persona. Si fueran dos cuentas distintas,
    // alguien vería 7,4 en un lado y 7,6 en el otro y no sabría cuál creer.
    const filas = [
      fila('A', { salidaPropia: false }), fila('A'), fila('A'), fila('A'),
      fila('A'), fila('A'), fila('A'), fila('A'), fila('A'), fila('A'),
      fila('B'), fila('B'), fila('B'), fila('B'),
      fila('B'), fila('B'), fila('B'), fila('B'),
    ]
    const porEmpleado = desempenoPorEmpleado(filas as any)
    for (const d of porEmpleado) {
      const directo = calcularCumplimiento(
        (filas as any).filter((f: any) => f.empleadoId === d.empleadoId).map(jornadaCumplimientoDesdeFila),
      )
      expect(d.cumplimiento.puntaje).toBe(directo.puntaje)
      expect(d.cumplimiento.estado).toBe(directo.estado)
    }
  })

  it('y el resumen corto de la tabla usa ese mismo número', () => {
    const filas = Array.from({ length: 10 }, () => fila('A'))
    const d = desempenoPorEmpleado(filas as any)[0]
    expect(resumenCorto(d.cumplimiento)).toContain(
      d.cumplimiento.puntaje!.toFixed(1).replace('.', ','),
    )
  })
})

describe('el orden es operativo, no un podio', () => {
  it('primero quien necesita una decisión, último quien está bien', () => {
    const filas = [
      ...Array.from({ length: 10 }, () => fila('BIEN')),
      ...Array.from({ length: 10 }, () => fila('MAL', { entradaPropia: false, salidaPropia: false })),
    ]
    const orden = desempenoPorEmpleado(filas as any).map(d => d.empleadoId)
    expect(orden[0]).toBe('MAL')
    expect(orden[orden.length - 1]).toBe('BIEN')
  })
})

// ── Bandas ──────────────────────────────────────────────────────────────────

describe('las bandas de tardanza', () => {
  const banda = (min: number) => bandaDeDemora(min).clave

  it('0 y antes es puntual', () => {
    expect(banda(-15)).toBe('puntual')
    expect(banda(0)).toBe('puntual')
  })

  it('1 a 5 es leve', () => {
    expect(banda(1)).toBe('leve')
    expect(banda(5)).toBe('leve')
  })

  it('6 abre la banda siguiente', () => {
    expect(banda(6)).toBe('tardanza')
    expect(banda(15)).toBe('tardanza')
  })

  it('16 abre la de importante', () => {
    expect(banda(16)).toBe('importante')
    expect(banda(30)).toBe('importante')
  })

  it('más de 30 es grave', () => {
    expect(banda(31)).toBe('grave')
    expect(banda(476)).toBe('grave')
  })

  it('cada banda pesa más que la anterior', () => {
    const p = BANDAS_PUNTUALIDAD.map(b => b.penalizacion)
    for (let i = 1; i < p.length; i++) expect(p[i]).toBeGreaterThan(p[i - 1])
  })
})

describe('minutos de demora', () => {
  it('07:04 sobre un turno de 07:00 son 4 minutos', () => {
    expect(minutosDeDemora(j({ horaInicioProg: '07:00', entrada: '07:04' }))).toBe(4)
  })

  it('llegar antes da negativo', () => {
    expect(minutosDeDemora(j({ horaInicioProg: '07:00', entrada: '06:45' }))).toBe(-15)
  })

  it('el nocturno no desplaza la fecha ni inventa 22 horas', () => {
    expect(minutosDeDemora(j({
      horaInicioProg: '22:00', horaFinProg: '06:00', entrada: '21:50',
    }))).toBe(-10)
    expect(minutosDeDemora(j({
      horaInicioProg: '22:00', horaFinProg: '06:00', entrada: '22:18',
    }))).toBe(18)
  })

  it('sin fichaje propio no hay minutos que medir', () => {
    expect(minutosDeDemora(j({ entradaPropia: false, entrada: '09:00' }))).toBeNull()
  })
})

// ── La nota ─────────────────────────────────────────────────────────────────

describe('la nota de Puntualidad', () => {
  it('todas puntuales es 10', () => {
    expect(resumirPuntualidad(base(20)).nota).toBe(10)
  })

  it('una tardanza leve aislada NO destruye el mes', () => {
    const r = resumirPuntualidad([...base(19), j({ turnoId: 'x', entrada: '07:03' })])
    expect(r.nota).toBeGreaterThanOrEqual(9.8)
  })

  it('la reincidencia sí baja la nota', () => {
    const una = resumirPuntualidad([...base(19), j({ turnoId: 'x', entrada: '07:10' })]).nota!
    const ocho = resumirPuntualidad([
      ...base(12),
      ...Array.from({ length: 8 }, (_, i) => j({ turnoId: 'y' + i, entrada: '07:10' })),
    ]).nota!
    expect(ocho).toBeLessThan(una)
  })

  it('una tardanza grave pesa más que una leve', () => {
    const leve = resumirPuntualidad([...base(19), j({ turnoId: 'x', entrada: '07:03' })]).nota!
    const grave = resumirPuntualidad([...base(19), j({ turnoId: 'x', entrada: '08:30' })]).nota!
    expect(grave).toBeLessThan(leve)
  })

  it('nunca baja de cero', () => {
    const r = resumirPuntualidad(Array.from({ length: 3 }, (_, i) =>
      j({ turnoId: 'g' + i, entrada: '10:00' })))
    expect(r.nota).toBe(0)
  })

  it('las no evaluables no entran al denominador', () => {
    const r = resumirPuntualidad([
      ...base(10),
      ...Array.from({ length: 5 }, (_, i) => j({ turnoId: 'n' + i, entradaPropia: false })),
    ])
    expect(r.evaluadas).toBe(10)
    expect(r.sinDato).toBe(5)
    expect(r.nota).toBe(10)
  })

  it('sin ninguna evaluable no hay nota, y no es cero', () => {
    const r = resumirPuntualidad(base(5, { entradaPropia: false }))
    expect(r.nota).toBeNull()
  })
})

describe('trazabilidad: del número al hecho', () => {
  it('cada tardanza queda con su fecha, turno, hora y minutos', () => {
    const r = resumirPuntualidad([
      ...base(10),
      j({ turnoId: 't-tarde', fecha: '2026-08-17', objetivo: 'LAROMET', entrada: '07:11' }),
    ])
    expect(r.tardanzas).toHaveLength(1)
    expect(r.tardanzas[0]).toMatchObject({
      fecha: '2026-08-17', objetivo: 'LAROMET',
      horaInicioProg: '07:00', entrada: '07:11', minutos: 11, banda: 'tardanza',
    })
  })

  it('las puntuales no ensucian la lista', () => {
    expect(resumirPuntualidad(base(10)).tardanzas).toEqual([])
  })

  it('se ordenan de mayor a menor demora', () => {
    const r = resumirPuntualidad([
      j({ turnoId: 'a', entrada: '07:04' }),
      j({ turnoId: 'b', entrada: '07:40' }),
      j({ turnoId: 'c', entrada: '07:12' }),
    ])
    expect(r.tardanzas.map(t => t.minutos)).toEqual([40, 12, 4])
  })

  it('el detalle coincide con los contadores', () => {
    const r = resumirPuntualidad([...base(10), j({ turnoId: 'x', entrada: '07:20' })])
    const texto = detallePuntualidad(r)
    expect(texto).toContain('10 de 11 puntuales')
    expect(texto).toContain('1 tardanza importante')
    expect(texto).toContain('máxima 20 min')
  })
})

// ── Horarios sospechosos: señalan, no perdonan ──────────────────────────────

describe('patrones de horario a revisar', () => {
  const enINTA = (i: number, empleadoId: string, min: number) => ({
    ...j({
      turnoId: 'i' + i, objetivo: 'INTA', horaInicioProg: '07:00',
      entrada: `07:${String(min).padStart(2, '0')}`,
    }),
    empleadoId,
  })

  it('varias personas tarde en el mismo puesto levantan la advertencia', () => {
    const jornadas = [
      enINTA(1, 'A', 45), enINTA(2, 'A', 50), enINTA(3, 'B', 40),
      enINTA(4, 'B', 55), enINTA(5, 'A', 48),
    ]
    const p = patronesDeHorarioSospechoso(jornadas as any)
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ objetivo: 'INTA', horaInicio: '07:00', personas: 2, porcentajeTarde: 100 })
  })

  it('una sola persona no hace patrón: eso es un problema suyo', () => {
    const jornadas = [enINTA(1, 'A', 45), enINTA(2, 'A', 50), enINTA(3, 'A', 40),
      enINTA(4, 'A', 55), enINTA(5, 'A', 48)]
    expect(patronesDeHorarioSospechoso(jornadas as any)).toEqual([])
  })

  it('la advertencia NO perdona ninguna tardanza', () => {
    // Es el punto entero: señalar el horario y seguir contando la impuntualidad.
    const jornadas = [enINTA(1, 'A', 45), enINTA(2, 'A', 50), enINTA(3, 'B', 40),
      enINTA(4, 'B', 55), enINTA(5, 'A', 48)]
    expect(patronesDeHorarioSospechoso(jornadas as any)).toHaveLength(1)
    expect(resumirPuntualidad(jornadas as any).nota).toBe(0)
    expect(resumirPuntualidad(jornadas as any).impuntuales).toBe(5)
  })

  it('demoras chicas no levantan advertencia: son puntualidad, no programación', () => {
    const jornadas = [enINTA(1, 'A', 2), enINTA(2, 'A', 3), enINTA(3, 'B', 1),
      enINTA(4, 'B', 4), enINTA(5, 'A', 2)]
    expect(patronesDeHorarioSospechoso(jornadas as any)).toEqual([])
  })
})

// ── Puntualidad dentro del X/10 ─────────────────────────────────────────────

describe('Puntualidad ya pesa en el X/10', () => {
  it('las tres dimensiones puntúan', () => {
    const r = calcularCumplimiento(base(12))
    expect(r.dimensiones.filter(d => d.estado === 'puntuable').map(d => d.clave))
      .toEqual(['asistencia', 'puntualidad', 'procedimiento'])
  })

  it('el peso es el declarado y no cambió el de las otras dos', () => {
    expect(PESOS.puntualidad).toBe(PESO_PUNTUALIDAD)
    expect(PESOS.asistencia).toBe(20)
    expect(PESOS.procedimiento).toBe(60)
  })

  it('las cuatro que faltan siguen en cero', () => {
    for (const c of ['rondas', 'uniforme', 'libro_guardia', 'evidencias'] as const) {
      expect(PESOS[c]).toBe(0)
    }
  })

  it('llegar tarde ahora sí mueve el número', () => {
    const puntual = calcularCumplimiento(base(20))!.puntaje!
    const tarde = calcularCumplimiento([
      ...base(12),
      ...Array.from({ length: 8 }, (_, i) => j({ turnoId: 'z' + i, entrada: '07:20' })),
    ])!.puntaje!
    expect(tarde).toBeLessThan(puntual)
  })

  it('quien viene todos los días y llega puntual no cae por usar mal la app', () => {
    // El caso real de producción: CENTURION, con 10 incidencias sobre 18
    // jornadas. Con Procedimiento al 75 % del número daba 5,8 —intervención—
    // aunque vino todos los días y llegó puntual. Ahora queda en seguimiento:
    // el problema sigue visible en su dimensión, sin declararlo el peor caso.
    const r = calcularCumplimiento([
      ...base(8),
      ...Array.from({ length: 10 }, (_, i) => j({ turnoId: 'p' + i, salidaPropia: false })),
    ])
    expect(r.dimensiones.find(d => d.clave === 'asistencia')!.nota).toBe(10)
    expect(r.dimensiones.find(d => d.clave === 'puntualidad')!.nota).toBe(10)
    expect(r.estado).toBe('requiere_seguimiento')
  })

  it('pero no registrar NADA en todo el mes sigue siendo intervención', () => {
    // El rebalanceo no perdona el caso extremo, y no debe: alguien que no
    // registró ni una entrada ni una salida en veinte jornadas necesita que
    // alguien intervenga.
    const r = calcularCumplimiento(base(20, { entradaPropia: false, salidaPropia: false }))
    expect(r.estado).toBe('requiere_intervencion')
  })

  it('sin fichaje propio: Asistencia cumplida, Procedimiento penaliza, Puntualidad no', () => {
    const r = calcularCumplimiento(base(20, { entradaPropia: false, salidaPropia: false }))
    expect(r.dimensiones.find(d => d.clave === 'asistencia')!.nota).toBe(10)
    expect(r.dimensiones.find(d => d.clave === 'procedimiento')!.nota).toBe(0)
    expect(r.puntualidad.evaluadas).toBe(0)
    expect(r.dimensiones.find(d => d.clave === 'puntualidad')!.estado).toBe('sin_datos')
  })

  it('y esa dimensión sin dato no entra al promedio como cero', () => {
    const sinFichaje = calcularCumplimiento(base(20, { entradaPropia: false, salidaPropia: false }))
    // Sólo Asistencia y Procedimiento: (10*20 + 0*60)/80 = 2,5
    expect(sinFichaje.puntaje).toBe(2.5)
  })

  it('una asistencia confirmada por supervisor no es ausencia ni impuntualidad', () => {
    const r = calcularCumplimiento(base(20, {
      entradaPropia: false, salidaPropia: false, origenCobertura: 'confirmacion_supervisor',
    }))
    expect(r.base.ausencias).toBe(0)
    expect(r.puntualidad.impuntuales).toBe(0)
  })
})

describe('Puntualidad no toca nada de liquidación', () => {
  it('el módulo no lee horas ni estados de asistencia', () => {
    // La jornada que entra al cálculo no tiene horas, ni liquidables, ni
    // cierre automático: no puede modificar lo que no conoce.
    const campos = Object.keys(j())
    for (const prohibido of ['horas', 'horasLiquidables', 'cierre_automatico', 'estadoControl']) {
      expect(campos).not.toContain(prohibido)
    }
  })

  it('cambiar la puntualidad no cambia Asistencia ni Procedimiento', () => {
    const puntual = calcularCumplimiento(base(20))
    const tarde = calcularCumplimiento(base(20, { entrada: '07:25' }))
    expect(tarde.base.asistencia).toBe(puntual.base.asistencia)
    expect(tarde.base.procedimiento).toBe(puntual.base.procedimiento)
    expect(tarde.base.incidencias).toEqual(puntual.base.incidencias)
  })
})

describe('el patrón cuenta personas, no jornadas', () => {
  const enPuesto = (i: number, empleadoId: string, min: number) => j({
    turnoId: 'x' + i, empleadoId, objetivo: 'NACION', horaInicioProg: '19:00',
    horaFinProg: '07:00', entrada: `19:${String(min).padStart(2, '0')}`,
  })

  it('las jornadas de una sola persona NO levantan la advertencia', () => {
    // En producción decía "20 entradas de 20 vigiladores" sobre una sola
    // persona: contaba turnos como si fueran gente.
    const jornadas = Array.from({ length: 20 }, (_, i) => enPuesto(i, 'A', 12))
    expect(patronesDeHorarioSospechoso(jornadas)).toEqual([])
  })

  it('y con dos personas cuenta dos, no veinte', () => {
    const jornadas = [
      ...Array.from({ length: 10 }, (_, i) => enPuesto(i, 'A', 12)),
      ...Array.from({ length: 10 }, (_, i) => enPuesto(100 + i, 'B', 14)),
    ]
    const p = patronesDeHorarioSospechoso(jornadas)
    expect(p).toHaveLength(1)
    expect(p[0].personas).toBe(2)
    expect(p[0].entradas).toBe(20)
  })

  it('sin empleadoId no se levanta la advertencia: mejor callar que inventar', () => {
    const jornadas = Array.from({ length: 20 }, (_, i) => {
      const x = enPuesto(i, 'A', 12)
      delete (x as any).empleadoId
      return x
    })
    expect(patronesDeHorarioSospechoso(jornadas)).toEqual([])
  })
})

describe('el mismo número en las TRES pantallas', () => {
  // El test anterior sólo comparaba tabla contra ficha. La lista usaba
  // `resultado` —el núcleo, sin Puntualidad— y mostraba 31/14/7/4 mientras la
  // tabla mostraba 27/17/9/3 sobre la misma gente.
  const conTardanzas = [
    ...Array.from({ length: 14 }, (_, i) => fila('A', { turnoId: 'a' + i })),
    ...Array.from({ length: 6 }, (_, i) => fila('A', { turnoId: 'b' + i, entrada: '07:20' })),
  ]

  it('la lista, la tabla y la ficha salen del mismo objeto', () => {
    const [d] = desempenoPorEmpleado(conTardanzas as any)
    const ficha = calcularCumplimiento(
      (conTardanzas as any).map(jornadaCumplimientoDesdeFila),
    )
    expect(d.cumplimiento.puntaje).toBe(ficha.puntaje)
    expect(d.cumplimiento.estado).toBe(ficha.estado)
    expect(resumenCorto(d.cumplimiento)).toContain(ficha.puntaje!.toFixed(1).replace('.', ','))
  })

  it('y ese número NO es el del núcleo cuando hay tardanzas', () => {
    // Si alguna pantalla vuelve a leer `resultado`, este test la delata.
    const [d] = desempenoPorEmpleado(conTardanzas as any)
    expect(d.cumplimiento.puntaje).not.toBe(d.resultado.puntaje)
  })

  it('el resumen por estado cuenta el estado del cumplimiento', () => {
    const lista = desempenoPorEmpleado(conTardanzas as any)
    const resumen = resumirDesempeno(lista)
    expect(resumen.porEstado[lista[0].cumplimiento.estado]).toBe(1)
  })
})
