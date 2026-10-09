import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  insigniaTipo, puedeSubir, resumenDocumentacion, situacionDeTipo, validarArchivos, validarFechas,
} from '@/lib/documentacion'
import type { DocumentoLegajo, SituacionMarcada, TipoDocumento } from '@/lib/documentacion'
import { detectarMimeDocumento, ipDelPedido, nombreDescarga } from '@/lib/documentacion-archivo'
import { POST as confirmar } from '@/app/api/documentacion/confirmar/route'
import { GET as archivo } from '@/app/api/documentacion/archivo/route'

// ── Simulación de Supabase para las rutas ───────────────────────────────────
// Dos clientes: el de la persona (anon + token) y el del servidor (service).
const llamadas: { cliente: string; fn: string; args: any }[] = []
let usuarioAuth: string | null = 'auth-vigilador'
let documento: any = null
let archivoGuardado: Uint8Array | null = null
let abrirError: string | null = null
let firmas: { ruta: string; segundos: number; opciones: any }[] = []

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, clave: string) => {
    const cliente = clave === 'service' ? 'admin' : 'usuario'
    return {
      auth: {
        getUser: async () => usuarioAuth
          ? { data: { user: { id: usuarioAuth } }, error: null }
          : { data: { user: null }, error: { message: 'invalid' } },
      },
      rpc: async (fn: string, args: any) => {
        llamadas.push({ cliente, fn, args })
        if (fn === 'documentacion_abrir') {
          return abrirError ? { data: null, error: { message: abrirError } }
            : { data: { ruta: 'emp/doc/1.jpg', mime: 'image/jpeg', orden: 1, tipo: 'dni' }, error: null }
        }
        if (fn === 'documentacion_confirmar') return { data: { documento_id: documento?.id, estado: 'pendiente_revision' }, error: null }
        return { data: {}, error: null }
      },
      from: () => {
        const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: documento, error: null }) }
        return q
      },
      storage: {
        from: () => ({
          download: async () => archivoGuardado
            ? { data: new Blob([new Uint8Array(archivoGuardado).buffer as ArrayBuffer]), error: null }
            : { data: null, error: { message: 'not found' } },
          createSignedUrl: async (ruta: string, segundos: number, opciones: any) => {
            firmas.push({ ruta, segundos, opciones })
            return { data: { signedUrl: `https://firmado/${ruta}?t=${segundos}` }, error: null }
          },
        }),
      },
    }
  },
}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:9'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
// Las rutas leen las variables al atender cada pedido, no al importarse.
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'


const DOC = '11111111-1111-4111-8111-111111111111'
const ARCH = '22222222-2222-4222-8222-222222222222'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])

beforeEach(() => {
  llamadas.length = 0; firmas = []; usuarioAuth = 'auth-vigilador'; abrirError = null
  archivoGuardado = JPEG
  documento = { id: DOC, estado: 'subiendo', subido_por_auth: 'auth-vigilador',
    documentacion_archivos: [{ id: ARCH, ruta: 'emp/doc/1.jpg', mime: 'image/jpeg', bytes: JPEG.length }] }
})

const post = (cuerpo: unknown, token = true) => confirmar(new NextRequest('http://localhost/api/documentacion/confirmar', {
  method: 'POST', body: JSON.stringify(cuerpo),
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer t' } : {}) },
}))
const get = (q: string, headers: Record<string, string> = { Authorization: 'Bearer t' }) =>
  archivo(new NextRequest(`http://localhost/api/documentacion/archivo?${q}`, { headers }))

describe('POST /api/documentacion/confirmar', () => {
  it('sin sesión: 401', async () => {
    expect((await post({ documento_id: DOC }, false)).status).toBe(401)
  })
  it('documento de otra persona: 404 y no verifica nada', async () => {
    usuarioAuth = 'auth-otro'
    expect((await post({ documento_id: DOC })).status).toBe(404)
    expect(llamadas).toHaveLength(0)
  })
  it('registra la huella y el tipo REALES de lo guardado, y confirma con la identidad de quien llama', async () => {
    const r = await post({ documento_id: DOC })
    expect(r.status).toBe(200)
    const ver = llamadas.find(l => l.fn === 'documentacion_registrar_verificacion')!
    expect(ver.cliente).toBe('admin')
    expect(ver.args.p_sha256).toBe(createHash('sha256').update(JPEG).digest('hex'))
    expect(ver.args.p_mime_real).toBe('image/jpeg')
    expect(ver.args.p_bytes).toBe(JPEG.length)
    const conf = llamadas.find(l => l.fn === 'documentacion_confirmar')!
    expect(conf.cliente).toBe('usuario')
  })
  it('un archivo disfrazado (HEIC con extensión .jpg) queda registrado como desconocido', async () => {
    archivoGuardado = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])
    await post({ documento_id: DOC })
    expect(llamadas.find(l => l.fn === 'documentacion_registrar_verificacion')!.args.p_mime_real).toBe('desconocido')
  })
  it('si el archivo no llegó a Storage: 409, sin confirmar', async () => {
    archivoGuardado = null
    expect((await post({ documento_id: DOC })).status).toBe(409)
    expect(llamadas.some(l => l.fn === 'documentacion_confirmar')).toBe(false)
  })
  it('id inválido: 400', async () => {
    expect((await post({ documento_id: 'x' })).status).toBe(400)
  })
})

