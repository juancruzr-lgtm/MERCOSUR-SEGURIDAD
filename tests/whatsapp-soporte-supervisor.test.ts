import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  LIMITES_SOPORTE, PLANTILLAS_SOPORTE, armarMensajesSoporte, modoSoporte, soporteSupervisorEnSeco, variableSegura,
} from '@/lib/whatsapp-soporte-supervisor'
import type { EntradaSoporte } from '@/lib/whatsapp-soporte-supervisor'
import type { HojaDeRuta, ItemHojaDeRuta } from '@/lib/hoja-de-ruta'

const item = (n: number, tipo: ItemHojaDeRuta['tipo'] = 'alerta_critica'): ItemHojaDeRuta => ({
  tipo, objetivo_id: `o${n}`, objetivo: `OBJ ${n}`, puntaje: 100 - n, motivo: `motivo ${n}`, ref: `r${n}`,
})
const hoja = (items: ItemHojaDeRuta[], responsable = true): HojaDeRuta => ({
  supervisorId: 'u1', responsableAhora: responsable, motivo: responsable ? 'ok' : 'sin_guardia_vigente',
  zonasResponsable: responsable ? ['z'] : [], items, paradas: [], fueraDeZona: 0,
})
const entrada = (items: ItemHojaDeRuta[], extra: Partial<EntradaSoporte> = {}): EntradaSoporte => ({
  hoja: hoja(items), supervisorNombre: 'Aranda, Sabino', zonaNombre: 'Rosario', guardiaId: '2026-10-07T07:00',
  horario: '07:00–19:00', ahora: new Date('2026-10-07T10:10:00Z'), ...extra,
})

describe('flag: deshabilitado por defecto y nunca envía', () => {
  it('sin flag no arma nada', () => {
    expect(modoSoporte({})).toBe('deshabilitado')
    expect(soporteSupervisorEnSeco(entrada([item(1)]), {})).toEqual({ modo: 'deshabilitado', enviados: 0, payloads: [] })
  })
  it('con flag dry-run arma payloads y enviados sigue en 0', () => {
    const r = soporteSupervisorEnSeco(entrada([item(1)]), { WHATSAPP_SOPORTE_SUPERVISOR: 'dry-run' })
    expect(r.modo).toBe('dry_run')
    expect(r.enviados).toBe(0)
    expect(r.payloads.length).toBeGreaterThan(0)
  })
  it('cualquier otro valor del flag (incluido "1") no lo activa', () => {
    expect(modoSoporte({ WHATSAPP_SOPORTE_SUPERVISOR: '1' })).toBe('deshabilitado')
    expect(modoSoporte({ WHATSAPP_SOPORTE_SUPERVISOR: 'enviar' })).toBe('deshabilitado')
  })
  it('el módulo no importa proveedor ni toca fichajes/horas/planillas', () => {
    const src = readFileSync('lib/whatsapp-soporte-supervisor.ts', 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/whatsapp'/)
    expect(src).not.toMatch(/proveedorPorDefecto|graph\.facebook|\.from\(|\.rpc\(|fetch\(/)
    expect(src).not.toMatch(/registros_asistencia|planilla_|horas_|turnos'/)
  })
})

describe('consolidación', () => {
  it('inicio de guardia: uno, con las 3 primeras prioridades y la cantidad total', () => {
    const p = armarMensajesSoporte(entrada([item(1), item(2), item(3), item(4, 'supervision_exigible')]))
    const ini = p.filter(x => x.tipo === 'inicio_guardia')
    expect(ini).toHaveLength(1)
    expect(ini[0].plantilla).toBe(PLANTILLAS_SOPORTE.inicio_guardia.nombre)
    expect(ini[0].variables).toHaveLength(PLANTILLAS_SOPORTE.inicio_guardia.variables.length)
    expect(ini[0].variables[3]).toBe('4')
    expect(ini[0].variables[4]).toContain('OBJ 3')
    expect(ini[0].variables[4]).not.toContain('OBJ 4')
    expect(armarMensajesSoporte(entrada([item(1)], { inicioEnviado: true })).some(x => x.tipo === 'inicio_guardia')).toBe(false)
  })
  it('incidentes: uno por hecho, sin repetir los ya avisados, tope por hora', () => {
    const items = [1, 2, 3, 4, 5, 6].map(n => item(n))
    const p = armarMensajesSoporte(entrada(items, { inicioEnviado: true, incidentesAvisados: new Set(['r1']) }))
    const inc = p.filter(x => x.tipo === 'incidente_critico')
    expect(inc).toHaveLength(LIMITES_SOPORTE.incidentesPorHora)
    expect(inc.map(x => x.clave)).not.toContain('wa|soporte_incidente_critico|r1|u1')
    expect(new Set(inc.map(x => x.clave)).size).toBe(inc.length)
  })
  it('lo que excede el tope va al resumen con el conteo de omitidos', () => {
    const items = [1, 2, 3, 4, 5, 6].map(n => item(n))
    const p = armarMensajesSoporte(entrada(items, { inicioEnviado: true, pedirResumen: true }))
    const res = p.find(x => x.tipo === 'resumen')!
    expect(res.variables[2]).toBe('2')
  })
  it('relevos: un solo mensaje consolidado', () => {
    const p = armarMensajesSoporte(entrada([item(1, 'relevo_pendiente'), item(2, 'relevo_pendiente')], { inicioEnviado: true }))
    expect(p.filter(x => x.tipo === 'pendientes_relevo')).toHaveLength(1)
    expect(p[0].variables[0]).toBe('2')
  })
  it('tope por guardia', () => {
    const items = [1, 2, 3, 4, 5, 6].map(n => item(n))
    const p = armarMensajesSoporte(entrada(items, { mensajesEnGuardia: LIMITES_SOPORTE.mensajesPorGuardia - 2 }))
    expect(p).toHaveLength(2)
  })
  it('supervisor que no está de guardia: nada', () => {
    expect(armarMensajesSoporte({ ...entrada([item(1)]), hoja: hoja([item(1)], false) })).toEqual([])
  })
  it('variables aptas para Meta (sin saltos de línea, acotadas)', () => {
    expect(variableSegura('a\nb\t\tc     d')).toBe('a · b · c d')
    expect(variableSegura('x'.repeat(500)).length).toBe(LIMITES_SOPORTE.largoVariable)
    expect(variableSegura('')).toBe('-')
  })
})
