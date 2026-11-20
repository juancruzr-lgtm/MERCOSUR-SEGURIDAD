import { describe, expect, it } from 'vitest'
import {
  armarAvisosSupervisionJefe,
  ausenciaConfirmada,
  claveAvisoSupervision,
  clasificarRonda,
  controlPreventivoVisible,
  escalamientoSupervisionJefeHabilitado,
  inicioTurnoMs,
  jefesDeEscalamiento,
  nivelEscalamientoSupervision,
  objetivosSinSupervision,
  puestosSinCubrir,
  puntoConGpsDudoso,
  resumirClasificacion,
  rondaRequiereRevision,
  type EjecucionRonda,
  type PuntoEjecucion,
  type TurnoProximo,
} from '@/lib/control-preventivo'
import { CONTEXTO_EXIGIBILIDAD_VACIO } from '@/lib/supervisiones'

const H = 3_600_000
// 20/11/2026 12:00 hora argentina
const AHORA = Date.parse('2026-11-20T12:00:00-03:00')
const hace = (h: number) => new Date(AHORA - h * H).toISOString()

describe('interruptores', () => {
  it('nacen apagados', () => {
    expect(controlPreventivoVisible(undefined)).toBe(false)
    expect(controlPreventivoVisible('0')).toBe(false)
    expect(controlPreventivoVisible('true')).toBe(false)
    expect(controlPreventivoVisible('1')).toBe(true)
    expect(escalamientoSupervisionJefeHabilitado(undefined)).toBe(false)
    expect(escalamientoSupervisionJefeHabilitado('1')).toBe(true)
  })
})

