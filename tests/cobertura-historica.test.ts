import { describe, expect, it } from 'vitest'
import {
  UMBRALES_PATRON,
  analizarCoberturaHistorica,
  clasificarProporcion,
  etiquetaDias,
} from '@/lib/cobertura-historica'
import type { ObjetivoHistorico, ServicioConfigurado, TurnoHistorico } from '@/lib/cobertura-historica'

// Motor de cobertura histórica (Bloque E): propone la estructura habitual de
// cada objetivo a partir de los turnos reales de un mes. Puro y sin escrituras.

const OBJ: ObjetivoHistorico = { id: 'o1', nombre: 'Objetivo Uno', estado: 'activo', es_prueba: false }

const dow = (fecha: string) => {
  const [a, m, d] = fecha.split('-').map(Number)
  const x = new Date(a, m - 1, d).getDay()
  return x === 0 ? 7 : x
}

/** Fechas de julio 2026 cuyo día de semana esté en `dows` (vacío = todas). */
const fechasJulio = (dows: number[] = []) => {
  const out: string[] = []
  for (let d = 1; d <= 31; d++) {
    const fecha = `2026-07-${String(d).padStart(2, '0')}`
    if (dows.length === 0 || dows.includes(dow(fecha))) out.push(fecha)
  }
  return out
}

const t = (fecha: string, hi: string, hf: string, over: Partial<TurnoHistorico> = {}): TurnoHistorico => ({
  objetivo_id: 'o1', fecha, hora_inicio: hi, hora_fin: hf,
  estado: 'programado', tipo_evento: 'normal', ...over,
})

const analizar = (turnos: TurnoHistorico[], over: {
  objetivos?: ObjetivoHistorico[]
  servicios?: ServicioConfigurado[]
} = {}) =>
  analizarCoberturaHistorica({
    anio: 2026, mes: 7, turnos,
    objetivos: over.objetivos ?? [OBJ],
    servicios: over.servicios ?? [],
  })

describe('analizarCoberturaHistorica — patrones', () => {
  it('patrón diario completo: todos los días, 100%, fuerte', () => {
    const r = analizar(fechasJulio().map(f => t(f, '08:00', '16:00')))
    const p = r.objetivos[0].patrones[0]
    expect(p.etiqueta_dias).toBe('Todos los días')
    expect(p.posiciones).toBe(1)
    expect(p.dias_observados).toBe(31)
    expect(p.dias_cumplidos).toBe(31)
    expect(p.porcentaje).toBe(100)
    expect(p.clasificacion).toBe('fuerte')
    expect(r.resumen.con_patron_fuerte).toBe(1)
  })

  it('patrón de lunes a viernes', () => {
    const r = analizar(fechasJulio([1, 2, 3, 4, 5]).map(f => t(f, '08:00', '16:00')))
    const p = r.objetivos[0].patrones[0]
    expect(p.etiqueta_dias).toBe('Lun–Vie')
    expect(p.dows).toEqual([1, 2, 3, 4, 5])
    expect(p.clasificacion).toBe('fuerte')
  })

  it('patrón de fines de semana', () => {
    const r = analizar(fechasJulio([6, 7]).map(f => t(f, '00:00', '23:59')))
    const p = r.objetivos[0].patrones[0]
    expect(p.etiqueta_dias).toBe('Sáb y Dom')
    expect(p.clasificacion).toBe('fuerte')
  })

  it('dos vigiladores simultáneos: 2 posiciones requeridas, no duplicado', () => {
    const r = analizar(fechasJulio().flatMap(f => [
      t(f, '07:00', '19:00', { guardia_id: 'g1' }),
      t(f, '07:00', '19:00', { guardia_id: 'g2' }),
    ]))
    const p = r.objetivos[0].patrones[0]
    expect(p.posiciones).toBe(2)
    expect(p.dias_cumplidos).toBe(31)
    expect(p.clasificacion).toBe('fuerte')
  })

  it('tres vigiladores simultáneos', () => {
    const r = analizar(fechasJulio().flatMap(f => [
      t(f, '07:00', '19:00', { guardia_id: 'g1' }),
      t(f, '07:00', '19:00', { guardia_id: 'g2' }),
      t(f, '07:00', '19:00', { guardia_id: 'g3' }),
    ]))
    expect(r.objetivos[0].patrones[0].posiciones).toBe(3)
  })

  it('turno nocturno: cuenta en su fecha de inicio y se marca como nocturno', () => {
    const r = analizar(fechasJulio().map(f => t(f, '19:00', '07:00')))
    const p = r.objetivos[0].patrones[0]
    expect(p.nocturno).toBe(true)
    expect(p.posiciones).toBe(1)
    expect(p.dias_cumplidos).toBe(31)
  })

  it('mes con días faltantes: el patrón resiste y las faltas quedan como excepciones', () => {
    const faltantes = new Set(['2026-07-10', '2026-07-11', '2026-07-20'])
    const r = analizar(fechasJulio().filter(f => !faltantes.has(f)).map(f => t(f, '08:00', '16:00')))
    const p = r.objetivos[0].patrones[0]
    expect(p.dias_cumplidos).toBe(28)
    expect(p.clasificacion).toBe('fuerte') // 28/31 = 90%
    expect(p.excepciones.some(e => e.includes('2026-07-10') && e.includes('sin cobertura'))).toBe(true)
  })

  it('excepción de un solo día: franja atípica, sin volverse patrón', () => {
    const r = analizar([
      ...fechasJulio().map(f => t(f, '08:00', '16:00')),
      t('2026-07-15', '10:00', '14:00'),
    ])
    const atipica = r.objetivos[0].patrones.find(p => p.hora_inicio === '10:00')
    expect(atipica?.clasificacion).toBe('excepcion')
    expect(r.objetivos[0].advertencias.some(a => a.includes('atípica'))).toBe(true)
    // El patrón principal no se contamina.
    expect(r.objetivos[0].patrones.find(p => p.hora_inicio === '08:00')?.clasificacion).toBe('fuerte')
  })
})

