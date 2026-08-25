import { describe, expect, it } from 'vitest'
import {
  alertasOperativasParaCierre, diaAnterior, esSaneada, estamparZonas, itemsDeFotosIA,
  itemsDeOperacion, itemsDePlanillas, itemsDeRondas, partirInstante, rangoCierreDelDia,
} from '@/lib/cierre-datos'
import type { AlertaRondaCierre, EvidenciaIACierre } from '@/lib/cierre-datos'
import { construirCierreOperativo, resumirCierre } from '@/lib/cierre-operativo'
import type { FilaBandejaMensual } from '@/lib/bandeja-planillas'

// Cierre Operativo Diario: de las fuentes reales a los items del agregador.
// No detecta nada nuevo — traduce lo que ya producen Revisión de planillas,
// ronda_alertas y la bandeja de fotos IA.

const fila = (over: Partial<FilaBandejaMensual> = {}): FilaBandejaMensual => ({
  turnoId: 't1', empleadoId: 'e1', registroId: 'r1', vigilador: 'PEREZ, JUAN',
  fecha: '2026-08-25',
  objetivoId: 'o1', objetivo: 'LAROMET', puestoId: 'p1', puesto: 'Principal',
  horario: '07:00–19:00', horaInicioProg: '07:00', horaFinProg: '19:00',
  entrada: '07:00', salida: '19:00', horas: 12,
  caracteristica: 'Normal', salidaAutomatica: false, tieneFichaje: true,
  entradaPropia: true, salidaPropia: true,
  estadoControl: 'pendiente', solicitudId: null, solicitudTexto: null,
  solicitudEstado: null, revisado: false, derivado: false, observaciones: 0,
  ...over,
})

const alerta = (over: Partial<AlertaRondaCierre> = {}): AlertaRondaCierre => ({
  id: 'a1', objetivo_id: 'o1', objetivo_nombre: 'SKATEPARK',
  ronda_nombre: 'Portón este', guardia_nombre: 'VILLA, URIEL',
  tipo: 'no_iniciada', estado: 'pendiente',
  ventana_inicio: '2026-08-25T13:00:00Z',
  comentario: null,
  ...over,
})

const evidencia = (over: Partial<EvidenciaIACierre> = {}): EvidenciaIACierre => ({
  id: 'i1', analisis_tipo: 'uniforme', objetivo_id: 'o1',
  objetivo_nombre: 'ACA', guardia_nombre: 'GOMEZ, LUCAS',
  revision_estado: 'PENDIENTE', clasificacion_efectiva: 'REVISAR',
  evidencia_created_at: '2026-08-25T13:00:00Z',
  ...over,
})

// ── Planillas ────────────────────────────────────────────────────────────────

describe('planillas en el cierre', () => {
  it('una planilla resuelta no aparece', () => {
    // Cubre el turno y el vigilador aceptó: no hay nada que decidir.
    const items = itemsDePlanillas([fila({ estadoControl: 'aceptado' })])
    expect(resumirCierre(items).total).toBe(0)
  })

  it('una planilla que pide decisión aparece', () => {
    // Se retiró antes: la cobertura no da y nadie la revisó.
    const items = itemsDePlanillas([fila({ salida: '17:00' })])
    expect(items).toHaveLength(1)
    expect(items[0].categoria).toBe('planillas')
    expect(resumirCierre(items).total).toBe(1)
  })

  it('confirmación de supervisor + aceptación NO es pendiente', () => {
    const items = itemsDePlanillas([fila({
      entrada: null, salida: null, entradaPropia: false, salidaPropia: false,
      origenCobertura: 'confirmacion_supervisor', estadoControl: 'aceptado',
    })])
    expect(items).toHaveLength(0)
  })

  it('derivada a Administración sale del pendiente del supervisor', () => {
    // Sigue abierta para Administración; deja de ser trabajo de él.
    const items = itemsDePlanillas([fila({ salida: '17:00', derivado: true })])
    expect(items).toHaveLength(1)
    expect(items[0].resueltoPorSupervisor).toBe(true)
    expect(resumirCierre(items).total).toBe(0)
  })

  it('la etiqueta dice quién, dónde y cuándo', () => {
    const [i] = itemsDePlanillas([fila({ salida: '17:00' })])
    expect(i.etiqueta).toBe('PEREZ, JUAN · LAROMET · 07:00–19:00')
  })
})

