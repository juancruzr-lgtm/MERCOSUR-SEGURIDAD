import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { filtrarHistorico, nivelHistorico } from '@/lib/legajo-historico'

const ref = (x: { tipo?: string | null; tipo_sugerido?: string | null; empleado_id?: string | null; sugerido?: boolean }) => ({
  tipo: x.tipo ?? null, tipo_sugerido: x.tipo_sugerido ?? null, empleado_id: x.empleado_id ?? null,
  sugerido: x.sugerido ? { id: 'e', nombre: 'A', apellido: 'B', legajo: null, estado: 'activo' } : null,
})

describe('Archivo histórico: filtros de la bandeja', () => {
  const lista = [ref({ tipo_sugerido: 'dni', sugerido: true }), ref({ tipo: 'cuil', tipo_sugerido: 'dni', empleado_id: 'x' }), ref({}), ref({ tipo_sugerido: 'dni' })]
  it('por categoría: asignada pisa a sugerida; "(sin)" = sin categoría', () => {
    expect(filtrarHistorico(lista, { categoria: 'dni' })).toHaveLength(2)
    expect(filtrarHistorico(lista, { categoria: 'cuil' })).toHaveLength(1)
    expect(filtrarHistorico(lista, { categoria: '(sin)' })).toHaveLength(1)
  })
  it('sólo sin persona asociada', () => {
    expect(filtrarHistorico(lista, { soloSinPersona: true })).toHaveLength(2)
  })
})

describe('Archivo histórico: localizar o asociar no es validar', () => {
  it('ningún nivel previo a Documentación dice "válido", "vigente" ni "aprobado"', () => {
    for (const e of ['pendiente', 'conflicto', 'aceptada', 'importada', 'descartada', 'separada'] as const) {
      expect(nivelHistorico(e).texto).not.toMatch(/v[áa]lid[oa]\b|vigente|aprobad/i)
    }
    expect(nivelHistorico('aceptada').texto).toMatch(/sin validar/)
  })
  it('la matriz documental no cuenta referencias históricas (sólo documentos del legajo)', () => {
    const matriz = readFileSync(join(__dirname, '..', 'components', 'documentacion', 'MatrizDocumentacion.tsx'), 'utf8')
    expect(matriz).not.toMatch(/historic|legajo_historico/i)
  })
})

describe('Archivo histórico: categoría fuera del catálogo vigente', () => {
  it('se puede filtrar y no se confunde con «sin categoría»', () => {
    const lista = [ref({ tipo_sugerido: 'alta_art' }), ref({ tipo_sugerido: 'dni' }), ref({})]
    expect(filtrarHistorico(lista, { categoria: '(fuera)', activas: ['dni'] }).map(p => p.tipo_sugerido)).toEqual(['alta_art'])
    expect(filtrarHistorico(lista, { categoria: '(sin)', activas: ['dni'] })).toHaveLength(1)
  })
})
