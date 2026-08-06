/**
 * lib/programacion.ts
 *
 * Bloque E (commit 3) — Vista previa mensual de la programación.
 *
 * `previsualizarMes` expande los servicios activos de un mes en filas por
 * fecha y clasifica cada una SIN escribir nada: es una función pura que
 * recibe los datos ya consultados y devuelve el resultado. La creación de
 * turnos a partir de la vista previa corresponde a una etapa posterior.
 *
 * Reglas que reutiliza (no las reescribe):
 *   · superposición de horarios y turnos nocturnos: lib/turnos
 *     (tieneTurnoSuperpuesto maneja hora_fin <= hora_inicio);
 *   · turnos sin obligación de cobertura: ESTADOS_SIN_OBLIGACION de
 *     lib/revision-operativa (reemplazado/anulado/cancelado no cuentan
 *     como existentes ni bloquean al guardia sugerido);
 *   · característica del turno: lib/caracteristica-turno (la generación
 *     mensual siempre produce turnos 'normal');
 *   · puestos activos por objetivo: EstadoPuestos de lib/puestos.
 *
 * El guardia habitual NO es requisito: si existe se muestra solo como
 * "guardia sugerido" y sirve para anticipar superposiciones. Un servicio
 * sin guardia habitual se previsualiza igual.
 */

import { horariosSuperpuestos, tieneTurnoSuperpuesto } from '@/lib/turnos'
import type { TurnoHorario } from '@/lib/turnos'
import { ESTADOS_SIN_OBLIGACION } from '@/lib/revision-operativa'
import { caracteristicaTurno, etiquetaCaracteristica } from '@/lib/caracteristica-turno'
import type { EstadoPuestos } from '@/lib/puestos'

// ── Clasificación centralizada ───────────────────────────────────────────────

export type EstadoPrevision =
  | 'valido'              // se puede crear
  | 'ya_existe'           // el turno ya está en la base
  | 'conflicto_horario'   // el guardia sugerido queda superpuesto
  | 'fecha_pasada'        // no se programa retroactivamente desde acá
  | 'sin_puesto'          // servicio legacy sin puesto vinculado
  | 'turno_base_inactivo'
  | 'objetivo_inactivo'
  | 'objetivo_prueba'     // objetivo es_prueba: excluido de la programación
  | 'config_invalida'     // días vacíos, turno base ausente, franja inválida…

export const ETIQUETA_PREVISION: Record<EstadoPrevision, string> = {
  valido: 'Válido para crear',
  ya_existe: 'Ya existe',
  conflicto_horario: 'Conflicto de horario',
  fecha_pasada: 'Fecha pasada',
  sin_puesto: 'Servicio sin posición operativa',
  turno_base_inactivo: 'Turno base inactivo',
  objetivo_inactivo: 'Objetivo inactivo',
  objetivo_prueba: 'Objetivo de prueba excluido',
  config_invalida: 'Configuración inválida',
}

export const DETALLE_FECHA_PASADA =
  'Los días pasados se resuelven por regularización administrativa, no desde la programación.'

export const MENSAJE_SERVICIO_SIN_PUESTO =
  'No se puede programar: servicio sin posición operativa vinculada'

export const MENSAJE_GUARDIA_SUGERIDO_SUPERPUESTO =
  'El guardia sugerido ya tiene un turno superpuesto en ese horario.'

export const MENSAJE_VACANTE_COMPATIBLE =
  'Ya existe una posición programada sin vigilador para este horario.'

export const DETALLE_COBERTURA_EQUIVALENTE =
  'Cobertura equivalente en otra posición'

// ── Entradas ─────────────────────────────────────────────────────────────────

export interface ServicioPrevision {
  id: string
  objetivo_id: string
  puesto_id?: string | null
  dias_semana?: number[] | null // 1=Lun … 7=Dom
  guardia_habitual_id?: string | null
  activo: boolean
  turno_base?: {
    nombre?: string | null
    hora_inicio?: string | null
    hora_fin?: string | null
    activo?: boolean | null
  } | null
  guardia?: { nombre?: string | null; apellido?: string | null } | null
  puesto?: { nombre?: string | null } | null
}

