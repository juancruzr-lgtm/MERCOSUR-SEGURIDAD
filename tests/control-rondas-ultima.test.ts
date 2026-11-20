import { describe, it, expect } from 'vitest'
import { rondaRelevante, ultimaHecha, proximaAt } from '@/lib/rondas-panel'
const base = (o: any) => ({ ejecucion_id: null, iniciada_at: null, finalizada_at: null, ...o }) as any
const ahora = Date.parse('2026-11-19T23:11:00-03:00')
const v = (h: string, h2: string, x: any = {}) => base({ ventana_inicio: `2026-11-19T${h}:00-03:00`, ventana_fin: `2026-11-19T${h2}:00-03:00`, vencimiento_at: `2026-11-19T${h2}:00-03:00`, ...x })
describe('panel rondas', () => {
  const sunchales = [v('21:30', '23:30', { ejecucion_id: 'e1', iniciada_at: '2026-11-19T21:25:00-03:00', finalizada_at: '2026-11-19T21:31:11-03:00' }), v('23:30', '23:59')]
  it('muestra la hecha aunque la ventana siga abierta', () => { expect(rondaRelevante(sunchales, ahora)?.ejecucion_id).toBe('e1') })
  it('hora real de la última', () => { expect(ultimaHecha(sunchales)?.finalizada_at).toContain('21:31') })
  it('próxima', () => { expect(proximaAt(sunchales, ahora)).toContain('23:30') })
  it('sin nada vencido ni hecho: muestra la próxima', () => { expect(rondaRelevante([v('23:30', '23:59')], ahora)?.ventana_inicio).toContain('23:30') })
  it('sin rondas', () => { expect(ultimaHecha([])).toBeNull(); expect(rondaRelevante([], ahora)).toBeNull() })
})
