import { describe, expect, it } from 'vitest'
import { extraerEstados } from '@/lib/whatsapp-estados'

// El payload real que manda Meta: entry[].changes[].value.statuses[].
const payloadMeta = (statuses: unknown[]) => ({
  object: 'whatsapp_business_account',
  entry: [{
    id: '1356900682561109',
    changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', statuses } }],
  }],
})

describe('extraerEstados', () => {
  it('lee sent/delivered/read con destinatario y momento', () => {
    const [e] = extraerEstados(payloadMeta([{
      id: 'wamid.PRUEBA', status: 'delivered', timestamp: '1756830000',
      recipient_id: '5493413914544',
    }]))
    expect(e).toEqual({
      id_proveedor: 'wamid.PRUEBA',
      estado: 'delivered',
      destinatario: '5493413914544',
      ocurrido_at: new Date(1756830000 * 1000).toISOString(),
      error_codigo: null,
      error_detalle: null,
    })
  })

  it('un failed trae el código y el detalle de Meta (131042 = facturación)', () => {
    const [e] = extraerEstados(payloadMeta([{
      id: 'wamid.PRUEBA', status: 'failed', timestamp: '1756830000',
      recipient_id: '5493413914544',
      errors: [{ code: 131042, title: 'Business eligibility payment issue',
        error_data: { details: 'There was an error related to your payment method.' } }],
    }]))
    expect(e.estado).toBe('failed')
    expect(e.error_codigo).toBe('131042')
    expect(e.error_detalle).toContain('payment')
  })

  it('los mensajes ENTRANTES de clientes se ignoran: eso es de la IA comercial', () => {
    const payload = {
      entry: [{
        changes: [{ field: 'messages', value: {
          messages: [{ from: '5493410000000', id: 'wamid.ENTRANTE', text: { body: 'hola' } }],
        } }],
      }],
    }
    expect(extraerEstados(payload)).toEqual([])
  })

  it('un payload con forma inesperada devuelve vacío, nunca rompe', () => {
    for (const p of [null, undefined, {}, { entry: 'x' }, { entry: [{ changes: [{}] }] },
      payloadMeta([{ status: 'sent' }]), payloadMeta([{ id: 'wamid.X' }])]) {
      expect(extraerEstados(p)).toEqual([])
    }
  })

  it('varios estados en un payload salen todos, en orden', () => {
    const estados = extraerEstados(payloadMeta([
      { id: 'wamid.A', status: 'sent', timestamp: '1' },
      { id: 'wamid.A', status: 'delivered', timestamp: '2' },
      { id: 'wamid.B', status: 'failed', timestamp: '3' },
    ]))
    expect(estados.map(e => `${e.id_proveedor}:${e.estado}`)).toEqual([
      'wamid.A:sent', 'wamid.A:delivered', 'wamid.B:failed',
    ])
  })

  it('un timestamp no numérico no inventa fecha', () => {
    const [e] = extraerEstados(payloadMeta([{ id: 'wamid.A', status: 'sent', timestamp: 'ayer' }]))
    expect(e.ocurrido_at).toBeNull()
  })
})
