/**
 * Evaluación mensual de vigiladores por supervisor (JC, 24/11/2026):
 * planilla R 6.2 (3), siete criterios de 1 a 10, puntaje = promedio, concepto
 * de la escala de la app; el supervisor ve sólo lo suyo y no bloquea nada.
 */
import React from 'react'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import {
  CRITERIOS, avance, conceptoPuntaje, criteriosDe, criteriosFaltantes, criteriosVacios,
  formatoPuntaje, nombrePeriodo, puntajeDe,
} from '@/lib/evaluacion-vigiladores'
import type { Criterios, EvaluacionVigilador, ListaDelMes } from '@/lib/evaluacion-vigiladores'
import {
  ListaEvaluacion, TarjetaEvaluacionVigiladores, VistaFormularioEvaluacion,
} from '@/components/supervisor/EvaluacionVigiladoresSupervisor'

const nada = () => {}

function todos(v: number): Criterios {
  return Object.fromEntries(CRITERIOS.map(c => [c.clave, v])) as Criterios
}

const evaluacion = (puntaje: number): EvaluacionVigilador => ({
  ...(todos(8) as Record<string, number>),
  id: 'e1', periodo: '2026-11', supervisor_id: 's1', vigilador_id: 'v2', puntaje,
  observaciones: null, plan_accion: null, origen: 'campana',
  created_at: '2026-11-24T12:00:00Z', updated_at: '2026-11-24T12:00:00Z',
} as EvaluacionVigilador)

const lista: ListaDelMes = {
  periodo: '2026-11',
  cierra: '2026-11-30',
  vigiladores: [
    { vigilador_id: 'v1', nombre: 'NICOLAS', apellido: 'TABORDA', legajo: '120', objetivo: 'LAROMET', evaluacion: null },
    { vigilador_id: 'v2', nombre: 'LEANDRO', apellido: 'VIVAS', legajo: '88', objetivo: 'CLUB', evaluacion: evaluacion(8.14) },
  ],
}

describe('criterios y puntaje', () => {
  it('son las siete columnas de la planilla, en su orden', () => {
    expect(CRITERIOS.map(c => c.planilla)).toEqual([
      'ASIS. Y PUNT.', 'PULCR.', 'DISPOC.', 'R. C/ EL OBJ.', 'R. C/ LOS SUP.', 'R. C/SUS COMP.', 'CONCEP.',
    ])
  })

  it('el puntaje es el promedio con dos decimales', () => {
    const c = { ...todos(8), disposicion: 7, relacion_supervisores: 7, concepto_general: 6 }
    expect(puntajeDe(c)).toBe(7.43)
    expect(puntajeDe(todos(10))).toBe(10)
  })

  it('sin los siete criterios no hay puntaje', () => {
    expect(puntajeDe({ ...todos(9), pulcritud: null })).toBeNull()
    expect(criteriosFaltantes(criteriosVacios())).toHaveLength(7)
  })

  it('fuera de 1 a 10 o con decimales no vale', () => {
    expect(criteriosFaltantes({ ...todos(5), pulcritud: 0 })).toEqual(['Pulcritud'])
    expect(criteriosFaltantes({ ...todos(5), disposicion: 11 })).toEqual(['Disposición'])
    expect(criteriosFaltantes({ ...todos(5), concepto_general: 7.5 })).toEqual(['Concepto general'])
  })

  it('el concepto sale de la misma escala que la nota mensual', () => {
    expect(conceptoPuntaje(7.43)).toBe('Bueno')
    expect(conceptoPuntaje(8.14)).toBe('Muy bueno')
    expect(conceptoPuntaje(6)).toBe('Aprobado')
    expect(conceptoPuntaje(10)).toBe('Sobresaliente')
  })

  it('formato con coma decimal', () => {
    expect(formatoPuntaje(7.43)).toBe('7,43')
    expect(formatoPuntaje(7.5)).toBe('7,5')
  })

  it('una evaluación guardada vuelve al formulario con sus valores', () => {
    expect(criteriosDe(evaluacion(8)).pulcritud).toBe(8)
    expect(criteriosDe(null).pulcritud).toBeNull()
  })

  it('nombre del mes y avance', () => {
    expect(nombrePeriodo('2026-11')).toBe('noviembre 2026')
    expect(avance(lista)).toEqual({ hechas: 1, total: 2, pendientes: 1 })
  })
})