describe('4.1 vencimiento y escalamiento', () => {
  it('vigente no escala', () => {
    expect(nivelEscalamientoSupervision(hace(10), 24, AHORA)).toBeNull()
    expect(nivelEscalamientoSupervision(hace(24), 24, AHORA)).toBeNull() // justo en el borde sigue vigente
  })
  it('vencido hasta 2× la frecuencia → supervisor', () => {
    expect(nivelEscalamientoSupervision(hace(25), 24, AHORA)).toBe('supervisor')
    expect(nivelEscalamientoSupervision(hace(48), 24, AHORA)).toBe('supervisor')
  })
  it('más de 2× la frecuencia → jefe de supervisores', () => {
    expect(nivelEscalamientoSupervision(hace(48.1), 24, AHORA)).toBe('jefe_supervisores')
    expect(nivelEscalamientoSupervision(hace(170), 72, AHORA)).toBe('jefe_supervisores')
    expect(nivelEscalamientoSupervision(hace(100), 72, AHORA)).toBe('supervisor')
  })
  it('nunca supervisado → jefe', () => {
    expect(nivelEscalamientoSupervision(null, 24, AHORA)).toBe('jefe_supervisores')
  })

  const objetivos = [
    { id: 'a', nombre: 'A', zona_id: 'z1', frecuencia_supervision_horas: 24, estado: 'activo' },
    { id: 'b', nombre: 'B', zona_id: 'z1', frecuencia_supervision_horas: 24, estado: 'activo' },
    { id: 'c', nombre: 'C', zona_id: 'z2', frecuencia_supervision_horas: 24, estado: 'activo' },
    { id: 'd', nombre: 'D', zona_id: 'z2', frecuencia_supervision_horas: 24, estado: 'activo' },
    { id: 'p', nombre: 'Prueba', zona_id: 'z2', frecuencia_supervision_horas: 24, estado: 'activo', es_prueba: true },
    { id: 'i', nombre: 'Inactivo', zona_id: 'z2', frecuencia_supervision_horas: 24, estado: 'inactivo' },
  ]
  const ultima = new Map([['a', hace(5)], ['b', hace(30)], ['c', hace(80)], ['p', hace(500)], ['i', hace(500)]])

  it('lista vencidos ordenados (jefe primero, más atrasado primero) y excluye prueba/inactivo', () => {
    const r = objetivosSinSupervision({ objetivos, ultimaPorObjetivo: ultima, contexto: CONTEXTO_EXIGIBILIDAD_VACIO, ahoraMs: AHORA })
    expect(r.map(x => x.objetivo_id)).toEqual(['d', 'c', 'b'])
    expect(r[0]).toMatchObject({ nivel: 'jefe_supervisores', motivo: 'nunca', horasDesdeUltima: null })
    expect(r[1]).toMatchObject({ nivel: 'jefe_supervisores', motivo: 'vencida' })
    expect(r[1].horasVencida).toBeCloseTo(56)
    expect(r[2]).toMatchObject({ nivel: 'supervisor' })
  })

  it('respeta la exigibilidad: sin turnos recientes no reclama', () => {
    const contexto = { fechasTurnos: new Map([['b', ['2026-11-20']], ['c', ['2026-11-20']]]), yaOperaron: new Set<string>(), suspensiones: [] }
    const r = objetivosSinSupervision({ objetivos, ultimaPorObjetivo: ultima, contexto, ahoraMs: AHORA })
    expect(r.map(x => x.objetivo_id).sort()).toEqual(['b', 'c'])
  })

  it('clave de dedup: una por objetivo y período (cambia con la nueva supervisión)', () => {
    expect(claveAvisoSupervision('jefe_supervisores', 'c', hace(80))).toBe(claveAvisoSupervision('jefe_supervisores', 'c', hace(80)))
    expect(claveAvisoSupervision('jefe_supervisores', 'c', hace(80))).not.toBe(claveAvisoSupervision('jefe_supervisores', 'c', hace(1)))
    expect(claveAvisoSupervision('jefe_supervisores', 'c', null)).toContain(':nunca')
    expect(claveAvisoSupervision('supervisor', 'c', null)).not.toBe(claveAvisoSupervision('jefe_supervisores', 'c', null))
  })

  it('arma avisos sólo de nivel jefe, deduplicados y sin caer a envío masivo', () => {
    const items = objetivosSinSupervision({ objetivos, ultimaPorObjetivo: ultima, contexto: CONTEXTO_EXIGIBILIDAD_VACIO, ahoraMs: AHORA })
    const duplicados = [...items, items[0]]
    const r = armarAvisosSupervisionJefe({ items: duplicados, jefes: ['j1', 'j1', 'j2'], yaEnviadas: new Set([items[1].claveDedup]) })
    expect(r.avisos).toHaveLength(1)
    expect(r.avisos[0]).toMatchObject({ objetivo_id: 'd', usuarios: ['j1', 'j2'] })
    expect(r.yaAvisados).toBe(1)
    const sinJefe = armarAvisosSupervisionJefe({ items, jefes: [], yaEnviadas: new Set() })
    expect(sinJefe.avisos).toHaveLength(0)
    expect(sinJefe.sinJefe).toBe(2)
  })

  it('jefes: sólo activos con rol jefe_supervisores', () => {
    expect(jefesDeEscalamiento([
      { usuario_id: 'j1', rol_en_escalamiento: 'jefe_supervisores', activo: true },
      { usuario_id: 'j2', rol_en_escalamiento: 'jefe_supervisores', activo: false },
      { usuario_id: 'o1', rol_en_escalamiento: 'operativo', activo: true },
    ])).toEqual(['j1'])
  })
})

