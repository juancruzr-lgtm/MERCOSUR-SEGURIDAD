import { describe, expect, it, vi } from 'vitest'

// lib/liquidacion importa calcularHorasLiquidables de lib/supabase, que crea el
// cliente al cargar. El cliente no se usa en estos tests: se reemplaza por uno
// vacío para no depender de WebSocket nativo (Node < 22).
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => new Proxy({}, { get: () => () => ({ data: { subscription: { unsubscribe() {} } } }) }),
}))

import {
  aplicarAccion, casoVencido, comunicacionesSinRespuesta, filtrarCasos, resumirCasos,
  type Caso,
} from '@/lib/tablero-gerencia/casos'
import {
  CATALOGO_REGLAS, causaProbable, claveCaso, gravedadEfectiva, plazoDesde, reglasQueDetectan,
} from '@/lib/tablero-gerencia/reglas'
import { compararMeses, lineaHoras, requiereRevisionDiferencia, resumirHorasMes, semanaDelMes } from '@/lib/tablero-gerencia/horas'
import {
  PLANTILLAS_GESTION, agruparPorDestinatario, plantillaPorCodigo, prepararLote, vistaPrevia,
  type PlantillaGestion,
} from '@/lib/tablero-gerencia/mensajes'
import { ENVIO_MENSAJES_GESTION_HABILITADO, permisosTablero, tableroGerenciaVisible } from '@/lib/tablero-gerencia/acceso'

const T0 = '2026-11-10T12:00:00.000Z'

function caso(p: Partial<Caso> = {}): Caso {
  return {
    id: 'c1', tipo: 'sin_fichaje', gravedad: 'alta', estado: 'detectado', causa: 'indeterminada',
    clave: 'ASI-01|t1', regla: 'ASI-01', empleadoId: 'e1', objetivoId: 'o1', clienteId: 'cl1',
    turnoId: 't1', fechaHecho: '2026-11-10', detectadoAt: T0, plazoAt: plazoDesde(T0, 24),
    responsableId: null, evidencias: [], eventos: [], ...p,
  }
}

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error((r as unknown as { error: string }).error)
  return r as Extract<T, { ok: true }>
}