describe('analizarCoberturaHistorica — exclusiones', () => {
  it('capacitación excluida del patrón (y advertida si es frecuente)', () => {
    const r = analizar([
      ...fechasJulio().map(f => t(f, '08:00', '16:00')),
      ...['2026-07-06', '2026-07-07', '2026-07-08'].map(f => t(f, '08:00', '16:00', { tipo_evento: 'capacitacion' })),
    ])
    // La capacitación no suma una segunda posición esos días.
    expect(r.objetivos[0].patrones[0].posiciones).toBe(1)
    expect(r.objetivos[0].advertencias.some(a => a.includes('capacitación'))).toBe(true)
  })

  it('turno anulado/cancelado/reemplazado excluido', () => {
    const r = analizar(fechasJulio().map((f, i) =>
      t(f, '08:00', '16:00', { estado: ['anulado', 'cancelado', 'reemplazado'][i % 3] })))
    expect(r.objetivos[0]).toBeUndefined() // nada cuenta → objetivo sin análisis
    expect(r.resumen.objetivos_analizados).toBe(0)
  })

  it('cobertura (reemplazo) incluida como servicio real', () => {
    const r = analizar(fechasJulio().map(f => t(f, '08:00', '16:00', { tipo_evento: 'cobertura' })))
    expect(r.objetivos[0].patrones[0].dias_cumplidos).toBe(31)
  })

  it('duplicado técnico contado una sola vez', () => {
    const r = analizar(fechasJulio().flatMap(f => [
      t(f, '08:00', '16:00', { guardia_id: 'g1', puesto_id: 'p1' }),
      t(f, '08:00', '16:00', { guardia_id: 'g1', puesto_id: 'p1' }), // misma fila repetida
    ]))
    expect(r.objetivos[0].patrones[0].posiciones).toBe(1)
  })

  it('posición histórica Principal con simultaneidad: no se asume única', () => {
    const r = analizar(fechasJulio().flatMap(f => [
      t(f, '07:00', '19:00', { puesto_id: 'p-principal', guardia_id: 'g1' }),
      t(f, '07:00', '19:00', { puesto_id: 'p-principal', guardia_id: 'g2' }),
      t(f, '19:00', '07:00', { puesto_id: 'p-principal', guardia_id: 'g3' }),
    ]))
    const diurno = r.objetivos[0].patrones.find(p => p.hora_inicio === '07:00')
    const nocturno = r.objetivos[0].patrones.find(p => p.hora_inicio === '19:00')
    expect(diurno?.posiciones).toBe(2)
    expect(nocturno?.posiciones).toBe(1)
  })

  it('objetivo de prueba excluido', () => {
    const r = analizar(fechasJulio().map(f => t(f, '08:00', '16:00')), {
      objetivos: [{ ...OBJ, es_prueba: true }],
    })
    expect(r.resumen.objetivos_analizados).toBe(0)
  })
})

