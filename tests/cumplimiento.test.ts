import { describe, expect, it } from 'vitest'
import {
  MINUTOS_PRESENTACION_PREVIA, PESOS, calcularCumplimiento, hechoDePuntualidad,
  resumenCorto, resumirPuntualidad,
} from '@/lib/cumplimiento'
import type { JornadaCumplimiento } from '@/lib/cumplimiento'
import { calcularDesempeno } from '@/lib/desempeno'
import { desempenoPorEmpleado, jornadaCumplimientoDesdeFila } from '@/lib/desempeno-datos'

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
    expect(r.nota).toBe(0)
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

  it('sólo Asistencia y Procedimiento puntúan hoy', () => {
    const r = calcularCumplimiento(base())
    const puntuables = r.dimensiones.filter(d => d.estado === 'puntuable').map(d => d.clave)
    expect(puntuables).toEqual(['asistencia', 'procedimiento'])
  })

  it('una dimensión que no puntúa dice qué le falta, no "no disponible"', () => {
    const r = calcularCumplimiento(base())
    for (const d of r.dimensiones.filter(x => x.estado !== 'puntuable')) {
      expect(d.faltante && d.faltante.length > 20).toBe(true)
    }
  })

  it('Puntualidad se calcula y se muestra aunque no pese', () => {
    const r = calcularCumplimiento([...base(11), j({ turnoId: 'x', entrada: '07:30' })])
    const p = r.dimensiones.find(d => d.clave === 'puntualidad')!
    expect(p.estado).toBe('en_validacion')
    expect(p.nota).not.toBeNull()
    expect(p.peso).toBe(0)
  })

  it('las que no tienen dato quedan en sin_datos, no en cero', () => {
    const r = calcularCumplimiento(base())
    for (const clave of ['rondas', 'uniforme', 'libro_guardia', 'evidencias'] as const) {
      const d = r.dimensiones.find(x => x.clave === clave)!
      expect(d.estado).toBe('sin_datos')
      expect(d.nota).toBeNull()
    }
  })

  it('una dimensión sin muestra suficiente NO entra al promedio', () => {
    // Doce jornadas perfectas salvo una impuntual. Si Puntualidad entrara,
    // el total bajaría; como pesa 0, no se mueve.
    const conImpuntual = calcularCumplimiento([...base(11), j({ turnoId: 'x', entrada: '08:00' })])
    const todasPuntuales = calcularCumplimiento(base(12))
    expect(conImpuntual.puntaje).toBe(todasPuntuales.puntaje)
    expect(conImpuntual.puntualidad.impuntuales).toBe(1)
  })
})

describe('el número no cambia respecto de lo que ya está en producción', () => {
  it('con los pesos de hoy, el total es el mismo que calcula el núcleo', () => {
    // Encender una dimensión tiene que ser una decisión explícita, nunca un
    // efecto colateral de haber agregado el módulo.
    for (const jornadas of [
      base(12),
      base(12, { salidaPropia: false }),
      [...base(10), j({ turnoId: 'a', esAusencia: true }), j({ turnoId: 'b', entradaPropia: false })],
    ]) {
      expect(calcularCumplimiento(jornadas).puntaje).toBe(calcularDesempeno(jornadas).puntaje)
    }
  })

  it('los pesos que no están auditados son cero', () => {
    expect(PESOS.puntualidad).toBe(0)
    expect(PESOS.rondas).toBe(0)
    expect(PESOS.uniforme).toBe(0)
    expect(PESOS.libro_guardia).toBe(0)
    expect(PESOS.evidencias).toBe(0)
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