describe('4.2 puestos sin cubrir', () => {
  const t = (over: Partial<TurnoProximo>): TurnoProximo => ({
    id: Math.random().toString(36).slice(2), objetivo_id: 'o1', puesto_id: 'p1',
    fecha: '2026-11-21', hora_inicio: '08:00:00', hora_fin: '20:00:00', estado: 'programado', guardia_id: null, ...over,
  })

  it('inicio en hora argentina', () => {
    expect(inicioTurnoMs('2026-11-21', '08:00:00')).toBe(Date.parse('2026-11-21T11:00:00Z'))
  })

  it('sólo turnos que empiezan en las próximas 48 h; ya empezados y anulados afuera', () => {
    const r = puestosSinCubrir({
      ahoraMs: AHORA,
      novedades: [],
      turnos: [
        t({ id: 'ya', fecha: '2026-11-20', hora_inicio: '08:00' }),      // ya empezó
        t({ id: 'h6', fecha: '2026-11-20', hora_inicio: '18:00' }),      // en 6 h
        t({ id: 'h30', fecha: '2026-11-21', hora_inicio: '18:00' }),     // en 30 h
        t({ id: 'lejos', fecha: '2026-11-23', hora_inicio: '08:00' }),   // en 68 h
        t({ id: 'anul', fecha: '2026-11-21', hora_inicio: '09:00', estado: 'anulado' }),
        t({ id: 'cub', fecha: '2026-11-21', hora_inicio: '10:00', guardia_id: 'g1' }),
      ],
    })
    expect(r.map(x => x.turnos_ids[0])).toEqual(['h6', 'h30'])
    expect(r[0].franja).toBe('menos_24h')
    expect(r[1].franja).toBe('24_48h')
    expect(r.every(x => x.motivo === 'sin_asignar')).toBe(true)
  })

  it('ausencia confirmada (aprobada) cuenta como sin cubrir; pendiente u «otra» no', () => {
    const novedades = [
      { empleado_id: 'g1', tipo: 'parte_medico', fecha_desde: '2026-11-20', fecha_hasta: '2026-11-22', estado: 'aprobada' },
      { empleado_id: 'g2', tipo: 'vacaciones', fecha_desde: '2026-11-21', fecha_hasta: '2026-11-21', estado: 'pendiente' },
      { empleado_id: 'g3', tipo: 'otra', fecha_desde: '2026-11-21', fecha_hasta: '2026-11-21', estado: 'aprobada' },
    ]
    expect(ausenciaConfirmada(novedades, 'g1', '2026-11-21')?.tipo).toBe('parte_medico')
    expect(ausenciaConfirmada(novedades, 'g2', '2026-11-21')).toBeNull()
    expect(ausenciaConfirmada(novedades, 'g3', '2026-11-21')).toBeNull()
    const r = puestosSinCubrir({
      ahoraMs: AHORA, novedades,
      turnos: [
        t({ id: 'a', guardia_id: 'g1', puesto_id: 'p1' }),
        t({ id: 'b', guardia_id: 'g2', puesto_id: 'p2' }),
        t({ id: 'c', guardia_id: 'g3', puesto_id: 'p3' }),
        t({ id: 'd', guardia_id: 'g4', puesto_id: 'p4', estado: 'descubierto' }),
      ],
    })
    expect(r.map(x => [x.turnos_ids[0], x.motivo, x.novedadTipo])).toEqual([
      ['a', 'ausencia_confirmada', 'parte_medico'],
      ['d', 'estado_descubierto', null],
    ])
  })

  it('deduplica: el mismo turno una vez; mismo horario se agrupa con cantidad; cubierto no esconde', () => {
    const r = puestosSinCubrir({
      ahoraMs: AHORA, novedades: [],
      turnos: [
        t({ id: 'x' }), t({ id: 'x' }),
        t({ id: 'y' }),
        t({ id: 'z', guardia_id: 'g1' }),
      ],
    })
    expect(r).toHaveLength(1)
    expect(r[0].cantidad).toBe(2)
    expect(r[0].turnos_ids).toEqual(['x', 'y'])
  })

  it('excluye objetivos indicados (prueba / inactivos)', () => {
    const r = puestosSinCubrir({ ahoraMs: AHORA, novedades: [], turnos: [t({ id: 'q', objetivo_id: 'prueba' })], objetivosExcluidos: new Set(['prueba']) })
    expect(r).toHaveLength(0)
  })
})

