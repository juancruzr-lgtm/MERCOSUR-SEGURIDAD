import { describe, expect, it } from 'vitest'
import { PESOS, VARIANTES_PESOS, calcularCumplimiento } from '@/lib/cumplimiento'
import type { ClaveDimension } from '@/lib/cumplimiento'
import { coberturaDe, leyendaCobertura, suficiencia } from '@/lib/cumplimiento-cobertura'
import { fuentesDeEmpleado } from '@/lib/cumplimiento-fuentes'
import type { RondasEmpleado } from '@/lib/cumplimiento-fuentes'
import { jornadaCumplimientoDesdeFila } from '@/lib/desempeno-datos'
import type { FilaBandejaMensual } from '@/lib/bandeja-planillas'

// SIMULACIÓN. Ninguno de estos modelos está activo: el productivo sigue siendo
// PESOS (Modelo E). Lo que se fija acá es el comportamiento que hace falta para
// poder ELEGIR, no el resultado de la elección.

const fila = (over: Partial<FilaBandejaMensual> = {}): FilaBandejaMensual => ({
  turnoId: 't1', empleadoId: 'e1', registroId: 'r1', vigilador: 'PEREZ, JUAN',
  fecha: '2026-08-10',
  objetivoId: 'o1', objetivo: 'PLANTA', puestoId: 'p1', puesto: 'Principal',
  horario: '07:00–19:00', horaInicioProg: '07:00', horaFinProg: '19:00',
  entrada: '06:50', salida: '19:05', horas: 12,
  caracteristica: 'Normal', salidaAutomatica: false, tieneFichaje: true,
  entradaPropia: true, salidaPropia: true,
  estadoControl: 'pendiente', solicitudId: null, solicitudTexto: null,
  solicitudEstado: null, revisado: false, derivado: false, observaciones: 0,
  ...over,
})

const rondas = (o: Partial<RondasEmpleado> = {}): RondasEmpleado => ({
  guardiaId: 'e1', obligaciones: 0, cumplidas: 0, noIniciada: 0,
  noFinalizada: 0, suspendida: 0, saneadas: 0, bajoPausa: 0,
  pausaAtribuible: 0, pausaNoAtribuible: 0, pausaCapacitacion: 0,
  pausaSinClasificar: 0, motivosPausa: {}, causasPausa: {},
  ...o,
})

const mes = (n = 20, over: Partial<FilaBandejaMensual> = {}) =>
  Array.from({ length: n }, (_, i) => fila({ turnoId: `p${i}`, ...over }))

type Modelo = keyof typeof VARIANTES_PESOS

const calcular = (
  filas: FilaBandejaMensual[], r: RondasEmpleado | null = null, modelo: Modelo = 'sim6_propuesto',
) => calcularCumplimiento(
  filas.map(jornadaCumplimientoDesdeFila), fuentesDeEmpleado(r, []).fuentes, VARIANTES_PESOS[modelo],
)

const dim = (res: ReturnType<typeof calcular>, clave: ClaveDimension) =>
  res.dimensiones.find(d => d.clave === clave)!

/** Los seis en juego. M5 es el productivo actual, que entra como control. */
const MODELOS: Modelo[] = [
  'sim1_equilibrado', 'sim2_rondas_fuerte', 'sim3_rondas_muy_fuerte',
  'sim4_prestacion_fuerte', 'modelo_e_sin_lastre', 'sim6_propuesto',
]

// ── Nada de esto está activo ────────────────────────────────────────────────

describe('la simulación no toca producción', () => {
  it('los pesos productivos siguen siendo el Modelo E', () => {
    expect(PESOS).toEqual(VARIANTES_PESOS.modelo_e_sin_lastre)
    expect(PESOS.rondas).toBe(30)
    expect(PESOS.procedimiento).toBe(25)
  })

  it('los seis modelos existen, con pesos no negativos y Calidad en cero', () => {
    for (const m of MODELOS) {
      const w = VARIANTES_PESOS[m]
      expect(w.evidencias).toBe(0)
      for (const p of Object.values(w)) expect(p).toBeGreaterThanOrEqual(0)
    }
  })
})

// ── Los casos de negocio A-F ────────────────────────────────────────────────

