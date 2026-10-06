/**
 * Saneamiento del cambio de mes (06/10/2026): Supervisiones en cero, Tablero de
 * Gerencia fijo en agosto, novedades laborales perdidas en meses de 30 días.
 */
import { describe, expect, it } from 'vitest'
import { cargarNovedadesAprobadasDelMes } from '@/lib/novedades-laborales-mes'
import {
  FILTRO_RESPUESTAS_OBSERVADAS, SELECT_SUPERVISION_DETALLE, cargarSupervisionesDelPeriodo,
  supervisionesDelDia, supervisionesDelPeriodo, unirPorId,
} from '@/lib/supervisiones-periodo'
import {
  ETIQUETA_PENDIENTE_PUBLICACION, estadoDelPeriodo, evolucionMensual, periodoPorDefecto, soloPublicadas,
} from '@/lib/gerencia'
import type { FilaPublicada } from '@/lib/mi-desempeno'

/** Cliente falso: registra los filtros y devuelve lo que se le indique. */
function clienteFalso(respuesta: { data?: any[]; error?: any } | ((filtros: any[]) => { data?: any[]; error?: any })) {
  const llamadas: any[][] = []
  const db = {
    from(tabla: string) {
      const filtros: any[] = [['from', tabla]]
      llamadas.push(filtros)
      const q: any = {}
      for (const m of ['select', 'eq', 'lte', 'gte', 'lt', 'order']) {
        q[m] = (...args: any[]) => { filtros.push([m, ...args]); return q }
      }
      q.range = (...args: any[]) => {
        filtros.push(['range', ...args])
        return Promise.resolve(typeof respuesta === 'function' ? respuesta(filtros) : respuesta)
      }
      q.then = (ok: any, ko: any) =>
        Promise.resolve(typeof respuesta === 'function' ? respuesta(filtros) : respuesta).then(ok, ko)
      return q
    },
  }
  return { db, llamadas }
}

describe('novedades laborales del mes', () => {
  it('septiembre filtra hasta el 30, no hasta un 31 inexistente', async () => {
    const { db, llamadas } = clienteFalso({ data: [] })
    await cargarNovedadesAprobadasDelMes(db, '2026-09')
    expect(llamadas[0]).toContainEqual(['lte', 'fecha_desde', '2026-09-30'])
    expect(llamadas[0]).toContainEqual(['gte', 'fecha_hasta', '2026-09-01'])
    expect(llamadas[0]).toContainEqual(['eq', 'estado', 'aprobada'])
  })

  it('febrero filtra hasta el 28', async () => {
    const { db, llamadas } = clienteFalso({ data: [] })
    await cargarNovedadesAprobadasDelMes(db, '2026-02', 'EMP')
    expect(llamadas[0]).toContainEqual(['lte', 'fecha_desde', '2026-02-28'])
    expect(llamadas[0]).toContainEqual(['eq', 'empleado_id', 'EMP'])
  })

  it('un error de la base NO se convierte en "no hay novedades"', async () => {
    const { db } = clienteFalso({ data: null as any, error: { message: 'date/time field value out of range: "2026-09-31"' } })
    const r = await cargarNovedadesAprobadasDelMes(db, '2026-09')
    expect(r.error).toMatch(/out of range/)
    expect(r.data).toEqual([])
  })

  it('un período inválido devuelve error, no una consulta con fechas falsas', async () => {
    const { db, llamadas } = clienteFalso({ data: [] })
    const r = await cargarNovedadesAprobadasDelMes(db, '2026-13')
    expect(r.error).toBeTruthy()
    expect(llamadas).toHaveLength(0)
  })
})

