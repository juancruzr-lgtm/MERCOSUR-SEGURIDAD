import { describe, expect, it } from 'vitest'
import { construirHojaDeRuta, hojaDeRutaHabilitada, puedeOperarObjetivo, zonasResponsableAhora } from '@/lib/hoja-de-ruta'
import type { EntradaHojaDeRuta } from '@/lib/hoja-de-ruta'

const ZR = { id: 'z-ros', nombre: 'Rosario' }
const ZF = { id: 'z-fun', nombre: 'Funes' }
const JL = 'u-jl', AR = 'u-ar', SM = 'u-sm', OTRO = 'u-otro'
const guardias = [
  { supervisor_id: JL, zona: 'Rosario', fecha: '2026-10-06', hora_inicio: '19:00', hora_fin: '07:00', estado: 'activo', tipo_evento: 'normal', rol_operativo: 'supervisor' },
  { supervisor_id: AR, zona: 'Rosario', fecha: '2026-10-07', hora_inicio: '07:00', hora_fin: '19:00', estado: 'activo', tipo_evento: 'normal', rol_operativo: 'supervisor' },
  { supervisor_id: SM, zona: 'Rosario', fecha: '2026-10-07', hora_inicio: '07:00', hora_fin: '19:00', estado: 'activo', tipo_evento: 'normal', rol_operativo: 'supervisor' },
  { supervisor_id: OTRO, zona: 'Funes', fecha: '2026-10-07', hora_inicio: '00:00', hora_fin: '23:59', estado: 'activo', tipo_evento: 'normal', rol_operativo: 'supervisor' },
]
const supervisorZonas = [
  { supervisor_id: JL, zona_id: 'z-ros' }, { supervisor_id: AR, zona_id: 'z-ros' },
  { supervisor_id: SM, zona_id: 'z-ros' }, { supervisor_id: OTRO, zona_id: 'z-fun' },
]
const objetivos = [
  { id: 'o-sk', nombre: 'SKATEPARK', zona_id: 'z-ros', estado: 'activo', frecuencia_supervision_horas: 24 },
  { id: 'o-ns', nombre: 'NACION SERVICIOS', zona_id: 'z-ros', estado: 'activo', frecuencia_supervision_horas: 24 },
  { id: 'o-fu', nombre: 'FUNES CLUB', zona_id: 'z-fun', estado: 'activo', frecuencia_supervision_horas: 24 },
]
// 06:30 AR del 07/10 = 09:30Z ; 07:10 AR = 10:10Z
const T_NOCHE = new Date('2026-10-07T09:30:00Z')
const T_DIA = new Date('2026-10-07T10:10:00Z')

const entrada = (supervisorId: string, ahora: Date, extra: Partial<EntradaHojaDeRuta> = {}): EntradaHojaDeRuta => ({
  supervisorId, alcance: 'zonas_asignadas', ahora, objetivos, zonas: [ZR, ZF], guardias, supervisorZonas,
  puestosDescubiertos: [{ turno_id: 't1', objetivo_id: 'o-ns', puesto: 'Principal', minutosDescubierto: 25 }],
  alertas: [
    { id: 'a1', objetivo_id: 'o-sk', tipo: 'no_iniciada', severidad: 'critica', detectada_at: '2026-10-07T09:00:00Z' },
    { id: 'a2', objetivo_id: 'o-fu', tipo: 'no_iniciada', severidad: 'critica', detectada_at: '2026-10-07T09:00:00Z' },
  ],
  ...extra,
})

describe('hoja de ruta: orden por riesgo', () => {
  it('puesto descubierto primero, después alerta crítica, después supervisión vencida', () => {
    const h = construirHojaDeRuta(entrada(JL, T_NOCHE, {
      ultimaSupervision: new Map([['o-sk', '2026-10-05T09:00:00Z'], ['o-ns', '2026-10-07T08:00:00Z']]),
      contextoExigibilidad: { fechasTurnos: null, yaOperaron: new Set(), suspensiones: [] },
      relevos: [{ objetivo_id: 'o-sk', turno_id: 't9', relevo_at: '2026-10-07T09:50:00Z', clase: 'hueco', minutos: 30 }],
    }))
    expect(h.motivo).toBe('ok')
    expect(h.items.map(i => i.tipo)).toEqual(['servicio_sin_cobertura', 'alerta_critica', 'relevo_pendiente', 'supervision_exigible'])
    expect(h.items[3]).toMatchObject({ objetivo: 'SKATEPARK', motivo: expect.stringContaining('vencida') })
    expect(h.paradas[0].objetivo).toBe('NACION SERVICIOS')
    expect(h.paradas[1]).toMatchObject({ objetivo: 'SKATEPARK' })
    expect(h.paradas[1].items).toHaveLength(3)
  })

  it('no crea ítems de supervisión si el objetivo no es exigible (suspendido)', () => {
    const h = construirHojaDeRuta(entrada(JL, T_NOCHE, {
      puestosDescubiertos: [], alertas: [],
      ultimaSupervision: new Map(),
      contextoExigibilidad: { fechasTurnos: null, yaOperaron: new Set(), suspensiones: [{ objetivo_id: 'o-sk', desde: '2026-10-01', hasta: null }] },
    }))
    expect(h.items.map(i => i.objetivo)).toEqual(['NACION SERVICIOS'])
    expect(h.items[0].motivo).toBe('Nunca supervisado')
  })

  it('alerta intervenida no aparece; seguimiento vencido vuelve', () => {
    const h = construirHojaDeRuta(entrada(JL, T_NOCHE, {
      puestosDescubiertos: [],
      alertas: [
        { id: 'a1', objetivo_id: 'o-sk', tipo: 'no_iniciada', severidad: 'critica', detectada_at: '2026-10-07T09:00:00Z', intervenida: true },
        { id: 'a3', objetivo_id: 'o-ns', tipo: 'no_iniciada', severidad: 'alta', detectada_at: '2026-10-07T08:00:00Z', intervenida: true, seguimiento_hasta: '2026-10-07T09:20:00Z' },
        { id: 'a4', objetivo_id: 'o-ns', tipo: 'x', severidad: 'alta', detectada_at: '2026-10-07T08:00:00Z', intervenida: true, seguimiento_hasta: '2026-10-07T11:00:00Z' },
      ],
    }))
    expect(h.items.map(i => i.ref)).toEqual(['a3'])
    expect(h.items[0].motivo).toMatch(/Seguimiento vencido/)
  })
})

