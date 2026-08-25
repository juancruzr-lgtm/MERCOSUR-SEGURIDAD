import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { calcularDesempeno } from '@/lib/desempeno'
import type { JornadaDesempeno } from '@/lib/desempeno'

// Regresión sobre la forma real de agosto 2026: 65 períodos, 1.029 turnos.
//
// La fixture NO tiene identidades: sólo los contadores de cada período. Lo que
// se fija es que el módulo siga produciendo la distribución documentada en
// docs/diseno-indicadores-empleados.md (V2.1). Si un cambio la mueve, es
// deliberado o es un bug — pero no pasa desapercibido.

interface Periodo {
  id: string; turnos: number; cumplidos: number
  ausencias: number; sinEntrada: number; sinSalida: number
}

function leerPeriodos(): Periodo[] {
  return readFileSync(join(__dirname, 'fixtures-agosto-2026.csv'), 'utf8')
    .trim().split('\n')
    .filter(l => !l.startsWith('#'))
    .map(l => {
      const [id, turnos, cumplidos, ausencias, sinEntrada, sinSalida] = l.split(',')
      return {
        id,
        turnos: Number(turnos), cumplidos: Number(cumplidos),
        ausencias: Number(ausencias), sinEntrada: Number(sinEntrada),
        sinSalida: Number(sinSalida),
      }
    })
}

/** Reconstruye las jornadas de un período a partir de sus contadores. */
function jornadasDe(p: Periodo): JornadaDesempeno[] {
  const base = (o: Partial<JornadaDesempeno>, i: number): JornadaDesempeno => ({
    turnoId: `${p.id}-${i}`, tieneRegistro: true, esAusencia: false,
    entradaPropia: true, salidaPropia: true, ...o,
  })
  const conEvidencia = p.cumplidos + p.ausencias
  const huecos = p.turnos - conEvidencia
  const entradaSinSalida = p.sinSalida - p.sinEntrada
  const correctas = conEvidencia - p.ausencias - p.sinEntrada - entradaSinSalida

  const out: JornadaDesempeno[] = []
  let i = 0
  for (let k = 0; k < huecos; k++)
    out.push(base({ tieneRegistro: false, entradaPropia: false, salidaPropia: false }, i++))
  for (let k = 0; k < p.ausencias; k++)
    out.push(base({ esAusencia: true, entradaPropia: false, salidaPropia: false }, i++))
  for (let k = 0; k < p.sinEntrada; k++)
    out.push(base({ entradaPropia: false, salidaPropia: false, origenCobertura: 'confirmacion_supervisor' }, i++))
  for (let k = 0; k < entradaSinSalida; k++)
    out.push(base({ salidaPropia: false }, i++))
  for (let k = 0; k < correctas; k++) out.push(base({}, i++))
  return out
}

describe('agosto 2026 — la distribución documentada', () => {
  const resultados = leerPeriodos().map(p => ({ p, r: calcularDesempeno(jornadasDe(p)) }))

  it('son 65 períodos y 1.029 turnos exigibles', () => {
    expect(resultados).toHaveLength(65)
    expect(resultados.reduce((a, x) => a + x.p.turnos, 0)).toBe(1029)
  })

  it('la distribución es la de la V2.1', () => {
    const conteo: Record<string, number> = {}
    for (const { r } of resultados) conteo[r.estado] = (conteo[r.estado] ?? 0) + 1
    expect(conteo).toEqual({
      excelente: 31,
      correcto: 15,
      requiere_seguimiento: 5,
      requiere_intervencion: 4,
      datos_insuficientes: 10,
    })
  })

  it('nadie con muestra insuficiente recibe un número', () => {
    for (const { r } of resultados) {
      if (r.datosInsuficientes) expect(r.puntaje).toBeNull()
      else expect(r.puntaje).not.toBeNull()
    }
  })

  it('ninguna ausencia inventada: sólo hubo 1 en todo el mes', () => {
    expect(resultados.reduce((a, x) => a + x.r.ausencias, 0)).toBe(1)
  })

  it('los turnos sin evidencia no se convirtieron en faltas', () => {
    const sinEvidencia = resultados.reduce((a, x) => a + x.r.sinEvidencia, 0)
    expect(sinEvidencia).toBe(12)
    // Doce huecos y una sola ausencia: nunca se confundieron.
    expect(resultados.reduce((a, x) => a + x.r.ausencias, 0)).toBeLessThan(sinEvidencia)
  })

  it('el peor caso es el patrón de "no registra nada"', () => {
    const peor = resultados.filter(x => x.r.puntaje !== null)
      .sort((a, b) => a.r.puntaje! - b.r.puntaje!)[0].r
    expect(peor.puntaje).toBeCloseTo(3.86, 2)
    expect(peor.asistencia).toBe(10)
    expect(peor.incidencias.sin_registro_propio).toBe(18)
    expect(peor.incidencias.entrada_sin_salida).toBe(0)
    expect(peor.estado).toBe('requiere_intervencion')
  })

  it('existe el otro patrón: ficha la entrada y omite la salida', () => {
    const soloSalida = resultados
      .filter(x => x.r.incidencias.entrada_sin_salida >= 10 && x.r.incidencias.sin_registro_propio === 0)
    expect(soloSalida).toHaveLength(1)
    expect(soloSalida[0].r.puntaje).toBeCloseTo(5.66, 2)
    expect(soloSalida[0].r.asistencia).toBe(10)
  })

  it('las dos conductas se distinguen: no son el mismo problema', () => {
    const soloConfirmadas = resultados.filter(x =>
      x.r.incidencias.sin_registro_propio > 0 && x.r.incidencias.entrada_sin_salida === 0)
    const soloSinSalida = resultados.filter(x =>
      x.r.incidencias.entrada_sin_salida > 0 && x.r.incidencias.sin_registro_propio === 0)
    expect(soloConfirmadas.length).toBeGreaterThan(0)
    expect(soloSinSalida.length).toBeGreaterThan(0)
  })

  it('todo puntaje tiene motivos, y todo 10 no tiene ninguno', () => {
    for (const { r } of resultados) {
      if (r.puntaje === 10) expect(r.motivos).toEqual([])
      if (r.puntaje !== null && r.puntaje < 10) expect(r.motivos.length).toBeGreaterThan(0)
    }
  })
})