describe('Supervisiones por período (hora argentina)', () => {
  const s = (id: string, created_at: string) => ({ id, created_at })

  it('el corte de mes y de día es argentino', () => {
    const lista = [
      s('a', '2026-10-01T01:30:00Z'), // 30/09 22:30 ART → septiembre
      s('b', '2026-10-01T03:00:00Z'), // 01/10 00:00 ART → octubre
      s('c', '2026-10-06T11:00:00Z'), // 06/10 08:00 ART
    ]
    expect(supervisionesDelPeriodo(lista, '2026-09').map(x => x.id)).toEqual(['a'])
    expect(supervisionesDelPeriodo(lista, '2026-10').map(x => x.id)).toEqual(['b', 'c'])
    expect(supervisionesDelDia(lista, '2026-09-30').map(x => x.id)).toEqual(['a'])
    expect(supervisionesDelDia(lista, '2026-10-06').map(x => x.id)).toEqual(['c'])
  })

  it('unirPorId no duplica la misma supervisión', () => {
    expect(unirPorId([s('a', 'x'), s('b', 'y')], [s('b', 'y'), s('c', 'z')]).map(x => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('la consulta del período está acotada por fecha y filtra las respuestas a observado', async () => {
    const { db, llamadas } = clienteFalso({ data: [] })
    await cargarSupervisionesDelPeriodo(db, '2026-09')
    const f = llamadas[0]
    expect(f).toContainEqual(['select', SELECT_SUPERVISION_DETALLE])
    expect(f).toContainEqual(['eq', ...FILTRO_RESPUESTAS_OBSERVADAS])
    expect(f).toContainEqual(['gte', 'created_at', '2026-09-01T03:00:00.000Z'])
    expect(f).toContainEqual(['lt', 'created_at', '2026-10-01T03:00:00.000Z'])
  })

  it('un statement timeout se devuelve como error, no como lista vacía', async () => {
    const { db } = clienteFalso({ data: null as any, error: { code: '57014', message: 'canceling statement due to statement timeout' } })
    const r = await cargarSupervisionesDelPeriodo(db, '2026-10')
    expect(r.error).toMatch(/statement timeout/)
  })

  it('pagina más allá de 1000 filas', async () => {
    const mil = Array.from({ length: 1000 }, (_, i) => ({ id: String(i) }))
    const { db } = clienteFalso(f => {
      const r = f.find(x => x[0] === 'range')
      return { data: r[1] === 0 ? mil : [{ id: 'ultima' }] }
    })
    const r = await cargarSupervisionesDelPeriodo(db, '2026-09')
    expect(r.data).toHaveLength(1001)
  })
})

describe('Tablero de Gerencia: período y estado de publicación', () => {
  const fila = (periodo: string, estado: string): FilaPublicada => ({
    empleado_id: Math.random().toString(36).slice(2), periodo, estado,
    cumplimiento_ponderado: 90, indice: 8, nota_final: 8, concepto: 'Muy bueno',
    datos_insuficientes: false, cobertura: 100, alcance: 'integral', estado_desempeno: null,
    dimensiones: [], faltas: [], explicacion: null, balance: null, contexto: null,
  })
  // Producción al 06/10/2026: agosto publicado, septiembre sólo calculado.
  const hoy = [fila('2026-08', 'publicada'), fila('2026-08', 'publicada'), fila('2026-09', 'calculada'), fila('2026-09', 'calculada')]

  it('por defecto abre en el último PUBLICADO, no en un mes fijo', () => {
    expect(periodoPorDefecto(hoy)).toBe('2026-08')
  })

  it('cuando se publica septiembre pasa solo a septiembre', () => {
    const despues = hoy.map(f => f.periodo === '2026-09' ? { ...f, estado: 'publicada' } : f)
    expect(periodoPorDefecto(despues)).toBe('2026-09')
  })

  it('una evaluación calculada nunca se rotula como publicada', () => {
    expect(estadoDelPeriodo(hoy, '2026-08')).toBe('publicada')
    expect(estadoDelPeriodo(hoy, '2026-09')).toBe('pendiente')
    expect(estadoDelPeriodo([fila('2026-09', 'publicada'), fila('2026-09', 'calculada')], '2026-09')).toBe('parcial')
    expect(estadoDelPeriodo(hoy, '2026-10')).toBe('sin_datos')
    expect(ETIQUETA_PENDIENTE_PUBLICACION).toBe('Calculada — pendiente de publicación')
  })

  it('la evolución mensual sólo cuenta meses publicados', () => {
    expect(evolucionMensual(soloPublicadas(hoy)).map(p => p.periodo)).toEqual(['2026-08'])
  })

  it('sin nada publicado cae en el último calculado (rotulado pendiente)', () => {
    expect(periodoPorDefecto([fila('2026-09', 'calculada')])).toBe('2026-09')
    expect(periodoPorDefecto([])).toBeNull()
  })
})
