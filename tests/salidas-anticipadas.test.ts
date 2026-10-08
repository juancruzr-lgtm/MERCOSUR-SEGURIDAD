import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  recalcularCapa4, evaluar, faltaPorAbandono, faltaPorInasistencia, faltaPorRondas,
  faltaPorSalidaAnticipada, salidaAnticipadaVigente, SALIDA_ANTICIPADA_VIGENTE_DESDE,
} from '@/lib/evaluacion-final'
import {
  MOTIVOS_POR_ESTADO, agruparPorPersona, confirmadasPorEmpleado, textoAnticipacion,
  type SalidaAnticipada,
} from '@/lib/salidas-anticipadas'
import { textoAvisoSalidaAnticipada } from '@/lib/salida-anticipada'

// Hora local fija, igual que en el teléfono del vigilador.
const a = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(2026, 9, 8, h, m, 0)
}

describe('vigencia de la regla', () => {
  it('rige desde septiembre de 2026 (orden definitiva de Gerencia) y sigue después', () => {
    expect(SALIDA_ANTICIPADA_VIGENTE_DESDE).toBe('2026-09')
    expect(salidaAnticipadaVigente('2026-09')).toBe(true)
    expect(salidaAnticipadaVigente('2026-10')).toBe(true)
    expect(salidaAnticipadaVigente('2027-03')).toBe(true)
  })

  it('no toca períodos anteriores', () => {
    expect(salidaAnticipadaVigente('2026-08')).toBe(false)
    expect(salidaAnticipadaVigente('basura')).toBe(false)
  })
})

describe('faltas críticas por salida', () => {
  it('sin confirmadas no hay falta: lo detectado no cuenta', () => {
    expect(faltaPorSalidaAnticipada(0)).toBeNull()
    expect(faltaPorAbandono(0)).toBeNull()
  })

  it('una salida injustificada confirmada alcanza para el tope 4', () => {
    const f = faltaPorSalidaAnticipada(1)!
    expect(f.tope).toBe(4)
    expect(f.clave).toBe('salida_anticipada_injustificada')
    expect(f.hecho).toMatch(/^1 salida anticipada injustificada confirmada/)
  })

  it('no escalona, pero dice cuántas', () => {
    expect(faltaPorSalidaAnticipada(21)!.tope).toBe(4)
    expect(faltaPorSalidaAnticipada(21)!.hecho).toMatch(/^21 salidas anticipadas injustificadas/)
  })

  it('el abandono comprobado topea en 2', () => {
    expect(faltaPorAbandono(1)!.tope).toBe(2)
    expect(faltaPorAbandono(1)!.clave).toBe('abandono_de_puesto')
  })

  it('con varios topes manda el más restrictivo, y un tope nunca sube una nota', () => {
    const conRondas = evaluar(100, [], {} as any, [
      faltaPorRondas(5, 10, 3), // 50 %, reincidente → 6
      faltaPorSalidaAnticipada(2),
    ])
    expect(conRondas.notaFinal).toBe(4)

    const conAbandono = evaluar(100, [], {} as any, [
      faltaPorInasistencia(1), faltaPorSalidaAnticipada(1), faltaPorAbandono(1),
    ])
    expect(conAbandono.notaFinal).toBe(2)

    const yaBaja = evaluar(50, [], {} as any, [faltaPorSalidaAnticipada(1)])
    expect(yaBaja.notaFinal).toBe(yaBaja.desempeno)
    expect(yaBaja.notaFinal).toBeLessThan(4)
  })
})

