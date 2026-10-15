/**
 * La sección «Checklist desde el protocolo» no deja aprobar ni activar fuera
 * de las reglas: aprobar exige la clasificación validada, un duplicado no se
 * aprueba, y nada se activa desde una versión que no está vigente.
 */
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import { Activacion, Instruccion, Version } from '@/components/protocolos/ControlesProtocoloPanel'
import { controlesPorInstruccion, type ControlPropuesto, type InstruccionPanel, type PanelControles, type VersionControles } from '@/lib/protocolo-controles'

const ejecutar = async () => true
const ins = (over: Partial<InstruccionPanel> = {}): InstruccionPanel => ({
  id: 'i1', orden: 2, inicio: 0, fin: 10, texto: 'Registrar al personal externo en el libro de novedades', coincide: true,
  clasificacion_ia: 'obligacion', quien_ia: 'vigilador', cuando_ia: null,
  clasificacion: null, quien: null, cuando: null, validada_at: null, validada_por_nombre: null, ...over,
})
const ctl = (over: Partial<ControlPropuesto> = {}): ControlPropuesto => ({
  id: 'c1', instruccion_id: 'i1', version_id: 'v1', origen: 'ia', destino: 'checklist_supervision',
  texto_original: 'Libro con datos de personal externo', texto_item: 'Libro con datos de personal externo',
  criticidad: 'normal', foto_obligatoria: false, quien: null, cuando: null, motivo: 'Se revisa en el libro',
  existente_tipo: null, existente_id: null, existente_texto: null, estado: 'propuesto',
  aprobado_at: null, aprobado_por_nombre: null, rechazado_at: null, motivo_rechazo: null,
  activado_at: null, activado_por_nombre: null, checklist_item_id: null, creado_at: '2026-10-15T10:00:00Z', ...over,
})
const version = (over: Partial<VersionControles> = {}): VersionControles => ({
  id: 'v1', numero: 1, titulo: 'RANDSTAD', estado: 'borrador', puesto_id: null, puesto_nombre: null, instrucciones: [ins()], ...over,
})
const panel = (over: Partial<PanelControles> = {}): PanelControles => ({
  objetivo_id: 'o1', permisos: { preparar: true, activar: true },
  plantilla: { id: 'p1', nombre: 'supervision simple', propia: false, items: [] },
  versiones: [version()], controles: [ctl()], corridas: [], ...over,
})
const deshabilitado = (html: string, texto: string) => new RegExp(`<button[^>]*disabled[^>]*>${texto}</button>`).test(html)

describe('instrucción con propuesta', () => {
  it('sin validar: muestra lo que propuso la IA y «Aprobar» queda deshabilitado', () => {
    const html = renderToStaticMarkup(<Instruccion ins={ins()} controles={[ctl()]} preparar ocupado={false} ejecutar={ejecutar} />)
    expect(html).toContain('IA: Obligación · vigilador · sin validar')
    expect(deshabilitado(html, 'Aprobar')).toBe(true)
    expect(html).toContain('validá antes la clasificación')
  })

  it('validada: «Aprobar» habilitado', () => {
    const html = renderToStaticMarkup(<Instruccion ins={ins({ clasificacion: 'obligacion', validada_at: '2026-10-15T10:00:00Z' })} controles={[ctl()]} preparar ocupado={false} ejecutar={ejecutar} />)
    expect(html).toContain('Aprobar')
    expect(deshabilitado(html, 'Aprobar')).toBe(false)
  })

  it('duplicado: avisa qué lo cubre y no deja aprobar', () => {
    const html = renderToStaticMarkup(<Instruccion
      ins={ins({ clasificacion: 'obligacion', validada_at: '2026-10-15T10:00:00Z' })}
      controles={[ctl({ existente_tipo: 'checklist_item', existente_id: 'x', existente_texto: 'Libro de novedades al día' })]}
      preparar ocupado={false} ejecutar={ejecutar} />)
    expect(html).toContain('Ya cubierto por ítem del checklist: «Libro de novedades al día»')
    expect(deshabilitado(html, 'Aprobar')).toBe(true)
  })

  it('un punto de ronda queda como propuesta (no se activa)', () => {
    const html = renderToStaticMarkup(<Instruccion ins={ins()} controles={[ctl({ destino: 'punto_ronda' })]} preparar ocupado={false} ejecutar={ejecutar} />)
    expect(html).toContain('queda como propuesta documentada')
  })

  it('sin permiso de preparar: no hay botones', () => {
    const html = renderToStaticMarkup(<Instruccion ins={ins()} controles={[ctl()]} preparar={false} ocupado={false} ejecutar={ejecutar} />)
    expect(html).not.toContain('Aprobar')
    expect(html).not.toContain('Validar')
    expect(html).not.toContain('Rechazar')
  })
})

describe('versión', () => {
  it('borrador: avisa que se activa recién cuando rija', () => {
    const p = panel()
    const html = renderToStaticMarkup(<Version version={p.versiones[0]} panel={p} porInstruccion={controlesPorInstruccion(p.controles)}
      ocupado={false} ocultarInformativas setOcultarInformativas={() => {}} ejecutar={ejecutar} />)
    expect(html).toContain('se activa recién cuando rija')
    expect(html).toContain('Proponer controles con IA')
  })

  it('versión que ya no rige: pide revisar sus controles activos y no ofrece la IA', () => {
    const p = panel()
    const html = renderToStaticMarkup(<Version version={{ ...p.versiones[0], estado: 'reemplazado' }} panel={p} porInstruccion={controlesPorInstruccion(p.controles)}
      ocupado={false} ocultarInformativas setOcultarInformativas={() => {}} ejecutar={ejecutar} />)
    expect(html).toContain('ya no rige')
    expect(html).toContain('siguen en el checklist sin cambios')
    expect(html).not.toContain('Proponer controles con IA')
  })
})

describe('activación', () => {
  const aprobado = ctl({ estado: 'aprobado', aprobado_at: '2026-10-15T11:00:00Z' })
  it('versión no vigente: el botón queda deshabilitado', () => {
    const p = panel()
    const html = renderToStaticMarkup(<Activacion objetivoId="o1" version={p.versiones[0]} panel={p} aprobados={[aprobado]} ocupado={false} ejecutar={ejecutar} />)
    expect(html).toContain('cuando esta versión del protocolo esté publicada')
    expect(/<button[^>]*disabled[^>]*>Activar/.test(html)).toBe(true)
  })

  it('vigente con plantilla general: explica que se crea una copia propia', () => {
    const p = panel({ versiones: [version({ estado: 'vigente' })] })
    const html = renderToStaticMarkup(<Activacion objetivoId="o1" version={p.versiones[0]} panel={p} aprobados={[aprobado]} ocupado={false} ejecutar={ejecutar} />)
    expect(html).toContain('Se crea una plantilla propia del objetivo: copia de «supervision simple»')
  })
})