// ── Rondas ───────────────────────────────────────────────────────────────────

describe('rondas en el cierre', () => {
  it('una alerta pendiente aparece', () => {
    const items = itemsDeRondas([alerta()])
    expect(items).toHaveLength(1)
    expect(resumirCierre(items).total).toBe(1)
    expect(items[0].categoria).toBe('rondas')
  })

  it('una alerta cerrada administrativamente sale del pendiente', () => {
    const items = itemsDeRondas([alerta({ estado: 'resuelta' })])
    expect(items[0].resueltoPorSupervisor).toBe(true)
    expect(resumirCierre(items).total).toBe(0)
  })

  it('una alerta saneada no aparece en absoluto', () => {
    // No se cerró por una decisión de hoy: se limpió historia vieja. Volver a
    // mostrarla seria pedirle al supervisor que resuelva algo ya resuelto.
    const items = itemsDeRondas([alerta({
      comentario: 'Saneamiento administrativo previo al inicio del Cierre Operativo Diario.',
    })])
    expect(items).toHaveLength(0)
  })

  it('esSaneada reconoce el motivo del lote', () => {
    expect(esSaneada('Saneamiento administrativo previo…')).toBe(true)
    expect(esSaneada('El vigilador estaba en otra tarea')).toBe(false)
    expect(esSaneada(null)).toBe(false)
  })

  it('conserva el tipo: cerrarla no la vuelve realizada', () => {
    const items = itemsDeRondas([alerta({ estado: 'resuelta', tipo: 'no_iniciada' })])
    expect(items[0].etiqueta).toContain('SKATEPARK')
  })
})

// ── Fotos IA ─────────────────────────────────────────────────────────────────

describe('fotos IA en el cierre', () => {
  it('una observación sin decisión humana aparece', () => {
    const items = itemsDeFotosIA([evidencia()])
    expect(items).toHaveLength(1)
    expect(items[0].categoria).toBe('fotos_ia')
    expect(items[0].etiqueta).toContain('foto de uniforme')
  })

  it('confirmada por el supervisor: fuera del pendiente', () => {
    const items = itemsDeFotosIA([evidencia({ revision_estado: 'CORRECTO' })])
    expect(items[0].resueltoPorSupervisor).toBe(true)
    expect(resumirCierre(items).total).toBe(0)
  })

  it('descartada por el supervisor: también fuera', () => {
    const items = itemsDeFotosIA([evidencia({ revision_estado: 'INCORRECTO' })])
    expect(resumirCierre(items).total).toBe(0)
  })

  it('sin observación de la IA no entra: no es trabajo de nadie', () => {
    expect(itemsDeFotosIA([evidencia({ clasificacion_efectiva: 'SIN_OBSERVACIONES' })])).toHaveLength(0)
    expect(itemsDeFotosIA([evidencia({ clasificacion_efectiva: 'EVIDENCIA_INSUFICIENTE' })])).toHaveLength(0)
  })

  it('sólo los tres tipos que se revisan', () => {
    expect(itemsDeFotosIA([evidencia({ analisis_tipo: 'punto_control' })])).toHaveLength(1)
    expect(itemsDeFotosIA([evidencia({ analisis_tipo: 'libro_guardia' })])).toHaveLength(1)
    expect(itemsDeFotosIA([evidencia({ analisis_tipo: 'otra_cosa' })])).toHaveLength(0)
  })
})

// ── Hoy vs arrastre ──────────────────────────────────────────────────────────

