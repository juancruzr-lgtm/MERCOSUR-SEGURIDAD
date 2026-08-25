import { describe, expect, it } from 'vitest'
import {
  MINUTOS_ANTES_DEL_CIERRE, finDeGuardia, responsablesQueCierran,
  zonasConGuardiaCargada,
} from '@/lib/cierre-aviso'

// El resumen de cierre sirve cuando llega al final de la guardia. Antes no hay
// nada que cerrar; después el supervisor ya se fue. Como cada uno termina a una
// hora distinta —y distinta cada día—, no hay horario fijo que sirva: el cron
// corre seguido y esto decide, en cada corrida, quién está por terminar.

const g = (over: Partial<any> = {}) => ({
  supervisor_id: 'u1', zona: 'Rosario', fecha: '2026-08-25',
  hora_inicio: '06:00', hora_fin: '18:00', estado: 'activo', tipo_evento: 'normal',
  ...over,
})

describe('fin de guardia', () => {
  it('una diurna termina el mismo día', () => {
    expect(finDeGuardia(g())).toBe(finDeGuardia(g({ hora_fin: '18:00' })))
  })

  it('una nocturna termina al día siguiente, no a la mañana del mismo', () => {
    const nocturna = finDeGuardia(g({ hora_inicio: '18:00', hora_fin: '06:00' }))!
    const diurna = finDeGuardia(g({ hora_inicio: '06:00', hora_fin: '18:00' }))!
    // 06:00 del día siguiente está DESPUÉS de las 18:00 del mismo día.
    expect(nocturna).toBeGreaterThan(diurna)
  })

  it('sin horario no hay fin: no se inventa uno', () => {
    expect(finDeGuardia(g({ hora_fin: null }))).toBeNull()
    expect(finDeGuardia(g({ fecha: null }))).toBeNull()
  })
})

describe('a quién le toca el aviso', () => {
  it('media hora antes de terminar, sí', () => {
    expect(responsablesQueCierran([g()], { fecha: '2026-08-25', hora: '17:35' })).toEqual(['u1'])
  })

  it('a mitad de la guardia, no: todavía no hay nada que cerrar', () => {
    expect(responsablesQueCierran([g()], { fecha: '2026-08-25', hora: '11:00' })).toEqual([])
  })

  it('justo cuando termina, sí', () => {
    expect(responsablesQueCierran([g()], { fecha: '2026-08-25', hora: '18:00' })).toEqual(['u1'])
  })

  it('una hora después de terminar ya no: se fue', () => {
    expect(responsablesQueCierran([g()], { fecha: '2026-08-25', hora: '19:00' })).toEqual([])
  })

  it('la tolerancia alcanza el fin que cayó entre dos corridas del cron', () => {
    // Termina 18:00, el cron corre 17:50 y 18:05. Sin tolerancia, nadie.
    expect(responsablesQueCierran([g()], { fecha: '2026-08-25', hora: '18:05' })).toEqual([])
    expect(responsablesQueCierran([g()], {
      fecha: '2026-08-25', hora: '18:05', tolerancia: 15,
    })).toEqual(['u1'])
  })

  it('la nocturna recibe en la madrugada del día siguiente', () => {
    const nocturna = g({ supervisor_id: 'u2', hora_inicio: '18:00', hora_fin: '06:00' })
    expect(responsablesQueCierran([nocturna], { fecha: '2026-08-26', hora: '05:40' })).toEqual(['u2'])
    // Y no a las 05:40 del día en que arrancó.
    expect(responsablesQueCierran([nocturna], { fecha: '2026-08-25', hora: '05:40' })).toEqual([])
  })

  it('un franco no es una guardia: no se le avisa a quien no está trabajando', () => {
    expect(responsablesQueCierran([g({ tipo_evento: 'franco' })], {
      fecha: '2026-08-25', hora: '17:35',
    })).toEqual([])
  })

  it('una fila inactiva tampoco', () => {
    expect(responsablesQueCierran([g({ estado: 'inactivo' })], {
      fecha: '2026-08-25', hora: '17:35',
    })).toEqual([])
  })

  it('si dos cierran a la vez, los dos', () => {
    const r = responsablesQueCierran(
      [g({ supervisor_id: 'a' }), g({ supervisor_id: 'b' })],
      { fecha: '2026-08-25', hora: '17:40' },
    )
    expect(r).toEqual(['a', 'b'])
  })

  it('el mismo supervisor con dos filas recibe una sola vez', () => {
    const r = responsablesQueCierran(
      [g(), g({ zona: 'Rafaela' })],
      { fecha: '2026-08-25', hora: '17:40' },
    )
    expect(r).toEqual(['u1'])
  })

  it('el rol no entra en esta decisión en ningún lado', () => {
    // La guardia manda. Un admin asignado cierra igual que cualquier otro.
    const r = responsablesQueCierran([g({ supervisor_id: 'admin-1' })], {
      fecha: '2026-08-25', hora: '17:35',
    })
    expect(r).toEqual(['admin-1'])
  })

  it('la anticipación por defecto es media hora', () => {
    expect(MINUTOS_ANTES_DEL_CIERRE).toBe(30)
  })
})

describe('zonas con guardia cargada', () => {
  it('lista las del día, normalizadas', () => {
    expect(zonasConGuardiaCargada([g(), g({ zona: 'ROSARIO' })], '2026-08-25')).toEqual(['rosario'])
  })

  it('una zona sin guardia no aparece: es lo que el cron no puede resolver', () => {
    // Un responsable único de zona no tiene fin de guardia en ningún lado.
    // Saber qué zonas quedan afuera permite decirlo en vez de inventar un horario.
    expect(zonasConGuardiaCargada([g()], '2026-08-25')).not.toContain('rafaela')
  })

  it('un franco no cubre la zona', () => {
    expect(zonasConGuardiaCargada([g({ tipo_evento: 'franco' })], '2026-08-25')).toEqual([])
  })
})