describe('circuito de casos', () => {
  it('recorre detectar → revisar → comunicar → asignar → responder → resolver → verificar', () => {
    let c = caso()
    c = ok(aplicarAccion(c, { accion: 'revisar', actorId: 'g', at: T0 })).caso
    expect(c.estado).toBe('en_revision')
    c = ok(aplicarAccion(c, { accion: 'solicitar_explicacion', actorId: 'g', at: T0, comunicacionId: 'm1' })).caso
    expect(c.estado).toBe('comunicado')
    c = ok(aplicarAccion(c, { accion: 'asignar', actorId: 'g', at: T0, responsableId: 'sup1' })).caso
    expect(c.responsableId).toBe('sup1')
    expect(c.estado).toBe('comunicado')
    expect(comunicacionesSinRespuesta(c)).toBe(1)
    c = ok(aplicarAccion(c, { accion: 'registrar_respuesta', actorId: 'sup1', at: T0, comentario: 'Se olvidó de fichar, estuvo presente' })).caso
    expect(c.estado).toBe('respondido')
    expect(comunicacionesSinRespuesta(c)).toBe(0)
    c = ok(aplicarAccion(c, { accion: 'marcar_resuelto', actorId: 'sup1', at: T0, comentario: 'Asistencia confirmada con evidencia', causa: 'conducta' })).caso
    expect(c.estado).toBe('resuelto')
    c = ok(aplicarAccion(c, { accion: 'verificar', actorId: 'g', at: T0, condicionVigente: false })).caso
    expect(c.estado).toBe('verificado')
    expect(c.eventos.map(e => e.accion)).toEqual([
      'revisar', 'solicitar_explicacion', 'asignar', 'registrar_respuesta', 'marcar_resuelto', 'verificar',
    ])
  })

  it('enviar un mensaje nunca resuelve el caso', () => {
    const c = ok(aplicarAccion(caso(), { accion: 'avisar_supervisor', actorId: 'g', at: T0, comunicacionId: 'm1' })).caso
    expect(c.estado).toBe('comunicado')
    expect(casoVencido(c, '2026-11-12T00:00:00.000Z')).toBe(true)
  })

  it('una comunicación sin registro no se vincula', () => {
    expect(aplicarAccion(caso(), { accion: 'solicitar_explicacion', actorId: 'g', at: T0 }).ok).toBe(false)
  })

  it('resolver exige motivo y causa; descartar no admite conducta', () => {
    expect(aplicarAccion(caso(), { accion: 'marcar_resuelto', actorId: 'g', at: T0, comentario: 'listo' }).ok).toBe(false)
    expect(aplicarAccion(caso(), { accion: 'marcar_resuelto', actorId: 'g', at: T0, causa: 'tecnica_gps' }).ok).toBe(false)
    expect(aplicarAccion(caso(), { accion: 'descartar', actorId: 'g', at: T0, comentario: 'no aplica', causa: 'conducta' }).ok).toBe(false)
    expect(ok(aplicarAccion(caso(), { accion: 'descartar', actorId: 'g', at: T0, comentario: 'Radio del objetivo mal cargado', causa: 'configuracion' })).caso.estado).toBe('descartado')
  })

  it('verificar con la condición vigente reabre el caso', () => {
    const r = ok(aplicarAccion(caso({ estado: 'resuelto' }), { accion: 'verificar', actorId: 'g', at: T0, condicionVigente: true }))
    expect(r.caso.estado).toBe('reabierto')
    expect(aplicarAccion(caso(), { accion: 'verificar', actorId: 'g', at: T0, condicionVigente: false }).ok).toBe(false)
  })

  it('un caso cerrado sólo admite comentar o reabrir', () => {
    const c = caso({ estado: 'verificado' })
    expect(aplicarAccion(c, { accion: 'asignar', actorId: 'g', at: T0, responsableId: 'x' }).ok).toBe(false)
    expect(aplicarAccion(c, { accion: 'reabrir', actorId: 'g', at: T0 }).ok).toBe(false)
    expect(ok(aplicarAccion(c, { accion: 'reabrir', actorId: 'g', at: T0, comentario: 'Volvió a pasar' })).caso.estado).toBe('reabierto')
  })

  it('no muta el caso original (historial append-only)', () => {
    const c = caso()
    aplicarAccion(c, { accion: 'revisar', actorId: 'g', at: T0 })
    expect(c.estado).toBe('detectado')
    expect(c.eventos).toHaveLength(0)
  })
})

describe('resumen y filtros', () => {
  const ahora = '2026-11-15T12:00:00.000Z'
  const casos = [
    caso({ id: 'a', responsableId: 's1' }),
    caso({ id: 'b', estado: 'resuelto', eventos: [{ accion: 'marcar_resuelto', actorId: 'x', at: '2026-11-10T16:00:00.000Z', estadoAnterior: 'detectado', estadoNuevo: 'resuelto' }] }),
    caso({ id: 'c', estado: 'descartado', objetivoId: 'o2' }),
    caso({ id: 'd', plazoAt: null }),
    caso({ id: 'e', estado: 'verificado' }),
  ]

  it('cuenta abiertos, vencidos, resueltos sin verificar y reincidencias', () => {
    const r = resumirCasos(casos, ahora)
    expect(r.abiertos).toBe(2)
    expect(r.vencidos).toBe(1)
    expect(r.resueltosSinVerificar).toBe(1)
    expect(r.verificados).toBe(1)
    expect(r.sinResponsable).toBe(1)
    expect(r.horasMedianaResolucion).toBe(4)
    expect(r.porResponsable.s1).toEqual({ abiertos: 1, vencidos: 1 })
    // 4 casos no descartados del mismo empleado y tipo
    expect(r.reincidencias).toEqual([{ empleadoId: 'e1', tipo: 'sin_fichaje', casos: 4 }])
  })

  it('respeta el alcance del supervisor (fail-closed)', () => {
    expect(filtrarCasos(casos, {}, null, ahora)).toHaveLength(5)
    expect(filtrarCasos(casos, {}, new Set(['o2']), ahora).map(c => c.id)).toEqual(['c'])
    expect(filtrarCasos(casos, {}, new Set(), ahora)).toHaveLength(0)
    expect(filtrarCasos(casos, { soloVencidos: true }, null, ahora).map(c => c.id)).toEqual(['a'])
  })
})

