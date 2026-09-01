import { describe, expect, it } from 'vitest'
import {
  ETIQUETA_TURNO_SIN_OBLIGACION, admiteAccionesDePlanilla, resolverTurnoDeFila,
} from '@/lib/planilla-acciones'

// El caso real: 1º de septiembre de 2026, planilla de agosto abierta, seis
// turnos duplicados esperando que alguien los anule. "Anular turno" no hacía
// nada porque buscaba el turno en la lista del mes en curso.

const agosto = [
  { id: 'ago-1', fecha: '2026-08-07' },
  { id: 'ago-2', fecha: '2026-08-08' },
]
const mesEnCurso = [
  { id: 'sep-1', fecha: '2026-09-01' },
]

describe('la acción de una fila se resuelve contra el mes que se está mirando', () => {
  it('encuentra un turno del mes visible aunque no esté en la lista global', () => {
    expect(resolverTurnoDeFila('ago-1', agosto, mesEnCurso)?.id).toBe('ago-1')
  })

  it('con la lista global vacía sigue encontrándolo', () => {
    expect(resolverTurnoDeFila('ago-2', agosto, [])?.id).toBe('ago-2')
  })

  it('el mes visible gana sobre la lista global cuando el id está en las dos', () => {
    const visible = [{ id: 'x', fecha: '2026-08-07' }]
    const global = [{ id: 'x', fecha: '2026-09-01' }]
    expect(resolverTurnoDeFila('x', visible, global)?.fecha).toBe('2026-08-07')
  })

  it('usa la lista global de respaldo si la fila no vino del mes visible', () => {
    expect(resolverTurnoDeFila('sep-1', agosto, mesEnCurso)?.id).toBe('sep-1')
  })

  it('devuelve undefined si no está en ninguna, sin romperse', () => {
    expect(resolverTurnoDeFila('no-existe', agosto, mesEnCurso)).toBeUndefined()
  })

  it('un id vacío no devuelve la primera fila por accidente', () => {
    expect(resolverTurnoDeFila('', agosto, mesEnCurso)).toBeUndefined()
  })
})

// ── Un turno anulado tiene que decir que lo está ────────────────────────────
//
// El caso real: seis turnos duplicados de agosto. Al anularlos, la fila seguía
// diciendo "Descubierto" y el botón "Anular turno" seguía ahí. Se podía anular
// lo mismo una y otra vez —la API responde `sin_cambios`, sin error— y desde
// afuera parecía que no se guardaba nada.

describe('la planilla no ofrece anular lo que ya está fuera del mes', () => {
  it('los tres estados sin obligación tienen su propia etiqueta', () => {
    expect(ETIQUETA_TURNO_SIN_OBLIGACION.anulado).toBe('Anulado')
    expect(ETIQUETA_TURNO_SIN_OBLIGACION.cancelado).toBe('Cancelado')
    expect(ETIQUETA_TURNO_SIN_OBLIGACION.reemplazado).toBe('Reemplazado')
  })

  it('no se puede volver a anular un turno anulado', () => {
    expect(admiteAccionesDePlanilla('Anulado')).toBe(false)
  })

  it('tampoco un cancelado ni un reemplazado', () => {
    expect(admiteAccionesDePlanilla('Cancelado')).toBe(false)
    expect(admiteAccionesDePlanilla('Reemplazado')).toBe(false)
  })

  it('un descubierto sí se puede anular: es justamente el caso de uso', () => {
    expect(admiteAccionesDePlanilla('Descubierto')).toBe(true)
  })

  it('los estados normales siguen admitiendo acciones', () => {
    for (const e of ['Cubierto', 'Tarde', 'En curso', 'Sin fichar', 'Programado', 'Manual']) {
      expect(admiteAccionesDePlanilla(e)).toBe(true)
    }
  })
})
