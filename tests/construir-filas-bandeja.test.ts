import { describe, expect, it } from 'vitest'
import { construirFilasBandeja, finTurnoMs, requiereRevision } from '@/lib/bandeja-planillas'
import type { DatosBandejaMensual, DependenciasFilas } from '@/lib/bandeja-planillas'

// La construcción de filas vivía dentro de BandejaPlanillas. Se extrajo para
// que el Cierre Operativo pueda preguntar "cuántas planillas requieren
// decisión" sin reimplementarla: dos construcciones para la misma pregunta es
// lo que ya rompió los contadores del tablero.

// El 2026-08-20 a las 12:00 local, para que "el turno ya terminó" sea estable.
const AHORA = new Date(2026, 7, 20, 12, 0, 0).getTime()

const dep: DependenciasFilas = {
  selectRegistroPrincipal: rs => rs[0] ?? null,
  effectiveGuardia: r => r?.guardia_final_id ?? r?.guardia_id ?? null,
  resolverLineaLiquidacion: (t, r) => ({
    horaEntrada: r?.hora_entrada_real ?? null,
    horaSalida: r?.hora_salida_real ?? null,
    horasLiquidables: r?.horas_liquidables ?? 0,
  }),
  etiquetaCaracteristica: () => 'Normal',
  objetivoEnAlcance: (zonaId, esAdmin, zonasMias) => esAdmin || zonasMias.has(String(zonaId)),
}

const turno = (over: Record<string, any> = {}) => ({
  id: 't1', fecha: '2026-08-19',
  hora_inicio: '07:00', hora_fin: '19:00',
  estado: 'cubierto', tipo_evento: null,
  guardia_id: 'g1', objetivo_id: 'o1', puesto_id: 'p1',
  puesto: { nombre: 'Principal' },
  objetivo: { nombre: 'LAROMET', es_prueba: false, zona_id: 'z1' },
  ...over,
})

const datos = (over: Partial<DatosBandejaMensual> = {}): DatosBandejaMensual => ({
  turnos: [turno()],
  registros: [],
  aceptaciones: [], solicitudes: [], revisiones: [],
  guardias: [{ id: 'g1', nombre: 'PABLO', apellido: 'TABORDA' }],
  zonasMias: ['z1'],
  esAdmin: false,
  ahora: AHORA,
  ...over,
})

describe('finTurnoMs — el cruce de medianoche', () => {
  it('un turno diurno termina el mismo día', () => {
    expect(finTurnoMs('2026-08-19', '07:00', '19:00'))
      .toBe(new Date(2026, 7, 19, 19, 0, 0).getTime())
  })

  it('uno nocturno termina al día siguiente', () => {
    expect(finTurnoMs('2026-08-19', '19:00', '07:00'))
      .toBe(new Date(2026, 7, 20, 7, 0, 0).getTime())
  })
})

describe('qué turnos quedan afuera', () => {
  it('los objetivos de prueba no entran', () => {
    const d = datos({ turnos: [turno({ objetivo: { nombre: 'Casa Juan', es_prueba: true, zona_id: 'z1' } })] })
    expect(construirFilasBandeja(d, dep)).toHaveLength(0)
  })

  it('un turno reemplazado, anulado o cancelado no se revisa', () => {
    for (const estado of ['reemplazado', 'anulado', 'cancelado']) {
      expect(construirFilasBandeja(datos({ turnos: [turno({ estado })] }), dep)).toHaveLength(0)
    }
  })

  it('un turno que todavía no terminó tampoco: no hay nada que decidir', () => {
    const d = datos({ turnos: [turno({ fecha: '2026-08-20', hora_inicio: '07:00', hora_fin: '19:00' })] })
    expect(construirFilasBandeja(d, dep)).toHaveLength(0)
  })

  it('fuera de la zona del supervisor, no entra', () => {
    expect(construirFilasBandeja(datos({ zonasMias: ['otra'] }), dep)).toHaveLength(0)
  })

  it('el admin ve todo el alcance igual', () => {
    expect(construirFilasBandeja(datos({ zonasMias: [], esAdmin: true }), dep)).toHaveLength(1)
  })

  it('sin empleado no hay fila a quién atribuirla', () => {
    expect(construirFilasBandeja(datos({ turnos: [turno({ guardia_id: null })] }), dep)).toHaveLength(0)
  })
})

describe('la fila que sí se construye', () => {
  it('trae el origen de cobertura, que decide la regla de confirmación', () => {
    const d = datos({
      registros: [{ id: 'r1', turno_id: 't1', guardia_id: 'g1', origen_cobertura: 'confirmacion_supervisor', horas_liquidables: 12 }],
      aceptaciones: [{ turno_id: 't1', empleado_id: 'g1' }],
    })
    const [fila] = construirFilasBandeja(d, dep)
    expect(fila.origenCobertura).toBe('confirmacion_supervisor')
    expect(fila.estadoControl).toBe('aceptado')
    // Confirmación + aceptación, sin fichaje: ya no pide otra revisión.
    expect(requiereRevision(fila)).toBe(false)
  })

  it('una ausencia no se convierte en horas ni en fichaje', () => {
    const d = datos({
      registros: [{ id: 'a1', turno_id: 't1', guardia_id: 'g1', tipo_registro: 'ausencia', observacion: 'no vino' }],
    })
    const [fila] = construirFilasBandeja(d, dep)
    expect(fila.esAusencia).toBe(true)
    expect(fila.tieneFichaje).toBe(false)
    expect(fila.horas).toBe(0)
  })

  it('una cobertura anulada no aporta el registro principal', () => {
    const d = datos({
      registros: [{ id: 'r1', turno_id: 't1', guardia_id: 'g1', cobertura_anulada_at: '2026-08-19T10:00:00Z', horas_liquidables: 12 }],
    })
    const [fila] = construirFilasBandeja(d, dep)
    expect(fila.tieneFichaje).toBe(false)
  })

  it('el horario programado es el que manda en la etiqueta', () => {
    const [fila] = construirFilasBandeja(datos(), dep)
    expect(fila.horario).toBe('07:00–19:00')
    expect(fila.horaInicioProg).toBe('07:00')
    expect(fila.vigilador).toBe('TABORDA, PABLO')
  })
})