describe('reglas', () => {
  it('las reglas propuestas no detectan hasta ser aprobadas', () => {
    const activas = reglasQueDetectan(CATALOGO_REGLAS, new Set())
    expect(activas.every(r => r.estado === 'existente')).toBe(true)
    expect(reglasQueDetectan(CATALOGO_REGLAS, new Set(['HOR-01'])).some(r => r.codigo === 'HOR-01')).toBe(true)
    expect(reglasQueDetectan(CATALOGO_REGLAS, new Set(), new Set(['ASI-01'])).some(r => r.codigo === 'ASI-01')).toBe(false)
  })

  it('los códigos del catálogo son únicos', () => {
    const cods = CATALOGO_REGLAS.map(r => r.codigo)
    expect(new Set(cods).size).toBe(cods.length)
  })

  it('nunca atribuye conducta automáticamente', () => {
    expect(causaProbable({ gpsEstado: 'gps_no_disponible' })).toBe('tecnica_gps')
    expect(causaProbable({ gpsEstado: 'objetivo_sin_gps' })).toBe('configuracion')
    expect(causaProbable({ gpsEstado: 'fuera_radio', radioObjetivoMetros: 10 })).toBe('configuracion')
    expect(causaProbable({ gpsEstado: 'fuera_radio', precisionMetros: 150, radioObjetivoMetros: 100 })).toBe('tecnica_gps')
    expect(causaProbable({ turnoAnuladoOReemplazado: true })).toBe('administrativa')
    expect(causaProbable({ gpsEstado: 'fuera_radio', precisionMetros: 10, radioObjetivoMetros: 100 })).toBe('indeterminada')
  })

  it('la reincidencia agrava sólo si la causa no es técnica ni administrativa', () => {
    expect(gravedadEfectiva('media', 3, 'indeterminada')).toBe('alta')
    expect(gravedadEfectiva('media', 3, 'tecnica_gps')).toBe('media')
    expect(gravedadEfectiva('critica', 9, 'conducta')).toBe('critica')
  })

  it('tardanza y GPS se identifican por registro, no por turno', () => {
    expect(claveCaso('ASI-02', { registroId: 'r1', turnoId: 't1' })).toBe('ASI-02|r1')
    expect(claveCaso('SUP-01', { objetivoId: 'o1', periodo: '2026-11' })).toBe('SUP-01|o1:2026-11')
  })
})

