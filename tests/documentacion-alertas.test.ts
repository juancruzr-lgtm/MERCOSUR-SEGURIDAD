import { readFileSync } from 'fs'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { textoAlerta, textoDias } from '@/lib/documentacion-alertas'
import { GET } from '@/app/api/cron/documentacion-alertas/route'

const llamadas: string[] = []
let respuesta: unknown = { activo: false, nuevas: 0 }
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: async (fn: string) => { llamadas.push(fn); return { data: respuesta, error: null } } }),
}))

beforeEach(() => {
  llamadas.length = 0
  process.env.push_cron_secret = 'secreto'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:9'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
})
const pedir = (auth?: string) => GET(new NextRequest('http://localhost/api/cron/documentacion-alertas', { headers: auth ? { Authorization: auth } : {} }))

describe('/api/cron/documentacion-alertas', () => {
  it('sin la llave del cron: 401 y no toca la base', async () => {
    expect((await pedir()).status).toBe(401)
    expect((await pedir('Bearer otra')).status).toBe(401)
    expect(llamadas).toHaveLength(0)
  })
  it('usa push_cron_secret (en minúsculas), como el resto de los crons', async () => {
    const r = await pedir('Bearer secreto')
    expect(r.status).toBe(200)
    expect(llamadas).toEqual(['documentacion_alertas_generar'])
  })
  it('apagado: responde que no hizo nada', async () => {
    respuesta = { activo: false, nuevas: 0 }
    expect(await (await pedir('Bearer secreto')).json()).toEqual({ activo: false, nuevas: 0 })
  })
  it('sin secreto configurado: 500', async () => {
    delete process.env.push_cron_secret
    expect((await pedir('Bearer secreto')).status).toBe(500)
  })
})

describe('Textos', () => {
  it('alertas para la persona', () => {
    expect(textoAlerta({ id: 1, tipo: 'credencial', tipo_nombre: 'Credencial', motivo: 'vencido', vence_el: '2026-10-01' })).toBe('Credencial: venció el 01/10/2026. Subí el nuevo.')
    expect(textoAlerta({ id: 1, tipo: 'codem', tipo_nombre: 'CODEM', motivo: 'solicitado', vence_el: null })).toBe('Administración te pidió: CODEM.')
  })
  it('días', () => {
    expect(textoDias(0)).toBe('vence hoy')
    expect(textoDias(1)).toBe('vence en 1 día')
    expect(textoDias(-3)).toBe('venció hace 3 días')
  })
})

describe('Migración de alertas — convenciones', () => {
  const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20261009170000_documentacion_alertas.sql'), 'utf8')
  const sinComentarios = sql.replace(/--.*$/gm, '')
  it('apagado por defecto', () => {
    expect(/activo\s+boolean not null default false/.test(sql)).toBe(true)
    expect(/avisar_persona\s+boolean not null default false/.test(sql)).toBe(true)
  })
  it('la tarea de pg_cron NO está en la migración', () => {
    expect(/cron\.schedule/.test(sinComentarios)).toBe(false)
  })
  it('no manda push ni WhatsApp', () => {
    expect(/push_subscriptions|whatsapp|net\.http/i.test(sinComentarios)).toBe(false)
  })
})
