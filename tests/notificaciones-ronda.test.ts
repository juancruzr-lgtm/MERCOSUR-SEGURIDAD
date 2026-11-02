import { describe, expect, it } from 'vitest'
import {
  claveAvisoRonda, claveResumenRonda, claveSeguimientoVencido, contarAvisosPorUsuario,
  destinatariosConFallback, enLotes, leerClavesEnLotes, planificarAvisosRonda, textoResumenRonda,
  type AlertaRondaAviso,
} from '@/lib/notificaciones-ronda'
import { enviarAvisoClaimFirst } from '@/app/api/_lib/push-notificaciones'
import {
  auditarAntesDeEnviar, contarEnviosPorDestinatario, descarteWaRonda, inicioDiaArgentina,
} from '@/lib/whatsapp-auditoria'

// Auditoría de octubre 2026: el backlog de alertas rompía la deduplicación
// (un IN gigante → 400 → "no avisé ninguna" → reenvío de todo), alertas sin
// responsable se reintentaban cada 10 minutos y lo viejo se entregaba en masa.

const AHORA = Date.parse('2026-10-07T15:00:00Z')
const haceMin = (m: number) => new Date(AHORA - m * 60000).toISOString()
const alerta = (id: string, minutos: number, extra: Partial<AlertaRondaAviso> = {}): AlertaRondaAviso => ({
  id, tipo: 'no_iniciada', objetivo_id: 'obj', detectada_at: haceMin(minutos), estado: 'pendiente', ...extra,
})