describe('GET /api/documentacion/archivo', () => {
  it('firma por 60 segundos y pasa identidad, IP y navegador a la base', async () => {
    const r = await get(`id=${ARCH}&modo=ver`, { Authorization: 'Bearer t', 'x-forwarded-for': '200.1.1.1', 'user-agent': 'Celular' })
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toContain('no-store')
    expect(firmas[0].segundos).toBe(60)
    expect(firmas[0].opciones).toBeUndefined()
    const ab = llamadas.find(l => l.fn === 'documentacion_abrir')!
    expect(ab.cliente).toBe('admin')
    expect(ab.args).toMatchObject({ p_auth_user_id: 'auth-vigilador', p_archivo_id: ARCH, p_modo: 'ver', p_ip: '200.1.1.1', p_user_agent: 'Celular' })
  })
  it('sin permiso en la base: 404, sin firmar', async () => {
    abrirError = 'Archivo inexistente'
    expect((await get(`id=${ARCH}`)).status).toBe(404)
    expect(firmas).toHaveLength(0)
  })
  it('descarga negada: 403', async () => {
    abrirError = 'La descarga es sólo para Administración y Gerencia'
    expect((await get(`id=${ARCH}&modo=descargar`)).status).toBe(403)
  })
  it('descarga con nombre sin datos personales', async () => {
    await get(`id=${ARCH}&modo=descargar`)
    expect(firmas[0].opciones).toEqual({ download: 'dni-1.jpg' })
  })
  it('sin sesión: 401; modo inválido: 400', async () => {
    expect((await get(`id=${ARCH}`, {})).status).toBe(401)
    expect((await get(`id=${ARCH}&modo=borrar`)).status).toBe(400)
  })
})

// ── Reglas puras ─────────────────────────────────────────────────────────────

const tipo = (t: Partial<TipoDocumento>): TipoDocumento => ({
  codigo: 'dni', nombre: 'DNI', ayuda: null, orden: 1, requisito: 'obligatorio', etapa: 'ingreso',
  caras: null, multiple: false, campo_fecha: 'opcional', etiqueta_fecha: 'Fecha', campo_vencimiento: 'no',
  vigencia_meses: null, etiqueta_detalle: null, sube_vigilador: true, sensibilidad: 'comun',
  constancia: 'conformidad', texto_constancia: 'Confirmo', referencia: null, ...t,
})
const doc = (d: Partial<DocumentoLegajo>): DocumentoLegajo => ({
  id: Math.random().toString(), tipo: 'dni', detalle: null, fecha_emision: null, vence_el: null,
  origen: 'vigilador', estado: 'aprobado', confirmado_at: '2026-10-01T10:00:00Z', ...d,
})
const HOY = '2026-10-09'

