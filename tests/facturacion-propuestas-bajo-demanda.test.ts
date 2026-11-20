// F-13: abrir Prefacturas (u Horas) NO calcula las propuestas de horas; se calculan con el botón
// «Calcular propuestas» y, al salir de la pantalla, los pedidos en curso se abortan.
// No hay DOM en las pruebas: un mini "React" de prueba ejecuta los hooks (estado, efectos y su
// limpieza) para simular montar, volver a dibujar y desmontar.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rt = vi.hoisted(() => ({
  estados: [] as any[], i: 0, refs: [] as any[], r: 0,
  efectos: [] as Array<() => void | (() => void)>, limpiezas: [] as Array<() => void>, registrar: true,
}))
vi.mock('react', async (original) => {
  const R: any = await original()
  return {
    ...R,
    useState: (ini: any) => {
      const k = rt.i++
      if (!(k in rt.estados)) rt.estados[k] = typeof ini === 'function' ? ini() : ini
      return [rt.estados[k], (v: any) => { rt.estados[k] = typeof v === 'function' ? v(rt.estados[k]) : v }]
    },
    useEffect: (fn: any) => { if (rt.registrar) rt.efectos.push(fn) },
    useRef: (ini: any) => { const k = rt.r++; if (!(k in rt.refs)) rt.refs[k] = { current: ini }; return rt.refs[k] },
    useCallback: (fn: any) => fn,
  }
})

const api = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) }, from: () => ({}), rpc: async () => ({ data: null, error: null }) } }))
vi.mock('@/lib/facturacion/datos', async (original) => ({
  ...(await original() as any),
  api,
  rpc: async () => null,
  leer: async (tabla: string) => tabla === 'fact_contratos'
    ? [{ id: 'c1', nombre: 'Contrato', modalidad: 'por_hora', agrupacion: 'objetivo', cliente: { razon_social: 'Cliente', cuit: '1' } }]
    : tabla === 'fact_contrato_objetivos'
      ? [{ contrato_id: 'c1', objetivo_id: 'o1', objetivo: { nombre: 'Objetivo 1' } }, { contrato_id: 'c1', objetivo_id: 'o2', objetivo: { nombre: 'Objetivo 2' } }]
      : [],
}))
vi.mock('@/components/facturacion/comun', async (original) => ({
  ...(await original() as any),
  useAccion: () => ({ ocupado: false, correr: (fn: () => Promise<unknown>) => { void fn() }, Mensaje: () => null }),
}))
vi.mock('@/components/facturacion/periodo', async (original) => ({
  ...(await original() as any),
  useOperacion: () => ({ operacion: null, recargarOperacion: async () => {} }),
}))

const nuevoCiclo = () => { rt.estados = []; rt.refs = []; rt.efectos = []; rt.limpiezas = []; rt.registrar = true }
/** Dibuja el componente una vez (los efectos se registran sólo en el primer dibujo: deps sin cambios). */
const dibujar = <T,>(fn: () => T): T => { rt.i = 0; rt.r = 0; const x = fn(); rt.registrar = false; return x }
const montar = () => { for (const e of rt.efectos) { const l = e(); if (typeof l === 'function') rt.limpiezas.push(l) } }
const desmontar = () => { rt.limpiezas.forEach(l => l()); rt.limpiezas = [] }
const esperar = () => new Promise(r => setTimeout(r, 0))
function buscar(nodo: any, pred: (p: any) => boolean): any {
  if (!nodo || typeof nodo !== 'object') return null
  if (Array.isArray(nodo)) { for (const n of nodo) { const x = buscar(n, pred); if (x) return x } return null }
  if (nodo.props && pred(nodo.props)) return nodo
  return buscar(nodo.props?.children, pred)
}