describe('casos sintéticos de negocio', () => {
  /** Un mes perfecto salvo lo que se indique. */
  const perfecto = (r: RondasEmpleado | null = rondas({ obligaciones: 20, cumplidas: 20 })) =>
    ({ filas: mes(20), r })

  it('A · rondas mal y todo lo demás bien: baja fuerte y no queda Excelente', () => {
    for (const m of MODELOS) {
      const res = calcular(mes(20), rondas({ obligaciones: 20, cumplidas: 8, noIniciada: 12 }), m)
      expect(dim(res, 'rondas').nota).toBe(4)
      expect(res.puntaje!).toBeLessThan(9.5)
    }
  })

  it('B · problema de app con prestación excelente: se ve, pero conserva valor', () => {
    for (const m of MODELOS) {
      const res = calcular(
        mes(20).map((f, i) => i < 12 ? { ...f, salidaPropia: false } : f),
        rondas({ obligaciones: 20, cumplidas: 20 }), m)
      expect(dim(res, 'procedimiento').nota).toBe(4)
      // Se nota...
      expect(res.puntaje!).toBeLessThan(9.5)
      // ...y no lo convierte en el peor: sigue prestando el servicio.
      expect(res.puntaje!).toBeGreaterThan(8)
    }
  })

  it('LA PRUEBA QUE SEPARA: cuánto distingue cada modelo prestar de registrar', () => {
    const A = (m: Modelo) => calcular(mes(20), rondas({ obligaciones: 20, cumplidas: 8, noIniciada: 12 }), m).puntaje!
    const B = (m: Modelo) => calcular(
      mes(20).map((f, i) => i < 12 ? { ...f, salidaPropia: false } : f),
      rondas({ obligaciones: 20, cumplidas: 20 }), m).puntaje!
    const separacion = (m: Modelo) => B(m) - A(m)

    // TODOS ponen A por debajo de B: ninguno invierte la prioridad.
    for (const m of MODELOS) expect(A(m)).toBeLessThan(B(m))

    // Lo que cambia es CUÁNTO. El productivo apenas los distingue; el que más
    // separa es el de Rondas 40. La elección del peso es la elección de cuánta
    // diferencia se quiere declarar entre no recorrer y no registrar.
    expect(separacion('modelo_e_sin_lastre')).toBeLessThan(0.4)
    expect(separacion('sim6_propuesto')).toBeGreaterThan(0.8)
    expect(separacion('sim3_rondas_muy_fuerte')).toBeGreaterThan(separacion('sim6_propuesto'))
  })

  it('C · impuntualidad reiterada se siente', () => {
    for (const m of MODELOS) {
      const res = calcular(mes(20, { entrada: '07:40' }), rondas({ obligaciones: 20, cumplidas: 20 }), m)
      expect(dim(res, 'puntualidad').nota!).toBeLessThan(6)
      expect(res.puntaje!).toBeLessThan(9.5)
    }
  })

  it('D · una ausencia real es relevante, pero con estos pesos mueve poco', () => {
    for (const m of MODELOS) {
      const res = calcular(
        mes(20).map((f, i) => i < 4
          ? { ...f, esAusencia: true, tieneFichaje: false, entradaPropia: false, salidaPropia: false }
          : f),
        rondas({ obligaciones: 20, cumplidas: 20 }), m)
      expect(dim(res, 'asistencia').nota).toBe(8)
      // Baja, sí. Pero menos de un punto: es el límite conocido del modelo.
      expect(res.puntaje!).toBeLessThan(10)
      expect(res.puntaje!).toBeGreaterThan(9)
    }
  })

  it('E · sin rondas, uniforme ni libro: no recibe castigo alguno', () => {
    for (const m of MODELOS) {
      const res = calcular(mes(20), rondas({ obligaciones: 0 }), m)
      expect(dim(res, 'rondas').estado).toBe('no_aplica')
      expect(res.puntaje).toBe(10)
    }
  })

  it('F · rondas con datos insuficientes: no se inventa un 10 de Rondas', () => {
    for (const m of MODELOS) {
      const res = calcular(mes(20), rondas({ obligaciones: 4, cumplidas: 4 }), m)
      expect(dim(res, 'rondas').estado).toBe('datos_insuficientes')
      expect(dim(res, 'rondas').nota).toBeNull()
      expect(res.puntaje).toBe(10)
    }
    expect(perfecto).toBeTruthy()
  })
})

