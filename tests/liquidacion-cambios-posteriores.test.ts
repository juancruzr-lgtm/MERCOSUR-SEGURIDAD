import { describe, it, expect } from 'vitest'
import { compararEnviadoVsActual, type LineaComparable } from '@/lib/liquidacion-cambios'

// Comparador PURO del banner "cambios operativos posteriores al archivo enviado a
// Visual". No toca DB: se le pasan las líneas enviadas (congeladas) y las que se
// enviarían hoy (vivo). Read-only: sólo describe diferencias.

const L = (cuil: string, codigo: string, cantidad: number | null, importe: number | null): LineaComparable =>
  ({ cuil, codigo, cantidad, importe })

describe('compararEnviadoVsActual', () => {
  it('sin cambios → no hay banner', () => {
    const base = [L('20111111111', '001', 1, 1000), L('20111111111', '000', 20, null)]
    const r = compararEnviadoVsActual(base, base.map(x => ({ ...x })))
    expect(r.hayCambios).toBe(false)
    expect(r.cantidad).toBe(0)
    expect(r.personas).toBe(0)
  })

  it('importe modificado → detecta el cambio con antes/ahora', () => {
    const enviado = [L('20111111111', '001', 1, 1000)]
    const actual = [L('20111111111', '001', 1, 1500)]
    const r = compararEnviadoVsActual(enviado, actual)
    expect(r.hayCambios).toBe(true)
    expect(r.cantidad).toBe(1)
    expect(r.personas).toBe(1)
    const d = r.detalle[0]
    expect(d.tipo).toBe('modificado')
    expect(d.campo).toBe('importe')
    expect(d.antes).toBe(1000)
    expect(d.ahora).toBe(1500)
  })

  it('línea nueva que hoy aparecería → agregado', () => {
    const enviado = [L('20111111111', '001', 1, 1000)]
    const actual = [L('20111111111', '001', 1, 1000), L('20111111111', '006', 2, 800)]
    const r = compararEnviadoVsActual(enviado, actual)
    expect(r.hayCambios).toBe(true)
    expect(r.detalle.some(d => d.tipo === 'agregado' && d.codigo === '006')).toBe(true)
  })

  it('línea que ya no saldría → quitado', () => {
    const enviado = [L('20111111111', '001', 1, 1000), L('20111111111', '006', 2, 800)]
    const actual = [L('20111111111', '001', 1, 1000)]
    const r = compararEnviadoVsActual(enviado, actual)
    expect(r.hayCambios).toBe(true)
    expect(r.detalle.some(d => d.tipo === 'quitado' && d.codigo === '006')).toBe(true)
  })

  it('cuenta personas afectadas (por CUIL), no líneas', () => {
    const enviado = [L('20111111111', '001', 1, 1000), L('20222222222', '001', 1, 1000)]
    const actual = [L('20111111111', '001', 1, 1100), L('20222222222', '001', 1, 1200)]
    const r = compararEnviadoVsActual(enviado, actual)
    expect(r.personas).toBe(2)
    expect(r.cantidad).toBe(2)
  })

  it('diferencia menor a un centavo no cuenta como cambio', () => {
    const enviado = [L('20111111111', '001', 1, 1000.00)]
    const actual = [L('20111111111', '001', 1, 1000.004)]
    const r = compararEnviadoVsActual(enviado, actual)
    expect(r.hayCambios).toBe(false)
  })
})
