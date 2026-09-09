import { afterEach, describe, expect, it, vi } from 'vitest'
import { proveedorMeta } from '@/lib/whatsapp'

// Verifica que el botón URL dinámico se agregue SOLO cuando el destino lo pide,
// sin alterar el envío de las plantillas sin botón (supervisores).
function stubFetch() {
  const calls: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
    calls.push(JSON.parse(init.body))
    return { ok: true, json: async () => ({ messages: [{ id: 'wamid.TEST' }] }) } as any
  }))
  return calls
}

describe('proveedorMeta: componente button URL', () => {
  const prev = { t: process.env.WHATSAPP_TOKEN, p: process.env.WHATSAPP_PHONE_ID }
  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.WHATSAPP_TOKEN = prev.t
    process.env.WHATSAPP_PHONE_ID = prev.p
  })

  it('con boton agrega el componente button sub_type url index 0', async () => {
    process.env.WHATSAPP_TOKEN = 'x'; process.env.WHATSAPP_PHONE_ID = '1'
    const calls = stubFetch()
    const r = await proveedorMeta().enviar({
      telefono: '5493410000000', plantilla: 'ronda_pendiente_vigilador',
      variables: ['OBJ', 'RONDA', '06:00'],
      boton: { urlSuffix: 'ronda=r1&turno=t1&objetivo=o1&ventana=999' },
    })
    expect(r.ok).toBe(true)
    const comps = calls[0].template.components
    const body = comps.find((c: any) => c.type === 'body')
    const btn = comps.find((c: any) => c.type === 'button')
    expect(body.parameters.map((p: any) => p.text)).toEqual(['OBJ', 'RONDA', '06:00'])
    expect(btn).toMatchObject({ type: 'button', sub_type: 'url', index: 0 })
    expect(btn.parameters[0].text).toBe('ronda=r1&turno=t1&objetivo=o1&ventana=999')
  })

  it('sin boton NO agrega componente button (plantillas de supervisores intactas)', async () => {
    process.env.WHATSAPP_TOKEN = 'x'; process.env.WHATSAPP_PHONE_ID = '1'
    const calls = stubFetch()
    await proveedorMeta().enviar({
      telefono: '5493410000000', plantilla: 'puesto_descubierto_15',
      variables: ['OBJ', 'PUESTO', '07:00', 'PEREZ'],
    })
    const comps = calls[0].template.components
    expect(comps.some((c: any) => c.type === 'button')).toBe(false)
    expect(comps).toHaveLength(1)
  })
})
