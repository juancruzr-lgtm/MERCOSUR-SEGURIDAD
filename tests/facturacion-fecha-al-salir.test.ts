import { describe, expect, it } from 'vitest'
import { fechaCompleta } from '@/lib/facturacion/fecha-campo'

// El campo de fecha guarda recién al salir: mientras se tipea con el teclado numérico el navegador entrega
// fechas a medio cargar (el año va 0002, 0020, 0202, 2026). Ésas no se guardan.
describe('fecha de emisión tipeada', () => {
  it('acepta la fecha completa o vacía', () => {
    expect(fechaCompleta('2026-10-31')).toBe(true)
    expect(fechaCompleta('')).toBe(true)
  })
  it('descarta lo que el navegador entrega a mitad de la carga', () => {
    for (const v of ['0002-10-31', '0020-10-31', '0202-10-31', '2026-10', '31/10/2026']) expect(fechaCompleta(v)).toBe(false)
  })
})