describe('recálculo de la evaluación por salidas confirmadas (misma cuenta que la base)', () => {
  // Fila real de MENA, septiembre 2026, tal como está publicada.
  const mena = { indice: 10, nota_final: 10, alcance: 'integral', cobertura: 100, faltas: [] }
  const conf = (injustificadas: number, abandonos = 0) => ({ injustificadas, abandonos })

  it('una salida confirmada con nota previa 10 → 4, Aplazado', () => {
    const c = recalcularCapa4(mena, conf(1))!
    expect(c.nota_final).toBe(4)
    expect(c.concepto).toBe('Aplazado')
    expect(c.explicacion).toBe('10 de desempeño · 4 final por 1 salida anticipada injustificada confirmada: '
      + 'retiro antes del horario de finalización del servicio, sin autorización')
  })

  it('MENA si se confirman 19: el texto dice incumplimiento reiterado', () => {
    const c = recalcularCapa4(mena, conf(19))!
    expect(c.nota_final).toBe(4)
    expect(c.explicacion).toBe(
      '10 de desempeño · 4 final por 19 salidas anticipadas injustificadas confirmadas: '
      + 'incumplimiento reiterado del horario de finalización del servicio, sin autorización')
  })

  it('abandono comprobado → 2, y manda sobre la salida injustificada', () => {
    const c = recalcularCapa4(mena, conf(3, 1))!
    expect(c.nota_final).toBe(2)
    expect(c.faltas.map(f => f.clave)).toEqual(['abandono_de_puesto', 'salida_anticipada_injustificada'])
  })

  it('conserva las faltas previas y pone primero la que decide la nota', () => {
    const conRondas = { ...mena, nota_final: 6, faltas: [{ clave: 'rondas_incumplidas', hecho: 'Realizó 5 de 10 rondas', tope: 6 }] }
    const c = recalcularCapa4(conRondas, conf(3))!
    expect(c.nota_final).toBe(4)
    expect(c.faltas.map(f => f.clave)).toEqual(['salida_anticipada_injustificada', 'rondas_incumplidas'])
  })

  it('deshacer la confirmación devuelve la nota que corresponde (sin inventar topes)', () => {
    const topeada = { ...mena, nota_final: 4, faltas: recalcularCapa4(mena, conf(19))!.faltas }
    const c = recalcularCapa4(topeada, conf(0))!
    expect(c.nota_final).toBe(10)
    expect(c.faltas).toEqual([])
    expect(c.explicacion).toBe('10 de desempeño')
    expect(c.concepto).toBe('Sobresaliente')
  })

  it('un tope nunca sube una nota que ya estaba por debajo', () => {
    expect(recalcularCapa4({ ...mena, indice: 3.5, nota_final: 3.5 }, conf(1))!.nota_final).toBe(3.5)
  })

  it('autorizada o error de registro (cero confirmadas) no cambia una nota sin topes', () => {
    const c = recalcularCapa4({ ...mena, indice: 8.88, nota_final: 8.88 }, conf(0))!
    expect(c.nota_final).toBe(8.88)
    expect(c.explicacion).toBe('8.88 de desempeño')
  })

  it('con cobertura parcial el concepto sigue siendo «Evaluación parcial»', () => {
    const c = recalcularCapa4({ ...mena, alcance: 'parcial', cobertura: 60 }, conf(1))!
    expect(c.concepto).toBe('Evaluación parcial')
    expect(c.explicacion).toMatch(/· Evaluación parcial: se pudo evaluar el 60 % de los requerimientos aplicables$/)
  })

  it('sin evaluación no hay nada que recalcular', () => {
    expect(recalcularCapa4({ ...mena, nota_final: null }, conf(1))).toBeNull()
  })

  it('evaluar ordena las faltas igual que el recálculo (recongelar no cambia el texto)', () => {
    const e = evaluar(100, [], {} as any, [faltaPorRondas(5, 10, 3), faltaPorSalidaAnticipada(2), faltaPorAbandono(1)])
    const r = recalcularCapa4({ indice: e.desempeno, nota_final: e.notaFinal, alcance: e.alcance, cobertura: e.cobertura.ajustada,
      faltas: [faltaPorRondas(5, 10, 3)] }, conf(2, 1))!
    expect(e.faltas.map(f => f.clave)).toEqual(r.faltas.map(f => f.clave))
  })
})

const salida = (p: Partial<SalidaAnticipada>): SalidaAnticipada => ({
  id: Math.random().toString(36).slice(2), registro_id: 'r', turno_id: 't', empleado_id: 'e1',
  empleado: 'MENA ROBERTO CARLOS', objetivo_id: 'o', objetivo: 'MUSEO MACRO', fecha: '2026-09-02',
  fin_programado: '2026-09-02T19:00:00', salida_registrada: '2026-09-02T18:55:00',
  segundos_antes: 300, minutos_antes: 5, estado: 'detectada', motivo_codigo: null, motivo: null,
  evidencia: null, resuelto_por: null, resuelto_por_nombre: null, resuelto_at: null,
  situacion_relevo: 'sin_relevo_programado', relevo: null, relevo_entrada: null,
  puede_resolver: true, puede_abandono: false, ...p,
})

