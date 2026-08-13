import { describe, expect, it } from 'vitest'
import { sendToUsers } from '@/app/api/_lib/push-notificaciones'

// Deduplicación y resistencia del envío. Se inyecta el emisor, así que estos
// tests no salen a la red ni tocan Supabase: el cliente es un doble.

type Fila = { usuario_id: string; turno_id: string | null; tipo: string }

function clienteFalso(yaEnviadas: Fila[] = []) {
  const enviadas = [...yaEnviadas]
  const desactivadas: string[] = []
  const client = {
    from(tabla: string) {
      if (tabla === 'notificaciones_enviadas') {
        const filtros: any = {}
        const q: any = {
          select: () => q,
          eq: (col: string, val: any) => { filtros[col] = val; return q },
          maybeSingle: async () => ({
            data: enviadas.find(e =>
              e.usuario_id === filtros.usuario_id &&
              e.turno_id === filtros.turno_id &&
              e.tipo === filtros.tipo) ?? null,
            error: null,
          }),
          insert: async (fila: any) => { enviadas.push(fila); return { error: null } },
        }
        return q
      }
      if (tabla === 'push_subscriptions') {
        return { update: () => ({ eq: async (_c: string, id: string) => { desactivadas.push(id); return {} } }) }
      }
      throw new Error('tabla inesperada en el test: ' + tabla)
    },
  }
  return { client, enviadas, desactivadas }
}

const sub = (id: string, usuario_id: string) =>
  ({ id, usuario_id, endpoint: 'https://push/' + id, p256dh: 'k', auth: 'a' }) as any
const payload = { title: 't', body: 'b', url: '/', tag: 'x' }

describe('deduplicación', () => {
  it('la primera vez envía', async () => {
    const { client, enviadas } = clienteFalso()
    const r = await sendToUsers(client, [sub('s1', 'u1')], ['u1'], 'T1', 'tipo', payload,
      async () => ({ status: 201 }))
    expect(r.sent).toBe(1)
    expect(enviadas).toHaveLength(1)
  })

  it('la segunda corrida del cron NO repite', async () => {
    const { client } = clienteFalso([{ usuario_id: 'u1', turno_id: 'T1', tipo: 'tipo' }])
    const r = await sendToUsers(client, [sub('s1', 'u1')], ['u1'], 'T1', 'tipo', payload,
      async () => { throw new Error('no debió intentar enviar') })
    expect(r.sent).toBe(0)
    expect(r.skipped).toBe(1)
  })

  it('otro tipo para el mismo turno sí se envía', async () => {
    const { client } = clienteFalso([{ usuario_id: 'u1', turno_id: 'T1', tipo: 'otro' }])
    const r = await sendToUsers(client, [sub('s1', 'u1')], ['u1'], 'T1', 'tipo', payload,
      async () => ({ status: 201 }))
    expect(r.sent).toBe(1)
  })

  it('el mismo usuario repetido en la lista se envía una sola vez', async () => {
    const { client, enviadas } = clienteFalso()
    const r = await sendToUsers(client, [sub('s1', 'u1')], ['u1', 'u1', 'u1'], 'T1', 'tipo', payload,
      async () => ({ status: 201 }))
    expect(r.sent).toBe(1)
    expect(enviadas).toHaveLength(1)
  })

  it('sin suscripción no se marca como enviada', async () => {
    const { client, enviadas } = clienteFalso()
    const r = await sendToUsers(client, [], ['u1'], 'T1', 'tipo', payload, async () => ({ status: 201 }))
    expect(r.sent).toBe(0)
    expect(enviadas).toHaveLength(0)
  })
})

describe('resistencia: un endpoint caído no frena al resto', () => {
  it('si una suscripción del usuario falla pero otra entrega, se marca enviada', async () => {
    const { client } = clienteFalso()
    const r = await sendToUsers(client, [sub('rota', 'u1'), sub('sana', 'u1')], ['u1'], 'T1', 'tipo', payload,
      async (s: any) => { if (s.id === 'rota') throw new Error('500 del servicio push'); return { status: 201 } })
    expect(r.sent).toBe(1)
    expect(r.fallos).toBe(1)
  })

  it('un usuario que falla no impide enviar a los siguientes', async () => {
    const { client, enviadas } = clienteFalso()
    const r = await sendToUsers(client, [sub('s1', 'u1'), sub('s2', 'u2')], ['u1', 'u2'], 'T1', 'tipo', payload,
      async (s: any) => { if (s.usuario_id === 'u1') throw new Error('caido'); return { status: 201 } })
    expect(r.sent).toBe(1)
    expect(enviadas.map(e => e.usuario_id)).toEqual(['u2'])
  })

  it('si TODAS fallan no se marca enviada: el proximo ciclo reintenta', async () => {
    const { client, enviadas } = clienteFalso()
    const r = await sendToUsers(client, [sub('s1', 'u1')], ['u1'], 'T1', 'tipo', payload,
      async () => { throw new Error('caido') })
    expect(r.sent).toBe(0)
    expect(enviadas).toHaveLength(0)
  })
})