describe('Prefacturas: propuestas de horas bajo demanda (F-13)', () => {
  beforeEach(async () => {
    nuevoCiclo(); api.mockReset()
    const { limpiarCachePropuestas } = await import('@/components/facturacion/usePropuestasHoras')
    limpiarCachePropuestas()
  })
  const props = { mes: '2026-10', usuarios: [], config: { emision: null, modulos: null }, periodo: { mes: '2026-10', estado: 'vencido', habilitado: true, excepcion: null, esGerencia: false, motivo: null } as any }

  it('montar la pantalla no pide ninguna propuesta; desmontar aborta las que estén en curso', async () => {
    const { default: Bandeja } = await import('@/components/facturacion/Bandeja')
    dibujar(() => Bandeja(props))
    montar()
    await esperar(); await esperar()
    expect(api).not.toHaveBeenCalled()

    // El usuario toca «Calcular propuestas»: recién ahí se piden (y quedan colgadas, como un cálculo de 10 s).
    const señales: AbortSignal[] = []
    api.mockImplementation((_r: string, _c: any, _m: string, op: { signal: AbortSignal }) => { señales.push(op.signal); return new Promise(() => {}) })
    const arbol = dibujar(() => Bandeja(props))
    const boton = buscar(arbol, p => p['data-testid'] === 'calcular-propuestas')
    expect(boton.props.children).toContain('Calcular propuestas (2)')
    boton.props.onClick()
    await esperar()
    expect(api).toHaveBeenCalledTimes(2)
    expect(api.mock.calls.map(c => [c[0], c[1].accion, c[1].objetivo_id])).toEqual([['horas', 'proponer', 'o1'], ['horas', 'proponer', 'o2']])
    expect(señales.every(s => !s.aborted)).toBe(true)

    desmontar()
    expect(señales.length).toBe(2)
    expect(señales.every(s => s.aborted)).toBe(true)
  })

  it('lo calculado queda en caché por mes: volver a abrir no vuelve a pedir, y el botón pasa a «Recalcular»', async () => {
    const { usePropuestasHoras } = await import('@/components/facturacion/usePropuestasHoras')
    api.mockImplementation(async (_r: string, c: any) => ({ horas: { minutosCubiertos: 60, objetivo: c.objetivo_id } }))
    const h = dibujar(() => usePropuestasHoras('2026-10')); montar()
    await h.calcular([{ contratoId: 'c1', objetivoId: 'o1' }])
    expect(api).toHaveBeenCalledTimes(1)
    desmontar()

    // Otra vez la pantalla (mismo mes): arranca con la propuesta en caché y no pide nada.
    nuevoCiclo()
    const h2 = dibujar(() => usePropuestasHoras('2026-10')); montar()
    expect(h2.props['c1:o1'].propuesta.horas.objetivo).toBe('o1')
    await h2.calcular([{ contratoId: 'c1', objetivoId: 'o1' }])
    expect(api).toHaveBeenCalledTimes(1)
    // Forzado (Recalcular) sí vuelve a pedir; otro mes no comparte caché.
    await h2.calcular([{ contratoId: 'c1', objetivoId: 'o1' }], { forzar: true })
    expect(api).toHaveBeenCalledTimes(2)
    nuevoCiclo()
    const h3 = dibujar(() => usePropuestasHoras('2026-09')); montar()
    expect(h3.props).toEqual({})
  })

  it('un error queda marcado y se reintenta; un aborto no se registra como error', async () => {
    const { calcularPropuestas } = await import('@/components/facturacion/usePropuestasHoras')
    api.mockRejectedValueOnce(new Error('Error 500'))
    const vistos: Record<string, any> = {}
    await calcularPropuestas([{ contratoId: 'c1', objetivoId: 'o1' }], '2026-10', { signal: new AbortController().signal, alObtener: (k, v) => { vistos[k] = v } })
    expect(vistos['c1:o1']).toEqual({ propuesta: null, error: 'Error 500' })

    const ctrl = new AbortController()
    api.mockImplementation((_r: string, _c: any, _m: string, op: { signal: AbortSignal }) => new Promise((_, no) => op.signal.addEventListener('abort', () => no(Object.assign(new Error('aborted'), { name: 'AbortError' })))))
    const otros: Record<string, any> = {}
    const p = calcularPropuestas([{ contratoId: 'c1', objetivoId: 'o1' }, { contratoId: 'c1', objetivoId: 'o2' }, { contratoId: 'c1', objetivoId: 'o3' }], '2026-10', { signal: ctrl.signal, alObtener: (k, v) => { otros[k] = v }, concurrencia: 1 })
    ctrl.abort()
    await p
    expect(otros).toEqual({})
    expect(api).toHaveBeenCalledTimes(2) // el error + el primero del lote abortado; o2 y o3 nunca se piden
  })
})
