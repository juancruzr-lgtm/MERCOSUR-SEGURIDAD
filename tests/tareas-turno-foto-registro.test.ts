import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// /api/tareas-turno/foto: mismo patrón que rondas ("La foto se subió pero no
// pudo registrarse: TypeError: fetch failed"). La fila de evidencias es
// idempotente, así que una falla transitoria se reintenta en el servidor y,
// si persiste, vuelve 503 'registro_pendiente' (no 500 genérico).

const REGISTRO = '11111111-2222-4333-8444-555555555555'

const estado = vi.hoisted(() => ({
  respuestasUpsert: [] as Array<{ error: { message: string } | null }>,
  upserts: 0,
}))

vi.mock('@/app/api/_lib/employee-auth', () => ({
  fetchSinCache: fetch,
  getBearerToken: () => 'token',
  getSupabaseAdmin: () => ({
    error: null,
    client: {
      storage: { from: () => ({ upload: async () => ({ error: null }) }) },
      from: () => ({
        upsert: () => {
          const r = estado.respuestasUpsert[Math.min(estado.upserts, estado.respuestasUpsert.length - 1)]
          estado.upserts++
          return Promise.resolve(r)
        },
      }),
    },
  }),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async () => ({ data: { bucket: 'evidencias', storage_path: `tareas/${REGISTRO}.jpg` }, error: null }),
  }),
}))

vi.mock('@/app/api/_lib/validar-foto', () => ({
  firmaImagenValida: () => true,
  validarFotoOperativa: () => ({ ok: true, sha256: 'abc', bytes: 3, mime: 'image/jpeg' }),
}))

async function enviar() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:9'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  const { POST } = await import('@/app/api/tareas-turno/foto/route')
  const form = new FormData()
  form.set('registroId', REGISTRO)
  form.set('foto', new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'f.jpg')
  const req = new NextRequest('http://localhost/api/tareas-turno/foto', { method: 'POST', body: form })
  const res = await POST(req)
  return { status: res.status, cuerpo: await res.json() }
}

describe('POST /api/tareas-turno/foto — registro de la evidencia con reintento', () => {
  beforeEach(() => { estado.upserts = 0 })

  it('una falla transitoria seguida de éxito: registra y responde ok', async () => {
    estado.respuestasUpsert = [{ error: { message: 'TypeError: fetch failed' } }, { error: null }]
    const r = await enviar()
    expect(r.status).toBe(200)
    expect(r.cuerpo).toEqual({ ok: true })
    expect(estado.upserts).toBe(2)
  })

  it('falla transitoria persistente: 503 registro_pendiente tras 3 intentos', async () => {
    estado.respuestasUpsert = [{ error: { message: 'TypeError: fetch failed' } }]
    const r = await enviar()
    expect(r.status).toBe(503)
    expect(r.cuerpo.codigo).toBe('registro_pendiente')
    expect(r.cuerpo.error).toMatch(/no pudo registrarse/)
    expect(estado.upserts).toBe(3)
  })

  it('un rechazo de la base no se reintenta: 500 registro_rechazado', async () => {
    estado.respuestasUpsert = [{ error: { message: 'new row violates row-level security policy' } }]
    const r = await enviar()
    expect(r.status).toBe(500)
    expect(r.cuerpo.codigo).toBe('registro_rechazado')
    expect(estado.upserts).toBe(1)
  })
})
