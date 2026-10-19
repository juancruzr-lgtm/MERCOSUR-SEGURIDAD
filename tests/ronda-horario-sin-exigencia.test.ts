/**
 * Horarios en que una ronda no se exige: el WhatsApp y el push al vigilador
 * usan el mismo criterio que la base (inicio de la ventana dentro del horario).
 * Caso real: Laromet Baigorria, domingo desde las 06 el vigilador hace de portero.
 */
import { describe, expect, it } from 'vitest'
import { minutosAbs, seleccionarCandidatosRondaVigilador, ventanaSinExigencia } from '@/lib/ronda-vigilador-wa'
import type { HorarioSinExigencia, ObjetivoVig, RondaBaseVig, TurnoVigente } from '@/lib/ronda-vigilador-wa'

const DOMINGO: HorarioSinExigencia = { ronda_base_id: 'r1', dia_semana: 7, desde: '06:00:00', hasta: '22:00:00' }

describe('ventanaSinExigencia', () => {
  it('domingo 06:00 y 08:00 caen adentro; 04:00 y 22:00 no', () => {
    expect(ventanaSinExigencia([DOMINGO], 'r1', minutosAbs('2026-10-25', '06:00'))).toBe(true)
    expect(ventanaSinExigencia([DOMINGO], 'r1', minutosAbs('2026-10-25', '08:00'))).toBe(true)
    expect(ventanaSinExigencia([DOMINGO], 'r1', minutosAbs('2026-10-25', '04:00'))).toBe(false)
    expect(ventanaSinExigencia([DOMINGO], 'r1', minutosAbs('2026-10-25', '22:00'))).toBe(false)
  })
  it('otro día u otra ronda: se exige', () => {
    expect(ventanaSinExigencia([DOMINGO], 'r1', minutosAbs('2026-10-24', '08:00'))).toBe(false)
    expect(ventanaSinExigencia([DOMINGO], 'otra', minutosAbs('2026-10-25', '08:00'))).toBe(false)
  })
  it('sin horarios cargados: siempre se exige', () => {
    expect(ventanaSinExigencia([], 'r1', minutosAbs('2026-10-25', '08:00'))).toBe(false)
    expect(ventanaSinExigencia(undefined, 'r1', minutosAbs('2026-10-25', '08:00'))).toBe(false)
  })
  it('lunes = 1 (ISO)', () => {
    expect(ventanaSinExigencia([{ ...DOMINGO, dia_semana: 1 }], 'r1', minutosAbs('2026-10-26', '08:00'))).toBe(true)
  })
})

describe('WhatsApp al vigilador en Laromet', () => {
  const turno: TurnoVigente = { id: 't1', guardia_id: 'g1', puesto_id: 'p1', objetivo_id: 'o1', fecha: '2026-10-24', hora_inicio: '22:00', hora_fin: '10:00' }
  const ronda: RondaBaseVig = { id: 'r1', puesto_id: 'p1', nombre: 'Laromet baigorria', hora_inicio: null, intervalo_minutos: 120 }
  const obj: ObjetivoVig = { id: 'o1', nombre: 'Obrador Baigorria', estado: 'activo', es_prueba: false }
  const sel = (ahora: string, horarios?: HorarioSinExigencia[]) => seleccionarCandidatosRondaVigilador({
    ahoraMin: minutosAbs(ahora.slice(0, 10), ahora.slice(11)), turnosVigentes: [turno], rondasBase: [ronda],
    ejecuciones: [], pausas: [], objetivos: [obj], avisoMin: 10, horariosSinExigencia: horarios,
  })
  it('domingo 06:10: sin el horario se avisaba; con el horario, no', () => {
    expect(sel('2026-10-25 06:10')).toHaveLength(1)
    expect(sel('2026-10-25 06:10', [DOMINGO])).toHaveLength(0)
  })
  it('domingo 04:10: con el horario se sigue avisando (es de noche)', () => {
    expect(sel('2026-10-25 04:10', [DOMINGO])).toHaveLength(1)
  })
})