export interface ObjetivoPrevision {
  id: string
  nombre: string
  estado?: string | null
  es_prueba?: boolean | null
}

export interface TurnoExistentePrevision {
  id?: string | null
  objetivo_id: string
  puesto_id?: string | null
  guardia_id?: string | null
  servicio_base_id?: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  estado?: string | null
  tipo_evento?: string | null
}

// ── Salidas ──────────────────────────────────────────────────────────────────

export interface FilaPrevision {
  fecha: string
  dia_semana: string
  servicio_id: string
  objetivo_id: string
  objetivo_nombre: string
  puesto_id: string | null
  puesto_nombre: string | null
  turno_base_nombre: string
  hora_inicio: string
  hora_fin: string
  guardia_sugerido_id: string | null
  guardia_sugerido_nombre: string | null
  /** Etiqueta de la característica prevista (siempre 'Normal' en esta etapa). */
  caracteristica: string
  estado: EstadoPrevision
  detalle: string | null
}

/** Servicio que no puede previsualizarse: una advertencia, no filas por fecha. */
export interface AdvertenciaPrevision {
  servicio_id: string
  objetivo_nombre: string
  turno_base_nombre: string | null
  estado: EstadoPrevision
  detalle: string
}

export interface ResumenPrevision {
  mes: string
  total_esperado: number
  validos: number
  existentes: number
  conflictos: number
  fechas_pasadas: number
  servicios_excluidos: number
  servicios_sin_puesto: number
}

export interface ResultadoPrevision {
  mes: string
  filas: FilaPrevision[]
  advertencias: AdvertenciaPrevision[]
  resumen: ResumenPrevision
}

// ── Fechas del mes ───────────────────────────────────────────────────────────

const DIA_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

const pad2 = (n: number) => String(n).padStart(2, '0')

export function fechasDelMes(anio: number, mes: number, diasSemana: number[]): string[] {
  const ultimo = new Date(anio, mes, 0).getDate()
  const fechas: string[] = []
  for (let dia = 1; dia <= ultimo; dia++) {
    let dow = new Date(anio, mes - 1, dia).getDay()
    if (dow === 0) dow = 7
    if (diasSemana.includes(dow)) fechas.push(`${anio}-${pad2(mes)}-${pad2(dia)}`)
  }
  return fechas
}

export function diaSemanaCorto(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-').map(Number)
  return DIA_CORTO[new Date(anio, mes - 1, dia).getDay()] ?? ''
}

// ── Vista previa ─────────────────────────────────────────────────────────────

const hora5 = (h?: string | null) => (h ?? '').slice(0, 5)

const HORA_VALIDA = /^\d{1,2}:\d{2}/

/** Turno existente que sigue contando (no reemplazado/anulado/cancelado). */
const conObligacion = (t: TurnoExistentePrevision) =>
  !ESTADOS_SIN_OBLIGACION.has(t.estado || '')

