import { describe, expect, it } from 'vitest'
import { decidirReclamo, esFuncionAusente, ordenarSegunCola, PROCESANDO_COLGADO_MS } from '@/lib/ia/cola'
import { autorizadoCronIA, secretosAceptados } from '@/lib/ia/cron-auth'

const AHORA = Date.parse('2026-11-02T12:00:00Z')
const hace = (ms: number) => new Date(AHORA - ms).toISOString()
const en = (ms: number) => new Date(AHORA + ms).toISOString()

describe('reclamo de una evidencia que ya tiene fila de análisis', () => {
  it('error transitorio con intentos y ya vencido el plazo: reintenta', () => {
    expect(decidirReclamo({ estado: 'error', intentos: 2, proximo_intento_at: hace(1000) }, 5, AHORA)).toEqual({ accion: 'reintentar' })
  })
  it('error con próximo intento en el futuro: espera', () => {
    expect(decidirReclamo({ estado: 'error', intentos: 2, proximo_intento_at: en(1000) }, 5, AHORA).accion).toBe('omitir')
  })
  it('error con intentos agotados: pasa a error definitivo y sale de la cola', () => {
    expect(decidirReclamo({ estado: 'error', intentos: 5 }, 5, AHORA)).toEqual({ accion: 'agotar' })
  })
  it('procesando reciente: otra corrida la tiene, no se duplica', () => {
    expect(decidirReclamo({ estado: 'procesando', intentos: 1, updated_at: hace(60_000) }, 5, AHORA).accion).toBe('omitir')
  })
  it('procesando colgada (función cortada): se recupera', () => {
    expect(decidirReclamo({ estado: 'procesando', intentos: 1, updated_at: hace(PROCESANDO_COLGADO_MS + 1) }, 5, AHORA)).toEqual({ accion: 'recuperar' })
  })
  it('procesando colgada sin intentos: definitivo', () => {
    expect(decidirReclamo({ estado: 'procesando', intentos: 5, updated_at: hace(PROCESANDO_COLGADO_MS + 1) }, 5, AHORA)).toEqual({ accion: 'agotar' })
  })
  it('completada o definitiva: nunca se re-analiza', () => {
    expect(decidirReclamo({ estado: 'completado', intentos: 1 }, 5, AHORA).accion).toBe('omitir')
    expect(decidirReclamo({ estado: 'error_definitivo', intentos: 5 }, 5, AHORA).accion).toBe('omitir')
  })
})

describe('orden de la cola', () => {
  it('respeta el orden devuelto por la base y descarta lo que no vino', () => {
    const evs = [{ id: 'c' }, { id: 'a' }, { id: 'x' }, { id: 'b' }]
    expect(ordenarSegunCola(evs, ['a', 'b', 'c']).map(e => e.id)).toEqual(['a', 'b', 'c'])
  })
  it('función ausente (migración sin aplicar) se detecta para caer a la consulta anterior', () => {
    expect(esFuncionAusente({ code: 'PGRST202', message: 'Could not find the function' })).toBe(true)
    expect(esFuncionAusente({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(esFuncionAusente(null)).toBe(false)
  })
})

describe('autenticación del cron de IA', () => {
  it('acepta el secreto actual', () => {
    expect(autorizadoCronIA('Bearer nuevo', { IA_CRON_SECRET: 'nuevo' })).toBe(true)
  })
  it('durante la rotación acepta también el anterior', () => {
    const env = { IA_CRON_SECRET: 'nuevo', IA_CRON_SECRET_ANTERIOR: 'viejo' }
    expect(autorizadoCronIA('Bearer viejo', env)).toBe(true)
    expect(autorizadoCronIA('Bearer otro', env)).toBe(false)
  })
  it('cae a CRON_SECRET si no hay secreto propio', () => {
    expect(autorizadoCronIA('Bearer comun', { CRON_SECRET: 'comun' })).toBe(true)
  })
  it('sin secreto configurado no autoriza nada', () => {
    expect(secretosAceptados({})).toEqual([])
    expect(autorizadoCronIA('Bearer ', {})).toBe(false)
    expect(autorizadoCronIA(null, { IA_CRON_SECRET: 'x' })).toBe(false)
  })
})