describe('horas', () => {
  const turno = { id: 't1', fecha: '2026-10-09', hora_inicio: '06:00', hora_fin: '18:00', estado: 'programado', objetivo_id: 'o1', guardia_id: 'e1', cliente_id: 'cl1' }

  it('fichaje completo liquida la duración programada', () => {
    const l = lineaHoras(turno, [{ id: 'r1', turno_id: 't1', guardia_id: 'e1', hora_entrada_real: '06:05', hora_salida_real: '16:30' }])
    expect(l.oficiales).toBe(12)
    expect(l.respaldo).toBe('fichaje_completo')
    expect(l.semanaDelMes).toBe(2)
    expect(requiereRevisionDiferencia(l, 10.4)).toBe(true)
  })

  it('confirmación sin fichaje cuenta pero se separa', () => {
    const l = lineaHoras(turno, [{ id: 'r1', turno_id: 't1', horas_liquidables: 12, origen_cobertura: 'confirmacion_supervisor' }])
    expect(l.respaldo).toBe('sin_fichaje')
    const r = resumirHorasMes([l])
    expect(r.total.sinFichaje).toBe(12)
  })

  it('turno anulado no suma horas aunque tenga fichaje (alineado con SQL)', () => {
    const l = lineaHoras({ ...turno, estado: 'anulado' }, [{ id: 'r1', turno_id: 't1', hora_entrada_real: '06:00', hora_salida_real: '18:00' }])
    expect(l.oficiales).toBe(0)
    expect(l.divergeSql).toBe(true)
  })

  it('ignora registros anulados y ausencias; sin salida liquida 0', () => {
    const l = lineaHoras(turno, [
      { id: 'r0', turno_id: 't1', hora_entrada_real: '06:00', hora_salida_real: '18:00', registro_anulado_at: '2026-10-10' },
      { id: 'r1', turno_id: 't1', hora_entrada_real: '06:00' },
    ])
    expect(l.oficiales).toBe(0)
    expect(l.respaldo).toBe('incompleto')
  })

  it('turno que todavía no terminó no suma programadas ni cuenta como incompleto', () => {
    const futuro = lineaHoras({ ...turno, id: 't9', fecha: '2026-10-25' }, [], { pendiente: true })
    const hecho = lineaHoras(turno, [{ id: 'r1', turno_id: 't1', hora_entrada_real: '06:00', hora_salida_real: '18:00' }])
    expect(futuro.respaldo).toBe('pendiente')
    const r = resumirHorasMes([hecho, futuro])
    expect(r.total).toMatchObject({ programadas: 12, oficiales: 12, incompletos: 0, turnos: 1 })
  })

  it('transición jun/jul se marca como divergente de SQL', () => {
    const l = lineaHoras({ ...turno, fecha: '2026-07-03', estado: 'cubierto' }, [])
    expect(l.respaldo).toBe('transicion')
    expect(l.divergeSql).toBe(true)
  })

  it('resume por mes con avance semanal acumulado y compara meses', () => {
    const l1 = lineaHoras(turno, [{ id: 'r1', turno_id: 't1', hora_entrada_real: '06:00', hora_salida_real: '18:00' }])
    const l2 = lineaHoras({ ...turno, id: 't2', fecha: '2026-10-20' }, [{ id: 'r2', turno_id: 't2', hora_entrada_real: '06:00', hora_salida_real: '18:00' }])
    const r = resumirHorasMes([l1, l2])
    expect(r.total.oficiales).toBe(24)
    expect(r.semanas).toEqual([
      { semana: 2, oficialesAcumuladas: 12, programadasAcumuladas: 12 },
      { semana: 3, oficialesAcumuladas: 24, programadasAcumuladas: 24 },
    ])
    expect(r.porEmpleado.e1.oficiales).toBe(24)
    expect(compararMeses(15437.3, 13007)).toEqual({ actual: 15437.3, anterior: 13007, variacion: 2430.3, variacionPct: 18.7 })
    expect(semanaDelMes('2026-11-30')).toBe(5)
  })
})

