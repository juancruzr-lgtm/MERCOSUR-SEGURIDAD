import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  claveEnvioWhatsApp, completarEnvio, crearPresupuestoCorrida, destinatariosConRespaldo,
  esErrorReintentable, eventoRonda, eventoTurno, reclamarEnvio,
} from '@/lib/whatsapp-envio-seguro'

const clienteRpc = (resp: any, registro: any[] = []) => ({
  rpc: async (nombre: string, args: any) => { registro.push([nombre, args]); return typeof resp === 'function' ? resp(nombre, args) : resp },
})

describe('clave estable del envío', () => {
  it('es la misma para el mismo (etapa, evento, destinatario) y distinta si cambia uno', () => {
    const a = claveEnvioWhatsApp({ etapa: 'escalamiento_wa_ronda_no_iniciada', evento: eventoRonda('A1'), destinatarioId: 'U1' })
    expect(a).toBe('wa|escalamiento_wa_ronda_no_iniciada|ronda_alerta:A1|U1')
    expect(claveEnvioWhatsApp({ etapa: 'escalamiento_wa_ronda_no_iniciada', evento: eventoRonda('A1'), destinatarioId: 'U1' })).toBe(a)
    expect(claveEnvioWhatsApp({ etapa: 'escalamiento_wa_ronda_no_iniciada', evento: eventoRonda('A1'), destinatarioId: 'U2' })).not.toBe(a)
    expect(claveEnvioWhatsApp({ etapa: 'escalamiento_wa_15', evento: eventoTurno('T1'), destinatarioId: 'U1' })).toBe('wa|escalamiento_wa_15|turno:T1|U1')
  })
  it('sin destinatario no hay clave', () => {
    expect(() => claveEnvioWhatsApp({ etapa: 'escalamiento_wa_15', evento: 'turno:T', destinatarioId: '' })).toThrow()
  })
})

describe('reclamarEnvio (fail-closed)', () => {
  it('ok sólo con id de la base', async () => {
    const reg: any[] = []
    const r = await reclamarEnvio(clienteRpc({ data: { ok: true, id: 'X', intento: 2 }, error: null }, reg), 'k', { nivel: 'n' }, { topeDestinatarioDia: 15, topeEvento: 3 })
    expect(r).toEqual({ ok: true, id: 'X', intento: 2 })
    expect(reg[0][0]).toBe('reclamar_envio_whatsapp')
    expect(reg[0][1]).toMatchObject({ p_clave: 'k', p_max_intentos: 3, p_backoff_min: 10, p_tope_destinatario_dia: 15, p_tope_evento: 3 })
  })
  it('motivo de la base se propaga (duplicado, tope, intervenida)', async () => {
    for (const motivo of ['ya_enviado', 'tope_destinatario', 'intervenida', 'en_curso_o_incierto']) {
      expect(await reclamarEnvio(clienteRpc({ data: { ok: false, motivo }, error: null }), 'k', {})).toEqual({ ok: false, motivo })
    }
  })
  it('error de la RPC, excepción o respuesta rara ⇒ NO enviar', async () => {
    expect(await reclamarEnvio(clienteRpc({ data: null, error: { message: 'function does not exist' } }), 'k', {})).toEqual({ ok: false, motivo: 'error_rpc' })
    expect(await reclamarEnvio({ rpc: async () => { throw new Error('red') } }, 'k', {})).toEqual({ ok: false, motivo: 'error_rpc' })
    expect(await reclamarEnvio(clienteRpc({ data: { ok: true }, error: null }), 'k', {})).toEqual({ ok: false, motivo: 'error_rpc' })
  })
})

