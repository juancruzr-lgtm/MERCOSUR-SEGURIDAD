/**
 * Regresiones del cambio de mes (septiembre → octubre de 2026).
 *
 *  - `${mes}-31` producía '2026-09-31', que Postgres rechaza; el error se
 *    tragaba como "sin datos".
 *  - El mes y el día salían de UTC: a las 21:00 ART del último día ya era el
 *    mes siguiente.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  diasDelMes, esMesValido, fechaArgentina, inicioDiaArgentinaISO, mesAnterior, mesArgentina,
  mesSiguiente, mesesHastaActual, partirMes, rangoFechasMes, rangoInstantesDiaArgentina,
  rangoInstantesMesArgentina, sumarDias,
} from '@/lib/periodo-argentina'
import { mesPorDefecto, mesesDisponibles } from '@/lib/desempeno-datos'
import { limitesDelMesDesempeno } from '@/lib/bandeja-datos'
import { resumenClasificacionMes } from '@/lib/clasificacion-dia'

describe('rangoFechasMes: último día real, nunca el 31 inventado', () => {
  it.each([
    ['2026-02', '2026-02-01', '2026-02-28', '2026-03-01'],
    ['2028-02', '2028-02-01', '2028-02-29', '2028-03-01'], // bisiesto
    ['2026-04', '2026-04-01', '2026-04-30', '2026-05-01'],
    ['2026-09', '2026-09-01', '2026-09-30', '2026-10-01'],
    ['2026-10', '2026-10-01', '2026-10-31', '2026-11-01'],
    ['2026-11', '2026-11-01', '2026-11-30', '2026-12-01'],
    ['2026-12', '2026-12-01', '2026-12-31', '2027-01-01'], // diciembre → enero
  ])('%s', (mes, desde, ultimo, hastaExcl) => {
    const r = rangoFechasMes(mes)
    expect(r).toEqual({ desde, ultimoDia: ultimo, hastaExclusivo: hastaExcl })
    // El último día siempre es una fecha válida del calendario.
    expect(new Date(r.ultimoDia + 'T12:00:00Z').toISOString().slice(0, 10)).toBe(r.ultimoDia)
  })

  it('días del mes', () => {
    expect(diasDelMes('2026-09')).toBe(30)
    expect(diasDelMes('2026-02')).toBe(28)
    expect(diasDelMes('2028-02')).toBe(29)
    expect(diasDelMes('2026-12')).toBe(31)
  })

  it('mes siguiente / anterior cruzan el año', () => {
    expect(mesSiguiente('2026-12')).toBe('2027-01')
    expect(mesAnterior('2027-01')).toBe('2026-12')
    expect(mesAnterior('2026-10')).toBe('2026-09')
  })

  it('rechaza períodos inválidos en lugar de armar fechas falsas', () => {
    expect(() => partirMes('2026-13')).toThrow()
    expect(() => partirMes('2026-9')).toThrow()
    expect(() => rangoFechasMes('')).toThrow()
    expect(esMesValido('2026-09')).toBe(true)
    expect(esMesValido('2026-00')).toBe(false)
  })

  it('limitesDelMesDesempeno usa el mismo rango (septiembre termina el 30)', () => {
    expect(limitesDelMesDesempeno('2026-09')).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' })
    expect(limitesDelMesDesempeno('2026-02')).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' })
  })
})

describe('zona horaria Argentina', () => {
  it('la medianoche argentina es 03:00 UTC', () => {
    expect(inicioDiaArgentinaISO('2026-10-01')).toBe('2026-10-01T03:00:00.000Z')
    expect(inicioDiaArgentinaISO('2027-01-01')).toBe('2027-01-01T03:00:00.000Z')
  })

  it('rango de instantes del mes: [00:00 ART día 1, 00:00 ART mes siguiente)', () => {
    expect(rangoInstantesMesArgentina('2026-09')).toEqual({
      desde: '2026-09-01T03:00:00.000Z', hasta: '2026-10-01T03:00:00.000Z',
    })
    expect(rangoInstantesMesArgentina('2026-12')).toEqual({
      desde: '2026-12-01T03:00:00.000Z', hasta: '2027-01-01T03:00:00.000Z',
    })
    expect(rangoInstantesDiaArgentina('2026-09-30')).toEqual({
      desde: '2026-09-30T03:00:00.000Z', hasta: '2026-10-01T03:00:00.000Z',
    })
  })

  it('30/09 22:30 ART sigue siendo septiembre (en UTC ya es 01/10)', () => {
    const instante = '2026-10-01T01:30:00.000Z' // 30/09 22:30 ART
    expect(instante.slice(0, 7)).toBe('2026-10') // el error de antes
    expect(fechaArgentina(instante)).toBe('2026-09-30')
    expect(mesArgentina(instante)).toBe('2026-09')
  })

  it('01/10 00:00 ART ya es octubre', () => {
    expect(mesArgentina('2026-10-01T03:00:00.000Z')).toBe('2026-10')
    expect(mesArgentina('2026-10-01T02:59:59.999Z')).toBe('2026-09')
  })

  it('31/12 23:59 ART es diciembre; 01/01 00:00 ART es enero', () => {
    expect(mesArgentina('2027-01-01T02:59:00.000Z')).toBe('2026-12')
    expect(mesArgentina('2027-01-01T03:00:00.000Z')).toBe('2027-01')
  })

  it('mesPorDefecto toma el mes argentino, no el del reloj UTC', () => {
    expect(mesPorDefecto(new Date('2026-10-01T01:30:00.000Z'))).toBe('2026-09')
    expect(mesPorDefecto(new Date('2026-10-06T15:00:00.000Z'))).toBe('2026-10')
  })

  it('selector de meses: del actual (argentino) hacia atrás', () => {
    expect(mesesHastaActual('2026-08', new Date('2026-10-06T15:00:00Z'))).toEqual(['2026-10', '2026-09', '2026-08'])
    // 30/09 22:00 ART: todavía no aparece octubre.
    expect(mesesDisponibles('2026-08', new Date('2026-10-01T01:00:00Z'))).toEqual(['2026-09', '2026-08'])
    expect(mesesHastaActual('2026-11', new Date('2027-01-10T15:00:00Z'))).toEqual(['2027-01', '2026-12', '2026-11'])
  })

  it('sumarDias cruza meses y años', () => {
    expect(sumarDias('2026-09-30', 1)).toBe('2026-10-01')
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28')
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('resumenClasificacionMes en meses de 30 días', () => {
  it('una novedad que sigue en octubre se corta el 30/09', () => {
    const r = resumenClasificacionMes([
      { empleado_id: 'A', tipo: 'vacaciones', estado: 'aprobada', fecha_desde: '2026-09-28', fecha_hasta: '2026-10-05' } as any,
    ], 'A', '2026-09')
    expect(r.total).toBe(3) // 28, 29 y 30 — nunca un 31
  })
})

/**
 * Guardia estática: ningún archivo de código vuelve a armar el último día del
 * mes concatenando "-31" (ni "-30"/"-28") a un período.
 */
describe('no queda `${mes}-31` en el código', () => {
  const raiz = join(__dirname, '..')
  const carpetas = ['app', 'components', 'lib']
  const archivos: string[] = []
  const recorrer = (dir: string) => {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre)
      if (statSync(ruta).isDirectory()) recorrer(ruta)
      else if (/\.(ts|tsx)$/.test(nombre)) archivos.push(ruta)
    }
  }
  carpetas.forEach(c => recorrer(join(raiz, c)))

  it('sin interpolaciones de período terminadas en -28/-29/-30/-31', () => {
    // Variables de período (mes, mesCumplimiento, periodo…). Un tag como
    // `turno-${id}-30` no es una fecha y no entra.
    const patron = /\$\{[^}]*(mes|Mes|periodo|Periodo)[^}]*\}-(28|29|30|31)[`'"T]/
    const culpables = archivos.filter(a => {
      const texto = readFileSync(a, 'utf8')
        .split('\n')
        .filter(l => !/^\s*(\*|\/\/)/.test(l)) // comentarios que cuentan la historia
        .join('\n')
      return patron.test(texto)
    })
    expect(culpables).toEqual([])
  })
})
