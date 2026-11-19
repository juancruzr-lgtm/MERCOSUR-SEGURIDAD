import { describe, expect, it } from 'vitest'
import { limpiarVariable, objetivosSinConfigurar, PLANTILLA_OBJETIVO_SIN_CONFIGURAR, variablesAviso, vistaPrevia, type ObjetivoNuevo } from '@/lib/objetivo-sin-configurar'

const o = (id: string, created_at: string, extra: Partial<ObjetivoNuevo> = {}): ObjetivoNuevo =>
  ({ id, nombre: `Objetivo ${id}`, cliente: 'Cliente', direccion: 'Calle 123', estado: 'activo', es_prueba: false, created_at, ...extra })

const AHORA = '2026-11-19T15:00:00Z'
const CORTE = '2026-11-19T00:00:00Z'

describe('objetivo nuevo sin protocolo ni rondas', () => {
  it('sin corte de activación no avisa nada (evita el envío masivo de los que ya existen)', () => {
    const r = objetivosSinConfigurar({ objetivos: [o('a', '2026-11-19T10:00:00Z')], conProtocolo: new Set(), conRondas: new Set(), corteIso: null, ahoraIso: AHORA })
    expect(r.candidatos).toEqual([])
    expect(r.descartes).toEqual({ sin_corte_de_activacion: 1 })
  })

  it('sólo nuevos, pasado el margen, sin protocolo NI rondas, activos y no de prueba', () => {
    const r = objetivosSinConfigurar({
      objetivos: [
        o('nuevo', '2026-11-19T10:00:00Z'),
        o('viejo', '2026-10-01T10:00:00Z'),
        o('recien', '2026-11-19T14:50:00Z'),
        o('conProt', '2026-11-19T10:00:00Z'),
        o('conRonda', '2026-11-19T10:00:00Z'),
        o('prueba', '2026-11-19T10:00:00Z', { es_prueba: true }),
        o('baja', '2026-11-19T10:00:00Z', { estado: 'inactivo' }),
      ],
      conProtocolo: new Set(['conProt']), conRondas: new Set(['conRonda']), corteIso: CORTE, ahoraIso: AHORA,
    })
    expect(r.candidatos.map(c => c.objetivoId)).toEqual(['nuevo'])
    expect(r.candidatos[0].minutosDesdeCreacion).toBe(300)
    expect(r.descartes).toEqual({ creado_antes_de_activar: 1, dentro_del_margen: 1, ya_configurado: 2, prueba: 1, inactivo: 1 })
  })

  it('el mensaje explica qué objetivo y cómo cargarlo, sin saltos de línea en las variables', () => {
    const [c] = objetivosSinConfigurar({ objetivos: [o('x', '2026-11-19T10:00:00Z', { nombre: 'PLANTA\nNORTE', cliente: null, direccion: null })], conProtocolo: new Set(), conRondas: new Set(), corteIso: CORTE, ahoraIso: AHORA }).candidatos
    const v = variablesAviso('Aldo', c)
    expect(v).toEqual(['Aldo', 'PLANTA NORTE', 'sin cliente', 'sin dirección cargada'])
    const texto = vistaPrevia(v)
    expect(texto).toMatch(/Hola Aldo\. Se dio de alta el objetivo \*PLANTA NORTE\*/)
    expect(texto).toMatch(/1\) Protocolos/)
    expect(texto).toMatch(/2\) Rondas/)
    expect(PLANTILLA_OBJETIVO_SIN_CONFIGURAR.cuerpo.length).toBeLessThan(1024) // límite de Meta para el cuerpo
    expect(limpiarVariable('a'.repeat(100), 10)).toHaveLength(10)
  })
})