export function previsualizarMes(params: {
  anio: number
  mes: number // 1–12
  servicios: ServicioPrevision[]
  objetivos: ObjetivoPrevision[]
  puestosPorObjetivo: Map<string, EstadoPuestos>
  turnosExistentes: TurnoExistentePrevision[]
  /**
   * Fecha y hora actuales (YYYY-MM-DD / HH:MM) para bloquear la creación
   * retroactiva: una fecha anterior, o la de hoy cuando el turno ya comenzó,
   * se clasifica 'fecha_pasada' (visible, solo lectura, no seleccionable).
   * Sin estos parámetros no se aplica el bloqueo (útil en tests históricos).
   */
  fechaActual?: string
  horaActual?: string
}): ResultadoPrevision {
  const { anio, mes, servicios, objetivos, puestosPorObjetivo, turnosExistentes, fechaActual, horaActual } = params
  const mesStr = `${anio}-${pad2(mes)}`

  const objetivoPorId = new Map(objetivos.map(o => [o.id, o]))

  // Solo turnos con obligación de cobertura participan de la deduplicación y
  // de la detección de superposiciones (regla de ESTADOS_SIN_OBLIGACION).
  const vigentes = turnosExistentes.filter(conObligacion)

  // Deduplicación, sin depender del guardia:
  //   1) servicio_base_id + fecha + horario + puesto (turnos ya generados);
  //   2) fallback para turnos manuales: objetivo + puesto + fecha + horario.
  // Solo contra turnos de característica 'normal': la generación produce
  // turnos normales y no debe chocar con capacitaciones/coberturas.
  const porServicio = new Set<string>()
  const porSlotManual = new Set<string>()
  // Mismo objetivo + fecha + horario en OTRA posición: no es duplicado
  // técnico (dos posiciones simultáneas son legítimas) pero se advierte como
  // cobertura equivalente para que el administrador la revise.
  const porSlotSinPosicion = new Set<string>()
  for (const t of vigentes) {
    if (caracteristicaTurno(t.tipo_evento) !== 'normal') continue
    const horario = `${t.fecha}|${hora5(t.hora_inicio)}|${hora5(t.hora_fin)}|${t.puesto_id ?? ''}`
    if (t.servicio_base_id) porServicio.add(`${t.servicio_base_id}|${horario}`)
    porSlotManual.add(`${t.objetivo_id}|${horario}`)
    porSlotSinPosicion.add(`${t.objetivo_id}|${t.fecha}|${hora5(t.hora_inicio)}|${hora5(t.hora_fin)}`)
  }

  // Para superposiciones del guardia sugerido cuentan TODOS los turnos
  // vigentes (cualquier característica) más las filas válidas ya
  // previsualizadas, igual que haría la creación real.
  const paraSuperposicion: TurnoHorario[] = vigentes.map(t => ({
    id: t.id ?? null,
    guardia_id: t.guardia_id ?? null,
    fecha: t.fecha,
    hora_inicio: t.hora_inicio,
    hora_fin: t.hora_fin,
    estado: t.estado ?? null,
  }))

  const filas: FilaPrevision[] = []
  const advertencias: AdvertenciaPrevision[] = []

  const advertir = (srv: ServicioPrevision, estado: EstadoPrevision, detalle: string) => {
    advertencias.push({
      servicio_id: srv.id,
      objetivo_nombre: objetivoPorId.get(srv.objetivo_id)?.nombre ?? srv.objetivo_id,
      turno_base_nombre: srv.turno_base?.nombre ?? null,
      estado,
      detalle,
    })
  }

  for (const srv of servicios) {
    if (!srv.activo) continue

    const objetivo = objetivoPorId.get(srv.objetivo_id)
    if (!objetivo || objetivo.estado !== 'activo') {
      advertir(srv, 'objetivo_inactivo', ETIQUETA_PREVISION.objetivo_inactivo)
      continue
    }
    if (objetivo.es_prueba) {
      advertir(srv, 'objetivo_prueba', ETIQUETA_PREVISION.objetivo_prueba)
      continue
    }
    if (!srv.puesto_id) {
      advertir(srv, 'sin_puesto', MENSAJE_SERVICIO_SIN_PUESTO)
      continue
    }
    const puestosObjetivo = puestosPorObjetivo.get(srv.objetivo_id)?.puestos ?? []
    const puestoActivo = puestosObjetivo.find(p => p.id === srv.puesto_id)
    if (!puestoActivo) {
      advertir(srv, 'config_invalida', 'La posición operativa vinculada no está activa o no pertenece al objetivo.')
      continue
    }
    if (!srv.turno_base) {
      advertir(srv, 'config_invalida', 'El servicio no tiene turno base.')
      continue
    }
    if (srv.turno_base.activo === false) {
      advertir(srv, 'turno_base_inactivo', ETIQUETA_PREVISION.turno_base_inactivo)
      continue
    }
    const horaInicio = srv.turno_base.hora_inicio ?? ''
    const horaFin = srv.turno_base.hora_fin ?? ''
    if (!HORA_VALIDA.test(horaInicio) || !HORA_VALIDA.test(horaFin)) {
      advertir(srv, 'config_invalida', 'El turno base tiene una franja horaria inválida.')
      continue
    }
    if (!srv.dias_semana?.length) {
      advertir(srv, 'config_invalida', 'El servicio no tiene días de la semana configurados.')
      continue
    }

    const guardiaSugeridoId = srv.guardia_habitual_id ?? null
    const guardiaSugeridoNombre = srv.guardia
      ? [srv.guardia.apellido, srv.guardia.nombre].filter(Boolean).join(', ') || null
      : null

    for (const fecha of fechasDelMes(anio, mes, srv.dias_semana)) {
      const horario = `${fecha}|${hora5(horaInicio)}|${hora5(horaFin)}|${srv.puesto_id}`

      const base: Omit<FilaPrevision, 'estado' | 'detalle'> = {
        fecha,
        dia_semana: diaSemanaCorto(fecha),
        servicio_id: srv.id,
        objetivo_id: srv.objetivo_id,
        objetivo_nombre: objetivo.nombre,
        puesto_id: srv.puesto_id,
        puesto_nombre: srv.puesto?.nombre ?? puestoActivo.nombre ?? null,
        turno_base_nombre: srv.turno_base.nombre ?? '—',
        hora_inicio: hora5(horaInicio),
        hora_fin: hora5(horaFin),
        guardia_sugerido_id: guardiaSugeridoId,
        guardia_sugerido_nombre: guardiaSugeridoNombre,
        caracteristica: etiquetaCaracteristica('normal'),
      }

      if (porServicio.has(`${srv.id}|${horario}`)) {
        filas.push({ ...base, estado: 'ya_existe', detalle: 'Ya generado desde este servicio.' })
        continue
      }
      if (porSlotManual.has(`${srv.objetivo_id}|${horario}`)) {
        filas.push({ ...base, estado: 'ya_existe', detalle: 'Coincide con un turno ya cargado para ese puesto y horario.' })
        continue
      }

      const candidato: TurnoHorario = {
        guardia_id: guardiaSugeridoId,
        fecha,
        hora_inicio: horaInicio,
        hora_fin: horaFin,
      }
      if (tieneTurnoSuperpuesto(paraSuperposicion, candidato)) {
        filas.push({ ...base, estado: 'conflicto_horario', detalle: MENSAJE_GUARDIA_SUGERIDO_SUPERPUESTO })
        continue
      }

      // Sin creación retroactiva: fecha anterior, o la de hoy con el turno
      // ya comenzado, queda visible pero solo lectura. No bloquea el resto.
      if (fechaActual && (
        fecha < fechaActual ||
        (fecha === fechaActual && horaActual !== undefined && hora5(horaInicio) <= horaActual)
      )) {
        filas.push({ ...base, estado: 'fecha_pasada', detalle: DETALLE_FECHA_PASADA })
        continue
      }

      // Advertencia (nunca bloqueo): mismo objetivo/fecha/horario cubierto
      // por otra posición operativa.
      const equivalente = porSlotSinPosicion.has(`${srv.objetivo_id}|${fecha}|${hora5(horaInicio)}|${hora5(horaFin)}`)
      filas.push({ ...base, estado: 'valido', detalle: equivalente ? DETALLE_COBERTURA_EQUIVALENTE : null })
      // Las filas válidas participan de las superposiciones siguientes,
      // igual que lo harían los turnos recién insertados.
      paraSuperposicion.push(candidato)
    }
  }

  const contar = (estado: EstadoPrevision) => filas.filter(f => f.estado === estado).length
  const resumen: ResumenPrevision = {
    mes: mesStr,
    total_esperado: filas.length,
    validos: contar('valido'),
    existentes: contar('ya_existe'),
    conflictos: contar('conflicto_horario'),
    fechas_pasadas: contar('fecha_pasada'),
    servicios_excluidos: advertencias.filter(a => a.estado !== 'sin_puesto').length,
    servicios_sin_puesto: advertencias.filter(a => a.estado === 'sin_puesto').length,
  }

  return { mes: mesStr, filas, advertencias, resumen }
}