describe('hoy y arrastre no se mezclan', () => {
  it('separa por la fecha del hecho, con las cuatro categorías', () => {
    const items = [
      ...itemsDePlanillas([fila({ turnoId: 'hoy', salida: '17:00', fecha: '2026-08-25' })]),
      ...itemsDePlanillas([fila({ turnoId: 'ayer', salida: '17:00', fecha: '2026-08-24', empleadoId: 'e2' })]),
      ...itemsDeRondas([alerta({ id: 'r-hoy', ventana_inicio: '2026-08-25T13:00:00Z' })]),
      ...itemsDeFotosIA([evidencia({ id: 'i-viejo', evidencia_created_at: '2026-08-20T13:00:00Z' })]),
    ]
    const cierre = construirCierreOperativo(items, '2026-08-25')
    expect(cierre.hoy.total).toBe(2)
    expect(cierre.anteriores.total).toBe(2)
    expect(cierre.hoy.porCategoria.planillas).toBe(1)
    expect(cierre.hoy.porCategoria.rondas).toBe(1)
    expect(cierre.anteriores.porCategoria.fotos_ia).toBe(1)
  })

  it('resolver todo lo de hoy deja hoy en cero sin tocar el arrastre', () => {
    const items = [
      ...itemsDePlanillas([fila({ salida: '17:00', fecha: '2026-08-25', derivado: true })]),
      ...itemsDeFotosIA([evidencia({ evidencia_created_at: '2026-08-20T13:00:00Z' })]),
    ]
    const cierre = construirCierreOperativo(items, '2026-08-25')
    expect(cierre.hoy.total).toBe(0)
    expect(cierre.anteriores.total).toBe(1)
  })
})

// ── Zona horaria ─────────────────────────────────────────────────────────────

describe('partirInstante — la fecha es la local, no la UTC', () => {
  it('las 23:40 de Buenos Aires son del día que termina', () => {
    // 2026-08-26T02:40Z = 2026-08-25 23:40 en Buenos Aires.
    expect(partirInstante('2026-08-26T02:40:00Z')).toEqual({ fecha: '2026-08-25', hora: '23:40' })
  })

  it('la madrugada local no se adelanta un día', () => {
    expect(partirInstante('2026-08-25T09:00:00Z').fecha).toBe('2026-08-25')
  })

  it('una fecha rota no rompe el cierre', () => {
    expect(partirInstante('vaya-a-saber').hora).toBe('00:00')
  })
})

// ── Operación ────────────────────────────────────────────────────────────────

describe('operación en el cierre', () => {
  const turno = {
    id: 't-desc', objetivo_id: 'o1', puesto_id: 'p1', guardia_id: null,
    fecha: '2026-08-25', hora_inicio: '07:00', hora_fin: '19:00', estado: 'programado',
  }
  const objetivos = [{ id: 'o1', nombre: 'LAROMET', estado: 'activo' }]
  // 2026-08-25 12:00 en Buenos Aires: el turno ya arrancó.
  const ahora = new Date('2026-08-25T15:00:00Z')

  it('un puesto sin cobertura es pendiente del supervisor', () => {
    const alertas = alertasOperativasParaCierre({
      turnos: [turno], registros: [], intervenciones: [], objetivos, ahora,
    })
    expect(alertas).toHaveLength(1)
    expect(alertas[0].tipo).toBe('descubierto')
    expect(alertas[0].etiqueta).toBe('Puesto sin cobertura · LAROMET')
    expect(resumirCierre(itemsDeOperacion(alertas)).total).toBe(1)
  })

  it('intervenida por el supervisor: sale del pendiente', () => {
    // La misma decisión que ya tomó en Revisión Operativa vale acá.
    const alertas = alertasOperativasParaCierre({
      turnos: [turno], registros: [], objetivos, ahora,
      intervenciones: [{
        id: 'i1', turno_id: 't-desc', tipo_alerta: 'descubierto',
        accion: 'marcado_descubierto', created_at: '2026-08-25T16:00:00Z',
      }],
    })
    expect(alertas[0].resuelta).toBe(true)
    expect(resumirCierre(itemsDeOperacion(alertas)).total).toBe(0)
  })

  it('un comentario no resuelve nada', () => {
    const alertas = alertasOperativasParaCierre({
      turnos: [turno], registros: [], objetivos, ahora,
      intervenciones: [{
        id: 'i1', turno_id: 't-desc', tipo_alerta: 'descubierto',
        accion: 'comentario', created_at: '2026-08-25T16:00:00Z',
      }],
    })
    expect(resumirCierre(itemsDeOperacion(alertas)).total).toBe(1)
  })

  it('un objetivo pausado no genera trabajo', () => {
    const alertas = alertasOperativasParaCierre({
      turnos: [turno], registros: [], intervenciones: [], ahora,
      objetivos: [{ id: 'o1', nombre: 'LAROMET', estado: 'pausado' }],
    })
    expect(alertas).toHaveLength(0)
  })

  it('un turno anulado tampoco', () => {
    const alertas = alertasOperativasParaCierre({
      turnos: [{ ...turno, estado: 'anulado' }], registros: [],
      intervenciones: [], objetivos, ahora,
    })
    expect(alertas).toHaveLength(0)
  })

  it('la alerta lleva la fecha del turno, no la del reloj', () => {
    // Nocturno que arrancó ayer: pertenece a ayer, igual que en Planillas.
    const alertas = alertasOperativasParaCierre({
      turnos: [{ ...turno, fecha: '2026-08-24', hora_inicio: '19:00', hora_fin: '07:00' }],
      registros: [], intervenciones: [], objetivos, ahora,
    })
    const cierre = construirCierreOperativo(itemsDeOperacion(alertas), '2026-08-25')
    expect(cierre.hoy.total).toBe(0)
    expect(cierre.anteriores.total).toBe(1)
  })
})

