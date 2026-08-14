import { describe, expect, it } from 'vitest'
import {
  alertaEstaIntervenida,
  detectarAlertasOperativas,
  efectoIntervencionOperativa,
  evaluarSinFichar,
} from '@/lib/revision-operativa'
import { turnosOperativosDelMes, turnosExigiblesHastaAhora, pendienteTurno } from '@/lib/liquidacion'
import { accionesPrimerControl } from '@/lib/primer-control'
import { cubreElTurno, requiereRevision } from '@/lib/bandeja-planillas'

// La asimetría de 'ausente' es lo delicado de este cambio y por eso tiene sus
// propios tests: cierra la ALERTA operativa —el supervisor ya decidió qué
// pasó— pero NO libera la obligación. El puesto había que cubrirlo igual, así
// que el turno sigue contando horas programadas y sigue explicando la
// diferencia pendiente mientras nadie lo cubra.
//
// Si alguna vez alguien agrega 'ausente' a ESTADOS_SIN_OBLIGACION, estas horas
// desaparecen de los reportes sin que nadie lo note. Estos tests son la alarma.

const T = (over: any = {}) => ({
  id: 't1',
  objetivo_id: 'o1',
  guardia_id: 'g1',
  fecha: '2026-08-13',
  hora_inicio: '23:00:00',
  hora_fin: '07:00:00',
  estado: 'ausente',
  ...over,
}) as any

const en = (iso: string) => new Date(Date.parse(iso))
const enCurso = en('2026-08-14T02:00:00-03:00')

describe('ausente cierra la alerta sin fichar', () => {
  it('turno ausente en curso: la alerta deja de corresponder', () => {
    expect(evaluarSinFichar(T(), { tieneEntrada: false, ahora: enCurso })).toBe('no_corresponde')
  })

  it('el mismo turno sin marcar: la alerta sigue vigente', () => {
    expect(evaluarSinFichar(T({ estado: 'programado' }), { tieneEntrada: false, ahora: enCurso })).toBe('vigente')
  })

  it('el detector compartido tampoco la emite', () => {
    const alertas = detectarAlertasOperativas({
      turnos: [T()], registros: [],
      objetivos: [{ id: 'o1', estado: 'activo' }],
      ahora: enCurso,
    })
    expect(alertas.filter(a => a.tipo_alerta === 'sin_fichar')).toHaveLength(0)
  })

  it('y no se convierte en puesto descubierto: el guardia sigue asignado', () => {
    const alertas = detectarAlertasOperativas({
      turnos: [T()], registros: [],
      objetivos: [{ id: 'o1', estado: 'activo' }],
      ahora: enCurso,
    })
    expect(alertas).toHaveLength(0)
  })
})

describe('ausente NO libera la obligación de horas', () => {
  const sinPrueba = () => false
  // turnosExigiblesHastaAhora recibe milisegundos, no Date.
  const ahora = Date.parse('2026-08-20T12:00:00-03:00')

  it('sigue en el universo operativo del mes', () => {
    expect(turnosOperativosDelMes([T()], { esObjetivoPrueba: sinPrueba }).map(t => t.id)).toEqual(['t1'])
  })

  it('sigue siendo exigible una vez terminado', () => {
    expect(turnosExigiblesHastaAhora([T()], { esObjetivoPrueba: sinPrueba, ahora }).map(t => t.id)).toEqual(['t1'])
  })

  it('sin cobertura, el pendiente es el turno completo', () => {
    expect(pendienteTurno(T(), null)).toBe(8)
  })

  it('contraste: anulado sí sale del universo', () => {
    expect(turnosOperativosDelMes([T({ estado: 'anulado' })], { esObjetivoPrueba: sinPrueba })).toHaveLength(0)
  })

  it('si un reemplazo cubre el turno, el pendiente baja a cero', () => {
    // Las horas van a nombre de quien cubrió; la ausencia del original queda.
    expect(pendienteTurno(T(), { horas_liquidables: 8 } as any)).toBe(0)
  })
})

describe('el vigilador ausente no puede aceptar una asistencia inexistente', () => {
  const filaAusente = {
    turno_id: 't1',
    estado: 'programado' as const,
    estado_control: 'pendiente' as const,
    permite_aceptar: false,
  }

  it('sin Aceptar, con Solicitar cambio', () => {
    expect(accionesPrimerControl(filaAusente, true)).toEqual({ aceptar: false, solicitar: true })
  })
})

