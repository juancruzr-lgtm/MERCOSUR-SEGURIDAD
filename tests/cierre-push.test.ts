import { describe, expect, it } from 'vitest'
import { claveCierreOperativo, enviarResumenCierre } from '@/app/api/_lib/push-notificaciones'
import { construirCierreOperativo, textoPushCierre } from '@/lib/cierre-operativo'
import type { ItemCierre } from '@/lib/cierre-operativo'

// El aviso de cierre: uno por responsable y por día. Se inyecta el emisor, así
// que estos tests no salen a la red ni tocan Supabase.

type Fila = { usuario_id: string; turno_id: string | null; objetivo_id: string | null; tipo: string }

function clienteFalso(yaEnviadas: Fila[] = []) {
  const enviadas = [...yaEnviadas]
  const desactivadas: string[] = []
  const client = {
    from(tabla: string) {
      if (tabla === 'notificaciones_enviadas') {
        const eq: any = {}
        const nulos: string[] = []
        const q: any = {
          select: () => q,
          eq: (col: string, val: any) => { eq[col] = val; return q },
          is: (col: string, _v: null) => { nulos.push(col); return q },
          maybeSingle: async () => ({
            data: enviadas.find(e =>
              e.usuario_id === eq.usuario_id &&
              e.tipo === eq.tipo &&
              nulos.every(c => (e as any)[c] == null)) ?? null,
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

const destino = (usuarioId: string) =>
  ({ usuarioId, payload: { title: 'Cierre operativo', body: '2 pendientes', url: '/dashboard' } as any })

const FECHA = '2026-08-25'
const CLAVE = claveCierreOperativo(FECHA)

describe('el resumen sale una sola vez por día', () => {
  it('la primera corrida envía', async () => {
    const { client, enviadas } = clienteFalso()
    const r = await enviarResumenCierre(client, [sub('s1', 'u1')], [destino('u1')], FECHA,
      async () => ({ status: 201 }))
    expect(r.sent).toBe(1)
    expect(enviadas[0].tipo).toBe(CLAVE)
    // Sin turno ni objetivo: la unicidad de esta fila es (usuario, día).
    expect(enviadas[0].turno_id).toBeNull()
    expect(enviadas[0].objetivo_id).toBeNull()
  })

  it('una segunda corrida del mismo día no repite', async () => {
    const { client } = clienteFalso([
      { usuario_id: 'u1', turno_id: null, objetivo_id: null, tipo: CLAVE },
    ])
    const r = await enviarResumenCierre(client, [sub('s1', 'u1')], [destino('u1')], FECHA,
      async () => { throw new Error('no debió intentar enviar') })
    expect(r.sent).toBe(0)
    expect(r.skipped).toBe(1)
  })

  it('el día siguiente sí vuelve a salir', async () => {
    const { client } = clienteFalso([
      { usuario_id: 'u1', turno_id: null, objetivo_id: null, tipo: CLAVE },
    ])
    const r = await enviarResumenCierre(client, [sub('s1', 'u1')], [destino('u1')], '2026-08-26',
      async () => ({ status: 201 }))
    expect(r.sent).toBe(1)
  })

  it('el mismo usuario repetido recibe uno solo', async () => {
    const { client, enviadas } = clienteFalso()
    const r = await enviarResumenCierre(
      client, [sub('s1', 'u1')], [destino('u1'), destino('u1')], FECHA,
      async () => ({ status: 201 }))
    expect(r.sent).toBe(1)
    expect(enviadas).toHaveLength(1)
  })

  it('sin suscripción no se marca como enviado: el próximo intento reintenta', async () => {
    const { client, enviadas } = clienteFalso()
    const r = await enviarResumenCierre(client, [], [destino('u1')], FECHA,
      async () => ({ status: 201 }))
    expect(r.sent).toBe(0)
    expect(enviadas).toHaveLength(0)
  })

  it('una suscripción muerta se desactiva y no se da por entregado', async () => {
    const { client, desactivadas, enviadas } = clienteFalso()
    const r = await enviarResumenCierre(client, [sub('s1', 'u1')], [destino('u1')], FECHA,
      async () => ({ status: 410 }))
    expect(desactivadas).toEqual(['s1'])
    expect(r.sent).toBe(0)
    expect(enviadas).toHaveLength(0)
  })

  it('un endpoint caído no deja sin aviso al resto', async () => {
    const { client } = clienteFalso()
    const r = await enviarResumenCierre(
      client, [sub('s1', 'u1'), sub('s2', 'u2')], [destino('u1'), destino('u2')], FECHA,
      async (s: any) => {
        if (s.id === 's1') throw new Error('endpoint caído')
        return { status: 201 }
      })
    expect(r.sent).toBe(1)
    expect(r.fallos).toBe(1)
  })
})

// ── El texto ─────────────────────────────────────────────────────────────────

const item = (over: Partial<ItemCierre> = {}): ItemCierre => ({
  id: 'x', categoria: 'planillas', fecha: '2026-08-25', hora: '07:00',
  objetivoId: 'o1', zonaId: 'z1', etiqueta: 'e', resueltoPorSupervisor: false,
  ...over,
})

describe('el aviso dice qué hay, no "revisá el sistema"', () => {
  it('con pendientes de hoy los nombra por categoría', () => {
    const cierre = construirCierreOperativo([
      item({ id: 'a' }),
      item({ id: 'b', categoria: 'rondas' }),
    ], FECHA)
    const { titulo, cuerpo } = textoPushCierre(cierre)
    expect(titulo).toBe('Cierre operativo: 2 pendientes')
    expect(cuerpo).toContain('1 planillas')
    expect(cuerpo).toContain('1 rondas')
  })

  it('el arrastre va aparte, no sumado al de hoy', () => {
    const cierre = construirCierreOperativo([
      item({ id: 'a' }),
      item({ id: 'v', fecha: '2026-08-20', categoria: 'fotos_ia' }),
    ], FECHA)
    const { titulo, cuerpo } = textoPushCierre(cierre)
    expect(titulo).toBe('Cierre operativo: 1 pendiente')
    expect(cuerpo).toContain('Hoy:')
    expect(cuerpo).toContain('días anteriores')
  })

  it('sin nada pendiente lo dice y no inventa trabajo', () => {
    const { titulo, cuerpo } = textoPushCierre(construirCierreOperativo([], FECHA))
    expect(titulo).toBe('Cierre operativo al día')
    expect(cuerpo).toContain('No te queda nada')
  })

  it('hoy limpio pero con arrastre no se anuncia como si hubiera fallado la guardia', () => {
    const cierre = construirCierreOperativo([item({ fecha: '2026-08-20' })], FECHA)
    expect(textoPushCierre(cierre).titulo).toBe('Cierre operativo: hoy sin pendientes')
  })
})
