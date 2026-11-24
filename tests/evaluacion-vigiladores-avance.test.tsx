/**
 * Avance de la evaluación de vigiladores (JC, 24/11/2026): Administración y
 * Gerencia ven la planilla completa, por vigilador (todas sus evaluaciones una
 * debajo de la otra) y por supervisor (a quiénes evaluó y a quiénes le faltan).
 * Ningún supervisor ve lo de otro.
 */
import React from 'react'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import { difiere, filasPlanilla, gruposPorVigilador, sinEvaluar, totalesAvance } from '@/lib/evaluacion-vigiladores'
import type { AvanceEvaluacion } from '@/lib/evaluacion-vigiladores'
import { VistaAvanceEvaluacion } from '@/components/desempeno/EvaluacionVigiladoresAvance'
import { TarjetaEvaluacionVigiladores } from '@/components/supervisor/EvaluacionVigiladoresSupervisor'

const nada = () => {}

const c = (a: number, b: number, d: number, e: number, f: number, g: number, h: number) => ({
  asistencia_puntualidad: a, pulcritud: b, disposicion: d, relacion_objetivo: e,
  relacion_supervisores: f, relacion_companeros: g, concepto_general: h,
})
const ev = (id: string, apellido: string, puntaje: number, crit: ReturnType<typeof c>, obs: string | null = null) => ({
  vigilador_id: id, nombre: 'X', apellido, legajo: id.toUpperCase(), puntaje, ...crit,
  observaciones: obs, plan_accion: null, origen: 'campana' as const, updated_at: '2026-11-24T12:00:00Z',
})

const avance: AvanceEvaluacion = {
  periodo: '2026-11',
  es_mes_actual: true,
  periodos: ['2026-11'],
  evaluadores: [
    {
      evaluador_id: 's1', nombre: 'Jose Luis', apellido: 'Martinez', es_gerencia: false, zonas: ['Rosario'],
      total: 3, hechas: 2, promedio: 6.36,
      evaluaciones: [
        ev('v1', 'TABORDA', 4.29, c(4, 4, 5, 4, 4, 5, 4), 'Llega tarde'),
        ev('v3', 'GOMEZ', 8.43, c(8, 9, 8, 8, 9, 8, 9)),
      ],
      pendientes: [{ vigilador_id: 'v2', nombre: 'X', apellido: 'VIVAS', legajo: 'V2', objetivo: 'CLUB' }],
    },
    {
      evaluador_id: 's2', nombre: 'SABINO', apellido: 'ARANDA', es_gerencia: false, zonas: ['Rosario'],
      total: 3, hechas: 1, promedio: 9,
      evaluaciones: [ev('v1', 'TABORDA', 9, c(9, 9, 9, 9, 9, 9, 9))],
      pendientes: [
        { vigilador_id: 'v2', nombre: 'X', apellido: 'VIVAS', legajo: 'V2', objetivo: 'CLUB' },
        { vigilador_id: 'v3', nombre: 'X', apellido: 'GOMEZ', legajo: 'V3', objetivo: 'LAROMET' },
      ],
    },
    {
      evaluador_id: 'g1', nombre: 'juan cruz', apellido: 'romero', es_gerencia: true, zonas: [],
      total: 60, hechas: 0, promedio: null, evaluaciones: [],
      pendientes: [{ vigilador_id: 'v9', nombre: 'X', apellido: 'OTRO', legajo: null, objetivo: null }],
    },
    {
      evaluador_id: 'a1', nombre: 'Laura', apellido: 'M', es_gerencia: false, es_administracion: true, zonas: [],
      total: 60, hechas: 1, promedio: 7, evaluaciones: [ev('v1', 'TABORDA', 7, c(7, 7, 7, 7, 7, 7, 7))], pendientes: [],
    },
  ],
  vigiladores: [],
}

describe('cálculos', () => {
  it('suma lo hecho; Administración no tiene un total que cumplir', () => {
    expect(totalesAvance(avance)).toEqual({ hechas: 4, total: 67 })
    expect(totalesAvance(null)).toEqual({ hechas: 0, total: 0 })
  })

  it('planilla: una fila por evaluación, ordenada por vigilador y evaluador', () => {
    const f = filasPlanilla(avance)
    expect(f).toHaveLength(4)
    expect(f.map(x => `${x.apellido}/${x.evaluador}`)).toEqual([
      'GOMEZ/Martinez, Jose Luis', 'TABORDA/ARANDA, SABINO', 'TABORDA/M, Laura', 'TABORDA/Martinez, Jose Luis',
    ])
    expect(f[2].rol_evaluador).toBe('Administración')
  })

  it('por vigilador: agrupa sus evaluaciones y calcula promedio, mínima y máxima', () => {
    const t = gruposPorVigilador(avance).find(g => g.vigilador_id === 'v1')!
    expect(t.evaluaciones).toHaveLength(3)
    expect(t.promedio).toBe(6.76)
    expect([t.minimo, t.maximo]).toEqual([4.29, 9])
    expect(difiere({ cantidad: 3, minimo: t.minimo, maximo: t.maximo })).toBe(true)
  })

  it('nadie los evaluó: pendientes de supervisores que nadie evaluó (no cuenta Gerencia)', () => {
    expect(sinEvaluar(avance).map(p => p.apellido)).toEqual(['VIVAS'])
  })
})

