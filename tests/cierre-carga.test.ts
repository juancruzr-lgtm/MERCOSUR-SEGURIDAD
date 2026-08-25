import { describe, expect, it } from 'vitest'
import { cargarItemsCierre } from '@/lib/cierre-datos'

// La carga del cierre contra un cliente de mentira.
//
// Lo que se prueba acá no es el SQL: es qué pasa cuando una de las ocho fuentes
// falla. Es el caso que se escapó en producción — ronda_alertas y
// evidencia_analisis devolvían 300 (dos claves foráneas a `usuarios`, embed
// ambiguo) y la pantalla mostraba CERO pendientes sin ningún error. En una
// pantalla cuyo objetivo es llegar a cero, un cero falso es el peor resultado
// posible: dice "andá a tu casa" cuando quedaban dieciséis rondas sin resolver.

/** Cliente encadenable: todo devuelve [] salvo las tablas que se le indiquen. */
function clienteFalso(porTabla: Record<string, { data?: any[]; error?: any }> = {}) {
  const pedidas: string[] = []
  return {
    pedidas,
    from(tabla: string) {
      pedidas.push(tabla)
      const respuesta = porTabla[tabla] ?? { data: [], error: null }
      const resultado = { data: respuesta.data ?? [], error: respuesta.error ?? null }
      const q: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === 'then') {
            return (resolve: any) => resolve(resultado)
          }
          return () => q
        },
      })
      return q
    },
  }
}

const PARAMS = {
  mes: '2026-08', fechaOperativa: '2026-08-25', esAdmin: true, usuarioId: null,
}

describe('una fuente caída no puede verse como un día sin pendientes', () => {
  it('sin errores, devuelve items y no error', async () => {
    const r = await cargarItemsCierre({ ...PARAMS, client: clienteFalso() })
    expect(r.error).toBeNull()
    expect(r.items).toEqual([])
  })

  it('si ronda_alertas falla, el cierre falla — no devuelve cero', async () => {
    const r = await cargarItemsCierre({
      ...PARAMS,
      client: clienteFalso({ ronda_alertas: { error: { message: 'Multiple Choices' } } }),
    })
    expect(r.error).toContain('ronda_alertas')
    expect(r.items).toEqual([])
  })

  it('si evidencia_analisis falla, también', async () => {
    const r = await cargarItemsCierre({
      ...PARAMS,
      client: clienteFalso({ evidencia_analisis: { error: { message: 'Multiple Choices' } } }),
    })
    expect(r.error).toContain('evidencia_analisis')
  })

  it('el error nombra la tabla, para poder ubicarlo', async () => {
    const r = await cargarItemsCierre({
      ...PARAMS,
      client: clienteFalso({ supervisor_intervenciones: { error: { message: 'boom' } } }),
    })
    expect(r.error).toBe('supervisor_intervenciones: boom')
  })

  it('cada fuente del cierre se consulta', async () => {
    const c = clienteFalso()
    await cargarItemsCierre({ ...PARAMS, client: c })
    for (const tabla of [
      'objetivos', 'rondas_base', 'ronda_alertas', 'evidencia_analisis',
      'turnos', 'registros_asistencia', 'supervisor_intervenciones', 'usuarios',
    ]) {
      expect(c.pedidas).toContain(tabla)
    }
  })

  it('no se le pide a PostgREST ningún embed de usuarios: es ambiguo', async () => {
    // Dos FK a `usuarios` en las dos tablas —vigilador y quien revisó—. Pedir
    // `usuarios(...)` sin decir cuál devuelve 300 y `data` en null. Los nombres
    // se resuelven contra el catálogo que la función ya trae.
    const selects: string[] = []
    const client = {
      from(tabla: string) {
        const q: any = new Proxy({}, {
          get(_t, prop) {
            if (prop === 'then') return (resolve: any) => resolve({ data: [], error: null })
            if (prop === 'select') return (cols: string) => { selects.push(`${tabla}:${cols}`); return q }
            return () => q
          },
        })
        return q
      },
    }
    await cargarItemsCierre({ ...PARAMS, client })
    const sospechosos = selects.filter(s =>
      (s.startsWith('ronda_alertas:') || s.startsWith('evidencia_analisis:')) &&
      s.includes('usuarios('))
    expect(sospechosos).toEqual([])
  })
})