// ── Cobertura ───────────────────────────────────────────────────────────────

describe('cobertura de la evaluación', () => {
  /** Dimensiones armadas a mano: la cobertura es una función pura del estado. */
  const dims = (estados: Partial<Record<ClaveDimension, string>>) =>
    (Object.keys(VARIANTES_PESOS.sim6_propuesto) as ClaveDimension[]).map(clave => ({
      clave, etiqueta: clave, nota: null, peso: VARIANTES_PESOS.sim6_propuesto[clave],
      estado: (estados[clave] ?? 'puntuable') as any, detalle: '',
    }))

  it('quien tiene todo medido llega al 100 % por las dos vías', () => {
    const c = coberturaDe(dims({}), VARIANTES_PESOS.sim6_propuesto)
    expect(c.medido).toBe(c.teorico)
    expect(c.bruta).toBe(100)
    expect(c.ajustada).toBe(100)
  })

  it('NO APLICA no cuenta en contra: la ajustada lo descuenta', () => {
    const c = coberturaDe(dims({ rondas: 'no_aplica' }), VARIANTES_PESOS.sim6_propuesto)
    expect(c.noAplica).toBe(VARIANTES_PESOS.sim6_propuesto.rondas)
    expect(c.bruta).toBeLessThan(100)
    // Sobre lo que SÍ le correspondía, se le midió todo.
    expect(c.ajustada).toBe(100)
  })

  it('DATOS INSUFICIENTES sí cuenta: la obligación existía y no se midió', () => {
    const insuf = coberturaDe(dims({ rondas: 'datos_insuficientes' }), VARIANTES_PESOS.sim6_propuesto)
    const na = coberturaDe(dims({ rondas: 'no_aplica' }), VARIANTES_PESOS.sim6_propuesto)
    expect(insuf.noAplica).toBe(0)
    // Misma cobertura bruta, ajustada muy distinta: es la diferencia que importa.
    expect(insuf.bruta).toBe(na.bruta)
    expect(insuf.ajustada!).toBeLessThan(na.ajustada!)
  })

  it('los dos sacan 10, y sólo la cobertura los distingue', () => {
    const sinMuestra = calcular(mes(20), rondas({ obligaciones: 4, cumplidas: 4 }))
    const noAplica = calcular(mes(20), rondas({ obligaciones: 0 }))
    expect(sinMuestra.puntaje).toBe(10)
    expect(noAplica.puntaje).toBe(10)
    const c1 = coberturaDe(sinMuestra.dimensiones, VARIANTES_PESOS.sim6_propuesto)
    const c2 = coberturaDe(noAplica.dimensiones, VARIANTES_PESOS.sim6_propuesto)
    expect(c1.ajustada!).toBeLessThan(c2.ajustada!)
  })

  it('un 10 con cobertura parcial NO pierde puntos: sólo se dice que fue parcial', () => {
    const res = calcular(mes(20), rondas({ obligaciones: 4, cumplidas: 4 }))
    const c = coberturaDe(res.dimensiones, VARIANTES_PESOS.sim6_propuesto)
    expect(res.puntaje).toBe(10)
    expect(suficiencia(c, 70)).toBe('parcial')
    expect(leyendaCobertura(res.puntaje, c, 70)).toContain('Evaluación parcial')
  })

  it('el umbral separa lo integral de lo parcial y nunca toca el número', () => {
    const res = calcular(mes(20), rondas({ obligaciones: 20, cumplidas: 20 }))
    const c = coberturaDe(res.dimensiones, VARIANTES_PESOS.sim6_propuesto)
    expect(suficiencia(c, 0)).toBe('integral')
    expect(leyendaCobertura(res.puntaje, c, 0)).toBeNull()
    // Con un umbral imposible todo es parcial, y el puntaje sigue siendo 10.
    expect(suficiencia(c, 101)).toBe('parcial')
    expect(res.puntaje).toBe(10)
  })
})

// ── Lo que ningún modelo puede romper ───────────────────────────────────────