describe('clasificación por frecuencia (umbrales centralizados)', () => {
  it('fuerte / probable / revisión / excepción / sin información', () => {
    expect(clasificarProporcion(31, 31)).toBe('fuerte')       // 100%
    expect(clasificarProporcion(20, 31)).toBe('probable')     // 65%
    expect(clasificarProporcion(14, 31)).toBe('revision')     // 45%
    expect(clasificarProporcion(2, 31)).toBe('excepcion')     // 6%
    expect(clasificarProporcion(4, 4)).toBe('sin_informacion') // < mínimo comparable
    expect(UMBRALES_PATRON.fuerte).toBe(0.8)
  })

  it('patrón probable de punta a punta del motor', () => {
    // Presente 20 de 31 días, repartido en la semana → probable.
    const presentes = fechasJulio().filter((_, i) => i % 3 !== 2)
    const r = analizar(presentes.map(f => t(f, '08:00', '16:00')))
    expect(r.objetivos[0].patrones[0].clasificacion).toBe('probable')
    expect(r.resumen.con_patron_probable).toBe(1)
  })

  it('requiere revisión de punta a punta del motor', () => {
    // Presente ~45% de los días, repartido.
    const presentes = fechasJulio().filter((_, i) => i % 2 === 0 && i % 6 !== 0)
    const r = analizar(presentes.map(f => t(f, '08:00', '16:00')))
    expect(r.objetivos[0].patrones[0].clasificacion).toBe('revision')
  })

  it('sin información suficiente: objetivo iniciado a fin de mes', () => {
    const r = analizar(['2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31'].map(f => t(f, '08:00', '16:00')))
    const p = r.objetivos[0].patrones[0]
    expect(p.clasificacion).toBe('sin_informacion')
    expect(r.objetivos[0].advertencias.some(a => a.includes('incompleto al inicio'))).toBe(true)
  })
})

describe('comparación con servicios configurados', () => {
  const servicio = (hi: string, hf: string, dias: number[] = [1, 2, 3, 4, 5, 6, 7]): ServicioConfigurado =>
    ({ objetivo_id: 'o1', activo: true, dias_semana: dias, turno_base: { hora_inicio: hi, hora_fin: hf } })

  it('coincide / cantidad diferente / falta configuración / configuración adicional', () => {
    const turnos = fechasJulio().flatMap(f => [
      t(f, '07:00', '19:00', { guardia_id: 'g1' }),
      t(f, '07:00', '19:00', { guardia_id: 'g2' }),
      t(f, '19:00', '07:00', { guardia_id: 'g3' }),
    ])
    // Dos servicios diurnos + uno nocturno → todo coincide.
    const ok = analizar(turnos, { servicios: [servicio('07:00', '19:00'), servicio('07:00', '19:00'), servicio('19:00', '07:00')] })
    expect(ok.objetivos[0].patrones.map(p => p.comparacion)).toEqual(['coincide', 'coincide'])

    // Un solo servicio diurno configurado para 2 posiciones observadas.
    const menos = analizar(turnos, { servicios: [servicio('07:00', '19:00'), servicio('19:00', '07:00')] })
    expect(menos.objetivos[0].patrones.find(p => p.hora_inicio === '07:00')?.comparacion).toBe('cantidad_diferente')

    // Sin servicios → falta configuración.
    const nada = analizar(turnos)
    expect(nada.objetivos[0].patrones[0].comparacion).toBe('falta_configuracion')

    // Servicio configurado en un horario nunca observado → configuración adicional.
    const extra = analizar(turnos, { servicios: [servicio('07:00', '19:00'), servicio('07:00', '19:00'), servicio('19:00', '07:00'), servicio('12:00', '18:00')] })
    expect(extra.objetivos[0].configuracion_adicional).toHaveLength(1)
  })
})

describe('pureza y estabilidad', () => {
  it('no muta las entradas', () => {
    const turnos = fechasJulio().map(f => t(f, '08:00', '16:00'))
    const objetivos = [OBJ]
    const congelar = (v: unknown) => {
      if (v && typeof v === 'object') { Object.freeze(v); Object.values(v as object).forEach(congelar) }
    }
    ;[turnos, objetivos].forEach(congelar)
    const antes = JSON.stringify({ turnos, objetivos })
    expect(() => analizar(turnos, { objetivos })).not.toThrow()
    expect(JSON.stringify({ turnos, objetivos })).toBe(antes)
  })

  it('ejecución repetida: mismo resultado', () => {
    const turnos = fechasJulio().flatMap(f => [t(f, '07:00', '19:00'), t(f, '19:00', '07:00')])
    expect(analizar(turnos)).toEqual(analizar(turnos))
  })

  it('etiquetas de días', () => {
    expect(etiquetaDias([1, 2, 3, 4, 5, 6, 7])).toBe('Todos los días')
    expect(etiquetaDias([6, 7])).toBe('Sáb y Dom')
    expect(etiquetaDias([1, 3])).toBe('Lun, Mié')
  })
})
