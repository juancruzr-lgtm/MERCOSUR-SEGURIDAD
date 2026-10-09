import { createHash } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Supabase simulado: registra lo que se sube a Storage y lo que se guarda en tablas.
const subidas: { bucket: string; path: string; contentType?: string; bytes: number }[] = []
const upserts: { tabla: string; filas: any }[] = []
const inserts: { tabla: string; fila: any }[] = []

function cliente() {
  const q = (tabla: string): any => {
    const b: any = {
      select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b,
      maybeSingle: async () => ({ data: tabla === 'usuarios' ? { id: 'u1', rol: 'guardia', estado: 'activo' } : tabla === 'registros_asistencia' ? { id: 'r1', guardia_id: 'u1' } : null, error: null }),
      single: async () => ({ data: tabla === 'supervisiones' ? { id: 's1', objetivo_id: 'o1', supervisor_id: 'u1' } : { id: 'f1', supervision_id: 's1', storage_path: 'x', created_at: 'hoy' }, error: null }),
      upsert: (filas: any) => { upserts.push({ tabla, filas }); return { ...b, error: null, then: (r: any) => r({ error: null }) } },
      insert: (fila: any) => { inserts.push({ tabla, fila }); return b },
    }
    return b
  }
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'auth-u1' } }, error: null }) },
    from: q,
    rpc: async () => ({ data: true, error: null }),
    storage: { from: (bucket: string) => ({
      upload: async (path: string, buf: Buffer, o: any) => { subidas.push({ bucket, path, contentType: o?.contentType, bytes: buf.length }); return { error: null } },
      remove: async () => ({ error: null }),
    }) },
  }
}
vi.mock('@/app/api/_lib/employee-auth', () => ({ getBearerToken: () => 'tok', getSupabaseAdmin: () => ({ client: cliente(), error: null }) }))
vi.mock('../app/api/_lib/employee-auth', () => ({ getBearerToken: () => 'tok', getSupabaseAdmin: () => ({ client: cliente(), error: null }) }))

const jpg = (n = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 3)])
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const form = (campos: Record<string, Blob | string>) => { const f = new FormData(); for (const [k, v] of Object.entries(campos)) f.append(k, v); return f }
const pedir = (url: string, f: FormData) => new NextRequest(url, { method: 'POST', body: f, headers: { Authorization: 'Bearer tok' } })

beforeEach(() => { subidas.length = 0; upserts.length = 0; inserts.length = 0 })

describe('fichaje: /api/upload-evidence', () => {
  it('sube libro y uniforme y registra su huella, tamaño y tipo', async () => {
    const { POST } = await import('@/app/api/upload-evidence/route')
    const libro = jpg(3000), uniforme = jpg(4000)
    const r = await POST(pedir('http://x/api/upload-evidence', form({
      libro: new Blob([libro], { type: 'image/jpeg' }), uniforme: new Blob([uniforme], { type: 'image/jpeg' }),
      registroId: 'r1', turnoId: 't1', objetivoId: 'o1',
    })))
    expect(r.status).toBe(200)
    const filas = upserts.find(u => u.tabla === 'evidencias')!.filas
    expect(filas.find((f: any) => f.tipo_evidencia === 'libro_guardia')).toMatchObject({ contenido_sha256: sha(libro), bytes: libro.length, content_type: 'image/jpeg' })
    expect(filas.find((f: any) => f.tipo_evidencia === 'uniforme')).toMatchObject({ contenido_sha256: sha(uniforme), bytes: uniforme.length })
  })
  it('rechaza un HEIC o un archivo que no es foto, sin subir nada', async () => {
    const { POST } = await import('@/app/api/upload-evidence/route')
    const r = await POST(pedir('http://x/api/upload-evidence', form({
      libro: new Blob([Buffer.from('....ftypheic........')], { type: 'image/jpeg' }), uniforme: new Blob([jpg()], { type: 'image/jpeg' }),
      registroId: 'r1', turnoId: 't1', objetivoId: 'o1',
    })))
    expect(r.status).toBe(415)
    expect(subidas).toHaveLength(0)
  })
  it('rechaza una foto de más de 4 MB (413)', async () => {
    const { POST } = await import('@/app/api/upload-evidence/route')
    const r = await POST(pedir('http://x/api/upload-evidence', form({
      libro: new Blob([jpg(4 * 1024 * 1024 + 10)], { type: 'image/jpeg' }), uniforme: new Blob([jpg()], { type: 'image/jpeg' }),
      registroId: 'r1', turnoId: 't1', objetivoId: 'o1',
    })))
    expect(r.status).toBe(413)
    expect(subidas).toHaveLength(0)
  })
})

describe('supervisión: /api/upload-supervision-photo', () => {
  it('guarda el tipo detectado por los bytes, no el declarado', async () => {
    const { POST } = await import('@/app/api/upload-supervision-photo/route')
    const r = await POST(pedir('http://x/api/upload-supervision-photo', form({
      foto: new File([jpg()], 'IMG_1.HEIC', { type: 'image/heic' }), supervision_id: '00000000-0000-4000-8000-000000000001', index: '0',
    })))
    expect(r.status).toBe(200)
    expect(subidas[0]).toMatchObject({ bucket: 'supervision-fotos', contentType: 'image/jpeg' })
  })
  it('rechaza lo que no es foto (antes se guardaba)', async () => {
    const { POST } = await import('@/app/api/upload-supervision-photo/route')
    const r = await POST(pedir('http://x/api/upload-supervision-photo', form({
      foto: new File([Buffer.from('no soy una imagen')], 'x.heic', { type: 'image/heic' }), supervision_id: '00000000-0000-4000-8000-000000000001', index: '0',
    })))
    expect(r.status).toBe(415)
    expect(subidas).toHaveLength(0)
  })
})
