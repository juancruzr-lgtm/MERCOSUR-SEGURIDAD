import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  ACLARACION_CATEGORIAS, ETIQUETA_COBERTURA, ETIQUETA_SITUACION, distribucionHoraria, franjasSinSupervision,
  resumenLegajo, ventanaPeriodo,
} from '@/lib/legajo-supervisor'
import type { GuardiaLegajo, NivelCobertura, SituacionTurno, SupervisionLegajo } from '@/lib/legajo-supervisor'

// Auditoría del 20/10 sobre José Luis Martínez y Sabino Aranda (01–20/10/2026).
// Casos reales de producción; horas en Argentina (UTC−3).

const MIG = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20261105120000_legajo_clasificacion_por_franja.sql'), 'utf8')
const VERIF = readFileSync(join(__dirname, '..', 'supabase', 'verificacion', 'legajo_clasificacion_por_franja_post_migracion.sql'), 'utf8')

function guardia(p: Partial<GuardiaLegajo>): GuardiaLegajo {
  return {
    guardia_id: 'g', supervisor_id: 'jl', supervisor: 'Jose Luis Martinez', fecha: '2026-10-01', zona: 'Rosario',
    tipo_evento: 'normal', estado: 'activo', cubre: true, inicio: '', fin: '', horas_programadas: 12,
    gps_desde: null, gps_hasta: null, gps_puntos: 0, supervisiones: 0, objetivos_visitados: 0, ...p,
  }
}
function sup(created_at: string, situacion: SituacionTurno, cobertura: NivelCobertura | null = null, programado: string | null = null): SupervisionLegajo {
  return {
    supervision_id: created_at + situacion, supervisor_id: 'jl', supervisor: 'Jose Luis Martinez', created_at,
    objetivo_id: 'o', objetivo: 'SRT', zona_id: 'z', zona: 'Rosario', estado: 'ok', observaciones: null,
    items_total: 5, items_observados: 0, novedades_items: null, fotos: 1, lat: null, lng: null,
    distancia_objetivo_m: null, radio_m: null, guardia_id: situacion === 'en_turno' ? 'g' : null,
    situacion, cobertura, programado,
  }
}