describe('pantalla', () => {
  const ver = (vista: 'planilla' | 'vigilador' | 'supervisor', abierto: string | null = null) => renderToStaticMarkup(
    <VistaAvanceEvaluacion avance={avance} onPeriodo={nada} onActualizar={nada} vistaInicial={vista} abiertoInicial={abierto} />,
  )

  it('arriba: total del mes, que sólo informa, y las tres vistas', () => {
    const html = ver('planilla')
    expect(html).toContain('Evaluación de vigiladores · noviembre 2026')
    expect(html).toContain('4 de 67 evaluaciones hechas')
    expect(html).toContain('no mueve la nota mensual')
    for (const t of ['Planilla (todas)', 'Por vigilador', 'Por supervisor']) expect(html).toContain(t)
  })

  it('planilla: vigilador, quién evaluó, las siete notas, puntaje y observaciones', () => {
    const html = ver('planilla')
    expect(html).toContain('Planilla · 4 evaluaciones')
    for (const col of ['ASIS. Y PUNT.', 'PULCR.', 'DISPOC.', 'R. C/ EL OBJ.', 'R. C/ LOS SUP.', 'R. C/SUS COMP.', 'CONCEP.', 'PUNTAJE']) {
      expect(html).toContain(col)
    }
    expect(html).toContain('ARANDA, SABINO')
    expect(html).toContain('4,29')
    expect(html).toContain('Llega tarde')
  })

  it('por vigilador: sus evaluaciones una debajo de la otra y quiénes faltan', () => {
    const html = ver('vigilador')
    expect(html).toContain('Por vigilador · 2 evaluados')
    expect(html).toContain('3 evaluaciones · promedio <strong>6,76</strong>')
    expect(html).toContain('Los evaluadores no coinciden (4,29 – 9)')
    expect(html).toContain('Todavía nadie los evaluó · 1')
    expect(html).toContain('VIVAS, X')
  })

  it('por supervisor: avance, a quiénes evaluó con sus notas y a quiénes le faltan', () => {
    const html = ver('supervisor', 's2')
    expect(html).toContain('Supervisores')
    expect(html).toContain('1 de 3 · le faltan 2')
    expect(html).toContain('Pone en promedio <strong>9</strong> Excelente')
    expect(html).toContain('Evaluó (1)')
    expect(html).toContain('Le faltan (2)')
    expect(html).toContain('LAROMET')
    expect(html).toContain('Gerencia · todos los vigiladores')
    expect(html).toContain('Administración · evalúa cuando quiere')
    expect(html).toContain('1 evaluación')
  })
})

describe('Administración evalúa a cualquiera, cuando quiere', () => {
  it('la tarjeta no insiste: invita', () => {
    const html = renderToStaticMarkup(
      <TarjetaEvaluacionVigiladores onAbrir={nada} lista={{
        periodo: '2026-11', cierra: '2026-11-30', opcional: true,
        vigiladores: [{ vigilador_id: 'v1', nombre: 'A', apellido: 'B', legajo: null, objetivo: null, evaluacion: null }],
      }} />,
    )
    expect(html).toContain('Evaluá a cualquier vigilador cuando quieras')
    expect(html).toContain('0 evaluaciones hechas en noviembre 2026')
    expect(html).not.toContain('Te falta')
  })
})

describe('migraciones', () => {
  const sql = readFileSync(
    join(__dirname, '..', 'supabase', 'migrations', '20261224120000_evaluacion_vigiladores_avance.sql'), 'utf8',
  )
  const sql2 = readFileSync(
    join(__dirname, '..', 'supabase', 'migrations', '20261224130000_evaluacion_vigiladores_administracion.sql'), 'utf8',
  )

  it('la identidad sale de usuarios.auth_user_id, no de auth.uid() directo', () => {
    expect(sql).toMatch(/where u\.auth_user_id = auth\.uid\(\) and u\.estado = 'activo'/)
    expect(sql).toMatch(/v_uid\s+uuid := public\.evaluacion_evaluador_actual\(\);/)
    expect(sql).not.toMatch(/v_uid\s+uuid := auth\.uid\(\)/)
  })

  it('ver todo es Administración o Gerencia, nunca un supervisor', () => {
    expect(sql).toMatch(/in \('supervisor', 'jefe_supervisores'\)/)
    expect(sql).toMatch(/supervisor_id = public\.evaluacion_evaluador_actual\(\)\s+or public\.evaluacion_ve_todo_actual\(\)/)
    expect(sql).toMatch(/if not public\.evaluacion_ve_todo_actual\(\) then/)
    expect(sql).toMatch(/revoke all on function public\.evaluacion_vigiladores_avance\(text\) from public, anon;/)
  })

  it('Administración evalúa a todos y su tarjeta es opcional', () => {
    expect(sql2).toMatch(/public\.evaluacion_es_gerencia\(p_supervisor_id\)\s+or public\.evaluacion_es_administracion\(p_supervisor_id\) as si/)
    expect(sql2).toMatch(/'opcional', public\.evaluacion_es_administracion\(v_uid\)/)
  })

  it('no usan select ... into (regla del editor de Supabase)', () => {
    expect(sql).not.toMatch(/select[^;]*\binto\s+v_/i)
    expect(sql2).not.toMatch(/select[^;]*\binto\s+v_/i)
  })
})