// ── Creación parcial (commit 4) ──────────────────────────────────────────────
//
// Solo las filas 'valido' pueden crearse, y siempre con confirmación
// explícita del administrador. El payload lleva únicamente servicio y fecha:
// horario y puesto los deriva y revalida la RPC crear_turnos_programacion_parcial,
// que además deduplica en servidor y audita la operación completa.

/** Clave estable de una fila de la vista previa (para la selección). */
export const clavePrevision = (f: Pick<FilaPrevision, 'servicio_id' | 'fecha'>) =>
  `${f.servicio_id}|${f.fecha}`

export interface FilaCreacion {
  servicio_id: string
  fecha: string
}

/** Filas a enviar a la RPC: solo válidas y seleccionadas. */
export function payloadCreacionParcial(
  filas: FilaPrevision[],
  seleccion: Set<string>,
): FilaCreacion[] {
  return filas
    .filter(f => f.estado === 'valido' && seleccion.has(clavePrevision(f)))
    .map(f => ({ servicio_id: f.servicio_id, fecha: f.fecha }))
}

export interface ResumenConfirmacion {
  cantidad: number
  objetivos: string[]
  puestos: number
}

/** Datos del diálogo de confirmación previo a crear. */
export function resumenConfirmacion(
  filas: FilaPrevision[],
  seleccion: Set<string>,
): ResumenConfirmacion {
  const elegidas = filas.filter(f => f.estado === 'valido' && seleccion.has(clavePrevision(f)))
  return {
    cantidad: elegidas.length,
    objetivos: [...new Set(elegidas.map(f => f.objetivo_nombre))],
    puestos: new Set(elegidas.map(f => f.puesto_id ?? '')).size,
  }
}

