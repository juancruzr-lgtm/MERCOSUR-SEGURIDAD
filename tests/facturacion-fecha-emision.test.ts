import { describe, expect, it } from 'vitest'
import { rangoFechaEmision, validarFechaEmision } from '@/lib/facturacion/emision-guardas'
import { comprobanteDesdeSolicitud, ejecutarEmision, type Emision, type PuertoArca, type PuertoBase } from '@/lib/facturacion/emision-servidor'

const HOY = '2026-11-12'

describe('fecha de emisión elegida', () => {
  it('rango: hasta 10 días atrás y no antes del último autorizado', () => {
    expect(rangoFechaEmision(HOY)).toEqual({ desde: '2026-11-02', hasta: HOY })
    expect(rangoFechaEmision(HOY, '2026-11-05')).toEqual({ desde: '2026-11-05', hasta: HOY })
    expect(rangoFechaEmision(HOY, '2026-10-20')).toEqual({ desde: '2026-11-02', hasta: HOY })
  })
  it('valida formato, futuro, más de 10 días y orden con el último autorizado', () => {
    expect(validarFechaEmision('2026-11-02', HOY)).toBeNull()
    expect(validarFechaEmision(HOY, HOY)).toBeNull()
    expect(validarFechaEmision('12/11/2026', HOY)).toMatch(/inválida/)
    expect(validarFechaEmision('2026-02-30', HOY)).toMatch(/inválida/)
    expect(validarFechaEmision('2026-11-13', HOY)).toMatch(/posterior a hoy/)
    expect(validarFechaEmision('2026-11-01', HOY)).toMatch(/10 días/)
    expect(validarFechaEmision('2026-11-04', HOY, '2026-11-05')).toMatch(/último comprobante autorizado/)
  })
})

describe('emisión con fecha anterior a hoy', () => {
  const e: Emision = { id: 'E1', estado: 'preparada', ambiente: 'produccion', cuit_emisor: '30710705417', tipo: 6, punto_venta: 4, numero: null,
    numeros_intentados: [], ultimo_intento_at: null,
    solicitud: { cuit_receptor: '30999003156', neto_c: 2398611570, iva_c: 503708430, total_c: 2902320000, periodo_desde: '2026-10-01', periodo_hasta: '2026-10-31', vto_pago: null } }
  const opts = { hoy: HOY, condicionIva: 'exento', plazoDias: 30 }
  const base = () => {
    const log: string[] = []
    const b: PuertoBase = {
      iniciarEnvio: async (_id, n, sol: any) => { log.push(`envio:${n}:${sol.fecha}:${sol.vtoPago}`) },
      resultado: async (_id, r) => { log.push(`resultado:${r.resultado}:${r.fecha}`) },
      consulta: async () => null,
    }
    return { b, log }
  }

  it('el comprobante lleva la fecha elegida y el vencimiento se cuenta desde ella', () => {
    const c = comprobanteDesdeSolicitud(e, { numero: 2, hoy: HOY, condicionIva: 'exento', plazoDias: 30, fechaEmision: '2026-11-03' })
    expect(c.fecha).toBe('2026-11-03')
    expect(c.vtoPago).toBe('2026-12-03')
  })

  it('con fecha válida, pide el CAE con esa fecha', async () => {
    const { b, log } = base()
    const arca: PuertoArca = {
      ultimo: async () => ({ ok: true, numero: 1 }),
      consultar: async () => ({ encontrado: true, cae: '1', caeVto: '2026-11-22', fecha: '2026-11-02', totalC: 1, crudo: null }),
      solicitar: async () => ({ resultado: 'A', cae: '864', caeVto: '2026-11-13', fecha: '', observaciones: [], crudo: null }),
    }
    const r = await ejecutarEmision(e, arca, b, { ...opts, fechaEmision: '2026-11-03' })
    expect(r).toMatchObject({ estado: 'autorizada', numero: 2 })
    expect(log).toEqual(['envio:2:2026-11-03:2026-12-03', 'resultado:A:2026-11-03'])
  })

  it('anterior al último autorizado: no toma número ni pide CAE', async () => {
    const { b, log } = base()
    let pedidos = 0
    const arca: PuertoArca = {
      ultimo: async () => ({ ok: true, numero: 1 }),
      consultar: async () => ({ encontrado: true, cae: '1', caeVto: '2026-11-22', fecha: '2026-11-12', totalC: 1, crudo: null }),
      solicitar: async () => { pedidos++; throw new Error('no') },
    }
    const r = await ejecutarEmision(e, arca, b, { ...opts, fechaEmision: '2026-11-05' })
    expect(r).toMatchObject({ estado: 'invalida' })
    expect((r as any).errores[0]).toMatch(/último comprobante autorizado .*\(2026-11-12\)/)
    expect(pedidos).toBe(0)
    expect(log).toEqual([])
  })

  it('si no se puede verificar la fecha del último, no se emite con fecha vieja', async () => {
    const { b, log } = base()
    const arca: PuertoArca = {
      ultimo: async () => ({ ok: true, numero: 1 }),
      consultar: async () => ({ error: 'servicio caído' }),
      solicitar: async () => { throw new Error('no') },
    }
    const r = await ejecutarEmision(e, arca, b, { ...opts, fechaEmision: '2026-11-05' })
    expect(r.estado).toBe('invalida')
    expect(log).toEqual([])
  })

  it('sin fecha elegida, sale con la de hoy como siempre (no consulta el último)', async () => {
    const { b, log } = base()
    let consultas = 0
    const arca: PuertoArca = {
      ultimo: async () => ({ ok: true, numero: 1 }),
      consultar: async () => { consultas++; return { error: 'x' } },
      solicitar: async () => ({ resultado: 'A', cae: '864', caeVto: '2026-11-22', fecha: '', observaciones: [], crudo: null }),
    }
    expect((await ejecutarEmision(e, arca, b, opts)).estado).toBe('autorizada')
    expect(consultas).toBe(0)
    expect(log[0]).toBe('envio:2:2026-11-12:2026-12-12')
  })
})