describe('invariantes de todos los modelos', () => {
  it('el peso de Rondas no afecta a quien no tiene rondas', () => {
    for (const m of MODELOS) {
      expect(calcular(mes(20), rondas({ obligaciones: 0 }), m).puntaje).toBe(10)
    }
    // Con Rondas fuera del denominador, subir SÓLO su peso no cambia nada.
    const flojo = (ron: number) => calcularCumplimiento(
      mes(20, { entrada: '07:40' }).map(jornadaCumplimientoDesdeFila),
      fuentesDeEmpleado(rondas({ obligaciones: 0 }), []).fuentes,
      { ...VARIANTES_PESOS.sim6_propuesto, rondas: ron },
    ).puntaje
    expect(flojo(30)).toBe(flojo(40))
    expect(flojo(30)).toBe(flojo(90))
  })

  it('hacer más rondas nunca da peor nota, en ningún modelo', () => {
    for (const m of MODELOS) {
      let previa = -1
      for (let c = 0; c <= 20; c += 4) {
        const p = calcular(mes(20), rondas({ obligaciones: 20, cumplidas: c, noIniciada: 20 - c }), m).puntaje!
        expect(p).toBeGreaterThanOrEqual(previa)
        previa = p
      }
    }
  })

  it('cumplir todo da 10 en los seis', () => {
    for (const m of MODELOS) {
      expect(calcular(mes(20), rondas({ obligaciones: 20, cumplidas: 20 }), m).puntaje).toBe(10)
    }
  })

  it('trabajar más no da peor nota si la proporción es igual', () => {
    for (const m of MODELOS) {
      const corto = calcular(mes(10), rondas({ obligaciones: 10, cumplidas: 9, noIniciada: 1 }), m)
      const largo = calcular(mes(40), rondas({ obligaciones: 40, cumplidas: 36, noIniciada: 4 }), m)
      expect(largo.puntaje).toBe(corto.puntaje)
    }
  })

  it('la normalización sólo cuenta dimensiones aplicables y medibles', () => {
    const res = calcular(mes(20), rondas({ obligaciones: 0 }))
    const suma = res.dimensiones
      .filter(d => d.estado === 'puntuable')
      .reduce((s, d) => s + d.peso, 0)
    const c = coberturaDe(res.dimensiones, VARIANTES_PESOS.sim6_propuesto)
    expect(c.medido).toBe(suma)
  })
})

// ── Los barridos que decidieron el Modelo 6 ─────────────────────────────────

describe('por qué cada peso quedó donde quedó', () => {
  it('Procedimiento 10 hace invisible un problema real de app; 18 lo deja ver', () => {
    const conApp = (pro: number) => calcularCumplimiento(
      mes(21).map((f, i) => i < 12 ? { ...f, salidaPropia: false } : f).map(jornadaCumplimientoDesdeFila),
      fuentesDeEmpleado(null, []).fuentes,
      { ...VARIANTES_PESOS.sim6_propuesto, procedimiento: pro },
    ).puntaje!
    expect(conApp(10)).toBeGreaterThan(conApp(18))
    expect(conApp(18)).toBeGreaterThan(conApp(25))
  })

  it('Uniforme 3 hace invisible una observación humana confirmada; 8 la deja ver', () => {
    // Nota de uniforme fija; lo único que cambia es cuánto pesa.
    const conUni = (uni: number) => calcularCumplimiento(
      mes(20).map(jornadaCumplimientoDesdeFila),
      { ...fuentesDeEmpleado(null, []).fuentes, uniforme: { nota: 6.67, detalle: '8 de 12' } },
      { ...VARIANTES_PESOS.sim6_propuesto, uniforme: uni },
    ).puntaje!
    expect(conUni(3)).toBeGreaterThan(conUni(8))
    expect(conUni(8)).toBeGreaterThan(conUni(12))
  })

  it('Asistencia sube el piso: con más peso, el peor sube en vez de bajar', () => {
    const peor = (asi: number) => calcularCumplimiento(
      mes(20, { entrada: '07:40' }).map((f, i) => i < 10 ? { ...f, salidaPropia: false } : f)
        .map(jornadaCumplimientoDesdeFila),
      fuentesDeEmpleado(null, []).fuentes,
      { ...VARIANTES_PESOS.sim6_propuesto, asistencia: asi },
    ).puntaje!
    // Asistencia está en 10 (vino todos los días): más peso la empuja hacia arriba.
    expect(peor(30)).toBeGreaterThan(peor(20))
    expect(peor(20)).toBeGreaterThan(peor(15))
  })
})
