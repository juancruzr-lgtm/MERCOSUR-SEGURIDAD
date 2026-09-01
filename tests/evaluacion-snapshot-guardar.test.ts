import { beforeEach, describe, expect, it, vi } from 'vitest'
import { guardarSnapshot } from '@/lib/evaluacion-snapshot-guardar'

// El upsert reemplaza la fila entera. La regla que se prueba acá es que volver a
// congelar un mes NO despublique lo que la gente ya vio.

const estadoDeLaBase: { filas: any[] } = { filas: [] }
const capturado: { filas: any[] | null } = { filas: null }

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => Promise.resolve({ data: estadoDeLaBase.filas, error: null }) }),
      upsert: (filas: any[]) => {
        capturado.filas = filas
        return Promise.resolve({ error: null })
      },
    }),
  },
}))


const persona = (id: string) => ({
  desempeno: {
    empleadoId: id,
    empleado: 'X',
    objetivos: ['ACA'],
    jornadas: [{}, {}],
    cumplimiento: { puntaje: 9, estado: 'excelente', dimensiones: [] },
    evaluacion: {
      desempeno: 8.5, notaFinal: 8.5, concepto: 'Muy bueno', alcance: 'integral',
      cobertura: { ajustada: 1 }, faltas: [], explicacion: 'ok',
    },
  },
} as any)

beforeEach(() => {
  estadoDeLaBase.filas = []
  capturado.filas = null
})

describe('congelar un mes no despublica lo ya publicado', () => {
  it('la fila publicada conserva estado y fecha de publicación', async () => {
    estadoDeLaBase.filas = [{
      empleado_id: 'a', estado: 'publicada',
      publicado_at: '2026-09-01T10:00:00Z', publicado_por: 'jefe',
    }]

    const r = await guardarSnapshot([persona('a')], '2026-08', 'admin')

    expect(r.error).toBeNull()
    expect(r.publicadasPreservadas).toBe(1)
    expect(capturado.filas![0].estado).toBe('publicada')
    expect(capturado.filas![0].publicado_at).toBe('2026-09-01T10:00:00Z')
    expect(capturado.filas![0].publicado_por).toBe('jefe')
  })

  it('una fila nueva queda en calculada y sin fecha de publicación', async () => {
    const r = await guardarSnapshot([persona('b')], '2026-08', 'admin')

    expect(r.guardadas).toBe(1)
    expect(r.publicadasPreservadas).toBe(0)
    expect(capturado.filas![0].estado).toBe('calculada')
    expect(capturado.filas![0].publicado_at).toBeNull()
  })

  it('una fila en calculada o revisada se puede volver a congelar', async () => {
    estadoDeLaBase.filas = [{
      empleado_id: 'c', estado: 'revisada', publicado_at: null, publicado_por: null,
    }]

    await guardarSnapshot([persona('c')], '2026-08', 'admin')

    // Revisada no es publicada: nadie la vio, así que recalcular es inocuo.
    expect(capturado.filas![0].estado).toBe('calculada')
  })

  it('deja rastro de quién la generó', async () => {
    await guardarSnapshot([persona('d')], '2026-08', 'admin-uuid')
    expect(capturado.filas![0].generado_por).toBe('admin-uuid')
    expect(capturado.filas![0].generado_at).toBeTruthy()
  })

  it('sin entradas no toca la base', async () => {
    const r = await guardarSnapshot([], '2026-08', 'admin')
    expect(r.guardadas).toBe(0)
    expect(capturado.filas).toBeNull()
  })
})

describe('las cuatro capas viajan separadas', () => {
  it('el ponderado va de 0 a 100 y la nota de 1 a 10', async () => {
    await guardarSnapshot([persona('e')], '2026-08', 'admin')
    const f = capturado.filas![0]
    expect(f.cumplimiento_ponderado).toBe(90)  // capa 1, NO es la nota
    expect(f.indice).toBe(8.5)                 // capa 3
    expect(f.nota_final).toBe(8.5)             // capa 4
    expect(f.concepto).toBe('Muy bueno')
  })
})