describe('suscripciones muertas', () => {
  it('410 da de baja la suscripción', async () => {
    const { client, desactivadas } = clienteFalso()
    await sendToUsers(client, [sub('vieja', 'u1')], ['u1'], 'T1', 'tipo', payload,
      async () => ({ status: 410 }))
    expect(desactivadas).toEqual(['vieja'])
  })

  it('404 tambien', async () => {
    const { client, desactivadas } = clienteFalso()
    await sendToUsers(client, [sub('vieja', 'u1')], ['u1'], 'T1', 'tipo', payload,
      async () => ({ status: 404 }))
    expect(desactivadas).toEqual(['vieja'])
  })

  it('una suscripcion muerta no cuenta como entrega', async () => {
    const { client, enviadas } = clienteFalso()
    const r = await sendToUsers(client, [sub('vieja', 'u1')], ['u1'], 'T1', 'tipo', payload,
      async () => ({ status: 410 }))
    expect(r.sent).toBe(0)
    expect(enviadas).toHaveLength(0)
  })
})

// ── Prueba controlada: solo_usuario ─────────────────────────────────────────
//
// La garantía que se verifica acá es la que hace segura la prueba en
// producción: filtrar las suscripciones alcanza para que a un tercero no le
// llegue nada NI se le escriba fila de deduplicación, porque
// markNotificationSent corre sólo después de una entrega real.

describe('solo_usuario', () => {
  it('a un usuario sin suscripciones no se le envía ni se le marca dedup', async () => {
    const { client, enviadas } = clienteFalso()
    const enviados: string[] = []

    // Como si push_subscriptions viniera filtrado a u1: u2 no está.
    const r = await sendToUsers(
      client, [sub('s1', 'u1')], ['u1', 'u2'], 't1', 'tipo', payload,
      async s => { enviados.push(s.usuario_id); return { status: 201 } },
    )

    expect(enviados).toEqual(['u1'])
    expect(r.sent).toBe(1)
    expect(r.skipped).toBe(1)
    // Lo importante: u2 no quedó registrado como notificado.
    expect(enviadas.map(e => e.usuario_id)).toEqual(['u1'])
  })

  it('la segunda corrida sobre el mismo usuario no vuelve a enviar', async () => {
    const { client, enviadas } = clienteFalso()
    const enviados: string[] = []
    const emisor = async (s: any) => { enviados.push(s.id); return { status: 201 } }

    const primera = await sendToUsers(client, [sub('s1', 'u1')], ['u1'], 't1', 'tipo', payload, emisor)
    const segunda = await sendToUsers(client, [sub('s1', 'u1')], ['u1'], 't1', 'tipo', payload, emisor)

    expect(primera.sent).toBe(1)
    expect(segunda.sent).toBe(0)
    expect(segunda.skipped).toBe(1)
    expect(enviados).toEqual(['s1'])
    expect(enviadas).toHaveLength(1)
  })

  it('con dos dispositivos, si uno falla el otro igual recibe', async () => {
    const { client, enviadas } = clienteFalso()
    const enviados: string[] = []

    const r = await sendToUsers(
      client, [sub('s1', 'u1'), sub('s2', 'u1')], ['u1'], 't1', 'tipo', payload,
      async s => {
        if (s.id === 's1') throw new Error('servicio push caído')
        enviados.push(s.id)
        return { status: 201 }
      },
    )

    expect(enviados).toEqual(['s2'])   // el segundo dispositivo recibió
    expect(r.fallos).toBe(1)
    expect(r.sent).toBe(1)
    expect(enviadas).toHaveLength(1)
  })

  it('si fallan todos los dispositivos no se marca enviada y el próximo ciclo reintenta', async () => {
    const { client, enviadas } = clienteFalso()

    const r = await sendToUsers(
      client, [sub('s1', 'u1'), sub('s2', 'u1')], ['u1'], 't1', 'tipo', payload,
      async () => { throw new Error('caído') },
    )

    expect(r.sent).toBe(0)
    expect(r.fallos).toBe(2)
    expect(enviadas).toHaveLength(0)
  })
})
