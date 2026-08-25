import { describe, expect, it } from 'vitest'
import {
  CATEGORIAS_CIERRE,
  agruparPorCategoria,
  cierreDeResponsable,
  cierreEstaLimpio,
  construirCierreOperativo,
  cuentaComoPendiente,
  detalleCierre,
  itemsDeResponsable,
  resumirCierre,
} from '@/lib/cierre-operativo'
import type { CatalogosResponsable, ItemCierre } from '@/lib/cierre-operativo'

// Cierre Operativo Diario. Es un agregador: no detecta nada por su cuenta, sólo
// responde qué le queda a ESTE supervisor antes de cerrar la guardia. La meta
// es "pendientes de hoy = 0", que no significa que todo salió bien sino que el
// supervisor tomó la decisión que le correspondía.

const item = (over: Partial<ItemCierre> = {}): ItemCierre => ({
  id: 'i1',
  categoria: 'planillas',
  fecha: '2026-08-21',
  hora: '10:00',
  objetivoId: 'o1',
  zonaId: 'z-rosario',
  zonaNombre: 'Rosario',
  etiqueta: 'TABORDA · LAROMET',
  resueltoPorSupervisor: false,
  ...over,
})

describe('qué cuenta como pendiente del supervisor', () => {
  it('lo que todavía no decidió, cuenta', () => {
    expect(cuentaComoPendiente(item())).toBe(true)
  })

  it('lo resuelto no cuenta', () => {
    expect(cuentaComoPendiente(item({ resueltoPorSupervisor: true }))).toBe(false)
  })

  it('lo correctamente derivado a Administración no es pendiente del supervisor', () => {
    // Sigue abierto para Administración; deja de ser trabajo de él.
    const derivado = item({ id: 'derivado', resueltoPorSupervisor: true })
    const resumen = resumirCierre([item({ id: 'abierto' }), derivado])
    expect(resumen.total).toBe(1)
    expect(resumen.items.map(i => i.id)).toEqual(['abierto'])
  })
})

describe('hoy y arrastre van separados', () => {
  const items = [
    item({ id: 'h1', fecha: '2026-08-21', categoria: 'planillas' }),
    item({ id: 'h2', fecha: '2026-08-21', categoria: 'rondas' }),
    item({ id: 'v1', fecha: '2026-08-18', categoria: 'rondas' }),
    item({ id: 'v2', fecha: '2026-08-11', categoria: 'operacion' }),
    item({ id: 'v3', fecha: '2026-08-11', categoria: 'fotos_ia' }),
  ]

  it('no se mezclan', () => {
    const cierre = construirCierreOperativo(items, '2026-08-21')
    expect(cierre.hoy.total).toBe(2)
    expect(cierre.anteriores.total).toBe(3)
  })

  it('el total de cada lado es la suma de sus categorías', () => {
    const cierre = construirCierreOperativo(items, '2026-08-21')
    for (const lado of [cierre.hoy, cierre.anteriores]) {
      const suma = CATEGORIAS_CIERRE.reduce((acc, c) => acc + lado.porCategoria[c], 0)
      expect(suma).toBe(lado.total)
    }
  })

  it('un turno que cruza medianoche sigue siendo del día de su turno', () => {
    // 06:00 del 22 pero fecha operativa 21: es la guardia de anoche, no arrastre.
    const cierre = construirCierreOperativo(
      [item({ id: 'nocturno', fecha: '2026-08-21', hora: '06:00' })],
      '2026-08-21',
    )
    expect(cierre.hoy.total).toBe(1)
    expect(cierre.anteriores.total).toBe(0)
  })

  it('cerrar la guardia limpia es tener hoy en cero, aunque quede arrastre', () => {
    const cierre = construirCierreOperativo(
      [item({ id: 'v', fecha: '2026-08-10' })],
      '2026-08-21',
    )
    expect(cierreEstaLimpio(cierre)).toBe(true)
    expect(cierre.anteriores.total).toBe(1)
  })

  it('detalleCierre nombra sólo las categorías con algo', () => {
    const cierre = construirCierreOperativo(items, '2026-08-21')
    const texto = detalleCierre(cierre.hoy)
    expect(texto).toContain('1 planillas')
    expect(texto).toContain('1 rondas')
    expect(texto).not.toContain('operación')
  })
})

// ── Responsable del hecho, no el de ahora ────────────────────────────────────

