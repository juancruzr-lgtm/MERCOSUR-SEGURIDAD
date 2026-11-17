import { describe, expect, it } from 'vitest'
import { agruparProblemas, indicadoresCalidad, type ReclamoCliente } from '@/lib/tablero-gerencia/calidad'
import type { Caso } from '@/lib/tablero-gerencia/casos'

const caso = (p: Partial<Caso>): Caso => ({
  id: 'c', tipo: 'sin_fichaje', gravedad: 'alta', estado: 'detectado', causa: 'indeterminada', clave: 'k', regla: 'ASI-01',
  empleadoId: 'e1', objetivoId: 'o1', clienteId: null, turnoId: null, fechaHecho: '2026-11-01', detectadoAt: '2026-11-01T12:00:00Z',
  plazoAt: null, responsableId: null, evidencias: [], eventos: [], ...p,
})
const resuelto = (id: string, fecha: string, at: string): Caso => caso({
  id, fechaHecho: fecha, detectadoAt: `${fecha}T12:00:00Z`, estado: 'resuelto',
  eventos: [{ accion: 'marcar_resuelto', actorId: 'g', at, estadoAnterior: 'en_revision', estadoNuevo: 'resuelto' }],
})

describe('agrupar problemas de una misma causa', () => {
  it('misma persona y objetivo = un problema con todos sus casos; GPS se agrupa por objetivo', () => {
    const p = agruparProblemas([
      caso({ id: 'a', fechaHecho: '2026-11-02' }), caso({ id: 'b', fechaHecho: '2026-11-05' }),
      caso({ id: 'c', empleadoId: 'e2' }),
      caso({ id: 'g1', tipo: 'gps_fuera_radio', causa: 'configuracion', empleadoId: 'e1' }),
      caso({ id: 'g2', tipo: 'gps_fuera_radio', causa: 'configuracion', empleadoId: 'e3' }),
      caso({ id: 'x', estado: 'descartado' }),
    ])
    expect(p.map(x => x.casos.length)).toEqual([2, 2, 1])
    const gps = p.find(x => x.tipo === 'gps_fuera_radio')!
    expect(gps.empleadoId).toBeNull()
    expect(p[0].desde).toBe('2026-11-02')
  })

  it('reincidencia: vuelve a aparecer después de corregido', () => {
    const [p] = agruparProblemas([resuelto('a', '2026-11-01', '2026-11-02T10:00:00Z'), caso({ id: 'b', fechaHecho: '2026-11-08', detectadoAt: '2026-11-08T12:00:00Z' })])
    expect(p.reincidio).toBe(true)
    const [q] = agruparProblemas([resuelto('a', '2026-11-01', '2026-11-02T10:00:00Z')])
    expect(q.reincidio).toBe(false)
  })
})

describe('indicadores de calidad', () => {
  it('detectado antes del reclamo, efectividad y tiempos', () => {
    const casos = [
      resuelto('a', '2026-11-01', '2026-11-01T22:00:00Z'),
      caso({ id: 'b', objetivoId: 'o2', detectadoAt: '2026-11-03T12:00:00Z', fechaHecho: '2026-11-03' }),
    ]
    const reclamos: ReclamoCliente[] = [
      { id: 'r1', clienteId: null, objetivoId: 'o1', fecha: '2026-11-02', recibidoAt: '2026-11-02T09:00:00Z', descripcion: '', casoId: 'a', estado: 'cerrado' },
      { id: 'r2', clienteId: null, objetivoId: 'o2', fecha: '2026-11-03', recibidoAt: '2026-11-03T09:00:00Z', descripcion: '', casoId: 'b', estado: 'abierto' },
      { id: 'r3', clienteId: null, objetivoId: 'o3', fecha: '2026-11-04', recibidoAt: '2026-11-04T09:00:00Z', descripcion: '', casoId: null, estado: 'abierto' },
    ]
    const i = indicadoresCalidad(casos, reclamos, '2026-11-17T00:00:00Z')
    expect(i).toMatchObject({ detectadosInternamente: 2, reclamosClientes: 3, reclamosConCasoPrevio: 1, pctDetectadoAntesDelReclamo: 33.3, horasPromedioResolucion: 10, resueltos: 1, problemas: 2, efectividadCorrectiva: 100 })
  })
})