// ── Prevención de duplicados en el alta manual ──────────────────────────────

export interface TurnoVacanteCandidato {
  id?: string | null
  objetivo_id: string
  puesto_id?: string | null
  guardia_id?: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  estado?: string | null
  tipo_evento?: string | null
}

/**
 * Turnos programados SIN vigilador del mismo objetivo que se superponen con
 * el candidato de un alta manual. Es una ADVERTENCIA para ofrecer "asignar
 * sobre la vacante" en lugar de crear un turno nuevo: nunca un bloqueo
 * (pueden existir varias posiciones simultáneas legítimas). Capacitaciones y
 * estados sin obligación no cuentan como vacante.
 */
export function vacantesCompatibles<T extends TurnoVacanteCandidato>(
  turnos: T[],
  candidato: { objetivo_id: string; fecha: string; hora_inicio: string; hora_fin: string },
): T[] {
  return turnos.filter(t =>
    t.objetivo_id === candidato.objetivo_id &&
    !t.guardia_id &&
    !ESTADOS_SIN_OBLIGACION.has(t.estado || '') &&
    caracteristicaTurno(t.tipo_evento) === 'normal' &&
    horariosSuperpuestos(t, candidato),
  )
}

/**
 * Turnos vigentes (con o sin vigilador) del mismo objetivo, fecha y horario
 * exacto en OTRA posición operativa: cobertura equivalente. Solo informa.
 */
export function coberturaEquivalenteOtraPosicion<T extends TurnoVacanteCandidato>(
  turnos: T[],
  candidato: { objetivo_id: string; puesto_id?: string | null; fecha: string; hora_inicio: string; hora_fin: string },
): T[] {
  return turnos.filter(t =>
    t.objetivo_id === candidato.objetivo_id &&
    t.fecha === candidato.fecha &&
    hora5(t.hora_inicio) === hora5(candidato.hora_inicio) &&
    hora5(t.hora_fin) === hora5(candidato.hora_fin) &&
    (t.puesto_id ?? '') !== (candidato.puesto_id ?? '') &&
    !ESTADOS_SIN_OBLIGACION.has(t.estado || '') &&
    caracteristicaTurno(t.tipo_evento) === 'normal',
  )
}

/** Resultado por fila que devuelve la RPC. */
export interface FilaResultadoCreacion {
  servicio_id: string
  fecha: string
  resultado: 'creada' | 'ya_existe' | 'omitida'
  motivo: string | null
  turno_id: string | null
}

export interface ResultadoCreacion {
  operacion_id: string
  mes: string
  solicitadas: number
  creadas: number
  ya_existentes: number
  omitidas: number
  turnos_creados: string[]
  filas: FilaResultadoCreacion[]
  /** true si la RPC devolvió el resultado guardado de la misma operación. */
  repetida?: boolean
}