describe('guardia nocturna que empieza el día anterior al período', () => {
  // Noche de Fulla 30/09 19:00 → 01/10 07:00; período elegido 01/10–20/10.
  const noche = guardia({ guardia_id: 'g3009', fecha: '2026-09-30', inicio: '2026-09-30T22:00:00Z', fin: '2026-10-01T10:00:00Z' })
  const v = ventanaPeriodo('2026-10-01', '2026-10-20')

  it('la ventana va del 01/10 00:00 al 21/10 00:00, hora argentina', () => {
    expect(v).toEqual({ desde: '2026-10-01T03:00:00.000Z', hasta: '2026-10-21T03:00:00.000Z' })
  })
  it('suma sólo las 7 h de 00 a 07 del primer día (antes no se contaba nada)', () => {
    const f = distribucionHoraria([], [noche], v)
    expect(f.reduce((a, x) => a + x.minutosServicio, 0)).toBe(7 * 60)
    expect(f.filter(x => x.minutosServicio === 60).map(x => x.hora)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(resumenLegajo([noche], [], v).horasProgramadas).toBe(7)
  })
  it('sin ventana, cuenta la guardia entera (comportamiento anterior, para otros usos)', () => {
    expect(distribucionHoraria([], [noche]).reduce((a, x) => a + x.minutosServicio, 0)).toBe(12 * 60)
  })
  it('las franjas sin supervisiones sólo se miden dentro del período: no inventa un hueco 19–24 h del 30/09', () => {
    const h = franjasSinSupervision(noche, [], 120, new Date('2026-10-20T12:00:00Z'), v)
    expect(h).toEqual([{ desde: '2026-10-01T03:00:00.000Z', hasta: '2026-10-01T10:00:00.000Z', minutos: 420 }])
  })
  it('una guardia de día del día anterior no entra en el período', () => {
    const dia = guardia({ fecha: '2026-09-30', inicio: '2026-09-30T10:00:00Z', fin: '2026-09-30T22:00:00Z' })
    expect(distribucionHoraria([], [dia], v).every(x => x.minutosServicio === 0)).toBe(true)
    expect(resumenLegajo([dia], [], v).guardiasServicio).toBe(0)
  })
})

describe('casos reales de José Luis Martínez (01–20/10)', () => {
  it('02/10 02:30 dentro de su guardia del 01/10 19:00–02/10 07:00 cuenta como en turno y suma a las 02 h', () => {
    const g = guardia({ inicio: '2026-10-01T22:00:00Z', fin: '2026-10-02T10:00:00Z' })
    const f = distribucionHoraria([sup('2026-10-02T05:30:00Z', 'en_turno')], [g], ventanaPeriodo('2026-10-01', '2026-10-20'))
    expect(f[2]).toMatchObject({ enTurno: 1, minutosServicio: 60 })
  })
  it('totales reales del período: 128 = 58 en turno + 70 cubrió (6 programación, 52 evidencia, 12 probables) + 0 + 0', () => {
    const lista = [
      ...Array.from({ length: 58 }, (_, i) => sup(`2026-10-0${1 + (i % 9)}T12:${String(i).padStart(2, '0')}:00Z`, 'en_turno')),
      ...Array.from({ length: 6 }, (_, i) => sup(`2026-10-14T0${i}:10:00Z`, 'cubrio_otro', 'confirmada_programacion', 'SABINO ARANDA')),
      ...Array.from({ length: 52 }, (_, i) => sup(`2026-10-05T1${i % 10}:${String(i).padStart(2, '0')}:00Z`, 'cubrio_otro', 'confirmada_evidencia', 'SABINO ARANDA')),
      ...Array.from({ length: 8 }, (_, i) => sup(`2026-10-03T0${i}:20:00Z`, 'cubrio_otro', 'probable', 'SABINO ARANDA')),
      ...Array.from({ length: 4 }, (_, i) => sup(`2026-10-01T0${3 + i}:40:00Z`, 'cubrio_otro', 'probable', 'WALTER DARIO FULLA')),
    ]
    const r = resumenLegajo([], lista)
    expect(r).toMatchObject({ supervisiones: 128, enTurno: 58, cubrioOtro: 70, coberturasProbables: 12, sinProgramacion: 0, fueraTurno: 0 })
    expect(r.enTurno + r.cubrioOtro + r.sinProgramacion + r.fueraTurno).toBe(r.supervisiones)
    const h = distribucionHoraria(lista, [])
    expect(h.reduce((a, x) => a + x.enTurno + x.cubrioOtro + x.sinProgramacion + x.fueraTurno, 0)).toBe(128)
  })
})

describe('casos reales de Sabino Aranda (01–20/10)', () => {
  it('totales reales: 227 = 109 en turno + 109 cubrió (evidencia) + 7 sin programación + 2 fuera de turno', () => {
    const lista = [
      ...Array.from({ length: 109 }, (_, i) => sup(`2026-10-10T${String(i % 24).padStart(2, '0')}:00:00Z`, 'en_turno')),
      ...Array.from({ length: 109 }, (_, i) => sup(`2026-10-06T${String(i % 24).padStart(2, '0')}:05:00Z`, 'cubrio_otro', 'confirmada_evidencia', 'Jose Luis Martinez')),
      ...Array.from({ length: 7 }, (_, i) => sup(`2026-10-02T0${i}:15:00Z`, 'sin_programacion')),
      sup('2026-10-16T15:00:00Z', 'fuera_turno', null, 'Jose Luis Martinez'),
      sup('2026-10-10T15:00:00Z', 'fuera_turno', null, 'SERGIO MARTINEZ'),
    ]
    const r = resumenLegajo([], lista)
    expect(r).toMatchObject({ supervisiones: 227, enTurno: 109, cubrioOtro: 109, coberturasProbables: 0, sinProgramacion: 7, fueraTurno: 2 })
  })
})

describe('textos: categorías informativas, sin penalización', () => {
  it('etiquetas pedidas', () => {
    expect(ETIQUETA_SITUACION).toEqual({
      en_turno: 'En su turno', cubrio_otro: 'Cubrió guardia de otro', sin_programacion: 'Sin programación', fuera_turno: 'Fuera de turno',
    })
    expect(ETIQUETA_COBERTURA.probable).toMatch(/revisar/i)
  })
  it('la aclaración dice que no son faltas y que el calendario puede no tener los intercambios', () => {
    expect(ACLARACION_CATEGORIAS).toMatch(/no faltas/)
    expect(ACLARACION_CATEGORIAS).toMatch(/intercambios/)
  })
})

describe('la migración: reglas y lo que NO hace', () => {
  const sentencia = MIG.slice(MIG.indexOf('begin;'), MIG.indexOf('commit;'))
  it('cobertura confirmada por programación = su guardia tiene otro titular original', () => {
    expect(sentencia).toMatch(/gs\.supervisor_original_id is not null and gs\.supervisor_original_id <> b\.supervisor_id/)
    expect(sentencia).toContain("'confirmada_programacion'")
  })
  it('confirmada por evidencia = intercambio en espejo dentro de ±24 h; probable = sólo la señal débil', () => {
    expect(sentencia).toMatch(/gp\.ini < b\.created_at \+ interval '24 hours' and gp\.fin > b\.created_at - interval '24 hours'/)
    expect(sentencia).toMatch(/filter \(where x\.hizo_mas and x\.espejo\) as confirmados/)
    expect(sentencia).toMatch(/filter \(where x\.hizo_mas and not x\.espejo\) as probables/)
  })
  it('que el programado no haya hecho controles NO alcanza: hace falta que esta persona haya hecho más', () => {
    expect(sentencia).toMatch(/< \(select count\(\*\) from sp where sp\.supervisor_id = b\.supervisor_id and sp\.created_at >= gs\.ini and sp\.created_at < gs\.fin\) as hizo_mas/)
  })
  it('incluye la noche que empezó el día anterior (sólo si llega al período)', () => {
    expect(sentencia).toContain('where g.fecha between p_desde - 1 and p_hasta')
    expect(sentencia).toContain('where g.fecha >= p_desde or g.fin > v_t0')
  })
  it('no escribe nada ni toca el calendario, los turnos ni la función vieja', () => {
    expect(sentencia).not.toMatch(/\binsert\b|\bupdate\b|\bdelete\b|\btruncate\b|drop function|alter table/i)
    expect(sentencia).not.toContain('function public.legajo_supervisores_supervisiones(')
  })
  it('la verificación espera los totales reales de José Luis y Aranda', () => {
    expect(VERIF).toContain("'José Luis 01–20/10: en turno / cubrió / sin prog. / fuera', '58/70/0/0'")
    expect(VERIF).toContain("'Aranda 01–20/10: en turno / cubrió / sin prog. / fuera', '109/109/7/2'")
  })
})
