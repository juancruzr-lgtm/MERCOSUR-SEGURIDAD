import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  INSTRUCCION_IOS_SIN_PWA,
  INSTRUCCION_PERMISO_BLOQUEADO_ANDROID,
  INSTRUCCION_PERMISO_BLOQUEADO_IOS,
  evaluarEstadoPush,
  textoUltimoEnvio,
  tipoPruebaDispositivo,
} from '@/lib/push-estado'
import type { EntradaEstadoPush } from '@/lib/push-estado'

// Diagnóstico de dispositivo para push. La regla que fija todo esto: estar
// suscripto es que la suscripción de ESTE navegador coincida con una fila
// guardada; una suscripción histórica del usuario no cuenta.

const EP = 'https://fcm.googleapis.com/fcm/send/abc'

const ok: EntradaEstadoPush = {
  permiso: 'granted',
  serviceWorkerActivo: true,
  pushSoportado: true,
  contextoSeguro: true,
  endpointNavegador: EP,
  endpointsGuardados: [EP],
  esIos: false,
  esPwaInstalada: false,
}

describe('evaluarEstadoPush — estados', () => {
  it('todo en orden → funcionando, con prueba habilitada y sin botón de activar', () => {
    const e = evaluarEstadoPush(ok)
    expect(e.codigo).toBe('funcionando')
    expect(e.ok).toBe(true)
    expect(e.puedeProbar).toBe(true)
    expect(e.puedeActivar).toBe(false)
    expect(e.permisoTexto).toBe('Permitido')
    expect(e.serviceWorkerTexto).toBe('Activo')
    expect(e.suscriptoTexto).toBe('Sí')
  })

  it('permiso sin solicitar → pide activar, no permite probar', () => {
    const e = evaluarEstadoPush({ ...ok, permiso: 'default', endpointNavegador: null, endpointsGuardados: [] })
    expect(e.codigo).toBe('permiso_sin_solicitar')
    expect(e.permisoTexto).toBe('Sin solicitar')
    expect(e.puedeActivar).toBe(true)
    expect(e.puedeProbar).toBe(false)
  })

  it('permiso bloqueado → NO ofrece activar (evita el loop de pedir un denied) y da la instrucción del sistema', () => {
    const android = evaluarEstadoPush({ ...ok, permiso: 'denied' })
    expect(android.codigo).toBe('permiso_bloqueado')
    expect(android.permisoTexto).toBe('Bloqueado')
    expect(android.puedeActivar).toBe(false)
    expect(android.accion).toBe(INSTRUCCION_PERMISO_BLOQUEADO_ANDROID)

    const ios = evaluarEstadoPush({ ...ok, permiso: 'denied', esIos: true, esPwaInstalada: true })
    expect(ios.accion).toBe(INSTRUCCION_PERMISO_BLOQUEADO_IOS)
  })

  it('iPhone en Safari sin PWA instalada → explica agregar a inicio, antes que cualquier otra cosa', () => {
    const e = evaluarEstadoPush({ ...ok, esIos: true, esPwaInstalada: false, permiso: 'default' })
    expect(e.codigo).toBe('ios_sin_pwa')
    expect(e.accion).toBe(INSTRUCCION_IOS_SIN_PWA)
    expect(e.puedeActivar).toBe(false)
  })

  it('iPhone con PWA instalada y todo en orden → funcionando', () => {
    expect(evaluarEstadoPush({ ...ok, esIos: true, esPwaInstalada: true }).codigo).toBe('funcionando')
  })

  it('sin Service Worker activo → no está listo, ofrece activar', () => {
    const e = evaluarEstadoPush({ ...ok, serviceWorkerActivo: false })
    expect(e.codigo).toBe('sin_service_worker')
    expect(e.serviceWorkerTexto).toBe('No disponible')
    expect(e.puedeActivar).toBe(true)
  })

  it('sin HTTPS → nada funciona y no ofrece activar', () => {
    const e = evaluarEstadoPush({ ...ok, contextoSeguro: false })
    expect(e.codigo).toBe('sin_https')
    expect(e.puedeActivar).toBe(false)
  })

  it('sin PushManager → no soportado', () => {
    expect(evaluarEstadoPush({ ...ok, pushSoportado: false }).codigo).toBe('sin_soporte_push')
  })
})

