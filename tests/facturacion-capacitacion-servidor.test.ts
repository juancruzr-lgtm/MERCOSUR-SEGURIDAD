// Capacitación: se liquida y NO se factura, también por el camino del servidor
// que usa el cálculo masivo ("Calcular <mes> con las horas de la app"):
// aprobarHoras → proponerHoras → lectura de turnos → fact_horas_aprobar.
import { describe, it, expect } from 'vitest'
import { aprobarHoras } from '@/lib/facturacion/servidor'
import { horasLiquidablesRegistro } from '@/lib/liquidacion'

const OBJ = 'obj-1'
const TURNOS = [
  { id: 'A', fecha: '2026-10-10', hora_inicio: '07:00:00', hora_fin: '15:00:00', objetivo_id: OBJ, puesto_id: 'P1', estado: 'cubierto', tipo_evento: 'normal' },
  { id: 'C', fecha: '2026-10-11', hora_inicio: '07:00:00', hora_fin: '15:00:00', objetivo_id: OBJ, puesto_id: 'P1', estado: 'cubierto', tipo_evento: 'capacitacion' },
]
const REGISTROS = [
  { id: 'rA', turno_id: 'A', guardia_id: 'g1', hora_entrada_real: '07:00:00', hora_salida_real: '15:00:00' },
  { id: 'rC', turno_id: 'C', guardia_id: 'g2', hora_entrada_real: '07:00:00', hora_salida_real: '15:00:00' },
]

/** Cliente Supabase mínimo: devuelve filas por tabla respetando las columnas pedidas. */
function dbFalso() {
  const rpcs: Array<{ fn: string; args: any }> = []
  const tabla = (nombre: string) => {
    let columnas = '*'
    const q: any = {
      select(c: string) { columnas = c; return q },
      eq() { return q }, gte() { return q }, lt() { return q }, in() { return q }, order() { return q },
      single: async () => ({ data: nombre === 'fact_contratos' ? { id: 'k1', regla_periodo: 'mes_calendario', superposicion: 'unir' } : null, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      range: async (a: number) => {
        if (a > 0) return { data: [], error: null }
        if (nombre === 'turnos') {
          // Sólo lo que la consulta pide: si tipo_evento no está en el select, no llega.
          const pide = columnas.split(',').map(s => s.trim())
          return { data: TURNOS.map(t => Object.fromEntries(Object.entries(t).filter(([k]) => pide.includes(k)))), error: null }
        }
        if (nombre === 'registros_asistencia') return { data: REGISTROS, error: null }
        return { data: [], error: null }
      },
    }
    return q
  }
  let llamadasRegistros = 0
  const db: any = {
    from: (n: string) => {
      const q = tabla(n)
      if (n === 'registros_asistencia') {
        // 1ª lectura: registros movidos HACIA el objetivo (ninguno); 2ª: los de sus turnos.
        const range = q.range
        q.range = async (a: number) => (llamadasRegistros++ === 0 ? { data: [], error: null } : range(a))
      }
      return q
    },
    rpc: async (fn: string, args: any) => { rpcs.push({ fn, args }); return { data: 'aprob-1', error: null } },
  }
  return { db, rpcs }
}

describe('capacitación en el cálculo del servidor', () => {
  it('se liquida (8 h) pero la aprobación de horas facturables sólo lleva el turno normal', async () => {
    expect(horasLiquidablesRegistro(TURNOS[1], REGISTROS[1] as any)).toBe(8)
    const { db, rpcs } = dbFalso()
    const r = await aprobarHoras(db, { contratoId: 'k1', objetivoId: OBJ, mes: '2026-10' })
    expect(r.aprobados).toBe(480)
    const llamada = rpcs.find(x => x.fn === 'fact_horas_aprobar')!
    expect(llamada.args.p_minutos).toMatchObject({ programados: 480, cubiertos: 480, aprobados: 480, descubiertos: 0, capacitacion_excluida: 480, capacitacion_turnos: 1 })
    expect(llamada.args.p_detalle.find((d: any) => d.turno_id === 'C')).toMatchObject({ estado: 'capacitacion', cubiertos: 0 })
  })
})
