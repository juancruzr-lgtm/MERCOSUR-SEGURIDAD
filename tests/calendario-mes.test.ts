import { describe, expect, it } from 'vitest'
import {
  ENCABEZADOS_SEMANA, fechasDeAtajo, fechasDelMesCompleto,
  limitesDelMes, rangoDeSeleccion, semanasDelMes,
} from '@/lib/calendario-mes'

// Calendario mensual para elegir días a mano. Agosto 2026 empieza sábado
// y termina lunes 31, así que sirve para verificar el relleno de los bordes.

describe('limitesDelMes', () => {
  it('mes de 31 días', () => {
    expect(limitesDelMes('2026-08')).toEqual({ desde: '2026-08-01', hasta: '2026-08-31' })
  })
  it('mes de 30 días', () => {
    expect(limitesDelMes('2026-09')).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' })
  })
  it('febrero no bisiesto', () => {
    expect(limitesDelMes('2026-02').hasta).toBe('2026-02-28')
  })
  it('febrero bisiesto', () => {
    expect(limitesDelMes('2028-02').hasta).toBe('2028-02-29')
  })
})

describe('fechasDelMesCompleto', () => {
  it('devuelve todos los días en orden', () => {
    const f = fechasDelMesCompleto('2026-08')
    expect(f).toHaveLength(31)
    expect(f[0]).toBe('2026-08-01')
    expect(f[30]).toBe('2026-08-31')
  })
})

describe('semanasDelMes', () => {
  const semanas = semanasDelMes('2026-08')

  it('cada semana tiene 7 posiciones', () => {
    for (const s of semanas) expect(s).toHaveLength(7)
  })

  it('el 1 de agosto de 2026 cae sábado: 5 huecos antes', () => {
    expect(semanas[0].slice(0, 5).every(x => x === null)).toBe(true)
    expect(semanas[0][5]).toBe('2026-08-01')
    expect(semanas[0][6]).toBe('2026-08-02')
  })

  it('completa con huecos al final', () => {
    const ultima = semanas[semanas.length - 1]
    expect(ultima.filter(Boolean).length).toBeGreaterThan(0)
    expect(ultima[ultima.length - 1] === null || typeof ultima[ultima.length - 1] === 'string').toBe(true)
  })

  it('no pierde ni repite ningún día', () => {
    const planas = semanas.flat().filter(Boolean)
    expect(planas).toHaveLength(31)
    expect(new Set(planas).size).toBe(31)
  })

  it('hay un encabezado por columna', () => {
    expect(ENCABEZADOS_SEMANA).toHaveLength(7)
  })

  it('mes que arranca lunes no lleva huecos iniciales', () => {
    // 2026-06-01 es lunes.
    expect(semanasDelMes('2026-06')[0][0]).toBe('2026-06-01')
  })
})

describe('fechasDeAtajo', () => {
  it('todos los días', () => {
    expect(fechasDeAtajo('2026-08', 'todos')).toHaveLength(31)
  })

  it('lunes a viernes deja fuera los fines de semana', () => {
    const f = fechasDeAtajo('2026-08', 'lun_vie')
    expect(f).not.toContain('2026-08-01') // sábado
    expect(f).not.toContain('2026-08-02') // domingo
    expect(f).toContain('2026-08-03')     // lunes
  })

  it('fin de semana', () => {
    const f = fechasDeAtajo('2026-08', 'sab_dom')
    expect(f).toContain('2026-08-01')
    expect(f).toContain('2026-08-02')
    expect(f).not.toContain('2026-08-03')
  })

  it('respeta los días que no se pueden elegir', () => {
    const f = fechasDeAtajo('2026-08', 'todos', fecha => fecha >= '2026-08-15')
    expect(f).toHaveLength(17)
    expect(f[0]).toBe('2026-08-15')
  })

  it('si nada se puede elegir, no devuelve nada', () => {
    expect(fechasDeAtajo('2026-08', 'todos', () => false)).toEqual([])
  })
})

describe('rangoDeSeleccion', () => {
  it('toma el mínimo y el máximo, sin importar el orden', () => {
    expect(rangoDeSeleccion(['2026-08-20', '2026-08-03', '2026-08-11']))
      .toEqual({ desde: '2026-08-03', hasta: '2026-08-20' })
  })

  it('un solo día', () => {
    expect(rangoDeSeleccion(['2026-08-07'])).toEqual({ desde: '2026-08-07', hasta: '2026-08-07' })
  })

  it('selección vacía: null', () => {
    expect(rangoDeSeleccion([])).toBeNull()
  })

  it('funciona con un Set', () => {
    expect(rangoDeSeleccion(new Set(['2026-08-09', '2026-08-02'])))
      .toEqual({ desde: '2026-08-02', hasta: '2026-08-09' })
  })
})
