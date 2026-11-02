import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

// Integración de #345 (auditoría de octubre), #346 (programación) y #347 (hoja
// de ruta) en #348. Controles de estructura: lo que no puede volver a separarse.
// Decisiones de JC (02/11/2026): la superposición se bloquea siempre y queda
// una sola hoja de ruta, la de #347.
const leer = (p: string) => readFileSync(p, 'utf8').replace(/\r/g, '')
const migraciones = () => readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort()

describe('migraciones', () => {
  // main ya trae números repetidos anteriores (20260812100000, 20261013120000...);
  // se controla desde las de esta integración en adelante.
  it('ningún número de migración se repite desde 20261113', () => {
    const numeros = migraciones().map(f => f.split('_')[0]).filter(n => n >= '20261113000000')
    expect(numeros.filter((n, i) => numeros.indexOf(n) !== i)).toEqual([])
  })

  it('programación va después de la regla de superposición, del historial y de la operación compartida de rondas', () => {
    const orden = migraciones()
    const pos = (s: string) => orden.findIndex(f => f.includes(s))
    const prog = pos('20261125120000_programacion_conflictos')
    expect(prog).toBeGreaterThan(-1)
    expect(prog).toBeGreaterThan(pos('20261121120000_turnos_cobertura_liquidacion'))
    expect(prog).toBeGreaterThan(pos('20261122120000_rondas_historial_exigencias'))
    expect(prog).toBeGreaterThan(pos('20261124120000_rondas_operacion_compartida'))
  })

  it('cada migración nueva tiene su rollback aparte', () => {
    for (const m of migraciones().filter(f => f >= '20261113')) {
      expect(existsSync(`supabase/rollback/${m.replace(/\.sql$/, '')}_rollback.sql`), m).toBe(true)
    }
  })

  it('la operación compartida de rondas de #345 está incluida', () => {
    expect(existsSync('supabase/migrations/20261124120000_rondas_operacion_compartida.sql')).toBe(true)
  })
})

describe('superposición: se bloquea siempre', () => {
  const trigger = leer('supabase/migrations/20261121120000_turnos_cobertura_liquidacion.sql')
  const prog = leer('supabase/migrations/20261125120000_programacion_conflictos_correccion_turnos.sql')
  const editar = leer('app/api/turnos/editar/route.ts')

  it('el trigger de #345 no tiene excepciones por confirmación', () => {
    expect(trigger).toContain('create or replace function public.turnos_validar_superposicion()')
    expect(trigger).not.toContain('_turnos_superposicion_confirmada')
  })

  it('las RPC de programación rechazan la superposición aun confirmada', () => {
    expect(prog).toContain("'puede_confirmar_superposicion', false")
    expect(prog).not.toMatch(/v_alcance <> 'todas'/)
    expect(prog).toMatch(/if v_hay_superposicion then\s+raise exception/)
  })

  it('la edición de turno responde 409 ante superposición, sin pedir confirmación', () => {
    expect(editar).toMatch(/if \(haySuperposicion\(conflictos\)\) \{[\s\S]{0,200}requiere_confirmacion: false/)
    expect(editar).toContain("codigo: 'TURNO_SUPERPUESTO'")
  })
})

describe('turnos anulados', () => {
  it('programación ya no redefine rondas_ventanas_programadas: vale la de 20261122120000', () => {
    const prog = leer('supabase/migrations/20261125120000_programacion_conflictos_correccion_turnos.sql')
    expect(prog).not.toMatch(/create or replace function public\.rondas_ventanas_programadas/i)
    const hist = leer('supabase/migrations/20261122120000_rondas_historial_exigencias.sql')
    expect(hist).toContain("if coalesce(r_turno.estado, '') in ('reemplazado', 'anulado', 'cancelado') then")
    expect(hist).toContain("where c.estado_exigencia in ('exigible', 'pausada')")
  })

  it('push: recordatorios y rondas ignoran turnos sin obligación (#346) con la dedup atómica de #345', () => {
    const push = leer('app/api/_lib/push-notificaciones.ts')
    expect(push.match(/turnoTieneObligacionDeCobertura\(/g)?.length).toBeGreaterThanOrEqual(2)
    expect(push).toContain('export async function enviarAvisoClaimFirst(')
  })
})

describe('hoja de ruta: una sola implementación (#347)', () => {
  it('no quedan la ruta, la librería ni la migración de la versión de #345', () => {
    expect(existsSync('app/api/push/hoja-de-ruta/route.ts')).toBe(false)
    expect(existsSync('lib/hoja-de-ruta.ts')).toBe(false)
    expect(migraciones().some(f => f.includes('hoja_de_ruta'))).toBe(false)
    expect(existsSync('app/api/push/hoja-ruta-supervisores/route.ts')).toBe(true)
    expect(existsSync('lib/hoja-ruta.ts')).toBe(true)
  })

  it('formato definitivo: la plantilla aprobada en Meta, con la hoja entera en una variable', () => {
    const lib = leer('lib/hoja-ruta.ts')
    expect(lib).toContain("export const CUERPO_PLANTILLA = 'HOJA DE RUTA\\n{{1}}\\nFin de hoja de ruta.'")
    expect(lib).not.toMatch(/MERCOSUR SEGURIDAD/)
  })

  it('arranca desactivada', () => {
    expect(leer('supabase/migrations/20261114120000_hoja_ruta_supervisores.sql')).toMatch(/hoja_ruta_modo[\s\S]{0,200}desactivado/)
  })
})

describe('secreto del cron de IA', () => {
  it('la ruta acepta el mismo secreto que hoy (IA_CRON_SECRET o CRON_SECRET)', () => {
    expect(leer('lib/ia/cron-auth.ts')).toContain('env.IA_CRON_SECRET || env.CRON_SECRET')
  })

  it('la base sigue usando app_config mientras Vault no tenga ia_cron_secret', () => {
    const vault = leer('supabase/migrations/20261120140000_ia_cron_secret_vault.sql')
    expect(vault).toContain("where ds.name = 'ia_cron_secret'")
    expect(vault).toContain("v_secret := (select value from public.app_config where key = 'ia_cron_secret');")
  })
})