describe('reintento después de un fallo', () => {
  it('clasifica errores reintentables', () => {
    expect(esErrorReintentable('HTTP 503')).toBe(true)
    expect(esErrorReintentable('fetch failed')).toBe(true)
    expect(esErrorReintentable('(#131056) (Business Account, Consumer Account) pair rate limit hit')).toBe(true)
    expect(esErrorReintentable('Recipient phone number not in allowed list')).toBe(false)
    expect(esErrorReintentable('Template name does not exist in the translation')).toBe(false)
    expect(esErrorReintentable('WHATSAPP_TOKEN o WHATSAPP_PHONE_ID sin configurar')).toBe(false)
    expect(esErrorReintentable(null)).toBe(false)
  })
  it('completarEnvio informa si el fallo es reintentable y nunca lanza', async () => {
    const reg: any[] = []
    await completarEnvio(clienteRpc({ error: null }, reg), 'id1', { ok: false, error: 'HTTP 502' })
    await completarEnvio(clienteRpc({ error: null }, reg), 'id2', { ok: true, idProveedor: 'wamid' })
    expect(reg[0][1]).toMatchObject({ p_id: 'id1', p_ok: false, p_reintentable: true })
    expect(reg[1][1]).toMatchObject({ p_id: 'id2', p_ok: true, p_reintentable: false, p_id_proveedor: 'wamid' })
    await expect(completarEnvio({ rpc: async () => { throw new Error('x') } }, 'id', { ok: true })).resolves.toBeUndefined()
  })
})

describe('presupuesto de la corrida (evita morir por maxDuration a mitad)', () => {
  it('corta por cantidad y por tiempo', () => {
    let t = 0
    const p = crearPresupuestoCorrida({ maxEnvios: 2, maxMs: 1000 }, () => t)
    expect(p.disponible()).toBe(true); p.registrar(); p.registrar()
    expect(p.disponible()).toBe(false)
    const q = crearPresupuestoCorrida({ maxEnvios: 99, maxMs: 1000 }, () => t)
    t = 1000
    expect(q.disponible()).toBe(false)
  })
})

describe('supervisor sin guardia asignada', () => {
  it('con guardia: los de guardia (sin duplicar)', () => {
    expect(destinatariosConRespaldo({ responsables: ['A', 'A', 'B'], origen: 'guardia' }, ['J'])).toEqual({ destinatarios: ['A', 'B'], origen: 'guardia', motivoSinDestinatario: null })
  })
  it('sin nadie de guardia: sube a los jefes', () => {
    expect(destinatariosConRespaldo({ responsables: [], origen: 'multiples_sin_guardia' }, ['J'])).toMatchObject({ destinatarios: ['J'], origen: 'fallback_jefes' })
  })
  it('sin guardia y sin jefes: motivo explícito, ningún destinatario', () => {
    expect(destinatariosConRespaldo({ responsables: null, origen: 'multiples_sin_guardia' }, [])).toEqual({ destinatarios: [], origen: 'multiples_sin_guardia', motivoSinDestinatario: 'VARIOS_RESPONSABLES_SIN_GUARDIA_DEFINIDA' })
    expect(destinatariosConRespaldo({ responsables: [], origen: 'sin_zona' }, []).motivoSinDestinatario).toBe('SIN_SUPERVISOR_RESPONSABLE')
  })
})

describe('las rutas reclaman en la base antes de enviar (regresión del 07/10)', () => {
  for (const ruta of ['app/api/push/escalamiento-whatsapp/route.ts', 'app/api/push/ronda-vigilador-whatsapp/route.ts']) {
    it(ruta, () => {
      const src = readFileSync(ruta, 'utf8')
      // Cada proveedor.enviar va precedido por un reclamarEnvio con su chequeo.
      const envios = src.split('await proveedor.enviar(').length - 1
      const reclamos = src.split('await reclamarEnvio(client').length - 1
      expect(envios).toBeGreaterThan(0)
      expect(reclamos).toBe(envios)
      expect(src).toContain('if (!reclamo.ok)')
      expect(src).toContain('presupuesto.disponible()')
      // Ya no se libera la marca para reintentar sin límite.
      expect(src).not.toMatch(/notificaciones_enviadas'\)\s*\.delete\(\)/)
    })
  }
})
