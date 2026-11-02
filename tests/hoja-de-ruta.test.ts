import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  LIMITE_TEXTO_WHATSAPP, construirMensajeHojaDeRuta, excedeLimite, instanteLocal, modoHojaDeRuta,
  turnosDeSupervisor, turnosTerminados, visitasDelTurno,
} from '@/lib/hoja-de-ruta'
import type { GuardiaSupervisor, VisitaSupervision } from '@/lib/hoja-de-ruta'

const ALDO = 'sup-aldo'
const SABINO = 'sup-sabino'
const OBJ: Record<string, string> = { srt: 'SRT', lotuf: 'Polideportivo Lotuf', laromet: 'LAROMET ROSARIO' }
const nombreObjetivo = (id: string) => OBJ[id] ?? id

const guardia = (p: Partial<GuardiaSupervisor> & { id: string }): GuardiaSupervisor => ({
  supervisor_id: SABINO, fecha: '2026-10-29', hora_inicio: '07:00:00', hora_fin: '19:00:00', estado: 'activo', tipo_evento: 'normal', ...p,
})
// created_at en UTC: 10:15Z = 07:15 en Argentina.
const visita = (id: string, objetivo: string, utc: string, obs: string | null, sup = SABINO): VisitaSupervision =>
  ({ id, objetivo_id: objetivo, supervisor_id: sup, created_at: utc, observaciones: obs })

describe('formato exacto de la hoja de ruta', () => {
  const [turno] = turnosDeSupervisor([guardia({ id: 'g1' })])

  it('encabezado + visitas en orden cronológico con la novedad textual completa', () => {
    const visitas = [
      visita('v2', 'lotuf', '2026-10-29T18:05:00Z', 'Sin novedad. Libro firmado.'),
      visita('v1', 'srt', '2026-10-29T10:15:00Z', 'Vigilador con uniforme incompleto: falta campera.\nSe le indicó regularizar.'),
    ]
    const m = construirMensajeHojaDeRuta({ turno, supervisorNombre: 'SABINO ARANDA', visitas, nombreObjetivo })
    expect(m).toBe([
      'HOJA DE RUTA',
      'Fecha: 29/10/2026',
      'Turno: 07:00 a 19:00',
      'Supervisor: SABINO ARANDA',
      '',
      '07:15 — SRT',
      'Vigilador con uniforme incompleto: falta campera.\nSe le indicó regularizar.',
      '',
      '15:05 — Polideportivo Lotuf',
      'Sin novedad. Libro firmado.',
    ].join('\n'))
  })

  it('la novedad no se resume ni se recorta, aunque sea larga o tenga espacios', () => {
    const larga = `  ${'Detalle de la novedad. '.repeat(40)}  `
    const m = construirMensajeHojaDeRuta({ turno, supervisorNombre: 'X', visitas: [visita('v', 'srt', '2026-10-29T12:00:00Z', larga)], nombreObjetivo })
    expect(m.endsWith(larga)).toBe(true)
  })

  it('sin indicadores, alertas, estadísticas ni pendientes: sólo las líneas del formato', () => {
    const m = construirMensajeHojaDeRuta({ turno, supervisorNombre: 'X', visitas: [visita('v', 'srt', '2026-10-29T12:00:00Z', 'ok')], nombreObjetivo })
    expect(m.split('\n')).toHaveLength(7)
    expect(m).not.toMatch(/alerta|pendiente|total|%|descubiert|ronda/i)
  })

  it('una visita sin novedad cargada lleva sólo la línea de hora y objetivo (no se inventa texto)', () => {
    const m = construirMensajeHojaDeRuta({ turno, supervisorNombre: 'X', visitas: [visita('v', 'srt', '2026-10-29T12:00:00Z', '   ')], nombreObjetivo })
    expect(m.split('\n').slice(-2)).toEqual(['', '09:00 — SRT'])
  })

  it('las visitas fuera del turno o de otro supervisor no entran', () => {
    const visitas = [
      visita('antes', 'srt', '2026-10-29T09:59:00Z', 'antes'),
      visita('otro', 'srt', '2026-10-29T12:00:00Z', 'de Aldo', ALDO),
      visita('ok', 'srt', '2026-10-29T12:00:00Z', 'dentro'),
      visita('despues', 'srt', '2026-10-29T22:01:00Z', 'después'),
    ]
    expect(visitasDelTurno(turno, visitas).map(v => v.id)).toEqual(['ok'])
  })

  it('las visitas fuera de las zonas del supervisor sí van: es su recorrido', () => {
    const m = construirMensajeHojaDeRuta({ turno, supervisorNombre: 'X', visitas: [visita('v', 'laromet', '2026-10-29T12:00:00Z', 'Apoyo a otra zona')], nombreObjetivo })
    expect(m).toContain('09:00 — LAROMET ROSARIO')
  })
})

