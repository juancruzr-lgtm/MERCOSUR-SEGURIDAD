import { readFileSync } from 'fs'
import { join } from 'path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BarraPosicionTurno, GraficoPorHora, MatrizDiaHora } from '@/components/supervisiones/GraficosHorarioSupervision'
import type { FranjaHoraria } from '@/lib/legajo-supervisor'

const filas = (p: Partial<FranjaHoraria>[] = []): FranjaHoraria[] =>
  Array.from({ length: 24 }, (_, hora) => ({ hora, enTurno: 0, fueraTurno: 0, sinCalendario: 0, minutosServicio: 0, ...(p[hora] ?? {}) }))

describe('gráfico por hora', () => {
  it('24 columnas con la hora y el detalle en el título (en turno / fuera / servicio)', () => {
    const f = filas()
    f[8] = { hora: 8, enTurno: 3, fueraTurno: 1, sinCalendario: 0, minutosServicio: 600 }
    const html = renderToStaticMarkup(<GraficoPorHora filas={f} />)
    expect(html.match(/>\d\d<\/div>/g)).toHaveLength(24)
    expect(html).toContain('08 h · 4 supervisiones (3 en turno, 1 fuera, 0 sin guardia cargada) · 10 h de servicio')
    expect(html).toContain('Horas de servicio programado')
  })
  it('sin supervisiones lo dice, no dibuja ceros como si fueran datos', () => {
    expect(renderToStaticMarkup(<GraficoPorHora filas={filas()} />)).toContain('Sin supervisiones en el período.')
  })
})

describe('matriz y posición en turno', () => {
  it('matriz con los 7 días, lunes primero', () => {
    const m = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
    m[6][20] = 2
    const html = renderToStaticMarkup(<MatrizDiaHora matriz={m} />)
    expect(html.indexOf('Lun')).toBeLessThan(html.indexOf('Dom'))
    expect(html).toContain('Dom 20 h · 2')
  })
  it('posición en turno con porcentajes; vacío lo dice', () => {
    expect(renderToStaticMarkup(<BarraPosicionTurno inicio={1} medio={2} final={1} />)).toContain('Mitad del turno: 2 (50 %)')
    expect(renderToStaticMarkup(<BarraPosicionTurno inicio={0} medio={0} final={0} />)).toContain('Sin supervisiones dentro de turno.')
  })
})

describe('cableado (sobre el código fuente)', () => {
  const app = readFileSync(join(__dirname, '..', 'app', 'dashboard', 'AppClient.tsx'), 'utf8')
  const legajo = readFileSync(join(__dirname, '..', 'app', 'guardias', '[id]', 'LegajoPage.tsx'), 'utf8')
  it('el menú abre la pantalla a quien ve legajos; el ranking sigue sólo para Dirección y Gerencia', () => {
    expect(app).toContain("...(puedeVerLegajoSupervisores(user) ? [{ id:'evaluacion_supervisores'")
    expect(app).toContain("page === 'evaluacion_supervisores' && puedeVerLegajoSupervisores(user) && <EvaluacionSupervisoresPanel verRanking={puedeVerEvaluacionSupervisores(user)} />")
  })
  it('la pestaña «Legajo operativo» sólo aparece a quien la puede ver', () => {
    expect(legajo).toContain("{ id: 'operativo', label: 'Legajo operativo' }")
    expect(legajo).toContain("SECCIONES.filter(s => s.id !== 'operativo' || veLegajoOperativo)")
    expect(legajo).toMatch(/veLegajoOperativo\s*\?\s*<LegajoOperativoSupervisor supervisorId=\{empleadoId\} \/>/)
  })
})