describe('evaluarEstadoPush — el dispositivo ACTUAL, no una suscripción histórica', () => {
  it('permiso dado pero el navegador no tiene suscripción → dispositivo no suscripto', () => {
    const e = evaluarEstadoPush({ ...ok, endpointNavegador: null, endpointsGuardados: [EP] })
    expect(e.codigo).toBe('dispositivo_no_suscripto')
    expect(e.suscriptoTexto).toBe('No')
    expect(e.puedeProbar).toBe(false)
  })

  it('el navegador tiene un endpoint distinto del guardado → suscripción desactualizada, con explicación', () => {
    const e = evaluarEstadoPush({ ...ok, endpointNavegador: EP + '-nuevo', endpointsGuardados: [EP] })
    expect(e.codigo).toBe('endpoint_distinto')
    expect(e.suscriptoTexto).toBe('No')
    expect(e.detalle).toContain('cambió su dirección')
    expect(e.puedeActivar).toBe(true)
  })

  it('el navegador tiene suscripción pero el servidor no tiene ninguna → desactualizada (registrar)', () => {
    const e = evaluarEstadoPush({ ...ok, endpointsGuardados: [] })
    expect(e.codigo).toBe('endpoint_distinto')
    expect(e.detalle).toContain('no la tiene registrada')
  })

  it('una fila guardada inactiva no cuenta: el llamador sólo pasa las activas', () => {
    // El contrato: endpointsGuardados son las ACTIVAS. Si la del navegador fue
    // dada de baja por un 410, no aparece y el estado lo dice.
    const e = evaluarEstadoPush({ ...ok, endpointsGuardados: [] })
    expect(e.ok).toBe(false)
  })
})

describe('textos auxiliares', () => {
  it('último envío en lenguaje humano', () => {
    const ahora = new Date('2026-08-18T13:00:00Z')
    expect(textoUltimoEnvio(null)).toBe('Sin envíos registrados')
    expect(textoUltimoEnvio('2026-08-18T12:59:40Z', ahora)).toBe('hace menos de un minuto')
    expect(textoUltimoEnvio('2026-08-18T12:30:00Z', ahora)).toBe('hace 30 min')
    expect(textoUltimoEnvio('2026-08-18T09:00:00Z', ahora)).toBe('hace 4 h')
    expect(textoUltimoEnvio('2026-08-14T09:00:00Z', ahora)).toBe('hace 4 días')
  })

  it('el tipo de la prueba nunca choca con una alerta real', () => {
    const tipo = tipoPruebaDispositivo(new Date('2026-08-18T13:00:00Z'))
    expect(tipo.startsWith('prueba_dispositivo:')).toBe(true)
    expect(tipo).not.toMatch(/supervisor_|guardia_turno|egreso|ronda/)
  })
})

// ── Guardas sobre el circuito real (código fuente) ───────────────────────────

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('circuito push — guardas', () => {
  it('la prueba usa el MISMO sendWebPush que las alertas y da de baja 404/410', () => {
    const prueba = src('app/api/push/prueba/route.ts')
    expect(prueba).toMatch(/import \{ sendWebPush/)
    expect(prueba).toMatch(/status === 404 \|\| response\.status === 410/)
    expect(prueba).toMatch(/update\(\{ activo: false \}\)/)
    // Y sólo al endpoint del dispositivo actual del usuario logueado.
    expect(prueba).toMatch(/\.eq\('usuario_id', perfil\.id\)/)
    expect(prueba).toMatch(/\.eq\('endpoint', endpoint\)/)
  })

  it('el Service Worker muestra la notificación con showNotification (app cerrada)', () => {
    const sw = src('public/sw.js')
    expect(sw).toMatch(/addEventListener\('push'/)
    expect(sw).toMatch(/showNotification/)
    expect(sw).toMatch(/addEventListener\('notificationclick'/)
  })

  it('el envío real inactiva suscripciones 404/410 y no marca enviado sin entrega', () => {
    const cron = src('app/api/_lib/push-notificaciones.ts')
    expect(cron).toMatch(/response\.status === 404 \|\| response\.status === 410/)
    expect(cron).toMatch(/if \(!entregadoAAlguno\) \{ skipped \+= 1; continue \}/)
  })

  it('ronda no iniciada está entre las familias enviadas y se avisa UNA sola vez por alerta', () => {
    const cron = src('app/api/_lib/push-notificaciones.ts')
    expect(cron).toMatch(/supervisor_ronda_\$\{alerta\.tipo\}:\$\{alerta\.id\}/)
    // La guarda contra el reenvío en cambio de guardia (verificado 18/08).
    expect(cron).toMatch(/yaAvisadas\.has\(`supervisor_ronda_\$\{alerta\.tipo\}:\$\{alerta\.id\}`\)/)
  })

  it('el cron de push corre DESPUÉS del evaluador de rondas y con timeout alineado a maxDuration', () => {
    const mig = src('supabase/migrations/20260818130000_cron_push_desfasado.sql')
    expect(mig).toMatch(/'2,12,22,32,42,52 \* \* \* \*'/)
    expect(mig).toMatch(/timeout_milliseconds := 60000/)
    const ruta = src('app/api/push/notificaciones/route.ts')
    expect(ruta).toMatch(/maxDuration = 60/)
  })

  it('los destinatarios salen del resolver operativo, no de un filtro por rol', () => {
    const cron = src('app/api/_lib/push-notificaciones.ts')
    expect(cron).toMatch(/resolverResponsablesOperativos/)
    expect(cron).not.toMatch(/rol === 'supervisor'/)
  })
})
