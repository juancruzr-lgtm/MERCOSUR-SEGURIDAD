import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

// Integración de #345 (auditoría de octubre), #346 (programación) y #347 (hoja
// de ruta). Controles de estructura: lo que no puede volver a separarse.
const leer = (p: string) => readFileSync(p, 'utf8').replace(/\r/g, '')

describe('migraciones', () => {
  // main ya trae números repetidos anteriores (20260812100000, 20261013120000...);
  // se controla desde las de esta integración en adelante.
  it('ningún número de migración se repite desde 20261113', () => {
    const numeros = readdirSync('supabase/migrations')
      .filter(f => f.endsWith('.sql'))
      .map(f => f.split('_')[0])
      .filter(n => n >= '20261113000000')
    const repetidos = numeros.filter((n, i) => numeros.indexOf(n) !== i)
    expect(repetidos).toEqual([])
  })

  it('programación corre antes de la regla de superposición y del historial de rondas', () => {
    const orden = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort()
    const pos = (s: string) => orden.findIndex(f => f.includes(s))
    expect(pos('20261113110000_programacion_conflictos')).toBeGreaterThan(-1)
    expect(pos('20261113110000_programacion_conflictos')).toBeLessThan(pos('20261121120000_turnos_cobertura_liquidacion'))
    expect(pos('20261113110000_programacion_conflictos')).toBeLessThan(pos('20261122120000_rondas_historial_exigencias'))
  })

  it('cada migración nueva tiene su rollback aparte', () => {
    for (const m of ['20261113110000_programacion_conflictos_correccion_turnos', '20261114120000_hoja_ruta_supervisores',
      '20261121120000_turnos_cobertura_liquidacion', '20261122120000_rondas_historial_exigencias']) {
      expect(existsSync(`supabase/rollback/${m}_rollback.sql`)).toBe(true)
    }
  })
})

describe('superposición: regla en base (#345) + confirmación con motivo (#346)', () => {
  const trigger = leer('supabase/migrations/20261121120000_turnos_cobertura_liquidacion.sql')
  const prog = leer('supabase/migrations/20261113110000_programacion_conflictos_correccion_turnos.sql')
  const editar = leer('app/api/turnos/editar/route.ts')

  it('el trigger deja pasar sólo la superposición confirmada del par', () => {
    expect(trigger).toContain('and not public._turnos_superposicion_confirmada(new.guardia_id, new.id, t2.id)')
    expect(trigger).toMatch(/c\.tipo = ''superposicion''/)
  })

  it('las RPC de programación guardan la constancia ANTES del update', () => {
    const asignar = prog.slice(prog.indexOf('create or replace function public.asignar_vigilador_turnos('))
    expect(asignar.indexOf('insert into public.turnos_conflictos_confirmados'))
      .toBeLessThan(asignar.indexOf('update public.turnos set guardia_id = p_guardia_id'))
    const corregir = prog.slice(prog.indexOf('create or replace function public.corregir_turno_programacion('))
    expect(corregir.indexOf('insert into public.turnos_conflictos_confirmados'))
      .toBeLessThan(corregir.indexOf('update public.turnos set hora_inicio = p_hora_inicio'))
  })

  it('la edición de turno guarda la constancia antes del update y traduce el rechazo del trigger', () => {
    expect(editar.indexOf("from('turnos_conflictos_confirmados').insert"))
      .toBeLessThan(editar.indexOf(".from('turnos')\n    .update(updatePayload)"))
    expect(editar).toContain("codigo: 'TURNO_SUPERPUESTO'")
    expect(editar).toContain("codigo: 'CONFLICTO_VIGILADOR'")
    expect(editar).toContain('Objetivo fuera de tu alcance')
  })

  it('el rollback de programación se niega si la regla y el historial siguen aplicados', () => {
    const rb = leer('supabase/rollback/20261113110000_programacion_conflictos_correccion_turnos_rollback.sql')
    expect(rb).toContain('Revertir primero 20261122120000 y 20261121120000')
  })
})

describe('turnos anulados', () => {
  it('el historial de rondas (#345) sigue excluyendo turnos anulados/reemplazados/cancelados', () => {
    const hist = leer('supabase/migrations/20261122120000_rondas_historial_exigencias.sql')
    expect(hist).toContain("if coalesce(r_turno.estado, '') in ('reemplazado', 'anulado', 'cancelado') then")
    expect(hist).toContain("where c.estado_exigencia in ('exigible', 'pausada')")
  })

  it('push: recordatorios y rondas ignoran turnos sin obligación (#346) con la dedup atómica de #345', () => {
    const push = leer('app/api/_lib/push-notificaciones.ts')
    expect(push.match(/turnoTieneObligacionDeCobertura\(/g)?.length).toBeGreaterThanOrEqual(2)
    expect(push).toContain('export async function enviarAvisoClaimFirst(')
    expect(push).toContain('exigibilidadSupervision(objetivo, contextoExigibilidad)')
  })
})

describe('hoja de ruta: una sola implementación (#347)', () => {
  it('no quedan la ruta, la tabla ni la librería de la versión anterior', () => {
    expect(existsSync('app/api/push/hoja-de-ruta/route.ts')).toBe(false)
    expect(existsSync('lib/hoja-de-ruta.ts')).toBe(false)
    expect(readdirSync('supabase/migrations').some(f => f.includes('hoja_de_ruta'))).toBe(false)
    expect(existsSync('app/api/push/hoja-ruta-supervisores/route.ts')).toBe(true)
    expect(existsSync('lib/hoja-ruta.ts')).toBe(true)
  })

  it('formato definitivo: encabezado de 4 líneas y visitas "hora — objetivo"', () => {
    const lib = leer('lib/hoja-ruta.ts')
    expect(lib).toContain("export const CUERPO_PLANTILLA = 'HOJA DE RUTA\\nFecha: {{1}}\\nTurno: {{2}}\\nSupervisor: {{3}}\\n{{4}}'")
    expect(lib).not.toMatch(/MERCOSUR SEGURIDAD/)
  })

  it('arranca desactivada', () => {
    expect(leer('supabase/migrations/20261114120000_hoja_ruta_supervisores.sql')).toMatch(/hoja_ruta_modo[\s\S]{0,200}desactivado/)
  })
})
