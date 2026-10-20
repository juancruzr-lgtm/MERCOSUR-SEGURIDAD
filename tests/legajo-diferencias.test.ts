import { describe, expect, it } from 'vitest'
import {
  ORDEN_TIPOS, TEXTO_TIPO, detalleTexto, diasTexto, fechaCorta, fechaDeArchivo, leerConsultaArca, situacionTexto, unirRelaciones,
} from '@/lib/legajo-diferencias'
import type { TipoDiferencia } from '@/lib/legajo-diferencias'

// Mismo ancho fijo que la «Consulta de Relaciones Laborales» de ARCA (datos ficticios).
const COLS: [string, number][] = [
  ['CUIL', 12], ['APELLIDO Y NOMBRE', 60], ['OBRA SOCIAL', 160], ['MODAL. CONTRATO', 100], ['ACTIVIDAD LABORAL', 60], ['PUESTO DESEMP.', 255],
  ['RETRIB. PACTADA', 24], ['MOD. LIQ.', 30], ['TRAB. AGROP.', 13], ['FECHA INICIO', 13], ['FECHA DE FIN', 13], ['SITUACION De BAJA', 70],
  ['CONVENIO COLECTIVO', 70], ['CATEGORIA', 80], ['TIPO SERVICIO', 60],
]
const linea = (v: string[]) => COLS.map(([, w], i) => (v[i] ?? '').padEnd(w)).join('')
const CAB = linea(COLS.map(([c]) => c))
const fila = (cuil: string, nombre: string, modalidad: string, inicio: string, fin = '', baja = '') =>
  linea([cuil, nombre, 'O.S. FICTICIA', modalidad, 'SEGURIDAD', 'Vigilador', '', 'HORA', 'NO', inicio, fin, baja, 'CCT', 'VIGILADORES', 'COMUNES'])

describe('leerConsultaArca', () => {
  it('lee el ancho fijo: CUIL, nombre, modalidad, fechas y baja', () => {
    const txt = [CAB, fila('20111111112', 'PEREZ  JUAN', 'Trabajo eventual', '08/10/2026', '18/10/2026'),
      fila('20222222223', 'GOMEZ ANA', 'Nuevo período de prueba', '31/07/2026', '03/08/2026', 'Renuncia del trabajador'), ''].join('\r\n')
    const r = leerConsultaArca('﻿' + txt)
    expect(r.error).toBeNull()
    expect(r.filas.map(({ linea, ...x }) => x)).toEqual([
      { cuil: '20111111112', nombre: 'PEREZ JUAN', modalidad: 'Trabajo eventual', inicio: '2026-10-08', fin: '2026-10-18', baja: null, obra_social: 'O.S. FICTICIA' },
      { cuil: '20222222223', nombre: 'GOMEZ ANA', modalidad: 'Nuevo período de prueba', inicio: '2026-07-31', fin: '2026-08-03', baja: 'Renuncia del trabajador', obra_social: 'O.S. FICTICIA' },
    ])
  })
  it('fechas en formato argentino (día/mes)', () => {
    const r = leerConsultaArca([CAB, fila('20111111112', 'X', 'M', '01/11/2026')].join('\n'))
    expect(r.filas[0].inicio).toBe('2026-11-01')
  })
  it('rechaza archivos que no son de ARCA', () => {
    expect(leerConsultaArca('Legajo;CUIL;Nombre\n1;2;3').error).toMatch(/No es una Consulta/)
    expect(leerConsultaArca('').error).toMatch(/vacío/)
    expect(leerConsultaArca(CAB).error).toMatch(/no tiene relaciones/)
  })
  it('rechaza filas ilegibles en vez de cargarlas a medias', () => {
    expect(leerConsultaArca([CAB, fila('2011111', 'X', 'M', '08/10/2026')].join('\n')).error).toMatch(/Fila ilegible/)
    expect(leerConsultaArca([CAB, fila('20111111112', 'X', 'M', '2026-10-08')].join('\n')).error).toMatch(/Fila ilegible/)
  })
})