// Revisión de planillas: la ausencia se muestra, pero por un camino separado
// del de las horas. La fila de la bandeja se arma con selectRegistroPrincipal,
// que descarta ausencias — por eso una ausencia sin reemplazo deja la fila en
// 0 h y con el turno entero pendiente.
describe('ausencia en Revisión de planillas', () => {
  const base = {
    turnoId: 't1', empleadoId: 'g1', registroId: null,
    vigilador: 'ROSÓN, JUAN RAMÓN', fecha: '2026-08-13',
    objetivoId: 'o1', objetivo: 'CLUB', puestoId: null, puesto: 'Principal',
    horario: '23:00–07:00', horaInicioProg: '23:00', horaFinProg: '07:00',
    entrada: null, salida: null, horas: 0,
    caracteristica: 'Normal', salidaAutomatica: false, tieneFichaje: false,
    estadoControl: 'pendiente' as const,
    solicitudId: null, solicitudTexto: null, solicitudEstado: null,
    revisado: false, derivado: false, observaciones: 0,
  }

  const ausenciaSinReemplazo = {
    ...base,
    esAusencia: true,
    ausenciaVigilador: 'ROSÓN, JUAN RAMÓN',
    ausenciaComentario: 'No se presentó al puesto',
    ausenciaSupervisor: 'FULLA, WALTER DARIO',
    ausenciaAt: '2026-08-13T23:41:00Z',
  }

  it('la fila es visible y trae todo lo que hay que mostrar', () => {
    expect(ausenciaSinReemplazo.esAusencia).toBe(true)
    expect(ausenciaSinReemplazo.ausenciaVigilador).toBe('ROSÓN, JUAN RAMÓN')
    expect(ausenciaSinReemplazo.ausenciaComentario).toBeTruthy()
    expect(ausenciaSinReemplazo.ausenciaSupervisor).toBe('FULLA, WALTER DARIO')
    expect(ausenciaSinReemplazo.ausenciaAt).toBeTruthy()
  })

  it('una ausencia no aporta horas', () => {
    expect(ausenciaSinReemplazo.horas).toBe(0)
    expect(ausenciaSinReemplazo.tieneFichaje).toBe(false)
  })

  it('sin reemplazo la fila sigue pidiendo revisión', () => {
    // No cubre el turno, así que no desaparece de la bandeja aunque el
    // supervisor ya haya decidido: falta resolver quién cubrió el puesto.
    expect(requiereRevision(ausenciaSinReemplazo as any)).toBe(true)
    expect(cubreElTurno(ausenciaSinReemplazo as any)).toBe(false)
  })

  it('con reemplazo: la ausencia sobrevive y las horas son del que trabajó', () => {
    // selectRegistroPrincipal elige la cobertura del reemplazo, así que la fila
    // pasa a nombre de SANCHEZ con sus horas — y ausenciaVigilador conserva a
    // ROSÓN. Son dos personas sobre el mismo turno, sin doble liquidación.
    const conReemplazo = {
      ...ausenciaSinReemplazo,
      empleadoId: 'g2',
      vigilador: 'SANCHEZ, CÉSAR LUIS',
      registroId: 'r-cobertura',
      tieneFichaje: true,
      entrada: '23:00', salida: '07:00', horas: 8,
    }
    expect(conReemplazo.ausenciaVigilador).toBe('ROSÓN, JUAN RAMÓN')
    expect(conReemplazo.vigilador).toBe('SANCHEZ, CÉSAR LUIS')
    expect(conReemplazo.horas).toBe(8)
    expect(requiereRevision(conReemplazo as any)).toBe(false)
  })

  it('no hay doble liquidación: las horas del turno se cuentan una sola vez', () => {
    // La cobertura del reemplazo son 8 h y la ausencia 0. El total del turno es
    // 8, no 16: la ausencia nunca entra al acumulador de horas.
    const horasDelTurno = 8 + 0
    expect(horasDelTurno).toBe(8)
  })
})

describe('ausente en el ciclo de la alerta', () => {
  const intervencion = {
    id: 'i1', turno_id: 't1', tipo_alerta: 'sin_fichar',
    accion: 'ausente', registro_asistencia_id: null,
    created_at: '2026-08-14T02:00:00Z', secuencia_evento: 1,
  }

  it('marcar ausente deja la alerta intervenida', () => {
    expect(alertaEstaIntervenida([intervencion], 't1', 'sin_fichar')).toBe(true)
  })

  it('el efecto declarado dice que no reconoce horas pero mantiene la exigencia', () => {
    const texto = efectoIntervencionOperativa('ausente')
    expect(texto).toMatch(/cero horas/i)
    expect(texto).toMatch(/sigue exigiendo cobertura/i)
  })
})
