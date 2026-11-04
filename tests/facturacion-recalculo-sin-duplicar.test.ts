// Recálculo desde la pantalla: si el pedido se corta (timeout del navegador o de la plataforma),
// NO se relanza: se consulta el estado real de la operación en la base hasta que termina.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.fn()
let operaciones: any[] = []
vi.mock('@/lib/facturacion/datos', () => ({
  api: (...a: any[]) => api(...a),
  rpc: vi.fn(),
  leer: async (_t: string) => operaciones.slice(0, 1),
}))

describe('recalcular sin duplicar', () => {
  beforeEach(() => { vi.useFakeTimers(); api.mockReset(); operaciones = [] })
  afterEach(() => vi.useRealTimers())

  it('un timeout no relanza: espera el resultado real y lo devuelve', async () => {
    const { recalcular } = await import('@/components/facturacion/periodo')
    operaciones = [{ id: 'vieja', estado: 'terminada', iniciada_at: '2026-11-04T15:00:00Z' }]
    api.mockImplementationOnce(async () => {
      // El servidor ya empezó (queda registrada) pero el navegador deja de esperar.
      operaciones = [{ id: 'nueva', estado: 'en_curso', iniciada_at: '2026-11-04T16:19:30Z' }]
      throw new TypeError('Failed to fetch')
    })
    const avisos: Array<string | null> = []
    const p = recalcular('2026-10', undefined, t => avisos.push(t))
    await vi.advanceTimersByTimeAsync(5000)
    operaciones = [{ id: 'nueva', estado: 'terminada', iniciada_at: '2026-11-04T16:19:30Z', resultado: { creadas: 2, reagrupadas: 7, errores: [] } }]
    await vi.advanceTimersByTimeAsync(5000)
    const r = await p
    expect(api).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ creadas: 2, reagrupadas: 7, operacion_id: 'nueva', recuperado: true })
    expect(avisos[0]).toMatch(/consultando el estado real/)
    expect(avisos.at(-1)).toBeNull()
  })

  it('si ya hay otra igual en curso (409), espera esa en vez de lanzar otra', async () => {
    const { recalcular } = await import('@/components/facturacion/periodo')
    operaciones = [{ id: 'de-otro', estado: 'en_curso', iniciada_at: '2026-11-04T16:00:00Z' }]
    api.mockRejectedValueOnce(Object.assign(new Error('Ya hay un recálculo de 2026-10 en curso'), { detalle: { codigo: 'operacion_en_curso' } }))
    const p = recalcular('2026-10', undefined)
    await vi.advanceTimersByTimeAsync(5000)
    operaciones = [{ id: 'de-otro', estado: 'terminada', iniciada_at: '2026-11-04T16:00:00Z', resultado: { creadas: 0, errores: [] } }]
    await vi.advanceTimersByTimeAsync(5000)
    expect(await p).toMatchObject({ operacion_id: 'de-otro' })
    expect(api).toHaveBeenCalledTimes(1)
  })

  it('si la operación quedó sin confirmar, avisa que hay que revisar antes de relanzar', async () => {
    const { recalcular } = await import('@/components/facturacion/periodo')
    api.mockImplementationOnce(async () => { operaciones = [{ id: 'x', estado: 'sin_confirmar', iniciada_at: '2026-11-04T16:00:00Z' }]; throw new Error('Error 504') })
    const p = recalcular('2026-10', undefined)
    const verif = expect(p).rejects.toThrow(/sin confirmar.*Revisá la lista antes de volver a lanzarlo/)
    await vi.advanceTimersByTimeAsync(5000)
    await verif
    expect(api).toHaveBeenCalledTimes(1)
  })

  it('un error común (p. ej. período protegido) no se toma como "resultado desconocido"', async () => {
    const { recalcular } = await import('@/components/facturacion/periodo')
    api.mockRejectedValueOnce(Object.assign(new Error('NOVIEMBRE 2026 está en curso'), { detalle: { codigo: 'periodo_protegido' } }))
    await expect(recalcular('2026-11', undefined)).rejects.toThrow(/está en curso/)
    expect(api).toHaveBeenCalledTimes(1)
  })
})
