// Reportes reutiliza «Cerrar turno» para los relevos, sin cambiar su comportamiento.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, '..', 'app', 'dashboard', 'AppClient.tsx'), 'utf8').replace(/\r\n/g, '\n')
const bloque = (desde: string) => { const a = src.indexOf(desde); return src.slice(a, src.indexOf('\nfunction ', a + desde.length)) }

describe('Relevo desde Reportes', () => {
  it('Reportes abre el mismo CerrarTurnoModal', () => {
    const reportes = bloque('function Reportes(')
    expect(reportes).toMatch(/<CerrarTurnoModal[\s\S]*?turno=\{turnoParaRelevo\}/)
    expect(reportes).toMatch(/setTurnoParaRelevo\(/)
  })
  it('CerrarTurnoModal sigue llamando a cerrar_turno con los tramos tal cual', () => {
    const modal = bloque('function CerrarTurnoModal(')
    expect(modal).toMatch(/rpc\('cerrar_turno'/)
    expect(modal).toContain('p_tramos:     tramos.map(t => ({ guardia_id: t.guardia_id, hora_inicio: t.hora_inicio, hora_fin: t.hora_fin })),')
  })
  it('la carga manual sigue enviando horas = null (sin cambio de regla)', () => {
    expect(bloque('function CargarAsistenciaManualModal(')).toContain('p_horas_liquidables: null,')
  })
})
