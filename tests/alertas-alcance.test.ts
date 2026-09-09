import { describe, expect, it } from 'vitest'
import {
  filtrarTurnosParaAlertas,
  objetivoIdsParaAlertas,
  turnoEnAlcanceAlertas,
} from '@/lib/alertas-alcance'

// Escenario real del bug (09/09/2026): un supervisor con alcance Rosario veía
// en su tab Alertas el ingreso fuera de radio de CYE CONSTRUCCIONES (Rafaela).

const ZONA_ROSARIO = 'zona-rosario'
const ZONA_RAFAELA = 'zona-rafaela'

const objetivos = [
  { id: 'obj-casa-juan', zona_id: ZONA_ROSARIO },
  { id: 'obj-cye', zona_id: ZONA_RAFAELA }, // CYE CONSTRUCCIONES
  { id: 'obj-sin-zona', zona_id: null },
]

// Un turno por objetivo, cada uno con una situación de alerta distinta.
const turnos = [
  { id: 't-rosario', objetivo_id: 'obj-casa-juan' },
  { id: 't-cye', objetivo_id: 'obj-cye' }, // IBARRA 08/09 18:00→07:00
  { id: 't-sin-zona', objetivo_id: 'obj-sin-zona' },
]

const zonasRosario = new Set([ZONA_ROSARIO])
const zonasRafaela = new Set([ZONA_RAFAELA])

describe('objetivoIdsParaAlertas', () => {
  it('supervisor de Rosario: CYE (Rafaela) queda fuera del alcance', () => {
    const permitidos = objetivoIdsParaAlertas('zonas_asignadas', objetivos, zonasRosario)
    expect(permitidos).not.toBeNull()
    expect(permitidos!.has('obj-cye')).toBe(false)
  })

  it('supervisor de Rosario: sus propios objetivos siguen en alcance', () => {
    const permitidos = objetivoIdsParaAlertas('zonas_asignadas', objetivos, zonasRosario)
    expect(permitidos!.has('obj-casa-juan')).toBe(true)
  })

  it('supervisor de Rafaela: CYE está en su alcance', () => {
    const permitidos = objetivoIdsParaAlertas('zonas_asignadas', objetivos, zonasRafaela)
    expect(permitidos!.has('obj-cye')).toBe(true)
    expect(permitidos!.has('obj-casa-juan')).toBe(false)
  })

  it("alcance 'todas' (admin/gerencia): sin límite, ve ambas zonas y sin-zona", () => {
    expect(objetivoIdsParaAlertas('todas', objetivos, new Set())).toBeNull()
    const filtrados = filtrarTurnosParaAlertas(turnos, null)
    expect(filtrados.map(t => t.id)).toEqual(['t-rosario', 't-cye', 't-sin-zona'])
  })

  it('objetivo sin zona: fail-closed para alcance zonificado', () => {
    const permitidos = objetivoIdsParaAlertas('zonas_asignadas', objetivos, zonasRosario)
    expect(permitidos!.has('obj-sin-zona')).toBe(false)
  })

  it('supervisor sin zonas asignadas: no ve ningún objetivo (fail-closed)', () => {
    const permitidos = objetivoIdsParaAlertas('zonas_asignadas', objetivos, new Set<string>())
    expect(permitidos!.size).toBe(0)
  })
})

describe('filtrarTurnosParaAlertas — base única para las 4 categorías', () => {
  // La componente deriva descubiertos / sin ingreso / tardanzas / fuera de
  // radio (y las intervenidas) de UNA base filtrada. Acá se simulan las cuatro
  // derivaciones sobre esa base y se verifica que ninguna categoría puede
  // resucitar un turno fuera de alcance.
  const permitidosRosario = objetivoIdsParaAlertas('zonas_asignadas', objetivos, zonasRosario)
  const base = filtrarTurnosParaAlertas(turnos, permitidosRosario)

  // Ocurrencias por registro (tardanza / fuera de radio buscan el turno en la base).
  const registros = [
    { id: 'r-rosario', turno_id: 't-rosario', gps_ingreso_estado: 'fuera_radio' },
    { id: 'r-cye', turno_id: 't-cye', gps_ingreso_estado: 'fuera_radio' }, // 997 m / radio 50 m
    { id: 'r-sin-zona', turno_id: 't-sin-zona', gps_ingreso_estado: 'fuera_radio' },
  ]

  const categorias: Record<string, Array<{ objetivo_id?: string | null }>> = {
    descubiertos: base.filter(() => true),
    sinIngreso: base.filter(() => true),
    tardanzas: registros.flatMap(r => {
      const turno = base.find(t => t.id === r.turno_id)
      return turno ? [turno] : []
    }),
    fueraRadio: registros.flatMap(r => {
      const turno = base.find(t => t.id === r.turno_id)
      return turno && r.gps_ingreso_estado === 'fuera_radio' ? [turno] : []
    }),
  }

  it('el supervisor de Rosario no recibe CYE en NINGUNA categoría', () => {
    for (const [nombre, lista] of Object.entries(categorias)) {
      const ids = lista.map(t => t.objetivo_id)
      expect(ids, nombre).not.toContain('obj-cye')
      expect(ids, nombre).not.toContain('obj-sin-zona')
      expect(ids, nombre).toContain('obj-casa-juan')
    }
  })

  it('todas las categorías respetan exactamente el mismo conjunto permitido', () => {
    for (const lista of Object.values(categorias)) {
      for (const t of lista) {
        expect(turnoEnAlcanceAlertas(t.objetivo_id, permitidosRosario)).toBe(true)
      }
    }
  })

  it('los contadores salen de las listas filtradas (suman sólo lo visible)', () => {
    const total =
      categorias.descubiertos.length +
      categorias.sinIngreso.length +
      categorias.tardanzas.length +
      categorias.fueraRadio.length
    // 1 turno visible (Rosario) presente en las 4 categorías simuladas.
    expect(total).toBe(4)
  })
})
