// Seguro de períodos de Facturación: mes vencido por defecto (hora de Argentina), bloqueo del mes
// en curso y futuro en las rutas, excepción gerencial y recálculos sin duplicados.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { escrituraHabilitada, estadoDelPeriodo, mesDelPeriodo, mesVencido, motivoBloqueo, nombreDelMes } from '@/lib/facturacion/periodo-seguro'

const AR = (iso: string) => new Date(iso) // instantes en UTC; la regla los interpreta en hora de Argentina (UTC-3)

describe('mes vencido por defecto', () => {
  it('noviembre → octubre, diciembre → noviembre, enero → diciembre del año anterior', () => {
    expect(mesVencido(AR('2026-11-04T15:00:00Z'))).toBe('2026-10')
    expect(mesVencido(AR('2026-12-10T15:00:00Z'))).toBe('2026-11')
    expect(mesVencido(AR('2027-01-02T15:00:00Z'))).toBe('2026-12')
  })
  it('usa la hora de Argentina, no la UTC: el 30/11 a las 23:30 todavía es noviembre', () => {
    const casiDiciembre = AR('2026-12-01T02:30:00Z') // 30/11 23:30 en Argentina, 01/12 en UTC
    expect(mesVencido(casiDiciembre)).toBe('2026-10')
    expect(estadoDelPeriodo('2026-11', casiDiciembre)).toBe('en_curso')
    const yaDiciembre = AR('2026-12-01T03:00:00Z') // 01/12 00:00 en Argentina
    expect(mesVencido(yaDiciembre)).toBe('2026-11')
    expect(estadoDelPeriodo('2026-11', yaDiciembre)).toBe('vencido')
  })
  it('fin de año: el 31/12 a las 22:00 sigue en diciembre; el 01/01 a la 00:00 diciembre ya está vencido', () => {
    expect(estadoDelPeriodo('2026-12', AR('2027-01-01T01:00:00Z'))).toBe('en_curso')
    expect(estadoDelPeriodo('2026-12', AR('2027-01-01T03:00:00Z'))).toBe('vencido')
    expect(estadoDelPeriodo('2027-01', AR('2026-12-15T12:00:00Z'))).toBe('futuro')
  })
  it('el nombre del período se muestra en mayúsculas', () => {
    expect(nombreDelMes('2026-10')).toBe('OCTUBRE 2026')
    expect(nombreDelMes('2027-01')).toBe('ENERO 2027')
  })
})

describe('bloqueo del mes en curso y futuro', () => {
  const hoy = AR('2026-11-04T15:00:00Z')
  it('el mes vencido se escribe normal; el actual y el futuro no', () => {
    expect(escrituraHabilitada('2026-10', null, hoy)).toBe(true)
    expect(escrituraHabilitada('2026-11', null, hoy)).toBe(false)
    expect(escrituraHabilitada('2026-12', null, hoy)).toBe(false)
    expect(motivoBloqueo('2026-11', null, hoy)).toMatch(/NOVIEMBRE 2026 está en curso.*Se factura el mes vencido \(OCTUBRE 2026\)/)
    expect(motivoBloqueo('2026-10', null, hoy)).toBeNull()
  })
  it('excepción gerencial: habilita sólo ese mes y sólo mientras está vigente', () => {
    const exc = { id: 'e1', mes: '2026-11', motivo: 'Cierre anticipado', vence_at: '2026-11-04T17:00:00Z' }
    expect(escrituraHabilitada('2026-11', exc, hoy)).toBe(true)
    expect(escrituraHabilitada('2026-12', exc, hoy)).toBe(false)
    expect(escrituraHabilitada('2026-11', exc, AR('2026-11-04T17:00:01Z'))).toBe(false)
  })
  it('contratos con corte: el mes de facturación es el del último día del período comercial', () => {
    expect(mesDelPeriodo('2026-11-01')).toBe('2026-10') // calendario octubre
    expect(mesDelPeriodo('2026-10-26')).toBe('2026-10') // corte 26/09 → 25/10 (Hagana octubre)
    expect(mesDelPeriodo('2026-11-26')).toBe('2026-11') // corte 26/10 → 25/11: todavía en curso en noviembre
    expect(mesDelPeriodo('2027-01-01')).toBe('2026-12')
  })
})

