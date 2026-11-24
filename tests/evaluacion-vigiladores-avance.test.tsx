/**
 * Avance de la evaluación de vigiladores (JC, 24/11/2026): Administración y
 * Gerencia ven el avance por supervisor y por vigilador; Gerencia evalúa;
 * ningún supervisor ve lo de otro (tampoco Sergio con su acceso admin pleno).
 */
import React from 'react'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import { difiere, totalesAvance } from '@/lib/evaluacion-vigiladores'
import type { AvanceEvaluacion } from '@/lib/evaluacion-vigiladores'
import { VistaAvanceEvaluacion } from '@/components/desempeno/EvaluacionVigiladoresAvance'

const nada = () => {}

const crit = { asistencia_puntualidad: 8, pulcritud: 8, disposicion: 7, relacion_objetivo: 8,
  relacion_supervisores: 7, relacion_companeros: 8, concepto_general: 6 }

const avance: AvanceEvaluacion = {
  periodo: '2026-11',
  es_mes_actual: true,
  periodos: ['2026-11'],
  evaluadores: [
    {
      evaluador_id: 's1', nombre: 'Jose Luis', apellido: 'Martinez', es_gerencia: false, zonas: ['Rosario'],
      total: 48, hechas: 1, promedio: 7.43,
      evaluaciones: [{ vigilador_id: 'v1', nombre: 'NICOLAS', apellido: 'TABORDA', legajo: '120', puntaje: 7.43,
        ...crit, observaciones: 'Llega justo', plan_accion: null, origen: 'campana', updated_at: '2026-11-24T12:00:00Z' }],
      pendientes: [{ vigilador_id: 'v2', nombre: 'LEANDRO', apellido: 'VIVAS', legajo: '88', objetivo: 'CLUB' }],
    },
    {
      evaluador_id: 's2', nombre: 'SABINO', apellido: 'ARANDA', es_gerencia: false, zonas: ['Rosario'],
      total: 48, hechas: 0, promedio: null, evaluaciones: [], pendientes: [],
    },
    {
      evaluador_id: 'g1', nombre: 'juan cruz', apellido: 'romero', es_gerencia: true, zonas: [],
      total: 60, hechas: 0, promedio: null, evaluaciones: [], pendientes: [],
    },
  ],
  vigiladores: [
    { vigilador_id: 'v1', nombre: 'NICOLAS', apellido: 'TABORDA', legajo: '120', cantidad: 2, promedio: 6.5, minimo: 4, maximo: 9 },
    { vigilador_id: 'v3', nombre: 'ANA', apellido: 'GOMEZ', legajo: '7', cantidad: 2, promedio: 8, minimo: 7.5, maximo: 8.5 },
  ],
}

describe('avance: cálculos', () => {
  it('suma lo hecho y lo que falta de todos los evaluadores', () => {
    expect(totalesAvance(avance)).toEqual({ hechas: 1, total: 156 })
    expect(totalesAvance(null)).toEqual({ hechas: 0, total: 0 })
  })

  it('marca cuando los supervisores no coinciden (2 puntos o más)', () => {
    expect(difiere(avance.vigiladores[0])).toBe(true)
    expect(difiere(avance.vigiladores[1])).toBe(false)
    expect(difiere({ cantidad: 1, minimo: 2, maximo: 9 })).toBe(false)
  })
})

describe('avance: pantalla', () => {
  const html = renderToStaticMarkup(
    <VistaAvanceEvaluacion avance={avance} onPeriodo={nada} onActualizar={nada} abiertoInicial="s1" />,
  )

  it('muestra el total del mes y que sólo informa', () => {
    expect(html).toContain('Evaluación de vigiladores · noviembre 2026')
    expect(html).toContain('1 de 156 evaluaciones hechas')
    expect(html).toContain('no mueve la nota mensual')
  })

  it('por supervisor: avance, zona y nota que pone', () => {
    expect(html).toContain('Martinez, Jose Luis')
    expect(html).toContain('1 de 48')
    expect(html).toContain('Pone en promedio <strong>7,43</strong> Bueno')
    expect(html).toContain('ARANDA, SABINO')
    expect(html).toContain('Sin evaluaciones')
  })

  it('Gerencia va aparte y evalúa a todos', () => {
    expect(html).toContain('Gerencia · todos los vigiladores')
  })

  it('el detalle muestra criterios, observaciones y a quién le falta', () => {
    expect(html).toContain('ASIS. Y PUNT. 8')
    expect(html).toContain('CONCEP. 6')
    expect(html).toContain('Observaciones: Llega justo')
    expect(html).toContain('Le faltan (1)')
    expect(html).toContain('VIVAS, LEANDRO')
  })

  it('por vigilador: promedio y aviso cuando no coinciden', () => {
    expect(html).toContain('6,5 Aprobado')
    expect(html).toContain('4 – 9')
    expect(html).toContain('los supervisores no coinciden')
  })
})

describe('migración de avance', () => {
  const sql = readFileSync(
    join(__dirname, '..', 'supabase', 'migrations', '20261224120000_evaluacion_vigiladores_avance.sql'), 'utf8',
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
  })

  it('Gerencia evalúa a todos; anon no ve el avance', () => {
    expect(sql).toMatch(/gerencia\.si\s+or o\.zona_id in/)
    expect(sql).toMatch(/revoke all on function public\.evaluacion_vigiladores_avance\(text\) from public, anon;/)
  })

  it('no usa select ... into (regla del editor de Supabase)', () => {
    expect(sql).not.toMatch(/select[^;]*\binto\s+v_/i)
  })
})

// ── Administración evalúa cuando quiere (JC, 24/11/2026) ─────────────────────
import { TarjetaEvaluacionVigiladores } from '@/components/supervisor/EvaluacionVigiladoresSupervisor'

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

  it('en el avance va aparte y sin un total que cumplir', () => {
    const conAdm: AvanceEvaluacion = {
      ...avance,
      evaluadores: [...avance.evaluadores, {
        evaluador_id: 'a1', nombre: 'Laura', apellido: 'M', es_gerencia: false, es_administracion: true, zonas: [],
        total: 60, hechas: 3, promedio: 8, evaluaciones: [], pendientes: [],
      }],
    }
    const html = renderToStaticMarkup(<VistaAvanceEvaluacion avance={conAdm} onPeriodo={nada} onActualizar={nada} />)
    expect(html).toContain('Administración · evalúa cuando quiere')
    expect(html).toContain('3 evaluaciones')
    expect(html).not.toContain('3 de 60')
    expect(totalesAvance(conAdm)).toEqual({ hechas: 4, total: 159 })
  })

  const sql2 = readFileSync(
    join(__dirname, '..', 'supabase', 'migrations', '20261224130000_evaluacion_vigiladores_administracion.sql'), 'utf8',
  )
  it('migración: Administración evalúa a todos y su tarjeta es opcional', () => {
    expect(sql2).toMatch(/public\.evaluacion_es_gerencia\(p_supervisor_id\)\s+or public\.evaluacion_es_administracion\(p_supervisor_id\) as si/)
    expect(sql2).toMatch(/'opcional', public\.evaluacion_es_administracion\(v_uid\)/)
    expect(sql2).toMatch(/v_uid\s+uuid := public\.evaluacion_evaluador_actual\(\);/)
    expect(sql2).not.toMatch(/select[^;]*\binto\s+v_/i)
  })
})
