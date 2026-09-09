import { describe, it, expect } from 'vitest'
import {
  construirLineasVisual, clasificarBloqueados,
  type ConceptoCfg, type PersonaPadron,
} from '@/lib/visual-export'

// ETAPA 1 — Prevalidación antes de Consolidar. La regla es EXACTAMENTE
// construirLineasVisual (la misma que después bloquea la generación Visual).
// LISTO = 0 críticos y 0 bloqueados. Acá se prueban las causas y su separación.
const catalogo = new Map<string, ConceptoCfg>([
  ['001', { politica: 'valor', entrada: 'IMP' }],
  ['203', { politica: 'valor', entrada: 'IMP' }],
  ['104', { politica: 'individual', entrada: 'CALCULADO' }],
  ['111', { politica: 'individual', entrada: 'IMP' }],
])
const persona = (o: Partial<PersonaPadron> = {}): PersonaPadron => ({
  persona_id: 'p1', cod_interno: 'ALM', cuil: '20144945817', nombre: 'ALMADA', ...o,
})
function correr(p: { padron: PersonaPadron[]; dias?: Map<string, number | null>; haberes?: Map<string, any[]>; expedientes?: Map<string, any[]> }) {
  const r = construirLineasVisual({
    padron: p.padron, catalogo,
    haberes: p.haberes ?? new Map([['p1', [{ codigo: '001', cantidad: null, importe: 100 }]]]),
    dias: p.dias ?? new Map([['p1', 20]]),
    permanentes: new Map(), expedientes: p.expedientes ?? new Map(), lineaCero: [],
  })
  const cl = clasificarBloqueados(r.bloqueados)
  const listo = r.criticos.length === 0 && r.bloqueados.length === 0
  return { r, cl, listo }
}

describe('prevalidación de consolidación (regla real de Visual)', () => {
  it('persona lista → LISTO (0 críticos, 0 bloqueados)', () => {
    const { listo, r } = correr({ padron: [persona()] })
    expect(listo).toBe(true)
    expect(r.padron.find(x => x.persona_id === 'p1')?.estado).toBe('exporta')
  })

  it('período completamente válido (varias personas) = LISTO', () => {
    const { listo } = correr({
      padron: [persona(), persona({ persona_id: 'p2', cod_interno: 'OVE', cuil: '20247729187', nombre: 'OVEJERO' })],
      dias: new Map([['p1', 26], ['p2', 22]]),
      haberes: new Map([['p1', [{ codigo: '001', cantidad: null, importe: 1 }]], ['p2', [{ codigo: '203', cantidad: null, importe: 1 }]]]),
    })
    expect(listo).toBe(true)
  })

  it('000 faltante → FALTAN DATOS, causa "000 requerido" (no identidad)', () => {
    const { listo, cl } = correr({ padron: [persona()], dias: new Map() }) // p1 sin días
    expect(listo).toBe(false)
    expect(cl.diasRequerido.length).toBe(1)
    expect(cl.identidadFaltante.length).toBe(0)
  })

  it('identidad Visual faltante (sin COD_INTERNO) → causa identidad (no 000)', () => {
    const { listo, cl } = correr({ padron: [persona({ cod_interno: null })] })
    expect(listo).toBe(false)
    expect(cl.identidadFaltante.length).toBe(1)
    expect(cl.diasRequerido.length).toBe(0)
  })

  it('CUIL inválido → identidad faltante', () => {
    const { cl } = correr({ padron: [persona({ cuil: '123' })] })
    expect(cl.identidadFaltante.some(h => h.tipo === 'cuil_invalido')).toBe(true)
  })

  it('ambas causas (sin COD_INTERNO + sin 000) se reportan SEPARADAS', () => {
    const { cl } = correr({ padron: [persona({ cod_interno: null })], dias: new Map() })
    expect(cl.identidadFaltante.length).toBe(1)
    expect(cl.diasRequerido.length).toBe(1)
  })

  it('>2 expedientes simultáneos → bloquea (causa "otros"), no se descarta ninguno', () => {
    const exps = [
      { referencia: 'e1', importe: 100, slot_preferido: '111' },
      { referencia: 'e2', importe: 200, slot_preferido: '993' },
      { referencia: 'e3', importe: 300, slot_preferido: null },
    ]
    const { listo, cl } = correr({ padron: [persona()], expedientes: new Map([['p1', exps]]) })
    expect(listo).toBe(false)
    expect(cl.otros.some(h => h.tipo === 'expedientes_exceden_slots')).toBe(true)
  })

  it('2 expedientes (111/993) → OK, no bloquea', () => {
    const exps = [
      { referencia: 'e1', importe: 100, slot_preferido: '111' },
      { referencia: 'e2', importe: 200, slot_preferido: '993' },
    ]
    const { listo } = correr({ padron: [persona()], expedientes: new Map([['p1', exps]]) })
    expect(listo).toBe(true)
  })

  it('concepto inválido (código sin config) → CRÍTICO → no LISTO', () => {
    const { listo, r } = correr({ padron: [persona()], haberes: new Map([['p1', [{ codigo: '999', cantidad: null, importe: 1 }]]]) })
    expect(listo).toBe(false)
    expect(r.criticos.some(c => c.tipo === 'concepto_sin_config')).toBe(true)
  })

  it('Consolidar bloqueado si existe cualquier bloqueante (identidad, 000 o expedientes)', () => {
    for (const caso of [
      { padron: [persona({ cod_interno: null })] },                                   // identidad
      { padron: [persona()], dias: new Map() },                                        // 000
      { padron: [persona()], expedientes: new Map([['p1', [{ importe: 1, slot_preferido: '111' }, { importe: 2, slot_preferido: '993' }, { importe: 3, slot_preferido: null }]]]) }, // >2 exp
    ]) {
      expect(correr(caso as any).listo).toBe(false)
    }
  })

  it('excluido de recibo NO bloquea (se reporta no_corresponde, no faltante)', () => {
    // Un supervisor excluido sin identidad NO cuenta como faltante bloqueante.
    const { listo, cl } = correr({ padron: [persona(), persona({ persona_id: 'ex', cod_interno: null, cuil: null, nombre: 'ACOSTA', excluido: true })] })
    expect(listo).toBe(true)
    expect(cl.identidadFaltante.length).toBe(0)
  })
})
