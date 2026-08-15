/**
 * lib/guardias-supervisor.ts
 *
 * Generación por rango de guardias de supervisor (tabla `supervisores_guardia`).
 *
 * La pantalla "Supervisores de Guardia" cargaba una fila por día, a mano. Para
 * programar una zona completa había que repetir la misma carga decenas de
 * veces. Acá vive la parte pura de la generación masiva: expandir
 * (fecha desde, fecha hasta, días de semana) en filas concretas, descartar las
 * que ya existen y contar todo ANTES de escribir nada. La pantalla consulta,
 * muestra el resumen y recién entonces inserta.
 *
 * Decisiones que conviene tener a la vista:
 *
 *   · La zona se guarda con el nombre canónico de `zonas_operativas`. La
 *     comparación, en cambio, va normalizada (trim + minúsculas) porque en
 *     producción conviven 'rafaela' y 'Rafaela'. Mismo criterio que usan
 *     AppClient y SupervisorMobile para buscar al supervisor de guardia.
 *
 *   · En los nocturnos (hora_fin <= hora_inicio) la fila se guarda con la
 *     fecha de INICIO. Un "viernes 19:00 a sábado 07:00" es una fila del
 *     viernes: al elegir los días de semana se eligen días de comienzo, no de
 *     cobertura. La tabla ya funcionaba así; la generación no lo cambia.
 *
 *   · Duplicado exacto = mismo supervisor, misma zona (normalizada), misma
 *     fecha y mismo horario. El rol operativo queda fuera de la clave a
 *     propósito: dos filas iguales con distinto rol son una carga repetida,
 *     no dos guardias distintas.
 *
 * No genera nada retroactivo ni lo prohíbe: si el rango incluye días pasados
 * se generan igual, porque cargar una guardia ya cumplida es una corrección
 * administrativa legítima.
 */

// ── Constantes ───────────────────────────────────────────────────────────────

/**
 * Tope de días del rango. Un año alcanza de sobra y evita un insert absurdo.
 * Con esto la cantidad de filas queda acotada sola: como máximo una por día.
 */
export const MAX_DIAS_RANGO = 366

export const MENSAJE_RANGO_INVERTIDO = 'La fecha "hasta" no puede ser anterior a la fecha "desde".'
export const MENSAJE_SIN_DIAS = 'Seleccioná al menos un día de la semana.'
export const MENSAJE_RANGO_LARGO = `El rango supera ${MAX_DIAS_RANGO} días. Generá por tramos más cortos.`
export const MENSAJE_SIN_SUPERVISOR = 'Elegí el supervisor asignado.'
export const MENSAJE_SIN_ZONA = 'Elegí la zona operativa.'
export const MENSAJE_SIN_HORARIO = 'Completá hora de inicio y hora de fin.'
export const MENSAJE_FECHAS_INCOMPLETAS = 'Completá la fecha desde y la fecha hasta.'

// ── Entradas y salidas ───────────────────────────────────────────────────────

export interface ParametrosGeneracion {
  supervisor_id: string
  /** Nombre canónico tal como figura en zonas_operativas. */
  zona: string
  /** YYYY-MM-DD */
  desde: string
  /** YYYY-MM-DD */
  hasta: string
  /** 1=Lun … 7=Dom */
  dias_semana: number[]
  hora_inicio: string
  hora_fin: string
  rol_operativo?: string
  estado?: string
  observacion?: string | null
}

/** Fila ya existente en supervisores_guardia, para descartar duplicados. */
export interface GuardiaExistente {
  supervisor_id?: string | null
  zona?: string | null
  fecha?: string | null
  hora_inicio?: string | null
  hora_fin?: string | null
}

export interface FilaGuardiaGenerada {
  supervisor_id: string
  fecha: string
  hora_inicio: string
  hora_fin: string
  zona: string
  rol_operativo: string
  estado: string
  observacion: string | null
}

export interface PrevisionGeneracion {
  /** Todas las fechas del rango que caen en los días elegidos. */
  fechas: string[]
  /** Filas que se van a insertar. */
  aCrear: FilaGuardiaGenerada[]
  /** Fechas descartadas por existir ya una fila idéntica. */
  duplicadas: string[]
  /** Errores de configuración. Con al menos uno, aCrear queda vacío. */
  errores: string[]
  /** true si el horario cruza la medianoche. */
  nocturno: boolean
}

// ── Utilidades ───────────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Normaliza zona/estado/rol para comparar texto libre contra el catálogo. */
export const normalizarTextoGuardia = (value?: string | null) =>
  (value ?? '').trim().toLowerCase()

/** Recorta 'HH:MM:SS' a 'HH:MM'. La base guarda time, el formulario manda HH:MM. */
export const hora5 = (hora?: string | null) => (hora ?? '').slice(0, 5)

const FECHA_VALIDA = /^\d{4}-\d{2}-\d{2}$/
const HORA_VALIDA = /^\d{1,2}:\d{2}/

/** Día de semana 1=Lun … 7=Dom, sin depender del huso horario. */
export function diaSemanaIso(fecha: string): number {
  const [anio, mes, dia] = fecha.split('-').map(Number)
  const dow = new Date(anio, mes - 1, dia).getDay()
  return dow === 0 ? 7 : dow
}

/**
 * Fechas entre `desde` y `hasta` (ambas incluidas) que caen en `diasSemana`.
 * Devuelve [] si el rango está invertido o mal formado; la validación de esos
 * casos es responsabilidad de previsualizarGeneracion.
 */
