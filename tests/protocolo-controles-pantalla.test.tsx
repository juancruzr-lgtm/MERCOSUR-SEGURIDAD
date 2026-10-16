/**
 * «Qué controla el supervisor en la visita»: cada punto se muestra con la
 * frase del protocolo de donde sale y tres acciones; sin clasificaciones ni
 * pasos de validación. Sólo puntos del checklist del supervisor.
 */
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import { Punto, separarPuntos, versionDeTrabajo } from '@/components/protocolos/ControlesProtocoloPanel'
import type { ControlPropuesto, InstruccionPanel, VersionControles } from '@/lib/protocolo-controles'

const ejecutar = async () => true
const ins: InstruccionPanel = {
  id: 'i1', orden: 2, inicio: 0, fin: 10, texto: 'Registrar al personal externo en el libro de novedades', coincide: true,
  clasificacion_ia: 'obligacion', quien_ia: 'vigilador', cuando_ia: null,
  clasificacion: null, quien: null, cuando: null, validada_at: null, validada_por_nombre: null,
}
const ctl = (over: Partial<ControlPropuesto> = {}): ControlPropuesto => ({
  id: 'c1', instruccion_id: 'i1', version_id: 'v1', origen: 'ia', destino: 'checklist_supervision',
  texto_original: 'Libro con datos de personal externo', texto_item: 'Libro con datos de personal externo',
  criticidad: 'normal', foto_obligatoria: false, quien: null, cuando: null, motivo: null,
  existente_tipo: null, existente_id: null, existente_texto: null, estado: 'propuesto',
  aprobado_at: null, aprobado_por_nombre: null, rechazado_at: null, motivo_rechazo: null,
  activado_at: null, activado_por_nombre: null, checklist_item_id: null, creado_at: '2026-10-16T10:00:00Z', ...over,
})
const deshabilitado = (html: string, texto: string) => new RegExp(`<button[^>]*disabled[^>]*>${texto}</button>`).test(html)

describe('punto propuesto', () => {
  it('muestra el punto, la frase del protocolo y las tres acciones; nada de clasificar o validar', () => {
    const html = renderToStaticMarkup(<Punto c={ctl()} ins={ins} puede ocupado={false} ejecutar={ejecutar} />)
    expect(html).toContain('Libro con datos de personal externo')
    expect(html).toContain('Del protocolo: «Registrar al personal externo en el libro de novedades»')
    expect(html).toContain('Agregar al checklist')
    expect(html).toContain('Corregir')
    expect(html).toContain('Descartar')
    expect(deshabilitado(html, 'Agregar al checklist')).toBe(false)
    expect(html).not.toMatch(/Validar|Informativa|Obligación|Aprobar|Activar/)
  })

  it('si ya está en el checklist, lo dice y no deja agregarlo', () => {
    const html = renderToStaticMarkup(<Punto c={ctl({ existente_tipo: 'checklist_item', existente_id: 'x', existente_texto: 'libro de actas' })} ins={ins} puede ocupado={false} ejecutar={ejecutar} />)
    expect(html).toContain('Ya está en el checklist: «libro de actas»')
    expect(deshabilitado(html, 'Agregar al checklist')).toBe(true)
  })

  it('sin permiso (supervisor de la zona): ve el punto sin botones', () => {
    const html = renderToStaticMarkup(<Punto c={ctl()} ins={ins} puede={false} ocupado={false} ejecutar={ejecutar} />)
    expect(html).toContain('Libro con datos de personal externo')
    expect(html).not.toContain('Agregar al checklist')
    expect(html).not.toContain('Descartar')
  })
})

describe('qué se muestra', () => {
  const v = (over: Partial<VersionControles>): VersionControles => ({
    id: 'v', numero: 1, titulo: 't', estado: 'vigente', puesto_id: null, puesto_nombre: null, instrucciones: [], ...over,
  })
  it('trabaja sobre la versión que rige para todo el objetivo', () => {
    expect(versionDeTrabajo([v({ id: 'p', puesto_id: 'x' }), v({ id: 'g' }), v({ id: 'b', estado: 'borrador' })])?.id).toBe('g')
    expect(versionDeTrabajo([v({ id: 'b', estado: 'borrador' })])).toBeNull()
  })
  it('sólo puntos del checklist del supervisor; los descartados no aparecen', () => {
    const r = separarPuntos([
      ctl({ id: 'a' }),
      ctl({ id: 'b', destino: 'tarea_turno' }),
      ctl({ id: 'c', estado: 'rechazado' }),
      ctl({ id: 'd', estado: 'activado' }),
      ctl({ id: 'e', version_id: 'otra' }),
    ], 'v1')
    expect(r.paraRevisar.map(c => c.id)).toEqual(['a'])
    expect(r.agregados.map(c => c.id)).toEqual(['d'])
  })
})
