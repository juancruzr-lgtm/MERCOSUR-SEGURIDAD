import { describe, expect, it } from 'vitest'
import { cargarTurnosVentana, ventanaTurnosPantalla } from '@/lib/turnos-carga'
import { fetchEnLotesResult } from '@/lib/fetch-paginado'

// F-03 (auditoría funcional 19/11/2026): Admin → Turnos → «Mes actual»
// mostraba 1.000 turnos cuando noviembre tenía 1.120. PostgREST corta en 1000
// filas sin error. Estas pruebas usan un builder falso que imita a supabase-js
// y que, como el servidor, nunca devuelve más de 1000 filas por pedido.

type Fila = { id: string; fecha: string }

const TOPE = 1000

/** Builder encadenable: registra filtros, orden y range; corta en TOPE. */
function clienteFalso(filas: Fila[]) {
  const pedidos: Array<{ tabla: string; filtros: string[]; orden: string[]; rango: [number, number] | null }> = []
  const cliente = {
    from(tabla: string) {
      const p = { tabla, filtros: [] as string[], orden: [] as string[], rango: null as [number, number] | null }
      let datos = [...filas]
      const b: any = {
        select: () => b,
        gte: (c: keyof Fila, v: string) => { p.filtros.push(`${c}>=${v}`); datos = datos.filter(f => f[c] >= v); return b },
        lt: (c: keyof Fila, v: string) => { p.filtros.push(`${c}<${v}`); datos = datos.filter(f => f[c] < v); return b },
        order: (c: string, o?: { ascending?: boolean }) => {
          p.orden.push(`${c}:${o?.ascending === false ? 'desc' : 'asc'}`)
          return b
        },
        range: (desde: number, hasta: number) => {
          p.rango = [desde, hasta]
          pedidos.push(p)
          // Orden estable fecha desc + id asc, como lo pide la carga.
          const ordenadas = datos.sort((a, z) => (a.fecha === z.fecha ? a.id.localeCompare(z.id) : z.fecha.localeCompare(a.fecha)))
          const fin = Math.min(hasta, desde + TOPE - 1)
          return Promise.resolve({ data: ordenadas.slice(desde, fin + 1), error: null })
        },
        // Sin .range(): lo que hacía la pantalla antes — el servidor corta igual.
        then: (ok: any) => ok({ data: datos.slice(0, TOPE), error: null }),
      }
      return b
    },
  }
  return { cliente, pedidos }
}

/** 1.120 turnos de noviembre 2026 (el caso real) + algunos de otros meses. */
function noviembre(): Fila[] {
  const filas: Fila[] = []
  for (let i = 0; i < 1120; i++) {
    const dia = String((i % 30) + 1).padStart(2, '0')
    filas.push({ id: `t-${String(i).padStart(5, '0')}`, fecha: `2026-11-${dia}` })
  }
  filas.push({ id: 'oct-30', fecha: '2026-10-30' })
  filas.push({ id: 'oct-31', fecha: '2026-10-31' })
  filas.push({ id: 'dic-01', fecha: '2026-12-01' })
  return filas
}

describe('cargarTurnosVentana — F-03, mes con más de 1000 turnos', () => {
  it('sin paginar, el builder corta en 1000 (reproduce el bug)', async () => {
    const { cliente } = clienteFalso(noviembre())
    const { data } = await (cliente.from('turnos') as any).select('*')
    expect(data).toHaveLength(1000)
  })

  it('trae los 1.120 turnos de noviembre (más el 31/10 de la ventana)', async () => {
    const { cliente, pedidos } = clienteFalso(noviembre())
    const { data, error } = await cargarTurnosVentana<Fila>(cliente, '2026-10-31', '2026-12-01')
    expect(error).toBeNull()
    expect(data.filter(t => t.fecha.startsWith('2026-11'))).toHaveLength(1120)
    expect(data).toHaveLength(1121)
    expect(new Set(data.map(t => t.id)).size).toBe(1121)
    expect(pedidos.map(p => p.rango)).toEqual([[0, 999], [1000, 1999]])
  })

  it('pide la tabla turnos con la ventana y orden estable (fecha desc + id)', async () => {
    const { cliente, pedidos } = clienteFalso(noviembre())
    await cargarTurnosVentana(cliente, '2026-10-31', '2026-12-01')
    expect(pedidos[0].tabla).toBe('turnos')
    expect(pedidos[0].filtros).toEqual(['fecha>=2026-10-31', 'fecha<2026-12-01'])
    expect(pedidos[0].orden).toEqual(['fecha:desc', 'id:asc'])
  })

  it('un error del servidor vuelve como error, no como lista truncada', async () => {
    const cliente = { from: () => {
      const b: any = { select: () => b, gte: () => b, lt: () => b, order: () => b,
        range: () => Promise.resolve({ data: null, error: { message: 'timeout' } }) }
      return b
    } }
    const r = await cargarTurnosVentana(cliente, '2026-10-31', '2026-12-01')
    expect(r.data).toEqual([])
    expect(r.error).toEqual({ message: 'timeout' })
  })
})

describe('ventanaTurnosPantalla', () => {
  it('a mitad de mes: del último día del mes anterior al 1° del siguiente', () => {
    expect(ventanaTurnosPantalla('2026-11-20')).toEqual({ desde: '2026-10-31', hastaExclusivo: '2026-12-01' })
  })
  it('a fin de mes cubre «Próximos 7 días» en el mes siguiente', () => {
    expect(ventanaTurnosPantalla('2026-11-28')).toEqual({ desde: '2026-10-31', hastaExclusivo: '2026-12-05' })
  })
  it('diciembre cruza de año', () => {
    expect(ventanaTurnosPantalla('2026-12-10')).toEqual({ desde: '2026-11-30', hastaExclusivo: '2027-01-01' })
  })
})

describe('fetchEnLotesResult — .in() con listas largas', () => {
  it('parte 1.120 ids en lotes y pagina cada lote: no pierde filas', async () => {
    const ids = Array.from({ length: 1120 }, (_, i) => i)
    // Cada turno tiene 2 registros: 2.240 filas en total.
    const lotes: number[][] = []
    const r = await fetchEnLotesResult<{ turno: number }, number>(ids, (lote, desde, hasta) => {
      if (desde === 0) lotes.push(lote)
      const filas = lote.flatMap(t => [{ turno: t }, { turno: t }])
      const fin = Math.min(hasta, desde + TOPE - 1)
      return Promise.resolve({ data: filas.slice(desde, fin + 1), error: null })
    }, 600)
    expect(r.error).toBeNull()
    expect(r.data).toHaveLength(2240)
    expect(lotes.map(l => l.length)).toEqual([600, 520])
  })

  it('lista vacía: no consulta', async () => {
    let llamadas = 0
    const r = await fetchEnLotesResult([], () => { llamadas++; return Promise.resolve({ data: [], error: null }) })
    expect(r).toEqual({ data: [], error: null })
    expect(llamadas).toBe(0)
  })

  it('un error en cualquier lote vuelve como error', async () => {
    const r = await fetchEnLotesResult([1, 2, 3], (lote) =>
      Promise.resolve(lote[0] === 3 ? { data: null, error: { message: 'x' } } : { data: [lote[0]], error: null }), 2)
    expect(r).toEqual({ data: [], error: { message: 'x' } })
  })
})