// ── Zona y responsable ───────────────────────────────────────────────────────

describe('zona: sin ella no hay responsable', () => {
  it('cada item hereda la zona de su objetivo', () => {
    const items = estamparZonas(
      itemsDePlanillas([fila({ salida: '17:00' })]),
      [{ id: 'o1', zona_id: 'z-rosario' }],
    )
    expect(items[0].zonaId).toBe('z-rosario')
  })

  it('un objetivo sin zona deja el item sin zona, no lo inventa', () => {
    const items = estamparZonas(
      itemsDePlanillas([fila({ salida: '17:00' })]),
      [{ id: 'o1', zona_id: null }],
    )
    expect(items[0].zonaId).toBeNull()
  })

  it('un objetivo que no está en el catálogo tampoco rompe', () => {
    const items = estamparZonas(itemsDePlanillas([fila({ salida: '17:00' })]), [])
    expect(items[0].zonaId).toBeNull()
  })
})

describe('diaAnterior', () => {
  it('retrocede un día', () => {
    expect(diaAnterior('2026-08-25')).toBe('2026-08-24')
  })

  it('cruza el inicio de mes', () => {
    expect(diaAnterior('2026-08-01')).toBe('2026-07-31')
  })
})

// ── El rango que espera la RPC ───────────────────────────────────────────────

describe('rangoCierreDelDia: el límite superior es exclusivo', () => {
  it('para cerrar el 25 se pide hasta el 26', () => {
    // cerrar_ronda_alertas_pendientes compara `vencimiento_at < p_hasta` contra
    // la medianoche que ABRE el día. Con hasta = 25 no entra nada del 25.
    expect(rangoCierreDelDia('2026-08-25')).toEqual({ desde: '2026-08-25', hasta: '2026-08-26' })
  })

  it('los dos extremos nunca son el mismo día: sería un rango vacío', () => {
    // Ese era el defecto: la vista previa decía cero con nueve rondas listadas.
    for (const f of ['2026-08-01', '2026-08-31', '2026-12-31', '2027-02-28']) {
      expect(rangoCierreDelDia(f).hasta).not.toBe(rangoCierreDelDia(f).desde)
    }
  })

  it('cruza fin de mes y fin de año', () => {
    expect(rangoCierreDelDia('2026-08-31').hasta).toBe('2026-09-01')
    expect(rangoCierreDelDia('2026-12-31').hasta).toBe('2027-01-01')
  })

  it('el día del cambio de hora no corre la fecha', () => {
    // La cuenta va al mediodía UTC justamente para no rozarlo.
    expect(rangoCierreDelDia('2026-03-01')).toEqual({ desde: '2026-03-01', hasta: '2026-03-02' })
    expect(diaAnterior('2026-03-01')).toBe('2026-02-28')
  })
})