// ── Rutas: el servidor valida el período antes de escribir ─────────────────
const rpcs: Array<{ fn: string; args: any }> = []
let respuestas: Record<string, (args: any) => { data?: any; error?: any }> = {}
const prefacturaDe: Record<string, any> = {}
const usuario = {
  rpc: async (fn: string, args: any) => { rpcs.push({ fn, args }); return respuestas[fn]?.(args) ?? { data: true, error: null } },
  from: () => { const q: any = { select: () => q, eq: (_c: string, v: any) => { q.v = v; return q }, maybeSingle: async () => ({ data: prefacturaDe[q.v] ?? null, error: null }) }; return q },
}
vi.mock('@/app/api/documentacion/_clientes', () => ({ SIN_CACHE: {}, clientesDelPedido: async () => ({ usuario, admin: usuario, authUserId: 'u1' }) }))
const generar = vi.fn(async () => ({ creadas: 1, actualizadas: 2, sin_cambios: 0, reagrupadas: 0, errores: [] }))
const aprobar = vi.fn(async () => ({ id: 'ap1' }))
const proponer = vi.fn(async () => ({ horas: {} }))
vi.mock('@/lib/facturacion/servidor', () => ({ generarPrefacturas: (...a: any[]) => (generar as any)(...a), aprobarHoras: (...a: any[]) => (aprobar as any)(...a), proponerHoras: (...a: any[]) => (proponer as any)(...a) }))

const pedido = (ruta: string, cuerpo: unknown) => new NextRequest(`http://x/api/facturacion/${ruta}`, { method: 'POST', body: JSON.stringify(cuerpo), headers: { authorization: 'Bearer t' } })
const estado = (habilitado: boolean) => () => ({ data: { habilitado, estado: habilitado ? 'vencido' : 'en_curso' }, error: null })