describe('hoja de ruta con cambio de supervisor de guardia', () => {
  it('06:30 la tiene el nocturno; 07:10 pasa entera a los dos de día', () => {
    const noche = construirHojaDeRuta(entrada(JL, T_NOCHE))
    expect(noche.responsableAhora).toBe(true)
    expect(noche.items.map(i => i.ref)).toEqual(['t1', 'a1'])

    const salienteDespues = construirHojaDeRuta(entrada(JL, T_DIA))
    expect(salienteDespues).toMatchObject({ responsableAhora: false, motivo: 'sin_guardia_vigente', items: [] })

    for (const entrante of [AR, SM]) {
      const dia = construirHojaDeRuta(entrada(entrante, T_DIA))
      expect(dia.responsableAhora).toBe(true)
      expect(dia.items.map(i => i.ref)).toEqual(['t1', 'a1'])
    }
    // Antes del cambio, los de día no tienen hoja.
    expect(construirHojaDeRuta(entrada(AR, T_NOCHE)).motivo).toBe('sin_guardia_vigente')
  })

  it('zonasResponsableAhora usa la guardia efectiva del instante', () => {
    expect(zonasResponsableAhora({ supervisorId: JL, ahora: T_NOCHE, zonas: [ZR, ZF], guardias, supervisorZonas })).toEqual(['z-ros'])
    expect(zonasResponsableAhora({ supervisorId: JL, ahora: T_DIA, zonas: [ZR, ZF], guardias, supervisorZonas })).toEqual([])
  })
})

describe('supervisor intentando operar fuera de su zona', () => {
  it('lo de otra zona no entra a su hoja aunque esté en la entrada', () => {
    const h = construirHojaDeRuta(entrada(AR, T_DIA))
    expect(h.items.some(i => i.objetivo_id === 'o-fu')).toBe(false)
  })

  it('de guardia en una zona que no tiene asignada: no la ve (alcance zonas_asignadas)', () => {
    const g = [...guardias, { supervisor_id: AR, zona: 'Funes', fecha: '2026-10-07', hora_inicio: '07:00', hora_fin: '19:00', estado: 'activo', tipo_evento: 'normal', rol_operativo: 'supervisor' }]
    const h = construirHojaDeRuta({ ...entrada(AR, T_DIA), guardias: g })
    expect(h.zonasResponsable.sort()).toEqual(['z-fun', 'z-ros'])
    expect(h.items.some(i => i.objetivo_id === 'o-fu')).toBe(false)
    expect(h.fueraDeZona).toBe(1)
    // Con alcance 'todas' (jefe) sí.
    const j = construirHojaDeRuta({ ...entrada(AR, T_DIA), guardias: g, alcance: 'todas' })
    expect(j.items.some(i => i.objetivo_id === 'o-fu')).toBe(true)
  })

  it('puedeOperarObjetivo espeja alcanza_objetivo', () => {
    expect(puedeOperarObjetivo(AR, 'zonas_asignadas', { zona_id: 'z-ros' }, supervisorZonas)).toBe(true)
    expect(puedeOperarObjetivo(AR, 'zonas_asignadas', { zona_id: 'z-fun' }, supervisorZonas)).toBe(false)
    expect(puedeOperarObjetivo(AR, 'zonas_asignadas', { zona_id: null }, supervisorZonas)).toBe(false)
    expect(puedeOperarObjetivo(AR, 'propio', { zona_id: 'z-ros' }, supervisorZonas)).toBe(false)
    expect(puedeOperarObjetivo(AR, 'todas', { zona_id: 'z-fun' }, supervisorZonas)).toBe(true)
    expect(puedeOperarObjetivo(AR, 'zonas_asignadas', null, supervisorZonas)).toBe(false)
  })

  it('las mutaciones validan zona en el servidor (no depende de la hoja)', async () => {
    const { readFileSync } = await import('node:fs')
    expect(readFileSync('app/api/save-supervision/route.ts', 'utf8')).toContain("rpc('alcanza_objetivo'")
    expect(readFileSync('app/api/turnos/editar/route.ts', 'utf8')).toContain('Objetivo fuera de tu alcance')
    expect(readFileSync('app/api/rondas/evidencia/route.ts', 'utf8')).toContain("alcance === 'zonas_asignadas'")
  })
})

describe('feature flag', () => {
  it('apagado por defecto', () => {
    expect(hojaDeRutaHabilitada({})).toBe(false)
    expect(hojaDeRutaHabilitada({ NEXT_PUBLIC_HOJA_DE_RUTA: '1' })).toBe(true)
  })
})
