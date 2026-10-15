import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { agruparPorMomento, faltaParaRegistrar, momentoSugerido, progreso } from '@/lib/tareas-turno'
import type { TareaDelTurno } from '@/lib/tareas-turno'
import TareasTurnoVigilador from '@/components/tareas/TareasTurnoVigilador'

const t = (p: Partial<TareaDelTurno>): TareaDelTurno => ({
  definicion_id: 'd', momento: 'durante', texto: 'Anunciar visitas al sector', evidencia: 'ninguna', registro: null, ...p,
})

describe('momento sugerido desde el «cuándo» del protocolo', () => {
  it('ingreso, egreso o durante', () => {
    expect(momentoSugerido('al tomar servicio')).toBe('ingreso')
    expect(momentoSugerido('Al ingresar a la guardia')).toBe('ingreso')
    expect(momentoSugerido('al retirarse los empleados')).toBe('egreso')
    expect(momentoSugerido('a la hora del cierre')).toBe('egreso')
    expect(momentoSugerido('cada vez que llega un proveedor')).toBe('durante')
    expect(momentoSugerido(null)).toBe('durante')
  })
})

describe('progreso y agrupación', () => {
  const tareas = [
    t({ definicion_id: 'a', momento: 'egreso', evidencia: 'foto', registro: { id: 'r1', estado: 'hecha', comentario: null, registrado_at: 'x', con_foto: false } }),
    t({ definicion_id: 'b', momento: 'ingreso' }),
    t({ definicion_id: 'c', momento: 'ingreso', registro: { id: 'r2', estado: 'no_aplica', comentario: 'feriado', registrado_at: 'x', con_foto: false } }),
  ]
  it('agrupa en orden ingreso → durante → egreso, sin grupos vacíos', () => {
    expect(agruparPorMomento(tareas).map(g => g.momento)).toEqual(['ingreso', 'egreso'])
  })
  it('cuenta marcadas y fotos que faltan', () => {
    expect(progreso(tareas)).toEqual({ marcadas: 2, total: 3, falta_foto: 1 })
  })
  it('pide motivo para «no aplica» / «no pude» y comentario cuando la tarea lo exige', () => {
    expect(faltaParaRegistrar(t({}), 'no_pude', ' ')).toMatch(/por qué/)
    expect(faltaParaRegistrar(t({}), 'hecha', '')).toBeNull()
    expect(faltaParaRegistrar(t({ evidencia: 'comentario' }), 'hecha', '')).toMatch(/comentario/)
  })
})

describe('pantalla del vigilador', () => {
  it('muestra las tareas por momento, siempre se puede cerrar, y aclara que no califica', () => {
    const html = renderToStaticMarkup(
      <TareasTurnoVigilador turnoId="t1" objetivoNombre="RANDSTAD" onCerrar={() => {}} onCambio={() => {}}
        tareas={[t({ momento: 'ingreso', texto: 'Conectar la cámara de la sala' }), t({ momento: 'egreso', texto: 'Activar la alarma piso por piso' })]} />,
    )
    expect(html).toContain('Al ingresar')
    expect(html).toContain('Al retirarse')
    expect(html).toContain('Conectar la cámara de la sala')
    expect(html).toContain('Cerrar')
    expect(html).toContain('No cambia tu calificación')
    expect(html).toContain('0 de 2 marcadas')
  })
  it('una tarea hecha con foto pendiente ofrece sacarla', () => {
    const html = renderToStaticMarkup(
      <TareasTurnoVigilador turnoId="t1" objetivoNombre="RANDSTAD" onCerrar={() => {}} onCambio={() => {}}
        tareas={[t({ evidencia: 'foto', registro: { id: 'r', estado: 'hecha', comentario: null, registrado_at: 'x', con_foto: false } })]} />,
    )
    expect(html).toContain('Sacar la foto')
    expect(html).toContain('falta 1 foto')
  })
})
