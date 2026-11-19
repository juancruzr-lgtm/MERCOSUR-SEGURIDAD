import { describe, expect, it } from 'vitest'
import { limpiarVariable, objetivosSinConfigurar, PLANTILLA_OBJETIVO_SIN_CONFIGURAR, textoFalta, variablesAviso, vistaPrevia, type ObjetivoNuevo } from '@/lib/objetivo-sin-configurar'

const o = (id: string, created_at: string, extra: Partial<ObjetivoNuevo> = {}): ObjetivoNuevo =>
  ({ id, nombre: `Objetivo ${id}`, cliente: 'Cliente', estado: 'activo', es_prueba: false, created_at, ...extra })

const AHORA = '2026-11-19T15:00:00Z'
const CORTE = '2026-11-19T00:00:00Z'

describe('objetivo nuevo sin protocolo o sin ronda', () => {
  it('sin corte de activación no avisa nada (evita el envío masivo de los que ya existen)', () => {
    const r = objetivosSinConfigurar({ objetivos: [o('a', '2026-11-19T10:00:00Z')], conProtocolo: new Set(), conRondas: new Set(), corteIso: null, ahoraIso: AHORA })
    expect(r.candidatos).toEqual([])
  })

  it('avisa si falta cualquiera de los dos y dice qué falta', () => {
    const r = objetivosSinConfigurar({
      objetivos: [
        o('ambos', '2026-11-19T10:00:00Z'), o('sinRonda', '2026-11-19T10:00:00Z'), o('sinProt', '2026-11-19T10:00:00Z'), o('completo', '2026-11-19T10:00:00Z'),
        o('viejo', '2026-10-01T10:00:00Z'), o('recien', '2026-11-19T14:50:00Z'), o('prueba', '2026-11-19T10:00:00Z', { es_prueba: true }),
      ],
      conProtocolo: new Set(['sinRonda', 'completo']), conRondas: new Set(['sinProt', 'completo']), corteIso: CORTE, ahoraIso: AHORA,
    })
    expect(r.candidatos.map(c => [c.objetivoId, c.falta])).toEqual([['ambos', 'protocolo y ronda'], ['sinRonda', 'ronda'], ['sinProt', 'protocolo']])
    expect(r.descartes).toEqual({ ya_configurado: 1, creado_antes_de_activar: 1, dentro_del_margen: 1, prueba: 1 })
    expect(textoFalta(false, false)).toBeNull()
  })

  it('el mensaje es el aprobado en Meta, con cuatro variables', () => {
    const [c] = objetivosSinConfigurar({ objetivos: [o('x', '2026-11-19T10:00:00Z', { nombre: 'DEPÓSITO\nNORTE', cliente: null })], conProtocolo: new Set(), conRondas: new Set(), corteIso: CORTE, ahoraIso: AHORA }).candidatos
    const v = variablesAviso('Aldo', c)
    expect(v).toEqual(['Aldo', 'DEPÓSITO NORTE', 'sin cliente', 'protocolo y ronda'])
    expect(vistaPrevia(v)).toMatch(/^Hola Aldo\. Se dio de alta el objetivo DEPÓSITO NORTE \(cliente sin cliente\) y todavía le falta: protocolo y ronda\./)
    expect(PLANTILLA_OBJETIVO_SIN_CONFIGURAR.cuerpo.length).toBeLessThan(1024)
    expect(limpiarVariable('a'.repeat(100), 10)).toHaveLength(10)
  })
})