describe('rutas de Facturación con el seguro de períodos', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-04T15:00:00Z'))
    rpcs.length = 0; generar.mockClear(); aprobar.mockClear(); proponer.mockClear()
    respuestas = { fact_alcance_total_actual: () => ({ data: true }), facturacion_puede_actual: () => ({ data: true }), fact_operacion_iniciar: () => ({ data: 'op1', error: null }) }
  })
  afterEach(() => vi.useRealTimers())

  it('recalcular el mes en curso: 403 y no se toca nada (aunque se mande el mes a mano)', async () => {
    respuestas.fact_periodo_estado = estado(false)
    const { POST } = await import('@/app/api/facturacion/prefacturas/route')
    const r = await POST(pedido('prefacturas', { mes: '2026-11' }))
    expect(r.status).toBe(403)
    expect((await r.json()).codigo).toBe('periodo_protegido')
    expect(generar).not.toHaveBeenCalled()
    expect(rpcs.some(x => x.fn === 'fact_operacion_iniciar')).toBe(false)
  })
  it('sin la migración aplicada, la misma regla en el servidor: el mes actual se rechaza y el vencido pasa', async () => {
    respuestas.fact_periodo_estado = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.fact_periodo_estado(p_mes)' } })
    respuestas.fact_operacion_iniciar = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.fact_operacion_iniciar' } })
    const { POST } = await import('@/app/api/facturacion/prefacturas/route')
    expect((await POST(pedido('prefacturas', { mes: '2026-12' }))).status).toBe(403)
    expect((await POST(pedido('prefacturas', { mes: '2026-10' }))).status).toBe(200)
    expect(generar).toHaveBeenCalledTimes(1)
  })
  it('mes vencido: registra la operación, recalcula una vez y guarda el resultado', async () => {
    respuestas.fact_periodo_estado = estado(true)
    const { POST } = await import('@/app/api/facturacion/prefacturas/route')
    const r = await POST(pedido('prefacturas', { mes: '2026-10' }))
    expect(r.status).toBe(200)
    expect((await r.json()).operacion_id).toBe('op1')
    expect(generar).toHaveBeenCalledTimes(1)
    expect(rpcs.find(x => x.fn === 'fact_operacion_iniciar')!.args).toEqual({ p_tipo: 'recalculo_mes', p_mes: '2026-10', p_contrato_id: null })
    expect(rpcs.find(x => x.fn === 'fact_operacion_terminar')!.args).toMatchObject({ p_id: 'op1', p_estado: 'terminada', p_resultado: { creadas: 1 } })
  })
  it('con un recálculo del mismo período en curso: 409 y no se lanza otro', async () => {
    respuestas.fact_periodo_estado = estado(true)
    respuestas.fact_operacion_iniciar = () => ({ data: null, error: { code: '55P03', message: 'Ya hay un recálculo de 2026-10 en curso (lo inició juan cruz a las 13:19). Esperá a que termine.' } })
    const { POST } = await import('@/app/api/facturacion/prefacturas/route')
    const r = await POST(pedido('prefacturas', { mes: '2026-10' }))
    expect(r.status).toBe(409)
    expect((await r.json()).codigo).toBe('operacion_en_curso')
    expect(generar).not.toHaveBeenCalled()
  })
  it('si el recálculo falla, la operación queda "fallida" con el error (no queda en curso)', async () => {
    respuestas.fact_periodo_estado = estado(true)
    generar.mockRejectedValueOnce(new Error('se cortó la base'))
    const { POST } = await import('@/app/api/facturacion/prefacturas/route')
    expect((await POST(pedido('prefacturas', { mes: '2026-10', contrato_id: 'k1' }))).status).toBe(400)
    expect(rpcs.find(x => x.fn === 'fact_operacion_iniciar')!.args.p_tipo).toBe('recalculo_contrato')
    expect(rpcs.find(x => x.fn === 'fact_operacion_terminar')!.args).toMatchObject({ p_estado: 'fallida', p_resultado: { error: 'se cortó la base' } })
  })
  it('aceptar horas del mes en curso: 403; consultar la propuesta sí se puede', async () => {
    respuestas.fact_periodo_estado = estado(false)
    const { POST } = await import('@/app/api/facturacion/horas/route')
    const base = { contrato_id: 'k', objetivo_id: 'o', mes: '2026-11' }
    expect((await POST(pedido('horas', { ...base, accion: 'aprobar' }))).status).toBe(403)
    expect(aprobar).not.toHaveBeenCalled()
    expect((await POST(pedido('horas', { ...base, accion: 'proponer' }))).status).toBe(200)
    expect(proponer).toHaveBeenCalledTimes(1)
  })
  it('aceptar horas del mes vencido: directo, sin pasos extra', async () => {
    respuestas.fact_periodo_estado = estado(true)
    const { POST } = await import('@/app/api/facturacion/horas/route')
    expect((await POST(pedido('horas', { contrato_id: 'k', objetivo_id: 'o', mes: '2026-10', accion: 'aprobar' }))).status).toBe(200)
    expect(aprobar).toHaveBeenCalledTimes(1)
  })
  it('emitir una prefactura del mes en curso se rechaza antes de preparar la emisión', async () => {
    respuestas.fact_periodo_estado = estado(false)
    prefacturaDe.p1 = { periodo_mes: '2026-11' }
    const { POST } = await import('@/app/api/facturacion/emitir/route')
    expect((await POST(pedido('emitir', { prefactura_id: 'p1', version: 1, ambiente: 'homologacion' }))).status).toBe(403)
    expect(rpcs.some(x => x.fn === 'fact_emision_preparar')).toBe(false)
  })
})