const SABINO = 'u-sabino'
const WALTER = 'u-walter'
const CRISTIAN = 'u-cristian'

const catalogos: CatalogosResponsable = {
  zonas: [
    { id: 'z-rosario', nombre: 'Rosario' },
    { id: 'z-rafaela', nombre: 'Rafaela' },
  ],
  guardias: [
    // Rosario: Sabino de día, Walter de noche.
    { supervisor_id: SABINO, zona: 'Rosario', fecha: '2026-08-18', hora_inicio: '07:00', hora_fin: '19:00', estado: 'activo' },
    { supervisor_id: WALTER, zona: 'Rosario', fecha: '2026-08-18', hora_inicio: '19:00', hora_fin: '07:00', estado: 'activo' },
    // Al otro día cambia la guardia de Rosario: entra Walter de día.
    { supervisor_id: WALTER, zona: 'Rosario', fecha: '2026-08-21', hora_inicio: '07:00', hora_fin: '19:00', estado: 'activo' },
  ],
  // Rafaela no tiene guardia horaria: responde su responsable de zona.
  supervisorZonas: [{ supervisor_id: CRISTIAN, zona_id: 'z-rafaela' }],
}

describe('responsable histórico: la deuda no cambia de dueño al rotar la guardia', () => {
  it('una incidencia diurna del 18 en Rosario sigue siendo de Sabino', () => {
    const viejo = item({ id: 'viejo', fecha: '2026-08-18', hora: '10:00' })
    expect(itemsDeResponsable([viejo], SABINO, catalogos).map(i => i.id)).toEqual(['viejo'])
  })

  it('y no pasa a Walter sólo porque hoy la guardia diurna es suya', () => {
    const viejo = item({ id: 'viejo', fecha: '2026-08-18', hora: '10:00' })
    expect(itemsDeResponsable([viejo], WALTER, catalogos)).toEqual([])
  })

  it('la nocturna del 18 sí es de Walter', () => {
    const nocturna = item({ id: 'noche', fecha: '2026-08-18', hora: '23:30' })
    expect(itemsDeResponsable([nocturna], WALTER, catalogos).map(i => i.id)).toEqual(['noche'])
  })

  it('sin guardia horaria manda el responsable de zona', () => {
    const rafaela = item({ id: 'raf', zonaId: 'z-rafaela', zonaNombre: 'Rafaela', fecha: '2026-08-18', hora: '10:00' })
    expect(itemsDeResponsable([rafaela], CRISTIAN, catalogos).map(i => i.id)).toEqual(['raf'])
  })

  it('el cierre de cada uno separa su hoy de su arrastre', () => {
    const items = [
      item({ id: 'hoy-walter', fecha: '2026-08-21', hora: '10:00' }),
      item({ id: 'viejo-sabino', fecha: '2026-08-18', hora: '10:00' }),
    ]
    const deWalter = cierreDeResponsable(items, WALTER, '2026-08-21', catalogos)
    expect(deWalter.hoy.total).toBe(1)
    expect(deWalter.anteriores.total).toBe(0)

    const deSabino = cierreDeResponsable(items, SABINO, '2026-08-21', catalogos)
    expect(deSabino.hoy.total).toBe(0)
    expect(deSabino.anteriores.total).toBe(1)
  })
})

describe('agruparPorCategoria: lo que ve el supervisor en la lista', () => {
  it('sólo aparecen las categorías con algo', () => {
    const r = resumirCierre([item({ id: 'a' }), item({ id: 'b', categoria: 'rondas' })])
    expect(agruparPorCategoria(r).map(g => g.categoria)).toEqual(['planillas', 'rondas'])
  })

  it('lo resuelto no aparece en ningún grupo', () => {
    const r = resumirCierre([item({ id: 'a', resueltoPorSupervisor: true })])
    expect(agruparPorCategoria(r)).toEqual([])
  })

  it('dentro de cada grupo: primero el día más reciente, y ahí por hora', () => {
    const r = resumirCierre([
      item({ id: 'a', fecha: '2026-08-24', hora: '22:00' }),
      item({ id: 'b', fecha: '2026-08-25', hora: '19:00' }),
      item({ id: 'c', fecha: '2026-08-25', hora: '07:00' }),
    ])
    expect(agruparPorCategoria(r)[0].items.map(i => i.id)).toEqual(['c', 'b', 'a'])
  })
})