describe('fechaDeArchivo y unirRelaciones', () => {
  it('toma la fecha de la consulta del nombre del archivo', () => {
    expect(fechaDeArchivo('ConsRelLab13102026 (2).txt')).toBe('2026-10-13')
    expect(fechaDeArchivo('consrellab05102026.txt')).toBe('2026-10-05')
    expect(fechaDeArchivo('otro.txt')).toBeNull()
  })
  it('une varios archivos sin repetir relaciones', () => {
    const a = { cuil: '20111111112', nombre: 'A', modalidad: null, inicio: '2026-10-08', fin: null, baja: null, obra_social: null }
    const b = { ...a, cuil: '20222222223' }
    expect(unirRelaciones([[a, b], [a]])).toHaveLength(2)
    expect(unirRelaciones([[a], [{ ...a, inicio: '2020-01-01' }]])).toHaveLength(2)
  })
})

describe('textos', () => {
  it('todos los tipos tienen título, ayuda y orden', () => {
    const tipos = Object.keys(TEXTO_TIPO) as TipoDiferencia[]
    expect(new Set(ORDEN_TIPOS)).toEqual(new Set(tipos))
    for (const t of tipos) expect(TEXTO_TIPO[t].titulo && TEXTO_TIPO[t].ayuda).toBeTruthy()
  })
  it('días restantes', () => {
    expect(diasTexto(5)).toBe('faltan 5 días')
    expect(diasTexto(1)).toBe('faltan 1 día')
    expect(diasTexto(0)).toBe('vence hoy')
    expect(diasTexto(-2)).toBe('venció hace 2 días')
    expect(diasTexto(null)).toBe('')
  })
  it('fecha corta', () => {
    expect(fechaCorta('2026-10-18')).toBe('18/10/2026')
    expect(fechaCorta('2026-10-13T12:00:00+00:00')).toBe('13/10/2026')
    expect(fechaCorta(null)).toBe('—')
  })
  it('contrato con fin y situación en la app', () => {
    const d = { tipo: 'contrato_con_fin' as const, detalle: { modalidad: 'Trabajo eventual', inicio: '2026-10-08', fin: '2026-10-18', dias_restantes: 5, ultimo_fichaje: '2026-10-13T10:00:00Z', fichajes_mes: 6, proximo_turno: null } }
    expect(detalleTexto(d)).toBe('Trabajo eventual: inicio 08/10/2026, fin 18/10/2026 (faltan 5 días)')
    expect(situacionTexto(d)).toBe('último fichaje 13/10/2026 · 6 fichajes este mes · sin turnos programados')
  })
  it('activo sin relación: muestra la baja de una consulta anterior', () => {
    const d = { tipo: 'activo_sin_relacion' as const, detalle: { consulta: '2026-10-13', tiene_cuil: true, ultimo_fichaje: null, fichajes_mes: 0, proximo_turno: null,
      anterior: { consulta: '2026-10-05', inicio: '2026-07-31', fin: '2026-08-03', baja: 'Renuncia del trabajador' } } }
    expect(detalleTexto(d)).toBe('No figura en la consulta del 13/10/2026. Figuraba en la consulta del 05/10/2026 (inicio 31/07/2026, fin 03/08/2026, baja: Renuncia del trabajador).')
    expect(situacionTexto(d)).toMatch(/^nunca fichó/)
  })
  it('sin CUIL, identidad y DNI repetido', () => {
    expect(detalleTexto({ tipo: 'sin_cuil', detalle: { cuil_arca: '20111111112', nombre_arca: 'PEREZ JUAN' } })).toMatch(/CUIL 20111111112/)
    expect(detalleTexto({ tipo: 'sin_cuil', detalle: { cuil_arca: null } })).toMatch(/no trae/)
    expect(detalleTexto({ tipo: 'identidad_difiere', detalle: { nombre_difiere: true, nombre_app: 'JUAN PEREZ', nombre_arca: 'PEREZ JUAN', dni_con_formato: true, dni_app: '1.234' } }))
      .toBe('nombre en la app «JUAN PEREZ», en ARCA «PEREZ JUAN» · DNI cargado con signos («1.234»)')
    expect(detalleTexto({ tipo: 'dni_repetido', detalle: { dni: '1', otros: ['B, C'] } })).toBe('DNI 1, también en: B, C')
    expect(situacionTexto({ detalle: { dni: '1' } })).toBeNull()
  })
})
