import { describe, expect, it } from 'vitest'
import {
  decisionConflictos, describirConflicto, haySuperposicion, normalizarConflictos, normalizarConsultaConflictos,
} from '@/lib/conflictos-turno'
import { normalizarFilasAsignacion, resultadoAsignacionCelda } from '@/lib/asignacion-mensual'

// La detección vive en Postgres (conflictos_turno_vigilador_core) y está
// probada en tests/sql/programacion_conflictos.sql. Acá: lectura, redacción y
// la decisión de la grilla.

const crudo = (over: Record<string, unknown> = {}) => ({
  turno_id: 't-srt', tipo: 'continuidad_inmediata', gravedad: 'media', minutos_superpuestos: 0,
  objetivo: 'SRT', puesto: 'Principal', fecha: '2026-10-29', hora_inicio: '07:00', hora_fin: '15:00', ...over,
})
const nuevo = { vigilador: 'MARTÍNEZ, EDUARDO', objetivo: 'Polideportivo Lotuf', hora_inicio: '15:00', hora_fin: '23:00' }

describe('describirConflicto — los tres tipos con los datos que pide la operación', () => {
  it('caso Eduardo Martínez 29/10: continuidad inmediata en otro objetivo', () => {
    const [c] = normalizarConflictos([crudo()])
    const t = describirConflicto(c, nuevo)
    expect(t).toContain('MARTÍNEZ, EDUARDO')
    expect(t).toContain('07:00–15:00 en SRT (Principal) el 29/10')
    expect(t).toContain('15:00–23:00 en Polideportivo Lotuf')
    expect(t).toContain('inmediatamente después')
  })
  it('superposición: informa los minutos superpuestos', () => {
    const [c] = normalizarConflictos([crudo({ tipo: 'superposicion', minutos_superpuestos: 60 })])
    expect(describirConflicto(c, { ...nuevo, hora_inicio: '14:00', hora_fin: '22:00' })).toContain('se superpone 60 min')
  })
  it('doble turno en el día sin superposición', () => {
    const [c] = normalizarConflictos([crudo({ tipo: 'doble_turno_dia', hora_inicio: '07:00', hora_fin: '13:00' })])
    expect(describirConflicto(c, { ...nuevo, hora_inicio: '18:00', hora_fin: '23:00' })).toContain('ya tiene otro turno ese día')
  })
  it('descarta lo que no entiende', () => {
    expect(normalizarConflictos([{ tipo: 'otro' }, null, 3])).toEqual([])
    expect(normalizarConflictos(null)).toEqual([])
  })
})

describe('decisionConflictos — advertir sin prohibir los turnos dobles', () => {
  const cont = normalizarConflictos([crudo()])
  const sup = normalizarConflictos([crudo({ tipo: 'superposicion', minutos_superpuestos: 60 })])
  it('sin conflictos guarda directo', () => {
    expect(decisionConflictos([], { confirmado: false, motivo: '' }).puedeGuardar).toBe(true)
  })
  it('con conflicto exige confirmación expresa', () => {
    const d = decisionConflictos(cont, { confirmado: false, motivo: '' })
    expect(d).toMatchObject({ puedeGuardar: false, requiereConfirmacion: true })
  })
  it('confirmado sin motivo no alcanza', () => {
    expect(decisionConflictos(cont, { confirmado: true, motivo: 'ok' }).puedeGuardar).toBe(false)
  })
  it('supervisor confirma continuidad con motivo', () => {
    expect(decisionConflictos(cont, { confirmado: true, motivo: 'Pedido del cliente' }).puedeGuardar).toBe(true)
  })
  it('superposición: no la confirma nadie, ni con motivo (decisión de JC, 02/11/2026)', () => {
    expect(haySuperposicion(sup)).toBe(true)
    const sup1 = decisionConflictos(sup, { confirmado: true, motivo: 'Cubre hasta el relevo' })
    expect(sup1.puedeGuardar).toBe(false)
    expect(sup1.bloqueo).toMatch(/no puede tener dos turnos al mismo tiempo/)
    // Si además hay una continuidad, la superposición sigue mandando.
    expect(decisionConflictos([...cont, ...sup], { confirmado: true, motivo: 'Cubre hasta el relevo' }).puedeGuardar).toBe(false)
  })
})

describe('resultado de asignar_vigilador_turnos con confirmación pendiente', () => {
  it('no se toma como éxito y muestra el motivo del servidor', () => {
    const filas = normalizarFilasAsignacion([{
      turno_id: 't1', resultado: 'omitida', requiere_confirmacion: true,
      motivo: 'Requiere confirmacion: MARTINEZ, EDUARDO empieza inmediatamente despues de el turno de 07:00 a 15:00 en SRT.',
      conflicto: { objetivo: 'SRT', hora_inicio: '07:00', hora_fin: '15:00' }, conflictos: [crudo()],
    }])
    expect(filas[0].requiereConfirmacion).toBe(true)
    expect(filas[0].conflictos?.[0].tipo).toBe('continuidad_inmediata')
    const r = resultadoAsignacionCelda(filas)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/^Requiere confirmacion/)
  })
  it('la consulta de la grilla se normaliza completa', () => {
    const c = normalizarConsultaConflictos({ vigilador: 'X', fecha: '2026-10-29', objetivo: 'Lotuf', hora_inicio: '15:00:00',
      hora_fin: '23:00:00', conflictos: [crudo()], puede_confirmar_superposicion: true })
    expect(c?.hora_inicio).toBe('15:00')
    expect(c?.conflictos).toHaveLength(1)
  })
})