describe('turnos del supervisor', () => {
  it('cambio de guardia: cada supervisor recibe su turno con sus propias visitas', () => {
    const turnos = turnosDeSupervisor([
      guardia({ id: 'g1', supervisor_id: SABINO, hora_inicio: '07:00', hora_fin: '19:00' }),
      guardia({ id: 'g2', supervisor_id: ALDO, hora_inicio: '19:00', hora_fin: '07:00' }),
    ])
    expect(turnos.map(t => [t.supervisorId, t.horaInicio, t.horaFin])).toEqual([[SABINO, '07:00', '19:00'], [ALDO, '19:00', '07:00']])
    const visitas = [visita('a', 'srt', '2026-10-29T21:30:00Z', 's'), visita('b', 'srt', '2026-10-29T23:30:00Z', 'a', ALDO)]
    expect(visitasDelTurno(turnos[0], visitas).map(v => v.id)).toEqual(['a'])
    expect(visitasDelTurno(turnos[1], visitas).map(v => v.id)).toEqual(['b'])
  })

  it('el turno nocturno termina al día siguiente y pertenece al día de inicio', () => {
    const [t] = turnosDeSupervisor([guardia({ id: 'n', hora_inicio: '19:00', hora_fin: '07:00' })])
    expect(t.fecha).toBe('2026-10-29')
    expect(t.desde.toISOString()).toBe('2026-10-29T22:00:00.000Z')
    expect(t.hasta.toISOString()).toBe('2026-10-30T10:00:00.000Z')
  })

  it('varias zonas en el mismo horario = un solo turno (un solo mensaje por destinatario)', () => {
    const t = turnosDeSupervisor([guardia({ id: 'z1' }), guardia({ id: 'z2' })])
    expect(t).toHaveLength(1)
    expect(t[0].guardiaIds).toEqual(['z1', 'z2'])
  })

  it('franco, ausencia o guardia inactiva no generan hoja', () => {
    expect(turnosDeSupervisor([
      guardia({ id: 'f', tipo_evento: 'franco' }), guardia({ id: 'a', tipo_evento: 'ausencia' }), guardia({ id: 'i', estado: 'inactivo' }),
    ])).toEqual([])
    expect(turnosDeSupervisor([guardia({ id: 'r', tipo_evento: 'reemplazo' })])).toHaveLength(1)
  })

  it('sólo turnos ya terminados y dentro de la ventana: nada viejo, nada en curso', () => {
    const turnos = turnosDeSupervisor([guardia({ id: 'g' })]) // termina 29/10 22:00Z
    expect(turnosTerminados(turnos, new Date('2026-10-29T21:59:00Z'))).toHaveLength(0)
    expect(turnosTerminados(turnos, new Date('2026-10-29T22:10:00Z'))).toHaveLength(1)
    expect(turnosTerminados(turnos, new Date('2026-10-30T04:01:00Z'), 6)).toHaveLength(0)
  })

  it('hora local de Argentina independiente de la zona del proceso', () => {
    expect(instanteLocal('2026-10-29', '00:30').toISOString()).toBe('2026-10-29T03:30:00.000Z')
  })
})

describe('límites, flag y separación de las alertas', () => {
  it('un mensaje que supera el límite de WhatsApp se marca, no se recorta', () => {
    const [turno] = turnosDeSupervisor([guardia({ id: 'g1' })])
    const visitas = Array.from({ length: 30 }, (_, i) => visita(`v${i}`, 'srt', `2026-10-29T1${i % 10}:00:00Z`, 'x'.repeat(200)))
    const m = construirMensajeHojaDeRuta({ turno, supervisorNombre: 'X', visitas, nombreObjetivo })
    expect(excedeLimite(m)).toBe(true)
    expect(Array.from(m).length).toBeGreaterThan(LIMITE_TEXTO_WHATSAPP)
    expect(m.split('x'.repeat(200)).length - 1).toBe(30)
  })

  it('el flag está apagado salvo valores exactos', () => {
    expect(modoHojaDeRuta(undefined)).toBe('apagado')
    expect(modoHojaDeRuta('1')).toBe('apagado')
    expect(modoHojaDeRuta('true')).toBe('apagado')
    expect(modoHojaDeRuta('dry-run')).toBe('dry-run')
    expect(modoHojaDeRuta('activo')).toBe('activo')
  })

  it('la ruta sólo envía con el flag activo y desde el cron, reclama antes de enviar y no toca las alertas', () => {
    const src = readFileSync('app/api/push/hoja-de-ruta/route.ts', 'utf8')
    expect(src).toMatch(/const enviar = modo === 'activo' && esCron/)
    expect(src.indexOf("rpc('reclamar_hoja_ruta_envio'")).toBeLessThan(src.indexOf('enviarTextoMeta(tel.e164'))
    expect(src).not.toMatch(/ronda_alertas|escalamiento_whatsapp_envios|reclamar_envio_whatsapp/)
  })
})