describe('Presentado ≠ validado', () => {
  it('subido por la persona y sin revisar: presentado, no cuenta como validado', () => {
    const s = situacionDeTipo(tipo({}), [doc({ estado: 'pendiente_revision' })], HOY)
    expect(s.base).toBe('presentado')
    const r = resumenDocumentacion([tipo({})], [doc({ estado: 'pendiente_revision' })], HOY)
    expect(r).toMatchObject({ obligatorios: 1, validados: 0, presentados: 1, faltan: 0 })
  })
  it('aprobado o aceptado: validado', () => {
    expect(situacionDeTipo(tipo({}), [doc({ estado: 'aceptado', origen: 'administracion' })], HOY).base).toBe('validado')
  })
  it('vencido y por vencer según vence_el', () => {
    expect(situacionDeTipo(tipo({}), [doc({ vence_el: '2026-10-01' })], HOY).base).toBe('vencido')
    expect(situacionDeTipo(tipo({}), [doc({ vence_el: '2026-10-20' })], HOY).base).toBe('por_vencer')
  })
  it('"no corresponde" no cuenta como faltante ni en el total', () => {
    const marca: SituacionMarcada[] = [{ tipo: 'dni', situacion: 'no_corresponde', motivo: 'x' }]
    expect(situacionDeTipo(tipo({}), [], HOY, marca).base).toBe('no_corresponde')
    expect(resumenDocumentacion([tipo({})], [], HOY, marca)).toMatchObject({ obligatorios: 0, faltan: 0 })
  })
  it('solicitado: se muestra como solicitado mientras falte', () => {
    const marca: SituacionMarcada[] = [{ tipo: 'dni', situacion: 'solicitado', motivo: null }]
    const s = situacionDeTipo(tipo({}), [], HOY, marca)
    expect(insigniaTipo(s).texto).toBe('Solicitado')
    expect(resumenDocumentacion([tipo({})], [], HOY, marca).solicitados).toBe(1)
  })
})

describe('Reglas de carga', () => {
  it('lo reservado sólo lo carga Gerencia', () => {
    const t = tipo({ sensibilidad: 'reservado_gerencia', sube_vigilador: false, constancia: 'ninguna', texto_constancia: null })
    expect(puedeSubir(t, false, true, false)).toBe(false)
    expect(puedeSubir(t, false, true, true)).toBe(true)
    expect(puedeSubir(t, true, false, false)).toBe(false)
  })
  it('vencimiento declarado obligatorio y posterior a la emisión', () => {
    const t = tipo({ campo_vencimiento: 'declarado' })
    expect(validarFechas(t, '', '', HOY)).toMatch(/vencimiento/)
    expect(validarFechas(t, '2026-01-01', '2025-01-01', HOY)).toMatch(/posterior/)
    expect(validarFechas(t, '2026-01-01', '2029-01-01', HOY)).toBeNull()
  })
  it('DNI exige frente y dorso; HEIC no se admite tal cual', () => {
    const t = tipo({ caras: ['Frente', 'Dorso'] })
    expect(validarArchivos(t, [{ type: 'image/jpeg', size: 10 }])).toMatch(/Frente y Dorso/)
    expect(validarArchivos(tipo({}), [{ type: 'image/heic', size: 10 }])).toMatch(/Formato/)
  })
})

describe('Tipo real del archivo', () => {
  it('reconoce JPEG, PNG, WEBP y PDF por los bytes', () => {
    expect(detectarMimeDocumento(JPEG)).toBe('image/jpeg')
    expect(detectarMimeDocumento(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(detectarMimeDocumento(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp')
    expect(detectarMimeDocumento(new TextEncoder().encode('%PDF-1.7\n'))).toBe('application/pdf')
    expect(detectarMimeDocumento(new TextEncoder().encode('<html>'))).toBeNull()
  })
  it('nombre de descarga sin datos personales; IP tal como llega', () => {
    expect(nombreDescarga('antecedentes_rnr', 2, 'application/pdf')).toBe('antecedentes_rnr-2.pdf')
    expect(ipDelPedido(new Headers({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }))).toBe('1.1.1.1, 2.2.2.2')
  })
})

describe('Migración de documentación — convenciones', () => {
  const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20261009140000_documentacion_legajo.sql'), 'utf8')
  const sinComentarios = sql.replace(/--.*$/gm, '')
  it('no usa select … into', () => {
    expect(/select\s[^;]*?\binto\s+(strict\s+)?\w+/i.test(sinComentarios.replace(/insert\s+into/gi, ''))).toBe(false)
  })
  it('no hay lectura directa del bucket ni update/delete en Storage', () => {
    expect(/on storage\.objects for (select|update|delete|all)/i.test(sinComentarios)).toBe(false)
  })
  it('las RPC del servidor no se conceden a authenticated', () => {
    for (const f of ['documentacion_abrir', 'documentacion_registrar_verificacion'])
      expect(new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to authenticated`, 'i').test(sql)).toBe(false)
  })
  it('sin datos bancarios ni importes', () => {
    expect(/cbu|cuenta_banc|\bimporte\b/i.test(sinComentarios)).toBe(false)
  })
  it('los adicionales H-9 quedan inactivos', () => {
    for (const c of ['solicitud_empleo', 'alta_art', 'svo', 'art51', 'entrega_epp'])
      expect(new RegExp(`\\('${c}'[\\s\\S]*?, false\\)`, 'm').test(sql)).toBe(true)
  })
})