describe('pantallas del supervisor', () => {
  it('la tarjeta insiste mientras falten y no tiene forma de esconderse', () => {
    const html = renderToStaticMarkup(<TarjetaEvaluacionVigiladores lista={lista} onAbrir={nada} />)
    expect(html).toContain('Te falta evaluar 1 vigilador de noviembre 2026')
    expect(html).toContain('1 de 2 hechas')
    expect(html).toContain('Evaluar')
    expect(html).not.toContain('Después')
    expect(html).not.toContain('role="dialog"')
  })

  it('completa: deja ver o corregir', () => {
    const completa = { ...lista, vigiladores: [lista.vigiladores[1]] }
    const html = renderToStaticMarkup(<TarjetaEvaluacionVigiladores lista={completa} onAbrir={nada} />)
    expect(html).toContain('completa')
    expect(html).toContain('Ver o corregir')
  })

  it('la lista muestra pendientes y hechas con su puntaje', () => {
    const html = renderToStaticMarkup(<ListaEvaluacion lista={lista} onElegir={nada} onCerrar={nada} />)
    expect(html).toContain('TABORDA, NICOLAS')
    expect(html).toContain('Evaluar ›')
    expect(html).toContain('8,14 Muy bueno')
    expect(html).toContain('Sólo ves tus evaluaciones')
  })

  it('el formulario tiene los siete criterios de 1 a 10, observaciones y plan de acción', () => {
    const html = renderToStaticMarkup(
      <VistaFormularioEvaluacion
        periodo="2026-11" vigilador={lista.vigiladores[0]} criterios={todos(7)}
        observaciones="" planAccion="" guardando={false} error={null}
        onCriterio={nada} onObservaciones={nada} onPlanAccion={nada} onGuardar={nada} onVolver={nada}
      />,
    )
    for (const c of CRITERIOS) expect(html).toContain(c.etiqueta + ': 10')
    expect(html).toContain('7 Bueno')
    expect(html).toContain('Observaciones')
    expect(html).toContain('Plan de acción / seguimiento')
    expect(html).toContain('Guardar evaluación')
  })
})

describe('migración', () => {
  const sql = readFileSync(
    join(__dirname, '..', 'supabase', 'migrations', '20261223120000_evaluacion_vigiladores_por_supervisor.sql'), 'utf8',
  )

  it('la tabla sólo se lee: sin insert, update ni delete para authenticated', () => {
    expect(sql).toMatch(/revoke all on public\.evaluaciones_vigilador_supervisor from anon, authenticated;/)
    expect(sql).toMatch(/grant select on public\.evaluaciones_vigilador_supervisor to authenticated;/)
    expect(sql).not.toMatch(/grant (insert|update|delete)/i)
  })

  it('el supervisor ve sólo lo suyo; Administración y Gerencia todo', () => {
    expect(sql).toMatch(/supervisor_id = auth\.uid\(\)\s+or public\.puede_gestionar_personal_actual\(\)\s+or public\.puede_acceder_gerencia_actual\(\)/)
  })

  it('guardar controla la zona y toma la identidad de la sesión', () => {
    expect(sql).toMatch(/evaluacion_vigiladores_de_zona\(v_uid\) z where z\.vigilador_id = p_vigilador_id/)
    expect(sql).toMatch(/Ese vigilador no esta en tu zona/)
  })

  it('el puntaje lo calcula la base y hay una por supervisor, vigilador y mes', () => {
    expect(sql).toMatch(/puntaje numeric\(4,2\) generated always as/)
    expect(sql).toMatch(/unique \(periodo, supervisor_id, vigilador_id\)/)
  })

  it('no usa select ... into (regla del editor de Supabase)', () => {
    expect(sql).not.toMatch(/select[^;]*\binto\s+v_/i)
  })
})