describe('mensajes', () => {
  const aprobada: PlantillaGestion = { ...plantillaPorCodigo('VIG_FICHAJE_PENDIENTE')!, estadoMeta: 'aprobada' }
  const base = {
    plantilla: aprobada, autorizadoPor: 'gerente', autorizanteEsGerencia: true, ahoraIso: T0, envioHabilitado: true,
  }
  const dest = (id: string, tel: string | null, casoIds = ['c-' + id]) => ({
    usuarioId: id, nombre: 'Persona ' + id, telefono: tel, casoIds, valores: { fecha_turno: '09/10', objetivo: 'LAROMET\nFUNES' },
  })

  it('usa el texto pedido por Gerencia y limpia saltos de línea', () => {
    expect(vistaPrevia(aprobada, { fecha_turno: '09/10', objetivo: 'LAROMET\nFUNES' })).toBe(
      'MERCOSUR SEGURIDAD: Detectamos que no se encuentra registrado tu fichaje correspondiente al turno del 09/10 en LAROMET FUNES. Por favor, verificá la situación e informá el motivo.',
    )
  })

  it('todas las plantillas nuevas nacen pendientes de aprobación de Meta y el envío está apagado', () => {
    expect(PLANTILLAS_GESTION.every(p => p.estadoMeta === 'pendiente_aprobacion')).toBe(true)
    expect(ENVIO_MENSAJES_GESTION_HABILITADO).toBe(false)
    const lote = prepararLote({ ...base, plantilla: plantillaPorCodigo('VIG_FICHAJE_PENDIENTE')!, envioHabilitado: false, destinatarios: [dest('1', '341 555-1234')] })
    expect(lote.bloqueos).toHaveLength(2)
  })

  it('excluye sin teléfono, duplicados y reenvíos recientes', () => {
    const lote = prepararLote({
      ...base,
      destinatarios: [dest('1', '341 555-1234'), dest('2', null), dest('3', '3415551234'), dest('4', '0341 155 556677')],
      enviosPrevios: [{ clave: 'wa|gestion_vig_fichaje_pendiente|c-4|4', at: '2026-11-10T02:00:00.000Z' }],
    })
    expect(lote.items.map(i => i.usuarioId)).toEqual(['1'])
    expect(lote.excluidos.map(e => e.motivo)).toEqual(['sin_telefono', 'duplicado_en_lote', 'ya_enviado_recientemente'])
    expect(lote.bloqueos).toEqual([])
    expect(lote.requiereConfirmacionReforzada).toBe(false)
  })

  it('bloquea lotes masivos y autorizantes que no son Gerencia', () => {
    const muchos = Array.from({ length: 30 }, (_, i) => dest(String(i), `341555${String(1000 + i)}`))
    const lote = prepararLote({ ...base, destinatarios: muchos, autorizanteEsGerencia: false })
    expect(lote.requiereConfirmacionReforzada).toBe(true)
    expect(lote.bloqueos.some(b => b.includes('máximo'))).toBe(true)
    expect(lote.bloqueos.some(b => b.includes('Gerencia'))).toBe(true)
  })

  it('agrupa varios casos de la misma persona en un solo mensaje', () => {
    const m = agruparPorDestinatario([{ id: 'a', e: '1' }, { id: 'b', e: '1' }, { id: 'c', e: null }], c => c.e)
    expect(Array.from(m.keys())).toEqual(['1'])
    expect(m.get('1')!.map(c => c.id)).toEqual(['a', 'b'])
  })
})

describe('acceso', () => {
  it('el tablero nace oculto', () => {
    expect(tableroGerenciaVisible(undefined)).toBe(false)
    expect(tableroGerenciaVisible('0')).toBe(false)
    expect(tableroGerenciaVisible('1')).toBe(true)
  })

  it('supervisor: sólo su alcance, sin económico ni envíos', () => {
    const p = permisosTablero({ alcance: 'zonas_asignadas', objetivosEnAlcance: new Set(['o1']), esGerencia: false, verDashboardGerencial: false })
    expect(p).toMatchObject({ verTablero: true, verEconomico: false, autorizarEnvios: false, aprobarReglas: false })
    expect(Array.from(p.objetivosPermitidos!)).toEqual(['o1'])
    expect(permisosTablero({ alcance: 'zonas_asignadas', objetivosEnAlcance: null, esGerencia: false, verDashboardGerencial: false }).objetivosPermitidos!.size).toBe(0)
    expect(permisosTablero({ alcance: 'propio', objetivosEnAlcance: null, esGerencia: false, verDashboardGerencial: false }).verTablero).toBe(false)
  })
})