describe('leerClavesEnLotes — dedup en lotes y fail-closed', () => {
  it('parte 337 claves en lotes de 100', async () => {
    const lotes: number[] = []
    const r = await leerClavesEnLotes(async lote => { lotes.push(lote.length); return { data: [{ tipo: lote[0] }], error: null } },
      Array.from({ length: 337 }, (_, i) => `k${i}`))
    expect(lotes).toEqual([100, 100, 100, 37])
    expect(r.ok).toBe(true)
    expect(r.claves.size).toBe(4)
  })

  it('un lote con error → ok:false (el llamador no envía nada)', async () => {
    let n = 0
    const r = await leerClavesEnLotes(async () => (++n === 2 ? { data: null, error: { message: '400 URI too long' } } : { data: [], error: null }),
      Array.from({ length: 250 }, (_, i) => `k${i}`))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/400/)
  })

  it('una excepción de red también es fail-closed', async () => {
    const r = await leerClavesEnLotes(async () => { throw new Error('fetch failed') }, ['a'])
    expect(r).toMatchObject({ ok: false, error: 'fetch failed' })
  })

  it('enLotes no pierde ni repite', () => {
    expect(enLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
})

describe('planificarAvisosRonda', () => {
  const base = { avisosHoyPorUsuario: new Map<string, number>(), ahora: AHORA, destinatarios: () => ['sup'] }

  it('una alerta se avisa una sola vez: ya avisada a cualquiera → no se repite', () => {
    const a = alerta('a1', 5)
    const plan = planificarAvisosRonda({ ...base, alertas: [a], yaAvisadas: new Set([claveAvisoRonda(a)]) })
    expect(plan.individuales).toHaveLength(0)
    expect(plan.omitidas.ya_avisada).toBe(1)
  })

  it('alerta intervenida (con acción) no se avisa', () => {
    const plan = planificarAvisosRonda({ ...base, alertas: [alerta('a1', 5, { accion: 'llamada_vigilador' })], yaAvisadas: new Set() })
    expect(plan.individuales).toHaveLength(0)
    expect(plan.omitidas.intervenida).toBe(1)
  })

  it('seguimiento vencido se avisa una vez, con su propia clave', () => {
    const a = alerta('a1', 300, { accion: 'llamada_vigilador', resultado_intervencion: 'seguimiento', seguimiento_hasta: haceMin(5) })
    const plan = planificarAvisosRonda({ ...base, alertas: [a], yaAvisadas: new Set([claveAvisoRonda(a)]) })
    expect(plan.individuales).toHaveLength(1)
    expect(plan.individuales[0]).toMatchObject({ clave: claveSeguimientoVencido(a), seguimientoVencido: true })
    const otra = planificarAvisosRonda({ ...base, alertas: [a], yaAvisadas: new Set([claveSeguimientoVencido(a)]) })
    expect(otra.individuales).toHaveLength(0)
  })

  it('seguimiento todavía vigente no se avisa', () => {
    const a = alerta('a1', 30, { accion: 'llamada_vigilador', resultado_intervencion: 'seguimiento', seguimiento_hasta: new Date(AHORA + 3600e3).toISOString() })
    expect(planificarAvisosRonda({ ...base, alertas: [a], yaAvisadas: new Set() }).omitidas.intervenida).toBe(1)
  })

  it('lo viejo (> 2 h) no sale suelto: va al resumen', () => {
    const plan = planificarAvisosRonda({ ...base, alertas: [alerta('vieja', 121), alerta('nueva', 10)], yaAvisadas: new Set() })
    expect(plan.individuales.map(i => i.alerta.id)).toEqual(['nueva'])
    expect(plan.resumen.get('sup')).toEqual(['vieja'])
    expect(plan.omitidas.vieja).toBe(1)
  })

  it('el 07/10: 337 pendientes viejas → 0 avisos sueltos y 1 resumen por supervisor', () => {
    const alertas = Array.from({ length: 337 }, (_, i) => alerta(`a${i}`, 180 + i))
    const plan = planificarAvisosRonda({ ...base, alertas, yaAvisadas: new Set(), destinatarios: () => ['s1', 's2', 's3'] })
    expect(plan.individuales).toHaveLength(0)
    expect(plan.resumen.size).toBe(3)
    expect(plan.resumen.get('s1')).toHaveLength(337)
  })

  it('tope diario por supervisor: lo que excede va al resumen; lo más reciente primero', () => {
    const alertas = Array.from({ length: 5 }, (_, i) => alerta(`a${i}`, 10 + i))
    const plan = planificarAvisosRonda({
      ...base, alertas, yaAvisadas: new Set(), topeDiario: 3,
      avisosHoyPorUsuario: new Map([['sup', 1]]),
    })
    expect(plan.individuales.map(i => i.alerta.id)).toEqual(['a0', 'a1'])
    expect(plan.resumen.get('sup')).toEqual(['a2', 'a3', 'a4'])
    expect(plan.omitidas.tope_diario).toBe(3)
  })

  it('el tope es por persona: un supervisor sin cupo no le quita el aviso a otro', () => {
    const plan = planificarAvisosRonda({
      ...base, alertas: [alerta('a1', 5)], yaAvisadas: new Set(), topeDiario: 2,
      destinatarios: () => ['lleno', 'libre'], avisosHoyPorUsuario: new Map([['lleno', 2]]),
    })
    expect(plan.individuales[0].usuarios).toEqual(['libre'])
    expect(plan.resumen.get('lleno')).toEqual(['a1'])
  })

  it('sin destinatario no hay aviso (y no se reintenta en loop: se cuenta)', () => {
    const plan = planificarAvisosRonda({ ...base, alertas: [alerta('a1', 5)], yaAvisadas: new Set(), destinatarios: () => [] })
    expect(plan.omitidas.sin_destinatario).toBe(1)
  })

  it('alertas resueltas se ignoran', () => {
    expect(planificarAvisosRonda({ ...base, alertas: [alerta('a1', 5, { estado: 'resuelta' })], yaAvisadas: new Set() }).individuales).toHaveLength(0)
  })
})

describe('claves, conteos y textos', () => {
  it('resumen: una clave por día y bloque de 6 h', () => {
    expect(claveResumenRonda('2026-10-07', '05:59')).toBe('supervisor_ronda_resumen:2026-10-07:0')
    expect(claveResumenRonda('2026-10-07', '06:00')).toBe('supervisor_ronda_resumen:2026-10-07:1')
    expect(claveResumenRonda('2026-10-07', '23:10')).toBe('supervisor_ronda_resumen:2026-10-07:3')
  })
  it('el resumen no consume cupo; otros tipos tampoco', () => {
    const m = contarAvisosPorUsuario([
      { usuario_id: 'u', tipo: 'supervisor_ronda_no_iniciada:1' },
      { usuario_id: 'u', tipo: 'supervisor_ronda_resumen:2026-10-07:1' },
      { usuario_id: 'u', tipo: 'turno_tardanza' },
    ])
    expect(m.get('u')).toBe(1)
  })
  it('texto del resumen', () => {
    expect(textoResumenRonda(1).body).toMatch(/Hay 1 alerta/)
    expect(textoResumenRonda(34).body).toMatch(/Hay 34 alertas/)
  })
})

describe('destinatariosConFallback — varios responsables sin guardia', () => {
  const lista = [
    { usuario_id: 'jefe', rol_en_escalamiento: 'jefe_supervisores', activo: true },
    { usuario_id: 'dir', rol_en_escalamiento: 'direccion', activo: true },
  ]
  it('con responsables no hay fallback', () => {
    expect(destinatariosConFallback(['s1'], lista)).toEqual({ usuarios: ['s1'], fallback: false })
  })
  it('sin responsables → jefe de supervisores', () => {
    expect(destinatariosConFallback([], lista)).toEqual({ usuarios: ['jefe'], fallback: true })
  })
  it('sin jefe activo → la lista entera (dirección)', () => {
    expect(destinatariosConFallback([], [{ ...lista[0], activo: false }, lista[1]])).toEqual({ usuarios: ['dir'], fallback: true })
  })
  it('sin lista → nadie', () => {
    expect(destinatariosConFallback([], [])).toEqual({ usuarios: [], fallback: false })
  })
})

// Cliente falso de Supabase con lo mínimo: insert / delete encadenable.
function clienteFalso(opciones: { insertFalla?: boolean } = {}) {
  const ops: string[] = []
  const filtro = () => {
    const q: any = { eq: () => q, is: () => q, then: (ok: any) => Promise.resolve({ error: null }).then(ok) }
    return q
  }
  return {
    ops,
    from: (tabla: string) => ({
      insert: async () => { ops.push(`insert:${tabla}`); return { error: opciones.insertFalla ? { message: 'duplicate key' } : null } },
      delete: () => { ops.push(`delete:${tabla}`); return filtro() },
      update: () => { ops.push(`update:${tabla}`); return filtro() },
    }),
  }
}

describe('enviarAvisoClaimFirst — reclamar antes de enviar', () => {
  const subs = [{ id: 's1', usuario_id: 'u', endpoint: 'e', p256dh: 'p', auth: 'a' }] as any
  const payload = { title: 't', body: 'b' }

  it('reclama y después envía', async () => {
    const c = clienteFalso(); const enviados: string[] = []
    const r = await enviarAvisoClaimFirst(c, subs, 'u', 'obj', 'k', payload, async s => { enviados.push(s.id); return { status: 201 } })
    expect(r).toBe('enviado')
    expect(c.ops).toEqual(['insert:notificaciones_enviadas'])
    expect(enviados).toEqual(['s1'])
  })
  it('reclamo rechazado (ya enviada u error) → NO envía', async () => {
    const c = clienteFalso({ insertFalla: true }); let enviados = 0
    const r = await enviarAvisoClaimFirst(c, subs, 'u', 'obj', 'k', payload, async () => { enviados++; return { status: 201 } })
    expect(r).toBe('ya_reclamada')
    expect(enviados).toBe(0)
  })
  it('sin dispositivo no reclama nada', async () => {
    const c = clienteFalso()
    expect(await enviarAvisoClaimFirst(c, subs, 'otro', 'obj', 'k', payload, async () => ({ status: 201 }))).toBe('sin_dispositivo')
    expect(c.ops).toEqual([])
  })
  it('sin entrega libera la reserva para reintentar', async () => {
    const c = clienteFalso()
    const r = await enviarAvisoClaimFirst(c, subs, 'u', null, 'k', payload, async () => { throw new Error('caído') })
    expect(r).toBe('sin_entrega')
    expect(c.ops).toEqual(['insert:notificaciones_enviadas', 'delete:notificaciones_enviadas'])
  })
})

describe('WhatsApp de rondas: auditoría previa y descartes', () => {
  it('auditarAntesDeEnviar devuelve el id, o null si no pudo registrar', async () => {
    const ok = { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'x' }, error: null }) }) }) }) }
    const mal = { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'x' } }) }) }) }) }
    expect(await auditarAntesDeEnviar(ok, { nivel: 'n' })).toBe('x')
    expect(await auditarAntesDeEnviar(mal, { nivel: 'n' })).toBeNull()
  })
  it('descarteWaRonda: intervenida y vieja', () => {
    expect(descarteWaRonda({ detectada_at: haceMin(5), accion: 'llamada_vigilador' }, AHORA)).toBe('intervenida')
    expect(descarteWaRonda({ detectada_at: haceMin(121) }, AHORA)).toBe('vieja')
    expect(descarteWaRonda({ detectada_at: haceMin(5) }, AHORA)).toBeNull()
    expect(descarteWaRonda({ detectada_at: null }, AHORA)).toBe('vieja')
  })
  it('el tope cuenta enviados y reclamados, no fallidos', () => {
    const m = contarEnviosPorDestinatario([
      { destinatario_id: 'a', resultado: 'enviado' }, { destinatario_id: 'a', resultado: 'reclamado' },
      { destinatario_id: 'a', resultado: 'fallido' }, { destinatario_id: null, resultado: 'enviado' },
    ])
    expect(m.get('a')).toBe(2)
  })
  it('inicio del día en hora argentina', () => {
    expect(inicioDiaArgentina('2026-10-07')).toBe('2026-10-07T03:00:00.000Z')
  })
})
