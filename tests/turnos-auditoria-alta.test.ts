import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validarAuditoriaAlta } from '@/lib/turnos-auditoria-alta'

const ID = '0b6f2c1e-1a2b-4c3d-8e9f-001122334455'

describe('motivo del alta de turno desde Reportes', () => {
  it('arma el comentario con origen y motivo', () => {
    const r = validarAuditoriaAlta({ turno_id: ID, origen: 'planilla_empleado', comentario: ' cubrió franco ' })
    expect(r).toEqual({ ok: true, turno_id: ID, origen: 'planilla_empleado', comentario: 'Creado desde Reportes (planilla_empleado) — cubrió franco' })
  })
  it('sin motivo deja constancia', () => {
    const r = validarAuditoriaAlta({ turno_id: ID })
    expect(r.ok && r.comentario).toBe('Creado desde Reportes (reportes) — sin comentario')
  })
  it('rechaza ids inválidos y limpia el origen', () => {
    expect(validarAuditoriaAlta({ turno_id: 'x' }).ok).toBe(false)
    expect(validarAuditoriaAlta(null).ok).toBe(false)
    const r = validarAuditoriaAlta({ turno_id: ID, origen: "a'; drop" })
    expect(r.ok && r.origen).toBe('a drop')
  })
  it('el cliente ya no escribe turnos_auditoria directo', () => {
    const src = readFileSync(join(__dirname, '..', 'app/dashboard/AppClient.tsx'), 'utf8')
    expect(src).not.toMatch(/from\('turnos_auditoria'\)\.insert/)
    expect(src).toContain('/api/turnos/auditoria-alta')
  })
})
