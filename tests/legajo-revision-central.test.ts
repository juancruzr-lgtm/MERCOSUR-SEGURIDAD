import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  agruparPorEmpleado, contarRevision, enFiltroRevision, enlaceArchivoHistorico, esFiltroRevision, listaDeResumen, marcaInvestigacion,
  personaDe, siguienteEnCola,
} from '@/lib/legajo-historico'
import type { PropuestaHistorica } from '@/lib/legajo-historico'

const per = (id: string, apellido: string) => ({ id, nombre: 'N', apellido, legajo: null, estado: 'activo' })
const p = (x: Partial<PropuestaHistorica>) => ({ estado: 'pendiente', senales: {}, sugerido: null, empleado: null, ...x }) as PropuestaHistorica
const inv = { investigar: { motivo: 'Pedir el legajo en papel', at: '2026-10-14T12:00:00Z' } }

describe('Bandeja central: listas', () => {
  const lista = [
    p({ id: 'a' }), p({ id: 'b', estado: 'conflicto' }), p({ id: 'c', senales: inv }), p({ id: 'd', estado: 'conflicto', senales: inv }),
    p({ id: 'e', estado: 'aceptada' }), p({ id: 'f', estado: 'importada' }), p({ id: 'g', estado: 'descartada' }), p({ id: 'h', estado: 'separada' }),
  ]
  it('pendientes y conflictos no incluyen lo que se dejó para investigar', () => {
    expect(lista.filter(x => enFiltroRevision(x, 'pendientes')).map(x => x.id)).toEqual(['a'])
    expect(lista.filter(x => enFiltroRevision(x, 'conflictos')).map(x => x.id)).toEqual(['b'])
    expect(lista.filter(x => enFiltroRevision(x, 'investigar')).map(x => x.id)).toEqual(['c', 'd'])
  })
  it('revisadas = asociadas, copiadas al legajo o descartadas (las separadas se revisan por partes)', () => {
    expect(lista.filter(x => enFiltroRevision(x, 'revisadas')).map(x => x.id)).toEqual(['e', 'f', 'g'])
  })
  it('una aceptada con marca vieja de investigación no figura como «para investigar»', () => {
    expect(enFiltroRevision(p({ estado: 'aceptada', senales: inv }), 'investigar')).toBe(false)
  })
  it('conteos', () => {
    expect(contarRevision(lista)).toEqual({ pendientes: 1, conflictos: 1, investigar: 2, revisadas: 3 })
  })
  it('marca de investigación', () => {
    expect(marcaInvestigacion(p({ senales: inv }))?.motivo).toBe('Pedir el legajo en papel')
    expect(marcaInvestigacion(p({}))).toBeNull()
  })
})

describe('Bandeja central: agrupar por empleado', () => {
  it('la persona asociada manda sobre la sugerida', () => {
    expect(personaDe(p({ sugerido: per('1', 'Pérez'), empleado: per('2', 'Suárez') }))?.apellido).toBe('Suárez')
  })
  it('alfabético y lo que no tiene persona al final', () => {
    const g = agruparPorEmpleado([
      p({ id: 'x' }), p({ id: 'a', sugerido: per('2', 'Suárez') }), p({ id: 'b', sugerido: per('1', 'Álvarez') }), p({ id: 'c', sugerido: per('2', 'Suárez') }),
    ])
    expect(g.map(x => x.nombre.split(',')[0])).toEqual(['Álvarez', 'Suárez', 'Sin persona identificada'])
    expect(g[1].items.map(x => x.id)).toEqual(['a', 'c'])
  })
})

describe('Bandeja central: pasar al siguiente sin volver a buscar', () => {
  const cola = ['a', 'b', 'c', 'd']
  it('va al siguiente que sigue en la lista', () => {
    expect(siguienteEnCola(cola, 'a', new Set(['b', 'c', 'd']))).toBe('b')
  })
  it('saltea los que ya se resolvieron (por esta u otra persona)', () => {
    expect(siguienteEnCola(cola, 'a', new Set(['d']))).toBe('d')
  })
  it('al final, vuelve a los que quedaron antes (p. ej., los que se saltearon)', () => {
    expect(siguienteEnCola(cola, 'd', new Set(['b']))).toBe('b')
  })
  it('sin pendientes, termina', () => {
    expect(siguienteEnCola(cola, 'c', new Set())).toBeNull()
  })
})

describe('Desde el legajo: directo a la bandeja filtrada', () => {
  const id = '680be3c6-4dc7-49ea-b269-ae5e82eb68f3'
  it('enlace con persona (por id) y lista', () => {
    expect(enlaceArchivoHistorico(id, 'pendientes')).toBe(`/dashboard?page=legajo_historico&empleado=${id}&ver=pendientes`)
    expect(enlaceArchivoHistorico(id)).toBe(`/dashboard?page=legajo_historico&empleado=${id}`)
  })
  it('lleva a pendientes; si sólo hay conflictos, a conflictos', () => {
    expect(listaDeResumen({ pendientes: 2, conflictos: 1, asociadas: 0, copiadas: 0 })).toBe('pendientes')
    expect(listaDeResumen({ pendientes: 0, conflictos: 1, asociadas: 0, copiadas: 0 })).toBe('conflictos')
  })
  it('sólo acepta listas conocidas desde la dirección', () => {
    expect(esFiltroRevision('revisadas')).toBe(true)
    expect(esFiltroRevision('<script>')).toBe(false)
  })
  it('el bloque del legajo enlaza cada fila de MEGA con su lista', () => {
    const s = readFileSync(join(__dirname, '..', 'components', 'documentacion', 'DocumentacionLegajo.tsx'), 'utf8')
    expect(s).toMatch(/enlaceArchivoHistorico\(empleadoId, listaDeResumen\(resumen\)\)/)
    expect(s).toMatch(/enlaceArchivoHistorico\(empleadoId, 'revisadas'\)/)
  })
})

describe('Identidad ≠ validación documental', () => {
  const s = readFileSync(join(__dirname, '..', 'components', 'legajo', 'BandejaHistorico.tsx'), 'utf8')
  it('la pantalla lo dice donde se confirma', () => {
    expect(s).toMatch(/Esto no lo valida: la validación del legajo se hace después, en Documentación/)
  })
  it('la bandeja no valida ni copia documentos (no llama a Documentación)', () => {
    expect(s).not.toMatch(/revisarDocumento|documentacion_documentos|importar/)
  })
})
