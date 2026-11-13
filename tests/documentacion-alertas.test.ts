import { readFileSync } from 'fs'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { claveVencimiento, textoAlerta, textoDias, textoResumenAlertas } from '@/lib/documentacion-alertas'
import { GET } from '@/app/api/cron/documentacion-alertas/route'

const llamadas: string[] = []
let respuesta: unknown = { activo: false, nuevas: 0 }
let errorRpc: { message: string } | null = null
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: async (fn: string) => { llamadas.push(fn); return errorRpc ? { data: null, error: errorRpc } : { data: respuesta, error: null } } }),
}))

beforeEach(() => {
  llamadas.length = 0
  errorRpc = null
  delete process.env.CRON_SECRET
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

describe('/api/cron/documentacion-alertas — más casos', () => {
  it('también acepta CRON_SECRET', async () => {
    delete process.env.push_cron_secret
    process.env.CRON_SECRET = 'otro-secreto'
    expect((await pedir('Bearer otro-secreto')).status).toBe(200)
    expect((await pedir('Bearer secreto')).status).toBe(401)
  })
  it('error de la base: 500 con el mensaje', async () => {
    errorRpc = { message: 'falló' }
    const r = await pedir('Bearer secreto')
    expect(r.status).toBe(500)
    expect(await r.json()).toEqual({ error: 'falló' })
  })
  it('prendido: devuelve el resumen de la corrida', async () => {
    respuesta = { activo: true, nuevas: 3, vencimientos: 2, credenciales: 1, solicitados: 0, faltantes: 0 }
    expect(await (await pedir('Bearer secreto')).json()).toEqual(respuesta)
  })
})

describe('Reporte de vencimientos', () => {
  const base = { ultima: '2026-11-05T11:00:00Z', vigentes: 0, vencido: 0, por_vencer: 0, solicitado: 0, faltante: 0 }
  it('resumen del proceso diario', () => {
    expect(textoResumenAlertas(undefined, true)).toBeNull()
    expect(textoResumenAlertas({ ...base, ultima: null }, false)).toBeNull()
    expect(textoResumenAlertas({ ...base, ultima: null }, true)).toBe('Todavía no corrió el proceso diario (08:00).')
    expect(textoResumenAlertas({ ...base, vigentes: 4, vencido: 1, por_vencer: 3 }, true)).toBe('Alertas vigentes: 4 (1 vencido, 3 por vencer).')
  })
  it('clave estable con y sin la migración nueva', () => {
    const v = { documento_id: 'd1', empleado_id: 'e', nombre: 'n', apellido: 'a', legajo: null, tipo: 'credencial', tipo_nombre: 'Credencial', detalle: null, vence_el: '2026-12-01', dias: 3, reemplazo_en_curso: false }
    expect(claveVencimiento(v)).toBe('doc:d1')
    expect(claveVencimiento({ ...v, clave: 'cred:c1', documento_id: null })).toBe('cred:c1')
  })
})

describe('Migración 20261205140000 y tarea de pg_cron', () => {
  const mig = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20261205140000_documentacion_alertas_listas.sql'), 'utf8')
  const sinComentarios = mig.replace(/--.*$/gm, '')
  const cron = readFileSync(join(__dirname, '..', 'supabase', 'cron', '20261009170000_documentacion_alertas_cron.sql'), 'utf8')
  it('no prende nada ni programa el cron', () => {
    expect(/cron\.schedule|update\s+public\.documentacion_alertas_config\b/i.test(sinComentarios)).toBe(false)
    expect(/push_subscriptions|whatsapp|net\.http/i.test(sinComentarios)).toBe(false)
  })
  it('hoy en Argentina, no current_date', () => {
    expect(/current_date/i.test(sinComentarios)).toBe(false)
    expect(mig).toContain("America/Argentina/Buenos_Aires")
  })
  it('el cron: 08:00 ART, ruta de producción y llave push_cron_secret del vault', () => {
    expect(cron).toMatch(/'0 11 \* \* \*'/)
    expect(cron).toContain('https://mercosur-seguridad.vercel.app/api/cron/documentacion-alertas')
    expect(cron).toMatch(/vault\.decrypted_secrets[\s\S]*name = 'push_cron_secret'/)
  })
})