describe('4.3 rondas incompletas', () => {
  const ej = (over: Partial<EjecucionRonda> = {}): EjecucionRonda => ({
    id: 'e1', objetivo_id: 'o1', guardia_id: 'g1', fecha_operativa: '2026-11-20',
    iniciada_at: '2026-11-20T10:00:00Z', finalizada_at: '2026-11-20T10:30:00Z',
    estado: 'finalizada', resultado: 'incompleta', puntos_total: 3, ...over,
  })
  const pt = (over: Partial<PuntoEjecucion>): PuntoEjecucion => ({
    id: Math.random().toString(36).slice(2), ronda_ejecucion_id: 'e1', estado: 'cumplido',
    registrado_at: '2026-11-20T10:05:00Z', gps_ok: true, dentro_radio: true, foto_ok: null,
    snap_foto_requerida: false, precision_metros: 10, distancia_metros: 5, snap_radio_metros: 30, ...over,
  })

  it('GPS dudoso: mala precisión, sin GPS o círculo que toca el radio', () => {
    expect(puntoConGpsDudoso(pt({ precision_metros: 80, distancia_metros: 200 }))).toBe(true)
    expect(puntoConGpsDudoso(pt({ gps_ok: false }))).toBe(true)
    expect(puntoConGpsDudoso(pt({ precision_metros: 20, distancia_metros: 45, snap_radio_metros: 30 }))).toBe(true)
    expect(puntoConGpsDudoso(pt({ precision_metros: 8, distancia_metros: 300, snap_radio_metros: 30 }))).toBe(false)
  })

  it('evidencia pendiente gana sobre todo', () => {
    const c = clasificarRonda(ej(), [pt({}), pt({ estado: 'pendiente_validacion' }), pt({ estado: 'incumplido', precision_metros: 5, distancia_metros: 400 })], [])
    expect(c.sugerida).toBe('evidencia_pendiente')
    expect(clasificarRonda(ej({ resultado: 'pendiente_validacion' }), [pt({}), pt({}), pt({})], []).sugerida).toBe('evidencia_pendiente')
  })

  it('conectividad: errores de red del vigilador durante la ronda (o del punto)', () => {
    const malo = pt({ estado: 'incumplido', precision_metros: 5, distancia_metros: 400 })
    const durante = { user_id: 'g1', created_at: '2026-11-20T10:12:00Z' }
    const deOtro = { user_id: 'g9', created_at: '2026-11-20T10:12:00Z' }
    const fuera = { user_id: 'g1', created_at: '2026-11-20T14:00:00Z' }
    expect(clasificarRonda(ej(), [pt({}), pt({}), malo], [durante]).sugerida).toBe('conectividad')
    expect(clasificarRonda(ej(), [pt({}), pt({}), malo], [deOtro, fuera]).sugerida).toBe('incumplimiento')
    expect(clasificarRonda(ej(), [pt({}), pt({}), malo], [{ user_id: null, created_at: '2026-11-19T00:00:00Z', ejecucion_punto_id: malo.id }]).sugerida).toBe('conectividad')
  })

  it('error GPS cuando TODOS los incumplidos son dudosos; si no, incumplimiento', () => {
    const dudoso = pt({ estado: 'incumplido', precision_metros: 90, distancia_metros: 120 })
    const claro = pt({ estado: 'incumplido', precision_metros: 5, distancia_metros: 400 })
    expect(clasificarRonda(ej(), [pt({}), pt({}), dudoso], []).sugerida).toBe('error_gps')
    expect(clasificarRonda(ej(), [pt({}), dudoso, claro], []).sugerida).toBe('incumplimiento')
  })

  it('puntos faltantes sin red ni GPS → incumplimiento, con señales', () => {
    const c = clasificarRonda(ej({ puntos_total: 4 }), [pt({}), pt({})], [])
    expect(c.sugerida).toBe('incumplimiento')
    expect(c.senales).toMatchObject({ puntosTotal: 4, puntosRegistrados: 2, puntosFaltantes: 2 })
  })

  it('sólo finalizadas no completas piden revisión; resumen cuenta por clase', () => {
    expect(rondaRequiereRevision(ej({ resultado: 'completa' }))).toBe(false)
    expect(rondaRequiereRevision(ej({ estado: 'en_curso', resultado: null }))).toBe(false)
    expect(rondaRequiereRevision(ej())).toBe(true)
    const r = resumirClasificacion([
      clasificarRonda(ej(), [pt({ estado: 'pendiente_validacion' })], []),
      clasificarRonda(ej(), [pt({ estado: 'incumplido', precision_metros: 5, distancia_metros: 400 })], []),
    ])
    expect(r).toEqual({ evidencia_pendiente: 1, conectividad: 0, error_gps: 0, incumplimiento: 1 })
  })
})
