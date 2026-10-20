import { describe, expect, it } from 'vitest'
import {
  CABECERA_CONSULTA_ARCA, desdeGuardada, filaConsultaArca, generarConsultaArcaTxt, nombreArchivoConsulta, sugeridaParaVisual,
} from '@/lib/arca-txt-visual'
import { fechaDeArchivo, leerConsultaArca } from '@/lib/legajo-diferencias'

const eventual = {
  cuil: '20111111112', nombre: 'PEREZ JUAN', obra_social: 'O.S. DEL PERSONAL DE SEGURIDAD', modalidad: 'A Tiempo Completo - Contrato Eventual',
  inicio: '2026-09-01', fin: '2026-10-15', baja: null,
}

describe('archivo de ARCA para Visual', () => {
  it('cabecera y filas de 1020 caracteres, CRLF también al final', () => {
    const txt = generarConsultaArcaTxt([eventual, { ...eventual, cuil: '27222222223', nombre: 'GOMEZ ANA', fin: null, baja: 'RENUNCIA' }])
    expect(txt.endsWith('\r\n')).toBe(true)
    const lineas = txt.split('\r\n')
    expect(lineas.pop()).toBe('')
    expect(lineas).toHaveLength(3)
    for (const l of lineas) expect(l).toHaveLength(1020)
    expect(txt.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    expect(lineas[0]).toBe(CABECERA_CONSULTA_ARCA)
    expect(CABECERA_CONSULTA_ARCA.indexOf('FECHA INICIO')).toBe(714)
    expect(CABECERA_CONSULTA_ARCA.indexOf('TIPO SERVICIO')).toBe(960)
  })

  it('lo generado se vuelve a leer igual (ida y vuelta con la lectura de la app)', () => {
    const r = leerConsultaArca(generarConsultaArcaTxt([eventual, { ...eventual, cuil: '27222222223', nombre: 'GOMEZ ANA', fin: null, baja: 'RENUNCIA' }]))
    expect(r.error).toBeNull()
    expect(r.filas.map(({ linea, ...x }) => x)).toEqual([
      { cuil: '20111111112', nombre: 'PEREZ JUAN', modalidad: eventual.modalidad, inicio: '2026-09-01', fin: '2026-10-15', baja: null, obra_social: eventual.obra_social },
      { cuil: '27222222223', nombre: 'GOMEZ ANA', modalidad: eventual.modalidad, inicio: '2026-09-01', fin: null, baja: 'RENUNCIA', obra_social: eventual.obra_social },
    ])
    const fila = filaConsultaArca(eventual)
    expect(fila.slice(714, 727).trim()).toBe('01/09/2026')
    expect(fila.slice(727, 740).trim()).toBe('15/10/2026')
    expect(fila.slice(810)).toMatch(/^SEGURIDAD - UNION PERSONAL .*VIGILADORES EN GENERAL +SERVICIOS COMUNES CONTINUOS +$/)
  })

  it('la línea original de ARCA se devuelve tal cual (si es de esa persona y mide 1020)', () => {
    const original = filaConsultaArca(eventual).slice(0, 671) + 'MES'.padEnd(30, ' ') + filaConsultaArca(eventual).slice(701)
    expect(filaConsultaArca({ ...eventual, linea: original })).toBe(original)
    const leida = leerConsultaArca(CABECERA_CONSULTA_ARCA + '\r\n' + original + '\r\n').filas[0]
    expect(leida.linea).toBe(original)
    // De otra persona o recortada: se reconstruye con los datos.
    expect(filaConsultaArca({ ...eventual, cuil: '27222222223', linea: original }).slice(0, 11)).toBe('27222222223')
    expect(filaConsultaArca({ ...eventual, linea: original.trimEnd() })).toBe(filaConsultaArca(eventual))
  })

  it('desde lo guardado en la base y qué se marca de entrada', () => {
    const g = { cuil: eventual.cuil, apellido_nombre: 'PEREZ JUAN', obra_social: eventual.obra_social, modalidad: eventual.modalidad,
      fecha_inicio: '2026-09-01', fecha_fin: '2026-10-15', situacion_baja: null, linea_original: null, legajo_visual: null }
    expect(filaConsultaArca(desdeGuardada(g))).toBe(filaConsultaArca(eventual))
    expect(sugeridaParaVisual(g)).toBe(true)
    expect(sugeridaParaVisual({ ...g, legajo_visual: '0123' })).toBe(false)
    expect(sugeridaParaVisual({ ...g, legajo_visual: '  ' })).toBe(true)
    expect(sugeridaParaVisual({ ...g, modalidad: 'A Tiempo Completo Indeterminado' })).toBe(false)
  })

  it('nombre del archivo con la fecha como ARCA', () => {
    expect(nombreArchivoConsulta('2026-10-20')).toBe('ConsRelLab20102026_para_visual.txt')
    expect(fechaDeArchivo(nombreArchivoConsulta('2026-10-20'))).toBe('2026-10-20')
  })
})