export function fechasEnRango(desde: string, hasta: string, diasSemana: number[]): string[] {
  if (!FECHA_VALIDA.test(desde) || !FECHA_VALIDA.test(hasta)) return []
  if (hasta < desde) return []
  if (!diasSemana.length) return []

  const [anioD, mesD, diaD] = desde.split('-').map(Number)
  const cursor = new Date(anioD, mesD - 1, diaD)
  const fechas: string[] = []

  // El corte es por string: las fechas ISO ordenan lexicográficamente y así no
  // hay que construir un Date de comparación por vuelta.
  for (let i = 0; i <= MAX_DIAS_RANGO; i++) {
    const fecha = `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}-${pad2(cursor.getDate())}`
    if (fecha > hasta) break
    if (diasSemana.includes(diaSemanaIso(fecha))) fechas.push(fecha)
    cursor.setDate(cursor.getDate() + 1)
  }

  return fechas
}

/** Días calendario que abarca el rango, extremos incluidos. */
export function diasDelRango(desde: string, hasta: string): number {
  if (!FECHA_VALIDA.test(desde) || !FECHA_VALIDA.test(hasta)) return 0
  const [a1, m1, d1] = desde.split('-').map(Number)
  const [a2, m2, d2] = hasta.split('-').map(Number)
  const ms = Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)
  return Math.floor(ms / 86_400_000) + 1
}

/** true si el horario cruza la medianoche (18:00 a 06:00). */
export function esNocturno(horaInicio: string, horaFin: string): boolean {
  const inicio = hora5(horaInicio)
  const fin = hora5(horaFin)
  if (!HORA_VALIDA.test(inicio) || !HORA_VALIDA.test(fin)) return false
  return fin <= inicio
}

/**
 * Clave de duplicado exacto: supervisor + zona normalizada + fecha + horario.
 * El rol operativo queda afuera a propósito (ver cabecera del módulo).
 */
export function claveGuardia(fila: GuardiaExistente): string {
  return [
    fila.supervisor_id ?? '',
    normalizarTextoGuardia(fila.zona),
    String(fila.fecha ?? '').slice(0, 10),
    hora5(fila.hora_inicio),
    hora5(fila.hora_fin),
  ].join('|')
}

// ── Vista previa ─────────────────────────────────────────────────────────────

/**
 * Expande los parámetros en filas concretas sin escribir nada.
 *
 * `existentes` son las filas que ya están en la base para ese rango. La
 * pantalla las consulta acotadas por fecha; pasarlas todas también funciona,
 * la clave descarta lo que no corresponde.
 */
export function previsualizarGeneracion(
  params: ParametrosGeneracion,
  existentes: GuardiaExistente[] = [],
): PrevisionGeneracion {
  const errores: string[] = []

  const supervisorId = (params.supervisor_id ?? '').trim()
  const zona = (params.zona ?? '').trim()
  const desde = (params.desde ?? '').trim()
  const hasta = (params.hasta ?? '').trim()
  const horaInicio = hora5(params.hora_inicio)
  const horaFin = hora5(params.hora_fin)
  const dias = (params.dias_semana ?? [])
    .filter((d, i, todos) => d >= 1 && d <= 7 && todos.indexOf(d) === i)
    .sort((a, b) => a - b)

  if (!supervisorId) errores.push(MENSAJE_SIN_SUPERVISOR)
  if (!zona) errores.push(MENSAJE_SIN_ZONA)
  if (!FECHA_VALIDA.test(desde) || !FECHA_VALIDA.test(hasta)) errores.push(MENSAJE_FECHAS_INCOMPLETAS)
  else if (hasta < desde) errores.push(MENSAJE_RANGO_INVERTIDO)
  else if (diasDelRango(desde, hasta) > MAX_DIAS_RANGO) errores.push(MENSAJE_RANGO_LARGO)
  if (!dias.length) errores.push(MENSAJE_SIN_DIAS)
  if (!HORA_VALIDA.test(horaInicio) || !HORA_VALIDA.test(horaFin)) errores.push(MENSAJE_SIN_HORARIO)

  const nocturno = esNocturno(horaInicio, horaFin)

  if (errores.length) {
    return { fechas: [], aCrear: [], duplicadas: [], errores, nocturno }
  }

  const fechas = fechasEnRango(desde, hasta, dias)

  const yaExisten = new Set(existentes.map(claveGuardia))
  const duplicadas: string[] = []
  const aCrear: FilaGuardiaGenerada[] = []

  // Las repeticiones dentro de la propia tanda también cuentan: el mismo día
  // no puede entrar dos veces aunque la base todavía no lo tenga.
  const enTanda = new Set<string>()

  for (const fecha of fechas) {
    const clave = claveGuardia({
      supervisor_id: supervisorId,
      zona,
      fecha,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
    })

    if (yaExisten.has(clave) || enTanda.has(clave)) {
      duplicadas.push(fecha)
      continue
    }

    enTanda.add(clave)
    aCrear.push({
      supervisor_id: supervisorId,
      fecha,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      zona,
      rol_operativo: params.rol_operativo || 'supervisor',
      estado: params.estado || 'activo',
      observacion: (params.observacion ?? '').trim() || null,
    })
  }

  return { fechas, aCrear, duplicadas, errores, nocturno }
}

/** Resumen en una línea para mostrar antes de insertar. */
export function resumenGeneracion(prevision: PrevisionGeneracion): string {
  if (prevision.errores.length) return prevision.errores.join(' ')
  if (!prevision.fechas.length) return 'Ningún día del rango coincide con los días elegidos.'

  const partes = [`Se van a crear ${prevision.aCrear.length} guardia(s)`]
  if (prevision.duplicadas.length) partes.push(`${prevision.duplicadas.length} ya existen y se omiten`)
  if (prevision.nocturno) partes.push('horario nocturno: la fecha es la de inicio')
  return `${partes.join(' · ')}.`
}