describe('qué cuenta para la nota', () => {
  it('sólo injustificada y abandono; detectada, autorizada y descartada no', () => {
    const m = confirmadasPorEmpleado([
      salida({ estado: 'detectada' }), salida({ estado: 'autorizada' }),
      salida({ estado: 'descartada' }), salida({ estado: 'injustificada' }),
      salida({ estado: 'injustificada' }), salida({ estado: 'abandono' }),
      salida({ empleado_id: 'e2', estado: 'detectada' }),
    ])
    expect(m.get('e1')).toEqual({ injustificadas: 2, abandonos: 1 })
    expect(m.has('e2')).toBe(false)
  })

  it('agrupa por persona, primero quien tiene pendientes', () => {
    const g = agruparPorPersona([
      salida({ empleado_id: 'e2', empleado: 'B', estado: 'injustificada' }),
      salida({ empleado_id: 'e2', empleado: 'B', estado: 'injustificada' }),
      salida({ empleado_id: 'e1', empleado: 'A', estado: 'detectada' }),
    ])
    expect(g.map(x => x.empleadoId)).toEqual(['e1', 'e2'])
    expect(g[1].injustificadas).toBe(2)
  })

  it('la anticipación se dice en palabras, también la de segundos', () => {
    expect(textoAnticipacion(30)).toBe('menos de 1 min')
    expect(textoAnticipacion(300)).toBe('5 min')
    expect(textoAnticipacion(4320)).toBe('1 h 12 min')
  })
})

describe('aviso al registrar la salida', () => {
  const macro = { hora_inicio: '13:00', hora_fin: '19:00' }

  it('avisa aunque falte un minuto: la tolerancia no es un permiso', () => {
    const t = textoAvisoSalidaAnticipada(macro, a('18:59'))!
    expect(t).toMatch(/termina a las 19:00 y todavía faltan 1 min/)
    expect(t).toMatch(/Llegar antes no te autoriza a retirarte antes/)
  })

  it('el caso que motivó la regla: 18:45, quince minutos antes', () => {
    expect(textoAvisoSalidaAnticipada(macro, a('18:45'))).toMatch(/faltan 15 min/)
  })

  it('a horario o después no avisa nada', () => {
    expect(textoAvisoSalidaAnticipada(macro, a('19:00'))).toBeNull()
    expect(textoAvisoSalidaAnticipada(macro, a('19:20'))).toBeNull()
  })

  it('turno nocturno: 06:50 de un 19:00–07:00 faltan 10 minutos, no 24 horas', () => {
    expect(textoAvisoSalidaAnticipada({ hora_inicio: '19:00', hora_fin: '07:00' }, a('06:50')))
      .toMatch(/faltan 10 min/)
  })

  it('sin horario legible no molesta a nadie', () => {
    expect(textoAvisoSalidaAnticipada({ hora_inicio: '13:00', hora_fin: null }, a('18:00'))).toBeNull()
  })
})

describe('los motivos de la pantalla son los que acepta la base', () => {
  const sql = readFileSync(
    join(__dirname, '..', 'supabase', 'migrations', '20261008160000_salidas_anticipadas.sql'), 'utf8')

  it.each(Object.entries(MOTIVOS_POR_ESTADO))('estado %s', (estado, motivos) => {
    const linea = sql.split('\n').find(l => l.includes(`p_estado = '${estado}'`) && l.includes('p_motivo_codigo in'))
    expect(linea, `falta la validación de ${estado} en la migración`).toBeTruthy()
    const enBase = Array.from(linea!.matchAll(/'([a-z_]+)'/g)).map(m => m[1]).filter(c => c !== estado).sort()
    expect(motivos.map(m => m.codigo).sort()).toEqual(enBase)
  })
})
